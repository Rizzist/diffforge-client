import {
  ButtonHubIcon,
  ButtonSettingsIcon,
  PageSubline,
  PanelKicker,
  PanelHeading,
  SecondaryButton,
  SettingsIdentityItem,
  VaultPlaceholderIcon,
  VaultPlaceholderPanel,
  VaultStatusGrid,
  VaultWorkspaceSurface,
} from "../app/appStyles";

export default function McpsWorkspaceView({ onOpenSettings, workspace }) {
  return (
    <VaultWorkspaceSurface aria-label="Workspace MCPs">
      <VaultPlaceholderPanel>
        <VaultPlaceholderIcon aria-hidden="true">
          <ButtonHubIcon />
        </VaultPlaceholderIcon>
        <div>
          <PanelKicker>MCPs</PanelKicker>
          <PanelHeading>{workspace?.name || "Workspace"} MCPs</PanelHeading>
          <PageSubline>Placeholder</PageSubline>
        </div>
        <VaultStatusGrid>
          <SettingsIdentityItem>
            <span>Status</span>
            <strong>Not connected</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Registry</span>
            <strong>Unavailable</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Scope</span>
            <strong>{workspace?.name || "Workspace"}</strong>
          </SettingsIdentityItem>
        </VaultStatusGrid>
        {onOpenSettings && (
          <SecondaryButton onClick={onOpenSettings} type="button">
            <ButtonSettingsIcon aria-hidden="true" />
            <span>Settings</span>
          </SecondaryButton>
        )}
      </VaultPlaceholderPanel>
    </VaultWorkspaceSurface>
  );
}
