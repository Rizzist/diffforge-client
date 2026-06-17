import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check } from "@styled-icons/material-rounded/Check";
import { Close } from "@styled-icons/material-rounded/Close";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import { FormMessage } from "../app/appStyles";

const TERMINAL_TODO_PLAN_UPDATED_EVENT = "forge-terminal-todo-plan-updated";
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

const TODO_DISPATCH_RECEIPTS_UPDATED_EVENT = "todo-dispatch-receipts-updated";
const TERMINAL_TODO_HISTORY_REFRESH_MS = 15_000;
const TERMINAL_TODO_NOW_TICK_MS = 30_000;
const RECEIPT_SETTLED_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "canceled",
  "timed_out",
]);

function receiptStatusKind(status) {
  const normalized = cleanText(status).toLowerCase();
  if (normalized === "completed") return "completed";
  if (["running", "dispatched", "accepted", "in_progress"].includes(normalized)) return "active";
  if (["failed", "timed_out"].includes(normalized)) return "danger";
  if (["interrupted", "cancelled", "canceled"].includes(normalized)) return "warn";
  return "queued";
}

function receiptStatusLabel(status) {
  const normalized = cleanText(status).toLowerCase();
  if (normalized === "completed") return "Completed";
  if (["running", "dispatched", "accepted", "in_progress"].includes(normalized)) return "Running";
  if (normalized === "failed") return "Failed";
  if (normalized === "timed_out") return "Timed out";
  if (normalized === "interrupted") return "Interrupted";
  if (["cancelled", "canceled"].includes(normalized)) return "Cancelled";
  if (normalized === "listed") return "Listed";
  return "Queued";
}

function relativeTimeLabel(ms, nowMs) {
  const timestamp = Number(ms);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const elapsed = Math.max(0, (Number(nowMs) || Date.now()) - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 31) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function durationLabel(startMs, endMs) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start) {
    return "";
  }
  const totalSeconds = Math.floor((end - start) / 1000);
  if (totalSeconds < 60) return `${Math.max(totalSeconds, 1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 10) return `${minutes}m ${totalSeconds % 60}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function receiptIsSettled(status) {
  return RECEIPT_SETTLED_STATUSES.has(cleanText(status).toLowerCase());
}

function receiptDurationParts(item, nowMs) {
  if (!item?.receivedAtMs) return null;
  if (receiptIsSettled(item.status)) {
    const label = durationLabel(item.receivedAtMs, item.updatedAtMs);
    return label ? { label, prefix: "took" } : null;
  }
  if (receiptStatusKind(item.status) === "active") {
    const label = durationLabel(item.receivedAtMs, nowMs);
    return label ? { label, prefix: "running" } : null;
  }
  return null;
}

function sessionRefValues(value) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const refs = new Set();
  [
    object.providerSessionId,
    object.provider_session_id,
    object.sessionId,
    object.session_id,
  ].forEach((candidate) => {
    const cleaned = cleanText(candidate);
    if (cleaned) refs.add(cleaned);
  });
  return refs;
}

function valueHasSessionRef(value, sessionId) {
  const target = cleanText(sessionId);
  if (!target) return false;
  return sessionRefValues(value).has(target);
}

function planMatchesSession(plan, sessionId) {
  if (!plan || typeof plan !== "object") return false;
  return valueHasSessionRef(plan, sessionId);
}

function filterPlanSnapshotForSession(snapshot, sessionId) {
  const targetSessionId = cleanText(sessionId);
  if (!snapshot || typeof snapshot !== "object" || !targetSessionId) {
    return null;
  }
  const history = (Array.isArray(snapshot.history) ? snapshot.history : [])
    .filter((plan) => planMatchesSession(plan, targetSessionId));
  const selectedPlan = planMatchesSession(snapshot.selected_plan || snapshot.selectedPlan, targetSessionId)
    ? snapshot.selected_plan || snapshot.selectedPlan
    : history[0] || null;
  return {
    ...snapshot,
    history,
    history_scope: "session",
    selected_plan: selectedPlan,
  };
}

function collectPlanTodoRefs(snapshot) {
  const refs = new Set();
  const addRef = (value) => {
    const cleaned = cleanText(value);
    if (cleaned) refs.add(cleaned);
  };
  const collectPlan = (plan) => {
    if (!plan || typeof plan !== "object") return;
    addRef(plan.todo_id || plan.todoId);
    addRef(plan.plan_id || plan.planId || plan.id);
    if (Array.isArray(plan.steps)) {
      plan.steps.forEach((step) => {
        addRef(step?.todo_id || step?.todoId || step?.id);
      });
    }
  };
  collectPlan(snapshot?.selected_plan || snapshot?.selectedPlan);
  (Array.isArray(snapshot?.history) ? snapshot.history : []).forEach(collectPlan);
  return refs;
}

function normalizeTerminalReceipts(receipts, paneId, options = {}) {
  const pane = cleanText(paneId);
  const sessionId = cleanText(options.sessionId);
  const planTodoRefs = options.planTodoRefs instanceof Set ? options.planTodoRefs : new Set();
  if (!pane || !receipts || typeof receipts !== "object" || Array.isArray(receipts)) {
    return [];
  }
  if (!sessionId) {
    return [];
  }
  return Object.entries(receipts)
    .map(([key, receipt]) => {
      if (!receipt || typeof receipt !== "object") return null;
      if (cleanText(receipt.paneId || receipt.pane_id) !== pane) return null;
      const receivedAtMs = Number(receipt.receivedAtMs) || 0;
      const updatedAtMs = Number(receipt.updatedAtMs) || receivedAtMs;
      if (!receivedAtMs && !updatedAtMs) return null;
      const commandId = cleanText(receipt.commandId) || cleanText(key);
      const itemId = cleanText(receipt.itemId);
      const receiptSessions = sessionRefValues(receipt);
      if (receiptSessions.size) {
        if (!receiptSessions.has(sessionId)) return null;
      } else if (!planTodoRefs.has(commandId) && !planTodoRefs.has(itemId)) {
        return null;
      }
      return {
        commandId,
        itemId,
        receivedAtMs: receivedAtMs || updatedAtMs,
        sessionId: Array.from(receiptSessions)[0] || "",
        status: cleanText(receipt.status).toLowerCase() || "queued",
        text: cleanText(receipt.text),
        updatedAtMs,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.receivedAtMs - left.receivedAtMs);
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
  if (normalized === "listed") {
    return "Listed";
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
  if (["listed", "list", "queued", "pending", "ready"].includes(normalized)) {
    return "listed";
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
  return cleanText(plan?.plan_id || plan?.planId || plan?.id)
    || cleanText(plan?.todo_id || plan?.todoId);
}

function planStepSaveKey(planRef, stepIndex) {
  const safePlanRef = cleanText(planRef);
  const safeStepIndex = Number(stepIndex);
  return safePlanRef && Number.isInteger(safeStepIndex) ? `${safePlanRef}:${safeStepIndex}` : "";
}

function planStepSaveForStep(pendingSaves, planRef, stepIndex) {
  const key = planStepSaveKey(planRef, stepIndex);
  return key ? pendingSaves?.[key] || null : null;
}

function withPlanStepTitle(plan, planRef, stepIndex, title, fields = {}) {
  const safePlanRef = cleanText(planRef);
  const safeStepIndex = Number(stepIndex);
  const safeTitle = cleanText(title);
  if (
    !plan
    || !safePlanRef
    || !Number.isInteger(safeStepIndex)
    || !safeTitle
    || planIdentity(plan) !== safePlanRef
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

function withSnapshotPlanStepTitle(snapshot, planRef, stepIndex, title, fields = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot || null;
  }
  const updatePlan = (plan) => withPlanStepTitle(plan, planRef, stepIndex, title, fields);
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
	        pendingSave.planRef,
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

// Reuse one formatter so the 15s todo-history refresh doesn't rebuild an ICU
// formatter (udat_open) per item on every re-render.
const TIMESTAMP_LABEL_FORMATTER = new Intl.DateTimeFormat([], {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
});

function timestampLabel(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return TIMESTAMP_LABEL_FORMATTER.format(date);
}

export default function PlansWorkspaceView({
  onResumePlan,
  repoTargets = [],
  rootDirectory = "",
  selectedTerminal = EMPTY_TARGET,
  workspace,
}) {
  const target = selectedTerminal || EMPTY_TARGET;
  const [terminalTodoItems, setTerminalTodoItems] = useState([]);
  const [selectedTodoKey, setSelectedTodoKey] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
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
  // The Plans tab is terminal-scoped: it always shows the selected terminal's
  // repo — no repository picker.
  const activeRepoPath = useMemo(() => {
    const preferredKey = pathIdentity(preferredRepoPath);
    const preferredTarget = preferredKey
      ? normalizedRepoTargets.find((repoTarget) => pathIdentity(repoTarget.repoPath) === preferredKey)
      : null;
    return preferredTarget?.repoPath
      || cleanText(preferredRepoPath)
      || normalizedRepoTargets[0]?.repoPath
      || "";
  }, [normalizedRepoTargets, preferredRepoPath]);
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
  const hasSnapshotScope = Boolean(activeRepoPath && snapshotSessionId);
  const snapshotCacheKeys = useMemo(() => {
    if (!hasSnapshotScope) {
      return { exact: "", repo: "" };
    }

    const baseKey = {
      agentId: snapshotAgentId,
      dbPath: activeDbPath,
      repoPath: activeRepoPath,
      sessionId: snapshotSessionId,
      taskId: snapshotTaskId,
      workspaceId,
    };
    return {
      exact: planSnapshotCacheKey(baseKey),
      repo: "",
    };
  }, [
    activeDbPath,
    activeRepoPath,
    hasSnapshotScope,
    snapshotAgentId,
    snapshotSessionId,
    snapshotTaskId,
    workspaceId,
  ]);
  const activeSnapshotRequestKey = snapshotCacheKeys.exact || snapshotCacheKeys.repo || "";
  const scopedSnapshot = useMemo(() => (
    hasSnapshotScope
      ? filterPlanSnapshotForSession(snapshot, snapshotSessionId)
      : null
  ), [hasSnapshotScope, snapshot, snapshotSessionId]);
  const selectedPlan = scopedSnapshot?.selected_plan || null;
  const planCandidates = Array.isArray(scopedSnapshot?.history) ? scopedSnapshot.history : [];
  const sessionTodoRefs = useMemo(() => collectPlanTodoRefs(scopedSnapshot), [scopedSnapshot]);
  const sessionTodoRefsKey = useMemo(() => (
    Array.from(sessionTodoRefs).sort().join("\n")
  ), [sessionTodoRefs]);
  const activePlanCandidate = planCandidates.find((plan) => !planIsTerminal(plan)) || null;
  const latestPlanCandidate = planCandidates[0] || null;
  const fallbackPlan = selectedPlan && !planIsTerminal(selectedPlan)
    ? selectedPlan
    : activePlanCandidate || selectedPlan || latestPlanCandidate || null;

  // Plans link to todos by todo_id; receipts carry the queue item id and the
  // remote command id, so try both.
  const plansByTodoRef = useMemo(() => {
    const map = new Map();
    const register = (plan) => {
      const todoRef = cleanText(plan?.todo_id || plan?.todoId);
      if (todoRef && !map.has(todoRef)) {
        map.set(todoRef, plan);
      }
    };
    planCandidates.forEach(register);
    if (selectedPlan) register(selectedPlan);
    return map;
  }, [planCandidates, selectedPlan]);
  const planForTodo = useCallback((item) => {
    if (!item) return null;
    return (item.itemId && plansByTodoRef.get(item.itemId))
      || (item.commandId && plansByTodoRef.get(item.commandId))
      || null;
  }, [plansByTodoRef]);

  const openedTodo = useMemo(() => {
    if (!terminalTodoItems.length) return null;
    if (selectedTodoKey) {
      const match = terminalTodoItems.find((item) => item.commandId === selectedTodoKey);
      if (match) return match;
    }
    return terminalTodoItems[0];
  }, [selectedTodoKey, terminalTodoItems]);
  const openedTodoIsNewest = Boolean(openedTodo) && openedTodo === terminalTodoItems[0];
  const openedTodoLinkedPlan = planForTodo(openedTodo);
  // The newest todo also claims the terminal's active unlinked plan: plan ids
  // and todo ids can come from different creation paths (voice, kernel), and
  // an in-flight plan on this terminal belongs to the current todo.
  const openedTodoPlan = openedTodoLinkedPlan
    || (openedTodoIsNewest && fallbackPlan && !planIsTerminal(fallbackPlan) ? fallbackPlan : null);
  const displayedPlan = openedTodo ? openedTodoPlan : fallbackPlan;
  const displayedPlanId = planIdentity(displayedPlan);
  const displayedPlanCanContinue = planCanContinue(displayedPlan);
  const titleMaxChars = Number(scopedSnapshot?.title_max_chars || displayedPlan?.title_max_chars || 96);

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
    if (!hasSnapshotScope) {
      setSnapshot(null);
      setError("");
      return;
    }

    setSnapshot(applyPendingPlanStepSaves(
      cachedPlanSnapshot(snapshotCacheKeys),
      pendingStepSavesRef.current,
    ));
    setError("");
  }, [activeSnapshotRequestKey, hasSnapshotScope, snapshotCacheKeys]);

  // Per-terminal todo history from the Rust receipts ledger: every todo
  // dispatched to this pane, with sent time and settle time.
  useEffect(() => {
    const receiptsWorkspaceId = cleanText(workspaceId);
    const paneId = cleanText(target.paneId);
    setSelectedTodoKey("");
    if (!receiptsWorkspaceId || !paneId || !snapshotSessionId) {
      setTerminalTodoItems([]);
      return undefined;
    }
    let cancelled = false;
    let unlisten = null;
    const applyReceipts = (receipts) => {
      if (cancelled) return;
      setTerminalTodoItems(normalizeTerminalReceipts(receipts, paneId, {
        planTodoRefs: sessionTodoRefs,
        sessionId: snapshotSessionId,
      }));
    };
    const refresh = () => {
      invoke("todo_dispatch_receipts_get", { workspaceId: receiptsWorkspaceId })
        .then((result) => applyReceipts(result?.receipts))
        .catch(() => {});
    };
    refresh();
    listen(TODO_DISPATCH_RECEIPTS_UPDATED_EVENT, (event) => {
      if (cancelled) return;
      const eventWorkspaceId = cleanText(event?.payload?.workspaceId || event?.payload?.workspace_id);
      if (eventWorkspaceId && eventWorkspaceId !== receiptsWorkspaceId) return;
      const receipts = event?.payload?.receipts;
      if (receipts && typeof receipts === "object") {
        applyReceipts(receipts);
      } else {
        refresh();
      }
    }).then((dispose) => {
      if (cancelled) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch(() => {});
    const intervalId = window.setInterval(refresh, TERMINAL_TODO_HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (typeof unlisten === "function") unlisten();
    };
  }, [sessionTodoRefs, sessionTodoRefsKey, snapshotSessionId, target.paneId, workspaceId]);

  // Relative "sent x ago" labels and live running durations stay current.
  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), TERMINAL_TODO_NOW_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);

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
          workspaceId,
        },
      };
      if (activeDbPath) {
        command.dbPath = activeDbPath;
      }
      const requestKey = planSnapshotRequestKey(snapshotCacheKeys);
      let request = requestKey ? planSnapshotRequests.get(requestKey) : null;
      if (!request) {
        request = invoke("coordination_terminal_todo_plan_snapshot", command)
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
        setError(cleanText(nextError?.message || nextError) || "Unable to load terminal todo plans.");
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
    workspaceId,
  ]);

  useEffect(() => {
    if (!hasSnapshotScope) {
      return undefined;
    }

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
  }, [activeSnapshotRequestKey, hasSnapshotScope, loadSnapshot, snapshotCacheKeys]);

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
    if (!activeRepoPath || !hasSnapshotScope) {
      return undefined;
    }

    let cancelled = false;
    let unlisten = null;
    const rootPath = pathIdentity(activeRepoPath);

    listen(TERMINAL_TODO_PLAN_UPDATED_EVENT, (event) => {
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
      const eventSessionId = planEventText(payload, [
        "providerSessionId",
        "provider_session_id",
        "sessionId",
        "session_id",
      ]);
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
  }, [activeRepoPath, hasSnapshotScope]);

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
	    const planRef = planIdentity(displayedPlan);
	    const stepIndex = Number(editingStepIndex);
	    const title = cleanText(editingTitle);
	    if (!planRef || !Number.isInteger(stepIndex) || !title) {
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

	    const saveKey = planStepSaveKey(planRef, stepIndex);
	    const sequence = stepSaveSequenceRef.current + 1;
	    stepSaveSequenceRef.current = sequence;
	    const pendingRecord = {
	      planRef,
	      stepIndex,
	      title,
      sequence,
      status: "syncing",
      updatedAt: new Date().toISOString(),
    };
    setPendingStepSaveRecord(saveKey, pendingRecord);
    setError("");

	    setSnapshot((current) => {
	      const nextSnapshot = withSnapshotPlanStepTitle(current, planRef, stepIndex, title, {
	        pendingSync: true,
	        source: "user",
        updatedAt: pendingRecord.updatedAt,
      });
      cachePlanSnapshot(snapshotCacheKeys, nextSnapshot);
      return nextSnapshot;
    });
    cancelEditing();

    void invoke("coordination_terminal_todo_plan_edit_step_title", {
      repoPath: activeRepoPath,
      ...(activeDbPath ? { dbPath: activeDbPath } : {}),
      input: {
	        agentId: snapshotAgentId || displayedPlan?.agent_id || "",
		        sessionId: snapshotSessionId || displayedPlan?.provider_session_id || displayedPlan?.session_id || "",
	        planId: cleanText(displayedPlan?.plan_id || displayedPlan?.planId || displayedPlan?.id) || planRef,
	        todoId: cleanText(displayedPlan?.todo_id || displayedPlan?.todoId),
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
    <PlansSurface aria-label="Terminal todo plans">
      <PlansHeader>
        <div>
          <PlansEyebrow>{headerMeta || "Terminal todo plan"}</PlansEyebrow>
          <PlansTitle>Plans</PlansTitle>
        </div>
        {terminalTodoItems.length > 0 && (
          <PlansCount>
            {terminalTodoItems.length} todo{terminalTodoItems.length === 1 ? "" : "s"}
          </PlansCount>
        )}
      </PlansHeader>

      {error && <FormMessage data-tone="danger">{error}</FormMessage>}

      <PlansBody>
        {openedTodo && (
          <TodoCard>
            <TodoCardHeader>
              <TodoCardLabel>{openedTodoIsNewest ? "Current todo" : "Todo"}</TodoCardLabel>
              <TodoBadge data-kind={receiptStatusKind(openedTodo.status)}>
                {receiptStatusLabel(openedTodo.status)}
              </TodoBadge>
            </TodoCardHeader>
            <TodoCardText>{openedTodo.text || "(no todo text)"}</TodoCardText>
            <TodoCardMeta>
              <span>Sent {relativeTimeLabel(openedTodo.receivedAtMs, nowMs)}</span>
              {(() => {
                const duration = receiptDurationParts(openedTodo, nowMs);
                return duration ? <span>{duration.prefix} {duration.label}</span> : null;
              })()}
              {!openedTodoPlan && <span>No plan</span>}
            </TodoCardMeta>
          </TodoCard>
        )}
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
	                const pendingSave = planStepSaveForStep(pendingStepSaves, displayedPlanId, index);
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
        ) : !openedTodo ? (
          <EmptyPanel>
            <PlanName>No todos yet</PlanName>
            <EmptyHint>Todos sent to this terminal appear here with their plans.</EmptyHint>
          </EmptyPanel>
        ) : null}

        {terminalTodoItems.length > 1 && (
          <>
            <HistorySectionLabel>History</HistorySectionLabel>
            <HistoryList>
              {terminalTodoItems.map((item, index) => {
                const kind = receiptStatusKind(item.status);
                const duration = receiptDurationParts(item, nowMs);
                const hasPlan = Boolean(planForTodo(item))
                  || (index === 0 && Boolean(fallbackPlan && !planIsTerminal(fallbackPlan)));
                return (
                  <HistoryRow
                    data-selected={openedTodo === item ? "true" : "false"}
                    key={item.commandId}
                    onClick={() => setSelectedTodoKey(item.commandId)}
                    type="button"
                  >
                    <HistoryRowTop>
                      <HistoryStatusDot aria-hidden="true" data-kind={kind} />
                      <HistoryRowText>{item.text || "(no todo text)"}</HistoryRowText>
                      {hasPlan && <HistoryPlanChip>Plan</HistoryPlanChip>}
                    </HistoryRowTop>
                    <HistoryRowMeta>
                      <HistoryBadge data-kind={kind}>{receiptStatusLabel(item.status)}</HistoryBadge>
                      <span>{relativeTimeLabel(item.receivedAtMs, nowMs)}</span>
                      {duration && <span>{duration.prefix} {duration.label}</span>}
                    </HistoryRowMeta>
                  </HistoryRow>
                );
              })}
            </HistoryList>
          </>
        )}
      </PlansBody>
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
  background: #05070a;
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

const PlansCount = styled.span`
  flex: 0 0 auto;
  padding: 4px 9px;
  border: 1px solid rgba(216, 226, 240, 0.14);
  border-radius: 999px;
  color: rgba(216, 226, 240, 0.66);
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
`;

const TodoCard = styled.article`
  flex: 0 0 auto;
  min-width: 0;
  margin-bottom: 10px;
  padding: 11px 12px;
  border: 1px solid rgba(216, 226, 240, 0.12);
  border-radius: 8px;
  background: rgba(11, 16, 24, 0.68);
`;

const TodoCardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const TodoCardLabel = styled.span`
  color: rgba(214, 225, 241, 0.6);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.07em;
  text-transform: uppercase;
`;

const TodoBadge = styled.span`
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  color: #c7d2e5;
  background: rgba(148, 163, 184, 0.09);
  font-size: 10.5px;
  font-weight: 800;
  white-space: nowrap;

  &[data-kind="completed"] {
    color: #baf0ca;
    border-color: rgba(92, 214, 132, 0.24);
    background: rgba(52, 180, 96, 0.12);
  }

  &[data-kind="active"] {
    color: #a9d2ff;
    border-color: rgba(100, 180, 255, 0.22);
    background: rgba(46, 126, 245, 0.12);
  }

  &[data-kind="danger"] {
    color: #ffb3b3;
    border-color: rgba(255, 110, 110, 0.26);
    background: rgba(190, 50, 50, 0.14);
  }

  &[data-kind="warn"] {
    color: #ffd2a6;
    border-color: rgba(255, 167, 84, 0.24);
    background: rgba(214, 113, 48, 0.14);
  }
`;

const TodoCardText = styled.p`
  display: -webkit-box;
  margin: 8px 0 0;
  overflow: hidden;
  color: #ecf4ff;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.4;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
`;

const TodoCardMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 8px;
  color: rgba(216, 226, 240, 0.58);
  font-size: 11px;
  line-height: 1.3;
`;

const EmptyHint = styled.p`
  margin: 0;
  color: rgba(216, 226, 240, 0.55);
  font-size: 11.5px;
  line-height: 1.4;
`;

const HistorySectionLabel = styled.span`
  flex: 0 0 auto;
  margin: 12px 2px 6px;
  color: rgba(214, 225, 241, 0.55);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const HistoryList = styled.div`
  display: grid;
  flex: 0 0 auto;
  align-content: start;
  gap: 6px;
  min-width: 0;
`;

const HistoryRow = styled.button`
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(216, 226, 240, 0.1);
  border-radius: 8px;
  color: inherit;
  background: rgba(11, 16, 24, 0.5);
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: rgba(125, 176, 255, 0.28);
  }

  &[data-selected="true"] {
    border-color: rgba(125, 176, 255, 0.4);
    background: rgba(34, 64, 110, 0.18);
  }
`;

const HistoryRowTop = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
`;

const HistoryStatusDot = styled.span`
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(216, 226, 240, 0.45);

  &[data-kind="completed"] {
    background: #5cd684;
  }

  &[data-kind="active"] {
    background: #74abff;
    box-shadow: 0 0 0 3px rgba(116, 171, 255, 0.16);
  }

  &[data-kind="danger"] {
    background: #ff7a7a;
  }

  &[data-kind="warn"] {
    background: #ffa754;
  }
`;

const HistoryRowText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: #e7eefb;
  font-size: 12px;
  font-weight: 680;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HistoryPlanChip = styled.span`
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid rgba(167, 139, 250, 0.3);
  border-radius: 999px;
  color: #d6c9ff;
  background: rgba(124, 92, 230, 0.14);
  font-size: 10px;
  font-weight: 850;
`;

const HistoryRowMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  color: rgba(216, 226, 240, 0.55);
  font-size: 10.5px;
  line-height: 1.3;
`;

const HistoryBadge = styled(TodoBadge)`
  padding: 2px 7px;
  font-size: 10px;
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

const PlansBody = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const PlanPanel = styled.article`
  display: grid;
  grid-template-rows: auto auto;
  flex: 0 0 auto;
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

  &[data-status="listed"] {
    color: #c7d2e5;
    border-color: rgba(148, 163, 184, 0.2);
    background: rgba(148, 163, 184, 0.09);
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
  align-content: start;
  gap: 0;
  min-height: 0;
  overflow: visible;
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
