import styled, { createGlobalStyle, keyframes } from "styled-components";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Add } from "@styled-icons/material-rounded/Add";
import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { Archive } from "@styled-icons/material-rounded/Archive";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { AutoFixHigh } from "@styled-icons/material-rounded/AutoFixHigh";
import { ChevronRight } from "@styled-icons/material-rounded/ChevronRight";
import { CheckCircle } from "@styled-icons/material-rounded/CheckCircle";
import { Close } from "@styled-icons/material-rounded/Close";
import { CloudDone } from "@styled-icons/material-rounded/CloudDone";
import { Code } from "@styled-icons/material-rounded/Code";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { CropSquare } from "@styled-icons/material-rounded/CropSquare";
import { KeyboardDoubleArrowDown as TitleBackgroundGlyph } from "@styled-icons/material-rounded/KeyboardDoubleArrowDown";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Description } from "@styled-icons/material-rounded/Description";
import { DragIndicator } from "@styled-icons/material-rounded/DragIndicator";
import { DarkMode } from "@styled-icons/material-rounded/DarkMode";
import { ErrorOutline } from "@styled-icons/material-rounded/ErrorOutline";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { FolderOpen } from "@styled-icons/material-rounded/FolderOpen";
import { Fullscreen } from "@styled-icons/material-rounded/Fullscreen";
import { FullscreenExit } from "@styled-icons/material-rounded/FullscreenExit";
import { Hub } from "@styled-icons/material-rounded/Hub";
import { Key } from "@styled-icons/material-rounded/Key";
import { KeyboardDoubleArrowLeft } from "@styled-icons/material-rounded/KeyboardDoubleArrowLeft";
import { KeyboardDoubleArrowRight } from "@styled-icons/material-rounded/KeyboardDoubleArrowRight";
import { LightMode } from "@styled-icons/material-rounded/LightMode";
import { Login } from "@styled-icons/material-rounded/Login";
import { Logout } from "@styled-icons/material-rounded/Logout";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { Mic } from "@styled-icons/material-rounded/Mic";
import { MicOff } from "@styled-icons/material-rounded/MicOff";
import { NotificationsActive } from "@styled-icons/material-rounded/NotificationsActive";
import { Remove } from "@styled-icons/material-rounded/Remove";
import { OpenInBrowser } from "@styled-icons/material-rounded/OpenInBrowser";
import { Pending } from "@styled-icons/material-rounded/Pending";
import { PrivacyTip } from "@styled-icons/material-rounded/PrivacyTip";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Security } from "@styled-icons/material-rounded/Security";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { ContentCut } from "@styled-icons/material-rounded/ContentCut";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";
import { Terminal as TerminalIcon } from "@styled-icons/material-rounded/Terminal";
import { TerminalFill as AgentTerminalGlyph } from "@styled-icons/bootstrap/TerminalFill";
import { LayoutSplit } from "@styled-icons/bootstrap/LayoutSplit";
import { LayoutRow } from "@styled-icons/remix-line/LayoutRow";
import CodexBrandGlyph from "@likec4/icons/tech/openai-icon";
import ClaudeBrandGlyph from "@likec4/icons/tech/claude-icon";

export const TITLE_BAR_HEIGHT = "34px";
export const VIEW_TRANSITION_MS = 170;
export const AUTH_TILE_SIZE = 40;

const TERMINAL_THEME_BACKGROUND = "#020304";
const TERMINAL_THEME_BACKGROUND_LIGHT = "#ffffff";
const TERMINAL_PANE_MIN_WIDTH_PX = 180;
const TERMINAL_PANE_MIN_HEIGHT_PX = 96;
const FILES_VSCODE_THEME_VARS = `
  --files-vscode-activity: #05070b;
  --files-vscode-sidebar: #080a0f;
  --files-vscode-editor: #030405;
  --files-vscode-editor-gutter: #06080c;
  --files-vscode-tab: #090b10;
  --files-vscode-tab-active: #030405;
  --files-vscode-border: #1d222b;
  --files-vscode-border-subtle: #141922;
  --files-vscode-hover: #111722;
  --files-vscode-selection: #0b3a5a;
  --files-vscode-selection-inactive: #151c26;
  --files-vscode-text: #d3d8df;
  --files-vscode-text-muted: #7f8793;
  --files-vscode-blue: #4fa3ff;
  --files-vscode-focus: #3c8fdc;

  html[data-forge-theme="light"] & {
    --files-vscode-activity: #f5f5f7;
    --files-vscode-sidebar: #f5f5f7;
    --files-vscode-editor: #ffffff;
    --files-vscode-editor-gutter: #fafafc;
    --files-vscode-tab: #f5f5f7;
    --files-vscode-tab-active: #ffffff;
    --files-vscode-border: #e0e0e0;
    --files-vscode-border-subtle: #ededf0;
    --files-vscode-hover: rgba(0, 0, 0, 0.045);
    --files-vscode-selection: rgba(0, 102, 204, 0.16);
    --files-vscode-selection-inactive: rgba(0, 0, 0, 0.055);
    --files-vscode-text: #1d1d1f;
    --files-vscode-text-muted: #7a7a7a;
    --files-vscode-blue: #0066cc;
    --files-vscode-focus: #0071e3;
  }

  html[data-forge-space="loopspaces"] & {
    --files-vscode-hover: rgba(var(--forge-accent-rgb), 0.12);
    --files-vscode-selection: rgba(var(--forge-accent-rgb), 0.28);
    --files-vscode-selection-inactive: rgba(var(--forge-accent-rgb), 0.08);
    --files-vscode-blue: var(--forge-accent-soft);
    --files-vscode-focus: var(--forge-accent);
  }

  html[data-forge-theme="light"][data-forge-space="loopspaces"] & {
    --files-vscode-hover: rgba(var(--forge-accent-rgb), 0.075);
    --files-vscode-selection: rgba(var(--forge-accent-rgb), 0.16);
    --files-vscode-selection-inactive: rgba(var(--forge-accent-rgb), 0.055);
    --files-vscode-blue: var(--forge-accent);
    --files-vscode-focus: var(--forge-accent);
  }
`;

export const GlobalStyle = createGlobalStyle`
  :root {
    --forge-bg: #07090d;
    --forge-bg-deep: #020304;
    --forge-surface: #0d1117;
    --forge-surface-raised: #11161d;
    --forge-surface-control: #151b23;
    --forge-surface-hover: rgba(230, 236, 245, 0.055);
    --forge-surface-selected: rgba(125, 160, 205, 0.12);
    --forge-border: rgba(230, 236, 245, 0.1);
    --forge-border-strong: rgba(230, 236, 245, 0.16);
    --forge-text: #f4f7fa;
    --forge-text-soft: #b6c0cc;
    --forge-text-muted: #7a8493;
    --forge-text-disabled: #505966;
    --forge-blue: #3b82f6;
    --forge-blue-soft: #7db0ff;
    --forge-accent: #3b82f6;
    --forge-accent-soft: #7db0ff;
    --forge-accent-blue: var(--forge-accent);
    --forge-accent-rgb: 59, 130, 246;
    --forge-accent-soft-rgb: 125, 176, 255;
    --forge-tint: var(--forge-accent);
    --forge-tint-soft: var(--forge-accent-soft);
    --forge-tint-rgb: var(--forge-accent-rgb);
    --forge-tint-soft-rgb: var(--forge-accent-soft-rgb);
    --forge-accent-selected-bg: rgba(59, 130, 246, 0.08);
    --forge-accent-selected-border: rgba(125, 176, 255, 0.5);
    --forge-accent-selected-ring: rgba(79, 163, 255, 0.24);
    --forge-titlebar-bg: #000000;
    --forge-shell-rail-bg: rgba(6, 9, 16, 0.94);
    --forge-shell-right-bg: rgba(5, 8, 13, 0.96);
    --forge-shell-right-muted-bg: rgba(2, 4, 8, 0.44);
    --forge-amber: #dfa55a;
    --forge-ember: #d97935;
    --forge-green: #3ccb7f;
    --forge-red: #ef6b6b;
    --forge-color-scheme: dark;
    /* Architecture diagram (default/dark fallback) */
    --arch-canvas-bg: #070a0f;
    --arch-canvas-glow: rgba(30, 41, 59, 0.4);
    --arch-dots: rgba(148, 163, 184, 0.16);
    --arch-node-bg: #161c28;
    --arch-node-border: rgba(148, 163, 184, 0.22);
    --arch-node-shadow: 0 10px 28px rgba(2, 6, 23, 0.55);
    --arch-node-text: #e8edf2;
    --arch-node-text-muted: #93a0b2;
    --arch-group-bg: rgba(255, 255, 255, 0.025);
    --arch-group-border: rgba(148, 163, 184, 0.26);
    --arch-edge: rgba(148, 163, 184, 0.5);
    --arch-edge-selected: rgba(251, 191, 36, 0.95);
    --arch-edge-label-bg: rgba(9, 13, 24, 0.92);
    --arch-edge-label-border: rgba(148, 163, 184, 0.22);
    --arch-edge-label-text: #cbd5e1;
    --arch-icon-tile-bg: rgba(248, 250, 252, 0.08);
    --arch-icon-tile-border: rgba(226, 232, 240, 0.18);
    --arch-icon-mono: #f8fafc;
    --arch-focus-ring: #7dd3fc;
    color: var(--forge-text);
    background: var(--forge-bg);
    color-scheme: var(--forge-color-scheme, dark);
    font-family:
      "Segoe UI Variable",
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

  html[data-forge-theme="dark"] {
    --forge-bg: #07090d;
    --forge-bg-deep: #020304;
    --forge-surface: #0d1117;
    --forge-surface-raised: #11161d;
    --forge-surface-control: #151b23;
    --forge-surface-hover: rgba(230, 236, 245, 0.055);
    --forge-surface-selected: rgba(125, 160, 205, 0.12);
    --forge-border: rgba(230, 236, 245, 0.1);
    --forge-border-strong: rgba(230, 236, 245, 0.16);
    --forge-text: #f4f7fa;
    --forge-text-soft: #b6c0cc;
    --forge-text-muted: #7a8493;
    --forge-text-disabled: #505966;
    --forge-blue: #3b82f6;
    --forge-blue-soft: #7db0ff;
    --forge-accent: #3b82f6;
    --forge-accent-soft: #7db0ff;
    --forge-accent-blue: var(--forge-accent);
    --forge-accent-rgb: 59, 130, 246;
    --forge-accent-soft-rgb: 125, 176, 255;
    --forge-tint: var(--forge-accent);
    --forge-tint-soft: var(--forge-accent-soft);
    --forge-tint-rgb: var(--forge-accent-rgb);
    --forge-tint-soft-rgb: var(--forge-accent-soft-rgb);
    --forge-accent-selected-bg: rgba(59, 130, 246, 0.08);
    --forge-accent-selected-border: rgba(125, 176, 255, 0.5);
    --forge-accent-selected-ring: rgba(79, 163, 255, 0.24);
    --forge-titlebar-bg: #000000;
    --forge-shell-rail-bg: rgba(6, 9, 16, 0.94);
    --forge-shell-right-bg: rgba(5, 8, 13, 0.96);
    --forge-shell-right-muted-bg: rgba(2, 4, 8, 0.44);
    --forge-amber: #dfa55a;
    --forge-ember: #d97935;
    --forge-green: #3ccb7f;
    --forge-red: #ef6b6b;
    --forge-color-scheme: dark;
    /* Architecture diagram (dark) */
    --arch-canvas-bg: #070a0f;
    --arch-canvas-glow: rgba(30, 41, 59, 0.4);
    --arch-dots: rgba(148, 163, 184, 0.16);
    --arch-node-bg: #161c28;
    --arch-node-border: rgba(148, 163, 184, 0.22);
    --arch-node-shadow: 0 10px 28px rgba(2, 6, 23, 0.55);
    --arch-node-text: #e8edf2;
    --arch-node-text-muted: #93a0b2;
    --arch-group-bg: rgba(255, 255, 255, 0.025);
    --arch-group-border: rgba(148, 163, 184, 0.26);
    --arch-edge: rgba(148, 163, 184, 0.5);
    --arch-edge-selected: rgba(251, 191, 36, 0.95);
    --arch-edge-label-bg: rgba(9, 13, 24, 0.92);
    --arch-edge-label-border: rgba(148, 163, 184, 0.22);
    --arch-edge-label-text: #cbd5e1;
    --arch-icon-tile-bg: rgba(248, 250, 252, 0.08);
    --arch-icon-tile-border: rgba(226, 232, 240, 0.18);
    --arch-icon-mono: #f8fafc;
    --arch-focus-ring: #7dd3fc;
  }

  html[data-forge-theme="light"] {
    --forge-bg: #f5f5f7;
    --forge-bg-deep: #ffffff;
    --forge-surface: #ffffff;
    --forge-surface-raised: #ffffff;
    --forge-surface-control: #fafafc;
    --forge-surface-hover: rgba(0, 0, 0, 0.045);
    --forge-surface-selected: rgba(0, 102, 204, 0.1);
    --forge-border: rgba(0, 0, 0, 0.08);
    --forge-border-strong: rgba(0, 0, 0, 0.14);
    --forge-text: #1d1d1f;
    --forge-text-soft: #333333;
    --forge-text-muted: #7a7a7a;
    --forge-text-disabled: #a1a1a6;
    --forge-blue: #0066cc;
    --forge-blue-soft: #0071e3;
    --forge-accent: #0066cc;
    --forge-accent-soft: #0071e3;
    --forge-accent-blue: var(--forge-accent);
    --forge-accent-rgb: 0, 102, 204;
    --forge-accent-soft-rgb: 0, 113, 227;
    --forge-tint: var(--forge-accent);
    --forge-tint-soft: var(--forge-accent-soft);
    --forge-tint-rgb: var(--forge-accent-rgb);
    --forge-tint-soft-rgb: var(--forge-accent-soft-rgb);
    --forge-accent-selected-bg: rgba(0, 102, 204, 0.1);
    --forge-accent-selected-border: rgba(0, 102, 204, 0.46);
    --forge-accent-selected-ring: rgba(0, 102, 204, 0.18);
    --forge-titlebar-bg: #f5f5f7;
    --forge-shell-rail-bg: rgba(245, 245, 247, 0.88);
    --forge-shell-right-bg: #ffffff;
    --forge-shell-right-muted-bg: rgba(245, 245, 247, 0.86);
    --forge-amber: #8b5a00;
    --forge-ember: #0066cc;
    --forge-green: #0a7f45;
    --forge-red: #b42318;
    --forge-color-scheme: light;
    --forge-light-canvas: #ffffff;
    --forge-light-parchment: #f5f5f7;
    --forge-light-pearl: #fafafc;
    --forge-light-hairline: #e0e0e0;
    --forge-light-ink: #1d1d1f;
    --forge-light-muted: #7a7a7a;
    --forge-light-dark-tile: #272729;
    /* Architecture diagram (light) */
    --arch-canvas-bg: #f4f5f7;
    --arch-canvas-glow: rgba(0, 102, 204, 0.06);
    --arch-dots: rgba(0, 0, 0, 0.1);
    --arch-node-bg: #ffffff;
    --arch-node-border: #e2e5ea;
    --arch-node-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
    --arch-node-text: #1b1e24;
    --arch-node-text-muted: #5a6472;
    --arch-group-bg: rgba(15, 23, 42, 0.04);
    --arch-group-border: #e2e5ea;
    --arch-edge: #6b7280;
    --arch-edge-selected: #b45309;
    --arch-edge-label-bg: #ffffff;
    --arch-edge-label-border: rgba(0, 0, 0, 0.14);
    --arch-edge-label-text: #404a57;
    --arch-icon-tile-bg: #f0f1f4;
    --arch-icon-tile-border: rgba(0, 0, 0, 0.12);
    --arch-icon-mono: #272729;
    --arch-focus-ring: #0066cc;
  }

  html[data-forge-theme="light"] * {
    scrollbar-color: rgba(0, 102, 204, 0.34) rgba(245, 245, 247, 0.9);
  }

  html[data-forge-theme="light"] *::-webkit-scrollbar-track {
    background: #f5f5f7;
  }

  html[data-forge-theme="light"] *::-webkit-scrollbar-thumb {
    border-color: #f5f5f7;
    background: #d2d2d7;
    background-clip: padding-box;
  }

  html[data-forge-theme="light"] *::-webkit-scrollbar-thumb:hover {
    background: #b8b8bd;
    background-clip: padding-box;
  }

  html[data-forge-theme="light"] *::-webkit-scrollbar-corner {
    background: #f5f5f7;
  }

  html[data-forge-space="loopspaces"] {
    --forge-surface-selected: rgba(245, 158, 11, 0.13);
    --forge-blue: #f59e0b;
    --forge-blue-soft: #ffd166;
    --forge-accent: #f59e0b;
    --forge-accent-soft: #ffd166;
    --forge-accent-rgb: 245, 158, 11;
    --forge-accent-soft-rgb: 255, 209, 102;
    --forge-accent-selected-bg: rgba(245, 158, 11, 0.105);
    --forge-accent-selected-border: rgba(255, 209, 102, 0.5);
    --forge-accent-selected-ring: rgba(245, 158, 11, 0.22);
    --forge-titlebar-bg: #000000;
    --forge-shell-rail-bg: rgba(7, 7, 8, 0.96);
    --forge-shell-right-bg: rgba(6, 6, 7, 0.96);
    --forge-shell-right-muted-bg: rgba(3, 4, 6, 0.6);
    --forge-amber: #ffd166;
    --forge-ember: #f59e0b;
  }

  html[data-forge-theme="light"][data-forge-space="loopspaces"] {
    --forge-surface-selected: rgba(181, 106, 0, 0.12);
    --forge-blue: #b56a00;
    --forge-blue-soft: #c88000;
    --forge-accent: #b56a00;
    --forge-accent-soft: #c88000;
    --forge-accent-rgb: 181, 106, 0;
    --forge-accent-soft-rgb: 200, 128, 0;
    --forge-accent-selected-bg: rgba(181, 106, 0, 0.1);
    --forge-accent-selected-border: rgba(181, 106, 0, 0.42);
    --forge-accent-selected-ring: rgba(181, 106, 0, 0.16);
    --forge-titlebar-bg: #f5f5f7;
    --forge-shell-rail-bg: rgba(245, 245, 247, 0.9);
    --forge-shell-right-bg: #ffffff;
    --forge-shell-right-muted-bg: rgba(245, 245, 247, 0.88);
    --forge-amber: #8b5a00;
    --forge-ember: #b56a00;
  }

  html[data-forge-space="loopspaces"] * {
    scrollbar-color: rgba(var(--forge-accent-rgb), 0.52) rgba(14, 10, 5, 0.86);
  }

  html[data-forge-theme="light"][data-forge-space="loopspaces"] * {
    scrollbar-color: rgba(var(--forge-accent-rgb), 0.34) rgba(245, 245, 247, 0.9);
  }

  * {
    box-sizing: border-box;
    scrollbar-color: rgba(125, 160, 205, 0.52) rgba(10, 14, 20, 0.86);
    scrollbar-width: thin;
  }

  *::-webkit-scrollbar {
    width: 9px;
    height: 5px;
  }

  *::-webkit-scrollbar-track {
    background:
      linear-gradient(180deg, rgba(244, 247, 250, 0.018), rgba(244, 247, 250, 0.006)),
      rgba(4, 8, 15, 0.9);
  }

  *::-webkit-scrollbar-thumb {
    min-height: 42px;
    border: 1px solid rgba(4, 8, 15, 0.9);
    border-radius: 999px;
    background: rgba(100, 121, 153, 0.42);
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-thumb:hover {
    background: rgba(125, 150, 184, 0.56);
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-corner {
    background: rgba(4, 8, 15, 0.9);
  }

  html,
  body,
  #app {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
    background: var(--forge-bg);
    transition:
      background 260ms ease,
      color 260ms ease;
  }

  body {
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.035), rgba(7, 9, 13, 0) 36rem),
      var(--forge-bg);
  }

  html[data-forge-theme="light"] body {
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), transparent 30rem),
      var(--forge-bg);
  }

  html[data-window-platform="macos"],
  html[data-window-platform="macos"] body,
  html[data-window-platform="macos"] #app,
  body[data-window-platform="macos"],
  body[data-window-platform="macos"] #app {
    background: transparent !important;
  }

  html[data-audio-widget="true"],
  html[data-audio-widget="true"] body,
  html[data-audio-widget="true"] #app,
  body[data-audio-widget="true"],
  body[data-audio-widget="true"] #app {
    overflow: hidden;
    border-radius: 999px;
    background: transparent !important;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  html[data-audio-widget="true"][data-audio-widget-history-tray="true"],
  html[data-audio-widget="true"][data-audio-widget-history-tray="true"] body,
  html[data-audio-widget="true"][data-audio-widget-history-tray="true"] #app,
  body[data-audio-widget="true"][data-audio-widget-history-tray="true"],
  body[data-audio-widget="true"][data-audio-widget-history-tray="true"] #app {
    border-radius: 18px;
  }

  html[data-audio-widget="true"],
  html[data-audio-widget="true"] body,
  html[data-audio-widget="true"] #app,
  body[data-audio-widget="true"] #app {
    min-width: 0;
    min-height: 0;
  }

  html[data-audio-widget="true"] img,
  body[data-audio-widget="true"] img {
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    -webkit-touch-callout: none;
  }

  html[data-audio-widget-error="true"],
  html[data-audio-widget-error="true"] body,
  html[data-audio-widget-error="true"] #app,
  body[data-audio-widget-error="true"],
  body[data-audio-widget-error="true"] #app {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: transparent !important;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
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

export const AppFrame = styled.div`
  display: grid;
  position: relative;
  min-width: 320px;
  min-height: 100vh;
  grid-template-rows: ${TITLE_BAR_HEIGHT} minmax(0, 1fr);
  background: var(--forge-bg);

  &[data-platform="macos"][data-window-expanded="false"] {
    min-height: 100vh;
    border: 0;
    border-radius: 12px;
    box-shadow: none;
    overflow: hidden;
  }

  html[data-forge-theme="light"] &[data-platform="macos"][data-window-expanded="false"] {
    box-shadow: none;
  }
`;

export const WindowResizeEdges = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
`;

export const WindowResizeHandle = styled.div`
  position: fixed;
  z-index: 1;
  background: transparent;
  pointer-events: auto;
  user-select: none;
  touch-action: none;
  -webkit-app-region: no-drag;

  &[data-placement="top"] {
    top: 0;
    right: 148px;
    left: 10px;
    height: 6px;
    cursor: ns-resize;
  }

  &[data-placement="bottom"] {
    right: 10px;
    bottom: 0;
    left: 10px;
    height: 6px;
    cursor: ns-resize;
  }

  &[data-placement="right"],
  &[data-placement="left"] {
    top: ${TITLE_BAR_HEIGHT};
    bottom: 10px;
    width: 6px;
    cursor: ew-resize;
  }

  &[data-placement="right"] {
    right: 0;
  }

  &[data-placement="left"] {
    left: 0;
  }

  &[data-placement^="top-"],
  &[data-placement^="bottom-"] {
    width: 8px;
    height: 8px;
  }

  &[data-placement="top-left"],
  &[data-placement="bottom-right"] {
    cursor: nwse-resize;
  }

  &[data-placement="top-right"],
  &[data-placement="bottom-left"] {
    cursor: nesw-resize;
  }

  &[data-placement="top-left"] {
    top: 0;
    left: 0;
  }

  &[data-placement="top-right"] {
    top: 0;
    right: 0;
  }

  &[data-placement="bottom-right"] {
    right: 0;
    bottom: 0;
  }

  &[data-placement="bottom-left"] {
    bottom: 0;
    left: 0;
  }
`;

export const WindowTitleBar = styled.header`
  display: grid;
  position: relative;
  height: ${TITLE_BAR_HEIGHT};
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid rgba(185, 191, 203, 0.16);
  color: #e8eef8;
  background:
    linear-gradient(90deg, rgba(var(--forge-tint-rgb), 0.1), transparent 46%, rgba(var(--forge-tint-soft-rgb), 0.055)),
    var(--forge-titlebar-bg);
  box-shadow: inset 0 -1px 0 rgba(var(--forge-tint-rgb), 0.13);
  transition:
    background 260ms ease,
    border-color 260ms ease,
    box-shadow 260ms ease,
    color 260ms ease;
  user-select: none;

  &[data-platform="macos"] {
    grid-template-columns: auto minmax(0, 1fr);
  }

  html[data-forge-theme="light"] & {
    border-bottom-color: var(--forge-border);
    color: var(--forge-text);
    background:
      linear-gradient(90deg, rgba(var(--forge-tint-rgb), 0.085), transparent 48%, rgba(var(--forge-tint-soft-rgb), 0.04)),
      var(--forge-titlebar-bg);
  }
`;

export const WindowTitle = styled.div`
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

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }

  ${WindowTitleBar}[data-platform="macos"] & {
    position: absolute;
    top: 0;
    left: 50%;
    grid-column: 1 / -1;
    grid-row: 1;
    max-width: calc(100% - 24px);
    padding: 0 12px;
    pointer-events: none;
    transform: translateX(-50%);
  }
`;

export const WindowControls = styled.div`
  display: inline-flex;
  height: 100%;
  align-items: center;

  &[data-platform="macos"] {
    grid-column: 1;
    grid-row: 1;
    justify-self: start;
    gap: 8px;
    padding: 0 12px;
  }

  &[data-platform="linux"] {
    gap: 4px;
    padding: 0 8px;
  }
`;

export const WindowControlButton = styled.button`
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

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--forge-text);
    background: rgba(0, 0, 0, 0.055);
  }

  &[data-variant="close"]:hover {
    color: #ffffff;
    background: #d83b32;
  }

  html[data-forge-theme="light"] &[data-variant="close"]:hover {
    color: #ffffff;
    background: #d83b32;
  }

  &[data-platform="macos"] {
    width: 12px;
    height: 12px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.22);
    border-radius: 999px;
    color: rgba(0, 0, 0, 0.62);
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.12);
  }

  html[data-forge-theme="light"] &[data-platform="macos"] {
    color: rgba(0, 0, 0, 0.64);
  }

  &[data-platform="macos"][data-action="close"] {
    order: 1;
    background: #ff5f57;
  }

  html[data-forge-theme="light"] &[data-platform="macos"][data-action="close"]:hover {
    background: #ff5f57;
  }

  &[data-platform="macos"][data-action="minimize"] {
    order: 2;
    background: #ffbd2e;
  }

  html[data-forge-theme="light"] &[data-platform="macos"][data-action="minimize"]:hover {
    background: #ffbd2e;
  }

  &[data-platform="macos"][data-action="maximize"] {
    order: 3;
    background: #28c840;
  }

  html[data-forge-theme="light"] &[data-platform="macos"][data-action="maximize"]:hover {
    background: #28c840;
  }

  &[data-platform="macos"] svg {
    width: 8px;
    height: 8px;
    opacity: 0;
    transform: scale(0.82);
    transition:
      opacity 120ms ease,
      transform 120ms ease;
  }

  ${WindowControls}[data-platform="macos"]:hover &[data-platform="macos"] svg,
  &[data-platform="macos"]:focus-visible svg {
    opacity: 1;
    transform: scale(1);
  }

  &[data-platform="macos"]:hover,
  &[data-platform="macos"][data-variant="close"]:hover {
    color: rgba(0, 0, 0, 0.7);
    filter: brightness(0.96);
  }

  &[data-platform="linux"] {
    width: 34px;
    height: 26px;
    border-radius: 7px;
    color: #c9d2dc;
  }

  html[data-forge-theme="light"] &[data-platform="linux"] {
    color: var(--forge-text-muted);
  }

  &[data-platform="linux"]:hover {
    color: #ffffff;
    background: rgba(230, 236, 245, 0.08);
  }

  html[data-forge-theme="light"] &[data-platform="linux"]:hover {
    color: var(--forge-text);
    background: rgba(0, 0, 0, 0.055);
  }

  &[data-platform="linux"][data-variant="close"]:hover {
    background: rgba(216, 59, 50, 0.86);
  }

  html[data-forge-theme="light"] &[data-platform="linux"][data-variant="close"]:hover {
    color: #ffffff;
    background: #d83b32;
  }
`;

export const AppContent = styled.div`
  min-height: 0;
  overflow: auto;
  background: var(--forge-bg);
`;

export const workspaceCloseSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

export const WorkspaceCloseOverlay = styled.div`
  position: absolute;
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

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    background: rgba(245, 245, 247, 0.86);
  }
`;

export const WorkspaceClosePanel = styled.section`
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

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
    box-shadow: none;
  }
`;

export const WorkspaceCloseSpinner = styled.div`
  width: 42px;
  height: 42px;
  border: 3px solid rgba(98, 160, 255, 0.2);
  border-top-color: #62a0ff;
  border-right-color: #ff9a3d;
  border-radius: 50%;
  animation: ${workspaceCloseSpin} 760ms linear infinite;

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.18);
    border-top-color: var(--forge-blue);
    border-right-color: var(--forge-blue-soft);
  }
`;

export const WorkspaceCloseTitle = styled.h2`
  margin: 3px 0 0;
  color: #ffffff;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.2;
  text-align: center;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const WorkspaceCloseDetail = styled.p`
  max-width: 34ch;
  margin: 0;
  color: #aeb8c7;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.48;
  text-align: center;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

export const WorkspaceCloseCounter = styled.p`
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

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.18);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

export const WorkspaceCloseProgressTrack = styled.div`
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.08);
  }
`;

export const WorkspaceCloseProgressBar = styled.div`
  width: ${({ $progress }) => Math.max(0, Math.min(100, $progress || 0))}%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #62a0ff, #ff9a3d);
  transition: width 180ms ease;

  html[data-forge-theme="light"] & {
    background: var(--forge-blue);
  }
`;

export const WorkspaceCloseSteps = styled.ol`
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 7px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
`;

export const WorkspaceCloseStep = styled.li`
  display: grid;
  min-width: 0;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: rgba(226, 232, 240, 0.5);
  font-size: 12px;
  line-height: 1.2;

  &[data-state="active"] {
    color: #f8fbff;
  }

  &[data-state="complete"] {
    color: rgba(203, 213, 225, 0.84);
  }

  html[data-forge-theme="light"] & {
    color: rgba(69, 69, 74, 0.58);
  }

  html[data-forge-theme="light"] &[data-state="active"] {
    color: var(--forge-text);
  }

  html[data-forge-theme="light"] &[data-state="complete"] {
    color: rgba(29, 29, 31, 0.78);
  }
`;

export const WorkspaceCloseStepDot = styled.span`
  display: inline-flex;
  width: 8px;
  height: 8px;
  justify-self: center;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.32);
  box-shadow: none;

  ${WorkspaceCloseStep}[data-state="active"] & {
    background: #62a0ff;
    box-shadow: 0 0 0 4px rgba(98, 160, 255, 0.16);
  }

  ${WorkspaceCloseStep}[data-state="complete"] & {
    background: #3ccb7f;
  }

  html[data-forge-theme="light"] ${WorkspaceCloseStep}[data-state="active"] & {
    background: var(--forge-blue);
    box-shadow: 0 0 0 4px rgba(0, 102, 204, 0.12);
  }
`;

export const WorkspaceCloseStepCopy = styled.div`
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
`;

export const WorkspaceCloseStepLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  font-weight: 820;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const WorkspaceCloseStepMeta = styled.span`
  flex: 0 0 auto;
  color: rgba(148, 163, 184, 0.78);
  font-size: 10px;
  font-weight: 850;
  text-transform: uppercase;

  ${WorkspaceCloseStep}[data-state="active"] & {
    color: rgba(226, 232, 240, 0.88);
  }

  html[data-forge-theme="light"] & {
    color: rgba(69, 69, 74, 0.62);
  }
`;

export const splashPulse = keyframes`
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

export const loadingOrangeSweep = keyframes`
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

export const shellReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.992);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

export const railReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(-10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const sideReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const panelEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const workspaceNotificationPing = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.96);
    box-shadow: 0 0 0 0 rgba(125, 176, 255, 0);
  }

  12% {
    opacity: 1;
    transform: scale(1);
    box-shadow:
      0 0 0 1px rgba(125, 176, 255, 0.48),
      0 0 18px rgba(47, 128, 255, 0.22),
      inset 0 0 0 1px rgba(255, 190, 96, 0.18);
  }

  38% {
    opacity: 0.92;
    box-shadow:
      0 0 0 2px rgba(125, 176, 255, 0.2),
      0 0 22px rgba(255, 122, 24, 0.12),
      inset 0 0 0 1px rgba(125, 176, 255, 0.22);
  }

  100% {
    opacity: 0;
    transform: scale(1.035);
    box-shadow: 0 0 0 7px rgba(125, 176, 255, 0);
  }
`;

export const workspaceNotificationScan = keyframes`
  0% {
    opacity: 0;
    transform: translateX(-84%);
  }

  20% {
    opacity: 0.9;
  }

  100% {
    opacity: 0;
    transform: translateX(84%);
  }
`;

export const panelExit = keyframes`
  from {
    opacity: 1;
    transform: translateY(0);
  }

  to {
    opacity: 0;
    transform: translateY(5px);
  }
`;

export const terminalFullscreenEnter = keyframes`
  from {
    opacity: 0.96;
    transform:
      translate3d(
        var(--terminal-fullscreen-origin-x, 0px),
        var(--terminal-fullscreen-origin-y, 0px),
        0
      )
      scale(
        var(--terminal-fullscreen-origin-scale-x, 1),
        var(--terminal-fullscreen-origin-scale-y, 1)
      );
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1, 1);
  }
`;

export const terminalFullscreenExit = keyframes`
  from {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1, 1);
  }

  to {
    opacity: 0.96;
    transform:
      translate3d(
        var(--terminal-fullscreen-origin-x, 0px),
        var(--terminal-fullscreen-origin-y, 0px),
        0
      )
      scale(
        var(--terminal-fullscreen-origin-scale-x, 1),
        var(--terminal-fullscreen-origin-scale-y, 1)
      );
  }
`;

export const quietSweep = keyframes`
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
`;

export const squareFade = keyframes`
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

export const SplashScreen = styled.main`
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

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    background: var(--forge-bg);
    background-size: auto;
  }

  html[data-forge-theme="light"] &::before {
    border-color: var(--forge-border);
    background: rgba(255, 255, 255, 0.72);
  }
`;

export const AmbientPanel = styled.div`
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

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text-muted);
    background: rgba(255, 255, 255, 0.74);
    box-shadow: none;
  }

  html[data-forge-theme="light"] & span,
  html[data-forge-theme="light"] & p:last-child {
    color: var(--forge-blue);
  }

  @media (max-width: 980px) {
    display: none;
  }
`;

export const SplashCenter = styled.section`
  position: relative;
  z-index: 2;
  display: grid;
  width: min(680px, 100%);
  justify-items: center;
  gap: clamp(10px, 2.5vh, 18px);
  text-align: center;
`;

export const SplashLogo = styled.img`
  display: block;
  width: clamp(132px, 28vh, 258px);
  height: clamp(132px, 28vh, 258px);
  border-radius: 8px;
  object-fit: cover;
  filter:
    drop-shadow(0 0 24px rgba(47, 128, 255, 0.36))
    drop-shadow(0 0 28px rgba(255, 122, 24, 0.28));
  animation: ${splashPulse} 2.8s ease-in-out infinite;

  html[data-forge-theme="light"] & {
    filter: none;
  }

  @media (max-width: 760px) {
    width: clamp(112px, 24vh, 184px);
    height: clamp(112px, 24vh, 184px);
  }
`;

export const SplashTitle = styled.h1`
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 7vw, 64px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  text-shadow: 0 0 24px rgba(47, 128, 255, 0.22);

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    text-shadow: none;
  }

  @media (max-width: 760px) {
    font-size: 42px;
  }
`;

export const SplashTagline = styled.p`
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2.2vw, 19px);
  font-weight: 650;
  line-height: 1.5;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }

  @media (max-width: 760px) {
    font-size: 16px;
  }
`;

export const LoadingTrack = styled.div`
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

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.24);
    background: rgba(0, 102, 204, 0.14);
    box-shadow: none;
  }

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.42);
    background:
      linear-gradient(90deg, rgba(255, 107, 107, 0.16), rgba(255, 122, 24, 0.2)),
      #10151f;
    box-shadow:
      inset 0 0 12px rgba(255, 255, 255, 0.07),
      0 0 18px rgba(255, 107, 107, 0.14);
  }

  html[data-forge-theme="light"] &[data-state="offline"] {
    border-color: rgba(180, 35, 24, 0.22);
    background: rgba(180, 35, 24, 0.08);
    box-shadow: none;
  }
`;

export const LoadingFill = styled.div`
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

  html[data-forge-theme="light"] & {
    background: var(--forge-blue);
    box-shadow: none;
  }
`;

export const LoadingText = styled.p`
  margin: 0;
  color: #d1d8e2;
  font-size: 16px;
  font-weight: 720;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const LoadingDetail = styled.p`
  margin: 3px 0 0;
  color: #8f9bad;
  font-size: 13px;
  font-weight: 620;
  line-height: 1.45;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

export const LaunchStatusPanel = styled.div`
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

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
    box-shadow: none;
  }

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.32);
    background:
      linear-gradient(145deg, rgba(255, 107, 107, 0.12), rgba(255, 122, 24, 0.08)),
      rgba(6, 9, 16, 0.78);
  }

  html[data-forge-theme="light"] &[data-state="offline"] {
    border-color: rgba(180, 35, 24, 0.2);
    background: var(--forge-surface);
  }

  &[data-state="update"],
  &[data-state="warning"] {
    border-color: rgba(255, 122, 24, 0.34);
    background:
      linear-gradient(145deg, rgba(255, 122, 24, 0.12), rgba(47, 128, 255, 0.07)),
      rgba(6, 9, 16, 0.78);
  }

  html[data-forge-theme="light"] &[data-state="update"],
  html[data-forge-theme="light"] &[data-state="warning"] {
    border-color: rgba(0, 102, 204, 0.2);
    background: var(--forge-surface);
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
`;

export const LaunchStatusIcon = styled.span`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(47, 128, 255, 0.38);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.4);
    color: #ffb1b1;
    background: rgba(255, 107, 107, 0.14);
  }

  html[data-forge-theme="light"] &[data-state="offline"] {
    border-color: rgba(180, 35, 24, 0.2);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.08);
  }

  &[data-state="update"],
  &[data-state="warning"] {
    border-color: rgba(255, 122, 24, 0.42);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.14);
  }

  html[data-forge-theme="light"] &[data-state="update"],
  html[data-forge-theme="light"] &[data-state="warning"] {
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

export const LaunchStatusCopy = styled.div`
  min-width: 0;
`;

export const LaunchActions = styled.div`
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

export const LoginScreen = styled.main`
  position: relative;
  display: grid;
  width: 100%;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  isolation: isolate;
  overflow: hidden;
  background: #030508;

  html[data-forge-theme="light"] & {
    background: var(--forge-bg);
  }
`;

export const LoginLayout = styled.div`
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

export const SquareField = styled.div`
  --square-field-bg: #030508;
  --square-grid-x: rgba(185, 191, 203, 0.24);
  --square-grid-y: rgba(185, 191, 203, 0.22);
  --square-overlay-left: rgba(3, 5, 8, 0.72);
  --square-overlay-mid: rgba(3, 5, 8, 0.12);
  --square-overlay-right: rgba(3, 5, 8, 0.6);
  --square-overlay-top: rgba(3, 5, 8, 0.06);
  --square-overlay-bottom: rgba(3, 5, 8, 0.48);
  --square-pulse-bg: rgba(188, 194, 205, 0.96);
  --square-pulse-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);

  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    linear-gradient(90deg, var(--square-grid-x) 1px, transparent 1px),
    linear-gradient(180deg, var(--square-grid-y) 1px, transparent 1px),
    var(--square-field-bg);
  background-size: ${AUTH_TILE_SIZE}px ${AUTH_TILE_SIZE}px;

  &[data-tone="quiet"] {
    --square-field-bg: #000000;
    --square-grid-x: rgba(104, 110, 120, 0.22);
    --square-grid-y: rgba(104, 110, 120, 0.2);
    --square-overlay-left: rgba(0, 0, 0, 0.74);
    --square-overlay-mid: rgba(0, 0, 0, 0.16);
    --square-overlay-right: rgba(0, 0, 0, 0.66);
    --square-overlay-top: rgba(0, 0, 0, 0.08);
    --square-overlay-bottom: rgba(0, 0, 0, 0.52);
    --square-pulse-bg: rgba(104, 110, 120, 0.72);
    --square-pulse-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.035);
  }

  html[data-forge-theme="light"] & {
    --square-field-bg: #f5f5f7;
    --square-grid-x: rgba(0, 0, 0, 0.04);
    --square-grid-y: rgba(0, 0, 0, 0.035);
    --square-overlay-left: rgba(245, 245, 247, 0.78);
    --square-overlay-mid: rgba(245, 245, 247, 0.2);
    --square-overlay-right: rgba(245, 245, 247, 0.74);
    --square-overlay-top: rgba(245, 245, 247, 0.16);
    --square-overlay-bottom: rgba(245, 245, 247, 0.7);
    --square-pulse-bg: rgba(255, 255, 255, 0.82);
    --square-pulse-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
  }

  html[data-forge-theme="light"] &[data-tone="quiet"] {
    --square-field-bg: #ffffff;
    --square-grid-x: rgba(0, 0, 0, 0.032);
    --square-grid-y: rgba(0, 0, 0, 0.028);
    --square-overlay-left: rgba(255, 255, 255, 0.8);
    --square-overlay-mid: rgba(255, 255, 255, 0.18);
    --square-overlay-right: rgba(255, 255, 255, 0.76);
    --square-overlay-top: rgba(255, 255, 255, 0.16);
    --square-overlay-bottom: rgba(255, 255, 255, 0.72);
    --square-pulse-bg: rgba(0, 102, 204, 0.08);
    --square-pulse-shadow: inset 0 0 0 1px rgba(0, 102, 204, 0.06);
  }

  &::after {
    position: absolute;
    inset: 0;
    z-index: 2;
    background:
      linear-gradient(
        90deg,
        var(--square-overlay-left),
        var(--square-overlay-mid) 46%,
        var(--square-overlay-right)
      ),
      linear-gradient(180deg, var(--square-overlay-top), var(--square-overlay-bottom));
    content: "";
  }
`;

export const SquarePulse = styled.span`
  position: absolute;
  top: var(--top);
  left: var(--left);
  z-index: 1;
  width: ${AUTH_TILE_SIZE}px;
  height: ${AUTH_TILE_SIZE}px;
  background: var(--square-pulse-bg);
  box-shadow: var(--square-pulse-shadow);
  opacity: 0;
  animation: ${squareFade} var(--duration) ease-in-out var(--delay) infinite;
`;

export const BrandPanel = styled.section`
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

export const BrandMark = styled.a`
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

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }

  html[data-forge-theme="light"] & img {
    border-color: var(--forge-border);
    background: var(--forge-surface);
    filter: none;
  }
`;

export const IntroCopy = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

export const Kicker = styled.p`
  margin: 0;
  color: var(--forge-ember);
  font-size: 13px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const Headline = styled.h1`
  max-width: 620px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 5.6vw, 68px);
  font-weight: 820;
  letter-spacing: 0;
  line-height: 0.98;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }

  @media (max-width: 860px) {
    font-size: clamp(40px, 13vw, 58px);
  }

  @media (max-height: 720px) and (min-width: 861px) {
    font-size: clamp(34px, 8vh, 48px);
    line-height: 1.03;
  }
`;

export const Lede = styled.p`
  max-width: 560px;
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2vw, 18px);
  line-height: 1.62;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }

  @media (max-height: 720px) and (min-width: 861px) {
    line-height: 1.45;
  }
`;

export const IntroFeatureList = styled.ul`
  display: grid;
  max-width: 540px;
  gap: 10px;
  margin: 4px 0 0;
  padding: 20px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  list-style: none;

  html[data-forge-theme="light"] & {
    border-top-color: var(--forge-border);
  }

  @media (max-height: 720px) and (min-width: 861px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding-top: 12px;
  }
`;

export const IntroFeature = styled.li`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #a7b2c2;
  font-size: 14px;
  font-weight: 720;
  line-height: 1.5;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-soft);
  }

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

  html[data-forge-theme="light"] &[data-tone="orange"] span {
    background: var(--forge-blue);
  }

  @media (max-height: 720px) and (min-width: 861px) {
    gap: 7px;
    font-size: 12px;
    line-height: 1.35;
  }
`;

export const ApiStatus = styled.div`
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

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: rgba(255, 255, 255, 0.82);
    box-shadow: none;
  }

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

export const StatusSummary = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #eef4f8;
  font-size: 14px;
  font-weight: 760;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const StatusBadge = styled.span`
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

  html[data-forge-theme="light"] & {
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
    border-color: rgba(0, 102, 204, 0.2);
  }

  html[data-forge-theme="light"] ${ApiStatus}[data-state="offline"] & {
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.08);
    border-color: rgba(180, 35, 24, 0.2);
  }
`;

export const iconPulse = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

export const statusIconSize = `
  width: 18px;
  height: 18px;
`;

export const ConnectedIcon = styled(CloudDone)`
  ${statusIconSize}
`;

export const ErrorIcon = styled(ErrorOutline)`
  ${statusIconSize}
`;

export const PendingIcon = styled(Pending)`
  ${statusIconSize}
  animation: ${iconPulse} 1.2s linear infinite;
`;

export const StatusButton = styled.button`
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

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
    box-shadow: none;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(0, 102, 204, 0.34);
    background: rgba(0, 102, 204, 0.12);
    transform: translateY(-1px);
  }

  @media (max-width: 860px) {
    width: 100%;
  }
`;

export const ApiBase = styled.p`
  grid-column: 1 / -1;
  margin: 0;
  overflow-wrap: anywhere;
  color: #8f9aa5;
  font-size: 12px;
  font-weight: 700;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

export const PricingScreen = styled.main`
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

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    background: var(--forge-bg);
  }

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    align-items: start;
    padding: 28px;
  }
`;

export const PricingHero = styled.section`
  display: grid;
  align-content: center;
  gap: 24px;
`;

export const PricingCopy = styled.div`
  display: grid;
  gap: 16px;
`;

export const PricingTitle = styled.h1`
  max-width: 640px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(40px, 6vw, 68px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.98;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const PricingText = styled.p`
  max-width: 580px;
  margin: 0;
  color: #a7b2c2;
  font-size: 17px;
  line-height: 1.72;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

export const PricingActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;

  button {
    min-width: 150px;
    padding: 0 16px;
  }
`;

export const PricingPlans = styled.section`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const PricingPlanCard = styled.article`
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

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &[data-featured="true"] {
    border-color: rgba(0, 102, 204, 0.34);
    background: var(--forge-surface);
    box-shadow: none;
  }
`;

export const PlanEyebrow = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;

  html[data-forge-theme="light"] & {
    color: var(--forge-blue);
  }
`;

export const PlanPrice = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: 56px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.95;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }

  span {
    color: #8f9aa5;
    font-size: 18px;
    font-weight: 760;
  }

  html[data-forge-theme="light"] & span {
    color: var(--forge-text-muted);
  }
`;

export const PlanDescription = styled.p`
  margin: 0;
  color: #bdc6ce;
  font-size: 14px;
  line-height: 1.62;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

export const PlanFeatureList = styled.ul`
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

  html[data-forge-theme="light"] & li {
    color: var(--forge-text-soft);
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

  html[data-forge-theme="light"] & li::before {
    background: var(--forge-blue);
  }
`;

export const AuthenticatedWorkspaceFrame = styled.div`
  position: relative;
  width: 100%;
  min-width: 320px;
  height: calc(100vh - ${TITLE_BAR_HEIGHT});
  min-height: 0;
  overflow: hidden;
  background: var(--forge-bg);

  @media (max-width: 760px) {
    height: auto;
    min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  }
`;

export const WorkspaceStartupOverlay = styled(SplashScreen).attrs({ as: "section" })`
  position: absolute;
  inset: 0;
  z-index: 50;
  width: 100%;
  height: 100%;
  min-height: 0;
`;

export const WorkspaceStartupDetails = styled.div`
  position: relative;
  z-index: 2;
  display: grid;
  width: min(520px, 92%);
  justify-items: stretch;
  overflow: visible;

  > * {
    width: 100%;
  }

  > * + * {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
  }

  && > [data-compact="true"] {
    width: 100%;
  }

  ${LaunchStatusPanel},
  ${LaunchActions} {
    width: 100%;
  }

  ${LaunchStatusPanel} {
    gap: 10px;
    padding: 10px 12px;
  }

  ${LaunchStatusIcon} {
    width: 30px;
    height: 30px;
  }

  ${LoadingText} {
    overflow: hidden;
    font-size: 14px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  ${LoadingDetail} {
    display: -webkit-box;
    max-height: 34px;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  @media (max-height: 620px) {
    ${LaunchStatusPanel} {
      padding: 8px 10px;
    }

    ${LoadingDetail} {
      display: none;
    }

    > [data-compact="true"] {
      padding: 6px;
    }
  }
`;

export const DashboardShell = styled.main`
  --workspace-rail-width: 192px;
  --workspace-rail-collapsed-width: 56px;
  --workspace-rail-target-width: var(--workspace-rail-width);

  position: relative;
  display: grid;
  min-width: 320px;
  height: calc(100vh - ${TITLE_BAR_HEIGHT});
  min-height: 0;
  grid-template-columns: var(--workspace-rail-current-width, var(--workspace-rail-target-width)) minmax(280px, 1fr);
  color: var(--forge-text);
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(var(--forge-tint-soft-rgb), 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(var(--forge-tint-soft-rgb), 0.016) 1px, transparent 1px),
    var(--forge-bg);
  background-size: 76px 76px, 76px 76px, auto;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transition:
    background 260ms ease,
    color 260ms ease;

  html[data-forge-theme="light"] & {
    background:
      linear-gradient(90deg, rgba(var(--forge-tint-rgb), 0.018) 1px, transparent 1px),
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.014) 1px, transparent 1px),
      var(--forge-bg);
    background-size: 76px 76px, 76px 76px, auto;
  }

  &[data-startup="true"] {
    pointer-events: none;
  }

  &[data-rail-collapsed="true"] {
    --workspace-rail-target-width: var(--workspace-rail-collapsed-width);
  }

  @media (max-width: 980px) {
    --workspace-rail-width: 184px;

    grid-template-columns: var(--workspace-rail-current-width, var(--workspace-rail-target-width)) minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    height: auto;
    min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
    grid-template-columns: 1fr;
    overflow: auto;

    &[data-rail-collapsed="true"] {
      grid-template-columns: 1fr;
    }
  }
`;

export const WorkspaceRail = styled.aside`
  display: grid;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
  border-right: 1px solid rgba(var(--forge-tint-soft-rgb), 0.14);
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.035), rgba(var(--forge-tint-soft-rgb), 0.01)),
    var(--forge-shell-rail-bg);
  box-shadow: inset -1px 0 0 rgba(var(--forge-tint-rgb), 0.04);
  animation: ${railReveal} 300ms cubic-bezier(0.2, 0.8, 0.2, 1) 40ms both;
  overflow: hidden;
  transition:
    background 260ms ease,
    border-color 260ms ease,
    box-shadow 260ms ease,
    padding 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
    gap 220ms cubic-bezier(0.2, 0.8, 0.2, 1);

  html[data-forge-theme="light"] & {
    border-right-color: rgba(var(--forge-tint-rgb), 0.12);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.035), rgba(var(--forge-tint-soft-rgb), 0.01)),
      var(--forge-shell-rail-bg);
    backdrop-filter: saturate(180%) blur(20px);
  }

  &[data-collapsed="true"] {
    gap: 7px;
    padding: 8px 6px;
  }

  @media (max-width: 760px) {
    min-height: auto;
    grid-template-rows: auto auto;
    gap: 10px;
    padding: 10px;
    border-right: 0;
    border-bottom: 1px solid var(--forge-border);
  }
`;

export const RailTop = styled.div`
  display: grid;
  align-content: start;
  gap: 9px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 4px;
`;

export const RailHeader = styled.div`
  display: grid;
  height: 24px;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 24px 24px;
  align-items: center;
  gap: 6px;
  animation: ${panelEnter} 220ms cubic-bezier(0.2, 0.8, 0.2, 1) 80ms both;
  transition:
    gap 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
    grid-template-columns 220ms cubic-bezier(0.2, 0.8, 0.2, 1);

  ${WorkspaceRail}[data-collapsed="true"] & {
    grid-template-columns: 0 0 24px;
    gap: 0;
    justify-content: center;
    justify-items: center;
  }

  @media (max-width: 760px) {
    height: 24px;
    grid-template-columns: minmax(0, 1fr) 24px 24px;
    gap: 6px;
    justify-content: stretch;
    justify-items: stretch;
  }
`;

export const RailSectionTitle = styled.button`
  max-width: 120px;
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--forge-text-disabled);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  overflow: hidden;
  text-align: left;
  white-space: nowrap;
  transition:
    color 160ms ease,
    max-width 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);

  &:hover,
  &:focus-visible {
    color: var(--forge-accent-soft);
    outline: none;
  }

  &[data-mode="loopspaces"] {
    color: var(--forge-amber);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    max-width: 0;
    opacity: 0;
    transform: translateX(-4px);
  }

  @media (max-width: 760px) {
    max-width: none;
    opacity: 1;
    transform: none;
  }
`;

export const RailCollapseButton = styled.button`
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  justify-self: end;
  padding: 0;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 7px;
  color: var(--forge-text-muted);
  background:
    linear-gradient(180deg, rgba(230, 236, 245, 0.035), rgba(230, 236, 245, 0.012)),
    rgba(7, 9, 13, 0.48);
  box-shadow: none;
  line-height: 0;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);

  svg {
    display: block;
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin: 0;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  &:hover {
    border-color: rgba(var(--forge-accent-rgb), 0.22);
    color: var(--forge-text);
    background:
      linear-gradient(90deg, rgba(var(--forge-accent-rgb), 0.09), rgba(var(--forge-accent-soft-rgb), 0.025)),
      rgba(13, 17, 23, 0.58);
    box-shadow: none;
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text-muted);
    background: var(--forge-surface-control);
    box-shadow: none;
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(var(--forge-accent-rgb), 0.28);
    color: var(--forge-blue);
    background: var(--forge-surface);
    box-shadow: none;
  }

  &:active {
    transform: scale(0.97);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    justify-self: center;
    margin: 0 auto;
  }

  ${WorkspaceRail}[data-collapsed="true"] &:hover svg {
    transform: translateX(1px);
  }

  @media (max-width: 760px) {
    justify-self: end;
  }
`;

export const RailCreateWorkspaceButton = styled(RailCollapseButton)`
  color: var(--forge-text-soft);

  &:hover {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.28);
    color: var(--forge-tint-soft);
    background:
      linear-gradient(90deg, rgba(var(--forge-tint-rgb), 0.14), rgba(var(--forge-tint-soft-rgb), 0.045)),
      rgba(13, 17, 23, 0.58);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    display: none;
  }
`;

export const WorkspaceList = styled.div`
  display: grid;
  min-width: 0;
  max-width: 100%;
  gap: 6px;
  /* RailTop owns scrolling; this stays a simple stack of workspace rows. */
  overflow: visible;
  padding-right: 2px;

  ${WorkspaceRail}[data-collapsed="true"] & {
    padding-right: 0;
  }
`;

export const WorkspaceRow = styled.div`
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

  &::before,
  &::after {
    position: absolute;
    inset: -2px;
    border-radius: 10px;
    content: "";
    opacity: 0;
    pointer-events: none;
  }

  &::before {
    border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.32);
    background:
      linear-gradient(90deg, rgba(var(--forge-accent-rgb), 0.08), rgba(var(--forge-accent-soft-rgb), 0.07)),
      rgba(230, 236, 245, 0.025);
    z-index: 0;
  }

  &::after {
    inset: 1px;
    border-radius: 8px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(var(--forge-accent-soft-rgb), 0.04) 35%,
      rgba(255, 190, 96, 0.2) 50%,
      rgba(var(--forge-accent-soft-rgb), 0.04) 65%,
      transparent 100%
    );
    z-index: 1;
  }

  &[data-notification-highlight="true"]::before {
    animation: ${workspaceNotificationPing} 800ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  &[data-notification-highlight="true"]::after {
    animation: ${workspaceNotificationScan} 800ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
`;

export const WorkspaceButton = styled.button`
  --workspace-card-bg: transparent;
  --workspace-card-border: transparent;
  --workspace-card-text: #c7d0dc;
  --workspace-card-muted: #7e8998;
  --workspace-card-status: rgba(144, 155, 170, 0.32);
  --workspace-card-status-border: rgba(144, 155, 170, 0.24);
  --workspace-card-hover-bg: rgba(230, 236, 245, 0.04);
  --workspace-card-hover-border: rgba(230, 236, 245, 0.08);
  --workspace-card-selected-bg: var(--forge-accent-selected-bg);
  --workspace-card-selected-border: var(--forge-accent-selected-border);
  --workspace-card-selected-ring: var(--forge-accent-selected-ring);

  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 38px;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: stretch;
  gap: 7px;
  padding: 4px 8px 4px 7px;
  border: 1px solid var(--workspace-card-border);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--workspace-card-text);
  background: var(--workspace-card-bg);
  overflow: hidden;
  text-align: left;
  z-index: 2;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    gap 190ms cubic-bezier(0.2, 0.8, 0.2, 1),
    padding 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
    grid-template-columns 220ms cubic-bezier(0.2, 0.8, 0.2, 1);

  strong {
    display: block;
    max-height: 16px;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 720;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      max-height 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 140ms ease,
      transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  &[data-runtime="closed"] {
    --workspace-card-text: #aab4c1;
    --workspace-card-muted: #687382;
    --workspace-card-status: rgba(144, 155, 170, 0.22);
    --workspace-card-status-border: rgba(144, 155, 170, 0.22);
  }

  &[data-runtime="activating"] {
    --workspace-card-border: transparent;
    --workspace-card-text: #ead7aa;
    --workspace-card-muted: #a89261;
    --workspace-card-status: #d8b36a;
    --workspace-card-status-border: rgba(216, 179, 106, 0.44);
    --workspace-card-hover-bg: rgba(216, 179, 106, 0.06);
    --workspace-card-hover-border: rgba(216, 179, 106, 0.18);
  }

  &[data-runtime="activated"] {
    --workspace-card-border: transparent;
    --workspace-card-text: #dbe7f6;
    --workspace-card-muted: #8797aa;
    --workspace-card-status: var(--forge-blue-soft);
    --workspace-card-status-border: rgba(var(--forge-accent-soft-rgb), 0.42);
    --workspace-card-hover-bg: rgba(125, 160, 205, 0.055);
    --workspace-card-hover-border: rgba(125, 160, 205, 0.16);
  }

  html[data-forge-theme="light"] & {
    --workspace-card-text: #333333;
    --workspace-card-muted: #7a7a7a;
    --workspace-card-status: rgba(0, 0, 0, 0.2);
    --workspace-card-status-border: rgba(0, 0, 0, 0.12);
    --workspace-card-hover-bg: rgba(0, 0, 0, 0.035);
    --workspace-card-hover-border: rgba(0, 0, 0, 0.08);
    --workspace-card-selected-bg: var(--forge-accent-selected-bg);
    --workspace-card-selected-border: var(--forge-accent-selected-border);
    --workspace-card-selected-ring: var(--forge-accent-selected-ring);
  }

  html[data-forge-theme="light"] &[data-runtime="closed"] {
    --workspace-card-text: #555555;
    --workspace-card-muted: #8b8b90;
    --workspace-card-status: rgba(0, 0, 0, 0.16);
    --workspace-card-status-border: rgba(0, 0, 0, 0.1);
  }

  html[data-forge-theme="light"] &[data-runtime="activating"] {
    --workspace-card-text: #5c4100;
    --workspace-card-muted: #8b5a00;
    --workspace-card-status: #8b5a00;
    --workspace-card-status-border: rgba(139, 90, 0, 0.28);
    --workspace-card-hover-bg: rgba(139, 90, 0, 0.06);
    --workspace-card-hover-border: rgba(139, 90, 0, 0.16);
  }

  html[data-forge-theme="light"] &[data-runtime="activated"] {
    --workspace-card-text: #1d1d1f;
    --workspace-card-muted: #5f6f85;
    --workspace-card-status: var(--forge-blue);
    --workspace-card-status-border: rgba(var(--forge-accent-rgb), 0.34);
    --workspace-card-hover-bg: rgba(var(--forge-accent-rgb), 0.06);
    --workspace-card-hover-border: rgba(var(--forge-accent-rgb), 0.18);
  }

  &:hover,
  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}[data-native-hovered="true"] &,
  ${WorkspaceRow}:focus-within & {
    border-color: var(--workspace-card-hover-border);
    background: var(--workspace-card-hover-bg);
    padding-right: 34px;
  }

  &[data-selected="true"] {
    border-color: var(--workspace-card-selected-border);
    background: var(--workspace-card-selected-bg);
    box-shadow:
      0 0 0 1px var(--workspace-card-selected-ring),
      inset 0 0 0 1px rgba(var(--forge-accent-soft-rgb), 0.08);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    min-height: 38px;
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    justify-items: center;
    padding: 4px;
    text-align: center;
  }

  ${WorkspaceRail}[data-collapsed="true"] & strong {
    max-height: 0;
    opacity: 0;
    transform: translateX(-4px);
  }

  @media (max-width: 760px) {
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 7px;
    justify-items: stretch;
    padding: 4px 8px 4px 7px;
    text-align: left;

    &:hover,
    ${WorkspaceRow}:hover &,
    ${WorkspaceRow}[data-native-hovered="true"] &,
    ${WorkspaceRow}:focus-within & {
      padding-right: 34px;
    }

    strong {
      max-height: 16px;
      opacity: 1;
      transform: none;
    }
  }
`;

export const WorkspaceLabel = styled.div`
  display: grid;
  position: relative;
  min-width: 0;
  max-width: 100%;
  min-height: 28px;
  overflow: hidden;
  align-content: center;
  gap: 2px;
  transition:
    gap 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    place-items 180ms cubic-bezier(0.2, 0.8, 0.2, 1);

  > span:not([data-compact-glyph="true"]) {
    display: block;
    max-height: 12px;
    min-width: 0;
    overflow: hidden;
    color: var(--workspace-card-muted);
    font-size: 10px;
    font-weight: 650;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      max-height 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 140ms ease,
      transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    place-items: center;
    gap: 0;
  }

  ${WorkspaceRail}[data-collapsed="true"] & > span:not([data-compact-glyph="true"]) {
    max-height: 0;
    opacity: 0;
    transform: translateX(-4px);
  }

  @media (max-width: 760px) {
    place-items: initial;
    gap: 2px;

    > span:not([data-compact-glyph="true"]) {
      max-height: 12px;
      opacity: 1;
      transform: none;
    }
  }
`;

export const WorkspaceCompactGlyph = styled.span.attrs({ "data-compact-glyph": "true" })`
  position: relative;
  display: grid;
  width: 0;
  height: 0;
  place-items: center;
  border: 1px solid rgba(144, 155, 170, 0.24);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--workspace-card-text);
  background: rgba(230, 236, 245, 0.025);
  box-shadow: none;
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0.03em;
  line-height: 1;
  opacity: 0;
  overflow: hidden;
  transform: scale(0.82);
  transition:
    width 210ms cubic-bezier(0.2, 0.8, 0.2, 1),
    height 210ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 150ms ease,
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 210ms cubic-bezier(0.2, 0.8, 0.2, 1);

  &::after {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 5px;
    height: 5px;
    border-radius: 3px;
    border: 1px solid rgba(3, 5, 8, 0.9);
    box-sizing: border-box;
    background: var(--workspace-card-status);
    content: "";
    opacity: 0;
    transform: scale(0.8);
    transition:
      background 160ms ease,
      box-shadow 160ms ease,
      opacity 140ms ease,
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    width: 28px;
    height: 28px;
    opacity: 1;
    transform: scale(1);
  }

  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceButton}[data-runtime="closed"] & {
    color: var(--workspace-card-text);
    background: rgba(230, 236, 245, 0.018);
  }

  @media (max-width: 760px) {
    width: 0;
    height: 0;
    opacity: 0;
    transform: scale(0.82);
  }
`;

export const WorkspaceNotificationBadge = styled.span`
  position: absolute;
  top: 5px;
  right: 5px;
  display: inline-grid;
  min-width: 16px;
  height: 16px;
  place-items: center;
  padding: 0 5px;
  border: 1px solid rgba(247, 181, 83, 0.38);
  border-radius: 999px;
  box-sizing: border-box;
  color: #fff8ea;
  background: #b85d19;
  box-shadow: 0 0 0 1px rgba(3, 5, 8, 0.74), 0 6px 14px rgba(184, 93, 25, 0.24);
  font-size: 9px;
  font-weight: 820;
  line-height: 1;
  pointer-events: none;
  text-align: center;
  white-space: nowrap;
  z-index: 2;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    opacity 160ms ease,
    right 210ms cubic-bezier(0.2, 0.8, 0.2, 1),
    top 210ms cubic-bezier(0.2, 0.8, 0.2, 1);

  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}[data-native-hovered="true"] &,
  ${WorkspaceRow}:focus-within & {
    right: 36px;
  }

  &[data-variant="unread"] {
    border-color: rgba(101, 161, 245, 0.36);
    color: #edf5ff;
    background: #2f69d1;
    box-shadow: 0 0 0 1px rgba(3, 5, 8, 0.7), 0 6px 14px rgba(47, 105, 209, 0.22);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(139, 90, 0, 0.22);
    color: #ffffff;
    background: #a65316;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.72), 0 6px 12px rgba(105, 70, 25, 0.16);
  }

  html[data-forge-theme="light"] &[data-variant="unread"] {
    border-color: rgba(0, 102, 204, 0.24);
    background: #0066cc;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.74), 0 6px 12px rgba(0, 102, 204, 0.16);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    top: 2px;
    right: 2px;
    min-width: 14px;
    height: 14px;
    padding: 0 4px;
    font-size: 8px;
  }

  @media (max-width: 760px) {
    top: 5px;
    right: 5px;
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    font-size: 9px;

    ${WorkspaceRow}:hover &,
    ${WorkspaceRow}[data-native-hovered="true"] &,
    ${WorkspaceRow}:focus-within & {
      right: 36px;
    }
  }
`;

export const WorkspaceSettingsButton = styled.button`
  position: absolute;
  top: 50%;
  right: 4px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: #050607;
  opacity: 0;
  pointer-events: none;
  transform: translate(4px, -50%);
  z-index: 4;
  transition:
    opacity 160ms ease,
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  svg {
    display: block;
    width: 16px;
    height: 16px;
    margin: auto;
  }

  &:hover {
    border-color: rgba(185, 191, 203, 0.2);
    color: var(--forge-text-soft);
    background: #090a0c;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(var(--forge-accent-rgb), 0.22);
    color: var(--forge-blue);
    background: var(--forge-surface-control);
  }

  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}[data-native-hovered="true"] &,
  ${WorkspaceRow}:focus-within & {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%);
  }

  ${WorkspaceRail}[data-collapsed="true"] &,
  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceRow}:hover &,
  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceRow}[data-native-hovered="true"] &,
  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceRow}:focus-within & {
    opacity: 0;
    pointer-events: none;
    transform: translate(8px, -50%) scale(0.86);
  }

  @media (max-width: 760px) {
    ${WorkspaceRow}:hover &,
    ${WorkspaceRow}[data-native-hovered="true"] &,
    ${WorkspaceRow}:focus-within & {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(-50%);
    }
  }
`;

export const WorkspaceLifecycleButton = styled(WorkspaceSettingsButton)`
  right: auto;
  left: 2px;
  border-radius: 7px;
  color: #d7e7ff;
  background:
    linear-gradient(180deg, rgba(17, 24, 39, 0.96), rgba(5, 6, 7, 0.98)),
    #050607;
  transform: translate(-4px, -50%) scale(0.92);

  &[data-runtime="closed"] {
    color: #8fb7ff;
  }

  &[data-runtime="activating"] {
    color: #ffe2a8;
    border-color: rgba(216, 179, 106, 0.42);
  }

  &[data-runtime="activated"] {
    color: #ffc7c7;
    border-color: rgba(248, 113, 113, 0.26);
  }

  &:hover {
    color: #ffffff;
    border-color: rgba(var(--forge-accent-soft-rgb), 0.38);
    background:
      linear-gradient(180deg, rgba(23, 35, 58, 0.98), rgba(8, 10, 14, 0.98)),
      #080a0e;
  }

  &[data-runtime="activated"]:hover {
    border-color: rgba(248, 113, 113, 0.42);
  }

  &:disabled {
    cursor: default;
    opacity: 0;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}[data-native-hovered="true"] &,
  ${WorkspaceRow}:focus-within & {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) scale(1);
  }

  ${WorkspaceRail}[data-collapsed="true"] &,
  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceRow}:hover &,
  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceRow}[data-native-hovered="true"] &,
  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceRow}:focus-within & {
    opacity: 0;
    pointer-events: none;
    transform: translate(-8px, -50%) scale(0.86);
  }
`;

export const WorkspaceAccent = styled.span`
  align-self: center;
  justify-self: center;
  width: 10px;
  height: 10px;
  border: 1px solid var(--workspace-card-status-border);
  border-radius: 3px;
  box-sizing: border-box;
  background: rgba(230, 236, 245, 0.025);
  box-shadow: none;
  transition:
    background 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;

  ${WorkspaceButton}[data-runtime="activating"] & {
    border-color: var(--workspace-card-status-border);
    background: var(--workspace-card-status);
    box-shadow: 0 0 10px rgba(216, 179, 106, 0.18);
    transform: scale(1.08);
  }

  ${WorkspaceButton}[data-runtime="activated"] & {
    border-color: var(--workspace-card-status-border);
    background: var(--workspace-card-status);
    box-shadow: 0 0 10px rgba(var(--forge-accent-rgb), 0.2);
    transform: scale(1.08);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    position: absolute;
    top: 50%;
    left: 5px;
    width: 2px;
    height: 18px;
    border: 0;
    border-radius: 999px;
    opacity: 0;
    transform: translate(-2px, -50%) scaleY(0.8);
  }

  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceButton}[data-runtime="activating"] & {
    opacity: 1;
    transform: translate(0, -50%) scaleY(1);
  }

  ${WorkspaceRail}[data-collapsed="true"] ${WorkspaceButton}[data-runtime="activated"] & {
    opacity: 1;
    transform: translate(0, -50%) scaleY(1);
  }

  @media (max-width: 760px) {
    position: static;
    height: 10px;
    opacity: 1;
    transform: none;
  }
`;

export const WorkspaceMuted = styled.p`
  margin: 0;
  padding: 8px 9px;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 650;
`;

export const RailFooter = styled.div`
  display: grid;
  gap: 4px;
  min-height: 0;
  padding-top: 8px;
  border-top: 1px solid var(--forge-border);
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.04), transparent),
    rgba(7, 9, 13, 0.7);
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 220ms both;
  transition:
    background 260ms ease,
    border-color 260ms ease,
    gap 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    padding 180ms cubic-bezier(0.2, 0.8, 0.2, 1);

  html[data-forge-theme="light"] & {
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), transparent),
      rgba(245, 245, 247, 0.68);
  }
`;

export const RailGlobalActions = styled.div`
  display: grid;
  gap: 2px;
  margin-top: 7px;
  padding: 4px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.018), transparent),
    rgba(230, 236, 245, 0.018);
  transition:
    padding 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 160ms ease,
    background 160ms ease;

  ${WorkspaceRail}[data-collapsed="true"] & {
    margin-top: 6px;
    padding: 3px;
    border-color: rgba(230, 236, 245, 0.075);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.12);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.02), transparent),
      var(--forge-surface);
  }
`;

export const RailActionButton = styled.button`
  position: relative;
  display: inline-flex;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 9px 0 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--forge-text-soft);
  background: transparent;
  overflow: hidden;
  font-size: 12px;
  font-weight: 720;
  text-align: left;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease,
    gap 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    min-height 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    padding 220ms cubic-bezier(0.2, 0.8, 0.2, 1);

  &::before {
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: 3px;
    width: 2px;
    border-radius: 999px;
    background: transparent;
    content: "";
    transition:
      background 160ms ease,
      box-shadow 160ms ease;
  }

  svg {
    display: block;
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
    margin: 0;
    color: var(--forge-text-muted);
    transition: color 160ms ease;
  }

  span {
    max-width: 120px;
    min-width: 0;
    overflow: hidden;
    opacity: 1;
    text-overflow: ellipsis;
    transform: translateX(0);
    transition:
      max-width 190ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 140ms ease,
      transform 190ms cubic-bezier(0.2, 0.8, 0.2, 1);
    white-space: nowrap;
  }

  &[data-active="true"],
  &:hover {
    color: var(--forge-text);
    border-color: rgba(125, 160, 205, 0.16);
    background: rgba(125, 160, 205, 0.055);
  }

  &[data-active="true"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.28);
    background: rgba(var(--forge-accent-soft-rgb), 0.12);
  }

  &[data-active="true"]::before {
    background: var(--forge-accent-soft);
    box-shadow: 0 0 10px rgba(var(--forge-accent-rgb), 0.22);
  }

  &[data-active="true"] svg,
  &:hover svg {
    color: var(--forge-accent-soft);
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text-soft);
  }

  html[data-forge-theme="light"] & svg {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] &[data-active="true"],
  html[data-forge-theme="light"] &:hover {
    border-color: rgba(var(--forge-accent-rgb), 0.2);
    color: var(--forge-text);
    background: rgba(var(--forge-accent-rgb), 0.08);
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    border-color: rgba(var(--forge-accent-rgb), 0.28);
    background: rgba(var(--forge-accent-rgb), 0.1);
  }

  html[data-forge-theme="light"] &[data-active="true"]::before {
    background: var(--forge-accent);
    box-shadow: none;
  }

  html[data-forge-theme="light"] &[data-active="true"] svg,
  html[data-forge-theme="light"] &:hover svg {
    color: var(--forge-accent);
  }

  &[data-scope="global"] {
    min-height: 34px;
    padding-left: 8px;
    border-color: transparent;
    color: #98a3b1;
    background: transparent;
  }

  &[data-scope="global"]::before {
    display: none;
  }

  &[data-scope="global"] svg {
    color: #8994a3;
  }

  &[data-scope="global"]:hover,
  &[data-scope="global"][data-active="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.14);
    color: #d8dee7;
    background: rgba(7, 8, 9, 0.9);
  }

  &[data-scope="global"]:hover svg,
  &[data-scope="global"][data-active="true"] svg {
    color: var(--forge-tint-soft);
  }

  html[data-forge-theme="light"] &[data-scope="global"] {
    color: var(--forge-text-soft);
    background: transparent;
  }

  html[data-forge-theme="light"] &[data-scope="global"] svg {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] &[data-scope="global"]:hover,
  html[data-forge-theme="light"] &[data-scope="global"][data-active="true"] {
    border-color: rgba(var(--forge-accent-rgb), 0.18);
    color: var(--forge-text);
    background: rgba(var(--forge-accent-rgb), 0.045);
  }

  html[data-forge-theme="light"] &[data-scope="global"][data-active="true"] {
    border-color: rgba(var(--forge-accent-rgb), 0.24);
    background: rgba(var(--forge-accent-rgb), 0.065);
  }

  html[data-forge-theme="light"] &[data-scope="global"]:hover svg,
  html[data-forge-theme="light"] &[data-scope="global"][data-active="true"] svg {
    color: var(--forge-accent);
  }

  &[data-variant="signout"] {
    color: #9b9fa8;
    background: transparent;
  }

  &[data-variant="signout"] svg {
    color: #a68e91;
  }

  html[data-forge-theme="light"] &[data-variant="signout"] {
    color: var(--forge-text-soft);
  }

  html[data-forge-theme="light"] &[data-variant="signout"] svg {
    color: var(--forge-text-muted);
  }

  &[data-variant="signout"]:hover {
    border-color: rgba(239, 107, 107, 0.18);
    color: #e6d1d1;
    background: rgba(239, 107, 107, 0.055);
  }

  &[data-variant="signout"]:hover svg {
    color: #d7a4a4;
  }

  html[data-forge-theme="light"] &[data-variant="signout"]:hover {
    border-color: rgba(180, 35, 24, 0.22);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.08);
  }

  html[data-forge-theme="light"] &[data-variant="signout"]:hover svg {
    color: var(--forge-red);
  }

  ${WorkspaceRail}[data-collapsed="true"] & {
    min-height: 30px;
    justify-content: center;
    gap: 0;
    padding: 0;
  }

  ${WorkspaceRail}[data-collapsed="true"] &::before {
    left: 50%;
    right: auto;
    bottom: 3px;
    top: auto;
    width: 16px;
    height: 2px;
    transform: translateX(-50%);
  }

  ${WorkspaceRail}[data-collapsed="true"] & span {
    max-width: 0;
    opacity: 0;
    transform: translateX(-4px);
  }

  ${WorkspaceRail}[data-collapsed="true"] &[data-scope="global"] {
    min-height: 32px;
    padding-left: 0;
  }

  @media (max-width: 760px) {
    min-height: 32px;
    justify-content: flex-start;
    gap: 8px;
    padding: 0 9px 0 11px;

    &::before {
      top: 8px;
      bottom: 8px;
      left: 3px;
      width: 2px;
      height: auto;
      transform: none;
    }

    span {
      max-width: 120px;
      opacity: 1;
      transform: none;
    }

    &[data-scope="global"] {
      min-height: 34px;
      padding-left: 8px;
    }
  }
`;

export const BlankWorkspace = styled.section`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(13, 17, 23, 0.2);
  background-size: 76px 76px, 76px 76px, auto;
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &::after {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(125, 160, 205, 0.026), transparent);
    content: "";
    opacity: 0.72;
    /* One-shot sweep on enter instead of an infinite loop, so an idle blank
       workspace stops driving continuous compositor repaints. */
    animation: ${quietSweep} 7s ease-in-out both;
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
    }
  }

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 980px) {
    min-height: 360px;
  }
`;

export const WorkspaceViewStack = styled.div`
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), transparent 18rem),
    var(--forge-bg);
  transition: background 260ms ease;
`;

export const WorkspaceMainColumn = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

export const WorkspaceAppToolLayout = styled.div`
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.04), transparent 22rem),
    var(--forge-bg);
  transition: background 260ms ease;

  &[data-workspace-tool-fullscreen="true"] [data-workspace-main-panel="true"] {
    opacity: 0.36;
    filter: brightness(0.6) saturate(0.78);
    pointer-events: none;
  }

  &[data-workspace-tool-fullscreen="true"] [data-workspace-tool-resize-handle="true"] {
    opacity: 0;
    pointer-events: none;
  }

  [data-workspace-tool-panel="true"]:not([data-pane-mode="minimized"]):not([data-pane-mode="fullscreen"]) {
    min-width: 300px;
  }

  [data-workspace-tool-panel="true"][data-pane-mode="fullscreen"] {
    position: absolute !important;
    inset: 0;
    z-index: 320;
    flex: none !important;
    width: auto !important;
    height: auto !important;
    max-width: none !important;
    min-width: 300px !important;
    min-height: 0 !important;
    overflow: visible;
    box-shadow:
      0 34px 90px rgba(0, 0, 0, 0.54),
      0 0 0 1px rgba(230, 236, 245, 0.08);
  }
`;

export const WorkspaceAppToolPortalHost = styled.div`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

export const WorkspaceAppToolMinimizedRail = styled.aside`
  display: grid;
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 1fr;
  place-items: center;
  padding: 7px 2px;
  border-left: 1px solid rgba(var(--forge-tint-soft-rgb), 0.12);
  color: rgba(232, 238, 248, 0.86);
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.14), rgba(255, 255, 255, 0.02)),
    var(--forge-shell-right-bg);
  box-shadow:
    inset 1px 0 0 rgba(var(--forge-tint-soft-rgb), 0.08),
    0 8px 22px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  backdrop-filter: blur(18px) saturate(135%);
  transition:
    background 260ms ease,
    border-color 260ms ease,
    box-shadow 260ms ease,
    color 260ms ease;

  html[data-forge-theme="light"] & {
    border-left-color: rgba(var(--forge-tint-rgb), 0.12);
    color: #2a2c31;
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.08), rgba(255, 255, 255, 0.5)),
      var(--forge-shell-right-bg);
    box-shadow: inset 1px 0 0 rgba(var(--forge-tint-rgb), 0.08);
  }
`;

export const WorkspaceAppToolRailControls = styled.div`
  position: absolute;
  top: 6px;
  left: 50%;
  z-index: 2;
  display: grid;
  place-items: center;
  transform: translateX(-50%);
`;

export const WorkspaceAppToolRailButton = styled.button`
  box-sizing: border-box;
  display: grid;
  width: 20px;
  height: 20px;
  min-width: 20px;
  min-height: 20px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  padding: 0;
  color: rgba(232, 238, 248, 0.68);
  background: transparent;
  cursor: pointer;
  line-height: 0;
  outline: none;

  svg {
    display: block;
    width: 11px;
    height: 11px;
    margin: 0;
  }

  &:hover,
  &:focus-visible {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  html[data-forge-theme="light"] & {
    color: #5d626c;
  }

  html[data-forge-theme="light"] &:hover,
  html[data-forge-theme="light"] &:focus-visible {
    color: #1d1d1f;
    background: rgba(0, 0, 0, 0.07);
  }
`;

export const WorkspaceAppToolRailLabel = styled.div`
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  color: rgba(232, 238, 248, 0.7);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
  user-select: none;

  html[data-forge-theme="light"] & {
    color: #2a2c31;
  }
`;

export const WorkspaceViewPane = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity ${VIEW_TRANSITION_MS}ms ease,
    visibility ${VIEW_TRANSITION_MS}ms step-end;

  &[data-visible="true"] {
    z-index: 2;
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity ${VIEW_TRANSITION_MS}ms ease,
      visibility 0ms step-start;
  }
`;

export const AppGlobalScriptsShelf = styled.div`
  position: relative;
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 34px;
  max-height: 38px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  padding: 4px 10px;
  border-top: 1px solid rgba(var(--forge-tint-soft-rgb), 0.16);
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
  background:
    linear-gradient(90deg, rgba(var(--forge-tint-rgb), 0.085), rgba(var(--forge-tint-soft-rgb), 0.022)),
    var(--forge-shell-right-bg, #05080d);
  box-shadow: none;
  backdrop-filter: none;
  pointer-events: auto;

  scrollbar-width: thin;
  scrollbar-color: rgba(var(--forge-tint-soft-rgb), 0.26) transparent;

  &::-webkit-scrollbar {
    height: 4px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(var(--forge-tint-soft-rgb), 0.24);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  html[data-forge-theme="light"] & {
    border-top-color: rgba(var(--forge-tint-rgb), 0.16);
    background:
      linear-gradient(90deg, rgba(var(--forge-tint-rgb), 0.1), rgba(var(--forge-tint-soft-rgb), 0.04)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.78)),
      var(--forge-shell-panel, #ffffff);
  }
`;

export const AppGlobalScriptRunStatus = styled.span`
  position: relative;
  display: inline-grid;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  place-items: center;
  border-radius: 999px;
  color: currentColor;
  cursor: pointer;

  > svg {
    grid-area: 1 / 1;
    display: block;
    width: 14px;
    height: 14px;
    transition:
      opacity 120ms ease,
      transform 120ms ease;
  }

  [data-spinner-icon="true"] {
    z-index: 1;
  }

  [data-cancel-icon="true"] {
    z-index: 2;
    opacity: 0;
    transform: scale(0.72);
  }

  &:hover,
  &:focus-visible {
    outline: none;
  }
`;

export const AppGlobalScriptButton = styled.button`
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  gap: 6px;
  width: max-content;
  min-width: max-content;
  max-width: none;
  min-height: 25px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--script-button-color, #ffffff) 18%, transparent);
  border-radius: 7px;
  color: var(--script-button-color, #ffffff);
  background: var(--script-button-bg, #07101d);
  box-shadow: none;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1px;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease;

  svg {
    flex: 0 0 auto;
  }

  > [data-script-label="true"] {
    display: inline-block;
    flex: 0 0 auto;
    min-width: max-content;
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }

  &[data-running="true"] {
    gap: 5px;
    opacity: 0.7;
    padding-left: 8px;
  }

  &[data-running="true"]:hover ${AppGlobalScriptRunStatus} [data-spinner-icon="true"],
  &[data-running="true"] ${AppGlobalScriptRunStatus}:hover [data-spinner-icon="true"],
  &[data-running="true"] ${AppGlobalScriptRunStatus}:focus-visible [data-spinner-icon="true"] {
    opacity: 0.28;
  }

  &[data-running="true"]:hover ${AppGlobalScriptRunStatus} [data-cancel-icon="true"],
  &[data-running="true"] ${AppGlobalScriptRunStatus}:hover [data-cancel-icon="true"],
  &[data-running="true"] ${AppGlobalScriptRunStatus}:focus-visible [data-cancel-icon="true"] {
    opacity: 1;
    transform: scale(1);
  }

  &:hover,
  &:focus-visible {
    border-color: color-mix(in srgb, var(--script-button-color, #ffffff) 42%, transparent);
    background: color-mix(in srgb, var(--script-button-bg, #07101d) 88%, var(--script-button-color, #ffffff));
    outline: none;
  }

  &:disabled {
    opacity: 0.5;
    cursor: progress;
  }
`;

export const WorkspaceRuntimeLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity ${VIEW_TRANSITION_MS}ms ease,
    visibility ${VIEW_TRANSITION_MS}ms step-end;

  &[data-visible="true"] {
    z-index: 1;
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity ${VIEW_TRANSITION_MS}ms ease,
      visibility 0ms step-start;
  }
`;

export const WorkspaceIdleSurface = styled(BlankWorkspace)`
  display: grid;
  isolation: isolate;
  place-items: center;
  padding: 24px;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), transparent 22rem),
    var(--forge-shell-right-bg);

  &::after {
    display: none;
  }

  html[data-forge-theme="light"] & {
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), transparent 22rem),
      var(--forge-shell-right-bg);
  }
`;

export const WorkspaceIdlePanel = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 10px;
  color: #e8eef8;
  text-align: center;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const WorkspaceIdleLogo = styled.img`
  width: clamp(74px, 10vw, 118px);
  height: clamp(74px, 10vw, 118px);
  border: 1px solid rgba(185, 191, 203, 0.18);
  border-radius: 8px;
  background: rgba(3, 5, 8, 0.72);
  box-shadow: 0 18px 70px rgba(0, 0, 0, 0.34);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
    box-shadow: none;
  }
`;

export const WorkspaceIdleTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: clamp(20px, 3vw, 34px);
  font-weight: 900;
  letter-spacing: 0;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const WorkspaceIdleDetail = styled.p`
  max-width: 360px;
  margin: 0;
  color: #8d99aa;
  font-size: 13px;
  font-weight: 760;
  line-height: 1.55;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

export const LoopspaceRuntimeSurface = styled.section`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  color: #f6f7f9;
  background: #000;
`;

export const LoopspaceRuntimeToolbar = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 48px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.92);

  @media (max-width: 640px) {
    grid-template-columns: 32px minmax(0, 1fr);
    align-content: center;
  }
`;

export const LoopspaceRuntimeNameInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  outline: none;
  color: #f6f7f9;
  background: rgba(255, 255, 255, 0.055);
  font-size: 13px;
  font-weight: 780;
  letter-spacing: 0;

  &:focus {
    border-color: rgba(255, 255, 255, 0.34);
    background: rgba(255, 255, 255, 0.085);
  }

  &:disabled {
    opacity: 0.58;
  }
`;

export const LoopspaceRuntimeIconButton = styled.button`
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: #f6f7f9;
  background: rgba(255, 255, 255, 0.055);
  cursor: pointer;
  line-height: 0;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.105);
  }

  &:disabled {
    cursor: default;
    opacity: 0.42;
  }
`;

export const LoopspaceRuntimeDangerButton = styled(LoopspaceRuntimeIconButton)`
  color: #ff8f8f;

  &:hover:not(:disabled) {
    border-color: rgba(255, 121, 121, 0.34);
    background: rgba(255, 78, 78, 0.12);
  }
`;

export const LoopspaceRuntimeStage = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr) 6px var(--loopspace-runtime-panel-height, 174px);
  min-width: 0;
  min-height: 0;
  background: #000;

  &[data-panel-collapsed="true"] {
    grid-template-rows: minmax(0, 1fr) 0 28px;
  }
`;

export const LoopspaceRuntimeTitle = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f6f7f9;
    font-size: 13px;
    font-weight: 840;
  }

  span {
    color: rgba(246, 247, 249, 0.52);
    font-size: 10px;
    font-weight: 760;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  span[data-loading="true"] {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  span[data-loading="true"] svg {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
  }
`;

export const LoopspaceRuntimeTabs = styled.div`
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(76px, max-content);
  gap: 4px;
  justify-self: end;
  min-width: 0;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);

  @media (max-width: 640px) {
    grid-column: 1 / -1;
    justify-self: stretch;
    grid-auto-columns: minmax(0, 1fr);
  }
`;

export const LoopspaceRuntimeTabButton = styled.button`
  display: inline-grid;
  height: 28px;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  padding: 0 10px;
  color: rgba(246, 247, 249, 0.58);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 820;

  svg {
    width: 14px;
    height: 14px;
  }

  &[data-active="true"] {
    color: #fff6df;
    background: rgba(255, 209, 102, 0.16);
  }

  &:hover,
  &:focus-visible {
    color: #ffffff;
    outline: none;
    background: rgba(255, 255, 255, 0.08);
  }
`;

export const LoopspaceGraphCanvas = styled.div`
  position: relative;
  display: block;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 209, 102, 0.08);
  background:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(rgba(255, 209, 102, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 209, 102, 0.055) 1px, transparent 1px),
    linear-gradient(rgba(255, 209, 102, 0.16), rgba(255, 209, 102, 0.16)),
    linear-gradient(90deg, rgba(255, 209, 102, 0.16), rgba(255, 209, 102, 0.16)),
    radial-gradient(circle at var(--loopspace-origin-x, 50%) var(--loopspace-origin-y, 50%), rgba(255, 209, 102, 0.12), transparent 90px),
    #000;
  background-size:
    var(--loopspace-grid-size, 32px) var(--loopspace-grid-size, 32px),
    var(--loopspace-grid-size, 32px) var(--loopspace-grid-size, 32px),
    var(--loopspace-grid-major-size, 160px) var(--loopspace-grid-major-size, 160px),
    var(--loopspace-grid-major-size, 160px) var(--loopspace-grid-major-size, 160px),
    100% 1px,
    1px 100%,
    100% 100%,
    100% 100%;
  background-position:
    var(--loopspace-origin-x, 50%) var(--loopspace-origin-y, 50%),
    var(--loopspace-origin-x, 50%) var(--loopspace-origin-y, 50%),
    var(--loopspace-origin-x, 50%) var(--loopspace-origin-y, 50%),
    var(--loopspace-origin-x, 50%) var(--loopspace-origin-y, 50%),
    0 var(--loopspace-origin-y, 50%),
    var(--loopspace-origin-x, 50%) 0,
    0 0,
    0 0;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;

  &[data-panning="true"] {
    cursor: grabbing;
  }
`;

export const LoopspaceGraphContent = styled.div`
  position: absolute;
  inset: 0;
  min-width: 0;
  transform: translate3d(
    calc(50% + var(--loopspace-pan-x, 0px)),
    calc(50% + var(--loopspace-pan-y, 0px)),
    0
  ) scale(var(--loopspace-zoom, 1));
  transform-origin: 0 0;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
`;

export const LoopspaceGraphEdges = styled.svg`
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: auto;

  &[data-layer="foreground"] {
    z-index: 4;
  }
`;

const loopspaceRuntimeSignalPulse = keyframes`
  0%, 100% {
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--loopspace-signal-color, #86efac) 18%, transparent),
      0 0 18px color-mix(in srgb, var(--loopspace-signal-color, #86efac) 34%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 6px color-mix(in srgb, var(--loopspace-signal-color, #86efac) 10%, transparent),
      0 0 28px color-mix(in srgb, var(--loopspace-signal-color, #86efac) 48%, transparent);
  }
`;

export const LoopspaceRuntimeSignalLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 6;
  overflow: visible;
  pointer-events: none;
`;

export const LoopspaceRuntimeSignalDot = styled.div`
  --loopspace-signal-color: #86efac;
  position: absolute;
  left: 0;
  top: 0;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(2, 6, 23, 0.94);
  border-radius: 999px;
  background: var(--loopspace-signal-color);
  pointer-events: none;
  transform: translate3d(
    calc(var(--loopspace-signal-x, 0px) - 50%),
    calc(var(--loopspace-signal-y, 0px) - 50%),
    0
  );
  transition:
    transform 90ms linear,
    opacity 180ms ease;
  animation: ${loopspaceRuntimeSignalPulse} 1.25s ease-in-out infinite;

  &::after {
    content: "";
    position: absolute;
    inset: 4px;
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.62);
  }

  &[data-tone="active"] {
    --loopspace-signal-color: #67e8f9;
  }

  &[data-tone="queued"] {
    --loopspace-signal-color: #facc15;
  }

  &[data-tone="paused"] {
    --loopspace-signal-color: #c084fc;
    animation-duration: 1.9s;
  }

  &[data-tone="error"] {
    --loopspace-signal-color: #fb7185;
    animation-duration: 900ms;
  }

  &[data-tone="good"] {
    --loopspace-signal-color: #34d399;
    opacity: 0.72;
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;
  }
`;

const loopspaceActiveEdge = keyframes`
  from { stroke-dashoffset: 18; }
  to { stroke-dashoffset: 0; }
`;

export const LoopspaceGraphEdgePath = styled.path`
  fill: none;
  stroke: rgba(255, 209, 102, 0.46);
  stroke-width: 2;
  stroke-linecap: round;
  filter: drop-shadow(0 0 8px rgba(255, 209, 102, 0.18));
  pointer-events: stroke;
  cursor: pointer;

  &[data-active="true"] {
    stroke: rgba(134, 239, 172, 0.94);
    stroke-width: 3;
    stroke-dasharray: 10 8;
    filter: drop-shadow(0 0 14px rgba(134, 239, 172, 0.38));
    animation: ${loopspaceActiveEdge} 1s linear infinite;
  }
`;

export const LoopspaceGraphConnectionPreview = styled(LoopspaceGraphEdgePath)`
  stroke: rgba(96, 165, 250, 0.74);
  stroke-dasharray: 7 6;
  filter: drop-shadow(0 0 10px rgba(96, 165, 250, 0.24));
  pointer-events: none;
`;

export const LoopspaceGraphEdgeLabel = styled.text`
  fill: rgba(248, 250, 252, 0.62);
  font-size: 10px;
  font-weight: 850;
  paint-order: stroke;
  pointer-events: auto;
  stroke: rgba(0, 0, 0, 0.72);
  stroke-width: 4px;
  text-anchor: middle;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
`;

export const LoopspaceGraphNode = styled.div`
  --loop-node-accent: 255, 209, 102;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  display: grid;
  width: max-content;
  max-width: 320px;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--loop-node-accent), 0.34);
  border-radius: 8px;
  color: #f8fafc;
  background:
    linear-gradient(135deg, rgba(var(--loop-node-accent), 0.13), rgba(255, 255, 255, 0.035)),
    rgba(6, 6, 6, 0.94);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
  pointer-events: auto;
  transform: translate3d(var(--loopspace-node-x, 0px), var(--loopspace-node-y, 0px), 0);
  user-select: none;
  -webkit-user-select: none;

  &[data-kind="cron"] { --loop-node-accent: 96, 165, 250; }
  &[data-kind="webhook"] { --loop-node-accent: 45, 212, 191; }
  &[data-kind="manual"] { --loop-node-accent: 251, 191, 36; }
  &[data-kind="send_message"] { --loop-node-accent: 148, 163, 184; }
  &[data-kind="document_read"] { --loop-node-accent: 96, 165, 250; }
  &[data-kind="document_write"] { --loop-node-accent: 96, 165, 250; }
  &[data-kind="asset_read"] { --loop-node-accent: 45, 212, 191; }
  &[data-kind="asset_write"] { --loop-node-accent: 45, 212, 191; }
  &[data-settings-open="true"] {
    border-color: rgba(var(--loop-node-accent), 0.62);
    box-shadow:
      0 0 0 2px rgba(var(--loop-node-accent), 0.12),
      0 22px 60px rgba(0, 0, 0, 0.48);
  }
  &[data-region="true"] {
    box-sizing: border-box;
    width: var(--loopspace-node-width, 680px);
    height: var(--loopspace-node-height, 260px);
    max-width: none;
    align-items: start;
    grid-template-columns: 38px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    --loopspace-output-gutter: var(--loopspace-node-output-gutter, 92px);
    padding: 14px var(--loopspace-output-gutter) 16px 16px;
    background:
      linear-gradient(135deg, rgba(var(--loop-node-accent), 0.12), rgba(255, 255, 255, 0.025)),
      rgba(5, 10, 11, 0.72);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.025),
      0 22px 60px rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(10px) saturate(120%);
  }
  &[data-kind="run_script"] {
    --loop-node-accent: 251, 191, 36;
    --loopspace-output-gutter: var(--loopspace-node-output-gutter, 112px);
    box-sizing: border-box;
    width: var(--loopspace-node-width, 360px);
    max-width: none;
    min-height: var(--loopspace-node-height, 132px);
    padding-right: var(--loopspace-output-gutter);
  }
  &[data-kind="document_read"],
  &[data-kind="document_write"],
  &[data-kind="asset_read"],
  &[data-kind="asset_write"] {
    box-sizing: border-box;
    width: var(--loopspace-node-width, 270px);
    height: var(--loopspace-node-height, 128px);
    max-width: none;
    grid-template-rows: minmax(0, 1fr);
    align-items: stretch;
    padding-right: 52px;
    overflow: visible;
  }
  &[data-kind="loop"] {
    --loop-node-accent: 255, 209, 102;
  }

  &[data-runtime] {
    border-color: rgba(134, 239, 172, 0.72);
    box-shadow:
      0 0 0 1px rgba(134, 239, 172, 0.18),
      0 0 26px rgba(134, 239, 172, 0.18),
      0 18px 48px rgba(0, 0, 0, 0.42);
  }

  &[data-kind="send_message"][data-runtime] {
    border-color: rgba(148, 163, 184, 0.58);
    box-shadow:
      0 0 0 1px rgba(148, 163, 184, 0.12),
      0 0 24px rgba(148, 163, 184, 0.12),
      0 18px 48px rgba(0, 0, 0, 0.42);
  }

  &[data-runtime-selected="true"] {
    border-color: rgba(255, 209, 102, 0.78);
    box-shadow:
      0 0 0 2px rgba(255, 209, 102, 0.14),
      0 0 28px rgba(255, 209, 102, 0.16),
      0 20px 54px rgba(0, 0, 0, 0.44);
  }

  &[data-pending="true"] {
    border-style: dashed;
    border-color: rgba(var(--loop-node-accent), 0.62);
    opacity: 0.68;
    box-shadow:
      0 0 0 1px rgba(var(--loop-node-accent), 0.12),
      0 16px 42px rgba(0, 0, 0, 0.36);
  }

  &[data-document-drop-target="true"] {
    border-color: rgba(134, 239, 172, 0.9);
    box-shadow:
      0 0 0 1px rgba(134, 239, 172, 0.22),
      0 0 24px rgba(134, 239, 172, 0.2),
      0 18px 48px rgba(0, 0, 0, 0.42);
  }

  &[data-ghost="true"] {
    border-style: dashed;
    border-color: rgba(var(--loop-node-accent), 0.78);
    opacity: 0.5;
    pointer-events: none;
    box-shadow:
      0 0 0 1px rgba(var(--loop-node-accent), 0.18),
      0 14px 38px rgba(0, 0, 0, 0.32);
  }
`;

export const LoopspaceGraphNodeOutputPorts = styled.div`
  position: absolute;
  top: var(--loopspace-node-output-y, 50%);
  right: -10px;
  z-index: 3;
  display: grid;
  grid-auto-rows: 18px;
  gap: 8px;
  transform: translateY(-50%);
`;

export const LoopspaceGraphNodePort = styled.button`
  box-sizing: border-box;
  position: absolute;
  top: var(--loopspace-node-port-y, 50%);
  z-index: 2;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--loop-node-accent), 0.72);
  border-radius: 999px;
  background: #050505;
  box-shadow:
    0 0 0 3px rgba(var(--loop-node-accent), 0.1),
    0 0 16px rgba(var(--loop-node-accent), 0.18);
  cursor: crosshair;
  line-height: 0;
  transform: translateY(-50%);

  &::after {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: inherit;
    background: rgba(var(--loop-node-accent), 0.9);
  }

  &[data-side="input"] {
    top: var(--loopspace-node-input-y, var(--loopspace-node-port-y, 50%));
    left: -10px;
  }

  &[data-side="output"] {
    right: -10px;
  }

  &[data-active="true"],
  &:hover,
  &:focus-visible {
    outline: none;
    border-color: #ffffff;
    box-shadow:
      0 0 0 4px rgba(var(--loop-node-accent), 0.2),
      0 0 20px rgba(var(--loop-node-accent), 0.34);
  }
`;

export const LoopspaceGraphNodeOutputPort = styled.span`
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  height: 18px;
  min-height: 18px;
  color: rgba(248, 250, 252, 0.58);
  font-size: 8.5px;
  font-weight: 900;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
  pointer-events: auto;

  > span {
    max-width: 74px;
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.56);
    overflow: hidden;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-tone="exec"] {
    color: rgba(147, 197, 253, 0.9);
  }

  &[data-tone="asset"] {
    color: rgba(94, 234, 212, 0.9);
  }

  &[data-tone="success"] {
    color: rgba(134, 239, 172, 0.92);
  }

  &[data-tone="failure"] {
    color: rgba(252, 165, 165, 0.92);
  }

  &[data-tone="interrupt"] {
    color: rgba(253, 224, 71, 0.9);
  }

  ${LoopspaceGraphNodePort} {
    position: relative;
    top: auto;
    right: auto;
    flex: none;
    transform: none;
  }
`;

export const LoopspaceGraphNodeIcon = styled.span`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(var(--loop-node-accent), 0.38);
  border-radius: 8px;
  color: #fff7dd;
  background: rgba(var(--loop-node-accent), 0.14);

  svg {
    width: 18px;
    height: 18px;
  }
`;

export const LoopspaceGraphNodeText = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 3px;

  & > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  & > span {
    color: rgba(248, 250, 252, 0.56);
    font-size: 10px;
    font-weight: 740;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  ${LoopspaceGraphNode}[data-kind="document_read"] &,
  ${LoopspaceGraphNode}[data-kind="document_write"] &,
  ${LoopspaceGraphNode}[data-kind="asset_read"] &,
  ${LoopspaceGraphNode}[data-kind="asset_write"] & {
    grid-template-rows: auto auto minmax(0, 1fr);
    align-self: stretch;
    height: 100%;
  }
`;

export const LoopspaceGraphNodeTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;

  > strong {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: rgba(248, 250, 252, 0.96);
    font-size: 12.5px;
    font-weight: 850;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const LoopspaceGraphNodeSelectButton = styled.button`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 168px;
  margin-top: 5px;
  padding: 6px 9px;
  border: 1px solid rgba(var(--loop-node-accent), 0.32);
  border-radius: 7px;
  color: #f8fafc;
  background:
    linear-gradient(135deg, rgba(var(--loop-node-accent), 0.14), rgba(255, 255, 255, 0.03)),
    rgba(5, 5, 5, 0.92);
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;

  &:hover:not(:disabled),
  &[data-open="true"] {
    border-color: rgba(var(--loop-node-accent), 0.6);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.14);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
`;

export const LoopspaceGraphNodeSelectValue = styled.span`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong {
    overflow: hidden;
    font-size: 11.5px;
    font-weight: 850;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const LoopspaceGraphNodeSelectDevice = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: rgba(var(--loop-node-accent), 0.88);
  font-size: 9.5px;
  font-weight: 760;
  letter-spacing: 0.02em;
  text-transform: uppercase;

  svg {
    flex: none;
    width: 11px;
    height: 11px;
    opacity: 0.9;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-muted="true"] {
    color: rgba(248, 250, 252, 0.4);
  }
`;

export const LoopspaceGraphNodeDeviceBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  margin-top: 2px;
  padding: 4px 7px;
  border: 1px solid rgba(var(--loop-node-accent), 0.25);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.9);
  background: rgba(255, 255, 255, 0.045);
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0.02em;

  svg {
    flex: none;
    width: 12px;
    height: 12px;
    color: rgba(var(--loop-node-accent), 0.9);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const LoopspaceGraphNodeDeviceDot = styled.i`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.14);

  &[data-status="online"],
  &[data-status="connected"],
  &[data-status="active"],
  &[data-status="ready"] {
    background: #4ade80;
    box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.14);
  }

  &[data-status="queued"],
  &[data-status="awaiting_device"] {
    background: #facc15;
    box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.14);
  }
`;

export const LoopspaceGraphNodeStateBadge = styled.div`
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  gap: 7px;
  max-width: min(220px, 52%);
  min-height: 24px;
  padding: 3px 6px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.92);
  background:
    linear-gradient(135deg, rgba(148, 163, 184, 0.14), rgba(255, 255, 255, 0.035)),
    rgba(5, 8, 12, 0.82);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 10px 22px rgba(0, 0, 0, 0.28);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.04em;
  line-height: 1;
  pointer-events: auto;
  text-transform: uppercase;

  &::before {
    content: "";
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.9);
    box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.14);
  }

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-tone="queued"] {
    border-color: rgba(250, 204, 21, 0.34);
    color: rgba(254, 240, 138, 0.94);
  }

  &[data-tone="queued"]::before {
    background: #facc15;
    box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.15);
  }

  &[data-tone="active"] {
    border-color: rgba(125, 211, 252, 0.38);
    color: rgba(186, 230, 253, 0.94);
  }

  &[data-tone="active"]::before {
    border: 2px solid rgba(125, 211, 252, 0.95);
    border-top-color: transparent;
    background: transparent;
    box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.12);
    animation: loopspace-message-step-spin 780ms linear infinite;
  }

  &[data-tone="good"] {
    border-color: rgba(134, 239, 172, 0.36);
    color: rgba(187, 247, 208, 0.95);
  }

  &[data-tone="good"]::before {
    background: #34d399;
    box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.16);
  }

  &[data-tone="error"] {
    border-color: rgba(251, 113, 133, 0.38);
    color: rgba(254, 202, 202, 0.95);
  }

  &[data-tone="error"]::before {
    background: #fb7185;
    box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.15);
  }

  &[data-tone="paused"] {
    border-color: rgba(216, 180, 254, 0.38);
    color: rgba(233, 213, 255, 0.95);
  }

  &[data-tone="paused"]::before {
    background: #c084fc;
    box-shadow: 0 0 0 3px rgba(192, 132, 252, 0.16);
  }
`;

export const LoopspaceGraphNodeResumeButton = styled.button`
  display: inline-grid;
  min-width: 54px;
  height: 20px;
  place-items: center;
  margin-left: 2px;
  padding: 0 7px;
  border: 1px solid rgba(216, 180, 254, 0.42);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.94);
  background: rgba(88, 28, 135, 0.5);
  cursor: pointer;
  font: inherit;
  font-size: 9px;
  letter-spacing: 0.03em;
  pointer-events: auto;
  text-transform: uppercase;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;

  &:hover:not(:disabled),
  &:focus-visible {
    outline: none;
    border-color: rgba(233, 213, 255, 0.78);
    box-shadow: 0 0 0 3px rgba(192, 132, 252, 0.14);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }
`;

export const LoopspaceGraphNodeTimer = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: max-content;
  min-width: 92px;
  max-width: 100%;
  margin-top: 2px;
  padding: 3px 7px;
  border: 1px solid rgba(var(--loop-node-accent), 0.24);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.78);
  background: rgba(var(--loop-node-accent), 0.1);
  font-size: 9.5px;
  font-weight: 780;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  text-transform: uppercase;

  svg {
    flex: none;
    width: 11px;
    height: 11px;
    color: rgba(var(--loop-node-accent), 0.94);
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const LoopspaceGraphTriggerRunButton = styled.button`
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  margin-top: 4px;
  padding: 0;
  border: 1px solid rgba(var(--loop-node-accent), 0.34);
  border-radius: 8px;
  color: rgba(255, 247, 221, 0.96);
  background:
    linear-gradient(135deg, rgba(var(--loop-node-accent), 0.22), rgba(255, 255, 255, 0.04)),
    rgba(5, 5, 5, 0.9);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  pointer-events: auto;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease, opacity 0.12s ease;

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    outline: none;
    border-color: rgba(var(--loop-node-accent), 0.7);
    box-shadow:
      0 0 0 3px rgba(var(--loop-node-accent), 0.16),
      0 10px 24px rgba(0, 0, 0, 0.34);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.56;
  }

  &[data-running="true"] {
    opacity: 0.86;
  }
`;

export const LoopspaceGraphNodeSelectChevron = styled.span`
  display: grid;
  place-items: center;
  color: rgba(248, 250, 252, 0.6);

  svg {
    width: 16px;
    height: 16px;
    transition: transform 0.14s ease;
  }

  ${LoopspaceGraphNodeSelectButton}[data-open="true"] & svg {
    transform: rotate(180deg);
  }
`;

export const LoopspaceGraphNodeSelectMenu = styled.div`
  position: fixed;
  z-index: 2147483600;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 200px;
  padding: 6px;
  border: 1px solid rgba(251, 191, 36, 0.28);
  border-radius: 11px;
  background: rgba(12, 10, 6, 0.97);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(251, 191, 36, 0.08);
  backdrop-filter: blur(18px) saturate(130%);
  overflow-y: auto;
  overscroll-behavior: contain;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 8px;
    background: rgba(251, 191, 36, 0.22);
  }
`;

export const LoopspaceGraphNodeSelectOption = styled.button`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #f8fafc;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s ease, border-color 0.1s ease;

  & > svg {
    flex: none;
    width: 15px;
    height: 15px;
    color: #fbbf24;
  }

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(251, 191, 36, 0.3);
    background: rgba(251, 191, 36, 0.12);
  }

  &[data-selected="true"] {
    border-color: rgba(251, 191, 36, 0.34);
    background: rgba(251, 191, 36, 0.16);
  }
`;

export const LoopspaceGraphNodeSelectOptionMain = styled.span`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 820;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const LoopspaceGraphNodeSelectOptionDevice = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: rgba(248, 250, 252, 0.52);
  font-size: 10px;
  font-weight: 680;
  letter-spacing: 0.01em;

  svg {
    flex: none;
    width: 12px;
    height: 12px;
    color: rgba(251, 191, 36, 0.78);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: uppercase;
  }

  em {
    flex: none;
    padding: 1px 5px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(248, 250, 252, 0.6);
    font-size: 9px;
    font-style: normal;
    font-weight: 760;
    text-transform: lowercase;
  }
`;

export const LoopspaceGraphNodeSelectEmpty = styled.div`
  padding: 12px 10px;
  color: rgba(248, 250, 252, 0.55);
  font-size: 11px;
  font-weight: 640;
  text-align: center;
`;

export const LoopspaceGraphDocumentPicker = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-auto-rows: auto;
  gap: 7px;
  min-width: 0;
  min-height: 0;
  margin-top: 6px;
  pointer-events: auto;

  &[data-mode="write"] {
    grid-template-rows: auto auto auto auto minmax(0, 1fr);
  }
`;

export const LoopspaceGraphDocumentSearch = styled.input`
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.24);
  border-radius: 7px;
  color: #f8fafc;
  background: rgba(2, 6, 8, 0.74);
  font: inherit;
  font-size: 10.5px;
  font-weight: 720;
  letter-spacing: 0;
  outline: none;
  user-select: text;
  -webkit-user-select: text;

  &:focus {
    border-color: rgba(var(--loop-node-accent), 0.62);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.12);
  }

  &::placeholder {
    color: rgba(248, 250, 252, 0.36);
  }
`;

export const LoopspaceGraphDocumentOperationSelect = styled.select`
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.26);
  border-radius: 7px;
  color: #f8fafc;
  background: rgba(2, 6, 8, 0.74);
  font: inherit;
  font-size: 10.5px;
  font-weight: 780;
  letter-spacing: 0;
  outline: none;

  &:focus {
    border-color: rgba(var(--loop-node-accent), 0.62);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.12);
  }
`;

export const LoopspaceGraphDocumentTemplateInput = styled.textarea`
  width: 100%;
  min-width: 0;
  min-height: 42px;
  max-height: 88px;
  padding: 6px 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.24);
  border-radius: 7px;
  color: #f8fafc;
  background: rgba(2, 6, 8, 0.74);
  font: inherit;
  font-size: 10.5px;
  font-weight: 690;
  line-height: 1.25;
  letter-spacing: 0;
  outline: none;
  resize: vertical;
  user-select: text;
  -webkit-user-select: text;

  &:focus {
    border-color: rgba(var(--loop-node-accent), 0.62);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.12);
  }

  &::placeholder {
    color: rgba(248, 250, 252, 0.34);
  }
`;

export const LoopspaceGraphDocumentPickList = styled.div`
  display: grid;
  align-content: start;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
`;

export const LoopspaceGraphDocumentPickButton = styled.button`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid rgba(var(--loop-node-accent), 0.18);
  border-radius: 6px;
  color: rgba(248, 250, 252, 0.88);
  background: rgba(255, 255, 255, 0.035);
  text-align: left;
  cursor: pointer;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 10.5px;
    font-weight: 820;
  }

  span {
    color: rgba(var(--loop-node-accent), 0.82);
    font-size: 8.5px;
    font-weight: 860;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(var(--loop-node-accent), 0.42);
    background: rgba(var(--loop-node-accent), 0.1);
  }
`;

export const LoopspaceGraphDocumentCreateButton = styled.button`
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid rgba(134, 239, 172, 0.28);
  border-radius: 6px;
  color: rgba(220, 252, 231, 0.94);
  background: rgba(22, 101, 52, 0.16);
  text-align: left;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 10.5px;
    font-weight: 850;
  }

  span {
    color: rgba(134, 239, 172, 0.82);
    font-size: 8.5px;
    font-weight: 880;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(134, 239, 172, 0.54);
    background: rgba(22, 101, 52, 0.24);
  }
`;

export const LoopspaceGraphDocumentCreateInput = styled.input`
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  color: rgba(240, 253, 244, 0.98);
  background: transparent;
  font: inherit;
  font-size: 10.5px;
  font-weight: 850;
  letter-spacing: 0;
  outline: none;
  user-select: text;
  -webkit-user-select: text;

  &::placeholder {
    color: rgba(220, 252, 231, 0.42);
  }
`;

export const LoopspaceGraphDocumentRefList = styled.div`
  display: grid;
  align-content: start;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
  overscroll-behavior: contain;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(var(--loop-node-accent), 0.24);
  }
`;

export const LoopspaceGraphDocumentRefItem = styled.span`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid rgba(var(--loop-node-accent), 0.22);
  border-radius: 6px;
  color: rgba(248, 250, 252, 0.9);
  background: rgba(var(--loop-node-accent), 0.08);
  font-size: 10px;
  font-weight: 780;

  &[data-generated="true"] {
    border-color: rgba(134, 239, 172, 0.44);
    color: rgba(240, 253, 244, 0.96);
    background: rgba(22, 101, 52, 0.22);
    box-shadow: inset 0 0 0 1px rgba(134, 239, 172, 0.08);
  }

  &[data-generated="true"] em {
    color: rgba(134, 239, 172, 0.82);
    font-weight: 850;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  strong,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    display: block;
    font-style: normal;
  }

  em {
    display: block;
    color: rgba(248, 250, 252, 0.48);
    font-size: 8.5px;
    font-style: normal;
    font-weight: 720;
  }

  button {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    padding: 0;
    border: 0;
    color: rgba(248, 250, 252, 0.7);
    background: transparent;
    cursor: pointer;

    svg {
      width: 12px;
      height: 12px;
    }

    &:hover,
    &:focus-visible {
      outline: none;
      color: #fecaca;
    }
  }
`;

export const LoopspaceGraphNodeAction = styled.button`
  position: absolute;
  top: -9px;
  right: -9px;
  z-index: 3;
  display: inline-grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 1px solid rgba(255, 121, 121, 0.32);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.86);
  background: rgba(28, 10, 10, 0.96);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
  opacity: 0;
  transform: scale(0.82);
  pointer-events: none;
  transition: opacity 0.12s ease, transform 0.12s ease, color 0.12s ease, background 0.12s ease;

  svg {
    display: block;
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: #fff;
    border-color: rgba(255, 121, 121, 0.6);
    background: rgba(220, 60, 60, 0.92);
  }

  ${LoopspaceGraphNode}:hover &,
  ${LoopspaceGraphNode}:focus-within & {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
  }

  &:focus-visible {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
    outline: none;
  }
`;

export const LoopspaceGraphMessageRegion = styled.div`
  grid-column: 1 / -1;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
  padding-top: 4px;

  &:not([data-open="true"]) {
    position: absolute;
    top: var(--loopspace-message-flow-origin-y, 108px);
    left: var(--loopspace-message-flow-origin-x, 17px);
    width: var(--loopspace-message-flow-width, 220px);
    height: var(--loopspace-message-flow-height, 118px);
    padding-top: 0;
    pointer-events: none;
  }

  &[data-open="true"] {
    grid-template-rows: minmax(0, 1fr);
    padding-top: 2px;
  }
`;

export const LoopspaceGraphMessageSettingsButton = styled.button`
  position: absolute;
  top: 8px;
  right: 16px;
  z-index: 5;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--loop-node-accent), 0.28);
  border-radius: 7px;
  color: rgba(248, 250, 252, 0.76);
  background: rgba(0, 0, 0, 0.5);
  cursor: pointer;
  pointer-events: auto;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, color 0.12s ease, background 0.12s ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled),
  &[data-open="true"] {
    border-color: rgba(var(--loop-node-accent), 0.56);
    color: #ffffff;
    background: rgba(var(--loop-node-accent), 0.16);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.12);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

export const LoopspaceGraphMessageFlow = styled.div`
  position: relative;
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  pointer-events: none;

  &[data-empty="true"] {
    opacity: 0.7;
  }
`;

export const LoopspaceGraphMessageFlowEdges = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
`;

export const LoopspaceGraphMessageFlowEdgePath = styled.path`
  fill: none;
  stroke: rgba(var(--loop-node-accent), 0.54);
  stroke-width: 2;
  stroke-linecap: round;
  filter: drop-shadow(0 0 8px rgba(var(--loop-node-accent), 0.2));
`;

export const LoopspaceGraphMessageFlowNode = styled.div`
  --loop-message-child-accent: var(--loop-node-accent);
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  display: grid;
  width: var(--loopspace-flow-node-width, 148px);
  height: var(--loopspace-flow-node-height, 91px);
  min-width: 0;
  place-items: center;
  padding: 12px 14px;
  border: 1px solid rgba(var(--loop-message-child-accent), 0.34);
  border-radius: 8px;
  color: #f8fafc;
  background:
    linear-gradient(135deg, rgba(var(--loop-message-child-accent), 0.15), rgba(2, 6, 8, 0.5)),
    rgba(2, 8, 9, 0.86);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 12px 28px rgba(0, 0, 0, 0.28);
  cursor: grab;
  pointer-events: auto;
  transform: translate3d(var(--loopspace-flow-node-x, 8px), var(--loopspace-flow-node-y, 8px), 0);
  user-select: none;
  -webkit-user-select: none;

  &[data-status]::after {
    content: "";
    position: absolute;
    top: 8px;
    right: 8px;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    box-shadow:
      0 0 0 2px rgba(2, 8, 9, 0.94),
      0 0 12px rgba(var(--loop-message-child-accent), 0.28);
  }

  &[data-status="running"]::after {
    border: 2px solid rgba(125, 211, 252, 0.92);
    border-top-color: transparent;
    animation: loopspace-message-step-spin 780ms linear infinite;
  }

  &[data-status="completed"]::after {
    background: #34d399;
  }

  &[data-status="failed"]::after {
    background: #fb7185;
  }

  &[data-status="skipped"]::after {
    background: #94a3b8;
  }

  &[data-kind="document_read"] {
    --loop-message-child-accent: 96, 165, 250;
  }

  &[data-kind="document_write"] {
    --loop-message-child-accent: 96, 165, 250;
  }

  &[data-kind="asset_read"],
  &[data-kind="asset_write"] {
    --loop-message-child-accent: 45, 212, 191;
  }

  &[data-kind="run_script"] {
    --loop-message-child-accent: 251, 191, 36;
  }

  &:active {
    cursor: grabbing;
  }

  @keyframes loopspace-message-step-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

export const LoopspaceGraphMessageFlowNodeText = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  text-align: center;

  strong {
    min-width: 0;
    overflow: hidden;
    color: #f8fafc;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.18;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    color: rgba(248, 250, 252, 0.54);
    font-size: 9px;
    font-weight: 820;
    letter-spacing: 0.04em;
    line-height: 1.22;
    text-transform: uppercase;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
`;

export const LoopspaceGraphMessageFlowNodePort = styled.span`
  box-sizing: border-box;
  position: absolute;
  top: var(--loopspace-flow-port-y, 50%);
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--loop-message-child-accent), 0.54);
  border-radius: 999px;
  background: rgba(2, 6, 8, 0.94);
  box-shadow:
    0 0 0 3px rgba(var(--loop-message-child-accent), 0.08),
    0 0 12px rgba(var(--loop-message-child-accent), 0.18);
  cursor: crosshair;
  line-height: 0;
  pointer-events: auto;
  transform: translateY(-50%);

  &::after {
    width: 5px;
    height: 5px;
    border-radius: inherit;
    background: rgba(var(--loop-message-child-accent), 0.9);
    content: "";
  }

  &[data-side="input"] {
    left: -7px;
  }

  &[data-side="output"] {
    right: -7px;
  }

  &[data-active="true"],
  &:hover,
  &:focus-visible {
    outline: none;
    border-color: #ffffff;
    box-shadow:
      0 0 0 4px rgba(var(--loop-message-child-accent), 0.18),
      0 0 18px rgba(var(--loop-message-child-accent), 0.32);
  }
`;

export const LoopspaceGraphMessageStepPreviewList = styled.div`
  --loop-step-rail-x: 36px;
  --loop-step-gap: 8px;
  position: relative;
  display: grid;
  align-content: start;
  align-self: stretch;
  min-height: 0;
  gap: var(--loop-step-gap);
  overflow: hidden;
  padding: 8px 58px 0 24px;

  &::before {
    position: absolute;
    top: 22px;
    left: 0;
    width: var(--loop-step-rail-x);
    height: 2px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(var(--loop-node-accent), 0.16), rgba(var(--loop-node-accent), 0.68));
    box-shadow: 0 0 10px rgba(var(--loop-node-accent), 0.2);
    content: "";
    pointer-events: none;
  }

  &[data-empty="true"] {
    padding: 0;
  }

  &[data-empty="true"]::before {
    display: none;
  }
`;

export const LoopspaceGraphMessageStepPreviewItem = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  color: rgba(248, 250, 252, 0.9);

  &::before,
  &::after {
    position: absolute;
    border-radius: 999px;
    background: rgba(var(--loop-node-accent), 0.58);
    box-shadow: 0 0 10px rgba(var(--loop-node-accent), 0.18);
    content: "";
    pointer-events: none;
  }

  &::before {
    top: 50%;
    left: 12px;
    width: 34px;
    height: 2px;
    transform: translateY(-50%);
  }

  &:last-child::before {
    right: -58px;
    width: auto;
    background: linear-gradient(90deg, rgba(var(--loop-node-accent), 0.7), rgba(var(--loop-node-accent), 0.2));
  }

  &:not(:last-child)::after {
    top: 50%;
    left: 11px;
    width: 2px;
    height: calc(100% + var(--loop-step-gap));
  }
`;

export const LoopspaceGraphMessageStepPreviewNumber = styled.span`
  position: relative;
  z-index: 2;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid rgba(var(--loop-node-accent), 0.34);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.78);
  background:
    radial-gradient(circle at center, rgba(var(--loop-node-accent), 0.9) 0 4px, transparent 5px),
    rgba(2, 6, 8, 0.82);
  font-size: 0;
  font-weight: 900;
  line-height: 1;
  box-shadow:
    0 0 0 3px rgba(var(--loop-node-accent), 0.08),
    0 0 10px rgba(var(--loop-node-accent), 0.24);
`;

export const LoopspaceGraphMessageStepPreviewCopy = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  min-height: 30px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid rgba(var(--loop-node-accent), 0.24);
  border-radius: 7px;
  background:
    linear-gradient(135deg, rgba(var(--loop-node-accent), 0.12), rgba(2, 6, 8, 0.42)),
    rgba(2, 6, 8, 0.72);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.025);

  strong {
    min-width: 0;
    overflow: hidden;
    color: #f8fafc;
    font-size: 12px;
    font-weight: 900;
    line-height: 1.22;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    color: rgba(248, 250, 252, 0.58);
    font-size: 10px;
    font-weight: 720;
    line-height: 1.28;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
`;

export const LoopspaceGraphMessageControls = styled.div`
  display: grid;
  grid-template-columns: minmax(160px, 0.8fr) minmax(220px, 1.4fr);
  gap: 10px;
  min-width: 0;

  &[data-single="true"] {
    grid-template-columns: minmax(0, 1fr);
  }

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const LoopspaceGraphMessagePrompt = styled.textarea`
  width: 100%;
  min-height: 76px;
  resize: none;
  padding: 9px 10px;
  border: 1px solid rgba(var(--loop-node-accent), 0.24);
  border-radius: 8px;
  color: #f8fafc;
  background: rgba(2, 6, 8, 0.76);
  font-family: inherit;
  font-size: 11px;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.35;
  outline: none;
  pointer-events: auto;

  &:focus {
    border-color: rgba(var(--loop-node-accent), 0.62);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.12);
  }

  &::placeholder {
    color: rgba(248, 250, 252, 0.38);
  }
`;

export const LoopspaceGraphMessageSettingsPanel = styled.div`
  display: grid;
  grid-template-columns: minmax(150px, 0.72fr) minmax(250px, 1.18fr) minmax(210px, 0.9fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 9px;
  border: 1px solid rgba(var(--loop-node-accent), 0.22);
  border-radius: 9px;
  background: rgba(2, 6, 8, 0.58);
  overflow: hidden;
  pointer-events: auto;

  &[data-layout="tabs"] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  &[data-layout="resource"] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: minmax(0, auto);
    overflow: auto;
  }
`;

export const LoopspaceGraphMessageSettingsTabList = styled.div`
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 4px;
  min-width: 0;
  padding: 3px;
  border: 1px solid rgba(var(--loop-node-accent), 0.18);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.24);
`;

export const LoopspaceGraphMessageSettingsTabButton = styled.button`
  min-width: 86px;
  min-height: 28px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(248, 250, 252, 0.62);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  font-weight: 880;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;

  &:hover,
  &:focus-visible,
  &[data-active="true"] {
    outline: none;
    border-color: rgba(var(--loop-node-accent), 0.38);
    color: #ffffff;
    background: rgba(var(--loop-node-accent), 0.16);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.08);
  }
`;

export const LoopspaceGraphMessageSettingsTabPanel = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

export const LoopspaceGraphMessageSettingsSection = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  align-content: start;

  &[data-grow="true"] {
    overflow: hidden;
  }

  &[data-column="model"] {
    grid-template-rows: auto minmax(0, auto);
  }

  &[data-column="prompt"] {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  &[data-column="steps"] {
    grid-template-rows: auto auto minmax(0, 1fr);
    overflow: hidden;
  }

  &[data-column="resource"] {
    grid-template-rows: minmax(0, 1fr);
    overflow: hidden;
  }

  ${LoopspaceGraphMessageSettingsPanel}[data-layout="tabs"] & {
    height: 100%;
  }

  ${LoopspaceGraphMessageSettingsPanel}[data-layout="tabs"] &[data-column="model"] {
    align-content: start;
    padding-top: 4px;
  }

  ${LoopspaceGraphMessageSettingsPanel}[data-layout="tabs"] &[data-column="prompt"] {
    grid-template-rows: minmax(0, 1fr);
  }

  ${LoopspaceGraphMessageSettingsPanel}[data-layout="tabs"] &[data-column="steps"] {
    grid-template-rows: auto minmax(0, 1fr);
  }

  ${LoopspaceGraphMessageSettingsPanel}[data-layout="resource"] & {
    height: 100%;
  }

  ${LoopspaceGraphMessageSettingsPanel}[data-layout="resource"] ${LoopspaceGraphDocumentPicker} {
    height: 100%;
    margin-top: 0;
  }

  &[data-column="prompt"] ${LoopspaceGraphMessagePrompt} {
    height: 100%;
    min-height: 0;
  }

  > strong {
    color: rgba(248, 250, 252, 0.92);
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  > span {
    color: rgba(248, 250, 252, 0.46);
    font-size: 9px;
    font-weight: 720;
  }
`;

export const LoopspaceGraphMessageSettingsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 6px;
  min-width: 0;

  &[data-stack="true"] {
    grid-template-columns: minmax(0, 1fr);
  }

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const LoopspaceGraphMessageSettingsField = styled.label`
  display: grid;
  gap: 4px;
  min-width: 0;

  > span {
    color: rgba(248, 250, 252, 0.5);
    font-size: 8.5px;
    font-weight: 820;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;

export const LoopspaceGraphMessageSettingsSelect = styled.select`
  width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 0 26px 0 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.24);
  border-radius: 7px;
  color: #f8fafc;
  background-color: rgba(2, 6, 8, 0.78);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23b6c0cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 13px 13px;
  color-scheme: dark;
  font: inherit;
  font-size: 10px;
  font-weight: 820;
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;

  &::-ms-expand {
    display: none;
  }

  &:focus {
    border-color: rgba(var(--loop-node-accent), 0.6);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.14);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }
`;

export const LoopspaceGraphMessageSubnodeToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
`;

export const LoopspaceGraphMessageSubnodeButton = styled.button`
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid rgba(var(--loop-node-accent), 0.3);
  border-radius: 7px;
  color: rgba(248, 250, 252, 0.88);
  background: rgba(var(--loop-node-accent), 0.11);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 850;

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(var(--loop-node-accent), 0.54);
    background: rgba(var(--loop-node-accent), 0.18);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
`;

export const LoopspaceGraphMessageSubnodeList = styled.div`
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;

  ${LoopspaceGraphMessageSettingsSection}[data-column="steps"] & {
    height: 100%;
    padding-right: 4px;
  }

  &[data-orientation="horizontal"] {
    display: flex;
    align-items: stretch;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-right: 0;
    padding-bottom: 4px;
  }
`;

export const LoopspaceGraphMessageSubnodeItem = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  gap: 7px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);

  &[data-mode="write"] {
    border-color: rgba(251, 191, 36, 0.28);
  }

  &[data-empty="true"] {
    grid-template-columns: minmax(0, 1fr);
    border-style: dashed;
  }

  ${LoopspaceGraphMessageSubnodeList}[data-orientation="horizontal"] & {
    flex: 0 0 min(320px, 78vw);
    min-height: 100%;
  }

  ${LoopspaceGraphMessageSubnodeList}[data-orientation="horizontal"] &[data-empty="true"] {
    flex-basis: min(420px, 88vw);
    min-height: 92px;
  }

  > button {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(248, 113, 113, 0.22);
    border-radius: 7px;
    color: rgba(248, 250, 252, 0.72);
    background: rgba(0, 0, 0, 0.28);
    cursor: pointer;

    svg {
      width: 13px;
      height: 13px;
    }

    &:hover,
    &:focus-visible {
      outline: none;
      border-color: rgba(248, 113, 113, 0.48);
      color: #fecaca;
      background: rgba(248, 113, 113, 0.12);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.42;
    }
  }

  ${LoopspaceGraphDocumentPicker} {
    grid-column: 1 / -1;
  }
`;

export const LoopspaceGraphMessageSubnodeMain = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;

  ${LoopspaceGraphMessageSubnodeList}[data-orientation="horizontal"] & {
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }
`;

export const LoopspaceGraphMessageStepHeader = styled.div`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 6px;
  min-width: 0;
  align-items: center;
`;

export const LoopspaceGraphMessageStepNumber = styled.span`
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid rgba(var(--loop-node-accent), 0.28);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.7);
  background: rgba(var(--loop-node-accent), 0.1);
  font-size: 9px;
  font-weight: 900;
`;

export const LoopspaceGraphMessageStepInput = styled.input`
  width: 100%;
  min-width: 0;
  min-height: 25px;
  padding: 0 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.22);
  border-radius: 7px;
  color: #f8fafc;
  background: rgba(2, 6, 8, 0.72);
  font: inherit;
  font-size: 10.5px;
  font-weight: 850;
  outline: none;
  pointer-events: auto;

  &:focus {
    border-color: rgba(var(--loop-node-accent), 0.58);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.12);
  }

  &::placeholder {
    color: rgba(248, 250, 252, 0.34);
  }
`;

export const LoopspaceGraphMessageStepDescription = styled.textarea`
  width: 100%;
  min-width: 0;
  min-height: 50px;
  resize: none;
  padding: 7px 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.18);
  border-radius: 7px;
  color: rgba(248, 250, 252, 0.84);
  background: rgba(2, 6, 8, 0.56);
  font: inherit;
  font-size: 9.5px;
  font-weight: 720;
  line-height: 1.35;
  outline: none;
  pointer-events: auto;

  &:focus {
    border-color: rgba(var(--loop-node-accent), 0.52);
    box-shadow: 0 0 0 2px rgba(var(--loop-node-accent), 0.1);
  }

  &::placeholder {
    color: rgba(248, 250, 252, 0.32);
  }

  ${LoopspaceGraphMessageSubnodeList}[data-orientation="horizontal"] & {
    height: 100%;
    min-height: 86px;
  }
`;

export const LoopspaceGraphMessageSettingsActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  align-items: center;
  min-width: 0;
  padding-top: 2px;
`;

export const LoopspaceGraphMessageSaveButton = styled.button`
  min-height: 28px;
  padding: 0 13px;
  border: 1px solid rgba(var(--loop-node-accent), 0.42);
  border-radius: 8px;
  color: #ffffff;
  background: rgba(var(--loop-node-accent), 0.22);
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  font-weight: 880;

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(var(--loop-node-accent), 0.68);
    background: rgba(var(--loop-node-accent), 0.3);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &[data-variant="secondary"] {
    border-color: rgba(248, 250, 252, 0.22);
    color: rgba(248, 250, 252, 0.76);
    background: rgba(0, 0, 0, 0.32);
  }

  &[data-variant="secondary"]:hover,
  &[data-variant="secondary"]:focus-visible {
    border-color: rgba(248, 250, 252, 0.42);
    color: #f8fafc;
    background: rgba(248, 250, 252, 0.08);
  }
`;

export const LoopspaceGraphMessageCheckpointList = styled.div`
  position: relative;
  min-height: 0;
  border: 1px dashed rgba(var(--loop-node-accent), 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  overflow: hidden;
`;

export const LoopspaceGraphMessageCheckpoint = styled.span`
  position: absolute;
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  padding: 7px 9px;
  border: 1px solid rgba(var(--loop-node-accent), 0.32);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.9);
  background: rgba(3, 7, 8, 0.78);
  cursor: grab;
  font-size: 10px;
  font-weight: 820;
  overflow: hidden;
  pointer-events: auto;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translate3d(var(--checkpoint-x, 12px), var(--checkpoint-y, 12px), 0);

  &:active {
    cursor: grabbing;
  }
`;

export const LoopspaceGraphMessageDocumentContext = styled.div`
  position: absolute;
  display: grid;
  width: 220px;
  max-width: calc(100% - 24px);
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(var(--loop-node-accent), 0.3);
  border-radius: 9px;
  color: rgba(248, 250, 252, 0.92);
  background: rgba(3, 7, 8, 0.84);
  cursor: grab;
  pointer-events: auto;
  transform: translate3d(var(--checkpoint-x, 12px), var(--checkpoint-y, 12px), 0);

  &:active {
    cursor: grabbing;
  }
`;

export const LoopspaceGraphMessageResize = styled.button`
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 4;
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--loop-node-accent), 0.28);
  border-radius: 6px;
  color: rgba(248, 250, 252, 0.72);
  background: rgba(0, 0, 0, 0.42);
  cursor: nwse-resize;
  pointer-events: auto;

  &::before {
    content: "";
    width: 9px;
    height: 9px;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
  }

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(var(--loop-node-accent), 0.58);
    color: #fff;
  }

  &[data-axis="vertical"] {
    cursor: ns-resize;
  }

  &[data-axis="vertical"]::before {
    width: 10px;
    height: 8px;
    border-right: 0;
    border-left: 0;
    border-top: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
  }
`;

export const LoopspaceGraphControls = styled.div`
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid rgba(255, 209, 102, 0.16);
  border-radius: 9px;
  background: rgba(6, 6, 6, 0.76);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px) saturate(120%);
  cursor: default;
  user-select: none;
`;

export const LoopspaceGraphControlButton = styled.button`
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  color: rgba(255, 246, 223, 0.9);
  background: rgba(255, 255, 255, 0.055);
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover,
  &:focus-visible {
    color: #fff6df;
    outline: none;
    border-color: rgba(255, 209, 102, 0.34);
    background: rgba(255, 209, 102, 0.14);
  }

  &:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
`;

export const LoopspaceGraphZoomReadout = styled.span`
  min-width: 44px;
  padding: 0 6px;
  color: rgba(248, 250, 252, 0.68);
  font-size: 11px;
  font-weight: 850;
  text-align: center;
  letter-spacing: 0;
`;

export const LoopspaceGraphSaveBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 7px;
  color: rgba(226, 232, 240, 0.72);
  background: rgba(15, 23, 42, 0.56);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0;
  text-transform: uppercase;
  white-space: nowrap;

  span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 0 3px rgba(226, 232, 240, 0.06);
  }

  &[data-state="saving"] {
    border-color: rgba(125, 211, 252, 0.24);
    color: rgba(186, 230, 253, 0.88);
    background: rgba(8, 47, 73, 0.42);
  }

  &[data-state="queued"] {
    border-color: rgba(253, 224, 71, 0.24);
    color: rgba(254, 240, 138, 0.88);
    background: rgba(113, 63, 18, 0.36);
  }

  &[data-state="error"] {
    border-color: rgba(252, 165, 165, 0.3);
    color: rgba(254, 202, 202, 0.92);
    background: rgba(127, 29, 29, 0.4);
  }
`;

export const LoopspaceGraphNavHud = styled.div`
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border: 1px solid rgba(255, 209, 102, 0.16);
  border-radius: 10px;
  color: rgba(248, 250, 252, 0.64);
  background: rgba(6, 6, 6, 0.72);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(14px) saturate(120%);
  cursor: default;
  user-select: none;
`;

export const LoopspaceGraphNavMap = styled.div`
  position: relative;
  width: 76px;
  height: 52px;
  overflow: hidden;
  border: 1px solid rgba(255, 209, 102, 0.16);
  border-radius: 7px;
  background:
    linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
    rgba(255, 255, 255, 0.035);
  background-size: 12px 12px;
`;

export const LoopspaceGraphNavViewport = styled.span`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 26px;
  height: 18px;
  border: 1px solid rgba(96, 165, 250, 0.86);
  border-radius: 4px;
  background: rgba(96, 165, 250, 0.16);
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.18);
  transform: translate3d(
    calc(-50% + var(--loopspace-nav-x, 0px)),
    calc(-50% + var(--loopspace-nav-y, 0px)),
    0
  ) scale(var(--loopspace-nav-scale, 1));
`;

export const LoopspaceGraphNavOrigin = styled.span`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 209, 102, 0.86);
  box-shadow: 0 0 18px rgba(255, 209, 102, 0.48);
  transform: translate(-50%, -50%);
`;

export const LoopspaceGraphNavStats = styled.div`
  display: grid;
  gap: 3px;
  min-width: 64px;

  strong {
    color: rgba(255, 246, 223, 0.94);
    font-size: 12px;
    font-weight: 900;
  }

  span {
    color: rgba(248, 250, 252, 0.46);
    font-size: 10px;
    font-weight: 760;
    letter-spacing: 0;
    white-space: nowrap;
  }
`;

export const LoopspaceGraphPalette = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 5;
  display: flex;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
  height: 42px;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  padding: 4px 7px;
  border-top: 1px solid rgba(255, 209, 102, 0.16);
  background: rgba(6, 6, 6, 0.82);
  box-shadow: 0 -12px 28px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(14px) saturate(120%);
  cursor: default;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 209, 102, 0.24) transparent;

  &::-webkit-scrollbar {
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 209, 102, 0.24);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

export const LoopspaceGraphPaletteSearch = styled.input`
  flex: 0 0 126px;
  width: 126px;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 209, 102, 0.18);
  border-radius: 7px;
  padding: 0 9px;
  color: rgba(248, 250, 252, 0.92);
  background: rgba(7, 9, 12, 0.9);
  font-size: 10.5px;
  font-weight: 760;
  outline: none;

  &:focus {
    border-color: rgba(255, 209, 102, 0.42);
    box-shadow: 0 0 0 2px rgba(255, 209, 102, 0.12);
  }

  &::placeholder {
    color: rgba(248, 250, 252, 0.45);
  }
`;

export const LoopspaceGraphPaletteTrack = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 6px;
  min-width: max-content;
`;

export const LoopspaceGraphPaletteCard = styled.div`
  --loop-palette-accent: 129, 140, 248;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  width: 142px;
  height: 30px;
  padding: 5px 7px;
  border: 1px solid rgba(var(--loop-palette-accent), 0.28);
  border-radius: 7px;
  color: #f8fafc;
  background:
    linear-gradient(135deg, rgba(var(--loop-palette-accent), 0.14), rgba(255, 255, 255, 0.035)),
    rgba(7, 9, 12, 0.9);
  cursor: grab;
  user-select: none;

  &[data-kind="send_message"] {
    --loop-palette-accent: 148, 163, 184;
  }

  &[data-kind="device"] {
    --loop-palette-accent: 96, 165, 250;
  }

  &[data-kind="run_script"] {
    --loop-palette-accent: 251, 191, 36;
  }

  &[data-kind="asset_read"],
  &[data-kind="asset_write"] {
    --loop-palette-accent: 45, 212, 191;
  }

  &:active {
    cursor: grabbing;
  }

  &:hover {
    border-color: rgba(var(--loop-palette-accent), 0.46);
    background:
      linear-gradient(135deg, rgba(var(--loop-palette-accent), 0.2), rgba(255, 255, 255, 0.05)),
      rgba(9, 12, 16, 0.94);
  }
`;

export const LoopspaceGraphPaletteIcon = styled.span`
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid rgba(var(--loop-palette-accent), 0.38);
  border-radius: 6px;
  color: #ffffff;
  background: rgba(var(--loop-palette-accent), 0.16);

  svg {
    width: 13px;
    height: 13px;
  }
`;

export const LoopspaceGraphPaletteText = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    white-space: nowrap;
    font-size: 10.5px;
    font-weight: 900;
  }

  span {
    display: none;
    color: rgba(248, 250, 252, 0.56);
    font-size: 8.5px;
    font-weight: 680;
    line-height: 1.1;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
`;

export const LoopspaceRuntimePanel = styled.div`
  position: relative;
  z-index: 9;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-top: 0;
  color: #f8fafc;
  background:
    linear-gradient(180deg, rgba(255, 209, 102, 0.04), rgba(255, 209, 102, 0.012)),
    rgba(5, 5, 5, 0.96);
  cursor: default;
  user-select: none;

  &[data-collapsed="true"] {
    grid-template-rows: auto;
    min-height: 28px;
    background:
      linear-gradient(90deg, rgba(255, 209, 102, 0.075), rgba(255, 209, 102, 0.018)),
      rgba(5, 5, 5, 0.98);
  }
`;

export const LoopspaceRuntimePanelResizeHandle = styled.div`
  position: relative;
  z-index: 8;
  display: grid;
  height: 6px;
  min-width: 0;
  place-items: center;
  cursor: row-resize;
  touch-action: none;

  &[data-hidden="true"] {
    display: none;
  }

  &::before {
    content: "";
    position: absolute;
    inset: -5px 0 -4px;
  }

  &::after {
    content: "";
    width: 54px;
    height: 2px;
    border-radius: 999px;
    background: rgba(255, 209, 102, 0.28);
    opacity: 0;
    transition: opacity 0.12s ease, background 0.12s ease;
  }

  &:hover::after,
  &:focus-visible::after,
  &[data-dragging="true"]::after {
    opacity: 1;
    background: rgba(255, 209, 102, 0.55);
  }
`;

export const LoopspaceRuntimePanelHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 34px;
  padding: 0 10px;
  border-bottom: 1px solid rgba(255, 209, 102, 0.1);
  background: rgba(4, 8, 12, 0.92);

  &[data-collapsed="true"] {
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 28px;
    height: 28px;
    padding: 0 8px 0 10px;
    border-top: 1px solid rgba(255, 209, 102, 0.18);
    border-bottom: 0;
    color: rgba(255, 246, 223, 0.82);
    background:
      linear-gradient(90deg, rgba(255, 209, 102, 0.13), rgba(255, 209, 102, 0.032)),
      rgba(5, 7, 10, 0.98);
    box-shadow:
      inset 0 1px 0 rgba(255, 246, 223, 0.05),
      0 -12px 30px rgba(0, 0, 0, 0.34);
    cursor: default;
  }

  &[data-collapsed="true"]:hover,
  &[data-collapsed="true"]:focus-visible {
    outline: none;
    color: #fff6df;
    background:
      linear-gradient(90deg, rgba(255, 209, 102, 0.18), rgba(255, 209, 102, 0.055)),
      rgba(7, 8, 10, 0.98);
  }

  [data-restore-label="true"],
  [data-restore-hint="true"] {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-restore-label="true"] {
    color: rgba(255, 246, 223, 0.94);
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  [data-restore-hint="true"] {
    display: none;
    color: rgba(248, 250, 252, 0.62);
    font-size: 10px;
    font-weight: 760;
  }
`;

export const LoopspaceRuntimePanelTabs = styled.div`
  display: flex;
  align-items: stretch;
  gap: 18px;
  min-width: 0;
  height: 100%;
`;

export const LoopspaceRuntimePanelTab = styled.button`
  position: relative;
  display: inline-flex;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0;
  padding: 0 0 1px;
  color: rgba(248, 250, 252, 0.58);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
  font-weight: 820;
  letter-spacing: 0.02em;
  text-transform: uppercase;

  &::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    border-radius: 999px 999px 0 0;
    background: transparent;
  }

  &[data-active="true"] {
    color: #ffd166;
  }

  &[data-active="true"]::after {
    background: #ffd166;
  }

  &:hover,
  &:focus-visible {
    color: #ffffff;
    outline: none;
  }
`;

export const LoopspaceRuntimePanelToggle = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: rgba(248, 250, 252, 0.72);
  background: transparent;
  cursor: pointer;

  svg {
    width: 17px;
    height: 17px;
    transition: transform 0.14s ease;
  }

  &[data-collapsed="true"] svg {
    width: 14px;
    height: 14px;
    transform: rotate(180deg);
  }

  &[data-collapsed="true"] {
    display: inline-flex;
    width: auto;
    min-width: 68px;
    height: 22px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 8px;
    border: 1px solid rgba(255, 209, 102, 0.36);
    border-radius: 7px;
    color: #fff6df;
    background:
      linear-gradient(135deg, rgba(255, 209, 102, 0.2), rgba(255, 255, 255, 0.045)),
      rgba(8, 9, 10, 0.94);
    box-shadow:
      0 0 0 1px rgba(255, 209, 102, 0.08),
      0 8px 22px rgba(0, 0, 0, 0.24);
  }

  &[data-collapsed="true"] span {
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.02em;
    line-height: 1;
    text-transform: uppercase;
  }

  &:hover,
  &:focus-visible {
    color: #fff;
    outline: none;
    background: rgba(255, 209, 102, 0.1);
  }

  &[data-collapsed="true"]:hover,
  &[data-collapsed="true"]:focus-visible {
    border-color: rgba(255, 209, 102, 0.58);
    color: #ffffff;
    background:
      linear-gradient(135deg, rgba(255, 209, 102, 0.28), rgba(255, 255, 255, 0.06)),
      rgba(12, 10, 7, 0.96);
    box-shadow:
      0 0 0 2px rgba(255, 209, 102, 0.12),
      0 10px 24px rgba(0, 0, 0, 0.28);
  }
`;

export const LoopspaceRuntimePanelAutoScroll = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0;
  border: 0;
  color: rgba(248, 250, 252, 0.68);
  background: transparent;
  cursor: pointer;
  font-size: 10.5px;
  font-weight: 760;
  letter-spacing: 0;

  &::after {
    content: "";
    display: block;
    width: 30px;
    height: 16px;
    border: 1px solid rgba(255, 209, 102, 0.16);
    border-radius: 999px;
    background:
      radial-gradient(circle at calc(100% - 8px) 50%, #fff 0 5px, transparent 5.5px),
      rgba(255, 209, 102, 0.22);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.34);
    transition: background 0.14s ease, border-color 0.14s ease;
  }

  &[data-enabled="false"]::after {
    border-color: rgba(148, 163, 184, 0.18);
    background:
      radial-gradient(circle at 8px 50%, rgba(248, 250, 252, 0.72) 0 5px, transparent 5.5px),
      rgba(148, 163, 184, 0.12);
  }

  &:hover,
  &:focus-visible {
    color: rgba(255, 246, 223, 0.92);
    outline: none;
  }
`;

export const LoopspaceRuntimePanelBody = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 209, 102, 0.28) transparent;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 209, 102, 0.26);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &[data-tab="nodes"] {
    overflow: hidden;
  }
`;

export const LoopspaceRuntimePanelEmpty = styled.div`
  display: grid;
  place-items: center;
  align-content: center;
  gap: 5px;
  min-height: 82px;
  color: rgba(248, 250, 252, 0.54);
  text-align: center;

  strong {
    color: rgba(248, 250, 252, 0.78);
    font-size: 12px;
    font-weight: 860;
  }

  span {
    max-width: 360px;
    font-size: 10.5px;
    font-weight: 680;
    line-height: 1.35;
  }
`;

export const LoopspaceRuntimePanelGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
  align-content: start;
  gap: 7px;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 7px 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 209, 102, 0.28) transparent;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 209, 102, 0.26);
  }
`;

export const LoopspaceRuntimePanelNodeCard = styled(LoopspaceGraphPaletteCard)`
  width: 100%;
  min-width: 0;
  height: 46px;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 9px;
  padding: 7px 9px;

  ${LoopspaceGraphPaletteIcon} {
    width: 28px;
    height: 28px;

    svg {
      width: 15px;
      height: 15px;
    }
  }

  ${LoopspaceGraphPaletteText} span {
    display: -webkit-box;
  }
`;

export const LoopspaceRuntimePanelSettingsList = styled.div`
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  min-height: var(--loopspace-settings-list-height, 0px);
  height: var(--loopspace-settings-list-height, auto);
  padding: 0;
`;

export const LoopspaceRuntimePanelSettingsMain = styled.div`
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
  min-height: 0;

  strong {
    min-width: 0;
    overflow: hidden;
    color: rgba(248, 250, 252, 0.92);
    font-size: 13px;
    font-weight: 880;
    line-height: 1.14;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    min-width: 0;
    overflow: hidden;
    color: rgba(248, 250, 252, 0.52);
    display: -webkit-box;
    font-size: 10.5px;
    font-weight: 720;
    line-height: 1.26;
    text-overflow: ellipsis;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
`;

export const LoopspaceRuntimePanelSettingsAction = styled.button`
  display: grid;
  justify-self: end;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--loop-settings-accent, 255, 209, 102), 0.22);
  border-radius: 7px;
  color: rgba(248, 250, 252, 0.72);
  background: rgba(2, 6, 8, 0.68);
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(var(--loop-settings-accent, 255, 209, 102), 0.54);
    color: #ffffff;
    background: rgba(var(--loop-settings-accent, 255, 209, 102), 0.16);
    box-shadow: 0 0 0 2px rgba(var(--loop-settings-accent, 255, 209, 102), 0.11);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
`;

export const LoopspaceRuntimePanelSettingsRow = styled.div`
  --loop-settings-accent: 148, 163, 184;
  position: absolute;
  top: var(--loopspace-settings-card-y, 8px);
  left: var(--loopspace-settings-card-x, 8px);
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 30px;
  align-items: start;
  gap: 11px;
  width: var(--loopspace-settings-card-width, 260px);
  height: var(--loopspace-settings-card-height, 161px);
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(var(--loop-settings-accent), 0.22);
  border-radius: 8px;
  color: #f8fafc;
  background:
    linear-gradient(135deg, rgba(var(--loop-settings-accent), 0.11), rgba(255, 255, 255, 0.025)),
    rgba(5, 8, 10, 0.78);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.018);
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;

  &[data-kind="manual"] { --loop-settings-accent: 251, 191, 36; }
  &[data-kind="cron"] { --loop-settings-accent: 96, 165, 250; }
  &[data-kind="webhook"] { --loop-settings-accent: 45, 212, 191; }
  &[data-kind="run_script"] { --loop-settings-accent: 251, 191, 36; }
  &[data-kind="document_read"],
  &[data-kind="document_write"] { --loop-settings-accent: 96, 165, 250; }
  &[data-kind="asset_read"],
  &[data-kind="asset_write"] { --loop-settings-accent: 45, 212, 191; }

  ${LoopspaceGraphPaletteIcon} {
    width: 40px;
    height: 40px;
    border-color: rgba(var(--loop-settings-accent), 0.28);
    color: rgba(248, 250, 252, 0.82);
    background: rgba(var(--loop-settings-accent), 0.12);

    svg {
      width: 20px;
      height: 20px;
    }
  }

  &:hover,
  &:focus-visible,
  &[data-active="true"] {
    outline: none;
    border-color: rgba(var(--loop-settings-accent), 0.48);
    background:
      linear-gradient(135deg, rgba(var(--loop-settings-accent), 0.16), rgba(255, 255, 255, 0.035)),
      rgba(7, 10, 12, 0.86);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.024),
      0 0 0 2px rgba(var(--loop-settings-accent), 0.08);
  }

  &[data-runtime]::after {
    position: absolute;
    top: 13px;
    right: 54px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: rgba(var(--loop-settings-accent), 0.9);
    box-shadow: 0 0 10px rgba(var(--loop-settings-accent), 0.32);
    content: "";
  }
`;

export const LoopspaceRuntimePanelSettingsInspector = styled.div`
  --loop-settings-accent: 148, 163, 184;
  --loop-node-accent: var(--loop-settings-accent);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 7px;
  min-width: 0;
  min-height: 0;
  padding: 7px 8px;
  overflow: hidden;

  &[data-kind="run_script"] {
    --loop-settings-accent: 251, 191, 36;
  }

  &[data-kind="document_read"],
  &[data-kind="document_write"] {
    --loop-settings-accent: 96, 165, 250;
  }

  &[data-kind="asset_read"],
  &[data-kind="asset_write"] {
    --loop-settings-accent: 45, 212, 191;
  }

  ${LoopspaceGraphMessageSettingsPanel} {
    height: 100%;
  }
`;

export const LoopspaceRuntimePanelSettingsHeader = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 30px;
`;

export const LoopspaceRuntimePanelEventList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
`;

export const LoopspaceRuntimePanelEventRow = styled.div`
  display: grid;
  grid-template-columns: minmax(86px, 0.32fr) minmax(118px, 0.52fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  width: 100%;
  min-height: 26px;
  padding: 4px 10px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.055);
  border-left: 2px solid rgba(148, 163, 184, 0.34);
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.012);
  cursor: default;
  text-align: left;

  &[data-clickable="true"] {
    cursor: pointer;
  }

  &[data-clickable="true"]:hover,
  &[data-clickable="true"]:focus-visible {
    outline: none;
    background: rgba(96, 165, 250, 0.08);
  }

  &[data-tone="good"] {
    border-left-color: rgba(74, 222, 128, 0.72);
  }

  &[data-tone="error"] {
    border-left-color: rgba(248, 113, 113, 0.72);
  }

  &[data-tone="active"] {
    border-left-color: rgba(96, 165, 250, 0.72);
  }

  &[data-tone="queued"] {
    border-left-color: rgba(250, 204, 21, 0.74);
  }

  &[data-tone="paused"] {
    border-left-color: rgba(192, 132, 252, 0.78);
  }

  &[data-selected="true"] {
    background: rgba(96, 165, 250, 0.1);
  }

  span,
  strong,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: rgba(248, 250, 252, 0.46);
    font-size: 9.5px;
    font-weight: 750;
  }

  strong {
    font-size: 10.5px;
    font-weight: 850;
  }

  em {
    color: rgba(248, 250, 252, 0.58);
    font-size: 9.5px;
    font-style: normal;
    font-weight: 700;
  }
`;

export const LoopspaceRuntimeConsole = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 100%;
  padding: 4px 0 8px;
  color: rgba(233, 238, 244, 0.9);
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.18), transparent 42px),
    #050608;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
`;

export const LoopspaceRuntimeConsoleLoader = styled.button`
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  min-height: 24px;
  width: 100%;
  border: 0;
  border-bottom: 1px solid rgba(255, 209, 102, 0.12);
  color: rgba(255, 246, 223, 0.58);
  background: rgba(5, 6, 8, 0.94);
  backdrop-filter: blur(10px);
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  font-weight: 760;

  &:hover,
  &:focus-visible {
    color: rgba(255, 231, 161, 0.9);
    outline: none;
    background: rgba(24, 18, 7, 0.96);
  }

  &[data-loading="true"] {
    color: rgba(255, 231, 161, 0.82);
    cursor: wait;
  }
`;

export const LoopspaceRuntimeConsoleIcon = styled.span`
  position: relative;
  z-index: 1;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 999px;
  color: rgba(203, 213, 225, 0.9);
  background:
    linear-gradient(135deg, rgba(148, 163, 184, 0.12), rgba(255, 255, 255, 0.025)),
    #050608;
  box-shadow:
    0 0 0 3px rgba(5, 6, 8, 0.96),
    0 0 14px rgba(148, 163, 184, 0.12);

  svg {
    width: 13px;
    height: 13px;
  }

  &[data-icon="running"] {
    border-color: rgba(125, 211, 252, 0.62);
    color: rgba(186, 230, 253, 0.95);
    box-shadow:
      0 0 0 3px rgba(5, 6, 8, 0.96),
      0 0 16px rgba(125, 211, 252, 0.18);
  }

  &[data-icon="running"] svg {
    animation: loopspaceRuntimeTimelineSpin 820ms linear infinite;
  }

  &[data-icon="queued"] {
    border-color: rgba(250, 204, 21, 0.58);
    color: rgba(254, 240, 138, 0.96);
    background:
      linear-gradient(135deg, rgba(250, 204, 21, 0.14), rgba(255, 255, 255, 0.025)),
      #121006;
    box-shadow:
      0 0 0 3px rgba(5, 6, 8, 0.96),
      0 0 16px rgba(250, 204, 21, 0.14);
  }

  &[data-icon="completed"] {
    border-color: rgba(74, 222, 128, 0.58);
    color: rgba(187, 247, 208, 0.95);
    background:
      linear-gradient(135deg, rgba(74, 222, 128, 0.18), rgba(255, 255, 255, 0.025)),
      #06110c;
  }

  &[data-icon="failed"] {
    border-color: rgba(248, 113, 113, 0.64);
    color: rgba(254, 202, 202, 0.96);
    background:
      linear-gradient(135deg, rgba(248, 113, 113, 0.18), rgba(255, 255, 255, 0.025)),
      #150707;
  }

  &[data-icon="interrupted"] {
    border-color: rgba(192, 132, 252, 0.68);
    color: rgba(233, 213, 255, 0.96);
    background:
      linear-gradient(135deg, rgba(192, 132, 252, 0.18), rgba(255, 255, 255, 0.025)),
      #12091b;
  }

  @keyframes loopspaceRuntimeTimelineSpin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &[data-icon="running"] svg {
      animation: none;
    }
  }
`;

export const LoopspaceRuntimeConsoleRow = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: 22px 82px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 30px;
  padding: 3px 12px;
  color: rgba(233, 238, 244, 0.86);
  cursor: default;
  animation: loopspaceRuntimeConsoleLineIn 0.18s ease both;

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 22px;
    width: 2px;
    background: linear-gradient(180deg, rgba(148, 163, 184, 0.06), rgba(148, 163, 184, 0.24), rgba(148, 163, 184, 0.06));
    content: "";
  }

  &[data-clickable="true"] {
    cursor: pointer;
  }

  &[data-clickable="true"]:hover,
  &[data-clickable="true"]:focus-visible,
  &[data-selected="true"] {
    outline: none;
    background: rgba(96, 165, 250, 0.08);
  }

  &[data-tone="error"] {
    background: rgba(127, 29, 29, 0.12);
  }

  span,
  strong,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: rgba(148, 163, 184, 0.78);
    font-size: 10px;
    font-weight: 720;
  }

  em {
    color: rgba(233, 238, 244, 0.84);
    font-size: 10.5px;
    font-style: normal;
    font-weight: 700;
  }

  ${LoopspaceRuntimeConsoleIcon} {
    overflow: visible;
    white-space: normal;
  }

  @keyframes loopspaceRuntimeConsoleLineIn {
    from {
      opacity: 0;
      transform: translateY(5px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const LoopspaceRuntimeConsoleDetail = styled.pre`
  min-width: 0;
  max-height: 150px;
  overflow: auto;
  margin: 0 12px 4px 54px;
  border-left: 2px solid rgba(96, 165, 250, 0.34);
  padding: 6px 8px;
  color: rgba(203, 213, 225, 0.82);
  background: rgba(15, 23, 42, 0.62);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 9.5px;
  font-weight: 650;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
`;

export const LoopspaceRuntimePanelResumeButton = styled.button`
  justify-self: end;
  height: 20px;
  border: 1px solid rgba(255, 209, 102, 0.2);
  border-radius: 999px;
  padding: 0 8px;
  color: rgba(255, 246, 223, 0.78);
  background: rgba(255, 209, 102, 0.1);
  cursor: pointer;
  font-size: 9px;
  font-weight: 840;
  text-transform: uppercase;

  &:disabled {
    cursor: default;
    opacity: 0.42;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(255, 231, 161, 0.55);
    background: rgba(255, 209, 102, 0.18);
    outline: none;
  }
`;

export const LoopspaceRuntimeTimeline = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 0.382fr) minmax(320px, 0.618fr);
  min-width: 0;
  min-height: 100%;
  color: rgba(233, 238, 244, 0.9);
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.16), transparent 46px),
    #050608;

  @media (max-width: 820px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(120px, 1fr) auto;
  }
`;

export const LoopspaceRuntimeTimelineList = styled.div`
  display: grid;
  align-content: end;
  min-width: 0;
  min-height: 100%;
  padding: 8px 0;
  border-right: 1px solid rgba(255, 209, 102, 0.08);
  overflow: visible;

  @media (max-width: 820px) {
    border-right: 0;
    border-bottom: 1px solid rgba(255, 209, 102, 0.08);
  }
`;

export const LoopspaceRuntimeTimelineRow = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 38px;
  padding: 5px 10px 5px 12px;
  color: rgba(233, 238, 244, 0.88);
  cursor: pointer;
  animation: loopspaceRuntimeConsoleLineIn 0.18s ease both;

  &::before {
    position: absolute;
    top: -8px;
    bottom: -8px;
    left: 22px;
    width: 2px;
    background: linear-gradient(180deg, rgba(148, 163, 184, 0.04), rgba(148, 163, 184, 0.22), rgba(148, 163, 184, 0.04));
    content: "";
  }

  &:first-child::before {
    top: 50%;
  }

  &:last-child::before {
    bottom: 50%;
  }

  &:hover,
  &:focus-visible,
  &[data-selected="true"] {
    outline: none;
    background: rgba(96, 165, 250, 0.08);
  }

  &[data-tone="good"] {
    background: linear-gradient(90deg, rgba(34, 197, 94, 0.08), transparent 72%);
  }

  &[data-tone="error"] {
    background: linear-gradient(90deg, rgba(127, 29, 29, 0.14), transparent 72%);
  }

  &[data-tone="paused"] {
    background: linear-gradient(90deg, rgba(126, 34, 206, 0.12), transparent 72%);
  }

  ${LoopspaceRuntimeConsoleIcon} {
    overflow: visible;
    white-space: normal;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const LoopspaceRuntimeTimelineMain = styled.div`
  display: grid;
  align-content: center;
  gap: 3px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(248, 250, 252, 0.94);
    font-size: 12px;
    font-weight: 880;
    line-height: 1.1;
  }

  span {
    color: rgba(148, 163, 184, 0.82);
    font-size: 10px;
    font-weight: 720;
  }
`;

export const LoopspaceRuntimeTimelineMeta = styled.div`
  display: grid;
  justify-items: end;
  gap: 4px;
  min-width: 72px;

  > span {
    color: rgba(148, 163, 184, 0.74);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 9.5px;
    font-weight: 720;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    min-width: 0;

    > span {
      display: none;
    }
  }
`;

export const LoopspaceRuntimeStatusPill = styled.span`
  display: inline-flex;
  min-width: 0;
  max-width: 120px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.88);
  background: rgba(148, 163, 184, 0.1);
  font-size: 8.5px;
  font-weight: 900;
  letter-spacing: 0.02em;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;

  &[data-tone="active"] {
    border-color: rgba(125, 211, 252, 0.28);
    color: rgba(186, 230, 253, 0.96);
    background: rgba(14, 116, 144, 0.22);
  }

  &[data-tone="queued"] {
    border-color: rgba(250, 204, 21, 0.3);
    color: rgba(254, 240, 138, 0.96);
    background: rgba(133, 77, 14, 0.22);
  }

  &[data-tone="good"] {
    border-color: rgba(74, 222, 128, 0.28);
    color: rgba(187, 247, 208, 0.96);
    background: rgba(21, 128, 61, 0.22);
  }

  &[data-tone="error"] {
    border-color: rgba(248, 113, 113, 0.3);
    color: rgba(254, 202, 202, 0.96);
    background: rgba(127, 29, 29, 0.24);
  }

  &[data-tone="paused"] {
    border-color: rgba(192, 132, 252, 0.34);
    color: rgba(233, 213, 255, 0.98);
    background: rgba(88, 28, 135, 0.25);
  }
`;

export const LoopspaceRuntimeDetail = styled.aside`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  align-content: start;
  gap: 10px;
  min-width: 0;
  min-height: 100%;
  padding: 11px 12px;
  background:
    linear-gradient(135deg, rgba(255, 209, 102, 0.04), rgba(255, 255, 255, 0.012)),
    rgba(6, 8, 10, 0.84);
`;

export const LoopspaceRuntimeDetailHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;

  > div {
    display: grid;
    gap: 4px;
    min-width: 0;
    margin-right: auto;
  }

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    color: rgba(248, 250, 252, 0.95);
    font-size: 13px;
    font-weight: 900;
    line-height: 1.15;
    white-space: nowrap;
  }

  div > span {
    display: -webkit-box;
    color: rgba(203, 213, 225, 0.78);
    font-size: 10.5px;
    font-weight: 720;
    line-height: 1.35;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
`;

export const LoopspaceRuntimeDetailGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(84px, max-content) minmax(0, 1fr);
  gap: 5px 10px;
  min-width: 0;
  padding-top: 2px;

  span,
  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: rgba(148, 163, 184, 0.74);
    font-size: 9.5px;
    font-weight: 820;
    text-transform: uppercase;
  }

  strong {
    color: rgba(226, 232, 240, 0.9);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 10px;
    font-weight: 700;
  }
`;

export const LoopspaceRuntimeDetailMessage = styled.pre`
  min-width: 0;
  max-height: 76px;
  overflow: auto;
  margin: 0;
  border-left: 2px solid rgba(255, 209, 102, 0.3);
  padding: 6px 8px;
  color: rgba(203, 213, 225, 0.82);
  background: rgba(15, 23, 42, 0.38);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 9.5px;
  font-weight: 650;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
`;

export const LoopspaceGraphEmpty = styled.div`
  display: grid;
  justify-items: center;
  gap: 7px;
  max-width: 360px;
  padding: 18px 20px;
  border: 1px dashed rgba(255, 209, 102, 0.24);
  border-radius: 8px;
  color: rgba(248, 250, 252, 0.58);
  background: rgba(255, 255, 255, 0.025);
  text-align: center;
  font-size: 11px;
  font-weight: 760;
`;

export const LoopspaceLogsList = styled.div`
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  background: #000;
`;

export const LoopspaceLogRow = styled.div`
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left-color: rgba(255, 209, 102, 0.34);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
`;

export const LoopspaceLogIcon = styled.span`
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  color: #fff6df;
  background: rgba(255, 209, 102, 0.13);

  svg {
    width: 16px;
    height: 16px;
  }
`;

export const LoopspaceLogMain = styled.div`
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
    color: #f8fafc;
    font-size: 12px;
    font-weight: 820;
  }

  span {
    color: rgba(248, 250, 252, 0.54);
    font-size: 10px;
    font-weight: 720;
  }
`;

export const LoopspaceLogMeta = styled.span`
  justify-self: end;
  max-width: 150px;
  min-width: 0;
  overflow: hidden;
  border-radius: 999px;
  padding: 5px 8px;
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.13);
  font-size: 10px;
  font-weight: 820;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-tone="error"] {
    color: #fecaca;
    background: rgba(248, 113, 113, 0.13);
  }
`;

export const LoopspaceRuntimeError = styled.div`
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 266px;
  z-index: 8;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(255, 110, 110, 0.32);
  border-radius: 7px;
  color: #ffd4d4;
  background: rgba(64, 0, 0, 0.82);
  font-size: 12px;
  font-weight: 760;
`;

export const ForgeWorkspace = styled.section`
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

  html[data-forge-theme="light"] & {
    background: var(--forge-bg);
  }

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  &[data-surface="files"] {
    ${FILES_VSCODE_THEME_VARS}

    color: var(--files-vscode-text);
    background: var(--files-vscode-editor);
  }
`;

export const TerminalWorkspaceSurface = styled.section`
  --terminal-focus-outline-inset: 0px;

  position: relative;
  container-type: inline-size;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  background: ${TERMINAL_THEME_BACKGROUND};
  transition:
    filter 180ms ease,
    opacity 180ms ease,
    box-shadow 180ms ease;

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  &[data-terminal-breakout="true"] {
    border-radius: 0;
    overflow: hidden;
  }

  &[data-terminal-fullscreen="true"] {
    --terminal-focus-outline-inset: 1px;

    position: absolute;
    inset: 0;
    z-index: 220;
    width: auto;
    height: auto;
    min-width: 0;
    min-height: 0;
    background:
      linear-gradient(90deg, rgba(255, 255, 255, 0.024) 1px, transparent 1px),
      linear-gradient(180deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
      ${TERMINAL_THEME_BACKGROUND};
    background-size: 68px 68px, 68px 68px, auto;
    box-shadow:
      0 34px 90px rgba(0, 0, 0, 0.52),
      0 0 0 1px rgba(226, 232, 240, 0.08);
    pointer-events: auto;
    transform: translate3d(0, 0, 0) scale(1, 1);
    transform-origin: top left;
    will-change: transform, opacity;
  }

  html[data-forge-theme="light"] &[data-terminal-fullscreen="true"] {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
    box-shadow: none;
  }

  &[data-threads-view="true"][data-terminal-fullscreen="true"] {
    box-shadow: none;
  }

  &[data-terminal-fullscreen-state="opening"] {
    animation: ${terminalFullscreenEnter} var(--terminal-fullscreen-duration, 190ms) cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  &[data-terminal-fullscreen-state="closing"] {
    animation: ${terminalFullscreenExit} var(--terminal-fullscreen-duration, 190ms) cubic-bezier(0.7, 0, 0.84, 0) both;
    pointer-events: none;
  }

  &::after {
    position: absolute;
    inset: var(--terminal-focus-outline-inset);
    z-index: 120;
    box-sizing: border-box;
    opacity: 0;
    box-shadow: none;
    pointer-events: none;
    content: "";
    transition:
      opacity 140ms ease,
      box-shadow 140ms ease;
  }

  &[data-focused="true"]::after {
    opacity: 1;
    box-shadow:
      inset 0 0 0 2px rgba(132, 157, 190, 0.58),
      inset 0 0 0 1px rgba(226, 232, 240, 0.18),
      inset 0 0 14px rgba(132, 157, 190, 0.06),
      0 0 12px rgba(132, 157, 190, 0.14);
  }

  &[data-threads-view="true"]::after {
    opacity: 0;
    box-shadow: none;
  }
`;

export const WorkspaceTerminalPanels = styled.div`
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: ${TERMINAL_THEME_BACKGROUND};

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  ${TerminalWorkspaceSurface} {
    min-height: 0;
  }

  &[data-terminal-fullscreen="true"] {
    background: ${TERMINAL_THEME_BACKGROUND};
  }

  html[data-forge-theme="light"] &[data-terminal-fullscreen="true"] {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  &[data-terminal-dragging="true"],
  &[data-todo-dragging="true"] {
    overflow: visible;
    cursor: grabbing;
  }

  &[data-terminal-fullscreen="true"] [data-panel] {
    overflow: visible !important;
  }

  &[data-terminal-dragging="true"] [data-panel],
  &[data-todo-dragging="true"] [data-panel] {
    overflow: visible !important;
  }

  &[data-terminal-fullscreen="true"] ${TerminalWorkspaceSurface}:not([data-terminal-fullscreen="true"]) {
    opacity: 0.42;
    filter: brightness(0.58) saturate(0.75);
    pointer-events: none;
  }
`;

export const ResizePanelGroup = styled(Group)`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: ${TERMINAL_THEME_BACKGROUND};

  &[data-surface="files"] {
    background: var(--files-vscode-editor, #030405);
  }

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  html[data-forge-theme="light"] &[data-surface="files"] {
    background: var(--files-vscode-editor, #ffffff);
  }
`;

export const ResizePanel = styled(Panel)`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: ${TERMINAL_THEME_BACKGROUND};

  &[data-surface="files"] {
    background: var(--files-vscode-editor, #030405);
  }

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  html[data-forge-theme="light"] &[data-surface="files"] {
    background: var(--files-vscode-editor, #ffffff);
  }

  &[data-terminal-row="true"],
  &[data-terminal-leaf="true"] {
    min-height: ${TERMINAL_PANE_MIN_HEIGHT_PX}px;
  }

  &[data-terminal-column="true"],
  &[data-terminal-leaf="true"] {
    min-width: ${TERMINAL_PANE_MIN_WIDTH_PX}px;
  }

  ${WorkspaceTerminalPanels}[data-terminal-fullscreen="true"] & {
    overflow: visible;
  }
`;

export const ResizeHandle = styled(Separator)`
  position: relative;
  z-index: 48;
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.08);
  transition:
    background 140ms ease,
    box-shadow 140ms ease;

  &[data-direction="horizontal"] {
    width: 9px;
    margin: 0 -4px;
    cursor: col-resize;
  }

  &[data-direction="vertical"] {
    height: 9px;
    margin: -4px 0;
    cursor: row-resize;
  }

  ${WorkspaceTerminalPanels}[data-terminal-dragging="true"] &,
  ${WorkspaceTerminalPanels}[data-todo-dragging="true"] &,
  ${WorkspaceTerminalPanels}[data-terminal-fullscreen="true"] & {
    opacity: 0;
    pointer-events: none;
  }

  &::after {
    position: absolute;
    inset: 0;
    background: transparent;
    content: "";
  }

  &[data-direction="horizontal"]::after {
    left: 4px;
    right: 4px;
    background: rgba(255, 255, 255, 0.1);
  }

  &[data-direction="vertical"]::after {
    top: 4px;
    bottom: 4px;
    background: rgba(255, 255, 255, 0.1);
  }

  &:hover,
  &[data-resize-handle-state="drag"] {
    background: rgba(var(--forge-tint-rgb), 0.28);
    box-shadow: 0 0 16px rgba(var(--forge-tint-rgb), 0.18);
  }

  &[data-surface="files"] {
    background: transparent;
    box-shadow: none;
  }

  &[data-surface="files"][data-direction="horizontal"] {
    width: 7px;
    margin: 0 -3px;
  }

  &[data-surface="files"]::after {
    background: transparent;
  }

  &[data-surface="files"][data-direction="horizontal"]::after {
    left: 3px;
    right: auto;
    width: 1px;
    background: var(--files-vscode-border, #1d222b);
  }

  &[data-surface="files"]:hover,
  &[data-surface="files"][data-resize-handle-state="drag"] {
    background: transparent;
    box-shadow: none;
  }

  &[data-surface="files"]:hover::after,
  &[data-surface="files"][data-resize-handle-state="drag"]::after {
    background: var(--files-vscode-focus, #007fd4);
  }
`;

export const TerminalDevMetricsBar = styled.div`
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

export const TerminalDevMetric = styled.span`
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

export const TerminalFrame = styled.section`
  position: relative;
  z-index: 1;
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

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  &[data-terminal-breakout="true"] {
    border-radius: 0;
  }

  &[data-state="error"] {
    border-color: rgba(255, 107, 107, 0.36);
  }
`;

export const TerminalInlineUiView = styled.div`
  position: absolute;
  z-index: 42;
  inset: 0;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #141414;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  contain: layout paint style;
  transition:
    opacity 0ms linear,
    visibility 0s linear 0s;

  html[data-forge-theme="light"] & {
    background: #f5f5f7;
  }

  &[data-active="true"] {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity 120ms ease,
      visibility 0s linear 0s;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  > * {
    min-width: 0;
    min-height: 0;
  }
`;

export const TerminalParkedBar = styled.div`
  position: absolute;
  right: 12px;
  bottom: clamp(42px, 6vh, 72px);
  left: 12px;
  z-index: 85;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(251, 191, 36, 0.32);
  border-radius: 14px;
  padding: 9px 10px;
  background:
    linear-gradient(90deg, rgba(251, 191, 36, 0.16), rgba(56, 189, 248, 0.08)),
    rgba(4, 8, 16, 0.92);
  color: rgba(239, 246, 255, 0.94);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px);
`;

export const TerminalParkedSpinner = styled.span`
  position: relative;
  display: inline-flex;
  width: 26px;
  height: 26px;
  overflow: hidden;
  border: 1px solid rgba(251, 191, 36, 0.36);
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.08);

  &::before {
    position: absolute;
    inset: 3px;
    border-radius: inherit;
    background:
      conic-gradient(from 0deg, rgba(251, 191, 36, 0), rgba(251, 191, 36, 0.95), rgba(56, 189, 248, 0.45), rgba(251, 191, 36, 0));
    animation: ${loadingOrangeSweep} 980ms linear infinite;
    content: "";
  }

  &::after {
    position: absolute;
    inset: 8px;
    border-radius: inherit;
    background: rgba(4, 8, 16, 0.96);
    content: "";
  }
`;

export const TerminalParkedCopy = styled.div`
  min-width: 0;
  display: grid;
  gap: 3px;

  strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: rgba(203, 213, 225, 0.82);
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const TerminalParkedAgents = styled.span`
  display: inline-flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;
`;

export const TerminalParkedAgentBadge = styled.span`
  --terminal-slot-accent: rgba(148, 163, 184, 0.88);

  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  padding: 0;
  background: var(--terminal-slot-accent);
  color: transparent;
  font-size: 0;
  line-height: 0;
  box-shadow:
    inset 0 0 0 4px rgba(4, 8, 16, 0.9),
    0 0 14px var(--terminal-slot-accent);

  &[data-slot="0"] {
    --terminal-slot-accent: #ff9d48;
  }

  &[data-slot="1"] {
    --terminal-slot-accent: #3ccb7f;
  }

  &[data-slot="2"] {
    --terminal-slot-accent: #e5c45f;
  }

  &[data-slot="3"] {
    --terminal-slot-accent: #68d8d6;
  }

  &[data-slot="4"] {
    --terminal-slot-accent: #f46d8a;
  }

  &[data-slot="5"] {
    --terminal-slot-accent: #aac66d;
  }

  &[data-slot="6"] {
    --terminal-slot-accent: #d0d7e6;
  }

  &[data-slot="7"] {
    --terminal-slot-accent: #c084fc;
  }

  &[data-slot="8"] {
    --terminal-slot-accent: #ffbf66;
  }

  &[data-slot="9"] {
    --terminal-slot-accent: #7bdc9d;
  }

  &[data-slot="10"] {
    --terminal-slot-accent: #ff8a9c;
  }

  &[data-slot="11"] {
    --terminal-slot-accent: #56d0b6;
  }

  &[data-slot="12"] {
    --terminal-slot-accent: #d8b34d;
  }

  &[data-slot="13"] {
    --terminal-slot-accent: #9fb6d9;
  }

  &[data-slot="14"] {
    --terminal-slot-accent: #f0f4ff;
  }

  &[data-slot="15"] {
    --terminal-slot-accent: #f7a8ff;
  }
`;

export const TerminalParkedCancelButton = styled.button`
  border: 1px solid rgba(248, 113, 113, 0.34);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;

  &:hover {
    background: rgba(185, 28, 28, 0.42);
    color: #fff;
  }
`;

/*
Custom overlay xterm scrollbar styling, currently disabled while terminals use
the native/default scrollbar path:

  --terminal-scrollbar-opacity: 0;
  --terminal-scrollbar-pointer-events: none;

  &[data-scrollbar-platform="overlay"][data-scrolling="true"][data-scrollbar-overflow="true"] {
    --terminal-scrollbar-opacity: 1;
    --terminal-scrollbar-pointer-events: auto;
  }

  &[data-scrollbar-platform="overlay"] .xterm-viewport,
  &[data-resize-transient-scrollback="true"] .xterm-viewport {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  &[data-scrollbar-platform="overlay"] .xterm-viewport::-webkit-scrollbar,
  &[data-resize-transient-scrollback="true"] .xterm-viewport::-webkit-scrollbar {
    display: none;
    width: 0 !important;
    height: 0 !important;
  }

  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .scrollbar.vertical,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .scrollbar.vertical.visible,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .scrollbar.vertical.invisible,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-visible,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-invisible {
    right: 1px !important;
    width: 7px !important;
    background: transparent !important;
    opacity: var(--terminal-scrollbar-opacity) !important;
    pointer-events: var(--terminal-scrollbar-pointer-events) !important;
    transition: opacity 180ms ease !important;
    z-index: 80 !important;
  }

  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .scrollbar.vertical > .slider,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .scrollbar.vertical > .slider:hover,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .scrollbar.vertical > .slider.active,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider:hover,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider.active,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar > .slider,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar > .slider:hover,
  &[data-scrollbar-platform="overlay"] .xterm .xterm-scrollable-element > .xterm-scrollbar > .slider.active {
    left: 2px !important;
    width: 3px !important;
    border-radius: 999px !important;
    background: rgba(172, 185, 207, 0.34) !important;
  }
*/
export const XtermSurface = styled.div`
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  background: ${TERMINAL_THEME_BACKGROUND};
  contain: paint;
  isolation: isolate;
  --terminal-xterm-painted-bottom: 100%;
  --terminal-native-scrollbar-thumb: rgba(172, 185, 207, 0.34);
  --terminal-native-scrollbar-thumb-hover: rgba(192, 204, 224, 0.48);
  --terminal-native-scrollbar-thumb-active: rgba(210, 221, 238, 0.64);
  --terminal-native-scrollbar-glass-edge: rgba(255, 255, 255, 0.14);
  --terminal-native-scrollbar-glass-shade: rgba(7, 11, 18, 0.18);

  &[data-pty-reveal-ready="false"] {
    cursor: default;
  }

  &[data-pty-reveal-ready="false"]::before {
    content: "";
    position: absolute;
    z-index: 6;
    inset: 0;
    pointer-events: none;
    background: ${TERMINAL_THEME_BACKGROUND};
  }

  html[data-forge-theme="light"] &[data-pty-reveal-ready="false"]::before {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  &[data-pty-reveal-ready="false"] .xterm {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }

  &[data-terminal-breakout="true"] {
    --terminal-xterm-painted-bottom: 100% !important;

    contain: layout paint;
  }

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
    --terminal-native-scrollbar-thumb: rgba(0, 102, 204, 0.22);
    --terminal-native-scrollbar-thumb-hover: rgba(0, 102, 204, 0.32);
    --terminal-native-scrollbar-thumb-active: rgba(0, 102, 204, 0.42);
    --terminal-native-scrollbar-glass-edge: rgba(0, 102, 204, 0.08);
    --terminal-native-scrollbar-glass-shade: rgba(255, 255, 255, 0);
  }

  &::after {
    content: "";
    position: absolute;
    z-index: 2;
    top: var(--terminal-xterm-painted-bottom, 100%);
    right: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
    background: ${TERMINAL_THEME_BACKGROUND};
  }

  html[data-forge-theme="light"] &::after {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT};
  }

  &[data-terminal-breakout="true"]::after {
    display: none;
  }

  .xterm {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: ${TERMINAL_THEME_BACKGROUND} !important;
  }

  html[data-forge-theme="light"] & .xterm {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT} !important;
  }

  &[data-terminal-breakout="true"] .xterm,
  &[data-terminal-breakout="true"] .xterm-viewport,
  &[data-terminal-breakout="true"] .xterm-scroll-area,
  &[data-terminal-breakout="true"] .xterm-scrollable-element,
  &[data-terminal-breakout="true"] .xterm-screen {
    height: 100% !important;
    min-height: 100% !important;
  }

  .xterm-viewport,
  .xterm-scroll-area,
  .xterm-scrollable-element,
  .xterm-screen {
    background: ${TERMINAL_THEME_BACKGROUND} !important;
  }

  html[data-forge-theme="light"] & .xterm-viewport,
  html[data-forge-theme="light"] & .xterm-scroll-area,
  html[data-forge-theme="light"] & .xterm-scrollable-element,
  html[data-forge-theme="light"] & .xterm-screen {
    background: ${TERMINAL_THEME_BACKGROUND_LIGHT} !important;
  }

  .xterm-viewport {
    scrollbar-color: var(--terminal-native-scrollbar-thumb) transparent;
    scrollbar-width: thin;
  }

  .xterm-viewport::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .xterm-viewport::-webkit-scrollbar-track {
    background: transparent;
  }

  .xterm-viewport::-webkit-scrollbar-thumb {
    min-height: 42px;
    border: 2px solid transparent;
    border-radius: 999px;
    background:
      linear-gradient(
        180deg,
        var(--terminal-native-scrollbar-thumb-hover),
        var(--terminal-native-scrollbar-thumb)
      );
    background-clip: padding-box;
    box-shadow:
      inset 0 0 0 1px var(--terminal-native-scrollbar-glass-edge),
      inset 0 -6px 10px var(--terminal-native-scrollbar-glass-shade);
  }

  .xterm-viewport::-webkit-scrollbar-thumb:hover {
    background:
      linear-gradient(
        180deg,
        var(--terminal-native-scrollbar-thumb-active),
        var(--terminal-native-scrollbar-thumb-hover)
      );
    background-clip: padding-box;
  }

  .xterm-viewport::-webkit-scrollbar-thumb:active {
    background: var(--terminal-native-scrollbar-thumb-active);
    background-clip: padding-box;
  }

  .xterm .xterm-scrollable-element > .scrollbar.vertical,
  .xterm .xterm-scrollable-element > .scrollbar.vertical.visible,
  .xterm .xterm-scrollable-element > .scrollbar.vertical.invisible,
  .xterm .xterm-scrollable-element > .xterm-scrollbar,
  .xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-visible,
  .xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-invisible {
    right: 1px !important;
    width: 8px !important;
    background: transparent !important;
    z-index: 80 !important;
  }

  .xterm .xterm-scrollable-element > .scrollbar.vertical > .slider,
  .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider,
  .xterm .xterm-scrollable-element > .xterm-scrollbar > .slider {
    left: 2px !important;
    width: 4px !important;
    border-radius: 999px !important;
    background:
      linear-gradient(
        180deg,
        var(--terminal-native-scrollbar-thumb-hover),
        var(--terminal-native-scrollbar-thumb)
      ) !important;
    box-shadow:
      inset 0 0 0 1px var(--terminal-native-scrollbar-glass-edge),
      inset 0 -6px 10px var(--terminal-native-scrollbar-glass-shade) !important;
  }

  .xterm .xterm-scrollable-element > .scrollbar.vertical > .slider:hover,
  .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider:hover,
  .xterm .xterm-scrollable-element > .xterm-scrollbar > .slider:hover {
    background:
      linear-gradient(
        180deg,
        var(--terminal-native-scrollbar-thumb-active),
        var(--terminal-native-scrollbar-thumb-hover)
      ) !important;
  }

  .xterm .xterm-scrollable-element > .scrollbar.vertical > .slider.active,
  .xterm .xterm-scrollable-element > .xterm-scrollbar > .xterm-slider.active,
  .xterm .xterm-scrollable-element > .xterm-scrollbar > .slider.active {
    background: var(--terminal-native-scrollbar-thumb-active) !important;
  }

  &[data-active="false"] .xterm-cursor,
  &[data-active="false"] .xterm-cursor-layer,
  &[data-parked="true"] .xterm-cursor,
  &[data-parked="true"] .xterm-cursor-layer {
    display: none !important;
    opacity: 0 !important;
  }

  &[data-active="false"] .xterm-helper-textarea,
  &[data-parked="true"] .xterm-helper-textarea {
    pointer-events: none !important;
  }
`;

export const TerminalClosedSurface = styled.div`
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

  html[data-forge-theme="light"] & {
    background: var(--forge-light-dark-tile);
  }
`;

export const TerminalClosedLabel = styled.span`
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

export const TerminalStatusOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  padding: 24px;
  background: rgba(2, 3, 4, 0.5);
  pointer-events: none;
  user-select: none;

  > div {
    display: grid;
    max-width: min(300px, 100%);
    min-width: 0;
    justify-items: center;
    gap: 8px;
    border: 1px solid rgba(143, 157, 183, 0.22);
    border-radius: 8px;
    padding: 14px 16px;
    background: rgba(8, 12, 20, 0.86);
    color: rgba(232, 238, 248, 0.92);
    text-align: center;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
  }

  &[data-mode="compact"] {
    background: transparent;

    > div {
      max-width: none;
      gap: 0;
      border: 0;
      padding: 0;
      background: transparent;
      box-shadow: none;
    }
  }

  &[data-tone="error"] {
    background: rgba(18, 5, 8, 0.58);

    > div {
      border-color: rgba(248, 113, 113, 0.34);
      background: rgba(24, 10, 14, 0.88);
    }
  }

  &[data-copyable="true"] {
    pointer-events: auto;
  }

  &[data-copyable="true"] > div,
  &[data-copyable="true"] strong,
  &[data-copyable="true"] span {
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }
`;

export const TerminalStatusSpinner = styled.span`
  width: 20px;
  height: 20px;
  border: 2px solid rgba(143, 157, 183, 0.24);
  border-top-color: #4fd1c5;
  border-radius: 999px;
  animation: ${workspaceCloseSpin} 760ms linear infinite;

  ${TerminalStatusOverlay}[data-mode="compact"] & {
    width: 18px;
    height: 18px;
    border-color: rgba(143, 157, 183, 0.2);
    border-top-color: rgba(232, 238, 248, 0.86);
    filter: drop-shadow(0 0 10px rgba(2, 3, 4, 0.52));
  }
`;

export const TerminalStatusCopy = styled.div`
  display: grid;
  max-width: 100%;
  min-width: 0;
  gap: 4px;

  strong {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.1;
  }

  span {
    max-width: 100%;
    overflow-wrap: anywhere;
    color: rgba(154, 165, 181, 0.9);
    font-size: 11px;
    font-weight: 800;
    line-height: 1.25;
  }
`;

export const TerminalClosingOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  padding: 24px;
  background: rgba(2, 3, 4, 0.74);
  backdrop-filter: blur(3px);
  pointer-events: auto;

  > div {
    display: grid;
    max-width: min(260px, 100%);
    min-width: 0;
    justify-items: center;
    gap: 7px;
    border: 1px solid rgba(143, 157, 183, 0.24);
    border-radius: 8px;
    padding: 14px 16px;
    background: rgba(8, 12, 20, 0.82);
    color: rgba(232, 238, 248, 0.92);
    text-align: center;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
  }

  [data-spinner="true"] {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(143, 157, 183, 0.24);
    border-top-color: #ff9d48;
    border-radius: 999px;
    animation: ${workspaceCloseSpin} 760ms linear infinite;
  }

  strong {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.1;
  }

  span:not([data-spinner]) {
    max-width: 100%;
    overflow-wrap: anywhere;
    color: rgba(154, 165, 181, 0.9);
    font-size: 11px;
    font-weight: 800;
    line-height: 1.25;
  }
`;

export const TerminalRestartPill = styled.div`
  position: relative;
  z-index: 80;
  display: flex;
  width: 100%;
  max-width: none;
  min-height: 30px;
  height: auto;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  align-content: center;
  column-gap: 6px;
  row-gap: 1px;
  padding: 3px 8px;
  border: 0;
  border-bottom: 1px solid rgba(226, 232, 240, 0.08);
  border-radius: 0;
  background: #0b0e14;
  box-shadow: none;

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(24, 34, 48, 0.12);
    background: #eef1f5;
  }
`;

export const TerminalRailIdentity = styled.span`
  display: inline-flex;
  min-width: min-content;
  max-width: 100%;
  align-items: center;
  justify-content: flex-start;
  flex: 1 1 auto;
  gap: 4px;
`;

export const TerminalAgentLabel = styled.span`
  display: inline-block;
  min-width: 0;
  max-width: clamp(36px, 16cqi, 168px);
  overflow: hidden;
  color: rgba(226, 232, 240, 0.9);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1;
  pointer-events: none;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: rgba(48, 54, 68, 0.86);
  }
`;

export const TerminalRailControls = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  gap: 2px;

  &[data-rail-row="primary"] {
    order: 3;
  }

  &[data-rail-row="secondary"] {
    order: 2;
  }
`;

export const TerminalAgentDot = styled.span`
  --terminal-slot-accent: #ff9d48;

  display: inline-flex;
  width: 10px;
  height: 10px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 999px;
  color: transparent;
  background: var(--terminal-slot-accent);
  font-size: 0;
  line-height: 1;
  box-shadow: 0 0 10px var(--terminal-slot-accent);

  &[data-agent="codex"] {
    border-color: rgba(170, 203, 255, 0.46);
  }

  &[data-agent="claude"] {
    border-color: rgba(255, 199, 142, 0.5);
  }

  &[data-agent="opencode"] {
    border-color: rgba(155, 250, 211, 0.46);
  }

  &[data-agent="generic"] {
    border-color: rgba(220, 228, 239, 0.44);
  }

  &[data-slot="1"] {
    --terminal-slot-accent: #3ccb7f;
  }

  &[data-slot="2"] {
    --terminal-slot-accent: #e5c45f;
  }

  &[data-slot="3"] {
    --terminal-slot-accent: #68d8d6;
  }

  &[data-slot="4"] {
    --terminal-slot-accent: #f46d8a;
  }

  &[data-slot="5"] {
    --terminal-slot-accent: #aac66d;
  }

  &[data-slot="6"] {
    --terminal-slot-accent: #d0d7e6;
  }

  &[data-slot="7"] {
    --terminal-slot-accent: #c084fc;
  }

  &[data-slot="8"] {
    --terminal-slot-accent: #ffbf66;
  }

  &[data-slot="9"] {
    --terminal-slot-accent: #7bdc9d;
  }

  &[data-slot="10"] {
    --terminal-slot-accent: #ff8a9c;
  }

  &[data-slot="11"] {
    --terminal-slot-accent: #56d0b6;
  }

  &[data-slot="12"] {
    --terminal-slot-accent: #d8b34d;
  }

  &[data-slot="13"] {
    --terminal-slot-accent: #9fb6d9;
  }

  &[data-slot="14"] {
    --terminal-slot-accent: #f0f4ff;
  }

  &[data-slot="15"] {
    --terminal-slot-accent: #f7a8ff;
  }
`;

export const TerminalStateDebugBadge = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  min-width: max-content;
  max-width: none;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.82);
  background: rgba(15, 23, 42, 0.48);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1;
  pointer-events: none;
  text-overflow: ellipsis;
  text-transform: lowercase;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    border-color: rgba(99, 102, 118, 0.2);
    color: rgba(48, 54, 68, 0.82);
    background: rgba(255, 255, 255, 0.72);
  }
`;

export const TerminalRestartButton = styled.button`
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.82);
  background: transparent;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
  transition:
    color 160ms ease,
    opacity 160ms ease,
    transform 160ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    color: #fff;
    transform: translateY(-1px);
  }

  &:focus-visible {
    color: #fff;
    outline: none;
    filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.28));
  }

  &[data-active="true"]:not(:disabled) {
    color: #fff;
    background: rgba(255, 255, 255, 0.09);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.3;
    transform: none;
  }

  &[data-terminal-drag-handle="true"]:not(:disabled) {
    cursor: grab;
  }

  &[data-terminal-drag-handle="true"]:active:not(:disabled) {
    cursor: grabbing;
  }
`;

export const TerminalCloseButton = styled(TerminalRestartButton)`
  color: rgba(255, 255, 255, 0.58);

  &:hover:not(:disabled) {
    color: #fff;
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    color: var(--forge-text);
  }

  &:disabled {
    opacity: 0.28;
  }
`;

export const TerminalEmptyPanel = styled.section`
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

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

export const TerminalEmptyActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const TerminalEmptyCopy = styled.div`
  display: grid;
  gap: 6px;
  max-width: 620px;
`;

export const TerminalAgentList = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

export const TerminalAgentRow = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.72);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }

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

  html[data-forge-theme="light"] & strong {
    color: var(--forge-text);
  }

  html[data-forge-theme="light"] & span {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] &[data-tone="needsAuth"] {
    border-color: rgba(0, 102, 204, 0.22);
  }
`;

export const FilesWorkspaceSurface = styled.section`
  ${FILES_VSCODE_THEME_VARS}

  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--files-vscode-text);
  background: var(--files-vscode-editor);

  > [data-panel-group] {
    width: 100%;
    height: 100%;
    background: var(--files-vscode-editor);
  }
`;

export const FileExplorerPane = styled.aside`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 0;
  border-right: 1px solid var(--files-vscode-border);
  background: var(--files-vscode-sidebar);

  @media (max-width: 860px) {
    border-right: 0;
    border-bottom: 1px solid var(--files-vscode-border);
  }
`;

export const FileExplorerHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 35px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 20px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-sidebar);

  p {
    color: var(--files-vscode-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
  }
`;

export const FileExplorerActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
`;

export const FileIconButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: var(--files-vscode-text);
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
    background: var(--files-vscode-hover);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    color: var(--files-vscode-text);
  }

  &:focus-visible {
    outline: 1px solid var(--files-vscode-focus);
    outline-offset: -1px;
  }

  &:disabled {
    opacity: 0.54;
  }
`;

export const FileRootPath = styled.p`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0 12px 6px 20px;
  border-bottom: 1px solid var(--files-vscode-border-subtle);
  color: var(--files-vscode-text-muted);
  background: var(--files-vscode-sidebar);
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

export const FileTree = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 10px;
  background: var(--files-vscode-sidebar);

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

export const FileTreeItem = styled.div`
  min-width: 0;
`;

export const FileTreeButton = styled.button`
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
  color: var(--files-vscode-text);
  background: transparent;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;

  &:hover {
    color: #ffffff;
    background: var(--files-vscode-hover);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--files-vscode-text);
  }

  &[data-selected="true"] {
    color: #ffffff;
    background: var(--files-vscode-selection);
  }

  &[data-drop-target="true"] {
    color: #ffffff;
    background: rgba(var(--forge-accent-rgb), 0.36);
    box-shadow:
      inset 0 0 0 1px rgba(var(--forge-accent-soft-rgb), 0.78),
      inset 3px 0 0 rgba(var(--forge-accent-soft-rgb), 0.96);
  }

  &:focus-visible {
    outline: 1px solid var(--files-vscode-focus);
    outline-offset: -1px;
  }
`;

export const FileRenameInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 18px;
  padding: 0 4px;
  border: 1px solid var(--files-vscode-focus);
  border-radius: 2px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-editor);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  outline: none;
`;

export const FileContextMenu = styled.div`
  position: absolute;
  z-index: 2000;
  display: grid;
  min-width: 168px;
  padding: 4px 0;
  border: 1px solid var(--files-vscode-border);
  border-radius: 6px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-sidebar);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
  overflow: hidden;
`;

export const FileContextMenuItem = styled.button`
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 28px;
  padding: 0 12px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    background: var(--files-vscode-hover);
    outline: none;
  }

  &:disabled {
    cursor: default;
    opacity: 0.46;
  }

  &[data-danger="true"] {
    color: #fca5a5;
  }
`;

export const FileDisclosure = styled.span`
  display: grid;
  width: 16px;
  height: 22px;
  place-items: center;
  color: var(--files-vscode-text-muted);

  .codicon {
    font-size: 16px;
  }
`;

export const FileKindIcon = styled.span`
  display: grid;
  width: 16px;
  height: 22px;
  place-items: center;
  color: var(--files-vscode-text);

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

export const FileTreeName = styled.span`
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

export const FileGitStatusMark = styled.span`
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

export const FileTreeChildren = styled.div`
  min-width: 0;
`;

export const FileTreeMessage = styled.p`
  margin: 0;
  overflow: hidden;
  height: 22px;
  padding: 0 8px 0 ${({ $depth }) => 36 + ($depth || 0) * 12}px;
  color: var(--files-vscode-text-muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-tone="error"] {
    color: #ffb0b0;
  }
`;

export const FileTreeEmpty = styled.p`
  margin: 0;
  padding: 8px 20px;
  color: var(--files-vscode-text-muted);
  font-size: 12px;
  font-weight: 400;
`;

export const FilePreviewPane = styled.section`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--files-vscode-editor);
`;

export const FilePreviewHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 35px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px 0 0;
  border-bottom: 1px solid var(--files-vscode-border);
  background: var(--files-vscode-tab);
`;

export const FilePreviewTitle = styled.div`
  display: inline-flex;
  flex: 1 1 auto;
  min-width: 120px;
  max-width: none;
  min-height: 35px;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  border-right: 1px solid var(--files-vscode-border);
  color: var(--files-vscode-text);
  background: var(--files-vscode-tab-active);
  font-size: 13px;
  font-weight: 400;

  .codicon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: var(--files-vscode-text);
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

export const FilePreviewMeta = styled.div`
  display: inline-flex;
  flex: 0 1 auto;
  min-width: 0;
  align-items: center;
  gap: 6px;
`;

export const FilePreviewModeSwitch = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
  padding: 1px;
  border: 1px solid var(--files-vscode-border);
  border-radius: 4px;
  background: var(--files-vscode-editor);
`;

export const FilePreviewModeButton = styled.button`
  min-width: 44px;
  height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: 3px;
  color: var(--files-vscode-text-muted);
  background: transparent;
  font-size: 10px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--files-vscode-text);
    background: var(--files-vscode-tab);
  }

  &[data-active="true"] {
    color: #ffffff;
    background: var(--files-vscode-selection);
  }

  &:disabled {
    color: #5f5f5f;
    cursor: default;
  }
`;

export const FileGitStatusPill = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 2px 6px;
  border: 1px solid var(--files-vscode-border);
  border-radius: 3px;
  background: var(--files-vscode-tab);
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

export const FileMetaPill = styled.span`
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 1px solid var(--files-vscode-border);
  border-radius: 3px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-tab);
  font-size: 10px;
  font-weight: 500;
  line-height: 14px;
`;

export const FilePreviewPath = styled.p`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  padding: 4px 14px;
  border-bottom: 1px solid var(--files-vscode-border-subtle);
  color: var(--files-vscode-text-muted);
  background: var(--files-vscode-editor);
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

export const FileContentFrame = styled.section`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--files-vscode-editor);
`;

export const FilePreviewScroll = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: auto;
  background: var(--files-vscode-editor);

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

export const FileImagePreviewSurface = styled.div`
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  place-items: center;
  padding: 24px;
  background: var(--files-vscode-editor);
`;

export const FileImagePreviewImage = styled.img`
  display: block;
  max-width: min(100%, 1200px);
  max-height: calc(100vh - 170px);
  object-fit: contain;
  image-rendering: auto;
`;

export const HighlightedCodeBlock = styled.pre`
  min-width: max-content;
  min-height: 100%;
  margin: 0;
  padding: 14px 16px 28px;
  color: #d4d4d4;
  background: var(--files-vscode-editor);
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
  .token.attr-name,
  .token.parameter,
  .token.variable {
    color: #9cdcfe;
  }

  .token.tag,
  .token.selector,
  .token.keyword,
  .token.atrule {
    color: #569cd6;
  }

  .token.boolean,
  .token.number,
  .token.constant {
    color: #b5cea8;
  }

  .token.string,
  .token.char,
  .token.attr-value,
  .token.template-string {
    color: #ce9178;
  }

  .token.symbol,
  .token.builtin,
  .token.inserted {
    color: #4ec9b0;
  }

  .token.deleted {
    color: #f48771;
  }

  .token.operator,
  .token.entity,
  .token.url,
  .language-css .token.string,
  .style .token.string {
    color: #d4d4d4;
  }

  .token.function {
    color: #dcdcaa;
  }

  .token.class-name,
  .token.maybe-class-name {
    color: #4ec9b0;
  }

  .token.regex,
  .token.important {
    color: #d16969;
  }

  .token.title,
  .token.section {
    color: #569cd6;
    font-weight: 600;
  }

  .token.namespace {
    opacity: 0.78;
  }

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }

  html[data-forge-theme="light"] & .token.comment,
  html[data-forge-theme="light"] & .token.prolog,
  html[data-forge-theme="light"] & .token.doctype,
  html[data-forge-theme="light"] & .token.cdata {
    color: #6e6e73;
  }

  html[data-forge-theme="light"] & .token.punctuation,
  html[data-forge-theme="light"] & .token.operator,
  html[data-forge-theme="light"] & .token.entity,
  html[data-forge-theme="light"] & .token.url,
  html[data-forge-theme="light"] & .language-css .token.string,
  html[data-forge-theme="light"] & .style .token.string {
    color: #1d1d1f;
  }

  html[data-forge-theme="light"] & .token.property,
  html[data-forge-theme="light"] & .token.attr-name,
  html[data-forge-theme="light"] & .token.parameter,
  html[data-forge-theme="light"] & .token.variable,
  html[data-forge-theme="light"] & .token.function,
  html[data-forge-theme="light"] & .token.title,
  html[data-forge-theme="light"] & .token.section {
    color: #0066cc;
  }

  html[data-forge-theme="light"] & .token.tag,
  html[data-forge-theme="light"] & .token.selector,
  html[data-forge-theme="light"] & .token.keyword,
  html[data-forge-theme="light"] & .token.atrule {
    color: #7a3e9d;
  }

  html[data-forge-theme="light"] & .token.boolean,
  html[data-forge-theme="light"] & .token.number,
  html[data-forge-theme="light"] & .token.constant,
  html[data-forge-theme="light"] & .token.regex,
  html[data-forge-theme="light"] & .token.important {
    color: #8b5a00;
  }

  html[data-forge-theme="light"] & .token.string,
  html[data-forge-theme="light"] & .token.char,
  html[data-forge-theme="light"] & .token.attr-value,
  html[data-forge-theme="light"] & .token.template-string,
  html[data-forge-theme="light"] & .token.symbol,
  html[data-forge-theme="light"] & .token.builtin,
  html[data-forge-theme="light"] & .token.inserted {
    color: #0a7f45;
  }

  html[data-forge-theme="light"] & .token.deleted {
    color: #b42318;
  }
`;

export const InlineReviewSurface = styled.div`
  display: grid;
  position: relative;
  min-width: max-content;
  min-height: 100%;
  grid-template-columns: minmax(max-content, 1fr) 14px;
  align-items: start;
  background: var(--files-vscode-editor);
`;

export const InlineReviewCodeBlock = styled.div`
  min-width: max-content;
  min-height: 100%;
  margin: 0;
  padding: 8px 0 28px;
  color: #d4d4d4;
  background: var(--files-vscode-editor);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
  line-height: 1.5;
  tab-size: 2;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }
`;

export const InlineReviewLine = styled.div`
  display: grid;
  min-width: max-content;
  min-height: 19px;
  grid-template-columns: 54px 18px minmax(max-content, 1fr);
  align-items: stretch;
  color: #d4d4d4;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }

  &[data-tone="added"] {
    background: rgba(46, 160, 67, 0.18);
  }

  &[data-tone="removed"] {
    background: rgba(248, 81, 73, 0.16);
  }
`;

export const InlineReviewLineNumber = styled.span`
  padding: 0 9px 0 12px;
  color: #6e7681;
  font-size: 12px;
  text-align: right;
  user-select: none;

  ${InlineReviewLine}[data-tone="added"] & {
    color: #7ee787;
  }

  ${InlineReviewLine}[data-tone="removed"] & {
    color: #ff9b93;
  }
`;

export const InlineReviewPrefix = styled.span`
  color: #6e7681;
  user-select: none;

  ${InlineReviewLine}[data-tone="added"] & {
    color: #7ee787;
  }

  ${InlineReviewLine}[data-tone="removed"] & {
    color: #ff9b93;
  }
`;

export const InlineReviewCode = styled.span`
  min-width: max-content;
  padding: 0 28px 0 0;
  white-space: pre;

  ${InlineReviewLine}[data-tone="added"] & {
    color: #d8ffd8;
  }

  ${InlineReviewLine}[data-tone="removed"] & {
    color: #ffd0d0;
  }

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
  .token.attr-name,
  .token.parameter,
  .token.variable {
    color: #9cdcfe;
  }

  .token.tag,
  .token.selector,
  .token.keyword,
  .token.atrule {
    color: #569cd6;
  }

  .token.boolean,
  .token.number,
  .token.constant {
    color: #b5cea8;
  }

  .token.string,
  .token.char,
  .token.attr-value,
  .token.template-string {
    color: #ce9178;
  }

  .token.symbol,
  .token.builtin,
  .token.inserted {
    color: #4ec9b0;
  }

  .token.deleted {
    color: #f48771;
  }

  .token.operator,
  .token.entity,
  .token.url,
  .language-css .token.string,
  .style .token.string {
    color: #d4d4d4;
  }

  .token.function {
    color: #dcdcaa;
  }

  .token.class-name,
  .token.maybe-class-name {
    color: #4ec9b0;
  }

  .token.regex,
  .token.important {
    color: #d16969;
  }

  .token.title,
  .token.section {
    color: #569cd6;
    font-weight: 600;
  }

  .token.namespace {
    opacity: 0.78;
  }
`;

export const ReviewChangeRuler = styled.div`
  position: sticky;
  top: 0;
  right: 0;
  z-index: 2;
  align-self: start;
  width: 14px;
  min-height: 80px;
  max-height: 100%;
  border-left: 1px solid var(--files-vscode-border-subtle);
  background: var(--files-vscode-editor-gutter);
  cursor: ns-resize;
  touch-action: none;
  user-select: none;

  &:hover {
    background: var(--files-vscode-hover);
  }
`;

export const ReviewChangeMarker = styled.span`
  position: absolute;
  left: 3px;
  right: 3px;
  height: 4px;
  border-radius: 999px;
  background: #7ee787;
  box-shadow: 0 0 0 1px rgba(126, 231, 135, 0.16);

  &[data-tone="removed"] {
    background: #ff7b72;
    box-shadow: 0 0 0 1px rgba(255, 123, 114, 0.16);
  }
`;

export const FileDiffPanel = styled.section`
  display: grid;
  min-width: 0;
  margin: 0;
  border-bottom: 1px solid var(--files-vscode-border-subtle);
  background: var(--files-vscode-editor-gutter);

  &[data-mode="diff"] {
    min-height: 100%;
    border-bottom: 0;
  }
`;

export const FileDiffHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--files-vscode-border-subtle);
  color: var(--files-vscode-text);
  background: var(--files-vscode-sidebar);
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

export const FileDiffBadge = styled.span`
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

export const FileDiffMessage = styled.p`
  margin: 0;
  padding: 10px 14px;
  color: var(--files-vscode-text-muted);
  font-size: 12px;
  line-height: 18px;

  &[data-tone="error"] {
    color: #ffb0b0;
  }
`;

export const DiffCodeBlock = styled.pre`
  min-width: max-content;
  margin: 0;
  overflow: visible;
  padding: 6px 0 8px;
  color: #d4d4d4;
  background: var(--files-vscode-editor);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.45;
  tab-size: 2;
  white-space: pre;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }

  &[data-mode="diff"] {
    min-height: 100%;
  }
`;

export const DiffLine = styled.div`
  min-height: 18px;
  padding: 0 14px;

  &[data-tone="added"] {
    color: #b5f1c0;
    background: rgba(46, 160, 67, 0.18);
  }

  html[data-forge-theme="light"] &[data-tone="added"] {
    color: #0a7f45;
    background: rgba(10, 127, 69, 0.08);
  }

  &[data-tone="removed"] {
    color: #ffd0d0;
    background: rgba(248, 81, 73, 0.16);
  }

  html[data-forge-theme="light"] &[data-tone="removed"] {
    color: #b42318;
    background: rgba(180, 35, 24, 0.07);
  }

  &[data-tone="hunk"] {
    color: #9cdcfe;
    background: rgba(47, 128, 255, 0.12);
  }

  html[data-forge-theme="light"] &[data-tone="hunk"] {
    color: #0066cc;
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-tone="header"],
  &[data-tone="meta"] {
    color: var(--files-vscode-text-muted);
  }
`;

export const FileEmptyState = styled.div`
  display: grid;
  width: min(420px, 100%);
  height: 100%;
  min-height: 100%;
  align-content: center;
  justify-items: center;
  gap: 10px;
  margin: 0 auto;
  padding: 22px;
  color: var(--files-vscode-text-muted);
  text-align: center;

  h2 {
    color: var(--files-vscode-text);
    font-size: 15px;
    font-weight: 500;
  }
`;

export const FileEmptyIcon = styled.span`
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid var(--files-vscode-border);
  border-radius: 4px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-sidebar);

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

export const VaultWorkspaceSurface = styled.section`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: auto;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(13, 17, 23, 0.18);
  background-size: 68px 68px, 68px 68px, auto;

  html[data-forge-theme="light"] & {
    background: var(--forge-bg);
  }

  &[data-layout="operational"] {
    place-items: stretch;
    align-content: start;
    justify-items: center;
    padding: 16px;
  }

  &[data-layout="blank"] {
    place-items: stretch;
    align-content: stretch;
    justify-items: stretch;
    overflow: hidden;
    padding: 0;
    background: #000000;
    background-size: auto;
  }

  html[data-forge-theme="light"] &[data-layout="blank"] {
    background: var(--forge-bg);
  }
`;

export const VaultPlaceholderPanel = styled.section`
  display: grid;
  width: min(640px, 100%);
  min-width: 0;
  gap: 16px;
  padding: 22px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.035), rgba(244, 247, 250, 0.012)),
    rgba(17, 22, 29, 0.92);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const VaultPlaceholderIcon = styled.span`
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid rgba(223, 165, 90, 0.32);
  border-radius: 8px;
  color: var(--forge-amber);
  background: rgba(223, 165, 90, 0.09);

  svg {
    width: 22px;
    height: 22px;
  }
`;

export const VaultStatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioWorkspaceSurface = styled(VaultWorkspaceSurface)`
  --audio-surface-bg:
    radial-gradient(circle at 78% 8%, rgba(var(--forge-tint-rgb), 0.09), transparent 18rem),
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(13, 17, 23, 0.18);
  --audio-surface-bg-size: auto, 68px 68px, 68px 68px, auto;
  --audio-border: rgba(125, 160, 205, 0.2);
  --audio-border-soft: rgba(125, 160, 205, 0.16);
  --audio-border-strong: rgba(125, 160, 205, 0.36);
  --audio-panel-bg: rgba(17, 22, 29, 0.86);
  --audio-panel-bg-soft: rgba(13, 17, 23, 0.58);
  --audio-panel-bg-muted: rgba(7, 9, 13, 0.42);
  --audio-control-bg: rgba(21, 27, 35, 0.78);
  --audio-control-bg-hover: rgba(24, 31, 42, 0.84);
  --audio-control-selected-bg: rgba(var(--forge-tint-rgb), 0.12);
  --audio-accent: var(--forge-tint);
  --audio-accent-soft: var(--forge-tint-soft);
  --audio-accent-rgb: var(--forge-tint-rgb);
  --audio-accent-soft-rgb: var(--forge-tint-soft-rgb);
  --audio-accent-text: #dceaff;
  --audio-focus-ring: rgba(var(--forge-tint-soft-rgb), 0.42);

  place-items: stretch;
  align-content: start;
  justify-items: stretch;
  gap: 10px;
  padding: 16px;
  background: var(--audio-surface-bg);
  background-size: var(--audio-surface-bg-size);

  html[data-forge-space="loopspaces"] & {
    --audio-surface-bg:
      radial-gradient(circle at 78% 8%, rgba(var(--forge-tint-rgb), 0.15), transparent 18rem),
      radial-gradient(circle at 28% 96%, rgba(var(--forge-tint-soft-rgb), 0.055), transparent 20rem),
      linear-gradient(90deg, rgba(var(--forge-tint-soft-rgb), 0.03) 1px, transparent 1px),
      linear-gradient(180deg, rgba(var(--forge-tint-soft-rgb), 0.022) 1px, transparent 1px),
      rgba(5, 4, 2, 0.96);
    --audio-surface-bg-size: auto, auto, 68px 68px, 68px 68px, auto;
    --audio-border: rgba(var(--forge-tint-soft-rgb), 0.16);
    --audio-border-soft: rgba(var(--forge-tint-soft-rgb), 0.11);
    --audio-border-strong: rgba(var(--forge-tint-soft-rgb), 0.32);
    --audio-panel-bg: rgba(14, 10, 5, 0.8);
    --audio-panel-bg-soft: rgba(13, 9, 4, 0.58);
    --audio-panel-bg-muted: rgba(8, 6, 3, 0.52);
    --audio-control-bg: rgba(15, 10, 4, 0.74);
    --audio-control-bg-hover: rgba(22, 15, 6, 0.86);
    --audio-control-selected-bg: rgba(var(--forge-tint-rgb), 0.14);
    --audio-accent-text: #ffe8a3;
    --audio-focus-ring: rgba(var(--forge-tint-soft-rgb), 0.42);
  }

  html[data-forge-theme="light"] & {
    --audio-surface-bg: var(--forge-bg);
    --audio-surface-bg-size: auto;
    --audio-border: var(--forge-border);
    --audio-border-soft: var(--forge-border);
    --audio-border-strong: rgba(var(--forge-tint-rgb), 0.22);
    --audio-panel-bg: var(--forge-surface);
    --audio-panel-bg-soft: var(--forge-surface-control);
    --audio-panel-bg-muted: var(--forge-surface);
    --audio-control-bg: var(--forge-surface);
    --audio-control-bg-hover: var(--forge-surface-control);
    --audio-control-selected-bg: rgba(var(--forge-tint-rgb), 0.09);
    --audio-accent-text: var(--forge-text);
    --audio-focus-ring: rgba(var(--forge-tint-rgb), 0.18);
  }

  html[data-forge-theme="light"][data-forge-space="loopspaces"] & {
    --audio-surface-bg:
      radial-gradient(circle at 78% 8%, rgba(var(--forge-tint-rgb), 0.08), transparent 18rem),
      #f5f5f7;
    --audio-surface-bg-size: auto, auto;
    --audio-border: rgba(var(--forge-tint-rgb), 0.16);
    --audio-border-soft: rgba(var(--forge-tint-rgb), 0.1);
    --audio-border-strong: rgba(var(--forge-tint-rgb), 0.26);
    --audio-panel-bg-soft: rgba(var(--forge-tint-rgb), 0.045);
    --audio-control-selected-bg: rgba(var(--forge-tint-rgb), 0.1);
  }
`;

export const AudioSetupPanel = styled.section`
  display: grid;
  width: min(1080px, 100%);
  align-self: start;
  justify-self: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--audio-border, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--audio-panel-bg, rgba(17, 22, 29, 0.86));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const AudioHeroRow = styled.div`
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--audio-border-soft, var(--forge-border));

  > div {
    min-width: 0;
  }

  h2 {
    margin-top: 2px;
    overflow: hidden;
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    margin-top: 3px;
    color: var(--forge-text-muted);
    font-size: 12px;
  }

  ${VaultPlaceholderIcon} {
    width: 36px;
    height: 36px;
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.24));
    color: var(--audio-accent-soft, var(--forge-blue-soft));
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.08);

    svg {
      width: 18px;
      height: 18px;
    }
  }

  html[data-forge-theme="light"] & ${VaultPlaceholderIcon} {
    border-color: rgba(0, 102, 204, 0.16);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.055);
  }

  @media (max-width: 680px) {
    grid-template-columns: 36px minmax(0, 1fr);

    > span:last-child {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
`;

export const AudioStatePill = styled.span`
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 0 8px;
  border: 1px solid rgba(223, 165, 90, 0.34);
  border-radius: 8px;
  color: var(--forge-amber);
  background: rgba(223, 165, 90, 0.09);
  font-size: 10px;
  font-weight: 760;
  text-transform: uppercase;

  &[data-installed="true"] {
    border-color: rgba(60, 203, 127, 0.34);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.09);
  }
`;

export const AudioStatusGrid = styled(VaultStatusGrid)`
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioGeneralToolbar = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  /* Panels take only the height their content needs; without this the grid
     stretches both panels to the tallest one and the options jump around
     when switching providers. */
  align-items: start;
  gap: 10px;
  min-width: 0;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

/* Stacks the short panels (provider, orchestrator) into one toolbar column
   so the tall recorder panel beside them never leaves a dead gap. */
export const AudioGeneralColumn = styled.div`
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
`;

/* Full-width option rows: the radio-list variant of AudioModeGrid for
   choices whose descriptions deserve the whole panel width. */
export const AudioModeList = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  min-width: 0;
`;

export const AudioLocalModelList = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

export const AudioLocalModelRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.42));

  &[data-selected="true"] {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.42));
    background: var(--audio-control-selected-bg, rgba(125, 160, 205, 0.1));
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    border-color: rgba(0, 102, 204, 0.22);
    background: rgba(0, 102, 204, 0.07);
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioLocalModelCopy = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > span {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 650;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioLocalModelMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
`;

export const AudioLocalModelPill = styled.span`
  display: inline-flex;
  min-height: 20px;
  align-items: center;
  padding: 0 7px;
  border: 1px solid var(--audio-border, rgba(125, 160, 205, 0.2));
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.06);
  font-size: 10px;
  font-weight: 760;
  white-space: nowrap;

  &[data-tone="ready"] {
    border-color: rgba(71, 178, 127, 0.28);
    color: #8ee0b5;
    background: rgba(71, 178, 127, 0.1);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[data-tone="ready"] {
    color: var(--forge-green);
    background: rgba(12, 132, 78, 0.07);
  }
`;

export const AudioLocalModelActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;

  button {
    min-height: 32px;
    min-width: 92px;
    padding: 0 10px;
  }

  @media (max-width: 520px) {
    justify-content: stretch;

    button {
      width: 100%;
    }
  }
`;

export const AudioProviderPanel = styled.section`
  display: grid;
  align-content: start;
  min-width: 0;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--audio-border, rgba(125, 160, 205, 0.2));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.024), rgba(244, 247, 250, 0.006)),
    var(--audio-panel-bg-soft, rgba(13, 17, 23, 0.55));

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }
`;

export const AudioRecorderPanel = styled(AudioProviderPanel)`
  align-content: space-between;
`;

export const AudioRecorderActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;

  > button {
    width: 100%;
    min-height: 40px;
    min-width: 0;
    justify-content: center;
    white-space: nowrap;
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioModeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
  gap: 6px;
  min-width: 0;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioModeButton = styled.button`
  display: grid;
  min-width: 0;
  min-height: 46px;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.38));
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;

  > svg {
    width: 30px;
    height: 30px;
    padding: 6px;
    border: 1px solid var(--audio-border-soft, rgba(125, 160, 205, 0.16));
    border-radius: 8px;
    justify-self: center;
    color: var(--forge-text-muted);
    background: var(--audio-control-bg, rgba(21, 27, 35, 0.7));
  }

  > span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Details wrap to a second line instead of truncating mid-word ("Appears
     while speaki..."); anything longer still clamps cleanly. */
  > span > span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 650;
    line-height: 1.3;
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text-soft);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.18);
    color: var(--forge-text);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] & > svg {
    border-color: var(--forge-border);
    color: var(--forge-text-muted);
    background: var(--forge-surface-control);
  }

  &[aria-pressed="true"] {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.62);
    color: var(--audio-accent-text, #dceaff);
    background:
      linear-gradient(180deg, rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.2), rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.08)),
      var(--audio-control-bg, rgba(21, 27, 35, 0.74));
    box-shadow:
      0 0 0 1px rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.18) inset,
      0 8px 22px rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.08);
  }

  &[aria-pressed="true"] > svg {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.42);
    color: var(--audio-accent-soft, #8bb9ff);
    background: rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.14);
  }

  html[data-forge-theme="light"] &[aria-pressed="true"] {
    border-color: rgba(0, 102, 204, 0.3);
    color: var(--forge-text);
    background: rgba(0, 102, 204, 0.09);
    box-shadow: none;
  }

  html[data-forge-theme="light"] &[aria-pressed="true"] > svg {
    border-color: rgba(0, 102, 204, 0.24);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

export const AudioCloudGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(190px, 1fr) minmax(150px, 0.55fr);
  gap: 10px;
  min-width: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioCloudField = styled.label`
  display: grid;
  min-width: 0;
  gap: 6px;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

export const AudioCloudInput = styled.input`
  min-width: 0;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(21, 27, 35, 0.78);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;

  &:focus {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.44);
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--forge-tint-rgb), 0.12);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-blue-soft);
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.14);
  }
`;

export const AudioDevicePanel = styled.section`
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--audio-border, rgba(125, 160, 205, 0.2));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.026), rgba(244, 247, 250, 0.01)),
    var(--audio-panel-bg-soft, rgba(13, 17, 23, 0.58));

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.88);
  }
`;

export const AudioDeviceHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const AudioDeviceControls = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(180px, 1fr) auto auto;
  gap: 8px;

  button {
    min-height: 36px;
  }

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioDeviceSelect = styled.select`
  min-width: 0;
  min-height: 36px;
  padding: 0 34px 0 10px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text);
  background-color: var(--audio-control-bg, rgba(21, 27, 35, 0.78));
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23b6c0cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"),
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.012));
  background-position: right 10px center, 0 0;
  background-repeat: no-repeat, repeat;
  background-size: 16px 16px, auto;
  color-scheme: dark;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  text-transform: none;
  appearance: none;
  -webkit-appearance: none;

  &::-ms-expand {
    display: none;
  }

  &:hover:not(:disabled) {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.32));
    background-color: var(--audio-control-bg-hover, rgba(24, 31, 42, 0.84));
  }

  &:focus {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.44));
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.12);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background-color: var(--forge-surface);
    background-image:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230066cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"),
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 252, 0.96));
    color-scheme: light;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(0, 102, 204, 0.22);
    background-color: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-blue-soft);
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.14);
  }

  option,
  optgroup {
    color: #f4f7fa;
    background: #0d1117;
  }

  html[data-forge-theme="light"] option,
  html[data-forge-theme="light"] optgroup {
    color: #1d1d1f;
    background: #ffffff;
  }

  &:disabled {
    color: var(--forge-text-muted);
    cursor: not-allowed;
    opacity: 0.72;
  }
`;

/* Borderless variant that sits flush inside the input-source capsule. */
export const AudioInputPillSelect = styled(AudioDeviceSelect)`
  min-height: 34px;
  border-color: transparent;
  background-color: transparent;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23b6c0cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-position: right 8px center;
  background-repeat: no-repeat;
  background-size: 16px 16px;

  &:hover:not(:disabled) {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.24));
    background-color: var(--audio-control-bg-hover, rgba(24, 31, 42, 0.6));
  }

  html[data-forge-theme="light"] & {
    border-color: transparent;
    background-color: transparent;
    background-image:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230066cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(0, 102, 204, 0.18);
    background-color: var(--forge-surface-control);
  }
`;

const audioInputBarFlow = keyframes`
  0%,
  100% {
    opacity: 0.72;
    transform: scaleY(var(--motion-low, 0.78)) translateY(1px);
  }

  38% {
    opacity: 1;
    transform: scaleY(var(--motion-high, 1.12)) translateY(-1px);
  }

  66% {
    opacity: 0.88;
    transform: scaleY(var(--motion-mid, 0.92)) translateY(0);
  }
`;

/* Capsule input-source row matching the recorder bar/bubble design: round
   mic toggle, borderless device select, inline level bars, icon refresh. */
export const AudioInputPill = styled.div`
  display: grid;
  min-width: 0;
  min-height: 52px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 7px 10px 7px 7px;
  border: 1px solid var(--audio-border, rgba(125, 160, 205, 0.22));
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.045), rgba(244, 247, 250, 0.008)),
    var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.62));
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.18);
  transition: border-color 180ms ease, box-shadow 180ms ease;

  &[data-live="true"] {
    border-color: rgba(75, 212, 170, 0.42);
    box-shadow:
      0 0 0 3px rgba(75, 212, 170, 0.08),
      0 10px 26px rgba(0, 0, 0, 0.22);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.05),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  html[data-forge-theme="light"] &[data-live="true"] {
    border-color: rgba(18, 170, 120, 0.4);
    box-shadow:
      0 0 0 3px rgba(18, 170, 120, 0.1),
      0 1px 2px rgba(0, 0, 0, 0.05);
  }

  @media (max-width: 620px) {
    grid-template-columns: auto minmax(0, 1fr) auto;

    > div[aria-hidden="true"] {
      display: none;
    }
  }
`;

export const AudioInputMicButton = styled.button`
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.4);
  border-radius: 50%;
  color: var(--audio-accent-soft, #8bb9ff);
  background:
    linear-gradient(180deg, rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.24), rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.1)),
    var(--audio-control-bg, rgba(21, 27, 35, 0.8));
  cursor: pointer;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 120ms ease;

  > svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    transform: scale(1.05);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  /* Live keeps the same mic logo, just a brighter blue — the red X swap
     read as alarming rather than active. */
  &[data-live="true"] {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.66);
    color: var(--audio-accent-text, #dceaff);
    background:
      linear-gradient(180deg, rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.36), rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.16)),
      var(--audio-control-bg, rgba(21, 27, 35, 0.8));
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.3);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  html[data-forge-theme="light"] &[data-live="true"] {
    border-color: rgba(0, 102, 204, 0.46);
    background: rgba(0, 102, 204, 0.16);
  }
`;

export const AudioInputHeaderControls = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
`;

/* Mute/enable toggle docked left of the input status badge: blue in both
   states, mic-off glyph while monitoring (press to mute), mic glyph while
   idle (press to enable). */
export const AudioInputMuteButton = styled.button`
  display: inline-grid;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.36);
  border-radius: 8px;
  color: var(--audio-accent-soft, #8bb9ff);
  background: rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.12);
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;

  > svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.55);
    background: rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.2);
  }

  &[data-active="true"] {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.62);
    color: var(--audio-accent-text, #dceaff);
    background: rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.28);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.3);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    border-color: rgba(0, 102, 204, 0.46);
    background: rgba(0, 102, 204, 0.16);
  }
`;

export const AudioInputPillIconButton = styled.button`
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;

  > svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    color: var(--forge-text);
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.08);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.06);
  }
`;

export const AudioInputMeter = styled.div`
  display: grid;
  width: 108px;
  height: 30px;
  flex: 0 0 auto;
  grid-template-columns: repeat(18, minmax(2px, 1fr));
  align-items: center;
  gap: 3px;
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.05);

  span {
    display: block;
    height: var(--height);
    min-height: 6px;
    border-radius: 999px;
    background: rgba(122, 132, 147, 0.42);
    transform: scaleY(0.86);
    transform-origin: center;
    transition:
      background 160ms ease,
      height 120ms ease,
      transform 160ms ease;
    will-change: height, transform;
  }

  &[data-active="true"] span {
    background:
      radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.9), transparent 56%),
      linear-gradient(
        180deg,
        hsl(var(--bar-hue, 190) 96% 78% / 0.96),
        rgba(75, 212, 170, 0.84) 54%,
        rgba(217, 121, 53, 0.74)
      );
    animation: ${audioInputBarFlow} var(--duration, 900ms) ease-in-out infinite;
    animation-delay: var(--delay, 0ms);
    box-shadow:
      0 0 10px rgba(75, 212, 170, 0.12),
      0 1px 0 rgba(255, 255, 255, 0.16) inset;
  }

  &[data-active="true"][data-signal="quiet"] span {
    opacity: 0.58;
    filter: saturate(0.52) brightness(0.84);
    box-shadow:
      0 0 7px rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.06),
      0 1px 0 rgba(255, 255, 255, 0.08) inset;
  }

  html[data-forge-theme="light"] & {
    background: rgba(0, 102, 204, 0.05);
  }

  html[data-forge-theme="light"] & span {
    background: rgba(74, 88, 107, 0.24);
  }

  html[data-forge-theme="light"] &[data-active="true"] span {
    background:
      radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.82), transparent 54%),
      linear-gradient(
        180deg,
        hsl(var(--bar-hue, 190) 94% 48% / 0.98),
        rgba(18, 170, 120, 0.9) 54%,
        rgba(221, 112, 31, 0.86)
      );
    box-shadow:
      0 0 10px hsl(var(--bar-hue, 190) 88% 46% / 0.18),
      0 0 14px rgba(18, 170, 120, 0.12),
      0 1px 0 rgba(255, 255, 255, 0.55) inset;
  }

  html[data-forge-theme="light"] &[data-active="true"][data-signal="quiet"] span {
    opacity: 0.66;
    filter: saturate(0.74) brightness(0.96);
    box-shadow:
      0 0 8px hsl(var(--bar-hue, 190) 82% 46% / 0.12),
      0 1px 0 rgba(255, 255, 255, 0.5) inset;
  }
`;

export const AudioInputMeta = styled.p`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AudioRecorderOptionRow = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;

  button {
    min-height: 34px;
  }
`;

export const AudioShortcutGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioShortcutCard = styled.div`
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.5));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  > span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  &[data-error="true"] {
    border-color: rgba(239, 107, 107, 0.34);
  }
`;

export const AudioShortcutKey = styled.kbd`
  display: block;
  min-width: 0;
  overflow: hidden;
  padding: 7px 9px;
  border: 1px solid var(--audio-border-strong, rgba(125, 160, 205, 0.24));
  border-radius: 8px;
  color: var(--forge-text);
  background: var(--audio-control-bg, rgba(21, 27, 35, 0.74));
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-capturing="true"] {
    border-color: rgba(223, 165, 90, 0.42);
    color: #ffd396;
    background: rgba(223, 165, 90, 0.09);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[data-capturing="true"] {
    border-color: rgba(0, 102, 204, 0.24);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

export const AudioShortcutActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-height: 32px;
  }
`;

export const AudioTabBar = styled.div`
  display: grid;
  width: min(1080px, 100%);
  justify-self: center;
  gap: 8px;
  min-width: 0;
  padding: 10px 10px 8px;
  border: 1px solid var(--audio-border, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.03), rgba(244, 247, 250, 0.008)),
    var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.72));

  ${AudioHeroRow} {
    padding-bottom: 0;
    border-bottom: 0;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const AudioTabList = styled.div`
  display: grid;
  width: 100%;
  grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));
  gap: 6px;
  min-width: 0;
  padding: 5px;
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.026), rgba(244, 247, 250, 0.006)),
    var(--audio-panel-bg-soft, rgba(17, 22, 29, 0.58));

  html[data-forge-theme="light"] & {
    background: rgba(0, 102, 204, 0.035);
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioTabButton = styled.button`
  min-width: 0;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 13px;
  font-weight: 800;
  text-align: center;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;

  &:hover {
    color: var(--forge-text-soft);
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.04);
  }

  &:focus-visible {
    outline: 2px solid var(--audio-focus-ring, rgba(125, 160, 205, 0.42));
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--forge-text);
    background: rgba(0, 102, 204, 0.06);
  }

  &[aria-selected="true"] {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.48);
    color: var(--audio-accent-text, #dceaff);
    background:
      linear-gradient(180deg, rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.2), rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.08)),
      var(--audio-control-bg, rgba(21, 27, 35, 0.78));
    box-shadow:
      0 0 0 1px rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.12) inset,
      0 8px 20px rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.08);
  }

  html[data-forge-theme="light"] &[aria-selected="true"] {
    border-color: rgba(0, 102, 204, 0.3);
    color: var(--forge-text);
    background: rgba(0, 102, 204, 0.09);
    box-shadow: none;
  }
`;

export const AudioTabPanel = styled.div`
  display: grid;
  min-width: 0;
  gap: 12px;
`;

export const AudioDictionaryPanel = styled.section`
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 260px;
  min-width: 0;
  padding: 0;
`;

export const AudioRulePanelHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  > button {
    width: 42px;
    min-height: 42px;
    flex: 0 0 42px;
    padding: 0;
  }
`;

export const AudioRulePanelTitle = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong {
    overflow: hidden;
    color: var(--forge-text);
    font-size: 15px;
    font-weight: 820;
    letter-spacing: 0;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioRuleListItem = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 58px;
  padding: 10px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.34));
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    opacity 140ms ease;

  &:hover {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.28));
    background: var(--audio-control-bg-hover, rgba(21, 27, 35, 0.52));
  }

  &:focus-visible {
    outline: 2px solid var(--audio-focus-ring, rgba(125, 160, 205, 0.42));
    outline-offset: 2px;
  }

  &[data-disabled="true"] {
    opacity: 0.62;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.035);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.18);
    background: var(--forge-surface-control);
  }

  @media (max-width: 640px) {
    grid-template-columns: auto minmax(0, 1fr);

    > div:last-child {
      grid-column: 2;
      justify-self: start;
    }
  }
`;

export const AudioRuleListText = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;
`;

export const AudioRuleListTitle = styled.strong`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 780;
  letter-spacing: 0;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AudioRuleListMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 620;
  letter-spacing: 0;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AudioRuleListActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  flex-wrap: wrap;
`;

export const AudioRuleEditorPanel = styled.form`
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
`;

export const AudioRuleEditorHeader = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;

  button {
    min-height: 38px;
    padding-inline: 12px;
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
`;

export const AudioRuleEditorTitle = styled.div`
  display: grid;
  min-width: 0;
  justify-items: center;
  gap: 2px;
  text-align: center;

  strong {
    max-width: 100%;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 15px;
    font-weight: 820;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 720;
    line-height: 1.2;
  }

  @media (max-width: 560px) {
    justify-items: start;
    text-align: left;
  }
`;

export const AudioRuleEditorBody = styled.div`
  display: grid;
  gap: 12px;
  min-width: 0;
`;

export const AudioRuleFieldLabel = styled.label`
  display: grid;
  gap: 7px;
  min-width: 0;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 780;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const AudioRuleFieldCaption = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0;
  line-height: 1.25;
  text-transform: none;
`;

export const AudioRuleStatusLine = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const AudioDictionarySummaryBar = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioDictionaryStat = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--audio-border-soft, rgba(125, 160, 205, 0.16));
  border-radius: 8px;
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.32));

  strong {
    overflow: hidden;
    color: var(--forge-text);
    font-size: 20px;
    font-weight: 780;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 720;
    letter-spacing: 0;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

export const AudioDictionaryComposer = styled.form`
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--audio-border-soft, rgba(125, 160, 205, 0.18));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.024), rgba(244, 247, 250, 0.008)),
    var(--audio-panel-bg-soft, rgba(13, 17, 23, 0.5));

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

export const AudioDictionaryComposerTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;

  > div {
    display: grid;
    min-width: min(100%, 190px);
    gap: 2px;
  }

  strong {
    overflow: hidden;
    color: var(--forge-text);
    font-size: 13px;
    font-weight: 780;
    letter-spacing: 0;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 12px;
    font-weight: 640;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    min-height: 34px;
    padding: 0 12px;
  }
`;

export const AudioDictionaryComposerGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(160px, 0.38fr) minmax(0, 1fr);
  gap: 8px;
  min-width: 0;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioDictionaryTextarea = styled.textarea`
  min-width: 0;
  min-height: 56px;
  padding: 9px 10px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text);
  background: var(--audio-control-bg, rgba(21, 27, 35, 0.72));
  font-size: 12px;
  font-weight: 650;
  font-family: inherit;
  line-height: 1.45;
  letter-spacing: 0;
  resize: vertical;

  &:focus {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.44));
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.12);
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-blue-soft);
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.14);
  }
`;

export const AudioDictionaryTermTools = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(160px, 0.8fr) auto minmax(160px, 1fr);
  align-items: center;
  gap: 8px;

  button {
    min-height: 36px;
    padding-inline: 12px;
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioDictionaryWordList = styled.div`
  display: flex;
  min-width: 0;
  max-height: min(360px, 42vh);
  flex-direction: column;
  gap: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 0 52px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background: rgba(2, 4, 8, 0.48);
  scroll-padding-bottom: 52px;

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

export const AudioDictionaryWordRow = styled.div`
  --audio-word-dot-center-x: 19px;
  --audio-word-row-padding-top: 6px;
  --audio-word-text-line-height: 17.4px;
  --audio-word-dot-center-y: calc(var(--audio-word-row-padding-top) + (var(--audio-word-text-line-height) / 2));
  --audio-word-dot-radius: 3px;
  --audio-word-dot-size: 6px;
  --audio-word-dot-color: var(--audio-accent-soft, #7db0ff);

  position: relative;
  display: grid;
  min-width: 0;
  min-height: 35px;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: start;
  gap: 0;
  padding: var(--audio-word-row-padding-top) 10px 6px 10px;
  color: #edf5ff;
  background: transparent;
  transition:
    background 140ms ease,
    color 140ms ease;

  &::before {
    content: "";
    width: var(--audio-word-dot-size);
    height: var(--audio-word-dot-size);
    margin-top: calc(var(--audio-word-dot-center-y) - var(--audio-word-row-padding-top) - var(--audio-word-dot-radius));
    margin-left: calc(var(--audio-word-dot-center-x) - 10px - var(--audio-word-dot-radius));
    justify-self: center;
    border-radius: 999px;
    background: var(--audio-word-dot-color);
    transition: opacity 130ms ease;
  }

  &:hover,
  &:focus-within {
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.07);
  }

  &:hover::before,
  &:focus-within::before {
    opacity: 0;
  }

  > button {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-2px);
  }

  &:hover > button,
  &:focus-within > button {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  html[data-forge-theme="light"] & {
    --audio-word-dot-color: var(--forge-blue);

    color: var(--forge-text);
  }

  html[data-forge-theme="light"] &:hover,
  html[data-forge-theme="light"] &:focus-within {
    background: rgba(0, 102, 204, 0.055);
  }
`;

export const AudioDictionaryWordText = styled.span`
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font: 12px/var(--audio-word-text-line-height) "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
  letter-spacing: 0;
  overflow-wrap: anywhere;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AudioDictionaryWordDeleteButton = styled.button`
  position: absolute;
  top: calc(var(--audio-word-dot-center-y) - 11px);
  left: calc(var(--audio-word-dot-center-x) - 11px);
  z-index: 3;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #ffd0d0;
  background: rgba(127, 29, 29, 0.18);
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    opacity 140ms ease,
    transform 140ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    border-color: rgba(239, 107, 107, 0.34);
    background: rgba(239, 107, 107, 0.16);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 210, 210, 0.5);
    outline-offset: 1px;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  html[data-forge-theme="light"] & {
    color: #b42318;
    background: rgba(180, 35, 24, 0.08);
  }
`;

export const AudioDictionaryWordEmpty = styled.div`
  display: grid;
  min-height: 96px;
  place-items: center;
  padding: 18px;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  text-align: center;
`;

export const AudioDictionaryListHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.3;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioDictionaryList = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
`;

export const AudioDictionaryCard = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.34);

  &[data-disabled="true"] {
    opacity: 0.64;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.035);
  }
`;

export const AudioDictionaryCardTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;

  input {
    flex: 1 1 160px;
  }
`;

export const AudioDictionaryTitleInput = styled.input`
  min-width: 0;
  min-height: 30px;
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--forge-text);
  background: transparent;
  font-size: 14px;
  font-weight: 760;
  letter-spacing: 0;

  &:focus {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.28));
    outline: none;
    background: var(--audio-control-bg, rgba(21, 27, 35, 0.42));
  }

  html[data-forge-theme="light"] &:focus {
    border-color: rgba(0, 102, 204, 0.18);
    background: var(--forge-surface-control);
  }
`;

export const AudioDictionaryMetaPill = styled.span`
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border: 1px solid var(--audio-border-soft, rgba(125, 160, 205, 0.16));
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.08);
  font-size: 11px;
  font-weight: 720;
  line-height: 1;
  white-space: nowrap;

  &[data-active="true"] {
    border-color: rgba(75, 212, 170, 0.24);
    color: var(--forge-green);
    background: rgba(75, 212, 170, 0.1);
  }

  &[data-active="false"] {
    opacity: 0.78;
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    border-color: rgba(26, 127, 55, 0.16);
    color: #1a7f37;
    background: rgba(26, 127, 55, 0.08);
  }
`;

export const AudioDictionaryEmpty = styled.div`
  display: grid;
  min-width: 0;
  min-height: 108px;
  place-items: center;
  gap: 4px;
  padding: 18px;
  border: 1px dashed var(--audio-border, rgba(125, 160, 205, 0.22));
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.22));
  text-align: center;

  strong {
    color: var(--forge-text);
    font-size: 13px;
    font-weight: 780;
    letter-spacing: 0;
  }

  span {
    max-width: 36ch;
    font-size: 12px;
    line-height: 1.45;
  }

  button {
    margin-top: 8px;
    min-height: 36px;
    padding-inline: 12px;
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

export const AudioRulesTabs = styled.div`
  display: inline-flex;
  gap: 4px;
  min-width: 0;
  padding: 3px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 999px;
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.5));
  justify-self: start;

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.04);
  }
`;

export const AudioRulesTab = styled.button`
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 11px;
  font-weight: 780;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease;

  &[aria-pressed="true"] {
    color: var(--forge-text);
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.18);
  }

  html[data-forge-theme="light"] &[aria-pressed="true"] {
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.1);
  }
`;

export const AudioRulesHint = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 12px;
  line-height: 1.45;
`;

export const AudioRulesList = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
`;

export const AudioRuleRow = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.5));

  &[data-disabled="true"] {
    opacity: 0.55;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.035),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }
`;

export const AudioRuleFields = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

export const AudioRuleFieldRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 6px;
  min-width: 0;

  &[data-single="true"] {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const AudioRuleTextarea = styled.textarea`
  min-width: 0;
  min-height: 56px;
  padding: 8px 10px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text);
  background: var(--audio-control-bg, rgba(21, 27, 35, 0.78));
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1.4;
  resize: vertical;

  &:focus {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.44));
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.12);
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-blue-soft);
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.14);
  }
`;

export const AudioRuleToggle = styled.button`
  display: inline-flex;
  width: 30px;
  min-height: 18px;
  align-self: center;
  align-items: center;
  padding: 2px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 999px;
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.12);
  cursor: pointer;
  transition: background 140ms ease;

  &::before {
    content: "";
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: var(--forge-text-muted);
    transition: transform 140ms ease, background 140ms ease;
  }

  &[aria-pressed="true"] {
    background: rgba(75, 212, 170, 0.22);
  }

  &[aria-pressed="true"]::before {
    transform: translateX(12px);
    background: var(--forge-green);
  }

  &:focus-visible {
    outline: 2px solid var(--audio-focus-ring, rgba(125, 160, 205, 0.42));
    outline-offset: 2px;
  }
`;

export const AudioRuleIconButton = styled.button`
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-self: center;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;
  transition: color 130ms ease, background 130ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    color: var(--forge-red, #ff6b6b);
    background: rgba(255, 107, 107, 0.1);
  }

  &:focus-visible {
    outline: 2px solid var(--audio-focus-ring, rgba(125, 160, 205, 0.42));
    outline-offset: 2px;
  }
`;

export const AudioRulesActionsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

export const AudioRulesPreview = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 10px;
  border: 1px dashed var(--forge-border);
  border-radius: 8px;

  > strong {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 780;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
`;

export const AudioRulesPreviewResult = styled.pre`
  margin: 0;
  min-width: 0;
  max-height: 140px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 7px;
  color: var(--forge-text-soft);
  background: rgba(7, 9, 13, 0.55);
  font-size: 12px;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    background: rgba(0, 0, 0, 0.045);
  }
`;

export const AudioHistoryPanel = styled.section`
  display: grid;
  gap: 12px;
  min-width: 0;
`;

export const AudioHistoryStats = styled.div`
  display: grid;
  grid-template-columns: minmax(168px, 0.8fr) minmax(0, 1.5fr) minmax(150px, 0.7fr);
  align-items: stretch;
  gap: 8px;
  min-width: 0;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

/* Shared stat-card surface for the history header (gauge, heatmap, totals). */
export const AudioInsightCard = styled.div`
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 4px;
  padding: 9px 12px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--audio-panel-bg-soft, rgba(13, 17, 23, 0.66));

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.035),
      inset 0 1px 0 rgba(255, 255, 255, 0.96);
  }

  /* Totals column reuses the existing chips, stacked borderless. */
  &[data-kind="totals"] {
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    gap: 8px;
    align-content: stretch;

    html[data-forge-theme="light"] & {
      background: transparent;
      box-shadow: none;
    }
  }
`;

export const AudioInsightCardTopline = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
`;

export const AudioInsightValue = styled.strong`
  color: var(--forge-text);
  font-size: 24px;
  font-weight: 850;
  line-height: 1;
`;

export const AudioInsightLabel = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
`;

export const AudioInsightSubValue = styled.span`
  overflow: hidden;
  color: var(--forge-text-soft);
  font-size: 12px;
  font-weight: 780;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/* Wispr-style half-circle gauge: a muted track arc with a blue progress arc
   drawn by stroke-dashoffset, plus an optional percentile badge ("TOP 10%")
   centered in the open space under the arc. */
export const AudioWpmGauge = styled.svg`
  width: min(124px, 100%);
  margin: 2px auto 0;

  path {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
  }

  .track {
    stroke: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.18);
  }

  .fill {
    stroke: var(--audio-accent-soft, #5f9cff);
    transition: stroke-dashoffset 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .tier {
    fill: var(--forge-text-soft);
    font-size: 8.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
  }

  html[data-forge-theme="light"] & .track {
    stroke: rgba(29, 29, 31, 0.1);
  }

  html[data-forge-theme="light"] & .fill {
    stroke: var(--forge-blue, #0066cc);
  }
`;

/* Contribution-style heatmap: one cell per day, columns are weeks. */
export const AudioHeatmapGrid = styled.div`
  display: flex;
  justify-content: flex-start;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
  margin-top: 2px;
`;

export const AudioHeatmapColumn = styled.div`
  display: grid;
  flex: 0 0 auto;
  grid-template-rows: repeat(7, 9px);
  gap: 3px;
`;

export const AudioHeatmapCell = styled.span`
  width: 9px;
  height: 9px;
  border-radius: 2.5px;
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.1);

  &[data-empty="true"] {
    background: transparent;
  }

  &[data-level="1"] {
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.28);
  }

  &[data-level="2"] {
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.48);
  }

  &[data-level="3"] {
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.7);
  }

  &[data-level="4"] {
    background: var(--audio-accent-soft, #5f9cff);
  }

  html[data-forge-theme="light"] & {
    background: rgba(29, 29, 31, 0.07);

    &[data-empty="true"] {
      background: transparent;
    }

    &[data-level="1"] {
      background: rgba(0, 102, 204, 0.22);
    }

    &[data-level="2"] {
      background: rgba(0, 102, 204, 0.42);
    }

    &[data-level="3"] {
      background: rgba(0, 102, 204, 0.66);
    }

    &[data-level="4"] {
      background: var(--forge-blue, #0066cc);
    }
  }
`;

export const AudioHistoryStatChip = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 8px 12px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--audio-panel-bg-soft, rgba(13, 17, 23, 0.66));

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.035),
      inset 0 1px 0 rgba(255, 255, 255, 0.96);
  }

  span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-soft);
    font-size: 16px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & strong {
    color: var(--forge-text);
  }

  html[data-forge-theme="light"] & span {
    color: var(--forge-text-muted);
  }
`;

export const audioHistoryRowEnter = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

export const audioHistoryRowSkeletonPulse = keyframes`
  0% {
    opacity: 0.32;
  }
  50% {
    opacity: 0.58;
  }
  100% {
    opacity: 0.32;
  }
`;

export const AudioHistoryVirtualList = styled.div`
  height: 420px;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 3px 3px 3px 0;
  border-radius: 8px;
  contain: layout paint style;

  html[data-forge-theme="light"] & {
    scrollbar-color: rgba(0, 102, 204, 0.26) rgba(245, 245, 247, 0.9);
  }
`;

export const AudioHistoryList = styled.div`
  position: relative;
  min-width: 0;
  width: 100%;
`;

export const AudioHistoryRow = styled.div`
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--audio-panel-bg-muted, rgba(7, 9, 13, 0.5));

  /* The row's translateY is its absolute position in the virtual list. It only
     changes when an item is inserted/removed above it or a measured height
     settles -- never during scroll -- so transitioning transform makes those
     shifts glide instead of snapping (the flicker), while staying cheap because
     transform is GPU-composited and never alters the box size (no re-measure). */
  will-change: transform;
  transition: transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1);

  /* Freshly added entries fade in. Opacity only: transform is reserved for the
     virtual positioning above and animating it here would fight that layout. */
  &[data-entering="true"] {
    animation: ${audioHistoryRowEnter} 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  /* Placeholder for a row whose backend page is still loading: a quiet pulsing
     card so the virtual list never blocks on IPC while scrolling a huge history. */
  &[data-skeleton="true"] {
    border-style: dashed;
    background: rgba(255, 255, 255, 0.03);
    animation: ${audioHistoryRowSkeletonPulse} 1.4s ease-in-out infinite;
    pointer-events: none;

    html[data-forge-theme="light"] & {
      background: rgba(15, 23, 42, 0.03);
      box-shadow: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    &[data-entering="true"] {
      animation: none;
    }

    &[data-skeleton="true"] {
      animation: none;
    }
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.04),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  /* Up to three lines per card; "Show more" lifts the clamp. The Copy
     button always carries the full transcript either way. */
  > strong {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-soft);
    font-size: 13px;
    font-weight: 720;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  &[data-expanded="true"] > strong {
    -webkit-line-clamp: unset;
  }

  html[data-forge-theme="light"] & > strong {
    color: var(--forge-text);
  }
`;

export const AudioHistorySnippetChanges = styled.div`
  display: grid;
  min-width: 0;
  gap: 4px;
  margin-top: 1px;
`;

export const AudioHistorySnippetChangeRow = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 7px;
  padding: 5px 7px;
  border-left: 2px solid rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.54);
  border-radius: 6px;
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.055);

  html[data-forge-theme="light"] & {
    border-left-color: rgba(0, 102, 204, 0.46);
    background: rgba(0, 102, 204, 0.045);
  }
`;

export const AudioHistorySnippetChangeBadge = styled.span`
  display: inline-flex;
  min-height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border: 1px solid rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.26);
  border-radius: 999px;
  color: var(--audio-accent-soft, var(--forge-blue-soft));
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.08);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.2);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.07);
  }
`;

export const AudioHistorySnippetChangeText = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(42px, 0.32fr) auto minmax(0, 1fr);
  align-items: baseline;
  gap: 6px;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 680;
  line-height: 1.35;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span:first-child {
    max-width: min(180px, 28vw);
    color: var(--forge-text-soft);
    font-weight: 780;
    white-space: nowrap;
  }

  span:last-child {
    display: -webkit-box;
    color: var(--forge-text-muted);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  small {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 760;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & span:first-child {
    color: var(--forge-text);
  }
`;

export const AudioHistoryRowFootline = styled.div`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
`;

export const AudioHistoryExpandButton = styled.button`
  flex: none;
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 10.5px;
  font-weight: 760;
  cursor: pointer;

  &:hover {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.4);
    color: var(--forge-text-soft);
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.08);
  }
`;

export const AudioHistoryRowTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  > span:first-child {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted);
    font-family:
      "Cascadia Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioHistoryRowActions = styled.div`
  display: inline-flex;
  min-width: max-content;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
`;

export const AudioHistoryProvider = styled.span`
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  padding: 0 7px;
  border: 1px solid var(--audio-border-strong, rgba(125, 160, 205, 0.28));
  border-radius: 999px;
  color: var(--audio-accent-soft, var(--forge-blue-soft));
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.08);
  font-size: 10px;
  font-weight: 780;
  text-transform: uppercase;
  white-space: nowrap;

  &[data-provider="cloud"] {
    border-color: rgba(75, 212, 170, 0.28);
    color: var(--forge-green);
    background: rgba(75, 212, 170, 0.08);
  }

  &[data-provider="forge"] {
    border-color: rgba(255, 159, 67, 0.32);
    color: var(--forge-orange, #ff9f43);
    background: rgba(255, 159, 67, 0.1);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.2);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.07);
  }

  html[data-forge-theme="light"] &[data-provider="cloud"] {
    border-color: rgba(10, 127, 69, 0.2);
    color: var(--forge-green);
    background: rgba(10, 127, 69, 0.07);
  }
`;

export const AudioHistoryStatusBadge = styled.span`
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  padding: 0 7px;
  border: 1px solid rgba(255, 159, 67, 0.32);
  border-radius: 999px;
  color: var(--forge-orange, #ff9f43);
  background: rgba(255, 159, 67, 0.1);
  font-size: 10px;
  font-weight: 780;
  text-transform: uppercase;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    border-color: rgba(193, 95, 0, 0.28);
    color: #b35a00;
    background: rgba(193, 95, 0, 0.08);
  }
`;

export const AudioHistoryVariantControl = styled.div`
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  gap: 2px;
  padding: 1px 3px;
  border: 1px solid var(--audio-border, rgba(125, 160, 205, 0.22));
  border-radius: 999px;
  background: var(--audio-control-bg, rgba(21, 27, 35, 0.58));

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.14);
    background: rgba(0, 102, 204, 0.045);
  }
`;

export const AudioHistoryVariantButton = styled.button`
  display: inline-grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: var(--forge-text);
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.14);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

export const AudioHistoryVariantLabel = styled.span`
  min-width: 52px;
  max-width: 148px;
  overflow: hidden;
  color: var(--forge-text-soft);
  font-size: 10px;
  font-weight: 820;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const AudioHistoryCopyButton = styled.button`
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid var(--audio-border, rgba(125, 160, 205, 0.22));
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--audio-control-bg, rgba(21, 27, 35, 0.64));
  font-size: 10px;
  font-weight: 780;
  line-height: 1;
  white-space: nowrap;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;

  svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
  }

  &:hover {
    border-color: var(--audio-border-strong, rgba(125, 160, 205, 0.36));
    color: var(--forge-text);
    background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.12);
  }

  &[data-copied="true"] {
    border-color: rgba(60, 203, 127, 0.3);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.09);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.14);
    color: var(--forge-text-soft);
    background: rgba(0, 102, 204, 0.045);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.24);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  html[data-forge-theme="light"] &[data-copied="true"] {
    border-color: rgba(10, 127, 69, 0.2);
    color: var(--forge-green);
    background: rgba(10, 127, 69, 0.07);
  }
`;

export const AudioHistoryMeta = styled.p`
  flex: 1 1 240px;
  margin: 0;
  min-width: 0;
  max-width: 100%;
  overflow: visible;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.35;
  white-space: normal;
  overflow-wrap: anywhere;
`;

export const AudioPathBlock = styled.div`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 7px 12px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--audio-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--audio-panel-bg-soft, rgba(13, 17, 23, 0.58));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioCodePath = styled.code`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-soft);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AudioRuntimeHint = styled.p`
  margin: 0;
  padding: 9px 10px;
  border: 1px solid rgba(223, 165, 90, 0.28);
  border-radius: 8px;
  color: #e5bd83;
  background: rgba(223, 165, 90, 0.08);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.45;
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    border-color: rgba(139, 90, 0, 0.2);
    color: var(--forge-amber);
    background: rgba(139, 90, 0, 0.07);
  }
`;

export const AudioProgressPanel = styled.div`
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--audio-border, rgba(125, 160, 205, 0.22));
  border-radius: 8px;
  background: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.07);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.16);
    background: rgba(0, 102, 204, 0.055);
  }
`;

export const AudioProgressTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--forge-text-soft);
  font-size: 12px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioProgressTrack = styled.div`
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(230, 236, 245, 0.08);

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.08);
  }
`;

export const AudioProgressBar = styled.div`
  width: ${({ $progress }) => `${Math.max(0, Math.min(100, $progress || 0))}%`};
  height: 100%;
  border-radius: inherit;
  background: var(--forge-blue);
  transition: width 180ms ease;
`;

export const AudioProgressMeta = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 650;
`;

export const AudioActionRow = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-height: 36px;
    min-width: 128px;
  }

  @media (max-width: 620px) {
    align-items: stretch;
    flex-direction: column;

    button {
      width: 100%;
    }
  }
`;

const audioWidgetSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const audioWidgetBarPulse = keyframes`
  0%,
  100% {
    opacity: 0.72;
    transform: scaleY(var(--scale-low, 0.18)) translateY(1px);
  }

  42% {
    opacity: 1;
    transform: scaleY(var(--scale-high, 0.78)) translateY(-1px);
  }

  70% {
    opacity: 0.88;
    transform: scaleY(var(--scale, 0.36)) translateY(0);
  }
`;

export const AudioWidgetShell = styled.main`
  display: grid;
  position: relative;
  isolation: isolate;
  width: 100vw;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  --audio-widget-compact-scale: 0.219178;
  --audio-widget-compact-clip-right: calc(100% - 64px);
  --audio-widget-shell-clip-right: 0px;
  --audio-widget-surface-scale-x: 1;
  --audio-widget-surface-top: 0px;
  --audio-widget-surface-right: 0px;
  --audio-widget-surface-bottom: 0px;
  --audio-widget-surface-left: 0px;
  --audio-widget-underpaint-opacity: 0;
  --audio-widget-surface-opacity: 0;
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  gap: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--forge-text);
  box-shadow: none;
  background: transparent;
  clip-path: inset(0 var(--audio-widget-shell-clip-right) 0 0 round 999px);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  transition:
    clip-path 190ms cubic-bezier(0.3, 0, 0.2, 1),
    box-shadow 160ms ease,
    opacity 180ms ease;
  contain: paint;
  cursor: grab;

  &[data-concealed="true"] {
    opacity: 0;
    pointer-events: none;
  }

  &[data-dragging="true"] {
    cursor: grabbing;
  }

  &[data-history-tray-frame="true"] {
    place-items: start center;
  }

  /* Error frame: the window grew upward to fit the error card, so the pill
     pins to the bottom 64px and keeps its shape. */
  &[data-error-frame="true"] {
    position: fixed;
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    height: 64px;
  }

  &::before,
  &::after {
    content: "";
    position: absolute;
    top: var(--audio-widget-surface-top);
    right: var(--audio-widget-surface-right);
    bottom: var(--audio-widget-surface-bottom);
    left: var(--audio-widget-surface-left);
    border-radius: inherit;
    transform: scaleX(var(--audio-widget-surface-scale-x));
    transform-origin: left center;
    pointer-events: none;
    transition:
      opacity 160ms ease,
      transform 190ms cubic-bezier(0.3, 0, 0.2, 1),
      top 190ms cubic-bezier(0.3, 0, 0.2, 1),
      right 190ms cubic-bezier(0.3, 0, 0.2, 1),
      bottom 190ms cubic-bezier(0.3, 0, 0.2, 1),
      left 190ms cubic-bezier(0.3, 0, 0.2, 1),
      background 160ms ease;
    will-change: opacity, transform, top, right, bottom, left;
  }

  &::before {
    z-index: 0;
    background: #020304;
    opacity: var(--audio-widget-underpaint-opacity);
  }

  html[data-forge-theme="light"] &::before,
  &[data-theme="light"]::before {
    background: #fbfbfd;
  }

  &::after {
    z-index: 1;
    border: 1px solid rgba(230, 236, 245, 0.13);
    background:
      radial-gradient(circle at 16% 0%, rgba(var(--forge-accent-soft-rgb), 0.13), transparent 34%),
      linear-gradient(180deg, rgba(37, 42, 49, 0.94), rgba(12, 15, 19, 0.96));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.07) inset,
      0 -18px 32px rgba(0, 0, 0, 0.18) inset;
    opacity: var(--audio-widget-surface-opacity);
  }

  html[data-forge-theme="light"] &::after,
  &[data-theme="light"]::after {
    border-color: rgba(0, 0, 0, 0.08);
    background:
      radial-gradient(circle at 16% 0%, rgba(var(--forge-accent-rgb), 0.1), transparent 36%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 247, 250, 0.97));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.96) inset,
      0 -16px 26px rgba(0, 0, 0, 0.035) inset;
  }

  &[data-focus="true"] {
    --audio-widget-underpaint-opacity: 1;
    --audio-widget-surface-opacity: 1;
    box-shadow:
      0 18px 44px rgba(0, 0, 0, 0.34);
  }

  &[data-theme="light"][data-focus="true"],
  html[data-forge-theme="light"] &[data-focus="true"] {
    box-shadow:
      0 16px 36px rgba(29, 29, 31, 0.14),
      0 2px 10px rgba(29, 29, 31, 0.08);
  }

  &[data-hover="true"]:not([data-dragging="true"]) {
    box-shadow:
      0 0 0 2px rgba(var(--forge-accent-soft-rgb), 0.42),
      0 0 24px rgba(var(--forge-accent-soft-rgb), 0.24),
      0 18px 44px rgba(0, 0, 0, 0.34);
  }

  &[data-theme="light"][data-hover="true"]:not([data-dragging="true"]),
  html[data-forge-theme="light"] &[data-hover="true"]:not([data-dragging="true"]) {
    box-shadow:
      0 0 0 2px rgba(var(--forge-accent-rgb), 0.34),
      0 0 22px rgba(var(--forge-accent-rgb), 0.16),
      0 16px 36px rgba(29, 29, 31, 0.14),
      0 2px 10px rgba(29, 29, 31, 0.08);
  }

  &[data-opening="true"] {
    --audio-widget-shell-clip-right: var(--audio-widget-compact-clip-right);
    --audio-widget-surface-scale-x: var(--audio-widget-compact-scale);
  }

  &[data-closing="true"] {
    --audio-widget-shell-clip-right: var(--audio-widget-compact-clip-right);
    --audio-widget-surface-top: 6px;
    --audio-widget-surface-right: calc(100% - 58px);
    --audio-widget-surface-bottom: 6px;
    --audio-widget-surface-left: 6px;
    --audio-widget-underpaint-opacity: 1;
    --audio-widget-surface-opacity: 1;
    box-shadow: none;
  }

  &[data-handoff="true"] {
    --audio-widget-shell-clip-right: var(--audio-widget-compact-clip-right);
    --audio-widget-surface-top: 6px;
    --audio-widget-surface-right: calc(100% - 58px);
    --audio-widget-surface-bottom: 6px;
    --audio-widget-surface-left: 6px;
    --audio-widget-underpaint-opacity: 0;
    --audio-widget-surface-opacity: 0;
    box-shadow: none;
    transition: none;
  }

  &[data-handoff="true"]::before,
  &[data-handoff="true"]::after {
    transition: none;
  }

  &[data-history-tray-frame="true"] {
    place-items: start center;
    overflow: visible;
    border-radius: 18px;
    clip-path: none;
  }
`;

// Small error card shown above the bubble widget while a dictation run
// fails (cloud stream errors included); the widget window grows upward to
// make room and the card auto-dismisses with the error state.
/* Anchored to the BOTTOM of the reserved error zone, hugging the bubble
   (3px gap): short one-line errors used to pin to the window top and float
   ~27px above the widget. Taller errors grow upward into the zone. */
export const AudioWidgetErrorPopover = styled.div`
  position: fixed;
  top: auto;
  bottom: 67px;
  left: 0;
  right: 0;
  z-index: 30;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  max-height: 54px;
  overflow: hidden;
  margin: 0 2px;
  padding: 8px 12px;
  border: 1px solid rgba(239, 107, 107, 0.42);
  border-radius: 12px;
  color: #ffd9d9;
  background: rgba(46, 14, 18, 0.96);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.35;
  pointer-events: none;
  word-break: break-word;

  &[data-theme="light"] {
    border-color: rgba(217, 72, 72, 0.45);
    color: #8c1d1d;
    background: rgba(255, 236, 236, 0.97);
  }
`;

export const AudioWidgetErrorOverlayShell = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 3px 3px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(6px);
  transition: opacity 150ms ease, transform 190ms cubic-bezier(0.3, 0, 0.2, 1);

  &[data-visible="true"] {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const AudioWidgetErrorOverlayCard = styled.div`
  display: -webkit-box;
  box-sizing: border-box;
  width: min(100%, 426px);
  max-height: 58px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  padding: 8px 12px;
  border: 1px solid rgba(239, 107, 107, 0.46);
  border-radius: 14px;
  color: #ffd9d9;
  background: rgba(46, 14, 18, 0.96);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 12px 24px rgba(0, 0, 0, 0.3);
  font-size: 10px;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
  pointer-events: none;
  animation: audioWidgetErrorOverlayIn 190ms cubic-bezier(0.3, 0, 0.2, 1) both;

  ${AudioWidgetErrorOverlayShell}[data-theme="light"] & {
    border-color: rgba(217, 72, 72, 0.45);
    color: #8c1d1d;
    background: rgba(255, 236, 236, 0.97);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.9) inset,
      0 10px 22px rgba(120, 20, 20, 0.14);
  }

  @keyframes audioWidgetErrorOverlayIn {
    from {
      opacity: 0;
      transform: translateY(7px) scale(0.98);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const AudioWidgetCancelButton = styled.button`
  position: absolute;
  z-index: 4;
  top: 6px;
  right: 8px;
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(230, 236, 245, 0.18);
  border-radius: 999px;
  color: rgba(230, 236, 245, 0.85);
  background: rgba(9, 11, 16, 0.82);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 130ms ease, background 130ms ease, color 130ms ease;
  -webkit-app-region: no-drag;

  ${AudioWidgetShell}:hover &,
  ${AudioWidgetShell}[data-hover="true"] & {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover {
    color: #fff;
    background: rgba(214, 69, 69, 0.92);
    border-color: rgba(255, 255, 255, 0.22);
  }

  ${AudioWidgetShell}[data-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.14);
    color: rgba(29, 29, 31, 0.78);
    background: rgba(255, 255, 255, 0.92);
  }

  ${AudioWidgetShell}[data-theme="light"] &:hover {
    color: #fff;
    background: rgba(214, 69, 69, 0.92);
  }
`;

export const AudioWidgetLockBadge = styled.span`
  position: absolute;
  z-index: 4;
  top: 7px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--forge-green, #4bd4aa);
  font-size: 9px;
  font-weight: 820;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  pointer-events: none;

  &::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
    animation: audioWidgetLockPulse 1.6s ease-in-out infinite;
  }

  @keyframes audioWidgetLockPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
`;

export const AudioBarShell = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding: 3px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity 170ms ease, transform 220ms cubic-bezier(0.3, 0, 0.2, 1);

  &[data-geometry-ready="false"] {
    visibility: hidden;
    pointer-events: none;
  }

  &[data-visible="true"] {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
`;

export const AudioBarSurface = styled.div`
  position: relative;
  display: flex;
  width: min(100%, 118px);
  height: min(100%, 38px);
  align-items: center;
  flex: none;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0 9px;
  border: 1px solid rgba(230, 236, 245, 0.14);
  border-radius: 999px;
  background:
    radial-gradient(circle at 16% 0%, rgba(var(--forge-accent-soft-rgb), 0.12), transparent 36%),
    linear-gradient(180deg, rgba(37, 42, 49, 0.96), rgba(12, 15, 19, 0.97));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.07) inset,
    0 12px 30px rgba(0, 0, 0, 0.38);

  ${AudioBarShell}[data-mode="notice"] & {
    width: min(100%, 386px);
    height: min(100%, 46px);
  }

  ${AudioBarShell}[data-mode="active"] & {
    transform-origin: bottom center;
    animation: audioBarSurfaceGrow 190ms cubic-bezier(0.3, 0, 0.2, 1) both;
  }

  ${AudioBarShell}[data-mode="error"] & {
    transform-origin: bottom center;
    animation: audioBarSurfaceGrow 190ms cubic-bezier(0.3, 0, 0.2, 1) both;
  }

  @keyframes audioBarSurfaceGrow {
    from {
      width: 64px;
      height: 5px;
      opacity: 0.92;
      transform: translateY(-3px);
    }

    to {
      width: min(100%, 118px);
      height: min(100%, 38px);
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    ${AudioBarShell}[data-mode="active"] &,
    ${AudioBarShell}[data-mode="error"] & {
      animation: none;
    }
  }

  ${AudioBarShell}[data-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.1);
    background:
      radial-gradient(circle at 16% 0%, rgba(var(--forge-accent-rgb), 0.08), transparent 36%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 247, 250, 0.97));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.96) inset,
      0 10px 26px rgba(29, 29, 31, 0.16);
  }
`;

export const AudioBarMeter = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  height: 20px;
  align-items: center;
  justify-content: center;
  gap: 2.5px;

  span {
    width: 2.5px;
    height: 100%;
    border-radius: 999px;
    background: hsl(var(--bar-hue, 204), 88%, 64%);
    transform-origin: center;
    transform: scaleY(var(--scale, 0.14));
    animation: audioBarPulse var(--duration, 900ms) ease-in-out var(--delay, 0ms) infinite alternate;
  }

  @keyframes audioBarPulse {
    from { transform: scaleY(var(--scale-low, 0.12)); }
    to { transform: scaleY(var(--scale-high, 0.5)); }
  }

  ${AudioBarShell}[data-theme="light"] & span {
    background: hsl(var(--bar-hue, 210), 80%, 46%);
  }
`;

/* Right-side finish control while recording: a small red round stop button,
   like Wispr Flow. While transcribing it is replaced by the spinner below —
   finishing is automatic, nothing to confirm. */
export const AudioBarStopButton = styled.button`
  position: relative;
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #ef5350;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12) inset;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease;

  &::after {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.96);
  }

  &:hover {
    transform: scale(1.08);
    background: #f26461;
  }
`;

export const AudioBarSpinner = styled.span`
  width: 16px;
  height: 16px;
  flex: none;
  border: 2px solid rgba(230, 236, 245, 0.22);
  border-top-color: var(--forge-orange, #ff9f43);
  border-radius: 50%;
  animation: audioBarSpin 760ms linear infinite;

  @keyframes audioBarSpin {
    to { transform: rotate(360deg); }
  }

  ${AudioBarShell}[data-theme="light"] & {
    border-color: rgba(29, 29, 31, 0.16);
    border-top-color: var(--forge-orange, #ff9f43);
  }
`;

export const AudioBarStatusText = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-soft, rgba(230, 236, 245, 0.86));
  font-size: 12px;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${AudioBarShell}[data-theme="light"] & {
    color: rgba(29, 29, 31, 0.85);
  }
`;

export const AudioBarUndoButton = styled.button`
  display: inline-flex;
  min-height: 24px;
  flex: none;
  align-items: center;
  padding: 0 12px;
  border: 1px solid rgba(255, 159, 67, 0.4);
  border-radius: 999px;
  color: var(--forge-orange, #ff9f43);
  background: rgba(255, 159, 67, 0.12);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease;

  &:hover {
    color: #160c02;
    background: var(--forge-orange, #ff9f43);
  }
`;

export const AudioBarCopyButton = styled.button`
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: rgba(230, 236, 245, 0.78);
  background: rgba(230, 236, 245, 0.12);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;

  & > svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    color: #0c0f13;
    background: rgba(230, 236, 245, 0.92);
  }

  ${AudioBarShell}[data-theme="light"] & {
    color: rgba(29, 29, 31, 0.7);
    background: rgba(29, 29, 31, 0.08);
  }

  ${AudioBarShell}[data-theme="light"] &:hover {
    color: #fff;
    background: rgba(29, 29, 31, 0.85);
  }
`;

export const AudioBarHistoryButton = styled.button`
  display: inline-flex;
  min-height: 24px;
  flex: none;
  align-items: center;
  padding: 0 12px;
  border: 1px solid rgba(230, 236, 245, 0.22);
  border-radius: 999px;
  color: var(--forge-text-soft, rgba(230, 236, 245, 0.86));
  background: rgba(230, 236, 245, 0.08);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease;

  &:hover {
    color: #0c0f13;
    background: rgba(230, 236, 245, 0.92);
  }

  ${AudioBarShell}[data-theme="light"] & {
    border-color: rgba(29, 29, 31, 0.18);
    color: rgba(29, 29, 31, 0.8);
    background: rgba(29, 29, 31, 0.06);
  }

  ${AudioBarShell}[data-theme="light"] &:hover {
    color: #fff;
    background: rgba(29, 29, 31, 0.85);
  }
`;

/* Drain bar for the cancel notice. Inset from the pill's rounded ends (the
   surface clips overflow, so a full-bleed bottom line would lose its edges
   to the corner radius and look like it never reaches 0). The short delay
   with fill-mode both holds it at 100% until the resized bar has painted. */
export const AudioBarNoticeProgress = styled.span`
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 4px;
  height: 3px;
  border-radius: 999px;
  background: var(--forge-orange, #ff9f43);
  transform-origin: left center;
  animation: audioBarNoticeDrain 3400ms linear 240ms both;

  @keyframes audioBarNoticeDrain {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }

  [data-paused="true"] & {
    animation-play-state: paused;
  }
`;

/* Idle bottom-bar (Wispr-style): a thin line hugs the bottom of the screen
   (the window is anchored to the monitor work area, so it sits just above
   the macOS Dock / Windows taskbar, or near the bare edge when there is
   none). Hovering the dock zone reveals one round record button with its
   shortcut hinted in orange centered above it. */
export const AudioBarIdleShell = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 6px;

  &[data-hover="true"] {
    cursor: pointer;
  }

  &[data-geometry-ready="false"] {
    visibility: hidden;
    pointer-events: none;
  }
`;

export const AudioBarIdleReveal = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 9px;
  opacity: 0;
  transform: translateY(8px) scale(0.9);
  pointer-events: none;
  transition: opacity 150ms ease, transform 180ms cubic-bezier(0.3, 0, 0.2, 1);

  ${AudioBarIdleShell}[data-hover="true"] & {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
`;

export const AudioBarRecordCluster = styled.div`
  position: relative;
  display: inline-grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
`;

export const AudioBarRecordButton = styled.button`
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--forge-border-strong);
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 18%, rgba(var(--forge-accent-soft-rgb), 0.14), transparent 55%),
    var(--forge-surface-control);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.32);
  cursor: pointer;
  transition: transform 130ms ease, border-color 130ms ease;

  &::after {
    content: "";
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #f25555;
    transition: transform 130ms ease;
  }

  &:hover {
    transform: scale(1.06);
    border-color: rgba(242, 85, 85, 0.55);
  }

  &:hover::after {
    transform: scale(1.12);
  }

  ${AudioBarIdleShell}[data-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.14);
    background:
      radial-gradient(circle at 30% 18%, rgba(var(--forge-accent-rgb), 0.08), transparent 55%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(247, 247, 250, 0.98));
    box-shadow: 0 10px 22px rgba(29, 29, 31, 0.2);
  }
`;

export const AudioHistoryQuickButton = styled.button`
  position: relative;
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(230, 236, 245, 0.16);
  border-radius: 999px;
  color: rgba(230, 236, 245, 0.78);
  background:
    radial-gradient(circle at 32% 18%, rgba(var(--forge-accent-soft-rgb), 0.12), transparent 54%),
    rgba(19, 23, 30, 0.88);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 10px 22px rgba(0, 0, 0, 0.26);
  cursor: pointer;
  transform: translateY(0) scale(1);
  transition:
    border-color 130ms ease,
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease,
    transform 130ms ease;
  user-select: none;
  -webkit-app-region: no-drag;
  -webkit-user-select: none;

  svg {
    width: 14px;
    height: 14px;
  }

  &[data-slot="previous"]::after {
    content: "2";
    position: absolute;
    right: 4px;
    bottom: 3px;
    display: grid;
    width: 10px;
    height: 10px;
    place-items: center;
    border-radius: 999px;
    color: rgba(5, 8, 12, 0.92);
    background: rgba(230, 236, 245, 0.9);
    font-size: 7px;
    font-weight: 900;
    line-height: 1;
  }

  &[data-copied="true"] {
    border-color: rgba(75, 212, 170, 0.48);
    color: #c8fff0;
    background: rgba(38, 152, 120, 0.28);
  }

  &[data-copied="true"]::after {
    opacity: 0;
  }

  &[data-polish-state="loading"] {
    border-color: rgba(255, 159, 67, 0.42);
    color: var(--forge-orange, #ff9f43);
    background: rgba(255, 159, 67, 0.14);
  }

  &[data-polish-state="loading"]:disabled {
    opacity: 1;
  }

  &[data-polish-state="success"] {
    border-color: rgba(75, 212, 170, 0.5);
    color: #c8fff0;
    background: rgba(38, 152, 120, 0.28);
  }

  &[data-polish-state="error"] {
    border-color: rgba(239, 107, 107, 0.52);
    color: #ffd9d9;
    background: rgba(148, 38, 47, 0.34);
  }

  &:hover:not(:disabled) {
    color: #ffffff;
    border-color: rgba(var(--forge-accent-soft-rgb), 0.38);
    background:
      radial-gradient(circle at 32% 18%, rgba(var(--forge-accent-soft-rgb), 0.2), transparent 58%),
      rgba(44, 55, 70, 0.94);
    transform: translateY(-1px) scale(1.04);
  }

  &:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }

  &:disabled {
    cursor: default;
    opacity: 0.36;
    transform: none;
  }

  &[data-polish-state="loading"]:disabled {
    opacity: 1;
  }

  html[data-audio-widget-theme="light"] &,
  ${AudioBarIdleShell}[data-theme="light"] &,
  ${AudioBarShell}[data-theme="light"] & {
    border-color: rgba(29, 29, 31, 0.11);
    color: rgba(29, 29, 31, 0.68);
    background:
      radial-gradient(circle at 32% 18%, rgba(var(--forge-accent-rgb), 0.08), transparent 55%),
      rgba(255, 255, 255, 0.96);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.9) inset,
      0 9px 18px rgba(29, 29, 31, 0.12);
  }

  html[data-audio-widget-theme="light"] &[data-slot="previous"]::after,
  ${AudioBarIdleShell}[data-theme="light"] &[data-slot="previous"]::after,
  ${AudioBarShell}[data-theme="light"] &[data-slot="previous"]::after {
    color: rgba(255, 255, 255, 0.96);
    background: rgba(29, 29, 31, 0.72);
  }

  html[data-audio-widget-theme="light"] &[data-copied="true"],
  ${AudioBarIdleShell}[data-theme="light"] &[data-copied="true"],
  ${AudioBarShell}[data-theme="light"] &[data-copied="true"] {
    border-color: rgba(22, 163, 74, 0.34);
    color: rgba(21, 128, 61, 0.95);
    background: rgba(220, 252, 231, 0.96);
  }

  html[data-audio-widget-theme="light"] &[data-polish-state="loading"],
  ${AudioBarIdleShell}[data-theme="light"] &[data-polish-state="loading"],
  ${AudioBarShell}[data-theme="light"] &[data-polish-state="loading"] {
    border-color: rgba(193, 95, 0, 0.3);
    color: #b35a00;
    background: rgba(255, 247, 237, 0.96);
  }

  html[data-audio-widget-theme="light"] &[data-polish-state="success"],
  ${AudioBarIdleShell}[data-theme="light"] &[data-polish-state="success"],
  ${AudioBarShell}[data-theme="light"] &[data-polish-state="success"] {
    border-color: rgba(22, 163, 74, 0.34);
    color: rgba(21, 128, 61, 0.95);
    background: rgba(220, 252, 231, 0.96);
  }

  html[data-audio-widget-theme="light"] &[data-polish-state="error"],
  ${AudioBarIdleShell}[data-theme="light"] &[data-polish-state="error"],
  ${AudioBarShell}[data-theme="light"] &[data-polish-state="error"] {
    border-color: rgba(220, 38, 38, 0.3);
    color: rgba(153, 27, 27, 0.96);
    background: rgba(254, 226, 226, 0.96);
  }

  html[data-audio-widget-theme="light"] &:hover:not(:disabled),
  ${AudioBarIdleShell}[data-theme="light"] &:hover:not(:disabled),
  ${AudioBarShell}[data-theme="light"] &:hover:not(:disabled) {
    color: var(--forge-accent);
    border-color: rgba(var(--forge-accent-rgb), 0.22);
    background:
      radial-gradient(circle at 32% 18%, rgba(var(--forge-accent-rgb), 0.14), transparent 58%),
      rgba(255, 255, 255, 0.99);
  }
`;

export const AudioPolishQuickSpinner = styled.span`
  width: 13px;
  height: 13px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 999px;
  opacity: 0.9;
  animation: audioPolishQuickSpin 720ms linear infinite;

  @keyframes audioPolishQuickSpin {
    to { transform: rotate(360deg); }
  }
`;

export const AudioBarHistoryActions = styled.div`
  display: inline-flex;
  width: 30px;
  flex: none;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateX(var(--audio-bar-action-offset, -6px)) scale(0.96);
  transition:
    opacity 150ms ease 45ms,
    transform 180ms cubic-bezier(0.3, 0, 0.2, 1) 45ms;
  -webkit-app-region: no-drag;

  &[data-side="left"] {
    --audio-bar-action-offset: 6px;
  }

  &[data-side="right"] {
    --audio-bar-action-offset: -6px;
  }

  ${AudioBarIdleShell}[data-hover="true"] & {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
`;

export const AudioBarShortcutHint = styled.span`
  position: absolute;
  /* Centered above the button: the idle widget window is only 200px wide
     with the button in the middle, so anything anchored off the button's
     right edge runs past the native window bounds and gets cut off. */
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--forge-orange, #ff9f43) 38%, transparent);
  border-radius: 999px;
  color: var(--forge-orange, #ff9f43);
  background: linear-gradient(
    180deg,
    rgba(28, 30, 36, 0.95),
    rgba(18, 20, 25, 0.92)
  );
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  line-height: 1.3;
  white-space: nowrap;

  ${AudioBarIdleShell}[data-theme="light"] & {
    border-color: color-mix(in srgb, var(--forge-orange, #ff9f43) 55%, transparent);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 247, 250, 0.96));
    box-shadow: 0 3px 10px rgba(29, 29, 31, 0.16);
  }
`;

export const AudioBarIdleLine = styled.span`
  width: 64px;
  height: 5px;
  flex: none;
  border: 1px solid rgba(230, 236, 245, 0.2);
  border-radius: 999px;
  background: rgba(230, 236, 245, 0.34);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: background 150ms ease, width 160ms cubic-bezier(0.3, 0, 0.2, 1);

  ${AudioBarIdleShell}[data-hover="true"] & {
    width: 78px;
    background: rgba(230, 236, 245, 0.55);
  }

  ${AudioBarIdleShell}[data-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.16);
    background: rgba(29, 29, 31, 0.32);
    box-shadow: 0 2px 8px rgba(29, 29, 31, 0.18);
  }

  ${AudioBarIdleShell}[data-theme="light"][data-hover="true"] & {
    background: rgba(29, 29, 31, 0.5);
  }
`;

export const AudioBarCancelButton = styled.button`
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: rgba(230, 236, 245, 0.78);
  background: rgba(230, 236, 245, 0.12);
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;

  &:hover {
    color: #fff;
    background: rgba(214, 69, 69, 0.94);
  }

  ${AudioBarShell}[data-theme="light"] & {
    color: rgba(29, 29, 31, 0.7);
    background: rgba(29, 29, 31, 0.08);
  }

  ${AudioBarShell}[data-theme="light"] &:hover {
    color: #fff;
    background: rgba(214, 69, 69, 0.94);
  }
`;

export const AudioWidgetFocusStage = styled.div`
  position: relative;
  z-index: 2;
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  border-radius: inherit;
  clip-path: inset(0 round 999px);
  opacity: 1;
  transform: translateX(0) scaleX(1);
  transform-origin: left center;
  transition:
    opacity 160ms ease,
    transform 190ms cubic-bezier(0.3, 0, 0.2, 1);

  &[data-mode="closing"] {
    opacity: 1;
    transform: translateX(0) scaleX(1);
  }

  ${AudioWidgetShell}[data-history-tray-frame="true"] & {
    width: 64px;
    height: 64px;
    border-radius: 999px;
  }
`;

export const AudioWidgetHistoryTray = styled.div`
  position: absolute;
  top: 58px;
  left: 50%;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  box-sizing: border-box;
  gap: 3px;
  padding: 3px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background:
    radial-gradient(circle at 28% 0%, rgba(var(--forge-accent-soft-rgb), 0.12), transparent 46%),
    rgba(7, 10, 14, 0.88);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 14px 28px rgba(0, 0, 0, 0.26);
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(-5px) scale(0.96);
  transform-origin: top center;
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.3, 0, 0.2, 1);
  -webkit-app-region: no-drag;

  ${AudioHistoryQuickButton} {
    width: 27px;
    height: 27px;
  }

  ${AudioHistoryQuickButton} svg {
    width: 13px;
    height: 13px;
  }

  ${AudioWidgetShell}[data-history-tray="true"] & {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(-50%) translateY(0) scale(1);
  }

  ${AudioWidgetShell}[data-dragging="true"] & {
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%) translateY(-5px) scale(0.96);
    transition: none;
  }

  html[data-audio-widget-theme="light"] & {
    border-color: rgba(29, 29, 31, 0.08);
    background:
      radial-gradient(circle at 28% 0%, rgba(var(--forge-accent-rgb), 0.08), transparent 48%),
      rgba(247, 248, 251, 0.94);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.92) inset,
      0 12px 24px rgba(29, 29, 31, 0.14);
  }
`;

export const AudioWidgetHeader = styled.header`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  place-items: center;
`;

export const AudioWidgetTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--forge-text);

  svg {
    width: 17px;
    height: 17px;
  }

  strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioWidgetLogo = styled.img.attrs({ draggable: false })`
  display: block;
  position: absolute;
  z-index: 2;
  top: 6px;
  left: 6px;
  width: 52px;
  height: 52px;
  flex: 0 0 auto;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  -webkit-touch-callout: none;
  border: 1px solid rgba(230, 236, 245, 0.14);
  border-radius: 999px;
  object-fit: cover;
  background:
    linear-gradient(180deg, rgba(36, 41, 48, 0.88), rgba(6, 8, 11, 0.9));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 -8px 16px rgba(0, 0, 0, 0.26) inset,
    0 8px 22px rgba(0, 0, 0, 0.24),
    0 0 0 4px rgba(244, 247, 250, 0.018);
  transform: scale(1);
  transform-origin: center;
  transition:
    box-shadow 180ms ease,
    transform 190ms cubic-bezier(0.3, 0, 0.2, 1),
    opacity 160ms ease;
  will-change: transform, opacity;

  &[data-size="focus"] {
    transform: scale(0.8077);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.08) inset,
      0 -8px 15px rgba(0, 0, 0, 0.24) inset,
      0 6px 16px rgba(0, 0, 0, 0.2);
  }

  html[data-forge-theme="light"] &,
  html[data-audio-widget-theme="light"] & {
    border-color: rgba(var(--forge-accent-rgb), 0.14);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 247, 250, 0.96));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.98) inset,
      0 -8px 16px rgba(0, 0, 0, 0.035) inset,
      0 8px 18px rgba(29, 29, 31, 0.12),
      0 0 0 4px rgba(var(--forge-accent-rgb), 0.035);
  }

  html[data-forge-theme="light"] &[data-size="focus"],
  html[data-audio-widget-theme="light"] &[data-size="focus"] {
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.98) inset,
      0 -8px 15px rgba(0, 0, 0, 0.03) inset,
      0 6px 14px rgba(29, 29, 31, 0.1);
  }

  ${AudioWidgetShell}[data-hover="true"]:not([data-dragging="true"]) & {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.48);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.12) inset,
      0 -8px 16px rgba(0, 0, 0, 0.24) inset,
      0 8px 22px rgba(0, 0, 0, 0.24),
      0 0 0 4px rgba(var(--forge-accent-soft-rgb), 0.13),
      0 0 22px rgba(var(--forge-accent-soft-rgb), 0.24);
    transform: scale(1.035);
  }

  ${AudioWidgetShell}[data-hover="true"]:not([data-dragging="true"]) &[data-size="focus"] {
    transform: scale(0.84);
  }

  html[data-forge-theme="light"] ${AudioWidgetShell}[data-hover="true"]:not([data-dragging="true"]) &,
  html[data-audio-widget-theme="light"] ${AudioWidgetShell}[data-hover="true"]:not([data-dragging="true"]) & {
    border-color: rgba(var(--forge-accent-rgb), 0.24);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.98) inset,
      0 -8px 16px rgba(0, 0, 0, 0.035) inset,
      0 8px 18px rgba(29, 29, 31, 0.12),
      0 0 0 4px rgba(var(--forge-accent-rgb), 0.09),
      0 0 20px rgba(var(--forge-accent-rgb), 0.14);
  }

  &[data-hidden="true"] {
    opacity: 0;
  }
`;

export const AudioWidgetMeter = styled.div`
  display: grid;
  height: 34px;
  min-width: 0;
  grid-template-columns: repeat(26, minmax(2px, 1fr));
  align-items: center;
  gap: 3px;
  padding: 6px 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 999px;
  background:
    linear-gradient(90deg, rgba(var(--forge-accent-soft-rgb), 0.05) 0 1px, transparent 1px 9px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
    rgba(9, 11, 14, 0.74);

  span {
    display: block;
    height: 100%;
    min-height: 0;
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(226, 232, 240, 0.95), rgba(125, 137, 152, 0.78));
    opacity: 0.78;
    transform: scaleY(var(--scale, 0.2));
    transform-origin: center;
    transition:
      background 160ms ease,
      opacity 160ms ease,
      transform 160ms ease;
    will-change: transform;
  }

  &[data-active="true"] span {
    background:
      radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.9), transparent 56%),
      linear-gradient(
        180deg,
        hsl(var(--bar-hue, 208) 98% 82% / 0.98),
        hsl(var(--bar-hue, 208) 92% 62% / 0.82) 54%,
        rgba(217, 121, 53, 0.78)
      );
  }

  /* Run the 26 bar animations only while actually recording/processing. The
     idle widget keeps the identical look but stays static, so it isn't driving
     26 infinite compositor animations (re-evaluated + recomposited every frame)
     the whole time it floats on screen. */
  &[data-active="true"][data-animate="true"] span {
    animation: ${audioWidgetBarPulse} var(--duration, 860ms) cubic-bezier(0.5, 0, 0.2, 1) infinite;
    animation-delay: var(--delay, 0ms);
  }

  &[data-active="true"][data-signal="quiet"] span {
    opacity: 0.62;
    filter: saturate(0.58) brightness(0.88);
    box-shadow:
      0 0 8px rgba(var(--forge-accent-soft-rgb), 0.08),
      0 1px 0 rgba(255, 255, 255, 0.1) inset;
  }

  &[data-prominent="true"] {
    position: absolute;
    z-index: 1;
    top: 13px;
    right: 9px;
    left: 62px;
    width: auto;
    height: 38px;
    min-width: 0;
    grid-template-columns: repeat(26, minmax(2px, 1fr));
    gap: 3px;
    padding: 7px 11px;
    border-color: rgba(230, 236, 245, 0.11);
    background:
      linear-gradient(90deg, rgba(var(--forge-accent-soft-rgb), 0.055) 0 1px, transparent 1px 9px),
      radial-gradient(circle at 18% 0%, rgba(var(--forge-accent-soft-rgb), 0.11), transparent 42%),
      linear-gradient(180deg, rgba(33, 38, 45, 0.78), rgba(9, 11, 14, 0.76));
    opacity: 0;
    transform: translateX(-10px) scaleX(0.82);
    transform-origin: left center;
    transition:
      opacity 120ms ease,
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 160ms ease,
      background 160ms ease;
  }

  &[data-prominent="true"] span {
    min-height: 6px;
    box-shadow:
      0 0 12px rgba(var(--forge-accent-soft-rgb), 0.16),
      0 0 18px rgba(217, 121, 53, 0.05),
      0 1px 0 rgba(255, 255, 255, 0.14) inset;
  }

  &[data-prominent="true"][data-ready="true"] {
    opacity: 1;
    transform: translateX(0) scaleX(1);
  }

  &[data-processing="true"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.18);
    background:
      linear-gradient(90deg, rgba(217, 121, 53, 0.055) 0 1px, transparent 1px 9px),
      radial-gradient(circle at 12% 0%, rgba(217, 121, 53, 0.12), transparent 40%),
      linear-gradient(180deg, rgba(34, 39, 46, 0.8), rgba(9, 11, 14, 0.78));
  }

  &[data-processing="true"] span {
    background:
      radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.86), transparent 56%),
      linear-gradient(
        180deg,
        rgba(242, 246, 252, 0.96),
        hsl(var(--bar-hue, 198) 92% 64% / 0.8) 52%,
        rgba(217, 121, 53, 0.72)
      );
  }

  html[data-forge-theme="light"] &,
  html[data-audio-widget-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.075);
    background:
      linear-gradient(90deg, rgba(var(--forge-accent-rgb), 0.055) 0 1px, transparent 1px 9px),
      linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(250, 250, 252, 0.9));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.9) inset,
      0 -8px 16px rgba(0, 0, 0, 0.025) inset;
  }

  html[data-forge-theme="light"] & span,
  html[data-audio-widget-theme="light"] & span {
    background:
      linear-gradient(180deg, rgba(95, 108, 130, 0.72), rgba(138, 149, 166, 0.46));
    opacity: 0.7;
  }

  html[data-forge-theme="light"] &[data-active="true"] span,
  html[data-audio-widget-theme="light"] &[data-active="true"] span {
    background:
      radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.86), transparent 54%),
      linear-gradient(
        180deg,
        hsl(var(--bar-hue, 208) 94% 48% / 0.98),
        hsl(var(--bar-hue, 208) 86% 42% / 0.86) 54%,
        rgba(221, 112, 31, 0.86)
      );
    box-shadow:
      0 0 9px hsl(var(--bar-hue, 208) 82% 46% / 0.16),
      0 1px 0 rgba(255, 255, 255, 0.58) inset;
  }

  html[data-forge-theme="light"] &[data-active="true"][data-signal="quiet"] span,
  html[data-audio-widget-theme="light"] &[data-active="true"][data-signal="quiet"] span {
    opacity: 0.66;
    filter: saturate(0.74) brightness(0.98);
    box-shadow:
      0 0 8px hsl(var(--bar-hue, 208) 78% 46% / 0.12),
      0 1px 0 rgba(255, 255, 255, 0.5) inset;
  }

  html[data-forge-theme="light"] &[data-prominent="true"],
  html[data-audio-widget-theme="light"] &[data-prominent="true"] {
    border-color: rgba(0, 0, 0, 0.075);
    background:
      linear-gradient(90deg, rgba(var(--forge-accent-rgb), 0.05) 0 1px, transparent 1px 9px),
      radial-gradient(circle at 18% 0%, rgba(var(--forge-accent-rgb), 0.08), transparent 42%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(246, 247, 250, 0.88));
  }

  html[data-forge-theme="light"] &[data-prominent="true"] span,
  html[data-audio-widget-theme="light"] &[data-prominent="true"] span {
    box-shadow:
      0 0 10px hsl(var(--bar-hue, 208) 80% 45% / 0.16),
      0 0 14px rgba(221, 112, 31, 0.06),
      0 1px 0 rgba(255, 255, 255, 0.58) inset;
  }

  html[data-forge-theme="light"] &[data-processing="true"],
  html[data-audio-widget-theme="light"] &[data-processing="true"] {
    border-color: rgba(var(--forge-accent-rgb), 0.13);
    background:
      linear-gradient(90deg, rgba(221, 112, 31, 0.045) 0 1px, transparent 1px 9px),
      radial-gradient(circle at 12% 0%, rgba(221, 112, 31, 0.08), transparent 40%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(246, 247, 250, 0.9));
  }

  html[data-forge-theme="light"] &[data-processing="true"] span,
  html[data-audio-widget-theme="light"] &[data-processing="true"] span {
    background:
      radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.84), transparent 54%),
      linear-gradient(
        180deg,
        hsl(var(--bar-hue, 198) 92% 46% / 0.98),
        hsl(var(--bar-hue, 198) 86% 42% / 0.82) 52%,
        rgba(221, 112, 31, 0.78)
      );
  }
`;

export const AudioWidgetLoader = styled.div`
  position: absolute;
  z-index: 3;
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  top: 11px;
  left: 11px;
  place-items: center;
  border: 1px solid rgba(230, 236, 245, 0.13);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(42, 48, 56, 0.88), rgba(9, 11, 14, 0.9));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.07) inset,
    0 8px 18px rgba(0, 0, 0, 0.22);
  opacity: 0;
  transform: scale(0.92);
  pointer-events: none;
  transition:
    opacity 160ms ease,
    transform 190ms cubic-bezier(0.3, 0, 0.2, 1);
  will-change: opacity, transform;

  &[data-visible="true"] {
    opacity: 1;
    transform: scale(1);
  }

  &::before {
    content: "";
    position: absolute;
    inset: 5px;
    border: 2px solid rgba(230, 236, 245, 0.1);
    border-top-color: var(--forge-accent-soft);
    border-right-color: var(--forge-ember);
    border-radius: inherit;
    animation: ${audioWidgetSpin} 860ms linear infinite;
  }

  &::after {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: inherit;
    background: rgba(244, 247, 250, 0.92);
    box-shadow:
      0 0 14px rgba(var(--forge-accent-soft-rgb), 0.28),
      0 0 18px rgba(217, 121, 53, 0.14);
  }

  html[data-forge-theme="light"] &,
  html[data-audio-widget-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 247, 250, 0.96));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.96) inset,
      0 8px 18px rgba(29, 29, 31, 0.1);
  }

  html[data-forge-theme="light"] &::before,
  html[data-audio-widget-theme="light"] &::before {
    border-color: rgba(0, 0, 0, 0.08);
    border-top-color: var(--forge-accent);
    border-right-color: rgba(221, 112, 31, 0.88);
  }

  html[data-forge-theme="light"] &::after,
  html[data-audio-widget-theme="light"] &::after {
    background: var(--forge-accent);
    box-shadow:
      0 0 12px rgba(var(--forge-accent-rgb), 0.26),
      0 0 16px rgba(221, 112, 31, 0.1);
  }
`;

export const AudioWidgetStatus = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 760;
    line-height: 1.15;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioRecordingTimer = styled.p`
  margin: 0;
  color: var(--forge-green);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
  font-weight: 760;
  text-align: center;
`;

export const AudioWidgetTranscript = styled.p`
  grid-column: 1 / -1;
  margin: 0;
  overflow: hidden;
  color: var(--forge-text-soft);
  font-size: 11px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AudioWidgetActions = styled.div`
  display: inline-flex;
  max-width: 0;
  align-items: center;
  gap: 5px;
  opacity: 0;
  overflow: hidden;
  transform: translateX(8px);
  transition:
    max-width 160ms ease,
    opacity 150ms ease,
    transform 150ms ease;
  -webkit-app-region: no-drag;

  button {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border: 1px solid var(--forge-border);
    border-radius: 999px;
    color: var(--forge-text-soft);
    background: rgba(21, 27, 35, 0.82);
    -webkit-app-region: no-drag;

    html[data-forge-theme="light"] & {
      background: var(--forge-surface-control);
    }

    &:hover {
      color: var(--forge-text);
      border-color: rgba(125, 160, 205, 0.34);
      background: rgba(125, 160, 205, 0.12);
    }

    &[data-variant="close"]:hover {
      color: #ffd7d7;
      border-color: rgba(239, 107, 107, 0.42);
      background: rgba(239, 107, 107, 0.14);
    }

    svg {
      width: 15px;
      height: 15px;
    }
  }
`;

export const McpWorkspaceSurface = styled.section`
  --mcp-border: rgba(230, 236, 245, 0.1);
  --mcp-border-strong: rgba(230, 236, 245, 0.14);
  --mcp-bg:
    radial-gradient(circle at 78% 8%, rgba(var(--forge-accent-rgb), 0.095), transparent 18rem),
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(13, 17, 23, 0.18);
  --mcp-panel-bg: rgba(17, 22, 29, 0.78);
  --mcp-panel-bg-soft: rgba(21, 27, 35, 0.42);
  --mcp-panel-bg-raised: rgba(17, 22, 29, 0.86);
  --mcp-control-bg: rgba(13, 17, 23, 0.92);
  --mcp-control-bg-soft: rgba(230, 236, 245, 0.05);
  --mcp-hover-bg: rgba(230, 236, 245, 0.035);
  --mcp-active-bg: rgba(var(--forge-accent-rgb), 0.12);
  --mcp-icon-bg: rgba(21, 27, 35, 0.72);

  container-type: inline-size;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
  padding: 12px 16px 16px;

  background: var(--mcp-bg);
  background-size: auto, 68px 68px, 68px 68px, auto;

  html[data-forge-space="loopspaces"] & {
    --mcp-border: rgba(255, 209, 102, 0.14);
    --mcp-border-strong: rgba(255, 209, 102, 0.18);
    --mcp-bg:
      radial-gradient(circle at 78% 8%, rgba(var(--forge-accent-rgb), 0.15), transparent 18rem),
      radial-gradient(circle at 28% 96%, rgba(var(--forge-accent-soft-rgb), 0.055), transparent 20rem),
      linear-gradient(90deg, rgba(var(--forge-accent-soft-rgb), 0.03) 1px, transparent 1px),
      linear-gradient(180deg, rgba(var(--forge-accent-soft-rgb), 0.022) 1px, transparent 1px),
      rgba(5, 4, 2, 0.96);
    --mcp-panel-bg: rgba(14, 10, 5, 0.76);
    --mcp-panel-bg-soft: rgba(13, 9, 4, 0.5);
    --mcp-panel-bg-raised: rgba(16, 11, 5, 0.86);
    --mcp-control-bg: rgba(8, 6, 3, 0.9);
    --mcp-control-bg-soft: rgba(var(--forge-accent-soft-rgb), 0.055);
    --mcp-hover-bg: rgba(var(--forge-accent-soft-rgb), 0.045);
    --mcp-active-bg: rgba(var(--forge-accent-rgb), 0.13);
    --mcp-icon-bg: rgba(16, 11, 5, 0.74);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-bg);
  }
`;

export const McpHeaderPanel = styled.section`
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--mcp-panel-bg-raised, rgba(17, 22, 29, 0.86));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const McpTitleRow = styled.div`
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) minmax(260px, auto);
  align-items: start;
  gap: 12px;
  min-width: 0;

  > div {
    min-width: 0;
  }

  h2 {
    margin-top: 2px;
    overflow: hidden;
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  p {
    margin-top: 3px;
    color: var(--forge-text-muted);
    font-size: 12px;
  }

  ${VaultPlaceholderIcon} {
    width: 44px;
    height: 44px;
    border-color: rgba(var(--forge-accent-soft-rgb), 0.24);
    color: var(--forge-accent-soft);
    background: rgba(var(--forge-accent-rgb), 0.08);

    svg {
      width: 18px;
      height: 18px;
    }
  }

  html[data-forge-theme="light"] & ${VaultPlaceholderIcon} {
    border-color: rgba(0, 102, 204, 0.16);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.055);
  }

  button {
    min-height: 36px;
  }

  @media (max-width: 760px) {
    grid-template-columns: 44px minmax(0, 1fr);

    > button {
      grid-column: 1 / -1;
      width: 100%;
    }
  }

  @container (max-width: 1120px) {
    grid-template-columns: 44px minmax(0, 1fr);

    > [aria-label="MCP summary"] {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }

    > button {
      grid-column: 1 / -1;
      width: 100%;
    }
  }
`;

export const McpButtonSpinner = styled.i`
  display: inline-block;
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border: 2px solid rgba(var(--forge-accent-soft-rgb), 0.24);
  border-top-color: var(--forge-accent-soft);
  border-right-color: var(--forge-amber);
  border-radius: 50%;
  animation: ${workspaceCloseSpin} 760ms linear infinite;

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.16);
    border-top-color: var(--forge-blue);
    border-right-color: var(--forge-blue-soft);
  }
`;

export const McpActionStatus = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  overflow: hidden;
  padding: 9px 10px;
  border: 1px solid rgba(var(--forge-accent-rgb), 0.28);
  border-radius: 8px;
  color: var(--forge-accent-soft);
  background: rgba(var(--forge-accent-rgb), 0.08);

  &::before {
    position: absolute;
    inset: 0 auto 0 -38%;
    width: 38%;
    background: linear-gradient(90deg, transparent, rgba(var(--forge-accent-soft-rgb), 0.16), transparent);
    animation: ${loadingOrangeSweep} 1.35s cubic-bezier(0.45, 0, 0.25, 1) infinite;
    content: "";
  }

  > * {
    position: relative;
    z-index: 1;
  }

  span {
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
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 820;
  }

  small {
    color: var(--forge-text-soft);
    font-size: 11px;
    font-weight: 650;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.18);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.055);
  }
`;

export const McpHeaderMetrics = styled.div`
  display: grid;
  min-width: 0;
  align-content: start;
  justify-items: end;
  gap: 8px;

  @container (max-width: 1120px) {
    justify-items: start;
  }
`;

export const McpMetricPill = styled.span`
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: var(--mcp-panel-bg-soft, rgba(21, 27, 35, 0.62));
  font-size: 10px;
  font-weight: 780;
  white-space: nowrap;

  strong {
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 900;
  }

  span {
    color: inherit;
    font-size: 10px;
    font-weight: 780;
    text-transform: uppercase;
  }

  &[data-state="enabled"] {
    border-color: rgba(var(--forge-accent-rgb), 0.3);
    color: var(--forge-accent-soft);
    background: rgba(var(--forge-accent-rgb), 0.1);
  }

  &[data-state="blocked"] {
    border-color: rgba(239, 107, 107, 0.32);
    color: #ffb4b4;
    background: rgba(239, 107, 107, 0.1);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.1);
    color: var(--forge-text-muted);
    background: #ffffff;
  }

  html[data-forge-theme="light"] &[data-state="enabled"] {
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.07);
  }

  html[data-forge-theme="light"] &[data-state="blocked"] {
    border-color: rgba(180, 35, 24, 0.22);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.07);
  }
`;

export const McpStatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const McpLayout = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(216px, 260px) minmax(0, 1fr);
  align-items: stretch;
  gap: 10px;
  overflow: hidden;
  transition: opacity 160ms ease;

  &[data-busy="true"] {
    opacity: 0.82;
  }

  &[data-editor-mode="manual"],
  &[data-editor-mode="marketplace"] {
    grid-template-columns: minmax(260px, 0.72fr) minmax(420px, 1.28fr);
  }

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
    overflow: auto;

    &[data-editor-mode="manual"] > :last-child,
    &[data-editor-mode="marketplace"] > :last-child {
      order: -1;
    }

    &[data-editor-mode="manual"] > :first-child,
    &[data-editor-mode="marketplace"] > :first-child {
      max-height: 260px;
      overflow: auto;
    }
  }

  @container (max-width: 920px) {
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;

    &[data-editor-mode="manual"] > :last-child,
    &[data-editor-mode="marketplace"] > :last-child {
      order: -1;
    }

    &[data-editor-mode="manual"] > :first-child,
    &[data-editor-mode="marketplace"] > :first-child {
      max-height: 260px;
      overflow: auto;
    }
  }
`;

export const McpRegistryPanel = styled.aside`
  container-type: inline-size;
  display: grid;
  min-width: 0;
  min-height: 82px;
  grid-template-rows: auto auto minmax(0, 1fr);
  align-content: start;
  gap: 8px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  background: var(--mcp-panel-bg, rgba(13, 17, 23, 0.72));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
`;

export const McpPanelTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  strong {
    color: var(--forge-text-soft);
  }

  @container (max-width: 300px) {
    display: grid;
    justify-content: start;

    strong {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
`;

export const McpServerList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 4px;
  overflow: visible;
`;

export const McpServerButton = styled.button`
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 7px 6px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: transparent;
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease;

  &::before {
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: 3px;
    width: 2px;
    border-radius: 999px;
    background: transparent;
    content: "";
  }

  &[data-active="true"],
  &:hover {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.24);
    background: var(--mcp-active-bg, var(--forge-surface-selected));
  }

  html[data-forge-theme="light"] &[data-active="true"],
  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.16);
    background: rgba(0, 102, 204, 0.06);
  }

  &[data-active="true"]::before {
    background: var(--forge-accent-soft);
  }

  html[data-forge-theme="light"] &[data-active="true"]::before {
    background: var(--forge-blue);
  }

  @container (max-width: 300px) {
    grid-template-columns: 28px minmax(0, 1fr);

    > :nth-child(3) {
      grid-column: 2;
      justify-self: start;
    }
  }
`;

export const McpServerIcon = styled.span`
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: var(--mcp-icon-bg, rgba(21, 27, 35, 0.72));

  svg {
    width: 15px;
    height: 15px;
  }

  &[data-state="enabled"] {
    border-color: rgba(var(--forge-accent-rgb), 0.32);
    color: var(--forge-accent-soft);
    background: rgba(var(--forge-accent-rgb), 0.1);
  }

  &[data-state="planned"] {
    border-color: var(--mcp-border, var(--forge-border));
    color: var(--forge-text-muted);
    background: var(--mcp-icon-bg, rgba(21, 27, 35, 0.72));
  }

  &[data-state="blocked"] {
    border-color: rgba(239, 107, 107, 0.34);
    color: #ffb4b4;
    background: rgba(239, 107, 107, 0.1);
  }

  html[data-forge-theme="light"] &,
  html[data-forge-theme="light"] &[data-state="planned"] {
    border-color: var(--forge-border);
    color: var(--forge-text-muted);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[data-state="enabled"] {
    border-color: rgba(0, 102, 204, 0.2);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.07);
  }

  html[data-forge-theme="light"] &[data-state="blocked"] {
    border-color: rgba(180, 35, 24, 0.22);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.07);
  }
`;

export const McpServerCopy = styled.span`
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
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 760;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 650;
  }
`;

export const McpStatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: var(--mcp-icon-bg, rgba(21, 27, 35, 0.72));
  font-size: 9px;
  font-weight: 760;
  text-transform: uppercase;

  &[data-state="enabled"] {
    border-color: rgba(var(--forge-accent-rgb), 0.3);
    color: var(--forge-accent-soft);
    background: rgba(var(--forge-accent-rgb), 0.1);
  }

  &[data-state="planned"] {
    border-color: var(--mcp-border, var(--forge-border));
    color: var(--forge-text-muted);
    background: var(--mcp-icon-bg, rgba(21, 27, 35, 0.72));
  }

  &[data-state="blocked"] {
    border-color: rgba(239, 107, 107, 0.32);
    color: #ffb4b4;
    background: rgba(239, 107, 107, 0.1);
  }

  &[data-pending="true"]::before {
    content: "";
    display: inline-block;
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
    border: 1.5px solid rgba(var(--forge-accent-soft-rgb), 0.24);
    border-top-color: var(--forge-accent-soft);
    border-right-color: var(--forge-amber);
    border-radius: 50%;
    animation: ${workspaceCloseSpin} 760ms linear infinite;
  }

  html[data-forge-theme="light"] &,
  html[data-forge-theme="light"] &[data-state="planned"] {
    border-color: rgba(0, 0, 0, 0.12);
    color: var(--forge-text-muted);
    background: #ffffff;
  }

  html[data-forge-theme="light"] &[data-state="enabled"] {
    border-color: rgba(0, 102, 204, 0.24);
    color: var(--forge-blue);
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 102, 204, 0.08);
  }

  html[data-forge-theme="light"] &[data-state="blocked"] {
    border-color: rgba(180, 35, 24, 0.22);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.06);
  }

  html[data-forge-theme="light"] &[data-pending="true"]::before {
    border-color: rgba(0, 102, 204, 0.16);
    border-top-color: var(--forge-blue);
    border-right-color: var(--forge-blue-soft);
  }
`;

export const McpEditorPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 12px;
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--mcp-panel-bg, rgba(17, 22, 29, 0.78));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
`;

export const McpEditorHeader = styled.div`
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

export const McpSwitchButton = styled.button`
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--mcp-icon-bg, rgba(21, 27, 35, 0.72));
  font-size: 12px;
  font-weight: 760;

  > span {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: rgba(230, 236, 245, 0.16);
  }

  > span::after {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--forge-text-muted);
    content: "";
    transition: transform 160ms ease;
  }

  &[aria-pressed="true"] {
    border-color: rgba(var(--forge-accent-rgb), 0.34);
    color: var(--forge-accent-soft);
    background: rgba(var(--forge-accent-rgb), 0.1);
  }

  &[aria-pressed="true"] > span::after {
    background: var(--forge-accent-soft);
    transform: translateX(12px);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[aria-pressed="true"] {
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.07);
  }

  html[data-forge-theme="light"] &[aria-pressed="true"] > span::after {
    background: var(--forge-blue);
  }

  &:disabled {
    opacity: 0.76;
  }
`;

export const AgentSafetyModeGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
`;

export const AgentSafetyModeButton = styled.button`
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: rgba(21, 27, 35, 0.72);
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;

  strong {
    font-size: 12px;
    font-weight: 780;
  }

  em {
    font-size: 10.5px;
    font-style: normal;
    font-weight: 600;
    color: var(--forge-text-muted);
  }

  &[data-active="true"][data-tone="safe"] {
    border-color: rgba(34, 197, 94, 0.42);
    color: rgba(134, 239, 172, 0.95);
    background: rgba(34, 197, 94, 0.1);
  }

  &[data-active="true"][data-tone="balanced"] {
    border-color: rgba(245, 158, 11, 0.42);
    color: rgba(252, 211, 77, 0.95);
    background: rgba(245, 158, 11, 0.1);
  }

  &[data-active="true"][data-tone="unsafe"] {
    border-color: rgba(239, 68, 68, 0.46);
    color: rgba(252, 165, 165, 0.95);
    background: rgba(239, 68, 68, 0.1);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }

  &:disabled {
    opacity: 0.76;
    cursor: default;
  }
`;

export const McpFieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const McpWideField = styled.label`
  display: grid;
  gap: 8px;
  grid-column: 1 / -1;
`;

export const McpInput = styled.input`
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--mcp-border-strong, var(--forge-border-strong));
  border-radius: 8px;
  color: var(--forge-text);
  background: var(--mcp-control-bg, rgba(13, 17, 23, 0.92));
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;

  &:focus {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.44);
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--forge-accent-rgb), 0.12);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-blue-soft);
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.14);
  }
`;

export const McpTextarea = styled.textarea`
  width: 100%;
  min-height: 86px;
  resize: vertical;
  padding: 11px 12px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text);
  background: var(--mcp-control-bg, rgba(13, 17, 23, 0.76));
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.5;
  outline: none;

  &:focus {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.44);
    box-shadow: 0 0 0 3px rgba(var(--forge-accent-rgb), 0.12);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-blue-soft);
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.14);
  }
`;

export const McpJsonTextarea = styled(McpTextarea)`
  min-height: 164px;
`;

export const McpTransportTabs = styled.div`
  --mcp-tab-count: 3;
  display: grid;
  grid-template-columns: repeat(var(--mcp-tab-count), minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  background: var(--mcp-control-bg, rgba(13, 17, 23, 0.46));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  &[data-columns="2"] {
    --mcp-tab-count: 2;
  }

  @media (max-width: 620px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @container (max-width: 300px) {
    grid-template-columns: 1fr;
  }
`;

export const McpTransportButton = styled.button`
  min-width: 0;
  min-height: 34px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 12px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-active="true"],
  &:hover {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.28);
    color: var(--forge-text);
    background: var(--mcp-active-bg, var(--forge-surface-selected));
  }

  html[data-forge-theme="light"] &[data-active="true"],
  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.16);
    color: var(--forge-text);
    background: rgba(0, 102, 204, 0.07);
  }
`;

export const McpAccessGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
  }

  @container (max-width: 820px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const McpAccessPanel = styled.section`
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  background: var(--mcp-panel-bg-soft, rgba(21, 27, 35, 0.42));

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
`;

export const McpAccessTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 760;

  > span {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  svg {
    width: 16px;
    height: 16px;
    color: var(--forge-accent-soft);
  }

  html[data-forge-theme="light"] & svg {
    color: var(--forge-blue);
  }
`;

export const McpToolList = styled.div`
  display: flex;
  min-width: 0;
  gap: 6px;
  flex-wrap: wrap;
`;

export const McpToolChip = styled.span`
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 0 8px;
  border: 1px solid var(--mcp-border, rgba(125, 160, 205, 0.18));
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--mcp-control-bg, rgba(13, 17, 23, 0.48));
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 11px;
  font-weight: 760;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.1);
    color: var(--forge-text-soft);
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.035);
  }
`;

export const McpInlineActions = styled.span`
  display: inline-flex;
  flex: 1 1 420px;
  min-width: min(100%, 360px);
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;

  ${McpInput} {
    flex: 1 1 260px;
    width: auto;
    min-width: min(100%, 220px);
    max-width: 460px;
    min-height: 34px;
  }

  button {
    display: inline-flex;
    flex: 0 0 auto;
    min-height: 34px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 10px;
    border: 1px solid var(--mcp-border, var(--forge-border));
    border-radius: 6px;
    color: var(--forge-text-soft);
    background: var(--mcp-icon-bg, rgba(21, 27, 35, 0.72));
    font-size: 10px;
    font-weight: 900;
    white-space: nowrap;

    html[data-forge-theme="light"] & {
      background: var(--forge-surface);
    }
  }

  button:hover {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.34);
    color: var(--forge-text);
  }

  @container (max-width: 1120px) {
    flex: 1 1 100%;
    justify-content: flex-start;
  }

  @container (max-width: 560px) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;

    ${McpInput} {
      grid-column: 1 / -1;
      max-width: none;
    }

    button {
      width: 100%;
    }
  }
`;

export const McpCheckList = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
`;

export const McpCheckRow = styled.label`
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 8px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  background: var(--mcp-control-bg, rgba(13, 17, 23, 0.58));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  input {
    width: 16px;
    height: 16px;
    accent-color: var(--forge-accent);
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
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 760;
  }

  small {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 650;
  }
`;

export const McpEmptyAccess = styled.p`
  margin: 0;
  padding: 10px;
  border: 1px solid var(--mcp-border, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: var(--mcp-panel-bg-soft, rgba(21, 27, 35, 0.48));
  font-size: 12px;
  font-weight: 650;

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  &[data-state="blocked"] {
    border-color: rgba(239, 107, 107, 0.3);
    color: #ffb4b4;
    background: rgba(239, 107, 107, 0.08);
  }

  html[data-forge-theme="light"] &[data-state="blocked"] {
    border-color: rgba(180, 35, 24, 0.2);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.06);
  }
`;

export const McpMountList = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
`;

export const McpMountRow = styled.div`
  display: grid;
  min-width: 0;
  min-height: 34px;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--mcp-border, rgba(125, 160, 205, 0.14));
  border-radius: 8px;
  background: var(--mcp-control-bg, rgba(13, 17, 23, 0.36));

  ${TerminalAgentDot} {
    justify-self: center;
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.035),
      inset 0 1px 0 rgba(255, 255, 255, 0.95);
  }
`;

export const McpMountCopy = styled.span`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 820;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 720;
    text-transform: uppercase;
  }
`;

export const McpScopePreview = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const McpEditorActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    display: inline-flex;
    min-height: 40px;
    min-width: 112px;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }

  @media (max-width: 680px) {
    align-items: stretch;
    flex-direction: column;

    button {
      width: 100%;
    }
  }
`;

export const WorkspaceSetupPanel = styled.form`
  display: grid;
  width: min(520px, 100%);
  align-self: center;
  justify-self: center;
  gap: 16px;
  padding: 22px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    rgba(17, 22, 29, 0.92);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const SetupHeader = styled.div`
  display: grid;
  gap: 6px;
`;

export const SetupField = styled.label`
  display: grid;
  gap: 8px;
`;

export const SetupInput = styled.input`
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(13, 17, 23, 0.92);
  font: inherit;

  &:focus {
    border-color: rgba(125, 160, 205, 0.44);
    outline: none;
    box-shadow: 0 0 0 3px rgba(125, 160, 205, 0.12);
  }

  &::placeholder {
    color: var(--forge-text-muted);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.72;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.13);
    color: #1d1d1f;
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.045),
      inset 0 1px 0 rgba(255, 255, 255, 0.98);
    color-scheme: light;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(var(--forge-tint-rgb), 0.22);
    background: #ffffff;
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-tint-soft);
    box-shadow:
      0 0 0 3px rgba(var(--forge-tint-rgb), 0.16),
      0 1px 2px rgba(0, 0, 0, 0.045),
      inset 0 1px 0 rgba(255, 255, 255, 1);
  }

  html[data-forge-theme="light"] &::placeholder {
    color: #8e8e93;
  }

  html[data-forge-theme="light"] &:disabled {
    color: #8e8e93;
    background: #f5f5f7;
  }
`;

export const BlankStatusStack = styled.div`
  display: grid;
  justify-self: end;
  width: min(520px, 100%);
  gap: 8px;
`;

export const WorkspaceSettingsOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  background:
    linear-gradient(90deg, rgba(3, 5, 8, 0.72), rgba(3, 5, 8, 0.42)),
    rgba(7, 9, 13, 0.72);
  backdrop-filter: blur(14px);
  animation: ${panelEnter} 160ms ease both;

  html[data-forge-theme="light"] & {
    background: rgba(245, 245, 247, 0.76);
    backdrop-filter: saturate(180%) blur(20px);
  }
`;

export const WorkspaceSettingsDialog = styled.aside`
  display: grid;
  align-content: start;
  gap: 12px;
  width: min(760px, 100%);
  max-height: min(720px, 100%);
  min-width: 0;
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), rgba(var(--forge-tint-soft-rgb), 0.018)),
    rgba(8, 13, 20, 0.98);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  animation: ${panelEnter} 190ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
    box-shadow: none;
  }

  @media (max-width: 620px) {
    width: 100%;
    max-height: 100%;
  }
`;

export const WorkspaceSettingsBusyOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  background:
    linear-gradient(180deg, rgba(3, 5, 8, 0.18), rgba(3, 5, 8, 0.38)),
    rgba(3, 5, 8, 0.44);
  backdrop-filter: blur(7px);

  html[data-forge-theme="light"] & {
    background: rgba(245, 245, 247, 0.62);
    backdrop-filter: saturate(180%) blur(20px);
  }
`;

export const WorkspaceSettingsBusyPanel = styled.section`
  display: grid;
  width: min(390px, 100%);
  min-width: 0;
  justify-items: center;
  gap: 11px;
  padding: 22px;
  border: 1px solid rgba(230, 236, 245, 0.13);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(98, 160, 255, 0.08), rgba(255, 122, 24, 0.035)),
    rgba(8, 13, 20, 0.96);
  box-shadow: 0 26px 82px rgba(0, 0, 0, 0.55);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
    box-shadow: none;
  }
`;

export const WorkspaceGitPullOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 18;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  background:
    linear-gradient(90deg, rgba(3, 5, 8, 0.64), rgba(3, 5, 8, 0.34)),
    rgba(7, 9, 13, 0.64);
  backdrop-filter: blur(12px);
  animation: ${panelEnter} 160ms ease both;

  html[data-forge-theme="light"] & {
    background: rgba(245, 245, 247, 0.72);
    backdrop-filter: saturate(180%) blur(18px);
  }
`;

export const WorkspaceGitPullDialog = styled.aside`
  display: grid;
  align-content: start;
  gap: 12px;
  width: min(660px, 100%);
  max-height: min(720px, 100%);
  min-width: 0;
  overflow: auto;
  padding: 14px;
  border: 1px solid rgba(125, 211, 252, 0.24);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(34, 211, 238, 0.055), rgba(255, 122, 24, 0.025)),
    rgba(8, 13, 20, 0.98);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border-strong);
    background: var(--forge-surface);
    box-shadow: 0 18px 52px rgba(15, 23, 42, 0.14);
  }
`;

export const WorkspaceGitPullHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;

  @media (max-width: 620px) {
    flex-direction: column;
  }
`;

export const WorkspaceGitPullSummary = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  color: var(--forge-text-muted);
  font-size: 13px;
  font-weight: 760;

  span {
    padding: 6px 8px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.42);
  }

  html[data-forge-theme="light"] & span {
    background: rgba(241, 245, 249, 0.88);
  }
`;

export const WorkspaceGitPullList = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  max-height: min(360px, 42vh);
  overflow: auto;
`;

export const WorkspaceGitPullRow = styled.label`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  min-width: 0;
  padding: 11px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.45);
  color: var(--forge-text);
  cursor: pointer;

  &[data-selected="true"] {
    border-color: rgba(45, 212, 191, 0.34);
    background:
      linear-gradient(180deg, rgba(20, 184, 166, 0.11), rgba(15, 23, 42, 0.42)),
      rgba(15, 23, 42, 0.52);
  }

  input {
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    accent-color: #2dd4bf;
  }

  strong {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--forge-text);
    font-size: 14px;
    font-weight: 850;
    line-height: 1.25;
  }

  small {
    display: block;
    min-width: 0;
    margin-top: 6px;
    overflow-wrap: anywhere;
    color: var(--forge-text-muted);
    font-size: 12px;
    font-weight: 720;
    line-height: 1.35;
  }

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.82);
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    background: rgba(236, 253, 245, 0.78);
  }
`;

export const WorkspaceGitPullRepoMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  margin-top: 7px;

  span {
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 4px 7px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    color: var(--forge-text-muted);
    background: rgba(2, 6, 23, 0.32);
    font-size: 11px;
    font-weight: 820;
    line-height: 1.15;
  }

  html[data-forge-theme="light"] & span {
    background: rgba(241, 245, 249, 0.88);
  }
`;

export const WorkspaceGitPullActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;

  @media (max-width: 620px) {
    flex-direction: column-reverse;

    button {
      width: 100%;
      justify-content: center;
    }
  }
`;

export const NetworkingOverlay = styled(WorkspaceSettingsOverlay)`
  z-index: 34;
  align-items: center;
  padding: clamp(12px, 2.4vw, 22px);
`;

export const NetworkingDialog = styled(WorkspaceSettingsDialog)`
  width: min(960px, 100%);
  max-height: min(760px, 100%);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
  border-color: rgba(148, 163, 184, 0.22);
`;

export const NetworkingHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);

  @media (max-width: 680px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

export const NetworkingToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
`;

export const NetworkingSummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;

  @media (max-width: 860px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

export const NetworkingMetric = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.28);

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 820;
    line-height: 1;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 14px;
    font-weight: 780;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.82);
  }
`;

export const NetworkingSectionGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

export const NetworkingSection = styled.section`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 6px;
  background: rgba(9, 14, 21, 0.34);

  &[data-span="wide"] {
    grid-column: 1 / -1;
  }

  &[data-role="errors"] {
    min-height: 112px;
    max-height: 180px;
  }

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.72);
  }
`;

export const NetworkingSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 11px;
    font-weight: 820;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 760;
    white-space: nowrap;
  }
`;

export const NetworkingList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 6px;
  background: rgba(2, 6, 23, 0.18);

  html[data-forge-theme="light"] & {
    background: rgba(248, 250, 252, 0.72);
  }
`;

export const NetworkingRow = styled.article`
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  background: transparent;

  &:last-child {
    border-bottom: 0;
  }

  &[data-tone="error"] {
    background: rgba(127, 29, 29, 0.14);
  }

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(15, 23, 42, 0.08);
  }
`;

export const NetworkingStatusDot = styled.span`
  width: 8px;
  height: 8px;
  margin-top: 4px;
  border-radius: 50%;
  background: #94a3b8;

  &[data-tone="green"] {
    background: #3ccb7f;
  }

  &[data-tone="blue"] {
    background: #60a5fa;
  }

  &[data-tone="orange"] {
    background: #f59e0b;
  }

  &[data-tone="red"] {
    background: #ef6b6b;
  }
`;

export const NetworkingRowMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 780;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 620;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const NetworkingCategoryTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 780;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const NetworkingCategoryStats = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

export const NetworkingCategoryCount = styled.span`
  display: inline-grid;
  min-width: 28px;
  height: 24px;
  place-items: center;
  padding: 0 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.54);
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 840;
  line-height: 1;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    background: rgba(241, 245, 249, 0.9);
  }
`;

export const NetworkingProgressValue = styled.span`
  display: inline-grid;
  min-width: 46px;
  height: 24px;
  place-items: center;
  padding: 0 8px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.12);
  color: #93c5fd;
  font-size: 11px;
  font-weight: 860;
  line-height: 1;
  white-space: nowrap;

  &[data-tone="green"] {
    border-color: rgba(60, 203, 127, 0.28);
    background: rgba(22, 163, 74, 0.12);
    color: #86efac;
  }

  &[data-tone="red"] {
    border-color: rgba(239, 107, 107, 0.32);
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;
  }

  html[data-forge-theme="light"] & {
    background: rgba(239, 246, 255, 0.92);
    color: #1d4ed8;
  }

  html[data-forge-theme="light"] &[data-tone="green"] {
    background: rgba(240, 253, 244, 0.92);
    color: #047857;
  }

  html[data-forge-theme="light"] &[data-tone="red"] {
    background: rgba(254, 242, 242, 0.92);
    color: #b91c1c;
  }
`;

export const NetworkingCategoryMeter = styled.div`
  position: relative;
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.13);

  &::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--network-progress, 0%);
    border-radius: inherit;
    background: #60a5fa;
    transition: width 220ms ease;
  }

  &[data-tone="green"]::before {
    background: #3ccb7f;
  }

  &[data-tone="orange"]::before {
    background: #f59e0b;
  }

  &[data-tone="red"]::before {
    background: #ef6b6b;
  }
`;

export const NetworkingMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  min-width: 0;

  span {
    max-width: 100%;
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span + span::before {
    content: "/";
    margin-right: 10px;
    color: rgba(148, 163, 184, 0.55);
  }
`;

export const NetworkingEmpty = styled.div`
  display: grid;
  min-height: 92px;
  place-items: center;
  padding: 12px;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 760;
  text-align: center;
`;

export const WorkspaceSettingsDialogHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);
`;

export const CrashRecoveryOverlay = styled(WorkspaceSettingsOverlay)`
  z-index: 32;
`;

export const CrashRecoveryDialog = styled(WorkspaceSettingsDialog)`
  width: min(780px, 100%);
`;

export const CrashRecoveryIntro = styled.div`
  display: grid;
  gap: 8px;
  color: var(--forge-text-soft);
  font-size: 13px;
  line-height: 1.5;

  p {
    margin: 0;
  }

  strong {
    color: var(--forge-text);
  }
`;

export const CrashRecoveryList = styled.div`
  display: grid;
  gap: 9px;
  max-height: min(280px, 34vh);
  min-height: 0;
  overflow: auto;
`;

export const CrashRecoveryItem = styled.article`
  display: grid;
  gap: 7px;
  padding: 11px;
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: 9px;
  background:
    linear-gradient(135deg, rgba(251, 191, 36, 0.07), rgba(96, 165, 250, 0.045)),
    rgba(12, 18, 28, 0.72);
`;

export const CrashRecoveryItemTitle = styled.strong`
  color: var(--forge-text);
  font-size: 13px;
  line-height: 1.35;
`;

export const CrashRecoveryItemBody = styled.p`
  margin: 0;
  color: var(--forge-text-soft);
  font-size: 12px;
  line-height: 1.45;
`;

export const CrashRecoveryMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--forge-text-muted);
  font-size: 11px;

  span {
    max-width: min(100%, 420px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const CrashRecoveryActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  flex-wrap: wrap;
`;

export const AppCloseOverlay = styled(CrashRecoveryOverlay)`
  padding: clamp(18px, 5vw, 34px);
`;

export const AppCloseDialog = styled(CrashRecoveryDialog)`
  width: min(610px, 100%);
  min-height: min(377px, calc(100vh - 36px));
  gap: 0;
  overflow: hidden;
  padding: 0;
  border-color: rgba(125, 160, 205, 0.24);
  background:
    linear-gradient(145deg, rgba(var(--forge-tint-rgb), 0.07), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.018)),
    rgba(9, 14, 21, 0.985);
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.58),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.1);
    background:
      linear-gradient(145deg, rgba(var(--forge-tint-rgb), 0.06), transparent 42%),
      rgba(255, 255, 255, 0.96);
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.14);
  }
`;

export const AppCloseHeader = styled(WorkspaceSettingsDialogHeader)`
  align-items: center;
  gap: 16px;
  padding: 22px 22px 14px;
  border-bottom-color: rgba(230, 236, 245, 0.07);

  .app-close-title {
    margin-top: 2px;
    font-size: clamp(22px, 4vw, 29px);
    line-height: 1.12;
  }

  .app-close-kicker {
    color: rgba(255, 196, 110, 0.86);
    letter-spacing: 0.08em;
  }

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(0, 0, 0, 0.07);
  }

  html[data-forge-theme="light"] & .app-close-kicker {
    color: #9a5b00;
  }
`;

export const AppCloseBody = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.618fr) minmax(118px, 1fr);
  gap: 20px;
  align-items: center;
  padding: 20px 22px 18px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
    gap: 14px;
  }
`;

export const AppCloseIntro = styled(CrashRecoveryIntro)`
  gap: 9px;
  color: rgba(213, 221, 232, 0.84);
  font-size: 14px;
  line-height: 1.55;
`;

export const AppCloseHint = styled.p`
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.2);
  border-radius: 8px;
  color: var(--forge-tint-soft);
  background: rgba(var(--forge-tint-rgb), 0.09);
  font-size: 12px;
  font-weight: 720;

  &::before {
    content: "";
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 2px;
    background: #ffbd6e;
    box-shadow: 0 0 0 3px rgba(255, 189, 110, 0.12);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.16);
    color: var(--forge-tint);
    background: rgba(var(--forge-tint-rgb), 0.06);
  }
`;

export const AppCloseMark = styled.div`
  display: grid;
  width: min(112px, 100%);
  aspect-ratio: 1;
  justify-self: end;
  place-items: center;
  border: 1px solid rgba(125, 160, 205, 0.24);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 189, 110, 0.12), rgba(var(--forge-tint-rgb), 0.09)),
    rgba(14, 21, 31, 0.8);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);

  img {
    display: block;
    width: 58px;
    height: 58px;
    border-radius: 8px;
    object-fit: cover;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    background:
      linear-gradient(135deg, rgba(255, 189, 110, 0.16), rgba(var(--forge-tint-rgb), 0.08)),
      rgba(255, 255, 255, 0.82);
    box-shadow: none;
  }

  @media (max-width: 560px) {
    width: 76px;
    justify-self: start;
    order: -1;

    img {
      width: 42px;
      height: 42px;
    }
  }
`;

export const AppCloseList = styled(CrashRecoveryList)`
  margin: 0 22px 18px;
  max-height: min(190px, 27vh);
`;

export const AppCloseActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.618fr) minmax(0, 1fr);
  gap: 10px;
  margin-top: auto;
  padding: 16px 22px 22px;
  border-top: 1px solid rgba(230, 236, 245, 0.07);

  html[data-forge-theme="light"] & {
    border-top-color: rgba(0, 0, 0, 0.07);
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
    gap: 8px;
  }
`;

export const AppCloseActionButton = styled.button`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  min-width: 0;
  min-height: 72px;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(125, 160, 205, 0.2);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(18, 25, 35, 0.72);
  text-align: left;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    border-color: rgba(125, 176, 255, 0.38);
    background: rgba(24, 34, 47, 0.86);
    box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: wait;
    opacity: 0.56;
  }

  &[data-tone="danger"] {
    border-color: rgba(239, 107, 107, 0.3);
    color: #ffd0d0;
    background: rgba(80, 34, 38, 0.3);
  }

  &[data-tone="danger"]:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.5);
    background: rgba(98, 39, 44, 0.42);
  }

  &[data-tone="background"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.36);
    background:
      linear-gradient(135deg, rgba(var(--forge-tint-rgb), 0.18), rgba(255, 189, 110, 0.06)),
      rgba(20, 28, 39, 0.8);
  }

  &[data-tone="background"]:hover:not(:disabled) {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.54);
    background:
      linear-gradient(135deg, rgba(var(--forge-tint-rgb), 0.24), rgba(255, 189, 110, 0.08)),
      rgba(23, 33, 47, 0.9);
  }

  &[data-tone="stay"] {
    border-color: rgba(80, 211, 154, 0.26);
    background: rgba(28, 63, 51, 0.24);
  }

  svg {
    width: 21px;
    height: 21px;
    color: currentColor;
  }

  strong,
  small {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 14px;
    font-weight: 820;
    line-height: 1.2;
  }

  small {
    margin-top: 4px;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 680;
    line-height: 1.2;
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[data-tone="danger"] {
    border-color: rgba(180, 35, 24, 0.22);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.055);
  }

  html[data-forge-theme="light"] &[data-tone="background"] {
    border-color: rgba(0, 102, 204, 0.28);
    background: rgba(0, 102, 204, 0.07);
  }

  html[data-forge-theme="light"] &[data-tone="stay"] {
    border-color: rgba(24, 128, 86, 0.22);
    background: rgba(24, 128, 86, 0.06);
  }

  @media (max-width: 560px) {
    min-height: 58px;
  }
`;

export const AppCloseActionCopy = styled.span`
  display: block;
  min-width: 0;
`;

export const WorkspaceSettingsHeaderMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 7px;
`;

export const WorkspaceSettingsHeaderMeta = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

export const WorkspaceSettingsHeaderActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-height: 32px;
  }
`;

export const WorkspaceSettingsMetaPill = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  padding: 4px 7px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 999px;
  background: rgba(7, 9, 13, 0.5);
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-soft);
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0;
    text-overflow: ellipsis;
    text-transform: none;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;

export const WorkspaceModalCloseButton = styled.button`
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: rgba(21, 27, 35, 0.72);
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;

  &:hover {
    border-color: rgba(239, 107, 107, 0.38);
    color: #ffc8c8;
    background: rgba(239, 107, 107, 0.1);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.08);
  }

  &:disabled {
    cursor: wait;
    opacity: 0.62;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

export const WorkspaceSettingsForm = styled.form`
  display: grid;
  gap: 10px;
  min-width: 0;
`;

export const WorkspaceSettingsInput = styled(SetupInput)`
  min-height: 36px;
  font-size: 13px;
`;

export const WorkspaceSettingsSelect = styled(WorkspaceSettingsInput).attrs({ as: "select" })`
  min-height: 40px;
  padding: 0 38px 0 12px;
  border-color: var(--forge-border-strong);
  color: #f4f7fa;
  background-color: rgba(13, 17, 23, 0.92);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23b6c0cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px 16px;
  box-shadow: none;
  color-scheme: dark;
  cursor: pointer;
  font-weight: 720;
  line-height: 1;
  text-overflow: ellipsis;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;
  white-space: nowrap;
  appearance: none;
  -webkit-appearance: none;

  &::-ms-expand {
    display: none;
  }

  &:hover {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.34);
    background-color: rgba(16, 22, 31, 0.98);
  }

  &:focus {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.44);
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--forge-accent-rgb), 0.12);
  }

  option,
  optgroup {
    color: #f4f7fa;
    background: #0d1117;
    background-image: none;
  }

  option[value=""] {
    color: #b6c0cc;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.13);
    color: #1d1d1f;
    background-color: #ffffff;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230066cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    box-shadow: none;
    color-scheme: light;
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.28);
    background-color: #fafafc;
  }

  html[data-forge-theme="light"] &:focus {
    border-color: var(--forge-blue-soft);
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.16);
  }

  html[data-forge-theme="light"] option,
  html[data-forge-theme="light"] optgroup {
    color: #1d1d1f;
    background: #ffffff;
    background-image: none;
  }

  html[data-forge-theme="light"] option[value=""] {
    color: #6e6e73;
  }
`;

export const WorkspaceSettingsSelectShell = styled.div`
  position: relative;
  width: 100%;
  min-width: 0;
`;

export const WorkspaceSettingsSelectIcon = styled(ExpandMore)`
  position: absolute;
  top: 50%;
  right: 10px;
  width: 22px;
  height: 22px;
  color: #b6c0cc;
  pointer-events: none;
  transform: translateY(-50%);
  transition: color 160ms ease;

  ${WorkspaceSettingsSelectShell}:hover & {
    color: #d4dbe4;
  }

  html[data-forge-theme="light"] & {
    color: #0066cc;
  }

  html[data-forge-theme="light"] ${WorkspaceSettingsSelectShell}:hover & {
    color: #0057b8;
  }
`;

export const WorkspaceNumberInput = styled(WorkspaceSettingsInput)`
  width: 100%;
`;

export const RootDirectoryInput = styled(WorkspaceSettingsInput)`
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;

  &[readonly] {
    color: var(--forge-text-soft);
    cursor: default;
  }

  html[data-forge-theme="light"] &[readonly] {
    color: #3a3a3c;
    background: #ffffff;
  }
`;

export const WorkspaceSettingsTopGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 0.82fr) minmax(260px, 1.18fr);
  gap: 10px;
  min-width: 0;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

export const WorkspaceRootChooser = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
`;

export const WorkspaceRootActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;

  button {
    min-width: 118px;
    min-height: 34px;
  }
`;

export const WorkspaceSettingsSection = styled.section`
  display: grid;
  min-width: 0;
  gap: 9px;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.09);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.026), rgba(255, 255, 255, 0.008)),
    rgba(13, 17, 23, 0.62);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }
`;

export const TerminalCountGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;

  @media (max-width: 720px) {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  @media (max-width: 480px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`;

export const TerminalCountButton = styled.button`
  display: grid;
  min-width: 0;
  min-height: 54px;
  align-content: start;
  gap: 5px;
  padding: 6px;
  border: 1px solid rgba(230, 236, 245, 0.09);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: rgba(7, 9, 13, 0.48);
  text-align: left;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;

  &:hover {
    border-color: rgba(98, 160, 255, 0.28);
    color: var(--forge-text);
    background: rgba(21, 27, 35, 0.78);
    transform: translateY(-1px);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.22);
    background: var(--forge-surface-control);
  }

  &[data-selected="true"] {
    border-color: rgba(98, 160, 255, 0.55);
    color: #ffffff;
    background:
      linear-gradient(180deg, rgba(47, 128, 255, 0.18), rgba(255, 122, 24, 0.055)),
      rgba(13, 17, 23, 0.92);
    box-shadow: inset 0 0 0 1px rgba(98, 160, 255, 0.12);
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    border-color: rgba(0, 102, 204, 0.32);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
    box-shadow: none;
  }

  &:disabled {
    cursor: wait;
    opacity: 0.58;
    transform: none;
  }
`;

export const TerminalCountMeta = styled.span`
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;

  strong {
    color: inherit;
    font-size: 14px;
    font-weight: 900;
    line-height: 1;
  }

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const TerminalLayoutPreview = styled.div`
  display: grid;
  min-width: 0;
  height: 22px;
  gap: 2px;
  overflow: hidden;
  padding: 3px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 6px;
  background:
    linear-gradient(90deg, rgba(230, 236, 245, 0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.028) 1px, transparent 1px),
    #020304;
  background-size: 14px 14px, 14px 14px, auto;

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.04) 1px, transparent 1px),
      linear-gradient(180deg, rgba(0, 0, 0, 0.035) 1px, transparent 1px),
      var(--forge-surface-control);
  }
`;

export const TerminalLayoutPreviewRow = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: repeat(var(--preview-columns), minmax(0, 1fr));
  gap: 2px;
`;

export const TerminalLayoutPreviewCell = styled.span`
  min-width: 0;
  min-height: 0;
  border: 1px solid rgba(98, 160, 255, 0.18);
  border-radius: 3px;
  background: rgba(98, 160, 255, 0.14);

  &[data-slot="primary"] {
    border-color: rgba(98, 160, 255, 0.42);
    background: rgba(98, 160, 255, 0.28);
  }

  &[data-slot="codex"] {
    border-color: rgba(98, 160, 255, 0.42);
    background: rgba(98, 160, 255, 0.26);
  }

  &[data-slot="orange"] {
    border-color: rgba(255, 154, 61, 0.32);
    background: rgba(255, 122, 24, 0.16);
  }

  &[data-slot="claude"] {
    border-color: rgba(255, 154, 61, 0.34);
    background: rgba(255, 122, 24, 0.18);
  }

  html[data-forge-theme="light"] &[data-slot="orange"],
  html[data-forge-theme="light"] &[data-slot="claude"] {
    border-color: rgba(0, 102, 204, 0.2);
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-slot="opencode"] {
    border-color: rgba(67, 229, 176, 0.34);
    background: rgba(37, 211, 154, 0.17);
  }

  &[data-slot="generic"] {
    border-color: rgba(143, 157, 183, 0.24);
    background: rgba(143, 157, 183, 0.12);
  }
`;

export const TerminalRestartMenu = styled.div`
  position: relative;
  display: inline-flex;
  min-width: 0;
`;

export const TerminalRestartDropdown = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  display: grid;
  min-width: 156px;
  max-width: min(220px, calc(100vw - 24px));
  gap: 3px;
  padding: 4px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.012)),
    rgb(7, 9, 13);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
    box-shadow: none;
  }

  &[data-open="false"] {
    display: none;
  }
`;

export const TerminalRestartOption = styled.button`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    opacity 150ms ease;

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    font-weight: 820;
    letter-spacing: 0;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover,
  &:focus-visible {
    border-color: rgba(98, 160, 255, 0.22);
    color: #fff;
    background: rgba(98, 160, 255, 0.1);
    outline: none;
  }

  html[data-forge-theme="light"] &:hover,
  html[data-forge-theme="light"] &:focus-visible {
    color: var(--forge-text);
    border-color: rgba(0, 102, 204, 0.22);
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-role="claude"]:hover,
  &[data-role="claude"]:focus-visible {
    border-color: rgba(255, 154, 61, 0.26);
    background: rgba(255, 122, 24, 0.11);
  }

  html[data-forge-theme="light"] &[data-role="claude"]:hover,
  html[data-forge-theme="light"] &[data-role="claude"]:focus-visible {
    border-color: rgba(0, 102, 204, 0.22);
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-role="generic"]:hover,
  &[data-role="generic"]:focus-visible {
    border-color: rgba(143, 157, 183, 0.24);
    background: rgba(143, 157, 183, 0.1);
  }

  &[data-role="opencode"]:hover,
  &[data-role="opencode"]:focus-visible {
    border-color: rgba(67, 229, 176, 0.26);
    background: rgba(37, 211, 154, 0.1);
  }

  &[data-selected="true"] {
    color: #fff;
    border-color: rgba(98, 160, 255, 0.22);
    background: rgba(98, 160, 255, 0.1);
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    color: var(--forge-blue);
    border-color: rgba(0, 102, 204, 0.22);
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-role="claude"][data-selected="true"] {
    border-color: rgba(255, 154, 61, 0.26);
    background: rgba(255, 122, 24, 0.11);
  }

  html[data-forge-theme="light"] &[data-role="claude"][data-selected="true"] {
    border-color: rgba(0, 102, 204, 0.22);
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-role="generic"][data-selected="true"] {
    border-color: rgba(143, 157, 183, 0.24);
    background: rgba(143, 157, 183, 0.1);
  }

  &[data-role="opencode"][data-selected="true"] {
    border-color: rgba(67, 229, 176, 0.26);
    background: rgba(37, 211, 154, 0.1);
  }
`;

export const TerminalRoleSummary = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

export const TerminalRoleGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(146px, 1fr));
  gap: 7px;
  min-width: 0;
`;

export const TerminalRoleSliderGrid = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
`;

export const TerminalRoleSliderRow = styled.label`
  display: grid;
  grid-template-columns: minmax(112px, 0.34fr) minmax(180px, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.42);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }

  > span {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-soft);
    font-size: 12px;
    font-weight: 820;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    display: inline-flex;
    min-width: 24px;
    justify-content: center;
    padding: 3px 6px;
    border-radius: 999px;
    color: #fff;
    background: rgba(98, 160, 255, 0.14);
    font-size: 11px;
    font-style: normal;
    font-weight: 900;
    line-height: 1;
  }

  &[data-role="claude"] em {
    background: rgba(255, 122, 24, 0.16);
  }

  html[data-forge-theme="light"] &[data-role="claude"] em {
    background: rgba(0, 102, 204, 0.12);
  }

  &[data-role="generic"] em {
    background: rgba(143, 157, 183, 0.14);
  }

  &[data-role="opencode"] em {
    background: rgba(37, 211, 154, 0.15);
  }

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const TerminalRoleRange = styled.input`
  width: 100%;
  min-width: 0;
  accent-color: var(--forge-blue-soft);

  &[data-role="claude"] {
    accent-color: #ff9d48;
  }

  html[data-forge-theme="light"] &[data-role="claude"] {
    accent-color: var(--forge-blue);
  }

  &[data-role="generic"] {
    accent-color: #8f9db7;
  }

  &[data-role="opencode"] {
    accent-color: #43e5b0;
  }
`;

export const TerminalRoleCard = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
  padding: 7px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.42);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

export const TerminalRoleButtonGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  min-width: 0;
`;

export const TerminalRoleButton = styled.button`
  min-width: 0;
  min-height: 28px;
  overflow: hidden;
  padding: 0 6px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: rgba(21, 27, 35, 0.46);
  font-size: 10px;
  font-weight: 820;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;

  &[data-selected="true"] {
    color: #fff;
    border-color: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.38);
    background: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.14);
  }

  &[data-role="claude"][data-selected="true"] {
    border-color: rgba(255, 154, 61, 0.34);
    background: rgba(255, 122, 24, 0.14);
  }

  html[data-forge-theme="light"] &[data-selected="true"],
  html[data-forge-theme="light"] &[data-role="claude"][data-selected="true"] {
    color: var(--settings-accent, var(--forge-tint));
    border-color: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.24);
    background: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.08);
  }

  &[data-role="generic"][data-selected="true"] {
    border-color: rgba(143, 157, 183, 0.34);
    background: rgba(143, 157, 183, 0.12);
  }

  &[data-role="opencode"][data-selected="true"] {
    border-color: rgba(67, 229, 176, 0.34);
    background: rgba(37, 211, 154, 0.14);
  }
`;

export const WorkspaceSettingsFieldGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
  gap: 12px;
  min-width: 0;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const WorkspaceSettingsActions = styled.div`
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

export const AgentSettingsPanel = styled.section`
  position: relative;
  display: grid;
  gap: 12px;
  align-self: start;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 14px;
  border: 1px solid var(--settings-border, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--settings-panel-bg, rgba(17, 22, 29, 0.8));
  box-shadow: inset 0 1px 0 rgba(244, 247, 250, 0.04);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
    box-shadow: none;
  }

  &::before {
    display: none;
  }
`;

export const AgentPanelActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;

  button {
    min-height: 36px;
  }
`;

export const AgentReadyPill = styled.div`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--settings-control-bg, rgba(21, 27, 35, 0.72));
  font-size: 12px;
  font-weight: 760;

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-tone="blue"] {
    border-color: rgba(var(--forge-tint-rgb), 0.3);
    color: var(--forge-tint-soft);
    background: rgba(var(--forge-tint-rgb), 0.1);
  }

  &[data-tone="orange"] {
    border-color: rgba(223, 165, 90, 0.3);
    color: var(--forge-amber);
    background: rgba(223, 165, 90, 0.08);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;

export const AgentCardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 10px;
  min-height: 0;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

export const AgentCard = styled.section`
  position: relative;
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
  padding: 12px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--settings-panel-bg-soft, rgba(13, 17, 23, 0.78));
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  &::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: rgba(230, 236, 245, 0.12);
    content: "";
  }

  &:hover {
    border-color: var(--settings-border-strong, var(--forge-border-strong));
    background:
      linear-gradient(180deg, rgba(244, 247, 250, 0.042), rgba(244, 247, 250, 0.014)),
      var(--settings-control-bg-hover, rgba(17, 22, 29, 0.88));
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:hover {
    background: var(--forge-surface-control);
  }

  &[data-tone="ready"] {
    border-color: rgba(60, 203, 127, 0.28);
  }

  &[data-tone="ready"]::before {
    background: var(--forge-green);
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(223, 165, 90, 0.28);
  }

  &[data-tone="needsAuth"]::before {
    background: var(--forge-amber);
  }
`;

export const AgentCardHeader = styled.div`
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
`;

export const AgentIcon = styled.span`
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: rgba(var(--settings-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.04);

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-tone="ready"] {
    border-color: rgba(60, 203, 127, 0.3);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.09);
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(223, 165, 90, 0.3);
    color: var(--forge-amber);
    background: rgba(223, 165, 90, 0.09);
  }
`;

export const AgentName = styled.h3`
  margin: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AgentMeta = styled.p`
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AgentStatusText = styled.p`
  margin: 0;
  min-height: 0;
  color: var(--forge-text-soft);
  font-size: 12px;
  line-height: 1.45;
`;

export const AgentInstallPanel = styled.div`
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--settings-panel-bg-muted, rgba(21, 27, 35, 0.42));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;

export const AgentInstallTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 720;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AgentInstallBadge = styled.span`
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid var(--settings-border-strong, rgba(125, 160, 205, 0.28));
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: rgba(var(--settings-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.08);
  font-size: 10px;
  font-weight: 760;
  text-transform: uppercase;
`;

export const AgentInstallHint = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.45;
`;

export const AgentInstallActions = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;

  button {
    min-height: 36px;
  }
`;

export const AgentInstallCommand = styled.code`
  display: block;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--settings-panel-bg-muted, rgba(7, 9, 13, 0.54));
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const AgentLaunchDefaultsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

export const AgentLaunchField = styled.label`
  display: grid;
  min-width: 0;
  gap: 5px;

  &[data-wide="true"] {
    grid-column: 1 / -1;
  }
`;

export const AgentPermissionHint = styled.p`
  margin: 0;
  padding: 8px 9px;
  border: 1px solid rgba(223, 165, 90, 0.28);
  border-radius: 8px;
  color: #e5bd83;
  background: rgba(223, 165, 90, 0.08);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.45;
`;

export const AgentInstallMessage = styled.p`
  margin: 0;
  padding: 8px 9px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--settings-panel-bg-muted, rgba(21, 27, 35, 0.5));
  font-size: 12px;
  font-weight: 650;
  line-height: 1.45;
  overflow-wrap: anywhere;

  &[data-tone="success"] {
    border-color: rgba(60, 203, 127, 0.28);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.08);
  }

  &[data-tone="warning"] {
    border-color: rgba(223, 165, 90, 0.28);
    color: #e5bd83;
    background: rgba(223, 165, 90, 0.08);
  }
`;

export const AgentActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  button {
    min-height: 36px;
  }
`;

export const AgentActionTooltip = styled.span`
  display: block;
  min-width: 0;

  button {
    width: 100%;
  }
`;

export const PageHeader = styled.header`
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

export const PageSubline = styled.p`
  margin: 7px 0 0;
  color: var(--forge-text-soft);
  font-size: 14px;
  line-height: 1.5;
`;

export const DashboardTitle = styled.h1`
  margin: 6px 0 0;
  color: var(--forge-text);
  font-size: 28px;
  font-weight: 760;
  letter-spacing: 0;
`;

export const PanelHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;

  > div:first-child {
    min-width: 0;
  }
`;

export const PanelKicker = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

export const PanelHeading = styled.h2`
  margin: 4px 0 0;
  color: var(--forge-text);
  font-size: 17px;
  font-weight: 760;
  letter-spacing: 0;
`;

export const SettingsPage = styled.section`
  --settings-surface-bg:
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(13, 17, 23, 0.18);
  --settings-surface-bg-size: 72px 72px, 72px 72px, auto;
  --settings-border: rgba(230, 236, 245, 0.1);
  --settings-border-soft: rgba(230, 236, 245, 0.1);
  --settings-border-strong: rgba(230, 236, 245, 0.16);
  --settings-panel-bg: rgba(17, 22, 29, 0.8);
  --settings-panel-bg-soft: rgba(13, 17, 23, 0.78);
  --settings-panel-bg-muted: rgba(21, 27, 35, 0.5);
  --settings-control-bg: rgba(21, 27, 35, 0.72);
  --settings-control-bg-hover: rgba(17, 22, 29, 0.88);
  --settings-tab-bg: rgba(7, 10, 16, 0.64);
  --settings-accent: var(--forge-tint);
  --settings-accent-soft: var(--forge-tint-soft);
  --settings-accent-rgb: var(--forge-tint-rgb);
  --settings-accent-soft-rgb: var(--forge-tint-soft-rgb);

  display: grid;
  grid-column: 1 / -1;
  width: 100%;
  height: 100%;
  min-width: 0;
  align-content: start;
  grid-auto-rows: max-content;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  background: var(--settings-surface-bg);
  background-size: var(--settings-surface-bg-size);
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  html[data-forge-space="loopspaces"] & {
    --settings-surface-bg:
      radial-gradient(circle at 76% 8%, rgba(var(--forge-tint-rgb), 0.13), transparent 18rem),
      radial-gradient(circle at 22% 98%, rgba(var(--forge-tint-soft-rgb), 0.045), transparent 20rem),
      linear-gradient(90deg, rgba(var(--forge-tint-soft-rgb), 0.03) 1px, transparent 1px),
      linear-gradient(180deg, rgba(var(--forge-tint-soft-rgb), 0.022) 1px, transparent 1px),
      rgba(5, 4, 2, 0.96);
    --settings-surface-bg-size: auto, auto, 72px 72px, 72px 72px, auto;
    --settings-border: rgba(var(--forge-tint-soft-rgb), 0.16);
    --settings-border-soft: rgba(var(--forge-tint-soft-rgb), 0.1);
    --settings-border-strong: rgba(var(--forge-tint-soft-rgb), 0.3);
    --settings-panel-bg: rgba(14, 10, 5, 0.8);
    --settings-panel-bg-soft: rgba(13, 9, 4, 0.72);
    --settings-panel-bg-muted: rgba(8, 6, 3, 0.52);
    --settings-control-bg: rgba(15, 10, 4, 0.74);
    --settings-control-bg-hover: rgba(22, 15, 6, 0.86);
    --settings-tab-bg: rgba(8, 6, 3, 0.72);
  }

  html[data-forge-theme="light"] & {
    --settings-surface-bg: var(--forge-bg);
    --settings-surface-bg-size: auto;
    --settings-border: var(--forge-border);
    --settings-border-soft: var(--forge-border);
    --settings-border-strong: rgba(var(--forge-tint-rgb), 0.22);
    --settings-panel-bg: var(--forge-surface);
    --settings-panel-bg-soft: var(--forge-surface);
    --settings-panel-bg-muted: var(--forge-surface-control);
    --settings-control-bg: var(--forge-surface-control);
    --settings-control-bg-hover: var(--forge-surface-control);
    --settings-tab-bg: var(--forge-surface-control);
  }

  html[data-forge-theme="light"][data-forge-space="loopspaces"] & {
    --settings-surface-bg:
      radial-gradient(circle at 76% 8%, rgba(var(--forge-tint-rgb), 0.07), transparent 18rem),
      #f5f5f7;
    --settings-surface-bg-size: auto, auto;
    --settings-border: rgba(var(--forge-tint-rgb), 0.16);
    --settings-border-soft: rgba(var(--forge-tint-rgb), 0.1);
    --settings-border-strong: rgba(var(--forge-tint-rgb), 0.26);
    --settings-panel-bg-muted: rgba(var(--forge-tint-rgb), 0.045);
    --settings-tab-bg: rgba(var(--forge-tint-rgb), 0.04);
  }

  ${DashboardTitle} {
    margin-top: 3px;
    font-size: 20px;
    line-height: 1.15;
  }

  ${PageSubline} {
    margin-top: 4px;
    color: var(--forge-text-muted);
    font-size: 13px;
  }

  ${Kicker} {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 760;
    letter-spacing: 0.06em;
  }

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 760px) {
    grid-column: 1;
    padding: 14px;
  }
`;

export const SettingsTabNav = styled.nav`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  width: min(100%, 620px);
  padding: 4px;
  border: 1px solid var(--settings-border, var(--forge-border));
  border-radius: 8px;
  background: var(--settings-tab-bg, rgba(7, 10, 16, 0.64));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;

export const SettingsTabButton = styled.button`
  display: inline-flex;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 13px;
  font-weight: 780;
  letter-spacing: 0;
  cursor: pointer;

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover {
    color: var(--forge-text);
    background: rgba(var(--settings-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.1);
  }

  &[data-active="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
    color: var(--forge-text);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.28), rgba(var(--forge-tint-rgb), 0.12)),
      rgba(var(--forge-tint-rgb), 0.18);
    box-shadow: inset 0 0 0 1px rgba(var(--forge-tint-soft-rgb), 0.12);
  }
`;

const settingsPermissionPulse = keyframes`
  0% { opacity: 0; }
  8% { opacity: 1; }
  42% { opacity: 0.66; }
  62% { opacity: 1; }
  100% { opacity: 0; }
`;

export const SettingsPermissionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const SettingsPermissionRow = styled.section`
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  padding: 13px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.03), rgba(244, 247, 250, 0.01)),
    var(--settings-panel-bg-soft, rgba(17, 22, 29, 0.72));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  &[data-tone="ready"] {
    border-color: rgba(91, 196, 125, 0.28);
  }

  &[data-tone="attention"] {
    border-color: rgba(223, 165, 90, 0.38);
  }

  &[data-tone="neutral"] {
    border-color: var(--settings-border, rgba(125, 160, 205, 0.18));
  }
`;

export const SettingsPermissionIcon = styled.span`
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--settings-border, rgba(125, 160, 205, 0.22));
  border-radius: 8px;
  color: var(--settings-accent-soft, rgba(153, 190, 255, 0.96));
  background: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.14);

  svg {
    width: 19px;
    height: 19px;
  }

  ${SettingsPermissionRow}[data-tone="attention"] & {
    border-color: rgba(223, 165, 90, 0.32);
    color: rgba(252, 201, 126, 0.96);
    background: rgba(121, 80, 28, 0.22);
  }

  ${SettingsPermissionRow}[data-tone="ready"] & {
    border-color: rgba(91, 196, 125, 0.28);
    color: rgba(124, 220, 154, 0.96);
    background: rgba(34, 92, 57, 0.2);
  }
`;

export const SettingsPermissionMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 10px;
`;

export const SettingsPermissionTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

export const SettingsPermissionCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;
`;

export const SettingsPermissionStatus = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid var(--settings-border, rgba(125, 160, 205, 0.2));
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--settings-control-bg, rgba(12, 17, 25, 0.56));
  font-size: 11px;
  font-weight: 820;
  letter-spacing: 0.04em;
  text-transform: uppercase;

  &[data-tone="ready"] {
    border-color: rgba(91, 196, 125, 0.34);
    color: rgba(124, 220, 154, 0.95);
    background: rgba(38, 118, 71, 0.14);
  }

  &[data-tone="attention"] {
    border-color: rgba(223, 165, 90, 0.36);
    color: rgba(252, 201, 126, 0.96);
    background: rgba(121, 80, 28, 0.16);
  }
`;

export const SettingsPermissionActions = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;

  button {
    min-height: 34px;
  }
`;

export const SettingsPermissionHighlight = styled.span`
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  border: 2px solid rgba(250, 204, 21, 0.98);
  border-radius: inherit;
  box-shadow:
    0 0 15px 4px rgba(250, 204, 21, 0.58),
    0 0 38px 10px rgba(250, 204, 21, 0.3),
    inset 0 0 20px rgba(250, 204, 21, 0.22);
  opacity: 0;
  animation: ${settingsPermissionPulse} 2s ease-in-out infinite;
`;

export const AccountSettingsPanel = styled.section`
  display: grid;
  gap: 10px;
  padding-top: 0;
`;

export const AccountCard = styled.section`
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--settings-panel-bg-soft, rgba(17, 22, 29, 0.78));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  &[data-tone="blue"] {
    border-color: var(--settings-border, rgba(125, 160, 205, 0.18));
  }

  &[data-tone="orange"] {
    border-color: rgba(223, 165, 90, 0.22);
  }
`;

export const AccountCardHeader = styled.div`
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

export const AccountCardFooter = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 0;

  button {
    min-height: 36px;
    min-width: 120px;
  }

  @media (max-width: 760px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

export const SettingsLabel = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

export const SettingsValue = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--forge-text);
  font-size: 16px;
  font-weight: 720;
  line-height: 1.25;
`;

export const SettingsHint = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--forge-text-soft);
  font-size: 12px;
  line-height: 1.45;
`;

export const SettingsIdentityGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const SettingsIdentityItem = styled.div`
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--settings-panel-bg-muted, rgba(21, 27, 35, 0.5));

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const SettingsRepoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
`;

export const SettingsRepoCard = styled.button`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 9px;
  align-items: center;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  background: var(--settings-panel-bg-muted, rgba(10, 14, 20, 0.58));
  color: var(--forge-text);
  cursor: pointer;
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  &:hover:not(:disabled),
  &[data-selected="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.62);
    background: rgba(var(--forge-tint-rgb), 0.18);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled),
  html[data-forge-theme="light"] &[data-selected="true"] {
    background: rgba(var(--forge-tint-rgb), 0.1);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.68;
  }

  svg {
    grid-row: 1 / span 2;
    width: 17px;
    height: 17px;
    color: var(--forge-tint);
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    font-weight: 740;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-soft);
    font-size: 11px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const CreditUsageTrack = styled.div`
  position: relative;
  width: 100%;
  height: 8px;
  overflow: hidden;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 999px;
  background: var(--settings-panel-bg-muted, rgba(10, 14, 20, 0.62));

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.08);
  }
`;

export const CreditUsageFill = styled.div`
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(70, 167, 118, 0.95), rgba(223, 165, 90, 0.96));
  transition: width 180ms ease;
`;

export const LowCreditWarningToast = styled.aside`
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 80;
  display: flex;
  max-width: min(440px, calc(100vw - 44px));
  min-width: min(360px, calc(100vw - 44px));
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
  border: 1px solid rgba(223, 165, 90, 0.32);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
  background:
    linear-gradient(180deg, rgba(223, 165, 90, 0.13), rgba(223, 165, 90, 0.04)),
    rgba(20, 24, 31, 0.96);

  html[data-forge-theme="light"] & {
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
    background:
      linear-gradient(180deg, rgba(214, 137, 36, 0.12), rgba(214, 137, 36, 0.04)),
      var(--forge-surface);
  }

  @media (max-width: 760px) {
    right: 12px;
    bottom: 12px;
    left: 12px;
    max-width: none;
    min-width: 0;
    align-items: stretch;
    flex-direction: column;
  }
`;

export const LowCreditWarningCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
`;

export const LowCreditWarningActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;

  button {
    min-height: 34px;
  }

  @media (max-width: 760px) {
    justify-content: stretch;

    button {
      flex: 1;
    }
  }
`;

export const AppearanceThemeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const AppearanceThemeButton = styled.button`
  display: grid;
  min-width: 0;
  min-height: 72px;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--settings-border-soft, var(--forge-border));
  border-radius: 8px;
  color: var(--forge-text-soft);
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    var(--settings-panel-bg-muted, rgba(21, 27, 35, 0.56));
  text-align: left;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;

  &:hover {
    border-color: var(--settings-border-strong, var(--forge-border-strong));
    color: var(--forge-text);
    background:
      linear-gradient(180deg, rgba(244, 247, 250, 0.042), rgba(244, 247, 250, 0.014)),
      var(--settings-control-bg-hover, rgba(21, 27, 35, 0.72));
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }

  &:disabled:hover {
    border-color: var(--settings-border-soft, var(--forge-border));
    color: var(--forge-text-soft);
    background:
      linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
      var(--settings-panel-bg-muted, rgba(21, 27, 35, 0.56));
  }

  &[data-selected="true"] {
    border-color: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.38);
    color: var(--forge-text);
    background:
      linear-gradient(180deg, rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.12), rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.045)),
      var(--settings-control-bg, rgba(21, 27, 35, 0.82));
    box-shadow:
      inset 0 0 0 1px rgba(var(--settings-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.12),
      0 0 18px rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.08);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  html[data-forge-theme="light"] &:hover {
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    border-color: rgba(var(--forge-tint-rgb), 0.34);
    background: rgba(var(--forge-tint-rgb), 0.08);
    box-shadow: none;
  }

  > span {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border: 1px solid var(--settings-border-soft, var(--forge-border));
    border-radius: 8px;
    color: var(--forge-text-muted);
    background: rgba(var(--settings-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.04);
  }

  &[data-selected="true"] > span {
    border-color: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.34);
    color: var(--settings-accent-soft, var(--forge-tint-soft));
    background: rgba(var(--settings-accent-rgb, var(--forge-tint-rgb)), 0.1);
  }

  svg {
    width: 18px;
    height: 18px;
  }

  strong,
  small {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: inherit;
    font-size: 13px;
    font-weight: 760;
    line-height: 1.25;
  }

  small {
    margin-top: 4px;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 650;
    line-height: 1.35;
  }
`;

export const LoginCard = styled.section`
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

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: rgba(255, 255, 255, 0.9);
    box-shadow: none;
  }

  @media (max-width: 860px) {
    padding: 24px;
  }
`;

export const LoginPanel = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

export const SessionPanel = styled.div`
  display: grid;
  gap: 16px;
`;

export const LoginCardTop = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
`;

export const LoginCardBadge = styled.span`
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

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.2);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  html[data-forge-theme="light"] &[data-state="waiting"],
  html[data-forge-theme="light"] &[data-state="exchanging"] {
    border-color: rgba(0, 102, 204, 0.2);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

export const LoginIconWrap = styled.span`
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

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
    box-shadow: none;
  }
`;

export const SuccessBadge = styled(LoginIconWrap)`
  border-color: rgba(255, 122, 24, 0.42);
  color: #ff9a3d;
  background: rgba(255, 122, 24, 0.14);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

export const SessionTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: clamp(21px, 3.5vh, 24px);
  font-weight: 820;
  letter-spacing: 0;

  html[data-forge-theme="light"] & {
    color: var(--forge-text);
  }
`;

export const SessionText = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #a7b2c2;
  font-size: 15px;
  line-height: 1.55;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

export const AuthStepRail = styled.div`
  display: grid;
  gap: 9px;
  padding: clamp(10px, 2vh, 14px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }

  &[data-compact="true"] {
    width: min(520px, 92%);
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
    padding: 8px;
  }
`;

export const AuthStep = styled.div`
  display: grid;
  min-height: 38px;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: start;
  column-gap: 10px;
  row-gap: 2px;
  color: #a7b2c2;
  font-size: 12px;
  font-weight: 800;
  opacity: 0;
  animation: ${panelEnter} 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }

  &:nth-child(1) {
    animation-delay: 170ms;
  }

  &:nth-child(2) {
    animation-delay: 205ms;
  }

  &:nth-child(3) {
    animation-delay: 240ms;
  }

  &:nth-child(4) {
    animation-delay: 275ms;
  }

  &:nth-child(5) {
    animation-delay: 310ms;
  }

  span {
    display: grid;
    width: 24px;
    height: 24px;
    grid-row: 1 / span 2;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #687386;
    background: rgba(255, 255, 255, 0.04);
    font-size: 11px;
  }

  html[data-forge-theme="light"] & span {
    border-color: var(--forge-border);
    color: var(--forge-text-muted);
    background: var(--forge-surface);
  }

  svg {
    width: 14px;
    height: 14px;
  }

  strong,
  small {
    min-width: 0;
    grid-column: 2;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    color: inherit;
    font-size: 12px;
    line-height: 1.2;
    white-space: nowrap;
  }

  small {
    color: #7f8a9b;
    font-size: 11px;
    font-weight: 650;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  ${AuthStepRail}[data-compact="true"] & {
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    row-gap: 4px;
    text-align: center;
  }

  ${AuthStepRail}[data-compact="true"] & span {
    width: 22px;
    height: 22px;
    grid-row: auto;
  }

  ${AuthStepRail}[data-compact="true"] & strong {
    grid-column: 1;
    font-size: 10px;
    line-height: 1.15;
    white-space: normal;
  }

  ${AuthStepRail}[data-compact="true"] & small {
    display: none;
  }

  html[data-forge-theme="light"] & small {
    color: var(--forge-text-muted);
  }

  &[data-active="true"],
  &[data-state="active"],
  &[data-state="complete"] {
    color: #f7f9ff;
  }

  html[data-forge-theme="light"] &[data-active="true"],
  html[data-forge-theme="light"] &[data-state="active"],
  html[data-forge-theme="light"] &[data-state="complete"] {
    color: var(--forge-text);
  }

  &[data-active="true"] span,
  &[data-state="active"] span,
  &[data-state="complete"] span {
    border-color: rgba(47, 128, 255, 0.42);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }

  html[data-forge-theme="light"] &[data-active="true"] span,
  html[data-forge-theme="light"] &[data-state="active"] span,
  html[data-forge-theme="light"] &[data-state="complete"] span {
    border-color: rgba(0, 102, 204, 0.24);
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-state="warning"] span,
  &[data-state="error"] span {
    border-color: rgba(255, 122, 24, 0.42);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.14);
  }

  &[data-state="error"] {
    color: #ffd0d0;
  }

  &[data-state="error"] span {
    border-color: rgba(255, 107, 107, 0.42);
    color: #ffb1b1;
    background: rgba(255, 107, 107, 0.14);
  }
`;

export const PrimaryButton = styled.button`
  display: inline-flex;
  min-width: 0;
  min-height: clamp(44px, 6.5vh, 50px);
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(125, 160, 205, 0.22);
  border-radius: 8px;
  color: #ffffff;
  background: var(--forge-blue);
  font-weight: 760;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    background: var(--forge-blue-soft);
    box-shadow: 0 0 18px rgba(var(--forge-tint-rgb), 0.2);
    transform: translateY(-1px);
  }

  html[data-forge-theme="light"] & {
    border-color: transparent;
    border-radius: 999px;
    background: var(--forge-blue);
    box-shadow: none;
    font-weight: 400;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    background: var(--forge-blue-soft);
    box-shadow: none;
    transform: none;
  }

  html[data-forge-theme="light"] &:active:not(:disabled) {
    transform: scale(0.95);
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

export const SecondaryButton = styled(PrimaryButton)`
  border: 1px solid var(--forge-border);
  color: var(--forge-text);
  background: rgba(21, 27, 35, 0.76);

  &[data-padding="wide"] {
    padding-inline: 18px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(125, 160, 205, 0.34);
    background: var(--forge-surface-hover);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text-soft);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(0, 0, 0, 0.12);
    color: var(--forge-text);
    background: var(--forge-surface);
  }
`;

/* Deliberately understated: a quiet escape hatch under the primary sign-in
   action, only shown to returning users. */
export const SignInOfflineButton = styled.button`
  margin-top: 12px;
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  opacity: 0.55;
  transition:
    opacity 150ms ease,
    color 150ms ease,
    background 150ms ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
    color: var(--forge-text-soft);
    background: rgba(148, 163, 184, 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgba(96, 165, 250, 0.55);
    outline-offset: 2px;
    opacity: 0.9;
  }
`;

export const PrimaryDangerButton = styled(SecondaryButton)`
  border-color: rgba(239, 107, 107, 0.28);
  color: #ffc8c8;

  &:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.48);
    background: rgba(239, 107, 107, 0.1);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(180, 35, 24, 0.2);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.06);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(180, 35, 24, 0.32);
    background: rgba(180, 35, 24, 0.09);
  }
`;

export const FormMessage = styled.p`
  margin: 0;
  padding: ${({ $state }) => ($state === "error" ? "11px 13px" : 0)};
  border: ${({ $state }) => ($state === "error" ? "1px solid rgba(239, 107, 107, 0.34)" : 0)};
  border-radius: ${({ $state }) => ($state === "error" ? "8px" : 0)};
  color: ${({ $state }) => ($state === "error" ? "#ffc8c8" : "var(--forge-text-soft)")};
  background: ${({ $state }) => ($state === "error" ? "rgba(239, 107, 107, 0.12)" : "transparent")};
  font-size: 14px;
  line-height: 1.55;

  html[data-forge-theme="light"] & {
    border-color: ${({ $state }) => ($state === "error" ? "rgba(180, 35, 24, 0.2)" : 0)};
    color: ${({ $state }) => ($state === "error" ? "var(--forge-red)" : "var(--forge-text-soft)")};
    background: ${({ $state }) => ($state === "error" ? "rgba(180, 35, 24, 0.06)" : "transparent")};
  }
`;

export const buttonIconSize = `
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
`;

export const titleIconSize = `
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
`;

export const TitleBackgroundIcon = styled(TitleBackgroundGlyph)`
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
`;

export const WindowBackgroundPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: center;
  padding: 3px 10px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.24);
  border-radius: 999px;
  color: var(--forge-tint-soft);
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.055), rgba(var(--forge-tint-rgb), 0.018)),
    rgba(7, 10, 16, 0.72);
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 220ms ease,
    border-color 220ms ease,
    color 220ms ease;

  &:hover {
    color: #ffffff;
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.09), rgba(var(--forge-tint-rgb), 0.03)),
      rgba(10, 14, 22, 0.82);
  }

  &[data-platform="macos"] {
    order: 4;
    margin-left: 10px;
  }

  &[data-platform="windows"],
  &[data-platform="linux"] {
    margin-right: 8px;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.24);
    color: var(--forge-tint);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.04), rgba(var(--forge-tint-rgb), 0.015)),
      rgba(255, 255, 255, 0.78);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--forge-tint);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.065), rgba(var(--forge-tint-rgb), 0.025)),
      rgba(255, 255, 255, 0.9);
  }
`;

const windowSyncRainbowSpin = keyframes`
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
`;

export const WindowSyncPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: center;
  padding: 3px 10px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  color: rgba(203, 213, 225, 0.88);
  background: rgba(100, 116, 139, 0.12);
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease,
    transform 150ms ease;

  &:hover {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.3);
    color: #ffffff;
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.065), rgba(var(--forge-tint-rgb), 0.02)),
      rgba(10, 14, 22, 0.78);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-tint-soft-rgb), 0.72);
    outline-offset: 2px;
  }

  &[data-state="live"] {
    border-color: rgba(74, 222, 128, 0.34);
    color: rgba(187, 247, 208, 0.95);
    background: rgba(34, 197, 94, 0.12);
  }

  /* Free + authenticated → "Upgrade" pill with an animated rainbow ring. The
     ring is a single rotating conic-gradient layer (compositor-only transform,
     promoted with will-change), clipped to the pill, with a solid inner fill
     leaving a ~1.5px rainbow border — so it stays cheap despite being lively. */
  &[data-state="upgrade"] {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    border-color: transparent;
    color: #ffffff;
    background: rgba(13, 17, 23, 0.92);
  }

  &[data-state="upgrade"]::before {
    content: "";
    position: absolute;
    z-index: -2;
    top: 50%;
    left: 50%;
    width: 240%;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    background: conic-gradient(
      from 0deg,
      #ff5d5d,
      #ffd35d,
      #74ff9e,
      #5dd4ff,
      #9a5dff,
      #ff5dce,
      #ff5d5d
    );
    animation: ${windowSyncRainbowSpin} 4s linear infinite;
    will-change: transform;
  }

  &[data-state="upgrade"]::after {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 1.5px;
    border-radius: inherit;
    background: rgba(13, 17, 23, 0.92);
  }

  &[data-state="upgrade"]:hover {
    border-color: transparent;
    background: rgba(13, 17, 23, 0.92);
  }

  &[data-state="upgrade"]:hover::after {
    background: rgba(24, 30, 40, 0.92);
  }

  &[data-state="syncing"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.26);
    color: var(--forge-tint-soft);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.06), rgba(var(--forge-tint-rgb), 0.02)),
      rgba(7, 10, 16, 0.72);
  }

  &[data-state="provisioning"] {
    border-color: rgba(255, 170, 92, 0.4);
    color: rgba(255, 214, 170, 0.95);
    background: rgba(255, 122, 24, 0.14);
  }

  &[data-state="offline"],
  &[data-state="blocked"] {
    border-color: rgba(248, 113, 113, 0.4);
    color: rgba(254, 202, 202, 0.95);
    background: rgba(239, 68, 68, 0.12);
  }

  &[data-state="upgrade"] {
    border-color: rgba(255, 170, 92, 0.4);
    color: rgba(255, 214, 170, 0.95);
    background: rgba(255, 122, 24, 0.14);
    cursor: pointer;
  }

  &[data-state="upgrade"]:hover {
    color: #ffffff;
    background: rgba(255, 122, 24, 0.32);
  }

  &[data-platform="macos"] {
    order: 5;
    margin-left: 8px;
  }

  &[data-platform="windows"],
  &[data-platform="linux"] {
    margin-right: 8px;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.32);
    color: rgba(71, 85, 105, 0.92);
    background: rgba(100, 116, 139, 0.08);
  }

  html[data-forge-theme="light"] &[data-state="live"] {
    border-color: rgba(22, 163, 74, 0.32);
    color: rgba(21, 128, 61, 0.95);
    background: rgba(34, 197, 94, 0.1);
  }

  html[data-forge-theme="light"] &[data-state="syncing"] {
    border-color: rgba(var(--forge-tint-rgb), 0.26);
    color: var(--forge-tint);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), rgba(var(--forge-tint-rgb), 0.018)),
      rgba(255, 255, 255, 0.86);
  }

  html[data-forge-theme="light"] &[data-state="provisioning"] {
    border-color: rgba(234, 88, 12, 0.36);
    color: rgba(194, 65, 12, 0.95);
    background: rgba(255, 122, 24, 0.1);
  }

  html[data-forge-theme="light"] &[data-state="offline"],
  html[data-forge-theme="light"] &[data-state="blocked"] {
    border-color: rgba(220, 38, 38, 0.35);
    color: rgba(185, 28, 28, 0.95);
    background: rgba(239, 68, 68, 0.1);
  }

  html[data-forge-theme="light"] &[data-state="upgrade"] {
    border-color: rgba(234, 88, 12, 0.36);
    color: rgba(194, 65, 12, 0.95);
    background: rgba(255, 122, 24, 0.1);
  }

  html[data-forge-theme="light"] &[data-state="upgrade"]:hover {
    color: rgba(154, 52, 18, 1);
    background: rgba(255, 122, 24, 0.2);
  }
`;

export const WindowSyncDirectionCounts = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 1px;
`;

export const WindowSyncDirectionCount = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 20px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  color: currentColor;
  background: rgba(255, 255, 255, 0.1);
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;

  span {
    font-size: 9px;
    line-height: 1;
  }

  b {
    font: inherit;
  }

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.08);
  }
`;

/* Only the spinner variant animates. The dot variant (steady states: live,
   local, blocked, offline) is a uniform filled circle whose rotation is
   invisible anyway — leaving it static means that when nothing else is
   animating, the whole webview rendering pipeline can idle (no per-frame
   compositor commit, display-link tick, or animation-timeline evaluation),
   instead of being kept awake 24/7 by an invisible spin. The spinner restarts
   cleanly from 0deg when sync actually starts (connecting/provisioning/
   syncing), which is imperceptible since the dot showed no motion. */
export const WindowSyncPillIndicator = styled.span`
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;

  &[data-variant="spinner"] {
    animation: ${workspaceCloseSpin} 0.8s linear infinite;
    will-change: transform;
  }

  &[data-variant="dot"] {
    width: 6px;
    height: 6px;
    border: none;
    background: currentColor;
  }
`;

export const TitleMinimizeIcon = styled(Remove)`
  ${titleIconSize}
`;

export const TitleMaximizeIcon = styled(CropSquare)`
  ${titleIconSize}
`;

export const TitleRestoreIcon = styled(FullscreenExit)`
  ${titleIconSize}
`;

export const TitleCloseIcon = styled(Close)`
  ${titleIconSize}
`;

export const ButtonRefreshIcon = styled(Refresh)`
  ${buttonIconSize}
`;

export const ButtonSplitHorizontalIcon = styled(LayoutSplit)`
  ${buttonIconSize}
`;

export const ButtonSplitVerticalIcon = styled(LayoutRow)`
  ${buttonIconSize}
`;

export const ButtonDragIcon = styled(DragIndicator)`
  ${buttonIconSize}
`;

export const ButtonFullscreenIcon = styled(Fullscreen)`
  ${buttonIconSize}
`;

export const ButtonFullscreenExitIcon = styled(FullscreenExit)`
  ${buttonIconSize}
`;

export const ButtonAddIcon = styled(Add)`
  ${buttonIconSize}
`;

export const ButtonArchiveIcon = styled(Archive)`
  ${buttonIconSize}
`;

export const ButtonBackIcon = styled(ArrowBack)`
  ${buttonIconSize}
`;

export const ButtonForwardIcon = styled(ArrowForward)`
  ${buttonIconSize}
`;

export const ButtonPolishIcon = styled(AutoFixHigh)`
  ${buttonIconSize}
`;

export const ButtonLoginIcon = styled(Login)`
  ${buttonIconSize}
`;

export const ButtonBrowserIcon = styled(OpenInBrowser)`
  ${buttonIconSize}
`;

export const ButtonAssetsIcon = styled(CloudDone)`
  ${buttonIconSize}
`;

export const ButtonCloseIcon = styled(Close)`
  ${buttonIconSize}
`;

export const ButtonCopyIcon = styled(ContentCopy)`
  ${buttonIconSize}
`;

export const ButtonDeleteIcon = styled(DeleteOutline)`
  ${buttonIconSize}
`;

export const ButtonDarkModeIcon = styled(DarkMode)`
  ${buttonIconSize}
`;

export const ButtonFolderIcon = styled(FolderOpen)`
  ${buttonIconSize}
`;

export const ButtonLogoutIcon = styled(Logout)`
  ${buttonIconSize}
`;

export const ButtonSettingsIcon = styled(Settings)`
  ${buttonIconSize}
`;

export const ButtonForgeIcon = styled(AccountTree)`
  ${buttonIconSize}
`;

export const ButtonCodeIcon = styled(Code)`
  ${buttonIconSize}
`;

export const ButtonBotIcon = styled(SmartToy)`
  ${buttonIconSize}
`;

export const ButtonTerminalIcon = styled(TerminalIcon)`
  ${buttonIconSize}
`;

export const ButtonKeyIcon = styled(Key)`
  ${buttonIconSize}
`;

export const ButtonLightModeIcon = styled(LightMode)`
  ${buttonIconSize}
`;

export const ButtonMicIcon = styled(Mic)`
  ${buttonIconSize}
`;

export const ButtonMicOffIcon = styled(MicOff)`
  ${buttonIconSize}
`;

export const ButtonNotificationIcon = styled(NotificationsActive)`
  ${buttonIconSize}
`;

export const ButtonPrivacyIcon = styled(PrivacyTip)`
  ${buttonIconSize}
`;

export const ButtonSecurityIcon = styled(Security)`
  ${buttonIconSize}
`;

export const ButtonProcessIcon = styled(Memory)`
  ${buttonIconSize}
`;

export const ButtonSnippingIcon = styled(ContentCut)`
  ${buttonIconSize}
`;

export const ButtonEditorIcon = styled(Movie)`
  ${buttonIconSize}
`;

export const ButtonHubIcon = styled(Hub)`
  ${buttonIconSize}
`;

export const ButtonCheckIcon = styled(CheckCircle)`
  ${buttonIconSize}
`;

export const ButtonRailCollapseIcon = styled(KeyboardDoubleArrowLeft)`
  ${buttonIconSize}
`;

export const ButtonRailExpandIcon = styled(KeyboardDoubleArrowRight)`
  ${buttonIconSize}
`;

export const FileChevronIcon = styled(ChevronRight)`
  width: 16px;
  height: 14px;
`;

export const FileExpandIcon = styled(ExpandMore)`
  width: 16px;
  height: 16px;
`;

export const FileFolderTreeIcon = styled(FolderOpen)`
  width: 16px;
  height: 16px;
`;

export const FileDocumentIcon = styled(Description)`
  width: 16px;
  height: 16px;
`;

// --- Inline create-workspace panel (replaces the old modal) ---

export const WorkspaceCreateLayer = styled(WorkspaceRuntimeLayer)`
  &[data-visible="true"] {
    z-index: 3;
  }
`;

export const WorkspaceCreateSurface = styled.div`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  place-items: start center;
  padding: 28px 24px;
  overflow: auto;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), transparent 22rem),
    var(--forge-shell-right-bg);
`;

export const WorkspaceCreateCard = styled.form`
  display: grid;
  width: min(720px, 100%);
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--forge-border);
  border-radius: 14px;
  background: var(--forge-surface);
`;

export const WorkspaceCreateHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

export const WorkspaceCreateSection = styled.section`
  display: grid;
  gap: 9px;
`;

export const WorkspaceCreatePathBar = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 9px;
  background: var(--forge-surface-control);
`;

export const WorkspaceCreatePathText = styled.code`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text);
  direction: rtl;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
`;

export const WorkspaceCreatePathBadge = styled.span`
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: ${({ $tone }) => ($tone === "good" ? "#7bdc9d" : $tone === "warn" ? "#f5c466" : "var(--forge-text-muted, rgba(244,247,250,0.6))")};
  background: rgba(255, 255, 255, 0.03);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
`;

export const WorkspaceCreateCdForm = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-bg-deep);

  &:focus-within {
    border-color: rgba(138, 216, 255, 0.34);
  }
`;

export const WorkspaceCreateCdInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  color: var(--forge-text);
  background: transparent;
  outline: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;

  &::placeholder {
    color: rgba(244, 247, 250, 0.32);
  }
`;

export const WorkspaceCreateDirGrid = styled.div`
  display: flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  gap: 7px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 1px 7px;
  scrollbar-gutter: stable;
  overscroll-behavior-inline: contain;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;

  &:focus-visible {
    outline: 2px solid rgba(138, 216, 255, 0.38);
    outline-offset: 2px;
  }
`;

export const WorkspaceCreateDirChip = styled.button`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  flex: 0 0 auto;
  max-width: min(190px, 42vw);
  min-width: 0;
  min-height: 36px;
  scroll-snap-align: start;
  padding: 7px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  color: var(--forge-text);
  background: var(--forge-surface-raised);
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
  transition: border-color 120ms ease, background 120ms ease;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    opacity: 0.7;
  }

  &:hover:not(:disabled) {
    border-color: rgba(138, 216, 255, 0.3);
    background: var(--forge-surface-hover);
  }

  &[data-up="true"] {
    color: rgba(244, 247, 250, 0.72);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

export const WorkspaceCreateAgentGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  gap: 8px;
`;

export const WorkspaceCreateAgentCard = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "icon . status"
    "body body body"
    ". . stepper";
  align-items: start;
  gap: 8px 9px;
  min-height: 116px;
  padding: 10px 11px;
  border: 1px solid ${({ $active }) => ($active ? "rgba(138, 216, 255, 0.34)" : "var(--forge-border)")};
  border-radius: 10px;
  background: ${({ $active }) => ($active ? "var(--forge-surface-selected)" : "var(--forge-surface-raised)")};
  transition: border-color 120ms ease, background 120ms ease;

  &[data-unavailable="true"] {
    opacity: 0.55;
  }
`;

export const WorkspaceCreateAgentIcon = styled.span`
  grid-area: icon;
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  color: var(--forge-text);
  background: var(--forge-bg-deep);

  &[data-agent="codex"] {
    color: #f5f7fa;
    background: linear-gradient(145deg, #11161d, #030405);
  }

  &[data-agent="claude"] {
    background: rgba(217, 119, 87, 0.11);
    border-color: rgba(217, 119, 87, 0.28);
  }

  &[data-agent="generic"] {
    color: #a9d6ff;
    background: rgba(79, 163, 255, 0.09);
    border-color: rgba(79, 163, 255, 0.24);
  }

  &[data-agent="opencode"] {
    background: rgba(241, 236, 236, 0.07);
    border-color: rgba(241, 236, 236, 0.2);
  }

  > svg {
    display: block;
    max-width: 26px;
    max-height: 26px;
  }
`;

export const WorkspaceCreateAgentCodexIcon = styled(CodexBrandGlyph)`
  width: 22px;
  height: 22px;
  fill: currentColor;
`;

export const WorkspaceCreateAgentClaudeIcon = styled(ClaudeBrandGlyph)`
  width: 24px;
  height: 24px;
`;

export const WorkspaceCreateAgentTerminalIcon = styled(AgentTerminalGlyph)`
  width: 22px;
  height: 22px;
`;

export const WorkspaceCreateAgentOpenCodeIcon = styled.svg`
  width: 22px;
  height: 28px;
`;

export const WorkspaceCreateAgentBody = styled.div`
  grid-area: body;
  display: grid;
  min-width: 0;
  align-self: end;
`;

export const WorkspaceCreateAgentLabel = styled.div`
  display: grid;
  min-width: 0;

  > strong {
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 800;
    line-height: 1.12;
    overflow-wrap: anywhere;
    white-space: normal;
  }
`;

export const WorkspaceCreateAgentStatus = styled.span`
  grid-area: status;
  justify-self: end;
  align-self: start;
  max-width: 100%;
  overflow: hidden;
  color: rgba(244, 247, 250, 0.58);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  line-height: 1.1;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

export const WorkspaceCreateAgentStepper = styled.div`
  grid-area: stepper;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  justify-self: end;
  align-self: end;
  min-width: 82px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  background: var(--forge-bg-deep);

  > strong {
    min-width: 20px;
    color: var(--forge-text);
    text-align: center;
    font-size: 12.5px;
    font-weight: 800;
  }
`;

export const WorkspaceCreateAgentStepButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 999px;
  color: var(--forge-text);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;

  &:hover:not(:disabled) {
    background: var(--forge-surface-hover);
  }

  &:disabled {
    cursor: default;
    opacity: 0.35;
  }
`;

export const WorkspaceCreatePreviewRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 22px;
`;

export const WorkspaceCreatePreviewDot = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 5px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text);
  background: var(--forge-bg-deep);
  font-size: 10.5px;
  font-weight: 750;

  &::before {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: ${({ $color }) => $color || "#8bb8ff"};
    content: "";
  }
`;

export const WorkspaceCreateFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const WorkspaceArchiveList = styled.div`
  display: grid;
  gap: 9px;
`;

export const WorkspaceArchiveRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 11px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface-raised);

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
`;

export const WorkspaceArchiveMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
`;

export const WorkspaceArchiveTitle = styled.strong`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const WorkspaceArchivePath = styled.code`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  direction: rtl;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
`;

export const WorkspaceArchiveActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
`;
