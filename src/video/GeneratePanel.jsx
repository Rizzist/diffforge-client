import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import AppSelect from "../app/AppSelect.jsx";
import {
  VIDEO_GENERATE_PROGRESS_EVENT,
  VIDEO_LORA_PROGRESS_EVENT,
} from "./videoPanelBridge.js";
import {
  VIDEO_PROVIDERS,
  getVideoProvider,
  readVideoProviderKeys,
  videoProviderAuth,
  videoProviderKeyReady,
  writeVideoProviderKey,
} from "./videoProviders.js";
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
`;

const Section = styled.div`
  display: grid;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
`;

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(167, 243, 208, 0.9);

  span {
    flex: 1 1 auto;
  }
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 7px;
`;

const ThumbStrip = styled.div`
  display: flex;
  gap: 5px;
  overflow-x: auto;
  padding: 2px 0;
  scrollbar-width: thin;
`;

const ThumbPick = styled.button`
  appearance: none;
  position: relative;
  flex: none;
  width: 72px;
  height: 46px;
  padding: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1.5px solid rgba(148, 163, 184, 0.18);
  background: #060a12;
  cursor: pointer;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &[data-active="true"] {
    border-color: rgba(16, 185, 129, 0.8);
    box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25);
  }

  &::after {
    content: attr(data-label);
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 1px 3px;
    background: rgba(2, 6, 12, 0.75);
    color: #cbd5f5;
    font-size: 7.5px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
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

const LoraChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const LoraChip = styled.button`
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  background: transparent;
  color: rgba(203, 213, 225, 0.88);
  font-size: 9.5px;
  font-weight: 750;
  padding: 2px 9px;
  cursor: pointer;

  &[data-active="true"] {
    border-color: rgba(16, 185, 129, 0.6);
    background: rgba(16, 185, 129, 0.14);
    color: #a7f3d0;
  }

  &[data-disabled="true"] {
    opacity: 0.5;
    cursor: default;
  }
`;

const TrainGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
  gap: 4px;
  max-height: 148px;
  overflow-y: auto;
  padding: 2px;
`;

const TrainThumb = styled.button`
  appearance: none;
  position: relative;
  aspect-ratio: 4 / 3;
  padding: 0;
  border-radius: 5px;
  overflow: hidden;
  border: 1.5px solid rgba(148, 163, 184, 0.16);
  background: #060a12;
  cursor: pointer;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &[data-active="true"] {
    border-color: rgba(16, 185, 129, 0.85);
  }

  &[data-active="true"]::after {
    content: "✓";
    position: absolute;
    top: 1px;
    right: 3px;
    color: #a7f3d0;
    font-size: 10px;
    font-weight: 900;
    text-shadow: 0 0 4px rgba(0, 0, 0, 0.9);
  }
`;

const KeyGrid = styled.div`
  display: grid;
  gap: 6px;
`;

const InlineRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
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

// AI generation: capability-driven form (fields appear only when the chosen
// provider/mode uses them), thumbnail pickers for start frames and LoRA
// training sets, streaming job progress, inline key management.
export default function GeneratePanel({ assets = [], onGenerated, repoPath = "" }) {
  const [providerId, setProviderId] = useState(VIDEO_PROVIDERS[0].id);
  const provider = getVideoProvider(providerId) || VIDEO_PROVIDERS[0];
  const capabilities = provider.capabilities || {};
  const [model, setModel] = useState(provider.models[0]);
  const [mode, setMode] = useState(provider.modes[0]);
  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(capabilities.duration?.default || 5);
  const [aspect, setAspect] = useState("16:9");
  const [startFramePath, setStartFramePath] = useState("");
  const [sourceImagePaths, setSourceImagePaths] = useState([]);
  const [loraId, setLoraId] = useState("");
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [keysVersion, setKeysVersion] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  const [trainOpen, setTrainOpen] = useState(false);
  const [loras, setLoras] = useState([]);
  const [loraDraft, setLoraDraft] = useState({ name: "", triggerWord: "", steps: 1000, imagePaths: [] });

  useEffect(() => {
    if (!provider.models.includes(model)) {
      setModel(provider.models[0]);
    }
    if (!provider.modes.includes(mode)) {
      setMode(provider.modes[0]);
    }
    if (!provider.supportsLora) {
      setLoraId("");
    }
    const defaultDuration = provider.capabilities?.duration?.default;
    if (defaultDuration) {
      setDurationSec((current) => {
        const range = provider.capabilities.duration;
        const value = Number(current) || defaultDuration;
        return Math.min(range.max, Math.max(range.min, value));
      });
    }
  }, [mode, model, provider]);

  const keyReady = useMemo(() => videoProviderKeyReady(providerId), [providerId, keysVersion]);
  const auth = useMemo(() => videoProviderAuth(providerId), [providerId, keysVersion]);

  const refreshLoras = useCallback(() => {
    invoke("video_lora_list")
      .then((result) => setLoras(Array.isArray(result?.loras) ? result.loras : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshLoras();
  }, [refreshLoras]);

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
    const upsert = (payload, kind) => {
      if (disposed || !payload?.jobId) {
        return;
      }
      setJobs((current) => {
        const next = current.filter((job) => job.jobId !== payload.jobId);
        next.unshift({ ...payload, kind });
        return next.slice(0, 12);
      });
      if (payload.done && !payload.error) {
        if (kind === "generate") {
          onGenerated?.(payload);
        } else {
          refreshLoras();
        }
      }
    };
    listen(VIDEO_GENERATE_PROGRESS_EVENT, (event) => upsert(event?.payload, "generate"))
      .then(adopt)
      .catch(() => {});
    listen(VIDEO_LORA_PROGRESS_EVENT, (event) => upsert(event?.payload, "lora"))
      .then(adopt)
      .catch(() => {});
    return () => {
      disposed = true;
      for (const fn of unlisteners) {
        fn();
      }
    };
  }, [onGenerated, refreshLoras]);

  const imageAssets = useMemo(() => assets.filter((asset) => asset.kind === "image"), [assets]);
  const isImageToVideo = mode === "image-to-video";
  const isImageEdit = mode === "image-edit";
  const wantsStartFrame = isImageToVideo && capabilities.startFrame;
  const wantsSourceImages = isImageEdit && capabilities.sourceImages;
  const wantsDuration = provider.kind === "video" && capabilities.duration;
  const wantsAspect = Boolean(capabilities.aspect);

  const toggleSourceImage = useCallback((path) => {
    setSourceImagePaths((current) =>
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path],
    );
  }, []);

  const startGenerate = useCallback(async () => {
    setError("");
    if (!prompt.trim() && !isImageEdit) {
      setError("Write a prompt first.");
      return;
    }
    if (wantsStartFrame && !startFramePath) {
      setError("Pick a start frame image below.");
      return;
    }
    if (wantsSourceImages && !sourceImagePaths.length) {
      setError("Pick at least one image to edit.");
      return;
    }
    if (!keyReady) {
      setError(`Add your ${provider.label} API key first.`);
      setKeysOpen(true);
      return;
    }
    const inputAssetPaths = wantsStartFrame
      ? [startFramePath]
      : wantsSourceImages
        ? sourceImagePaths
        : [];
    try {
      await invoke("video_generate_start", {
        repoPath,
        request: {
          providerId,
          model,
          mode,
          prompt: prompt.trim(),
          inputAssetPaths,
          params: {
            durationSec: wantsDuration ? Number(durationSec) || capabilities.duration.default : null,
            aspect: wantsAspect ? aspect : null,
            resolution: null,
            seed: null,
          },
          loraId: provider.supportsLora && loraId ? loraId : null,
          auth,
        },
      });
    } catch (err) {
      setError(String(err));
    }
  }, [aspect, auth, capabilities, durationSec, isImageEdit, keyReady, loraId, mode, model, prompt, provider, providerId, repoPath, sourceImagePaths, startFramePath, wantsAspect, wantsDuration, wantsSourceImages, wantsStartFrame]);

  const startLoraTraining = useCallback(async () => {
    setError("");
    const falAuth = videoProviderAuth("flux-lora");
    if (!falAuth.apiKey) {
      setError("LoRA training uses fal.ai — add the Flux + LoRA API key first.");
      setKeysOpen(true);
      return;
    }
    if (!loraDraft.name.trim() || !loraDraft.triggerWord.trim()) {
      setError("Give the LoRA a name and a trigger word.");
      return;
    }
    if (loraDraft.imagePaths.length < 4) {
      setError("Pick at least 4 training images.");
      return;
    }
    try {
      await invoke("video_lora_train_start", {
        repoPath,
        request: {
          name: loraDraft.name.trim(),
          triggerWord: loraDraft.triggerWord.trim(),
          imagePaths: loraDraft.imagePaths,
          steps: Number(loraDraft.steps) || 1000,
          auth: { apiKey: falAuth.apiKey, baseUrl: falAuth.baseUrl },
        },
      });
      setLoraDraft({ name: "", triggerWord: "", steps: 1000, imagePaths: [] });
    } catch (err) {
      setError(String(err));
    }
  }, [loraDraft, repoPath]);

  const savedKeys = useMemo(() => readVideoProviderKeys(), [keysVersion]);

  const providerOptions = VIDEO_PROVIDERS.map((entry) => ({
    value: entry.id,
    label: `${entry.label} · ${entry.kind}`,
  }));
  const modelOptions = provider.models.map((entry) => ({ value: entry, label: entry }));
  const modeOptions = provider.modes.map((entry) => ({ value: entry, label: entry.replace(/-/g, " ") }));
  const aspectOptions = ["16:9", "9:16", "1:1", "4:3"].map((entry) => ({ value: entry, label: entry }));

  return (
    <PanelRoot data-video-generate="true">
      <Section>
        <FieldRow>
          <VideoLabel>
            Provider
            <AppSelect onChange={setProviderId} options={providerOptions} value={providerId} />
          </VideoLabel>
          <VideoLabel>
            Model
            <AppSelect onChange={setModel} options={modelOptions} value={model} />
          </VideoLabel>
          <VideoLabel>
            Mode
            <AppSelect onChange={setMode} options={modeOptions} value={mode} />
          </VideoLabel>
        </FieldRow>
        <VideoLabel>
          Prompt
          <VideoTextArea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              isImageEdit
                ? "Describe the edit (optional for some providers)…"
                : "Describe the shot, style, camera move…"
            }
            rows={3}
            value={prompt}
          />
        </VideoLabel>
        {wantsDuration || wantsAspect ? (
          <FieldRow>
            {wantsDuration ? (
              <VideoLabel>
                Duration (s)
                <VideoInput
                  max={capabilities.duration.max}
                  min={capabilities.duration.min}
                  onChange={(event) => setDurationSec(event.target.value)}
                  type="number"
                  value={durationSec}
                />
              </VideoLabel>
            ) : null}
            {wantsAspect ? (
              <VideoLabel>
                Aspect
                <AppSelect onChange={setAspect} options={aspectOptions} value={aspect} />
              </VideoLabel>
            ) : null}
          </FieldRow>
        ) : null}
        {wantsStartFrame ? (
          <div>
            <VideoLabel as="div">Start frame</VideoLabel>
            {imageAssets.length ? (
              <ThumbStrip style={{ marginTop: 4 }}>
                {imageAssets.map((asset) => (
                  <ThumbPick
                    data-active={startFramePath === asset.path ? "true" : "false"}
                    data-label={asset.name}
                    key={asset.path}
                    onClick={() => setStartFramePath((current) => (current === asset.path ? "" : asset.path))}
                    title={asset.name}
                    type="button"
                  >
                    {asset.thumbnailDataUrl ? <img alt="" src={asset.thumbnailDataUrl} /> : null}
                  </ThumbPick>
                ))}
              </ThumbStrip>
            ) : (
              <VideoHint style={{ marginTop: 3 }}>
                No images in the library yet — import one, generate one, or capture a frame from the
                preview (camera button under the player).
              </VideoHint>
            )}
          </div>
        ) : null}
        {wantsSourceImages ? (
          <div>
            <VideoLabel as="div">Images to edit</VideoLabel>
            {imageAssets.length ? (
              <ThumbStrip style={{ marginTop: 4 }}>
                {imageAssets.map((asset) => (
                  <ThumbPick
                    data-active={sourceImagePaths.includes(asset.path) ? "true" : "false"}
                    data-label={asset.name}
                    key={asset.path}
                    onClick={() => toggleSourceImage(asset.path)}
                    title={asset.name}
                    type="button"
                  >
                    {asset.thumbnailDataUrl ? <img alt="" src={asset.thumbnailDataUrl} /> : null}
                  </ThumbPick>
                ))}
              </ThumbStrip>
            ) : (
              <VideoHint style={{ marginTop: 3 }}>No images in the library yet.</VideoHint>
            )}
          </div>
        ) : null}
        {provider.supportsLora ? (
          <div>
            <VideoLabel as="div">LoRA</VideoLabel>
            <LoraChipRow style={{ marginTop: 4 }}>
              <LoraChip data-active={loraId === "" ? "true" : "false"} onClick={() => setLoraId("")} type="button">
                none
              </LoraChip>
              {loras.map((lora) => (
                <LoraChip
                  data-active={loraId === lora.id ? "true" : "false"}
                  data-disabled={lora.status !== "ready" ? "true" : "false"}
                  key={lora.id}
                  onClick={() => lora.status === "ready" && setLoraId(lora.id)}
                  title={lora.status === "ready" ? `Trigger word: ${lora.triggerWord}` : `Status: ${lora.status}`}
                  type="button"
                >
                  {lora.name}
                  {lora.status !== "ready" ? ` · ${lora.status}` : ""}
                </LoraChip>
              ))}
              <LoraChip onClick={() => setTrainOpen((open) => !open)} type="button">
                {trainOpen ? "− train new" : "+ train new"}
              </LoraChip>
            </LoraChipRow>
          </div>
        ) : null}
        {error ? <VideoErrorText>{error}</VideoErrorText> : null}
        <InlineRow>
          <VideoPaneButton disabled={!repoPath} onClick={startGenerate} type="button">
            Generate
          </VideoPaneButton>
          <VideoSecondaryButton onClick={() => setKeysOpen((open) => !open)} type="button">
            {keysOpen ? "Hide keys" : "API keys"}
          </VideoSecondaryButton>
          {!keyReady ? <VideoHint>{provider.label} key missing</VideoHint> : null}
        </InlineRow>
        {keysOpen ? (
          <KeyGrid>
            {VIDEO_PROVIDERS.map((entry) => {
              const saved = savedKeys[entry.id] || {};
              return (
                <VideoLabel key={entry.id}>
                  {entry.label}
                  <VideoInput
                    autoComplete="off"
                    onChange={(event) => {
                      writeVideoProviderKey(entry.id, { apiKey: event.target.value });
                      setKeysVersion((version) => version + 1);
                    }}
                    placeholder={entry.keyHint}
                    type="password"
                    value={saved.apiKey || ""}
                  />
                  {entry.requiresSecretKey ? (
                    <VideoInput
                      autoComplete="off"
                      onChange={(event) => {
                        writeVideoProviderKey(entry.id, { secretKey: event.target.value });
                        setKeysVersion((version) => version + 1);
                      }}
                      placeholder="Secret key"
                      type="password"
                      value={saved.secretKey || ""}
                    />
                  ) : null}
                  <VideoInput
                    autoComplete="off"
                    onChange={(event) => {
                      writeVideoProviderKey(entry.id, { baseUrl: event.target.value });
                      setKeysVersion((version) => version + 1);
                    }}
                    placeholder="Base URL override (optional)"
                    value={saved.baseUrl || ""}
                  />
                </VideoLabel>
              );
            })}
            <VideoHint>Keys stay in this app's local storage and go only to the provider.</VideoHint>
          </KeyGrid>
        ) : null}
      </Section>
      {trainOpen && provider.supportsLora ? (
        <Section>
          <SectionTitle>
            <span>Train a LoRA · Flux Klein (fal.ai)</span>
          </SectionTitle>
          <VideoHint>
            Teach Flux your product, character, or style from your own images — then use it above and
            feed the stills into any video model.
          </VideoHint>
          <FieldRow>
            <VideoLabel>
              Name
              <VideoInput
                onChange={(event) => setLoraDraft((draft) => ({ ...draft, name: event.target.value }))}
                placeholder="my-product"
                value={loraDraft.name}
              />
            </VideoLabel>
            <VideoLabel>
              Trigger word
              <VideoInput
                onChange={(event) => setLoraDraft((draft) => ({ ...draft, triggerWord: event.target.value }))}
                placeholder="MYPRODUCT"
                value={loraDraft.triggerWord}
              />
            </VideoLabel>
            <VideoLabel>
              Steps
              <VideoInput
                max={4000}
                min={100}
                onChange={(event) => setLoraDraft((draft) => ({ ...draft, steps: event.target.value }))}
                type="number"
                value={loraDraft.steps}
              />
            </VideoLabel>
          </FieldRow>
          <InlineRow>
            <VideoLabel as="div">Training images · {loraDraft.imagePaths.length} selected</VideoLabel>
            <VideoSecondaryButton
              onClick={() =>
                setLoraDraft((draft) => ({ ...draft, imagePaths: imageAssets.map((asset) => asset.path) }))
              }
              type="button"
            >
              All
            </VideoSecondaryButton>
            <VideoSecondaryButton
              onClick={() => setLoraDraft((draft) => ({ ...draft, imagePaths: [] }))}
              type="button"
            >
              None
            </VideoSecondaryButton>
          </InlineRow>
          {imageAssets.length ? (
            <TrainGrid>
              {imageAssets.map((asset) => (
                <TrainThumb
                  data-active={loraDraft.imagePaths.includes(asset.path) ? "true" : "false"}
                  key={asset.path}
                  onClick={() =>
                    setLoraDraft((draft) => ({
                      ...draft,
                      imagePaths: draft.imagePaths.includes(asset.path)
                        ? draft.imagePaths.filter((entry) => entry !== asset.path)
                        : [...draft.imagePaths, asset.path],
                    }))
                  }
                  title={asset.name}
                  type="button"
                >
                  {asset.thumbnailDataUrl ? <img alt="" src={asset.thumbnailDataUrl} /> : null}
                </TrainThumb>
              ))}
            </TrainGrid>
          ) : (
            <VideoHint>Import images into the library first.</VideoHint>
          )}
          <InlineRow>
            <VideoPaneButton disabled={!repoPath} onClick={startLoraTraining} type="button">
              Train LoRA
            </VideoPaneButton>
            <VideoHint>4+ images recommended · runs on fal.ai</VideoHint>
          </InlineRow>
        </Section>
      ) : null}
      <Section style={{ borderBottom: "none" }}>
        <SectionTitle>
          <span>Jobs</span>
        </SectionTitle>
        {!jobs.length ? (
          <VideoHint>Generations land in media/generated and appear in the library (AI filter).</VideoHint>
        ) : null}
        {jobs.map((job) => (
          <JobRow key={job.jobId}>
            <JobTitle $tone={jobTone(job)}>
              {job.kind === "lora" ? "LoRA training" : job.providerId || "generate"}
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
            ) : null}
          </JobRow>
        ))}
      </Section>
    </PanelRoot>
  );
}
