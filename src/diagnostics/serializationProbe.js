import { invoke } from "@tauri-apps/api/core";

/**
 * Serialization watchdog. Native sampling showed multi-second main-thread
 * freezes inside JSC::FastStringifier (JSON.stringify of huge values), but
 * samples only name the engine, not the caller. This wraps JSON.stringify,
 * JSON.parse, and localStorage.setItem: any single call over the threshold
 * reports duration, payload size, and the top call-stack frames (esbuild
 * keepNames preserves real function names), phase
 * "frontend.stringify_probe.slow". Idle cost: one performance.now() pair per
 * call — negligible next to the serialization itself.
 */
const SLOW_MS = 50;
const QUEUE_LIMIT = 10;
const STACK_FRAMES = 8;

let pending = [];
let reporting = false;
let inProbe = false;

function stackTop() {
  try {
    const lines = String(new Error().stack || "").split("\n");
    return lines
      .slice(1)
      .filter((line) => !/serializationProbe|stackTop|reportSlow/.test(line))
      .slice(0, STACK_FRAMES)
      .map((line) => line.trim().replace(/@.*\/assets\//, "@").slice(0, 160));
  } catch {
    return [];
  }
}

function reportSlow(kind, ms, bytes) {
  if (pending.length >= QUEUE_LIMIT) return;
  const mark = window.__DF_LAST_ACTIVATION_MARK;
  pending.push({
    kind,
    ms: Math.round(ms),
    bytes,
    stack: stackTop(),
    activationPhase: mark ? String(mark.phase || "") : "",
  });
  if (reporting) return;
  reporting = true;
  window.setTimeout(() => {
    const events = pending.splice(0, pending.length);
    inProbe = true;
    invoke("terminal_status_log", {
      phase: "frontend.stringify_probe.slow",
      fields: { events },
    }).catch(() => {}).finally(() => {
      inProbe = false;
      reporting = false;
    });
  }, 300);
}

try {
  const originalStringify = JSON.stringify.bind(JSON);
  JSON.stringify = function stringifyProbed(value, replacer, space) {
    if (inProbe) return originalStringify(value, replacer, space);
    const started = performance.now();
    const result = originalStringify(value, replacer, space);
    const ms = performance.now() - started;
    if (ms >= SLOW_MS) {
      reportSlow("stringify", ms, typeof result === "string" ? result.length : 0);
    }
    return result;
  };

  const originalParse = JSON.parse.bind(JSON);
  JSON.parse = function parseProbed(text, reviver) {
    if (inProbe) return originalParse(text, reviver);
    const started = performance.now();
    const result = originalParse(text, reviver);
    const ms = performance.now() - started;
    if (ms >= SLOW_MS) {
      reportSlow("parse", ms, typeof text === "string" ? text.length : 0);
    }
    return result;
  };

  if (typeof Storage !== "undefined" && Storage.prototype && Storage.prototype.setItem) {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemProbed(key, value) {
      const started = performance.now();
      const result = originalSetItem.call(this, key, value);
      const ms = performance.now() - started;
      if (ms >= 20) {
        reportSlow(`localStorage:${String(key).slice(0, 60)}`, ms, String(value ?? "").length);
      }
      return result;
    };
  }
} catch {
  // Diagnostics must never take the app down.
}
