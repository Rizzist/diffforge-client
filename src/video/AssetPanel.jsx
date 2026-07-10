import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DESCRIBE_CREDITS_ESTIMATE,
  estimateModelCredits,
  readAutoDescribeEnabled,
  resolutionClass,
  upscaleModelsFor,
  writeAutoDescribeEnabled,
} from "./generationCatalog.js";
import { formatTimecode } from "./videoEditorModel.js";
import { emitVideoAssetDrag } from "./videoDragEvents.js";
import {
  VIDEO_ANNOTATION_UPDATED_EVENT,
  VIDEO_DESCRIBE_PROGRESS_EVENT,
  VIDEO_POLISH_PROGRESS_EVENT,
} from "./videoPanelBridge.js";
import { buildKeepRanges, detectTakeGroups } from "./videoTakes.js";
import {
  VideoDangerButton,
  VideoErrorText,
  VideoHint,
  VideoPaneButton,
  VideoProgressFill,
  VideoProgressTrack,
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

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(15, 23, 42, 0.1);
  }
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

  html[data-forge-theme="light"] & {
    background: #eef1f6;
  }
`;

const AssetName = styled.div`
  font-size: 11.5px;
  font-weight: 800;
  color: rgba(226, 232, 240, 0.94);
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
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

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: #f8fafc;
  }

  html[data-forge-theme="light"] & b {
    color: #0f172a;
  }

  html[data-forge-theme="light"] & span {
    color: #64748b;
  }
`;

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(167, 243, 208, 0.9);

  html[data-forge-theme="light"] & {
    color: #047857;
  }
`;

const UpscaleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(4, 8, 14, 0.6);

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: #f8fafc;
  }
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

  html[data-forge-theme="light"] & b {
    color: #0f172a;
  }

  html[data-forge-theme="light"] & span {
    color: #64748b;
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

  html[data-forge-theme="light"] & {
    border-color: ${(props) =>
      props.$speed === "Fast"
        ? "rgba(5, 150, 105, 0.5)"
        : props.$speed === "Slow"
          ? "rgba(220, 38, 38, 0.45)"
          : "rgba(180, 83, 9, 0.45)"};
    color: ${(props) => (props.$speed === "Fast" ? "#047857" : props.$speed === "Slow" ? "#dc2626" : "#b45309")};
  }
`;

const InlineRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
`;

// One row per file in the asset's version family (original / polished /
// upscaled / …). The thumb is pointer-draggable straight onto the timeline.
const VersionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(4, 8, 14, 0.6);

  &[data-current="true"] {
    border-color: rgba(96, 165, 250, 0.5);
    background: rgba(37, 99, 235, 0.08);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: #f8fafc;
  }

  html[data-forge-theme="light"] &[data-current="true"] {
    border-color: rgba(37, 99, 235, 0.45);
    background: rgba(37, 99, 235, 0.08);
  }
`;

const VersionThumb = styled.div`
  flex: none;
  width: 66px;
  height: 42px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: #060a12;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  span {
    font-size: 14px;
    color: rgba(148, 163, 184, 0.7);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.12);
    background: #eef1f6;
  }

  html[data-forge-theme="light"] & span {
    color: rgba(100, 116, 139, 0.85);
  }
`;

const VersionInfo = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;

  b {
    font-size: 10.5px;
    font-weight: 750;
    color: rgba(226, 232, 240, 0.94);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  span {
    font-size: 9px;
    font-weight: 600;
    color: #7d8ca3;
  }

  html[data-forge-theme="light"] & b {
    color: #0f172a;
  }

  html[data-forge-theme="light"] & span {
    color: #64748b;
  }
`;

// Badge colors are picked at call sites from VERSION_BADGES / ANNOTATION_STATUS_BADGES
// (dark palette); these tables give the light-theme equivalent for each known value.
const LIGHT_BADGE_BORDER = {
  "rgba(148, 163, 184, 0.45)": "rgba(15, 23, 42, 0.18)",
  "rgba(148, 163, 184, 0.4)": "rgba(15, 23, 42, 0.16)",
  "rgba(148, 163, 184, 0.3)": "rgba(15, 23, 42, 0.12)",
  "rgba(16, 185, 129, 0.5)": "rgba(5, 150, 105, 0.5)",
  "rgba(96, 165, 250, 0.5)": "rgba(37, 99, 235, 0.45)",
  "rgba(192, 132, 252, 0.5)": "rgba(147, 51, 234, 0.45)",
  "rgba(251, 191, 36, 0.5)": "rgba(180, 83, 9, 0.45)",
};

const LIGHT_BADGE_TEXT = {
  "#cbd5f5": "#475569",
  "#6ee7b7": "#047857",
  "#93c5fd": "#1d4ed8",
  "#d8b4fe": "#7e22ce",
  "#fcd34d": "#b45309",
  "#fca5a5": "#dc2626",
  "#7d8ca3": "#64748b",
};

const VersionBadge = styled.span`
  display: inline-flex;
  width: fit-content;
  font-size: 8px;
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid ${(props) => props.$color || "rgba(148, 163, 184, 0.4)"};
  color: ${(props) => props.$text || "#cbd5f5"};

  html[data-forge-theme="light"] & {
    border-color: ${(props) => LIGHT_BADGE_BORDER[props.$color] || "rgba(15, 23, 42, 0.16)"};
    color: ${(props) => LIGHT_BADGE_TEXT[props.$text] || "#334155"};
  }
`;

const DragGhost = styled.div`
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

  html[data-forge-theme="light"] & {
    border-color: rgba(5, 150, 105, 0.5);
    background: #ffffff;
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
  }

  html[data-forge-theme="light"] & span {
    color: #0f172a;
  }
`;

// Take-group card for the Polish flow.
const TakeGroup = styled.div`
  display: grid;
  gap: 5px;
  padding: 7px 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(4, 8, 14, 0.6);

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: #f8fafc;
  }
`;

const TakeGroupTitle = styled.div`
  font-size: 9.5px;
  font-weight: 850;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #93c5fd;

  html[data-forge-theme="light"] & {
    color: #1d4ed8;
  }
`;

const TakeOption = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 5px 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;

  &[data-selected="true"] {
    border-color: rgba(16, 185, 129, 0.4);
    background: rgba(16, 185, 129, 0.06);
  }

  input {
    margin-top: 2px;
    accent-color: #10b981;
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    border-color: rgba(5, 150, 105, 0.4);
    background: rgba(16, 185, 129, 0.08);
  }
`;

const TakeText = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;

  em {
    font-style: normal;
    font-size: 9px;
    font-weight: 750;
    color: #7d8ca3;
  }

  p {
    margin: 0;
    font-size: 10px;
    font-weight: 550;
    line-height: 1.4;
    color: rgba(203, 213, 225, 0.9);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  html[data-forge-theme="light"] & em {
    color: #64748b;
  }

  html[data-forge-theme="light"] & p {
    color: #0f172a;
  }
`;

const AiPickBadge = styled.span`
  flex: none;
  font-size: 8px;
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  color: #6ee7b7;
  align-self: center;

  html[data-forge-theme="light"] & {
    border-color: rgba(5, 150, 105, 0.45);
    color: #047857;
  }
`;

// Photo annotation (Description section) pieces.
const AnnotationBlurb = styled.div`
  font-size: 11px;
  font-weight: 750;
  line-height: 1.45;
  color: rgba(226, 232, 240, 0.94);
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const AnnotationBody = styled.p`
  margin: 0;
  font-size: 10.5px;
  font-weight: 550;
  line-height: 1.5;
  color: rgba(203, 213, 225, 0.88);
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #1e293b;
  }
`;

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const TagChip = styled.span`
  font-size: 8.5px;
  font-weight: 750;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #a5b4cf;

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.16);
    color: #475569;
  }
`;

const AnnotationInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  background: rgba(4, 8, 14, 0.6);
  color: rgba(226, 232, 240, 0.94);
  font-size: 10.5px;
  font-weight: 600;

  &:focus {
    outline: none;
    border-color: rgba(16, 185, 129, 0.45);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.14);
    background: #ffffff;
    color: #0f172a;
  }

  html[data-forge-theme="light"] &:focus {
    border-color: rgba(5, 150, 105, 0.45);
  }
`;

const AnnotationTextarea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  min-height: 64px;
  resize: vertical;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  background: rgba(4, 8, 14, 0.6);
  color: rgba(226, 232, 240, 0.94);
  font-size: 10.5px;
  font-weight: 550;
  line-height: 1.5;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: rgba(16, 185, 129, 0.45);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.14);
    background: #ffffff;
    color: #0f172a;
  }

  html[data-forge-theme="light"] &:focus {
    border-color: rgba(5, 150, 105, 0.45);
  }
`;

const ToggleRow = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9.5px;
  font-weight: 650;
  color: #7d8ca3;
  cursor: pointer;

  input {
    accent-color: #10b981;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const ANNOTATION_STATUS_BADGES = {
  describing: { label: "Describing…", color: "rgba(251, 191, 36, 0.5)", text: "#fcd34d" },
  shared: { label: "Shared", color: "rgba(96, 165, 250, 0.5)", text: "#93c5fd" },
  edited: { label: "Edited", color: "rgba(16, 185, 129, 0.5)", text: "#6ee7b7" },
  agent: { label: "By agent", color: "rgba(192, 132, 252, 0.5)", text: "#d8b4fe" },
  llm: { label: "AI", color: "rgba(148, 163, 184, 0.45)", text: "#cbd5f5" },
  none: { label: "None", color: "rgba(148, 163, 184, 0.3)", text: "#7d8ca3" },
};

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

const VERSION_BADGES = {
  original: { label: "Original", color: "rgba(148, 163, 184, 0.45)", text: "#cbd5f5" },
  polish: { label: "Polished", color: "rgba(16, 185, 129, 0.5)", text: "#6ee7b7" },
  upscale: { label: "Upscaled", color: "rgba(96, 165, 250, 0.5)", text: "#93c5fd" },
  generate: { label: "Generated", color: "rgba(192, 132, 252, 0.5)", text: "#d8b4fe" },
  "hyperframes-render": { label: "Code render", color: "rgba(251, 191, 36, 0.5)", text: "#fcd34d" },
};

// Walks the derived-from graph to the family root, then breadth-first back
// down, so every version of the same source shows in one list regardless of
// which one is selected.
function collectVersionFamily(asset, assetsByPath) {
  if (!asset?.path) {
    return [];
  }
  const parentOf = (node) =>
    (Array.isArray(node?.relations) ? node.relations : []).find(
      (rel) => rel?.type === "derived-from" && assetsByPath[rel.path],
    );
  let root = asset;
  const seenUp = new Set([asset.path]);
  for (let hop = 0; hop < 4; hop += 1) {
    const parent = parentOf(root);
    if (!parent || seenUp.has(parent.path)) {
      break;
    }
    seenUp.add(parent.path);
    root = assetsByPath[parent.path];
  }
  const family = [];
  const visited = new Set();
  const queue = [{ node: root, via: "original" }];
  while (queue.length) {
    const { node, via } = queue.shift();
    if (!node?.path || visited.has(node.path)) {
      continue;
    }
    visited.add(node.path);
    family.push({ asset: node, via });
    for (const other of Object.values(assetsByPath)) {
      if (visited.has(other.path)) {
        continue;
      }
      const edge = (Array.isArray(other.relations) ? other.relations : []).find(
        (rel) => rel?.type === "derived-from" && rel.path === node.path,
      );
      if (edge) {
        queue.push({ node: other, via: edge.via || "generate" });
      }
    }
  }
  return family;
}

// Unified per-asset viewer: metadata, the full version family (original /
// polished / upscaled — each addable or pointer-draggable onto the timeline),
// the transcript entry point, the Polish take-cleanup flow, and upscalers.
export default function AssetPanel({
  asset,
  assetsByPath = {},
  onAddToTimeline,
  onDeleted,
  onOpenAsset,
  onOpenTranscript,
  onReprobe,
  paneToken = "video-pane",
  repoPath = "",
}) {
  const [error, setError] = useState("");
  const [startedUpscaleId, setStartedUpscaleId] = useState("");
  const [drag, setDrag] = useState(null); // { asset, x, y }

  // Polish state, all reset when the inspected asset changes.
  const [takes, setTakes] = useState(null); // null | { status, groups }
  const [takeSelections, setTakeSelections] = useState({});
  const [polishJob, setPolishJob] = useState(null); // live progress payload

  // Photo annotation state (image assets).
  const [annotationInfo, setAnnotationInfo] = useState(null); // video_annotation_get result
  const [describeJob, setDescribeJob] = useState(null); // live progress payload
  const [editingAnnotation, setEditingAnnotation] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState({ blurb: "", description: "", tags: "" });
  const [autoDescribe, setAutoDescribe] = useState(() => readAutoDescribeEnabled());

  const assetPathRef = useRef("");
  useEffect(() => {
    assetPathRef.current = asset?.path || "";
    setTakes(null);
    setTakeSelections({});
    setPolishJob(null);
    setDescribeJob(null);
    setEditingAnnotation(false);
    setError("");
  }, [asset?.path]);

  const refreshAnnotation = useCallback(() => {
    if (!repoPath || !asset?.path || asset.kind !== "image" || asset.pending) {
      setAnnotationInfo(null);
      return;
    }
    const path = asset.path;
    invoke("video_annotation_get", { repoPath, path })
      .then((result) => {
        if (assetPathRef.current === path) {
          setAnnotationInfo(result || null);
        }
      })
      .catch(() => {});
  }, [asset, repoPath]);
  const refreshAnnotationRef = useRef(refreshAnnotation);
  refreshAnnotationRef.current = refreshAnnotation;

  useEffect(() => {
    refreshAnnotation();
  }, [refreshAnnotation]);

  useEffect(() => {
    let disposed = false;
    const unlistens = [];
    listen(VIDEO_DESCRIBE_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (!payload.jobId || payload.path !== assetPathRef.current) {
        return;
      }
      setDescribeJob(payload);
      if (payload.done && !payload.error) {
        refreshAnnotationRef.current();
      }
    })
      .then((next) => (disposed ? next() : unlistens.push(next)))
      .catch(() => {});
    listen(VIDEO_ANNOTATION_UPDATED_EVENT, (event) => {
      if (!disposed && event?.payload?.path === assetPathRef.current) {
        refreshAnnotationRef.current();
      }
    })
      .then((next) => (disposed ? next() : unlistens.push(next)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, []);

  const startDescribe = useCallback(
    (force) => {
      if (!repoPath || !asset?.path) {
        return;
      }
      if (
        force
        && annotationInfo?.annotation?.edited
        && !window.confirm("Re-describe will overwrite your edits to this description. Continue?")
      ) {
        return;
      }
      setError("");
      setEditingAnnotation(false);
      setDescribeJob({ state: "starting", percent: 0, done: false });
      invoke("video_describe_start", { repoPath, path: asset.path, force: Boolean(force) }).catch(
        (err) => {
          setDescribeJob(null);
          setError(String(err));
        },
      );
    },
    [annotationInfo, asset, repoPath],
  );

  const beginEditAnnotation = useCallback(() => {
    const annotation = annotationInfo?.annotation || {};
    setAnnotationDraft({
      blurb: annotation.blurb || "",
      description: annotation.description || "",
      tags: Array.isArray(annotation.tags) ? annotation.tags.join(", ") : "",
    });
    setEditingAnnotation(true);
  }, [annotationInfo]);

  const saveAnnotation = useCallback(() => {
    if (!repoPath || !asset?.path) {
      return;
    }
    const tags = annotationDraft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    setError("");
    invoke("video_annotation_update", {
      repoPath,
      path: asset.path,
      annotation: {
        blurb: annotationDraft.blurb,
        description: annotationDraft.description,
        tags,
      },
    })
      .then((result) => {
        setEditingAnnotation(false);
        setAnnotationInfo({
          available: true,
          inherited: false,
          inheritedFrom: null,
          annotation: result,
        });
      })
      .catch((err) => setError(String(err)));
  }, [annotationDraft, asset, repoPath]);

  const toggleAutoDescribe = useCallback(() => {
    setAutoDescribe((enabled) => {
      writeAutoDescribeEnabled(!enabled);
      return !enabled;
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_POLISH_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (!payload.jobId || payload.path !== assetPathRef.current) {
        return;
      }
      setPolishJob(payload);
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
  }, []);

  const upscalers = useMemo(
    () => (asset && (asset.kind === "video" || asset.kind === "image") ? upscaleModelsFor(asset.kind) : []),
    [asset],
  );

  const family = useMemo(() => collectVersionFamily(asset, assetsByPath), [asset, assetsByPath]);

  const beginVersionDrag = useCallback(
    (event, versionAsset) => {
      if (event.button !== 0 || versionAsset.pending) {
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
          emitVideoAssetDrag({ phase: "start", asset: versionAsset, paneToken, x: moveEvent.clientX, y: moveEvent.clientY });
        }
        setDrag({ asset: versionAsset, x: moveEvent.clientX, y: moveEvent.clientY });
        emitVideoAssetDrag({ phase: "move", asset: versionAsset, paneToken, x: moveEvent.clientX, y: moveEvent.clientY });
      };
      const finish = (endEvent, cancelled) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        setDrag(null);
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        if (state.started) {
          emitVideoAssetDrag({
            phase: cancelled ? "cancel" : "end",
            asset: versionAsset,
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

  const detectTakes = useCallback(() => {
    if (!repoPath || !asset?.path) {
      return;
    }
    setError("");
    setTakes({ status: "detecting", groups: [] });
    invoke("video_transcript_get", { repoPath, path: asset.path })
      .then((result) => {
        if (assetPathRef.current !== asset.path) {
          return;
        }
        if (!result?.available || !Array.isArray(result.segments) || !result.segments.length) {
          setTakes({ status: "no-transcript", groups: [] });
          return;
        }
        const groups = detectTakeGroups(result.segments);
        setTakes({ status: groups.length ? "ready" : "none", groups });
        setTakeSelections({});
      })
      .catch((err) => {
        setTakes(null);
        setError(String(err));
      });
  }, [asset, repoPath]);

  const polishPlan = useMemo(() => {
    if (!takes || takes.status !== "ready" || !asset) {
      return null;
    }
    return buildKeepRanges({
      durationMs: Number(asset.durationMs) || 0,
      groups: takes.groups,
      selections: takeSelections,
    });
  }, [asset, takeSelections, takes]);

  const startPolish = useCallback(() => {
    if (!repoPath || !asset?.path || !polishPlan?.keepRanges?.length) {
      return;
    }
    setError("");
    setPolishJob({ state: "starting", percent: 0, message: "Starting…", done: false });
    invoke("video_polish_start", {
      repoPath,
      path: asset.path,
      keepRanges: polishPlan.keepRanges,
    }).catch((err) => {
      setPolishJob(null);
      setError(String(err));
    });
  }, [asset, polishPlan, repoPath]);

  const startUpscale = useCallback(
    (model) => {
      if (!repoPath || !asset?.path) {
        return;
      }
      setError("");
      const durationMs = Number(asset.durationMs);
      if (asset.kind === "video" && (!Number.isFinite(durationMs) || durationMs <= 0)) {
        setError("source duration unknown — reprobe the asset");
        return;
      }
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
          params: {
            durationSec:
              asset.kind === "video"
                ? durationMs / 1000
                : null,
            aspect: null,
            resolution: null,
            quality: null,
            numImages: null,
            seed: null,
          },
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
  const assetDurationMs = Number(asset.durationMs);
  const videoDurationKnown = asset.kind !== "video"
    || (Number.isFinite(assetDurationMs) && assetDurationMs > 0);
  const durationSecEstimate = asset.kind === "video" && videoDurationKnown
    ? assetDurationMs / 1000
    : 1;
  const polishBusy = Boolean(polishJob && !polishJob.done);
  const annotation = annotationInfo?.annotation || null;
  const annotationAvailable = Boolean(annotationInfo?.available && annotation);
  const describeBusy = Boolean(describeJob && !describeJob.done);
  const annotationStatusKey = describeBusy
    ? "describing"
    : !annotationAvailable
      ? "none"
      : annotationInfo.inherited
        ? "shared"
        : annotation.source === "user"
          ? "edited"
          : annotation.source === "agent"
            ? "agent"
            : "llm";
  const annotationStatus = ANNOTATION_STATUS_BADGES[annotationStatusKey];
  const polishedOutput = polishJob?.done && !polishJob.error && polishJob.outputPath
    ? assetsByPath[polishJob.outputPath] || null
    : null;

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

      {asset.kind === "image" && !asset.pending ? (
        <Section>
          <InlineRow style={{ justifyContent: "space-between" }}>
            <SectionTitle>Description</SectionTitle>
            <VersionBadge $color={annotationStatus.color} $text={annotationStatus.text}>
              {annotationStatus.label}
            </VersionBadge>
          </InlineRow>
          {annotationInfo?.inherited ? (
            <VideoHint>
              Description is shared from the original image — an upscale shows identical content.
            </VideoHint>
          ) : null}
          {describeBusy ? (
            <div style={{ display: "grid", gap: 4 }}>
              <VideoProgressTrack>
                <VideoProgressFill
                  style={{ width: `${Math.min(100, Math.max(3, describeJob?.percent || 3))}%` }}
                />
              </VideoProgressTrack>
              <InlineRow>
                <VideoHint>
                  {describeJob?.state === "uploading"
                    ? "Uploading image…"
                    : describeJob?.state === "describing"
                      ? "The vision model is looking at the photo…"
                      : "Preparing image…"}
                </VideoHint>
                <VideoSecondaryButton
                  onClick={() =>
                    invoke("video_describe_cancel", { jobId: describeJob?.jobId }).catch(() => {})
                  }
                  type="button"
                >
                  Cancel
                </VideoSecondaryButton>
              </InlineRow>
            </div>
          ) : editingAnnotation ? (
            <>
              <AnnotationInput
                onChange={(event) =>
                  setAnnotationDraft((draft) => ({ ...draft, blurb: event.target.value }))
                }
                placeholder="One-line blurb — what the image shows"
                value={annotationDraft.blurb}
              />
              <AnnotationTextarea
                onChange={(event) =>
                  setAnnotationDraft((draft) => ({ ...draft, description: event.target.value }))
                }
                placeholder="Longer description: subjects, setting, composition, mood"
                value={annotationDraft.description}
              />
              <AnnotationInput
                onChange={(event) =>
                  setAnnotationDraft((draft) => ({ ...draft, tags: event.target.value }))
                }
                placeholder="Tags, comma separated"
                value={annotationDraft.tags}
              />
              <InlineRow>
                <VideoPaneButton onClick={saveAnnotation} type="button">
                  Save description
                </VideoPaneButton>
                <VideoSecondaryButton onClick={() => setEditingAnnotation(false)} type="button">
                  Cancel
                </VideoSecondaryButton>
              </InlineRow>
            </>
          ) : annotationAvailable ? (
            <>
              {annotation.blurb ? <AnnotationBlurb>{annotation.blurb}</AnnotationBlurb> : null}
              {annotation.description ? (
                <AnnotationBody>{annotation.description}</AnnotationBody>
              ) : null}
              {Array.isArray(annotation.tags) && annotation.tags.length ? (
                <TagRow>
                  {annotation.tags.map((tag) => (
                    <TagChip key={tag}>{tag}</TagChip>
                  ))}
                </TagRow>
              ) : null}
              {annotation.ocrText ? (
                <VideoHint>Text in image: “{annotation.ocrText}”</VideoHint>
              ) : null}
              <InlineRow>
                <VideoSecondaryButton onClick={beginEditAnnotation} type="button">
                  Edit
                </VideoSecondaryButton>
                <VideoSecondaryButton onClick={() => startDescribe(true)} type="button">
                  Re-describe · ≈{DESCRIBE_CREDITS_ESTIMATE} credits
                </VideoSecondaryButton>
              </InlineRow>
            </>
          ) : (
            <>
              <VideoHint>
                No description yet. A short AI blurb makes this photo searchable and tells coding
                agents what it shows.
              </VideoHint>
              <InlineRow>
                <VideoPaneButton onClick={() => startDescribe(false)} type="button">
                  ✦ Describe · ≈{DESCRIBE_CREDITS_ESTIMATE} credits
                </VideoPaneButton>
                <VideoSecondaryButton onClick={beginEditAnnotation} type="button">
                  Write manually
                </VideoSecondaryButton>
              </InlineRow>
            </>
          )}
          {describeJob?.done && describeJob.error ? (
            <VideoErrorText>{describeJob.error}</VideoErrorText>
          ) : null}
          <ToggleRow>
            <input checked={autoDescribe} onChange={toggleAutoDescribe} type="checkbox" />
            Auto-describe new photos (Diff Forge Cloud credits)
          </ToggleRow>
        </Section>
      ) : null}

      {family.length > 1 ? (
        <Section>
          <SectionTitle>Versions</SectionTitle>
          <VideoHint>
            Every cut of this media in one place — drag a thumbnail onto the timeline, or click a
            name to inspect that version.
          </VideoHint>
          {family.map(({ asset: version, via }) => {
            const badge = VERSION_BADGES[via] || VERSION_BADGES.generate;
            const versionRes = resolutionClass(version.width, version.height);
            return (
              <VersionRow data-current={version.path === asset.path ? "true" : "false"} key={version.path}>
                <VersionThumb
                  onPointerDown={(event) => beginVersionDrag(event, version)}
                  title={version.pending ? "Still generating…" : "Drag onto the timeline"}
                >
                  {version.thumbnailDataUrl ? (
                    <img alt="" draggable={false} src={version.thumbnailDataUrl} />
                  ) : (
                    <span aria-hidden>{version.pending ? "✦" : version.kind === "audio" ? "♪" : "◇"}</span>
                  )}
                </VersionThumb>
                <VersionInfo>
                  <b onClick={() => onOpenAsset?.(version)} title={version.path}>
                    {version.name}
                  </b>
                  <VersionBadge $color={badge.color} $text={badge.text}>
                    {badge.label}
                    {via === "upscale" && versionRes ? ` · ${versionRes}` : ""}
                  </VersionBadge>
                  <span>
                    {Number(version.durationMs) > 0 ? `${formatTimecode(version.durationMs)} · ` : ""}
                    {formatBytes(version.sizeBytes)}
                  </span>
                </VersionInfo>
                <VideoSecondaryButton
                  disabled={Boolean(version.pending)}
                  onClick={() => onAddToTimeline?.(version)}
                  title="Add this version at the playhead"
                  type="button"
                >
                  +
                </VideoSecondaryButton>
              </VersionRow>
            );
          })}
        </Section>
      ) : null}

      {asset.kind !== "image" && !asset.pending ? (
        <Section>
          <SectionTitle>Polish</SectionTitle>
          <VideoHint>
            Finds repeated takes in the transcript, keeps the best one of each (your pick wins),
            and splices a clean cut into a new file — the original stays untouched.
          </VideoHint>
          {!asset.hasTranscript ? (
            <InlineRow>
              <VideoSecondaryButton onClick={() => onOpenTranscript?.(asset)} type="button">
                Transcribe first
              </VideoSecondaryButton>
              <VideoHint>Take detection needs a transcript.</VideoHint>
            </InlineRow>
          ) : !takes || takes.status === "detecting" ? (
            <InlineRow>
              <VideoSecondaryButton disabled={takes?.status === "detecting"} onClick={detectTakes} type="button">
                {takes?.status === "detecting" ? "Analyzing…" : "◈ Detect takes"}
              </VideoSecondaryButton>
            </InlineRow>
          ) : takes.status === "none" ? (
            <VideoHint>No repeated takes found — this recording already reads clean.</VideoHint>
          ) : takes.status === "no-transcript" ? (
            <VideoHint>Transcript is empty — re-transcribe and try again.</VideoHint>
          ) : (
            <>
              {takes.groups.map((group, groupIndex) => {
                const selected = Number.isInteger(takeSelections[group.id])
                  ? takeSelections[group.id]
                  : group.recommendedIndex;
                return (
                  <TakeGroup key={group.id}>
                    <TakeGroupTitle>
                      Line {groupIndex + 1} · {group.takes.length} takes
                    </TakeGroupTitle>
                    {group.takes.map((take, takeIndex) => (
                      <TakeOption data-selected={selected === takeIndex ? "true" : "false"} key={take.segmentIndex}>
                        <input
                          checked={selected === takeIndex}
                          name={`${asset.path}-${group.id}`}
                          onChange={() =>
                            setTakeSelections((current) => ({ ...current, [group.id]: takeIndex }))
                          }
                          type="radio"
                        />
                        <TakeText>
                          <em>
                            Take {takeIndex + 1} · {formatTimecode(take.startMs)}–{formatTimecode(take.endMs)}
                          </em>
                          <p>{take.text}</p>
                        </TakeText>
                        {takeIndex === group.recommendedIndex ? <AiPickBadge>AI pick</AiPickBadge> : null}
                      </TakeOption>
                    ))}
                    <TakeOption data-selected={selected === -1 ? "true" : "false"}>
                      <input
                        checked={selected === -1}
                        name={`${asset.path}-${group.id}`}
                        onChange={() => setTakeSelections((current) => ({ ...current, [group.id]: -1 }))}
                        type="radio"
                      />
                      <TakeText>
                        <p>Keep every take (don't cut this line)</p>
                      </TakeText>
                    </TakeOption>
                  </TakeGroup>
                );
              })}
              {polishBusy ? (
                <div style={{ display: "grid", gap: 4 }}>
                  <VideoProgressTrack>
                    <VideoProgressFill
                      style={{ width: `${Math.min(100, Math.max(3, polishJob?.percent || 3))}%` }}
                    />
                  </VideoProgressTrack>
                  <InlineRow>
                    <VideoHint>{polishJob?.message || "Rendering polished cut…"}</VideoHint>
                    <VideoSecondaryButton
                      onClick={() => invoke("video_polish_cancel", { jobId: polishJob.jobId }).catch(() => {})}
                      type="button"
                    >
                      Cancel
                    </VideoSecondaryButton>
                  </InlineRow>
                </div>
              ) : (
                <InlineRow>
                  <VideoPaneButton
                    disabled={!polishPlan?.droppedCount}
                    onClick={startPolish}
                    type="button"
                  >
                    ✂ Create polished cut
                  </VideoPaneButton>
                  {polishPlan?.droppedCount ? (
                    <VideoHint>
                      removes {polishPlan.droppedCount} cut{polishPlan.droppedCount > 1 ? "s" : ""} · saves{" "}
                      {formatTimecode(polishPlan.droppedMs)}
                    </VideoHint>
                  ) : (
                    <VideoHint>Nothing selected to remove.</VideoHint>
                  )}
                </InlineRow>
              )}
              {polishJob?.done && polishJob.error ? (
                <VideoErrorText>{polishJob.error}</VideoErrorText>
              ) : null}
              {polishJob?.done && !polishJob.error ? (
                <InlineRow>
                  <VideoHint>✓ Polished cut ready{polishedOutput ? "" : " — refreshing library…"}</VideoHint>
                  {polishedOutput ? (
                    <>
                      <VideoSecondaryButton onClick={() => onOpenAsset?.(polishedOutput)} type="button">
                        Open
                      </VideoSecondaryButton>
                      <VideoSecondaryButton onClick={() => onAddToTimeline?.(polishedOutput)} type="button">
                        + Timeline
                      </VideoSecondaryButton>
                    </>
                  ) : null}
                </InlineRow>
              ) : null}
            </>
          )}
        </Section>
      ) : null}

      {upscalers.length ? (
        <Section style={{ borderBottom: "none" }}>
          <SectionTitle>Upscale</SectionTitle>
          <VideoHint>
            Runs through your cloud — the result lands in Versions next to the original
            {asset.kind === "video" && resClass ? ` (currently ${resClass})` : ""}.
          </VideoHint>
          {asset.kind === "video" && !videoDurationKnown ? (
            <InlineRow>
              <VideoHint>Source duration unknown — reprobe the asset before upscaling.</VideoHint>
              {onReprobe ? (
                <VideoSecondaryButton onClick={onReprobe} type="button">
                  Reprobe asset
                </VideoSecondaryButton>
              ) : null}
            </InlineRow>
          ) : null}
          {upscalers.map((model) => {
            const credits = videoDurationKnown
              ? estimateModelCredits(model, { durationSec: durationSecEstimate })
              : null;
            return (
              <UpscaleRow key={model.id}>
                <UpscaleInfo>
                  <b>{model.displayName}</b>
                  <span>
                    {model.providerLabel}
                    {credits != null
                      ? ` · ≈ ${credits.toLocaleString()} credits · validated provider outputs`
                      : ""}
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

      {drag ? createPortal(
        <DragGhost style={{ left: `${drag.x + 10}px`, top: `${drag.y + 8}px` }}>
          {drag.asset.thumbnailDataUrl ? <img alt="" src={drag.asset.thumbnailDataUrl} /> : null}
          <span>{drag.asset.name}</span>
        </DragGhost>,
        document.body,
      ) : null}
    </PanelRoot>
  );
}
