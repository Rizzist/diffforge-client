export function numeric(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function finiteNumber(value) {
  if (value == null || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
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

function aliasedValue(value, canonicalKey, legacyKey) {
  const object = plainObject(value);
  if (!object) return undefined;
  const canonical = object[canonicalKey];
  if (canonical != null && canonical !== "") return canonical;
  return object[legacyKey];
}

function creditPlanName(credits) {
  const object = plainObject(credits) || {};
  const term = plainObject(object.term) || {};
  return textValue(
    aliasedValue(object, "planName", "plan_name")
      || aliasedValue(term, "planName", "plan_name"),
  );
}

export function billingStatusCredits(status) {
  const object = plainObject(status);
  const candidates = [
    plainObject(object?.credits),
    plainObject(object?.wallet),
    plainObject(object?.user?.credits),
  ].filter(Boolean);
  return candidates.find(creditSnapshotHasFiniteTotals)
    || candidates.find(creditSnapshotHasMeaningfulData)
    || candidates[0]
    || null;
}

export function billingStatusPlanName(status) {
  const object = plainObject(status) || {};
  return textValue(
    aliasedValue(object, "planName", "plan_name")
      || creditPlanName(billingStatusCredits(object)),
  );
}

export function billingStatusPlanStatus(status) {
  return textValue(aliasedValue(status, "planStatus", "plan_status"));
}

export function billingStatusUpdatedAt(status) {
  const object = plainObject(status) || {};
  const credits = billingStatusCredits(object) || {};
  return textValue(
    aliasedValue(object, "updatedAt", "updated_at")
      || aliasedValue(credits, "updatedAt", "updated_at"),
  );
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
  const total = plainObject(object.total)
    || plainObject(object.totalCredits)
    || plainObject(object.total_credits);
  return Boolean(
    object.known === true
      || object.live === true
      || creditPlanName(object)
      || textValue(term?.id)
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
        "totalCredits",
        "total_credits",
        "remainingCredits",
        "remaining_credits",
        "reservedCredits",
        "reserved_credits",
        "usedCredits",
        "used_credits",
      ])
      || objectHasAny(term, [
        "totalCredits",
        "total_credits",
        "remainingCredits",
        "remaining_credits",
        "reservedCredits",
        "reserved_credits",
        "usedCredits",
        "used_credits",
      ])
  );
}

// True when the snapshot carries at least one finite credit amount (a genuine
// zero counts). Snapshots that are "meaningful" only through plan metadata or
// known/live flags have no totals to trust, so they must never be allowed to
// replace a baseline's numbers.
export function creditSnapshotHasFiniteTotals(credits) {
  const object = plainObject(credits);
  if (!object) return false;
  const total = plainObject(object.total)
    || plainObject(object.totalCredits)
    || plainObject(object.total_credits)
    || {};
  const term = plainObject(object.term) || {};
  return [
    aliasedValue(total, "totalCredits", "total_credits"),
    aliasedValue(total, "usedCredits", "used_credits"),
    aliasedValue(total, "remainingCredits", "remaining_credits"),
    aliasedValue(total, "reservedCredits", "reserved_credits"),
    aliasedValue(term, "totalCredits", "total_credits"),
    aliasedValue(term, "usedCredits", "used_credits"),
    aliasedValue(term, "remainingCredits", "remaining_credits"),
    aliasedValue(term, "reservedCredits", "reserved_credits"),
    aliasedValue(object, "termTotalCredits", "term_total_credits"),
    aliasedValue(object, "totalCredits", "total_credits"),
    aliasedValue(object, "termUsedCredits", "term_used_credits"),
    aliasedValue(object, "usedCredits", "used_credits"),
    aliasedValue(object, "termRemainingCredits", "term_remaining_credits"),
    aliasedValue(object, "remainingCredits", "remaining_credits"),
    aliasedValue(object, "termReservedCredits", "term_reserved_credits"),
    aliasedValue(object, "reservedCredits", "reserved_credits"),
    aliasedValue(object, "localMeteredUsedCredits", "local_metered_used_credits"),
  ].some((value) => finiteNumber(value) != null);
}

export function normalizeCreditWallet(wallet, previous = null, options = {}) {
  const credits = plainObject(wallet?.credits) || plainObject(wallet?.wallet) || plainObject(wallet) || {};
  const previousCredits = creditSnapshotHasMeaningfulData(previous) ? previous : {};
  if (!creditSnapshotHasMeaningfulData(credits)) {
    return creditSnapshotHasMeaningfulData(previousCredits) ? previousCredits : null;
  }
  // Flags, plan labels, and term IDs do not establish a balance. Returning the
  // last complete wallet (or null) prevents a metadata-only snapshot from
  // manufacturing 0/0/0 totals or attaching a new term ID to stale totals.
  if (!creditSnapshotHasFiniteTotals(credits)) {
    return creditSnapshotHasMeaningfulData(previousCredits) ? previousCredits : null;
  }
  // Authoritative snapshots prefer each total they actually carry. Missing
  // same-term fields still come from the previous wallet, so a partial or
  // metadata-only update cannot manufacture zeroes.
  const preferIncoming = Boolean(options?.preferIncoming || options?.preferIncomingTotals)
    && creditSnapshotHasFiniteTotals(credits);

  const total = plainObject(credits.total)
    || plainObject(credits.totalCredits)
    || plainObject(credits.total_credits)
    || {};
  const term = plainObject(credits.term) || {};
  const termId = textValue(aliasedValue(credits, "termId", "term_id") || term.id, "");
  const rawTermEnd = textValue(
    aliasedValue(credits, "termEnd", "term_end")
      || aliasedValue(credits, "resetAt", "reset_at")
      || aliasedValue(term, "termEnd", "term_end"),
    "",
  );
  const previousTermId = textValue(aliasedValue(previousCredits, "termId", "term_id"), "");
  const previousTermEnd = textValue(
    aliasedValue(previousCredits, "termEnd", "term_end")
      || aliasedValue(previousCredits, "resetAt", "reset_at"),
    "",
  );
  const incomingPlanToken = textValue(
    aliasedValue(credits, "planName", "plan_name")
      || aliasedValue(credits, "planStatus", "plan_status")
      || credits.status,
  ).toLowerCase();
  const previousPlanToken = textValue(
    aliasedValue(previousCredits, "planName", "plan_name")
      || aliasedValue(previousCredits, "planStatus", "plan_status")
      || previousCredits.status,
  ).toLowerCase();
  const explicitFreeReset = incomingPlanToken === "free" && previousPlanToken && previousPlanToken !== "free";
  const sameTerm = !explicitFreeReset && (termId && previousTermId
    ? termId === previousTermId
    : rawTermEnd && previousTermEnd
      ? rawTermEnd === previousTermEnd
      : true);
  // Keep missing fields from the same-term baseline even for an authoritative
  // partial snapshot. Incoming values win when authoritative, while the
  // defensive max remains appropriate for non-authoritative/local snapshots.
  const sameTermPreviousCredits = (sameTerm || !creditSnapshotHasFiniteTotals(credits))
    ? previousCredits
    : {};
  const incomingUsedValues = [
    aliasedValue(credits, "termUsedCredits", "term_used_credits"),
    aliasedValue(credits, "usedCredits", "used_credits"),
    aliasedValue(total, "usedCredits", "used_credits"),
    aliasedValue(term, "usedCredits", "used_credits"),
    aliasedValue(credits, "localMeteredUsedCredits", "local_metered_used_credits"),
  ];
  const previousUsed = aliasedValue(sameTermPreviousCredits, "termUsedCredits", "term_used_credits");
  const used = (preferIncoming
    ? firstFiniteNumber(...incomingUsedValues, previousUsed)
    : maxFiniteNumber(...incomingUsedValues, previousUsed)) ?? 0;
  const reserved = firstFiniteNumber(
    aliasedValue(credits, "termReservedCredits", "term_reserved_credits"),
    aliasedValue(credits, "reservedCredits", "reserved_credits"),
    aliasedValue(total, "reservedCredits", "reserved_credits"),
    aliasedValue(term, "reservedCredits", "reserved_credits"),
    aliasedValue(sameTermPreviousCredits, "termReservedCredits", "term_reserved_credits"),
  ) ?? 0;
  const incomingTotalValues = [
    aliasedValue(credits, "termTotalCredits", "term_total_credits"),
    aliasedValue(credits, "totalCredits", "total_credits"),
    aliasedValue(total, "totalCredits", "total_credits"),
    aliasedValue(term, "totalCredits", "total_credits"),
  ];
  const previousTotal = aliasedValue(sameTermPreviousCredits, "termTotalCredits", "term_total_credits");
  const totalCredits = (preferIncoming
    ? firstFiniteNumber(...incomingTotalValues, previousTotal)
    : maxFiniteNumber(...incomingTotalValues, previousTotal)) ?? 0;
  const incomingRemaining = firstFiniteNumber(
    aliasedValue(credits, "termRemainingCredits", "term_remaining_credits"),
    aliasedValue(credits, "remainingCredits", "remaining_credits"),
    aliasedValue(total, "remainingCredits", "remaining_credits"),
    aliasedValue(term, "remainingCredits", "remaining_credits"),
  );
  const directRemaining = firstFiniteNumber(
    incomingRemaining,
    aliasedValue(sameTermPreviousCredits, "termRemainingCredits", "term_remaining_credits"),
  );
  const computedRemaining = totalCredits > 0 ? Math.max(0, totalCredits - used - reserved) : null;
  const remaining = preferIncoming && incomingRemaining != null
    ? Math.max(0, incomingRemaining)
    : directRemaining != null && directRemaining > 0
      ? directRemaining
      : computedRemaining ?? directRemaining ?? 0;
  const termEnd = rawTermEnd || (sameTerm
    ? aliasedValue(previousCredits, "resetAt", "reset_at")
      || aliasedValue(previousCredits, "termEnd", "term_end")
      || ""
    : "");
  const planName = creditPlanName(credits) || creditPlanName(previousCredits);
  const planStatus = textValue(
    aliasedValue(credits, "planStatus", "plan_status"),
    textValue(aliasedValue(previousCredits, "planStatus", "plan_status")),
  );
  const lowCreditState = textValue(
    aliasedValue(credits, "lowCreditState", "low_credit_state"),
    textValue(aliasedValue(previousCredits, "lowCreditState", "low_credit_state")),
  );
  const localMeteredUsedCredits = firstFiniteNumber(
    aliasedValue(credits, "localMeteredUsedCredits", "local_metered_used_credits"),
    aliasedValue(previousCredits, "localMeteredUsedCredits", "local_metered_used_credits"),
  ) ?? 0;
  const providerCostMicrousd = firstFiniteNumber(
    aliasedValue(total, "providerCostMicrousd", "provider_cost_microusd"),
    aliasedValue(credits, "providerCostMicrousd", "provider_cost_microusd"),
    aliasedValue(previousCredits, "providerCostMicrousd", "provider_cost_microusd"),
  ) ?? 0;
  const inputTokens = firstFiniteNumber(
    aliasedValue(total, "inputTokens", "input_tokens"),
    aliasedValue(credits, "inputTokens", "input_tokens"),
    aliasedValue(previousCredits, "inputTokens", "input_tokens"),
  ) ?? 0;
  const cachedInputTokens = firstFiniteNumber(
    aliasedValue(total, "cachedInputTokens", "cached_input_tokens"),
    aliasedValue(credits, "cachedInputTokens", "cached_input_tokens"),
    aliasedValue(previousCredits, "cachedInputTokens", "cached_input_tokens"),
  ) ?? 0;
  const outputTokens = firstFiniteNumber(
    aliasedValue(total, "outputTokens", "output_tokens"),
    aliasedValue(credits, "outputTokens", "output_tokens"),
    aliasedValue(previousCredits, "outputTokens", "output_tokens"),
  ) ?? 0;
  const audioSeconds = firstFiniteNumber(
    aliasedValue(total, "audioSeconds", "audio_seconds"),
    aliasedValue(credits, "audioSeconds", "audio_seconds"),
    aliasedValue(previousCredits, "audioSeconds", "audio_seconds"),
  ) ?? 0;
  const ttsCharacters = firstFiniteNumber(
    aliasedValue(total, "ttsCharacters", "tts_characters"),
    aliasedValue(credits, "ttsCharacters", "tts_characters"),
    aliasedValue(previousCredits, "ttsCharacters", "tts_characters"),
  ) ?? 0;
  const webSearchCalls = firstFiniteNumber(
    aliasedValue(total, "webSearchCalls", "web_search_calls"),
    aliasedValue(credits, "webSearchCalls", "web_search_calls"),
    aliasedValue(previousCredits, "webSearchCalls", "web_search_calls"),
  ) ?? 0;
  const eventCount = firstFiniteNumber(
    aliasedValue(total, "eventCount", "event_count"),
    aliasedValue(credits, "eventCount", "event_count"),
    aliasedValue(previousCredits, "eventCount", "event_count"),
  ) ?? 0;
  const updatedAt = textValue(
    aliasedValue(credits, "updatedAt", "updated_at"),
    textValue(aliasedValue(previousCredits, "updatedAt", "updated_at"), new Date().toISOString()),
  );
  const normalizedTotal = {
    ...(plainObject(previousCredits.total) || {}),
    ...total,
    totalCredits,
    total_credits: totalCredits,
    usedCredits: used,
    used_credits: used,
    remainingCredits: remaining,
    remaining_credits: remaining,
    reservedCredits: reserved,
    reserved_credits: reserved,
    providerCostMicrousd,
    provider_cost_microusd: providerCostMicrousd,
    inputTokens,
    input_tokens: inputTokens,
    cachedInputTokens,
    cached_input_tokens: cachedInputTokens,
    outputTokens,
    output_tokens: outputTokens,
    audioSeconds,
    audio_seconds: audioSeconds,
    ttsCharacters,
    tts_characters: ttsCharacters,
    webSearchCalls,
    web_search_calls: webSearchCalls,
    eventCount,
    event_count: eventCount,
  };
  const normalizedTerm = {
    ...(plainObject(previousCredits.term) || {}),
    ...term,
    ...(termId ? { id: termId } : {}),
    ...(termEnd ? { termEnd, term_end: termEnd } : {}),
    totalCredits,
    total_credits: totalCredits,
    usedCredits: used,
    used_credits: used,
    remainingCredits: remaining,
    remaining_credits: remaining,
    reservedCredits: reserved,
    reserved_credits: reserved,
  };

  return {
    ...previousCredits,
    ...credits,
    known: credits.known ?? previousCredits.known ?? true,
    live: credits.live ?? previousCredits.live ?? true,
    source: textValue(credits.source, previousCredits.source || "diff_forge_hot_credit_wallet"),
    walletVersion: firstFiniteNumber(
      aliasedValue(credits, "walletVersion", "wallet_version"),
      aliasedValue(previousCredits, "walletVersion", "wallet_version"),
    ) ?? 0,
    wallet_version: firstFiniteNumber(
      aliasedValue(credits, "walletVersion", "wallet_version"),
      aliasedValue(previousCredits, "walletVersion", "wallet_version"),
    ) ?? 0,
    pendingEventCount: firstFiniteNumber(
      aliasedValue(credits, "pendingEventCount", "pending_event_count"),
      aliasedValue(previousCredits, "pendingEventCount", "pending_event_count"),
    ) ?? 0,
    pending_event_count: firstFiniteNumber(
      aliasedValue(credits, "pendingEventCount", "pending_event_count"),
      aliasedValue(previousCredits, "pendingEventCount", "pending_event_count"),
    ) ?? 0,
    planName,
    plan_name: planName,
    planStatus,
    plan_status: planStatus,
    lowCreditState,
    low_credit_state: lowCreditState,
    total: normalizedTotal,
    term: normalizedTerm,
    resetAt: termEnd || null,
    reset_at: termEnd || null,
    termEnd: termEnd || null,
    term_end: termEnd || null,
    termId: termId || aliasedValue(previousCredits, "termId", "term_id") || "",
    term_id: termId || aliasedValue(previousCredits, "termId", "term_id") || "",
    termRemainingCredits: remaining,
    term_remaining_credits: remaining,
    termReservedCredits: reserved,
    term_reserved_credits: reserved,
    termTotalCredits: totalCredits,
    term_total_credits: totalCredits,
    termUsedCredits: used,
    term_used_credits: used,
    totalCredits,
    total_credits: totalCredits,
    usedCredits: used,
    used_credits: used,
    remainingCredits: remaining,
    remaining_credits: remaining,
    reservedCredits: reserved,
    reserved_credits: reserved,
    localMeteredUsedCredits,
    local_metered_used_credits: localMeteredUsedCredits,
    providerCostMicrousd,
    provider_cost_microusd: providerCostMicrousd,
    inputTokens,
    input_tokens: inputTokens,
    cachedInputTokens,
    cached_input_tokens: cachedInputTokens,
    outputTokens,
    output_tokens: outputTokens,
    audioSeconds,
    audio_seconds: audioSeconds,
    ttsCharacters,
    tts_characters: ttsCharacters,
    webSearchCalls,
    web_search_calls: webSearchCalls,
    eventCount,
    event_count: eventCount,
    updatedAt,
    updated_at: updatedAt,
  };
}

export function creditRemainingWithReserved(credits) {
  return numeric(aliasedValue(credits, "termRemainingCredits", "term_remaining_credits"))
    + numeric(aliasedValue(credits, "termReservedCredits", "term_reserved_credits"));
}

// Credits-widget precedence: the auth/billing snapshot is the authoritative
// baseline (it populates the widget immediately, before the live websocket is
// active); live/hot snapshots only update the display when they carry
// meaningful, known data. Returns the next displayed wallet, or null when
// nothing meaningful has ever arrived (the caller renders a loading state,
// never a hard 0).
//
// - `previous` is the last displayed wallet (the baseline to preserve).
// - `incoming` is whatever the billing/live pipeline currently exposes.
// - A non-meaningful or known:false incoming snapshot NEVER clobbers the
//   baseline (mirrors the web-side fix).
// - A known:true/live:true snapshot with finite totals replaces the totals —
//   so a genuine zeroed balance still displays 0.
export function resolveDisplayedCreditWallet(previous, incoming) {
  const baseline = creditSnapshotHasMeaningfulData(previous) ? previous : null;
  const credits = plainObject(incoming?.credits)
    || plainObject(incoming?.wallet)
    || plainObject(incoming);
  if (!creditSnapshotHasMeaningfulData(credits)) {
    return baseline;
  }
  const unknown = credits.known === false && credits.live !== true;
  if (unknown) {
    return baseline;
  }
  if (!creditSnapshotHasFiniteTotals(credits)) {
    return baseline;
  }
  const authoritative = credits.known === true || credits.live === true;
  return normalizeCreditWallet(credits, baseline, { preferIncomingTotals: authoritative }) || baseline;
}

export function resolveAccountDisplayedCreditWalletState(
  previousState,
  accountKey,
  billingStatus,
) {
  const previous = plainObject(previousState) || {};
  const nextAccountKey = String(accountKey || "").trim();
  const accountChanged = String(previous.accountKey || "") !== nextAccountKey;
  let awaitingBillingStatus = Boolean(previous.awaitingBillingStatus);
  let previousCredits = previous.credits || null;

  if (accountChanged) {
    previousCredits = null;
    awaitingBillingStatus = billingStatus === previous.billingStatus;
  }
  if (awaitingBillingStatus && billingStatus === previous.billingStatus) {
    return {
      accountKey: nextAccountKey,
      awaitingBillingStatus: true,
      billingStatus,
      credits: null,
    };
  }

  return {
    accountKey: nextAccountKey,
    awaitingBillingStatus: false,
    billingStatus,
    credits: resolveDisplayedCreditWallet(
      previousCredits,
      billingStatusCredits(billingStatus),
    ),
  };
}
