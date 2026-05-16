import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

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

const PROCESS_REFRESH_MS = 6500;
const HIGH_CPU_PERCENT = 65;
const HIGH_MEMORY_BYTES = 1024 * 1024 * 1024;
const DOCKER_ACTIONS = {
  rebuildRelaunch: {
    buttonLabel: "Rebuild",
    detail: "Rebuild and recreate linked Docker Compose services.",
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
        {bucket.processes.map((process) => (
          <ProcessBucketRow
            data-hot={isHighUsage(process) ? "true" : "false"}
            key={processStableKey(process)}
            role="listitem"
            title={processCommandPreview(process)}
          >
            <ProcessRowIcon data-kind={process.groupKind || bucket.id}>
              <GroupIcon hint={process.iconHint} />
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
        ))}
      </ProcessBucketList>
    </ProcessBucketPanel>
  );
}

export default function ProcessesView({
  onCloseTrackedTerminal,
  workspaceRoots = [],
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [refreshState, setRefreshState] = useState("idle");
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [dockerConfirmAction, setDockerConfirmAction] = useState(null);
  const [dockerActionState, setDockerActionState] = useState({ state: "idle", message: "" });
  const [killState, setKillState] = useState({ state: "idle", message: "" });
  const mountedRef = useRef(false);
  const processOrderCounterRef = useRef(0);
  const processOrderRef = useRef(new Map());

  const normalizedWorkspaceRoots = useMemo(
    () => normalizeProcessRoots(workspaceRoots),
    [workspaceRoots],
  );
  const workspaceRootsKey = normalizedWorkspaceRoots.join("\n");

  const loadProcesses = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setRefreshState("loading");
    } else {
      setRefreshState((state) => (state === "loading" ? state : "refreshing"));
    }

    try {
      const result = await invoke("list_developer_processes", {
        activeWorkspaceRoot: "",
        workspaceRoots: normalizedWorkspaceRoots,
      });

      if (!mountedRef.current) {
        return;
      }

      setSnapshot(result);
      setError("");
      setRefreshState("idle");
    } catch (loadError) {
      if (!mountedRef.current) {
        return;
      }

      setError(errorMessage(loadError));
      setRefreshState("idle");
    }
  }, [workspaceRootsKey]);

  useEffect(() => {
    mountedRef.current = true;
    loadProcesses();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        loadProcesses({ silent: true });
      }
    }, PROCESS_REFRESH_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, [loadProcesses]);

  const allProcesses = Array.isArray(snapshot?.processes) ? snapshot.processes : [];
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
      processLabel: processBlurb(process),
    });
    setDockerActionState({ state: "idle", message: "" });
  }, []);

  const confirmDockerAction = useCallback(async () => {
    if (!dockerConfirmAction || dockerActionState.state === "running") {
      return;
    }

    setDockerActionState({ state: "running", message: "" });

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
      });
      await loadProcesses({ silent: true });
    } catch (actionError) {
      setDockerActionState({
        state: "error",
        message: errorMessage(actionError, "Unable to run Docker action."),
      });
    }
  }, [
    dockerActionState.state,
    dockerConfirmAction,
    loadProcesses,
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

    await loadProcesses({ silent: true });

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
  }, [confirmAction, killState.state, loadProcesses, onCloseTrackedTerminal]);

  return (
    <ProcessSurface>
      <ProcessHeader>
        <div>
          <PanelKicker>Processes</PanelKicker>
          <PanelHeading>Developer process monitor</PanelHeading>
          <PageSubline>{snapshot?.platform || "native"} desktop snapshot / global controls</PageSubline>
        </div>
        <ProcessHeaderActions>
          <ProcessMetric>
            <span>Total</span>
            <strong>{visibleProcesses.length}</strong>
          </ProcessMetric>
          <ProcessMetric data-tone={highActivityCount > 0 ? "hot" : "neutral"}>
            <span>Hot</span>
            <strong>{highActivityCount}</strong>
          </ProcessMetric>
          <ProcessMetric>
            <span>CPU</span>
            <strong>{formatCpu(totalCpuPercent)}</strong>
          </ProcessMetric>
          <ProcessMetric>
            <span>Memory</span>
            <strong>{formatBytes(totalMemoryBytes)}</strong>
          </ProcessMetric>
          <SecondaryButton disabled={refreshState === "loading"} onClick={() => loadProcesses()} type="button">
            <ButtonRefreshIcon aria-hidden="true" />
            <span>{refreshState === "loading" ? "Refreshing..." : "Refresh"}</span>
          </SecondaryButton>
        </ProcessHeaderActions>
      </ProcessHeader>

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
    </ProcessSurface>
  );
}

const ProcessSurface = styled.section`
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  align-content: start;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
  padding: 16px;
  background:
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(13, 17, 23, 0.18);
  background-size: 72px 72px, 72px 72px, auto;

  @media (max-width: 760px) {
    padding: 12px;
  }
`;

const ProcessHeader = styled.header`
  display: flex;
  min-width: 0;
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

const ProcessMetric = styled.span`
  display: grid;
  min-width: 76px;
  gap: 3px;
  padding: 7px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(21, 27, 35, 0.56);

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
`;

const ProcessBucketsGrid = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: repeat(auto-fit, minmax(236px, 292px));
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

const ProcessBucketRow = styled.div`
  position: relative;
  display: grid;
  height: 28px;
  min-width: 0;
  grid-template-columns: 18px minmax(34px, 1fr) minmax(0, auto) 58px auto;
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
  min-width: 0;
  align-items: baseline;
  justify-content: flex-end;
  gap: 5px;
  overflow: hidden;
  color: var(--forge-text-muted);

  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
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
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
`;

const ProcessDockerActionButton = styled.button`
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.76);
  background: rgba(255, 255, 255, 0.035);
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background 140ms ease;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.34);
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  &[data-danger="true"]:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.42);
    color: #ffc8c8;
    background: rgba(239, 107, 107, 0.1);
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
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.045);
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background 140ms ease;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.36);
    color: #ffffff;
    background: rgba(255, 255, 255, 0.12);
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
`;

const ProcessConfirmActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  button {
    min-height: 38px;
  }
`;
