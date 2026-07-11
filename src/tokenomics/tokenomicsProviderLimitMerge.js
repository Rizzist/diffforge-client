import { rowProviderAccountKey } from "./tokenomicsFormat.js";

function limitNumberOrNull(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseLimitTimestamp(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (/^resets\s+/i.test(text) && !/^resets\s+in\b/i.test(text)) {
    return parseLimitTimestamp(text.replace(/^resets\s+/i, ""));
  }
  if (text.startsWith("unix:")) {
    const unixSeconds = Number(text.slice(5));
    if (Number.isFinite(unixSeconds) && unixSeconds > 0) {
      return new Date(unixSeconds * 1000);
    }
  }
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return new Date(number < 1_000_000_000_000 ? number * 1000 : number);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function limitTimestampMs(row = {}) {
  return parseLimitTimestamp(
    row.sample_at ?? row.sample_observed_at ?? row.limit_observed_at ?? row.updated_at ?? row.last_known_at,
  )?.getTime() || 0;
}

function providerKey(row = {}) {
  const agent = String(row?.agent_kind || "").toLowerCase();
  const provider = String(row?.provider || "").toLowerCase();
  if (agent.includes("codex") || provider.includes("openai") || provider.includes("codex")) return "codex";
  if (agent.includes("claude") || provider.includes("anthropic") || provider.includes("claude")) return "claude";
  if (agent.includes("opencode") || provider.includes("opencode")) return "opencode";
  return provider || agent || "agent";
}

function rowDeviceId(row = {}) {
  return String(row?.device_id || row?.machine_id || "").trim();
}

function rowScopeKey(row = {}) {
  const explicit = String(row?.billing_scope_key || "").trim();
  if (explicit) return explicit;
  const type = String(row?.billing_scope_type || row?.scope_type || "").trim().toLowerCase();
  const teamId = String(row?.billing_team_id || row?.team_id || "").trim();
  if (type === "team" || teamId) return teamId ? `team:${teamId}` : "team";
  if (type === "personal") return "personal";
  return "unknown";
}

function normalizedLimitWindowKind(kind) {
  const clean = String(kind || "").trim().toLowerCase();
  if (["session_5h", "5-hour", "5h", "five_hour", "five-hour"].includes(clean)) return "5_hour";
  return clean;
}

function hasKnownLimitPercent(limit = {}) {
  return limitNumberOrNull(
    limit.remaining_percent,
    limit.used_percent,
    limit.limit_used_percent,
  ) != null;
}

function providerLimitAuthorityKey(row = {}, selectedDeviceId = "all") {
  const devicePart = selectedDeviceId === "all" ? "account" : (rowDeviceId(row) || "unknown-device");
  return [
    rowScopeKey(row),
    devicePart,
    providerKey(row),
    rowProviderAccountKey(row),
    normalizedLimitWindowKind(row?.window_kind || row?.limit_kind || "provider_limit"),
  ].join("::");
}

export function providerLimitKey(row = {}) {
  return [
    rowScopeKey(row),
    rowDeviceId(row) || "unknown-device",
    providerKey(row),
    rowProviderAccountKey(row),
    normalizedLimitWindowKind(row?.window_kind || row?.limit_kind || "provider_limit"),
  ].join("::");
}

export function providerLimitSampleKey(row = {}) {
  return [
    rowScopeKey(row),
    rowDeviceId(row) || "unknown-device",
    providerKey(row),
    rowProviderAccountKey(row),
    normalizedLimitWindowKind(row?.window_kind || row?.limit_kind || "provider_limit"),
    String(row?.sample_bucket_start || row?.bucket_start || ""),
  ].join("::");
}

function providerLimitSourceRank(row = {}) {
  const sourceKind = String(row?.limit_source_kind || "").toLowerCase();
  const source = String(row?.limit_source || "").toLowerCase();
  const confidence = String(row?.confidence || "").toLowerCase();
  if (sourceKind.includes("cloud") || source === "cloud") return 1;
  if (confidence === "live" || source.includes("usage_api") || source.includes("statusline")) return 3;
  if (confidence === "sampled_stale" || source.includes("sample")) return 2;
  return 1;
}

function providerLimitIsUnknown(row = {}) {
  const source = String(row?.limit_source || "").toLowerCase();
  const confidence = String(row?.confidence || "").toLowerCase();
  const status = String(row?.status_label || "").toLowerCase();
  const hasPercent = hasKnownLimitPercent(row);
  return source === "not_exposed"
    || source === "claude_statusline_unavailable"
    || confidence === "unknown"
    || status.includes("not exposed")
    || status.includes("unavailable")
    || (!hasPercent && row?.allowance == null && row?.used == null);
}

function shouldReplaceProviderLimit(existing = {}, incoming = {}) {
  const incomingMs = limitTimestampMs(incoming);
  const existingMs = limitTimestampMs(existing);
  const existingUnknown = providerLimitIsUnknown(existing);
  const incomingUnknown = providerLimitIsUnknown(incoming);
  if (existingUnknown && !incomingUnknown) return true;
  if (!existingUnknown && incomingUnknown) return false;
  if (incomingMs !== existingMs) return incomingMs > existingMs;
  return providerLimitSourceRank(incoming) >= providerLimitSourceRank(existing);
}

export function mergeProviderLimitRowsForDisplay(rows, selectedDeviceId = "all") {
  const merged = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = providerLimitAuthorityKey(row, selectedDeviceId);
    const existing = merged.get(key);
    if (!existing || shouldReplaceProviderLimit(existing, row)) {
      merged.set(key, row);
    }
  });
  return [...merged.values()];
}

export function mergeProviderLimits(previousLimits, nextLimits) {
  const previousRows = Array.isArray(previousLimits) ? previousLimits : [];
  if (!Array.isArray(nextLimits)) return previousRows;

  const merged = new Map();
  previousRows.forEach((row) => merged.set(providerLimitKey(row), row));
  nextLimits.forEach((row) => {
    const key = providerLimitKey(row);
    const existing = merged.get(key);
    if (!existing || shouldReplaceProviderLimit(existing, row)) {
      merged.set(key, row);
    }
  });
  return [...merged.values()];
}

export function mergeProviderLimitSamples(previousSamples, nextSamples) {
  const previousRows = Array.isArray(previousSamples) ? previousSamples : [];
  if (!Array.isArray(nextSamples)) return previousRows;

  const merged = new Map();
  previousRows.forEach((row) => merged.set(providerLimitSampleKey(row), row));
  nextSamples.forEach((row) => {
    const key = providerLimitSampleKey(row);
    const existing = merged.get(key);
    if (!existing || limitTimestampMs(row) >= limitTimestampMs(existing)) {
      merged.set(key, row);
    }
  });
  return [...merged.values()];
}
