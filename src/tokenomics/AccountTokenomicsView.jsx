import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  rowTotal,
} from "./tokenomicsFormat.js";

const TOKENOMICS_SCAN_PROGRESS_EVENT = "diffforge://tokenomics-scan-progress";

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

function filterRows(rows, selectedProvider) {
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  return rows.filter((row) => provider.match(row));
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
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yest.";
  return dateFromDayKey(key).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
}

function buildDailyRows(dailyRows, selectedProvider) {
  const filtered = filterRows(dailyRows, selectedProvider);
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
  for (let offset = 6; offset >= 0; offset -= 1) {
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
  }));
}

function monthAggregate(dailyRows, selectedProvider) {
  const month = dayKeyUtc(new Date()).slice(0, 7);
  const rows = filterRows(dailyRows, selectedProvider).filter((row) => bucketDayKey(row).startsWith(month));
  return aggregateRows(rows);
}

function todayAggregate(dailyRows, selectedProvider) {
  const today = dayKeyUtc(new Date());
  const rows = filterRows(dailyRows, selectedProvider).filter((row) => bucketDayKey(row) === today);
  return aggregateRows(rows);
}

function filterLimits(limits, selectedProvider) {
  if (!Array.isArray(limits)) return [];
  return limits.filter((limit) => selectedProvider === "all" || providerKey(limit) === selectedProvider);
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
  return {
    windowKind,
    label: rows[0]?.label || (windowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit"),
    planDetected: rows.some((row) => Boolean(row?.plan_detected ?? row?.planDetected)),
    planName: plans.length ? plans.join(" + ") : "No plan detected",
    confidence: confidences.includes("estimated") ? "estimated" : (confidences[0] || "unknown"),
    limitSource,
    remainingPercent,
    usedPercent,
    paceDelta,
    statusLabel: limitStatusLabel(remainingPercent, paceDelta, rows),
    resetLabel: rows[0]?.reset_label || rows[0]?.resetLabel || (windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule"),
    ratePoints,
    limitWindowSeconds: numeric(rows[0]?.limit_window_seconds, rows[0]?.limitWindowSeconds),
    resetAfterSeconds: numeric(rows[0]?.reset_after_seconds, rows[0]?.resetAfterSeconds),
    credits: rows.find((row) => row?.credits)?.credits || null,
  };
}

function limitStatusLabel(remainingPercent, paceDelta, rows) {
  if (remainingPercent == null) return rows.find((row) => row?.status_label || row?.statusLabel)?.status_label || "Plan limit not exposed";
  if (remainingPercent <= 0) return "Limit exhausted";
  if (remainingPercent < 18 || paceDelta > 25) return "Pace is running hot";
  if (remainingPercent < 38 || paceDelta > 8) return "Watch current pace";
  return "Safe at current pace";
}

function usageRateRowsFromLimit(limit, hourlyRows, selectedProvider) {
  const windowSeconds = sessionWindowSeconds(limit);
  const bucketCount = Math.max(1, Math.ceil(windowSeconds / 3600));
  const rows = filterRows(Array.isArray(hourlyRows) ? hourlyRows : [], selectedProvider);
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
  if (source === "claude_statusline") return "Live Claude Code usage";
  if (source === "codex_usage_api") return "Live Codex usage";
  if (limit?.confidence === "live") return "Live provider usage";
  if (source === "not_exposed") return "Provider limit not exposed";
  if (source === "local_inferred") return "Limits estimated from local CLI usage";
  if (limit?.confidence === "estimated") return "Limits estimated from local CLI usage";
  return "Provider limit not exposed";
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
  return Math.max(11, Math.round((total / max) * 78));
}

function modelBreakdown(modelRows, providerRows, selectedProvider) {
  const rows = filterRows(modelRows.length ? modelRows : providerRows, selectedProvider);
  const total = rows.reduce((sum, row) => sum + rowTotal(row), 0);
  if (selectedProvider === "all") {
    return rows
      .map((row) => ({
        label: row?.model && row.model !== row.agent_kind ? row.model : providerLabel(row),
        percent: total > 0 ? Math.round((rowTotal(row) / total) * 100) : 0,
      }))
      .filter((row) => row.percent > 0)
      .slice(0, 3);
  }

  if (total > 0) {
    return rows
      .map((row) => ({
        label: row?.model && row.model !== row.agent_kind ? row.model : providerLabel(row),
        percent: Math.round((rowTotal(row) / total) * 100),
      }))
      .filter((row) => row.percent > 0)
      .slice(0, 3);
  }

  return (PROVIDER_MODELS[selectedProvider] || []).map((label) => ({ label, percent: 0 })).slice(0, 3);
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

function mergeTokenomicsSummary(previous, next) {
  if (!previous) return next || {};
  if (!next) return previous;
  return {
    ...previous,
    ...next,
    total: next.total || previous.total,
    by_provider: next.by_provider || previous.by_provider,
    by_model: next.by_model || previous.by_model,
    daily: next.daily || previous.daily,
    daily_by_provider: next.daily_by_provider || previous.daily_by_provider,
    hourly_by_provider: next.hourly_by_provider || previous.hourly_by_provider,
    session_hourly_by_provider: next.session_hourly_by_provider || previous.session_hourly_by_provider,
    rollups: next.rollups || previous.rollups,
    sources: next.sources || previous.sources,
    limits: next.limits || previous.limits,
    credits: next.credits || previous.credits,
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

export default function AccountTokenomicsView({ billingStatus = null } = {}) {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [scanProgress, setScanProgress] = useState(null);
  const loadedOnceRef = useRef(false);

  const refresh = useCallback(async ({ scan = false } = {}) => {
    setStatus(scan ? "scanning" : "loading");
    setError("");
    if (scan) setScanProgress(null);
    try {
      if (scan) {
        invoke("tokenomics_get_live_limits")
          .then((limitsSummary) => {
            setSummary((previous) => mergeTokenomicsSummary(previous, limitsSummary || {}));
          })
          .catch(() => {});
      }
      const next = scan
        ? await invoke("tokenomics_scan_usage")
        : await invoke("tokenomics_get_summary");
      setSummary((previous) => mergeTokenomicsSummary(previous, next || {}));
      setStatus("ready");
    } catch (caught) {
      setError(caught?.message || String(caught || "Unable to load Tokenomics."));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const command = loadedOnceRef.current ? "tokenomics_get_summary" : "tokenomics_scan_usage";
        loadedOnceRef.current = true;
        if (command === "tokenomics_scan_usage") {
          invoke("tokenomics_get_live_limits")
            .then((limitsSummary) => {
              if (!disposed) {
                setSummary((previous) => mergeTokenomicsSummary(previous, limitsSummary || {}));
              }
            })
            .catch(() => {});
        }
        const next = await invoke(command);
        if (!disposed) {
          setSummary((previous) => mergeTokenomicsSummary(previous, next || {}));
          setStatus("ready");
        }
      } catch (caught) {
        if (!disposed) {
          setError(caught?.message || String(caught || "Unable to load Tokenomics."));
          setStatus("error");
        }
      }
    };
    load();
    const interval = window.setInterval(load, 10_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    listen(TOKENOMICS_SCAN_PROGRESS_EVENT, (event) => {
      if (!disposed) {
        const payload = event.payload || null;
        setScanProgress(payload);
        if (payload?.summary) {
          setSummary((previous) => mergeTokenomicsSummary(previous, payload.summary || {}));
        }
      }
    })
      .then((handler) => {
        if (disposed) {
          handler();
        } else {
          unlisten = handler;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const providers = Array.isArray(summary?.by_provider) ? summary.by_provider : [];
  const modelRows = Array.isArray(summary?.by_model) ? summary.by_model : [];
  const dailyRaw = selectedProvider === "all"
    ? (Array.isArray(summary?.daily) ? summary.daily : [])
    : (Array.isArray(summary?.daily_by_provider) ? summary.daily_by_provider : []);
  const hourlyRaw = Array.isArray(summary?.session_hourly_by_provider)
    ? summary.session_hourly_by_provider
    : (Array.isArray(summary?.hourly_by_provider) ? summary.hourly_by_provider : []);
  const dailyRows = useMemo(() => buildDailyRows(dailyRaw, selectedProvider), [dailyRaw, selectedProvider]);
  const today = useMemo(() => todayAggregate(dailyRaw, selectedProvider), [dailyRaw, selectedProvider]);
  const month = useMemo(() => monthAggregate(dailyRaw, selectedProvider), [dailyRaw, selectedProvider]);
  const total = useMemo(() => aggregateRows(filterRows(providers, selectedProvider)), [providers, selectedProvider]);
  const limits = useMemo(() => filterLimits(summary?.limits, selectedProvider), [summary?.limits, selectedProvider]);
  const fiveHour = useMemo(() => mergeLimits(limits, "5_hour"), [limits]);
  const weekly = useMemo(() => mergeLimits(limits, "weekly"), [limits]);
  const sessionUsageRows = useMemo(() => usageRateRowsFromLimit(fiveHour, hourlyRaw, selectedProvider), [fiveHour, hourlyRaw, selectedProvider]);
  const maxSessionUsage = Math.max(1, ...sessionUsageRows.map((row) => row.total));
  const activeSessionRows = sessionUsageRows.filter((row) => row.total > 0);
  const averageSessionUsage = activeSessionRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, activeSessionRows.length);
  const openAiCredits = useMemo(() => selectedProvider === "codex" ? codexCreditBalance(limits) : null, [limits, selectedProvider]);
  const dailyAverage = dailyRows.reduce((sum, row) => sum + dailyUsageValue(row), 0) / Math.max(1, dailyRows.filter((row) => dailyUsageValue(row) > 0).length);
  const maxDaily = Math.max(1, ...dailyRows.map((row) => dailyUsageValue(row)));
  const breakdown = useMemo(() => modelBreakdown(modelRows, providers, selectedProvider), [modelRows, providers, selectedProvider]);
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

        {error ? <TokenomicsError>{error}</TokenomicsError> : null}

        {status !== "ready" ? (
          <TokenomicsLoading role="status" aria-live="polite">
            <span />
            <strong>{tokenomicsLoadingLabel(status, summary, scanProgress)}</strong>
            {scanProgress ? <small>{tokenomicsLoadingDetail(scanProgress)}</small> : null}
          </TokenomicsLoading>
        ) : null}

        <PlanStatusLine>
          <strong>{fiveHour.planDetected ? fiveHour.planName : "No provider plan detected"}</strong>
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
            <RangePill>7d</RangePill>
          </PanelTitle>
          <DailyChart>
            {dailyRows.map((row) => (
              <DailyColumn key={row.key}>
                <DailyBar
                  $tone={dailyTone(dailyUsageValue(row), dailyAverage)}
                  style={{ height: `${dailyBarHeight(dailyUsageValue(row), maxDaily)}%` }}
                  title={dailyUsageTitle(row)}
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
                <td>This Month</td>
                <TokenCell value={month.input || total.input} />
                <TokenCell value={month.output || total.output} />
                <TokenCell value={month.cache || total.cache} />
                <CostCell value={month.cost || total.cost} />
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

const RangePill = styled.small`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  min-height: 22px;
  border-radius: 999px;
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.12);
`;

const DailyChart = styled.div`
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  align-items: end;
  gap: 6px;
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
    width: 28%;
    color: #7f9ac1;
    text-align: left;
  }

  th {
    color: #7f9ac1;
    font-size: clamp(8px, 2.1vw, 10px);
    font-weight: 800;
  }

  td {
    color: #e5eefb;
    font-size: clamp(9px, 2.5vw, 11px);
    font-weight: 750;
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
