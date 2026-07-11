import assert from "node:assert/strict";
import test from "node:test";

import {
  collectWorkspaceNotificationAttentionPanes,
  getWorkspaceNotificationSummary,
  reduceThreadLifecycleNotificationEvent,
  reduceTodoCompletedNotificationEvent,
  reduceWorkspaceNotificationEvent,
} from "./workspaceNotifications.js";

test("workspace notification cues only ring for manual approval events", () => {
  const failedTool = reduceWorkspaceNotificationEvent({}, {
    event_id: "event-tool-failed",
    event_type: "mcp_agent_tool_failed",
    payload: { reason: "Automatic MCP tool failed." },
    refs: { task_id: "task-1" },
    workspace_id: "workspace-1",
  });

  assert.equal(failedTool.cues.length, 0);
  assert.equal(
    failedTool.workspaces["workspace-1"].notifications["tool-failed:task-1:event-tool-failed"].kind,
    "tool.failed",
  );

  const approval = reduceWorkspaceNotificationEvent(failedTool, {
    event_id: "event-approval",
    event_type: "approval_requested",
    payload: { approval_id: "approval-1", reason: "Tool requires manual approval." },
    refs: { task_id: "task-1" },
    workspace_id: "workspace-1",
  });

  assert.equal(approval.cues.length, 1);
  assert.equal(approval.cues[0].kind, "approval.required");
});

test("terminal prompt cues only ring for manual acceptance prompt kinds", () => {
  const clarification = reduceThreadLifecycleNotificationEvent({}, {
    prompt_event_id: "prompt-clarify",
    prompting_user_kind: "clarification",
    terminal_is_prompting_user: true,
    thread_id: "thread-1",
    type: "provider-turn-started",
    workspace_id: "workspace-1",
  });

  assert.equal(clarification.cues.length, 0);

  const inferredApproval = reduceThreadLifecycleNotificationEvent(clarification, {
    prompt_event_id: "prompt-approval",
    prompting_user_kind: "approval",
    prompting_user_source: "provider-permission",
    terminal_is_prompting_user: true,
    thread_id: "thread-1",
    tool_use_id: "tool-1",
    type: "provider-turn-started",
    workspace_id: "workspace-1",
  });

  assert.equal(inferredApproval.cues.length, 0);

  const observedTool = reduceThreadLifecycleNotificationEvent(inferredApproval, {
    hook_event_name: "PreToolUse",
    prompting_user_kind: "approval",
    prompting_user_source: "cli-hook:tool-observed",
    terminal_is_prompting_user: true,
    thread_id: "thread-1",
    tool_use_id: "tool-observed",
    type: "provider-tool-observed",
    workspace_id: "workspace-1",
  });

  assert.equal(observedTool.cues.length, 0);

  const autoTool = reduceThreadLifecycleNotificationEvent(observedTool, {
    hook_event_name: "PreToolUse",
    manual_approval_required: true,
    manual_prompt_source: "hook",
    permission_decision: "allow",
    prompting_user_kind: "approval",
    prompting_user_source: "cli-hook:manual-prompt",
    terminal_is_prompting_user: true,
    thread_id: "thread-1",
    tool_use_id: "tool-auto",
    type: "provider-user-prompt-started",
    workspace_id: "workspace-1",
  });

  assert.equal(autoTool.cues.length, 0);

  const approval = reduceThreadLifecycleNotificationEvent(autoTool, {
    manual_approval_required: true,
    manual_prompt_source: "hook",
    prompt_event_id: "prompt-approval",
    prompting_user_kind: "approval",
    prompting_user_source: "cli-hook:manual-prompt",
    terminal_is_prompting_user: true,
    thread_id: "thread-1",
    tool_use_id: "tool-1",
    type: "provider-user-prompt-started",
    workspace_id: "workspace-1",
  });

  assert.equal(approval.cues.length, 1);
  assert.equal(approval.cues[0].kind, "user.input.required");

  const staleTerminalOutput = reduceThreadLifecycleNotificationEvent(approval, {
    prompt_event_id: "prompt-output",
    prompting_user_kind: "approval",
    prompting_user_source: "terminal-output",
    terminal_is_prompting_user: true,
    thread_id: "thread-2",
    type: "terminal-output",
    workspace_id: "workspace-1",
  });

  assert.equal(staleTerminalOutput.cues.length, 1);
  assert.equal(
    staleTerminalOutput.workspaces["workspace-1"].notifications["user-input:workspace-1:thread-2:agent:prompt-output"],
    undefined,
  );
});

test("todo completion cues with causer tags and stays unread for unwatched workspaces", () => {
  const completed = reduceTodoCompletedNotificationEvent({}, {
    item_id: "todo-1",
    pane_id: "pane-1",
    queue_drained: false,
    terminal_index: 2,
    todo_title: "Fix the login form",
    workspace_id: "workspace-1",
  }, {
    workspaceVisibleAndFocused: false,
  });

  assert.equal(completed.cues.length, 1);
  assert.equal(completed.cues[0].kind, "todo.completed");
  assert.equal(completed.cues[0].workspace_id, "workspace-1");
  assert.equal(completed.cues[0].pane_id, "pane-1");
  assert.equal(completed.cues[0].terminal_index, 2);
  const notification = completed.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-1"];
  assert.equal(notification.kind, "todo.completed");
  assert.equal(notification.status, "unread");
  assert.equal(notification.terminal_index, 2);
});

test("todo completion stays silent and read while watching the causing workspace's terminals tab", () => {
  const completed = reduceTodoCompletedNotificationEvent({}, {
    item_id: "todo-3",
    pane_id: "pane-1",
    queue_drained: false,
    terminal_index: 1,
    workspace_id: "workspace-1",
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
    item_id: "todo-2",
    queue_drained: true,
    workspace_id: "workspace-1",
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
    pane_id: "pane-1",
    prompt_event_id: "turn-1",
    thread_id: "thread-1",
    type: "provider-turn-started",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const completedTurn = reduceThreadLifecycleNotificationEvent(started, {
    pane_id: "pane-1",
    prompt_event_id: "turn-1",
    terminal_is_complete: true,
    thread_id: "thread-1",
    type: "provider-turn-completed",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const readyNotifications = Object.values(completedTurn.workspaces["workspace-1"].notifications)
    .filter((notification) => notification.kind === "terminal.ready");
  assert.equal(readyNotifications.length, 1);
  assert.equal(readyNotifications[0].status, "unread");

  const completedTodo = reduceTodoCompletedNotificationEvent(completedTurn, {
    item_id: "todo-9",
    pane_id: "pane-1",
    queue_drained: false,
    terminal_index: 0,
    thread_id: "thread-1",
    todo_title: "Ship it",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const summary = getWorkspaceNotificationSummary(completedTodo, "workspace-1");
  assert.equal(summary.badgeCount, 1);
  const resolvedReady = Object.values(completedTodo.workspaces["workspace-1"].notifications)
    .find((notification) => notification.kind === "terminal.ready");
  assert.equal(resolvedReady.status, "resolved");
});

test("one completion badges once: a fresh todo.completed suppresses the terminal.ready twin", () => {
  const completedTodo = reduceTodoCompletedNotificationEvent({}, {
    item_id: "todo-10",
    pane_id: "pane-1",
    queue_drained: false,
    terminal_index: 0,
    thread_id: "thread-1",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const started = reduceThreadLifecycleNotificationEvent(completedTodo, {
    pane_id: "pane-1",
    prompt_event_id: "turn-2",
    thread_id: "thread-1",
    type: "provider-turn-started",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const completedTurn = reduceThreadLifecycleNotificationEvent(started, {
    pane_id: "pane-1",
    prompt_event_id: "turn-2",
    terminal_is_complete: true,
    thread_id: "thread-1",
    type: "provider-turn-completed",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const readyNotifications = Object.values(completedTurn.workspaces["workspace-1"].notifications)
    .filter((notification) => notification.kind === "terminal.ready");
  assert.equal(readyNotifications.length, 0);
  assert.equal(getWorkspaceNotificationSummary(completedTurn, "workspace-1").badgeCount, 1);
});

test("duplicate completion hooks with a turn id update one notification", () => {
  const first = reduceTodoCompletedNotificationEvent({}, {
    item_id: "",
    pane_id: "pane-1",
    terminal_index: 0,
    turn_id: "turn-3",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });
  const second = reduceTodoCompletedNotificationEvent(first, {
    item_id: "",
    pane_id: "pane-1",
    terminal_index: 0,
    turn_id: "turn-3",
    workspace_id: "workspace-1",
  }, { workspaceVisibleAndFocused: false });

  const todoNotifications = Object.values(second.workspaces["workspace-1"].notifications)
    .filter((notification) => notification.kind === "todo.completed");
  assert.equal(todoNotifications.length, 1);
  assert.equal(getWorkspaceNotificationSummary(second, "workspace-1").badgeCount, 1);
});

test("queue drain while watching the causing workspace stays silent", () => {
  const drained = reduceTodoCompletedNotificationEvent({}, {
    item_id: "todo-4",
    queue_drained: true,
    workspace_id: "workspace-1",
  }, {
    workspaceVisibleAndFocused: true,
  });

  assert.equal(drained.cues.length, 0);
  assert.equal(
    drained.workspaces["workspace-1"].notifications["todo-completed:workspace-1:todo-4"].status,
    "read",
  );
});

test("attention panes attribute unread notifications to their terminals", () => {
  const state = {
    workspaces: {
      "workspace-1": {
        notifications: {
          "n-newest": {
            created_at: "2026-06-12T10:00:02.000Z",
            id: "n-newest",
            kind: "approval.required",
            pane_id: "pane-a",
            status: "unread",
            title: "Approval required",
          },
          "n-older": {
            created_at: "2026-06-12T10:00:01.000Z",
            id: "n-older",
            kind: "user.input.required",
            pane_id: "pane-a",
            status: "unread",
            title: "User input needed",
          },
          "n-index-only": {
            created_at: "2026-06-12T10:00:00.000Z",
            id: "n-index-only",
            kind: "all.done",
            status: "unread",
            terminal_index: 2,
            title: "Agents finished",
          },
          "n-read": {
            created_at: "2026-06-12T09:00:00.000Z",
            id: "n-read",
            kind: "all.done",
            pane_id: "pane-b",
            status: "read",
            title: "Agents finished",
          },
          "n-no-pane": {
            created_at: "2026-06-12T08:00:00.000Z",
            id: "n-no-pane",
            kind: "todo.completed",
            status: "unread",
            title: "Todo completed",
          },
        },
      },
    },
  };

  const panes = collectWorkspaceNotificationAttentionPanes(state, "workspace-1");
  assert.equal(panes.length, 2);

  const paneA = panes.find((pane) => pane.pane_id === "pane-a");
  assert.equal(paneA.count, 2);
  // Notifications normalize newest-first, so the chip title is the latest one.
  assert.equal(paneA.title, "Approval required");

  const indexPane = panes.find((pane) => pane.terminal_index === 2);
  assert.equal(indexPane.count, 1);
  assert.equal(indexPane.pane_id, "");

  assert.equal(collectWorkspaceNotificationAttentionPanes(state, "missing").length, 0);
  assert.equal(collectWorkspaceNotificationAttentionPanes(state, "").length, 0);
});
