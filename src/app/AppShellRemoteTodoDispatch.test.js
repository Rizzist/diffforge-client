import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  resolveLoopspaceTodoTerminalSelectors,
} from "./loopspaceTodoDispatchTargets.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const appShellSource = await readFile(path.join(appDir, "AppShell.jsx"), "utf8");
const terminalWorkspaces = [
  {
    workspace_id: "ws-a",
    terminals: [
      { pane_id: "pane-a-0", terminal_index: 0, terminal_name: "Primary A", thread_id: "thread-a-0" },
      { pane_id: "pane-a-2", terminal_index: 2, terminal_name: "Build A", thread_id: "thread-a-2" },
    ],
  },
  {
    workspace_id: "ws-b",
    terminals: [
      { pane_id: "pane-b-0", terminal_index: 0, terminal_name: "Primary B", thread_id: "thread-b-0" },
      { pane_id: "pane-b-2", terminal_index: 2, terminal_name: "Build B", thread_id: "thread-b-2" },
    ],
  },
];

function sourceBetween(startMarker, endMarker) {
  const start = appShellSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = appShellSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return appShellSource.slice(start, end);
}

test("loopspace dispatch-todos bypasses the singular-workspace gate", () => {
  const workspaceGate = sourceBetween(
    "const requiresWorkspace = remoteCommandOptionalBooleanField",
    "if (!claimRemoteCommandReceipt",
  );
  assert.match(workspaceGate, /&& !dispatchTodosAction/);
});

test("loopspace dispatch-todos invokes the Rust batch primitive and returns before generic queueing", () => {
  const handler = sourceBetween(
    "if (dispatchTodosAction) {",
    "if (terminalOrchestratorMessageAction) {",
  );
  assert.match(handler, /invoke\("todo_store_dispatch_loopspace_batch"/);
  assert.match(handler, /reason: "loopspace_dispatch_todos_remote_command"/);
  assert.match(handler, /command_kind: "loopspace_dispatch_todos"/);
  assert.match(handler, /\.\.\.event/);
  assert.match(handler, /loop_runtime_run_id: loopRuntimeRunId/);
  assert.match(handler, /target_terminal_mode: targetTerminalMode/);
  assert.match(handler, /target_terminal_index: targetTerminalIndex/);
  assert.match(handler, /target_terminal_selectors: workspaceTerminalSelectors/);
  assert.match(handler, /target_thread_id: targetThreadId/);
  assert.match(handler, /workspace_ids: targetWorkspaceIds/);
  assert.match(handler, /return;/);
  assert.doesNotMatch(handler, /REMOTE_TODO_QUEUE_EVENT/);
});

test("loopspace dispatch-todos skips singular current-workspace terminal resolution", () => {
  const targetResolution = sourceBetween(
    "const resolvedRemoteTarget =",
    "let targetColorSlot =",
  );
  assert.match(targetResolution, /!dispatchTodosAction && workspaceId && hasExplicitRemoteTarget/);
});

test("plural pinned index resolves inside every target workspace", () => {
  const selectors = resolveLoopspaceTodoTerminalSelectors({
    targetTerminalIndex: 2,
    targetTerminalMode: "pinned",
    targetWorkspaceIds: ["ws-a", "ws-b"],
    terminalWorkspaces,
  });

  assert.deepEqual(selectors.map((selector) => ({
    workspace_id: selector.workspace_id,
    target_terminal_id: selector.target_terminal_id,
    target_terminal_index: selector.target_terminal_index,
  })), [
    { workspace_id: "ws-a", target_terminal_id: "pane-a-2", target_terminal_index: 2 },
    { workspace_id: "ws-b", target_terminal_id: "pane-b-2", target_terminal_index: 2 },
  ]);
});

test("plural pane id stays in its workspace and uses an equivalent selector or any elsewhere", () => {
  const equivalentSelectors = resolveLoopspaceTodoTerminalSelectors({
    targetTerminalId: "pane-a-2",
    targetTerminalIndex: 2,
    targetTerminalMode: "pinned",
    targetWorkspaceIds: ["ws-a", "ws-b"],
    terminalWorkspaces,
  });
  assert.equal(equivalentSelectors[0].target_terminal_id, "pane-a-2");
  assert.equal(equivalentSelectors[1].target_terminal_id, "pane-b-2");
  assert.notEqual(equivalentSelectors[1].target_terminal_id, "pane-a-2");

  const idOnlySelectors = resolveLoopspaceTodoTerminalSelectors({
    targetTerminalId: "pane-a-2",
    targetTerminalMode: "pinned",
    targetWorkspaceIds: ["ws-a", "ws-b"],
    terminalWorkspaces,
  });
  assert.equal(idOnlySelectors[0].target_terminal_id, "pane-a-2");
  assert.deepEqual(idOnlySelectors[1], {
    workspace_id: "ws-b",
    target_terminal_mode: "auto",
  });
});

test("plural any-terminal stays any-terminal per workspace", () => {
  assert.deepEqual(resolveLoopspaceTodoTerminalSelectors({
    targetTerminalMode: "auto",
    targetWorkspaceIds: ["ws-a", "ws-b"],
    terminalWorkspaces,
  }), [
    { workspace_id: "ws-a", target_terminal_mode: "auto" },
    { workspace_id: "ws-b", target_terminal_mode: "auto" },
  ]);
  assert.deepEqual(resolveLoopspaceTodoTerminalSelectors({
    targetTerminalMode: "pinned",
    targetWorkspaceIds: ["ws-a", "ws-b"],
    terminalWorkspaces,
  }), [
    { workspace_id: "ws-a", target_terminal_mode: "auto" },
    { workspace_id: "ws-b", target_terminal_mode: "auto" },
  ]);
});

test("single-workspace pane resolution remains exact", () => {
  const [selector] = resolveLoopspaceTodoTerminalSelectors({
    targetTerminalId: "pane-a-2",
    targetTerminalIndex: 2,
    targetTerminalMode: "pinned",
    targetWorkspaceIds: ["ws-a"],
    terminalWorkspaces,
  });
  assert.equal(selector.workspace_id, "ws-a");
  assert.equal(selector.target_terminal_id, "pane-a-2");
  assert.equal(selector.target_terminal_index, 2);

  const [missingInventorySelector] = resolveLoopspaceTodoTerminalSelectors({
    targetTerminalId: "pane-a-2",
    targetTerminalMode: "pinned",
    targetWorkspaceIds: ["ws-a"],
    terminalWorkspaces: [],
  });
  assert.equal(missingInventorySelector.target_terminal_id, "pane-a-2");
});

test("loopspace dispatch-todos reports batch success and failure to cloud", () => {
  const handler = sourceBetween(
    "if (dispatchTodosAction) {",
    "if (terminalOrchestratorMessageAction) {",
  );
  assert.match(handler, /queued_count: queuedCount/);
  assert.match(handler, /workspace_count: workspaceCount/);
  assert.match(handler, /"failed"/);
});
