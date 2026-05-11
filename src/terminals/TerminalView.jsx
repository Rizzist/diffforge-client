import { Fragment } from "react";
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
import CloudMcpWorkspaceDock from "./CloudMcpWorkspaceDock.jsx";
import { TerminalDevMetrics } from "./terminalTelemetry.jsx";
import WorkspaceTerminal, { getTerminalPaneMinSizePercent } from "./WorkspaceTerminal.jsx";

const TerminalWorkspaceWithCloudDock = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(280px, 30vw, 340px);
  gap: 14px;
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

export default function TerminalView({
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
  terminalMetrics,
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
  const getTerminalAgent = (terminalIndex) => (
    Object.prototype.hasOwnProperty.call(terminalAgentsByIndex, terminalIndex)
      ? terminalAgentsByIndex[terminalIndex]
      : workspaceTerminalRenderAgent
  );
  const getTerminalRole = (terminalIndex) => (
    terminalRolesByIndex[terminalIndex] || getTerminalAgent(terminalIndex)?.id || ""
  );

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
            {hasWorkspaceTerminals ? (
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
                                  agent={getTerminalAgent(terminalIndex)}
                                  agentLaunchEpoch={workspaceAgentLaunchEpoch}
                                  agentLaunchReady={workspaceTerminalAgentLaunchReady}
                                  agentStatuses={agentStatuses}
                                  agentStatusError={agentStatusError}
                                  agentStatusState={agentStatusState}
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
            ) : (
              <WorkspaceTerminal
                agent={terminalWorkspace ? workspaceTerminalRenderAgent : null}
                agentLaunchEpoch={workspaceAgentLaunchEpoch}
                agentLaunchReady={workspaceTerminalAgentLaunchReady}
                agentStatuses={agentStatuses}
                agentStatusError={agentStatusError}
                agentStatusState={agentStatusState}
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
            )}
          </TerminalWorkspaceMain>
          <CloudMcpWorkspaceDock
            rootDirectory={terminalWorkspaceWorkingDirectory}
            workspace={terminalWorkspace}
          />
        </TerminalWorkspaceWithCloudDock>
      )}
      {!shouldShowWorkspaceSetup && <TerminalDevMetrics metrics={terminalMetrics} />}
    </ForgeWorkspace>
  );
}
