import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applySessionSurfaceStatusEvent,
  surfaceActivityStatusPresentation,
  surfaceRunStatusView,
  surfaceStatusPillView,
  surfaceStatusPresentation,
} from "./sessionStatus.js";

const surfaceSource = readFileSync(new URL("./SessionSurface.jsx", import.meta.url), "utf8");

test("[pin] listener adapter preserves optional fields and clears an absent whole status", () => {
  const sessions = [{ id: "local-1", provider_session_id: "provider-1" }];
  let stored = {
    "local-1": { line: "stale", state: "running_tool", detail: "Compiling" },
    unrelated: { line: "keep me", state: "idle" },
  };
  const setSurfaceStatus = (update) => {
    stored = update(stored);
  };
  const driveListener = (payload) => applySessionSurfaceStatusEvent(
    { payload },
    sessions,
    setSurfaceStatus,
  );

  driveListener({ session_id: "provider-1", status: { line: "ready" } });
  assert.deepEqual(
    stored["local-1"],
    { line: "ready" },
    "listener adapter must store the untouched line-only snapshot, not pre-coerce state/detail",
  );
  assert.equal(Object.hasOwn(stored["local-1"], "state"), false);
  assert.equal(Object.hasOwn(stored["local-1"], "detail"), false);

  driveListener({
    session_id: "provider-1",
    status: { line: "ready", state: null, detail: null },
  });
  assert.deepEqual(stored["local-1"], {
    line: "ready",
    state: null,
    detail: null,
  });
  driveListener({
    session_id: "provider-1",
    status: { line: "ready", state: "", detail: "" },
  });
  assert.deepEqual(stored["local-1"], {
    line: "ready",
    state: "",
    detail: "",
  }, "published empty strings must remain distinguishable from omission");

  driveListener({ session_id: "provider-1", input: { text: "input-only delta" } });
  assert.equal(
    Object.hasOwn(stored, "local-1"),
    false,
    "listener adapter must clear stale structured status when the whole status is absent",
  );
  assert.deepEqual(stored.unrelated, { line: "keep me", state: "idle" });

  assert.match(
    surfaceSource,
    /const surfaceEvent = applySessionSurfaceStatusEvent\(\s*event,\s*sessions,\s*setSurfaceStatus,\s*\)/,
    "SessionSurface must pass the untouched event directly to the listener adapter",
  );
});

test("[pin] pill marks line and local fallbacks as presentation-only", () => {
  assert.deepEqual(surfaceStatusPresentation({
    state: "running_tool",
    detail: "Running cargo",
    line: "[ IDLE ] localized decoration",
  }, { status: "idle" }), {
    authority: "daemon-structured",
    label: "Running cargo",
    source: "daemon-detail",
    structuredStatus: "published",
  });
  assert.deepEqual(surfaceStatusPresentation({
    line: "[ RUNNING ] text only",
  }, { state_raw: "locally_running", status: "running" }), {
    authority: "presentation-only",
    label: "[ RUNNING ] text only",
    source: "daemon-line",
    structuredStatus: "absent",
  }, "the daemon line may be displayed verbatim but never parsed into structured truth");
  assert.deepEqual(surfaceStatusPresentation(null, {
    state_raw: "bridge_running",
    status: "running",
  }), {
    authority: "presentation-only",
    label: "bridge_running",
    source: "local-session",
    structuredStatus: "absent",
  });
  assert.deepEqual(surfaceStatusPresentation({
    line: "display fallback",
    state: "",
  }, { status: "running" }), {
    authority: "presentation-only",
    label: "display fallback",
    source: "daemon-line",
    structuredStatus: "published-empty",
  }, "a published empty value stays distinct but cannot lend authority to fallback text");

  const structuredPill = surfaceStatusPillView({
    state: "running_tool",
    detail: "Running cargo",
    line: "[ IDLE ] localized decoration",
  }, { status: "idle" });
  assert.equal(
    structuredPill.label,
    "Running cargo",
    "pill render seam must keep the visible label aligned with its structured presentation",
  );
  assert.equal(structuredPill.authority, "daemon-structured");
  assert.equal(structuredPill.source, "daemon-detail");
  assert.equal(structuredPill.structuredStatus, "published");

  const linePill = surfaceStatusPillView({
    line: "[ RUNNING ] text only",
  }, { state_raw: "locally_running", status: "running" });
  assert.equal(linePill.label, "[ RUNNING ] text only");
  assert.equal(
    linePill.authority,
    "presentation-only",
    "pill data-status-authority must describe the rendered line label",
  );
  assert.equal(
    linePill.source,
    "daemon-line",
    "pill data-status-source must identify the rendered line label",
  );

  const unavailablePill = surfaceStatusPillView(null, { status: "running" }, {
    detail: "Daemon is offline",
    label: "Unavailable",
  });
  assert.equal(unavailablePill.label, "Unavailable");
  assert.equal(unavailablePill.authority, "availability");
  assert.equal(unavailablePill.source, "session-availability");

  assert.match(
    surfaceSource,
    /data-status-authority=\{statusPillView\.authority\}/,
    "the rendered pill authority must come from the same render seam as its label",
  );
  assert.match(
    surfaceSource,
    /data-status-source=\{statusPillView\.source\}/,
    "the rendered pill source must come from the same render seam as its label",
  );
  assert.match(
    surfaceSource,
    /data-structured-status=\{statusPillView\.structuredStatus\}/,
    "the pill must expose structured absence independently of fallback text",
  );
  assert.match(
    surfaceSource,
    /const statusLine = statusPillView\?\.label \|\| "";[\s\S]*?<span>\{availability\?\.label \|\| statusLine\}<\/span>/,
    "the rendered pill label must come from the provenance-bearing render seam",
  );
});

test("[pin] shimmer never invents working when structured status is absent", () => {
  assert.deepEqual(surfaceActivityStatusPresentation({
    line: "[ RUNNING ] compiling",
  }, { state_raw: "bridge_running" }), {
    authority: "presentation-only",
    label: "[ RUNNING ] compiling",
    source: "daemon-line",
    structuredStatus: "absent",
  });
  assert.deepEqual(surfaceActivityStatusPresentation(null, {
    state_raw: "bridge_running",
  }), {
    authority: "presentation-only",
    label: "bridge_running",
    source: "local-session",
    structuredStatus: "absent",
  });
  assert.equal(
    surfaceActivityStatusPresentation(null, { status: "running" }),
    null,
    "no published line/state/detail or local raw state means no shimmer copy",
  );
  assert.equal(surfaceActivityStatusPresentation({
    line: "decorative strip",
    state: "idle",
  }, { state_raw: "running" }), null, "authoritative structured idle suppresses activity");

  const runningBucketOnly = surfaceRunStatusView(
    null,
    { status: "running" },
    true,
    true,
  );
  assert.equal(
    runningBucketOnly.label,
    "",
    "shimmer render seam must not fabricate Running when activity status is absent",
  );
  assert.equal(runningBucketOnly.authority, undefined);
  assert.equal(runningBucketOnly.source, undefined);

  const unknownBucketOnly = surfaceRunStatusView(
    null,
    { status: "future_bucket" },
    true,
    true,
  );
  assert.equal(
    unknownBucketOnly.label,
    "",
    "shimmer render seam must not fabricate Unknown when activity status is absent",
  );
  assert.match(
    surfaceSource,
    /data-run-status-authority=\{runStatusView\.authority\}/,
    "presentation-only shimmer copy must be distinguishable in the rendered DOM",
  );
  assert.match(
    surfaceSource,
    /data-run-status-source=\{runStatusView\.source\}/,
    "the shimmer source must come from its activity-only render seam",
  );
  assert.match(
    surfaceSource,
    /data-run-structured-status=\{runStatusView\.structuredStatus\}/,
    "the shimmer host must expose that structured status was absent",
  );
  assert.match(
    surfaceSource,
    /runStatus=\{runStatusView\.label\}/,
    "the transcript must receive only the activity render seam's label",
  );
  assert.match(
    surfaceSource,
    /const runStatusView = surfaceRunStatusView\(\s*surfaceStatus\[session\.id\],\s*session,\s*sessionActivityVisualState\(session\) === "running",\s*sessionRunIsActive\(session\),\s*\)/,
    "SessionSurface must drive shimmer label and provenance through one render seam",
  );
});
