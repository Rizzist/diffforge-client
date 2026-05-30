import assert from "node:assert/strict";
import test from "node:test";

import { dimensionsForNode } from "./specGraphCore.js";
import { radialHierarchyLayout } from "./specGraphLayout.js";

function rectFor(layout, node) {
  const position = layout.get(node.id);
  const dimensions = dimensionsForNode(node);
  return {
    left: position.x,
    right: position.x + dimensions.width,
    top: position.y,
    bottom: position.y + dimensions.height,
  };
}

function overlaps(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

test("radialHierarchyLayout separates dense sibling nodes", () => {
  const root = {
    id: "workspace-root",
    node_type: "workspace",
    title: "Workspace",
  };
  const nodes = [
    root,
    ...Array.from({ length: 96 }, (_, index) => ({
      id: `file-${index}`,
      node_type: "file",
      title: `file-${index}.jsx`,
    })),
  ];
  const edges = nodes.slice(1).map((node) => ({
    id: `edge-${node.id}`,
    from: root.id,
    to: node.id,
    kind: "contains",
  }));

  const layout = radialHierarchyLayout(nodes, edges);

  for (const node of nodes) {
    assert.ok(layout.has(node.id), `${node.id} should have a layout position`);
  }

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      assert.equal(
        overlaps(rectFor(layout, left), rectFor(layout, right)),
        false,
        `${left.id} should not overlap ${right.id}`,
      );
    }
  }
});
