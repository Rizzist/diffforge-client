function normalizedProvider(row = {}) {
  const agent = String(row?.agent_kind || "").toLowerCase();
  const provider = String(row?.provider || "").toLowerCase();
  if (agent.includes("codex") || provider.includes("openai") || provider.includes("codex")) return "codex";
  if (agent.includes("claude") || provider.includes("anthropic") || provider.includes("claude")) return "claude";
  if (agent.includes("opencode") || provider.includes("opencode")) return "opencode";
  return provider || agent || "agent";
}

function unavailable(state, title, detail) {
  return {
    state,
    title,
    detail,
    healthy: false,
    remaining_percent: null,
    used_percent: null,
    display_percent: null,
  };
}

function planAllowance(summary = {}) {
  const plan = summary?.haider_code_plan_status;
  if (!plan || plan.supported !== true) return null;
  if (!plan.known) {
    return unavailable("unknown", "Haider Code allowance unknown", "No plan-status report has been published yet");
  }
  const outcome = plan?.outcome;
  const allowance = outcome?.snapshot?.weekly_allowance;
  const percent = allowance?.percent_remaining;
  if (percent == null || percent === "" || !Number.isFinite(Number(percent))) {
    return unavailable("unknown", "Haider Code allowance unknown", "The provider did not publish a remaining percentage");
  }
  return null;
}

export function tokenomicsUsageAuthorityPresentation(summary = {}, providerId = "", windowKind = "") {
  const provider = String(providerId || "").trim().toLowerCase();
  if (
    provider === "haider-code"
    && String(windowKind).toLowerCase() === "weekly"
    && summary?.haider_code_plan_status?.supported === true
  ) {
    return planAllowance(summary);
  }

  const authority = summary?.usage_authority;
  const authorityState = String(authority?.state || "unknown").toLowerCase();
  if (authorityState === "unavailable") {
    return unavailable(
      "unavailable",
      "Usage unavailable",
      String(authority?.reason || "The daemon could not publish usage"),
    );
  }
  if (authorityState !== "available") {
    return unavailable(
      "unknown",
      "Usage unknown",
      String(authority?.reason || "No daemon usage report has been published"),
    );
  }

  const meters = Array.isArray(summary?.meter_states) ? summary.meter_states : [];
  const meter = meters.find((row) => normalizedProvider(row) === provider);
  if (!meter) {
    return unavailable("unknown", "Usage unknown", "No meter state was published for this provider");
  }
  const meterState = String(meter?.state || "unknown").toLowerCase();
  if (meterState === "unavailable") {
    return unavailable(
      "unavailable",
      "Provider meter unavailable",
      String(meter?.reason || "The provider meter could not be read"),
    );
  }
  if (meterState === "local_only") {
    return unavailable(
      "local_only",
      "Local usage only",
      "This provider has no server meter; only daemon journal counters are available",
    );
  }
  if (meterState !== "metered") {
    return unavailable("unknown", "Usage unknown", "The daemon published an unknown meter state");
  }
  return null;
}

export function tokenomicsAuthorityLimit(presentation, windowKind = "") {
  if (!presentation) return null;
  return {
    ...presentation,
    authority_state: presentation.state,
    window_kind: windowKind,
    label: windowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit",
    confidence: "unknown",
    paceDelta: null,
    pace_status: "unknown",
    overPace: false,
    plan_detected: false,
    plan_name: presentation.title,
    limit_source: "haider_usage_report",
    status_label: presentation.title,
    reset_label: presentation.detail,
    rate_points: [],
  };
}
