import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityUnavailableFromError,
  hookListView,
  hookSummaryView,
  toolManifestView,
  trustArgs,
} from "./capabilityModel.js";

test("[pin] hook trust is fail-closed and the published digest is the sole identity", () => {
  const digest = "sha256:DAEMON/Published+Digest==";
  const trusted = hookSummaryView({
    name: "published hook",
    source: "/workspace/.haider/hook.json",
    digest,
    trust_state: "trusted",
    trusted: true,
  });
  assert.equal(trusted.trust.trusted, true);
  assert.equal(trusted.digest, digest);

  const future = hookSummaryView({
    digest,
    trust_state: "future_attested",
    trusted: true,
  });
  assert.equal(future.trust.trusted, false,
    "an unknown typed trust state must not be upgraded by the legacy boolean");
  assert.equal(future.trust.recognized, false);
  assert.match(future.trust.label, /UNTRUSTED/);

  const absent = hookSummaryView({ digest, trusted: true });
  assert.equal(absent.trust.trusted, false,
    "absent typed trust must not be upgraded by the legacy boolean");
  assert.equal(absent.trust.kind, "absent");

  const args = trustArgs(digest);
  assert.deepEqual(args, { digest });
  assert.equal(args.digest, trusted.digest,
    "trust must send the daemon-published digest character-for-character");
  assert.deepEqual(Object.keys(args), ["digest"],
    "no locally derived hook identity may accompany the digest");
});

test("[pin] absent hook kind stays unspecified and no execution mode is inferred", () => {
  const row = hookSummaryView({
    name: "long-lived-server-hook",
    source: "/workspace/hooks/server.json",
    digest: "sha256:no-mode",
    event: "before_turn",
    timeout_ms: 0,
    trust_state: "untrusted",
  });

  assert.deepEqual(row.kind, {
    kind: "absent",
    raw: null,
    label: "unspecified (not published)",
    recognized: false,
  });
  assert.equal(Object.hasOwn(row, "mode"), false,
    "name, path, event, and timing must never synthesize a run mode");
  assert.equal(row.timeoutMs, 0, "a real published zero remains visible");

  const publishedKind = hookSummaryView({ kind: "future_hook_kind" });
  assert.equal(publishedKind.kind.raw, "future_hook_kind");
  assert.equal(publishedKind.kind.recognized, false);
});

test("[pin] tool input schemas remain opaque values, never normalized forms", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: ["object", "null"],
    oneOf: [false, null, { future_keyword: { z: [3, 2, 1] } }],
    required: ["same", "same"],
    properties: { raw: { const: -0 } },
  };
  const view = toolManifestView({
    manifest: {
      name: "future_tool",
      description: "opaque schema canary",
      effects: [],
      dispatch: "future_dispatch",
      input_schema: schema,
    },
    default: "ask",
  });

  assert.strictEqual(view.inputSchema, schema,
    "the input schema reference must survive without projection");
  assert.deepEqual(view.inputSchema, schema);
  assert.equal(Object.hasOwn(view, "fields"), false,
    "an opaque schema must not become a client-generated form definition");

  const publishedNull = toolManifestView({
    manifest: { input_schema: null },
    default: null,
  });
  assert.equal(publishedNull.inputSchema, null,
    "a published JSON null schema is data, not an absent schema");
  assert.equal(publishedNull.permissionDefault, null,
    "a published JSON null default is data, not an absent default");
});

test("[pin] permission defaults, effects, and dispatch remain daemon facts verbatim", () => {
  const effects = [{ class: "future_effect", detail: 7 }];
  const dispatch = { kind: "future_dispatch", lane: [1, null, false] };
  const permissionDefault = {
    decision: "future_permission_default",
    scope: { token: ["A", 2] },
  };
  const view = toolManifestView({
    manifest: {
      name: "fact_tool",
      description: "published facts",
      effects,
      dispatch,
      input_schema: false,
    },
    default: permissionDefault,
  });

  assert.strictEqual(view.effects, effects);
  assert.strictEqual(view.dispatch, dispatch);
  assert.strictEqual(view.permissionDefault, permissionDefault);
  assert.deepEqual(view.permissionDefault, permissionDefault);
  assert.equal(Object.hasOwn(view, "effectivePermission"), false,
    "the client must not compute what permission would apply");
});

test("[pin] hook policy and revision are shown as published, including future values", () => {
  const view = hookListView({
    policy: "future_workspace_policy",
    revision: "18446744073709551614",
    hooks: [{ digest: "sha256:one", trust_state: "untrusted" }],
  });

  assert.deepEqual(view.policy, {
    kind: "unknown",
    raw: "future_workspace_policy",
    label: "future_workspace_policy",
    recognized: false,
  });
  assert.equal(view.revision, "18446744073709551614");
  assert.equal(view.rows.length, 1);

  const known = hookListView({ policy: "workspace", revision: "0", hooks: [] });
  assert.equal(known.policy.recognized, true);
  assert.equal(known.policy.raw, "workspace");
  assert.equal(known.revision, "0");
});

test("capabilityUnavailableFromError reuses the shared feature-gate detector", () => {
  assert.equal(capabilityUnavailableFromError({ code: "missing_feature" }), true);
  assert.equal(capabilityUnavailableFromError(
    new Error("missing_feature: daemon does not advertise hooks_v1"),
  ), true);
  assert.equal(capabilityUnavailableFromError("does not advertise tool_inventory_v1"), true);
  assert.equal(capabilityUnavailableFromError(new Error("connection reset")), false);
});
