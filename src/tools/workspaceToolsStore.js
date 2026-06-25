import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  ACCOUNT_DOCUMENTS_CONTRACT,
  accountDocumentStorageKey,
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
const ACCOUNT_DOCUMENT_DRAFT_STORAGE_KEY = "diffforge.tools.activeDocumentDraft.v1";
const ARCHITECTURE_CHANGE_EVENTS = [
  "architecture-store-changed",
];
const ACCOUNT_TOOLS_CHANGE_EVENTS = [
  "cloud-mcp-account-documents-updated",
];
const ACCOUNT_DOCUMENT_DRAFT_CHANGE_EVENTS = [
  "cloud-mcp-account-document-draft-updated",
];

const workspaceToolsStore = {
  architecturesByRepo: new Map(), // repoPath -> [{ graphId, repoLabel, repoPath, title }]
  archAttemptedRepos: new Set(),
  activeDocumentDraftKey: "",
  documentDrafts: new Map(),
  documentDraftLoaded: false,
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
let accountDocumentDraftEventsWired = false;
let architectureEventTimer = 0;
let accountToolsEventTimer = 0;

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function documentDisplayLeaf(value) {
  const raw = text(value);
  if (!raw) return "";
  const cleaned = raw.startsWith("draft:") ? raw.slice("draft:".length) : raw;
  const leaf = cleaned.split(/[\\/]/u).filter(Boolean).pop() || cleaned;
  return leaf.replace(/\.(?:md|markdown|arch)$/iu, "").trim();
}

function workspaceToolsDocumentDraftTitle(draft) {
  const explicit = text(draft?.title || draft?.name || draft?.label);
  if (explicit) return explicit.replace(/\.(?:md|markdown|arch)$/iu, "").trim() || explicit;
  return documentDisplayLeaf(
    draft?.fileName
      || draft?.file_name
      || draft?.pathKey
      || draft?.path_key
      || draft?.filePath
      || draft?.file_path
      || draft?.documentKey
      || draft?.document_key
      || draft?.doc_id
      || draft?.document_id
      || draft?.id,
  );
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
}

function readWorkspaceToolsDocumentDraftsFromStorage() {
  if (typeof window === "undefined") return { activeDocumentDraftKey: "", drafts: [] };
  try {
    const raw = window.localStorage?.getItem(ACCOUNT_DOCUMENT_DRAFT_STORAGE_KEY);
    if (!raw) return { activeDocumentDraftKey: "", drafts: [] };
    const parsed = JSON.parse(raw);
    if (!parsed) return { activeDocumentDraftKey: "", drafts: [] };
    if (Array.isArray(parsed)) {
      return {
        activeDocumentDraftKey: "",
        drafts: parsed.filter((draft) => draft && typeof draft === "object" && !Array.isArray(draft)),
      };
    }
    if (typeof parsed !== "object") return { activeDocumentDraftKey: "", drafts: [] };
    if (Array.isArray(parsed.drafts)) {
      return {
        activeDocumentDraftKey: text(parsed.activeDocumentDraftKey || parsed.active_document_draft_key),
        drafts: parsed.drafts.filter((draft) => draft && typeof draft === "object" && !Array.isArray(draft)),
      };
    }
    return {
      activeDocumentDraftKey: "",
      drafts: [parsed],
    };
  } catch {
    return { activeDocumentDraftKey: "", drafts: [] };
  }
}

function writeWorkspaceToolsDocumentDraftsToStorage() {
  if (typeof window === "undefined") return;
  try {
    const drafts = Array.from(workspaceToolsStore.documentDrafts.values());
    if (!drafts.length) {
      window.localStorage?.removeItem(ACCOUNT_DOCUMENT_DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage?.setItem(ACCOUNT_DOCUMENT_DRAFT_STORAGE_KEY, JSON.stringify({
      activeDocumentDraftKey: workspaceToolsStore.activeDocumentDraftKey,
      drafts,
    }));
  } catch {
    // Draft persistence is best-effort; the in-memory copy still survives tab switches.
  }
}

function workspaceToolsDocumentDraftMapKey(draft) {
  const identity = workspaceToolsDocumentDraftIdentity(draft);
  return identity.draftPath
    || (identity.draftId ? `draft-id:${identity.draftId}` : "")
    || identity.documentKey
    || text(draft?.documentKey || draft?.document_key || accountDocumentStorageKey(draft) || draft?.id);
}

function ensureWorkspaceToolsDocumentDraftLoaded() {
  if (workspaceToolsStore.documentDraftLoaded) return;
  workspaceToolsStore.documentDraftLoaded = true;
  const stored = readWorkspaceToolsDocumentDraftsFromStorage();
  const storedDrafts = Array.isArray(stored) ? stored : stored?.drafts;
  (Array.isArray(storedDrafts) ? storedDrafts : []).forEach((draft) => {
    const normalized = normalizeWorkspaceToolsDocumentDraft(draft);
    const key = workspaceToolsDocumentDraftMapKey(normalized);
    if (!normalized || !key) return;
    workspaceToolsStore.documentDrafts.set(key, normalized);
  });
  const storedActiveKey = Array.isArray(stored) ? "" : text(stored?.activeDocumentDraftKey || stored?.active_document_draft_key);
  if (storedActiveKey && workspaceToolsStore.documentDrafts.has(storedActiveKey)) {
    workspaceToolsStore.activeDocumentDraftKey = storedActiveKey;
  }
  if (!workspaceToolsStore.activeDocumentDraftKey && workspaceToolsStore.documentDrafts.size) {
    workspaceToolsStore.activeDocumentDraftKey = Array.from(workspaceToolsStore.documentDrafts.keys()).at(-1) || "";
  }
}

function normalizeWorkspaceToolsDocumentDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  const title = workspaceToolsDocumentDraftTitle(draft);
  const content = String(draft.content ?? draft.content_md ?? draft.contentMd ?? draft.body ?? "");
  const documentKey = text(draft.documentKey || draft.document_key || accountDocumentStorageKey(draft) || draft.id);
  if (!documentKey && !title && !content) return null;
  return {
    ...clonePlainObject(draft),
    content,
    documentKey,
    draft: true,
    isDraft: true,
    rowType: "document",
    syncStatus: "draft",
    title: title || "Untitled document",
    updatedAtMs: Date.now(),
  };
}

function objectHasValue(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined && object[key] !== null;
}

export function workspaceToolsDocumentDraftHasContentPayload(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  if (draft.hasContentPayload === false || draft.has_content_payload === false) {
    return false;
  }
  return objectHasValue(draft, "content_md")
    || objectHasValue(draft, "contentMd")
    || objectHasValue(draft, "body")
    || objectHasValue(draft, "content")
    || draft.hasContentPayload === true
    || draft.has_content_payload === true;
}

function normalizedDraftDocumentIdentityKey(value) {
  const cleaned = text(value);
  return cleaned.startsWith("draft:") ? cleaned.slice("draft:".length) : cleaned;
}

function workspaceToolsDocumentDraftDocumentKeys(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return [];
  const keys = [
    draft.documentKey,
    draft.document_key,
    accountDocumentStorageKey(draft),
    draft.pathKey,
    draft.path_key,
    draft.filePath,
    draft.file_path,
    draft.doc_id,
    draft.document_id,
    draft.id,
  ].map(normalizedDraftDocumentIdentityKey).filter(Boolean);
  return Array.from(new Set(keys));
}

function workspaceToolsDocumentDraftIdentity(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return { documentKey: "", documentKeys: [], draftId: "", draftPath: "" };
  }
  const documentKeys = workspaceToolsDocumentDraftDocumentKeys(draft);
  return {
    documentKey: documentKeys[0] || "",
    documentKeys,
    draftId: text(draft.draftId || draft.draft_id),
    draftPath: text(draft.draftPath || draft.draft_path),
  };
}

function workspaceToolsDocumentDraftClearCandidates(input) {
  const values = [];
  const add = (value) => {
    const raw = text(value);
    if (!raw) return;
    values.push(raw);
    const withoutDraftPrefix = raw.startsWith("draft:") ? raw.slice("draft:".length) : raw;
    if (withoutDraftPrefix && withoutDraftPrefix !== raw) values.push(withoutDraftPrefix);
    const leaf = raw.split(/[\\/]/u).filter(Boolean).pop();
    if (leaf && leaf !== raw) values.push(leaf);
  };
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      [
        value.documentKey,
        value.document_key,
        accountDocumentStorageKey(value),
        value.pathKey,
        value.path_key,
        value.filePath,
        value.file_path,
        value.doc_id,
        value.document_id,
        value.id,
        value.draftPath,
        value.draft_path,
        value.draftId,
        value.draft_id,
      ].forEach(add);
      return;
    }
    add(value);
  };
  visit(input);
  return Array.from(new Set(values));
}

export function workspaceToolsDocumentDraftIdentityMatches(currentDraft, incomingDraft) {
  const current = workspaceToolsDocumentDraftIdentity(currentDraft);
  const incoming = workspaceToolsDocumentDraftIdentity(incomingDraft);
  return Boolean(
    (current.draftPath && incoming.draftPath && current.draftPath === incoming.draftPath)
      || (current.draftId && incoming.draftId && current.draftId === incoming.draftId)
      || current.documentKeys.some((key) => incoming.documentKeys.includes(key)),
  );
}

export function mergeWorkspaceToolsDocumentDraft(currentDraft, incomingDraft) {
  const incomingHasContentPayload = workspaceToolsDocumentDraftHasContentPayload(incomingDraft);
  const incoming = normalizeWorkspaceToolsDocumentDraft(incomingDraft);
  if (!incoming) return null;
  const current = normalizeWorkspaceToolsDocumentDraft(currentDraft);
  if (!current || !workspaceToolsDocumentDraftIdentityMatches(current, incomingDraft || incoming)) {
    return incoming;
  }

  const merged = {
    ...current,
    ...incoming,
    documentKey: incoming.documentKey || current.documentKey,
    draft: true,
    isDraft: true,
    rowType: "document",
    syncStatus: "draft",
  };

  if (!incomingHasContentPayload) {
    merged.content = String(current.content ?? "");
  }

  return merged;
}

function matchingWorkspaceToolsDocumentDraftKey(incomingDraft) {
  const incoming = normalizeWorkspaceToolsDocumentDraft(incomingDraft);
  if (!incoming) return "";
  const explicitKey = workspaceToolsDocumentDraftMapKey(incoming);
  if (!workspaceToolsStore.documentDrafts.size) return explicitKey;
  for (const [key, current] of workspaceToolsStore.documentDrafts.entries()) {
    if (workspaceToolsDocumentDraftIdentityMatches(current, incoming)) {
      return key;
    }
  }
  return explicitKey;
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
    skill.pathKey,
    skill.rowType,
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
    const id = accountDocumentStorageKey(unit) || text(unit?.path_key || unit?.doc_id || unit?.document_id || unit?.id);
    if (id) byId.set(id, unit);
  });
  return Array.from(byId.values());
}

function draftEventCandidateWithMetadata(candidate, document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  const merged = { ...clonePlainObject(document) };
  [
    "base_content_hash",
    "baseContentHash",
    "canonical_local_path",
    "canonicalLocalPath",
    "collection",
    "content_hash",
    "contentHash",
    "document_id",
    "documentId",
    "document_key",
    "documentKey",
    "draft_id",
    "draftId",
    "draft_path",
    "draftPath",
    "file_path",
    "filePath",
    "path_key",
    "pathKey",
    "scope_key",
    "scopeKey",
  ].forEach((key) => {
    if (!objectHasValue(merged, key) && objectHasValue(candidate, key)) {
      merged[key] = candidate[key];
    }
  });
  ["body", "content", "content_md", "contentMd"].forEach((key) => {
    if (!objectHasValue(merged, key) && objectHasValue(candidate, key)) {
      merged[key] = candidate[key];
    }
  });
  return merged;
}

function accountDocumentDraftsFromEventPayload(payload) {
  const drafts = [];
  accountToolsEventCandidates(payload).forEach((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    [
      candidate.document,
      candidate.draft,
      candidate.draftDocument,
      candidate.draft_document,
    ].forEach((document) => {
      const draft = draftEventCandidateWithMetadata(candidate, document);
      if (draft) drafts.push(draft);
    });
    ["documents", "items"].forEach((key) => {
      const documents = Array.isArray(candidate[key]) ? candidate[key] : [];
      documents.forEach((document) => {
        const draft = draftEventCandidateWithMetadata(candidate, document);
        if (draft) drafts.push(draft);
      });
    });
    accountDocumentUnitsFromPayload(candidate).forEach((unit) => {
      const draft = draftEventCandidateWithMetadata(candidate, unit);
      if (draft) drafts.push(draft);
    });
    const identity = workspaceToolsDocumentDraftIdentity(candidate);
    if (identity.draftPath || identity.draftId || identity.documentKey) {
      drafts.push(candidate);
    }
  });
  return drafts;
}

function accountDocumentDraftEventClearsDraft(payload, draft) {
  return accountToolsEventCandidates(payload).some((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    if (!workspaceToolsDocumentDraftIdentityMatches(draft, candidate)) return false;
    const kind = text(candidate.kind || candidate.event_kind || candidate.c).toLowerCase();
    return candidate.deleted === true
      || candidate.discarded === true
      || kind === "account_document_draft_discarded"
      || kind === "doc.draft.discarded";
  });
}

export function applyWorkspaceToolsDocumentDraftEventPayload(payload) {
  ensureWorkspaceToolsDocumentDraftLoaded();
  const incomingDrafts = accountDocumentDraftsFromEventPayload(payload);
  if (!incomingDrafts.length) return false;
  const previousKey = JSON.stringify(Array.from(workspaceToolsStore.documentDrafts.entries()));
  incomingDrafts.forEach((matchingDraft) => {
    const key = matchingWorkspaceToolsDocumentDraftKey(matchingDraft);
    if (!key) return;
    const current = workspaceToolsStore.documentDrafts.get(key);
    if (accountDocumentDraftEventClearsDraft(payload, matchingDraft)) {
      for (const [currentKey, currentDraft] of workspaceToolsStore.documentDrafts.entries()) {
        if (currentKey === key || workspaceToolsDocumentDraftIdentityMatches(currentDraft, matchingDraft)) {
          workspaceToolsStore.documentDrafts.delete(currentKey);
        }
      }
      if (!workspaceToolsStore.documentDrafts.has(workspaceToolsStore.activeDocumentDraftKey)) {
        workspaceToolsStore.activeDocumentDraftKey = Array.from(workspaceToolsStore.documentDrafts.keys()).at(-1) || "";
      }
      return;
    }
    const merged = mergeWorkspaceToolsDocumentDraft(current, matchingDraft);
    if (merged) {
      const nextKey = workspaceToolsDocumentDraftMapKey(merged) || key;
      if (nextKey !== key) {
        workspaceToolsStore.documentDrafts.delete(key);
      }
      workspaceToolsStore.documentDrafts.set(nextKey, merged);
      if (!workspaceToolsStore.activeDocumentDraftKey) {
        workspaceToolsStore.activeDocumentDraftKey = nextKey;
      }
    }
  });
  writeWorkspaceToolsDocumentDraftsToStorage();
  if (previousKey !== JSON.stringify(Array.from(workspaceToolsStore.documentDrafts.entries()))) {
    notifyWorkspaceToolsListeners();
  }
  return true;
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
      applyAccountSkills(mergeSkillUnits(workspaceToolsStore.skills, localUnits));
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
      applyAccountSkills(mergeSkillUnits(workspaceToolsStore.skills, units));
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

function wireAccountDocumentDraftChangeEvents() {
  if (accountDocumentDraftEventsWired) return;
  accountDocumentDraftEventsWired = true;
  ACCOUNT_DOCUMENT_DRAFT_CHANGE_EVENTS.forEach((eventName) => {
    void listen(eventName, (event) => {
      applyWorkspaceToolsDocumentDraftEventPayload(event?.payload);
    }).catch(() => {
      // Event wiring is best-effort; local draft persistence remains authoritative.
    });
  });
}

/** Serve-from-cache plus silent revalidate for the given workspace repos. */
export function ensureWorkspaceToolsFresh(repoDescriptors) {
  wireAccountToolsChangeEvents();
  wireAccountDocumentDraftChangeEvents();
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

/** Background-safe account-doc refresh for app-control MCP inventory tools. */
export async function refreshWorkspaceToolsAccountSkills({ force = false } = {}) {
  wireAccountToolsChangeEvents();
  wireAccountDocumentDraftChangeEvents();
  await loadAccountSkills({ force: force === true });
  return getWorkspaceToolsAccountSkills();
}

/** Push locally loaded/saved account skill units into the Tools cache. */
export function noteAccountSkillUnits(skills) {
  workspaceToolsStore.skillsFetchedAtMs = Date.now();
  applyAccountSkills(Array.isArray(skills) ? skills : []);
}

export function getWorkspaceToolsDocumentDraft() {
  ensureWorkspaceToolsDocumentDraftLoaded();
  const key = workspaceToolsStore.activeDocumentDraftKey;
  const draft = key ? workspaceToolsStore.documentDrafts.get(key) : null;
  if (draft) return clonePlainObject(draft);
  const fallback = Array.from(workspaceToolsStore.documentDrafts.values()).at(-1) || null;
  return clonePlainObject(fallback);
}

export function getWorkspaceToolsDocumentDrafts() {
  ensureWorkspaceToolsDocumentDraftLoaded();
  return Array.from(workspaceToolsStore.documentDrafts.values())
    .map(clonePlainObject)
    .filter(Boolean);
}

export function setWorkspaceToolsDocumentDraft(draft, options = {}) {
  ensureWorkspaceToolsDocumentDraftLoaded();
  const key = matchingWorkspaceToolsDocumentDraftKey(draft);
  const currentDraft = key ? workspaceToolsStore.documentDrafts.get(key) : null;
  const nextDraft = mergeWorkspaceToolsDocumentDraft(currentDraft, draft);
  const previousKey = JSON.stringify(Array.from(workspaceToolsStore.documentDrafts.entries()));
  if (nextDraft) {
    const nextKey = workspaceToolsDocumentDraftMapKey(nextDraft) || key;
    if (key && nextKey !== key) {
      workspaceToolsStore.documentDrafts.delete(key);
    }
    workspaceToolsStore.documentDrafts.set(nextKey, nextDraft);
    if (options.activate !== false) {
      workspaceToolsStore.activeDocumentDraftKey = nextKey;
    } else if (!workspaceToolsStore.activeDocumentDraftKey) {
      workspaceToolsStore.activeDocumentDraftKey = nextKey;
    }
  }
  writeWorkspaceToolsDocumentDraftsToStorage();
  if (previousKey !== JSON.stringify(Array.from(workspaceToolsStore.documentDrafts.entries()))) {
    notifyWorkspaceToolsListeners();
  }
}

export function clearWorkspaceToolsDocumentDraft(documentKey = "") {
  ensureWorkspaceToolsDocumentDraftLoaded();
  if (!workspaceToolsStore.documentDrafts.size) return;
  const requestedKeys = workspaceToolsDocumentDraftClearCandidates(documentKey);
  const previousKey = JSON.stringify(Array.from(workspaceToolsStore.documentDrafts.entries()));
  if (!requestedKeys.length) {
    workspaceToolsStore.documentDrafts.clear();
    workspaceToolsStore.activeDocumentDraftKey = "";
  } else {
    for (const [key, current] of workspaceToolsStore.documentDrafts.entries()) {
      const matched = requestedKeys.some((requestedKey) => (
        key === requestedKey
          || workspaceToolsDocumentDraftIdentityMatches(current, { documentKey: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { document_key: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { pathKey: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { path_key: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { filePath: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { file_path: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { draftPath: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { draft_path: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { draftId: requestedKey })
          || workspaceToolsDocumentDraftIdentityMatches(current, { draft_id: requestedKey })
      ));
      if (matched) {
        workspaceToolsStore.documentDrafts.delete(key);
      }
    }
    if (!workspaceToolsStore.documentDrafts.has(workspaceToolsStore.activeDocumentDraftKey)) {
      workspaceToolsStore.activeDocumentDraftKey = Array.from(workspaceToolsStore.documentDrafts.keys()).at(-1) || "";
    }
  }
  writeWorkspaceToolsDocumentDraftsToStorage();
  if (previousKey !== JSON.stringify(Array.from(workspaceToolsStore.documentDrafts.entries()))) {
    notifyWorkspaceToolsListeners();
  }
}

export function subscribeWorkspaceTools(listener) {
  workspaceToolsListeners.add(listener);
  wireAccountToolsChangeEvents();
  wireAccountDocumentDraftChangeEvents();
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
