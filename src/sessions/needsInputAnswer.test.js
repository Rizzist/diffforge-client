import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NEEDS_INPUT_FEATURE_MISSING,
  NEEDS_INPUT_NO_CONNECTION,
  NEEDS_INPUT_RECONNECT_DELAYS_MS,
  NEEDS_INPUT_RPC_FAILED,
  answerNeedsInputWithReconnect,
  isNeedsInputCardAnswerable,
  needsInputFailureMessage,
} from "./needsInputAnswer.js";

test("no live RPC connection uses no-connection copy, never Shell advice", () => {
  const message = needsInputFailureMessage(NEEDS_INPUT_NO_CONNECTION);
  assert.equal(
    message,
    "No live connection to the Haider daemon. Start or restart Haider; opening the Shell cannot restore this RPC route.",
  );
  assert.ok(!message.includes("open its Shell, then try again"));
});

test("connected daemon without needs-input feature gets distinct feature copy", () => {
  const noConnection = needsInputFailureMessage(NEEDS_INPUT_NO_CONNECTION);
  const featureMissing = needsInputFailureMessage(NEEDS_INPUT_FEATURE_MISSING);
  assert.equal(
    featureMissing,
    "The connected Haider daemon does not support answering this card. Update Haider; opening the Shell cannot add this feature.",
  );
  assert.notEqual(featureMissing, noConnection);
});

test("connected session list or attach failure gets RPC route copy", () => {
  const rpcFailed = needsInputFailureMessage(`${NEEDS_INPUT_RPC_FAILED}: session.attach timed out`);
  assert.equal(
    rpcFailed,
    "DiffForge reached Haider, but could not list or attach this session. Opening the Shell cannot fix this RPC failure.",
  );
});

test("legacy side-action failures do not invent a no-connection diagnosis", () => {
  assert.equal(
    needsInputFailureMessage("haider_needs_input_unavailable"),
    "DiffForge could not complete this Haider RPC request. Opening the Shell cannot restore the RPC route.",
  );
});

test("needs-input reconnect ladder answers when RPC becomes ready after 4.5 seconds", async () => {
  let elapsedMs = 0;
  let calls = 0;
  const reconnects = [];
  const result = await answerNeedsInputWithReconnect({
    invokeAnswer: async () => {
      calls += 1;
      if (elapsedMs < 4_500) throw new Error(NEEDS_INPUT_NO_CONNECTION);
      return "answered";
    },
    onReconnect: () => reconnects.push(elapsedMs),
    sleep: async (delayMs) => { elapsedMs += delayMs; },
  });

  assert.equal(result, "answered");
  assert.equal(elapsedMs, 4_900);
  assert.equal(calls, 8);
  assert.equal(reconnects.length, 7);
  assert.ok(NEEDS_INPUT_RECONNECT_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) > 5_000);
});

test("needs-input feature and RPC route failures are not retried", async () => {
  for (const code of [NEEDS_INPUT_FEATURE_MISSING, NEEDS_INPUT_RPC_FAILED]) {
    let calls = 0;
    await assert.rejects(
      answerNeedsInputWithReconnect({
        invokeAnswer: async () => {
          calls += 1;
          throw new Error(code);
        },
        sleep: async () => assert.fail("non-connection failures must not sleep"),
      }),
      (error) => error.message === code,
    );
    assert.equal(calls, 1);
  }
});

test("needs-input cards require the complete fence before exposing answers", () => {
  const complete = {
    menu_id: "effect-recovery-1",
    request_seq: 1843,
    worker_generation: 122,
    options: [{ key: "probe" }],
  };
  assert.equal(isNeedsInputCardAnswerable(complete), true);
  const { worker_generation: _omitted, ...missingWorkerGeneration } = complete;
  assert.equal(isNeedsInputCardAnswerable(missingWorkerGeneration), false);
});

test("NeedsInputCard routes answers through RPC recovery without a Shell wake callback", () => {
  const cardSource = readFileSync(new URL("./NeedsInputCard.jsx", import.meta.url), "utf8");
  const transcriptSource = readFileSync(new URL("./SessionTranscript.jsx", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("./SessionSurface.jsx", import.meta.url), "utf8");
  assert.match(cardSource, /answerNeedsInputWithReconnect\s*\(/);
  assert.match(cardSource, /invoke\("session_answer_menu"/);
  assert.match(cardSource, /setError\(needsInputFailureMessage\(failure\)\)/);
  assert.ok(!cardSource.includes("onEnsureShell"));
  assert.ok(!transcriptSource.includes("onEnsureShell"));
  assert.ok(!surfaceSource.includes("onEnsureShell"));
  assert.ok(!cardSource.includes("open its Shell, then try again"));
});
