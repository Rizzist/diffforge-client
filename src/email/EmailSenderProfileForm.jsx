import { useCallback, useState } from "react";

import {
  EMAIL_MODES,
  EMAIL_MODE_NATIVE,
  EMAIL_MODE_PROVIDER,
  EMAIL_SMTP_SECURITY_IMPLICIT,
  EMAIL_SMTP_SECURITY_STARTTLS,
  isEmailMode,
} from "./emailDeliveryContract.js";
import {
  EmailField,
  EmailFieldGrid,
  EmailFieldHint,
  EmailFieldLabel,
  EmailFieldRow,
  EmailFormActions,
  EmailInlineButton,
  EmailInput,
  EmailMessage,
  EmailModeOption,
  EmailModeSegment,
} from "./emailStyles.js";

function initialFormState(profile) {
  return {
    profile_ref: profile?.profile_ref || "",
    mode: isEmailMode(profile?.mode) ? profile.mode : EMAIL_MODE_PROVIDER,
    display_name: profile?.display_name || "",
    from_address: profile?.from_address || "",
    smtp_host: profile?.smtp_host || "",
    smtp_port: profile?.smtp_port != null ? String(profile.smtp_port) : "",
    smtp_security: profile?.smtp_security || "",
    username: profile?.username || "",
    secret: "",
  };
}

// Create/edit form for one sender profile. `profile` is a backend summary
// and NEVER carries the secret — the password input is write-only and always
// renders blank on reload. The `secret` key is attached to the save payload
// only when the user actually touched the field, so an untouched save
// preserves the stored app password (save-doesn't-blank); clearing the field
// and saving removes it explicitly.
export function EmailSenderProfileForm({
  profile = null,
  busy = false,
  onSave,
  onCancel,
}) {
  const isEditing = Boolean(profile?.profile_ref);
  const [form, setForm] = useState(() => initialFormState(profile));
  const [secretDirty, setSecretDirty] = useState(false);
  const [error, setError] = useState("");

  const setField = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const hasStoredSecret = Boolean(profile?.has_secret);
  const isProvider = form.mode === EMAIL_MODE_PROVIDER;
  const portNumber = Number.parseInt(form.smtp_port, 10);
  const needsExplicitSecurity =
    isProvider && Number.isInteger(portNumber) && portNumber !== 587 && portNumber !== 465;

  const handleSubmit = useCallback(async (event) => {
    event?.preventDefault?.();
    if (busy) {
      return;
    }
    setError("");

    const payload = {
      profile_ref: form.profile_ref || undefined,
      mode: form.mode,
      display_name: form.display_name,
      from_address: form.from_address,
      smtp_host: form.smtp_host,
      smtp_port: form.smtp_port,
      smtp_security: form.smtp_security || undefined,
      username: form.username,
    };
    // Write-only password: attach `secret` only when deliberately touched.
    if (secretDirty) {
      payload.secret = form.secret;
    }

    const result = await onSave?.(payload);
    if (result && result.ok === false) {
      setError(result.error || "Unable to save the sender profile.");
    }
  }, [busy, form, onSave, secretDirty]);

  return (
    <form onSubmit={handleSubmit}>
      <EmailFieldGrid>
        {error && <EmailMessage data-tone="error">{error}</EmailMessage>}

        <EmailField as="div">
          <EmailFieldLabel>Delivery mode</EmailFieldLabel>
          <EmailModeSegment role="radiogroup">
            {EMAIL_MODES.map((mode) => (
              <EmailModeOption
                aria-checked={form.mode === mode.id}
                data-selected={form.mode === mode.id ? "true" : undefined}
                disabled={busy}
                key={mode.id}
                onClick={() => setField("mode", mode.id)}
                role="radio"
                type="button"
              >
                <strong>{mode.label}</strong>
                <small>{mode.detail}</small>
              </EmailModeOption>
            ))}
          </EmailModeSegment>
        </EmailField>

        <EmailFieldRow $columns="1fr 1fr">
          <EmailField>
            <EmailFieldLabel>Display name</EmailFieldLabel>
            <EmailInput
              autoFocus={!isEditing}
              disabled={busy}
              onChange={(event) => setField("display_name", event.target.value)}
              placeholder="Acme Ops"
              spellCheck={false}
              value={form.display_name}
            />
          </EmailField>
          <EmailField>
            <EmailFieldLabel>From address</EmailFieldLabel>
            <EmailInput
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy}
              onChange={(event) => setField("from_address", event.target.value)}
              placeholder="ops@yourdomain.com"
              spellCheck={false}
              value={form.from_address}
            />
          </EmailField>
        </EmailFieldRow>

        {isProvider && (
          <>
            <EmailFieldRow $columns="2fr 0.7fr">
              <EmailField>
                <EmailFieldLabel>SMTP host</EmailFieldLabel>
                <EmailInput
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={busy}
                  onChange={(event) => setField("smtp_host", event.target.value)}
                  placeholder="smtp.gmail.com"
                  spellCheck={false}
                  value={form.smtp_host}
                />
              </EmailField>
              <EmailField>
                <EmailFieldLabel>Port</EmailFieldLabel>
                <EmailInput
                  disabled={busy}
                  inputMode="numeric"
                  onChange={(event) => setField("smtp_port", event.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="587"
                  value={form.smtp_port}
                />
              </EmailField>
            </EmailFieldRow>

            {needsExplicitSecurity && (
              <EmailField as="div">
                <EmailFieldLabel>TLS mode (non-standard port)</EmailFieldLabel>
                <EmailModeSegment role="radiogroup">
                  <EmailModeOption
                    aria-checked={form.smtp_security === EMAIL_SMTP_SECURITY_STARTTLS}
                    data-selected={form.smtp_security === EMAIL_SMTP_SECURITY_STARTTLS ? "true" : undefined}
                    disabled={busy}
                    onClick={() => setField("smtp_security", EMAIL_SMTP_SECURITY_STARTTLS)}
                    role="radio"
                    type="button"
                  >
                    <strong>STARTTLS</strong>
                    <small>Plain connect, mandatory TLS upgrade before anything else.</small>
                  </EmailModeOption>
                  <EmailModeOption
                    aria-checked={form.smtp_security === EMAIL_SMTP_SECURITY_IMPLICIT}
                    data-selected={form.smtp_security === EMAIL_SMTP_SECURITY_IMPLICIT ? "true" : undefined}
                    disabled={busy}
                    onClick={() => setField("smtp_security", EMAIL_SMTP_SECURITY_IMPLICIT)}
                    role="radio"
                    type="button"
                  >
                    <strong>Implicit TLS</strong>
                    <small>TLS from the first byte (the 465 shape).</small>
                  </EmailModeOption>
                </EmailModeSegment>
                <EmailFieldHint>
                  Plaintext SMTP is never used; certificates are always verified.
                </EmailFieldHint>
              </EmailField>
            )}

            <EmailField>
              <EmailFieldLabel>Username</EmailFieldLabel>
              <EmailInput
                autoCapitalize="none"
                autoCorrect="off"
                disabled={busy}
                onChange={(event) => setField("username", event.target.value)}
                placeholder="ops@yourdomain.com"
                spellCheck={false}
                value={form.username}
              />
            </EmailField>

            <EmailField>
              <EmailFieldLabel>
                <span>App password</span>
                {isEditing && hasStoredSecret && !secretDirty && (
                  <EmailFieldHint>Saved · leave blank to keep</EmailFieldHint>
                )}
              </EmailFieldLabel>
              <EmailInput
                autoComplete="off"
                disabled={busy}
                onChange={(event) => {
                  setSecretDirty(true);
                  setField("secret", event.target.value);
                }}
                placeholder={isEditing && hasStoredSecret ? "••••••••" : "Provider app password"}
                type="password"
                value={form.secret}
              />
              <EmailFieldHint>
                Stored in this device&apos;s credential store (Keychain / Credential Manager /
                encrypted vault) and never synced. Clear the field and save to remove it.
              </EmailFieldHint>
            </EmailField>
          </>
        )}

        {form.mode === EMAIL_MODE_NATIVE && (
          <EmailMessage data-tone="info">
            Native delivery sends directly from this machine and needs the qualification
            checklist below to pass (static IP, port 25, reverse DNS, DKIM). Provider mode
            works everywhere without it.
          </EmailMessage>
        )}

        <EmailFormActions>
          {onCancel && (
            <EmailInlineButton disabled={busy} onClick={onCancel} type="button">
              Cancel
            </EmailInlineButton>
          )}
          <EmailInlineButton data-variant="primary" disabled={busy} type="submit">
            {busy ? "Saving…" : isEditing ? "Save changes" : "Add sender"}
          </EmailInlineButton>
        </EmailFormActions>
      </EmailFieldGrid>
    </form>
  );
}
