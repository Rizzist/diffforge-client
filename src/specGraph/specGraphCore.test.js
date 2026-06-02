import assert from "node:assert/strict";
import test from "node:test";

import {
  isCoreAppDirectoryNode,
  isLocalOnlyNode,
  mergeLocalIgnoredOverlay,
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

test("mergeLocalIgnoredOverlay attaches visible local-only nodes to the core workspace root", () => {
  const graph = normalizeSnapshot({
    specGraph: {
      nodes: [{
        id: "workspace-root",
        node_type: "workspace",
        title: "demo",
        metadata: {
          app_directory_location: true,
          core_app_directory: true,
          root: true,
          source: "filetree",
        },
      }],
      edges: [],
    },
  });

  const merged = mergeLocalIgnoredOverlay(graph, {
    cache_hit: true,
    nodes: [{
      id: "local-ignored-agents",
      type: "folder",
      title: ".agents",
      path: ".agents",
      metadata: {
        ignored_overlay: true,
        local_only: true,
        source: "local_ignored",
      },
    }, {
      id: "local-ignored-gitignore",
      type: "file",
      title: ".gitignore",
      path: ".gitignore",
      metadata: {
        ignored_overlay: true,
        local_only: true,
        source: "local_ignored",
      },
    }],
  }, true);

  assert.equal(merged.nodes.length, 3);
  assert.equal(merged.edges.length, 2);
  assert.equal(merged.graphStats.localIgnoredOverlayCount, 2);
  assert.equal(merged.graphStats.localIgnoredOverlayCacheHit, true);
  assert.equal(isCoreAppDirectoryNode(merged.nodes[0]), true);
  assert.equal(merged.nodes.slice(1).every(isLocalOnlyNode), true);
  assert.deepEqual(
    merged.edges.map((edge) => [edge.from, edge.to, edge.kind]),
    [
      ["workspace-root", "local-ignored-agents", "contains"],
      ["workspace-root", "local-ignored-gitignore", "contains"],
    ],
  );
});

test("normalizeSnapshot synthesizes core app metadata for sparse workspace roots", () => {
  const graph = normalizeSnapshot({
    repoPath: "/Users/rizzist/Documents/CODING/testforge",
    specGraph: {
      nodes: [{
        id: "workspace-root",
        node_type: "workspace",
        title: "testforge",
        path: "",
        file_source: "filetree",
        file_origin: "main",
      }],
      edges: [],
    },
  });
  const root = graph.nodes[0];

  assert.equal(isCoreAppDirectoryNode(root), true);
  assert.equal(root.app_directory_location, true);
  assert.equal(root.core_app_directory, true);
  assert.equal(root.metadata.app_directory_location, true);
  assert.equal(root.metadata.core_app_directory, true);
  assert.equal(root.metadata.directory_location, "/Users/rizzist/Documents/CODING/testforge");
  assert.equal(root.file_source, "filetree");
  assert.equal(root.file_origin, "main");
});
