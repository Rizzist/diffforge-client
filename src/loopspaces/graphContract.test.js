import test from "node:test";
import assert from "node:assert/strict";

import {
  loopspaceGraphOutputPortsForNode,
  loopspaceGraphVisualDefaultsForNode,
  validateLoopspaceGraphAst,
  validateLoopspaceGraphAstForUpdate,
  validateLoopspaceGraphEdgeCandidate,
} from "./graphContract.js";
import {
  applyDfBlueprintPatchOperations,
  parseDfBlueprintSource,
} from "./dfblueprint.js";

const triggerNode = { id: "trigger-1", kind: "trigger", label: "Kick" };
const runScriptNode = { id: "run-script-1", kind: "run_script", label: "Run script" };
const sendMessageNode = { id: "send-message-1", kind: "send_message", label: "Send message" };
const documentReadNode = { id: "doc-read-1", kind: "document_read", label: "Read docs" };
const documentWriteNode = { id: "doc-write-1", kind: "document_write", label: "Write docs" };
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

test("graph contract exposes execution branches for action nodes", () => {
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(runScriptNode).map((port) => port.id),
    ["exec", "success", "failure", "interrupt"],
  );
  assert.deepEqual(
    loopspaceGraphOutputPortsForNode(sendMessageNode).map((port) => port.id),
    ["exec", "success", "failure", "interrupt"],
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
});

test("graph contract accepts document context edges for send-message steps only", () => {
  const nodeById = new Map([
    [sendMessageNode.id, sendMessageNode],
    [runScriptNode.id, runScriptNode],
    [stepNode.id, stepNode],
    [orphanStepNode.id, orphanStepNode],
    [wrongParentStepNode.id, wrongParentStepNode],
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
    validateLoopspaceGraphEdgeCandidate(stepNode, sendMessageNode, {
      fromPort: "docs",
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
  assert.deepEqual(loopspaceGraphVisualDefaultsForNode(documentReadNode), {
    height: 128,
    minHeight: 128,
    minWidth: 270,
    sized: true,
    width: 270,
  });
});
