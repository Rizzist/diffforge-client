import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";

import {
  ButtonHubIcon,
  ButtonKeyIcon,
  McpActionStatus,
  McpButtonSpinner,
  McpAccessGrid,
  McpAccessPanel,
  McpAccessTopline,
  McpEditorActions,
  McpEditorHeader,
  McpEditorPanel,
  McpEmptyAccess,
  McpFieldGrid,
  McpHeaderMetrics,
  McpHeaderPanel,
  McpInlineActions,
  McpInput,
  McpJsonTextarea,
  McpLayout,
  McpMetricPill,
  McpMountCopy,
  McpMountList,
  McpMountRow,
  McpPanelTopline,
  McpRegistryPanel,
  McpServerButton,
  McpServerCopy,
  McpServerIcon,
  McpServerList,
  McpStatusBadge,
  McpSwitchButton,
  McpTitleRow,
  McpToolChip,
  McpToolList,
  McpTransportButton,
  McpTransportTabs,
  McpWideField,
  McpWorkspaceSurface,
  PageSubline,
  PanelHeading,
  PanelKicker,
  TerminalAgentDot,
  VaultPlaceholderIcon,
} from "../app/appStyles";

const VIEW_INSTALLED = "installed";
const VIEW_DISCOVER = "discover";
const VIEW_MARKETPLACES = "marketplaces";
const EDITOR_DETAILS = "details";
const EDITOR_MANUAL = "manual";
const EDITOR_MARKETPLACE = "marketplace";
const APPROVAL_ALWAYS_ALLOW = "always_allow";
const APPROVAL_PROMPT = "prompt";

const APPROVAL_POLICY_OPTIONS = [
  {
    value: APPROVAL_ALWAYS_ALLOW,
    label: "Always allow",
    description: "Run this MCP's tools without per-call confirmation.",
  },
  {
    value: APPROVAL_PROMPT,
    label: "Prompt",
    description: "Ask before running tools from this MCP.",
  },
];

const EMPTY_MANUAL = {
  customCommand: "",
  name: "",
  sourceKind: "manual",
  sourceLabel: "Manual",
  packageRef: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  envSchema: "[]",
  configValues: {},
  tools: "",
};

const EMPTY_MARKETPLACE = {
  provider: "claude",
  command: "",
  scope: "workspace",
};

const PROVIDER_OPTIONS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "mcp_registry", label: "MCP Registry" },
  { value: "manual", label: "Manual" },
];

const MCP_SELECT_STYLES = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderRadius: 8,
    borderColor: state.isFocused
      ? "rgba(125, 160, 205, 0.44)"
      : "var(--forge-border-strong)",
    backgroundColor: "rgba(13, 17, 23, 0.92)",
    boxShadow: state.isFocused ? "0 0 0 3px rgba(125, 160, 205, 0.12)" : "none",
    cursor: "default",
  }),
  valueContainer: (base) => ({
    ...base,
    padding: "0 8px",
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--forge-text)",
    fontSize: 12,
    fontWeight: 760,
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--forge-text-muted)",
    fontSize: 12,
    fontWeight: 700,
  }),
  input: (base) => ({
    ...base,
    color: "var(--forge-text)",
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
  menu: (base) => ({
    ...base,
    overflow: "hidden",
    border: "1px solid var(--forge-border-strong)",
    borderRadius: 8,
    backgroundColor: "var(--forge-surface-raised)",
    boxShadow: "0 16px 36px rgba(0, 0, 0, 0.32)",
  }),
  menuList: (base) => ({
    ...base,
    padding: 4,
  }),
  option: (base, state) => ({
    ...base,
    borderRadius: 6,
    color: state.isSelected ? "var(--forge-text)" : "var(--forge-text-soft)",
    backgroundColor: state.isSelected
      ? "rgba(59, 130, 246, 0.18)"
      : state.isFocused
        ? "var(--forge-surface-selected)"
        : "transparent",
    fontSize: 12,
    fontWeight: 760,
  }),
  indicatorSeparator: () => ({
    display: "none",
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: "var(--forge-text-muted)",
    padding: 8,
  }),
};

function unwrapData(response, fallback = {}) {
  if (!response || typeof response !== "object") {
    return fallback;
  }
  return response.data || response;
}

function errorMessage(error) {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  return "Unable to load workspace MCP state.";
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function titleCase(value) {
  const text = String(value || "").trim();
  if (!text) return "Unknown";
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeAgentKind(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("claude")) return "claude";
  if (text.includes("open") || text.includes("opencode")) return "opencode";
  if (text.includes("codex")) return "codex";
  return "generic";
}

function agentKindLabel(value) {
  const kind = normalizeAgentKind(value);
  if (kind === "claude") return "Claude Code";
  if (kind === "opencode") return "OpenCode";
  if (kind === "codex") return "Codex";
  return textValue(value, "Agent");
}

function providerLabel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("claude")) return "Claude Code";
  if (text.includes("codex")) return "Codex";
  if (text.includes("mcp_registry") || text.includes("mcp registry")) return "MCP Registry";
  if (text.includes("manual")) return "Manual";
  if (text.includes("built_in")) return "Built-in";
  return titleCase(value || "Marketplace");
}

function normalizeSourceLabel(value) {
  const label = textValue(value, "");
  if (!label) return "";
  return label.replace(/^Claude(?=\s*·|$)/, "Claude Code");
}

function providerLabelFromSource(sourceKind, sourceLabel = "") {
  const kind = String(sourceKind || "").toLowerCase();
  if (kind.includes("claude")) return "Claude Code";
  if (kind.includes("codex")) return "Codex";
  if (kind.includes("mcp_registry")) return "MCP Registry";
  if (kind.includes("manual")) return "Manual";
  if (kind.includes("built_in")) return "Built-in";
  return providerLabel(sourceLabel);
}

function displaySourceLabel(sourceKind, sourceLabel, fallback = "Workspace MCP") {
  const normalized = normalizeSourceLabel(sourceLabel);
  if (!normalized) return fallback;
  const provider = providerLabelFromSource(sourceKind, normalized);
  if (normalized.startsWith(provider)) return normalized;
  return `${provider} · ${normalized}`;
}

function slotColorSlot(slotKey) {
  const match = String(slotKey || "").match(/\d+/);
  const slotNumber = match ? Number.parseInt(match[0], 10) : 1;
  const safeIndex = Math.max(0, (Number.isFinite(slotNumber) ? slotNumber : 1) - 1);
  return String(safeIndex % 16);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function configValue(configValues, key) {
  const value = configValues?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value.value || "";
  }
  return typeof value === "string" ? value : "";
}

function configValuesFromServer(server) {
  const values = server?.config_values_json || {};
  return asArray(server?.env_schema_json).reduce((next, item) => {
    const key = item?.key || "";
    if (key) {
      next[key] = configValue(values, key);
    }
    return next;
  }, {});
}

function hasRequiredConfig(server, draftValues) {
  return asArray(server?.env_schema_json).every((item) => {
    if (!item?.required) return true;
    const value = String(draftValues?.[item.key] || "").trim();
    return Boolean(value);
  });
}

function isPendingMcpStatus(status) {
  return ["added", "checking", "indexing", "installing", "queued"].includes(
    String(status || "").toLowerCase(),
  );
}

function serverStatus(server, draftValues) {
  if (!server) return { label: "Unknown", state: "planned" };
  if (server.built_in) {
    return {
      label: titleCase(server.status || "healthy"),
      state: server.badge_state || "enabled",
    };
  }
  const pendingStatus = [server.status, server.last_probe_status].find(isPendingMcpStatus);
  if (pendingStatus) {
    return {
      label: titleCase(pendingStatus),
      state: server.badge_state || "planned",
      pending: true,
    };
  }
  if (server.badge_state === "blocked" && String(server.status || "").trim()) {
    return {
      label: titleCase(server.status),
      state: "blocked",
    };
  }
  if (!server.workspace_enabled) {
    return { label: "Disabled", state: "planned" };
  }
  if (!hasRequiredConfig(server, draftValues || server.config_values_json)) {
    return { label: "Config required", state: "blocked" };
  }
  return {
    label: titleCase(server.status || "not_connected"),
    state: server.badge_state || "planned",
  };
}

function enabledConnectionIssue(server, statusInfo, draftValues) {
  if (!server || server.built_in || !server.workspace_enabled) return false;
  if (!hasRequiredConfig(server, draftValues || server.config_values_json)) return false;
  return statusInfo?.state === "blocked";
}

function connectionMessage(server, statusInfo) {
  if (!server) return "";
  const explicit = String(server.connection_message || server.last_probe_message || "").trim();
  if (explicit) return explicit;
  if (!server.workspace_enabled) {
    return "This MCP is installed but disabled for this workspace.";
  }
  if (statusInfo?.label === "Config required") {
    return "Required workspace configuration is missing.";
  }
  if (statusInfo?.state === "blocked") {
    return "This MCP is enabled, but the workspace gateway could not connect to it yet.";
  }
  return "The workspace gateway can expose this MCP to active coding agents.";
}

function approvalPolicy(server) {
  return server?.approval_policy === APPROVAL_PROMPT ? APPROVAL_PROMPT : APPROVAL_ALWAYS_ALLOW;
}

function booleanSetting(server, key, fallback = true) {
  if (!server || typeof server[key] === "undefined" || server[key] === null) return fallback;
  return Boolean(server[key]);
}

function actionCopy(actionState, context = {}) {
  const name = context.name || context.source || "MCP";
  switch (actionState) {
    case "adding_marketplace":
      return {
        title: `Adding ${name}`,
        detail: "Saving the marketplace, indexing its plugins, and refreshing discovered MCPs.",
      };
    case "indexing_marketplace":
      return {
        title: `Indexing ${name}`,
        detail: "Refreshing the source cache and rebuilding the MCP catalog.",
      };
    case "installing_catalog":
      return {
        title: `Adding ${name}`,
        detail: "Binding the global MCP to this workspace and refreshing connection status.",
      };
    case "installing_manual":
      return {
        title: `Adding ${name}`,
        detail: "Saving the global MCP definition and checking this workspace.",
      };
    case "enabling_mcp":
      return {
        title: `Enabling ${name}`,
        detail: "Saving workspace enablement and checking the MCP connection.",
      };
    case "disabling_mcp":
      return {
        title: `Disabling ${name}`,
        detail: "Updating workspace enablement and refreshing available MCPs.",
      };
    case "saving_config":
      return {
        title: `Saving ${name}`,
        detail: "Updating workspace configuration and checking the MCP connection.",
      };
    case "saving_approval":
      return {
        title: `Saving ${name}`,
        detail: "Updating tool approval policy for this workspace MCP.",
      };
    case "saving_access":
      return {
        title: `Saving ${name}`,
        detail: "Updating what agents can read or write from this MCP configuration.",
      };
    case "removing_marketplace":
      return {
        title: `Removing ${name}`,
        detail: "Updating sources and refreshing discovered MCPs.",
      };
    case "uninstalling_mcp":
      return {
        title: `Uninstalling ${name}`,
        detail: "Removing the MCP from this workspace and refreshing the registry.",
      };
    case "refreshing":
    case "loading":
      return {
        title: "Refreshing MCP registry",
        detail: "Loading installed MCPs, sources, catalog entries, and connection status.",
      };
    default:
      return {
        title: "Working on MCPs",
        detail: "Updating the workspace MCP registry.",
      };
  }
}

function buttonContent(isWorking, label, workingLabel = "Working") {
  if (!isWorking) return label;
  return (
    <>
      <McpButtonSpinner aria-hidden="true" />
      {workingLabel}
    </>
  );
}

function isInstalled(catalogItem, servers) {
  return servers.some((server) => server.server_key === catalogItem.server_key);
}

function hasPendingMcpWork(registry) {
  const marketplaces = asArray(registry?.marketplaces);
  const servers = asArray(registry?.servers);
  return (
    marketplaces.some((marketplace) => {
      const status = String(marketplace.index_status || marketplace.status || "").toLowerCase();
      return isPendingMcpStatus(status);
    }) ||
    servers.some((server) => {
      if (server.built_in) return false;
      const status = String(server.last_probe_status || server.status || "").toLowerCase();
      return isPendingMcpStatus(status);
    })
  );
}

function parseArgs(value) {
  return String(value || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitShellWords(value) {
  const input = String(value || "").replace(/\\\r?\n/g, " ");
  const words = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function parseTools(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeJsonArray(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function optionForValue(options, value) {
  return options.find((option) => option.value === value) || options[0];
}

function selectPortalTarget() {
  return typeof document === "undefined" ? undefined : document.body;
}

function stripShellQuotes(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith("\"") && text.endsWith("\"")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function isSecretEnvKey(key) {
  return /(?:api[_-]?key|token|secret|password|credential|private)/i.test(String(key || ""));
}

function isPlaceholderEnvValue(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return (
    /^your[-_]/i.test(text) ||
    /your[-_]/i.test(text) ||
    /<[^>]+>/.test(text) ||
    /^(changeme|change-me|replace-me|example|todo)$/i.test(text)
  );
}

function parseEnvPair(value) {
  const text = String(value || "").trim();
  const separatorIndex = text.indexOf("=");
  if (separatorIndex <= 0) return null;
  return {
    key: text.slice(0, separatorIndex).trim(),
    value: text.slice(separatorIndex + 1).trim(),
  };
}

function envSchemaFromPairs(pairs) {
  return pairs
    .filter((pair) => pair?.key)
    .map((pair) => ({
      key: pair.key,
      label: titleCase(pair.key.replace(/_/g, " ")),
      description: "",
      required: true,
      secret: isSecretEnvKey(pair.key),
      source: "custom_cli_env",
    }));
}

function configValuesFromPairs(pairs) {
  return pairs.reduce((next, pair) => {
    if (pair?.key && pair.value && !isPlaceholderEnvValue(pair.value)) {
      next[pair.key] = pair.value;
    }
    return next;
  }, {});
}

function parseMcpAddCommand(value) {
  const tokens = splitShellWords(value);
  if (tokens.length < 4) return null;
  const cli = String(tokens[0] || "").toLowerCase();
  if (!["codex", "claude"].includes(cli) || String(tokens[1] || "").toLowerCase() !== "mcp") {
    return null;
  }
  const addIndex = tokens.findIndex((token, index) => index > 1 && token === "add");
  if (addIndex < 0) return null;

  const separatorIndex = tokens.indexOf("--", addIndex + 1);
  const optionTokens = tokens.slice(addIndex + 1, separatorIndex >= 0 ? separatorIndex : undefined);
  const commandTokens = separatorIndex >= 0 ? tokens.slice(separatorIndex + 1) : [];
  const envPairs = [];
  const positionalTokens = [];
  let name = "";
  let transport = "stdio";
  let url = "";

  for (let index = 0; index < optionTokens.length; index += 1) {
    const token = optionTokens[index];
    if (token === "--scope" || token === "-s" || token === "--config" || token === "-c") {
      index += 1;
      continue;
    }
    if (token.startsWith("--scope=") || token.startsWith("--config=")) {
      continue;
    }
    if (token === "--env" || token === "-e") {
      const pair = parseEnvPair(optionTokens[index + 1]);
      if (pair) envPairs.push(pair);
      index += 1;
      continue;
    }
    if (token.startsWith("--env=")) {
      const pair = parseEnvPair(token.slice("--env=".length));
      if (pair) envPairs.push(pair);
      continue;
    }
    if (token === "--url") {
      url = optionTokens[index + 1] || "";
      transport = "http";
      index += 1;
      continue;
    }
    if (token.startsWith("--url=")) {
      url = token.slice("--url=".length);
      transport = "http";
      continue;
    }
    if (token === "--transport" || token === "--type") {
      transport = optionTokens[index + 1] || transport;
      index += 1;
      continue;
    }
    if (token.startsWith("--transport=")) {
      transport = token.slice("--transport=".length) || transport;
      continue;
    }
    if (token.startsWith("--type=")) {
      transport = token.slice("--type=".length) || transport;
      continue;
    }
    if (!token.startsWith("-")) {
      positionalTokens.push(token);
    }
  }

  const provider = cli === "claude" ? "claude" : "codex";
  const providerText = providerLabel(provider);
  name = name || positionalTokens[0] || "";
  if (!commandTokens.length && positionalTokens.length > 1) {
    if (transport === "http" || transport === "sse" || transport === "streamable-http") {
      url = url || positionalTokens[1] || "";
    } else {
      commandTokens.push(...positionalTokens.slice(1));
    }
  }
  const command = commandTokens[0] || "";
  const args = commandTokens.slice(1);
  const sourceKind = `${provider}_custom_mcp`;
  const sourceLabel = `${providerText} custom MCP`;
  return {
    args,
    command,
    configValues: configValuesFromPairs(envPairs),
    envSchema: envSchemaFromPairs(envPairs),
    name: name || displayNameFromSource(command || url || "custom-mcp", provider),
    packageRef: commandTokens.length ? commandTokens.join(" ") : url,
    provider,
    sourceKind,
    sourceLabel,
    transport: url ? "http" : transport,
    url,
  };
}

function manualDraftFromMcpCommand(commandText, draft) {
  const parsed = parseMcpAddCommand(commandText);
  if (!parsed) {
    return {
      ...draft,
      customCommand: commandText,
    };
  }
  return {
    ...draft,
    args: parsed.args.join(" "),
    command: parsed.command,
    configValues: parsed.configValues,
    customCommand: commandText,
    envSchema: JSON.stringify(parsed.envSchema, null, 2),
    name: parsed.name,
    packageRef: parsed.packageRef,
    sourceKind: parsed.sourceKind,
    sourceLabel: parsed.sourceLabel,
    transport: parsed.transport,
    url: parsed.url,
  };
}

function marketplacePlaceholder(provider) {
  if (provider === "codex") {
    return "codex plugin marketplace add appwrite/codex-plugin";
  }
  if (provider === "claude") {
    return "claude plugins marketplace add appwrite/claude-plugin";
  }
  if (provider === "mcp_registry") {
    return "https://registry.modelcontextprotocol.io";
  }
  return "owner/marketplace-repo or marketplace URL";
}

function sourceTypeFromSource(source) {
  const text = String(source || "").trim();
  if (/^https?:\/\//i.test(text)) return "url";
  if (/^(~\/|\.{1,2}\/|\/)/.test(text)) return "local_path";
  if (/^[\w.-]+\/[\w.-]+/.test(text)) return "github";
  return "git";
}

function displayNameFromSource(source, provider) {
  const clean = String(source || "")
    .trim()
    .replace(/[#?].*$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1) || "";
  const previous = parts.length > 1 ? parts.at(-2) : "";
  const candidate =
    /^(claude[-_]?plugin|codex[-_]?plugin|plugin|plugins|marketplace)$/i.test(last) && previous
      ? previous
      : last || provider;
  return titleCase(candidate.replace(/[-_]+/g, " "));
}

function parseMarketplaceCommand(provider, command) {
  const firstLine = String(command || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  let source = firstLine;
  const commandMatch = firstLine.match(
    /\b(?:claude\s+plugins?\s+marketplace\s+add|codex\s+plugins?\s+marketplace\s+add)\s+(.+)$/i,
  );
  if (commandMatch) {
    source = commandMatch[1];
  }
  const parsedSource = stripShellQuotes(source.replace(/\s+--.*$/, ""));
  return {
    name: displayNameFromSource(parsedSource, provider),
    source: parsedSource,
    sourceType: sourceTypeFromSource(parsedSource),
  };
}

export default function McpsWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "Workspace";
  const repoPath = workspaceId
    ? rootDirectory || defaultWorkingDirectory || ""
    : "";
  const commandBase = useMemo(() => ({ repoPath }), [repoPath]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [registry, setRegistry] = useState(null);
  const [view, setView] = useState(VIEW_INSTALLED);
  const [editorMode, setEditorMode] = useState(EDITOR_DETAILS);
  const [selectedId, setSelectedId] = useState("coordination-kernel");
  const [search, setSearch] = useState("");
  const [configDraft, setConfigDraft] = useState({});
  const [manualDraft, setManualDraft] = useState(EMPTY_MANUAL);
  const [marketplaceDraft, setMarketplaceDraft] = useState(EMPTY_MARKETPLACE);
  const [actionState, setActionState] = useState("idle");
  const [actionContext, setActionContext] = useState({});
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const beginAction = useCallback((nextState, nextContext = {}) => {
    setActionContext(nextContext);
    setActionState(nextState);
  }, []);

  const finishAction = useCallback(() => {
    setActionState("idle");
    setActionContext({});
  }, []);

  const refresh = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    setError("");
    if (!repoPath || !workspaceId) {
      setStatus("missing_workspace");
      setRegistry(null);
      return;
    }

    if (!silent) {
      setStatus("loading");
    }
    try {
      const response = await invoke("coordination_workspace_mcp_registry", {
        ...commandBase,
        workspaceId,
        workspaceName,
      });
      const data = unwrapData(response);
      setRegistry(data);
      setStatus("ready");
      const servers = asArray(data.servers);
      if (!servers.some((server) => server.id === selectedIdRef.current)) {
        setSelectedId(servers[0]?.id || "coordination-kernel");
      }
    } catch (caught) {
      if (!silent) {
        setStatus("error");
      }
      setError(errorMessage(caught));
    }
  }, [commandBase, repoPath, workspaceId, workspaceName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const servers = asArray(registry?.servers);
  const marketplaces = asArray(registry?.marketplaces);
  const catalog = asArray(registry?.available_catalog);
  const pendingMcpWork = hasPendingMcpWork(registry);
  const selectedServer = servers.find((server) => server.id === selectedId) || servers[0] || null;
  const selectedStatus = serverStatus(selectedServer, configDraft);
  const parsedMarketplace = parseMarketplaceCommand(
    marketplaceDraft.provider,
    marketplaceDraft.command,
  );
  const parsedManualCommand = parseMcpAddCommand(manualDraft.customCommand);
  const missingRequired = asArray(selectedServer?.env_schema_json).filter(
    (item) => item?.required && !String(configDraft?.[item.key] || "").trim(),
  );
  const canEnableSelected =
    selectedServer?.built_in ||
    selectedServer?.workspace_enabled ||
    hasRequiredConfig(selectedServer, configDraft);
  const filteredCatalog = catalog.filter((item) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [item.name, item.description, item.source_label, item.package_ref]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  useEffect(() => {
    if (selectedServer) {
      setConfigDraft(configValuesFromServer(selectedServer));
    }
  }, [selectedServer?.id]);

  useEffect(() => {
    if (!pendingMcpWork || status !== "ready") {
      return undefined;
    }
    const timer = window.setInterval(() => {
      refresh({ silent: true });
    }, 1400);
    return () => window.clearInterval(timer);
  }, [pendingMcpWork, refresh, status]);

  const replaceRegistry = useCallback((response) => {
    const data = unwrapData(response);
    setRegistry(data);
    setStatus("ready");
    window.dispatchEvent(new CustomEvent("diffforge:workspace-mcp-registry-updated", {
      detail: {
        repoPath,
        workspaceId,
        workspaceName,
      },
    }));
    return data;
  }, [repoPath, workspaceId, workspaceName]);

  const installCatalogItem = useCallback(
    async (item) => {
      if (!workspaceId || !item) return;
      beginAction("installing_catalog", { name: item.name });
      setError("");
      try {
        const response = await invoke("coordination_install_workspace_mcp_server", {
          ...commandBase,
          workspaceId,
          input: {
            workspace_name: workspaceName,
            name: item.name,
            server_key: item.server_key,
            source_kind: item.source_kind,
            source_label: item.source_label,
            package_ref: item.package_ref,
            version: item.version || "",
            transport: item.transport || "stdio",
            command: item.command || "",
            args: item.args || [],
            url: item.url || "",
            env_schema: item.env_schema || [],
            tools: item.tools || [],
            workspace_enabled: false,
            approval_policy: APPROVAL_ALWAYS_ALLOW,
            agent_config_access_enabled: true,
            agent_secret_config_access_enabled: false,
            agent_env_file_write_enabled: true,
          },
        });
        const data = replaceRegistry(response);
        const installed = asArray(data.servers).find(
          (server) => server.server_key === item.server_key,
        );
        setSelectedId(installed?.id || selectedIdRef.current);
        setView(VIEW_INSTALLED);
        setEditorMode(EDITOR_DETAILS);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, replaceRegistry, workspaceId, workspaceName],
  );

  const indexMarketplace = useCallback(
    async (marketplace) => {
      if (!workspaceId || !marketplace?.id) return null;
      beginAction("indexing_marketplace", { name: marketplace.name });
      setError("");
      try {
        const response = await invoke("coordination_index_workspace_mcp_marketplace", {
          ...commandBase,
          workspaceId,
          marketplaceId: marketplace.id,
        });
        return replaceRegistry(response);
      } catch (caught) {
        setError(errorMessage(caught));
        await refresh();
        return null;
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, refresh, replaceRegistry, workspaceId],
  );

  const installManual = useCallback(async () => {
    if (!workspaceId || !manualDraft.name.trim()) return;
    const envSchema = safeJsonArray(manualDraft.envSchema, []);
    const manualName = manualDraft.name.trim();
    beginAction("installing_manual", { name: manualName });
    setError("");
    try {
      const response = await invoke("coordination_install_workspace_mcp_server", {
        ...commandBase,
        workspaceId,
        input: {
          workspace_name: workspaceName,
          name: manualName,
          source_kind: manualDraft.sourceKind || "manual",
          source_label: manualDraft.sourceLabel.trim() || "Manual",
          package_ref: manualDraft.packageRef.trim(),
          transport: manualDraft.transport,
          command: manualDraft.command.trim(),
          args: parseArgs(manualDraft.args),
          url: manualDraft.url.trim(),
          env_schema: envSchema,
          config_values: manualDraft.configValues || {},
          tools: parseTools(manualDraft.tools),
          workspace_enabled: false,
          approval_policy: APPROVAL_ALWAYS_ALLOW,
          agent_config_access_enabled: true,
          agent_secret_config_access_enabled: false,
          agent_env_file_write_enabled: true,
        },
      });
      const data = replaceRegistry(response);
      const installed = asArray(data.servers).find(
        (server) => server.name === manualName,
      );
      setSelectedId(installed?.id || selectedIdRef.current);
      setManualDraft(EMPTY_MANUAL);
      setView(VIEW_INSTALLED);
      setEditorMode(EDITOR_DETAILS);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      finishAction();
    }
  }, [beginAction, commandBase, finishAction, manualDraft, replaceRegistry, workspaceId, workspaceName]);

  const saveMarketplace = useCallback(async () => {
    const parsed = parseMarketplaceCommand(marketplaceDraft.provider, marketplaceDraft.command);
    if (!workspaceId || !parsed.source) {
      return;
    }
    beginAction("adding_marketplace", { name: parsed.name, source: parsed.source });
    setError("");
    try {
      const response = await invoke("coordination_add_workspace_mcp_marketplace", {
        ...commandBase,
        workspaceId,
        input: {
          provider: marketplaceDraft.provider,
          source_type: parsed.sourceType,
          name: parsed.name,
          source: parsed.source,
          scope: marketplaceDraft.scope,
          workspace_name: workspaceName,
        },
      });
      replaceRegistry(response);
      setMarketplaceDraft(EMPTY_MARKETPLACE);
      setView(VIEW_MARKETPLACES);
      setEditorMode(EDITOR_DETAILS);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      finishAction();
    }
  }, [
    beginAction,
    commandBase,
    finishAction,
    marketplaceDraft,
    replaceRegistry,
    workspaceId,
    workspaceName,
  ]);

  const removeMarketplace = useCallback(
    async (marketplace) => {
      if (!workspaceId || !marketplace?.id) return;
      beginAction("removing_marketplace", { name: marketplace.name });
      setError("");
      try {
        await invoke("coordination_remove_workspace_mcp_marketplace", {
          ...commandBase,
          workspaceId,
          marketplaceId: marketplace.id,
        }).then(replaceRegistry);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, replaceRegistry, workspaceId],
  );

  const updateSelected = useCallback(
    async (next) => {
      if (!workspaceId || !selectedServer || selectedServer.built_in) return;
      const nextEnabled =
        typeof next.workspace_enabled === "boolean"
          ? next.workspace_enabled
          : selectedServer.workspace_enabled;
      const nextActionState =
        typeof next.workspace_enabled === "boolean"
          ? nextEnabled
            ? "enabling_mcp"
            : "disabling_mcp"
          : typeof next.approval_policy === "string"
            ? "saving_approval"
            : [
                  "agent_config_access_enabled",
                  "agent_secret_config_access_enabled",
                  "agent_env_file_write_enabled",
                ].some((key) => typeof next[key] === "boolean")
              ? "saving_access"
          : "saving_config";
      beginAction(nextActionState, { name: selectedServer.name });
      setError("");
      try {
        const response = await invoke("coordination_update_workspace_mcp_server", {
          ...commandBase,
          workspaceId,
          serverId: selectedServer.id,
          input: {
            workspace_name: workspaceName,
            workspace_enabled: selectedServer.workspace_enabled,
            config_values: configDraft,
            ...next,
          },
        });
        replaceRegistry(response);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, configDraft, finishAction, replaceRegistry, selectedServer, workspaceId, workspaceName],
  );

  const uninstallSelected = useCallback(async () => {
    if (!workspaceId || !selectedServer || selectedServer.built_in) return;
    beginAction("uninstalling_mcp", { name: selectedServer.name });
    setError("");
    try {
      const response = await invoke("coordination_uninstall_workspace_mcp_server", {
        ...commandBase,
        workspaceId,
        serverId: selectedServer.id,
      });
      const data = replaceRegistry(response);
      setSelectedId(asArray(data.servers)[0]?.id || "coordination-kernel");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      finishAction();
    }
  }, [beginAction, commandBase, finishAction, replaceRegistry, selectedServer, workspaceId]);

  const renderInstalledList = () => (
    <McpServerList>
      {servers.map((server) => {
        const statusInfo = serverStatus(server);
        return (
          <McpServerButton
            key={server.id}
            data-active={selectedServer?.id === server.id}
            onClick={() => {
              setSelectedId(server.id);
              setEditorMode(EDITOR_DETAILS);
            }}
            type="button"
          >
            <McpServerIcon data-state={statusInfo.state}>
              <ButtonHubIcon aria-hidden="true" />
            </McpServerIcon>
            <McpServerCopy>
              <strong>{server.name}</strong>
              <span>{displaySourceLabel(server.source_kind, server.source_label)}</span>
            </McpServerCopy>
            <McpStatusBadge
              data-pending={statusInfo.pending ? "true" : undefined}
              data-state={statusInfo.state}
            >
              {statusInfo.label}
            </McpStatusBadge>
          </McpServerButton>
        );
      })}
    </McpServerList>
  );

  const renderDiscoverList = () => (
    <McpServerList>
      <McpInput
        aria-label="Search MCP catalog"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search MCPs"
        value={search}
      />
      {filteredCatalog.map((item) => {
        const installed = isInstalled(item, servers);
        const installingThis =
          actionState === "installing_catalog" && actionContext.name === item.name;
        return (
          <McpServerButton
            as="div"
            data-active="false"
            key={item.server_key}
          >
            <McpServerIcon data-state={installed ? "enabled" : "planned"}>
              <ButtonHubIcon aria-hidden="true" />
            </McpServerIcon>
            <McpServerCopy>
              <strong>{item.name}</strong>
              <span>{displaySourceLabel(item.source_kind, item.source_label, item.package_ref)}</span>
            </McpServerCopy>
            <McpInlineActions>
              <McpStatusBadge data-state="planned">
                {providerLabelFromSource(item.source_kind, item.source_label)}
              </McpStatusBadge>
              <button
                disabled={installed || actionState !== "idle"}
                onClick={() => installCatalogItem(item)}
                type="button"
              >
                {installed
                  ? "Added"
                  : buttonContent(installingThis, "Add", "Adding")}
              </button>
            </McpInlineActions>
          </McpServerButton>
        );
      })}
      {!filteredCatalog.length && (
        <McpEmptyAccess>
          {marketplaces.length
            ? "No MCPs discovered yet. Refresh indexed sources or check source errors."
            : "Add a global source to discover MCPs."}
        </McpEmptyAccess>
      )}
      <McpInlineActions>
        <button
          disabled={actionState !== "idle"}
          onClick={() => {
            setEditorMode(EDITOR_MANUAL);
            setView(VIEW_DISCOVER);
          }}
          type="button"
        >
          Manual MCP
        </button>
      </McpInlineActions>
    </McpServerList>
  );

  const renderMarketplaceList = () => (
    <McpServerList>
      {marketplaces.length ? (
        marketplaces.map((marketplace) => {
          const indexingThis =
            actionState === "indexing_marketplace" && actionContext.name === marketplace.name;
          const removingThis =
            actionState === "removing_marketplace" && actionContext.name === marketplace.name;
          return (
            <McpServerButton as="div" data-active="false" key={marketplace.id}>
              <McpServerIcon
                data-state={marketplace.index_status === "failed" ? "blocked" : "enabled"}
              >
                <ButtonKeyIcon aria-hidden="true" />
              </McpServerIcon>
              <McpServerCopy>
                <strong>{marketplace.name}</strong>
                <span>
                  {providerLabel(marketplace.provider)} marketplace · {marketplace.source} ·{" "}
                  {titleCase(marketplace.index_status || marketplace.status)}
                  {Number(marketplace.mcp_count || 0) > 0
                    ? ` · ${marketplace.mcp_count} MCPs`
                    : ""}
                </span>
              </McpServerCopy>
              <McpInlineActions>
                <button
                  disabled={actionState !== "idle"}
                  onClick={() => indexMarketplace(marketplace)}
                  type="button"
                >
                  {buttonContent(indexingThis, "Refresh", "Indexing")}
                </button>
                <button
                  disabled={actionState !== "idle"}
                  onClick={() => removeMarketplace(marketplace)}
                  type="button"
                >
                  {buttonContent(removingThis, "Remove", "Removing")}
                </button>
              </McpInlineActions>
            </McpServerButton>
          );
        })
      ) : (
        <McpEmptyAccess>No global marketplaces added yet.</McpEmptyAccess>
      )}
      <McpInlineActions>
        <button
          disabled={actionState !== "idle"}
          onClick={() => {
            setEditorMode(EDITOR_MARKETPLACE);
            setView(VIEW_MARKETPLACES);
          }}
          type="button"
        >
          Add Marketplace
        </button>
      </McpInlineActions>
    </McpServerList>
  );

  const renderManualEditor = () => {
    const manualEnvSchema = safeJsonArray(manualDraft.envSchema, []);
    return (
      <McpEditorPanel>
        <McpEditorHeader>
          <div>
            <PanelKicker>Manual MCP</PanelKicker>
            <PanelHeading>Add global MCP</PanelHeading>
            <PageSubline>Paste a Codex or Claude Code MCP command, then keep enablement and config workspace-local.</PageSubline>
          </div>
        </McpEditorHeader>
        <McpFieldGrid>
        <McpWideField>
          <PanelKicker>Codex / Claude Code command</PanelKicker>
          <McpJsonTextarea
            onChange={(event) =>
              setManualDraft((draft) => manualDraftFromMcpCommand(event.target.value, draft))
            }
            placeholder={[
              "codex mcp add appwrite-api \\",
              "  --env APPWRITE_PROJECT_ID=your-project-id \\",
              "  --env APPWRITE_API_KEY=your-api-key \\",
              "  --env APPWRITE_ENDPOINT=https://<REGION>.cloud.appwrite.io/v1 \\",
              "  -- uvx mcp-server-appwrite",
            ].join("\n")}
            value={manualDraft.customCommand}
          />
        </McpWideField>
        {parsedManualCommand && (
          <McpEmptyAccess>
            Parsed {providerLabel(parsedManualCommand.provider)} MCP · {parsedManualCommand.name} ·{" "}
            {parsedManualCommand.packageRef || parsedManualCommand.url || "custom server"} ·{" "}
            {parsedManualCommand.envSchema.length} config
            {parsedManualCommand.envSchema.length === 1 ? " value" : " values"}
          </McpEmptyAccess>
        )}
        <McpWideField>
          <PanelKicker>Name</PanelKicker>
          <McpInput
            onChange={(event) => setManualDraft((draft) => ({ ...draft, name: event.target.value }))}
            value={manualDraft.name}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>Source Label</PanelKicker>
          <McpInput
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, sourceLabel: event.target.value }))
            }
            value={manualDraft.sourceLabel}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>Package</PanelKicker>
          <McpInput
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, packageRef: event.target.value }))
            }
            value={manualDraft.packageRef}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>Transport</PanelKicker>
          <McpInput
            as="select"
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, transport: event.target.value }))
            }
            value={manualDraft.transport}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </McpInput>
        </McpWideField>
        <McpWideField>
          <PanelKicker>Command</PanelKicker>
          <McpInput
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, command: event.target.value }))
            }
            value={manualDraft.command}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>Arguments</PanelKicker>
          <McpInput
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, args: event.target.value }))
            }
            value={manualDraft.args}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>URL</PanelKicker>
          <McpInput
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, url: event.target.value }))
            }
            value={manualDraft.url}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>Configuration Variables JSON</PanelKicker>
          <McpJsonTextarea
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, envSchema: event.target.value }))
            }
            value={manualDraft.envSchema}
          />
        </McpWideField>
        {manualEnvSchema.length > 0 && (
          <McpWideField as="div">
            <McpAccessPanel>
              <McpAccessTopline>
                <span>
                  <ButtonKeyIcon aria-hidden="true" />
                  Custom parameters
                </span>
                <McpStatusBadge data-state="planned">
                  {manualEnvSchema.length}
                </McpStatusBadge>
              </McpAccessTopline>
              <McpFieldGrid>
                {manualEnvSchema.map((item) => {
                  const key = item?.key || "";
                  return (
                    <McpWideField key={key}>
                      <PanelKicker>
                        {item?.label || key} · {item?.secret ? "secret" : "workspace"} ·{" "}
                        {item?.required ? "required" : "optional"}
                      </PanelKicker>
                      <McpInput
                        onChange={(event) =>
                          setManualDraft((draft) => ({
                            ...draft,
                            configValues: {
                              ...(draft.configValues || {}),
                              [key]: event.target.value,
                            },
                          }))
                        }
                        placeholder={key}
                        type={item?.secret ? "password" : "text"}
                        value={manualDraft.configValues?.[key] || ""}
                      />
                    </McpWideField>
                  );
                })}
              </McpFieldGrid>
            </McpAccessPanel>
          </McpWideField>
        )}
        <McpWideField>
          <PanelKicker>Tools</PanelKicker>
          <McpInput
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, tools: event.target.value }))
            }
            value={manualDraft.tools}
          />
        </McpWideField>
        </McpFieldGrid>
        <McpEditorActions>
          <button
            disabled={actionState !== "idle"}
            onClick={() => setEditorMode(EDITOR_DETAILS)}
            type="button"
          >
            Cancel
          </button>
          <button
            disabled={!manualDraft.name.trim() || actionState !== "idle"}
            onClick={installManual}
            type="button"
          >
            {buttonContent(actionState === "installing_manual", "Add MCP", "Adding")}
          </button>
        </McpEditorActions>
      </McpEditorPanel>
    );
  };

  const renderMarketplaceEditor = () => (
    <McpEditorPanel>
      <McpEditorHeader>
        <div>
          <PanelKicker>Marketplace</PanelKicker>
          <PanelHeading>Add source</PanelHeading>
          <PageSubline>Paste the marketplace command or source path.</PageSubline>
        </div>
      </McpEditorHeader>
      <McpFieldGrid>
        <McpWideField>
          <PanelKicker>Provider</PanelKicker>
          <Select
            classNamePrefix="mcp-source-select"
            isSearchable={false}
            menuPortalTarget={selectPortalTarget()}
            onChange={(option) =>
              setMarketplaceDraft((draft) => ({
                ...draft,
                provider: option?.value || "claude",
              }))
            }
            options={PROVIDER_OPTIONS}
            styles={MCP_SELECT_STYLES}
            value={optionForValue(PROVIDER_OPTIONS, marketplaceDraft.provider)}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>Command or source</PanelKicker>
          <McpInput
            onChange={(event) =>
              setMarketplaceDraft((draft) => ({ ...draft, command: event.target.value }))
            }
            placeholder={marketplacePlaceholder(marketplaceDraft.provider)}
            value={marketplaceDraft.command}
          />
        </McpWideField>
        {parsedMarketplace.source && (
          <McpEmptyAccess>
            Source: {parsedMarketplace.source} · Name: {parsedMarketplace.name}
          </McpEmptyAccess>
        )}
      </McpFieldGrid>
      <McpEditorActions>
        <button
          disabled={actionState !== "idle"}
          onClick={() => setEditorMode(EDITOR_DETAILS)}
          type="button"
        >
          Cancel
        </button>
        <button
          disabled={!parsedMarketplace.source || actionState !== "idle"}
          onClick={saveMarketplace}
          type="button"
        >
          {buttonContent(actionState === "adding_marketplace", "Add Marketplace", "Adding")}
        </button>
      </McpEditorActions>
    </McpEditorPanel>
  );

  const renderDetails = () => {
    if (!selectedServer) {
      return (
        <McpEditorPanel>
          <McpEmptyAccess>No MCP selected.</McpEmptyAccess>
        </McpEditorPanel>
      );
    }
    const showConnectionIssue = enabledConnectionIssue(
      selectedServer,
      selectedStatus,
      configDraft,
    );
    const selectedConnectionMessage = connectionMessage(selectedServer, selectedStatus);
    const currentApprovalPolicy = approvalPolicy(selectedServer);
    const configAccessEnabled = booleanSetting(
      selectedServer,
      "agent_config_access_enabled",
      true,
    );
    const secretConfigAccessEnabled = booleanSetting(
      selectedServer,
      "agent_secret_config_access_enabled",
      false,
    );
    const envFileWriteEnabled = booleanSetting(
      selectedServer,
      "agent_env_file_write_enabled",
      true,
    );

    return (
      <McpEditorPanel>
        <McpEditorHeader>
          <div>
            <PanelKicker>
              {displaySourceLabel(selectedServer.source_kind, selectedServer.source_label)}
            </PanelKicker>
            <PanelHeading>{selectedServer.name}</PanelHeading>
            <PageSubline>{selectedServer.package_ref || selectedServer.runtime_note}</PageSubline>
          </div>
          <McpSwitchButton
            aria-pressed={selectedServer.workspace_enabled ? "true" : "false"}
            disabled={
              selectedServer.built_in ||
              actionState !== "idle" ||
              (!selectedServer.workspace_enabled && !canEnableSelected)
            }
              onClick={() => updateSelected({ workspace_enabled: !selectedServer.workspace_enabled })}
              type="button"
            >
              <span aria-hidden="true" />
            {buttonContent(
              actionState === "enabling_mcp" || actionState === "disabling_mcp",
              selectedServer.workspace_enabled ? "Enabled" : "Disabled",
              actionState === "enabling_mcp" ? "Enabling" : "Disabling",
            )}
          </McpSwitchButton>
        </McpEditorHeader>

        {error && <McpEmptyAccess>{error}</McpEmptyAccess>}
        {missingRequired.length > 0 && (
          <McpEmptyAccess>
            {missingRequired.length} required workspace value
            {missingRequired.length === 1 ? "" : "s"} missing.
          </McpEmptyAccess>
        )}

        <McpAccessGrid>
          <McpAccessPanel>
            <McpAccessTopline>
              <span>
                <ButtonHubIcon aria-hidden="true" />
                Workspace status
              </span>
              <McpStatusBadge
                data-pending={selectedStatus.pending ? "true" : undefined}
                data-state={selectedStatus.state}
                title={selectedConnectionMessage}
              >
                {selectedStatus.label}
              </McpStatusBadge>
            </McpAccessTopline>
            <McpToolList>
              <McpToolChip>{selectedServer.transport || "stdio"}</McpToolChip>
              <McpToolChip>{selectedServer.config_status || "configured"}</McpToolChip>
              <McpToolChip>{selectedServer.install_state || "installed"}</McpToolChip>
            </McpToolList>
            {showConnectionIssue && (
              <McpEmptyAccess data-state="blocked" role="alert">
                {selectedConnectionMessage}
              </McpEmptyAccess>
            )}
          </McpAccessPanel>
          <McpAccessPanel>
            <McpAccessTopline>
              <span>
                <ButtonKeyIcon aria-hidden="true" />
                Source
              </span>
              <McpStatusBadge data-state={selectedServer.built_in ? "enabled" : "planned"}>
                {selectedServer.built_in ? "Built-in" : "Installed"}
              </McpStatusBadge>
            </McpAccessTopline>
            <McpEmptyAccess>
              {selectedServer.command || selectedServer.url || selectedServer.runtime_note}
            </McpEmptyAccess>
          </McpAccessPanel>
        </McpAccessGrid>

        {!selectedServer.built_in && (
          <McpAccessPanel>
            <McpAccessTopline>
              <span>
                <ButtonKeyIcon aria-hidden="true" />
                Tool approval
              </span>
              <McpStatusBadge
                data-state={currentApprovalPolicy === APPROVAL_PROMPT ? "planned" : "enabled"}
              >
                {currentApprovalPolicy === APPROVAL_PROMPT ? "Prompt" : "Always allow"}
              </McpStatusBadge>
            </McpAccessTopline>
            <McpTransportTabs aria-label="MCP tool approval policy" data-columns="2">
              {APPROVAL_POLICY_OPTIONS.map((option) => (
                <McpTransportButton
                  data-active={currentApprovalPolicy === option.value}
                  disabled={actionState !== "idle" || currentApprovalPolicy === option.value}
                  key={option.value}
                  onClick={() => updateSelected({ approval_policy: option.value })}
                  title={option.description}
                  type="button"
                >
                  {buttonContent(
                    actionState === "saving_approval" && currentApprovalPolicy !== option.value,
                    option.label,
                    "Saving",
                  )}
                </McpTransportButton>
              ))}
            </McpTransportTabs>
          </McpAccessPanel>
        )}

        {!selectedServer.built_in && (
          <McpAccessPanel>
            <McpAccessTopline>
              <span>
                <ButtonKeyIcon aria-hidden="true" />
                Agent config access
              </span>
              <McpStatusBadge data-state={configAccessEnabled ? "enabled" : "planned"}>
                {configAccessEnabled ? "Readable" : "Locked"}
              </McpStatusBadge>
            </McpAccessTopline>
            <McpToolList>
              <McpSwitchButton
                aria-pressed={configAccessEnabled ? "true" : "false"}
                disabled={actionState !== "idle"}
                onClick={() =>
                  updateSelected({ agent_config_access_enabled: !configAccessEnabled })
                }
                type="button"
              >
                <span aria-hidden="true" />
                Non-secret config
              </McpSwitchButton>
              <McpSwitchButton
                aria-pressed={envFileWriteEnabled ? "true" : "false"}
                disabled={actionState !== "idle" || !configAccessEnabled}
                onClick={() =>
                  updateSelected({ agent_env_file_write_enabled: !envFileWriteEnabled })
                }
                type="button"
              >
                <span aria-hidden="true" />
                Env file writes
              </McpSwitchButton>
              <McpSwitchButton
                aria-pressed={secretConfigAccessEnabled ? "true" : "false"}
                disabled={actionState !== "idle" || !configAccessEnabled}
                onClick={() =>
                  updateSelected({
                    agent_secret_config_access_enabled: !secretConfigAccessEnabled,
                  })
                }
                type="button"
              >
                <span aria-hidden="true" />
                Secret values
              </McpSwitchButton>
            </McpToolList>
            <McpEmptyAccess>
              Agents can read configured non-secret values and write safe env files. Secret
              values stay redacted unless explicitly enabled here.
            </McpEmptyAccess>
          </McpAccessPanel>
        )}

        <McpAccessPanel>
          <McpAccessTopline>
            <span>
              <ButtonKeyIcon aria-hidden="true" />
              Configuration
            </span>
            <McpStatusBadge data-state={missingRequired.length ? "blocked" : "enabled"}>
              {missingRequired.length ? "Required" : "Ready"}
            </McpStatusBadge>
          </McpAccessTopline>
          {asArray(selectedServer.env_schema_json).length ? (
            <McpFieldGrid>
              {asArray(selectedServer.env_schema_json).map((item) => {
                const key = item.key || "";
                const missing = item.required && !String(configDraft[key] || "").trim();
                return (
                  <McpWideField key={key}>
                    <PanelKicker>
                      {item.label || key} · {item.secret ? "secret" : "workspace"} ·{" "}
                      {item.required ? "required" : "optional"}
                    </PanelKicker>
                    <McpInput
                      data-state={missing ? "blocked" : "planned"}
                      onChange={(event) =>
                        setConfigDraft((draft) => ({ ...draft, [key]: event.target.value }))
                      }
                      type={item.secret ? "password" : "text"}
                      value={configDraft[key] || ""}
                    />
                  </McpWideField>
                );
              })}
            </McpFieldGrid>
          ) : (
            <McpEmptyAccess>No workspace configuration required.</McpEmptyAccess>
          )}
          {!selectedServer.built_in && (
            <McpEditorActions>
              <button
                disabled={actionState !== "idle"}
                onClick={() => setConfigDraft(configValuesFromServer(selectedServer))}
                type="button"
              >
                Reset
              </button>
              <button
                disabled={actionState !== "idle"}
                onClick={() => updateSelected({ config_values: configDraft })}
                type="button"
              >
                {buttonContent(actionState === "saving_config", "Save Config", "Saving")}
              </button>
            </McpEditorActions>
          )}
        </McpAccessPanel>

        <McpAccessPanel>
          <McpAccessTopline>
            <span>
              <ButtonHubIcon aria-hidden="true" />
              Tools
            </span>
            <McpStatusBadge data-state="planned">
              {asArray(selectedServer.tools_json).length}
            </McpStatusBadge>
          </McpAccessTopline>
          {asArray(selectedServer.tools_json).length ? (
            <McpToolList>
              {asArray(selectedServer.tools_json).map((tool) => (
                <McpToolChip key={tool}>{tool}</McpToolChip>
              ))}
            </McpToolList>
          ) : (
            <McpEmptyAccess>Tool discovery will run through the workspace gateway later.</McpEmptyAccess>
          )}
        </McpAccessPanel>

        <McpAccessPanel>
          <McpAccessTopline>
            <span>
              <ButtonHubIcon aria-hidden="true" />
              Agent visibility
            </span>
            <McpStatusBadge data-state="planned">Display only</McpStatusBadge>
          </McpAccessTopline>
          {asArray(selectedServer.agent_visibility).length ? (
            <McpMountList>
              {asArray(selectedServer.agent_visibility).map((mount, index) => {
                const agentKind = mount.agent_kind || mount.agent_name || "";
                return (
                  <McpMountRow key={`${mount.session_id || "visibility"}-${index}`}>
                    <TerminalAgentDot
                      aria-hidden="true"
                      data-agent={normalizeAgentKind(agentKind)}
                      data-slot={slotColorSlot(mount.slot_key)}
                    />
                    <McpMountCopy>
                      <strong>{agentKindLabel(agentKind)}</strong>
                      <span>{mount.slot_key ? `Slot ${mount.slot_key}` : mount.message}</span>
                    </McpMountCopy>
                    <McpStatusBadge data-state={mount.badge_state || "planned"}>
                      {titleCase(mount.status)}
                    </McpStatusBadge>
                  </McpMountRow>
                );
              })}
            </McpMountList>
          ) : (
            <McpEmptyAccess>No active agent sessions have reported MCP client events yet.</McpEmptyAccess>
          )}
        </McpAccessPanel>

        {!selectedServer.built_in && (
          <McpEditorActions>
            <button
              disabled={actionState !== "idle"}
              onClick={uninstallSelected}
              type="button"
            >
              {buttonContent(actionState === "uninstalling_mcp", "Uninstall", "Uninstalling")}
            </button>
          </McpEditorActions>
        )}
      </McpEditorPanel>
    );
  };

  const summary = registry?.summary || {};
  const isLoading = status === "loading";
  const isActionBusy = actionState !== "idle";
  const isBusy = isActionBusy || isLoading;
  const busyCopy = actionCopy(isActionBusy ? actionState : "loading", actionContext);

  return (
    <McpWorkspaceSurface aria-label="Workspace MCPs">
      <McpHeaderPanel>
        <McpTitleRow>
          <VaultPlaceholderIcon aria-hidden="true">
            <ButtonHubIcon />
          </VaultPlaceholderIcon>
          <div>
            <PanelKicker>MCPs</PanelKicker>
            <PanelHeading>{workspaceName} context servers</PanelHeading>
            <PageSubline>Global discovery with workspace-scoped configuration and enablement.</PageSubline>
          </div>
          <McpHeaderMetrics aria-label="MCP summary">
            <McpMetricPill data-state="enabled">
              <strong>{numberValue(summary.installed_count)}</strong>
              <span>installed</span>
            </McpMetricPill>
            <McpMetricPill data-state="enabled">
              <strong>{numberValue(summary.enabled_count)}</strong>
              <span>enabled</span>
            </McpMetricPill>
            <McpMetricPill data-state={summary.config_required_count ? "blocked" : "planned"}>
              <strong>{numberValue(summary.config_required_count)}</strong>
              <span>config</span>
            </McpMetricPill>
            <McpInlineActions>
              <button
                disabled={isBusy}
                onClick={() => {
                  setView(VIEW_DISCOVER);
                  setEditorMode(EDITOR_DETAILS);
                }}
                type="button"
              >
                Add MCP
              </button>
              <button
                disabled={isBusy}
                onClick={() => {
                  setView(VIEW_MARKETPLACES);
                  setEditorMode(EDITOR_MARKETPLACE);
                }}
                type="button"
              >
                Add Marketplace
              </button>
              <button disabled={isBusy} onClick={refresh} type="button">
                {buttonContent(isLoading && !isActionBusy, "Refresh", "Refreshing")}
              </button>
            </McpInlineActions>
          </McpHeaderMetrics>
        </McpTitleRow>
        {isBusy && (
          <McpActionStatus aria-live="polite">
            <McpButtonSpinner aria-hidden="true" />
            <span>
              <strong>{busyCopy.title}</strong>
              <small>{busyCopy.detail}</small>
            </span>
          </McpActionStatus>
        )}
      </McpHeaderPanel>

      <McpLayout data-busy={isBusy ? "true" : "false"}>
        <McpRegistryPanel>
          <McpPanelTopline>
            <span>Registry</span>
            <strong>Workspace</strong>
          </McpPanelTopline>
          <McpTransportTabs aria-label="MCP registry sections">
            <McpTransportButton
              data-active={view === VIEW_INSTALLED}
              onClick={() => setView(VIEW_INSTALLED)}
              type="button"
            >
              Installed
            </McpTransportButton>
            <McpTransportButton
              data-active={view === VIEW_DISCOVER}
              onClick={() => setView(VIEW_DISCOVER)}
              type="button"
            >
              Discover
            </McpTransportButton>
            <McpTransportButton
              data-active={view === VIEW_MARKETPLACES}
              onClick={() => setView(VIEW_MARKETPLACES)}
              type="button"
            >
              Sources
            </McpTransportButton>
          </McpTransportTabs>
          {view === VIEW_INSTALLED && renderInstalledList()}
          {view === VIEW_DISCOVER && renderDiscoverList()}
          {view === VIEW_MARKETPLACES && renderMarketplaceList()}
        </McpRegistryPanel>

        {status === "missing_workspace" ? (
          <McpEditorPanel>
            <McpEmptyAccess>The MCP registry needs a saved workspace before it can load.</McpEmptyAccess>
          </McpEditorPanel>
        ) : editorMode === EDITOR_MANUAL ? (
          renderManualEditor()
        ) : editorMode === EDITOR_MARKETPLACE ? (
          renderMarketplaceEditor()
        ) : (
          renderDetails()
        )}
      </McpLayout>
    </McpWorkspaceSurface>
  );
}
