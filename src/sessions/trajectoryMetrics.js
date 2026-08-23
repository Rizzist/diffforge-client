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
