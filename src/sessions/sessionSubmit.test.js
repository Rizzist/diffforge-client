import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSubmitDisposition,
  ownSubmissionConfirmation,
  submitDispositionPresentation,
  submitSessionPrompt,
} from "./sessionSubmit.js";

test("submit boundary carries the selected delivery mode and preserves the typed receipt", async () => {
  const calls = [];
  const result = await submitSessionPrompt(async (command, args) => {
    calls.push([command, args]);
    return {
      session_id: "session-1",
      accepted_seq: 31,
      disposition: "steer_pending",
    };
  }, {
    sessionId: "session-1",
    prompt: "  keep this text\nverbatim  ",
    attachments: ["/tmp/screenshot.png"],
    mode: "steer",
  });

  assert.deepEqual(calls, [["session_submit_prompt", {
    session_id: "session-1",
    prompt: "  keep this text\nverbatim  ",
    attachments: ["/tmp/screenshot.png"],
    mode: "steer",
  }]]);
  assert.equal(result.disposition, "steer_pending");
  assert.equal(result.label, "Steer pending");
});

test("every submit disposition has its own transient confirmation", () => {
  assert.equal(submitDispositionPresentation("started").label, "Started");
  assert.equal(submitDispositionPresentation("queued").label, "Queued");
  assert.equal(submitDispositionPresentation("steer_pending").label, "Steer pending");
  assert.equal(submitDispositionPresentation("subturn_pending").label, "Subturn pending");
});

test("unknown disposition never renders as Started", () => {
  assert.equal(normalizeSubmitDisposition("future_disposition"), "unknown");
  const presentation = submitDispositionPresentation("future_disposition");
  assert.equal(presentation.disposition, "unknown");
  assert.equal(presentation.label, "Accepted");
  assert.notEqual(presentation.label, "Started");

  const confirmation = ownSubmissionConfirmation({
    disposition: "unknown",
    mode: "subturn",
  }, "own text", 42);
  assert.equal(confirmation.label, "Accepted");
  assert.equal(confirmation.text, "own text");
});

test("an old void Tauri response stays disposition-unknown", async () => {
  const result = await submitSessionPrompt(async () => undefined, {
    sessionId: "session-1",
    prompt: "hello",
    mode: "queue",
  });
  assert.equal(result.disposition, "unknown");
  assert.equal(result.label, "Accepted");
});

test("submit boundary omits mode when queue_control_v1 did not authorize one", async () => {
  const calls = [];
  await submitSessionPrompt(async (command, args) => {
    calls.push([command, args]);
    return undefined;
  }, {
    sessionId: "session-1",
    prompt: "hello",
  });

  assert.deepEqual(calls, [["session_submit_prompt", {
    session_id: "session-1",
    prompt: "hello",
    attachments: null,
  }]], "legacy payload must not contain a mode key");
  assert.equal(Object.hasOwn(calls[0][1], "mode"), false);
});
