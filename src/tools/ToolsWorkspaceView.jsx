import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import { ArchitectureHubView } from "../architecture/ArchitectureWorkspaceView.jsx";
import McpsWorkspaceView from "../mcps/McpsWorkspaceView.jsx";
import { CLI_CATALOG, cliInstallManager } from "./cliCatalog.js";
import { MCP_CATALOG } from "./mcpCatalog.js";

const SECTIONS = [
  { id: "architectures", label: "Architectures" },
  { id: "mcps", label: "MCPs" },
  { id: "skills", label: "Skills" },
  { id: "clis", label: "CLIs" },
];

export const GLOBAL_MCP_DEFAULTS_SCOPE = "global-defaults";
const GLOBAL_MCP_DEFAULTS_WORKSPACE_ID = "account-global-mcp-defaults";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function getErrorMessage(error, fallback) {
  return error?.message || String(error || fallback || "Something went wrong.");
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

export default function ToolsWorkspaceView({
  architectures = null,
  defaultWorkingDirectory = "",
  initialSection = "",
  workspaces = [],
}) {
  const [section, setSection] = useState(() => (
    SECTIONS.some((entry) => entry.id === text(initialSection)) ? text(initialSection) : "architectures"
  ));

  // ---- MCP scope (global defaults vs per-workspace) ----
  const [mcpScope, setMcpScope] = useState(GLOBAL_MCP_DEFAULTS_SCOPE);
  const [mcpCatalogOpen, setMcpCatalogOpen] = useState(false);
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

  // ---- Skills (account-level, server synced) ----
  const [skillsDraft, setSkillsDraft] = useState("");
  const [skillsRevision, setSkillsRevision] = useState(null);
  const [skillsMeta, setSkillsMeta] = useState({ updatedAt: "", updatedBy: "", offline: false });
  const [skillsState, setSkillsState] = useState("loading");
  const [skillsError, setSkillsError] = useState("");
  const [skillsDirty, setSkillsDirty] = useState(false);

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
    setSkillsState((current) => (current === "ready" ? "refreshing" : "loading"));
    setSkillsError("");
    try {
      const data = await invoke("cloud_mcp_get_account_tools");
      const skills = data?.skills || {};
      const skillsMd = text(skills.skills_md ?? skills.skillsMd, "");
      setSkillsDraft((current) => (skillsDirty ? current : skillsMd));
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
    } catch (error) {
      setSkillsError(getErrorMessage(error, "Unable to load account tools."));
      setSkillsState("error");
    }
  }, [skillsDirty]);

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

  const saveSkills = useCallback(async () => {
    setSkillsState("saving");
    setSkillsError("");
    try {
      const result = await invoke("cloud_mcp_save_account_skills", {
        skillsMd: skillsDraft,
        baseRevision: skillsRevision,
      });
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
      setSkillsMeta((current) => ({
        ...current,
        updatedAt: text(result?.updated_at || result?.updatedAt, current.updatedAt),
        offline: false,
      }));
      setSkillsDirty(false);
      setSkillsState("ready");
    } catch (error) {
      const message = getErrorMessage(error, "Unable to save SKILLS.md.");
      setSkillsError(message);
      setSkillsState("ready");
      if (message.includes("changed on another device")) {
        // Stale revision: keep the draft so nothing is lost; the user can
        // reload to pick up the remote version first.
      }
    }
  }, [skillsDraft, skillsRevision]);

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

  const visibleCatalog = useMemo(() => {
    const query = text(catalogQuery).toLowerCase();
    if (!query) return CLI_CATALOG;
    return CLI_CATALOG.filter((entry) => (
      entry.label.toLowerCase().includes(query) || entry.binary.toLowerCase().includes(query)
    ));
  }, [catalogQuery]);

  const skillsStatusLabel = useMemo(() => {
    if (skillsState === "loading") return "Loading…";
    if (skillsState === "saving") return "Saving…";
    if (skillsMeta.offline) return "Offline — showing cached copy";
    if (skillsDirty) return "Unsaved changes";
    const parts = [];
    if (skillsRevision !== null) parts.push(`rev ${skillsRevision}`);
    if (skillsMeta.updatedAt) parts.push(`updated ${timeAgo(skillsMeta.updatedAt)}`);
    if (skillsMeta.updatedBy) parts.push(`by ${skillsMeta.updatedBy}`);
    return parts.join(" · ") || "Synced to your account";
  }, [skillsDirty, skillsMeta, skillsRevision, skillsState]);

  return (
    <ToolsHubShell aria-label="Global toolkit" data-section={section}>
      <ToolsHubHeader>
        <div>
          <ToolsKicker>Toolkit</ToolsKicker>
          <ToolsHeading>Architectures, MCPs, Skills &amp; CLIs</ToolsHeading>
          <ToolsHint>
            Architectures and skills sync at the account level; CLIs live on this device.
            MCPs have global defaults plus per-workspace settings.
          </ToolsHint>
        </div>
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
          ) : (
            <ToolsEmpty>Architectures are unavailable right now.</ToolsEmpty>
          )}
        </ToolsHubFill>
      )}

      {section === "mcps" && (
        <ToolsMcpPane aria-label="MCP settings">
          <ToolsScopeBar>
            <ToolsScopeCopy>
              <strong>MCP scope</strong>
              <span>
                {activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE
                  ? "Global defaults are copied into every new workspace; existing workspaces keep their own settings."
                  : "Workspace-level MCP settings override the global defaults for this workspace only."}
              </span>
            </ToolsScopeCopy>
            <ToolsScopeControls>
              <ToolsScopeSelect
                aria-label="MCP settings scope"
                onChange={(event) => setMcpScope(event.target.value)}
                value={activeMcpScope}
              >
                <option value={GLOBAL_MCP_DEFAULTS_SCOPE}>Global defaults (new workspaces inherit)</option>
                {workspaceOptions.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </ToolsScopeSelect>
              <ToolsGhostButton
                onClick={() => setMcpCatalogOpen((open) => !open)}
                type="button"
              >
                {mcpCatalogOpen ? "Hide popular servers" : "Popular servers"}
              </ToolsGhostButton>
            </ToolsScopeControls>
          </ToolsScopeBar>
          {mcpCatalogOpen && (
            <ToolsPanel aria-label="Popular MCP servers">
              <ToolsPanelTopline>
                <div>
                  <ToolsPanelTitle>Popular MCP servers</ToolsPanelTitle>
                  <ToolsPanelHint>
                    Copy a launch command, then paste it into the marketplace box below to add it
                    to the selected scope.
                  </ToolsPanelHint>
                </div>
              </ToolsPanelTopline>
              <ToolsCatalogGrid>
                {MCP_CATALOG.map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <ToolsCatalogCard key={entry.id}>
                      <ToolsCatalogIcon aria-hidden="true">
                        {Icon ? <Icon /> : <span>{entry.label.slice(0, 1)}</span>}
                      </ToolsCatalogIcon>
                      <ToolsCatalogCopy>
                        <strong>{entry.label}</strong>
                        <span title={entry.command}>{entry.command}</span>
                      </ToolsCatalogCopy>
                      <ToolsCatalogButton
                        onClick={() => {
                          navigator?.clipboard?.writeText?.(entry.command);
                          setCliMessage(`Copied ${entry.label} command`);
                          window.setTimeout(() => setCliMessage(""), 2000);
                        }}
                        type="button"
                      >
                        Copy
                      </ToolsCatalogButton>
                    </ToolsCatalogCard>
                  );
                })}
              </ToolsCatalogGrid>
              {cliMessage && <ToolsNotice>{cliMessage}</ToolsNotice>}
            </ToolsPanel>
          )}
          {globalMcpDefaults.error && activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE && (
            <ToolsError role="alert">{globalMcpDefaults.error}</ToolsError>
          )}
          <ToolsHubFill>
            {mcpScopeReady && activeMcpWorkspace ? (
              <McpsWorkspaceView
                defaultWorkingDirectory={activeMcpRootDirectory || defaultWorkingDirectory}
                key={activeMcpScope}
                rootDirectory={activeMcpRootDirectory}
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
              <ToolsPanel aria-label="Account skills">
                <ToolsPanelTopline>
                  <div>
                    <ToolsPanelTitle>SKILLS.md</ToolsPanelTitle>
                    <ToolsPanelHint>
                      One shared playbook for your coding agents, synced at the account level.
                      Pair it with the CLIs below — skills describe how, CLIs do the work.
                    </ToolsPanelHint>
                  </div>
                  <ToolsStatusPill data-tone={skillsMeta.offline ? "warn" : skillsDirty ? "warn" : "good"}>
                    {skillsStatusLabel}
                  </ToolsStatusPill>
                </ToolsPanelTopline>
                <ToolsSkillsEditor
                  aria-label="SKILLS.md content"
                  disabled={skillsState === "loading" || skillsState === "saving"}
                  onChange={(event) => {
                    setSkillsDraft(event.target.value);
                    setSkillsDirty(true);
                  }}
                  placeholder={"# Skills\n\nDocument the repeatable workflows, commands, and conventions your agents should know…"}
                  spellCheck={false}
                  value={skillsDraft}
                />
                {skillsError && <ToolsError role="alert">{skillsError}</ToolsError>}
                <ToolsPanelActions>
                  <ToolsGhostButton
                    disabled={skillsState === "loading" || skillsState === "saving"}
                    onClick={() => {
                      setSkillsDirty(false);
                      void loadAccountTools();
                    }}
                    type="button"
                  >
                    Reload
                  </ToolsGhostButton>
                  <ToolsPrimaryButton
                    disabled={!skillsDirty || skillsState === "saving" || skillsMeta.offline}
                    onClick={saveSkills}
                    type="button"
                  >
                    {skillsState === "saving" ? "Saving…" : "Save & sync"}
                  </ToolsPrimaryButton>
                </ToolsPanelActions>
              </ToolsPanel>
            )}

            {section === "clis" && (
              <ToolsPanel aria-label="Coding CLIs">
                <ToolsPanelTopline>
                  <div>
                    <ToolsPanelTitle>Coding CLIs</ToolsPanelTitle>
                    <ToolsPanelHint>
                      Install state lives on this device and is reported to your account, so every
                      device knows what is available where.
                    </ToolsPanelHint>
                  </div>
                  <ToolsGhostButton
                    disabled={cliState === "loading" || cliState === "refreshing"}
                    onClick={() => void refreshCliStatuses()}
                    type="button"
                  >
                    {cliState === "refreshing" ? "Refreshing…" : "Refresh"}
                  </ToolsGhostButton>
                </ToolsPanelTopline>
                {cliError && <ToolsError role="alert">{cliError}</ToolsError>}
                {cliMessage && <ToolsNotice>{cliMessage}</ToolsNotice>}
                {cliState === "loading" ? (
                  <ToolsEmpty>Checking installed CLIs…</ToolsEmpty>
                ) : (
                  <ToolsCliGrid>
                    {cliStatuses.map((status) => {
                      const provider = text(status?.provider || status?.id);
                      const busyAction = cliBusy[provider] || "";
                      const installed = Boolean(status?.installed);
                      const updateAvailable = Boolean(status?.npmUpdateAvailable || status?.npm_update_available);
                      const version = text(status?.version);
                      return (
                        <ToolsCliCard data-installed={installed ? "true" : "false"} key={provider}>
                          <ToolsCliTopline>
                            <strong>{text(status?.label, provider)}</strong>
                            <ToolsStatusPill data-tone={installed ? "good" : "muted"}>
                              {busyAction
                                ? `${busyAction === "install" ? "Installing" : busyAction === "update" ? "Updating" : "Uninstalling"}…`
                                : installed
                                  ? version
                                    ? `Installed · ${version}`
                                    : "Installed"
                                  : "Not installed"}
                            </ToolsStatusPill>
                          </ToolsCliTopline>
                          <ToolsCliMeta>
                            {Boolean(status?.authenticated) && <span>signed in</span>}
                            {updateAvailable && <span data-tone="warn">update available</span>}
                            {text(status?.activeModel || status?.active_model) && (
                              <span>{text(status?.activeModel || status?.active_model)}</span>
                            )}
                          </ToolsCliMeta>
                          <ToolsCliActions>
                            {!installed && (
                              <ToolsPrimaryButton
                                disabled={Boolean(busyAction)}
                                onClick={() => void runCliAction(provider, "install")}
                                type="button"
                              >
                                {busyAction === "install" ? "Installing…" : "Install"}
                              </ToolsPrimaryButton>
                            )}
                            {installed && updateAvailable && (
                              <ToolsPrimaryButton
                                disabled={Boolean(busyAction)}
                                onClick={() => void runCliAction(provider, "update")}
                                type="button"
                              >
                                {busyAction === "update" ? "Updating…" : "Update"}
                              </ToolsPrimaryButton>
                            )}
                            {installed && (
                              <ToolsDangerButton
                                disabled={Boolean(busyAction)}
                                onClick={() => void runCliAction(provider, "uninstall")}
                                type="button"
                              >
                                {busyAction === "uninstall" ? "Uninstalling…" : "Uninstall"}
                              </ToolsDangerButton>
                            )}
                          </ToolsCliActions>
                        </ToolsCliCard>
                      );
                    })}
                  </ToolsCliGrid>
                )}

                <ToolsPanelTopline>
                  <div>
                    <ToolsPanelTitle>Developer CLI catalog</ToolsPanelTitle>
                    <ToolsPanelHint>
                      {`${CLI_CATALOG.length} common developer CLIs. Detection runs on this device; installs use Homebrew or npm.`}
                    </ToolsPanelHint>
                  </div>
                  <ToolsSearchInput
                    aria-label="Filter CLI catalog"
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Filter CLIs…"
                    type="search"
                    value={catalogQuery}
                  />
                </ToolsPanelTopline>
                <ToolsCatalogGrid>
                  {visibleCatalog.map((entry) => {
                    const Icon = entry.icon;
                    const check = catalogChecks?.[entry.binary] || {};
                    const installed = Boolean(check.installed);
                    const busyAction = catalogBusy[entry.id] || "";
                    const manageable = Boolean(cliInstallManager(entry));
                    return (
                      <ToolsCatalogCard data-installed={installed ? "true" : "false"} key={entry.id}>
                        <ToolsCatalogIcon aria-hidden="true">
                          {Icon ? <Icon /> : <span>{entry.label.slice(0, 1)}</span>}
                        </ToolsCatalogIcon>
                        <ToolsCatalogCopy>
                          <strong>{entry.label}</strong>
                          <span>{installed ? "installed" : "not installed"}</span>
                        </ToolsCatalogCopy>
                        {busyAction ? (
                          <ToolsStatusPill data-tone="warn">
                            {busyAction === "install" ? "Installing…" : "Removing…"}
                          </ToolsStatusPill>
                        ) : installed ? (
                          manageable ? (
                            <ToolsCatalogButton
                              data-danger="true"
                              onClick={() => void runCatalogAction(entry, "uninstall")}
                              type="button"
                            >
                              Uninstall
                            </ToolsCatalogButton>
                          ) : (
                            <ToolsStatusPill data-tone="good">Installed</ToolsStatusPill>
                          )
                        ) : manageable ? (
                          <ToolsCatalogButton
                            onClick={() => void runCatalogAction(entry, "install")}
                            type="button"
                          >
                            Install
                          </ToolsCatalogButton>
                        ) : (
                          <ToolsStatusPill data-tone="muted">Manual</ToolsStatusPill>
                        )}
                      </ToolsCatalogCard>
                    );
                  })}
                </ToolsCatalogGrid>
              </ToolsPanel>
            )}
          </ToolsLayout>
        </ToolsScroll>
      )}
    </ToolsHubShell>
  );
}

const ToolsHubShell = styled.section`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--forge-text);
`;

const ToolsHubHeader = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
`;

const ToolsHubFill = styled.div`
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ToolsScroll = styled.div`
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 24px;
`;

const ToolsMcpPane = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding: 12px 16px 0;
`;

const ToolsScopeBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.6);
`;

const ToolsScopeCopy = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    font-size: 12px;
    font-weight: 800;
  }

  span {
    color: var(--forge-text-muted, #7a8493);
    font-size: 11px;
  }
`;

const ToolsScopeControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const ToolsScopeSelect = styled.select`
  min-width: 220px;
  padding: 8px 10px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.14));
  border-radius: 8px;
  color: var(--forge-text, #f4f7fa);
  background: rgba(7, 9, 13, 0.6);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.35);
    outline-offset: -1px;
  }
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

const ToolsKicker = styled.span`
  display: block;
  color: var(--forge-text-muted, #7a8493);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const ToolsHeading = styled.h2`
  margin: 2px 0 4px;
  font-size: 18px;
  font-weight: 800;
`;

const ToolsHint = styled.p`
  margin: 0;
  color: var(--forge-text-muted, #7a8493);
  font-size: 12px;
`;

const ToolsSectionNav = styled.nav`
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 9px;
  background: rgba(7, 9, 13, 0.5);
`;

const ToolsSectionButton = styled.button`
  padding: 6px 14px;
  border: 0;
  border-radius: 7px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

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
`;

const ToolsPanelTopline = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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
  padding: 4px 10px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 999px;
  color: var(--forge-text-soft, #b6c0cc);
  font-size: 10px;
  font-weight: 750;
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

const ToolsSkillsEditor = styled.textarea`
  width: 100%;
  min-height: 320px;
  padding: 12px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 8px;
  color: var(--forge-text, #f4f7fa);
  background: rgba(7, 9, 13, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12.5px;
  line-height: 1.55;
  resize: vertical;

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.35);
    outline-offset: -1px;
  }
`;

const ToolsPanelActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
`;

const ToolsDangerButton = styled(ToolsGhostButton)`
  border-color: rgba(239, 107, 107, 0.3);
  color: rgba(250, 180, 180, 0.92);

  &:hover:not(:disabled) {
    color: rgba(255, 205, 205, 1);
    border-color: rgba(239, 107, 107, 0.5);
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

const ToolsCliGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
`;

const ToolsCliCard = styled.article`
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 9px;
  background: rgba(7, 9, 13, 0.45);

  &[data-installed="true"] {
    border-color: rgba(60, 203, 127, 0.18);
  }
`;

const ToolsCliTopline = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  strong {
    font-size: 13px;
    font-weight: 800;
  }
`;

const ToolsCliMeta = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 14px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 11px;
  font-weight: 600;

  span[data-tone="warn"] {
    color: rgba(240, 200, 140, 0.95);
  }
`;

const ToolsCliActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

const ToolsCatalogGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
`;

const ToolsCatalogCard = styled.article`
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  border-radius: 9px;
  background: rgba(7, 9, 13, 0.4);

  &[data-installed="true"] {
    border-color: rgba(60, 203, 127, 0.16);
  }
`;

const ToolsCatalogIcon = styled.span`
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--forge-text-soft, #b6c0cc);
  background: rgba(230, 236, 245, 0.06);

  svg {
    width: 15px;
    height: 15px;
  }

  span {
    font-size: 12px;
    font-weight: 800;
  }
`;

const ToolsCatalogCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 1px;

  strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    font-weight: 650;
  }
`;

const ToolsCatalogButton = styled.button`
  padding: 5px 10px;
  border: 1px solid rgba(125, 176, 255, 0.3);
  border-radius: 7px;
  color: rgba(200, 222, 255, 0.95);
  background: rgba(59, 130, 246, 0.12);
  font-size: 11px;
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
