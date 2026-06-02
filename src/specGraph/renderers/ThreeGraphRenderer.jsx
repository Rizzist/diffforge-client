import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import styled from "styled-components";
import {
  dimensionsForNode,
  isContainmentEdge,
  isCoreAppDirectoryNode,
  isLocalOnlyNode,
  isNoSpecNode,
  liveAgentsFor,
  nodeProjectContext,
  nodeKind,
  nodeSourceState,
  nodeSourceTone,
  nodeTone,
  text,
} from "../specGraphCore.js";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.85;
const MIN_RESTORED_ZOOM = 0.34;
const FIT_PADDING = 190;
const MAX_PIXEL_RATIO = 2;
const MAX_VISIBLE_AGENT_ORBITS = 6;
const DEFAULT_CAMERA_STATE = { x: 0, y: 0, zoom: 0.65 };
const MIN_READY_VIEWPORT_SIZE = 120;
const CAMERA_RESTORE_PADDING = 360;
const CAMERA_PAN_PADDING = 260;
const MAX_VISIBLE_LABELS = 1200;
const KIND_TONES = {
  workspace: "#2dd4bf",
  folder: "#a78bfa",
  file: "#60a5fa",
  abstract: "#c084fc",
};
const LIGHT_READABLE_TONES = {
  "#22c55e": "#0a7f45",
  "#34d399": "#047857",
  "#38bdf8": "#0066cc",
  "#60a5fa": "#0066cc",
  "#2dd4bf": "#0f766e",
  "#a78bfa": "#6d28d9",
  "#c084fc": "#7e22ce",
  "#f59e0b": "#8b5a00",
  "#fbbf24": "#8b5a00",
  "#fb923c": "#9a3412",
  "#fb7185": "#b42318",
  "#94a3b8": "#64748b",
  "#64748b": "#475569",
};
const PROJECT_GROUP_PADDING = {
  top: 64,
  right: 58,
  bottom: 48,
  left: 58,
};
const PROJECT_GROUP_MIN_SIZE = {
  width: 250,
  height: 180,
};
const PROJECT_GROUP_TONES = [
  "#14b8a6",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#22c55e",
  "#06b6d4",
  "#a855f7",
  "#e11d48",
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCameraState(value, fallback = null) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const zoom = Number(value?.zoom);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) {
    return fallback ? { ...fallback } : null;
  }
  return {
    x,
    y,
    zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

function colorWithAlpha(color, alpha) {
  return color?.startsWith("#") ? `${color}${alpha}` : color;
}

function lightReadableTone(color, fallback = "#0066cc") {
  const key = typeof color === "string" ? color.trim().toLowerCase() : "";
  return LIGHT_READABLE_TONES[key] || color || fallback;
}

function hexToRgb(hex, fallback = "#64748b") {
  const normalized = typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex.trim())
    ? hex.trim()
    : fallback;
  const value = Number.parseInt(normalized.slice(1), 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

function mixHex(left, right, amount) {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  const t = clamp(amount, 0, 1);
  const channel = (value) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${channel(a.r + (b.r - a.r) * t)}${channel(a.g + (b.g - a.g) * t)}${channel(a.b + (b.b - a.b) * t)}`;
}

function kindTone(kind) {
  return KIND_TONES[kind] || KIND_TONES.abstract;
}

function sourceLabel(sourceState) {
  switch (sourceState) {
    case "lease":
      return "lease";
    case "worktree":
      return "worktree";
    case "main":
      return "main";
    case "local":
      return "local";
    default:
      return "";
  }
}

function stableToneIndex(value) {
  const source = String(value || "");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % PROJECT_GROUP_TONES.length;
}

function safeLabelId(value) {
  return String(value || "project")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";
}

function pathLeaf(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

function pathHead(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] || "";
}

function projectGroupLabel(context, fallback) {
  return text(
    context.mountId
      || pathHead(context.visiblePath)
      || pathLeaf(context.projectRoot)
      || fallback,
    "Project",
  );
}

function projectGroupInfosForNode(node) {
  const context = nodeProjectContext(node);
  const mountId = text(context.mountId);
  if (mountId) {
    const parts = mountId
      .replace(/\\/g, "/")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return parts.map((_, index) => {
        const key = parts.slice(0, index + 1).join("/");
        return {
          key,
          label: key,
          projectRoot: index === parts.length - 1 ? context.projectRoot : "",
          visiblePath: key,
          workspaceRoot: context.workspaceRoot,
          depth: index + 1,
        };
      });
    }
  }
  const key = text(mountId || context.projectRoot || context.sourceRepoId);
  if (!key) return [];
  return [{
    key,
    label: projectGroupLabel(context, key),
    projectRoot: context.projectRoot,
    visiblePath: context.visiblePath,
    workspaceRoot: context.workspaceRoot,
    depth: 1,
  }];
}

function graphToScenePoint(point, z = 0) {
  return [point.x, -point.y, z];
}

function centerForNode(layout, node) {
  const dimensions = dimensionsForNode(node);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    x: position.x + dimensions.width / 2,
    y: position.y + dimensions.height / 2,
  };
}

function nodeRect(layout, node, padding = 0) {
  const dimensions = dimensionsForNode(node);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    left: position.x - padding,
    top: position.y - padding,
    right: position.x + dimensions.width + padding,
    bottom: position.y + dimensions.height + padding,
    width: dimensions.width + padding * 2,
    height: dimensions.height + padding * 2,
  };
}

function graphBounds(nodes, layout) {
  const laidOutNodes = nodes.filter((node) => layout.has(node.id));
  if (!laidOutNodes.length) return null;
  return laidOutNodes.reduce((bounds, node) => {
    const rect = nodeRect(layout, node);
    return {
      left: Math.min(bounds.left, rect.left),
      top: Math.min(bounds.top, rect.top),
      right: Math.max(bounds.right, rect.right),
      bottom: Math.max(bounds.bottom, rect.bottom),
    };
  }, {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  });
}

function viewportSizeIsReady(size) {
  return Number(size?.width || 0) >= MIN_READY_VIEWPORT_SIZE
    && Number(size?.height || 0) >= MIN_READY_VIEWPORT_SIZE;
}

function paddedBounds(bounds, padding) {
  if (!bounds) return null;
  return {
    left: bounds.left - padding,
    top: bounds.top - padding,
    right: bounds.right + padding,
    bottom: bounds.bottom + padding,
  };
}

function cameraWorldRect(cameraState, viewportSize) {
  const camera = normalizeCameraState(cameraState, null);
  if (!camera || !viewportSizeIsReady(viewportSize)) return null;
  const halfWidth = viewportSize.width / (2 * camera.zoom);
  const halfHeight = viewportSize.height / (2 * camera.zoom);
  return {
    left: camera.x - halfWidth,
    top: camera.y - halfHeight,
    right: camera.x + halfWidth,
    bottom: camera.y + halfHeight,
  };
}

function cameraIntersectsGraph(cameraState, bounds, viewportSize, padding = CAMERA_RESTORE_PADDING) {
  const visibleWorld = cameraWorldRect(cameraState, viewportSize);
  const targetBounds = paddedBounds(bounds, padding);
  return Boolean(visibleWorld && targetBounds && rectsIntersect(visibleWorld, targetBounds));
}

function cameraCenterInsideGraph(cameraState, bounds, padding = CAMERA_RESTORE_PADDING) {
  const camera = normalizeCameraState(cameraState, null);
  const targetBounds = paddedBounds(bounds, padding);
  return Boolean(
    camera
      && targetBounds
      && camera.x >= targetBounds.left
      && camera.x <= targetBounds.right
      && camera.y >= targetBounds.top
      && camera.y <= targetBounds.bottom,
  );
}

function cameraCanRestoreGraph(cameraState, bounds, viewportSize) {
  const camera = normalizeCameraState(cameraState, null);
  if (!camera || camera.zoom < MIN_RESTORED_ZOOM) return false;
  return cameraIntersectsGraph(camera, bounds, viewportSize, Math.min(CAMERA_RESTORE_PADDING, 120))
    && cameraCenterInsideGraph(camera, bounds, Math.min(CAMERA_RESTORE_PADDING, 160));
}

function clampCameraToGraph(cameraState, bounds, viewportSize) {
  const camera = normalizeCameraState(cameraState, DEFAULT_CAMERA_STATE);
  if (!bounds || !viewportSizeIsReady(viewportSize)) return camera;
  const padded = paddedBounds(bounds, CAMERA_PAN_PADDING);
  const halfWidth = viewportSize.width / (2 * camera.zoom);
  const halfHeight = viewportSize.height / (2 * camera.zoom);
  return {
    ...camera,
    x: clamp(camera.x, padded.left - halfWidth, padded.right + halfWidth),
    y: clamp(camera.y, padded.top - halfHeight, padded.bottom + halfHeight),
  };
}

function projectGroupsForNodes(nodes, layout, selectedNodeId) {
  const groups = new Map();
  nodes.forEach((node) => {
    if (!layout.has(node.id)) return;
    const groupInfos = projectGroupInfosForNode(node);
    if (!groupInfos.length) return;
    const rect = nodeRect(layout, node);
    groupInfos.forEach((groupInfo) => {
      const existing = groups.get(groupInfo.key) || {
        ...groupInfo,
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
        memberIds: [],
      };
      existing.left = Math.min(existing.left, rect.left);
      existing.top = Math.min(existing.top, rect.top);
      existing.right = Math.max(existing.right, rect.right);
      existing.bottom = Math.max(existing.bottom, rect.bottom);
      existing.memberIds.push(node.id);
      groups.set(groupInfo.key, existing);
    });
  });

  const projectGroups = [...groups.values()];
  if (projectGroups.length <= 1) return [];

  return projectGroups
    .sort((left, right) => (left.depth || 0) - (right.depth || 0) || left.label.localeCompare(right.label) || left.key.localeCompare(right.key))
    .map((group) => {
      const width = Math.max(
        PROJECT_GROUP_MIN_SIZE.width,
        group.right - group.left + PROJECT_GROUP_PADDING.left + PROJECT_GROUP_PADDING.right,
      );
      const height = Math.max(
        PROJECT_GROUP_MIN_SIZE.height,
        group.bottom - group.top + PROJECT_GROUP_PADDING.top + PROJECT_GROUP_PADDING.bottom,
      );
      const tone = PROJECT_GROUP_TONES[stableToneIndex(group.key)];
      return {
        ...group,
        id: `project-group-${safeLabelId(group.key)}`,
        left: group.left - PROJECT_GROUP_PADDING.left,
        top: group.top - PROJECT_GROUP_PADDING.top,
        width,
        height,
        tone,
        selected: group.memberIds.includes(selectedNodeId),
      };
    });
}

function boundaryPoint(layout, fromNode, toNode) {
  const from = centerForNode(layout, fromNode);
  const to = centerForNode(layout, toNode);
  const dimensions = dimensionsForNode(fromNode);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return from;
  if (nodeKind(fromNode) === "workspace") {
    const radius = Math.min(dimensions.width, dimensions.height) * 0.5;
    return {
      x: from.x + (dx / length) * radius,
      y: from.y + (dy / length) * radius,
    };
  }
  const scale = Math.min(
    Math.abs(dx) < 0.001 ? Number.POSITIVE_INFINITY : (dimensions.width / 2) / Math.abs(dx),
    Math.abs(dy) < 0.001 ? Number.POSITIVE_INFINITY : (dimensions.height / 2) / Math.abs(dy),
  );
  return {
    x: from.x + dx * scale,
    y: from.y + dy * scale,
  };
}

function edgeColor(edge, sourceNode, targetNode) {
  if ([sourceNode, targetNode].some((node) => node && isNoSpecNode(node))) return "#64748b";
  if (isContainmentEdge(edge)) return "#64748b";
  const abstractNode = [sourceNode, targetNode].find((node) => nodeKind(node) === "abstract");
  return abstractNode ? nodeTone(abstractNode) : nodeSourceTone(targetNode || sourceNode);
}

function nodeFillColor(node, active, hovered, theme) {
  const noSpec = isNoSpecNode(node);
  const coreApp = isCoreAppDirectoryNode(node);
  const sourceState = nodeSourceState(node);
  if (theme === "light") {
    if (coreApp) return active || hovered ? "#ccfbf1" : "#ecfeff";
    if (sourceState === "local") return active || hovered ? "#e2e8f0" : "#f1f5f9";
    if (noSpec) return "#f8fafc";
    if (active) return mixHex(lightReadableTone(nodeTone(node)), "#ffffff", 0.82);
    if (hovered) return mixHex(lightReadableTone(nodeSourceTone(node)), "#ffffff", 0.88);
    return mixHex(lightReadableTone(nodeTone(node)), "#ffffff", 0.94);
  }
  if (coreApp) {
    if (active) return "#12403f";
    if (hovered) return "#103a3c";
    return "#0c2f34";
  }
  if (noSpec) {
    if (sourceState === "local") {
      if (active) return "#263244";
      if (hovered) return "#223047";
      return "#1e293b";
    }
    if (active) return mixHex("#64748b", "#111827", 0.7);
    if (hovered) return mixHex("#64748b", "#0f172a", 0.74);
    return "#0f172a";
  }
  const base = mixHex(nodeTone(node), "#0b1220", 0.78);
  if (active) return mixHex(nodeTone(node), "#132238", 0.56);
  if (hovered) return mixHex(nodeSourceTone(node), "#111827", sourceState === "unknown" ? 0.82 : 0.64);
  if (sourceState === "local") return mixHex(base, "#020617", 0.3);
  return base;
}

function nodeBorderColor(node, active, hovered, theme) {
  if (isCoreAppDirectoryNode(node)) {
    const coreColor = active || hovered ? "#67e8f9" : "#2dd4bf";
    return theme === "light" ? lightReadableTone(coreColor) : coreColor;
  }
  if (nodeSourceState(node) === "local") {
    const localColor = active || hovered ? "#e2e8f0" : "#94a3b8";
    return theme === "light" ? lightReadableTone(localColor) : localColor;
  }
  if (isNoSpecNode(node)) {
    const noSpecColor = active || hovered ? "#94a3b8" : "#64748b";
    return theme === "light" ? lightReadableTone(noSpecColor) : noSpecColor;
  }
  const color = active
    ? nodeTone(node)
    : hovered
      ? nodeSourceTone(node)
      : nodeSourceState(node) !== "unknown"
        ? nodeSourceTone(node)
        : kindTone(nodeKind(node));
  return theme === "light" ? lightReadableTone(color) : color;
}

function setInstance(mesh, index, center, size, color, z = 0) {
  const matrix = new THREE.Matrix4();
  matrix.makeScale(size.width, size.height, 1);
  matrix.setPosition(center.x, -center.y, z);
  mesh.setMatrixAt(index, matrix);
  mesh.setColorAt(index, new THREE.Color(color));
}

function pushEdgeGeometry(target, source, targetPoint, color) {
  const rgb = hexToRgb(color);
  target.linePositions.push(...graphToScenePoint(source, -0.12), ...graphToScenePoint(targetPoint, -0.12));
  target.lineColors.push(rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b);

  const dx = targetPoint.x - source.x;
  const dy = targetPoint.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const arrowSize = target.containment ? 11 : 13;
  const arrowWidth = arrowSize * 0.52;
  const base = {
    x: targetPoint.x - ux * arrowSize,
    y: targetPoint.y - uy * arrowSize,
  };
  const left = { x: base.x + px * arrowWidth, y: base.y + py * arrowWidth };
  const right = { x: base.x - px * arrowWidth, y: base.y - py * arrowWidth };
  target.arrowPositions.push(...graphToScenePoint(targetPoint, 0.18), ...graphToScenePoint(left, 0.18), ...graphToScenePoint(right, 0.18));
  target.arrowColors.push(rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b);
}

function emptyEdgeAttributes(containment = false) {
  return {
    arrowColors: [],
    arrowPositions: [],
    containment,
    lineColors: [],
    linePositions: [],
  };
}

function lineAttributesForEdges(nodes, edges, layout, focusNodeId = "", theme = "dark") {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const base = emptyEdgeAttributes(false);
  const focused = emptyEdgeAttributes(false);

  edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.from);
    const targetNode = nodeById.get(edge.to);
    if (!sourceNode || !targetNode || !layout.has(sourceNode.id) || !layout.has(targetNode.id)) return;
    const source = boundaryPoint(layout, sourceNode, targetNode);
    const target = boundaryPoint(layout, targetNode, sourceNode);
    const rawColor = edgeColor(edge, sourceNode, targetNode);
    const color = theme === "light" ? lightReadableTone(rawColor) : rawColor;
    const bucket = focusNodeId && (edge.from === focusNodeId || edge.to === focusNodeId) ? focused : base;
    bucket.containment = isContainmentEdge(edge);
    pushEdgeGeometry(bucket, source, target, color);
  });

  return { base, focused };
}

function createColoredInstancedMesh(geometry, count, opacity = 1) {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthWrite: false,
    transparent: opacity < 1,
    opacity,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(0, count));
  mesh.frustumCulled = false;
  return mesh;
}

function groupBorderAttributes(projectGroups, theme) {
  const positions = [];
  const colors = [];
  projectGroups.forEach((group) => {
    const color = theme === "light" ? lightReadableTone(group.tone) : group.tone;
    const rgb = hexToRgb(color);
    const left = group.left;
    const right = group.left + group.width;
    const top = group.top;
    const bottom = group.top + group.height;
    const points = [
      [{ x: left, y: top }, { x: right, y: top }],
      [{ x: right, y: top }, { x: right, y: bottom }],
      [{ x: right, y: bottom }, { x: left, y: bottom }],
      [{ x: left, y: bottom }, { x: left, y: top }],
    ];
    points.forEach(([start, end]) => {
      positions.push(...graphToScenePoint(start, -0.68), ...graphToScenePoint(end, -0.68));
      colors.push(rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b);
    });
  });
  return { colors, positions };
}

function orbitRecordsForNodes(nodes, layout) {
  return nodes
    .filter((node) => layout.has(node.id))
    .flatMap((node) => {
      const liveAgents = liveAgentsFor(node);
      if (!liveAgents.length) return [];
      const dimensions = dimensionsForNode(node);
      const center = centerForNode(layout, node);
      return liveAgents.slice(0, MAX_VISIBLE_AGENT_ORBITS).map((agent, index) => ({
        id: `${node.id}-${text(agent?.agent_id || agent?.agentId || agent?.id || index)}`,
        center,
        color: nodeSourceTone(node),
        direction: index % 2 ? -1 : 1,
        index,
        radius: Math.max(dimensions.width, dimensions.height) / 2 + 12 + index * 5,
        size: 9,
        total: liveAgents.length,
      }));
    });
}

function orbitRingRecordsForNodes(nodes, layout) {
  return nodes
    .filter((node) => layout.has(node.id) && liveAgentsFor(node).length > 0)
    .map((node) => {
      const dimensions = dimensionsForNode(node);
      return {
        center: centerForNode(layout, node),
        color: nodeSourceTone(node),
        radius: Math.max(dimensions.width, dimensions.height) / 2 + 15,
      };
    });
}

function updateOrbitInstances(mesh, records, timestamp) {
  if (!mesh || !records.length) return;
  records.forEach((record, index) => {
    const spread = record.total > 1 ? ((index % 3) - 1) * 0.16 : 0;
    const speed = 0.95 + record.index * 0.12;
    const angle = record.direction * timestamp * 0.001 * speed
      + (record.index / Math.max(1, Math.min(record.total, MAX_VISIBLE_AGENT_ORBITS))) * Math.PI * 2
      + spread;
    setInstance(mesh, index, {
      x: record.center.x + Math.cos(angle) * record.radius,
      y: record.center.y + Math.sin(angle) * record.radius,
    }, { width: record.size, height: record.size }, record.color, 0.64);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

function screenToGraph(event, rect, cameraState) {
  return {
    x: cameraState.x + (event.clientX - rect.left - rect.width / 2) / cameraState.zoom,
    y: cameraState.y + (event.clientY - rect.top - rect.height / 2) / cameraState.zoom,
  };
}

function releasePointerCaptureSafely(element, pointerId) {
  if (!element || pointerId == null || typeof element.releasePointerCapture !== "function") return;
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    // The browser may already have released capture after a cancel/lost-capture path.
  }
}

function rectsIntersect(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

function visibleLabelIdsFor(nodes, layout, cameraState, viewportSize, selectedNodeId, hoveredNodeId) {
  if (!nodes.length || !viewportSize.width || !viewportSize.height) return new Set();
  const world = {
    left: cameraState.x - viewportSize.width / (2 * cameraState.zoom) - 140,
    right: cameraState.x + viewportSize.width / (2 * cameraState.zoom) + 140,
    top: cameraState.y - viewportSize.height / (2 * cameraState.zoom) - 140,
    bottom: cameraState.y + viewportSize.height / (2 * cameraState.zoom) + 140,
  };
  const center = { x: cameraState.x, y: cameraState.y };
  const candidates = nodes
    .filter((node) => layout.has(node.id))
    .filter((node) => rectsIntersect(nodeRect(layout, node, 22), world))
    .map((node) => {
      const nodeCenter = centerForNode(layout, node);
      const kind = nodeKind(node);
      const activityBoost = liveAgentsFor(node).length > 0 ? -42000 : 0;
      const warningBoost = Number(node.out_of_spec_count || node.notification_count) > 0 ? -30000 : 0;
      const priority = node.id === selectedNodeId
        ? -200000
        : node.id === hoveredNodeId
          ? -170000
          : kind === "workspace"
            ? -120000
            : kind === "folder"
              ? -26000
              : 0;
      return {
        id: node.id,
        priority: priority + activityBoost + warningBoost + Math.hypot(nodeCenter.x - center.x, nodeCenter.y - center.y),
      };
    })
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  const maxLabels = Math.min(candidates.length, MAX_VISIBLE_LABELS);
  const visibleIds = new Set(candidates.slice(0, maxLabels).map((item) => item.id));
  const candidateIds = new Set(candidates.map((item) => item.id));
  [selectedNodeId, hoveredNodeId].forEach((nodeId) => {
    if (nodeId && candidateIds.has(nodeId)) visibleIds.add(nodeId);
  });
  const anchoredNodeIds = nodes
    .filter((node) => layout.has(node.id))
    .filter((node) => node.id === selectedNodeId || node.id === hoveredNodeId || nodeKind(node) === "workspace" || isLocalOnlyNode(node))
    .map((node) => node.id);
  anchoredNodeIds.forEach((nodeId) => visibleIds.add(nodeId));
  return visibleIds;
}

function hitTestNode(nodes, layout, point) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!layout.has(node.id)) continue;
    const rect = nodeRect(layout, node, 8);
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue;
    if (nodeKind(node) === "workspace") {
      const center = centerForNode(layout, node);
      const dimensions = dimensionsForNode(node);
      if (Math.hypot(point.x - center.x, point.y - center.y) > Math.max(dimensions.width, dimensions.height) / 2 + 12) {
        continue;
      }
    }
    return node;
  }
  return null;
}

export default function ThreeGraphRenderer({
  nodes,
  edges,
  layout,
  layoutPending = false,
  selectedNodeId,
  onSelect,
  initialCameraState = null,
  onCameraChange = null,
  state,
  emptyLabel = "No spec graph nodes yet.",
  layoutLabel = "Laying out spec graph...",
  viewportCacheKey = "",
}) {
  const restoredInitialCamera = useMemo(
    () => normalizeCameraState(initialCameraState, null),
    [initialCameraState, viewportCacheKey],
  );
  const initialCamera = DEFAULT_CAMERA_STATE;
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const graphGroupRef = useRef(null);
  const orbitRef = useRef({ mesh: null, records: [] });
  const rafRef = useRef(0);
  const fitRetryRef = useRef({ frame: 0, timeout: 0, token: 0 });
  const dragRef = useRef(null);
  const interactedRef = useRef(false);
  const viewReadyRef = useRef(false);
  const activeGraphViewKeyRef = useRef("");
  const cameraStateRef = useRef(initialCamera);
  const layoutRef = useRef(layout || new Map());
  const nodesRef = useRef(nodes || []);
  const hoveredNodeIdRef = useRef("");
  const selectedNodeIdRef = useRef(selectedNodeId);
  const viewportSizeRef = useRef({ width: 0, height: 0 });
  const [cameraState, setCameraState] = useState(cameraStateRef.current);
  const [theme, setTheme] = useState(() => (
    typeof document === "undefined"
      ? "dark"
      : document.documentElement.dataset.forgeTheme === "light"
        ? "light"
        : "dark"
  ));
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [visibleLabelIds, setVisibleLabelIds] = useState(() => new Set());
  const activeLayout = layout || new Map();
  const projectGroups = useMemo(
    () => projectGroupsForNodes(nodes, activeLayout, selectedNodeId),
    [activeLayout, nodes, selectedNodeId],
  );
  const liveOrbitCount = useMemo(
    () => nodes.reduce((count, node) => count + Math.min(MAX_VISIBLE_AGENT_ORBITS, liveAgentsFor(node).length), 0),
    [nodes],
  );
  hoveredNodeIdRef.current = hoveredNodeId;
  selectedNodeIdRef.current = selectedNodeId;
  viewportSizeRef.current = viewportSize;
  const graphKey = useMemo(() => {
    const nodeKey = nodes
      .map((node) => {
        const position = activeLayout.get(node.id) || { x: 0, y: 0 };
        return `${node.id}:${Math.round(position.x)},${Math.round(position.y)}`;
      })
      .sort()
      .join("|");
    const edgeKey = edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind || ""}`).sort().join("|");
    return `${nodeKey}::${edgeKey}`;
  }, [activeLayout, edges, nodes]);
  const graphViewKey = useMemo(
    () => `${viewportCacheKey || "spec-graph"}::${graphKey}`,
    [graphKey, viewportCacheKey],
  );

  useLayoutEffect(() => {
    if (activeGraphViewKeyRef.current === graphViewKey) return;
    activeGraphViewKeyRef.current = graphViewKey;
    viewReadyRef.current = false;
    interactedRef.current = false;
  }, [graphViewKey]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const readTheme = () => {
      setTheme(root.dataset.forgeTheme === "light" ? "light" : "dark");
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-forge-theme"] });
    return () => observer.disconnect();
  }, []);

  const scheduleRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const frame = containerRef.current?.getBoundingClientRect();
      if (!renderer || !scene || !camera || !frame?.width || !frame?.height) return;
      const { x, y, zoom } = cameraStateRef.current;
      camera.left = -frame.width / (2 * zoom);
      camera.right = frame.width / (2 * zoom);
      camera.top = frame.height / (2 * zoom);
      camera.bottom = -frame.height / (2 * zoom);
      camera.position.set(x, -y, 1000);
      camera.lookAt(x, -y, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
  }, []);

  const updateVisibleLabels = useCallback((nextCameraState = cameraStateRef.current, nextSize = viewportSizeRef.current) => {
    setVisibleLabelIds(visibleLabelIdsFor(
      nodesRef.current,
      layoutRef.current,
      nextCameraState,
      nextSize,
      selectedNodeIdRef.current,
      hoveredNodeIdRef.current,
    ));
  }, []);

  const setCamera = useCallback((nextCameraState, options = {}) => {
    const persist = options.persist !== false;
    const shouldConstrain = options.constrain !== false;
    const bounds = graphBounds(nodesRef.current, layoutRef.current);
    const next = shouldConstrain
      ? clampCameraToGraph(nextCameraState, bounds, viewportSizeRef.current)
      : normalizeCameraState(nextCameraState, DEFAULT_CAMERA_STATE);
    cameraStateRef.current = next;
    setCameraState(next);
    updateVisibleLabels(next);
    if (
      persist
      && typeof onCameraChange === "function"
      && cameraIntersectsGraph(next, bounds, viewportSizeRef.current)
    ) {
      onCameraChange(next);
    }
    scheduleRender();
  }, [onCameraChange, scheduleRender, updateVisibleLabels]);

  const fitGraph = useCallback(() => {
    const frame = containerRef.current?.getBoundingClientRect();
    const bounds = graphBounds(nodesRef.current, layoutRef.current);
    if (!viewportSizeIsReady(frame) || !bounds) return false;
    const width = Math.max(1, bounds.right - bounds.left + FIT_PADDING * 2);
    const height = Math.max(1, bounds.bottom - bounds.top + FIT_PADDING * 2);
    const minFitZoom = nodesRef.current.length <= 8 ? MIN_RESTORED_ZOOM : MIN_ZOOM;
    const zoom = clamp(Math.min(frame.width / width, frame.height / height), minFitZoom, 1.08);
    viewReadyRef.current = true;
    setCamera({
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
      zoom,
    }, { constrain: false });
    return true;
  }, [setCamera]);

  const cancelScheduledFit = useCallback(() => {
    const pending = fitRetryRef.current;
    pending.token += 1;
    if (pending.frame) {
      window.cancelAnimationFrame(pending.frame);
      pending.frame = 0;
    }
    if (pending.timeout) {
      window.clearTimeout(pending.timeout);
      pending.timeout = 0;
    }
  }, []);

  const scheduleFitGraph = useCallback(({ attempts = 10, force = false } = {}) => {
    if (dragRef.current) return;
    if (!force && interactedRef.current) return;
    cancelScheduledFit();
    const token = fitRetryRef.current.token;
    const runAttempt = (remaining) => {
      fitRetryRef.current.frame = window.requestAnimationFrame(() => {
        fitRetryRef.current.frame = 0;
        if (fitRetryRef.current.token !== token) return;
        if (dragRef.current) return;
        if (!force && interactedRef.current) return;
        if (fitGraph() || remaining <= 0) return;
        fitRetryRef.current.timeout = window.setTimeout(() => {
          fitRetryRef.current.timeout = 0;
          if (fitRetryRef.current.token === token) runAttempt(remaining - 1);
        }, 48);
      });
    };
    runAttempt(Math.max(0, attempts));
  }, [cancelScheduledFit, fitGraph]);

  const handleFitGraph = useCallback(() => {
    interactedRef.current = false;
    scheduleFitGraph({ attempts: 6, force: true });
  }, [scheduleFitGraph]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;

    return () => {
      cancelScheduledFit();
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      scene.children.forEach(disposeObject);
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      graphGroupRef.current = null;
    };
  }, [cancelScheduledFit]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const canvas = renderer?.domElement;
    if (!canvas) return undefined;
    const handleContextLost = (event) => {
      event.preventDefault();
    };
    const handleContextRestored = () => {
      scheduleFitGraph({ attempts: 6 });
      scheduleRender();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, [scheduleFitGraph, scheduleRender]);

  useEffect(() => {
    const handleResume = () => {
      scheduleRender();
      scheduleFitGraph({ attempts: 6 });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") handleResume();
    };
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [scheduleFitGraph, scheduleRender]);

  useEffect(() => {
    const container = containerRef.current;
    const renderer = rendererRef.current;
    if (!container || !renderer) return undefined;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      const nextSize = { width, height };
      viewportSizeRef.current = nextSize;
      setViewportSize(nextSize);
      updateVisibleLabels(cameraStateRef.current, nextSize);
      scheduleFitGraph({ attempts: 8 });
      scheduleRender();
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleFitGraph, scheduleRender, updateVisibleLabels]);

  useLayoutEffect(() => {
    nodesRef.current = nodes;
    layoutRef.current = activeLayout;
  }, [activeLayout, nodes]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    if (graphGroupRef.current) {
      scene.remove(graphGroupRef.current);
      disposeObject(graphGroupRef.current);
    }
    const group = new THREE.Group();
    group.renderOrder = 1;
    graphGroupRef.current = group;
    scene.add(group);

    const borderRectNodes = nodes.filter((node) => nodeKind(node) !== "workspace" && activeLayout.has(node.id));
    const workspaceNodes = nodes.filter((node) => nodeKind(node) === "workspace" && activeLayout.has(node.id));
    const rectGeometry = new THREE.PlaneGeometry(1, 1);
    const circleGeometry = new THREE.CircleGeometry(0.5, 64);

    const groupFill = createColoredInstancedMesh(rectGeometry, projectGroups.length, theme === "light" ? 0.08 : 0.12);
    projectGroups.forEach((projectGroup, index) => {
      setInstance(groupFill, index, {
        x: projectGroup.left + projectGroup.width / 2,
        y: projectGroup.top + projectGroup.height / 2,
      }, {
        width: projectGroup.width,
        height: projectGroup.height,
      }, theme === "light" ? lightReadableTone(projectGroup.tone) : projectGroup.tone, -0.72);
    });
    groupFill.instanceMatrix.needsUpdate = true;
    if (groupFill.instanceColor) groupFill.instanceColor.needsUpdate = true;
    group.add(groupFill);

    const groupBorders = groupBorderAttributes(projectGroups, theme);
    const groupBorderGeometry = new THREE.BufferGeometry();
    groupBorderGeometry.setAttribute("position", new THREE.Float32BufferAttribute(groupBorders.positions, 3));
    groupBorderGeometry.setAttribute("color", new THREE.Float32BufferAttribute(groupBorders.colors, 3));
    group.add(new THREE.LineSegments(groupBorderGeometry, new THREE.LineBasicMaterial({
      depthWrite: false,
      opacity: theme === "light" ? 0.28 : 0.44,
      transparent: true,
      vertexColors: true,
    })));

    const rectBorder = createColoredInstancedMesh(rectGeometry, borderRectNodes.length, 0.92);
    const rectFill = createColoredInstancedMesh(rectGeometry.clone(), borderRectNodes.length, 0.96);
    borderRectNodes.forEach((node, index) => {
      const dimensions = dimensionsForNode(node);
      const position = activeLayout.get(node.id);
      const active = node.id === selectedNodeId;
      const hovered = node.id === hoveredNodeId;
      const center = { x: position.x + dimensions.width / 2, y: position.y + dimensions.height / 2 };
      const borderPad = active ? 14 : hovered ? 10 : 7;
      setInstance(rectBorder, index, center, {
        width: dimensions.width + borderPad * 2,
        height: dimensions.height + borderPad * 2,
      }, nodeBorderColor(node, active, hovered, theme), 0.02);
      setInstance(rectFill, index, center, dimensions, nodeFillColor(node, active, hovered, theme), 0.12);
    });
    rectBorder.instanceMatrix.needsUpdate = true;
    rectFill.instanceMatrix.needsUpdate = true;
    if (rectBorder.instanceColor) rectBorder.instanceColor.needsUpdate = true;
    if (rectFill.instanceColor) rectFill.instanceColor.needsUpdate = true;
    group.add(rectBorder, rectFill);

    const workspaceBorder = createColoredInstancedMesh(circleGeometry, workspaceNodes.length, 0.88);
    const workspaceFill = createColoredInstancedMesh(circleGeometry.clone(), workspaceNodes.length, 0.94);
    workspaceNodes.forEach((node, index) => {
      const dimensions = dimensionsForNode(node);
      const position = activeLayout.get(node.id);
      const active = node.id === selectedNodeId;
      const hovered = node.id === hoveredNodeId;
      const center = { x: position.x + dimensions.width / 2, y: position.y + dimensions.height / 2 };
      const borderPad = active ? 24 : hovered ? 17 : 11;
      setInstance(workspaceBorder, index, center, {
        width: dimensions.width + borderPad * 2,
        height: dimensions.height + borderPad * 2,
      }, nodeBorderColor(node, active, hovered, theme), 0.01);
      setInstance(workspaceFill, index, center, dimensions, nodeFillColor(node, active, hovered, theme), 0.14);
    });
    workspaceBorder.instanceMatrix.needsUpdate = true;
    workspaceFill.instanceMatrix.needsUpdate = true;
    if (workspaceBorder.instanceColor) workspaceBorder.instanceColor.needsUpdate = true;
    if (workspaceFill.instanceColor) workspaceFill.instanceColor.needsUpdate = true;
    group.add(workspaceBorder, workspaceFill);

    const accentNodes = nodes.filter((node) => activeLayout.has(node.id) && nodeSourceState(node) !== "unknown");
    const accentMesh = createColoredInstancedMesh(new THREE.PlaneGeometry(1, 1), accentNodes.length, 0.92);
    accentNodes.forEach((node, index) => {
      const dimensions = dimensionsForNode(node);
      const position = activeLayout.get(node.id);
      const kind = nodeKind(node);
      const center = kind === "file"
        ? { x: position.x + 2.5, y: position.y + dimensions.height / 2 }
        : kind === "folder"
          ? { x: position.x + dimensions.width / 2, y: position.y + dimensions.height - 7 }
          : kind === "abstract"
            ? { x: position.x + dimensions.width - 22, y: position.y + dimensions.height - 15 }
            : { x: position.x + dimensions.width / 2, y: position.y + 11 };
      const size = kind === "file"
        ? { width: 5, height: Math.max(12, dimensions.height - 26) }
        : kind === "folder"
          ? { width: Math.max(34, dimensions.width - 22), height: 3 }
          : kind === "abstract"
            ? { width: 28, height: 3 }
            : { width: Math.max(62, dimensions.width - 42), height: 3 };
      const accentColor = isNoSpecNode(node) ? "#64748b" : nodeSourceTone(node);
      setInstance(accentMesh, index, center, size, theme === "light" ? lightReadableTone(accentColor) : accentColor, 0.3);
    });
    accentMesh.instanceMatrix.needsUpdate = true;
    if (accentMesh.instanceColor) accentMesh.instanceColor.needsUpdate = true;
    group.add(accentMesh);

    const focusNodeId = hoveredNodeId || selectedNodeId || "";
    const { base, focused } = lineAttributesForEdges(nodes, edges, activeLayout, focusNodeId, theme);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(base.linePositions, 3));
    lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(base.lineColors, 3));
    const lineMaterial = new THREE.LineBasicMaterial({
      depthWrite: false,
      opacity: focusNodeId ? 0.24 : edges.length > 180 ? 0.38 : edges.length > 80 ? 0.5 : 0.66,
      transparent: true,
      vertexColors: true,
    });
    group.add(new THREE.LineSegments(lineGeometry, lineMaterial));

    const arrowGeometry = new THREE.BufferGeometry();
    arrowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(base.arrowPositions, 3));
    arrowGeometry.setAttribute("color", new THREE.Float32BufferAttribute(base.arrowColors, 3));
    const arrowMaterial = new THREE.MeshBasicMaterial({
      depthWrite: false,
      opacity: focusNodeId ? 0.22 : edges.length > 180 ? 0.42 : 0.7,
      side: THREE.DoubleSide,
      transparent: true,
      vertexColors: true,
    });
    group.add(new THREE.Mesh(arrowGeometry, arrowMaterial));

    if (focused.linePositions.length) {
      const focusLineGeometry = new THREE.BufferGeometry();
      focusLineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(focused.linePositions, 3));
      focusLineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(focused.lineColors, 3));
      group.add(new THREE.LineSegments(focusLineGeometry, new THREE.LineBasicMaterial({
        depthWrite: false,
        opacity: 0.96,
        transparent: true,
        vertexColors: true,
      })));

      const focusArrowGeometry = new THREE.BufferGeometry();
      focusArrowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(focused.arrowPositions, 3));
      focusArrowGeometry.setAttribute("color", new THREE.Float32BufferAttribute(focused.arrowColors, 3));
      group.add(new THREE.Mesh(focusArrowGeometry, new THREE.MeshBasicMaterial({
        depthWrite: false,
        opacity: 0.96,
        side: THREE.DoubleSide,
        transparent: true,
        vertexColors: true,
      })));
    }

    const orbitRings = orbitRingRecordsForNodes(nodes, activeLayout);
    const orbitRingMesh = createColoredInstancedMesh(new THREE.RingGeometry(0.47, 0.5, 48), orbitRings.length, theme === "light" ? 0.18 : 0.26);
    orbitRings.forEach((record, index) => {
      setInstance(orbitRingMesh, index, record.center, {
        width: record.radius * 2,
        height: record.radius * 2,
      }, theme === "light" ? lightReadableTone(record.color) : record.color, 0.52);
    });
    orbitRingMesh.instanceMatrix.needsUpdate = true;
    if (orbitRingMesh.instanceColor) orbitRingMesh.instanceColor.needsUpdate = true;
    group.add(orbitRingMesh);

    const orbitRecords = orbitRecordsForNodes(nodes, activeLayout);
    const orbitMesh = createColoredInstancedMesh(new THREE.CircleGeometry(0.5, 18), orbitRecords.length, 0.96);
    updateOrbitInstances(orbitMesh, orbitRecords, performance.now());
    group.add(orbitMesh);
    orbitRef.current = { mesh: orbitMesh, records: orbitRecords };

    scheduleRender();
    return undefined;
  }, [activeLayout, edges, hoveredNodeId, nodes, projectGroups, scheduleRender, selectedNodeId, theme]);

  useEffect(() => {
    const currentViewKey = activeGraphViewKeyRef.current;
    const bounds = graphBounds(nodesRef.current, layoutRef.current);
    const size = viewportSizeRef.current;
    if (!nodesRef.current.length || !bounds || !viewportSizeIsReady(size)) {
      return undefined;
    }

    if (!viewReadyRef.current) {
      const restoreCandidate = cameraCanRestoreGraph(restoredInitialCamera, bounds, size)
        ? restoredInitialCamera
        : null;

      if (restoreCandidate) {
        cancelScheduledFit();
        interactedRef.current = true;
        viewReadyRef.current = true;
        setCamera(restoreCandidate);
      } else {
        interactedRef.current = false;
        scheduleFitGraph({ attempts: 18, force: true });
      }
    } else if (!interactedRef.current) {
      scheduleFitGraph({ attempts: 6, force: true });
    }

    const transitionFitId = window.setTimeout(() => {
      if (activeGraphViewKeyRef.current !== currentViewKey) return;
      if (!viewReadyRef.current || !interactedRef.current) {
        scheduleFitGraph({ attempts: 6, force: !interactedRef.current });
      }
    }, 260);

    return () => {
      window.clearTimeout(transitionFitId);
    };
  }, [
    activeLayout,
    cancelScheduledFit,
    graphViewKey,
    restoredInitialCamera,
    scheduleFitGraph,
    setCamera,
    viewportSize.height,
    viewportSize.width,
  ]);

  useEffect(() => {
    if (!liveOrbitCount) return undefined;
    let cancelled = false;
    let frame = 0;
    const tick = (timestamp) => {
      if (cancelled) return;
      const orbit = orbitRef.current;
      if (orbit?.mesh && orbit.records.length) {
        updateOrbitInstances(orbit.mesh, orbit.records, timestamp);
        scheduleRender();
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [graphKey, liveOrbitCount, scheduleRender]);

  useEffect(() => {
    updateVisibleLabels();
    scheduleRender();
  }, [hoveredNodeId, scheduleRender, selectedNodeId, updateVisibleLabels]);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bounds = graphBounds(nodesRef.current, layoutRef.current);
    if (!viewReadyRef.current || !viewportSizeIsReady(rect) || !bounds) {
      scheduleFitGraph({ attempts: 8, force: true });
      return;
    }
    cancelScheduledFit();
    interactedRef.current = true;
    const current = cameraStateRef.current;
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    const nextZoom = clamp(current.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);
    const graphPoint = screenToGraph(event, rect, current);
    setCamera({
      x: graphPoint.x - (event.clientX - rect.left - rect.width / 2) / nextZoom,
      y: graphPoint.y - (event.clientY - rect.top - rect.height / 2) / nextZoom,
      zoom: nextZoom,
    });
  }, [cancelScheduledFit, scheduleFitGraph, setCamera]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bounds = graphBounds(nodesRef.current, layoutRef.current);
    if (!viewReadyRef.current || !viewportSizeIsReady(rect) || !bounds) {
      scheduleFitGraph({ attempts: 8, force: true });
      return;
    }
    cancelScheduledFit();
    interactedRef.current = true;
    containerRef.current?.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      camera: cameraStateRef.current,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }, [cancelScheduledFit, scheduleFitGraph]);

  const clearDrag = useCallback((pointerId = null) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (pointerId != null && drag.pointerId !== pointerId) return;
    releasePointerCaptureSafely(containerRef.current, drag.pointerId);
    dragRef.current = null;
  }, []);

  const handlePointerMove = useCallback((event) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      if (!viewReadyRef.current) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) {
        interactedRef.current = true;
        setCamera({
          x: drag.camera.x - dx / drag.camera.zoom,
          y: drag.camera.y - dy / drag.camera.zoom,
          zoom: drag.camera.zoom,
        });
      }
      return;
    }
    const hovered = hitTestNode(nodesRef.current, layoutRef.current, screenToGraph(event, rect, cameraStateRef.current));
    setHoveredNodeId(hovered?.id || "");
  }, [setCamera]);

  const handlePointerUp = useCallback((event) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const drag = dragRef.current;
    dragRef.current = null;
    releasePointerCaptureSafely(containerRef.current, event.pointerId);
    if (!rect || drag?.moved) return;
    const hit = hitTestNode(nodesRef.current, layoutRef.current, screenToGraph(event, rect, cameraStateRef.current));
    if (hit) onSelect(hit.id);
  }, [onSelect]);

  const handlePointerCancel = useCallback((event) => {
    clearDrag(event.pointerId);
  }, [clearDrag]);

  useEffect(() => {
    const handleWindowPointerEnd = (event) => clearDrag(event.pointerId);
    const handleWindowBlur = () => clearDrag();
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [clearDrag]);

  const visibleNodes = useMemo(
    () => nodes.filter((node) => visibleLabelIds.has(node.id) && activeLayout.has(node.id)),
    [activeLayout, nodes, visibleLabelIds],
  );

  if (!nodes.length) {
    const isSyncing = ["loading", "syncing"].includes(state);
    return <EmptyState>{isSyncing ? "Syncing graph..." : emptyLabel}</EmptyState>;
  }

  if (layoutPending && !activeLayout.size) {
    return <EmptyState>{layoutLabel}</EmptyState>;
  }

  if (!activeLayout.size) {
    return <EmptyState>{layoutLabel}</EmptyState>;
  }

  return (
    <ThreeFrame
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoveredNodeId("")}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onWheel={handleWheel}
    >
      <GraphGrid aria-hidden="true" />
      <LabelLayer aria-hidden={cameraState.zoom < 0.22 ? "true" : "false"}>
        {cameraState.zoom >= 0.2 && projectGroups.map((projectGroup) => {
          const screenX = (projectGroup.left - cameraState.x) * cameraState.zoom + viewportSize.width / 2;
          const screenY = (projectGroup.top - cameraState.y) * cameraState.zoom + viewportSize.height / 2;
          return (
            <ProjectGroupLabel
              key={projectGroup.id}
              style={{
                transform: `translate3d(${screenX}px, ${screenY}px, 0) scale(${cameraState.zoom})`,
                width: projectGroup.width,
              }}
              $selected={projectGroup.selected}
              $tone={projectGroup.tone}
            >
              <ProjectGroupLabelText title={projectGroup.label}>{projectGroup.label}</ProjectGroupLabelText>
              <ProjectGroupCount>{projectGroup.memberIds.length}</ProjectGroupCount>
            </ProjectGroupLabel>
          );
        })}
        {visibleNodes.map((node) => {
          const position = activeLayout.get(node.id) || { x: 0, y: 0 };
          const dimensions = dimensionsForNode(node);
          const screenX = (position.x - cameraState.x) * cameraState.zoom + viewportSize.width / 2;
          const screenY = (position.y - cameraState.y) * cameraState.zoom + viewportSize.height / 2;
          return (
            <NodeLabel
              key={node.id}
              node={node}
              compact={cameraState.zoom < 0.52}
              selected={node.id === selectedNodeId}
              style={{
                height: dimensions.height,
                transform: `translate3d(${screenX}px, ${screenY}px, 0) scale(${cameraState.zoom})`,
                width: dimensions.width,
              }}
              onSelect={onSelect}
            />
          );
        })}
      </LabelLayer>
      <ThreeControls onPointerDown={(event) => event.stopPropagation()}>
        <ControlButton type="button" title="Fit graph" onClick={handleFitGraph}>
          Fit
        </ControlButton>
      </ThreeControls>
    </ThreeFrame>
  );
}

function NodeLabel({ compact, node, onSelect, selected, style }) {
  const kind = nodeKind(node);
  const sourceState = nodeSourceState(node);
  const source = sourceLabel(sourceState);
  const nodeKindTone = kindTone(kind);
  const liveCount = liveAgentsFor(node).length;
  const outOfSpecCount = Number(node.out_of_spec_count || node.notification_count) || 0;
  const title = text(node.display_title || node.displayTitle || node.title);
  const path = text(node.display_path || node.displayPath || node.path);
  const noSpec = isNoSpecNode(node);
  const localOnly = isLocalOnlyNode(node);
  const coreApp = isCoreAppDirectoryNode(node);
  const metaLabel = coreApp ? "core app dir" : localOnly ? "local only" : noSpec ? "no spec" : kind;

  return (
    <LabelCard
      type="button"
      title={[title, path].filter(Boolean).join("\n")}
      style={style}
      $compact={compact}
      $kind={kind}
      $kindTone={nodeKindTone}
      $live={liveCount > 0}
      $localOnly={localOnly}
      $noSpec={noSpec}
      $selected={selected}
      $sourceState={sourceState}
      $sourceTone={nodeSourceTone(node)}
      $statusTone={nodeTone(node)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <SourceAccent
        aria-hidden="true"
        $kind={kind}
        $localOnly={localOnly}
        $noSpec={noSpec}
        $sourceState={sourceState}
        $sourceTone={nodeSourceTone(node)}
      />
      {liveCount > 0 && <LabelBadge>{liveCount}</LabelBadge>}
      {outOfSpecCount > 0 && <OutOfSpecBadge title={`${outOfSpecCount} out of spec`}>{outOfSpecCount}</OutOfSpecBadge>}
      <LabelMeta $kind={kind} $localOnly={localOnly} $noSpec={noSpec} $statusTone={nodeTone(node)}>
        {metaLabel}
        {!compact && source && kind !== "folder" && (!noSpec || localOnly) ? <LabelSource $sourceTone={nodeSourceTone(node)}>{source}</LabelSource> : null}
      </LabelMeta>
      <LabelTitle $kind={kind} $localOnly={localOnly} $noSpec={noSpec}>{title}</LabelTitle>
      {!compact && path && kind === "file" ? <LabelPath>{path}</LabelPath> : null}
    </LabelCard>
  );
}

const ThreeFrame = styled.div`
  background: rgba(3, 6, 11, 0.62);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
  touch-action: none;

  canvas {
    cursor: grab;
    inset: 0;
    position: absolute;
    z-index: 2;
  }

  &:active canvas {
    cursor: grabbing;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const GraphGrid = styled.div`
  background-image:
    radial-gradient(circle, rgba(148, 163, 184, 0.13) 1px, transparent 1px),
    linear-gradient(rgba(148, 163, 184, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.05) 1px, transparent 1px);
  background-position: center;
  background-size: 28px 28px, 112px 112px, 112px 112px;
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 1;

  html[data-forge-theme="light"] & {
    background-image:
      radial-gradient(circle, rgba(30, 41, 59, 0.12) 1px, transparent 1px),
      linear-gradient(rgba(30, 41, 59, 0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(30, 41, 59, 0.04) 1px, transparent 1px);
  }
`;

const LabelLayer = styled.div`
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 3;
`;

const ProjectGroupLabel = styled.div`
  align-items: center;
  background: ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "20")};
  border: 1px solid ${({ $selected, $tone }) => colorWithAlpha($tone || "#14b8a6", $selected ? "aa" : "5c")};
  border-radius: 999px;
  color: ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "f2")};
  display: inline-flex;
  gap: 7px;
  left: 0;
  max-width: 100%;
  min-width: 0;
  padding: 5px 8px 5px 10px;
  pointer-events: none;
  position: absolute;
  top: 0;
  transform-origin: left top;
  width: max-content;

  html[data-forge-theme="light"] & {
    background: ${({ $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), "10")};
    border-color: ${({ $selected, $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), $selected ? "aa" : "42")};
    color: ${({ $tone }) => lightReadableTone($tone || "#0f766e")};
  }
`;

const ProjectGroupLabelText = styled.div`
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const ProjectGroupCount = styled.div`
  align-items: center;
  background: rgba(4, 9, 16, 0.72);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.86);
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 900;
  height: 18px;
  justify-content: center;
  min-width: 18px;
  padding: 0 5px;

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.86);
    color: #1d1d1f;
  }
`;

const LabelCard = styled.button`
  align-items: center;
  background: ${({ $kind, $kindTone, $localOnly, $noSpec, $statusTone }) => {
    if ($localOnly) {
      return `
        linear-gradient(135deg, rgba(148, 163, 184, 0.22), rgba(15, 23, 42, 0.92) 58%),
        rgba(15, 23, 42, 0.96)
      `;
    }
    if ($noSpec) return "rgba(15, 23, 42, 0.64)";
    if ($kind === "abstract") {
      return `
        linear-gradient(135deg, ${colorWithAlpha($kindTone || "#c084fc", "24")}, rgba(13, 17, 23, 0.94) 56%),
        radial-gradient(circle at 52% 46%, ${colorWithAlpha($statusTone || "#fbbf24", "24")}, transparent 68%),
        rgba(13, 17, 23, 0.96)
      `;
    }
    return `
      radial-gradient(circle at 48% 36%, ${colorWithAlpha($statusTone || "#38bdf8", "24")}, rgba(13, 17, 23, 0.88) 62%),
      rgba(13, 17, 23, 0.94)
    `;
  }};
  border: ${({ $kind, $kindTone, $localOnly, $selected, $noSpec, $sourceState, $sourceTone, $statusTone }) => {
    if ($localOnly && $selected) return "1.5px solid rgba(226, 232, 240, 0.86)";
    if ($localOnly) return "1.3px dotted rgba(203, 213, 225, 0.72)";
    if ($selected && $noSpec) return "1px solid rgba(148, 163, 184, 0.58)";
    if ($selected) return `1.5px solid ${$statusTone || "#38bdf8"}`;
    if ($noSpec) return "1px solid rgba(100, 116, 139, 0.32)";
    if ($sourceState === "lease") return `1.5px dashed ${$sourceTone || "#f59e0b"}`;
    if ($sourceState === "local") return `1.2px dotted ${$sourceTone || "#94a3b8"}`;
    if ($sourceState === "worktree") return `1.2px solid ${colorWithAlpha($sourceTone || "#38bdf8", "cc")}`;
    if ($sourceState === "main") return `1px solid ${colorWithAlpha($sourceTone || "#22c55e", "8f")}`;
    if ($kind === "abstract") return `1px dashed ${colorWithAlpha($kindTone || "#c084fc", "99")}`;
    return "1px solid rgba(230, 236, 245, 0.14)";
  }};
  border-radius: ${({ $kind }) => {
    if ($kind === "folder") return "8px";
    if ($kind === "file") return "7px";
    if ($kind === "abstract") return "22px 9px 22px 9px";
    return "999px";
  }};
  box-shadow: ${({ $live, $localOnly, $selected, $noSpec, $sourceState, $sourceTone, $statusTone }) => {
    if ($localOnly && $selected) return "0 0 0 2px rgba(203, 213, 225, 0.22), 0 16px 36px rgba(0, 0, 0, 0.3)";
    if ($localOnly) return "0 0 0 1px rgba(148, 163, 184, 0.24), 0 12px 28px rgba(0, 0, 0, 0.24)";
    if ($selected && $noSpec) return "0 0 0 2px rgba(100, 116, 139, 0.14), 0 10px 24px rgba(0, 0, 0, 0.18)";
    if ($selected) return `0 0 0 2px ${colorWithAlpha($statusTone || "#38bdf8", "55")}, 0 0 0 5px ${colorWithAlpha($sourceTone || "#38bdf8", "22")}, 0 18px 44px rgba(0, 0, 0, 0.34)`;
    if ($sourceState === "lease") return `0 0 0 1px ${colorWithAlpha($sourceTone || "#f59e0b", "44")}, 0 0 24px ${colorWithAlpha($sourceTone || "#f59e0b", "22")}, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    if ($sourceState === "worktree") return `0 0 0 1px ${colorWithAlpha($sourceTone || "#38bdf8", "33")}, 0 0 24px ${colorWithAlpha($sourceTone || "#38bdf8", "1f")}, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    if ($live) return `0 0 0 1px ${colorWithAlpha($sourceTone || "#34d399", "33")}, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    if ($noSpec) return "0 8px 18px rgba(0, 0, 0, 0.14)";
    return "0 12px 30px rgba(0, 0, 0, 0.2)";
  }};
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${({ $compact }) => ($compact ? "3px" : "4px")};
  justify-content: center;
  left: 0;
  min-width: 0;
  opacity: ${({ $localOnly, $noSpec, $selected, $sourceState }) => {
    if ($localOnly) return $selected ? 0.98 : 0.94;
    if ($noSpec) return $selected ? 0.86 : 0.7;
    return $sourceState === "local" ? 0.76 : 1;
  }};
  outline: none;
  overflow: visible;
  padding: ${({ $kind, $compact }) => {
    if ($compact) return $kind === "workspace" ? "22px" : "8px";
    if ($kind === "workspace") return "24px";
    if ($kind === "folder") return "7px 8px";
    if ($kind === "file") return "9px 12px 9px 16px";
    return "12px 14px";
  }};
  pointer-events: auto;
  position: absolute;
  text-align: center;
  top: 0;
  transform-origin: left top;
  user-select: none;

  html[data-forge-theme="light"] & {
    background: ${({ $kind, $kindTone, $localOnly, $noSpec, $statusTone }) => {
      if ($localOnly) return "#f1f5f9";
      if ($noSpec) return "#f8fafc";
      if ($kind === "abstract") return `linear-gradient(135deg, ${colorWithAlpha(lightReadableTone($kindTone, "#7e22ce"), "12")}, #ffffff 58%)`;
      return `linear-gradient(180deg, #ffffff, ${colorWithAlpha(lightReadableTone($statusTone || "#0066cc"), "08")})`;
    }};
    border-color: ${({ $selected, $noSpec, $sourceTone, $statusTone }) => (
      $selected
        ? lightReadableTone($noSpec ? "#64748b" : ($statusTone || $sourceTone))
        : colorWithAlpha(lightReadableTone($noSpec ? "#64748b" : ($sourceTone || $statusTone)), "44")
    )};
    box-shadow: ${({ $selected, $noSpec, $sourceTone, $statusTone }) => (
      $selected
        ? `0 0 0 2px ${colorWithAlpha(lightReadableTone($noSpec ? "#64748b" : ($statusTone || $sourceTone)), "24")}, 0 1px 2px rgba(0, 0, 0, 0.06)`
        : "0 1px 2px rgba(0, 0, 0, 0.05)"
    )};
    opacity: ${({ $localOnly, $noSpec, $selected, $sourceState }) => {
      if ($localOnly) return $selected ? 1 : 0.92;
      if ($noSpec) return $selected ? 0.94 : 0.82;
      return $sourceState === "local" ? 0.84 : 1;
    }};
  }

  &::before {
    background: ${({ $kind, $kindTone, $noSpec }) => {
      if ($kind !== "folder") return "transparent";
      return $noSpec ? "rgba(100, 116, 139, 0.48)" : colorWithAlpha($kindTone || "#a78bfa", "88");
    }};
    border: ${({ $kind, $noSpec, $sourceTone }) => (
      $kind === "folder"
        ? `1px solid ${$noSpec ? "rgba(100, 116, 139, 0.48)" : colorWithAlpha($sourceTone || "#22c55e", "aa")}`
        : "0"
    )};
    border-bottom: 0;
    border-radius: 8px 8px 3px 3px;
    content: "";
    display: ${({ $kind }) => ($kind === "folder" ? "block" : "none")};
    height: 8px;
    left: 10px;
    position: absolute;
    top: -6px;
    width: 30px;
    z-index: 1;
  }

  &::after {
    content: "";
    pointer-events: none;
    position: absolute;
    z-index: 1;
    ${({ $kind, $kindTone, $noSpec, $sourceTone }) => {
      if ($kind === "file") {
        return `
          background: ${$noSpec ? "rgba(100, 116, 139, 0.48)" : colorWithAlpha($sourceTone || "#22c55e", "cc")};
          clip-path: polygon(100% 0, 0 0, 100% 100%);
          height: 14px;
          right: 0;
          top: 0;
          width: 14px;
        `;
      }
      if ($kind === "abstract") {
        return `
          background: rgba(13, 17, 23, 0.96);
          border: 1px solid ${colorWithAlpha($kindTone || "#c084fc", "bb")};
          height: 14px;
          right: 16px;
          top: -6px;
          transform: rotate(45deg);
          width: 14px;
        `;
      }
      return "display: none;";
    }}
  }

  html[data-forge-theme="light"] &::before {
    background: ${({ $kind, $kindTone, $noSpec }) => {
      if ($kind !== "folder") return "transparent";
      return $noSpec ? "#94a3b8" : colorWithAlpha(lightReadableTone($kindTone || "#7e22ce"), "66");
    }};
    border-color: ${({ $noSpec, $sourceTone }) => (
      $noSpec ? "#94a3b8" : colorWithAlpha(lightReadableTone($sourceTone || "#0a7f45"), "99")
    )};
  }

  html[data-forge-theme="light"] &::after {
    ${({ $kind, $kindTone, $noSpec, $sourceTone }) => {
      if ($kind === "file") {
        return `background: ${$noSpec ? "#94a3b8" : lightReadableTone($sourceTone || "#0a7f45")};`;
      }
      if ($kind === "abstract") {
        return `
          background: #ffffff;
          border-color: ${colorWithAlpha(lightReadableTone($kindTone || "#7e22ce"), "aa")};
        `;
      }
      return "";
    }}
  }

  html[data-forge-theme="light"] &:hover {
    border-color: ${({ $noSpec, $sourceTone, $statusTone }) => (
      lightReadableTone($noSpec ? "#64748b" : ($sourceTone || $statusTone), "#0066cc")
    )};
  }
`;

const SourceAccent = styled.span`
  pointer-events: none;
  position: absolute;
  z-index: 1;
  ${({ $kind, $noSpec, $sourceState, $sourceTone }) => {
    if ($sourceState === "unknown") return "display: none;";
    if ($kind === "workspace") {
      return `
        background: transparent;
        border: 1px solid ${$noSpec ? "rgba(100, 116, 139, 0.36)" : colorWithAlpha($sourceTone || "#22c55e", "88")};
        border-radius: 999px;
        inset: 8px;
      `;
    }
    if ($kind === "folder") {
      return `
        background: ${$noSpec ? "rgba(100, 116, 139, 0.44)" : colorWithAlpha($sourceTone || "#22c55e", "d9")};
        border-radius: 999px;
        bottom: 6px;
        height: 3px;
        left: 10px;
        right: 10px;
      `;
    }
    if ($kind === "file") {
      return `
        background: ${$noSpec ? "rgba(100, 116, 139, 0.44)" : colorWithAlpha($sourceTone || "#22c55e", "d9")};
        border-radius: 0 999px 999px 0;
        bottom: 13px;
        left: 0;
        top: 13px;
        width: 5px;
      `;
    }
    return `
      background: ${$noSpec ? "rgba(100, 116, 139, 0.42)" : colorWithAlpha($sourceTone || "#94a3b8", "b8")};
      border-radius: 999px;
      bottom: 10px;
      height: 2px;
      right: 10px;
      transform: rotate(-28deg);
      width: 24px;
    `;
  }}

  html[data-forge-theme="light"] & {
    ${({ $kind, $noSpec, $sourceState, $sourceTone }) => {
      if ($sourceState === "unknown") return "";
      if ($kind === "workspace") {
        return `border-color: ${$noSpec ? "rgba(100, 116, 139, 0.42)" : colorWithAlpha(lightReadableTone($sourceTone || "#0a7f45"), "88")};`;
      }
      return `background: ${$noSpec ? "rgba(100, 116, 139, 0.58)" : colorWithAlpha(lightReadableTone($sourceTone || "#0a7f45"), "d9")};`;
    }}
  }
`;

const LabelMeta = styled.div`
  align-items: center;
  color: ${({ $kind, $localOnly, $noSpec, $statusTone }) => {
    if ($localOnly) return "rgba(226, 232, 240, 0.84)";
    if ($noSpec) return "rgba(203, 213, 225, 0.62)";
    if ($kind === "workspace") return "rgba(167, 243, 208, 0.9)";
    return colorWithAlpha($statusTone || "#e2e8f0", "dd");
  }};
  display: flex;
  font-size: ${({ $kind }) => ($kind === "workspace" ? "10px" : "8.5px")};
  font-weight: 900;
  gap: 4px;
  justify-content: center;
  letter-spacing: 0;
  line-height: 1;
  max-width: 100%;
  overflow: hidden;
  position: relative;
  text-transform: uppercase;
  white-space: nowrap;
  z-index: 2;

  html[data-forge-theme="light"] & {
    color: ${({ $noSpec, $statusTone }) => ($noSpec ? "#64748b" : ($statusTone || "#0066cc"))};
  }
`;

const LabelSource = styled.span`
  background: ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#22c55e", "1f")};
  border: 1px solid ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#22c55e", "66")};
  border-radius: 999px;
  color: ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#22c55e", "f2")};
  font-size: 8px;
  line-height: 1;
  max-width: 58px;
  overflow: hidden;
  padding: 1px 4px;
  text-overflow: ellipsis;
`;

const LabelTitle = styled.div`
  color: ${({ $localOnly, $noSpec }) => {
    if ($localOnly) return "rgba(248, 250, 252, 0.92)";
    return $noSpec ? "rgba(226, 232, 240, 0.72)" : "var(--forge-text-soft, #eef5ff)";
  }};
  display: -webkit-box;
  font-size: ${({ $kind }) => {
    if ($kind === "workspace") return "14px";
    if ($kind === "folder") return "10.5px";
    if ($kind === "abstract") return "11.5px";
    return "11px";
  }};
  font-weight: 850;
  letter-spacing: 0;
  line-height: ${({ $kind }) => ($kind === "folder" ? 1.12 : 1.18)};
  max-width: 100%;
  overflow: hidden;
  position: relative;
  text-overflow: ellipsis;
  z-index: 2;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${({ $kind }) => {
    if ($kind === "workspace") return 5;
    if ($kind === "abstract") return 3;
    return 2;
  }};
  word-break: break-word;

  html[data-forge-theme="light"] & {
    color: ${({ $localOnly, $noSpec }) => {
      if ($localOnly) return "#334155";
      return $noSpec ? "#5f6673" : "#1d1d1f";
    }};
  }
`;

const LabelPath = styled.div`
  color: rgba(219, 231, 247, 0.5);
  font-size: 8.2px;
  font-weight: 680;
  line-height: 1.15;
  max-width: 100%;
  overflow: hidden;
  position: relative;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 2;

  html[data-forge-theme="light"] & {
    color: #6e6e73;
  }
`;

const LabelBadge = styled.span`
  align-items: center;
  background: rgba(7, 12, 19, 0.92);
  border: 1px solid rgba(230, 236, 245, 0.16);
  border-radius: 999px;
  color: #f8fafc;
  display: inline-flex;
  font-size: 10px;
  font-weight: 900;
  height: 22px;
  justify-content: center;
  min-width: 22px;
  padding: 0 6px;
  position: absolute;
  right: -7px;
  top: -7px;
  z-index: 3;
`;

const OutOfSpecBadge = styled.span`
  align-items: center;
  background: rgba(124, 45, 18, 0.94);
  border: 1px solid rgba(251, 146, 60, 0.58);
  border-radius: 999px;
  color: #ffedd5;
  display: inline-flex;
  font-size: 10px;
  font-weight: 920;
  height: 22px;
  justify-content: center;
  left: -7px;
  min-width: 22px;
  padding: 0 6px;
  position: absolute;
  top: -7px;
  z-index: 3;

  html[data-forge-theme="light"] & {
    background: rgba(139, 90, 0, 0.08);
    border-color: rgba(139, 90, 0, 0.22);
    color: #5c4100;
  }
`;

const ThreeControls = styled.div`
  bottom: 12px;
  display: flex;
  gap: 6px;
  left: 12px;
  position: absolute;
  z-index: 4;
`;

const ControlButton = styled.button`
  background: rgba(13, 17, 23, 0.92);
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 8px;
  color: rgba(219, 231, 247, 0.82);
  cursor: pointer;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0;
  min-height: 30px;
  padding: 0 10px;

  html[data-forge-theme="light"] & {
    background: #fafafc;
    border-color: rgba(0, 0, 0, 0.08);
    color: #333333;
  }
`;

const EmptyState = styled.div`
  color: rgba(219, 231, 247, 0.48);
  font-size: 12px;
  font-weight: 680;
  padding: 14px;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;
