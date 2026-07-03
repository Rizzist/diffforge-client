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
  TerminalRailIdentity,
  TerminalRailControls,
  TerminalRestartPill,
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
  return `Install runtime (${min}-${max} MB)`;
}

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const VmSandboxShell = styled.section`
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  background: #020304;
  color: #e8eef9;

  html[data-forge-theme="light"] & {
    background: #ffffff;
    color: #1e293b;
  }
`;

const VmSandboxHeader = styled(TerminalRestartPill)`
  [data-rail-row="secondary"] {
    width: 100%;
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
    row-gap: 1px;
  }
`;

const VmSandboxIdentity = styled(TerminalRailIdentity)`
  min-width: 0;
`;

const VmSandboxGlyph = styled.span`
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: rgba(134, 239, 172, 0.92);

  svg {
    width: 15px;
    height: 15px;
  }
`;

const VmSandboxTitleBlock = styled.span`
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 6px;

  strong {
    display: inline-block;
    max-width: min(18rem, 42cqi);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(226, 232, 240, 0.92);
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0;
    line-height: 1;
  }

  span {
    display: inline-flex;
    max-width: min(11rem, 28cqi);
    height: 18px;
    align-items: center;
    padding: 0 7px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 999px;
    color: rgba(154, 165, 181, 0.9);
    background: rgba(15, 23, 42, 0.48);
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0;
    line-height: 1;
    text-overflow: ellipsis;
    text-transform: lowercase;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & strong {
    color: rgba(48, 54, 68, 0.9);
  }

  html[data-forge-theme="light"] & span {
    border-color: rgba(99, 102, 118, 0.2);
    color: rgba(48, 54, 68, 0.82);
    background: rgba(255, 255, 255, 0.72);
  }
`;

const VmSandboxBody = styled.div`
  container: vm-sandbox-body / size;
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 12px;
  scrollbar-color: rgba(148, 163, 184, 0.48) transparent;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.5);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const VmSandboxContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(210px, 0.46fr);
  align-content: start;
  gap: 10px;
  width: 100%;
  min-height: min-content;
  max-width: none;
  margin: 0;

  @container vm-sandbox-body (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }

  @container vm-sandbox-body (max-height: 330px) {
    gap: 8px;
  }
`;

const VmSandboxRuntimePanel = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  gap: 10px;
  padding: 13px;
  border: 1px solid rgba(100, 116, 139, 0.28);
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: rgba(248, 250, 252, 0.86);
  }

  @container vm-sandbox-body (max-height: 330px) {
    gap: 8px;
    padding: 10px;
  }
`;

const VmSandboxKicker = styled.span`
  color: rgba(134, 239, 172, 0.88);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  html[data-forge-theme="light"] & {
    color: rgba(15, 118, 110, 0.92);
  }
`;

const VmSandboxHeadline = styled.h2`
  margin: 0;
  color: rgba(241, 245, 249, 0.96);
  font-size: 16px;
  font-weight: 880;
  line-height: 1.18;
  letter-spacing: 0;

  html[data-forge-theme="light"] & {
    color: #172033;
  }

  @container vm-sandbox-body (max-height: 330px) {
    font-size: 14px;
  }
`;

const VmSandboxCopy = styled.p`
  margin: 0;
  color: rgba(148, 163, 184, 0.9);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.38;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }

  @container vm-sandbox-body (max-height: 260px) {
    display: none;
  }
`;

const VmSandboxActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 2px;

  @container vm-sandbox-body (max-width: 420px) {
    align-items: stretch;
  }
`;

const VmSandboxPrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 32px;
  max-width: 100%;
  min-width: 0;
  padding: 0 11px;
  color: rgba(220, 252, 231, 0.96);
  border: 1px solid rgba(74, 222, 128, 0.36);
  border-radius: 7px;
  background: rgba(22, 101, 52, 0.32);
  cursor: pointer;
  font-size: 12px;
  font-weight: 850;
  letter-spacing: 0;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    transform 140ms ease;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }

  &:hover:not(:disabled) {
    border-color: rgba(134, 239, 172, 0.58);
    background: rgba(21, 128, 61, 0.38);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
  }

  html[data-forge-theme="light"] & {
    color: rgba(20, 83, 45, 0.95);
    border-color: rgba(22, 163, 74, 0.28);
    background: rgba(220, 252, 231, 0.7);
  }

  @container vm-sandbox-body (max-width: 420px) {
    flex: 1 1 180px;
  }
`;

const VmSandboxSecondaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 32px;
  min-width: 0;
  padding: 0 10px;
  color: rgba(226, 232, 240, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.48);
  cursor: pointer;
  font-size: 12px;
  font-weight: 820;
  letter-spacing: 0;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease,
    transform 140ms ease;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
  }

  &:hover:not(:disabled) {
    color: #fff;
    border-color: rgba(148, 163, 184, 0.38);
    background: rgba(30, 41, 59, 0.72);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
  }

  html[data-forge-theme="light"] & {
    color: rgba(30, 41, 59, 0.88);
    border-color: rgba(15, 23, 42, 0.12);
    background: rgba(255, 255, 255, 0.78);
  }

  @container vm-sandbox-body (max-width: 420px) {
    flex: 1 1 112px;
  }
`;

const VmSandboxProgress = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  margin-top: 0;
`;

const VmSandboxProgressHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  color: rgba(203, 213, 225, 0.86);
  font-size: 11px;
  font-weight: 800;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span:last-child {
    flex: 0 0 auto;
    color: rgba(226, 232, 240, 0.9);
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
  }

  html[data-forge-theme="light"] & span:last-child {
    color: #334155;
  }
`;

const VmSandboxProgressTrack = styled.div`
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(51, 65, 85, 0.62);

  html[data-forge-theme="light"] & {
    background: rgba(203, 213, 225, 0.72);
  }
`;

const VmSandboxProgressBar = styled.div`
  width: ${({ $percent }) => `${$percent ?? 18}%`};
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #60a5fa, #22c55e);
  transition: width 160ms ease;
`;

const VmSandboxStatusPanel = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  gap: 10px;
  padding: 13px;
  border: 1px solid rgba(100, 116, 139, 0.24);
  border-radius: 8px;
  background: rgba(6, 10, 18, 0.62);

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: rgba(248, 250, 252, 0.7);
  }

  @container vm-sandbox-body (max-height: 330px) {
    gap: 8px;
    padding: 10px;
  }
`;

const VmSandboxStatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  min-height: 24px;
  max-width: 100%;
  padding: 0 9px;
  color: rgba(226, 232, 240, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.5);
  font-size: 11px;
  font-weight: 850;

  &[data-tone="ready"] {
    color: rgba(187, 247, 208, 0.96);
    border-color: rgba(74, 222, 128, 0.3);
    background: rgba(22, 101, 52, 0.24);
  }

  &[data-tone="warning"] {
    color: rgba(254, 215, 170, 0.96);
    border-color: rgba(251, 146, 60, 0.32);
    background: rgba(124, 45, 18, 0.22);
  }

  &[data-tone="error"] {
    color: rgba(254, 202, 202, 0.96);
    border-color: rgba(248, 113, 113, 0.32);
    background: rgba(127, 29, 29, 0.24);
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
  }

  html[data-forge-theme="light"] & {
    color: rgba(30, 41, 59, 0.86);
    border-color: rgba(15, 23, 42, 0.12);
    background: rgba(255, 255, 255, 0.72);
  }

  html[data-forge-theme="light"] &[data-tone="ready"] {
    color: rgba(22, 101, 52, 0.95);
    border-color: rgba(22, 163, 74, 0.22);
    background: rgba(220, 252, 231, 0.66);
  }

  html[data-forge-theme="light"] &[data-tone="warning"] {
    color: rgba(154, 52, 18, 0.95);
    border-color: rgba(249, 115, 22, 0.22);
    background: rgba(255, 237, 213, 0.72);
  }

  html[data-forge-theme="light"] &[data-tone="error"] {
    color: rgba(127, 29, 29, 0.95);
    border-color: rgba(220, 38, 38, 0.22);
    background: rgba(254, 226, 226, 0.72);
  }
`;

const VmSandboxSpinner = styled.i`
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(147, 197, 253, 0.35);
  border-top-color: #93c5fd;
  border-radius: 999px;
  animation: ${spin} 780ms linear infinite;
`;

const VmSandboxDetails = styled.dl`
  display: grid;
  grid-template-columns: minmax(58px, auto) minmax(0, 1fr);
  gap: 7px 10px;
  margin: 0;

  dt {
    color: rgba(148, 163, 184, 0.76);
    font-size: 11px;
    font-weight: 820;
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: rgba(226, 232, 240, 0.88);
    font-size: 11px;
    font-weight: 730;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & dt {
    color: #64748b;
  }

  html[data-forge-theme="light"] & dd {
    color: #334155;
  }

  @container vm-sandbox-body (max-width: 420px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;

    dd {
      margin-bottom: 5px;
    }
  }
`;

const VmSandboxPreview = styled.div`
  display: grid;
  align-items: center;
  min-height: 72px;
  padding: 11px;
  border: 1px dashed rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  background: rgba(2, 6, 12, 0.34);
  text-align: left;

  strong {
    display: block;
    margin-bottom: 4px;
    color: rgba(241, 245, 249, 0.92);
    font-size: 12px;
    font-weight: 850;
  }

  span {
    display: block;
    color: rgba(148, 163, 184, 0.82);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.32;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.12);
    background: rgba(255, 255, 255, 0.7);
  }

  html[data-forge-theme="light"] & strong {
    color: #1e293b;
  }

  html[data-forge-theme="light"] & span {
    color: #64748b;
  }

  @container vm-sandbox-body (max-height: 330px) {
    min-height: 0;
    padding: 9px;
  }

  @container vm-sandbox-body (max-height: 245px) {
    display: none;
  }
`;

const VmSandboxError = styled.div`
  padding: 9px 10px;
  color: rgba(254, 202, 202, 0.94);
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: 7px;
  background: rgba(127, 29, 29, 0.2);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.38;

  html[data-forge-theme="light"] & {
    color: rgba(127, 29, 29, 0.94);
    border-color: rgba(220, 38, 38, 0.18);
    background: rgba(254, 226, 226, 0.72);
  }
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
        <TerminalRailControls data-rail-row="primary">
          <TerminalCloseButton
            aria-label="Close VM Sandbox panel"
            onClick={() => onClose?.(terminalIndex, paneId)}
            title="Close VM Sandbox panel"
            type="button"
          >
            <ButtonCloseIcon aria-hidden="true" />
          </TerminalCloseButton>
        </TerminalRailControls>
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
        </TerminalRailControls>
      </VmSandboxHeader>

      <VmSandboxBody>
        <VmSandboxContent>
          <VmSandboxRuntimePanel>
            <VmSandboxKicker>Runtime</VmSandboxKicker>
            <VmSandboxHeadline>
              {runtimeReady ? "Ready for VM images" : "Runtime not installed"}
            </VmSandboxHeadline>
            <VmSandboxCopy>
              {runtimeReady
                ? `${runtimeStatus?.runtimeName || "QEMU"} is available on this device.`
                : runtimeStatus?.runtimeInstallHint || "Install the local VM runtime before creating images."}
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
                    ? "Created and imported images will appear here."
                    : "Install or configure the runtime first."}
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
