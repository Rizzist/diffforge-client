import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/* Source-introspection wiring pins for the monitor manager (P4). These
   guard the four centralized Tauri dispatches, the per-session surface
   mount fed by AppShell's useMonitor, and the four UI honesty laws. */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function frontendSources(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...frontendSources(path));
    if (entry.isFile()
      && /\.(?:js|jsx|mjs)$/.test(entry.name)
      && !/\.test\.(?:js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test("[pin] useMonitor invokes all four monitor commands with snake_case arg keys", () => {
  const source = read("./useMonitor.js");

  assert.match(source, /invoke\("monitor_list", \{ session_id: sessionId \}\)/,
    "monitor_list must key by session_id");

  const registerStart = source.indexOf('invoke("monitor_register", payload)');
  assert.notEqual(registerStart, -1, "monitor_register must be invoked with its built payload");
  const registerBlock = source.slice(source.lastIndexOf("const payload = {", registerStart), registerStart);
  for (const key of [
    "session_id: sessionId",
    "source,",
    "action: spec.action",
    "occurrence: spec.occurrence",
    "lifetime: spec.lifetime",
  ]) {
    assert.ok(registerBlock.includes(key), `monitor_register must pass ${key}`);
  }
  assert.ok(registerBlock.includes("payload.filter = spec.filter;"),
    "monitor_register must add the optional filter under its snake_case wire key");

  const removeStart = source.indexOf('invoke("monitor_remove", {');
  assert.notEqual(removeStart, -1, "monitor_remove must be invoked");
  const removeBlock = source.slice(removeStart, source.indexOf("});", removeStart));
  for (const key of ["session_id: sessionId", "monitor_id: id"]) {
    assert.ok(removeBlock.includes(key), `monitor_remove must pass ${key}`);
  }

  const watchStart = source.indexOf('invoke("monitor_watch", {');
  assert.notEqual(watchStart, -1, "monitor_watch must be invoked");
  const watchBlock = source.slice(watchStart, source.indexOf("});", watchStart));
  for (const key of ["session_id: sessionId", "after_cursor: position"]) {
    assert.ok(watchBlock.includes(key), `monitor_watch must pass ${key}`);
  }

  assert.doesNotMatch(`${registerBlock}\n${removeBlock}\n${watchBlock}`,
    /\b(?:sessionId|monitorId|afterCursor)\s*:/,
    "monitor command payloads must not use camelCase wire keys");
});

test("[pin] all monitor invokes live only in useMonitor and the panel is presentational", () => {
  const commands = [
    "monitor_list",
    "monitor_register",
    "monitor_remove",
    "monitor_watch",
  ];
  const hook = read("./useMonitor.js");
  const sources = frontendSources(SRC_ROOT);

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `useMonitor must own exactly one ${command} dispatch`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/useMonitor.js"],
      `${command} must be invoked only from useMonitor.js`);
  }
  assert.doesNotMatch(read("./MonitorPanel.jsx"), /invoke\(/,
    "MonitorPanel is presentational and must not call invoke at all");
});

test("[pin] SessionSurface mounts the monitor manager, draft-guarded, and starts and stops it", () => {
  const surface = read("./SessionSurface.jsx");
  assert.match(surface, /import MonitorPanel from "\.\/MonitorPanel\.jsx"/,
    "SessionSurface must import MonitorPanel");

  const toggle = surface.indexOf('selectView("monitors")');
  assert.notEqual(toggle, -1, "the per-session view toggle must offer Monitors");
  const toggleGuard = surface.lastIndexOf('session && session.id !== "draft"', toggle);
  assert.ok(toggleGuard !== -1 && toggle - toggleGuard < 500,
    "the Monitors toggle must be guarded by a real non-draft session");

  const mount = surface.indexOf("<MonitorPanel");
  assert.notEqual(mount, -1, "MonitorPanel must be rendered");
  const mountGuard = surface.lastIndexOf(
    'mode === "monitors" && session && session.id !== "draft"',
    mount,
  );
  assert.ok(mountGuard !== -1 && mount - mountGuard < 500,
    "the monitor host layer must mount only in monitor mode for a real session");
  assert.ok(surface.includes("entry={monitorBySession[session.id]}"),
    "the panel must receive only that session's monitor.list receipt view");
  assert.doesNotMatch(surface, /monitorBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "an unread registry must remain undefined, never collapse into empty");

  assert.ok(surface.includes('(viewModes[id] || "ui") !== "monitors"'),
    "the monitor effect must stop outside monitor mode");
  assert.ok(surface.includes("onLoadMonitors?.(id)"),
    "entering monitor mode must load the registry");
  assert.ok(surface.includes("onStartMonitorWatch?.(id)"),
    "entering monitor mode must start delivery watching");
  assert.ok(surface.includes("onStopMonitorWatch?.()"),
    "leaving monitor mode must stop delivery watching");
});

test("[pin] AppShell owns auth-gated useMonitor and feeds every manager prop", () => {
  const shell = read("../app/AppShell.jsx");
  assert.match(shell, /import \{ useMonitor \} from "\.\.\/sessions\/useMonitor\.js"/,
    "AppShell must import useMonitor");
  assert.match(shell, /const monitorApi = useMonitor\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must call useMonitor gated on authentication like Fleet and Graph");
  for (const prop of [
    "monitorBySession={monitorApi.bySession}",
    "monitorDeliveries={monitorApi.deliveries}",
    "monitorCursor={monitorApi.cursor}",
    "monitorWatchOutcome={monitorApi.watchOutcome}",
    "monitorError={monitorApi.error}",
    "monitorLoading={monitorApi.loading}",
    "monitorUnavailable={monitorApi.unavailable}",
    "onLoadMonitors={monitorApi.list}",
    "onRegisterMonitor={monitorApi.register}",
    "onRemoveMonitor={monitorApi.remove}",
    "onStartMonitorWatch={monitorApi.startWatch}",
    "onStopMonitorWatch={monitorApi.stopWatch}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
});

test("[pin] manager wording preserves tri-state availability, listed-only rows, and structured rejection", () => {
  const model = read("./monitorModel.js");
  const panel = read("./MonitorPanel.jsx");

  assert.match(model, /if \(stateRaw === "available"\)/,
    "only an explicit available state may render available");
  assert.match(model, /return \{ source, state: "unknown", reason: null, stateRaw \};/,
    "absent and unrecognized availability must fall through to unknown");
  assert.ok(panel.includes("availability unknown"),
    "the panel must visibly admit unknown source availability");

  assert.match(panel, /outcome\?\.status === "listed" && outcome\.monitors\.length === 0/,
    "only listed-and-empty may render the empty-monitor claim");
  assert.ok(panel.includes("No monitors registered."),
    "listed-and-empty must have distinct wording");
  assert.ok(panel.includes("Monitor list rejected —"),
    "a rejected list must render rejection rather than zero monitors");

  const registerOutcomeStart = model.indexOf("export function registerOutcomeView");
  const registerOutcomeEnd = model.indexOf("/* The remove outcome", registerOutcomeStart);
  const registerOutcome = model.slice(registerOutcomeStart, registerOutcomeEnd);
  assert.ok(registerOutcome.includes("rejection: rejectionView(outcome.rejection)"),
    "register rejection must pass through the structured rejection view");
  assert.ok(panel.includes("Registration rejected — <RejectionText"),
    "the panel must render a structured register rejection, not a success or bare string");
});

test("[pin] monitor cursors stay decimal strings without numeric parsing in model or hook", () => {
  const model = read("./monitorModel.js");
  const hook = read("./useMonitor.js");

  assert.ok(model.includes("const DECIMAL_CURSOR = /^\\d+$/;"),
    "cursor validation must accept decimal strings only");
  assert.ok(model.includes('export const MONITOR_CURSOR_BASELINE = "0";'),
    "the cursor baseline must be string zero");
  assert.match(model, /typeof value === "string" && DECIMAL_CURSOR\.test\(value\)/,
    "number inputs must be refused before the Tauri boundary can lose precision");
  assert.match(model, /BigInt\(next\) > BigInt\(held\)/,
    "cursor ordering must use BigInt over the validated strings");
  assert.match(hook, /after_cursor: position/,
    "monitor.watch must send the validated string position verbatim");
  assert.ok(hook.includes("advanceWatchCursor(positionRef.current"),
    "the poll loop must advance through the model's verbatim cursor helper");
  for (const [name, source] of [["model", model], ["hook", hook]]) {
    assert.doesNotMatch(source, /\b(?:Number|parseInt)\(/,
      `the monitor ${name} must never numeric-parse a cursor`);
  }
});
