import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import {
  ButtonCheckIcon,
  ButtonHubIcon,
  ButtonRefreshIcon,
  ButtonTerminalIcon,
  ButtonForgeIcon,
  FormMessage,
  PanelHeading,
  PanelKicker,
  PrimaryButton,
  SecondaryButton,
  SettingsHint,
  SettingsLabel,
} from "../app/appStyles";

const DEFAULT_PLAN = `{
  "objective": "Coordinate local agents",
  "summary": "Mock/local plan import",
  "items": [
    {
      "title": "Prepare implementation slice",
      "body": "Claim, lease resources, implement, and submit through the kernel.",
      "role": "architect",
      "priority": 10,
      "risk_level": 1,
      "depends_on": [],
      "required_resources": ["glob:src/**"],
      "expected_outputs": ["Validated patch"]
    }
  ],
  "contracts": [],
  "qa_checks": ["cargo check", "npm run build:web"]
}`;

function unwrapData(response, fallback = {}) {
  if (!response || typeof response !== "object") {
    return fallback;
  }

  return response.data || response;
}

function errorMessage(error) {
  if (typeof error === "string") {
    return error;
  }
  if (error?.message) {
    return error.message;
  }
  return "Coordination command failed.";
}

function itemId(item) {
  return item?.id || item?.task_id || item?.session_id || item?.run_id || item?.seq || Math.random().toString(36);
}

function CompactTable({ columns, empty, rows }) {
  if (!rows?.length) {
    return <EmptyLine>{empty}</EmptyLine>;
  }

  return (
    <TableShell>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={itemId(row)}>
            {columns.map((column) => (
              <td key={column.key}>{column.render ? column.render(row) : row[column.key] || "none"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export default function CoordinationWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  workspace,
}) {
  const repoPath = rootDirectory || defaultWorkingDirectory || "";
  const workspaceName = workspace?.name || "Workspace";
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskBody, setTaskBody] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryResults, setMemoryResults] = useState([]);
  const [sqlText, setSqlText] = useState("SELECT * FROM users LIMIT 5;");
  const [sqlResult, setSqlResult] = useState(null);
  const [objective, setObjective] = useState("");
  const [planJson, setPlanJson] = useState(DEFAULT_PLAN);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [message, setMessage] = useState("");

  const commandBase = useMemo(() => ({ repoPath }), [repoPath]);

  const refresh = useCallback(async () => {
    if (!repoPath) {
      return;
    }

    setStatus("loading");
    setError("");
    try {
      await invoke("coordination_init", commandBase);
      const response = await invoke("coordination_get_snapshot", commandBase);
      setSnapshot(unwrapData(response));
      setStatus("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, [commandBase, repoPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTask = async (event) => {
    event.preventDefault();
    if (!taskTitle.trim()) {
      return;
    }
    setMessage("");
    setError("");
    try {
      await invoke("coordination_create_task", {
        ...commandBase,
        input: {
          title: taskTitle.trim(),
          body: taskBody.trim(),
          priority: 0,
          risk_level: 1,
        },
      });
      setTaskTitle("");
      setTaskBody("");
      setMessage("Task created.");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const classifySql = async () => {
    setError("");
    try {
      const response = await invoke("coordination_db_classify_sql", {
        ...commandBase,
        sql: sqlText,
      });
      setSqlResult(unwrapData(response));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const searchMemory = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const response = await invoke("coordination_search_memory", {
        ...commandBase,
        input: { query: memoryQuery },
      });
      setMemoryResults(unwrapData(response).memories || []);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const createRun = async (event) => {
    event.preventDefault();
    if (!objective.trim()) {
      return;
    }
    setError("");
    try {
      const response = await invoke("coordination_create_orchestration_run", {
        ...commandBase,
        input: { objective: objective.trim(), constraints: { localOnly: true } },
      });
      const runId = unwrapData(response).run_id;
      setSelectedRunId(runId || "");
      setObjective("");
      setMessage("Local orchestration run created.");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const importPlan = async () => {
    if (!selectedRunId) {
      setError("Select or create an orchestration run first.");
      return;
    }
    try {
      const parsed = JSON.parse(planJson);
      await invoke("coordination_import_orchestration_plan", {
        ...commandBase,
        input: { run_id: selectedRunId, plan_json: parsed },
      });
      setMessage("Plan imported as proposed items.");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const adoptPlan = async () => {
    if (!selectedRunId) {
      setError("Select a run before adopting a plan.");
      return;
    }
    try {
      await invoke("coordination_adopt_orchestration_plan", {
        ...commandBase,
        runId: selectedRunId,
      });
      setMessage("Plan adopted into local authoritative tasks.");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const syncOnce = async () => {
    try {
      const response = await invoke("coordination_orchestrator_sync_once", {
        ...commandBase,
        runId: selectedRunId || null,
      });
      const warnings = response?.warnings?.join(" ") || "";
      setMessage(warnings || "Cloud sync processed.");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const cloud = snapshot?.cloud_orchestrator || {};
  const sqlPolicy = snapshot?.sql_policy || {};
  const runs = snapshot?.orchestration_runs || [];
  const planItems = snapshot?.orchestration_plan_items || [];

  return (
    <CoordinationSurface aria-label="Coordination kernel">
      <CoordinationHeader>
        <HeaderTitle>
          <HeaderIcon aria-hidden="true">
            <ButtonHubIcon />
          </HeaderIcon>
          <div>
            <PanelKicker>Coordination</PanelKicker>
            <PanelHeading>{workspaceName} kernel</PanelHeading>
            <SettingsHint>{repoPath || "No workspace root selected"}</SettingsHint>
          </div>
        </HeaderTitle>
        <HeaderActions>
          <StatusPill data-state={cloud.enabled ? "enabled" : "disabled"}>
            Cloud {cloud.enabled ? cloud.mode : "local-only"}
          </StatusPill>
          <SecondaryButton disabled={!repoPath || status === "loading"} onClick={refresh} type="button">
            <ButtonRefreshIcon aria-hidden="true" />
            <span>{status === "loading" ? "Refreshing" : "Refresh"}</span>
          </SecondaryButton>
        </HeaderActions>
      </CoordinationHeader>

      {error && <FormMessage $state="error">{error}</FormMessage>}
      {message && <InlineMessage>{message}</InlineMessage>}

      <Grid>
        <Panel>
          <PanelTopline>
            <span>Tasks</span>
            <strong>{snapshot?.tasks?.length || 0}</strong>
          </PanelTopline>
          <TaskForm onSubmit={createTask}>
            <Field>
              <SettingsLabel>Title</SettingsLabel>
              <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Implementation slice" />
            </Field>
            <Field>
              <SettingsLabel>Body</SettingsLabel>
              <Textarea value={taskBody} onChange={(event) => setTaskBody(event.target.value)} placeholder="Scope, risks, expected output" rows={3} />
            </Field>
            <PrimaryButton disabled={!taskTitle.trim()} type="submit">
              <ButtonCheckIcon aria-hidden="true" />
              <span>Create</span>
            </PrimaryButton>
          </TaskForm>
          <CompactTable
            columns={[
              { key: "title", label: "Task" },
              { key: "status", label: "Status" },
              { key: "claimed_session_id", label: "Session", render: (row) => row.claimed_session_id || "none" },
            ]}
            empty="No tasks yet."
            rows={snapshot?.tasks || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Sessions</span>
            <strong>{snapshot?.sessions?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "agent_id", label: "Agent" },
              { key: "status", label: "Status" },
              { key: "enforcement_mode", label: "Mode" },
              { key: "write_root", label: "Write root" },
            ]}
            empty="No sessions."
            rows={snapshot?.sessions || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Worktrees</span>
            <strong>{snapshot?.worktrees?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "branch_name", label: "Branch" },
              { key: "status", label: "Status" },
              { key: "path", label: "Path" },
            ]}
            empty="No worktrees."
            rows={snapshot?.worktrees || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Leases</span>
            <strong>{snapshot?.active_leases?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "resource_key", label: "Resource" },
              { key: "mode", label: "Mode" },
              { key: "agent_id", label: "Agent" },
              { key: "expires_at", label: "Expires" },
            ]}
            empty="No active leases."
            rows={snapshot?.active_leases || []}
          />
        </Panel>

        <Panel data-tone={(snapshot?.open_workspace_violations || []).length ? "warn" : "normal"}>
          <PanelTopline>
            <span>Violations</span>
            <strong>{snapshot?.open_workspace_violations?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "violation_kind", label: "Kind" },
              { key: "severity", label: "Severity" },
              { key: "path", label: "Path" },
              { key: "status", label: "Status" },
            ]}
            empty="No open workspace violations."
            rows={snapshot?.open_workspace_violations || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Patch Gate</span>
            <strong>{snapshot?.patch_validations?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "status", label: "Validation" },
              { key: "task_id", label: "Task" },
              { key: "worktree_id", label: "Worktree" },
              { key: "validation_summary", label: "Summary" },
            ]}
            empty="No patch validations."
            rows={snapshot?.patch_validations || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Merge Jobs</span>
            <strong>{snapshot?.merge_jobs?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "status", label: "Status" },
              { key: "strategy", label: "Strategy" },
              { key: "patch_id", label: "Patch" },
              { key: "error_message", label: "Error", render: (row) => row.error_message || "none" },
            ]}
            empty="No merge jobs."
            rows={snapshot?.merge_jobs || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Policy</span>
            <strong>{sqlPolicy.sql_mcp_default || "off"}</strong>
          </PanelTopline>
          <PolicyGrid>
            <PolicyItem>
              <span>Worktrees</span>
              <strong>{snapshot?.repo_policy?.agent_worktree_required ? "required" : "optional"}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Patch leases</span>
              <strong>{snapshot?.repo_policy?.patch_lease_validation_required ? "required" : "off"}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Merge gate</span>
              <strong>{snapshot?.repo_policy?.merge_gate_required ? "required" : "off"}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>SQL</span>
              <strong>{sqlPolicy.effective_mode || "off"}</strong>
            </PolicyItem>
          </PolicyGrid>
          <SettingsHint>SQL execution is not configured; classifier and migration proposals stay local.</SettingsHint>
        </Panel>

        <Panel>
          <PanelTopline>
            <span>SQL Classifier</span>
            <strong>{sqlResult?.classification || "idle"}</strong>
          </PanelTopline>
          <Textarea value={sqlText} onChange={(event) => setSqlText(event.target.value)} rows={5} />
          <SecondaryButton onClick={classifySql} type="button">
            <ButtonCheckIcon aria-hidden="true" />
            <span>Classify</span>
          </SecondaryButton>
          {sqlResult && (
            <ResultLine>
              {sqlResult.classification} · risk {sqlResult.risk_level} · {sqlResult.blocked_by_default ? "blocked by default" : "allowed by policy"}
            </ResultLine>
          )}
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Memory</span>
            <strong>{snapshot?.memories?.length || 0}</strong>
          </PanelTopline>
          <TaskForm onSubmit={searchMemory}>
            <Field>
              <SettingsLabel>Search</SettingsLabel>
              <Input value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} placeholder="contracts, handoffs, decisions" />
            </Field>
            <SecondaryButton type="submit">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>Search</span>
            </SecondaryButton>
          </TaskForm>
          <CompactTable
            columns={[
              { key: "memory_kind", label: "Kind" },
              { key: "title", label: "Title" },
              { key: "trust_level", label: "Trust" },
            ]}
            empty="No memory results."
            rows={memoryResults.length ? memoryResults : snapshot?.memories || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Cloud Orchestrator</span>
            <strong>{cloud.mode || "disabled"}</strong>
          </PanelTopline>
          <CloudNote>
            <ButtonTerminalIcon aria-hidden="true" />
            <span>{cloud.message || "Cloud disabled; local kernel is authoritative."}</span>
          </CloudNote>
          <PolicyGrid>
            <PolicyItem>
              <span>Export</span>
              <strong>{cloud.context_export_policy || "local_only"}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Code</span>
              <strong>{cloud.allow_code_export ? "allowed" : "blocked"}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Logs</span>
              <strong>{cloud.allow_terminal_log_export ? "allowed" : "blocked"}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Auto merge</span>
              <strong>blocked</strong>
            </PolicyItem>
          </PolicyGrid>
          <SecondaryButton onClick={syncOnce} type="button">
            <ButtonRefreshIcon aria-hidden="true" />
            <span>Sync once</span>
          </SecondaryButton>
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Orchestration</span>
            <strong>{runs.length}</strong>
          </PanelTopline>
          <TaskForm onSubmit={createRun}>
            <Field>
              <SettingsLabel>Objective</SettingsLabel>
              <Textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} placeholder="Coordinate a multi-agent implementation" />
            </Field>
            <PrimaryButton disabled={!objective.trim()} type="submit">
              <ButtonForgeIcon aria-hidden="true" />
              <span>Create run</span>
            </PrimaryButton>
          </TaskForm>
          <Select value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
            <option value="">Select run</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>{run.objective || run.id}</option>
            ))}
          </Select>
          <Textarea value={planJson} onChange={(event) => setPlanJson(event.target.value)} rows={10} />
          <ButtonRow>
            <SecondaryButton onClick={importPlan} type="button">
              <ButtonHubIcon aria-hidden="true" />
              <span>Import plan</span>
            </SecondaryButton>
            <PrimaryButton onClick={adoptPlan} type="button">
              <ButtonCheckIcon aria-hidden="true" />
              <span>Adopt plan</span>
            </PrimaryButton>
          </ButtonRow>
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Plan Items</span>
            <strong>{planItems.length}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "title", label: "Item" },
              { key: "assigned_role", label: "Role" },
              { key: "status", label: "Status" },
              { key: "task_id", label: "Task", render: (row) => row.task_id || "proposed" },
            ]}
            empty="No plan items."
            rows={planItems}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Recent Events</span>
            <strong>{snapshot?.events?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "seq", label: "#" },
              { key: "event_type", label: "Event" },
              { key: "actor_type", label: "Actor" },
              { key: "created_at", label: "At" },
            ]}
            empty="No events."
            rows={snapshot?.events || []}
          />
        </Panel>
      </Grid>
    </CoordinationSurface>
  );
}

const CoordinationSurface = styled.section`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  color: #dfe7f4;
  background: rgba(4, 7, 11, 0.88);
`;

const CoordinationHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(12, 17, 25, 0.82);
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
`;

const HeaderIcon = styled.span`
  display: grid;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgba(70, 135, 240, 0.36);
  border-radius: 7px;
  color: #7fb1ff;
  background: rgba(47, 128, 255, 0.1);
`;

const HeaderActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
`;

const StatusPill = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  color: #9ca9ba;
  font-size: 12px;
  font-weight: 800;

  &[data-state="enabled"] {
    border-color: rgba(255, 151, 71, 0.34);
    color: #ffc08a;
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(260px, 1fr));
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;

  @media (max-width: 1180px) {
    grid-template-columns: repeat(2, minmax(260px, 1fr));
  }

  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Panel = styled.section`
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  min-height: 180px;
  max-height: 520px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(10, 14, 20, 0.84);

  &[data-tone="warn"] {
    border-color: rgba(255, 151, 71, 0.38);
  }
`;

const PanelTopline = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #f4f7fb;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;

  strong {
    color: #7fb1ff;
  }
`;

const TaskForm = styled.form`
  display: grid;
  gap: 8px;
`;

const Field = styled.label`
  display: grid;
  gap: 5px;
  min-width: 0;
`;

const Input = styled.input`
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  color: #eef4ff;
  background: rgba(2, 5, 10, 0.72);
  font: inherit;
`;

const Textarea = styled.textarea`
  width: 100%;
  min-width: 0;
  resize: vertical;
  padding: 8px 9px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  color: #eef4ff;
  background: rgba(2, 5, 10, 0.72);
  font: inherit;
  line-height: 1.45;
`;

const Select = styled.select`
  width: 100%;
  min-width: 0;
  height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  color: #eef4ff;
  background: rgba(2, 5, 10, 0.9);
`;

const TableShell = styled.table`
  width: 100%;
  min-width: 0;
  border-collapse: collapse;
  overflow: hidden;
  font-size: 12px;

  th,
  td {
    max-width: 220px;
    padding: 6px 6px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  th {
    color: #8190a5;
    font-weight: 850;
  }

  td {
    color: #d7e0ee;
  }
`;

const EmptyLine = styled.p`
  margin: 0;
  color: #778397;
  font-size: 12px;
  font-weight: 760;
`;

const PolicyGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
`;

const PolicyItem = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 7px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.03);

  span {
    color: #7d899c;
    font-size: 11px;
    font-weight: 800;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: #edf4ff;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ResultLine = styled.p`
  margin: 0;
  color: #ffc08a;
  font-size: 12px;
  font-weight: 800;
`;

const InlineMessage = styled.p`
  margin: 0;
  color: #9fd0ff;
  font-size: 12px;
  font-weight: 800;
`;

const CloudNote = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: #a8b4c5;
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;

  svg {
    flex: 0 0 auto;
    margin-top: 2px;
    color: #7fb1ff;
  }
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;
