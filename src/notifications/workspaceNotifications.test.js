import assert from "node:assert/strict";
import test from "node:test";

import {
  getWorkspaceNotificationSummary,
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

test("todo completion cues with causer tags and stays unread for unwatched workspaces", () => {
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
  assert.equal(completed.cues[0].workspaceId, "workspace-1");
  assert.equal(completed.cues[0].paneId, "pane-1");
  assert.equal(completed.cues[0].terminalIndex, 2);
  const notification = completed.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-1"];
  assert.equal(notification.kind, "todo.completed");
  assert.equal(notification.status, "unread");
  assert.equal(notification.terminalIndex, 2);
});

test("todo completion stays silent and read while watching the causing workspace's terminals tab", () => {
  const completed = reduceTodoCompletedNotificationEvent({}, {
    itemId: "todo-3",
    paneId: "pane-1",
    queueDrained: false,
    terminalIndex: 1,
    workspaceId: "workspace-1",
  }, {
    workspaceVisibleAndFocused: true,
  });

  assert.equal(completed.cues.length, 0);
  assert.equal(
    completed.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-3"].status,
    "read",
  );
});

test("todo completion that drains the queue cues the drained tone when not watching", () => {
  const drained = reduceTodoCompletedNotificationEvent({}, {
    itemId: "todo-2",
    queueDrained: true,
    workspaceId: "workspace-1",
  }, {
    workspaceVisibleAndFocused: false,
  });

  assert.equal(drained.cues.length, 1);
  assert.equal(drained.cues[0].kind, "todo.queue.drained");
  assert.equal(
    drained.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-2"].status,
    "unread",
  );
});

test("one completion badges once: todo.completed resolves the terminal.ready twin", () => {
  const started = reduceThreadLifecycleNotificationEvent({}, {
    paneId: "pane-1",
    promptEventId: "turn-1",
    threadId: "thread-1",
    type: "provider-turn-started",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const completedTurn = reduceThreadLifecycleNotificationEvent(started, {
    paneId: "pane-1",
    promptEventId: "turn-1",
    terminalIsComplete: true,
    threadId: "thread-1",
    type: "provider-turn-completed",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const readyNotifications = Object.values(completedTurn.workspaces["workspace-1"].notifications)
    .filter((notification) => notification.kind === "terminal.ready");
  assert.equal(readyNotifications.length, 1);
  assert.equal(readyNotifications[0].status, "unread");

  const completedTodo = reduceTodoCompletedNotificationEvent(completedTurn, {
    itemId: "todo-9",
    paneId: "pane-1",
    queueDrained: false,
    terminalIndex: 0,
    threadId: "thread-1",
    todoTitle: "Ship it",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const summary = getWorkspaceNotificationSummary(completedTodo, "workspace-1");
  assert.equal(summary.badgeCount, 1);
  const resolvedReady = Object.values(completedTodo.workspaces["workspace-1"].notifications)
    .find((notification) => notification.kind === "terminal.ready");
  assert.equal(resolvedReady.status, "resolved");
});

test("one completion badges once: a fresh todo.completed suppresses the terminal.ready twin", () => {
  const completedTodo = reduceTodoCompletedNotificationEvent({}, {
    itemId: "todo-10",
    paneId: "pane-1",
    queueDrained: false,
    terminalIndex: 0,
    threadId: "thread-1",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const started = reduceThreadLifecycleNotificationEvent(completedTodo, {
    paneId: "pane-1",
    promptEventId: "turn-2",
    threadId: "thread-1",
    type: "provider-turn-started",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const completedTurn = reduceThreadLifecycleNotificationEvent(started, {
    paneId: "pane-1",
    promptEventId: "turn-2",
    terminalIsComplete: true,
    threadId: "thread-1",
    type: "provider-turn-completed",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const readyNotifications = Object.values(completedTurn.workspaces["workspace-1"].notifications)
    .filter((notification) => notification.kind === "terminal.ready");
  assert.equal(readyNotifications.length, 0);
  assert.equal(getWorkspaceNotificationSummary(completedTurn, "workspace-1").badgeCount, 1);
});

test("duplicate completion hooks with a turn id update one notification", () => {
  const first = reduceTodoCompletedNotificationEvent({}, {
    itemId: "",
    paneId: "pane-1",
    terminalIndex: 0,
    turnId: "turn-3",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });
  const second = reduceTodoCompletedNotificationEvent(first, {
    itemId: "",
    paneId: "pane-1",
    terminalIndex: 0,
    turnId: "turn-3",
    workspaceId: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const todoNotifications = Object.values(second.workspaces["workspace-1"].notifications)
    .filter((notification) => notification.kind === "todo.completed");
  assert.equal(todoNotifications.length, 1);
  assert.equal(getWorkspaceNotificationSummary(second, "workspace-1").badgeCount, 1);
});

test("queue drain while watching the causing workspace stays silent", () => {
  const drained = reduceTodoCompletedNotificationEvent({}, {
    itemId: "todo-4",
    queueDrained: true,
    workspaceId: "workspace-1",
  }, {
    workspaceVisibleAndFocused: true,
  });

  assert.equal(drained.cues.length, 0);
  assert.equal(
    drained.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-4"].status,
    "read",
  );
});
