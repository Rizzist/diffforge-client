import assert from "node:assert/strict";
import test from "node:test";

import {
  terminalCommandPhaseFromLifecycleEvent,
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsSendable,
  terminalAgentUsesActivityHooks,
  terminalExecutionPhaseFromState,
  shouldSuppressThreadPropThinking,
  workspaceTerminalStatusFromActivityStatus,
  terminalRailStateFromActivityStatus,
  terminalRailStateFromExecutionPhase,
  terminalReadinessFromPresenceStatus,
  terminalTurnStatusFromActivityStatus,
} from "./terminalActivityState.js";

test("hook-managed terminal agent ids are normalized in one helper", () => {
  assert.equal(terminalAgentUsesActivityHooks("codex"), true);
  assert.equal(terminalAgentUsesActivityHooks("claude"), true);
  assert.equal(terminalAgentUsesActivityHooks(" Claude "), true);
  assert.equal(terminalAgentUsesActivityHooks("opencode"), true);
  assert.equal(terminalAgentUsesActivityHooks(" OpenCode "), true);
  assert.equal(terminalAgentUsesActivityHooks("code x"), false);
  assert.equal(terminalAgentUsesActivityHooks("generic"), false);
});

test("stale thread prop thinking cannot revive a terminal after newer lifecycle input-ready", () => {
  assert.equal(shouldSuppressThreadPropThinking({
    latestTurn: {
      state: "running",
      startedAt: "2026-05-31T10:00:00.000Z",
    },
    lastReadyAtMs: Date.parse("2026-05-31T10:00:04.000Z"),
    nextStatus: "thinking",
    previousStatus: "idle",
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
    source: "thread_prop_status_sync",
    submittedPrompt: {
      threadId: "thread-1",
    },
    threadId: "thread-1",
  }), false);
});

test("visible terminal presence follows activity status instead of running turn state", () => {
  assert.equal(terminalRailStateFromActivityStatus("idle"), "idle");
  assert.equal(workspaceTerminalStatusFromActivityStatus("idle", {
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
  assert.equal(workspaceTerminalStatusFromActivityStatus("thinking", {
    terminalLifecycle: "open",
  }), "thinking");
  assert.equal(terminalReadinessFromPresenceStatus("thinking"), "busy");
  assert.equal(terminalTurnStatusFromActivityStatus("thinking"), "running");
  assert.equal(terminalRailStateFromActivityStatus("tool_running"), "tool_running");
  assert.equal(terminalActivityStatusIsBusy("tool_running"), true);
  assert.equal(terminalActivityStatusIsSendable("tool_running"), false);
  assert.equal(terminalReadinessFromPresenceStatus("subagent_running"), "busy");
});

test("queue sendability is driven by idle activity status only", () => {
  assert.equal(terminalActivityStatusIsSendable("idle"), true);
  assert.equal(terminalActivityStatusIsSendable("input_ready"), true);
  assert.equal(terminalActivityStatusIsSendable("cancelled"), true);
  assert.equal(terminalActivityStatusIsSendable("canceled"), true);
  assert.equal(terminalActivityStatusIsSendable("interrupted"), true);
  assert.equal(terminalActivityStatusIsSendable("prompt_ready"), false);
  assert.equal(terminalActivityStatusIsSendable("active"), false);
  assert.equal(terminalActivityStatusIsSendable("thinking"), false);
});

test("closed lifecycle wins over idle activity for terminal presence", () => {
  assert.equal(workspaceTerminalStatusFromActivityStatus("idle", {
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

  assert.equal(commandPhase, "interrupted");
  assert.equal(executionPhase, "interrupted");
  assert.equal(terminalRailStateFromExecutionPhase(executionPhase), "interrupted");
  assert.equal(terminalTurnStatusFromActivityStatus("interrupted"), "interrupted");
});
