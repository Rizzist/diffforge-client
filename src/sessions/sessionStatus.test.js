import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adoptSurfaceCallerIdentity,
  applySessionSurfaceStatusEvent,
  surfaceActivityStatusPresentation,
  surfaceInputMirrorPlan,
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

/* ---- input_mirror_v1 owner discrimination (A03 / W8.3) ------------------- */

/* The component's apply effect advances the per-owner floor from the plan
   (pinned against the source below); the driver mirrors exactly that one
   line so multi-frame scenarios stay behavioral. */
function driveMirrorFrame(input, context) {
  const plan = surfaceInputMirrorPlan(input, context);
  if (plan.kind === "apply") {
    (context.floors ||= {})[plan.owner] = plan.revision;
  }
  return plan;
}

test("[pin A03] published caller identity: an identical foreign text+revision is never adopted as self and later edits survive", () => {
  /* Our own publish of revision "3" is still pending in history — the exact
     bait the old echo-matcher took. */
  const context = {
    callerOwner: "caller:opaque/007",
    learnedOwner: "",
    history: new Map([["3", "same text"]]),
    floors: {},
  };

  const foreignTwin = driveMirrorFrame(
    { text: "same text", revision: "3", owner: "foreign-publisher" },
    context,
  );
  assert.equal(
    foreignTwin.kind,
    "apply",
    "identical text+revision from a FOREIGN owner must apply — identity equality, not echo resemblance, decides self",
  );
  assert.equal(foreignTwin.text, "same text");
  assert.equal(
    foreignTwin.learnOwner,
    undefined,
    "a foreign frame must never rename the caller",
  );

  const laterEdit = driveMirrorFrame(
    { text: "the later edit", revision: "4", owner: "foreign-publisher" },
    context,
  );
  assert.equal(laterEdit.kind, "apply", "the foreign publisher's later edit must survive");
  assert.equal(laterEdit.text, "the later edit");

  /* Our own frame still drops — by identity, with nothing left to learn. */
  const ownEcho = driveMirrorFrame(
    { text: "same text", revision: "3", owner: "caller:opaque/007" },
    context,
  );
  assert.deepEqual(ownEcho, { kind: "self-echo", learnOwner: "" });
});

test("[pin A03] a delayed self-echo never yields apply, so newer local typing and attachments survive", () => {
  /* Identity path: the daemon named us; a stale echo of our old publish
     returns self-echo — a kind the component never writes composer state
     from (no `text` rides a self-echo plan). */
  const identityEcho = surfaceInputMirrorPlan(
    { text: "hello", revision: "1", owner: "caller:opaque/007" },
    { callerOwner: "caller:opaque/007", learnedOwner: "", history: null, floors: {} },
  );
  assert.equal(identityEcho.kind, "self-echo");
  assert.equal("text" in identityEcho, false, "a self-echo plan must carry no apply payload");

  /* Legacy path: the exact revision+text echo likewise never applies. */
  const legacyEcho = surfaceInputMirrorPlan(
    { text: "hello", revision: "1", owner: "conn:self" },
    { callerOwner: "", learnedOwner: "", history: new Map([["1", "hello"]]), floors: {} },
  );
  assert.equal(legacyEcho.kind, "self-echo");
  assert.equal("text" in legacyEcho, false);

  /* And the component writes composer text/pastes/attachments only inside
     the apply branch — the self-echo branch touches mirror chips alone. */
  const listenerBlock = surfaceSource.slice(
    surfaceSource.indexOf("const plan = surfaceInputMirrorPlan"),
    surfaceSource.indexOf("session_seen_v1"),
  );
  const selfEchoBranch = listenerBlock.slice(
    listenerBlock.indexOf('plan.kind === "self-echo"'),
    listenerBlock.indexOf('plan.kind === "apply"'),
  );
  assert.doesNotMatch(selfEchoBranch, /setComposerTexts|setComposerPastes|setComposerAttachments/,
    "the self-echo branch must never write composer text, pastes, or staged attachments");
  assert.match(listenerBlock, /else if \(plan\.kind === "apply"\) \{\s*const floors = \(mirrorForeignRef\.current\[local\.id\] \|\|= \{\}\);\s*floors\[plan\.owner\] = plan\.revision;/,
    "the apply branch must advance exactly the plan's per-owner floor");
});

test("[pin] absent caller_owner keeps the documented 969 echo-matching fallback, and never fabricates an identity", () => {
  /* Captured live 969 watch adoption (w8.3-sdk-impl): no caller_owner key. */
  const legacyAdoption = { session_id: "session-143ba92a4284541770268f50a52ee225", input: null, status: null };
  assert.equal(Object.hasOwn(legacyAdoption, "caller_owner"), false);
  assert.equal(surfaceInputMirrorPlan(legacyAdoption.input, {}).kind, "none");

  const context = { callerOwner: "", learnedOwner: "", history: new Map([["2", "draft text"]]), floors: {} };

  /* An exact revision+text echo of our publish teaches the owner. */
  const echo = driveMirrorFrame({ text: "draft text", revision: "2", owner: "conn:self" }, context);
  assert.deepEqual(echo, { kind: "self-echo", learnOwner: "conn:self" });
  context.learnedOwner = echo.learnOwner;
  context.history = new Map();

  /* Later frames from the learned owner drop as echoes. */
  assert.equal(
    driveMirrorFrame({ text: "anything else", revision: "5", owner: "conn:self" }, context).kind,
    "drop",
  );

  /* A fresh foreign publisher's revision 1 applies; its stale replay does not. */
  assert.equal(
    driveMirrorFrame({ text: "tui typed", revision: "1", owner: "conn:tui" }, context).kind,
    "apply",
  );
  assert.equal(
    driveMirrorFrame({ text: "stale replay", revision: "1", owner: "conn:tui" }, context).kind,
    "drop",
  );

  /* Ownerless frames stay appliable — absence of identity is never treated
     as ours. */
  assert.equal(
    driveMirrorFrame({ text: "ownerless", revision: "9", owner: "" }, context).kind,
    "apply",
  );
});

test("[pin] revisions are decimal strings, compared as decimals and never Number()ed", () => {
  /* Adjacent u64 revisions above 2^53 collapse to equal under Number();
     decimal comparison must still see the advance. */
  assert.equal(
    surfaceInputMirrorPlan(
      { text: "beyond 2^53", revision: "9007199254740993", owner: "conn:tui" },
      { callerOwner: "caller:me", floors: { "conn:tui": "9007199254740992" } },
    ).kind,
    "apply",
  );
  assert.equal(
    surfaceInputMirrorPlan(
      { text: "stale", revision: "9007199254740992", owner: "conn:tui" },
      { callerOwner: "caller:me", floors: { "conn:tui": "9007199254740993" } },
    ).kind,
    "drop",
  );
  /* Length beats lexicographic order: "10" advances past "9". */
  assert.equal(
    surfaceInputMirrorPlan(
      { text: "ten", revision: "10", owner: "o" },
      { callerOwner: "caller:me", floors: { o: "9" } },
    ).kind,
    "apply",
  );
  /* u64 max stays comparable. */
  assert.equal(
    surfaceInputMirrorPlan(
      { text: "max", revision: "18446744073709551615", owner: "o" },
      { callerOwner: "caller:me", floors: { o: "9999999999999999999" } },
    ).kind,
    "apply",
  );
  /* Legacy echo matching keys history by the decimal string too. */
  assert.equal(
    surfaceInputMirrorPlan(
      { text: "big echo", revision: "9007199254740993", owner: "conn:self" },
      { callerOwner: "", history: new Map([["9007199254740993", "big echo"]]), floors: {} },
    ).kind,
    "self-echo",
  );
  assert.match(
    surfaceSource,
    /history\.set\(String\(revision\), text\);/,
    "our publish history must key by the decimal string the echo will carry",
  );
  assert.doesNotMatch(
    surfaceSource,
    /Number\([^)]*revision/i,
    "mirror revisions must never pass through Number()",
  );
});

test("[pin A03] SessionSurface adopts caller_owner verbatim at the event barrier and drives the mirror through the plan", () => {
  /* Adoption: every accepted payload replaces the retained identity through
     the barrier seam — present adopts verbatim, absence clears (the SDK
     stamps the watch's identity on every emitted payload, so an omitted
     field can only come from a watch that established none). */
  assert.match(
    surfaceSource,
    /mirrorCallerOwnerRef\.current = adoptSurfaceCallerIdentity\(\s*payload,\s*mirrorCallerOwnerRef\.current,\s*\);/,
    "every accepted payload must replace the retained identity through the barrier seam",
  );
  assert.equal(
    (surfaceSource.match(/mirrorCallerOwnerRef\.current =/g) || []).length,
    1,
    "nothing but the barrier seam may write the published caller identity",
  );
  /* Discrimination: one plan call fed by the adopted identity, the legacy
     learned owner, our publish history, and the per-owner floors. */
  assert.match(
    surfaceSource,
    /const plan = surfaceInputMirrorPlan\(payload\.input, \{\s*callerOwner: mirrorCallerOwnerRef\.current,\s*learnedOwner: mirrorSelfOwnerRef\.current,\s*history: mirrorHistoryRef\.current\[local\.id\],\s*floors: mirrorForeignRef\.current\[local\.id\],\s*\}\);/,
    "the listener must delegate owner discrimination to surfaceInputMirrorPlan",
  );
  /* The SDK's documented new-daemon fixture flows through the same seam. */
  const fixture = JSON.parse('{"session_id":"session-143ba92a4284541770268f50a52ee225","caller_owner":"caller:opaque/007","input":{"text":"same text","revision":"9007199254740993","owner":"foreign-publisher"},"status":{"line":"working","revision":"18446744073709551615"}}');
  const sessions = [{ id: "local-1", provider_session_id: fixture.session_id }];
  let stored = {};
  const surfaceEvent = applySessionSurfaceStatusEvent(
    { payload: fixture },
    sessions,
    (update) => { stored = update(stored); },
  );
  assert.equal(surfaceEvent.local.id, "local-1");
  assert.equal(stored["local-1"].line, "working");
  const plan = surfaceInputMirrorPlan(surfaceEvent.payload.input, {
    callerOwner: surfaceEvent.payload.caller_owner,
    learnedOwner: "",
    history: new Map([["9007199254740993", "same text"]]),
    floors: {},
  });
  assert.equal(plan.kind, "apply", "the fixture's foreign publication must apply even against a byte-identical pending publish");
});

test("[pin A03] legacy re-adoption clears the retained identity: absence means unknown, never remembered", () => {
  /* The ref's lifecycle, driven exactly as the listener drives it: every
     accepted payload replaces the retained identity through the barrier
     seam. */
  let identity = "";
  const accept = (payload) => {
    identity = adoptSurfaceCallerIdentity(payload, identity);
  };

  /* 970 watch adoption publishes our identity. */
  accept({ session_id: "s", caller_owner: "old-970-caller", input: null, status: null });
  assert.equal(identity, "old-970-caller");

  /* Re-adoption through a legacy 969 response: the SDK's watch state
     cleared its identity, so its payloads omit the field — the UI must
     surrender the old caller, not remember it. */
  accept({ session_id: "s", input: null, status: null });
  assert.equal(identity, "", "a legacy adoption payload without caller_owner must clear the retained identity");

  /* Replaying the OLD self's text+revision on the legacy connection is now
     a foreign frame under the documented 969 rules — the remembered
     identity must not suppress it as a self-echo. */
  const context = { callerOwner: identity, learnedOwner: "", history: new Map(), floors: {} };
  const oldSelfReplay = driveMirrorFrame(
    { text: "same text", revision: "3", owner: "old-970-caller" },
    context,
  );
  assert.notEqual(
    oldSelfReplay.kind,
    "self-echo",
    "a stale remembered identity must never classify the old caller's frames as self",
  );
  assert.equal(oldSelfReplay.kind, "apply");

  /* And the verifier's live draft-loss repro: a GENUINE legacy self-echo
     (revision+text matching our pending publish) must drop as self-echo —
     carrying no apply payload — so newer typing and staged attachments
     survive. A stale identity would misroute it into the apply branch. */
  const genuineEcho = surfaceInputMirrorPlan(
    { text: "old typing", revision: "1", owner: "new-legacy-caller" },
    { callerOwner: identity, learnedOwner: "", history: new Map([["1", "old typing"]]), floors: {} },
  );
  assert.equal(genuineEcho.kind, "self-echo", "the legacy echo-matching fallback must return to force after a legacy re-adoption");
  assert.equal("text" in genuineEcho, false, "the echo must carry no apply payload that could clobber newer typing/attachments");

  /* A later 970 re-adoption re-establishes identity; a present-but-empty
     identity is unusable and behaves as unknown. */
  accept({ session_id: "s", caller_owner: "new-970-caller", input: null, status: null });
  assert.equal(identity, "new-970-caller");
  accept({ session_id: "s", caller_owner: "", input: null, status: null });
  assert.equal(identity, "", "a published empty identity cannot key owner equality and must not retain the old one");
});
