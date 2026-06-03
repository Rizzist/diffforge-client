import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderTurnCompletionIntent,
  shouldReconcileProviderTurnCompletion,
} from "./providerTurnIntent.js";

test("casual provider turn completions do not reconcile coordination", () => {
  assert.equal(shouldReconcileProviderTurnCompletion({
    paneId: "workspace-terminal-1",
    providerTurnIntent: "casual_message",
    reconcileCoordination: false,
    type: "provider-turn-completed",
  }), false);
});

test("provider turn completion reconciliation requires explicit opt-in", () => {
  assert.equal(shouldReconcileProviderTurnCompletion({
    paneId: "workspace-terminal-1",
    providerTurnIntent: "coordination_task",
    type: "provider-turn-completed",
  }), false);

  assert.equal(shouldReconcileProviderTurnCompletion({
    paneId: "workspace-terminal-1",
    providerTurnIntent: "coordination_task",
    reconcileCoordination: true,
    type: "provider-turn-completed",
  }), true);
});

test("provider turn completion reconciliation requires a terminal pane", () => {
  assert.equal(shouldReconcileProviderTurnCompletion({
    providerTurnIntent: "coordination_task",
    reconcileCoordination: true,
    type: "provider-turn-completed",
  }), false);
});

test("provider turn intent defaults to casual message", () => {
  assert.equal(getProviderTurnCompletionIntent({}), "casual_message");
  assert.equal(getProviderTurnCompletionIntent({ providerTurnIntent: "  " }), "casual_message");
});
