import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { mergeSkillUnits, skillsFromUnits, skillsToToolEntries } from "./skillsLibrary.js";

// App-level cache for the orchestrator Tools tab. Architectures and account
// skills are globally synced data, so they live at module scope and survive
// the tab's mount/unmount cycle: the panel renders instantly from this cache
// while the store silently revalidates and listens for change events, so no
// manual Refresh button is needed.

const SKILLS_REVALIDATE_MIN_MS = 20_000;
const ARCHITECTURE_EVENT_DEBOUNCE_MS = 500;
const ARCHITECTURE_CHANGE_EVENTS = [
  "architecture-store-changed",
  "cloud-mcp-workspace-architectures-updated",
];
const ACCOUNT_TOOLS_CHANGE_EVENTS = [
  "cloud-mcp-account-skills-updated",
];

const workspaceToolsStore = {
  architecturesByRepo: new Map(), // repoPath -> [{ graphId, repoLabel, repoPath, title }]
  archAttemptedRepos: new Set(),
  knownRepos: new Map(), // repoPath -> label; event refreshes re-fetch all of these
  skillsEntries: [],
  skills: [],
  skillsLoaded: false,
  skillsFetchedAtMs: 0,
  version: 0,
};

const workspaceToolsListeners = new Set();
const inFlightArchitectureLoads = new Map(); // repoPath -> Promise
let inFlightSkillsLoad = null;
let architectureEventsWired = false;
let accountToolsEventsWired = false;
let architectureEventTimer = 0;
let accountToolsEventTimer = 0;

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function workspaceToolsRepoDescriptors(coordinationTargets, rootDirectory) {
  const descriptors = [];
  const seen = new Set();
  const addRepo = (repoPath, label) => {
    const cleaned = text(repoPath);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    descriptors.push({ repoPath: cleaned, label: text(label, cleaned.split(/[\\/]/u).pop()) });
  };
  (Array.isArray(coordinationTargets) ? coordinationTargets : []).forEach((target) => {
    addRepo(target?.repoPath, target?.projectName || target?.repoLabel);
  });
  addRepo(rootDirectory, text(rootDirectory).split(/[\\/]/u).pop());
  return descriptors;
}

function notifyWorkspaceToolsListeners() {
  workspaceToolsStore.version += 1;
  workspaceToolsListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Listener failures must not break the store fanout.
    }
  });
}

function architectureItemsSignature(items) {
  return items.map((item) => `${item.repoPath}:${item.graphId}:${item.title}`).join("|");
}

async function loadArchitecturesForRepo(repoPath, label) {
  const existing = inFlightArchitectureLoads.get(repoPath);
  if (existing) return existing;
  const load = (async () => {
    try {
      const list = await invoke("architecture_graphs_list", { repoPath });
      const items = (Array.isArray(list?.graphs) ? list.graphs : [])
        .map((graph) => ({
          graphId: text(graph?.graphId || graph?.graph_id || graph?.id),
          repoLabel: label,
          repoPath,
          title: text(graph?.title || graph?.name || graph?.graphId || graph?.graph_id, "architecture"),
        }))
        .filter((item) => item.graphId);
      const previous = workspaceToolsStore.architecturesByRepo.get(repoPath) || [];
      const changed = architectureItemsSignature(previous) !== architectureItemsSignature(items);
      workspaceToolsStore.architecturesByRepo.set(repoPath, items);
      if (changed || !workspaceToolsStore.archAttemptedRepos.has(repoPath)) {
        workspaceToolsStore.archAttemptedRepos.add(repoPath);
        notifyWorkspaceToolsListeners();
      }
    } catch {
      // Keep whatever is cached; mark attempted so the panel leaves "loading".
      if (!workspaceToolsStore.archAttemptedRepos.has(repoPath)) {
        workspaceToolsStore.archAttemptedRepos.add(repoPath);
        notifyWorkspaceToolsListeners();
      }
    } finally {
      inFlightArchitectureLoads.delete(repoPath);
    }
  })();
  inFlightArchitectureLoads.set(repoPath, load);
  return load;
}

function skillsSignature(skills) {
  return JSON.stringify((Array.isArray(skills) ? skills : []).map((skill) => [
    skill.id,
    skill.title,
    skill.content,
    skill.assetId,
    skill.contentHash,
    skill.pendingPush,
    skill.localSavedAt,
    skill.updatedAt,
  ]));
}

function applyAccountSkills(skills) {
  const normalized = Array.isArray(skills) ? skills : [];
  const changed = !workspaceToolsStore.skillsLoaded
    || skillsSignature(normalized) !== skillsSignature(workspaceToolsStore.skills);
  workspaceToolsStore.skills = normalized;
  workspaceToolsStore.skillsEntries = skillsToToolEntries(normalized);
  workspaceToolsStore.skillsLoaded = true;
  if (changed) notifyWorkspaceToolsListeners();
}

function accountToolsEventCandidates(payload) {
  return [
    payload,
    payload?.payload,
    payload?.data,
    payload?.event,
    payload?.payload?.payload,
    payload?.payload?.data,
    payload?.data?.payload,
  ];
}

function accountToolsEventHasKnownPayload(payload) {
  return accountToolsEventCandidates(payload).some((candidate) => (
    candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
      && (
        candidate.contract === "diffforge.skills_doc.v1"
        || candidate.contract === "diffforge.account_clis.v1"
        || candidate.contract === "diffforge.account_mcps.v1"
        || candidate.kind === "account_cli_changed"
        || candidate.kind === "account_mcp_changed"
        || candidate.skill
        || candidate.skill_units
        || candidate.skillUnits
        || candidate.ops
        || candidate.delta === true
        || candidate.skills?.skill_units
        || candidate.skills?.skillUnits
        || candidate.clis
        || candidate.mcps
        || candidate.servers
      )
  ));
}

function accountToolsSkillPayloadIsFull(payload) {
  return accountToolsEventCandidates(payload).some((candidate) => (
    candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
      && (
        candidate.authoritative === true
        || candidate.snapshot_full === true
        || candidate.snapshotFull === true
      )
  ));
}

function accountToolsSkillUnitsFromEventPayload(payload) {
  const candidates = accountToolsEventCandidates(payload);
  const units = [];
  const pushUnit = (unit, removed = false) => {
    if (!unit || typeof unit !== "object" || Array.isArray(unit)) return;
    units.push(removed ? { ...unit, current: false, deleted: true } : unit);
  };
  const pushOps = (ops) => {
    (Array.isArray(ops) ? ops : []).forEach((op) => {
      if (!op || typeof op !== "object" || Array.isArray(op)) return;
      const kind = text(op.op || op.operation || op.action).toLowerCase();
      const removed = ["d", "delete", "remove", "removed", "tombstone"].includes(kind);
      pushUnit(op.skill || op.unit || op.skill_unit || op.skillUnit || op, removed);
    });
  };
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const contract = candidate.contract;
    pushUnit(candidate.skill);
    (candidate.skill_units || candidate.skillUnits || []).forEach((unit) => pushUnit(unit));
    (candidate.removed_skill_units || candidate.removedSkillUnits || []).forEach((unit) => pushUnit(unit, true));
    pushOps(candidate.ops);
    const skills = candidate.skills;
    if (skills && typeof skills === "object" && !Array.isArray(skills)) {
      (skills.skill_units || skills.skillUnits || []).forEach((unit) => pushUnit(unit));
      (skills.removed_skill_units || skills.removedSkillUnits || []).forEach((unit) => pushUnit(unit, true));
      pushOps(skills.ops);
    }
    if (contract === "diffforge.skills_doc.v1") {
      const nested = candidate.payload?.skill || candidate.data?.skill;
      pushUnit(nested);
    }
  }
  const byId = new Map();
  units.forEach((unit) => {
    const id = text(unit?.skill_id || unit?.skillId || unit?.id);
    if (id) byId.set(id, unit);
  });
  return Array.from(byId.values());
}

function applyAccountSkillUnits(units, { replace = false } = {}) {
  if (!Array.isArray(units) || (!units.length && !replace)) return false;
  workspaceToolsStore.skillsFetchedAtMs = Date.now();
  applyAccountSkills(replace ? skillsFromUnits(units) : mergeSkillUnits(workspaceToolsStore.skills, units));
  return true;
}

async function loadAccountSkills({ force = false } = {}) {
  if (inFlightSkillsLoad) return inFlightSkillsLoad;
  const now = Date.now();
  if (!force
    && workspaceToolsStore.skillsLoaded
    && now - workspaceToolsStore.skillsFetchedAtMs < SKILLS_REVALIDATE_MIN_MS) {
    return undefined;
  }
  const load = (async () => {
    try {
      const tools = await invoke("cloud_mcp_get_account_skills");
      workspaceToolsStore.skillsFetchedAtMs = Date.now();
      const units = accountToolsSkillUnitsFromEventPayload(tools);
      applyAccountSkills(skillsFromUnits(units));
    } catch {
      // Offline or transient failure: keep cached entries, leave "loading".
      if (!workspaceToolsStore.skillsLoaded) {
        applyAccountSkills([]);
      }
    } finally {
      inFlightSkillsLoad = null;
    }
  })();
  inFlightSkillsLoad = load;
  return load;
}

function refreshKnownArchitectureRepos() {
  workspaceToolsStore.knownRepos.forEach((label, repoPath) => {
    void loadArchitecturesForRepo(repoPath, label);
  });
}

function wireArchitectureChangeEvents() {
  if (architectureEventsWired) return;
  architectureEventsWired = true;
  ARCHITECTURE_CHANGE_EVENTS.forEach((eventName) => {
    void listen(eventName, () => {
      if (architectureEventTimer) window.clearTimeout(architectureEventTimer);
      architectureEventTimer = window.setTimeout(() => {
        architectureEventTimer = 0;
        refreshKnownArchitectureRepos();
      }, ARCHITECTURE_EVENT_DEBOUNCE_MS);
    }).catch(() => {
      // Event wiring is best-effort; mount revalidation still keeps data fresh.
    });
  });
}

function wireAccountToolsChangeEvents() {
  if (accountToolsEventsWired) return;
  accountToolsEventsWired = true;
  ACCOUNT_TOOLS_CHANGE_EVENTS.forEach((eventName) => {
    void listen(eventName, (event) => {
      const skillUnits = accountToolsSkillUnitsFromEventPayload(event?.payload);
      const replace = accountToolsSkillPayloadIsFull(event?.payload);
      if (applyAccountSkillUnits(skillUnits, { replace })) {
        return;
      }
      if (accountToolsEventHasKnownPayload(event?.payload)) {
        return;
      }
      if (accountToolsEventTimer) window.clearTimeout(accountToolsEventTimer);
      accountToolsEventTimer = window.setTimeout(() => {
        accountToolsEventTimer = 0;
        void loadAccountSkills({ force: true });
      }, ARCHITECTURE_EVENT_DEBOUNCE_MS);
    }).catch(() => {
      // Event wiring is best-effort; mount revalidation still keeps data fresh.
    });
  });
}

/** Serve-from-cache plus silent revalidate for the given workspace repos. */
export function ensureWorkspaceToolsFresh(repoDescriptors) {
  wireArchitectureChangeEvents();
  wireAccountToolsChangeEvents();
  const descriptors = Array.isArray(repoDescriptors) ? repoDescriptors : [];
  const activeRepos = new Set();
  descriptors.forEach(({ repoPath, label }) => {
    const cleaned = text(repoPath);
    if (!cleaned) return;
    activeRepos.add(cleaned);
    workspaceToolsStore.knownRepos.set(cleaned, text(label, cleaned.split(/[\\/]/u).pop()));
    void loadArchitecturesForRepo(cleaned, workspaceToolsStore.knownRepos.get(cleaned));
  });
  workspaceToolsStore.knownRepos.forEach((_label, repoPath) => {
    if (activeRepos.has(repoPath)) return;
    workspaceToolsStore.knownRepos.delete(repoPath);
    workspaceToolsStore.architecturesByRepo.delete(repoPath);
    workspaceToolsStore.archAttemptedRepos.delete(repoPath);
  });
  void loadAccountSkills();
}

/** Prefetch when the orchestrator panel mounts so the first tab open is instant. */
export function warmWorkspaceTools(coordinationTargets, rootDirectory) {
  ensureWorkspaceToolsFresh(workspaceToolsRepoDescriptors(coordinationTargets, rootDirectory));
}

/** Push locally loaded/saved account skill units into the Tools cache. */
export function noteAccountSkillUnits(skills) {
  workspaceToolsStore.skillsFetchedAtMs = Date.now();
  applyAccountSkills(Array.isArray(skills) ? skills : []);
}

export function subscribeWorkspaceTools(listener) {
  workspaceToolsListeners.add(listener);
  wireArchitectureChangeEvents();
  wireAccountToolsChangeEvents();
  return () => {
    workspaceToolsListeners.delete(listener);
  };
}

export function getWorkspaceToolsVersion() {
  return workspaceToolsStore.version;
}

export function getWorkspaceToolsArchitectures(repoDescriptors) {
  const items = [];
  (Array.isArray(repoDescriptors) ? repoDescriptors : []).forEach(({ repoPath }) => {
    const cached = workspaceToolsStore.architecturesByRepo.get(text(repoPath));
    if (cached?.length) items.push(...cached);
  });
  return items;
}

export function getWorkspaceToolsSkills() {
  return workspaceToolsStore.skillsEntries;
}

export function hasWorkspaceToolsLoaded(repoDescriptors) {
  if (!workspaceToolsStore.skillsLoaded) return false;
  return (Array.isArray(repoDescriptors) ? repoDescriptors : [])
    .every(({ repoPath }) => workspaceToolsStore.archAttemptedRepos.has(text(repoPath)));
}
