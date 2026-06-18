import assert from "node:assert/strict";
import test from "node:test";

import {
  terminalPromptSubmittedPayloadIsAuthoritative,
} from "./terminalPromptSubmission.js";
import {
  extractNativeSessionIdFromOutput,
} from "./WorkspaceTerminal/terminalCore.js";

test("observed input gate submit is authoritative only when the prompt matches", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    observedPrompt: "what else is there",
    promptMatch: true,
    promptSource: "observed_input_gate",
  }), true);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    observedPrompt: "different prompt",
    promptMatch: false,
    promptSource: "observed_input_gate",
  }), false);
});

test("frontend prompt metadata cannot prove submission by itself", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "what else is there",
    prompt: "what else is there",
    promptMatch: false,
    promptSource: "prompt_event_text_unobserved",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "what else is there",
    prompt: "what else is there",
    promptMatch: true,
    promptSource: "prompt_event_text_unobserved",
  }), false);
});

test("backend prompt metadata submit is not authoritative by itself", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "what else is there",
    prompt: "what else is there",
    promptMatch: true,
    promptSource: "prompt_event_submit_metadata",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "what else is there",
    prompt: "",
    promptMatch: true,
    promptSource: "prompt_event_submit_metadata",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    promptMatch: true,
    promptSource: "prompt_event_submit_metadata",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "what else is there",
    prompt: "different prompt",
    promptMatch: false,
    promptSource: "prompt_event_submit_metadata",
  }), false);
});

test("parked resume backend submit remains authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "continue",
    observedPrompt: "continue",
    promptMatch: true,
    promptSource: "parked_resume_backend_submit",
  }), true);
});

test("crash todo resume backend submit remains authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "continue after crash",
    observedPrompt: "continue after crash",
    promptMatch: true,
    promptSource: "crash_todo_resume_backend_submit",
  }), true);
});

test("activity hook user prompt submit is authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    prompt: "ship it",
    promptMatch: true,
    promptSource: "activity_hook_user_prompt_submit",
  }), true);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    prompt: "ship it",
    promptMatch: true,
    promptSource: "cli_hook_user_prompt_submit",
  }), true);
});

test("backend todo queue submit remains authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "fix the drag/drop bug",
    promptMatch: true,
    promptSource: "todo_queue_backend_submit",
  }), true);
});

test("codex native session id parser accepts session metadata output", () => {
  assert.equal(
    extractNativeSessionIdFromOutput(
      "codex",
      "Session ID: sess_0123456789abcdef",
    ),
    "sess_0123456789abcdef",
  );

  assert.equal(
    extractNativeSessionIdFromOutput(
      "codex",
      '{"type":"session_meta","payload":{"id":"codex-native-session-abcdef12"}}',
    ),
    "codex-native-session-abcdef12",
  );

  assert.equal(
    extractNativeSessionIdFromOutput(
      "codex",
      '{"sessionId":"codexSessionId_12345678"}',
    ),
    "codexSessionId_12345678",
  );
});
