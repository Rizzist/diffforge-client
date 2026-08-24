function measuredNumber(record, key) {
  if (!record || typeof record !== "object" || !Object.hasOwn(record, key)) return null;
  if (record[key] == null || !Number.isFinite(Number(record[key]))) return null;
  return Number(record[key]);
}

/* SessionSummary owns the totals. Display rows are a lossy window and must
   never be counted to reconstruct them. */
export function trajectorySummaryMetrics(session) {
  const metrics = session?.agent_metrics;
  const usage = metrics?.usage;
  const input = measuredNumber(usage, "logical_input_tokens");
  const output = measuredNumber(usage, "billed_output_tokens");
  return {
    turns: measuredNumber(session, "turn_count"),
    calls: measuredNumber(metrics, "tool_attempts"),
    tokenTotal: input == null || output == null ? null : input + output,
  };
}

/* The daemon publishes the same lifecycle coordinates used by the harness
   TUI. Rendered trajectory points are a lossy window and must not be used to
   reconstruct this span. A live snapshot is measured against now; a settled
   snapshot without a terminal coordinate is unknown, not zero. */
export function sessionLifecycleDuration(session, nowMs = Date.now()) {
  const metrics = session?.agent_metrics;
  const startedAtMs = measuredNumber(metrics, "started_at_ms");
  if (startedAtMs == null || startedAtMs < 0) {
    return { state: "unknown", durationMs: null };
  }

  const terminalAtMs = measuredNumber(metrics, "terminal_at_ms");
  if (terminalAtMs != null && terminalAtMs >= 0) {
    return {
      state: "finished",
      durationMs: Math.max(0, terminalAtMs - startedAtMs),
    };
  }

  if (metrics?.live === true && Number.isFinite(Number(nowMs))) {
    return {
      state: "live",
      durationMs: Math.max(0, Number(nowMs) - startedAtMs),
    };
  }
  return { state: "unknown", durationMs: null };
}

export function formatSessionDuration(durationMs) {
  if (durationMs == null || !Number.isFinite(Number(durationMs))) return "—";
  const ms = Math.max(0, Number(durationMs));
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/* Complete renderer-facing value: the JSX must not reinterpret an unknown
   lifecycle duration as zero before formatting it. */
export function trajectoryDurationLabel(session, nowMs = Date.now()) {
  const lifecycle = sessionLifecycleDuration(session, nowMs);
  const label = formatSessionDuration(lifecycle.durationMs);
  return lifecycle.state === "live" ? `${label} · live` : label;
}

export function exactTrajectoryUsagePoints(points = []) {
  const requests = new Map();
  for (const point of points) {
    const request = point?.request;
    const ordinal = measuredNumber(request, "ordinal");
    if (ordinal == null) continue;
    const run = String(point?.run_id || "").trim() || `seq:${point?.seq ?? "unknown"}`;
    requests.set(`${run}:${ordinal}`, {
      ...point,
      ordinal,
      input: measuredNumber(request, "input"),
      output: measuredNumber(request, "output"),
      cached: measuredNumber(request, "cached"),
    });
  }
  return [...requests.values()];
}
