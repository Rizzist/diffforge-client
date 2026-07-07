import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled, { keyframes } from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Add } from "@styled-icons/material-rounded/Add";
import { ArrowUpward } from "@styled-icons/material-rounded/ArrowUpward";
import { CenterFocusStrong } from "@styled-icons/material-rounded/CenterFocusStrong";
import { Remove } from "@styled-icons/material-rounded/Remove";
import { Stop } from "@styled-icons/material-rounded/Stop";
import { Tune } from "@styled-icons/material-rounded/Tune";
import {
  WorkspaceCreateAgentClaudeIcon,
  WorkspaceCreateAgentCodexIcon,
  WorkspaceCreateAgentOpenCodeIcon,
  WorkspaceCreateAgentTerminalIcon,
} from "../app/appStyles.js";
import {
  BUILTIN_AGENT_LAUNCH_DEFAULTS,
  getAgentLaunchModelOption,
  getAgentLaunchModelOptions,
} from "../agents/agentLaunchDefaults.js";

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
const SWARM_STAGE_MIN_ZOOM = 0.55;
const SWARM_STAGE_MAX_ZOOM = 2.2;
const SWARM_STAGE_PAN_LIMIT = 280;

function clampSwarmStageView(view) {
  const zoom = Math.min(SWARM_STAGE_MAX_ZOOM, Math.max(SWARM_STAGE_MIN_ZOOM, Number(view.zoom) || 1));
  const limit = SWARM_STAGE_PAN_LIMIT * zoom;
  return {
    x: Math.min(limit, Math.max(-limit, Number(view.x) || 0)),
    y: Math.min(limit, Math.max(-limit, Number(view.y) || 0)),
    zoom,
  };
}

function SwarmHarnessIcon({ provider }) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "codex") {
    return <WorkspaceCreateAgentCodexIcon aria-hidden="true" />;
  }
  if (normalized === "claude") {
    return <WorkspaceCreateAgentClaudeIcon aria-hidden="true" />;
  }
  if (normalized === "opencode") {
    return (
      <WorkspaceCreateAgentOpenCodeIcon
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 30"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M18 24H6V12H18V24Z" fill="currentColor" opacity="0.72" />
        <path d="M18 6H6V24H18V6ZM24 30H0V0H24V30Z" fill="currentColor" />
      </WorkspaceCreateAgentOpenCodeIcon>
    );
  }
  return <WorkspaceCreateAgentTerminalIcon aria-hidden="true" />;
}

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
  return providerMeta(member?.provider).label;
}

// Resolved model shown in the UI: the member's explicit model, else the app's
// launch-default model for that harness (what the CLI actually starts with).
function memberModelText(member) {
  const provider = String(member?.provider || "").trim().toLowerCase();
  const modelId = String(member?.model || "").trim()
    || String(BUILTIN_AGENT_LAUNCH_DEFAULTS[provider]?.model || "").trim();
  if (!modelId) {
    return "";
  }
  const option = getAgentLaunchModelOption(provider, modelId);
  return String(option?.label || modelId);
}

// Model catalog per harness (contract §v1.4): claude/codex use the static app
// launch catalog; opencode prefers the locally enumerated `opencode models`
// list and falls back to the static entries when the CLI list is unavailable.
function swarmModelOptionsForProvider(provider, opencodeModels) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "opencode"
    && opencodeModels?.status === "ready"
    && Array.isArray(opencodeModels.models)
    && opencodeModels.models.length > 0) {
    return opencodeModels.models.map((id) => ({ id: String(id), label: String(id) }));
  }
  return getAgentLaunchModelOptions(normalized).map((option) => ({
    id: String(option.id),
    label: String(option.label || option.id),
  }));
}

// Searchable model picker popover for one member (or the add-member row).
// Enter picks the top match, or applies the typed text as a custom model id
// when nothing matches. Empty model = harness default. Rendered through a
// body portal with fixed positioning so the Members-tab scroll container and
// narrow pane edges can't clip it; flips above the trigger when the space
// below is too short.
function SwarmModelMenuPanel({ anchorRef, currentModel, onClose, onRefresh, onSelect, opencodeModels, provider }) {
  const [query, setQuery] = useState("");
  const [placement, setPlacement] = useState(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef?.current;
      if (!anchor || !anchor.isConnected) {
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(250, Math.max(170, viewportWidth - 16));
      const left = Math.max(8, Math.min(rect.right - width, viewportWidth - width - 8));
      const spaceBelow = viewportHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 190 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(300, openUp ? spaceAbove : spaceBelow));
      setPlacement(openUp
        ? { left, width, maxHeight, bottom: Math.max(8, viewportHeight - rect.top + 4) }
        : { left, width, maxHeight, top: rect.bottom + 4 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorRef]);

  // Close on any pointer-down outside the menu and its trigger. Ref-based so
  // it works through the portal without relying on stopPropagation.
  useEffect(() => {
    const onWindowMouseDown = (event) => {
      const target = event.target;
      if (menuRef.current?.contains(target) || anchorRef?.current?.contains(target)) {
        return;
      }
      onClose();
    };
    window.addEventListener("mousedown", onWindowMouseDown);
    return () => window.removeEventListener("mousedown", onWindowMouseDown);
  }, [anchorRef, onClose]);

  const normalizedQuery = query.trim().toLowerCase();
  const options = swarmModelOptionsForProvider(provider, opencodeModels);
  const filtered = normalizedQuery
    ? options.filter((option) => option.id.toLowerCase().includes(normalizedQuery)
      || option.label.toLowerCase().includes(normalizedQuery))
    : options;
  const isOpencode = String(provider || "").trim().toLowerCase() === "opencode";
  const cliListLive = isOpencode
    && opencodeModels?.status === "ready"
    && (opencodeModels.models || []).length > 0;
  if (!placement) {
    return null;
  }
  return createPortal(
    <SwarmModelMenu
      ref={menuRef}
      style={{
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        top: placement.top,
        bottom: placement.bottom,
      }}
    >
      <input
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const typed = query.trim();
            if (filtered.length > 0) {
              onSelect(filtered[0].id);
            } else if (typed) {
              onSelect(typed);
            }
          }
        }}
        placeholder="Search models…"
        spellCheck={false}
        value={query}
      />
      <SwarmModelMenuList>
        <SwarmModelMenuItem
          data-active={!String(currentModel || "").trim() ? "true" : undefined}
          onClick={() => onSelect("")}
          type="button"
        >
          Harness default
        </SwarmModelMenuItem>
        {filtered.map((option) => (
          <SwarmModelMenuItem
            data-active={option.id === String(currentModel || "").trim() ? "true" : undefined}
            key={option.id}
            onClick={() => onSelect(option.id)}
            title={option.id}
            type="button"
          >
            {option.label}
            {option.label !== option.id ? <small>{option.id}</small> : null}
          </SwarmModelMenuItem>
        ))}
        {filtered.length === 0 ? (
          <SwarmModelMenuHint>No matches — press Enter to use the text as a custom model id.</SwarmModelMenuHint>
        ) : null}
      </SwarmModelMenuList>
      {isOpencode ? (
        <SwarmModelMenuHint data-footer="true">
          <span>
            {opencodeModels?.status === "loading"
              ? "Loading models from opencode…"
              : cliListLive
                ? `${opencodeModels.models.length} models from opencode${opencodeModels.source === "stale-cache" ? " (stale)" : ""}`
                : "opencode model list unavailable — showing defaults"}
          </span>
          <button onClick={onRefresh} type="button">Refresh</button>
        </SwarmModelMenuHint>
      ) : null}
    </SwarmModelMenu>,
    document.body,
  );
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
    case "context_pack_reused": {
      const chars = Number(event?.data?.chars ?? 0);
      return `Reused cached context pack${chars ? ` — ${Math.round(chars / 1000)}k chars` : ""} (scout skipped)`;
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
      const similarity = Number(event?.data?.similarity ?? NaN);
      const similarityText = Number.isFinite(similarity) ? ` (similarity ${similarity.toFixed(2)})` : "";
      if (event?.data?.converged) {
        return `Gate: ${takes} takes converged${similarityText} — synthesis skipped`;
      }
      return takes <= 1
        ? "Gate: single take — it carries the run"
        : `Gate: ${takes} takes collected — fusing${similarityText}`;
    }
    case "synthesis_started":
      return String(event?.text || "").startsWith("Converged execution")
        ? `${memberName || "Champion"} is executing the converged plan`
        : `${memberName || "Champion"} is synthesizing the fused answer`;
    case "verification_started":
      return `Verifying result${event?.text ? ` — ${truncateText(event.text, 90)}` : ""}`;
    case "verification_result": {
      const ok = Boolean(event?.data?.ok);
      if (ok) return "Verification passed";
      const timedOut = Boolean(event?.data?.timedOut);
      const exitCode = Number(event?.data?.exitCode ?? NaN);
      return timedOut
        ? "Verification timed out"
        : `Verification failed${Number.isFinite(exitCode) ? ` (exit ${exitCode})` : ""}`;
    }
    case "repair_started":
      return `${memberName || "Champion"} is repairing the verification failure`;
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

function swarmFeedEventTone(event) {
  switch (event?.kind) {
    case "verification_result":
      return event?.data?.ok ? "good" : "bad";
    case "repair_started":
      return "bad";
    case "context_pack_reused":
      return "accent";
    case "gate_decision":
      return event?.data?.converged ? "accent" : undefined;
    case "run_settled": {
      const status = String(event?.data?.status || "done");
      if (status === "done") return "good";
      if (status === "failed" || status === "error") return "bad";
      return undefined;
    }
    default:
      return undefined;
  }
}

function eventHasExpandableText(event) {
  return (event?.kind === "member_take"
    || event?.kind === "run_result"
    || event?.kind === "context_pack_ready"
    || event?.kind === "verification_result")
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
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
`;

const orbPulse = keyframes`
  0% { box-shadow: 0 0 0 0 var(--swarm-orb-glow); }
  70% { box-shadow: 0 0 0 14px rgba(0, 0, 0, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
`;

const ringSpin = keyframes`
  to { transform: rotate(360deg); }
`;

const auraSpin = keyframes`
  to { transform: translate(-50%, -50%) rotate(360deg); }
`;

const edgeFlow = keyframes`
  to { stroke-dashoffset: -14; }
`;

const orbitDashFlow = keyframes`
  to { stroke-dashoffset: -120; }
`;

const takePop = keyframes`
  0% { transform: scale(1); }
  40% { transform: scale(1.24); }
  100% { transform: scale(1); }
`;

const takeRipple = keyframes`
  0% { opacity: 0.85; transform: scale(1); }
  100% { opacity: 0; transform: scale(2.1); }
`;

const orbDrift = keyframes`
  0%, 100% { transform: translate(0px, 0px); }
  25% { transform: translate(3px, -2px); }
  50% { transform: translate(0px, -4px); }
  75% { transform: translate(-3px, -2px); }
`;

const starTwinkle = keyframes`
  0%, 100% { opacity: 0.25; }
  50% { opacity: 0.75; }
`;

const nucleusBreath = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(76, 141, 255, 0.0), 0 0 22px 0 rgba(76, 141, 255, 0.08); }
  50% { box-shadow: 0 0 0 0 rgba(76, 141, 255, 0.0), 0 0 30px 4px rgba(76, 141, 255, 0.16); }
`;

const SwarmPaneRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  container: swarm-pane / size;
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

  @container swarm-pane (max-width: 340px) {
    display: none;
  }
`;

const SwarmConstellation = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 150px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;

  &[data-panning="true"] {
    cursor: grabbing;
  }

  &[data-live="false"] * {
    animation-play-state: paused !important;
  }
`;

const SwarmStars = styled.div`
  position: absolute;
  inset: -40%;
  pointer-events: none;
  background-image:
    radial-gradient(1.2px 1.2px at 12% 24%, rgba(230, 237, 243, 0.5), transparent 60%),
    radial-gradient(1px 1px at 31% 68%, rgba(230, 237, 243, 0.38), transparent 60%),
    radial-gradient(1.4px 1.4px at 47% 12%, rgba(158, 203, 255, 0.42), transparent 60%),
    radial-gradient(1px 1px at 63% 82%, rgba(230, 237, 243, 0.32), transparent 60%),
    radial-gradient(1.2px 1.2px at 78% 36%, rgba(230, 237, 243, 0.44), transparent 60%),
    radial-gradient(1px 1px at 89% 64%, rgba(158, 203, 255, 0.34), transparent 60%),
    radial-gradient(1px 1px at 22% 88%, rgba(230, 237, 243, 0.3), transparent 60%),
    radial-gradient(1.3px 1.3px at 55% 46%, rgba(230, 237, 243, 0.26), transparent 60%);
  opacity: 0.55;

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      radial-gradient(1px 1px at 8% 52%, rgba(230, 237, 243, 0.5), transparent 60%),
      radial-gradient(1.3px 1.3px at 38% 34%, rgba(158, 203, 255, 0.46), transparent 60%),
      radial-gradient(1px 1px at 58% 74%, rgba(230, 237, 243, 0.4), transparent 60%),
      radial-gradient(1.2px 1.2px at 72% 18%, rgba(230, 237, 243, 0.42), transparent 60%),
      radial-gradient(1px 1px at 92% 44%, rgba(158, 203, 255, 0.36), transparent 60%);
    animation: ${starTwinkle} 5.5s ease-in-out infinite;
  }

  html[data-forge-theme="light"] & {
    display: none;
  }
`;

const SwarmStage = styled.div`
  position: absolute;
  inset: 0;
  transform-origin: 50% 50%;
  will-change: transform;
  transition: transform 150ms ease;

  &[data-panning="true"] {
    transition: none;
  }
`;

const SwarmNucleusAura = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  width: 168px;
  height: 168px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  pointer-events: none;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    rgba(76, 141, 255, 0.55) 80deg,
    transparent 160deg,
    rgba(63, 185, 80, 0.35) 250deg,
    transparent 330deg
  );
  filter: blur(18px);
  opacity: 0;
  transition: opacity 400ms ease;
  animation: ${auraSpin} 3.2s linear infinite;

  &[data-on="true"] {
    opacity: 0.85;
  }

  @container swarm-pane (max-width: 420px) {
    width: 132px;
    height: 132px;
  }

  @container swarm-pane (max-height: 230px) {
    width: 100px;
    height: 100px;
  }

  html[data-forge-theme="light"] & {
    opacity: 0;

    &[data-on="true"] {
      opacity: 0.35;
    }
  }
`;

const SwarmViewControls = styled.div`
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;

  @container swarm-pane (max-height: 250px) {
    flex-direction: row;
    bottom: 6px;
    right: 6px;

    button {
      width: 22px;
      height: 22px;

      svg { width: 13px; height: 13px; }
    }
  }
`;

const SwarmActivateDock = styled.div`
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 4;
  max-width: calc(100% - 16px);

  @container swarm-pane (max-height: 300px) {
    bottom: 8px;

    button {
      padding: 5px 10px;
      font-size: 11px;
    }
  }

  @container swarm-pane (max-height: 230px) {
    left: 8px;
    transform: none;

    button {
      padding: 4px 9px;
      font-size: 10.5px;
    }
  }
`;

const SwarmViewControlButton = styled.button`
  appearance: none;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid rgba(139, 148, 158, 0.28);
  background: rgba(13, 17, 23, 0.85);
  color: rgba(230, 237, 243, 0.75);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(76, 141, 255, 0.55);
    color: #e6edf3;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(31, 35, 40, 0.18);
    color: rgba(31, 35, 40, 0.7);
  }
`;

const SwarmEdgeSvg = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;

  line {
    stroke: rgba(139, 148, 158, 0.2);
    stroke-width: 1.3px;
    vector-effect: non-scaling-stroke;
  }

  line[data-live="true"] {
    stroke: rgba(139, 148, 158, 0.42);
    stroke-dasharray: 5 9;
    animation: ${edgeFlow} 1.1s linear infinite;
  }

  line[data-flash="true"] {
    stroke: var(--swarm-edge-color, #4c8dff);
    stroke-width: 2px;
    stroke-dasharray: 5 9;
    animation: ${edgeFlow} 0.55s linear infinite;
  }

  ellipse[data-orbit] {
    fill: none;
    stroke: rgba(139, 148, 158, 0.16);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
    stroke-dasharray: 3 8;
    animation: ${orbitDashFlow} 30s linear infinite;
  }

  ellipse[data-orbit="inner"] {
    stroke: rgba(139, 148, 158, 0.11);
    animation-direction: reverse;
    animation-duration: 42s;
  }

  circle[data-packet] {
    filter: drop-shadow(0 0 2px var(--swarm-edge-color, #4c8dff));
  }

  html[data-forge-theme="light"] & {
    line {
      stroke: rgba(31, 35, 40, 0.16);
    }

    ellipse[data-orbit] {
      stroke: rgba(31, 35, 40, 0.12);
    }
  }
`;

const SwarmOrbAnchor = styled.div`
  position: absolute;
  transform: translate(-50%, -50%);
`;

const SwarmOrbDrift = styled.div`
  animation: ${orbDrift} 9s ease-in-out infinite;
  animation-delay: var(--swarm-orb-delay, 0ms);
`;

const SwarmOrb = styled.button`
  position: relative;
  width: 48px;
  height: 48px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--swarm-orb-color, #8b949e);
  background:
    radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--swarm-orb-color, #8b949e) 26%, transparent), transparent 62%),
    rgba(13, 17, 23, 0.94);
  color: var(--swarm-orb-color, #8b949e);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 160ms ease, opacity 160ms ease, filter 160ms ease, transform 160ms ease;
  animation: ${orbFloat} 5.2s ease-in-out infinite;
  animation-delay: var(--swarm-orb-delay, 0ms);

  svg {
    width: 20px;
    height: 20px;
  }

  &::after {
    content: "";
    position: absolute;
    inset: -2px;
    border-radius: 50%;
    border: 2px solid var(--swarm-orb-color, #8b949e);
    opacity: 0;
    pointer-events: none;
  }

  &:hover {
    filter: brightness(1.25);
    transform: scale(1.06);
  }

  &[data-selected="true"] {
    outline: 2px solid rgba(230, 237, 243, 0.55);
    outline-offset: 3px;
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

    &::after {
      animation: ${takeRipple} 0.9s ease-out;
    }
  }

  @container swarm-pane (max-width: 420px) {
    width: 40px;
    height: 40px;

    svg { width: 17px; height: 17px; }
  }

  @container swarm-pane (max-height: 300px) {
    width: 38px;
    height: 38px;

    svg { width: 16px; height: 16px; }
  }

  @container swarm-pane (max-height: 230px) {
    width: 32px;
    height: 32px;
    border-width: 1.5px;

    svg { width: 14px; height: 14px; }
  }

  html[data-forge-theme="light"] & {
    background:
      radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--swarm-orb-color, #8b949e) 14%, transparent), transparent 62%),
      #ffffff;
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
  width: 116px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  pointer-events: none;

  span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9.5px;
    font-weight: 600;
    color: rgba(230, 237, 243, 0.72);
  }

  span[data-model="true"] {
    font-size: 8.5px;
    font-weight: 500;
    color: rgba(139, 148, 158, 0.85);
  }

  @container swarm-pane (max-width: 420px) {
    width: 92px;

    span { font-size: 8.5px; }
    span[data-model="true"] { font-size: 8px; }
  }

  @container swarm-pane (max-height: 260px) {
    span[data-model="true"] { display: none; }
  }

  @container swarm-pane (max-height: 210px) {
    display: none;
  }

  html[data-forge-theme="light"] & {
    span { color: rgba(31, 35, 40, 0.66); }
    span[data-model="true"] { color: rgba(31, 35, 40, 0.48); }
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

  animation: ${nucleusBreath} 4.5s ease-in-out infinite;

  @container swarm-pane (max-width: 420px) {
    width: 96px;
    height: 96px;
    padding: 8px;

    strong { font-size: 10px; }
    small { font-size: 8.5px; }
  }

  @container swarm-pane (max-height: 300px) {
    width: 88px;
    height: 88px;
    padding: 7px;

    strong { font-size: 9.5px; }
    small { font-size: 8.5px; }
  }

  @container swarm-pane (max-height: 230px) {
    width: 72px;
    height: 72px;
    padding: 6px;

    strong { font-size: 9px; }
    small { display: none; }
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
  max-height: calc(100% - 20px);
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(139, 148, 158, 0.24);
  background: #0d1117;
  text-align: center;

  @container swarm-pane (max-height: 300px) {
    gap: 7px;
    padding: 10px 12px;

    p { display: none; }
  }

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

  svg {
    width: 12px;
    height: 12px;
  }
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

  &[data-tone="good"] {
    border-color: rgba(63, 185, 80, 0.45);
  }

  &[data-tone="bad"] {
    border-color: rgba(248, 81, 73, 0.5);
  }

  &[data-tone="accent"] {
    border-color: rgba(76, 141, 255, 0.45);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.1);

    &[data-tone="good"] {
      border-color: rgba(26, 127, 55, 0.4);
    }

    &[data-tone="bad"] {
      border-color: rgba(207, 34, 46, 0.45);
    }

    &[data-tone="accent"] {
      border-color: rgba(9, 105, 218, 0.4);
    }
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
  flex-wrap: wrap; /* narrow panes: status/buttons drop below the name */
  gap: 6px 9px;
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

  svg {
    width: 13px;
    height: 13px;
  }
`;

const SwarmMemberMain = styled.div`
  flex: 1 1 140px; /* basis forces trailing controls to wrap before the name crushes */
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
  flex-wrap: wrap;
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

const SwarmModelMenuWrap = styled.div`
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
`;

const SwarmModelMenu = styled.div`
  /* left/width/top|bottom/max-height come from inline style: the menu is
     portaled to <body> and clamped to the viewport so pane/scroll containers
     can't clip or squash it. */
  position: fixed;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid rgba(139, 148, 158, 0.32);
  background: #161b22;
  box-shadow: 0 12px 28px rgba(1, 4, 9, 0.55);

  input {
    flex: 0 0 auto;
    appearance: none;
    border: 1px solid rgba(139, 148, 158, 0.3);
    border-radius: 6px;
    background: #0d1117;
    color: #e6edf3;
    font-size: 11px;
    padding: 4px 6px;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.18);
    box-shadow: 0 12px 28px rgba(31, 35, 40, 0.18);

    input {
      background: #ffffff;
      color: #1f2328;
      border-color: rgba(31, 35, 40, 0.2);
    }
  }
`;

const SwarmModelMenuList = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const SwarmModelMenuItem = styled.button`
  appearance: none;
  flex: 0 0 auto;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(230, 237, 243, 0.88);
  text-align: left;
  font-size: 11px;
  padding: 4px 6px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  small {
    display: block;
    font-size: 9.5px;
    color: rgba(139, 148, 158, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &:hover { background: rgba(110, 118, 129, 0.16); }
  &[data-active="true"] { color: #79b8ff; background: rgba(76, 141, 255, 0.12); }

  html[data-forge-theme="light"] & {
    color: rgba(31, 35, 40, 0.9);
    &:hover { background: rgba(31, 35, 40, 0.06); }
    &[data-active="true"] { color: #0969da; background: rgba(9, 105, 218, 0.08); }
  }
`;

const SwarmModelMenuHint = styled.div`
  flex: 0 0 auto;
  font-size: 9.5px;
  line-height: 1.4;
  color: rgba(139, 148, 158, 0.9);
  padding: 3px 4px;

  &[data-footer="true"] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    border-top: 1px solid rgba(139, 148, 158, 0.18);
    padding-top: 5px;
  }

  button {
    appearance: none;
    border: none;
    background: transparent;
    color: #4c8dff;
    font-size: 9.5px;
    cursor: pointer;
    padding: 0;
    flex: 0 0 auto;
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
  padding: 8px 10px 10px;

  /* The workspace's floating "+ Add" launcher overlays the bottom-right
     corner when this pane is fullscreen or the only visible pane — reserve
     that corner so the send circle never hides behind it. */
  &[data-avoid-fab="true"] {
    padding-right: 118px;
  }

  @container swarm-pane (max-width: 380px) {
    padding: 6px 8px 8px;

    &[data-avoid-fab="true"] {
      padding-right: 104px;
    }
  }
`;

// One ChatGPT-style bubble: input on top, options + circular send inside the
// same rounded container.
const SwarmComposerBubble = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  border: 1px solid rgba(139, 148, 158, 0.3);
  border-radius: 16px;
  background: #0d1117;
  padding: 9px 10px 8px;
  transition: border-color 140ms ease;

  &:focus-within {
    border-color: rgba(76, 141, 255, 0.62);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(31, 35, 40, 0.18);
    box-shadow: 0 2px 10px rgba(31, 35, 40, 0.06);
  }
`;

const SwarmComposerInput = styled.textarea`
  width: 100%;
  resize: none;
  min-height: 40px;
  max-height: 120px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1.45;
  padding: 1px 2px 3px;
  font-family: inherit;

  &:focus { outline: none; }
  &:disabled { opacity: 0.55; }

  &::placeholder {
    color: rgba(139, 148, 158, 0.75);
  }
`;

const SwarmComposerControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SwarmModeToggle = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
  border-radius: 999px;
  background: rgba(110, 118, 129, 0.14);
  padding: 2px;

  button {
    appearance: none;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: rgba(139, 148, 158, 0.95);
    font-size: 10.5px;
    font-weight: 600;
    padding: 3px 10px;
    cursor: pointer;
  }

  button[data-active="true"] {
    background: rgba(76, 141, 255, 0.24);
    color: #9ecbff;
  }

  @container swarm-pane (max-width: 340px) {
    button {
      padding: 3px 7px;
      font-size: 10px;
    }
  }

  html[data-forge-theme="light"] & {
    background: rgba(31, 35, 40, 0.06);

    button { color: rgba(31, 35, 40, 0.6); }

    button[data-active="true"] {
      background: #ffffff;
      color: #0969da;
      box-shadow: 0 1px 3px rgba(31, 35, 40, 0.16);
    }
  }
`;

const SwarmComposerHint = styled.span`
  font-size: 10px;
  color: rgba(139, 148, 158, 0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;

  @container swarm-pane (max-width: 300px) {
    display: none;
  }
`;

const SwarmSendCircle = styled.button`
  appearance: none;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: #4c8dff;
  color: #06101f;
  transition: background 140ms ease, opacity 140ms ease;

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover:not(:disabled) {
    background: #6ba1ff;
  }

  &:disabled {
    background: rgba(110, 118, 129, 0.26);
    color: rgba(230, 237, 243, 0.4);
    cursor: default;
  }

  &[data-stop="true"] {
    background: #e6edf3;
    color: #0d1117;
  }

  &[data-stop="true"]:hover {
    background: #ffffff;
  }

  html[data-forge-theme="light"] & {
    background: #0969da;
    color: #ffffff;

    &:disabled {
      background: rgba(31, 35, 40, 0.12);
      color: rgba(31, 35, 40, 0.4);
    }

    &[data-stop="true"] {
      background: #1f2328;
      color: #ffffff;
    }
  }
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
  avoidFloatingAdd = false,
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
  const [verifyDraft, setVerifyDraft] = useState(null); // null = mirror backend value
  const [modelMenuKey, setModelMenuKey] = useState(""); // memberId (or "add") with an open model menu
  const modelMenuAnchorRef = useRef(null); // trigger button of the open menu (portal anchor)
  const [opencodeModels, setOpencodeModels] = useState({ status: "idle", models: [], source: "", error: "" });
  const [stageView, setStageView] = useState({ x: 0, y: 0, zoom: 1 });
  const [stagePanning, setStagePanning] = useState(false);

  const swarmRef = useRef(null);
  swarmRef.current = swarm;
  const selectedRunIdRef = useRef("");
  selectedRunIdRef.current = selectedRunId;
  const mountedRef = useRef(true);
  const flashTimersRef = useRef(new Map());
  const constellationRef = useRef(null);
  const stageViewRef = useRef(stageView);
  stageViewRef.current = stageView;
  const stagePanRef = useRef(null);

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

  const applyMembers = useCallback(async (memberSpecs, scoutMemberId = undefined, verifyCommand = undefined) => {
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
        verifyCommand: verifyCommand === undefined
          ? String(swarmRef.current?.verifyCommand || "")
          : String(verifyCommand || ""),
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

  const handleVerifyCommandCommit = useCallback((verifyCommand) => {
    const next = String(verifyCommand || "").trim();
    if (next === String(swarmRef.current?.verifyCommand || "")) {
      return;
    }
    const specs = members.map((member) => ({
      memberId: member.memberId,
      provider: member.provider,
      model: member.model || "",
      label: member.label || "",
    }));
    applyMembers(specs, undefined, next);
  }, [applyMembers, members]);

  // Contract §v1.4: the backend caches `opencode models` output for 5 minutes,
  // so refetching on every menu open is cheap and self-heals stale lists.
  const loadOpencodeModels = useCallback(async (forceRefresh = false) => {
    setOpencodeModels((current) => (current.status === "loading" ? current : { ...current, status: "loading" }));
    try {
      const result = await invoke("opencode_list_models", { forceRefresh });
      if (!mountedRef.current) {
        return;
      }
      setOpencodeModels({
        status: "ready",
        models: Array.isArray(result?.models) ? result.models.map(String) : [],
        source: String(result?.source || ""),
        error: String(result?.error || ""),
      });
    } catch (caught) {
      if (mountedRef.current) {
        setOpencodeModels({ status: "error", models: [], source: "error", error: invokeErrorMessage(caught) });
      }
    }
  }, []);

  const toggleModelMenu = useCallback((key, provider) => {
    setModelMenuKey((current) => {
      const next = current === key ? "" : key;
      if (next && String(provider || "").trim().toLowerCase() === "opencode") {
        loadOpencodeModels(false);
      }
      return next;
    });
  }, [loadOpencodeModels]);

  // Feed the add-member datalist as soon as opencode is the selected harness.
  useEffect(() => {
    if (activeTab === "members" && addProvider === "opencode" && opencodeModels.status === "idle") {
      loadOpencodeModels(false);
    }
  }, [activeTab, addProvider, loadOpencodeModels, opencodeModels.status]);

  const handleMemberModelChange = useCallback((memberId, model) => {
    const nextModel = String(model || "").trim();
    const target = membersById.get(memberId);
    if (!target || nextModel === String(target.model || "").trim()) {
      return;
    }
    const specs = members.map((member) => ({
      memberId: member.memberId,
      provider: member.provider,
      model: member.memberId === memberId ? nextModel : (member.model || ""),
      label: member.label || "",
    }));
    applyMembers(specs);
  }, [applyMembers, members, membersById]);

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

  // Bounded pan/zoom for the constellation stage. Wheel zooms around the
  // cursor; dragging empty space pans; both are clamped so the graph can
  // never be lost off-screen.
  useEffect(() => {
    const node = constellationRef.current;
    if (!node || activeTab !== "overview") {
      return undefined;
    }
    const handleWheel = (event) => {
      event.preventDefault();
      const current = stageViewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0016);
      const nextZoom = Math.min(
        SWARM_STAGE_MAX_ZOOM,
        Math.max(SWARM_STAGE_MIN_ZOOM, current.zoom * factor),
      );
      if (nextZoom === current.zoom) {
        return;
      }
      const rect = node.getBoundingClientRect();
      const cursorX = event.clientX - rect.left - rect.width / 2;
      const cursorY = event.clientY - rect.top - rect.height / 2;
      const scale = nextZoom / current.zoom;
      setStageView(clampSwarmStageView({
        x: cursorX - (cursorX - current.x) * scale,
        y: cursorY - (cursorY - current.y) * scale,
        zoom: nextZoom,
      }));
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [activeTab, hasMembers]);

  const handleStagePointerDown = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest("button, select, input, textarea, a")) {
      return;
    }
    const node = constellationRef.current;
    if (!node) {
      return;
    }
    stagePanRef.current = {
      originX: stageViewRef.current.x,
      originY: stageViewRef.current.y,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setStagePanning(true);
    node.setPointerCapture?.(event.pointerId);
  }, []);

  const handleStagePointerMove = useCallback((event) => {
    const pan = stagePanRef.current;
    if (!pan || event.pointerId !== pan.pointerId) {
      return;
    }
    setStageView((current) => clampSwarmStageView({
      x: pan.originX + (event.clientX - pan.startX),
      y: pan.originY + (event.clientY - pan.startY),
      zoom: current.zoom,
    }));
  }, []);

  const handleStagePointerEnd = useCallback((event) => {
    const pan = stagePanRef.current;
    if (!pan || event.pointerId !== pan.pointerId) {
      return;
    }
    stagePanRef.current = null;
    setStagePanning(false);
    constellationRef.current?.releasePointerCapture?.(event.pointerId);
  }, []);

  const zoomStageBy = useCallback((factor) => {
    setStageView((current) => {
      const nextZoom = Math.min(
        SWARM_STAGE_MAX_ZOOM,
        Math.max(SWARM_STAGE_MIN_ZOOM, current.zoom * factor),
      );
      const scale = nextZoom / current.zoom;
      return clampSwarmStageView({ x: current.x * scale, y: current.y * scale, zoom: nextZoom });
    });
  }, []);

  const resetStageView = useCallback(() => {
    setStageView({ x: 0, y: 0, zoom: 1 });
  }, []);

  const handleStageDoubleClick = useCallback((event) => {
    if (event.target.closest("button, select, input, textarea, a")) {
      return;
    }
    resetStageView();
  }, [resetStageView]);

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
      const lastVerification = [...events].reverse().find((event) => event.kind === "verification_result");
      const verifying = events.some((event) => event.kind === "verification_started")
        && (!lastVerification || events.some((event) => event.kind === "verification_started" && event.seq > lastVerification.seq));
      const repairing = events.some((event) => event.kind === "repair_started") && !verifying
        && (!lastVerification || !lastVerification.data?.ok);
      const synthesizing = events.some((event) => event.kind === "synthesis_started") && !verifying && !repairing;
      const scouting = events.some((event) => event.kind === "context_pack_started")
        && !events.some((event) => event.kind === "context_pack_ready")
        && !synthesizing
        && takeCount === 0
        && !events.some((event) => event.kind === "member_prompted");
      return {
        running: true,
        status: "running",
        title: verifying
          ? "Verifying"
          : repairing
            ? "Repairing"
            : synthesizing
              ? "Synthesizing"
              : scouting
                ? "Scouting context"
                : "Collecting takes",
        detail: verifying
          ? "running verify command"
          : repairing
            ? "champion fixing verification failure"
            : synthesizing
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
      <SwarmConstellation
        data-live={isActive ? "true" : "false"}
        data-panning={stagePanning ? "true" : undefined}
        onDoubleClick={handleStageDoubleClick}
        onPointerCancel={handleStagePointerEnd}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerEnd}
        ref={constellationRef}
      >
        <SwarmStars aria-hidden="true" />
        {hasMembers ? (
          <>
            <SwarmStage
              data-panning={stagePanning ? "true" : undefined}
              style={{ transform: `translate(${stageView.x}px, ${stageView.y}px) scale(${stageView.zoom})` }}
            >
              <SwarmEdgeSvg preserveAspectRatio="none" viewBox="0 0 100 100">
                <ellipse cx="50" cy="50" data-orbit="outer" rx="37" ry="34" />
                <ellipse cx="50" cy="50" data-orbit="inner" rx="23" ry="20.5" />
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
                {isActive ? orbPlacements.map(({ member, x, y }) => {
                  const flashing = takeFlashes.has(member.memberId);
                  if (member.status !== "working" && !flashing) {
                    return null;
                  }
                  const meta = providerMeta(member.provider);
                  return (
                    <circle
                      data-packet="true"
                      fill={meta.color}
                      key={`packet-${member.memberId}`}
                      r={flashing ? 1.1 : 0.85}
                      style={{ "--swarm-edge-color": meta.color }}
                    >
                      <animateMotion
                        dur={flashing ? "0.6s" : "1.6s"}
                        path={`M ${x} ${y} L 50 50`}
                        repeatCount="indefinite"
                      />
                    </circle>
                  );
                }) : null}
              </SwarmEdgeSvg>
              <SwarmNucleusAura aria-hidden="true" data-on={activeRunId ? "true" : undefined} />
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
                  <SwarmOrbAnchor
                    key={member.memberId}
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    <SwarmOrbDrift style={{ "--swarm-orb-delay": `${index * 420}ms` }}>
                      <SwarmOrb
                        aria-label={`Inspect ${memberDisplayName(member)}`}
                        data-flash={takeFlashes.has(member.memberId) ? "true" : undefined}
                        data-selected={selectedMemberId === member.memberId ? "true" : undefined}
                        data-status={member.status || "offline"}
                        onClick={() => setSelectedMemberId((current) => (
                          current === member.memberId ? "" : member.memberId
                        ))}
                        style={{
                          "--swarm-orb-color": meta.color,
                          "--swarm-orb-delay": `${index * 420}ms`,
                        }}
                        title={`${memberDisplayName(member)} — ${member.status || "offline"}`}
                        type="button"
                      >
                        <SwarmHarnessIcon provider={member.provider} />
                        <SwarmOrbStatusDot aria-hidden="true" />
                        {Number(member.score || 0) !== 0 ? (
                          <SwarmOrbScore aria-hidden="true">{member.score > 0 ? `+${member.score}` : member.score}</SwarmOrbScore>
                        ) : null}
                        <SwarmOrbLabel aria-hidden="true">
                          <span>{memberDisplayName(member)}</span>
                          {memberModelText(member) ? (
                            <span data-model="true">{memberModelText(member)}</span>
                          ) : null}
                        </SwarmOrbLabel>
                      </SwarmOrb>
                    </SwarmOrbDrift>
                  </SwarmOrbAnchor>
                );
              })}
            </SwarmStage>
            <SwarmViewControls data-terminal-control="true">
              <SwarmViewControlButton
                aria-label="Zoom in"
                disabled={stageView.zoom >= SWARM_STAGE_MAX_ZOOM - 0.001}
                onClick={() => zoomStageBy(1.25)}
                title="Zoom in"
                type="button"
              >
                <Add aria-hidden="true" />
              </SwarmViewControlButton>
              <SwarmViewControlButton
                aria-label="Zoom out"
                disabled={stageView.zoom <= SWARM_STAGE_MIN_ZOOM + 0.001}
                onClick={() => zoomStageBy(1 / 1.25)}
                title="Zoom out"
                type="button"
              >
                <Remove aria-hidden="true" />
              </SwarmViewControlButton>
              <SwarmViewControlButton
                aria-label="Reset view"
                onClick={resetStageView}
                title="Reset view (double-click background)"
                type="button"
              >
                <CenterFocusStrong aria-hidden="true" />
              </SwarmViewControlButton>
            </SwarmViewControls>
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
                    <SwarmHarnessIcon provider={provider.id} />
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
          <SwarmActivateDock>
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
          </SwarmActivateDock>
        ) : null}
      </SwarmConstellation>
      ) : null}

      {selectedMember ? (
          <SwarmMemberSheet>
            <header>
              <SwarmMemberBadge style={{ "--swarm-orb-color": providerMeta(selectedMember.provider).color }}>
                <SwarmHarnessIcon provider={selectedMember.provider} />
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
              <div style={{ gridColumn: "1 / -1" }}>
                <small>Model</small>
                <strong>{memberModelText(selectedMember) || "harness default"}</strong>
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
                  <SwarmFeedRow data-tone={swarmFeedEventTone(event)} key={`${event.runId}-${event.seq}`}>
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
                        {memberModelText(member) ? ` — ${memberModelText(member)}` : ""}
                      </option>
                    ))}
                  </select>
                </SwarmAddMemberRow>
              ) : null}
              {hasMembers ? (
                <SwarmAddMemberRow as="div" title="Run before an implement run settles as done (e.g. npm test, cargo check). Fails once → the champion gets one repair attempt. Empty = off.">
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(139,148,158,0.95)", flex: "0 0 auto" }}>
                    Verify
                  </span>
                  <input
                    disabled={busy || backendMissing}
                    onBlur={() => {
                      if (verifyDraft !== null) {
                        handleVerifyCommandCommit(verifyDraft);
                        setVerifyDraft(null);
                      }
                    }}
                    onChange={(event) => setVerifyDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="verify command (optional) — e.g. npm test"
                    spellCheck={false}
                    style={{ flex: "1 1 auto" }}
                    value={verifyDraft === null ? String(swarm?.verifyCommand || "") : verifyDraft}
                  />
                </SwarmAddMemberRow>
              ) : null}
              {members.map((member) => {
                const meta = providerMeta(member.provider);
                return (
                  <SwarmMemberRow key={member.memberId}>
                    <SwarmMemberBadge style={{ "--swarm-orb-color": meta.color }}>
                      <SwarmHarnessIcon provider={member.provider} />
                    </SwarmMemberBadge>
                    <SwarmMemberMain>
                      <strong>{memberDisplayName(member)}</strong>
                      <small>
                        {memberModelText(member) ? `${memberModelText(member)} · ` : ""}
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
                    <SwarmModelMenuWrap>
                      <SwarmGhostButton
                        disabled={busy || backendMissing}
                        onClick={(event) => {
                          modelMenuAnchorRef.current = event.currentTarget;
                          toggleModelMenu(member.memberId, member.provider);
                        }}
                        style={{ padding: "5px 7px", display: "inline-flex", alignItems: "center" }}
                        title={`Model: ${memberModelText(member) || "harness default"} — click to change (member relaunches)`}
                        type="button"
                      >
                        <Tune size={13} />
                      </SwarmGhostButton>
                      {modelMenuKey === member.memberId ? (
                        <SwarmModelMenuPanel
                          anchorRef={modelMenuAnchorRef}
                          currentModel={member.model || ""}
                          onClose={() => setModelMenuKey("")}
                          onRefresh={() => loadOpencodeModels(true)}
                          onSelect={(model) => {
                            setModelMenuKey("");
                            handleMemberModelChange(member.memberId, model);
                          }}
                          opencodeModels={opencodeModels}
                          provider={member.provider}
                        />
                      ) : null}
                    </SwarmModelMenuWrap>
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
                    list={`swarm-model-options-${swarmId}`}
                    onChange={(event) => setAddModel(event.target.value)}
                    placeholder="model (optional)"
                    spellCheck={false}
                    value={addModel}
                  />
                  <datalist id={`swarm-model-options-${swarmId}`}>
                    {swarmModelOptionsForProvider(addProvider, opencodeModels).map((option) => (
                      <option key={option.id} label={option.label !== option.id ? option.label : undefined} value={option.id} />
                    ))}
                  </datalist>
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

      <SwarmComposerShell
        data-avoid-fab={avoidFloatingAdd ? "true" : undefined}
        onSubmit={handleSubmitTask}
      >
        <SwarmComposerBubble>
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
              <SwarmSendCircle
                aria-label="Cancel swarm run"
                data-stop="true"
                onClick={handleCancelRun}
                title="Cancel run"
                type="button"
              >
                <Stop aria-hidden="true" />
              </SwarmSendCircle>
            ) : (
              <SwarmSendCircle
                aria-label="Send to swarm"
                disabled={composerDisabled || !prompt.trim() || readyMemberCount === 0}
                title="Send to swarm"
                type="submit"
              >
                <ArrowUpward aria-hidden="true" />
              </SwarmSendCircle>
            )}
          </SwarmComposerControls>
        </SwarmComposerBubble>
      </SwarmComposerShell>
    </SwarmPaneRoot>
  );
}
