// Aura Mode — full-screen "Jarvis" orchestration view. UI-only for now: the
// scene renders mock workspace/terminal/todo/docs/MCP state (auraMockData.js)
// and the voice button is a visual preview, not wired to the voice pipeline.
// Lazy-loaded from AppShell so three.js stays out of the main bundle.

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

const voicePulse = keyframes`
  0% {
    opacity: 0.55;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1.85);
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
  animation-delay: 120ms;

  /* keep the entrance slide from fighting the centering transform */
  animation-name: ${hudInStill};
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
`;

const AuraPanel = styled.section`
  ${auraHudLayer};
  top: 50%;
  width: 216px;
  padding: 15px 17px;
  transform: translateY(-50%);
  animation-name: ${hudInStill};
  border: 1px solid rgba(148, 180, 255, 0.13);
  border-radius: 14px;
  background: rgba(6, 10, 19, 0.46);
  backdrop-filter: blur(16px) saturate(130%);

  &[data-side="left"] {
    left: 26px;
    animation-delay: 220ms;
  }

  &[data-side="right"] {
    right: 26px;
    animation-delay: 300ms;
  }

  @media (max-width: 980px) {
    display: none;
  }
`;

const AuraPanelHeading = styled.h3`
  margin: 0 0 10px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: rgba(148, 180, 255, 0.62);
`;

const AuraPanelDivider = styled.div`
  height: 1px;
  margin: 13px 0;
  background: linear-gradient(90deg, rgba(148, 180, 255, 0.24), transparent);
`;

const AuraPanelRow = styled.div`
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  align-items: baseline;
  column-gap: 9px;
  padding: 4px 0;
`;

const AuraPanelDot = styled.span`
  align-self: center;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: ${(props) => props.$color || "#77839a"};
  box-shadow: 0 0 9px ${(props) => props.$color || "#77839a"}66;
`;

const AuraPanelName = styled.div`
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  color: rgba(226, 236, 255, 0.9);
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AuraPanelMeta = styled.div`
  grid-column: 2;
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: rgba(160, 180, 214, 0.6);
`;

const AuraVoiceCluster = styled.div`
  ${auraHudLayer};
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  gap: 13px;
  animation-name: ${hudInStill};
  animation-delay: 420ms;
`;

const AuraVoiceRing = styled.span`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 78px;
  height: 78px;
  margin: -39px 0 0 -39px;
  border: 1px solid rgba(79, 216, 255, 0.5);
  border-radius: 999px;
  pointer-events: none;
  animation: ${voicePulse} 2.8s ease-out infinite;
  ${reducedMotion};

  &[data-ring="2"] {
    border-color: rgba(255, 154, 60, 0.4);
    animation-delay: 1.4s;
  }
`;

const AuraVoiceButtonShell = styled.div`
  position: relative;

  &[data-engaged="true"] ${AuraVoiceRing} {
    animation-duration: 1.3s;
  }
`;

const AuraVoiceButton = styled.button`
  display: grid;
  position: relative;
  z-index: 2;
  width: 78px;
  height: 78px;
  padding: 0;
  place-items: center;
  pointer-events: auto;
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: #000000;
  box-shadow:
    0 0 0 5px rgba(244, 247, 250, 0.08),
    0 12px 44px rgba(0, 0, 0, 0.55);
  cursor: pointer;
  line-height: 0;
  outline: none;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  img {
    width: 46px;
    height: 46px;
    border-radius: 999px;
    pointer-events: none;
  }

  &:hover {
    border-color: rgba(79, 216, 255, 0.45);
    box-shadow:
      0 0 0 5px rgba(79, 216, 255, 0.12),
      0 0 34px rgba(79, 216, 255, 0.22),
      0 12px 44px rgba(0, 0, 0, 0.55);
  }

  &:focus-visible {
    border-color: rgba(79, 216, 255, 0.7);
    box-shadow:
      0 0 0 4px rgba(79, 216, 255, 0.24),
      0 12px 44px rgba(0, 0, 0, 0.55);
  }

  &:active {
    transform: scale(0.96);
  }

  &[data-engaged="true"] {
    border-color: rgba(79, 216, 255, 0.6);
    box-shadow:
      0 0 0 5px rgba(79, 216, 255, 0.16),
      0 0 44px rgba(79, 216, 255, 0.3),
      0 12px 44px rgba(0, 0, 0, 0.55);
  }
`;

const AuraVoiceCaption = styled.div`
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.26em;
  text-indent: 0.26em;
  text-align: center;
  color: rgba(196, 212, 240, 0.66);

  em {
    display: block;
    margin-top: 5px;
    font-size: 8.5px;
    font-style: normal;
    letter-spacing: 0.18em;
    color: rgba(79, 216, 255, 0.7);
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
  const [voiceEngaged, setVoiceEngaged] = useState(false);
  const [hoveredNode, setHoveredNode] = useState(null);

  const data = AURA_MOCK_STATE;

  const totals = useMemo(() => {
    const terminals = data.workspaces.reduce((sum, ws) => sum + ws.terminals.length, 0);
    const inFlight = data.workspaces.reduce(
      (sum, ws) => sum + ws.todos.queued + ws.todos.running,
      0,
    );
    return { workspaces: data.workspaces.length, terminals, inFlight };
  }, [data]);

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
        <AuraWordmarkStatus>Orchestrator · Online</AuraWordmarkStatus>
      </AuraWordmark>

      <AuraPanel aria-label="Workspaces" data-side="left">
        <AuraPanelHeading>Workspaces</AuraPanelHeading>
        {data.workspaces.map((workspace) => {
          const running = workspace.terminals.filter((t) => t.state === "running").length;
          const attention = workspace.terminals.filter((t) => t.state === "attention").length;
          const meta = [
            running ? `${running} running` : null,
            attention ? `${attention} attention` : null,
            workspace.todos.queued ? `${workspace.todos.queued} queued` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "idle";
          return (
            <AuraPanelRow key={workspace.id}>
              <AuraPanelDot
                $color={attention ? AURA_STATE_COLORS.attention : workspace.accent}
              />
              <AuraPanelName>{workspace.name}</AuraPanelName>
              <AuraPanelMeta>{meta}</AuraPanelMeta>
            </AuraPanelRow>
          );
        })}
      </AuraPanel>

      <AuraPanel aria-label="Docs and MCP servers" data-side="right">
        <AuraPanelHeading>Docs</AuraPanelHeading>
        {data.docs.map((doc) => (
          <AuraPanelRow key={doc.id}>
            <AuraPanelDot $color="#ffd27d" />
            <AuraPanelName>{doc.name}</AuraPanelName>
          </AuraPanelRow>
        ))}
        <AuraPanelDivider />
        <AuraPanelHeading>MCP Servers</AuraPanelHeading>
        {data.mcps.map((mcp) => (
          <AuraPanelRow key={mcp.id}>
            <AuraPanelDot $color="#b48cff" />
            <AuraPanelName>{mcp.name}</AuraPanelName>
          </AuraPanelRow>
        ))}
      </AuraPanel>

      <AuraVoiceCluster>
        <AuraVoiceButtonShell data-engaged={voiceEngaged ? "true" : "false"}>
          <AuraVoiceRing data-ring="1" />
          <AuraVoiceRing data-ring="2" />
          <AuraVoiceButton
            aria-label="Speak to the orchestrator (preview)"
            data-engaged={voiceEngaged ? "true" : "false"}
            onClick={() => setVoiceEngaged((value) => !value)}
            title="Voice orchestrator — visual preview, not wired yet"
            type="button"
          >
            <img alt="" src="/logo.webp" />
          </AuraVoiceButton>
        </AuraVoiceButtonShell>
        <AuraVoiceCaption>
          Speak to the Orchestrator
          {voiceEngaged && <em>Listening · preview only</em>}
        </AuraVoiceCaption>
      </AuraVoiceCluster>

      <AuraFooterLine data-side="left">
        {totals.workspaces} workspaces · {totals.terminals} terminals · {totals.inFlight} todos in
        flight
      </AuraFooterLine>
      <AuraFooterLine data-side="right">{hoverReadout}</AuraFooterLine>
    </AuraBackdrop>
  );
}

export default AuraMode;
