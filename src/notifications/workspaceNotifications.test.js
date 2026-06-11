import assert from "node:assert/strict";
import test from "node:test";

import {
  reduceThreadLifecycleNotificationEvent,
  reduceTodoCompletedNotificationEvent,
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

  const inferredApproval = reduceThreadLifecycleNotificationEvent(clarification, {
    promptEventId: "prompt-approval",
    promptingUserKind: "approval",
    promptingUserSource: "provider-permission",
    terminalIsPromptingUser: true,
    threadId: "thread-1",
    toolUseId: "tool-1",
    type: "provider-turn-started",
    workspaceId: "workspace-1",
  });

  assert.equal(inferredApproval.cues.length, 0);

  const observedTool = reduceThreadLifecycleNotificationEvent(inferredApproval, {
    hookEventName: "PreToolUse",
    promptingUserKind: "approval",
    promptingUserSource: "cli-hook:tool-observed",
    terminalIsPromptingUser: true,
    threadId: "thread-1",
    toolUseId: "tool-observed",
    type: "provider-tool-observed",
    workspaceId: "workspace-1",
  });

  assert.equal(observedTool.cues.length, 0);

  const autoTool = reduceThreadLifecycleNotificationEvent(observedTool, {
    hookEventName: "PreToolUse",
    manualApprovalRequired: true,
    manualPromptSource: "hook",
    permissionDecision: "allow",
    promptingUserKind: "approval",
    promptingUserSource: "cli-hook:manual-prompt",
    terminalIsPromptingUser: true,
    threadId: "thread-1",
    toolUseId: "tool-auto",
    type: "provider-user-prompt-started",
    workspaceId: "workspace-1",
  });

  assert.equal(autoTool.cues.length, 0);

  const approval = reduceThreadLifecycleNotificationEvent(autoTool, {
    manualApprovalRequired: true,
    manualPromptSource: "hook",
    promptEventId: "prompt-approval",
    promptingUserKind: "approval",
    promptingUserSource: "cli-hook:manual-prompt",
    terminalIsPromptingUser: true,
    threadId: "thread-1",
    toolUseId: "tool-1",
    type: "provider-user-prompt-started",
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

test("todo completion always cues and stays unread for unwatched workspaces", () => {
  const completed = reduceTodoCompletedNotificationEvent({}, {
    itemId: "todo-1",
    paneId: "pane-1",
    queueDrained: false,
    terminalIndex: 2,
    todoTitle: "Fix the login form",
    workspaceId: "workspace-1",
  }, {
    workspaceVisibleAndFocused: false,
  });

  assert.equal(completed.cues.length, 1);
  assert.equal(completed.cues[0].kind, "todo.completed");
  const notification = completed.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-1"];
  assert.equal(notification.kind, "todo.completed");
  assert.equal(notification.status, "unread");
  assert.equal(notification.terminalIndex, 2);
});

test("todo completion that drains the queue cues the drained tone and reads on arrival when watching", () => {
  const drained = reduceTodoCompletedNotificationEvent({}, {
    itemId: "todo-2",
    queueDrained: true,
    workspaceId: "workspace-1",
  }, {
    workspaceVisibleAndFocused: true,
  });

  assert.equal(drained.cues.length, 1);
  assert.equal(drained.cues[0].kind, "todo.queue.drained");
  assert.equal(
    drained.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-2"].status,
    "read",
  );
});
