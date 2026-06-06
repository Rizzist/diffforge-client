import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check } from "@styled-icons/material-rounded/Check";
import { Close } from "@styled-icons/material-rounded/Close";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import { FormMessage } from "../app/appStyles";

const TERMINAL_TASK_PLAN_UPDATED_EVENT = "forge-terminal-task-plan-updated";
const PLAN_SNAPSHOT_CACHE_LIMIT = 80;
const PLAN_SNAPSHOT_CACHE_FRESH_MS = 5000;
const PLAN_SNAPSHOT_FOCUS_SETTLE_MS = 700;
const planSnapshotCache = new Map();
const planSnapshotRequests = new Map();

const EMPTY_TARGET = Object.freeze({
  agentId: "",
  dbPath: "",
  mountId: "",
  paneId: "",
  repoPath: "",
  sessionId: "",
  taskId: "",
  terminalIndex: null,
  workspaceId: "",
});

function dataOf(response) {
  return response?.data || response || {};
}

function cleanText(value) {
  return String(value || "").trim();
}

function pathIdentity(value) {
  const cleaned = cleanText(value).replace(/\\/g, "/");
  return cleaned === "/" ? cleaned : cleaned.replace(/\/+$/g, "").toLowerCase();
}

function planSnapshotCacheKey({
  agentId = "",
  dbPath = "",
  repoPath = "",
  sessionId = "",
  taskId = "",
  workspaceId = "",
}) {
  const scope = [
    cleanText(workspaceId),
    pathIdentity(repoPath),
    pathIdentity(dbPath),
  ].join("|");
  const target = [
    cleanText(taskId),
    cleanText(sessionId),
    cleanText(agentId),
  ].join("|");
  return `${scope}|${target}`;
}

function planSnapshotRepoCacheKey({ dbPath = "", repoPath = "", workspaceId = "" }) {
  return [
    cleanText(workspaceId),
    pathIdentity(repoPath),
    pathIdentity(dbPath),
    "repo",
  ].join("|");
}

function trimPlanSnapshotCache() {
  while (planSnapshotCache.size > PLAN_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = planSnapshotCache.keys().next().value;
    if (!oldestKey) return;
    planSnapshotCache.delete(oldestKey);
  }
}

function cachePlanSnapshot(keys, snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const entry = {
    snapshot,
    updatedAt: Date.now(),
  };
  if (keys?.exact) {
    planSnapshotCache.delete(keys.exact);
    planSnapshotCache.set(keys.exact, entry);
  }
  if (keys?.repo) {
    planSnapshotCache.delete(keys.repo);
    planSnapshotCache.set(keys.repo, entry);
  }
  trimPlanSnapshotCache();
}

function cachedPlanSnapshotEntry(keys) {
  if (!keys) return null;
  if (keys.exact && planSnapshotCache.has(keys.exact)) {
    return planSnapshotCache.get(keys.exact);
  }
  if (keys.repo && planSnapshotCache.has(keys.repo)) {
    return planSnapshotCache.get(keys.repo);
  }
  return null;
}

function cachedPlanSnapshot(keys) {
  const entry = cachedPlanSnapshotEntry(keys);
  if (!entry) return null;
  return entry.snapshot || entry;
}

function cachedPlanSnapshotIsFresh(keys) {
  const entry = cachedPlanSnapshotEntry(keys);
  if (!entry?.snapshot || !Number.isFinite(Number(entry.updatedAt))) {
    return false;
  }
  return Date.now() - Number(entry.updatedAt) <= PLAN_SNAPSHOT_CACHE_FRESH_MS;
}

function planSnapshotRequestKey(keys) {
  return keys?.exact || keys?.repo || "";
}

function normalizeRepoTarget(value) {
  const target = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const repoPath = cleanText(target?.repoPath || target?.repo_path);
  if (!repoPath) {
    return null;
  }
  return {
    repoPath,
    dbPath: cleanText(target?.dbPath || target?.db_path),
    mountId: cleanText(target?.mountId || target?.mount_id),
    projectName: cleanText(target?.projectName || target?.project_name),
    projectKind: cleanText(target?.projectKind || target?.project_kind),
    workspaceRelativePath: cleanText(target?.workspaceRelativePath || target?.workspace_relative_path),
  };
}

function repoTargetLabel(target) {
  return cleanText(target?.workspaceRelativePath)
    || cleanText(target?.projectName)
    || cleanText(target?.repoPath).split(/[\\/]/).filter(Boolean).pop()
    || "Repository";
}

function dedupeRepoTargets(targets) {
  const seen = new Set();
  return (Array.isArray(targets) ? targets : [])
    .map(normalizeRepoTarget)
    .filter(Boolean)
    .filter((target) => {
      const key = pathIdentity(target.repoPath);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function initialSelectedRepoPath(repoTargets, rootDirectory, target) {
  const preferred = cleanText(target?.repoPath || rootDirectory);
  if (preferred) return preferred;
  return dedupeRepoTargets(repoTargets)[0]?.repoPath || "";
}

function stepStatusLabel(status) {
  const normalized = cleanText(status).toLowerCase();
  if (["active", "current", "in_progress", "in-progress", "running", "working"].includes(normalized)) {
    return "In progress";
  }
  if (normalized === "pending") {
    return "Pending";
  }
  if (["complete", "completed", "done", "finished", "success"].includes(normalized)) {
    return "Completed";
  }
  if (normalized === "blocked") {
    return "Blocked";
  }
  if (normalized === "skipped") {
    return "Skipped";
  }
  return "Queued";
}

function planStatusLabel(status) {
  const normalized = normalizedPlanStatus(status);
  if (normalized === "completed") {
    return "Completed";
  }
  if (normalized === "interrupted") {
    return "Interrupted";
  }
  if (normalized === "blocked") {
    return "Blocked";
  }
  return "Active";
}

function normalizedPlanStatus(status) {
  const normalized = cleanText(status).toLowerCase();
  if (["complete", "completed", "done", "finished", "success"].includes(normalized)) {
    return "completed";
  }
  if (["interrupt", "interrupted", "cancelled", "canceled", "stopped"].includes(normalized)) {
    return "interrupted";
  }
  if (normalized === "blocked") {
    return "blocked";
  }
  return "active";
}

function planIsTerminal(plan) {
  const normalized = normalizedPlanStatus(plan?.status);
  return normalized === "completed" || normalized === "interrupted";
}

function planCanContinue(plan) {
  return normalizedPlanStatus(plan?.status) === "interrupted";
}

function normalizedStepStatus(status) {
  const normalized = cleanText(status).toLowerCase();
  if (["complete", "completed", "done", "finished", "success"].includes(normalized)) {
    return "completed";
  }
  if ([
    "active",
    "current",
    "in_progress",
    "in-progress",
    "running",
    "working",
  ].includes(normalized)) {
    return "in_progress";
  }
  if (normalized === "blocked") {
    return "blocked";
  }
  if (normalized === "skipped") {
    return "skipped";
  }
  return "queued";
}

function planStepUserEditable(step, plan) {
  if (!step || planIsTerminal(plan)) {
    return false;
  }
  return step.editable === true
    || ["queued", "blocked"].includes(normalizedStepStatus(step.status));
}

function planIdentity(plan) {
  return cleanText(plan?.plan_id) || cleanText(plan?.task_id);
}

function planStepSaveKey(taskId, stepIndex) {
  const safeTaskId = cleanText(taskId);
  const safeStepIndex = Number(stepIndex);
  return safeTaskId && Number.isInteger(safeStepIndex) ? `${safeTaskId}:${safeStepIndex}` : "";
}

function planStepSaveForStep(pendingSaves, taskId, stepIndex) {
  const key = planStepSaveKey(taskId, stepIndex);
  return key ? pendingSaves?.[key] || null : null;
}

function withPlanStepTitle(plan, taskId, stepIndex, title, fields = {}) {
  const safeTaskId = cleanText(taskId);
  const safeStepIndex = Number(stepIndex);
  const safeTitle = cleanText(title);
  if (
    !plan
    || !safeTaskId
    || !Number.isInteger(safeStepIndex)
    || !safeTitle
    || cleanText(plan.task_id || plan.taskId) !== safeTaskId
    || !Array.isArray(plan.steps)
  ) {
    return plan;
  }

  let changed = false;
  const nextSteps = plan.steps.map((step) => {
    if (Number(step?.index) !== safeStepIndex) {
      return step;
    }
    changed = true;
    return {
      ...step,
      title: safeTitle,
      ...(fields.source ? { source: fields.source } : {}),
      ...(fields.pendingSync ? { pending_sync: true, pendingSync: true } : {}),
      ...(fields.syncError ? { sync_error: fields.syncError, syncError: fields.syncError } : {}),
    };
  });

  if (!changed) {
    return plan;
  }

  return {
    ...plan,
    steps: nextSteps,
    updated_at: fields.updatedAt || plan.updated_at,
    updatedAt: fields.updatedAt || plan.updatedAt,
  };
}

function withSnapshotPlanStepTitle(snapshot, taskId, stepIndex, title, fields = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot || null;
  }
  const updatePlan = (plan) => withPlanStepTitle(plan, taskId, stepIndex, title, fields);
  return {
    ...snapshot,
    selected_plan: updatePlan(snapshot.selected_plan || snapshot.selectedPlan || null),
    history: Array.isArray(snapshot.history) ? snapshot.history.map(updatePlan) : [],
  };
}

function applyPendingPlanStepSaves(snapshot, pendingSaves = {}) {
  let nextSnapshot = snapshot;
  Object.values(pendingSaves || {}).forEach((pendingSave) => {
    if (!pendingSave?.title) {
      return;
    }
    nextSnapshot = withSnapshotPlanStepTitle(
      nextSnapshot,
      pendingSave.taskId,
      pendingSave.stepIndex,
      pendingSave.title,
      {
        pendingSync: pendingSave.status !== "error",
        source: "user",
        syncError: pendingSave.status === "error" ? pendingSave.error || "Sync failed" : "",
        updatedAt: pendingSave.updatedAt,
      },
    );
  });
  return nextSnapshot;
}

function planEventText(payload, keys) {
  const refs = payload?.refs || {};
  const nestedPayload = payload?.payload || {};
  for (const key of keys) {
    const value = cleanText(refs[key] || payload?.[key] || nestedPayload?.[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function planEventSnapshot(payload) {
  const snapshot = dataOf(
    payload?.planSnapshot
      || payload?.plan_snapshot
      || payload?.snapshot
      || payload?.data?.planSnapshot
      || payload?.data?.plan_snapshot
      || null,
  );
  if (snapshot?.selected_plan || snapshot?.selectedPlan || Array.isArray(snapshot?.history)) {
    return {
      ...snapshot,
      selected_plan: snapshot.selected_plan || snapshot.selectedPlan || null,
      history: Array.isArray(snapshot.history) ? snapshot.history : [],
    };
  }

  const plan = payload?.plan || payload?.selectedPlan || payload?.selected_plan || null;
  if (plan && typeof plan === "object") {
    return {
      history: [plan],
      selected_plan: plan,
      title_max_chars: plan.title_max_chars || plan.titleMaxChars,
    };
  }
  return null;
}

function mergePlanEventSnapshot(current, eventSnapshot) {
  if (!eventSnapshot || typeof eventSnapshot !== "object") {
    return current || null;
  }
  const eventPlan = eventSnapshot.selected_plan || eventSnapshot.selectedPlan || null;
  const currentHistory = Array.isArray(current?.history) ? current.history : [];
  const eventHistory = Array.isArray(eventSnapshot.history) ? eventSnapshot.history : [];
  const mergedHistory = [...currentHistory];
  eventHistory.forEach((nextPlan) => {
    const nextIdentity = planIdentity(nextPlan);
    if (!nextIdentity) {
      return;
    }
    const existingIndex = mergedHistory.findIndex((candidate) => planIdentity(candidate) === nextIdentity);
    if (existingIndex >= 0) {
      mergedHistory[existingIndex] = {
        ...mergedHistory[existingIndex],
        ...nextPlan,
      };
    } else {
      mergedHistory.unshift(nextPlan);
    }
  });

  const selectedIdentity = planIdentity(current?.selected_plan);
  const eventIdentity = planIdentity(eventPlan);
  const selectedPlan = eventPlan && (!selectedIdentity || selectedIdentity === eventIdentity)
    ? eventPlan
    : current?.selected_plan || eventPlan || null;

  return {
    ...(current || {}),
    ...eventSnapshot,
    selected_plan: selectedPlan,
    history: mergedHistory,
    title_max_chars: eventSnapshot.title_max_chars || current?.title_max_chars,
  };
}

function stepStatusKind(status) {
  const normalized = normalizedStepStatus(status);
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "in_progress") {
    return "active";
  }
  if (normalized === "blocked") {
    return "blocked";
  }
  if (normalized === "skipped") {
    return "skipped";
  }
  return "queued";
}

function StepStatusGlyph({ status }) {
  const kind = stepStatusKind(status);

  if (kind === "completed") {
    return <Check aria-hidden="true" />;
  }

  if (kind === "active") {
    return <StepSpinner aria-hidden="true" />;
  }

  return <StepQueuedDot aria-hidden="true" />;
}

const stepSpinnerSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

function timestampLabel(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString([], {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

export default function PlansWorkspaceView({
  onResumePlan,
  repoTargets = [],
  rootDirectory = "",
  selectedTerminal = EMPTY_TARGET,
  workspace,
}) {
  const target = selectedTerminal || EMPTY_TARGET;
  const [selectedRepoPath, setSelectedRepoPath] = useState(() => (
    initialSelectedRepoPath(repoTargets, rootDirectory, target)
  ));
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [editingStepIndex, setEditingStepIndex] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pendingStepSaves, setPendingStepSaves] = useState({});
  const pendingStepSavesRef = useRef({});
  const stepSaveSequenceRef = useRef(0);
  const skipStepEditBlurCommitRef = useRef(false);
  const snapshotRequestKeyRef = useRef("");
  const planEventStateRef = useRef({
    loadSnapshot: null,
    rootPath: "",
    snapshotAgentId: "",
    snapshotSessionId: "",
    snapshotTaskId: "",
  });

  const normalizedRepoTargets = useMemo(() => {
    const targets = dedupeRepoTargets(repoTargets);
    if (targets.length) {
      return targets;
    }
    return dedupeRepoTargets([{
      repoPath: target.repoPath || rootDirectory,
      dbPath: target.dbPath || "",
      mountId: target.mountId || "",
    }]);
  }, [repoTargets, rootDirectory, target.dbPath, target.mountId, target.repoPath]);
  const preferredRepoPath = target.repoPath || rootDirectory;
  const activeRepoPath = useMemo(() => {
    const selectedKey = pathIdentity(selectedRepoPath);
    const selectedTarget = selectedKey
      ? normalizedRepoTargets.find((repoTarget) => pathIdentity(repoTarget.repoPath) === selectedKey)
      : null;
    const preferredKey = pathIdentity(preferredRepoPath);
    const preferredTarget = preferredKey
      ? normalizedRepoTargets.find((repoTarget) => pathIdentity(repoTarget.repoPath) === preferredKey)
      : null;
    return selectedTarget?.repoPath || preferredTarget?.repoPath || normalizedRepoTargets[0]?.repoPath || "";
  }, [normalizedRepoTargets, preferredRepoPath, selectedRepoPath]);
  const activeRepoTarget = useMemo(() => {
    const activeKey = pathIdentity(activeRepoPath);
    return activeKey
      ? normalizedRepoTargets.find((repoTarget) => pathIdentity(repoTarget.repoPath) === activeKey) || null
      : null;
  }, [activeRepoPath, normalizedRepoTargets]);
  const activeDbPath = activeRepoTarget?.dbPath || "";
  const targetMatchesActiveRepo = !target.repoPath
    || !activeRepoPath
    || pathIdentity(target.repoPath) === pathIdentity(activeRepoPath);
  const snapshotAgentId = targetMatchesActiveRepo ? target.agentId || "" : "";
  const snapshotSessionId = targetMatchesActiveRepo ? target.sessionId || "" : "";
  const snapshotTaskId = targetMatchesActiveRepo ? target.taskId || "" : "";
  const workspaceId = target.workspaceId || workspace?.id || "";
  const snapshotCacheKeys = useMemo(() => ({
    exact: planSnapshotCacheKey({
      agentId: snapshotAgentId,
      dbPath: activeDbPath,
      repoPath: activeRepoPath,
      sessionId: snapshotSessionId,
      taskId: snapshotTaskId,
      workspaceId,
    }),
    repo: planSnapshotRepoCacheKey({
      dbPath: activeDbPath,
      repoPath: activeRepoPath,
      workspaceId,
    }),
  }), [
    activeDbPath,
    activeRepoPath,
    snapshotAgentId,
    snapshotSessionId,
    snapshotTaskId,
    workspaceId,
  ]);
  const activeSnapshotRequestKey = snapshotCacheKeys.exact || snapshotCacheKeys.repo || "";
  const selectedPlan = snapshot?.selected_plan || null;
  const planCandidates = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const activePlanCandidate = planCandidates.find((plan) => !planIsTerminal(plan)) || null;
  const latestPlanCandidate = planCandidates[0] || null;
  const displayedPlan = selectedPlan && !planIsTerminal(selectedPlan)
    ? selectedPlan
    : activePlanCandidate || selectedPlan || latestPlanCandidate || null;
  const displayedPlanId = planIdentity(displayedPlan);
  const displayedPlanCanContinue = planCanContinue(displayedPlan);
  const titleMaxChars = Number(snapshot?.title_max_chars || displayedPlan?.title_max_chars || 96);

  const setPendingStepSaveRecord = useCallback((key, record) => {
    if (!key || !record) {
      return pendingStepSavesRef.current;
    }
    const next = {
      ...pendingStepSavesRef.current,
      [key]: record,
    };
    pendingStepSavesRef.current = next;
    setPendingStepSaves(next);
    return next;
  }, []);

  const clearPendingStepSaveRecord = useCallback((key, sequence) => {
    const current = pendingStepSavesRef.current;
    if (!key || !current[key] || current[key].sequence !== sequence) {
      return current;
    }
    const next = { ...current };
    delete next[key];
    pendingStepSavesRef.current = next;
    setPendingStepSaves(next);
    return next;
  }, []);

  const markPendingStepSaveError = useCallback((key, sequence, message) => {
    const current = pendingStepSavesRef.current;
    if (!key || !current[key] || current[key].sequence !== sequence) {
      return current;
    }
    const next = {
      ...current,
      [key]: {
        ...current[key],
        error: cleanText(message) || "Sync failed",
        status: "error",
      },
    };
    pendingStepSavesRef.current = next;
    setPendingStepSaves(next);
    return next;
  }, []);

  useEffect(() => {
    snapshotRequestKeyRef.current = activeSnapshotRequestKey;
    setSnapshot(applyPendingPlanStepSaves(
      cachedPlanSnapshot(snapshotCacheKeys),
      pendingStepSavesRef.current,
    ));
    setError("");
  }, [activeSnapshotRequestKey, snapshotCacheKeys]);

  useEffect(() => {
    if (activeRepoPath !== selectedRepoPath) {
      setSelectedRepoPath(activeRepoPath);
    }
  }, [activeRepoPath, selectedRepoPath]);

  useEffect(() => {
    const preferredKey = pathIdentity(preferredRepoPath);
    if (preferredKey && preferredKey !== pathIdentity(selectedRepoPath)) {
      setSelectedRepoPath(preferredRepoPath);
    }
  }, [preferredRepoPath, selectedRepoPath]);

  const loadSnapshot = useCallback(async (options = {}) => {
    const silent = options?.silent === true;
    if (!activeRepoPath) {
      setSnapshot(null);
      return;
    }
    if (!silent) {
      setError("");
    }
    try {
      const command = {
        repoPath: activeRepoPath,
        input: {
          agentId: snapshotAgentId,
          directRepoTarget: Boolean(activeRepoPath),
          sessionId: snapshotSessionId,
          taskId: snapshotTaskId,
        },
      };
      if (activeDbPath) {
        command.dbPath = activeDbPath;
      }
      const requestKey = planSnapshotRequestKey(snapshotCacheKeys);
      let request = requestKey ? planSnapshotRequests.get(requestKey) : null;
      if (!request) {
        request = invoke("coordination_terminal_task_plan_snapshot", command)
          .then(dataOf)
          .finally(() => {
            if (requestKey) {
              planSnapshotRequests.delete(requestKey);
            }
          });
        if (requestKey) {
          planSnapshotRequests.set(requestKey, request);
        }
      }
      const nextSnapshot = applyPendingPlanStepSaves(await request, pendingStepSavesRef.current);
      if (snapshotRequestKeyRef.current !== activeSnapshotRequestKey) {
        return;
      }
      cachePlanSnapshot(snapshotCacheKeys, nextSnapshot);
      setSnapshot(nextSnapshot);
    } catch (nextError) {
      if (!silent) {
        setError(cleanText(nextError?.message || nextError) || "Unable to load terminal plans.");
      }
    }
  }, [
    activeDbPath,
    activeRepoPath,
    activeSnapshotRequestKey,
    snapshotAgentId,
    snapshotCacheKeys,
    snapshotSessionId,
    snapshotTaskId,
  ]);

  useEffect(() => {
    const cachedSnapshot = cachedPlanSnapshot(snapshotCacheKeys);
    if (cachedSnapshot && cachedPlanSnapshotIsFresh(snapshotCacheKeys)) {
      return undefined;
    }
    const loadTimer = window.setTimeout(() => {
      loadSnapshot({ silent: Boolean(cachedSnapshot) });
    }, PLAN_SNAPSHOT_FOCUS_SETTLE_MS);
    return () => {
      window.clearTimeout(loadTimer);
    };
  }, [activeSnapshotRequestKey, loadSnapshot, snapshotCacheKeys]);

  useEffect(() => {
    planEventStateRef.current = {
      loadSnapshot,
      rootPath: pathIdentity(activeRepoPath),
      snapshotAgentId,
      snapshotCacheKeys,
      snapshotSessionId,
      snapshotTaskId,
    };
  }, [
    activeRepoPath,
    loadSnapshot,
    snapshotAgentId,
    snapshotCacheKeys,
    snapshotSessionId,
    snapshotTaskId,
  ]);

  useEffect(() => {
    if (!activeRepoPath) {
      return undefined;
    }

    let cancelled = false;
    let unlisten = null;
    const rootPath = pathIdentity(activeRepoPath);

    listen(TERMINAL_TASK_PLAN_UPDATED_EVENT, (event) => {
      const state = planEventStateRef.current || {};
      if (cancelled) {
        return;
      }

      const payload = event?.payload || {};
      const eventRepoPath = cleanText(payload.repoPath || payload.repo_path);
      const currentRootPath = state.rootPath || rootPath;
      if (eventRepoPath && currentRootPath && pathIdentity(eventRepoPath) !== currentRootPath) {
        return;
      }

      const eventTaskId = planEventText(payload, ["taskId", "task_id"]);
      const eventSessionId = planEventText(payload, ["sessionId", "session_id"]);
      const eventAgentId = planEventText(payload, ["agentId", "agent_id"]);
      const targetTaskId = cleanText(state.snapshotTaskId);
      const targetSessionId = cleanText(state.snapshotSessionId);
      const targetAgentId = cleanText(state.snapshotAgentId);

      if (targetTaskId && eventTaskId && eventTaskId !== targetTaskId) {
        return;
      }
      if (!targetTaskId && targetSessionId && eventSessionId && eventSessionId !== targetSessionId) {
        return;
      }
      if (!targetTaskId && !targetSessionId && targetAgentId && eventAgentId && eventAgentId !== targetAgentId) {
        return;
      }

      const eventSnapshot = planEventSnapshot(payload);
      if (eventSnapshot) {
        setSnapshot((current) => {
          const nextSnapshot = applyPendingPlanStepSaves(
            mergePlanEventSnapshot(current, eventSnapshot),
            pendingStepSavesRef.current,
          );
          cachePlanSnapshot(state.snapshotCacheKeys, nextSnapshot);
          return nextSnapshot;
        });
        return;
      }

      state.loadSnapshot?.({ silent: true });
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [activeRepoPath]);

  useEffect(() => {
    setEditingStepIndex(null);
    setEditingTitle("");
  }, [displayedPlanId]);

  useEffect(() => {
    if (editingStepIndex === null) {
      return;
    }
    const editingStep = Array.isArray(displayedPlan?.steps)
      ? displayedPlan.steps.find((step) => Number(step?.index) === Number(editingStepIndex))
      : null;
    if (!planStepUserEditable(editingStep, displayedPlan)) {
      skipStepEditBlurCommitRef.current = true;
      setEditingStepIndex(null);
      setEditingTitle("");
    }
  }, [displayedPlan, editingStepIndex]);

  const startEditing = useCallback((step) => {
    setEditingStepIndex(Number(step?.index));
    setEditingTitle(cleanText(step?.title));
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingStepIndex(null);
    setEditingTitle("");
  }, []);

  const saveEditing = useCallback(() => {
    const taskId = cleanText(displayedPlan?.task_id);
    const stepIndex = Number(editingStepIndex);
    const title = cleanText(editingTitle);
    if (!taskId || !Number.isInteger(stepIndex) || !title) {
      return;
    }
    const existingStep = Array.isArray(displayedPlan?.steps)
      ? displayedPlan.steps.find((step) => Number(step?.index) === stepIndex)
      : null;
    if (!planStepUserEditable(existingStep, displayedPlan)) {
      cancelEditing();
      return;
    }
    const previousTitle = cleanText(existingStep?.title);
    if (previousTitle === title) {
      cancelEditing();
      return;
    }

    const saveKey = planStepSaveKey(taskId, stepIndex);
    const sequence = stepSaveSequenceRef.current + 1;
    stepSaveSequenceRef.current = sequence;
    const pendingRecord = {
      taskId,
      stepIndex,
      title,
      sequence,
      status: "syncing",
      updatedAt: new Date().toISOString(),
    };
    setPendingStepSaveRecord(saveKey, pendingRecord);
    setError("");

    setSnapshot((current) => {
      const nextSnapshot = withSnapshotPlanStepTitle(current, taskId, stepIndex, title, {
        pendingSync: true,
        source: "user",
        updatedAt: pendingRecord.updatedAt,
      });
      cachePlanSnapshot(snapshotCacheKeys, nextSnapshot);
      return nextSnapshot;
    });
    cancelEditing();

    void invoke("coordination_terminal_task_plan_edit_step_title", {
      repoPath: activeRepoPath,
      ...(activeDbPath ? { dbPath: activeDbPath } : {}),
      input: {
        agentId: snapshotAgentId || displayedPlan?.agent_id || "",
        sessionId: snapshotSessionId || displayedPlan?.session_id || "",
        taskId,
        stepIndex,
        title,
        workspaceId,
      },
    }).then((response) => {
      if (response?.ok === false) {
        throw new Error(
          cleanText(response?.error?.message)
          || cleanText(response?.error)
          || "Unable to save plan step.",
        );
      }
      const data = dataOf(response);
      const remainingSaves = clearPendingStepSaveRecord(saveKey, sequence);
      if (data?.plan) {
        setSnapshot((current) => {
          const nextSnapshot = applyPendingPlanStepSaves({
            ...(current || {}),
            selected_plan: data.plan,
            history: current?.history || [],
            title_max_chars: current?.title_max_chars || titleMaxChars,
          }, remainingSaves);
          cachePlanSnapshot(snapshotCacheKeys, nextSnapshot);
          return nextSnapshot;
        });
      }
    }).catch((nextError) => {
      const message = cleanText(nextError?.message || nextError) || "Unable to save plan step.";
      markPendingStepSaveError(saveKey, sequence, message);
      setError(cleanText(nextError?.message || nextError) || "Unable to save plan step.");
    });
  }, [
    activeDbPath,
    activeRepoPath,
    cancelEditing,
    clearPendingStepSaveRecord,
    displayedPlan,
    editingStepIndex,
    editingTitle,
    markPendingStepSaveError,
    setPendingStepSaveRecord,
    snapshotAgentId,
    snapshotCacheKeys,
    snapshotSessionId,
    titleMaxChars,
    workspaceId,
  ]);

  const handleStepEditBlur = useCallback((event) => {
    if (event.currentTarget?.contains?.(event.relatedTarget)) {
      return;
    }
    if (skipStepEditBlurCommitRef.current) {
      skipStepEditBlurCommitRef.current = false;
      return;
    }
    saveEditing();
  }, [saveEditing]);

  const headerMeta = useMemo(() => {
	    if (!target.paneId && !target.sessionId && !target.taskId && !activeRepoTarget) {
	      return "";
	    }
    const parts = [];
    if (Number.isInteger(Number(target.terminalIndex))) {
      parts.push(`Terminal ${Number(target.terminalIndex) + 1}`);
    }
    if (target.agentId) {
      parts.push(target.agentId);
    }
    if (activeRepoTarget) {
      parts.push(repoTargetLabel(activeRepoTarget));
    }
    return parts.join(" / ");
  }, [activeRepoTarget, target.agentId, target.paneId, target.sessionId, target.taskId, target.terminalIndex]);

  return (
    <PlansSurface aria-label="Terminal plans">
      <PlansHeader>
        <div>
          <PlansEyebrow>{headerMeta || "Terminal plan"}</PlansEyebrow>
          <PlansTitle>Plans</PlansTitle>
        </div>
        {normalizedRepoTargets.length > 1 && (
          <PlanRepoSelect
            aria-label="Plan repository"
            onChange={(event) => setSelectedRepoPath(event.target.value)}
            value={activeRepoPath}
          >
            {normalizedRepoTargets.map((repoTarget) => (
              <option key={repoTarget.repoPath} value={repoTarget.repoPath}>
                {repoTargetLabel(repoTarget)}
              </option>
            ))}
          </PlanRepoSelect>
        )}
      </PlansHeader>

      {error && <FormMessage data-tone="danger">{error}</FormMessage>}

      {displayedPlan ? (
        <PlanPanel>
          <PlanPanelHeader>
            <div>
              <PlanName>{displayedPlan.title || displayedPlan.task_title || "Terminal task"}</PlanName>
              <PlanSubline>
                <span>{planStatusLabel(displayedPlan.status)}</span>
                {timestampLabel(displayedPlan.updated_at) && <span>{timestampLabel(displayedPlan.updated_at)}</span>}
              </PlanSubline>
            </div>
            <PlanPanelActions>
              <PlanBadge data-status={normalizedPlanStatus(displayedPlan.status)}>
                {planStatusLabel(displayedPlan.status)}
              </PlanBadge>
              {displayedPlanCanContinue && (
                <ResumeButton
                  onClick={() => onResumePlan?.(displayedPlan)}
                  type="button"
                >
                  Continue
                </ResumeButton>
              )}
            </PlanPanelActions>
          </PlanPanelHeader>
          <StepList>
            {(displayedPlan.steps || []).map((step) => {
              const index = Number(step.index);
              const editing = editingStepIndex === index;
              const pendingSave = planStepSaveForStep(pendingStepSaves, displayedPlan.task_id, index);
              const syncing = pendingSave?.status === "syncing";
              const syncFailed = pendingSave?.status === "error";
              const editable = planStepUserEditable(step, displayedPlan) && !syncing;
              const statusKind = stepStatusKind(step.status);
              return (
                <StepRow data-status={cleanText(step.status).toLowerCase()} key={step.id || index}>
                  <StepMarker aria-hidden="true" data-status={statusKind}>
                    <StepStatusGlyph status={step.status} />
                  </StepMarker>
                  <StepContent>
                    {editing ? (
                      <StepEditRow onBlur={handleStepEditBlur}>
                        <StepInput
                          aria-label={`Step ${index + 1} title`}
                          autoFocus
                          maxLength={titleMaxChars}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              saveEditing();
                            }
                            if (event.key === "Escape") {
                              skipStepEditBlurCommitRef.current = true;
                              cancelEditing();
                            }
                          }}
                          value={editingTitle}
                        />
                        <IconButton
                          aria-label="Save step title"
                          disabled={!cleanText(editingTitle)}
                          onClick={() => {
                            skipStepEditBlurCommitRef.current = true;
                            saveEditing();
                          }}
                          title="Save"
                          type="button"
                        >
                          <Check aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          aria-label="Cancel step edit"
                          onClick={() => {
                            skipStepEditBlurCommitRef.current = true;
                            cancelEditing();
                          }}
                          title="Cancel"
                          type="button"
                        >
                          <Close aria-hidden="true" />
                        </IconButton>
                      </StepEditRow>
                    ) : (
                      <StepTitleRow>
                        <StepTitle>{step.title}</StepTitle>
                        {editable && (
                          <StepTextButton
                            onClick={() => startEditing(step)}
                            type="button"
                          >
                            Edit
                          </StepTextButton>
                        )}
                      </StepTitleRow>
                    )}
                    <StepMeta>
                      <span>{stepStatusLabel(step.status)}</span>
                      {syncing && <span>Syncing</span>}
                      {syncFailed && <span>Sync failed</span>}
                      {step.detail && <span>{step.detail}</span>}
                    </StepMeta>
                  </StepContent>
                </StepRow>
              );
            })}
          </StepList>
        </PlanPanel>
      ) : (
        <EmptyPanel>
          <PlanName>No plan</PlanName>
        </EmptyPanel>
      )}
    </PlansSurface>
  );
}

const PlansSurface = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 12px;
  color: #e6edf7;
`;

const PlansHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const PlansEyebrow = styled.div`
  color: rgba(214, 225, 241, 0.62);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
`;

const PlansTitle = styled.h2`
  margin: 2px 0 0;
  color: #f7faff;
  font-size: 20px;
  line-height: 1.1;
`;

const PlanRepoSelect = styled.select`
  min-width: 0;
  width: min(150px, 42%);
  height: 30px;
  padding: 0 26px 0 10px;
  border: 1px solid rgba(216, 226, 240, 0.16);
  border-radius: 7px;
  color: #dbe7f8;
  background: rgba(255, 255, 255, 0.055);
  color-scheme: dark;
  cursor: pointer;
  font-size: 12px;
  font-weight: 760;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  option {
    color: #f4f7fa;
    background: #0d1117;
  }
`;

const IconButton = styled.button`
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(216, 226, 240, 0.16);
  border-radius: 7px;
  color: #dbe7f8;
  background: rgba(255, 255, 255, 0.05);

  svg {
    width: 16px;
    height: 16px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const PlanPanel = styled.article`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(216, 226, 240, 0.12);
  border-radius: 8px;
  background: rgba(11, 16, 24, 0.68);
`;

const EmptyPanel = styled(PlanPanel)`
  display: grid;
  grid-template-rows: auto;
  flex: 0 0 auto;
  align-content: center;
  min-height: 0;
  gap: 8px;
  padding: 18px;
`;

const PlanPanelHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid rgba(216, 226, 240, 0.1);
`;

const PlanPanelActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
`;

const PlanName = styled.h3`
  margin: 0;
  color: #f4f8ff;
  font-size: 14px;
  line-height: 1.25;
`;

const PlanSubline = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 5px;
  color: rgba(216, 226, 240, 0.64);
  font-size: 11px;
  line-height: 1.25;
`;

const PlanBadge = styled.span`
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid rgba(100, 180, 255, 0.22);
  border-radius: 999px;
  color: #a9d2ff;
  background: rgba(46, 126, 245, 0.12);
  font-size: 11px;
  font-weight: 800;

  &[data-status="completed"] {
    color: #baf0ca;
    border-color: rgba(92, 214, 132, 0.24);
    background: rgba(52, 180, 96, 0.12);
  }

  &[data-status="interrupted"],
  &[data-status="blocked"] {
    color: #ffd2a6;
    border-color: rgba(255, 167, 84, 0.24);
    background: rgba(214, 113, 48, 0.14);
  }
`;

const StepList = styled.div`
  display: grid;
  gap: 0;
  min-height: 0;
  overflow: auto;
`;

const StepRow = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(216, 226, 240, 0.08);
`;

const StepMarker = styled.span`
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(216, 226, 240, 0.16);
  border-radius: 50%;
  color: rgba(230, 238, 248, 0.74);
  font-size: 11px;
  font-weight: 800;

  svg {
    width: 15px;
    height: 15px;
  }

  &[data-status="completed"] {
    border-color: rgba(92, 214, 132, 0.36);
    color: #a5efbd;
    background: rgba(52, 180, 96, 0.12);
  }

  &[data-status="active"] {
    border-color: rgba(116, 171, 255, 0.3);
    color: #a9d2ff;
    background: rgba(46, 126, 245, 0.1);
  }

  &[data-status="blocked"] {
    border-color: rgba(255, 167, 84, 0.28);
    color: #ffd2a6;
    background: rgba(214, 113, 48, 0.12);
  }

  &[data-status="queued"],
  &[data-status="skipped"] {
    color: rgba(216, 226, 240, 0.58);
  }
`;

const StepSpinner = styled.span`
  width: 14px;
  height: 14px;
  border: 2px solid rgba(169, 210, 255, 0.22);
  border-top-color: #a9d2ff;
  border-radius: 50%;
  animation: ${stepSpinnerSpin} 0.8s linear infinite;
`;

const StepQueuedDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(216, 226, 240, 0.62);
  box-shadow: 0 0 0 4px rgba(216, 226, 240, 0.06);
`;

const StepContent = styled.div`
  min-width: 0;
`;

const StepTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const StepTitle = styled.div`
  min-width: 0;
  overflow-wrap: anywhere;
  color: #ecf4ff;
  font-size: 13px;
  font-weight: 750;
  line-height: 1.25;
`;

const StepTextButton = styled.button`
  flex: 0 0 auto;
  border: 0;
  padding: 3px 0;
  color: #8abaff;
  background: transparent;
  font-size: 11px;
  font-weight: 800;
`;

const StepMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: rgba(216, 226, 240, 0.58);
  font-size: 11px;
  line-height: 1.3;
`;

const StepEditRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
`;

const StepInput = styled.input`
  min-width: 0;
  height: 30px;
  border: 1px solid rgba(116, 171, 255, 0.32);
  border-radius: 7px;
  padding: 0 9px;
  color: #f6f9ff;
  background: rgba(3, 8, 14, 0.74);
  font: inherit;
  font-size: 13px;
`;

const ResumeButton = styled.button`
  border: 1px solid rgba(116, 171, 255, 0.28);
  border-radius: 7px;
  padding: 5px 8px;
  color: #d8e8ff;
  background: rgba(50, 124, 245, 0.14);
  font-size: 11px;
  font-weight: 850;
  white-space: nowrap;
`;
