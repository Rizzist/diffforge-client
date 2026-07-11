import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderTurnCompletionIntent,
  shouldReconcileProviderTurnCompletion,
} from "./providerTurnIntent.js";

test("casual provider turn completions do not reconcile coordination", () => {
  assert.equal(shouldReconcileProviderTurnCompletion({
    pane_id: "workspace-terminal-1",
    provider_turn_intent: "casual_message",
    reconcile_coordination: false,
    type: "provider-turn-completed",
  }), false);
});

test("provider turn completion reconciliation requires explicit opt-in", () => {
  assert.equal(shouldReconcileProviderTurnCompletion({
    pane_id: "workspace-terminal-1",
    provider_turn_intent: "coordination_task",
    type: "provider-turn-completed",
  }), false);

  assert.equal(shouldReconcileProviderTurnCompletion({
    pane_id: "workspace-terminal-1",
    provider_turn_intent: "coordination_task",
    reconcile_coordination: true,
    type: "provider-turn-completed",
  }), true);
});

test("provider turn completion reconciliation requires a terminal pane", () => {
  assert.equal(shouldReconcileProviderTurnCompletion({
    provider_turn_intent: "coordination_task",
    reconcile_coordination: true,
    type: "provider-turn-completed",
  }), false);
});

test("provider turn intent defaults to casual message", () => {
  assert.equal(getProviderTurnCompletionIntent({}), "casual_message");
  assert.equal(getProviderTurnCompletionIntent({ provider_turn_intent: "  " }), "casual_message");
});
