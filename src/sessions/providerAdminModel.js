import { capabilityUnavailableFromError } from "./capabilityModel.js";

/* Pure provider-management projections. The provider list remains the
   authority: mutations can publish receipts, but they never become rows.
   Security facts are fail-closed and CAS revisions cross this boundary
   character-for-character without arithmetic, parsing, or defaults. */

const KNOWN_API_FAMILIES = new Set([
  "anthropic_messages",
  "openai_responses",
  "openai_chat_completions",
  "gemini_generate_content",
]);
const KNOWN_AUTH_REQUIREMENTS = new Set(["api_key", "o_auth", "none"]);
const KNOWN_AVAILABILITY = new Set(["available", "unavailable"]);
const KNOWN_LOCKDOWN_ACTIVATIONS = new Set([
  "configured",
  "auto_hermetic",
  "auto_hermetic_eligible",
]);

function owns(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function published(value, key) {
  return owns(value, key) && value[key] != null ? value[key] : undefined;
}

function inputField(fields, camelKey, wireKey = camelKey) {
  if (owns(fields, camelKey) && fields[camelKey] != null) return fields[camelKey];
  if (wireKey !== camelKey && owns(fields, wireKey) && fields[wireKey] != null) {
    return fields[wireKey];
  }
  return undefined;
}

function categoryView(raw, knownValues, absentLabel = "not published") {
  if (typeof raw !== "string") {
    return {
      kind: "absent",
      raw: null,
      label: absentLabel,
      recognized: false,
    };
  }
  if (knownValues.has(raw)) {
    return { kind: "known", raw, label: raw, recognized: true };
  }
  return {
    kind: "unknown",
    raw,
    label: `${raw} (unrecognized)`,
    recognized: false,
  };
}

function trustView(raw) {
  if (raw === "full") {
    return {
      kind: "full",
      raw,
      label: "Full trust",
      recognized: true,
      fullTrust: true,
    };
  }
  if (raw === "lockdown") {
    return {
      kind: "lockdown",
      raw,
      label: "Lockdown",
      recognized: true,
      fullTrust: false,
    };
  }
  if (typeof raw === "string") {
    return {
      kind: "unknown",
      raw,
      label: `${raw} (unrecognized; not full trust)`,
      recognized: false,
      fullTrust: false,
    };
  }
  return {
    kind: "absent",
    raw: null,
    label: "Trust not published (not full trust)",
    recognized: false,
    fullTrust: false,
  };
}

/* ProviderSummaryV1 calls the published network field `endpoint`, while
   create configuration calls the write-once input `origin`. Both are
   represented as `origin` to the management panel without manufacturing a
   value. The list-level revision is attached to every row exactly as read. */
export function providerRowView(row, listRevision = undefined) {
  const origin = owns(row, "origin") ? stringOrNull(row.origin) : stringOrNull(row?.endpoint);
  const revision = listRevision === undefined ? published(row, "revision") : listRevision;
  return {
    name: stringOrNull(row?.provider) ?? stringOrNull(row?.name),
    origin,
    apiFamily: categoryView(row?.api_family, KNOWN_API_FAMILIES),
    authRequirement: categoryView(row?.auth_requirement, KNOWN_AUTH_REQUIREMENTS),
    enabled: typeof row?.enabled === "boolean" ? row.enabled : null,
    models: Array.isArray(row?.models)
      ? row.models.filter((model) => typeof model === "string")
      : null,
    defaultModel: stringOrNull(row?.default_model),
    responseOpenTimeoutMs: published(row, "response_open_timeout_ms"),
    chunkIdleTimeoutMs: published(row, "chunk_idle_timeout_ms"),
    semanticProgressTimeoutMs: published(row, "semantic_progress_timeout_ms"),
    availability: categoryView(row?.availability, KNOWN_AVAILABILITY),
    availabilityReason: stringOrNull(row?.availability_reason),
    trust: trustView(row?.trust),
    revision,
  };
}

/* Build the exact Tauri argument object. Presence means “set”; absence means
   “preserve”. api_family and origin are identity fields and are ignored for
   updates even if a caller accidentally supplies them. */
export function configureArgs(mode, fields = {}) {
  const args = {
    provider: inputField(fields, "provider"),
    enabled: inputField(fields, "enabled"),
    models: inputField(fields, "models"),
  };
  const expectedRevision = inputField(fields, "expectedRevision", "expected_revision");
  if (expectedRevision !== undefined) args.expected_revision = expectedRevision;

  if (mode === "create") {
    const apiFamily = inputField(fields, "apiFamily", "api_family");
    const origin = inputField(fields, "origin");
    if (apiFamily !== undefined) args.api_family = apiFamily;
    if (origin !== undefined) args.origin = origin;
  }

  for (const [camelKey, wireKey] of [
    ["authRequirement", "auth_requirement"],
    ["defaultModel", "default_model"],
    ["responseOpenTimeoutMs", "response_open_timeout_ms"],
    ["chunkIdleTimeoutMs", "chunk_idle_timeout_ms"],
    ["semanticProgressTimeoutMs", "semantic_progress_timeout_ms"],
    ["probeVaultReference", "probe_vault_reference"],
    ["trust", "trust"],
  ]) {
    const value = inputField(fields, camelKey, wireKey);
    if (value !== undefined) args[wireKey] = value;
  }
  return args;
}

/* A fence exists only when a provider-list row actually carries one. */
export function fenceFor(row) {
  return published(row, "revision");
}

/* Provider conflicts are typed under error.data. Top-level coordinates are
   intentionally ignored so a wrapper cannot silently replace daemon facts. */
export function conflictView(error) {
  const data = error?.data && typeof error.data === "object" ? error.data : null;
  const direct = error && typeof error === "object" ? error : null;
  const source = data?.kind === "revision_conflict"
    ? data
    : direct?.kind === "revision_conflict" ? direct : null;
  const message = String(error?.message ?? error ?? "");
  if (!source && error?.code !== "revision_conflict" && !/revision[_ -]conflict/i.test(message)) {
    return null;
  }
  return {
    kind: "revision_conflict",
    expectedRevision: published(source, "expected_revision"),
    currentRevision: published(source, "current_revision"),
    raw: error ?? null,
  };
}

/* Lockdown is shown only from lockdown.status / lockdown.set_quota output.
   An absent activation is unknown, and absent quotas remain absent rather
   than becoming a permissive state or a fabricated zero. */
export function lockdownView(status) {
  return {
    provider: stringOrNull(status?.provider),
    activation: categoryView(status?.activation, KNOWN_LOCKDOWN_ACTIVATIONS),
    reason: stringOrNull(status?.reason),
    toolsAllowed: Array.isArray(status?.tools_allowed) ? status.tools_allowed : undefined,
    quotaUsed: published(status, "quota_used"),
    quotaLimit: published(status, "quota_limit"),
  };
}

export function providerAdminUnavailableFromError(error) {
  return capabilityUnavailableFromError(error);
}
