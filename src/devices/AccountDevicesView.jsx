import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { DesktopWindows } from "@styled-icons/material-rounded/DesktopWindows";
import { Devices } from "@styled-icons/material-rounded/Devices";
import { Dns } from "@styled-icons/material-rounded/Dns";
import { LaptopMac } from "@styled-icons/material-rounded/LaptopMac";
import { PhoneIphone } from "@styled-icons/material-rounded/PhoneIphone";
import { RadioButtonChecked } from "@styled-icons/material-rounded/RadioButtonChecked";
import { SettingsEthernet } from "@styled-icons/material-rounded/SettingsEthernet";
import { Storage } from "@styled-icons/material-rounded/Storage";
import { Terminal } from "@styled-icons/material-rounded/Terminal";
import { useMemo } from "react";
import styled from "styled-components";
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

function workspaceStatusLabel(status) {
  const tone = statusTone(status);
  if (tone === "live") return "Active";
  return statusLabel(tone);
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

function terminalSummaryLabel(workspace) {
  const counts = workspace?.terminalStatusCounts || {};
  const busy = Number(counts.busy) || 0;
  const waiting = Number(counts.waiting) || 0;
  const error = Number(counts.error) || 0;
  if (error) return `${error} terminal${error === 1 ? "" : "s"} need attention`;
  if (busy) return `${busy} terminal${busy === 1 ? "" : "s"} busy`;
  if (waiting) return `${waiting} terminal${waiting === 1 ? "" : "s"} waiting`;
  return plural(workspace?.terminalCount, "terminal");
}

function GraphDeviceCard({ device }) {
  const DeviceIcon = deviceIconFor(device);
  const deviceTone = statusTone(device.liveState);
  return (
    <DeviceNode data-status={deviceTone}>
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

function GraphWorkspaceCard({ workspace }) {
  const tone = statusTone(workspace.status);
  return (
    <WorkspaceNode data-status={tone}>
      <WorkspaceNodeTop>
        <WorkspaceIconWrap data-status={tone}>
          <Storage aria-hidden="true" />
        </WorkspaceIconWrap>
        <WorkspaceTitleBlock>
          <WorkspaceTitle title={workspace.name}>{workspace.name}</WorkspaceTitle>
          <WorkspaceMeta title={terminalSummaryLabel(workspace)}>
            {terminalSummaryLabel(workspace)}
          </WorkspaceMeta>
        </WorkspaceTitleBlock>
        <WorkspaceStatus data-status={tone}>{workspaceStatusLabel(workspace.status)}</WorkspaceStatus>
      </WorkspaceNodeTop>
      <WorkspaceStats>
        <WorkspaceStat title="Todos">
          <Dns aria-hidden="true" />
          <span>{workspace.todoCount}</span>
        </WorkspaceStat>
        <WorkspaceStat title="Terminals">
          <Terminal aria-hidden="true" />
          <span>{workspace.terminalCount}</span>
        </WorkspaceStat>
        <WorkspaceStat title="MCPs and servers">
          <SettingsEthernet aria-hidden="true" />
          <span>{workspace.toolCount}</span>
        </WorkspaceStat>
      </WorkspaceStats>
    </WorkspaceNode>
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

      <GraphViewport data-empty={hasDevices ? "false" : "true"}>
        {hasDevices ? (
          <GraphCanvas>
            <AccountNodeWrap>
              <AccountNode data-status={statusTone(graph.account.status)}>
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
            <GraphRail aria-hidden="true" />
            <DeviceGrid data-count={graph.devices.length}>
              {graph.devices.map((device) => (
                <DeviceLane key={device.deviceId}>
                  <GraphDeviceCard device={device} />
                  <WorkspaceStack>
                    {device.workspaces.length ? device.workspaces.map((workspace) => (
                      <GraphWorkspaceCard key={`${device.deviceId}:${workspace.id}`} workspace={workspace} />
                    )) : (
                      <WorkspaceEmpty>
                        <Storage aria-hidden="true" />
                        <span>No workspaces</span>
                      </WorkspaceEmpty>
                    )}
                  </WorkspaceStack>
                </DeviceLane>
              ))}
            </DeviceGrid>
          </GraphCanvas>
        ) : (
          <DevicesEmptyState>
            <AccountTree aria-hidden="true" />
            <strong>No devices yet</strong>
            <span>Live device data will appear here when this account connects.</span>
          </DevicesEmptyState>
        )}
      </GraphViewport>
    </DevicesSurface>
  );
}

const DevicesSurface = styled.section`
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
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
`;

const GraphCanvas = styled.div`
  display: grid;
  min-width: min(100%, 760px);
  min-height: 100%;
  grid-template-rows: auto 38px minmax(0, 1fr);
  align-content: start;
  padding: 24px clamp(16px, 3vw, 38px) 34px;
  box-sizing: border-box;
`;

const AccountNodeWrap = styled.div`
  position: relative;
  display: grid;
  justify-items: center;
  min-width: 0;

  &::after {
    position: absolute;
    top: 100%;
    left: 50%;
    width: 1px;
    height: 39px;
    background: linear-gradient(180deg, rgba(var(--forge-tint-soft-rgb), 0.42), rgba(144, 155, 170, 0.18));
    content: "";
  }
`;

const AccountNode = styled.div`
  display: grid;
  width: min(100%, 380px);
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

const GraphRail = styled.div`
  position: relative;
  display: block;
  min-height: 38px;

  &::before {
    position: absolute;
    left: 8%;
    right: 8%;
    top: 100%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(144, 155, 170, 0.28), transparent);
    content: "";
  }
`;

const DeviceGrid = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(auto-fit, minmax(238px, 1fr));
  gap: clamp(14px, 2.2vw, 24px);
  align-items: start;
`;

const DeviceLane = styled.section`
  position: relative;
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 10px;

  &::before {
    position: absolute;
    left: 50%;
    top: -38px;
    width: 1px;
    height: 38px;
    background: rgba(144, 155, 170, 0.24);
    content: "";
  }

  &::after {
    position: absolute;
    left: 15px;
    top: 62px;
    bottom: 20px;
    width: 1px;
    background: linear-gradient(180deg, rgba(144, 155, 170, 0.24), rgba(144, 155, 170, 0.08));
    content: "";
    pointer-events: none;
  }
`;

const DeviceNode = styled.div`
  position: relative;
  display: grid;
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
  z-index: 1;

  &[data-status="live"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.38);
    box-shadow: inset 0 0 0 1px rgba(var(--forge-tint-soft-rgb), 0.08);
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

const WorkspaceStack = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  gap: 8px;
  padding-left: 30px;
`;

const WorkspaceNode = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  gap: 9px;
  padding: 9px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(230, 236, 245, 0.035), rgba(230, 236, 245, 0.012)),
    rgba(13, 17, 23, 0.72);

  &::before {
    position: absolute;
    top: 50%;
    left: -15px;
    width: 15px;
    height: 1px;
    background: rgba(144, 155, 170, 0.22);
    content: "";
  }

  &[data-status="live"] {
    border-color: rgba(60, 203, 127, 0.28);
  }

  &[data-status="syncing"] {
    border-color: rgba(223, 165, 90, 0.28);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

const WorkspaceNodeTop = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
`;

const WorkspaceIconWrap = styled.div`
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: var(--forge-bg-deep);

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-status="live"] {
    border-color: rgba(60, 203, 127, 0.28);
    color: var(--forge-green);
    background: rgba(60, 203, 127, 0.08);
  }

  &[data-status="syncing"] {
    border-color: rgba(223, 165, 90, 0.28);
    color: var(--forge-amber);
    background: rgba(223, 165, 90, 0.08);
  }
`;

const WorkspaceTitleBlock = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;
`;

const WorkspaceTitle = styled.strong`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.12;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkspaceMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkspaceStatus = styled(StatusPill)`
  min-width: 48px;
  max-width: 72px;
  padding: 4px 7px;
  font-size: 9px;
`;

const WorkspaceStats = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
`;

const WorkspaceStat = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 6px;
  border: 1px solid rgba(144, 155, 170, 0.14);
  border-radius: 7px;
  color: var(--forge-text-soft);
  background: rgba(230, 236, 245, 0.022);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1;

  svg {
    width: 13px;
    height: 13px;
    color: var(--forge-text-muted);
  }
`;

const WorkspaceEmpty = styled.div`
  position: relative;
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 9px;
  border: 1px dashed rgba(144, 155, 170, 0.2);
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: rgba(230, 236, 245, 0.014);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;

  &::before {
    position: absolute;
    top: 50%;
    left: -15px;
    width: 15px;
    height: 1px;
    background: rgba(144, 155, 170, 0.16);
    content: "";
  }

  svg {
    width: 16px;
    height: 16px;
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
