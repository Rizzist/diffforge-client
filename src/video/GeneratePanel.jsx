import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import AppSelect from "../app/AppSelect.jsx";
import { emitVideoAssetDrag } from "./videoDragEvents.js";
import {
  GENERATION_KINDS,
  GENERATION_PROVIDER_LABEL,
  estimateModelUsd,
  generationModels,
  getGenerationModel,
} from "./generationCatalog.js";
import { VIDEO_GENERATE_PROGRESS_EVENT } from "./videoPanelBridge.js";
import {
  VideoErrorText,
  VideoHint,
  VideoLabel,
  VideoPaneButton,
  VideoProgressFill,
  VideoProgressTrack,
  VideoSecondaryButton,
  VideoTextArea,
} from "./videoStyles.js";

const PanelRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const FormScroll = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

// Job history slides over the whole form (opaque, right → left).
const HistorySlide = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  background: #020304;
  transform: translateX(100%);
  transition: transform 0.22s ease;
  pointer-events: none;

  &[data-open="true"] {
    transform: translateX(0);
    pointer-events: auto;
  }

  html[data-forge-theme="light"] & {
    background: #f4f6fb;
  }
`;

const HistoryHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  flex: 0 0 auto;
`;

const HistoryList = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 6px;
  padding: 10px;
  align-content: start;
`;

const KindTabs = styled.div`
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
`;

const KindTab = styled.button`
  appearance: none;
  flex: 1 1 0;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(9, 13, 20, 0.6);
  color: rgba(148, 163, 184, 0.9);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 5px 0;
  border-radius: 8px;
  cursor: pointer;

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.6);
    background: rgba(37, 99, 235, 0.2);
    color: #dbeafe;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const Section = styled.div`
  display: grid;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
`;

// Compact react-select sizing (model/resolution/quality/voice pickers).
const CompactSelect = styled.div`
  .app-select__control {
    min-height: 28px;
  }

  .app-select__value-container {
    padding: 0 8px;
  }

  .app-select__single-value,
  .app-select__placeholder {
    font-size: 11px;
  }

  .app-select__dropdown-indicator {
    padding: 4px;
  }
`;

const ProviderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ProviderChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.1);
  color: #a7f3d0;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 999px;
  white-space: nowrap;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const ParamChip = styled.button`
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: transparent;
  color: rgba(203, 213, 225, 0.88);
  font-size: 10px;
  font-weight: 750;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.6);
    background: rgba(37, 99, 235, 0.2);
    color: #dbeafe;
  }
`;

const ParamGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
`;

// Reference slots strip — palmier-style: each slot is a droppable/pickable
// thumbnail (start frame, end frame, reference images, source media).
const SlotStrip = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const Slot = styled.button`
  appearance: none;
  position: relative;
  width: 76px;
  height: 52px;
  padding: 0;
  border-radius: 7px;
  overflow: hidden;
  border: 1.5px dashed rgba(148, 163, 184, 0.3);
  background: rgba(4, 8, 14, 0.6);
  color: rgba(148, 163, 184, 0.75);
  cursor: pointer;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &[data-filled="true"] {
    border-style: solid;
    border-color: rgba(16, 185, 129, 0.55);
  }

  &:hover {
    border-color: rgba(96, 165, 250, 0.6);
  }
`;

const SlotLabel = styled.span`
  position: relative;
  z-index: 1;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
`;

const SlotClear = styled.span`
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 2;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgba(2, 6, 12, 0.85);
  color: #fca5a5;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
`;

// Quick-access asset picker: a single horizontal, trackpad-scrollable row.
const PickerPop = styled.div`
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: rgba(7, 12, 22, 0.98);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const PickerThumb = styled.button`
  appearance: none;
  flex: none;
  width: 78px;
  height: 50px;
  padding: 0;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #060a12;
  cursor: pointer;
  position: relative;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  span {
    position: absolute;
    inset: auto 0 0 0;
    padding: 1px 3px;
    background: rgba(2, 6, 12, 0.78);
    color: #cbd5f5;
    font-size: 7.5px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  &:hover {
    border-color: rgba(16, 185, 129, 0.6);
  }
`;

const CountStepper = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  padding: 2px 6px;

  button {
    appearance: none;
    border: none;
    background: transparent;
    color: #cbd5f5;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    padding: 0 4px;

    &:disabled {
      opacity: 0.3;
    }
  }

  span {
    font-size: 11px;
    font-weight: 800;
    color: rgba(226, 232, 240, 0.94);
    min-width: 14px;
    text-align: center;
  }
`;

// History rows: preview thumb (draggable onto the timeline once media
// exists) + model/prompt/progress + status/action column.
const HistRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(4, 8, 14, 0.6);
`;

const HistThumb = styled.div`
  position: relative;
  flex: none;
  width: 74px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    radial-gradient(90% 120% at 20% 0%, rgba(37, 99, 235, 0.18), transparent 60%),
    linear-gradient(150deg, rgba(23, 32, 48, 0.95), rgba(6, 10, 18, 0.98));
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &[data-draggable="true"] {
    cursor: grab;
  }

  &[data-status="error"] {
    background:
      radial-gradient(90% 120% at 20% 0%, rgba(248, 113, 113, 0.16), transparent 60%),
      linear-gradient(150deg, rgba(45, 20, 24, 0.95), rgba(10, 6, 8, 0.98));
    border-color: rgba(248, 113, 113, 0.3);
  }
`;

const HistGlyph = styled.span`
  font-size: 15px;
  color: rgba(148, 163, 184, 0.8);

  &[data-status="running"] {
    color: #93c5fd;
    animation: hist-spin 1.4s linear infinite;
  }

  &[data-status="error"] {
    color: #fca5a5;
  }

  @keyframes hist-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;

const HistInfo = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 3px;

  b {
    font-size: 10.5px;
    font-weight: 800;
    color: rgba(226, 232, 240, 0.94);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  p {
    margin: 0;
    font-size: 9.5px;
    font-weight: 550;
    color: #8fa0b8;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
`;

const HistError = styled.div`
  font-size: 9px;
  font-weight: 600;
  color: #fca5a5;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const HistSide = styled.div`
  flex: none;
  display: grid;
  gap: 4px;
  justify-items: end;
`;

const HistStatus = styled.span`
  font-size: 8.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #93c5fd;

  &[data-status="error"] {
    color: #fca5a5;
  }

  &[data-status="done"] {
    color: #a7f3d0;
  }
`;

const HistDragGhost = styled.div`
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 4px;
  border: 1px solid rgba(16, 185, 129, 0.5);
  border-radius: 7px;
  background: rgba(4, 8, 14, 0.92);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);

  img {
    width: 42px;
    height: 26px;
    object-fit: cover;
    border-radius: 4px;
    display: block;
  }

  span {
    font-size: 9.5px;
    font-weight: 700;
    color: #cbd5f5;
    max-width: 140px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const InlineRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
`;

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(167, 243, 208, 0.9);
`;

// Generation panel — palmier-style: Image / Video / Audio type tabs, one
// provider (Higgsfield, keys held by your cloud), a real model catalog, and a
// capability-driven form: the slots and parameters each model actually
// accepts (start/end frames, reference images, durations, resolutions,
// qualities, sound) appear only when that model supports them.
export default function GeneratePanel({
  assets = [],
  onGenerated,
  onInsertAsset,
  onPlannedClip,
  paneToken = "video-pane",
  repoPath = "",
  seed = null,
}) {
  const [kind, setKind] = useState("video");
  const models = useMemo(() => generationModels(kind), [kind]);
  const [modelId, setModelId] = useState("");
  const model = getGenerationModel(modelId) || models[0] || null;
  const caps = model?.caps || {};

  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(5);
  const [aspect, setAspect] = useState("16:9");
  const [resolution, setResolution] = useState("");
  const [quality, setQuality] = useState("");
  const [numImages, setNumImages] = useState(1);
  const [sound, setSound] = useState(true);
  const [genMode, setGenMode] = useState("");
  const [voice, setVoice] = useState("");
  const [slots, setSlots] = useState({ startFrame: "", endFrame: "", references: [], audio: "" });
  const [picker, setPicker] = useState(null); // { slot, index? }
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [intoTimeline, setIntoTimeline] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyJobs, setHistoryJobs] = useState([]);
  const seedSeenRef = useRef(0);

  // Job history (persisted registry) — every job's request snapshot can be
  // reloaded into the form for editing/re-running.
  const loadHistory = useCallback(() => {
    if (!repoPath) {
      return;
    }
    invoke("video_jobs_list", { repoPath })
      .then((result) => {
        const list = Array.isArray(result?.jobs) ? result.jobs : [];
        setHistoryJobs([...list].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)));
      })
      .catch(() => {});
  }, [repoPath]);

  const reuseJob = useCallback((job) => {
    const request = job?.request;
    // Upscales have no reusable form state here (AssetPanel owns that flow).
    if (!request || request.kind === "upscale" || String(request.mode || "").startsWith("upscale")) {
      return;
    }
    const catalogEntry =
      // History stores jobType for generation, catalog id for upscales.
      (request.model &&
        (getGenerationModel(request.model) ||
          generationModels("video").concat(generationModels("image"), generationModels("audio")).find(
            (entry) => entry.jobType === request.model,
          ))) ||
      null;
    if (catalogEntry && catalogEntry.kind !== "upscale") {
      setKind(catalogEntry.kind);
      setModelId(catalogEntry.id);
    }
    setPrompt(String(request.prompt || ""));
    const params = request.params || {};
    if (params.durationSec) {
      setDurationSec(Number(params.durationSec));
    }
    if (params.aspect) {
      setAspect(String(params.aspect));
    }
    if (params.resolution) {
      setResolution(String(params.resolution));
    }
    if (params.quality) {
      setQuality(String(params.quality));
    }
    if (params.numImages) {
      setNumImages(Number(params.numImages));
    }
    if (params.voice) {
      setVoice(String(params.voice));
    }
    // Missing assets are fine — slots simply stay empty for what's gone.
    const stillExists = new Set(assets.map((asset) => asset.path));
    const inputPaths = (Array.isArray(request.inputAssetPaths) ? request.inputAssetPaths : []).map((path) =>
      stillExists.has(path) ? path : "",
    );
    const audioPaths = (Array.isArray(request.audioAssetPaths) ? request.audioAssetPaths : []).filter((path) =>
      stillExists.has(path),
    );
    if (request.mode === "image-to-video") {
      setSlots({ startFrame: inputPaths[0] || "", endFrame: inputPaths[1] || "", references: [], audio: audioPaths[0] || "" });
    } else {
      setSlots({ startFrame: "", endFrame: "", references: inputPaths.filter(Boolean), audio: audioPaths[0] || "" });
    }
    setHistoryOpen(false);
  }, [assets]);

  // Keep params legal for the active model.
  useEffect(() => {
    if (!model) {
      return;
    }
    if (caps.durations && !caps.durations.includes(durationSec)) {
      setDurationSec(caps.defaultDuration || caps.durations[0]);
    }
    if (caps.aspectRatios && !caps.aspectRatios.includes(aspect)) {
      setAspect(caps.aspectRatios.includes("16:9") ? "16:9" : caps.aspectRatios[0]);
    }
    setResolution((current) =>
      caps.resolutions
        ? caps.resolutions.includes(current)
          ? current
          : caps.resolutions.includes("480p")
            ? "480p"
            : caps.resolutions[0]
        : "",
    );
    setVoice((current) => (caps.voices ? (caps.voices.includes(current) ? current : caps.voices[0]) : ""));
    setQuality((current) =>
      caps.qualities ? (caps.qualities.includes(current) ? current : caps.qualities[caps.qualities.length - 1]) : "",
    );
    if (!caps.maxImages || numImages > caps.maxImages) {
      setNumImages(1);
    }
    setGenMode((current) => (caps.modes ? (caps.modes.includes(current) ? current : caps.modes[0]) : ""));
    setSlots((current) => ({
      startFrame: caps.supportsStartFrame ? current.startFrame : "",
      endFrame: caps.supportsEndFrame ? current.endFrame : "",
      references: (current.references || []).slice(0, caps.maxReferenceImages || 0),
      audio: caps.requiresInputAudio ? current.audio : "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id]);

  useEffect(() => {
    if (models.length && !models.some((entry) => entry.id === modelId)) {
      setModelId(models[0].id);
    }
  }, [modelId, models]);

  // AI Edit menu seeding.
  useEffect(() => {
    if (!seed || seed.nonce === seedSeenRef.current) {
      return;
    }
    seedSeenRef.current = seed.nonce;
    setHistoryOpen(false); // an opaque history slide would hide the seeded form
    if (seed.action === "image-to-video") {
      setKind("video");
      setSlots((current) => ({ ...current, startFrame: seed.asset?.path || "" }));
    } else if (seed.action === "image-edit") {
      setKind("image");
      setModelId("flux-kontext");
      setSlots((current) => ({ ...current, references: seed.asset?.path ? [seed.asset.path] : [] }));
    }
  }, [seed]);

  // Job progress stream (shared event with upscales started from the asset panel).
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_GENERATE_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (!payload.jobId) {
        return;
      }
      setJobs((current) => {
        const next = current.filter((job) => job.jobId !== payload.jobId);
        next.unshift(payload);
        return next.slice(0, 12);
      });
      if (payload.done && !payload.error) {
        onGenerated?.(payload);
      }
      // Settled jobs land in the registry — refresh so the history list
      // shows the final state (and output previews) without reopening.
      if (payload.done || payload.error) {
        loadHistory();
      }
    })
      .then((next) => {
        if (disposed) {
          unlisten = () => {};
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
  }, [loadHistory, onGenerated]);

  // History display list: registry snapshots overlaid with live progress
  // (percent/state/error) by jobId; live jobs not yet in the registry lead.
  const displayJobs = useMemo(() => {
    const liveById = new Map(jobs.filter((job) => job.jobId).map((job) => [job.jobId, job]));
    const merged = historyJobs.map((job) => {
      const live = liveById.get(job.jobId);
      if (!live) {
        return job;
      }
      liveById.delete(job.jobId);
      return { ...job, ...live, request: job.request };
    });
    return [...liveById.values(), ...merged];
  }, [historyJobs, jobs]);

  const assetsByPath = useMemo(() => {
    const map = {};
    for (const asset of assets) {
      map[asset.path] = asset;
    }
    return map;
  }, [assets]);

  const imageAssets = useMemo(() => assets.filter((asset) => asset.kind === "image" && !asset.pending), [assets]);
  const audioAssets = useMemo(() => assets.filter((asset) => asset.kind === "audio" && !asset.pending), [assets]);

  // A history job's preview = the first output (or planned) path that exists
  // as a real, non-pending library asset.
  const resolvePreviewAsset = useCallback(
    (job) => {
      const candidates = [
        ...(Array.isArray(job.outputPaths) ? job.outputPaths : []),
        ...(Array.isArray(job.plannedPaths) ? job.plannedPaths : []),
      ];
      for (const path of candidates) {
        const asset = assetsByPath[path];
        if (asset && !asset.pending) {
          return asset;
        }
      }
      return null;
    },
    [assetsByPath],
  );

  // Drag a finished generation straight onto the timeline — same pointer-drag
  // channel MediaBin uses (HTML5 DnD is banned in grid panes).
  const [historyDrag, setHistoryDrag] = useState(null); // { asset, x, y }
  const beginHistoryDrag = useCallback(
    (event, asset) => {
      if (event.button !== 0 || event.target.closest("button")) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const state = { started: false };
      const handleMove = (moveEvent) => {
        if (!state.started) {
          if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) < 5) {
            return;
          }
          state.started = true;
          document.body.style.userSelect = "none";
          document.body.style.webkitUserSelect = "none";
          emitVideoAssetDrag({ phase: "start", asset, paneToken, x: moveEvent.clientX, y: moveEvent.clientY });
        }
        setHistoryDrag({ asset, x: moveEvent.clientX, y: moveEvent.clientY });
        emitVideoAssetDrag({ phase: "move", asset, paneToken, x: moveEvent.clientX, y: moveEvent.clientY });
      };
      const finish = (endEvent, cancelled) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        setHistoryDrag(null);
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
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

  const fillSlot = useCallback((slotKey, index, path) => {
    setSlots((current) => {
      if (slotKey === "references") {
        const references = [...(current.references || [])];
        references[index] = path;
        return { ...current, references: references.filter(Boolean) };
      }
      return { ...current, [slotKey]: path };
    });
    setPicker(null);
  }, []);

  const clearSlot = useCallback((slotKey, index) => {
    setSlots((current) => {
      if (slotKey === "references") {
        return { ...current, references: current.references.filter((_, i) => i !== index) };
      }
      return { ...current, [slotKey]: "" };
    });
  }, []);

  const startGenerate = useCallback(async () => {
    setError("");
    if (!model) {
      return;
    }
    if (!prompt.trim() && !caps.requiresReferenceImage) {
      setError(caps.promptLabel ? `${caps.promptLabel} first.` : "Write a prompt first.");
      return;
    }
    if (caps.requiresReferenceImage && !slots.references.length) {
      setError(`${model.displayName} needs a reference image.`);
      return;
    }
    if (caps.requiresStartFrame && !slots.startFrame) {
      setError(`${model.displayName} needs a start image.`);
      return;
    }
    if (caps.requiresInputAudio && !slots.audio) {
      setError(`${model.displayName} needs a voice audio input.`);
      return;
    }
    try {
      const referenceImagePaths = slots.references.filter(Boolean);
      const isImageToVideo = model.kind === "video" && Boolean(slots.startFrame);
      // The cloud glue reads inputAssetPaths POSITIONALLY by mode:
      // image-to-video → [startFrame, endFrame?]; other modes → reference images.
      const inputAssetPaths = isImageToVideo
        ? [slots.startFrame, ...(slots.endFrame ? [slots.endFrame] : [])]
        : referenceImagePaths;
      const result = await invoke("video_generate_start", {
        repoPath,
        request: {
          providerId: "cloud",
          // The cloud's model table is keyed by provider job-type ids.
          model: model.jobType,
          kind: model.kind,
          mode:
            model.kind === "audio"
              ? "text-to-audio"
              : model.kind === "image"
                ? referenceImagePaths.length
                  ? "image-edit"
                  : "text-to-image"
                : isImageToVideo
                  ? "image-to-video"
                  : "text-to-video",
          prompt: prompt.trim(),
          inputAssetPaths,
          audioAssetPaths: slots.audio ? [slots.audio] : [],
          params: {
            durationSec: caps.durations ? durationSec : null,
            aspect: caps.aspectRatios ? aspect : null,
            resolution: caps.resolutions ? resolution : null,
            quality: caps.qualities ? quality : null,
            numImages: caps.maxImages ? numImages : null,
            sound: caps.supportsSound ? sound : null,
            voice: caps.voices ? voice : null,
            seed: null,
          },
          loraId: null,
          auth: { apiKey: "", secretKey: "", baseUrl: "" },
        },
      });
      const planned = Array.isArray(result?.plannedPaths) ? result.plannedPaths : [];
      if (intoTimeline && planned.length && model.kind === "video") {
        onPlannedClip?.(planned[0], (Number(durationSec) || 5) * 1000);
      }
      // Submitted: clear the form and jump to history where the new job
      // shows up live.
      setPrompt("");
      setSlots({ startFrame: "", endFrame: "", references: [], audio: "" });
      loadHistory();
      setHistoryOpen(true);
    } catch (err) {
      setError(String(err));
    }
  }, [aspect, caps, durationSec, genMode, intoTimeline, loadHistory, model, numImages, onPlannedClip, prompt, quality, repoPath, resolution, slots, sound, voice]);

  const estUsd = estimateModelUsd(model, { durationSec, numImages });

  const referenceSlotCount = Math.min(caps.maxReferenceImages || 0, 4);
  const showSlots = caps.supportsStartFrame || caps.supportsEndFrame || referenceSlotCount > 0 || caps.requiresInputAudio;

  const renderSlot = (slotKey, label, path, index = 0) => {
    const asset = path ? assetsByPath[path] : null;
    return (
      <Slot
        data-filled={path ? "true" : "false"}
        key={`${slotKey}-${index}`}
        onClick={() => setPicker({ slot: slotKey, index })}
        title={path ? asset?.name || path : `Pick ${label.toLowerCase()} from the library`}
        type="button"
      >
        {asset?.thumbnailDataUrl ? <img alt="" src={asset.thumbnailDataUrl} /> : null}
        <SlotLabel>{label}</SlotLabel>
        {path ? (
          <SlotClear
            onClick={(event) => {
              event.stopPropagation();
              clearSlot(slotKey, index);
            }}
          >
            ×
          </SlotClear>
        ) : null}
      </Slot>
    );
  };

  return (
    <PanelRoot data-video-generate="true">
      <FormScroll {...(historyOpen ? { inert: "" } : {})}>
      <KindTabs>
        {GENERATION_KINDS.map((entry) => (
          <KindTab
            data-active={kind === entry.id ? "true" : "false"}
            disabled={entry.disabled}
            key={entry.id}
            onClick={() => !entry.disabled && setKind(entry.id)}
            title={entry.disabled ? entry.hint : undefined}
            type="button"
          >
            {entry.label}
            {entry.disabled ? " ·soon" : ""}
          </KindTab>
        ))}
      </KindTabs>
      <Section>
        <ProviderRow>
          <VideoLabel as="span" style={{ display: "inline" }}>
            Provider
          </VideoLabel>
          <ProviderChip>⚡ {GENERATION_PROVIDER_LABEL}</ProviderChip>
          <span style={{ flex: 1 }} />
        </ProviderRow>
        <VideoLabel>
          Model
          <CompactSelect>
            <AppSelect
              onChange={setModelId}
              options={models.map((entry) => ({
                value: entry.id,
                label: entry.displayName + (entry.description ? ` — ${entry.description}` : ""),
              }))}
              value={model?.id || ""}
            />
          </CompactSelect>
        </VideoLabel>
        <VideoLabel>
          {caps.promptLabel || "Prompt"}
          <VideoTextArea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              caps.promptLabel
                ? `${caps.promptLabel}…`
                : caps.requiresReferenceImage
                  ? "Describe the edit to apply to the reference…"
                  : kind === "image"
                    ? "Describe the image…"
                    : "Describe the shot, style, camera move…"
            }
            rows={3}
            value={prompt}
          />
        </VideoLabel>
        {caps.voices ? (
          <VideoLabel>
            Voice
            <CompactSelect>
              <AppSelect
                onChange={setVoice}
                options={caps.voices.map((value) => ({ value, label: value.replace(/_/g, " ") }))}
                value={voice}
              />
            </CompactSelect>
          </VideoLabel>
        ) : null}
        {showSlots ? (
          <div style={{ display: "grid", gap: 4 }}>
            <VideoLabel as="div">Inputs</VideoLabel>
            <SlotStrip>
              {caps.supportsStartFrame ? renderSlot("startFrame", "Start", slots.startFrame) : null}
              {caps.supportsEndFrame ? renderSlot("endFrame", "End", slots.endFrame) : null}
              {caps.requiresInputAudio ? renderSlot("audio", "♪ Voice", slots.audio) : null}
              {Array.from({ length: referenceSlotCount }, (_, index) =>
                index <= slots.references.length
                  ? renderSlot("references", `Ref ${index + 1}`, slots.references[index] || "", index)
                  : null,
              )}
            </SlotStrip>
            {picker ? (
              (picker.slot === "audio" ? audioAssets : imageAssets).length ? (
                <PickerPop>
                  {(picker.slot === "audio" ? audioAssets : imageAssets).map((asset) => (
                    <PickerThumb
                      key={asset.path}
                      onClick={() => fillSlot(picker.slot, picker.index, asset.path)}
                      title={asset.name}
                      type="button"
                    >
                      {asset.thumbnailDataUrl ? <img alt="" src={asset.thumbnailDataUrl} /> : null}
                      <span>{asset.name}</span>
                    </PickerThumb>
                  ))}
                </PickerPop>
              ) : (
                <VideoHint>
                  {picker.slot === "audio"
                    ? "No audio in the library — import a voice track or generate one in the Audio tab."
                    : "No images in the library — import or generate one first."}
                </VideoHint>
              )
            ) : null}
          </div>
        ) : null}
        {caps.durations ? (
          <div style={{ display: "grid", gap: 4 }}>
            <VideoLabel as="div">Duration</VideoLabel>
            <ChipRow>
              {caps.durations.map((value) => (
                <ParamChip
                  data-active={durationSec === value ? "true" : "false"}
                  key={value}
                  onClick={() => setDurationSec(value)}
                  type="button"
                >
                  {value}s
                </ParamChip>
              ))}
            </ChipRow>
          </div>
        ) : null}
        {caps.aspectRatios ? (
          <div style={{ display: "grid", gap: 4 }}>
            <VideoLabel as="div">Aspect</VideoLabel>
            <ChipRow>
              {caps.aspectRatios.map((value) => (
                <ParamChip
                  data-active={aspect === value ? "true" : "false"}
                  key={value}
                  onClick={() => setAspect(value)}
                  type="button"
                >
                  {value}
                </ParamChip>
              ))}
            </ChipRow>
          </div>
        ) : null}
        <ParamGrid>
          {caps.resolutions ? (
            <VideoLabel>
              Resolution
              <CompactSelect>
                <AppSelect
                  onChange={setResolution}
                  options={caps.resolutions.map((value) => ({ value, label: value }))}
                  value={resolution}
                />
              </CompactSelect>
            </VideoLabel>
          ) : null}
          {caps.qualities ? (
            <VideoLabel>
              Quality
              <CompactSelect>
                <AppSelect
                  onChange={setQuality}
                  options={caps.qualities.map((value) => ({ value, label: value }))}
                  value={quality}
                />
              </CompactSelect>
            </VideoLabel>
          ) : null}
          {caps.modes ? (
            <VideoLabel>
              Mode
              <CompactSelect>
                <AppSelect
                  onChange={setGenMode}
                  options={caps.modes.map((value) => ({ value, label: value }))}
                  value={genMode}
                />
              </CompactSelect>
            </VideoLabel>
          ) : null}
        </ParamGrid>
        <InlineRow>
          {caps.maxImages && caps.maxImages > 1 ? (
            <CountStepper>
              <button disabled={numImages <= 1} onClick={() => setNumImages((n) => n - 1)} type="button">
                −
              </button>
              <span>{numImages}</span>
              <button
                disabled={numImages >= caps.maxImages}
                onClick={() => setNumImages((n) => n + 1)}
                type="button"
              >
                +
              </button>
              <VideoHint>images</VideoHint>
            </CountStepper>
          ) : null}
          {caps.supportsSound ? (
            <ParamChip data-active={sound ? "true" : "false"} onClick={() => setSound((s) => !s)} type="button">
              {sound ? "♪ Sound on" : "Sound off"}
            </ParamChip>
          ) : null}
        </InlineRow>
        {error ? <VideoErrorText>{error}</VideoErrorText> : null}
        <InlineRow>
          <VideoPaneButton disabled={!repoPath || !model} onClick={startGenerate} type="button">
            Generate
          </VideoPaneButton>
          <VideoSecondaryButton
            onClick={() => {
              loadHistory();
              setHistoryOpen(true);
            }}
            title="Past generations — reuse any job's prompt and inputs"
            type="button"
          >
            History
          </VideoSecondaryButton>
          {estUsd != null ? (
            <VideoHint title="Ballpark cost — billed through your Diff Forge cloud">≈ ${estUsd.toFixed(2)}</VideoHint>
          ) : null}
          {model?.kind === "video" ? (
            <VideoHint
              as="label"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
            >
              <input
                checked={intoTimeline}
                onChange={(event) => setIntoTimeline(event.target.checked)}
                style={{ accentColor: "#10b981" }}
                type="checkbox"
              />
              into timeline
            </VideoHint>
          ) : null}
        </InlineRow>
      </Section>
      </FormScroll>
      <HistorySlide data-open={historyOpen ? "true" : "false"} {...(historyOpen ? {} : { inert: "" })}>
        <HistoryHeader>
          <VideoSecondaryButton onClick={() => setHistoryOpen(false)} type="button">
            ‹ Back
          </VideoSecondaryButton>
          <SectionTitle>Job history</SectionTitle>
        </HistoryHeader>
        <HistoryList>
          {displayJobs.length ? (
            displayJobs.map((job) => {
              const previewAsset = resolvePreviewAsset(job);
              const status = job.error ? "error" : job.done ? "done" : "running";
              const promptText = job.request?.prompt || job.message || "";
              const canReuse =
                job.request &&
                job.request.kind !== "upscale" &&
                !String(job.request.mode || "").startsWith("upscale");
              return (
                <HistRow key={`hist-${job.jobId}`}>
                  <HistThumb
                    data-draggable={previewAsset ? "true" : "false"}
                    data-status={status}
                    onDoubleClick={() => previewAsset && onInsertAsset?.(previewAsset.path)}
                    onPointerDown={(event) => previewAsset && beginHistoryDrag(event, previewAsset)}
                    title={
                      previewAsset
                        ? `${previewAsset.name}\nDrag onto the timeline · double-click adds at the playhead`
                        : status === "running"
                          ? "Generating…"
                          : status === "error"
                            ? "Failed — no media"
                            : "Media not in the library anymore"
                    }
                  >
                    {previewAsset?.thumbnailDataUrl ? (
                      <img alt="" draggable={false} src={previewAsset.thumbnailDataUrl} />
                    ) : (
                      <HistGlyph aria-hidden data-status={status}>
                        {status === "running" ? "✦" : status === "error" ? "⚠" : "◇"}
                      </HistGlyph>
                    )}
                  </HistThumb>
                  <HistInfo>
                    <b>{job.request?.model || job.model || job.providerId || "job"}</b>
                    {promptText ? <p>{promptText}</p> : null}
                    {status === "running" ? (
                      <VideoProgressTrack>
                        <VideoProgressFill
                          style={{ width: `${Math.min(100, Math.max(3, job.percent || 3))}%` }}
                        />
                      </VideoProgressTrack>
                    ) : null}
                    {job.error ? <HistError>{job.error}</HistError> : null}
                  </HistInfo>
                  <HistSide>
                    <HistStatus data-status={status}>
                      {status === "running" ? `${Math.round(job.percent || 0)}%` : status}
                    </HistStatus>
                    {status === "running" ? (
                      <VideoSecondaryButton
                        onClick={() => invoke("video_generate_cancel", { jobId: job.jobId }).catch(() => {})}
                        type="button"
                      >
                        Cancel
                      </VideoSecondaryButton>
                    ) : canReuse ? (
                      <VideoSecondaryButton
                        onClick={() => reuseJob(job)}
                        title="Load this job's prompt, inputs, and settings into the form (missing inputs are fine)"
                        type="button"
                      >
                        ↺ Reuse
                      </VideoSecondaryButton>
                    ) : null}
                  </HistSide>
                </HistRow>
              );
            })
          ) : (
            <VideoHint>No jobs yet — generations land in media/generated and appear in the library (AI filter).</VideoHint>
          )}
        </HistoryList>
      </HistorySlide>
      {historyDrag ? createPortal(
        <HistDragGhost style={{ left: `${historyDrag.x + 10}px`, top: `${historyDrag.y + 8}px` }}>
          {historyDrag.asset.thumbnailDataUrl ? <img alt="" src={historyDrag.asset.thumbnailDataUrl} /> : null}
          <span>{historyDrag.asset.name}</span>
        </HistDragGhost>,
        document.body,
      ) : null}
    </PanelRoot>
  );
}
