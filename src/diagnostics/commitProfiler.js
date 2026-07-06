import { invoke } from "@tauri-apps/api/core";

/**
 * React <Profiler> sink for the workspace runtime subtree. Debug bundles use
 * react-dom/profiling (vite alias), so onRender reports real commit
 * durations. Any commit blocking longer than SLOW_COMMIT_MS is reported
 * (phase "frontend.commit_profiler.slow") with the active workspace-activation
 * phase, which names the exact subtree behind switch-lag freezes.
 * No-op overhead per fast commit: one number compare.
 */
const SLOW_COMMIT_MS = 100;
const QUEUE_LIMIT = 12;

let pending = [];
let reporting = false;

function flush() {
  if (reporting || !pending.length) return;
  reporting = true;
  const commits = pending.splice(0, pending.length);
  invoke("terminal_status_log", {
    phase: "frontend.commit_profiler.slow",
    fields: { commits },
  }).catch(() => {}).finally(() => {
    reporting = false;
  });
}

export function onRuntimeProfilerRender(id, phase, actualDuration, baseDuration) {
  if (actualDuration < SLOW_COMMIT_MS) return;
  if (pending.length >= QUEUE_LIMIT) return;
  const mark = typeof window !== "undefined" ? window.__DF_LAST_ACTIVATION_MARK : null;
  pending.push({
    id: String(id || ""),
    phase: String(phase || ""),
    actualMs: Math.round(actualDuration),
    baseMs: Math.round(baseDuration),
    activationPhase: mark ? String(mark.phase || "") : "",
    activationMsAgo: mark ? Math.round(performance.now() - Number(mark.t || 0)) : -1,
  });
  // Report after the commit settles, never inside it.
  window.setTimeout(flush, 250);
}
