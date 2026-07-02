import test from "node:test";
import assert from "node:assert/strict";

import {
  loopspaceGraphOutputPortsForNode,
  loopspaceGraphPropValue,
  loopspaceGraphVisualDefaultsForNode,
  validateLoopspaceGraphAst,
  validateLoopspaceGraphAstForUpdate,
  validateLoopspaceGraphEdgeCandidate,
} from "./graphContract.js";
import {
  applyDfBlueprintPatchOperations,
  parseDfBlueprintSource,
  validateDfBlueprintSource,
} from "./dfblueprint.js";

const triggerNode = { id: "trigger-1", kind: "trigger", label: "Kick" };
const runScriptNode = { id: "run-script-1", kind: "run_script", label: "Run script" };
const sendMessageNode = { id: "send-message-1", kind: "send_message", label: "Send message" };
const dispatchTodosNode = { id: "dispatch-todos-1", kind: "dispatch_todos", label: "Dispatch todos" };
const documentReadNode = { id: "doc-read-1", kind: "document_read", label: "Read docs" };
const documentWriteNode = { id: "doc-write-1", kind: "document_write", label: "Write docs" };
const assetReadNode = { id: "asset-read-1", kind: "asset_read", label: "Read assets" };
const assetWriteNode = { id: "asset-write-1", kind: "asset_write", label: "Write assets" };
const stepNode = {
  id: "step-1",
  kind: "step",
  label: "Read checkpoint",
  props: { parent_id: sendMessageNode.id },
};
const orphanStepNode = { id: "orphan-step-1", kind: "step", label: "Loose checkpoint" };
const wrongParentStepNode = {
  id: "wrong-parent-step-1",
  kind: "step",
  label: "Wrong parent checkpoint",
  props: { parent_id: runScriptNode.id },
};
const missingParentStepNode = {
  id: "missing-parent-step-1",
  kind: "step",
  label: "Missing parent checkpoint",
  props: { parent_id: "missing-message" },
};

test("graph contract exposes execution branches for action nodes", () => {
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(runScriptNode).map((port) => port.id),
    ["exec", "success", "failure", "interrupt"],
  );
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(sendMessageNode).map((port) => port.id),
    ["exec", "success", "failure", "interrupt"],
  );
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(dispatchTodosNode).map((port) => port.id),
    ["exec", "success", "failure", "interrupt"],
  );
});

test("graph prop lookup tolerates missing props during runtime updates", () => {
  assert.equal(loopspaceGraphPropValue(undefined, ["script_id"]), undefined);
  assert.equal(loopspaceGraphPropValue(null, ["script_id"]), undefined);
  assert.equal(loopspaceGraphPropValue([], ["script_id"]), undefined);
  assert.equal(loopspaceGraphPropValue({ script_id: "", path_key: "build.sh" }, ["script_id", "path_key"]), "build.sh");
  assert.equal(loopspaceGraphPropValue({ script_id: "script-1" }, ["script_id"]), "script-1");
});

test("graph contract exposes document and asset resource ports", () => {
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(documentReadNode).map((port) => port.id),
    ["docs"],
  );
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(documentWriteNode).map((port) => port.id),
    ["docs"],
  );
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(assetReadNode).map((port) => port.id),
    ["assets"],
  );
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(assetWriteNode).map((port) => port.id),
    ["assets"],
  );
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(stepNode).map((port) => port.id),
    ["success", "docs", "assets"],
  );
});

test("graph contract rejects illegal branch ports", () => {
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(runScriptNode, sendMessageNode, {
      fromPort: "docs",
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(documentReadNode, sendMessageNode, {
      fromPort: "success",
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(sendMessageNode, documentReadNode, {
      fromPort: "success",
      toPort: "in",
    }).ok,
    false,
  );
});

test("graph contract accepts legal flow and document ports", () => {
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(triggerNode, sendMessageNode, {
      fromPort: "out",
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(runScriptNode, sendMessageNode, {
      fromPort: "success",
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(sendMessageNode, dispatchTodosNode, {
      fromPort: "success",
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(documentReadNode, sendMessageNode, {
      fromPort: "docs",
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(sendMessageNode, documentWriteNode, {
      fromPort: "failure",
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(triggerNode, assetWriteNode, {
      fromPort: "out",
      toPort: "in",
    }).ok,
    true,
  );
});

test("graph contract accepts completed send-message step edges to action nodes", () => {
  const nodeById = new Map([
    [sendMessageNode.id, sendMessageNode],
    [runScriptNode.id, runScriptNode],
    [dispatchTodosNode.id, dispatchTodosNode],
    [stepNode.id, stepNode],
    [orphanStepNode.id, orphanStepNode],
    [wrongParentStepNode.id, wrongParentStepNode],
  ]);
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, runScriptNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, {
      ...sendMessageNode,
      id: "send-message-follow-up",
    }, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, dispatchTodosNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(orphanStepNode, runScriptNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(wrongParentStepNode, runScriptNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
});

test("graph contract accepts document context edges for send-message steps only", () => {
  const nodeById = new Map([
    [sendMessageNode.id, sendMessageNode],
    [runScriptNode.id, runScriptNode],
    [dispatchTodosNode.id, dispatchTodosNode],
    [stepNode.id, stepNode],
    [orphanStepNode.id, orphanStepNode],
    [wrongParentStepNode.id, wrongParentStepNode],
    [missingParentStepNode.id, missingParentStepNode],
  ]);
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(documentReadNode, stepNode, {
      fromPort: "docs",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, documentWriteNode, {
      fromPort: "docs",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(documentReadNode, orphanStepNode, {
      fromPort: "docs",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(wrongParentStepNode, documentWriteNode, {
      fromPort: "docs",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(runScriptNode, stepNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(documentWriteNode, missingParentStepNode, {
      fromPort: "docs",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, sendMessageNode, {
      fromPort: "docs",
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, documentWriteNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
});

test("graph contract accepts asset context edges for send-message steps only", () => {
  const nodeById = new Map([
    [sendMessageNode.id, sendMessageNode],
    [runScriptNode.id, runScriptNode],
    [dispatchTodosNode.id, dispatchTodosNode],
    [stepNode.id, stepNode],
    [orphanStepNode.id, orphanStepNode],
    [wrongParentStepNode.id, wrongParentStepNode],
    [missingParentStepNode.id, missingParentStepNode],
  ]);
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(assetReadNode, stepNode, {
      fromPort: "assets",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, assetWriteNode, {
      fromPort: "assets",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(assetWriteNode, stepNode, {
      fromPort: "assets",
      nodeById,
      toPort: "in",
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(stepNode, assetWriteNode, {
      fromPort: "docs",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(assetReadNode, orphanStepNode, {
      fromPort: "assets",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(wrongParentStepNode, assetWriteNode, {
      fromPort: "assets",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(assetWriteNode, missingParentStepNode, {
      fromPort: "assets",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(sendMessageNode, assetWriteNode, {
      fromPort: "exec",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(sendMessageNode, assetWriteNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(runScriptNode, assetWriteNode, {
      fromPort: "exec",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(dispatchTodosNode, assetWriteNode, {
      fromPort: "success",
      nodeById,
      toPort: "in",
    }).ok,
    false,
  );
});

test("graph contract keeps legacy action out edges readable but not newly valid", () => {
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(runScriptNode, sendMessageNode, {
      fromPort: "out",
      toPort: "in",
    }).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphEdgeCandidate(runScriptNode, sendMessageNode, {
      allowLegacy: true,
      fromPort: "out",
      toPort: "in",
    }).ok,
    true,
  );
});

test("graph update validation only preserves exact existing legacy action out edges", () => {
  const previousAst = {
    nodes: [runScriptNode, sendMessageNode],
    edges: [{
      id: "edge-legacy",
      from: runScriptNode.id,
      fromPort: "out",
      label: "OUT",
      props: { branch: "out" },
      role: "flow",
      to: sendMessageNode.id,
      toPort: "in",
    }],
  };

  assert.equal(validateLoopspaceGraphAstForUpdate(previousAst, previousAst).ok, true);
  assert.equal(
    validateLoopspaceGraphAstForUpdate({
      nodes: [runScriptNode, sendMessageNode],
      edges: [{
        ...previousAst.edges[0],
        id: "edge-new",
      }],
    }, previousAst).ok,
    false,
  );
  assert.equal(
    validateLoopspaceGraphAstForUpdate({
      nodes: [
        { id: runScriptNode.id, kind: "loop", label: "Loop" },
        sendMessageNode,
      ],
      edges: [previousAst.edges[0]],
    }, {
      nodes: [
        { id: runScriptNode.id, kind: "loop", label: "Loop" },
        sendMessageNode,
      ],
      edges: [previousAst.edges[0]],
    }).ok,
    true,
  );
  assert.equal(
    validateLoopspaceGraphAstForUpdate(previousAst, {
      nodes: [
        { id: runScriptNode.id, kind: "loop", label: "Loop" },
        sendMessageNode,
      ],
      edges: [previousAst.edges[0]],
    }).ok,
    false,
  );
});

test("graph ast validation accepts document context edges to internal steps", () => {
  const validation = validateLoopspaceGraphAst({
    nodes: [sendMessageNode, documentReadNode, stepNode, documentWriteNode],
    edges: [
      {
        id: "edge-read-step",
        from: documentReadNode.id,
        fromPort: "docs",
        to: stepNode.id,
        toPort: "in",
      },
      {
        id: "edge-step-write",
        from: stepNode.id,
        fromPort: "docs",
        to: documentWriteNode.id,
        toPort: "in",
      },
    ],
  });

  assert.equal(validation.ok, true);
});

test("dfblueprint validation accepts document edges to hyphenated internal steps", () => {
  const source = `dfblueprint "Document step graph"
format diffforge.dfblueprint.v1
direction right
node "Send message" [id: send-message-mqruul0w-r330x, kind: send_message, role: action]
node "List docs" [id: step-mqruul0w-r330x, kind: step, role: checkpoint, parent_id: send-message-mqruul0w-r330x]
node "Read docs" [id: document-read-mqruul0w-r330x, kind: document_read, role: context]
node "Write docs" [id: document-write-mqruul0w-r330x, kind: document_write, role: context]
edge document-read-mqruul0w-r330x.docs -> step-mqruul0w-r330x.in [id: edge-read-step, branch: docs]
edge step-mqruul0w-r330x.docs -> document-write-mqruul0w-r330x.in [id: edge-step-write, branch: docs]
`;
  const validation = validateDfBlueprintSource(source);

  assert.equal(validation.ok, true, validation.errors.join("\n"));
});

test("dfblueprint validation accepts asset edges to hyphenated internal steps", () => {
  const source = `dfblueprint "Asset step graph"
format diffforge.dfblueprint.v1
direction right
node "Send message" [id: send-message-mqruul0w-r330x, kind: send_message, role: action]
node "Create assets" [id: step-mqruul0w-r330x, kind: step, role: checkpoint, parent_id: send-message-mqruul0w-r330x]
node "Read assets" [id: asset-read-mqruul0w-r330x, kind: asset_read, role: context]
node "Write assets" [id: asset-write-mqruul0w-r330x, kind: asset_write, role: context]
edge asset-read-mqruul0w-r330x.assets -> step-mqruul0w-r330x.in [id: edge-read-step, branch: assets]
edge step-mqruul0w-r330x.assets -> asset-write-mqruul0w-r330x.in [id: edge-step-write, branch: assets]
`;
  const validation = validateDfBlueprintSource(source);

  assert.equal(validation.ok, true, validation.errors.join("\n"));
});

test("dfblueprint validation accepts completed substep edges to actions", () => {
  const source = `dfblueprint "Completed step graph"
format diffforge.dfblueprint.v1
direction right
node "Send message" [id: send-message-mqruul0w-r330x, kind: send_message, role: action]
node "Create assets" [id: step-mqruul0w-r330x, kind: step, role: checkpoint, parent_id: send-message-mqruul0w-r330x]
node "Run script" [id: run-script-mqruul0w-r330x, kind: run_script, role: action]
node "Follow up" [id: send-message-follow-up, kind: send_message, role: action]
edge step-mqruul0w-r330x.success -> run-script-mqruul0w-r330x.in [id: edge-step-script, branch: success]
edge step-mqruul0w-r330x.success -> send-message-follow-up.in [id: edge-step-message, branch: success]
`;
  const validation = validateDfBlueprintSource(source);

  assert.equal(validation.ok, true, validation.errors.join("\n"));
});

test("dfblueprint validation rejects action execution branches to asset write", () => {
  const source = `dfblueprint "Invalid asset write branch"
format diffforge.dfblueprint.v1
direction right
node "Send message" [id: send-message-mqruul0w-r330x, kind: send_message, role: action]
node "Write assets" [id: asset-write-mqruul0w-r330x, kind: asset_write, role: context]
edge send-message-mqruul0w-r330x.exec -> asset-write-mqruul0w-r330x.in [id: edge-send-asset-write, branch: exec]
`;
  const validation = validateDfBlueprintSource(source);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /Asset write nodes/);
});

test("graph ast validation accepts asset context edges to internal steps", () => {
  const validation = validateLoopspaceGraphAst({
    nodes: [sendMessageNode, assetReadNode, stepNode, assetWriteNode],
    edges: [
      {
        id: "edge-asset-read-step",
        from: assetReadNode.id,
        fromPort: "assets",
        to: stepNode.id,
        toPort: "in",
      },
      {
        id: "edge-step-asset-write",
        from: stepNode.id,
        fromPort: "assets",
        to: assetWriteNode.id,
        toPort: "in",
      },
      {
        id: "edge-asset-write-next-step",
        from: assetWriteNode.id,
        fromPort: "assets",
        to: stepNode.id,
        toPort: "in",
      },
    ],
  });

  assert.equal(validation.ok, true);
});

test("graph ast validation rejects document context edges to orphan or non-message steps", () => {
  const orphanValidation = validateLoopspaceGraphAst({
    nodes: [documentReadNode, orphanStepNode, documentWriteNode],
    edges: [
      {
        id: "edge-read-orphan-step",
        from: documentReadNode.id,
        fromPort: "docs",
        to: orphanStepNode.id,
        toPort: "in",
      },
      {
        id: "edge-orphan-step-write",
        from: orphanStepNode.id,
        fromPort: "docs",
        to: documentWriteNode.id,
        toPort: "in",
      },
    ],
  });
  assert.equal(orphanValidation.ok, false);
  assert.match(orphanValidation.errors.join("\n"), /Internal send-message steps/);

  const wrongParentValidation = validateLoopspaceGraphAst({
    nodes: [runScriptNode, documentReadNode, wrongParentStepNode, documentWriteNode],
    edges: [
      {
        id: "edge-read-wrong-step",
        from: documentReadNode.id,
        fromPort: "docs",
        to: wrongParentStepNode.id,
        toPort: "in",
      },
      {
        id: "edge-wrong-step-write",
        from: wrongParentStepNode.id,
        fromPort: "docs",
        to: documentWriteNode.id,
        toPort: "in",
      },
    ],
  });
  assert.equal(wrongParentValidation.ok, false);
  assert.match(wrongParentValidation.errors.join("\n"), /Internal send-message steps/);

  const missingParentValidation = validateLoopspaceGraphAst({
    nodes: [documentReadNode, missingParentStepNode, documentWriteNode],
    edges: [
      {
        id: "edge-read-missing-parent-step",
        from: documentReadNode.id,
        fromPort: "docs",
        to: missingParentStepNode.id,
        toPort: "in",
      },
      {
        id: "edge-missing-parent-step-write",
        from: missingParentStepNode.id,
        fromPort: "docs",
        to: documentWriteNode.id,
        toPort: "in",
      },
    ],
  });
  assert.equal(missingParentValidation.ok, false);
  assert.match(missingParentValidation.errors.join("\n"), /Internal send-message steps/);
});

test("graph ast validation reports illegal ports with edge context", () => {
  const validation = validateLoopspaceGraphAst({
    nodes: [runScriptNode, sendMessageNode],
    edges: [{
      id: "edge-bad",
      from: runScriptNode.id,
      fromPort: "docs",
      to: sendMessageNode.id,
      toPort: "in",
    }],
  });

  assert.equal(validation.ok, false);
  assert.match(validation.errors[0], /edge-bad/);
  assert.match(validation.errors[0], /docs/);
});

test("graph patches do not create deprecated device nodes", () => {
  const patched = applyDfBlueprintPatchOperations("", [
    {
      op: "add_node",
      id: "device-local-mac",
      kind: "device",
      label: "Local Mac",
      device_id: "macos-1",
    },
    {
      op: "add_node",
      id: "send-message-added",
      kind: "send_message",
      label: "Send message",
    },
  ]);
  const ast = parseDfBlueprintSource(patched);

  assert.equal(ast.nodes.some((node) => node.kind === "device" || node.nodeKind === "device"), false);
  assert.equal(ast.nodes.some((node) => node.id === "send-message-added" && node.kind === "send_message"), true);
});

test("graph patches create dispatch todo nodes with targeting metadata", () => {
  const patched = applyDfBlueprintPatchOperations("", [
    {
      op: "add_node",
      id: "dispatch-qa",
      kind: "dispatch_todos",
      label: "Dispatch QA",
      target_workspace_ids: "workspace-a, workspace-b",
      target_terminal_id: "pane-1",
      todo_lines: "Audit login\nFix regression",
    },
  ]);
  const ast = parseDfBlueprintSource(patched);
  const node = ast.nodes.find((item) => item.id === "dispatch-qa");

  assert.equal(node?.kind, "dispatch_todos");
  assert.equal(node?.props?.target_workspace_ids, "workspace-a, workspace-b");
  assert.equal(node?.props?.target_terminal_id, "pane-1");
  assert.equal(node?.props?.todo_lines, "Audit login\nFix regression");
});

test("graph contract keeps legacy device nodes readable", () => {
  const validation = validateLoopspaceGraphAst({
    nodes: [{ id: "device-local-mac", kind: "device", label: "Local Mac" }],
    edges: [],
  });

  assert.equal(validation.ok, true);
});

test("graph contract owns action node visual gutters", () => {
  assert.deepEqual(loopspaceGraphVisualDefaultsForNode(runScriptNode), {
    height: 132,
    minHeight: 132,
    minWidth: 360,
    outputGutter: 112,
    sized: true,
    width: 360,
  });
  assert.equal(loopspaceGraphVisualDefaultsForNode(sendMessageNode).outputGutter, 92);
  assert.equal(loopspaceGraphVisualDefaultsForNode(sendMessageNode).width, 680);
  assert.deepEqual(loopspaceGraphVisualDefaultsForNode(dispatchTodosNode), {
    height: 178,
    minHeight: 178,
    minWidth: 420,
    outputGutter: 104,
    sized: true,
    width: 420,
  });
  assert.deepEqual(loopspaceGraphVisualDefaultsForNode(documentReadNode), {
    height: 128,
    minHeight: 128,
    minWidth: 270,
    sized: true,
    width: 270,
  });
  assert.deepEqual(loopspaceGraphVisualDefaultsForNode(assetReadNode), {
    height: 128,
    minHeight: 128,
    minWidth: 270,
    sized: true,
    width: 270,
  });
});

test("graph patches create asset resource nodes with generation metadata", () => {
  const patched = applyDfBlueprintPatchOperations("", [
    {
      op: "add_node",
      id: "generated-screenshot",
      kind: "asset_write",
      label: "Generated screenshot",
      create_name: "qa-homepage.png",
      asset_refs: "asset-previous",
      h: 196,
    },
  ]);
  const ast = parseDfBlueprintSource(patched);
  const node = ast.nodes.find((item) => item.id === "generated-screenshot");

  assert.equal(node?.kind, "asset_write");
  assert.equal(node?.props?.create_name, "qa-homepage.png");
  assert.equal(node?.props?.asset_refs, "asset-previous");
  assert.equal(node?.props?.target_mode, "capture_generated");
  assert.equal(node?.props?.h, "196");
});

test("graph patches update resource node metadata from top-level fields", () => {
  const source = applyDfBlueprintPatchOperations("", [
    {
      op: "add_node",
      id: "generated-doc",
      kind: "document_write",
      label: "Generated document",
    },
    {
      op: "add_node",
      id: "generated-asset",
      kind: "asset_write",
      label: "Generated asset",
    },
  ]);
  const patched = applyDfBlueprintPatchOperations(source, [
    {
      op: "update_node_props",
      id: "generated-doc",
      create_name: "brief.md",
      doc_refs: "doc-existing",
      h: 184,
      target_mode: "create_or_update",
    },
    {
      op: "update_node_props",
      id: "generated-asset",
      asset_refs: "asset-existing",
      create_name: "hero.png",
      height: 208,
      targetMode: "capture_generated",
    },
  ]);
  const ast = parseDfBlueprintSource(patched);
  const docNode = ast.nodes.find((node) => node.id === "generated-doc");
  const assetNode = ast.nodes.find((node) => node.id === "generated-asset");

  assert.equal(docNode?.props?.create_name, "brief.md");
  assert.equal(docNode?.props?.doc_refs, "doc-existing");
  assert.equal(docNode?.props?.h, "184");
  assert.equal(docNode?.props?.target_mode, "create_or_update");
  assert.equal(assetNode?.props?.asset_refs, "asset-existing");
  assert.equal(assetNode?.props?.create_name, "hero.png");
  assert.equal(assetNode?.props?.h, "208");
  assert.equal(assetNode?.props?.target_mode, "capture_generated");
});

test("graph patches preserve deterministic document write operation metadata", () => {
  const source = applyDfBlueprintPatchOperations("", [
    {
      op: "add_node",
      id: "webhook-log",
      kind: "document_write",
      label: "Webhook log",
      create_name: "Webhook Logs.md",
      operation: "append",
      content_template: "Payload: {{payload_json}}",
    },
  ]);
  const updated = applyDfBlueprintPatchOperations(source, [
    {
      op: "update_node_props",
      id: "webhook-log",
      document_operation: "replace",
      contentTemplate: "Latest: {{body_json}}",
    },
  ]);
  const ast = parseDfBlueprintSource(updated);
  const docNode = ast.nodes.find((node) => node.id === "webhook-log");

  assert.equal(docNode?.props?.create_name, "Webhook Logs.md");
  assert.equal(docNode?.props?.operation, "replace");
  assert.equal(docNode?.props?.content_template, "Latest: {{body_json}}");
});

test("graph patches preserve deterministic asset write operation metadata", () => {
  const source = applyDfBlueprintPatchOperations("", [
    {
      op: "add_node",
      id: "webhook-asset",
      kind: "asset_write",
      label: "Webhook asset",
      create_name: "payload.json",
      asset_operation: "create_if_missing",
      content_template: "{{payload_json}}",
    },
  ]);
  const updated = applyDfBlueprintPatchOperations(source, [
    {
      op: "update_node_props",
      id: "webhook-asset",
      assetOperation: "replace",
      contentTemplate: "Latest: {{body_json}}",
    },
  ]);
  const ast = parseDfBlueprintSource(updated);
  const assetNode = ast.nodes.find((node) => node.id === "webhook-asset");

  assert.equal(assetNode?.props?.create_name, "payload.json");
  assert.equal(assetNode?.props?.operation, "replace");
  assert.equal(assetNode?.props?.content_template, "Latest: {{body_json}}");
});
