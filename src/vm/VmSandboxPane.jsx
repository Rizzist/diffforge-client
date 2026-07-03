import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle } from "@styled-icons/material-rounded/CheckCircle";
import { Computer } from "@styled-icons/material-rounded/Computer";
import { Download } from "@styled-icons/material-rounded/Download";
import { ErrorOutline } from "@styled-icons/material-rounded/ErrorOutline";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";

import {
  ButtonCloseIcon,
  ButtonDragIcon,
  ButtonFullscreenExitIcon,
  ButtonFullscreenIcon,
  ButtonRefreshIcon,
  ButtonSplitHorizontalIcon,
  ButtonSplitVerticalIcon,
  TerminalCloseButton,
  TerminalRailControls,
  TerminalRestartButton,
} from "../app/appStyles";

export const VM_SANDBOX_RUNTIME_PROGRESS_EVENT = "forge-vm-sandbox-runtime-progress";

function getVmSandboxErrorMessage(error, fallback = "VM Sandbox runtime action failed.") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error.message === "string") return error.message;
  return fallback;
}

function formatVmSandboxBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(0)} KB`;
  }
  return `${value} B`;
}

function normalizeVmSandboxPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, percent));
}

function getVmSandboxInstallText(status) {
  const min = Number(status?.approximateDownloadMbMin || 80);
  const max = Number(status?.approximateDownloadMbMax || 180);
  return `Install VM Sandbox runtime: about ${min}-${max} MB`;
}

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const VmSandboxShell = styled.section`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  background:
    radial-gradient(circle at 16% 0%, rgba(45, 212, 191, 0.13), transparent 34%),
    radial-gradient(circle at 86% 8%, rgba(96, 165, 250, 0.12), transparent 32%),
    #070b12;
  border: 1px solid rgba(90, 111, 140, 0.38);
  color: #e8eef9;

  &[data-active="true"] {
    border-color: rgba(106, 156, 255, 0.65);
  }
`;

const VmSandboxHeader = styled.header`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
  row-gap: 2px;
  min-height: 58px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(98, 116, 148, 0.28);
  background: rgba(6, 9, 15, 0.8);

  [data-rail-row="secondary"] {
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
    justify-content: flex-start;
  }
`;

const VmSandboxIdentity = styled.div`
  display: flex;
  grid-column: 1 / -1;
  grid-row: 1;
  align-items: center;
  min-width: 0;
  gap: 10px;
`;

const VmSandboxGlyph = styled.span`
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  color: #86efac;
  border: 1px solid rgba(134, 239, 172, 0.35);
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.12);

  svg {
    width: 19px;
    height: 19px;
  }
`;

const VmSandboxTitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong {
    overflow: hidden;
    color: #f3f7ff;
    font-size: 18px;
    font-weight: 800;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: #92a0b6;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const VmSandboxBody = styled.div`
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: clamp(16px, 3vw, 30px);
`;

const VmSandboxContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(240px, 0.65fr);
  gap: 16px;
  width: 100%;
  max-width: 1100px;
  margin: auto;

  @media (max-width: 860px) {
    grid-template-columns: minmax(0, 1fr);
    margin: 0;
  }
`;

const VmSandboxRuntimePanel = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 260px;
  padding: clamp(18px, 3vw, 26px);
  border: 1px solid rgba(106, 126, 158, 0.35);
  border-radius: 8px;
  background: rgba(10, 15, 25, 0.74);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
`;

const VmSandboxKicker = styled.span`
  color: #86efac;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const VmSandboxHeadline = styled.h2`
  margin: 12px 0 8px;
  color: #f7faff;
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 900;
  line-height: 1.04;
  letter-spacing: 0;
`;

const VmSandboxCopy = styled.p`
  max-width: 640px;
  margin: 0;
  color: #a6b1c5;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
`;

const VmSandboxActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
`;

const VmSandboxPrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  max-width: 100%;
  padding: 0 16px;
  color: #06110d;
  border: 1px solid rgba(134, 239, 172, 0.65);
  border-radius: 8px;
  background: linear-gradient(135deg, #86efac, #5eead4);
  cursor: pointer;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0;
  white-space: normal;

  svg {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
`;

const VmSandboxSecondaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 14px;
  color: #d8e2f1;
  border: 1px solid rgba(120, 140, 170, 0.5);
  border-radius: 8px;
  background: rgba(13, 19, 31, 0.86);
  cursor: pointer;
  font-size: 13px;
  font-weight: 850;
  letter-spacing: 0;

  svg {
    width: 19px;
    height: 19px;
    flex: 0 0 auto;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
`;

const VmSandboxProgress = styled.div`
  display: grid;
  gap: 8px;
  margin-top: 18px;
`;

const VmSandboxProgressHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #c8d4e8;
  font-size: 12px;
  font-weight: 800;
`;

const VmSandboxProgressTrack = styled.div`
  height: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(65, 76, 96, 0.78);
`;

const VmSandboxProgressBar = styled.div`
  width: ${({ $percent }) => `${$percent ?? 18}%`};
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #60a5fa, #5eead4, #86efac);
  transition: width 160ms ease;
`;

const VmSandboxStatusPanel = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 12px;
  padding: clamp(16px, 2.5vw, 22px);
  border: 1px solid rgba(106, 126, 158, 0.3);
  border-radius: 8px;
  background: rgba(6, 10, 18, 0.7);
`;

const VmSandboxStatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 7px;
  min-height: 30px;
  padding: 0 10px;
  color: #d9e5f7;
  border: 1px solid rgba(120, 140, 170, 0.45);
  border-radius: 999px;
  background: rgba(18, 26, 40, 0.88);
  font-size: 12px;
  font-weight: 900;

  &[data-tone="ready"] {
    color: #bbf7d0;
    border-color: rgba(74, 222, 128, 0.45);
    background: rgba(22, 101, 52, 0.22);
  }

  &[data-tone="warning"] {
    color: #fed7aa;
    border-color: rgba(251, 146, 60, 0.45);
    background: rgba(124, 45, 18, 0.24);
  }

  &[data-tone="error"] {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.45);
    background: rgba(127, 29, 29, 0.28);
  }

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }
`;

const VmSandboxSpinner = styled.i`
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(147, 197, 253, 0.35);
  border-top-color: #93c5fd;
  border-radius: 999px;
  animation: ${spin} 780ms linear infinite;
`;

const VmSandboxDetails = styled.dl`
  display: grid;
  grid-template-columns: minmax(82px, auto) minmax(0, 1fr);
  gap: 9px 12px;
  margin: 0;

  dt {
    color: #7f8da6;
    font-size: 12px;
    font-weight: 850;
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: #d8e4f7;
    font-size: 12px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const VmSandboxPreview = styled.div`
  display: grid;
  place-items: center;
  min-height: 150px;
  padding: 18px;
  border: 1px dashed rgba(120, 140, 170, 0.36);
  border-radius: 8px;
  background:
    linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px),
    rgba(3, 7, 14, 0.48);
  background-size: 28px 28px;
  text-align: center;

  strong {
    display: block;
    margin-bottom: 6px;
    color: #f0f5ff;
    font-size: 15px;
    font-weight: 900;
  }

  span {
    display: block;
    color: #8795ad;
    font-size: 12px;
    font-weight: 750;
    line-height: 1.4;
  }
`;

const VmSandboxError = styled.div`
  margin-top: 16px;
  padding: 12px 14px;
  color: #fecaca;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 8px;
  background: rgba(127, 29, 29, 0.22);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.45;
`;

export default function VmSandboxPane({
  dragActive = false,
  fullscreenActive = false,
  isActive = false,
  isFullscreen = false,
  onClose = null,
  onDragHandlePointerDown = null,
  onSplit = null,
  onToggleFullscreen = null,
  paneId = "",
  paneLimitReached = false,
  terminalIndex,
  workspaceId = "",
}) {
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [statusState, setStatusState] = useState("loading");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");

  const runtimeReady = Boolean(runtimeStatus?.runtimeInstalled || runtimeStatus?.installed);
  const installable = Boolean(runtimeStatus?.runtimeInstallable);
  const progressPercent = normalizeVmSandboxPercent(progress?.percent);
  const statusTone = error ? "error" : runtimeReady ? "ready" : "warning";
  const splitTitle = paneLimitReached ? "Panel limit reached" : "Split VM Sandbox panel";
  const runtimeSubtitle = runtimeReady
    ? `${runtimeStatus?.runtimeName || "QEMU"} ready`
    : installing
      ? "Installing runtime"
      : "Runtime required";

  const statusLabel = useMemo(() => {
    if (error) return "Action needed";
    if (runtimeReady) return runtimeStatus?.externalRuntime ? "External runtime" : "Runtime ready";
    if (installing) return "Installing";
    if (statusState === "loading") return "Checking runtime";
    return "Runtime missing";
  }, [error, installing, runtimeReady, runtimeStatus?.externalRuntime, statusState]);

  const loadRuntimeStatus = useCallback(async () => {
    setStatusState("loading");
    setError("");
    try {
      const nextStatus = await invoke("vm_sandbox_runtime_status");
      setRuntimeStatus(nextStatus);
      setStatusState("ready");
    } catch (statusError) {
      setStatusState("error");
      setError(getVmSandboxErrorMessage(statusError, "Unable to check VM Sandbox runtime."));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    listen(VM_SANDBOX_RUNTIME_PROGRESS_EVENT, (event) => {
      if (disposed) return;
      const payload = event?.payload || {};
      setProgress(payload);
      if (payload.state === "done" || payload.state === "installed") {
        setInstalling(false);
        void loadRuntimeStatus();
      } else if (payload.state === "runtime-missing") {
        setInstalling(false);
      } else if (payload.state) {
        setInstalling(true);
      }
    }).then((handler) => {
      if (disposed) {
        handler();
      } else {
        unlisten = handler;
      }
    }).catch(() => {});

    void loadRuntimeStatus();

    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, [loadRuntimeStatus]);

  const installRuntime = useCallback(async () => {
    if (installing || !installable) {
      return;
    }
    setInstalling(true);
    setError("");
    setProgress({
      state: "starting",
      downloadedBytes: 0,
      totalBytes: null,
      percent: null,
      message: "Starting VM Sandbox runtime install.",
    });
    try {
      const nextStatus = await invoke("vm_sandbox_install_runtime");
      setRuntimeStatus(nextStatus);
      setInstalling(false);
      if (!nextStatus?.runtimeInstalled && !nextStatus?.installed) {
        setError(nextStatus?.runtimeInstallHint || "VM Sandbox runtime is not available yet.");
      }
    } catch (installError) {
      setInstalling(false);
      setError(getVmSandboxErrorMessage(installError, "Unable to install VM Sandbox runtime."));
    }
  }, [installable, installing]);

  const progressMessage = progress?.message
    || runtimeStatus?.runtimeInstallHint
    || "VM Sandbox runtime is checked locally.";
  const progressBytes = progress?.downloadedBytes
    ? `${formatVmSandboxBytes(progress.downloadedBytes)}${progress.totalBytes ? ` / ${formatVmSandboxBytes(progress.totalBytes)}` : ""}`
    : "";

  return (
    <VmSandboxShell
      data-active={isActive ? "true" : "false"}
      data-drag-active={dragActive ? "true" : undefined}
      data-workspace-vm-shell="true"
    >
      <VmSandboxHeader data-terminal-control="true">
        <VmSandboxIdentity>
          <TerminalRestartButton
            aria-label="Drag VM Sandbox panel"
            data-terminal-drag-handle="true"
            disabled={isFullscreen}
            onPointerDown={(event) => onDragHandlePointerDown?.(event, terminalIndex, paneId)}
            title={isFullscreen ? "Exit fullscreen to reorder panels" : "Drag VM Sandbox panel"}
            type="button"
          >
            <ButtonDragIcon aria-hidden="true" />
          </TerminalRestartButton>
          <VmSandboxGlyph aria-hidden="true">
            <Computer />
          </VmSandboxGlyph>
          <VmSandboxTitleBlock>
            <strong>VM Sandbox</strong>
            <span>{runtimeSubtitle}</span>
          </VmSandboxTitleBlock>
        </VmSandboxIdentity>
        <TerminalRailControls data-rail-row="secondary">
          <TerminalRestartButton
            aria-label="Recheck VM Sandbox runtime"
            disabled={statusState === "loading" || installing}
            onClick={loadRuntimeStatus}
            title="Recheck VM Sandbox runtime"
            type="button"
          >
            <ButtonRefreshIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Split VM Sandbox panel horizontally"
            disabled={paneLimitReached}
            onClick={() => onSplit?.({ direction: "vertical", paneId, terminalIndex, workspaceId })}
            title={splitTitle}
            type="button"
          >
            <ButtonSplitHorizontalIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Split VM Sandbox panel vertically"
            disabled={paneLimitReached}
            onClick={() => onSplit?.({ direction: "horizontal", paneId, terminalIndex, workspaceId })}
            title={splitTitle}
            type="button"
          >
            <ButtonSplitVerticalIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label={isFullscreen ? "Restore VM Sandbox panel" : "Maximize VM Sandbox panel"}
            disabled={fullscreenActive && !isFullscreen}
            onClick={() => onToggleFullscreen?.(terminalIndex, paneId)}
            title={isFullscreen ? "Restore VM Sandbox panel" : "Maximize VM Sandbox panel"}
            type="button"
          >
            {isFullscreen ? (
              <ButtonFullscreenExitIcon aria-hidden="true" />
            ) : (
              <ButtonFullscreenIcon aria-hidden="true" />
            )}
          </TerminalRestartButton>
          <TerminalCloseButton
            aria-label="Close VM Sandbox panel"
            onClick={() => onClose?.(terminalIndex, paneId)}
            title="Close VM Sandbox panel"
            type="button"
          >
            <ButtonCloseIcon aria-hidden="true" />
          </TerminalCloseButton>
        </TerminalRailControls>
      </VmSandboxHeader>

      <VmSandboxBody>
        <VmSandboxContent>
          <VmSandboxRuntimePanel>
            <VmSandboxKicker>Local virtual machine broker</VmSandboxKicker>
            <VmSandboxHeadline>
              {runtimeReady ? "Runtime ready for VM images." : "Install the runtime on first use."}
            </VmSandboxHeadline>
            <VmSandboxCopy>
              {runtimeReady
                ? "Diff Forge found QEMU on this device. VM images can use this broker without adding the runtime to the app bundle."
                : runtimeStatus?.runtimeInstallHint || "Diff Forge ships the panel only. The VM runtime is downloaded or installed when you ask for it."}
            </VmSandboxCopy>

            <VmSandboxActionRow>
              <VmSandboxPrimaryButton
                disabled={runtimeReady || installing || !installable}
                onClick={installRuntime}
                title={runtimeReady ? "Runtime already installed" : installable ? getVmSandboxInstallText(runtimeStatus) : "Runtime installer is not configured for this device"}
                type="button"
              >
                {installing ? <VmSandboxSpinner aria-hidden="true" /> : <Download aria-hidden="true" />}
                <span>{runtimeReady ? "Runtime installed" : getVmSandboxInstallText(runtimeStatus)}</span>
              </VmSandboxPrimaryButton>
              <VmSandboxSecondaryButton
                disabled={statusState === "loading" || installing}
                onClick={loadRuntimeStatus}
                type="button"
              >
                <ButtonRefreshIcon aria-hidden="true" />
                <span>Recheck</span>
              </VmSandboxSecondaryButton>
            </VmSandboxActionRow>

            {(installing || progress || !runtimeReady) && (
              <VmSandboxProgress aria-live="polite">
                <VmSandboxProgressHeader>
                  <span>{progressMessage}</span>
                  <span>{progressBytes || (progressPercent === null ? "" : `${Math.round(progressPercent)}%`)}</span>
                </VmSandboxProgressHeader>
                <VmSandboxProgressTrack aria-hidden="true">
                  <VmSandboxProgressBar $percent={progressPercent} />
                </VmSandboxProgressTrack>
              </VmSandboxProgress>
            )}

            {error && <VmSandboxError>{error}</VmSandboxError>}
          </VmSandboxRuntimePanel>

          <VmSandboxStatusPanel>
            <VmSandboxStatusBadge data-tone={statusTone}>
              {installing ? (
                <VmSandboxSpinner aria-hidden="true" />
              ) : runtimeReady ? (
                <CheckCircle aria-hidden="true" />
              ) : error ? (
                <ErrorOutline aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              <span>{statusLabel}</span>
            </VmSandboxStatusBadge>

            <VmSandboxDetails>
              <dt>Runtime</dt>
              <dd title={runtimeStatus?.runtimeName || "QEMU"}>{runtimeStatus?.runtimeName || "QEMU"}</dd>
              <dt>Path</dt>
              <dd title={runtimeStatus?.runtimePath || ""}>{runtimeStatus?.runtimePath || "Not installed"}</dd>
              <dt>Host</dt>
              <dd>{[runtimeStatus?.hostOs, runtimeStatus?.hostArch].filter(Boolean).join(" / ") || "Checking"}</dd>
              <dt>Accel</dt>
              <dd>{runtimeStatus?.accelerator || "Checking"}</dd>
              <dt>Source</dt>
              <dd>{runtimeStatus?.externalRuntime ? "PATH/system" : runtimeStatus?.managedRuntimeInstalled ? "Managed" : "First use"}</dd>
            </VmSandboxDetails>

            <VmSandboxPreview>
              <div>
                <strong>{runtimeReady ? "No VM images yet" : "Runtime not ready"}</strong>
                <span>
                  {runtimeReady
                    ? "Linux, Windows, and imported image workflows can be enabled on top of this runtime broker."
                    : "Install or configure the runtime before creating a VM image."}
                </span>
              </div>
            </VmSandboxPreview>

            <VmSandboxSecondaryButton disabled={!runtimeReady} type="button">
              <PlayArrow aria-hidden="true" />
              <span>New Linux VM</span>
            </VmSandboxSecondaryButton>
          </VmSandboxStatusPanel>
        </VmSandboxContent>
      </VmSandboxBody>
    </VmSandboxShell>
  );
}
