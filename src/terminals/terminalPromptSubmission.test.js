import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  terminalPromptSubmittedPayloadIsAuthoritative,
} from "./terminalPromptSubmission.js";
import {
  extractNativeSessionIdFromOutput,
} from "./WorkspaceTerminal/terminalCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

test("opencode native session parser only accepts native ses ids", () => {
  assert.equal(
    extractNativeSessionIdFromOutput(
      "opencode",
      "opencode --session ses_0f32849b3ffeGn2tL6DnSIUCsZ",
    ),
    "ses_0f32849b3ffeGn2tL6DnSIUCsZ",
  );

  assert.equal(
    extractNativeSessionIdFromOutput(
      "opencode",
      "opencode --session 019f0cd7-1347-7273-b20f-e959c3772a01",
    ),
    "",
  );
});

test("panel agent prompt submit keeps agent mode open and drives shared activity", async () => {
  const composerSource = await readFile(path.resolve(__dirname, "PanelAgentPromptComposer.jsx"), "utf8");
  const activitySource = await readFile(path.resolve(__dirname, "PanelAgentPromptActivity.jsx"), "utf8");
  const overlaySource = await readFile(path.resolve(__dirname, "../web/webAgentPromptOverlay.js"), "utf8");

  const submitStart = composerSource.indexOf("const submitPrompt = useCallback");
  const submitEnd = composerSource.indexOf("const targetCount", submitStart);
  assert.notEqual(submitStart, -1);
  assert.notEqual(submitEnd, -1);
  const submitBody = composerSource.slice(submitStart, submitEnd);

  assert.match(submitBody, /setPrompt\(""\)/);
  assert.doesNotMatch(submitBody, /onClose\?\.\(\)/);
  assert.match(activitySource, /compactActivityText\(item\.text \|\| item\.title \|\| item\.label \|\| "Prompt"\)/);
  assert.match(activitySource, /normalizedItems\.slice\(-4\)\.reverse\(\)/);
  assert.match(overlaySource, /activityItems: normalizeOverlayActivityItems\(activityItems\)/);
  assert.match(overlaySource, /class="activity-stack"/);

  const overlaySubmitStart = overlaySource.indexOf("await submitRef.current?.");
  const overlaySubmitEnd = overlaySource.indexOf("} catch (err)", overlaySubmitStart);
  assert.notEqual(overlaySubmitStart, -1);
  assert.notEqual(overlaySubmitEnd, -1);
  const overlaySubmitBody = overlaySource.slice(overlaySubmitStart, overlaySubmitEnd);
  assert.match(overlaySubmitBody, /runOverlayAction\("submitted"/);
  assert.doesNotMatch(overlaySubmitBody, /closeRef\.current\?\.\(\)/);
});
