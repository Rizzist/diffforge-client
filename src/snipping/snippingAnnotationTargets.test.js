import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSnippingAnnotationTargetFields,
  normalizeSnippingDispatchTargets,
} from "./snippingAnnotationTargets.js";

test("selected annotation terminal becomes an explicit todo queue target", () => {
  const fields = buildSnippingAnnotationTargetFields({
    targetThreadId: "thread-ty",
    targetWorkspace: {
      threads: [
        {
          agentId: "codex",
          color: "#ff9d48",
          label: "Joe",
          paneId: "pane-joe",
          terminalIndex: 0,
          threadId: "thread-joe",
        },
        {
          agentId: "claude",
          color: "#3ccb7f",
          label: "Ty",
          paneId: "pane-ty",
          terminalIndex: 1,
          threadId: "thread-ty",
        },
      ],
    },
  });

  assert.equal(fields.targetExplicit, true);
  assert.equal(fields.explicitTarget, true);
  assert.equal(fields.userPinnedTarget, true);
  assert.equal(fields.targetThreadId, "thread-ty");
  assert.equal(fields.targetTerminalId, "pane-ty");
  assert.equal(fields.targetTerminalIndex, 1);
  assert.equal(fields.targetTerminalName, "Ty");
  assert.equal(fields.targetAgentId, "claude");
  assert.equal(fields.targetTerminalColor, "#3ccb7f");
});

test("blank annotation terminal selection stays generic", () => {
  assert.deepEqual(buildSnippingAnnotationTargetFields({
    targetThreadId: "",
    targetWorkspace: {
      threads: [
        {
          paneId: "pane-ty",
          terminalIndex: 1,
          threadId: "thread-ty",
        },
      ],
    },
  }), {});
});

test("stale annotation target keeps only the explicit thread identity", () => {
  const fields = buildSnippingAnnotationTargetFields({
    targetThreadId: "thread-ty",
    targetWorkspace: { threads: [] },
  });

  assert.equal(fields.targetExplicit, true);
  assert.equal(fields.targetThreadId, "thread-ty");
  assert.equal(Object.hasOwn(fields, "targetTerminalIndex"), false);
  assert.equal(Object.hasOwn(fields, "targetTerminalColor"), false);
});

test("dispatch target normalization preserves terminal identity for the editor", () => {
  const targets = normalizeSnippingDispatchTargets([
    {
      workspaceId: "workspace-1",
      workspaceName: "SampleStart",
      threads: [
        {
          agent_id: "Claude",
          agent_label: "Claude",
          color: "#3ccb7f",
          label: "Ty",
          pane_id: "pane-ty",
          terminal_index: 1,
          thread_id: "thread-ty",
        },
      ],
    },
  ]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].threads.length, 1);
  assert.deepEqual(targets[0].threads[0], {
    color: "#3ccb7f",
    label: "Ty",
    targetAgentId: "claude",
    targetAgentLabel: "Claude",
    targetColorSlot: 1,
    targetTerminalColor: "#3ccb7f",
    targetTerminalId: "pane-ty",
    targetTerminalIndex: 1,
    targetTerminalName: "Ty",
    targetThreadId: "thread-ty",
    terminalIndex: 1,
    threadId: "thread-ty",
    value: "thread-ty",
  });
});
