import { useMemo, useState } from "react";

import {
  GlobalStyle,
  AppFrame,
  WindowTitleBar,
  WindowTitle,
  WindowControls,
  WindowControlButton,
  AppContent,
  workspaceCloseSpin,
  WorkspaceCloseOverlay,
  WorkspaceClosePanel,
  WorkspaceCloseSpinner,
  WorkspaceCloseTitle,
  WorkspaceCloseDetail,
  WorkspaceCloseCounter,
  WorkspaceCloseProgressTrack,
  WorkspaceCloseProgressBar,
  splashPulse,
  loadingOrangeSweep,
  shellReveal,
  railReveal,
  sideReveal,
  panelEnter,
  panelExit,
  quietSweep,
  squareFade,
  SplashScreen,
  AmbientPanel,
  SplashCenter,
  SplashLogo,
  SplashTitle,
  SplashTagline,
  LoadingTrack,
  LoadingFill,
  LoadingText,
  LoadingDetail,
  LaunchStatusPanel,
  LaunchStatusIcon,
  LaunchStatusCopy,
  LaunchActions,
  LoginScreen,
  LoginLayout,
  SquareField,
  SquarePulse,
  BrandPanel,
  BrandMark,
  IntroCopy,
  Kicker,
  Headline,
  Lede,
  IntroFeatureList,
  IntroFeature,
  ApiStatus,
  StatusSummary,
  StatusBadge,
  iconPulse,
  statusIconSize,
  ConnectedIcon,
  ErrorIcon,
  PendingIcon,
  StatusButton,
  ApiBase,
  PricingScreen,
  PricingHero,
  PricingCopy,
  PricingTitle,
  PricingText,
  PricingActions,
  PricingPlans,
  PricingPlanCard,
  PlanEyebrow,
  PlanPrice,
  PlanDescription,
  PlanFeatureList,
  AuthenticatedWorkspaceFrame,
  WorkspaceStartupOverlay,
  DashboardShell,
  WorkspaceRail,
  RailTop,
  RailSectionTitle,
  WorkspaceList,
  WorkspaceRow,
  WorkspaceButton,
  WorkspaceLabel,
  WorkspaceSettingsButton,
  WorkspaceAccent,
  WorkspaceMuted,
  RailFooter,
  RailActionButton,
  BlankWorkspace,
  ForgeWorkspace,
  TerminalWorkspaceSurface,
  WorkspaceTerminalPanels,
  ResizePanelGroup,
  ResizePanel,
  ResizeHandle,
  TerminalDevMetricsBar,
  TerminalDevMetric,
  TerminalFrame,
  XtermSurface,
  TerminalClosedSurface,
  TerminalClosedLabel,
  TerminalRestartPill,
  TerminalRestartButton,
  TerminalCloseButton,
  TerminalEmptyPanel,
  TerminalEmptyActions,
  TerminalEmptyCopy,
  TerminalAgentList,
  TerminalAgentRow,
  FilesWorkspaceSurface,
  FileExplorerPane,
  FileExplorerHeader,
  FileExplorerActions,
  FileIconButton,
  FileRootPath,
  FileTree,
  FileTreeItem,
  FileTreeButton,
  FileDisclosure,
  FileKindIcon,
  FileTreeName,
  FileGitStatusMark,
  FileTreeChildren,
  FileTreeMessage,
  FileTreeEmpty,
  FilePreviewPane,
  FilePreviewHeader,
  FilePreviewTitle,
  FilePreviewMeta,
  FileGitStatusPill,
  FileMetaPill,
  FilePreviewPath,
  FileContentFrame,
  FilePreviewScroll,
  HighlightedCodeBlock,
  FileDiffPanel,
  FileDiffHeader,
  FileDiffBadge,
  FileDiffMessage,
  DiffCodeBlock,
  DiffLine,
  FileEmptyState,
  FileEmptyIcon,
  VaultWorkspaceSurface,
  VaultPlaceholderPanel,
  VaultPlaceholderIcon,
  VaultStatusGrid,
  AudioWorkspaceSurface,
  AudioSetupPanel,
  AudioHeroRow,
  AudioStatePill,
  AudioStatusGrid,
  AudioPathBlock,
  AudioCodePath,
  AudioRuntimeHint,
  AudioProgressPanel,
  AudioProgressTopline,
  AudioProgressTrack,
  AudioProgressBar,
  AudioProgressMeta,
  AudioActionRow,
  AudioWidgetShell,
  AudioWidgetHeader,
  AudioWidgetTitle,
  AudioWidgetMeter,
  AudioWidgetStatus,
  AudioRecordingTimer,
  AudioWidgetTranscript,
  AudioWidgetActions,
  McpWorkspaceSurface,
  McpHeaderPanel,
  McpTitleRow,
  McpStatsGrid,
  McpLayout,
  McpRegistryPanel,
  McpPanelTopline,
  McpServerList,
  McpServerButton,
  McpServerIcon,
  McpServerCopy,
  McpStatusBadge,
  McpEditorPanel,
  McpEditorHeader,
  McpSwitchButton,
  McpFieldGrid,
  McpWideField,
  McpInput,
  McpTextarea,
  McpJsonTextarea,
  McpTransportTabs,
  McpTransportButton,
  McpAccessGrid,
  McpAccessPanel,
  McpAccessTopline,
  McpInlineActions,
  McpCheckList,
  McpCheckRow,
  McpEmptyAccess,
  McpScopePreview,
  McpEditorActions,
  WorkspaceSetupPanel,
  SetupHeader,
  SetupField,
  SetupInput,
  BlankStatusStack,
  WorkspaceSettingsOverlay,
  WorkspaceSettingsDialog,
  WorkspaceSettingsDialogHeader,
  WorkspaceModalCloseButton,
  WorkspaceSettingsForm,
  WorkspaceSettingsInput,
  WorkspaceNumberInput,
  RootDirectoryInput,
  WorkspaceSettingsFieldGrid,
  WorkspaceSettingsActions,
  AgentSettingsPanel,
  AgentPanelActions,
  AgentReadyPill,
  AgentCardGrid,
  AgentCard,
  AgentCardHeader,
  AgentIcon,
  AgentName,
  AgentMeta,
  AgentStatusText,
  AgentInstallPanel,
  AgentInstallTopline,
  AgentInstallBadge,
  AgentInstallHint,
  AgentInstallActions,
  AgentInstallCommand,
  AgentPermissionHint,
  AgentInstallMessage,
  AgentActions,
  AgentActionTooltip,
  PageHeader,
  PageSubline,
  DashboardTitle,
  PanelHeaderRow,
  PanelKicker,
  PanelHeading,
  SettingsPage,
  AccountSettingsPanel,
  AccountCard,
  AccountCardHeader,
  AccountCardFooter,
  SettingsLabel,
  SettingsValue,
  SettingsHint,
  SettingsIdentityGrid,
  SettingsIdentityItem,
  LoginCard,
  LoginPanel,
  SessionPanel,
  LoginCardTop,
  LoginCardBadge,
  LoginIconWrap,
  SuccessBadge,
  SessionTitle,
  SessionText,
  AuthStepRail,
  AuthStep,
  PrimaryButton,
  SecondaryButton,
  PrimaryDangerButton,
  FormMessage,
  buttonIconSize,
  titleIconSize,
  TitleMinimizeIcon,
  TitleMaximizeIcon,
  TitleRestoreIcon,
  TitleCloseIcon,
  ButtonRefreshIcon,
  ButtonAddIcon,
  ButtonLoginIcon,
  ButtonBrowserIcon,
  ButtonCloseIcon,
  ButtonFolderIcon,
  ButtonLogoutIcon,
  ButtonSettingsIcon,
  ButtonForgeIcon,
  ButtonCodeIcon,
  ButtonBotIcon,
  ButtonTerminalIcon,
  ButtonKeyIcon,
  ButtonMicIcon,
  ButtonHubIcon,
  ButtonCheckIcon,
  FileChevronIcon,
  FileExpandIcon,
  FileFolderTreeIcon,
  FileDocumentIcon
} from "../app/appStyles";

const MCP_REGISTRY_STORAGE_KEY = "diffforge.mcpRegistry.v1";
const MCP_TEXT_LIMIT = 12000;
const AGENT_PROVIDERS = [
  { id: "codex", label: "Codex", shortLabel: "Codex" },
  { id: "claude", label: "Claude Code", shortLabel: "Claude" },
];

const MCP_TRANSPORTS = [
  { id: "stdio", label: "Command", fieldLabel: "Command or path" },
  { id: "http", label: "HTTP", fieldLabel: "HTTP endpoint" },
  { id: "sse", label: "SSE", fieldLabel: "SSE endpoint" },
  { id: "json", label: "JSON", fieldLabel: "Config JSON" },
];
const DEFAULT_MCP_SERVERS = [
  {
    id: "agent-coordinator",
    name: "Terminal Coordinator",
    description: "Planned coordination layer for routing context between terminal sessions.",
    enabled: false,
    transport: "stdio",
    command: "",
    args: "",
    url: "",
    headers: "",
    env: "",
    configJson: "",
    access: {
      agents: [],
      workspaces: [],
    },
    lifecycle: "planned",
    system: true,
  },
];

function getDefaultAgentStatus(providerId) {
  return DEFAULT_AGENT_STATUSES.find((status) => status.id === providerId);
}

function normalizeCachedAgentStatus(status) {
  if (!status || typeof status !== "object") {
    return null;
  }

  const provider = AGENT_PROVIDERS.find((item) => item.id === status.id);
  const defaults = provider ? getDefaultAgentStatus(provider.id) : null;

  if (!provider || !defaults) {
    return null;
  }

  return {
    ...defaults,
    ...provider,
    authenticated: Boolean(status.authenticated),
    authMessage: status.authenticated
      ? "Cached terminal CLI session. Rechecking..."
      : "Cached terminal CLI state. Rechecking...",
    cached: true,
    installed: Boolean(status.installed),
    npmAvailable: Boolean(status.npmAvailable),
    npmInstalled: Boolean(status.npmInstalled),
    npmLatestVersion: typeof status.npmLatestVersion === "string"
      ? status.npmLatestVersion.slice(0, 120)
      : defaults.npmLatestVersion,
    npmPackageVersion: typeof status.npmPackageVersion === "string"
      ? status.npmPackageVersion.slice(0, 120)
      : defaults.npmPackageVersion,
    npmUpdateAvailable: Boolean(status.npmUpdateAvailable),
    npmVersion: typeof status.npmVersion === "string"
      ? status.npmVersion.slice(0, 80)
      : defaults.npmVersion,
    recommendNativeInstall: status.recommendNativeInstall !== false,
    version: typeof status.version === "string"
      ? status.version.slice(0, 120)
      : defaults.version,
  };
}

function readCachedAgentStatuses() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(AGENT_STATUS_CACHE_KEY) || "null");
    const savedAt = Number(cached?.savedAt);

    if (!Number.isFinite(savedAt) || Date.now() - savedAt > AGENT_STATUS_CACHE_TTL_MS) {
      return DEFAULT_AGENT_STATUSES;
    }

    const statusMap = new Map(
      (Array.isArray(cached?.statuses) ? cached.statuses : [])
        .map(normalizeCachedAgentStatus)
        .filter(Boolean)
        .map((status) => [status.id, status]),
    );

    if (!statusMap.size) {
      return DEFAULT_AGENT_STATUSES;
    }

    return AGENT_PROVIDERS.map((provider) => statusMap.get(provider.id) || getDefaultAgentStatus(provider.id));
  } catch {
    return DEFAULT_AGENT_STATUSES;
  }
}

function persistAgentStatusCache(statuses) {
  try {
    const safeStatuses = statuses.map((status) => ({
      authenticated: Boolean(status.authenticated),
      id: status.id,
      installed: Boolean(status.installed),
      npmAvailable: Boolean(status.npmAvailable),
      npmInstalled: Boolean(status.npmInstalled),
      npmLatestVersion: typeof status.npmLatestVersion === "string" ? status.npmLatestVersion.slice(0, 120) : "",
      npmPackageVersion: typeof status.npmPackageVersion === "string" ? status.npmPackageVersion.slice(0, 120) : "",
      npmUpdateAvailable: Boolean(status.npmUpdateAvailable),
      npmVersion: typeof status.npmVersion === "string" ? status.npmVersion.slice(0, 80) : "",
      recommendNativeInstall: status.recommendNativeInstall !== false,
      version: typeof status.version === "string" ? status.version.slice(0, 120) : "",
    }));

    window.localStorage.setItem(
      AGENT_STATUS_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        statuses: safeStatuses,
      }),
    );
  } catch {
    // Cached readiness is only a startup hint; fresh native checks remain authoritative.
  }
}

function cleanMcpText(value, maxLength = MCP_TEXT_LIMIT) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maxLength);
}

function createMcpId(name) {
  const id = cleanMcpText(name, 80)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);

  return id || `custom-${Date.now()}`;
}

function normalizeMcpTransport(transport) {
  return MCP_TRANSPORTS.some((item) => item.id === transport) ? transport : "stdio";
}

function normalizeMcpAccess(access) {
  const knownAgents = new Set(AGENT_PROVIDERS.map((agent) => agent.id));
  const agentIds = Array.isArray(access?.agents) ? access.agents : [];
  const workspaceIds = Array.isArray(access?.workspaces) ? access.workspaces : [];

  return {
    agents: Array.from(new Set(
      agentIds
        .map((id) => cleanMcpText(id, 80).trim())
        .filter((id) => knownAgents.has(id)),
    )),
    workspaces: Array.from(new Set(
      workspaceIds
        .map((id) => cleanMcpText(id, 120).trim())
        .filter(Boolean),
    )),
  };
}

function normalizeMcpServer(server, fallback = {}) {
  if (!server || typeof server !== "object") {
    return null;
  }

  const id = cleanMcpText(server.id || fallback.id || createMcpId(server.name || fallback.name), 80).trim();
  const isAgentCoordinator = id === "agent-coordinator";
  const isSystem = Boolean(fallback.system || server.system || isAgentCoordinator);
  const now = new Date().toISOString();

  return {
    id,
    name: cleanMcpText(server.name || fallback.name || "Untitled MCP", 80).trim() || "Untitled MCP",
    description: cleanMcpText(server.description || fallback.description || "", 260).trim(),
    enabled: isAgentCoordinator ? false : Boolean(server.enabled),
    transport: normalizeMcpTransport(server.transport || fallback.transport),
    command: cleanMcpText(server.command || fallback.command || "", 600).trim(),
    args: cleanMcpText(server.args || fallback.args || "", 2000).trim(),
    url: cleanMcpText(server.url || fallback.url || "", 1200).trim(),
    headers: cleanMcpText(server.headers || fallback.headers || "", MCP_TEXT_LIMIT).trim(),
    env: cleanMcpText(server.env || fallback.env || "", MCP_TEXT_LIMIT).trim(),
    configJson: cleanMcpText(server.configJson || fallback.configJson || "", MCP_TEXT_LIMIT).trim(),
    access: normalizeMcpAccess(server.access || fallback.access),
    lifecycle: isAgentCoordinator ? "planned" : cleanMcpText(server.lifecycle || fallback.lifecycle || "local", 80).trim(),
    system: isSystem,
    createdAt: cleanMcpText(server.createdAt || fallback.createdAt || now, 80).trim(),
    updatedAt: cleanMcpText(server.updatedAt || fallback.updatedAt || now, 80).trim(),
  };
}

function mergeDefaultMcpServers(servers) {
  const storedServers = Array.isArray(servers)
    ? servers.map((server) => normalizeMcpServer(server)).filter(Boolean)
    : [];
  const storedById = new Map(storedServers.map((server) => [server.id, server]));
  const defaultIds = new Set(DEFAULT_MCP_SERVERS.map((server) => server.id));
  const defaultServers = DEFAULT_MCP_SERVERS.map((defaultServer) => {
    const storedServer = storedById.get(defaultServer.id);

    return normalizeMcpServer(
      storedServer ? { ...defaultServer, ...storedServer, system: true } : defaultServer,
      defaultServer,
    );
  });
  const customServers = storedServers.filter((server) => !defaultIds.has(server.id));

  return [...defaultServers, ...customServers];
}

function readMcpServers() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(MCP_REGISTRY_STORAGE_KEY) || "null");
    const servers = Array.isArray(cached) ? cached : cached?.servers;

    return mergeDefaultMcpServers(servers);
  } catch {
    return mergeDefaultMcpServers([]);
  }
}

function persistMcpServers(servers) {
  try {
    window.localStorage.setItem(
      MCP_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        servers: mergeDefaultMcpServers(servers),
      }),
    );
  } catch {
    // Local MCP registry changes stay recoverable in memory if storage is unavailable.
  }
}

function createBlankMcpServer() {
  const createdAt = new Date().toISOString();

  return normalizeMcpServer({
    id: `custom-${Date.now()}`,
    name: "New MCP",
    enabled: false,
    transport: "stdio",
    access: {
      agents: [],
      workspaces: [],
    },
    createdAt,
    updatedAt: createdAt,
  });
}

function cloneMcpServer(server) {
  return {
    ...server,
    access: {
      agents: [...(server?.access?.agents || [])],
      workspaces: [...(server?.access?.workspaces || [])],
    },
  };
}

function getMcpTransportMeta(transport) {
  return MCP_TRANSPORTS.find((item) => item.id === transport) || MCP_TRANSPORTS[0];
}

function getMcpStatus(server) {
  if (server?.lifecycle === "planned") {
    return "planned";
  }

  return server?.enabled ? "enabled" : "off";
}

function getMcpAccessSummary(ids, options, emptyLabel) {
  if (!ids?.length) {
    return emptyLabel;
  }

  const labels = ids
    .map((id) => options.find((option) => option.id === id)?.label || id)
    .filter(Boolean);

  if (!labels.length) {
    return emptyLabel;
  }

  if (labels.length <= 2) {
    return labels.join(", ");
  }

  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

export default function McpsWorkspaceView({ agentStatuses, workspace, workspaces }) {
  const initialMcpServers = useMemo(readMcpServers, []);
  const [mcpServers, setMcpServers] = useState(initialMcpServers);
  const [selectedMcpId, setSelectedMcpId] = useState(initialMcpServers[0]?.id || DEFAULT_MCP_SERVERS[0].id);
  const selectedMcp = useMemo(
    () => mcpServers.find((server) => server.id === selectedMcpId) || mcpServers[0] || DEFAULT_MCP_SERVERS[0],
    [mcpServers, selectedMcpId],
  );
  const [draft, setDraft] = useState(() => cloneMcpServer(selectedMcp));
  const [formError, setFormError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const workspaceOptions = useMemo(() => {
    const options = new Map();

    [...(Array.isArray(workspaces) ? workspaces : []), workspace]
      .filter((item) => item?.id)
      .forEach((item) => {
        options.set(item.id, {
          id: item.id,
          label: item.name || "Workspace",
        });
      });

    return Array.from(options.values());
  }, [workspace, workspaces]);
  const agentOptions = useMemo(() => AGENT_PROVIDERS.map((provider) => {
    const status = agentStatuses?.find((agent) => agent.id === provider.id);

    return {
      ...provider,
      detail: status?.authenticated
        ? "Connected"
        : status?.installed
          ? "Installed"
          : "Not installed",
    };
  }), [agentStatuses]);
  const enabledMcpCount = mcpServers.filter((server) => server.enabled).length;
  const plannedMcpCount = mcpServers.filter((server) => server.lifecycle === "planned").length;
  const selectedTransport = getMcpTransportMeta(draft.transport);
  const selectedStatus = getMcpStatus(draft);

  useEffect(() => {
    setDraft(cloneMcpServer(selectedMcp));
    setFormError("");
    setSaveMessage("");
  }, [selectedMcpId]);

  const updateDraftField = useCallback((field, value) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setFormError("");
    setSaveMessage("");
  }, []);

  const updateDraftAccess = useCallback((kind, id) => {
    setDraft((current) => {
      const currentIds = current.access?.[kind] || [];
      const nextIds = currentIds.includes(id)
        ? currentIds.filter((item) => item !== id)
        : [...currentIds, id];

      return {
        ...current,
        access: {
          ...current.access,
          [kind]: nextIds,
        },
      };
    });
    setFormError("");
    setSaveMessage("");
  }, []);

  const setDraftAccess = useCallback((kind, ids) => {
    setDraft((current) => ({
      ...current,
      access: {
        ...current.access,
        [kind]: ids,
      },
    }));
    setFormError("");
    setSaveMessage("");
  }, []);

  const addMcpServer = useCallback(() => {
    const nextServer = createBlankMcpServer();
    const nextServers = mergeDefaultMcpServers([...mcpServers, nextServer]);

    setMcpServers(nextServers);
    persistMcpServers(nextServers);
    setSelectedMcpId(nextServer.id);
  }, [mcpServers]);

  const deleteMcpServer = useCallback(() => {
    if (draft.system) {
      return;
    }

    const nextServers = mergeDefaultMcpServers(mcpServers.filter((server) => server.id !== draft.id));
    const nextSelected = nextServers[0]?.id || DEFAULT_MCP_SERVERS[0].id;

    setMcpServers(nextServers);
    persistMcpServers(nextServers);
    setSelectedMcpId(nextSelected);
  }, [draft.id, draft.system, mcpServers]);

  const saveDraft = useCallback((event) => {
    event.preventDefault();

    if (!cleanMcpText(draft.name, 80).trim()) {
      setFormError("Name this MCP before saving.");
      return;
    }

    const updatedDraft = normalizeMcpServer({
      ...draft,
      updatedAt: new Date().toISOString(),
    });
    const nextServers = mergeDefaultMcpServers(
      mcpServers.map((server) => (server.id === selectedMcp.id ? updatedDraft : server)),
    );

    setMcpServers(nextServers);
    persistMcpServers(nextServers);
    setDraft(cloneMcpServer(updatedDraft));
    setSelectedMcpId(updatedDraft.id);
    setFormError("");
    setSaveMessage(updatedDraft.lifecycle === "planned" ? "Terminal Coordinator stays off for now." : "Saved locally.");
  }, [draft, mcpServers, selectedMcp.id]);

  return (
    <McpWorkspaceSurface aria-label="Workspace MCPs">
      <McpHeaderPanel>
        <McpTitleRow>
          <VaultPlaceholderIcon aria-hidden="true">
            <ButtonHubIcon />
          </VaultPlaceholderIcon>
          <div>
            <PanelKicker>MCPs</PanelKicker>
            <PanelHeading>{workspace?.name || "Workspace"} MCP registry</PanelHeading>
            <PageSubline>Local server configs with per-terminal and per-workspace access.</PageSubline>
          </div>
          <PrimaryButton onClick={addMcpServer} type="button">
            <ButtonAddIcon aria-hidden="true" />
            <span>Add MCP</span>
          </PrimaryButton>
        </McpTitleRow>

        <McpStatsGrid>
          <SettingsIdentityItem>
            <span>Saved</span>
            <strong>{mcpServers.length}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Enabled</span>
            <strong>{enabledMcpCount}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Planned</span>
            <strong>{plannedMcpCount}</strong>
          </SettingsIdentityItem>
        </McpStatsGrid>
      </McpHeaderPanel>

      <McpLayout>
        <McpRegistryPanel>
          <McpPanelTopline>
            <span>Servers</span>
            <strong>{mcpServers.length}</strong>
          </McpPanelTopline>
          <McpServerList>
            {mcpServers.map((server) => {
              const status = getMcpStatus(server);

              return (
                <McpServerButton
                  data-active={server.id === selectedMcp.id}
                  key={server.id}
                  onClick={() => setSelectedMcpId(server.id)}
                  type="button"
                >
                  <McpServerIcon data-state={status} aria-hidden="true">
                    <ButtonHubIcon />
                  </McpServerIcon>
                  <McpServerCopy>
                    <strong>{server.name}</strong>
                    <span>
                      {getMcpTransportMeta(server.transport).label}
                      {" / "}
                      {getMcpAccessSummary(server.access.agents, agentOptions, "No terminals")}
                    </span>
                  </McpServerCopy>
                  <McpStatusBadge data-state={status}>
                    {status === "planned" ? "Planned" : status === "enabled" ? "On" : "Off"}
                  </McpStatusBadge>
                </McpServerButton>
              );
            })}
          </McpServerList>
        </McpRegistryPanel>

        <McpEditorPanel as="form" onSubmit={saveDraft}>
          <McpEditorHeader>
            <div>
              <PanelKicker>{selectedTransport.label} MCP</PanelKicker>
              <PanelHeading>{draft.name || "New MCP"}</PanelHeading>
            </div>
            <McpSwitchButton
              aria-pressed={Boolean(draft.enabled)}
              disabled={draft.system}
              onClick={() => updateDraftField("enabled", !draft.enabled)}
              title={draft.system ? "Terminal Coordinator is disabled until the runtime is implemented." : "Toggle MCP config"}
              type="button"
            >
              <span aria-hidden="true" />
              <strong>{draft.system ? "Auto off" : draft.enabled ? "Enabled" : "Off"}</strong>
            </McpSwitchButton>
          </McpEditorHeader>

          <McpFieldGrid>
            <SetupField>
              <SettingsLabel>Name</SettingsLabel>
              <McpInput
                maxLength={80}
                onChange={(event) => updateDraftField("name", event.target.value)}
                value={draft.name}
              />
            </SetupField>
            <SetupField>
              <SettingsLabel>Description</SettingsLabel>
              <McpInput
                maxLength={260}
                onChange={(event) => updateDraftField("description", event.target.value)}
                placeholder="What this MCP gives terminal sessions"
                value={draft.description}
              />
            </SetupField>
          </McpFieldGrid>

          <McpTransportTabs aria-label="MCP connection type">
            {MCP_TRANSPORTS.map((transport) => (
              <McpTransportButton
                data-active={draft.transport === transport.id}
                key={transport.id}
                onClick={() => updateDraftField("transport", transport.id)}
                type="button"
              >
                {transport.label}
              </McpTransportButton>
            ))}
          </McpTransportTabs>

          {draft.transport === "stdio" && (
            <McpFieldGrid>
              <SetupField>
                <SettingsLabel>{selectedTransport.fieldLabel}</SettingsLabel>
                <McpInput
                  onChange={(event) => updateDraftField("command", event.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  value={draft.command}
                />
              </SetupField>
              <SetupField>
                <SettingsLabel>Arguments</SettingsLabel>
                <McpInput
                  onChange={(event) => updateDraftField("args", event.target.value)}
                  placeholder="--workspace ."
                  value={draft.args}
                />
              </SetupField>
              <McpWideField>
                <SettingsLabel>Environment</SettingsLabel>
                <McpTextarea
                  onChange={(event) => updateDraftField("env", event.target.value)}
                  placeholder="KEY=value"
                  value={draft.env}
                />
              </McpWideField>
            </McpFieldGrid>
          )}

          {(draft.transport === "http" || draft.transport === "sse") && (
            <McpFieldGrid>
              <McpWideField>
                <SettingsLabel>{selectedTransport.fieldLabel}</SettingsLabel>
                <McpInput
                  onChange={(event) => updateDraftField("url", event.target.value)}
                  placeholder={draft.transport === "sse" ? "https://example.com/mcp/sse" : "https://example.com/mcp"}
                  value={draft.url}
                />
              </McpWideField>
              <SetupField>
                <SettingsLabel>Headers</SettingsLabel>
                <McpTextarea
                  onChange={(event) => updateDraftField("headers", event.target.value)}
                  placeholder="Authorization: Bearer ..."
                  value={draft.headers}
                />
              </SetupField>
              <SetupField>
                <SettingsLabel>Environment</SettingsLabel>
                <McpTextarea
                  onChange={(event) => updateDraftField("env", event.target.value)}
                  placeholder="KEY=value"
                  value={draft.env}
                />
              </SetupField>
            </McpFieldGrid>
          )}

          {draft.transport === "json" && (
            <McpWideField>
              <SettingsLabel>{selectedTransport.fieldLabel}</SettingsLabel>
              <McpJsonTextarea
                onChange={(event) => updateDraftField("configJson", event.target.value)}
                placeholder={'{\n  "mcpServers": {}\n}'}
                value={draft.configJson}
              />
            </McpWideField>
          )}

          <McpAccessGrid>
            <McpAccessPanel>
              <McpAccessTopline>
                <span><ButtonTerminalIcon aria-hidden="true" /> Terminals</span>
                <McpInlineActions>
                  <button onClick={() => setDraftAccess("agents", agentOptions.map((agent) => agent.id))} type="button">All</button>
                  <button onClick={() => setDraftAccess("agents", [])} type="button">Clear</button>
                </McpInlineActions>
              </McpAccessTopline>
              <McpCheckList>
                {agentOptions.map((agent) => (
                  <McpCheckRow key={agent.id}>
                    <input
                      checked={draft.access.agents.includes(agent.id)}
                      onChange={() => updateDraftAccess("agents", agent.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{agent.label}</strong>
                      <small>{agent.detail}</small>
                    </span>
                  </McpCheckRow>
                ))}
              </McpCheckList>
            </McpAccessPanel>

            <McpAccessPanel>
              <McpAccessTopline>
                <span><ButtonFolderIcon aria-hidden="true" /> Workspaces</span>
                <McpInlineActions>
                  <button onClick={() => setDraftAccess("workspaces", workspaceOptions.map((item) => item.id))} type="button">All</button>
                  <button onClick={() => setDraftAccess("workspaces", [])} type="button">Clear</button>
                </McpInlineActions>
              </McpAccessTopline>
              <McpCheckList>
                {workspaceOptions.length ? workspaceOptions.map((item) => (
                  <McpCheckRow key={item.id}>
                    <input
                      checked={draft.access.workspaces.includes(item.id)}
                      onChange={() => updateDraftAccess("workspaces", item.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.id === workspace?.id ? "Active" : "Synced"}</small>
                    </span>
                  </McpCheckRow>
                )) : (
                  <McpEmptyAccess>Create a workspace to scope this MCP.</McpEmptyAccess>
                )}
              </McpCheckList>
            </McpAccessPanel>
          </McpAccessGrid>

          <McpScopePreview>
            <SettingsIdentityItem>
              <span>Terminal access</span>
              <strong>{getMcpAccessSummary(draft.access.agents, agentOptions, "No terminals")}</strong>
            </SettingsIdentityItem>
            <SettingsIdentityItem>
              <span>Workspace access</span>
              <strong>{getMcpAccessSummary(draft.access.workspaces, workspaceOptions, "No workspaces")}</strong>
            </SettingsIdentityItem>
            <SettingsIdentityItem>
              <span>State</span>
              <strong>{selectedStatus === "planned" ? "Planned" : draft.enabled ? "Enabled" : "Off"}</strong>
            </SettingsIdentityItem>
          </McpScopePreview>

          {draft.system && (
            <AgentPermissionHint>
              Terminal Coordinator is parked in the registry and remains off until the coordinator runtime is implemented.
            </AgentPermissionHint>
          )}
          {formError && <FormMessage $state="error">{formError}</FormMessage>}
          {saveMessage && <AgentInstallMessage data-tone="success">{saveMessage}</AgentInstallMessage>}

          <McpEditorActions>
            {!draft.system && (
              <PrimaryDangerButton onClick={deleteMcpServer} type="button">
                <ButtonCloseIcon aria-hidden="true" />
                <span>Delete</span>
              </PrimaryDangerButton>
            )}
            <SecondaryButton onClick={addMcpServer} type="button">
              <ButtonAddIcon aria-hidden="true" />
              <span>New MCP</span>
            </SecondaryButton>
            <PrimaryButton type="submit">
              <ButtonCheckIcon aria-hidden="true" />
              <span>Save</span>
            </PrimaryButton>
          </McpEditorActions>
        </McpEditorPanel>
      </McpLayout>
    </McpWorkspaceSurface>
  );
}
