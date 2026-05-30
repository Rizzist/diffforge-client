import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyUsageTitle,
  dailyUsageValue,
  formatCost,
  formatCostTitle,
  formatTokenTitle,
  formatTokens,
  rowActivityTokens,
  rowCache,
  rowInput,
  rowOutput,
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
