import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styled from "styled-components";

import {
  ButtonForgeIcon,
  DashboardTitle,
  ForgeWorkspace,
  FormMessage,
  Kicker,
  PageSubline,
  PrimaryButton,
  ResizeHandle,
  ResizePanel,
  ResizePanelGroup,
  SettingsLabel,
  SetupField,
  SetupHeader,
  SetupInput,
  WorkspaceSetupPanel,
  WorkspaceTerminalPanels,
} from "../app/appStyles";
import WorkspaceTerminal, {
  getTerminalPaneMinSizePercent,
  getWorkspaceTerminalPaneId,
} from "./WorkspaceTerminal.jsx";

const TerminalWorkspaceWithCloudDock = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const TerminalWorkspaceMain = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;

const CloudMcpDockShell = styled.aside`
  width: min(320px, 28vw);
  min-width: 240px;
  max-width: 360px;
  height: 100%;
  min-height: 0;
  border-left: 1px solid rgba(148, 163, 184, 0.22);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(2, 6, 23, 0.96)),
    radial-gradient(circle at top left, rgba(34, 197, 94, 0.18), transparent 34%);
  color: #dbeafe;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  @media (max-width: 1120px) {
    display: none;
  }
`;

const CloudMcpDockHeader = styled.div`
  padding: 14px 14px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
`;

const CloudMcpDockTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const CloudMcpDockTitle = styled.div`
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
`;

const CloudMcpStatusPill = styled.span`
  border: 1px solid ${({ $state }) => (
    $state === "connected" ? "rgba(34, 197, 94, 0.45)" : "rgba(248, 113, 113, 0.42)"
  )};
  border-radius: 999px;
  color: ${({ $state }) => ($state === "connected" ? "#bbf7d0" : "#fecaca")};
  background: ${({ $state }) => (
    $state === "connected" ? "rgba(22, 163, 74, 0.16)" : "rgba(185, 28, 28, 0.16)"
  )};
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  padding: 5px 7px;
  text-transform: uppercase;
`;

const CloudMcpDockMeta = styled.div`
  margin-top: 8px;
  color: rgba(219, 234, 254, 0.68);
  font-size: 11px;
  line-height: 1.35;
`;

const CloudMcpActivityList = styled.div`
  min-height: 0;
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CloudMcpActivityRow = styled.div`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.58);
  padding: 9px;
`;

const CloudMcpActivityIcon = styled.div`
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  color: ${({ $state }) => {
    if ($state === "error") return "#fecaca";
    if ($state === "loading") return "#bfdbfe";
    return "#bbf7d0";
  }};
  background: ${({ $state }) => {
    if ($state === "error") return "rgba(220, 38, 38, 0.2)";
    if ($state === "loading") return "rgba(59, 130, 246, 0.2)";
    return "rgba(34, 197, 94, 0.18)";
  }};
  border: 1px solid ${({ $state }) => {
    if ($state === "error") return "rgba(248, 113, 113, 0.34)";
    if ($state === "loading") return "rgba(96, 165, 250, 0.34)";
    return "rgba(74, 222, 128, 0.34)";
  }};

  ${({ $state }) => $state === "loading" ? `
    &::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      border: 2px solid rgba(191, 219, 254, 0.35);
      border-top-color: #bfdbfe;
      animation: cloud-mcp-spin 0.8s linear infinite;
    }
  ` : ""}

  @keyframes cloud-mcp-spin {
    to { transform: rotate(360deg); }
  }
`;

const CloudMcpActivityText = styled.div`
  min-width: 0;
`;

const CloudMcpActivityHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
`;

const CloudMcpActivityName = styled.div`
  color: #eff6ff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CloudMcpActorBadge = styled.span`
  flex: 0 0 auto;
  border: 1px solid ${({ $color }) => $color || "rgba(148, 163, 184, 0.3)"};
  border-radius: 999px;
  background: ${({ $color }) => ($color ? `${$color}24` : "rgba(148, 163, 184, 0.16)")};
  color: ${({ $color }) => $color || "#dbeafe"};
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
  max-width: 96px;
  overflow: hidden;
  padding: 4px 6px;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const CloudMcpActivityDetail = styled.div`
  margin-top: 3px;
  color: rgba(219, 234, 254, 0.62);
  font-size: 10px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CloudMcpEmptyState = styled.div`
  margin: 12px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  border-radius: 16px;
  color: rgba(219, 234, 254, 0.64);
  font-size: 12px;
  line-height: 1.45;
  padding: 14px;
`;

function cloudMcpActivityState(entry) {
  const phase = String(entry?.phase || entry?.kind || entry?.event || entry?.status || "").toLowerCase();
  if (phase.includes("error") || phase.includes("failed") || phase.includes("failure")) return "error";
  if (
    phase === "start"
    || phase.endsWith(".start")
    || phase.endsWith("_start")
    || phase.includes("processing")
    || phase.includes("pending")
  ) {
    return "loading";
  }
  return "done";
}

function cloudMcpActivityTool(entry) {
  return cloudMcpEntryField(entry, "activity", "label", "action")
    || entry?.tool
    || entry?.fields?.tool
    || entry?.payload?.tool
    || entry?.event_kind
    || entry?.phase
    || "Cloud MCP call";
}

function cloudMcpEntryField(entry, ...keys) {
  for (const key of keys) {
    const direct = entry?.[key];
    if (direct) return direct;
    const fieldValue = entry?.fields?.[key];
    if (fieldValue) return fieldValue;
    const payloadValue = entry?.payload?.[key];
    if (payloadValue) return payloadValue;
  }
  return "";
}

function cloudMcpThreeId(value) {
  const text = String(value || "").trim();
  if (!text) return "agt";
  if (text.toLowerCase().startsWith("workspace-terminal-")) return "agt";
  return text
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 3)
    || "agt";
}

function cloudMcpPaneLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/workspace-terminal-.+-(\d+)-([a-z0-9_-]+)$/i);
  if (!match) return "";
  const provider = String(match[2] || "").toLowerCase();
  if (provider.includes("generic") || provider.includes("shell")) return "sh";
  return "";
}

function cloudMcpAgentColor(value) {
  const palette = [
    "#38bdf8",
    "#34d399",
    "#fbbf24",
    "#fb7185",
    "#a78bfa",
    "#2dd4bf",
    "#f97316",
    "#c084fc",
  ];
  const text = String(value || "agent");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

function cloudMcpActivitySource(entry) {
  const phase = String(entry?.phase || "").toLowerCase();
  const clientId = String(cloudMcpEntryField(entry, "clientId", "client_id")).toLowerCase();
  const agentId = cloudMcpEntryField(entry, "agentId", "agent_id", "actor");
  const agentLabel = cloudMcpEntryField(entry, "agentLabel", "agent_label");
  const paneId = cloudMcpEntryField(entry, "paneId", "pane_id", "terminal_id", "terminalId");
  const paneLabel = cloudMcpPaneLabel(paneId);
  const viaAgentProxy = phase.startsWith("cloud_mcp.tool_call") || clientId.includes("agent");

  if (agentId || agentLabel) {
    const identity = agentId || agentLabel;
    return {
      color: cloudMcpAgentColor(identity),
      label: agentLabel || cloudMcpThreeId(identity),
    };
  }

  if (viaAgentProxy) {
    const identity = clientId || paneId || "agent";
    return {
      color: cloudMcpAgentColor(identity),
      label: paneLabel || "agt",
    };
  }

  return {
    color: "#67e8f9",
    label: "rust",
  };
}

function cloudMcpIsAgentProxyEvent(entry) {
  const phase = String(entry?.phase || "").toLowerCase();
  const clientId = String(cloudMcpEntryField(entry, "clientId", "client_id")).toLowerCase();
  return phase.startsWith("cloud_mcp.tool_call") || clientId.includes("agent");
}

function inferCloudMcpPaneActivity(entries) {
  const chronological = [...entries].reverse();
  const enriched = [];
  let lastPaneId = "";
  let lastAgentId = "";

  for (const entry of chronological) {
    const paneId = cloudMcpEntryField(entry, "paneId", "pane_id", "terminal_id", "terminalId");
    const agentId = cloudMcpEntryField(entry, "agentId", "agent_id", "actor");
    if (paneId) {
      lastPaneId = paneId;
      if (agentId) lastAgentId = agentId;
      enriched.push(entry);
      continue;
    }

    if (cloudMcpIsAgentProxyEvent(entry) && lastPaneId) {
      enriched.push({
        ...entry,
        paneId: lastPaneId,
        inferredAgentId: agentId || lastAgentId,
      });
      continue;
    }

    enriched.push(entry);
  }

  return enriched.reverse();
}

function cloudMcpActivityDetail(entry) {
  const phase = entry?.phase || entry?.kind || entry?.event || entry?.status || "completed";
  const paneLabel = cloudMcpPaneLabel(cloudMcpEntryField(entry, "paneId", "pane_id", "terminal_id", "terminalId"));
  const agentLabel = cloudMcpEntryField(entry, "agentLabel", "agent_label");
  const rawAgent = cloudMcpEntryField(entry, "inferredAgentId", "agentId", "agent_id", "actor");
  const agent = agentLabel || (rawAgent ? cloudMcpThreeId(rawAgent) : "");
  const workspace = cloudMcpEntryField(entry, "workspaceName", "workspace_name");
  const detail = cloudMcpEntryField(entry, "detail", "brief", "title", "summary");
  if (detail) {
    return [detail, paneLabel || agent, workspace].filter(Boolean).join(" / ");
  }
  return [phase, paneLabel || agent, workspace].filter(Boolean).join(" / ");
}

function cloudMcpActivityKey(entry) {
  return [
    cloudMcpActivityTool(entry),
    cloudMcpEntryField(entry, "endpoint") || "",
    cloudMcpEntryField(entry, "paneId", "pane_id", "terminal_id", "terminalId")
      || cloudMcpEntryField(entry, "inferredAgentId", "agentId", "agent_id", "actor")
      || "",
  ].join("|");
}

function compactCloudMcpActivity(entries) {
  const completed = new Set();
  return entries.filter((entry) => {
    const key = cloudMcpActivityKey(entry);
    const state = cloudMcpActivityState(entry);
    if (state === "loading" && completed.has(key)) return false;
    if (state !== "loading") completed.add(key);
    return true;
  });
}

function cloudMcpStatusSignature(status) {
  return [
    status?.connected ? "connected" : "disconnected",
    status?.base_url || status?.baseUrl || "",
    status?.last_error || status?.lastError || "",
  ].join("|");
}

function cloudMcpActivitySignature(entries) {
  return entries.map((entry, index) => [
    entry?.ts_ms || entry?.timestamp || index,
    entry?.phase || entry?.kind || entry?.event || entry?.status || "",
    cloudMcpActivityTool(entry),
    cloudMcpActivityDetail(entry),
  ].join(":")).join("|");
}

function cloudMcpActivityRowKey(entry, index) {
  return [
    entry?.ts_ms || entry?.timestamp || `fallback-${index}`,
    entry?.phase || entry?.kind || entry?.event || entry?.status || "",
    cloudMcpActivityTool(entry),
    cloudMcpEntryField(entry, "endpoint") || "",
    cloudMcpEntryField(entry, "paneId", "pane_id", "terminal_id", "terminalId")
      || cloudMcpEntryField(entry, "inferredAgentId", "agentId", "agent_id", "actor")
      || "",
  ].join("|");
}

function cloudMcpStatusLabel(status, error) {
  if (error) return "Offline";
  if (status?.connected) return "Connected";
  return "Disconnected";
}

function CloudMcpTerminalDock({ workingDirectory }) {
  const [status, setStatus] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const statusSignatureRef = useRef("");
  const activitySignatureRef = useRef("");
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;

    try {
      const [nextStatus, nextActivity] = await Promise.all([
        invoke("cloud_mcp_get_status"),
        workingDirectory
          ? invoke("cloud_mcp_get_activity", { repoPath: workingDirectory })
          : Promise.resolve({ entries: [] }),
      ]);
      const nextEntries = Array.isArray(nextActivity?.entries) ? nextActivity.entries : [];
      const nextStatusSignature = cloudMcpStatusSignature(nextStatus);
      const nextActivitySignature = cloudMcpActivitySignature(nextEntries);

      if (nextStatusSignature !== statusSignatureRef.current) {
        statusSignatureRef.current = nextStatusSignature;
        setStatus(nextStatus);
      }

      if (nextActivitySignature !== activitySignatureRef.current) {
        activitySignatureRef.current = nextActivitySignature;
        setActivity(nextEntries);
      }

      setError((currentError) => (currentError ? "" : currentError));
    } catch (nextError) {
      const nextMessage = nextError?.message || String(nextError);
      setError((currentError) => (currentError === nextMessage ? currentError : nextMessage));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [workingDirectory]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1800);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connected = Boolean(status?.connected) && !error;
  const visibleActivity = compactCloudMcpActivity(inferCloudMcpPaneActivity(activity)).slice(0, 12);

  return (
    <CloudMcpDockShell aria-label="Cloud MCP status and activity">
      <CloudMcpDockHeader>
        <CloudMcpDockTitleRow>
          <CloudMcpDockTitle>Cloud MCP</CloudMcpDockTitle>
          <CloudMcpStatusPill $state={connected ? "connected" : "offline"}>
            {cloudMcpStatusLabel(status, error)}
          </CloudMcpStatusPill>
        </CloudMcpDockTitleRow>
        <CloudMcpDockMeta>
          Context pack and coordination calls appear here.
          {error ? ` ${error}` : ""}
        </CloudMcpDockMeta>
      </CloudMcpDockHeader>
      {visibleActivity.length ? (
        <CloudMcpActivityList>
          {visibleActivity.map((entry, index) => {
            const state = cloudMcpActivityState(entry);
            const source = cloudMcpActivitySource(entry);
            return (
              <CloudMcpActivityRow key={cloudMcpActivityRowKey(entry, index)}>
                <CloudMcpActivityIcon $state={state}>
                  {state === "loading" ? "" : state === "error" ? "!" : "OK"}
                </CloudMcpActivityIcon>
                <CloudMcpActivityText>
                  <CloudMcpActivityHeader>
                    <CloudMcpActorBadge $color={source.color}>{source.label}</CloudMcpActorBadge>
                    <CloudMcpActivityName>{cloudMcpActivityTool(entry)}</CloudMcpActivityName>
                  </CloudMcpActivityHeader>
                  <CloudMcpActivityDetail>{cloudMcpActivityDetail(entry)}</CloudMcpActivityDetail>
                </CloudMcpActivityText>
              </CloudMcpActivityRow>
            );
          })}
        </CloudMcpActivityList>
      ) : (
        <CloudMcpEmptyState>
          No Cloud MCP calls recorded yet. When an agent asks for context or posts a checkpoint, this panel will tick through it.
        </CloudMcpEmptyState>
      )}
    </CloudMcpDockShell>
  );
}

function TerminalView({
  terminalWorkspace,
  terminalAgentsByIndex = {},
  terminalRolesByIndex = {},
  terminalWorkspaceWorkingDirectory,
  terminalWorkspaceTerminalIndexes,
  terminalWorkspaceVisibleTerminalCount,
  agentStatusError,
  agentStatuses,
  agentStatusState,
  changeWorkspaceTerminalRole,
  closeWorkspaceTerminal,
  createFirstWorkspace,
  handlePreparedTerminalChange,
  refreshAgentStatuses,
  setWorkspaceName,
  shouldPrewarmWorkspaceTerminals,
  shouldShowWorkspaceSetup,
  showSettingsView,
  terminalPanelRows,
  viewMotion,
  workspaceAgentLaunchEpoch,
  workspaceError,
  workspaceName,
  workspaceSyncState,
  workspaceTerminalAgentLaunchReady,
  workspaceTerminalRenderAgent,
}) {
  const hasWorkspaceTerminals = Boolean(terminalWorkspace);
  const hasVisibleWorkspaceTerminalPanes = hasWorkspaceTerminals && terminalPanelRows.length > 0;
  const [activeTerminalPaneId, setActiveTerminalPaneId] = useState("");
  const getTerminalAgent = useCallback((terminalIndex) => (
    Object.prototype.hasOwnProperty.call(terminalAgentsByIndex, terminalIndex)
      ? terminalAgentsByIndex[terminalIndex]
      : workspaceTerminalRenderAgent
  ), [terminalAgentsByIndex, workspaceTerminalRenderAgent]);
  const getTerminalRole = useCallback((terminalIndex) => (
    terminalRolesByIndex[terminalIndex] || getTerminalAgent(terminalIndex)?.id || ""
  ), [getTerminalAgent, terminalRolesByIndex]);
  const getTerminalPaneId = useCallback((terminalIndex) => {
    const role = getTerminalRole(terminalIndex);
    const agent = getTerminalAgent(terminalIndex);
    const paneAgentId = String(role || "").toLowerCase() === "generic"
      ? "generic"
      : agent?.id;

    return getWorkspaceTerminalPaneId(terminalWorkspace?.id, terminalIndex, paneAgentId);
  }, [getTerminalAgent, getTerminalRole, terminalWorkspace?.id]);
  const visibleTerminalPaneIds = useMemo(() => (
    terminalWorkspace
      ? terminalWorkspaceTerminalIndexes.map((terminalIndex) => getTerminalPaneId(terminalIndex))
      : []
  ), [getTerminalPaneId, terminalWorkspace, terminalWorkspaceTerminalIndexes]);
  const visibleTerminalPaneIdSignature = visibleTerminalPaneIds.join("|");
  const activePaneId = activeTerminalPaneId || visibleTerminalPaneIds[0] || "";

  useEffect(() => {
    setActiveTerminalPaneId((currentPaneId) => (
      currentPaneId && visibleTerminalPaneIds.includes(currentPaneId)
        ? currentPaneId
        : visibleTerminalPaneIds[0] || ""
    ));
  }, [visibleTerminalPaneIdSignature]);

  const handleActivateTerminalPane = useCallback(({ paneId }) => {
    if (paneId) {
      setActiveTerminalPaneId(paneId);
    }
  }, []);

  return (
    <ForgeWorkspace aria-label="Forge workspace" data-motion={viewMotion}>
      {shouldShowWorkspaceSetup ? (
        <WorkspaceSetupPanel onSubmit={createFirstWorkspace}>
          <SetupHeader>
            <Kicker>First workspace</Kicker>
            <DashboardTitle>Create your workspace</DashboardTitle>
            <PageSubline>Name it, then the workspace syncs through the protected API.</PageSubline>
          </SetupHeader>
          {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
          <SetupField>
            <SettingsLabel>Workspace name</SettingsLabel>
            <SetupInput
              maxLength={80}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="My workspace"
              value={workspaceName}
            />
          </SetupField>
          <PrimaryButton disabled={workspaceSyncState === "creating"} type="submit">
            <ButtonForgeIcon aria-hidden="true" />
            <span>{workspaceSyncState === "creating" ? "Creating..." : "Create workspace"}</span>
          </PrimaryButton>
        </WorkspaceSetupPanel>
      ) : (
        <TerminalWorkspaceWithCloudDock>
          <TerminalWorkspaceMain>
            {hasVisibleWorkspaceTerminalPanes ? (
              <WorkspaceTerminalPanels>
                <ResizePanelGroup
                  id={`workspace-terminal-rows-${terminalWorkspace.id}`}
                  orientation="vertical"
                >
                  {terminalPanelRows.map((row, rowOrderIndex) => (
                    <Fragment key={`row-${row.rowIndex}`}>
                      {rowOrderIndex > 0 && (
                        <ResizeHandle
                          data-direction="vertical"
                        />
                      )}
                      <ResizePanel
                        data-terminal-row="true"
                        defaultSize={`${100 / terminalPanelRows.length}%`}
                        id={`workspace-terminal-row-${terminalWorkspace.id}-${row.rowIndex}`}
                        minSize={getTerminalPaneMinSizePercent(terminalPanelRows.length)}
                      >
                        <ResizePanelGroup
                          id={`workspace-terminal-cols-${terminalWorkspace.id}-${row.rowIndex}`}
                          orientation="horizontal"
                        >
                          {row.terminalIndexes.map((terminalIndex, columnIndex) => (
                            <Fragment key={`${terminalWorkspace.id}-${terminalIndex}`}>
                              {columnIndex > 0 && (
                                <ResizeHandle
                                  data-direction="horizontal"
                                />
                              )}
                              <ResizePanel
                                data-terminal-column="true"
                                data-terminal-leaf="true"
                                defaultSize={`${100 / row.terminalIndexes.length}%`}
                                id={`workspace-terminal-col-${terminalWorkspace.id}-${terminalIndex}`}
                                minSize={getTerminalPaneMinSizePercent(row.terminalIndexes.length)}
                              >
                                <WorkspaceTerminal
                                  key={`${terminalWorkspace.id}-${terminalIndex}-${getTerminalRole(terminalIndex)}-${terminalWorkspaceWorkingDirectory || ""}`}
                                  agent={getTerminalAgent(terminalIndex)}
                                  agentLaunchEpoch={workspaceAgentLaunchEpoch}
                                  agentLaunchReady={workspaceTerminalAgentLaunchReady}
                                  agentStatuses={agentStatuses}
                                  agentStatusError={agentStatusError}
                                  agentStatusState={agentStatusState}
                                  isActive={activePaneId === getTerminalPaneId(terminalIndex)}
                                  onActivateTerminal={handleActivateTerminalPane}
                                  onChangeTerminalRole={changeWorkspaceTerminalRole}
                                  onCloseTerminal={closeWorkspaceTerminal}
                                  onOpenSettings={showSettingsView}
                                  onPreparedTerminalChange={handlePreparedTerminalChange}
                                  onRecheckAgents={refreshAgentStatuses}
                                  prewarmShell={shouldPrewarmWorkspaceTerminals}
                                  terminalCount={terminalWorkspaceVisibleTerminalCount}
                                  terminalIndex={terminalIndex}
                                  terminalRole={getTerminalRole(terminalIndex)}
                                  workingDirectory={terminalWorkspaceWorkingDirectory}
                                  workspace={terminalWorkspace}
                                  workspaceError={workspaceError}
                                />
                              </ResizePanel>
                            </Fragment>
                          ))}
                        </ResizePanelGroup>
                      </ResizePanel>
                    </Fragment>
                  ))}
                </ResizePanelGroup>
              </WorkspaceTerminalPanels>
            ) : !hasWorkspaceTerminals ? (
              <WorkspaceTerminal
                key={`${terminalWorkspace?.id || "empty"}-${terminalWorkspaceTerminalIndexes[0] || 0}-${getTerminalRole(terminalWorkspaceTerminalIndexes[0] || 0)}-${terminalWorkspaceWorkingDirectory || ""}`}
                agent={terminalWorkspace ? workspaceTerminalRenderAgent : null}
                agentLaunchEpoch={workspaceAgentLaunchEpoch}
                agentLaunchReady={workspaceTerminalAgentLaunchReady}
                agentStatuses={agentStatuses}
                agentStatusError={agentStatusError}
                agentStatusState={agentStatusState}
                isActive={activePaneId === getTerminalPaneId(terminalWorkspaceTerminalIndexes[0] || 0)}
                onActivateTerminal={handleActivateTerminalPane}
                onChangeTerminalRole={changeWorkspaceTerminalRole}
                onCloseTerminal={closeWorkspaceTerminal}
                onOpenSettings={showSettingsView}
                onPreparedTerminalChange={handlePreparedTerminalChange}
                onRecheckAgents={refreshAgentStatuses}
                prewarmShell={terminalWorkspace ? shouldPrewarmWorkspaceTerminals : false}
                terminalCount={terminalWorkspaceVisibleTerminalCount}
                terminalIndex={terminalWorkspaceTerminalIndexes[0] || 0}
                terminalRole={getTerminalRole(terminalWorkspaceTerminalIndexes[0] || 0)}
                workingDirectory={terminalWorkspaceWorkingDirectory}
                workspace={terminalWorkspace}
                workspaceError={workspaceError}
              />
            ) : null}
          </TerminalWorkspaceMain>
          <CloudMcpTerminalDock workingDirectory={terminalWorkspaceWorkingDirectory} />
        </TerminalWorkspaceWithCloudDock>
      )}
    </ForgeWorkspace>
  );
}

export default memo(TerminalView);
