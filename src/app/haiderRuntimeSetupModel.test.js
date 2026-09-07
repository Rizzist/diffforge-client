import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_SETUP_STATE,
  INSTALL_PHASES,
  continueWithout,
  decimalBytesOrNull,
  doneView,
  formatBytes,
  installFailed,
  installProgress,
  installRequested,
  installResolved,
  noticeDismissed,
  progressPercent,
  progressView,
  retryStartRequested,
  runtimeErrorView,
  runtimeStatusView,
  setupCompleted,
  setupGateActive,
  setupNoticeVisible,
  startFailed,
  startResolved,
  statusResolved,
  statusUnknown,
} from "./haiderRuntimeSetupModel.js";

const STATUS_MISSING = {
  installed: false,
  version: null,
  running: false,
  install_path: "/Users/u/.local/bin/haider",
  latest_known: null,
  update_available: null,
};

function neededState() {
  return statusResolved(INITIAL_SETUP_STATE, STATUS_MISSING);
}

function installingState() {
  return installRequested(neededState());
}

test("initial checking state does NOT hold the gate: no receipt, no block", () => {
  assert.equal(INITIAL_SETUP_STATE.stage, "checking");
  assert.equal(setupGateActive(INITIAL_SETUP_STATE), false,
    "before any status receipt the gate must stay open — login is never blocked on a guess");
  assert.equal(setupNoticeVisible(INITIAL_SETUP_STATE), false);
});

test("only an EXPLICIT installed:false gates; unconfirmed receipts settle non-blocking unknown", () => {
  for (const receipt of [
    undefined,
    null,
    {},
    { installed: null },
    { installed: "true" },
    { installed: "false" },
    { installed: 0 },
  ]) {
    const settled = statusResolved(INITIAL_SETUP_STATE, receipt);
    assert.equal(settled.stage, "unknown", JSON.stringify(receipt ?? String(receipt)));
    assert.equal(setupGateActive(settled), false,
      "an unconfirmed installed fact must never block login");
    assert.equal(setupNoticeVisible(settled), true);
    assert.equal(typeof settled.statusError.message, "string");
  }
});

test("status installed:false opens the gate as needed; installed:true closes it for good", () => {
  const needed = neededState();
  assert.equal(needed.stage, "needed");
  assert.equal(setupGateActive(needed), true);
  assert.equal(needed.status.installPath, "/Users/u/.local/bin/haider");
  assert.equal(needed.status.version, null);

  const installed = statusResolved(INITIAL_SETUP_STATE, {
    ...STATUS_MISSING,
    installed: true,
    version: "0.0.970",
    running: true,
  });
  assert.equal(installed.stage, "complete");
  assert.equal(setupGateActive(installed), false);
  assert.equal(installed.status.version, "0.0.970");
});

test("status view refuses coerced facts: only explicit booleans/strings survive", () => {
  const view = runtimeStatusView({
    installed: "true",
    version: 970,
    running: 1,
    install_path: null,
    latest_known: "0.0.971",
    update_available: "yes",
  });
  assert.equal(view.installed, false);
  assert.equal(view.version, null);
  assert.equal(view.running, false);
  assert.equal(view.installPath, "");
  assert.equal(view.latestKnown, "0.0.971");
  /* update_available is null until BOTH versions are known — a non-boolean
     stays the honest tri-state null, never a fabricated fact. */
  assert.equal(view.updateAvailable, null);
  assert.equal(runtimeStatusView({ update_available: false }).updateAvailable, false);
});

test("a failed status check is unknown: NON-blocking, notice-only, dismissible", () => {
  const unknown = statusUnknown(INITIAL_SETUP_STATE, {
    code: "io",
    message: "boom",
    retryable: true,
  });
  assert.equal(unknown.stage, "unknown");
  assert.equal(setupGateActive(unknown), false, "absence of knowledge must never block login");
  assert.equal(setupNoticeVisible(unknown), true);
  assert.equal(unknown.statusError.code, "io");

  const dismissed = noticeDismissed(unknown);
  assert.equal(setupNoticeVisible(dismissed), false);
  assert.equal(dismissed.stage, "unknown");
});

test("a late status resolution after the timeout settles nothing", () => {
  const unknown = statusUnknown(INITIAL_SETUP_STATE, { message: "timed out" });
  assert.equal(statusResolved(unknown, STATUS_MISSING), unknown);
  /* foreign-stage guard: statusUnknown outside checking is a no-op */
  const needed = neededState();
  assert.equal(statusUnknown(needed, { message: "late" }), needed);
});

test("install begins only from needed/unknown/failed", () => {
  assert.equal(installingState().stage, "installing");
  const unknown = statusUnknown(INITIAL_SETUP_STATE, { message: "x" });
  assert.equal(installRequested(unknown).stage, "installing");
  const failed = installFailed(installingState(), { retryable: true });
  assert.equal(installRequested(failed).stage, "installing");
  assert.equal(installRequested(failed).failure, null);
  assert.equal(installRequested(INITIAL_SETUP_STATE), INITIAL_SETUP_STATE);
  const complete = statusResolved(INITIAL_SETUP_STATE, { ...STATUS_MISSING, installed: true });
  assert.equal(installRequested(complete), complete);
});

test("progress payloads keep byte counters as VERBATIM decimal strings", () => {
  const beyondDouble = "9007199254740993"; // 2^53 + 1: Number() would corrupt it
  let state = installingState();
  state = installProgress(state, {
    phase: "downloading",
    downloaded_bytes: beyondDouble,
    total_bytes: "18014398509481986",
  });
  assert.equal(state.progress.downloadedBytes, beyondDouble);
  assert.equal(state.progress.totalBytes, "18014398509481986");
  assert.equal(state.progress.phase, "downloading");
});

test("malformed or unknown progress frames are dropped whole", () => {
  const base = installProgress(installingState(), {
    phase: "resolving",
    downloaded_bytes: "0",
    total_bytes: null,
  });
  assert.deepEqual(base.progress, { phase: "resolving", downloadedBytes: "0", totalBytes: null });
  for (const frame of [
    { phase: "exploding", downloaded_bytes: "1", total_bytes: "2" },
    { phase: "downloading", downloaded_bytes: 12, total_bytes: "2" },
    { phase: "downloading", downloaded_bytes: "12.5", total_bytes: "2" },
    { phase: "downloading" },
    null,
  ]) {
    assert.equal(installProgress(base, frame), base, JSON.stringify(frame));
  }
  /* a bad total on a good frame degrades to unknown total, not a guess */
  const badTotal = installProgress(base, {
    phase: "verifying",
    downloaded_bytes: "42",
    total_bytes: "n/a",
  });
  assert.equal(badTotal.progress.totalBytes, null);
  /* progress outside the installing stage is a no-op */
  assert.equal(installProgress(INITIAL_SETUP_STATE, {
    phase: "downloading",
    downloaded_bytes: "1",
    total_bytes: null,
  }), INITIAL_SETUP_STATE);
  assert.ok(INSTALL_PHASES.includes("resolving") && INSTALL_PHASES.length === 4);
});

test("decimal byte strings validate strictly and format through BigInt", () => {
  assert.equal(decimalBytesOrNull("0"), "0");
  assert.equal(decimalBytesOrNull("12.5"), null);
  assert.equal(decimalBytesOrNull(""), null);
  assert.equal(decimalBytesOrNull("-3"), null);
  assert.equal(decimalBytesOrNull(12), null);

  assert.equal(formatBytes("0"), "0 B");
  assert.equal(formatBytes("1023"), "1023 B");
  assert.equal(formatBytes("1536"), "1.5 KB");
  assert.equal(formatBytes("52428800"), "50.0 MB");
  /* 2^53 bytes is exactly 8 PiB — precision survives past double range */
  assert.equal(formatBytes("9007199254740992"), "8.0 PB");
  assert.equal(formatBytes("bogus"), null);
});

test("percent math guards a null/zero total and clamps overshoot", () => {
  assert.equal(progressPercent("10", null), null);
  assert.equal(progressPercent(null, "10"), null);
  assert.equal(progressPercent("10", "0"), null);
  assert.equal(progressPercent("50", "200"), 25);
  assert.equal(progressPercent("300", "200"), 100);
  assert.equal(progressPercent("9007199254740993", "18014398509481986"), 50);
});

test("install receipt moves to starting with verbatim facts", () => {
  const starting = installResolved(installingState(), {
    installed_version: "0.0.970",
    path: "/Users/u/.local/bin/haider",
    restart_needed: true,
  });
  assert.equal(starting.stage, "starting");
  assert.deepEqual(starting.install, {
    installedVersion: "0.0.970",
    path: "/Users/u/.local/bin/haider",
    restartNeeded: true,
  });
  /* a malformed receipt never fabricates a version */
  const vague = installResolved(installingState(), {});
  assert.equal(vague.install.installedVersion, null);
  assert.equal(vague.install.restartNeeded, false);
});

test("rejections carry code/message and Retry needs an EXPLICIT retryable:true", () => {
  assert.deepEqual(runtimeErrorView({ code: "network", message: "down", retryable: true }), {
    code: "network",
    message: "down",
    retryable: true,
  });
  assert.equal(runtimeErrorView({ retryable: "true" }).retryable, false);
  assert.equal(runtimeErrorView("boom").message, "boom");
  assert.equal(runtimeErrorView(null).message, "The command failed.");

  const failed = installFailed(installingState(), { code: "checksum_mismatch", message: "bad" });
  assert.equal(failed.stage, "failed");
  assert.equal(failed.failure.during, "install");
  assert.equal(failed.failure.retryable, false);
  assert.equal(setupGateActive(failed), true);
});

test("daemon start outcomes render only what the command returned", () => {
  const starting = installResolved(installingState(), {
    installed_version: "0.0.970",
    path: "/p",
    restart_needed: false,
  });
  const started = doneView(startResolved(starting, { started: true, error: null }));
  assert.equal(started.daemon, "started");
  assert.equal(started.restartPending, false);
  assert.equal(
    doneView(startResolved(starting, { started: false, error: null })).daemon,
    "already_running",
  );
  const diagnosed = doneView(startResolved(starting, { started: false, error: "early exit" }));
  assert.equal(diagnosed.daemon, "start_error");
  assert.equal(diagnosed.startError, "early exit");
});

test("restart_needed is a separate conservative flag that never masks the start outcome", () => {
  const starting = installResolved(installingState(), {
    installed_version: "0.0.970",
    path: "/p",
    restart_needed: true,
  });
  /* restart_needed also covers UNKNOWN endpoint health — it must ride
     alongside the actual start outcome, never replace it. */
  const done = doneView(startResolved(starting, { started: true, error: null }));
  assert.equal(done.restartPending, true);
  assert.equal(done.daemon, "started");
  const errored = doneView(startResolved(starting, { started: false, error: "early exit" }));
  assert.equal(errored.restartPending, true);
  assert.equal(errored.daemon, "start_error",
    "a reported start error must stay visible even when a restart is pending");
  assert.equal(errored.startError, "early exit");
});

test("a failed daemon start retries the start leg, not the install", () => {
  const starting = installResolved(installingState(), { installed_version: "1", path: "/p" });
  const failed = startFailed(starting, { code: "start_failed", message: "no", retryable: true });
  assert.equal(failed.failure.during, "start");
  const retried = retryStartRequested(failed);
  assert.equal(retried.stage, "starting");
  assert.equal(retried.failure, null);
  /* an install failure never takes the start-retry path */
  const installBroken = installFailed(installingState(), { retryable: true });
  assert.equal(retryStartRequested(installBroken), installBroken);
});

test("continue-without skips only from a decision point; done auto-completes", () => {
  assert.equal(continueWithout(neededState()).stage, "skipped");
  assert.equal(continueWithout(statusUnknown(INITIAL_SETUP_STATE, {})).stage, "skipped");
  assert.equal(continueWithout(installFailed(installingState(), {})).stage, "skipped");
  /* no mid-install cancel: the SDK has no cancel and one mutation runs at a time */
  const installing = installingState();
  assert.equal(continueWithout(installing), installing);

  const done = startResolved(
    installResolved(installing, { installed_version: "1", path: "/p" }),
    { started: true, error: null },
  );
  assert.equal(setupGateActive(done), true, "the outcome hold still owns the screen");
  const complete = setupCompleted(done);
  assert.equal(complete.stage, "complete");
  assert.equal(setupGateActive(complete), false);
  const needed = neededState();
  assert.equal(setupCompleted(needed), needed);
});

test("progress view is indeterminate until the daemon publishes counters", () => {
  assert.deepEqual(progressView(installingState()), {
    phaseLabel: "Preparing",
    downloadedText: null,
    totalText: null,
    percent: null,
  });
  const mid = installProgress(installingState(), {
    phase: "downloading",
    downloaded_bytes: "1048576",
    total_bytes: "4194304",
  });
  assert.deepEqual(progressView(mid), {
    phaseLabel: "Downloading",
    downloadedText: "1.0 MB",
    totalText: "4.0 MB",
    percent: 25,
  });
  const unsized = installProgress(installingState(), {
    phase: "verifying",
    downloaded_bytes: "2048",
    total_bytes: null,
  });
  assert.equal(progressView(unsized).percent, null);
  assert.equal(progressView(unsized).totalText, null);
  assert.equal(progressView(unsized).downloadedText, "2.0 KB");
});
