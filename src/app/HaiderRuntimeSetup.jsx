import styled, { css, keyframes } from "styled-components";

import { C } from "../auth/theme.js";
import { doneView, progressView } from "./haiderRuntimeSetupModel.js";

/* Presentational surfaces for the pre-login Haider runtime setup gate
   (F1-UI). Both render ABOVE the AuthFlow ceremony (which AppShell holds at
   its particle "boot" backdrop while the gate is active) and are laid out
   in the same card zone beneath the logo, so the moment reads as one
   ceremony. No invokes live here — the useHaiderRuntimeSetup hook owns the
   wire and this file renders only what the commands actually returned:
   versions, paths, byte counters and daemon outcomes are verbatim facts or
   they are absent. */

export default function HaiderRuntimeSetupScreen({
  state,
  onInstall,
  onRetry,
  onContinueWithout,
  onTitleBarMouseDown = null,
}) {
  const { stage, status, failure } = state;
  const progress = progressView(state);
  const outcome = doneView(state);

  return (
    <Layer>
      {onTitleBarMouseDown && <DragStrip aria-hidden="true" onMouseDown={onTitleBarMouseDown} />}
      <CardZone>
        {stage === "checking" && (
          <Card>
            <StatusLine>
              Checking for the Haider runtime
              <Dots>
                <i />
                <i />
                <i />
              </Dots>
            </StatusLine>
          </Card>
        )}

        {stage === "needed" && (
          <Card>
            <Title>Set up the Haider runtime</Title>
            <Copy>
              Diff Forge runs coding agents through Haider, a small local
              runtime and daemon installed on this machine. It is not
              installed yet — install it now, or continue without it and set
              it up later.
            </Copy>
            {status?.installPath ? <PathHint>Installs to {status.installPath}</PathHint> : null}
            <PrimaryBtn onClick={onInstall} type="button">
              Install Haider runtime
            </PrimaryBtn>
            <CancelLink onClick={onContinueWithout} type="button">
              Continue without it
            </CancelLink>
          </Card>
        )}

        {stage === "installing" && (
          <Card>
            <Title>Installing the Haider runtime</Title>
            <StatusLine>
              {progress.phaseLabel}
              <Dots>
                <i />
                <i />
                <i />
              </Dots>
            </StatusLine>
            <ProgressTrack
              aria-label="Install progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress.percent ?? undefined}
              role="progressbar"
            >
              <ProgressFill
                $indeterminate={progress.percent == null}
                style={progress.percent == null ? undefined : { width: `${progress.percent}%` }}
              />
            </ProgressTrack>
            {progress.downloadedText && (
              <ByteLine>
                {progress.totalText
                  ? `${progress.downloadedText} of ${progress.totalText}`
                  : `${progress.downloadedText} so far`}
              </ByteLine>
            )}
          </Card>
        )}

        {stage === "starting" && (
          <Card>
            <Title>Starting the Haider daemon</Title>
            {outcome.installedVersion && <Copy>Installed {outcome.installedVersion}.</Copy>}
            <StatusLine>
              Waiting for the daemon
              <Dots>
                <i />
                <i />
                <i />
              </Dots>
            </StatusLine>
          </Card>
        )}

        {stage === "done" && (
          <Card>
            <Title>Haider runtime installed</Title>
            {outcome.installedVersion && <Copy>Installed {outcome.installedVersion}.</Copy>}
            {/* Daemon lines render ONLY what haider_daemon_start returned; a
                reported start error is never hidden, and restart_needed is a
                conservative flag (it also covers unknown endpoint health), so
                its wording stays conditional instead of asserting a previous
                daemon exists or is live. */}
            {outcome.daemon === "start_error" ? (
              <ErrorCopy>The daemon did not confirm it is running: {outcome.startError}</ErrorCopy>
            ) : outcome.daemon === "started" ? (
              <Copy>The daemon started and is reachable.</Copy>
            ) : outcome.daemon === "already_running" ? (
              <Copy>A daemon was already reachable.</Copy>
            ) : null}
            {outcome.restartPending && (
              <Copy>
                A daemon restart may still be pending — if a daemon was already
                running, it keeps serving the previous version until it
                restarts.
              </Copy>
            )}
            <Hint>Continuing to sign-in…</Hint>
          </Card>
        )}

        {stage === "failed" && (
          <Card>
            <Title>Setup did not finish</Title>
            <ErrorCopy>{failure?.message}</ErrorCopy>
            {failure?.code && <Hint>Error code: {failure.code}</Hint>}
            {failure?.retryable === true && (
              <PrimaryBtn onClick={onRetry} type="button">
                Retry
              </PrimaryBtn>
            )}
            <CancelLink onClick={onContinueWithout} type="button">
              Continue without it
            </CancelLink>
          </Card>
        )}
      </CardZone>
    </Layer>
  );
}

/* Non-blocking notice for the "unknown" stage: the status check failed, so
   nothing is claimed about the runtime — login stays fully usable and setup
   remains one click away. */
export function HaiderRuntimeSetupNotice({ state, onInstall, onDismiss }) {
  return (
    <Notice role="status">
      <NoticeCopy>
        Could not check whether the Haider runtime is installed
        {state?.statusError?.message ? ` (${state.statusError.message})` : ""}.
        You can set it up now or continue to sign-in.
      </NoticeCopy>
      <NoticeActions>
        <NoticeBtn onClick={onInstall} type="button">
          Set up Haider
        </NoticeBtn>
        <NoticeLink onClick={onDismiss} type="button">
          Dismiss
        </NoticeLink>
      </NoticeActions>
    </Notice>
  );
}

/* ---- styles (kin to src/auth/AuthFlow.jsx) --------------------------- */

/* AuthFlow's Stage sits at z-index 1000; the gate rides just above it.
   Transparent layer: the particle boot backdrop beneath stays visible. */
const Layer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: ${C.text};
  font-family: inherit;
`;

const DragStrip = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
`;

/* Mirrors AuthFlow's logo box + card zone offsets so the card lands where
   the entry card would. */
const CardZone = styled.div`
  margin-top: calc(12vh + min(300px, 72vw) + 55px);
  display: flex;
  justify-content: center;
`;

const cardIn = keyframes`
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
`;

const Card = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: min(340px, 84vw);
  animation: ${cardIn} 0.5s cubic-bezier(0.2, 0.9, 0.25, 1) both;
`;

const Title = styled.div`
  font-size: 17px;
  font-weight: 600;
  color: ${C.white};
`;

const Copy = styled.p`
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  text-align: center;
  color: ${C.textDim};
`;

const ErrorCopy = styled(Copy)`
  color: ${C.orangeBright};
`;

const PathHint = styled.div`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: ${C.textMuted};
`;

const Hint = styled.div`
  font-size: 12px;
  color: ${C.textMuted};
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
  }
  &:active {
    transform: translateY(0) scale(0.99);
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

const ByteLine = styled.div`
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: ${C.textMuted};
`;

const ProgressTrack = styled.div`
  width: 276px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: ${C.panel};
  border: 1px solid ${C.line};
`;

const indeterminateSlide = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(300%); }
`;

const ProgressFill = styled.div`
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, ${C.blue}, ${C.orange});
  transition: width 0.25s ease;
  ${(p) =>
    p.$indeterminate &&
    css`
      width: 34%;
      animation: ${indeterminateSlide} 1.4s ease-in-out infinite;
    `}
`;

const noticeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const Notice = styled.div`
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(420px, 90vw);
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid ${C.line};
  background: ${C.panelRaised};
  animation: ${noticeIn} 0.4s ease both;
`;

const NoticeCopy = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: ${C.textDim};
`;

const NoticeActions = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`;

const NoticeBtn = styled.button`
  appearance: none;
  border: 1px solid ${C.lineStrong};
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: ${C.text};
  cursor: pointer;
  background: ${C.panelBright};
  &:hover {
    border-color: ${C.lineBlue};
  }
`;

const NoticeLink = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  color: ${C.textMuted};
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  &:hover {
    color: ${C.text};
  }
`;
