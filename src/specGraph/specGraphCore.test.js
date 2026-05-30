import assert from "node:assert/strict";
import test from "node:test";

import {
  nodeProjectContext,
  normalizeSnapshot,
} from "./specGraphCore.js";

test("normalizeSnapshot preserves container project mounts", () => {
  const graph = normalizeSnapshot({
    containerWorkspace: true,
    projectMounts: [{
      mountId: "frontend",
      workspaceRelativePath: "frontend",
      projectRoot: "/workspace/frontend",
      projectName: "frontend",
      projectKind: "project",
      hasGit: false,
    }],
    specGraph: {
      nodes: [],
      edges: [],
      graph_stats: {},
    },
  });

  assert.equal(graph.containerWorkspace, true);
  assert.equal(graph.projectMounts.length, 1);
  assert.equal(graph.projectMounts[0].mount_id, "frontend");
  assert.equal(graph.projectMounts[0].project_root, "/workspace/frontend");
});

test("normalizeSnapshot preserves nested container mount metadata", () => {
  const graph = normalizeSnapshot({
    containerWorkspace: true,
    projectMounts: [{
      mountId: "product-a",
      mountKind: "container",
      projectKind: "container",
      workspaceRelativePath: "product-a",
    }, {
      mountId: "product-a/frontend",
      mountKind: "project",
      parentMountId: "product-a",
      projectKind: "project",
      workspaceRelativePath: "product-a/frontend",
    }],
    specGraph: {
      nodes: [],
      edges: [],
      graph_stats: {},
    },
  });

  assert.equal(graph.projectMounts.length, 2);
  assert.equal(graph.projectMounts[0].mount_kind, "container");
  assert.equal(graph.projectMounts[1].parent_mount_id, "product-a");
});

test("normalizeSnapshot promotes child routing metadata on mounted nodes", () => {
  const graph = normalizeSnapshot({
    repoPath: "/workspace",
    specGraph: {
      nodes: [{
        id: "mount-prefix-file-app",
        node_type: "file",
        title: "App",
        path: "frontend/src/App.jsx",
        mount_id: "frontend",
        project_root: "/workspace/frontend",
        project_relative_path: "src/App.jsx",
        visible_path: "frontend/src/App.jsx",
        source_repo_id: "repo-child",
        source_graph_cursor: "cursor-child",
        source_node_id: "file-app",
        source_node_hash: "hash-app",
      }],
      edges: [],
    },
  });
  const node = graph.nodes[0];
  const context = nodeProjectContext(node);

  assert.equal(node.mountId, "frontend");
  assert.equal(node.projectRoot, "/workspace/frontend");
  assert.equal(node.projectRelativePath, "src/App.jsx");
  assert.equal(context.containerNodeId, "mount-prefix-file-app");
  assert.equal(context.sourceGraphCursor, "cursor-child");
  assert.equal(context.sourceNodeId, "file-app");
  assert.equal(context.sourceNodeHash, "hash-app");
  assert.equal(context.sourceRepoId, "repo-child");
});
