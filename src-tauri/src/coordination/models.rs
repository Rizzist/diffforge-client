use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEnvelope {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiErrorEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorEnvelope {
    pub code: String,
    pub message: String,
    pub details: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCoordinationContext {
    pub agent_id: String,
    pub session_id: String,
    pub task_id: Option<String>,
    pub worktree_id: Option<String>,
    pub worktree_path: Option<String>,
    pub write_root: String,
    pub enforcement_mode: String,
    pub db_path: String,
    pub repo_path: String,
    pub mcp_config_path: String,
    pub codex_mcp_config_path: String,
    pub claude_mcp_config_path: String,
    pub mcp_command: String,
    pub workspace_id: Option<String>,
    pub objective_key: String,
    pub orchestration_run_id: Option<String>,
    pub orchestration_role: Option<String>,
    pub cloud_orchestrator_enabled: bool,
    pub warnings: Vec<String>,
}

impl TerminalCoordinationContext {
    pub fn env_vars(&self) -> Vec<(String, String)> {
        let mut values = vec![
            ("COORDINATION_ENABLED".to_string(), "1".to_string()),
            ("COORDINATION_AGENT_ID".to_string(), self.agent_id.clone()),
            (
                "COORDINATION_SESSION_ID".to_string(),
                self.session_id.clone(),
            ),
            ("COORDINATION_REPO_PATH".to_string(), self.repo_path.clone()),
            ("COORDINATION_DB_PATH".to_string(), self.db_path.clone()),
            (
                "COORDINATION_WRITE_ROOT".to_string(),
                self.write_root.clone(),
            ),
            (
                "COORDINATION_ENFORCEMENT_MODE".to_string(),
                self.enforcement_mode.clone(),
            ),
            (
                "COORDINATION_PATCH_GATE".to_string(),
                "required".to_string(),
            ),
            (
                "COORDINATION_MCP_COMMAND".to_string(),
                self.mcp_command.clone(),
            ),
            (
                "COORDINATION_MCP_CONFIG_PATH".to_string(),
                self.mcp_config_path.clone(),
            ),
            ("MCP_CONFIG_PATH".to_string(), self.mcp_config_path.clone()),
            (
                "CODEX_MCP_CONFIG".to_string(),
                self.codex_mcp_config_path.clone(),
            ),
            (
                "CODEX_CONFIG_FILE".to_string(),
                self.codex_mcp_config_path.clone(),
            ),
            (
                "CODEX_PROJECT_CONFIG".to_string(),
                self.codex_mcp_config_path.clone(),
            ),
            (
                "CLAUDE_MCP_CONFIG".to_string(),
                self.claude_mcp_config_path.clone(),
            ),
            (
                "CLAUDE_CODE_MCP_CONFIG".to_string(),
                self.claude_mcp_config_path.clone(),
            ),
            (
                "COORDINATION_CLOUD_ORCHESTRATOR_ENABLED".to_string(),
                if self.cloud_orchestrator_enabled {
                    "1"
                } else {
                    "0"
                }
                .to_string(),
            ),
            (
                "COORDINATION_OBJECTIVE_KEY".to_string(),
                self.objective_key.clone(),
            ),
            ("COORDINATION_MCP_ALWAYS_ON".to_string(), "1".to_string()),
        ];

        if let Some(value) = &self.workspace_id {
            values.push(("COORDINATION_WORKSPACE_ID".to_string(), value.clone()));
        }
        if let Some(value) = &self.task_id {
            values.push(("COORDINATION_TASK_ID".to_string(), value.clone()));
        }
        if let Some(value) = &self.worktree_id {
            values.push(("COORDINATION_WORKTREE_ID".to_string(), value.clone()));
        }
        if let Some(value) = &self.worktree_path {
            values.push(("COORDINATION_WORKTREE_PATH".to_string(), value.clone()));
        }
        if let Some(value) = &self.orchestration_run_id {
            values.push((
                "COORDINATION_ORCHESTRATION_RUN_ID".to_string(),
                value.clone(),
            ));
        }
        if let Some(value) = &self.orchestration_role {
            values.push(("COORDINATION_ORCHESTRATION_ROLE".to_string(), value.clone()));
        }

        values
    }

    pub fn banner(&self) -> String {
        let cloud = if self.cloud_orchestrator_enabled {
            "enabled"
        } else {
            "disabled"
        };
        let task = self.task_id.as_deref().unwrap_or("none");
        let role = self.orchestration_role.as_deref().unwrap_or("none");
        let run = self.orchestration_run_id.as_deref().unwrap_or("none");
        let workspace = self.workspace_id.as_deref().unwrap_or("none");
        let worktree = self.worktree_path.as_deref().unwrap_or(&self.write_root);
        let mut banner = format!(
            "COORDINATION ENABLED\nYou are in an isolated worktree.\nAgent: {}\nSession: {}\nWorkspace: {}\nObjective Key: {}\nTask: {}\nRole: {}\nOrchestration Run: {}\nWorktree: {}\nCoordinator MCP: always on\nCloud Orchestrator: {}\nDo not edit the shared repo root directly.\nBefore editing:\n1. call get_brief\n2. claim_task\n3. search_memory for relevant decisions/contracts/handoffs\n4. post_plan\n5. acquire_lease for files/symbols/db resources\n6. edit only inside COORDINATION_WORKTREE_PATH\n7. write contract/handoff memory if another agent depends on your work\n8. submit_patch when done\nDo not merge directly. The kernel merge gate applies accepted patches.\n",
            self.agent_id,
            self.session_id,
            workspace,
            self.objective_key,
            task,
            role,
            run,
            worktree,
            cloud
        );

        if self.enforcement_mode == "coordination_only" {
            banner.push_str(
                "WARNING: Safe parallel write isolation is unavailable because git worktree setup failed or this repo has no .git. submit_patch and merge are blocked by default.\n",
            );
        }

        banner
    }
}

#[derive(Debug, Clone)]
pub struct PatchValidationResult {
    pub status: String,
    pub validation_id: String,
    pub patch_id: Option<String>,
    pub diff_artifact_id: Option<String>,
    pub diff_hash: Option<String>,
    pub changed_files: Vec<String>,
    pub violations: Vec<Value>,
    pub warnings: Vec<String>,
}
