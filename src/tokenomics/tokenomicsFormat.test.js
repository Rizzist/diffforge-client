import assert from "node:assert/strict";
import test from "node:test";
import {
  billingStatusCredits,
  billingStatusPlanName,
  billingStatusPlanStatus,
  billingStatusUpdatedAt,
  dailyUsageTitle,
  dailyUsageValue,
  creditRemainingWithReserved,
  creditSnapshotHasFiniteTotals,
  creditSnapshotHasMeaningfulData,
  formatCredits,
  formatCost,
  formatCostTitle,
  formatPaceMultiplier,
  formatTokenTitle,
  formatTokens,
  normalizeCreditWallet,
  paceMultiplierFromDelta,
  resolveAccountDisplayedCreditWalletState,
  resolveDisplayedCreditWallet,
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

test("persisted camel-case billing snapshots populate plan and credit fields", () => {
  const billingStatus = {
    planName: "plus",
    planStatus: "paid",
    updatedAt: "2026-07-11T12:00:00.000Z",
    credits: {
      planName: "plus",
      termId: "term-camel",
      resetAt: "2026-08-01T00:00:00.000Z",
      lowCreditState: "low",
      termTotalCredits: 10000,
      termUsedCredits: 7600,
      termRemainingCredits: 2200,
      termReservedCredits: 200,
      updatedAt: "2026-07-11T11:59:00.000Z",
    },
  };

  assert.equal(billingStatusPlanName(billingStatus), "plus");
  assert.equal(billingStatusPlanStatus(billingStatus), "paid");
  assert.equal(billingStatusUpdatedAt(billingStatus), "2026-07-11T12:00:00.000Z");
  assert.equal(billingStatusCredits(billingStatus), billingStatus.credits);
  assert.equal(creditSnapshotHasMeaningfulData(billingStatus.credits), true);
  assert.equal(creditSnapshotHasFiniteTotals(billingStatus.credits), true);

  const normalized = normalizeCreditWallet(billingStatus.credits);
  assert.equal(normalized.plan_name, "plus");
  assert.equal(normalized.term_id, "term-camel");
  assert.equal(normalized.reset_at, "2026-08-01T00:00:00.000Z");
  assert.equal(normalized.lowCreditState, "low");
  assert.equal(normalized.term_total_credits, 10000);
  assert.equal(normalized.term_used_credits, 7600);
  assert.equal(normalized.term_remaining_credits, 2200);
  assert.equal(normalized.term_reserved_credits, 200);
  assert.equal(creditRemainingWithReserved(normalized), 2400);
});

test("billing snapshot helpers retain legacy snake-case fallbacks", () => {
  const status = {
    plan_name: "pro",
    plan_status: "paid",
    updated_at: "2026-07-10T12:00:00.000Z",
    user: {
      credits: {
        term_total_credits: 20000,
      },
    },
  };

  assert.equal(billingStatusPlanName(status), "pro");
  assert.equal(billingStatusPlanStatus(status), "paid");
  assert.equal(billingStatusUpdatedAt(status), "2026-07-10T12:00:00.000Z");
  assert.equal(billingStatusCredits(status), status.user.credits);
});

test("billing credit selection skips empty wrappers for meaningful nested credits", () => {
  const nestedCredits = {
    termTotalCredits: 10000,
    termRemainingCredits: 10000,
  };
  const status = {
    credits: {},
    user: { credits: nestedCredits },
  };

  assert.equal(billingStatusCredits(status), nestedCredits);
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

test("finite-totals detection separates numeric wallets from metadata-only snapshots", () => {
  assert.equal(creditSnapshotHasFiniteTotals(null), false);
  assert.equal(creditSnapshotHasFiniteTotals({ plan_name: "plus", known: true }), false);
  assert.equal(creditSnapshotHasFiniteTotals({ termRemainingCredits: null }), false);
  assert.equal(creditSnapshotHasFiniteTotals({ termRemainingCredits: "" }), false);
  assert.equal(creditSnapshotHasFiniteTotals({ term_remaining_credits: 0 }), true);
  assert.equal(creditSnapshotHasFiniteTotals({ termRemainingCredits: "0" }), true);
  assert.equal(creditSnapshotHasFiniteTotals({ total: { used_credits: 12 } }), true);
});

test("authoritative snapshots without finite totals cannot zero previous credits", () => {
  const previous = {
    plan_name: "plus",
    term_id: "term-current",
    term_total_credits: 10000,
    term_used_credits: 7642,
    term_remaining_credits: 2358,
    term_reserved_credits: 0,
  };
  const normalized = normalizeCreditWallet({
    known: true,
    live: true,
    plan_name: "plus",
    termId: "term-next",
  }, previous, {
    preferIncomingTotals: true,
  });

  assert.equal(normalized, previous);
  assert.equal(normalized.term_id, "term-current");
  assert.equal(normalized.term_total_credits, 10000);
  assert.equal(normalized.term_used_credits, 7642);
  assert.equal(normalized.term_remaining_credits, 2358);
});

test("metadata-only authoritative wallets remain loading without a baseline", () => {
  assert.equal(resolveDisplayedCreditWallet(null, {
    known: true,
    planName: "plus",
  }), null);
  assert.equal(resolveDisplayedCreditWallet(null, {
    live: true,
    planName: "plus",
  }), null);
});

test("credits widget populates from the auth billing baseline before the live websocket", () => {
  // The desktop-auth billing store snapshot (no live hot-state yet).
  const authCredits = {
    plan_name: "plus",
    total_credits: 10000,
    used_credits: 1500,
    remaining_credits: 8200,
    reserved_credits: 300,
  };

  const displayed = resolveDisplayedCreditWallet(null, authCredits);

  assert.ok(displayed);
  assert.equal(displayed.plan_name, "plus");
  assert.equal(displayed.term_total_credits, 10000);
  assert.equal(displayed.term_used_credits, 1500);
  assert.equal(displayed.term_remaining_credits, 8200);
  assert.equal(displayed.term_reserved_credits, 300);
});

test("credits widget shows a loading state (null), never a hard zero, when nothing is known", () => {
  assert.equal(resolveDisplayedCreditWallet(null, null), null);
  assert.equal(resolveDisplayedCreditWallet(null, {}), null);
  assert.equal(resolveDisplayedCreditWallet(null, {
    known: false,
    termTotalCredits: 0,
    termUsedCredits: 0,
    termRemainingCredits: 0,
    termReservedCredits: 0,
  }), null);
});

test("transient empty or unknown hot snapshots do not zero the auth baseline", () => {
  const baseline = resolveDisplayedCreditWallet(null, {
    plan_name: "plus",
    total_credits: 10000,
    used_credits: 1500,
    remaining_credits: 8200,
    reserved_credits: 300,
  });

  // Hot state disappears entirely (billing status momentarily null).
  assert.equal(resolveDisplayedCreditWallet(baseline, null), baseline);
  // Hot state carries an empty snapshot.
  assert.equal(resolveDisplayedCreditWallet(baseline, {}), baseline);
  // Hot state carries an unknown zero-fallback snapshot.
  const afterUnknown = resolveDisplayedCreditWallet(baseline, {
    known: false,
    term_total_credits: 0,
    term_used_credits: 0,
    term_remaining_credits: 0,
    term_reserved_credits: 0,
  });
  assert.equal(afterUnknown, baseline);
  assert.equal(afterUnknown.term_remaining_credits, 8200);
});

test("a genuine known:true zeroed balance still updates the credits widget to 0", () => {
  const baseline = resolveDisplayedCreditWallet(null, {
    plan_name: "plus",
    total_credits: 10000,
    used_credits: 1500,
    remaining_credits: 8200,
    reserved_credits: 300,
  });

  const displayed = resolveDisplayedCreditWallet(baseline, {
    known: true,
    live: true,
    plan_name: "plus",
    term_total_credits: 10000,
    term_used_credits: 10000,
    term_remaining_credits: 0,
    term_reserved_credits: 0,
  });

  assert.equal(displayed.term_used_credits, 10000);
  assert.equal(displayed.term_remaining_credits, 0);
  assert.equal(displayed.term_reserved_credits, 0);
});

test("meaningful live snapshots refresh the displayed baseline", () => {
  const baseline = resolveDisplayedCreditWallet(null, {
    plan_name: "plus",
    total_credits: 10000,
    used_credits: 1500,
    remaining_credits: 8200,
    reserved_credits: 300,
  });

  const displayed = resolveDisplayedCreditWallet(baseline, {
    known: true,
    live: true,
    plan_name: "plus",
    term_total_credits: 10000,
    term_used_credits: 4200,
    term_remaining_credits: 5600,
    term_reserved_credits: 200,
  });

  assert.equal(displayed.term_used_credits, 4200);
  assert.equal(displayed.term_remaining_credits, 5600);
  assert.equal(displayed.term_reserved_credits, 200);
});

test("partial authoritative snapshots update present fields without erasing the baseline", () => {
  const baseline = resolveDisplayedCreditWallet(null, {
    planName: "plus",
    termId: "term-current",
    termTotalCredits: 10000,
    termUsedCredits: 7600,
    termRemainingCredits: 2200,
    termReservedCredits: 200,
  });

  const displayed = resolveDisplayedCreditWallet(baseline, {
    known: true,
    live: true,
    termId: "term-current",
    termRemainingCredits: 1800,
  });

  assert.equal(displayed.term_total_credits, 10000);
  assert.equal(displayed.term_used_credits, 7600);
  assert.equal(displayed.term_remaining_credits, 1800);
  assert.equal(displayed.term_reserved_credits, 200);
});

test("authoritative partial snapshots preserve an explicit zero remaining balance", () => {
  const baseline = resolveDisplayedCreditWallet(null, {
    planName: "plus",
    termId: "term-current",
    termTotalCredits: 10000,
    termUsedCredits: 7600,
    termRemainingCredits: 2200,
    termReservedCredits: 200,
  });

  for (const incoming of [
    { known: true, live: true, termId: "term-current", termRemainingCredits: 0 },
    { known: true, live: true, term_id: "term-current", term_remaining_credits: 0 },
  ]) {
    const displayed = resolveDisplayedCreditWallet(baseline, incoming);
    assert.equal(displayed.term_total_credits, 10000);
    assert.equal(displayed.term_used_credits, 7600);
    assert.equal(displayed.term_remaining_credits, 0);
    assert.equal(displayed.term_reserved_credits, 200);
  }
});

test("incoming snake wallet aliases replace stale canonical aliases coherently", () => {
  const normalized = normalizeCreditWallet({
    known: true,
    live: true,
    plan_name: "pro",
    plan_status: "paid",
    low_credit_state: "critical",
    term_total_credits: 20000,
    term_used_credits: 15000,
    term_remaining_credits: 4800,
    term_reserved_credits: 200,
    input_tokens: 900,
    output_tokens: 300,
  }, {
    planName: "plus",
    planStatus: "paid",
    lowCreditState: "ok",
    termTotalCredits: 10000,
    termUsedCredits: 1000,
    termRemainingCredits: 9000,
    termReservedCredits: 0,
    inputTokens: 100,
    outputTokens: 50,
  }, {
    preferIncomingTotals: true,
  });

  assert.equal(normalized.planName, "pro");
  assert.equal(normalized.plan_name, "pro");
  assert.equal(normalized.lowCreditState, "critical");
  assert.equal(normalized.low_credit_state, "critical");
  assert.equal(normalized.totalCredits, 20000);
  assert.equal(normalized.total_credits, 20000);
  assert.equal(normalized.inputTokens, 900);
  assert.equal(normalized.input_tokens, 900);
  assert.equal(normalized.outputTokens, 300);
  assert.equal(normalized.output_tokens, 300);
});

test("credit normalization stays stable across partial updates and a second pass", () => {
  const baseline = normalizeCreditWallet({
    known: true,
    live: true,
    termId: "term-current",
    termEnd: "2026-08-01T00:00:00.000Z",
    termTotalCredits: 10000,
    termUsedCredits: 800,
    termRemainingCredits: 9000,
    termReservedCredits: 200,
    total: {
      totalCredits: 10000,
      usedCredits: 800,
      remainingCredits: 9000,
      reservedCredits: 200,
    },
  });
  const partial = normalizeCreditWallet({
    known: true,
    live: true,
    termId: "term-current",
    termRemainingCredits: 8000,
  }, baseline, { preferIncomingTotals: true });
  const secondPass = normalizeCreditWallet(partial, null, { preferIncomingTotals: true });

  assert.equal(partial.termRemainingCredits, 8000);
  assert.equal(partial.total.remainingCredits, 8000);
  assert.equal(secondPass.termRemainingCredits, 8000);
  assert.equal(secondPass.total.remainingCredits, 8000);
});

test("credit normalization keeps a top-level term rollover over stale nested term metadata", () => {
  const baseline = normalizeCreditWallet({
    known: true,
    live: true,
    term: {
      id: "term-a",
      termEnd: "2026-08-01T00:00:00.000Z",
      totalCredits: 10000,
      usedCredits: 9000,
      remainingCredits: 1000,
      reservedCredits: 0,
    },
  });
  const rollover = normalizeCreditWallet({
    known: true,
    live: true,
    termId: "term-b",
    termEnd: "2026-09-01T00:00:00.000Z",
    termTotalCredits: 10000,
    termUsedCredits: 100,
    termRemainingCredits: 9900,
    termReservedCredits: 0,
  }, baseline, { preferIncomingTotals: true });
  const secondPass = normalizeCreditWallet(rollover, null, { preferIncomingTotals: true });

  assert.equal(rollover.termId, "term-b");
  assert.equal(rollover.term.id, "term-b");
  assert.equal(rollover.term.termEnd, "2026-09-01T00:00:00.000Z");
  assert.equal(secondPass.termId, "term-b");
  assert.equal(secondPass.termEnd, "2026-09-01T00:00:00.000Z");
});

test("displayed credit state never carries a wallet across account changes", () => {
  const accountABilling = {
    credits: {
      planName: "plus",
      termTotalCredits: 10000,
      termUsedCredits: 1000,
      termRemainingCredits: 9000,
      termReservedCredits: 0,
    },
  };
  const accountBBilling = {
    credits: {
      planName: "pro",
      termTotalCredits: 20000,
      termUsedCredits: 2500,
      termRemainingCredits: 17500,
      termReservedCredits: 0,
    },
  };

  const accountAState = resolveAccountDisplayedCreditWalletState(
    null,
    "account-a",
    accountABilling,
  );
  assert.equal(accountAState.credits.term_remaining_credits, 9000);

  const waitingForB = resolveAccountDisplayedCreditWalletState(
    accountAState,
    "account-b",
    accountABilling,
  );
  assert.equal(waitingForB.credits, null);
  assert.equal(waitingForB.awaitingBillingStatus, true);

  const accountBState = resolveAccountDisplayedCreditWalletState(
    waitingForB,
    "account-b",
    accountBBilling,
  );
  assert.equal(accountBState.awaitingBillingStatus, false);
  assert.equal(accountBState.credits.plan_name, "pro");
  assert.equal(accountBState.credits.term_remaining_credits, 17500);
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
