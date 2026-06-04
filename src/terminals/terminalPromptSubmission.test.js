import assert from "node:assert/strict";
import test from "node:test";

import {
  terminalPromptSubmittedPayloadIsAuthoritative,
} from "./terminalPromptSubmission.js";

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

test("parked resume backend submit remains authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expectedPrompt: "continue",
    observedPrompt: "continue",
    promptMatch: true,
    promptSource: "parked_resume_backend_submit",
  }), true);
});

test("activity hook user prompt submit is authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    prompt: "ship it",
    promptMatch: true,
    promptSource: "activity_hook_user_prompt_submit",
  }), true);
});
