import { Fragment } from "react";

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
import { TerminalDevMetrics } from "../terminals/terminalTelemetry.jsx";
import WorkspaceTerminal, { getTerminalPaneMinSizePercent } from "../terminals/WorkspaceTerminal.jsx";

export default function AgentWorkspaceView({
  activeWorkspace,
  activeWorkspaceAgentWorkingDirectory,
  activeWorkspaceTerminalIndexes,
  activeWorkspaceVisibleTerminalCount,
  agentStatusError,
  agentStatuses,
  agentStatusState,
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
        activeWorkspace && workspaceTerminalRenderAgent ? (
          <WorkspaceTerminalPanels>
            <ResizePanelGroup
              id={`workspace-terminal-rows-${activeWorkspace.id}`}
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
                    id={`workspace-terminal-row-${activeWorkspace.id}-${row.rowIndex}`}
                    minSize={getTerminalPaneMinSizePercent(terminalPanelRows.length)}
                  >
                    <ResizePanelGroup
                      id={`workspace-terminal-cols-${activeWorkspace.id}-${row.rowIndex}`}
                      orientation="horizontal"
                    >
                      {row.terminalIndexes.map((terminalIndex, columnIndex) => (
                        <Fragment key={`${activeWorkspace.id}-${terminalIndex}`}>
                          {columnIndex > 0 && (
                            <ResizeHandle
                              data-direction="horizontal"
                            />
                          )}
                          <ResizePanel
                            data-terminal-column="true"
                            data-terminal-leaf="true"
                            defaultSize={`${100 / row.terminalIndexes.length}%`}
                            id={`workspace-terminal-col-${activeWorkspace.id}-${terminalIndex}`}
                            minSize={getTerminalPaneMinSizePercent(row.terminalIndexes.length)}
                          >
                            <WorkspaceTerminal
                              agent={workspaceTerminalRenderAgent}
                              agentLaunchEpoch={workspaceAgentLaunchEpoch}
                              agentLaunchReady={workspaceTerminalAgentLaunchReady}
                              agentStatuses={agentStatuses}
                              agentStatusError={agentStatusError}
                              agentStatusState={agentStatusState}
                              onCloseTerminal={closeWorkspaceTerminal}
                              onOpenSettings={showSettingsView}
                              onPreparedTerminalChange={handlePreparedTerminalChange}
                              onRecheckAgents={refreshAgentStatuses}
                              prewarmShell={shouldPrewarmWorkspaceTerminals}
                              terminalCount={activeWorkspaceVisibleTerminalCount}
                              terminalIndex={terminalIndex}
                              workingDirectory={activeWorkspaceAgentWorkingDirectory}
                              workspace={activeWorkspace}
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
            agent={activeWorkspace ? workspaceTerminalRenderAgent : null}
            agentLaunchEpoch={workspaceAgentLaunchEpoch}
            agentLaunchReady={workspaceTerminalAgentLaunchReady}
            agentStatuses={agentStatuses}
            agentStatusError={agentStatusError}
            agentStatusState={agentStatusState}
            onCloseTerminal={closeWorkspaceTerminal}
            onOpenSettings={showSettingsView}
            onPreparedTerminalChange={handlePreparedTerminalChange}
            onRecheckAgents={refreshAgentStatuses}
            prewarmShell={activeWorkspace ? shouldPrewarmWorkspaceTerminals : false}
            terminalCount={activeWorkspaceVisibleTerminalCount}
            terminalIndex={activeWorkspaceTerminalIndexes[0] || 0}
            workingDirectory={activeWorkspaceAgentWorkingDirectory}
            workspace={activeWorkspace}
            workspaceError={workspaceError}
          />
        )
      )}
      {!shouldShowWorkspaceSetup && <TerminalDevMetrics metrics={terminalMetrics} />}
    </ForgeWorkspace>
  );
}
