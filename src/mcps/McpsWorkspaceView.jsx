import {
  ButtonHubIcon,
  ButtonKeyIcon,
  ButtonSettingsIcon,
  McpAccessGrid,
  McpAccessPanel,
  McpAccessTopline,
  McpEditorHeader,
  McpEditorPanel,
  McpEmptyAccess,
  McpHeaderPanel,
  McpLayout,
  McpPanelTopline,
  McpRegistryPanel,
  McpScopePreview,
  McpServerButton,
  McpServerCopy,
  McpServerIcon,
  McpServerList,
  McpStatsGrid,
  McpStatusBadge,
  McpTitleRow,
  McpWorkspaceSurface,
  PageSubline,
  PanelKicker,
  PanelHeading,
  SecondaryButton,
  SettingsIdentityItem,
  VaultPlaceholderIcon,
} from "../app/appStyles";

export default function McpsWorkspaceView({ onOpenSettings, workspace }) {
  const workspaceName = workspace?.name || "Workspace";

  return (
    <McpWorkspaceSurface aria-label="Workspace MCPs">
      <McpHeaderPanel>
        <McpTitleRow>
          <VaultPlaceholderIcon aria-hidden="true">
            <ButtonHubIcon />
          </VaultPlaceholderIcon>
          <div>
            <PanelKicker>MCPs</PanelKicker>
            <PanelHeading>{workspaceName} context servers</PanelHeading>
            <PageSubline>Workspace-scoped MCP registry and access state.</PageSubline>
          </div>
          {onOpenSettings && (
            <SecondaryButton onClick={onOpenSettings} type="button">
              <ButtonSettingsIcon aria-hidden="true" />
              <span>Settings</span>
            </SecondaryButton>
          )}
        </McpTitleRow>

        <McpStatsGrid>
          <SettingsIdentityItem>
            <span>Connected</span>
            <strong>0 servers</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Registry</span>
            <strong>Not configured</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Scope</span>
            <strong>{workspaceName}</strong>
          </SettingsIdentityItem>
        </McpStatsGrid>
      </McpHeaderPanel>

      <McpLayout>
        <McpRegistryPanel>
          <McpPanelTopline>
            <span>Registry</span>
            <strong>Local</strong>
          </McpPanelTopline>
          <McpServerList>
            <McpServerButton as="div" data-active="true">
              <McpServerIcon data-state="planned">
                <ButtonHubIcon aria-hidden="true" />
              </McpServerIcon>
              <McpServerCopy>
                <strong>Workspace MCPs</strong>
                <span>No servers connected</span>
              </McpServerCopy>
              <McpStatusBadge data-state="planned">Empty</McpStatusBadge>
            </McpServerButton>
            <McpServerButton as="div">
              <McpServerIcon>
                <ButtonKeyIcon aria-hidden="true" />
              </McpServerIcon>
              <McpServerCopy>
                <strong>Secrets</strong>
                <span>Use settings for account state</span>
              </McpServerCopy>
              <McpStatusBadge>Locked</McpStatusBadge>
            </McpServerButton>
          </McpServerList>
        </McpRegistryPanel>

        <McpEditorPanel>
          <McpEditorHeader>
            <div>
              <PanelKicker>Profile</PanelKicker>
              <PanelHeading>No MCP server selected</PanelHeading>
            </div>
            <McpStatusBadge data-state="planned">Pending setup</McpStatusBadge>
          </McpEditorHeader>

          <McpScopePreview>
            <SettingsIdentityItem>
              <span>Transport</span>
              <strong>Not set</strong>
            </SettingsIdentityItem>
            <SettingsIdentityItem>
              <span>Tools</span>
              <strong>0 allowed</strong>
            </SettingsIdentityItem>
            <SettingsIdentityItem>
              <span>Prompts</span>
              <strong>0 available</strong>
            </SettingsIdentityItem>
          </McpScopePreview>

          <McpAccessGrid>
            <McpAccessPanel>
              <McpAccessTopline>
                <span>
                  <ButtonHubIcon aria-hidden="true" />
                  Tool access
                </span>
              </McpAccessTopline>
              <McpEmptyAccess>No tools are exposed for this workspace yet.</McpEmptyAccess>
            </McpAccessPanel>
            <McpAccessPanel>
              <McpAccessTopline>
                <span>
                  <ButtonKeyIcon aria-hidden="true" />
                  Secrets
                </span>
              </McpAccessTopline>
              <McpEmptyAccess>Secrets stay unavailable until an MCP server is configured.</McpEmptyAccess>
            </McpAccessPanel>
          </McpAccessGrid>
        </McpEditorPanel>
      </McpLayout>
    </McpWorkspaceSurface>
  );
}
