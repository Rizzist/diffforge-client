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
  FilePreviewModeSwitch,
  FilePreviewModeButton,
  FileGitStatusPill,
  FileMetaPill,
  FilePreviewPath,
  FileContentFrame,
  FilePreviewScroll,
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
  directoryEntries,
  directoryErrors,
  directoryStates,
  entry,
  expandedDirectories,
  onBeginWorkspaceFileDrag,
  onOpenFile,
  onToggleDirectory,
  selectedFilePath,
  workspaceId,
  workspaceRoot,
  depth = 0,
}) {
  const fileDragDebugRef = useRef({
    cleanup: null,
    lastLogAt: 0,
    lastPoint: null,
  });
  const filePointerDragRef = useRef(null);
  const suppressFileClickRef = useRef(false);
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
  const getWorkspaceFilePayload = () => {
    const relativePath = String(entry.relativePath || entry.name || "").replace(/\\/g, "/").replace(/^\/+/g, "");
    const absolutePath = joinWorkspaceFilePath(workspaceRoot, relativePath);
    return {
      absolutePath,
      payload: {
        kind: "file",
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

  return (
    <FileTreeItem>
      <FileTreeButton
        $depth={depth}
        data-git-status={gitStatus || undefined}
        data-selected={!isDirectory && selectedFilePath === entry.relativePath}
        draggable={false}
        onPointerCancel={(event) => {
          if (filePointerDragRef.current?.pointerId === event.pointerId) {
            filePointerDragRef.current = null;
          }
        }}
        onPointerDown={(event) => {
          if (isDirectory || event.button !== 0 || !onBeginWorkspaceFileDrag) {
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
          if (isDirectory) {
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
            relativePath: String(entry.relativePath || entry.name || "").replace(/\\/g, "/").replace(/^\/+/g, ""),
            workspaceId: workspaceId || "",
          });
        }}
        onDragStart={(event) => {
          if (isDirectory) {
            return;
          }

          const relativePath = String(entry.relativePath || entry.name || "").replace(/\\/g, "/").replace(/^\/+/g, "");
          const absolutePath = joinWorkspaceFilePath(workspaceRoot, relativePath);
          const payload = {
            kind: "file",
            mountId: entry.mountId || "",
            name: getExplorerFileName(relativePath),
            path: absolutePath,
            projectRelativePath: entry.projectRelativePath || "",
            projectRoot: entry.projectRoot || "",
            relativePath,
            workspaceId: workspaceId || "",
            workspaceRoot: workspaceRoot || "",
          };
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(payload));
          event.dataTransfer.setData("text/plain", absolutePath || relativePath);
          setActiveWorkspaceFileDrag(payload);
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
            relativePath: String(entry.relativePath || entry.name || "").replace(/\\/g, "/").replace(/^\/+/g, ""),
            workspaceId: workspaceId || "",
          });
          window.setTimeout(() => {
            clearActiveWorkspaceFileDrag();
            logFileDragDiagnosticEvent("fileviewer.drag_end_clear", {
              relativePath: String(entry.relativePath || entry.name || "").replace(/\\/g, "/").replace(/^\/+/g, ""),
              workspaceId: workspaceId || "",
            });
          }, 120);
        }}
        onClick={() => {
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
              onBeginWorkspaceFileDrag={onBeginWorkspaceFileDrag}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
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
  const filePreviewScrollRef = useRef(null);
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
  const [filePreviewMode, setFilePreviewMode] = useState("file");
  const [reviewRulerHeight, setReviewRulerHeight] = useState(0);
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
    setFilePreviewMode("file");

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
        mountId: result?.mountId || entry.mountId || "",
        size: result?.size ?? entry.size,
        modifiedMs: result?.modifiedMs ?? entry.modifiedMs,
        projectRelativePath: result?.projectRelativePath || entry.projectRelativePath || "",
        projectRoot: result?.projectRoot || entry.projectRoot || "",
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
    setFilePreviewMode("file");
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
  const shouldShowDiff = selectedGitStatus === "modified";
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
    <FilesWorkspaceSurface aria-label="Workspace files">
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
            <FileTree aria-label="Workspace file explorer">
              {workspaceRoot ? (
                <FileTreeNode
                  directoryEntries={directoryEntries}
                  directoryErrors={directoryErrors}
                  directoryStates={directoryStates}
                  entry={rootEntry}
                  expandedDirectories={expandedDirectories}
                  onBeginWorkspaceFileDrag={onBeginWorkspaceFileDrag}
                  onOpenFile={openFile}
                  onToggleDirectory={toggleDirectory}
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
    </FilesWorkspaceSurface>
  );
}
