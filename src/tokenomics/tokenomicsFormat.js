export function numeric(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

export function formatInteger(value) {
  const rounded = Math.round(numeric(value));
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
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
