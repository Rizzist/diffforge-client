import { invoke } from "@tauri-apps/api/core";

// Shared contract between the Email Delivery settings UI and the Rust
// backend (src-tauri/src/email/ui.rs). Credentials are configured on this
// device only — the dashboard never sees them. Password fields are
// write-only: the backend reports `has_secret`, an untouched save preserves
// the stored secret, and clearing is explicit (`secret: ""`).

export const EMAIL_MODE_PROVIDER = "provider";
export const EMAIL_MODE_NATIVE = "native";

export const EMAIL_SMTP_SECURITY_STARTTLS = "starttls";
export const EMAIL_SMTP_SECURITY_IMPLICIT = "implicit_tls";

export const EMAIL_MODES = Object.freeze([
  {
    id: EMAIL_MODE_PROVIDER,
    label: "Provider SMTP",
    detail: "Submit through your provider (587 STARTTLS or 465 TLS) with an app password.",
  },
  {
    id: EMAIL_MODE_NATIVE,
    label: "Native delivery",
    detail: "Deliver directly to recipient mail servers from this machine (requires qualification).",
  },
]);

// Preflight check ids are a closed 14-entry registry (email-v1 §10.2);
// unknown ids from a newer backend render as raw ids rather than crashing.
export const EMAIL_PREFLIGHT_CHECK_LABELS = Object.freeze({
  public_ip: "Public IP (non-CGNAT)",
  static_ip: "Static IP",
  port25_egress: "Outbound port 25",
  ptr_fcrdns: "Reverse DNS (PTR / FCrDNS)",
  helo_hostname: "EHLO hostname",
  dnsbl_clean: "DNSBL reputation",
  always_on: "Always-on runtime",
  clock_skew: "Clock accuracy",
  journal_health: "Send journal health",
  credential_store: "Credential store",
  spf_published: "SPF record",
  dkim_published: "DKIM record",
  dmarc_published: "DMARC record",
  seed_test: "Seed delivery test",
});

export function isEmailMode(value) {
  return value === EMAIL_MODE_PROVIDER || value === EMAIL_MODE_NATIVE;
}

export function emailModeLabel(value) {
  const match = EMAIL_MODES.find((mode) => mode.id === value);
  return match ? match.label : "Provider SMTP";
}

// Normalize the form fields into the backend save request. Returns
// { request } or { error } with a human-facing message. The `secret` key is
// attached ONLY when the caller deliberately touched the password field —
// its absence tells the backend to keep the stored secret (save-doesn't-
// blank), and an explicit "" clears it.
export function buildEmailProfileSaveRequest(form = {}) {
  const mode = isEmailMode(form.mode) ? form.mode : EMAIL_MODE_PROVIDER;
  const displayName = String(form.display_name || "").trim();
  const fromAddress = String(form.from_address || "").trim();
  const smtpHost = String(form.smtp_host || "").trim();
  const username = String(form.username || "").trim();
  const portRaw = String(form.smtp_port ?? "").trim();

  if (fromAddress && !fromAddress.includes("@")) {
    return { error: "From address must be a full email address." };
  }

  let smtpPort = null;
  if (portRaw) {
    const parsed = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return { error: "SMTP port must be between 1 and 65535." };
    }
    smtpPort = parsed;
  }

  if (mode === EMAIL_MODE_PROVIDER) {
    if (!smtpHost) {
      return { error: "Enter the provider SMTP host." };
    }
    if (/\s/.test(smtpHost)) {
      return { error: "SMTP host cannot contain spaces." };
    }
  }

  // Security derives from the port for the two standard submission ports;
  // any other port needs an explicit choice. Plaintext is never an option.
  let smtpSecurity = form.smtp_security || null;
  if (!smtpSecurity && smtpPort === 465) {
    smtpSecurity = EMAIL_SMTP_SECURITY_IMPLICIT;
  } else if (!smtpSecurity && (smtpPort === 587 || smtpPort == null)) {
    smtpSecurity = EMAIL_SMTP_SECURITY_STARTTLS;
  }
  if (mode === EMAIL_MODE_PROVIDER && !smtpSecurity) {
    return { error: "Pick STARTTLS or implicit TLS for a non-standard port." };
  }

  const request = {
    profile_ref: form.profile_ref ? String(form.profile_ref) : null,
    mode,
    display_name: displayName || null,
    from_address: fromAddress || null,
    smtp_host: mode === EMAIL_MODE_PROVIDER ? smtpHost : null,
    smtp_port: smtpPort,
    smtp_security: mode === EMAIL_MODE_PROVIDER ? smtpSecurity : null,
    username: username || null,
  };

  if (Object.prototype.hasOwnProperty.call(form, "secret")) {
    // Present only when the password field was deliberately touched.
    request.secret = form.secret == null ? "" : String(form.secret);
  }

  return { request };
}

export async function listEmailProfiles() {
  const result = await invoke("email_delivery_profiles_list");
  return Array.isArray(result?.profiles) ? result.profiles : [];
}

export async function saveEmailProfile(request) {
  return invoke("email_delivery_profile_save", { request });
}

export async function deleteEmailProfile(profileRef) {
  return invoke("email_delivery_profile_delete", {
    profile_ref: String(profileRef || ""),
  });
}

export async function probeEmailProfile(profileRef) {
  return invoke("email_delivery_profile_probe", {
    profile_ref: String(profileRef || ""),
  });
}

export async function fetchEmailCapabilitySnapshot() {
  return invoke("email_delivery_capability_snapshot");
}

export async function runLocalEmailPreflight(profileRef, domain) {
  return invoke("email_delivery_preflight_local", {
    profile_ref: String(profileRef || ""),
    domain: String(domain || ""),
  });
}

// Compact descriptor for list rows: "name · host:port" or the from address.
export function describeEmailProfile(profile = {}) {
  const host = String(profile.smtp_host || "").trim();
  const from = String(profile.from_address || "").trim();
  if (profile.mode === EMAIL_MODE_NATIVE) {
    return from ? `Native · ${from}` : "Native delivery";
  }
  if (!host) {
    return from || "Provider SMTP";
  }
  const port = Number.parseInt(profile.smtp_port, 10);
  const endpoint = Number.isInteger(port) ? `${host}:${port}` : host;
  return from ? `${from} via ${endpoint}` : endpoint;
}
