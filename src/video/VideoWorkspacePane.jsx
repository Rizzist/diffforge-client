import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { AutoAwesome } from "@styled-icons/material-rounded/AutoAwesome";
import { Close } from "@styled-icons/material-rounded/Close";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { PermMedia } from "@styled-icons/material-rounded/PermMedia";
import MediaBin from "./MediaBin.jsx";
import Timeline from "./Timeline.jsx";
import VideoEditor from "./VideoEditor.jsx";
import GeneratePanel from "./GeneratePanel.jsx";
import ExportPanel from "./ExportPanel.jsx";
import { createPlaybackStore } from "./videoPlaybackStore.js";
import {
  VIDEO_STORE_CHANGED_EVENT,
  VIDEO_TOOLS_INSTALL_PROGRESS_EVENT,
  VIDEO_TRANSCRIBE_PROGRESS_EVENT,
} from "./videoPanelBridge.js";
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

const MenuScreen = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  align-items: safe center;
  justify-content: center;
  padding: 14px;
`;

const MenuCard = styled(VideoCard)`
  width: min(420px, 100%);
`;

const MenuTitle = styled.div`
  font-size: 13px;
  font-weight: 850;
  color: #d1fae5;
`;

const ProjectRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 7px;
  background: rgba(4, 8, 14, 0.6);
  cursor: pointer;

  &:hover {
    border-color: rgba(16, 185, 129, 0.45);
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
  const seedNonceRef = useRef(0);
  const restoredPanelAssetRef = useRef(false);

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
  }, [repoPath]);

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

  useEffect(() => {
    onProjectChange?.(
      projectPath ? { path: projectPath, name: project?.name || "", selectionContext } : null,
    );
  }, [onProjectChange, project?.name, projectPath, selectionContext]);

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
          openProject(current);
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
  }, [openProject, refreshAssets, refreshProjects, repoPath]);

  // Autosave: target path captured at edit time (switching projects inside
  // the debounce window must not cross-write), flushed on unmount.
  const pendingSaveRef = useRef(null);
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
    [refreshProjects, repoPath],
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
  const addPlannedClip = useCallback(
    (plannedPath, durationMs) => {
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
    },
    [currentPlayheadMs, handleProjectChange],
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

  useEffect(() => {
    if (!ranges.length || !project) {
      setSelectionContext("");
      return undefined;
    }
    let cancelled = false;
    const build = async () => {
      const lines = ["Selected timeline ranges (scope any edits to these):"];
      for (const range of ranges) {
        const overlapping = clipsInRange(project, range.startMs, range.endMs);
        const clipBits = [];
        for (const { track, clip } of overlapping) {
          if (track.kind === "text") {
            clipBits.push(`text "${String(clip.text || "").slice(0, 60)}" on ${track.label}`);
            continue;
          }
          let bit = `${clip.assetPath} on ${track.label} (${formatTimecode(clip.timelineStartMs)}–${formatTimecode(clip.timelineStartMs + clip.durationMs)})`;
          const asset = assetsByPath[clip.assetPath];
          if (asset?.hasTranscript) {
            let transcript = transcriptCacheRef.current.get(clip.assetPath);
            if (transcript === undefined) {
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
              const sourceFrom = (clip.sourceInMs || 0) + Math.max(0, range.startMs - clip.timelineStartMs) * speed;
              const sourceTo = (clip.sourceInMs || 0) + Math.max(0, range.endMs - clip.timelineStartMs) * speed;
              const excerpt = segments
                .filter((segment) => segment.startMs < sourceTo && segment.endMs > sourceFrom)
                .map((segment) => segment.text)
                .join(" ")
                .slice(0, 400);
              if (excerpt) {
                bit += ` — transcript: "${excerpt}"`;
              }
            }
          }
          clipBits.push(bit);
        }
        lines.push(
          `- ${formatTimecode(range.startMs)}–${formatTimecode(range.endMs)}: ${clipBits.length ? clipBits.join("; ") : "empty"}`,
        );
      }
      if (!cancelled) {
        setSelectionContext(lines.join("\n"));
      }
    };
    void build();
    return () => {
      cancelled = true;
    };
  }, [assetsByPath, project, ranges, repoPath]);

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
    onAddToTimeline: addAssetToTimeline,
    onAiEdit: handleAiEdit,
    onImported: refreshAssets,
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
      onChange={handleProjectChange}
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
      onAddToTimeline={addAssetToTimeline}
      onDeleted={() => {
        refreshAssets();
        setSidePanel("");
      }}
      onOpenTranscript={openTranscript}
      repoPath={repoPath}
    />
  ) : sidePanel === "export" ? (
    <ExportPanel ffmpegReady={ffmpegReady} project={project} projectPath={projectPath} repoPath={repoPath} />
  ) : null;

  return (
    <PaneSurface data-video-pane="true">
      <PaneBody ref={bodyRef}>
        {view === "menu" || !project ? (
          <MenuScreen>
            <MenuCard>
              <MenuTitle>Video projects</MenuTitle>
              <VideoHint>
                Cut clips, keyframe audio, add titles, generate AI footage, and export — all inside
                this workspace's media/ folder. Agents can edit the same timeline files.
              </VideoHint>
              {tools && !ffmpegReady ? (
                installBusy ? (
                  <div style={{ display: "grid", gap: 4 }}>
                    <VideoProgressTrack>
                      <VideoProgressFill
                        style={{ width: `${Math.min(100, Math.max(3, installProgress?.percent || 3))}%` }}
                      />
                    </VideoProgressTrack>
                    <VideoHint>{installProgress?.message || "Installing ffmpeg…"}</VideoHint>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <VideoPaneButton onClick={installTools} type="button">
                      Install ffmpeg (~90 MB)
                    </VideoPaneButton>
                    <VideoHint>Powers thumbnails, preview metadata, and export.</VideoHint>
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
                <VideoInput
                  aria-label="New project name"
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="New project name…"
                  ref={createInputRef}
                  value={draftName}
                />
                <VideoPaneButton disabled={!draftName.trim() || !repoPath} type="submit">
                  Create
                </VideoPaneButton>
              </CreateRow>
              {projects.map((entry) => (
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
              {!projects.length ? <VideoHint>No projects yet — name one above to start.</VideoHint> : null}
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
                      <SplitPanel defaultSize="260px" id="video-split-library" key="library" minSize="190px">
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
                      <SplitPanel defaultSize="340px" id="video-split-side" key="side" minSize="280px">
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
            </EditorArea>
          </>
        )}
      </PaneBody>
    </PaneSurface>
  );
}
