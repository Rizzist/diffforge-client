import assert from "node:assert/strict";
import test from "node:test";

import {
  terminalCanonicalBadgePresentation,
  terminalCanonicalCohortForInstance,
  terminalCanonicalEventIsStale,
  terminalCanonicalStateFromFields,
  terminalLifecycleSettlementAccepted,
  terminalLifecycleSettlementSideEffectsAllowed,
  terminalCommandPhaseFromLifecycleEvent,
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsSendable,
  terminalAgentUsesActivityHooks,
  terminalActivityStatusNeedsAttention,
  terminalExecutionPhaseFromState,
  shouldSuppressThreadPropThinking,
  workspaceTerminalStatusFromActivityStatus,
  terminalRailStateFromActivityStatus,
  terminalRailBadgePresentation,
  terminalRailStateFromExecutionPhase,
  terminalReadinessFromPresenceStatus,
  terminalTurnStatusFromActivityStatus,
} from "./terminalActivityState.js";

function canonicalCohort(overrides = {}) {
  return {
    instance_id: 8,
    terminal_state_contract_version: 1,
    canonical_state: "idle",
    canonical_badge_label: "idle",
    canonical_state_seq: 12,
    prompt_state_seq: 12,
    turn_active: false,
    turn_generation: 3,
    completed_turn_generation: 3,
    active_interaction_id: null,
    active_interaction_revision: null,
    interaction_actionable: false,
    background_task_counts: undefined,
    background_work_active: undefined,
    ...overrides,
  };
}

test("version-one canonical state and authored badge label bypass legacy projections", () => {
  const fields = {
    terminal_state_contract_version: 1,
    canonical_state: "uir",
    canonical_badge_label: "input required",
    activity_status: "idle",
  };

  assert.equal(terminalCanonicalStateFromFields(fields), "uir");
  assert.deepEqual(terminalCanonicalBadgePresentation(fields), {
    label: "input required",
    state: "uir",
    tone: "attention",
  });
  assert.equal(terminalCanonicalBadgePresentation({ activity_status: "idle" }), null);
  assert.equal(terminalCanonicalStateFromFields({ canonical_state: "uir" }), "");
});

test("canonical cache resets when a pane receives a new terminal instance", () => {
  const previous = {
    instance_id: 7,
    terminal_state_contract_version: 1,
    canonical_state: "uir",
    canonical_badge_label: "input required",
    canonical_state_seq: 20,
    prompt_state_seq: 20,
    turn_active: true,
    turn_generation: 2,
    completed_turn_generation: 1,
    active_interaction_id: "uir:old",
    active_interaction_revision: 20,
    interaction_actionable: true,
  };
  const reset = terminalCanonicalCohortForInstance(previous, {
    instance_id: 8,
    activity_status: "starting",
  });

  assert.deepEqual(reset, {
    terminal_state_contract_version: undefined,
    canonical_state: undefined,
    canonical_badge_label: undefined,
    canonical_state_seq: undefined,
    prompt_state_seq: undefined,
    turn_active: undefined,
    turn_generation: undefined,
    completed_turn_generation: undefined,
    active_interaction_id: undefined,
    active_interaction_revision: undefined,
    interaction_actionable: undefined,
    background_task_counts: undefined,
    background_work_active: undefined,
  });
  assert.equal(terminalCanonicalStateFromFields(reset), "");
});

test("canonical cache rejects a delayed lower sequence atomically", () => {
  const current = canonicalCohort();
  const delayed = canonicalCohort({
    canonical_state: "uir",
    canonical_badge_label: "input required",
    canonical_state_seq: 11,
    prompt_state_seq: 11,
    turn_active: true,
    completed_turn_generation: 2,
    active_interaction_id: "uir:old",
    active_interaction_revision: 11,
    interaction_actionable: true,
  });

  assert.equal(terminalCanonicalEventIsStale(current, delayed), true);
  const expected = canonicalCohort();
  delete expected.instance_id;
  assert.deepEqual(terminalCanonicalCohortForInstance(current, delayed), expected);
});

test("incomplete higher canonical sequence cannot split the existing cohort", () => {
  const current = canonicalCohort({
    canonical_state: "uir",
    canonical_badge_label: "input required",
    active_interaction_id: "uir:current",
    active_interaction_revision: 12,
    interaction_actionable: true,
    turn_active: true,
    completed_turn_generation: 2,
  });
  const merged = terminalCanonicalCohortForInstance(current, {
    instance_id: 8,
    terminal_state_contract_version: 1,
    canonical_state: "idle",
    canonical_state_seq: 13,
  });

  assert.equal(merged.canonical_state, "uir");
  assert.equal(merged.canonical_badge_label, "input required");
  assert.equal(merged.canonical_state_seq, 12);
  assert.equal(merged.active_interaction_id, "uir:current");
  assert.equal(merged.active_interaction_revision, 12);
  assert.equal(merged.interaction_actionable, true);
});

test("explicit undefined fields from a consumer cannot masquerade as a complete cohort", () => {
  const current = canonicalCohort({
    canonical_state: "uir",
    canonical_badge_label: "input required",
    active_interaction_id: "uir:current",
    active_interaction_revision: 12,
    interaction_actionable: true,
    turn_active: true,
    completed_turn_generation: 2,
  });
  const merged = terminalCanonicalCohortForInstance(current, {
    instance_id: 8,
    terminal_state_contract_version: 1,
    canonical_state: "idle",
    canonical_badge_label: undefined,
    canonical_state_seq: 13,
    turn_active: undefined,
    turn_generation: undefined,
    completed_turn_generation: undefined,
    active_interaction_id: undefined,
    active_interaction_revision: undefined,
    interaction_actionable: undefined,
  });

  assert.equal(merged.canonical_state, "uir");
  assert.equal(merged.canonical_badge_label, "input required");
  assert.equal(merged.canonical_state_seq, 12);
  assert.equal(merged.active_interaction_id, "uir:current");
  assert.equal(merged.active_interaction_revision, 12);
  assert.equal(merged.interaction_actionable, true);
});

test("prompt sequence is monotonic and passive frames do not advance it", () => {
  const current = canonicalCohort({ prompt_state_seq: 9 });
  assert.equal(terminalCanonicalEventIsStale(current, {
    instance_id: 8,
    prompt_state_seq: 8,
  }), true);
  assert.equal(
    terminalCanonicalCohortForInstance(current, { instance_id: 8 }).prompt_state_seq,
    9,
  );
});

test("same-instance local lifecycle events override the canonical cache", () => {
  const current = canonicalCohort({
    canonical_state: "thinking",
    canonical_badge_label: "thinking",
    turn_active: true,
    completed_turn_generation: 2,
  });
  for (const type of ["closing", "closed", "error"]) {
    const cleared = terminalCanonicalCohortForInstance(current, {
      instance_id: 8,
      type,
    });
    assert.equal(terminalCanonicalStateFromFields(cleared), "");
    assert.equal(cleared.canonical_state_seq, 12);
    assert.equal(cleared.active_interaction_id, undefined);
    assert.equal(cleared.prompt_state_seq, 12);
    assert.equal(terminalCanonicalEventIsStale(cleared, canonicalCohort({
      canonical_state_seq: 11,
      prompt_state_seq: 11,
    })), true);
  }
});

test("process epoch resets instance allocation while same-process retired instances stay stale", () => {
  const retained = canonicalCohort({
    instance_id: 8,
    terminal_process_epoch: "00000000000000000100-process-a",
    canonical_state: "closed",
    canonical_badge_label: "closed",
    canonical_state_seq: 90,
    prompt_state_seq: 90,
  });
  const restarted = canonicalCohort({
    instance_id: 1,
    terminal_process_epoch: "00000000000000000200-process-b",
    canonical_state: "starting",
    canonical_badge_label: "starting",
    canonical_state_seq: 1,
    prompt_state_seq: 0,
    turn_generation: 0,
    completed_turn_generation: 0,
  });
  assert.equal(terminalCanonicalEventIsStale(retained, restarted), false);
  assert.equal(terminalCanonicalCohortForInstance(retained, restarted).canonical_state, "starting");
  assert.equal(
    terminalCanonicalEventIsStale(restarted, retained),
    true,
    "a delayed prior-process frame cannot roll the renderer back after restart",
  );

  const current = canonicalCohort({
    instance_id: 8,
    terminal_process_epoch: "00000000000000000200-process-b",
  });
  const delayed = canonicalCohort({
    instance_id: 7,
    terminal_process_epoch: "00000000000000000200-process-b",
    canonical_state_seq: 99,
    prompt_state_seq: 99,
  });
  assert.equal(terminalCanonicalEventIsStale(current, delayed), true);
});

test("app-wide lifecycle side effects reject an unaccepted old-generation completion", () => {
  const rejectedCompletion = {
    event_type: "provider-turn-completed",
    turn_settlement_accepted: false,
    ...canonicalCohort({
      canonical_state: "uir",
      canonical_badge_label: "input required",
      turn_active: true,
      active_interaction_id: "uir:b",
      active_interaction_revision: 2,
      interaction_actionable: true,
    }),
  };
  assert.equal(terminalLifecycleSettlementAccepted(rejectedCompletion), false);
  assert.equal(terminalLifecycleSettlementSideEffectsAllowed(rejectedCompletion), false);
  assert.equal(terminalLifecycleSettlementAccepted({
    event_type: "provider-turn-completed",
    turn_settlement_accepted: true,
    ...canonicalCohort(),
  }), true);
  assert.equal(terminalLifecycleSettlementAccepted({
    event_type: "provider-turn-completed",
  }), true, "legacy accepted completions remain compatible");
  const rejectedInterrupt = {
    event_type: "provider-turn-interrupted",
    turn_settlement_accepted: false,
    ...canonicalCohort({
      canonical_state: "uir",
      canonical_badge_label: "input required",
      turn_active: true,
      active_interaction_id: "uir:b",
      active_interaction_revision: 2,
      interaction_actionable: true,
    }),
  };
  assert.equal(terminalLifecycleSettlementAccepted(rejectedInterrupt), false);
  assert.equal(
    terminalLifecycleSettlementSideEffectsAllowed(rejectedInterrupt),
    false,
    "rejected stale interrupts cannot trigger settlement side effects either",
  );
});

test("held-waiting stop never counts as an accepted completion", () => {
  // WAITING regression: a rejected Stop held while the harness still owns
  // background work is a completion-SHAPED frame the reducer refused to
  // settle (turn stays open). Completing todos / deleting in-flight prompts
  // on it is the exact false-completion class WAITING exists to prevent.
  const heldStop = {
    event_type: "provider-turn-completed",
    turn_settlement_accepted: false,
    ...canonicalCohort({
      canonical_state: "waiting",
      canonical_badge_label: "waiting",
      turn_active: true,
    }),
  };
  assert.equal(terminalLifecycleSettlementAccepted(heldStop), false);
  assert.equal(terminalLifecycleSettlementSideEffectsAllowed(heldStop), false);
  // Even without the explicit boolean, the waiting canonical state (turn
  // still open) refuses completion settlement.
  const heldStopLegacy = {
    event_type: "provider-turn-completed",
    ...canonicalCohort({
      canonical_state: "waiting",
      canonical_badge_label: "waiting",
      turn_active: true,
    }),
  };
  assert.equal(terminalLifecycleSettlementAccepted(heldStopLegacy), false);
  // The true final Stop settles normally.
  assert.equal(terminalLifecycleSettlementAccepted({
    event_type: "provider-turn-completed",
    turn_settlement_accepted: true,
    ...canonicalCohort(),
  }), true);
  // Errors are terminal and keep settling regardless of the gate.
  assert.equal(terminalLifecycleSettlementAccepted({
    event_type: "provider-turn-error",
    turn_settlement_accepted: false,
  }), true);
});

test("retired instance tombstone rejects rollback while a newer epoch resets sequences", () => {
  const current = canonicalCohort({ instance_id: 8 });
  const retired = canonicalCohort({
    instance_id: 7,
    canonical_state: "uir",
    canonical_state_seq: 99,
    prompt_state_seq: 99,
  });
  assert.equal(terminalCanonicalEventIsStale(current, retired), true);
  assert.equal(
    terminalCanonicalCohortForInstance(current, retired).canonical_state,
    "idle",
  );

  const next = canonicalCohort({
    instance_id: 9,
    canonical_state: "thinking",
    canonical_badge_label: "thinking",
    canonical_state_seq: 1,
    prompt_state_seq: 0,
    turn_active: true,
    turn_generation: 1,
    completed_turn_generation: 0,
  });
  assert.equal(terminalCanonicalEventIsStale(current, next), false);
  const reset = terminalCanonicalCohortForInstance(current, next);
  assert.equal(reset.canonical_state, "thinking");
  assert.equal(reset.canonical_state_seq, 1);
  assert.equal(reset.prompt_state_seq, 0);
});

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

test("user-input-required aliases map to a distinct attention rail and badge", () => {
  for (const status of ["awaiting_input", "needs_input", "user_input_required", "uir"]) {
    assert.equal(terminalActivityStatusNeedsAttention(status), true);
    assert.equal(terminalReadinessFromPresenceStatus(status), "needs_input");
    assert.equal(terminalExecutionPhaseFromState({
      activity_status: status,
      readiness: "needs_input",
    }), "awaiting_input");
    assert.equal(terminalExecutionPhaseFromState({
      command_phase: status,
      readiness: "ready",
    }), "awaiting_input");
    assert.equal(terminalRailStateFromExecutionPhase(status), "awaiting_input");
    assert.deepEqual(terminalRailBadgePresentation(status), {
      label: "Input required",
      state: "awaiting_input",
      tone: "attention",
    });
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
  }), "awaiting_input");
});

test("a parked terminal without a user prompt stays paused", () => {
  assert.equal(workspaceTerminalStatusFromActivityStatus("paused", {
    terminal_lifecycle: "open",
    terminal_is_parked: true,
    terminal_is_prompting_user: false,
  }), "paused");
  assert.equal(terminalExecutionPhaseFromState({
    activity_status: "parked",
    readiness: terminalReadinessFromPresenceStatus("parked"),
  }), "paused");
  assert.equal(terminalRailStateFromExecutionPhase("parked"), "paused");
  assert.deepEqual(terminalRailBadgePresentation("paused"), {
    label: "paused",
    state: "paused",
    tone: "neutral",
  });
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
