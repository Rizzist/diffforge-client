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

function providerLimitCrossScopeKey(row = {}, selectedDeviceId = "all") {
  const devicePart = selectedDeviceId === "all" ? "account" : (rowDeviceId(row) || "unknown-device");
  return [
    devicePart,
    providerKey(row),
    rowProviderAccountKey(row),
    normalizedLimitWindowKind(row?.window_kind || row?.limit_kind || "provider_limit"),
  ].join("::");
}

function formatLimitResetDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

function providerLimitResetDate(row = {}) {
  const direct = parseLimitTimestamp(row.reset_at ?? row.limit_resets_at);
  if (direct) return direct;
  const resetAfterSeconds = limitNumberOrNull(row.reset_after_seconds);
  const observedAt = parseLimitTimestamp(
    row.limit_observed_at ?? row.sample_observed_at ?? row.updated_at ?? row.last_known_at,
  );
  if (resetAfterSeconds == null || !observedAt) return null;
  return new Date(observedAt.getTime() + Math.max(0, resetAfterSeconds) * 1000);
}

export function projectProviderLimitForDisplay(row = {}, nowMs = Date.now()) {
  const resetDate = providerLimitResetDate(row);
  if (!resetDate || !hasKnownLimitPercent(row)) return row;
  const secondsUntilReset = Math.round((resetDate.getTime() - nowMs) / 1000);
  if (secondsUntilReset > 0) {
    return {
      ...row,
      reset_after_seconds: secondsUntilReset,
      reset_label: `Resets in ${formatLimitResetDuration(secondsUntilReset)}`,
    };
  }
  // The provider window has ended: until the next live sample proves
  // otherwise, assume the window rolled over fresh (visual only — raw
  // counters stay untouched). Keeping the stale mid-window percentage reads
  // as "still capped", which is the wrong default for an expired window.
  // Pace belongs to the window it was measured in: the dead window's
  // over-pace verdict ("▲549% — will exhaust before reset") next to an
  // assumed-fresh 100% is a contradiction, so every pace field resets with
  // the percents. The fresh window has no observed usage yet — its pace is
  // unknown, not red.
  const displayKind = String(row.display_percent_kind || "").toLowerCase();
  return {
    ...row,
    remaining_percent: 100,
    used_percent: 0,
    limit_used_percent: 0,
    ...(row.display_percent != null
      ? { display_percent: displayKind === "used" ? 0 : 100 }
      : {}),
    reset_after_seconds: 0,
    reset_label: "Provider window ended; assuming 100% until live refresh",
    pace_status: "unknown",
    pace_delta_percent: null,
    pace_exhausts_before_reset: false,
    status_label: "",
    client_reset_pending: true,
  };
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
  const inputRows = Array.isArray(rows) ? rows : [];
  const canonicalScopeKeys = new Set(
    inputRows
      .filter((row) => rowScopeKey(row) !== "unknown")
      .map((row) => providerLimitCrossScopeKey(row, selectedDeviceId)),
  );
  const merged = new Map();
  inputRows.forEach((row) => {
    // Legacy rows were persisted before billing scope was known. Once the
    // same account/window has a canonical scope, the unknown row is only a
    // stale alias and must not participate in display aggregation.
    if (
      rowScopeKey(row) === "unknown"
      && canonicalScopeKeys.has(providerLimitCrossScopeKey(row, selectedDeviceId))
    ) {
      return;
    }
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
