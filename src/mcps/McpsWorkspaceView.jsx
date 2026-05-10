import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ButtonHubIcon,
  ButtonKeyIcon,
  ButtonSettingsIcon,
  McpAccessGrid,
  McpAccessPanel,
  McpAccessTopline,
  McpEditorHeader,
  McpEditorPanel,
  McpEmptyAccess,
  McpHeaderPanel,
  McpLayout,
  McpPanelTopline,
  McpRegistryPanel,
  McpScopePreview,
  McpServerButton,
  McpServerCopy,
  McpServerIcon,
  McpServerList,
  McpStatsGrid,
  McpStatusBadge,
  McpTitleRow,
  McpWorkspaceSurface,
  PageSubline,
  PanelKicker,
  PanelHeading,
  SecondaryButton,
  SettingsIdentityItem,
  VaultPlaceholderIcon,
} from "../app/appStyles";

const COORDINATION_TOOLS = [
  "get_brief",
  "claim_task",
  "post_plan",
  "acquire_lease",
  "renew_lease",
  "release_lease",
  "list_active_leases",
  "announce_change",
  "validate_patch",
  "submit_patch",
  "list_workspace_violations",
  "get_slot_status",
  "search_memory",
  "write_memory",
  "db_get_mode",
  "db_classify_sql",
  "db_attach_migration_proposal",
  "db_propose_migration",
  "db_request_approval",
  "request_approval",
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

function shortPath(value) {
  if (!value) {
    return "Not generated";
  }
  const text = String(value);
  return text.length > 84 ? `...${text.slice(-81)}` : text;
}

export default function McpsWorkspaceView({
  defaultWorkingDirectory,
  onOpenSettings,
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
  const objectiveKey = coordinator?.objective_key || workspaceId;

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
            <PageSubline>Workspace-scoped MCP registry and access state.</PageSubline>
          </div>
          {onOpenSettings && (
            <SecondaryButton onClick={onOpenSettings} type="button">
              <ButtonSettingsIcon aria-hidden="true" />
              <span>Settings</span>
            </SecondaryButton>
          )}
        </McpTitleRow>

        <McpStatsGrid>
          <SettingsIdentityItem>
            <span>Connected</span>
            <strong>{isReady ? "1 server" : "0 servers"}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Coordinator MCP</span>
            <strong>{isReady ? "Auto-on" : "Requires workspace UUID"}</strong>
          </SettingsIdentityItem>
          <SettingsIdentityItem>
            <span>Objective key</span>
            <strong>{objectiveKey || "Missing"}</strong>
          </SettingsIdentityItem>
        </McpStatsGrid>
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
                <span>{workspaceId ? "Built-in workspace MCP" : "Workspace UUID missing"}</span>
              </McpServerCopy>
              <McpStatusBadge data-state={isReady ? "enabled" : "planned"}>
                {isReady ? "Auto-on" : "Blocked"}
              </McpStatusBadge>
            </McpServerButton>
            <McpServerButton as="div">
              <McpServerIcon>
                <ButtonKeyIcon aria-hidden="true" />
              </McpServerIcon>
              <McpServerCopy>
                <strong>Secrets</strong>
                <span>Not exposed to agent MCPs</span>
              </McpServerCopy>
              <McpStatusBadge>Locked</McpStatusBadge>
            </McpServerButton>
          </McpServerList>
        </McpRegistryPanel>

        <McpEditorPanel>
          <McpEditorHeader>
            <div>
              <PanelKicker>Built-in</PanelKicker>
              <PanelHeading>Coordination Kernel MCP</PanelHeading>
              <PageSubline>
                Always on for this workspace. The objective key is the server-backed workspace UUID.
              </PageSubline>
            </div>
            <McpStatusBadge data-state={isReady ? "enabled" : "planned"}>
              {isReady ? "Enabled" : "Needs UUID"}
            </McpStatusBadge>
          </McpEditorHeader>

          {error && <McpEmptyAccess>{error}</McpEmptyAccess>}
          {!workspaceId && (
            <McpEmptyAccess>
              The Coordination Kernel MCP cannot start without the server-backed workspace UUID.
            </McpEmptyAccess>
          )}

          <McpScopePreview>
            <SettingsIdentityItem>
              <span>Transport</span>
              <strong>stdio</strong>
            </SettingsIdentityItem>
            <SettingsIdentityItem>
              <span>Toggle</span>
              <strong>Unavailable</strong>
            </SettingsIdentityItem>
            <SettingsIdentityItem>
              <span>Scope</span>
              <strong>{workspaceId || "Missing UUID"}</strong>
            </SettingsIdentityItem>
          </McpScopePreview>

          <McpAccessGrid>
            <McpAccessPanel>
              <McpAccessTopline>
                <span>
                  <ButtonHubIcon aria-hidden="true" />
                  Tool access
                </span>
                <McpStatusBadge data-state="enabled">Required</McpStatusBadge>
              </McpAccessTopline>
              <McpEmptyAccess>
                {COORDINATION_TOOLS.join(", ")}
              </McpEmptyAccess>
            </McpAccessPanel>
            <McpAccessPanel>
              <McpAccessTopline>
                <span>
                  <ButtonKeyIcon aria-hidden="true" />
                  Workspace identity
                </span>
                <McpStatusBadge data-state={workspaceId ? "enabled" : "planned"}>
                  {workspaceId ? "Server UUID" : "Missing"}
                </McpStatusBadge>
              </McpAccessTopline>
              <McpEmptyAccess>
                Objective key: {objectiveKey || "missing"}
                <br />
                Config: {shortPath(coordinator?.config_path)}
                <br />
                Codex: {shortPath(coordinator?.codex_config_path)}
                <br />
                Claude: {shortPath(coordinator?.claude_config_path)}
              </McpEmptyAccess>
            </McpAccessPanel>
          </McpAccessGrid>

          <McpAccessPanel>
            <McpAccessTopline>
              <span>
                <ButtonKeyIcon aria-hidden="true" />
                Security boundary
              </span>
            </McpAccessTopline>
            <McpEmptyAccess>
              Production SQL credentials are not placed in agent env or MCP config. The hosted workspace UUID is used only as local coordination identity.
            </McpEmptyAccess>
          </McpAccessPanel>
        </McpEditorPanel>
      </McpLayout>
    </McpWorkspaceSurface>
  );
}
