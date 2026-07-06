import { invoke } from "@tauri-apps/api/core";

/**
 * IPC traffic watchdog. Cold-start profiling showed ~800% CPU for ~25s inside
 * Tauri's IPC machinery with no spanned command hot — the burn is traffic
 * VOLUME. This probe counts (a) every invoke by command name and (b) every
 * delivered Tauri EVENT by event name (via transformCallback, which every
 * listener callback passes through). When a 5s window exceeds the storm
 * threshold it reports the census (phase "frontend.invoke_probe.storm").
 * Idle cost: one Map increment per invoke/event.
 */
const WINDOW_MS = 5000;
const STORM_THRESHOLD = 150;
const TOP_LIMIT = 24;

const invokeCounts = new Map();
const eventCounts = new Map();
let windowInvokes = 0;
let windowEvents = 0;
let totalInvokes = 0;
let totalEvents = 0;
let stormWindows = 0;
let reporting = false;

let installFailed = false;

function countEventDelivery(payload) {
  const name = payload && typeof payload === "object" && typeof payload.event === "string"
    ? payload.event
    : null;
  if (!name) return;
  windowEvents += 1;
  totalEvents += 1;
  eventCounts.set(name, (eventCounts.get(name) || 0) + 1);
}

function wrapTransformCallback(originalTransform, target) {
  return (callback, once) => {
    if (typeof callback !== "function") {
      return originalTransform.call(target, callback, once);
    }
    const countingCallback = (payload) => {
      countEventDelivery(payload);
      return callback(payload);
    };
    return originalTransform.call(target, countingCallback, once);
  };
}

function installProbe() {
  if (installFailed) {
    return true;
  }
  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function" || internals.__invokeProbe) {
    return false;
  }
  const originalInvoke = internals.invoke.bind(internals);
  const countedInvoke = (cmd, args, options) => {
    windowInvokes += 1;
    totalInvokes += 1;
    invokeCounts.set(cmd, (invokeCounts.get(cmd) || 0) + 1);
    return originalInvoke(cmd, args, options);
  };
  const originalTransform = typeof internals.transformCallback === "function"
    ? internals.transformCallback
    : null;
  const countedTransform = originalTransform
    ? wrapTransformCallback(originalTransform, internals)
    : null;
  // __TAURI_INTERNALS__ may be frozen; a plain assignment throws
  // "Attempted to assign to readonly property" and, at first-import position,
  // would take the whole bundle down. Prefer patching the object; fall back to
  // replacing the window property with a delegating Proxy; degrade to no probe.
  try {
    Object.defineProperty(internals, "invoke", {
      value: countedInvoke,
      configurable: true,
      writable: true,
    });
    if (countedTransform) {
      Object.defineProperty(internals, "transformCallback", {
        value: countedTransform,
        configurable: true,
        writable: true,
      });
    }
    internals.__invokeProbe = true;
    return true;
  } catch {
    // frozen object — try the window-property seam below
  }
  try {
    const proxy = new Proxy(internals, {
      get(target, prop, receiver) {
        if (prop === "invoke") return countedInvoke;
        if (prop === "transformCallback" && countedTransform) return countedTransform;
        if (prop === "__invokeProbe") return true;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: proxy,
      configurable: true,
      writable: true,
    });
  } catch {
    installFailed = true;
  }
  return true;
}

function flushWindow() {
  const invokes = windowInvokes;
  const events = windowEvents;
  windowInvokes = 0;
  windowEvents = 0;
  if (invokes + events < STORM_THRESHOLD) {
    invokeCounts.clear();
    eventCounts.clear();
    return;
  }
  stormWindows += 1;
  const topInvokes = [...invokeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIMIT)
    .map(([name, count]) => `${name}x${count}`);
  const topEvents = [...eventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIMIT)
    .map(([name, count]) => `${name}x${count}`);
  invokeCounts.clear();
  eventCounts.clear();
  if (reporting) return;
  reporting = true;
  invoke("terminal_status_log", {
    phase: "frontend.invoke_probe.storm",
    fields: {
      invokesPerWindow: invokes,
      eventsPerWindow: events,
      windowMs: WINDOW_MS,
      stormWindows,
      totalInvokes,
      totalEvents,
      topInvokes,
      topEvents,
    },
  }).catch(() => {}).finally(() => {
    reporting = false;
  });
}

try {
  if (!installProbe()) {
    // __TAURI_INTERNALS__ lands before app scripts in Tauri v2, but stay safe.
    const retry = window.setInterval(() => {
      if (installProbe()) window.clearInterval(retry);
    }, 50);
    window.setTimeout(() => window.clearInterval(retry), 5000);
  }
  window.setInterval(flushWindow, WINDOW_MS);
} catch {
  // Diagnostics must never take the app down.
}
