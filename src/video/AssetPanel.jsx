import React, { useCallback, useMemo, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { estimateModelUsd, resolutionClass, upscaleModelsFor } from "./generationCatalog.js";
import { formatTimecode } from "./videoEditorModel.js";
import {
  VideoDangerButton,
  VideoErrorText,
  VideoHint,
  VideoLabel,
  VideoPaneButton,
  VideoSecondaryButton,
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

const PreviewThumb = styled.div`
  border-radius: 8px;
  overflow: hidden;
  background: #060a12;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;

const AssetName = styled.div`
  font-size: 11.5px;
  font-weight: 800;
  color: rgba(226, 232, 240, 0.94);
  overflow-wrap: anywhere;
`;

const MetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px;
`;

const MetaCell = styled.div`
  display: grid;
  gap: 1px;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 7px;
  background: rgba(4, 8, 14, 0.6);

  b {
    font-size: 11px;
    font-weight: 800;
    color: rgba(226, 232, 240, 0.94);
  }

  span {
    font-size: 8.5px;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #7d8ca3;
  }
`;

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(167, 243, 208, 0.9);
`;

const UpscaleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(4, 8, 14, 0.6);
`;

const UpscaleInfo = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;

  b {
    font-size: 11px;
    font-weight: 750;
    color: rgba(226, 232, 240, 0.94);
  }

  span {
    font-size: 9px;
    font-weight: 650;
    color: #7d8ca3;
  }
`;

const SpeedBadge = styled.span`
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.$speed === "Fast"
        ? "rgba(52, 211, 153, 0.45)"
        : props.$speed === "Slow"
          ? "rgba(248, 113, 113, 0.4)"
          : "rgba(251, 191, 36, 0.4)"};
  color: ${(props) => (props.$speed === "Fast" ? "#6ee7b7" : props.$speed === "Slow" ? "#fca5a5" : "#fcd34d")};
`;

const InlineRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
`;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)} GB`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(value / 1000))} KB`;
}

// Per-asset detail panel: metadata (dimensions / resolution class / duration /
// size), transcript entry point, and palmier-style upscale options — each
// upscaler shows its provider, speed class, and cost estimate.
export default function AssetPanel({
  asset,
  assetsByPath = {},
  onAddToTimeline,
  onDeleted,
  onOpenAsset,
  onOpenTranscript,
  repoPath = "",
}) {
  const [error, setError] = useState("");
  const [startedUpscaleId, setStartedUpscaleId] = useState("");

  const upscalers = useMemo(
    () => (asset && (asset.kind === "video" || asset.kind === "image") ? upscaleModelsFor(asset.kind) : []),
    [asset],
  );

  // Lineage both ways: what this asset was derived from (manifest relations)
  // and what was derived FROM it (reverse scan) — so original ↔ upscale is
  // one click in either direction.
  const parents = useMemo(
    () => (Array.isArray(asset?.relations) ? asset.relations.filter((rel) => rel?.type === "derived-from") : []),
    [asset],
  );
  const children = useMemo(() => {
    if (!asset?.path) {
      return [];
    }
    return Object.values(assetsByPath).filter((other) =>
      Array.isArray(other?.relations) &&
      other.relations.some((rel) => rel?.type === "derived-from" && rel.path === asset.path),
    );
  }, [asset, assetsByPath]);

  const startUpscale = useCallback(
    (model) => {
      if (!repoPath || !asset?.path) {
        return;
      }
      setError("");
      setStartedUpscaleId(model.id);
      invoke("video_generate_start", {
        repoPath,
        request: {
          providerId: "cloud",
          model: model.id,
          kind: "upscale",
          mode: asset.kind === "video" ? "upscale-video" : "upscale-image",
          prompt: "",
          inputAssetPaths: [asset.path],
          params: { durationSec: null, aspect: null, resolution: null, quality: null, numImages: null, seed: null },
          loraId: null,
          auth: { apiKey: "", secretKey: "", baseUrl: "" },
        },
      })
        .then(() => window.setTimeout(() => setStartedUpscaleId(""), 2500))
        .catch((err) => {
          setStartedUpscaleId("");
          setError(String(err));
        });
    },
    [asset, repoPath],
  );

  const deleteAsset = useCallback(() => {
    if (!repoPath || !asset?.path) {
      return;
    }
    invoke("video_media_delete", { repoPath, path: asset.path })
      .then(() => onDeleted?.(asset))
      .catch((err) => setError(String(err)));
  }, [asset, onDeleted, repoPath]);

  if (!asset) {
    return (
      <PanelRoot>
        <Section style={{ borderBottom: "none" }}>
          <VideoHint>Select a media item in the Library to inspect it.</VideoHint>
        </Section>
      </PanelRoot>
    );
  }

  const resClass = resolutionClass(asset.width, asset.height);
  const durationSecEstimate = Math.max(1, Math.round((Number(asset.durationMs) || 0) / 1000));

  return (
    <PanelRoot data-video-asset-panel="true">
      <Section>
        <PreviewThumb>{asset.thumbnailDataUrl ? <img alt="" src={asset.thumbnailDataUrl} /> : null}</PreviewThumb>
        <AssetName>{asset.name}</AssetName>
        <MetaGrid>
          <MetaCell>
            <b>{asset.folder === "generated" ? "AI · " : ""}{asset.kind}</b>
            <span>Type</span>
          </MetaCell>
          {asset.width && asset.height ? (
            <MetaCell>
              <b>
                {asset.kind === "video" && resClass ? resClass : `${asset.width}×${asset.height}`}
              </b>
              <span>{asset.kind === "video" ? "Resolution" : "Dimensions"}</span>
            </MetaCell>
          ) : null}
          {asset.kind === "video" && asset.width && asset.height ? (
            <MetaCell>
              <b>{asset.width}×{asset.height}</b>
              <span>Pixels</span>
            </MetaCell>
          ) : null}
          {Number(asset.durationMs) > 0 ? (
            <MetaCell>
              <b>{formatTimecode(asset.durationMs)}</b>
              <span>Duration</span>
            </MetaCell>
          ) : null}
          {Number(asset.sizeBytes) > 0 ? (
            <MetaCell>
              <b>{formatBytes(asset.sizeBytes)}</b>
              <span>Size</span>
            </MetaCell>
          ) : null}
          {asset.kind !== "image" ? (
            <MetaCell>
              <b>{asset.hasTranscript ? (asset.transcriptInherited ? "Shared" : "Yes") : "No"}</b>
              <span>Transcript</span>
            </MetaCell>
          ) : null}
        </MetaGrid>
        {asset.transcriptInherited ? (
          <VideoHint>Transcript is shared from the original video — same audio, no re-transcription needed.</VideoHint>
        ) : null}
        {parents.length || children.length ? (
          <InlineRow>
            {parents.map((rel) => {
              const source = assetsByPath[rel.path];
              return (
                <VideoSecondaryButton
                  key={`from-${rel.path}`}
                  onClick={() => source && onOpenAsset?.(source)}
                  title={rel.path}
                  type="button"
                >
                  ⤴ {rel.via === "upscale" ? "Upscaled from" : "Generated from"}{" "}
                  {source?.name || rel.path.split("/").pop()}
                </VideoSecondaryButton>
              );
            })}
            {children.map((other) => (
              <VideoSecondaryButton
                key={`to-${other.path}`}
                onClick={() => onOpenAsset?.(other)}
                title={other.path}
                type="button"
              >
                ⤵ {other.name}
                {other.width && other.height && resolutionClass(other.width, other.height)
                  ? ` (${resolutionClass(other.width, other.height)})`
                  : ""}
              </VideoSecondaryButton>
            ))}
          </InlineRow>
        ) : null}
        <InlineRow>
          <VideoPaneButton onClick={() => onAddToTimeline?.(asset)} type="button">
            + Add to timeline
          </VideoPaneButton>
          {asset.kind !== "image" ? (
            <VideoSecondaryButton onClick={() => onOpenTranscript?.(asset)} type="button">
              Transcript
            </VideoSecondaryButton>
          ) : null}
          <VideoDangerButton onClick={deleteAsset} type="button">
            Delete
          </VideoDangerButton>
        </InlineRow>
        {error ? <VideoErrorText>{error}</VideoErrorText> : null}
      </Section>
      {upscalers.length ? (
        <Section style={{ borderBottom: "none" }}>
          <SectionTitle>Upscale</SectionTitle>
          <VideoHint>
            Runs through your cloud — the result lands in the library next to the original
            {asset.kind === "video" && resClass ? ` (currently ${resClass})` : ""}.
          </VideoHint>
          {upscalers.map((model) => {
            const usd = estimateModelUsd(model, { durationSec: durationSecEstimate });
            return (
              <UpscaleRow key={model.id}>
                <UpscaleInfo>
                  <b>{model.displayName}</b>
                  <span>
                    {model.providerLabel}
                    {usd != null ? ` · ≈ $${usd.toFixed(2)}` : ""}
                  </span>
                </UpscaleInfo>
                <SpeedBadge $speed={model.caps.speed}>{model.caps.speed}</SpeedBadge>
                <VideoPaneButton
                  disabled={startedUpscaleId === model.id}
                  onClick={() => startUpscale(model)}
                  type="button"
                >
                  {startedUpscaleId === model.id ? "Queued ✓" : "Upscale"}
                </VideoPaneButton>
              </UpscaleRow>
            );
          })}
        </Section>
      ) : null}
    </PanelRoot>
  );
}
