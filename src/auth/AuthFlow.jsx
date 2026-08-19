import { useEffect, useRef } from "react";
import styled, { css, keyframes } from "styled-components";

import { C } from "./theme.js";
import { PHASES, createParticleField } from "./particleField.js";

/* Auth/boot ceremony for the desktop client, ported from the approved
   next-diffforge /authmockup design. The logo materializes from particles
   (colors sampled live from /logo.webp so the blue/orange split is the real
   brand split), the entry card rises beneath it (browser deeplink sign-in /
   register), the same waiting treatment covers both, and a completed auth
   detonates the particle field into a hyperspace launch.

   Fully controlled: the host owns `phase` and advances it from real auth
   events — this component never advances an auth phase on its own. The only
   internal timer is the launch-fade completion timer, which reports (via
   onLaunchComplete) when the detonation + canvas fade have finished so the
   host can unmount the layer. The real workspace sits beneath this fixed
   overlay; launch fades the backdrop + canvas to reveal it. See
   src/auth/INTEGRATION.md for wiring. */

/* ---- tuning knobs (kept identical to the approved mockup) ----------- */

const LOGO_BOX = 300; // px, particle logo display box
const LOGO_TOP_VH = 12; // logo anchor top offset, vh

// Mirrors ParticleCanvas's `transition: opacity 1.5s ease 0.35s` below —
// when the fade lands, the detonation is over and the layer can drop.
export const LAUNCH_FADE_TOTAL_MS = 1850;

export { PHASES, SUCCESS_HOLD_MS } from "./particleField.js";

/* ---- component ------------------------------------------------------ */

export default function AuthFlow({
  phase,
  mode = "signin",
  code = "",
  statusMessage = "",
  onSignIn,
  onRegister,
  onCancel,
  onBootDone,
  onLaunchComplete,
}) {
  const canvasRef = useRef(null);
  const anchorRef = useRef(null);
  const engineRef = useRef(null);

  // Latest callbacks via ref so changing prop identities never re-inits the
  // engine or re-arms timers.
  const callbacksRef = useRef({});
  callbacksRef.current = { onBootDone, onLaunchComplete };
  const initialPhaseRef = useRef(phase);

  /* engine lifecycle: one engine per mount, destroyed on unmount */
  useEffect(() => {
    const engine = createParticleField({
      canvas: canvasRef.current,
      anchor: anchorRef.current,
      initialPhase: initialPhaseRef.current,
      // Fired exactly once per boot run (the engine guards re-fires).
      onBootDone: () => callbacksRef.current.onBootDone?.(),
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  /* controlled phase → engine (same-phase calls are no-ops inside) */
  useEffect(() => {
    engineRef.current?.setPhase(phase);
  }, [phase]);

  /* launch completion: visual-fade timer only — it never advances phase */
  useEffect(() => {
    if (phase !== PHASES.LAUNCH) return undefined;
    const t = setTimeout(() => {
      callbacksRef.current.onLaunchComplete?.();
    }, LAUNCH_FADE_TOTAL_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const launching = phase === PHASES.LAUNCH;
  const waitingLine =
    statusMessage ||
    (mode === "signin"
      ? "Waiting for your browser"
      : "Finishing your account in the browser");
  const [codeA = "", codeB = ""] = String(code || "").split("·");

  return (
    <Stage $gone={launching}>
      <Backdrop $gone={launching} />
      <ParticleCanvas ref={canvasRef} $gone={launching} />

      <AuthLayer $leaving={launching}>
        <LogoAnchor ref={anchorRef} />
        <Wordmark $show={phase !== PHASES.BOOT}>DIFF FORGE</Wordmark>

        <CardZone>
          {phase === PHASES.ENTRY && (
            <EntryCard>
              <PrimaryBtn onClick={onSignIn} type="button">
                Sign in with browser
              </PrimaryBtn>
              <GhostBtn onClick={onRegister} type="button">
                Create account
              </GhostBtn>
              <Hint>Continues at diffforge.ai — this device links automatically.</Hint>
            </EntryCard>
          )}

          {phase === PHASES.WAITING && (
            <EntryCard>
              {codeA && (
                <CodeRow aria-label="device confirmation code">
                  <CodeHalf $tone="blue">{codeA}</CodeHalf>
                  {codeB && (
                    <>
                      <CodeDot />
                      <CodeHalf $tone="orange">{codeB}</CodeHalf>
                    </>
                  )}
                </CodeRow>
              )}
              <StatusLine>
                {waitingLine}
                <Dots>
                  <i />
                  <i />
                  <i />
                </Dots>
              </StatusLine>
              {codeA && (
                <Hint>Approve the request matching this code to link the device.</Hint>
              )}
              <CancelLink onClick={onCancel} type="button">
                Cancel
              </CancelLink>
            </EntryCard>
          )}

          {phase === PHASES.SUCCESS && (
            <EntryCard>
              <Welcome>Signed in.</Welcome>
              <Hint>Loading your workspace…</Hint>
            </EntryCard>
          )}
        </CardZone>
      </AuthLayer>

      {launching && (
        <>
          <Flash />
          <ShockRing />
          <ShockRingEcho />
        </>
      )}
    </Stage>
  );
}

/* ---- styles --------------------------------------------------------- */

const Stage = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  color: ${C.text};
  font-family: inherit;
  ${(p) =>
    p.$gone &&
    css`
      pointer-events: none;
    `}
`;

/* The mockup painted this on the stage itself; here it fades out with the
   canvas during launch so the real workspace beneath is revealed. */
const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    radial-gradient(120% 90% at 50% 0%, rgba(47, 128, 255, 0.07), transparent 55%),
    radial-gradient(110% 80% at 50% 100%, rgba(255, 122, 24, 0.05), transparent 50%),
    ${C.black};
  opacity: ${(p) => (p.$gone ? 0 : 1)};
  transition: opacity 1.5s ease 0.35s;
`;

const ParticleCanvas = styled.canvas`
  position: fixed;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  opacity: ${(p) => (p.$gone ? 0 : 1)};
  transition: opacity 1.5s ease 0.35s;
`;

const AuthLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: opacity 0.55s ease, transform 0.55s ease;
  ${(p) =>
    p.$leaving &&
    css`
      opacity: 0;
      transform: scale(1.05);
      pointer-events: none;
    `}
`;

const LogoAnchor = styled.div`
  width: min(${LOGO_BOX}px, 72vw);
  height: min(${LOGO_BOX}px, 72vw);
  margin-top: ${LOGO_TOP_VH}vh;
  flex: 0 0 auto;
`;

const wordmarkIn = keyframes`
  from { opacity: 0; letter-spacing: 0.9em; }
  to { opacity: 1; letter-spacing: 0.52em; }
`;

const Wordmark = styled.div`
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.52em;
  text-indent: 0.52em;
  color: ${C.textDim};
  opacity: 0;
  ${(p) =>
    p.$show &&
    css`
      animation: ${wordmarkIn} 0.9s ease forwards;
    `}
`;

const CardZone = styled.div`
  margin-top: 34px;
  min-height: 190px;
  display: flex;
  justify-content: center;
`;

const cardIn = keyframes`
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
`;

const EntryCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  animation: ${cardIn} 0.5s cubic-bezier(0.2, 0.9, 0.25, 1) both;
`;

const PrimaryBtn = styled.button`
  appearance: none;
  width: 276px;
  border: 1px solid transparent;
  border-radius: 14px;
  padding: 14px 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: ${C.white};
  cursor: pointer;
  /* Split-brand border: blue edge → white seam → orange edge, like the logo. */
  background:
    linear-gradient(180deg, rgba(23, 34, 50, 0.97), rgba(10, 15, 23, 0.97)) padding-box,
    linear-gradient(
        100deg,
        ${C.blue},
        rgba(247, 249, 255, 0.85) 50%,
        ${C.orange}
      )
      border-box;
  box-shadow:
    -18px 12px 46px rgba(47, 128, 255, 0.17),
    18px 12px 46px rgba(255, 122, 24, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.09);
  transition: transform 0.16s ease, box-shadow 0.22s ease;
  &:hover {
    transform: translateY(-1px);
    box-shadow:
      -18px 14px 56px rgba(47, 128, 255, 0.3),
      18px 14px 56px rgba(255, 122, 24, 0.26),
      inset 0 1px 0 rgba(255, 255, 255, 0.14);
  }
  &:active {
    transform: translateY(0) scale(0.99);
  }
`;

const GhostBtn = styled.button`
  appearance: none;
  width: 276px;
  border: 1px solid ${C.line};
  border-radius: 14px;
  padding: 12px 0;
  font-size: 13.5px;
  font-weight: 500;
  color: ${C.textDim};
  cursor: pointer;
  background: rgba(13, 20, 31, 0.55);
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease,
    transform 0.16s ease;
  &:hover {
    color: ${C.text};
    border-color: ${C.lineStrong};
    background: ${C.panel};
    transform: translateY(-1px);
  }
  &:active {
    transform: translateY(0);
  }
`;

const Hint = styled.div`
  margin-top: 4px;
  font-size: 12px;
  color: ${C.textMuted};
`;

const CodeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.14em;
`;

const CodeHalf = styled.span`
  color: ${(p) => (p.$tone === "blue" ? C.blueBright : C.orangeBright)};
  text-shadow: 0 0 24px
    ${(p) => (p.$tone === "blue" ? "rgba(47,128,255,0.5)" : "rgba(255,122,24,0.5)")};
`;

const CodeDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${C.textMuted};
`;

const StatusLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-size: 14px;
  color: ${C.textDim};
`;

const dotPulse = keyframes`
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
`;

const Dots = styled.span`
  display: inline-flex;
  gap: 3px;
  padding-left: 2px;
  i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: ${C.textDim};
    animation: ${dotPulse} 1.3s infinite;
  }
  i:nth-child(2) {
    animation-delay: 0.18s;
  }
  i:nth-child(3) {
    animation-delay: 0.36s;
  }
`;

const CancelLink = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  color: ${C.textMuted};
  font-size: 12.5px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  &:hover {
    color: ${C.text};
  }
`;

const Welcome = styled.div`
  font-size: 22px;
  font-weight: 600;
  color: ${C.white};
`;

/* ---- launch detonation ---- */

/* Burst: a soft warm kiss of light plus two expanding brand-tinted
   shockwave rings — drama without the full-screen white retina burn. */

const LOGO_CENTER_Y = `calc(${LOGO_TOP_VH}vh + min(${LOGO_BOX / 2}px, 36vw))`;

const flashOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

const Flash = styled.div`
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  background: radial-gradient(
    circle at 50% ${LOGO_CENTER_Y},
    rgba(255, 238, 214, 0.5),
    rgba(255, 238, 214, 0) 42%
  );
  animation: ${flashOut} 0.55s ease-out forwards;
`;

const ringOut = keyframes`
  from { transform: translate(-50%, -50%) scale(0.12); opacity: 0.85; }
  to { transform: translate(-50%, -50%) scale(1.55); opacity: 0; }
`;

const ShockRing = styled.div`
  position: absolute;
  left: 50%;
  top: ${LOGO_CENTER_Y};
  z-index: 5;
  width: 860px;
  height: 860px;
  border-radius: 50%;
  pointer-events: none;
  border: 2px solid rgba(247, 249, 255, 0.5);
  box-shadow:
    0 0 46px 5px rgba(47, 128, 255, 0.32),
    inset 0 0 46px 5px rgba(255, 122, 24, 0.26);
  animation: ${ringOut} 0.9s cubic-bezier(0.16, 0.84, 0.3, 1) forwards;
  @media (prefers-reduced-motion: reduce) {
    display: none;
  }
`;

const ShockRingEcho = styled(ShockRing)`
  border-color: rgba(255, 154, 61, 0.35);
  box-shadow:
    0 0 40px 4px rgba(255, 122, 24, 0.24),
    inset 0 0 40px 4px rgba(47, 128, 255, 0.22);
  animation-duration: 1.1s;
  animation-delay: 0.12s;
  animation-fill-mode: both;
`;
