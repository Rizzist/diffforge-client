import assert from "node:assert/strict";
import test from "node:test";

import {
  configureArgs,
  conflictView,
  fenceFor,
  lockdownView,
  providerAdminUnavailableFromError,
  providerRowView,
} from "./providerAdminModel.js";

test("[pin 1] provider rows and fences echo the exact published revision", () => {
  const wireRevision = "09007199254740993";
  const row = providerRowView({
    provider: "local",
    api_family: "openai_responses",
    endpoint: "https://local.example/v1",
    enabled: true,
    models: ["forge-1"],
    availability: "available",
    trust: "lockdown",
  }, wireRevision);

  assert.equal(row.revision, wireRevision);
  assert.equal(fenceFor(row), wireRevision);
  assert.equal(fenceFor({ name: "unread" }), undefined);
  assert.equal(fenceFor({ name: "null", revision: null }), undefined);
});

test("[pin 2] trust display is fail-closed for absent and future values", () => {
  const full = providerRowView({ trust: "full" }).trust;
  const lockdown = providerRowView({ trust: "lockdown" }).trust;
  const future = providerRowView({ trust: "future_restricted" }).trust;
  const absent = providerRowView({}).trust;

  assert.equal(full.fullTrust, true);
  assert.equal(full.label, "Full trust");
  for (const view of [lockdown, future, absent]) assert.equal(view.fullTrust, false);
  assert.match(future.label, /future_restricted.*unrecognized/);
  assert.match(absent.label, /not published.*not full trust/);
});

test("[pin finding 6] unknown auth requirement remains raw and visibly labeled", () => {
  const row = providerRowView({
    provider: "future",
    api_family: "future_api",
    auth_requirement: "hardware_attestation",
    availability: "degraded",
  }, 8);
  assert.equal(row.apiFamily.raw, "future_api");
  assert.equal(row.apiFamily.recognized, false);
  assert.match(row.apiFamily.label, /unrecognized/);
  assert.equal(row.authRequirement.raw, "hardware_attestation");
  assert.equal(row.authRequirement.label, "hardware_attestation (unrecognized)");
  assert.equal(row.availability.raw, "degraded");
});

test("[pin 4] configure create includes identity while update always omits it", () => {
  const fields = {
    provider: "local",
    apiFamily: "openai_responses",
    origin: "https://local.example/v1",
    authRequirement: "api_key",
    enabled: false,
    models: ["forge-1"],
    defaultModel: "",
    responseOpenTimeoutMs: 0,
    expectedRevision: "00041",
  };
  assert.deepEqual(configureArgs("create", fields), {
    provider: "local",
    enabled: false,
    models: ["forge-1"],
    expected_revision: "00041",
    api_family: "openai_responses",
    origin: "https://local.example/v1",
    auth_requirement: "api_key",
    default_model: "",
    response_open_timeout_ms: 0,
  });
  assert.deepEqual(configureArgs("update", fields), {
    provider: "local",
    enabled: false,
    models: ["forge-1"],
    expected_revision: "00041",
    auth_requirement: "api_key",
    default_model: "",
    response_open_timeout_ms: 0,
  });
});

test("[pins 4 and 5] absent configure options stay absent and no row is fabricated", () => {
  const fields = {
    provider: "minimal",
    enabled: true,
    models: [],
    expected_revision: "7",
  };
  const args = configureArgs("update", fields);
  assert.deepEqual(args, {
    provider: "minimal",
    enabled: true,
    models: [],
    expected_revision: "7",
  });
  for (const optional of [
    "api_family",
    "origin",
    "auth_requirement",
    "default_model",
    "response_open_timeout_ms",
    "chunk_idle_timeout_ms",
    "semantic_progress_timeout_ms",
    "probe_vault_reference",
    "trust",
  ]) {
    assert.equal(Object.hasOwn(args, optional), false, `${optional} must be omitted`);
  }
  assert.equal(Object.hasOwn(args, "revision"), false,
    "configure arguments are not an optimistic provider row");
});

test("conflicts preserve expected and current revisions from typed data", () => {
  const conflict = conflictView({
    code: "revision_conflict",
    expected_revision: "top-level-decoy",
    current_revision: "top-level-decoy",
    data: {
      kind: "revision_conflict",
      expected_revision: "9007199254740993",
      current_revision: "9007199254740999",
    },
  });
  assert.equal(conflict.expectedRevision, "9007199254740993");
  assert.equal(conflict.currentRevision, "9007199254740999");
  assert.equal(conflictView(new Error("ordinary failure")), null);
});

test("lockdown display is published-only for activation and quotas", () => {
  const absent = lockdownView(null);
  assert.equal(absent.activation.kind, "absent");
  assert.equal(absent.quotaUsed, undefined);
  assert.equal(absent.quotaLimit, undefined);

  const future = lockdownView({
    provider: "future",
    activation: "future_isolated",
    tools_allowed: [],
    quota_used: 0,
    quota_limit: 4096,
  });
  assert.equal(future.activation.raw, "future_isolated");
  assert.equal(future.activation.recognized, false);
  assert.equal(future.quotaUsed, 0);
  assert.equal(future.quotaLimit, 4096);
});

test("provider admin unavailable detection reuses the shared feature-gate helper", () => {
  assert.equal(providerAdminUnavailableFromError({ code: "missing_feature" }), true);
  assert.equal(providerAdminUnavailableFromError(
    "missing_feature: daemon does not advertise provider_remove_v1",
  ), true);
  assert.equal(providerAdminUnavailableFromError(new Error("network dropped")), false);
});
