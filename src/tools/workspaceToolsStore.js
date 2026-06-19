import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { parseSkillsLibrary, serializeSkillsLibrary } from "./skillsLibrary.js";

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
  "cloud-mcp-account-tools-updated",
];

const workspaceToolsStore = {
  architecturesByRepo: new Map(), // repoPath -> [{ graphId, repoLabel, repoPath, title }]
  archAttemptedRepos: new Set(),
  knownRepos: new Map(), // repoPath -> label; event refreshes re-fetch all of these
  skillsEntries: [],
  skillsMd: "",
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

export function parseSkillsEntries(skillsMd) {
  const content = text(skillsMd);
  if (!content) return [];
  const lines = content.split("\n");
  const entries = [];
  let current = null;
  lines.forEach((line) => {
    // Structured skill metadata from the Tools tab library; not todo content.
    if (/^<!--\s*diffforge-skill\b.*-->\s*$/u.test(line.trim())) return;
    const heading = line.match(/^#{1,3}\s+(.+)$/u);
    if (heading) {
      if (current && (current.title || current.body.trim())) entries.push(current);
      current = { title: heading[1].trim(), body: "" };
      return;
    }
    if (!current) current = { title: "", body: "" };
    current.body += `${line}\n`;
  });
  if (current && (current.title || current.body.trim())) entries.push(current);
  const named = entries.filter((entry) => entry.title);
  if (named.length) return named;
  return [{ title: "SKILLS.md", body: content }];
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

function applyAccountSkillsMarkdown(skillsMd) {
  const normalized = String(skillsMd ?? "");
  const changed = !workspaceToolsStore.skillsLoaded || normalized !== workspaceToolsStore.skillsMd;
  workspaceToolsStore.skillsMd = normalized;
  workspaceToolsStore.skillsEntries = parseSkillsEntries(normalized);
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
        candidate.contract === "diffforge.account_skills.v1"
        || candidate.contract === "diffforge.account_clis.v1"
        || candidate.contract === "diffforge.account_mcps.v1"
        || candidate.kind === "account_skill_changed"
        || candidate.kind === "account_cli_changed"
        || candidate.kind === "account_mcp_changed"
        || candidate.event_kind === "account_skill_changed"
        || candidate.eventKind === "account_skill_changed"
        || candidate.skill
        || candidate.skill_units
        || candidate.skillUnits
        || candidate.delta === true
        || candidate.skills
        || candidate.clis
        || candidate.mcps
        || candidate.servers
      )
  ));
}

function accountToolsSkillsFromEventPayload(payload) {
  const candidates = accountToolsEventCandidates(payload);
  for (const candidate of candidates) {
    const skills = candidate?.skills || candidate?.account_skills || candidate?.accountSkills;
    const skillsMd = skills?.skills_md ?? skills?.skillsMd;
    if (skillsMd != null) {
      return String(skillsMd);
    }
  }
  return null;
}

function accountToolsSkillUnitFromEventPayload(payload) {
  const candidates = accountToolsEventCandidates(payload);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const contract = candidate.contract;
    const kind = candidate.kind || candidate.event_kind || candidate.eventKind;
    const skill = candidate.skill || candidate.account_skill || candidate.accountSkill;
    if (skill && typeof skill === "object" && !Array.isArray(skill)) {
      return skill;
    }
    const units = candidate.skill_units || candidate.skillUnits;
    if (Array.isArray(units) && units.length) {
      return units[0];
    }
    if (contract === "diffforge.account_skills.v1" || kind === "account_skill_changed") {
      const nested = candidate.payload?.skill || candidate.data?.skill;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return nested;
      }
    }
  }
  return null;
}

function skillFromUnit(unit) {
  const id = text(unit?.skill_id || unit?.skillId || unit?.id);
  if (!id) return null;
  return {
    content: String(unit?.content_md ?? unit?.contentMd ?? unit?.content ?? ""),
    description: text(unit?.description || unit?.summary),
    icon: text(unit?.icon),
    id,
    source: text(unit?.source, "custom"),
    title: text(unit?.title || unit?.name || unit?.label, id),
    tone: text(unit?.tone),
    updatedAt: text(unit?.updated_at || unit?.updatedAt),
  };
}

function applyAccountSkillUnit(unit) {
  const skill = skillFromUnit(unit);
  if (!skill) return false;
  const library = parseSkillsLibrary(workspaceToolsStore.skillsMd);
  const removed = unit?.deleted === true || unit?.current === false || unit?.tombstoned === true;
  const nextSkills = removed
    ? library.skills.filter((entry) => entry.id !== skill.id)
    : [
      ...library.skills.filter((entry) => entry.id !== skill.id),
      skill,
    ].sort((left, right) => left.title.localeCompare(right.title));
  const nextMd = serializeSkillsLibrary(nextSkills, library.preamble);
  workspaceToolsStore.skillsFetchedAtMs = Date.now();
  applyAccountSkillsMarkdown(nextMd);
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
      const tools = await invoke("cloud_mcp_get_account_tools");
      workspaceToolsStore.skillsFetchedAtMs = Date.now();
      applyAccountSkillsMarkdown(text(tools?.skills?.skills_md ?? tools?.skills?.skillsMd));
    } catch {
      // Offline or transient failure: keep cached entries, leave "loading".
      if (!workspaceToolsStore.skillsLoaded) {
        applyAccountSkillsMarkdown("");
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
      const skillsMd = accountToolsSkillsFromEventPayload(event?.payload);
      if (skillsMd != null) {
        workspaceToolsStore.skillsFetchedAtMs = Date.now();
        applyAccountSkillsMarkdown(skillsMd);
        return;
      }
      const skillUnit = accountToolsSkillUnitFromEventPayload(event?.payload);
      if (skillUnit && applyAccountSkillUnit(skillUnit)) {
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

/** Push locally loaded/saved SKILLS.md into the cache (Tools workspace view). */
export function noteAccountSkillsMarkdown(skillsMd) {
  workspaceToolsStore.skillsFetchedAtMs = Date.now();
  applyAccountSkillsMarkdown(skillsMd);
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
