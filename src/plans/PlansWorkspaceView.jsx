import { invoke } from "@tauri-apps/api/core";
import { Check } from "@styled-icons/material-rounded/Check";
import { Close } from "@styled-icons/material-rounded/Close";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";

import {
  ButtonRefreshIcon,
  FormMessage,
} from "../app/appStyles";

const EMPTY_TARGET = Object.freeze({
  agentId: "",
  paneId: "",
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
  const normalized = cleanText(status).toLowerCase();
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

function stepStatusKind(status) {
  const normalized = cleanText(status).toLowerCase();
  if (["complete", "completed", "done", "finished", "success"].includes(normalized)) {
    return "completed";
  }
  if ([
    "active",
    "current",
    "in_progress",
    "in-progress",
    "pending",
    "running",
    "working",
  ].includes(normalized)) {
    return "active";
  }
  if (normalized === "blocked" || normalized === "interrupted") {
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
  rootDirectory = "",
  selectedTerminal = EMPTY_TARGET,
  workspace,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [editingStepIndex, setEditingStepIndex] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingStepIndex, setSavingStepIndex] = useState(null);

  const target = selectedTerminal || EMPTY_TARGET;
  const selectedPlan = snapshot?.selected_plan || null;
  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const titleMaxChars = Number(snapshot?.title_max_chars || selectedPlan?.title_max_chars || 96);
  const workspaceId = target.workspaceId || workspace?.id || "";

  const loadSnapshot = useCallback(async (options = {}) => {
    const silent = options?.silent === true;
    if (!rootDirectory) {
      setSnapshot(null);
      return;
    }
    if (!silent) {
      setStatus("loading");
      setError("");
    }
    try {
      const response = await invoke("coordination_terminal_task_plan_snapshot", {
        repoPath: rootDirectory,
        input: {
          agentId: target.agentId || "",
          sessionId: target.sessionId || "",
          taskId: target.taskId || "",
        },
      });
      setSnapshot(dataOf(response));
      setStatus("ready");
    } catch (nextError) {
      if (!silent) {
        setError(cleanText(nextError?.message || nextError) || "Unable to load terminal plans.");
        setStatus("error");
      }
    }
  }, [rootDirectory, target.agentId, target.sessionId, target.taskId]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!rootDirectory || editingStepIndex !== null) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      loadSnapshot({ silent: true });
    }, 900);

    return () => {
      window.clearInterval(timerId);
    };
  }, [editingStepIndex, loadSnapshot, rootDirectory]);

  useEffect(() => {
    setEditingStepIndex(null);
    setEditingTitle("");
  }, [selectedPlan?.plan_id]);

  const startEditing = useCallback((step) => {
    setEditingStepIndex(Number(step?.index));
    setEditingTitle(cleanText(step?.title));
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingStepIndex(null);
    setEditingTitle("");
  }, []);

  const saveEditing = useCallback(async () => {
    const taskId = cleanText(selectedPlan?.task_id);
    const stepIndex = Number(editingStepIndex);
    const title = cleanText(editingTitle);
    if (!taskId || !Number.isInteger(stepIndex) || !title || savingStepIndex !== null) {
      return;
    }
    setSavingStepIndex(stepIndex);
    setError("");
    try {
      const response = await invoke("coordination_terminal_task_plan_edit_step_title", {
        repoPath: rootDirectory,
        input: {
          agentId: target.agentId || selectedPlan?.agent_id || "",
          sessionId: target.sessionId || selectedPlan?.session_id || "",
          taskId,
          stepIndex,
          title,
          workspaceId,
        },
      });
      const data = dataOf(response);
      if (data?.plan) {
        setSnapshot((current) => ({
          ...(current || {}),
          selected_plan: data.plan,
          history: current?.history || [],
          title_max_chars: current?.title_max_chars || titleMaxChars,
        }));
      }
      setEditingStepIndex(null);
      setEditingTitle("");
      loadSnapshot();
    } catch (nextError) {
      setError(cleanText(nextError?.message || nextError) || "Unable to save plan step.");
    } finally {
      setSavingStepIndex(null);
    }
  }, [
    editingStepIndex,
    editingTitle,
    loadSnapshot,
    rootDirectory,
    savingStepIndex,
    selectedPlan?.agent_id,
    selectedPlan?.session_id,
    selectedPlan?.task_id,
    target.agentId,
    target.sessionId,
    titleMaxChars,
    workspaceId,
  ]);

  const headerMeta = useMemo(() => {
    if (!target.paneId && !target.sessionId && !target.taskId) {
      return "";
    }
    const parts = [];
    if (Number.isInteger(Number(target.terminalIndex))) {
      parts.push(`Terminal ${Number(target.terminalIndex) + 1}`);
    }
    if (target.agentId) {
      parts.push(target.agentId);
    }
    return parts.join(" / ");
  }, [target.agentId, target.paneId, target.sessionId, target.taskId, target.terminalIndex]);

  return (
    <PlansSurface aria-label="Terminal plans">
      <PlansHeader>
        <div>
          <PlansEyebrow>{headerMeta || "Terminal plan"}</PlansEyebrow>
          <PlansTitle>Plans</PlansTitle>
        </div>
        <IconButton
          aria-label="Refresh plans"
          disabled={status === "loading"}
          onClick={loadSnapshot}
          title="Refresh"
          type="button"
        >
          <ButtonRefreshIcon aria-hidden="true" />
        </IconButton>
      </PlansHeader>

      {error && <FormMessage data-tone="danger">{error}</FormMessage>}

      {selectedPlan ? (
        <PlanPanel>
          <PlanPanelHeader>
            <div>
              <PlanName>{selectedPlan.title || selectedPlan.task_title || "Terminal task"}</PlanName>
              <PlanSubline>
                <span>{planStatusLabel(selectedPlan.status)}</span>
                {timestampLabel(selectedPlan.updated_at) && <span>{timestampLabel(selectedPlan.updated_at)}</span>}
              </PlanSubline>
            </div>
            <PlanBadge data-status={cleanText(selectedPlan.status).toLowerCase()}>
              {planStatusLabel(selectedPlan.status)}
            </PlanBadge>
          </PlanPanelHeader>
          <StepList>
            {(selectedPlan.steps || []).map((step) => {
              const index = Number(step.index);
              const editing = editingStepIndex === index;
              const editable = step.editable === true || cleanText(step.status).toLowerCase() === "queued";
              const saving = savingStepIndex === index;
              const statusKind = stepStatusKind(step.status);
              return (
                <StepRow data-status={cleanText(step.status).toLowerCase()} key={step.id || index}>
                  <StepMarker aria-hidden="true" data-status={statusKind}>
                    <StepStatusGlyph status={step.status} />
                  </StepMarker>
                  <StepContent>
                    {editing ? (
                      <StepEditRow>
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
                              cancelEditing();
                            }
                          }}
                          value={editingTitle}
                        />
                        <IconButton
                          aria-label="Save step title"
                          disabled={saving || !cleanText(editingTitle)}
                          onClick={saveEditing}
                          title="Save"
                          type="button"
                        >
                          <Check aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          aria-label="Cancel step edit"
                          disabled={saving}
                          onClick={cancelEditing}
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
                            disabled={savingStepIndex !== null}
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
          <PlanName>No terminal plan</PlanName>
          <PlanSubline>
            <span>{status === "loading" ? "Loading" : "Waiting for create_plan"}</span>
          </PlanSubline>
        </EmptyPanel>
      )}

      <HistoryPanel>
        <HistoryTitle>History</HistoryTitle>
        {history.length ? (
          <HistoryList>
            {history.map((plan) => {
              const canResume = plan.can_resume === true;
              return (
                <HistoryItem key={plan.plan_id || plan.task_id}>
                  <div>
                    <HistoryName>{plan.title || plan.task_title || "Terminal task"}</HistoryName>
                    <HistoryMeta>
                      <span>{planStatusLabel(plan.status)}</span>
                      {timestampLabel(plan.updated_at) && <span>{timestampLabel(plan.updated_at)}</span>}
                    </HistoryMeta>
                  </div>
                  {canResume && (
                    <ResumeButton
                      onClick={() => onResumePlan?.(plan)}
                      type="button"
                    >
                      Resume
                    </ResumeButton>
                  )}
                </HistoryItem>
              );
            })}
          </HistoryList>
        ) : (
          <HistoryEmpty>No plan history</HistoryEmpty>
        )}
      </HistoryPanel>
    </PlansSurface>
  );
}

const PlansSurface = styled.section`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 10px;
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
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(216, 226, 240, 0.12);
  border-radius: 8px;
  background: rgba(11, 16, 24, 0.68);
`;

const EmptyPanel = styled(PlanPanel)`
  display: grid;
  align-content: center;
  gap: 8px;
  min-height: 150px;
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
  max-height: 42vh;
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

const HistoryPanel = styled.aside`
  display: grid;
  gap: 8px;
  min-width: 0;
  border-top: 1px solid rgba(216, 226, 240, 0.1);
  padding-top: 10px;
`;

const HistoryTitle = styled.h3`
  margin: 0;
  color: rgba(238, 245, 255, 0.86);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0;
`;

const HistoryList = styled.div`
  display: grid;
  gap: 7px;
  max-height: 170px;
  overflow: auto;
`;

const HistoryItem = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid rgba(216, 226, 240, 0.1);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.035);
`;

const HistoryName = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #edf5ff;
  font-size: 12px;
  font-weight: 800;
`;

const HistoryMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 3px;
  color: rgba(216, 226, 240, 0.56);
  font-size: 10px;
`;

const ResumeButton = styled.button`
  border: 1px solid rgba(116, 171, 255, 0.28);
  border-radius: 7px;
  padding: 5px 8px;
  color: #d8e8ff;
  background: rgba(50, 124, 245, 0.14);
  font-size: 11px;
  font-weight: 850;
`;

const HistoryEmpty = styled.div`
  color: rgba(216, 226, 240, 0.54);
  font-size: 12px;
`;
