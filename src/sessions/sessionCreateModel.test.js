import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  admissionView,
  createArgs,
  createReceiptView,
  createUnavailableFromError,
} from "./sessionCreateModel.js";

const REQUIRED_DRAFT = Object.freeze({
  cwd: "/workspace",
  provider: "openai",
  model: "gpt-test",
  maxTokens: 4096,
});

test("[pins 3 and 4] create args omit absent options and never choose an interaction default", () => {
  const omitted = createArgs(REQUIRED_DRAFT, {
    interactionMode: "",
    permissionOverrides: null,
    cachePolicy: undefined,
    admission: null,
  });
  assert.deepEqual(omitted, {
    cwd: "/workspace",
    provider: "openai",
    model: "gpt-test",
    max_tokens: 4096,
  });
  for (const key of [
    "interaction_mode",
    "permission_overrides",
    "cache_policy",
    "admission",
  ]) {
    assert.equal(Object.hasOwn(omitted, key), false, `${key} must be omitted, not null-filled`);
  }

  assert.deepEqual(createArgs(REQUIRED_DRAFT, {
    interactionMode: "interactive",
    permissionOverrides: { auto_allow: true },
  }), {
    cwd: "/workspace",
    provider: "openai",
    model: "gpt-test",
    max_tokens: 4096,
    interaction_mode: "interactive",
    permission_overrides: { auto_allow: true },
  });
  assert.equal(createArgs(REQUIRED_DRAFT, {
    interactionMode: "autonomous",
  }).interaction_mode, "autonomous");
});

test("[pin 1] receipt view copies only daemon-issued identity and opaque metadata", () => {
  const metadata = { cwd: "/daemon/work", future: [1, { opaque: true }] };
  const raw = {
    session_id: "daemon-minted/SESSION::Opaque==",
    created_seq: "9007199254740993",
    worker_generation: "9007199254740994",
    metadata,
  };
  const view = createReceiptView(raw);

  assert.equal(view.sessionId, raw.session_id);
  assert.equal(view.createdSeq, raw.created_seq);
  assert.equal(view.workerGeneration, raw.worker_generation);
  assert.strictEqual(view.metadata, metadata);
  assert.strictEqual(view.raw, raw);
  assert.equal(Object.hasOwn(view, "localSessionId"), false);
});

test("[pin 4] created_seq refuses already-imprecise numbers and is never numeric-parsed", () => {
  assert.equal(createReceiptView({
    session_id: "session-1",
    created_seq: 9007199254740993,
    worker_generation: "7",
    metadata: {},
  }).createdSeq, null);

  const source = readFileSync(new URL("./sessionCreateModel.js", import.meta.url), "utf8");
  const receiptBlock = source.slice(
    source.indexOf("export function createReceiptView"),
    source.indexOf("function normalizedToken"),
  );
  assert.doesNotMatch(receiptBlock, /Number\s*\(|parseInt\s*\(|parseFloat\s*\(/);
});

test("[pin 2] typed admission rejection retains the daemon reason and never becomes unavailable", () => {
  const error = {
    code: "admission_rejected",
    message: "Model inventory is stale; choose a published model.",
    retryable: false,
    data: {
      kind: "model_unknown",
      provider: "openai",
      model: "future-model",
      inventory_age: 87,
    },
  };
  const view = admissionView(error);

  assert.equal(view.state, "rejected");
  assert.equal(view.reason, error.message);
  assert.strictEqual(view.data, error.data);
  assert.strictEqual(view.raw, error);
  assert.equal(createUnavailableFromError(error), false);
});

test("[pin 2] future queued admission is pending while unknown data stays raw", () => {
  const queued = {
    code: "admission_queued",
    message: "Waiting for a worker slot.",
    retryable: false,
    data: { kind: "deferred", queue_ticket: "ticket-9" },
  };
  assert.deepEqual(admissionView(queued), {
    state: "pending",
    reason: queued.message,
    kind: "deferred",
    data: queued.data,
    raw: queued,
    admission: true,
  });

  const futureData = { kind: "capacity_window", opens_at: "future-coordinate" };
  const unknown = admissionView({
    code: "admission_future",
    message: "Future admission outcome.",
    retryable: false,
    data: futureData,
  });
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.admission, true);
  assert.strictEqual(unknown.data, futureData);
});

test("create unavailable detection reuses the feature-gate law without swallowing admission", () => {
  assert.equal(createUnavailableFromError({
    code: "missing_feature",
    message: "daemon does not advertise session_mutation_v1",
    retryable: false,
  }), true);
  assert.equal(createUnavailableFromError("unknown method ade_session_create"), true);
  assert.equal(createUnavailableFromError("Command ade_session_create not found"), true);
  assert.equal(createUnavailableFromError({
    code: "protocol_error",
    message: "session.create response method mismatch",
    retryable: false,
  }), false);
});
