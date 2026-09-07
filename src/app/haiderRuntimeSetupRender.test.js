import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  INITIAL_SETUP_STATE,
  installFailed,
  installProgress,
  installRequested,
  installResolved,
  startResolved,
  statusResolved,
  statusUnknown,
} from "./haiderRuntimeSetupModel.js";

/* ACTUAL render regression for the setup surfaces (same vite SSR pattern as
   tokenomicsLedgerHonesty.test.js). The shipped P1 was an undefined styled
   component (`ByteLine`) that only the real installing-progress branch
   reached: the source-scanning wiring tests and the web build both passed
   while the first Install click crashed the interface. These tests render
   every reachable screen state to markup, so any undefined component or
   broken branch throws here first. */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let server;
let render;
let renderNotice;

before(async () => {
  const [{ default: React }, { renderToStaticMarkup }, { createServer }] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("vite"),
  ]);
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    root: REPO_ROOT,
    server: { middlewareMode: true },
    ssr: { noExternal: ["styled-components"] },
  });
  const { default: Screen, HaiderRuntimeSetupNotice } = await server.ssrLoadModule(
    "/src/app/HaiderRuntimeSetup.jsx",
  );
  render = (state) => renderToStaticMarkup(React.createElement(Screen, {
    onContinueWithout: () => {},
    onInstall: () => {},
    onRetry: () => {},
    onTitleBarMouseDown: null,
    state,
  }));
  renderNotice = (state) => renderToStaticMarkup(React.createElement(HaiderRuntimeSetupNotice, {
    onDismiss: () => {},
    onInstall: () => {},
    state,
  }));
});

after(async () => {
  await server?.close();
});

const STATUS_MISSING = {
  installed: false,
  version: null,
  running: false,
  install_path: "/Users/u/.local/bin/haider",
  latest_known: null,
  update_available: null,
};

test("[pin] the full install journey RENDERS: needed, live progress, starting, done", () => {
  assert.match(render(INITIAL_SETUP_STATE), /Checking for the Haider runtime/);

  const needed = statusResolved(INITIAL_SETUP_STATE, STATUS_MISSING);
  const neededMarkup = render(needed);
  assert.match(neededMarkup, /Set up the Haider runtime/);
  assert.match(neededMarkup, /Install Haider runtime/);
  assert.match(neededMarkup, /Continue without it/);
  assert.match(neededMarkup, /Installs to \/Users\/u\/\.local\/bin\/haider/);

  const installing = installRequested(needed);
  assert.match(render(installing), /Preparing/, "pre-event install must render indeterminate");

  /* The branch that crashed the signed candidate: a real progress payload. */
  const sized = installProgress(installing, {
    phase: "downloading",
    downloaded_bytes: "1048576",
    total_bytes: "4194304",
  });
  const sizedMarkup = render(sized);
  assert.match(sizedMarkup, /Downloading/);
  assert.match(sizedMarkup, /1\.0 MB of 4\.0 MB/, "the byte line must render real counters");
  assert.match(sizedMarkup, /aria-valuenow="25"/);
  assert.match(sizedMarkup, /role="progressbar"/);

  /* Even the first resolving payload ("0" / null) reaches the byte line. */
  const resolving = installProgress(installing, {
    phase: "resolving",
    downloaded_bytes: "0",
    total_bytes: null,
  });
  const resolvingMarkup = render(resolving);
  assert.match(resolvingMarkup, /Resolving latest release/);
  assert.match(resolvingMarkup, /0 B so far/);
  assert.doesNotMatch(resolvingMarkup, /aria-valuenow/,
    "an unknown total must render indeterminate, never a fabricated percent");

  const starting = installResolved(sized, {
    installed_version: "0.0.970",
    path: "/Users/u/.local/bin/haider",
    restart_needed: false,
  });
  const startingMarkup = render(starting);
  assert.match(startingMarkup, /Starting the Haider daemon/);
  assert.match(startingMarkup, /Installed 0\.0\.970\./);

  const done = startResolved(starting, { started: true, error: null });
  const doneMarkup = render(done);
  assert.match(doneMarkup, /Haider runtime installed/);
  assert.match(doneMarkup, /The daemon started and is reachable\./);
  assert.match(doneMarkup, /Continuing to sign-in/);
  assert.doesNotMatch(doneMarkup, /may still be pending/,
    "no restart caveat may appear without restart_needed:true");
});

test("[pin] rendered outcomes preserve uncertainty: restart caveat, start errors, retry gating", () => {
  const needed = statusResolved(INITIAL_SETUP_STATE, STATUS_MISSING);
  const starting = installResolved(installRequested(needed), {
    installed_version: "0.0.970",
    path: "/p",
    restart_needed: true,
  });

  /* restart_needed:true also covers unknown endpoint health: the caveat is
     conditional AND the actual start outcome stays on screen. */
  const errored = render(startResolved(starting, { started: false, error: "early exit" }));
  assert.match(errored, /The daemon did not confirm it is running: early exit/);
  assert.match(errored, /A daemon restart may still be pending/);
  assert.match(errored, /if a daemon was already running/);
  assert.doesNotMatch(errored, /daemon started and is reachable/);

  const reachable = render(startResolved(starting, { started: false, error: null }));
  assert.match(reachable, /A daemon was already reachable\./);
  assert.match(reachable, /may still be pending/);

  const retryable = render(installFailed(installRequested(needed), {
    code: "network",
    message: "download interrupted",
    retryable: true,
  }));
  assert.match(retryable, /Setup did not finish/);
  assert.match(retryable, /download interrupted/);
  assert.match(retryable, /Error code: network/);
  assert.match(retryable, />Retry</);

  const terminal = render(installFailed(installRequested(needed), {
    code: "checksum_mismatch",
    message: "bad archive",
    retryable: false,
  }));
  assert.match(terminal, /bad archive/);
  assert.doesNotMatch(terminal, />Retry</,
    "Retry must not render without an explicitly retryable rejection");
  assert.match(terminal, /Continue without it/);

  const unknown = statusUnknown(INITIAL_SETUP_STATE, {
    code: "io",
    message: "probe failed",
    retryable: true,
  });
  const notice = renderNotice(unknown);
  assert.match(notice, /Could not check whether the Haider runtime is installed/);
  assert.match(notice, /probe failed/);
  assert.match(notice, /Set up Haider/);
  assert.match(notice, /Dismiss/);
});
