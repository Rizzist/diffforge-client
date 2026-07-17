import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPackageResultSucceeded,
  agentUpdateCanRetryAsAdministrator,
  agentUpdateMessageLooksPermissionDenied,
  agentUpdateProgressMessage,
  agentUpdateResultSucceeded,
  normalizeAgentUpdateProgress,
} from "./agentUpdateUi.js";

test("update success requires updated plus a verified installed version", () => {
  assert.equal(agentUpdateResultSucceeded({ ok: true, installed: true, updated: true, installed_version: "1.2.3" }), true);
  assert.equal(agentUpdateResultSucceeded({ ok: true, installed: true, updated: false, installed_version: "1.2.3" }), false);
  assert.equal(agentUpdateResultSucceeded({ ok: true, installed: true, updated: true, installed_version: "" }), false);
  assert.equal(agentPackageResultSucceeded({ source: "npm-update", ok: true, installed: true, updated: false, installed_version: "1.2.3" }), false);
  assert.equal(agentPackageResultSucceeded({ source: "npm-update", ok: false, installed: true, updated: false, error_kind: "coalesced" }), false);
});

test("administrator retry is Windows, permission, and manual only", () => {
  const denied = { source: "npm-update", ok: false, permission_denied: true };
  assert.equal(agentUpdateCanRetryAsAdministrator(denied, true), true);
  assert.equal(agentUpdateCanRetryAsAdministrator(denied, false), false);
  assert.equal(agentUpdateCanRetryAsAdministrator({ ...denied, remote: true }, true), false);
  assert.equal(agentUpdateCanRetryAsAdministrator({ ...denied, permission_denied: false }, true), false);
});

test("outer update errors retain permission classification", () => {
  assert.equal(agentUpdateMessageLooksPermissionDenied("npm ERR! code EACCES"), true);
  assert.equal(agentUpdateMessageLooksPermissionDenied("network connection reset"), false);
});

test("all progress states normalize and queued explains its timeout", () => {
  for (const stage of ["queued", "downloading", "installing", "verifying", "failed"]) {
    assert.equal(normalizeAgentUpdateProgress({ provider: "Codex", stage })?.stage, stage);
  }
  assert.match(agentUpdateProgressMessage({ stage: "queued" }, "Codex"), /cancels automatically after 60 seconds/i);
  assert.equal(
    agentUpdateProgressMessage({ stage: "failed", failed_stage: "installing", error_reason: "npm failed" }, "Codex"),
    "Failed — npm failed",
  );
});
