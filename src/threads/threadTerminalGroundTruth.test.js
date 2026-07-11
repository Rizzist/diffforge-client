import assert from "node:assert/strict";
import test from "node:test";

import {
  getThreadTerminalGroundTruth,
  terminalPromptingUserBlocksShutdown,
} from "./threadTerminalGroundTruth.js";

test("null terminal prompt sources are treated as idle", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: null,
    providerBinding: null,
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        state: "completed",
      },
      message_count: 0,
      messages: [],
      projection_events: [],
    },
  });

  assert.equal(groundTruth.terminal_is_prompting_user, false);
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
});

test("stale thread thinking cannot make a Rust-idle completed turn working", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "idle",
      input_ready: false,
      status: "active",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: false,
      status: "active",
    },
    target_role: "codex",
    thread: {
      activity_status: "thinking",
      latest_turn: {
        state: "completed",
      },
      message_count: 1,
      messages: [{ role: "user", text: "summarize the repo" }],
      projection_events: [{ type: "thread.message.user" }],
    },
  });

  assert.equal(groundTruth.completedTurnLooksStaleActive, false);
  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminal_work_state, "complete");
  assert.equal(groundTruth.terminal_is_complete, true);
  assert.equal(groundTruth.agentInputReady, true);
});

test("Rust thinking status keeps a stale completed turn working", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "thinking",
      input_ready: false,
      status: "active",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: false,
      status: "active",
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        state: "completed",
      },
      message_count: 1,
      messages: [{ role: "user", text: "summarize the repo" }],
      projection_events: [{ type: "thread.message.user" }],
    },
  });

  assert.equal(groundTruth.completedTurnLooksStaleActive, true);
  assert.equal(groundTruth.effectiveActivityStatus, "thinking");
  assert.equal(groundTruth.effectiveLatestTurnState, "running");
  assert.equal(groundTruth.terminal_work_state, "running");
  assert.equal(groundTruth.terminal_is_complete, false);
  assert.equal(groundTruth.agentInputReady, false);
});

test("fresh lifecycle input-ready still completes a completed turn", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      input_ready: true,
      input_ready_at: "2026-05-30T10:01:00.000Z",
      status: "active",
    },
    providerBinding: {
      input_ready: true,
      input_ready_at: "2026-05-30T10:01:00.000Z",
      status: "active",
    },
    target_role: "codex",
    thread: {
      activity_status: "thinking",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "completed",
      },
      message_count: 1,
      messages: [{ role: "user", text: "summarize the repo" }],
      projection_events: [{ type: "thread.message.user" }],
    },
  });

  assert.equal(groundTruth.completedTurnLooksStaleActive, false);
  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminal_work_state, "complete");
  assert.equal(groundTruth.terminal_is_complete, true);
});

test("idle terminal activity is sendable when lifecycle input-ready is fresh", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "idle",
      input_ready: true,
      input_ready_at: "2026-05-30T10:01:00.000Z",
      status: "idle",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: true,
      input_ready_at: "2026-05-30T10:01:00.000Z",
      status: "idle",
    },
    target_role: "codex",
    thread: {
      activity_status: "thinking",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "completed",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "summarize the repo" },
        { role: "assistant", text: "Done." },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.terminalLooksSendable, true);
  assert.equal(groundTruth.completedTurnLooksSendable, true);
  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.terminal_work_state, "complete");
});

test("live idle activity is sendable even when explicit inputReady was not persisted", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "idle",
      input_ready: false,
      status: "idle",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: false,
      status: "idle",
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        state: "completed",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "summarize the repo" },
        { role: "assistant", text: "Done." },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.activityStatusLooksInputReady, true);
  assert.equal(groundTruth.completedTurnLooksSendable, true);
  assert.equal(groundTruth.agentInputReady, true);
});

test("idle assistant follow-up questions do not block shutdown", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "idle",
      input_ready: true,
      status: "idle",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: true,
      status: "idle",
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        state: "completed",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "Hi. What would you like me to work on next?" },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.terminal_is_prompting_user, false);
  assert.equal(groundTruth.prompting_user_source, "");
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
});

test("live terminal permission prompts still block shutdown", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    lifecycleEvent: {
      prompting_user_kind: "permission",
      prompting_user_source: "provider-permission",
      prompting_user_text: "Allow command to run?",
      terminal_is_prompting_user: true,
      tool_use_id: "tool-1",
      type: "terminal-output",
    },
    liveTerminal: {
      activity_status: "idle",
      input_ready: true,
      status: "idle",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: true,
      status: "idle",
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        state: "completed",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "run the risky command" },
        { role: "assistant", text: "I need permission." },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.terminal_is_prompting_user, true);
  assert.equal(groundTruth.prompting_user_source, "provider-permission");
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), true);
});

test("terminal output permission-looking text does not create needs-input state", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    lifecycleEvent: {
      prompting_user_kind: "permission",
      prompting_user_source: "terminal-output",
      prompting_user_text: "Allow command to run?",
      terminal_is_prompting_user: true,
      type: "terminal-output",
    },
    liveTerminal: {
      activity_status: "idle",
      input_ready: true,
      status: "idle",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: true,
      status: "idle",
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        state: "completed",
      },
      message_count: 0,
      messages: [],
      projection_events: [],
    },
  });

  assert.equal(groundTruth.terminal_is_prompting_user, false);
  assert.equal(groundTruth.prompting_user_kind, "");
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
});

test("provider lifecycle clears stale terminal prompt signals", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    lifecycleEvent: {
      output_text: "Allow command to run?",
      source: "cli-hook:provider-turn-completed",
      type: "provider-turn-completed",
    },
    liveTerminal: {
      activity_status: "idle",
      input_ready: true,
      prompting_user_kind: "permission",
      prompting_user_source: "terminal-output",
      prompting_user_text: "Allow command to run?",
      status: "idle",
      terminal_is_prompting_user: true,
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: true,
      prompting_user_kind: "permission",
      prompting_user_source: "terminal-output",
      prompting_user_text: "Allow command to run?",
      status: "idle",
      terminal_is_prompting_user: true,
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        state: "completed",
      },
      message_count: 0,
      messages: [],
      projection_events: [],
    },
  });

  assert.equal(groundTruth.terminal_is_prompting_user, false);
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
  assert.equal(groundTruth.terminal_work_state, "complete");
});

test("fresh lifecycle input-ready settles a restored running turn", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "idle",
      input_ready: true,
      input_ready_at: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: true,
      input_ready_at: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    target_role: "codex",
    thread: {
      activity_status: "thinking",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "make a pricing.html" },
        { role: "assistant", text: "I'll add it now." },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.delta" },
      ],
    },
  });

  assert.equal(groundTruth.runningTurnLooksIdle, true);
  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminalGroundTruthStatus, "idle_or_input_ready");
  assert.equal(groundTruth.terminal_work_state, "complete");
  assert.equal(groundTruth.terminal_is_complete, true);
});

test("idle hook-managed runtime settles a restored running turn without input-ready", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "idle",
      agent_id: "codex",
      input_ready: false,
      status: "active",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: false,
      native_session_id: "codex-session-1",
      status: "active",
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "audit the project" },
        { role: "assistant", text: "Done." },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
      provider_bindings: {
        codex: {
          activity_status: "idle",
          native_session_id: "codex-session-1",
        },
      },
      transcript_session_id: "codex-session-1",
    },
  });

  assert.equal(groundTruth.restoredRunningTurnLooksIdle, true);
  assert.equal(groundTruth.runningTurnLooksIdle, true);
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminalGroundTruthStatus, "idle_or_input_ready");
  assert.equal(groundTruth.completedTurnLooksSendable, true);
  assert.equal(groundTruth.agentInputReady, true);
  assert.equal(groundTruth.terminal_work_state, "complete");
});

test("stale hook-managed running turn without Rust runtime is not working", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: null,
    providerBinding: {
      activity_status: "thinking",
      native_session_id: "claude-session-1",
      status: "active",
    },
    target_role: "claude",
    thread: {
      activity_status: "thinking",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "tell me about claude" },
        { role: "assistant", text: "Great! What do you want to build or fix?" },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
      provider_bindings: {
        claude: {
          activity_status: "thinking",
          native_session_id: "claude-session-1",
        },
      },
      transcript_session_id: "claude-session-1",
    },
  });

  assert.equal(groundTruth.staleRunningWithoutLiveRuntimeLooksIdle, true);
  assert.equal(groundTruth.runningTurnLooksIdle, true);
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminalGroundTruthStatus, "idle_or_input_ready");
  assert.equal(groundTruth.terminal_work_state, "complete");
  assert.equal(groundTruth.terminal_is_complete, true);
});

test("idle non-hook runtime does not settle a restored running turn", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activity_status: "idle",
      agent_id: "opencode",
      input_ready: false,
      status: "active",
    },
    providerBinding: {
      activity_status: "idle",
      input_ready: false,
      status: "active",
    },
    target_role: "opencode",
    thread: {
      activity_status: "idle",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "audit the project" },
        { role: "assistant", text: "Done." },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.restoredRunningTurnLooksIdle, false);
  assert.equal(groundTruth.runningTurnLooksIdle, false);
  assert.equal(groundTruth.effectiveLatestTurnState, "running");
  assert.equal(groundTruth.terminalGroundTruthStatus, "processing_or_active");
  assert.equal(groundTruth.agentInputReady, false);
});

test("pending session acceptance keeps a running turn active despite lifecycle input-ready", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      input_ready: true,
      input_ready_at: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    providerBinding: {
      input_ready: true,
      input_ready_at: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    target_role: "codex",
    thread: {
      activity_status: "thinking",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      message_count: 0,
      messages: [],
      pending_prompt: {
        id: "prompt-test",
        text: "summarize recent commits",
      },
      projection_events: [{ type: "thread.turn.started" }],
    },
  });

  assert.equal(groundTruth.promptSubmissionPending, true);
  assert.equal(groundTruth.runningTurnLooksIdle, false);
  assert.equal(groundTruth.agentInputReady, false);
  assert.equal(groundTruth.terminalGroundTruthStatus, "processing_or_active");
  assert.equal(groundTruth.terminal_work_state, "running");
});

test("hook-managed live active terminal without hook readiness stays starting", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      input_ready: false,
      status: "active",
    },
    providerBinding: {
      input_ready: false,
      status: "active",
    },
    target_role: "codex",
    thread: {
      activity_status: "idle",
      latest_turn: {
        started_at: "2026-05-30T10:00:00.000Z",
        state: "completed",
      },
      message_count: 2,
      messages: [
        { role: "user", text: "make a pricing.html" },
        { role: "assistant", text: "I am still working on it." },
      ],
      projection_events: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.rawLiveActivityStatus, "idle");
  assert.equal(groundTruth.hookManagedImplicitStartup, true);
  assert.equal(groundTruth.effectiveActivityStatus, "starting");
  assert.equal(groundTruth.effectiveLatestTurnState, "running");
  assert.equal(groundTruth.completedTurnLooksSendable, false);
  assert.equal(groundTruth.agentInputReady, false);
  assert.equal(groundTruth.terminal_work_state, "running");
});
