import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Add } from "@styled-icons/material-rounded/Add";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { AutoAwesome } from "@styled-icons/material-rounded/AutoAwesome";
import { Image as ImageIcon } from "@styled-icons/material-rounded/Image";
import { Close } from "@styled-icons/material-rounded/Close";
import { ContentCut } from "@styled-icons/material-rounded/ContentCut";
import { CreateNewFolder } from "@styled-icons/material-rounded/CreateNewFolder";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Description } from "@styled-icons/material-rounded/Description";
import { DriveFileRenameOutline } from "@styled-icons/material-rounded/DriveFileRenameOutline";
import { FileUpload } from "@styled-icons/material-rounded/FileUpload";
import { Folder } from "@styled-icons/material-rounded/Folder";
import { FolderOpen } from "@styled-icons/material-rounded/FolderOpen";
import { GraphicEq } from "@styled-icons/material-rounded/GraphicEq";
import { History } from "@styled-icons/material-rounded/History";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { NearMe } from "@styled-icons/material-rounded/NearMe";
import { OpenInFull } from "@styled-icons/material-rounded/OpenInFull";
import { Pause } from "@styled-icons/material-rounded/Pause";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { Redo } from "@styled-icons/material-rounded/Redo";
import { Undo } from "@styled-icons/material-rounded/Undo";
import { Videocam } from "@styled-icons/material-rounded/Videocam";

import { PanelHeading, PanelKicker, PrimaryButton, PrimaryDangerButton, SecondaryButton } from "../app/appStyles";
import {
  GENERATION_MODELS,
  GEN_CAPABILITY_LABELS,
  defaultValuesFor,
  getGenerationModel,
  reconcileValues,
  validateGeneration,
  visibleParams,
} from "./generationCatalog";

const OPEN_PROJECT_STORAGE_KEY = "diffforge.editor.open-project.v1";
const ZOOM_STORAGE_KEY = "diffforge.editor.zoom.v1";
const ASSETS_MODE_STORAGE_KEY = "diffforge.editor.assets-mode.v1";
const GEN_MODEL_STORAGE_KEY = "diffforge.editor.gen-model.v1";
const GENERATIONS_FOLDER = "generations";
const MEDIA_CONVERSION_EVENT = "diffforge-editor-media-conversion-progress";

const GEN_HISTORY_STORAGE_PREFIX = "diffforge.editor.gen-history.";
const GEN_HISTORY_MAX = 100;

function loadAssetsMode() {
  if (typeof window === "undefined") {
    return "media";
  }
  try {
    const raw = window.localStorage.getItem(ASSETS_MODE_STORAGE_KEY);
    return raw === "generation" || raw === "split" ? raw : "media";
  } catch {
    return "media";
  }
}

function loadGenHistory(projectId) {
  if (typeof window === "undefined" || !projectId) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(GEN_HISTORY_STORAGE_PREFIX + projectId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveGenHistory(projectId, history) {
  if (typeof window === "undefined" || !projectId) {
    return;
  }
  try {
    window.localStorage.setItem(
      GEN_HISTORY_STORAGE_PREFIX + projectId,
      JSON.stringify(history.slice(-GEN_HISTORY_MAX)),
    );
  } catch {
    // best-effort
  }
}
const BASE_PX_PER_SECOND = 80;
const MIN_PX_PER_SECOND = 8;
const MAX_PX_PER_SECOND = 600;
const TRACK_GUTTER_PX = 120;
const MIN_CLIP_MS = 200;
const PREVIEW_DEBOUNCE_MS = 130;
const DEFAULT_FPS = 30;
const UNDO_DEPTH = 100;
const RANGE_SELECT_MIN_MS = 60;
const SNAP_THRESHOLD_PX = 8;
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_MAX_PX = 26;
const RULER_TARGET_PX = 84;
const RULER_NICE_STEPS_MS = [
  100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000,
  1800000, 3600000,
];

function clampZoom(pps) {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pps));
}

// Slider <-> zoom use a log mapping so a unit of travel scales zoom by a constant
// factor (uniform feel across the range).
function zoomToSlider(pps) {
  const ratio = Math.log(clampZoom(pps) / MIN_PX_PER_SECOND) / Math.log(MAX_PX_PER_SECOND / MIN_PX_PER_SECOND);
  return Math.round(ratio * 1000);
}

function sliderToZoom(value) {
  const ratio = Math.min(1, Math.max(0, value / 1000));
  return clampZoom(MIN_PX_PER_SECOND * (MAX_PX_PER_SECOND / MIN_PX_PER_SECOND) ** ratio);
}

const VIDEO_EXTENSIONS = ["webm", "mp4", "mov", "mkv", "m4v"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"];
const AUDIO_EXTENSIONS = ["opus", "ogg", "oga", "wav", "mp3", "m4a", "flac"];
const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS];
const MEDIA_TILE_MIN_PX = 118;

function pathBaseName(path) {
  const text = String(path || "");
  return text.split(/[\\/]/).filter(Boolean).pop() || "";
}

function isMp4MediaItem(item) {
  if (!item || item.isDir || item.kind !== "video") {
    return false;
  }
  return /\.mp4$/i.test(item.name || item.path || "");
}

function webmNameForMp4(name) {
  const base = String(name || "converted").replace(/\.mp4$/i, "");
  return `${base || "converted"}.webm`;
}

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(1, Math.max(0, number));
}

function conversionPhaseText(job) {
  if (job?.status === "failed") {
    return "Conversion failed";
  }
  if (job?.status === "complete") {
    return "WebM ready";
  }
  switch (job?.phase) {
    case "upload":
      return "Uploading MP4";
    case "render":
      return "Rendering WebM";
    case "download":
      return "Downloading WebM";
    default:
      return "Preparing conversion";
  }
}

function conversionDisplayName(job) {
  return job?.name || pathBaseName(job?.targetPath) || webmNameForMp4(pathBaseName(job?.sourcePath));
}

function msToPx(ms, pps) {
  return (Math.max(0, ms) / 1000) * pps;
}

function pxToMs(px, pps) {
  return (px / pps) * 1000;
}

// Pick a "nice" ruler interval so major ticks land ~RULER_TARGET_PX apart.
function rulerStepMs(pps) {
  const target = (RULER_TARGET_PX / pps) * 1000;
  for (const step of RULER_NICE_STEPS_MS) {
    if (step >= target) {
      return step;
    }
  }
  return RULER_NICE_STEPS_MS[RULER_NICE_STEPS_MS.length - 1];
}

// Nearest snap target within the pixel threshold; returns the target ms or null.
function nearestSnap(valueMs, targets, pps, thresholdPx = SNAP_THRESHOLD_PX) {
  let best = null;
  let bestPx = thresholdPx;
  const valuePx = msToPx(valueMs, pps);
  for (const t of targets) {
    const distPx = Math.abs(valuePx - msToPx(t, pps));
    if (distPx <= bestPx) {
      bestPx = distPx;
      best = t;
    }
  }
  return best;
}

function loadZoom() {
  if (typeof window === "undefined") {
    return BASE_PX_PER_SECOND;
  }
  try {
    const raw = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    return raw ? clampZoom(raw) : BASE_PX_PER_SECOND;
  } catch {
    return BASE_PX_PER_SECOND;
  }
}

function formatDuration(ms) {
  if (!ms || ms < 0) {
    return "0:00";
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Ruler labels: m:ss normally, m:ss.d (tenths) when the step is sub-second.
function formatRulerLabel(ms, stepMs) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  if (stepMs < 1000) {
    const seconds = (totalSeconds - minutes * 60).toFixed(1);
    return `${minutes}:${seconds.padStart(4, "0")}`;
  }
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCreatedAt(ms) {
  if (!ms) {
    return "Unknown date";
  }
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "Unknown date";
  }
}

function getErrorMessage(error, fallback) {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function loadOpenProjectId() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(OPEN_PROJECT_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function persistOpenProjectId(id) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (id) {
      window.localStorage.setItem(OPEN_PROJECT_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(OPEN_PROJECT_STORAGE_KEY);
    }
  } catch {
    // Best-effort; the gallery is a safe fallback.
  }
}

function clipLengthMs(clip) {
  return Math.max(MIN_CLIP_MS, (clip.outMs ?? clip.durationMs ?? 0) - (clip.inMs ?? 0));
}

// Coerce a clip from the backend (or a local edit) into a stable numeric shape.
function normalizeClip(clip) {
  const inMs = Math.max(0, Number(clip.inMs) || 0);
  const durationMs = Math.max(0, Number(clip.durationMs) || 0);
  const outMs = Number(clip.outMs) || durationMs || 0;
  return {
    ...clip,
    track: clip.track === "audio" ? "audio" : "video",
    startMs: Math.max(0, Number(clip.startMs) || 0),
    inMs,
    durationMs,
    outMs,
    gain: clip.gain == null ? 1 : Number(clip.gain),
    hasAudio: !!clip.hasAudio,
  };
}

function isMediaPath(path) {
  const lower = String(path || "").toLowerCase();
  return MEDIA_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

// Suppress native text/region selection for the duration of a pointer drag so
// dragging a clip/media tile doesn't paint selection highlights across the UI.
function setDragNoSelect(on) {
  if (typeof document === "undefined") {
    return;
  }
  document.body.style.userSelect = on ? "none" : "";
  document.body.style.webkitUserSelect = on ? "none" : "";
  if (on) {
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch {
      // ignore
    }
  }
}

function EditorWorkspaceView({ defaultWorkingDirectory = "" }) {
  const [projects, setProjects] = useState([]);
  const [projectsState, setProjectsState] = useState("loading");
  const [projectsError, setProjectsError] = useState("");
  const [openProjectId, setOpenProjectId] = useState(() => loadOpenProjectId());

  // null | { mode: "create" } | { mode: "rename", project } | { mode: "delete", project }
  const [dialog, setDialog] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const draftInputRef = useRef(null);

  const loadProjects = useCallback(async () => {
    setProjectsState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const list = await invoke("editor_list_projects");
      setProjects(Array.isArray(list) ? list : []);
      setProjectsState("ready");
      setProjectsError("");
    } catch (error) {
      setProjectsError(getErrorMessage(error, "Unable to load projects."));
      setProjectsState("error");
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    persistOpenProjectId(openProjectId);
  }, [openProjectId]);

  useEffect(() => {
    if (dialog?.mode === "create" || dialog?.mode === "rename") {
      const id = window.requestAnimationFrame(() => {
        draftInputRef.current?.focus();
        draftInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [dialog]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setDraftName("");
    setDraftLocation("");
    setDialogBusy(false);
  }, []);

  const startCreate = useCallback(() => {
    setDraftName("");
    setDraftLocation("");
    setDialog({ mode: "create" });
  }, []);

  const pickLocation = useCallback(async () => {
    try {
      const dir = await openDialog({ directory: true, multiple: false });
      if (typeof dir === "string" && dir) {
        setDraftLocation(dir);
      }
    } catch {
      // Cancelled or unavailable; keep the default storage location.
    }
  }, []);

  const startRename = useCallback((project) => {
    setDraftName(project.name);
    setDialog({ mode: "rename", project });
  }, []);

  const startDelete = useCallback((project) => {
    setDialog({ mode: "delete", project });
  }, []);

  const submitDialog = useCallback(
    async (event) => {
      event?.preventDefault?.();
      const trimmed = draftName.trim();
      if (!trimmed || dialogBusy) {
        return;
      }
      setDialogBusy(true);
      try {
        if (dialog?.mode === "create") {
          const project = await invoke("editor_create_project", {
            name: trimmed,
            location: draftLocation || null,
          });
          await loadProjects();
          closeDialog();
          if (project?.id) {
            setOpenProjectId(project.id);
          }
          return;
        }
        if (dialog?.mode === "rename") {
          await invoke("editor_rename_project", { id: dialog.project.id, name: trimmed });
          await loadProjects();
          closeDialog();
        }
      } catch (error) {
        setProjectsError(getErrorMessage(error, "Action failed."));
        setDialogBusy(false);
      }
    },
    [closeDialog, dialog, dialogBusy, draftName, draftLocation, loadProjects],
  );

  const confirmDelete = useCallback(async () => {
    if (dialog?.mode !== "delete" || dialogBusy) {
      return;
    }
    setDialogBusy(true);
    const targetId = dialog.project.id;
    try {
      await invoke("editor_delete_project", { id: targetId });
      setOpenProjectId((current) => (current === targetId ? null : current));
      await loadProjects();
      closeDialog();
    } catch (error) {
      setProjectsError(getErrorMessage(error, "Unable to delete project."));
      setDialogBusy(false);
    }
  }, [closeDialog, dialog, dialogBusy, loadProjects]);

  // Stable handlers so ProjectWorkbench's effects don't churn on parent re-renders.
  const handleBack = useCallback(() => setOpenProjectId(null), []);
  const handleMissing = useCallback(() => {
    setOpenProjectId(null);
    loadProjects();
  }, [loadProjects]);

  if (openProjectId) {
    return (
      <EditorRoot>
        <ProjectWorkbench
          key={openProjectId}
          projectId={openProjectId}
          onBack={handleBack}
          onMissing={handleMissing}
        />
        {dialog && (
          <EditorDialogs
            busy={dialogBusy}
            dialog={dialog}
            draftInputRef={draftInputRef}
            draftLocation={draftLocation}
            draftName={draftName}
            onClearLocation={() => setDraftLocation("")}
            onClose={closeDialog}
            onConfirmDelete={confirmDelete}
            onDraftChange={setDraftName}
            onPickLocation={pickLocation}
            onSubmit={submitDialog}
          />
        )}
      </EditorRoot>
    );
  }

  return (
    <EditorRoot>
      <GalleryScroll>
        {projectsError && <InlineError>{projectsError}</InlineError>}
        <ProjectGrid>
          <CreateCard onClick={startCreate} type="button">
            <CreateGlyph aria-hidden="true">
              <Add />
            </CreateGlyph>
            <CreateLabel>New project</CreateLabel>
          </CreateCard>
          {projects.map((project) => (
            <ProjectCard key={project.id}>
              <CardThumb aria-hidden="true">
                <Movie />
              </CardThumb>
              <CardBody>
                <CardName title={project.name}>{project.name}</CardName>
                <CardMeta>{formatCreatedAt(project.createdAtMs)}</CardMeta>
                <CardCounts>
                  {project.mediaCount || 0} clip{project.mediaCount === 1 ? "" : "s"} · {project.clipCount || 0} on
                  timeline
                </CardCounts>
              </CardBody>
              <CardHoverLayer>
                <CardPrimaryAction onClick={() => setOpenProjectId(project.id)} type="button">
                  <ButtonIcon as={OpenInFull} aria-hidden="true" />
                  <span>Open</span>
                </CardPrimaryAction>
                <CardSecondaryActions>
                  <CardIconButton
                    aria-label={`Rename ${project.name}`}
                    onClick={() => startRename(project)}
                    title="Rename"
                    type="button"
                  >
                    <DriveFileRenameOutline aria-hidden="true" />
                  </CardIconButton>
                  <CardIconButton
                    aria-label={`Delete ${project.name}`}
                    data-variant="danger"
                    onClick={() => startDelete(project)}
                    title="Delete"
                    type="button"
                  >
                    <DeleteOutline aria-hidden="true" />
                  </CardIconButton>
                </CardSecondaryActions>
              </CardHoverLayer>
            </ProjectCard>
          ))}
        </ProjectGrid>
      </GalleryScroll>

      {dialog && (
        <EditorDialogs
          busy={dialogBusy}
          dialog={dialog}
          draftInputRef={draftInputRef}
          draftLocation={draftLocation}
          draftName={draftName}
          onClearLocation={() => setDraftLocation("")}
          onClose={closeDialog}
          onConfirmDelete={confirmDelete}
          onDraftChange={setDraftName}
          onPickLocation={pickLocation}
          onSubmit={submitDialog}
        />
      )}
    </EditorRoot>
  );
}

function ProjectWorkbench({ projectId, onBack, onMissing }) {
  const [project, setProject] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [media, setMedia] = useState([]);
  const [mediaSubpath, setMediaSubpath] = useState(""); // current folder relative to media/
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Asset-box mode: media browser / generation form / split (both, resizable).
  const [assetsMode, setAssetsMode] = useState(() => loadAssetsMode());
  // Generation form state (Phase 1: UI + stubbed generate, no cloud).
  const [genModelId, setGenModelId] = useState(() => {
    let saved = "";
    try {
      saved = window.localStorage.getItem(GEN_MODEL_STORAGE_KEY) || "";
    } catch {
      saved = "";
    }
    return getGenerationModel(saved).id;
  });
  const [genMode, setGenMode] = useState(() => getGenerationModel(genModelId).capabilities[0]);
  const [genValues, setGenValues] = useState(() =>
    defaultValuesFor(getGenerationModel(genModelId), getGenerationModel(genModelId).capabilities[0]),
  );
  const [genBusy, setGenBusy] = useState(false);
  const [genConfirmOpen, setGenConfirmOpen] = useState(false);
  const [genAdvancedOpen, setGenAdvancedOpen] = useState(false);
  const [genError, setGenError] = useState("");
  const [pendingGenerations, setPendingGenerations] = useState([]); // [{ id, name, status }]
  const [mediaConversions, setMediaConversions] = useState([]);
  const [genFormat, setGenFormat] = useState("video"); // "video" | "image" (image disabled for now)
  const [genView, setGenView] = useState("form"); // "form" | "history"
  const [genHistory, setGenHistory] = useState(() => loadGenHistory(projectId));
  const [clips, setClips] = useState([]);
  const [probes, setProbes] = useState({});
  const [thumbs, setThumbs] = useState({});
  const [playheadMs, setPlayheadMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Session (ephemeral, not persisted, not undoable):
  const [selection, setSelection] = useState(null); // { startMs, endMs } | null
  const [activeClipId, setActiveClipId] = useState(null); // the focused clip (inspector target)
  const [selectedClipIds, setSelectedClipIds] = useState([]); // multi-select set
  const [tool, setTool] = useState("select"); // "select" | "razor"
  const [pxPerSecond, setPxPerSecond] = useState(() => loadZoom());
  const [snapLineMs, setSnapLineMs] = useState(null); // dashed snap indicator position, or null
  // Document-derived:
  const [settings, setSettings] = useState({ width: 1280, height: 720, fps: DEFAULT_FPS });
  const [waveforms, setWaveforms] = useState({}); // mediaPath -> { peaks, peaksPerSecond, durationMs }
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [mediaDrag, setMediaDrag] = useState(null); // { item, x, y } ghost while dragging media to the timeline
  const [mediaToDelete, setMediaToDelete] = useState(null); // media item pending delete confirmation

  // Persist the resizable layout across project opens / tab switches.
  const layoutStorage = useMemo(
    () => (typeof window !== "undefined" ? window.localStorage : undefined),
    [],
  );
  const rootLayout = useDefaultLayout({ id: "diffforge-editor-root-layout", storage: layoutStorage });
  const topLayout = useDefaultLayout({ id: "diffforge-editor-top-layout", storage: layoutStorage });
  const assetsSplitLayout = useDefaultLayout({
    id: "diffforge-editor-assets-split-layout",
    storage: layoutStorage,
  });

  const dragRef = useRef(null);
  const processedRef = useRef(new Set());
  const previewReqRef = useRef(0);
  const previewTimerRef = useRef(0);
  const lastDecodeRef = useRef(0);
  const mountedRef = useRef(true);
  const doImportRef = useRef(null);
  const timelineScrollRef = useRef(null); // the horizontally-scrolling timeline viewport
  const autoScrollRef = useRef(0); // active edge-autoscroll velocity (px/frame)
  const autoScrollRafRef = useRef(0);
  const conversionCleanupTimersRef = useRef(new Map());

  // The committed document (last server state) + in-session undo/redo of
  // committed snapshots. `clips` is the live working copy (may diverge mid-drag).
  const committedRef = useRef([]);
  const revisionRef = useRef(0);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const writeBusyRef = useRef(false); // serializes async writes (commit/undo/redo)

  // Refs mirroring fast-changing state so the lifetime listeners + key handler
  // read fresh values without re-subscribing.
  const clipsRef = useRef([]);
  const playheadRef = useRef(0);
  const selectionRef = useRef(null);
  const activeClipRef = useRef(null);
  const selectedClipIdsRef = useRef([]);
  const settingsRef = useRef({ fps: DEFAULT_FPS });
  const probesRef = useRef({});
  const mediaToDeleteRef = useRef(null);
  const newFolderOpenRef = useRef(false);
  const genConfirmOpenRef = useRef(false);
  const mediaSubpathRef = useRef("");
  const genDropRef = useRef(null); // (paramKey, multi, item) => set a generation image param from a drag
  const genHistoryScrollRef = useRef(null);
  const ppsRef = useRef(BASE_PX_PER_SECOND);
  const toolRef = useRef("select");
  const commitRef = useRef(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      window.clearTimeout(previewTimerRef.current);
      for (const timer of conversionCleanupTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      conversionCleanupTimersRef.current.clear();
    };
  }, []);

  // Read onMissing through a ref so the load effect does NOT depend on it.
  // (It's an inline arrow from the parent, recreated every render; depending on it
  // re-fired the load effect on every unrelated AppShell re-render, flipping to
  // the bare "loading" tree for a frame — the source of the view flicker.)
  const onMissingRef = useRef(onMissing);
  useEffect(() => {
    onMissingRef.current = onMissing;
  }, [onMissing]);

  const reloadMedia = useCallback(
    async (subpath) => {
      const sp = subpath === undefined ? mediaSubpathRef.current : subpath;
      try {
        const list = await invoke("editor_list_media", { id: projectId, subpath: sp || null });
        setMedia(Array.isArray(list) ? list : []);
      } catch (error) {
        setLoadError(getErrorMessage(error, "Unable to read project media."));
      }
    },
    [projectId],
  );

  useEffect(() => {
    let active = true;
    let dispose = () => {};
    const scheduleCleanup = (jobId) => {
      const currentTimer = conversionCleanupTimersRef.current.get(jobId);
      if (currentTimer) {
        window.clearTimeout(currentTimer);
      }
      const timer = window.setTimeout(() => {
        conversionCleanupTimersRef.current.delete(jobId);
        setMediaConversions((prev) => prev.filter((job) => job.id !== jobId));
      }, 1200);
      conversionCleanupTimersRef.current.set(jobId, timer);
    };
    (async () => {
      try {
        const unlisten = await listen(MEDIA_CONVERSION_EVENT, (event) => {
          if (!active) {
            return;
          }
          const payload = event?.payload || {};
          const jobId = String(payload.jobId || payload.job_id || "").trim();
          if (!jobId) {
            return;
          }
          const sourcePath = payload.sourcePath || payload.source_path || "";
          const targetPath = payload.targetPath || payload.target_path || payload.outputPath || "";
          const outputPath = payload.outputPath || payload.output_path || "";
          const status = payload.status || (payload.phase === "complete" ? "complete" : "running");
          const phase = payload.phase || "preparing";
          const subpath = payload.subpath || "";
          const progress = clampProgress(payload.progress);
          const totalBytes = Number(payload.totalBytes ?? payload.total_bytes ?? 0) || 0;
          const bytes = Number(payload.bytes ?? 0) || 0;
          setMediaConversions((prev) => {
            const existing = prev.find((job) => job.id === jobId);
            const next = {
              ...(existing || {}),
              id: jobId,
              sourcePath: sourcePath || existing?.sourcePath || "",
              targetPath: targetPath || existing?.targetPath || "",
              outputPath: outputPath || existing?.outputPath || "",
              subpath: subpath || existing?.subpath || "",
              name: payload.name || existing?.name || pathBaseName(targetPath) || "",
              phase,
              status,
              progress,
              bytes,
              totalBytes,
              message: payload.message || "",
              updatedAt: Date.now(),
            };
            if (existing) {
              return prev.map((job) => (job.id === jobId ? next : job));
            }
            return [...prev, next];
          });
          if (status === "complete" || phase === "complete") {
            reloadMedia();
            scheduleCleanup(jobId);
          }
        });
        if (active) {
          dispose = unlisten;
        } else {
          unlisten();
        }
      } catch {
        // Conversion progress events are optional; the invoke result still reports failure.
      }
    })();
    return () => {
      active = false;
      dispose();
    };
  }, [reloadMedia]);

  // Navigate into / out of media folders.
  const navigateToFolder = useCallback(
    (rel) => {
      const next = rel || "";
      setMediaSubpath(next);
      mediaSubpathRef.current = next;
      reloadMedia(next);
    },
    [reloadMedia],
  );

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) {
      return;
    }
    try {
      await invoke("editor_create_folder", {
        id: projectId,
        subpath: mediaSubpathRef.current || null,
        name,
      });
      await reloadMedia();
    } catch (error) {
      setLoadError(getErrorMessage(error, "Unable to create folder."));
    } finally {
      setNewFolderOpen(false);
      setNewFolderName("");
    }
  }, [projectId, newFolderName, reloadMedia]);

  // Load the project + its media folder. The backend returns enriched clips
  // (resolved mediaPath) + revision + settings; this is the committed baseline.
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryState({ canUndo: false, canRedo: false });
    (async () => {
      try {
        const loaded = await invoke("editor_get_project", { id: projectId });
        if (cancelled) {
          return;
        }
        setProject(loaded);
        const rawClips = Array.isArray(loaded?.timeline?.clips) ? loaded.timeline.clips : [];
        const normalized = rawClips.map(normalizeClip);
        setClips(normalized);
        committedRef.current = normalized;
        revisionRef.current = Number(loaded?.timeline?.revision) || 0;
        const s = loaded?.timeline?.settings || {};
        setSettings({
          width: Number(s.width) || 1280,
          height: Number(s.height) || 720,
          fps: Number(s.fps) || DEFAULT_FPS,
        });
        setLoadState("ready");
        await reloadMedia();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadError(getErrorMessage(error, "Unable to open project."));
        setLoadState("error");
        onMissingRef.current?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadMedia]);

  // Lazily probe + thumbnail each media item exactly once (keyed by path).
  // processedRef gates duplicates; mountedRef guards post-unmount state writes.
  useEffect(() => {
    media.forEach((item) => {
      const path = item.path;
      // Folders need no preview; images render directly (convertFileSrc); only
      // video/audio require backend probe/thumbnail/waveform work.
      if (!path || item.isDir || (item.kind !== "video" && item.kind !== "audio")) {
        return;
      }
      if (processedRef.current.has(path)) {
        return;
      }
      processedRef.current.add(path);
      const kind = item.kind;
      (async () => {
        let probeResult = null;
        try {
          probeResult = await invoke("editor_probe_media", { path });
          if (mountedRef.current) {
            setProbes((current) => ({ ...current, [path]: probeResult }));
          }
        } catch {
          if (mountedRef.current) {
            setProbes((current) => ({ ...current, [path]: { durationMs: 0, hasVideo: false } }));
          }
        }
        if (kind === "video") {
          try {
            const thumb = await invoke("editor_thumbnail", { path, timeMs: 0 });
            if (mountedRef.current) {
              setThumbs((current) => ({ ...current, [path]: thumb?.dataUrl || "" }));
            }
          } catch {
            if (mountedRef.current) {
              setThumbs((current) => ({ ...current, [path]: "" }));
            }
          }
        }
        // Generate a waveform for any source that carries audio (returns empty
        // peaks on failure, so this never blocks the rest of the workbench).
        if (probeResult?.hasAudio) {
          try {
            const wave = await invoke("editor_waveform", { path });
            if (mountedRef.current && wave?.peaks?.length) {
              setWaveforms((current) => ({ ...current, [path]: wave }));
            }
          } catch {
            // Waveforms are best-effort.
          }
        }
      })();
    });
  }, [media]);

  const totalMs = useMemo(() => {
    return clips.reduce((max, clip) => Math.max(max, (clip.startMs ?? 0) + clipLengthMs(clip)), 0);
  }, [clips]);

  const timelineWidthPx = useMemo(
    () => Math.max(msToPx(totalMs, pxPerSecond) + 240, 720),
    [totalMs, pxPerSecond],
  );

  // Snap targets: every clip edge + the playhead + origin (excluding clips being
  // dragged, supplied by the caller).
  const buildSnapTargets = useCallback((excludeIds, includePlayhead = true) => {
    const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
    const targets = [0];
    if (includePlayhead) {
      targets.push(playheadRef.current);
    }
    for (const clip of clipsRef.current) {
      if (exclude.has(clip.id)) {
        continue;
      }
      const start = clip.startMs ?? 0;
      targets.push(start, start + clipLengthMs(clip));
    }
    return targets;
  }, []);

  // The video clip currently under the playhead (for preview).
  const activeVideoClip = useMemo(() => {
    return (
      clips.find(
        (clip) =>
          clip.track === "video" &&
          playheadMs >= (clip.startMs ?? 0) &&
          playheadMs < (clip.startMs ?? 0) + clipLengthMs(clip),
      ) || null
    );
  }, [clips, playheadMs]);

  // Decode the preview frame as the playhead/active clip changes. Throttled
  // (leading + trailing) rather than debounced, so it keeps refreshing during
  // continuous playback instead of waiting for the playhead to stop.
  useEffect(() => {
    if (!activeVideoClip) {
      setPreviewUrl("");
      setPreviewBusy(false);
      return undefined;
    }
    const clip = activeVideoClip;
    const sourceTime = Math.max(0, playheadMs - (clip.startMs ?? 0) + (clip.inMs ?? 0));
    let cancelled = false;
    const decode = async () => {
      lastDecodeRef.current = performance.now();
      const reqId = previewReqRef.current + 1;
      previewReqRef.current = reqId;
      setPreviewBusy(true);
      try {
        const frame = await invoke("editor_decode_frame", {
          path: clip.mediaPath,
          timeMs: Math.round(sourceTime),
        });
        if (!cancelled && previewReqRef.current === reqId && mountedRef.current) {
          setPreviewUrl(frame?.dataUrl || "");
        }
      } catch {
        if (!cancelled && previewReqRef.current === reqId && mountedRef.current) {
          setPreviewUrl("");
        }
      } finally {
        if (previewReqRef.current === reqId && mountedRef.current) {
          setPreviewBusy(false);
        }
      }
    };
    const sinceLast = performance.now() - lastDecodeRef.current;
    if (sinceLast >= PREVIEW_DEBOUNCE_MS) {
      decode();
    } else {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = window.setTimeout(decode, PREVIEW_DEBOUNCE_MS - sinceLast);
    }
    return () => {
      cancelled = true;
    };
  }, [activeVideoClip, playheadMs]);

  // Simple real-time playback: advance the playhead; the preview follows (debounced).
  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const delta = now - last;
      last = now;
      setPlayheadMs((current) => {
        const next = current + delta;
        if (next >= totalMs) {
          setPlaying(false);
          return totalMs;
        }
        return next;
      });
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, totalMs]);

  // Native OS drag-and-drop of files onto the workbench.
  useEffect(() => {
    let dispose = () => {};
    let active = true;
    (async () => {
      try {
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (!active) {
            return;
          }
          const payload = event?.payload || {};
          if (payload.type === "over") {
            setDropActive(true);
          } else if (payload.type === "leave") {
            setDropActive(false);
          } else if (payload.type === "drop") {
            setDropActive(false);
            const paths = Array.isArray(payload.paths) ? payload.paths.filter(isMediaPath) : [];
            if (paths.length) {
              doImportRef.current?.(paths);
            }
          }
        });
        if (!active) {
          unlisten();
        } else {
          dispose = unlisten;
        }
      } catch {
        // Drag-drop is optional; the file picker still works.
      }
    })();
    return () => {
      active = false;
      dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const doImport = useCallback(
    async (paths) => {
      if (!paths?.length) {
        return;
      }
      setImportBusy(true);
      try {
        await invoke("editor_import_media", {
          id: projectId,
          sources: paths,
          subpath: mediaSubpathRef.current || null,
        });
        await reloadMedia();
      } catch (error) {
        setLoadError(getErrorMessage(error, "Import failed."));
      } finally {
        setImportBusy(false);
      }
    },
    [projectId, reloadMedia],
  );

  useEffect(() => {
    doImportRef.current = doImport;
  }, [doImport]);

  const pickFiles = useCallback(async () => {
    try {
      const selection = await openDialog({
        multiple: true,
        filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }],
      });
      if (!selection) {
        return;
      }
      const paths = Array.isArray(selection) ? selection : [selection];
      await doImport(paths);
    } catch (error) {
      setLoadError(getErrorMessage(error, "Could not open the file picker."));
    }
  }, [doImport]);

  // Adopt a server commit result as the new committed baseline + working copy.
  const applyResult = useCallback((result) => {
    const rawClips = Array.isArray(result?.timeline?.clips) ? result.timeline.clips : [];
    const normalized = rawClips.map(normalizeClip);
    committedRef.current = normalized;
    revisionRef.current = Number(result?.revision) || revisionRef.current;
    setClips(normalized);
    setLoadError("");
    // Prune selection refs that point at clips which no longer exist.
    const ids = new Set(normalized.map((c) => c.id));
    setSelectedClipIds((cur) => cur.filter((id) => ids.has(id)));
    setActiveClipId((cur) => (cur && ids.has(cur) ? cur : null));
    return normalized;
  }, []);

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);

  // The one authoritative write path. Snapshots the pre-edit committed doc for
  // undo, applies the op batch on the backend, then adopts the validated result.
  const commitOps = useCallback(
    async (ops) => {
      if (!ops || !ops.length) {
        return;
      }
      if (writeBusyRef.current) {
        // A write is already in flight; drop this edit but keep state consistent.
        setClips(committedRef.current);
        return;
      }
      writeBusyRef.current = true;
      const snapshot = committedRef.current;
      try {
        const result = await invoke("editor_apply_ops", { id: projectId, ops });
        undoStackRef.current.push(snapshot);
        if (undoStackRef.current.length > UNDO_DEPTH) {
          undoStackRef.current.shift();
        }
        redoStackRef.current = [];
        applyResult(result);
        syncHistoryState();
      } catch (error) {
        // Rejected: revert the working copy to the committed baseline.
        setClips(committedRef.current);
        setLoadError(getErrorMessage(error, "Edit was rejected."));
      } finally {
        writeBusyRef.current = false;
      }
    },
    [projectId, applyResult, syncHistoryState],
  );

  useEffect(() => {
    commitRef.current = commitOps;
  }, [commitOps]);

  // Undo/redo restore through the validated full-replace path. The stacks are
  // mutated ONLY after the write resolves (mirroring commitOps), so a failed
  // restore can never desync the history from the committed document.
  const doUndo = useCallback(async () => {
    if (writeBusyRef.current || !undoStackRef.current.length) {
      return;
    }
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    const current = committedRef.current;
    writeBusyRef.current = true;
    try {
      const result = await invoke("editor_save_timeline", { id: projectId, timeline: { clips: prev } });
      undoStackRef.current.pop();
      redoStackRef.current.push(current);
      applyResult(result);
      syncHistoryState();
    } catch (error) {
      setLoadError(getErrorMessage(error, "Unable to undo."));
    } finally {
      writeBusyRef.current = false;
    }
  }, [projectId, applyResult, syncHistoryState]);

  const doRedo = useCallback(async () => {
    if (writeBusyRef.current || !redoStackRef.current.length) {
      return;
    }
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    const current = committedRef.current;
    writeBusyRef.current = true;
    try {
      const result = await invoke("editor_save_timeline", { id: projectId, timeline: { clips: next } });
      redoStackRef.current.pop();
      undoStackRef.current.push(current);
      applyResult(result);
      syncHistoryState();
    } catch (error) {
      setLoadError(getErrorMessage(error, "Unable to redo."));
    } finally {
      writeBusyRef.current = false;
    }
  }, [projectId, applyResult, syncHistoryState]);

  const addClipToTimeline = useCallback(
    (item) => {
      // Only timeline-playable media (video/audio) can be placed for now.
      if (item.kind !== "video" && item.kind !== "audio") {
        return;
      }
      const probe = probes[item.path];
      const durationMs = Math.max(MIN_CLIP_MS, Math.round(probe?.durationMs || 5000));
      const track = item.kind === "audio" ? "audio" : "video";
      const trackEnd = committedRef.current
        .filter((clip) => clip.track === track)
        .reduce((max, clip) => Math.max(max, (clip.startMs ?? 0) + clipLengthMs(clip)), 0);
      commitOps([
        {
          type: "place_clip",
          mediaPath: item.path,
          track,
          kind: track,
          startMs: trackEnd,
          inMs: 0,
          outMs: durationMs,
          durationMs,
          hasAudio: !!probe?.hasAudio,
        },
      ]);
    },
    [probes, commitOps],
  );

  const removeClip = useCallback(
    (clipId) => {
      setActiveClipId((current) => (current === clipId ? null : current));
      commitOps([{ type: "remove_clip", clipId }]);
    },
    [commitOps],
  );

  // Begin dragging a media item toward the timeline (pointer-based, integrates
  // with the lifetime listeners). The ghost only appears once the pointer moves.
  const beginMediaDrag = useCallback((event, item) => {
    // video/audio drop onto the timeline; images drop onto generation slots. Both
    // use this one gesture (folders/"other" are not draggable).
    if (event.button !== 0 || (item.kind !== "video" && item.kind !== "audio" && item.kind !== "image")) {
      return;
    }
    setPlaying(false);
    setDragNoSelect(true);
    dragRef.current = {
      type: "media-drag",
      item,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }, []);

  // Delete a media file (after confirmation). Destructive + not undoable: the file
  // is gone, so this is intentionally kept off the undo stack.
  const deleteMedia = useCallback(
    async (item) => {
      if (!item || writeBusyRef.current) {
        setMediaToDelete(null);
        return;
      }
      writeBusyRef.current = true;
      try {
        const result = await invoke("editor_delete_media", { id: projectId, path: item.path });
        applyResult(result);
        processedRef.current.delete(item.path);
        setActiveClipId(null);
        await reloadMedia();
      } catch (error) {
        setLoadError(getErrorMessage(error, "Unable to delete media."));
      } finally {
        writeBusyRef.current = false;
        setMediaToDelete(null);
      }
    },
    [projectId, applyResult, reloadMedia],
  );

  const startMp4Conversion = useCallback(
    (item) => {
      if (!isMp4MediaItem(item)) {
        return;
      }
      const jobId = `webm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const subpath = mediaSubpathRef.current || "";
      const optimisticName = webmNameForMp4(item.name || pathBaseName(item.path));
      setMediaConversions((prev) => [
        ...prev,
        {
          id: jobId,
          sourcePath: item.path,
          targetPath: "",
          outputPath: "",
          subpath,
          name: optimisticName,
          phase: "preparing",
          status: "running",
          progress: 0,
          bytes: 0,
          totalBytes: Number(item.size) || 0,
          message: "",
          updatedAt: Date.now(),
        },
      ]);
      invoke("editor_convert_mp4_to_webm", {
        id: projectId,
        path: item.path,
        subpath: subpath || null,
        jobId,
      })
        .then((entry) => {
          if (entry?.path) {
            processedRef.current.delete(entry.path);
          }
          setMediaConversions((prev) =>
            prev.map((job) =>
              job.id === jobId
                ? {
                    ...job,
                    targetPath: entry?.path || job.targetPath,
                    outputPath: entry?.path || job.outputPath,
                    name: entry?.name || job.name,
                    phase: "complete",
                    status: "complete",
                    progress: 1,
                  }
                : job,
            ),
          );
          reloadMedia();
          const currentTimer = conversionCleanupTimersRef.current.get(jobId);
          if (currentTimer) {
            window.clearTimeout(currentTimer);
          }
          const timer = window.setTimeout(() => {
            conversionCleanupTimersRef.current.delete(jobId);
            setMediaConversions((prev) => prev.filter((job) => job.id !== jobId));
          }, 1200);
          conversionCleanupTimersRef.current.set(jobId, timer);
        })
        .catch((error) => {
          setMediaConversions((prev) =>
            prev.map((job) =>
              job.id === jobId
                ? {
                    ...job,
                    phase: "failed",
                    status: "failed",
                    message: getErrorMessage(error, "Conversion failed."),
                  }
                : job,
            ),
          );
        });
    },
    [projectId, reloadMedia],
  );

  const activeConversionBySource = useMemo(() => {
    const map = new Map();
    for (const job of mediaConversions) {
      if (!job.sourcePath || job.status === "failed" || job.status === "complete") {
        continue;
      }
      map.set(job.sourcePath, job);
    }
    return map;
  }, [mediaConversions]);

  // ----------------------------------------------------------------- generation

  const genModel = useMemo(() => getGenerationModel(genModelId), [genModelId]);

  const selectGenModel = useCallback((id) => {
    const model = getGenerationModel(id);
    const mode = model.capabilities[0];
    setGenModelId(model.id);
    setGenMode(mode);
    setGenValues((prev) => reconcileValues(model, mode, prev));
    setGenError("");
  }, []);

  const selectGenMode = useCallback(
    (mode) => {
      setGenMode(mode);
      setGenValues((prev) => reconcileValues(genModel, mode, prev));
      setGenError("");
    },
    [genModel],
  );

  const setGenValue = useCallback((key, value) => {
    setGenValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Set an image param (start frame / reference) from a dragged media item.
  const applyGenDrop = useCallback((key, multi, item) => {
    if (!item || item.kind !== "image") {
      return;
    }
    const picked = { name: item.name, path: item.path, kind: item.kind, rel: item.rel };
    setGenValues((prev) => {
      if (multi) {
        const list = Array.isArray(prev[key]) ? prev[key] : [];
        return { ...prev, [key]: [...list, picked] };
      }
      return { ...prev, [key]: picked };
    });
  }, []);

  useEffect(() => {
    genDropRef.current = applyGenDrop;
  }, [applyGenDrop]);

  const pickGenImage = useCallback(
    async (key, multi) => {
      try {
        const selection = await openDialog({
          multiple: !!multi,
          filters: [{ name: "Image", extensions: IMAGE_EXTENSIONS }],
        });
        if (!selection) {
          return;
        }
        const paths = Array.isArray(selection) ? selection : [selection];
        const picked = paths.map((path) => ({
          name: path.split(/[\\/]/).pop() || "image",
          path,
          kind: "image",
        }));
        setGenValues((prev) => {
          if (multi) {
            const list = Array.isArray(prev[key]) ? prev[key] : [];
            return { ...prev, [key]: [...list, ...picked] };
          }
          return { ...prev, [key]: picked[0] };
        });
      } catch (error) {
        setGenError(getErrorMessage(error, "Could not open the image picker."));
      }
    },
    [],
  );

  const clearGenImage = useCallback((key, index) => {
    setGenValues((prev) => {
      const current = prev[key];
      if (Array.isArray(current)) {
        return { ...prev, [key]: current.filter((_, i) => i !== index) };
      }
      return { ...prev, [key]: null };
    });
  }, []);

  // Ensure the project has a top-level `generations` folder (without disturbing the
  // user's current media view).
  const ensureGenerationsFolder = useCallback(async () => {
    try {
      const root = await invoke("editor_list_media", { id: projectId, subpath: null });
      const exists =
        Array.isArray(root) && root.some((entry) => entry.isDir && entry.name === GENERATIONS_FOLDER);
      if (!exists) {
        await invoke("editor_create_folder", { id: projectId, subpath: null, name: GENERATIONS_FOLDER });
      }
    } catch {
      // best-effort; the stub create_dir_all also makes the folder on write.
    }
  }, [projectId]);

  // Phase 1: run the stubbed generation (produces a real asset in generations/).
  const runStubGeneration = useCallback(async () => {
    const validation = validateGeneration(genModel, genMode, genValues);
    if (!validation.ok) {
      setGenError(Object.values(validation.errors)[0] || "Fill in the required fields.");
      return;
    }
    setGenConfirmOpen(false);
    setGenError("");
    setGenBusy(true);
    const jobId = `gen-${Date.now().toString(36)}`;
    const promptText = (genValues.prompt || "").trim();
    const baseName = `${genModel.id}-${promptText ? promptText.slice(0, 24).replace(/\s+/g, "-") : "gen"}`;
    const start = genValues.startImage && genValues.startImage.path ? genValues.startImage.path : null;
    setPendingGenerations((prev) => [...prev, { id: jobId, name: baseName, status: "generating" }]);
    await ensureGenerationsFolder();
    // Simulated latency so the generating overlay is visible.
    const snapshot = {
      mode: genMode,
      prompt: promptText,
      duration: genValues.duration,
      aspect: genValues.aspect,
      resolution: genValues.resolution,
      seed: genValues.seed,
      startImageName: genValues.startImage?.name,
      modelId: genModel.id,
      modelLabel: genModel.label,
    };
    window.setTimeout(async () => {
      try {
        const entry = await invoke("editor_stub_generation", { id: projectId, name: baseName, source: start });
        if (!mountedRef.current) {
          return;
        }
        setPendingGenerations((prev) => prev.filter((g) => g.id !== jobId));
        setGenHistory((prev) => [
          ...prev,
          {
            id: jobId,
            ts: Date.now(),
            ...snapshot,
            resultName: entry?.name || baseName,
            resultPath: entry?.path || "",
            resultRel: entry?.rel || "",
            resultKind: entry?.kind || "image",
          },
        ]);
        // Refresh the grid if the user is viewing the generations folder.
        if (mediaSubpathRef.current === GENERATIONS_FOLDER) {
          reloadMedia(GENERATIONS_FOLDER);
        }
      } catch (error) {
        if (mountedRef.current) {
          setPendingGenerations((prev) =>
            prev.map((g) => (g.id === jobId ? { ...g, status: "failed" } : g)),
          );
          setGenError(getErrorMessage(error, "Generation failed."));
        }
      } finally {
        if (mountedRef.current) {
          setGenBusy(false);
        }
      }
    }, 1400);
  }, [genModel, genMode, genValues, projectId, ensureGenerationsFolder, reloadMedia]);

  const requestGenerate = useCallback(() => {
    const validation = validateGeneration(genModel, genMode, genValues);
    if (!validation.ok) {
      setGenError(Object.values(validation.errors)[0] || "Fill in the required fields.");
      return;
    }
    setGenError("");
    setGenConfirmOpen(true);
  }, [genModel, genMode, genValues]);

  const openGenerationsFolder = useCallback(() => {
    setAssetsMode("media");
    navigateToFolder(GENERATIONS_FOLDER);
  }, [navigateToFolder]);

  // In-progress media jobs show as placeholder tiles in their source folder.
  const mediaGridItems = useMemo(() => {
    const conversionPlaceholders = mediaConversions
      .filter((job) => (job.subpath || "") === (mediaSubpath || ""))
      .map((job) => ({
        name: conversionDisplayName(job),
        path: `conversion:${job.id}`,
        rel: "",
        kind: "video",
        isDir: false,
        pendingConversion: true,
        jobId: job.id,
        status: job.status,
        phase: job.phase,
        progress: clampProgress(job.progress),
        bytes: job.bytes,
        totalBytes: job.totalBytes,
        message: job.message,
      }));
    const generationPlaceholders =
      mediaSubpath === GENERATIONS_FOLDER
        ? pendingGenerations.map((g) => ({
            name: g.name,
            path: `pending:${g.id}`,
            rel: "",
            kind: "video",
            isDir: false,
            pending: true,
            jobId: g.id,
            status: g.status,
          }))
        : [];
    return [...conversionPlaceholders, ...generationPlaceholders, ...media];
  }, [media, mediaSubpath, mediaConversions, pendingGenerations]);

  const splitActiveClip = useCallback(() => {
    const head = playheadRef.current;
    const clip =
      clipsRef.current.find((c) => c.id === activeClipRef.current) ||
      clipsRef.current.find(
        (c) => head > (c.startMs ?? 0) && head < (c.startMs ?? 0) + clipLengthMs(c),
      );
    if (!clip) {
      return;
    }
    const clipStart = clip.startMs ?? 0;
    if (head <= clipStart + MIN_CLIP_MS || head >= clipStart + clipLengthMs(clip) - MIN_CLIP_MS) {
      return;
    }
    commitOps([{ type: "split_clip", clipId: clip.id, atMs: Math.round(head) }]);
  }, [commitOps]);

  const deleteSelectionOrActive = useCallback(() => {
    const sel = selectionRef.current;
    if (sel && sel.endMs - sel.startMs >= RANGE_SELECT_MIN_MS) {
      commitOps([{ type: "delete_range", startMs: Math.round(sel.startMs), endMs: Math.round(sel.endMs) }]);
      setSelection(null);
      return;
    }
    const multi = selectedClipIdsRef.current;
    if (multi.length > 0) {
      setSelectedClipIds([]);
      setActiveClipId(null);
      commitOps(multi.map((id) => ({ type: "remove_clip", clipId: id })));
      return;
    }
    if (activeClipRef.current) {
      const id = activeClipRef.current;
      setActiveClipId(null);
      commitOps([{ type: "remove_clip", clipId: id }]);
    }
  }, [commitOps]);

  // Ripple-delete the time-range selection (closes the gap). Returns false when
  // there is no usable range so the caller can fall back to a normal delete.
  const rippleDeleteSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (!sel || sel.endMs - sel.startMs < RANGE_SELECT_MIN_MS) {
      return false;
    }
    commitOps([
      { type: "ripple_delete_range", startMs: Math.round(sel.startMs), endMs: Math.round(sel.endMs) },
    ]);
    setSelection(null);
    return true;
  }, [commitOps]);

  const nudgePlayhead = useCallback((deltaMs) => {
    setPlaying(false);
    setPlayheadMs((current) => Math.max(0, Math.round(current + deltaMs)));
  }, []);

  // Keep refs in sync with fast-changing state so the lifetime listeners and the
  // keyboard handler read fresh values without re-subscribing.
  useEffect(() => {
    clipsRef.current = clips;
    playheadRef.current = playheadMs;
    selectionRef.current = selection;
    activeClipRef.current = activeClipId;
    selectedClipIdsRef.current = selectedClipIds;
    settingsRef.current = settings;
    probesRef.current = probes;
    mediaToDeleteRef.current = mediaToDelete;
    newFolderOpenRef.current = newFolderOpen;
    genConfirmOpenRef.current = genConfirmOpen;
    mediaSubpathRef.current = mediaSubpath;
    ppsRef.current = pxPerSecond;
    toolRef.current = tool;
  });

  // Persist zoom across sessions.
  useEffect(() => {
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(pxPerSecond));
    } catch {
      // best-effort
    }
  }, [pxPerSecond]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSETS_MODE_STORAGE_KEY, assetsMode);
    } catch {
      // best-effort
    }
  }, [assetsMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GEN_MODEL_STORAGE_KEY, genModelId);
    } catch {
      // best-effort
    }
  }, [genModelId]);

  useEffect(() => {
    saveGenHistory(projectId, genHistory);
  }, [projectId, genHistory]);

  // ChatGPT-style: keep the history scrolled to the newest entry (bottom).
  useEffect(() => {
    if (genView !== "history") {
      return;
    }
    const el = genHistoryScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [genView, genHistory]);

  // A single set of window listeners for the component's lifetime. They read the
  // active gesture from dragRef (move/trim mutate the working copy live; the
  // commit happens once on pointerup). Snapping, group-move, and edge auto-scroll
  // all run through applyGesture so the keyboard, pointer, and auto-scroll paths
  // stay consistent.
  useEffect(() => {
    const scrollEl = () => timelineScrollRef.current;
    const stopAutoScroll = () => {
      autoScrollRef.current = 0;
      if (autoScrollRafRef.current) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = 0;
      }
    };

    const applyGesture = (clientX) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const pps = ppsRef.current;
      const scrollLeft = scrollEl()?.scrollLeft || 0;
      const deltaPx = clientX - drag.startX + (scrollLeft - (drag.startScrollLeft || 0));
      const deltaMs = pxToMs(deltaPx, pps);

      if (drag.type === "playhead") {
        let ms = Math.max(0, Math.round(drag.origPlayhead + deltaMs));
        const snap = nearestSnap(ms, buildSnapTargets(new Set(), false), pps);
        if (snap != null) {
          ms = Math.round(snap);
          setSnapLineMs(snap);
        } else {
          setSnapLineMs(null);
        }
        setPlayheadMs(ms);
        return;
      }

      if (drag.type === "move") {
        const ids = drag.groupOrig ? Object.keys(drag.groupOrig) : [drag.clipId];
        const targets = buildSnapTargets(new Set(ids));
        const len = drag.lenMs || 0;
        const rawStart = Math.max(0, drag.origStart + deltaMs);
        const snapStart = nearestSnap(rawStart, targets, pps);
        const snapEnd = nearestSnap(rawStart + len, targets, pps);
        let appliedDelta = deltaMs;
        let snapped = false;
        let snapIsEnd = false;
        if (
          snapStart != null &&
          (snapEnd == null || Math.abs(snapStart - rawStart) <= Math.abs(snapEnd - (rawStart + len)))
        ) {
          appliedDelta = snapStart - drag.origStart;
          snapped = true;
        } else if (snapEnd != null) {
          appliedDelta = snapEnd - len - drag.origStart;
          snapped = true;
          snapIsEnd = true;
        }
        // Place the indicator on the clip's ACTUAL edge after the >=0 clamp, so it
        // never floats off the clip when the start is pinned to the origin.
        if (snapped) {
          const actualStart = Math.max(0, Math.round(drag.origStart + appliedDelta));
          setSnapLineMs(snapIsEnd ? actualStart + len : actualStart);
        } else {
          setSnapLineMs(null);
        }
        setClips((current) =>
          current.map((clip) => {
            const orig = drag.groupOrig
              ? drag.groupOrig[clip.id]
              : clip.id === drag.clipId
                ? drag.origStart
                : undefined;
            if (orig === undefined) {
              return clip;
            }
            return { ...clip, startMs: Math.max(0, Math.round(orig + appliedDelta)) };
          }),
        );
        return;
      }

      if (drag.type === "trim-left") {
        const targets = buildSnapTargets(new Set([drag.clipId]));
        const maxIn = drag.origOut - MIN_CLIP_MS;
        let newIn = Math.min(Math.max(0, Math.round(drag.origIn + deltaMs)), maxIn);
        let newStart = Math.max(0, Math.round(drag.origStart + (newIn - drag.origIn)));
        const snap = nearestSnap(newStart, targets, pps);
        if (snap != null) {
          const adjIn = Math.min(Math.max(0, newIn + (snap - newStart)), maxIn);
          newStart = Math.max(0, drag.origStart + (adjIn - drag.origIn));
          newIn = adjIn;
          setSnapLineMs(newStart);
        } else {
          setSnapLineMs(null);
        }
        setClips((current) =>
          current.map((clip) =>
            clip.id === drag.clipId ? { ...clip, inMs: Math.round(newIn), startMs: Math.round(newStart) } : clip,
          ),
        );
        return;
      }

      if (drag.type === "trim-right") {
        const targets = buildSnapTargets(new Set([drag.clipId]));
        const minOut = drag.origIn + MIN_CLIP_MS;
        const cap = drag.durationMs > 0 ? drag.durationMs : Number.MAX_SAFE_INTEGER;
        let newOut = Math.min(Math.max(minOut, Math.round(drag.origOut + deltaMs)), cap);
        const rightEdge = drag.origStart + (newOut - drag.origIn);
        const snap = nearestSnap(rightEdge, targets, pps);
        if (snap != null) {
          newOut = Math.min(Math.max(minOut, drag.origIn + (snap - drag.origStart)), cap);
          setSnapLineMs(drag.origStart + (newOut - drag.origIn));
        } else {
          setSnapLineMs(null);
        }
        setClips((current) =>
          current.map((clip) => (clip.id === drag.clipId ? { ...clip, outMs: Math.round(newOut) } : clip)),
        );
      }
    };

    const updateAutoScroll = (clientX) => {
      const el = scrollEl();
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      let velocity = 0;
      if (clientX < rect.left + AUTOSCROLL_EDGE_PX) {
        velocity = -Math.ceil(((rect.left + AUTOSCROLL_EDGE_PX - clientX) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_PX);
      } else if (clientX > rect.right - AUTOSCROLL_EDGE_PX) {
        velocity = Math.ceil(((clientX - (rect.right - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_PX);
      }
      autoScrollRef.current = velocity;
      if (velocity !== 0 && !autoScrollRafRef.current) {
        const tick = () => {
          const drag = dragRef.current;
          const node = scrollEl();
          if (!drag || !node || autoScrollRef.current === 0) {
            autoScrollRafRef.current = 0;
            return;
          }
          node.scrollLeft = Math.max(0, node.scrollLeft + autoScrollRef.current);
          applyGesture(drag.lastX);
          autoScrollRafRef.current = window.requestAnimationFrame(tick);
        };
        autoScrollRafRef.current = window.requestAnimationFrame(tick);
      }
    };

    const handleMove = (event) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      if (drag.type === "media-drag") {
        if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
          drag.moved = true;
          setMediaDrag({ item: drag.item, x: event.clientX, y: event.clientY });
        }
        return;
      }
      if (drag.type === "range-select") {
        const ms = Math.max(0, Math.round(pxToMs(event.clientX - drag.laneLeft, ppsRef.current)));
        setSelection({ startMs: Math.min(drag.origMs, ms), endMs: Math.max(drag.origMs, ms) });
        return;
      }
      drag.lastX = event.clientX;
      applyGesture(event.clientX);
      if (drag.type === "move" || drag.type === "trim-left" || drag.type === "trim-right") {
        updateAutoScroll(event.clientX);
      }
    };

    const handleUp = (event) => {
      const drag = dragRef.current;
      dragRef.current = null;
      stopAutoScroll();
      setSnapLineMs(null);
      setDragNoSelect(false);
      if (!drag) {
        return;
      }
      if (drag.type === "media-drag") {
        setMediaDrag(null);
        if (!drag.moved) {
          return;
        }
        const el =
          typeof document !== "undefined" ? document.elementFromPoint(event.clientX, event.clientY) : null;
        const item = drag.item;
        // Generation drop slots take priority (drag-to-set-start-image / reference).
        const genDrop = el && el.closest ? el.closest("[data-gen-drop]") : null;
        if (genDrop && genDropRef.current) {
          genDropRef.current(genDrop.dataset.genDrop, genDrop.dataset.genMulti === "true", item);
          return;
        }
        // Otherwise drop onto a timeline lane (video/audio only).
        const lane = el && el.closest ? el.closest("[data-lane-track]") : null;
        if (!lane || (item.kind !== "video" && item.kind !== "audio")) {
          return;
        }
        const rect = lane.getBoundingClientRect();
        const startMs = Math.max(0, Math.round(pxToMs(event.clientX - rect.left, ppsRef.current)));
        const track = item.kind === "audio" ? "audio" : "video";
        const probe = probesRef.current[item.path];
        const durationMs = Math.max(MIN_CLIP_MS, Math.round(probe?.durationMs || 5000));
        commitRef.current?.([
          {
            type: "place_clip",
            mediaPath: item.path,
            track,
            kind: track,
            startMs,
            inMs: 0,
            outMs: durationMs,
            durationMs,
            hasAudio: !!probe?.hasAudio,
          },
        ]);
        return;
      }
      if (drag.type === "range-select") {
        setSelection((sel) => (sel && sel.endMs - sel.startMs >= RANGE_SELECT_MIN_MS ? sel : null));
        return;
      }
      const commit = commitRef.current;
      if (!commit) {
        setClips(committedRef.current);
        return;
      }
      const ops = [];
      if (drag.type === "move") {
        const ids = drag.groupOrig ? Object.keys(drag.groupOrig) : [drag.clipId];
        for (const id of ids) {
          const clip = clipsRef.current.find((c) => c.id === id);
          const orig = drag.groupOrig ? drag.groupOrig[id] : drag.origStart;
          if (clip && Math.round(clip.startMs) !== Math.round(orig)) {
            ops.push({ type: "move_clip", clipId: id, startMs: Math.round(clip.startMs) });
          }
        }
      } else if (drag.type === "trim-left") {
        const clip = clipsRef.current.find((c) => c.id === drag.clipId);
        if (
          clip &&
          (Math.round(clip.inMs) !== Math.round(drag.origIn) ||
            Math.round(clip.startMs) !== Math.round(drag.origStart))
        ) {
          ops.push({
            type: "trim_clip",
            clipId: clip.id,
            inMs: Math.round(clip.inMs),
            startMs: Math.round(clip.startMs),
          });
        }
      } else if (drag.type === "trim-right") {
        const clip = clipsRef.current.find((c) => c.id === drag.clipId);
        if (clip && Math.round(clip.outMs) !== Math.round(drag.origOut)) {
          ops.push({ type: "trim_clip", clipId: clip.id, outMs: Math.round(clip.outMs) });
        }
      }
      if (ops.length) {
        commit(ops);
      } else {
        setClips(committedRef.current);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      stopAutoScroll();
      setDragNoSelect(false);
    };
  }, [buildSnapTargets]);

  // Keyboard: playhead transport, split, delete, undo/redo. Inputs are ignored.
  useEffect(() => {
    if (loadState !== "ready") {
      return undefined;
    }
    const onKey = (event) => {
      const target = event.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      // While any modal is open, Escape closes it and all other timeline shortcuts
      // are suppressed (don't act on the timeline behind it).
      if (mediaToDeleteRef.current || newFolderOpenRef.current || genConfirmOpenRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          setMediaToDelete(null);
          setNewFolderOpen(false);
          setGenConfirmOpen(false);
        }
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      const fps = settingsRef.current?.fps || DEFAULT_FPS;
      const frameMs = 1000 / fps;
      if (meta && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        if (event.shiftKey) {
          doRedo();
        } else {
          doUndo();
        }
        return;
      }
      if (meta && (event.key === "y" || event.key === "Y")) {
        event.preventDefault();
        doRedo();
        return;
      }
      switch (event.key) {
        case " ":
          event.preventDefault();
          setPlaying((value) => !value);
          break;
        case "ArrowLeft":
          event.preventDefault();
          nudgePlayhead(event.shiftKey ? -1000 : -frameMs);
          break;
        case "ArrowRight":
          event.preventDefault();
          nudgePlayhead(event.shiftKey ? 1000 : frameMs);
          break;
        case "Home":
          event.preventDefault();
          setPlaying(false);
          setPlayheadMs(0);
          break;
        case "End":
          event.preventDefault();
          setPlaying(false);
          setPlayheadMs(
            clipsRef.current.reduce((m, c) => Math.max(m, (c.startMs ?? 0) + clipLengthMs(c)), 0),
          );
          break;
        case "s":
        case "S":
          event.preventDefault();
          splitActiveClip();
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          if (event.shiftKey && rippleDeleteSelection()) {
            break;
          }
          deleteSelectionOrActive();
          break;
        case "Escape":
          setSelection(null);
          setActiveClipId(null);
          setSelectedClipIds([]);
          break;
        case "v":
        case "V":
          setTool("select");
          break;
        case "c":
        case "C":
          setTool("razor");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadState, doUndo, doRedo, nudgePlayhead, splitActiveClip, deleteSelectionOrActive, rippleDeleteSelection]);

  const beginDrag = useCallback((event, descriptor) => {
    event.preventDefault();
    event.stopPropagation();
    setPlaying(false);
    setDragNoSelect(true);
    if (descriptor.clipId && !descriptor.groupOrig) {
      setActiveClipId(descriptor.clipId);
    }
    dragRef.current = {
      ...descriptor,
      startX: event.clientX,
      lastX: event.clientX,
      startScrollLeft: timelineScrollRef.current?.scrollLeft || 0,
    };
  }, []);

  const splitClipAtClientX = useCallback((clip, clientX, clipEl) => {
    if (!clipEl) {
      return;
    }
    const rect = clipEl.getBoundingClientRect();
    const within = pxToMs(clientX - rect.left, ppsRef.current);
    const len = clipLengthMs(clip);
    if (within <= MIN_CLIP_MS || within >= len - MIN_CLIP_MS) {
      return;
    }
    commitRef.current?.([{ type: "split_clip", clipId: clip.id, atMs: Math.round((clip.startMs ?? 0) + within) }]);
  }, []);

  // Clip press: razor splits; shift/⌘ toggles multi-select; plain press selects +
  // starts a move (group move if the clip is part of an existing multi-selection).
  const handleClipPointerDown = useCallback(
    (event, clip) => {
      if (event.button !== 0) {
        return;
      }
      if (toolRef.current === "razor") {
        event.preventDefault();
        event.stopPropagation();
        setPlaying(false);
        splitClipAtClientX(clip, event.clientX, event.currentTarget);
        return;
      }
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedClipIds((cur) =>
          cur.includes(clip.id) ? cur.filter((x) => x !== clip.id) : [...cur, clip.id],
        );
        setActiveClipId(clip.id);
        return;
      }
      const cur = selectedClipIdsRef.current;
      const inMulti = cur.length > 1 && cur.includes(clip.id);
      if (!inMulti) {
        setSelectedClipIds([clip.id]);
      }
      setActiveClipId(clip.id);
      let groupOrig;
      if (inMulti) {
        groupOrig = {};
        for (const id of cur) {
          const c = clipsRef.current.find((x) => x.id === id);
          if (c) {
            groupOrig[id] = c.startMs ?? 0;
          }
        }
      }
      beginDrag(event, {
        type: "move",
        clipId: clip.id,
        origStart: clip.startMs ?? 0,
        lenMs: clipLengthMs(clip),
        groupOrig,
      });
    },
    [beginDrag, splitClipAtClientX],
  );

  // Drag in empty lane space = create a time-range selection. Clips stop
  // propagation in handleClipPointerDown, so this only fires on bare lane.
  const beginRangeSelect = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    setPlaying(false);
    setDragNoSelect(true);
    setActiveClipId(null);
    setSelectedClipIds([]);
    const rect = event.currentTarget.getBoundingClientRect();
    const ms = Math.max(0, Math.round(pxToMs(event.clientX - rect.left, ppsRef.current)));
    dragRef.current = { type: "range-select", laneLeft: rect.left, origMs: ms };
    setSelection({ startMs: ms, endMs: ms });
  }, []);

  const scrubToClientX = useCallback(
    (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const ms = Math.max(0, Math.round(pxToMs(event.clientX - rect.left, ppsRef.current)));
      setPlaying(false);
      setSelection(null);
      setPlayheadMs(ms);
      beginDrag(event, { type: "playhead", origPlayhead: ms });
    },
    [beginDrag],
  );

  // Zoom around a focus time (default playhead), keeping it visually anchored.
  const applyZoom = useCallback((nextPps, focusMs) => {
    const clamped = clampZoom(nextPps);
    const prev = ppsRef.current;
    if (clamped === prev) {
      return;
    }
    const el = timelineScrollRef.current;
    const focus = focusMs == null ? playheadRef.current : focusMs;
    const scrollLeft = el?.scrollLeft || 0;
    const newScroll = Math.max(0, scrollLeft + msToPx(focus, clamped) - msToPx(focus, prev));
    setPxPerSecond(clamped);
    if (el) {
      window.requestAnimationFrame(() => {
        if (timelineScrollRef.current) {
          timelineScrollRef.current.scrollLeft = newScroll;
        }
      });
    }
  }, []);

  // ⌘/Ctrl + wheel = zoom (anchored at the pointer); plain wheel scrolls. Attached
  // natively (non-passive) so preventDefault works; re-binds when the timeline mounts.
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) {
      return undefined;
    }
    const onWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const focusMs = Math.max(
        0,
        pxToMs(event.clientX - rect.left + el.scrollLeft - TRACK_GUTTER_PX, ppsRef.current),
      );
      applyZoom(ppsRef.current * (event.deltaY < 0 ? 1.12 : 1 / 1.12), focusMs);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom, loadState]);

  if (loadState === "loading") {
    return (
      <Workbench>
        <WorkbenchHeader>
          <BackButton aria-label="Back to projects" onClick={onBack} title="Projects" type="button">
            <ArrowBack aria-hidden="true" />
          </BackButton>
        </WorkbenchHeader>
        <CenterFill>Loading project…</CenterFill>
      </Workbench>
    );
  }

  if (loadState === "error") {
    return (
      <Workbench>
        <WorkbenchHeader>
          <BackButton aria-label="Back to projects" onClick={onBack} title="Projects" type="button">
            <ArrowBack aria-hidden="true" />
          </BackButton>
        </WorkbenchHeader>
        <CenterFill>{loadError || "Unable to open project."}</CenterFill>
      </Workbench>
    );
  }

  const tickStepMs = rulerStepMs(pxPerSecond);
  const rulerTicks = [];
  for (let t = 0; msToPx(t, pxPerSecond) <= timelineWidthPx; t += tickStepMs) {
    rulerTicks.push(t);
  }

  const renderMediaTile = (item) => {
    if (item.pendingConversion) {
      const progress = clampProgress(item.progress);
      const percent = Math.round(progress * 100);
      return (
        <MediaTile data-kind="video" data-status={item.status}>
          <TileThumb data-kind="video">
            {item.status === "failed" ? (
              <Description aria-hidden="true" />
            ) : (
              <ConversionOverlay aria-hidden="true">
                <ConversionStage>{conversionPhaseText(item)}</ConversionStage>
                <ConversionProgressTrack>
                  <ConversionProgressFill style={{ width: `${percent}%` }} />
                </ConversionProgressTrack>
                <ConversionPercent>{percent}%</ConversionPercent>
              </ConversionOverlay>
            )}
          </TileThumb>
          <TileLabel title={item.message || item.name}>
            {item.status === "failed" ? "Conversion failed" : item.name}
          </TileLabel>
          {item.status === "failed" && (
            <TileDelete
              aria-label="Dismiss"
              onClick={(event) => {
                event.stopPropagation();
                setMediaConversions((prev) => prev.filter((job) => job.id !== item.jobId));
              }}
              onPointerDown={(event) => event.stopPropagation()}
              title={item.message || "Dismiss"}
              type="button"
            >
              <Close aria-hidden="true" />
            </TileDelete>
          )}
        </MediaTile>
      );
    }
    if (item.pending) {
      return (
        <MediaTile data-kind="video" data-status={item.status}>
          <TileThumb data-kind="video">
            {item.status === "failed" ? (
              <Description aria-hidden="true" />
            ) : (
              <GeneratingOverlay aria-hidden="true">
                <GeneratingBar />
                <span>Generating…</span>
              </GeneratingOverlay>
            )}
          </TileThumb>
          <TileLabel title={item.name}>{item.status === "failed" ? "Failed" : item.name}</TileLabel>
          <TileDelete
            aria-label="Dismiss"
            onClick={(event) => {
              event.stopPropagation();
              setPendingGenerations((prev) => prev.filter((g) => g.id !== item.jobId));
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title="Dismiss"
            type="button"
          >
            <Close aria-hidden="true" />
          </TileDelete>
        </MediaTile>
      );
    }
    const isFolder = item.isDir;
    const thumb = thumbs[item.path];
    const activeConversion = activeConversionBySource.get(item.path);
    const canConvertToWebm = isMp4MediaItem(item) && !activeConversion;
    return (
      <MediaTile
        data-kind={item.kind}
        onClick={isFolder ? () => navigateToFolder(item.rel) : undefined}
        onDoubleClick={isFolder ? undefined : () => addClipToTimeline(item)}
        onPointerDown={isFolder ? undefined : (event) => beginMediaDrag(event, item)}
        title={isFolder ? item.name : `${item.name} — drag to the timeline`}
      >
        <TileThumb data-kind={item.kind}>
          {isFolder ? (
            <Folder aria-hidden="true" />
          ) : item.kind === "image" ? (
            <TileImg alt="" draggable={false} loading="lazy" src={convertFileSrc(item.path)} />
          ) : item.kind === "video" ? (
            thumb ? (
              <TileImg alt="" draggable={false} src={thumb} />
            ) : (
              <Movie aria-hidden="true" />
            )
          ) : item.kind === "audio" ? (
            <GraphicEq aria-hidden="true" />
          ) : (
            <Description aria-hidden="true" />
          )}
          {item.kind === "video" && (
            <TilePlay aria-hidden="true">
              <PlayArrow />
            </TilePlay>
          )}
          {canConvertToWebm && (
            <TileConvertButton
              onClick={(event) => {
                event.stopPropagation();
                startMp4Conversion(item);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              title="Convert to WebM"
              type="button"
            >
              Convert to WebM
            </TileConvertButton>
          )}
        </TileThumb>
        <TileLabel title={item.name}>{item.name}</TileLabel>
        <TileDelete
          aria-label={`Delete ${item.name}`}
          onClick={(event) => {
            event.stopPropagation();
            setMediaToDelete(item);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          title={isFolder ? "Delete folder" : "Delete media"}
          type="button"
        >
          <Close aria-hidden="true" />
        </TileDelete>
      </MediaTile>
    );
  };

  const renderMediaPanel = () => (
    <MediaPanelFill>
      <PaneHeader>
        <MediaBreadcrumb>
          <Crumb
            data-current={mediaSubpath === "" ? "true" : "false"}
            onClick={() => navigateToFolder("")}
            type="button"
          >
            <PaneHeaderIcon as={FolderOpen} aria-hidden="true" />
            <span>Media</span>
          </Crumb>
          {mediaSubpath
            ? mediaSubpath.split("/").map((seg, idx, arr) => {
                const prefix = arr.slice(0, idx + 1).join("/");
                return (
                  <Fragment key={prefix}>
                    <CrumbSep aria-hidden="true">/</CrumbSep>
                    <Crumb
                      data-current={idx === arr.length - 1 ? "true" : "false"}
                      onClick={() => navigateToFolder(prefix)}
                      title={seg}
                      type="button"
                    >
                      <span>{seg}</span>
                    </Crumb>
                  </Fragment>
                );
              })
            : null}
        </MediaBreadcrumb>
        <PaneHeaderActions>
          <PaneIconButton
            aria-label="New folder"
            onClick={() => {
              setNewFolderName("");
              setNewFolderOpen(true);
            }}
            title="New folder"
            type="button"
          >
            <CreateNewFolder aria-hidden="true" />
          </PaneIconButton>
          <ImportButton disabled={importBusy} onClick={pickFiles} type="button">
            <ButtonIcon as={FileUpload} aria-hidden="true" />
            <span>{importBusy ? "Importing…" : "Import"}</span>
          </ImportButton>
        </PaneHeaderActions>
      </PaneHeader>
      <VirtualMediaGrid
        emptyState={
          <FolderEmpty>
            <Folder aria-hidden="true" />
            <span>{mediaSubpath ? "Empty folder" : "No media yet"}</span>
            <small>Import or drag-drop media files here.</small>
          </FolderEmpty>
        }
        items={mediaGridItems}
        renderItem={renderMediaTile}
      />
    </MediaPanelFill>
  );

  const renderGenField = (param) => {
    const value = genValues[param.key];
    if (param.type === "text") {
      return (
        <GenField key={param.key}>
          <GenLabel>
            {param.label}
            {param.required ? <GenRequired> *</GenRequired> : null}
          </GenLabel>
          <GenTextArea
            placeholder={param.placeholder || ""}
            rows={param.rows || 2}
            value={value || ""}
            onChange={(event) => setGenValue(param.key, event.target.value)}
          />
        </GenField>
      );
    }
    if (param.type === "enum") {
      return (
        <GenField key={param.key}>
          <GenLabel>{param.label}</GenLabel>
          <GenEnumRow>
            {param.values.map((option) => (
              <GenEnumButton
                key={String(option)}
                data-active={value === option ? "true" : "false"}
                onClick={() => setGenValue(param.key, option)}
                type="button"
              >
                {option}
                {param.unit || ""}
              </GenEnumButton>
            ))}
          </GenEnumRow>
        </GenField>
      );
    }
    if (param.type === "int") {
      return (
        <GenField key={param.key}>
          <GenLabel>{param.label}</GenLabel>
          <GenNumberInput
            max={param.max}
            min={param.min}
            onChange={(event) => setGenValue(param.key, event.target.value)}
            placeholder="auto"
            type="number"
            value={value ?? ""}
          />
        </GenField>
      );
    }
    if (param.type === "image") {
      return (
        <GenField key={param.key}>
          <GenLabel>
            {param.label}
            {param.required ? <GenRequired> *</GenRequired> : null}
          </GenLabel>
          <GenDropSlot data-gen-drop={param.key} data-gen-multi="false">
            {value && value.path ? (
              <>
                <GenDropImg alt="" src={convertFileSrc(value.path)} />
                <GenSlotClear
                  aria-label="Remove"
                  onClick={() => clearGenImage(param.key)}
                  type="button"
                >
                  <Close aria-hidden="true" />
                </GenSlotClear>
              </>
            ) : (
              <GenDropEmpty>
                <ImageIcon aria-hidden="true" />
                <span>Drag a start image here</span>
                <GenBrowse onClick={() => pickGenImage(param.key, false)} type="button">
                  Browse
                </GenBrowse>
              </GenDropEmpty>
            )}
          </GenDropSlot>
        </GenField>
      );
    }
    if (param.type === "imageList") {
      const list = Array.isArray(value) ? value : [];
      return (
        <GenField key={param.key}>
          <GenLabel>
            {param.label}
            {param.max ? <GenHint> · up to {param.max}</GenHint> : null}
          </GenLabel>
          <GenRefRow data-gen-drop={param.key} data-gen-multi="true">
            {list.map((ref, index) => (
              <GenRefSlot key={`${ref.path}-${index}`}>
                <GenDropImg alt="" src={convertFileSrc(ref.path)} />
                <GenSlotClear
                  aria-label="Remove"
                  onClick={() => clearGenImage(param.key, index)}
                  type="button"
                >
                  <Close aria-hidden="true" />
                </GenSlotClear>
              </GenRefSlot>
            ))}
            {(!param.max || list.length < param.max) && (
              <GenRefAdd onClick={() => pickGenImage(param.key, true)} type="button" title="Add reference">
                <Add aria-hidden="true" />
              </GenRefAdd>
            )}
          </GenRefRow>
        </GenField>
      );
    }
    return null;
  };

  const renderGenerationPanel = () => {
    const params = visibleParams(genModel, genMode);
    const basic = params.filter((p) => !p.advanced);
    const advanced = params.filter((p) => p.advanced);
    const valid = validateGeneration(genModel, genMode, genValues).ok;
    const fieldOrder = ["duration", "aspect", "resolution", "startImage", "references", "prompt"];
    const orderedBasic = [
      ...fieldOrder.map((key) => basic.find((p) => p.key === key)).filter(Boolean),
      ...basic.filter((p) => !fieldOrder.includes(p.key)),
    ];
    const videoModels = GENERATION_MODELS.filter((m) => m.capabilities.some((c) => c.endsWith("video")));
    const modes = genModel.capabilities;

    return (
      <GenPanelFill>
        <GenHeader>
          <GenTitle>
            <AutoAwesome aria-hidden="true" />
            <span>Generate</span>
          </GenTitle>
          <GenHeaderActions>
            <ToolButton
              aria-label="Generation history"
              data-active={genView === "history" ? "true" : "false"}
              onClick={() => setGenView((view) => (view === "history" ? "form" : "history"))}
              title="Generation history"
              type="button"
            >
              <History aria-hidden="true" />
            </ToolButton>
          </GenHeaderActions>
        </GenHeader>

        {genView === "history" ? (
          <>
            <GenHistoryScroll ref={genHistoryScrollRef}>
              {genHistory.length === 0 ? (
                <FolderEmpty>
                  <History aria-hidden="true" />
                  <span>No generations yet</span>
                  <small>Generations you create appear here, newest at the bottom.</small>
                </FolderEmpty>
              ) : (
                genHistory.map((item) => (
                  <GenHistoryItem key={item.id} item={item} onBeginDrag={beginMediaDrag} />
                ))
              )}
            </GenHistoryScroll>
            <GenSubmitBar>
              <GenResultsLink onClick={openGenerationsFolder} type="button">
                View generations
              </GenResultsLink>
              <SecondaryButton onClick={() => setGenView("form")} type="button">
                <ButtonIcon as={AutoAwesome} aria-hidden="true" />
                <span>New generation</span>
              </SecondaryButton>
            </GenSubmitBar>
          </>
        ) : (
          <>
            <GenForm>
              <GenField>
                <GenLabel>Format</GenLabel>
                <GenEnumRow>
                  <GenEnumButton
                    data-active={genFormat === "video" ? "true" : "false"}
                    onClick={() => setGenFormat("video")}
                    type="button"
                  >
                    Video
                  </GenEnumButton>
                  <GenEnumButton disabled title="Coming soon" type="button">
                    Image · soon
                  </GenEnumButton>
                </GenEnumRow>
              </GenField>

              <GenField>
                <GenLabel>Model</GenLabel>
                <GenEnumRow>
                  {videoModels.map((model) => (
                    <GenEnumButton
                      key={model.id}
                      data-active={genModelId === model.id ? "true" : "false"}
                      onClick={() => selectGenModel(model.id)}
                      type="button"
                    >
                      {model.label}
                    </GenEnumButton>
                  ))}
                </GenEnumRow>
              </GenField>

              {modes.length > 1 && (
                <GenField>
                  <GenLabel>Input</GenLabel>
                  <GenEnumRow>
                    {modes.map((cap) => (
                      <GenEnumButton
                        key={cap}
                        data-active={genMode === cap ? "true" : "false"}
                        onClick={() => selectGenMode(cap)}
                        type="button"
                      >
                        {GEN_CAPABILITY_LABELS[cap] || cap}
                      </GenEnumButton>
                    ))}
                  </GenEnumRow>
                </GenField>
              )}

              {orderedBasic.map((param) => renderGenField(param))}

              {advanced.length > 0 && (
                <GenAdvanced>
                  <GenAdvancedToggle onClick={() => setGenAdvancedOpen((open) => !open)} type="button">
                    {genAdvancedOpen ? "▾ Advanced" : "▸ Advanced"}
                  </GenAdvancedToggle>
                  {genAdvancedOpen && advanced.map((param) => renderGenField(param))}
                </GenAdvanced>
              )}

              {genError && <InlineError>{genError}</InlineError>}
            </GenForm>
            <GenSubmitBar>
              <GenResultsLink onClick={openGenerationsFolder} type="button" title="Open the generations folder">
                View generations
              </GenResultsLink>
              <PrimaryButton disabled={genBusy || !valid} onClick={requestGenerate} type="button">
                <ButtonIcon as={AutoAwesome} aria-hidden="true" />
                <span>{genBusy ? "Generating…" : "Generate"}</span>
              </PrimaryButton>
            </GenSubmitBar>
          </>
        )}
      </GenPanelFill>
    );
  };

  return (
    <Workbench>
      <WorkbenchHeader>
        <BackButton aria-label="Back to projects" onClick={onBack} title="Projects" type="button">
          <ArrowBack aria-hidden="true" />
        </BackButton>
        <WorkbenchTitle title={project?.name}>{project?.name}</WorkbenchTitle>
      </WorkbenchHeader>

      {loadError && <InlineError>{loadError}</InlineError>}

      <WorkbenchBody>
        <Group
          defaultLayout={rootLayout.defaultLayout}
          onLayoutChanged={rootLayout.onLayoutChanged}
          orientation="vertical"
        >
          <PanelBox defaultSize="62%" id="stage" minSize="28%">
            <Group
              defaultLayout={topLayout.defaultLayout}
              onLayoutChanged={topLayout.onLayoutChanged}
              orientation="horizontal"
            >
              <PanelBox defaultSize="32%" id="assets" maxSize="55%" minSize="16%">
                <FolderPane aria-label="Project media" data-drop-active={dropActive ? "true" : "false"}>
          <AssetsModeBar>
            <SegmentedControl>
              <SegmentButton
                data-active={assetsMode === "media" ? "true" : "false"}
                onClick={() => setAssetsMode("media")}
                type="button"
              >
                <FolderOpen aria-hidden="true" />
                <span>Media</span>
              </SegmentButton>
              <SegmentButton
                data-active={assetsMode === "generation" ? "true" : "false"}
                onClick={() => setAssetsMode("generation")}
                type="button"
              >
                <AutoAwesome aria-hidden="true" />
                <span>Generate</span>
              </SegmentButton>
              <SegmentButton
                data-active={assetsMode === "split" ? "true" : "false"}
                onClick={() => setAssetsMode("split")}
                type="button"
              >
                <span>Split</span>
              </SegmentButton>
            </SegmentedControl>
          </AssetsModeBar>

          {assetsMode === "media" && renderMediaPanel()}
          {assetsMode === "generation" && renderGenerationPanel()}
          {assetsMode === "split" && (
            <AssetsSplitFill>
              <Group
                defaultLayout={assetsSplitLayout.defaultLayout}
                onLayoutChanged={assetsSplitLayout.onLayoutChanged}
                orientation="horizontal"
              >
                <PanelBox defaultSize="50%" id="assets-media" minSize="28%">
                  {renderMediaPanel()}
                </PanelBox>
                <ColHandle />
                <PanelBox id="assets-gen" minSize="28%">
                  {renderGenerationPanel()}
                </PanelBox>
              </Group>
            </AssetsSplitFill>
          )}
          {dropActive && <DropOverlay>Drop media files to import</DropOverlay>}
                </FolderPane>
              </PanelBox>
              <ColHandle />
              <PanelBox id="player" minSize="32%">
                <ViewerPane aria-label="WebM viewer">
            <ViewerFrame>
              {previewUrl ? (
                <PreviewImg alt="Preview frame" src={previewUrl} />
              ) : (
                <ViewerEmpty>
                  <ViewerGlyph aria-hidden="true">
                    <Videocam />
                  </ViewerGlyph>
                  <ViewerEmptyText>{previewBusy ? "Decoding…" : "No frame at playhead"}</ViewerEmptyText>
                  <ViewerEmptyHint>Add a clip and move the playhead to preview.</ViewerEmptyHint>
                </ViewerEmpty>
              )}
            </ViewerFrame>
            <TransportBar>
              <TransportButton
                aria-label={playing ? "Pause" : "Play"}
                disabled={totalMs <= 0}
                onClick={() => setPlaying((value) => !value)}
                title={playing ? "Pause" : "Play"}
                type="button"
              >
                {playing ? <Pause aria-hidden="true" /> : <PlayArrow aria-hidden="true" />}
              </TransportButton>
              <TransportTime>
                <TimecodeNow>{formatDuration(playheadMs)}</TimecodeNow>
                <TransportSep>/</TransportSep>
                {formatDuration(totalMs)}
              </TransportTime>
            </TransportBar>
                </ViewerPane>
              </PanelBox>
            </Group>
          </PanelBox>
          <RowHandle />
          <PanelBox defaultSize="38%" id="timeline" minSize="16%">
            <TimelinePane aria-label="Timeline">
            <TimelineHeader>
              <PaneHeaderText>Timeline</PaneHeaderText>
              <TimelineTools>
                <ToolButton
                  data-active={tool === "select" ? "true" : "false"}
                  aria-label="Select tool"
                  onClick={() => setTool("select")}
                  title="Select (V)"
                  type="button"
                >
                  <NearMe aria-hidden="true" />
                </ToolButton>
                <ToolButton
                  data-active={tool === "razor" ? "true" : "false"}
                  aria-label="Razor tool"
                  onClick={() => setTool("razor")}
                  title="Razor — click a clip to split (C)"
                  type="button"
                >
                  <ContentCut aria-hidden="true" />
                </ToolButton>
                <ToolDivider />
                <ToolButton
                  aria-label="Undo"
                  disabled={!historyState.canUndo}
                  onClick={doUndo}
                  title="Undo (⌘Z)"
                  type="button"
                >
                  <Undo aria-hidden="true" />
                </ToolButton>
                <ToolButton
                  aria-label="Redo"
                  disabled={!historyState.canRedo}
                  onClick={doRedo}
                  title="Redo (⌘⇧Z)"
                  type="button"
                >
                  <Redo aria-hidden="true" />
                </ToolButton>
                <ToolDivider />
                <ToolButton
                  aria-label="Delete selection or clip"
                  onClick={deleteSelectionOrActive}
                  title="Delete selection / clip (⌫)"
                  type="button"
                >
                  <DeleteOutline aria-hidden="true" />
                </ToolButton>
              </TimelineTools>
              <ZoomControl>
                <ZoomSlider
                  aria-label="Timeline zoom"
                  max="1000"
                  min="0"
                  onChange={(event) => applyZoom(sliderToZoom(Number(event.target.value)))}
                  type="range"
                  value={zoomToSlider(pxPerSecond)}
                />
              </ZoomControl>
              <TimelineZoomHint>{Math.round(settings.fps)} fps</TimelineZoomHint>
            </TimelineHeader>
            <TimelineScroll ref={timelineScrollRef}>
              <TimelineContent style={{ width: `${TRACK_GUTTER_PX + timelineWidthPx}px` }}>
                <TimelineRuler>
                  <TimelineTrackGutter />
                  <TimelineRulerTrack onPointerDown={scrubToClientX} style={{ width: `${timelineWidthPx}px` }}>
                    {rulerTicks.map((tick) => (
                      <TimelineTick key={tick} style={{ left: `${msToPx(tick, pxPerSecond)}px` }}>
                        {formatRulerLabel(tick, tickStepMs)}
                      </TimelineTick>
                    ))}
                  </TimelineRulerTrack>
                </TimelineRuler>

                {["video", "audio"].map((track) => (
                  <TimelineTrack key={track}>
                    <TimelineTrackLabel>
                      <TrackIcon as={track === "video" ? Movie : GraphicEq} aria-hidden="true" />
                      <span>{track === "video" ? "Video" : "Audio"}</span>
                    </TimelineTrackLabel>
                    <TimelineLane
                      data-track={track}
                      data-lane-track={track}
                      data-tool={tool}
                      onPointerDown={beginRangeSelect}
                      style={{ width: `${timelineWidthPx}px`, "--sec-px": `${pxPerSecond}px` }}
                    >
                      {clips.filter((clip) => clip.track === track).length === 0 && (
                        <TimelineLanePlaceholder>
                          {track === "video" ? "Add video clips from the media panel" : "Add audio from the media panel"}
                        </TimelineLanePlaceholder>
                      )}
                      {clips
                        .filter((clip) => clip.track === track)
                        .map((clip) => (
                          <TimelineClip
                            key={clip.id}
                            data-track={track}
                            data-tool={tool}
                            data-active={activeClipId === clip.id ? "true" : "false"}
                            data-selected={selectedClipIds.includes(clip.id) ? "true" : "false"}
                            onPointerDown={(event) => handleClipPointerDown(event, clip)}
                            style={{
                              left: `${msToPx(clip.startMs ?? 0, pxPerSecond)}px`,
                              width: `${msToPx(clipLengthMs(clip), pxPerSecond)}px`,
                            }}
                            title={clip.name}
                          >
                            {waveforms[clip.mediaPath] && (
                              <WaveformStrip
                                inMs={clip.inMs ?? 0}
                                outMs={clip.outMs ?? clip.durationMs ?? 0}
                                wave={waveforms[clip.mediaPath]}
                              />
                            )}
                            <ClipTrimHandle
                              data-edge="left"
                              onPointerDown={(event) =>
                                beginDrag(event, {
                                  type: "trim-left",
                                  clipId: clip.id,
                                  origIn: clip.inMs ?? 0,
                                  origOut: clip.outMs ?? clip.durationMs ?? 0,
                                  origStart: clip.startMs ?? 0,
                                  durationMs: clip.durationMs ?? 0,
                                })
                              }
                            />
                            <ClipLabel>{clip.name}</ClipLabel>
                            {msToPx(clipLengthMs(clip), pxPerSecond) > 96 && (
                              <ClipDuration>{formatDuration(clipLengthMs(clip))}</ClipDuration>
                            )}
                            <ClipRemove
                              aria-label={`Remove ${clip.name}`}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() => removeClip(clip.id)}
                              title="Remove from timeline"
                              type="button"
                            >
                              <Close aria-hidden="true" />
                            </ClipRemove>
                            <ClipTrimHandle
                              data-edge="right"
                              onPointerDown={(event) =>
                                beginDrag(event, {
                                  type: "trim-right",
                                  clipId: clip.id,
                                  origIn: clip.inMs ?? 0,
                                  origOut: clip.outMs ?? clip.durationMs ?? 0,
                                  origStart: clip.startMs ?? 0,
                                  durationMs: clip.durationMs ?? 0,
                                })
                              }
                            />
                          </TimelineClip>
                        ))}
                    </TimelineLane>
                  </TimelineTrack>
                ))}

                {selection && selection.endMs > selection.startMs && (
                  <SelectionBand
                    aria-hidden="true"
                    style={{
                      left: `${TRACK_GUTTER_PX + msToPx(selection.startMs, pxPerSecond)}px`,
                      width: `${msToPx(selection.endMs - selection.startMs, pxPerSecond)}px`,
                    }}
                  />
                )}
                {snapLineMs != null && (
                  <SnapIndicator
                    aria-hidden="true"
                    style={{ left: `${TRACK_GUTTER_PX + msToPx(snapLineMs, pxPerSecond)}px` }}
                  />
                )}
                <TimelinePlayhead
                  aria-hidden="true"
                  style={{ left: `${TRACK_GUTTER_PX + msToPx(playheadMs, pxPerSecond)}px` }}
                />
              </TimelineContent>
            </TimelineScroll>
            </TimelinePane>
          </PanelBox>
        </Group>
      </WorkbenchBody>

      {mediaDrag && (
        <MediaDragGhost style={{ left: `${mediaDrag.x + 14}px`, top: `${mediaDrag.y + 12}px` }}>
          <Movie aria-hidden="true" />
          <span>{mediaDrag.item.name}</span>
        </MediaDragGhost>
      )}

      {mediaToDelete && (
        <DialogScrim onMouseDown={() => setMediaToDelete(null)}>
          <DialogCard onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <DialogHeader>
              <div>
                <PanelKicker>{mediaToDelete.isDir ? "Delete folder" : "Delete media"}</PanelKicker>
                <PanelHeading>{mediaToDelete.name}</PanelHeading>
              </div>
              <DialogClose aria-label="Close" onClick={() => setMediaToDelete(null)} type="button">
                <Close aria-hidden="true" />
              </DialogClose>
            </DialogHeader>
            <DialogBody>
              {mediaToDelete.isDir ? (
                <>
                  This deletes the folder <strong>{mediaToDelete.name}</strong> and everything inside it, plus
                  any timeline clips that use that media. This can&apos;t be undone.
                </>
              ) : (
                <>
                  This removes <strong>{mediaToDelete.name}</strong> from the project and deletes any timeline
                  clips that use it. This can&apos;t be undone.
                </>
              )}
            </DialogBody>
            <DialogActions>
              <SecondaryButton onClick={() => setMediaToDelete(null)} type="button">
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryDangerButton onClick={() => deleteMedia(mediaToDelete)} type="button">
                <ButtonIcon as={DeleteOutline} aria-hidden="true" />
                <span>{mediaToDelete.isDir ? "Delete folder" : "Delete media"}</span>
              </PrimaryDangerButton>
            </DialogActions>
          </DialogCard>
        </DialogScrim>
      )}

      {newFolderOpen && (
        <DialogScrim onMouseDown={() => setNewFolderOpen(false)}>
          <DialogCard onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <DialogHeader>
              <div>
                <PanelKicker>New folder</PanelKicker>
                <PanelHeading>Create a folder</PanelHeading>
              </div>
              <DialogClose aria-label="Close" onClick={() => setNewFolderOpen(false)} type="button">
                <Close aria-hidden="true" />
              </DialogClose>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                createFolder();
              }}
            >
              <DialogLabel htmlFor="editor-new-folder">Folder name</DialogLabel>
              <DialogInput
                autoComplete="off"
                autoFocus
                id="editor-new-folder"
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setNewFolderOpen(false);
                  }
                }}
                placeholder="New folder"
                spellCheck={false}
                value={newFolderName}
              />
              <DialogActions>
                <SecondaryButton onClick={() => setNewFolderOpen(false)} type="button">
                  <span>Cancel</span>
                </SecondaryButton>
                <PrimaryButton disabled={!newFolderName.trim()} type="submit">
                  <ButtonIcon as={CreateNewFolder} aria-hidden="true" />
                  <span>Create folder</span>
                </PrimaryButton>
              </DialogActions>
            </form>
          </DialogCard>
        </DialogScrim>
      )}

      {genConfirmOpen && (
        <DialogScrim onMouseDown={() => setGenConfirmOpen(false)}>
          <DialogCard onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <DialogHeader>
              <div>
                <PanelKicker>Generate</PanelKicker>
                <PanelHeading>{genModel.label}</PanelHeading>
              </div>
              <DialogClose aria-label="Close" onClick={() => setGenConfirmOpen(false)} type="button">
                <Close aria-hidden="true" />
              </DialogClose>
            </DialogHeader>
            <DialogBody>
              <GenConfirmRow>
                <span>Mode</span>
                <strong>{GEN_CAPABILITY_LABELS[genMode] || genMode}</strong>
              </GenConfirmRow>
              {genValues.duration != null && (
                <GenConfirmRow>
                  <span>Duration</span>
                  <strong>{genValues.duration}s</strong>
                </GenConfirmRow>
              )}
              {genValues.aspect && (
                <GenConfirmRow>
                  <span>Aspect / Res</span>
                  <strong>
                    {genValues.aspect}
                    {genValues.resolution ? ` · ${genValues.resolution}` : ""}
                  </strong>
                </GenConfirmRow>
              )}
              {genValues.startImage && genValues.startImage.name && (
                <GenConfirmRow>
                  <span>Start image</span>
                  <strong>{genValues.startImage.name}</strong>
                </GenConfirmRow>
              )}
              <GenConfirmNote>
                Preview build — this runs a local stub and writes a placeholder into the
                <strong> generations</strong> folder. No model is called and nothing is charged.
              </GenConfirmNote>
            </DialogBody>
            <DialogActions>
              <SecondaryButton onClick={() => setGenConfirmOpen(false)} type="button">
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryButton onClick={runStubGeneration} type="button">
                <ButtonIcon as={AutoAwesome} aria-hidden="true" />
                <span>Generate</span>
              </PrimaryButton>
            </DialogActions>
          </DialogCard>
        </DialogScrim>
      )}
    </Workbench>
  );
}

// A dependency-free virtualized square-tile grid: measures its own width via
// ResizeObserver, computes columns from a target tile size, and renders only the
// rows intersecting the viewport (plus overscan). Tiles fill the column width and
// are square (the thumb uses aspect-ratio: 1).
function VirtualMediaGrid({
  items,
  renderItem,
  emptyState,
  minTile = MEDIA_TILE_MIN_PX,
  gap = 10,
  labelHeight = 30,
  overscanRows = 2,
}) {
  const scrollRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setBox({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(el);
    setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const PAD = 10;
  const layout = useMemo(() => {
    const avail = Math.max(0, box.width - PAD * 2);
    const cols = Math.max(1, Math.floor((avail + gap) / (minTile + gap)));
    const cellW = Math.max(minTile, Math.floor((avail - gap * (cols - 1)) / cols));
    const rowHeight = cellW + labelHeight + gap;
    const rows = Math.ceil(items.length / cols);
    return { cols, cellW, rowHeight, rows, totalHeight: rows * rowHeight + PAD * 2 };
  }, [box.width, items.length, gap, labelHeight, minTile]);

  if (!items.length) {
    return <GridScroll ref={scrollRef}>{emptyState}</GridScroll>;
  }

  const { cols, cellW, rowHeight, rows, totalHeight } = layout;
  const cells = [];
  if (box.width > 0) {
    const firstRow = Math.max(0, Math.floor((scrollTop - PAD) / rowHeight) - overscanRows);
    const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + box.height - PAD) / rowHeight) + overscanRows);
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        if (i >= items.length) {
          break;
        }
        const item = items[i];
        cells.push(
          <div
            key={item.path}
            style={{
              position: "absolute",
              left: PAD + col * (cellW + gap),
              top: PAD + row * rowHeight,
              width: cellW,
              height: rowHeight - gap,
            }}
          >
            {renderItem(item)}
          </div>,
        );
      }
    }
  }

  return (
    <GridScroll ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ position: "relative", height: totalHeight }}>{cells}</div>
    </GridScroll>
  );
}

// One generation-history entry (ChatGPT-style): thumbnail + the settings used.
// Drag it to the timeline if the result still exists in the generations folder
// (a broken thumbnail means it was deleted, so we mark it removed + non-draggable).
function GenHistoryItem({ item, onBeginDrag }) {
  const [missing, setMissing] = useState(false);
  const mediaLike = {
    name: item.resultName,
    path: item.resultPath,
    kind: item.resultKind || "video",
    rel: item.resultRel,
  };
  const settings = [item.duration ? `${item.duration}s` : null, item.aspect, item.resolution]
    .filter(Boolean)
    .join(" · ");
  return (
    <GenHistoryCard>
      <GenHistoryThumb
        data-missing={missing ? "true" : "false"}
        onPointerDown={missing || !item.resultPath ? undefined : (event) => onBeginDrag(event, mediaLike)}
        title={missing ? "Removed from generations" : "Drag to the timeline"}
      >
        {missing || !item.resultPath ? (
          <Description aria-hidden="true" />
        ) : (
          <img
            alt=""
            draggable={false}
            onError={() => setMissing(true)}
            src={convertFileSrc(item.resultPath)}
          />
        )}
        {!missing && item.resultKind === "video" && (
          <TilePlay aria-hidden="true">
            <PlayArrow />
          </TilePlay>
        )}
      </GenHistoryThumb>
      <GenHistoryMeta>
        <GenHistoryModel>
          {item.modelLabel}
          {item.mode ? ` · ${GEN_CAPABILITY_LABELS[item.mode] || item.mode}` : ""}
        </GenHistoryModel>
        <GenHistoryPrompt>{item.prompt ? item.prompt : "No prompt"}</GenHistoryPrompt>
        {settings ? <GenHistorySettings>{settings}</GenHistorySettings> : null}
      </GenHistoryMeta>
    </GenHistoryCard>
  );
}

// A lightweight filled waveform for a clip, windowed to the clip's [in,out] and
// stretched to the clip width (preserveAspectRatio="none").
function WaveformStrip({ wave, inMs, outMs }) {
  const path = useMemo(() => {
    const peaks = wave?.peaks;
    const pps = wave?.peaksPerSecond || 60;
    if (!peaks || !peaks.length) {
      return "";
    }
    const startIdx = Math.max(0, Math.floor((inMs / 1000) * pps));
    const endIdx = Math.min(peaks.length, Math.ceil((outMs / 1000) * pps));
    const slice = endIdx > startIdx ? peaks.slice(startIdx, endIdx) : peaks;
    const maxPoints = 240;
    const step = Math.max(1, Math.floor(slice.length / maxPoints));
    const pts = [];
    for (let i = 0; i < slice.length; i += step) {
      let m = 0;
      for (let j = i; j < Math.min(i + step, slice.length); j += 1) {
        if (slice[j] > m) {
          m = slice[j];
        }
      }
      pts.push(m);
    }
    if (pts.length < 2) {
      return "";
    }
    const n = pts.length;
    let top = "";
    pts.forEach((v, i) => {
      const x = (i / (n - 1)) * 100;
      const half = Math.max(0.5, v * 48);
      top += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${(50 - half).toFixed(2)} `;
    });
    let bottom = "";
    for (let i = n - 1; i >= 0; i -= 1) {
      const x = (i / (n - 1)) * 100;
      const half = Math.max(0.5, pts[i] * 48);
      bottom += `L${x.toFixed(2)},${(50 + half).toFixed(2)} `;
    }
    return `${top}${bottom}Z`;
  }, [wave, inMs, outMs]);
  if (!path) {
    return null;
  }
  return (
    <ClipWaveformSvg preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
      <path d={path} />
    </ClipWaveformSvg>
  );
}

function EditorDialogs({
  busy,
  dialog,
  draftInputRef,
  draftLocation,
  draftName,
  onClearLocation,
  onClose,
  onConfirmDelete,
  onDraftChange,
  onPickLocation,
  onSubmit,
}) {
  const isDelete = dialog.mode === "delete";
  const isCreate = dialog.mode === "create";

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <DialogScrim onMouseDown={onClose}>
      <DialogCard onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <DialogHeader>
          <div>
            <PanelKicker>{isDelete ? "Delete project" : dialog.mode === "create" ? "New project" : "Rename project"}</PanelKicker>
            <PanelHeading>
              {isDelete ? dialog.project.name : dialog.mode === "create" ? "Create a project" : "Rename project"}
            </PanelHeading>
          </div>
          <DialogClose aria-label="Close" onClick={onClose} type="button">
            <Close aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        {isDelete ? (
          <>
            <DialogBody>
              This permanently removes <strong>{dialog.project.name}</strong> and its media from this device. This
              can&apos;t be undone.
            </DialogBody>
            <DialogActions>
              <SecondaryButton onClick={onClose} type="button">
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryDangerButton disabled={busy} onClick={onConfirmDelete} type="button">
                <ButtonIcon as={DeleteOutline} aria-hidden="true" />
                <span>{busy ? "Deleting…" : "Delete project"}</span>
              </PrimaryDangerButton>
            </DialogActions>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogLabel htmlFor="editor-project-name">Project name</DialogLabel>
            <DialogInput
              autoComplete="off"
              id="editor-project-name"
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Untitled project"
              ref={draftInputRef}
              spellCheck={false}
              value={draftName}
            />
            {isCreate && (
              <LocationField>
                <DialogLabel as="span">Location</DialogLabel>
                <LocationRow>
                  <LocationPath data-default={draftLocation ? "false" : "true"} title={draftLocation || "Default app storage"}>
                    {draftLocation || "Default app storage"}
                  </LocationPath>
                  {draftLocation && (
                    <LocationReset aria-label="Use default location" onClick={onClearLocation} title="Use default location" type="button">
                      <Close aria-hidden="true" />
                    </LocationReset>
                  )}
                  <LocationBrowse onClick={onPickLocation} type="button">
                    <ButtonIcon as={FolderOpen} aria-hidden="true" />
                    <span>Browse</span>
                  </LocationBrowse>
                </LocationRow>
                <LocationHint>
                  {draftLocation
                    ? `A "${draftName.trim() || "project"}" folder will be created here.`
                    : "Stored privately in this device's app data."}
                </LocationHint>
              </LocationField>
            )}
            <DialogActions>
              <SecondaryButton onClick={onClose} type="button">
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryButton disabled={!draftName.trim() || busy} type="submit">
                <ButtonIcon as={dialog.mode === "create" ? Add : DriveFileRenameOutline} aria-hidden="true" />
                <span>{busy ? "Saving…" : dialog.mode === "create" ? "Create project" : "Save name"}</span>
              </PrimaryButton>
            </DialogActions>
          </form>
        )}
      </DialogCard>
    </DialogScrim>
  );
}

/* ------------------------------------------------------------------ styles */

const GOLDEN_RATIO = 1.618;

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const EditorRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  color: var(--forge-text);

  /* Editor-scoped design tokens (palmier-inspired): track identity colors, an
     amber timecode, and two motion durations for a calm, native pro feel. */
  --ed-track-video: 41, 159, 214;
  --ed-track-audio: 88, 168, 34;
  --ed-timecode: 242, 153, 51;
  --ed-anim-hover: 150ms;
  --ed-anim-transition: 200ms;

  html[data-forge-theme="light"] & {
    /* Darken amber so the timecode/snap indicator stay readable on light. */
    --ed-timecode: 139, 90, 0;
  }
`;

const GalleryScroll = styled.div`
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-height: 0;
  width: 100%;
  height: 100%;
  padding: 26px 30px 36px;
  overflow-y: auto;
`;

const InlineError = styled.div`
  padding: 10px 14px;
  border: 1px solid rgba(239, 107, 107, 0.4);
  border-radius: 10px;
  background: rgba(239, 107, 107, 0.08);
  color: var(--forge-red);
  font-size: 13px;
`;

const ProjectGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 14px;
`;

const CreateCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: ${GOLDEN_RATIO} / 1;
  border: 1px solid var(--forge-accent-selected-border);
  border-radius: 12px;
  background: var(--forge-surface-raised);
  color: var(--forge-text);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease,
    background 160ms ease;

  &:hover {
    border-color: var(--forge-accent);
    background: var(--forge-surface-control);
    box-shadow: 0 12px 26px rgba(2, 6, 23, 0.5);
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const CreateGlyph = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--forge-blue);
  color: #ffffff;
  box-shadow: 0 6px 16px rgba(var(--forge-accent-rgb), 0.4);
  transition: transform 160ms ease, box-shadow 160ms ease;

  svg {
    width: 19px;
    height: 19px;
  }

  ${CreateCard}:hover & {
    transform: scale(1.06);
    box-shadow: 0 8px 20px rgba(var(--forge-accent-rgb), 0.55);
  }
`;

const CreateLabel = styled.span`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
`;

const ProjectCard = styled.article`
  position: relative;
  display: flex;
  flex-direction: column;
  aspect-ratio: ${GOLDEN_RATIO} / 1;
  border: 1px solid var(--forge-border);
  border-radius: 14px;
  background: var(--forge-surface-raised);
  overflow: hidden;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover {
    border-color: var(--forge-accent-selected-border);
    box-shadow: 0 14px 32px rgba(2, 6, 23, 0.5);
    transform: translateY(-2px);
  }
`;

const CardThumb = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 30% 25%, rgba(var(--forge-accent-rgb), 0.22), transparent 60%),
    linear-gradient(135deg, rgba(13, 17, 23, 0.4), rgba(2, 4, 8, 0.6));
  border-bottom: 1px solid var(--forge-border);

  svg {
    width: 28px;
    height: 28px;
    color: rgba(var(--forge-accent-soft-rgb), 0.85);
  }
`;

const CardBody = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 11px 11px;
`;

const CardName = styled.h3`
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--forge-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CardMeta = styled.span`
  font-size: 11.5px;
  color: var(--forge-text-muted);
`;

const CardCounts = styled.span`
  font-size: 11px;
  color: var(--forge-text-disabled);
`;

const CardHoverLayer = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(2, 4, 8, 0.72), rgba(2, 4, 8, 0.86));
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;

  ${ProjectCard}:hover &,
  ${ProjectCard}:focus-within & {
    opacity: 1;
    pointer-events: auto;
  }
`;

const CardPrimaryAction = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border: 1px solid rgba(125, 160, 205, 0.3);
  border-radius: 999px;
  background: var(--forge-blue);
  color: #ffffff;
  font-weight: 700;
  font-size: 13px;
  transition: background 150ms ease, transform 150ms ease;

  &:hover {
    background: var(--forge-blue-soft);
    transform: translateY(-1px);
  }
`;

const CardSecondaryActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CardIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.85);
  color: var(--forge-text-soft);
  transition: border-color 150ms ease, color 150ms ease, background 150ms ease;

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
    background: var(--forge-surface-control);
  }

  &[data-variant="danger"]:hover {
    border-color: rgba(239, 107, 107, 0.6);
    color: var(--forge-red);
  }
`;

const ButtonIcon = styled.span`
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;

  svg {
    width: 100%;
    height: 100%;
  }
`;

const CenterFill = styled.div`
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  color: var(--forge-text-muted);
  font-size: 14px;
`;

/* ------------------------------------------------------------- workbench */

const Workbench = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
`;

const WorkbenchHeader = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-shell-right-bg);
`;

const BackButton = styled.button`
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  background: rgba(21, 27, 35, 0.7);
  color: var(--forge-text-soft);
  transition: border-color 150ms ease, color 150ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
  }
`;

const WorkbenchTitle = styled.h2`
  margin: 0;
  max-width: calc(100% - 80px);
  font-size: 13px;
  font-weight: 700;
  color: var(--forge-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
`;

const WorkbenchBody = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

// The className lands on Panel's nested content div, so it becomes the full-size
// flex column that each pane fills.
const PanelBox = styled(Panel)`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const ColHandle = styled(Separator)`
  position: relative;
  width: 7px;
  min-width: 7px;
  align-self: stretch;
  background: var(--forge-border);
  cursor: col-resize;
  transition: background 150ms ease;

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 30px;
    border-radius: 2px;
    background: var(--forge-text-disabled);
  }

  &[data-separator="hover"],
  &[data-separator="active"] {
    background: rgba(var(--forge-accent-rgb), 0.45);
  }
`;

const RowHandle = styled(Separator)`
  position: relative;
  height: 7px;
  min-height: 7px;
  align-self: stretch;
  background: var(--forge-border);
  cursor: row-resize;
  transition: background 150ms ease;

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 30px;
    height: 2px;
    border-radius: 2px;
    background: var(--forge-text-disabled);
  }

  &[data-separator="hover"],
  &[data-separator="active"] {
    background: rgba(var(--forge-accent-rgb), 0.45);
  }
`;

const FolderPane = styled.aside`
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--forge-shell-right-muted-bg);

  &[data-drop-active="true"] {
    outline: 2px dashed var(--forge-accent);
    outline-offset: -6px;
  }
`;

const PaneHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--forge-border);
`;

const PaneHeaderIcon = styled.span`
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: var(--forge-text-muted);

  svg {
    width: 100%;
    height: 100%;
  }
`;

const PaneHeaderText = styled.span`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--forge-text-soft);
`;

const MediaBreadcrumb = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
`;

const Crumb = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 140px;
  padding: 3px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  transition: color var(--ed-anim-hover) ease, background var(--ed-anim-hover) ease;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-control);
  }

  &[data-current="true"] {
    color: var(--forge-text);
  }
`;

const CrumbSep = styled.span`
  color: var(--forge-text-disabled);
  font-size: 12px;
  flex: 0 0 auto;
`;

const PaneHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex: 0 0 auto;
`;

const PaneIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);
  transition: border-color var(--ed-anim-hover) ease, color var(--ed-anim-hover) ease;

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
  }
`;

const ImportButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);
  font-size: 12px;
  font-weight: 600;
  transition: border-color 150ms ease, color 150ms ease;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover:not(:disabled) {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
  }

  &:disabled {
    opacity: 0.6;
  }
`;

const FolderEmpty = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 30px 16px;
  text-align: center;
  color: var(--forge-text-disabled);

  svg {
    width: 30px;
    height: 30px;
    color: var(--forge-text-muted);
  }

  span {
    font-size: 13px;
    color: var(--forge-text-soft);
  }

  small {
    font-size: 11.5px;
  }
`;

const GridScroll = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
`;

const MediaTile = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  cursor: grab;
  user-select: none;

  &[data-kind="folder"] {
    cursor: pointer;
  }

  &[data-kind="other"] {
    cursor: default;
  }

  &:active {
    cursor: grabbing;
  }

  &[data-kind="folder"]:active {
    cursor: pointer;
  }
`;

const TileThumb = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  overflow: hidden;
  background: radial-gradient(circle at 50% 40%, rgba(13, 17, 23, 0.5), rgba(2, 3, 4, 0.92));
  transition:
    border-color var(--ed-anim-hover) ease,
    box-shadow var(--ed-anim-hover) ease;

  & > svg {
    width: 34%;
    height: 34%;
    color: var(--forge-text-muted);
  }

  &[data-kind="folder"] > svg {
    color: rgba(var(--ed-track-video), 0.9);
  }

  &[data-kind="audio"] > svg {
    color: rgb(var(--ed-track-audio));
  }

  ${MediaTile}:hover & {
    border-color: var(--forge-accent-selected-border);
    box-shadow: 0 6px 18px rgba(2, 6, 23, 0.45);
  }
`;

const TileImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const TilePlay = styled.span`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: rgba(2, 4, 8, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.5);
  pointer-events: none;

  svg {
    width: 20px;
    height: 20px;
    color: #ffffff;
  }
`;

const TileConvertButton = styled.button`
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 6px;
  background: rgba(2, 4, 8, 0.76);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.15;
  opacity: 0;
  transform: translateY(5px);
  transition:
    opacity 120ms ease,
    transform 120ms ease,
    background 120ms ease,
    border-color 120ms ease;

  ${MediaTile}:hover &,
  &:focus-visible {
    opacity: 1;
    transform: translateY(0);
  }

  &:hover,
  &:focus-visible {
    background: rgba(var(--forge-accent-rgb), 0.82);
    border-color: rgba(255, 255, 255, 0.48);
  }
`;

const TileLabel = styled.span`
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--forge-text-soft);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
`;

const TileDelete = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: rgba(2, 4, 8, 0.6);
  color: #ffffff;
  opacity: 0;
  transform: scale(0.85);
  transition:
    opacity 120ms ease,
    transform 120ms ease,
    background 120ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  ${MediaTile}:hover & {
    opacity: 1;
    transform: scale(1);
  }

  &:hover {
    background: rgba(239, 107, 107, 0.75);
  }
`;

const MediaDragGhost = styled.div`
  position: fixed;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 220px;
  padding: 6px 10px;
  border: 1px solid var(--forge-accent-selected-border);
  border-radius: 8px;
  background: var(--forge-surface-raised);
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 12px 26px rgba(2, 6, 23, 0.55);
  pointer-events: none;

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    color: var(--forge-accent-soft);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const DropOverlay = styled.div`
  position: absolute;
  inset: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(var(--forge-accent-rgb), 0.14);
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
`;

/* -------------------------------------------------- assets mode bar + panels */

const AssetsModeBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--forge-border);
`;

const SegmentedControl = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-surface);
`;

const SegmentButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 600;
  transition:
    background var(--ed-anim-hover) ease,
    color var(--ed-anim-hover) ease;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover {
    color: var(--forge-text);
  }

  &[data-active="true"] {
    background: var(--forge-surface-raised);
    color: var(--forge-text);
    box-shadow: 0 1px 2px rgba(2, 6, 23, 0.4);
  }
`;

const MediaPanelFill = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
`;

const GenPanelFill = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
`;

const AssetsSplitFill = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
`;

/* --------------------------------------------------------- generating tiles */

const shimmer = keyframes`
  0% { background-position: -160% 0; }
  100% { background-position: 260% 0; }
`;

const GeneratingOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--forge-text-soft);
  font-size: 11px;
  font-weight: 600;
`;

const GeneratingBar = styled.span`
  width: 60%;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(var(--forge-accent-rgb), 0.15),
    rgba(var(--forge-accent-rgb), 0.7),
    rgba(var(--forge-accent-rgb), 0.15)
  );
  background-size: 200% 100%;
  animation: ${shimmer} 1.3s linear infinite;
`;

const ConversionOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 7px;
  padding: 14px;
  background: linear-gradient(180deg, rgba(2, 4, 8, 0.52), rgba(2, 4, 8, 0.86));
  color: #ffffff;
  text-align: left;
`;

const ConversionStage = styled.span`
  display: block;
  min-width: 0;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ConversionProgressTrack = styled.span`
  display: block;
  width: 100%;
  height: 5px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.18);
`;

const ConversionProgressFill = styled.span`
  display: block;
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: rgb(var(--forge-accent-rgb));
  transition: width 160ms ease;
`;

const ConversionPercent = styled.span`
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.78);
`;

/* ------------------------------------------------------------ generation form */

const GenHeader = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--forge-border);
`;

const GenTitle = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--forge-text-soft);

  svg {
    width: 15px;
    height: 15px;
    color: var(--forge-accent-soft);
  }
`;

const GenHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
`;

const GenHistoryScroll = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
`;

const GenHistoryCard = styled.div`
  display: flex;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface-raised);
`;

const GenHistoryThumb = styled.div`
  position: relative;
  flex: 0 0 auto;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--forge-border);
  background: radial-gradient(circle at 50% 40%, rgba(13, 17, 23, 0.5), rgba(2, 3, 4, 0.92));
  cursor: grab;

  &[data-missing="true"] {
    cursor: default;
  }

  & > svg {
    width: 30%;
    height: 30%;
    color: var(--forge-text-muted);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &:active:not([data-missing="true"]) {
    cursor: grabbing;
  }
`;

const GenHistoryMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
`;

const GenHistoryModel = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--forge-text-soft);
`;

const GenHistoryPrompt = styled.span`
  font-size: 12.5px;
  color: var(--forge-text);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const GenHistorySettings = styled.span`
  font-size: 11px;
  color: var(--forge-text-disabled);
  font-variant-numeric: tabular-nums;
`;

const GenForm = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px;
`;

const GenField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  animation: ${popIn} 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
`;

const GenLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--forge-text-muted);
`;

const GenRequired = styled.span`
  color: var(--forge-red);
`;

const GenHint = styled.span`
  color: var(--forge-text-disabled);
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
`;

const GenTextArea = styled.textarea`
  width: 100%;
  resize: vertical;
  min-height: 56px;
  padding: 9px 11px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 9px;
  background: var(--forge-surface);
  color: var(--forge-text);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.4;

  &:focus {
    outline: none;
    border-color: var(--forge-accent-selected-border);
    box-shadow: 0 0 0 3px var(--forge-accent-selected-ring);
  }

  &::placeholder {
    color: var(--forge-text-disabled);
  }
`;

const GenEnumRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const GenEnumButton = styled.button`
  padding: 6px 12px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  transition:
    border-color var(--ed-anim-hover) ease,
    color var(--ed-anim-hover) ease,
    background var(--ed-anim-hover) ease;

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-accent-selected-border);
  }

  &[data-active="true"] {
    border-color: var(--forge-accent);
    color: var(--forge-text);
    background: rgba(var(--forge-accent-rgb), 0.16);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:disabled:hover {
    color: var(--forge-text-soft);
    border-color: var(--forge-border-strong);
  }
`;

const GenNumberInput = styled.input`
  width: 140px;
  padding: 8px 10px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: var(--forge-surface);
  color: var(--forge-text);
  font-size: 13px;
  font-variant-numeric: tabular-nums;

  &:focus {
    outline: none;
    border-color: var(--forge-accent-selected-border);
  }
`;

const GenDropSlot = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 10px;
  background: var(--forge-surface);
  overflow: hidden;
  transition: border-color var(--ed-anim-hover) ease, background var(--ed-anim-hover) ease;

  &:hover {
    border-color: var(--forge-accent-selected-border);
  }
`;

const GenDropImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const GenDropEmpty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--forge-text-disabled);
  font-size: 11.5px;
  text-align: center;
  padding: 10px;

  svg {
    width: 26px;
    height: 26px;
    color: var(--forge-text-muted);
  }
`;

const GenBrowse = styled.button`
  margin-top: 2px;
  padding: 4px 10px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 7px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);
  font-size: 11.5px;
  font-weight: 600;

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-accent-selected-border);
  }
`;

const GenSlotClear = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: rgba(2, 4, 8, 0.6);
  color: #ffffff;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    background: rgba(239, 107, 107, 0.75);
  }
`;

const GenRefRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 10px;

  &:hover {
    border-color: var(--forge-accent-selected-border);
  }
`;

const GenRefSlot = styled.div`
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--forge-border);

  ${GenSlotClear} {
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;

    svg {
      width: 11px;
      height: 11px;
    }
  }
`;

const GenRefAdd = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);

  svg {
    width: 20px;
    height: 20px;
  }

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-accent-selected-border);
  }
`;

const GenAdvanced = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const GenAdvancedToggle = styled.button`
  align-self: flex-start;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--forge-text-muted);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;

  &:hover {
    color: var(--forge-text);
  }
`;

const GenSubmitBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid var(--forge-border);
`;

const GenResultsLink = styled.button`
  border: none;
  background: transparent;
  padding: 2px 0;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 600;

  &:hover {
    color: var(--forge-text);
    text-decoration: underline;
  }
`;

const GenConfirmRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0;
  font-size: 13px;
  color: var(--forge-text-muted);

  strong {
    color: var(--forge-text);
    font-weight: 600;
  }
`;

const GenConfirmNote = styled.p`
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--forge-text-disabled);

  strong {
    color: var(--forge-text-soft);
  }
`;

const ViewerPane = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 16px 18px;
  gap: 12px;
`;

const ViewerFrame = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--forge-border);
  border-radius: 12px;
  background: radial-gradient(circle at 50% 40%, rgba(13, 17, 23, 0.5), rgba(2, 3, 4, 0.92));
  overflow: hidden;
`;

const PreviewImg = styled.img`
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
`;

const ViewerEmpty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
`;

const ViewerGlyph = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--forge-text-muted);

  svg {
    width: 28px;
    height: 28px;
  }
`;

const ViewerEmptyText = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--forge-text-soft);
`;

const ViewerEmptyHint = styled.span`
  font-size: 12px;
  color: var(--forge-text-disabled);
`;

const TransportBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
`;

const TransportButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);

  svg {
    width: 20px;
    height: 20px;
  }

  &:hover:not(:disabled) {
    color: var(--forge-text);
    border-color: var(--forge-accent-selected-border);
  }

  &:disabled {
    opacity: 0.5;
  }
`;

const TransportTime = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
`;

const TimecodeNow = styled.span`
  color: rgb(var(--ed-timecode));
  font-weight: 600;
  letter-spacing: 0.02em;
`;

const TransportSep = styled.span`
  color: var(--forge-text-disabled);
`;

const TimelinePane = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border-top: 1px solid var(--forge-border);
  background: var(--forge-shell-right-muted-bg);
`;

const TimelineHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--forge-border);
`;

const TimelineZoomHint = styled.span`
  font-size: 11px;
  color: var(--forge-text-disabled);
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
`;

const TimelineTools = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
`;

const ToolButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--forge-text-soft);
  transition:
    border-color var(--ed-anim-hover) ease,
    color var(--ed-anim-hover) ease,
    background var(--ed-anim-hover) ease;

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover:not(:disabled) {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
    background: var(--forge-surface-control);
  }

  &[data-active="true"] {
    border-color: var(--forge-accent);
    color: var(--forge-text);
    background: rgba(var(--forge-accent-rgb), 0.16);
  }

  &:disabled {
    opacity: 0.35;
  }
`;

const ZoomControl = styled.div`
  display: flex;
  align-items: center;
`;

const ZoomSlider = styled.input`
  width: 110px;
  height: 4px;
  appearance: none;
  border-radius: 999px;
  background: var(--forge-surface-control);
  outline: none;
  cursor: pointer;

  &::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: var(--forge-surface-control);
  }

  &::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: var(--forge-surface-control);
  }

  &::-webkit-slider-thumb {
    appearance: none;
    width: 13px;
    height: 13px;
    margin-top: -4.5px;
    border-radius: 999px;
    background: var(--forge-accent);
    border: 2px solid var(--forge-surface-raised);
    box-shadow: 0 1px 3px rgba(2, 6, 23, 0.5);
  }

  &::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border: 2px solid var(--forge-surface-raised);
    border-radius: 999px;
    background: var(--forge-accent);
  }
`;

const ToolDivider = styled.span`
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--forge-border);
`;

const TimelineScroll = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
`;

const TimelineContent = styled.div`
  position: relative;
  min-width: 100%;
`;

const TRACK_GUTTER_WIDTH = "120px";

const TimelineRuler = styled.div`
  display: grid;
  grid-template-columns: ${TRACK_GUTTER_WIDTH} minmax(0, 1fr);
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--forge-shell-right-muted-bg);
  border-bottom: 1px solid var(--forge-border);
`;

const TimelineTrackGutter = styled.div`
  position: sticky;
  left: 0;
  z-index: 2;
  border-right: 1px solid var(--forge-border);
  background: var(--forge-shell-right-muted-bg);
`;

const TimelineRulerTrack = styled.div`
  position: relative;
  height: 26px;
  cursor: pointer;
`;

const TimelineTick = styled.span`
  position: absolute;
  top: 6px;
  font-size: 10.5px;
  color: var(--forge-text-disabled);
  padding-left: 6px;
  border-left: 1px solid var(--forge-border);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
`;

const TimelineTrack = styled.div`
  display: grid;
  grid-template-columns: ${TRACK_GUTTER_WIDTH} minmax(0, 1fr);
  border-bottom: 1px solid var(--forge-border);
  min-height: 70px;
`;

const TimelineTrackLabel = styled.div`
  position: sticky;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-right: 1px solid var(--forge-border);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--forge-text-soft);
  background: rgba(13, 17, 23, 0.6);
`;

const TrackIcon = styled.span`
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: var(--forge-text-muted);

  svg {
    width: 100%;
    height: 100%;
  }
`;

const TimelineLane = styled.div`
  position: relative;
  min-height: 70px;
  background-image: repeating-linear-gradient(
    90deg,
    transparent,
    transparent calc(var(--sec-px, 80px) - 1px),
    var(--forge-border) calc(var(--sec-px, 80px) - 1px),
    var(--forge-border) var(--sec-px, 80px)
  );

  &[data-track="video"] {
    background-color: rgba(var(--ed-track-video), 0.03);
  }

  &[data-track="audio"] {
    background-color: rgba(var(--ed-track-audio), 0.04);
  }

  &[data-tool="razor"] {
    cursor: crosshair;
  }
`;

const TimelineLanePlaceholder = styled.span`
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  font-size: 11.5px;
  color: var(--forge-text-disabled);
  font-style: italic;
  pointer-events: none;
`;

const TimelineClip = styled.div`
  position: absolute;
  top: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  border-radius: 7px;
  border: 1px solid rgba(var(--ed-track-video), 0.55);
  background: linear-gradient(180deg, rgba(var(--ed-track-video), 0.42), rgba(var(--ed-track-video), 0.24));
  color: var(--forge-text);
  cursor: grab;
  overflow: hidden;
  user-select: none;
  transition:
    box-shadow var(--ed-anim-hover) ease,
    border-color var(--ed-anim-hover) ease;

  /* Track-color identity strip. */
  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: rgb(var(--ed-track-video));
    pointer-events: none;
  }

  &:active {
    cursor: grabbing;
  }

  &[data-track="audio"] {
    border-color: rgba(var(--ed-track-audio), 0.55);
    background: linear-gradient(180deg, rgba(var(--ed-track-audio), 0.36), rgba(var(--ed-track-audio), 0.2));
  }

  &[data-track="audio"]::before {
    background: rgb(var(--ed-track-audio));
  }

  &[data-selected="true"] {
    border-color: var(--forge-accent);
  }

  &[data-active="true"] {
    border-color: var(--forge-accent);
    box-shadow:
      0 0 0 1px var(--forge-accent),
      0 6px 16px rgba(2, 6, 23, 0.45);
  }

  &[data-tool="razor"] {
    cursor: crosshair;
  }
`;

const ClipWaveformSvg = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.5;

  path {
    fill: rgba(255, 255, 255, 0.55);
  }
`;

const ClipLabel = styled.span`
  position: relative;
  flex: 1 1 auto;
  padding: 0 8px 0 12px;
  font-size: 11.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(2, 4, 8, 0.6);
`;

const ClipDuration = styled.span`
  position: relative;
  flex: 0 0 auto;
  margin-right: 8px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--forge-text-soft);
  background: rgba(2, 4, 8, 0.34);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
`;

const ClipTrimHandle = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  background: rgba(255, 255, 255, 0.18);

  &[data-edge="left"] {
    left: 0;
    border-top-left-radius: 7px;
    border-bottom-left-radius: 7px;
  }

  &[data-edge="right"] {
    right: 0;
    border-top-right-radius: 7px;
    border-bottom-right-radius: 7px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.4);
  }
`;

const ClipRemove = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-right: 10px;
  border: none;
  border-radius: 5px;
  background: rgba(2, 4, 8, 0.4);
  color: var(--forge-text-soft);
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  ${TimelineClip}:hover & {
    opacity: 1;
  }

  &:hover {
    background: rgba(239, 107, 107, 0.5);
    color: #fff;
  }
`;

const SelectionBand = styled.div`
  position: absolute;
  top: 26px;
  bottom: 0;
  z-index: 2;
  background: rgba(var(--forge-accent-rgb), 0.16);
  border-left: 1px solid rgba(var(--forge-accent-rgb), 0.7);
  border-right: 1px solid rgba(var(--forge-accent-rgb), 0.7);
  pointer-events: none;
`;

const SnapIndicator = styled.div`
  position: absolute;
  top: 26px;
  bottom: 0;
  z-index: 5;
  border-left: 1px dashed rgb(var(--ed-timecode));
  pointer-events: none;
`;

const TimelinePlayhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--forge-accent);
  box-shadow: 0 0 8px rgba(var(--forge-accent-rgb), 0.6);
  pointer-events: none;
  z-index: 4;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: -4px;
    width: 10px;
    height: 8px;
    background: var(--forge-accent);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }
`;

/* ---------------------------------------------------------------- dialogs */

const DialogScrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(2, 4, 8, 0.62);
  backdrop-filter: blur(2px);
  animation: ${fadeIn} 140ms ease both;
`;

const DialogCard = styled.div`
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 22px 22px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 16px;
  background: var(--forge-surface-raised);
  box-shadow: 0 30px 60px rgba(2, 6, 23, 0.6);
  animation: ${popIn} 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
`;

const DialogHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const DialogClose = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--forge-text-muted);

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    border-color: var(--forge-border);
    color: var(--forge-text);
  }
`;

const DialogBody = styled.p`
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--forge-text-soft);

  strong {
    color: var(--forge-text);
  }
`;

const DialogLabel = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: var(--forge-text-soft);
`;

const DialogInput = styled.input`
  width: 100%;
  padding: 11px 13px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: var(--forge-surface);
  color: var(--forge-text);
  font-size: 14px;
  transition: border-color 150ms ease, box-shadow 150ms ease;

  &:focus {
    outline: none;
    border-color: var(--forge-accent-selected-border);
    box-shadow: 0 0 0 3px var(--forge-accent-selected-ring);
  }

  &::placeholder {
    color: var(--forge-text-disabled);
  }
`;

const DialogActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
`;

const LocationField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
`;

const LocationRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const LocationPath = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: var(--forge-surface);
  color: var(--forge-text);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;

  &[data-default="true"] {
    color: var(--forge-text-muted);
    direction: ltr;
  }
`;

const LocationReset = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: var(--forge-surface-control);
  color: var(--forge-text-muted);
  transition: border-color 150ms ease, color 150ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
  }
`;

const LocationBrowse = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 9px 14px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);
  font-size: 12.5px;
  font-weight: 600;
  transition: border-color 150ms ease, color 150ms ease;

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
  }
`;

const LocationHint = styled.span`
  font-size: 11.5px;
  color: var(--forge-text-disabled);
`;

export default EditorWorkspaceView;
