import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeTokenomicsProviderAccounts,
  tokenomicsCurrentProfileIdsByProvider,
  tokenomicsRowReferencesRemovedProfile,
} from "./tokenomicsAccountRoster.js";

const codexRow = (key, extra = {}) => ({
  device_id: "device-a",
  provider: "openai",
  agent_kind: "codex",
  provider_account_key: key,
  billing_scope_type: "personal",
  ...extra,
});

test("removed-profile filter fails open while account state is null", () => {
  const row = codexRow("openai:codex:profile:p9", { agent_profile_id: "p9" });
  assert.equal(tokenomicsRowReferencesRemovedProfile(row, null), false);
});

test("removed-profile filter hides only profiles absent from a hydrated registry", () => {
  const hydrated = tokenomicsCurrentProfileIdsByProvider({
    codex: { profiles: [{ id: "p1" }] },
  });
  const present = codexRow("openai:codex:profile:p1", { agent_profile_id: "p1" });
  const absent = codexRow("openai:codex:profile:p9", { agent_profile_id: "p9" });
  const defaultRow = codexRow("openai:codex:main");
  assert.equal(tokenomicsRowReferencesRemovedProfile(present, hydrated), false);
  assert.equal(tokenomicsRowReferencesRemovedProfile(absent, hydrated), true);
  assert.equal(tokenomicsRowReferencesRemovedProfile(defaultRow, hydrated), false);
});

test("profile id is derived from synthetic account keys when the row lacks one", () => {
  const hydrated = tokenomicsCurrentProfileIdsByProvider({ codex: { profiles: [] } });
  const synthetic = codexRow("openai:codex:profile:p3");
  assert.equal(tokenomicsRowReferencesRemovedProfile(synthetic, hydrated), true);
});

test("empty or partial snapshots never shrink the provider-account roster", () => {
  const previous = { provider_accounts: [codexRow("a"), codexRow("b")] };
  assert.equal(
    mergeTokenomicsProviderAccounts(previous, { provider_accounts: [] }).length,
    2,
  );
  const partial = mergeTokenomicsProviderAccounts(previous, {
    provider_accounts: [codexRow("c")],
  });
  assert.deepEqual(
    partial.map((row) => row.provider_account_key).sort(),
    ["a", "b", "c"],
  );
});

test("newer snapshot rows replace older rows with the same composite key", () => {
  const previous = { provider_accounts: [codexRow("a", { provider_account_label: "old" })] };
  const next = { provider_accounts: [codexRow("a", { provider_account_label: "new" })] };
  const merged = mergeTokenomicsProviderAccounts(previous, next);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].provider_account_label, "new");
});

test("rows leave the roster only through explicit retirement tombstones", () => {
  const previous = { provider_accounts: [codexRow("a"), codexRow("retired-key")] };
  const merged = mergeTokenomicsProviderAccounts(previous, {
    provider_accounts: [],
    retired_account_keys: ["retired-key"],
  });
  assert.deepEqual(merged.map((row) => row.provider_account_key), ["a"]);
});

test("device and scope participate in the composite key", () => {
  const previous = { provider_accounts: [codexRow("a")] };
  const otherDevice = codexRow("a", { device_id: "device-b" });
  const otherScope = codexRow("a", { billing_scope_type: "team", billing_team_id: "t1" });
  const merged = mergeTokenomicsProviderAccounts(previous, {
    provider_accounts: [otherDevice, otherScope],
  });
  assert.equal(merged.length, 3);
});
