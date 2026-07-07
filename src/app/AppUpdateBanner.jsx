import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

// Over-the-wire update affordance for the main window. Backend checks the
// signed feed on its own schedule and emits forge-app-update-* events; this
// banner only surfaces them and triggers explicit download/restart actions. It
// never restarts the app without the user's idle-restart opt-in — terminals
// host live agent sessions.

const DISMISSED_VERSION_KEY = "forge-app-update-dismissed-version";

const Shell = styled.div`
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--forge-accent-rgb, 79, 163, 255), 0.35);
  background: #0d1117;
  color: #e6edf3;
  font-size: 12.5px;
  line-height: 1.35;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  max-width: 360px;
`;

const Label = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const Title = styled.span`
  font-weight: 600;
`;

const Detail = styled.span`
  color: #8b949e;
  font-size: 11.5px;
`;

const RestartButton = styled.button`
  flex: none;
  border: 1px solid rgba(var(--forge-accent-rgb, 79, 163, 255), 0.55);
  background: rgba(var(--forge-accent-rgb, 79, 163, 255), 0.16);
  color: var(--forge-accent, #4fa3ff);
  border-radius: 7px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(var(--forge-accent-rgb, 79, 163, 255), 0.26);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const DismissButton = styled.button`
  flex: none;
  border: none;
  background: transparent;
  color: #8b949e;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;

  &:hover {
    color: #e6edf3;
  }
`;

const AutoRow = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: #8b949e;
  font-size: 11px;
  cursor: pointer;
  user-select: none;

  input {
    accent-color: var(--forge-accent, #4fa3ff);
    margin: 0;
  }

  &:hover {
    color: #e6edf3;
  }
`;

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AppUpdateBanner() {
  const [update, setUpdate] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [stagedInstalled, setStagedInstalled] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED_VERSION_KEY) || "";
    } catch {
      return "";
    }
  });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let disposed = false;
    const unlistens = [];

    invoke("app_update_status")
      .then((status) => {
        if (disposed) return;
        if (status?.available && status?.version) {
          setUpdate({ version: status.version, notes: status.notes || "" });
        }
        if (status?.ready) {
          setStagedInstalled(Boolean(status?.staged?.installed));
          setPhase("ready");
        } else if (status?.installing) {
          setPhase("downloading");
        }
        setAutoRestart(Boolean(status?.autoRestartWhenIdle));
      })
      .catch(() => {});

    listen("forge-app-update-available", (event) => {
      const version = event?.payload?.version;
      if (!version) return;
      setUpdate({ version, notes: event?.payload?.notes || "" });
      if (phaseRef.current === "failed") setPhase("idle");
    }).then((unlisten) => unlistens.push(unlisten));

    listen("forge-app-update-progress", (event) => {
      const downloaded = event?.payload?.downloaded;
      const total = event?.payload?.total ?? null;
      if (typeof downloaded === "number") setProgress({ downloaded, total });
    }).then((unlisten) => unlistens.push(unlisten));

    listen("forge-app-update-state", (event) => {
      const state = event?.payload?.state;
      const version = event?.payload?.version;
      if (version) {
        setUpdate((current) => ({ version, notes: current?.notes || "" }));
      }
      if (state === "downloading") {
        setStagedInstalled(false);
        setProgress(null);
        setPhase("downloading");
      }
      if (state === "ready") {
        setStagedInstalled(Boolean(event?.payload?.installed));
        setPhase("ready");
      }
      if (state === "restarting") setPhase("restarting");
      if (state === "installed") setPhase("restarting");
      if (state === "failed") {
        setPhase("failed");
        setError(String(event?.payload?.error || "Update failed."));
      }
    }).then((unlisten) => unlistens.push(unlisten));

    return () => {
      disposed = true;
      for (const unlisten of unlistens) unlisten();
    };
  }, []);

  const startDownload = useCallback(() => {
    setPhase("downloading");
    setError("");
    setProgress(null);
    invoke("app_update_download")
      .then((status) => {
        if (status?.ready) {
          setStagedInstalled(Boolean(status?.staged?.installed));
          setPhase("ready");
        }
      })
      .catch((failure) => {
        setPhase("failed");
        setError(String(failure || "Update failed."));
      });
  }, []);

  const restartNow = useCallback(() => {
    setPhase("restarting");
    setError("");
    invoke("app_update_restart").catch((failure) => {
      setPhase("failed");
      setError(String(failure || "Update failed."));
    });
  }, []);

  const dismiss = useCallback(() => {
    if (!update?.version) return;
    setDismissedVersion(update.version);
    try {
      window.localStorage.setItem(DISMISSED_VERSION_KEY, update.version);
    } catch {}
  }, [update]);

  const toggleAutoRestart = useCallback((event) => {
    const enabled = Boolean(event.target.checked);
    setAutoRestart(enabled);
    invoke("app_update_settings_update", { autoRestartWhenIdle: enabled })
      .catch(() => setAutoRestart(!enabled));
  }, []);

  if (!update?.version) return null;
  if ((phase === "idle" || phase === "ready" || phase === "failed") && dismissedVersion === update.version) return null;

  if (phase === "downloading" || phase === "restarting") {
    const detail = phase === "restarting"
      ? "Restarting…"
      : progress
        ? progress.total
          ? `Downloading ${formatMegabytes(progress.downloaded)} / ${formatMegabytes(progress.total)}`
          : `Downloading ${formatMegabytes(progress.downloaded)}`
        : "Downloading…";
    return (
      <Shell role="status">
        <Label>
          <Title>Updating to Diff Forge {update.version}</Title>
          <Detail>{detail} Agents keep running until the restart.</Detail>
        </Label>
      </Shell>
    );
  }

  if (phase === "failed") {
    return (
      <Shell role="alert">
        <Label>
          <Title>Update to {update.version} failed</Title>
          <Detail>{error}</Detail>
        </Label>
        <RestartButton type="button" onClick={startDownload}>Retry</RestartButton>
        <DismissButton type="button" aria-label="Dismiss" onClick={dismiss}>×</DismissButton>
      </Shell>
    );
  }

  if (phase === "ready") {
    return (
      <Shell role="status">
        <Label>
          <Title>Diff Forge {update.version} is ready to restart</Title>
          <Detail>
            {stagedInstalled
              ? "Restart now, or quit and reopen later."
              : "Restart now to finish installing the downloaded update."}
          </Detail>
          <AutoRow>
            <input type="checkbox" checked={autoRestart} onChange={toggleAutoRestart} />
            Auto-restart when all terminals are idle
          </AutoRow>
        </Label>
        <RestartButton type="button" onClick={restartNow}>Restart now</RestartButton>
        <DismissButton type="button" aria-label="Dismiss" onClick={dismiss}>×</DismissButton>
      </Shell>
    );
  }

  return (
    <Shell role="status">
      <Label>
        <Title>Diff Forge {update.version} is available</Title>
        <Detail>Downloads in the background. Agents keep running until restart.</Detail>
        <AutoRow>
          <input type="checkbox" checked={autoRestart} onChange={toggleAutoRestart} />
          Auto-restart when all terminals are idle
        </AutoRow>
      </Label>
      <RestartButton type="button" onClick={startDownload}>Update</RestartButton>
      <DismissButton type="button" aria-label="Dismiss" onClick={dismiss}>×</DismissButton>
    </Shell>
  );
}
