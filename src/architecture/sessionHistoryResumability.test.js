import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAUDE_RESUME_UNAVAILABLE_MESSAGE,
  getSessionHistoryResumeAvailability,
  invalidateClaudeSessionHistoryResumability,
} from "./sessionHistoryResumability.js";

test("remote-only Claude history rows do not offer Open", () => {
  assert.deepEqual(
    getSessionHistoryResumeAvailability(
      { agent_id: "claude", resumable: false },
      "8b11443c-1111-4222-8333-123456789abc",
    ),
    {
      canOpen: false,
      label: "Not on this device",
      reason: CLAUDE_RESUME_UNAVAILABLE_MESSAGE,
      remoteOnly: true,
    },
  );
});

test("locally resumable Claude history rows keep explicit Open", () => {
  const availability = getSessionHistoryResumeAvailability(
    { provider: "claude-code", resumable: true },
    "local-claude-session",
  );

  assert.equal(availability.canOpen, true);
  assert.equal(availability.label, "Open");
});

test("Codex and OpenCode history affordances remain unchanged", () => {
  for (const provider of ["codex", "opencode"]) {
    assert.equal(
      getSessionHistoryResumeAvailability({ provider, resumable: false }, `${provider}-session`)
        .canOpen,
      true,
    );
  }
});

test("account switches immediately invalidate only cached Claude resumability", () => {
  const codex = { agent_id: "codex", provider_session_id: "codex-1", resumable: true };
  const claude = { agent_id: "claude", provider_session_id: "claude-1", resumable: true };
  const next = invalidateClaudeSessionHistoryResumability([codex, claude]);

  assert.equal(next[0], codex);
  assert.equal(next[0].resumable, true);
  assert.notEqual(next[1], claude);
  assert.equal(next[1].resumable, false);
  assert.equal(next[1].resume_unavailable_reason, CLAUDE_RESUME_UNAVAILABLE_MESSAGE);
});
