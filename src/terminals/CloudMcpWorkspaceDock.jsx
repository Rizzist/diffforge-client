import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error?.message) {
    return error.message;
  }
  return fallback;
}

function getPolicyProposals(policy) {
  const raw = policy?.proposals?.data?.proposals || policy?.proposals?.proposals || policy?.proposals || [];
  return Array.isArray(raw) ? raw : [];
}

function getActiveProposalId(policy, proposals) {
  const explicit =
    policy?.proposalId ||
    policy?.proposal_id ||
    policy?.proposals?.data?.activeProposalId ||
    policy?.proposals?.data?.active_proposal_id ||
    policy?.proposals?.activeProposalId ||
    policy?.proposals?.active_proposal_id ||
    "";
  if (explicit) {
    return explicit;
  }

  const activeProposal = proposals.find((proposal) => proposal.status === "proposed") || proposals[0];
  return activeProposal?.id || activeProposal?.proposal_id || "";
}

function getOrchestrationRuns(policy) {
  const raw = policy?.orchestration?.data?.runs || policy?.orchestration?.runs || [];
  return Array.isArray(raw) ? raw : [];
}

function getActivePlanId(policy) {
  const runs = getOrchestrationRuns(policy);
  const activeRun = runs.find((run) => run.status === "plan_received")
    || runs.find((run) => run.status === "draft" || run.status === "revision_requested");
  return activeRun?.id || activeRun?.run_id || "";
}

function hasDetectedPolicyGraph(policy, workspaceStatus) {
  return Boolean(
    workspaceStatus?.policyGraphDetected ||
      policy?.policyGraph?.data?.detected ||
      policy?.policyGraph?.data?.snapshot ||
      policy?.policyGraph?.data?.snapshotId ||
      policy?.policyGraph?.data?.snapshot_id ||
      policy?.policyGraph?.detected ||
      policy?.policyGraph?.snapshot ||
      policy?.policyGraph?.snapshotId ||
      policy?.policyGraph?.snapshot_id
  );
}

function summarizePolicyProposals(policy) {
  const proposals = getPolicyProposals(policy);
  const runs = getOrchestrationRuns(policy);
  const planProposals = runs
    .filter((run) => ["draft", "plan_received", "revision_requested", "accepted", "rejected"].includes(run.status))
    .map((run) => ({
      id: run.id || run.run_id || "",
      status: run.status || "unknown",
      objective: run.objective || "",
      summary: run.summary || "",
      source: run.source || "cloud",
      createdAt: run.created_at || run.createdAt || "",
      updatedAt: run.updated_at || run.updatedAt || "",
    }));

  if (!proposals.length && !planProposals.length) {
    return [
      "No project policy or plan proposals yet.",
      "",
      "When Cloud MCP creates a plan for a terminal prompt, it will appear here for accept/reject before code can run.",
    ].join("\n");
  }

  const activeProposalId = getActiveProposalId(policy, proposals);
  const activePlanId = getActivePlanId(policy);
  const projectProposals = proposals.map((proposal) => ({
    id: proposal.id || proposal.proposal_id || "",
    status: proposal.status || "unknown",
    objective: proposal.objective || "",
    summary: proposal.summary || "",
    proposal: proposal.proposal_json || proposal.proposalJson || null,
    createdAt: proposal.created_at || proposal.createdAt || "",
    updatedAt: proposal.updated_at || proposal.updatedAt || "",
  }));

  return JSON.stringify(
    {
      activeProposalId,
      activePlanId,
      policyProposals: projectProposals,
      planProposals,
    },
    null,
    2
  );
}

function summarizeConnection(policy, status, workspaceStatus) {
  return JSON.stringify(
    {
      cloudMcp: status,
      policyGraph: hasDetectedPolicyGraph(policy, workspaceStatus) ? "Detected" : "Pending",
      workspace: workspaceStatus,
      serverStatus: policy?.serverStatus || null,
      alignmentReport: policy?.alignmentReport || null,
    },
    null,
    2
  );
}

const TODO_QUEUE_STORAGE_PREFIX = "__diff_forge_todo_groups_v1__\n";
const TODO_DRAG_MIME = "application/x-diffforge-todo";

function createTodoGroupId() {
  return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTodoGroup(group) {
  const text = String(group?.text || "").trim();
  if (!text) {
    return null;
  }

  return {
    id: String(group?.id || createTodoGroupId()),
    text,
    createdAt: String(group?.createdAt || new Date().toISOString()),
  };
}

function parseTodoQueueText(text) {
  const raw = String(text || "");
  if (!raw.trim()) {
    return { groups: [], draft: "" };
  }

  if (raw.startsWith(TODO_QUEUE_STORAGE_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(TODO_QUEUE_STORAGE_PREFIX.length));
      const groups = Array.isArray(parsed?.groups)
        ? parsed.groups.map(normalizeTodoGroup).filter(Boolean)
        : [];
      return {
        groups,
        draft: typeof parsed?.draft === "string" ? parsed.draft : "",
      };
    } catch (_error) {
      return { groups: [], draft: raw };
    }
  }

  return {
    groups: raw
      .split(/\n+/)
      .map((item) => normalizeTodoGroup({ text: item }))
      .filter(Boolean),
    draft: "",
  };
}

function serializeTodoQueue(groups, draft) {
  return `${TODO_QUEUE_STORAGE_PREFIX}${JSON.stringify(
    {
      groups: groups.map(normalizeTodoGroup).filter(Boolean),
      draft: String(draft || ""),
    },
    null,
    2
  )}`;
}

function getTodoDragPayload(group) {
  return JSON.stringify({
    source: "diffforge.todo_queue",
    id: group.id,
    text: group.text,
  });
}

export default function CloudMcpWorkspaceDock({ rootDirectory, workspace }) {
  const [activeTab, setActiveTab] = useState("todo");
  const [status, setStatus] = useState(null);
  const [workspaceStatus, setWorkspaceStatus] = useState(null);
  const [todoText, setTodoText] = useState("");
  const [todoGroups, setTodoGroups] = useState([]);
  const [todoState, setTodoState] = useState("idle");
  const [policy, setPolicy] = useState(null);
  const [policyState, setPolicyState] = useState("idle");
  const [message, setMessage] = useState("");
  const mountedRef = useRef(false);
  const todoLoadedRef = useRef(false);
  const todoSaveTimeoutRef = useRef(null);

  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "";
  const hasWorkspaceRoot = Boolean(rootDirectory && workspaceId);
  const connected = Boolean(status?.connected);
  const statusLabel = connected ? "Connected" : status?.status === "blocked" ? "Blocked" : "Connecting";
  const proposals = useMemo(() => getPolicyProposals(policy), [policy]);
  const proposalId = getActiveProposalId(policy, proposals);
  const planId = getActivePlanId(policy);

  const registerWorkspace = useCallback(async () => {
    setMessage("");
    setPolicyState("loading");
    setTodoState("loading");

    try {
      const nextStatus = await invoke("cloud_mcp_connect");
      if (!mountedRef.current) {
        return;
      }
      setStatus(nextStatus);

      if (!hasWorkspaceRoot) {
        setPolicyState("idle");
        setTodoState("idle");
        return;
      }

      const registration = await invoke("cloud_mcp_register_workspace", {
        repoPath: rootDirectory,
        workspaceId,
        workspaceName,
      });
      if (!mountedRef.current) {
        return;
      }
      setStatus(registration?.status || nextStatus);
      setWorkspaceStatus(registration?.workspace || null);
      setMessage(registration?.message || "Workspace registered with Cloud MCP.");

      const [todoResult, policyResult] = await Promise.all([
        invoke("cloud_mcp_get_todo", { repoPath: rootDirectory }),
        invoke("cloud_mcp_get_policy", {
          repoPath: rootDirectory,
          workspaceId,
        }),
      ]);
      if (!mountedRef.current) {
        return;
      }
      const loadedTodo = parseTodoQueueText(todoResult?.text || "");
      setTodoGroups(loadedTodo.groups);
      setTodoText(loadedTodo.draft);
      todoLoadedRef.current = true;
      setPolicy(policyResult || null);
      setStatus(policyResult?.status || todoResult?.status || registration?.status || nextStatus);
      setTodoState("idle");
      setPolicyState("idle");
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setMessage(getErrorMessage(error, "Cloud MCP is not ready."));
      setTodoState("error");
      setPolicyState("error");
      try {
        const nextStatus = await invoke("cloud_mcp_get_status");
        if (mountedRef.current) {
          setStatus(nextStatus);
        }
      } catch {
        setStatus((current) => current || { connected: false, status: "blocked" });
      }
    }
  }, [hasWorkspaceRoot, rootDirectory, workspaceId, workspaceName]);

  useEffect(() => {
    mountedRef.current = true;
    registerWorkspace();
    return () => {
      mountedRef.current = false;
      if (todoSaveTimeoutRef.current) {
        window.clearTimeout(todoSaveTimeoutRef.current);
      }
    };
  }, [registerWorkspace]);

  useEffect(() => {
    if (!hasWorkspaceRoot || !todoLoadedRef.current) {
      return undefined;
    }

    if (todoSaveTimeoutRef.current) {
      window.clearTimeout(todoSaveTimeoutRef.current);
    }

    todoSaveTimeoutRef.current = window.setTimeout(() => {
      invoke("cloud_mcp_save_todo", {
        repoPath: rootDirectory,
        workspaceId,
        workspaceName,
        text: serializeTodoQueue(todoGroups, todoText),
      }).catch(() => {});
    }, 700);

    return () => {
      if (todoSaveTimeoutRef.current) {
        window.clearTimeout(todoSaveTimeoutRef.current);
      }
    };
  }, [hasWorkspaceRoot, rootDirectory, todoGroups, todoText, workspaceId, workspaceName]);

  const saveTodo = useCallback(async () => {
    if (!hasWorkspaceRoot || todoState === "saving") {
      return;
    }

    setTodoState("saving");
    setMessage("");
    try {
      const result = await invoke("cloud_mcp_save_todo", {
        repoPath: rootDirectory,
        workspaceId,
        workspaceName,
        text: serializeTodoQueue(todoGroups, todoText),
      });
      setStatus(result?.status || status);
      const savedTodo = parseTodoQueueText(result?.text || serializeTodoQueue(todoGroups, todoText));
      setTodoGroups(savedTodo.groups);
      setTodoText(savedTodo.draft);
      setTodoState("idle");
      setMessage(result?.synced ? "To Do Queue saved and synced." : (result?.lastError || "To Do Queue saved locally."));
    } catch (error) {
      setTodoState("error");
      setMessage(getErrorMessage(error, "Unable to save To Do Queue."));
    }
  }, [hasWorkspaceRoot, rootDirectory, status, todoGroups, todoState, todoText, workspaceId, workspaceName]);

  const refreshPolicy = useCallback(async () => {
    if (!hasWorkspaceRoot || policyState === "loading") {
      return;
    }

    setPolicyState("loading");
    setMessage("");
    try {
      const result = await invoke("cloud_mcp_get_policy", {
        repoPath: rootDirectory,
        workspaceId,
      });
      setPolicy(result || null);
      setStatus(result?.status || status);
      setPolicyState("idle");
      setMessage(result?.message || "Policy refreshed from Cloud MCP.");
    } catch (error) {
      setPolicyState("error");
      setMessage(getErrorMessage(error, "Unable to fetch policy."));
    }
  }, [hasWorkspaceRoot, policyState, rootDirectory, status, workspaceId]);

  const groupTodoDraft = useCallback(() => {
    const chunks = todoText
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!chunks.length) {
      return;
    }

    const createdAt = new Date().toISOString();
    const nextGroups = chunks.map((text) => ({
      id: createTodoGroupId(),
      text,
      createdAt,
    }));

    setTodoGroups((groups) => [...groups, ...nextGroups]);
    setTodoText("");
  }, [todoText]);

  const handleTodoKeyDown = useCallback((event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    groupTodoDraft();
  }, [groupTodoDraft]);

  const handleTodoDragStart = useCallback((event, group) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(TODO_DRAG_MIME, getTodoDragPayload(group));
    event.dataTransfer.setData("text/plain", group.text);
  }, []);

  const removeTodoGroup = useCallback((groupId) => {
    setTodoGroups((groups) => groups.filter((group) => group.id !== groupId));
  }, []);

  const decidePolicy = useCallback(async (decision) => {
    if (!hasWorkspaceRoot) {
      return;
    }

    setPolicyState("saving");
    setMessage("");
    try {
      const result = proposalId
        ? await invoke("cloud_mcp_decide_policy", {
            repoPath: rootDirectory,
            workspaceId,
            decision,
            proposalId,
          })
        : await invoke("cloud_mcp_decide_plan", {
            repoPath: rootDirectory,
            decision,
            runId: planId,
          });
      setStatus(result?.status || status);
      setPolicyState("idle");
      setMessage(result?.message || `Policy ${decision} recorded.`);
      await refreshPolicy();
    } catch (error) {
      setPolicyState("error");
      setMessage(getErrorMessage(error, `Unable to ${decision} policy.`));
    }
  }, [hasWorkspaceRoot, planId, proposalId, refreshPolicy, rootDirectory, status, workspaceId]);

  const policyText = useMemo(() => summarizePolicyProposals(policy), [policy]);
  const connectionText = useMemo(
    () => summarizeConnection(policy, status, workspaceStatus),
    [policy, status, workspaceStatus]
  );

  return (
    <Dock aria-label="Cloud MCP workspace control">
      <DockHeader>
        <div>
          <Kicker>Cloud MCP</Kicker>
          <DockTitle>{statusLabel}</DockTitle>
        </div>
        <StatusDot data-connected={connected} />
      </DockHeader>

      <TabRow role="tablist" aria-label="Cloud MCP tabs">
        <TabButton aria-selected={activeTab === "todo"} onClick={() => setActiveTab("todo")} type="button">
          To Do Queue
        </TabButton>
        <TabButton aria-selected={activeTab === "policy"} onClick={() => setActiveTab("policy")} type="button">
          Policy
        </TabButton>
        <TabButton aria-selected={activeTab === "connection"} onClick={() => setActiveTab("connection")} type="button">
          Connection
        </TabButton>
      </TabRow>

      <DockBody>
        {activeTab === "todo" ? (
          <TodoPanel>
            <TodoTextarea
              aria-label="Workspace To Do Queue"
              disabled={!hasWorkspaceRoot}
              onChange={(event) => setTodoText(event.target.value)}
              onKeyDown={handleTodoKeyDown}
              placeholder={hasWorkspaceRoot ? "Notepad: type a task, press Enter to group it..." : "Pick a workspace root to enable the queue."}
              value={todoText}
            />
            <TodoHint>Enter groups the current note. Shift+Enter keeps writing. Drag a grouped card into any terminal.</TodoHint>
            <TodoGroupList aria-label="Grouped To Do prompts">
              {todoGroups.length ? todoGroups.map((group) => (
                <TodoGroupCard
                  draggable
                  key={group.id}
                  onDragStart={(event) => handleTodoDragStart(event, group)}
                  title="Drag into a terminal"
                >
                  <TodoGroupText>{group.text}</TodoGroupText>
                  <TodoGroupRemove
                    aria-label="Remove grouped prompt"
                    onClick={() => removeTodoGroup(group.id)}
                    type="button"
                  >
                    Done
                  </TodoGroupRemove>
                </TodoGroupCard>
              )) : (
                <TodoEmpty>No grouped prompts yet. Type below and press Enter.</TodoEmpty>
              )}
            </TodoGroupList>
          </TodoPanel>
        ) : activeTab === "policy" ? (
          <PolicyPanel>
            <PolicyPre>{policyText}</PolicyPre>
            <PolicyFooter>
              <GhostButton disabled={!hasWorkspaceRoot || policyState === "loading"} onClick={refreshPolicy} type="button">
                Refresh
              </GhostButton>
              <DecisionRow>
                <RejectButton disabled={!hasWorkspaceRoot || policyState === "saving" || (!proposalId && !planId)} onClick={() => decidePolicy("reject")} type="button">
                  Reject
                </RejectButton>
                <AcceptButton disabled={!hasWorkspaceRoot || policyState === "saving" || (!proposalId && !planId)} onClick={() => decidePolicy("accept")} type="button">
                  Accept
                </AcceptButton>
              </DecisionRow>
            </PolicyFooter>
          </PolicyPanel>
        ) : (
          <PolicyPanel>
            <PolicyPre>{connectionText}</PolicyPre>
            <PolicyFooter>
              <GhostButton disabled={!hasWorkspaceRoot || policyState === "loading"} onClick={refreshPolicy} type="button">
                Refresh
              </GhostButton>
            </PolicyFooter>
          </PolicyPanel>
        )}
      </DockBody>
    </Dock>
  );
}

const Dock = styled.aside`
  min-width: 280px;
  max-width: 340px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(95, 179, 255, 0.22);
  border-radius: 22px;
  background:
    radial-gradient(circle at 20% 0%, rgba(255, 138, 76, 0.14), transparent 34%),
    linear-gradient(155deg, rgba(7, 16, 27, 0.96), rgba(9, 23, 36, 0.92));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
`;

const DockHeader = styled.header`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
`;

const Kicker = styled.span`
  display: block;
  color: rgba(138, 201, 255, 0.78);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
`;

const DockTitle = styled.strong`
  display: block;
  margin-top: 3px;
  color: #f4fbff;
  font-size: 1rem;
`;

const StatusDot = styled.span`
  width: 10px;
  height: 10px;
  border-radius: 999px;
  margin-top: 4px;
  background: ${({ "data-connected": connected }) => connected ? "#48f29a" : "#ff895f"};
  box-shadow: 0 0 18px ${({ "data-connected": connected }) => connected ? "rgba(72, 242, 154, 0.7)" : "rgba(255, 137, 95, 0.6)"};
`;

const MetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const MetaItem = styled.div`
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);

  span,
  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: rgba(191, 214, 232, 0.62);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.11em;
  }

  strong {
    margin-top: 4px;
    color: rgba(245, 250, 255, 0.92);
    font-size: 0.78rem;
  }
`;

const DockMessage = styled.div`
  padding: 9px 10px;
  border-radius: 14px;
  color: ${({ "data-state": state }) => state === "error" ? "#ffd6ca" : "#dcefff"};
  background: ${({ "data-state": state }) => state === "error" ? "rgba(255, 115, 84, 0.12)" : "rgba(95, 179, 255, 0.1)"};
  border: 1px solid ${({ "data-state": state }) => state === "error" ? "rgba(255, 115, 84, 0.24)" : "rgba(95, 179, 255, 0.18)"};
  font-size: 0.75rem;
  line-height: 1.45;
`;

const TabRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 4px;
  gap: 4px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
`;

const TabButton = styled.button`
  border: 0;
  border-radius: 11px;
  padding: 8px 7px;
  color: ${({ "aria-selected": selected }) => selected ? "#07101b" : "rgba(219, 236, 250, 0.72)"};
  background: ${({ "aria-selected": selected }) => selected ? "linear-gradient(135deg, #8ad8ff, #ffad7c)" : "transparent"};
  font-size: 0.73rem;
  font-weight: 800;
  cursor: pointer;
`;

const DockBody = styled.div`
  min-height: 0;
  flex: 1;
  display: flex;
`;

const TodoPanel = styled.div`
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const TodoHint = styled.div`
  color: rgba(204, 224, 241, 0.68);
  font-size: 0.72rem;
  line-height: 1.45;
`;

const TodoGroupList = styled.div`
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding-right: 2px;
`;

const TodoGroupCard = styled.div`
  border: 1px solid rgba(138, 216, 255, 0.18);
  border-radius: 12px;
  padding: 9px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  background: linear-gradient(135deg, rgba(138, 216, 255, 0.12), rgba(255, 173, 124, 0.08));
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`;

const TodoGroupText = styled.div`
  min-width: 0;
  color: rgba(239, 249, 255, 0.92);
  font-size: 0.78rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

const TodoGroupRemove = styled.button`
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 4px 7px;
  color: rgba(224, 242, 255, 0.72);
  background: rgba(255, 255, 255, 0.045);
  font-size: 0.65rem;
  font-weight: 800;
  cursor: pointer;
`;

const TodoEmpty = styled.div`
  border: 1px dashed rgba(138, 216, 255, 0.18);
  border-radius: 12px;
  padding: 14px 12px;
  color: rgba(204, 224, 241, 0.52);
  font-size: 0.76rem;
  line-height: 1.45;
`;

const TodoTextarea = styled.textarea`
  flex: 0 0 118px;
  min-height: 104px;
  resize: none;
  border: 1px solid rgba(138, 216, 255, 0.18);
  border-radius: 12px;
  padding: 12px;
  color: #f6fbff;
  background: rgba(3, 8, 14, 0.58);
  font: 0.82rem/1.5 "JetBrains Mono", "Fira Code", monospace;
  outline: none;

  &:focus {
    border-color: rgba(255, 173, 124, 0.58);
    box-shadow: 0 0 0 3px rgba(255, 173, 124, 0.1);
  }
`;

const PolicyPanel = styled.div`
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const PolicyPre = styled.pre`
  flex: 1;
  min-height: 220px;
  margin: 0;
  overflow: auto;
  border: 1px solid rgba(138, 216, 255, 0.18);
  border-radius: 16px;
  padding: 12px;
  color: rgba(235, 247, 255, 0.86);
  background: rgba(3, 8, 14, 0.58);
  font: 0.72rem/1.5 "JetBrains Mono", "Fira Code", monospace;
  white-space: pre-wrap;
`;

const DockActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const PolicyFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const DecisionRow = styled.div`
  display: flex;
  gap: 8px;
`;

const GhostButton = styled.button`
  border: 1px solid rgba(138, 216, 255, 0.2);
  border-radius: 12px;
  padding: 8px 11px;
  color: rgba(224, 242, 255, 0.82);
  background: rgba(255, 255, 255, 0.045);
  font-size: 0.73rem;
  font-weight: 800;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PrimaryButton = styled(GhostButton)`
  color: #07101b;
  border-color: transparent;
  background: linear-gradient(135deg, #8ad8ff, #ffad7c);
`;

const AcceptButton = styled(PrimaryButton)``;

const RejectButton = styled(GhostButton)`
  color: #ffd8cd;
  border-color: rgba(255, 137, 95, 0.24);
  background: rgba(255, 137, 95, 0.08);
`;
