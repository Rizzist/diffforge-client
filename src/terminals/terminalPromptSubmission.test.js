import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  terminalPromptIsLocalSlashCommand,
  terminalPromptSubmittedPayloadIsAuthoritative,
} from "./terminalPromptSubmission.js";
import {
  extractNativeSessionIdFromOutput,
  getClaudeResumeExitMessage,
} from "./WorkspaceTerminal/terminalCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Claude missing-conversation exit explains the cross-device resume failure", () => {
  assert.equal(
    getClaudeResumeExitMessage({
      agentId: "claude",
      exitCode: 1,
      output: "No conversation found with session ID: 8b11443c-1111-4222-8333-123456789abc",
      providerSessionId: "8b11443c-1111-4222-8333-123456789abc",
    }),
    "This Claude session was created on another device and isn't available to resume here.",
  );
  assert.equal(getClaudeResumeExitMessage({
    agentId: "codex",
    exitCode: 1,
    output: "No conversation found",
    providerSessionId: "codex-session",
  }), "");
});

test("observed input gate submit is authoritative only when the prompt matches", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    observed_prompt: "what else is there",
    prompt_match: true,
    prompt_source: "observed_input_gate",
  }), true);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    observed_prompt: "different prompt",
    prompt_match: false,
    prompt_source: "observed_input_gate",
  }), false);
});

test("frontend prompt metadata cannot prove submission by itself", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "what else is there",
    prompt: "what else is there",
    prompt_match: false,
    prompt_source: "prompt_event_text_unobserved",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "what else is there",
    prompt: "what else is there",
    prompt_match: true,
    prompt_source: "prompt_event_text_unobserved",
  }), false);
});

test("backend prompt metadata submit is not authoritative by itself", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "what else is there",
    prompt: "what else is there",
    prompt_match: true,
    prompt_source: "prompt_event_submit_metadata",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "what else is there",
    prompt: "",
    prompt_match: true,
    prompt_source: "prompt_event_submit_metadata",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    prompt_match: true,
    prompt_source: "prompt_event_submit_metadata",
  }), false);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "what else is there",
    prompt: "different prompt",
    prompt_match: false,
    prompt_source: "prompt_event_submit_metadata",
  }), false);
});

test("parked resume backend submit remains authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "continue",
    observed_prompt: "continue",
    prompt_match: true,
    prompt_source: "parked_resume_backend_submit",
  }), true);
});

test("crash todo resume backend submit remains authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "continue after crash",
    observed_prompt: "continue after crash",
    prompt_match: true,
    prompt_source: "crash_todo_resume_backend_submit",
  }), true);
});

test("activity hook user prompt submit is authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    prompt: "ship it",
    prompt_match: true,
    prompt_source: "activity_hook_user_prompt_submit",
  }), true);

  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    prompt: "ship it",
    prompt_match: true,
    prompt_source: "cli_hook_user_prompt_submit",
  }), true);
});

test("backend todo queue submit remains authoritative", () => {
  assert.equal(terminalPromptSubmittedPayloadIsAuthoritative({
    expected_prompt: "fix the drag/drop bug",
    prompt_match: true,
    prompt_source: "todo_queue_backend_submit",
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

test("local slash command detection never synthesizes thinking for command-shaped input", () => {
  // Command-shaped leading tokens (^/[A-Za-z0-9_:-]+(\s|$)), with or without
  // arguments or surrounding whitespace, are local CLI slash commands.
  for (const command of [
    "/model",
    "/model gpt-5.1-codex high",
    "  /clear",
    "/status\n",
    "/agents:review",
    "/mcp-list",
  ]) {
    assert.equal(
      terminalPromptIsLocalSlashCommand(command),
      true,
      `expected ${JSON.stringify(command)} to read as a local slash command`,
    );
  }

  // A bare slash, a path-like token, and ordinary prompts are not commands, so
  // their turn still flips to thinking normally.
  for (const prompt of [
    "/",
    "/ hello",
    "/foo/bar",
    "please refactor the parser",
    "halve the pricing numbers",
    "",
  ]) {
    assert.equal(
      terminalPromptIsLocalSlashCommand(prompt),
      false,
      `expected ${JSON.stringify(prompt)} to remain a normal prompt`,
    );
  }
});
