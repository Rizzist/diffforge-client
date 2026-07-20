import { useCallback, useState } from "react";

import {
  AccountSettingsPanel,
  ButtonAddIcon,
  ButtonDeleteIcon,
  ButtonEditIcon,
  ButtonMailIcon,
  ButtonRefreshIcon,
  PendingIcon,
  SecondaryButton,
  SettingsHint,
  SettingsSectionHeader,
} from "../app/appStyles.js";
import { describeEmailProfile, emailModeLabel } from "./emailDeliveryContract.js";
import { EmailSenderProfileForm } from "./EmailSenderProfileForm.jsx";
import {
  EmailCapabilityStrip,
  EmailEmptyState,
  EmailFormCard,
  EmailFormHeading,
  EmailInlineButton,
  EmailMessage,
  EmailProfileIcon,
  EmailProfileList,
  EmailProfileMain,
  EmailProfileMeta,
  EmailProfileName,
  EmailProfileRow,
  EmailProfileRowActions,
  EmailProfileTag,
} from "./emailStyles.js";
import { NativeDeliveryPanel } from "./NativeDeliveryPanel.jsx";
import { useEmailDeliveryProfiles } from "./useEmailDeliveryProfiles.js";

function credentialTag(profile) {
  if (profile.mode === "native") {
    return "Native";
  }
  return profile.has_secret ? "Password saved" : "Password unset";
}

// Email Delivery settings tab: sender profiles (credentials live ONLY on
// this device) plus the native-delivery qualification checklist. The
// dashboard configures identities and routing; credentials never leave the
// desktop.
export function EmailDeliverySettingsPanel() {
  const { profiles, capability, status, error, isLoading, refresh, save, remove } =
    useEmailDeliveryProfiles();
  const [editingRef, setEditingRef] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");
  const [pendingDeleteRef, setPendingDeleteRef] = useState(null);

  const beginCreate = useCallback(() => {
    setEditingRef(null);
    setPendingDeleteRef(null);
    setRowError("");
    setCreating(true);
  }, []);

  const beginEdit = useCallback((profileRef) => {
    setCreating(false);
    setPendingDeleteRef(null);
    setRowError("");
    setEditingRef(profileRef);
  }, []);

  const cancelForm = useCallback(() => {
    setCreating(false);
    setEditingRef(null);
  }, []);

  const handleSave = useCallback(async (form) => {
    setBusy(true);
    const result = await save(form);
    setBusy(false);
    if (result.ok) {
      setCreating(false);
      setEditingRef(null);
      setRowError("");
    }
    return result;
  }, [save]);

  const handleDelete = useCallback(async (profileRef) => {
    if (pendingDeleteRef !== profileRef) {
      setPendingDeleteRef(profileRef);
      return;
    }
    setBusy(true);
    const result = await remove(profileRef);
    setBusy(false);
    setPendingDeleteRef(null);
    if (!result.ok) {
      setRowError(result.error || "Unable to delete the sender profile.");
    } else {
      setRowError("");
      if (editingRef === profileRef) {
        setEditingRef(null);
      }
    }
  }, [editingRef, pendingDeleteRef, remove]);

  const editingProfile =
    profiles.find((profile) => profile.profile_ref === editingRef) || null;
  const credentialStore = capability?.credential_store?.health || null;
  const journalOk = capability?.journal?.ok === true;
  const runtime = capability?.capability?.runtime || null;

  return (
    <AccountSettingsPanel>
      <SettingsSectionHeader>
        <span>Email Delivery · Sender profiles</span>
        <em data-tone={isLoading ? "orange" : "blue"}>
          {isLoading ? "Loading" : `${profiles.length} configured`}
        </em>
        <SecondaryButton disabled={isLoading} onClick={() => refresh()} type="button">
          {isLoading ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
          <span>{isLoading ? "Loading..." : "Refresh"}</span>
        </SecondaryButton>
      </SettingsSectionHeader>

      <SettingsHint>
        Sending credentials are configured here and stored only on this device — the web
        dashboard assigns identities to devices but never sees passwords. Sends journal
        durably before anything is acknowledged, so a crash can never silently duplicate an
        email.
      </SettingsHint>

      {capability && (
        <EmailCapabilityStrip>
          <strong>Device</strong>
          <span>runtime: {runtime || "unknown"}</span>
          <span>
            credential store: {credentialStore || "unknown"}
          </span>
          <span>send journal: {journalOk ? "healthy" : "unavailable"}</span>
        </EmailCapabilityStrip>
      )}

      {error && <EmailMessage data-tone="error">{error}</EmailMessage>}
      {rowError && <EmailMessage data-tone="error">{rowError}</EmailMessage>}

      {status !== "loading" && profiles.length === 0 && !creating && (
        <EmailEmptyState>
          <strong>No sender profiles yet</strong>
          <span>Add a provider SMTP profile to send email from this device.</span>
        </EmailEmptyState>
      )}

      {profiles.length > 0 && (
        <EmailProfileList>
          {profiles.map((profile) => (
            editingRef === profile.profile_ref ? (
              <EmailFormCard key={profile.profile_ref}>
                <EmailFormHeading>
                  <strong>Edit {profile.display_name || profile.profile_ref}</strong>
                </EmailFormHeading>
                <EmailSenderProfileForm
                  busy={busy}
                  onCancel={cancelForm}
                  onSave={handleSave}
                  profile={editingProfile}
                />
              </EmailFormCard>
            ) : (
              <EmailProfileRow key={profile.profile_ref}>
                <EmailProfileIcon aria-hidden="true">
                  <ButtonMailIcon />
                </EmailProfileIcon>
                <EmailProfileMain>
                  <EmailProfileName>
                    {profile.display_name || profile.from_address || profile.profile_ref}
                  </EmailProfileName>
                  <EmailProfileMeta
                    title={`${describeEmailProfile(profile)} · ${emailModeLabel(profile.mode)}`}
                  >
                    {describeEmailProfile(profile)}
                  </EmailProfileMeta>
                </EmailProfileMain>
                <EmailProfileTag
                  data-tone={profile.mode === "provider" && !profile.has_secret ? "warn" : undefined}
                >
                  {credentialTag(profile)}
                </EmailProfileTag>
                <EmailProfileRowActions>
                  <EmailInlineButton
                    aria-label={`Edit ${profile.display_name || profile.profile_ref}`}
                    disabled={busy}
                    onClick={() => beginEdit(profile.profile_ref)}
                    title="Edit sender profile"
                    type="button"
                  >
                    <ButtonEditIcon aria-hidden="true" />
                  </EmailInlineButton>
                  <EmailInlineButton
                    aria-label={
                      pendingDeleteRef === profile.profile_ref
                        ? `Confirm delete ${profile.profile_ref}`
                        : `Delete ${profile.profile_ref}`
                    }
                    data-variant="danger"
                    disabled={busy}
                    onClick={() => handleDelete(profile.profile_ref)}
                    title={
                      pendingDeleteRef === profile.profile_ref
                        ? "Click again to confirm"
                        : "Delete sender profile"
                    }
                    type="button"
                  >
                    {pendingDeleteRef === profile.profile_ref ? "Confirm" : <ButtonDeleteIcon aria-hidden="true" />}
                  </EmailInlineButton>
                </EmailProfileRowActions>
              </EmailProfileRow>
            )
          ))}
        </EmailProfileList>
      )}

      {creating ? (
        <EmailFormCard>
          <EmailFormHeading>
            <strong>New sender profile</strong>
          </EmailFormHeading>
          <EmailSenderProfileForm busy={busy} onCancel={cancelForm} onSave={handleSave} />
        </EmailFormCard>
      ) : (
        <EmailInlineButton data-variant="primary" disabled={busy} onClick={beginCreate} type="button">
          <ButtonAddIcon aria-hidden="true" />
          Add sender profile
        </EmailInlineButton>
      )}

      <SettingsSectionHeader>
        <span>Email Delivery · Native qualification</span>
        <em data-tone="blue">Checklist</em>
      </SettingsSectionHeader>
      <NativeDeliveryPanel profiles={profiles} />
    </AccountSettingsPanel>
  );
}
