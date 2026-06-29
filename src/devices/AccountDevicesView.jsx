import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { Close as CloseIcon } from "@styled-icons/material-rounded/Close";
import { DesktopWindows } from "@styled-icons/material-rounded/DesktopWindows";
import { Devices } from "@styled-icons/material-rounded/Devices";
import { Dns } from "@styled-icons/material-rounded/Dns";
import { LaptopMac } from "@styled-icons/material-rounded/LaptopMac";
import { PhoneIphone } from "@styled-icons/material-rounded/PhoneIphone";
import { RadioButtonChecked } from "@styled-icons/material-rounded/RadioButtonChecked";
import { SettingsEthernet } from "@styled-icons/material-rounded/SettingsEthernet";
import { Storage } from "@styled-icons/material-rounded/Storage";
import { Terminal } from "@styled-icons/material-rounded/Terminal";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import {
  TODO_QUEUE_DEVICE_KIND_MOBILE,
  buildDevicesGraphModel,
} from "../terminals/todoQueueDeviceSwitcher.js";

function statusTone(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["live", "active", "connected", "online", "open", "running"].includes(value)) return "live";
  if (["syncing", "sync", "loading", "starting", "activating", "pending"].includes(value)) return "syncing";
  if (["failed", "error", "blocked", "crashed"].includes(value)) return "error";
  if (["offline", "disconnected", "closed"].includes(value)) return "offline";
  if (["idle", "ready", "unknown", ""].includes(value)) return value || "unknown";
  return "unknown";
}

function statusLabel(status, fallback = "Unknown") {
  const tone = statusTone(status);
  if (tone === "live") return "Live";
  if (tone === "syncing") return "Syncing";
  if (tone === "error") return "Attention";
  if (tone === "offline") return "Offline";
  if (tone === "idle") return "Idle";
  return fallback;
}

function plural(value, singular, pluralLabel = `${singular}s`) {
  const count = Number(value) || 0;
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function accountInitials(label) {
  const parts = String(label || "Account")
    .split(/[\s@._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const text = parts.length > 1
    ? `${parts[0][0] || ""}${parts[1][0] || ""}`
    : (parts[0] || "A").slice(0, 2);
  return text.toUpperCase();
}

function deviceIconFor(device) {
  if (device?.deviceKind === TODO_QUEUE_DEVICE_KIND_MOBILE) {
    return PhoneIphone;
  }
  const label = `${device?.platformLabel || ""} ${device?.formFactorLabel || ""}`.toLowerCase();
  if (label.includes("mac") || label.includes("laptop") || label.includes("darwin")) {
    return LaptopMac;
  }
  if (label.includes("pc") || label.includes("windows") || label.includes("desktop")) {
    return DesktopWindows;
  }
  return Devices;
}

function deviceSubtitle(device) {
  return [
    device?.isLocal ? "This device" : "",
    device?.platformLabel || device?.formFactorLabel || "",
  ].filter(Boolean).join(" - ") || "Device";
}

const DEVICE_GRAPH_BASE_WIDTH = 980;
const DEVICE_GRAPH_BASE_HEIGHT = 620;
const DEVICE_NODE_WIDTH = 264;
const DEVICE_NODE_HEIGHT = 96;
const DEVICE_NODE_SPACING = 340;
const DEVICE_RING_INNER_RADIUS = 340;
const DEVICE_RING_GAP = 330;
const DEVICE_GRAPH_MARGIN = 72;

function deviceGraphAngle(index, count, ringIndex) {
  if (count === 1) return -90;
  if (count === 2) return 180 + index * 180;
  return -90 + (ringIndex % 2 ? 180 / count : 0) + (360 / count) * index;
}

function deviceRingCapacity(radius) {
  return Math.max(1, Math.floor((2 * Math.PI * radius) / DEVICE_NODE_SPACING));
}

function buildDeviceGraphLayout(deviceCount) {
  const total = Math.max(0, Number(deviceCount) || 0);
  const rings = [];
  let remaining = total;
  let radius = DEVICE_RING_INNER_RADIUS;

  while (remaining > 0) {
    const capacity = deviceRingCapacity(radius);
    const count = Math.min(remaining, capacity);
    rings.push({ count, radius });
    remaining -= count;
    radius += DEVICE_RING_GAP;
  }

  const outerRadius = rings.length ? rings[rings.length - 1].radius : DEVICE_RING_INNER_RADIUS;
  const width = Math.max(
    DEVICE_GRAPH_BASE_WIDTH,
    Math.ceil((outerRadius + DEVICE_NODE_WIDTH / 2 + DEVICE_GRAPH_MARGIN) * 2),
  );
  const height = Math.max(
    DEVICE_GRAPH_BASE_HEIGHT,
    Math.ceil((outerRadius + DEVICE_NODE_HEIGHT / 2 + DEVICE_GRAPH_MARGIN) * 2),
  );
  const centerX = width / 2;
  const centerY = height / 2;
  const nodes = [];

  rings.forEach((ring, ringIndex) => {
    for (let ringNodeIndex = 0; ringNodeIndex < ring.count; ringNodeIndex += 1) {
      const angle = deviceGraphAngle(ringNodeIndex, ring.count, ringIndex);
      const radians = (angle * Math.PI) / 180;
      nodes.push({
        angle,
        ring: ringIndex,
        x: centerX + Math.cos(radians) * ring.radius,
        y: centerY + Math.sin(radians) * ring.radius,
      });
    }
  });

  return {
    centerX,
    centerY,
    height,
    nodes,
    width,
  };
}

function SyncPackets({ inboundPathId, outboundPathId, index, selected, status }) {
  const tone = statusTone(status);
  const duration = tone === "syncing" ? 2.65 : tone === "live" ? 3.45 : 5.8;
  const delay = (index % 7) * 0.29;

  return (
    <>
      <SyncPacketGroup
        data-direction="outbound"
        data-selected={selected ? "true" : "false"}
        data-status={tone}
      >
        <SyncPacketHalo r="8.5" />
        <SyncPacketCore r="2.8" />
        <SyncPacketTray d="M -5 -4.2H5V4.2H-5ZM-4.6 -0.3h2.8l1.1 1.4H.7l1.1 -1.4h2.8" />
        <animateMotion begin={`${delay}s`} dur={`${duration}s`} repeatCount="indefinite">
          <mpath href={`#${outboundPathId}`} />
        </animateMotion>
      </SyncPacketGroup>
      <SyncPacketGroup
        data-direction="inbound"
        data-selected={selected ? "true" : "false"}
        data-status={tone}
      >
        <SyncPacketHalo r="7.5" />
        <SyncPacketCore r="2.6" />
        <SyncPacketTray d="M -5 -4.2H5V4.2H-5ZM-4.6 -0.3h2.8l1.1 1.4H.7l1.1 -1.4h2.8" />
        <animateMotion begin={`${delay + duration / 2}s`} dur={`${duration + 0.65}s`} repeatCount="indefinite">
          <mpath href={`#${inboundPathId}`} />
        </animateMotion>
      </SyncPacketGroup>
    </>
  );
}

function GraphDeviceCard({ device, onSelect, selected }) {
  const DeviceIcon = deviceIconFor(device);
  const deviceTone = statusTone(device.liveState);
  return (
    <DeviceNode
      aria-label={`Show details for ${device.deviceName}`}
      aria-pressed={selected ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-status={deviceTone}
      onClick={onSelect}
      type="button"
    >
      <DeviceIconWrap data-kind={device.deviceKind}>
        <DeviceIcon aria-hidden="true" />
      </DeviceIconWrap>
      <DeviceNodeMain>
        <DeviceNodeTitle title={device.deviceName}>{device.deviceName}</DeviceNodeTitle>
        <DeviceNodeMeta title={deviceSubtitle(device)}>{deviceSubtitle(device)}</DeviceNodeMeta>
        <DeviceSurfaceRow aria-label={`${device.deviceName} surfaces`}>
          <SurfacePill data-active={device.nativeConnected ? "true" : "false"}>
            <RadioButtonChecked aria-hidden="true" />
            <span>Native</span>
          </SurfacePill>
          <SurfacePill data-active={device.webConnected ? "true" : "false"}>
            <SettingsEthernet aria-hidden="true" />
            <span>Web</span>
          </SurfacePill>
        </DeviceSurfaceRow>
      </DeviceNodeMain>
      <StatusPill data-status={deviceTone}>{statusLabel(device.liveState)}</StatusPill>
    </DeviceNode>
  );
}

function GraphDetailSheet({ accountName, detail, graph, onClose }) {
  if (!detail) {
    return null;
  }

  const isAccount = detail.type === "account";
  const device = detail.device;
  const Icon = isAccount ? AccountTree : deviceIconFor(device);
  const status = isAccount ? graph.account.status : device.liveState;
  const tone = statusTone(status);
  const title = isAccount ? accountName : device.deviceName;
  const subtitle = isAccount
    ? `${plural(graph.totals.deviceCount, "device")} - ${plural(graph.totals.liveDeviceCount, "live device")}`
    : deviceSubtitle(device);
  const metrics = isAccount ? [
    { Icon: Devices, label: "Devices", value: graph.totals.deviceCount },
    { Icon: RadioButtonChecked, label: "Live", value: graph.totals.liveDeviceCount },
    { Icon: Storage, label: "Workspaces", value: graph.totals.workspaceCount },
    { Icon: Terminal, label: "Terminals", value: graph.totals.terminalCount },
  ] : [
    { Icon: Storage, label: "Workspaces", value: device.workspaceCount },
    { Icon: Terminal, label: "Terminals", value: device.terminalCount },
    { Icon: Dns, label: "Todos", value: device.todoCount },
    { Icon: SettingsEthernet, label: "Tools", value: device.toolCount },
  ];

  return (
    <GraphDetailDock aria-label={`${title} details`} role="dialog">
      <GraphDetailHero>
        <GraphDetailIcon data-status={tone}>
          <Icon aria-hidden="true" />
        </GraphDetailIcon>
        <GraphDetailCopy>
          <GraphDetailTitleRow>
            <GraphDetailTitle title={title}>{title}</GraphDetailTitle>
            <StatusPill data-status={tone}>{statusLabel(status, "Idle")}</StatusPill>
          </GraphDetailTitleRow>
          <GraphDetailMeta title={subtitle}>{subtitle}</GraphDetailMeta>
          {!isAccount ? (
            <DeviceSurfaceRow aria-label={`${device.deviceName} surfaces`}>
              <SurfacePill data-active={device.nativeConnected ? "true" : "false"}>
                <RadioButtonChecked aria-hidden="true" />
                <span>Native</span>
              </SurfacePill>
              <SurfacePill data-active={device.webConnected ? "true" : "false"}>
                <SettingsEthernet aria-hidden="true" />
                <span>Web</span>
              </SurfacePill>
              <GraphDetailId title={device.deviceId}>{device.deviceId}</GraphDetailId>
            </DeviceSurfaceRow>
          ) : (
            <GraphDetailId>{plural(graph.totals.todoCount, "todo")} - {plural(graph.totals.toolCount, "tool")}</GraphDetailId>
          )}
        </GraphDetailCopy>
        <GraphDetailClose aria-label="Close details" onClick={onClose} title="Close details" type="button">
          <CloseIcon aria-hidden="true" />
        </GraphDetailClose>
      </GraphDetailHero>
      <GraphDetailMetrics>
        {metrics.map(({ Icon: MetricIcon, label, value }) => (
          <GraphDetailMetric key={label}>
            <MetricIcon aria-hidden="true" />
            <span>{label}</span>
            <strong>{value}</strong>
          </GraphDetailMetric>
        ))}
      </GraphDetailMetrics>
    </GraphDetailDock>
  );
}

export default function AccountDevicesView({
  accountLabel = "",
  connectedDevices = [],
  deviceLiveState = null,
  knownDevices = [],
  localDesktopProfile = null,
  workspaceTodos = null,
}) {
  const rawGraphId = useId();
  const [selectedGraphNode, setSelectedGraphNode] = useState(null);
  const [graphPanning, setGraphPanning] = useState(false);
  const graphViewportRef = useRef(null);
  const graphPanRef = useRef({
    active: false,
    moved: false,
    pointerId: null,
    scrollLeft: 0,
    scrollTop: 0,
    startX: 0,
    startY: 0,
  });
  const suppressGraphClickRef = useRef(false);
  const graph = useMemo(() => buildDevicesGraphModel({
    connectedDevices,
    deviceLiveState,
    knownDevices,
    localProfile: localDesktopProfile,
    workspaceTodos,
  }), [
    connectedDevices,
    deviceLiveState,
    knownDevices,
    localDesktopProfile,
    workspaceTodos,
  ]);
  const accountName = accountLabel || graph.account.name || "Account";
  const hasDevices = graph.devices.length > 0;
  const selectedGraphDevice = selectedGraphNode?.type === "device"
    ? graph.devices.find((device) => device.deviceId === selectedGraphNode.id)
    : null;
  const selectedDetail = selectedGraphNode?.type === "account"
    ? { type: "account" }
    : selectedGraphDevice ? { type: "device", device: selectedGraphDevice } : null;
  const accountSelected = selectedGraphNode?.type === "account";
  const graphIdPrefix = `devices-graph-${rawGraphId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const graphLayout = useMemo(() => buildDeviceGraphLayout(graph.devices.length), [graph.devices.length]);

  useEffect(() => {
    const viewport = graphViewportRef.current;
    if (!viewport || !hasDevices) {
      return undefined;
    }

    const centerTimer = window.setTimeout(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
    }, 0);

    return () => window.clearTimeout(centerTimer);
  }, [graph.devices.length, graphLayout.height, graphLayout.width, hasDevices]);

  const selectGraphNode = (node) => {
    if (suppressGraphClickRef.current) {
      return;
    }
    setSelectedGraphNode(node);
  };

  const endGraphPan = (event) => {
    const state = graphPanRef.current;
    if (!state.active || state.pointerId !== event.pointerId) {
      return;
    }

    graphPanRef.current = {
      active: false,
      moved: false,
      pointerId: null,
      scrollLeft: 0,
      scrollTop: 0,
      startX: 0,
      startY: 0,
    };
    setGraphPanning(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (state.moved) {
      suppressGraphClickRef.current = true;
      window.setTimeout(() => {
        suppressGraphClickRef.current = false;
      }, 0);
    }
  };

  const beginGraphPan = (event) => {
    if (!hasDevices || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    const viewport = graphViewportRef.current;
    if (!viewport) {
      return;
    }

    graphPanRef.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      startX: event.clientX,
      startY: event.clientY,
    };
    setGraphPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveGraphPan = (event) => {
    const state = graphPanRef.current;
    if (!state.active || state.pointerId !== event.pointerId) {
      return;
    }

    const viewport = graphViewportRef.current;
    if (!viewport) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      graphPanRef.current.moved = true;
    }

    viewport.scrollLeft = state.scrollLeft - deltaX;
    viewport.scrollTop = state.scrollTop - deltaY;
    event.preventDefault();
  };

  return (
    <DevicesSurface>
      <DevicesHeader>
        <DevicesTitleGroup>
          <DevicesKicker>
            <Devices aria-hidden="true" />
            <span>Devices</span>
          </DevicesKicker>
          <DevicesHeading title={accountName}>{accountName}</DevicesHeading>
        </DevicesTitleGroup>
        <DevicesSummary aria-label="Device graph summary">
          <SummaryMetric>
            <strong>{graph.totals.deviceCount}</strong>
            <span>devices</span>
          </SummaryMetric>
          <SummaryMetric>
            <strong>{graph.totals.liveDeviceCount}</strong>
            <span>live</span>
          </SummaryMetric>
          <SummaryMetric>
            <strong>{graph.totals.workspaceCount}</strong>
            <span>workspaces</span>
          </SummaryMetric>
          <SummaryMetric>
            <strong>{graph.totals.terminalCount}</strong>
            <span>terminals</span>
          </SummaryMetric>
        </DevicesSummary>
      </DevicesHeader>

      <GraphViewport
        data-empty={hasDevices ? "false" : "true"}
        data-panning={graphPanning ? "true" : "false"}
        onPointerCancel={endGraphPan}
        onPointerDown={beginGraphPan}
        onPointerMove={moveGraphPan}
        onPointerUp={endGraphPan}
        ref={graphViewportRef}
      >
        {hasDevices ? (
          <GraphCanvas style={{ height: `${graphLayout.height}px`, width: `${graphLayout.width}px` }}>
            <DeviceGraphStage aria-label="Account device graph">
              <DeviceGraphLinks
                aria-hidden="true"
                preserveAspectRatio="none"
                viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
              >
                <defs>
                  {graph.devices.map((device, index) => {
                    const position = graphLayout.nodes[index];
                    const pathKey = `${graphIdPrefix}-${index}`;
                    return (
                      <g key={`paths-${device.deviceId}`}>
                        <path
                          d={`M ${graphLayout.centerX} ${graphLayout.centerY} L ${position.x} ${position.y}`}
                          id={`${pathKey}-outbound`}
                        />
                        <path
                          d={`M ${position.x} ${position.y} L ${graphLayout.centerX} ${graphLayout.centerY}`}
                          id={`${pathKey}-inbound`}
                        />
                      </g>
                    );
                  })}
                </defs>
                {graph.devices.map((device, index) => {
                  const position = graphLayout.nodes[index];
                  const selected = selectedGraphNode?.type === "device" && selectedGraphNode.id === device.deviceId;
                  const pathKey = `${graphIdPrefix}-${index}`;
                  return (
                    <g key={`line-${device.deviceId}`}>
                      <DeviceGraphPath
                        d={`M ${graphLayout.centerX} ${graphLayout.centerY} L ${position.x} ${position.y}`}
                        data-selected={selected ? "true" : "false"}
                        data-status={statusTone(device.liveState)}
                      />
                      <SyncPackets
                        inboundPathId={`${pathKey}-inbound`}
                        index={index}
                        outboundPathId={`${pathKey}-outbound`}
                        selected={selected}
                        status={device.liveState}
                      />
                    </g>
                  );
                })}
              </DeviceGraphLinks>
              <AccountNodeWrap>
                <AccountNode
                  aria-label={`Show details for ${accountName}`}
                  aria-pressed={accountSelected ? "true" : "false"}
                  data-selected={accountSelected ? "true" : "false"}
                  data-status={statusTone(graph.account.status)}
                  onClick={() => selectGraphNode({ id: "account", type: "account" })}
                  type="button"
                >
                  <AccountBadge>{accountInitials(accountName)}</AccountBadge>
                  <AccountMain>
                    <AccountName title={accountName}>{accountName}</AccountName>
                    <AccountMeta>
                      {plural(graph.totals.workspaceCount, "workspace")} - {plural(graph.totals.todoCount, "todo")}
                    </AccountMeta>
                  </AccountMain>
                  <StatusPill data-status={statusTone(graph.account.status)}>
                    {statusLabel(graph.account.status, "Idle")}
                  </StatusPill>
                </AccountNode>
              </AccountNodeWrap>
              {graph.devices.map((device, index) => {
                const position = graphLayout.nodes[index];
                const selected = selectedGraphNode?.type === "device" && selectedGraphNode.id === device.deviceId;
                return (
                  <DeviceNodeWrap
                    key={device.deviceId}
                    style={{ left: `${position.x}px`, top: `${position.y}px` }}
                  >
                    <GraphDeviceCard
                      device={device}
                      onSelect={() => selectGraphNode({ id: device.deviceId, type: "device" })}
                      selected={selected}
                    />
                  </DeviceNodeWrap>
                );
              })}
            </DeviceGraphStage>
          </GraphCanvas>
        ) : (
          <DevicesEmptyState>
            <AccountTree aria-hidden="true" />
            <strong>No devices yet</strong>
            <span>Live device data will appear here when this account connects.</span>
          </DevicesEmptyState>
        )}
      </GraphViewport>
      <GraphDetailSheet
        accountName={accountName}
        detail={selectedDetail}
        graph={graph}
        onClose={() => setSelectedGraphNode(null)}
      />
    </DevicesSurface>
  );
}

const syncLineFlow = keyframes`
  from {
    stroke-dashoffset: 0;
  }

  to {
    stroke-dashoffset: -44;
  }
`;

const packetTwinkle = keyframes`
  0%,
  100% {
    opacity: 0.48;
  }

  48% {
    opacity: 0.96;
  }
`;

const accountFieldPulse = keyframes`
  0%,
  100% {
    opacity: 0.2;
    transform: translate(-50%, -50%) scale(0.88);
  }

  50% {
    opacity: 0.62;
    transform: translate(-50%, -50%) scale(1.08);
  }
`;

const accountNodePulse = keyframes`
  0%,
  100% {
    opacity: 0.26;
    transform: scale(0.98);
  }

  50% {
    opacity: 0.72;
    transform: scale(1.02);
  }
`;

const deviceNodeSpeak = keyframes`
  0%,
  100% {
    opacity: 0.18;
    transform: scale(0.98);
  }

  50% {
    opacity: 0.74;
    transform: scale(1.03);
  }
`;

const DevicesSurface = styled.section`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  color: var(--forge-text);
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.045), transparent 360px),
    var(--forge-bg);
`;

const DevicesHeader = styled.header`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  min-width: 0;
  padding: 18px clamp(18px, 2.8vw, 32px);
  border-bottom: 1px solid var(--forge-border);
  background: rgba(3, 5, 8, 0.4);

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.66);
  }

  @media (max-width: 860px) {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }
`;

const DevicesTitleGroup = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
`;

const DevicesKicker = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.1;

  svg {
    width: 16px;
    height: 16px;
    color: var(--forge-tint-soft);
  }
`;

const DevicesHeading = styled.h1`
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 22px;
  font-weight: 780;
  letter-spacing: 0;
  line-height: 1.12;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DevicesSummary = styled.div`
  display: grid;
  grid-auto-flow: column;
  gap: 8px;

  @media (max-width: 620px) {
    grid-auto-flow: row;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const SummaryMetric = styled.div`
  display: grid;
  min-width: 72px;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(230, 236, 245, 0.026);

  strong {
    color: var(--forge-text);
    font-size: 17px;
    font-weight: 780;
    letter-spacing: 0;
    line-height: 1;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 720;
    letter-spacing: 0;
    line-height: 1.1;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

const GraphViewport = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: contain;
  cursor: grab;
  touch-action: none;
  user-select: none;

  &[data-panning="true"] {
    cursor: grabbing;
  }

  &::-webkit-scrollbar {
    display: none;
  }
`;

const GraphCanvas = styled.div`
  position: relative;
  display: block;
  width: 980px;
  min-width: ${DEVICE_GRAPH_BASE_WIDTH}px;
  height: 620px;
  min-height: ${DEVICE_GRAPH_BASE_HEIGHT}px;
  box-sizing: border-box;
`;

const DeviceGraphStage = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 520px;
  border: 1px solid rgba(144, 155, 170, 0.08);
  border-radius: 8px;
  background:
    radial-gradient(circle at 50% 50%, rgba(var(--forge-tint-rgb), 0.12), transparent 23%),
    linear-gradient(90deg, rgba(144, 155, 170, 0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(144, 155, 170, 0.03) 1px, transparent 1px);
  background-size: auto, 72px 72px, 72px 72px;
  overflow: hidden;
  isolation: isolate;

  &::before {
    position: absolute;
    inset: 50%;
    z-index: 0;
    width: 340px;
    height: 340px;
    border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.14);
    border-radius: 999px;
    content: "";
    pointer-events: none;
    transform: translate(-50%, -50%);
    animation: ${accountFieldPulse} 4.8s ease-in-out infinite;
  }

  html[data-forge-theme="light"] & {
    background:
      radial-gradient(circle at 50% 50%, rgba(var(--forge-tint-rgb), 0.08), transparent 25%),
      linear-gradient(90deg, rgba(15, 23, 42, 0.05) 1px, transparent 1px),
      linear-gradient(180deg, rgba(15, 23, 42, 0.045) 1px, transparent 1px);
    background-size: auto, 72px 72px, 72px 72px;
  }

  @media (prefers-reduced-motion: reduce) {
    &::before {
      animation: none;
    }
  }
`;

const DeviceGraphLinks = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
`;

const DeviceGraphPath = styled.path`
  fill: none;
  stroke: rgba(144, 155, 170, 0.24);
  stroke-dasharray: 9 13;
  stroke-linecap: round;
  stroke-width: 1.1;
  vector-effect: non-scaling-stroke;
  animation: ${syncLineFlow} 5.6s linear infinite;

  &[data-status="live"] {
    stroke: rgba(var(--forge-tint-soft-rgb), 0.46);
  }

  &[data-status="syncing"] {
    stroke: rgba(223, 165, 90, 0.56);
    animation-duration: 3.8s;
  }

  &[data-status="offline"] {
    opacity: 0.34;
    animation-duration: 8s;
  }

  &[data-selected="true"] {
    stroke: rgba(var(--forge-tint-soft-rgb), 0.82);
    stroke-width: 1.45;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const SyncPacketGroup = styled.g`
  color: var(--forge-tint-soft);
  opacity: 0.64;
  filter: drop-shadow(0 0 7px rgba(var(--forge-tint-rgb), 0.48));
  animation: ${packetTwinkle} 1.8s ease-in-out infinite;

  &[data-direction="inbound"] {
    color: var(--forge-green);
  }

  &[data-status="syncing"] {
    color: var(--forge-amber);
    opacity: 0.82;
    animation-duration: 1.25s;
  }

  &[data-status="offline"] {
    opacity: 0.18;
    filter: none;
  }

  &[data-selected="true"] {
    opacity: 1;
    filter: drop-shadow(0 0 10px rgba(var(--forge-tint-rgb), 0.68));
  }

  @media (prefers-reduced-motion: reduce) {
    display: none;
    animation: none;
  }
`;

const SyncPacketHalo = styled.circle`
  fill: currentColor;
  opacity: 0.15;
`;

const SyncPacketCore = styled.circle`
  fill: currentColor;
  opacity: 0.9;
`;

const SyncPacketTray = styled.path`
  fill: rgba(3, 5, 8, 0.78);
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 0.9;
  vector-effect: non-scaling-stroke;

  html[data-forge-theme="light"] & {
    fill: rgba(248, 250, 252, 0.86);
  }
`;

const DeviceNodeWrap = styled.div`
  position: absolute;
  z-index: 2;
  width: ${DEVICE_NODE_WIDTH}px;
  transform: translate(-50%, -50%);
`;

const AccountNodeWrap = styled.div`
  position: absolute;
  z-index: 4;
  left: 50%;
  top: 50%;
  display: grid;
  width: clamp(280px, 34vw, 390px);
  min-width: 0;
  transform: translate(-50%, -50%);
`;

const AccountNode = styled.button`
  appearance: none;
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.3);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.12), rgba(var(--forge-tint-rgb), 0.035)),
    var(--forge-surface);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22);
  color: inherit;
  cursor: pointer;
  font: inherit;
  overflow: hidden;
  text-align: left;

  &::before {
    position: absolute;
    inset: -2px;
    border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.18);
    border-radius: inherit;
    content: "";
    opacity: 0.52;
    pointer-events: none;
    animation: ${accountNodePulse} 3.2s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    &::before {
      animation: none;
    }
  }

  &[data-selected="true"],
  &:hover {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.58);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.18), rgba(var(--forge-tint-rgb), 0.06)),
      var(--forge-surface);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-tint-soft-rgb), 0.72);
    outline-offset: 4px;
  }

  html[data-forge-theme="light"] & {
    box-shadow: 0 12px 26px rgba(15, 23, 42, 0.08);
  }

  @media (max-width: 520px) {
    grid-template-columns: 38px minmax(0, 1fr);

    > span:last-child {
      grid-column: 2;
      justify-self: start;
    }
  }
`;

const AccountBadge = styled.div`
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.38);
  border-radius: 8px;
  color: var(--forge-text);
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.28), rgba(var(--forge-tint-rgb), 0.12)),
    rgba(var(--forge-tint-rgb), 0.12);
  font-size: 15px;
  font-weight: 820;
  letter-spacing: 0;
`;

const AccountMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 4px;
`;

const AccountName = styled.strong`
  overflow: hidden;
  color: var(--forge-text);
  font-size: 14px;
  font-weight: 780;
  letter-spacing: 0;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AccountMeta = styled.span`
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DeviceNode = styled.button`
  appearance: none;
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(230, 236, 245, 0.048), rgba(230, 236, 245, 0.015)),
    var(--forge-surface-raised);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  z-index: 1;
  min-height: ${DEVICE_NODE_HEIGHT}px;
  overflow: hidden;

  &::after {
    position: absolute;
    inset: -1px;
    border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.16);
    border-radius: inherit;
    content: "";
    opacity: 0;
    pointer-events: none;
    transform: scale(0.98);
  }

  &[data-status="live"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.38);
    box-shadow: inset 0 0 0 1px rgba(var(--forge-tint-soft-rgb), 0.08);
  }

  &[data-selected="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.72);
    box-shadow:
      inset 0 0 0 1px rgba(var(--forge-tint-soft-rgb), 0.16),
      0 0 0 3px rgba(var(--forge-tint-rgb), 0.1);
  }

  &[data-status="live"]::after,
  &[data-status="syncing"]::after {
    opacity: 1;
    animation: ${deviceNodeSpeak} 2.8s ease-in-out infinite;
  }

  &[data-status="syncing"]::after {
    border-color: rgba(223, 165, 90, 0.22);
    animation-duration: 1.8s;
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
    }
  }

  &:hover {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
    background:
      linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.075), rgba(230, 236, 245, 0.018)),
      var(--forge-surface-raised);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-tint-soft-rgb), 0.72);
    outline-offset: 3px;
  }

  &[data-status="offline"] {
    opacity: 0.78;
  }
`;

const DeviceIconWrap = styled.div`
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--forge-bg-deep);

  svg {
    width: 22px;
    height: 22px;
  }

  ${DeviceNode}[data-status="live"] & {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.34);
    color: var(--forge-tint-soft);
    background: rgba(var(--forge-tint-rgb), 0.09);
  }
`;

const DeviceNodeMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
`;

const DeviceNodeTitle = styled.strong`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 780;
  letter-spacing: 0;
  line-height: 1.12;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DeviceNodeMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 660;
  letter-spacing: 0;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DeviceSurfaceRow = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;
`;

const SurfacePill = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid rgba(144, 155, 170, 0.18);
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: rgba(230, 236, 245, 0.026);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1;

  svg {
    width: 10px;
    height: 10px;
  }

  &[data-active="true"] {
    border-color: rgba(60, 203, 127, 0.3);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.1);
  }
`;

const StatusPill = styled.span`
  display: inline-grid;
  min-width: 54px;
  max-width: 86px;
  place-items: center;
  padding: 5px 8px;
  border: 1px solid rgba(144, 155, 170, 0.2);
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: rgba(144, 155, 170, 0.09);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  white-space: nowrap;

  &[data-status="live"] {
    border-color: rgba(60, 203, 127, 0.34);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.12);
  }

  &[data-status="syncing"] {
    border-color: rgba(223, 165, 90, 0.36);
    color: var(--forge-amber);
    background: rgba(223, 165, 90, 0.12);
  }

  &[data-status="error"] {
    border-color: rgba(239, 107, 107, 0.36);
    color: var(--forge-red);
    background: rgba(239, 107, 107, 0.12);
  }

  &[data-status="offline"] {
    color: var(--forge-text-disabled);
  }
`;

const GraphDetailDock = styled.aside`
  position: absolute;
  z-index: 30;
  right: clamp(18px, 3vw, 42px);
  bottom: 20px;
  left: clamp(18px, 3vw, 42px);
  display: grid;
  gap: 12px;
  max-height: min(42vh, 260px);
  overflow: auto;
  padding: 14px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.26);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(var(--forge-tint-rgb), 0.08), rgba(230, 236, 245, 0.02)),
    var(--forge-surface);
  box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.24);
  pointer-events: auto;

  html[data-forge-theme="light"] & {
    box-shadow: 0 -16px 34px rgba(15, 23, 42, 0.08);
  }
`;

const GraphDetailHero = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;

  @media (max-width: 620px) {
    grid-template-columns: 38px minmax(0, 1fr) auto;
  }
`;

const GraphDetailIcon = styled.div`
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--forge-bg-deep);

  &[data-status="live"] {
    border-color: rgba(60, 203, 127, 0.32);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.09);
  }

  &[data-status="syncing"] {
    border-color: rgba(223, 165, 90, 0.32);
    color: var(--forge-amber);
    background: rgba(223, 165, 90, 0.09);
  }

  &[data-status="error"] {
    border-color: rgba(239, 107, 107, 0.32);
    color: var(--forge-red);
    background: rgba(239, 107, 107, 0.09);
  }

  svg {
    width: 22px;
    height: 22px;
  }
`;

const GraphDetailCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
`;

const GraphDetailTitleRow = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const GraphDetailTitle = styled.strong`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const GraphDetailMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const GraphDetailId = styled.span`
  display: inline-flex;
  min-width: 0;
  max-width: min(340px, 100%);
  align-items: center;
  overflow: hidden;
  padding: 3px 7px;
  border: 1px solid rgba(144, 155, 170, 0.18);
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: rgba(230, 236, 245, 0.026);
  font-size: 9px;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const GraphDetailClose = styled.button`
  appearance: none;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: rgba(230, 236, 245, 0.026);
  cursor: pointer;

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.38);
    color: var(--forge-text);
    background: rgba(var(--forge-tint-rgb), 0.09);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-tint-soft-rgb), 0.72);
    outline-offset: 2px;
  }
`;

const GraphDetailMetrics = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 760px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const GraphDetailMetric = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 9px;
  border: 1px solid rgba(144, 155, 170, 0.14);
  border-radius: 8px;
  background: rgba(230, 236, 245, 0.02);

  svg {
    width: 16px;
    height: 16px;
    color: var(--forge-text-muted);
  }

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 720;
    letter-spacing: 0;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--forge-text);
    font-size: 13px;
    font-weight: 820;
    letter-spacing: 0;
    line-height: 1;
  }
`;

const DevicesEmptyState = styled.div`
  display: grid;
  width: min(100%, 360px);
  place-self: center;
  place-items: center;
  gap: 10px;
  padding: 24px;
  color: var(--forge-text-muted);
  text-align: center;

  svg {
    width: 36px;
    height: 36px;
    color: var(--forge-tint-soft);
  }

  strong {
    color: var(--forge-text);
    font-size: 15px;
    font-weight: 780;
    letter-spacing: 0;
  }

  span {
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0;
    line-height: 1.4;
  }
`;
