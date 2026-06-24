import test from "node:test";
import assert from "node:assert/strict";

import {
  loopspaceGraphOutputPortsForNode,
  loopspaceGraphVisualDefaultsForNode,
  validateLoopspaceGraphAst,
  validateLoopspaceGraphAstForUpdate,
  validateLoopspaceGraphEdgeCandidate,
} from "./graphContract.js";

const triggerNode = { id: "trigger-1", kind: "trigger", label: "Kick" };
const runScriptNode = { id: "run-script-1", kind: "run_script", label: "Run script" };
const sendMessageNode = { id: "send-message-1", kind: "send_message", label: "Send message" };
const documentReadNode = { id: "doc-read-1", kind: "document_read", label: "Read docs" };
const documentWriteNode = { id: "doc-write-1", kind: "document_write", label: "Write docs" };

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
});
