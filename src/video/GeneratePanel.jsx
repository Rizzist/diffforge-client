import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import AppSelect from "../app/AppSelect.jsx";
import { emitVideoAssetDrag } from "./videoDragEvents.js";
import {
  GENERATION_KINDS,
  GENERATION_MODELS,
  estimateModelCredits,
  estimateModelUsd,
  generationModels,
  getGenerationModel,
  readGenerationRouting,
  writeGenerationRouting,
} from "./generationCatalog.js";
import {
  getVideoProvider,
  videoProviderAuth,
  videoProviderKeyReady,
  writeVideoProviderKey,
} from "./videoProviders.js";
import { VIDEO_CODE_TOOLS_PROGRESS_EVENT, VIDEO_GENERATE_PROGRESS_EVENT } from "./videoPanelBridge.js";
import {
  VideoErrorText,
  VideoHint,
  VideoInput,
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

// Cloud-vs-API-key chooser: slides over the whole form on first open (no
// routing chosen yet) and whenever the ⚙ routing button is pressed.
const ModeSlide = styled.div`
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
  background: #020304;

  html[data-forge-theme="light"] & {
    background: #f4f6fb;
  }
`;

const ModeCard = styled.button`
  appearance: none;
  text-align: left;
  display: grid;
  gap: 7px;
  padding: 12px;
  border-radius: 11px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(9, 13, 20, 0.72);
  color: inherit;
  cursor: pointer;

  &:hover {
    border-color: rgba(96, 165, 250, 0.55);
  }

  &[data-active="true"] {
    border-color: rgba(16, 185, 129, 0.6);
    background: rgba(16, 185, 129, 0.08);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const ModeCardTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 850;
  color: rgba(226, 232, 240, 0.96);

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const ModeCardBody = styled.div`
  font-size: 10.5px;
  font-weight: 550;
  line-height: 1.45;
  color: #8fa0b8;
`;

// Deliberately quiet: a text-only caution line, not a boxed callout — the
// card itself is the click target and nothing inside it may upstage that.
const ModeWarn = styled.div`
  font-size: 10px;
  font-weight: 600;
  line-height: 1.45;
  color: rgba(252, 211, 77, 0.82);

  html[data-forge-theme="light"] & {
    color: #92400e;
  }
`;

// Small utility pill in the cloud card's title row (next to the credits
// chip): tops up credits without reading as the card's primary action.
const TopUpPill = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #93c5fd;
  border: 1px dashed rgba(96, 165, 250, 0.45);
  background: transparent;
  border-radius: 999px;
  padding: 1px 8px;
  cursor: pointer;

  &:hover {
    border-style: solid;
    background: rgba(96, 165, 250, 0.12);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }

  html[data-forge-theme="light"] & {
    color: #1d4ed8;
    border-color: rgba(29, 78, 216, 0.45);
  }
`;

// Per-provider key entry inside the chooser's API card: populated keys get
// the green tick, and only those providers' models show in the model list.
const KeyProviderRow = styled.div`
  display: grid;
  gap: 5px;
  padding: 8px 9px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(4, 8, 14, 0.5);

  &[data-ready="true"] {
    border-color: rgba(16, 185, 129, 0.4);
  }

  html[data-forge-theme="light"] & {
    background: #f8fafc;
  }
`;

const KeyProviderName = styled.span`
  font-size: 10.5px;
  font-weight: 800;
  color: rgba(226, 232, 240, 0.94);

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const KeyReadyBadge = styled.span`
  font-size: 8.5px;
  font-weight: 850;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #7d8ca3;

  &[data-ready="true"] {
    border-color: rgba(16, 185, 129, 0.5);
    color: #6ee7b7;
  }
`;

const ModeChip = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(9, 13, 20, 0.6);
  color: #cbd5f5;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 999px;
  white-space: nowrap;
  cursor: pointer;

  &[data-route="cloud"] {
    border-color: rgba(96, 165, 250, 0.45);
    color: #bfdbfe;
  }

  &[data-route="api"] {
    border-color: rgba(16, 185, 129, 0.45);
    color: #a7f3d0;
  }

  &:hover {
    border-color: rgba(226, 232, 240, 0.5);
  }
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

  /* Jump-to-job flash (from a failed timeline ghost) — amber, same feel as
     the terminals/audio navigate-highlight. */
  @keyframes video-hist-focus-flash {
    0%,
    55% {
      outline-color: rgba(251, 191, 36, 0.95);
      background: rgba(251, 191, 36, 0.14);
    }
    100% {
      outline-color: transparent;
      background: rgba(4, 8, 14, 0.6);
    }
  }

  &[data-flash="true"] {
    outline: 2px solid transparent;
    outline-offset: -1px;
    animation: video-hist-focus-flash 2s ease-out;
  }
`;

// Hover-revealed trash for settled (failed/done) history rows.
const HistDelete = styled.button`
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  color: #fca5a5;
  font-size: 11px;
  font-weight: 800;
  padding: 3px 7px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;

  ${HistRow}:hover & {
    opacity: 1;
  }

  &:hover {
    border-color: rgba(248, 113, 113, 0.45);
    background: rgba(248, 113, 113, 0.1);
  }
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
  line-height: 1.45;
  color: #fca5a5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
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
  historyFocus = null,
  onGenerated,
  onInsertAsset,
  onJobDeleted,
  onPlannedClip,
  onPreviewCode,
  paneToken = "video-pane",
  repoPath = "",
  seed = null,
}) {
  const [kind, setKind] = useState("video");
  // Billing routing: Diff Forge Cloud credits vs the user's own provider
  // keys. Unset on first open → the chooser slide is forced until picked.
  const [routing, setRouting] = useState(readGenerationRouting);
  // Bumped whenever a key field changes so key-derived render state refreshes
  // (the keys themselves live in localStorage via videoProviders.js).
  const [providerKeysVersion, setProviderKeysVersion] = useState(0);
  const models = useMemo(() => {
    const list = generationModels(kind);
    if (routing !== "api" || kind === "code") {
      return list;
    }
    // API mode only offers models the user's populated keys can actually
    // run: direct-routed models whose provider key shows the green tick.
    return list.filter(
      (entry) => entry.direct && videoProviderKeyReady(entry.direct.providerId),
    );
    // providerKeysVersion re-runs this when keys change in localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, providerKeysVersion, routing]);
  const [modelId, setModelId] = useState("");
  const model = models.find((entry) => entry.id === modelId) || models[0] || null;
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

  // Code (Hyperframes) local-render runtime: status + one-click install.
  const isCodeKind = kind === "code";
  const [codeTools, setCodeTools] = useState(null);
  const [codeInstall, setCodeInstall] = useState(null);
  const [codeFps, setCodeFps] = useState(30);

  const refreshCodeTools = useCallback(() => {
    invoke("video_code_tools_status")
      .then((status) => setCodeTools(status || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isCodeKind) {
      refreshCodeTools();
    }
  }, [isCodeKind, refreshCodeTools]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_CODE_TOOLS_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (payload.done) {
        setCodeInstall(null);
        refreshCodeTools();
        if (payload.error) {
          setError(String(payload.error));
        }
      } else {
        setCodeInstall(payload);
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
  }, [refreshCodeTools]);

  const startCodeToolsInstall = useCallback(() => {
    setError("");
    setCodeInstall({ jobId: "", message: "Starting install…", percent: 0 });
    invoke("video_code_tools_install")
      .then((result) => {
        setCodeInstall((current) =>
          current && !current.jobId ? { ...current, jobId: result?.jobId || "" } : current,
        );
      })
      .catch((err) => {
        setCodeInstall(null);
        setError(String(err));
      });
  }, []);

  const revealCodeSource = useCallback(
    (sourcePath) => {
      if (!repoPath || !sourcePath) {
        return;
      }
      revealItemInDir(`${repoPath.replace(/\/$/, "")}/${sourcePath}`).catch(() => {});
    },
    [repoPath],
  );

  const [routingOpen, setRoutingOpen] = useState(false);
  const chooseRouting = useCallback((mode) => {
    writeGenerationRouting(mode);
    setRouting(mode);
    if (mode === "api") {
      // Key setup happens in this same slide — Continue closes it once at
      // least one provider key is populated.
      setRoutingOpen(true);
    } else {
      setRoutingOpen(false);
    }
  }, []);

  // Providers backing the catalog's direct API routes — the key-entry list in
  // the routing chooser, each with a ready (green tick) state.
  const directKeyProviders = useMemo(() => {
    const ids = [];
    GENERATION_MODELS.forEach((entry) => {
      const providerId = entry.direct?.providerId;
      if (providerId && !ids.includes(providerId)) {
        ids.push(providerId);
      }
    });
    return ids.map(getVideoProvider).filter(Boolean);
  }, []);
  const readyKeyCount = useMemo(
    () => directKeyProviders.filter((provider) => videoProviderKeyReady(provider.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [directKeyProviders, providerKeysVersion],
  );

  // Remaining Diff Forge credit balance — shown beside the cloud estimate so
  // "do I have enough for this run?" is answered before submitting.
  const [creditsRemaining, setCreditsRemaining] = useState(null);
  const refreshCreditsRemaining = useCallback(() => {
    invoke("cloud_mcp_get_billing_status")
      .then((status) => {
        const credits = status?.credits || {};
        const remaining = Number(
          credits.termRemainingCredits ?? credits.term_remaining_credits,
        );
        setCreditsRemaining(Number.isFinite(remaining) ? remaining : null);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshCreditsRemaining();
  }, [refreshCreditsRemaining]);

  const [buyingCredits, setBuyingCredits] = useState(false);
  const buyCredits = useCallback(async () => {
    setBuyingCredits(true);
    setError("");
    try {
      const checkout = await invoke("desktop_billing_start_topup_checkout", { packs: 1 });
      const url = String(checkout?.url || "");
      if (!/^https:\/\//i.test(url)) {
        throw new Error("Checkout link unavailable — make sure you're signed in.");
      }
      await openUrl(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setBuyingCredits(false);
    }
  }, []);

  const setProviderKeyField = useCallback((providerId, field, value) => {
    writeVideoProviderKey(providerId, { [field]: value });
    setProviderKeysVersion((version) => version + 1);
  }, []);

  // The route the CURRENT model would take: api only when the user chose it
  // AND the model has a direct provider mapping — everything else stays cloud.
  const directRoute = routing === "api" && !isCodeKind ? model?.direct || null : null;
  const directProvider = directRoute ? getVideoProvider(directRoute.providerId) : null;
  const directAuth = directRoute ? videoProviderAuth(directRoute.providerId) : null;
  const directKeyReady = directRoute ? videoProviderKeyReady(directRoute.providerId) : false;
  const routingChooserVisible = !routing || routingOpen;

  useEffect(() => {
    if (routingChooserVisible) {
      refreshCreditsRemaining();
    }
  }, [refreshCreditsRemaining, routingChooserVisible]);

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

  // Jump-to-job from a failed timeline ghost: open the history slide, load
  // fresh rows, and flash-highlight the job (amber, terminals-style).
  const [focusJob, setFocusJob] = useState(null); // { jobId, at }
  const focusScrolledAtRef = useRef(0);
  useEffect(() => {
    if (!historyFocus?.jobId) {
      return;
    }
    setFocusJob(historyFocus);
    setHistoryOpen(true);
    loadHistory();
  }, [historyFocus, loadHistory]);

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
        // Settled cloud jobs captured credits — refresh the balance readout.
        refreshCreditsRemaining();
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
  }, [loadHistory, onGenerated, refreshCreditsRemaining]);

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
    if (directRoute && !directKeyReady) {
      setError(
        `Enter your ${directProvider?.label || "provider"} API key${
          directProvider?.requiresSecretKey ? " and secret" : ""
        } below (or switch to Cloud via the routing chip).`,
      );
      return;
    }
    try {
      if (model.kind === "code") {
        // Two-phase local render: this only declares the job + scaffolds the
        // composition; the Render action in history runs the actual render.
        const result = await invoke("video_generate_start", {
          repoPath,
          request: {
            providerId: "hyperframes",
            model: "hyperframes",
            mode: "code-render",
            prompt: prompt.trim(),
            inputAssetPaths: [],
            audioAssetPaths: [],
            params: { durationSec, title: prompt.trim(), fps: codeFps },
            loraId: null,
            auth: null,
          },
        });
        const planned = Array.isArray(result?.plannedPaths) ? result.plannedPaths : [];
        if (intoTimeline && planned.length) {
          onPlannedClip?.(planned[0], (Number(durationSec) || 10) * 1000, { model: "hyperframes" });
        }
        setPrompt("");
        loadHistory();
        setHistoryOpen(true);
        return;
      }
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
          // Cloud runs by jobType with server-side keys; the api route hits
          // the provider directly with the locally stored key. Either way the
          // same planned-path ghost + progress pipeline drives the timeline.
          providerId: directRoute ? directRoute.providerId : "cloud",
          model: directRoute ? directRoute.model : model.jobType,
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
            providerMode: caps.modes ? genMode : null,
            seed: null,
          },
          loraId: null,
          auth: directRoute
            ? videoProviderAuth(directRoute.providerId)
            : { apiKey: "", secretKey: "", baseUrl: "" },
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
  }, [aspect, caps, codeFps, directKeyReady, directProvider, directRoute, durationSec, genMode, intoTimeline, loadHistory, model, numImages, onPlannedClip, prompt, quality, repoPath, resolution, slots, sound, voice]);

  const estUsd = estimateModelUsd(model, { durationSec, numImages });
  const estCredits = estimateModelCredits(model, { durationSec, numImages });
  const insufficientCredits =
    !directRoute
    && !isCodeKind
    && estCredits != null
    && creditsRemaining != null
    && creditsRemaining < estCredits;

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
      <FormScroll {...(historyOpen || routingChooserVisible ? { inert: "" } : {})}>
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
            {isCodeKind ? "Provider" : "Billing"}
          </VideoLabel>
          {isCodeKind ? (
            <ProviderChip>⌁ Local render</ProviderChip>
          ) : (
            <ModeChip
              data-route={directRoute ? "api" : "cloud"}
              onClick={() => setRoutingOpen(true)}
              title={
                directRoute
                  ? `Runs on your ${directProvider?.label || ""} API key — billed by the provider at cost. Click to change.`
                  : "Runs on Diff Forge Cloud and bills your credits. Click to change."
              }
              type="button"
            >
              {directRoute ? `🔑 ${directProvider?.label || "API"} key` : "☁ Cloud credits"}
              <span aria-hidden>⚙</span>
            </ModeChip>
          )}
          <span style={{ flex: 1 }} />
        </ProviderRow>
        {isCodeKind ? (
          codeInstall ? (
            <div style={{ display: "grid", gap: 4 }}>
              <VideoHint>{codeInstall.message || "Installing hyperframes runtime…"}</VideoHint>
              <VideoProgressTrack>
                <VideoProgressFill
                  style={{ width: `${Math.min(100, Math.max(3, codeInstall.percent || 3))}%` }}
                />
              </VideoProgressTrack>
              {codeInstall.jobId ? (
                <InlineRow>
                  <VideoSecondaryButton
                    onClick={() =>
                      invoke("video_code_tools_install_cancel", { jobId: codeInstall.jobId }).catch(() => {})
                    }
                    type="button"
                  >
                    Cancel install
                  </VideoSecondaryButton>
                </InlineRow>
              ) : null}
            </div>
          ) : codeTools && !(codeTools.ready && codeTools.ffmpegReady) ? (
            <div style={{ display: "grid", gap: 4 }}>
              <VideoHint>
                Local render runtime missing:{" "}
                {[
                  !codeTools.node?.installed ? "Node" : "",
                  !codeTools.harness?.installed ? "Hyperframes" : "",
                  !codeTools.chrome?.installed ? "Chrome headless" : "",
                  !codeTools.ffmpegReady ? "ffmpeg (install from the media library)" : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </VideoHint>
              {codeTools.installable ? (
                <InlineRow>
                  <VideoSecondaryButton onClick={startCodeToolsInstall} type="button">
                    ⬇ Install runtime
                  </VideoSecondaryButton>
                </InlineRow>
              ) : null}
            </div>
          ) : codeTools ? (
            <VideoHint>
              ✓ Hyperframes runtime ready (v{codeTools.hyperframesVersion}) — compositions live in media/code/,
              renders land in media/generated/.
            </VideoHint>
          ) : null
        ) : null}
        {routing === "api" && !isCodeKind && !models.length ? (
          <InlineRow>
            <VideoErrorText>
              No ✓ provider keys cover {kind} models yet.
            </VideoErrorText>
            <VideoSecondaryButton onClick={() => setRoutingOpen(true)} type="button">
              Add keys
            </VideoSecondaryButton>
          </InlineRow>
        ) : null}
        <VideoLabel>
          Model
          <CompactSelect>
            <AppSelect
              onChange={setModelId}
              options={models.map((entry) => ({
                value: entry.id,
                label:
                  entry.displayName +
                  (entry.description ? ` — ${entry.description}` : "") +
                  (routing === "api" && !isCodeKind ? (entry.direct ? " · API" : " · Cloud") : ""),
              }))}
              value={model?.id || ""}
            />
          </CompactSelect>
        </VideoLabel>
        {directRoute && directProvider ? (
          <div style={{ display: "grid", gap: 6 }}>
            <VideoLabel>
              {directProvider.label} API key
              <VideoInput
                autoComplete="off"
                onChange={(event) => setProviderKeyField(directRoute.providerId, "apiKey", event.target.value)}
                placeholder={directProvider.keyHint || "API key"}
                type="password"
                value={directAuth?.apiKey || ""}
              />
            </VideoLabel>
            {directProvider.requiresSecretKey ? (
              <VideoLabel>
                {directProvider.label} secret key
                <VideoInput
                  autoComplete="off"
                  onChange={(event) => setProviderKeyField(directRoute.providerId, "secretKey", event.target.value)}
                  placeholder="Secret key"
                  type="password"
                  value={directAuth?.secretKey || ""}
                />
              </VideoLabel>
            ) : null}
            <VideoHint>
              Stored on this device only and sent straight to {directProvider.label} with each
              request — never through Diff Forge Cloud.
            </VideoHint>
          </div>
        ) : null}
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
        {caps.fpsOptions ? (
          <div style={{ display: "grid", gap: 4 }}>
            <VideoLabel as="div">FPS</VideoLabel>
            <ChipRow>
              {caps.fpsOptions.map((value) => (
                <ParamChip
                  data-active={codeFps === value ? "true" : "false"}
                  key={value}
                  onClick={() => setCodeFps(value)}
                  type="button"
                >
                  {value}
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
            {isCodeKind ? "Create composition" : "Generate"}
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
          {!isCodeKind && directRoute && estUsd != null ? (
            <VideoHint title="Ballpark — billed by the provider directly to your API key">
              ≈ ${estUsd.toFixed(2)} via your key
            </VideoHint>
          ) : null}
          {!isCodeKind && !directRoute && estCredits != null ? (
            <>
              <VideoHint title="Matches the cloud's reserve formula for this model — billed as Diff Forge credits. AI video generation is expensive; consider your own API keys for regular use.">
                ≈ {estCredits.toLocaleString()} credits
              </VideoHint>
              {creditsRemaining != null ? (
                <VideoHint
                  style={insufficientCredits ? { color: "#fca5a5", fontWeight: 700 } : undefined}
                  title={
                    insufficientCredits
                      ? "Not enough credits for this run — top up or switch to your own API key."
                      : "Your remaining Diff Forge credit balance."
                  }
                >
                  · {creditsRemaining.toLocaleString()} left
                  {insufficientCredits ? " — not enough" : ""}
                </VideoHint>
              ) : null}
              <VideoSecondaryButton
                disabled={buyingCredits}
                onClick={buyCredits}
                title="Top up Diff Forge credits (Stripe checkout)"
                type="button"
              >
                {buyingCredits ? "Opening…" : "＋ Credits"}
              </VideoSecondaryButton>
            </>
          ) : null}
          {model?.kind === "video" || model?.kind === "code" ? (
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
          {isCodeKind ? (
            <VideoHint>
              Creates an editable HTML composition — you (or an agent) author it, then press Render in
              History.
            </VideoHint>
          ) : null}
        </InlineRow>
      </Section>
      </FormScroll>
      {routingChooserVisible ? (
        <ModeSlide>
          <SectionTitle>AI generation billing</SectionTitle>
          <VideoHint>
            Choose how generations run. You can change this anytime from the billing chip in the
            form.
          </VideoHint>
          <ModeCard
            as="div"
            data-active={routing === "api" ? "true" : "false"}
            onClick={() => chooseRouting("api")}
            role="button"
            tabIndex={0}
          >
            <ModeCardTitle>
              🔑 Your API keys
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "#a7f3d0",
                  border: "1px solid rgba(16, 185, 129, 0.4)",
                  borderRadius: 999,
                  padding: "1px 7px",
                }}
              >
                Recommended
              </span>
            </ModeCardTitle>
            <ModeCardBody>
              Bring your own provider keys (Higgsfield platform, OpenAI, …). Generations bill the
              provider directly at cost — usually the cheapest way to generate a lot. Keys stay on
              this device and go straight to the provider with each request. Only models from
              providers with a ✓ key appear in the model list.
            </ModeCardBody>
            {routing === "api" ? (
              <div
                onClick={(event) => event.stopPropagation()}
                style={{ display: "grid", gap: 7 }}
              >
                {directKeyProviders.map((provider) => {
                  const ready = videoProviderKeyReady(provider.id);
                  const auth = videoProviderAuth(provider.id);
                  return (
                    <KeyProviderRow data-ready={ready ? "true" : "false"} key={provider.id}>
                      <InlineRow style={{ justifyContent: "space-between" }}>
                        <KeyProviderName>{provider.label}</KeyProviderName>
                        <KeyReadyBadge data-ready={ready ? "true" : "false"}>
                          {ready ? "✓ Ready" : "No key"}
                        </KeyReadyBadge>
                      </InlineRow>
                      <VideoInput
                        autoComplete="off"
                        onChange={(event) =>
                          setProviderKeyField(provider.id, "apiKey", event.target.value)
                        }
                        placeholder={provider.keyHint || "API key"}
                        type="password"
                        value={auth.apiKey}
                      />
                      {provider.requiresSecretKey ? (
                        <VideoInput
                          autoComplete="off"
                          onChange={(event) =>
                            setProviderKeyField(provider.id, "secretKey", event.target.value)
                          }
                          placeholder="Secret key"
                          type="password"
                          value={auth.secretKey}
                        />
                      ) : null}
                    </KeyProviderRow>
                  );
                })}
              </div>
            ) : null}
          </ModeCard>
          <ModeCard
            as="div"
            data-active={routing === "cloud" ? "true" : "false"}
            onClick={() => chooseRouting("cloud")}
            role="button"
            tabIndex={0}
          >
            <ModeCardTitle>
              ☁ Diff Forge Cloud
              {creditsRemaining != null ? (
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    color: "#93c5fd",
                    border: "1px solid rgba(96, 165, 250, 0.4)",
                    borderRadius: 999,
                    padding: "1px 8px",
                  }}
                >
                  {creditsRemaining.toLocaleString()} credits left
                </span>
              ) : null}
              <TopUpPill
                disabled={buyingCredits}
                onClick={(event) => {
                  event.stopPropagation();
                  buyCredits();
                }}
                title="Top up Diff Forge credits (Stripe checkout)"
                type="button"
              >
                {buyingCredits ? "Opening checkout…" : "＋ Top up"}
              </TopUpPill>
            </ModeCardTitle>
            <ModeCardBody>
              Zero setup — every model works out of the box and bills your Diff Forge credits.
            </ModeCardBody>
            <ModeWarn>
              ⚠ Generation is credit-hungry — a single clip can cost several dollars' worth. For
              regular use we recommend your own API keys.
            </ModeWarn>
          </ModeCard>
          {routing === "api" ? (
            <InlineRow>
              <VideoPaneButton
                disabled={!readyKeyCount}
                onClick={() => setRoutingOpen(false)}
                type="button"
              >
                Continue ›
              </VideoPaneButton>
              <VideoHint>
                {readyKeyCount
                  ? `${readyKeyCount} provider${readyKeyCount === 1 ? "" : "s"} ready`
                  : "Add at least one key to continue — or pick Cloud."}
              </VideoHint>
            </InlineRow>
          ) : routing ? (
            <InlineRow>
              <VideoSecondaryButton onClick={() => setRoutingOpen(false)} type="button">
                ‹ Back
              </VideoSecondaryButton>
            </InlineRow>
          ) : null}
          {error ? <VideoErrorText>{error}</VideoErrorText> : null}
        </ModeSlide>
      ) : null}
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
              const isCodeJob = job.providerId === "hyperframes" || job.request?.model === "hyperframes";
              const isAuthoring = isCodeJob && !job.done && (job.state === "authoring" || !job.state);
              const status = job.error ? "error" : job.done ? "done" : isAuthoring ? "authoring" : "running";
              const promptText = job.request?.prompt || job.message || "";
              const canReuse =
                !isCodeJob &&
                job.request &&
                job.request.kind !== "upscale" &&
                !String(job.request.mode || "").startsWith("upscale");
              return (
                <HistRow
                  data-flash={focusJob?.jobId === job.jobId ? "true" : "false"}
                  // Re-focusing the same job bumps `at` into the key, so the
                  // remount replays the flash animation.
                  key={
                    focusJob?.jobId === job.jobId
                      ? `hist-${job.jobId}-${focusJob.at}`
                      : `hist-${job.jobId}`
                  }
                  ref={(node) => {
                    if (
                      node
                      && focusJob?.jobId === job.jobId
                      && focusScrolledAtRef.current !== focusJob.at
                    ) {
                      focusScrolledAtRef.current = focusJob.at;
                      node.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                >
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
                          : status === "authoring"
                            ? "Waiting for the composition HTML — render when it's ready"
                            : status === "error"
                              ? "Failed — no media"
                              : "Media not in the library anymore"
                    }
                  >
                    {previewAsset?.thumbnailDataUrl ? (
                      <img alt="" draggable={false} src={previewAsset.thumbnailDataUrl} />
                    ) : (
                      <HistGlyph aria-hidden data-status={status}>
                        {status === "running" ? "✦" : status === "authoring" ? "✎" : status === "error" ? "⚠" : "◇"}
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
                    {isCodeJob && (status === "authoring" || status === "error") ? (
                      <VideoSecondaryButton
                        onClick={() => {
                          setError("");
                          invoke("video_generate_code_render", { repoPath, jobId: job.jobId })
                            .then(() => loadHistory())
                            .catch((err) => setError(String(err)));
                        }}
                        title="Render the composition HTML to mp4 with the local Hyperframes runtime"
                        type="button"
                      >
                        ▶ Render
                      </VideoSecondaryButton>
                    ) : null}
                    {isCodeJob && job.sourcePath ? (
                      <VideoSecondaryButton
                        onClick={() => revealCodeSource(job.sourcePath)}
                        title={`Reveal the composition source\n${job.sourcePath}`}
                        type="button"
                      >
                        ⌁ Source
                      </VideoSecondaryButton>
                    ) : null}
                    {isCodeJob && job.sourcePath && onPreviewCode ? (
                      <VideoSecondaryButton
                        onClick={() => onPreviewCode(job.sourcePath)}
                        title="Open the live Hyperframes Studio preview for this composition"
                        type="button"
                      >
                        ◉ Preview
                      </VideoSecondaryButton>
                    ) : null}
                    {status === "running" || status === "authoring" ? (
                      <VideoSecondaryButton
                        onClick={() =>
                          invoke("video_generate_cancel", { jobId: job.jobId, repoPath }).catch(() => {})
                        }
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
                    {status === "error" ? (
                      <HistDelete
                        onClick={() => {
                          invoke("video_jobs_delete", { repoPath, jobId: job.jobId })
                            .then(() => {
                              // Also drop the live-event copy — displayJobs
                              // would resurrect the row as an "extra" if the
                              // jobId lingers in local state after the
                              // registry entry is gone.
                              setJobs((current) =>
                                current.filter((entry) => entry.jobId !== job.jobId),
                              );
                              loadHistory();
                              // The pane removes the job's red ghost clips.
                              onJobDeleted?.(job);
                            })
                            .catch(() => {});
                        }}
                        title="Remove this failed generation from the history"
                        type="button"
                      >
                        🗑 Delete
                      </HistDelete>
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
