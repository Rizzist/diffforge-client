import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FileContextMenu,
  FileContextMenuItem,
  FileDisclosure,
  FileKindIcon,
  FileRenameInput,
  FileTreeName,
  FileGitStatusMark,
  FileTreeChildren,
  FileTreeMessage,
  FileTreeEmpty,
  FilePreviewPane,
  FilePreviewHeader,
  FilePreviewTitle,
  FilePreviewMeta,
  FilePreviewModeSwitch,
  FilePreviewModeButton,
  FileGitStatusPill,
  FileMetaPill,
  FilePreviewPath,
  FileContentFrame,
  FilePreviewScroll,
  FileImagePreviewSurface,
  FileImagePreviewImage,
  HighlightedCodeBlock,
  InlineReviewSurface,
  InlineReviewCodeBlock,
  InlineReviewLine,
  InlineReviewLineNumber,
  InlineReviewPrefix,
  InlineReviewCode,
  ReviewChangeRuler,
  ReviewChangeMarker,
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
import { logFileDragDiagnosticEvent } from "../threads/bigViewSyncDiagnostics";
import {
  clearActiveWorkspaceFileDrag,
  setActiveWorkspaceFileDrag,
} from "../terminals/WorkspaceTerminal/threadRuntime.js";

// The Files view unmounts on every tab switch, dropping the tree. This
// module-level cache survives that: on remount the cached listings and
// expanded folders paint instantly while every visible directory re-lists
// silently in the background (stale-while-revalidate). Listings are tiny
// (~100 bytes/entry), so even several workspaces stay in the low MBs; file
// previews and image data URLs are intentionally never cached.
const FILES_EXPLORER_CACHE_LIMIT = 8;
const FILES_EXPLORER_REVALIDATE_LIMIT = 16;
const filesExplorerListingCache = new Map();

function rememberFilesExplorerListings(workspaceRoot, snapshot) {
  if (!workspaceRoot) return;
  filesExplorerListingCache.delete(workspaceRoot);
  filesExplorerListingCache.set(workspaceRoot, snapshot);
  while (filesExplorerListingCache.size > FILES_EXPLORER_CACHE_LIMIT) {
    const oldestKey = filesExplorerListingCache.keys().next().value;
    if (oldestKey === undefined) break;
    filesExplorerListingCache.delete(oldestKey);
  }
}

const FILE_EXPLORER_LAYOUT_STORAGE_KEY = "diffforge.fileExplorerLayout.v1";
const FILE_EXPLORER_DEFAULT_SIZE = 28;
const FILE_EXPLORER_MIN_SIZE = 16;
const FILE_EXPLORER_MAX_SIZE = 76;
const FILE_PREVIEW_DEFAULT_SIZE = 72;
const FILE_PREVIEW_MIN_SIZE = 24;
const FILE_PREVIEW_MAX_SIZE = 84;
const WORKSPACE_FILE_OPEN_EVENT = "diffforge:workspace-file-open";
const WORKSPACE_FILE_DRAG_MIME = "application/x-diffforge-workspace-file";

function joinWorkspaceFilePath(root, relativePath) {
  const cleanRoot = String(root || "").replace(/\/+$/g, "");
  const cleanRelativePath = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/g, "");
  return cleanRoot && cleanRelativePath ? `${cleanRoot}/${cleanRelativePath}` : cleanRelativePath;
}

function normalizeWorkspaceRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/g, "").replace(/\/+$/g, "");
}

function getWorkspaceRelativeParentPath(value) {
  const parts = normalizeWorkspaceRelativePath(value).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function workspaceRelativePathIsSameOrChild(path, parentPath) {
  const safePath = normalizeWorkspaceRelativePath(path);
  const safeParent = normalizeWorkspaceRelativePath(parentPath);
  return safePath === safeParent || Boolean(safeParent && safePath.startsWith(`${safeParent}/`));
}

function clampNumber(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(Math.max(numericValue, min), max);
}

function isPreviewableImageFile(relativePath) {
  return ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(getFileExtension(relativePath));
}

function getWorkspaceDragPayloadFromDataTransfer(dataTransfer) {
  if (!dataTransfer) {
    return null;
  }

  try {
    const rawPayload = dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME);
    if (!rawPayload) {
      return null;
    }

    const payload = JSON.parse(rawPayload);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function dataTransferHasWorkspaceFile(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes(WORKSPACE_FILE_DRAG_MIME);
}

function getFileDragElementSummary(element) {
  if (!element || typeof element !== "object") {
    return null;
  }

  const dataAttrs = {};
  Array.from(element.attributes || []).forEach((attribute) => {
    if (String(attribute.name || "").startsWith("data-")) {
      dataAttrs[attribute.name] = String(attribute.value || "");
    }
  });

  return {
    className: typeof element.className === "string" ? element.className.slice(0, 220) : "",
    dataAttrs,
    id: String(element.id || ""),
    tagName: String(element.tagName || "").toLowerCase(),
  };
}

function getFileDragPointDiagnostic(event) {
  const clientX = Number(event?.clientX || 0);
  const clientY = Number(event?.clientY || 0);
  const targetElement = clientX || clientY ? document.elementFromPoint(clientX, clientY) : null;
  return {
    clientX,
    clientY,
    targetElement: getFileDragElementSummary(targetElement),
    types: Array.from(event?.dataTransfer?.types || []),
  };
}
const FILE_PREVIEW_MODES = [
  { id: "file", label: "File" },
  { id: "review", label: "Review" },
  { id: "diff", label: "Diff" },
];
let fileExplorerLayoutFlushFrame = 0;
let pendingFileExplorerLayout = null;

function toPanelPercent(value) {
  const numericValue = Number(value);
  return `${Number.isFinite(numericValue) ? numericValue : 0}%`;
}

function getFileExplorerLayoutSizes(layout, explorerPanelId, previewPanelId) {
  if (Array.isArray(layout)) {
    return layout;
  }

  if (!layout || typeof layout !== "object") {
    return [FILE_EXPLORER_DEFAULT_SIZE, FILE_PREVIEW_DEFAULT_SIZE];
  }

  const explorerSize = layout[explorerPanelId];
  const previewSize = layout[previewPanelId];

  if (Number.isFinite(Number(explorerSize)) && Number.isFinite(Number(previewSize))) {
    return [explorerSize, previewSize];
  }

  return [FILE_EXPLORER_DEFAULT_SIZE, FILE_PREVIEW_DEFAULT_SIZE];
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

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
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

export function getDirectoryName(directory) {
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
    webm: "Video",
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
    webm: { codicon: "codicon-file-media", tone: "media" },
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

function getHighlightedLineHtml(content, relativePath) {
  return getHighlightedFileHtml(content || " ", relativePath);
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

function getContentLines(content) {
  const value = String(content || "");

  if (!value) {
    return [""];
  }

  return value.split(/\r?\n/);
}

function clampReviewIndex(index, lineCount) {
  return Math.max(0, Math.min(lineCount, Number(index) || 0));
}

function getReviewMarkerTop(lineNumber, lineCount) {
  const safeLineCount = Math.max(1, lineCount);

  if (safeLineCount === 1) {
    return 0;
  }

  const safeLineNumber = Math.max(1, Math.min(safeLineCount, Number(lineNumber) || 1));
  return Number((((safeLineNumber - 1) / (safeLineCount - 1)) * 100).toFixed(3));
}

function getInlineReviewModel({ content, diff, relativePath }) {
  const fileLines = getContentLines(content);
  const lineCount = fileLines.length;
  const insertedRows = new Map();
  const lineTones = new Map();
  const markers = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let hunkActive = false;
  let pendingRemovedLines = [];

  const addMarker = (tone, lineNumber) => {
    markers.push({
      id: `${tone}-${markers.length}-${lineNumber}`,
      lineNumber,
      tone,
      top: getReviewMarkerTop(lineNumber, lineCount),
    });
  };

  const addInsertedRow = (anchorIndex, row) => {
    const safeAnchorIndex = clampReviewIndex(anchorIndex, lineCount);
    const rows = insertedRows.get(safeAnchorIndex) || [];
    rows.push(row);
    insertedRows.set(safeAnchorIndex, rows);
  };

  const addRemovedLine = (anchorIndex, removedLine) => {
    const safeAnchorIndex = clampReviewIndex(anchorIndex, lineCount);
    const markerLineNumber = Math.max(1, Math.min(lineCount, safeAnchorIndex + 1));

    addInsertedRow(safeAnchorIndex, {
      html: getHighlightedLineHtml(removedLine.text, relativePath),
      id: `removed-${removedLine.oldLineNumber}-${safeAnchorIndex}-${removedLine.text.slice(0, 18)}`,
      kind: "removed",
      oldLineNumber: removedLine.oldLineNumber,
      prefix: "-",
      tone: "removed",
    });
    addMarker("removed", markerLineNumber);
  };

  const flushRemovedLines = (anchorIndex) => {
    pendingRemovedLines.forEach((removedLine) => addRemovedLine(anchorIndex, removedLine));
    pendingRemovedLines = [];
  };

  String(diff || "").split(/\r?\n/).forEach((line) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);

    if (hunkMatch) {
      flushRemovedLines(newLineNumber ? newLineNumber - 1 : 0);
      oldLineNumber = Number(hunkMatch[1]) || 1;
      newLineNumber = Number(hunkMatch[2]) || 1;
      hunkActive = true;
      return;
    }

    if (!hunkActive || line.startsWith("\\ No newline")) {
      return;
    }

    if (line.startsWith(" ")) {
      flushRemovedLines(newLineNumber - 1);
      oldLineNumber += 1;
      newLineNumber += 1;
      return;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      pendingRemovedLines.push({
        oldLineNumber,
        text: line.slice(1),
      });
      oldLineNumber += 1;
      return;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const fileLineIndex = clampReviewIndex(newLineNumber - 1, lineCount - 1);

      if (pendingRemovedLines.length > 0) {
        addRemovedLine(fileLineIndex, pendingRemovedLines.shift());
      }

      lineTones.set(fileLineIndex, "added");
      addMarker("added", newLineNumber);
      newLineNumber += 1;
    }
  });

  flushRemovedLines(lineCount);

  const rows = [];

  fileLines.forEach((line, index) => {
    rows.push(...(insertedRows.get(index) || []));
    rows.push({
      html: getHighlightedLineHtml(line, relativePath),
      id: `line-${index + 1}`,
      kind: "file",
      lineNumber: index + 1,
      prefix: lineTones.get(index) === "added" ? "+" : " ",
      tone: lineTones.get(index) || "context",
    });
  });
  rows.push(...(insertedRows.get(lineCount) || []));

  return {
    markers,
    rows,
  };
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

function FileTreeNode({
  activeDropTargetPath = null,
  directoryEntries,
  directoryErrors,
  directoryStates,
  draggingFilePath = "",
  entry,
  expandedDirectories,
  isWorkspaceDragActive = false,
  onBeginWorkspaceFileDrag,
  onContextMenuEntry,
  onMoveEntry,
  onOpenFile,
  onRenameCancel,
  onRenameCommit,
  onRenameDraftChange,
  onStartInternalDrag,
  onToggleDirectory,
  renameDraft = "",
  renamingPath = "",
  selectedFilePath,
  workspaceId,
  workspaceRoot,
  depth = 0,
}) {
  const renameInputRef = useRef(null);
  const fileDragDebugRef = useRef({
    cleanup: null,
    lastLogAt: 0,
    lastPoint: null,
  });
  const filePointerDragRef = useRef(null);
  const suppressFileClickRef = useRef(false);
  const isDirectory = entry.kind === "directory";
  const directoryPath = entry.relativePath || "";
  const normalizedEntryPath = normalizeWorkspaceRelativePath(entry.relativePath || entry.name || "");
  const isRootEntry = !normalizedEntryPath;
  const isRenaming = Boolean(renamingPath && renamingPath === normalizedEntryPath);
  const isDraggingThisEntry = Boolean(draggingFilePath && draggingFilePath === normalizedEntryPath);
  const isDropTarget = Boolean(isWorkspaceDragActive || draggingFilePath)
    && isDirectory
    && activeDropTargetPath !== null
    && activeDropTargetPath === normalizedEntryPath
    && !isDraggingThisEntry;
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
  const getWorkspaceFilePayload = () => {
    const relativePath = normalizeWorkspaceRelativePath(entry.relativePath || entry.name || "");
    const absolutePath = joinWorkspaceFilePath(workspaceRoot, relativePath);
    return {
      absolutePath,
      payload: {
        kind: entry.kind || "file",
        mountId: entry.mountId || "",
        name: getExplorerFileName(relativePath),
        path: absolutePath,
        projectRelativePath: entry.projectRelativePath || "",
        projectRoot: entry.projectRoot || "",
        relativePath,
        workspaceId: workspaceId || "",
        workspaceRoot: workspaceRoot || "",
      },
      relativePath,
    };
  };

  useEffect(() => {
    if (!isRenaming) {
      return;
    }

    const input = renameInputRef.current;
    input?.focus();
    input?.select();
  }, [isRenaming]);

  return (
    <FileTreeItem>
      <FileTreeButton
        $depth={depth}
        as={isRenaming ? "div" : "button"}
        data-drop-target={isDropTarget || undefined}
        data-git-status={gitStatus || undefined}
        data-selected={!isDirectory && selectedFilePath === entry.relativePath}
        draggable={!isRenaming && !isRootEntry}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenuEntry?.(event, entry);
        }}
        onDragOver={(event) => {
          const hasWorkspaceDrag = Boolean(draggingFilePath) || dataTransferHasWorkspaceFile(event.dataTransfer);
          if (!isDirectory || !onMoveEntry || !hasWorkspaceDrag || isDraggingThisEntry) {
            return;
          }

          if (
            draggingFilePath
            && normalizedEntryPath
            && workspaceRelativePathIsSameOrChild(normalizedEntryPath, draggingFilePath)
          ) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          onStartInternalDrag?.({
            dropTargetPath: normalizedEntryPath,
            isWorkspaceDragActive: true,
          });
        }}
        onDragLeave={(event) => {
          if (!isDirectory || !event.currentTarget.contains(event.relatedTarget)) {
            onStartInternalDrag?.({ dropTargetPath: null });
          }
        }}
        onDrop={(event) => {
          const droppedPayload = getWorkspaceDragPayloadFromDataTransfer(event.dataTransfer);
          const droppedPath = normalizeWorkspaceRelativePath(draggingFilePath || droppedPayload?.relativePath || "");
          if (!isDirectory || !onMoveEntry || !droppedPath || isDraggingThisEntry) {
            return;
          }

          if (normalizedEntryPath && workspaceRelativePathIsSameOrChild(normalizedEntryPath, droppedPath)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onStartInternalDrag?.({ dropTargetPath: null });
          onMoveEntry(droppedPath, normalizedEntryPath);
        }}
        onPointerCancel={(event) => {
          if (filePointerDragRef.current?.pointerId === event.pointerId) {
            filePointerDragRef.current = null;
          }
        }}
        onPointerDown={(event) => {
          if (isRenaming || isRootEntry || event.button !== 0 || onMoveEntry) {
            return;
          }

          const { absolutePath, payload, relativePath } = getWorkspaceFilePayload();
          const rect = event.currentTarget.getBoundingClientRect();
          filePointerDragRef.current = {
            absolutePath,
            payload,
            pointerId: event.pointerId,
            rect,
            relativePath,
            startX: event.clientX,
            startY: event.clientY,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = filePointerDragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }

          const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
          if (distance < 5) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressFileClickRef.current = true;
          filePointerDragRef.current = null;
          setActiveWorkspaceFileDrag(drag.payload);
          onStartInternalDrag?.({
            dropTargetPath: null,
            entry,
            isWorkspaceDragActive: true,
            relativePath: drag.relativePath,
          });
          onBeginWorkspaceFileDrag?.({
            clientX: event.clientX,
            clientY: event.clientY,
            file: drag.payload,
            height: Math.max(36, Number(drag.rect?.height || 0)),
            offsetX: Math.max(12, Math.min(Number(drag.rect?.width || 220) - 4, drag.startX - Number(drag.rect?.left || 0))),
            offsetY: Math.max(8, Math.min(Number(drag.rect?.height || 40) - 4, drag.startY - Number(drag.rect?.top || 0))),
            pointerId: event.pointerId,
            width: Math.max(220, Number(drag.rect?.width || 0)),
          });
          logFileDragDiagnosticEvent("fileviewer.pointer_drag_start", {
            clientX: event.clientX,
            clientY: event.clientY,
            hasAbsolutePath: Boolean(drag.absolutePath),
            name: drag.payload.name,
            path: drag.absolutePath,
            relativePath: drag.relativePath,
            workspaceId: workspaceId || "",
          });
        }}
        onPointerUp={(event) => {
          if (filePointerDragRef.current?.pointerId === event.pointerId) {
            filePointerDragRef.current = null;
          }
        }}
        onDrag={(event) => {
          if (isRenaming || isRootEntry) {
            return;
          }

          const now = Date.now();
          const diagnostic = getFileDragPointDiagnostic(event);
          fileDragDebugRef.current.lastPoint = diagnostic;
          if (now - Number(fileDragDebugRef.current.lastLogAt || 0) < 180) {
            return;
          }

          fileDragDebugRef.current.lastLogAt = now;
          logFileDragDiagnosticEvent("fileviewer.drag_move", {
            ...diagnostic,
            relativePath: normalizeWorkspaceRelativePath(entry.relativePath || entry.name || ""),
            workspaceId: workspaceId || "",
          });
        }}
        onDragStart={(event) => {
          if (isRenaming || isRootEntry) {
            return;
          }

          const relativePath = normalizeWorkspaceRelativePath(entry.relativePath || entry.name || "");
          const absolutePath = joinWorkspaceFilePath(workspaceRoot, relativePath);
          const payload = {
            kind: entry.kind || "file",
            mountId: entry.mountId || "",
            name: getExplorerFileName(relativePath),
            path: absolutePath,
            projectRelativePath: entry.projectRelativePath || "",
            projectRoot: entry.projectRoot || "",
            relativePath,
            workspaceId: workspaceId || "",
            workspaceRoot: workspaceRoot || "",
          };
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(payload));
          event.dataTransfer.setData("text/plain", absolutePath || relativePath);
          setActiveWorkspaceFileDrag(payload);
          onStartInternalDrag?.({
            dropTargetPath: null,
            entry,
            isWorkspaceDragActive: true,
            relativePath,
          });
          const logWindowDragEvent = (phase) => (windowEvent) => {
            logFileDragDiagnosticEvent(phase, {
              ...getFileDragPointDiagnostic(windowEvent),
              relativePath,
              workspaceId: workspaceId || "",
            });
          };
          const windowDragOverListener = logWindowDragEvent("fileviewer.window_drag_over_capture");
          const windowDropListener = logWindowDragEvent("fileviewer.window_drop_capture");
          window.addEventListener("dragover", windowDragOverListener, true);
          window.addEventListener("drop", windowDropListener, true);
          fileDragDebugRef.current.cleanup?.();
          fileDragDebugRef.current.cleanup = () => {
            window.removeEventListener("dragover", windowDragOverListener, true);
            window.removeEventListener("drop", windowDropListener, true);
            fileDragDebugRef.current.cleanup = null;
          };
          logFileDragDiagnosticEvent("fileviewer.drag_start", {
            ...getFileDragPointDiagnostic(event),
            hasAbsolutePath: Boolean(absolutePath),
            name: payload.name,
            path: absolutePath,
            relativePath,
            workspaceId: workspaceId || "",
          });
        }}
        onDragEnd={(event) => {
          fileDragDebugRef.current.cleanup?.();
          logFileDragDiagnosticEvent("fileviewer.drag_end", {
            ...getFileDragPointDiagnostic(event),
            lastPoint: fileDragDebugRef.current.lastPoint,
            relativePath: normalizeWorkspaceRelativePath(entry.relativePath || entry.name || ""),
            workspaceId: workspaceId || "",
          });
          window.setTimeout(() => {
            clearActiveWorkspaceFileDrag();
            onStartInternalDrag?.({
              dropTargetPath: null,
              entry: null,
              isWorkspaceDragActive: false,
              relativePath: "",
            });
            logFileDragDiagnosticEvent("fileviewer.drag_end_clear", {
              relativePath: normalizeWorkspaceRelativePath(entry.relativePath || entry.name || ""),
              workspaceId: workspaceId || "",
            });
          }, 120);
        }}
        onClick={() => {
          if (isRenaming) {
            return;
          }
          if (suppressFileClickRef.current) {
            suppressFileClickRef.current = false;
            return;
          }

          if (isDirectory) {
            onToggleDirectory(entry);
            return;
          }

          onOpenFile(entry);
        }}
        title={entry.isProjectMount && entry.projectRoot ? entry.projectRoot : entry.relativePath || entry.name}
        type={isRenaming ? undefined : "button"}
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
        {isRenaming ? (
          <FileRenameInput
            aria-label={`Rename ${entry.name}`}
            onBlur={onRenameCommit}
            onChange={(event) => onRenameDraftChange?.(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRenameCommit?.();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onRenameCancel?.();
              }
            }}
            ref={renameInputRef}
            value={renameDraft}
          />
        ) : (
          <FileTreeName data-git-status={gitStatus || undefined}>{entry.name}</FileTreeName>
        )}
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
              activeDropTargetPath={activeDropTargetPath}
              depth={depth + 1}
              directoryEntries={directoryEntries}
              directoryErrors={directoryErrors}
              directoryStates={directoryStates}
              draggingFilePath={draggingFilePath}
              entry={childEntry}
              expandedDirectories={expandedDirectories}
              isWorkspaceDragActive={isWorkspaceDragActive}
              key={`${childEntry.kind}-${childEntry.relativePath}`}
              onBeginWorkspaceFileDrag={onBeginWorkspaceFileDrag}
              onContextMenuEntry={onContextMenuEntry}
              onMoveEntry={onMoveEntry}
              onOpenFile={onOpenFile}
              onRenameCancel={onRenameCancel}
              onRenameCommit={onRenameCommit}
              onRenameDraftChange={onRenameDraftChange}
              onStartInternalDrag={onStartInternalDrag}
              onToggleDirectory={onToggleDirectory}
              renameDraft={renameDraft}
              renamingPath={renamingPath}
              selectedFilePath={selectedFilePath}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
            />
          ))}
        </FileTreeChildren>
      )}
    </FileTreeItem>
  );
}

export default function FilesWorkspaceView({
  defaultWorkingDirectory,
  onBeginWorkspaceFileDrag,
  onOpenWorkspaceSettings,
  rootDirectory,
  workspace,
  workspaceError,
}) {
  const filesSurfaceRef = useRef(null);
  const filePreviewScrollRef = useRef(null);
  const fileRequestIdRef = useRef(0);
  const renameCommitInFlightRef = useRef(false);
  const cacheWriteGateRef = useRef({ armed: false, root: "" });
  const internalFileDragRef = useRef({
    dropTargetPath: null,
    entry: null,
    isWorkspaceDragActive: false,
    relativePath: "",
  });
  const [directoryEntries, setDirectoryEntries] = useState({});
  const [directoryStates, setDirectoryStates] = useState({});
  const [directoryErrors, setDirectoryErrors] = useState({});
  const [expandedDirectories, setExpandedDirectories] = useState({ "": true });
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState("");
  const [fileImageDataUrl, setFileImageDataUrl] = useState("");
  const [fileImageMimeType, setFileImageMimeType] = useState("");
  const [fileState, setFileState] = useState("idle");
  const [fileError, setFileError] = useState("");
  const [fileDiff, setFileDiff] = useState("");
  const [fileDiffState, setFileDiffState] = useState("idle");
  const [fileDiffError, setFileDiffError] = useState("");
  const [fileDiffTruncated, setFileDiffTruncated] = useState(false);
  const [filePreviewMode, setFilePreviewMode] = useState("file");
  const [reviewRulerHeight, setReviewRulerHeight] = useState(0);
  const [fileContextMenu, setFileContextMenu] = useState(null);
  const [renamingPath, setRenamingPath] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [fileOperationError, setFileOperationError] = useState("");
  const [internalFileDrag, setInternalFileDrag] = useState({
    dropTargetPath: null,
    entry: null,
    isWorkspaceDragActive: false,
    relativePath: "",
  });
  const workspaceId = workspace?.id || "";
  const workspaceRoot = workspaceId
    ? cleanWorkspaceRootDirectory(rootDirectory || defaultWorkingDirectory)
    : "";
  const fileExplorerLayoutOwner = workspaceId || workspaceRoot;
  const fileExplorerLayoutKey = useMemo(
    () => getFileExplorerLayoutKey(fileExplorerLayoutOwner),
    [fileExplorerLayoutOwner],
  );
  const fileExplorerGroupId = `files-layout-${fileExplorerLayoutKey}`;
  const fileExplorerPanelId = `files-explorer-${fileExplorerLayoutKey}`;
  const filePreviewPanelId = `files-preview-${fileExplorerLayoutKey}`;
  const fileExplorerLayout = useMemo(
    () => getFileExplorerLayout(fileExplorerLayoutOwner),
    [fileExplorerLayoutOwner],
  );
  const fileExplorerDefaultLayout = useMemo(
    () => ({
      [fileExplorerPanelId]: fileExplorerLayout[0],
      [filePreviewPanelId]: fileExplorerLayout[1],
    }),
    [fileExplorerLayout, fileExplorerPanelId, filePreviewPanelId],
  );
  const rootEntry = useMemo(() => ({
    kind: "directory",
    name: getDirectoryName(workspaceRoot),
    relativePath: "",
  }), [workspaceRoot]);

  const queueExplorerLayout = useCallback((layout) => {
    queueFileExplorerLayout({
      workspaceId: fileExplorerLayoutOwner,
      sizes: getFileExplorerLayoutSizes(layout, fileExplorerPanelId, filePreviewPanelId),
    });
  }, [fileExplorerLayoutOwner, fileExplorerPanelId, filePreviewPanelId]);

  const loadDirectory = useCallback(async (relativePath = "", { silent = false } = {}) => {
    const directoryPath = relativePath || "";

    if (!workspaceRoot) {
      setDirectoryStates((states) => ({ ...states, [directoryPath]: "error" }));
      setDirectoryErrors((errors) => ({
        ...errors,
        [directoryPath]: "No workspace directory selected.",
      }));
      return;
    }

    // Silent revalidate: cached entries stay on screen while the fresh
    // listing replaces them, instead of collapsing into a "Loading..." row.
    if (!silent) {
      setDirectoryStates((states) => ({ ...states, [directoryPath]: "loading" }));
    }
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

    const relativePath = normalizeWorkspaceRelativePath(entry.relativePath);
    const shouldPreviewImage = isPreviewableImageFile(relativePath);
    const requestId = fileRequestIdRef.current + 1;
    fileRequestIdRef.current = requestId;
    setSelectedFile(entry);
    setFileContent("");
    setFileImageDataUrl("");
    setFileImageMimeType("");
    setFileState("loading");
    setFileError("");
    setFileDiff("");
    setFileDiffState("idle");
    setFileDiffError("");
    setFileDiffTruncated(false);
    setFilePreviewMode("file");

    try {
      const result = await invoke(shouldPreviewImage ? "read_workspace_file_image" : "read_workspace_file", {
        root: workspaceRoot,
        relativePath,
      });

      if (fileRequestIdRef.current !== requestId) {
        return;
      }

      const nextGitStatus = normalizeGitStatus(result?.gitStatus || "");

      setSelectedFile({
        ...entry,
        gitStatus: nextGitStatus,
        mountId: result?.mountId || entry.mountId || "",
        size: result?.size ?? entry.size,
        modifiedMs: result?.modifiedMs ?? entry.modifiedMs,
        projectRelativePath: result?.projectRelativePath || entry.projectRelativePath || "",
        projectRoot: result?.projectRoot || entry.projectRoot || "",
      });
      setFileContent(shouldPreviewImage ? "" : result?.content || "");
      setFileImageDataUrl(shouldPreviewImage ? result?.dataUrl || "" : "");
      setFileImageMimeType(shouldPreviewImage ? result?.mimeType || "" : "");
      setFileState("ready");
    } catch (error) {
      if (fileRequestIdRef.current !== requestId) {
        return;
      }

      setFileState("error");
      setFileError(getErrorMessage(error, "Unable to open file."));
    }
  }, [workspaceRoot]);

  useEffect(() => {
    const handleWorkspaceFileOpen = (event) => {
      const detail = event?.detail || {};
      const targetWorkspaceId = String(detail.workspaceId || "").trim();
      const relativePath = String(detail.relativePath || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");

      if (!relativePath || (targetWorkspaceId && targetWorkspaceId !== workspaceId)) {
        return;
      }

      openFile({
        kind: "file",
        name: getExplorerFileName(relativePath),
        relativePath,
      });
      event.preventDefault?.();
    };

    window.addEventListener(WORKSPACE_FILE_OPEN_EVENT, handleWorkspaceFileOpen);
    return () => window.removeEventListener(WORKSPACE_FILE_OPEN_EVENT, handleWorkspaceFileOpen);
  }, [openFile, workspaceId]);

  const toggleDirectory = useCallback((entry) => {
    const directoryPath = entry.relativePath || "";
    const shouldExpand = !expandedDirectories[directoryPath];

    setExpandedDirectories((directories) => ({
      ...directories,
      [directoryPath]: shouldExpand,
    }));

    if (shouldExpand && directoryStates[directoryPath] !== "loading") {
      // Cached entries paint immediately; the re-list is silent so opening a
      // previously visited folder never flashes back to "Loading...".
      loadDirectory(directoryPath, { silent: Boolean(directoryEntries[directoryPath]) });
    }
  }, [directoryEntries, directoryStates, expandedDirectories, loadDirectory]);

  const clearPreview = useCallback(() => {
    fileRequestIdRef.current += 1;
    setSelectedFile(null);
    setFileContent("");
    setFileImageDataUrl("");
    setFileImageMimeType("");
    setFileState("idle");
    setFileError("");
    setFileDiff("");
    setFileDiffState("idle");
    setFileDiffError("");
    setFileDiffTruncated(false);
    setFilePreviewMode("file");
  }, []);

  const refreshOperationFolders = useCallback((sourcePath, targetPath = "") => {
    const safeSourcePath = normalizeWorkspaceRelativePath(sourcePath);
    const safeTargetPath = normalizeWorkspaceRelativePath(targetPath);
    const folders = new Set([
      getWorkspaceRelativeParentPath(safeSourcePath),
      safeTargetPath ? getWorkspaceRelativeParentPath(safeTargetPath) : "",
    ]);
    if (safeTargetPath && expandedDirectories[safeSourcePath]) {
      folders.add(safeTargetPath);
    }
    folders.forEach((folderPath) => {
      // Post-operation refreshes keep the tree on screen; the listed result
      // simply swaps in.
      void loadDirectory(folderPath, { silent: Boolean(directoryEntries[folderPath]) });
    });
  }, [directoryEntries, expandedDirectories, loadDirectory]);

  const rebaseExpandedDirectories = useCallback((sourcePath, targetPath = "") => {
    const safeSourcePath = normalizeWorkspaceRelativePath(sourcePath);
    const safeTargetPath = normalizeWorkspaceRelativePath(targetPath);
    if (!safeSourcePath) return;

    setExpandedDirectories((current) => {
      const next = {};
      Object.entries(current).forEach(([key, value]) => {
        const normalizedKey = normalizeWorkspaceRelativePath(key);
        if (!workspaceRelativePathIsSameOrChild(normalizedKey, safeSourcePath)) {
          next[key] = value;
          return;
        }

        if (!safeTargetPath) {
          return;
        }

        const suffix = normalizedKey === safeSourcePath
          ? ""
          : normalizedKey.slice(safeSourcePath.length + 1);
        const rebasedKey = [safeTargetPath, suffix].filter(Boolean).join("/");
        next[rebasedKey] = value;
      });

      const targetParent = getWorkspaceRelativeParentPath(safeTargetPath);
      next[getWorkspaceRelativeParentPath(safeSourcePath)] = true;
      if (safeTargetPath) next[targetParent] = true;
      return next;
    });
  }, []);

  const handlePathOperationPreview = useCallback((sourcePath, targetPath = "") => {
    const selectedPath = normalizeWorkspaceRelativePath(selectedFile?.relativePath || "");
    const safeSourcePath = normalizeWorkspaceRelativePath(sourcePath);
    const safeTargetPath = normalizeWorkspaceRelativePath(targetPath);
    if (!selectedPath || !safeSourcePath || !workspaceRelativePathIsSameOrChild(selectedPath, safeSourcePath)) {
      return;
    }

    if (!safeTargetPath) {
      clearPreview();
      return;
    }

    const suffix = selectedPath === safeSourcePath
      ? ""
      : selectedPath.slice(safeSourcePath.length + 1);
    const nextPath = [safeTargetPath, suffix].filter(Boolean).join("/");
    if (nextPath) {
      openFile({
        ...selectedFile,
        name: getExplorerFileName(nextPath),
        relativePath: nextPath,
      });
      return;
    }

    clearPreview();
  }, [clearPreview, openFile, selectedFile]);

  const closeFileContextMenu = useCallback(() => {
    setFileContextMenu(null);
  }, []);

  const handleFileContextMenu = useCallback((event, entry) => {
    const menuWidth = 180;
    const menuHeight = 92;
    const surfaceRect = filesSurfaceRef.current?.getBoundingClientRect?.();
    const leftBoundary = surfaceRect?.left ?? 0;
    const topBoundary = surfaceRect?.top ?? 0;
    const surfaceWidth = surfaceRect?.width ?? window.innerWidth;
    const surfaceHeight = surfaceRect?.height ?? window.innerHeight;
    const rowRect = event.currentTarget?.getBoundingClientRect?.();
    const clickX = event.clientX - leftBoundary;
    const clickY = event.clientY - topBoundary;
    const rowAlignedY = rowRect
      ? rowRect.top - topBoundary + Math.min(rowRect.height, Math.max(0, event.clientY - rowRect.top))
      : clickY;
    setFileContextMenu({
      entry,
      x: clampNumber(clickX, 8, Math.max(8, surfaceWidth - menuWidth - 8)),
      y: clampNumber(rowAlignedY, 8, Math.max(8, surfaceHeight - menuHeight - 8)),
    });
  }, []);

  const startRenameEntry = useCallback((entry) => {
    const relativePath = normalizeWorkspaceRelativePath(entry?.relativePath || "");
    if (!relativePath) return;
    closeFileContextMenu();
    setFileOperationError("");
    setRenamingPath(relativePath);
    setRenameDraft(entry?.name || getExplorerFileName(relativePath));
  }, [closeFileContextMenu]);

  const cancelRenameEntry = useCallback(() => {
    setRenamingPath("");
    setRenameDraft("");
  }, []);

  const commitRenameEntry = useCallback(async () => {
    const relativePath = normalizeWorkspaceRelativePath(renamingPath);
    const nextName = renameDraft.trim();
    const currentName = getExplorerFileName(relativePath);
    if (!relativePath || renameCommitInFlightRef.current) return;
    if (!nextName || nextName === currentName) {
      cancelRenameEntry();
      return;
    }

    renameCommitInFlightRef.current = true;
    setFileOperationError("");
    try {
      const result = await invoke("rename_workspace_entry", {
        newName: nextName,
        relativePath,
        root: workspaceRoot,
      });
      const targetPath = normalizeWorkspaceRelativePath(result?.targetRelativePath || "");
      cancelRenameEntry();
      rebaseExpandedDirectories(relativePath, targetPath);
      refreshOperationFolders(relativePath, targetPath);
      handlePathOperationPreview(relativePath, targetPath);
    } catch (error) {
      setFileOperationError(getErrorMessage(error, "Unable to rename workspace item."));
    } finally {
      renameCommitInFlightRef.current = false;
    }
  }, [
    cancelRenameEntry,
    handlePathOperationPreview,
    refreshOperationFolders,
    rebaseExpandedDirectories,
    renameDraft,
    renamingPath,
    workspaceRoot,
  ]);

  const deleteEntry = useCallback(async (entry) => {
    const relativePath = normalizeWorkspaceRelativePath(entry?.relativePath || "");
    if (!relativePath) return;
    closeFileContextMenu();
    const label = entry?.kind === "directory" ? "folder" : "file";
    const confirmed = window.confirm(`Delete ${label} "${entry?.name || getExplorerFileName(relativePath)}"?`);
    if (!confirmed) return;

    setFileOperationError("");
    try {
      await invoke("delete_workspace_entry", {
        relativePath,
        root: workspaceRoot,
      });
      rebaseExpandedDirectories(relativePath, "");
      refreshOperationFolders(relativePath, "");
      handlePathOperationPreview(relativePath, "");
    } catch (error) {
      setFileOperationError(getErrorMessage(error, "Unable to delete workspace item."));
    }
  }, [
    closeFileContextMenu,
    handlePathOperationPreview,
    refreshOperationFolders,
    rebaseExpandedDirectories,
    workspaceRoot,
  ]);

  const moveEntry = useCallback(async (relativePath, targetDirectory) => {
    const safeRelativePath = normalizeWorkspaceRelativePath(relativePath);
    const safeTargetDirectory = normalizeWorkspaceRelativePath(targetDirectory);
    if (!safeRelativePath) return;

    setFileOperationError("");
    try {
      const result = await invoke("move_workspace_entry", {
        relativePath: safeRelativePath,
        root: workspaceRoot,
        targetDirectory: safeTargetDirectory,
      });
      const targetPath = normalizeWorkspaceRelativePath(result?.targetRelativePath || "");
      internalFileDragRef.current = {
        dropTargetPath: null,
        entry: null,
        isWorkspaceDragActive: false,
        relativePath: "",
      };
      setInternalFileDrag({
        dropTargetPath: null,
        entry: null,
        isWorkspaceDragActive: false,
        relativePath: "",
      });
      rebaseExpandedDirectories(safeRelativePath, targetPath);
      refreshOperationFolders(safeRelativePath, targetPath);
      handlePathOperationPreview(safeRelativePath, targetPath);
    } catch (error) {
      internalFileDragRef.current = {
        ...internalFileDragRef.current,
        dropTargetPath: null,
        isWorkspaceDragActive: false,
      };
      setInternalFileDrag((current) => ({
        ...current,
        dropTargetPath: null,
        isWorkspaceDragActive: false,
      }));
      setFileOperationError(getErrorMessage(error, "Unable to move workspace item."));
    } finally {
      window.setTimeout(() => clearActiveWorkspaceFileDrag(), 80);
    }
  }, [
    handlePathOperationPreview,
    refreshOperationFolders,
    rebaseExpandedDirectories,
    workspaceRoot,
  ]);

  const updateInternalFileDrag = useCallback((nextDrag) => {
    setInternalFileDrag((current) => {
      const updatedDrag = {
        ...current,
        ...nextDrag,
      };
      internalFileDragRef.current = updatedDrag;
      return updatedDrag;
    });
  }, []);

  useEffect(() => {
    // Instant remount: hydrate the tree from the module cache (tab switches
    // unmount this view), then silently re-list what is visible so the
    // snapshot corrects itself without a "Loading..." pass.
    const cached = workspaceRoot ? filesExplorerListingCache.get(workspaceRoot) : null;
    const cachedEntries = cached?.directoryEntries && Object.keys(cached.directoryEntries).length
      ? cached.directoryEntries
      : null;
    const cachedExpanded = cached?.expandedDirectories && Object.keys(cached.expandedDirectories).length
      ? cached.expandedDirectories
      : null;
    cacheWriteGateRef.current = { armed: false, root: workspaceRoot };
    setDirectoryEntries(cachedEntries ? { ...cachedEntries } : {});
    setDirectoryStates(() => {
      if (!cachedEntries) return {};
      const states = {};
      Object.keys(cachedEntries).forEach((directoryPath) => {
        states[directoryPath] = "idle";
      });
      return states;
    });
    setDirectoryErrors({});
    setExpandedDirectories(cachedExpanded ? { ...cachedExpanded } : { "": true });
    setSelectedFile(null);
    setFileContent("");
    setFileImageDataUrl("");
    setFileImageMimeType("");
    setFileState("idle");
    setFileError("");
    setFileDiff("");
    setFileDiffState("idle");
    setFileDiffError("");
    setFileDiffTruncated(false);
    setFilePreviewMode("file");
    setFileContextMenu(null);
    setRenamingPath("");
    setRenameDraft("");
    setFileOperationError("");
    internalFileDragRef.current = {
      dropTargetPath: null,
      entry: null,
      isWorkspaceDragActive: false,
      relativePath: "",
    };
    setInternalFileDrag({
      dropTargetPath: null,
      entry: null,
      isWorkspaceDragActive: false,
      relativePath: "",
    });
    fileRequestIdRef.current += 1;

    if (workspaceRoot) {
      if (cachedEntries) {
        const expanded = cachedExpanded || { "": true };
        const visibleDirectories = Object.keys(cachedEntries)
          .filter((directoryPath) => directoryPath === "" || expanded[directoryPath]);
        if (!visibleDirectories.includes("")) {
          visibleDirectories.unshift("");
        }
        visibleDirectories
          .slice(0, FILES_EXPLORER_REVALIDATE_LIMIT)
          .forEach((directoryPath) => {
            void loadDirectory(directoryPath, { silent: true });
          });
      } else {
        loadDirectory("");
      }
    }
  }, [loadDirectory, workspace?.id, workspaceRoot]);

  // Write-through: every committed tree change refreshes the cache snapshot.
  // The gate skips the one stale invocation that fires in the same commit as
  // a workspace switch (state still holds the previous workspace's tree).
  useEffect(() => {
    const gate = cacheWriteGateRef.current;
    if (!workspaceRoot || gate.root !== workspaceRoot) return;
    if (!gate.armed) {
      gate.armed = true;
      return;
    }
    rememberFilesExplorerListings(workspaceRoot, {
      directoryEntries,
      expandedDirectories,
    });
  }, [directoryEntries, expandedDirectories, workspaceRoot]);

  useEffect(() => {
    if (!fileContextMenu) {
      return undefined;
    }

    const closeMenu = (event) => {
      if (event?.target?.closest?.("[data-file-context-menu='true']")) {
        return;
      }
      closeFileContextMenu();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeFileContextMenu();
      }
    };

    window.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [closeFileContextMenu, fileContextMenu]);

  const selectedGitStatus = normalizeGitStatus(selectedFile?.gitStatus);
  const selectedGitStatusName = getGitStatusName(selectedGitStatus);
  const selectedFileIconMeta = selectedFile
    ? getFileIconMeta(selectedFile.relativePath || selectedFile.name)
    : { codicon: "codicon-file", tone: "file" };
  const selectedFileIsImagePreview = Boolean(
    selectedFile
    && fileImageDataUrl
    && isPreviewableImageFile(selectedFile.relativePath || selectedFile.name),
  );
  const highlightedFileHtml = useMemo(
    () => (fileState === "ready" ? getHighlightedFileHtml(fileContent, selectedFile?.relativePath) : ""),
    [fileContent, fileState, selectedFile?.relativePath],
  );
  const selectedPrismLanguage = getPrismLanguage(selectedFile?.relativePath || "");
  const diffLines = useMemo(() => getDiffLines(fileDiff), [fileDiff]);
  const inlineReview = useMemo(
    () => getInlineReviewModel({
      content: fileContent,
      diff: fileDiff,
      relativePath: selectedFile?.relativePath || "",
    }),
    [fileContent, fileDiff, selectedFile?.relativePath],
  );
  const shouldShowDiff = selectedGitStatus === "modified" && !selectedFileIsImagePreview;
  const effectivePreviewMode = shouldShowDiff ? filePreviewMode : "file";

  useEffect(() => {
    if (effectivePreviewMode !== "review") {
      setReviewRulerHeight(0);
      return undefined;
    }

    const scrollElement = filePreviewScrollRef.current;

    if (!scrollElement) {
      return undefined;
    }

    const syncRulerHeight = () => {
      setReviewRulerHeight(Math.max(0, Math.round(scrollElement.clientHeight)));
    };

    syncRulerHeight();

    if (!window.ResizeObserver) {
      return undefined;
    }

    const resizeObserver = new window.ResizeObserver(syncRulerHeight);
    resizeObserver.observe(scrollElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [effectivePreviewMode, selectedFile?.relativePath]);

  const scrollToReviewMarker = useCallback((event, options = {}) => {
    const markers = inlineReview.markers;

    if (!markers.length) {
      return;
    }

    const rulerRect = event.currentTarget.getBoundingClientRect();
    const rulerHeight = Math.max(1, rulerRect.height);
    const pointerTop = Math.min(Math.max(event.clientY - rulerRect.top, 0), rulerHeight);
    const pointerPercent = (pointerTop / rulerHeight) * 100;
    const marker = markers.reduce((closest, nextMarker) => (
      Math.abs(nextMarker.top - pointerPercent) < Math.abs(closest.top - pointerPercent)
        ? nextMarker
        : closest
    ), markers[0]);
    const scrollElement = filePreviewScrollRef.current;

    if (!scrollElement) {
      return;
    }

    const targetLine = scrollElement.querySelector(`[data-review-line-number="${marker.lineNumber}"]`);

    if (targetLine) {
      scrollElement.scrollTo({
        behavior: options.smooth ? "smooth" : "auto",
        top: Math.max(0, targetLine.offsetTop - scrollElement.clientHeight * 0.32),
      });
      return;
    }

    const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    scrollElement.scrollTo({
      behavior: options.smooth ? "smooth" : "auto",
      top: (marker.top / 100) * maxScrollTop,
    });
  }, [inlineReview.markers]);

  const handleReviewRulerPointerDown = useCallback((event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrollToReviewMarker(event, { smooth: true });
  }, [scrollToReviewMarker]);

  const handleReviewRulerPointerMove = useCallback((event) => {
    if (event.buttons !== 1) {
      return;
    }

    event.preventDefault();
    scrollToReviewMarker(event);
  }, [scrollToReviewMarker]);

  const handleReviewRulerPointerRelease = useCallback((event) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const renderDiffContent = (ariaLabel) => {
    if (fileDiffState === "loading") {
      return <FileDiffMessage>Loading diff...</FileDiffMessage>;
    }

    if (fileDiffState === "error") {
      return <FileDiffMessage data-tone="error">{fileDiffError}</FileDiffMessage>;
    }

    if (!fileDiff) {
      return <FileDiffMessage>No diff available.</FileDiffMessage>;
    }

    return (
      <DiffCodeBlock aria-label={ariaLabel} className="language-diff">
        {diffLines.map((line) => (
          <DiffLine data-tone={line.tone} key={line.id}>
            {line.line}
          </DiffLine>
        ))}
      </DiffCodeBlock>
    );
  };

  return (
    <FilesWorkspaceSurface aria-label="Workspace files" ref={filesSurfaceRef}>
      <ResizePanelGroup
        data-surface="files"
        defaultLayout={fileExplorerDefaultLayout}
        id={fileExplorerGroupId}
        onLayoutChanged={queueExplorerLayout}
        orientation="horizontal"
      >
        <ResizePanel
          data-surface="files"
          defaultSize={toPanelPercent(fileExplorerLayout[0])}
          id={fileExplorerPanelId}
          maxSize={toPanelPercent(FILE_EXPLORER_MAX_SIZE)}
          minSize={toPanelPercent(FILE_EXPLORER_MIN_SIZE)}
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
            {fileOperationError && <FormMessage $state="error">{fileOperationError}</FormMessage>}
            <FileTree aria-label="Workspace file explorer">
              {workspaceRoot ? (
                <FileTreeNode
                  activeDropTargetPath={internalFileDrag.dropTargetPath}
                  directoryEntries={directoryEntries}
                  directoryErrors={directoryErrors}
                  directoryStates={directoryStates}
                  draggingFilePath={internalFileDrag.relativePath}
                  entry={rootEntry}
                  expandedDirectories={expandedDirectories}
                  isWorkspaceDragActive={internalFileDrag.isWorkspaceDragActive}
                  onBeginWorkspaceFileDrag={onBeginWorkspaceFileDrag}
                  onContextMenuEntry={handleFileContextMenu}
                  onMoveEntry={moveEntry}
                  onOpenFile={openFile}
                  onRenameCancel={cancelRenameEntry}
                  onRenameCommit={commitRenameEntry}
                  onRenameDraftChange={setRenameDraft}
                  onStartInternalDrag={updateInternalFileDrag}
                  onToggleDirectory={toggleDirectory}
                  renameDraft={renameDraft}
                  renamingPath={renamingPath}
                  selectedFilePath={selectedFile?.relativePath || ""}
                  workspaceId={workspaceId}
                  workspaceRoot={workspaceRoot}
                />
              ) : (
                <FileTreeEmpty>Set a workspace directory in settings.</FileTreeEmpty>
              )}
            </FileTree>
          </FileExplorerPane>
        </ResizePanel>

        <ResizeHandle data-direction="horizontal" data-surface="files" />

        <ResizePanel
          data-surface="files"
          defaultSize={toPanelPercent(fileExplorerLayout[1])}
          id={filePreviewPanelId}
          maxSize={toPanelPercent(FILE_PREVIEW_MAX_SIZE)}
          minSize={toPanelPercent(FILE_PREVIEW_MIN_SIZE)}
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
                  <FilePreviewModeSwitch aria-label="File preview mode">
                    {FILE_PREVIEW_MODES.map((mode) => {
                      const disabled = mode.id !== "file" && !shouldShowDiff;

                      return (
                        <FilePreviewModeButton
                          data-active={effectivePreviewMode === mode.id}
                          disabled={disabled}
                          key={mode.id}
                          onClick={() => setFilePreviewMode(mode.id)}
                          title={disabled ? "Only modified files have review and diff views" : `${mode.label} view`}
                          type="button"
                        >
                          {mode.label}
                        </FilePreviewModeButton>
                      );
                    })}
                  </FilePreviewModeSwitch>
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
                <FilePreviewScroll ref={filePreviewScrollRef}>
                  {effectivePreviewMode === "diff" ? (
                    <FileDiffPanel data-mode="diff" data-state={fileDiffState}>
                      <FileDiffHeader>
                        <span aria-hidden="true" className="codicon codicon-diff-modified" />
                        <strong>Changes</strong>
                        {fileDiffTruncated && <FileDiffBadge>Truncated</FileDiffBadge>}
                      </FileDiffHeader>
                      {renderDiffContent("Git diff for selected file")}
                    </FileDiffPanel>
                  ) : effectivePreviewMode === "review" ? (
                    <InlineReviewSurface aria-label="Selected file review">
                      <InlineReviewCodeBlock>
                        {inlineReview.rows.map((row) => (
                          <InlineReviewLine
                            data-kind={row.kind}
                            data-review-line-number={row.lineNumber || row.oldLineNumber || ""}
                            data-tone={row.tone}
                            key={row.id}
                          >
                            <InlineReviewLineNumber>
                              {row.kind === "removed" ? row.oldLineNumber : row.lineNumber}
                            </InlineReviewLineNumber>
                            <InlineReviewPrefix>{row.prefix}</InlineReviewPrefix>
                            <InlineReviewCode
                              className={`language-${selectedPrismLanguage}`}
                              dangerouslySetInnerHTML={{ __html: row.html || " " }}
                            />
                          </InlineReviewLine>
                        ))}
                      </InlineReviewCodeBlock>
                      <ReviewChangeRuler
                        aria-label="Review change navigator"
                        onPointerCancel={handleReviewRulerPointerRelease}
                        onPointerDown={handleReviewRulerPointerDown}
                        onPointerMove={handleReviewRulerPointerMove}
                        onPointerUp={handleReviewRulerPointerRelease}
                        role="button"
                        style={reviewRulerHeight ? { height: `${reviewRulerHeight}px` } : undefined}
                        tabIndex={-1}
                        title="Drag to jump between changes"
                      >
                        {inlineReview.markers.map((marker) => (
                          <ReviewChangeMarker
                            data-tone={marker.tone}
                            key={marker.id}
                            style={{ top: `${marker.top}%` }}
                          />
                        ))}
                      </ReviewChangeRuler>
                    </InlineReviewSurface>
                  ) : selectedFileIsImagePreview ? (
                    <FileImagePreviewSurface aria-label="Selected image preview">
                      <FileImagePreviewImage
                        alt={getExplorerFileName(selectedFile?.relativePath || selectedFile?.name || "Image preview")}
                        draggable={false}
                        src={fileImageDataUrl}
                        title={fileImageMimeType || undefined}
                      />
                    </FileImagePreviewSurface>
                  ) : (
                    <HighlightedCodeBlock
                      aria-label="Selected file content"
                      className={`language-${selectedPrismLanguage}`}
                      dangerouslySetInnerHTML={{ __html: highlightedFileHtml || " " }}
                    />
                  )}
                </FilePreviewScroll>
              )}
            </FileContentFrame>
          </FilePreviewPane>
        </ResizePanel>
      </ResizePanelGroup>
      {fileContextMenu && (
        <FileContextMenu
          data-file-context-menu="true"
          role="menu"
          style={{
            left: fileContextMenu.x,
            top: fileContextMenu.y,
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <FileContextMenuItem
            disabled={!fileContextMenu.entry?.relativePath}
            onClick={() => startRenameEntry(fileContextMenu.entry)}
            role="menuitem"
            type="button"
          >
            Rename
          </FileContextMenuItem>
          <FileContextMenuItem
            data-danger="true"
            disabled={!fileContextMenu.entry?.relativePath}
            onClick={() => deleteEntry(fileContextMenu.entry)}
            role="menuitem"
            type="button"
          >
            Delete
          </FileContextMenuItem>
        </FileContextMenu>
      )}
    </FilesWorkspaceSurface>
  );
}
