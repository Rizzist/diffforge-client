import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  ACCOUNT_DOCUMENTS_CONTRACT,
  accountDocumentUnitsFromPayload,
  mergeSkillUnits,
  skillsFromUnits,
  skillsToToolEntries,
} from "./skillsLibrary.js";

// App-level cache for account docs exposed to the workspace tools panel. Docs
// are globally synced data, so they live at module scope and survive mount
// cycles while the store silently revalidates and listens for change events.

const SKILLS_REVALIDATE_MIN_MS = 20_000;
const ACCOUNT_DOCS_REVALIDATE_TIMEOUT_MS = 4_500;
const ACCOUNT_TOOLS_EVENT_DEBOUNCE_MS = 500;
const ARCHITECTURE_CHANGE_EVENTS = [
  "architecture-store-changed",
];
const ACCOUNT_TOOLS_CHANGE_EVENTS = [
  "cloud-mcp-account-documents-updated",
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
        candidate.contract === ACCOUNT_DOCUMENTS_CONTRACT
        || candidate.contract === "diffforge.account_clis.v1"
        || candidate.contract === "diffforge.account_mcps.v1"
        || candidate.document
        || candidate.documents
        || candidate.docs
        || candidate.items
        || candidate.kind === "account_cli_changed"
        || candidate.kind === "account_mcp_changed"
        || candidate.ops
        || candidate.delta === true
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
  const units = accountDocumentUnitsFromPayload(payload).filter(Boolean);
  const byId = new Map();
  units.forEach((unit) => {
    const id = text(unit?.doc_id || unit?.document_id || unit?.id);
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
      const localTools = await invoke("cloud_mcp_get_account_documents", {
        request: { limit: 2000, local_only: true },
      });
      const localUnits = accountDocumentUnitsFromPayload(localTools);
      applyAccountSkills(skillsFromUnits(localUnits));
    } catch {
      if (!workspaceToolsStore.skillsLoaded) {
        applyAccountSkills([]);
      }
    }

    try {
      const tools = await invoke("cloud_mcp_get_account_documents", {
        request: {
          limit: 2000,
          cloud_timeout_ms: ACCOUNT_DOCS_REVALIDATE_TIMEOUT_MS,
        },
      });
      workspaceToolsStore.skillsFetchedAtMs = Date.now();
      const units = accountDocumentUnitsFromPayload(tools);
      applyAccountSkills(skillsFromUnits(units));
    } catch {
      // Offline or transient failure: keep the local cache. Docs are account
      // data, not a tab-scoped loading surface.
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
      }, ACCOUNT_TOOLS_EVENT_DEBOUNCE_MS);
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
      }, ACCOUNT_TOOLS_EVENT_DEBOUNCE_MS);
    }).catch(() => {
      // Event wiring is best-effort; mount revalidation still keeps data fresh.
    });
  });
}

/** Serve-from-cache plus silent revalidate for the given workspace repos. */
export function ensureWorkspaceToolsFresh(repoDescriptors) {
  wireAccountToolsChangeEvents();
  const descriptors = Array.isArray(repoDescriptors) ? repoDescriptors : [];
  const activeRepos = new Set();
  descriptors.forEach(({ repoPath, label }) => {
    const cleaned = text(repoPath);
    if (!cleaned) return;
    activeRepos.add(cleaned);
    workspaceToolsStore.knownRepos.set(cleaned, text(label, cleaned.split(/[\\/]/u).pop()));
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

export function getWorkspaceToolsAccountSkills() {
  return workspaceToolsStore.skills;
}

export function hasWorkspaceToolsLoaded(repoDescriptors) {
  void repoDescriptors;
  return workspaceToolsStore.skillsLoaded;
}
