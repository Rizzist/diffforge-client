import { useCallback, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

import {
  SSH_AUTH_KEY,
  SSH_AUTH_METHODS,
  SSH_AUTH_PASSWORD,
  isSshAuthMethod,
} from "./sshProfileContract.js";
import {
  SshAuthOption,
  SshAuthSegment,
  SshField,
  SshFieldGrid,
  SshFieldHint,
  SshFieldLabel,
  SshFieldRow,
  SshFormActions,
  SshInlineButton,
  SshInput,
  SshInputWithButton,
  SshMessage,
} from "./sshStyles.js";

function initialFormState(profile) {
  return {
    id: profile?.id || "",
    name: profile?.name || "",
    host: profile?.host || "",
    port: profile?.port != null ? String(profile.port) : "",
    username: profile?.username || "",
    authMethod: isSshAuthMethod(profile?.authMethod) ? profile.authMethod : SSH_AUTH_METHODS[0].id,
    keyPath: profile?.keyPath || "",
    certificatePath: profile?.certificatePath || "",
    secret: "",
  };
}

// Create/edit form for a single SSH client. `profile` is a backend summary
// (never carries the secret). onSave receives a plain form object where the
// `secret` key is present ONLY when the user deliberately edited the password,
// so the backend can keep an existing secret untouched.
export function SshClientForm({
  profile = null,
  busy = false,
  compact = false,
  submitLabel,
  onSave,
  onCancel,
}) {
  const isEditing = Boolean(profile?.id);
  const [form, setForm] = useState(() => initialFormState(profile));
  const [secretDirty, setSecretDirty] = useState(false);
  const [error, setError] = useState("");

  const setField = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const hasStoredSecret = Boolean(profile?.hasSecret);

  const browseForFile = useCallback(async (field) => {
    try {
      const picked = await openFileDialog({ multiple: false, directory: false });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (typeof path === "string" && path) {
        setField(field, path);
      }
    } catch (_error) {
      // User cancelled or dialog unavailable — leave the field untouched.
    }
  }, [setField]);

  const handleSubmit = useCallback(async (event) => {
    event?.preventDefault?.();
    if (busy) {
      return;
    }
    setError("");

    const payload = {
      id: form.id || undefined,
      name: form.name,
      host: form.host,
      port: form.port,
      username: form.username,
      authMethod: form.authMethod,
      keyPath: form.keyPath,
      certificatePath: form.certificatePath,
    };
    // Only send the secret when the user actually touched the password field.
    // On create with the password method, always send (even empty -> no secret).
    if (form.authMethod === SSH_AUTH_PASSWORD && (secretDirty || !isEditing)) {
      payload.secret = form.secret;
    } else if (form.authMethod !== SSH_AUTH_PASSWORD && isEditing && hasStoredSecret) {
      // Switching an existing password profile to a keyless/key method clears
      // the stored secret so it does not linger on disk.
      payload.secret = "";
    }

    const result = await onSave?.(payload);
    if (result && result.ok === false) {
      setError(result.error || "Unable to save SSH client.");
    }
  }, [busy, form, hasStoredSecret, isEditing, onSave, secretDirty]);

  const authMethods = useMemo(() => SSH_AUTH_METHODS, []);
  const showKeyFields = form.authMethod === SSH_AUTH_KEY;
  const showPasswordField = form.authMethod === SSH_AUTH_PASSWORD;

  return (
    <form onSubmit={handleSubmit}>
      <SshFieldGrid>
        {error && <SshMessage data-tone="error">{error}</SshMessage>}

        <SshField>
          <SshFieldLabel>Name</SshFieldLabel>
          <SshInput
            autoFocus={!isEditing}
            disabled={busy}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="Production box"
            spellCheck={false}
            value={form.name}
          />
        </SshField>

        <SshFieldRow $columns="2fr 0.7fr">
          <SshField>
            <SshFieldLabel>Host</SshFieldLabel>
            <SshInput
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy}
              onChange={(event) => setField("host", event.target.value)}
              placeholder="example.com or 10.0.0.4"
              spellCheck={false}
              value={form.host}
            />
          </SshField>
          <SshField>
            <SshFieldLabel>Port</SshFieldLabel>
            <SshInput
              disabled={busy}
              inputMode="numeric"
              onChange={(event) => setField("port", event.target.value.replace(/[^0-9]/g, ""))}
              placeholder="22"
              value={form.port}
            />
          </SshField>
        </SshFieldRow>

        <SshField>
          <SshFieldLabel>Username</SshFieldLabel>
          <SshInput
            autoCapitalize="none"
            autoCorrect="off"
            disabled={busy}
            onChange={(event) => setField("username", event.target.value)}
            placeholder="root"
            spellCheck={false}
            value={form.username}
          />
        </SshField>

        <SshField as="div">
          <SshFieldLabel>Authentication</SshFieldLabel>
          <SshAuthSegment role="radiogroup">
            {authMethods.map((method) => (
              <SshAuthOption
                aria-checked={form.authMethod === method.id}
                data-selected={form.authMethod === method.id ? "true" : undefined}
                disabled={busy}
                key={method.id}
                onClick={() => setField("authMethod", method.id)}
                role="radio"
                type="button"
              >
                <strong>{method.label}</strong>
                {!compact && <small>{method.detail}</small>}
              </SshAuthOption>
            ))}
          </SshAuthSegment>
        </SshField>

        {showKeyFields && (
          <>
            <SshField>
              <SshFieldLabel>Private key file</SshFieldLabel>
              <SshInputWithButton>
                <SshInput
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={busy}
                  onChange={(event) => setField("keyPath", event.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                  spellCheck={false}
                  value={form.keyPath}
                />
                <SshInlineButton disabled={busy} onClick={() => browseForFile("keyPath")} type="button">
                  Browse
                </SshInlineButton>
              </SshInputWithButton>
            </SshField>
            <SshField>
              <SshFieldLabel>
                <span>Certificate file</span>
                <SshFieldHint>Optional</SshFieldHint>
              </SshFieldLabel>
              <SshInputWithButton>
                <SshInput
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={busy}
                  onChange={(event) => setField("certificatePath", event.target.value)}
                  placeholder="~/.ssh/id_ed25519-cert.pub"
                  spellCheck={false}
                  value={form.certificatePath}
                />
                <SshInlineButton disabled={busy} onClick={() => browseForFile("certificatePath")} type="button">
                  Browse
                </SshInlineButton>
              </SshInputWithButton>
            </SshField>
          </>
        )}

        {showPasswordField && (
          <SshField>
            <SshFieldLabel>
              <span>Password</span>
              {isEditing && hasStoredSecret && !secretDirty && <SshFieldHint>Saved · leave blank to keep</SshFieldHint>}
            </SshFieldLabel>
            <SshInput
              autoComplete="off"
              disabled={busy}
              onChange={(event) => {
                setSecretDirty(true);
                setField("secret", event.target.value);
              }}
              placeholder={isEditing && hasStoredSecret ? "••••••••" : "Password to use at the prompt"}
              type="password"
              value={form.secret}
            />
            <SshFieldHint>
              Stored locally on this device and never sent to the terminal output, logs, or the cloud.
            </SshFieldHint>
          </SshField>
        )}

        <SshFormActions>
          {onCancel && (
            <SshInlineButton disabled={busy} onClick={onCancel} type="button">
              Cancel
            </SshInlineButton>
          )}
          <SshInlineButton data-variant="primary" disabled={busy} type="submit">
            {busy ? "Saving…" : submitLabel || (isEditing ? "Save changes" : "Add client")}
          </SshInlineButton>
        </SshFormActions>
      </SshFieldGrid>
    </form>
  );
}
