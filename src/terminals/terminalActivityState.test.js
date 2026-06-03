import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTerminalReadinessEpochKey,
  getPromptReadyLifecycleDeferral,
  isReadyLifecycleEmittedForEpoch,
  terminalCommandPhaseFromLifecycleEvent,
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsSendable,
  terminalExecutionPhaseFromState,
  shouldEmitPromptReadyLifecycle,
  shouldSuppressThreadPropThinking,
  terminalPresenceStatusFromActivityStatus,
  terminalRailStateFromActivityStatus,
  terminalRailStateFromExecutionPhase,
  terminalReadinessFromPresenceStatus,
  terminalTurnStatusFromActivityStatus,
} from "./terminalActivityState.js";

test("prompt-ready backend output is accepted on cold startup", () => {
  assert.equal(shouldEmitPromptReadyLifecycle({
    isGenericTerminal: false,
    looksActive: false,
    looksReady: true,
    readyLifecycleEmitted: false,
    threadId: "thread-1",
  }), true);
});

test("prompt-ready backend output is not emitted twice", () => {
  const currentReadyEpoch = buildTerminalReadinessEpochKey({
    instanceId: 1,
    paneId: "pane-1",
    threadId: "thread-1",
  });

  assert.equal(shouldEmitPromptReadyLifecycle({
    currentReadyEpoch,
    isGenericTerminal: false,
    looksActive: false,
    looksReady: true,
    readyLifecycleEmitted: true,
    readyLifecycleEpoch: currentReadyEpoch,
    threadId: "thread-1",
  }), false);
});

test("prompt-ready backend output is emitted again for a restarted terminal epoch", () => {
  const previousReadyEpoch = buildTerminalReadinessEpochKey({
    instanceId: 1,
    paneId: "pane-1",
    threadId: "thread-1",
  });
  const restartedReadyEpoch = buildTerminalReadinessEpochKey({
    instanceId: 2,
    paneId: "pane-1",
    threadId: "thread-1",
  });

  assert.equal(isReadyLifecycleEmittedForEpoch({
    currentEpoch: restartedReadyEpoch,
    readyLifecycleEmitted: true,
    readyLifecycleEpoch: previousReadyEpoch,
  }), false);
  assert.equal(shouldEmitPromptReadyLifecycle({
    currentReadyEpoch: restartedReadyEpoch,
    isGenericTerminal: false,
    looksActive: false,
    looksReady: true,
    readyLifecycleEmitted: true,
    readyLifecycleEpoch: previousReadyEpoch,
    threadId: "thread-1",
  }), true);
});

test("prompt-ready backend output is deferred while the owning turn is running", () => {
  assert.deepEqual(getPromptReadyLifecycleDeferral({
    latestTurn: {
      state: "running",
    },
    source: "backend-terminal-output-prompt-ready",
    threadId: "thread-1",
  }), {
    latestTurnState: "running",
    pendingPromptPresent: false,
    reason: "running_turn_still_active",
    source: "backend-terminal-output-prompt-ready",
  });
});

test("prompt-ready backend output is not deferred after the owning turn completes", () => {
  assert.equal(getPromptReadyLifecycleDeferral({
    latestTurn: {
      state: "completed",
    },
    source: "backend-terminal-output-prompt-ready",
    threadId: "thread-1",
  }), null);
});

test("stale thread prop thinking cannot revive a terminal after newer readiness", () => {
  assert.equal(shouldSuppressThreadPropThinking({
    latestTurn: {
      state: "running",
      startedAt: "2026-05-31T10:00:00.000Z",
    },
    lastReadyAtMs: Date.parse("2026-05-31T10:00:04.000Z"),
    nextStatus: "thinking",
    previousStatus: "idle",
    readyLifecycleEmitted: true,
    source: "thread_prop_status_sync",
    threadId: "thread-1",
  }), true);
});

test("fresh submitted prompts are allowed to move a terminal into thinking", () => {
  assert.equal(shouldSuppressThreadPropThinking({
    latestTurn: {
      state: "running",
      startedAt: "2026-05-31T10:00:05.000Z",
    },
    lastReadyAtMs: Date.parse("2026-05-31T10:00:04.000Z"),
    nextStatus: "thinking",
    previousStatus: "idle",
    readyLifecycleEmitted: true,
    source: "thread_prop_status_sync",
    submittedPrompt: {
      threadId: "thread-1",
    },
    threadId: "thread-1",
  }), false);
});

test("visible terminal presence follows activity status instead of running turn state", () => {
  assert.equal(terminalRailStateFromActivityStatus("idle"), "idle");
  assert.equal(terminalPresenceStatusFromActivityStatus("idle", {
    fallbackStatus: "thinking",
    terminalLifecycle: "open",
  }), "idle");
  assert.equal(terminalReadinessFromPresenceStatus("idle"), "ready");
  assert.equal(terminalTurnStatusFromActivityStatus("idle"), "completed");
});

test("visible terminal rail preserves exact activity status", () => {
  assert.equal(terminalRailStateFromActivityStatus("running"), "running");
  assert.equal(terminalActivityStatusIsBusy("running"), true);
  assert.equal(terminalActivityStatusIsSendable("running"), false);
  assert.equal(terminalPresenceStatusFromActivityStatus("thinking", {
    terminalLifecycle: "open",
  }), "thinking");
  assert.equal(terminalReadinessFromPresenceStatus("thinking"), "busy");
  assert.equal(terminalTurnStatusFromActivityStatus("thinking"), "running");
});

test("queue sendability is driven by idle activity status only", () => {
  assert.equal(terminalActivityStatusIsSendable("idle"), true);
  assert.equal(terminalActivityStatusIsSendable("prompt_ready"), true);
  assert.equal(terminalActivityStatusIsSendable("input_ready"), true);
  assert.equal(terminalActivityStatusIsSendable("active"), false);
  assert.equal(terminalActivityStatusIsSendable("thinking"), false);
});

test("closed lifecycle wins over idle activity for terminal presence", () => {
  assert.equal(terminalPresenceStatusFromActivityStatus("idle", {
    terminalLifecycle: "closed",
  }), "closed");
  assert.equal(terminalReadinessFromPresenceStatus("closed"), "closed");
  assert.equal(terminalTurnStatusFromActivityStatus("closed"), "interrupted");
});

test("canonical execution phase maps queue and run events to thinking rail", () => {
  const commandPhase = terminalCommandPhaseFromLifecycleEvent("remote-command-queued");
  const executionPhase = terminalExecutionPhaseFromState({
    commandPhase,
    eventType: "remote-command-queued",
    readiness: "busy",
    turnStatus: "queued",
  });

  assert.equal(commandPhase, "queued");
  assert.equal(executionPhase, "queued");
  assert.equal(terminalRailStateFromExecutionPhase(executionPhase), "thinking");
});

test("canonical execution phase clears stale thinking after interruption", () => {
  const commandPhase = terminalCommandPhaseFromLifecycleEvent("provider-turn-interrupted");
  const executionPhase = terminalExecutionPhaseFromState({
    activityStatus: "thinking",
    commandPhase,
    eventType: "provider-turn-interrupted",
    readiness: "ready",
    turnStatus: "interrupted",
  });

  assert.equal(commandPhase, "cancelled");
  assert.equal(executionPhase, "interrupted");
  assert.equal(terminalRailStateFromExecutionPhase(executionPhase), "idle");
});
