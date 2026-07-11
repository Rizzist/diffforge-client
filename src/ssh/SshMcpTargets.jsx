import { useCallback, useState } from "react";

import { SshClientForm } from "./SshClientForm.jsx";
import {
  SSH_AUTH_KEY,
  SSH_AUTH_PASSWORD,
  describeSshProfile,
  listSshProfiles,
  sshAuthMethodLabel,
} from "./sshProfileContract.js";
import {
  SshClientList,
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

// Map an MCP registry ssh_target row (snake_case) to the camelCase shape
// SshClientForm expects.
function targetToFormProfile(target) {
  return {
    id: target.id,
    name: target.name || "",
    host: target.host || "",
    port: target.port,
    username: target.username || "",
    auth_method: target.auth_method,
    key_path: target.key_path || "",
    certificate_path: target.certificate_path || "",
    has_secret: Boolean(target.has_secret),
  };
}

// Build the coordination upsert input from a saved form object, carrying the
// per-target agent/reveal flags (which live on the row, not the form).
function formToUpsertInput(form, { agentEnabled, revealPassword }) {
  const input = {
    id: form.id || undefined,
    name: form.name,
    host: form.host,
    port: form.port === "" || form.port == null ? null : Number.parseInt(form.port, 10),
    username: form.username || null,
    auth_method: form.auth_method,
    key_path: form.key_path || null,
    certificate_path: form.certificate_path || null,
    agent_enabled: Boolean(agentEnabled),
    reveal_password: Boolean(revealPassword),
  };
  if (Object.prototype.hasOwnProperty.call(form, "secret")) {
    input.secret = form.secret == null ? "" : String(form.secret);
  }
  return input;
}

function authTagLabel(target) {
  if (target.auth_method === SSH_AUTH_KEY) {
    return target.certificate_path ? "Key + cert" : "Key";
  }
  if (target.auth_method === SSH_AUTH_PASSWORD) {
    return target.has_secret ? "Password" : "Password (unset)";
  }
  return "Agent";
}

// SSH targets section inside the Secrets MCP vault. Each target is disabled for
// coding agents until the user flips "Agent access". Password targets are
// askpass-shielded by default; "Reveal password" additionally lets the agent
// read the raw password via secrets__ssh_get.
export function SshMcpTargets({
  targets = [],
  scope = "workspace",
  busy = false,
  onUpsert,
  onDelete,
}) {
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [error, setError] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importChoices, setImportChoices] = useState(null);

  const closeForms = useCallback(() => {
    setEditingId(null);
    setCreating(false);
    setPrefill(null);
    setImportChoices(null);
  }, []);

  const beginCreate = useCallback(() => {
    setError("");
    setPendingDeleteId(null);
    setEditingId(null);
    setPrefill(null);
    setImportChoices(null);
    setCreating(true);
  }, []);

  const beginEdit = useCallback((id) => {
    setError("");
    setPendingDeleteId(null);
    setCreating(false);
    setPrefill(null);
    setImportChoices(null);
    setEditingId(id);
  }, []);

  const handleSaveNew = useCallback(async (form) => {
    const result = await onUpsert(formToUpsertInput(form, { agentEnabled: false, revealPassword: false }));
    if (result?.ok) {
      closeForms();
    }
    return result || { ok: false, error: "Unable to save SSH target." };
  }, [closeForms, onUpsert]);

  const handleSaveEdit = useCallback(async (target, form) => {
    const result = await onUpsert(formToUpsertInput(form, {
      agentEnabled: target.agent_enabled,
      revealPassword: target.reveal_password,
    }));
    if (result?.ok) {
      closeForms();
    }
    return result || { ok: false, error: "Unable to save SSH target." };
  }, [closeForms, onUpsert]);

  const flipFlag = useCallback(async (target, patch) => {
    setError("");
    // Toggles resend the full row (upsert requires name/host); secret is
    // omitted so the stored password is preserved.
    const form = { ...targetToFormProfile(target) };
    const result = await onUpsert(formToUpsertInput(form, {
      agentEnabled: patch.agentEnabled ?? target.agent_enabled,
      revealPassword: patch.revealPassword ?? target.reveal_password,
    }));
    if (result && result.ok === false) {
      setError(result.error || "Unable to update SSH target.");
    }
  }, [onUpsert]);

  const handleDelete = useCallback(async (id) => {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    const result = await onDelete(id);
    setPendingDeleteId(null);
    if (result && result.ok === false) {
      setError(result.error || "Unable to delete SSH target.");
    } else if (editingId === id) {
      setEditingId(null);
    }
  }, [editingId, onDelete, pendingDeleteId]);

  const openImport = useCallback(async () => {
    setError("");
    setImporting(true);
    try {
      const profiles = await listSshProfiles();
      setImportChoices(profiles);
      if (!profiles.length) {
        setError("No saved SSH client profiles to import.");
      }
    } catch (_error) {
      setError("Unable to load SSH client profiles.");
    } finally {
      setImporting(false);
    }
  }, []);

  const chooseImport = useCallback((profile) => {
    setImportChoices(null);
    setEditingId(null);
    setPrefill({
      name: profile.name || "",
      host: profile.host || "",
      port: profile.port,
      username: profile.username || "",
      auth_method: profile.auth_method,
      key_path: profile.key_path || "",
      certificate_path: profile.certificate_path || "",
      // hasSecret intentionally false: device secrets are not copied — the
      // user re-enters the password here so it lands in the vault.
      has_secret: false,
    });
    setCreating(true);
  }, []);

  return (
    <SshFormCard as="div">
      <SshFormHeading>
        <strong>SSH targets</strong>
        <SshClientTag>{targets.length}</SshClientTag>
      </SshFormHeading>

      <SshMessage data-tone="info">
        {scope === "global"
          ? "Saved here, these targets (and the rest of the global MCP defaults) are copied into each new workspace on first open. Coding agents can only use a target after you turn on Agent access for it."
          : "Coding agents can SSH into a target only after you turn on Agent access for it. Key-based and agent targets carry no secret. A password target is only usable by the agent if you also turn on Reveal password (which lets the agent read the password) — prefer key-based targets for untrusted agents."}
      </SshMessage>

      {error && <SshMessage data-tone="error">{error}</SshMessage>}

      {targets.length === 0 && !creating && (
        <SshEmptyState>
          <strong>No SSH targets</strong>
          <span>Add a connection agents can use through the Secrets MCP.</span>
        </SshEmptyState>
      )}

      {targets.length > 0 && (
        <SshClientList>
          {targets.map((target) => (
            editingId === target.id ? (
              <SshFormCard key={target.id}>
                <SshFormHeading>
                  <strong>Edit {target.name}</strong>
                </SshFormHeading>
                <SshClientForm
                  busy={busy}
                  onCancel={closeForms}
                  onSave={(form) => handleSaveEdit(target, form)}
                  profile={targetToFormProfile(target)}
                />
              </SshFormCard>
            ) : (
              <SshClientRow key={target.id}>
                <div style={{ display: "grid", gap: 2, minWidth: 0, flex: "1 1 auto" }}>
                  <SshClientName>{target.name}</SshClientName>
                  <SshClientMeta title={`${describeSshProfile(target)} · ${sshAuthMethodLabel(target.auth_method)}`}>
                    {describeSshProfile(target)}
                  </SshClientMeta>
                </div>
                <SshClientTag>{authTagLabel(target)}</SshClientTag>
                <SshClientRowActions>
                  <SshInlineButton
                    aria-pressed={target.agent_enabled ? "true" : "false"}
                    data-variant={target.agent_enabled ? "primary" : undefined}
                    disabled={busy}
                    onClick={() => flipFlag(target, { agentEnabled: !target.agent_enabled })}
                    title={target.agent_enabled ? "Agent access on — click to disable" : "Enable agent access"}
                    type="button"
                  >
                    {target.agent_enabled ? "Agent: on" : "Agent: off"}
                  </SshInlineButton>
                  {target.auth_method === SSH_AUTH_PASSWORD && (
                    <SshInlineButton
                      aria-pressed={target.reveal_password ? "true" : "false"}
                      disabled={busy || !target.agent_enabled}
                      onClick={() => flipFlag(target, { revealPassword: !target.reveal_password })}
                      title={
                        !target.agent_enabled
                          ? "Enable agent access first"
                          : target.reveal_password
                            ? "Agent can read the raw password and use this target — click to revoke"
                            : "Required for agents to use a password target: lets the agent read the raw password"
                      }
                      type="button"
                    >
                      {target.reveal_password ? "Reveal pw: on" : "Reveal pw: off"}
                    </SshInlineButton>
                  )}
                  <SshInlineButton disabled={busy} onClick={() => beginEdit(target.id)} type="button">
                    Edit
                  </SshInlineButton>
                  <SshInlineButton
                    data-variant="danger"
                    disabled={busy}
                    onClick={() => handleDelete(target.id)}
                    title={pendingDeleteId === target.id ? "Click again to confirm" : "Delete target"}
                    type="button"
                  >
                    {pendingDeleteId === target.id ? "Confirm" : "Delete"}
                  </SshInlineButton>
                </SshClientRowActions>
              </SshClientRow>
            )
          ))}
        </SshClientList>
      )}

      {importChoices && importChoices.length > 0 && (
        <SshFormCard>
          <SshFormHeading>
            <strong>Import from SSH client profiles</strong>
            <SshInlineButton disabled={busy} onClick={() => setImportChoices(null)} type="button">
              Cancel
            </SshInlineButton>
          </SshFormHeading>
          <SshClientList>
            {importChoices.map((profile) => (
              <SshClientRow key={profile.id}>
                <div style={{ display: "grid", gap: 2, minWidth: 0, flex: "1 1 auto" }}>
                  <SshClientName>{profile.name}</SshClientName>
                  <SshClientMeta>{describeSshProfile(profile)}</SshClientMeta>
                </div>
                <SshInlineButton disabled={busy} onClick={() => chooseImport(profile)} type="button">
                  Use
                </SshInlineButton>
              </SshClientRow>
            ))}
          </SshClientList>
        </SshFormCard>
      )}

      {creating ? (
        <SshFormCard>
          <SshFormHeading>
            <strong>New SSH target</strong>
          </SshFormHeading>
          <SshClientForm
            busy={busy}
            onCancel={closeForms}
            onSave={handleSaveNew}
            profile={prefill}
            submitLabel="Add target"
          />
        </SshFormCard>
      ) : (
        <SshClientRowActions>
          <SshInlineButton data-variant="primary" disabled={busy} onClick={beginCreate} type="button">
            Add SSH target
          </SshInlineButton>
          <SshInlineButton disabled={busy || importing} onClick={openImport} type="button">
            {importing ? "Loading…" : "Import from my profiles"}
          </SshInlineButton>
        </SshClientRowActions>
      )}
    </SshFormCard>
  );
}
