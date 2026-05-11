import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import {
  ButtonCheckIcon,
  ButtonHubIcon,
  ButtonRefreshIcon,
  ButtonTerminalIcon,
  FormMessage,
  PanelHeading,
  PanelKicker,
  SecondaryButton,
  SettingsHint,
  VaultWorkspaceSurface,
} from "../app/appStyles";

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
  return "Vault coordination check failed.";
}

function valueText(value, fallback = "none") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function shortId(value) {
  const text = valueText(value, "");
  if (text.length <= 12) {
    return text || "none";
  }
  return `${text.slice(0, 8)}...`;
}

function worstStatus(statuses) {
  if (statuses.includes("violation")) {
    return "violation";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  if (statuses.includes("aligned")) {
    return "aligned";
  }
  return "idle";
}

function checksByName(checks, name) {
  return checks.filter((check) => check.check === name);
}

function statusFor(checks, name) {
  return worstStatus(checksByName(checks, name).map((check) => check.status));
}

function sortChecks(checks) {
  const weight = { violation: 0, warning: 1, aligned: 2 };
  return [...checks].sort((left, right) => {
    const leftWeight = weight[left.status] ?? 3;
    const rightWeight = weight[right.status] ?? 3;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
    return valueText(left.check, "").localeCompare(valueText(right.check, ""));
  });
}

function CompactRows({ empty, rows }) {
  if (!rows?.length) {
    return <EmptyLine>{empty}</EmptyLine>;
  }

  return (
    <RowList>
      {rows.map((row, index) => (
        <ReasonRow key={`${row.check || "row"}-${row.created_at || index}`} data-state={row.status || "idle"}>
          <ReasonMain>
            <strong>{row.check || "check"}</strong>
            <span>{row.reason || "No reason recorded."}</span>
          </ReasonMain>
          <ReasonStatus data-state={row.status || "idle"}>{row.status || "idle"}</ReasonStatus>
        </ReasonRow>
      ))}
    </RowList>
  );
}

function EventRows({ rows }) {
  if (!rows?.length) {
    return <EmptyLine>No events yet.</EmptyLine>;
  }

  return (
    <EventList>
      {rows.slice(0, 18).map((event) => (
        <EventRow key={event.id || event.seq}>
          <span>#{event.seq}</span>
          <strong>{event.event_type}</strong>
          <em>{event.actor_type}</em>
        </EventRow>
      ))}
    </EventList>
  );
}

export default function VaultWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  workspace,
}) {
  const repoPath = rootDirectory || defaultWorkingDirectory || "";
  const workspaceName = workspace?.name || "Workspace";
  const [snapshot, setSnapshot] = useState(null);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const commandBase = useMemo(() => ({ repoPath }), [repoPath]);

  const refresh = useCallback(async ({ scan = false } = {}) => {
    if (!repoPath) {
      return;
    }

    setStatus(scan ? "scanning" : "loading");
    setError("");
    setMessage("");
    try {
      await invoke("coordination_init", commandBase);
      if (scan) {
        await invoke("coordination_scan_workspace_violations", commandBase);
      }
      const [snapshotResponse, reportResponse] = await Promise.all([
        invoke("coordination_get_snapshot", commandBase),
        invoke("coordination_get_alignment_report", commandBase),
      ]);
      setSnapshot(unwrapData(snapshotResponse));
      setReport(unwrapData(reportResponse));
      setStatus("ready");
      setMessage(scan ? "Workspace scanned and alignment reasons logged." : "");
    } catch (caught) {
      setStatus("error");
      setError(errorMessage(caught));
    }
  }, [commandBase, repoPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const checks = report?.checks || [];
  const sortedChecks = sortChecks(checks);
  const summary = report?.summary || {};
  const policy = report?.policy || snapshot?.repo_policy || {};
  const sessions = report?.sessions || snapshot?.sessions || [];
  const worktrees = report?.worktrees || snapshot?.worktrees || [];
  const violations = report?.open_workspace_violations || snapshot?.open_workspace_violations || [];
  const patches = report?.patches || snapshot?.patches || [];
  const mergeJobs = report?.merge_jobs || snapshot?.merge_jobs || [];
  const leases = snapshot?.active_leases || [];
  const events = report?.events || snapshot?.events || [];
  const log = summary.log || {};

  const flow = [
    {
      label: "Launch",
      detail: `${sessions.length} sessions`,
      status: sessions.length ? statusFor(checks, "session.worktree_isolation") : "idle",
    },
    {
      label: "MCP",
      detail: "auto config",
      status: sessions.length ? statusFor(checks, "session.mcp_auto_activation") : "idle",
    },
    {
      label: "Leases",
      detail: `${leases.length} active`,
      status: violations.length ? statusFor(checks, "violations.open_blockers") : "aligned",
    },
    {
      label: "Patch gate",
      detail: `${patches.length} patches`,
      status: patches.length ? statusFor(checks, "patch.validation_authority") : "idle",
    },
    {
      label: "Merge gate",
      detail: `${mergeJobs.length} jobs`,
      status: mergeJobs.length ? statusFor(checks, "merge.gate_authority") : "idle",
    },
    {
      label: "Context",
      detail: "context pack",
      status: "aligned",
    },
  ];

  const mcpChecks = checksByName(checks, "session.mcp_auto_activation");
  const blockerChecks = sortedChecks.filter((check) => check.status !== "aligned").slice(0, 12);
  const policyChecks = sortedChecks.filter((check) => check.check?.startsWith("policy."));

  return (
    <VaultWorkspaceSurface aria-label="Vault coordination debugger" data-layout="operational">
      <VaultShell>
        <VaultHeader>
          <HeaderTitle>
            <HeaderIcon aria-hidden="true">
              <ButtonHubIcon />
            </HeaderIcon>
            <div>
              <PanelKicker>Vault debugger</PanelKicker>
              <PanelHeading>{workspaceName} coordination alignment</PanelHeading>
              <SettingsHint>{repoPath || "No workspace root selected"}</SettingsHint>
            </div>
          </HeaderTitle>
          <HeaderActions>
            <OverallPill data-state={summary.status || "idle"}>{summary.status || "idle"}</OverallPill>
            <SecondaryButton disabled={!repoPath || status === "loading"} onClick={() => refresh()} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>{status === "loading" ? "Refreshing" : "Refresh"}</span>
            </SecondaryButton>
            <SecondaryButton disabled={!repoPath || status === "scanning"} onClick={() => refresh({ scan: true })} type="button">
              <ButtonCheckIcon aria-hidden="true" />
              <span>{status === "scanning" ? "Scanning" : "Scan + log"}</span>
            </SecondaryButton>
          </HeaderActions>
        </VaultHeader>

        {error && <FormMessage $state="error">{error}</FormMessage>}
        {message && <InlineMessage>{message}</InlineMessage>}

        <SummaryStrip>
          <SummaryItem data-state="aligned">
            <span>Aligned</span>
            <strong>{summary.aligned || 0}</strong>
          </SummaryItem>
          <SummaryItem data-state="warning">
            <span>Warnings</span>
            <strong>{summary.warnings || 0}</strong>
          </SummaryItem>
          <SummaryItem data-state="violation">
            <span>Violations</span>
            <strong>{summary.violations || 0}</strong>
          </SummaryItem>
          <SummaryItem>
            <span>Log switch</span>
            <strong>{log.enabled ? "on" : "off"}</strong>
          </SummaryItem>
          <SummaryItem>
            <span>Context</span>
            <strong>pack</strong>
          </SummaryItem>
        </SummaryStrip>

        <FlowPanel>
          {flow.map((node, index) => (
            <FlowNode key={node.label} data-state={node.status}>
              <FlowNumber>{index + 1}</FlowNumber>
              <div>
                <strong>{node.label}</strong>
                <span>{node.detail}</span>
              </div>
            </FlowNode>
          ))}
        </FlowPanel>

        <VaultGrid>
          <Panel data-span="2">
            <PanelTopline>
              <span>Alignment reasons</span>
              <strong>{checks.length}</strong>
            </PanelTopline>
            <CompactRows empty="No alignment checks have been generated yet." rows={blockerChecks.length ? blockerChecks : sortedChecks.slice(0, 12)} />
          </Panel>

          <Panel>
            <PanelTopline>
              <span>Local alignment log</span>
              <strong>{log.enabled ? "enabled" : "off"}</strong>
            </PanelTopline>
            <LogBox>
              <span>Boolean</span>
              <strong>COORDINATION_ALIGNMENT_LOGGING_ENABLED</strong>
              <span>Path</span>
              <code>{log.path || "logs/coordination-alignment.jsonl"}</code>
              <span>Format</span>
              <strong>{log.format || "jsonl"}</strong>
            </LogBox>
            <SettingsHint>{log.redaction || "Logs contain kernel metadata only."}</SettingsHint>
          </Panel>

          <Panel>
            <PanelTopline>
              <span>Authority objects</span>
              <strong>SQLite</strong>
            </PanelTopline>
            <MetricGrid>
              <Metric><span>Sessions</span><strong>{sessions.length}</strong></Metric>
              <Metric><span>Agent branches</span><strong>{worktrees.length}</strong></Metric>
              <Metric><span>Leases</span><strong>{leases.length}</strong></Metric>
              <Metric><span>Violations</span><strong>{violations.length}</strong></Metric>
              <Metric><span>Patches</span><strong>{patches.length}</strong></Metric>
              <Metric><span>Merges</span><strong>{mergeJobs.length}</strong></Metric>
            </MetricGrid>
          </Panel>

          <Panel>
            <PanelTopline>
              <span>Policy posture</span>
              <strong>{policy.unleased_write_policy || "reject_patch"}</strong>
            </PanelTopline>
            <PolicyRows>
              <li><span>Branch roots</span><strong>{policy.agent_worktree_required ? "required" : "off"}</strong></li>
              <li><span>Patch leases</span><strong>{policy.patch_lease_validation_required ? "required" : "off"}</strong></li>
              <li><span>Merge gate</span><strong>{policy.merge_gate_required ? "required" : "off"}</strong></li>
              <li><span>SQL</span><strong>{policy.sql_mcp_default || "off"}</strong></li>
            </PolicyRows>
            <CompactRows empty="Policy checks have not run yet." rows={policyChecks.slice(0, 5)} />
          </Panel>

          <Panel>
            <PanelTopline>
              <span>MCP activation</span>
              <strong>{mcpChecks.length}</strong>
            </PanelTopline>
            {mcpChecks.length ? (
              <McpList>
                {mcpChecks.map((check, index) => (
                  <McpRow key={`${check.details?.session_id || "session"}-${index}`} data-state={check.status}>
                    <strong>{shortId(check.details?.session_id)}</strong>
                    <span>{check.reason}</span>
                    <em>{check.details?.missing_paths?.length ? `${check.details.missing_paths.length} missing` : "ready"}</em>
                  </McpRow>
                ))}
              </McpList>
            ) : (
              <EmptyLine>No active agent branch sessions to activate.</EmptyLine>
            )}
          </Panel>

          <Panel>
            <PanelTopline>
              <span>Workspace violations</span>
              <strong>{violations.length}</strong>
            </PanelTopline>
            {violations.length ? (
              <McpList>
                {violations.slice(0, 10).map((violation) => (
                  <McpRow key={violation.id} data-state={violation.severity === "error" || violation.severity === "critical" ? "violation" : "warning"}>
                    <strong>{violation.violation_kind}</strong>
                    <span>{violation.path || violation.resource_key || "workspace"}</span>
                    <em>{violation.severity}</em>
                  </McpRow>
                ))}
              </McpList>
            ) : (
              <EmptyLine>No open violations.</EmptyLine>
            )}
          </Panel>

          <Panel>
            <PanelTopline>
              <span>Patch and merge gate</span>
              <strong>{patches.length + mergeJobs.length}</strong>
            </PanelTopline>
            <GateStack>
              <GateLine>
                <span>Patch validations</span>
                <strong>{snapshot?.patch_validations?.length || 0}</strong>
              </GateLine>
              <GateLine>
                <span>Submitted patches</span>
                <strong>{patches.filter((patch) => patch.status === "submitted").length}</strong>
              </GateLine>
              <GateLine>
                <span>Blocked merges</span>
                <strong>{mergeJobs.filter((job) => job.status === "blocked" || job.status === "failed").length}</strong>
              </GateLine>
              <GateLine>
                <span>Successful merges</span>
                <strong>{mergeJobs.filter((job) => job.status === "succeeded").length}</strong>
              </GateLine>
            </GateStack>
            <SettingsHint>Failed patch validations cannot enter the merge/apply path.</SettingsHint>
          </Panel>

          <Panel>
            <PanelTopline>
              <span>Context boundary</span>
              <strong>metadata-only</strong>
            </PanelTopline>
            <CloudLine>
              <ButtonTerminalIcon aria-hidden="true" />
              <span>Cloud MCP stores context-pack metadata; the local kernel remains execution authority.</span>
            </CloudLine>
            <PolicyRows>
              <li><span>Code export</span><strong>blocked</strong></li>
              <li><span>Log export</span><strong>blocked</strong></li>
              <li><span>Patch export</span><strong>blocked</strong></li>
              <li><span>Auto merge</span><strong>blocked</strong></li>
            </PolicyRows>
          </Panel>

          <Panel data-span="2">
            <PanelTopline>
              <span>Recent kernel events</span>
              <strong>{events.length}</strong>
            </PanelTopline>
            <EventRows rows={events} />
          </Panel>
        </VaultGrid>
      </VaultShell>
    </VaultWorkspaceSurface>
  );
}

const VaultShell = styled.section`
  display: grid;
  grid-template-rows: auto auto auto minmax(0, auto) minmax(0, 1fr);
  gap: 10px;
  width: 100%;
  min-width: 0;
  min-height: 0;
  color: #dfe7f4;
`;

const VaultHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.84);
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

const OverallPill = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  color: #9ca9ba;
  font-size: 12px;
  font-weight: 900;

  &[data-state="aligned"] {
    border-color: rgba(88, 214, 141, 0.34);
    color: #9ff0ba;
  }

  &[data-state="warning"] {
    border-color: rgba(255, 190, 90, 0.42);
    color: #ffd497;
  }

  &[data-state="violation"] {
    border-color: rgba(255, 107, 107, 0.42);
    color: #ffb5b5;
  }
`;

const SummaryStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  gap: 8px;
  min-width: 0;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const SummaryItem = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(7, 11, 16, 0.8);

  span {
    color: #8290a3;
    font-size: 11px;
    font-weight: 850;
  }

  strong {
    color: #eef4ff;
    font-size: 15px;
    font-weight: 900;
  }

  &[data-state="aligned"] strong {
    color: #9ff0ba;
  }

  &[data-state="warning"] strong {
    color: #ffd497;
  }

  &[data-state="violation"] strong {
    color: #ffb5b5;
  }
`;

const FlowPanel = styled.section`
  display: grid;
  grid-template-columns: repeat(6, minmax(110px, 1fr));
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(7, 10, 15, 0.76);

  @media (max-width: 1100px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (max-width: 680px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const FlowNode = styled.div`
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);

  strong,
  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f2f7ff;
    font-size: 12px;
    font-weight: 900;
  }

  span {
    color: #8793a6;
    font-size: 11px;
    font-weight: 760;
  }

  &[data-state="aligned"] {
    border-color: rgba(88, 214, 141, 0.28);
  }

  &[data-state="warning"] {
    border-color: rgba(255, 190, 90, 0.34);
  }

  &[data-state="violation"] {
    border-color: rgba(255, 107, 107, 0.4);
  }
`;

const FlowNumber = styled.span`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid rgba(127, 177, 255, 0.28);
  border-radius: 7px;
  color: #9fc5ff;
  font-size: 11px;
  font-weight: 900;
  background: rgba(47, 128, 255, 0.08);
`;

const VaultGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(3, minmax(250px, 1fr));
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;

  @media (max-width: 1160px) {
    grid-template-columns: repeat(2, minmax(250px, 1fr));
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
  min-height: 160px;
  max-height: 440px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(9, 13, 19, 0.84);

  &[data-span="2"] {
    grid-column: span 2;
  }

  @media (max-width: 760px) {
    &[data-span="2"] {
      grid-column: span 1;
    }
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

const RowList = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  overflow: auto;
`;

const ReasonRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  min-width: 0;
  padding: 7px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.025);

  &[data-state="warning"] {
    border-color: rgba(255, 190, 90, 0.28);
  }

  &[data-state="violation"] {
    border-color: rgba(255, 107, 107, 0.34);
  }
`;

const ReasonMain = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    min-width: 0;
    overflow: hidden;
    color: #eef4ff;
    font-size: 12px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: #98a5b8;
    font-size: 12px;
    font-weight: 720;
    line-height: 1.35;
  }
`;

const ReasonStatus = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  color: #9ca9ba;
  font-size: 11px;
  font-weight: 900;

  &[data-state="aligned"] {
    color: #9ff0ba;
  }

  &[data-state="warning"] {
    color: #ffd497;
  }

  &[data-state="violation"] {
    color: #ffb5b5;
  }
`;

const EmptyLine = styled.p`
  margin: 0;
  color: #778397;
  font-size: 12px;
  font-weight: 760;
`;

const InlineMessage = styled.p`
  margin: 0;
  color: #9fd0ff;
  font-size: 12px;
  font-weight: 800;
`;

const LogBox = styled.div`
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 8px;
  min-width: 0;
  font-size: 12px;

  span {
    color: #7d899c;
    font-weight: 850;
  }

  strong,
  code {
    min-width: 0;
    overflow: hidden;
    color: #edf4ff;
    font-family: inherit;
    font-weight: 850;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const MetricGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
`;

const Metric = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.025);

  span {
    color: #8290a3;
    font-size: 11px;
    font-weight: 850;
  }

  strong {
    color: #f1f6ff;
    font-size: 16px;
    font-weight: 950;
  }
`;

const PolicyRows = styled.ul`
  display: grid;
  gap: 5px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    min-width: 0;
    color: #dce7f6;
    font-size: 12px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    color: #8491a4;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #eef4ff;
    font-weight: 900;
  }
`;

const McpList = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  overflow: auto;
`;

const McpRow = styled.div`
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 7px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 7px;

  strong,
  span,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #eef4ff;
    font-size: 12px;
    font-weight: 900;
  }

  span {
    color: #96a3b6;
    font-size: 12px;
    font-weight: 720;
  }

  em {
    color: #8fb7ff;
    font-size: 11px;
    font-style: normal;
    font-weight: 900;
  }

  &[data-state="warning"] {
    border-color: rgba(255, 190, 90, 0.3);
  }

  &[data-state="violation"] {
    border-color: rgba(255, 107, 107, 0.34);
  }
`;

const GateStack = styled.div`
  display: grid;
  gap: 6px;
`;

const GateLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #dce7f6;
  font-size: 12px;
  font-weight: 800;

  span {
    color: #8793a6;
  }

  strong {
    color: #f1f6ff;
  }
`;

const CloudLine = styled.div`
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

const EventList = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
  overflow: auto;
`;

const EventRow = styled.div`
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 70px;
  gap: 8px;
  min-width: 0;
  padding: 6px 7px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.09);
  color: #dce7f6;
  font-size: 12px;

  span,
  strong,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span,
  em {
    color: #8491a4;
    font-style: normal;
    font-weight: 780;
  }

  strong {
    font-weight: 900;
  }
`;
