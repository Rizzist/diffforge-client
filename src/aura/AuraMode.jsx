// Aura Mode — full-screen "Jarvis" orchestration view. UI-only for now: the
// scene renders mock fleet state (auraMockData.js) inside one containment
// sphere, and the mic mute button is a visual preview, not wired to the
// voice pipeline. Lazy-loaded from AppShell so three.js stays out of the
// main bundle.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";

import { AuraSceneEngine } from "./AuraSceneEngine.js";
import { AURA_MOCK_STATE, AURA_STATE_COLORS } from "./auraMockData.js";

const EXIT_ANIMATION_MS = 260;

const reducedMotion = css`
  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
    transition: none !important;
  }
`;

const backdropIn = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const hudIn = keyframes`
  from {
    opacity: 0;
    transform: translate3d(0, 14px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
`;

const hudInStill = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const statusBlink = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
`;

/* Aura is a committed dark experience regardless of app theme — it's the
   full-screen "monitor on the wall" view. */
const AuraBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 390;
  overflow: hidden;
  color: rgba(226, 236, 255, 0.92);
  background:
    radial-gradient(ellipse at 50% -18%, rgba(30, 62, 110, 0.4), transparent 56%),
    radial-gradient(ellipse at 84% 116%, rgba(122, 58, 16, 0.26), transparent 50%),
    radial-gradient(ellipse at 8% 108%, rgba(18, 44, 84, 0.3), transparent 46%),
    linear-gradient(180deg, #030509 0%, #010207 58%, #04060d 100%);
  animation: ${backdropIn} 360ms ease both;
  transition: opacity ${EXIT_ANIMATION_MS}ms ease;
  ${reducedMotion};

  &[data-window-platform="macos"][data-window-expanded="false"] {
    border-radius: 12px;
  }

  &[data-leaving="true"] {
    opacity: 0;
    pointer-events: none;
  }
`;

const AuraDragStrip = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 38px;
  z-index: 20;
`;

const AuraCanvasHost = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
`;

const AuraVignette = styled.div`
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  box-shadow: inset 0 0 190px rgba(0, 0, 0, 0.72);
  background: repeating-linear-gradient(
    180deg,
    rgba(160, 190, 255, 0.014) 0px,
    rgba(160, 190, 255, 0.014) 1px,
    transparent 1px,
    transparent 4px
  );
`;

const auraHudLayer = css`
  position: absolute;
  z-index: 30;
  pointer-events: none;
  animation: ${hudIn} 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  ${reducedMotion};
`;

const AuraCornerBracket = styled.div`
  position: absolute;
  z-index: 6;
  width: 26px;
  height: 26px;
  pointer-events: none;
  border: 0 solid rgba(148, 180, 255, 0.3);
  animation: ${hudInStill} 900ms ease both;
  animation-delay: 340ms;
  ${reducedMotion};

  &[data-corner="tl"] {
    top: 46px;
    left: 16px;
    border-top-width: 1px;
    border-left-width: 1px;
  }

  &[data-corner="tr"] {
    top: 46px;
    right: 16px;
    border-top-width: 1px;
    border-right-width: 1px;
  }

  &[data-corner="bl"] {
    bottom: 16px;
    left: 16px;
    border-bottom-width: 1px;
    border-left-width: 1px;
  }

  &[data-corner="br"] {
    bottom: 16px;
    right: 16px;
    border-bottom-width: 1px;
    border-right-width: 1px;
  }
`;

const AuraExitButton = styled.button`
  ${auraHudLayer};
  top: 50px;
  left: 26px;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 8px 12px;
  pointer-events: auto;
  appearance: none;
  border: 1px solid rgba(148, 180, 255, 0.2);
  border-radius: 999px;
  background: rgba(8, 14, 26, 0.55);
  color: rgba(226, 236, 255, 0.88);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  backdrop-filter: blur(14px) saturate(130%);
  transition:
    border-color 150ms ease,
    background 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;

  svg {
    display: block;
    width: 13px;
    height: 13px;
  }

  &:hover {
    border-color: rgba(79, 216, 255, 0.45);
    background: rgba(12, 22, 40, 0.72);
    box-shadow: 0 0 22px rgba(79, 216, 255, 0.14);
  }

  &:focus-visible {
    outline: none;
    border-color: rgba(79, 216, 255, 0.65);
    box-shadow: 0 0 0 3px rgba(79, 216, 255, 0.18);
  }

  &:active {
    transform: scale(0.97);
  }
`;

const AuraWordmark = styled.div`
  ${auraHudLayer};
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  gap: 6px;
  animation-name: ${hudInStill};
  animation-delay: 120ms;
`;

const AuraWordmarkTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.52em;
  text-indent: 0.52em;
  color: rgba(232, 240, 255, 0.9);
  text-shadow: 0 0 24px rgba(79, 216, 255, 0.35);
`;

const AuraWordmarkStatus = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  color: rgba(79, 216, 255, 0.72);

  &::before {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: #4fd8ff;
    box-shadow: 0 0 8px rgba(79, 216, 255, 0.9);
    animation: ${statusBlink} 2.4s ease-in-out infinite;
    ${reducedMotion};
  }

  &[data-mode="user"] {
    color: rgba(120, 235, 190, 0.8);
  }

  &[data-mode="user"]::before {
    background: #52e5a3;
    box-shadow: 0 0 8px rgba(82, 229, 163, 0.9);
  }

  &[data-mode="orchestrator"] {
    color: rgba(255, 196, 120, 0.85);
  }

  &[data-mode="orchestrator"]::before {
    background: #ff9a3c;
    box-shadow: 0 0 8px rgba(255, 154, 60, 0.9);
    animation-duration: 0.9s;
  }

  &[data-mode="muted"] {
    color: rgba(150, 172, 210, 0.6);
  }

  &[data-mode="muted"]::before {
    background: #77839a;
    box-shadow: none;
    animation: none;
  }
`;

const dotPulse = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
`;

/* Top-right activity queue: the one HUD panel. */
const AuraActivityPanel = styled.section`
  ${auraHudLayer};
  top: 92px;
  right: 26px;
  width: 238px;
  max-height: min(58vh, 480px);
  overflow-y: auto;
  scrollbar-width: thin;
  padding: 14px 16px;
  animation-name: ${hudInStill};
  animation-delay: 220ms;
  border: 1px solid rgba(148, 180, 255, 0.13);
  border-radius: 14px;
  background: rgba(6, 10, 19, 0.46);
  backdrop-filter: blur(16px) saturate(130%);

  @media (max-width: 760px) {
    display: none;
  }
`;

const AuraActivityHeading = styled.h3`
  margin: 0 0 10px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: rgba(148, 180, 255, 0.62);
`;

const AuraActivityRow = styled.div`
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  align-items: baseline;
  column-gap: 9px;
  padding: 4px 0;
`;

const AuraActivityDot = styled.span`
  align-self: center;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: ${(props) => props.$color || "#77839a"};
  box-shadow: 0 0 9px ${(props) => props.$color || "#77839a"}66;

  &[data-pulse="true"] {
    animation: ${dotPulse} 2.1s ease-in-out infinite;
    ${reducedMotion};
  }
`;

const AuraActivityName = styled.div`
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  color: rgba(226, 236, 255, 0.9);
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AuraActivityMeta = styled.div`
  grid-column: 2;
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: rgba(160, 180, 214, 0.6);
`;

const AuraActivitySummary = styled.div`
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(148, 180, 255, 0.12);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: rgba(160, 180, 214, 0.62);
`;

/* Small mic mute toggle, bottom center — replaces the big voice button. */
const AuraMuteCluster = styled.div`
  ${auraHudLayer};
  bottom: 34px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  gap: 8px;
  animation-name: ${hudInStill};
  animation-delay: 420ms;
`;

const AuraMuteButton = styled.button`
  display: grid;
  width: 46px;
  height: 46px;
  padding: 0;
  place-items: center;
  pointer-events: auto;
  appearance: none;
  border: 1px solid rgba(148, 180, 255, 0.22);
  border-radius: 999px;
  background: rgba(8, 14, 26, 0.6);
  color: rgba(196, 226, 255, 0.9);
  cursor: pointer;
  line-height: 0;
  backdrop-filter: blur(14px) saturate(130%);
  transition:
    border-color 150ms ease,
    background 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease,
    transform 150ms ease;

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    border-color: rgba(79, 216, 255, 0.45);
    box-shadow: 0 0 18px rgba(79, 216, 255, 0.16);
  }

  &:focus-visible {
    outline: none;
    border-color: rgba(79, 216, 255, 0.65);
    box-shadow: 0 0 0 3px rgba(79, 216, 255, 0.18);
  }

  &:active {
    transform: scale(0.94);
  }

  &[data-muted="true"] {
    border-color: rgba(255, 178, 77, 0.5);
    color: rgba(255, 196, 120, 0.95);
    box-shadow: 0 0 16px rgba(255, 154, 60, 0.16);
  }
`;

const AuraMuteCaption = styled.div`
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-indent: 0.28em;
  color: rgba(150, 172, 210, 0.6);

  &[data-muted="true"] {
    color: rgba(255, 196, 120, 0.75);
  }
`;

const tickerIn = keyframes`
  from {
    opacity: 0;
    transform: translate3d(0, 6px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
`;

const AuraActivityTicker = styled.div`
  ${auraHudLayer};
  bottom: 46px;
  left: 56px;
  max-width: 340px;
  overflow: hidden;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.1em;
  color: rgba(126, 214, 255, 0.78);
  white-space: nowrap;
  text-overflow: ellipsis;
  animation-name: ${hudInStill};
  animation-delay: 600ms;

  > span {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    animation: ${tickerIn} 420ms ease both;
    ${reducedMotion};
  }
`;

const AuraFooterLine = styled.div`
  ${auraHudLayer};
  bottom: 24px;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.16em;
  color: rgba(150, 172, 210, 0.55);
  animation-name: ${hudInStill};
  animation-delay: 520ms;

  &[data-side="left"] {
    left: 56px;
  }

  &[data-side="right"] {
    right: 56px;
    text-align: right;
    color: rgba(170, 196, 238, 0.72);
  }
`;

function AuraBackIcon(props) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function AuraMicIcon({ muted = false, ...props }) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
      {muted && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}

export function AuraMode({
  isWindowFrameExpanded = false,
  onExit,
  onTitleBarMouseDown,
  windowPlatform = "unknown",
}) {
  const canvasHostRef = useRef(null);
  const engineRef = useRef(null);
  const exitTimerRef = useRef(0);
  const [leaving, setLeaving] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [hoveredNode, setHoveredNode] = useState(null);

  const data = AURA_MOCK_STATE;

  const totals = useMemo(() => {
    let workspaces = 0;
    let panels = 0;
    let inFlight = 0;
    for (const device of data.devices) {
      workspaces += device.workspaces.length;
      for (const workspace of device.workspaces) {
        panels += workspace.panels.length;
        inFlight += (workspace.todos?.queued || 0) + (workspace.todos?.running || 0);
      }
    }
    return { devices: data.devices.length, workspaces, panels, inFlight };
  }, [data]);

  /* Activity queue: running scripts, running loop runs, local running todos,
     plus a queued summary line. */
  const activity = useMemo(() => {
    const rows = [];
    const localDevice = data.devices.find((device) => device.kind === "local") || null;
    for (const device of data.devices) {
      for (const script of device.scripts || []) {
        if (script.state === "running") {
          rows.push({
            id: `script:${script.id}`,
            name: script.name,
            meta: `script · ${device.name}`,
            color: AURA_STATE_COLORS.running,
            pulse: true,
          });
        }
      }
    }
    for (const loopRun of data.loopRuns || []) {
      if (loopRun.state === "running") {
        rows.push({
          id: `loop:${loopRun.id}`,
          name: loopRun.name,
          meta: "loop run",
          color: "#b48cff",
          pulse: true,
        });
      }
    }
    if (localDevice) {
      for (const workspace of localDevice.workspaces) {
        for (const todo of workspace.todos?.active || []) {
          rows.push({
            id: `todo:${workspace.id}:${todo}`,
            name: todo,
            meta: `todo · ${workspace.name}`,
            color: AURA_STATE_COLORS.running,
            pulse: true,
          });
        }
      }
    }
    const queuedTodos = data.devices.reduce(
      (sum, device) => sum + device.workspaces.reduce(
        (wsSum, workspace) => wsSum + (workspace.todos?.queued || 0),
        0,
      ),
      0,
    );
    const queuedLoops = (data.loopRuns || []).filter((loopRun) => loopRun.state === "queued").length;
    return { rows, queuedTodos, queuedLoops };
  }, [data]);

  const [feedIndex, setFeedIndex] = useState(0);
  useEffect(() => {
    const feed = data.activityFeed || [];
    if (feed.length < 2) return undefined;
    const timer = window.setInterval(
      () => setFeedIndex((index) => (index + 1) % feed.length),
      3600,
    );
    return () => window.clearInterval(timer);
  }, [data]);

  /* Preview conversation loop — the wiring seam for the real voice pipeline
     (user speech start/stop + orchestrator TTS start/stop should drive
     setVoiceMode directly). While unmuted, the sphere surface reacts:
     listening ripples cool, responding ripples warm. */
  const [voiceMode, setVoiceMode] = useState("idle");
  useEffect(() => {
    if (micMuted) {
      setVoiceMode("idle");
      return undefined;
    }
    const steps = [
      ["idle", 2800],
      ["user", 2300],
      ["idle", 650],
      ["orchestrator", 3600],
    ];
    let cancelled = false;
    let timer = 0;
    let index = 0;
    const step = () => {
      if (cancelled) return;
      const [mode, duration] = steps[index % steps.length];
      index += 1;
      setVoiceMode(mode);
      timer = window.setTimeout(step, duration);
    };
    step();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [micMuted]);

  useEffect(() => {
    engineRef.current?.setVoiceActivity(micMuted ? "idle" : voiceMode);
  }, [micMuted, voiceMode]);

  const beginExit = useCallback(() => {
    setLeaving((already) => {
      if (already) return already;
      exitTimerRef.current = window.setTimeout(() => {
        if (onExit) onExit();
      }, EXIT_ANIMATION_MS);
      return true;
    });
  }, [onExit]);

  useEffect(() => () => window.clearTimeout(exitTimerRef.current), []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        beginExit();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [beginExit]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return undefined;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const engine = new AuraSceneEngine({
      container: host,
      data,
      reducedMotion: Boolean(prefersReduced),
      onHoverNode: setHoveredNode,
    });
    engineRef.current = engine;
    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [data]);

  const hoverReadout = hoveredNode
    ? `▸ ${hoveredNode.label} — ${hoveredNode.detail}`
    : "drag to orbit · scroll to zoom";

  const queuedSummary = [
    activity.queuedTodos ? `${activity.queuedTodos} todo${activity.queuedTodos === 1 ? "" : "s"} queued` : null,
    activity.queuedLoops ? `${activity.queuedLoops} loop${activity.queuedLoops === 1 ? "" : "s"} queued` : null,
  ].filter(Boolean).join(" · ");

  return (
    <AuraBackdrop
      data-leaving={leaving ? "true" : "false"}
      data-window-expanded={isWindowFrameExpanded ? "true" : "false"}
      data-window-platform={windowPlatform}
      role="dialog"
      aria-label="Aura Mode"
      aria-modal="true"
    >
      <AuraCanvasHost ref={canvasHostRef} />
      <AuraVignette />
      <AuraDragStrip onMouseDown={onTitleBarMouseDown} />

      <AuraCornerBracket data-corner="tl" />
      <AuraCornerBracket data-corner="tr" />
      <AuraCornerBracket data-corner="bl" />
      <AuraCornerBracket data-corner="br" />

      <AuraExitButton onClick={beginExit} title="Exit Aura Mode (Esc)" type="button">
        <AuraBackIcon aria-hidden="true" />
        Exit Aura
      </AuraExitButton>

      <AuraWordmark aria-hidden="true">
        <AuraWordmarkTitle>AURA</AuraWordmarkTitle>
        <AuraWordmarkStatus
          data-mode={micMuted ? "muted" : voiceMode !== "idle" ? voiceMode : undefined}
        >
          {micMuted
            ? "Mic Muted"
            : voiceMode === "user"
              ? "Listening…"
              : voiceMode === "orchestrator"
                ? "Responding…"
                : "Orchestrator · Online"}
        </AuraWordmarkStatus>
      </AuraWordmark>

      <AuraActivityPanel aria-label="Activity in queue">
        <AuraActivityHeading>Activity · In Flight</AuraActivityHeading>
        {activity.rows.map((row) => (
          <AuraActivityRow key={row.id}>
            <AuraActivityDot $color={row.color} data-pulse={row.pulse ? "true" : undefined} />
            <AuraActivityName>{row.name}</AuraActivityName>
            <AuraActivityMeta>{row.meta}</AuraActivityMeta>
          </AuraActivityRow>
        ))}
        {!activity.rows.length && <AuraActivityMeta>Nothing running right now</AuraActivityMeta>}
        {queuedSummary && <AuraActivitySummary>{queuedSummary}</AuraActivitySummary>}
      </AuraActivityPanel>

      <AuraMuteCluster>
        <AuraMuteButton
          aria-label={micMuted ? "Unmute orchestrator mic (preview)" : "Mute orchestrator mic (preview)"}
          aria-pressed={micMuted}
          data-muted={micMuted ? "true" : "false"}
          onClick={() => setMicMuted((value) => !value)}
          title={micMuted ? "Unmute — preview only, not wired" : "Mute — preview only, not wired"}
          type="button"
        >
          <AuraMicIcon aria-hidden="true" muted={micMuted} />
        </AuraMuteButton>
        <AuraMuteCaption data-muted={micMuted ? "true" : "false"}>
          {micMuted ? "Muted" : "Mic Live"}
        </AuraMuteCaption>
      </AuraMuteCluster>

      <AuraActivityTicker aria-live="polite">
        <span key={feedIndex}>▸ {(data.activityFeed || [])[feedIndex] || ""}</span>
      </AuraActivityTicker>

      <AuraFooterLine data-side="left">
        {totals.devices} devices · {totals.workspaces} workspaces · {totals.panels} panels ·{" "}
        {totals.inFlight} todos in flight
      </AuraFooterLine>
      <AuraFooterLine data-side="right">{hoverReadout}</AuraFooterLine>
    </AuraBackdrop>
  );
}

export default AuraMode;
