import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activeSessionSyncReport,
  createSessionSyncLifecycleReporter,
  projectionCaughtUp,
  railSyncPillState,
  sessionSyncTransportState,
  sessionSyncUnmountReport,
  transcriptSyncReport,
} from "./sessionSync.js";

test("omitted synchronization truth stays unknown", () => {
  assert.equal(projectionCaughtUp({ caught_up: true }), true);
  assert.equal(projectionCaughtUp({ caught_up: false }), false);
  assert.equal(projectionCaughtUp({}), null);
  assert.equal(projectionCaughtUp(null), null);
});

test("the rail sync pill names syncing, synced, and unobserved states separately", () => {
  assert.deepEqual(railSyncPillState(true), {
    state: "syncing",
    label: "Syncing",
    ariaLabel: "Syncing session history — open sync activity",
    title: "Syncing this session's history — click for the sync inbox/outbox",
  });
  assert.deepEqual(railSyncPillState(false), {
    state: "synced",
    label: "Synced",
    ariaLabel: "Session history synced — open sync activity",
    title: "Synced — click for the sync inbox/outbox",
  });

  const unknown = railSyncPillState(null);
  assert.deepEqual(unknown, {
    state: "unknown",
    label: "Sync unknown",
    ariaLabel: "Session history sync state not observed — open sync activity",
    title: "No session history has been observed yet — click for the sync inbox/outbox",
  });
  assert.doesNotMatch(
    `${unknown.label} ${unknown.ariaLabel} ${unknown.title}`,
    /\bsynced\b/i,
  );
});

test("unobserved sync survives Transcript to Surface to AppShell", () => {
  const transcriptReport = transcriptSyncReport("ready", null);
  assert.equal(transcriptReport, null);

  const surfaceReports = {
    "session-7": sessionSyncTransportState(transcriptReport),
  };
  const surfaceReport = activeSessionSyncReport(false, "session-7", surfaceReports);
  assert.equal(surfaceReport, null);

  const appReport = sessionSyncTransportState(surfaceReport);
  assert.equal(appReport, null);
  assert.equal(railSyncPillState(appReport).state, "unknown");

  // node:test has no JSX transform/runtime in this repo. These narrow wiring
  // pins complement the behavioral transport test and ensure each shipping
  // component actually consumes that mapping instead of Boolean-coercing it.
  const transcriptSource = readFileSync(new URL("./SessionTranscript.jsx", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("./SessionSurface.jsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  assert.match(transcriptSource, /const syncing = transcriptSyncReport\(loadState, caughtUp\)/);
  assert.match(transcriptSource, /onSyncingChangeRef\.current\?\.\(sessionSyncUnmountReport\(\)\)/);
  assert.match(surfaceSource, /const reported = sessionSyncTransportState\(syncing\)/);
  assert.match(surfaceSource, /const activeTranscriptSyncing = activeSessionSyncReport\(/);
  assert.match(surfaceSource, /createSessionSyncLifecycleReporter\(onSyncingChange\)/);
  assert.match(surfaceSource, /syncLifecycle\.report\(activeTranscriptSyncing\)/);
  assert.match(surfaceSource, /syncLifecycle\.unmount\(\)/);
  assert.match(appSource, /setSessionHistorySyncing\(sessionSyncTransportState\(syncing\)\)/);
  assert.match(appSource, /onSyncingChange=\{handleSessionHistorySyncing\}/);
});

test("SessionSurface lifecycle retracts its last sync claim on unmount", () => {
  const reports = [];
  const lifecycle = createSessionSyncLifecycleReporter((syncing) => {
    reports.push(syncing);
  });

  lifecycle.report(true);
  lifecycle.unmount();

  assert.deepEqual(reports, [true, null]);
  assert.equal(railSyncPillState(reports.at(-1)).state, "unknown");
  assert.equal(sessionSyncUnmountReport(), null);
});
