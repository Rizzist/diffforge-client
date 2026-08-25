import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_SAFE_TIMEOUT_MAX_MS,
  createHarnessAddFlowState,
  createHarnessApiKeyDraft,
  createHarnessImportState,
  createHarnessRemoveState,
  harnessAddFlowBegin,
  harnessAddFlowCancel,
  harnessAddFlowClaimPayload,
  harnessAddFlowDismiss,
  harnessAddFlowExpire,
  harnessAddFlowOnClaimError,
  harnessAddFlowOnClaimResult,
  harnessAddFlowOnStartError,
  harnessAddFlowOnStartResult,
  harnessAddFlowOnStatus,
  harnessAddFlowOnStatusError,
  harnessAddFlowShouldPoll,
  harnessApiKeyDraftEdit,
  harnessApiKeyRedactDraft,
  harnessApiKeySubmitPayload,
  harnessApiKeySubmitReady,
  harnessImportBegin,
  harnessImportCatalogOnError,
  harnessImportCatalogOnResult,
  harnessImportCatalogPresentation,
  harnessImportOnError,
  harnessImportOnResult,
  harnessManageFailureMessage,
  harnessOauthExpiryWaitMs,
  harnessRemoveBegin,
  harnessRemoveDismiss,
  harnessRemoveOnError,
  harnessRemoveOnRefreshResult,
  harnessRemoveOnResult,
  harnessRemoveRequest,
} from "./harnessAccountManage.js";
import {
  createHarnessRosterState,
  harnessAccountAuthKind,
  harnessAccountChipPresentation,
  harnessAccountSwapAffordance,
  harnessRosterOnListResult,
  harnessSwapAllowed,
} from "./harnessAccountRoster.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");
const isTokenomicsSourceFilename = (name) => /\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(name);
const sourceFilesUnder = (root) => fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(root, entry.name);
  if (entry.isDirectory()) return sourceFilesUnder(target);
  return isTokenomicsSourceFilename(entry.name) ? [target] : [];
});
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const forbiddenDoorLiteralPattern = (door) => new RegExp(`["'\`]${regexEscape(door)}["'\`]`);
const rustWithoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[\t ]*\/\/.*$/gm, "");
const liveTauriCommandPattern = (name) => new RegExp(
  `^[\\t ]*#\\[tauri::command(?:\\([^\\]\\n]*\\))?\\][\\t ]*\\r?\\n[\\t ]*pub[\\t ]+async[\\t ]+fn[\\t ]+${regexEscape(name)}\\b`,
  "m",
);
const rustFunctionDefinitionPattern = (name) => new RegExp(
  `^[\\t ]*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${regexEscape(name)}\\b`,
  "m",
);

/* The management wiring lives between explicit markers so pins can hold the
   whole hook to the optimistic-NEVER law without matching unrelated view
   code. */
function manageWiringSlice(view) {
  const start = view.indexOf("harness account management wiring (add / import / remove)");
  const end = view.indexOf("end harness account management wiring");
  assert.ok(start > 0 && end > start, "the management wiring markers must exist");
  return view.slice(start, end);
}

const pendingFlow = () => harnessAddFlowOnStartResult(
  harnessAddFlowBegin(createHarnessAddFlowState(), { provider: "openai-oauth", alias: "personal" }),
  {
    availability: { available: true },
    flow_id: "flow-1",
    attempt_id: "attempt-1",
    authorization_url: "https://example.test/auth",
    user_code: "ABCD-1234",
    expires_at_ms: 1234,
  },
);

const flowStatus = (status) => ({ flow_id: "flow-1", status });

/* ---- OAuth add flow ---------------------------------------------------- */

test("the add flow walks idle -> starting -> pending -> claiming -> succeeded on daemon facts only", () => {
  const idle = createHarnessAddFlowState();
  const starting = harnessAddFlowBegin(idle, { provider: "openai-oauth", alias: "" });
  assert.equal(starting.phase, "starting");
  assert.equal(starting.alias, "openai-oauth", "an omitted alias derives from the provider");

  const pending = pendingFlow();
  assert.equal(pending.phase, "pending");
  assert.equal(pending.flowId, "flow-1");
  assert.equal(pending.attemptId, "attempt-1");
  assert.equal(pending.authorizationUrl, "https://example.test/auth");
  assert.equal(pending.userCode, "ABCD-1234");
  assert.equal(harnessAddFlowShouldPoll(pending), true);

  /* Non-terminal daemon statuses keep the flow pending — identical state. */
  for (const status of ["waiting_browser", "waiting_device", "exchanging", "unknown"]) {
    assert.equal(
      harnessAddFlowOnStatus(pending, "flow-1", "attempt-1", flowStatus({ status })),
      pending,
    );
  }

  const claiming = harnessAddFlowOnStatus(
    pending,
    "flow-1",
    "attempt-1",
    flowStatus({ status: "ready", oauth_reference: "ref-9" }),
  );
  assert.equal(claiming.phase, "claiming");
  assert.deepEqual(harnessAddFlowClaimPayload(claiming), {
    provider: "openai-oauth",
    alias: "personal",
    flow_id: "flow-1",
    attempt_id: "attempt-1",
    oauth_reference: "ref-9",
  });

  const settled = harnessAddFlowOnClaimResult(claiming);
  assert.equal(settled.state.phase, "succeeded");
  assert.equal(settled.state.oauthReference, "", "claim material is wiped once claimed");
});

/* MUTATION CHECK (executed): making harnessAddFlowOnClaimResult return
   `relist: false` fails this test with
   `flow success MUST demand a re-list — the roster is account_list authority`
   (+ expected true, actual false). */
test("flow success surfaces ONLY a relist effect — never a roster entry", () => {
  const claiming = harnessAddFlowOnStatus(
    pendingFlow(),
    "flow-1",
    "attempt-1",
    flowStatus({ status: "ready", oauth_reference: "ref-9" }),
  );
  const settled = harnessAddFlowOnClaimResult(claiming);
  assert.equal(
    settled.relist,
    true,
    "flow success MUST demand a re-list — the roster is account_list authority",
  );
  /* The machine holds no roster data anywhere: a completed add cannot append
     what it does not have. */
  for (const key of Object.keys(settled.state)) {
    assert.ok(
      !["descriptor", "descriptors", "roster", "account"].includes(key),
      `the add flow state must not carry roster data (found ${key})`,
    );
  }
  assert.equal("descriptor" in settled, false);
});

/* MUTATION CHECK (executed): replacing the claim-success `relist()` call in
   the view with a local descriptor append
   (`setRosterState((prev) => ({ ...prev, descriptors: [...prev.descriptors, ...] }))`)
   fails with `flow success must re-list — the account appears only via
   account_list`; the slice pin below catches an append ADDED beside the
   re-list as well. */
test("view wiring: flow success re-lists and never appends a roster entry locally", () => {
  const view = read("AccountTokenomicsView.jsx");
  const wiring = manageWiringSlice(view);
  const claimStart = wiring.indexOf('await invoke("account_oauth_add", claim);');
  const claimRelist = wiring.indexOf("if (settled.relist) void relist();", claimStart);
  assert.ok(claimStart > 0 && claimRelist > claimStart);
  assert.doesNotMatch(
    wiring.slice(claimStart, claimRelist),
    /addFlowRef\.current/,
    "claim settlement belongs to the attempt — the current panel ref must not suppress re-list",
  );
  assert.match(
    view,
    /await invoke\("account_oauth_add", claim\);[\s\S]{0,400}?harnessAddFlowOnClaimResult\(claimAttempt\)[\s\S]{0,400}?if \(settled\.relist\) void relist\(\);/,
    "the completed attempt must re-list even when the current panel ref moved",
  );
  assert.doesNotMatch(
    wiring,
    /descriptors|\.\.\.prev\.|setRosterState/,
    "the management wiring must never build or edit a roster locally",
  );
});

test("oauth_start availability=false is an honest unavailable, verbatim reason or none", () => {
  const starting = harnessAddFlowBegin(createHarnessAddFlowState(), { provider: "grok-oauth" });
  const unavailable = harnessAddFlowOnStartResult(starting, {
    availability: { available: false, reason: "device flow disabled by policy" },
  });
  assert.equal(unavailable.phase, "unavailable");
  assert.equal(unavailable.message, "device flow disabled by policy");
  const unreasoned = harnessAddFlowOnStartResult(starting, {
    availability: { available: false },
  });
  assert.equal(unreasoned.message, "", "an absent reason stays absent — never invented");
});

test("a started flow without a flow id is a failure, never a fabricated pending", () => {
  const starting = harnessAddFlowBegin(createHarnessAddFlowState(), { provider: "openai-oauth" });
  const next = harnessAddFlowOnStartResult(starting, {
    availability: { available: true },
    attempt_id: "attempt-1",
  });
  assert.equal(next.phase, "failed");
  assert.match(next.message, /published no flow id/);
});

test("ready without an oauth_reference fails instead of claiming with invented material", () => {
  const next = harnessAddFlowOnStatus(
    pendingFlow(),
    "flow-1",
    "attempt-1",
    flowStatus({ status: "ready" }),
  );
  assert.equal(next.phase, "failed");
  assert.match(next.message, /without an oauth reference/);
});

/* The requested flow, requested attempt, and daemon-returned flow are three
   independent identities. Removing any one guard lets a ready result claim
   the wrong attempt and fails one of the named assertions below. */
test("stale polls require requested flow + attempt + daemon-returned flow identity", () => {
  const pending = pendingFlow();
  const otherFlow = harnessAddFlowOnStatus(
    pending,
    "flow-OTHER",
    "attempt-1",
    flowStatus({ status: "ready", oauth_reference: "ref-9" }),
  );
  assert.equal(otherFlow, pending, "a poll for another flow must change nothing");

  const otherAttempt = harnessAddFlowOnStatus(
    pending,
    "flow-1",
    "attempt-OTHER",
    flowStatus({ status: "ready", oauth_reference: "ref-9" }),
  );
  assert.equal(otherAttempt, pending, "a poll for another attempt must change nothing");

  const daemonMismatch = harnessAddFlowOnStatus(
    pending,
    "flow-1",
    "attempt-1",
    { flow_id: "flow-OTHER", status: { status: "ready", oauth_reference: "ref-9" } },
  );
  assert.equal(daemonMismatch, pending, "a daemon response for another flow must change nothing");

  const { state: cancelled } = harnessAddFlowCancel(pending);
  assert.equal(cancelled.phase, "cancelled");
  const afterCancel = harnessAddFlowOnStatus(
    cancelled,
    "flow-1",
    "attempt-1",
    flowStatus({ status: "ready", oauth_reference: "ref-9" }),
  );
  assert.equal(afterCancel, cancelled, "a poll landing after cancel must not claim the flow");
});

test("starting cancel is retained until the start result can be daemon-cancelled", () => {
  const starting = harnessAddFlowBegin(createHarnessAddFlowState(), { provider: "openai-oauth" });
  const cancelled = harnessAddFlowCancel(starting);
  assert.equal(cancelled.state.phase, "cancelled", "close must supersede the in-flight start attempt");
  assert.equal(cancelled.cancelPayload, null, "no flow id exists until account_oauth_start settles");
});

test("published expiry and a fallback deadline both bound polling and emit cancel identity", () => {
  const pending = pendingFlow();
  assert.equal(harnessAddFlowExpire(pending, 1233).state, pending);
  const expired = harnessAddFlowExpire(pending, 1234);
  assert.equal(expired.state.phase, "failed");
  assert.match(expired.state.message, /expired/);
  assert.deepEqual(expired.cancelPayload, { flow_id: "flow-1", attempt_id: "attempt-1" });

  const noPublishedDeadline = { ...pending, expiresAtMs: null };
  const bounded = harnessAddFlowExpire(noPublishedDeadline, 5000, 5000);
  assert.equal(bounded.state.phase, "failed");
  assert.match(bounded.state.message, /published no deadline/);
});

test("OAuth expiry waits clamp each timer arm and monotonic time bounds backward wall-clock jumps", () => {
  assert.equal(
    harnessOauthExpiryWaitMs({
      deadlineMs: HARNESS_SAFE_TIMEOUT_MAX_MS * 2,
      wallNowMs: 0,
      monotonicDeadlineMs: HARNESS_SAFE_TIMEOUT_MAX_MS * 2,
      monotonicNowMs: 0,
    }),
    HARNESS_SAFE_TIMEOUT_MAX_MS,
    "a published deadline beyond the browser ceiling must be armed in safe chunks",
  );
  assert.equal(
    harnessOauthExpiryWaitMs({
      deadlineMs: 10_000,
      wallNowMs: 9_000,
      monotonicDeadlineMs: 5_000,
      monotonicNowMs: 4_250,
    }),
    750,
  );
  assert.equal(
    harnessOauthExpiryWaitMs({
      deadlineMs: 10_000,
      wallNowMs: 1_000,
      monotonicDeadlineMs: 5_000,
      monotonicNowMs: 5_000,
    }),
    0,
    "monotonic expiry wins even when the wall clock jumped backward",
  );
});

test("terminal daemon statuses carry their reasons; cancel returns the daemon-cancel payload", () => {
  const pending = pendingFlow();
  const failed = harnessAddFlowOnStatus(
    pending,
    "flow-1",
    "attempt-1",
    flowStatus({ status: "failed", public_code: "access_denied" }),
  );
  assert.equal(failed.phase, "failed");
  assert.equal(failed.message, "Sign-in failed (access_denied).");
  const expired = harnessAddFlowOnStatus(
    pending,
    "flow-1",
    "attempt-1",
    flowStatus({ status: "expired" }),
  );
  assert.match(expired.message, /expired/);
  assert.equal(
    harnessAddFlowOnStatus(
      pending,
      "flow-1",
      "attempt-1",
      flowStatus({ status: "cancelled" }),
    ).phase,
    "cancelled",
  );

  const { state, cancelPayload } = harnessAddFlowCancel(pending);
  assert.equal(state.phase, "cancelled");
  assert.deepEqual(cancelPayload, { flow_id: "flow-1", attempt_id: "attempt-1" });
  const idleCancel = harnessAddFlowCancel(createHarnessAddFlowState());
  assert.equal(idleCancel.cancelPayload, null, "nothing to cancel daemon-side from idle");

  const lost = harnessAddFlowOnStatusError(
    pending,
    "flow-1",
    "attempt-1",
    new Error("oauth_flow_not_found"),
  );
  assert.equal(lost.phase, "failed");
  assert.match(lost.message, /oauth_flow_not_found/);

  const startFailed = harnessAddFlowOnStartError(
    harnessAddFlowBegin(createHarnessAddFlowState(), { provider: "p" }),
    new Error("busy"),
  );
  assert.match(startFailed.message, /busy/i);
  assert.equal(harnessAddFlowOnClaimError(createHarnessAddFlowState(), new Error("x")).phase, "idle");
  assert.equal(harnessAddFlowDismiss(pending), pending, "an active flow cannot be dismissed away");
});

/* ---- remove lifecycle -------------------------------------------------- */

test("remove walks confirm -> in_flight with the roster revision, null when unpublished", () => {
  const confirm = harnessRemoveRequest(createHarnessRemoveState(), "work", 41);
  assert.deepEqual(confirm, {
    phase: "confirm",
    alias: "work",
    expectedRevision: 41,
    message: "",
  });

  /* Even if a newer roster arrives while the strip is open, begin consumes
     the captured revision — never a current revision passed by the button. */
  const begun = harnessRemoveBegin(confirm);
  assert.equal(begun.state.phase, "in_flight");
  assert.deepEqual(begun.payload, { alias: "work", expected_revision: 41 });

  const unpublished = harnessRemoveBegin(
    harnessRemoveRequest(createHarnessRemoveState(), "work", null),
  );
  assert.equal(
    unpublished.payload.expected_revision,
    null,
    "a revision the roster never published crosses as null, never a fabricated 0",
  );

  /* Only a confirmed request reaches the daemon. */
  assert.equal(harnessRemoveBegin(createHarnessRemoveState()).payload, null);
  /* Dismiss cannot abandon an in-flight daemon call. */
  assert.equal(harnessRemoveDismiss(begun.state), begun.state);
  assert.equal(harnessRemoveDismiss(confirm).phase, "idle");
});

test("an open remove confirmation freezes its alias and published revision", () => {
  const confirm = harnessRemoveRequest(createHarnessRemoveState(), "work", 41);
  assert.equal(
    harnessRemoveRequest(confirm, "personal", 99),
    confirm,
    "a second remove trigger must not retarget an open confirmation",
  );
  assert.deepEqual(harnessRemoveBegin(confirm).payload, { alias: "work", expected_revision: 41 });
  const view = read("AccountTokenomicsView.jsx");
  assert.match(
    view,
    /disabled=\{manage\.removeState\.phase === "confirm" \|\| manage\.removeState\.phase === "in_flight"\}[\s\S]{0,160}?onClick=\{\(\) => manage\.requestRemove\(descriptor, rosterState\.revision\)\}/,
    "every remove chip must be disabled while the captured confirmation is open",
  );
});

/* MUTATION CHECK (executed): making harnessRemoveOnResult return
   `relist: false` fails this test with
   `daemon-confirmed removal MUST re-list — the chip disappears only when
   account_list stops publishing it`. */
test("daemon-confirmed remove surfaces ONLY a relist effect — the machine has nothing to splice", () => {
  const begun = harnessRemoveBegin(harnessRemoveRequest(createHarnessRemoveState(), "work", 41));
  const settled = harnessRemoveOnResult(begun.state);
  assert.equal(
    settled.relist,
    true,
    "daemon-confirmed removal MUST re-list — the chip disappears only when account_list stops publishing it",
  );
  assert.deepEqual(settled.state, createHarnessRemoveState());
  assert.equal("descriptors" in settled.state, false);
});

/* MUTATION CHECK (executed): replacing the remove-success `relist()` in the
   view with a local splice
   (`setRosterState((prev) => ({ ...prev, descriptors: prev.descriptors.filter(...) }))`)
   fails BOTH pins: `the management wiring must never build or edit a roster
   locally` and `remove success must re-list, never splice`. */
test("view wiring: remove goes through account_remove and re-lists, never splices", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(
    view,
    /invoke\("account_remove", \{\s*\n\s*alias: payload\.alias,\s*\n\s*expected_revision: payload\.expected_revision,\s*\n\s*\}\)\.then\(\(\) => \{[\s\S]{0,600}?if \(settled\.relist\) void relist\(\);/,
    "remove success must re-list, never splice",
  );
  const wiring = manageWiringSlice(view);
  assert.doesNotMatch(wiring, /\.filter\(|\.splice\(/, "no local roster surgery in the management wiring");
  /* The accidental-remove cost demands the inline confirm before the invoke. */
  assert.match(view, /manage\.removeState\.phase === "confirm"/);
  assert.match(
    view,
    /onClick=\{\(\) => manage\.requestRemove\(descriptor, rosterState\.revision\)\}/,
    "opening the confirmation strip captures the visible roster revision",
  );
  assert.match(view, /onClick=\{manage\.confirmRemove\}/);
  assert.doesNotMatch(view, /confirmRemove\(rosterState\.revision\)/);
});

test("remove failures carry typed reasons; only revision_conflict forces a re-list", () => {
  const begun = harnessRemoveBegin(harnessRemoveRequest(createHarnessRemoveState(), "work", 41));
  const conflict = harnessRemoveOnError(begun.state, new Error("revision_conflict"));
  assert.equal(conflict.state.phase, "failed");
  assert.equal(conflict.relist, true);
  assert.match(conflict.state.message, /refreshing/, "pending refresh prose must not claim completion");
  assert.match(harnessRemoveOnRefreshResult(conflict.state, "refreshed").message, /now refreshed/);
  assert.match(harnessRemoveOnRefreshResult(conflict.state, "failed").message, /refresh failed/);
  assert.match(
    harnessRemoveOnRefreshResult(conflict.state, "superseded").message,
    /newer roster refresh superseded this read/,
    "a monotonic newer read is not a failed refresh",
  );
  assert.doesNotMatch(harnessRemoveOnRefreshResult(conflict.state, "superseded").message, /refresh failed/);
  assert.match(harnessRemoveOnRefreshResult(conflict.state, "inactive").message, /became inactive/);
  const denied = harnessRemoveOnError(begun.state, new Error("invalid_argument"));
  assert.equal(denied.relist, false);
  assert.match(denied.state.message, /rejected the request/);
});

/* ---- API-key redaction ------------------------------------------------- */

test("the api-key payload is the exact account_add_api_key argument shape", () => {
  let draft = createHarnessApiKeyDraft();
  assert.equal(harnessApiKeySubmitReady(draft), false);
  draft = harnessApiKeyDraftEdit(draft, "provider", "openai");
  draft = harnessApiKeyDraftEdit(draft, "key", "sk-secret");
  assert.deepEqual(harnessApiKeySubmitPayload(draft), {
    provider: "openai",
    alias: null,
    api_key: "sk-secret",
    validation_model: null,
  });
  draft = harnessApiKeyDraftEdit(draft, "alias", " work ");
  assert.equal(harnessApiKeySubmitPayload(draft).alias, "work");
  assert.equal(harnessApiKeyDraftEdit(draft, "__proto__", "x"), draft, "unknown fields are refused");
});

/* MUTATION CHECK (executed): making harnessApiKeyRedactDraft return the
   draft unchanged fails this test with
   `the key must NOT survive a settled submit` (actual "sk-secret"). */
test("the key never survives a settled submit — redaction wipes it, keeps the rest", () => {
  const draft = { provider: "openai", alias: "work", key: "sk-secret" };
  const redacted = harnessApiKeyRedactDraft(draft);
  assert.equal(redacted.key, "", "the key must NOT survive a settled submit");
  assert.equal(redacted.provider, "openai");
  assert.equal(redacted.alias, "work");
  assert.equal(draft.key, "sk-secret", "redaction returns a new draft, never mutates the input");
});

test("view wiring: API-key generations isolate stale settlements and the password input stays uncontrolled", () => {
  const view = read("AccountTokenomicsView.jsx");
  const wiring = manageWiringSlice(view);
  const submitStart = wiring.indexOf("const submitApiKey");
  const submitEnd = wiring.indexOf("const requestRemove", submitStart);
  const submit = wiring.slice(submitStart, submitEnd);
  assert.ok(submitStart > 0 && submitEnd > submitStart);
  assert.match(
    submit,
    /key: apiKeyRef\.current,[\s\S]{0,500}?await invoke\("account_add_api_key", payload\);/,
    "the memoized submit reads the secret ref only at call time",
  );
  assert.match(
    submit,
    /const attemptGeneration = \+\+apiAttemptGenerationRef\.current;[\s\S]{0,180}?apiAttemptGenerationRef\.current === attemptGeneration && managementCanWrite\(\)/,
    "each submit must own a generation checked against the active mounted surface",
  );
  assert.match(
    submit,
    /await invoke\("account_add_api_key", payload\);\s*\n\s*if \(!apiAttemptIsCurrent\(\)\) return;/,
    "an older success must not close or overwrite a newer panel",
  );
  assert.match(
    submit,
    /catch \(error\) \{\s*\n\s*if \(!apiAttemptIsCurrent\(\)\) return;/,
    "an older failure must not overwrite a newer attempt",
  );
  assert.match(
    submit,
    /finally \{[\s\S]{0,350}?payload\.api_key = "";\s*\n\s*if \(apiAttemptIsCurrent\(\)\) \{\s*\n\s*apiKeyRef\.current = "";/,
    "every payload is wiped, but only the current attempt may wipe the shared ref and DOM",
  );
  assert.match(
    wiring,
    /const clearApiKeySecret = useCallback\(\(\) => \{\s*\n\s*apiAttemptGenerationRef\.current \+= 1;/,
    "closing or leaving the API panel must invalidate its outstanding submit",
  );
  assert.equal(
    (submit.match(/apiKeyRef\.current\s*=/g) || []).length,
    1,
    "submit must not restore the key after redaction",
  );
  assert.doesNotMatch(wiring, /console\.(?:log|debug|info|warn|error)\s*\(/, "the secret payload reaches no logging sink");
  assert.doesNotMatch(
    wiring,
    /useState\(\{[^\n]*\bkey\s*:/i,
    "the API metadata object must not grow a secret-bearing key field",
  );
  const passwordInputStart = view.lastIndexOf("<input", view.indexOf('type="password"'));
  const passwordInputEnd = view.indexOf("/>", passwordInputStart);
  const passwordInput = view.slice(passwordInputStart, passwordInputEnd + 2);
  assert.ok(passwordInputStart > 0 && passwordInputEnd > passwordInputStart, "the key input must remain rendered");
  assert.match(passwordInput, /type="password"/, "the key input must be a password field");
  assert.match(passwordInput, /ref=\{manage\.apiKeyInputRef\}/, "the uncontrolled DOM input can be wiped on settle");
  assert.match(
    passwordInput,
    /onChange=\{\(event\) => manage\.editApiKey\(event\.target\.value\)\}/,
    "the password input must route directly to the ref owner",
  );
  assert.doesNotMatch(
    passwordInput,
    /\bvalue\s*=/,
    "the password field must stay uncontrolled regardless of any secret-state variable name",
  );
});

/* ---- import catalog + import lifecycle --------------------------------- */

test("an unpublished catalog, an empty catalog, and a failed read are three different facts", () => {
  assert.equal(
    harnessImportCatalogPresentation(harnessImportCatalogOnResult(null)).phase,
    "unpublished",
  );
  assert.equal(
    harnessImportCatalogPresentation(harnessImportCatalogOnResult([])).phase,
    "empty",
  );
  const failed = harnessImportCatalogPresentation(harnessImportCatalogOnError(new Error("busy")));
  assert.equal(failed.phase, "unavailable");
  assert.equal(failed.reason, "busy");
});

test("catalog rows cross verbatim with tri-state availability — absence stays unknown", () => {
  const rows = harnessImportCatalogPresentation(harnessImportCatalogOnResult([
    { source: "codex", provider: "openai-oauth", default_alias: "codex", available: true },
    { source: "kimi-code", available: false, unavailable_reason: "kimi-code is not installed" },
    { source: "grok-cli" },
  ])).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    source: "codex",
    provider: "openai-oauth",
    defaultAlias: "codex",
    available: true,
    unavailableReason: "",
  });
  assert.equal(rows[1].available, false);
  assert.equal(rows[1].unavailableReason, "kimi-code is not installed");
  assert.equal(rows[2].available, null, "an absent availability is UNKNOWN, never defaulted");
});

test("malformed catalog payloads are failed reads with a reason, never fabricated empty", () => {
  for (const malformed of [
    { rows: [] },
    [{ provider: "orphan-no-source" }],
    [null],
    [{ source: 42 }],
    [{ source: {} }],
    [{ source: ["codex"] }],
    [{ source: " codex " }],
    [{ source: "codex", provider: {} }],
    [{ source: "codex", default_alias: 7 }],
    [{ source: "codex", unavailable_reason: ["missing"] }],
    [{ source: "codex", available: "yes" }],
  ]) {
    const presented = harnessImportCatalogPresentation(harnessImportCatalogOnResult(malformed));
    assert.equal(presented.phase, "unavailable", "malformed catalog data must not render as empty");
    assert.match(presented.reason, /malformed import catalog/);
  }
});

test("import success surfaces ONLY a relist effect; failure carries its typed reason", () => {
  const begun = harnessImportBegin(createHarnessImportState(), "codex");
  assert.deepEqual(begun.payload, { source: "codex" });
  const settled = harnessImportOnResult(begun.state);
  assert.equal(settled.relist, true, "an imported account arrives only via account_list");
  assert.equal(settled.state.phase, "idle");
  const failed = harnessImportOnError(begun.state, new Error("invalid_argument"));
  assert.equal(failed.state.phase, "failed");
  assert.match(failed.state.message, /rejected the request/);
  assert.equal(harnessImportBegin(begun.state, "codex").payload, null, "one import at a time");
});

/* ---- auth kind: published fact, never inferred ------------------------- */

/* MUTATION CHECK (executed): collapsing an absent auth_method to "api_key"
   in harnessAccountAuthKind fails this test with
   `an absent auth_method is UNKNOWN — absence is never fabricated into a
   kind` (actual "api_key"). */
test("auth kind is the descriptor's published auth_method — anything else is unknown", () => {
  assert.equal(harnessAccountAuthKind({ auth_method: "oauth" }), "oauth");
  assert.equal(harnessAccountAuthKind({ auth_method: "api_key" }), "api_key");
  assert.equal(
    harnessAccountAuthKind({ alias: "work" }),
    "",
    "an absent auth_method is UNKNOWN — absence is never fabricated into a kind",
  );
  assert.equal(harnessAccountAuthKind({ auth_method: "password" }), "");
});

/* MUTATION CHECK (executed): making harnessAccountSwapAffordance treat an
   UNKNOWN kind as api_key fails this test with `an unknown kind KEEPS the
   affordance — absence is not evidence of api_key`. */
test("only the PUBLISHED api_key kind removes the swap affordance", () => {
  assert.deepEqual(harnessAccountSwapAffordance({ auth_method: "api_key" }), {
    swappable: false,
    kind: "api_key",
    reason: "api_key_not_switchable",
  });
  assert.equal(harnessAccountSwapAffordance({ auth_method: "oauth" }).swappable, true);
  assert.equal(
    harnessAccountSwapAffordance({ alias: "work" }).swappable,
    true,
    "an unknown kind KEEPS the affordance — absence is not evidence of api_key",
  );

  const state = harnessRosterOnListResult(createHarnessRosterState(), {
    descriptors: [
      { alias: "work", provider: "anthropic", active: true, auth_method: "oauth" },
      { alias: "keyed", provider: "openai", active: false, auth_method: "api_key" },
      { alias: "mystery", provider: "openai", active: false },
    ],
    revision: 7,
    availability: { state: "available" },
    watch: { state: "live" },
  });
  assert.deepEqual(harnessSwapAllowed(state, state.descriptors[1]), {
    allowed: false,
    reason: "api_key_not_switchable",
  });
  assert.equal(harnessSwapAllowed(state, state.descriptors[2]).allowed, true);
});

test("chip presentation: api_key chips lose click-to-swap and say why; unknown kinds keep it", () => {
  const swapIdle = { phase: "idle", alias: "", message: "" };
  const keyed = harnessAccountChipPresentation(
    { alias: "keyed", provider: "openai", active: false, auth_method: "api_key" },
    swapIdle,
  );
  assert.equal(keyed.swappable, false);
  assert.equal(keyed.authKindLabel, "API key");
  assert.match(keyed.title, /switching does not apply/);
  assert.doesNotMatch(keyed.title, /Click to make this the active account/);

  const oauth = harnessAccountChipPresentation(
    { alias: "work", provider: "anthropic", active: false, auth_method: "oauth" },
    swapIdle,
  );
  assert.equal(oauth.swappable, true);
  assert.equal(oauth.authKindLabel, "OAuth");
  assert.match(oauth.title, /Click to make this the active account/);

  const unknown = harnessAccountChipPresentation(
    { alias: "mystery", provider: "openai", active: false },
    swapIdle,
  );
  assert.equal(unknown.swappable, true, "unknown kind keeps the affordance");
  assert.equal(unknown.authKindLabel, "", "an unknown kind renders NO label — never a default");
});

/* MUTATION CHECK (executed): reverting the chip onClick to
   `isActive ? undefined : ...` (ignoring swappable) fails this test with
   `the rendered chip must drop the swap handler for published api_key
   accounts`. */
test("view wiring: the chip's swap handler consumes the pinned swappable projection", () => {
  const view = read("AccountTokenomicsView.jsx");
  const chip = view.slice(
    view.indexOf("function HarnessAccountChipView"),
    view.indexOf("const HarnessAccountChipRow"),
  );
  assert.match(
    chip,
    /onClick=\{isActive \|\| !swappable \? undefined : \(\) => onSwap\(descriptor, confirmEpoch\)\}/,
    "the rendered chip must drop the swap handler for published api_key accounts",
  );
  assert.match(chip, /\{authKindLabel \? <span data-role="auth">\{authKindLabel\}<\/span> : null\}/);
});

test("view wiring: polling is active-gated, bounded, cleaned up, and write-guarded", () => {
  const view = read("AccountTokenomicsView.jsx");
  const wiring = manageWiringSlice(view);
  assert.match(
    wiring,
    /invoke\("account_oauth_status", \{\s*\n\s*flow_id: flow\.flowId,\s*\n\s*attempt_id: flow\.attemptId,\s*\n\s*\}\)/,
  );
  assert.match(wiring, /if \(!active \|\| !harnessAddFlowShouldPoll\(addFlow\)\) return undefined;/);
  assert.match(wiring, /fallbackExpiresAtMs = Date\.now\(\) \+ HARNESS_OAUTH_MAX_POLL_LIFETIME_MS/);
  assert.match(wiring, /expiryTimer = window\.setTimeout\(armExpiry, waitMs\);/);
  assert.match(wiring, /const waitMs = harnessOauthExpiryWaitMs\(\{/);
  assert.match(wiring, /if \(waitMs > 0\) \{[\s\S]{0,120}?setTimeout\(armExpiry, waitMs\);[\s\S]{0,80}?return;[\s\S]{0,80}?expire\(\);/);
  assert.match(wiring, /pollCancelled = true;\s*\n\s*window\.clearTimeout\(pollTimer\);\s*\n\s*commitAddFlow\(expired\.state\);/);
  assert.match(wiring, /pollCancelled = true;\s*\n\s*window\.clearTimeout\(pollTimer\);\s*\n\s*window\.clearTimeout\(expiryTimer\);/);
  assert.match(
    wiring,
    /await invoke\("account_oauth_status", \{[\s\S]{0,180}?\}\);\s*\n\s*if \(pollCancelled \|\| !managementCanWrite\(\)\) return;\s*\n\s*next = harnessAddFlowOnStatus/,
    "the successful status continuation needs its own lifecycle guard",
  );
  assert.match(
    wiring,
    /\} catch \(error\) \{\s*\n\s*if \(pollCancelled \|\| !managementCanWrite\(\)\) return;\s*\n\s*next = harnessAddFlowOnStatusError/,
    "the failed status continuation needs its own lifecycle guard",
  );
  assert.match(
    wiring,
    /const commitAddFlow = useCallback\(\(next\) => \{\s*\n\s*addFlowRef\.current = next;\s*\n\s*if \(managementCanWrite\(\)\) setAddFlow\(next\);/,
    "the flow commit seam itself must pass the mounted/active guard",
  );
  assert.match(wiring, /managementMountedRef\.current = false;\s*\n\s*managementActiveRef\.current = false;[\s\S]{0,240}?apiKeyRef\.current = "";/);
  assert.match(wiring, /commitAddFlow\(next\);\s*\n\s*void cancelDaemonFlow\(cancelPayload\);/);
  const deactivate = wiring.slice(
    wiring.indexOf("useEffect(() => {\n    if (active) return;"),
    wiring.indexOf("/* The provider options for both add paths"),
  );
  assert.ok(deactivate.length > 0, "the inactive reset effect must remain wired");
  assert.match(deactivate, /addFlowRef\.current = idleAddFlow;/);
  assert.match(deactivate, /importStateRef\.current = idleImport;/);
  assert.match(deactivate, /removeStateRef\.current = idleRemove;/);
  assert.match(deactivate, /setAddFlow\(idleAddFlow\);/);
  assert.match(deactivate, /setImportState\(idleImport\);/);
  assert.match(deactivate, /setRemoveState\(idleRemove\);/);
  assert.match(deactivate, /setApiBusy\(false\);/, "deactivation must reset rendered API busy state");
  assert.match(deactivate, /apiAttemptGenerationRef\.current \+= 1;/, "deactivation invalidates an older API submit");
  assert.match(deactivate, /resetPublishedAuthorities\(\);/, "deactivation clears published authority state");
});

test("view wiring: closing during starting awaits the result and cancels the published flow", () => {
  const wiring = manageWiringSlice(read("AccountTokenomicsView.jsx"));
  assert.match(wiring, /invoke\("account_oauth_start", \{\s*\n\s*provider: begun\.provider,\s*\n\s*desired_alias: begun\.alias,/);
  assert.match(
    wiring,
    /const next = harnessAddFlowOnStartResult\(begun, result\);[\s\S]{0,350}?if \(addFlowRef\.current !== begun \|\| !managementCanWrite\(\)\) \{[\s\S]{0,250}?cancelDaemonFlow\(\{ flow_id: next\.flowId, attempt_id: next\.attemptId \}\)/,
    "a superseded start result must be cancelled, not dropped",
  );
  assert.doesNotMatch(
    wiring,
    /await invoke\("account_oauth_start"[\s\S]{0,250}?if \(addFlowRef\.current !== begun\) return;/,
  );
  assert.doesNotMatch(wiring, /openUrl\([^)]*\)\.catch\(\(\) => \{\}\)/, "browser-open failures must not be silent");
  assert.match(wiring, /message: `The browser could not be opened \(\$\{harnessRosterErrorCode\(error\)/);
  assert.match(read("AccountTokenomicsView.jsx"), /<HarnessManageNote data-tone="error">\{manage\.addFlow\.message\}<\/HarnessManageNote>/);
});

test("view wiring: provider and source options come from PUBLISHED authorities only", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /providerAuthOptions\(libraryState\.library, "oauth"\)/);
  assert.match(view, /providerAuthOptions\(libraryState\.library, "api_key"\)/);
  assert.match(view, /invoke\("haider_account_oauth_import_sources"\)/);
  assert.match(view, /invoke\("haider_account_oauth_import", payload\)/);
  assert.match(view, /Registration is pending post-excision; rejection renders as a failed read/);
  const wiring = manageWiringSlice(view);
  assert.doesNotMatch(
    wiring,
    /"openai-oauth"|"anthropic-oauth"|"kimi-oauth"|"grok-oauth"|"codex"|"claude-code"/,
    "no hardcoded provider or import-source lists in the wiring",
  );
});

test("provider and import authority reads are generation-guarded and close resets them to pending", () => {
  const wiring = manageWiringSlice(read("AccountTokenomicsView.jsx"));
  assert.doesNotMatch(wiring, /let stale = false|stale = true/, "passive cleanup flags cannot authorize promise writes");
  assert.match(
    wiring,
    /invoke\("haider_library_snapshot"\)\.then\(\(snapshot\) => \{\s*\n\s*if \(!managementCanWrite\(\) \|\| libraryReadGenerationRef\.current !== readGeneration\) return;/,
    "library success must use the mounted/active generation guard",
  );
  assert.match(
    wiring,
    /\}\)\.catch\(\(error\) => \{\s*\n\s*if \(!managementCanWrite\(\) \|\| libraryReadGenerationRef\.current !== readGeneration\) return;\s*\n\s*setLibraryState/,
    "library failure must use the mounted/active generation guard",
  );
  assert.match(
    wiring,
    /invoke\("haider_account_oauth_import_sources"\)\.then\(\(result\) => \{\s*\n\s*if \(!managementCanWrite\(\) \|\| catalogReadGenerationRef\.current !== readGeneration\) return;/,
    "catalog success must use the mounted/active generation guard",
  );
  assert.match(
    wiring,
    /\}\)\.catch\(\(error\) => \{\s*\n\s*if \(!managementCanWrite\(\) \|\| catalogReadGenerationRef\.current !== readGeneration\) return;\s*\n\s*setCatalog/,
    "catalog failure must use the mounted/active generation guard",
  );
  assert.match(
    wiring,
    /const resetPublishedAuthorities = useCallback\(\(\) => \{[\s\S]{0,260}?setLibraryState\(\{ state: "idle", library: null, reason: "" \}\);\s*\n\s*setCatalog\(createHarnessImportCatalogState\(\)\);/,
    "authority reset must remove both interactive snapshots",
  );
  const close = wiring.slice(wiring.indexOf("const closeAddPanel"), wiring.indexOf("const oauthProviders"));
  assert.match(close, /resetPublishedAuthorities\(\);/, "closing the panel must clear both authority snapshots");
  assert.match(wiring, /setLibraryState\(\{ state: "loading", library: null, reason: "" \}\);/);
  assert.match(wiring, /setCatalog\(createHarnessImportCatalogState\(\)\);/);
});

test("the forbidden-door scanner covers every script extension and indirect string-literal invocation", () => {
  for (const extension of ["js", "jsx", "ts", "tsx", "mjs", "cjs"]) {
    assert.equal(isTokenomicsSourceFilename(`nested/file.${extension}`), true, `.${extension} must be scanned`);
  }
  assert.equal(isTokenomicsSourceFilename("styles.css"), false);
  const indirectDoor = ["account", "oauth", "import"].join("_");
  assert.match(
    `const command = "${indirectDoor}"; invoke(command)`,
    forbiddenDoorLiteralPattern(indirectDoor),
    "an indirect invocation string must still be forbidden",
  );
});

test("tokenomics contains no string literal naming any of the four excised legacy doors", () => {
  const forbidden = [
    ["account", "oauth", "import", "sources"].join("_"),
    ["account", "oauth", "import"].join("_"),
    ["account", "device", "candidates"].join("_"),
    ["account", "import", "device"].join("_"),
  ];
  for (const sourcePath of sourceFilesUnder(directory)) {
    const source = fs.readFileSync(sourcePath, "utf8");
    const name = path.relative(directory, sourcePath);
    for (const door of forbidden) {
      assert.doesNotMatch(
        source,
        forbiddenDoorLiteralPattern(door),
        `${name} must not name excised door ${door}`,
      );
    }
  }
});

test("the Rust SDK exports all four collision-free haider account command names", () => {
  const rust = rustWithoutComments(fs.readFileSync(
    path.join(directory, "../../src-tauri/src/haider_rpc_ade.rs"),
    "utf8",
  ));
  for (const name of [
    "haider_account_oauth_import_sources",
    "haider_account_oauth_import",
    "haider_account_device_candidates",
    "haider_account_import_device",
  ]) {
    assert.match(rust, liveTauriCommandPattern(name), `missing live #[tauri::command] export ${name}`);
    const commented = `// #[tauri::command]\n// pub async fn ${name}() {}`;
    assert.doesNotMatch(
      rustWithoutComments(commented),
      liveTauriCommandPattern(name),
      "a commented signature must not satisfy the live export pin",
    );
  }
  for (const oldName of [
    ["account", "oauth", "import", "sources"].join("_"),
    ["account", "oauth", "import"].join("_"),
    ["account", "device", "candidates"].join("_"),
    ["account", "import", "device"].join("_"),
  ]) {
    assert.doesNotMatch(
      rust,
      rustFunctionDefinitionPattern(oldName),
      `old Rust function definition ${oldName} must stay excised`,
    );
    assert.match(
      `pub async fn ${oldName}() {}`,
      rustFunctionDefinitionPattern(oldName),
      "the old-definition rejection pin must recognize a restored function",
    );
    assert.match(
      `pub\nasync\nfn\n${oldName}() {}`,
      rustFunctionDefinitionPattern(oldName),
      "the old-definition rejection pin must recognize a multiline restored function",
    );
  }
});

test("rendering pins: no-code OAuth and every catalog authority state reach pixels", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /The daemon started the flow but published no URL or code\./);
  assert.match(view, /This daemon does not publish an import catalog\./);
  assert.match(view, /Import catalog unavailable — \{manage\.catalogPresentation\.reason\}/);
  assert.match(view, /The daemon's import catalog lists no sources\./);
});

test("failure prose maps the daemon's public codes and keeps unknown codes verbatim", () => {
  assert.match(harnessManageFailureMessage("unauthorized"), /rejected \(401\)/);
  assert.match(harnessManageFailureMessage("restage_required"), /staged secret expired/);
  assert.match(harnessManageFailureMessage("haider_accounts_unavailable"), /harness connection/);
  assert.match(harnessManageFailureMessage("revision_conflict"), /refresh is required/);
  assert.doesNotMatch(harnessManageFailureMessage("revision_conflict"), /refreshed/);
  assert.equal(harnessManageFailureMessage("weird_new_code"), "weird_new_code");
  assert.equal(harnessManageFailureMessage(""), "The request failed.");
});
