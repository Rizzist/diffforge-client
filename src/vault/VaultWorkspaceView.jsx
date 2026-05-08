import {
  ButtonKeyIcon,
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

function PlaceholderWorkspaceView({
  ariaLabel,
  icon,
  kicker,
  onOpenSettings,
  resourceLabel,
  title,
  workspace,
}) {
  return (
    <VaultWorkspaceSurface aria-label={ariaLabel}>
      <VaultPlaceholderPanel>
        <VaultPlaceholderIcon aria-hidden="true">
          {icon}
        </VaultPlaceholderIcon>
        <div>
          <PanelKicker>{kicker}</PanelKicker>
          <PanelHeading>{title}</PanelHeading>
          <PageSubline>Placeholder</PageSubline>
        </div>
        <VaultStatusGrid>
          <SettingsIdentityItem>
            <span>Status</span>
            <strong>Not connected</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>{resourceLabel}</span>
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

export default function VaultWorkspaceView({ onOpenSettings, workspace }) {
  return (
    <PlaceholderWorkspaceView
      ariaLabel="Vault"
      icon={<ButtonKeyIcon />}
      kicker="Vault"
      onOpenSettings={onOpenSettings}
      resourceLabel="Storage"
      title={`${workspace?.name || "Workspace"} vault`}
      workspace={workspace}
    />
  );
}
