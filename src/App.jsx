import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "@vscode/codicons/dist/codicon.css";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import styled, { createGlobalStyle, keyframes } from "styled-components";
import { Add } from "@styled-icons/material-rounded/Add";
import { Bolt } from "@styled-icons/material-rounded/Bolt";
import { ChevronRight } from "@styled-icons/material-rounded/ChevronRight";
import { CheckCircle } from "@styled-icons/material-rounded/CheckCircle";
import { Close } from "@styled-icons/material-rounded/Close";
import { CloudDone } from "@styled-icons/material-rounded/CloudDone";
import { Code } from "@styled-icons/material-rounded/Code";
import { CropSquare } from "@styled-icons/material-rounded/CropSquare";
import { Description } from "@styled-icons/material-rounded/Description";
import { ErrorOutline } from "@styled-icons/material-rounded/ErrorOutline";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { FolderOpen } from "@styled-icons/material-rounded/FolderOpen";
import { FullscreenExit } from "@styled-icons/material-rounded/FullscreenExit";
import { Hub } from "@styled-icons/material-rounded/Hub";
import { Key } from "@styled-icons/material-rounded/Key";
import { Login } from "@styled-icons/material-rounded/Login";
import { Logout } from "@styled-icons/material-rounded/Logout";
import { Mic } from "@styled-icons/material-rounded/Mic";
import { Remove } from "@styled-icons/material-rounded/Remove";
import { OpenInBrowser } from "@styled-icons/material-rounded/OpenInBrowser";
import { Pending } from "@styled-icons/material-rounded/Pending";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";
import { Terminal as TerminalIcon } from "@styled-icons/material-rounded/Terminal";
import { authStore, DEFAULT_AUTH_MESSAGE, isSafeAuthValue, useAuthSnapshot } from "./authStore";
import { createTerminalResizeController, measureTerminalGrid } from "./terminalResizeController";

const WEB_LOGIN_URL = "https://diffforge.ai/desktop/login";
const PRICING_URL = "https://diffforge.ai/pricing";
const BRAND_NAME = "Diff Forge AI";
const TERMINAL_THEME_BACKGROUND = "#020304";
const TITLE_BAR_HEIGHT = "34px";
const LAUNCH_MINIMUM_MS = 1400;
const AUTH_STARTUP_TIMEOUT_MS = 5000;
const DEEP_LINK_STARTUP_TIMEOUT_MS = 1000;
const SESSION_RESTORE_TIMEOUT_MS = 5000;
const SESSION_RESTORE_TIMEOUT_MESSAGE = "Secure session check timed out after 5 seconds.";
const AUTH_EXCHANGE_TIMEOUT_MS = 10000;
const AUTH_EXCHANGE_TIMEOUT_MESSAGE = "Desktop sign in timed out. Try again.";
const OPEN_BROWSER_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MESSAGE = "Diff Forge API check timed out.";
const PLAN_REFRESH_TIMEOUT_MS = 5000;
const LOGOUT_TIMEOUT_MS = 5000;
const VIEW_TRANSITION_MS = 170;
const WINDOW_FRAME_STATE_DEFAULT = { isFullscreen: false, isMaximized: false };
const DEFAULT_WORKSPACE_VIEW = "terminals";
const WORKSPACE_TERMINAL_PANE_PREFIX = "workspace-terminal";
const TERMINAL_CLOSE_ALL_PROGRESS_EVENT = "forge-terminal-close-all-progress";
const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT = "forge-audio-model-download-progress";
const AUDIO_WIDGET_ARM_EVENT = "forge-audio-widget-arm";
const AUDIO_WIDGET_HASH = "#/audio-widget";
const AUDIO_TARGET_SAMPLE_RATE = 16000;
const AUDIO_RECORDING_MAX_SECONDS = 90;
const AUDIO_RECORDING_TIMER_MS = 250;
const AUDIO_BUFFER_MAX_SECONDS = 12;
const AUDIO_BUFFER_PREROLL_SECONDS = 1.2;
const AUDIO_BUFFER_POSTROLL_SECONDS = 0.55;
const AUDIO_MIN_SPEECH_MS = 260;
const AUDIO_AUTO_STOP_SILENCE_MS = 1250;
const AUDIO_VAD_BASE_RMS = 0.012;
const AUDIO_VAD_PEAK = 0.04;
const AUDIO_VAD_NOISE_MULTIPLIER = 3;
const AGENT_STATUS_CACHE_KEY = "diffforge.agentStatuses.v1";
const AGENT_STATUS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WORKSPACE_SETTINGS_STORAGE_KEY = "diffforge.workspaceSettings.v1";
const FILE_EXPLORER_LAYOUT_STORAGE_KEY = "diffforge.fileExplorerLayout.v1";
const FILE_EXPLORER_DEFAULT_SIZE = 28;
const FILE_EXPLORER_MIN_SIZE = 16;
const FILE_EXPLORER_MAX_SIZE = 76;
const FILE_PREVIEW_DEFAULT_SIZE = 72;
const FILE_PREVIEW_MIN_SIZE = 24;
const FILE_PREVIEW_MAX_SIZE = 84;
const MCP_REGISTRY_STORAGE_KEY = "diffforge.mcpRegistry.v1";
const MCP_TEXT_LIMIT = 12000;
const MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH = 2048;
const MIN_WORKSPACE_TERMINAL_COUNT = 1;
const MAX_WORKSPACE_TERMINAL_COUNT = 16;
const WORKSPACE_TERMINAL_PRIMARY_COLUMNS = 2;
const WORKSPACE_TERMINAL_WIDE_START_INDEX = 4;
const WORKSPACE_TERMINAL_WIDE_COLUMNS = 4;
const TERMINAL_DEFAULT_COLS = 80;
const TERMINAL_DEFAULT_ROWS = 24;
const TERMINAL_MIN_COLS = 20;
const TERMINAL_MIN_ROWS = 6;
const TERMINAL_MAX_COLS = 400;
const TERMINAL_MAX_ROWS = 160;
const TERMINAL_START_METRIC_WAIT_MS = 900;
const TERMINAL_START_METRIC_POLL_MS = 16;
const TERMINAL_MIN_CELL_WIDTH_PX = 9;
const TERMINAL_MIN_CELL_HEIGHT_PX = 16;
const TERMINAL_PANE_MIN_WIDTH_PX = TERMINAL_MIN_COLS * TERMINAL_MIN_CELL_WIDTH_PX;
const TERMINAL_PANE_MIN_HEIGHT_PX = TERMINAL_MIN_ROWS * TERMINAL_MIN_CELL_HEIGHT_PX;
const TERMINAL_DEFAULT_SCROLLBACK_ROWS = 10000;
const TERMINAL_METRICS_NOTIFY_MS = 250;
const TERMINAL_TELEMETRY_FLUSH_MS = 60;
const TERMINAL_TELEMETRY_MAX_BATCH = 80;
const TERMINAL_WEBGL_IDLE_DELAY_MS = 420;
const TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS = 80;
const TERMINAL_WEBGL_STAGGER_MS = 90;
const TERMINAL_WEBGL_MAX_DELAY_MS = 1200;
const TERMINAL_RENDER_PROBE_AFTER_WRITE_MS = 80;
const TERMINAL_RENDER_PROBE_AFTER_WEBGL_MS = 140;
const TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS = 80;
const TERMINAL_RESIZE_DEBUG_IDLE_MS = 140;
const TERMINAL_RESIZE_DEBUG_RECENT_MS = 1800;
const TERMINAL_RESIZE_DEBUG_PROBE_DELAYS_MS = [0, 16, 80, 180, 360];
const TERMINAL_XTERM_RENDER_LOG_MIN_MS = 120;
const TERMINAL_BLANK_STARTUP_PROBE_MS = 800;
const TERMINAL_BLANK_STARTUP_CONFIRM_MS = 800;
const TERMINAL_BLANK_STARTUP_RESTART_DELAY_MS = 800;
const TERMINAL_BLANK_STARTUP_RESTART_LIMIT = 3;
const WORKSPACE_CLOSE_INITIAL_STATE = { isActive: false, closed: 0, total: 0 };
const AUTH_STEPS = ["Browser sign in", "State match", "Desktop session"];
const AGENT_PROVIDERS = [
  { id: "codex", label: "Codex", shortLabel: "Codex" },
  { id: "claude", label: "Claude Code", shortLabel: "Claude" },
];
const AGENT_INSTALL_GUIDES = {
  codex: {
    nativeInstallUrl: "https://github.com/openai/codex/releases/latest",
    nativeInstallLabel: "GitHub release binaries",
    installCommand: "npm install -g @openai/codex",
  },
  claude: {
    nativeInstallUrl: "https://code.claude.com/docs/en/quickstart",
    nativeInstallLabel: "Native install guide",
    installCommand: "npm install -g @anthropic-ai/claude-code",
  },
};
const DEFAULT_AGENT_STATUSES = AGENT_PROVIDERS.map((provider) => ({
  ...provider,
  binary: provider.id,
  installed: false,
  authenticated: false,
  version: "Not checked",
  authMessage: "Check terminal CLI status.",
  installCommand: AGENT_INSTALL_GUIDES[provider.id].installCommand,
  nativeInstallUrl: AGENT_INSTALL_GUIDES[provider.id].nativeInstallUrl,
  nativeInstallLabel: AGENT_INSTALL_GUIDES[provider.id].nativeInstallLabel,
  npmAvailable: false,
  npmVersion: "Not checked",
  npmInstalled: false,
  npmPackageVersion: "Not checked",
  npmLatestVersion: "Not checked",
  npmUpdateAvailable: false,
  recommendNativeInstall: true,
  connectCommand: provider.id === "codex" ? "codex login" : "claude",
}));
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

let nextWorkspaceTerminalInstanceId = 1;
const pendingTerminalTelemetry = [];
const terminalMetricsSubscribers = new Set();
const terminalMetricsState = {
  terminalCount: 0,
  ipcEvents: 0,
  ipcBytes: 0,
  outputLagMs: 0,
  startupMs: 0,
  gridMs: 0,
  webglMs: 0,
  resizeBatches: 0,
  resizePanes: 0,
  resizeLagMs: 0,
};
let terminalMetricsNotifyTimer = 0;
let fileExplorerLayoutFlushFrame = 0;
let pendingFileExplorerLayout = null;
let terminalTelemetryFlushTimer = 0;
let nextWorkspaceOpenTelemetryId = 1;
let currentWorkspaceOpenTelemetry = {
  id: 0,
  source: "",
  startedAt: 0,
  workspaceId: "",
};
const AUTH_TILE_SIZE = 40;
const AUTH_TILE_COLUMNS = 64;
const AUTH_TILE_ROWS = 24;
const AUTH_TILE_BURSTS = Array.from({ length: 156 }, (_, index) => {
  const col = (index * 9 + Math.floor(index / 4) * 5) % AUTH_TILE_COLUMNS;
  const row = (index * 7 + Math.floor(index / 6) * 4) % AUTH_TILE_ROWS;
  const delay = `${((index * 0.47) % 12).toFixed(1)}s`;
  const duration = `${(7.2 + (index % 8) * 0.48).toFixed(1)}s`;
  const peak = (0.2 + (index % 6) * 0.026).toFixed(3);

  return [col, row, delay, duration, peak];
});

function AuthSquareBackdrop() {
  return (
    <SquareField aria-hidden="true">
      {AUTH_TILE_BURSTS.map(([col, row, delay, duration, peak]) => (
        <SquarePulse
          key={`${col}-${row}-${delay}`}
          style={{
            "--left": `${col * AUTH_TILE_SIZE}px`,
            "--top": `${row * AUTH_TILE_SIZE}px`,
            "--delay": delay,
            "--duration": duration,
            "--peak": peak,
          }}
        />
      ))}
    </SquareField>
  );
}

function createAuthState() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isPaidUser(sessionUser) {
  return sessionUser?.planStatus === "paid";
}

function parseAuthCallback(urlValue) {
  try {
    const url = new URL(urlValue);

    if (url.protocol !== "diffforge:" || url.hostname !== "auth" || url.pathname !== "/callback") {
      return null;
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    if (!isSafeAuthValue(code) || !isSafeAuthValue(state)) {
      return null;
    }

    return { code, state };
  } catch {
    return null;
  }
}

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function isTerminalSessionMissingError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return message.includes("terminal session is not running")
    || message.includes("terminal session not running");
}

function isDesktopSessionExpiredError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return (
    message.includes("desktop session expired")
    || message.includes("session expired")
    || message.includes("invalid desktop session")
    || message.includes("unauthorized")
    || message.includes("forbidden")
  );
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function runWindowAction(action) {
  action().catch(() => {
    // Window controls are best-effort; failed actions should not break app state.
  });
}

function normalizeCloseCount(value) {
  const count = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function normalizeTerminalCloseProgress(payload) {
  const total = normalizeCloseCount(payload?.total);
  const closed = normalizeCloseCount(payload?.closed);

  return {
    closed: Math.min(closed, total || closed),
    total,
  };
}

async function readWindowFrameState(appWindow = getCurrentWindow()) {
  const [isFullscreen, isMaximized] = await Promise.all([
    appWindow.isFullscreen(),
    appWindow.isMaximized(),
  ]);

  return {
    isFullscreen: Boolean(isFullscreen),
    isMaximized: Boolean(isMaximized),
  };
}

function getAgentTone(agent) {
  if (!agent?.installed) {
    return "offline";
  }

  return agent.authenticated ? "ready" : "needsAuth";
}

function getReadyAgent(agentStatuses, preferredAgentId = "codex") {
  const readyAgents = agentStatuses.filter((agent) => agent.installed && agent.authenticated);
  const preferredAgent = readyAgents.find((agent) => agent.id === preferredAgentId);

  return preferredAgent || readyAgents.find((agent) => agent.id === "codex") || readyAgents[0] || null;
}

function getLaunchableAgent(agentStatuses, preferredAgentId = "codex") {
  const preferredAgent = agentStatuses.find((agent) => agent.id === preferredAgentId);
  const codexAgent = agentStatuses.find((agent) => agent.id === "codex");

  return preferredAgent || codexAgent || agentStatuses[0] || getDefaultAgentStatus("codex");
}

function getAgentStatusSummary(agentStatuses) {
  const codex = agentStatuses.find((agent) => agent.id === "codex");
  const claude = agentStatuses.find((agent) => agent.id === "claude");

  return [codex, claude].filter(Boolean);
}

function getAgentUpdatesAvailable(agentStatuses) {
  return agentStatuses.filter((agent) => (
    agent.installed
    && agent.npmInstalled
    && agent.npmUpdateAvailable
  ));
}

function formatAgentList(agents) {
  const labels = agents.map((agent) => agent.shortLabel || agent.label).filter(Boolean);

  if (labels.length <= 1) {
    return labels[0] || "terminal CLIs";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function getAgentUpdateSummary(agents) {
  const updateLabels = agents.map((agent) => {
    const currentVersion = agent.npmPackageVersion && agent.npmPackageVersion !== "Detected"
      ? agent.npmPackageVersion
      : "installed";
    const latestVersion = agent.npmLatestVersion && agent.npmLatestVersion !== "Not checked"
      ? agent.npmLatestVersion
      : "latest";

    return `${agent.shortLabel || agent.label} ${currentVersion} -> ${latestVersion}`;
  });

  return updateLabels.join(" / ");
}

function cleanWorkspaceRootDirectory(value) {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const uncVerbatimMatch = cleaned.match(/^[\\/]{2}\?[\\/]UNC[\\/](.+)$/i);

  if (uncVerbatimMatch) {
    return `\\\\${uncVerbatimMatch[1]}`.trim();
  }

  const driveVerbatimMatch = cleaned.match(/^[\\/]{2}\?[\\/]([a-z]:[\\/].*)$/i);

  if (driveVerbatimMatch) {
    return driveVerbatimMatch[1].trim();
  }

  return cleaned;
}

function isWindowsSystemRootDirectory(value) {
  const cleaned = cleanWorkspaceRootDirectory(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();

  return /^[a-z]:\/windows(?:\/(?:system32|syswow64)(?:\/.*)?)?$/.test(cleaned)
    || /^\/[a-z]\/windows(?:\/(?:system32|syswow64)(?:\/.*)?)?$/.test(cleaned);
}

function normalizeWorkspaceTerminalCount(value) {
  const count = Number.parseInt(value, 10);

  if (!Number.isFinite(count)) {
    return MIN_WORKSPACE_TERMINAL_COUNT;
  }

  return Math.min(MAX_WORKSPACE_TERMINAL_COUNT, Math.max(MIN_WORKSPACE_TERMINAL_COUNT, count));
}

function normalizeWorkspaceSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceId, settings]) => {
        const cleanedRootDirectory = cleanWorkspaceRootDirectory(settings?.rootDirectory);
        const rootDirectory = isWindowsSystemRootDirectory(cleanedRootDirectory)
          ? ""
          : cleanedRootDirectory;
        const terminalCount = normalizeWorkspaceTerminalCount(settings?.terminalCount);

        if (!workspaceId || (!rootDirectory && terminalCount === MIN_WORKSPACE_TERMINAL_COUNT)) {
          return null;
        }

        return [
          workspaceId,
          {
            rootDirectory: rootDirectory.slice(0, MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH),
            terminalCount,
          },
        ];
      })
      .filter(Boolean),
  );
}

function readWorkspaceSettings() {
  try {
    return normalizeWorkspaceSettings(
      JSON.parse(window.localStorage.getItem(WORKSPACE_SETTINGS_STORAGE_KEY) || "{}"),
    );
  } catch {
    return {};
  }
}

function persistWorkspaceSettings(settings) {
  try {
    window.localStorage.setItem(
      WORKSPACE_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeWorkspaceSettings(settings)),
    );
  } catch {
    // Workspace root settings are convenience state; the app can still run without persistence.
  }
}

function getWorkspaceRootDirectory(workspaceSettings, workspaceId) {
  return cleanWorkspaceRootDirectory(workspaceSettings?.[workspaceId]?.rootDirectory);
}

function getWorkspaceTerminalCount(workspaceSettings, workspaceId) {
  return normalizeWorkspaceTerminalCount(workspaceSettings?.[workspaceId]?.terminalCount);
}

function updateWorkspaceLocalSettings(settings, workspaceId, nextValues = {}) {
  const nextSettings = { ...(settings || {}) };

  if (!workspaceId) {
    return nextSettings;
  }

  const currentSettings = settings?.[workspaceId] || {};
  const hasRootDirectory = Object.prototype.hasOwnProperty.call(nextValues, "rootDirectory");
  const hasTerminalCount = Object.prototype.hasOwnProperty.call(nextValues, "terminalCount");
  const rootDirectory = cleanWorkspaceRootDirectory(
    hasRootDirectory ? nextValues.rootDirectory : currentSettings.rootDirectory,
  ).slice(0, MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH);
  const terminalCount = normalizeWorkspaceTerminalCount(
    hasTerminalCount ? nextValues.terminalCount : currentSettings.terminalCount,
  );

  if (!rootDirectory && terminalCount === MIN_WORKSPACE_TERMINAL_COUNT) {
    delete nextSettings[workspaceId];
    return nextSettings;
  }

  nextSettings[workspaceId] = {
    rootDirectory,
    terminalCount,
  };

  return nextSettings;
}

function getFileExplorerLayoutKey(workspaceId) {
  return String(workspaceId || "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function normalizeFileExplorerLayout(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return [FILE_EXPLORER_DEFAULT_SIZE, FILE_PREVIEW_DEFAULT_SIZE];
  }

  const explorerSize = Math.min(
    FILE_EXPLORER_MAX_SIZE,
    Math.max(FILE_EXPLORER_MIN_SIZE, Number(value[0]) || FILE_EXPLORER_DEFAULT_SIZE),
  );
  const previewSize = Math.min(
    FILE_PREVIEW_MAX_SIZE,
    Math.max(FILE_PREVIEW_MIN_SIZE, Number(value[1]) || FILE_PREVIEW_DEFAULT_SIZE),
  );
  const total = explorerSize + previewSize;

  if (total <= 0) {
    return [FILE_EXPLORER_DEFAULT_SIZE, FILE_PREVIEW_DEFAULT_SIZE];
  }

  return [
    Number(((explorerSize / total) * 100).toFixed(2)),
    Number(((previewSize / total) * 100).toFixed(2)),
  ];
}

function readFileExplorerLayouts() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FILE_EXPLORER_LAYOUT_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getFileExplorerLayout(workspaceId) {
  return normalizeFileExplorerLayout(readFileExplorerLayouts()[getFileExplorerLayoutKey(workspaceId)]);
}

function queueFileExplorerLayout({ workspaceId, sizes }) {
  pendingFileExplorerLayout = {
    key: getFileExplorerLayoutKey(workspaceId),
    sizes: normalizeFileExplorerLayout(sizes),
  };

  if (fileExplorerLayoutFlushFrame) {
    return;
  }

  fileExplorerLayoutFlushFrame = window.requestAnimationFrame(flushFileExplorerLayout);
}

function flushFileExplorerLayout() {
  fileExplorerLayoutFlushFrame = 0;
  const request = pendingFileExplorerLayout;
  pendingFileExplorerLayout = null;

  if (!request) {
    return;
  }

  try {
    const layouts = readFileExplorerLayouts();
    layouts[request.key] = request.sizes;
    window.localStorage.setItem(FILE_EXPLORER_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Explorer layout is convenience state; resizing should keep working without persistence.
  }
}

function getDirectoryName(directory) {
  const cleaned = cleanWorkspaceRootDirectory(directory);

  if (!cleaned) {
    return "App directory";
  }

  const parts = cleaned.split(/[\\/]/).filter(Boolean);

  return parts[parts.length - 1] || cleaned;
}

function getExplorerFileName(relativePath) {
  const parts = String(relativePath || "").split(/[\\/]/).filter(Boolean);

  return parts[parts.length - 1] || "Select a file";
}

function getFileExtension(relativePath) {
  const fileName = getExplorerFileName(relativePath);
  const dotIndex = fileName.lastIndexOf(".");

  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

function getExplorerFileNameLower(relativePath) {
  return getExplorerFileName(relativePath).toLowerCase();
}

function getFileLanguage(relativePath) {
  const extension = getFileExtension(relativePath);
  const fileName = getExplorerFileNameLower(relativePath);

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return "Environment";
  }

  if (fileName === "dockerfile") {
    return "Dockerfile";
  }

  return ({
    bat: "Batch",
    bmp: "Bitmap",
    cjs: "JavaScript",
    cmd: "Command",
    conf: "Config",
    css: "CSS",
    csv: "CSV",
    db: "Database",
    dll: "Binary",
    dockerignore: "Docker ignore",
    eot: "Font",
    exe: "Binary",
    gif: "Image",
    gz: "Archive",
    html: "HTML",
    ico: "Icon",
    jpeg: "Image",
    jpg: "Image",
    js: "JavaScript",
    json: "JSON",
    jsx: "React",
    lock: "Lockfile",
    log: "Log",
    mjs: "JavaScript",
    md: "Markdown",
    mdx: "MDX",
    mp3: "Audio",
    mp4: "Video",
    pdf: "PDF",
    png: "Image",
    ps1: "PowerShell",
    py: "Python",
    rs: "Rust",
    scss: "SCSS",
    sh: "Shell",
    sqlite: "Database",
    svg: "SVG",
    tar: "Archive",
    toml: "TOML",
    ttf: "Font",
    ts: "TypeScript",
    tsx: "React",
    txt: "Text",
    webp: "Image",
    woff: "Font",
    woff2: "Font",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
    zip: "Archive",
  })[extension] || (extension ? extension.toUpperCase() : "Text");
}

function getFileIconMeta(relativePath) {
  const extension = getFileExtension(relativePath);
  const fileName = getExplorerFileNameLower(relativePath);

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return { codicon: "codicon-symbol-key", tone: "config" };
  }

  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return { codicon: "codicon-file-code", tone: "docker" };
  }

  if (
    fileName === "package.json"
    || fileName === "package-lock.json"
    || fileName === "npm-shrinkwrap.json"
  ) {
    return { codicon: "codicon-json", tone: "npm" };
  }

  if (fileName === "cargo.toml" || fileName === "cargo.lock") {
    return { codicon: "codicon-symbol-package", tone: "rust" };
  }

  if (fileName === ".gitignore" || fileName === ".gitattributes" || fileName === ".gitmodules") {
    return { codicon: "codicon-git-branch", tone: "git" };
  }

  const iconMeta = ({
    avif: { codicon: "codicon-file-media", tone: "media" },
    bat: { codicon: "codicon-terminal-cmd", tone: "terminal" },
    bin: { codicon: "codicon-file-binary", tone: "binary" },
    bmp: { codicon: "codicon-file-media", tone: "media" },
    c: { codicon: "codicon-file-code", tone: "code" },
    cc: { codicon: "codicon-file-code", tone: "code" },
    cjs: { codicon: "codicon-file-code", tone: "javascript" },
    cmd: { codicon: "codicon-terminal-cmd", tone: "terminal" },
    conf: { codicon: "codicon-settings-gear", tone: "config" },
    cpp: { codicon: "codicon-file-code", tone: "code" },
    cs: { codicon: "codicon-file-code", tone: "code" },
    css: { codicon: "codicon-symbol-color", tone: "style" },
    csv: { codicon: "codicon-symbol-array", tone: "data" },
    db: { codicon: "codicon-database", tone: "database" },
    dll: { codicon: "codicon-file-binary", tone: "binary" },
    eot: { codicon: "codicon-file-binary", tone: "font" },
    exe: { codicon: "codicon-file-binary", tone: "binary" },
    gif: { codicon: "codicon-file-media", tone: "media" },
    go: { codicon: "codicon-file-code", tone: "code" },
    gz: { codicon: "codicon-file-zip", tone: "archive" },
    h: { codicon: "codicon-file-code", tone: "code" },
    hpp: { codicon: "codicon-file-code", tone: "code" },
    html: { codicon: "codicon-file-code", tone: "markup" },
    ico: { codicon: "codicon-file-media", tone: "media" },
    ini: { codicon: "codicon-settings-gear", tone: "config" },
    java: { codicon: "codicon-file-code", tone: "code" },
    jpeg: { codicon: "codicon-file-media", tone: "media" },
    jpg: { codicon: "codicon-file-media", tone: "media" },
    js: { codicon: "codicon-file-code", tone: "javascript" },
    json: { codicon: "codicon-json", tone: "data" },
    jsx: { codicon: "codicon-file-code", tone: "react" },
    lock: { codicon: "codicon-symbol-key", tone: "lock" },
    log: { codicon: "codicon-file-text", tone: "text" },
    mjs: { codicon: "codicon-file-code", tone: "javascript" },
    md: { codicon: "codicon-markdown", tone: "markdown" },
    mdx: { codicon: "codicon-markdown", tone: "markdown" },
    mov: { codicon: "codicon-file-media", tone: "media" },
    mp3: { codicon: "codicon-file-media", tone: "media" },
    mp4: { codicon: "codicon-file-media", tone: "media" },
    pdf: { codicon: "codicon-file-pdf", tone: "pdf" },
    png: { codicon: "codicon-file-media", tone: "media" },
    ps1: { codicon: "codicon-terminal-powershell", tone: "terminal" },
    py: { codicon: "codicon-file-code", tone: "python" },
    rb: { codicon: "codicon-file-code", tone: "code" },
    rs: { codicon: "codicon-file-code", tone: "rust" },
    sass: { codicon: "codicon-symbol-color", tone: "style" },
    scss: { codicon: "codicon-symbol-color", tone: "style" },
    sh: { codicon: "codicon-terminal-bash", tone: "terminal" },
    sqlite: { codicon: "codicon-database", tone: "database" },
    sql: { codicon: "codicon-database", tone: "database" },
    svg: { codicon: "codicon-symbol-color", tone: "media" },
    tar: { codicon: "codicon-file-zip", tone: "archive" },
    toml: { codicon: "codicon-settings-gear", tone: "config" },
    ts: { codicon: "codicon-file-code", tone: "typescript" },
    tsx: { codicon: "codicon-file-code", tone: "react" },
    ttf: { codicon: "codicon-file-binary", tone: "font" },
    txt: { codicon: "codicon-file-text", tone: "text" },
    vue: { codicon: "codicon-file-code", tone: "markup" },
    wasm: { codicon: "codicon-file-binary", tone: "binary" },
    webp: { codicon: "codicon-file-media", tone: "media" },
    woff: { codicon: "codicon-file-binary", tone: "font" },
    woff2: { codicon: "codicon-file-binary", tone: "font" },
    xml: { codicon: "codicon-file-code", tone: "markup" },
    yaml: { codicon: "codicon-symbol-array", tone: "data" },
    yml: { codicon: "codicon-symbol-array", tone: "data" },
    zip: { codicon: "codicon-file-zip", tone: "archive" },
  })[extension];

  return iconMeta || { codicon: "codicon-file", tone: "file" };
}

function getPrismLanguage(relativePath) {
  const extension = getFileExtension(relativePath);
  const fileName = getExplorerFileNameLower(relativePath);

  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return "bash";
  }

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return "bash";
  }

  return ({
    bash: "bash",
    cjs: "javascript",
    cmd: "powershell",
    css: "css",
    diff: "diff",
    htm: "markup",
    html: "markup",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    lock: "json",
    md: "markdown",
    mdx: "markdown",
    mjs: "javascript",
    ps1: "powershell",
    py: "python",
    rs: "rust",
    sh: "bash",
    svg: "markup",
    toml: "toml",
    ts: "typescript",
    tsx: "tsx",
    xml: "markup",
    yaml: "yaml",
    yml: "yaml",
  })[extension] || "text";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getHighlightedFileHtml(content, relativePath) {
  const language = getPrismLanguage(relativePath);
  const grammar = Prism.languages[language];

  if (!grammar) {
    return escapeHtml(content);
  }

  try {
    return Prism.highlight(content || " ", grammar, language);
  } catch {
    return escapeHtml(content);
  }
}

function getDiffLineTone(line) {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "header";
  }

  if (line.startsWith("@@")) {
    return "hunk";
  }

  if (line.startsWith("+")) {
    return "added";
  }

  if (line.startsWith("-")) {
    return "removed";
  }

  if (line.startsWith("diff --git") || line.startsWith("index ")) {
    return "meta";
  }

  return "context";
}

function getDiffLines(diff) {
  return String(diff || "").split(/\r?\n/).map((line, index) => ({
    id: `${index}-${line.slice(0, 24)}`,
    line: line || " ",
    tone: getDiffLineTone(line),
  }));
}

const GIT_STATUS_LABELS = {
  added: "A",
  conflicted: "!",
  copied: "C",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
};

const GIT_STATUS_NAMES = {
  added: "Added",
  conflicted: "Conflict",
  copied: "Copied",
  deleted: "Deleted",
  modified: "Modified",
  renamed: "Renamed",
  untracked: "Untracked",
};

function normalizeGitStatus(value) {
  return Object.hasOwn(GIT_STATUS_LABELS, value) ? value : "";
}

function getGitStatusLabel(value) {
  return GIT_STATUS_LABELS[normalizeGitStatus(value)] || "";
}

function getGitStatusName(value) {
  return GIT_STATUS_NAMES[normalizeGitStatus(value)] || "";
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size < 0) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAudioPercent(value) {
  const percent = Number(value);

  if (!Number.isFinite(percent)) {
    return "";
  }

  return `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
}

function mergeFloat32Chunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });

  return merged;
}

function resampleFloat32(samples, sourceRate, targetRate) {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || sourceRate === targetRate) {
    return samples;
  }

  const outputLength = Math.max(1, Math.round(samples.length * (targetRate / sourceRate)));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * (sourceRate / targetRate);
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    const left = samples[leftIndex] || 0;
    const right = samples[rightIndex] || 0;

    output[index] = left + (right - left) * mix;
  }

  return output;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  samples.forEach((sample) => {
    const clipped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    const value = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;

    view.setInt16(offset, value, true);
    offset += bytesPerSample;
  });

  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function getAudioStats(samples) {
  let sumSquares = 0;
  let peak = 0;

  samples.forEach((sample) => {
    const value = Number.isFinite(sample) ? sample : 0;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  });

  return {
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
  };
}

async function startLowPowerAudioBuffer({ onStats } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not available in this WebView.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("AudioContext is not available in this WebView.");
  }

  const audioContext = new AudioContextCtor();
  await audioContext.resume();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const maxBufferedSamples = Math.round(audioContext.sampleRate * AUDIO_BUFFER_MAX_SECONDS);
  let totalBufferedSamples = 0;
  let noiseFloor = AUDIO_VAD_BASE_RMS / 2;
  let captureStartedAt = 0;
  let captureSpeechMs = 0;
  let captureSpeechDetected = false;
  let lastSpeechAt = 0;
  let lastStatsAt = 0;
  let closed = false;

  const emitStats = (stats) => {
    const now = performance.now();

    if (!onStats || now - lastStatsAt < 140) {
      return;
    }

    lastStatsAt = now;
    onStats({
      ...stats,
      bufferMs: Math.round((totalBufferedSamples / audioContext.sampleRate) * 1000),
      captureSpeechDetected,
      lastSpeechAgoMs: lastSpeechAt ? Math.max(0, Math.round(now - lastSpeechAt)) : 0,
      noiseFloor,
    });
  };

  const trimBufferedAudio = () => {
    while (totalBufferedSamples > maxBufferedSamples && chunks.length > 1) {
      const removed = chunks.shift();
      totalBufferedSamples -= removed.samples.length;
    }
  };

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);
    const samples = new Float32Array(input);
    const now = performance.now();
    const { rms, peak } = getAudioStats(samples);
    const threshold = Math.max(AUDIO_VAD_BASE_RMS, noiseFloor * AUDIO_VAD_NOISE_MULTIPLIER);
    const speech = rms >= threshold || peak >= AUDIO_VAD_PEAK;
    const durationMs = (samples.length / audioContext.sampleRate) * 1000;

    output.fill(0);
    chunks.push({
      durationMs,
      peak,
      rms,
      samples,
      speech,
      timestamp: now,
    });
    totalBufferedSamples += samples.length;
    trimBufferedAudio();

    if (speech) {
      lastSpeechAt = now;
      if (captureStartedAt) {
        captureSpeechMs += durationMs;
        captureSpeechDetected = true;
      }
    } else if (!captureStartedAt) {
      noiseFloor = (noiseFloor * 0.97) + (rms * 0.03);
    }

    emitStats({
      peak,
      rms,
      speech,
      threshold,
    });
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  return {
    sampleRate: audioContext.sampleRate,
    beginCapture() {
      captureStartedAt = performance.now();
      captureSpeechMs = 0;
      captureSpeechDetected = false;
      lastSpeechAt = 0;
    },
    finishCapture() {
      if (!captureStartedAt) {
        throw new Error("Recorder is not armed.");
      }

      const captureStart = captureStartedAt - (AUDIO_BUFFER_PREROLL_SECONDS * 1000);
      const candidates = chunks.filter((chunk) => (
        chunk.timestamp + chunk.durationMs >= captureStart
      ));
      const firstSpeech = candidates.find((chunk) => chunk.speech);
      const lastSpeech = [...candidates].reverse().find((chunk) => chunk.speech);
      const speechMs = candidates
        .filter((chunk) => chunk.speech)
        .reduce((sum, chunk) => sum + chunk.durationMs, 0);

      captureStartedAt = 0;

      if (!firstSpeech || !lastSpeech || speechMs < AUDIO_MIN_SPEECH_MS) {
        throw new Error("No speech detected.");
      }

      const trimStart = firstSpeech.timestamp - (AUDIO_BUFFER_PREROLL_SECONDS * 1000);
      const trimEnd = lastSpeech.timestamp + lastSpeech.durationMs + (AUDIO_BUFFER_POSTROLL_SECONDS * 1000);
      const speechChunks = candidates.filter((chunk) => (
        chunk.timestamp + chunk.durationMs >= trimStart && chunk.timestamp <= trimEnd
      ));
      const merged = mergeFloat32Chunks(speechChunks.map((chunk) => chunk.samples));
      const maxSamples = Math.round(audioContext.sampleRate * AUDIO_RECORDING_MAX_SECONDS);
      const bounded = merged.length > maxSamples ? merged.slice(merged.length - maxSamples) : merged;
      const resampled = resampleFloat32(bounded, audioContext.sampleRate, AUDIO_TARGET_SAMPLE_RATE);

      return {
        speechMs: Math.round(speechMs),
        wavBuffer: encodeWav(resampled, AUDIO_TARGET_SAMPLE_RATE),
      };
    },
    getCaptureStats() {
      return {
        lastSpeechAgoMs: lastSpeechAt ? Math.max(0, performance.now() - lastSpeechAt) : 0,
        speechDetected: captureSpeechDetected,
        speechMs: captureSpeechMs,
      };
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
    },
  };
}

function getSafePaneToken(value) {
  const token = String(value || "workspace")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 48);

  return token || "workspace";
}

function getWorkspaceTerminalPaneId(workspaceId, terminalIndex, agentId = "agent") {
  return `${WORKSPACE_TERMINAL_PANE_PREFIX}-${getSafePaneToken(workspaceId)}-${terminalIndex}-${agentId || "agent"}`;
}

function getDefaultTerminalIndexes(count) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);

  return Array.from({ length: terminalCount }, (_, index) => index);
}

function normalizeWorkspaceTerminalIndexes(indexes, count) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const usedIndexes = new Set();
  const normalizedIndexes = [];

  if (Array.isArray(indexes)) {
    indexes.forEach((index) => {
      const terminalIndex = Number.parseInt(index, 10);

      if (
        Number.isInteger(terminalIndex)
        && terminalIndex >= 0
        && terminalIndex < MAX_WORKSPACE_TERMINAL_COUNT
        && !usedIndexes.has(terminalIndex)
      ) {
        usedIndexes.add(terminalIndex);
        normalizedIndexes.push(terminalIndex);
      }
    });
  }

  let nextIndex = 0;

  while (normalizedIndexes.length < terminalCount) {
    if (!usedIndexes.has(nextIndex)) {
      usedIndexes.add(nextIndex);
      normalizedIndexes.push(nextIndex);
    }

    nextIndex += 1;
  }

  return normalizedIndexes.slice(0, terminalCount);
}

function closeWorkspaceTerminalPane({
  agentId,
  nextTerminalCount,
  previousTerminalCount,
  reason,
  terminalIndex,
  workspaceId,
}) {
  const paneId = getWorkspaceTerminalPaneId(workspaceId, terminalIndex, agentId);

  writeTerminalTelemetry({
    paneId,
    phase: "frontend.workspace.terminal.close_removed_start",
    fields: {
      agentId,
      nextTerminalCount,
      previousTerminalCount,
      reason,
      terminalIndex,
      workspaceId,
    },
  });

  invoke("terminal_close", { paneId })
    .then(() => {
      writeTerminalTelemetry({
        paneId,
        phase: "frontend.workspace.terminal.close_removed_done",
        fields: {
          agentId,
          nextTerminalCount,
          previousTerminalCount,
          reason,
          terminalIndex,
          workspaceId,
        },
      });
    })
    .catch((error) => {
      writeTerminalTelemetry({
        paneId,
        phase: "frontend.workspace.terminal.close_removed_error",
        fields: {
          agentId,
          error: getErrorMessage(error, "Unable to close removed terminal."),
          nextTerminalCount,
          previousTerminalCount,
          reason,
          terminalIndex,
          workspaceId,
        },
      });
    });
}

function getTerminalPanelRows(terminalIndexes) {
  const indexes = Array.isArray(terminalIndexes)
    ? terminalIndexes
    : getDefaultTerminalIndexes(terminalIndexes);
  const visibleIndexes = indexes.length ? indexes : getDefaultTerminalIndexes(MIN_WORKSPACE_TERMINAL_COUNT);
  const rows = new Map();

  visibleIndexes.forEach((terminalIndex) => {
    const safeIndex = Math.max(0, Number.parseInt(terminalIndex, 10) || 0);
    const isPrimarySlot = safeIndex < WORKSPACE_TERMINAL_WIDE_START_INDEX;
    const rowIndex = isPrimarySlot
      ? Math.floor(safeIndex / WORKSPACE_TERMINAL_PRIMARY_COLUMNS)
      : Math.floor(WORKSPACE_TERMINAL_WIDE_START_INDEX / WORKSPACE_TERMINAL_PRIMARY_COLUMNS)
        + Math.floor((safeIndex - WORKSPACE_TERMINAL_WIDE_START_INDEX) / WORKSPACE_TERMINAL_WIDE_COLUMNS);
    const columnIndex = isPrimarySlot
      ? safeIndex % WORKSPACE_TERMINAL_PRIMARY_COLUMNS
      : (safeIndex - WORKSPACE_TERMINAL_WIDE_START_INDEX) % WORKSPACE_TERMINAL_WIDE_COLUMNS;

    if (!rows.has(rowIndex)) {
      rows.set(rowIndex, []);
    }

    rows.get(rowIndex).push({ columnIndex, terminalIndex: safeIndex });
  });

  return Array.from(rows.entries())
    .sort(([leftRow], [rightRow]) => leftRow - rightRow)
    .map(([rowIndex, rowTerminals]) => ({
      rowIndex,
      terminalIndexes: rowTerminals
        .sort((left, right) => left.columnIndex - right.columnIndex)
        .map(({ terminalIndex }) => terminalIndex),
    }));
}

function getNextWorkspaceTerminalInstanceId() {
  const instanceId = nextWorkspaceTerminalInstanceId;
  nextWorkspaceTerminalInstanceId = nextWorkspaceTerminalInstanceId >= Number.MAX_SAFE_INTEGER
    ? 1
    : nextWorkspaceTerminalInstanceId + 1;

  return instanceId;
}

function normalizeTerminalDimension(value, fallback, minimum, maximum) {
  const dimension = Number.isFinite(value) ? Math.floor(value) : fallback;

  return Math.min(maximum, Math.max(minimum, dimension));
}

function getTerminalPaneMinSizePercent(panelCount) {
  const count = Math.max(1, Number.parseInt(panelCount, 10) || 1);
  const fairShare = 100 / count;
  const minimum = Math.max(5, Math.min(18, fairShare * 0.55));

  return `${minimum.toFixed(2)}%`;
}

function getElementDiagnostics(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    display: style.display,
    visibility: style.visibility,
    opacity: Number.parseFloat(style.opacity || "1"),
    overflow: style.overflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    position: style.position,
    zIndex: style.zIndex,
    pointerEvents: style.pointerEvents,
    backgroundColor: style.backgroundColor,
    color: style.color,
    transform: style.transform === "none" ? "" : style.transform,
  };
}

function getShortElementClassName(element) {
  if (!element?.className) {
    return "";
  }

  if (typeof element.className === "string") {
    return element.className.slice(0, 180);
  }

  return String(element.className?.baseVal || "").slice(0, 180);
}

function getElementDescriptor(element) {
  if (!element) {
    return null;
  }

  const style = window.getComputedStyle(element);

  return {
    tag: element.tagName?.toLowerCase() || "",
    id: (element.id || "").slice(0, 80),
    className: getShortElementClassName(element),
    dataState: element.getAttribute?.("data-state") || "",
    dataDirection: element.getAttribute?.("data-direction") || "",
    dataResizeHandleState: element.getAttribute?.("data-resize-handle-state") || "",
    dataPanelId: element.getAttribute?.("data-panel-id") || element.getAttribute?.("data-panel") || "",
    display: style.display,
    visibility: style.visibility,
    opacity: Number.parseFloat(style.opacity || "1"),
    pointerEvents: style.pointerEvents,
    position: style.position,
    zIndex: style.zIndex,
    backgroundColor: style.backgroundColor,
  };
}

function getPointElementDiagnostics(container, label, x, y) {
  const topElement = document.elementFromPoint(x, y);
  const containerContainsTop = Boolean(topElement && container.contains(topElement));

  return {
    label,
    x: Math.round(x),
    y: Math.round(y),
    containerContainsTop,
    topElement: getElementDescriptor(topElement),
    closestXterm: getElementDescriptor(topElement?.closest?.(".xterm")),
    closestFrame: getElementDescriptor(topElement?.closest?.("[data-state]")),
    closestResizeHandle: getElementDescriptor(topElement?.closest?.("[data-resize-handle-state]")),
  };
}

function getTerminalPointDiagnostics(container) {
  const rect = container.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return [];
  }

  const left = rect.left;
  const top = rect.top;
  const right = rect.right;
  const bottom = rect.bottom;

  return [
    getPointElementDiagnostics(container, "center", left + rect.width / 2, top + rect.height / 2),
    getPointElementDiagnostics(container, "top_left", left + Math.min(12, rect.width / 3), top + Math.min(12, rect.height / 3)),
    getPointElementDiagnostics(container, "top_right", right - Math.min(12, rect.width / 3), top + Math.min(12, rect.height / 3)),
    getPointElementDiagnostics(container, "bottom_left", left + Math.min(12, rect.width / 3), bottom - Math.min(12, rect.height / 3)),
    getPointElementDiagnostics(container, "bottom_right", right - Math.min(12, rect.width / 3), bottom - Math.min(12, rect.height / 3)),
  ];
}

function getTerminalDomRowsDiagnostics(rowsElement) {
  if (!rowsElement) {
    return null;
  }

  const rowElements = Array.from(rowsElement.children);
  let nonEmptyDomRows = 0;
  let domTextLength = 0;
  let firstNonEmptyText = "";

  rowElements.forEach((row) => {
    const text = (row.textContent || "").trim();

    if (!text) {
      return;
    }

    nonEmptyDomRows += 1;
    domTextLength += text.length;

    if (!firstNonEmptyText) {
      firstNonEmptyText = text.slice(0, 120);
    }
  });

  return {
    childCount: rowElements.length,
    nonEmptyDomRows,
    domTextLength,
    firstNonEmptyText,
  };
}

function getTerminalBufferDiagnostics(terminal) {
  const buffer = terminal.buffer?.active;

  if (!buffer) {
    return null;
  }

  let nonEmptyViewportRows = 0;
  let wrappedViewportRows = 0;
  const viewportStart = Math.max(0, buffer.viewportY || 0);
  const viewportEnd = Math.min(buffer.length || 0, viewportStart + (terminal.rows || 0));

  for (let index = viewportStart; index < viewportEnd; index += 1) {
    const line = buffer.getLine(index);

    if (!line) {
      continue;
    }

    if (line.isWrapped) {
      wrappedViewportRows += 1;
    }

    if (line.translateToString(true).trim().length > 0) {
      nonEmptyViewportRows += 1;
    }
  }

  return {
    baseY: buffer.baseY,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    length: buffer.length,
    viewportY: buffer.viewportY,
    nonEmptyViewportRows,
    wrappedViewportRows,
  };
}

function getTerminalRenderDiagnostics(container, terminal, rendererMode) {
  const terminalElement = terminal.element || container.querySelector(".xterm");
  const screenElement = container.querySelector(".xterm-screen");
  const rowsElement = container.querySelector(".xterm-rows");
  const viewportElement = container.querySelector(".xterm-viewport");
  const helperTextarea = container.querySelector(".xterm-helper-textarea");
  const terminalFrame = container.closest("[data-state]");
  const resizePanel = container.closest("[data-panel-id], [data-panel]");
  const canvases = Array.from(container.querySelectorAll("canvas"));
  const visibleCanvasCount = canvases.filter((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const style = window.getComputedStyle(canvas);

    return rect.width > 0
      && rect.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none"
      && Number.parseFloat(style.opacity || "1") > 0;
  }).length;
  const primaryCanvas = canvases[0];
  const canvasRect = primaryCanvas?.getBoundingClientRect();

  const buffer = getTerminalBufferDiagnostics(terminal);
  const domRows = getTerminalDomRowsDiagnostics(rowsElement);

  return {
    rendererMode,
    devicePixelRatio: window.devicePixelRatio || 1,
    terminalCols: terminal.cols,
    terminalRows: terminal.rows,
    container: getElementDiagnostics(container),
    containerScroll: {
      scrollLeft: Math.round(container.scrollLeft || 0),
      scrollTop: Math.round(container.scrollTop || 0),
    },
    terminalFrame: getElementDiagnostics(terminalFrame),
    resizePanel: getElementDiagnostics(resizePanel),
    terminalElement: getElementDiagnostics(terminalElement),
    screen: getElementDiagnostics(screenElement),
    rows: getElementDiagnostics(rowsElement),
    domRows,
    viewport: getElementDiagnostics(viewportElement),
    topElements: getTerminalPointDiagnostics(container),
    activeElement: getElementDescriptor(document.activeElement),
    helperTextareaFocused: document.activeElement === helperTextarea,
    canvasCount: canvases.length,
    visibleCanvasCount,
    canvas: primaryCanvas
      ? {
        width: primaryCanvas.width,
        height: primaryCanvas.height,
        clientWidth: Math.round(canvasRect?.width || 0),
        clientHeight: Math.round(canvasRect?.height || 0),
      }
      : null,
    buffer,
    possibleVisualBlank: Boolean(
      buffer
      && domRows
      && buffer.nonEmptyViewportRows > 0
      && domRows.nonEmptyDomRows === 0
      && visibleCanvasCount === 0
    ),
  };
}

function startWorkspaceOpenTelemetry({
  source,
  workspaceId,
  fields = {},
}) {
  if (!workspaceId) {
    return currentWorkspaceOpenTelemetry;
  }

  const openId = nextWorkspaceOpenTelemetryId;
  nextWorkspaceOpenTelemetryId = nextWorkspaceOpenTelemetryId >= Number.MAX_SAFE_INTEGER
    ? 1
    : nextWorkspaceOpenTelemetryId + 1;

  currentWorkspaceOpenTelemetry = {
    id: openId,
    source,
    startedAt: performance.now(),
    workspaceId,
  };

  writeTerminalTelemetry({
    paneId: workspaceId,
    phase: "frontend.workspace.open_start",
    fields: {
      source,
      workspaceId,
      workspaceOpenId: openId,
      ...fields,
    },
  });

  return currentWorkspaceOpenTelemetry;
}

function getWorkspaceOpenTelemetryFields(workspaceId) {
  if (
    !workspaceId
    || currentWorkspaceOpenTelemetry.workspaceId !== workspaceId
    || !currentWorkspaceOpenTelemetry.startedAt
  ) {
    return {};
  }

  return {
    workspaceId,
    workspaceOpenElapsedMs: performance.now() - currentWorkspaceOpenTelemetry.startedAt,
    workspaceOpenId: currentWorkspaceOpenTelemetry.id,
    workspaceOpenSource: currentWorkspaceOpenTelemetry.source,
  };
}

function getTerminalMetricsSnapshot() {
  return { ...terminalMetricsState };
}

function emitTerminalMetricsSoon() {
  if (terminalMetricsNotifyTimer) {
    return;
  }

  terminalMetricsNotifyTimer = window.setTimeout(() => {
    terminalMetricsNotifyTimer = 0;
    const snapshot = getTerminalMetricsSnapshot();
    terminalMetricsSubscribers.forEach((subscriber) => subscriber(snapshot));
  }, TERMINAL_METRICS_NOTIFY_MS);
}

function patchTerminalMetrics(patch) {
  Object.assign(terminalMetricsState, patch);
  emitTerminalMetricsSoon();
}

function addTerminalMetrics(delta) {
  Object.entries(delta).forEach(([key, value]) => {
    terminalMetricsState[key] = (terminalMetricsState[key] || 0) + value;
  });
  emitTerminalMetricsSoon();
}

function subscribeTerminalMetrics(subscriber) {
  terminalMetricsSubscribers.add(subscriber);
  subscriber(getTerminalMetricsSnapshot());

  return () => {
    terminalMetricsSubscribers.delete(subscriber);
  };
}

function useTerminalDevMetrics() {
  const [metrics, setMetrics] = useState(getTerminalMetricsSnapshot);

  useEffect(() => subscribeTerminalMetrics(setMetrics), []);

  return metrics;
}

function writeTerminalTelemetry({
  paneId,
  instanceId,
  phase,
  message = "",
  cols,
  rows,
  elapsedMs,
  fields = {},
}) {
  pendingTerminalTelemetry.push({
    tsMs: Date.now(),
    paneId,
    instanceId,
    phase,
    message,
    cols,
    rows,
    elapsedMs,
    fields,
  });

  if (pendingTerminalTelemetry.length >= TERMINAL_TELEMETRY_MAX_BATCH) {
    if (terminalTelemetryFlushTimer) {
      window.clearTimeout(terminalTelemetryFlushTimer);
      terminalTelemetryFlushTimer = 0;
    }
    flushTerminalTelemetry();
    return;
  }

  if (!terminalTelemetryFlushTimer) {
    terminalTelemetryFlushTimer = window.setTimeout(
      flushTerminalTelemetry,
      TERMINAL_TELEMETRY_FLUSH_MS,
    );
  }
}

function flushTerminalTelemetry() {
  terminalTelemetryFlushTimer = 0;
  const requests = pendingTerminalTelemetry.splice(0, TERMINAL_TELEMETRY_MAX_BATCH);

  if (!requests.length) {
    return;
  }

  invoke("terminal_telemetry_log_many", { requests }).catch(() => {});

  if (pendingTerminalTelemetry.length && !terminalTelemetryFlushTimer) {
    terminalTelemetryFlushTimer = window.setTimeout(
      flushTerminalTelemetry,
      TERMINAL_TELEMETRY_FLUSH_MS,
    );
  }
}

function formatMetricBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMetricMs(value) {
  return `${Math.max(0, Math.round(Number(value) || 0))} ms`;
}

function TerminalDevMetrics({ metrics }) {
  return (
    <TerminalDevMetricsBar aria-label="Terminal performance metrics">
      <TerminalDevMetric>ipc {metrics.ipcEvents} / {formatMetricBytes(metrics.ipcBytes)}</TerminalDevMetric>
      <TerminalDevMetric>out {formatMetricMs(metrics.outputLagMs)}</TerminalDevMetric>
      <TerminalDevMetric>open {formatMetricMs(metrics.startupMs)}</TerminalDevMetric>
      <TerminalDevMetric>grid {formatMetricMs(metrics.gridMs)}</TerminalDevMetric>
      <TerminalDevMetric>webgl {formatMetricMs(metrics.webglMs)}</TerminalDevMetric>
      <TerminalDevMetric>resize {formatMetricMs(metrics.resizeLagMs)} / {metrics.resizePanes}</TerminalDevMetric>
    </TerminalDevMetricsBar>
  );
}

function WorkspaceTerminal({
  agent,
  agentLaunchEpoch = 0,
  agentLaunchReady = true,
  agentStatuses,
  agentStatusError,
  agentStatusState,
  onCloseTerminal,
  onOpenSettings,
  onPreparedTerminalChange,
  onRecheckAgents,
  prewarmShell = false,
  terminalIndex = 0,
  terminalCount = 1,
  useWebglRenderer = true,
  workingDirectory,
  workspace,
  workspaceError,
}) {
  const containerRef = useRef(null);
  const terminalInstanceIdRef = useRef(0);
  const agentLaunchEpochRef = useRef(agentLaunchEpoch);
  const agentLaunchReadyRef = useRef(agentLaunchReady);
  const lastAgentLaunchEpochRef = useRef(0);
  const startAgentInPrewarmedTerminalRef = useRef(null);
  const blankStartupRestartCountRef = useRef(0);
  const [terminalState, setTerminalState] = useState(agent ? "starting" : "blocked");
  const [terminalError, setTerminalError] = useState("");
  const [restartKey, setRestartKey] = useState(0);
  const [terminalClosed, setTerminalClosed] = useState(false);
  const paneId = getWorkspaceTerminalPaneId(workspace?.id, terminalIndex, agent?.id);

  useEffect(() => {
    setTerminalClosed(false);
    lastAgentLaunchEpochRef.current = 0;
    blankStartupRestartCountRef.current = 0;
  }, [agent?.id, terminalIndex, workspace?.id]);

  useEffect(() => {
    agentLaunchEpochRef.current = agentLaunchEpoch;
    agentLaunchReadyRef.current = agentLaunchReady;

    if (
      agentLaunchReady
      && agentLaunchEpoch > 0
      && lastAgentLaunchEpochRef.current !== agentLaunchEpoch
      && typeof startAgentInPrewarmedTerminalRef.current === "function"
    ) {
      lastAgentLaunchEpochRef.current = agentLaunchEpoch;
      startAgentInPrewarmedTerminalRef.current("agent_launch_epoch", agentLaunchEpoch);
    }
  }, [agentLaunchEpoch, agentLaunchReady]);

  useEffect(() => {
    patchTerminalMetrics({ terminalCount });
  }, [terminalCount]);

  useEffect(() => {
    if (!agent) {
      startAgentInPrewarmedTerminalRef.current = null;
      setTerminalState("blocked");
      setTerminalError("");
      return undefined;
    }

    if (terminalClosed) {
      setTerminalState("closed");
      setTerminalError("");
      return undefined;
    }

    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    let isDisposed = false;
    let webglAttachTimer = 0;
    let webglAttachAt = 0;
    let webglAttachAttempted = false;
    const renderProbeTimers = new Set();
    const resizeDebugProbeTimers = new Set();
    const startupWatchTimers = new Set();
    let rendererMode = useWebglRenderer ? "webgl_pending" : "canvas";
    let runtimeTerminalState = "starting";
    let startAgentInCurrentPty = null;
    let hasOpenPty = false;
    let activeWebglAddon = null;
    let resizeController = null;
    let lastResizeMeasureAt = 0;
    let lastResizeMeasureSize = null;
    let lastXtermRenderLogAt = 0;
    let resizeIdleDebugTimer = 0;
    let resizeWriteBarrierActive = false;
    let resizeWriteBarrierStartedAt = 0;
    let resizeWriteBarrierReason = "";
    let resizeWriteBarrierBytes = 0;
    const resizeWriteBarrierQueue = [];
    let sawFirstOutput = false;
    let outputBytes = 0;
    let outputChunks = 0;
    const disposables = [];
    const startupMetricTimers = new Set();
    const terminalInstanceId = getNextWorkspaceTerminalInstanceId();
    terminalInstanceIdRef.current = terminalInstanceId;
    const lifecycleStartedAt = performance.now();

    writeTerminalTelemetry({
      paneId,
      instanceId: terminalInstanceId,
      phase: "frontend.terminal.mount",
      fields: {
        terminalIndex,
        terminalCount,
        ...getWorkspaceOpenTelemetryFields(workspace?.id),
      },
    });

    const waitForStartupMetricPoll = (delayMs) => new Promise((resolve) => {
      if (isDisposed) {
        resolve();
        return;
      }

      const timer = window.setTimeout(() => {
        startupMetricTimers.delete(timer);
        resolve();
      }, Math.max(0, delayMs));

      startupMetricTimers.add(timer);
    });

    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.22,
      macOptionIsMeta: true,
      scrollback: TERMINAL_DEFAULT_SCROLLBACK_ROWS,
      theme: {
        background: TERMINAL_THEME_BACKGROUND,
        foreground: "#e8eef8",
        cursor: "#ff9a3d",
        cursorAccent: "#030508",
        selectionBackground: "#2f80ff55",
        black: "#030508",
        brightBlack: "#687386",
        blue: "#62a0ff",
        brightBlue: "#8bb9ff",
        cyan: "#6fd7ff",
        brightCyan: "#a7e8ff",
        green: "#7ee787",
        brightGreen: "#9dffad",
        magenta: "#d2a8ff",
        brightMagenta: "#e1c7ff",
        red: "#ff6b6b",
        brightRed: "#ff9a9a",
        white: "#e8eef8",
        brightWhite: "#ffffff",
        yellow: "#ffb269",
        brightYellow: "#ffd08a",
      },
    });

    terminal.open(container);
    writeTerminalTelemetry({
      paneId,
      instanceId: terminalInstanceId,
      phase: "frontend.terminal.open_xterm",
      elapsedMs: performance.now() - lifecycleStartedAt,
    });

    const attachWebglRenderer = (reason = "scheduled") => {
      if (!useWebglRenderer || isDisposed || webglAttachAttempted) {
        return;
      }

      webglAttachAttempted = true;
      const webglStartedAt = performance.now();
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.webgl.attach_start",
        fields: { reason },
      });
      const webglAddon = new WebglAddon();

      try {
        terminal.loadAddon(webglAddon);
        rendererMode = "webgl";
        activeWebglAddon = webglAddon;
        disposables.push(webglAddon);
        disposables.push(webglAddon.onContextLoss(() => {
          rendererMode = "canvas";
          if (activeWebglAddon === webglAddon) {
            activeWebglAddon = null;
          }
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.webgl.context_loss",
          });
          scheduleRenderProbe("webgl_context_loss", 0);
          webglAddon.dispose();
        }));
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.webgl.attach_done",
          elapsedMs: performance.now() - webglStartedAt,
          fields: { reason },
        });
        refreshTerminalRenderer("webgl_attach_done", { reason });
        scheduleRenderProbe("webgl_attach_done", TERMINAL_RENDER_PROBE_AFTER_WEBGL_MS, { reason });
      } catch {
        // WebGL is best-effort; xterm keeps its canvas renderer when WebGL2 is unavailable.
        rendererMode = "canvas";
        webglAddon.dispose();
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.webgl.attach_error",
          elapsedMs: performance.now() - webglStartedAt,
          fields: { reason },
        });
        scheduleRenderProbe("webgl_attach_error", 0, { reason });
      }
    };

    const scheduleWebglAttach = (reason, baseDelayMs) => {
      if (!useWebglRenderer || isDisposed || webglAttachAttempted) {
        return;
      }

      const delayMs = Math.min(
        TERMINAL_WEBGL_MAX_DELAY_MS,
        Math.max(0, baseDelayMs + terminalIndex * TERMINAL_WEBGL_STAGGER_MS),
      );
      const attachAt = performance.now() + delayMs;

      if (webglAttachTimer && webglAttachAt <= attachAt) {
        return;
      }

      if (webglAttachTimer) {
        window.clearTimeout(webglAttachTimer);
      }

      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.webgl.attach_schedule",
        fields: {
          reason,
          delayMs,
          terminalIndex,
          rendererMode,
        },
      });
      webglAttachAt = attachAt;
      webglAttachTimer = window.setTimeout(() => {
        webglAttachTimer = 0;
        webglAttachAt = 0;
        attachWebglRenderer(reason);
      }, delayMs);
    };

    scheduleWebglAttach("xterm_open", 0);

    const logRenderProbe = (reason, extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      let renderDiagnostics = {};

      try {
        renderDiagnostics = getTerminalRenderDiagnostics(container, terminal, rendererMode);
      } catch (error) {
        renderDiagnostics = {
          renderProbeError: getErrorMessage(error, "Unable to inspect terminal render state."),
        };
      }

      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.render.probe",
        cols: terminal.cols,
        rows: terminal.rows,
        fields: {
          reason,
          terminalIndex,
          terminalState: runtimeTerminalState,
          uptimeMs: performance.now() - lifecycleStartedAt,
          ...extraFields,
          ...renderDiagnostics,
        },
      });
    };

    const scheduleRenderProbe = (reason, delayMs = 0, extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      const timer = window.setTimeout(() => {
        renderProbeTimers.delete(timer);
        logRenderProbe(reason, extraFields);
      }, Math.max(0, delayMs));

      renderProbeTimers.add(timer);
    };

    const scheduleResizeDebugProbes = (reason, extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      TERMINAL_RESIZE_DEBUG_PROBE_DELAYS_MS.forEach((delayMs) => {
        const timer = window.setTimeout(() => {
          resizeDebugProbeTimers.delete(timer);

          if (isDisposed) {
            return;
          }

          logRenderProbe(reason, {
            delayMs,
            lastResizeMeasureSize,
            sinceLastResizeMeasureMs: lastResizeMeasureAt ? performance.now() - lastResizeMeasureAt : null,
            ...extraFields,
          });
        }, delayMs);

        resizeDebugProbeTimers.add(timer);
      });
    };

    const scheduleResizeIdleDebugProbes = (extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      if (resizeIdleDebugTimer) {
        window.clearTimeout(resizeIdleDebugTimer);
      }

      resizeIdleDebugTimer = window.setTimeout(() => {
        resizeIdleDebugTimer = 0;

        if (isDisposed) {
          return;
        }

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.idle",
          cols: terminal.cols,
          rows: terminal.rows,
          fields: {
            lastResizeMeasureSize,
            rendererMode,
            sinceLastResizeMeasureMs: lastResizeMeasureAt ? performance.now() - lastResizeMeasureAt : null,
            terminalIndex,
            ...extraFields,
          },
        });
        scheduleResizeDebugProbes("resize_idle_probe", extraFields);
      }, TERMINAL_RESIZE_DEBUG_IDLE_MS);
    };

    const refreshTerminalRenderer = (reason, extraFields = {}) => {
      if (isDisposed || typeof terminal.refresh !== "function") {
        return false;
      }

      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.render.refresh",
          cols: terminal.cols,
          rows: terminal.rows,
          fields: {
            reason,
            rendererMode,
            terminalIndex,
            ...extraFields,
          },
        });
        return true;
      } catch (error) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.render.refresh_error",
          fields: {
            reason,
            rendererMode,
            terminalIndex,
            error: getErrorMessage(error, "Unable to refresh terminal renderer."),
          },
        });
      }

      return false;
    };

    const scheduleBlankStartupWatch = (reason, delayMs = TERMINAL_BLANK_STARTUP_PROBE_MS, previousProbe = null) => {
      if (isDisposed) {
        return;
      }

      const timer = window.setTimeout(() => {
        startupWatchTimers.delete(timer);

        if (isDisposed || runtimeTerminalState !== "running") {
          return;
        }

        const bufferDiagnostics = getTerminalBufferDiagnostics(terminal);
        const hasVisibleRows = (bufferDiagnostics?.nonEmptyViewportRows || 0) > 0;
        const cursorMoved = (bufferDiagnostics?.cursorX || 0) > 0 || (bufferDiagnostics?.cursorY || 0) > 0;

        if (hasVisibleRows || cursorMoved || outputBytes > 8) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.visible_buffer_ready",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: {
              reason,
              rendererMode,
              terminalIndex,
              outputBytes,
              outputChunks,
              retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
              retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
              buffer: bufferDiagnostics,
            },
          });
          return;
        }

        const restartAttempt = blankStartupRestartCountRef.current + 1;
        const probeFields = {
          reason,
          rendererMode,
          terminalIndex,
          outputBytes,
          outputChunks,
          restartAttempt,
          retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
          retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
          buffer: bufferDiagnostics,
        };

        if (!previousProbe) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.blank_probe",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: probeFields,
          });
          refreshTerminalRenderer("blank_startup_probe", {
            outputBytes,
            outputChunks,
          });
          scheduleRenderProbe("blank_startup_probe_after_refresh", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
            outputBytes,
            outputChunks,
          });
          scheduleBlankStartupWatch("blank_startup_confirm", TERMINAL_BLANK_STARTUP_CONFIRM_MS, {
            outputBytes,
            outputChunks,
          });
          return;
        }

        const outputChanged = outputBytes !== previousProbe.outputBytes
          || outputChunks !== previousProbe.outputChunks;
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.start.blank_visible_buffer",
          cols: terminal.cols,
          rows: terminal.rows,
          fields: {
            ...probeFields,
            previousOutputBytes: previousProbe.outputBytes,
            previousOutputChunks: previousProbe.outputChunks,
            outputChanged,
          },
        });

        refreshTerminalRenderer("blank_startup_watch", {
          outputBytes,
          outputChunks,
        });
        scheduleRenderProbe("blank_startup_after_refresh", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
          outputBytes,
          outputChunks,
        });

        if (blankStartupRestartCountRef.current >= TERMINAL_BLANK_STARTUP_RESTART_LIMIT) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.blank_restart_limit",
            fields: {
              outputBytes,
              outputChunks,
              restartLimit: TERMINAL_BLANK_STARTUP_RESTART_LIMIT,
              retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
              retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
            },
          });
          hasOpenPty = false;
          runtimeTerminalState = "error";
          setTerminalState("error");
          setTerminalError(`${agent.label} started but did not produce visible terminal output.`);
          invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
          return;
        }

        blankStartupRestartCountRef.current += 1;
        const restartDelayMs = TERMINAL_BLANK_STARTUP_RESTART_DELAY_MS;
        hasOpenPty = false;
        runtimeTerminalState = "restarting";
        setTerminalState("starting");
        invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.start.blank_restart_scheduled",
          fields: {
            outputBytes,
            outputChunks,
            restartAttempt,
            restartDelayMs,
            retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
            retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
          },
        });
        window.setTimeout(() => {
          if (!isDisposed) {
            setRestartKey((key) => key + 1);
          }
        }, restartDelayMs);
      }, delayMs);

      startupWatchTimers.add(timer);
    };

    scheduleRenderProbe("xterm_open", 0);
    disposables.push(terminal.onResize(({ cols, rows }) => {
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.xterm.resize",
        cols,
        rows,
        fields: {
          lastResizeMeasureSize,
          rendererMode,
          sinceLastResizeMeasureMs: lastResizeMeasureAt ? performance.now() - lastResizeMeasureAt : null,
          terminalIndex,
        },
      });
    }));
    disposables.push(terminal.onRender(({ start, end }) => {
      const now = performance.now();

      if (
        !lastResizeMeasureAt
        || now - lastResizeMeasureAt > TERMINAL_RESIZE_DEBUG_RECENT_MS
        || now - lastXtermRenderLogAt < TERMINAL_XTERM_RENDER_LOG_MIN_MS
      ) {
        return;
      }

      lastXtermRenderLogAt = now;
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.xterm.render",
        cols: terminal.cols,
        rows: terminal.rows,
        fields: {
          end,
          lastResizeMeasureSize,
          rendererMode,
          sinceLastResizeMeasureMs: now - lastResizeMeasureAt,
          start,
          terminalIndex,
        },
      });
    }));

    if (terminalIndex === 0) {
      terminal.focus();
    }

    runtimeTerminalState = "starting";
    setTerminalState("starting");
    setTerminalError("");

    const measureTerminalSizeForOpen = (reason, options = {}) => {
      const shouldLogTelemetry = options.logTelemetry !== false;
      const measuredAt = performance.now();
      const measurement = measureTerminalGrid({
        container,
        term: terminal,
        defaultCols: TERMINAL_DEFAULT_COLS,
        defaultRows: TERMINAL_DEFAULT_ROWS,
        minCols: TERMINAL_MIN_COLS,
        minRows: TERMINAL_MIN_ROWS,
        maxCols: TERMINAL_MAX_COLS,
        maxRows: TERMINAL_MAX_ROWS,
      });
      const cols = measurement.ok ? measurement.cols : 0;
      const rows = measurement.ok ? measurement.rows : 0;
      const gridMs = performance.now() - measuredAt;

      lastResizeMeasureAt = performance.now();
      lastResizeMeasureSize = {
        cols,
        rows,
        skipped: !measurement.ok,
      };
      patchTerminalMetrics({ gridMs });

      if (shouldLogTelemetry) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.measure",
          cols,
          rows,
          elapsedMs: gridMs,
          fields: {
            actualCellHeight: measurement.actualCellHeight ?? null,
            actualCellWidth: measurement.actualCellWidth ?? null,
            containerHeight: Math.round(measurement.containerHeight || 0),
            containerWidth: Math.round(measurement.containerWidth || 0),
            measurementOk: measurement.ok,
            metricSource: measurement.metricSource ?? null,
            rawCols: measurement.rawCols ?? null,
            rawRows: measurement.rawRows ?? null,
            reason,
            skipped: measurement.ok ? "" : measurement.reason,
            terminalIndex,
          },
        });
      }

      return {
        ...measurement,
        cols,
        elapsedMs: gridMs,
        rows,
        skipped: !measurement.ok,
      };
    };

    const waitForTerminalSizeForOpen = async (reason) => {
      const waitStartedAt = performance.now();
      let attempts = 1;
      let measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`, { logTelemetry: true });

      while (
        !isDisposed
        && !measurement.ok
        && performance.now() - waitStartedAt < TERMINAL_START_METRIC_WAIT_MS
      ) {
        await waitForStartupMetricPoll(TERMINAL_START_METRIC_POLL_MS);

        if (isDisposed) {
          return null;
        }

        attempts += 1;
        measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`, { logTelemetry: false });
      }

      const waitMs = performance.now() - waitStartedAt;

      if (measurement.ok) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.metrics_ready",
          cols: measurement.cols,
          rows: measurement.rows,
          elapsedMs: waitMs,
          fields: {
            actualCellHeight: measurement.actualCellHeight,
            actualCellWidth: measurement.actualCellWidth,
            attempts,
            containerHeight: Math.round(measurement.containerHeight),
            containerWidth: Math.round(measurement.containerWidth),
            metricSource: measurement.metricSource,
            rawCols: measurement.rawCols,
            rawRows: measurement.rawRows,
            reason,
            terminalIndex,
          },
        });
        return measurement;
      }

      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.open.metrics_timeout",
        cols: 0,
        rows: 0,
        elapsedMs: waitMs,
        fields: {
          attempts,
          lastActualCellHeight: measurement.actualCellHeight ?? null,
          lastActualCellWidth: measurement.actualCellWidth ?? null,
          lastReason: measurement.reason,
          metricSource: measurement.metricSource ?? null,
          reason,
          terminalIndex,
          timeoutMs: TERMINAL_START_METRIC_WAIT_MS,
        },
      });

      throw new Error("Terminal render metrics were not ready before PTY startup.");
    };

    const writeTerminalOutput = (data, options = {}) => {
      if (isDisposed || !data?.byteLength) {
        return;
      }

      const isFirstOutputChunk = options.isFirstOutputChunk === true;

      if (resizeWriteBarrierActive && !options.fromResizeBarrier) {
        const queuedData = typeof data.slice === "function" ? data.slice() : new Uint8Array(data);
        const wasEmpty = resizeWriteBarrierQueue.length === 0;

        resizeWriteBarrierQueue.push({
          data: queuedData,
          isFirstOutputChunk,
        });
        resizeWriteBarrierBytes += queuedData.byteLength;

        if (wasEmpty) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.output.resize_barrier_queue_start",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: {
              bytes: queuedData.byteLength,
              reason: resizeWriteBarrierReason,
              terminalIndex,
            },
          });
        }

        return;
      }

      terminal.write(data, () => {
        if (isDisposed) {
          return;
        }

        if (isFirstOutputChunk) {
          refreshTerminalRenderer("first_output_written", {
            bytes: data.byteLength,
            transport: "binary_channel",
          });
          scheduleRenderProbe(
            "first_output_written",
            TERMINAL_RENDER_PROBE_AFTER_WRITE_MS,
            {
              bytes: data.byteLength,
              transport: "binary_channel",
            },
          );
        }
      });
    };

    const openResizeWriteBarrier = (event) => {
      if (resizeWriteBarrierActive) {
        return;
      }

      resizeWriteBarrierActive = true;
      resizeWriteBarrierStartedAt = performance.now();
      resizeWriteBarrierReason = event?.reason || "resize";
      resizeWriteBarrierBytes = 0;
      resizeWriteBarrierQueue.length = 0;
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.output.resize_barrier_start",
        cols: event?.cols,
        rows: event?.rows,
        fields: {
          reason: resizeWriteBarrierReason,
          terminalIndex,
        },
      });
    };

    const closeResizeWriteBarrier = (reason) => {
      const queuedWrites = resizeWriteBarrierQueue.splice(0);
      const queuedBytes = resizeWriteBarrierBytes;
      const barrierMs = resizeWriteBarrierStartedAt
        ? performance.now() - resizeWriteBarrierStartedAt
        : 0;

      resizeWriteBarrierActive = false;
      resizeWriteBarrierStartedAt = 0;
      resizeWriteBarrierReason = "";
      resizeWriteBarrierBytes = 0;

      if (queuedWrites.length) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.output.resize_barrier_flush",
          cols: terminal.cols,
          rows: terminal.rows,
          elapsedMs: barrierMs,
          fields: {
            bytes: queuedBytes,
            chunks: queuedWrites.length,
            reason,
            terminalIndex,
          },
        });
      }

      queuedWrites.forEach((queuedWrite) => {
        writeTerminalOutput(queuedWrite.data, {
          fromResizeBarrier: true,
          isFirstOutputChunk: queuedWrite.isFirstOutputChunk,
        });
      });

      return {
        barrierMs,
        queuedBytes,
        queuedChunks: queuedWrites.length,
      };
    };

    resizeController = createTerminalResizeController({
      canResize: () => hasOpenPty && !isDisposed,
      container,
      defaultCols: TERMINAL_DEFAULT_COLS,
      defaultRows: TERMINAL_DEFAULT_ROWS,
      getWebglAddon: () => activeWebglAddon,
      instanceId: () => terminalInstanceId,
      maxCols: TERMINAL_MAX_COLS,
      maxRows: TERMINAL_MAX_ROWS,
      minCols: TERMINAL_MIN_COLS,
      minRows: TERMINAL_MIN_ROWS,
      onDone: (event) => {
        if (isDisposed) {
          return;
        }

        const resizeBarrier = closeResizeWriteBarrier(event.reason || "resize_applied");
        lastResizeMeasureAt = performance.now();
        lastResizeMeasureSize = {
          cols: event.cols,
          rows: event.rows,
          skipped: false,
        };
        patchTerminalMetrics({
          gridMs: event.elapsedMs,
          resizeLagMs: event.elapsedMs,
        });
        addTerminalMetrics({
          resizeBatches: 1,
          resizePanes: 1,
        });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.applied",
          cols: event.cols,
          rows: event.rows,
          elapsedMs: event.elapsedMs,
          fields: {
            actualCellHeight: event.actualCellHeight,
            actualCellWidth: event.actualCellWidth,
            clearedTextureAtlas: event.clearedTextureAtlas,
            containerHeight: Math.round(event.containerHeight),
            containerWidth: Math.round(event.containerWidth),
            metricSource: event.metricSource,
            rawCols: event.rawCols,
            rawRows: event.rawRows,
            reason: event.reason,
            rendererMode,
            resizeBarrierBytes: resizeBarrier.queuedBytes,
            resizeBarrierChunks: resizeBarrier.queuedChunks,
            resizeBarrierMs: resizeBarrier.barrierMs,
            terminalIndex,
          },
        });
        scheduleResizeIdleDebugProbes({
          requestedCols: event.cols,
          requestedRows: event.rows,
          resizeReason: event.reason,
        });
        scheduleRenderProbe("resize_applied", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
          requestedCols: event.cols,
          requestedRows: event.rows,
          resizeReason: event.reason,
        });
      },
      onError: (event) => {
        const resizeBarrier = closeResizeWriteBarrier(event.reason || "resize_error");

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.error",
          cols: event.cols,
          rows: event.rows,
          elapsedMs: event.elapsedMs,
          fields: {
            error: getErrorMessage(event.error, "Unable to resize terminal."),
            reason: event.reason,
            resizeBarrierBytes: resizeBarrier.queuedBytes,
            resizeBarrierChunks: resizeBarrier.queuedChunks,
            resizeBarrierMs: resizeBarrier.barrierMs,
            terminalIndex,
          },
        });
      },
      onSkip: (event) => {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.skip",
          cols: event.cols,
          rows: event.rows,
          fields: {
            actualCellHeight: event.actualCellHeight ?? null,
            actualCellWidth: event.actualCellWidth ?? null,
            containerHeight: Math.round(event.containerHeight || 0),
            containerWidth: Math.round(event.containerWidth || 0),
            metricSource: event.metricSource ?? null,
            reason: event.reason,
            skipped: event.skipped,
            terminalIndex,
          },
        });
      },
      onStart: (event) => {
        openResizeWriteBarrier(event);
        lastResizeMeasureAt = performance.now();
        lastResizeMeasureSize = {
          cols: event.cols,
          rows: event.rows,
          skipped: false,
        };
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.native_start",
          cols: event.cols,
          rows: event.rows,
          fields: {
            actualCellHeight: event.actualCellHeight,
            actualCellWidth: event.actualCellWidth,
            containerHeight: Math.round(event.containerHeight),
            containerWidth: Math.round(event.containerWidth),
            metricSource: event.metricSource,
            rawCols: event.rawCols,
            rawRows: event.rawRows,
            reason: event.reason,
            terminalIndex,
          },
        });
      },
      paneId: () => paneId,
      term: terminal,
    });
    resizeController?.schedule("mount");

    async function startTerminal() {
      try {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.start.begin",
          elapsedMs: performance.now() - lifecycleStartedAt,
          fields: getWorkspaceOpenTelemetryFields(workspace?.id),
        });
        const outputChannel = new Channel((message) => {
          if (isDisposed) {
            return;
          }

          const data = message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : ArrayBuffer.isView(message)
              ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
              : null;

          if (!data?.byteLength) {
            return;
          }

          addTerminalMetrics({
            ipcEvents: 1,
            ipcBytes: data.byteLength,
          });
          patchTerminalMetrics({ outputLagMs: 0 });

          const isFirstOutputChunk = !sawFirstOutput;
          outputChunks += 1;
          outputBytes += data.byteLength;

          if (isFirstOutputChunk) {
            sawFirstOutput = true;
            writeTerminalTelemetry({
              paneId,
              instanceId: terminalInstanceId,
              phase: "frontend.output.first_chunk",
              elapsedMs: performance.now() - lifecycleStartedAt,
              fields: {
                bytes: data.byteLength,
                transport: "binary_channel",
              },
            });
            scheduleWebglAttach("first_output", TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS);
          }

          writeTerminalOutput(data, {
            isFirstOutputChunk,
          });
        });
        disposables.push(await listen("forge-terminal-exit", (event) => {
          if (
            event.payload?.paneId === paneId
            && event.payload?.instanceId === terminalInstanceId
            && !isDisposed
          ) {
            writeTerminalTelemetry({
              paneId,
              instanceId: terminalInstanceId,
              phase: "frontend.exit",
              elapsedMs: performance.now() - lifecycleStartedAt,
              fields: { exitCode: event.payload.exitCode ?? null },
            });
            hasOpenPty = false;
            runtimeTerminalState = "exited";
            setTerminalState("exited");
          }
        }));
        disposables.push(terminal.onData((data) => {
          if (!hasOpenPty || isDisposed) {
            return;
          }

          const safeData = data.replace(/\x03/g, "");

          if (!safeData) {
            return;
          }

          invoke("terminal_write", {
            paneId,
            instanceId: terminalInstanceId,
            data: safeData,
          }).catch((error) => {
            if (isTerminalSessionMissingError(error)) {
              writeTerminalTelemetry({
                paneId,
                instanceId: terminalInstanceId,
                phase: "frontend.write.skip_missing_session",
              });
              return;
            }

            if (!isDisposed) {
              setTerminalError(getErrorMessage(error, "Unable to write to terminal."));
            }
          });
        }));

        const initialSize = await waitForTerminalSizeForOpen("terminal_open");

        if (isDisposed || !initialSize) {
          return;
        }

        if (terminal.cols !== initialSize.cols || terminal.rows !== initialSize.rows) {
          terminal.resize(initialSize.cols, initialSize.rows);
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.open.xterm_initial_resize",
            cols: initialSize.cols,
            rows: initialSize.rows,
            elapsedMs: performance.now() - lifecycleStartedAt,
            fields: {
              metricSource: initialSize.metricSource,
              terminalIndex,
            },
          });
        }

        const shouldPrewarmShell = prewarmShell && !agentLaunchReadyRef.current;
        const openKind = shouldPrewarmShell ? "prewarm-pty" : agent.id;
        const openProvider = shouldPrewarmShell ? null : agent.id;
        let agentStartedInCurrentPty = !shouldPrewarmShell;

        startAgentInCurrentPty = async (reason = "agent_launch_ready", launchEpoch = agentLaunchEpochRef.current) => {
          if (isDisposed || !hasOpenPty || agentStartedInCurrentPty) {
            return;
          }

          agentStartedInCurrentPty = true;
          startupWatchTimers.forEach((timer) => window.clearTimeout(timer));
          startupWatchTimers.clear();
          runtimeTerminalState = "starting";
          setTerminalState("starting");
          setTerminalError("");

          const agentLaunchStartedAt = performance.now();
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.agent_launch.batch_attach_start",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: {
              agentId: agent.id,
              launchEpoch,
              reason,
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });

          runtimeTerminalState = "running";
          setTerminalState("running");
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.agent_launch.batch_attach_done",
            cols: terminal.cols,
            rows: terminal.rows,
            elapsedMs: performance.now() - agentLaunchStartedAt,
            fields: {
              agentId: agent.id,
              launchEpoch,
              reason,
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });
          resizeController?.resizeNow("agent_launch_done");
          scheduleRenderProbe("agent_launch_done", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
            initialCols: initialSize.cols,
            initialRows: initialSize.rows,
            reason,
          });
          scheduleBlankStartupWatch("agent_launch_done");
        };
        startAgentInPrewarmedTerminalRef.current = shouldPrewarmShell ? startAgentInCurrentPty : null;

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.invoke_start",
          cols: initialSize.cols,
          rows: initialSize.rows,
          elapsedMs: performance.now() - lifecycleStartedAt,
          fields: {
            kind: openKind,
            prewarmShell: shouldPrewarmShell,
            ...getWorkspaceOpenTelemetryFields(workspace?.id),
          },
        });

        const openStartedAt = performance.now();
        if (isDisposed) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.open.skip_disposed",
            elapsedMs: performance.now() - openStartedAt,
            fields: {
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });
          return;
        }

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.dispatch",
          elapsedMs: performance.now() - openStartedAt,
          fields: {
            terminalIndex,
            transport: "binary_channel",
            ...getWorkspaceOpenTelemetryFields(workspace?.id),
          },
        });
        await invoke("terminal_open", {
          request: {
            paneId,
            instanceId: terminalInstanceId,
            kind: openKind,
            provider: openProvider,
            model: "",
            workingDirectory: workingDirectory || "",
            cols: initialSize.cols,
            rows: initialSize.rows,
          },
          outputChannel,
        });

        if (isDisposed) {
          invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
          return;
        }

        hasOpenPty = true;
        runtimeTerminalState = shouldPrewarmShell ? "prewarmed" : "running";
        setTerminalState(shouldPrewarmShell ? "starting" : "running");
        patchTerminalMetrics({ startupMs: performance.now() - openStartedAt });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.invoke_done",
          cols: initialSize.cols,
          rows: initialSize.rows,
          elapsedMs: performance.now() - openStartedAt,
          fields: {
            kind: openKind,
            prewarmShell: shouldPrewarmShell,
          },
        });
        resizeController?.resizeNow("terminal_open_done");
        scheduleRenderProbe("terminal_open_done", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
          initialCols: initialSize.cols,
          initialRows: initialSize.rows,
          prewarmShell: shouldPrewarmShell,
        });

        scheduleWebglAttach("idle", TERMINAL_WEBGL_IDLE_DELAY_MS);

        if (terminalIndex === 0) {
          terminal.focus();
        }

        if (shouldPrewarmShell) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.prewarm.ready",
            elapsedMs: performance.now() - openStartedAt,
            fields: {
              agentId: agent.id,
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });
          onPreparedTerminalChange?.({
            agentId: agent.id,
            instanceId: terminalInstanceId,
            paneId,
            ready: true,
            terminalIndex,
            workspaceId: workspace?.id || "",
          });

          if (agentLaunchReadyRef.current && agentLaunchEpochRef.current > 0) {
            lastAgentLaunchEpochRef.current = agentLaunchEpochRef.current;
            startAgentInCurrentPty("prewarm_ready_after_gate", agentLaunchEpochRef.current);
          }

          return;
        }

        scheduleBlankStartupWatch("terminal_open_done");
      } catch (error) {
        if (!isDisposed) {
          runtimeTerminalState = "error";
          setTerminalState("error");
          setTerminalError(getErrorMessage(error, `Unable to launch ${agent.label}.`));
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.error",
            elapsedMs: performance.now() - lifecycleStartedAt,
            fields: { error: getErrorMessage(error, "Unable to launch terminal.") },
          });
        }
      }
    }

    startTerminal();

    return () => {
      isDisposed = true;
      resizeController?.dispose();
      activeWebglAddon = null;
      if (webglAttachTimer) {
        window.clearTimeout(webglAttachTimer);
      }
      if (resizeIdleDebugTimer) {
        window.clearTimeout(resizeIdleDebugTimer);
      }
      startupMetricTimers.forEach((timer) => window.clearTimeout(timer));
      startupMetricTimers.clear();
      renderProbeTimers.forEach((timer) => window.clearTimeout(timer));
      renderProbeTimers.clear();
      resizeDebugProbeTimers.forEach((timer) => window.clearTimeout(timer));
      resizeDebugProbeTimers.clear();
      startupWatchTimers.forEach((timer) => window.clearTimeout(timer));
      startupWatchTimers.clear();
      resizeWriteBarrierActive = false;
      resizeWriteBarrierQueue.length = 0;
      resizeWriteBarrierBytes = 0;
      disposables.forEach((dispose) => {
        if (typeof dispose === "function") {
          dispose();
        } else {
          dispose?.dispose?.();
        }
      });
      hasOpenPty = false;
      if (startAgentInPrewarmedTerminalRef.current === startAgentInCurrentPty) {
        startAgentInPrewarmedTerminalRef.current = null;
      }
      onPreparedTerminalChange?.({
        agentId: agent?.id || "",
        instanceId: terminalInstanceId,
        paneId,
        ready: false,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.terminal.cleanup",
        elapsedMs: performance.now() - lifecycleStartedAt,
        fields: getWorkspaceOpenTelemetryFields(workspace?.id),
      });
      invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
      terminal.dispose();
    };
  }, [agent?.id, agent?.label, onPreparedTerminalChange, paneId, restartKey, terminalClosed, useWebglRenderer, workingDirectory, workspace?.id]);

  const closeTerminal = useCallback(async () => {
    setTerminalError("");

    try {
      await invoke("terminal_close", {
        paneId,
        instanceId: terminalInstanceIdRef.current || undefined,
      });
    } catch (error) {
      setTerminalError(getErrorMessage(error, "Unable to close terminal."));
      return;
    }

    setTerminalClosed(true);
    setTerminalState("closed");
    onCloseTerminal?.({
      paneId,
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
  }, [onCloseTerminal, paneId, terminalIndex, workspace?.id]);

  if (!agent) {
    return (
      <TerminalWorkspaceSurface>
        <TerminalEmptyPanel>
          <TerminalEmptyCopy>
            <PanelKicker>Terminal readiness</PanelKicker>
            <PanelHeading>Install and connect Codex or Claude Code</PanelHeading>
            <PageSubline>
              The workspace opens a live local PTY only after a provider CLI is installed and authenticated.
            </PageSubline>
          </TerminalEmptyCopy>
          <TerminalAgentList>
            {getAgentStatusSummary(agentStatuses).map((status) => (
              <TerminalAgentRow data-tone={getAgentTone(status)} key={status.id}>
                <AgentIcon data-tone={getAgentTone(status)}>
                  {status.id === "codex" ? <ButtonCodeIcon aria-hidden="true" /> : <ButtonBotIcon aria-hidden="true" />}
                </AgentIcon>
                <div>
                  <strong>{status.label}</strong>
                  <span>{status.authMessage}</span>
                </div>
              </TerminalAgentRow>
            ))}
          </TerminalAgentList>
          {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
          {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}
          <TerminalEmptyActions>
            <SecondaryButton disabled={agentStatusState === "checking"} onClick={onRecheckAgents} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>{agentStatusState === "checking" ? "Checking..." : "Recheck"}</span>
            </SecondaryButton>
            <PrimaryButton onClick={onOpenSettings} type="button">
              <ButtonSettingsIcon aria-hidden="true" />
              <span>Settings</span>
            </PrimaryButton>
          </TerminalEmptyActions>
        </TerminalEmptyPanel>
      </TerminalWorkspaceSurface>
    );
  }

  return (
    <TerminalWorkspaceSurface>
      <TerminalRestartPill>
        <TerminalRestartButton
          aria-label="Restart terminal"
          onClick={() => {
            setTerminalClosed(false);
            setTerminalState("starting");
            setTerminalError("");
            setRestartKey((key) => key + 1);
          }}
          title="Restart terminal"
          type="button"
        >
          <ButtonRefreshIcon aria-hidden="true" />
        </TerminalRestartButton>
        <TerminalCloseButton
          aria-label="Close terminal"
          disabled={terminalClosed}
          onClick={closeTerminal}
          title="Close terminal"
          type="button"
        >
          <ButtonCloseIcon aria-hidden="true" />
        </TerminalCloseButton>
      </TerminalRestartPill>

      {(terminalError || agentStatusError || workspaceError) && (
        <BlankStatusStack>
          {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
          {terminalError && <FormMessage $state="error">{terminalError}</FormMessage>}
          {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}
        </BlankStatusStack>
      )}

      <TerminalFrame data-state={terminalState}>
        {terminalClosed ? (
          <TerminalClosedSurface aria-live="polite" role="status">
            <TerminalClosedLabel>Terminal Closed</TerminalClosedLabel>
          </TerminalClosedSurface>
        ) : (
          <XtermSurface ref={containerRef} />
        )}
      </TerminalFrame>
    </TerminalWorkspaceSurface>
  );
}

function FileTreeNode({
  directoryEntries,
  directoryErrors,
  directoryStates,
  entry,
  expandedDirectories,
  onOpenFile,
  onToggleDirectory,
  selectedFilePath,
  depth = 0,
}) {
  const isDirectory = entry.kind === "directory";
  const directoryPath = entry.relativePath || "";
  const isExpanded = Boolean(expandedDirectories[directoryPath]);
  const childEntries = directoryEntries[directoryPath] || [];
  const directoryState = directoryStates[directoryPath] || "idle";
  const directoryError = directoryErrors[directoryPath] || "";
  const gitStatus = normalizeGitStatus(entry.gitStatus);
  const gitStatusName = getGitStatusName(gitStatus);
  const fileIconMeta = isDirectory
    ? {
      codicon: isExpanded ? "codicon-folder-opened" : "codicon-folder",
      tone: "folder",
    }
    : getFileIconMeta(entry.relativePath || entry.name);
  const fileTypeLabel = isDirectory ? "Folder" : getFileLanguage(entry.relativePath || entry.name);

  return (
    <FileTreeItem>
      <FileTreeButton
        $depth={depth}
        data-git-status={gitStatus || undefined}
        data-selected={!isDirectory && selectedFilePath === entry.relativePath}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(entry);
            return;
          }

          onOpenFile(entry);
        }}
        title={entry.relativePath || entry.name}
        type="button"
      >
        <FileDisclosure aria-hidden="true">
          {isDirectory ? (
            <span className={`codicon ${isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"}`} />
          ) : null}
        </FileDisclosure>
        <FileKindIcon
          aria-hidden="true"
          data-file-tone={fileIconMeta.tone}
          data-git-status={gitStatus || undefined}
          data-kind={entry.kind}
          title={fileTypeLabel}
        >
          <span className={`codicon ${fileIconMeta.codicon}`} />
        </FileKindIcon>
        <FileTreeName data-git-status={gitStatus || undefined}>{entry.name}</FileTreeName>
        <FileGitStatusMark
          aria-hidden={!gitStatus}
          data-git-status={gitStatus || undefined}
          title={gitStatusName ? `${gitStatusName} in git` : undefined}
        >
          {getGitStatusLabel(gitStatus)}
        </FileGitStatusMark>
      </FileTreeButton>

      {isDirectory && isExpanded && (
        <FileTreeChildren>
          {directoryState === "loading" && (
            <FileTreeMessage $depth={depth + 1}>Loading...</FileTreeMessage>
          )}
          {directoryState === "error" && (
            <FileTreeMessage $depth={depth + 1} data-tone="error">
              {directoryError || "Unable to open folder."}
            </FileTreeMessage>
          )}
          {directoryState !== "loading" && directoryState !== "error" && childEntries.length === 0 && (
            <FileTreeMessage $depth={depth + 1}>Empty</FileTreeMessage>
          )}
          {childEntries.map((childEntry) => (
            <FileTreeNode
              depth={depth + 1}
              directoryEntries={directoryEntries}
              directoryErrors={directoryErrors}
              directoryStates={directoryStates}
              entry={childEntry}
              expandedDirectories={expandedDirectories}
              key={`${childEntry.kind}-${childEntry.relativePath}`}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
              selectedFilePath={selectedFilePath}
            />
          ))}
        </FileTreeChildren>
      )}
    </FileTreeItem>
  );
}

function FilesWorkspaceView({
  defaultWorkingDirectory,
  onOpenWorkspaceSettings,
  rootDirectory,
  workspace,
  workspaceError,
}) {
  const fileRequestIdRef = useRef(0);
  const [directoryEntries, setDirectoryEntries] = useState({});
  const [directoryStates, setDirectoryStates] = useState({});
  const [directoryErrors, setDirectoryErrors] = useState({});
  const [expandedDirectories, setExpandedDirectories] = useState({ "": true });
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState("");
  const [fileState, setFileState] = useState("idle");
  const [fileError, setFileError] = useState("");
  const [fileDiff, setFileDiff] = useState("");
  const [fileDiffState, setFileDiffState] = useState("idle");
  const [fileDiffError, setFileDiffError] = useState("");
  const [fileDiffTruncated, setFileDiffTruncated] = useState(false);
  const workspaceRoot = cleanWorkspaceRootDirectory(rootDirectory || defaultWorkingDirectory);
  const fileExplorerLayout = useMemo(
    () => getFileExplorerLayout(workspace?.id || workspaceRoot),
    [workspace?.id, workspaceRoot],
  );
  const rootEntry = useMemo(() => ({
    kind: "directory",
    name: getDirectoryName(workspaceRoot),
    relativePath: "",
  }), [workspaceRoot]);

  const queueExplorerLayout = useCallback((sizes) => {
    queueFileExplorerLayout({
      workspaceId: workspace?.id || workspaceRoot,
      sizes,
    });
  }, [workspace?.id, workspaceRoot]);

  const loadDirectory = useCallback(async (relativePath = "") => {
    const directoryPath = relativePath || "";

    if (!workspaceRoot) {
      setDirectoryStates((states) => ({ ...states, [directoryPath]: "error" }));
      setDirectoryErrors((errors) => ({
        ...errors,
        [directoryPath]: "No workspace directory selected.",
      }));
      return;
    }

    setDirectoryStates((states) => ({ ...states, [directoryPath]: "loading" }));
    setDirectoryErrors((errors) => ({ ...errors, [directoryPath]: "" }));

    try {
      const listing = await invoke("list_workspace_directory", {
        root: workspaceRoot,
        relativePath: directoryPath,
      });
      const entries = Array.isArray(listing?.entries) ? listing.entries : [];

      setDirectoryEntries((directories) => ({
        ...directories,
        [directoryPath]: entries,
      }));
      setDirectoryStates((states) => ({ ...states, [directoryPath]: "idle" }));
    } catch (error) {
      setDirectoryStates((states) => ({ ...states, [directoryPath]: "error" }));
      setDirectoryErrors((errors) => ({
        ...errors,
        [directoryPath]: getErrorMessage(error, "Unable to open folder."),
      }));
    }
  }, [workspaceRoot]);

  const openFile = useCallback(async (entry) => {
    if (!workspaceRoot || !entry?.relativePath) {
      return;
    }

    const requestId = fileRequestIdRef.current + 1;
    fileRequestIdRef.current = requestId;
    setSelectedFile(entry);
    setFileContent("");
    setFileState("loading");
    setFileError("");
    setFileDiff("");
    setFileDiffState("idle");
    setFileDiffError("");
    setFileDiffTruncated(false);

    try {
      const result = await invoke("read_workspace_file", {
        root: workspaceRoot,
        relativePath: entry.relativePath,
      });

      if (fileRequestIdRef.current !== requestId) {
        return;
      }

      const nextGitStatus = normalizeGitStatus(result?.gitStatus || entry.gitStatus || "");

      setSelectedFile({
        ...entry,
        gitStatus: nextGitStatus,
        size: result?.size ?? entry.size,
        modifiedMs: result?.modifiedMs ?? entry.modifiedMs,
      });
      setFileContent(result?.content || "");
      setFileState("ready");

      if (nextGitStatus !== "modified") {
        return;
      }

      setFileDiffState("loading");

      try {
        const diffResult = await invoke("read_workspace_file_diff", {
          root: workspaceRoot,
          relativePath: entry.relativePath,
        });

        if (fileRequestIdRef.current !== requestId) {
          return;
        }

        setFileDiff(diffResult?.diff || "");
        setFileDiffTruncated(Boolean(diffResult?.truncated));
        setFileDiffState("ready");
      } catch (error) {
        if (fileRequestIdRef.current !== requestId) {
          return;
        }

        setFileDiffState("error");
        setFileDiffError(getErrorMessage(error, "Unable to load file diff."));
      }
    } catch (error) {
      if (fileRequestIdRef.current !== requestId) {
        return;
      }

      setFileState("error");
      setFileError(getErrorMessage(error, "Unable to open file."));
    }
  }, [workspaceRoot]);

  const toggleDirectory = useCallback((entry) => {
    const directoryPath = entry.relativePath || "";
    const shouldExpand = !expandedDirectories[directoryPath];

    setExpandedDirectories((directories) => ({
      ...directories,
      [directoryPath]: shouldExpand,
    }));

    if (shouldExpand && !directoryEntries[directoryPath] && directoryStates[directoryPath] !== "loading") {
      loadDirectory(directoryPath);
    }
  }, [directoryEntries, directoryStates, expandedDirectories, loadDirectory]);

  useEffect(() => {
    setDirectoryEntries({});
    setDirectoryStates({});
    setDirectoryErrors({});
    setExpandedDirectories({ "": true });
    setSelectedFile(null);
    setFileContent("");
    setFileState("idle");
    setFileError("");
    setFileDiff("");
    setFileDiffState("idle");
    setFileDiffError("");
    setFileDiffTruncated(false);
    fileRequestIdRef.current += 1;

    if (workspaceRoot) {
      loadDirectory("");
    }
  }, [loadDirectory, workspace?.id, workspaceRoot]);

  const selectedGitStatus = normalizeGitStatus(selectedFile?.gitStatus);
  const selectedGitStatusName = getGitStatusName(selectedGitStatus);
  const selectedFileIconMeta = selectedFile
    ? getFileIconMeta(selectedFile.relativePath || selectedFile.name)
    : { codicon: "codicon-file", tone: "file" };
  const highlightedFileHtml = useMemo(
    () => (fileState === "ready" ? getHighlightedFileHtml(fileContent, selectedFile?.relativePath) : ""),
    [fileContent, fileState, selectedFile?.relativePath],
  );
  const diffLines = useMemo(() => getDiffLines(fileDiff), [fileDiff]);
  const shouldShowDiff = selectedGitStatus === "modified";

  return (
    <FilesWorkspaceSurface aria-label="Workspace files">
      <ResizePanelGroup
        id={`files-layout-${getFileExplorerLayoutKey(workspace?.id || workspaceRoot)}`}
        onLayout={queueExplorerLayout}
        orientation="horizontal"
      >
        <ResizePanel
          defaultSize={fileExplorerLayout[0]}
          id={`files-explorer-${getFileExplorerLayoutKey(workspace?.id || workspaceRoot)}`}
          maxSize={FILE_EXPLORER_MAX_SIZE}
          minSize={FILE_EXPLORER_MIN_SIZE}
        >
          <FileExplorerPane>
            <FileExplorerHeader>
              <div>
                <PanelKicker>Explorer</PanelKicker>
              </div>
              <FileExplorerActions>
                <FileIconButton
                  aria-label="Refresh files"
                  disabled={!workspaceRoot || directoryStates[""] === "loading"}
                  onClick={() => loadDirectory("")}
                  title="Refresh files"
                  type="button"
                >
                  <ButtonRefreshIcon aria-hidden="true" />
                </FileIconButton>
                <FileIconButton
                  aria-label="Workspace settings"
                  onClick={onOpenWorkspaceSettings}
                  title="Workspace settings"
                  type="button"
                >
                  <ButtonSettingsIcon aria-hidden="true" />
                </FileIconButton>
              </FileExplorerActions>
            </FileExplorerHeader>
            <FileRootPath title={workspaceRoot || "No workspace directory"}>
              {workspaceRoot || "No workspace directory"}
            </FileRootPath>
            {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
            <FileTree aria-label="Workspace file explorer">
              {workspaceRoot ? (
                <FileTreeNode
                  directoryEntries={directoryEntries}
                  directoryErrors={directoryErrors}
                  directoryStates={directoryStates}
                  entry={rootEntry}
                  expandedDirectories={expandedDirectories}
                  onOpenFile={openFile}
                  onToggleDirectory={toggleDirectory}
                  selectedFilePath={selectedFile?.relativePath || ""}
                />
              ) : (
                <FileTreeEmpty>Set a workspace directory in settings.</FileTreeEmpty>
              )}
            </FileTree>
          </FileExplorerPane>
        </ResizePanel>

        <ResizeHandle data-direction="horizontal" data-surface="files" />

        <ResizePanel
          defaultSize={fileExplorerLayout[1]}
          id={`files-preview-${getFileExplorerLayoutKey(workspace?.id || workspaceRoot)}`}
          minSize={FILE_PREVIEW_MIN_SIZE}
        >
          <FilePreviewPane>
            <FilePreviewHeader>
              <FilePreviewTitle
                data-file-tone={selectedFileIconMeta.tone}
                data-git-status={selectedGitStatus || undefined}
              >
                <span aria-hidden="true" className={`codicon ${selectedFileIconMeta.codicon}`} />
                <span>{selectedFile ? getExplorerFileName(selectedFile.relativePath) : "No file selected"}</span>
              </FilePreviewTitle>
              {selectedFile && (
                <FilePreviewMeta>
                  {selectedGitStatus && (
                    <FileGitStatusPill data-git-status={selectedGitStatus} title={`${selectedGitStatusName} in git`}>
                      {selectedGitStatusName}
                    </FileGitStatusPill>
                  )}
                  <FileMetaPill>
                    {getFileLanguage(selectedFile.relativePath)}
                    {formatFileSize(selectedFile.size) ? ` / ${formatFileSize(selectedFile.size)}` : ""}
                  </FileMetaPill>
                </FilePreviewMeta>
              )}
            </FilePreviewHeader>

            <FilePreviewPath data-git-status={selectedGitStatus || undefined} title={selectedFile?.relativePath || ""}>
              {selectedFile?.relativePath || " "}
            </FilePreviewPath>

            <FileContentFrame data-state={fileState}>
              {!selectedFile ? (
                <FileEmptyState>
                  <FileEmptyIcon aria-hidden="true">
                    <span className="codicon codicon-files" />
                  </FileEmptyIcon>
                  <PanelHeading>Select a file</PanelHeading>
                </FileEmptyState>
              ) : fileState === "loading" ? (
                <FileEmptyState>
                  <PendingIcon aria-hidden="true" />
                  <PanelHeading>Opening...</PanelHeading>
                </FileEmptyState>
              ) : fileState === "error" ? (
                <FileEmptyState>
                  <FileEmptyIcon aria-hidden="true" data-tone="error">
                    <ErrorIcon />
                  </FileEmptyIcon>
                  <PanelHeading>Unable to open file</PanelHeading>
                  <FormMessage $state="error">{fileError}</FormMessage>
                </FileEmptyState>
              ) : (
                <FilePreviewScroll>
                  {shouldShowDiff && (
                    <FileDiffPanel data-state={fileDiffState}>
                      <FileDiffHeader>
                        <span aria-hidden="true" className="codicon codicon-diff-modified" />
                        <strong>Changes</strong>
                        {fileDiffTruncated && <FileDiffBadge>Truncated</FileDiffBadge>}
                      </FileDiffHeader>
                      {fileDiffState === "loading" ? (
                        <FileDiffMessage>Loading diff...</FileDiffMessage>
                      ) : fileDiffState === "error" ? (
                        <FileDiffMessage data-tone="error">{fileDiffError}</FileDiffMessage>
                      ) : fileDiff ? (
                        <DiffCodeBlock aria-label="Git diff for selected file">
                          {diffLines.map((line) => (
                            <DiffLine data-tone={line.tone} key={line.id}>
                              {line.line}
                            </DiffLine>
                          ))}
                        </DiffCodeBlock>
                      ) : (
                        <FileDiffMessage>No diff available.</FileDiffMessage>
                      )}
                    </FileDiffPanel>
                  )}
                  <HighlightedCodeBlock
                    aria-label="Selected file content"
                    dangerouslySetInnerHTML={{ __html: highlightedFileHtml || " " }}
                  />
                </FilePreviewScroll>
              )}
            </FileContentFrame>
          </FilePreviewPane>
        </ResizePanel>
      </ResizePanelGroup>
    </FilesWorkspaceSurface>
  );
}

function PlaceholderWorkspaceView({
  ariaLabel,
  icon,
  kicker,
  onOpenSettings,
  resourceLabel,
  title,
  workspace,
}) {
  return (
    <VaultWorkspaceSurface aria-label={ariaLabel}>
      <VaultPlaceholderPanel>
        <VaultPlaceholderIcon aria-hidden="true">
          {icon}
        </VaultPlaceholderIcon>
        <div>
          <PanelKicker>{kicker}</PanelKicker>
          <PanelHeading>{title}</PanelHeading>
          <PageSubline>Placeholder</PageSubline>
        </div>
        <VaultStatusGrid>
          <SettingsIdentityItem>
            <span>Status</span>
            <strong>Not connected</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>{resourceLabel}</span>
            <strong>Unavailable</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Scope</span>
            <strong>{workspace?.name || "Workspace"}</strong>
          </SettingsIdentityItem>
        </VaultStatusGrid>
        {onOpenSettings && (
          <SecondaryButton onClick={onOpenSettings} type="button">
            <ButtonSettingsIcon aria-hidden="true" />
            <span>Settings</span>
          </SecondaryButton>
        )}
      </VaultPlaceholderPanel>
    </VaultWorkspaceSurface>
  );
}

function VaultWorkspaceView({ onOpenSettings, workspace }) {
  return (
    <PlaceholderWorkspaceView
      ariaLabel="Vault"
      icon={<ButtonKeyIcon />}
      kicker="Vault"
      onOpenSettings={onOpenSettings}
      resourceLabel="Storage"
      title={`${workspace?.name || "Workspace"} vault`}
      workspace={workspace}
    />
  );
}

function AudioWorkspaceView({
  audioActionState,
  audioDownloadProgress,
  audioError,
  audioModelStatus,
  audioStatusState,
  onDownloadModel,
  onOpenWidget,
  onRefreshStatus,
  workspace,
}) {
  const installed = Boolean(audioModelStatus?.installed);
  const isBusy = audioActionState === "downloading" || audioActionState === "opening" || audioStatusState === "checking";
  const downloadPercent = audioDownloadProgress?.percent;
  const modelBytes = Number(audioModelStatus?.bytes || 0);
  const modelPath = audioModelStatus?.modelPath || "App data";
  const runtimePath = audioModelStatus?.runtimePath || "";
  const modelLabel = audioModelStatus?.modelName || "Whisper base.en";
  const runtimeLabel = audioModelStatus?.runtimePackageName || audioModelStatus?.runtimeName || "whisper.cpp CLI";
  const diskLabel = audioModelStatus?.approximateDiskMb
    ? `${audioModelStatus.approximateDiskMb} MB`
    : formatFileSize(modelBytes);
  const memoryLabel = audioModelStatus?.approximateMemoryMb
    ? `~${audioModelStatus.approximateMemoryMb} MB`
    : "Local CPU";
  const installLabel = audioModelStatus?.runtimeInstallable === false ? "Install model" : "Install Whisper";
  const missingLabel = audioModelStatus?.modelInstalled
    ? "Runtime missing"
    : audioModelStatus?.runtimeInstalled
      ? "Model missing"
      : "Not installed";

  return (
    <AudioWorkspaceSurface aria-label="Workspace audio">
      <AudioSetupPanel data-installed={installed}>
        <AudioHeroRow>
          <VaultPlaceholderIcon aria-hidden="true">
            <ButtonMicIcon />
          </VaultPlaceholderIcon>
          <div>
            <PanelKicker>Audio</PanelKicker>
            <PanelHeading>{workspace?.name || "Workspace"} dictation</PanelHeading>
            <PageSubline>Local Whisper recording for focused text entry.</PageSubline>
          </div>
          <AudioStatePill data-installed={installed}>
            {installed ? "Ready" : audioActionState === "downloading" ? "Downloading" : missingLabel}
          </AudioStatePill>
        </AudioHeroRow>

        <AudioStatusGrid>
          <SettingsIdentityItem>
            <span>Model</span>
            <strong>{modelLabel}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Runtime</span>
            <strong>{audioModelStatus?.runtimeInstalled ? runtimeLabel : "Not detected"}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Shortcut</span>
            <strong>{audioModelStatus?.shortcut || "CommandOrControl+Shift+Space"}</strong>
          </SettingsIdentityItem>
        </AudioStatusGrid>

        <AudioPathBlock>
          <span>Local model path</span>
          <AudioCodePath>{modelPath}</AudioCodePath>
          <span>Runtime path</span>
          <AudioCodePath>{runtimePath || audioModelStatus?.runtimeInstallHint || "Not detected"}</AudioCodePath>
        </AudioPathBlock>

        <AudioStatusGrid>
          <SettingsIdentityItem>
            <span>Model file</span>
            <strong>{audioModelStatus?.modelInstalled ? formatFileSize(modelBytes) || diskLabel || "Ready" : diskLabel || "142 MB"}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Memory</span>
            <strong>{memoryLabel}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Mode</span>
            <strong>VAD gated</strong>
          </SettingsIdentityItem>
        </AudioStatusGrid>

        {audioModelStatus && !audioModelStatus.runtimeInstalled && (
          <AudioRuntimeHint>{audioModelStatus.runtimeInstallHint}</AudioRuntimeHint>
        )}

        {audioDownloadProgress && (
          <AudioProgressPanel>
            <AudioProgressTopline>
              <strong>{audioDownloadProgress.message || "Downloading local Whisper weights."}</strong>
              <span>{formatAudioPercent(downloadPercent)}</span>
            </AudioProgressTopline>
            <AudioProgressTrack aria-hidden="true">
              <AudioProgressBar $progress={Number(downloadPercent) || 0} />
            </AudioProgressTrack>
            <AudioProgressMeta>
              {formatFileSize(audioDownloadProgress.downloadedBytes || 0)}
              {audioDownloadProgress.totalBytes ? ` / ${formatFileSize(audioDownloadProgress.totalBytes)}` : ""}
            </AudioProgressMeta>
          </AudioProgressPanel>
        )}

        {audioError && <FormMessage $state="error">{audioError}</FormMessage>}

        <AudioActionRow>
          {installed ? (
            <PrimaryButton disabled={isBusy} onClick={onOpenWidget} type="button">
              <ButtonMicIcon aria-hidden="true" />
              <span>{audioActionState === "opening" ? "Opening..." : "Open recorder"}</span>
            </PrimaryButton>
          ) : (
            <PrimaryButton disabled={isBusy} onClick={onDownloadModel} type="button">
              <ButtonMicIcon aria-hidden="true" />
              <span>{audioActionState === "downloading" ? "Downloading..." : installLabel}</span>
            </PrimaryButton>
          )}
          <SecondaryButton disabled={isBusy} onClick={onRefreshStatus} type="button">
            <ButtonRefreshIcon aria-hidden="true" />
            <span>{audioStatusState === "checking" ? "Checking..." : "Recheck"}</span>
          </SecondaryButton>
        </AudioActionRow>
      </AudioSetupPanel>
    </AudioWorkspaceSurface>
  );
}

function AudioWidgetWindow() {
  const [modelStatus, setModelStatus] = useState(null);
  const [widgetState, setWidgetState] = useState("checking");
  const [message, setMessage] = useState("Checking Whisper");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [recordingStartedAt, setRecordingStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [vadStats, setVadStats] = useState({ bufferMs: 0, rms: 0, speech: false });
  const audioBufferRef = useRef(null);
  const pendingArmRef = useRef(true);
  const widgetStateRef = useRef(widgetState);

  useEffect(() => {
    widgetStateRef.current = widgetState;
  }, [widgetState]);

  const startWarmBuffer = useCallback(async () => {
    if (audioBufferRef.current) {
      return audioBufferRef.current;
    }

    setMessage("Warming microphone");
    const audioBuffer = await startLowPowerAudioBuffer({
      onStats: setVadStats,
    });
    audioBufferRef.current = audioBuffer;
    setMessage("Buffer ready");

    return audioBuffer;
  }, []);

  const startRecording = useCallback(async () => {
    const currentState = widgetStateRef.current;

    if (currentState === "recording" || currentState === "transcribing" || currentState === "inserting") {
      return;
    }

    if (currentState === "checking" || currentState === "warming") {
      pendingArmRef.current = true;
      return;
    }

    setError("");
    setTranscript("");
    setMessage("Arming buffer");

    try {
      const audioBuffer = await startWarmBuffer();
      audioBuffer.beginCapture();
      setRecordingStartedAt(Date.now());
      setElapsedMs(0);
      widgetStateRef.current = "recording";
      setWidgetState("recording");
      setMessage("Recording");
    } catch (recordingError) {
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getErrorMessage(recordingError, "Unable to start microphone."));
    }
  }, [startWarmBuffer]);

  const refreshStatus = useCallback(async () => {
    let shouldArm = false;
    widgetStateRef.current = "checking";
    setWidgetState("checking");
    setError("");

    try {
      const status = await invoke("whisper_model_status");
      setModelStatus(status);
      if (status.installed) {
        widgetStateRef.current = "warming";
        setWidgetState("warming");
        await startWarmBuffer();
        shouldArm = pendingArmRef.current;
        pendingArmRef.current = false;
        widgetStateRef.current = "ready";
        setWidgetState("ready");
      } else {
        widgetStateRef.current = "missing";
        setWidgetState("missing");
      }
      setMessage(status.installed ? "Buffer ready" : "Install Whisper from the Audio tab.");
      if (shouldArm) {
        window.setTimeout(() => startRecording(), 60);
      }
    } catch (statusError) {
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getErrorMessage(statusError, "Unable to check Whisper."));
    }
  }, [startRecording, startWarmBuffer]);

  const hideWidget = useCallback(() => {
    invoke("hide_audio_widget").catch(() => {});
  }, []);

  const stopRecording = useCallback(async () => {
    const audioBuffer = audioBufferRef.current;

    if (!audioBuffer) {
      return;
    }

    widgetStateRef.current = "transcribing";
    setWidgetState("transcribing");
    setMessage("Checking speech");
    setError("");

    try {
      const { wavBuffer } = audioBuffer.finishCapture();
      setMessage("Transcribing locally");
      const result = await invoke("transcribe_whisper_audio", {
        request: {
          audioBase64: arrayBufferToBase64(wavBuffer),
        },
      });
      const nextTranscript = (result?.text || "").trim();
      setTranscript(nextTranscript);

      if (!nextTranscript) {
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("No speech detected");
        return;
      }

      widgetStateRef.current = "inserting";
      setWidgetState("inserting");
      setMessage("Inserting transcript");
      await invoke("insert_transcribed_text", { text: nextTranscript });
      widgetStateRef.current = "inserted";
      setWidgetState("inserted");
      setMessage("Inserted");
      window.setTimeout(() => {
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("Buffer ready");
        setTranscript("");
      }, 900);
    } catch (recordingError) {
      const messageText = getErrorMessage(recordingError, "Unable to transcribe audio.");

      if (messageText.toLowerCase().includes("no speech detected")) {
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("No speech detected");
        return;
      }

      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(messageText);
    }
  }, []);

  useEffect(() => {
    refreshStatus();

    return () => {
      const audioBuffer = audioBufferRef.current;
      audioBufferRef.current = null;
      if (audioBuffer) {
        audioBuffer.close().catch(() => {});
      }
    };
  }, [refreshStatus]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_WIDGET_ARM_EVENT, () => {
      startRecording();
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [startRecording]);

  useEffect(() => {
    if (widgetState !== "recording") {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const nextElapsedMs = Date.now() - recordingStartedAt;
      setElapsedMs(nextElapsedMs);

      if (nextElapsedMs >= AUDIO_RECORDING_MAX_SECONDS * 1000) {
        stopRecording();
        return;
      }

      const captureStats = audioBufferRef.current?.getCaptureStats?.();
      if (
        captureStats?.speechDetected
        && nextElapsedMs > 850
        && captureStats.lastSpeechAgoMs > AUDIO_AUTO_STOP_SILENCE_MS
      ) {
        stopRecording();
      }
    }, AUDIO_RECORDING_TIMER_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [recordingStartedAt, stopRecording, widgetState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        hideWidget();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hideWidget]);

  const installed = Boolean(modelStatus?.installed);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const isWorking = widgetState === "checking"
    || widgetState === "warming"
    || widgetState === "transcribing"
    || widgetState === "inserting";
  const vadLevel = Math.min(100, Math.round((vadStats.rms || 0) * 1800));

  return (
    <AudioWidgetShell>
      <AudioWidgetHeader>
        <AudioWidgetTitle>
          <span aria-hidden="true"><ButtonMicIcon /></span>
          <strong>Dictation</strong>
        </AudioWidgetTitle>
        <WorkspaceModalCloseButton aria-label="Hide recorder" onClick={hideWidget} type="button">
          <ButtonCloseIcon aria-hidden="true" />
        </WorkspaceModalCloseButton>
      </AudioWidgetHeader>

      <AudioWidgetMeter data-active={widgetState === "recording" || vadStats.speech} aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <span
            key={index}
            style={{
              "--height": `${Math.max(12, Math.min(86, 16 + vadLevel + ((index * 7) % 18)))}%`,
            }}
          />
        ))}
      </AudioWidgetMeter>

      <AudioWidgetStatus>
        <strong>{message}</strong>
        <span>
          {installed
            ? `${modelStatus?.modelName || "Whisper base.en"} / ${Math.round((vadStats.bufferMs || 0) / 1000)}s buffer`
            : "Whisper missing"}
        </span>
      </AudioWidgetStatus>

      {widgetState === "recording" && (
        <AudioRecordingTimer>{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}</AudioRecordingTimer>
      )}

      {transcript && <AudioWidgetTranscript>{transcript}</AudioWidgetTranscript>}
      {error && <FormMessage $state="error">{error}</FormMessage>}

      <AudioWidgetActions>
        {widgetState === "recording" ? (
          <PrimaryButton onClick={stopRecording} type="button">
            <ButtonCheckIcon aria-hidden="true" />
            <span>Finish</span>
          </PrimaryButton>
        ) : (
          <PrimaryButton disabled={!installed || isWorking} onClick={startRecording} type="button">
            <ButtonMicIcon aria-hidden="true" />
            <span>{isWorking ? "Working..." : "Record"}</span>
          </PrimaryButton>
        )}
        <SecondaryButton onClick={hideWidget} type="button">
          <ButtonCloseIcon aria-hidden="true" />
          <span>Hide</span>
        </SecondaryButton>
      </AudioWidgetActions>
    </AudioWidgetShell>
  );
}

function McpsWorkspaceView({ agentStatuses, workspace, workspaces }) {
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

export default function App() {
  if (window.location.hash === AUDIO_WIDGET_HASH) {
    return <AudioWidgetWindow />;
  }

  const {
    status: authState,
    message: authMessage,
    error: authError,
    user,
  } = useAuthSnapshot();
  const [apiState, setApiState] = useState("checking");
  const [apiMessage, setApiMessage] = useState("Checking connection");
  const [activeView, setActiveView] = useState(DEFAULT_WORKSPACE_VIEW);
  const [visibleView, setVisibleView] = useState(DEFAULT_WORKSPACE_VIEW);
  const [viewMotion, setViewMotion] = useState("entered");
  const [activeAgent, setActiveAgent] = useState("codex");
  const [agentStatuses, setAgentStatuses] = useState(readCachedAgentStatuses);
  const [agentStatusState, setAgentStatusState] = useState("idle");
  const [agentStatusError, setAgentStatusError] = useState("");
  const [startupAgentGateState, setStartupAgentGateState] = useState("idle");
  const [startupAgentUpdateMessage, setStartupAgentUpdateMessage] = useState("");
  const [agentInstallState, setAgentInstallState] = useState({});
  const [agentInstallResults, setAgentInstallResults] = useState({});
  const [agentDisconnectState, setAgentDisconnectState] = useState({});
  const [agentActionResults, setAgentActionResults] = useState({});
  const [audioModelStatus, setAudioModelStatus] = useState(null);
  const [audioStatusState, setAudioStatusState] = useState("idle");
  const [audioActionState, setAudioActionState] = useState("idle");
  const [audioError, setAudioError] = useState("");
  const [audioDownloadProgress, setAudioDownloadProgress] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [workspaceSyncState, setWorkspaceSyncState] = useState("idle");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceTerminalCountDraft, setWorkspaceTerminalCountDraft] = useState("1");
  const [workspaceSettings, setWorkspaceSettings] = useState(readWorkspaceSettings);
  const [workspaceTerminalSlots, setWorkspaceTerminalSlots] = useState({});
  const [workspaceRootDraft, setWorkspaceRootDraft] = useState("");
  const [workspaceSettingsState, setWorkspaceSettingsState] = useState("idle");
  const [workspaceSettingsError, setWorkspaceSettingsError] = useState("");
  const [workspaceSettingsMessage, setWorkspaceSettingsMessage] = useState("");
  const [workspaceSettingsModalId, setWorkspaceSettingsModalId] = useState("");
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState("");
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isLaunchScreenVisible, setLaunchScreenVisible] = useState(true);
  const [workspaceState, setWorkspaceState] = useState("idle");
  const [workspaceAgentLaunchEpoch, setWorkspaceAgentLaunchEpoch] = useState(0);
  const [preparedTerminalVersion, setPreparedTerminalVersion] = useState(0);
  const [workspaceAgentBatchSentKey, setWorkspaceAgentBatchSentKey] = useState("");
  const [windowFrameState, setWindowFrameState] = useState(WINDOW_FRAME_STATE_DEFAULT);
  const [workspaceCloseState, setWorkspaceCloseState] = useState(WORKSPACE_CLOSE_INITIAL_STATE);
  const authStartupFinishedRef = useRef(false);
  const authFlowIdRef = useRef(0);
  const launchStartedAtRef = useRef(Date.now());
  const viewTransitionTimeoutRef = useRef(null);
  const agentStatusCacheHitRef = useRef(agentStatuses.some((agent) => agent.cached));
  const agentInitialStatusUserRef = useRef("");
  const startupAgentFlowIdRef = useRef(0);
  const startupAgentSettingsPendingRef = useRef(false);
  const activeWorkspaceIdRef = useRef("");
  const workspaceAgentLaunchKeyRef = useRef("");
  const preparedTerminalsRef = useRef(new Map());
  const workspaceAgentBatchInFlightKeyRef = useRef("");
  const workspaceCloseInFlightRef = useRef(false);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!agentStatusCacheHitRef.current) {
      return;
    }

    writeTerminalTelemetry({
      phase: "frontend.agent_status.cache_hit",
      fields: {
        authenticatedCount: agentStatuses.filter((agent) => agent.cached && agent.authenticated).length,
        installedCount: agentStatuses.filter((agent) => agent.cached && agent.installed).length,
        statusCount: agentStatuses.filter((agent) => agent.cached).length,
      },
    });
  }, []);

  useEffect(() => {
    let unlistenDownloadProgress = null;
    let cancelled = false;

    listen(AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, (progressEvent) => {
      setAudioDownloadProgress(progressEvent.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }

      unlistenDownloadProgress = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenDownloadProgress) {
        unlistenDownloadProgress();
      }
    };
  }, []);
  const terminalMetrics = useTerminalDevMetrics();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null;

  const applyWindowFrameState = useCallback((nextFrameState) => {
    setWindowFrameState((currentFrameState) => (
      currentFrameState.isFullscreen === nextFrameState.isFullscreen
        && currentFrameState.isMaximized === nextFrameState.isMaximized
        ? currentFrameState
        : nextFrameState
    ));
  }, []);

  const refreshWindowFrameState = useCallback(async (appWindow = getCurrentWindow()) => {
    try {
      const nextFrameState = await readWindowFrameState(appWindow);
      applyWindowFrameState(nextFrameState);
      return nextFrameState;
    } catch {
      return null;
    }
  }, [applyWindowFrameState]);

  const setSignedOut = useCallback((
    message = DEFAULT_AUTH_MESSAGE,
    error = "",
    options = {},
  ) => {
    authStore.setSignedOut({
      message,
      error,
      clearSession: options.clearSession !== false,
      clearPending: options.clearPending === true,
    });
    setActiveView(DEFAULT_WORKSPACE_VIEW);
    setVisibleView(DEFAULT_WORKSPACE_VIEW);
    setViewMotion("entered");
    setWorkspaceState("idle");
    setWorkspaces([]);
    setActiveWorkspaceId("");
    setWorkspaceSyncState("idle");
    setWorkspaceName("");
    setWorkspaceNameDraft("");
    setWorkspaceTerminalCountDraft("1");
    setWorkspaceRootDraft("");
    setWorkspaceSettingsState("idle");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    setWorkspaceTerminalSlots({});
    agentInitialStatusUserRef.current = "";
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    setStartupAgentGateState("idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceError("");
  }, []);

  const setAuthenticated = useCallback((sessionUser) => {
    const isPaid = isPaidUser(sessionUser);

    authStore.setAuthenticated(
      sessionUser,
      isPaid ? "Initializing workspace..." : "Upgrade to unlock the desktop workspace.",
    );
    setActiveView(DEFAULT_WORKSPACE_VIEW);
    setVisibleView(DEFAULT_WORKSPACE_VIEW);
    setViewMotion("entered");
    setWorkspaceState(isPaid ? "initializing" : "billingRequired");
    setWorkspaceSyncState("idle");
    setWorkspaceNameDraft("");
    setWorkspaceTerminalCountDraft("1");
    setWorkspaceSettingsState("idle");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    setWorkspaceTerminalSlots({});
    agentInitialStatusUserRef.current = "";
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    setStartupAgentGateState(isPaid ? "checking" : "idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceError("");
  }, []);

  const showView = useCallback((nextView) => {
    if (nextView === activeView && nextView === visibleView) {
      return;
    }

    window.clearTimeout(viewTransitionTimeoutRef.current);
    setWorkspaceSettingsModalId("");
    if (nextView === DEFAULT_WORKSPACE_VIEW && activeWorkspaceIdRef.current) {
      startWorkspaceOpenTelemetry({
        source: "view_switch",
        workspaceId: activeWorkspaceIdRef.current,
        fields: {
          activeView,
          nextView,
          visibleView,
        },
      });
    }
    setActiveView(nextView);
    setViewMotion("exiting");

    viewTransitionTimeoutRef.current = window.setTimeout(() => {
      setVisibleView(nextView);
      window.requestAnimationFrame(() => {
        setViewMotion("entered");
      });
    }, VIEW_TRANSITION_MS);
  }, [activeView, visibleView]);

  const completeAuthStartup = useCallback(() => {
    if (authStartupFinishedRef.current) {
      return;
    }

    authStartupFinishedRef.current = true;
    setAuthInitialized(true);
  }, []);

  const checkBackend = useCallback(async () => {
    setApiState("checking");
    setApiMessage("Checking connection");

    try {
      await withTimeout(
        invoke("backend_ping"),
        BACKEND_HELLO_TIMEOUT_MS,
        BACKEND_HELLO_TIMEOUT_MESSAGE,
      );
      setApiState("online");
      setApiMessage("Diff Forge API online");
    } catch (error) {
      const errorMessage = getErrorMessage(error, BACKEND_HELLO_TIMEOUT_MESSAGE);
      setApiState("offline");
      setApiMessage(
        errorMessage === BACKEND_HELLO_TIMEOUT_MESSAGE
          ? "Connection check timed out. Check your internet connection."
          : "Unable to reach Diff Forge API. Check your internet connection.",
      );
    }
  }, []);

  const validateStoredSession = useCallback(async () => {
    const token = authStore.getToken();
    const validationFlowId = authFlowIdRef.current;

    if (!isSafeAuthValue(token)) {
      setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });
      return;
    }

    authStore.setChecking("Checking saved desktop session. You can still sign in with the web app.");

    try {
      const session = await withTimeout(
        invoke("validate_desktop_session", { token }),
        SESSION_RESTORE_TIMEOUT_MS,
        SESSION_RESTORE_TIMEOUT_MESSAGE,
      );
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      setAuthenticated(session.user);
    } catch (error) {
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      const restoreError = getErrorMessage(error, "Unable to restore your desktop session.");
      const didTimeout = restoreError === SESSION_RESTORE_TIMEOUT_MESSAGE;
      setSignedOut(
        didTimeout
          ? "Secure session check timed out. Sign in with the web app."
          : "Your desktop session expired. Sign in again with the web app.",
        restoreError,
        { clearPending: true },
      );
    }
  }, [setAuthenticated, setSignedOut]);

  const completeDesktopLogin = useCallback(async (callbackUrl) => {
    const callback = parseAuthCallback(callbackUrl);

    if (!callback) {
      return false;
    }

    authFlowIdRef.current += 1;
    const loginFlowId = authFlowIdRef.current;
    const pendingState = authStore.getPendingState();

    if (!pendingState || callback.state !== pendingState) {
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        "Desktop login state did not match. Start again from this app.",
        { clearPending: true },
      );
      return true;
    }

    authStore.setExchanging();

    try {
      const session = await withTimeout(
        invoke("exchange_desktop_auth_code", {
          code: callback.code,
          state: callback.state,
        }),
        AUTH_EXCHANGE_TIMEOUT_MS,
        AUTH_EXCHANGE_TIMEOUT_MESSAGE,
      );

      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      authStore.saveAuthenticatedSession(session);
      authStore.clearPending();
      setAuthenticated(session.user);
    } catch (error) {
      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        getErrorMessage(error, "Desktop login expired. Try again."),
        { clearPending: true },
      );
    }

    return true;
  }, [setAuthenticated, setSignedOut]);

  const startWebLogin = useCallback(async () => {
    authFlowIdRef.current += 1;
    const state = createAuthState();
    authStore.setWaiting(state);

    try {
      const loginUrl = `${WEB_LOGIN_URL}?state=${encodeURIComponent(state)}`;
      await withTimeout(
        openUrl(loginUrl),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open the web login.",
      );
    } catch (error) {
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        getErrorMessage(error, "Unable to open the web login."),
        { clearSession: false, clearPending: true },
      );
    }
  }, [setSignedOut]);

  const openPricing = useCallback(async () => {
    try {
      await withTimeout(
        openUrl(PRICING_URL),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open pricing.",
      );
    } catch (error) {
      authStore.setError(getErrorMessage(error, "Unable to open pricing."));
    }
  }, []);

  const refreshSubscriptionStatus = useCallback(async () => {
    const token = authStore.getToken();
    const refreshFlowId = authFlowIdRef.current;

    if (!isSafeAuthValue(token)) {
      setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });
      return;
    }

    authStore.setMessage("Checking plan status...");
    authStore.setError("");

    try {
      const session = await withTimeout(
        invoke("validate_desktop_session", { token }),
        PLAN_REFRESH_TIMEOUT_MS,
        "Plan status check timed out.",
      );
      if (refreshFlowId !== authFlowIdRef.current) {
        return;
      }

      setAuthenticated(session.user);
    } catch (error) {
      if (refreshFlowId !== authFlowIdRef.current) {
        return;
      }

      setSignedOut(
        "Your desktop session expired. Sign in again with the web app.",
        getErrorMessage(error, "Unable to refresh plan status."),
        { clearPending: true },
      );
    }
  }, [setAuthenticated, setSignedOut]);

  const refreshAgentStatuses = useCallback(async () => {
    const agentStatusStartedAt = performance.now();
    setAgentStatusState("checking");
    setAgentStatusError("");
    writeTerminalTelemetry({
      phase: "frontend.agent_status.start",
    });

    try {
      const statuses = await invoke("agent_statuses");
      const statusMap = new Map(statuses.map((status) => [status.id, status]));
      const nextStatuses = AGENT_PROVIDERS.map((provider) => ({
        ...DEFAULT_AGENT_STATUSES.find((status) => status.id === provider.id),
        ...provider,
        ...(statusMap.get(provider.id) || {}),
      }));
      persistAgentStatusCache(nextStatuses);
      setAgentStatuses(nextStatuses);
      setAgentStatusState("idle");
      writeTerminalTelemetry({
        phase: "frontend.agent_status.done",
        elapsedMs: performance.now() - agentStatusStartedAt,
        fields: {
          updateAvailableCount: nextStatuses.filter((status) => status.npmUpdateAvailable).length,
          authenticatedCount: nextStatuses.filter((status) => status.authenticated).length,
          installedCount: nextStatuses.filter((status) => status.installed).length,
          statusCount: nextStatuses.length,
        },
      });
      return nextStatuses;
    } catch (error) {
      setAgentStatusState("error");
      setAgentStatusError(getErrorMessage(error, "Unable to check terminal CLIs."));
      writeTerminalTelemetry({
        phase: "frontend.agent_status.error",
        elapsedMs: performance.now() - agentStatusStartedAt,
        fields: { error: getErrorMessage(error, "Unable to check terminal CLIs.") },
      });
      return null;
    }
  }, []);

  const refreshAudioModelStatus = useCallback(async () => {
    setAudioStatusState("checking");
    setAudioError("");

    try {
      const status = await invoke("whisper_model_status");
      setAudioModelStatus(status);
      setAudioStatusState("idle");

      if (status?.installed) {
        setAudioDownloadProgress(null);
      }
    } catch (error) {
      setAudioStatusState("error");
      setAudioError(getErrorMessage(error, "Unable to check local Whisper."));
    }
  }, []);

  const downloadAudioModel = useCallback(async () => {
    setAudioActionState("downloading");
    setAudioError("");

    try {
      const status = await invoke("download_whisper_model");
      setAudioModelStatus(status);
      setAudioActionState("idle");
      setAudioDownloadProgress(null);
    } catch (error) {
      setAudioActionState("error");
      setAudioError(getErrorMessage(error, "Unable to install Whisper."));
    }
  }, []);

  const openAudioWidget = useCallback(async () => {
    setAudioActionState("opening");
    setAudioError("");

    try {
      await invoke("show_audio_widget");
      setAudioActionState("idle");
    } catch (error) {
      setAudioActionState("error");
      setAudioError(getErrorMessage(error, "Unable to open the audio widget."));
      refreshAudioModelStatus();
    }
  }, [refreshAudioModelStatus]);

  const connectAgent = useCallback(async (provider) => {
    setAgentStatusState("checking");
    setAgentStatusError("");
    setAgentActionResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      await invoke("start_agent_login", { provider });
      setAgentStatusState("idle");
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "neutral",
          message: "Opened login in a terminal. Use Recheck after the login completes.",
        },
      }));
    } catch (error) {
      setAgentStatusState("error");
      setAgentStatusError(getErrorMessage(error, "Unable to open terminal CLI login."));
    }
  }, []);

  const disconnectAgent = useCallback(async (provider) => {
    setAgentDisconnectState((state) => ({ ...state, [provider]: "disconnecting" }));
    setAgentStatusError("");
    setAgentActionResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("disconnect_agent", { provider });
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "warning",
          message: result?.message || `${result?.label || "Terminal CLI"} disconnected from this machine.`,
        },
      }));
      setAgentStatuses((statuses) => statuses.map((agent) => (
        agent.id === provider
          ? {
            ...agent,
            authenticated: false,
            authMessage: result?.message || `${agent.label} disconnected from this machine.`,
          }
          : agent
      )));
    } catch (error) {
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "warning",
          message: getErrorMessage(error, "Unable to disconnect terminal CLI."),
        },
      }));
    } finally {
      setAgentDisconnectState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, []);

  const installAgentWithNpm = useCallback(async (provider) => {
    setAgentInstallState((state) => ({ ...state, [provider]: "installing" }));
    setAgentStatusError("");
    setAgentInstallResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("install_agent", { provider });
      setAgentInstallResults((results) => ({ ...results, [provider]: { ...result, source: "npm" } }));

      if (result?.installed) {
        await refreshAgentStatuses();
      }
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [provider]: {
          source: "npm",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to install terminal CLI."),
        },
      }));
    } finally {
      setAgentInstallState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, [refreshAgentStatuses]);

  const updateAgentWithNpm = useCallback(async (provider) => {
    setAgentInstallState((state) => ({ ...state, [provider]: "updating" }));
    setAgentStatusError("");
    setAgentInstallResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("update_agent", { provider });
      setAgentInstallResults((results) => ({ ...results, [provider]: { ...result, source: "npm-update" } }));

      if (result?.installed) {
        await refreshAgentStatuses();
      }
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [provider]: {
          source: "npm-update",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to update terminal CLI."),
        },
      }));
    } finally {
      setAgentInstallState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, [refreshAgentStatuses]);

  const finishStartupAgentGate = useCallback((statuses = agentStatuses, reason = "complete") => {
    const nextStatuses = Array.isArray(statuses) && statuses.length ? statuses : agentStatuses;
    const readyCount = nextStatuses.filter((agent) => agent.installed && agent.authenticated).length;
    const updateAvailableCount = getAgentUpdatesAvailable(nextStatuses).length;

    startupAgentSettingsPendingRef.current = readyCount === 0;
    setStartupAgentGateState("complete");
    setStartupAgentUpdateMessage("");
    writeTerminalTelemetry({
      phase: "frontend.agent_status.startup_gate_done",
      fields: {
        readyCount,
        reason,
        updateAvailableCount,
      },
    });
  }, [agentStatuses]);

  const enterWorkspaceAfterAgentCheck = useCallback(() => {
    finishStartupAgentGate(agentStatuses, "enter_without_update");
  }, [agentStatuses, finishStartupAgentGate]);

  const updateStartupAgents = useCallback(async () => {
    const updates = getAgentUpdatesAvailable(agentStatuses);

    if (!updates.length) {
      finishStartupAgentGate(agentStatuses, "no_updates");
      return;
    }

    const updateStartedAt = performance.now();
    setStartupAgentGateState("updating");
    setStartupAgentUpdateMessage(`Updating ${formatAgentList(updates)}...`);
    writeTerminalTelemetry({
      phase: "frontend.agent_status.startup_update_start",
      fields: {
        providers: updates.map((agent) => agent.id),
        updateCount: updates.length,
      },
    });

    for (const agent of updates) {
      setStartupAgentUpdateMessage(`Updating ${agent.label}...`);
      setAgentInstallState((state) => ({ ...state, [agent.id]: "updating" }));
      setAgentInstallResults((results) => {
        const nextResults = { ...results };
        delete nextResults[agent.id];
        return nextResults;
      });

      try {
        const result = await invoke("update_agent", { provider: agent.id });
        setAgentInstallResults((results) => ({ ...results, [agent.id]: { ...result, source: "npm-update" } }));
      } catch (error) {
        setAgentInstallResults((results) => ({
          ...results,
          [agent.id]: {
            source: "npm-update",
            installed: false,
            permissionDenied: false,
            message: getErrorMessage(error, "Unable to update terminal CLI."),
          },
        }));
      } finally {
        setAgentInstallState((state) => ({ ...state, [agent.id]: "idle" }));
      }
    }

    setStartupAgentUpdateMessage("Refreshing terminal CLI status...");
    const nextStatuses = await refreshAgentStatuses();
    writeTerminalTelemetry({
      phase: "frontend.agent_status.startup_update_done",
      elapsedMs: performance.now() - updateStartedAt,
      fields: {
        providers: updates.map((agent) => agent.id),
        updateCount: updates.length,
      },
    });
    finishStartupAgentGate(nextStatuses || agentStatuses, "updated");
  }, [agentStatuses, finishStartupAgentGate, refreshAgentStatuses]);

  const openAgentNativeInstaller = useCallback(async (agent) => {
    const guide = AGENT_INSTALL_GUIDES[agent.id] || {};
    const nativeInstallUrl = agent.nativeInstallUrl || guide.nativeInstallUrl;

    if (!nativeInstallUrl) {
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: "Native installer page is not configured.",
        },
      }));
      return;
    }

    try {
      await withTimeout(
        openUrl(nativeInstallUrl),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open native installer page.",
      );
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: `Opened ${agent.nativeInstallLabel || guide.nativeInstallLabel}. Recheck after install finishes.`,
        },
      }));
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to open native installer page."),
        },
      }));
    }
  }, []);

  const expireDesktopSession = useCallback((error) => {
    setSignedOut(
      "Your desktop session expired. Sign in again with the web app.",
      getErrorMessage(error, "Desktop session expired."),
      { clearPending: true },
    );
  }, [setSignedOut]);

  const loadWorkspaces = useCallback(async () => {
    const token = authStore.getToken();
    const loadStartedAt = performance.now();

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to load workspaces.");
      return;
    }

    writeTerminalTelemetry({
      phase: "frontend.workspace.load_start",
      fields: {
        activeWorkspaceId: activeWorkspaceIdRef.current,
      },
    });
    setWorkspaceSyncState("loading");
    setWorkspaceError("");

    try {
      const result = await invoke("list_workspaces", { token });
      const nextWorkspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
      const currentActiveId = activeWorkspaceIdRef.current;
      const nextActive = nextWorkspaces.find((workspace) => workspace.id === currentActiveId) || nextWorkspaces[0] || null;

      writeTerminalTelemetry({
        phase: "frontend.workspace.load_done",
        elapsedMs: performance.now() - loadStartedAt,
        fields: {
          activeWorkspaceId: currentActiveId,
          nextWorkspaceId: nextActive?.id || "",
          workspaceCount: nextWorkspaces.length,
        },
      });

      if (nextActive) {
        startWorkspaceOpenTelemetry({
          source: "workspace_load",
          workspaceId: nextActive.id,
          fields: {
            activeWorkspaceId: currentActiveId,
            workspaceCount: nextWorkspaces.length,
          },
        });
      }

      setWorkspaces(nextWorkspaces);
      setActiveWorkspaceId((currentActiveId) => {
        if (nextWorkspaces.length === 0) {
          return "";
        }

        const nextActive = nextWorkspaces.find((workspace) => workspace.id === currentActiveId) || nextWorkspaces[0];

        return nextActive.id;
      });

      setWorkspaceSyncState("idle");
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      writeTerminalTelemetry({
        phase: "frontend.workspace.load_error",
        elapsedMs: performance.now() - loadStartedAt,
        fields: {
          error: getErrorMessage(error, "Unable to load workspaces."),
        },
      });
      setWorkspaceSyncState("error");
      setWorkspaceError(getErrorMessage(error, "Unable to load workspaces."));
    }
  }, [expireDesktopSession]);

  const createFirstWorkspace = useCallback(async (event) => {
    event.preventDefault();

    const token = authStore.getToken();
    const name = workspaceName.trim();

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to create a workspace.");
      return;
    }

    if (!name) {
      setWorkspaceError("Name your first workspace.");
      return;
    }

    setWorkspaceSyncState("creating");
    setWorkspaceError("");

    try {
      const result = await invoke("create_workspace", {
        token,
        name,
      });
      const workspace = result?.workspace;

      if (!workspace) {
        throw new Error("Workspace was not returned by the API.");
      }

      startWorkspaceOpenTelemetry({
        source: "workspace_create",
        workspaceId: workspace.id,
        fields: {
          workspaceCount: 1,
        },
      });
      setWorkspaces([workspace]);
      setActiveWorkspaceId(workspace.id);
      setWorkspaceName("");
      setWorkspaceSyncState("idle");
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSyncState("error");
      setWorkspaceError(getErrorMessage(error, "Unable to create workspace."));
    }
  }, [expireDesktopSession, workspaceName]);

  const openWorkspaceSettings = useCallback((workspaceId) => {
    setActiveWorkspaceId(workspaceId);
    setWorkspaceSettingsModalId(workspaceId);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, []);

  const closeWorkspaceSettings = useCallback(() => {
    setWorkspaceSettingsModalId("");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, []);

  const saveWorkspaceSettings = useCallback(async (event) => {
    event.preventDefault();

    if (!activeWorkspace) {
      setWorkspaceSettingsError("Select a workspace before changing settings.");
      return;
    }

    const token = authStore.getToken();
    const workspaceNameValue = workspaceNameDraft.replace(/[\u0000-\u001F\u007F]/g, "").trim();
    const terminalCount = normalizeWorkspaceTerminalCount(workspaceTerminalCountDraft);
    const cleanedRoot = cleanWorkspaceRootDirectory(workspaceRootDraft);
    const currentRootDirectory = getWorkspaceRootDirectory(workspaceSettings, activeWorkspace.id);
    const currentTerminalCount = getWorkspaceTerminalCount(workspaceSettings, activeWorkspace.id);

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to update workspace settings.");
      return;
    }

    if (!workspaceNameValue) {
      setWorkspaceSettingsError("Workspace name is required.");
      return;
    }

    if (workspaceNameValue.length > 80) {
      setWorkspaceSettingsError("Workspace name must be 80 characters or fewer.");
      return;
    }

    if (cleanedRoot.length > MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH) {
      setWorkspaceSettingsError("Root directory path is too long.");
      return;
    }

    setWorkspaceSettingsState("saving");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");

    try {
      const normalizedRoot = cleanedRoot
        ? await invoke("validate_workspace_root_directory", { path: cleanedRoot })
        : null;
      const rootDirectory = normalizedRoot?.workingDirectory || "";
      const nextTerminalIndexes = getDefaultTerminalIndexes(terminalCount);
      const nextTerminalIndexSet = new Set(nextTerminalIndexes);
      const currentTerminalIndexes = normalizeWorkspaceTerminalIndexes(
        workspaceTerminalSlots[activeWorkspace.id],
        currentTerminalCount,
      );
      const removedTerminalIndexes = currentTerminalIndexes.filter((terminalIndex) => (
        !nextTerminalIndexSet.has(terminalIndex)
      ));
      let nextWorkspace = activeWorkspace;

      if (workspaceNameValue !== activeWorkspace.name) {
        const result = await invoke("update_workspace", {
          token,
          workspaceId: activeWorkspace.id,
          name: workspaceNameValue,
        });

        if (!result?.workspace) {
          throw new Error("Workspace was not returned by the API.");
        }

        nextWorkspace = result.workspace;
        setWorkspaces((items) => items.map((workspace) => (
          workspace.id === nextWorkspace.id ? nextWorkspace : workspace
        )));
      }

      setWorkspaceSettings((settings) => {
        const nextSettings = updateWorkspaceLocalSettings(settings, activeWorkspace.id, {
          rootDirectory,
          terminalCount,
        });
        persistWorkspaceSettings(nextSettings);
        return nextSettings;
      });

      if (rootDirectory !== currentRootDirectory || terminalCount !== currentTerminalCount) {
        setWorkspaceTerminalSlots((slots) => ({
          ...slots,
          [activeWorkspace.id]: nextTerminalIndexes,
        }));
      }

      removedTerminalIndexes.forEach((terminalIndex) => {
        closeWorkspaceTerminalPane({
          agentId: activeAgent,
          nextTerminalCount: terminalCount,
          previousTerminalCount: currentTerminalCount,
          reason: "settings_save",
          terminalIndex,
          workspaceId: activeWorkspace.id,
        });
      });

      setWorkspaceNameDraft(nextWorkspace.name);
      setWorkspaceRootDraft(rootDirectory);
      setWorkspaceTerminalCountDraft(String(terminalCount));
      setWorkspaceSettingsState("idle");
      setWorkspaceSettingsMessage("Workspace settings saved.");
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSettingsState("error");
      setWorkspaceSettingsError(getErrorMessage(error, "Unable to update workspace settings."));
    }
  }, [
    activeWorkspace,
    expireDesktopSession,
    workspaceNameDraft,
    workspaceRootDraft,
    workspaceTerminalCountDraft,
    workspaceSettings,
    workspaceTerminalSlots,
    activeAgent,
  ]);

  const closeWorkspaceTerminal = useCallback(({ workspaceId, terminalIndex }) => {
    if (!workspaceId) {
      return;
    }

    const terminalCount = getWorkspaceTerminalCount(workspaceSettings, workspaceId);
    const currentIndexes = normalizeWorkspaceTerminalIndexes(
      workspaceTerminalSlots[workspaceId],
      terminalCount,
    );

    if (currentIndexes.length <= MIN_WORKSPACE_TERMINAL_COUNT) {
      return;
    }

    let nextIndexes = currentIndexes.filter((index) => index !== terminalIndex);

    if (nextIndexes.length === currentIndexes.length) {
      nextIndexes = currentIndexes.slice(0, -1);
    }

    const nextTerminalCount = Math.max(MIN_WORKSPACE_TERMINAL_COUNT, nextIndexes.length);

    setWorkspaceTerminalSlots((slots) => ({
      ...slots,
      [workspaceId]: nextIndexes,
    }));
    setWorkspaceSettings((settings) => {
      const nextSettings = updateWorkspaceLocalSettings(settings, workspaceId, {
        terminalCount: nextTerminalCount,
      });

      persistWorkspaceSettings(nextSettings);
      return nextSettings;
    });

    if (workspaceSettingsModalId === workspaceId) {
      setWorkspaceTerminalCountDraft(String(nextTerminalCount));
    }
  }, [workspaceSettings, workspaceSettingsModalId, workspaceTerminalSlots]);

  const useDefaultWorkspaceRoot = useCallback(() => {
    setWorkspaceRootDraft(defaultWorkingDirectory);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, [defaultWorkingDirectory]);

  const logout = useCallback(async () => {
    authFlowIdRef.current += 1;
    const token = authStore.getToken();

    setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });

    if (isSafeAuthValue(token)) {
      try {
        await withTimeout(
          invoke("logout_desktop_session", { token }),
          LOGOUT_TIMEOUT_MS,
          "Desktop sign out timed out.",
        );
      } catch {
        // Local session cleanup still wins if the remote revoke cannot complete.
      }
    }
  }, [setSignedOut]);

  const toggleWindowSize = useCallback(() => {
    runWindowAction(async () => {
      const appWindow = getCurrentWindow();
      const latestFrameState = await refreshWindowFrameState(appWindow);
      const isFullscreen = latestFrameState?.isFullscreen ?? windowFrameState.isFullscreen;

      if (isFullscreen) {
        await appWindow.setFullscreen(false);
      } else {
        await appWindow.toggleMaximize();
      }

      await refreshWindowFrameState(appWindow);
    });
  }, [refreshWindowFrameState, windowFrameState.isFullscreen]);

  const handleTitleBarMouseDown = useCallback((event) => {
    if (event.button !== 0 || event.target.closest("[data-window-control]")) {
      return;
    }

    if (event.detail === 2) {
      toggleWindowSize();
      return;
    }

    runWindowAction(() => getCurrentWindow().startDragging());
  }, [toggleWindowSize]);

  const minimizeWindow = useCallback((event) => {
    event.stopPropagation();
    runWindowAction(() => getCurrentWindow().minimize());
  }, []);

  const toggleMaximizeWindow = useCallback((event) => {
    event.stopPropagation();
    toggleWindowSize();
  }, [toggleWindowSize]);

  const closeWindow = useCallback((event) => {
    event.stopPropagation();

    if (workspaceCloseInFlightRef.current) {
      return;
    }

    workspaceCloseInFlightRef.current = true;
    setWorkspaceCloseState({ isActive: true, closed: 0, total: 0 });

    runWindowAction(async () => {
      let unlistenCloseProgress = null;

      try {
        unlistenCloseProgress = await listen(TERMINAL_CLOSE_ALL_PROGRESS_EVENT, (progressEvent) => {
          const nextProgress = normalizeTerminalCloseProgress(progressEvent.payload);

          setWorkspaceCloseState((currentCloseState) => {
            const currentProgress = normalizeTerminalCloseProgress(currentCloseState);

            return {
              isActive: true,
              closed: Math.max(currentProgress.closed, nextProgress.closed),
              total: Math.max(currentProgress.total, nextProgress.total),
            };
          });
        });
      } catch {
        // Missing progress events should not block the close sequence.
      }

      try {
        const result = await invoke("terminal_close_all");
        const closed = normalizeCloseCount(result?.closed);

        setWorkspaceCloseState((currentCloseState) => {
          const currentProgress = normalizeTerminalCloseProgress(currentCloseState);
          const total = Math.max(currentProgress.total, closed);

          return {
            isActive: true,
            closed: total,
            total,
          };
        });
      } catch {
        // App close should still complete if terminal cleanup cannot report status.
      } finally {
        if (typeof unlistenCloseProgress === "function") {
          unlistenCloseProgress();
        }
      }

      try {
        await getCurrentWindow().close();
      } catch {
        workspaceCloseInFlightRef.current = false;
        setWorkspaceCloseState(WORKSPACE_CLOSE_INITIAL_STATE);
      }
    });
  }, []);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  useEffect(() => {
    let isMounted = true;
    let unlistenResize = null;
    const appWindow = getCurrentWindow();

    const refresh = async () => {
      try {
        const nextFrameState = await readWindowFrameState(appWindow);

        if (isMounted) {
          applyWindowFrameState(nextFrameState);
        }
      } catch {
        // Window frame state is a visual hint; unavailable APIs should not block the shell.
      }
    };

    refresh();

    appWindow.onResized(refresh)
      .then((unlisten) => {
        if (!isMounted && typeof unlisten === "function") {
          unlisten();
          return;
        }

        unlistenResize = unlisten;
      })
      .catch(() => {});

    return () => {
      isMounted = false;

      if (typeof unlistenResize === "function") {
        unlistenResize();
      }
    };
  }, [applyWindowFrameState]);

  useEffect(() => {
    let isMounted = true;

    invoke("forge_working_directory")
      .then((result) => {
        if (isMounted) {
          setDefaultWorkingDirectory(result?.workingDirectory || "");
        }
      })
      .catch(() => {
        if (isMounted) {
          setDefaultWorkingDirectory("");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(viewTransitionTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (authState === "authenticated") {
      return;
    }

    setWorkspaceState("idle");
    setWorkspaces([]);
    setActiveWorkspaceId("");
    setWorkspaceSyncState("idle");
    setWorkspaceRootDraft("");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    agentInitialStatusUserRef.current = "";
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    workspaceAgentLaunchKeyRef.current = "";
    workspaceAgentBatchInFlightKeyRef.current = "";
    preparedTerminalsRef.current.clear();
    setStartupAgentGateState("idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceAgentLaunchEpoch(0);
    setWorkspaceAgentBatchSentKey("");
    setPreparedTerminalVersion((version) => version + 1);
  }, [authState]);

  useEffect(() => {
    if (authInitialized) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (authStartupFinishedRef.current) {
        return;
      }

      authFlowIdRef.current += 1;
      setSignedOut(
        "Secure session check timed out. Sign in with the web app.",
        SESSION_RESTORE_TIMEOUT_MESSAGE,
        { clearPending: true },
      );
      completeAuthStartup();
    }, AUTH_STARTUP_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authInitialized, completeAuthStartup, setSignedOut]);

  useEffect(() => {
    let isMounted = true;
    let unlistenDeepLinks = null;

    onOpenUrl(async (urls) => {
      if (!isMounted) {
        return;
      }

      for (const url of urls) {
        const handled = await completeDesktopLogin(url);

        if (!isMounted || handled) {
          break;
        }
      }
    })
      .then((unlisten) => {
        if (!isMounted && typeof unlisten === "function") {
          unlisten();
          return;
        }

        unlistenDeepLinks = unlisten;
      })
      .catch((error) => {
        if (isMounted) {
          authStore.setError(getErrorMessage(error, "Desktop login callback listener is unavailable."));
        }
      });

    async function initializeAuth() {
      try {
        let startUrls = [];
        let handledDeepLink = false;

        try {
          startUrls = await withTimeout(
            getCurrent(),
            DEEP_LINK_STARTUP_TIMEOUT_MS,
            "Desktop startup link check timed out.",
          );
        } catch {
          startUrls = [];
        }

        if (!isMounted) {
          return;
        }

        if (Array.isArray(startUrls)) {
          for (const url of startUrls) {
            const handled = await completeDesktopLogin(url);
            handledDeepLink = handled || handledDeepLink;

            if (!isMounted || handled) {
              break;
            }
          }
        }

        if (!handledDeepLink && isMounted) {
          await validateStoredSession();
        }
      } catch (error) {
        if (isMounted && !authStartupFinishedRef.current) {
          authFlowIdRef.current += 1;
          setSignedOut(
            "Unable to restore your desktop session. Sign in with the web app.",
            getErrorMessage(error, "Desktop sign in is unavailable."),
            { clearPending: true },
          );
        }
      } finally {
        if (isMounted) {
          completeAuthStartup();
        }
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;

      if (typeof unlistenDeepLinks === "function") {
        unlistenDeepLinks();
      }
    };
  }, [completeAuthStartup, completeDesktopLogin, setSignedOut, validateStoredSession]);

  useEffect(() => {
    if (!authInitialized) {
      return undefined;
    }

    const elapsed = Date.now() - launchStartedAtRef.current;
    const remaining = Math.max(350, LAUNCH_MINIMUM_MS - elapsed);
    const timeoutId = window.setTimeout(() => {
      setLaunchScreenVisible(false);
    }, remaining);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authInitialized]);

  const isStartupAgentGateBlocking = startupAgentGateState === "checking"
    || startupAgentGateState === "choice"
    || startupAgentGateState === "updating";

  useEffect(() => {
    if (
      authState !== "authenticated"
      || workspaceState !== "initializing"
      || isLaunchScreenVisible
      || isStartupAgentGateBlocking
    ) {
      return undefined;
    }

    writeTerminalTelemetry({
      phase: "frontend.workspace.ready_immediate",
    });
    setWorkspaceState("ready");
    authStore.setMessage("Workspace ready.");

    return undefined;
  }, [authState, isLaunchScreenVisible, isStartupAgentGateBlocking, workspaceState]);

  useEffect(() => {
    if (authState !== "authenticated" || !isPaidUser(user) || workspaceState !== "initializing") {
      return undefined;
    }

    const userKey = user?.id || user?.email || "paid-user";

    if (agentInitialStatusUserRef.current !== userKey) {
      const startupFlowId = startupAgentFlowIdRef.current + 1;

      startupAgentFlowIdRef.current = startupFlowId;
      agentInitialStatusUserRef.current = userKey;
      setStartupAgentGateState("checking");
      setStartupAgentUpdateMessage("");
      writeTerminalTelemetry({
        phase: "frontend.agent_status.startup_gate_start",
        fields: {
          userKeyPresent: Boolean(userKey),
        },
      });
      refreshAudioModelStatus();
      loadWorkspaces();

      refreshAgentStatuses().then((nextStatuses) => {
        if (startupAgentFlowIdRef.current !== startupFlowId || agentInitialStatusUserRef.current !== userKey) {
          return;
        }

        if (!nextStatuses) {
          finishStartupAgentGate(agentStatuses, "status_error");
          return;
        }

        const updates = getAgentUpdatesAvailable(nextStatuses);

        if (updates.length) {
          setStartupAgentGateState("choice");
          writeTerminalTelemetry({
            phase: "frontend.agent_status.startup_update_choice",
            fields: {
              providers: updates.map((agent) => agent.id),
              updateCount: updates.length,
            },
          });
          return;
        }

        finishStartupAgentGate(nextStatuses, "no_updates");
      });
    }

    return undefined;
  }, [
    agentStatuses,
    authState,
    finishStartupAgentGate,
    loadWorkspaces,
    refreshAgentStatuses,
    refreshAudioModelStatus,
    user,
    workspaceState,
  ]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || workspaceState !== "ready"
      || !startupAgentSettingsPendingRef.current
    ) {
      return;
    }

    startupAgentSettingsPendingRef.current = false;
    showView("settings");
  }, [authState, showView, workspaceState]);

  useEffect(() => {
    if (authState === "authenticated" && activeView === "audio") {
      refreshAudioModelStatus();
    }
  }, [activeView, authState, refreshAudioModelStatus]);

  const isAuthBusy = authState === "waiting" || authState === "exchanging";
  const authPanelTitle = {
    waiting: "Waiting for web sign in",
    exchanging: "Finishing desktop sign in",
    signedOut: "Continue in browser",
  }[authState] || "Continue in browser";
  const authButtonLabel = {
    waiting: "Waiting...",
    exchanging: "Finishing...",
  }[authState] || "Sign in with web";
  const authStateLabel = {
    authenticated: "active",
    exchanging: "exchanging",
    signedOut: "ready",
    waiting: "waiting",
  }[authState] || "ready";
  const displayName = user?.name || user?.email || "there";
  const userIsPaid = isPaidUser(user);
  const planLabel = userIsPaid ? "Pro" : "Free";
  const connectedAgentCount = agentStatuses.filter((agent) => agent.installed && agent.authenticated).length;
  const startupAgentUpdates = getAgentUpdatesAvailable(agentStatuses);
  const startupAgentStatusTitle = startupAgentGateState === "choice"
    ? "Terminal CLI updates available"
    : startupAgentGateState === "updating"
      ? startupAgentUpdateMessage || "Updating terminal CLIs..."
      : startupAgentGateState === "checking"
        ? "Checking terminal CLIs..."
        : "Terminal readiness checked";
  const startupAgentStatusDetail = startupAgentGateState === "choice"
    ? getAgentUpdateSummary(startupAgentUpdates)
    : startupAgentGateState === "updating"
      ? "The workspace will open when the selected updates finish."
      : startupAgentGateState === "checking"
        ? "Codex and Claude Code readiness are being checked while the workspace loads."
        : connectedAgentCount > 0
          ? `${connectedAgentCount}/2 terminal CLIs ready.`
          : "No ready terminal CLIs found. Settings will open so you can install or connect one.";
  const startupAgentStatusState = startupAgentGateState === "choice"
    ? "update"
    : startupAgentGateState === "updating"
      ? "checking"
      : connectedAgentCount > 0
        ? "ready"
        : "warning";
  const activeWorkspaceRootDirectory = activeWorkspace
    ? getWorkspaceRootDirectory(workspaceSettings, activeWorkspace.id)
    : "";
  const workspaceTerminalAgent = useMemo(
    () => getReadyAgent(agentStatuses, activeAgent),
    [activeAgent, agentStatuses],
  );
  const shouldShowWorkspaceSetup = workspaceSyncState !== "loading" && workspaces.length === 0;
  const workspacePrewarmAgent = useMemo(
    () => getLaunchableAgent(agentStatuses, activeAgent),
    [activeAgent, agentStatuses],
  );
  const shouldPrewarmWorkspaceTerminals = authState === "authenticated"
    && userIsPaid
    && workspaceState === "initializing"
    && isStartupAgentGateBlocking
    && Boolean(activeWorkspace)
    && !shouldShowWorkspaceSetup;
  const workspaceTerminalRenderAgent = workspaceTerminalAgent
    || (shouldPrewarmWorkspaceTerminals ? workspacePrewarmAgent : null);
  const workspaceTerminalAgentLaunchReady = workspaceState === "ready" && Boolean(workspaceTerminalAgent);
  const activeWorkspaceTerminalCount = activeWorkspace && !shouldShowWorkspaceSetup
    ? getWorkspaceTerminalCount(workspaceSettings, activeWorkspace.id)
    : MIN_WORKSPACE_TERMINAL_COUNT;
  const activeWorkspaceTerminalIndexes = useMemo(
    () => (
      activeWorkspace && !shouldShowWorkspaceSetup
        ? normalizeWorkspaceTerminalIndexes(
          workspaceTerminalSlots[activeWorkspace.id],
          activeWorkspaceTerminalCount,
        )
        : getDefaultTerminalIndexes(MIN_WORKSPACE_TERMINAL_COUNT)
    ),
    [
      activeWorkspace?.id,
      activeWorkspaceTerminalCount,
      shouldShowWorkspaceSetup,
      workspaceTerminalSlots,
    ],
  );
  const activeWorkspaceVisibleTerminalCount = activeWorkspaceTerminalIndexes.length;
  const workspaceAgentLaunchKey = workspaceTerminalAgentLaunchReady && activeWorkspace
    ? [
      activeWorkspace.id,
      workspaceTerminalAgent.id,
      activeWorkspaceTerminalIndexes.join(","),
    ].join(":")
    : "";
  const terminalPanelRows = useMemo(
    () => getTerminalPanelRows(activeWorkspaceTerminalIndexes),
    [activeWorkspaceTerminalIndexes],
  );
  const activeWorkspaceRootDisplay = activeWorkspaceRootDirectory || defaultWorkingDirectory || "App directory";
  const activeWorkspaceAgentWorkingDirectory = activeWorkspaceRootDirectory || defaultWorkingDirectory;
  const activeWorkspaceFileRoot = activeWorkspaceRootDirectory || defaultWorkingDirectory;
  const isWorkspaceSettingsOpen = Boolean(workspaceSettingsModalId && activeWorkspace);
  const openActiveWorkspaceSettings = useCallback(() => {
    if (activeWorkspace) {
      openWorkspaceSettings(activeWorkspace.id);
      return;
    }

    showView("settings");
  }, [activeWorkspace, openWorkspaceSettings, showView]);

  const handlePreparedTerminalChange = useCallback((session) => {
    if (!session?.paneId) {
      return;
    }

    const key = `${session.workspaceId || ""}:${session.terminalIndex}:${session.agentId || ""}:${session.paneId}`;

    if (session.ready) {
      preparedTerminalsRef.current.set(key, {
        agentId: session.agentId || "",
        instanceId: session.instanceId,
        paneId: session.paneId,
        terminalIndex: session.terminalIndex,
        workspaceId: session.workspaceId || "",
      });
    } else {
      preparedTerminalsRef.current.delete(key);
    }

    setPreparedTerminalVersion((version) => version + 1);
  }, []);

  const preparedWorkspaceTerminalRequests = useMemo(() => {
    if (!activeWorkspace || !workspaceTerminalAgent) {
      return [];
    }

    const terminalIndexes = new Set(activeWorkspaceTerminalIndexes);

    return Array.from(preparedTerminalsRef.current.values())
      .filter((session) => (
        session.workspaceId === activeWorkspace.id
        && session.agentId === workspaceTerminalAgent.id
        && terminalIndexes.has(session.terminalIndex)
      ))
      .sort((left, right) => left.terminalIndex - right.terminalIndex)
      .map((session) => ({
        instanceId: session.instanceId,
        model: "",
        paneId: session.paneId,
        provider: workspaceTerminalAgent.id,
      }));
  }, [
    activeWorkspace?.id,
    activeWorkspaceTerminalIndexes,
    preparedTerminalVersion,
    workspaceTerminalAgent?.id,
  ]);
  const preparedWorkspaceTerminalCount = preparedWorkspaceTerminalRequests.length;
  const shouldHoldWorkspaceRevealForTerminalBatch = Boolean(
    workspaceAgentLaunchKey
    && preparedWorkspaceTerminalCount > 0
    && workspaceAgentBatchSentKey !== workspaceAgentLaunchKey,
  );

  useEffect(() => {
    if (!workspaceAgentLaunchKey) {
      workspaceAgentLaunchKeyRef.current = "";
      workspaceAgentBatchInFlightKeyRef.current = "";
      setWorkspaceAgentBatchSentKey("");
      return;
    }

    if (
      workspaceAgentBatchSentKey === workspaceAgentLaunchKey
      || workspaceAgentBatchInFlightKeyRef.current === workspaceAgentLaunchKey
      || preparedWorkspaceTerminalCount === 0
      || preparedWorkspaceTerminalCount < activeWorkspaceVisibleTerminalCount
    ) {
      return;
    }

    workspaceAgentLaunchKeyRef.current = workspaceAgentLaunchKey;
    workspaceAgentBatchInFlightKeyRef.current = workspaceAgentLaunchKey;
    const batchStartedAt = performance.now();
    writeTerminalTelemetry({
      paneId: activeWorkspace?.id || "",
      phase: "frontend.agent_launch.batch_start",
      fields: {
        agentId: workspaceTerminalAgent?.id || "",
        preparedTerminalCount: preparedWorkspaceTerminalCount,
        terminalCount: activeWorkspaceVisibleTerminalCount,
        terminalIndexes: activeWorkspaceTerminalIndexes,
        ...getWorkspaceOpenTelemetryFields(activeWorkspace?.id),
      },
    });

    invoke("terminal_start_agent_many", { requests: preparedWorkspaceTerminalRequests })
      .then((result) => {
        workspaceAgentBatchInFlightKeyRef.current = "";
        setWorkspaceAgentBatchSentKey(workspaceAgentLaunchKey);
        setWorkspaceAgentLaunchEpoch((epoch) => epoch + 1);
        preparedTerminalsRef.current.forEach((session, key) => {
          if (preparedWorkspaceTerminalRequests.some((request) => (
            request.paneId === session.paneId && request.instanceId === session.instanceId
          ))) {
            preparedTerminalsRef.current.delete(key);
          }
        });
        setPreparedTerminalVersion((version) => version + 1);
        writeTerminalTelemetry({
          paneId: activeWorkspace?.id || "",
          phase: "frontend.agent_launch.batch_done",
          elapsedMs: performance.now() - batchStartedAt,
          fields: {
            agentId: workspaceTerminalAgent?.id || "",
            preparedTerminalCount: preparedWorkspaceTerminalCount,
            started: result?.started ?? null,
            skipped: result?.skipped ?? null,
            terminalCount: activeWorkspaceVisibleTerminalCount,
            ...getWorkspaceOpenTelemetryFields(activeWorkspace?.id),
          },
        });
      })
      .catch((error) => {
        workspaceAgentBatchInFlightKeyRef.current = "";
        setWorkspaceAgentBatchSentKey(workspaceAgentLaunchKey);
        setWorkspaceAgentLaunchEpoch((epoch) => epoch + 1);
        preparedTerminalsRef.current.forEach((session, key) => {
          if (preparedWorkspaceTerminalRequests.some((request) => (
            request.paneId === session.paneId && request.instanceId === session.instanceId
          ))) {
            preparedTerminalsRef.current.delete(key);
          }
        });
        setPreparedTerminalVersion((version) => version + 1);
        writeTerminalTelemetry({
          paneId: activeWorkspace?.id || "",
          phase: "frontend.agent_launch.batch_error",
          elapsedMs: performance.now() - batchStartedAt,
          fields: {
            agentId: workspaceTerminalAgent?.id || "",
            error: getErrorMessage(error, "Unable to start terminal agents."),
            preparedTerminalCount: preparedWorkspaceTerminalCount,
            terminalCount: activeWorkspaceVisibleTerminalCount,
            ...getWorkspaceOpenTelemetryFields(activeWorkspace?.id),
          },
        });
      });
  }, [
    activeWorkspace?.id,
    activeWorkspaceTerminalIndexes,
    activeWorkspaceVisibleTerminalCount,
    preparedWorkspaceTerminalCount,
    preparedWorkspaceTerminalRequests,
    workspaceAgentBatchSentKey,
    workspaceAgentLaunchKey,
    workspaceTerminalAgent?.id,
  ]);

  useEffect(() => {
    setWorkspaceNameDraft(activeWorkspace?.name || "");
    setWorkspaceTerminalCountDraft(String(activeWorkspace ? activeWorkspaceTerminalCount : MIN_WORKSPACE_TERMINAL_COUNT));
    setWorkspaceRootDraft(activeWorkspaceRootDirectory);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspaceRootDirectory, activeWorkspaceTerminalCount, workspaceSettingsModalId]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || visibleView !== DEFAULT_WORKSPACE_VIEW
      || !activeWorkspace
      || shouldShowWorkspaceSetup
    ) {
      return;
    }

    writeTerminalTelemetry({
      paneId: activeWorkspace.id,
      phase: "frontend.workspace.terminals_surface_commit",
      fields: {
        activeView,
        agentId: workspaceTerminalAgent?.id || "",
        agentStatusState,
        hasAgent: Boolean(workspaceTerminalAgent),
        rootSelected: Boolean(activeWorkspaceRootDirectory),
        rowCount: terminalPanelRows.length,
        terminalCount: activeWorkspaceVisibleTerminalCount,
        terminalIndexes: activeWorkspaceTerminalIndexes,
        viewMotion,
        visibleView,
        workspaceState,
        workspaceSyncState,
        ...getWorkspaceOpenTelemetryFields(activeWorkspace.id),
      },
    });
  }, [
    activeView,
    activeWorkspace,
    activeWorkspaceRootDirectory,
    activeWorkspaceTerminalIndexes,
    activeWorkspaceVisibleTerminalCount,
    agentStatusState,
    authState,
    shouldShowWorkspaceSetup,
    terminalPanelRows.length,
    viewMotion,
    visibleView,
    workspaceState,
    workspaceSyncState,
    workspaceTerminalAgent,
  ]);

  const isConnectivityBlocked = authState !== "authenticated" && (apiState === "checking" || apiState === "offline");
  const shouldShowLaunchScreen = isLaunchScreenVisible || isConnectivityBlocked;
  const launchState = isConnectivityBlocked && apiState === "offline"
    ? "offline"
    : isConnectivityBlocked && apiState === "checking"
      ? "checking"
      : "loading";
  const launchStatus = launchState === "offline"
    ? "No internet connection"
    : launchState === "checking"
      ? "Checking connection..."
      : !authInitialized
        ? "Checking secure session..."
        : authState === "authenticated"
          ? "Preparing workspace..."
          : "Opening sign in...";
  const launchDetail = launchState === "offline"
    ? apiMessage
    : launchState === "checking"
      ? "Contacting the Diff Forge API before opening sign in."
      : !authInitialized
        ? "Validating this device before showing your workspace."
        : "Finishing the desktop handoff.";
  const isWindowExpanded = windowFrameState.isFullscreen || windowFrameState.isMaximized;
  const windowResizeLabel = isWindowExpanded ? "Restore" : "Maximize";
  const workspaceCloseReportedClosed = normalizeCloseCount(workspaceCloseState.closed);
  const workspaceCloseTotal = Math.max(normalizeCloseCount(workspaceCloseState.total), workspaceCloseReportedClosed);
  const workspaceCloseClosed = Math.min(workspaceCloseReportedClosed, workspaceCloseTotal);
  const workspaceCloseProgress = workspaceCloseTotal > 0
    ? Math.min(100, Math.round((workspaceCloseClosed / workspaceCloseTotal) * 100))
    : 0;
  const workspaceCloseTerminalLabel = workspaceCloseTotal === 1 ? "terminal" : "terminals";
  const isWorkspaceStartupOverlayVisible = workspaceState !== "ready"
    || shouldHoldWorkspaceRevealForTerminalBatch;

  return (
    <>
      <GlobalStyle />
      <AppFrame>
        <WindowTitleBar data-tauri-drag-region onMouseDown={handleTitleBarMouseDown}>
          <WindowTitle data-tauri-drag-region>
            <img src="/logo.webp" alt="" />
            <span>{BRAND_NAME}</span>
          </WindowTitle>
          <WindowControls aria-label="Window controls">
            <WindowControlButton
              aria-label="Minimize"
              data-window-control
              onClick={minimizeWindow}
              title="Minimize"
              type="button"
            >
              <TitleMinimizeIcon aria-hidden="true" />
            </WindowControlButton>
            <WindowControlButton
              aria-label={windowResizeLabel}
              data-window-control
              onClick={toggleMaximizeWindow}
              title={windowResizeLabel}
              type="button"
            >
              {isWindowExpanded ? (
                <TitleRestoreIcon aria-hidden="true" />
              ) : (
                <TitleMaximizeIcon aria-hidden="true" />
              )}
            </WindowControlButton>
            <WindowControlButton
              aria-label="Close"
              data-window-control
              data-variant="close"
              onClick={closeWindow}
              title="Close"
              type="button"
            >
              <TitleCloseIcon aria-hidden="true" />
            </WindowControlButton>
          </WindowControls>
        </WindowTitleBar>

        <AppContent>
          {shouldShowLaunchScreen ? (
            <SplashScreen aria-label={`${BRAND_NAME} is launching`} data-state={launchState}>
              <AmbientPanel data-position="left">
                <span>&gt; codex</span>
                <p>Analyzing codebase...</p>
                <p>Generating changes...</p>
              </AmbientPanel>
              <AmbientPanel data-position="right">
                <span>src/engine/runner.ts</span>
                <p>+ return output</p>
                <p>- return result</p>
              </AmbientPanel>
              <SplashCenter>
                <SplashLogo src="/logo.webp" alt="" />
                <SplashTitle>{BRAND_NAME}</SplashTitle>
                <SplashTagline>Manage Codex & Claude Code. Build faster.</SplashTagline>
                <LoadingTrack aria-hidden="true" data-state={launchState}>
                  {launchState !== "offline" && <LoadingFill />}
                </LoadingTrack>
                <LaunchStatusPanel data-state={launchState}>
                  <LaunchStatusIcon aria-hidden="true" data-state={launchState}>
                    {launchState === "offline" ? (
                      <ErrorIcon />
                    ) : launchState === "checking" ? (
                      <PendingIcon />
                    ) : (
                      <ConnectedIcon />
                    )}
                  </LaunchStatusIcon>
                  <LaunchStatusCopy>
                    <LoadingText>{launchStatus}</LoadingText>
                    <LoadingDetail>{launchDetail}</LoadingDetail>
                  </LaunchStatusCopy>
                </LaunchStatusPanel>
                {launchState === "offline" && (
                  <LaunchActions>
                    <SecondaryButton disabled={apiState === "checking"} onClick={checkBackend} type="button">
                      <ButtonRefreshIcon aria-hidden="true" />
                      <span>Retry connection</span>
                    </SecondaryButton>
                  </LaunchActions>
                )}
              </SplashCenter>
            </SplashScreen>
          ) : authState === "authenticated" && !userIsPaid ? (
            <PricingScreen aria-label="Desktop pricing">
              <PricingHero>
                <BrandMark as="div" aria-label="Diffforge">
                  <img src="/logo.webp" alt="" />
                  <strong>Diffforge</strong>
                </BrandMark>
                <PricingCopy>
                  <Kicker>Plan required</Kicker>
                  <PricingTitle>Upgrade to unlock the desktop workspace</PricingTitle>
                  <PricingText>
                    You are signed in as {displayName}. Free accounts can review pricing here,
                    but the desktop dashboard stays locked until your plan is paid.
                  </PricingText>
                </PricingCopy>
                <PricingActions>
                  <PrimaryButton onClick={openPricing} type="button">
                    <ButtonBrowserIcon aria-hidden="true" />
                    <span>Open pricing</span>
                  </PrimaryButton>
                  <SecondaryButton onClick={refreshSubscriptionStatus} type="button">
                    <ButtonRefreshIcon aria-hidden="true" />
                    <span>Check status</span>
                  </SecondaryButton>
                  <SecondaryButton onClick={logout} type="button">
                    <ButtonLogoutIcon aria-hidden="true" />
                    <span>Sign out</span>
                  </SecondaryButton>
                </PricingActions>
                {authError && <FormMessage $state="error">{authError}</FormMessage>}
              </PricingHero>

              <PricingPlans aria-label="Plans">
                <PricingPlanCard>
                  <PlanEyebrow>{planLabel}</PlanEyebrow>
                  <PlanPrice>$0</PlanPrice>
                  <PlanDescription>Browser login, pricing access, and account setup.</PlanDescription>
                  <PlanFeatureList>
                    <li>Web account login</li>
                    <li>Pricing and billing status</li>
                    <li>Desktop dashboard locked</li>
                  </PlanFeatureList>
                </PricingPlanCard>

                <PricingPlanCard data-featured="true">
                  <PlanEyebrow>Pro</PlanEyebrow>
                  <PlanPrice>
                    $25<span>/mo</span>
                  </PlanPrice>
                  <PlanDescription>Paid status unlocks the native dashboard shell.</PlanDescription>
                  <PlanFeatureList>
                    <li>Desktop workspace dashboard</li>
                    <li>Blank desktop workspace shell</li>
                    <li>Priority native app access</li>
                  </PlanFeatureList>
                </PricingPlanCard>
              </PricingPlans>
            </PricingScreen>
          ) : authState === "authenticated" ? (
            <AuthenticatedWorkspaceFrame>
              <DashboardShell
                aria-hidden={isWorkspaceStartupOverlayVisible}
                data-startup={isWorkspaceStartupOverlayVisible}
              >
              <WorkspaceRail aria-label="Workspace navigation">
                <RailTop>
                  <RailSectionTitle>Workspaces</RailSectionTitle>
                  <WorkspaceList>
                    {workspaces.map((workspace) => {
                      const workspaceRoot = getWorkspaceRootDirectory(workspaceSettings, workspace.id);

                      return (
                        <WorkspaceRow data-active={workspace.id === activeWorkspaceId} key={workspace.id}>
                          <WorkspaceButton
                            data-active={workspace.id === activeWorkspaceId}
                            onClick={() => {
                              startWorkspaceOpenTelemetry({
                                source: "workspace_click",
                                workspaceId: workspace.id,
                                fields: {
                                  activeView,
                                  fromWorkspaceId: activeWorkspaceId,
                                  visibleView,
                                  workspaceCount: workspaces.length,
                                },
                              });
                              setActiveWorkspaceId(workspace.id);
                            }}
                            title={workspace.name}
                            type="button"
                          >
                            <WorkspaceAccent aria-hidden="true" />
                            <WorkspaceLabel>
                              <strong>{workspace.name}</strong>
                              <span>{getDirectoryName(workspaceRoot || defaultWorkingDirectory)}</span>
                            </WorkspaceLabel>
                          </WorkspaceButton>
                          <WorkspaceSettingsButton
                            aria-label={`Open settings for ${workspace.name}`}
                            onClick={() => openWorkspaceSettings(workspace.id)}
                            title="Workspace settings"
                            type="button"
                          >
                            <ButtonSettingsIcon aria-hidden="true" />
                          </WorkspaceSettingsButton>
                        </WorkspaceRow>
                      );
                    })}
                    {workspaceSyncState === "loading" && (
                      <WorkspaceMuted>Loading...</WorkspaceMuted>
                    )}
                  </WorkspaceList>
                </RailTop>

                <RailFooter>
                  <RailActionButton
                    data-active={activeView === DEFAULT_WORKSPACE_VIEW}
                    onClick={() => showView(DEFAULT_WORKSPACE_VIEW)}
                    type="button"
                  >
                    <ButtonTerminalIcon aria-hidden="true" />
                    <span>Terminals</span>
                  </RailActionButton>
                  <RailActionButton
                    data-active={activeView === "files"}
                    onClick={() => showView("files")}
                    type="button"
                  >
                    <ButtonFolderIcon aria-hidden="true" />
                    <span>Files</span>
                  </RailActionButton>
                  <RailActionButton
                    data-active={activeView === "vault"}
                    onClick={() => showView("vault")}
                    type="button"
                  >
                    <ButtonKeyIcon aria-hidden="true" />
                    <span>Vault</span>
                  </RailActionButton>
                  <RailActionButton
                    data-active={activeView === "audio"}
                    onClick={() => showView("audio")}
                    type="button"
                  >
                    <ButtonMicIcon aria-hidden="true" />
                    <span>Audio</span>
                  </RailActionButton>
                  <RailActionButton
                    data-active={activeView === "mcps"}
                    onClick={() => showView("mcps")}
                    type="button"
                  >
                    <ButtonHubIcon aria-hidden="true" />
                    <span>MCPs</span>
                  </RailActionButton>
                  <RailActionButton
                    data-active={activeView === "settings"}
                    onClick={() => showView("settings")}
                    type="button"
                  >
                    <ButtonSettingsIcon aria-hidden="true" />
                    <span>Settings</span>
                  </RailActionButton>
                  <RailActionButton onClick={logout} type="button">
                    <ButtonLogoutIcon aria-hidden="true" />
                    <span>Sign out</span>
                  </RailActionButton>
                </RailFooter>
              </WorkspaceRail>

              {visibleView === "settings" ? (
                <SettingsPage data-motion={viewMotion}>
                  <PageHeader>
                    <div>
                      <Kicker>Settings</Kicker>
                      <DashboardTitle>Desktop settings</DashboardTitle>
                      <PageSubline>Terminal providers and verified account state for this device.</PageSubline>
                    </div>
                    <SecondaryButton onClick={() => showView(DEFAULT_WORKSPACE_VIEW)} type="button">
                      <ConnectedIcon aria-hidden="true" />
                      <span>Back</span>
                    </SecondaryButton>
                  </PageHeader>

                  <AgentSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Terminal providers</PanelKicker>
                        <PanelHeading>Codex and Claude Code</PanelHeading>
                      </div>
                      <AgentPanelActions>
                        <AgentReadyPill data-tone={connectedAgentCount > 0 ? "blue" : "orange"}>
                          <ButtonBotIcon aria-hidden="true" />
                          <span>{connectedAgentCount}/2 ready</span>
                        </AgentReadyPill>
                        <SecondaryButton disabled={agentStatusState === "checking"} onClick={refreshAgentStatuses} type="button">
                          <ButtonRefreshIcon aria-hidden="true" />
                          <span>{agentStatusState === "checking" ? "Checking..." : "Recheck"}</span>
                        </SecondaryButton>
                      </AgentPanelActions>
                    </PanelHeaderRow>

                    {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}

                    <AgentCardGrid>
                      {agentStatuses.map((agent) => {
                        const installResult = agentInstallResults[agent.id];
                        const actionResult = agentActionResults[agent.id];
                        const isInstallingAgent = agentInstallState[agent.id] === "installing";
                        const isUpdatingAgent = agentInstallState[agent.id] === "updating";
                        const isPackageActionBusy = isInstallingAgent || isUpdatingAgent;
                        const isDisconnectingAgent = agentDisconnectState[agent.id] === "disconnecting";
                        const needsInstallMessage = `${agent.label} needs to be installed before this action.`;
                        const authActionDisabled = !agent.installed || agentStatusState === "checking" || isDisconnectingAgent;
                        const useDisabled = !agent.installed;
                        const authActionTitle = !agent.installed
                          ? needsInstallMessage
                          : isDisconnectingAgent
                            ? `Disconnecting ${agent.label}.`
                          : agentStatusState === "checking"
                            ? "Checking terminal CLI status."
                            : agent.authenticated
                              ? `Disconnect ${agent.label} from this machine.`
                              : `Connect ${agent.label}`;
                        const useTitle = !agent.installed ? needsInstallMessage : `Use ${agent.label}`;
                        const npmInstallLabel = isInstallingAgent
                          ? "Installing..."
                          : installResult?.source === "npm" && !installResult.installed
                            ? "Retry npm install"
                            : agent.installed
                              ? "Update with npm"
                              : "Install with npm";
                        const npmUpdateLabel = isUpdatingAgent
                          ? "Updating..."
                          : installResult?.source === "npm-update" && installResult.permissionDenied
                            ? "Retry update"
                            : "Update with npm";
                        const installMessageTone = installResult?.installed
                          ? "success"
                          : installResult?.permissionDenied
                            ? "warning"
                            : "neutral";

                        return (
                          <AgentCard data-tone={getAgentTone(agent)} key={agent.id}>
                            <AgentCardHeader>
                              <AgentIcon data-tone={getAgentTone(agent)}>
                                {agent.id === "codex" ? <ButtonCodeIcon aria-hidden="true" /> : <ButtonBotIcon aria-hidden="true" />}
                              </AgentIcon>
                              <div>
                                <AgentName>{agent.label}</AgentName>
                                <AgentMeta>{agent.version}</AgentMeta>
                              </div>
                            </AgentCardHeader>
                            <AgentStatusText>{agent.authMessage}</AgentStatusText>

                            {!agent.installed && (
                              <AgentInstallPanel>
                                <AgentInstallTopline>
                                  <span>{agent.nativeInstallLabel}</span>
                                  <AgentInstallBadge>Recommended</AgentInstallBadge>
                                </AgentInstallTopline>
                                <AgentInstallHint>
                                  {agent.npmAvailable
                                    ? `npm ${agent.npmVersion} detected. Native install is still preferred.`
                                    : "npm was not detected. Use the native installer path."}
                                </AgentInstallHint>
                                <AgentInstallActions>
                                  <PrimaryButton onClick={() => openAgentNativeInstaller(agent)} type="button">
                                    <ButtonBrowserIcon aria-hidden="true" />
                                    <span>Native installer</span>
                                  </PrimaryButton>
                                  {agent.npmAvailable && (
                                    <SecondaryButton
                                      disabled={isPackageActionBusy}
                                      onClick={() => installAgentWithNpm(agent.id)}
                                      type="button"
                                    >
                                      {isInstallingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonTerminalIcon aria-hidden="true" />}
                                      <span>{npmInstallLabel}</span>
                                    </SecondaryButton>
                                  )}
                                </AgentInstallActions>
                                {agent.npmAvailable && <AgentInstallCommand>{agent.installCommand}</AgentInstallCommand>}
                                {installResult?.permissionDenied && (
                                  <AgentPermissionHint>
                                    Close running terminals, then retry from an elevated app/terminal or move npm global packages to a user-writable prefix.
                                  </AgentPermissionHint>
                                )}
                                {installResult?.message && (
                                  <AgentInstallMessage data-tone={installMessageTone}>
                                    {installResult.message}
                                  </AgentInstallMessage>
                                )}
                              </AgentInstallPanel>
                            )}

                            {agent.installed && agent.npmAvailable && (
                              <AgentInstallPanel>
                                <AgentInstallTopline>
                                  <span>npm package</span>
                                  <AgentInstallBadge>Update</AgentInstallBadge>
                                </AgentInstallTopline>
                                <AgentInstallHint>
                                  Updates use your global npm prefix. Permission errors usually mean old package folders were created by an elevated process or are still locked.
                                </AgentInstallHint>
                                <AgentInstallActions>
                                  <SecondaryButton
                                    disabled={isPackageActionBusy}
                                    onClick={() => updateAgentWithNpm(agent.id)}
                                    type="button"
                                  >
                                    {isUpdatingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                                    <span>{npmUpdateLabel}</span>
                                  </SecondaryButton>
                                </AgentInstallActions>
                                <AgentInstallCommand>{agent.installCommand}</AgentInstallCommand>
                                {installResult?.permissionDenied && (
                                  <AgentPermissionHint>
                                    Close running terminals, then retry from an elevated app/terminal or move npm global packages to a user-writable prefix.
                                  </AgentPermissionHint>
                                )}
                                {installResult?.message && (
                                  <AgentInstallMessage data-tone={installMessageTone}>
                                    {installResult.message}
                                  </AgentInstallMessage>
                                )}
                              </AgentInstallPanel>
                            )}

                            <AgentActions>
                              {agent.authenticated ? (
                                <AgentActionTooltip title={authActionTitle}>
                                  <PrimaryDangerButton
                                    disabled={authActionDisabled}
                                    onClick={() => disconnectAgent(agent.id)}
                                    title={authActionTitle}
                                    type="button"
                                  >
                                    {isDisconnectingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonLogoutIcon aria-hidden="true" />}
                                    <span>{isDisconnectingAgent ? "Disconnecting..." : "Disconnect"}</span>
                                  </PrimaryDangerButton>
                                </AgentActionTooltip>
                              ) : (
                                <AgentActionTooltip title={authActionTitle}>
                                  <SecondaryButton
                                    disabled={authActionDisabled}
                                    onClick={() => connectAgent(agent.id)}
                                    title={authActionTitle}
                                    type="button"
                                  >
                                    <ButtonKeyIcon aria-hidden="true" />
                                    <span>Connect</span>
                                  </SecondaryButton>
                                </AgentActionTooltip>
                              )}
                              <AgentActionTooltip title={useTitle}>
                                <SecondaryButton
                                  disabled={useDisabled}
                                  onClick={() => {
                                    setActiveAgent(agent.id);
                                    showView(DEFAULT_WORKSPACE_VIEW);
                                  }}
                                  title={useTitle}
                                  type="button"
                                >
                                  <ButtonTerminalIcon aria-hidden="true" />
                                  <span>Use</span>
                                </SecondaryButton>
                              </AgentActionTooltip>
                            </AgentActions>
                            {actionResult?.message && (
                              <AgentInstallMessage data-tone={actionResult.tone || "neutral"}>
                                {actionResult.message}
                              </AgentInstallMessage>
                            )}
                          </AgentCard>
                        );
                      })}
                    </AgentCardGrid>
                  </AgentSettingsPanel>

                  <AccountSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Account info</PanelKicker>
                        <PanelHeading>Signed-in desktop account</PanelHeading>
                      </div>
                    </PanelHeaderRow>

                    <AccountCard data-tone="blue">
                      <AccountCardHeader>
                        <div>
                          <SettingsLabel>Account</SettingsLabel>
                          <SettingsValue>{displayName}</SettingsValue>
                          <SettingsHint>Server-returned desktop session user.</SettingsHint>
                        </div>
                        <AgentReadyPill data-tone={connectedAgentCount > 0 ? "blue" : "orange"}>
                          <ButtonBotIcon aria-hidden="true" />
                          <span>{connectedAgentCount}/2 ready</span>
                        </AgentReadyPill>
                      </AccountCardHeader>

                      <SettingsIdentityGrid>
                        <SettingsIdentityItem>
                          <span>Email</span>
                          <strong>{user?.email || "Not returned"}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Plan</span>
                          <strong>{planLabel}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Session</span>
                          <strong>Device active</strong>
                        </SettingsIdentityItem>
                      </SettingsIdentityGrid>

                      <AccountCardFooter>
                        <SettingsHint>Signing out clears this device session.</SettingsHint>
                        <PrimaryDangerButton onClick={logout} type="button">
                          <ButtonLogoutIcon aria-hidden="true" />
                          <span>Sign out</span>
                        </PrimaryDangerButton>
                      </AccountCardFooter>
                    </AccountCard>
                  </AccountSettingsPanel>
                </SettingsPage>
              ) : visibleView === "files" ? (
                <ForgeWorkspace aria-label="Workspace files" data-motion={viewMotion}>
                  {shouldShowWorkspaceSetup ? (
                    <WorkspaceSetupPanel onSubmit={createFirstWorkspace}>
                      <SetupHeader>
                        <Kicker>First workspace</Kicker>
                        <DashboardTitle>Create your workspace</DashboardTitle>
                        <PageSubline>Name it, then the workspace syncs through the protected API.</PageSubline>
                      </SetupHeader>
                      {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
                      <SetupField>
                        <SettingsLabel>Workspace name</SettingsLabel>
                        <SetupInput
                          maxLength={80}
                          onChange={(event) => setWorkspaceName(event.target.value)}
                          placeholder="My workspace"
                          value={workspaceName}
                        />
                      </SetupField>
                      <PrimaryButton disabled={workspaceSyncState === "creating"} type="submit">
                        <ButtonForgeIcon aria-hidden="true" />
                        <span>{workspaceSyncState === "creating" ? "Creating..." : "Create workspace"}</span>
                      </PrimaryButton>
                    </WorkspaceSetupPanel>
                  ) : (
                    <FilesWorkspaceView
                      defaultWorkingDirectory={defaultWorkingDirectory}
                      onOpenWorkspaceSettings={openActiveWorkspaceSettings}
                      rootDirectory={activeWorkspaceFileRoot}
                      workspace={activeWorkspace}
                      workspaceError={workspaceError}
                    />
                  )}
                </ForgeWorkspace>
              ) : visibleView === "vault" ? (
                <ForgeWorkspace aria-label="Workspace vault" data-motion={viewMotion}>
                  <VaultWorkspaceView
                    onOpenSettings={() => showView("settings")}
                    workspace={activeWorkspace}
                  />
                </ForgeWorkspace>
              ) : visibleView === "audio" ? (
                <ForgeWorkspace aria-label="Workspace audio" data-motion={viewMotion}>
                  <AudioWorkspaceView
                    audioActionState={audioActionState}
                    audioDownloadProgress={audioDownloadProgress}
                    audioError={audioError}
                    audioModelStatus={audioModelStatus}
                    audioStatusState={audioStatusState}
                    onDownloadModel={downloadAudioModel}
                    onOpenWidget={openAudioWidget}
                    onRefreshStatus={refreshAudioModelStatus}
                    workspace={activeWorkspace}
                  />
                </ForgeWorkspace>
              ) : visibleView === "mcps" ? (
                <ForgeWorkspace aria-label="Workspace MCPs" data-motion={viewMotion}>
                  <McpsWorkspaceView
                    agentStatuses={agentStatuses}
                    workspace={activeWorkspace}
                    workspaces={workspaces}
                  />
                </ForgeWorkspace>
              ) : (
                <>
                  <ForgeWorkspace aria-label="Forge workspace" data-motion={viewMotion}>
                    {shouldShowWorkspaceSetup ? (
                      <WorkspaceSetupPanel onSubmit={createFirstWorkspace}>
                        <SetupHeader>
                          <Kicker>First workspace</Kicker>
                          <DashboardTitle>Create your workspace</DashboardTitle>
                          <PageSubline>Name it, then the workspace syncs through the protected API.</PageSubline>
                        </SetupHeader>
                        {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
                        <SetupField>
                          <SettingsLabel>Workspace name</SettingsLabel>
                          <SetupInput
                            maxLength={80}
                            onChange={(event) => setWorkspaceName(event.target.value)}
                            placeholder="My workspace"
                            value={workspaceName}
                          />
                        </SetupField>
                        <PrimaryButton disabled={workspaceSyncState === "creating"} type="submit">
                          <ButtonForgeIcon aria-hidden="true" />
                          <span>{workspaceSyncState === "creating" ? "Creating..." : "Create workspace"}</span>
                        </PrimaryButton>
                      </WorkspaceSetupPanel>
                    ) : (
                      activeWorkspace && workspaceTerminalRenderAgent ? (
                        <WorkspaceTerminalPanels>
                          <ResizePanelGroup
                            id={`workspace-terminal-rows-${activeWorkspace.id}`}
                            orientation="vertical"
                          >
                            {terminalPanelRows.map((row, rowOrderIndex) => (
                              <Fragment key={`row-${row.rowIndex}`}>
                                {rowOrderIndex > 0 && (
                                  <ResizeHandle
                                    data-direction="vertical"
                                  />
                                )}
                                <ResizePanel
                                  data-terminal-row="true"
                                  defaultSize={`${100 / terminalPanelRows.length}%`}
                                  id={`workspace-terminal-row-${activeWorkspace.id}-${row.rowIndex}`}
                                  minSize={getTerminalPaneMinSizePercent(terminalPanelRows.length)}
                                >
                                  <ResizePanelGroup
                                    id={`workspace-terminal-cols-${activeWorkspace.id}-${row.rowIndex}`}
                                    orientation="horizontal"
                                  >
                                    {row.terminalIndexes.map((terminalIndex, columnIndex) => (
                                      <Fragment key={`${activeWorkspace.id}-${terminalIndex}`}>
                                        {columnIndex > 0 && (
                                          <ResizeHandle
                                            data-direction="horizontal"
                                          />
                                        )}
                                        <ResizePanel
                                          data-terminal-column="true"
                                          data-terminal-leaf="true"
                                          defaultSize={`${100 / row.terminalIndexes.length}%`}
                                          id={`workspace-terminal-col-${activeWorkspace.id}-${terminalIndex}`}
                                          minSize={getTerminalPaneMinSizePercent(row.terminalIndexes.length)}
                                        >
                                          <WorkspaceTerminal
                                            agent={workspaceTerminalRenderAgent}
                                            agentLaunchEpoch={workspaceAgentLaunchEpoch}
                                            agentLaunchReady={workspaceTerminalAgentLaunchReady}
                                            agentStatuses={agentStatuses}
                                            agentStatusError={agentStatusError}
                                            agentStatusState={agentStatusState}
                                            onCloseTerminal={closeWorkspaceTerminal}
                                            onOpenSettings={() => showView("settings")}
                                            onPreparedTerminalChange={handlePreparedTerminalChange}
                                            onRecheckAgents={refreshAgentStatuses}
                                            prewarmShell={shouldPrewarmWorkspaceTerminals}
                                            terminalCount={activeWorkspaceVisibleTerminalCount}
                                            terminalIndex={terminalIndex}
                                            workingDirectory={activeWorkspaceAgentWorkingDirectory}
                                            workspace={activeWorkspace}
                                            workspaceError={workspaceError}
                                          />
                                        </ResizePanel>
                                      </Fragment>
                                    ))}
                                  </ResizePanelGroup>
                                </ResizePanel>
                              </Fragment>
                            ))}
                          </ResizePanelGroup>
                        </WorkspaceTerminalPanels>
                      ) : (
                        <WorkspaceTerminal
                          agent={activeWorkspace ? workspaceTerminalRenderAgent : null}
                          agentLaunchEpoch={workspaceAgentLaunchEpoch}
                          agentLaunchReady={workspaceTerminalAgentLaunchReady}
                          agentStatuses={agentStatuses}
                          agentStatusError={agentStatusError}
                          agentStatusState={agentStatusState}
                          onCloseTerminal={closeWorkspaceTerminal}
                          onOpenSettings={() => showView("settings")}
                          onPreparedTerminalChange={handlePreparedTerminalChange}
                          onRecheckAgents={refreshAgentStatuses}
                          prewarmShell={activeWorkspace ? shouldPrewarmWorkspaceTerminals : false}
                          terminalCount={activeWorkspaceVisibleTerminalCount}
                          terminalIndex={activeWorkspaceTerminalIndexes[0] || 0}
                          workingDirectory={activeWorkspaceAgentWorkingDirectory}
                          workspace={activeWorkspace}
                          workspaceError={workspaceError}
                        />
                      )
                    )}
                    {!shouldShowWorkspaceSetup && <TerminalDevMetrics metrics={terminalMetrics} />}
                  </ForgeWorkspace>
                </>
              )}
              {isWorkspaceSettingsOpen && (
                <WorkspaceSettingsOverlay
                  aria-label="Workspace settings modal"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) {
                      closeWorkspaceSettings();
                    }
                  }}
                >
                  <WorkspaceSettingsDialog
                    aria-labelledby="workspace-settings-title"
                    aria-modal="true"
                    role="dialog"
                  >
                    <WorkspaceSettingsDialogHeader>
                      <div>
                        <PanelKicker>Workspace settings</PanelKicker>
                        <PanelHeading id="workspace-settings-title">{activeWorkspace.name}</PanelHeading>
                      </div>
                      <WorkspaceModalCloseButton
                        aria-label="Close workspace settings"
                        onClick={closeWorkspaceSettings}
                        title="Close"
                        type="button"
                      >
                        <ButtonCloseIcon aria-hidden="true" />
                      </WorkspaceModalCloseButton>
                    </WorkspaceSettingsDialogHeader>

                    <WorkspaceSettingsForm onSubmit={saveWorkspaceSettings}>
                      <SetupField>
                        <SettingsLabel>Name</SettingsLabel>
                        <WorkspaceSettingsInput
                          maxLength={80}
                          onChange={(event) => {
                            setWorkspaceNameDraft(event.target.value);
                            setWorkspaceSettingsError("");
                            setWorkspaceSettingsMessage("");
                          }}
                          value={workspaceNameDraft}
                        />
                      </SetupField>

                      <WorkspaceSettingsFieldGrid>
                        <SetupField>
                          <SettingsLabel>Terminals</SettingsLabel>
                          <WorkspaceNumberInput
                            max={MAX_WORKSPACE_TERMINAL_COUNT}
                            min={MIN_WORKSPACE_TERMINAL_COUNT}
                            onChange={(event) => {
                              setWorkspaceTerminalCountDraft(event.target.value);
                              setWorkspaceSettingsError("");
                              setWorkspaceSettingsMessage("");
                            }}
                            step="1"
                            type="number"
                            value={workspaceTerminalCountDraft}
                          />
                        </SetupField>

                        <SetupField>
                          <SettingsLabel>Root directory</SettingsLabel>
                          <RootDirectoryInput
                            maxLength={MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH}
                            onChange={(event) => {
                              setWorkspaceRootDraft(event.target.value);
                              setWorkspaceSettingsError("");
                              setWorkspaceSettingsMessage("");
                            }}
                            placeholder={defaultWorkingDirectory || "C:\\path\\to\\project"}
                            value={workspaceRootDraft}
                          />
                        </SetupField>
                      </WorkspaceSettingsFieldGrid>

                      <SettingsHint>{activeWorkspaceRootDisplay}</SettingsHint>

                      <WorkspaceSettingsActions>
                        <SecondaryButton
                          disabled={!defaultWorkingDirectory || workspaceSettingsState === "saving"}
                          onClick={useDefaultWorkspaceRoot}
                          type="button"
                        >
                          <ButtonFolderIcon aria-hidden="true" />
                          <span>Use app dir</span>
                        </SecondaryButton>
                        <PrimaryButton disabled={workspaceSettingsState === "saving"} type="submit">
                          <ButtonCheckIcon aria-hidden="true" />
                          <span>{workspaceSettingsState === "saving" ? "Saving..." : "Save"}</span>
                        </PrimaryButton>
                      </WorkspaceSettingsActions>
                    </WorkspaceSettingsForm>

                    {workspaceSettingsError && <FormMessage $state="error">{workspaceSettingsError}</FormMessage>}
                    {workspaceSettingsMessage && <AgentInstallMessage data-tone="success">{workspaceSettingsMessage}</AgentInstallMessage>}
                  </WorkspaceSettingsDialog>
                </WorkspaceSettingsOverlay>
              )}
              </DashboardShell>
              {isWorkspaceStartupOverlayVisible && (
                <WorkspaceStartupOverlay aria-label={`${BRAND_NAME} is initializing workspace`}>
                  <AmbientPanel data-position="left">
                    <span>&gt; workspace</span>
                    <p>Syncing session...</p>
                    <p>Preparing workspace...</p>
                  </AmbientPanel>
                  <AmbientPanel data-position="right">
                    <span>{displayName}</span>
                    <p>Terminals ready</p>
                    <p>Workspace ready</p>
                  </AmbientPanel>
                  <SplashCenter>
                    <SplashLogo src="/logo.webp" alt="" />
                    <SplashTitle>Welcome back</SplashTitle>
                    <SplashTagline>{displayName}</SplashTagline>
                    <LoadingTrack aria-hidden="true">
                      <LoadingFill />
                    </LoadingTrack>
                    <LaunchStatusPanel data-state={startupAgentStatusState}>
                      <LaunchStatusIcon aria-hidden="true" data-state={startupAgentStatusState}>
                        {startupAgentGateState === "choice" ? (
                          <ButtonRefreshIcon />
                        ) : startupAgentGateState === "checking" || startupAgentGateState === "updating" ? (
                          <PendingIcon />
                        ) : connectedAgentCount > 0 ? (
                          <ConnectedIcon />
                        ) : (
                          <ErrorIcon />
                        )}
                      </LaunchStatusIcon>
                      <LaunchStatusCopy>
                        <LoadingText>{startupAgentStatusTitle}</LoadingText>
                        <LoadingDetail>{startupAgentStatusDetail}</LoadingDetail>
                      </LaunchStatusCopy>
                    </LaunchStatusPanel>
                    {startupAgentGateState === "choice" && (
                      <LaunchActions data-layout="split">
                        <PrimaryButton onClick={updateStartupAgents} type="button">
                          <ButtonRefreshIcon aria-hidden="true" />
                          <span>Update first</span>
                        </PrimaryButton>
                        <SecondaryButton onClick={enterWorkspaceAfterAgentCheck} type="button">
                          <ConnectedIcon aria-hidden="true" />
                          <span>Enter workspace</span>
                        </SecondaryButton>
                      </LaunchActions>
                    )}
                  </SplashCenter>
                </WorkspaceStartupOverlay>
              )}
            </AuthenticatedWorkspaceFrame>
          ) : (
            <LoginScreen>
              <AuthSquareBackdrop />
              <LoginLayout>
                <BrandPanel aria-labelledby="desktop-title">
                  <BrandMark href="#" aria-label={BRAND_NAME}>
                    <img src="/logo.webp" alt="" />
                    <strong>{BRAND_NAME}</strong>
                  </BrandMark>

                  <IntroCopy>
                    <Kicker>Web sign in</Kicker>
                    <Headline id="desktop-title">Sign in to {BRAND_NAME}</Headline>
                    <Lede>
                      Use your browser for secure {BRAND_NAME} authentication, then return to this native app.
                    </Lede>
                    <IntroFeatureList aria-label="Desktop auth status">
                      <IntroFeature data-tone="blue">
                        <span />
                        Browser handoff
                      </IntroFeature>
                      <IntroFeature data-tone="orange">
                        <span />
                        Deep-link callback
                      </IntroFeature>
                      <IntroFeature>
                        <span />
                        Server session check
                      </IntroFeature>
                    </IntroFeatureList>
                  </IntroCopy>
                </BrandPanel>

                <LoginCard aria-label="Desktop sign in">
                  <LoginPanel>
                    <LoginCardTop>
                      <PanelKicker>Native app access</PanelKicker>
                      <LoginCardBadge data-state={authState}>{authStateLabel}</LoginCardBadge>
                    </LoginCardTop>
                    <LoginIconWrap aria-hidden="true">
                      {isAuthBusy ? <PendingIcon /> : <ButtonLoginIcon />}
                    </LoginIconWrap>
                    <SessionTitle>{authPanelTitle}</SessionTitle>
                    <SessionText>{authMessage}</SessionText>
                    {authError && <FormMessage $state="error">{authError}</FormMessage>}
                    <AuthStepRail aria-label="Desktop sign in checkpoints">
                      {AUTH_STEPS.map((step, index) => (
                        <AuthStep data-active={index === 0 || isAuthBusy} key={step}>
                          <span>{index + 1}</span>
                          <strong>{step}</strong>
                        </AuthStep>
                      ))}
                    </AuthStepRail>
                    <PrimaryButton disabled={isAuthBusy} onClick={startWebLogin} type="button">
                      <ButtonBrowserIcon aria-hidden="true" />
                      <span>{authButtonLabel}</span>
                    </PrimaryButton>
                  </LoginPanel>
                </LoginCard>
              </LoginLayout>
            </LoginScreen>
          )}
        </AppContent>

        {workspaceCloseState.isActive && (
          <WorkspaceCloseOverlay aria-live="polite" role="status">
            <WorkspaceClosePanel aria-label="Closing workspace">
              <WorkspaceCloseSpinner aria-hidden="true" />
              <WorkspaceCloseTitle>Closing workspace</WorkspaceCloseTitle>
              <WorkspaceCloseDetail>
                Shutting down terminals before closing {BRAND_NAME}.
              </WorkspaceCloseDetail>
              <WorkspaceCloseCounter>
                {workspaceCloseClosed} / {workspaceCloseTotal} {workspaceCloseTerminalLabel} closed
              </WorkspaceCloseCounter>
              <WorkspaceCloseProgressTrack aria-hidden="true">
                <WorkspaceCloseProgressBar $progress={workspaceCloseProgress} />
              </WorkspaceCloseProgressTrack>
            </WorkspaceClosePanel>
          </WorkspaceCloseOverlay>
        )}
      </AppFrame>
    </>
  );
}

const GlobalStyle = createGlobalStyle`
  :root {
    color: #f7f9ff;
    background: #030508;
    color-scheme: dark;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }

  * {
    box-sizing: border-box;
    scrollbar-color: rgba(98, 160, 255, 0.72) rgba(6, 9, 16, 0.72);
    scrollbar-width: thin;
  }

  *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  *::-webkit-scrollbar-track {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
      rgba(6, 9, 16, 0.76);
  }

  *::-webkit-scrollbar-thumb {
    min-height: 42px;
    border: 2px solid rgba(6, 9, 16, 0.88);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(98, 160, 255, 0.9), rgba(47, 128, 255, 0.56) 48%, rgba(255, 122, 24, 0.72)),
      #2f80ff;
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-thumb:hover {
    background:
      linear-gradient(180deg, #8bb9ff, rgba(98, 160, 255, 0.72) 46%, #ff9a3d),
      #62a0ff;
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-corner {
    background: rgba(6, 9, 16, 0.76);
  }

  html,
  body,
  #app {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
    background: #030508;
  }

  body {
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(47, 128, 255, 0.1), rgba(3, 5, 8, 0) 34rem),
      linear-gradient(135deg, rgba(255, 122, 24, 0.08), rgba(3, 5, 8, 0) 28rem),
      #030508;
  }

  button {
    cursor: pointer;
    font: inherit;
  }

  button:disabled {
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.001ms !important;
    }
  }
`;

const AppFrame = styled.div`
  display: grid;
  min-width: 320px;
  min-height: 100vh;
  grid-template-rows: ${TITLE_BAR_HEIGHT} minmax(0, 1fr);
  background: #030508;
`;

const WindowTitleBar = styled.header`
  display: grid;
  height: ${TITLE_BAR_HEIGHT};
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #e8eef8;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    #060910;
  user-select: none;
`;

const WindowTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  color: #eaf0f5;
  font-size: 12px;
  font-weight: 820;

  img {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WindowControls = styled.div`
  display: inline-flex;
  height: 100%;
  align-items: stretch;
`;

const WindowControlButton = styled.button`
  display: grid;
  width: 46px;
  height: 100%;
  place-items: center;
  border: 0;
  border-radius: 0;
  color: #c9d2dc;
  background: transparent;

  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.09);
  }

  &[data-variant="close"]:hover {
    color: #ffffff;
    background: #d83b32;
  }
`;

const AppContent = styled.div`
  min-height: 0;
  overflow: auto;
  background:
    linear-gradient(180deg, rgba(47, 128, 255, 0.1) 0%, rgba(3, 5, 8, 0) 34rem),
    linear-gradient(135deg, rgba(255, 122, 24, 0.08) 0%, rgba(3, 5, 8, 0) 28rem),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    #030508;
  background-size: auto, auto, 96px 96px, 96px 96px, auto;
`;

const workspaceCloseSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const WorkspaceCloseOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  min-width: 320px;
  place-items: center;
  padding: 22px;
  color: #f7f9ff;
  background:
    linear-gradient(180deg, rgba(47, 128, 255, 0.14), rgba(3, 5, 8, 0) 46%),
    linear-gradient(135deg, rgba(255, 122, 24, 0.12), rgba(3, 5, 8, 0) 42%),
    rgba(3, 5, 8, 0.9);
  backdrop-filter: blur(18px);
`;

const WorkspaceClosePanel = styled.section`
  display: grid;
  width: min(440px, 100%);
  min-width: 0;
  justify-items: center;
  gap: 12px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02)),
    rgba(8, 13, 20, 0.96);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.56);
`;

const WorkspaceCloseSpinner = styled.div`
  width: 42px;
  height: 42px;
  border: 3px solid rgba(98, 160, 255, 0.2);
  border-top-color: #62a0ff;
  border-right-color: #ff9a3d;
  border-radius: 50%;
  animation: ${workspaceCloseSpin} 760ms linear infinite;
`;

const WorkspaceCloseTitle = styled.h2`
  margin: 3px 0 0;
  color: #ffffff;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
`;

const WorkspaceCloseDetail = styled.p`
  max-width: 34ch;
  margin: 0;
  color: #aeb8c7;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.48;
  text-align: center;
`;

const WorkspaceCloseCounter = styled.p`
  margin: 4px 0 0;
  padding: 6px 9px;
  border: 1px solid rgba(98, 160, 255, 0.24);
  border-radius: 8px;
  color: #eaf2ff;
  background: rgba(47, 128, 255, 0.12);
  font-size: 12px;
  font-weight: 900;
  line-height: 1.25;
  text-align: center;
`;

const WorkspaceCloseProgressTrack = styled.div`
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
`;

const WorkspaceCloseProgressBar = styled.div`
  width: ${({ $progress }) => Math.max(0, Math.min(100, $progress || 0))}%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #62a0ff, #ff9a3d);
  transition: width 180ms ease;
`;

const splashPulse = keyframes`
  0%,
  100% {
    opacity: 0.72;
    transform: translate3d(0, 0, 0);
  }

  50% {
    opacity: 1;
    transform: translate3d(0, -4px, 0);
  }
`;

const loadingOrangeSweep = keyframes`
  0% {
    opacity: 0;
    transform: translateX(-145%);
  }

  14% {
    opacity: 1;
  }

  82% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translateX(330%);
  }
`;

const shellReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.992);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const railReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(-10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const sideReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const panelEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const panelExit = keyframes`
  from {
    opacity: 1;
    transform: translateY(0);
  }

  to {
    opacity: 0;
    transform: translateY(5px);
  }
`;

const quietSweep = keyframes`
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
`;

const squareFade = keyframes`
  0%,
  72%,
  100% {
    opacity: 0;
  }

  10%,
  32% {
    opacity: var(--peak);
  }

  48% {
    opacity: 0;
  }
`;

const SplashScreen = styled.main`
  position: relative;
  display: grid;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  overflow: hidden;
  place-items: center;
  padding: clamp(20px, 6vh, 48px);
  color: #f7f9ff;
  background:
    linear-gradient(145deg, rgba(47, 128, 255, 0.13), rgba(3, 5, 8, 0) 42%),
    linear-gradient(315deg, rgba(255, 122, 24, 0.15), rgba(3, 5, 8, 0) 40%),
    linear-gradient(90deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    #030508;
  background-size: auto, auto, 92px 92px, 92px 92px, auto;

  &::before {
    position: absolute;
    inset: 26px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
      rgba(3, 5, 8, 0.46);
    content: "";
  }

  @media (max-width: 760px) {
    padding: 28px;

    &::before {
      inset: 14px;
    }
  }

  @media (max-height: 660px) {
    padding: 18px;

    &::before {
      inset: 12px;
    }
  }
`;

const AmbientPanel = styled.div`
  position: absolute;
  z-index: 1;
  display: grid;
  gap: 10px;
  width: min(320px, 28vw);
  min-height: 126px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(232, 238, 248, 0.38);
  background: rgba(10, 15, 23, 0.38);
  box-shadow: inset 0 0 40px rgba(255, 255, 255, 0.02);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
  line-height: 1.35;
  animation: ${splashPulse} 3s ease-in-out infinite;

  &[data-position="left"] {
    top: 12%;
    left: 6%;
  }

  &[data-position="right"] {
    right: 6%;
    bottom: 24%;
    animation-delay: 0.9s;
  }

  span {
    color: #62a0ff;
    font-weight: 800;
  }

  p {
    margin: 0;
  }

  p:last-child {
    color: rgba(255, 154, 61, 0.56);
  }

  @media (max-width: 980px) {
    display: none;
  }
`;

const SplashCenter = styled.section`
  position: relative;
  z-index: 2;
  display: grid;
  width: min(680px, 100%);
  justify-items: center;
  gap: clamp(10px, 2.5vh, 18px);
  text-align: center;
`;

const SplashLogo = styled.img`
  display: block;
  width: clamp(132px, 28vh, 258px);
  height: clamp(132px, 28vh, 258px);
  border-radius: 8px;
  object-fit: cover;
  filter:
    drop-shadow(0 0 24px rgba(47, 128, 255, 0.36))
    drop-shadow(0 0 28px rgba(255, 122, 24, 0.28));
  animation: ${splashPulse} 2.8s ease-in-out infinite;

  @media (max-width: 760px) {
    width: clamp(112px, 24vh, 184px);
    height: clamp(112px, 24vh, 184px);
  }
`;

const SplashTitle = styled.h1`
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 7vw, 64px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  text-shadow: 0 0 24px rgba(47, 128, 255, 0.22);

  @media (max-width: 760px) {
    font-size: 42px;
  }
`;

const SplashTagline = styled.p`
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2.2vw, 19px);
  font-weight: 650;
  line-height: 1.5;

  @media (max-width: 760px) {
    font-size: 16px;
  }
`;

const LoadingTrack = styled.div`
  position: relative;
  width: min(520px, 88%);
  height: 7px;
  overflow: hidden;
  border: 1px solid rgba(98, 160, 255, 0.44);
  border-radius: 8px;
  background: linear-gradient(90deg, #0e4fd3, #2f80ff 42%, #62a0ff);
  box-shadow:
    inset 0 0 12px rgba(255, 255, 255, 0.12),
    0 0 18px rgba(47, 128, 255, 0.28);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.42);
    background:
      linear-gradient(90deg, rgba(255, 107, 107, 0.16), rgba(255, 122, 24, 0.2)),
      #10151f;
    box-shadow:
      inset 0 0 12px rgba(255, 255, 255, 0.07),
      0 0 18px rgba(255, 107, 107, 0.14);
  }
`;

const LoadingFill = styled.div`
  width: 34%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(255, 122, 24, 0),
    #ff7a18 28%,
    #ff9a3d 56%,
    rgba(255, 186, 96, 0)
  );
  box-shadow:
    0 0 14px rgba(255, 122, 24, 0.62),
    0 0 18px rgba(255, 154, 61, 0.4);
  animation: ${loadingOrangeSweep} 1.55s cubic-bezier(0.45, 0, 0.25, 1) infinite;
`;

const LoadingText = styled.p`
  margin: 0;
  color: #d1d8e2;
  font-size: 16px;
  font-weight: 720;
`;

const LoadingDetail = styled.p`
  margin: 3px 0 0;
  color: #8f9bad;
  font-size: 13px;
  font-weight: 620;
  line-height: 1.45;
`;

const LaunchStatusPanel = styled.div`
  display: grid;
  width: min(520px, 92%);
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(47, 128, 255, 0.24);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
    rgba(6, 9, 16, 0.74);
  text-align: left;
  box-shadow: 0 20px 54px rgba(0, 0, 0, 0.22);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.32);
    background:
      linear-gradient(145deg, rgba(255, 107, 107, 0.12), rgba(255, 122, 24, 0.08)),
      rgba(6, 9, 16, 0.78);
  }

  &[data-state="update"],
  &[data-state="warning"] {
    border-color: rgba(255, 122, 24, 0.34);
    background:
      linear-gradient(145deg, rgba(255, 122, 24, 0.12), rgba(47, 128, 255, 0.07)),
      rgba(6, 9, 16, 0.78);
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
`;

const LaunchStatusIcon = styled.span`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(47, 128, 255, 0.38);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.4);
    color: #ffb1b1;
    background: rgba(255, 107, 107, 0.14);
  }

  &[data-state="update"],
  &[data-state="warning"] {
    border-color: rgba(255, 122, 24, 0.42);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.14);
  }
`;

const LaunchStatusCopy = styled.div`
  min-width: 0;
`;

const LaunchActions = styled.div`
  display: flex;
  justify-content: center;
  width: min(260px, 92%);
  gap: 10px;

  > button {
    width: 100%;
    min-height: 44px;
  }

  &[data-layout="split"] {
    width: min(520px, 92%);

    > button {
      flex: 1 1 0;
    }
  }

  @media (max-width: 560px) {
    flex-direction: column;
  }
`;

const LoginScreen = styled.main`
  position: relative;
  display: grid;
  width: 100%;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  isolation: isolate;
  overflow: hidden;
  background: #030508;
`;

const LoginLayout = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  width: min(1080px, calc(100% - clamp(28px, 6vw, 48px)));
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  grid-template-columns: minmax(0, 1fr) minmax(320px, 430px);
  align-items: center;
  align-content: center;
  gap: clamp(28px, 5vw, 56px);
  margin: 0 auto;
  padding: clamp(18px, 6vh, 48px) 0;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 860px) {
    width: min(100% - 28px, 620px);
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 28px 0;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    grid-template-columns: minmax(0, 0.9fr) minmax(320px, 400px);
    align-items: start;
    gap: 26px;
    padding: 18px 0;
  }
`;

const SquareField = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(185, 191, 203, 0.24) 1px, transparent 1px),
    linear-gradient(180deg, rgba(185, 191, 203, 0.22) 1px, transparent 1px),
    #030508;
  background-size: ${AUTH_TILE_SIZE}px ${AUTH_TILE_SIZE}px;

  &::after {
    position: absolute;
    inset: 0;
    z-index: 2;
    background:
      linear-gradient(90deg, rgba(3, 5, 8, 0.72), rgba(3, 5, 8, 0.12) 46%, rgba(3, 5, 8, 0.6)),
      linear-gradient(180deg, rgba(3, 5, 8, 0.06), rgba(3, 5, 8, 0.48));
    content: "";
  }
`;

const SquarePulse = styled.span`
  position: absolute;
  top: var(--top);
  left: var(--left);
  z-index: 1;
  width: ${AUTH_TILE_SIZE}px;
  height: ${AUTH_TILE_SIZE}px;
  background: rgba(188, 194, 205, 0.96);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  opacity: 0;
  animation: ${squareFade} var(--duration) ease-in-out var(--delay) infinite;
`;

const BrandPanel = styled.section`
  position: relative;
  z-index: 1;
  display: grid;
  min-height: min(520px, calc(100vh - ${TITLE_BAR_HEIGHT} - 96px));
  align-content: center;
  gap: clamp(24px, 5vh, 48px);
  padding: clamp(8px, 2vh, 20px) 0;
  animation: ${railReveal} 320ms cubic-bezier(0.2, 0.8, 0.2, 1) 60ms both;

  @media (max-width: 860px) {
    min-height: auto;
    gap: 34px;
    padding: 0;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    min-height: auto;
    gap: 18px;
    padding: 0;
  }
`;

const BrandMark = styled.a`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 12px;
  color: #ffffff;
  font-size: 17px;
  text-decoration: none;

  img {
    display: block;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: #050607;
    object-fit: cover;
    filter:
      drop-shadow(0 0 10px rgba(47, 128, 255, 0.28))
      drop-shadow(0 0 12px rgba(255, 122, 24, 0.18));
  }
`;

const IntroCopy = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

const Kicker = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Headline = styled.h1`
  max-width: 620px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 5.6vw, 68px);
  font-weight: 820;
  letter-spacing: 0;
  line-height: 0.98;

  @media (max-width: 860px) {
    font-size: clamp(40px, 13vw, 58px);
  }

  @media (max-height: 720px) and (min-width: 861px) {
    font-size: clamp(34px, 8vh, 48px);
    line-height: 1.03;
  }
`;

const Lede = styled.p`
  max-width: 560px;
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2vw, 18px);
  line-height: 1.62;

  @media (max-height: 720px) and (min-width: 861px) {
    line-height: 1.45;
  }
`;

const IntroFeatureList = styled.ul`
  display: grid;
  max-width: 540px;
  gap: 10px;
  margin: 4px 0 0;
  padding: 20px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  list-style: none;

  @media (max-height: 720px) and (min-width: 861px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding-top: 12px;
  }
`;

const IntroFeature = styled.li`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #a7b2c2;
  font-size: 14px;
  font-weight: 720;
  line-height: 1.5;

  span {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: #f7f9ff;
  }

  &[data-tone="blue"] span {
    background: #2f80ff;
  }

  &[data-tone="orange"] span {
    background: #ff7a18;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    gap: 7px;
    font-size: 12px;
    line-height: 1.35;
  }
`;

const ApiStatus = styled.div`
  display: grid;
  width: min(100%, 560px);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 18px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    rgba(10, 15, 23, 0.74);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.24);
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 180ms both;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const StatusSummary = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #eef4f8;
  font-size: 14px;
  font-weight: 760;
`;

const StatusBadge = styled.span`
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: #ffffff;
  background: rgba(255, 122, 24, 0.22);
  border: 1px solid rgba(255, 122, 24, 0.4);

  ${ApiStatus}[data-state="online"] & {
    background: rgba(47, 128, 255, 0.18);
    border-color: rgba(47, 128, 255, 0.48);
  }

  ${ApiStatus}[data-state="offline"] & {
    background: rgba(255, 107, 107, 0.16);
    border-color: rgba(255, 107, 107, 0.42);
  }
`;

const iconPulse = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

const statusIconSize = `
  width: 18px;
  height: 18px;
`;

const ConnectedIcon = styled(CloudDone)`
  ${statusIconSize}
`;

const ErrorIcon = styled(ErrorOutline)`
  ${statusIconSize}
`;

const PendingIcon = styled(Pending)`
  ${statusIconSize}
  animation: ${iconPulse} 1.2s linear infinite;
`;

const StatusButton = styled.button`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid rgba(47, 128, 255, 0.36);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(47, 128, 255, 0.14);
  font-size: 13px;
  font-weight: 800;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    border-color: rgba(98, 160, 255, 0.64);
    background: rgba(47, 128, 255, 0.22);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.68;
  }

  @media (max-width: 860px) {
    width: 100%;
  }
`;

const ApiBase = styled.p`
  grid-column: 1 / -1;
  margin: 0;
  overflow-wrap: anywhere;
  color: #8f9aa5;
  font-size: 12px;
  font-weight: 700;
`;

const PricingScreen = styled.main`
  display: grid;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  grid-template-columns: minmax(0, 0.86fr) minmax(360px, 1fr);
  align-items: center;
  gap: 36px;
  padding: 48px;
  color: #f7fafc;
  background:
    linear-gradient(145deg, rgba(47, 128, 255, 0.14), rgba(3, 5, 8, 0) 40%),
    linear-gradient(315deg, rgba(255, 122, 24, 0.13), rgba(3, 5, 8, 0) 36%),
    #030508;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    align-items: start;
    padding: 28px;
  }
`;

const PricingHero = styled.section`
  display: grid;
  align-content: center;
  gap: 24px;
`;

const PricingCopy = styled.div`
  display: grid;
  gap: 16px;
`;

const PricingTitle = styled.h1`
  max-width: 640px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(40px, 6vw, 68px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.98;
`;

const PricingText = styled.p`
  max-width: 580px;
  margin: 0;
  color: #a7b2c2;
  font-size: 17px;
  line-height: 1.72;
`;

const PricingActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;

  button {
    min-width: 150px;
    padding: 0 16px;
  }
`;

const PricingPlans = styled.section`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

const PricingPlanCard = styled.article`
  position: relative;
  display: grid;
  min-height: 430px;
  align-content: start;
  gap: 18px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(17, 22, 27, 0.9);

  &[data-featured="true"] {
    border-color: rgba(47, 128, 255, 0.42);
    background:
      linear-gradient(145deg, rgba(47, 128, 255, 0.16), rgba(255, 122, 24, 0.09)),
      rgba(17, 22, 27, 0.92);
    box-shadow: 0 28px 80px rgba(47, 128, 255, 0.12);
  }
`;

const PlanEyebrow = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const PlanPrice = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: 56px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.95;

  span {
    color: #8f9aa5;
    font-size: 18px;
    font-weight: 760;
  }
`;

const PlanDescription = styled.p`
  margin: 0;
  color: #bdc6ce;
  font-size: 14px;
  line-height: 1.62;
`;

const PlanFeatureList = styled.ul`
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    position: relative;
    padding-left: 20px;
    color: #e8eef3;
    font-size: 13px;
    line-height: 1.5;
  }

  li::before {
    position: absolute;
    top: 0.55em;
    left: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #62a0ff;
    content: "";
  }
`;

const AuthenticatedWorkspaceFrame = styled.div`
  position: relative;
  width: 100%;
  min-width: 320px;
  height: calc(100vh - ${TITLE_BAR_HEIGHT});
  min-height: 0;
  overflow: hidden;
  background: #030508;

  @media (max-width: 760px) {
    height: auto;
    min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  }
`;

const WorkspaceStartupOverlay = styled(SplashScreen).attrs({ as: "section" })`
  position: absolute;
  inset: 0;
  z-index: 50;
  width: 100%;
  height: 100%;
  min-height: 0;
`;

const DashboardShell = styled.main`
  position: relative;
  display: grid;
  min-width: 320px;
  height: calc(100vh - ${TITLE_BAR_HEIGHT});
  min-height: 0;
  grid-template-columns: 192px minmax(280px, 1fr);
  color: #f7fafc;
  overflow: hidden;
  background:
    radial-gradient(circle at 82% 10%, rgba(47, 128, 255, 0.11), transparent 18rem),
    radial-gradient(circle at 18% 88%, rgba(255, 122, 24, 0.09), transparent 16rem),
    #030508;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-startup="true"] {
    pointer-events: none;
  }

  @media (max-width: 980px) {
    grid-template-columns: 184px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    height: auto;
    min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const WorkspaceRail = styled.aside`
  display: grid;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 5, 8, 0.78);
  backdrop-filter: blur(18px);
  animation: ${railReveal} 300ms cubic-bezier(0.2, 0.8, 0.2, 1) 40ms both;

  @media (max-width: 760px) {
    min-height: auto;
    grid-template-rows: auto auto;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  }
`;

const RailTop = styled.div`
  display: grid;
  align-content: start;
  gap: 9px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 4px;
`;

const RailSectionTitle = styled.p`
  margin: 0;
  color: #687386;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  animation: ${panelEnter} 220ms cubic-bezier(0.2, 0.8, 0.2, 1) 80ms both;
`;

const WorkspaceList = styled.div`
  display: grid;
  min-width: 0;
  max-width: 100%;
  gap: 5px;
  overflow: hidden;
`;

const WorkspaceRow = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  opacity: 0;
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &:nth-child(1) {
    animation-delay: 110ms;
  }

  &:nth-child(2) {
    animation-delay: 145ms;
  }

  &:nth-child(3) {
    animation-delay: 180ms;
  }
`;

const WorkspaceButton = styled.button`
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 32px;
  grid-template-columns: 4px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 38px 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  box-sizing: border-box;
  color: #e8eef8;
  background: transparent;
  overflow: hidden;
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;

  strong {
    display: block;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-active="true"],
  &:hover,
  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}:focus-within & {
    border-color: rgba(47, 128, 255, 0.36);
    background: rgba(47, 128, 255, 0.14);
  }
`;

const WorkspaceLabel = styled.span`
  display: grid;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  gap: 2px;

  > span {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #687386;
    font-size: 10px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WorkspaceSettingsButton = styled.button`
  position: absolute;
  top: 50%;
  right: 4px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%) translateX(3px);
  transition:
    opacity 160ms ease,
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover {
    border-color: rgba(255, 122, 24, 0.42);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.12);
  }

  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}:focus-within & {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
  }
`;

const WorkspaceAccent = styled.span`
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  transition:
    background 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;

  ${WorkspaceButton}[data-active="true"] & {
    background: linear-gradient(180deg, #62a0ff, #ff9a3d);
    box-shadow:
      0 0 10px rgba(47, 128, 255, 0.32),
      0 0 10px rgba(255, 122, 24, 0.18);
    transform: scaleY(1.12);
  }
`;

const WorkspaceMuted = styled.p`
  margin: 0;
  padding: 8px 9px;
  color: #687386;
  font-size: 12px;
  font-weight: 760;
`;

const RailFooter = styled.div`
  display: grid;
  gap: 6px;
  min-height: 0;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 5, 8, 0.88);
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 220ms both;
`;

const RailActionButton = styled.button`
  display: inline-flex;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 34px;
  align-items: center;
  gap: 9px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  box-sizing: border-box;
  color: #c5cdd6;
  background: transparent;
  overflow: hidden;
  font-size: 12px;
  font-weight: 800;
  transition:
    background 160ms ease,
    color 160ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &[data-active="true"],
  &:hover {
    color: #ffffff;
    background: rgba(47, 128, 255, 0.12);
  }
`;

const BlankWorkspace = styled.section`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.18);
  background-size: 76px 76px, 76px 76px, auto;
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &::after {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, transparent, rgba(98, 160, 255, 0.035), transparent),
      radial-gradient(circle at 50% 50%, rgba(47, 128, 255, 0.05), transparent 34rem);
    content: "";
    opacity: 0.72;
    animation: ${quietSweep} 7s ease-in-out infinite;
  }

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 980px) {
    min-height: 360px;
  }
`;

const ForgeWorkspace = styled.section`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  padding: 0;
  background:
    radial-gradient(circle at 84% 10%, rgba(47, 128, 255, 0.12), transparent 16rem),
    rgba(3, 5, 8, 0.18);
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }
`;

const TerminalWorkspaceSurface = styled.section`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.14);
  background-size: 68px 68px, 68px 68px, auto;
`;

const WorkspaceTerminalPanels = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);

  ${TerminalWorkspaceSurface} {
    min-height: 0;
  }
`;

const ResizePanelGroup = styled(Group)`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
`;

const ResizePanel = styled(Panel)`
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  &[data-terminal-row="true"],
  &[data-terminal-leaf="true"] {
    min-height: ${TERMINAL_PANE_MIN_HEIGHT_PX}px;
  }

  &[data-terminal-column="true"],
  &[data-terminal-leaf="true"] {
    min-width: ${TERMINAL_PANE_MIN_WIDTH_PX}px;
  }
`;

const ResizeHandle = styled(Separator)`
  position: relative;
  z-index: 5;
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.08);
  transition:
    background 140ms ease,
    box-shadow 140ms ease;

  &[data-direction="horizontal"] {
    width: 5px;
    margin: 0 -2px;
    cursor: col-resize;
  }

  &[data-direction="vertical"] {
    height: 5px;
    margin: -2px 0;
    cursor: row-resize;
  }

  &::after {
    position: absolute;
    inset: 0;
    background: transparent;
    content: "";
  }

  &[data-direction="horizontal"]::after {
    left: 2px;
    right: 2px;
    background: rgba(255, 255, 255, 0.1);
  }

  &[data-direction="vertical"]::after {
    top: 2px;
    bottom: 2px;
    background: rgba(255, 255, 255, 0.1);
  }

  &:hover,
  &[data-resize-handle-state="drag"] {
    background: rgba(47, 128, 255, 0.28);
    box-shadow: 0 0 16px rgba(47, 128, 255, 0.18);
  }

  &[data-surface="files"] {
    background: #3c3c3c;
    box-shadow: none;
  }

  &[data-surface="files"][data-direction="horizontal"] {
    width: 6px;
    margin: 0 -3px;
  }

  &[data-surface="files"]::after {
    background: transparent;
  }

  &[data-surface="files"][data-direction="horizontal"]::after {
    left: 2px;
    right: 2px;
    background: #3c3c3c;
  }

  &[data-surface="files"]:hover,
  &[data-surface="files"][data-resize-handle-state="drag"] {
    background: #007fd4;
    box-shadow: none;
  }

  &[data-surface="files"]:hover::after,
  &[data-surface="files"][data-resize-handle-state="drag"]::after {
    background: #007fd4;
  }
`;

const TerminalDevMetricsBar = styled.div`
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 30;
  display: flex;
  max-width: calc(100% - 20px);
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  pointer-events: none;
`;

const TerminalDevMetric = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  border: 1px solid rgba(143, 157, 183, 0.22);
  border-radius: 6px;
  padding: 3px 6px;
  background: rgba(2, 4, 8, 0.82);
  color: rgba(229, 236, 248, 0.84);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
`;

const TerminalFrame = styled.section`
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: ${TERMINAL_THEME_BACKGROUND};
  box-shadow: none;

  &[data-state="error"] {
    border-color: rgba(255, 107, 107, 0.36);
  }
`;

const XtermSurface = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 0;
  background: ${TERMINAL_THEME_BACKGROUND};

  .xterm {
    width: 100%;
    height: 100%;
    background: ${TERMINAL_THEME_BACKGROUND} !important;
  }

  .xterm-viewport,
  .xterm-screen {
    background: ${TERMINAL_THEME_BACKGROUND} !important;
  }
`;

const TerminalClosedSurface = styled.div`
  display: grid;
  place-items: center;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    #020304;
  background-size: 68px 68px, 68px 68px, auto;
`;

const TerminalClosedLabel = styled.span`
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: center;
  overflow-wrap: anywhere;
  border: 1px solid rgba(143, 157, 183, 0.24);
  border-radius: 8px;
  padding: 10px 14px;
  background: rgba(8, 12, 20, 0.74);
  color: rgba(232, 238, 248, 0.92);
  font-size: 13px;
  font-weight: 900;
  line-height: 1.1;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
`;

const TerminalRestartPill = styled.div`
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 4;
  display: inline-flex;
  max-width: calc(100% - 24px);
  min-height: 38px;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
    rgba(6, 9, 16, 0.88);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.34);
  transform: translateX(-50%);
  backdrop-filter: blur(16px);
`;

const TerminalRestartButton = styled.button`
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0;
  border: 1px solid rgba(47, 128, 255, 0.34);
  border-radius: 999px;
  color: #d9e7ff;
  background: rgba(47, 128, 255, 0.16);
  font-size: 11px;
  font-weight: 900;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    border-color: rgba(98, 160, 255, 0.58);
    background: rgba(47, 128, 255, 0.26);
    transform: translateY(-1px);
  }
`;

const TerminalCloseButton = styled(TerminalRestartButton)`
  border-color: rgba(255, 255, 255, 0.12);
  color: #9aa5b5;
  background: rgba(255, 255, 255, 0.045);

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.07);
  }

  &:disabled {
    opacity: 0.48;
  }
`;

const TerminalEmptyPanel = styled.section`
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 8px;
  background:
    radial-gradient(circle at 85% 12%, rgba(255, 122, 24, 0.12), transparent 16rem),
    rgba(13, 20, 31, 0.86);
`;

const TerminalEmptyActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const TerminalEmptyCopy = styled.div`
  display: grid;
  gap: 6px;
  max-width: 620px;
`;

const TerminalAgentList = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const TerminalAgentRow = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.72);

  strong {
    display: block;
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 900;
  }

  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #8fa1bd;
    font-size: 12px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.3);
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.3);
  }
`;

const FilesWorkspaceSurface = styled.section`
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #1e1e1e;

  > [data-panel-group] {
    width: 100%;
    height: 100%;
  }
`;

const FileExplorerPane = styled.aside`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 0;
  border-right: 1px solid #3c3c3c;
  background: #252526;

  @media (max-width: 860px) {
    border-right: 0;
    border-bottom: 1px solid #3c3c3c;
  }
`;

const FileExplorerHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 35px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 20px;
  color: #bbbbbb;
  background: #252526;

  p {
    color: #bbbbbb;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
  }
`;

const FileExplorerActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
`;

const FileIconButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: #cccccc;
  background: transparent;
  transition:
    color 160ms ease,
    background 160ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    color: #ffffff;
    background: #2a2d2e;
  }

  &:focus-visible {
    outline: 1px solid #007fd4;
    outline-offset: -1px;
  }

  &:disabled {
    opacity: 0.54;
  }
`;

const FileRootPath = styled.p`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0 12px 6px 20px;
  border-bottom: 1px solid #303031;
  color: #858585;
  background: #252526;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 10.5px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FileTree = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 10px;
  background: #252526;

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(121, 121, 121, 0.38);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

const FileTreeItem = styled.div`
  min-width: 0;
`;

const FileTreeButton = styled.button`
  display: grid;
  width: 100%;
  min-width: 0;
  height: 22px;
  min-height: 22px;
  grid-template-columns: 16px 16px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 3px;
  padding: 0 8px 0 ${({ $depth }) => 4 + ($depth || 0) * 12}px;
  border: 0;
  border-radius: 0;
  color: #cccccc;
  background: transparent;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;

  &:hover {
    color: #ffffff;
    background: #2a2d2e;
  }

  &[data-selected="true"] {
    color: #ffffff;
    background: #37373d;
  }

  &:focus-visible {
    outline: 1px solid #007fd4;
    outline-offset: -1px;
  }
`;

const FileDisclosure = styled.span`
  display: grid;
  width: 16px;
  height: 22px;
  place-items: center;
  color: #858585;

  .codicon {
    font-size: 16px;
  }
`;

const FileKindIcon = styled.span`
  display: grid;
  width: 16px;
  height: 22px;
  place-items: center;
  color: #cccccc;

  .codicon {
    font-size: 16px;
  }

  &[data-file-tone="folder"] {
    color: #dcb67a;
  }

  &[data-file-tone="javascript"],
  &[data-file-tone="npm"] {
    color: #cbcb41;
  }

  &[data-file-tone="typescript"] {
    color: #519aba;
  }

  &[data-file-tone="react"] {
    color: #4ec9b0;
  }

  &[data-file-tone="rust"] {
    color: #dea584;
  }

  &[data-file-tone="style"],
  &[data-file-tone="media"] {
    color: #c586c0;
  }

  &[data-file-tone="markup"],
  &[data-file-tone="markdown"] {
    color: #569cd6;
  }

  &[data-file-tone="data"],
  &[data-file-tone="database"] {
    color: #4fc1ff;
  }

  &[data-file-tone="config"],
  &[data-file-tone="lock"],
  &[data-file-tone="terminal"] {
    color: #c5c5c5;
  }

  &[data-file-tone="archive"],
  &[data-file-tone="binary"],
  &[data-file-tone="font"],
  &[data-file-tone="pdf"] {
    color: #d7ba7d;
  }

  &[data-file-tone="docker"],
  &[data-file-tone="python"],
  &[data-file-tone="git"] {
    color: #75beff;
  }

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ff7b72;
  }
`;

const FileTreeName = styled.span`
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ff7b72;
  }
`;

const FileGitStatusMark = styled.span`
  display: grid;
  width: 18px;
  height: 22px;
  place-items: center;
  justify-self: end;
  color: transparent;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ff7b72;
  }
`;

const FileTreeChildren = styled.div`
  min-width: 0;
`;

const FileTreeMessage = styled.p`
  margin: 0;
  overflow: hidden;
  height: 22px;
  padding: 0 8px 0 ${({ $depth }) => 36 + ($depth || 0) * 12}px;
  color: #858585;
  font-size: 12px;
  font-weight: 400;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-tone="error"] {
    color: #ffb0b0;
  }
`;

const FileTreeEmpty = styled.p`
  margin: 0;
  padding: 8px 20px;
  color: #858585;
  font-size: 12px;
  font-weight: 400;
`;

const FilePreviewPane = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  background: #1e1e1e;
`;

const FilePreviewHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 35px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px 0 0;
  border-bottom: 1px solid #3c3c3c;
  background: #252526;
`;

const FilePreviewTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  max-width: min(520px, 62%);
  min-height: 35px;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  border-right: 1px solid #3c3c3c;
  color: #cccccc;
  background: #1e1e1e;
  font-size: 13px;
  font-weight: 400;

  .codicon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: #cccccc;
    font-size: 16px;
  }

  &[data-file-tone="javascript"] .codicon,
  &[data-file-tone="npm"] .codicon {
    color: #cbcb41;
  }

  &[data-file-tone="typescript"] .codicon {
    color: #519aba;
  }

  &[data-file-tone="react"] .codicon {
    color: #4ec9b0;
  }

  &[data-file-tone="rust"] .codicon {
    color: #dea584;
  }

  &[data-file-tone="style"] .codicon,
  &[data-file-tone="media"] .codicon {
    color: #c586c0;
  }

  &[data-file-tone="markup"] .codicon,
  &[data-file-tone="markdown"] .codicon {
    color: #569cd6;
  }

  &[data-file-tone="data"] .codicon,
  &[data-file-tone="database"] .codicon {
    color: #4fc1ff;
  }

  &[data-file-tone="config"] .codicon,
  &[data-file-tone="lock"] .codicon,
  &[data-file-tone="terminal"] .codicon {
    color: #c5c5c5;
  }

  &[data-file-tone="archive"] .codicon,
  &[data-file-tone="binary"] .codicon,
  &[data-file-tone="font"] .codicon,
  &[data-file-tone="pdf"] .codicon {
    color: #d7ba7d;
  }

  &[data-file-tone="docker"] .codicon,
  &[data-file-tone="python"] .codicon,
  &[data-file-tone="git"] .codicon {
    color: #75beff;
  }

  &[data-git-status="added"] .codicon,
  &[data-git-status="copied"] .codicon,
  &[data-git-status="untracked"] .codicon {
    color: #73c991;
  }

  &[data-git-status="modified"] .codicon,
  &[data-git-status="renamed"] .codicon {
    color: #e2c08d;
  }

  &[data-git-status="deleted"] .codicon,
  &[data-git-status="conflicted"] .codicon {
    color: #ff7b72;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-git-status="added"] span,
  &[data-git-status="copied"] span,
  &[data-git-status="untracked"] span {
    color: #73c991;
  }

  &[data-git-status="modified"] span,
  &[data-git-status="renamed"] span {
    color: #e2c08d;
  }

  &[data-git-status="deleted"] span,
  &[data-git-status="conflicted"] span {
    color: #ff7b72;
  }
`;

const FilePreviewMeta = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  min-width: 0;
  align-items: center;
  gap: 6px;
`;

const FileGitStatusPill = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 2px 6px;
  border: 1px solid #3c3c3c;
  border-radius: 3px;
  background: #2d2d2d;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    border-color: rgba(115, 201, 145, 0.34);
    color: #73c991;
    background: rgba(115, 201, 145, 0.1);
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    border-color: rgba(226, 192, 141, 0.34);
    color: #e2c08d;
    background: rgba(226, 192, 141, 0.1);
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    border-color: rgba(255, 123, 114, 0.38);
    color: #ffb0aa;
    background: rgba(255, 123, 114, 0.12);
  }
`;

const FileMetaPill = styled.span`
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 1px solid #3c3c3c;
  border-radius: 3px;
  color: #cccccc;
  background: #2d2d2d;
  font-size: 10px;
  font-weight: 500;
  line-height: 14px;
`;

const FilePreviewPath = styled.p`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  padding: 4px 14px;
  border-bottom: 1px solid #2d2d2d;
  color: #858585;
  background: #1e1e1e;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 11px;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ffb0aa;
  }
`;

const FileContentFrame = styled.section`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #1e1e1e;
`;

const FilePreviewScroll = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: auto;
  background: #1e1e1e;

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(121, 121, 121, 0.38);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

const HighlightedCodeBlock = styled.pre`
  min-width: max-content;
  min-height: 100%;
  margin: 0;
  padding: 14px 16px 28px;
  color: #d4d4d4;
  background: #1e1e1e;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
  line-height: 1.5;
  tab-size: 2;
  white-space: pre;

  .token.comment,
  .token.prolog,
  .token.doctype,
  .token.cdata {
    color: #6a9955;
    font-style: italic;
  }

  .token.punctuation {
    color: #d4d4d4;
  }

  .token.property,
  .token.tag,
  .token.boolean,
  .token.number,
  .token.constant,
  .token.symbol,
  .token.deleted {
    color: #b5cea8;
  }

  .token.selector,
  .token.attr-name,
  .token.string,
  .token.char,
  .token.builtin,
  .token.inserted {
    color: #ce9178;
  }

  .token.operator,
  .token.entity,
  .token.url,
  .language-css .token.string,
  .style .token.string {
    color: #d4d4d4;
  }

  .token.atrule,
  .token.attr-value,
  .token.keyword {
    color: #569cd6;
  }

  .token.function,
  .token.class-name {
    color: #dcdcaa;
  }

  .token.regex,
  .token.important,
  .token.variable {
    color: #d16969;
  }

  .token.namespace {
    opacity: 0.78;
  }
`;

const FileDiffPanel = styled.section`
  display: grid;
  min-width: 0;
  margin: 0;
  border-bottom: 1px solid #2d2d2d;
  background: #181818;
`;

const FileDiffHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid #2d2d2d;
  color: #cccccc;
  background: #252526;
  font-size: 12px;

  .codicon {
    color: #e2c08d;
    font-size: 15px;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const FileDiffBadge = styled.span`
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid rgba(226, 192, 141, 0.34);
  border-radius: 3px;
  color: #e2c08d;
  background: rgba(226, 192, 141, 0.1);
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
`;

const FileDiffMessage = styled.p`
  margin: 0;
  padding: 10px 14px;
  color: #858585;
  font-size: 12px;
  line-height: 18px;

  &[data-tone="error"] {
    color: #ffb0b0;
  }
`;

const DiffCodeBlock = styled.pre`
  min-width: max-content;
  max-height: 42vh;
  margin: 0;
  overflow: auto;
  padding: 6px 0 8px;
  color: #d4d4d4;
  background: #1e1e1e;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.45;
  tab-size: 2;
  white-space: pre;

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(121, 121, 121, 0.38);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

const DiffLine = styled.div`
  min-height: 18px;
  padding: 0 14px;

  &[data-tone="added"] {
    color: #b5f1c0;
    background: rgba(46, 160, 67, 0.18);
  }

  &[data-tone="removed"] {
    color: #ffd0d0;
    background: rgba(248, 81, 73, 0.16);
  }

  &[data-tone="hunk"] {
    color: #9cdcfe;
    background: rgba(47, 128, 255, 0.12);
  }

  &[data-tone="header"],
  &[data-tone="meta"] {
    color: #858585;
  }
`;

const FileEmptyState = styled.div`
  display: grid;
  width: min(420px, 100%);
  min-height: 100%;
  align-content: center;
  justify-items: center;
  gap: 10px;
  margin: 0 auto;
  padding: 22px;
  color: #858585;
  text-align: center;

  h2 {
    color: #cccccc;
    font-size: 15px;
    font-weight: 500;
  }
`;

const FileEmptyIcon = styled.span`
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  color: #cccccc;
  background: #252526;

  svg,
  .codicon {
    width: 20px;
    height: 20px;
    font-size: 20px;
  }

  &[data-tone="error"] {
    border-color: rgba(255, 107, 107, 0.34);
    color: #ffd0d0;
    background: rgba(255, 107, 107, 0.12);
  }
`;

const VaultWorkspaceSurface = styled.section`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: auto;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.14);
  background-size: 68px 68px, 68px 68px, auto;
`;

const VaultPlaceholderPanel = styled.section`
  display: grid;
  width: min(640px, 100%);
  min-width: 0;
  gap: 16px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 86% 12%, rgba(255, 122, 24, 0.12), transparent 16rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.015)),
    rgba(13, 20, 31, 0.9);
`;

const VaultPlaceholderIcon = styled.span`
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.12);

  svg {
    width: 22px;
    height: 22px;
  }
`;

const VaultStatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const AudioWorkspaceSurface = styled(VaultWorkspaceSurface)`
  place-items: stretch;
  align-content: center;
  justify-items: center;
`;

const AudioSetupPanel = styled.section`
  display: grid;
  width: min(760px, 100%);
  align-self: center;
  gap: 16px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 8px;
  background:
    radial-gradient(circle at 88% 12%, rgba(47, 128, 255, 0.16), transparent 17rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.016)),
    rgba(13, 20, 31, 0.92);

  &[data-installed="true"] {
    border-color: rgba(47, 128, 255, 0.3);
  }
`;

const AudioHeroRow = styled.div`
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-width: 0;

  @media (max-width: 680px) {
    grid-template-columns: 48px minmax(0, 1fr);

    > span:last-child {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
`;

const AudioStatePill = styled.span`
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(255, 122, 24, 0.36);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.12);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;

  &[data-installed="true"] {
    border-color: rgba(47, 128, 255, 0.38);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.13);
  }
`;

const AudioStatusGrid = styled(VaultStatusGrid)`
  grid-template-columns: repeat(3, minmax(0, 1fr));
`;

const AudioPathBlock = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(3, 5, 8, 0.52);

  span {
    color: #687386;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;

const AudioCodePath = styled.code`
  min-width: 0;
  overflow: hidden;
  color: #d7e5ff;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AudioRuntimeHint = styled.p`
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.1);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
  overflow-wrap: anywhere;
`;

const AudioProgressPanel = styled.div`
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(47, 128, 255, 0.24);
  border-radius: 8px;
  background: rgba(47, 128, 255, 0.08);
`;

const AudioProgressTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #e8eef8;
  font-size: 12px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AudioProgressTrack = styled.div`
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
`;

const AudioProgressBar = styled.div`
  width: ${({ $progress }) => `${Math.max(0, Math.min(100, $progress || 0))}%`};
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f80ff, #ff7a18);
  transition: width 180ms ease;
`;

const AudioProgressMeta = styled.p`
  margin: 0;
  color: #8793a5;
  font-size: 11px;
  font-weight: 760;
`;

const AudioActionRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(132px, auto);
  gap: 10px;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

const AudioWidgetShell = styled.main`
  display: grid;
  min-width: 320px;
  min-height: 100vh;
  align-content: start;
  gap: 14px;
  padding: 14px;
  color: #f7f9ff;
  background:
    radial-gradient(circle at 84% 8%, rgba(47, 128, 255, 0.18), transparent 12rem),
    radial-gradient(circle at 12% 92%, rgba(255, 122, 24, 0.12), transparent 10rem),
    #030508;
`;

const AudioWidgetHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  -webkit-app-region: drag;

  button {
    -webkit-app-region: no-drag;
  }
`;

const AudioWidgetTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  color: #ffffff;

  > span {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 1px solid rgba(47, 128, 255, 0.38);
    border-radius: 8px;
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.13);
  }

  svg {
    width: 17px;
    height: 17px;
  }

  strong {
    overflow: hidden;
    font-size: 14px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AudioWidgetMeter = styled.div`
  display: grid;
  height: 104px;
  grid-template-columns: repeat(18, minmax(4px, 1fr));
  align-items: center;
  gap: 5px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.014)),
    rgba(8, 13, 20, 0.9);

  span {
    display: block;
    height: var(--height);
    min-height: 10px;
    border-radius: 999px;
    background: rgba(104, 115, 134, 0.48);
    transform-origin: center;
    transition:
      background 160ms ease,
      transform 160ms ease;
  }

  &[data-active="true"] span {
    background: linear-gradient(180deg, #62a0ff, #ff9a3d);
    animation: ${quietSweep} 900ms ease-in-out infinite alternate;
  }
`;

const AudioWidgetStatus = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(3, 5, 8, 0.52);

  strong {
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 900;
  }

  span {
    overflow: hidden;
    color: #8793a5;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AudioRecordingTimer = styled.p`
  margin: 0;
  color: #ffb269;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 28px;
  font-weight: 900;
  text-align: center;
`;

const AudioWidgetTranscript = styled.p`
  max-height: 88px;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid rgba(47, 128, 255, 0.22);
  border-radius: 8px;
  color: #d7e5ff;
  background: rgba(47, 128, 255, 0.08);
  font-size: 12px;
  line-height: 1.5;
`;

const AudioWidgetActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(96px, auto);
  gap: 8px;

  button {
    min-height: 42px;
  }
`;

const McpWorkspaceSurface = styled.section`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 14px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.14);
  background-size: 68px 68px, 68px 68px, auto;
`;

const McpHeaderPanel = styled.section`
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.12), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
    rgba(13, 20, 31, 0.9);
`;

const McpTitleRow = styled.div`
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-width: 0;

  button {
    min-height: 40px;
  }

  @media (max-width: 760px) {
    grid-template-columns: 48px minmax(0, 1fr);

    > button {
      grid-column: 1 / -1;
      width: 100%;
    }
  }
`;

const McpStatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const McpLayout = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const McpRegistryPanel = styled.aside`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 10px;
  overflow: hidden;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.74);
`;

const McpPanelTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #687386;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  strong {
    color: #8bb9ff;
  }
`;

const McpServerList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  overflow: auto;
`;

const McpServerButton = styled.button`
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e8eef8;
  background: rgba(255, 255, 255, 0.035);
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease;

  &[data-active="true"],
  &:hover {
    border-color: rgba(47, 128, 255, 0.4);
    background: rgba(47, 128, 255, 0.13);
  }
`;

const McpServerIcon = styled.span`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-state="enabled"] {
    border-color: rgba(47, 128, 255, 0.36);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }

  &[data-state="planned"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.12);
  }
`;

const McpServerCopy = styled.span`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 900;
  }

  span {
    color: #8793a5;
    font-size: 11px;
    font-weight: 760;
  }
`;

const McpStatusBadge = styled.span`
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;

  &[data-state="enabled"] {
    border-color: rgba(47, 128, 255, 0.34);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.12);
  }

  &[data-state="planned"] {
    border-color: rgba(255, 122, 24, 0.34);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.1);
  }
`;

const McpEditorPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 14px;
  overflow: auto;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.016)),
    rgba(8, 13, 20, 0.9);
`;

const McpEditorHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  @media (max-width: 680px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

const McpSwitchButton = styled.button`
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.1);
  font-size: 12px;
  font-weight: 900;

  > span {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
  }

  > span::after {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ffb269;
    content: "";
    transition: transform 160ms ease;
  }

  &[aria-pressed="true"] {
    border-color: rgba(47, 128, 255, 0.38);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.13);
  }

  &[aria-pressed="true"] > span::after {
    background: #62a0ff;
    transform: translateX(12px);
  }

  &:disabled {
    opacity: 0.76;
  }
`;

const McpFieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const McpWideField = styled.label`
  display: grid;
  gap: 8px;
  grid-column: 1 / -1;
`;

const McpInput = styled.input`
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.92);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;

  &:focus {
    border-color: rgba(47, 128, 255, 0.5);
    outline: none;
    box-shadow: 0 0 0 3px rgba(47, 128, 255, 0.12);
  }
`;

const McpTextarea = styled.textarea`
  width: 100%;
  min-height: 86px;
  resize: vertical;
  padding: 11px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.76);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.5;
  outline: none;

  &:focus {
    border-color: rgba(47, 128, 255, 0.52);
    box-shadow: 0 0 0 3px rgba(47, 128, 255, 0.12);
  }
`;

const McpJsonTextarea = styled(McpTextarea)`
  min-height: 164px;
`;

const McpTransportTabs = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(3, 5, 8, 0.46);

  @media (max-width: 620px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const McpTransportButton = styled.button`
  min-width: 0;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #a7b2c2;
  background: transparent;
  font-size: 12px;
  font-weight: 900;

  &[data-active="true"],
  &:hover {
    border-color: rgba(47, 128, 255, 0.38);
    color: #ffffff;
    background: rgba(47, 128, 255, 0.14);
  }
`;

const McpAccessGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
  }
`;

const McpAccessPanel = styled.section`
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
`;

const McpAccessTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #f7f9ff;
  font-size: 12px;
  font-weight: 900;

  > span {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  svg {
    width: 16px;
    height: 16px;
    color: #8bb9ff;
  }
`;

const McpInlineActions = styled.span`
  display: inline-flex;
  gap: 5px;

  button {
    min-height: 26px;
    padding: 0 7px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: #a7b2c2;
    background: rgba(6, 9, 16, 0.72);
    font-size: 10px;
    font-weight: 900;
  }

  button:hover {
    border-color: rgba(47, 128, 255, 0.4);
    color: #ffffff;
  }
`;

const McpCheckList = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
`;

const McpCheckRow = styled.label`
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.52);

  input {
    width: 16px;
    height: 16px;
    accent-color: #2f80ff;
  }

  > span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong,
  small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f7f9ff;
    font-size: 12px;
    font-weight: 900;
  }

  small {
    color: #8793a5;
    font-size: 11px;
    font-weight: 760;
  }
`;

const McpEmptyAccess = styled.p`
  margin: 0;
  padding: 10px;
  border: 1px solid rgba(255, 122, 24, 0.24);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.08);
  font-size: 12px;
  font-weight: 760;
`;

const McpScopePreview = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const McpEditorActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-height: 40px;
    min-width: 112px;
  }

  @media (max-width: 680px) {
    align-items: stretch;
    flex-direction: column;

    button {
      width: 100%;
    }
  }
`;

const WorkspaceSetupPanel = styled.form`
  display: grid;
  width: min(520px, 100%);
  align-self: center;
  justify-self: center;
  gap: 16px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 85% 10%, rgba(47, 128, 255, 0.14), transparent 14rem),
    rgba(13, 20, 31, 0.9);
`;

const SetupHeader = styled.div`
  display: grid;
  gap: 6px;
`;

const SetupField = styled.label`
  display: grid;
  gap: 8px;
`;

const SetupInput = styled.input`
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.92);
  font: inherit;

  &:focus {
    border-color: rgba(47, 128, 255, 0.5);
    outline: none;
    box-shadow: 0 0 0 3px rgba(47, 128, 255, 0.12);
  }
`;

const BlankStatusStack = styled.div`
  display: grid;
  justify-self: end;
  width: min(520px, 100%);
  gap: 8px;
`;

const WorkspaceSettingsOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  background: rgba(3, 5, 8, 0.64);
  animation: ${panelEnter} 160ms ease both;
`;

const WorkspaceSettingsDialog = styled.aside`
  display: grid;
  align-content: start;
  gap: 16px;
  width: min(560px, 100%);
  max-height: min(620px, 100%);
  min-width: 0;
  overflow: auto;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018)),
    rgba(8, 13, 20, 0.98);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
  animation: ${panelEnter} 190ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 620px) {
    width: 100%;
    max-height: 100%;
  }
`;

const WorkspaceSettingsDialogHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const WorkspaceModalCloseButton = styled.button`
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;

  &:hover {
    border-color: rgba(255, 140, 140, 0.38);
    color: #ffd2d2;
    background: rgba(255, 140, 140, 0.1);
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const WorkspaceSettingsForm = styled.form`
  display: grid;
  gap: 14px;
  min-width: 0;
`;

const WorkspaceSettingsInput = styled(SetupInput)`
  min-height: 42px;
`;

const WorkspaceNumberInput = styled(WorkspaceSettingsInput)`
  width: 100%;
`;

const RootDirectoryInput = styled(WorkspaceSettingsInput)`
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
`;

const WorkspaceSettingsFieldGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
  gap: 12px;
  min-width: 0;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

const WorkspaceSettingsActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-width: 132px;
  }

  @media (max-width: 640px) {
    align-items: stretch;
    flex-direction: column;

    button {
      width: 100%;
    }
  }
`;

const AgentSettingsPanel = styled.section`
  position: relative;
  display: grid;
  gap: 16px;
  align-self: start;
  min-width: 0;
  min-height: 340px;
  overflow: visible;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.14), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
    rgba(13, 20, 31, 0.86);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);

  &::before {
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(90deg, #2f80ff, rgba(255, 122, 24, 0.72), transparent);
    content: "";
  }
`;

const AgentPanelActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;

  button {
    min-height: 40px;
  }
`;

const AgentReadyPill = styled.div`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #e8eef8;
  background: rgba(6, 9, 16, 0.74);
  font-size: 12px;
  font-weight: 900;

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-tone="blue"] {
    border-color: rgba(47, 128, 255, 0.38);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.13);
  }

  &[data-tone="orange"] {
    border-color: rgba(255, 122, 24, 0.38);
    color: #ffb16a;
    background: rgba(255, 122, 24, 0.12);
  }
`;

const AgentCardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-height: 0;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const AgentCard = styled.section`
  position: relative;
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 100%;
  overflow: hidden;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.012)),
    rgba(6, 9, 16, 0.78);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  &::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: rgba(255, 255, 255, 0.12);
    content: "";
  }

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018)),
      rgba(8, 13, 20, 0.88);
    transform: translateY(-1px);
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.32);
  }

  &[data-tone="ready"]::before {
    background: #2f80ff;
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.32);
  }

  &[data-tone="needsAuth"]::before {
    background: #ff7a18;
  }
`;

const AgentCardHeader = styled.div`
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
`;

const AgentIcon = styled.span`
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(255, 255, 255, 0.04);

  svg {
    width: 19px;
    height: 19px;
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.36);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.14);
  }
`;

const AgentName = styled.h3`
  margin: 0;
  overflow: hidden;
  color: #f7f9ff;
  font-size: 15px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentMeta = styled.p`
  margin: 3px 0 0;
  overflow: hidden;
  color: #687386;
  font-size: 12px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentStatusText = styled.p`
  margin: 0;
  min-height: 38px;
  color: #a7b2c2;
  font-size: 13px;
  line-height: 1.45;
`;

const AgentInstallPanel = styled.div`
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
`;

const AgentInstallTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #f7f9ff;
  font-size: 12px;
  font-weight: 860;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AgentInstallBadge = styled.span`
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid rgba(47, 128, 255, 0.34);
  border-radius: 999px;
  color: #8bb9ff;
  background: rgba(47, 128, 255, 0.12);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
`;

const AgentInstallHint = styled.p`
  margin: 0;
  color: #8793a5;
  font-size: 12px;
  font-weight: 720;
  line-height: 1.45;
`;

const AgentInstallActions = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
`;

const AgentInstallCommand = styled.code`
  display: block;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(3, 5, 8, 0.54);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentPermissionHint = styled.p`
  margin: 0;
  padding: 8px 9px;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.1);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
`;

const AgentInstallMessage = styled.p`
  margin: 0;
  padding: 8px 9px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.58);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
  overflow-wrap: anywhere;

  &[data-tone="success"] {
    border-color: rgba(47, 128, 255, 0.32);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.1);
  }

  &[data-tone="warning"] {
    border-color: rgba(255, 122, 24, 0.34);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.1);
  }
`;

const AgentActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const AgentActionTooltip = styled.span`
  display: block;
  min-width: 0;

  button {
    width: 100%;
  }
`;

const PageHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  @media (max-width: 760px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const PageSubline = styled.p`
  margin: 7px 0 0;
  color: #a7b2c2;
  font-size: 14px;
  line-height: 1.5;
`;

const DashboardTitle = styled.h1`
  margin: 6px 0 0;
  color: #ffffff;
  font-size: 28px;
  font-weight: 850;
  letter-spacing: 0;
`;

const PanelHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;

  > div:first-child {
    min-width: 0;
  }
`;

const PanelKicker = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.11em;
  text-transform: uppercase;
`;

const PanelHeading = styled.h2`
  margin: 4px 0 0;
  color: #f7f9ff;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0;
`;

const SettingsPage = styled.section`
  display: grid;
  grid-column: 2 / -1;
  align-content: start;
  gap: 18px;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.1);
  background-size: 72px 72px, 72px 72px, auto;
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 760px) {
    grid-column: 1;
    padding: 18px;
  }
`;

const AccountSettingsPanel = styled.section`
  display: grid;
  gap: 14px;
  padding-top: 8px;
`;

const AccountCard = styled.section`
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(47, 128, 255, 0.32);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.13), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.016)),
    rgba(13, 20, 31, 0.86);
`;

const AccountCardHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;

  > div:first-child {
    display: grid;
    min-width: min(100%, 280px);
    gap: 10px;
  }
`;

const AccountCardFooter = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 2px;

  button {
    min-height: 42px;
    min-width: 132px;
  }

  @media (max-width: 760px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

const SettingsLabel = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const SettingsValue = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #ffffff;
  font-size: 19px;
  font-weight: 820;
  line-height: 1.25;
`;

const SettingsHint = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #a7b2c2;
  font-size: 13px;
  line-height: 1.55;
`;

const SettingsIdentityGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const SettingsIdentityItem = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.58);

  span {
    color: #687386;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 860;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const LoginCard = styled.section`
  position: relative;
  z-index: 1;
  width: 100%;
  padding: clamp(20px, 4vh, 30px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background:
    radial-gradient(circle at 86% 10%, rgba(47, 128, 255, 0.16), transparent 14rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    rgba(10, 15, 23, 0.88);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.46);
  animation: ${sideReveal} 320ms cubic-bezier(0.2, 0.8, 0.2, 1) 110ms both;

  @media (max-width: 860px) {
    padding: 24px;
  }
`;

const LoginPanel = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

const SessionPanel = styled.div`
  display: grid;
  gap: 16px;
`;

const LoginCardTop = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
`;

const LoginCardBadge = styled.span`
  padding: 5px 9px;
  border: 1px solid rgba(47, 128, 255, 0.36);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &[data-state="waiting"],
  &[data-state="exchanging"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.14);
  }
`;

const LoginIconWrap = styled.span`
  display: grid;
  width: clamp(38px, 6vh, 44px);
  height: clamp(38px, 6vh, 44px);
  place-items: center;
  border: 1px solid rgba(47, 128, 255, 0.42);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);
  box-shadow: 0 0 18px rgba(47, 128, 255, 0.14);
  transition:
    background 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease;

  ${LoginPanel}:hover & {
    transform: translateY(-1px) scale(1.02);
  }
`;

const SuccessBadge = styled(LoginIconWrap)`
  border-color: rgba(255, 122, 24, 0.42);
  color: #ff9a3d;
  background: rgba(255, 122, 24, 0.14);
`;

const SessionTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: clamp(21px, 3.5vh, 24px);
  font-weight: 820;
  letter-spacing: 0;
`;

const SessionText = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #a7b2c2;
  font-size: 15px;
  line-height: 1.55;
`;

const AuthStepRail = styled.div`
  display: grid;
  gap: 9px;
  padding: clamp(10px, 2vh, 14px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
`;

const AuthStep = styled.div`
  display: grid;
  min-height: clamp(30px, 5vh, 38px);
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  color: #a7b2c2;
  font-size: 12px;
  font-weight: 800;
  opacity: 0;
  animation: ${panelEnter} 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &:nth-child(1) {
    animation-delay: 170ms;
  }

  &:nth-child(2) {
    animation-delay: 205ms;
  }

  &:nth-child(3) {
    animation-delay: 240ms;
  }

  span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #687386;
    background: rgba(255, 255, 255, 0.04);
    font-size: 11px;
  }

  &[data-active="true"] {
    color: #f7f9ff;
  }

  &[data-active="true"] span {
    border-color: rgba(47, 128, 255, 0.42);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }
`;

const PrimaryButton = styled.button`
  display: inline-flex;
  min-width: 0;
  min-height: clamp(44px, 6.5vh, 50px);
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  color: #ffffff;
  background: #2f80ff;
  font-weight: 880;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    background: #62a0ff;
    box-shadow: 0 0 18px rgba(47, 128, 255, 0.24);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.7;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const SecondaryButton = styled(PrimaryButton)`
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.76);

  &:hover:not(:disabled) {
    border-color: rgba(47, 128, 255, 0.5);
    background: rgba(255, 255, 255, 0.08);
  }
`;

const PrimaryDangerButton = styled(SecondaryButton)`
  border-color: rgba(255, 140, 140, 0.28);
  color: #ffd2d2;

  &:hover:not(:disabled) {
    border-color: rgba(255, 140, 140, 0.5);
    background: rgba(255, 140, 140, 0.1);
  }
`;

const FormMessage = styled.p`
  margin: 0;
  padding: ${({ $state }) => ($state === "error" ? "11px 13px" : 0)};
  border: ${({ $state }) => ($state === "error" ? "1px solid rgba(255, 107, 107, 0.34)" : 0)};
  border-radius: ${({ $state }) => ($state === "error" ? "8px" : 0)};
  color: ${({ $state }) => ($state === "error" ? "#ffd0d0" : "#a7b2c2")};
  background: ${({ $state }) => ($state === "error" ? "rgba(255, 107, 107, 0.12)" : "transparent")};
  font-size: 14px;
  line-height: 1.55;
`;

const buttonIconSize = `
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
`;

const titleIconSize = `
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
`;

const TitleMinimizeIcon = styled(Remove)`
  ${titleIconSize}
`;

const TitleMaximizeIcon = styled(CropSquare)`
  ${titleIconSize}
`;

const TitleRestoreIcon = styled(FullscreenExit)`
  ${titleIconSize}
`;

const TitleCloseIcon = styled(Close)`
  ${titleIconSize}
`;

const ButtonRefreshIcon = styled(Refresh)`
  ${buttonIconSize}
`;

const ButtonAddIcon = styled(Add)`
  ${buttonIconSize}
`;

const ButtonLoginIcon = styled(Login)`
  ${buttonIconSize}
`;

const ButtonBrowserIcon = styled(OpenInBrowser)`
  ${buttonIconSize}
`;

const ButtonCloseIcon = styled(Close)`
  ${buttonIconSize}
`;

const ButtonFolderIcon = styled(FolderOpen)`
  ${buttonIconSize}
`;

const ButtonLogoutIcon = styled(Logout)`
  ${buttonIconSize}
`;

const ButtonSettingsIcon = styled(Settings)`
  ${buttonIconSize}
`;

const ButtonForgeIcon = styled(Bolt)`
  ${buttonIconSize}
`;

const ButtonCodeIcon = styled(Code)`
  ${buttonIconSize}
`;

const ButtonBotIcon = styled(SmartToy)`
  ${buttonIconSize}
`;

const ButtonTerminalIcon = styled(TerminalIcon)`
  ${buttonIconSize}
`;

const ButtonKeyIcon = styled(Key)`
  ${buttonIconSize}
`;

const ButtonMicIcon = styled(Mic)`
  ${buttonIconSize}
`;

const ButtonHubIcon = styled(Hub)`
  ${buttonIconSize}
`;

const ButtonCheckIcon = styled(CheckCircle)`
  ${buttonIconSize}
`;

const FileChevronIcon = styled(ChevronRight)`
  width: 16px;
  height: 16px;
`;

const FileExpandIcon = styled(ExpandMore)`
  width: 16px;
  height: 16px;
`;

const FileFolderTreeIcon = styled(FolderOpen)`
  width: 16px;
  height: 16px;
`;

const FileDocumentIcon = styled(Description)`
  width: 16px;
  height: 16px;
`;
