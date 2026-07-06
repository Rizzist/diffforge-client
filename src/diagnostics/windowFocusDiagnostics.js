import { invoke } from "@tauri-apps/api/core";

/*
 * windowFocusDiagnostics — always-on watchdog for the "hover goes dead until I
 * click the app again" class of bug. On macOS, WKWebView hover tracking stops
 * whenever the webview loses first responder / its window loses key status /
 * the app deactivates, and none of those transitions are visible in React.
 * This logs every focus edge with what the user last clicked, so
 * logs/terminal-statuses.jsonl names the exact trigger (e.g. "blur 180ms after
 * pointerdown on the SimpleView workspace row").
 *
 * Idle cost: passive listeners + one comparison per event; entries are
 * rate-limited to bursts around real transitions. Mirrors renderLoopProbe's
 * pattern of invoking terminal_status_log directly.
 */

const FOCUS_LOG_MAX_PER_MINUTE = 60;
const POINTER_TRAIL_SIZE = 5;

let logBudgetWindowStartMs = 0;
let logBudgetUsed = 0;
const pointerTrail = [];
let lastPointerDown = null;

function nowMs() {
  return Date.now();
}

function takeFocusLogBudget() {
  const now = nowMs();
  if (now - logBudgetWindowStartMs > 60_000) {
    logBudgetWindowStartMs = now;
    logBudgetUsed = 0;
  }
  if (logBudgetUsed >= FOCUS_LOG_MAX_PER_MINUTE) {
    return false;
  }
  logBudgetUsed += 1;
  return true;
}

function describeElement(element) {
  if (!element || !element.tagName) {
    return "";
  }
  const tag = element.tagName.toLowerCase();
  const label = element.getAttribute?.("aria-label")
    || element.getAttribute?.("title")
    || "";
  const text = label || (element.textContent || "").trim().slice(0, 48);
  const railRow = element.closest?.("[data-workspace-rail-row-key]");
  const railKey = railRow?.getAttribute?.("data-workspace-rail-row-key") || "";
  return `${tag}[${text.slice(0, 48)}]${railKey ? ` rail=${railKey}` : ""}`;
}

function logFocusEvent(phase, fields = {}) {
  if (!takeFocusLogBudget()) {
    return;
  }
  const sincePointerDownMs = lastPointerDown
    ? Math.max(0, nowMs() - lastPointerDown.atMs)
    : -1;
  invoke("terminal_status_log", {
    phase: `frontend.window_focus.${phase}`,
    fields: {
      source: "frontend",
      documentHasFocus: typeof document !== "undefined" ? document.hasFocus() : null,
      documentVisibility: typeof document !== "undefined" ? document.visibilityState : "",
      lastPointerDownTarget: lastPointerDown?.target || "",
      pointerTrail: pointerTrail.map((entry) => entry.target),
      sincePointerDownMs,
      ...fields,
    },
  }).catch(() => {});
}

// Guard for the workspace-rail bug class: clicking a rail row must never move
// focus out of the shell webview — a row click only selects state. If a blur
// lands within this window of a rail-row pointerdown, something native stole
// first responder (hover app-wide goes dead until the next click), so take
// focus straight back. Scoped to rail rows only: other clicks (web panel
// breakout, PCB popout) legitimately focus new windows.
const RAIL_REFOCUS_WINDOW_MS = 600;
let railRefocusForPointerDown = null;

function maybeReassertRailFocus() {
  if (!lastPointerDown || !lastPointerDown.target.includes(" rail=workspace:")) {
    return;
  }
  if (nowMs() - lastPointerDown.atMs > RAIL_REFOCUS_WINDOW_MS) {
    return;
  }
  if (railRefocusForPointerDown === lastPointerDown) {
    return; // one reassert per click — never fight an intentional focus move
  }
  railRefocusForPointerDown = lastPointerDown;

  window.setTimeout(() => {
    if (document.hasFocus()) {
      return;
    }
    window.focus();
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow?.()?.setFocus?.())
      .catch(() => {});
    logFocusEvent("rail_refocus_applied");
  }, 60);
}

export function installWindowFocusDiagnostics() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  if (window.__forgeWindowFocusDiagnosticsInstalled) {
    return;
  }
  window.__forgeWindowFocusDiagnosticsInstalled = true;

  window.addEventListener("pointerdown", (event) => {
    const entry = { atMs: nowMs(), target: describeElement(event.target) };
    lastPointerDown = entry;
    pointerTrail.push(entry);
    if (pointerTrail.length > POINTER_TRAIL_SIZE) {
      pointerTrail.shift();
    }
  }, true);

  // window blur fires when the webview loses first responder — including to a
  // sibling native child webview inside the SAME window, which is invisible to
  // every other signal.
  window.addEventListener("blur", () => {
    logFocusEvent("blur");
    maybeReassertRailFocus();
  });
  window.addEventListener("focus", () => {
    logFocusEvent("focus");
  });

  // The Tauri window-level signal (key window gained/lost) — distinguishes
  // "webview lost first responder" (JS blur only) from "window lost key"
  // (both fire) from "app deactivated".
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      const currentWindow = getCurrentWindow?.();
      if (!currentWindow?.onFocusChanged) {
        return;
      }
      currentWindow
        .onFocusChanged((event) => {
          logFocusEvent("window_focus_changed", { focused: event?.payload === true });
        })
        .catch(() => {});
    })
    .catch(() => {});
}

installWindowFocusDiagnostics();
