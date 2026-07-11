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
    latest_turn: {
      state: "running",
      started_at: "2026-05-31T10:00:00.000Z",
    },
    lastReadyAtMs: Date.parse("2026-05-31T10:00:04.000Z"),
    nextStatus: "thinking",
    previousStatus: "idle",
    source: "thread_prop_status_sync",
    thread_id: "thread-1",
  }), true);
});

test("fresh submitted prompts are allowed to move a terminal into thinking", () => {
  assert.equal(shouldSuppressThreadPropThinking({
    latest_turn: {
      state: "running",
      started_at: "2026-05-31T10:00:05.000Z",
    },
    lastReadyAtMs: Date.parse("2026-05-31T10:00:04.000Z"),
    nextStatus: "thinking",
    previousStatus: "idle",
    source: "thread_prop_status_sync",
    submittedPrompt: {
      thread_id: "thread-1",
    },
    thread_id: "thread-1",
  }), false);
});

test("visible terminal presence follows activity status instead of running turn state", () => {
  assert.equal(terminalRailStateFromActivityStatus("idle"), "idle");
  assert.equal(workspaceTerminalStatusFromActivityStatus("idle", {
    fallbackStatus: "thinking",
    terminal_lifecycle: "open",
  }), "idle");
  assert.equal(terminalReadinessFromPresenceStatus("idle"), "ready");
  assert.equal(terminalTurnStatusFromActivityStatus("idle"), "completed");
});

test("user-input-required aliases map to the paused needs-input bucket", () => {
  for (const status of ["awaiting_input", "user_input_required", "uir"]) {
    assert.equal(terminalReadinessFromPresenceStatus(status), "needs_input");
    assert.equal(terminalExecutionPhaseFromState({
      activity_status: status,
      readiness: "needs_input",
    }), "needs_input");
    assert.equal(terminalRailStateFromExecutionPhase(status), "paused");
    assert.equal(terminalTurnStatusFromActivityStatus(status), "pending");
  }
  assert.equal(workspaceTerminalStatusFromActivityStatus("idle", {
    terminal_lifecycle: "open",
    terminal_is_prompting_user: true,
  }), "awaiting_input");
  assert.equal(workspaceTerminalStatusFromActivityStatus("awaiting_input", {
    terminal_lifecycle: "open",
    terminal_is_parked: true,
    terminal_is_prompting_user: true,
  }), "paused");
});

test("visible terminal rail preserves exact activity status", () => {
  assert.equal(terminalRailStateFromActivityStatus("running"), "running");
  assert.equal(terminalActivityStatusIsBusy("running"), true);
  assert.equal(terminalActivityStatusIsSendable("running"), false);
  assert.equal(workspaceTerminalStatusFromActivityStatus("thinking", {
    terminal_lifecycle: "open",
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
    terminal_lifecycle: "closed",
  }), "closed");
  assert.equal(terminalReadinessFromPresenceStatus("closed"), "closed");
  assert.equal(terminalTurnStatusFromActivityStatus("closed"), "interrupted");
});

test("canonical execution phase maps queue and run events to thinking rail", () => {
  const commandPhase = terminalCommandPhaseFromLifecycleEvent("remote-command-queued");
  const executionPhase = terminalExecutionPhaseFromState({
    command_phase: commandPhase,
    event_type: "remote-command-queued",
    readiness: "busy",
    turn_status: "queued",
  });

  assert.equal(commandPhase, "queued");
  assert.equal(executionPhase, "queued");
  assert.equal(terminalRailStateFromExecutionPhase(executionPhase), "thinking");
});

test("canonical execution phase clears stale thinking after interruption", () => {
  const commandPhase = terminalCommandPhaseFromLifecycleEvent("provider-turn-interrupted");
  const executionPhase = terminalExecutionPhaseFromState({
    activity_status: "thinking",
    command_phase: commandPhase,
    event_type: "provider-turn-interrupted",
    readiness: "ready",
    turn_status: "interrupted",
  });

  assert.equal(commandPhase, "interrupted");
  assert.equal(executionPhase, "interrupted");
  assert.equal(terminalRailStateFromExecutionPhase(executionPhase), "interrupted");
  assert.equal(terminalTurnStatusFromActivityStatus("interrupted"), "interrupted");
});
