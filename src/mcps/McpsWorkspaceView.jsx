import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import styled from "styled-components";

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
  McpInlineActions,
  McpInput,
  McpJsonTextarea,
  McpMountCopy,
  McpMountList,
  McpMountRow,
  McpServerButton,
  McpServerCopy,
  McpServerIcon,
  McpServerList,
  McpStatusBadge,
  McpSwitchButton,
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
} from "../app/appStyles";
import { MCP_CATALOG, mcpCatalogInstallInput } from "../tools/mcpCatalog.js";
import { SshMcpTargets } from "../ssh/SshMcpTargets.jsx";

const SECRETS_SERVER_KEY = "secrets";
const APPROVAL_ALWAYS_ALLOW = "always_allow";
const APPROVAL_PROMPT = "prompt";
const EXPOSURE_LAZY = "lazy";
const EXPOSURE_PINNED = "pinned";
const EXPOSURE_HIDDEN = "hidden";

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

const EXPOSURE_MODE_OPTIONS = [
  {
    value: EXPOSURE_LAZY,
    label: "Lazy",
    description: "Discover and call tools through the stable gateway broker.",
  },
  {
    value: EXPOSURE_PINNED,
    label: "Pinned",
    description: "Expose this MCP's child tools directly to coding agents.",
  },
  {
    value: EXPOSURE_HIDDEN,
    label: "Hidden",
    description: "Keep this MCP configured but unavailable to coding agents.",
  },
];

const EMPTY_MANUAL = {
  customCommand: "",
  name: "",
  source_kind: "manual",
  source_label: "Manual",
  package_ref: "",
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

const EMPTY_SECRET_DRAFT = {
  draft_id: "",
  key: "",
  value: "",
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
      ? "rgba(var(--forge-accent-soft-rgb), 0.44)"
      : "var(--mcp-border-strong, var(--forge-border-strong))",
    backgroundColor: "var(--mcp-control-bg, rgba(13, 17, 23, 0.92))",
    boxShadow: state.isFocused ? "0 0 0 3px rgba(var(--forge-accent-rgb), 0.12)" : "none",
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
    border: "1px solid var(--mcp-border-strong, var(--forge-border-strong))",
    borderRadius: 8,
    backgroundColor: "var(--mcp-panel-bg-raised, var(--forge-surface-raised))",
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
      ? "rgba(var(--forge-accent-rgb), 0.18)"
      : state.isFocused
        ? "var(--mcp-active-bg, var(--forge-surface-selected))"
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

// Compact variant for the single-row hub bar: same look as
// MCP_SELECT_STYLES, sized to sit beside the search input and ghost buttons.
const MCP_BAR_SELECT_STYLES = {
  ...MCP_SELECT_STYLES,
  container: (base) => ({ ...base, flex: "0 1 auto", minWidth: 132, maxWidth: 224 }),
  control: (base, state) => ({
    ...MCP_SELECT_STYLES.control(base, state),
    minHeight: 34,
    height: 34,
    backgroundColor: "var(--mcp-control-bg-soft, rgba(230, 236, 245, 0.05))",
    borderColor: state.isFocused
      ? "rgba(var(--forge-accent-soft-rgb), 0.44)"
      : "var(--mcp-border, var(--forge-border, rgba(230, 236, 245, 0.12)))",
    cursor: "pointer",
  }),
  valueContainer: (base) => ({ ...base, padding: "0 2px 0 10px", flexWrap: "nowrap" }),
  singleValue: (base) => ({
    ...MCP_SELECT_STYLES.singleValue(base),
    whiteSpace: "nowrap",
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? "var(--forge-text)" : "var(--forge-text-muted)",
    padding: "0 8px 0 2px",
    transition: "transform 160ms ease",
    transform: state.selectProps.menuIsOpen ? "rotate(180deg)" : "none",
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

function exposureMode(server) {
  if (server?.exposure_mode === EXPOSURE_PINNED) return EXPOSURE_PINNED;
  if (server?.exposure_mode === EXPOSURE_HIDDEN) return EXPOSURE_HIDDEN;
  return EXPOSURE_LAZY;
}

function booleanSetting(server, key, fallback = true) {
  if (!server || typeof server[key] === "undefined" || server[key] === null) return fallback;
  return Boolean(server[key]);
}

function isSecretsServer(server) {
  return server?.server_key === SECRETS_SERVER_KEY || server?.id === SECRETS_SERVER_KEY;
}

function toolDisplayName(tool) {
  if (typeof tool === "string") return tool;
  return tool?.name || tool?.tool_name || tool?.qualified_name || "tool";
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
    case "saving_exposure":
      return {
        title: `Saving ${name}`,
        detail: "Updating lazy or pinned agent exposure for this workspace MCP.",
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
    case "saving_secret":
      return {
        title: `Saving ${name}`,
        detail: "Updating the local workspace secret vault.",
      };
    case "deleting_secret":
      return {
        title: `Deleting ${name}`,
        detail: "Removing the local workspace secret.",
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
    package_ref: commandTokens.length ? commandTokens.join(" ") : url,
    provider,
    source_kind: sourceKind,
    source_label: sourceLabel,
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
    package_ref: parsed.package_ref,
    source_kind: parsed.source_kind,
    source_label: parsed.source_label,
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

const MCP_GLOBAL_SCOPE_VALUE = "global-defaults";

function McpScopeGlobeIcon(props) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.4 3.9 5.4 3.9 9S14.6 18.6 12 21c-2.6-2.4-3.9-5.4-3.9-9S9.4 5.4 12 3Z" />
    </svg>
  );
}

function McpScopeWorkspaceIcon(props) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.4h7a2 2 0 0 1 2 2v8.1a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export default function McpsWorkspaceView({
  default_working_directory: defaultWorkingDirectory,
  onScopeChange = null,
  root_directory: rootDirectory,
  scopeOptions = [],
  scopeValue = "",
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "Workspace";
  const repoPath = workspaceId
    ? rootDirectory || defaultWorkingDirectory || ""
    : "";
  const commandBase = useMemo(() => ({ repo_path: repoPath }), [repoPath]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [registry, setRegistry] = useState(null);
  // "list" (search + installed + popular), "detail" (one server's settings),
  // "manual" (paste a custom command), "sources" (marketplaces + discovery).
  const [screen, setScreen] = useState("list");
  // "installed" (this scope's MCPs with toggles) vs "catalog" (the full
  // install-from list, installed entries sorted on top — like the CLIs tab).
  const [listTab, setListTab] = useState("installed");
  const [selectedId, setSelectedId] = useState("coordination-kernel");
  const [search, setSearch] = useState("");
  const [configDraft, setConfigDraft] = useState({});
  const [manualDraft, setManualDraft] = useState(EMPTY_MANUAL);
  const [marketplaceDraft, setMarketplaceDraft] = useState(EMPTY_MARKETPLACE);
  const [secretDraftRows, setSecretDraftRows] = useState([]);
  const [secretValueDrafts, setSecretValueDrafts] = useState({});
  // Per-row local reveal/edit state for stored secrets. Values never leave the
  // device; `revealedSecrets` only holds a plaintext after an explicit reveal.
  const [revealedSecrets, setRevealedSecrets] = useState({});
  const [revealingKey, setRevealingKey] = useState("");
  const [editingSecretKeys, setEditingSecretKeys] = useState(() => new Set());
  const [actionState, setActionState] = useState("idle");
  const [actionContext, setActionContext] = useState({});
  const scrollRef = useRef(null);
  const screenRef = useRef(screen);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) return;
    scrollNode.scrollTop = 0;
    scrollNode.scrollLeft = 0;
  }, [listTab, scopeValue, screen, selectedId]);

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
        workspace_id: workspaceId,
        workspace_name: workspaceName,
      });
      const data = unwrapData(response);
      setRegistry(data);
      setStatus("ready");
      const servers = asArray(data.servers);
      if (!servers.some((server) => server.id === selectedIdRef.current)) {
        setSelectedId(servers[0]?.id || "coordination-kernel");
        if (screenRef.current === "detail") {
          setScreen("list");
        }
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
  const selectedServer = servers.find((server) => server.id === selectedId) || null;
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
      if (!isSecretsServer(selectedServer)) {
        setSecretDraftRows([]);
        setSecretValueDrafts({});
        setRevealedSecrets({});
        setRevealingKey("");
        setEditingSecretKeys(new Set());
      }
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
        repo_path: repoPath,
        workspace_id: workspaceId,
        workspace_name: workspaceName,
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
          workspace_id: workspaceId,
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
            exposure_mode: EXPOSURE_LAZY,
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
        setScreen("detail");
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, replaceRegistry, workspaceId, workspaceName],
  );

  // One-click install for the curated popular catalog: servers without
  // required config come up enabled immediately; servers that need keys land
  // on their settings screen so the user can paste them.
  const installPopularItem = useCallback(
    async (entry) => {
      if (!workspaceId || !entry) return;
      beginAction("installing_catalog", { name: entry.label });
      setError("");
      try {
        const response = await invoke("coordination_install_workspace_mcp_server", {
          ...commandBase,
          workspace_id: workspaceId,
          input: mcpCatalogInstallInput(entry, workspaceName),
        });
        const data = replaceRegistry(response);
        const installed = asArray(data.servers).find(
          (server) => server.server_key === entry.id,
        );
        if (installed) {
          setSelectedId(installed.id);
          if ((entry.env || []).some((item) => item?.required)) {
            setScreen("detail");
          }
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, replaceRegistry, workspaceId, workspaceName],
  );

  // Row-level enable/disable without opening the detail screen. The
  // coordination kernel owns persistence (including the built-in Secrets
  // MCP's opt-in state) and returns the refreshed registry.
  const toggleServer = useCallback(
    async (server) => {
      if (!workspaceId || !server || server.toggleable === false) return;
      const enabling = !server.workspace_enabled;
      beginAction(enabling ? "enabling_mcp" : "disabling_mcp", { name: server.name });
      setError("");
      try {
        const response = await invoke("coordination_update_workspace_mcp_server", {
          ...commandBase,
          workspace_id: workspaceId,
          server_id: server.id,
          input: {
            workspace_name: workspaceName,
            workspace_enabled: enabling,
          },
        });
        replaceRegistry(response);
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
          workspace_id: workspaceId,
          marketplace_id: marketplace.id,
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
        workspace_id: workspaceId,
        input: {
          workspace_name: workspaceName,
          name: manualName,
          source_kind: manualDraft.source_kind || "manual",
          source_label: manualDraft.source_label.trim() || "Manual",
          package_ref: manualDraft.package_ref.trim(),
          transport: manualDraft.transport,
          command: manualDraft.command.trim(),
          args: parseArgs(manualDraft.args),
          url: manualDraft.url.trim(),
          env_schema: envSchema,
          config_values: manualDraft.configValues || {},
          tools: parseTools(manualDraft.tools),
          workspace_enabled: false,
          approval_policy: APPROVAL_ALWAYS_ALLOW,
          exposure_mode: EXPOSURE_LAZY,
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
      setScreen("detail");
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
        workspace_id: workspaceId,
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
      setScreen("sources");
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
          workspace_id: workspaceId,
          marketplace_id: marketplace.id,
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
      // toggleable === false marks the always-on coordination kernel; the
      // built-in Secrets MCP is toggleable (enable/disable only).
      if (!workspaceId || !selectedServer || selectedServer.toggleable === false) return;
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
            : typeof next.exposure_mode === "string"
              ? "saving_exposure"
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
          workspace_id: workspaceId,
          server_id: selectedServer.id,
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
        workspace_id: workspaceId,
        server_id: selectedServer.id,
      });
      const data = replaceRegistry(response);
      setSelectedId(asArray(data.servers)[0]?.id || "coordination-kernel");
      setScreen("list");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      finishAction();
    }
  }, [beginAction, commandBase, finishAction, replaceRegistry, selectedServer, workspaceId]);

  const addSecretDraftRow = useCallback(() => {
    setSecretDraftRows((rows) => [
      ...rows,
      {
        ...EMPTY_SECRET_DRAFT,
        draft_id: `secret-draft-${Date.now()}-${rows.length}`,
      },
    ]);
  }, []);

  const removeSecretDraftRow = useCallback((draftId) => {
    setSecretDraftRows((rows) => rows.filter((row) => row.draft_id !== draftId));
  }, []);

  const updateSecretDraftRow = useCallback((draftId, patch) => {
    setSecretDraftRows((rows) =>
      rows.map((row) => (row.draft_id === draftId ? { ...row, ...patch } : row)),
    );
  }, []);

  const saveSecretRow = useCallback(async (row) => {
    const key = String(row?.key || "").trim();
    const value = String(row?.value || "");
    if (!workspaceId || !key || !value) return;
    beginAction("saving_secret", { name: key });
    setError("");
    try {
      const response = await invoke("coordination_upsert_workspace_mcp_secret", {
        ...commandBase,
        workspace_id: workspaceId,
        workspace_name: workspaceName,
        input: {
          key,
          value,
        },
      });
      const data = replaceRegistry(response);
      const secretsServer = asArray(data.servers).find(isSecretsServer);
      setSelectedId(secretsServer?.id || SECRETS_SERVER_KEY);
      if (row.draft_id) {
        removeSecretDraftRow(row.draft_id);
      }
      const rowKey = row.id || key;
      // Return the row to its masked, at-rest state: drop the edit buffer, exit
      // edit mode, and forget any revealed plaintext so the value is never left
      // dangling on screen after a save.
      setSecretValueDrafts((drafts) => {
        const next = { ...drafts };
        delete next[rowKey];
        return next;
      });
      setEditingSecretKeys((keys) => {
        if (!keys.has(rowKey)) return keys;
        const next = new Set(keys);
        next.delete(rowKey);
        return next;
      });
      setRevealedSecrets((values) => {
        if (!(rowKey in values)) return values;
        const next = { ...values };
        delete next[rowKey];
        return next;
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      finishAction();
    }
  }, [
    beginAction,
    commandBase,
    finishAction,
    removeSecretDraftRow,
    replaceRegistry,
    workspaceId,
    workspaceName,
  ]);

  const revealSecret = useCallback(
    async (secret) => {
      const rowKey = secret?.id || secret?.key;
      if (!workspaceId || !secret?.key || !rowKey) return;
      // Toggle: a second click hides the plaintext again.
      if (rowKey in revealedSecrets) {
        setRevealedSecrets((values) => {
          const next = { ...values };
          delete next[rowKey];
          return next;
        });
        return;
      }
      setRevealingKey(rowKey);
      setError("");
      try {
        const response = await invoke("coordination_reveal_workspace_mcp_secret", {
          ...commandBase,
          workspace_id: workspaceId,
          key: secret.key,
        });
        const value = String(unwrapData(response)?.value ?? "");
        setRevealedSecrets((values) => ({ ...values, [rowKey]: value }));
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setRevealingKey("");
      }
    },
    [commandBase, revealedSecrets, workspaceId],
  );

  const startEditSecret = useCallback((secret) => {
    const rowKey = secret?.id || secret?.key;
    if (!rowKey) return;
    setEditingSecretKeys((keys) => {
      const next = new Set(keys);
      next.add(rowKey);
      return next;
    });
    setSecretValueDrafts((drafts) => ({ ...drafts, [rowKey]: "" }));
  }, []);

  const cancelEditSecret = useCallback((secret) => {
    const rowKey = secret?.id || secret?.key;
    if (!rowKey) return;
    setEditingSecretKeys((keys) => {
      if (!keys.has(rowKey)) return keys;
      const next = new Set(keys);
      next.delete(rowKey);
      return next;
    });
    setSecretValueDrafts((drafts) => {
      const next = { ...drafts };
      delete next[rowKey];
      return next;
    });
  }, []);

  const deleteSecret = useCallback(
    async (secret) => {
      if (!workspaceId || !secret?.id) return;
      beginAction("deleting_secret", { name: secret.key || "Secret" });
      setError("");
      try {
        const response = await invoke("coordination_delete_workspace_mcp_secret", {
          ...commandBase,
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          secret_id: secret.id,
        });
        replaceRegistry(response);
        setSecretValueDrafts((drafts) => {
          const next = { ...drafts };
          delete next[secret.id];
          delete next[secret.key];
          return next;
        });
        setRevealedSecrets((values) => {
          const next = { ...values };
          delete next[secret.id];
          delete next[secret.key];
          return next;
        });
        setEditingSecretKeys((keys) => {
          if (!keys.has(secret.id) && !keys.has(secret.key)) return keys;
          const next = new Set(keys);
          next.delete(secret.id);
          next.delete(secret.key);
          return next;
        });
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, replaceRegistry, workspaceId, workspaceName],
  );

  const upsertSshTarget = useCallback(
    async (input) => {
      if (!workspaceId) return { ok: false, error: "No workspace selected." };
      beginAction("saving_ssh_target", { name: input?.name || "SSH target" });
      setError("");
      try {
        const response = await invoke("coordination_upsert_workspace_mcp_ssh_target", {
          ...commandBase,
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          input,
        });
        const data = replaceRegistry(response);
        const secretsServer = asArray(data?.servers).find(isSecretsServer);
        setSelectedId(secretsServer?.id || SECRETS_SERVER_KEY);
        return { ok: true };
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        return { ok: false, error: message };
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, replaceRegistry, workspaceId, workspaceName],
  );

  const deleteSshTarget = useCallback(
    async (sshTargetId) => {
      if (!workspaceId || !sshTargetId) return { ok: false, error: "No SSH target." };
      beginAction("deleting_ssh_target", { name: "SSH target" });
      setError("");
      try {
        const response = await invoke("coordination_delete_workspace_mcp_ssh_target", {
          ...commandBase,
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          ssh_target_id: sshTargetId,
        });
        replaceRegistry(response);
        return { ok: true };
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        return { ok: false, error: message };
      } finally {
        finishAction();
      }
    },
    [beginAction, commandBase, finishAction, replaceRegistry, workspaceId, workspaceName],
  );

  const catalogByKey = useMemo(
    () => new Map(MCP_CATALOG.map((entry) => [entry.id, entry])),
    [],
  );
  const installedServerKeys = useMemo(
    () => new Set(servers.map((server) => String(server.server_key || ""))),
    [servers],
  );
  const searchQuery = search.trim().toLowerCase();
  const visibleServers = servers.filter((server) => (
    !searchQuery
      || [server.name, server.source_label, server.package_ref, server.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchQuery))
  ));
  const serversByKey = useMemo(
    () => new Map(servers.map((server) => [String(server.server_key || ""), server])),
    [servers],
  );
  // Catalog tab rows: installed entries float to the top (like the CLI list),
  // the rest stay alphabetical for scanning.
  const catalogRows = MCP_CATALOG
    .filter((entry) => (
      !searchQuery
        || entry.label.toLowerCase().includes(searchQuery)
        || entry.description.toLowerCase().includes(searchQuery)
        || entry.package_ref.toLowerCase().includes(searchQuery)
    ))
    .map((entry) => ({
      entry,
      installed: installedServerKeys.has(entry.id),
      server: serversByKey.get(entry.id) || null,
    }))
    .sort((left, right) => (
      Number(right.installed) - Number(left.installed)
        || left.entry.label.localeCompare(right.entry.label)
    ));

  const renderServerRowIcon = (server) => {
    const CatalogIcon = catalogByKey.get(String(server.server_key || ""))?.icon || null;
    if (CatalogIcon) return <CatalogIcon aria-hidden="true" />;
    if (isSecretsServer(server)) return <ButtonKeyIcon aria-hidden="true" />;
    return <ButtonHubIcon aria-hidden="true" />;
  };

  const renderInstalledList = () => (
    <>
      <McpHubList role="list">
        {visibleServers.map((server) => {
          const statusInfo = serverStatus(server);
          const missing = asArray(server.missing_required_config).length > 0
            || server.status === "config_required";
          const togglingThis = (actionState === "enabling_mcp" || actionState === "disabling_mcp")
            && actionContext.name === server.name;
          const canToggle = server.toggleable !== false
            && (server.workspace_enabled || server.secrets_builtin || !missing);
          return (
            <McpHubRow key={server.id} role="listitem">
              <McpHubRowButton
                onClick={() => {
                  setSelectedId(server.id);
                  setScreen("detail");
                }}
                type="button"
              >
                <McpHubRowIcon data-state={statusInfo.state}>
                  {renderServerRowIcon(server)}
                </McpHubRowIcon>
                <McpHubRowCopy>
                  <strong>{server.name}</strong>
                  <span>
                    {displaySourceLabel(server.source_kind, server.source_label)}
                    {missing && !server.workspace_enabled ? " · needs config" : ""}
                  </span>
                </McpHubRowCopy>
              </McpHubRowButton>
              <McpHubRowSide>
                <McpStatusBadge
                  data-pending={statusInfo.pending ? "true" : undefined}
                  data-state={statusInfo.state}
                >
                  {togglingThis
                    ? actionState === "enabling_mcp" ? "Enabling…" : "Disabling…"
                    : statusInfo.label}
                </McpStatusBadge>
                {server.toggleable !== false && (
                  <McpHubRowSwitch
                    aria-label={`${server.workspace_enabled ? "Disable" : "Enable"} ${server.name}`}
                    aria-pressed={server.workspace_enabled ? "true" : "false"}
                    disabled={actionState !== "idle" || !canToggle}
                    onClick={() => {
                      if (!server.workspace_enabled && missing && !server.secrets_builtin) {
                        setSelectedId(server.id);
                        setScreen("detail");
                        return;
                      }
                      void toggleServer(server);
                    }}
                    title={!server.workspace_enabled && missing && !server.secrets_builtin
                      ? "Add the required configuration first"
                      : server.workspace_enabled
                        ? "Disable for this workspace"
                        : "Enable for this workspace"}
                    type="button"
                  >
                    <span aria-hidden="true" />
                  </McpHubRowSwitch>
                )}
              </McpHubRowSide>
            </McpHubRow>
          );
        })}
        {!visibleServers.length && (
          <McpEmptyAccess>No installed MCPs match your search.</McpEmptyAccess>
        )}
      </McpHubList>
    </>
  );

  const renderCatalogList = () => (
    <McpHubList role="list">
      {catalogRows.map(({ entry, installed, server }) => {
        const Icon = entry.icon;
        const installingThis = actionState === "installing_catalog"
          && actionContext.name === entry.label;
        const needsKeys = (entry.env || []).some((item) => item?.required);
        const statusInfo = installed ? serverStatus(server) : null;
        return (
          <McpHubRow key={entry.id} role="listitem">
            {installed && server ? (
              <McpHubRowButton
                onClick={() => {
                  setSelectedId(server.id);
                  setScreen("detail");
                }}
                type="button"
              >
                <McpHubRowIcon data-state={statusInfo.state}>
                  {Icon ? <Icon aria-hidden="true" /> : <span>{entry.label.slice(0, 1)}</span>}
                </McpHubRowIcon>
                <McpHubRowCopy>
                  <strong>{entry.label}</strong>
                  <span>{entry.description}</span>
                </McpHubRowCopy>
              </McpHubRowButton>
            ) : (
              <McpHubRowStatic>
                <McpHubRowIcon data-state="planned">
                  {Icon ? <Icon aria-hidden="true" /> : <span>{entry.label.slice(0, 1)}</span>}
                </McpHubRowIcon>
                <McpHubRowCopy>
                  <strong>{entry.label}</strong>
                  <span>{entry.description}</span>
                </McpHubRowCopy>
              </McpHubRowStatic>
            )}
            <McpHubRowSide>
              {installed && statusInfo ? (
                <McpStatusBadge
                  data-pending={statusInfo.pending ? "true" : undefined}
                  data-state={statusInfo.state}
                >
                  {statusInfo.label}
                </McpStatusBadge>
              ) : (
                <>
                  {needsKeys && <McpHubRowHint>needs key</McpHubRowHint>}
                  <McpHubRowButtonAction
                    disabled={actionState !== "idle"}
                    onClick={() => void installPopularItem(entry)}
                    type="button"
                  >
                    {installingThis ? "Installing…" : "Install"}
                  </McpHubRowButtonAction>
                </>
              )}
            </McpHubRowSide>
          </McpHubRow>
        );
      })}
      {!catalogRows.length && (
        <McpEmptyAccess>No catalog MCPs match your search.</McpEmptyAccess>
      )}
    </McpHubList>
  );

  // The installed/catalog switch lives in the top bar's view dropdown; the
  // list screen is just the list itself.
  const renderListScreen = () => (
    listTab === "catalog" ? renderCatalogList() : renderInstalledList()
  );

  const renderSourcesScreen = () => (
    <>
      <McpHubBackRow>
        <McpHubGhostButton onClick={() => setScreen("list")} type="button">
          ‹ MCPs
        </McpHubGhostButton>
        <PageSubline>Marketplace sources and MCPs discovered from them.</PageSubline>
      </McpHubBackRow>
      <McpHubSectionLabel>Sources</McpHubSectionLabel>
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
          <McpEmptyAccess>No marketplace sources added yet.</McpEmptyAccess>
        )}
      </McpServerList>
      {renderMarketplaceEditor()}
      <McpHubSectionLabel>Discovered MCPs</McpHubSectionLabel>
      <McpServerList>
        {filteredCatalog.map((item) => {
          const installed = isInstalled(item, servers);
          const installingThis =
            actionState === "installing_catalog" && actionContext.name === item.name;
          return (
            <McpServerButton as="div" data-active="false" key={item.server_key}>
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
              : "Add a marketplace source above to discover more MCPs."}
          </McpEmptyAccess>
        )}
      </McpServerList>
    </>
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
            {parsedManualCommand.package_ref || parsedManualCommand.url || "custom server"} ·{" "}
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
              setManualDraft((draft) => ({ ...draft, source_label: event.target.value }))
            }
            value={manualDraft.source_label}
          />
        </McpWideField>
        <McpWideField>
          <PanelKicker>Package</PanelKicker>
          <McpInput
            onChange={(event) =>
              setManualDraft((draft) => ({ ...draft, package_ref: event.target.value }))
            }
            value={manualDraft.package_ref}
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
            onClick={() => setScreen("list")}
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
            menuPosition="fixed"
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
          disabled={!parsedMarketplace.source || actionState !== "idle"}
          onClick={saveMarketplace}
          type="button"
        >
          {buttonContent(actionState === "adding_marketplace", "Add Marketplace", "Adding")}
        </button>
      </McpEditorActions>
    </McpEditorPanel>
  );

  const renderSecretsPanel = (server) => {
    const secrets = asArray(server?.secrets);
    return (
      <McpAccessPanel>
        <McpAccessTopline>
          <span>
            <ButtonKeyIcon aria-hidden="true" />
            Secrets
          </span>
          <McpStatusBadge data-state={secrets.length ? "enabled" : "planned"}>
            {secrets.length}
          </McpStatusBadge>
        </McpAccessTopline>
        <SecretsToolbar>
          <SecretsToolbarHint>
            Stored on this device only — never synced to Cloud.
          </SecretsToolbarHint>
          <SecretButton
            data-variant="primary"
            disabled={actionState !== "idle"}
            onClick={addSecretDraftRow}
            type="button"
          >
            <SecretButtonGlyph aria-hidden="true">+</SecretButtonGlyph>
            Add secret
          </SecretButton>
        </SecretsToolbar>
        {scopeValue === MCP_GLOBAL_SCOPE_VALUE && (
          <McpEmptyAccess>
            Global secrets vault: these values (with the rest of the global
            MCP defaults) are copied into each new workspace the first time
            it opens its MCP registry. Values stay on this device and never
            sync to Cloud.
          </McpEmptyAccess>
        )}
        {secrets.length || secretDraftRows.length ? (
          <McpSecretRows>
            {secrets.map((secret) => {
              const rowKey = secret.id || secret.key;
              const draftValue = secretValueDrafts[rowKey] || "";
              const editing = editingSecretKeys.has(rowKey) || !secret.available;
              const revealed = rowKey in revealedSecrets;
              const revealingThis = revealingKey === rowKey;
              const savingThis = actionState === "saving_secret" && actionContext.name === secret.key;
              const deletingThis =
                actionState === "deleting_secret" && actionContext.name === secret.key;
              const busy = actionState !== "idle";
              return (
                <McpSecretRow key={rowKey}>
                  <McpSecretField data-size="key">
                    <PanelKicker>Key</PanelKicker>
                    <McpInput readOnly value={secret.key || ""} />
                  </McpSecretField>
                  <McpSecretField data-size="value">
                    <PanelKicker>Value</PanelKicker>
                    {editing ? (
                      <McpInput
                        aria-label={`New value for ${secret.key}`}
                        autoFocus
                        onChange={(event) =>
                          setSecretValueDrafts((drafts) => ({
                            ...drafts,
                            [rowKey]: event.target.value,
                          }))
                        }
                        placeholder={secret.available ? "Enter a new value" : "Enter a value"}
                        type="password"
                        value={draftValue}
                      />
                    ) : (
                      <SecretValueBox
                        data-revealed={revealed ? "true" : "false"}
                        title={revealed ? "Stored secret value" : "Hidden — click View to reveal"}
                      >
                        {revealed ? (
                          <SecretRevealedText>{revealedSecrets[rowKey]}</SecretRevealedText>
                        ) : (
                          <>
                            <SecretMaskDots aria-hidden="true">••••••••••••</SecretMaskDots>
                            <SecretStoredHint>Stored</SecretStoredHint>
                          </>
                        )}
                      </SecretValueBox>
                    )}
                  </McpSecretField>
                  <McpSecretActions>
                    {editing ? (
                      <>
                        <SecretButton
                          data-variant="primary"
                          disabled={busy || !draftValue}
                          onClick={() => saveSecretRow({ ...secret, value: draftValue })}
                          type="button"
                        >
                          {buttonContent(savingThis, "Save", "Saving")}
                        </SecretButton>
                        {secret.available && (
                          <SecretButton
                            disabled={busy}
                            onClick={() => cancelEditSecret(secret)}
                            type="button"
                          >
                            Cancel
                          </SecretButton>
                        )}
                      </>
                    ) : (
                      <>
                        <SecretButton
                          disabled={revealingThis}
                          onClick={() => revealSecret(secret)}
                          type="button"
                        >
                          {buttonContent(revealingThis, revealed ? "Hide" : "View", "…")}
                        </SecretButton>
                        <SecretButton
                          disabled={busy}
                          onClick={() => startEditSecret(secret)}
                          type="button"
                        >
                          Edit
                        </SecretButton>
                      </>
                    )}
                    <SecretButton
                      data-variant="danger"
                      disabled={busy}
                      onClick={() => deleteSecret(secret)}
                      type="button"
                    >
                      {buttonContent(deletingThis, "Delete", "Deleting")}
                    </SecretButton>
                  </McpSecretActions>
                </McpSecretRow>
              );
            })}
            {secretDraftRows.map((row) => {
              const canSave = row.key.trim() && row.value;
              const savingThis = actionState === "saving_secret" && actionContext.name === row.key.trim();
              return (
                <McpSecretRow key={row.draft_id} data-draft="true">
                  <McpSecretField data-size="key">
                    <PanelKicker>Key</PanelKicker>
                    <McpInput
                      onChange={(event) =>
                        updateSecretDraftRow(row.draft_id, { key: event.target.value })
                      }
                      placeholder="APP_API_KEY"
                      value={row.key}
                    />
                  </McpSecretField>
                  <McpSecretField data-size="value">
                    <PanelKicker>Value</PanelKicker>
                    <McpInput
                      onChange={(event) =>
                        updateSecretDraftRow(row.draft_id, { value: event.target.value })
                      }
                      placeholder="Enter a value"
                      type="password"
                      value={row.value}
                    />
                  </McpSecretField>
                  <McpSecretActions>
                    <SecretButton
                      data-variant="primary"
                      disabled={!canSave || actionState !== "idle"}
                      onClick={() => saveSecretRow(row)}
                      type="button"
                    >
                      {buttonContent(savingThis, "Save", "Saving")}
                    </SecretButton>
                    <SecretButton
                      disabled={actionState !== "idle"}
                      onClick={() => removeSecretDraftRow(row.draft_id)}
                      type="button"
                    >
                      Cancel
                    </SecretButton>
                  </McpSecretActions>
                </McpSecretRow>
              );
            })}
          </McpSecretRows>
        ) : (
          <McpEmptyAccess>No key/value pairs.</McpEmptyAccess>
        )}
      </McpAccessPanel>
    );
  };

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
    const currentExposureMode = exposureMode(selectedServer);
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
    const selectedTools = asArray(selectedServer.tools_json);
    const selectedIsSecrets = isSecretsServer(selectedServer);
    const savedConfigValues = configValuesFromServer(selectedServer);
    const configKeys = new Set([
      ...Object.keys(savedConfigValues),
      ...Object.keys(configDraft || {}),
    ]);
    const configDirty = Array.from(configKeys).some(
      (key) => String(configDraft?.[key] ?? "") !== String(savedConfigValues?.[key] ?? ""),
    );

    return (
      <McpEditorPanel>
        <McpHubBackRow>
          <McpHubGhostButton onClick={() => setScreen("list")} type="button">
            ‹ MCPs
          </McpHubGhostButton>
        </McpHubBackRow>
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
              selectedServer.toggleable === false ||
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
              <McpToolChip>{currentExposureMode}</McpToolChip>
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
                <ButtonHubIcon aria-hidden="true" />
                Agent exposure
              </span>
              <McpStatusBadge data-state={currentExposureMode === EXPOSURE_HIDDEN ? "planned" : "enabled"}>
                {EXPOSURE_MODE_OPTIONS.find((option) => option.value === currentExposureMode)?.label || "Lazy"}
              </McpStatusBadge>
            </McpAccessTopline>
            <McpTransportTabs aria-label="MCP agent exposure mode" data-columns="3">
              {EXPOSURE_MODE_OPTIONS.map((option) => (
                <McpTransportButton
                  data-active={currentExposureMode === option.value}
                  disabled={actionState !== "idle" || currentExposureMode === option.value}
                  key={option.value}
                  onClick={() => updateSelected({ exposure_mode: option.value })}
                  title={option.description}
                  type="button"
                >
                  {buttonContent(
                    actionState === "saving_exposure" && currentExposureMode !== option.value,
                    option.label,
                    "Saving",
                  )}
                </McpTransportButton>
              ))}
            </McpTransportTabs>
            <McpEmptyAccess>
              Lazy keeps the coding-agent tool list stable and calls tools through the gateway. Pinned exposes child tools directly and increases context.
            </McpEmptyAccess>
          </McpAccessPanel>
        )}

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

        {selectedIsSecrets ? (
          <>
            {renderSecretsPanel(selectedServer)}
            <SshMcpTargets
              busy={actionState !== "idle"}
              onDelete={deleteSshTarget}
              onUpsert={upsertSshTarget}
              scope={scopeValue === MCP_GLOBAL_SCOPE_VALUE ? "global" : "workspace"}
              targets={asArray(selectedServer.ssh_targets)}
            />
          </>
        ) : (
          <McpAccessPanel>
            <McpAccessTopline>
              <span>
                <ButtonKeyIcon aria-hidden="true" />
                Configuration
              </span>
              <McpStatusBadge
                data-state={
                  missingRequired.length ? "blocked" : configDirty ? "planned" : "enabled"
                }
              >
                {missingRequired.length
                  ? `${missingRequired.length} required`
                  : configDirty
                    ? "Unsaved changes"
                    : "Saved"}
              </McpStatusBadge>
            </McpAccessTopline>
            {asArray(selectedServer.env_schema_json).length ? (
              <McpFieldGrid>
                {asArray(selectedServer.env_schema_json).map((item) => {
                  const key = item.key || "";
                  const missing = item.required && !String(configDraft[key] || "").trim();
                  const fieldDirty =
                    String(configDraft?.[key] ?? "") !== String(savedConfigValues?.[key] ?? "");
                  return (
                    <McpWideField key={key}>
                      <PanelKicker>
                        {item.label || key}
                        {item.secret ? " · secret" : ""}
                        {item.required ? " · required" : ""}
                        {fieldDirty ? " · edited" : ""}
                      </PanelKicker>
                      <McpInput
                        data-state={missing ? "blocked" : "planned"}
                        onChange={(event) =>
                          setConfigDraft((draft) => ({ ...draft, [key]: event.target.value }))
                        }
                        placeholder={
                          item.placeholder
                            || (item.secret ? "Secret value" : item.example || "")
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
                  disabled={actionState !== "idle" || !configDirty}
                  onClick={() => setConfigDraft(configValuesFromServer(selectedServer))}
                  title="Discard edits and restore the saved values"
                  type="button"
                >
                  Reset
                </button>
                <button
                  disabled={actionState !== "idle" || !configDirty}
                  onClick={() => updateSelected({ config_values: configDraft })}
                  title={configDirty ? "Save the edited values" : "Everything is saved"}
                  type="button"
                >
                  {buttonContent(actionState === "saving_config", "Save Config", "Saving")}
                </button>
              </McpEditorActions>
            )}
          </McpAccessPanel>
        )}

        <McpAccessPanel>
          <McpAccessTopline>
            <span>
              <ButtonHubIcon aria-hidden="true" />
              {selectedServer.built_in ? "Agent-exposed tools" : "Tools"}
            </span>
            <McpStatusBadge data-state="planned">
              {selectedTools.length}
            </McpStatusBadge>
          </McpAccessTopline>
          {selectedTools.length ? (
            <McpToolList>
              {selectedTools.map((tool) => (
                <McpToolChip key={toolDisplayName(tool)}>{toolDisplayName(tool)}</McpToolChip>
              ))}
            </McpToolList>
          ) : (
            <McpEmptyAccess>
              {selectedServer.built_in
                ? "No coordination tools are exposed to coding agents."
                : "Tool discovery runs lazily through the workspace gateway."}
            </McpEmptyAccess>
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

  const isLoading = status === "loading";
  const isActionBusy = actionState !== "idle";
  const isBusy = isActionBusy || isLoading;
  const busyCopy = actionCopy(isActionBusy ? actionState : "loading", actionContext);
  const listViewOptions = [
    {
      value: "installed",
      label: `${scopeValue === MCP_GLOBAL_SCOPE_VALUE ? "Global MCPs" : "Workspace MCPs"} · ${servers.length}`,
    },
    { value: "catalog", label: `Browse catalog · ${MCP_CATALOG.length}` },
  ];
  const scopeSelectable = scopeOptions.length > 0 && typeof onScopeChange === "function";
  const isGlobalScope = scopeValue === MCP_GLOBAL_SCOPE_VALUE;
  const activeScopeLabel = optionForValue(scopeOptions, scopeValue)?.label
    || (isGlobalScope ? "Global defaults" : workspaceName);
  const scopeCardsVisible = scopeSelectable && screen === "list";
  const scopeBadge = (
    <McpScopeBadge
      title={isGlobalScope
        ? "Changes here go to the global defaults every workspace inherits"
        : `Changes here only apply to the ${activeScopeLabel} workspace`}
    >
      {isGlobalScope
        ? <McpScopeGlobeIcon aria-hidden="true" />
        : <McpScopeWorkspaceIcon aria-hidden="true" />}
      <span>{activeScopeLabel}</span>
    </McpScopeBadge>
  );

  return (
    <McpWorkspaceSurface
      aria-label="Workspace MCPs"
      data-scope-cards={scopeCardsVisible ? "true" : undefined}
      data-screen={screen}
    >
      {/* One compact bar holds every selection: list view, search, and the
          secondary actions. Scope is picked via the card strip below on the
          list screen; every other screen pins a scope badge here so it's
          always clear whether an edit lands in the global defaults or a
          single workspace. Detail keeps a compact escape hatch so a stale
          selection can never trap the user. */}
      <McpHubTopBar>
        {screen === "detail" ? (
          <>
            <McpHubGhostButton onClick={() => setScreen("list")} type="button">
              ‹ MCPs
            </McpHubGhostButton>
            <McpHubDetailCrumb title={selectedServer?.name || "MCP settings"}>
              {selectedServer?.name || "MCP settings"}
            </McpHubDetailCrumb>
            {scopeSelectable && scopeBadge}
          </>
        ) : scopeSelectable && screen !== "list" && scopeBadge}
        {screen === "list" && (
          <Select
            aria-label="MCP list view"
            isSearchable={false}
            menuPosition="fixed"
            menuPortalTarget={selectPortalTarget()}
            onChange={(option) => setListTab(option?.value || "installed")}
            options={listViewOptions}
            styles={MCP_BAR_SELECT_STYLES}
            value={optionForValue(listViewOptions, listTab)}
          />
        )}
        {screen !== "detail" && (
          <>
            <McpHubSearchInput
              aria-label="Search MCPs"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search MCPs…"
              type="search"
              value={search}
            />
            <McpHubGhostButton
              disabled={isBusy}
              onClick={() => setScreen("manual")}
              title="Paste a codex/claude mcp add command"
              type="button"
            >
              Add custom
            </McpHubGhostButton>
            <McpHubGhostButton
              disabled={isBusy}
              onClick={() => setScreen("sources")}
              title="Marketplace sources and discovered MCPs"
              type="button"
            >
              Sources
            </McpHubGhostButton>
          </>
        )}
        <McpHubGhostButton disabled={isBusy} onClick={refresh} type="button">
          {buttonContent(isLoading && !isActionBusy, "Refresh", "Refreshing")}
        </McpHubGhostButton>
        {isActionBusy && (
          <McpActionStatus aria-live="polite" title={busyCopy.detail}>
            <McpButtonSpinner aria-hidden="true" />
            <span>
              <strong>{busyCopy.title}</strong>
            </span>
          </McpActionStatus>
        )}
      </McpHubTopBar>

      {scopeCardsVisible && (
        <McpScopeStrip aria-label="MCP scope">
          {scopeOptions.map((option) => {
            const optionValue = option?.value || "";
            const active = optionValue === scopeValue;
            const optionIsGlobal = optionValue === MCP_GLOBAL_SCOPE_VALUE;
            return (
              <McpScopeCard
                aria-pressed={active ? "true" : "false"}
                data-active={active ? "true" : undefined}
                disabled={isBusy && !active}
                key={optionValue}
                onClick={() => {
                  if (!active) onScopeChange(optionValue);
                }}
                title={optionIsGlobal
                  ? "Defaults every workspace inherits"
                  : `MCPs for the ${option.label} workspace only`}
                type="button"
              >
                <McpScopeCardIcon>
                  {optionIsGlobal
                    ? <McpScopeGlobeIcon aria-hidden="true" />
                    : <McpScopeWorkspaceIcon aria-hidden="true" />}
                </McpScopeCardIcon>
                <McpScopeCardCopy>
                  <strong>{option.label}</strong>
                  <span>
                    {active
                      ? "Editing this scope"
                      : optionIsGlobal
                        ? "All workspaces"
                        : "This workspace only"}
                  </span>
                </McpScopeCardCopy>
              </McpScopeCard>
            );
          })}
        </McpScopeStrip>
      )}

      <McpHubScroll ref={scrollRef}>
        {error && screen !== "detail" && <McpEmptyAccess role="alert">{error}</McpEmptyAccess>}
        {status === "missing_workspace" ? (
          <McpEmptyAccess>The MCP registry needs a saved workspace before it can load.</McpEmptyAccess>
        ) : screen === "manual" ? (
          renderManualEditor()
        ) : screen === "sources" ? (
          renderSourcesScreen()
        ) : screen === "detail" ? (
          renderDetails()
        ) : (
          renderListScreen()
        )}
      </McpHubScroll>
    </McpWorkspaceSurface>
  );
}

// --- Single-column MCP hub (list + detail) ---------------------------------

const McpHubTopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: nowrap;
`;

/* Scope picker: one card per install target (global defaults + each
   workspace) so it's obvious which registry the list below edits. */
const McpScopeStrip = styled.div`
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: min(880px, 100%);
  justify-self: center;
  min-width: 0;
  overflow-x: auto;
  padding: 2px;
  scrollbar-width: thin;
`;

const McpScopeCard = styled.button`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  min-width: 168px;
  max-width: 232px;
  padding: 9px 12px;
  border: 1px solid var(--mcp-border, var(--forge-border, rgba(230, 236, 245, 0.1)));
  border-radius: 10px;
  color: var(--forge-text, #f4f7fa);
  background: var(--mcp-panel-bg, rgba(17, 22, 29, 0.78));
  cursor: pointer;
  text-align: left;
  transition: border-color 130ms ease, background 130ms ease, box-shadow 130ms ease;

  &:hover:not(:disabled):not([data-active="true"]) {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.32);
    background: var(--mcp-hover-bg, rgba(230, 236, 245, 0.035));
  }

  &[data-active="true"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.55);
    background: var(--mcp-active-bg, rgba(var(--forge-accent-rgb), 0.12));
    box-shadow: 0 0 0 1px rgba(var(--forge-accent-rgb), 0.22);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const McpScopeCardIcon = styled.span`
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: var(--forge-text-soft, #b6c0cc);
  background: var(--mcp-icon-bg, rgba(21, 27, 35, 0.72));

  svg {
    width: 15px;
    height: 15px;
  }

  [data-active="true"] > & {
    color: var(--forge-accent-soft, #7db0ff);
    background: rgba(var(--forge-accent-rgb), 0.16);
  }
`;

const McpScopeCardCopy = styled.span`
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
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-active="true"] > & span {
    color: var(--forge-accent-soft, #7db0ff);
  }
`;

/* Pinned scope reminder on the editor/detail screens. */
const McpScopeBadge = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  max-width: 210px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.3);
  border-radius: 999px;
  color: var(--forge-accent-soft, #7db0ff);
  background: rgba(var(--forge-accent-rgb), 0.1);
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  svg {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }
`;

const McpHubScroll = styled.div`
  display: grid;
  align-content: start;
  width: min(880px, 100%);
  justify-self: center;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 2px 24px;
  scrollbar-width: thin;
`;

const McpHubSearchInput = styled(McpInput)`
  flex: 1 1 160px;
  min-width: 140px;
  width: 100%;
`;

const McpHubDetailCrumb = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-soft, #b6c0cc);
  font-size: 12px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const McpHubGhostButton = styled.button`
  flex: 0 0 auto;
  padding: 8px 13px;
  border: 1px solid var(--mcp-border, var(--forge-border, rgba(230, 236, 245, 0.12)));
  border-radius: 8px;
  color: var(--forge-text-soft, #b6c0cc);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.28);
    color: var(--forge-text, #f4f7fa);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const McpHubSectionLabel = styled.span`
  margin-top: 2px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const McpHubList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--mcp-border, var(--forge-border, rgba(230, 236, 245, 0.08)));
  border-radius: 10px;
  background: var(--mcp-panel-bg, rgba(7, 9, 13, 0.4));
`;

const McpHubRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 12px 0 0;
  border-bottom: 1px solid var(--mcp-border, var(--forge-border, rgba(230, 236, 245, 0.05)));

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--mcp-hover-bg, rgba(230, 236, 245, 0.03));
  }
`;

const McpHubRowButton = styled.button`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
  padding: 8px 12px;
  border: 0;
  color: var(--forge-text, #f4f7fa);
  background: transparent;
  cursor: pointer;
  text-align: left;
`;

const McpHubRowStatic = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
  padding: 8px 12px;
`;

const McpHubRowIcon = styled.span`
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: var(--forge-text-soft, #b6c0cc);
  background: var(--mcp-icon-bg, rgba(230, 236, 245, 0.06));

  svg {
    width: 15px;
    height: 15px;
  }

  > span {
    font-size: 12px;
    font-weight: 800;
  }

  &[data-state="enabled"] {
    color: rgba(140, 230, 180, 0.95);
    background: rgba(60, 203, 127, 0.1);
  }

  &[data-state="blocked"] {
    color: rgba(250, 180, 180, 0.92);
    background: rgba(239, 107, 107, 0.1);
  }
`;

const McpHubRowCopy = styled.div`
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

const McpHubRowSide = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
`;

const McpHubRowSwitch = styled(McpSwitchButton)`
  min-height: 26px;
  gap: 0;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 0;
`;

const McpHubRowHint = styled.span`
  color: var(--forge-text-muted, #7a8493);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
`;

const McpHubRowButtonAction = styled.button`
  padding: 5px 12px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.3);
  border-radius: 7px;
  color: var(--forge-accent-soft, rgba(200, 222, 255, 0.95));
  background: var(--mcp-active-bg, rgba(var(--forge-accent-rgb), 0.12));
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: rgba(var(--forge-accent-rgb), 0.24);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const McpHubBackRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;





const McpSecretRows = styled.div`
  display: grid;
  min-width: 0;
  gap: 8px;
`;

const McpSecretRow = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(130px, 0.58fr) minmax(220px, 1.42fr) auto;
  align-items: end;
  gap: 8px;

  @container (max-width: 680px) {
    grid-template-columns: 1fr;
  }
`;

const McpSecretField = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
`;

const McpSecretActions = styled(McpInlineActions)`
  align-self: end;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 6px;

  @container (max-width: 680px) {
    justify-content: flex-start;
  }
`;

const SecretsToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin: 2px 0 2px;
`;

const SecretsToolbarHint = styled.span`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--forge-text-muted);
`;

const SecretButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 34px;
  padding: 0 13px;
  border-radius: 8px;
  border: 1px solid var(--forge-border);
  background: var(--forge-surface-control, rgba(21, 27, 35, 0.72));
  color: var(--forge-text-soft);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease,
    color 140ms ease, box-shadow 140ms ease;

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  &:hover:not(:disabled) {
    border-color: rgba(var(--forge-accent-rgb), 0.42);
    color: var(--forge-text);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &[data-variant="primary"] {
    border-color: rgba(var(--forge-accent-rgb), 0.5);
    background: rgba(var(--forge-accent-rgb), 0.16);
    color: var(--forge-text);
  }

  &[data-variant="primary"]:hover:not(:disabled) {
    background: rgba(var(--forge-accent-rgb), 0.26);
    box-shadow: 0 0 0 1px rgba(var(--forge-accent-rgb), 0.32);
  }

  &[data-variant="danger"]:hover:not(:disabled) {
    border-color: var(--forge-red, #e5484d);
    color: var(--forge-red, #e5484d);
  }
`;

const SecretButtonGlyph = styled.span`
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  margin-top: -1px;
`;

const SecretValueBox = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: var(--forge-surface-control, rgba(21, 27, 35, 0.55));
  color: var(--forge-text-soft);
  font-size: 12px;

  &[data-revealed="true"] {
    overflow-x: auto;
  }
`;

const SecretMaskDots = styled.span`
  letter-spacing: 3px;
  font-size: 15px;
  line-height: 1;
  color: var(--forge-text-muted);
`;

const SecretStoredHint = styled.span`
  margin-left: auto;
  padding-left: 12px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--forge-text-muted);
`;

const SecretRevealedText = styled.span`
  font-family: var(--forge-mono, ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  color: var(--forge-text);
  white-space: nowrap;
  user-select: text;
`;
