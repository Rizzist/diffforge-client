import assert from "node:assert/strict";
import test from "node:test";

import { transcriptHasTurnCompletionForPrompt } from "./workspaceThreadTranscriptEvidence.js";

test("completion evidence requires the exact submitted prompt by default", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    created_at: "2026-05-31T06:42:18.000Z",
    id: "previous-user",
    role: "user",
    text: "are you ready?",
  }, {
    created_at: "2026-05-31T06:42:19.000Z",
    id: "task-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Ready.",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      expected_user_message: "interesting",
      matched_by: "session_id",
      submitted_at: submittedAt,
    }),
    false,
  );
});

test("completion evidence accepts an exact matching submitted prompt", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    created_at: submittedAt,
    id: "current-user",
    role: "user",
    text: "interesting",
  }, {
    created_at: "2026-05-31T06:42:21.100Z",
    id: "task-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Done.",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      expected_user_message: "interesting",
      matched_by: "session_id",
      submitted_at: submittedAt,
    }),
    true,
  );
});

test("completion evidence keeps explicit timestamp recovery behavior", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    created_at: "2026-05-31T06:42:20.900Z",
    id: "current-user",
    role: "user",
    text: "slightly normalized prompt",
  }, {
    created_at: "2026-05-31T06:42:21.100Z",
    id: "task-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Done.",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      allow_timestamp_fallback: true,
      expected_user_message: "interesting",
      matched_by: "cwd+timestamp-recovery",
      submitted_at: submittedAt,
    }),
    true,
  );
});

test("completion evidence stops at the next user turn", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    created_at: submittedAt,
    id: "current-user",
    role: "user",
    text: "interesting",
  }, {
    created_at: "2026-05-31T06:42:21.000Z",
    id: "later-user",
    role: "user",
    text: "new task",
  }, {
    created_at: "2026-05-31T06:42:22.100Z",
    id: "task-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Done.",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      expected_user_message: "interesting",
      matched_by: "session_id",
      submitted_at: submittedAt,
    }),
    false,
  );
});

test("completion evidence ignores duplicate prompts before submitted timestamp", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    created_at: "2026-05-31T06:40:00.000Z",
    id: "old-user",
    role: "user",
    text: "Make proposal",
  }, {
    created_at: "2026-05-31T06:40:04.000Z",
    id: "old-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Old answer.",
  }, {
    created_at: submittedAt,
    id: "current-user",
    role: "user",
    text: "Make proposal",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      expected_user_message: "Make proposal",
      matched_by: "session_id",
      submitted_at: submittedAt,
    }),
    false,
  );
});
