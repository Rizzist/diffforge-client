import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import {
  ButtonCheckIcon,
  ButtonDeleteIcon,
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

function commandData(response) {
  if (response?.ok === false) {
    const message = response.error?.message || "Coordination command failed.";
    throw new Error(message);
  }
  return unwrapData(response);
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
  const [cleanupAudit, setCleanupAudit] = useState(null);
  const [mergeActionId, setMergeActionId] = useState("");

  const commandBase = useMemo(() => ({ repoPath }), [repoPath]);

  const logUiSurface = useCallback(
    (action, statusValue, details = {}, commandName = null) =>
      invoke("coordination_log_ui_surface_event", {
        ...commandBase,
        input: {
          surface: "coordination_workspace",
          action,
          status: statusValue,
          command_name: commandName,
          details,
        },
      }).catch(() => {}),
    [commandBase],
  );

  const refresh = useCallback(async () => {
    if (!repoPath) {
      return;
    }

    setStatus("loading");
    setError("");
    try {
      await invoke("coordination_init", commandBase);
      await logUiSurface("refresh", "started", { workspaceName }, "coordination_get_snapshot");
      let auditData = null;
      try {
        const auditResponse = await invoke("coordination_cleanup_bloat_dry_run", commandBase);
        auditData = unwrapData(auditResponse);
        setCleanupAudit(auditData);
      } catch (caughtAudit) {
        await logUiSurface("cleanup_bloat_audit", "failed", { error: errorMessage(caughtAudit) }, "coordination_cleanup_bloat_dry_run");
      }
      const response = await invoke("coordination_get_snapshot", commandBase);
      setSnapshot(unwrapData(response));
      setStatus("ready");
      await logUiSurface(
        "refresh",
        "succeeded",
        {
          taskCount: unwrapData(response)?.tasks?.length || 0,
          bloatStatus: auditData?.status || "not_run",
        },
        "coordination_get_snapshot",
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
      await logUiSurface("refresh", "failed", { error: errorMessage(caught) }, "coordination_get_snapshot");
    }
  }, [commandBase, logUiSurface, repoPath, workspaceName]);

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
      await logUiSurface("orchestrator_sync_once", "started", { runId: selectedRunId || null }, "coordination_orchestrator_sync_once");
      const response = await invoke("coordination_orchestrator_sync_once", {
        ...commandBase,
        runId: selectedRunId || null,
      });
      const warnings = response?.warnings?.join(" ") || "";
      setMessage(warnings || "Cloud sync processed.");
      await logUiSurface("orchestrator_sync_once", "succeeded", { runId: selectedRunId || null }, "coordination_orchestrator_sync_once");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      await logUiSurface("orchestrator_sync_once", "failed", { error: errorMessage(caught) }, "coordination_orchestrator_sync_once");
    }
  };

  const runCleanupAudit = async () => {
    setError("");
    setMessage("");
    try {
      await logUiSurface("cleanup_bloat_audit", "started", {}, "coordination_cleanup_bloat_dry_run");
      const response = await invoke("coordination_cleanup_bloat_dry_run", commandBase);
      const data = unwrapData(response);
      setCleanupAudit(data);
      setMessage(data.status === "clean" ? "Cleanup audit is clean." : "Cleanup audit found bloat candidates.");
      await logUiSurface(
        "cleanup_bloat_audit",
        "succeeded",
        {
          status: data.status,
          unexpectedMcp: data.unexpected_mcp_files?.length || 0,
          unexpectedWorktrees: data.unexpected_worktree_dirs?.length || 0,
          staleTemps: data.stale_temp_files?.length || 0,
        },
        "coordination_cleanup_bloat_dry_run",
      );
      const snapshotResponse = await invoke("coordination_get_snapshot", commandBase);
      setSnapshot(unwrapData(snapshotResponse));
    } catch (caught) {
      setError(errorMessage(caught));
      await logUiSurface("cleanup_bloat_audit", "failed", { error: errorMessage(caught) }, "coordination_cleanup_bloat_dry_run");
    }
  };

  const queueMerge = async (patch) => {
    if (!patch?.id) {
      return;
    }
    setError("");
    setMessage("");
    setMergeActionId(`queue:${patch.id}`);
    try {
      await logUiSurface("manual_merge_queue", "started", { patchId: patch.id }, "coordination_request_merge");
      const response = await invoke("coordination_request_merge", {
        ...commandBase,
        input: {
          patch_id: patch.id,
          strategy: "patch_apply",
        },
      });
      const data = commandData(response);
      setMessage(`Merge queued: ${data.merge_job_id || patch.id}`);
      await logUiSurface(
        "manual_merge_queue",
        "succeeded",
        { patchId: patch.id, mergeJobId: data.merge_job_id || null },
        "coordination_request_merge",
      );
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      await logUiSurface("manual_merge_queue", "failed", { patchId: patch.id, error: errorMessage(caught) }, "coordination_request_merge");
    } finally {
      setMergeActionId("");
    }
  };

  const applyMerge = async (job) => {
    if (!job?.id) {
      return;
    }
    setError("");
    setMessage("");
    setMergeActionId(`apply:${job.id}`);
    try {
      await logUiSurface("manual_merge_apply", "started", { mergeJobId: job.id, patchId: job.patch_id || null }, "coordination_apply_merge");
      const response = await invoke("coordination_apply_merge", {
        ...commandBase,
        mergeJobId: job.id,
      });
      commandData(response);
      setMessage(`Merge applied: ${job.id}`);
      await logUiSurface("manual_merge_apply", "succeeded", { mergeJobId: job.id, patchId: job.patch_id || null }, "coordination_apply_merge");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      await logUiSurface(
        "manual_merge_apply",
        "failed",
        { mergeJobId: job.id, patchId: job.patch_id || null, error: errorMessage(caught) },
        "coordination_apply_merge",
      );
    } finally {
      setMergeActionId("");
    }
  };

  const cloud = snapshot?.cloud_orchestrator || {};
  const sqlPolicy = snapshot?.sql_policy || {};
  const runs = snapshot?.orchestration_runs || [];
  const planItems = snapshot?.orchestration_plan_items || [];
  const patches = snapshot?.patches || [];
  const mcpClientMounts = snapshot?.mcp_client_mounts || {};
  const mcpMountRows = mcpClientMounts.mounts || [];
  const latestBloatAudit = cleanupAudit || snapshot?.bloat_audits?.[0] || null;
  const latestBloatDetails = latestBloatAudit?.details_json || latestBloatAudit || {};
  const bloatEntries = [
    ...(latestBloatAudit?.unexpected_mcp_files || latestBloatDetails.unexpected_mcp_files || []),
    ...(latestBloatAudit?.unexpected_worktree_dirs || latestBloatDetails.unexpected_worktree_dirs || []),
    ...(latestBloatAudit?.stale_temp_files || latestBloatDetails.stale_temp_files || []),
  ];

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
              { key: "write_root", label: "Branch root" },
            ]}
            empty="No sessions."
            rows={snapshot?.sessions || []}
          />
        </Panel>

        <Panel data-tone={["partial", "initialized_only", "server_started_only", "not_seen"].includes(mcpClientMounts.status) ? "warn" : "normal"}>
          <PanelTopline>
            <span>Agent MCP Mount</span>
            <strong>{mcpClientMounts.status || "unknown"}</strong>
          </PanelTopline>
          <PolicyGrid>
            <PolicyItem>
              <span>Active</span>
              <strong>{mcpClientMounts.active_session_count || 0}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Confirmed</span>
              <strong>{mcpClientMounts.confirmed_session_count || 0}</strong>
            </PolicyItem>
          </PolicyGrid>
          <CompactTable
            columns={[
              { key: "slot_key", label: "Slot", render: (row) => row.slot_key || "none" },
              { key: "status", label: "Mount" },
              { key: "latest_event_type", label: "Latest" },
              { key: "successful_tool_calls", label: "Calls" },
            ]}
            empty="No active agent MCP client evidence."
            rows={mcpMountRows}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Agent branches</span>
            <strong>{snapshot?.worktrees?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "branch_name", label: "Branch" },
              { key: "status", label: "Status" },
              { key: "path", label: "Branch root" },
            ]}
            empty="No agent branch roots."
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
              { key: "worktree_id", label: "Branch" },
              { key: "validation_summary", label: "Summary" },
            ]}
            empty="No patch validations."
            rows={snapshot?.patch_validations || []}
          />
        </Panel>

        <Panel>
          <PanelTopline>
            <span>Patches</span>
            <strong>{patches.length}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "status", label: "Status" },
              { key: "validation_status", label: "Validation", render: (row) => row.validation_status || "missing" },
              { key: "task_id", label: "Task" },
              {
                key: "manual_merge",
                label: "Merge",
                render: (row) => (
                  <InlineActionButton
                    disabled={row.status !== "submitted" || row.validation_status !== "passed" || mergeActionId === `queue:${row.id}`}
                    onClick={() => queueMerge(row)}
                    type="button"
                  >
                    {mergeActionId === `queue:${row.id}` ? "Queueing" : "Queue"}
                  </InlineActionButton>
                ),
              },
            ]}
            empty="No submitted patches."
            rows={patches}
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
              {
                key: "manual_apply",
                label: "Apply",
                render: (row) => (
                  <InlineActionButton
                    disabled={!["queued", "checking"].includes(row.status) || mergeActionId === `apply:${row.id}`}
                    onClick={() => applyMerge(row)}
                    type="button"
                  >
                    {mergeActionId === `apply:${row.id}` ? "Applying" : "Apply"}
                  </InlineActionButton>
                ),
              },
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
              <span>Branch roots</span>
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

        <Panel data-tone={latestBloatAudit?.status === "attention_required" ? "warn" : "normal"}>
          <PanelTopline>
            <span>Cleanup Audit</span>
            <strong>{latestBloatAudit?.status || "not run"}</strong>
          </PanelTopline>
          <PolicyGrid>
            <PolicyItem>
              <span>MCP files</span>
              <strong>{latestBloatAudit?.unexpected_mcp_files?.length ?? latestBloatAudit?.unexpected_mcp_file_count ?? 0}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Branch roots</span>
              <strong>{latestBloatAudit?.unexpected_worktree_dirs?.length ?? latestBloatAudit?.unexpected_worktree_dir_count ?? 0}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Temp files</span>
              <strong>{latestBloatAudit?.stale_temp_files?.length ?? latestBloatAudit?.stale_temp_file_count ?? 0}</strong>
            </PolicyItem>
            <PolicyItem>
              <span>Mode</span>
              <strong>dry run</strong>
            </PolicyItem>
          </PolicyGrid>
          <SecondaryButton disabled={!repoPath} onClick={runCleanupAudit} type="button">
            <ButtonDeleteIcon aria-hidden="true" />
            <span>Audit bloat</span>
          </SecondaryButton>
          <CompactTable
            columns={[
              { key: "kind", label: "Kind" },
              { key: "path", label: "Path" },
            ]}
            empty="No bloat candidates recorded."
            rows={bloatEntries}
          />
          <SettingsHint>Audit only. Unknown MCP files and branch roots are never deleted automatically.</SettingsHint>
        </Panel>

        <Panel>
          <PanelTopline>
            <span>UI Surface Logs</span>
            <strong>{snapshot?.ui_surface_logs?.length || 0}</strong>
          </PanelTopline>
          <CompactTable
            columns={[
              { key: "surface", label: "Surface" },
              { key: "action", label: "Action" },
              { key: "status", label: "Status" },
              { key: "command_name", label: "Command", render: (row) => row.command_name || "none" },
            ]}
            empty="No UI surface logs yet."
            rows={snapshot?.ui_surface_logs || []}
          />
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
              {sqlResult.classification} - risk {sqlResult.risk_level} - {sqlResult.blocked_by_default ? "blocked by default" : "allowed by policy"}
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

const InlineActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(127, 177, 255, 0.34);
  border-radius: 6px;
  color: #dfeaff;
  background: rgba(47, 128, 255, 0.12);
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0;
  cursor: pointer;

  &:disabled {
    border-color: rgba(148, 163, 184, 0.14);
    color: #667386;
    background: rgba(255, 255, 255, 0.03);
    cursor: not-allowed;
  }
`;
