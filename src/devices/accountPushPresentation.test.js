import assert from "node:assert/strict";
import test from "node:test";

import {
  accountPushRosterRow,
  LEGACY_ACCOUNT_UNAVAILABLE_REASON,
} from "./accountPushPresentation.js";

test("stored legacy account row renders unavailable without throwing", () => {
  const stored = JSON.parse(JSON.stringify({
    alias: "personal",
    id: "captured-codex-personal",
    kind: "codex",
    provider: "openai",
    profile_id: "personal",
    identity: { email: "owner@example.test", auth_ready: true },
  }));

  assert.deepEqual(accountPushRosterRow(stored), {
    alias: "personal",
    provider: "openai",
    state: "unavailable",
    reason: LEGACY_ACCOUNT_UNAVAILABLE_REASON,
    source: stored,
  });
});

test("only a Haider descriptor with published wire identity is push-selectable", () => {
  const descriptor = {
    active: true,
    alias: "personal",
    auth_method: "oauth",
    status: { status: "ok" },
    provider: "openai",
    identity: "owner@example.test",
  };

  assert.equal(accountPushRosterRow(descriptor).state, "available");
  assert.equal(accountPushRosterRow({ ...descriptor, alias: "" }).state, "unavailable");
  assert.equal(accountPushRosterRow({ ...descriptor, provider: "" }).state, "unavailable");
});
