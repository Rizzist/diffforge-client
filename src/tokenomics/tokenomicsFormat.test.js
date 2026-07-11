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
  formatPaceMultiplier,
  formatTokenTitle,
  formatTokens,
  normalizeCreditWallet,
  paceMultiplierFromDelta,
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

test("pace multiplier formatting derives speed from projected delta", () => {
  assert.equal(paceMultiplierFromDelta(-50), 0.5);
  assert.equal(paceMultiplierFromDelta(0), 1);
  assert.equal(paceMultiplierFromDelta(51), 1.51);
  assert.equal(formatPaceMultiplier(0.5), "0.5x");
  assert.equal(formatPaceMultiplier(1.51), "1.51x");
  assert.equal(formatPaceMultiplier(2), "2x");
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
  assert.equal(rowProviderAccountKey({ subscription_key: "anthropic:claude" }), "anthropic:claude");
});

test("credit wallet normalization prefers the freshest larger used total", () => {
  const normalized = normalizeCreditWallet({
    plan_name: "plus",
    term_used_credits: 1363,
    term_remaining_credits: 0,
    total: {
      total_credits: 10000,
      used_credits: 9820,
      remaining_credits: 180,
      reserved_credits: 0,
    },
  });

  assert.equal(creditSnapshotHasMeaningfulData(normalized), true);
  assert.equal(normalized.term_used_credits, 9820);
  assert.equal(normalized.term_remaining_credits, 180);
  assert.equal(normalized.term_reserved_credits, 0);
  assert.equal(formatCredits(normalized.term_used_credits), "9,820");
});

test("credit wallet normalization reads term and top-level aliases", () => {
  const normalized = normalizeCreditWallet({
    term: {
      total_credits: 10000,
      used_credits: 9840,
      reserved_credits: 20,
    },
    remaining_credits: 140,
  });

  assert.equal(normalized.term_used_credits, 9840);
  assert.equal(normalized.term_remaining_credits, 140);
  assert.equal(normalized.term_reserved_credits, 20);
  assert.equal(creditRemainingWithReserved(normalized), 160);
});

test("credit wallet normalization derives remaining when partial aliases are stale zeroes", () => {
  const normalized = normalizeCreditWallet({
    term_used_credits: 1363,
    term_remaining_credits: 0,
    term_reserved_credits: 0,
    term_total_credits: 10000,
    local_metered_used_credits: 9840,
  });

  assert.equal(normalized.term_used_credits, 9840);
  assert.equal(normalized.term_remaining_credits, 160);
  assert.equal(normalized.term_reserved_credits, 0);
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
    term_id: "term-previous",
    term_used_credits: 9840,
    term_remaining_credits: 160,
    term_reserved_credits: 0,
    term_total_credits: 10000,
  });

  assert.equal(normalized.term_id, "term-next");
  assert.equal(normalized.term_used_credits, 20);
  assert.equal(normalized.term_remaining_credits, 9980);
});

test("credit wallet normalization does not let unknown zero snapshots wipe same-term paid usage", () => {
  const normalized = normalizeCreditWallet({
    known: false,
    term_total_credits: 0,
    term_used_credits: 0,
    term_remaining_credits: 0,
    term_reserved_credits: 0,
  }, {
    plan_name: "plus",
    term_id: "term-current",
    term_total_credits: 10000,
    term_used_credits: 9700,
    term_remaining_credits: 300,
    term_reserved_credits: 0,
  });

  assert.equal(normalized.plan_name, "plus");
  assert.equal(normalized.term_total_credits, 10000);
  assert.equal(normalized.term_used_credits, 9700);
  assert.equal(normalized.term_remaining_credits, 300);
});

test("credit wallet normalization can let live websocket totals replace stale auth credits", () => {
  const normalized = normalizeCreditWallet({
    known: true,
    live: true,
    plan_name: "plus",
    term_total_credits: 10000,
    term_used_credits: 9000,
    term_remaining_credits: 1000,
  }, {
    plan_name: "plus",
    term_total_credits: 10000,
    term_used_credits: 7642,
    term_remaining_credits: 2358,
  }, {
    preferIncomingTotals: true,
  });

  assert.equal(normalized.term_used_credits, 9000);
  assert.equal(normalized.term_remaining_credits, 1000);
});
