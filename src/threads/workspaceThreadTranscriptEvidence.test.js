import assert from "node:assert/strict";
import test from "node:test";

import { transcriptHasTurnCompletionForPrompt } from "./workspaceThreadTranscriptEvidence.js";

test("completion evidence requires the exact submitted prompt by default", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    createdAt: "2026-05-31T06:42:18.000Z",
    id: "previous-user",
    role: "user",
    text: "are you ready?",
  }, {
    createdAt: "2026-05-31T06:42:19.000Z",
    id: "task-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Ready.",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      expectedUserMessage: "interesting",
      matchedBy: "sessionId",
      submittedAt,
    }),
    false,
  );
});

test("completion evidence accepts an exact matching submitted prompt", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    createdAt: submittedAt,
    id: "current-user",
    role: "user",
    text: "interesting",
  }, {
    createdAt: "2026-05-31T06:42:21.100Z",
    id: "task-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Done.",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      expectedUserMessage: "interesting",
      matchedBy: "sessionId",
      submittedAt,
    }),
    true,
  );
});

test("completion evidence keeps explicit timestamp recovery behavior", () => {
  const submittedAt = "2026-05-31T06:42:20.800Z";
  const messages = [{
    createdAt: "2026-05-31T06:42:20.900Z",
    id: "current-user",
    role: "user",
    text: "slightly normalized prompt",
  }, {
    createdAt: "2026-05-31T06:42:21.100Z",
    id: "task-complete",
    kind: "task_complete",
    role: "assistant",
    text: "Done.",
  }];

  assert.equal(
    transcriptHasTurnCompletionForPrompt(messages, {
      allowTimestampFallback: true,
      expectedUserMessage: "interesting",
      matchedBy: "cwd+timestamp-recovery",
      submittedAt,
    }),
    true,
  );
});
