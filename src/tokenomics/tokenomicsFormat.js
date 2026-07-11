export function numeric(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number != null) return number;
  }
  return null;
}

function maxFiniteNumber(...values) {
  const numbers = values
    .map(finiteNumber)
    .filter((value) => value != null);
  return numbers.length ? Math.max(...numbers) : null;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function textValue(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function objectHasAny(value, keys = []) {
  const object = plainObject(value);
  if (!object) return false;
  return keys.some((key) => object[key] != null && object[key] !== "");
}

export function formatInteger(value) {
  const rounded = Math.round(numeric(value));
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function formatCredits(value) {
  const number = numeric(value);
  if (!Number.isFinite(number)) return "0";
  return formatInteger(number);
}

function trimDecimal(value, digits) {
  return value
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatCompact(value, units) {
  const number = numeric(value);
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  const unit = units.find((candidate) => absolute >= candidate.value);
  if (!unit) return `${sign}${formatInteger(absolute)}`;
  const scaled = absolute / unit.value;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${sign}${trimDecimal(scaled, digits)}${unit.suffix}`;
}

export function formatTokens(value) {
  const number = numeric(value);
  if (number <= 0) return "0";
  return formatCompact(number, [
    { value: 1_000_000_000_000, suffix: "T" },
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" },
  ]);
}

export function formatTokenTitle(value) {
  return `${formatInteger(value)} tokens`;
}

export function formatCost(microusd) {
  const value = numeric(microusd) / 1_000_000;
  if (value <= 0) return "$0.00";
  if (value >= 10) return `$${formatInteger(value)}`;
  return `$${value.toFixed(2)}`;
}

export function formatCostTitle(microusd) {
  const value = numeric(microusd) / 1_000_000;
  if (value <= 0) return "$0.00";
  if (value >= 10) return `$${formatInteger(value)}`;
  return `$${value.toFixed(2)}`;
}

export function paceMultiplierFromDelta(paceDeltaPercent) {
  const delta = finiteNumber(paceDeltaPercent);
  if (delta == null) return null;
  const multiplier = (delta + 100) / 100;
  return Number.isFinite(multiplier) ? Math.max(0, multiplier) : null;
}

export function formatPaceMultiplier(value) {
  const multiplier = finiteNumber(value);
  if (multiplier == null) return "";
  return `${trimDecimal(Math.max(0, multiplier), 2)}x`;
}

export function rowTotal(row) {
  return numeric(row?.total, row?.total_tokens);
}

export function rowInput(row) {
  return numeric(row?.input, row?.input_tokens);
}

export function rowOutput(row) {
  return numeric(row?.output, row?.output_tokens);
}

export function rowCache(row) {
  return numeric(
    row?.cache,
    row?.cache_tokens,
    row?.cacheTokens,
    numeric(row?.cache_read_tokens) + numeric(row?.cache_write_tokens),
  );
}

export function rowCost(row) {
  return numeric(row?.cost, row?.estimated_cost_microusd);
}

export function rowProviderAccountKey(row) {
  return String(
    row?.provider_account_key || row?.subscription_key || "",
  ).trim();
}

export function rowProviderAccountLabel(row) {
  return String(
    row?.provider_account_label || rowProviderAccountKey(row) || "Account",
  ).trim();
}

export function rowActivityTokens(row) {
  const reportedTotal = rowTotal(row);
  const componentTotal = rowInput(row) + rowOutput(row) + rowCache(row);
  return reportedTotal > 0 ? reportedTotal : componentTotal;
}

export function dailyUsageValue(row) {
  return rowActivityTokens(row);
}

export function dailyUsageTitle(row) {
  return `${row.label}: total ${formatTokens(dailyUsageValue(row))} · input ${formatTokens(rowInput(row))} · cache ${formatTokens(rowCache(row))} · output ${formatTokens(rowOutput(row))} · cost ${formatCost(rowCost(row))}`;
}

export function creditSnapshotHasMeaningfulData(credits) {
  const object = plainObject(credits);
  if (!object) return false;
  const term = plainObject(object.term);
  const total = plainObject(object.total) || plainObject(object.total_credits);
  return Boolean(
    object.known === true
      || object.live === true
      || textValue(object.plan_name)
      || textValue(term?.plan_name || term?.id)
      || objectHasAny(object, [
        "term_total_credits",
        "total_credits",
        "term_remaining_credits",
        "remaining_credits",
        "term_reserved_credits",
        "reserved_credits",
        "term_used_credits",
        "used_credits",
        "local_metered_used_credits",
      ])
      || objectHasAny(total, [
        "total_credits",
        "remaining_credits",
        "reserved_credits",
        "used_credits",
      ])
      || objectHasAny(term, [
        "total_credits",
        "remaining_credits",
        "reserved_credits",
        "used_credits",
      ])
  );
}

export function normalizeCreditWallet(wallet, previous = null, options = {}) {
  const credits = plainObject(wallet?.credits) || plainObject(wallet?.wallet) || plainObject(wallet) || {};
  const previousCredits = creditSnapshotHasMeaningfulData(previous) ? previous : {};
  if (!creditSnapshotHasMeaningfulData(credits)) {
    return creditSnapshotHasMeaningfulData(previousCredits) ? previousCredits : null;
  }
  const preferIncoming = Boolean(options?.preferIncoming || options?.preferIncomingTotals);

  const total = plainObject(credits.total) || plainObject(credits.total_credits) || {};
  const term = plainObject(credits.term) || {};
  const termId = textValue(term.id || credits.term_id, "");
  const rawTermEnd = textValue(term.term_end || credits.reset_at, "");
  const previousTermId = textValue(previousCredits.term_id, "");
  const previousTermEnd = textValue(previousCredits.term_end || previousCredits.reset_at, "");
  const incomingPlanToken = textValue(
    credits.plan_name || credits.plan_status || credits.status,
  ).toLowerCase();
  const previousPlanToken = textValue(
    previousCredits.plan_name || previousCredits.plan_status || previousCredits.status,
  ).toLowerCase();
  const explicitFreeReset = incomingPlanToken === "free" && previousPlanToken && previousPlanToken !== "free";
  const sameTerm = !explicitFreeReset && (termId && previousTermId
    ? termId === previousTermId
    : rawTermEnd && previousTermEnd
      ? rawTermEnd === previousTermEnd
      : true);
  const sameTermPreviousCredits = sameTerm && !preferIncoming ? previousCredits : {};
  const used = maxFiniteNumber(
    total.used_credits,
    credits.term_used_credits,
    credits.used_credits,
    term.used_credits,
    credits.local_metered_used_credits,
    sameTermPreviousCredits.term_used_credits,
  ) ?? 0;
  const reserved = firstFiniteNumber(
    total.reserved_credits,
    credits.term_reserved_credits,
    credits.reserved_credits,
    term.reserved_credits,
    sameTermPreviousCredits.term_reserved_credits,
  ) ?? 0;
  const totalCredits = maxFiniteNumber(
    total.total_credits,
    credits.term_total_credits,
    credits.total_credits,
    term.total_credits,
    sameTermPreviousCredits.term_total_credits,
  ) ?? 0;
  const directRemaining = firstFiniteNumber(
    total.remaining_credits,
    credits.term_remaining_credits,
    credits.remaining_credits,
    term.remaining_credits,
    sameTermPreviousCredits.term_remaining_credits,
  );
  const computedRemaining = totalCredits > 0 ? Math.max(0, totalCredits - used - reserved) : null;
  const remaining = directRemaining != null && directRemaining > 0
    ? directRemaining
    : computedRemaining ?? directRemaining ?? 0;
  const termEnd = rawTermEnd || (sameTerm ? previousCredits.reset_at || previousCredits.term_end || "" : "");

  return {
    ...previousCredits,
    ...credits,
    known: credits.known ?? previousCredits.known ?? true,
    live: credits.live ?? previousCredits.live ?? true,
    source: textValue(credits.source, previousCredits.source || "diff_forge_hot_credit_wallet"),
    wallet_version: firstFiniteNumber(credits.wallet_version, previousCredits.wallet_version) ?? 0,
    pending_event_count: firstFiniteNumber(credits.pending_event_count, previousCredits.pending_event_count) ?? 0,
    plan_name: textValue(credits.plan_name || term.plan_name, previousCredits.plan_name || ""),
    reset_at: termEnd || null,
    term_end: termEnd || null,
    term_id: termId || previousCredits.term_id || "",
    term_remaining_credits: remaining,
    term_reserved_credits: reserved,
    term_total_credits: totalCredits,
    term_used_credits: used,
    provider_cost_microusd: firstFiniteNumber(total.provider_cost_microusd, credits.provider_cost_microusd, previousCredits.provider_cost_microusd) ?? 0,
    input_tokens: firstFiniteNumber(total.input_tokens, credits.input_tokens, previousCredits.input_tokens) ?? 0,
    cached_input_tokens: firstFiniteNumber(total.cached_input_tokens, credits.cached_input_tokens, previousCredits.cached_input_tokens) ?? 0,
    output_tokens: firstFiniteNumber(total.output_tokens, credits.output_tokens, previousCredits.output_tokens) ?? 0,
    audio_seconds: firstFiniteNumber(total.audio_seconds, credits.audio_seconds, previousCredits.audio_seconds) ?? 0,
    tts_characters: firstFiniteNumber(total.tts_characters, credits.tts_characters, previousCredits.tts_characters) ?? 0,
    web_search_calls: firstFiniteNumber(total.web_search_calls, credits.web_search_calls, previousCredits.web_search_calls) ?? 0,
    event_count: firstFiniteNumber(total.event_count, credits.event_count, previousCredits.event_count) ?? 0,
    updated_at: textValue(credits.updated_at, new Date().toISOString()),
  };
}

export function creditRemainingWithReserved(credits) {
  return numeric(credits?.term_remaining_credits) + numeric(credits?.term_reserved_credits);
}
