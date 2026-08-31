import assert from "node:assert/strict";
import test from "node:test";

import {
  addArgs,
  profileRowView,
  scopeView,
  sshUnavailableFromError,
  testOutcomeView,
  updateArgs,
} from "./sshProfileModel.js";
import { invalidateTestOutcomeForMutation } from "./useSshProfiles.js";

test("[pin] public profile projection carries identity only and never a secret field", () => {
  const secretCanary = "SECRET-CANARY-private-key-and-password";
  const raw = {
    name: "prod",
    description: "Production",
    host: "prod.example.invalid",
    user: "deploy",
    port: 22,
    default_cwd: "/srv/app",
    host_key: {
      algorithm: "future-host-key-algorithm",
      fingerprint: "SHA256:fixture",
      pinned_at_ms: "1787155782000",
      private_key: secretCanary,
    },
    last_used_ms: "1787155782100",
    multiplexing: true,
    in_scope: false,
    auth: { kind: "password", password: secretCanary },
    private_key: secretCanary,
    key_material: secretCanary,
    passphrase: secretCanary,
    vault_reference: secretCanary,
    secret: secretCanary,
    future_public_field: { nested_secret: secretCanary },
  };

  const view = profileRowView(raw);
  assert.deepEqual(view, {
    name: "prod",
    description: "Production",
    host: "prod.example.invalid",
    user: "deploy",
    port: 22,
    defaultCwd: "/srv/app",
    hostKey: {
      algorithm: "future-host-key-algorithm",
      fingerprint: "SHA256:fixture",
      pinnedAtMs: "1787155782000",
    },
    lastUsedMs: "1787155782100",
    multiplexing: true,
    inScope: false,
  });
  assert.equal(JSON.stringify(view).includes(secretCanary), false,
    "neither known nor additive secret material may survive the public projection");
  for (const forbidden of [
    "raw", "auth", "password", "privateKey", "private_key", "keyMaterial",
    "key_material", "passphrase", "vaultReference", "vault_reference", "secret",
  ]) {
    assert.equal(Object.hasOwn(view, forbidden), false, `${forbidden} must not be carried`);
  }
  assert.notStrictEqual(view.hostKey, raw.host_key,
    "even public nested identity metadata must be allowlisted, not retained raw");
});

test("[pin] reachability comes only from the published test outcome", () => {
  assert.deepEqual(testOutcomeView(null), {
    kind: "untested",
    outcome: null,
    reachable: null,
    label: "not tested",
    recognized: true,
    profileName: null,
    hostKeyPinned: null,
  });

  const rpcSuccessWithoutOutcome = testOutcomeView({
    connected: true,
    profile: { name: "prod" },
    host_key_pinned: true,
  });
  assert.equal(rpcSuccessWithoutOutcome.reachable, null,
    "RPC success and a legacy connected boolean must not imply reachable");
  assert.equal(rpcSuccessWithoutOutcome.kind, "absent");

  assert.equal(testOutcomeView({ outcome: "reachable" }).reachable, true);
  assert.equal(testOutcomeView({ outcome: "unreachable" }).reachable, false);
  const future = testOutcomeView({ outcome: "degraded" });
  assert.equal(future.reachable, null);
  assert.equal(future.outcome, "degraded");
  assert.equal(future.recognized, false);
});

test("[pin] every SSH profile mutation invalidates only that name across sessions", () => {
  const reachable = testOutcomeView({ outcome: "reachable" });
  const unreachable = testOutcomeView({ outcome: "unreachable" });
  const current = {
    alpha: { X: reachable, Y: unreachable },
    beta: { X: unreachable, Y: reachable },
    gamma: { Y: reachable },
  };
  const receipts = [
    ["add", { name: "X" }],
    ["update", { name: "X" }],
    ["remove", "X"],
  ];

  for (const [action, receipt] of receipts) {
    const next = invalidateTestOutcomeForMutation(current, action, receipt);
    assert.equal(Object.hasOwn(next.alpha, "X"), false, `${action} must drop X in alpha`);
    assert.equal(Object.hasOwn(next.beta, "X"), false, `${action} must drop X in beta`);
    assert.strictEqual(next.alpha.Y, unreachable, `${action} must retain unrelated Y`);
    assert.strictEqual(next.beta.Y, reachable, `${action} must retain unrelated Y`);
    assert.strictEqual(next.gamma, current.gamma, `${action} must leave Y-only sessions alone`);
  }
});

test("[pin] an absent or unknown published SSH scope is never local", () => {
  const absent = scopeView(null);
  assert.deepEqual(absent, {
    kind: "absent",
    raw: null,
    label: "not published",
    recognized: false,
    names: [],
  });
  assert.notEqual(absent.raw, "local");
  assert.notEqual(absent.label, "local");

  const future = scopeView({ kind: "regional", names: ["prod"] });
  assert.equal(future.kind, "unknown");
  assert.equal(future.raw, "regional");
  assert.equal(future.recognized, false);
  assert.notEqual(future.raw, "local");

  assert.deepEqual(scopeView({ kind: "allow", names: ["prod", 7, "stage"] }), {
    kind: "known",
    raw: "allow",
    label: "allow",
    recognized: true,
    names: ["prod", "stage"],
  });
});

test("[pin] add/update arguments pass a secret through one verbatim request slot", () => {
  const secretCanary = "SECRET-CANARY-once";
  const profile = { name: "prod", auth: { kind: "password", password: secretCanary } };
  const changes = { auth: { kind: "key_material", private_key: secretCanary } };

  const add = addArgs(profile);
  const update = updateArgs("prod", changes);
  assert.deepEqual(Object.keys(add), ["profile"]);
  assert.strictEqual(add.profile, profile);
  assert.equal(JSON.stringify(add).split(secretCanary).length - 1, 1);
  assert.deepEqual(Object.keys(update), ["name", "changes"]);
  assert.strictEqual(update.changes, changes);
  assert.equal(JSON.stringify(update).split(secretCanary).length - 1, 1);

  const projected = profileRowView(profile);
  assert.equal(JSON.stringify(projected).includes(secretCanary), false,
    "request material must never be retained by the public row view");
});

test("sshUnavailableFromError reuses the shared feature-gate detector", () => {
  assert.equal(sshUnavailableFromError({ code: "missing_feature" }), true);
  assert.equal(sshUnavailableFromError(
    new Error("missing_feature: daemon does not advertise ssh_profiles_v1"),
  ), true);
  assert.equal(sshUnavailableFromError("does not advertise ssh_profiles_v1"), true);
  assert.equal(sshUnavailableFromError(new Error("connection reset")), false);
});
