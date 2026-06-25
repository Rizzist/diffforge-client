import assert from "node:assert/strict";
import test from "node:test";

import {
  appControlMessageHasExplicitTerminalTarget,
  getLoopspaceAutomationAutoSpawnMaxTotal,
  isLoopspaceAutomationAppControlMessage,
  selectLoopspaceAutomationAppControlTerminal,
} from "./appControlOrchestratorRouting.js";

test("loopspace automation detection reads runtime fields and event payload aliases", () => {
  assert.equal(isLoopspaceAutomationAppControlMessage({
    event: {
      payload: {
        source_kind: "loopspace_runtime",
      },
    },
  }), true);
  assert.equal(isLoopspaceAutomationAppControlMessage({
    loopRuntimeRunId: "run-1",
  }), true);
  assert.equal(isLoopspaceAutomationAppControlMessage({
    commandKind: "terminal_orchestrator_send_message",
    source: "remote-control",
  }), false);
});

test("explicit terminal targets include id, index, name, and thread selectors", () => {
  assert.equal(appControlMessageHasExplicitTerminalTarget({ targetTerminalId: "pane-1" }), true);
  assert.equal(appControlMessageHasExplicitTerminalTarget({ targetTerminalIndex: 0 }), true);
  assert.equal(appControlMessageHasExplicitTerminalTarget({ targetTerminalName: "terminal 2" }), true);
  assert.equal(appControlMessageHasExplicitTerminalTarget({ targetThreadId: "thread-1" }), true);
  assert.equal(appControlMessageHasExplicitTerminalTarget({ targetTerminalId: "", targetTerminalName: "" }), false);
});

test("loopspace automation reuses one idle orchestrator terminal without spawning", () => {
  const result = selectLoopspaceAutomationAppControlTerminal({
    indexes: [0],
    isTerminalBusy: () => false,
    rolesByIndex: { 0: "claude" },
    targetRole: "claude",
  });

  assert.equal(result.terminalIndex, 0);
  assert.equal(result.autoSpawned, false);
  assert.equal(result.reason, "idle_role_match");
});

test("loopspace automation spawns a second orchestrator terminal when the only one is busy", () => {
  const result = selectLoopspaceAutomationAppControlTerminal({
    indexes: [0],
    isTerminalBusy: (index) => index === 0,
    rolesByIndex: { 0: "claude" },
    targetRole: "claude",
  });

  assert.equal(result.terminalIndex, 1);
  assert.equal(result.autoSpawned, true);
  assert.equal(result.orchestratorPoolSize, 2);
});

test("loopspace automation can spawn a third orchestrator terminal when two are busy", () => {
  const result = selectLoopspaceAutomationAppControlTerminal({
    indexes: [0, 1],
    isTerminalBusy: () => true,
    rolesByIndex: { 0: "claude", 1: "claude" },
    targetRole: "claude",
  });

  assert.equal(result.terminalIndex, 2);
  assert.equal(result.autoSpawned, true);
  assert.equal(result.orchestratorPoolSize, 3);
});

test("loopspace automation queues behind the least loaded orchestrator at the auto-spawn cap", () => {
  const result = selectLoopspaceAutomationAppControlTerminal({
    getQueueDepth: (index) => ({ 0: 3, 1: 1, 2: 2 })[index] || 0,
    indexes: [0, 1, 2],
    isTerminalBusy: () => true,
    rolesByIndex: { 0: "claude", 1: "claude", 2: "claude" },
    targetRole: "claude",
  });

  assert.equal(result.terminalIndex, 1);
  assert.equal(result.autoSpawned, false);
  assert.equal(result.reason, "least_loaded_queue");
  assert.equal(result.shouldQueue, true);
});

test("loopspace automation honors lower max-total dispatch hints", () => {
  assert.equal(getLoopspaceAutomationAutoSpawnMaxTotal({
    orchestrator_auto_spawn_max_additional: 1,
  }), 2);

  const result = selectLoopspaceAutomationAppControlTerminal({
    indexes: [0, 1],
    isTerminalBusy: () => true,
    maxAutoTerminalCount: 2,
  });

  assert.equal(result.autoSpawned, false);
  assert.equal(result.reason, "least_loaded_queue");
});
