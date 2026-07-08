import React from "react";
import styled, { keyframes } from "styled-components";
import { AutoAwesome } from "@styled-icons/material-rounded/AutoAwesome";
import { ContentCut } from "@styled-icons/material-rounded/ContentCut";
import { Explore } from "@styled-icons/material-rounded/Explore";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { PermMedia } from "@styled-icons/material-rounded/PermMedia";
import { Subtitles } from "@styled-icons/material-rounded/Subtitles";
import { Visibility } from "@styled-icons/material-rounded/Visibility";
import { normalizePanelAgentPromptActivityItems } from "../terminals/panelAgentPromptBridge.js";
import { VideoHint } from "./videoStyles.js";

const PanelRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 10px;
  gap: 6px;
`;

const Row = styled.button`
  appearance: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(4, 8, 14, 0.6);
  cursor: pointer;
  text-align: left;
  width: 100%;

  &:hover {
    border-color: rgba(16, 185, 129, 0.45);
  }
`;

const ToolIcon = styled.span`
  position: relative;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) => props.$bg || "rgba(37, 99, 235, 0.16)"};
  color: ${(props) => props.$fg || "#93c5fd"};

  svg {
    width: 16px;
    height: 16px;
  }
`;

// Status ring around the icon: spinning while pending, solid green when
// done, red when errored.
const StatusRing = styled.span`
  position: absolute;
  inset: -3px;
  border-radius: 10px;
  pointer-events: none;

  &[data-status="pending"] {
    border: 2px solid rgba(147, 197, 253, 0.2);
    border-top-color: #93c5fd;
    animation: agent-activity-spin 1s linear infinite;
  }

  &[data-status="done"] {
    border: 2px solid rgba(52, 211, 153, 0.55);
  }

  &[data-status="error"] {
    border: 2px solid rgba(248, 113, 113, 0.65);
  }

  @keyframes agent-activity-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const RowInfo = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;

  b {
    font-size: 10.5px;
    font-weight: 800;
    color: rgba(226, 232, 240, 0.94);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  i {
    font-style: normal;
    font-size: 9px;
    font-weight: 600;
    color: #7d8ca3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const StatusGlyph = styled.span`
  flex: none;
  font-size: 12px;
  font-weight: 800;
  color: ${(props) => (props.$status === "error" ? "#fca5a5" : props.$status === "done" ? "#6ee7b7" : "#93c5fd")};
`;

const TimeStamp = styled.span`
  flex: none;
  font-size: 8.5px;
  font-weight: 650;
  color: rgba(125, 140, 163, 0.8);
`;

const promptSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const PROMPT_STATUS_LABELS = {
  completed: "completed",
  failed: "failed",
  interrupted: "interrupted",
  queued: "queued",
  running: "running",
};

// Sent/pending prompt queue — the same lifecycle the web panel shows as
// top-right pills, laid out as full-width rows so it doesn't cover controls.
const PromptSection = styled.div`
  display: grid;
  gap: 4px;
`;

const PromptSectionTitle = styled.div`
  padding: 1px 2px 0;
  font-size: 9px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(125, 140, 163, 0.9);
`;

const PromptRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 5px 8px 5px 7px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(2, 6, 12, 0.72);

  &[data-status="completed"] {
    border-color: rgba(74, 222, 128, 0.28);
    background: rgba(20, 83, 45, 0.3);
  }

  &[data-status="failed"] {
    border-color: rgba(248, 113, 113, 0.36);
    background: rgba(127, 29, 29, 0.36);
  }

  &[data-status="interrupted"] {
    border-color: rgba(251, 191, 36, 0.34);
    background: rgba(120, 53, 15, 0.32);
  }
`;

const PromptDot = styled.span`
  position: relative;
  flex: none;
  width: 11px;
  height: 11px;
  border: 2px solid color-mix(in srgb, var(--prompt-activity-color) 24%, rgba(148, 163, 184, 0.42));
  border-top-color: var(--prompt-activity-color);
  border-radius: 999px;
  animation: ${promptSpin} 1350ms linear infinite;

  &[data-status="running"] {
    border-color: color-mix(in srgb, var(--prompt-activity-color) 30%, rgba(148, 163, 184, 0.34));
    border-top-color: var(--prompt-activity-color);
    animation-duration: 760ms;
  }

  &[data-status="completed"] {
    display: grid;
    place-items: center;
    border-color: rgba(134, 239, 172, 0.92);
    background: #22c55e;
    animation: none;
  }

  &[data-status="completed"]::after {
    content: "";
    display: block;
    width: 3px;
    height: 6px;
    border: solid rgba(4, 20, 10, 0.92);
    border-width: 0 1.5px 1.5px 0;
    transform: translateY(-0.5px) rotate(45deg);
  }

  &[data-status="failed"] {
    border-color: rgba(252, 165, 165, 0.92);
    border-top-color: rgba(252, 165, 165, 0.92);
    background: rgba(239, 68, 68, 0.86);
    animation: none;
  }

  &[data-status="failed"]::before,
  &[data-status="failed"]::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 4px;
    width: 5px;
    height: 1.5px;
    border-radius: 999px;
    background: rgba(69, 10, 10, 0.94);
  }

  &[data-status="failed"]::before {
    transform: rotate(45deg);
  }

  &[data-status="failed"]::after {
    transform: rotate(-45deg);
  }

  &[data-status="interrupted"] {
    border-color: rgba(253, 230, 138, 0.9);
    border-top-color: rgba(253, 230, 138, 0.9);
    background: rgba(245, 158, 11, 0.78);
    animation: none;
  }
`;

const PromptInfo = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;

  b {
    font-size: 10.5px;
    font-weight: 800;
    color: rgba(226, 232, 240, 0.94);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  i {
    font-style: normal;
    font-size: 9px;
    font-weight: 600;
    color: #7d8ca3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const PromptStatusWord = styled.span`
  flex: none;
  font-size: 9.5px;
  font-weight: 820;
  line-height: 1;
  text-transform: lowercase;
  color: rgba(148, 163, 184, 0.92);

  [data-status="completed"] & {
    color: rgba(187, 247, 208, 0.92);
  }

  [data-status="failed"] & {
    color: rgba(254, 202, 202, 0.92);
  }

  [data-status="interrupted"] & {
    color: rgba(253, 230, 138, 0.92);
  }
`;

const SectionDivider = styled.div`
  height: 1px;
  margin: 2px 0;
  background: rgba(148, 163, 184, 0.12);
`;

const TOOL_META = {
  video_context: { icon: Explore, label: "Context", bg: "rgba(37, 99, 235, 0.16)", fg: "#93c5fd" },
  video_edit: { icon: ContentCut, label: "Edit", bg: "rgba(16, 185, 129, 0.16)", fg: "#6ee7b7" },
  video_transcribe: { icon: Subtitles, label: "Transcribe", bg: "rgba(168, 85, 247, 0.18)", fg: "#d8b4fe" },
  video_look: { icon: Visibility, label: "Look", bg: "rgba(251, 191, 36, 0.16)", fg: "#fcd34d" },
  video_media: { icon: PermMedia, label: "Media", bg: "rgba(148, 163, 184, 0.16)", fg: "#cbd5f5" },
  video_generate: { icon: AutoAwesome, label: "Generate", bg: "rgba(236, 72, 153, 0.16)", fg: "#f9a8d4" },
  video_export: { icon: FileDownload, label: "Export", bg: "rgba(56, 189, 248, 0.16)", fg: "#7dd3fc" },
};

function entryStatus(entry) {
  if (entry.phase === "error") {
    return "error";
  }
  if (entry.phase === "done") {
    return "done";
  }
  return "pending";
}

// One terse sub-line per entry — icons carry the meaning, this is a whisper.
function entryHint(entry) {
  const detail = entry.detail || {};
  const result = entry.result || {};
  switch (entry.tool) {
    case "video_edit": {
      const kinds = Array.isArray(detail.opKinds) ? detail.opKinds.slice(0, 4).join(" · ") : "";
      return String(result.summary || kinds || "");
    }
    case "video_transcribe": {
      const paths = Array.isArray(detail.paths) ? detail.paths : [];
      const names = paths.map((path) => String(path).split("/").pop()).slice(0, 2).join(", ");
      return names || (detail.scope ? `scope: ${detail.scope}` : "");
    }
    case "video_look": {
      const frames = result.frames;
      return frames != null ? `${frames} frame${frames === 1 ? "" : "s"}` : "";
    }
    case "video_media": {
      const action = String(detail.action || "list");
      const query = detail.query ? ` “${String(detail.query).slice(0, 24)}”` : "";
      return `${action}${query}`;
    }
    case "video_generate": {
      const action = String(detail.action || "");
      const model = detail.model ? ` · ${detail.model}` : "";
      return `${action}${model}`;
    }
    case "video_export":
      return String(result.outputPath || detail.action || "");
    default: {
      const include = Array.isArray(detail.include) ? detail.include.join(",") : "";
      return include;
    }
  }
}

function timeAgo(atMs) {
  const delta = Math.max(0, Date.now() - (Number(atMs) || 0));
  if (delta < 60_000) {
    return `${Math.max(1, Math.round(delta / 1000))}s`;
  }
  if (delta < 3_600_000) {
    return `${Math.round(delta / 60_000)}m`;
  }
  return `${Math.round(delta / 3_600_000)}h`;
}

// Icon-first feed of everything agents did via the video MCP tools.
// Clicking an entry navigates to what it touched (transcript, clips, panel…).
// promptItems mirror the web panel's sent/pending prompt pills: one row per
// queued todo, newest first; completed ones are removed upstream after a beat.
export default function AgentActivityPanel({ entries = [], onNavigate, promptItems = [] }) {
  const queueItems = normalizePanelAgentPromptActivityItems(promptItems).reverse();
  const promptQueue = queueItems.length ? (
    <PromptSection aria-label="Sent agent prompts">
      <PromptSectionTitle>Sent prompts</PromptSectionTitle>
      {queueItems.map((item) => {
        const status = item.status || "queued";
        const label = String(item.text || item.title || item.label || "Prompt").replace(/\s+/g, " ").trim();
        const target = item.short || item.label || "Agent";
        const statusWord = PROMPT_STATUS_LABELS[status] || PROMPT_STATUS_LABELS.queued;
        return (
          <PromptRow
            data-status={status}
            key={item.itemId}
            style={{ "--prompt-activity-color": item.color || "#8bb8ff" }}
            title={`${label} — ${target} · ${statusWord}${item.error ? ` — ${item.error}` : ""}`}
          >
            <PromptDot aria-hidden="true" data-status={status} />
            <PromptInfo>
              <b>{label || "Prompt"}</b>
              <i>{status === "failed" && item.error ? item.error : target}</i>
            </PromptInfo>
            <PromptStatusWord>{statusWord}</PromptStatusWord>
            <TimeStamp>{timeAgo(item.submittedAtMs)}</TimeStamp>
          </PromptRow>
        );
      })}
    </PromptSection>
  ) : null;
  if (!entries.length) {
    return (
      <PanelRoot data-video-agent-activity="true">
        {promptQueue}
        {promptQueue ? <SectionDivider aria-hidden="true" /> : null}
        <VideoHint>
          Nothing yet — when a terminal agent touches this project (context, edits, transcription,
          generation…), each call shows up here live.
        </VideoHint>
      </PanelRoot>
    );
  }
  return (
    <PanelRoot data-video-agent-activity="true">
      {promptQueue}
      {promptQueue ? <SectionDivider aria-hidden="true" /> : null}
      {entries.map((entry) => {
        const meta = TOOL_META[entry.tool] || TOOL_META.video_context;
        const Icon = meta.icon;
        const status = entryStatus(entry);
        const hint = status === "error" ? String(entry.error || "failed") : entryHint(entry);
        return (
          <Row
            key={entry.id}
            onClick={() => onNavigate?.(entry)}
            title={status === "error" ? String(entry.error || "") : `Jump to ${meta.label.toLowerCase()}`}
            type="button"
          >
            <ToolIcon $bg={meta.bg} $fg={meta.fg}>
              <Icon aria-hidden="true" />
              <StatusRing data-status={status} />
            </ToolIcon>
            <RowInfo>
              <b>{meta.label}</b>
              {hint ? <i>{hint}</i> : null}
            </RowInfo>
            <StatusGlyph $status={status}>
              {status === "pending" ? "…" : status === "done" ? "✓" : "⚠"}
            </StatusGlyph>
            <TimeStamp>{timeAgo(entry.atMs)}</TimeStamp>
          </Row>
        );
      })}
    </PanelRoot>
  );
}
