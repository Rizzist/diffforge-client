import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTerminalReadinessEpochKey,
  isReadyLifecycleEmittedForEpoch,
  shouldEmitPromptReadyLifecycle,
  shouldSuppressThreadPropThinking,
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
