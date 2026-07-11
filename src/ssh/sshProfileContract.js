import { invoke } from "@tauri-apps/api/core";

// Shared contract between the SSH client UI and the Rust backend
// (src-tauri/src/ssh_profiles.rs). Keep the auth-method ids and invoke
// shapes in lockstep with the backend commands.

export const SSH_AUTH_AGENT = "agent";
export const SSH_AUTH_PASSWORD = "password";
export const SSH_AUTH_KEY = "key";

export const SSH_AUTH_METHODS = Object.freeze([
  {
    id: SSH_AUTH_AGENT,
    label: "SSH agent / default keys",
    detail: "Use your running ssh-agent or the default identity files.",
  },
  {
    id: SSH_AUTH_PASSWORD,
    label: "Password",
    detail: "Diff Forge fills the password when the host prompts for it.",
  },
  {
    id: SSH_AUTH_KEY,
    label: "Private key",
    detail: "Point at a key file, with an optional signed certificate.",
  },
]);

export const SSH_DEFAULT_PORT = 22;

export function isSshAuthMethod(value) {
  return value === SSH_AUTH_AGENT || value === SSH_AUTH_PASSWORD || value === SSH_AUTH_KEY;
}

export function sshAuthMethodLabel(value) {
  const match = SSH_AUTH_METHODS.find((method) => method.id === value);
  return match ? match.label : "SSH agent / default keys";
}

// Normalize the free-form form fields into the backend save request. Returns
// { request } on success or { error } with a human-facing validation message.
export function buildSshSaveRequest(form = {}) {
  const name = String(form.name || "").trim();
  const host = String(form.host || "").trim();
  const username = String(form.username || "").trim();
  const authMethod = isSshAuthMethod(form.auth_method) ? form.auth_method : SSH_AUTH_AGENT;
  const keyPath = String(form.key_path || "").trim();
  const certificatePath = String(form.certificate_path || "").trim();
  const portRaw = String(form.port ?? "").trim();

  if (!name) {
    return { error: "Give this client a name." };
  }
  if (!host) {
    return { error: "Enter a host or IP address." };
  }
  if (/\s/.test(host)) {
    return { error: "Host cannot contain spaces." };
  }

  let port = null;
  if (portRaw) {
    const parsed = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return { error: "Port must be between 1 and 65535." };
    }
    port = parsed;
  }

  if (authMethod === SSH_AUTH_KEY && !keyPath) {
    return { error: "Choose a private key file for key authentication." };
  }

  const request = {
    id: form.id ? String(form.id) : null,
    name,
    host,
    port,
    username: username || null,
    auth_method: authMethod,
    key_path: authMethod === SSH_AUTH_KEY ? keyPath : null,
    certificate_path: authMethod === SSH_AUTH_KEY && certificatePath ? certificatePath : null,
    // secret handling: undefined field => omit so the backend keeps the
    // existing secret. A caller that wants to set/clear passes secret
    // explicitly (string, or "" to clear).
  };

  if (Object.prototype.hasOwnProperty.call(form, "secret")) {
    // Only send when the caller deliberately touched the password field.
    request.secret = form.secret == null ? "" : String(form.secret);
  }

  return { request };
}

export async function listSshProfiles() {
  const result = await invoke("ssh_profiles_list");
  const profiles = Array.isArray(result?.profiles) ? result.profiles : [];
  return profiles;
}

export async function saveSshProfile(request) {
  return invoke("ssh_profile_save", { request });
}

export async function deleteSshProfile(profileId) {
  return invoke("ssh_profile_delete", { profile_id: String(profileId || "") });
}

export async function connectTerminalSsh(paneId, profileId) {
  return invoke("terminal_ssh_connect", {
    pane_id: String(paneId || ""),
    profile_id: String(profileId || ""),
  });
}

// Compact "user@host:port" descriptor for list rows and tooltips.
export function describeSshProfile(profile = {}) {
  const host = String(profile.host || "").trim();
  if (!host) {
    return "";
  }
  const username = String(profile.username || "").trim();
  const port = Number.parseInt(profile.port, 10);
  const base = username ? `${username}@${host}` : host;
  return Number.isInteger(port) && port !== SSH_DEFAULT_PORT ? `${base}:${port}` : base;
}
