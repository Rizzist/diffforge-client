import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runSessionCreate } from "./useSessionCreate.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const draft = Object.freeze({
  cwd: "/workspace",
  provider: "openai",
  model: "gpt-test",
  maxTokens: 4096,
});

const receipt = Object.freeze({
  session_id: "daemon-session-1",
  created_seq: "9007199254740993",
  worker_generation: "9007199254740994",
  metadata: Object.freeze({ cwd: "/workspace", future: true }),
});

test("[pin] ade_session_create is centralized in the hook and AppShell only wires it", () => {
  const hook = read("./useSessionCreate.js");
  const consumers = [
    read("./SessionSurface.jsx"),
    read("./SessionComposer.jsx"),
    read("../app/AppShell.jsx"),
  ];
  assert.equal((hook.match(/invokeCommand\("ade_session_create"/g) || []).length, 1);
  for (const consumer of consumers) {
    assert.doesNotMatch(consumer, /invoke(?:Command)?\("ade_session_create"/,
      "native create must dispatch only from useSessionCreate");
  }
  assert.match(consumers[2], /const sessionCreateApi = useSessionCreate\(/);
  assert.match(consumers[2], /onCreateDraftSession=\{sessionCreateApi\.materialize\}/);
});

test("[pin 1] rewritten local roster id rejects before submit and preserves the draft", async () => {
  const rejectedCalls = [];
  const draftText = "Keep this exact draft";
  const rejected = await runSessionCreate({
    featureAvailable: true,
    draft,
    options: { maxTokens: 4096 },
    prompt: draftText,
    attachments: [],
    invokeCommand: async (command, args) => {
      rejectedCalls.push([command, args]);
      if (command === "ade_session_create") return receipt;
      if (command === "surface_attach") return { active: true, accepted: true };
      if (command === "session_create") {
        return { id: "local-mirror-row", provider_session_id: receipt.session_id };
      }
      throw new Error(`unexpected invoke ${command}`);
    },
  });

  assert.equal(rejected.kind, "error");
  assert.match(String(rejected.error?.message || rejected.error),
    /local-mirror-row.*daemon-session-1.*not submitted.*draft is preserved/i);
  assert.equal(Object.hasOwn(rejected, "row"), false, "no mismatched session may render");
  assert.equal(draftText, "Keep this exact draft", "a rejected result leaves the draft untouched");
  assert.deepEqual(rejectedCalls.map(([command]) => command), [
    "ade_session_create",
    "surface_attach",
    "session_create",
  ], "identity rejection must happen before submit or roster decoration");
});

test("[pins 1 and 5] receipt identity owns the atomic mirror and every downstream step", async () => {
  const calls = [];
  const result = await runSessionCreate({
    featureAvailable: true,
    draft,
    options: { maxTokens: 4096 },
    prompt: "First prompt",
    attachments: [],
    invokeCommand: async (command, args) => {
      calls.push([command, args]);
      if (command === "ade_session_create") return receipt;
      if (command === "surface_attach") return { active: true, accepted: true };
      if (command === "session_create") {
        return { id: receipt.session_id, title: "First prompt" };
      }
      if (command === "session_submit_prompt") return { disposition: "started" };
      if (command === "session_update") {
        return { id: args.args.id, title: "First prompt", first_user_message: "First prompt" };
      }
      throw new Error(`unexpected invoke ${command}`);
    },
  });

  assert.equal(result.kind, "created");
  assert.deepEqual({
    id: result.row.id,
    session_id: result.row.session_id,
    provider_session_id: result.row.provider_session_id,
    created_seq: result.row.created_seq,
    worker_generation: result.row.worker_generation,
    metadata: result.row.metadata,
  }, {
    id: receipt.session_id,
    session_id: receipt.session_id,
    provider_session_id: receipt.session_id,
    created_seq: receipt.created_seq,
    worker_generation: receipt.worker_generation,
    metadata: receipt.metadata,
  });
  assert.strictEqual(result.receipt.raw, receipt);
  assert.deepEqual(calls.map(([command]) => command), [
    "ade_session_create",
    "surface_attach",
    "session_create",
    "session_submit_prompt",
    "session_update",
  ]);
  assert.deepEqual(calls[1][1], { session_id: receipt.session_id });
  assert.deepEqual(calls[2][1], {
    args: {
      id: receipt.session_id,
      provider_session_id: receipt.session_id,
      created_seq: receipt.created_seq,
      worker_generation: receipt.worker_generation,
      metadata: receipt.metadata,
      title: "First prompt",
      pinned_dir: receipt.metadata.cwd,
    },
  }, "the atomic roster write must receive every exact receipt coordinate");
  assert.equal(calls[3][1].session_id, receipt.session_id);
  assert.equal(calls[4][1].args.id, receipt.session_id);
});

test("[pin 2] admission rejection is terminal: no retry, roster write, submit, or CLI fallback", async () => {
  const calls = [];
  const rejected = await runSessionCreate({
    featureAvailable: true,
    draft,
    options: { maxTokens: 4096 },
    prompt: "Do not retry me",
    invokeCommand: async (command) => {
      calls.push(command);
      throw {
        code: "admission_rejected",
        message: "Provider openai is unavailable for this account.",
        retryable: true,
        data: { kind: "provider_unavailable", provider: "openai" },
      };
    },
    legacyMaterialize: async () => {
      calls.push("legacy");
      return { id: "must-not-exist" };
    },
    mirrorReceipt: async () => {
      calls.push("mirror");
      return { id: "must-not-exist" };
    },
    submitPrompt: async () => {
      calls.push("submit");
    },
  });

  assert.equal(rejected.kind, "admission");
  assert.equal(rejected.admission.state, "rejected");
  assert.equal(rejected.admission.reason, "Provider openai is unavailable for this account.");
  assert.deepEqual(calls, ["ade_session_create"]);
});

test("[pin 2] a deferred admission remains pending and never renders a created row", async () => {
  const result = await runSessionCreate({
    featureAvailable: true,
    draft,
    options: { maxTokens: 4096 },
    prompt: "Queue if needed",
    invokeCommand: async () => {
      throw {
        code: "admission_queued",
        message: "Waiting for capacity.",
        retryable: false,
        data: { kind: "deferred", ticket: "queue-ticket" },
      };
    },
  });

  assert.equal(result.kind, "admission");
  assert.equal(result.admission.state, "pending");
  assert.equal(Object.hasOwn(result, "row"), false);
});

test("[pin 5] attach failure preserves the draft path and writes no local row", async () => {
  let mirrored = false;
  const result = await runSessionCreate({
    featureAvailable: true,
    draft,
    options: { maxTokens: 4096 },
    prompt: "Keep this exact text",
    invokeCommand: async (command) => (
      command === "ade_session_create" ? receipt : { active: false, accepted: false }
    ),
    mirrorReceipt: async () => {
      mirrored = true;
      return { id: "forbidden" };
    },
  });

  assert.equal(result.kind, "error");
  assert.equal(mirrored, false);
  assert.equal(result.prepared.receipt.sessionId, receipt.session_id);
  assert.equal(result.prepared.row, null);
});

test("[pins 3 and 5] unavailable and absent native features retain the legacy path", async () => {
  const absentCalls = [];
  const absent = await runSessionCreate({
    featureAvailable: false,
    draft,
    options: { maxTokens: 4096 },
    prompt: "legacy absent",
    invokeCommand: async (command) => absentCalls.push(command),
    legacyMaterialize: async () => {
      absentCalls.push("legacy");
      return { id: "legacy-row" };
    },
  });
  assert.equal(absent.kind, "legacy");
  assert.deepEqual(absentCalls, ["legacy"]);

  const unavailableCalls = [];
  const unavailable = await runSessionCreate({
    featureAvailable: true,
    draft,
    options: { maxTokens: 4096 },
    prompt: "legacy unavailable",
    invokeCommand: async (command) => {
      unavailableCalls.push(command);
      throw "Command ade_session_create not found";
    },
    legacyMaterialize: async () => {
      unavailableCalls.push("legacy");
      return { id: "legacy-row" };
    },
  });
  assert.equal(unavailable.kind, "legacy");
  assert.equal(unavailable.nativeUnavailable, true);
  assert.deepEqual(unavailableCalls, ["ade_session_create", "legacy"]);
});

test("[pin 3] draft options are create-only, honest about autonomy, and send no default mode", () => {
  const composer = read("./SessionComposer.jsx");
  const surface = read("./SessionSurface.jsx");
  const model = read("./sessionCreateModel.js");

  assert.ok(composer.includes("permissions still apply"));
  assert.ok(composer.includes("separate from autonomy"));
  assert.match(surface, /createOptions=\{draftCreateCapabilities\.native \? draftCreateOptions : null\}/);
  assert.equal((surface.match(/createOptions=/g) || []).length, 1,
    "create options must exist only on the draft composer");
  assert.doesNotMatch(model, /interaction_mode:\s*["']interactive["']/,
    "the arg helper must never install a client-selected interaction default");
  assert.doesNotMatch(model, /\bbudget\s*:/,
    "the shipped session.create SDK does not expose RunBudgetV1");
});
