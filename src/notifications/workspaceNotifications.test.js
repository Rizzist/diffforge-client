import assert from "node:assert/strict";
import test from "node:test";

import {
  reduceThreadLifecycleNotificationEvent,
  reduceWorkspaceNotificationEvent,
} from "./workspaceNotifications.js";

test("workspace notification cues only ring for manual approval events", () => {
  const failedTool = reduceWorkspaceNotificationEvent({}, {
    eventId: "event-tool-failed",
    eventType: "mcp_agent_tool_failed",
    payload: { reason: "Automatic MCP tool failed." },
    refs: { taskId: "task-1" },
    workspaceId: "workspace-1",
  });

  assert.equal(failedTool.cues.length, 0);
  assert.equal(
    failedTool.workspaces["workspace-1"].notifications["tool-failed:task-1:event-tool-failed"].kind,
    "tool.failed",
  );

  const approval = reduceWorkspaceNotificationEvent(failedTool, {
    eventId: "event-approval",
    eventType: "approval_requested",
    payload: { approval_id: "approval-1", reason: "Tool requires manual approval." },
    refs: { taskId: "task-1" },
    workspaceId: "workspace-1",
  });

  assert.equal(approval.cues.length, 1);
  assert.equal(approval.cues[0].kind, "approval.required");
});

test("terminal prompt cues only ring for manual acceptance prompt kinds", () => {
  const clarification = reduceThreadLifecycleNotificationEvent({}, {
    promptEventId: "prompt-clarify",
    promptingUserKind: "clarification",
    terminalIsPromptingUser: true,
    threadId: "thread-1",
    type: "provider-turn-started",
    workspaceId: "workspace-1",
  });

  assert.equal(clarification.cues.length, 0);

  const approval = reduceThreadLifecycleNotificationEvent(clarification, {
    promptEventId: "prompt-approval",
    promptingUserKind: "approval",
    promptingUserSource: "provider-permission",
    terminalIsPromptingUser: true,
    threadId: "thread-1",
    toolUseId: "tool-1",
    type: "provider-turn-started",
    workspaceId: "workspace-1",
  });

  assert.equal(approval.cues.length, 1);
  assert.equal(approval.cues[0].kind, "user.input.required");

  const staleTerminalOutput = reduceThreadLifecycleNotificationEvent(approval, {
    promptEventId: "prompt-output",
    promptingUserKind: "approval",
    promptingUserSource: "terminal-output",
    terminalIsPromptingUser: true,
    threadId: "thread-2",
    type: "terminal-output",
    workspaceId: "workspace-1",
  });

  assert.equal(staleTerminalOutput.cues.length, 1);
  assert.equal(
    staleTerminalOutput.workspaces["workspace-1"].notifications["user-input:workspace-1:thread-2:agent:prompt-output"],
    undefined,
  );
});
