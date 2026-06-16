import { invoke } from "@tauri-apps/api/core";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { Article } from "@styled-icons/material-rounded/Article";
import { Pause } from "@styled-icons/material-rounded/Pause";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { Stop } from "@styled-icons/material-rounded/Stop";

import {
  ButtonBotIcon,
  ButtonCodeIcon,
  ButtonDeleteIcon,
  ButtonHubIcon,
  ButtonProcessIcon,
  ButtonRefreshIcon,
  ButtonTerminalIcon,
  FormMessage,
  PageSubline,
  PanelHeading,
  PanelKicker,
  PrimaryDangerButton,
  SecondaryButton,
  SettingsHint,
} from "../app/appStyles";

const ENERGY_REFRESH_MS = 15000;
const DOCKER_REFRESH_MS = 15000;
const DEEP_SCAN_PORTS_ENABLED = false;
const HIGH_CPU_PERCENT = 65;
const HIGH_MEMORY_BYTES = 1024 * 1024 * 1024;
const PROCESS_BUSY_SPINNER_SEGMENTS = Array.from({ length: 8 }, (_, index) => index);
const DOCKER_ACTIONS = {
  rebuildRelaunch: {
    buttonLabel: "Rebuild",
    detail: "Bring linked Docker Compose projects down, then rebuild and recreate services.",
    label: "Rebuild/relaunch Docker",
    pendingLabel: "Rebuilding...",
    title: "Rebuild and relaunch",
  },
  relaunch: {
    buttonLabel: "Relaunch",
    detail: "Restart linked Docker containers or Compose services.",
    label: "Relaunch Docker",
    pendingLabel: "Relaunching...",
    title: "Relaunch",
  },
  remountData: {
    buttonLabel: "Clean slate",
    detail: "Remove linked Compose data volumes, then rebuild and relaunch.",
    label: "Remount Docker data",
    pendingLabel: "Remounting...",
    title: "Clean-slate data remount",
  },
};

function errorMessage(error, fallback = "Unable to load processes.") {
  if (typeof error === "string") {
    return error;
  }
  if (error?.message) {
    return error.message;
  }
  return fallback;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }

  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatCpu(value) {
  const cpu = Number(value || 0);
  if (!Number.isFinite(cpu) || cpu <= 0) {
    return "0%";
  }
  return cpu >= 100 ? `${Math.round(cpu)}%` : `${cpu.toFixed(1)}%`;
}

function formatEnergy(value) {
  const score = Number(value || 0);
  if (!Number.isFinite(score) || score <= 0) {
    return "0.0";
  }
  return score >= 100 ? `${Math.round(score)}` : score.toFixed(1);
}

function energyTone(value) {
  const score = Number(value || 0);
  if (score >= 20) {
    return "hot";
  }
  if (score >= 6) {
    return "warm";
  }
  if (score >= 1) {
    return "active";
  }
  return "neutral";
}

function formatProcessPlural(count) {
  const value = Number(count || 0);
  return `${value} process${value === 1 ? "" : "es"}`;
}

function normalizeProcessRoots(workspaceRoots) {
  const seen = new Set();
  return (Array.isArray(workspaceRoots) ? workspaceRoots : [])
    .map((root) => String(root || "").trim())
    .filter(Boolean)
    .filter((root) => {
      const key = root.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function isDockerProcess(process) {
  const haystack = [
    process.groupKind,
    process.groupId,
    process.groupLabel,
    process.displayName,
    process.name,
    process.command,
    process.executable,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return haystack.includes("docker") || haystack.includes("containerd");
}

function isHighUsage(process) {
  return Number(process.cpuPercent || 0) >= HIGH_CPU_PERCENT
    || Number(process.memoryBytes || 0) >= HIGH_MEMORY_BYTES;
}

function processBoundPorts(process) {
  return Array.isArray(process?.boundPorts) ? process.boundPorts : [];
}

function mergeProcessPorts(processes) {
  const ports = new Map();

  for (const process of processes) {
    for (const port of processBoundPorts(process)) {
      const portNumber = Number(port?.port || 0);
      if (!Number.isInteger(portNumber) || portNumber <= 0) {
        continue;
      }
      const protocol = String(port?.protocol || "tcp").toLowerCase();
      const address = String(port?.address || "*");
      const key = `${protocol}:${address}:${portNumber}`;
      ports.set(key, {
        address,
        port: portNumber,
        protocol,
      });
    }
  }

  return Array.from(ports.values()).sort((left, right) => (
    Number(left.port || 0) - Number(right.port || 0)
    || String(left.protocol || "").localeCompare(String(right.protocol || ""))
    || String(left.address || "").localeCompare(String(right.address || ""))
  ));
}

function processPortLabel(process) {
  const ports = processBoundPorts(process);
  if (!ports.length) {
    return "";
  }
  const first = ports[0];
  const suffix = ports.length > 1 ? ` +${ports.length - 1}` : "";
  return `:${first.port}${suffix}`;
}

function processPortTitle(process) {
  const ports = processBoundPorts(process);
  if (!ports.length) {
    return "";
  }
  return ports
    .map((port) => {
      const protocol = String(port.protocol || "tcp").toUpperCase();
      const address = String(port.address || "*");
      return `${protocol} ${address}:${port.port}`;
    })
    .join("\n");
}

function processStableKey(process) {
  if (process?._stableKey) {
    return process._stableKey;
  }
  return `pid:${process.pid}`;
}

function terminalProcessKey(process) {
  if (!process?.terminalOwned || !process.terminalPaneId) {
    return processStableKey(process);
  }
  return `terminal:${process.terminalPaneId}:${process.terminalInstanceId || process.terminalRootPid || ""}`;
}

function sortBucketProcesses(processes, orderMap) {
  return [...processes].sort((left, right) => (
    Number(orderMap.get(processStableKey(left)) ?? Number.MAX_SAFE_INTEGER)
    - Number(orderMap.get(processStableKey(right)) ?? Number.MAX_SAFE_INTEGER)
    || String(processPrimaryLabel(left)).localeCompare(String(processPrimaryLabel(right)))
    || Number(left.pid || 0) - Number(right.pid || 0)
  ));
}

function friendlyAgentLabel(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[_-]+/g, " ");

  if (normalized.includes("claude")) {
    return "Claude Code";
  }
  if (normalized.includes("codex")) {
    return "Codex";
  }
  if (normalized.includes("opencode")) {
    return "OpenCode";
  }
  if (normalized.includes("node")) {
    return "Node.js";
  }
  if (normalized.includes("terminal") || normalized.includes("shell")) {
    return "Terminal";
  }
  if (normalized === "workspace process" || normalized === "known workspace") {
    return "Terminal";
  }

  return raw || "Terminal";
}

function terminalOrdinal(process) {
  const index = Number(process.terminalIndex);
  return Number.isInteger(index) && index >= 0 ? `T${index + 1}` : "Terminal";
}

function terminalRepresentativeScore(process) {
  const haystack = [
    process.name,
    process.displayName,
    process.groupLabel,
    process.groupId,
    process.command,
    process.executable,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  const agent = String(process.terminalAgentId || process.terminalAgentKind || "").toLowerCase();
  const agentMatch = agent && haystack.includes(agent) ? 100000 : 0;
  const rootMatch = Number(process.pid) === Number(process.terminalRootPid) ? 10000 : 0;
  const cpuScore = Number(process.cpuPercent || 0) * 100;
  const memoryScore = Number(process.memoryBytes || 0) / (1024 * 1024);

  return agentMatch + rootMatch + cpuScore + memoryScore;
}

function processFamilyRepresentativeScore(process, rootPid) {
  const rootMatch = Number(process.pid) === Number(rootPid) ? 100000 : 0;
  const name = String(process.name || process.displayName || "").toLowerCase();
  const group = String(process.groupLabel || process.groupId || "").toLowerCase();
  const groupMatch = group && name.includes(group.replace(/\s+/g, "-")) ? 10000 : 0;
  const cpuScore = Number(process.cpuPercent || 0) * 100;
  const memoryScore = Number(process.memoryBytes || 0) / (1024 * 1024);

  return rootMatch + groupMatch + cpuScore + memoryScore;
}

function topListedProcessRoot(process, processByPid) {
  let current = process;
  const seen = new Set();

  while (current?.parentPid && processByPid.has(current.parentPid)) {
    if (seen.has(current.parentPid)) {
      break;
    }
    seen.add(current.parentPid);
    current = processByPid.get(current.parentPid);
  }

  return current || process;
}

function collapseTerminalProcesses(processes) {
  const groups = new Map();

  for (const process of processes) {
    const key = terminalProcessKey(process);
    const existing = groups.get(key) || {
      cpuPercent: 0,
      key,
      memoryBytes: 0,
      processes: [],
      representative: process,
      representativeScore: Number.NEGATIVE_INFINITY,
      virtualMemoryBytes: 0,
    };
    const score = terminalRepresentativeScore(process);

    existing.cpuPercent += Number(process.cpuPercent || 0);
    existing.memoryBytes += Number(process.memoryBytes || 0);
    existing.virtualMemoryBytes += Number(process.virtualMemoryBytes || 0);
    existing.processes.push(process);

    if (score > existing.representativeScore) {
      existing.representative = process;
      existing.representativeScore = score;
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group.representative,
    _collapsedPids: group.processes.map((process) => process.pid),
    _collapsedProcessCount: group.processes.length,
    _stableKey: group.key,
    childCount: Math.max(...group.processes.map((process) => Number(process.childCount || 0))),
    boundPorts: mergeProcessPorts(group.processes),
    cpuPercent: group.cpuPercent,
    killable: group.processes.some((process) => process.killable),
    memoryBytes: group.memoryBytes,
    virtualMemoryBytes: group.virtualMemoryBytes,
  }));
}

function collapseProcessFamilies(processes, bucketId) {
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  const groups = new Map();

  for (const process of processes) {
    const root = topListedProcessRoot(process, processByPid);
    const forceGroupKey = bucketId === "docker" && process.groupId === "docker-daemon";
    const key = forceGroupKey
      ? `${bucketId}:group:${process.groupId}`
      : `${bucketId}:tree:${root.pid}`;
    const existing = groups.get(key) || {
      collapseKind: forceGroupKey ? "group" : "tree",
      cpuPercent: 0,
      key,
      memoryBytes: 0,
      processes: [],
      representative: root,
      representativeScore: Number.NEGATIVE_INFINITY,
      rootPid: root.pid,
      virtualMemoryBytes: 0,
    };
    const score = forceGroupKey
      ? processFamilyRepresentativeScore(process, process.pid)
      : processFamilyRepresentativeScore(process, existing.rootPid);

    existing.cpuPercent += Number(process.cpuPercent || 0);
    existing.memoryBytes += Number(process.memoryBytes || 0);
    existing.virtualMemoryBytes += Number(process.virtualMemoryBytes || 0);
    existing.processes.push(process);

    if (score > existing.representativeScore) {
      existing.representative = process;
      existing.representativeScore = score;
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values()).map((group) => {
    const representative = group.collapseKind === "tree"
      ? processByPid.get(group.rootPid) || group.representative
      : group.representative;

    return {
      ...representative,
      _collapsedPids: group.processes.map((process) => process.pid),
      _collapsedProcessCount: group.processes.length,
      _collapseKillTree: group.collapseKind === "tree" && group.processes.length > 1,
      _stableKey: group.key,
      boundPorts: mergeProcessPorts(group.processes),
      childCount: Math.max(...group.processes.map((process) => Number(process.childCount || 0))),
      cpuPercent: group.cpuPercent,
      killable: representative.killable,
      memoryBytes: group.memoryBytes,
      virtualMemoryBytes: group.virtualMemoryBytes,
    };
  });
}

function processPrimaryLabel(process) {
  if (process.terminalOwned) {
    const agentLabel = friendlyAgentLabel(
      process.terminalAgentId
      || process.terminalAgentKind
      || process.groupLabel
      || process.displayName,
    );
    const terminalLabel = terminalOrdinal(process);
    return agentLabel === "Terminal" ? terminalLabel : `${agentLabel} / ${terminalLabel}`;
  }

  if (process.groupId === "workspace-process") {
    return process.name || process.executable || process.groupLabel || `PID ${process.pid}`;
  }

  return process.groupLabel || process.displayName || process.name || `PID ${process.pid}`;
}

function processSecondaryLabel(process) {
  if (process.terminalOwned) {
    const workspace = process.terminalWorkspaceName || process.attributionLabel || "Diff Forge";
    if (Number(process._collapsedProcessCount || 0) > 1) {
      return `${workspace} / ${process._collapsedProcessCount} mapped processes`;
    }
    return `${workspace} / PID ${process.pid}`;
  }

  if (Number(process._collapsedProcessCount || 0) > 1) {
    return `${process._collapsedProcessCount} mapped processes / PID ${process.pid}`;
  }

  return process.command
    || process.executable
    || process.cwd
    || (process.parentPid ? `Parent ${process.parentPid} / PID ${process.pid}` : `PID ${process.pid}`);
}

function processBlurb(process) {
  const primary = processPrimaryLabel(process);
  if (process.terminalOwned) {
    const workspace = process.terminalWorkspaceName || process.attributionLabel || "";
    return workspace ? `${primary} / ${workspace}` : primary;
  }

  const name = process.groupId === "workspace-process"
    ? process.name || process.displayName || ""
    : process.displayName || process.name || "";
  if (name && name !== primary) {
    return `${primary} / ${name}`;
  }
  return primary;
}

function processCommandPreview(process) {
  return [
    processPrimaryLabel(process),
    processSecondaryLabel(process),
    processPortTitle(process) ? `Ports:\n${processPortTitle(process)}` : "",
    Number(process._collapsedProcessCount || 0) > 1
      ? `Mapped PIDs: ${process._collapsedPids?.join(", ")}`
      : "",
    process.command,
    process.executable,
    process.cwd,
  ]
    .filter(Boolean)
    .join("\n");
}

function processStopLabel(process) {
  if (!process.killable) {
    return process.killDisabledReason || "Protected process";
  }
  if (process.terminalOwned) {
    return "Close terminal";
  }
  return process.killTreeDefault || process._collapseKillTree ? "Stop process tree" : "Stop process";
}

function dockerActionConfig(action) {
  return DOCKER_ACTIONS[action] || DOCKER_ACTIONS.relaunch;
}

function dockerActionLogTitle(action) {
  const config = dockerActionConfig(action);
  return `${config.buttonLabel} log`;
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    return "";
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function dockerCommandTargetLabel(command) {
  return String(
    command?.targetLabel
    || [
      command?.targetComposeProject,
      command?.targetComposeService,
    ].filter(Boolean).join("/")
    || command?.targetContainerName
    || command?.targetContainerId
    || "Docker target",
  ).trim();
}

function dockerCommandArgText(value) {
  const text = String(value || "");
  if (!text) {
    return "\"\"";
  }
  if (/^[a-zA-Z0-9_./:@=+-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function dockerCommandLine(command) {
  return [
    dockerCommandArgText(command?.program),
    ...(Array.isArray(command?.args) ? command.args.map(dockerCommandArgText) : []),
  ].join(" ");
}

function dockerCommandOutput(command) {
  const stderr = String(command?.stderr || "").trim();
  const stdout = String(command?.stdout || "").trim();
  const parts = [];
  if (stderr) {
    parts.push(`stderr\n${stderr}`);
  }
  if (stdout) {
    parts.push(`stdout\n${stdout}`);
  }
  return parts.join("\n\n");
}

function dockerCommandMetaItems(command) {
  const items = [];
  const links = Array.isArray(command?.targetWorkspaceLinks)
    ? command.targetWorkspaceLinks.filter(Boolean)
    : [];
  const composeFiles = Array.isArray(command?.targetComposeConfigFiles)
    ? command.targetComposeConfigFiles.filter(Boolean)
    : [];
  const cwd = String(command?.cwd || command?.targetComposeWorkingDir || "").trim();
  const container = String(command?.targetContainerName || command?.targetContainerId || "").trim();
  const image = String(command?.targetContainerImage || "").trim();

  for (const link of links) {
    const isSignal = /^[a-z ]+:\s+\S/i.test(link) && !/^[a-zA-Z]:[\\/]/.test(link);
    items.push({ label: isSignal ? "linked signal" : "linked path", value: link });
  }
  if (cwd) {
    items.push({ label: "cwd", value: cwd });
  }
  for (const file of composeFiles) {
    items.push({ label: "compose", value: file });
  }
  if (container) {
    items.push({ label: "container", value: container });
  }
  if (image) {
    items.push({ label: "image", value: image });
  }

  return items;
}

function terminalTargetFromProcess(process) {
  if (!process?.terminalOwned || !process.terminalPaneId) {
    return null;
  }

  return {
    agentId: process.terminalAgentId || process.groupId || "",
    instanceId: process.terminalInstanceId,
    paneId: process.terminalPaneId,
    processPid: process.pid,
    terminalIndex: process.terminalIndex,
    threadId: process.terminalThreadId || "",
    workspaceId: process.terminalWorkspaceId || "",
    workspaceName: process.terminalWorkspaceName || "",
  };
}

function GroupIcon({ hint }) {
  const iconHint = String(hint || "").toLowerCase();
  if (iconHint === "bot") {
    return <ButtonBotIcon aria-hidden="true" />;
  }
  if (iconHint === "hub") {
    return <ButtonHubIcon aria-hidden="true" />;
  }
  if (iconHint === "terminal") {
    return <ButtonTerminalIcon aria-hidden="true" />;
  }
  if (iconHint === "code") {
    return <ButtonCodeIcon aria-hidden="true" />;
  }
  return <ButtonProcessIcon aria-hidden="true" />;
}

function ProcessBusySpinner() {
  return (
    <ProcessRowBusySpinner aria-hidden="true">
      {PROCESS_BUSY_SPINNER_SEGMENTS.map((segment) => (
        <span key={segment} style={{ "--segment": segment }} />
      ))}
    </ProcessRowBusySpinner>
  );
}

function ProcessPortBadge({ process }) {
  const label = processPortLabel(process);
  if (!label) {
    return <ProcessRowPorts aria-hidden="true" data-empty="true" />;
  }

  return (
    <ProcessRowPorts title={processPortTitle(process)}>
      {label}
    </ProcessRowPorts>
  );
}

function ProcessDockerActionLog({ result }) {
  const commands = Array.isArray(result?.commands) ? result.commands : [];
  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];

  if (!commands.length && !skipped.length) {
    return null;
  }

  return (
    <ProcessDockerLogPanel data-state={Number(result?.failed || 0) > 0 ? "error" : "done"}>
      <ProcessDockerLogHeader>
        <strong>{dockerActionLogTitle(result?.action)}</strong>
        <span>
          {commands.filter((command) => command?.success).length} ok / {Number(result?.failed || 0)} failed
          {skipped.length ? ` / ${skipped.length} skipped` : ""}
        </span>
      </ProcessDockerLogHeader>
      <ProcessDockerLogList>
        {commands.map((command, index) => {
          const output = dockerCommandOutput(command);
          const metaItems = dockerCommandMetaItems(command);
          const duration = formatDurationMs(command?.durationMs);

          return (
            <ProcessDockerLogEntry
              data-success={command?.success ? "true" : "false"}
              key={`${command?.program || "docker"}-${index}`}
            >
              <ProcessDockerLogEntryTop>
                <strong>{dockerCommandTargetLabel(command)}</strong>
                <span>
                  {command?.success ? "OK" : "Failed"}
                  {duration ? ` / ${duration}` : ""}
                  {command?.exitCode !== null && command?.exitCode !== undefined
                    ? ` / exit ${command.exitCode}`
                    : ""}
                </span>
              </ProcessDockerLogEntryTop>
              {metaItems.length > 0 && (
                <ProcessDockerLogMeta>
                  {metaItems.map((item, itemIndex) => (
                    <span key={`${item.label}-${item.value}-${itemIndex}`}>
                      {item.label}: <code>{item.value}</code>
                    </span>
                  ))}
                </ProcessDockerLogMeta>
              )}
              <ProcessDockerCommandLine>{dockerCommandLine(command)}</ProcessDockerCommandLine>
              {output && <ProcessDockerOutput>{output}</ProcessDockerOutput>}
            </ProcessDockerLogEntry>
          );
        })}
        {skipped.map((item, index) => (
          <ProcessDockerLogEntry data-success="skipped" key={`skipped-${index}`}>
            <ProcessDockerLogEntryTop>
              <strong>Skipped</strong>
              <span>Not run</span>
            </ProcessDockerLogEntryTop>
            <ProcessDockerCommandLine>{item}</ProcessDockerCommandLine>
          </ProcessDockerLogEntry>
        ))}
      </ProcessDockerLogList>
    </ProcessDockerLogPanel>
  );
}

function isDockerRowBusy(bucketId, process, dockerActionState) {
  if (bucketId !== "docker" || dockerActionState?.state !== "running") {
    return false;
  }
  const targetProcessKey = String(dockerActionState?.targetProcessKey || "");
  return !targetProcessKey || targetProcessKey === processStableKey(process);
}

function ProcessBucket({
  bucket,
  dockerActionState,
  onDockerAction,
  onStopProcess,
}) {
  if (!bucket.processes.length) {
    return null;
  }

  return (
    <ProcessBucketPanel aria-label={bucket.label} data-kind={bucket.id}>
      <ProcessBucketList aria-label={bucket.label} role="list">
        {bucket.processes.map((process) => {
          const dockerBusy = isDockerRowBusy(bucket.id, process, dockerActionState);
          return (
            <ProcessBucketRow
              data-docker-busy={dockerBusy ? "true" : "false"}
              data-hot={isHighUsage(process) ? "true" : "false"}
              key={processStableKey(process)}
              role="listitem"
              title={processCommandPreview(process)}
            >
              <ProcessRowIcon data-busy={dockerBusy ? "true" : "false"} data-kind={process.groupKind || bucket.id}>
                {dockerBusy ? <ProcessBusySpinner /> : <GroupIcon hint={process.iconHint} />}
              </ProcessRowIcon>
              <ProcessRowMain>
                <span>{processBlurb(process)}</span>
              </ProcessRowMain>
              <ProcessPortBadge process={process} />
              <ProcessRowUsage>
                <span>{formatBytes(process.memoryBytes)}</span>
                <strong>{formatCpu(process.cpuPercent)}</strong>
              </ProcessRowUsage>
              <ProcessRowActions>
                {bucket.id === "docker" && (
                  <>
                    <ProcessDockerActionButton
                      aria-label={DOCKER_ACTIONS.relaunch.title}
                      disabled={dockerActionState?.state === "running"}
                      onClick={() => onDockerAction("relaunch", process)}
                      title={DOCKER_ACTIONS.relaunch.title}
                      type="button"
                    >
                      <ButtonRefreshIcon aria-hidden="true" />
                    </ProcessDockerActionButton>
                    <ProcessDockerActionButton
                      aria-label={DOCKER_ACTIONS.rebuildRelaunch.title}
                      disabled={dockerActionState?.state === "running"}
                      onClick={() => onDockerAction("rebuildRelaunch", process)}
                      title={DOCKER_ACTIONS.rebuildRelaunch.title}
                      type="button"
                    >
                      <ButtonCodeIcon aria-hidden="true" />
                    </ProcessDockerActionButton>
                    <ProcessDockerActionButton
                      aria-label={DOCKER_ACTIONS.remountData.title}
                      data-danger="true"
                      disabled={dockerActionState?.state === "running"}
                      onClick={() => onDockerAction("remountData", process)}
                      title={DOCKER_ACTIONS.remountData.title}
                      type="button"
                    >
                      <ButtonHubIcon aria-hidden="true" />
                    </ProcessDockerActionButton>
                  </>
                )}
                <ProcessRowStopButton
                  aria-label={processStopLabel(process)}
                  disabled={!process.killable}
                  onClick={() => {
                    if (process.killable) {
                      onStopProcess(process);
                    }
                  }}
                  title={processStopLabel(process)}
                  type="button"
                >
                  <ButtonDeleteIcon aria-hidden="true" />
                </ProcessRowStopButton>
              </ProcessRowActions>
            </ProcessBucketRow>
          );
        })}
      </ProcessBucketList>
    </ProcessBucketPanel>
  );
}

function ProcessEnergySection({ energy }) {
  const groups = Array.isArray(energy?.groups) ? energy.groups : [];
  const visibleGroups = groups.filter((group) => (
    Number(group?.score || 0) > 0 || Number(group?.processCount || 0) > 0
  ));
  const maxScore = Math.max(
    1,
    ...visibleGroups.map((group) => Number(group?.score || 0)),
  );
  const totalTone = energyTone(energy?.totalScore);

  return (
    <ProcessEnergyPanel aria-label="Diff Forge energy">
      <ProcessEnergyHeader>
        <div>
          <strong>Diff Forge energy</strong>
          <span>
            {energy?.topLabel
              ? `${energy.topLabel}: ${energy.topCause || "largest current source"}`
              : "Estimated from live app, helper, terminal, and workspace processes."}
          </span>
        </div>
        <ProcessEnergyTotal data-tone={totalTone}>
          <span>Total</span>
          <strong>{formatEnergy(energy?.totalScore)}</strong>
        </ProcessEnergyTotal>
      </ProcessEnergyHeader>

      {visibleGroups.length === 0 ? (
        <ProcessEnergyEmpty>No notable Diff Forge energy activity detected.</ProcessEnergyEmpty>
      ) : (
        <ProcessEnergyList role="list">
          {visibleGroups.map((group) => {
            const score = Number(group?.score || 0);
            const width = `${Math.max(3, Math.min(100, (score / maxScore) * 100))}%`;
            return (
              <ProcessEnergyRow
                data-tone={group?.intensity || energyTone(score)}
                key={group?.id || group?.label}
                role="listitem"
                title={group?.description || group?.cause || ""}
              >
                <ProcessEnergyMain>
                  <strong>{group?.label || "Diff Forge"}</strong>
                  <span>{group?.cause || group?.description || ""}</span>
                </ProcessEnergyMain>
                <ProcessEnergyTrack aria-hidden="true">
                  <span style={{ width }} />
                </ProcessEnergyTrack>
                <ProcessEnergyNumbers>
                  <strong>{formatEnergy(score)}</strong>
                  <span>
                    {formatCpu(group?.cpuPercent)}
                    {" / "}
                    {formatBytes(group?.memoryBytes)}
                    {" / "}
                    {formatProcessPlural(group?.processCount)}
                  </span>
                </ProcessEnergyNumbers>
              </ProcessEnergyRow>
            );
          })}
        </ProcessEnergyList>
      )}

      <ProcessEnergyNote>
        Lightweight internal estimates; showing {visibleGroups.length} bucket{visibleGroups.length === 1 ? "" : "s"}.
      </ProcessEnergyNote>
    </ProcessEnergyPanel>
  );
}

function formatContainerPorts(ports) {
  const entries = String(ports || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith("[::]") && !entry.startsWith(":::"));
  return entries.join(", ");
}

function containerDisplayImage(image) {
  const value = String(image || "");
  if (value.startsWith("sha256:")) {
    return value.slice(0, 19);
  }
  return value;
}

function containerActionTitle(action) {
  switch (action) {
    case "start": return "Start container";
    case "stop": return "Stop container";
    case "restart": return "Restart container";
    case "pause": return "Pause container";
    case "unpause": return "Unpause container";
    case "remove": return "Remove container";
    default: return "Docker action";
  }
}

function DockerContainerRow({
  busyAction,
  container,
  disabled,
  logsOpen,
  onAction,
  onToggleLogs,
}) {
  const state = String(container.state || "");
  const running = state === "running";
  const paused = state === "paused";
  const restarting = state === "restarting";
  const stopped = !running && !paused && !restarting;
  const ports = formatContainerPorts(container.ports);
  const rowDisabled = disabled || Boolean(busyAction);

  return (
    <ProcessContainerRow data-state={state} role="listitem">
      <ProcessRowIcon data-kind="docker">
        {busyAction ? (
          <ProcessBusySpinner />
        ) : (
          <ProcessContainerDot
            data-health={container.health || undefined}
            data-state={state}
            title={container.status || state}
          />
        )}
      </ProcessRowIcon>
      <ProcessContainerMain>
        <strong title={container.name || container.id}>{container.name || container.id}</strong>
        <span title={container.image}>
          {containerDisplayImage(container.image)}
          {container.composeService ? ` / ${container.composeService}` : ""}
        </span>
      </ProcessContainerMain>
      <ProcessContainerStatus>
        <span title={container.status}>{container.status || state || "unknown"}</span>
        {ports && <em title={ports}>{ports}</em>}
      </ProcessContainerStatus>
      <ProcessRowUsage>
        <span>{container.memUsage ? String(container.memUsage).split(" / ")[0] : ""}</span>
        <strong>
          {Number.isFinite(Number(container.cpuPercent)) && container.cpuPercent !== null
            ? formatCpu(container.cpuPercent)
            : ""}
        </strong>
      </ProcessRowUsage>
      <ProcessRowActions>
        {(stopped || paused) && (
          <ProcessDockerActionButton
            aria-label={containerActionTitle(paused ? "unpause" : "start")}
            disabled={rowDisabled}
            onClick={() => onAction(container, paused ? "unpause" : "start")}
            title={containerActionTitle(paused ? "unpause" : "start")}
            type="button"
          >
            <PlayArrow aria-hidden="true" />
          </ProcessDockerActionButton>
        )}
        {running && (
          <ProcessDockerActionButton
            aria-label={containerActionTitle("pause")}
            disabled={rowDisabled}
            onClick={() => onAction(container, "pause")}
            title={containerActionTitle("pause")}
            type="button"
          >
            <Pause aria-hidden="true" />
          </ProcessDockerActionButton>
        )}
        {(running || restarting) && (
          <ProcessDockerActionButton
            aria-label={containerActionTitle("restart")}
            disabled={rowDisabled}
            onClick={() => onAction(container, "restart")}
            title={containerActionTitle("restart")}
            type="button"
          >
            <ButtonRefreshIcon aria-hidden="true" />
          </ProcessDockerActionButton>
        )}
        {(running || paused || restarting) && (
          <ProcessDockerActionButton
            aria-label={containerActionTitle("stop")}
            data-danger="true"
            disabled={rowDisabled}
            onClick={() => onAction(container, "stop")}
            title={containerActionTitle("stop")}
            type="button"
          >
            <Stop aria-hidden="true" />
          </ProcessDockerActionButton>
        )}
        <ProcessDockerActionButton
          aria-label="Show container logs"
          data-active={logsOpen ? "true" : undefined}
          disabled={disabled}
          onClick={() => onToggleLogs(container)}
          title="Show container logs"
          type="button"
        >
          <Article aria-hidden="true" />
        </ProcessDockerActionButton>
        {stopped && (
          <ProcessRowStopButton
            aria-label={containerActionTitle("remove")}
            disabled={rowDisabled}
            onClick={() => onAction(container, "remove")}
            title={containerActionTitle("remove")}
            type="button"
          >
            <ButtonDeleteIcon aria-hidden="true" />
          </ProcessRowStopButton>
        )}
      </ProcessRowActions>
    </ProcessContainerRow>
  );
}

export default function ProcessesView({
  onCloseTrackedTerminal,
  workspaceRoots = [],
}) {
  const [energySnapshot, setEnergySnapshot] = useState(null);
  const [deepScanSnapshot, setDeepScanSnapshot] = useState(null);
  const [deepScanState, setDeepScanState] = useState("idle");
  const [deepScanError, setDeepScanError] = useState("");
  const [refreshState, setRefreshState] = useState("idle");
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [dockerConfirmAction, setDockerConfirmAction] = useState(null);
  const [dockerActionState, setDockerActionState] = useState({
    message: "",
    result: null,
    state: "idle",
    targetProcessKey: "",
  });
  const [killState, setKillState] = useState({ state: "idle", message: "" });
  const [containersSnapshot, setContainersSnapshot] = useState(null);
  const [containersError, setContainersError] = useState("");
  const [containerBusy, setContainerBusy] = useState({});
  const [containerFeedback, setContainerFeedback] = useState(null);
  const [containerConfirm, setContainerConfirm] = useState(null);
  const [containerLogs, setContainerLogs] = useState(null);
  const mountedRef = useRef(false);
  const containersStateRef = useRef("");
  const energyLoadRef = useRef(null);
  const deepScanLoadRef = useRef(null);
  const containersLoadRef = useRef(null);
  const processOrderCounterRef = useRef(0);
  const processOrderRef = useRef(new Map());

  const normalizedWorkspaceRoots = useMemo(
    () => normalizeProcessRoots(workspaceRoots),
    [workspaceRoots],
  );
  const workspaceRootsKey = normalizedWorkspaceRoots.join("\n");

  const loadEnergy = useCallback(async ({ silent = false } = {}) => {
    if (energyLoadRef.current) {
      return energyLoadRef.current;
    }
    if (!silent) {
      setRefreshState("loading");
    } else {
      setRefreshState((state) => (state === "loading" ? state : "refreshing"));
    }

    const request = (async () => {
      const result = await invoke("developer_energy_snapshot", {
        workspaceRoots: normalizedWorkspaceRoots,
      });

      if (!mountedRef.current) {
        return;
      }

      setEnergySnapshot(result);
      setError("");
      if (!silent) {
        setRefreshState("idle");
      } else {
        setRefreshState((state) => (state === "refreshing" ? "idle" : state));
      }
    })();
    energyLoadRef.current = request;
    try {
      await request;
    } catch (loadError) {
      if (!mountedRef.current) {
        return;
      }

      setError(errorMessage(loadError, "Unable to load Diff Forge energy."));
      if (!silent) {
        setRefreshState("idle");
      } else {
        setRefreshState((state) => (state === "refreshing" ? "idle" : state));
      }
    } finally {
      if (energyLoadRef.current === request) {
        energyLoadRef.current = null;
      }
    }
  }, [workspaceRootsKey]);

  const loadDeepScan = useCallback(async ({ force = true } = {}) => {
    if (deepScanLoadRef.current) {
      return deepScanLoadRef.current;
    }
    setDeepScanState("loading");
    setDeepScanError("");

    const request = (async () => {
      const result = await invoke("list_developer_processes", {
        activeWorkspaceRoot: "",
        force,
        includeDiagnostics: true,
        includePorts: DEEP_SCAN_PORTS_ENABLED,
        workspaceRoots: normalizedWorkspaceRoots,
      });

      if (!mountedRef.current) {
        return;
      }

      setDeepScanSnapshot(result);
      setDeepScanError("");
      setDeepScanState("idle");
    })();
    deepScanLoadRef.current = request;
    try {
      await request;
    } catch (loadError) {
      if (!mountedRef.current) {
        return;
      }

      setDeepScanError(errorMessage(loadError, "Unable to run deep process scan."));
      setDeepScanState("idle");
    } finally {
      if (deepScanLoadRef.current === request) {
        deepScanLoadRef.current = null;
      }
    }
  }, [workspaceRootsKey]);

  // Containers are listed through the Rust docker CLI bridge, so the panel
  // keeps working in background/headless mode.
  const loadContainers = useCallback(async ({
    force = false,
    includeStats = false,
    silent = false,
  } = {}) => {
    if (containersLoadRef.current) {
      return containersLoadRef.current;
    }
    const request = (async () => {
      const result = await invoke("docker_containers_snapshot", { force, includeStats });
      if (!mountedRef.current) {
        return;
      }
      containersStateRef.current = String(result?.state || "");
      setContainersSnapshot(result);
      setContainersError("");
    })();
    containersLoadRef.current = request;
    try {
      await request;
    } catch (loadError) {
      if (!mountedRef.current) {
        return;
      }
      if (!silent) {
        setContainersError(errorMessage(loadError, "Unable to load Docker containers."));
      }
    } finally {
      if (containersLoadRef.current === request) {
        containersLoadRef.current = null;
      }
    }
  }, []);

  const refreshAll = useCallback(async ({ force = false } = {}) => {
    setRefreshState("loading");
    await Promise.allSettled([
      loadEnergy({ silent: true }),
      loadContainers({ force, includeStats: false, silent: true }),
    ]);
    if (mountedRef.current) {
      setRefreshState("idle");
    }
  }, [loadContainers, loadEnergy]);

  useEffect(() => {
    mountedRef.current = true;
    refreshAll();

    const energyIntervalId = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        loadEnergy({ silent: true });
      }
    }, ENERGY_REFRESH_MS);
    const containerIntervalId = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        // A missing CLI never recovers on its own; skip the auto-poll and let
        // the manual Refresh button retry it.
        if (containersStateRef.current !== "cli_missing") {
          loadContainers({ includeStats: false, silent: true });
        }
      }
    }, DOCKER_REFRESH_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(energyIntervalId);
      window.clearInterval(containerIntervalId);
    };
  }, [loadContainers, loadEnergy, refreshAll]);

  const fetchContainerLogs = useCallback(async (container) => {
    setContainerLogs({
      error: "",
      id: container.id,
      loading: true,
      name: container.name || container.id,
      output: "",
      truncated: false,
    });
    try {
      const result = await invoke("docker_container_logs", {
        containerRef: container.id,
        tail: 200,
      });
      setContainerLogs((current) => (
        current?.id === container.id
          ? {
            ...current,
            loading: false,
            output: String(result?.output || ""),
            truncated: Boolean(result?.truncated),
          }
          : current
      ));
    } catch (logsError) {
      setContainerLogs((current) => (
        current?.id === container.id
          ? { ...current, error: errorMessage(logsError, "Unable to read container logs."), loading: false }
          : current
      ));
    }
  }, []);

  const toggleContainerLogs = useCallback((container) => {
    if (containerLogs?.id === container.id) {
      setContainerLogs(null);
      return;
    }
    void fetchContainerLogs(container);
  }, [containerLogs?.id, fetchContainerLogs]);

  const runContainerAction = useCallback(async (container, action) => {
    const containerId = String(container?.id || "");
    if (!containerId) {
      return;
    }
    setContainerBusy((current) => ({ ...current, [containerId]: action }));
    setContainerFeedback(null);
    try {
      const result = await invoke("docker_container_action", {
        action,
        containerRef: containerId,
      });
      setContainerFeedback({
        id: containerId,
        message: `${container.name || containerId}: ${result?.message || "Docker action completed."}${
          Number(result?.durationMs || 0) > 0 ? ` (${Math.round(result.durationMs)}ms)` : ""
        }`,
        state: result?.ok ? "done" : "error",
      });
    } catch (actionError) {
      setContainerFeedback({
        id: containerId,
        message: errorMessage(actionError, "Unable to run the Docker container action."),
        state: "error",
      });
    } finally {
      setContainerBusy((current) => {
        const next = { ...current };
        delete next[containerId];
        return next;
      });
      await loadContainers({ force: true, silent: true });
      await loadEnergy({ silent: true });
    }
  }, [loadContainers, loadEnergy]);

  const beginContainerAction = useCallback((container, action) => {
    if (action === "remove") {
      setContainerConfirm({ action, container });
      return;
    }
    void runContainerAction(container, action);
  }, [runContainerAction]);

  const confirmContainerAction = useCallback(async () => {
    if (!containerConfirm) {
      return;
    }
    const { action, container } = containerConfirm;
    setContainerConfirm(null);
    await runContainerAction(container, action);
  }, [containerConfirm, runContainerAction]);

  const containerGroups = useMemo(() => {
    const containers = Array.isArray(containersSnapshot?.containers)
      ? containersSnapshot.containers
      : [];
    const byProject = new Map();
    for (const container of containers) {
      const key = String(container.composeProject || "");
      if (!byProject.has(key)) {
        byProject.set(key, []);
      }
      byProject.get(key).push(container);
    }
    const groups = [...byProject.entries()]
      .filter(([key]) => key)
      .map(([key, items]) => ({ containers: items, id: `compose:${key}`, label: key }));
    const standalone = byProject.get("") || [];
    if (standalone.length) {
      groups.push({
        containers: standalone,
        id: "standalone",
        label: groups.length ? "Standalone" : "",
      });
    }
    return groups;
  }, [containersSnapshot]);

  const allProcesses = Array.isArray(deepScanSnapshot?.processes)
    ? deepScanSnapshot.processes
    : [];
  const buckets = useMemo(() => {
    const diffForge = [];
    const untracked = [];
    const docker = [];

    for (const process of allProcesses) {
      if (process.terminalOwned) {
        diffForge.push(process);
      } else if (isDockerProcess(process)) {
        docker.push(process);
      } else {
        untracked.push(process);
      }
    }

    const collapsedDiffForge = collapseTerminalProcesses(diffForge);
    const collapsedUntracked = collapseProcessFamilies(untracked, "untracked");
    const collapsedDocker = collapseProcessFamilies(docker, "docker");
    const visibleProcesses = [
      ...collapsedDiffForge,
      ...collapsedUntracked,
      ...collapsedDocker,
    ];
    const liveKeys = new Set();

    for (const process of visibleProcesses) {
      const key = processStableKey(process);
      liveKeys.add(key);
      if (!processOrderRef.current.has(key)) {
        processOrderRef.current.set(key, processOrderCounterRef.current);
        processOrderCounterRef.current += 1;
      }
    }
    for (const key of processOrderRef.current.keys()) {
      if (!liveKeys.has(key)) {
        processOrderRef.current.delete(key);
      }
    }

    return [
      {
        id: "diffforge",
        label: "Diff Forge",
        processes: sortBucketProcesses(collapsedDiffForge, processOrderRef.current),
      },
      {
        id: "untracked",
        label: "Untracked",
        processes: sortBucketProcesses(collapsedUntracked, processOrderRef.current),
      },
      {
        id: "docker",
        label: "Docker",
        processes: sortBucketProcesses(collapsedDocker, processOrderRef.current),
      },
    ];
  }, [allProcesses]);

  const visibleProcesses = buckets.flatMap((bucket) => bucket.processes);
  const highActivityCount = visibleProcesses.filter(isHighUsage).length;
  const totalMemoryBytes = visibleProcesses.reduce(
    (total, process) => total + Number(process.memoryBytes || 0),
    0,
  );
  const totalCpuPercent = visibleProcesses.reduce(
    (total, process) => total + Number(process.cpuPercent || 0),
    0,
  );
  const containers = Array.isArray(containersSnapshot?.containers)
    ? containersSnapshot.containers
    : [];
  const runningContainerCount = containers
    .filter((container) => container.state === "running")
    .length;
  const energy = energySnapshot || deepScanSnapshot?.energy || null;
  const showEnergyDiagnostics = Boolean(energy);
  const isRefreshing = refreshState === "loading" || refreshState === "refreshing";
  const isDeepScanning = deepScanState === "loading";

  const beginStopProcess = useCallback((process) => {
    if (!process.killable) {
      return;
    }

    const terminalTarget = terminalTargetFromProcess(process);
    const isTerminalClose = Boolean(terminalTarget);

    setConfirmAction({
      actionLabel: isTerminalClose ? "Close terminal" : "Stop process",
      buttonLabel: isTerminalClose ? "Close" : "Stop",
      detail: isTerminalClose
        ? `${processSecondaryLabel(process)}`
        : Number(process._collapsedProcessCount || 0) > 1
          ? `${processSecondaryLabel(process)}`
          : `PID ${process.pid}`,
      includeTree: !isTerminalClose && Boolean(process.killTreeDefault || process._collapseKillTree),
      label: processPrimaryLabel(process),
      pendingLabel: isTerminalClose ? "Closing..." : "Stopping...",
      pids: isTerminalClose ? [] : [process.pid],
      risk: process.risk || "caution",
      terminalTargets: isTerminalClose ? [terminalTarget] : [],
    });
    setKillState({ state: "idle", message: "" });
  }, []);

  const beginDockerAction = useCallback((action, process) => {
    const config = dockerActionConfig(action);
    setDockerConfirmAction({
      action,
      ...config,
      processLabel: process ? processBlurb(process) : "Workspace Docker targets",
      targetProcessKey: process ? processStableKey(process) : "",
    });
    setDockerActionState({ state: "idle", message: "", result: null, targetProcessKey: "" });
  }, []);

  const confirmDockerAction = useCallback(async () => {
    if (!dockerConfirmAction || dockerActionState.state === "running") {
      return;
    }

    setDockerActionState({
      state: "running",
      message: "",
      result: null,
      targetProcessKey: dockerConfirmAction.targetProcessKey || "",
    });

    try {
      const result = await invoke("docker_developer_action", {
        action: dockerConfirmAction.action,
        workspaceRoots: normalizedWorkspaceRoots,
      });
      const failedCommand = Array.isArray(result?.commands)
        ? result.commands.find((command) => !command.success)
        : null;
      const skipped = Array.isArray(result?.skipped) && result.skipped.length
        ? ` ${result.skipped.slice(0, 2).join(" ")}`
        : "";
      const failure = failedCommand
        ? ` ${failedCommand.stderr || failedCommand.stdout || "A Docker command failed."}`
        : "";

      setDockerConfirmAction(null);
      setDockerActionState({
        state: Number(result?.failed || 0) > 0 ? "error" : "done",
        message: `${result?.message || "Docker action completed."}${skipped}${failure}`.trim(),
        result,
        targetProcessKey: "",
      });
      await loadContainers({ force: true, silent: true });
      await loadEnergy({ silent: true });
    } catch (actionError) {
      setDockerActionState({
        state: "error",
        message: errorMessage(actionError, "Unable to run Docker action."),
        result: null,
        targetProcessKey: "",
      });
    }
  }, [
    dockerActionState.state,
    dockerConfirmAction,
    loadContainers,
    loadEnergy,
    normalizedWorkspaceRoots,
  ]);

  const confirmKill = useCallback(async () => {
    if (
      (!confirmAction?.pids?.length && !confirmAction?.terminalTargets?.length)
      || killState.state === "killing"
    ) {
      return;
    }

    setKillState({ state: "killing", message: "" });
    const failures = [];
    let affected = 0;

    for (const target of confirmAction.terminalTargets || []) {
      try {
        if (typeof onCloseTrackedTerminal !== "function") {
          throw new Error("Terminal close handler is unavailable.");
        }
        const result = await onCloseTrackedTerminal(target);
        affected += Number(result?.closedProcesses || 1);
      } catch (closeError) {
        failures.push(errorMessage(closeError, `Unable to close terminal ${target.paneId}.`));
      }
    }

    for (const pid of confirmAction.pids) {
      try {
        const result = await invoke("kill_developer_process", {
          force: true,
          includeTree: confirmAction.includeTree,
          pid,
        });
        affected += Array.isArray(result?.killedPids) && result.killedPids.length
          ? result.killedPids.length
          : 1;
      } catch (killError) {
        failures.push(errorMessage(killError, `Unable to terminate PID ${pid}.`));
      }
    }

    await loadDeepScan({ force: true });

    if (failures.length) {
      setKillState({
        state: "error",
        message: failures.slice(0, 2).join(" "),
      });
      return;
    }

    setConfirmAction(null);
    const affectedCount = affected || confirmAction.pids.length || confirmAction.terminalTargets?.length || 0;
    const actionWord = confirmAction.terminalTargets?.length && !confirmAction.pids?.length ? "Close" : "Stop";
    setKillState({
      state: "done",
      message: `${actionWord} requested for ${affectedCount} process${affectedCount === 1 ? "" : "es"}.`,
    });
  }, [confirmAction, killState.state, loadDeepScan, onCloseTrackedTerminal]);

  return (
    <ProcessSurface>
      <ProcessHeader>
        <div>
          <PanelKicker>Processes</PanelKicker>
          <PanelHeading>Energy and containers</PanelHeading>
          <PageSubline>lightweight Diff Forge energy / Docker controls</PageSubline>
        </div>
        <ProcessHeaderActions>
          <ProcessMetric>
            <span>Containers</span>
            <strong>{containers.length}</strong>
          </ProcessMetric>
          <ProcessMetric data-tone={runningContainerCount > 0 ? "active" : "neutral"}>
            <span>Running</span>
            <strong>{runningContainerCount}</strong>
          </ProcessMetric>
          {showEnergyDiagnostics && (
            <ProcessMetric data-tone={energyTone(energy?.totalScore)}>
              <span>Energy</span>
              <strong>{formatEnergy(energy?.totalScore)}</strong>
            </ProcessMetric>
          )}
          <SecondaryButton
            disabled={dockerActionState.state === "running"}
            onClick={() => beginDockerAction("relaunch", null)}
            type="button"
          >
            <ButtonRefreshIcon aria-hidden="true" />
            <span>{dockerActionState.state === "running" ? "Running..." : "Relaunch"}</span>
          </SecondaryButton>
          <SecondaryButton
            disabled={dockerActionState.state === "running"}
            onClick={() => beginDockerAction("rebuildRelaunch", null)}
            type="button"
          >
            <ButtonCodeIcon aria-hidden="true" />
            <span>Rebuild</span>
          </SecondaryButton>
          <SecondaryButton
            data-refreshing={isRefreshing ? "true" : undefined}
            disabled={isRefreshing}
            onClick={() => {
              refreshAll({ force: true });
            }}
            type="button"
          >
            <RefreshIconSlot data-spinning={isRefreshing ? "true" : undefined}>
              <ButtonRefreshIcon aria-hidden="true" />
            </RefreshIconSlot>
            <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
          </SecondaryButton>
          <SecondaryButton
            data-refreshing={isDeepScanning ? "true" : undefined}
            disabled={isDeepScanning}
            onClick={() => {
              loadDeepScan({ force: true });
            }}
            type="button"
          >
            <RefreshIconSlot data-spinning={isDeepScanning ? "true" : undefined}>
              <ButtonProcessIcon aria-hidden="true" />
            </RefreshIconSlot>
            <span>{isDeepScanning ? "Scanning..." : "Deep scan"}</span>
          </SecondaryButton>
        </ProcessHeaderActions>
      </ProcessHeader>

      {(error || killState.message || dockerActionState.message) && (
        <ProcessMessageStack>
          {error && <FormMessage $state="error">{error}</FormMessage>}
          {killState.message && (
            <ProcessInlineMessage data-state={killState.state}>
              {killState.message}
            </ProcessInlineMessage>
          )}
          {dockerActionState.message && (
            <ProcessInlineMessage data-state={dockerActionState.state}>
              {dockerActionState.message}
            </ProcessInlineMessage>
          )}
        </ProcessMessageStack>
      )}

      <ProcessMainSplit>
        <ProcessTopPane>
          {showEnergyDiagnostics && <ProcessEnergySection energy={energy} />}

          {deepScanError && <FormMessage $state="error">{deepScanError}</FormMessage>}
          {deepScanSnapshot && (
            <ProcessDeepScanPanel aria-label="Deep process scan results">
              <ProcessDeepScanHeader>
                <div>
                  <strong>Deep scan</strong>
                  <span>
                    {visibleProcesses.length} shown / {formatCpu(totalCpuPercent)} / {formatBytes(totalMemoryBytes)}
                    {highActivityCount ? ` / ${highActivityCount} hot` : ""}
                  </span>
                </div>
                <SecondaryButton
                  onClick={() => {
                    setDeepScanSnapshot(null);
                    setDeepScanError("");
                  }}
                  type="button"
                >
                  <ButtonDeleteIcon aria-hidden="true" />
                  <span>Clear</span>
                </SecondaryButton>
              </ProcessDeepScanHeader>
              {visibleProcesses.length === 0 ? (
                <ProcessContainersNotice>No process rows found.</ProcessContainersNotice>
              ) : (
                <ProcessBucketsGrid>
                  {buckets.filter((bucket) => bucket.processes.length).map((bucket) => (
                    <ProcessBucket
                      bucket={bucket}
                      dockerActionState={dockerActionState}
                      key={bucket.id}
                      onDockerAction={beginDockerAction}
                      onStopProcess={beginStopProcess}
                    />
                  ))}
                </ProcessBucketsGrid>
              )}
            </ProcessDeepScanPanel>
          )}
        </ProcessTopPane>

        <ProcessDockerPane>
          {dockerActionState.result && (
            <ProcessDockerActionLog result={dockerActionState.result} />
          )}

          <ProcessContainersPanel aria-label="Docker containers">
            <ProcessContainersHeader>
              <strong>Containers</strong>
              <span data-tone={containersSnapshot?.daemonRunning ? "ok" : "warn"}>
                {!containersSnapshot
                  ? "Loading Docker state"
                  : containersSnapshot.state === "cli_missing"
                    ? "Docker CLI missing"
                    : containersSnapshot.daemonRunning
                      ? `${containers.length} total / ${runningContainerCount} running`
                      : "Docker daemon offline"}
              </span>
            </ProcessContainersHeader>
            <ProcessContainersMessages>
              {containersError && <FormMessage $state="error">{containersError}</FormMessage>}
              {containerFeedback?.message && (
                <ProcessInlineMessage data-state={containerFeedback.state}>
                  {containerFeedback.message}
                </ProcessInlineMessage>
              )}
            </ProcessContainersMessages>
            <ProcessContainersBody>
              {!containersSnapshot ? (
                <ProcessContainersNotice>Loading Docker containers...</ProcessContainersNotice>
              ) : containersSnapshot.state === "cli_missing" ? (
                <ProcessContainersNotice>
                  {containersSnapshot.message || "Docker CLI is not available."}
                </ProcessContainersNotice>
              ) : !containersSnapshot.daemonRunning ? (
                <ProcessContainersNotice>
                  The docker CLI is installed but the daemon is not reachable.
                  {containersSnapshot.message ? ` ${containersSnapshot.message}` : ""}
                </ProcessContainersNotice>
              ) : containerGroups.length === 0 ? (
                <ProcessContainersNotice>No containers yet.</ProcessContainersNotice>
              ) : (
                <ProcessContainersList role="list">
                  {containerGroups.map((group) => (
                    <Fragment key={group.id}>
                      {group.label && (
                        <ProcessContainersGroupLabel>{group.label}</ProcessContainersGroupLabel>
                      )}
                      {group.containers.map((container) => (
                        <DockerContainerRow
                          busyAction={containerBusy[container.id] || ""}
                          container={container}
                          disabled={false}
                          key={container.id}
                          logsOpen={containerLogs?.id === container.id}
                          onAction={beginContainerAction}
                          onToggleLogs={toggleContainerLogs}
                        />
                      ))}
                    </Fragment>
                  ))}
                </ProcessContainersList>
              )}
            </ProcessContainersBody>
            {containerLogs && containersSnapshot?.state !== "cli_missing" && (
              <ProcessContainerLogsPanel>
                <ProcessContainerLogsHeader>
                  <strong>{containerLogs.name}</strong>
                  <span>
                    {containerLogs.loading
                      ? "Loading logs..."
                      : `last 200 lines${containerLogs.truncated ? " (truncated)" : ""}`}
                  </span>
                  <ProcessDockerActionButton
                    aria-label="Refresh logs"
                    disabled={containerLogs.loading}
                    onClick={() => {
                      const container = (containersSnapshot?.containers || [])
                        .find((candidate) => candidate.id === containerLogs.id);
                      void fetchContainerLogs(container || { id: containerLogs.id, name: containerLogs.name });
                    }}
                    title="Refresh logs"
                    type="button"
                  >
                    <ButtonRefreshIcon aria-hidden="true" />
                  </ProcessDockerActionButton>
                  <ProcessDockerActionButton
                    aria-label="Close logs"
                    onClick={() => setContainerLogs(null)}
                    title="Close logs"
                    type="button"
                  >
                    <ButtonDeleteIcon aria-hidden="true" />
                  </ProcessDockerActionButton>
                </ProcessContainerLogsHeader>
                {containerLogs.error ? (
                  <FormMessage $state="error">{containerLogs.error}</FormMessage>
                ) : (
                  <ProcessDockerOutput>
                    {containerLogs.loading
                      ? "..."
                      : containerLogs.output || "No log output."}
                  </ProcessDockerOutput>
                )}
              </ProcessContainerLogsPanel>
            )}
          </ProcessContainersPanel>
        </ProcessDockerPane>
      </ProcessMainSplit>

      {confirmAction && (
        <ProcessConfirmOverlay role="presentation">
          <ProcessConfirmDialog aria-labelledby="process-confirm-title" aria-modal="true" role="dialog">
            <PanelKicker>{confirmAction.terminalTargets?.length ? "Diff Forge terminal" : "Process control"}</PanelKicker>
            <PanelHeading id="process-confirm-title">{confirmAction.actionLabel}?</PanelHeading>
            <SettingsHint>
              {confirmAction.label} / {confirmAction.detail}
              {confirmAction.includeTree ? " including child processes" : ""}.
            </SettingsHint>
            {killState.state === "error" && killState.message && (
              <FormMessage $state="error">{killState.message}</FormMessage>
            )}
            <ProcessConfirmActions>
              <SecondaryButton
                disabled={killState.state === "killing"}
                onClick={() => setConfirmAction(null)}
                type="button"
              >
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryDangerButton
                disabled={killState.state === "killing"}
                onClick={confirmKill}
                type="button"
              >
                <ButtonDeleteIcon aria-hidden="true" />
                <span>{killState.state === "killing" ? confirmAction.pendingLabel : confirmAction.buttonLabel}</span>
              </PrimaryDangerButton>
            </ProcessConfirmActions>
          </ProcessConfirmDialog>
        </ProcessConfirmOverlay>
      )}

      {dockerConfirmAction && (
        <ProcessConfirmOverlay role="presentation">
          <ProcessConfirmDialog aria-labelledby="docker-confirm-title" aria-modal="true" role="dialog">
            <PanelKicker>Docker action</PanelKicker>
            <PanelHeading id="docker-confirm-title">{dockerConfirmAction.label}?</PanelHeading>
            <SettingsHint>
              {dockerConfirmAction.processLabel} / {dockerConfirmAction.detail}
            </SettingsHint>
            {dockerActionState.state === "error" && dockerActionState.message && (
              <FormMessage $state="error">{dockerActionState.message}</FormMessage>
            )}
            <ProcessConfirmActions>
              <SecondaryButton
                disabled={dockerActionState.state === "running"}
                onClick={() => setDockerConfirmAction(null)}
                type="button"
              >
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryDangerButton
                disabled={dockerActionState.state === "running"}
                onClick={confirmDockerAction}
                type="button"
              >
                <ButtonHubIcon aria-hidden="true" />
                <span>
                  {dockerActionState.state === "running"
                    ? dockerConfirmAction.pendingLabel
                    : dockerConfirmAction.buttonLabel}
                </span>
              </PrimaryDangerButton>
            </ProcessConfirmActions>
          </ProcessConfirmDialog>
        </ProcessConfirmOverlay>
      )}

      {containerConfirm && (
        <ProcessConfirmOverlay role="presentation">
          <ProcessConfirmDialog aria-labelledby="container-confirm-title" aria-modal="true" role="dialog">
            <PanelKicker>Docker container</PanelKicker>
            <PanelHeading id="container-confirm-title">
              {containerActionTitle(containerConfirm.action)}?
            </PanelHeading>
            <SettingsHint>
              {containerConfirm.container?.name || containerConfirm.container?.id}
              {" / "}
              {containerDisplayImage(containerConfirm.container?.image)}
              {containerConfirm.action === "remove"
                ? " — the container and its writable layer are deleted. Volumes are kept."
                : ""}
            </SettingsHint>
            <ProcessConfirmActions>
              <SecondaryButton onClick={() => setContainerConfirm(null)} type="button">
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryDangerButton onClick={confirmContainerAction} type="button">
                <ButtonDeleteIcon aria-hidden="true" />
                <span>Remove</span>
              </PrimaryDangerButton>
            </ProcessConfirmActions>
          </ProcessConfirmDialog>
        </ProcessConfirmOverlay>
      )}
    </ProcessSurface>
  );
}

const ProcessSurface = styled.section`
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  gap: 10px;
  overflow: hidden;
  padding: 16px;
  background:
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(13, 17, 23, 0.18);
  background-size: 72px 72px, 72px 72px, auto;

  html[data-forge-theme="light"] & {
    background: var(--forge-bg);
  }

  @media (max-width: 760px) {
    padding: 12px;
  }
`;

const ProcessMessageStack = styled.div`
  display: grid;
  min-width: 0;
  flex: 0 0 auto;
  gap: 8px;
`;

const ProcessMainSplit = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;

  @media (max-width: 760px) {
    grid-template-rows: minmax(260px, 1fr) minmax(240px, 1fr);
    overflow: auto;
  }
`;

const ProcessTopPane = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(128px, 0.46fr) minmax(0, 1fr);
  gap: 8px;
  overflow: hidden;
`;

const ProcessDockerPane = styled.section`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;

  > section[aria-label="Docker containers"] {
    flex: 1 1 auto;
  }
`;

const ProcessHeader = styled.header`
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  > div:first-child {
    min-width: 0;
  }

  @media (max-width: 980px) {
    flex-direction: column;
  }
`;

const ProcessHeaderActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-height: 36px;
  }

  @media (max-width: 980px) {
    width: 100%;
    justify-content: flex-start;
  }
`;

const processRefreshSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const RefreshIconSlot = styled.span`
  display: inline-grid;
  width: 16px;
  height: 16px;
  place-items: center;
  line-height: 0;

  &[data-spinning="true"] {
    animation: ${processRefreshSpin} 850ms linear infinite;
  }

  svg {
    display: block;
  }
`;

const ProcessMetric = styled.span`
  display: grid;
  min-width: 76px;
  gap: 3px;
  padding: 7px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(21, 27, 35, 0.56);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  strong {
    color: var(--forge-text);
    font-size: 13px;
    font-weight: 820;
    line-height: 1;
  }

  &[data-tone="hot"] {
    border-color: rgba(223, 165, 90, 0.32);
    background: rgba(223, 165, 90, 0.08);

    strong {
      color: #e5bd83;
    }
  }

  &[data-tone="warm"] {
    border-color: rgba(255, 180, 76, 0.26);
    background: rgba(255, 180, 76, 0.07);

    strong {
      color: #ffcf8b;
    }
  }

  &[data-tone="active"] {
    border-color: rgba(125, 176, 255, 0.24);
    background: rgba(125, 176, 255, 0.07);

    strong {
      color: #9cc4ff;
    }
  }
`;

const ProcessInlineMessage = styled.p`
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: rgba(21, 27, 35, 0.5);
  font-size: 12px;
  font-weight: 650;

  &[data-state="done"] {
    border-color: rgba(60, 203, 127, 0.28);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.08);
  }

  &[data-state="error"] {
    border-color: rgba(239, 107, 107, 0.28);
    color: #ffc8c8;
    background: rgba(239, 107, 107, 0.08);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

const ProcessEnergyPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 8px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(125, 176, 255, 0.045), rgba(230, 236, 245, 0.012)),
    rgba(8, 11, 16, 0.56);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

const ProcessEnergyHeader = styled.header`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;

  > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong {
    overflow: hidden;
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 820;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 640;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 620px) {
    align-items: start;
    grid-template-columns: minmax(0, 1fr);
  }
`;

const ProcessEnergyTotal = styled.span`
  display: grid;
  min-width: 72px;
  gap: 2px;
  justify-items: end;

  span {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-weight: 780;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  strong {
    color: var(--forge-text);
    font-size: 16px;
    font-weight: 860;
    line-height: 1;
  }

  &[data-tone="hot"] strong {
    color: #ffcf8b;
  }

  &[data-tone="warm"] strong {
    color: #ffd7a1;
  }

  &[data-tone="active"] strong {
    color: #9cc4ff;
  }

  @media (max-width: 620px) {
    justify-items: start;
  }
`;

const ProcessEnergyList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 3px;
  overflow: auto;
  padding-right: 2px;
`;

const ProcessEnergyRow = styled.div`
  display: grid;
  min-width: 0;
  min-height: 34px;
  grid-template-columns: minmax(180px, 1fr) minmax(80px, 0.35fr) max-content;
  align-items: center;
  gap: 9px;
  padding: 4px 5px;
  border-radius: 7px;
  background: rgba(230, 236, 245, 0.026);

  &[data-tone="hot"] {
    background: rgba(223, 165, 90, 0.075);
  }

  &[data-tone="warm"] {
    background: rgba(255, 180, 76, 0.055);
  }

  &[data-tone="active"] {
    background: rgba(125, 176, 255, 0.055);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr) max-content;
  }
`;

const ProcessEnergyMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong {
    overflow: hidden;
    color: var(--forge-text-soft);
    font-size: 11px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ProcessEnergyTrack = styled.div`
  height: 6px;
  min-width: 70px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(230, 236, 245, 0.075);

  span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #5ede99, #7db0ff);
  }

  html[data-forge-theme="light"] & {
    background: rgba(0, 102, 204, 0.1);
  }

  @media (max-width: 720px) {
    grid-column: 1 / -1;
  }
`;

const ProcessEnergyNumbers = styled.div`
  display: grid;
  min-width: 118px;
  justify-items: end;
  gap: 2px;
  text-align: right;

  strong {
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 820;
    line-height: 1;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 9.5px;
    font-weight: 650;
    white-space: nowrap;
  }
`;

const ProcessEnergyEmpty = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 640;
`;

const ProcessEnergyNote = styled.p`
  margin: 0;
  color: rgba(230, 236, 245, 0.42);
  font-size: 10px;
  font-weight: 620;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

const ProcessDockerLogPanel = styled.section`
  display: grid;
  min-width: 0;
  max-height: min(250px, 34vh);
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(8, 11, 16, 0.72);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }

  &[data-state="done"] {
    border-color: rgba(60, 203, 127, 0.2);
  }

  &[data-state="error"] {
    border-color: rgba(239, 107, 107, 0.24);
  }
`;

const ProcessDockerLogHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--forge-border);

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 820;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    flex: 0 0 auto;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 720;
    white-space: nowrap;
  }

  @media (max-width: 560px) {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
`;

const ProcessDockerLogList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 6px;
  overflow: auto;
  padding: 8px;
`;

const ProcessDockerLogEntry = styled.article`
  display: grid;
  min-width: 0;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 7px;
  background: rgba(21, 27, 35, 0.44);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }

  &[data-success="true"] {
    border-color: rgba(60, 203, 127, 0.18);
  }

  &[data-success="false"] {
    border-color: rgba(239, 107, 107, 0.26);
    background: rgba(239, 107, 107, 0.06);
  }

  &[data-success="skipped"] {
    border-color: rgba(223, 165, 90, 0.22);
  }
`;

const ProcessDockerLogEntryTop = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-soft);
    font-size: 12px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    flex: 0 0 auto;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 760;
    text-transform: uppercase;
    white-space: nowrap;
  }
`;

const ProcessDockerLogMeta = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;

  span {
    display: inline-flex;
    max-width: 100%;
    min-width: 0;
    align-items: center;
    gap: 4px;
    padding: 3px 5px;
    border: 1px solid rgba(125, 160, 205, 0.14);
    border-radius: 6px;
    color: var(--forge-text-muted);
    background: rgba(59, 130, 246, 0.045);
    font-size: 10px;
    font-weight: 680;
  }

  code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--forge-blue-soft);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 10px;
  }
`;

const ProcessDockerCommandLine = styled.code`
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
  color: #d7dde6;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 10px;
  line-height: 1.45;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-soft);
  }
`;

const ProcessDockerOutput = styled.pre`
  max-height: 96px;
  margin: 0;
  overflow: auto;
  padding: 7px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 6px;
  color: #aeb9c8;
  background: rgba(0, 0, 0, 0.26);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 10px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text-soft);
    background: var(--forge-surface);
  }
`;

const ProcessDeepScanPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  overflow: hidden;
  padding: 8px 10px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 10px;
  background: rgba(230, 236, 245, 0.018);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

const ProcessDeepScanHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong {
    overflow: hidden;
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 10.5px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    min-height: 30px;
  }
`;

const ProcessBucketsGrid = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: repeat(auto-fit, minmax(260px, 324px));
  gap: 8px;
  align-items: start;
  align-content: start;
  justify-content: start;
  overflow: auto;
  padding-right: 2px;
`;

const ProcessBucketPanel = styled.section`
  display: grid;
  min-width: 0;
  height: clamp(210px, 48vh, 330px);
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;

  @media (max-width: 460px) {
    height: 210px;
  }
`;

const ProcessBucketList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 2px;
  overflow: auto;
  padding: 0;
`;

const processBusyPulse = keyframes`
  0%,
  20% {
    opacity: 1;
  }

  100% {
    opacity: 0.2;
  }
`;

const ProcessBucketRow = styled.div`
  position: relative;
  display: grid;
  height: 28px;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr) auto max-content max-content;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  padding: 2px 3px;
  border: 0;
  border-radius: 6px;
  background: transparent;

  &[data-hot="true"] {
    background: rgba(223, 165, 90, 0.035);
  }

  &:hover,
  &:focus-within {
    background: rgba(230, 236, 245, 0.045);
  }

  html[data-forge-theme="light"] &[data-hot="true"] {
    background: rgba(0, 102, 204, 0.04);
  }

  html[data-forge-theme="light"] &:hover,
  html[data-forge-theme="light"] &:focus-within {
    background: rgba(0, 102, 204, 0.06);
  }
`;

const ProcessRowIcon = styled.span`
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: var(--forge-text-soft);
  background: rgba(230, 236, 245, 0.035);

  svg {
    width: 12px;
    height: 12px;
  }

  &[data-kind="agent"],
  &[data-kind="diffforge"] {
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.08);
  }

  &[data-kind="docker"] {
    color: #e5bd83;
    background: rgba(223, 165, 90, 0.08);
  }

  &[data-kind="node"] {
    color: var(--forge-blue-soft);
    background: rgba(59, 130, 246, 0.1);
  }

  &[data-busy="true"] {
    color: #ffffff;
    background: transparent;
  }

  html[data-forge-theme="light"] &[data-busy="true"] {
    color: #111111;
  }
`;

const ProcessRowBusySpinner = styled.span`
  position: relative;
  display: block;
  width: 18px;
  height: 18px;
  color: currentColor;

  span {
    position: absolute;
    top: 1px;
    left: 50%;
    width: 3px;
    height: 6px;
    margin-left: -1.5px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.2;
    transform: rotate(calc(var(--segment) * 45deg));
    transform-origin: 1.5px 8px;
    animation: ${processBusyPulse} 900ms linear infinite;
    animation-delay: calc(var(--segment) * -112.5ms);
  }
`;

const ProcessRowMain = styled.div`
  min-width: 0;

  span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--forge-text-soft);
    font-size: 11px;
    font-weight: 680;
    line-height: 1;
  }
`;

const ProcessRowUsage = styled.div`
  display: inline-flex;
  min-width: max-content;
  align-items: baseline;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 5px;
  overflow: visible;
  color: var(--forge-text-muted);
  white-space: nowrap;

  strong,
  span {
    flex: 0 0 auto;
    overflow: visible;
    white-space: nowrap;
  }

  strong {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 760;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 660;
  }
`;

const ProcessRowPorts = styled.span`
  display: inline-flex;
  max-width: 52px;
  min-width: 0;
  height: 18px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0 5px;
  border: 1px solid rgba(125, 160, 205, 0.18);
  border-radius: 6px;
  color: var(--forge-blue-soft);
  background: rgba(59, 130, 246, 0.07);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 9px;
  font-weight: 760;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-empty="true"] {
    visibility: hidden;
    padding: 0;
    border: 0;
  }
`;

const ProcessRowActions = styled.div`
  display: inline-flex;
  min-width: max-content;
  align-items: center;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 3px;
`;

const ProcessDockerActionButton = styled.button`
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  appearance: none;
  color: rgba(255, 255, 255, 0.76);
  background: rgba(255, 255, 255, 0.035);
  line-height: 0;
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background 140ms ease;

  svg {
    display: block;
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.34);
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text-muted);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(0, 102, 204, 0.24);
    color: var(--forge-blue);
    background: var(--forge-surface);
  }

  &[data-danger="true"]:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.42);
    color: #ffc8c8;
    background: rgba(239, 107, 107, 0.1);
  }

  &[data-active="true"] {
    border-color: rgba(125, 176, 255, 0.45);
    color: #9cc4ff;
    background: rgba(125, 176, 255, 0.12);
  }

  &:disabled {
    opacity: 0.28;
    cursor: default;
  }
`;

const ProcessRowStopButton = styled.button`
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  appearance: none;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.045);
  line-height: 0;
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background 140ms ease;

  svg {
    display: block;
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.36);
    color: #ffffff;
    background: rgba(255, 255, 255, 0.12);
  }

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    color: var(--forge-text-muted);
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(180, 35, 24, 0.24);
    color: var(--forge-red);
    background: rgba(180, 35, 24, 0.08);
  }

  &:disabled {
    opacity: 0.22;
    cursor: default;
  }
`;

const ProcessConfirmOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(3, 5, 8, 0.54);
  backdrop-filter: blur(10px);

  html[data-forge-theme="light"] & {
    background: rgba(245, 245, 247, 0.76);
    backdrop-filter: saturate(180%) blur(20px);
  }
`;

const ProcessConfirmDialog = styled.section`
  display: grid;
  width: min(390px, 100%);
  gap: 12px;
  padding: 16px;
  border: 1px solid rgba(239, 107, 107, 0.26);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.04), rgba(244, 247, 250, 0.012)),
    rgba(13, 17, 23, 0.98);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
    box-shadow: none;
  }
`;

const ProcessConfirmActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  button {
    min-height: 38px;
  }
`;

const ProcessContainersPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 6px;
  overflow: hidden;
  padding: 8px 10px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 10px;
  background: rgba(230, 236, 245, 0.02);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
  }
`;

const ProcessContainersMessages = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;

  &:empty {
    display: none;
  }
`;

const ProcessContainersBody = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const ProcessContainersHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;

  strong {
    color: rgba(230, 236, 245, 0.92);
    font-size: 12px;
    font-weight: 760;
    letter-spacing: 0.02em;
  }

  > span {
    overflow: hidden;
    color: rgba(230, 236, 245, 0.5);
    font-size: 11px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > span[data-tone="warn"] {
    color: #ffb454;
  }

  html[data-forge-theme="light"] & strong {
    color: var(--forge-text);
  }

  html[data-forge-theme="light"] & > span {
    color: var(--forge-text-muted);
  }
`;

const ProcessContainersNotice = styled.p`
  margin: 0;
  color: rgba(230, 236, 245, 0.55);
  font-size: 11.5px;
  font-weight: 600;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

const ProcessContainersList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 2px;
  overflow: auto;
  padding-right: 2px;
`;

const ProcessContainersGroupLabel = styled.div`
  margin-top: 4px;
  overflow: hidden;
  color: rgba(230, 236, 245, 0.42);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

const ProcessContainerRow = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 30px;
  grid-template-columns: 18px minmax(140px, 1.2fr) minmax(0, 1fr) max-content max-content;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  padding: 2px 3px;
  border-radius: 6px;

  &:hover,
  &:focus-within {
    background: rgba(230, 236, 245, 0.045);
  }

  html[data-forge-theme="light"] &:hover,
  html[data-forge-theme="light"] &:focus-within {
    background: rgba(0, 102, 204, 0.06);
  }
`;

const ProcessContainerDot = styled.span`
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: rgba(230, 236, 245, 0.28);

  &[data-state="running"] {
    background: #4bd4aa;
    box-shadow: 0 0 6px rgba(75, 212, 170, 0.5);
  }

  &[data-state="running"][data-health="unhealthy"] {
    background: #ff6b6b;
    box-shadow: 0 0 6px rgba(255, 107, 107, 0.5);
  }

  &[data-state="restarting"],
  &[data-state="running"][data-health="starting"] {
    background: #ffb454;
  }

  &[data-state="paused"] {
    background: #ffd08a;
  }

  &[data-state="dead"] {
    background: #ff6b6b;
  }
`;

const ProcessContainerMain = styled.div`
  display: grid;
  min-width: 0;
  align-content: center;

  strong {
    overflow: hidden;
    color: rgba(230, 236, 245, 0.9);
    font-size: 11.5px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: rgba(230, 236, 245, 0.45);
    font-size: 10.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & strong {
    color: var(--forge-text);
  }

  html[data-forge-theme="light"] & span {
    color: var(--forge-text-muted);
  }
`;

const ProcessContainerStatus = styled.div`
  display: grid;
  min-width: 0;
  align-content: center;
  justify-items: end;
  text-align: right;

  span {
    overflow: hidden;
    color: rgba(230, 236, 245, 0.58);
    font-size: 10.5px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    overflow: hidden;
    color: rgba(125, 176, 255, 0.78);
    font-size: 10px;
    font-style: normal;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & span {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] & em {
    color: var(--forge-blue);
  }
`;

const ProcessContainerLogsPanel = styled.section`
  display: grid;
  min-width: 0;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 8px;
  background: rgba(2, 3, 4, 0.5);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface-control);
  }
`;

const ProcessContainerLogsHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;

  strong {
    overflow: hidden;
    color: rgba(230, 236, 245, 0.88);
    font-size: 11.5px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > span {
    flex: 1;
    overflow: hidden;
    color: rgba(230, 236, 245, 0.42);
    font-size: 10.5px;
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & strong {
    color: var(--forge-text);
  }

  html[data-forge-theme="light"] & > span {
    color: var(--forge-text-muted);
  }
`;
