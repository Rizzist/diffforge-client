import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useNativeWebview } from "../web/webNative.js";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { AutoAwesome } from "@styled-icons/material-rounded/AutoAwesome";
import { Close } from "@styled-icons/material-rounded/Close";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { PermMedia } from "@styled-icons/material-rounded/PermMedia";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";
import AgentActivityPanel from "./AgentActivityPanel.jsx";
import MediaBin from "./MediaBin.jsx";
import Timeline from "./Timeline.jsx";
import VideoEditor from "./VideoEditor.jsx";
import GeneratePanel from "./GeneratePanel.jsx";
import ExportPanel from "./ExportPanel.jsx";
import { createPlaybackStore } from "./videoPlaybackStore.js";
import {
  VIDEO_DESCRIBE_PROGRESS_EVENT,
  VIDEO_GENERATE_PROGRESS_EVENT,
  VIDEO_PROJECT_DELETED_EVENT,
  VIDEO_STORE_CHANGED_EVENT,
  VIDEO_TOOLS_INSTALL_PROGRESS_EVENT,
  VIDEO_TRANSCRIBE_PROGRESS_EVENT,
} from "./videoPanelBridge.js";
import {
  AUTO_DESCRIBE_CREDITS_FLOOR,
  GENERATION_SETTINGS_EVENT,
  readAutoDescribeEnabled,
  readGenerationRouting,
} from "./generationCatalog.js";
import TranscriptPanel from "./TranscriptPanel.jsx";
import {
  addCaptionsForClip,
  addMediaClip,
  clipsInRange,
  formatTimecode,
  normalizeProject,
  rippleDeleteWords,
  updateClip,
} from "./videoEditorModel.js";
import AssetPanel from "./AssetPanel.jsx";
import {
  VideoCard,
  VideoErrorText,
  VideoHint,
  VideoIconButton,
  VideoInput,
  VideoPaneButton,
  VideoProgressFill,
  VideoProgressTrack,
  VideoRail,
  VideoRailButton,
  VideoRailDivider,
  VideoRailSpacer,
  VideoRailTitle,
  VideoSecondaryButton,
  VideoSheet,
  VideoSheetBody,
  VideoSheetHeader,
} from "./videoStyles.js";

const SLOT_STORAGE_PREFIX = "diffforge.video.gridPaneSlot.";
const LAYOUT_STORAGE_PREFIX = "diffforge.video.paneLayout.";

// Right-click menu for hyperframes code clips (open source / preview / re-render).
const ClipMenu = styled.div`
  position: fixed;
  z-index: 60;
  min-width: 200px;
  display: grid;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 9px;
  background: rgba(7, 12, 22, 0.98);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(15, 23, 42, 0.14);
    box-shadow: 0 14px 34px rgba(15, 23, 42, 0.18);
  }
`;

const ClipMenuItem = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  text-align: left;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 650;
  color: rgba(226, 232, 240, 0.94);
  cursor: pointer;

  &:hover {
    background: rgba(37, 99, 235, 0.2);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }

  html[data-forge-theme="light"] & {
    color: #1e293b;
  }
`;

const ClipMenuHint = styled.div`
  padding: 4px 9px 5px;
  font-size: 9px;
  font-weight: 600;
  color: #8fa0b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
`;

const CodePreviewViewport = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  background: #05070c;
`;

// Live Hyperframes Studio preview for a composition, embedded as a native
// child webview over a sheet-sized viewport (same machinery as web panes).
function CodePreviewSheet({ repoPath, sourcePath, onClose }) {
  const viewportRef = useRef(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    setUrl("");
    setError("");
    invoke("video_code_preview_start", { repoPath, sourcePath })
      .then((result) => {
        if (!disposed) {
          setUrl(String(result?.url || ""));
        }
      })
      .catch((err) => {
        if (!disposed) {
          setError(String(err));
        }
      });
    return () => {
      disposed = true;
    };
  }, [repoPath, sourcePath]);

  useNativeWebview({
    viewportRef,
    url,
    visible: Boolean(url),
    enabled: Boolean(url),
    layoutKey: `video-code-preview:${sourcePath}`,
    scopeParts: ["video-code-preview", repoPath, sourcePath],
  });

  return (
    <VideoSheet>
      <VideoSheetHeader>
        Composition preview
        <VideoHint style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sourcePath}
        </VideoHint>
        <VideoRailSpacer />
        <VideoIconButton onClick={onClose} title="Close preview" type="button">
          <Close aria-hidden="true" />
        </VideoIconButton>
      </VideoSheetHeader>
      <CodePreviewViewport ref={viewportRef}>
        {error ? (
          <VideoErrorText style={{ padding: 10 }}>{error}</VideoErrorText>
        ) : !url ? (
          <VideoHint style={{ padding: 10 }}>Starting the Hyperframes preview server…</VideoHint>
        ) : null}
      </CodePreviewViewport>
    </VideoSheet>
  );
}

// Everything about the pane's surface that should survive a restart:
// which panels are open, which asset's transcript/details, and the split
// layouts (horizontal per panel-combination + the preview/timeline split).
function readLayoutPrefs(workspaceId, paneId, repoPath) {
  const key = slotStorageKey(workspaceId, paneId, repoPath).replace(SLOT_STORAGE_PREFIX, LAYOUT_STORAGE_PREFIX);
  if (!key.startsWith(LAYOUT_STORAGE_PREFIX)) {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLayoutPrefs(workspaceId, paneId, repoPath, patch) {
  const key = slotStorageKey(workspaceId, paneId, repoPath).replace(SLOT_STORAGE_PREFIX, LAYOUT_STORAGE_PREFIX);
  if (!key.startsWith(LAYOUT_STORAGE_PREFIX)) {
    return;
  }
  try {
    const current = readLayoutPrefs(workspaceId, paneId, repoPath);
    window.localStorage.setItem(key, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* persistence is best-effort */
  }
}
const AUTOSAVE_DELAY_MS = 800;
const HISTORY_LIMIT = 60;
const WIDE_MIN_WIDTH = 680;

function normalizeRepoIdentity(repoPath) {
  return String(repoPath || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizeVideoProjectIdentity(projectPath) {
  return String(projectPath || "").trim().replace(/\\/g, "/");
}

function slotStorageKey(workspaceId, paneId, repoPath) {
  const workspace = String(workspaceId || "").trim();
  const pane = String(paneId || "").trim();
  const repo = normalizeRepoIdentity(repoPath);
  return workspace && pane && repo
    ? `${SLOT_STORAGE_PREFIX}${encodeURIComponent(workspace)}.${encodeURIComponent(pane)}.${encodeURIComponent(repo)}`
    : "";
}

const PaneSurface = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  width: 100%;
  background: #020304;

  html[data-forge-theme="light"] & {
    background: #f4f6fb;
  }
`;

const PaneBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  container: video-pane / size;
`;

const SplitPanel = styled(Panel)`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;

  & > * {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
  }
`;

// Separators must be FINDABLE on a black surface: an always-visible hairline
// with a centered grip dot, widening to emerald on hover/drag.
const SplitSeparatorH = styled(Separator)`
  width: 7px;
  flex: none;
  cursor: col-resize;
  background: transparent;
  position: relative;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: rgba(148, 163, 184, 0.22);
  }

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 2px;
    width: 3px;
    height: 26px;
    transform: translateY(-50%);
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.4);
  }

  &:hover::before,
  &[data-resizing]::before {
    left: 2px;
    width: 3px;
    background: rgba(16, 185, 129, 0.55);
  }

  &:hover::after,
  &[data-resizing]::after {
    background: rgba(16, 185, 129, 0.9);
  }
`;

const SplitSeparatorV = styled(Separator)`
  height: 7px;
  flex: none;
  cursor: row-resize;
  background: transparent;
  position: relative;

  &::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 3px;
    height: 1px;
    background: rgba(148, 163, 184, 0.22);
  }

  &::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 2px;
    height: 3px;
    width: 26px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.4);
  }

  &:hover::before,
  &[data-resizing]::before {
    top: 2px;
    height: 3px;
    background: rgba(16, 185, 129, 0.55);
  }

  &:hover::after,
  &[data-resizing]::after {
    background: rgba(16, 185, 129, 0.9);
  }
`;

const EditorArea = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
`;

const AgentUnseenDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #34d399;
  flex: none;
`;

// Transient chip announcing an agent's MCP edit, with one-tap undo.
const AgentEditToast = styled.div`
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(520px, 90%);
  padding: 5px 8px 5px 12px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  border-radius: 999px;
  background: rgba(3, 12, 9, 0.95);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);

  span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 10.5px;
    font-weight: 650;
    color: #a7f3d0;
  }

  button {
    appearance: none;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: transparent;
    color: #e2e8f0;
    font-size: 10px;
    font-weight: 750;
    padding: 2px 9px;
    border-radius: 999px;
    cursor: pointer;
    flex: none;

    &:hover {
      border-color: rgba(16, 185, 129, 0.6);
    }
  }
`;

const PreviewCell = styled.div`
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  padding: 6px 8px 2px;

  & > * {
    flex: 1 1 auto;
    min-height: 0;
  }
`;

const NarrowStack = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1.2fr) minmax(96px, 1fr);
`;

const InstallChip = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(251, 191, 36, 0.4);
  background: rgba(120, 53, 15, 0.22);
  color: #fcd34d;
  font-size: 9.5px;
  font-weight: 750;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  flex: none;

  &:disabled {
    cursor: default;
    opacity: 0.85;
  }
`;

// The project menu wears a muted "cutting room" theme for the creator crowd:
// charcoal-violet backdrop, film-strip sprocket rows, quiet violet accents on
// the actions. Decoration stays under ~9% opacity so the screen never shouts,
// and everything gets a light-theme variant since the pane surface flips.
const MenuScreen = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  align-items: safe center;
  justify-content: center;
  padding: 16px;
  background:
    radial-gradient(ellipse at 14% -10%, rgba(139, 92, 246, 0.09), transparent 52%),
    radial-gradient(ellipse at 88% 114%, rgba(236, 72, 153, 0.05), transparent 55%),
    #06040c;

  &::before,
  &::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 8px;
    background: repeating-linear-gradient(
      90deg,
      rgba(196, 181, 253, 0.055) 0 12px,
      transparent 12px 24px
    );
    pointer-events: none;
  }

  &::before {
    top: 14px;
  }

  &::after {
    bottom: 14px;
  }

  html[data-forge-theme="light"] & {
    background:
      radial-gradient(ellipse at 14% -10%, rgba(139, 92, 246, 0.1), transparent 52%),
      radial-gradient(ellipse at 88% 114%, rgba(236, 72, 153, 0.07), transparent 55%),
      #eef0f8;

    &::before,
    &::after {
      background: repeating-linear-gradient(
        90deg,
        rgba(109, 40, 217, 0.07) 0 12px,
        transparent 12px 24px
      );
    }
  }

  @container video-pane (max-height: 380px) {
    padding: 10px;

    &::before,
    &::after {
      display: none;
    }
  }
`;

const MenuCard = styled(VideoCard)`
  width: min(460px, 100%);
  gap: 10px;
  padding: 14px;
  border-color: rgba(167, 139, 250, 0.16);
  background: rgba(11, 8, 20, 0.78);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42);

  html[data-forge-theme="light"] & {
    border-color: rgba(109, 40, 217, 0.16);
    background: rgba(255, 255, 255, 0.88);
    box-shadow: 0 18px 44px rgba(76, 29, 149, 0.1);
  }
`;

const MenuHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const MenuHeaderText = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;
`;

const MenuBadge = styled.div`
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(167, 139, 250, 0.32);
  border-radius: 8px;
  background: linear-gradient(160deg, rgba(139, 92, 246, 0.22), rgba(139, 92, 246, 0.06));
  color: #c4b5fd;

  svg {
    width: 16px;
    height: 16px;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(109, 40, 217, 0.28);
    background: linear-gradient(160deg, rgba(139, 92, 246, 0.16), rgba(139, 92, 246, 0.04));
    color: #6d28d9;
  }
`;

const MenuTitle = styled.div`
  font-size: 13px;
  font-weight: 850;
  color: #ede9fe;

  html[data-forge-theme="light"] & {
    color: #312e81;
  }
`;

const MenuHint = styled(VideoHint)`
  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const MenuSectionLabel = styled.div`
  font-size: 9.5px;
  font-weight: 850;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(196, 181, 253, 0.6);

  html[data-forge-theme="light"] & {
    color: rgba(91, 33, 182, 0.55);
  }
`;

const MenuCreateButton = styled(VideoPaneButton)`
  min-height: 30px;
  font-size: 12px;
  border-color: rgba(167, 139, 250, 0.38);
  background: rgba(139, 92, 246, 0.13);
  color: #ddd6fe;

  &:hover:not(:disabled) {
    background: rgba(139, 92, 246, 0.22);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(109, 40, 217, 0.35);
    background: rgba(139, 92, 246, 0.12);
    color: #5b21b6;

    &:hover:not(:disabled) {
      background: rgba(139, 92, 246, 0.2);
    }
  }
`;

const MenuInput = styled(VideoInput)`
  min-height: 30px;
  font-size: 12px;

  &:focus {
    border-color: rgba(167, 139, 250, 0.55);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.13);
  }

  html[data-forge-theme="light"] & {
    color: #1e1b4b;
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(100, 116, 139, 0.35);

    &::placeholder {
      color: rgba(100, 116, 139, 0.7);
    }
  }
`;

const RecentGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(122px, 1fr));
  gap: 7px;
  min-width: 0;

  @container video-pane (max-width: 340px) {
    grid-template-columns: 1fr;
  }
`;

const RecentCard = styled.div`
  position: relative;
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(8, 6, 16, 0.72);
  cursor: pointer;

  &:hover {
    border-color: rgba(167, 139, 250, 0.5);
    background: rgba(139, 92, 246, 0.08);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.25);
    background: rgba(255, 255, 255, 0.75);

    &:hover {
      border-color: rgba(109, 40, 217, 0.45);
      background: rgba(139, 92, 246, 0.07);
    }
  }
`;

const RecentCardName = styled.div`
  min-width: 0;
  padding-right: 16px;
  font-size: 11.5px;
  font-weight: 780;
  color: rgba(237, 233, 254, 0.94);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  html[data-forge-theme="light"] & {
    color: #1e1b4b;
  }
`;

const RecentCardMeta = styled.div`
  font-size: 9.5px;
  font-weight: 650;
  color: rgba(196, 181, 253, 0.55);
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: rgba(91, 33, 182, 0.5);
  }
`;

const RecentCardDelete = styled(VideoIconButton)`
  position: absolute;
  top: 5px;
  right: 5px;
  width: 18px;
  height: 18px;
  opacity: 0;

  svg {
    width: 11px;
    height: 11px;
  }

  ${RecentCard}:hover &,
  &:focus-visible {
    opacity: 1;
  }
`;

const ProjectRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 7px;
  background: rgba(8, 6, 16, 0.6);
  cursor: pointer;

  &:hover {
    border-color: rgba(167, 139, 250, 0.5);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.25);
    background: rgba(255, 255, 255, 0.75);

    &:hover {
      border-color: rgba(109, 40, 217, 0.45);
    }
  }
`;

const ProjectRowName = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  font-weight: 750;
  color: rgba(226, 232, 240, 0.94);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  html[data-forge-theme="light"] & {
    color: #1e1b4b;
  }
`;

const ProjectRowMeta = styled.span`
  font-size: 9.5px;
  font-weight: 650;
  color: #7d8ca3;
  white-space: nowrap;
`;

const CreateRow = styled.form`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;

  @container video-pane (max-width: 300px) {
    grid-template-columns: 1fr;
  }
`;

function formatRelativeTime(ms) {
  const at = Number(ms) || 0;
  if (!at) {
    return "";
  }
  const deltaMinutes = Math.round((Date.now() - at) / 60000);
  if (deltaMinutes < 1) {
    return "just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) {
    return `${deltaHours}h ago`;
  }
  return `${Math.round(deltaHours / 24)}d ago`;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function sameStringList(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}

function normalizeTimelineRanges(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((range) => {
      const startMs = Math.max(0, Math.round(Number(range?.startMs) || 0));
      const endMs = Math.max(0, Math.round(Number(range?.endMs) || 0));
      return {
        startMs: Math.min(startMs, endMs),
        endMs: Math.max(startMs, endMs),
      };
    })
    .filter((range) => range.endMs > range.startMs);
}

function sameTimelineRanges(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((range, index) => (
    Math.round(Number(range?.startMs) || 0) === Math.round(Number(right[index]?.startMs) || 0)
    && Math.round(Number(range?.endMs) || 0) === Math.round(Number(right[index]?.endMs) || 0)
  ));
}

// The Video Editor grid pane. Window chrome (drag/split/popout/maximize/
// close/agent toggle) comes from the TerminalView wrapper. Inside: a project
// menu screen, and an editing surface with one thin nav rail — Library /
// Generate / Export are toggleable panels around the always-visible
// preview + timeline, resizable in wide panes, overlay sheets in narrow ones.
export default function VideoWorkspacePane({
  controlCommand = null,
  createRequestNonce = 0,
  createRequestName = "",
  deleteRequestNonce = 0,
  externalProject = undefined,
  refreshRequestNonce = 0,
  isActive = false,
  onProjectChange,
  paneId = "",
  repoPath = "",
  workspaceId = "",
}) {
  const [view, setView] = useState("menu");
  const initialPrefsRef = useRef(null);
  if (initialPrefsRef.current === null) {
    initialPrefsRef.current = readLayoutPrefs(workspaceId, paneId, repoPath);
  }
  const [libraryOpen, setLibraryOpen] = useState(() => initialPrefsRef.current.libraryOpen !== false);
  const [sidePanel, setSidePanel] = useState(() =>
    ["generate", "export", "transcript", "asset"].includes(initialPrefsRef.current.sidePanel)
      ? initialPrefsRef.current.sidePanel
      : "",
  );
  const [paneWidth, setPaneWidth] = useState(0);
  const [tools, setTools] = useState(null);
  const [installProgress, setInstallProgress] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectPath, setProjectPath] = useState("");
  const [project, setProject] = useState(null);
  const [assets, setAssets] = useState([]);
  const [folders, setFolders] = useState([]);
  const [mediaRootAbs, setMediaRootAbs] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [paneError, setPaneError] = useState("");
  const [draftName, setDraftName] = useState("");
  const [selectedClipIds, setSelectedClipIds] = useState([]);
  const [ranges, setRanges] = useState([]);
  const [selectionContext, setSelectionContext] = useState("");
  const [selectedAssetPath, setSelectedAssetPath] = useState("");
  const [transcriptAsset, setTranscriptAsset] = useState(null);
  const [generateSeed, setGenerateSeed] = useState(null);
  // plannedPath → { model, percent } for jobs still running; feeds the
  // timeline's ghost-clip treatment on placeholder clips.
  const [generationByPath, setGenerationByPath] = useState({});
  const seedNonceRef = useRef(0);
  const restoredPanelAssetRef = useRef(false);

  // Hyperframes code clips: right-click menu, embedded Studio preview, and
  // re-render swaps (jobId → { oldPath, newPath } applied when the job lands).
  const [codeMenu, setCodeMenu] = useState(null);
  const [codePreviewSource, setCodePreviewSource] = useState("");
  const codeReRenderRef = useRef(new Map());

  useEffect(() => {
    if (!codeMenu) {
      return undefined;
    }
    const close = () => setCodeMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [codeMenu]);

  // Persist the surface flags whenever they change (layouts save separately,
  // debounced, from the split groups' onLayoutChanged).
  useEffect(() => {
    writeLayoutPrefs(workspaceId, paneId, repoPath, {
      libraryOpen,
      sidePanel,
      transcriptAssetPath: transcriptAsset?.path || "",
      selectedAssetPath,
    });
  }, [libraryOpen, paneId, repoPath, selectedAssetPath, sidePanel, transcriptAsset?.path, workspaceId]);

  const layoutSaveTimerRef = useRef(0);
  const pendingLayoutRef = useRef({});
  const saveGroupLayout = useCallback(
    (slot, layout) => {
      pendingLayoutRef.current[slot] = layout;
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = window.setTimeout(() => {
        const prefs = readLayoutPrefs(workspaceId, paneId, repoPath);
        const layouts = { ...(prefs.layouts || {}), ...pendingLayoutRef.current };
        pendingLayoutRef.current = {};
        writeLayoutPrefs(workspaceId, paneId, repoPath, { layouts });
      }, 300);
    },
    [paneId, repoPath, workspaceId],
  );
  useEffect(() => () => window.clearTimeout(layoutSaveTimerRef.current), []);

  const comboKey = `h:${libraryOpen ? "lib" : "nolib"}|${sidePanel ? "side" : "none"}`;
  const savedLayouts = initialPrefsRef.current.layouts || {};
  const playbackRef = useRef(null);
  if (!playbackRef.current) {
    playbackRef.current = createPlaybackStore(0);
  }
  const playback = playbackRef.current;
  const [playheadUiMs, setPlayheadUiMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const bodyRef = useRef(null);
  const controlSeenRef = useRef(0);
  const createSeenRef = useRef(0);
  const deleteSeenRef = useRef(0);
  const refreshSeenRef = useRef(0);
  const restoredKeyRef = useRef("");
  const saveTimerRef = useRef(0);
  const lastLocalWriteAtRef = useRef(0);
  const projectPathRef = useRef("");
  projectPathRef.current = projectPath;
  const createInputRef = useRef(null);
  const historyRef = useRef({ past: [], future: [] });

  const storageKey = useMemo(() => slotStorageKey(workspaceId, paneId, repoPath), [paneId, repoPath, workspaceId]);
  const externalProjectProvided = externalProject !== undefined;
  const externalProjectPath = String(externalProject?.path || "").trim();
  const ffmpegReady = Boolean(tools?.ffmpeg?.installed && tools?.ffprobe?.installed);
  const wide = paneWidth >= WIDE_MIN_WIDTH;

  const commitSeek = useCallback(
    (ms) => {
      const next = Math.max(0, Number(ms) || 0);
      playback.setMs(next);
      setPlayheadUiMs(next);
    },
    [playback],
  );

  const setPlaybackPlaying = useCallback(
    (nextPlaying) => {
      const next = Boolean(nextPlaying);
      setPlaying(next);
      playback.setPlaying(next);
      if (!next) {
        setPlayheadUiMs(playback.getMs());
      }
    },
    [playback],
  );

  const currentPlayheadMs = useCallback(() => Math.max(0, playback.getMs()), [playback]);

  useEffect(() => {
    let frame = 0;
    let lastUiSyncAt = 0;
    const unsubscribe = playback.subscribe((ms, isPlaying) => {
      if (!isPlaying) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        lastUiSyncAt = 0;
        setPlayheadUiMs(ms);
        return;
      }
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame((now) => {
        frame = 0;
        if (now - lastUiSyncAt >= 200) {
          lastUiSyncAt = now;
          setPlayheadUiMs(playback.getMs());
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [playback]);

  // Measure the pane so layout mode is a JS decision (splits vs sheets).
  useEffect(() => {
    const element = bodyRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (Number.isFinite(width)) {
        setPaneWidth(width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const refreshTools = useCallback(() => {
    invoke("video_tools_status")
      .then((status) => setTools(status || null))
      .catch(() => {});
  }, []);

  const refreshAssets = useCallback(() => {
    if (!repoPath) {
      return;
    }
    invoke("video_media_list", { repoPath })
      .then((result) => {
        setAssets(Array.isArray(result?.items) ? result.items : []);
        setMediaRootAbs(String(result?.mediaRoot || ""));
        setMediaError("");
      })
      .catch((err) => setMediaError(String(err)));
    invoke("video_media_manifest_get", { repoPath })
      .then((manifest) => setFolders(Array.isArray(manifest?.folders) ? manifest.folders : []))
      .catch(() => {});
  }, [repoPath]);

  // Auto-describe: photos without an annotation get a cloud vision blurb in
  // the background — cloud routing only, gated on the user toggle and a
  // credits floor; one image at a time, each path tried once per session so
  // failures can't loop. Completion emits video-store-changed, which
  // refreshes assets and re-runs this effect for the next candidate.
  const autoDescribeAttemptedRef = useRef(new Set());
  const autoDescribeRunningRef = useRef(false);
  const autoDescribeJobIdRef = useRef("");
  const autoDescribeBillingRef = useRef({ checkedAtMs: 0, credits: null });
  // Bumped when routing / auto-describe settings change so the queue effect
  // re-evaluates immediately instead of waiting for the next media refresh.
  const [genSettingsTick, setGenSettingsTick] = useState(0);
  useEffect(() => {
    const bump = () => setGenSettingsTick((tick) => tick + 1);
    window.addEventListener(GENERATION_SETTINGS_EVENT, bump);
    return () => window.removeEventListener(GENERATION_SETTINGS_EVENT, bump);
  }, []);
  useEffect(() => {
    if (!repoPath || autoDescribeRunningRef.current) {
      return;
    }
    if (!readAutoDescribeEnabled() || readGenerationRouting() !== "cloud") {
      return;
    }
    const candidate = assets.find(
      (item) =>
        item?.kind === "image"
        && !item.pending
        && !item.hasAnnotation
        && !autoDescribeAttemptedRef.current.has(item.path),
    );
    if (!candidate) {
      return;
    }
    autoDescribeRunningRef.current = true;
    const billing = autoDescribeBillingRef.current;
    const billingFresh = Date.now() - billing.checkedAtMs < 5 * 60 * 1000;
    (billingFresh
      ? Promise.resolve(billing.credits)
      : invoke("cloud_mcp_get_billing_status").then((status) => {
          const credits = status?.credits || {};
          const remaining = Number(
            credits.termRemainingCredits ?? credits.term_remaining_credits,
          );
          autoDescribeBillingRef.current = {
            checkedAtMs: Date.now(),
            credits: Number.isFinite(remaining) ? remaining : null,
          };
          return autoDescribeBillingRef.current.credits;
        })
    )
      .then((remaining) => {
        if (remaining == null || remaining < AUTO_DESCRIBE_CREDITS_FLOOR) {
          autoDescribeRunningRef.current = false;
          return undefined;
        }
        autoDescribeAttemptedRef.current.add(candidate.path);
        return invoke("video_describe_start", { repoPath, path: candidate.path }).then(
          (result) => {
            autoDescribeJobIdRef.current = result?.jobId || "";
          },
        );
      })
      .catch(() => {
        autoDescribeAttemptedRef.current.add(candidate.path);
        autoDescribeRunningRef.current = false;
      });
  }, [assets, genSettingsTick, repoPath]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_DESCRIBE_PROGRESS_EVENT, (event) => {
      // Only our own queue job frees the slot — a manual describe from the
      // asset panel finishing must not let the queue double-run.
      if (
        !disposed
        && event?.payload?.done
        && event.payload.jobId
        && event.payload.jobId === autoDescribeJobIdRef.current
      ) {
        autoDescribeJobIdRef.current = "";
        autoDescribeRunningRef.current = false;
      }
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  const createFolder = useCallback(
    (name) =>
      invoke("video_media_folder_create", { repoPath, name })
        .then(() => refreshAssets())
        .catch((err) => setMediaError(String(err))),
    [refreshAssets, repoPath],
  );

  const deleteFolder = useCallback(
    (folderId) =>
      invoke("video_media_folder_delete", { repoPath, folderId })
        .then(() => refreshAssets())
        .catch((err) => setMediaError(String(err))),
    [refreshAssets, repoPath],
  );

  const moveToFolder = useCallback(
    (asset, folderId) =>
      invoke("video_media_set_folder", { repoPath, path: asset?.path || "", folderId: folderId || "" })
        .then(() => refreshAssets())
        .catch((err) => setMediaError(String(err))),
    [refreshAssets, repoPath],
  );

  const refreshProjects = useCallback(() => {
    if (!repoPath) {
      return Promise.resolve([]);
    }
    return invoke("video_projects_list", { repoPath })
      .then((result) => {
        const list = Array.isArray(result?.projects) ? result.projects : [];
        setProjects(list);
        return list;
      })
      .catch((err) => {
        setPaneError(String(err));
        return [];
      });
  }, [repoPath]);

  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] };
    setHistoryVersion((version) => version + 1);
  }, []);

  // Assigned below once the autosave/history machinery exists (the watcher
  // effect above renders earlier than those declarations).
  const reloadProjectExternalRef = useRef(() => {});

  const openProject = useCallback(
    (path) => {
      if (!repoPath || !path) {
        return;
      }
      invoke("video_project_read", { repoPath, projectPath: path })
        .then((result) => {
          setProject(normalizeProject(result?.project));
          setProjectPath(String(result?.path || path));
          setPaneError("");
          setSelectedClipIds([]);
          playback.setMs(0);
          playback.setPlaying(false);
          setPlayheadUiMs(0);
          setPlaying(false);
          setView("editor");
          resetHistory();
        })
        .catch((err) => setPaneError(String(err)));
    },
    [playback, repoPath, resetHistory],
  );

  useEffect(() => {
    if (!externalProjectProvided) {
      return;
    }
    if (externalProjectPath) {
      if (projectPathRef.current !== externalProjectPath) {
        openProject(externalProjectPath);
        return;
      }
      setView("editor");
      if (Array.isArray(externalProject?.selectedClipIds)) {
        const nextSelectedClipIds = normalizeStringList(externalProject.selectedClipIds);
        setSelectedClipIds((current) => (
          sameStringList(current, nextSelectedClipIds) ? current : nextSelectedClipIds
        ));
      }
      if (Array.isArray(externalProject?.ranges)) {
        const nextRanges = normalizeTimelineRanges(externalProject.ranges);
        setRanges((current) => (
          sameTimelineRanges(current, nextRanges) ? current : nextRanges
        ));
      }
      const nextPlayheadMs = Number(externalProject?.playheadMs);
      if (Number.isFinite(nextPlayheadMs)) {
        const safePlayheadMs = Math.max(0, Math.round(nextPlayheadMs));
        if (Math.abs(playback.getMs() - safePlayheadMs) > 1) {
          playback.setMs(safePlayheadMs);
        }
        setPlayheadUiMs((current) => (Math.abs(current - safePlayheadMs) > 1 ? safePlayheadMs : current));
      }
      if (externalProject?.playing === false) {
        setPlaybackPlaying(false);
      }
      return;
    }
    if (!projectPathRef.current) {
      return;
    }
    setProject(null);
    setProjectPath("");
    setSelectedClipIds([]);
    playback.setMs(0);
    playback.setPlaying(false);
    setPlayheadUiMs(0);
    setPlaying(false);
    setView("menu");
    resetHistory();
  }, [
    externalProject,
    externalProjectPath,
    externalProjectProvided,
    openProject,
    playback,
    projectPath,
    resetHistory,
    setPlaybackPlaying,
  ]);

  useEffect(() => {
    refreshTools();
  }, [refreshTools]);

  useEffect(() => {
    if (!repoPath) {
      return;
    }
    invoke("video_watch_start", { repoPath }).catch(() => {});
    refreshAssets();
    void refreshProjects().then((list) => {
      if (!storageKey || restoredKeyRef.current === storageKey) {
        return;
      }
      restoredKeyRef.current = storageKey;
      let saved = "";
      try {
        saved = window.localStorage.getItem(storageKey) || "";
      } catch {
        saved = "";
      }
      const target = list.find((entry) => entry.path === saved) || null;
      if (target) {
        openProject(target.path);
      } else if (list.length === 1) {
        openProject(list[0].path);
      }
    });
  }, [openProject, refreshAssets, refreshProjects, repoPath, storageKey]);

  useEffect(() => {
    if (!storageKey || restoredKeyRef.current !== storageKey) {
      return;
    }
    try {
      if (projectPath) {
        window.localStorage.setItem(storageKey, projectPath);
      } else {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      /* best-effort */
    }
  }, [projectPath, storageKey]);

  // prepareAgentContext is defined later (it needs the transcript machinery);
  // expose it through a stable wrapper so this effect never re-fires for it.
  const prepareAgentContextRef = useRef(null);
  const prepareAgentContextStable = useCallback(
    () => (prepareAgentContextRef.current ? prepareAgentContextRef.current() : Promise.resolve("")),
    [],
  );

  // Notify through a ref keyed on project VALUES only: parents pass inline
  // callbacks (new identity per render), and depending on that identity while
  // the parent stores the project in state renders → notify → setState →
  // render forever (React #185).
  const onProjectChangeRef = useRef(onProjectChange);
  onProjectChangeRef.current = onProjectChange;
  useEffect(() => {
    onProjectChangeRef.current?.(
      projectPath
        ? {
            path: projectPath,
            name: project?.name || "",
            playheadMs: Math.round(playbackRef.current?.getMs?.() || 0),
            playing,
            ranges: ranges.map((range) => ({ startMs: range.startMs, endMs: range.endMs })),
            selectedClipIds,
            selectionContext,
            prepareContext: prepareAgentContextStable,
          }
        : null,
    );
  }, [
    playheadUiMs,
    playing,
    prepareAgentContextStable,
    project?.name,
    projectPath,
    ranges,
    selectedClipIds,
    selectionContext,
  ]);

  // Mirror the pane's live selection state into Rust so the video MCP tools
  // (video_context) can report ranges/playhead/selection to agents. While
  // playing the playhead dep is parked (-1) — seeks and pauses re-push.
  const agentStatePlayheadMs = playing ? -1 : Math.round(playheadUiMs);
  useEffect(() => {
    if (!repoPath) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      invoke("video_agent_state_set", {
        repoPath,
        projectPath: projectPath || "",
        ranges: ranges.map((range) => ({ startMs: range.startMs, endMs: range.endMs })),
        playheadMs: Math.round(playbackRef.current?.getMs?.() || 0),
        selectedClipIds,
      }).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [agentStatePlayheadMs, projectPath, ranges, repoPath, selectedClipIds]);

  // Pane closing (or switching repos) clears its agent state in Rust.
  useEffect(() => {
    if (!repoPath) {
      return undefined;
    }
    return () => {
      invoke("video_agent_state_set", {
        repoPath,
        projectPath: "",
        ranges: [],
        playheadMs: 0,
        selectedClipIds: [],
      }).catch(() => {});
    };
  }, [repoPath]);

  // Install progress stream.
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_TOOLS_INSTALL_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      setInstallProgress(payload);
      if (payload.done || payload.error) {
        setInstalling(false);
        refreshTools();
      }
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [refreshTools]);

  // Store watcher: refresh media, reload the project when edited externally
  // (e.g. by a coding agent) — but not right after our own autosave.
  useEffect(() => {
    if (!repoPath) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_STORE_CHANGED_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const eventRepo = normalizeRepoIdentity(payload.repoPath);
      if (eventRepo && eventRepo !== normalizeRepoIdentity(repoPath)) {
        return;
      }
      const paths = Array.isArray(payload.paths) ? payload.paths.map((entry) => String(entry || "")) : [];
      const touchesProjects = paths.some((entry) => entry.includes("media/projects/"));
      const touchesMedia = paths.some((entry) => !entry.includes("media/projects/"));
      if (touchesMedia || !paths.length) {
        refreshAssets();
      }
      if (touchesProjects || !paths.length) {
        void refreshProjects();
        const current = projectPathRef.current;
        const ownWriteRecent = Date.now() - lastLocalWriteAtRef.current < 2000;
        if (current && !ownWriteRecent && (!paths.length || paths.includes(current))) {
          // External (agent/file) edit: reload in place — preserve undo
          // history and never let a stale pending autosave clobber it.
          reloadProjectExternalRef.current(current);
        }
      }
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [refreshAssets, refreshProjects, repoPath]);

  // Autosave: target path captured at edit time (switching projects inside
  // the debounce window must not cross-write), flushed on unmount.
  const pendingSaveRef = useRef(null);

  useEffect(() => {
    if (!repoPath) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_PROJECT_DELETED_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const eventRepo = normalizeRepoIdentity(payload.repoPath);
      if (eventRepo && eventRepo !== normalizeRepoIdentity(repoPath)) {
        return;
      }
      const deletedPath = normalizeVideoProjectIdentity(payload.projectPath || payload.project_path || payload.path);
      if (!deletedPath) {
        return;
      }
      const pendingPath = normalizeVideoProjectIdentity(pendingSaveRef.current?.projectPath);
      if (pendingPath && pendingPath === deletedPath) {
        pendingSaveRef.current = null;
        window.clearTimeout(saveTimerRef.current);
      }
      const currentPath = normalizeVideoProjectIdentity(projectPathRef.current);
      if (currentPath && currentPath === deletedPath) {
        setPlaybackPlaying(false);
        setProject(null);
        setProjectPath("");
        setSelectedClipIds([]);
        setRanges([]);
        setSelectionContext("");
        setView("menu");
        resetHistory();
      }
      void refreshProjects();
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [refreshProjects, repoPath, resetHistory, setPlaybackPlaying]);

  const flushPendingSave = useCallback(() => {
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    window.clearTimeout(saveTimerRef.current);
    if (!pending?.repoPath || !pending?.projectPath) {
      return;
    }
    lastLocalWriteAtRef.current = Date.now();
    invoke("video_project_write", {
      repoPath: pending.repoPath,
      projectPath: pending.projectPath,
      project: pending.project,
    })
      .then((result) => {
        // Legacy .video.json projects migrate to .video.pipe on first save.
        const nextPath = String(result?.path || "");
        if (nextPath && nextPath !== pending.projectPath && projectPathRef.current === pending.projectPath) {
          setProjectPath(nextPath);
        }
      })
      .catch((err) => setPaneError(String(err)));
  }, []);

  const scheduleSave = useCallback(
    (next) => {
      const targetPath = projectPathRef.current;
      if (pendingSaveRef.current && pendingSaveRef.current.projectPath !== targetPath) {
        flushPendingSave();
      }
      pendingSaveRef.current = { project: next, projectPath: targetPath, repoPath };
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(flushPendingSave, AUTOSAVE_DELAY_MS);
    },
    [flushPendingSave, repoPath],
  );

  useEffect(() => () => flushPendingSave(), [flushPendingSave]);

  // Project mutations. Committed (non-transient) edits record undo history.
  const projectStateRef = useRef(null);
  projectStateRef.current = project;
  const handleProjectChange = useCallback(
    (next, { transient = false, fromHistory = false } = {}) => {
      if (!transient && !fromHistory && projectStateRef.current) {
        const history = historyRef.current;
        history.past.push(projectStateRef.current);
        if (history.past.length > HISTORY_LIMIT) {
          history.past.shift();
        }
        history.future = [];
        setHistoryVersion((version) => version + 1);
      }
      setProject(next);
      if (!transient) {
        scheduleSave(next);
      }
    },
    [scheduleSave],
  );

  // Assigned once the agent-toast machinery (defined below) exists.
  const flushPendingAgentToastRef = useRef(null);

  // External reload (agent MCP writes, direct file edits): drop any pending
  // stale autosave, keep the pre-reload project as an undo entry, and swap
  // the project in place without resetting playhead/selection/view.
  const reloadProjectExternal = useCallback(
    (path) => {
      if (!repoPath || !path) {
        return;
      }
      pendingSaveRef.current = null;
      window.clearTimeout(saveTimerRef.current);
      invoke("video_project_read", { repoPath, projectPath: path })
        .then((result) => {
          const next = normalizeProject(result?.project);
          if (projectStateRef.current) {
            const history = historyRef.current;
            history.past.push(projectStateRef.current);
            if (history.past.length > HISTORY_LIMIT) {
              history.past.shift();
            }
            history.future = [];
            setHistoryVersion((version) => version + 1);
          }
          setProject(next);
          setPaneError("");
          // History entry is in — an agent-edit toast may now safely offer Undo.
          flushPendingAgentToastRef.current?.();
        })
        .catch(() => {});
    },
    [repoPath],
  );
  reloadProjectExternalRef.current = reloadProjectExternal;

  const undo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) {
      return;
    }
    if (projectStateRef.current) {
      history.future.push(projectStateRef.current);
    }
    setHistoryVersion((version) => version + 1);
    handleProjectChange(previous, { fromHistory: true });
  }, [handleProjectChange]);

  // Agent activity feed: every video MCP call mirrors one start + one
  // done/error event, matched by id. Rendered icon-first in the Agent tab.
  const [agentActivity, setAgentActivity] = useState([]);
  const [agentActivityUnseen, setAgentActivityUnseen] = useState(0);
  const sidePanelRef = useRef(sidePanel);
  sidePanelRef.current = sidePanel;
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen("video-agent-activity", (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (
        !payload.id ||
        normalizeRepoIdentity(payload.repoPath) !== normalizeRepoIdentity(repoPath)
      ) {
        return;
      }
      setAgentActivity((current) => {
        const index = current.findIndex((entry) => entry.id === payload.id);
        if (index >= 0) {
          const next = [...current];
          next[index] = { ...next[index], ...payload, atMs: next[index].atMs };
          return next;
        }
        return [{ ...payload, atMs: Date.now() }, ...current].slice(0, 40);
      });
      if (payload.phase === "start" && sidePanelRef.current !== "agent") {
        setAgentActivityUnseen((count) => Math.min(99, count + 1));
      }
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [repoPath]);

  // Agent MCP edits announce themselves (rust emits video-agent-edited right
  // after the write). The toast is shown only once the external reload has
  // pushed the pre-edit project into history — otherwise a fast Undo click
  // would pop the WRONG entry. Fallback shows it after 3s regardless.
  const [agentEditToast, setAgentEditToast] = useState(null); // { summary, canUndo }
  const pendingAgentToastRef = useRef(null); // { summary, at, fallbackTimer }
  const agentToastHideTimerRef = useRef(0);
  const showAgentToast = useCallback((summary, canUndo = true) => {
    setAgentEditToast({ summary, canUndo });
    window.clearTimeout(agentToastHideTimerRef.current);
    agentToastHideTimerRef.current = window.setTimeout(() => setAgentEditToast(null), 8000);
  }, []);
  const flushPendingAgentToast = useCallback(() => {
    const pending = pendingAgentToastRef.current;
    if (!pending) {
      return;
    }
    pendingAgentToastRef.current = null;
    window.clearTimeout(pending.fallbackTimer);
    showAgentToast(pending.summary);
  }, [showAgentToast]);
  flushPendingAgentToastRef.current = flushPendingAgentToast;
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen("video-agent-edited", (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (payload.projectPath && projectPathRef.current && payload.projectPath !== projectPathRef.current) {
        return;
      }
      const summary = String(payload.summary || "timeline edited");
      const previous = pendingAgentToastRef.current;
      if (previous) {
        window.clearTimeout(previous.fallbackTimer);
      }
      const fallbackTimer = window.setTimeout(() => {
        if (pendingAgentToastRef.current) {
          pendingAgentToastRef.current = null;
          // Reload never landed — no history entry was pushed, so offering
          // Undo here would pop the user's own previous edit. Info only.
          showAgentToast(summary, false);
        }
      }, 3000);
      pendingAgentToastRef.current = { summary, at: Date.now(), fallbackTimer };
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      window.clearTimeout(agentToastHideTimerRef.current);
      if (pendingAgentToastRef.current) {
        window.clearTimeout(pendingAgentToastRef.current.fallbackTimer);
      }
      unlisten();
    };
  }, [showAgentToast]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) {
      return;
    }
    if (projectStateRef.current) {
      history.past.push(projectStateRef.current);
    }
    setHistoryVersion((version) => version + 1);
    handleProjectChange(next, { fromHistory: true });
  }, [handleProjectChange]);

  const canUndo = historyRef.current.past.length > 0 && historyVersion >= 0;
  const canRedo = historyRef.current.future.length > 0;

  const createProject = useCallback(
    (name) => {
      const cleanName = String(name || "").trim();
      if (!repoPath || !cleanName) {
        return;
      }
      invoke("video_project_create", { repoPath, name: cleanName })
        .then((result) => {
          setDraftName("");
          void refreshProjects();
          if (result?.path) {
            setProject(normalizeProject(result.project));
            setProjectPath(String(result.path));
            playback.setMs(0);
            playback.setPlaying(false);
            setPlayheadUiMs(0);
            setPlaying(false);
            setView("editor");
            resetHistory();
          }
        })
        .catch((err) => setPaneError(String(err)));
    },
    [playback, refreshProjects, repoPath, resetHistory],
  );

  const deleteProject = useCallback(
    (path) => {
      if (!repoPath || !path) {
        return;
      }
      emit(VIDEO_PROJECT_DELETED_EVENT, {
        projectPath: path,
        repoPath,
        source: "video_workspace_pane",
        workspaceId,
      }).catch(() => {});
      if (pendingSaveRef.current?.projectPath === path) {
        pendingSaveRef.current = null;
        window.clearTimeout(saveTimerRef.current);
      }
      invoke("video_project_delete", { repoPath, projectPath: path })
        .then(() => {
          if (projectPathRef.current === path) {
            setProject(null);
            setProjectPath("");
            setView("menu");
          }
          void refreshProjects();
        })
        .catch((err) => setPaneError(String(err)));
    },
    [refreshProjects, repoPath, workspaceId],
  );

  const backToMenu = useCallback(() => {
    flushPendingSave();
    setPlaybackPlaying(false);
    setView("menu");
    void refreshProjects();
  }, [flushPendingSave, refreshProjects, setPlaybackPlaying]);

  // External toolbar nonce/command bus (PCB pane contract).
  useEffect(() => {
    if (createRequestNonce && createRequestNonce !== createSeenRef.current) {
      createSeenRef.current = createRequestNonce;
      setDraftName(createRequestName || "");
      setView("menu");
      window.requestAnimationFrame(() => createInputRef.current?.focus?.());
    }
  }, [createRequestName, createRequestNonce]);

  useEffect(() => {
    if (deleteRequestNonce && deleteRequestNonce !== deleteSeenRef.current) {
      deleteSeenRef.current = deleteRequestNonce;
      if (projectPathRef.current) {
        deleteProject(projectPathRef.current);
      }
    }
  }, [deleteProject, deleteRequestNonce]);

  useEffect(() => {
    if (refreshRequestNonce && refreshRequestNonce !== refreshSeenRef.current) {
      refreshSeenRef.current = refreshRequestNonce;
      refreshAssets();
      void refreshProjects();
      refreshTools();
    }
  }, [refreshAssets, refreshProjects, refreshRequestNonce, refreshTools]);

  useEffect(() => {
    const nonce = Number(controlCommand?.nonce) || 0;
    if (!nonce || nonce === controlSeenRef.current) {
      return;
    }
    controlSeenRef.current = nonce;
    const action = String(controlCommand?.action || "").toLowerCase();
    if (action === "create" || action === "new") {
      setDraftName(String(controlCommand?.name || ""));
      setView("menu");
      window.requestAnimationFrame(() => createInputRef.current?.focus?.());
    } else if (action === "select" || action === "open" || action === "switch") {
      const target = String(controlCommand?.projectPath || controlCommand?.path || "");
      const targetName = String(controlCommand?.projectName || controlCommand?.name || "").trim();
      if (target) {
        openProject(target);
      } else if (targetName) {
        const match = projects.find((entry) => entry.name === targetName);
        if (match) {
          openProject(match.path);
        }
      }
    } else if (action === "refresh" || action === "reload") {
      refreshAssets();
      void refreshProjects();
    } else if (action === "delete") {
      if (projectPathRef.current) {
        deleteProject(projectPathRef.current);
      }
    } else if (action === "tab" && controlCommand?.tab) {
      const tab = String(controlCommand.tab).toLowerCase();
      if (tab === "media" || tab === "library") {
        setLibraryOpen(true);
      } else if (tab === "generate") {
        openSidePanel("generate");
      } else if (tab === "export") {
        setSidePanel("export");
      } else if (tab === "edit") {
        setSidePanel("");
      }
    }
  }, [controlCommand, deleteProject, openProject, projects, refreshAssets, refreshProjects]);

  const installTools = useCallback(() => {
    if (installing) {
      return;
    }
    setInstalling(true);
    setInstallProgress({ state: "starting", message: "Preparing download…" });
    invoke("video_tools_install").catch((err) => {
      setInstalling(false);
      setInstallProgress({ state: "error", error: String(err), message: String(err) });
    });
  }, [installing]);

  const addAssetToTimeline = useCallback(
    (asset) => {
      if (!projectStateRef.current) {
        return;
      }
      const result = addMediaClip(projectStateRef.current, asset, { timelineStartMs: currentPlayheadMs() });
      handleProjectChange(result.project, { transient: false });
      setSelectedClipIds([result.clipId]);
    },
    [currentPlayheadMs, handleProjectChange],
  );

  const assetsByPath = useMemo(() => {
    const map = {};
    for (const asset of assets) {
      map[asset.path] = asset;
    }
    return map;
  }, [assets]);
  const assetsByPathRef = useRef(assetsByPath);
  assetsByPathRef.current = assetsByPath;
  const rangesRef = useRef(ranges);
  rangesRef.current = ranges;

  // Restore the persisted transcript/asset panel target once assets load;
  // if the asset no longer exists, close that panel gracefully.
  useEffect(() => {
    if (restoredPanelAssetRef.current || !assets.length) {
      return;
    }
    restoredPanelAssetRef.current = true;
    const prefs = initialPrefsRef.current;
    if (prefs.sidePanel === "transcript" && prefs.transcriptAssetPath) {
      const asset = assets.find((entry) => entry.path === prefs.transcriptAssetPath);
      if (asset) {
        setTranscriptAsset(asset);
      } else {
        setSidePanel("");
      }
    }
    if (prefs.sidePanel === "asset" && prefs.selectedAssetPath) {
      if (!assets.some((entry) => entry.path === prefs.selectedAssetPath)) {
        setSidePanel("");
      } else {
        setSelectedAssetPath(prefs.selectedAssetPath);
      }
    }
  }, [assets]);

  // Transcript panel + AI Edit routing --------------------------------------

  // Opening a side panel programmatically respects the same width guard as
  // the rail toggles: below ~900px the library yields its space.
  const openSidePanel = useCallback(
    (panel) => {
      setSidePanel(panel);
      if (paneWidth > 0 && paneWidth < 900) {
        setLibraryOpen(false);
      }
    },
    [paneWidth],
  );

  const openTranscript = useCallback(
    (asset) => {
      setTranscriptAsset(asset);
      openSidePanel("transcript");
    },
    [openSidePanel],
  );

  // Clicking an Agent-feed entry jumps to the thing it touched.
  const handleAgentActivityNavigate = useCallback(
    (entry) => {
      const tool = String(entry?.tool || "");
      const detail = entry?.detail || {};
      const result = entry?.result || {};
      if (tool === "video_transcribe") {
        const paths = Array.isArray(result.results) && result.results.length
          ? result.results.map((row) => row.assetPath)
          : Array.isArray(detail.paths)
            ? detail.paths
            : [];
        const asset = paths.map((path) => assetsByPathRef.current[path]).find(Boolean);
        if (asset) {
          openTranscript(asset);
          return;
        }
        setLibraryOpen(true);
        return;
      }
      if (tool === "video_edit") {
        const ids = Array.isArray(result.changedClipIds) ? result.changedClipIds : [];
        if (ids.length) {
          setSelectedClipIds(ids); // Timeline scrolls new selections into view
        }
        return;
      }
      if (tool === "video_look") {
        const at = Number(detail.atMs) || (Array.isArray(detail.timesMs) ? Number(detail.timesMs[0]) : NaN);
        if (Number.isFinite(at)) {
          commitSeek(at);
        }
        return;
      }
      if (tool === "video_media") {
        setLibraryOpen(true);
        return;
      }
      if (tool === "video_generate") {
        setSidePanel("generate");
        return;
      }
      if (tool === "video_export") {
        setSidePanel("export");
        return;
      }
      // video_context — nothing spatial to jump to.
    },
    [commitSeek, openTranscript],
  );

  const openAssetPanel = useCallback(
    (asset) => {
      setSelectedAssetPath(asset?.path || "");
      openSidePanel("asset");
    },
    [openSidePanel],
  );

  const handleAiEdit = useCallback(
    ({ action, asset }) => {
      if (action === "upscale-video" || action === "upscale-image") {
        // Upscaling lives in the asset panel now (cloud-run, per-model options).
        openAssetPanel(asset);
        return;
      }
      seedNonceRef.current += 1;
      setGenerateSeed({ action, asset, nonce: seedNonceRef.current });
      openSidePanel("generate");
    },
    [openAssetPanel, openSidePanel],
  );

  // Auto-captions: style caption clips onto a Captions track for the clip
  // using this asset (selected clip preferred).
  const generateCaptions = useCallback(
    (asset, segments) => {
      const current = projectStateRef.current;
      if (!current || !asset?.path) {
        return;
      }
      let target = null;
      for (const track of current.tracks) {
        for (const clip of track.clips) {
          if (clip.assetPath === asset.path && track.kind !== "text") {
            if (selectedClipIds.includes(clip.id)) {
              target = clip;
              break;
            }
            target = target || clip;
          }
        }
      }
      if (!target) {
        setPaneError("Put this media on the timeline first, then generate captions for it.");
        return;
      }
      const result = addCaptionsForClip(current, target.id, segments);
      if (result.count) {
        handleProjectChange(result.project, { transient: false });
        setPaneError("");
      } else {
        setPaneError("No transcript segments overlap this clip's trimmed range.");
      }
    },
    [handleProjectChange, selectedClipIds],
  );

  // The HappySRT-style flagship: strike words → ripple them out of the cut.
  const removeWordsFromCut = useCallback(
    (asset, words) => {
      const current = projectStateRef.current;
      if (!current || !asset?.path || !words?.length) {
        return;
      }
      const result = rippleDeleteWords(current, asset.path, words);
      if (result.ranges.length) {
        handleProjectChange(result.project, { transient: false });
      } else {
        setPaneError("Those words aren't inside any timeline clip of this media.");
      }
    },
    [handleProjectChange],
  );

  const seekSource = useCallback((asset, sourceMs) => {
    const current = projectStateRef.current;
    if (!current) {
      return;
    }
    for (const track of current.tracks) {
      for (const clip of track.clips) {
        if (clip.assetPath !== asset?.path) {
          continue;
        }
        const speed = clip.speed || 1;
        const from = clip.sourceInMs || 0;
        const to = from + clip.durationMs * speed;
        if (sourceMs >= from && sourceMs <= to) {
          commitSeek(clip.timelineStartMs + Math.round((sourceMs - from) / speed));
          return;
        }
      }
    }
  }, [commitSeek]);

  // Placeholder-first: a reserved generation path becomes a clip immediately.
  // A failed generation must take its timeline placeholder with it — the
  // ghost clip's assetPath is one of the job's plannedPaths.
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_GENERATE_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const planned = Array.isArray(payload.plannedPaths) ? payload.plannedPaths.filter(Boolean) : [];
      // Live ghost-clip telemetry: the timeline dresses placeholder clips
      // with the job's model + percent while it runs, and drops the entry
      // the moment the job settles (the real asset takes over on refresh).
      if (planned.length) {
        setGenerationByPath((current) => {
          const next = { ...current };
          for (const path of planned) {
            if (payload.done || payload.error) {
              delete next[path];
            } else {
              next[path] = {
                model: payload.model || "",
                percent: payload.percent ?? null,
                state: payload.state || "",
              };
            }
          }
          return next;
        });
      }
      // A finished re-render swaps every clip from the old mp4 onto the
      // freshly rendered one (versioned path — the old file stays).
      const swap = payload.done ? codeReRenderRef.current.get(payload.jobId) : null;
      if (swap) {
        codeReRenderRef.current.delete(payload.jobId);
        if (!payload.error && swap.newPath) {
          const currentProject = projectStateRef.current;
          if (currentProject) {
            let changed = false;
            const tracks = (currentProject.tracks || []).map((track) => {
              let trackChanged = false;
              const clips = (track.clips || []).map((clip) => {
                if (clip.assetPath === swap.oldPath) {
                  trackChanged = true;
                  return { ...clip, assetPath: swap.newPath };
                }
                return clip;
              });
              changed = changed || trackChanged;
              return trackChanged ? { ...track, clips } : track;
            });
            if (changed) {
              handleProjectChange({ ...currentProject, tracks }, { transient: false });
            }
          }
        }
      }
      // Success: swap the ghost for the real asset even when the Generate
      // panel (whose onGenerated normally refreshes) has been closed.
      if (payload.done && !payload.error && planned.length) {
        refreshAssets();
      }
      if (!payload.error || !planned.length) {
        return;
      }
      const current = projectStateRef.current;
      if (!current) {
        refreshAssets();
        return;
      }
      const doomed = new Set(planned);
      let changed = false;
      const tracks = (current.tracks || []).map((track) => {
        const clips = (track.clips || []).filter((clip) => {
          const hit = Boolean(clip.assetPath) && doomed.has(clip.assetPath);
          changed = changed || hit;
          return !hit;
        });
        return clips.length === (track.clips || []).length ? track : { ...track, clips };
      });
      if (changed) {
        handleProjectChange({ ...current, tracks }, { transient: false });
      }
      refreshAssets(); // pending library tiles for the job disappear too
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [handleProjectChange, refreshAssets]);

  const addPlannedClip = useCallback(
    (plannedPath, durationMs, { model = "" } = {}) => {
      const current = projectStateRef.current;
      if (!current || !plannedPath) {
        return;
      }
      const result = addMediaClip(
        current,
        { path: plannedPath, kind: "video", durationMs },
        { timelineStartMs: currentPlayheadMs() },
      );
      handleProjectChange(result.project, { transient: false });
      setSelectedClipIds([result.clipId]);
      // Dress the placeholder as a ghost immediately — the first progress
      // event may take a beat to arrive with the model + percent.
      setGenerationByPath((currentMap) => ({
        ...currentMap,
        [plannedPath]: currentMap[plannedPath] || { model, percent: null, state: "" },
      }));
    },
    [currentPlayheadMs, handleProjectChange],
  );

  // Hyperframes code clips: a rendered mp4 carries a hyperframes-render
  // relation back to its composition; a still-pending ghost is matched to its
  // job in the ledger by planned path.
  const resolveCodeSource = useCallback(
    async (assetPath) => {
      const asset = assetsByPath[assetPath];
      const relation = (asset?.relations || []).find((rel) => rel.via === "hyperframes-render");
      if (relation?.path) {
        return relation.path;
      }
      try {
        const result = await invoke("video_jobs_list", { repoPath });
        const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
        const job = jobs.find(
          (entry) => entry.sourcePath && (entry.plannedPaths || []).includes(assetPath),
        );
        return job?.sourcePath || "";
      } catch {
        return "";
      }
    },
    [assetsByPath, repoPath],
  );

  const handleClipContextMenu = useCallback(
    (event, clip, track) => {
      if (track.kind !== "video" || !clip.assetPath) {
        return;
      }
      const asset = assetsByPath[clip.assetPath];
      const isCode =
        (asset?.relations || []).some((rel) => rel.via === "hyperframes-render") ||
        (asset?.pending && asset?.model === "hyperframes");
      if (!isCode) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setCodeMenu({
        x: event.clientX,
        y: event.clientY,
        assetPath: clip.assetPath,
        pending: Boolean(asset?.pending),
        sourcePath: "",
      });
      resolveCodeSource(clip.assetPath).then((sourcePath) => {
        setCodeMenu((current) =>
          current && current.assetPath === clip.assetPath ? { ...current, sourcePath } : current,
        );
      });
    },
    [assetsByPath, resolveCodeSource],
  );

  // Re-render: a fresh job renders the composition to a NEW generated path
  // (the old mp4 stays as a version); clips swap over when the render lands.
  const reRenderCodeClip = useCallback(
    async (assetPath, sourcePath) => {
      setCodeMenu(null);
      if (!sourcePath) {
        return;
      }
      try {
        const started = await invoke("video_generate_start", {
          repoPath,
          request: {
            providerId: "hyperframes",
            model: "hyperframes",
            mode: "code-render",
            prompt: "",
            inputAssetPaths: [],
            audioAssetPaths: [],
            params: { sourcePath },
            loraId: null,
            auth: null,
          },
        });
        const newPath = Array.isArray(started?.plannedPaths) ? started.plannedPaths[0] || "" : "";
        if (started?.jobId && newPath) {
          codeReRenderRef.current.set(started.jobId, { oldPath: assetPath, newPath });
        }
        // The composition is already authored — skip straight to rendering.
        await invoke("video_generate_code_render", { repoPath, jobId: started.jobId });
      } catch (err) {
        setPaneError(String(err));
      }
    },
    [repoPath],
  );

  // Preview text drag → clip style updates (transient while dragging).
  const handleUpdateTextClip = useCallback(
    (clipId, patch, { transient = false } = {}) => {
      if (!projectStateRef.current) {
        return;
      }
      handleProjectChange(updateClip(projectStateRef.current, clipId, patch), { transient });
    },
    [handleProjectChange],
  );

  // Insert a finished generation (or any asset path) at the playhead.
  const insertAssetPath = useCallback(
    (path) => {
      const clean = String(path || "").trim();
      if (!clean || !projectStateRef.current) {
        return;
      }
      const known = assetsByPath[clean];
      const kind = known?.kind
        || (/\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(clean)
          ? "audio"
          : /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(clean)
            ? "image"
            : "video");
      const result = addMediaClip(
        projectStateRef.current,
        known || { path: clean, kind },
        { timelineStartMs: currentPlayheadMs() },
      );
      handleProjectChange(result.project, { transient: false });
      setSelectedClipIds([result.clipId]);
    },
    [assetsByPath, currentPlayheadMs, handleProjectChange],
  );

  // Range-scoped AI context: what's selected, which clips overlap, and the
  // transcript slices inside each range. Rides along on every agent prompt
  // sent from this pane (the TerminalView wrapper appends it).
  const transcriptCacheRef = useRef(new Map());

  // Transcript edits and fresh transcriptions invalidate the cached slices
  // used for AI range context.
  useEffect(() => {
    let disposed = false;
    const unlisteners = [];
    const adopt = (fn) => {
      if (disposed) {
        fn();
      } else {
        unlisteners.push(fn);
      }
    };
    const invalidate = (event) => {
      const path = String(event?.payload?.path || "").trim();
      if (path) {
        transcriptCacheRef.current.delete(path);
      }
      // hasTranscript badges follow the cache (delete/update/fresh runs).
      refreshAssets();
    };
    listen("video-transcript-updated", invalidate).then(adopt).catch(() => {});
    listen(VIDEO_TRANSCRIBE_PROGRESS_EVENT, (event) => {
      if (event?.payload?.done && !event?.payload?.error) {
        invalidate(event);
      }
    })
      .then(adopt)
      .catch(() => {});
    return () => {
      disposed = true;
      for (const fn of unlisteners) {
        fn();
      }
    };
  }, [refreshAssets]);

  // Builds the range-scoped context string handed to agents. Shared between
  // the live effect below and the pre-submit prepareAgentContext flow.
  const buildSelectionContext = useCallback(async () => {
    const currentProject = projectStateRef.current;
    const currentRanges = rangesRef.current;
    if (!currentRanges.length || !currentProject) {
      return "";
    }
    const lines = ["Selected timeline ranges (scope any edits to these):"];
    for (const range of currentRanges) {
      const overlapping = clipsInRange(currentProject, range.startMs, range.endMs);
      const clipBits = [];
      for (const { track, clip } of overlapping) {
        if (track.kind === "text") {
          clipBits.push(`text "${String(clip.text || "").slice(0, 60)}" on ${track.label}`);
          continue;
        }
        let bit = `${clip.assetPath} on ${track.label} (${formatTimecode(clip.timelineStartMs)}–${formatTimecode(clip.timelineStartMs + clip.durationMs)})`;
        const asset = assetsByPathRef.current[clip.assetPath];
        // Cache-first regardless of the (possibly stale) hasTranscript flag —
        // the pre-submit flow seeds the cache right after transcribing.
        let transcript = transcriptCacheRef.current.get(clip.assetPath);
        if (transcript === undefined && asset?.hasTranscript) {
          try {
            transcript = await invoke("video_transcript_get", { repoPath, path: clip.assetPath });
          } catch {
            transcript = null;
          }
          transcriptCacheRef.current.set(clip.assetPath, transcript);
        }
        const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
        if (segments.length) {
          const speed = clip.speed || 1;
          // Clamp the window to the actual clip overlap — a range extending
          // past the clip must not pull transcript after the visible media.
          const overlapStart = Math.max(range.startMs, clip.timelineStartMs);
          const overlapEnd = Math.min(range.endMs, clip.timelineStartMs + clip.durationMs);
          const sourceFrom = (clip.sourceInMs || 0) + Math.max(0, overlapStart - clip.timelineStartMs) * speed;
          const sourceTo = (clip.sourceInMs || 0) + Math.max(0, overlapEnd - clip.timelineStartMs) * speed;
          const excerpt = segments
            .filter((segment) => segment.startMs < sourceTo && segment.endMs > sourceFrom)
            .map((segment) => segment.text)
            .join(" ")
            .slice(0, 400);
          if (excerpt) {
            bit += ` — transcript: "${excerpt}"`;
          }
        }
        clipBits.push(bit);
      }
      lines.push(
        `- ${formatTimecode(range.startMs)}–${formatTimecode(range.endMs)}: ${clipBits.length ? clipBits.join("; ") : "empty"}`,
      );
    }
    return lines.join("\n");
  }, [repoPath]);

  useEffect(() => {
    if (!ranges.length || !project) {
      setSelectionContext("");
      return undefined;
    }
    let cancelled = false;
    buildSelectionContext()
      .then((text) => {
        if (!cancelled) {
          setSelectionContext(text);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [assetsByPath, buildSelectionContext, project, ranges]);

  // Pre-submit hook for the agent composer: media under the selected ranges
  // that has no transcript yet gets transcribed FIRST, so the prompt goes out
  // with full word-timed context instead of the agent discovering gaps.
  const prepareAgentContext = useCallback(async () => {
    const currentProject = projectStateRef.current;
    const currentRanges = rangesRef.current;
    if (!currentProject || !currentRanges.length || !repoPath) {
      return buildSelectionContext();
    }
    const missing = new Set();
    for (const range of currentRanges) {
      for (const { track, clip } of clipsInRange(currentProject, range.startMs, range.endMs)) {
        if (track.kind === "text" || !clip.assetPath) {
          continue;
        }
        const asset = assetsByPathRef.current[clip.assetPath];
        if (asset && !asset.pending && !asset.hasTranscript && (asset.kind === "video" || asset.kind === "audio")) {
          missing.add(clip.assetPath);
        }
      }
    }
    if (missing.size) {
      const prepActivityId = `prep-${Date.now()}`;
      setAgentActivity((current) => [
        {
          id: prepActivityId,
          tool: "video_transcribe",
          phase: "start",
          detail: { paths: [...missing], scope: "pre-submit" },
          atMs: Date.now(),
        },
        ...current,
      ].slice(0, 40));
      try {
        window.dispatchEvent(new CustomEvent("diffforge-video-agent-prep", {
          detail: { phase: "transcribing", count: missing.size },
        }));
      } catch {
        /* hint only */
      }
      await Promise.all(
        [...missing].map(
          (path) =>
            new Promise((resolve) => {
              const timeout = window.setTimeout(() => resolve(), 240_000);
              let unlisten = () => {};
              listen(VIDEO_TRANSCRIBE_PROGRESS_EVENT, (event) => {
                const payload = event?.payload || {};
                if (String(payload.path || "") === path && (payload.done || payload.error)) {
                  window.clearTimeout(timeout);
                  unlisten();
                  resolve();
                }
              })
                .then((next) => {
                  unlisten = next;
                  return invoke("video_transcribe_start", { repoPath, path, force: false });
                })
                .catch(() => {
                  window.clearTimeout(timeout);
                  unlisten();
                  resolve();
                });
            }),
        ),
      );
      // Seed the cache directly — refreshAssets is async and the context
      // build below must not race the hasTranscript flag refresh.
      await Promise.all(
        [...missing].map(async (path) => {
          transcriptCacheRef.current.delete(path);
          try {
            const transcript = await invoke("video_transcript_get", { repoPath, path });
            if (transcript?.available !== false) {
              transcriptCacheRef.current.set(path, transcript);
            }
          } catch {
            /* transcription failed — context simply omits this clip's text */
          }
        }),
      );
      refreshAssets();
      setAgentActivity((current) =>
        current.map((entry) =>
          entry.id === prepActivityId ? { ...entry, phase: "done" } : entry,
        ),
      );
      try {
        window.dispatchEvent(new CustomEvent("diffforge-video-agent-prep", { detail: { phase: "done" } }));
      } catch {
        /* hint only */
      }
    }
    return buildSelectionContext();
  }, [buildSelectionContext, refreshAssets, repoPath]);
  prepareAgentContextRef.current = prepareAgentContext;

  const toggleSidePanel = useCallback(
    (panel) => {
      setSidePanel((current) => {
        const next = current === panel ? "" : panel;
        // Mid-width panes can't fit library + side panel at usable minimums —
        // yield the space instead of crushing everything into slivers.
        if (next && paneWidth > 0 && paneWidth < 900) {
          setLibraryOpen(false);
        }
        return next;
      });
    },
    [paneWidth],
  );

  const toggleLibrary = useCallback(() => {
    setLibraryOpen((open) => {
      const next = !open;
      if (next && paneWidth > 0 && paneWidth < 900) {
        setSidePanel("");
      }
      return next;
    });
  }, [paneWidth]);

  const installBusy = installing || (installProgress && !installProgress.done && !installProgress.error);

  const binProps = {
    assets,
    error: mediaError,
    folders,
    onAddToTimeline: addAssetToTimeline,
    onAiEdit: handleAiEdit,
    onCreateFolder: createFolder,
    onDeleteFolder: deleteFolder,
    onImported: refreshAssets,
    onMoveToFolder: moveToFolder,
    onOpenTranscript: openTranscript,
    onSelectAsset: openAssetPanel,
    paneToken: paneId || "video-pane",
    repoPath,
    selectedPath: selectedAssetPath,
  };

  const previewCell = (
    <PreviewCell>
      <VideoEditor
        mediaRootAbs={mediaRootAbs}
        onSeek={commitSeek}
        onTogglePlay={setPlaybackPlaying}
        onUpdateTextClip={handleUpdateTextClip}
        playback={playback}
        playheadMs={playheadUiMs}
        playing={playing}
        project={project}
        repoPath={repoPath}
      />
    </PreviewCell>
  );

  const timelineCell = (
    <Timeline
      assetsByPath={assetsByPath}
      canRedo={canRedo}
      canUndo={canUndo}
      generationByPath={generationByPath}
      onChange={handleProjectChange}
      onClipContextMenu={handleClipContextMenu}
      onRangesChange={setRanges}
      onRedo={redo}
      onSeek={commitSeek}
      onSelectClips={setSelectedClipIds}
      onUndo={undo}
      paneToken={paneId || "video-pane"}
      playback={playback}
      playheadMs={playheadUiMs}
      project={project}
      ranges={ranges}
      repoPath={repoPath}
      selectedClipIds={selectedClipIds}
    />
  );

  const sidePanelContent = sidePanel === "generate" ? (
    <GeneratePanel
      assets={assets}
      onGenerated={refreshAssets}
      onInsertAsset={insertAssetPath}
      onPlannedClip={addPlannedClip}
      onPreviewCode={setCodePreviewSource}
      paneToken={paneId || "video-pane"}
      repoPath={repoPath}
      seed={generateSeed}
    />
  ) : sidePanel === "transcript" ? (
    <TranscriptPanel
      asset={transcriptAsset}
      onGenerateCaptions={generateCaptions}
      onRemoveWordsFromCut={removeWordsFromCut}
      onSeekSource={seekSource}
      repoPath={repoPath}
    />
  ) : sidePanel === "asset" ? (
    <AssetPanel
      asset={assetsByPath[selectedAssetPath] || null}
      assetsByPath={assetsByPath}
      onAddToTimeline={addAssetToTimeline}
      onOpenAsset={openAssetPanel}
      onDeleted={() => {
        refreshAssets();
        setSidePanel("");
      }}
      onOpenTranscript={openTranscript}
      paneToken={paneId || "video-pane"}
      repoPath={repoPath}
    />
  ) : sidePanel === "export" ? (
    <ExportPanel ffmpegReady={ffmpegReady} project={project} projectPath={projectPath} repoPath={repoPath} />
  ) : sidePanel === "agent" ? (
    <AgentActivityPanel entries={agentActivity} onNavigate={handleAgentActivityNavigate} />
  ) : null;

  return (
    <PaneSurface data-video-pane="true">
      <PaneBody ref={bodyRef}>
        {view === "menu" || !project ? (
          <MenuScreen>
            <MenuCard>
              <MenuHeader>
                <MenuBadge>
                  <Movie aria-hidden="true" />
                </MenuBadge>
                <MenuHeaderText>
                  <MenuTitle>Video projects</MenuTitle>
                  <MenuHint>
                    Cut clips, keyframe audio, add titles, generate AI footage, and export — all
                    inside this workspace's media/ folder. Agents can edit the same timeline files.
                  </MenuHint>
                </MenuHeaderText>
              </MenuHeader>
              {tools && !ffmpegReady ? (
                installBusy ? (
                  <div style={{ display: "grid", gap: 4 }}>
                    <VideoProgressTrack>
                      <VideoProgressFill
                        style={{ width: `${Math.min(100, Math.max(3, installProgress?.percent || 3))}%` }}
                      />
                    </VideoProgressTrack>
                    <MenuHint>{installProgress?.message || "Installing ffmpeg…"}</MenuHint>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <VideoSecondaryButton onClick={installTools} type="button">
                      Install ffmpeg (~90 MB)
                    </VideoSecondaryButton>
                    <MenuHint>Powers thumbnails, preview metadata, and export.</MenuHint>
                  </div>
                )
              ) : null}
              {installProgress?.error ? <VideoErrorText>{installProgress.error}</VideoErrorText> : null}
              <CreateRow
                onSubmit={(event) => {
                  event.preventDefault();
                  createProject(draftName);
                }}
              >
                <MenuInput
                  aria-label="New project name"
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="New project name…"
                  ref={createInputRef}
                  value={draftName}
                />
                <MenuCreateButton disabled={!draftName.trim() || !repoPath} type="submit">
                  Create
                </MenuCreateButton>
              </CreateRow>
              {projects.length ? (
                <>
                  <MenuSectionLabel>Recent</MenuSectionLabel>
                  <RecentGrid>
                    {projects.slice(0, 3).map((entry) => (
                      <RecentCard key={entry.path} onClick={() => openProject(entry.path)} title={entry.name}>
                        <RecentCardName>{entry.name}</RecentCardName>
                        <RecentCardMeta>{formatRelativeTime(entry.updatedAtMs) || "—"}</RecentCardMeta>
                        <RecentCardDelete
                          aria-label={`Delete project ${entry.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteProject(entry.path);
                          }}
                          title="Delete project"
                          type="button"
                        >
                          <Delete aria-hidden="true" />
                        </RecentCardDelete>
                      </RecentCard>
                    ))}
                  </RecentGrid>
                </>
              ) : null}
              {projects.length > 3 ? (
                <>
                  <MenuSectionLabel>All projects</MenuSectionLabel>
                  {projects.slice(3).map((entry) => (
                    <ProjectRow key={entry.path} onClick={() => openProject(entry.path)}>
                      <ProjectRowName>{entry.name}</ProjectRowName>
                      <ProjectRowMeta>{formatRelativeTime(entry.updatedAtMs)}</ProjectRowMeta>
                      <VideoIconButton
                        aria-label={`Delete project ${entry.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteProject(entry.path);
                        }}
                        title="Delete project"
                        type="button"
                      >
                        <Delete aria-hidden="true" />
                      </VideoIconButton>
                    </ProjectRow>
                  ))}
                </>
              ) : null}
              {!projects.length ? <MenuHint>No projects yet — name one above to start.</MenuHint> : null}
              {paneError ? <VideoErrorText>{paneError}</VideoErrorText> : null}
            </MenuCard>
          </MenuScreen>
        ) : (
          <>
            <VideoRail>
              <VideoRailButton onClick={backToMenu} title="Back to projects" type="button">
                <ArrowBack aria-hidden="true" />
                Projects
              </VideoRailButton>
              <VideoRailDivider />
              <VideoRailTitle title={project.name}>{project.name}</VideoRailTitle>
              <VideoRailSpacer />
              {tools && !ffmpegReady ? (
                <InstallChip disabled={Boolean(installBusy)} onClick={installTools} type="button">
                  {installBusy
                    ? `ffmpeg ${Math.round(installProgress?.percent || 0)}%`
                    : "Install ffmpeg"}
                </InstallChip>
              ) : null}
              <VideoRailButton
                data-active={libraryOpen ? "true" : "false"}
                onClick={toggleLibrary}
                title="Toggle media library"
                type="button"
              >
                <PermMedia aria-hidden="true" />
                Library
              </VideoRailButton>
              <VideoRailButton
                data-active={sidePanel === "generate" ? "true" : "false"}
                onClick={() => toggleSidePanel("generate")}
                title="AI generation"
                type="button"
              >
                <AutoAwesome aria-hidden="true" />
                Generate
              </VideoRailButton>
              <VideoRailButton
                data-active={sidePanel === "agent" ? "true" : "false"}
                onClick={() => {
                  setAgentActivityUnseen(0);
                  toggleSidePanel("agent");
                }}
                title="Agent activity — everything agents did via MCP"
                type="button"
              >
                <SmartToy aria-hidden="true" />
                Agent
                {agentActivityUnseen > 0 && sidePanel !== "agent" ? (
                  <AgentUnseenDot aria-hidden />
                ) : null}
              </VideoRailButton>
              <VideoRailButton
                data-active={sidePanel === "export" ? "true" : "false"}
                onClick={() => toggleSidePanel("export")}
                title="Export"
                type="button"
              >
                <FileDownload aria-hidden="true" />
                Export
              </VideoRailButton>
            </VideoRail>
            {paneError ? <VideoErrorText style={{ padding: "3px 10px" }}>{paneError}</VideoErrorText> : null}
            <EditorArea>
              {agentEditToast ? (
                <AgentEditToast>
                  <span title={agentEditToast.summary}>✨ Agent: {agentEditToast.summary}</span>
                  {agentEditToast.canUndo ? (
                    <button
                      onClick={() => {
                        undo();
                        setAgentEditToast(null);
                      }}
                      type="button"
                    >
                      Undo
                    </button>
                  ) : null}
                  <button onClick={() => setAgentEditToast(null)} type="button">
                    ✕
                  </button>
                </AgentEditToast>
              ) : null}
              {wide ? (
                // Keyed by the visible-panel combo: toggling a panel remounts
                // the group so every panel reopens at a USABLE default width
                // instead of whatever sliver the previous layout left over.
                // Pixel minSizes keep panels readable at any pane width.
                <Group
                  defaultLayout={savedLayouts[comboKey]}
                  onLayoutChanged={(layout) => saveGroupLayout(comboKey, layout)}
                  orientation="horizontal"
                  style={{ height: "100%", width: "100%" }}
                >
                  {libraryOpen ? (
                    <React.Fragment key="library-slot">
                      <SplitPanel defaultSize="260px" groupResizeBehavior="preserve-pixel-size" id="video-split-library" key="library" minSize="190px">
                        <MediaBin {...binProps} />
                      </SplitPanel>
                      <SplitSeparatorH key="library-sep" />
                    </React.Fragment>
                  ) : null}
                  <SplitPanel id="video-split-center" key="center" minSize="360px">
                    <Group
                      defaultLayout={savedLayouts.vertical}
                      onLayoutChanged={(layout) => saveGroupLayout("vertical", layout)}
                      orientation="vertical"
                      style={{ height: "100%", width: "100%" }}
                    >
                      <SplitPanel defaultSize={62} id="video-split-preview" key="preview" minSize="150px">
                        {previewCell}
                      </SplitPanel>
                      <SplitSeparatorV key="preview-sep" />
                      <SplitPanel id="video-split-timeline" key="timeline" minSize="140px">
                        {timelineCell}
                      </SplitPanel>
                    </Group>
                  </SplitPanel>
                  {sidePanelContent ? (
                    <React.Fragment key="side-slot">
                      <SplitSeparatorH key="side-sep" />
                      <SplitPanel defaultSize="300px" groupResizeBehavior="preserve-pixel-size" id="video-split-side" key="side" minSize="240px">
                        {sidePanelContent}
                      </SplitPanel>
                    </React.Fragment>
                  ) : null}
                </Group>
              ) : (
                <>
                  <NarrowStack>
                    {previewCell}
                    {timelineCell}
                  </NarrowStack>
                  {libraryOpen ? (
                    <VideoSheet>
                      <VideoSheetHeader>
                        Library
                        <VideoRailSpacer />
                        <VideoIconButton onClick={() => setLibraryOpen(false)} title="Close" type="button">
                          <Close aria-hidden="true" />
                        </VideoIconButton>
                      </VideoSheetHeader>
                      <VideoSheetBody>
                        <MediaBin {...binProps} />
                      </VideoSheetBody>
                    </VideoSheet>
                  ) : null}
                  {sidePanelContent ? (
                    <VideoSheet>
                      <VideoSheetHeader>
                        {sidePanel === "generate"
                          ? "Generate"
                          : sidePanel === "transcript"
                            ? "Transcript"
                            : sidePanel === "asset"
                              ? "Asset"
                              : sidePanel === "agent"
                                ? "Agent"
                                : "Export"}
                        <VideoRailSpacer />
                        <VideoIconButton onClick={() => setSidePanel("")} title="Close" type="button">
                          <Close aria-hidden="true" />
                        </VideoIconButton>
                      </VideoSheetHeader>
                      <VideoSheetBody>{sidePanelContent}</VideoSheetBody>
                    </VideoSheet>
                  ) : null}
                </>
              )}
              {codePreviewSource ? (
                <CodePreviewSheet
                  onClose={() => setCodePreviewSource("")}
                  repoPath={repoPath}
                  sourcePath={codePreviewSource}
                />
              ) : null}
            </EditorArea>
          </>
        )}
      </PaneBody>
      {codeMenu
        ? createPortal(
            <ClipMenu
              onPointerDown={(event) => event.stopPropagation()}
              style={{ left: `${codeMenu.x + 2}px`, top: `${codeMenu.y + 2}px` }}
            >
              <ClipMenuHint>
                {codeMenu.sourcePath || "Hyperframes composition"}
              </ClipMenuHint>
              <ClipMenuItem
                disabled={!codeMenu.sourcePath}
                onClick={() => {
                  setCodeMenu(null);
                  revealItemInDir(
                    `${repoPath.replace(/\/$/, "")}/${codeMenu.sourcePath}`,
                  ).catch(() => {});
                }}
                type="button"
              >
                ⌁ Open composition source
              </ClipMenuItem>
              <ClipMenuItem
                disabled={!codeMenu.sourcePath}
                onClick={() => {
                  setCodeMenu(null);
                  setCodePreviewSource(codeMenu.sourcePath);
                }}
                type="button"
              >
                ◉ Preview composition
              </ClipMenuItem>
              <ClipMenuItem
                disabled={!codeMenu.sourcePath || codeMenu.pending}
                onClick={() => reRenderCodeClip(codeMenu.assetPath, codeMenu.sourcePath)}
                title={
                  codeMenu.pending
                    ? "Still rendering — re-render becomes available once the clip lands"
                    : "Render the composition again to a new file and swap this clip onto it"
                }
                type="button"
              >
                ↻ Re-render
              </ClipMenuItem>
            </ClipMenu>,
            document.body,
          )
        : null}
    </PaneSurface>
  );
}
