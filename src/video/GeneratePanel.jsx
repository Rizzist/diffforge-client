import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import AppSelect from "../app/AppSelect.jsx";
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
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
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 6px 0;
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

const PickerPop = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: rgba(7, 12, 22, 0.98);
`;

const PickerThumb = styled.button`
  appearance: none;
  aspect-ratio: 16 / 10;
  padding: 0;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #060a12;
  cursor: pointer;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
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

const JobRow = styled.div`
  display: grid;
  gap: 4px;
  padding: 7px 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 7px;
  background: rgba(4, 8, 14, 0.6);
`;

const JobTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 750;
  color: rgba(226, 232, 240, 0.94);

  em {
    font-style: normal;
    color: #8fa0b8;
    font-weight: 600;
  }

  span {
    margin-left: auto;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${(props) => (props.$tone === "error" ? "#fca5a5" : props.$tone === "done" ? "#a7f3d0" : "#93c5fd")};
  }
`;

const JobMessage = styled.div`
  font-size: 9.5px;
  font-weight: 550;
  color: #8fa0b8;
  overflow-wrap: anywhere;
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

function jobTone(job) {
  if (job.error) {
    return "error";
  }
  if (job.done) {
    return "done";
  }
  return "running";
}

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
  const [slots, setSlots] = useState({ startFrame: "", endFrame: "", references: [], source: "" });
  const [picker, setPicker] = useState(null); // { slot, index? }
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [intoTimeline, setIntoTimeline] = useState(true);
  const seedSeenRef = useRef(0);

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
      caps.resolutions ? (caps.resolutions.includes(current) ? current : caps.resolutions[caps.resolutions.length - 1]) : "",
    );
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
      source: "",
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
  }, [onGenerated]);

  const assetsByPath = useMemo(() => {
    const map = {};
    for (const asset of assets) {
      map[asset.path] = asset;
    }
    return map;
  }, [assets]);

  const imageAssets = useMemo(() => assets.filter((asset) => asset.kind === "image" && !asset.pending), [assets]);

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
      setError("Write a prompt first.");
      return;
    }
    if (caps.requiresReferenceImage && !slots.references.length) {
      setError(`${model.displayName} needs a reference image.`);
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
            model.kind === "image"
              ? referenceImagePaths.length
                ? "image-edit"
                : "text-to-image"
              : isImageToVideo
                ? "image-to-video"
                : "text-to-video",
          prompt: prompt.trim(),
          inputAssetPaths,
          params: {
            durationSec: caps.durations ? durationSec : null,
            aspect: caps.aspectRatios ? aspect : null,
            resolution: caps.resolutions ? resolution : null,
            quality: caps.qualities ? quality : null,
            numImages: caps.maxImages ? numImages : null,
            sound: caps.supportsSound ? sound : null,
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
    } catch (err) {
      setError(String(err));
    }
  }, [aspect, caps, durationSec, genMode, intoTimeline, model, numImages, onPlannedClip, prompt, quality, repoPath, resolution, slots, sound]);

  const estUsd = estimateModelUsd(model, { durationSec, numImages });

  const referenceSlotCount = Math.min(caps.maxReferenceImages || 0, 4);
  const showSlots = caps.supportsStartFrame || caps.supportsEndFrame || referenceSlotCount > 0;

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
          <AppSelect
            onChange={setModelId}
            options={models.map((entry) => ({
              value: entry.id,
              label: entry.displayName + (entry.description ? ` — ${entry.description}` : ""),
            }))}
            value={model?.id || ""}
          />
        </VideoLabel>
        <VideoLabel>
          Prompt
          <VideoTextArea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              caps.requiresReferenceImage
                ? "Describe the edit to apply to the reference…"
                : kind === "image"
                  ? "Describe the image…"
                  : "Describe the shot, style, camera move…"
            }
            rows={3}
            value={prompt}
          />
        </VideoLabel>
        {showSlots ? (
          <div style={{ display: "grid", gap: 4 }}>
            <VideoLabel as="div">Inputs</VideoLabel>
            <SlotStrip>
              {caps.supportsStartFrame ? renderSlot("startFrame", "Start", slots.startFrame) : null}
              {caps.supportsEndFrame ? renderSlot("endFrame", "End", slots.endFrame) : null}
              {Array.from({ length: referenceSlotCount }, (_, index) =>
                index <= slots.references.length
                  ? renderSlot("references", `Ref ${index + 1}`, slots.references[index] || "", index)
                  : null,
              )}
            </SlotStrip>
            {picker ? (
              imageAssets.length ? (
                <PickerPop>
                  {imageAssets.map((asset) => (
                    <PickerThumb
                      key={asset.path}
                      onClick={() => fillSlot(picker.slot, picker.index, asset.path)}
                      title={asset.name}
                      type="button"
                    >
                      {asset.thumbnailDataUrl ? <img alt="" src={asset.thumbnailDataUrl} /> : null}
                    </PickerThumb>
                  ))}
                </PickerPop>
              ) : (
                <VideoHint>No images in the library — import or generate one first.</VideoHint>
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
              <AppSelect
                onChange={setResolution}
                options={caps.resolutions.map((value) => ({ value, label: value }))}
                value={resolution}
              />
            </VideoLabel>
          ) : null}
          {caps.qualities ? (
            <VideoLabel>
              Quality
              <AppSelect
                onChange={setQuality}
                options={caps.qualities.map((value) => ({ value, label: value }))}
                value={quality}
              />
            </VideoLabel>
          ) : null}
          {caps.modes ? (
            <VideoLabel>
              Mode
              <AppSelect
                onChange={setGenMode}
                options={caps.modes.map((value) => ({ value, label: value }))}
                value={genMode}
              />
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
      <Section style={{ borderBottom: "none" }}>
        <SectionTitle>Jobs</SectionTitle>
        {!jobs.length ? (
          <VideoHint>Generations land in media/generated and appear in the library (AI filter).</VideoHint>
        ) : null}
        {jobs.map((job) => (
          <JobRow key={job.jobId}>
            <JobTitle $tone={jobTone(job)}>
              {job.model || job.providerId || "generate"}
              <em>{job.state || ""}</em>
              <span>{job.error ? "error" : job.done ? "done" : `${Math.round(job.percent || 0)}%`}</span>
            </JobTitle>
            {!job.done ? (
              <VideoProgressTrack>
                <VideoProgressFill style={{ width: `${Math.min(100, Math.max(3, job.percent || 3))}%` }} />
              </VideoProgressTrack>
            ) : null}
            {job.message || job.error ? <JobMessage>{job.error || job.message}</JobMessage> : null}
            {!job.done ? (
              <InlineRow>
                <VideoSecondaryButton
                  onClick={() => invoke("video_generate_cancel", { jobId: job.jobId }).catch(() => {})}
                  type="button"
                >
                  Cancel
                </VideoSecondaryButton>
              </InlineRow>
            ) : Array.isArray(job.outputPaths) && job.outputPaths.length && !job.error ? (
              <InlineRow>
                {job.outputPaths.map((path) => (
                  <VideoPaneButton key={path} onClick={() => onInsertAsset?.(path)} type="button">
                    + Insert at playhead
                  </VideoPaneButton>
                ))}
              </InlineRow>
            ) : null}
          </JobRow>
        ))}
      </Section>
    </PanelRoot>
  );
}
