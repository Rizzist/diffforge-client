import { invoke } from "@tauri-apps/api/core";

/**
 * Main-thread freeze watchdog. WebKit has no `longtask` PerformanceObserver,
 * so freezes are measured by tick-gap: a 100ms heartbeat that arrives late by
 * >250ms means the main thread was blocked for that long. Each freeze is
 * reported (phase "frontend.freeze_probe.freeze") with the most recent
 * workspace-activation phase mark, so "switching is laggy" maps to an exact
 * blocking duration and the activation step it happened inside.
 * Idle cost: one timestamp compare per 100ms.
 */
const TICK_MS = 100;
const FREEZE_THRESHOLD_MS = 250;
const REPORT_MIN_INTERVAL_MS = 1000;

let lastTick = performance.now();
let lastReportAt = 0;
let pendingFreezes = [];

const ACTIVATION_MARK_FRESH_MS = 15_000;

function lastActivationMark() {
  const mark = window.__DF_LAST_ACTIVATION_MARK;
  if (!mark || typeof mark !== "object") return null;
  const msAgo = Math.round(performance.now() - Number(mark.t || 0));
  // A stale mark misattributes unrelated freezes to a long-finished
  // activation (324s of a prior capture blamed 5-minute-old phases).
  if (msAgo > ACTIVATION_MARK_FRESH_MS) return null;
  return {
    phase: String(mark.phase || ""),
    msAgo,
    workspace_id: String(mark.workspace_id || ""),
  };
}

function flushFreezes() {
  if (!pendingFreezes.length) return;
  const now = performance.now();
  if (now - lastReportAt < REPORT_MIN_INTERVAL_MS) return;
  lastReportAt = now;
  const freezes = pendingFreezes;
  pendingFreezes = [];
  invoke("terminal_status_log", {
    phase: "frontend.freeze_probe.freeze",
    fields: {
      freezes: freezes.slice(0, 12),
      freeze_count: freezes.length,
      worst_ms: Math.max(...freezes.map((f) => f.blockedMs)),
    },
  }).catch(() => {});
}

function tick() {
  const now = performance.now();
  const gap = now - lastTick;
  lastTick = now;
  // Hidden/occluded windows get timer throttling — those gaps are not
  // freezes. visibilityState alone misses occluded/other-Space windows
  // (WebKit throttles timers to 1s while it still reads "visible" — a prior
  // capture logged ~490s of phantom 900ms "freezes" at exactly 1s cadence).
  // The renderability gate (html[data-render-paused]) knows true occlusion.
  if (document.visibilityState !== "visible") {
    return;
  }
  if (document.documentElement?.dataset?.renderPaused === "true") {
    return;
  }
  // Unfocused-but-visible windows also get WebKit timer throttling (observed:
  // trains of exactly-900ms "freezes" with hasFocus()===false). The user
  // cannot feel lag in a window they are not interacting with — only count
  // blocking while focused.
  if (typeof document.hasFocus === "function" && !document.hasFocus()) {
    return;
  }
  const blockedMs = Math.round(gap - TICK_MS);
  if (blockedMs >= FREEZE_THRESHOLD_MS) {
    pendingFreezes.push({
      blockedMs,
      at: Math.round(now),
      activation: lastActivationMark(),
      focused: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      visible: document.visibilityState,
    });
    flushFreezes();
  }
}

try {
  window.setInterval(tick, TICK_MS);
  window.setInterval(flushFreezes, 2000);
} catch {
  // Diagnostics must never take the app down.
}
