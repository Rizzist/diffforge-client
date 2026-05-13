import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ButtonHubIcon,
  ButtonKeyIcon,
  McpAccessGrid,
  McpAccessPanel,
  McpAccessTopline,
  McpEditorHeader,
  McpEditorPanel,
  McpEmptyAccess,
  McpHeaderPanel,
  McpHeaderMetrics,
  McpIdentityStatusLine,
  McpLayout,
  McpMetricPill,
  McpMountCopy,
  McpMountList,
  McpMountRow,
  McpPanelTopline,
  McpRegistryPanel,
  McpServerButton,
  McpServerCopy,
  McpServerIcon,
  McpServerList,
  McpStatusBadge,
  McpTitleRow,
  McpToolChip,
  McpToolList,
  McpWorkspaceSurface,
  PageSubline,
  PanelKicker,
  PanelHeading,
  TerminalAgentDot,
  VaultPlaceholderIcon,
} from "../app/appStyles";

const COORDINATION_TOOLS = [
  "start_task",
  "acquire_lease",
  "checkpoint",
  "submit_patch",
];

function unwrapData(response, fallback = {}) {
  if (!response || typeof response !== "object") {
    return fallback;
  }

  return response.data || response;
}

function errorMessage(error) {
  if (typeof error === "string") {
    return error;
  }
  if (error?.message) {
    return error.message;
  }
  return "Unable to load workspace MCP state.";
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAgentKind(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("claude")) return "claude";
  if (text.includes("open") || text.includes("opencode")) return "opencode";
  if (text.includes("codex")) return "codex";
  return "generic";
}

function agentKindLabel(value) {
  const kind = normalizeAgentKind(value);
  if (kind === "claude") return "Claude Code";
  if (kind === "opencode") return "Open Code";
  if (kind === "codex") return "Codex";
  return "Agent";
}

function mountAgentKind(mount) {
  return mount?.agent_kind || mount?.agent_name || "";
}

function slotColorSlot(slotKey) {
  const match = String(slotKey || "").match(/\d+/);
  const slotNumber = match ? Number.parseInt(match[0], 10) : 1;
  const safeIndex = Math.max(0, (Number.isFinite(slotNumber) ? slotNumber : 1) - 1);
  return String(safeIndex % 16);
}

function statusLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "Unknown";
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function badgeState(statusValue) {
  const statusText = String(statusValue || "").toLowerCase();
  if (["confirmed", "healthy", "idle"].includes(statusText)) return "enabled";
  if (["blocked", "error", "not_seen"].includes(statusText)) return "blocked";
  return "planned";
}

function workspaceIdentityState({ health, isReady, status, workspaceId }) {
  if (!workspaceId || status === "missing_workspace") {
    return { label: "Blocked", state: "blocked" };
  }
  if (status === "error") {
    return { label: "Blocked", state: "blocked" };
  }
  if (!isReady) {
    return { label: "Checking", state: "planned" };
  }
  if (health?.config_generated || health?.status === "healthy") {
    return { label: "Confirmed", state: "enabled" };
  }
  return { label: "Not confirmed", state: "planned" };
}

export default function McpsWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  workspace,
}) {
  const workspaceName = workspace?.name || "Workspace";
  const workspaceId = workspace?.id || "";
  const repoPath = rootDirectory || defaultWorkingDirectory || "";
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [coordinator, setCoordinator] = useState(null);

  const commandBase = useMemo(() => ({ repoPath }), [repoPath]);

  const refresh = useCallback(async () => {
    setError("");
    setCoordinator(null);
    if (!repoPath || !workspaceId) {
      setStatus("missing_workspace");
      return;
    }

    setStatus("loading");
    try {
      const response = await invoke("coordination_get_workspace_mcp_status", {
        ...commandBase,
        workspaceId,
        workspaceName,
      });
      setCoordinator(unwrapData(response));
      setStatus("ready");
    } catch (caught) {
      setStatus("error");
      setError(errorMessage(caught));
    }
  }, [commandBase, repoPath, workspaceId, workspaceName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isReady = status === "ready" && coordinator;
  const health = coordinator?.health || {};
  const probe = health.spawn_probe || {};
  const clientMountSummary = health.agent_client_mount_summary || {};
  const clientMounts = clientMountSummary.mounts || [];
  const isHealthy = health.status === "healthy";
  const healthyCount = isHealthy ? 1 : 0;
  const probeToolCount = numberValue(probe.tool_count) || COORDINATION_TOOLS.length;
  const activeAgentCount = numberValue(clientMountSummary.active_session_count);
  const confirmedAgentCount = numberValue(clientMountSummary.confirmed_session_count);
  const identity = workspaceIdentityState({ health, isReady, status, workspaceId });

  return (
    <McpWorkspaceSurface aria-label="Workspace MCPs">
      <McpHeaderPanel>
        <McpTitleRow>
          <VaultPlaceholderIcon aria-hidden="true">
            <ButtonHubIcon />
          </VaultPlaceholderIcon>
          <div>
            <PanelKicker>MCPs</PanelKicker>
            <PanelHeading>{workspaceName} context servers</PanelHeading>
            <PageSubline>Workspace MCP tools and active agent mounts.</PageSubline>
          </div>
          <McpHeaderMetrics aria-label="MCP summary">
            <McpMetricPill data-state={isHealthy ? "enabled" : "planned"}>
              <strong>{healthyCount}</strong>
              <span>healthy</span>
            </McpMetricPill>
            <McpMetricPill data-state="enabled">
              <strong>{probeToolCount}</strong>
              <span>tools</span>
            </McpMetricPill>
            <McpMetricPill data-state={activeAgentCount ? "enabled" : "planned"}>
              <strong>{activeAgentCount}</strong>
              <span>agents</span>
            </McpMetricPill>
          </McpHeaderMetrics>
        </McpTitleRow>
      </McpHeaderPanel>

      <McpLayout>
        <McpRegistryPanel>
          <McpPanelTopline>
            <span>Registry</span>
            <strong>Workspace</strong>
          </McpPanelTopline>
          <McpServerList>
            <McpServerButton as="div" data-active="true">
              <McpServerIcon data-state={isReady ? "enabled" : "planned"}>
                <ButtonHubIcon aria-hidden="true" />
              </McpServerIcon>
              <McpServerCopy>
                <strong>Coordination Kernel</strong>
                <span>{workspaceId ? "Workspace MCP" : "Workspace identity missing"}</span>
              </McpServerCopy>
              <McpStatusBadge data-state={isHealthy ? "enabled" : isReady ? "planned" : "blocked"}>
                {isHealthy ? "Healthy" : isReady ? "Check" : "Blocked"}
              </McpStatusBadge>
            </McpServerButton>
          </McpServerList>
        </McpRegistryPanel>

        <McpEditorPanel>
          <McpEditorHeader>
            <div>
              <PanelKicker>Built-in</PanelKicker>
              <PanelHeading>Coordination Kernel MCP</PanelHeading>
              <PageSubline>
                Agent coordination tools for this workspace.
              </PageSubline>
            </div>
            <McpHeaderMetrics aria-label="Coordination kernel summary">
              <McpMetricPill data-state="enabled">
                <strong>{probeToolCount}</strong>
                <span>tools</span>
              </McpMetricPill>
              <McpMetricPill data-state={activeAgentCount ? "enabled" : "planned"}>
                <strong>{activeAgentCount}</strong>
                <span>{activeAgentCount === 1 ? "agent" : "agents"}</span>
              </McpMetricPill>
            </McpHeaderMetrics>
          </McpEditorHeader>

          {error && <McpEmptyAccess>{error}</McpEmptyAccess>}
          {!workspaceId && (
            <McpEmptyAccess>
              The Coordination Kernel MCP cannot start without the server-backed workspace UUID.
            </McpEmptyAccess>
          )}

          <McpAccessGrid>
            <McpAccessPanel>
              <McpAccessTopline>
                <span>
                  <ButtonHubIcon aria-hidden="true" />
                  Tool access
                </span>
                <McpStatusBadge data-state="enabled">Required</McpStatusBadge>
              </McpAccessTopline>
              <McpToolList aria-label="Coordination tools">
                {COORDINATION_TOOLS.map((tool) => (
                  <McpToolChip key={tool}>{tool}</McpToolChip>
                ))}
              </McpToolList>
            </McpAccessPanel>
            <McpAccessPanel>
              <McpAccessTopline>
                <span>
                  <ButtonKeyIcon aria-hidden="true" />
                  Workspace identity
                </span>
                <McpStatusBadge data-state={identity.state}>
                  {identity.label}
                </McpStatusBadge>
              </McpAccessTopline>
              <McpIdentityStatusLine data-state={identity.state}>
                <strong>{identity.label}</strong>
              </McpIdentityStatusLine>
            </McpAccessPanel>
          </McpAccessGrid>

          <McpAccessPanel>
            <McpAccessTopline>
              <span>
                <ButtonHubIcon aria-hidden="true" />
                Agent client mounts
              </span>
              <McpStatusBadge data-state={clientMountSummary.status === "confirmed" || clientMountSummary.status === "idle" ? "enabled" : "planned"}>
                {confirmedAgentCount}/{activeAgentCount}
              </McpStatusBadge>
            </McpAccessTopline>
            {clientMounts.length ? (
              <McpMountList>
                {clientMounts.slice(0, 8).map((mount) => {
                  const agentKind = mountAgentKind(mount);
                  const normalizedAgentKind = normalizeAgentKind(agentKind);
                  const slotKey = mount.slot_key || "";
                  return (
                    <McpMountRow key={mount.session_id || slotKey}>
                      <TerminalAgentDot
                        aria-hidden="true"
                        data-agent={normalizedAgentKind}
                        data-slot={slotColorSlot(slotKey)}
                      />
                      <McpMountCopy>
                        <strong>{agentKindLabel(agentKind)}</strong>
                        <span>{slotKey ? `Slot ${slotKey}` : "Active workspace agent"}</span>
                      </McpMountCopy>
                      <McpStatusBadge data-state={badgeState(mount.status)}>
                        {statusLabel(mount.status)}
                      </McpStatusBadge>
                    </McpMountRow>
                  );
                })}
              </McpMountList>
            ) : (
              <McpEmptyAccess>
                No active agent sessions have reported MCP client events yet.
              </McpEmptyAccess>
            )}
          </McpAccessPanel>
        </McpEditorPanel>
      </McpLayout>
    </McpWorkspaceSurface>
  );
}
