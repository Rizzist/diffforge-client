import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyUsageTitle,
  dailyUsageValue,
  creditRemainingWithReserved,
  creditSnapshotHasMeaningfulData,
  formatCredits,
  formatCost,
  formatCostTitle,
  formatTokenTitle,
  formatTokens,
  normalizeCreditWallet,
  rowActivityTokens,
  rowCache,
  rowInput,
  rowOutput,
  rowProviderAccountKey,
  rowProviderAccountLabel,
  rowTotal,
} from "./tokenomicsFormat.js";

test("token formatting graduates from millions to billions", () => {
  assert.equal(formatTokens(178_000), "178K");
  assert.equal(formatTokens(66_000_000), "66M");
  assert.equal(formatTokens(5_667_000_000), "5.67B");
  assert.equal(formatTokens(1_234_000_000_000), "1.23T");
});

test("token titles expose exact comma-grouped values", () => {
  assert.equal(formatTokenTitle(5_667_000_000), "5,667,000,000 tokens");
});

test("cost formatting uses readable comma-grouped dollars", () => {
  assert.equal(formatCost(49_000_000), "$49");
  assert.equal(formatCost(4_515_000_000), "$4,515");
  assert.equal(formatCostTitle(4_515_000_000), "$4,515");
});

test("row helpers read backend rollup fields", () => {
  const row = {
    input_tokens: 66_000_000,
    output_tokens: 178_000,
    cache_read_tokens: 63_000_000,
    cache_write_tokens: 1_000_000,
    total_tokens: 66_178_000,
  };

  assert.equal(rowInput(row), 66_000_000);
  assert.equal(rowOutput(row), 178_000);
  assert.equal(rowCache(row), 64_000_000);
  assert.equal(rowTotal(row), 66_178_000);
  assert.equal(rowActivityTokens(row), 66_178_000);
});

test("daily usage reads already-aggregated chart rows", () => {
  const row = {
    label: "Today",
    input: 66_000_000,
    output: 178_000,
    cache: 64_000_000,
    total: 66_178_000,
    cost: 49_000_000,
  };

  assert.equal(dailyUsageValue(row), 66_178_000);
  assert.equal(
    dailyUsageTitle(row),
    "Today: total 66.2M · input 66M · cache 64M · output 178K · cost $49",
  );
});

test("provider account helpers prefer explicit account identity", () => {
  const row = {
    subscription_key: "openai:codex:legacy",
    provider_account_key: "openai:codex:abc123",
    provider_account_label: "Codex account abc123",
  };

  assert.equal(rowProviderAccountKey(row), "openai:codex:abc123");
  assert.equal(rowProviderAccountLabel(row), "Codex account abc123");
  assert.equal(rowProviderAccountKey({ subscriptionKey: "anthropic:claude" }), "anthropic:claude");
});

test("credit wallet normalization prefers the freshest larger used total", () => {
  const normalized = normalizeCreditWallet({
    planName: "plus",
    termUsedCredits: 1363,
    termRemainingCredits: 0,
    total: {
      total_credits: 10000,
      used_credits: 9820,
      remaining_credits: 180,
      reserved_credits: 0,
    },
  });

  assert.equal(creditSnapshotHasMeaningfulData(normalized), true);
  assert.equal(normalized.termUsedCredits, 9820);
  assert.equal(normalized.termRemainingCredits, 180);
  assert.equal(normalized.termReservedCredits, 0);
  assert.equal(formatCredits(normalized.termUsedCredits), "9,820");
});

test("credit wallet normalization reads term and top-level aliases", () => {
  const normalized = normalizeCreditWallet({
    term: {
      totalCredits: 10000,
      usedCredits: 9840,
      reservedCredits: 20,
    },
    remainingCredits: 140,
  });

  assert.equal(normalized.termUsedCredits, 9840);
  assert.equal(normalized.termRemainingCredits, 140);
  assert.equal(normalized.termReservedCredits, 20);
  assert.equal(creditRemainingWithReserved(normalized), 160);
});

test("credit wallet normalization derives remaining when partial aliases are stale zeroes", () => {
  const normalized = normalizeCreditWallet({
    termUsedCredits: 1363,
    termRemainingCredits: 0,
    termReservedCredits: 0,
    termTotalCredits: 10000,
    localMeteredUsedCredits: 9840,
  });

  assert.equal(normalized.termUsedCredits, 9840);
  assert.equal(normalized.termRemainingCredits, 160);
  assert.equal(normalized.termReservedCredits, 0);
});

test("credit wallet normalization does not carry larger used total across term resets", () => {
  const normalized = normalizeCreditWallet({
    term: {
      id: "term-next",
      total_credits: 10000,
      used_credits: 20,
      remaining_credits: 9980,
      reserved_credits: 0,
    },
  }, {
    termId: "term-previous",
    termUsedCredits: 9840,
    termRemainingCredits: 160,
    termReservedCredits: 0,
    termTotalCredits: 10000,
  });

  assert.equal(normalized.termId, "term-next");
  assert.equal(normalized.termUsedCredits, 20);
  assert.equal(normalized.termRemainingCredits, 9980);
});

test("credit wallet normalization does not let unknown zero snapshots wipe same-term paid usage", () => {
  const normalized = normalizeCreditWallet({
    known: false,
    termTotalCredits: 0,
    termUsedCredits: 0,
    termRemainingCredits: 0,
    termReservedCredits: 0,
  }, {
    planName: "plus",
    termId: "term-current",
    termTotalCredits: 10000,
    termUsedCredits: 9700,
    termRemainingCredits: 300,
    termReservedCredits: 0,
  });

  assert.equal(normalized.planName, "plus");
  assert.equal(normalized.termTotalCredits, 10000);
  assert.equal(normalized.termUsedCredits, 9700);
  assert.equal(normalized.termRemainingCredits, 300);
});
