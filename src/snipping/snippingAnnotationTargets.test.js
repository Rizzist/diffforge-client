import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSnippingAnnotationTargetFields,
  normalizeSnippingDispatchTargets,
} from "./snippingAnnotationTargets.js";

test("selected annotation terminal becomes an explicit todo queue target", () => {
  const fields = buildSnippingAnnotationTargetFields({
    target_thread_id: "thread-ty",
    targetWorkspace: {
      threads: [
        {
          agent_id: "codex",
          color: "#ff9d48",
          label: "Joe",
          pane_id: "pane-joe",
          terminal_index: 0,
          thread_id: "thread-joe",
        },
        {
          agent_id: "claude",
          color: "#3ccb7f",
          label: "Ty",
          pane_id: "pane-ty",
          terminal_index: 1,
          thread_id: "thread-ty",
        },
      ],
    },
  });

  assert.equal(fields.target_explicit, true);
  assert.equal(fields.explicit_target, true);
  assert.equal(fields.user_pinned_target, true);
  assert.equal(fields.target_thread_id, "thread-ty");
  assert.equal(fields.target_terminal_id, "pane-ty");
  assert.equal(fields.target_terminal_index, 1);
  assert.equal(fields.target_terminal_name, "Ty");
  assert.equal(fields.target_agent_id, "claude");
  assert.equal(fields.target_terminal_color, "#3ccb7f");
});

test("blank annotation terminal selection stays generic", () => {
  assert.deepEqual(buildSnippingAnnotationTargetFields({
    target_thread_id: "",
    targetWorkspace: {
      threads: [
        {
          pane_id: "pane-ty",
          terminal_index: 1,
          thread_id: "thread-ty",
        },
      ],
    },
  }), {});
});

test("stale annotation target keeps only the explicit thread identity", () => {
  const fields = buildSnippingAnnotationTargetFields({
    target_thread_id: "thread-ty",
    targetWorkspace: { threads: [] },
  });

  assert.equal(fields.target_explicit, true);
  assert.equal(fields.target_thread_id, "thread-ty");
  assert.equal(Object.hasOwn(fields, "target_terminal_index"), false);
  assert.equal(Object.hasOwn(fields, "target_terminal_color"), false);
});

test("dispatch target normalization preserves terminal identity for the editor", () => {
  const targets = normalizeSnippingDispatchTargets([
    {
      workspace_id: "workspace-1",
      workspace_name: "SampleStart",
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
    target_agent_id: "claude",
    target_agent_label: "Claude",
    target_color_slot: 1,
    target_terminal_color: "#3ccb7f",
    target_terminal_id: "pane-ty",
    target_terminal_index: 1,
    target_terminal_name: "Ty",
    target_thread_id: "thread-ty",
    terminal_index: 1,
    thread_id: "thread-ty",
    value: "thread-ty",
  });
});
