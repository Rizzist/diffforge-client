import React from "react";
import styled from "styled-components";
import { AutoAwesome } from "@styled-icons/material-rounded/AutoAwesome";
import { ContentCut } from "@styled-icons/material-rounded/ContentCut";
import { Explore } from "@styled-icons/material-rounded/Explore";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { PermMedia } from "@styled-icons/material-rounded/PermMedia";
import { Subtitles } from "@styled-icons/material-rounded/Subtitles";
import { Visibility } from "@styled-icons/material-rounded/Visibility";
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
export default function AgentActivityPanel({ entries = [], onNavigate }) {
  if (!entries.length) {
    return (
      <PanelRoot data-video-agent-activity="true">
        <VideoHint>
          Nothing yet — when a terminal agent touches this project (context, edits, transcription,
          generation…), each call shows up here live.
        </VideoHint>
      </PanelRoot>
    );
  }
  return (
    <PanelRoot data-video-agent-activity="true">
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
