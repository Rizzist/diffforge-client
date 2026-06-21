import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import {
  ButtonRefreshIcon,
  FileDisclosure,
  FileExplorerActions,
  FileExplorerHeader,
  FileExplorerPane,
  FileIconButton,
  FileKindIcon,
  FileRootPath,
  FilesWorkspaceSurface,
  FileTree,
  FileTreeButton,
  FileTreeEmpty,
  FileTreeItem,
  FileTreeName,
  PanelKicker,
} from "../app/appStyles.js";
import McpsWorkspaceView from "../mcps/McpsWorkspaceView.jsx";
import { CLI_CATALOG, cliInstallManager } from "./cliCatalog.js";
import { SKILLS_CATALOG, skillCliBinary, skillCliIcon } from "./skillsCatalog.js";
import {
  ACCOUNT_DOCUMENTS_CONTRACT,
  accountDocumentRequestFromSkill,
  accountDocumentStorageKey,
  accountDocumentUnitsFromPayload,
  documentExtensionForKind,
  mergeSkillUnits,
  normalizedDocumentCollection,
  normalizedDocumentKind,
  skillsFromUnits,
  skillSlug,
  skillToneColor,
} from "./skillsLibrary.js";
import { noteAccountSkillUnits } from "./workspaceToolsStore.js";

const SECTIONS = [
  { id: "docs", label: "Docs" },
  { id: "mcps", label: "MCPs" },
  { id: "clis", label: "CLIs" },
];

export const GLOBAL_MCP_DEFAULTS_SCOPE = "global-defaults";
const GLOBAL_MCP_DEFAULTS_WORKSPACE_ID = "account-global-mcp-defaults";
const SKILL_EDITOR_THEME_STORAGE_KEY = "diffforge.tools.skillEditorTheme";
const DOCUMENT_TYPE_OPTIONS = [
  { id: "skill", label: "Skill", collection: "documents", extension: "md" },
  { id: "architecture", label: "Architecture", collection: "documents", extension: "arch" },
  { id: "instruction", label: "Instruction", collection: "documents", extension: "md" },
  { id: "document", label: "Document", collection: "documents", extension: "md" },
];

function normalizedSectionId(value, fallback = "docs") {
  const normalized = text(value);
  if (["architectures", "architecture", "skills", "skill"].includes(normalized)) return "docs";
  return SECTIONS.some((entry) => entry.id === normalized) ? normalized : fallback;
}

function normalizedSkillEditorTheme(value, fallback = "dark") {
  return value === "light" || value === "dark" ? value : fallback;
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function documentTypeOption(value, collection = "documents") {
  const kind = normalizedDocumentKind(value, collection);
  return DOCUMENT_TYPE_OPTIONS.find((entry) => entry.id === kind) || DOCUMENT_TYPE_OPTIONS[0];
}

function documentTypeLabel(value, collection = "documents") {
  return documentTypeOption(value, collection).label;
}

function documentFileName(document) {
  const collection = normalizedDocumentCollection();
  const kind = normalizedDocumentKind(document?.documentKind || document?.source, collection);
  const extension = text(document?.extension, documentExtensionForKind(kind, collection));
  const id = text(document?.id || document?.documentId || document?.document_id, skillSlug(document?.title || "document"));
  const suffix = `.${extension}`;
  return id.toLowerCase().endsWith(suffix.toLowerCase()) ? id : `${id}${suffix}`;
}

function documentPreviewLine(document) {
  const contentLine = String(document?.content || "").split("\n").map((line) => line.trim()).find(Boolean);
  return text(contentLine, text(document?.localPath, `${documentTypeLabel(document?.documentKind, document?.collection)} doc`));
}

function documentEditorDraft(document) {
  const option = documentTypeOption(document?.documentKind || document?.source, document?.collection);
  const content = String(document?.content || "");
  return {
    assetId: text(document?.assetId || document?.asset_id),
    baseContent: content,
    collection: option.collection,
    content,
    contentHash: text(document?.contentHash || document?.content_hash || document?.sha256),
    documentKey: accountDocumentStorageKey(document),
    documentKind: option.id,
    extension: text(document?.extension, option.extension),
    id: text(document?.id || document?.documentId || document?.document_id),
    localPath: text(document?.localPath || document?.local_path),
    source: option.id,
    title: text(document?.title || document?.name || document?.id),
  };
}

function documentHasMaterializedContent(document) {
  const hasContentFlag = document?.hasContent !== undefined
    || document?.hasContentPayload !== undefined
    || document?.hydrated !== undefined;
  return document?.hydrated === true
    || document?.hasContent === true
    || document?.hasContentPayload === true
    || (!hasContentFlag && String(document?.content || "").length > 0);
}

function editorWithRemoteDocumentContent(current, document) {
  if (!current || !documentHasMaterializedContent(document)) return current;
  const currentKey = current.documentKey || accountDocumentStorageKey(current);
  const documentKey = accountDocumentStorageKey(document);
  if (!currentKey || currentKey !== documentKey) return current;
  const baseContent = String(current.baseContent ?? current.content ?? "");
  if (String(current.content || "") !== baseContent) return current;
  const content = String(document.content || "");
  if (
    current.content === content
    && current.contentHash === text(document.contentHash || document.content_hash || document.sha256)
    && current.localPath === text(document.localPath || document.local_path, current.localPath)
  ) {
    return current;
  }
  return {
    ...current,
    assetId: text(document.assetId || document.asset_id, current.assetId),
    baseContent: content,
    collection: normalizedDocumentCollection(),
    content,
    contentHash: text(document.contentHash || document.content_hash || document.sha256),
    documentKind: normalizedDocumentKind(document.documentKind || document.document_kind || document.source, current.collection),
    extension: text(document.extension || document.ext, current.extension),
    localPath: text(document.localPath || document.local_path, current.localPath),
    source: normalizedDocumentKind(document.documentKind || document.document_kind || document.source, current.collection),
    title: text(document.title || document.name, current.title),
  };
}

function getErrorMessage(error, fallback) {
  return error?.message || String(error || fallback || "Something went wrong.");
}

function clampProgressPercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
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
        || candidate.kind === "account_documents"
        || candidate.source === "local_account_document_cache"
      )
  ));
}

function accountToolsSkillMetaFromEventPayload(payload) {
  const meta = { error: "", revision: null, updatedAt: "", updatedBy: "" };
  const applyMeta = (source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    if (meta.revision === null && source.revision !== undefined && source.revision !== null) {
      const revision = Number(source.revision);
      if (Number.isFinite(revision)) meta.revision = revision;
    }
    meta.updatedAt = text(meta.updatedAt, text(source.updated_at || source.updatedAt));
    meta.updatedBy = text(meta.updatedBy, text(source.updated_by_device_name || source.updatedByDeviceName));
    meta.error = text(meta.error, text(source.last_sync_error || source.lastSyncError || source.error));
  };
  accountToolsEventCandidates(payload).forEach((candidate) => {
    applyMeta(candidate);
    applyMeta(candidate?.skills);
  });
  return meta;
}

function applySkillUnitsToLibrary(library, units) {
  return {
    skills: mergeSkillUnits(library?.skills || [], units),
  };
}

function replaceSkillUnitsInLibrary(units) {
  return {
    skills: skillsFromUnits(units),
  };
}

function withLocalPendingSkill(skill, localSavedAt = new Date().toISOString()) {
  return {
    ...skill,
    localSavedAt,
    pendingPush: true,
    syncStatus: "local_pending",
  };
}

function clearLocalPendingSkill(skill) {
  return {
    ...skill,
    localSavedAt: "",
    pendingPush: false,
    syncStatus: skill?.syncStatus === "local_pending" ? "" : text(skill?.syncStatus),
  };
}

function timeAgo(value) {
  const at = Date.parse(String(value || ""));
  const ms = Number.isFinite(at) ? at : Number(value) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function cliSnapshotFromStatuses(statuses) {
  return (Array.isArray(statuses) ? statuses : []).map((status) => ({
    agentId: text(status?.provider || status?.id),
    agentLabel: text(status?.label),
    installed: Boolean(status?.installed),
    authenticated: Boolean(status?.authenticated),
    version: text(status?.version),
    npmPackageVersion: text(status?.npmPackageVersion || status?.npm_package_version),
    npmLatestVersion: text(status?.npmLatestVersion || status?.npm_latest_version),
    updateAvailable: Boolean(status?.npmUpdateAvailable || status?.npm_update_available),
    activeModel: text(status?.activeModel || status?.active_model),
  }));
}

function SkillIconGlyph({ icon, title }) {
  const CliIcon = skillCliIcon(icon);
  if (CliIcon) return <CliIcon />;
  const key = String(icon || "");
  if (key.startsWith("codicon:")) {
    return <span className={`codicon codicon-${key.slice("codicon:".length)}`} />;
  }
  return <span>{text(title, "S").slice(0, 1).toUpperCase()}</span>;
}

function ToolsHydrationProgress({ placement = "panel", progress }) {
  if (!progress?.visible) return null;
  const percent = clampProgressPercent(progress.percent);
  const title = text(progress.title, "Hydrating account tools");
  const meta = text(progress.error || progress.meta, `${Math.round(percent)}%`);

  return (
    <ToolsHydrationPanel data-placement={placement} data-state={text(progress.state, "hydrating")}>
      <ToolsHydrationCopy>
        <strong>{title}</strong>
        <span>{meta}</span>
      </ToolsHydrationCopy>
      <ToolsHydrationTrack
        aria-label={title}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={meta}
        role="progressbar"
      >
        <ToolsHydrationFill style={{ width: `${percent}%` }} />
      </ToolsHydrationTrack>
    </ToolsHydrationPanel>
  );
}

export default function ToolsWorkspaceView({
  defaultWorkingDirectory = "",
  initialSection = "",
  workspaces = [],
}) {
  const [section, setSection] = useState(() => normalizedSectionId(initialSection));

  useEffect(() => {
    const nextSection = normalizedSectionId(initialSection);
    setSection((current) => (current === nextSection ? current : nextSection));
  }, [initialSection]);

  // ---- MCP scope (global defaults vs per-workspace) ----
  const [mcpScope, setMcpScope] = useState(GLOBAL_MCP_DEFAULTS_SCOPE);
  const [globalMcpDefaults, setGlobalMcpDefaults] = useState({
    error: "",
    rootDirectory: "",
    state: "loading",
    workspaceId: GLOBAL_MCP_DEFAULTS_WORKSPACE_ID,
  });

  useEffect(() => {
    let cancelled = false;
    invoke("coordination_global_mcp_defaults_root")
      .then((response) => {
        if (cancelled) return;
        const data = response?.data || response || {};
        setGlobalMcpDefaults({
          error: "",
          rootDirectory: text(data.rootDirectory || data.root_directory),
          state: "ready",
          workspaceId: text(data.workspaceId || data.workspace_id, GLOBAL_MCP_DEFAULTS_WORKSPACE_ID),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setGlobalMcpDefaults((current) => ({
          ...current,
          error: getErrorMessage(error, "Unable to resolve the global MCP defaults store."),
          state: "error",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const workspaceOptions = useMemo(() => (
    (Array.isArray(workspaces) ? workspaces : [])
      .map((workspace) => ({
        id: text(workspace?.id),
        name: text(workspace?.name, text(workspace?.id, "Workspace")),
        rootDirectory: text(workspace?.rootDirectory, defaultWorkingDirectory),
      }))
      .filter((workspace) => workspace.id)
  ), [defaultWorkingDirectory, workspaces]);

  const activeMcpScope = mcpScope !== GLOBAL_MCP_DEFAULTS_SCOPE
    && workspaceOptions.some((workspace) => workspace.id === mcpScope)
    ? mcpScope
    : GLOBAL_MCP_DEFAULTS_SCOPE;
  const activeMcpWorkspace = activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE
    ? {
      id: globalMcpDefaults.workspaceId,
      name: "Global defaults",
    }
    : workspaceOptions.find((workspace) => workspace.id === activeMcpScope);
  const activeMcpRootDirectory = activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE
    ? globalMcpDefaults.rootDirectory
    : text(activeMcpWorkspace?.rootDirectory, defaultWorkingDirectory);
  const mcpScopeReady = activeMcpScope !== GLOBAL_MCP_DEFAULTS_SCOPE
    || (globalMcpDefaults.state === "ready" && Boolean(globalMcpDefaults.rootDirectory));

  // ---- Docs (account-level markdown documents backed by per-document assets) ----
  const [skillsLibrary, setSkillsLibrary] = useState({ skills: [] });
  const [skillsRevision, setSkillsRevision] = useState(null);
  const [skillsMeta, setSkillsMeta] = useState({ updatedAt: "", updatedBy: "", offline: false });
  const [skillsState, setSkillsState] = useState("loading");
  const [skillsError, setSkillsError] = useState("");
  const [skillsHydration, setSkillsHydration] = useState({
    error: "",
    meta: "",
    percent: 0,
    state: "idle",
    title: "",
    visible: false,
  });
  const skillsHydrationRunRef = useRef(0);
  const hydratingDocKeyRef = useRef("");
  const [skillsQuery, setSkillsQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [newDocDraft, setNewDocDraft] = useState({ name: "", type: "skill" });
  // "library:<collection>:<id>" or "catalog:<id>" — selecting a document shows its contents.
  const [selectedSkillKey, setSelectedSkillKey] = useState("");
  // { id: ""|documentId, title, content } while creating/editing.
  const [skillEditor, setSkillEditor] = useState(null);
  const [skillEditorTheme, setSkillEditorTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    try {
      return normalizedSkillEditorTheme(window.localStorage?.getItem(SKILL_EDITOR_THEME_STORAGE_KEY));
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem(SKILL_EDITOR_THEME_STORAGE_KEY, skillEditorTheme);
    } catch {
      // The editor theme is cosmetic; storage failures should not block editing.
    }
  }, [skillEditorTheme]);

  // ---- CLIs ----
  const [cliStatuses, setCliStatuses] = useState([]);
  const [cliState, setCliState] = useState("loading");
  const [cliError, setCliError] = useState("");
  const [cliBusy, setCliBusy] = useState({});
  const [cliMessage, setCliMessage] = useState("");
  const cliReportedRef = useRef("");
  const [catalogChecks, setCatalogChecks] = useState({});
  const [catalogBusy, setCatalogBusy] = useState({});
  const [catalogQuery, setCatalogQuery] = useState("");

  const loadAccountTools = useCallback(async () => {
    const hydrationRunId = skillsHydrationRunRef.current + 1;
    skillsHydrationRunRef.current = hydrationRunId;
    let progressTimer = null;
    setSkillsHydration({
      error: "",
      meta: "Checking account document assets",
      percent: 6,
      runId: hydrationRunId,
      state: "hydrating",
      title: "Hydrating docs",
      visible: true,
    });
    if (typeof window !== "undefined") {
      progressTimer = window.setInterval(() => {
        setSkillsHydration((current) => {
          if (current.runId !== hydrationRunId || current.state !== "hydrating") return current;
          const nextPercent = Math.min(92, Math.max(8, Number(current.percent || 0) + 7));
          return {
            ...current,
            meta: nextPercent < 62 ? "Downloading missing document assets" : "Finalizing document library",
            percent: nextPercent,
          };
        });
      }, 360);
    }
    setSkillsState((current) => (current === "ready" ? "refreshing" : "loading"));
    setSkillsError("");
    try {
      const data = await invoke("cloud_mcp_get_account_documents", {
        request: { limit: 2000 },
      });
      const skills = data || {};
      const units = accountDocumentUnitsFromPayload(data);
      const parsedSkillsLibrary = { skills: skillsFromUnits(units) };
      setSkillsLibrary(parsedSkillsLibrary);
      noteAccountSkillUnits(parsedSkillsLibrary.skills);
      const nextRevision = Number(skills.revision ?? skills.seq ?? skills.sequence);
      setSkillsRevision(Number.isFinite(nextRevision) ? nextRevision : null);
      setSkillsMeta({
        updatedAt: text(skills.updated_at || skills.updatedAt),
        updatedBy: text(skills.updated_by_device_name || skills.updatedByDeviceName),
        offline: Boolean(data?.offline),
      });
      setSkillsState("ready");
      if (skillsHydrationRunRef.current === hydrationRunId) {
        const hydratedUnits = units.filter((unit) => (
          text(unit?.content_md ?? unit?.contentMd ?? unit?.content).length
        ));
        const readyCount = parsedSkillsLibrary.skills.length || units.length;
        const readyLabel = readyCount
          ? `${readyCount} doc${readyCount === 1 ? "" : "s"} ready`
          : "Document library ready";
        const hydratedLabel = units.length
          ? ` · ${hydratedUnits.length || units.length}/${units.length} downloaded`
          : "";
        const offline = Boolean(data?.offline);
        setSkillsHydration({
          error: "",
          meta: offline ? "Showing cached docs" : `${readyLabel}${hydratedLabel}`,
          percent: 100,
          runId: hydrationRunId,
          state: "ready",
          title: offline ? "Docs loaded from cache" : "Docs hydrated",
          visible: true,
        });
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            if (skillsHydrationRunRef.current === hydrationRunId) {
              setSkillsHydration((current) => (
                current.state === "ready" ? { ...current, visible: false } : current
              ));
            }
          }, 1600);
        }
      }
    } catch (error) {
      const message = getErrorMessage(error, "Unable to load account tools.");
      setSkillsError(message);
      setSkillsState("error");
      if (skillsHydrationRunRef.current === hydrationRunId) {
        setSkillsHydration({
          error: message,
          meta: "Document hydration failed",
          percent: 100,
          runId: hydrationRunId,
          state: "error",
          title: "Document hydration needs attention",
          visible: true,
        });
      }
    } finally {
      if (progressTimer) {
        window.clearInterval(progressTimer);
      }
    }
  }, []);

  const refreshCliStatuses = useCallback(async ({ report = true } = {}) => {
    setCliState((current) => (current === "ready" ? "refreshing" : "loading"));
    setCliError("");
    try {
      const statuses = await invoke("agent_statuses");
      const list = Array.isArray(statuses) ? statuses : [];
      setCliStatuses(list);
      setCliState("ready");
      let checks = {};
      try {
        checks = await invoke("tools_check_cli_binaries", {
          binaries: CLI_CATALOG.map((entry) => entry.binary),
        }) || {};
        setCatalogChecks(checks);
      } catch {
        // Catalog detection is best-effort.
      }
      if (report) {
        const catalogSnapshot = CLI_CATALOG.map((entry) => ({
          agentId: `cli-${entry.id}`,
          agentLabel: entry.label,
          installed: Boolean(checks?.[entry.binary]?.installed),
        }));
        const snapshot = [...cliSnapshotFromStatuses(list), ...catalogSnapshot];
        const key = JSON.stringify(snapshot);
        if (key !== cliReportedRef.current) {
          cliReportedRef.current = key;
          invoke("cloud_mcp_report_cli_snapshot", { clis: snapshot }).catch(() => {});
        }
      }
    } catch (error) {
      setCliError(getErrorMessage(error, "Unable to read CLI statuses."));
      setCliState("error");
    }
  }, []);

  useEffect(() => {
    void loadAccountTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshCliStatuses();
  }, [refreshCliStatuses]);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("cloud-mcp-account-documents-updated", (event) => {
      if (disposed) {
        return;
      }
      const skillUnits = accountDocumentUnitsFromPayload(event?.payload);
      const replaceSkills = accountToolsSkillPayloadIsFull(event?.payload);
      if (skillUnits.length || replaceSkills) {
        const materializedSkills = skillsFromUnits(skillUnits.filter(documentHasMaterializedContent));
        const skillMeta = accountToolsSkillMetaFromEventPayload(event?.payload);
        setSkillsLibrary((current) => {
          const nextLibrary = replaceSkills
            ? replaceSkillUnitsInLibrary(skillUnits)
            : applySkillUnitsToLibrary(current, skillUnits);
          noteAccountSkillUnits(nextLibrary.skills);
          return nextLibrary;
        });
        if (materializedSkills.length) {
          setSkillEditor((current) => {
            const incoming = materializedSkills.find((entry) => (
              accountDocumentStorageKey(entry) === (current?.documentKey || accountDocumentStorageKey(current))
            ));
            return editorWithRemoteDocumentContent(current, incoming);
          });
        }
        const revisionUnit = skillUnits.find((unit) => unit?.revision != null);
        const revision = Number.isFinite(Number(skillMeta.revision))
          ? Number(skillMeta.revision)
          : Number(revisionUnit?.revision);
        setSkillsRevision((current) => (Number.isFinite(revision) ? revision : current));
        const updatedUnit = skillUnits.find((unit) => unit?.updated_at || unit?.updatedAt);
        const errorUnit = skillUnits.find((unit) => unit?.last_sync_error || unit?.lastSyncError || unit?.error);
        setSkillsMeta((current) => ({
          ...current,
          updatedAt: text(skillMeta.updatedAt || updatedUnit?.updated_at || updatedUnit?.updatedAt, current.updatedAt),
          updatedBy: text(skillMeta.updatedBy, current.updatedBy),
          offline: false,
        }));
        setSkillsState("ready");
        setSkillsError(text(skillMeta.error || errorUnit?.last_sync_error || errorUnit?.lastSyncError || errorUnit?.error));
        return;
      }
      if (!accountToolsEventHasKnownPayload(event?.payload)) {
        void loadAccountTools();
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, [loadAccountTools, skillsRevision]);

  // The Rust inventory watcher reports CLI installs/updates made outside the
  // app (terminals, remote levers, background mode); apply them live.
  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("agent-inventory-changed", (event) => {
      if (disposed) {
        return;
      }
      const statuses = Array.isArray(event?.payload?.statuses) ? event.payload.statuses : [];
      if (!statuses.length) {
        return;
      }
      setCliStatuses(statuses);
      setCliState("ready");
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, []);

  // Applies the next docs list locally right away, then asks Rust to save/delete
  // the underlying account document files and Cloud metadata.
  const persistSkillsLibrary = useCallback(async (nextSkills) => {
    const nextLibrary = { skills: nextSkills };
    const nextByKey = new Map(nextLibrary.skills.map((skill) => [accountDocumentStorageKey(skill), skill]));
    const currentByKey = new Map(skillsLibrary.skills.map((skill) => [accountDocumentStorageKey(skill), skill]));
    const removed = Array.from(currentByKey.entries())
      .filter(([key]) => key && !nextByKey.has(key))
      .map(([, skill]) => skill);
    const upserts = nextLibrary.skills.filter((skill) => {
      const key = accountDocumentStorageKey(skill);
      const current = key ? currentByKey.get(key) : null;
      return !current
        || String(current.content || "") !== String(skill.content || "")
        || text(current.title) !== text(skill.title)
        || text(current.documentKind) !== text(skill.documentKind)
        || text(current.collection) !== text(skill.collection)
        || skill.pendingPush === true;
    });
    setSkillsLibrary(nextLibrary);
    setSkillsState("saving");
    setSkillsError("");
    noteAccountSkillUnits(nextLibrary.skills);
    try {
      const results = [];
      for (const skill of removed) {
        results.push(await invoke("cloud_mcp_delete_account_document", {
          request: accountDocumentRequestFromSkill(skill),
        }));
      }
      for (const skill of upserts) {
        results.push(await invoke("cloud_mcp_save_account_document", {
          request: accountDocumentRequestFromSkill(skill),
        }));
      }
      const result = [...results].reverse().find((entry) => entry) || {};
      const failed = results.find((entry) => text(entry?.cloud_error || entry?.cloudError));
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
      setSkillsMeta((current) => ({
        ...current,
        updatedAt: text(result?.updated_at || result?.updatedAt, current.updatedAt),
        offline: false,
      }));
      if (failed) {
        throw new Error(text(failed.cloud_error || failed.cloudError, "Cloud did not accept the document sync."));
      }
      const syncedLibrary = { skills: nextLibrary.skills.map(clearLocalPendingSkill) };
      setSkillsLibrary(syncedLibrary);
      noteAccountSkillUnits(syncedLibrary.skills);
      setSkillsState("ready");
      return true;
    } catch (error) {
      // Stale revision or offline: the local list keeps the change so nothing
      // is lost; the next successful save syncs the full unit set.
      setSkillsError(getErrorMessage(error, "Unable to sync docs."));
      setSkillsState("ready");
      return false;
    }
  }, [skillsLibrary.skills, skillsRevision]);

  const saveSkillsLibraryLocal = useCallback(async (nextSkills, pendingSkillIds = []) => {
    const pendingIds = new Set((Array.isArray(pendingSkillIds) ? pendingSkillIds : []).map(text).filter(Boolean));
    const localSavedAt = new Date().toISOString();
    const nextLibrary = {
      skills: nextSkills.map((skill) => (
        pendingIds.has(skill.id) ? withLocalPendingSkill(skill, localSavedAt) : skill
      )),
    };
    setSkillsLibrary(nextLibrary);
    setSkillsState("savingLocal");
    setSkillsError("");
    noteAccountSkillUnits(nextLibrary.skills);
    try {
      const results = [];
      for (const skill of nextLibrary.skills.filter((entry) => pendingIds.has(entry.id))) {
        results.push(await invoke("cloud_mcp_save_account_document", {
          request: accountDocumentRequestFromSkill(skill, { localOnly: true }),
        }));
      }
      const result = [...results].reverse().find((entry) => entry) || {};
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
      setSkillsMeta((current) => ({
        ...current,
        updatedAt: text(result?.local_saved_at || result?.localSavedAt || current.updatedAt),
        offline: false,
      }));
      setSkillsState("ready");
      return true;
    } catch (error) {
      setSkillsError(getErrorMessage(error, "Unable to save doc locally."));
      setSkillsState("ready");
      return false;
    }
  }, [skillsRevision]);

  const addCatalogSkill = useCallback((entry) => {
    const existingIds = new Set(skillsLibrary.skills.map((skill) => skill.id));
    const preferredId = skillSlug(entry.title || entry.id);
    if (existingIds.has(preferredId)) {
      setSelectedSkillKey(`library:${preferredId}`);
      const existing = skillsLibrary.skills.find((skill) => skill.id === preferredId);
      if (existing) setSkillEditor(documentEditorDraft(existing));
      return;
    }
    if (existingIds.has(entry.id)) {
      setSelectedSkillKey(`library:${entry.id}`);
      const existing = skillsLibrary.skills.find((skill) => skill.id === entry.id);
      if (existing) setSkillEditor(documentEditorDraft(existing));
      return;
    }
    const skillId = skillSlug(entry.title || entry.id, existingIds);
    const skill = {
      collection: "documents",
      content: String(entry.content || ""),
      documentKind: "skill",
      extension: "md",
      icon: text(entry.icon),
      id: skillId,
      source: "skill",
      title: skillId,
      tone: text(entry.tone),
      updatedAt: new Date().toISOString(),
    };
    void persistSkillsLibrary([...skillsLibrary.skills, skill]);
    setSelectedSkillKey(`library:${accountDocumentStorageKey(skill)}`);
    setSkillEditor(documentEditorDraft(skill));
  }, [persistSkillsLibrary, skillsLibrary.skills]);

  const removeSkill = useCallback((skillKeyOrId) => {
    const skill = skillsLibrary.skills.find((entry) => (
      accountDocumentStorageKey(entry) === skillKeyOrId || entry.id === skillKeyOrId
    ));
    if (!skill) return;
    const skillKey = accountDocumentStorageKey(skill) || skill.id;
    if (typeof window !== "undefined" && !window.confirm(`Remove the doc "${skill.title}"?`)) {
      return;
    }
    void persistSkillsLibrary(skillsLibrary.skills.filter((entry) => (
      (accountDocumentStorageKey(entry) || entry.id) !== skillKey
    )));
    setSelectedSkillKey("");
    setSkillEditor(null);
  }, [persistSkillsLibrary, skillsLibrary.skills]);

  const saveSkillEditor = useCallback((mode = "push") => {
    if (!skillEditor || !text(skillEditor.title)) return;
    const typeOption = documentTypeOption(skillEditor.documentKind || skillEditor.source, skillEditor.collection);
    const editorCollection = typeOption.collection;
    const editorKind = text(skillEditor.documentKind, typeOption.id);
    const editorExtension = text(skillEditor.extension, typeOption.extension);
    const normalizedTitle = skillSlug(skillEditor.title);
    const existing = skillEditor.id
      ? skillsLibrary.skills.find((entry) => (
        (skillEditor.documentKey && accountDocumentStorageKey(entry) === skillEditor.documentKey)
        || entry.id === skillEditor.id
      ))
      : null;
    const updatedAt = new Date().toISOString();
    let nextSkills;
    let savedId;
    if (existing) {
      savedId = existing.id;
      const existingKey = accountDocumentStorageKey(existing) || existing.id;
      nextSkills = skillsLibrary.skills.map((entry) => ((accountDocumentStorageKey(entry) || entry.id) === existingKey
        ? {
          ...entry,
          content: String(skillEditor.content || ""),
          documentKind: editorKind,
          extension: editorExtension,
          collection: editorCollection,
          source: editorKind,
          title: normalizedTitle,
          updatedAt,
        }
        : entry));
    } else {
      savedId = skillSlug(skillEditor.title, new Set(skillsLibrary.skills.map((entry) => entry.id)));
      nextSkills = [...skillsLibrary.skills, {
        collection: editorCollection,
        content: String(skillEditor.content || ""),
        documentKind: editorKind,
        extension: editorExtension,
        icon: "",
        id: savedId,
        localPath: text(skillEditor.localPath),
        source: editorKind,
        title: savedId,
        tone: "",
        updatedAt,
      }];
    }
    if (mode === "local") {
      void saveSkillsLibraryLocal(nextSkills, [savedId]);
    } else {
      void persistSkillsLibrary(nextSkills);
    }
    const savedSkill = nextSkills.find((entry) => entry.id === savedId);
    const savedKey = accountDocumentStorageKey(savedSkill) || savedId;
    setSelectedSkillKey(`library:${savedKey}`);
    setSkillEditor({
      ...documentEditorDraft(savedSkill),
      documentKey: savedKey,
    });
  }, [persistSkillsLibrary, saveSkillsLibraryLocal, skillEditor, skillsLibrary.skills]);

  const runCliAction = useCallback(async (provider, action) => {
    const key = `${provider}:${action}`;
    setCliBusy((current) => ({ ...current, [provider]: action }));
    setCliMessage("");
    setCliError("");
    try {
      const command = action === "install"
        ? "install_agent"
        : action === "update"
          ? "update_agent"
          : "uninstall_agent";
      const result = await invoke(command, { provider });
      setCliMessage(text(result?.message, `${action} finished.`));
      await refreshCliStatuses();
    } catch (error) {
      setCliError(getErrorMessage(error, `Unable to ${action} ${provider}.`));
    } finally {
      setCliBusy((current) => {
        const next = { ...current };
        if (next[provider] === action) delete next[provider];
        return next;
      });
      void key;
    }
  }, [refreshCliStatuses]);

  const runCatalogAction = useCallback(async (entry, action) => {
    const target = cliInstallManager(entry);
    if (!target) {
      setCliError(`${entry.label} has no managed install; install it manually.`);
      return;
    }
    setCatalogBusy((current) => ({ ...current, [entry.id]: action }));
    setCliMessage("");
    setCliError("");
    try {
      const result = await invoke("tools_run_cli_action", {
        manager: target.manager,
        package: target.package,
        action,
      });
      if (result?.ok === false) {
        setCliError(text(result?.message, `${action} failed.`));
      } else {
        setCliMessage(text(result?.message, `${entry.label} ${action} completed.`));
      }
      await refreshCliStatuses();
    } catch (error) {
      setCliError(getErrorMessage(error, `Unable to ${action} ${entry.label}.`));
    } finally {
      setCatalogBusy((current) => {
        const next = { ...current };
        if (next[entry.id] === action) delete next[entry.id];
        return next;
      });
    }
  }, [refreshCliStatuses]);

  // One flat "installed programs" list: coding-agent CLIs and the developer
  // catalog merged, installed entries first, filtered by the search query.
  const cliRows = useMemo(() => {
    const query = text(catalogQuery).toLowerCase();
    const agentRows = (Array.isArray(cliStatuses) ? cliStatuses : []).map((status) => {
      const provider = text(status?.provider || status?.id);
      const label = text(status?.label, provider);
      return {
        busyAction: cliBusy[provider] || "",
        icon: null,
        id: `agent:${provider}`,
        installed: Boolean(status?.installed),
        kind: "agent",
        label,
        manageable: true,
        provider,
        searchText: `${label} ${provider}`.toLowerCase(),
        sub: "coding agent",
        updateAvailable: Boolean(status?.npmUpdateAvailable || status?.npm_update_available),
        version: text(status?.version),
      };
    });
    const catalogRows = CLI_CATALOG.map((entry) => ({
      busyAction: catalogBusy[entry.id] || "",
      entry,
      icon: entry.icon || null,
      id: `catalog:${entry.id}`,
      installed: Boolean(catalogChecks?.[entry.binary]?.installed),
      kind: "catalog",
      label: entry.label,
      manageable: Boolean(cliInstallManager(entry)),
      searchText: `${entry.label} ${entry.binary}`.toLowerCase(),
      sub: entry.binary,
      updateAvailable: false,
      version: "",
    }));
    return [...agentRows, ...catalogRows]
      .filter((row) => !query || row.searchText.includes(query))
      .sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [catalogBusy, catalogChecks, catalogQuery, cliBusy, cliStatuses]);

  const handleCliRowAction = useCallback((row, action) => {
    if (row.kind === "agent") {
      void runCliAction(row.provider, action);
    } else if (row.entry) {
      void runCatalogAction(row.entry, action);
    }
  }, [runCatalogAction, runCliAction]);

  const pendingSkillCount = useMemo(
    () => skillsLibrary.skills.filter((skill) => skill?.pendingPush === true).length,
    [skillsLibrary.skills],
  );

  const skillsStatusTone = skillsMeta.offline || pendingSkillCount > 0 ? "warn" : "good";

  const skillsStatusLabel = useMemo(() => {
    if (skillsState === "loading") return "Loading…";
    if (skillsState === "saving") return "Syncing…";
    if (skillsState === "savingLocal") return "Saving locally…";
    if (pendingSkillCount > 0) {
      return `${pendingSkillCount} local change${pendingSkillCount === 1 ? "" : "s"} pending push`;
    }
    if (skillsMeta.offline) return "Offline — showing cached copy";
    const parts = [];
    if (skillsRevision !== null) parts.push(`rev ${skillsRevision}`);
    if (skillsMeta.updatedAt) parts.push(`updated ${timeAgo(skillsMeta.updatedAt)}`);
    if (skillsMeta.updatedBy) parts.push(`by ${skillsMeta.updatedBy}`);
    return parts.join(" · ") || "Synced to your account";
  }, [pendingSkillCount, skillsMeta, skillsRevision, skillsState]);

  const docFileRows = useMemo(() => {
    const query = text(skillsQuery).toLowerCase();
    return skillsLibrary.skills
      .map((skill) => {
        const key = accountDocumentStorageKey(skill) || skill.id;
        const fileName = documentFileName(skill);
        return {
          ...skill,
          fileName,
          key: `library:${key}`,
          preview: documentPreviewLine(skill),
          typeLabel: documentTypeLabel(skill.documentKind, skill.collection),
        };
      })
      .filter((row) => (
        !query
        || row.fileName.toLowerCase().includes(query)
        || row.title.toLowerCase().includes(query)
        || row.preview.toLowerCase().includes(query)
        || row.typeLabel.toLowerCase().includes(query)
        || text(row.localPath).toLowerCase().includes(query)
      ))
      .sort((left, right) => left.fileName.localeCompare(right.fileName));
  }, [skillsLibrary.skills, skillsQuery]);

  const defaultSkillRows = useMemo(() => {
    const query = text(templateQuery).toLowerCase();
    const ownedIds = new Set(skillsLibrary.skills.map((skill) => skill.id));
    return SKILLS_CATALOG
      .map((entry) => {
        const defaultId = skillSlug(entry.title || entry.id);
        const added = ownedIds.has(defaultId) || ownedIds.has(entry.id);
        const cliInstalled = Boolean(catalogChecks?.[skillCliBinary(entry)]?.installed);
        return {
          ...entry,
          added,
          cliInstalled,
          defaultFileName: `${defaultId}.md`,
          defaultId,
          searchLabel: `${entry.title} ${entry.description || ""} ${defaultId} ${cliInstalled ? "cli installed" : ""}`.toLowerCase(),
        };
      })
      .filter((row) => !query || row.searchLabel.includes(query))
      .sort((a, b) => {
        if (a.added !== b.added) return a.added ? 1 : -1;
        if (a.cliInstalled !== b.cliInstalled) return a.cliInstalled ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
  }, [catalogChecks, skillsLibrary.skills, templateQuery]);

  const startNewDocument = useCallback(() => {
    const requestedName = text(newDocDraft.name);
    if (!requestedName) return;
    const option = documentTypeOption(newDocDraft.type);
    const existingIds = new Set(skillsLibrary.skills.map((entry) => entry.id));
    const docId = skillSlug(requestedName, existingIds);
    setSelectedSkillKey("");
    setSkillEditor({
      baseContent: "",
      collection: option.collection,
      content: "",
      contentHash: "",
      documentKind: option.id,
      extension: option.extension,
      id: "",
      localPath: "",
      source: option.id,
      title: docId,
    });
    setNewDocDraft((current) => ({ ...current, name: "" }));
  }, [newDocDraft, skillsLibrary.skills]);

  const selectedSkill = useMemo(() => {
    const [scope, ...rest] = selectedSkillKey.split(":");
    const key = rest.join(":");
    if (!key) return null;
    if (scope === "library") {
      const skill = skillsLibrary.skills.find((entry) => (
        accountDocumentStorageKey(entry) === key || entry.id === key
      ));
      return skill ? { ...skill, owned: true } : null;
    }
    if (scope === "catalog") {
      const entry = SKILLS_CATALOG.find((candidate) => candidate.id === key);
      return entry ? { ...entry, owned: false } : null;
    }
    return null;
  }, [selectedSkillKey, skillsLibrary.skills]);

  useEffect(() => {
    if (!selectedSkill?.owned || !documentHasMaterializedContent(selectedSkill)) return;
    setSkillEditor((current) => editorWithRemoteDocumentContent(current, selectedSkill));
  }, [selectedSkill]);

  useEffect(() => {
    const selectedKey = selectedSkill?.owned ? accountDocumentStorageKey(selectedSkill) : "";
    if (!selectedKey || String(selectedSkill?.content || "").length > 0) return;
    if (hydratingDocKeyRef.current === selectedKey) return;
    hydratingDocKeyRef.current = selectedKey;
    let cancelled = false;
    invoke("cloud_mcp_hydrate_account_document", {
      request: accountDocumentRequestFromSkill(selectedSkill),
    }).then((result) => {
      if (cancelled) return;
      const units = accountDocumentUnitsFromPayload(result);
      if (units.length) {
        const hydratedSkills = skillsFromUnits(units);
        const hydratedSkill = hydratedSkills.find((entry) => accountDocumentStorageKey(entry) === selectedKey);
        setSkillsLibrary((current) => {
          const nextLibrary = applySkillUnitsToLibrary(current, units);
          noteAccountSkillUnits(nextLibrary.skills);
          return nextLibrary;
        });
        if (documentHasMaterializedContent(hydratedSkill)) {
          setSkillEditor((current) => {
            return editorWithRemoteDocumentContent(current, hydratedSkill);
          });
        }
      }
    }).catch((error) => {
      if (!cancelled) {
        setSkillsError(getErrorMessage(error, "Unable to hydrate doc content."));
      }
    }).finally(() => {
      if (hydratingDocKeyRef.current === selectedKey) {
        hydratingDocKeyRef.current = "";
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSkillKey, selectedSkill]);

  const docsCreateMode = !skillEditor;

  return (
    <ToolsHubShell aria-label="Global toolkit" data-section={section}>
      <ToolsHubHeader>
        <ToolsSectionNav aria-label="Tool sections" role="tablist">
          {SECTIONS.map((entry) => (
            <ToolsSectionButton
              aria-selected={section === entry.id}
              data-active={section === entry.id ? "true" : "false"}
              key={entry.id}
              onClick={() => setSection(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </ToolsSectionButton>
          ))}
        </ToolsSectionNav>
      </ToolsHubHeader>

      {section === "mcps" && (
        <ToolsMcpPane aria-label="MCP settings">
          {globalMcpDefaults.error && activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE && (
            <ToolsError role="alert">{globalMcpDefaults.error}</ToolsError>
          )}
          <ToolsHubFill>
            {mcpScopeReady && activeMcpWorkspace ? (
              <McpsWorkspaceView
                defaultWorkingDirectory={activeMcpRootDirectory || defaultWorkingDirectory}
                key={activeMcpScope}
                onScopeChange={setMcpScope}
                rootDirectory={activeMcpRootDirectory}
                scopeOptions={[
                  { value: GLOBAL_MCP_DEFAULTS_SCOPE, label: "Global defaults" },
                  ...workspaceOptions.map((workspaceOption) => ({
                    value: workspaceOption.id,
                    label: workspaceOption.name,
                  })),
                ]}
                scopeValue={activeMcpScope}
                workspace={activeMcpWorkspace}
              />
            ) : (
              <ToolsEmpty>
                {globalMcpDefaults.state === "error"
                  ? "The global MCP defaults store is unavailable."
                  : "Loading MCP scope…"}
              </ToolsEmpty>
            )}
          </ToolsHubFill>
        </ToolsMcpPane>
      )}

      {(section === "docs" || section === "clis") && (
        <ToolsScroll data-section={section}>
          <ToolsLayout data-section={section}>
            {section === "docs" && (
              <DocsWorkspaceSurface aria-label="Docs workspace">
              <DocsWorkspaceGrid data-show-templates={docsCreateMode ? "true" : "false"}>
                <DocsFilesPane aria-label="Document files">
                  <FileExplorerHeader>
                    <div>
                      <PanelKicker>Explorer</PanelKicker>
                    </div>
                    <FileExplorerActions>
                    <FileIconButton
                      aria-label="Refresh docs"
                      disabled={skillsState === "loading" || skillsState === "refreshing"}
                      onClick={() => void loadAccountTools()}
                      title="Refresh docs"
                      type="button"
                    >
                      <ButtonRefreshIcon aria-hidden="true" />
                    </FileIconButton>
                    </FileExplorerActions>
                  </FileExplorerHeader>
                  <DocsRootPath title="Account documents">account-documents / personal</DocsRootPath>
                  <DocsExplorerSearchInput
                    aria-label="Search document files"
                    onChange={(event) => setSkillsQuery(event.target.value)}
                    placeholder="Search .md, .arch…"
                    type="search"
                    value={skillsQuery}
                  />
                  <FileTree aria-label="Account document explorer">
                    <FileTreeItem>
                      <DocsExplorerFolderButton
                        $depth={0}
                        as="div"
                        data-selected="false"
                      >
                        <FileDisclosure>
                          <span className="codicon codicon-chevron-down" aria-hidden="true" />
                        </FileDisclosure>
                        <FileKindIcon data-file-tone="folder">
                          <span className="codicon codicon-folder-opened" aria-hidden="true" />
                        </FileKindIcon>
                        <FileTreeName title="documents">documents</FileTreeName>
                        <DocsExplorerCount>{docFileRows.length || ""}</DocsExplorerCount>
                      </DocsExplorerFolderButton>
                      {skillsState === "loading" ? (
                        <FileTreeEmpty>Loading docs…</FileTreeEmpty>
                      ) : docFileRows.length ? (
                        docFileRows.map((row) => {
                          const active = selectedSkillKey === row.key;
                          const iconClass = row.extension === "arch" ? "codicon-file-code" : "codicon-markdown";
                          const fileTone = row.extension === "arch" ? "data" : "markdown";
                          return (
                            <DocsExplorerFileButton
                              $depth={1}
                              data-selected={active ? "true" : "false"}
                              key={row.key}
                              onClick={() => {
                                setSelectedSkillKey(row.key);
                                setSkillEditor(documentEditorDraft(row));
                              }}
                              title={text(row.localPath, row.preview)}
                              type="button"
                            >
                              <FileDisclosure />
                              <FileKindIcon data-file-tone={fileTone}>
                                <span className={`codicon ${iconClass}`} aria-hidden="true" />
                              </FileKindIcon>
                              <FileTreeName>{row.fileName}</FileTreeName>
                              <DocsExplorerStatus title={row.pendingPush ? "Pending push" : row.typeLabel}>
                                {row.pendingPush ? "●" : ""}
                              </DocsExplorerStatus>
                            </DocsExplorerFileButton>
                          );
                        })
                      ) : (
                        <FileTreeEmpty>{text(skillsQuery) ? "No matching docs." : "No docs saved yet."}</FileTreeEmpty>
                      )}
                    </FileTreeItem>
                  </FileTree>
                </DocsFilesPane>

                <DocsCenterPane aria-label="Document editor">
                  <ToolsHydrationProgress placement="editor" progress={skillsHydration} />
                  {skillsError && <ToolsError role="alert">{skillsError}</ToolsError>}
                  {skillEditor ? (
                    <>
                      <SkillDocumentEditor data-page-theme={skillEditorTheme}>
                        <SkillDocumentToolbar>
                          <SkillDocumentToolbarCopy>
                            <ToolsPanelTitle>{documentFileName(skillEditor)}</ToolsPanelTitle>
                            <ToolsPanelHint>
                              {text(skillEditor.localPath, documentTypeLabel(skillEditor.documentKind, skillEditor.collection))}
                            </ToolsPanelHint>
                          </SkillDocumentToolbarCopy>
                          <SkillDocumentToolbarControls>
                            <DocTypeSelect
                              aria-label="Document type"
                              onChange={(event) => {
                                const option = documentTypeOption(event.target.value);
                                setSkillEditor((current) => ({
                                  ...current,
                                  collection: option.collection,
                                  documentKind: option.id,
                                  extension: option.extension,
                                  source: option.id,
                                }));
                              }}
                              value={documentTypeOption(skillEditor.documentKind, skillEditor.collection).id}
                            >
                              {DOCUMENT_TYPE_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </DocTypeSelect>
                            <ToolsStatusPill data-tone={skillsStatusTone}>
                              {skillsStatusLabel}
                            </ToolsStatusPill>
                            <SkillDocumentThemeSwitch aria-label="Document editor page theme">
                              {["dark", "light"].map((theme) => (
                                <SkillDocumentThemeButton
                                  aria-pressed={skillEditorTheme === theme}
                                  data-active={skillEditorTheme === theme ? "true" : "false"}
                                  key={theme}
                                  onClick={() => setSkillEditorTheme(theme)}
                                  type="button"
                                >
                                  {theme === "dark" ? "Dark" : "Light"}
                                </SkillDocumentThemeButton>
                              ))}
                            </SkillDocumentThemeSwitch>
                          </SkillDocumentToolbarControls>
                        </SkillDocumentToolbar>
                        <SkillDocumentCanvas>
                          <SkillDocumentPage>
                            <SkillDocumentTitleInput
                              aria-label="Document name"
                              onChange={(event) => setSkillEditor((current) => ({ ...current, title: event.target.value }))}
                              placeholder="doc_name"
                              value={skillEditor.title}
                            />
                            <ToolsSkillsEditor
                              aria-label="Document content"
                              onChange={(event) => setSkillEditor((current) => ({ ...current, content: event.target.value }))}
                              placeholder={skillEditor.extension === "arch" ? "title System_Map" : "# Notes"}
                              spellCheck={false}
                              value={skillEditor.content}
                            />
                          </SkillDocumentPage>
                        </SkillDocumentCanvas>
                      </SkillDocumentEditor>
                      <SkillDocumentActions>
                        <ToolsGhostButton
                          onClick={() => {
                            setSkillEditor(null);
                            setSelectedSkillKey("");
                          }}
                          type="button"
                        >
                          Close
                        </ToolsGhostButton>
                        {skillEditor.id && (
                          <ToolsGhostButton
                            data-danger="true"
                            onClick={() => removeSkill(skillEditor.documentKey || accountDocumentStorageKey(skillEditor) || skillEditor.id)}
                            type="button"
                          >
                            Delete
                          </ToolsGhostButton>
                        )}
                        <ToolsGhostButton
                          disabled={!text(skillEditor.title) || skillsState === "saving" || skillsState === "savingLocal"}
                          onClick={() => saveSkillEditor("local")}
                          type="button"
                        >
                          {skillsState === "savingLocal" ? "Saving locally…" : "Save Local"}
                        </ToolsGhostButton>
                        <ToolsPrimaryButton
                          disabled={!text(skillEditor.title) || skillsState === "saving" || skillsState === "savingLocal"}
                          onClick={() => saveSkillEditor("push")}
                          type="button"
                        >
                          {skillsState === "saving" ? "Syncing…" : "Push Save"}
                        </ToolsPrimaryButton>
                      </SkillDocumentActions>
                    </>
                  ) : (
                    <DocsCreateModal>
                      <DocsCreateHeader>
                        <div>
                          <ToolsPanelTitle>New doc</ToolsPanelTitle>
                          <DocsCreateFileName>
                            {text(newDocDraft.name)
                              ? `${skillSlug(newDocDraft.name)}.${documentTypeOption(newDocDraft.type).extension}`
                              : `untitled.${documentTypeOption(newDocDraft.type).extension}`}
                          </DocsCreateFileName>
                        </div>
                        <ToolsStatusPill data-tone={skillsStatusTone}>
                          {skillsStatusLabel}
                        </ToolsStatusPill>
                      </DocsCreateHeader>
                      <DocsCreateFields>
                        <DocsField>
                          <label htmlFor="tools-doc-name">Name</label>
                          <input
                            autoComplete="off"
                            id="tools-doc-name"
                            onChange={(event) => setNewDocDraft((current) => ({ ...current, name: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                startNewDocument();
                              }
                            }}
                            placeholder="My_New_Doc"
                            value={newDocDraft.name}
                          />
                        </DocsField>
                        <DocsField>
                          <label htmlFor="tools-doc-type">Type</label>
                          <select
                            id="tools-doc-type"
                            onChange={(event) => setNewDocDraft((current) => ({ ...current, type: event.target.value }))}
                            value={newDocDraft.type}
                          >
                            {DOCUMENT_TYPE_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </DocsField>
                      </DocsCreateFields>
                      <ToolsPrimaryButton
                        disabled={!text(newDocDraft.name)}
                        onClick={startNewDocument}
                        type="button"
                      >
                        Create
                      </ToolsPrimaryButton>
                    </DocsCreateModal>
                  )}
                </DocsCenterPane>

                {docsCreateMode && (
                <DocsTemplatesPane aria-label="Default skills">
                  <DocsPaneHeader>
                    <div>
                      <DocsPaneKicker>Defaults</DocsPaneKicker>
                      <DocsPaneTitle>Skills</DocsPaneTitle>
                    </div>
                  </DocsPaneHeader>
                  <DocsSearchInput
                    aria-label="Search default skills"
                    onChange={(event) => setTemplateQuery(event.target.value)}
                    placeholder="Search defaults…"
                    type="search"
                    value={templateQuery}
                  />
                  <DocsTemplateList role="list">
                    {defaultSkillRows.map((row) => (
                      <DocsTemplateRow
                        data-added={row.added ? "true" : "false"}
                        key={row.id}
                        role="listitem"
                      >
                        <SkillRowIcon
                          aria-hidden="true"
                          style={{ "--skill-color": skillToneColor(row.tone, row.title) }}
                        >
                          <SkillIconGlyph icon={row.icon} title={row.title} />
                        </SkillRowIcon>
                        <DocsTemplateCopy>
                          <strong>{row.defaultFileName}</strong>
                          <span>{row.description}</span>
                        </DocsTemplateCopy>
                        <CliRowButton
                          disabled={row.added || skillsState === "saving"}
                          onClick={() => addCatalogSkill(row)}
                          type="button"
                        >
                          {row.added ? "Added" : "Add"}
                        </CliRowButton>
                      </DocsTemplateRow>
                    ))}
                    {!defaultSkillRows.length && (
                      <ToolsEmpty>No default skills match.</ToolsEmpty>
                    )}
                  </DocsTemplateList>
                </DocsTemplatesPane>
                )}
              </DocsWorkspaceGrid>
              </DocsWorkspaceSurface>
            )}

            {section === "clis" && (
              <ToolsPanel aria-label="CLIs">
                <CliSearchRow>
                  <CliSearchInput
                    aria-label="Search CLIs by name"
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Search CLIs…"
                    type="search"
                    value={catalogQuery}
                  />
                  <ToolsGhostButton
                    disabled={cliState === "loading" || cliState === "refreshing"}
                    onClick={() => void refreshCliStatuses()}
                    title="Re-check installed CLIs"
                    type="button"
                  >
                    {cliState === "refreshing" ? "Checking…" : "Refresh"}
                  </ToolsGhostButton>
                </CliSearchRow>
                {cliError && <ToolsError role="alert">{cliError}</ToolsError>}
                {cliMessage && <ToolsNotice>{cliMessage}</ToolsNotice>}
                {cliState === "loading" ? (
                  <ToolsEmpty>Checking installed CLIs…</ToolsEmpty>
                ) : (
                  <CliList aria-label="CLI programs" role="list">
                    {cliRows.map((row) => {
                      const Icon = row.icon;
                      return (
                        <CliRow
                          data-installed={row.installed ? "true" : "false"}
                          key={row.id}
                          role="listitem"
                        >
                          <CliRowIcon aria-hidden="true">
                            {Icon ? <Icon /> : <span>{row.label.slice(0, 1).toUpperCase()}</span>}
                          </CliRowIcon>
                          <CliRowName>
                            <strong>{row.label}</strong>
                            {row.sub && <span>{row.sub}</span>}
                          </CliRowName>
                          <CliRowState>
                            {row.busyAction ? (
                              <CliStateText data-tone="busy">
                                {row.busyAction === "install"
                                  ? "Installing…"
                                  : row.busyAction === "update"
                                    ? "Updating…"
                                    : "Uninstalling…"}
                              </CliStateText>
                            ) : row.installed ? (
                              <>
                                <CliRowButton
                                  data-danger="true"
                                  data-hover-only="true"
                                  onClick={() => handleCliRowAction(row, "uninstall")}
                                  type="button"
                                >
                                  Uninstall
                                </CliRowButton>
                                {row.updateAvailable && (
                                  <CliRowButton
                                    onClick={() => handleCliRowAction(row, "update")}
                                    type="button"
                                  >
                                    Update
                                  </CliRowButton>
                                )}
                                <CliStateText data-tone="good">
                                  {row.version ? `Installed · ${row.version}` : "Installed"}
                                </CliStateText>
                              </>
                            ) : row.manageable ? (
                              <>
                                <CliRowButton
                                  data-hover-only="true"
                                  onClick={() => handleCliRowAction(row, "install")}
                                  type="button"
                                >
                                  Install
                                </CliRowButton>
                                <CliStateText data-tone="muted">Not installed</CliStateText>
                              </>
                            ) : (
                              <CliStateText
                                data-tone="muted"
                                title="No managed installer for this device — install manually"
                              >
                                Not installed
                              </CliStateText>
                            )}
                          </CliRowState>
                        </CliRow>
                      );
                    })}
                    {!cliRows.length && (
                      <ToolsEmpty>{`No CLIs match "${text(catalogQuery)}".`}</ToolsEmpty>
                    )}
                  </CliList>
                )}
              </ToolsPanel>
            )}
          </ToolsLayout>
        </ToolsScroll>
      )}
    </ToolsHubShell>
  );
}

const ToolsHubShell = styled.section`
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--forge-text);
`;

const ToolsHubHeader = styled.header`
  z-index: 30;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 48px;
  overflow: hidden;
  padding: 6px 10px;
  border-bottom: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  background: rgba(5, 8, 13, 0.96);
  backdrop-filter: blur(12px);
`;

const ToolsHubFill = styled.div`
  position: relative;
  z-index: 0;
  display: grid;
  /* Explicit bounded row: without it the implicit auto row sizes to content,
     the child's height:100% resolves as auto, and the inner scroll pane gets
     clipped instead of scrolling (the "can't scroll the MCP list" bug). */
  grid-template-rows: minmax(0, 1fr);
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ToolsHubStack = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;

  &[data-has-progress="true"] {
    grid-template-rows: auto minmax(0, 1fr);
  }

  > * {
    min-width: 0;
    min-height: 0;
  }
`;

const ToolsScroll = styled.div`
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overflow-anchor: none;
  scrollbar-gutter: stable;
  padding: 14px 16px 24px;

  &[data-section="docs"] {
    display: grid;
    overflow: hidden;
    padding: 12px;
  }
`;

const ToolsHydrationPanel = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.22);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(20, 29, 44, 0.92), rgba(10, 15, 24, 0.92));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  &[data-placement="hub"],
  &[data-placement="editor"] {
    margin: 10px 10px 0;
  }

  &[data-state="error"] {
    border-color: rgba(255, 132, 119, 0.34);
    background: linear-gradient(180deg, rgba(49, 24, 24, 0.94), rgba(20, 12, 14, 0.94));
  }

  &[data-state="ready"] {
    border-color: rgba(113, 214, 151, 0.28);
  }
`;

const ToolsHydrationCopy = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 12px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text, #f4f7fa);
    font-size: 11px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    font-weight: 720;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ToolsHydrationTrack = styled.div`
  position: relative;
  height: 5px;
  min-width: 0;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
`;

const ToolsHydrationFill = styled.div`
  height: 100%;
  min-width: 4px;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--forge-accent-soft, #7db0ff), #8fe0aa);
  transition: width 180ms ease;
`;

const ToolsMcpPane = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  /* McpWorkspaceSurface carries its own padding; doubling it up left a wide
     dead band around the whole MCPs tab. */
  padding: 0;
`;

const ToolsLayout = styled.section`
  display: grid;
  align-content: start;
  width: min(1080px, 100%);
  justify-self: center;
  margin: 0 auto;
  gap: 12px;
  min-width: 0;

  &[data-section="docs"] {
    align-content: stretch;
    width: 100%;
    height: 100%;
    margin: 0;
  }
`;

const ToolsSectionNav = styled.nav`
  display: inline-flex;
  align-items: stretch;
  flex: 0 0 auto;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding: 3px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 9px;
  background: rgba(7, 9, 13, 0.56);

  &::-webkit-scrollbar {
    display: none;
  }
`;

const ToolsSectionButton = styled.button`
  position: relative;
  flex: 0 0 auto;
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 11px;
  font-weight: 760;
  cursor: pointer;
  white-space: nowrap;

  &[data-active="true"] {
    color: var(--forge-text, #f4f7fa);
    background: rgba(var(--forge-accent-soft-rgb), 0.14);
  }

  &:hover:not([data-active="true"]) {
    color: var(--forge-text-soft, #b6c0cc);
  }
`;

const ToolsPanel = styled.section`
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.6);

  &[data-mode="editor"] {
    gap: 0;
    padding: 0;
    overflow: hidden;
    background: rgba(8, 11, 16, 0.72);
  }
`;

const DocsWorkspaceSurface = styled(FilesWorkspaceSurface)`
  border: 1px solid var(--files-vscode-border);
  border-radius: 8px;
`;

const DocsWorkspaceGrid = styled.section`
  display: grid;
  grid-template-columns: minmax(218px, 280px) minmax(360px, 1fr);
  gap: 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;

  &[data-show-templates="true"] {
    grid-template-columns: minmax(218px, 280px) minmax(360px, 1fr) minmax(238px, 310px);
  }

  @media (max-width: 1060px) {
    grid-template-columns: minmax(200px, 240px) minmax(320px, 1fr);

    > :last-child {
      display: none;
    }
  }
`;

const DocsPaneBase = styled.aside`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 9px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.72);
`;

const DocsFilesPane = styled(FileExplorerPane)`
  border-right: 1px solid var(--files-vscode-border);
`;

const DocsTemplatesPane = styled(DocsPaneBase)``;

const DocsRootPath = styled(FileRootPath)`
  padding-right: 10px;
`;

const DocsExplorerSearchInput = styled.input`
  width: calc(100% - 16px);
  min-width: 0;
  height: 26px;
  margin: 6px 8px;
  padding: 0 8px;
  border: 1px solid var(--files-vscode-border);
  border-radius: 4px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-editor);
  font-size: 11px;
  outline: none;

  &::placeholder {
    color: var(--files-vscode-text-muted);
  }

  &:focus-visible {
    border-color: var(--files-vscode-focus);
    box-shadow: 0 0 0 1px var(--files-vscode-focus);
  }
`;

const DocsExplorerFolderButton = styled(FileTreeButton)`
  cursor: default;
`;

const DocsExplorerFileButton = styled(FileTreeButton)`
  cursor: pointer;
`;

const DocsExplorerCount = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--files-vscode-text-muted);
  font-size: 10px;
  font-weight: 650;
  line-height: 22px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DocsExplorerStatus = styled.span`
  color: #e2c08d;
  font-size: 10px;
  line-height: 22px;
  text-align: center;
`;

const DocsCenterPane = styled.section`
  display: grid;
  align-content: stretch;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-right: 1px solid var(--files-vscode-border);
  border-radius: 0;
  background: rgba(7, 10, 16, 0.72);

  ${DocsWorkspaceGrid}[data-show-templates="false"] & {
    border-right: 0;
  }
`;

const DocsPaneHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const DocsPaneKicker = styled.div`
  margin-bottom: 2px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const DocsPaneTitle = styled.div`
  overflow: hidden;
  color: var(--forge-text, #f4f7fa);
  font-size: 13px;
  font-weight: 820;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ToolsSearchInput = styled.input`
  width: min(220px, 100%);
  padding: 7px 11px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  color: var(--forge-text, #f4f7fa);
  background: rgba(7, 9, 13, 0.55);
  font-size: 12px;

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-accent-soft-rgb), 0.35);
    outline-offset: -1px;
  }
`;

const DocsSearchInput = styled(ToolsSearchInput)`
  width: 100%;
`;

const DocsCreateModal = styled.div`
  align-self: center;
  justify-self: center;
  display: grid;
  gap: 14px;
  width: min(420px, calc(100% - 28px));
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  background: rgba(12, 17, 26, 0.94);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
`;

const DocsCreateHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
`;

const DocsCreateFileName = styled.div`
  overflow: hidden;
  color: var(--forge-text-muted, #7a8493);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DocsCreateFields = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 10px;
  min-width: 0;
`;

const DocsField = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;

  label {
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.13));
    border-radius: 7px;
    color: var(--forge-text, #f4f7fa);
    background: rgba(5, 8, 13, 0.76);
    font-size: 12px;
    font-weight: 650;
    outline: none;
  }

  input {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  }

  input:focus-visible,
  select:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.44);
    box-shadow: 0 0 0 2px rgba(var(--forge-accent-rgb), 0.14);
  }
`;

const DocTypeSelect = styled.select`
  height: 28px;
  max-width: 138px;
  min-width: 112px;
  padding: 0 9px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 7px;
  color: var(--forge-text-soft, #b6c0cc);
  background: rgba(4, 7, 12, 0.78);
  font-size: 10.5px;
  font-weight: 760;
  outline: none;
`;

const DocsTemplateList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.07));
  border-radius: 7px;
  background: rgba(3, 6, 10, 0.34);
`;

const DocsTemplateRow = styled.div`
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 50px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--forge-border, rgba(230, 236, 245, 0.05));

  &:last-child {
    border-bottom: 0;
  }

  &[data-added="true"] {
    opacity: 0.64;
  }
`;

const DocsTemplateCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong {
    overflow: hidden;
    color: var(--forge-text, #f4f7fa);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 11px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    display: -webkit-box;
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    line-height: 1.25;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
`;

const ToolsPanelTitle = styled.h3`
  margin: 0 0 3px;
  font-size: 14px;
  font-weight: 800;
`;

const ToolsPanelHint = styled.p`
  margin: 0;
  max-width: 560px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 12px;
`;

const ToolsStatusPill = styled.span`
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  overflow: hidden;
  padding: 4px 10px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 999px;
  color: var(--forge-text-soft, #b6c0cc);
  font-size: 10px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-tone="good"] {
    border-color: rgba(60, 203, 127, 0.25);
    color: rgba(140, 230, 180, 0.95);
  }

  &[data-tone="warn"] {
    border-color: rgba(223, 165, 90, 0.3);
    color: rgba(240, 200, 140, 0.95);
  }

  &[data-tone="muted"] {
    color: var(--forge-text-muted, #7a8493);
  }
`;

const SkillDocumentEditor = styled.div`
  --skill-editor-desk: linear-gradient(180deg, rgba(12, 16, 24, 0.96), rgba(5, 8, 13, 0.98));
  --skill-editor-page: #0d1118;
  --skill-editor-page-border: rgba(230, 236, 245, 0.1);
  --skill-editor-page-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
  --skill-editor-page-text: #e8edf5;
  --skill-editor-page-muted: #778396;
  --skill-editor-page-placeholder: rgba(119, 131, 150, 0.72);
  --skill-editor-page-rule: rgba(230, 236, 245, 0.08);

  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: rgba(5, 8, 13, 0.8);

  &[data-page-theme="light"] {
    --skill-editor-desk: linear-gradient(180deg, #dfe6ef, #cbd5e1);
    --skill-editor-page: #fffdf8;
    --skill-editor-page-border: rgba(40, 50, 65, 0.16);
    --skill-editor-page-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
    --skill-editor-page-text: #1c2430;
    --skill-editor-page-muted: #647084;
    --skill-editor-page-placeholder: rgba(100, 112, 132, 0.68);
    --skill-editor-page-rule: rgba(30, 41, 59, 0.14);
  }
`;

const SkillDocumentToolbar = styled.div`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  background: rgba(7, 10, 16, 0.76);
`;

const SkillDocumentToolbarCopy = styled.div`
  display: grid;
  flex: 1 1 320px;
  min-width: 0;
  gap: 2px;
`;

const SkillDocumentToolbarControls = styled.div`
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
`;

const SkillDocumentThemeSwitch = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  background: rgba(4, 7, 12, 0.78);
`;

const SkillDocumentThemeButton = styled.button`
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 10px;
  font-weight: 780;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text, #f4f7fa);
    background: rgba(var(--forge-accent-soft-rgb), 0.16);
  }

  &:hover:not([data-active="true"]) {
    color: var(--forge-text-soft, #b6c0cc);
  }
`;

const SkillDocumentCanvas = styled.div`
  display: grid;
  justify-items: center;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 24px;
  background: var(--skill-editor-desk);
`;

const SkillDocumentPage = styled.div`
  display: grid;
  align-content: start;
  width: min(780px, 100%);
  min-height: 900px;
  padding: 48px 56px 64px;
  border: 1px solid var(--skill-editor-page-border);
  border-radius: 4px;
  color: var(--skill-editor-page-text);
  background: var(--skill-editor-page);
  box-shadow: var(--skill-editor-page-shadow);
`;

const SkillDocumentTitleInput = styled.input`
  width: 100%;
  min-width: 0;
  padding: 0 0 7px;
  border: 0;
  border-bottom: 1px solid var(--skill-editor-page-rule);
  color: var(--skill-editor-page-text);
  background: transparent;
  font-family: ui-serif, Georgia, "Times New Roman", serif;
  font-size: 30px;
  font-weight: 760;
  line-height: 1.18;
  outline: none;

  &::placeholder {
    color: var(--skill-editor-page-placeholder);
  }
`;

const ToolsSkillsEditor = styled.textarea`
  width: 100%;
  min-width: 0;
  min-height: 650px;
  margin-top: 24px;
  padding: 0;
  border: 0;
  color: var(--skill-editor-page-text);
  background: transparent;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  font-weight: 520;
  line-height: 1.72;
  outline: none;
  resize: none;

  &:focus-visible {
    box-shadow: inset 3px 0 0 rgba(var(--forge-accent-soft-rgb), 0.36);
  }

  &::placeholder {
    color: var(--skill-editor-page-placeholder);
  }
`;

const SkillDocumentActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  background: rgba(7, 10, 16, 0.72);
`;

const ToolsPrimaryButton = styled.button`
  padding: 8px 16px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.35);
  border-radius: 8px;
  color: var(--forge-accent-soft, rgba(200, 222, 255, 0.98));
  background: rgba(var(--forge-accent-rgb), 0.18);
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(var(--forge-accent-rgb), 0.3);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const ToolsGhostButton = styled.button`
  padding: 8px 14px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  color: var(--forge-text-soft, #b6c0cc);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--forge-text, #f4f7fa);
    border-color: rgba(230, 236, 245, 0.24);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }

  &[data-danger="true"] {
    border-color: rgba(239, 107, 107, 0.3);
    color: rgba(250, 180, 180, 0.92);
  }

  &[data-danger="true"]:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.5);
    color: rgba(255, 205, 205, 1);
    background: rgba(127, 29, 29, 0.18);
  }
`;

const ToolsError = styled.p`
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(239, 107, 107, 0.3);
  border-radius: 8px;
  color: rgba(255, 200, 200, 0.95);
  background: rgba(60, 14, 18, 0.4);
  font-size: 12px;
  font-weight: 600;
`;

const ToolsNotice = styled.p`
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(60, 203, 127, 0.25);
  border-radius: 8px;
  color: rgba(170, 235, 200, 0.95);
  background: rgba(10, 40, 25, 0.35);
  font-size: 12px;
  font-weight: 600;
`;

const ToolsEmpty = styled.p`
  margin: 0;
  align-self: center;
  justify-self: center;
  color: var(--forge-text-muted, #7a8493);
  font-size: 12px;
`;

// --- Minimalist CLI list (installed-programs style) ------------------------

const CliSearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CliSearchInput = styled(ToolsSearchInput)`
  flex: 1 1 auto;
  width: 100%;
`;

const CliList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  border-radius: 9px;
  background: rgba(7, 9, 13, 0.4);
`;

const CliRow = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--forge-border, rgba(230, 236, 245, 0.05));

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: rgba(230, 236, 245, 0.035);
  }

  /* Install/Uninstall affordances stay hidden until the row is hovered, so
     the resting view is just icon + name + state. */
  [data-hover-only="true"] {
    opacity: 0;
    pointer-events: none;
    transition: opacity 110ms ease;
  }

  &:hover [data-hover-only="true"],
  &:focus-within [data-hover-only="true"] {
    opacity: 1;
    pointer-events: auto;
  }
`;

const CliRowIcon = styled.span`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 6px;
  color: var(--forge-text-soft, #b6c0cc);
  background: rgba(230, 236, 245, 0.06);

  svg {
    width: 14px;
    height: 14px;
  }

  span {
    font-size: 11px;
    font-weight: 800;
  }
`;

const CliRowName = styled.div`
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;

  strong {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const CliRowState = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const cliBusyPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
`;

const CliStateText = styled.span`
  color: var(--forge-text-muted, #7a8493);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;

  &[data-tone="good"] {
    color: rgba(140, 230, 180, 0.95);
  }

  &[data-tone="busy"] {
    color: rgba(240, 200, 140, 0.95);
    animation: ${cliBusyPulse} 1.2s ease-in-out infinite;
  }
`;

const CliRowButton = styled.button`
  padding: 3px 9px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.3);
  border-radius: 6px;
  color: var(--forge-accent-soft, rgba(200, 222, 255, 0.95));
  background: rgba(var(--forge-accent-rgb), 0.12);
  font-size: 10.5px;
  font-weight: 750;
  cursor: pointer;

  &:hover {
    background: rgba(var(--forge-accent-rgb), 0.24);
  }

  &[data-danger="true"] {
    border-color: rgba(239, 107, 107, 0.3);
    color: rgba(250, 180, 180, 0.92);
    background: transparent;
  }

  &[data-danger="true"]:hover {
    background: rgba(127, 29, 29, 0.2);
  }
`;

// --- Skills library (list + detail) ----------------------------------------


const SkillsList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  border-radius: 9px;
  background: rgba(7, 9, 13, 0.4);
`;

const SkillRow = styled.button`
  display: grid;
  width: 100%;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 6px 10px;
  border: 0;
  border-bottom: 1px solid var(--forge-border, rgba(230, 236, 245, 0.05));
  color: var(--forge-text, #f4f7fa);
  background: transparent;
  cursor: pointer;
  text-align: left;

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: rgba(230, 236, 245, 0.035);
  }
`;

const SkillRowIcon = styled.span`
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  border-radius: 8px;
  color: var(--skill-color, #8ea0b8);
  background: color-mix(in srgb, var(--skill-color, #8ea0b8) 14%, transparent);

  svg {
    width: 16px;
    height: 16px;
  }

  .codicon {
    font-size: 16px;
  }

  > span:not(.codicon) {
    font-size: 13px;
    font-weight: 800;
  }
`;

const SkillRowCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 1px;

  strong {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const SkillRowSide = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const SkillRowChevron = styled.span`
  color: var(--forge-text-muted, #7a8493);
  font-size: 15px;
  font-weight: 700;
`;

const SkillSourceBadge = styled.span`
  padding: 2px 7px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.14));
  border-radius: 999px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 9.5px;
  font-weight: 780;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;

  &[data-source="catalog"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.3);
    color: var(--forge-accent-soft, rgba(180, 210, 255, 0.92));
  }

  &[data-source="cli"] {
    border-color: rgba(60, 203, 127, 0.3);
    color: rgba(150, 230, 185, 0.92);
  }

  &[data-source="pending"] {
    border-color: rgba(223, 165, 90, 0.32);
    color: rgba(240, 200, 140, 0.94);
  }
`;

const SkillDetailHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const SkillDetailActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const SkillDetailTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;

  > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong {
    font-size: 16px;
    font-weight: 800;
  }

  span {
    color: var(--forge-text-muted, #7a8493);
    font-size: 12px;
  }
`;

const SkillDetailMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 11px;
  font-weight: 650;
`;

const SkillContent = styled.pre`
  margin: 0;
  min-width: 0;
  overflow-x: auto;
  padding: 14px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  border-radius: 9px;
  color: var(--forge-text, #e8eef8);
  background: rgba(7, 9, 13, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
`;
