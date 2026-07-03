import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Add } from "@styled-icons/material-rounded/Add";
import { AutoAwesome } from "@styled-icons/material-rounded/AutoAwesome";
import { Close } from "@styled-icons/material-rounded/Close";
import { Subtitles } from "@styled-icons/material-rounded/Subtitles";
import { listen } from "@tauri-apps/api/event";
import { emitVideoAssetDrag } from "./videoDragEvents.js";
import { VIDEO_TRANSCRIBE_PROGRESS_EVENT } from "./videoPanelBridge.js";
import { VideoErrorText, VideoHint, VideoIconButton, VideoSecondaryButton } from "./videoStyles.js";
import { formatTimecode } from "./videoEditorModel.js";

const MEDIA_DIALOG_FILTERS = [
  {
    name: "Media",
    extensions: [
      "mp4", "mov", "mkv", "webm", "avi", "m4v", "mpg", "mpeg", "ts",
      "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus",
      "png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff",
    ],
  },
];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "image", label: "Image" },
  { id: "generated", label: "AI" },
];

const BinRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;

  &[data-drop-active="true"] {
    outline: 1.5px dashed rgba(16, 185, 129, 0.55);
    outline-offset: -3px;
    border-radius: 8px;
  }
`;

const BinToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 6px;
  flex: 0 0 auto;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const FilterChip = styled.button`
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(148, 163, 184, 0.85);
  font-size: 9.5px;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  cursor: pointer;
  flex: none;

  &:hover {
    color: #e2e8f0;
  }

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.5);
    background: rgba(37, 99, 235, 0.18);
    color: #dbeafe;
  }
`;

const ImportButton = styled(VideoSecondaryButton)`
  min-height: 22px;
  padding: 0 8px;
  font-size: 10px;
  flex: none;
`;

const BinGrid = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 6px;
  align-content: start;
  padding: 4px 6px 8px;
`;

const AssetTile = styled.div`
  position: relative;
  border-radius: 7px;
  overflow: hidden;
  background: #060a12;
  border: 1px solid rgba(148, 163, 184, 0.12);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;

  &:hover {
    border-color: rgba(16, 185, 129, 0.4);
  }

  &[data-selected="true"] {
    border-color: rgba(16, 185, 129, 0.65);
  }

  &[data-dragging="true"] {
    opacity: 0.45;
  }

  &[data-pending="true"] {
    border-style: dashed;
    border-color: rgba(96, 165, 250, 0.45);
    cursor: default;
  }
`;

const PendingSpin = styled.span`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: #93c5fd;
  animation: video-pending-pulse 1.4s ease-in-out infinite;

  @keyframes video-pending-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }
`;

const AiMenu = styled.div`
  position: fixed;
  z-index: 9999;
  display: grid;
  gap: 2px;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(7, 12, 22, 0.98);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
  min-width: 168px;
`;

const AiMenuItem = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(203, 213, 225, 0.92);
  font-size: 10.5px;
  font-weight: 700;
  padding: 5px 10px;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: rgba(16, 185, 129, 0.16);
    color: #d1fae5;
  }
`;

const AssetThumb = styled.div`
  position: relative;
  aspect-ratio: 16 / 10;
  background: #020304;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }
`;

const AssetGlyph = styled.span`
  font-size: 17px;
  opacity: 0.55;
`;

const AssetDuration = styled.span`
  position: absolute;
  right: 3px;
  bottom: 3px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(2, 6, 12, 0.82);
  color: #cbd5f5;
  font-size: 8.5px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
`;

const AssetKind = styled.span`
  position: absolute;
  left: 3px;
  top: 3px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(2, 6, 12, 0.82);
  color: #86efac;
  font-size: 8px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const AssetName = styled.div`
  padding: 3px 5px 4px;
  font-size: 9.5px;
  font-weight: 650;
  color: rgba(214, 222, 235, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HoverActions = styled.div`
  position: absolute;
  top: 3px;
  right: 3px;
  display: none;
  gap: 2px;
  z-index: 2;

  ${AssetTile}:hover & {
    display: inline-flex;
  }
`;

const HoverButton = styled(VideoIconButton)`
  width: 18px;
  height: 18px;
  background: rgba(2, 6, 12, 0.85);
  color: #cbd5f5;

  svg {
    width: 11px;
    height: 11px;
  }

  &:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.3);
    color: #ffffff;
  }

  &[data-danger="true"]:hover:not(:disabled) {
    background: rgba(190, 40, 40, 0.55);
  }
`;

const EmptyBin = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 6px;
  padding: 16px 10px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  border-radius: 9px;
  color: #8fa0b8;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  min-height: 100px;
  flex: 1 1 auto;
`;

const DragGhost = styled.div`
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid rgba(16, 185, 129, 0.55);
  background: rgba(4, 10, 16, 0.92);
  color: #d1fae5;
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);

  img {
    width: 26px;
    height: 18px;
    object-fit: cover;
    border-radius: 3px;
  }

  span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

function assetGlyph(kind) {
  if (kind === "audio") {
    return "♫";
  }
  if (kind === "image") {
    return "▣";
  }
  return "▶";
}

// Media library. Imports via dialog or native Finder drop; adds to the
// timeline via pointer-drag (custom, pane-scoped — see videoDragEvents.js),
// double-click, or the hover + button (adds at the playhead).
export default function MediaBin({
  assets = [],
  error = "",
  onAddToTimeline,
  onAiEdit,
  onImported,
  onOpenTranscript,
  onSelectAsset,
  paneToken = "",
  repoPath = "",
  selectedPath = "",
}) {
  const rootRef = useRef(null);
  const [dropActive, setDropActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [filter, setFilter] = useState("all");
  const [drag, setDrag] = useState(null); // { asset, x, y }
  const [transcribing, setTranscribing] = useState({}); // path → state string
  const dragStateRef = useRef(null);

  // Transcription: extract audio locally, transcribe in the cloud (Whisper
  // via Deepgram). Progress arrives as events keyed by asset path.
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_TRANSCRIBE_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const path = String(payload.path || "").trim();
      if (!path) {
        return;
      }
      setTranscribing((current) => {
        const next = { ...current };
        if (payload.done || payload.error) {
          delete next[path];
        } else {
          next[path] = String(payload.state || "working");
        }
        return next;
      });
      if (payload.done && !payload.error) {
        onImported?.(); // refresh so hasTranscript badges appear
      }
      if (payload.error) {
        setImportError(String(payload.error));
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
  }, [onImported]);

  const [aiMenu, setAiMenu] = useState(null); // { asset, x, y }

  useEffect(() => {
    if (!aiMenu) {
      return undefined;
    }
    const close = () => setAiMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [aiMenu]);

  const visibleAssets = useMemo(() => {
    if (filter === "all") {
      return assets;
    }
    if (filter === "generated") {
      return assets.filter((asset) => asset.folder === "generated");
    }
    return assets.filter((asset) => asset.kind === filter);
  }, [assets, filter]);

  const importPaths = useCallback(
    async (paths) => {
      const cleanPaths = (Array.isArray(paths) ? paths : [])
        .map((path) => String(path || "").trim())
        .filter(Boolean);
      if (!cleanPaths.length || !repoPath) {
        return;
      }
      setImporting(true);
      setImportError("");
      try {
        await invoke("video_media_import", { repoPath, sourcePaths: cleanPaths });
        onImported?.();
      } catch (err) {
        setImportError(String(err));
      } finally {
        setImporting(false);
      }
    },
    [onImported, repoPath],
  );

  const pickFiles = useCallback(async () => {
    try {
      const picked = await openFileDialog({ multiple: true, filters: MEDIA_DIALOG_FILTERS });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      await importPaths(paths);
    } catch (err) {
      setImportError(String(err));
    }
  }, [importPaths]);

  // Native Finder/Explorer drops: tauri delivers absolute paths (positions in
  // physical pixels — divide by DPR before hit-testing).
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed || !rootRef.current) {
          return;
        }
        const payload = event?.payload || {};
        const toClient = (position) => {
          const ratio = window.devicePixelRatio || 1;
          return { x: (position?.x || 0) / ratio, y: (position?.y || 0) / ratio };
        };
        const insideBin = (position) => {
          const point = toClient(position);
          const rect = rootRef.current?.getBoundingClientRect();
          return Boolean(
            rect && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom,
          );
        };
        if (payload.type === "over") {
          setDropActive(insideBin(payload.position));
          return;
        }
        if (payload.type === "leave" || payload.type === "cancel" || payload.type === "cancelled") {
          setDropActive(false);
          return;
        }
        if (payload.type !== "drop") {
          return;
        }
        setDropActive(false);
        if (!insideBin(payload.position)) {
          return;
        }
        void importPaths(Array.isArray(payload.paths) ? payload.paths : []);
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
  }, [importPaths]);

  const deleteAsset = useCallback(
    async (asset) => {
      if (!repoPath || !asset?.path) {
        return;
      }
      try {
        await invoke("video_media_delete", { repoPath, path: asset.path });
        onImported?.();
      } catch (err) {
        setImportError(String(err));
      }
    },
    [onImported, repoPath],
  );

  // Pointer-based drag to the timeline. NOT HTML5 DnD: the app's global
  // drag routing hit-tests HTML5 drags against other grid panes.
  const beginPointerDrag = useCallback(
    (event, asset) => {
      if (event.button !== 0 || event.target.closest("button")) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const state = { asset, started: false };
      dragStateRef.current = state;
      const handleMove = (moveEvent) => {
        if (!state.started) {
          if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) < 5) {
            return;
          }
          state.started = true;
          emitVideoAssetDrag({ phase: "start", asset, paneToken, x: moveEvent.clientX, y: moveEvent.clientY });
        }
        setDrag({ asset, x: moveEvent.clientX, y: moveEvent.clientY });
        emitVideoAssetDrag({ phase: "move", asset, paneToken, x: moveEvent.clientX, y: moveEvent.clientY });
      };
      const finish = (endEvent, cancelled) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        dragStateRef.current = null;
        setDrag(null);
        if (state.started) {
          emitVideoAssetDrag({
            phase: cancelled ? "cancel" : "end",
            asset,
            paneToken,
            metaKey: Boolean(endEvent?.metaKey || endEvent?.ctrlKey),
            x: endEvent?.clientX ?? startX,
            y: endEvent?.clientY ?? startY,
          });
        }
      };
      const handleUp = (upEvent) => finish(upEvent, false);
      const handleCancel = (cancelEvent) => finish(cancelEvent, true);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
    },
    [paneToken],
  );

  const displayError = error || importError;

  return (
    <BinRoot data-drop-active={dropActive ? "true" : "false"} data-video-media-bin="true" ref={rootRef}>
      <BinToolbar>
        <ImportButton disabled={!repoPath || importing} onClick={pickFiles} type="button">
          {importing ? "Importing…" : "+ Import"}
        </ImportButton>
        {FILTERS.map((entry) => (
          <FilterChip
            data-active={filter === entry.id ? "true" : "false"}
            key={entry.id}
            onClick={() => setFilter(entry.id)}
            type="button"
          >
            {entry.label}
          </FilterChip>
        ))}
      </BinToolbar>
      {displayError ? <VideoErrorText style={{ padding: "0 8px 4px" }}>{displayError}</VideoErrorText> : null}
      {visibleAssets.length === 0 ? (
        <EmptyBin>
          <div>{assets.length ? "Nothing matches this filter." : "Drop files here or Import"}</div>
          {!assets.length ? <VideoHint>Copied into this workspace's media/assets.</VideoHint> : null}
        </EmptyBin>
      ) : (
        <BinGrid>
          {visibleAssets.map((asset) => (
            <AssetTile
              data-dragging={drag?.asset?.path === asset.path ? "true" : "false"}
              data-pending={asset.pending ? "true" : "false"}
              data-selected={selectedPath === asset.path ? "true" : "false"}
              draggable={false}
              key={asset.path}
              onClick={() => !asset.pending && onSelectAsset?.(asset)}
              onDoubleClick={() => !asset.pending && onAddToTimeline?.(asset)}
              onPointerDown={(event) => !asset.pending && beginPointerDrag(event, asset)}
              title={
                asset.pending
                  ? `${asset.name}\nGenerating… appears here when ready`
                  : `${asset.name}\nDrag to the timeline · double-click or + adds at the playhead`
              }
            >
              <AssetThumb>
                {asset.thumbnailDataUrl ? (
                  <img alt="" draggable={false} src={asset.thumbnailDataUrl} />
                ) : (
                  <AssetGlyph aria-hidden>{assetGlyph(asset.kind)}</AssetGlyph>
                )}
                {asset.pending ? <PendingSpin aria-hidden>✦</PendingSpin> : null}
                <AssetKind>
                  {asset.pending ? "generating" : asset.folder === "generated" ? "AI" : asset.kind}
                  {transcribing[asset.path] ? " · …" : asset.hasTranscript ? " · T" : ""}
                </AssetKind>
                {Number.isFinite(Number(asset.durationMs)) && asset.durationMs > 0 ? (
                  <AssetDuration>{formatTimecode(asset.durationMs)}</AssetDuration>
                ) : null}
                <HoverActions>
                  <HoverButton
                    aria-label={`Add ${asset.name} to the timeline`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddToTimeline?.(asset);
                    }}
                    title="Add at playhead"
                    type="button"
                  >
                    <Add aria-hidden="true" />
                  </HoverButton>
                  {asset.kind !== "image" && !asset.pending ? (
                    <HoverButton
                      aria-label={`Transcript for ${asset.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenTranscript?.(asset);
                      }}
                      title="Transcript — transcribe, edit, caption, cut words (HappySRT-style)"
                      type="button"
                    >
                      <Subtitles aria-hidden="true" />
                    </HoverButton>
                  ) : null}
                  {!asset.pending ? (
                    <HoverButton
                      aria-label={`AI edit ${asset.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setAiMenu({ asset, x: rect.left, y: rect.bottom + 4 });
                      }}
                      title="AI edit"
                      type="button"
                    >
                      <AutoAwesome aria-hidden="true" />
                    </HoverButton>
                  ) : null}
                  <HoverButton
                    aria-label={`Delete ${asset.name}`}
                    data-danger="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteAsset(asset);
                    }}
                    title="Delete from library"
                    type="button"
                  >
                    <Close aria-hidden="true" />
                  </HoverButton>
                </HoverActions>
              </AssetThumb>
              <AssetName>{asset.name}</AssetName>
            </AssetTile>
          ))}
        </BinGrid>
      )}
      {drag ? (
        <DragGhost style={{ left: `${drag.x + 10}px`, top: `${drag.y + 8}px` }}>
          {drag.asset.thumbnailDataUrl ? <img alt="" src={drag.asset.thumbnailDataUrl} /> : null}
          <span>{drag.asset.name}</span>
        </DragGhost>
      ) : null}
      {aiMenu ? (
        <AiMenu
          onPointerDown={(event) => event.stopPropagation()}
          style={{ left: `${Math.min(aiMenu.x, window.innerWidth - 190)}px`, top: `${aiMenu.y}px` }}
        >
          {aiMenu.asset.kind === "image" ? (
            <>
              <AiMenuItem
                onClick={() => {
                  onAiEdit?.({ action: "image-to-video", asset: aiMenu.asset });
                  setAiMenu(null);
                }}
                type="button"
              >
                🎬 Create video from this
              </AiMenuItem>
              <AiMenuItem
                onClick={() => {
                  onAiEdit?.({ action: "image-edit", asset: aiMenu.asset });
                  setAiMenu(null);
                }}
                type="button"
              >
                ✏️ Edit with AI
              </AiMenuItem>
              <AiMenuItem
                onClick={() => {
                  onAiEdit?.({ action: "upscale-image", asset: aiMenu.asset });
                  setAiMenu(null);
                }}
                type="button"
              >
                ⤴ Upscale image
              </AiMenuItem>
            </>
          ) : null}
          {aiMenu.asset.kind === "video" ? (
            <>
              <AiMenuItem
                onClick={() => {
                  onAiEdit?.({ action: "upscale-video", asset: aiMenu.asset });
                  setAiMenu(null);
                }}
                type="button"
              >
                ⤴ Upscale video
              </AiMenuItem>
              <AiMenuItem
                onClick={() => {
                  onOpenTranscript?.(aiMenu.asset);
                  setAiMenu(null);
                }}
                type="button"
              >
                ¶ Transcript & captions
              </AiMenuItem>
            </>
          ) : null}
          {aiMenu.asset.kind === "audio" ? (
            <AiMenuItem
              onClick={() => {
                onOpenTranscript?.(aiMenu.asset);
                setAiMenu(null);
              }}
              type="button"
            >
              ¶ Transcript & captions
            </AiMenuItem>
          ) : null}
          <AiMenuItem
            onClick={() => {
              onAddToTimeline?.(aiMenu.asset);
              setAiMenu(null);
            }}
            type="button"
          >
            + Add at playhead
          </AiMenuItem>
        </AiMenu>
      ) : null}
    </BinRoot>
  );
}
