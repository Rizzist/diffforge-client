import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Contract: docs/swarm-panel-v1-contract.md. The swarm id is deterministic per
// workspace slot so the pane reattaches to its members/ledger across reloads.
export function getSwarmPaneSwarmId(workspaceId, terminalIndex) {
  const safeWorkspace = String(workspaceId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";
  const slot = Number.isInteger(terminalIndex) ? terminalIndex : 0;
  return `swarm-${safeWorkspace}-s${slot}`;
}

const SWARM_STATE_EVENT = "diffforge://swarm-state";
const SWARM_RUN_EVENT = "diffforge://swarm-run-event";
const SWARM_MAX_MEMBERS = 5;
const TAKE_FLASH_MS = 2600;

const SWARM_PROVIDERS = Object.freeze([
  { id: "codex", label: "Codex", color: "#4c8dff", glyph: "CX" },
  { id: "claude", label: "Claude Code", color: "#f0883e", glyph: "CL" },
  { id: "opencode", label: "OpenCode", color: "#3fb950", glyph: "OC" },
]);

function providerMeta(providerId) {
  return SWARM_PROVIDERS.find((provider) => provider.id === providerId) || {
    id: String(providerId || "agent"),
    label: String(providerId || "Agent"),
    color: "#8b949e",
    glyph: "AG",
  };
}

function formatSwarmTime(value) {
  const stamp = Number(value || 0);
  if (!Number.isFinite(stamp) || stamp <= 0) {
    return "";
  }
  try {
    return new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function truncateText(value, limit = 140) {
  const text = String(value || "").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function memberDisplayName(member) {
  const label = String(member?.label || "").trim();
  if (label) {
    return label;
  }
  const meta = providerMeta(member?.provider);
  const model = String(member?.model || "").trim();
  return model ? `${meta.label} · ${model}` : meta.label;
}

function describeSwarmRunEvent(event, membersById) {
  const memberName = event?.memberId
    ? memberDisplayName(membersById.get(event.memberId) || { provider: "", label: event.memberId })
    : "";
  switch (event?.kind) {
    case "run_started":
      return "Run started — building independent takes";
    case "context_pack_started":
      return `${memberName || "Scout"} is scouting the context pack`;
    case "context_pack_ready": {
      const chars = Number(event?.data?.chars ?? 0);
      const incremental = Boolean(event?.data?.incremental);
      return `Context pack ready${chars ? ` — ${Math.round(chars / 1000)}k chars` : ""}${incremental ? " (incremental update)" : ""}`;
    }
    case "member_prompted":
      return `${memberName || "Member"} received the task`;
    case "member_take":
      return `${memberName || "Member"} delivered its take`;
    case "member_reaped":
      return `${memberName || "Member"} timed out and was reaped`;
    case "member_error":
      return `${memberName || "Member"} hit an error${event?.text ? ` — ${truncateText(event.text, 90)}` : ""}`;
    case "gate_decision": {
      const takes = Number(event?.data?.takes ?? 0);
      return takes <= 1
        ? "Gate: single take — it carries the run"
        : `Gate: ${takes} takes collected — fusing`;
    }
    case "synthesis_started":
      return `${memberName || "Champion"} is synthesizing the fused answer`;
    case "run_result":
      return "Fused result ready";
    case "run_settled": {
      const status = String(event?.data?.status || "done");
      if (status === "done") return "Run settled — done";
      if (status === "cancelled") return "Run cancelled";
      return `Run settled — ${status}${event?.text ? ` (${truncateText(event.text, 90)})` : ""}`;
    }
    case "note":
      return truncateText(event?.text, 160) || "Note";
    default:
      return truncateText(event?.text, 160) || String(event?.kind || "event");
  }
}

function eventHasExpandableText(event) {
  return (event?.kind === "member_take" || event?.kind === "run_result" || event?.kind === "context_pack_ready")
    && String(event?.text || "").trim().length > 0;
}

function invokeErrorMessage(error) {
  const text = String(error?.message || error || "").trim();
  return text || "Swarm backend call failed.";
}

function isMissingCommandError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return text.includes("unknown command")
    || text.includes("command swarm_")
    || (text.includes("not found") && text.includes("swarm"));
}

/* ---------------------------------- styles --------------------------------- */

const orbFloat = keyframes`
  0%, 100% { transform: translate(-50%, -50%) translateY(0); }
  50% { transform: translate(-50%, -50%) translateY(-4px); }
`;

const orbPulse = keyframes`
  0% { box-shadow: 0 0 0 0 var(--swarm-orb-glow); }
  70% { box-shadow: 0 0 0 12px rgba(0, 0, 0, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
`;

const ringSpin = keyframes`
  to { transform: rotate(360deg); }
`;

const edgeFlow = keyframes`
  to { stroke-dashoffset: -14; }
`;

const takePop = keyframes`
  0% { transform: translate(-50%, -50%) scale(1); }
  40% { transform: translate(-50%, -50%) scale(1.22); }
  100% { transform: translate(-50%, -50%) scale(1); }
`;

const SwarmPaneRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(1200px 480px at 50% -12%, rgba(76, 141, 255, 0.08), transparent 60%),
    #0a0f1a;
  color: #e6edf3;
  font-size: 12px;

  html[data-forge-theme="light"] & {
    background:
      radial-gradient(1200px 480px at 50% -12%, rgba(37, 99, 235, 0.07), transparent 60%),
      #f6f8fa;
    color: #1f2328;
  }
`;

const SwarmErrorBanner = styled.div`
  flex: 0 0 auto;
  margin: 8px 10px 0;
  padding: 6px 10px;
  border: 1px solid rgba(248, 81, 73, 0.4);
  border-radius: 8px;
  background: rgba(248, 81, 73, 0.12);
  color: #ffa198;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 8px;

  button {
    margin-left: auto;
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 11px;
    text-decoration: underline;
  }

  html[data-forge-theme="light"] & {
    background: rgba(207, 34, 46, 0.08);
    border-color: rgba(207, 34, 46, 0.35);
    color: #cf222e;
  }
`;

const SwarmViewRail = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 0 0 auto;
  min-width: 0;
  border-bottom: 1px solid rgba(139, 148, 158, 0.16);
  background: rgba(13, 17, 23, 0.88);
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 148, 158, 0.35) transparent;

  &::-webkit-scrollbar {
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(139, 148, 158, 0.35);
    border-radius: 999px;
  }

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.88);
    border-bottom-color: rgba(31, 35, 40, 0.12);
  }
`;

const SwarmViewTab = styled.button`
  appearance: none;
  border: 1px solid rgba(139, 148, 158, 0.2);
  background: rgba(110, 118, 129, 0.1);
  color: rgba(230, 237, 243, 0.72);
  border-radius: 6px;
  height: 24px;
  padding: 0 9px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  flex: 0 0 auto;
  cursor: pointer;

  &:hover {
    border-color: rgba(76, 141, 255, 0.45);
    color: #e6edf3;
  }

  &[data-active="true"] {
    border-color: rgba(76, 141, 255, 0.62);
    background: rgba(76, 141, 255, 0.2);
    color: #dbeafe;
  }

  html[data-forge-theme="light"] & {
    background: rgba(31, 35, 40, 0.04);
    color: rgba(31, 35, 40, 0.66);

    &:hover { color: #1f2328; }

    &[data-active="true"] {
      background: rgba(9, 105, 218, 0.1);
      border-color: rgba(9, 105, 218, 0.5);
      color: #0969da;
    }
  }
`;

const SwarmViewRailSpacer = styled.span`
  flex: 1 1 auto;
`;

const SwarmViewRailStatus = styled.span`
  flex: 0 0 auto;
  font-size: 9.5px;
  font-weight: 600;
  color: rgba(139, 148, 158, 0.9);
  white-space: nowrap;
  padding-right: 2px;
`;

const SwarmConstellation = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 150px;
  overflow: hidden;
`;

const SwarmEdgeSvg = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;

  line {
    stroke: rgba(139, 148, 158, 0.22);
    stroke-width: 1.4px;
    vector-effect: non-scaling-stroke;
  }

  line[data-live="true"] {
    stroke: rgba(139, 148, 158, 0.4);
    stroke-dasharray: 5 9;
    animation: ${edgeFlow} 1.1s linear infinite;
  }

  line[data-flash="true"] {
    stroke: var(--swarm-edge-color, #4c8dff);
    stroke-width: 2px;
    stroke-dasharray: 5 9;
    animation: ${edgeFlow} 0.55s linear infinite;
  }

  html[data-forge-theme="light"] & line {
    stroke: rgba(31, 35, 40, 0.18);
  }
`;

const SwarmOrb = styled.button`
  position: absolute;
  width: 46px;
  height: 46px;
  padding: 0;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid var(--swarm-orb-color, #8b949e);
  background: rgba(13, 17, 23, 0.92);
  color: var(--swarm-orb-color, #8b949e);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 160ms ease, opacity 160ms ease, filter 160ms ease;
  animation: ${orbFloat} 5.2s ease-in-out infinite;
  animation-delay: var(--swarm-orb-delay, 0ms);

  &:hover {
    filter: brightness(1.2);
  }

  &[data-selected="true"] {
    outline: 2px solid rgba(230, 237, 243, 0.55);
    outline-offset: 2px;
  }

  &[data-status="working"] {
    --swarm-orb-glow: color-mix(in srgb, var(--swarm-orb-color) 45%, transparent);
    animation: ${orbFloat} 5.2s ease-in-out infinite, ${orbPulse} 1.6s ease-out infinite;
  }

  &[data-status="spawning"] {
    border-style: dashed;
    opacity: 0.85;
  }

  &[data-status="offline"],
  &[data-status="dead"] {
    opacity: 0.38;
    filter: grayscale(0.7);
  }

  &[data-status="error"] {
    border-color: #f85149;
    color: #f85149;
  }

  &[data-flash="true"] {
    animation: ${takePop} 0.6s ease;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    box-shadow: 0 2px 8px rgba(31, 35, 40, 0.12);
  }
`;

const SwarmOrbStatusDot = styled.span`
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid #0a0f1a;
  background: #8b949e;

  [data-status="ready"] > & { background: #3fb950; }
  [data-status="working"] > & { background: #d29922; }
  [data-status="spawning"] > & { background: #4c8dff; }
  [data-status="error"] > &, [data-status="dead"] > & { background: #f85149; }

  html[data-forge-theme="light"] & {
    border-color: #f6f8fa;
  }
`;

const SwarmOrbScore = styled.span`
  position: absolute;
  top: -7px;
  right: -9px;
  min-width: 16px;
  padding: 1px 4px;
  border-radius: 999px;
  background: rgba(110, 118, 129, 0.32);
  color: #e6edf3;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.3;

  html[data-forge-theme="light"] & {
    background: rgba(31, 35, 40, 0.1);
    color: #1f2328;
  }
`;

const SwarmOrbLabel = styled.span`
  position: absolute;
  top: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%);
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9.5px;
  font-weight: 600;
  color: rgba(230, 237, 243, 0.72);
  pointer-events: none;

  html[data-forge-theme="light"] & {
    color: rgba(31, 35, 40, 0.66);
  }
`;

const SwarmNucleus = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 116px;
  height: 116px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  text-align: center;
  background: #0d1117;
  border: 1px solid rgba(139, 148, 158, 0.28);
  padding: 10px;

  strong {
    font-size: 11px;
    line-height: 1.25;
    color: #e6edf3;
  }

  small {
    font-size: 9.5px;
    color: rgba(139, 148, 158, 0.95);
    line-height: 1.3;
  }

  &[data-run-status="done"] { border-color: rgba(63, 185, 80, 0.65); }
  &[data-run-status="failed"] { border-color: rgba(248, 81, 73, 0.65); }
  &[data-run-status="cancelled"] { border-color: rgba(210, 153, 34, 0.6); }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.16);
    strong { color: #1f2328; }
    box-shadow: 0 4px 16px rgba(31, 35, 40, 0.1);
  }
`;

const SwarmNucleusRing = styled.span`
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: #4c8dff;
  border-right-color: rgba(76, 141, 255, 0.35);
  animation: ${ringSpin} 1.3s linear infinite;
  pointer-events: none;
`;

const SwarmSetupCard = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(360px, calc(100% - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(139, 148, 158, 0.24);
  background: #0d1117;
  text-align: center;

  h3 {
    margin: 0;
    font-size: 13px;
    color: #e6edf3;
  }

  p {
    margin: 0;
    font-size: 11px;
    color: rgba(139, 148, 158, 0.95);
    line-height: 1.45;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.14);
    h3 { color: #1f2328; }
    box-shadow: 0 8px 24px rgba(31, 35, 40, 0.12);
  }
`;

const SwarmSetupChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
`;

const SwarmSetupChip = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid color-mix(in srgb, var(--swarm-chip-color) 55%, transparent);
  border-radius: 999px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--swarm-chip-color) 12%, transparent);
  color: var(--swarm-chip-color);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;

  &:hover { background: color-mix(in srgb, var(--swarm-chip-color) 22%, transparent); }

  span[data-count] {
    min-width: 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--swarm-chip-color) 30%, transparent);
    font-size: 10px;
    padding: 0 4px;
  }
`;

const SwarmPrimaryButton = styled.button`
  appearance: none;
  border: 1px solid rgba(76, 141, 255, 0.6);
  border-radius: 8px;
  background: rgba(76, 141, 255, 0.16);
  color: #79b8ff;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 140ms ease;

  &:hover:not(:disabled) { background: rgba(76, 141, 255, 0.28); }
  &:disabled { opacity: 0.45; cursor: default; }

  html[data-forge-theme="light"] & {
    background: rgba(9, 105, 218, 0.08);
    border-color: rgba(9, 105, 218, 0.45);
    color: #0969da;
  }
`;

const SwarmGhostButton = styled.button`
  appearance: none;
  border: 1px solid rgba(139, 148, 158, 0.32);
  border-radius: 8px;
  background: transparent;
  color: rgba(230, 237, 243, 0.85);
  padding: 5px 10px;
  font-size: 11px;
  cursor: pointer;

  &:hover:not(:disabled) { border-color: rgba(139, 148, 158, 0.6); }
  &:disabled { opacity: 0.45; cursor: default; }

  &[data-danger="true"] {
    color: #ffa198;
    border-color: rgba(248, 81, 73, 0.4);
  }

  html[data-forge-theme="light"] & {
    color: rgba(31, 35, 40, 0.85);
    border-color: rgba(31, 35, 40, 0.22);
    &[data-danger="true"] { color: #cf222e; border-color: rgba(207, 34, 46, 0.4); }
  }
`;

const SwarmLowerBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 148, 158, 0.35) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(139, 148, 158, 0.35);
  }
`;

const SwarmFeedRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid rgba(139, 148, 158, 0.14);
  background: #0d1117;

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.1);
  }
`;

const SwarmFeedLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  line-height: 1.45;

  time {
    flex: 0 0 auto;
    font-size: 9.5px;
    color: rgba(139, 148, 158, 0.8);
    font-variant-numeric: tabular-nums;
  }

  span[data-member-dot] {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    align-self: center;
    background: var(--swarm-edge-color, #8b949e);
  }

  button[data-expand] {
    margin-left: auto;
    appearance: none;
    border: none;
    background: transparent;
    color: #4c8dff;
    font-size: 10px;
    cursor: pointer;
    flex: 0 0 auto;
  }
`;

const SwarmFeedDetail = styled.pre`
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  color: rgba(230, 237, 243, 0.88);
  background: rgba(110, 118, 129, 0.08);
  border-radius: 6px;
  padding: 8px;

  html[data-forge-theme="light"] & {
    color: rgba(31, 35, 40, 0.9);
    background: rgba(31, 35, 40, 0.05);
  }
`;

const SwarmEmptyHint = styled.div`
  padding: 18px 8px;
  text-align: center;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.85);
  line-height: 1.5;
`;

const SwarmMemberRow = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid rgba(139, 148, 158, 0.16);
  background: #0d1117;

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.1);
  }
`;

const SwarmMemberBadge = styled.span`
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--swarm-orb-color, #8b949e);
  color: var(--swarm-orb-color, #8b949e);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
`;

const SwarmMemberMain = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;

  strong {
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    font-size: 10px;
    color: rgba(139, 148, 158, 0.95);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const SwarmMemberStatus = styled.span`
  flex: 0 0 auto;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(110, 118, 129, 0.22);
  color: rgba(230, 237, 243, 0.8);

  &[data-status="ready"] { background: rgba(63, 185, 80, 0.18); color: #56d364; }
  &[data-status="working"] { background: rgba(210, 153, 34, 0.18); color: #e3b341; }
  &[data-status="spawning"] { background: rgba(76, 141, 255, 0.18); color: #79b8ff; }
  &[data-status="error"], &[data-status="dead"] { background: rgba(248, 81, 73, 0.16); color: #ffa198; }

  html[data-forge-theme="light"] & {
    color: rgba(31, 35, 40, 0.7);
  }
`;

const SwarmAddMemberRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px dashed rgba(139, 148, 158, 0.3);

  select, input {
    appearance: none;
    border: 1px solid rgba(139, 148, 158, 0.3);
    border-radius: 6px;
    background: #0d1117;
    color: #e6edf3;
    font-size: 11px;
    padding: 4px 6px;
  }

  input { flex: 1 1 auto; min-width: 60px; }

  html[data-forge-theme="light"] & select,
  html[data-forge-theme="light"] & input {
    background: #ffffff;
    color: #1f2328;
    border-color: rgba(31, 35, 40, 0.2);
  }
`;

const SwarmRunRow = styled.button`
  appearance: none;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border-radius: 8px;
  border: 1px solid rgba(139, 148, 158, 0.16);
  background: #0d1117;
  color: inherit;
  cursor: pointer;
  font-size: 11px;

  &[data-selected="true"] { border-color: rgba(76, 141, 255, 0.6); }

  strong { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  span[data-run-status] {
    flex: 0 0 auto;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  span[data-run-status="done"] { color: #56d364; }
  span[data-run-status="running"] { color: #e3b341; }
  span[data-run-status="failed"] { color: #ffa198; }
  span[data-run-status="cancelled"] { color: rgba(139, 148, 158, 0.9); }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.1);
  }
`;

const SwarmComposerShell = styled.form`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border-top: 1px solid rgba(139, 148, 158, 0.18);
  background: #0d1117;

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-top-color: rgba(31, 35, 40, 0.12);
  }
`;

const SwarmComposerInput = styled.textarea`
  width: 100%;
  resize: none;
  min-height: 44px;
  max-height: 120px;
  border: 1px solid rgba(139, 148, 158, 0.3);
  border-radius: 8px;
  background: rgba(110, 118, 129, 0.08);
  color: inherit;
  font-size: 12px;
  line-height: 1.45;
  padding: 7px 9px;
  font-family: inherit;

  &:focus { outline: none; border-color: rgba(76, 141, 255, 0.65); }
  &:disabled { opacity: 0.55; }

  html[data-forge-theme="light"] & {
    background: rgba(31, 35, 40, 0.04);
    border-color: rgba(31, 35, 40, 0.18);
  }
`;

const SwarmComposerControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SwarmModeToggle = styled.div`
  display: inline-flex;
  border: 1px solid rgba(139, 148, 158, 0.3);
  border-radius: 7px;
  overflow: hidden;

  button {
    appearance: none;
    border: none;
    background: transparent;
    color: rgba(139, 148, 158, 0.95);
    font-size: 10.5px;
    font-weight: 600;
    padding: 4px 10px;
    cursor: pointer;
  }

  button[data-active="true"] {
    background: rgba(76, 141, 255, 0.2);
    color: #79b8ff;
  }

  html[data-forge-theme="light"] & button[data-active="true"] {
    background: rgba(9, 105, 218, 0.1);
    color: #0969da;
  }
`;

const SwarmComposerHint = styled.span`
  font-size: 10px;
  color: rgba(139, 148, 158, 0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
`;

const SwarmMemberSheet = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  bottom: 10px;
  width: min(320px, calc(100% - 20px));
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 12px;
  border: 1px solid rgba(139, 148, 158, 0.28);
  background: rgba(10, 15, 26, 0.98);
  padding: 12px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);

  header {
    display: flex;
    align-items: center;
    gap: 8px;

    strong { flex: 1 1 auto; font-size: 12.5px; }
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.16);
    box-shadow: 0 18px 44px rgba(31, 35, 40, 0.22);
  }
`;

const SwarmSheetStats = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;

  div {
    border: 1px solid rgba(139, 148, 158, 0.18);
    border-radius: 8px;
    padding: 6px 8px;
    background: #0d1117;

    small { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(139, 148, 158, 0.85); }
    strong { font-size: 13px; }
  }

  html[data-forge-theme="light"] & div {
    background: #f6f8fa;
    border-color: rgba(31, 35, 40, 0.1);
  }
`;

const SwarmSheetBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

/* --------------------------------- component -------------------------------- */

export default function SwarmWorkspacePane({
  isActive = true,
  paneId = "",
  repoPath = "",
  terminalIndex = 0,
  workspaceId = "",
}) {
  const swarmId = useMemo(
    () => getSwarmPaneSwarmId(workspaceId, terminalIndex),
    [terminalIndex, workspaceId],
  );

  const [swarm, setSwarm] = useState(null);
  const [backendMissing, setBackendMissing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("plan");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [expandedSeqs, setExpandedSeqs] = useState(() => new Set());
  const [takeFlashes, setTakeFlashes] = useState(() => new Set());
  const [setupCounts, setSetupCounts] = useState({ claude: 1, codex: 1, opencode: 0 });
  const [addProvider, setAddProvider] = useState("codex");
  const [addModel, setAddModel] = useState("");

  const swarmRef = useRef(null);
  swarmRef.current = swarm;
  const selectedRunIdRef = useRef("");
  selectedRunIdRef.current = selectedRunId;
  const mountedRef = useRef(true);
  const flashTimersRef = useRef(new Map());

  const members = useMemo(() => (Array.isArray(swarm?.members) ? swarm.members : []), [swarm?.members]);
  const membersById = useMemo(() => new Map(members.map((member) => [member.memberId, member])), [members]);
  const runs = useMemo(() => (Array.isArray(swarm?.runs) ? swarm.runs : []), [swarm?.runs]);
  const activeRunId = String(swarm?.activeRunId || "");
  const viewedRunId = selectedRunId || activeRunId || String(runs[0]?.runId || "");
  const viewedRun = runs.find((run) => run.runId === viewedRunId) || null;
  const readyMemberCount = members.filter((member) => member.status === "ready" || member.status === "working").length;
  const hasMembers = members.length > 0;

  const surfaceError = useCallback((caught) => {
    if (isMissingCommandError(caught)) {
      setBackendMissing(true);
      return;
    }
    setError(invokeErrorMessage(caught));
  }, []);

  const refreshState = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    try {
      const state = await invoke("swarm_get_state", { workspaceId, swarmId });
      if (!mountedRef.current) {
        return;
      }
      setBackendMissing(false);
      setSwarm(state || null);
    } catch (caught) {
      if (mountedRef.current) {
        surfaceError(caught);
      }
    }
  }, [surfaceError, swarmId, workspaceId]);

  const loadRunEvents = useCallback(async (runId) => {
    if (!workspaceId || !runId) {
      setEvents([]);
      return;
    }
    try {
      const result = await invoke("swarm_run_events", { workspaceId, swarmId, runId });
      if (!mountedRef.current || (selectedRunIdRef.current && selectedRunIdRef.current !== runId)) {
        return;
      }
      const list = Array.isArray(result?.events) ? result.events : [];
      setEvents(list);
    } catch (caught) {
      if (mountedRef.current) {
        surfaceError(caught);
      }
    }
  }, [surfaceError, swarmId, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flashTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      flashTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  useEffect(() => {
    if (viewedRunId) {
      loadRunEvents(viewedRunId);
    } else {
      setEvents([]);
    }
  }, [loadRunEvents, viewedRunId]);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromises = [
      listen(SWARM_STATE_EVENT, (event) => {
        const payload = event?.payload || {};
        if (cancelled || payload.swarmId !== swarmId || payload.workspaceId !== workspaceId) {
          return;
        }
        refreshState();
      }),
      listen(SWARM_RUN_EVENT, (event) => {
        const payload = event?.payload || {};
        if (cancelled || payload.swarmId !== swarmId || payload.workspaceId !== workspaceId) {
          return;
        }
        const runEvent = payload.event || null;
        if (!runEvent) {
          return;
        }
        const targetRunId = selectedRunIdRef.current
          || String(swarmRef.current?.activeRunId || "")
          || String(payload.runId || "");
        if (payload.runId === targetRunId) {
          setEvents((current) => {
            if (current.some((existing) => existing.seq === runEvent.seq)) {
              return current;
            }
            const next = [...current, runEvent];
            next.sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0));
            return next;
          });
        }
        if (runEvent.kind === "member_take" && runEvent.memberId) {
          setTakeFlashes((current) => {
            const next = new Set(current);
            next.add(runEvent.memberId);
            return next;
          });
          const existingTimer = flashTimersRef.current.get(runEvent.memberId);
          if (existingTimer) {
            window.clearTimeout(existingTimer);
          }
          flashTimersRef.current.set(runEvent.memberId, window.setTimeout(() => {
            flashTimersRef.current.delete(runEvent.memberId);
            if (mountedRef.current) {
              setTakeFlashes((current) => {
                const next = new Set(current);
                next.delete(runEvent.memberId);
                return next;
              });
            }
          }, TAKE_FLASH_MS));
        }
        if (runEvent.kind === "run_settled" || runEvent.kind === "run_started") {
          refreshState();
        }
      }),
    ];
    return () => {
      cancelled = true;
      unlistenPromises.forEach((promise) => {
        promise.then((unlisten) => unlisten()).catch(() => {});
      });
    };
  }, [refreshState, swarmId, workspaceId]);

  // Defensive slow poll while a run is live: events are the fast path, this
  // heals missed emits after sleep/reload.
  useEffect(() => {
    if (!isActive || !activeRunId || backendMissing) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      refreshState();
      if (!selectedRunIdRef.current || selectedRunIdRef.current === activeRunId) {
        loadRunEvents(activeRunId);
      }
    }, 6000);
    return () => window.clearInterval(timer);
  }, [activeRunId, backendMissing, isActive, loadRunEvents, refreshState]);

  const applyMembers = useCallback(async (memberSpecs, scoutMemberId = undefined) => {
    if (!workspaceId || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const state = await invoke("swarm_configure", {
        workspaceId,
        swarmId,
        repoPath,
        members: memberSpecs.slice(0, SWARM_MAX_MEMBERS),
        scoutMemberId: scoutMemberId === undefined
          ? String(swarmRef.current?.scoutMemberId || "")
          : String(scoutMemberId || ""),
      });
      if (mountedRef.current) {
        setSwarm(state || null);
        setBackendMissing(false);
      }
    } catch (caught) {
      if (mountedRef.current) {
        surfaceError(caught);
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }, [busy, repoPath, surfaceError, swarmId, workspaceId]);

  const handleIgniteSwarm = useCallback(() => {
    const specs = [];
    SWARM_PROVIDERS.forEach((provider) => {
      const count = Number(setupCounts[provider.id] || 0);
      for (let index = 0; index < count && specs.length < SWARM_MAX_MEMBERS; index += 1) {
        specs.push({ provider: provider.id });
      }
    });
    if (specs.length > 0) {
      applyMembers(specs);
    }
  }, [applyMembers, setupCounts]);

  const handleAddMember = useCallback(() => {
    if (members.length >= SWARM_MAX_MEMBERS) {
      return;
    }
    const specs = [
      ...members.map((member) => ({
        memberId: member.memberId,
        provider: member.provider,
        model: member.model || "",
        label: member.label || "",
      })),
      { provider: addProvider, model: addModel.trim() },
    ];
    setAddModel("");
    applyMembers(specs);
  }, [addModel, addProvider, applyMembers, members]);

  const handleRemoveMember = useCallback((memberId) => {
    const specs = members
      .filter((member) => member.memberId !== memberId)
      .map((member) => ({
        memberId: member.memberId,
        provider: member.provider,
        model: member.model || "",
        label: member.label || "",
      }));
    if (selectedMemberId === memberId) {
      setSelectedMemberId("");
    }
    const currentScout = String(swarmRef.current?.scoutMemberId || "");
    applyMembers(specs, currentScout === memberId ? "" : currentScout);
  }, [applyMembers, members, selectedMemberId]);

  const handleScoutChange = useCallback((scoutMemberId) => {
    const specs = members.map((member) => ({
      memberId: member.memberId,
      provider: member.provider,
      model: member.model || "",
      label: member.label || "",
    }));
    applyMembers(specs, scoutMemberId);
  }, [applyMembers, members]);

  const handleActivateSwarm = useCallback(async (memberId = "") => {
    if (!workspaceId || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const state = await invoke("swarm_activate", {
        workspaceId,
        swarmId,
        repoPath,
        memberId: memberId || "",
      });
      if (mountedRef.current) {
        setSwarm(state || null);
        setBackendMissing(false);
      }
    } catch (caught) {
      if (!mountedRef.current) {
        return;
      }
      if (isMissingCommandError(caught)) {
        // Older backend without swarm_activate: fall back to per-member restart
        // or an idempotent re-configure, which respawns missing sessions.
        try {
          const state = memberId
            ? await invoke("swarm_member_restart", { workspaceId, swarmId, memberId })
            : await invoke("swarm_configure", {
              workspaceId,
              swarmId,
              repoPath,
              members: (swarmRef.current?.members || []).map((member) => ({
                memberId: member.memberId,
                provider: member.provider,
                model: member.model || "",
                label: member.label || "",
              })),
              scoutMemberId: String(swarmRef.current?.scoutMemberId || ""),
            });
          if (mountedRef.current) {
            setSwarm(state || null);
          }
        } catch (fallbackCaught) {
          if (mountedRef.current) {
            surfaceError(fallbackCaught);
          }
        }
      } else {
        surfaceError(caught);
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }, [busy, repoPath, surfaceError, swarmId, workspaceId]);

  const handleRestartMember = useCallback(async (memberId) => {
    if (!workspaceId || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const state = await invoke("swarm_member_restart", { workspaceId, swarmId, memberId });
      if (mountedRef.current) {
        setSwarm(state || null);
      }
    } catch (caught) {
      if (mountedRef.current) {
        surfaceError(caught);
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }, [busy, surfaceError, swarmId, workspaceId]);

  const handleSubmitTask = useCallback(async (event) => {
    event?.preventDefault?.();
    const text = prompt.trim();
    if (!text || !workspaceId || busy || activeRunId || readyMemberCount === 0) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await invoke("swarm_submit_task", { workspaceId, swarmId, prompt: text, mode });
      if (mountedRef.current) {
        setPrompt("");
        setSelectedRunId(String(result?.runId || ""));
        setActiveTab((current) => (current === "overview" ? "overview" : "activity"));
        refreshState();
      }
    } catch (caught) {
      if (mountedRef.current) {
        surfaceError(caught);
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }, [activeRunId, busy, mode, prompt, readyMemberCount, refreshState, surfaceError, swarmId, workspaceId]);

  const handleCancelRun = useCallback(async () => {
    if (!workspaceId || !activeRunId) {
      return;
    }
    setError("");
    try {
      const state = await invoke("swarm_cancel_run", { workspaceId, swarmId, runId: activeRunId });
      if (mountedRef.current) {
        setSwarm(state || null);
      }
    } catch (caught) {
      if (mountedRef.current) {
        surfaceError(caught);
      }
    }
  }, [activeRunId, surfaceError, swarmId, workspaceId]);

  const toggleExpandedSeq = useCallback((seq) => {
    setExpandedSeqs((current) => {
      const next = new Set(current);
      if (next.has(seq)) {
        next.delete(seq);
      } else {
        next.add(seq);
      }
      return next;
    });
  }, []);

  const orbPlacements = useMemo(() => {
    const count = members.length;
    return members.map((member, index) => {
      const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
      return {
        member,
        x: 50 + 37 * Math.cos(angle),
        y: 50 + 34 * Math.sin(angle),
      };
    });
  }, [members]);

  const nucleusContent = useMemo(() => {
    if (!hasMembers) {
      return null;
    }
    if (activeRunId) {
      const takeCount = events.filter((event) => event.kind === "member_take").length;
      const synthesizing = events.some((event) => event.kind === "synthesis_started");
      const scouting = events.some((event) => event.kind === "context_pack_started")
        && !events.some((event) => event.kind === "context_pack_ready")
        && !synthesizing
        && takeCount === 0
        && !events.some((event) => event.kind === "member_prompted");
      return {
        running: true,
        status: "running",
        title: synthesizing ? "Synthesizing" : scouting ? "Scouting context" : "Collecting takes",
        detail: synthesizing
          ? "fusing member takes"
          : scouting
            ? "one scout, shared context"
            : `${takeCount}/${members.length} takes in`,
      };
    }
    const lastRun = runs[0] || null;
    if (lastRun && lastRun.status !== "running") {
      return {
        running: false,
        status: lastRun.status,
        title: lastRun.status === "done"
          ? "Last run complete"
          : lastRun.status === "cancelled"
            ? "Run cancelled"
            : "Run failed",
        detail: truncateText(lastRun.resultSummary || lastRun.prompt, 52) || "—",
      };
    }
    if (readyMemberCount === 0) {
      return {
        running: false,
        status: "",
        title: "Swarm parked",
        detail: "activate members to start",
      };
    }
    return {
      running: false,
      status: "",
      title: "Swarm ready",
      detail: `${readyMemberCount}/${members.length} members ready`,
    };
  }, [activeRunId, events, hasMembers, members.length, readyMemberCount, runs]);

  const selectedMember = selectedMemberId ? membersById.get(selectedMemberId) || null : null;
  const selectedMemberTakes = useMemo(() => (
    selectedMember
      ? events.filter((event) => event.kind === "member_take" && event.memberId === selectedMember.memberId)
      : []
  ), [events, selectedMember]);

  const parkedMemberCount = members.filter((member) => (
    member.status === "offline" || member.status === "dead" || member.status === "error"
  )).length;
  const swarmParked = hasMembers && parkedMemberCount > 0 && !activeRunId;

  const composerDisabled = backendMissing || !hasMembers || Boolean(activeRunId) || busy;
  const composerHint = backendMissing
    ? "Swarm backend unavailable in this build"
    : !hasMembers
      ? "Add members to start"
      : activeRunId
        ? "A run is in flight"
        : readyMemberCount === 0
          ? "Waiting for members to become ready"
          : `Fans out to ${readyMemberCount} member${readyMemberCount === 1 ? "" : "s"}, then fuses`;

  const railStatusText = activeRunId
    ? "run live"
    : hasMembers
      ? `${readyMemberCount}/${members.length} ready`
      : "no members";

  return (
    <SwarmPaneRoot data-swarm-pane-id={paneId}>
      <SwarmViewRail aria-label="Swarm view selector">
        {[
          { id: "overview", label: "Overview" },
          { id: "activity", label: "Activity" },
          { id: "members", label: hasMembers ? `Members (${members.length})` : "Members" },
          { id: "runs", label: runs.length ? `Runs (${runs.length})` : "Runs" },
        ].map((tab) => (
          <SwarmViewTab
            aria-pressed={activeTab === tab.id}
            data-active={activeTab === tab.id ? "true" : undefined}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            type="button"
          >
            {tab.label}
          </SwarmViewTab>
        ))}
        <SwarmViewRailSpacer aria-hidden="true" />
        <SwarmViewRailStatus>{railStatusText}</SwarmViewRailStatus>
      </SwarmViewRail>
      {error ? (
        <SwarmErrorBanner role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} type="button">Dismiss</button>
        </SwarmErrorBanner>
      ) : null}
      {backendMissing ? (
        <SwarmErrorBanner as="div" role="status" style={{ borderColor: "rgba(210,153,34,0.45)", background: "rgba(210,153,34,0.1)", color: "#e3b341" }}>
          <span>The swarm runtime commands are not available in this build yet.</span>
          <button onClick={() => { setBackendMissing(false); refreshState(); }} type="button">Retry</button>
        </SwarmErrorBanner>
      ) : null}

      {activeTab === "overview" ? (
      <SwarmConstellation>
        {hasMembers ? (
          <>
            <SwarmEdgeSvg preserveAspectRatio="none" viewBox="0 0 100 100">
              {orbPlacements.map(({ member, x, y }) => (
                <line
                  data-flash={takeFlashes.has(member.memberId) ? "true" : undefined}
                  data-live={member.status === "working" ? "true" : undefined}
                  key={member.memberId}
                  style={{ "--swarm-edge-color": providerMeta(member.provider).color }}
                  x1={x}
                  x2={50}
                  y1={y}
                  y2={50}
                />
              ))}
            </SwarmEdgeSvg>
            {nucleusContent ? (
              <SwarmNucleus data-run-status={nucleusContent.status || undefined}>
                {nucleusContent.running ? <SwarmNucleusRing aria-hidden="true" /> : null}
                <strong>{nucleusContent.title}</strong>
                <small>{nucleusContent.detail}</small>
              </SwarmNucleus>
            ) : null}
            {orbPlacements.map(({ member, x, y }, index) => {
              const meta = providerMeta(member.provider);
              return (
                <SwarmOrb
                  aria-label={`Inspect ${memberDisplayName(member)}`}
                  data-flash={takeFlashes.has(member.memberId) ? "true" : undefined}
                  data-selected={selectedMemberId === member.memberId ? "true" : undefined}
                  data-status={member.status || "offline"}
                  key={member.memberId}
                  onClick={() => setSelectedMemberId((current) => (
                    current === member.memberId ? "" : member.memberId
                  ))}
                  style={{
                    "--swarm-orb-color": meta.color,
                    "--swarm-orb-delay": `${index * 420}ms`,
                    left: `${x}%`,
                    top: `${y}%`,
                  }}
                  title={`${memberDisplayName(member)} — ${member.status || "offline"}`}
                  type="button"
                >
                  {meta.glyph}
                  <SwarmOrbStatusDot aria-hidden="true" />
                  {Number(member.score || 0) !== 0 ? (
                    <SwarmOrbScore aria-hidden="true">{member.score > 0 ? `+${member.score}` : member.score}</SwarmOrbScore>
                  ) : null}
                  <SwarmOrbLabel aria-hidden="true">{memberDisplayName(member)}</SwarmOrbLabel>
                </SwarmOrb>
              );
            })}
          </>
        ) : (
          <SwarmSetupCard>
            <h3>Assemble your swarm</h3>
            <p>
              Pick 2–{SWARM_MAX_MEMBERS} agents from different model families. They take every task
              independently, then fuse the strongest answer into one result.
            </p>
            <SwarmSetupChips>
              {SWARM_PROVIDERS.map((provider) => {
                const count = Number(setupCounts[provider.id] || 0);
                const total = SWARM_PROVIDERS.reduce((sum, entry) => sum + Number(setupCounts[entry.id] || 0), 0);
                return (
                  <SwarmSetupChip
                    key={provider.id}
                    onClick={() => setSetupCounts((current) => {
                      const currentCount = Number(current[provider.id] || 0);
                      const nextCount = currentCount >= 2 || (total >= SWARM_MAX_MEMBERS && currentCount === 0)
                        ? 0
                        : total >= SWARM_MAX_MEMBERS
                          ? currentCount
                          : currentCount + 1;
                      return { ...current, [provider.id]: nextCount };
                    })}
                    style={{ "--swarm-chip-color": provider.color }}
                    type="button"
                  >
                    {provider.label}
                    <span data-count="true">{count}</span>
                  </SwarmSetupChip>
                );
              })}
            </SwarmSetupChips>
            <SwarmPrimaryButton
              disabled={busy || backendMissing
                || SWARM_PROVIDERS.reduce((sum, entry) => sum + Number(setupCounts[entry.id] || 0), 0) === 0}
              onClick={handleIgniteSwarm}
              type="button"
            >
              {busy ? "Spawning members…" : "Ignite swarm"}
            </SwarmPrimaryButton>
          </SwarmSetupCard>
        )}
        {swarmParked ? (
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 14,
              transform: "translateX(-50%)",
              zIndex: 4,
            }}
          >
            <SwarmPrimaryButton
              disabled={busy || backendMissing}
              onClick={() => handleActivateSwarm()}
              title="Spawn every configured member that is not running"
              type="button"
            >
              {busy
                ? "Activating…"
                : parkedMemberCount === members.length
                  ? "Activate swarm"
                  : `Activate swarm · ${parkedMemberCount} offline`}
            </SwarmPrimaryButton>
          </div>
        ) : null}
      </SwarmConstellation>
      ) : null}

      {selectedMember ? (
          <SwarmMemberSheet>
            <header>
              <SwarmMemberBadge style={{ "--swarm-orb-color": providerMeta(selectedMember.provider).color }}>
                {providerMeta(selectedMember.provider).glyph}
              </SwarmMemberBadge>
              <strong>{memberDisplayName(selectedMember)}</strong>
              <SwarmGhostButton onClick={() => setSelectedMemberId("")} type="button">Close</SwarmGhostButton>
            </header>
            <SwarmSheetStats>
              <div>
                <small>Status</small>
                <strong>{selectedMember.status || "offline"}</strong>
              </div>
              <div>
                <small>Score</small>
                <strong>{Number(selectedMember.score || 0)}</strong>
              </div>
              <div>
                <small>Takes</small>
                <strong>{Number(selectedMember.stats?.takesDelivered || 0)}</strong>
              </div>
              <div>
                <small>Champion runs</small>
                <strong>{Number(selectedMember.stats?.championRuns || 0)}</strong>
              </div>
              <div>
                <small>Scout runs</small>
                <strong>{Number(selectedMember.stats?.scoutRuns || 0)}</strong>
              </div>
              <div>
                <small>Role</small>
                <strong>
                  {String(swarm?.scoutMemberId || "") === selectedMember.memberId ? "Scout" : "Member"}
                </strong>
              </div>
            </SwarmSheetStats>
            <SwarmComposerControls>
              {selectedMember.status === "offline" || selectedMember.status === "dead" || selectedMember.status === "error" ? (
                <SwarmPrimaryButton disabled={busy} onClick={() => handleActivateSwarm(selectedMember.memberId)} type="button">
                  Start
                </SwarmPrimaryButton>
              ) : (
                <SwarmGhostButton disabled={busy} onClick={() => handleRestartMember(selectedMember.memberId)} type="button">
                  Restart
                </SwarmGhostButton>
              )}
              <SwarmGhostButton data-danger="true" disabled={busy} onClick={() => handleRemoveMember(selectedMember.memberId)} type="button">
                Remove
              </SwarmGhostButton>
            </SwarmComposerControls>
            <SwarmSheetBody>
              {selectedMemberTakes.length === 0 ? (
                <SwarmEmptyHint>No takes from this member in the viewed run yet.</SwarmEmptyHint>
              ) : selectedMemberTakes.map((event) => (
                <SwarmFeedDetail key={event.seq}>{event.text}</SwarmFeedDetail>
              ))}
            </SwarmSheetBody>
          </SwarmMemberSheet>
        ) : null}

      {activeTab !== "overview" ? (
        <SwarmLowerBody>
          {activeTab === "activity" ? (
            events.length === 0 ? (
              <SwarmEmptyHint>
                {viewedRun
                  ? "No ledger events for this run yet."
                  : "Submit a task below — every member takes it independently, then the swarm fuses one answer. The full run ledger streams here."}
              </SwarmEmptyHint>
            ) : (
              events.map((event) => {
                const meta = event.memberId ? providerMeta(membersById.get(event.memberId)?.provider) : null;
                const expandable = eventHasExpandableText(event);
                const expanded = expandedSeqs.has(event.seq);
                return (
                  <SwarmFeedRow key={`${event.runId}-${event.seq}`}>
                    <SwarmFeedLine style={meta ? { "--swarm-edge-color": meta.color } : undefined}>
                      <time>{formatSwarmTime(event.at)}</time>
                      {meta ? <span data-member-dot="true" /> : null}
                      <span>{describeSwarmRunEvent(event, membersById)}</span>
                      {expandable ? (
                        <button data-expand="true" onClick={() => toggleExpandedSeq(event.seq)} type="button">
                          {expanded ? "Hide" : "View"}
                        </button>
                      ) : null}
                    </SwarmFeedLine>
                    {expandable && expanded ? (
                      <SwarmFeedDetail>{event.text}</SwarmFeedDetail>
                    ) : null}
                  </SwarmFeedRow>
                );
              })
            )
          ) : null}

          {activeTab === "members" ? (
            <>
              {hasMembers ? (
                <SwarmAddMemberRow as="div" title="The scout builds the shared context pack before fan-out — factual repo brief only, so member takes stay independent.">
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(139,148,158,0.95)", flex: "0 0 auto" }}>
                    Scout
                  </span>
                  <select
                    disabled={busy || backendMissing}
                    onChange={(event) => handleScoutChange(event.target.value)}
                    style={{ flex: "1 1 auto" }}
                    value={String(swarm?.scoutMemberId || "")}
                  >
                    <option value="">Auto — cheapest ready member</option>
                    {members.map((member) => (
                      <option key={member.memberId} value={member.memberId}>
                        {memberDisplayName(member)}
                      </option>
                    ))}
                  </select>
                </SwarmAddMemberRow>
              ) : null}
              {members.map((member) => {
                const meta = providerMeta(member.provider);
                return (
                  <SwarmMemberRow key={member.memberId}>
                    <SwarmMemberBadge style={{ "--swarm-orb-color": meta.color }}>{meta.glyph}</SwarmMemberBadge>
                    <SwarmMemberMain>
                      <strong>{memberDisplayName(member)}</strong>
                      <small>
                        score {Number(member.score || 0)}
                        {" · "}takes {Number(member.stats?.takesDelivered || 0)}
                        {" · "}champion {Number(member.stats?.championRuns || 0)}
                        {Number(member.stats?.scoutRuns || 0) > 0 ? ` · scouted ${member.stats.scoutRuns}` : ""}
                        {Number(member.stats?.reaps || 0) > 0 ? ` · reaps ${member.stats.reaps}` : ""}
                        {String(swarm?.scoutMemberId || "") === member.memberId ? " · pinned scout" : ""}
                      </small>
                    </SwarmMemberMain>
                    <SwarmMemberStatus data-status={member.status || "offline"}>
                      {member.status || "offline"}
                    </SwarmMemberStatus>
                    {member.status === "offline" || member.status === "dead" || member.status === "error" ? (
                      <SwarmGhostButton
                        disabled={busy}
                        onClick={() => handleActivateSwarm(member.memberId)}
                        style={{ borderColor: "rgba(76, 141, 255, 0.5)", color: "#79b8ff" }}
                        type="button"
                      >
                        Start
                      </SwarmGhostButton>
                    ) : (
                      <SwarmGhostButton disabled={busy} onClick={() => handleRestartMember(member.memberId)} type="button">
                        Restart
                      </SwarmGhostButton>
                    )}
                    <SwarmGhostButton data-danger="true" disabled={busy} onClick={() => handleRemoveMember(member.memberId)} type="button">
                      Remove
                    </SwarmGhostButton>
                  </SwarmMemberRow>
                );
              })}
              {members.length < SWARM_MAX_MEMBERS ? (
                <SwarmAddMemberRow>
                  <select onChange={(event) => setAddProvider(event.target.value)} value={addProvider}>
                    {SWARM_PROVIDERS.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                  </select>
                  <input
                    onChange={(event) => setAddModel(event.target.value)}
                    placeholder="model (optional)"
                    value={addModel}
                  />
                  <SwarmGhostButton disabled={busy || backendMissing} onClick={handleAddMember} type="button">
                    Add member
                  </SwarmGhostButton>
                </SwarmAddMemberRow>
              ) : null}
              {!hasMembers ? (
                <SwarmEmptyHint>No members yet — use the setup card above or add one here.</SwarmEmptyHint>
              ) : null}
            </>
          ) : null}

          {activeTab === "runs" ? (
            runs.length === 0 ? (
              <SwarmEmptyHint>No runs yet.</SwarmEmptyHint>
            ) : (
              runs.map((run) => (
                <SwarmRunRow
                  data-selected={run.runId === viewedRunId ? "true" : undefined}
                  key={run.runId}
                  onClick={() => {
                    setSelectedRunId(run.runId);
                    setActiveTab("activity");
                  }}
                  type="button"
                >
                  <strong title={run.prompt || ""}>{truncateText(run.prompt, 90) || "Untitled run"}</strong>
                  <span data-run-status={run.status}>{run.status}</span>
                </SwarmRunRow>
              ))
            )
          ) : null}
        </SwarmLowerBody>
      ) : null}

      <SwarmComposerShell onSubmit={handleSubmitTask}>
          <SwarmComposerInput
            disabled={composerDisabled}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmitTask();
              }
            }}
            placeholder={hasMembers ? "Give the swarm a task…" : "Assemble the swarm first"}
            rows={2}
            value={prompt}
          />
          <SwarmComposerControls>
            <SwarmModeToggle role="group" aria-label="Swarm run mode">
              <button data-active={mode === "plan" ? "true" : undefined} onClick={() => setMode("plan")} type="button">
                Plan
              </button>
              <button data-active={mode === "implement" ? "true" : undefined} onClick={() => setMode("implement")} type="button">
                Implement
              </button>
            </SwarmModeToggle>
            <SwarmComposerHint>{composerHint}</SwarmComposerHint>
            {activeRunId ? (
              <SwarmGhostButton data-danger="true" onClick={handleCancelRun} type="button">
                Cancel run
              </SwarmGhostButton>
            ) : null}
            <SwarmPrimaryButton
              disabled={composerDisabled || !prompt.trim() || readyMemberCount === 0}
              type="submit"
            >
              {activeRunId ? "Running…" : "Send to swarm"}
            </SwarmPrimaryButton>
          </SwarmComposerControls>
        </SwarmComposerShell>
    </SwarmPaneRoot>
  );
}
