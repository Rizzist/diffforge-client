import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import { ArchitectureHubView } from "../architecture/ArchitectureWorkspaceView.jsx";
import McpsWorkspaceView from "../mcps/McpsWorkspaceView.jsx";
import { CLI_CATALOG, cliInstallManager } from "./cliCatalog.js";
import { SKILLS_CATALOG, skillCliBinary, skillCliIcon } from "./skillsCatalog.js";
import {
  parseSkillsLibrary,
  serializeSkillsLibrary,
  skillSlug,
  skillToneColor,
} from "./skillsLibrary.js";
import { noteAccountSkillsMarkdown } from "./workspaceToolsStore.js";

const SECTIONS = [
  { id: "architectures", label: "Architectures" },
  { id: "mcps", label: "MCPs" },
  { id: "skills", label: "Skills" },
  { id: "clis", label: "CLIs" },
];

export const GLOBAL_MCP_DEFAULTS_SCOPE = "global-defaults";
const GLOBAL_MCP_DEFAULTS_WORKSPACE_ID = "account-global-mcp-defaults";
const SKILL_EDITOR_THEME_STORAGE_KEY = "diffforge.tools.skillEditorTheme";

function normalizedSectionId(value, fallback = "architectures") {
  const normalized = text(value);
  return SECTIONS.some((entry) => entry.id === normalized) ? normalized : fallback;
}

function normalizedSkillEditorTheme(value, fallback = "dark") {
  return value === "light" || value === "dark" ? value : fallback;
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
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
        candidate.contract === "diffforge.skills_doc.v1"
        || candidate.contract === "diffforge.account_clis.v1"
        || candidate.contract === "diffforge.account_mcps.v1"
        || candidate.kind === "account_cli_changed"
        || candidate.kind === "account_mcp_changed"
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
    const skills = candidate?.skills;
    if (skills?.skills_md != null || skills?.skillsMd != null) {
      return skills;
    }
  }
  return null;
}

function accountToolsSkillUnitFromEventPayload(payload) {
  const candidates = accountToolsEventCandidates(payload);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const contract = candidate.contract;
    const skill = candidate.skill;
    if (skill && typeof skill === "object" && !Array.isArray(skill)) {
      return skill;
    }
    const units = candidate.skill_units || candidate.skillUnits;
    if (Array.isArray(units) && units.length) {
      return units[0];
    }
    if (contract === "diffforge.skills_doc.v1") {
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

function skillUnitsForSync(skills) {
  return (Array.isArray(skills) ? skills : []).map((skill) => ({
    skillId: text(skill?.id),
    id: text(skill?.id),
    title: text(skill?.title, "Untitled skill"),
    description: text(skill?.description),
    contentMd: String(skill?.content || "").trim(),
    content: String(skill?.content || "").trim(),
    icon: text(skill?.icon),
    source: text(skill?.source, "custom"),
    tone: text(skill?.tone),
    updatedAt: text(skill?.updatedAt),
  })).filter((skill) => skill.id && skill.title);
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
  architectures = null,
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

  // ---- Skills (account-level structured library; the cloud document is
  // still the SKILLS.md blob, synced + offline-cached headlessly by Rust) ----
  const [skillsLibrary, setSkillsLibrary] = useState({ preamble: "", skills: [] });
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
  const [skillsQuery, setSkillsQuery] = useState("");
  // "library:<id>" or "catalog:<id>" — selecting a skill shows its contents.
  const [selectedSkillKey, setSelectedSkillKey] = useState("");
  // { id: ""|skillId, title, description, content } while creating/editing.
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
      meta: "Checking account skill assets",
      percent: 6,
      runId: hydrationRunId,
      state: "hydrating",
      title: "Hydrating skills",
      visible: true,
    });
    if (typeof window !== "undefined") {
      progressTimer = window.setInterval(() => {
        setSkillsHydration((current) => {
          if (current.runId !== hydrationRunId || current.state !== "hydrating") return current;
          const nextPercent = Math.min(92, Math.max(8, Number(current.percent || 0) + 7));
          return {
            ...current,
            meta: nextPercent < 62 ? "Downloading missing skill assets" : "Finalizing skill library",
            percent: nextPercent,
          };
        });
      }, 360);
    }
    setSkillsState((current) => (current === "ready" ? "refreshing" : "loading"));
    setSkillsError("");
    try {
      const data = await invoke("cloud_mcp_get_account_tools");
      const skills = data?.skills || {};
      const skillsMd = text(skills.skills_md ?? skills.skillsMd, "");
      const parsedSkillsLibrary = parseSkillsLibrary(skillsMd);
      setSkillsLibrary(parsedSkillsLibrary);
      noteAccountSkillsMarkdown(skillsMd);
      setSkillsRevision(
        Number.isFinite(Number(skills.revision)) && skills.revision !== null
          ? Number(skills.revision)
          : null,
      );
      setSkillsMeta({
        updatedAt: text(skills.updated_at || skills.updatedAt),
        updatedBy: text(skills.updated_by_device_name || skills.updatedByDeviceName),
        offline: Boolean(data?.offline),
      });
      setSkillsState("ready");
      if (skillsHydrationRunRef.current === hydrationRunId) {
        const units = Array.isArray(data?.skill_units)
          ? data.skill_units
          : Array.isArray(data?.skillUnits)
            ? data.skillUnits
            : [];
        const hydratedUnits = units.filter((unit) => (
          text(unit?.content_md ?? unit?.contentMd ?? unit?.content).length
        ));
        const readyCount = parsedSkillsLibrary.skills.length || units.length;
        const readyLabel = readyCount
          ? `${readyCount} skill${readyCount === 1 ? "" : "s"} ready`
          : "Skill library ready";
        const hydratedLabel = units.length
          ? ` · ${hydratedUnits.length || units.length}/${units.length} downloaded`
          : "";
        const offline = Boolean(data?.offline);
        setSkillsHydration({
          error: "",
          meta: offline ? "Showing cached skills" : `${readyLabel}${hydratedLabel}`,
          percent: 100,
          runId: hydrationRunId,
          state: "ready",
          title: offline ? "Skills loaded from cache" : "Skills hydrated",
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
          meta: "Skill hydration failed",
          percent: 100,
          runId: hydrationRunId,
          state: "error",
          title: "Skill hydration needs attention",
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
    void listen("cloud-mcp-account-tools-updated", (event) => {
      if (disposed) {
        return;
      }
      const skills = accountToolsSkillsFromEventPayload(event?.payload);
      if (skills) {
        const skillsMd = text(skills.skills_md ?? skills.skillsMd, "");
        setSkillsLibrary(parseSkillsLibrary(skillsMd));
        noteAccountSkillsMarkdown(skillsMd);
        setSkillsRevision(
          Number.isFinite(Number(skills.revision)) && skills.revision !== null
            ? Number(skills.revision)
            : null,
        );
        setSkillsMeta({
          updatedAt: text(skills.updated_at || skills.updatedAt),
          updatedBy: text(skills.updated_by_device_name || skills.updatedByDeviceName),
          offline: false,
        });
        setSkillsState("ready");
        setSkillsError("");
        return;
      }
      const skillUnit = accountToolsSkillUnitFromEventPayload(event?.payload);
      const skill = skillFromUnit(skillUnit);
      if (skill) {
        const removed = skillUnit?.deleted === true
          || skillUnit?.current === false
          || skillUnit?.tombstoned === true;
        setSkillsLibrary((current) => {
          const nextSkills = removed
            ? current.skills.filter((entry) => entry.id !== skill.id)
            : [
              ...current.skills.filter((entry) => entry.id !== skill.id),
              skill,
            ].sort((left, right) => left.title.localeCompare(right.title));
          const nextLibrary = { preamble: current.preamble, skills: nextSkills };
          noteAccountSkillsMarkdown(serializeSkillsLibrary(nextLibrary.skills, nextLibrary.preamble));
          return nextLibrary;
        });
        setSkillsRevision(
          Number.isFinite(Number(skillUnit?.revision)) && skillUnit?.revision !== null
            ? Number(skillUnit.revision)
            : skillsRevision,
        );
        setSkillsMeta((current) => ({
          ...current,
          updatedAt: text(skillUnit?.updated_at || skillUnit?.updatedAt, current.updatedAt),
          offline: false,
        }));
        setSkillsState("ready");
        setSkillsError("");
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

  // Applies the next skill list locally right away, then syncs the serialized
  // SKILLS.md through Rust in the background (Rust owns the HTTP call and the
  // offline cache, so the save completes even if the user navigates away).
  const persistSkillsLibrary = useCallback(async (nextSkills) => {
    const nextLibrary = { preamble: skillsLibrary.preamble, skills: nextSkills };
    const serializedSkillsMd = serializeSkillsLibrary(nextLibrary.skills, nextLibrary.preamble);
    setSkillsLibrary(nextLibrary);
    setSkillsState("saving");
    setSkillsError("");
    // Keep the orchestrator Tools tab cache in lockstep with the edit.
    noteAccountSkillsMarkdown(serializedSkillsMd);
    try {
      const result = await invoke("cloud_mcp_save_account_skills", {
        skillsMd: serializedSkillsMd,
        baseRevision: skillsRevision,
        skillUnits: skillUnitsForSync(nextLibrary.skills),
      });
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
      setSkillsMeta((current) => ({
        ...current,
        updatedAt: text(result?.updated_at || result?.updatedAt, current.updatedAt),
        offline: false,
      }));
      setSkillsState("ready");
      return true;
    } catch (error) {
      // Stale revision or offline: the local list keeps the change so nothing
      // is lost; the next successful save syncs the whole document.
      setSkillsError(getErrorMessage(error, "Unable to sync skills."));
      setSkillsState("ready");
      return false;
    }
  }, [skillsLibrary.preamble, skillsRevision]);

  const addCatalogSkill = useCallback((entry) => {
    const existingIds = new Set(skillsLibrary.skills.map((skill) => skill.id));
    if (existingIds.has(entry.id)) {
      setSelectedSkillKey(`library:${entry.id}`);
      return;
    }
    const skill = {
      content: String(entry.content || "").trim(),
      description: text(entry.description),
      icon: text(entry.icon),
      id: entry.id,
      source: text(entry.source, "catalog"),
      title: text(entry.title, entry.id),
      tone: text(entry.tone),
      updatedAt: new Date().toISOString(),
    };
    void persistSkillsLibrary([...skillsLibrary.skills, skill]);
    setSelectedSkillKey(`library:${skill.id}`);
  }, [persistSkillsLibrary, skillsLibrary.skills]);

  const removeSkill = useCallback((skillId) => {
    const skill = skillsLibrary.skills.find((entry) => entry.id === skillId);
    if (!skill) return;
    if (typeof window !== "undefined" && !window.confirm(`Remove the skill "${skill.title}"?`)) {
      return;
    }
    void persistSkillsLibrary(skillsLibrary.skills.filter((entry) => entry.id !== skillId));
    setSelectedSkillKey("");
  }, [persistSkillsLibrary, skillsLibrary.skills]);

  const saveSkillEditor = useCallback(() => {
    if (!skillEditor || !text(skillEditor.title)) return;
    const existing = skillEditor.id
      ? skillsLibrary.skills.find((entry) => entry.id === skillEditor.id)
      : null;
    const updatedAt = new Date().toISOString();
    let nextSkills;
    let savedId;
    if (existing) {
      savedId = existing.id;
      nextSkills = skillsLibrary.skills.map((entry) => (entry.id === existing.id
        ? {
          ...entry,
          content: String(skillEditor.content || "").trim(),
          description: text(skillEditor.description),
          title: text(skillEditor.title),
          updatedAt,
        }
        : entry));
    } else {
      savedId = skillSlug(skillEditor.title, new Set(skillsLibrary.skills.map((entry) => entry.id)));
      nextSkills = [...skillsLibrary.skills, {
        content: String(skillEditor.content || "").trim(),
        description: text(skillEditor.description),
        icon: "",
        id: savedId,
        source: "custom",
        title: text(skillEditor.title),
        tone: "",
        updatedAt,
      }];
    }
    void persistSkillsLibrary(nextSkills);
    setSkillEditor(null);
    setSelectedSkillKey(`library:${savedId}`);
  }, [persistSkillsLibrary, skillEditor, skillsLibrary.skills]);

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

  const skillsStatusLabel = useMemo(() => {
    if (skillsState === "loading") return "Loading…";
    if (skillsState === "saving") return "Syncing…";
    if (skillsMeta.offline) return "Offline — showing cached copy";
    const parts = [];
    if (skillsRevision !== null) parts.push(`rev ${skillsRevision}`);
    if (skillsMeta.updatedAt) parts.push(`updated ${timeAgo(skillsMeta.updatedAt)}`);
    if (skillsMeta.updatedBy) parts.push(`by ${skillsMeta.updatedBy}`);
    return parts.join(" · ") || "Synced to your account";
  }, [skillsMeta, skillsRevision, skillsState]);

  // One merged list (like the CLIs section): personal skills lead, catalog
  // entries the user hasn't added follow, with skills for installed CLIs
  // surfaced first among them. The search also matches ownership labels, so
  // "personal", "curated", "downloadable", or "cli" filter by kind.
  const skillRows = useMemo(() => {
    const query = text(skillsQuery).toLowerCase();
    const ownedIds = new Set(skillsLibrary.skills.map((skill) => skill.id));
    const ownedRows = skillsLibrary.skills.map((skill) => ({
      ...skill,
      key: `library:${skill.id}`,
      owned: true,
      searchLabel: `personal yours ${skill.source === "cli" ? "cli" : skill.source === "catalog" ? "curated" : "custom"}`,
    }));
    const catalogRows = SKILLS_CATALOG
      .filter((entry) => !ownedIds.has(entry.id))
      .map((entry) => {
        const cliInstalled = Boolean(catalogChecks?.[skillCliBinary(entry)]?.installed);
        return {
          ...entry,
          cliInstalled,
          key: `catalog:${entry.id}`,
          owned: false,
          searchLabel: `downloadable catalog curated${cliInstalled ? " cli installed" : ""}`,
        };
      })
      .sort((a, b) => {
        if (a.cliInstalled !== b.cliInstalled) return a.cliInstalled ? -1 : 1;
        if (a.source !== b.source) return a.source === "catalog" ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
    return [...ownedRows, ...catalogRows].filter((row) => (
      !query
        || row.title.toLowerCase().includes(query)
        || String(row.description || "").toLowerCase().includes(query)
        || row.searchLabel.includes(query)
    ));
  }, [catalogChecks, skillsLibrary.skills, skillsQuery]);

  const selectedSkill = useMemo(() => {
    const [scope, ...rest] = selectedSkillKey.split(":");
    const id = rest.join(":");
    if (!id) return null;
    if (scope === "library") {
      const skill = skillsLibrary.skills.find((entry) => entry.id === id);
      return skill ? { ...skill, owned: true } : null;
    }
    if (scope === "catalog") {
      const entry = SKILLS_CATALOG.find((candidate) => candidate.id === id);
      return entry ? { ...entry, owned: false } : null;
    }
    return null;
  }, [selectedSkillKey, skillsLibrary.skills]);

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

      {section === "architectures" && (
        <ToolsHubFill aria-label="Account architectures">
          {architectures ? (
            <ToolsHubStack data-has-progress={architectures.hydration?.visible ? "true" : undefined}>
              <ToolsHydrationProgress placement="hub" progress={architectures.hydration} />
              <ArchitectureHubView
                catalog={architectures.catalog}
                catalogError={architectures.catalogError}
                catalogState={architectures.catalogState}
                graphLists={architectures.graphLists}
                onCopyGraph={architectures.onCopyGraph}
                onGraphListRefresh={architectures.onGraphListRefresh}
                onRefreshCatalog={architectures.onRefreshCatalog}
                onSelectionChange={architectures.onSelectionChange}
                resolveRepoSyncContext={architectures.resolveRepoSyncContext}
                selectedGraphId={architectures.selectedGraphId}
                selectedRepoPath={architectures.selectedRepoPath}
              />
            </ToolsHubStack>
          ) : (
            <ToolsEmpty>Architectures are unavailable right now.</ToolsEmpty>
          )}
        </ToolsHubFill>
      )}

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

      {(section === "skills" || section === "clis") && (
        <ToolsScroll>
          <ToolsLayout>
            {section === "skills" && (
              <ToolsPanel aria-label="Skills" data-mode={skillEditor ? "editor" : undefined}>
                <ToolsHydrationProgress
                  placement={skillEditor ? "editor" : "panel"}
                  progress={skillsHydration}
                />
                {skillEditor ? (
                  <>
                    <SkillDocumentEditor data-page-theme={skillEditorTheme}>
                      <SkillDocumentToolbar>
                        <SkillDocumentToolbarCopy>
                          <ToolsPanelTitle>{skillEditor.id ? "Edit skill" : "New skill"}</ToolsPanelTitle>
                          <ToolsPanelHint>
                            Skills sync to your account and feed every coding agent.
                          </ToolsPanelHint>
                        </SkillDocumentToolbarCopy>
                        <SkillDocumentToolbarControls>
                          <ToolsStatusPill data-tone={skillsMeta.offline ? "warn" : "good"}>
                            {skillsStatusLabel}
                          </ToolsStatusPill>
                          <SkillDocumentThemeSwitch aria-label="Skill editor page theme">
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
                            aria-label="Skill title"
                            onChange={(event) => setSkillEditor((current) => ({ ...current, title: event.target.value }))}
                            placeholder="Untitled skill"
                            value={skillEditor.title}
                          />
                          <SkillDocumentDescriptionInput
                            aria-label="Skill description"
                            onChange={(event) => setSkillEditor((current) => ({ ...current, description: event.target.value }))}
                            placeholder="One-line description"
                            value={skillEditor.description}
                          />
                          <ToolsSkillsEditor
                            aria-label="Skill content"
                            onChange={(event) => setSkillEditor((current) => ({ ...current, content: event.target.value }))}
                            placeholder={"Document the workflow, commands, and conventions this skill covers..."}
                            spellCheck={false}
                            value={skillEditor.content}
                          />
                        </SkillDocumentPage>
                      </SkillDocumentCanvas>
                    </SkillDocumentEditor>
                    {skillsError && <ToolsError role="alert">{skillsError}</ToolsError>}
                    <SkillDocumentActions>
                      <ToolsGhostButton onClick={() => setSkillEditor(null)} type="button">
                        Cancel
                      </ToolsGhostButton>
                      <ToolsPrimaryButton
                        disabled={!text(skillEditor.title) || skillsState === "saving"}
                        onClick={saveSkillEditor}
                        type="button"
                      >
                        {skillsState === "saving" ? "Syncing…" : "Save skill"}
                      </ToolsPrimaryButton>
                    </SkillDocumentActions>
                  </>
                ) : selectedSkill ? (
                  <>
                    <SkillDetailHeader>
                      <ToolsGhostButton onClick={() => setSelectedSkillKey("")} type="button">
                        ‹ Skills
                      </ToolsGhostButton>
                      <SkillDetailActions>
                        {selectedSkill.owned ? (
                          <>
                            <ToolsGhostButton
                              onClick={() => setSkillEditor({
                                content: selectedSkill.content,
                                description: selectedSkill.description,
                                id: selectedSkill.id,
                                title: selectedSkill.title,
                              })}
                              type="button"
                            >
                              Edit
                            </ToolsGhostButton>
                            <ToolsGhostButton
                              data-danger="true"
                              onClick={() => removeSkill(selectedSkill.id)}
                              type="button"
                            >
                              Remove
                            </ToolsGhostButton>
                          </>
                        ) : (
                          <ToolsPrimaryButton
                            disabled={skillsState === "saving"}
                            onClick={() => addCatalogSkill(selectedSkill)}
                            type="button"
                          >
                            {skillsState === "saving" ? "Adding…" : "Add to my skills"}
                          </ToolsPrimaryButton>
                        )}
                      </SkillDetailActions>
                    </SkillDetailHeader>
                    <SkillDetailTitle>
                      <SkillRowIcon
                        aria-hidden="true"
                        style={{ "--skill-color": skillToneColor(selectedSkill.tone, selectedSkill.title) }}
                      >
                        <SkillIconGlyph icon={selectedSkill.icon} title={selectedSkill.title} />
                      </SkillRowIcon>
                      <div>
                        <strong>{selectedSkill.title}</strong>
                        <span>{selectedSkill.description}</span>
                      </div>
                    </SkillDetailTitle>
                    <SkillDetailMeta>
                      <SkillSourceBadge data-source={selectedSkill.source}>
                        {selectedSkill.source === "cli"
                          ? "CLI skill"
                          : selectedSkill.source === "catalog"
                            ? "Curated"
                            : "Custom"}
                      </SkillSourceBadge>
                      {selectedSkill.owned && selectedSkill.updatedAt && (
                        <span>updated {timeAgo(selectedSkill.updatedAt)}</span>
                      )}
                      {!selectedSkill.owned && <span>preview — not in your library yet</span>}
                    </SkillDetailMeta>
                    {skillsError && <ToolsError role="alert">{skillsError}</ToolsError>}
                    <SkillContent>{selectedSkill.content || "This skill has no content yet."}</SkillContent>
                  </>
                ) : (
                  <>
                    <CliSearchRow>
                      <CliSearchInput
                        aria-label="Search skills"
                        onChange={(event) => setSkillsQuery(event.target.value)}
                        placeholder="Search skills…"
                        type="search"
                        value={skillsQuery}
                      />
                      <ToolsGhostButton
                        onClick={() => setSkillEditor({ content: "", description: "", id: "", title: "" })}
                        type="button"
                      >
                        New skill
                      </ToolsGhostButton>
                      <ToolsStatusPill data-tone={skillsMeta.offline ? "warn" : "good"}>
                        {skillsStatusLabel}
                      </ToolsStatusPill>
                    </CliSearchRow>
                    {skillsError && <ToolsError role="alert">{skillsError}</ToolsError>}
                    {skillsState === "loading" ? (
                      <ToolsEmpty>Loading skills…</ToolsEmpty>
                    ) : (
                      <>
                        <SkillsList role="list">
                          {skillRows.map((row) => (
                            <SkillRow
                              key={row.key}
                              onClick={() => setSelectedSkillKey(row.key)}
                              role="listitem"
                              type="button"
                            >
                              <SkillRowIcon
                                aria-hidden="true"
                                style={{ "--skill-color": skillToneColor(row.tone, row.title) }}
                              >
                                <SkillIconGlyph icon={row.icon} title={row.title} />
                              </SkillRowIcon>
                              <SkillRowCopy>
                                <strong>{row.title}</strong>
                                <span>{row.description || "No description"}</span>
                              </SkillRowCopy>
                              <SkillRowSide>
                                {row.owned ? (
                                  <>
                                    <SkillSourceBadge data-source={row.source}>
                                      Personal
                                    </SkillSourceBadge>
                                    <SkillRowChevron aria-hidden="true">›</SkillRowChevron>
                                  </>
                                ) : (
                                  <>
                                    {row.cliInstalled && (
                                      <SkillSourceBadge data-source="cli">CLI installed</SkillSourceBadge>
                                    )}
                                    <CliRowButton
                                      disabled={skillsState === "saving"}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        addCatalogSkill(row);
                                      }}
                                      type="button"
                                    >
                                      Add
                                    </CliRowButton>
                                  </>
                                )}
                              </SkillRowSide>
                            </SkillRow>
                          ))}
                          {!skillRows.length && (
                            <ToolsEmpty>
                              {text(skillsQuery)
                                ? "No skills match your search."
                                : "No skills yet — create one or add a downloadable skill."}
                            </ToolsEmpty>
                          )}
                        </SkillsList>
                      </>
                    )}
                  </>
                )}
              </ToolsPanel>
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
`;

const ToolsHydrationPanel = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(125, 176, 255, 0.22);
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
  background: linear-gradient(90deg, #7db0ff, #8fe0aa);
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
    background: rgba(125, 176, 255, 0.14);
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
  min-width: 0;
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
    background: rgba(125, 176, 255, 0.16);
  }

  &:hover:not([data-active="true"]) {
    color: var(--forge-text-soft, #b6c0cc);
  }
`;

const SkillDocumentCanvas = styled.div`
  display: grid;
  justify-items: center;
  min-width: 0;
  min-height: 540px;
  max-height: min(72vh, 780px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: clamp(18px, 3.5vw, 34px);
  background: var(--skill-editor-desk);
`;

const SkillDocumentPage = styled.div`
  display: grid;
  align-content: start;
  width: min(780px, 100%);
  min-height: 900px;
  padding: clamp(34px, 5vw, 58px) clamp(28px, 6vw, 70px) 64px;
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
  font-size: clamp(24px, 3.2vw, 34px);
  font-weight: 760;
  line-height: 1.18;
  outline: none;

  &::placeholder {
    color: var(--skill-editor-page-placeholder);
  }
`;

const SkillDocumentDescriptionInput = styled.input`
  width: 100%;
  min-width: 0;
  margin-top: 12px;
  padding: 0 0 18px;
  border: 0;
  border-bottom: 1px solid var(--skill-editor-page-rule);
  color: var(--skill-editor-page-muted);
  background: transparent;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  font-weight: 640;
  line-height: 1.45;
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
    box-shadow: inset 3px 0 0 rgba(125, 176, 255, 0.36);
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
  border: 1px solid rgba(125, 176, 255, 0.35);
  border-radius: 8px;
  color: rgba(200, 222, 255, 0.98);
  background: rgba(59, 130, 246, 0.18);
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.3);
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

const ToolsSearchInput = styled.input`
  width: min(220px, 100%);
  padding: 7px 11px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  color: var(--forge-text, #f4f7fa);
  background: rgba(7, 9, 13, 0.55);
  font-size: 12px;

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.35);
    outline-offset: -1px;
  }
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
  border: 1px solid rgba(125, 176, 255, 0.3);
  border-radius: 6px;
  color: rgba(200, 222, 255, 0.95);
  background: rgba(59, 130, 246, 0.12);
  font-size: 10.5px;
  font-weight: 750;
  cursor: pointer;

  &:hover {
    background: rgba(59, 130, 246, 0.24);
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
    border-color: rgba(125, 176, 255, 0.3);
    color: rgba(180, 210, 255, 0.92);
  }

  &[data-source="cli"] {
    border-color: rgba(60, 203, 127, 0.3);
    color: rgba(150, 230, 185, 0.92);
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
