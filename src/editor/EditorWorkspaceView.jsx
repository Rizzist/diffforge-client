import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Add } from "@styled-icons/material-rounded/Add";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { Close } from "@styled-icons/material-rounded/Close";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Description } from "@styled-icons/material-rounded/Description";
import { DriveFileRenameOutline } from "@styled-icons/material-rounded/DriveFileRenameOutline";
import { FileUpload } from "@styled-icons/material-rounded/FileUpload";
import { Folder } from "@styled-icons/material-rounded/Folder";
import { FolderOpen } from "@styled-icons/material-rounded/FolderOpen";
import { GraphicEq } from "@styled-icons/material-rounded/GraphicEq";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { OpenInFull } from "@styled-icons/material-rounded/OpenInFull";
import { Pause } from "@styled-icons/material-rounded/Pause";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { Videocam } from "@styled-icons/material-rounded/Videocam";

import { PanelHeading, PanelKicker, PrimaryButton, PrimaryDangerButton, SecondaryButton } from "../app/appStyles";

const OPEN_PROJECT_STORAGE_KEY = "diffforge.editor.open-project.v1";
const PX_PER_SECOND = 80;
const MIN_CLIP_MS = 200;
const PREVIEW_DEBOUNCE_MS = 130;
const TIMELINE_SAVE_DEBOUNCE_MS = 600;
const VIDEO_EXTENSIONS = ["webm", "mp4", "mov", "mkv", "m4v"];

function msToPx(ms) {
  return (Math.max(0, ms) / 1000) * PX_PER_SECOND;
}

function pxToMs(px) {
  return (px / PX_PER_SECOND) * 1000;
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

function generateClipId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `clip-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
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

function isVideoPath(path) {
  const lower = String(path || "").toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

function EditorWorkspaceView({ defaultWorkingDirectory = "" }) {
  const [projects, setProjects] = useState([]);
  const [projectsState, setProjectsState] = useState("loading");
  const [projectsError, setProjectsError] = useState("");
  const [openProjectId, setOpenProjectId] = useState(() => loadOpenProjectId());

  // null | { mode: "create" } | { mode: "rename", project } | { mode: "delete", project }
  const [dialog, setDialog] = useState(null);
  const [draftName, setDraftName] = useState("");
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
    setDialogBusy(false);
  }, []);

  const startCreate = useCallback(() => {
    setDraftName("");
    setDialog({ mode: "create" });
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
          const project = await invoke("editor_create_project", { name: trimmed });
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
    [closeDialog, dialog, dialogBusy, draftName, loadProjects],
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

  if (openProjectId) {
    return (
      <EditorRoot>
        <ProjectWorkbench
          key={openProjectId}
          projectId={openProjectId}
          onBack={() => setOpenProjectId(null)}
          onMissing={() => {
            setOpenProjectId(null);
            loadProjects();
          }}
        />
        {dialog && (
          <EditorDialogs
            busy={dialogBusy}
            dialog={dialog}
            draftInputRef={draftInputRef}
            draftName={draftName}
            onClose={closeDialog}
            onConfirmDelete={confirmDelete}
            onDraftChange={setDraftName}
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
          draftName={draftName}
          onClose={closeDialog}
          onConfirmDelete={confirmDelete}
          onDraftChange={setDraftName}
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
  const [clips, setClips] = useState([]);
  const [probes, setProbes] = useState({});
  const [thumbs, setThumbs] = useState({});
  const [playheadMs, setPlayheadMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [playing, setPlaying] = useState(false);

  const dragRef = useRef(null);
  const processedRef = useRef(new Set());
  const previewReqRef = useRef(0);
  const previewTimerRef = useRef(0);
  const lastDecodeRef = useRef(0);
  const initialLoadRef = useRef(true);
  const mountedRef = useRef(true);
  const pendingSaveRef = useRef(null);
  const doImportRef = useRef(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      window.clearTimeout(previewTimerRef.current);
    };
  }, []);

  const reloadMedia = useCallback(async () => {
    try {
      const list = await invoke("editor_list_media", { id: projectId });
      setMedia(Array.isArray(list) ? list : []);
    } catch (error) {
      setLoadError(getErrorMessage(error, "Unable to read project media."));
    }
  }, [projectId]);

  // Load the project + its media folder.
  useEffect(() => {
    let cancelled = false;
    initialLoadRef.current = true;
    setLoadState("loading");
    (async () => {
      try {
        const loaded = await invoke("editor_get_project", { id: projectId });
        if (cancelled) {
          return;
        }
        setProject(loaded);
        const rawClips = Array.isArray(loaded?.timeline?.clips) ? loaded.timeline.clips : [];
        setClips(
          rawClips.map((clip) => ({
            ...clip,
            startMs: Number(clip.startMs) || 0,
            inMs: Number(clip.inMs) || 0,
            durationMs: Number(clip.durationMs) || 0,
            outMs: Number(clip.outMs) || Number(clip.durationMs) || 0,
          })),
        );
        setLoadState("ready");
        await reloadMedia();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadError(getErrorMessage(error, "Unable to open project."));
        setLoadState("error");
        if (typeof onMissing === "function") {
          onMissing();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadMedia, onMissing]);

  // Persist the timeline (debounced) after the initial load.
  useEffect(() => {
    if (loadState !== "ready") {
      return undefined;
    }
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return undefined;
    }
    pendingSaveRef.current = clips;
    const handle = window.setTimeout(() => {
      invoke("editor_save_timeline", { id: projectId, timeline: { clips } })
        .then(() => {
          pendingSaveRef.current = null;
        })
        .catch(() => {
          // Non-fatal in the shell; the in-memory timeline is still authoritative.
        });
    }, TIMELINE_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [clips, loadState, projectId]);

  // Flush a pending timeline save when navigating away before the debounce fires.
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) {
        invoke("editor_save_timeline", {
          id: projectId,
          timeline: { clips: pendingSaveRef.current },
        }).catch(() => {});
        pendingSaveRef.current = null;
      }
    };
  }, [projectId]);

  // Lazily probe + thumbnail each media item exactly once (keyed by path).
  // processedRef gates duplicates; mountedRef guards post-unmount state writes.
  useEffect(() => {
    media.forEach((item) => {
      const path = item.path;
      if (!path || processedRef.current.has(path)) {
        return;
      }
      processedRef.current.add(path);
      (async () => {
        try {
          const probe = await invoke("editor_probe_media", { path });
          if (mountedRef.current) {
            setProbes((current) => ({ ...current, [path]: probe }));
          }
        } catch {
          if (mountedRef.current) {
            setProbes((current) => ({ ...current, [path]: { durationMs: 0, hasVideo: false } }));
          }
        }
        if (isVideoPath(path)) {
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
        } else if (mountedRef.current) {
          setThumbs((current) => ({ ...current, [path]: "" }));
        }
      })();
    });
  }, [media]);

  const totalMs = useMemo(() => {
    return clips.reduce((max, clip) => Math.max(max, (clip.startMs ?? 0) + clipLengthMs(clip)), 0);
  }, [clips]);

  const timelineWidthPx = useMemo(() => Math.max(msToPx(totalMs) + 240, 720), [totalMs]);

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
            const paths = Array.isArray(payload.paths) ? payload.paths.filter(isVideoPath) : [];
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
        await invoke("editor_import_media", { id: projectId, sources: paths });
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
        filters: [{ name: "WebM video", extensions: VIDEO_EXTENSIONS }],
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

  const addClipToTimeline = useCallback(
    (item) => {
      const probe = probes[item.path];
      const durationMs = Math.max(MIN_CLIP_MS, Math.round(probe?.durationMs || 5000));
      const track = item.kind === "audio" ? "audio" : "video";
      setClips((current) => {
        const trackEnd = current
          .filter((clip) => clip.track === track)
          .reduce((max, clip) => Math.max(max, (clip.startMs ?? 0) + clipLengthMs(clip)), 0);
        return [
          ...current,
          {
            id: generateClipId(),
            mediaPath: item.path,
            name: item.name,
            track,
            startMs: trackEnd,
            inMs: 0,
            outMs: durationMs,
            durationMs,
          },
        ];
      });
    },
    [probes],
  );

  const removeClip = useCallback((clipId) => {
    setClips((current) => current.filter((clip) => clip.id !== clipId));
  }, []);

  // A single set of window listeners for the component's lifetime. They read the
  // active drag descriptor from dragRef, so there's no per-drag add/remove churn
  // (and no listener-identity hazard); they no-op when no drag is active.
  useEffect(() => {
    const handleMove = (event) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const deltaMs = pxToMs(event.clientX - drag.startX);
      if (drag.type === "move") {
        setClips((current) =>
          current.map((clip) =>
            clip.id === drag.clipId ? { ...clip, startMs: Math.max(0, Math.round(drag.origStart + deltaMs)) } : clip,
          ),
        );
      } else if (drag.type === "trim-left") {
        setClips((current) =>
          current.map((clip) => {
            if (clip.id !== drag.clipId) {
              return clip;
            }
            const maxIn = drag.origOut - MIN_CLIP_MS;
            const newIn = Math.min(Math.max(0, Math.round(drag.origIn + deltaMs)), maxIn);
            const newStart = Math.max(0, Math.round(drag.origStart + (newIn - drag.origIn)));
            return { ...clip, inMs: newIn, startMs: newStart };
          }),
        );
      } else if (drag.type === "trim-right") {
        setClips((current) =>
          current.map((clip) => {
            if (clip.id !== drag.clipId) {
              return clip;
            }
            const minOut = drag.origIn + MIN_CLIP_MS;
            const newOut = Math.min(Math.max(minOut, Math.round(drag.origOut + deltaMs)), drag.durationMs);
            return { ...clip, outMs: newOut };
          }),
        );
      } else if (drag.type === "playhead") {
        setPlayheadMs(Math.max(0, Math.round(drag.origPlayhead + deltaMs)));
      }
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const beginDrag = useCallback((event, descriptor) => {
    event.preventDefault();
    event.stopPropagation();
    setPlaying(false);
    dragRef.current = { ...descriptor, startX: event.clientX };
  }, []);

  const scrubToClientX = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ms = Math.max(0, Math.round(pxToMs(event.clientX - rect.left)));
    setPlaying(false);
    setPlayheadMs(ms);
    beginDrag(event, { type: "playhead", origPlayhead: ms });
  }, [beginDrag]);

  if (loadState === "loading") {
    return (
      <Workbench>
        <WorkbenchHeader>
          <BackButton onClick={onBack} type="button">
            <ButtonIcon as={ArrowBack} aria-hidden="true" />
            <span>Projects</span>
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
          <BackButton onClick={onBack} type="button">
            <ButtonIcon as={ArrowBack} aria-hidden="true" />
            <span>Projects</span>
          </BackButton>
        </WorkbenchHeader>
        <CenterFill>{loadError || "Unable to open project."}</CenterFill>
      </Workbench>
    );
  }

  const rulerTicks = [];
  const tickStepMs = 5000;
  for (let t = 0; msToPx(t) <= timelineWidthPx; t += tickStepMs) {
    rulerTicks.push(t);
  }

  return (
    <Workbench>
      <WorkbenchHeader>
        <BackButton onClick={onBack} type="button">
          <ButtonIcon as={ArrowBack} aria-hidden="true" />
          <span>Projects</span>
        </BackButton>
        <WorkbenchTitleGroup>
          <WorkbenchTitle title={project?.name}>{project?.name}</WorkbenchTitle>
          <WorkbenchPath>{media.length} clip{media.length === 1 ? "" : "s"} imported</WorkbenchPath>
        </WorkbenchTitleGroup>
      </WorkbenchHeader>

      {loadError && <InlineError>{loadError}</InlineError>}

      <WorkbenchBody>
        <FolderPane aria-label="Project media" data-drop-active={dropActive ? "true" : "false"}>
          <PaneHeader>
            <PaneHeaderIcon as={FolderOpen} aria-hidden="true" />
            <PaneHeaderText>Media</PaneHeaderText>
            <ImportButton disabled={importBusy} onClick={pickFiles} type="button">
              <ButtonIcon as={FileUpload} aria-hidden="true" />
              <span>{importBusy ? "Importing…" : "Import"}</span>
            </ImportButton>
          </PaneHeader>

          {media.length === 0 ? (
            <FolderEmpty>
              <Folder aria-hidden="true" />
              <span>No media yet</span>
              <small>Import or drag-drop WebM files to add clips.</small>
            </FolderEmpty>
          ) : (
            <MediaList>
              {media.map((item) => {
                const probe = probes[item.path];
                const thumb = thumbs[item.path];
                return (
                  <MediaCard key={item.path}>
                    <MediaThumb data-kind={item.kind}>
                      {item.kind === "audio" ? (
                        <GraphicEq aria-hidden="true" />
                      ) : thumb ? (
                        <MediaThumbImg alt="" src={thumb} />
                      ) : (
                        <Movie aria-hidden="true" />
                      )}
                    </MediaThumb>
                    <MediaInfo>
                      <MediaName title={item.name}>{item.name}</MediaName>
                      <MediaMeta>
                        {probe?.durationMs ? formatDuration(probe.durationMs) : "—"}
                        {probe?.width ? ` · ${probe.width}×${probe.height}` : ""}
                      </MediaMeta>
                    </MediaInfo>
                    <MediaAddButton
                      aria-label={`Add ${item.name} to timeline`}
                      onClick={() => addClipToTimeline(item)}
                      title="Add to timeline"
                      type="button"
                    >
                      <Add aria-hidden="true" />
                    </MediaAddButton>
                  </MediaCard>
                );
              })}
            </MediaList>
          )}
          {dropActive && <DropOverlay>Drop WebM files to import</DropOverlay>}
        </FolderPane>

        <StagePane>
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
                {formatDuration(playheadMs)} / {formatDuration(totalMs)}
              </TransportTime>
            </TransportBar>
          </ViewerPane>

          <TimelinePane aria-label="Timeline">
            <TimelineHeader>
              <PaneHeaderText>Timeline</PaneHeaderText>
              <TimelineZoomHint>WebM · VP9 + Opus</TimelineZoomHint>
            </TimelineHeader>
            <TimelineScroll>
              <TimelineContent style={{ width: `${120 + timelineWidthPx}px` }}>
                <TimelineRuler>
                  <TimelineTrackGutter />
                  <TimelineRulerTrack onPointerDown={scrubToClientX} style={{ width: `${timelineWidthPx}px` }}>
                    {rulerTicks.map((tick) => (
                      <TimelineTick key={tick} style={{ left: `${msToPx(tick)}px` }}>
                        {formatDuration(tick)}
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
                    <TimelineLane data-track={track} style={{ width: `${timelineWidthPx}px` }}>
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
                            onPointerDown={(event) =>
                              beginDrag(event, {
                                type: "move",
                                clipId: clip.id,
                                origStart: clip.startMs ?? 0,
                              })
                            }
                            style={{ left: `${msToPx(clip.startMs ?? 0)}px`, width: `${msToPx(clipLengthMs(clip))}px` }}
                            title={clip.name}
                          >
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
                                  durationMs: clip.durationMs ?? 0,
                                })
                              }
                            />
                          </TimelineClip>
                        ))}
                    </TimelineLane>
                  </TimelineTrack>
                ))}

                <TimelinePlayhead aria-hidden="true" style={{ left: `${120 + msToPx(playheadMs)}px` }} />
              </TimelineContent>
            </TimelineScroll>
          </TimelinePane>
        </StagePane>
      </WorkbenchBody>
    </Workbench>
  );
}

function EditorDialogs({ busy, dialog, draftInputRef, draftName, onClose, onConfirmDelete, onDraftChange, onSubmit }) {
  const isDelete = dialog.mode === "delete";

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
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
`;

const CreateCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  aspect-ratio: ${GOLDEN_RATIO} / 1;
  border: 1px solid var(--forge-accent-selected-border);
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 32%, rgba(var(--forge-accent-rgb), 0.16), transparent 64%),
    var(--forge-surface-raised);
  color: var(--forge-text);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease,
    background 160ms ease;

  &:hover {
    border-color: var(--forge-accent);
    background:
      radial-gradient(circle at 50% 32%, rgba(var(--forge-accent-rgb), 0.26), transparent 64%),
      var(--forge-surface-control);
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
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: var(--forge-blue);
  color: #ffffff;
  box-shadow: 0 6px 16px rgba(var(--forge-accent-rgb), 0.4);
  transition: transform 160ms ease, box-shadow 160ms ease;

  svg {
    width: 22px;
    height: 22px;
  }

  ${CreateCard}:hover & {
    transform: scale(1.06);
    box-shadow: 0 8px 20px rgba(var(--forge-accent-rgb), 0.55);
  }
`;

const CreateLabel = styled.span`
  font-size: 13px;
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
    width: 34px;
    height: 34px;
    color: rgba(var(--forge-accent-soft-rgb), 0.85);
  }
`;

const CardBody = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px 14px;
`;

const CardName = styled.h3`
  margin: 0;
  font-size: 14px;
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
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-shell-right-bg);
`;

const BackButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: rgba(21, 27, 35, 0.7);
  color: var(--forge-text-soft);
  font-weight: 600;
  font-size: 12.5px;
  transition: border-color 150ms ease, color 150ms ease;

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
  }
`;

const WorkbenchTitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const WorkbenchTitle = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--forge-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkbenchPath = styled.span`
  font-size: 11px;
  color: var(--forge-text-muted);
`;

const WorkbenchBody = styled.div`
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
`;

const FolderPane = styled.aside`
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--forge-border);
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

const ImportButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
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

const MediaList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
`;

const MediaCard = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface-raised);
  transition: border-color 150ms ease;

  &:hover {
    border-color: var(--forge-accent-selected-border);
  }
`;

const MediaThumb = styled.div`
  position: relative;
  flex: 0 0 auto;
  width: 64px;
  height: 40px;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 4, 8, 0.6);

  svg {
    width: 20px;
    height: 20px;
    color: var(--forge-text-muted);
  }

  &[data-kind="audio"] svg {
    color: var(--forge-green);
  }
`;

const MediaThumbImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const MediaInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
`;

const MediaName = styled.span`
  font-size: 12.5px;
  color: var(--forge-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MediaMeta = styled.span`
  font-size: 11px;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
`;

const MediaAddButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.85);
  color: var(--forge-text-soft);
  transition: border-color 150ms ease, color 150ms ease;

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-accent-soft);
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

const StagePane = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(190px, 40%);
  min-width: 0;
  min-height: 0;
`;

const ViewerPane = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 18px;
  gap: 12px;
  border-bottom: 1px solid var(--forge-border);
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
  font-size: 12px;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
`;

const TimelinePane = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--forge-shell-right-muted-bg);
`;

const TimelineHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--forge-border);
`;

const TimelineZoomHint = styled.span`
  font-size: 11px;
  color: var(--forge-text-disabled);
  letter-spacing: 0.02em;
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
    transparent ${PX_PER_SECOND - 1}px,
    var(--forge-border) ${PX_PER_SECOND - 1}px,
    var(--forge-border) ${PX_PER_SECOND}px
  );

  &[data-track="audio"] {
    background-color: rgba(60, 203, 127, 0.03);
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
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.5);
  background: linear-gradient(180deg, rgba(var(--forge-accent-rgb), 0.4), rgba(var(--forge-accent-rgb), 0.22));
  color: var(--forge-text);
  cursor: grab;
  overflow: hidden;
  user-select: none;

  &:active {
    cursor: grabbing;
  }

  &[data-track="audio"] {
    border-color: rgba(60, 203, 127, 0.5);
    background: linear-gradient(180deg, rgba(60, 203, 127, 0.34), rgba(60, 203, 127, 0.18));
  }
`;

const ClipLabel = styled.span`
  flex: 1 1 auto;
  padding: 0 14px;
  font-size: 11.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

export default EditorWorkspaceView;
