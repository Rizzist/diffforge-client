import { useCallback, useState } from "react";

import {
  AccountSettingsPanel,
  ButtonAddIcon,
  ButtonDeleteIcon,
  ButtonEditIcon,
  ButtonHubIcon,
  ButtonKeyIcon,
  ButtonRefreshIcon,
  PendingIcon,
  SecondaryButton,
  SettingsHint,
  SettingsSectionHeader,
} from "../app/appStyles.js";
import { SshClientForm } from "./SshClientForm.jsx";
import {
  SSH_AUTH_KEY,
  SSH_AUTH_PASSWORD,
  describeSshProfile,
  sshAuthMethodLabel,
} from "./sshProfileContract.js";
import { useSshProfiles } from "./useSshProfiles.js";
import {
  SshClientIcon,
  SshClientList,
  SshClientMain,
  SshClientMeta,
  SshClientName,
  SshClientRow,
  SshClientRowActions,
  SshClientTag,
  SshEmptyState,
  SshFormCard,
  SshFormHeading,
  SshInlineButton,
  SshMessage,
} from "./sshStyles.js";

function authTagLabel(profile) {
  if (profile.authMethod === SSH_AUTH_KEY) {
    return profile.certificatePath ? "Key + cert" : "Key";
  }
  if (profile.authMethod === SSH_AUTH_PASSWORD) {
    return profile.hasSecret ? "Password" : "Password (unset)";
  }
  return "Agent";
}

export function SshSettingsPanel() {
  const { profiles, status, error, isLoading, refresh, save, remove } = useSshProfiles();
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const beginCreate = useCallback(() => {
    setEditingId(null);
    setPendingDeleteId(null);
    setRowError("");
    setCreating(true);
  }, []);

  const beginEdit = useCallback((profileId) => {
    setCreating(false);
    setPendingDeleteId(null);
    setRowError("");
    setEditingId(profileId);
  }, []);

  const cancelForm = useCallback(() => {
    setCreating(false);
    setEditingId(null);
  }, []);

  const handleSave = useCallback(async (form) => {
    setBusy(true);
    const result = await save(form);
    setBusy(false);
    if (result.ok) {
      setCreating(false);
      setEditingId(null);
      setRowError("");
    }
    return result;
  }, [save]);

  const handleDelete = useCallback(async (profileId) => {
    if (pendingDeleteId !== profileId) {
      setPendingDeleteId(profileId);
      return;
    }
    setBusy(true);
    const result = await remove(profileId);
    setBusy(false);
    setPendingDeleteId(null);
    if (!result.ok) {
      setRowError(result.error || "Unable to delete SSH client.");
    } else {
      setRowError("");
      if (editingId === profileId) {
        setEditingId(null);
      }
    }
  }, [editingId, pendingDeleteId, remove]);

  const editingProfile = profiles.find((profile) => profile.id === editingId) || null;

  return (
    <AccountSettingsPanel>
      <SettingsSectionHeader>
        <span>SSH clients · Saved connections</span>
        <em data-tone={isLoading ? "orange" : "blue"}>
          {isLoading ? "Loading" : `${profiles.length} saved`}
        </em>
        <SecondaryButton disabled={isLoading} onClick={() => refresh()} type="button">
          {isLoading ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
          <span>{isLoading ? "Loading..." : "Refresh"}</span>
        </SecondaryButton>
      </SettingsSectionHeader>

      <SettingsHint>
        Define SSH connections once, then launch them from the plus menu inside any shell terminal.
        Passwords stay on this device and are typed straight into the session, never logged or synced.
      </SettingsHint>

      {error && <SshMessage data-tone="error">{error}</SshMessage>}
      {rowError && <SshMessage data-tone="error">{rowError}</SshMessage>}

      {status !== "loading" && profiles.length === 0 && !creating && (
        <SshEmptyState>
          <strong>No SSH clients yet</strong>
          <span>Add a connection to reuse it from any terminal.</span>
        </SshEmptyState>
      )}

      {profiles.length > 0 && (
        <SshClientList>
          {profiles.map((profile) => (
            editingId === profile.id ? (
              <SshFormCard key={profile.id}>
                <SshFormHeading>
                  <strong>Edit {profile.name}</strong>
                </SshFormHeading>
                <SshClientForm
                  busy={busy}
                  onCancel={cancelForm}
                  onSave={handleSave}
                  profile={profile}
                />
              </SshFormCard>
            ) : (
              <SshClientRow key={profile.id}>
                <SshClientIcon aria-hidden="true">
                  {profile.authMethod === SSH_AUTH_KEY ? <ButtonKeyIcon /> : <ButtonHubIcon />}
                </SshClientIcon>
                <SshClientMain>
                  <SshClientName>{profile.name}</SshClientName>
                  <SshClientMeta title={`${describeSshProfile(profile)} · ${sshAuthMethodLabel(profile.authMethod)}`}>
                    {describeSshProfile(profile)}
                  </SshClientMeta>
                </SshClientMain>
                <SshClientTag>{authTagLabel(profile)}</SshClientTag>
                <SshClientRowActions>
                  <SshInlineButton
                    aria-label={`Edit ${profile.name}`}
                    disabled={busy}
                    onClick={() => beginEdit(profile.id)}
                    title="Edit client"
                    type="button"
                  >
                    <ButtonEditIcon aria-hidden="true" />
                  </SshInlineButton>
                  <SshInlineButton
                    aria-label={pendingDeleteId === profile.id ? `Confirm delete ${profile.name}` : `Delete ${profile.name}`}
                    data-variant="danger"
                    disabled={busy}
                    onClick={() => handleDelete(profile.id)}
                    title={pendingDeleteId === profile.id ? "Click again to confirm" : "Delete client"}
                    type="button"
                  >
                    {pendingDeleteId === profile.id ? "Confirm" : <ButtonDeleteIcon aria-hidden="true" />}
                  </SshInlineButton>
                </SshClientRowActions>
              </SshClientRow>
            )
          ))}
        </SshClientList>
      )}

      {creating ? (
        <SshFormCard>
          <SshFormHeading>
            <strong>New SSH client</strong>
          </SshFormHeading>
          <SshClientForm
            busy={busy}
            onCancel={cancelForm}
            onSave={handleSave}
          />
        </SshFormCard>
      ) : (
        <SshInlineButton data-variant="primary" disabled={busy} onClick={beginCreate} type="button">
          <ButtonAddIcon aria-hidden="true" />
          Add SSH client
        </SshInlineButton>
      )}
    </AccountSettingsPanel>
  );
}
