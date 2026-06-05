import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  dailyUsageTitle,
  dailyUsageValue,
  formatCost,
  formatCostTitle,
  formatTokenTitle,
  formatTokens,
  numeric,
  rowActivityTokens,
  rowCache,
  rowCost,
  rowInput,
  rowOutput,
  rowProviderAccountKey,
  rowProviderAccountLabel,
  rowTotal,
} from "./tokenomicsFormat.js";

const TOKENOMICS_SCAN_PROGRESS_EVENT = "diffforge://tokenomics-scan-progress";
const TOKENOMICS_VIEW_POLL_INTERVAL_MS = 10_000;
const TOKENOMICS_DAILY_WINDOW_DAYS = 30;
const TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS = 7;
const TOKENOMICS_DAILY_RANGE_OPTIONS = [7, TOKENOMICS_DAILY_WINDOW_DAYS];

const PROVIDERS = [
  { id: "all", label: "All", match: () => true },
  { id: "codex", label: "Codex", match: (row) => providerKey(row) === "codex" },
  { id: "claude", label: "Claude", match: (row) => providerKey(row) === "claude" },
];

const PROVIDER_LABELS = {
  anthropic: "Claude Code",
  claude: "Claude Code",
  openai: "Codex",
  codex: "Codex",
  opencode: "OpenCode",
};

const PROVIDER_MODELS = {
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5"],
  claude: ["opus-4-6", "sonnet-4-6", "haiku-4-5"],
  all: ["codex", "claude", "opencode"],
};

const PROVIDER_ACCENTS = {
  all: "#60a5fa",
  codex: "#60a5fa",
  claude: "#fb923c",
};

function createTokenomicsStoreState() {
  return {
    summary: null,
    status: "loading",
    error: "",
    selectedProvider: "all",
    selectedAccountKey: "all",
    selectedDeviceId: "all",
    scanProgress: null,
  };
}

function normalizeTokenomicsAccountKey(accountKey) {
  return String(accountKey || "local-account").trim() || "local-account";
}

function providerAccent(provider) {
  return PROVIDER_ACCENTS[provider] || "#60a5fa";
}

function formatCredits(value) {
  if (value == null || value === "") return "0";
  const raw = typeof value === "string" ? value.trim() : String(value);
  if (!raw || raw === "NaN") return "0";
  const [whole, decimal] = raw.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${decimal != null ? `.${decimal}` : ""}`;
}

function providerKey(row) {
  const agent = String(row?.agent_kind || row?.agentKind || "").toLowerCase();
  const provider = String(row?.provider || "").toLowerCase();
  if (agent.includes("codex") || provider.includes("openai") || provider.includes("codex")) return "codex";
  if (agent.includes("claude") || provider.includes("anthropic") || provider.includes("claude")) return "claude";
  if (agent.includes("opencode") || provider.includes("opencode")) return "opencode";
  return provider || agent || "agent";
}

function providerLabel(row) {
  const key = providerKey(row);
  return PROVIDER_LABELS[key] || PROVIDER_LABELS[String(row?.provider || "").toLowerCase()] || row?.label || "Agent";
}

function rowDeviceId(row) {
  return String(row?.device_id || row?.deviceId || row?.machine_id || row?.machineId || "").trim();
}

function deviceLabel(deviceId, currentDeviceId = "") {
  if (!deviceId) return "Unknown device";
  if (currentDeviceId && deviceId === currentDeviceId) return "This device";
  const compact = deviceId.length > 18 ? `${deviceId.slice(0, 8)}...${deviceId.slice(-6)}` : deviceId;
  return compact.replace(/^desktop-/, "Desktop ");
}

function filterRows(rows, selectedProvider, selectedAccountKey = "all", selectedDeviceId = "all") {
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  return rows.filter((row) => (
    provider.match(row)
      && (selectedAccountKey === "all" || rowProviderAccountKey(row) === selectedAccountKey)
      && (selectedDeviceId === "all" || rowDeviceId(row) === selectedDeviceId)
  ));
}

function aggregateRows(rows) {
  return rows.reduce(
    (acc, row) => ({
      input: acc.input + rowInput(row),
      output: acc.output + rowOutput(row),
      cache: acc.cache + rowCache(row),
      total: acc.total + rowActivityTokens(row),
      cost: acc.cost + rowCost(row),
      events: acc.events + numeric(row?.event_count, row?.eventCount),
    }),
    { input: 0, output: 0, cache: 0, total: 0, cost: 0, events: 0 },
  );
}

function bucketDayKey(row) {
  const raw = row?.bucket_start || row?.bucketStart || row?.bucket_day || row?.bucketDay;
  if (!raw) return "";
  const value = String(raw);
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dayKeyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromDayKey(key) {
  return new Date(`${key}T00:00:00Z`);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function compactDayLabel(key, todayKey) {
  const today = dateFromDayKey(todayKey);
  const yesterdayKey = dayKeyUtc(addUtcDays(today, -1));
  if (key === todayKey) return "T";
  if (key === yesterdayKey) return "Y";
  return dateFromDayKey(key)
    .toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })
    .slice(0, 1);
}

function fullDayLabel(key, todayKey) {
  const today = dateFromDayKey(todayKey);
  const yesterdayKey = dayKeyUtc(addUtcDays(today, -1));
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return dateFromDayKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildDailyRows(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId, windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const filtered = filterRows(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId);
  const byDay = new Map();
  for (const row of filtered) {
    const key = bucketDayKey(row);
    if (!key) continue;
    const current = byDay.get(key) || { key, rows: [] };
    current.rows.push(row);
    byDay.set(key, current);
  }

  const todayKey = dayKeyUtc(new Date());
  const latestDataKey = [...byDay.keys()].sort().pop() || todayKey;
  const endKey = latestDataKey > todayKey ? latestDataKey : todayKey;
  const endDate = dateFromDayKey(endKey);
  const buckets = [];
  for (let offset = Math.max(1, windowDays) - 1; offset >= 0; offset -= 1) {
    const date = addUtcDays(endDate, -offset);
    const key = dayKeyUtc(date);
    const match = byDay.get(key);
    const aggregate = aggregateRows(match?.rows || []);
    buckets.push({
      key,
      ...aggregate,
    });
  }
  return buckets.map((row) => ({
    ...row,
    label: compactDayLabel(row.key, todayKey),
    titleLabel: fullDayLabel(row.key, todayKey),
  }));
}

function rollingWindowAggregate(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId, windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const today = dateFromDayKey(dayKeyUtc(new Date()));
  const startKey = dayKeyUtc(addUtcDays(today, -(Math.max(1, windowDays) - 1)));
  const endKey = dayKeyUtc(today);
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId)
    .filter((row) => {
      const key = bucketDayKey(row);
      return key >= startKey && key <= endKey;
    });
  return aggregateRows(rows);
}

function todayAggregate(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId) {
  const today = dayKeyUtc(new Date());
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId)
    .filter((row) => bucketDayKey(row) === today);
  return aggregateRows(rows);
}

function filterLimits(limits, selectedProvider, selectedAccountKey = "all", selectedDeviceId = "all") {
  if (!Array.isArray(limits)) return [];
  return limits.filter((limit) => (
    (selectedProvider === "all" || providerKey(limit) === selectedProvider)
      && (selectedAccountKey === "all" || rowProviderAccountKey(limit) === selectedAccountKey)
      && (selectedDeviceId === "all" || rowDeviceId(limit) === selectedDeviceId)
  ));
}

function mergeLimits(limits, windowKind) {
  const rows = limits.filter((limit) => String(limit?.window_kind || limit?.windowKind || "") === windowKind);
  if (!rows.length) {
    return {
      windowKind,
      label: windowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit",
      planDetected: false,
      planName: "No plan detected",
      confidence: "unknown",
      remainingPercent: null,
      usedPercent: null,
      paceDelta: 0,
      statusLabel: "Plan limit not exposed",
      resetLabel: windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule",
      ratePoints: [],
    };
  }
  const used = rows.reduce((sum, row) => sum + numeric(row?.used), 0);
  const allowanceValues = rows.map((row) => numeric(row?.allowance)).filter((value) => value > 0);
  const allowance = allowanceValues.length ? allowanceValues.reduce((sum, value) => sum + value, 0) : null;
  const usedPercent = allowance ? Math.max(0, Math.min(100, Math.round((used / allowance) * 100))) : null;
  const remainingPercent = usedPercent == null ? null : Math.max(0, 100 - usedPercent);
  const paceDelta = Math.round(rows.reduce((sum, row) => sum + numeric(row?.pace_delta_percent, row?.paceDeltaPercent), 0) / rows.length);
  const plans = [...new Set(rows.map((row) => row?.plan_name || row?.planName).filter(Boolean))];
  const confidences = [...new Set(rows.map((row) => row?.confidence).filter(Boolean))];
  const ratePoints = rows.flatMap((row) => Array.isArray(row?.rate_points || row?.ratePoints) ? (row.rate_points || row.ratePoints) : []);
  const limitSource = rows.find((row) => row?.limit_source || row?.limitSource)?.limit_source || rows.find((row) => row?.limitSource)?.limitSource || "";
  const providerKeys = [...new Set(rows.map(providerKey).filter(Boolean))];
  const claudeUnavailable = isClaudeLimitUnavailable(rows);
  return {
    windowKind,
    label: rows[0]?.label || (windowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit"),
    planDetected: rows.some((row) => Boolean(row?.plan_detected ?? row?.planDetected)),
    planName: plans.length ? plans.join(" + ") : "No plan detected",
    confidence: confidences.includes("estimated") ? "estimated" : (confidences[0] || "unknown"),
    limitSource,
    providerKeys,
    remainingPercent,
    usedPercent,
    paceDelta,
    statusLabel: limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable),
    resetLabel: limitResetLabel(rows, windowKind, claudeUnavailable),
    ratePoints,
    limitWindowSeconds: numeric(rows[0]?.limit_window_seconds, rows[0]?.limitWindowSeconds),
    resetAfterSeconds: numeric(rows[0]?.reset_after_seconds, rows[0]?.resetAfterSeconds),
    credits: rows.find((row) => row?.credits)?.credits || null,
  };
}

function isClaudeLimitUnavailable(rows) {
  return rows.some((row) => {
    if (providerKey(row) !== "claude") return false;
    const source = String(row?.limit_source || row?.limitSource || "").toLowerCase();
    const confidence = String(row?.confidence || "").toLowerCase();
    const status = String(row?.status_label || row?.statusLabel || "").toLowerCase();
    return source === "claude_statusline_unavailable"
      || source === "not_exposed"
      || confidence === "unknown"
      || status.includes("not exposed")
      || status.includes("unavailable");
  });
}

function limitResetLabel(rows, windowKind, claudeUnavailable) {
  const current = rows[0]?.reset_label || rows[0]?.resetLabel || "";
  if (!claudeUnavailable) {
    return current || (windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule");
  }
  if (!current || current.includes("Provider limit unavailable")) {
    return "Open Claude Code to publish live limits";
  }
  if (current.includes("Provider schedule unavailable")) {
    return "Claude Code has not reported its weekly window";
  }
  return current;
}

function limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable = false) {
  if (remainingPercent == null) {
    if (claudeUnavailable) return "Live limits unavailable";
    return rows.find((row) => row?.status_label || row?.statusLabel)?.status_label || "Plan limit not exposed";
  }
  if (remainingPercent <= 0) return "Limit exhausted";
  if (remainingPercent < 18 || paceDelta > 25) return "Pace is running hot";
  if (remainingPercent < 38 || paceDelta > 8) return "Watch current pace";
  return "Safe at current pace";
}

function usageRateRowsFromLimit(limit, hourlyRows, selectedProvider, selectedAccountKey, selectedDeviceId) {
  const windowSeconds = sessionWindowSeconds(limit);
  const bucketCount = Math.max(1, Math.ceil(windowSeconds / 3600));
  const rows = filterRows(Array.isArray(hourlyRows) ? hourlyRows : [], selectedProvider, selectedAccountKey, selectedDeviceId);
  if (rows.some((row) => row?.window_index != null || row?.windowIndex != null)) {
    const byIndex = new Map();
    for (const row of rows) {
      const index = numeric(row?.window_index, row?.windowIndex);
      const previous = byIndex.get(index) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
      byIndex.set(index, {
        total: previous.total + rowTotal(row),
        input: previous.input + rowInput(row),
        output: previous.output + rowOutput(row),
        cache: previous.cache + rowCache(row),
        cost: previous.cost + rowCost(row),
      });
    }
    return Array.from({ length: bucketCount }, (_, index) => {
      const aggregate = byIndex.get(index) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
      const remaining = bucketCount - 1 - index;
      return {
        key: `rolling-${index}`,
        label: remaining === 0 ? "now" : `-${remaining}h`,
        ...aggregate,
      };
    });
  }
  const byHour = new Map();
  for (const row of rows) {
    const date = parseHourBucketDate(row);
    if (!date) continue;
    const key = hourKey(date);
    const previous = byHour.get(key) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
    byHour.set(key, {
      total: previous.total + rowTotal(row),
      input: previous.input + rowInput(row),
      output: previous.output + rowOutput(row),
      cache: previous.cache + rowCache(row),
      cost: previous.cost + rowCost(row),
    });
  }

  const now = new Date();
  now.setMinutes(0, 0, 0);
  const recent = [];
  for (let offset = bucketCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(now.getHours() - offset);
    const key = hourKey(date);
    const aggregate = byHour.get(key) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
    recent.push({
      key,
      label: offset === 0 ? "now" : `-${offset}h`,
      ...aggregate,
    });
  }
  return recent;
}

function parseHourBucketDate(row) {
  const raw = row?.bucket_start || row?.bucketStart;
  if (!raw) return null;
  const value = String(raw);
  const date = new Date(value.length === 13 ? `${value}:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hourKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}`;
}

function usageRatePath(points, width, height) {
  if (!points.length) return "";
  const max = Math.max(1, ...points.map((point) => numeric(point.total)));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  return points
    .map((point, index) => {
      const x = index * step;
      const y = height - Math.max(4, Math.min(height - 4, (numeric(point.total) / max) * (height - 12)));
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function sessionWindowSeconds(limit) {
  return numeric(limit?.limitWindowSeconds, limit?.limit_window_seconds) || 5 * 60 * 60;
}

function windowDurationLabel(limit) {
  const seconds = sessionWindowSeconds(limit);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function limitSourceText(limit) {
  const source = limit?.limitSource || limit?.limit_source || "";
  const isClaude = Array.isArray(limit?.providerKeys) && limit.providerKeys.includes("claude");
  if (source === "claude_statusline_unavailable") return "Live Claude Code limits unavailable";
  if (source === "claude_statusline") return "Live Claude Code usage";
  if (source === "codex_usage_api") return "Live Codex usage";
  if (limit?.confidence === "live") return "Live provider usage";
  if (isClaude && (source === "not_exposed" || limit?.confidence === "unknown")) return "Live Claude Code limits unavailable";
  if (source === "not_exposed") return "Provider limit not exposed";
  if (source === "local_inferred") return "Limits estimated from local CLI usage";
  if (limit?.confidence === "estimated") return "Limits estimated from local CLI usage";
  return "Provider limit not exposed";
}

function planStatusTitle(limit, selectedProvider) {
  if (!limit?.planDetected) {
    return selectedProvider === "claude" ? "No Claude account detected" : "No provider plan detected";
  }
  const name = String(limit?.planName || "").trim();
  if (selectedProvider === "claude" && name === "Claude subscription") {
    return "Claude account signed in";
  }
  return name || (selectedProvider === "claude" ? "Claude account signed in" : "Provider plan detected");
}

function codexCreditBalance(limits) {
  const match = limits.find((limit) => {
    const credits = limit?.credits;
    return credits && (credits.balance != null || credits.has_credits || credits.hasCredits);
  });
  return match?.credits || null;
}

function statusTone(remainingPercent, paceDelta = 0) {
  if (remainingPercent == null) return "unknown";
  if (remainingPercent <= 15 || paceDelta > 25) return "danger";
  if (remainingPercent <= 38 || paceDelta > 8) return "warn";
  return "good";
}

function dailyTone(value, average) {
  if (value <= 0) return "quiet";
  if (!average || value <= average * 1.15) return "good";
  if (value <= average * 1.55) return "warn";
  return "danger";
}

function dailyBarHeight(value, maxValue) {
  const total = numeric(value);
  if (total <= 0) return 5;
  const max = Math.max(1, numeric(maxValue));
  return Math.max(11, Math.round((total / max) * 94));
}

function modelBreakdown(modelRows, selectedProvider, selectedAccountKey, selectedDeviceId) {
  const rows = filterRows(modelRows, selectedProvider, selectedAccountKey, selectedDeviceId);
  const byModel = new Map();
  for (const row of rows) {
    const rawModel = String(row?.model || "").trim();
    const agentKind = String(row?.agent_kind || row?.agentKind || "").trim();
    const label = rawModel && rawModel !== agentKind ? rawModel : providerLabel(row);
    const key = label || "Unknown model";
    const current = byModel.get(key) || { label: key, total: 0 };
    current.total += rowActivityTokens(row);
    byModel.set(key, current);
  }
  const total = [...byModel.values()].reduce((sum, row) => sum + row.total, 0);
  if (total <= 0) {
    return (PROVIDER_MODELS[selectedProvider] || []).map((label) => ({ label, percent: 0 })).slice(0, 5);
  }

  return [...byModel.values()]
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
    .slice(0, 5)
    .map((row) => ({
      label: row.label,
      percent: Math.max(1, Math.round((row.total / total) * 100)),
    }));
}

function providerAccountOptions(summary, selectedProvider, selectedDeviceId = "all") {
  if (selectedProvider === "all") return [];
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  const rows = [
    ...(Array.isArray(summary?.by_device_account) ? summary.by_device_account : []),
  ].filter((row) => provider.match(row) && (selectedDeviceId === "all" || rowDeviceId(row) === selectedDeviceId));
  const byKey = new Map();
  for (const row of rows) {
    const key = rowProviderAccountKey(row);
    if (!key) continue;
    const current = byKey.get(key) || {
      key,
      label: rowProviderAccountLabel(row),
      total: 0,
    };
    current.total += rowTotal(row);
    if (!current.label || current.label === key) {
      current.label = rowProviderAccountLabel(row);
    }
    byKey.set(key, current);
  }
  const accounts = [...byKey.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  if (!accounts.length) return [];
  const providerLabelText = selectedProvider === "codex"
    ? "All Codex"
    : selectedProvider === "claude"
      ? "All Claude"
      : `All ${provider.label}`;
  return [{ key: "all", label: providerLabelText }, ...accounts];
}

function deviceOptions(summary) {
  const currentDeviceId = String(summary?.current_device_id || summary?.currentDeviceId || "").trim();
  const rows = [
    ...(Array.isArray(summary?.by_device) ? summary.by_device : []),
    ...(Array.isArray(summary?.by_device_provider) ? summary.by_device_provider : []),
    ...(Array.isArray(summary?.by_device_account) ? summary.by_device_account : []),
    ...(Array.isArray(summary?.by_device_model) ? summary.by_device_model : []),
    ...(Array.isArray(summary?.daily_by_device_provider) ? summary.daily_by_device_provider : []),
    ...(Array.isArray(summary?.hourly) ? summary.hourly : []),
  ];
  const byDevice = new Map();
  for (const row of rows) {
    const id = rowDeviceId(row);
    if (!id) continue;
    const current = byDevice.get(id) || {
      key: id,
      label: deviceLabel(id, currentDeviceId),
      total: 0,
    };
    current.total += rowTotal(row);
    byDevice.set(id, current);
  }
  const devices = [...byDevice.values()].sort((a, b) => {
    if (a.key === currentDeviceId) return -1;
    if (b.key === currentDeviceId) return 1;
    return b.total - a.total || a.label.localeCompare(b.label);
  });
  return [{ key: "all", label: "All devices" }, ...devices];
}

function lastUpdatedText(value) {
  if (!value) return "Updated just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated just now";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `Updated ${seconds || 1} sec ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.round(minutes / 60)} hr ago`;
}

function providerLimitKey(row = {}) {
  return [
    providerKey(row),
    rowProviderAccountKey(row),
    String(row?.window_kind || row?.windowKind || row?.limit_kind || row?.limitKind || "provider_limit"),
  ].join("::");
}

function providerLimitIsUnknown(row = {}) {
  const source = String(row?.limit_source || row?.limitSource || "").toLowerCase();
  const confidence = String(row?.confidence || "").toLowerCase();
  const status = String(row?.status_label || row?.statusLabel || "").toLowerCase();
  const hasPercent = row?.remaining_percent != null
    || row?.remainingPercent != null
    || row?.used_percent != null
    || row?.usedPercent != null;
  return source === "not_exposed"
    || confidence === "unknown"
    || status.includes("not exposed")
    || (!hasPercent && row?.allowance == null && row?.used == null);
}

function mergeProviderLimits(previousLimits, nextLimits) {
  const previousRows = Array.isArray(previousLimits) ? previousLimits : [];
  if (!Array.isArray(nextLimits)) return previousRows;
  if (!nextLimits.length && previousRows.length) return previousRows;

  const merged = new Map();
  previousRows.forEach((row) => merged.set(providerLimitKey(row), row));
  nextLimits.forEach((row) => {
    const key = providerLimitKey(row);
    const existing = merged.get(key);
    if (existing && !providerLimitIsUnknown(existing) && providerLimitIsUnknown(row)) {
      return;
    }
    merged.set(key, row);
  });
  return [...merged.values()];
}

function mergeTokenomicsSummary(previous, next) {
  if (!previous) return stripLegacyTokenomicsSummaryFields(next || {});
  if (!next) return previous;
  const merged = {
    ...previous,
    ...next,
    total: next.total || previous.total,
    by_device: next.by_device || previous.by_device,
    by_device_provider: next.by_device_provider || previous.by_device_provider,
    by_device_account: next.by_device_account || previous.by_device_account,
    by_device_model: next.by_device_model || previous.by_device_model,
    daily_by_device_provider: next.daily_by_device_provider || previous.daily_by_device_provider,
    monthly_by_device_provider: next.monthly_by_device_provider || previous.monthly_by_device_provider,
    hourly: next.hourly || previous.hourly,
    sources: next.sources || previous.sources,
    limits: mergeProviderLimits(previous.limits, next.limits),
    credits: next.credits || previous.credits,
  };
  return stripLegacyTokenomicsSummaryFields(merged);
}

function stripLegacyTokenomicsSummaryFields(summary) {
  const clean = { ...summary };
  for (const key of [
    "by_provider",
    "by_account",
    "by_model",
    "daily_by_provider",
    "monthly_by_provider",
    "hourly_by_provider",
    "session_hourly_by_provider",
    "accounts",
    "rollups",
  ]) {
    delete clean[key];
  }
  return clean;
}

const tokenomicsStore = {
  accountKey: "local-account",
  requestEpoch: 0,
  state: createTokenomicsStoreState(),
  loadedOnce: false,
  loadPromise: null,
  pollInterval: null,
  pollSubscriberCount: 0,
  progressListenerPromise: null,
  progressUnlisten: null,
  subscribers: new Set(),
};

function notifyTokenomicsSubscribers() {
  for (const subscriber of tokenomicsStore.subscribers) {
    subscriber(tokenomicsStore.state);
  }
}

function updateTokenomicsStore(patchOrUpdater) {
  const previous = tokenomicsStore.state;
  const patch = typeof patchOrUpdater === "function"
    ? patchOrUpdater(previous)
    : patchOrUpdater;
  tokenomicsStore.state = {
    ...previous,
    ...(patch || {}),
  };
  notifyTokenomicsSubscribers();
}

function subscribeTokenomicsStore(subscriber) {
  tokenomicsStore.subscribers.add(subscriber);
  subscriber(tokenomicsStore.state);
  return () => {
    tokenomicsStore.subscribers.delete(subscriber);
  };
}

function tokenomicsErrorMessage(caught) {
  return caught?.message || String(caught || "Unable to load Tokenomics.");
}

function mergeSummaryIntoTokenomicsStore(next) {
  updateTokenomicsStore((previous) => ({
    summary: mergeTokenomicsSummary(previous.summary, next || {}),
  }));
}

function resetTokenomicsStoreForAccount(accountKey) {
  const normalizedAccountKey = normalizeTokenomicsAccountKey(accountKey);
  if (tokenomicsStore.accountKey === normalizedAccountKey) {
    return;
  }

  tokenomicsStore.accountKey = normalizedAccountKey;
  tokenomicsStore.requestEpoch += 1;
  tokenomicsStore.loadedOnce = false;
  tokenomicsStore.loadPromise = null;
  tokenomicsStore.state = createTokenomicsStoreState();
  notifyTokenomicsSubscribers();
}

function ensureTokenomicsProgressListener() {
  if (tokenomicsStore.progressUnlisten || tokenomicsStore.progressListenerPromise) {
    return;
  }

  tokenomicsStore.progressListenerPromise = listen(TOKENOMICS_SCAN_PROGRESS_EVENT, (event) => {
    const payload = event.payload || null;
    updateTokenomicsStore({ scanProgress: payload });
    if (payload?.summary) {
      mergeSummaryIntoTokenomicsStore(payload.summary);
    }
  })
    .then((handler) => {
      tokenomicsStore.progressUnlisten = handler;
    })
    .catch(() => {})
    .finally(() => {
      tokenomicsStore.progressListenerPromise = null;
    });
}

function loadTokenomicsStore({ scan = false, force = false } = {}) {
  const hasSummary = Boolean(tokenomicsStore.state.summary);
  const shouldScan = Boolean(scan || !tokenomicsStore.loadedOnce);
  const requestEpoch = tokenomicsStore.requestEpoch;

  if (tokenomicsStore.loadPromise) {
    return tokenomicsStore.loadPromise;
  }
  if (!force && !shouldScan && tokenomicsStore.loadedOnce && hasSummary) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }

  updateTokenomicsStore((previous) => ({
    error: "",
    scanProgress: shouldScan ? null : previous.scanProgress,
    status: shouldScan ? "scanning" : (previous.summary ? "ready" : "loading"),
  }));

  tokenomicsStore.loadPromise = (async () => {
    try {
      if (shouldScan) {
        invoke("tokenomics_get_live_limits")
          .then((limitsSummary) => {
            if (tokenomicsStore.requestEpoch === requestEpoch) {
              mergeSummaryIntoTokenomicsStore(limitsSummary || {});
            }
          })
          .catch(() => {});
      }

      const next = shouldScan
        ? await invoke("tokenomics_scan_usage")
        : await invoke("tokenomics_get_summary");
      if (tokenomicsStore.requestEpoch !== requestEpoch) {
        return tokenomicsStore.state.summary;
      }
      tokenomicsStore.loadedOnce = true;
      updateTokenomicsStore((previous) => ({
        error: "",
        status: "ready",
        summary: mergeTokenomicsSummary(previous.summary, next || {}),
      }));
      return tokenomicsStore.state.summary;
    } catch (caught) {
      if (tokenomicsStore.requestEpoch !== requestEpoch) {
        return tokenomicsStore.state.summary;
      }
      updateTokenomicsStore((previous) => ({
        error: tokenomicsErrorMessage(caught),
        status: previous.summary ? "ready" : "error",
      }));
      return tokenomicsStore.state.summary;
    }
  })();

  tokenomicsStore.loadPromise.finally(() => {
    if (tokenomicsStore.requestEpoch === requestEpoch) {
      tokenomicsStore.loadPromise = null;
    }
  });

  return tokenomicsStore.loadPromise;
}

export function startAccountTokenomicsStartupScan(accountKey = "") {
  resetTokenomicsStoreForAccount(accountKey);
  ensureTokenomicsProgressListener();
  return loadTokenomicsStore({ scan: true, force: true });
}

function startTokenomicsViewPolling() {
  ensureTokenomicsProgressListener();
  tokenomicsStore.pollSubscriberCount += 1;
  void loadTokenomicsStore();

  if (!tokenomicsStore.pollInterval) {
    tokenomicsStore.pollInterval = window.setInterval(() => {
      void loadTokenomicsStore({ force: true });
    }, TOKENOMICS_VIEW_POLL_INTERVAL_MS);
  }

  return () => {
    tokenomicsStore.pollSubscriberCount = Math.max(0, tokenomicsStore.pollSubscriberCount - 1);
    if (tokenomicsStore.pollSubscriberCount === 0 && tokenomicsStore.pollInterval) {
      window.clearInterval(tokenomicsStore.pollInterval);
      tokenomicsStore.pollInterval = null;
    }
  };
}

function tokenomicsLoadingLabel(status, summary, progress) {
  const phase = String(progress?.phase || "");
  if (phase === "complete") return "Finalizing usage";
  if (phase === "catch_up") return "Catching up usage";
  if (phase === "day_start" || phase === "backfill_start") return "Scanning 30-day usage";
  return status === "scanning" || !summary ? "Scanning usage" : "Loading usage";
}

function tokenomicsLoadingDetail(progress) {
  const dayIndex = numeric(progress?.day_index, progress?.dayIndex);
  const dayTotal = numeric(progress?.day_total, progress?.dayTotal);
  const dayLabel = String(progress?.day_label || progress?.dayLabel || "").trim();
  const files = numeric(progress?.files_scanned, progress?.filesScanned);
  const events = numeric(progress?.inserted_events, progress?.insertedEvents);
  const parts = [];
  if (dayLabel) parts.push(dayLabel);
  if (dayIndex > 0 && dayTotal > 0) parts.push(`${dayIndex}/${dayTotal}`);
  parts.push(`${files} files`);
  parts.push(`${events} events`);
  return parts.join(" · ");
}

function TokenCell({ value }) {
  return <td title={formatTokenTitle(value)}>{formatTokens(value)}</td>;
}

function CostCell({ value }) {
  return <td title={formatCostTitle(value)}>{formatCost(value)}</td>;
}

export default function AccountTokenomicsView({ accountKey = "", billingStatus = null } = {}) {
  const [{
    summary,
    status,
    error,
    selectedProvider,
    selectedAccountKey,
    selectedDeviceId,
    scanProgress,
  }, setTokenomicsState] = useState(() => tokenomicsStore.state);
  const [dailyWindowDays, setDailyWindowDays] = useState(TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS);

  const refresh = useCallback(async ({ scan = false } = {}) => {
    await loadTokenomicsStore({ scan, force: true });
  }, []);

  const setSelectedProvider = useCallback((provider) => {
    updateTokenomicsStore({ selectedProvider: provider, selectedAccountKey: "all" });
  }, []);

  const setSelectedAccountKey = useCallback((nextAccountKey) => {
    updateTokenomicsStore({ selectedAccountKey: nextAccountKey || "all" });
  }, []);

  const setSelectedDeviceId = useCallback((nextDeviceId) => {
    updateTokenomicsStore({ selectedDeviceId: nextDeviceId || "all", selectedAccountKey: "all" });
  }, []);

  useEffect(() => {
    resetTokenomicsStoreForAccount(accountKey);
    void loadTokenomicsStore();
  }, [accountKey]);

  useEffect(() => {
    const unsubscribeStore = subscribeTokenomicsStore(setTokenomicsState);
    const stopPolling = startTokenomicsViewPolling();
    return () => {
      stopPolling();
      unsubscribeStore();
    };
  }, []);

  const providers = Array.isArray(summary?.by_device_provider) ? summary.by_device_provider : [];
  const deviceFiltered = selectedDeviceId !== "all";
  const modelRows = Array.isArray(summary?.by_device_model) ? summary.by_device_model : [];
  const providerRows = providers;
  const devices = useMemo(() => deviceOptions(summary), [summary]);
  const accountOptions = useMemo(
    () => providerAccountOptions(summary, selectedProvider, selectedDeviceId),
    [summary, selectedDeviceId, selectedProvider],
  );
  useEffect(() => {
    if (
      selectedDeviceId !== "all"
      && !devices.some((option) => option.key === selectedDeviceId)
    ) {
      updateTokenomicsStore({ selectedDeviceId: "all", selectedAccountKey: "all" });
    }
  }, [devices, selectedDeviceId]);
  useEffect(() => {
    if (selectedProvider === "all") {
      if (selectedAccountKey !== "all") {
        updateTokenomicsStore({ selectedAccountKey: "all" });
      }
      return;
    }
    if (
      selectedAccountKey !== "all"
      && !accountOptions.some((option) => option.key === selectedAccountKey)
    ) {
      updateTokenomicsStore({ selectedAccountKey: "all" });
    }
  }, [accountOptions, selectedAccountKey, selectedProvider]);
  const dailyRaw = Array.isArray(summary?.daily_by_device_provider) ? summary.daily_by_device_provider : [];
  const hourlyRaw = Array.isArray(summary?.hourly) ? summary.hourly : [];
  const dailyRows = useMemo(
    () => buildDailyRows(dailyRaw, selectedProvider, selectedAccountKey, selectedDeviceId, dailyWindowDays),
    [dailyRaw, dailyWindowDays, selectedAccountKey, selectedDeviceId, selectedProvider],
  );
  const today = useMemo(
    () => todayAggregate(dailyRaw, selectedProvider, selectedAccountKey, selectedDeviceId),
    [dailyRaw, selectedAccountKey, selectedDeviceId, selectedProvider],
  );
  const last30Days = useMemo(
    () => rollingWindowAggregate(dailyRaw, selectedProvider, selectedAccountKey, selectedDeviceId),
    [dailyRaw, selectedAccountKey, selectedDeviceId, selectedProvider],
  );
  const deviceAccountRows = Array.isArray(summary?.by_device_account) ? summary.by_device_account : [];
  const totalRows = deviceFiltered
    ? (selectedAccountKey === "all" ? providerRows : deviceAccountRows)
    : selectedAccountKey === "all" ? providerRows : deviceAccountRows;
  const total = useMemo(
    () => aggregateRows(filterRows(totalRows, selectedProvider, selectedAccountKey, selectedDeviceId)),
    [selectedAccountKey, selectedDeviceId, selectedProvider, totalRows],
  );
  const limits = useMemo(
    () => filterLimits(summary?.limits, selectedProvider, selectedAccountKey, selectedDeviceId),
    [selectedAccountKey, selectedDeviceId, selectedProvider, summary?.limits],
  );
  const fiveHour = useMemo(() => mergeLimits(limits, "5_hour"), [limits]);
  const weekly = useMemo(() => mergeLimits(limits, "weekly"), [limits]);
  const sessionUsageRows = useMemo(
    () => usageRateRowsFromLimit(fiveHour, hourlyRaw, selectedProvider, selectedAccountKey, selectedDeviceId),
    [fiveHour, hourlyRaw, selectedAccountKey, selectedDeviceId, selectedProvider],
  );
  const maxSessionUsage = Math.max(1, ...sessionUsageRows.map((row) => row.total));
  const activeSessionRows = sessionUsageRows.filter((row) => row.total > 0);
  const averageSessionUsage = activeSessionRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, activeSessionRows.length);
  const openAiCredits = useMemo(() => selectedProvider === "codex" ? codexCreditBalance(limits) : null, [limits, selectedProvider]);
  const dailyAverage = dailyRows.reduce((sum, row) => sum + dailyUsageValue(row), 0) / Math.max(1, dailyRows.filter((row) => dailyUsageValue(row) > 0).length);
  const maxDaily = Math.max(1, ...dailyRows.map((row) => dailyUsageValue(row)));
  const breakdown = useMemo(
    () => modelBreakdown(modelRows, selectedProvider, selectedAccountKey, selectedDeviceId),
    [modelRows, selectedAccountKey, selectedDeviceId, selectedProvider],
  );
  const credits = billingStatus?.credits || summary?.credits || {};

  return (
    <TokenomicsShell>
      <TokenomicsPanel>
        <ProviderTabs role="tablist" aria-label="Tokenomics provider filter">
          {PROVIDERS.map((provider) => (
            <ProviderTab
              key={provider.id}
              $active={selectedProvider === provider.id}
              $provider={provider.id}
              onClick={() => setSelectedProvider(provider.id)}
              role="tab"
              type="button"
            >
              {provider.label}
            </ProviderTab>
          ))}
        </ProviderTabs>
        {accountOptions.length > 1 ? (
          <AccountTabs role="tablist" aria-label="Provider account filter">
            {accountOptions.map((account) => (
              <AccountTab
                key={account.key}
                $active={selectedAccountKey === account.key}
                $provider={selectedProvider}
                onClick={() => setSelectedAccountKey(account.key)}
                role="tab"
                title={account.label}
                type="button"
              >
                {account.label}
              </AccountTab>
            ))}
          </AccountTabs>
        ) : null}
        {devices.length > 2 ? (
          <AccountTabs role="tablist" aria-label="Tokenomics device filter">
            {devices.map((device) => (
              <AccountTab
                key={device.key}
                $active={selectedDeviceId === device.key}
                $provider={selectedProvider}
                onClick={() => setSelectedDeviceId(device.key)}
                role="tab"
                title={device.key === "all" ? device.label : `${device.label} · ${device.key}`}
                type="button"
              >
                {device.label}
              </AccountTab>
            ))}
          </AccountTabs>
        ) : null}

        {error ? <TokenomicsError>{error}</TokenomicsError> : null}

        {status !== "ready" ? (
          <TokenomicsLoading role="status" aria-live="polite">
            <span />
            <strong>{tokenomicsLoadingLabel(status, summary, scanProgress)}</strong>
            {scanProgress ? <small>{tokenomicsLoadingDetail(scanProgress)}</small> : null}
          </TokenomicsLoading>
        ) : null}

        <PlanStatusLine>
          <strong>{planStatusTitle(fiveHour, selectedProvider)}</strong>
          <span>{limitSourceText(fiveHour)}</span>
        </PlanStatusLine>
        {openAiCredits ? (
          <ProviderCreditsLine>
            <span>OpenAI credits</span>
            <strong>
              {openAiCredits.unlimited ? "Unlimited" : formatCredits(openAiCredits.balance)}
            </strong>
          </ProviderCreditsLine>
        ) : null}

        <LimitCard tone={statusTone(fiveHour.remainingPercent, fiveHour.paceDelta)}>
          <MetricHeading>
            <MetricName>
              <ClockIcon aria-hidden="true" />
              <span>5-Hour Session</span>
            </MetricName>
            <MetricScore>
              <strong>{fiveHour.remainingPercent == null ? "—" : `${fiveHour.remainingPercent}%`}</strong>
              <span>{fiveHour.paceDelta > 0 ? "▲" : "▼"}{Math.abs(fiveHour.paceDelta)}%</span>
            </MetricScore>
          </MetricHeading>
          <ProgressTrack>
            <ProgressFill style={{ width: `${fiveHour.remainingPercent ?? 0}%` }} />
          </ProgressTrack>
          <MetricFoot>
            <span>{fiveHour.resetLabel}</span>
            <strong>{fiveHour.statusLabel}</strong>
          </MetricFoot>
        </LimitCard>

        <LimitCard tone={statusTone(weekly.remainingPercent, weekly.paceDelta)}>
          <MetricHeading>
            <MetricName>
              <CalendarIcon aria-hidden="true" />
              <span>Weekly Limit</span>
            </MetricName>
            <MetricScore>
              <strong>{weekly.remainingPercent == null ? "—" : `${weekly.remainingPercent}%`}</strong>
              <span>{weekly.paceDelta > 0 ? "▲" : "▼"}{Math.abs(weekly.paceDelta)}%</span>
            </MetricScore>
          </MetricHeading>
          <ProgressTrack>
            <ProgressFill style={{ width: `${weekly.remainingPercent ?? 0}%` }} />
          </ProgressTrack>
          <MetricFoot>
            <span>{weekly.resetLabel}</span>
            <strong>{weekly.statusLabel}</strong>
          </MetricFoot>
        </LimitCard>

        <ChartCard>
          <PanelTitle>
            <span>
              <RateIcon aria-hidden="true" />
              Usage Rate
            </span>
            <small>{windowDurationLabel(fiveHour)}</small>
          </PanelTitle>
          <RateGraph viewBox="0 0 360 104" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="18" x2="360" y2="18" />
            <line x1="0" y1="52" x2="360" y2="52" />
            <line x1="0" y1="86" x2="360" y2="86" />
            {[90, 180, 270].map((x) => <line key={x} x1={x} y1="10" x2={x} y2="94" className="v" />)}
            {sessionUsageRows.map((row, index) => {
              const step = sessionUsageRows.length > 1 ? 340 / (sessionUsageRows.length - 1) : 0;
              const x = 10 + index * step;
              const height = Math.max(row.total > 0 ? 5 : 3, (row.total / maxSessionUsage) * 70);
              const y = 90 - height;
              const isHot = averageSessionUsage > 0 && row.total > averageSessionUsage * 1.35;
              return (
                <rect
                  key={row.key}
                  x={x - 4}
                  y={y}
                  width="8"
                  height={height}
                  rx="2"
                  className={isHot ? "hot" : "cool"}
                />
              );
            })}
            <path d={usageRatePath(sessionUsageRows, 360, 96)} />
          </RateGraph>
          <SessionRateLabels>
            {sessionUsageRows.map((row) => (
              <span key={row.key}>{row.label}</span>
            ))}
          </SessionRateLabels>
        </ChartCard>

        <ChartCard>
          <PanelTitle>
            <span>
              <BarsIcon aria-hidden="true" />
              Daily Usage
            </span>
            <RangeToggle aria-label="Daily usage range" role="group">
              {TOKENOMICS_DAILY_RANGE_OPTIONS.map((days) => (
                <RangeToggleButton
                  key={days}
                  $active={dailyWindowDays === days}
                  aria-pressed={dailyWindowDays === days}
                  onClick={() => setDailyWindowDays(days)}
                  type="button"
                >
                  {days}d
                </RangeToggleButton>
              ))}
            </RangeToggle>
          </PanelTitle>
          <DailyChart $days={dailyRows.length}>
            {dailyRows.map((row) => (
              <DailyColumn key={row.key}>
                <DailyBar
                  $tone={dailyTone(dailyUsageValue(row), dailyAverage)}
                  style={{ height: `${dailyBarHeight(dailyUsageValue(row), maxDaily)}%` }}
                  title={dailyUsageTitle({ ...row, label: row.titleLabel || row.label })}
                />
                <small>{row.label}</small>
              </DailyColumn>
            ))}
          </DailyChart>
        </ChartCard>

        <UsageCard>
          <PanelTitle>
            <span>
              <HashIcon aria-hidden="true" />
              Token Usage
            </span>
          </PanelTitle>
          <UsageTable>
            <thead>
              <tr>
                <th />
                <th>Input</th>
                <th>Output</th>
                <th>Cache</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Today</td>
                <TokenCell value={today.input} />
                <TokenCell value={today.output} />
                <TokenCell value={today.cache} />
                <CostCell value={today.cost} />
              </tr>
              <tr>
                <td title="Last 30 Days">Last 30 Days</td>
                <TokenCell value={last30Days.input} />
                <TokenCell value={last30Days.output} />
                <TokenCell value={last30Days.cache} />
                <CostCell value={last30Days.cost} />
              </tr>
            </tbody>
          </UsageTable>
          <ModelList>
            {breakdown.length ? breakdown.map((item) => (
              <ModelRow key={item.label}>
                <span>{item.label}</span>
                <strong>{item.percent}%</strong>
              </ModelRow>
            )) : (
              <TokenomicsEmpty>Rescan after using Codex or Claude Code to populate usage.</TokenomicsEmpty>
            )}
          </ModelList>
        </UsageCard>

        <CreditsCard>
          <CreditsTitle>
            <span>Diff Forge Credits</span>
            <strong>{credits?.planName || credits?.term?.plan_name || "Plan"}</strong>
          </CreditsTitle>
          <CreditsGrid>
            <CreditMetric>
              <span>Used</span>
              <strong>{formatCredits(credits.termUsedCredits ?? credits.used_credits ?? credits.total?.used_credits)}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Remaining</span>
              <strong>{formatCredits(credits.termRemainingCredits ?? credits.remaining_credits ?? credits.total?.remaining_credits)}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Reserved</span>
              <strong>{formatCredits(credits.termReservedCredits ?? credits.reserved_credits ?? credits.total?.reserved_credits)}</strong>
            </CreditMetric>
          </CreditsGrid>
        </CreditsCard>

        <TokenomicsFooter>
          <span>{lastUpdatedText(summary?.updated_at || summary?.updatedAt)}</span>
          <FooterButton disabled={status === "scanning"} onClick={() => refresh({ scan: true })} type="button">
            {status === "scanning" ? "Scanning" : "Rescan"}
          </FooterButton>
        </TokenomicsFooter>
      </TokenomicsPanel>
    </TokenomicsShell>
  );
}

function ClockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function CalendarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="5" y="6" width="14" height="13" rx="2" />
      <path d="M8 4v4M16 4v4M5 10h14M9 14h.01M12 14h.01M15 14h.01" />
    </svg>
  );
}

function RateIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M4 19V5M4 16l5-5 4 3 6-8M8 19h12" />
    </svg>
  );
}

function BarsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="4" y="11" width="4" height="8" rx="1" />
      <rect x="10" y="7" width="4" height="12" rx="1" />
      <rect x="16" y="4" width="4" height="15" rx="1" />
    </svg>
  );
}

function HashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />
    </svg>
  );
}

const TokenomicsShell = styled.section`
  display: grid;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  overflow-x: hidden;
  padding: clamp(6px, 1.8vw, 12px);
  color: #e5eefb;
  background:
    radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.13), transparent 34%),
    radial-gradient(circle at 100% 12%, rgba(251, 146, 60, 0.08), transparent 28%),
    linear-gradient(180deg, #05070a, #020304 68%, #05070a);

  &,
  * {
    box-sizing: border-box;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
    background:
      radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.1), transparent 34%),
      radial-gradient(circle at 100% 12%, rgba(249, 115, 22, 0.08), transparent 28%),
      linear-gradient(180deg, #f8fafc, #eef4ff);
  }
`;

const TokenomicsPanel = styled.div`
  position: relative;
  display: grid;
  gap: 9px;
  align-self: start;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;

  html[data-forge-theme="light"] & {
    background: transparent;
    box-shadow: none;
  }
`;

const ProviderTabs = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 12, 0.82);

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #eef4ff;
  }
`;

const ProviderTab = styled.button`
  min-width: 0;
  min-height: 30px;
  border: 1px solid ${({ $active, $provider }) => ($active ? providerAccent($provider) : "transparent")};
  border-radius: 7px;
  color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#9aa8bc")};
  background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 18%, transparent)` : "transparent")};
  font: inherit;
  font-size: clamp(10px, 2.4vw, 12px);
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#475569")};
    background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 12%, #ffffff)` : "transparent")};
  }
`;

const AccountTabs = styled.div`
  display: flex;
  gap: 5px;
  min-width: 0;
  overflow-x: auto;
  padding: 2px 1px 4px;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const AccountTab = styled.button`
  flex: 0 0 auto;
  max-width: 210px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid ${({ $active, $provider }) => ($active ? providerAccent($provider) : "rgba(148, 163, 184, 0.16)")};
  border-radius: 7px;
  color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#94a3b8")};
  background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 14%, rgba(15, 23, 42, 0.74))` : "rgba(15, 23, 42, 0.48)")};
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#475569")};
    background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 10%, #ffffff)` : "#f8fafc")};
  }
`;

const TokenomicsError = styled.div`
  padding: 8px 10px;
  border: 1px solid rgba(255, 79, 91, 0.34);
  border-radius: 8px;
  color: #ff7f89;
  background: rgba(255, 79, 91, 0.1);
  font-size: 12px;
  font-weight: 800;
`;

const TokenomicsLoading = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(96, 165, 250, 0.2);
  border-radius: 8px;
  color: #9fb2cc;
  background: rgba(96, 165, 250, 0.08);
  font-size: 11px;
  font-weight: 900;

  span {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    border: 2px solid rgba(96, 165, 250, 0.18);
    border-top-color: #60a5fa;
    border-radius: 999px;
    animation: tokenomics-spin 0.8s linear infinite;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    min-width: 0;
    color: #7f8da3;
    font-size: 10px;
    font-weight: 800;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes tokenomics-spin {
    to {
      transform: rotate(360deg);
    }
  }

  html[data-forge-theme="light"] & {
    color: #475569;
    border-color: rgba(37, 99, 235, 0.16);
    background: rgba(37, 99, 235, 0.07);
  }
`;

const PlanStatusLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 0 2px;
  color: #8fa0b6;
  font-size: clamp(9px, 2.2vw, 11px);
  font-weight: 900;

  strong {
    min-width: 0;
    overflow: hidden;
    color: #e5eefb;
    text-overflow: ellipsis;
    white-space: normal;
  }

  span {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: normal;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;

    strong {
      color: #0f172a;
    }
  }
`;

const ProviderCreditsLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid rgba(251, 146, 60, 0.2);
  border-radius: 8px;
  color: #aab6c8;
  background: rgba(251, 146, 60, 0.07);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  span,
  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #fb923c;
    text-align: right;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(249, 115, 22, 0.2);
    color: #64748b;
    background: rgba(249, 115, 22, 0.08);
  }
`;

const LimitCard = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.72);

  --tone: ${({ tone }) => {
    if (tone === "danger") return "#ff5a5f";
    if (tone === "warn") return "#fb923c";
    if (tone === "unknown") return "#94a3b8";
    return "#60a5fa";
  }};

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #f8fafc;
  }
`;

const MetricHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const MetricName = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: #e5eefb;
  font-size: clamp(12px, 3.1vw, 14px);
  font-weight: 900;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const MetricScore = styled.div`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  color: var(--tone);
  font-size: clamp(10px, 2.4vw, 12px);
  font-weight: 900;
  white-space: nowrap;

  strong {
    font-size: clamp(12px, 3vw, 15px);
  }
`;

const ProgressTrack = styled.div`
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.12);
  }
`;

const ProgressFill = styled.div`
  height: 100%;
  min-width: 7px;
  border-radius: inherit;
  background: var(--tone);
  box-shadow: 0 0 18px color-mix(in srgb, var(--tone) 72%, transparent);
`;

const MetricFoot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: #8794a8;
  font-size: clamp(9px, 2.5vw, 11px);
  font-weight: 900;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--tone);
    font-weight: 900;
    text-align: right;
    text-overflow: ellipsis;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const ChartCard = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.72);
  overflow: hidden;

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #f8fafc;
  }
`;

const PanelTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(12px, 3.1vw, 14px);
  font-weight: 900;

  > span {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  small {
    color: #738196;
    font-size: 10px;
    font-weight: 900;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    fill: none;
    stroke: #60a5fa;
    stroke-width: 2;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;

    small {
      color: #64748b;
    }
  }
`;

const RateGraph = styled.svg`
  display: block;
  width: 100%;
  height: 90px;
  overflow: visible;

  line {
    stroke: rgba(153, 173, 197, 0.15);
    stroke-width: 1;
  }

  line.v {
    stroke: rgba(153, 173, 197, 0.1);
  }

  rect.cool {
    fill: rgba(96, 165, 250, 0.36);
  }

  rect.hot {
    fill: rgba(251, 146, 60, 0.48);
  }

  path {
    fill: none;
    stroke: #fb923c;
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
`;

const SessionRateLabels = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
  margin-top: -3px;

  span {
    color: #8593a8;
    font-size: 9px;
    font-weight: 900;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const RangeToggle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);

  html[data-forge-theme="light"] & {
    border-color: rgba(37, 99, 235, 0.16);
    background: rgba(241, 245, 249, 0.82);
  }
`;

const RangeToggleButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  min-height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  color: ${({ $active }) => ($active ? "#bfdbfe" : "#738196")};
  background: ${({ $active }) => ($active ? "rgba(96, 165, 250, 0.20)" : "transparent")};
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  cursor: pointer;

  &:hover {
    color: #e5eefb;
  }

  html[data-forge-theme="light"] & {
    color: ${({ $active }) => ($active ? "#1d4ed8" : "#64748b")};
    background: ${({ $active }) => ($active ? "rgba(37, 99, 235, 0.12)" : "transparent")};

    &:hover {
      color: #0f172a;
    }
  }
`;

const DailyChart = styled.div`
  display: grid;
  grid-template-columns: repeat(${({ $days }) => $days || TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS}, minmax(0, 1fr));
  align-items: end;
  gap: ${({ $days }) => (($days || 0) > 7 ? "4px" : "7px")};
  min-height: 96px;
`;

const DailyColumn = styled.div`
  display: grid;
  grid-template-rows: 68px auto;
  align-items: end;
  gap: 7px;
  min-width: 0;

  small {
    overflow: hidden;
    color: #7f8ea3;
    font-size: 9px;
    font-weight: 900;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const DailyBar = styled.div`
  align-self: end;
  min-height: 8px;
  border-radius: 5px 5px 2px 2px;
  background: ${({ $tone }) => {
    if ($tone === "danger") return "#ff5a5f";
    if ($tone === "warn") return "#fb923c";
    if ($tone === "quiet") return "rgba(114, 130, 150, 0.25)";
    return "#60a5fa";
  }};
  box-shadow: ${({ $tone }) => ($tone && $tone !== "quiet" ? "0 0 18px rgba(96, 165, 250, 0.16)" : "none")};
`;

const UsageCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(96, 165, 250, 0.17);
  border-radius: 8px;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.12), transparent 36%),
    rgba(15, 23, 42, 0.76);

  html[data-forge-theme="light"] & {
    border-color: rgba(37, 99, 235, 0.15);
    background:
      radial-gradient(circle at 0% 0%, rgba(37, 99, 235, 0.08), transparent 36%),
      #f8fafc;
  }
`;

const UsageTable = styled.table`
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;

  th,
  td {
    overflow: hidden;
    padding: 4px 2px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    width: 32%;
    color: #7f9ac1;
    text-align: left;
  }

  th:last-child,
  td:last-child {
    width: 21%;
  }

  th {
    color: #7f9ac1;
    font-size: 9px;
    font-weight: 800;
  }

  td {
    color: #e5eefb;
    font-size: 10px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  td:first-child {
    font-weight: 800;
  }

  html[data-forge-theme="light"] & {
    th:first-child,
    td:first-child,
    th {
      color: #64748b;
    }

    td {
      color: #0f172a;
    }
  }
`;

const ModelList = styled.div`
  display: grid;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px solid rgba(150, 184, 222, 0.16);
`;

const ModelRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #dfe9f8;
  font-size: clamp(10px, 2.6vw, 12px);
  font-weight: 800;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #a8c3ee;
    font-weight: 800;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;

    strong {
      color: #2563eb;
    }
  }
`;

const CreditsCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(251, 146, 60, 0.18);
  border-radius: 8px;
  background:
    radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.1), transparent 34%),
    rgba(15, 23, 42, 0.72);

  html[data-forge-theme="light"] & {
    border-color: rgba(249, 115, 22, 0.18);
    background:
      radial-gradient(circle at 100% 0%, rgba(249, 115, 22, 0.08), transparent 34%),
      #f8fafc;
  }
`;

const CreditsTitle = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(11px, 2.8vw, 13px);
  font-weight: 900;

  strong {
    color: #fb923c;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const CreditsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`;

const CreditMetric = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 12, 0.22);

  span {
    overflow: hidden;
    color: #8794a8;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  strong {
    overflow: hidden;
    color: #e5eefb;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: #ffffff;

    span {
      color: #64748b;
    }

    strong {
      color: #0f172a;
    }
  }
`;

const TokenomicsFooter = styled.footer`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 0 2px;
  color: rgba(165, 183, 210, 0.52);
  font-size: 10px;
  font-weight: 900;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const FooterButton = styled.button`
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 999px;
  color: #60a5fa;
  background: rgba(37, 99, 235, 0.12);
  font: inherit;
  font-size: 10px;
  font-weight: 900;

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const TokenomicsEmpty = styled.div`
  color: #9db1c9;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.5;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;
