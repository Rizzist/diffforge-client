import assert from "node:assert/strict";
import test from "node:test";
import {
  prioritizedTokenomicsIdentityKeyClaims,
  registerTokenomicsIdentityAlias,
  tokenomicsAccountsFromDistinctKeys,
  uniqueTokenomicsAliasesByOwner,
} from "./tokenomicsAccountIdentity.js";

test("a mismatched pushed-profile identity key belongs to the identity email", () => {
  const claims = prioritizedTokenomicsIdentityKeyClaims([{
    email: "support@example.test",
    source: "pushed",
    identity: {
      email: "ADMIN@example.test",
      tokenomicsAccountKey: "anthropic:claude:admin-account",
    },
  }]);

  assert.deepEqual(claims, [{
    key: "anthropic:claude:admin-account",
    ownerEmail: "admin@example.test",
    identityMatchesProfile: false,
    registryOrder: 0,
  }]);
});

test("a matching-email identity owner beats an earlier registry claimant", () => {
  const claims = prioritizedTokenomicsIdentityKeyClaims([
    {
      email: "support@example.test",
      identity: {
        email: "stale@example.test",
        tokenomicsAccountKey: "anthropic:claude:admin-account",
      },
    },
    {
      email: "admin@example.test",
      identity: {
        email: "admin@example.test",
        tokenomicsAccountKey: "anthropic:claude:admin-account",
      },
    },
  ]);

  assert.equal(claims[0].registryOrder, 1);
  assert.equal(claims[0].ownerEmail, "admin@example.test");
  assert.equal(claims[0].identityMatchesProfile, true);
  assert.equal(claims[1].ownerEmail, "stale@example.test");
  assert.equal(claims[1].identityMatchesProfile, false);
  const ownerByKey = new Map();
  claims.forEach((claim) => {
    if (!ownerByKey.has(claim.key)) ownerByKey.set(claim.key, claim.ownerEmail);
  });
  assert.equal(ownerByKey.get("anthropic:claude:admin-account"), "admin@example.test");
});

test("duplicate profile labels are not identity aliases across email owners", () => {
  const unique = uniqueTokenomicsAliasesByOwner([
    {
      owner: "support@splutter.ai",
      aliases: ["support", "support@splutter.ai"],
    },
    {
      owner: "support@diffforge.ai",
      aliases: ["support", "support@diffforge.ai"],
    },
  ]);

  assert.equal(unique.has("support"), false);
  assert.equal(unique.has("support@splutter.ai"), true);
  assert.equal(unique.has("support@diffforge.ai"), true);
});

test("duplicate profiles for one email keep their shared label alias", () => {
  const unique = uniqueTokenomicsAliasesByOwner([
    { owner: "syed@example.test", aliases: ["syed"] },
    { owner: "syed@example.test", aliases: ["syed"] },
  ]);

  assert.equal(unique.has("syed"), true);
});

test("a runtime label collision becomes permanently ambiguous", () => {
  const byAlias = new Map();
  const ambiguous = new Set();
  const splutter = { email: "support@splutter.ai" };
  const diffforge = { email: "support@diffforge.ai" };

  assert.equal(registerTokenomicsIdentityAlias(byAlias, ambiguous, "claude\0support", splutter), true);
  assert.equal(registerTokenomicsIdentityAlias(byAlias, ambiguous, "claude\0support", diffforge), false);
  assert.equal(byAlias.has("claude\0support"), false);
  assert.equal(ambiguous.has("claude\0support"), true);
  assert.equal(registerTokenomicsIdentityAlias(byAlias, ambiguous, "claude\0support", splutter), false);
});

test("distinct account keys remain separate chips when labels collide", () => {
  const accounts = tokenomicsAccountsFromDistinctKeys(new Map([
    ["anthropic:claude:a", { key: "anthropic:claude:a", label: "support", total: 10 }],
    ["anthropic:claude:b", { key: "anthropic:claude:b", label: "support", total: 20 }],
  ]));

  assert.deepEqual(accounts.map((account) => account.key), [
    "anthropic:claude:b",
    "anthropic:claude:a",
  ]);
});
