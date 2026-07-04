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
  return numeric(row?.total, row?.total_tokens, row?.totalTokens);
}

export function rowInput(row) {
  return numeric(row?.input, row?.input_tokens, row?.inputTokens);
}

export function rowOutput(row) {
  return numeric(row?.output, row?.output_tokens, row?.outputTokens);
}

export function rowCache(row) {
  return numeric(
    row?.cache,
    row?.cache_tokens,
    row?.cacheTokens,
    numeric(row?.cache_read_tokens, row?.cacheReadTokens) + numeric(row?.cache_write_tokens, row?.cacheWriteTokens),
  );
}

export function rowCost(row) {
  return numeric(row?.cost, row?.estimated_cost_microusd, row?.estimatedCostMicrousd);
}

export function rowProviderAccountKey(row) {
  return String(
    row?.provider_account_key
      || row?.providerAccountKey
      || row?.subscription_key
      || row?.subscriptionKey
      || "",
  ).trim();
}

export function rowProviderAccountLabel(row) {
  return String(
    row?.provider_account_label
      || row?.providerAccountLabel
      || rowProviderAccountKey(row)
      || "Account",
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
  const total = plainObject(object.total) || plainObject(object.totalCredits);
  return Boolean(
    object.known === true
      || object.live === true
      || textValue(object.planName || object.plan_name)
      || textValue(term?.plan_name || term?.planName || term?.id)
      || objectHasAny(object, [
        "termTotalCredits",
        "term_total_credits",
        "totalCredits",
        "total_credits",
        "termRemainingCredits",
        "term_remaining_credits",
        "remainingCredits",
        "remaining_credits",
        "termReservedCredits",
        "term_reserved_credits",
        "reservedCredits",
        "reserved_credits",
        "termUsedCredits",
        "term_used_credits",
        "usedCredits",
        "used_credits",
        "localMeteredUsedCredits",
        "local_metered_used_credits",
      ])
      || objectHasAny(total, [
        "total_credits",
        "totalCredits",
        "remaining_credits",
        "remainingCredits",
        "reserved_credits",
        "reservedCredits",
        "used_credits",
        "usedCredits",
      ])
      || objectHasAny(term, [
        "total_credits",
        "totalCredits",
        "remaining_credits",
        "remainingCredits",
        "reserved_credits",
        "reservedCredits",
        "used_credits",
        "usedCredits",
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

  const total = plainObject(credits.total) || plainObject(credits.totalCredits) || {};
  const term = plainObject(credits.term) || {};
  const termId = textValue(term.id || credits.termId || credits.term_id, "");
  const rawTermEnd = textValue(term.term_end || term.termEnd || credits.resetAt || credits.reset_at, "");
  const previousTermId = textValue(previousCredits.termId, "");
  const previousTermEnd = textValue(previousCredits.termEnd || previousCredits.resetAt, "");
  const incomingPlanToken = textValue(
    credits.planName || credits.plan_name || credits.planStatus || credits.plan_status || credits.status,
  ).toLowerCase();
  const previousPlanToken = textValue(
    previousCredits.planName || previousCredits.plan_name || previousCredits.planStatus || previousCredits.plan_status || previousCredits.status,
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
    total.usedCredits,
    credits.termUsedCredits,
    credits.term_used_credits,
    credits.usedCredits,
    credits.used_credits,
    term.used_credits,
    term.usedCredits,
    credits.localMeteredUsedCredits,
    credits.local_metered_used_credits,
    sameTermPreviousCredits.termUsedCredits,
  ) ?? 0;
  const reserved = firstFiniteNumber(
    total.reserved_credits,
    total.reservedCredits,
    credits.termReservedCredits,
    credits.term_reserved_credits,
    credits.reservedCredits,
    credits.reserved_credits,
    term.reserved_credits,
    term.reservedCredits,
    sameTermPreviousCredits.termReservedCredits,
  ) ?? 0;
  const totalCredits = maxFiniteNumber(
    total.total_credits,
    total.totalCredits,
    credits.termTotalCredits,
    credits.term_total_credits,
    credits.totalCredits,
    credits.total_credits,
    term.total_credits,
    term.totalCredits,
    sameTermPreviousCredits.termTotalCredits,
  ) ?? 0;
  const directRemaining = firstFiniteNumber(
    total.remaining_credits,
    total.remainingCredits,
    credits.termRemainingCredits,
    credits.term_remaining_credits,
    credits.remainingCredits,
    credits.remaining_credits,
    term.remaining_credits,
    term.remainingCredits,
    sameTermPreviousCredits.termRemainingCredits,
  );
  const computedRemaining = totalCredits > 0 ? Math.max(0, totalCredits - used - reserved) : null;
  const remaining = directRemaining != null && directRemaining > 0
    ? directRemaining
    : computedRemaining ?? directRemaining ?? 0;
  const termEnd = rawTermEnd || (sameTerm ? previousCredits.resetAt || previousCredits.termEnd || "" : "");

  return {
    ...previousCredits,
    ...credits,
    known: credits.known ?? previousCredits.known ?? true,
    live: credits.live ?? previousCredits.live ?? true,
    source: textValue(credits.source, previousCredits.source || "diff_forge_hot_credit_wallet"),
    walletVersion: firstFiniteNumber(credits.wallet_version, credits.walletVersion, previousCredits.walletVersion) ?? 0,
    pendingEventCount: firstFiniteNumber(credits.pending_event_count, credits.pendingEventCount, previousCredits.pendingEventCount) ?? 0,
    planName: textValue(credits.planName || credits.plan_name || term.plan_name || term.planName, previousCredits.planName || ""),
    resetAt: termEnd || null,
    termEnd: termEnd || null,
    termId: termId || previousCredits.termId || "",
    termRemainingCredits: remaining,
    termReservedCredits: reserved,
    termTotalCredits: totalCredits,
    termUsedCredits: used,
    providerCostMicrousd: firstFiniteNumber(total.provider_cost_microusd, total.providerCostMicrousd, credits.providerCostMicrousd, credits.provider_cost_microusd, previousCredits.providerCostMicrousd) ?? 0,
    inputTokens: firstFiniteNumber(total.input_tokens, total.inputTokens, credits.inputTokens, credits.input_tokens, previousCredits.inputTokens) ?? 0,
    cachedInputTokens: firstFiniteNumber(total.cached_input_tokens, total.cachedInputTokens, credits.cachedInputTokens, credits.cached_input_tokens, previousCredits.cachedInputTokens) ?? 0,
    outputTokens: firstFiniteNumber(total.output_tokens, total.outputTokens, credits.outputTokens, credits.output_tokens, previousCredits.outputTokens) ?? 0,
    audioSeconds: firstFiniteNumber(total.audio_seconds, total.audioSeconds, credits.audioSeconds, credits.audio_seconds, previousCredits.audioSeconds) ?? 0,
    ttsCharacters: firstFiniteNumber(total.tts_characters, total.ttsCharacters, credits.ttsCharacters, credits.tts_characters, previousCredits.ttsCharacters) ?? 0,
    webSearchCalls: firstFiniteNumber(total.web_search_calls, total.webSearchCalls, credits.webSearchCalls, credits.web_search_calls, previousCredits.webSearchCalls) ?? 0,
    eventCount: firstFiniteNumber(total.event_count, total.eventCount, credits.eventCount, credits.event_count, previousCredits.eventCount) ?? 0,
    updatedAt: textValue(credits.updated_at || credits.updatedAt, new Date().toISOString()),
  };
}

export function creditRemainingWithReserved(credits) {
  return numeric(credits?.termRemainingCredits) + numeric(credits?.termReservedCredits);
}
