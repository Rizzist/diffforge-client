use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};

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
    pub agent_slot_id: Option<String>,
    pub slot_key: Option<String>,
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
    pub context_run_id: Option<String>,
    pub context_role: Option<String>,
    pub warnings: Vec<String>,
}

impl TerminalCoordinationContext {
    pub fn env_vars(&self) -> Vec<(String, String)> {
        let cloud_mcp_repo_id = cloud_mcp_repo_id_for_path(&self.repo_path);
        let mut values = vec![
            ("COORDINATION_ENABLED".to_string(), "1".to_string()),
            ("COORDINATION_AGENT_ID".to_string(), self.agent_id.clone()),
            ("DIFFFORGE_AGENT_ID".to_string(), self.agent_id.clone()),
            ("CLOUD_MCP_AGENT_ID".to_string(), self.agent_id.clone()),
            (
                "CLOUD_MCP_CONTEXT_AGENT_ID".to_string(),
                self.agent_id.clone(),
            ),
            (
                "COORDINATION_SESSION_ID".to_string(),
                self.session_id.clone(),
            ),
            ("DIFFFORGE_SESSION_ID".to_string(), self.session_id.clone()),
            ("CLOUD_MCP_SESSION_ID".to_string(), self.session_id.clone()),
            ("COORDINATION_REPO_PATH".to_string(), self.repo_path.clone()),
            ("DIFFFORGE_REPO_PATH".to_string(), self.repo_path.clone()),
            ("CLOUD_MCP_REPO_PATH".to_string(), self.repo_path.clone()),
            ("CLOUD_MCP_REPO_ID".to_string(), cloud_mcp_repo_id),
            ("COORDINATION_DB_PATH".to_string(), self.db_path.clone()),
            (
                "COORDINATION_WRITE_ROOT".to_string(),
                self.write_root.clone(),
            ),
            (
                "COORDINATION_PROJECT_ROOT".to_string(),
                self.repo_path.clone(),
            ),
            (
                "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
                self.write_root.clone(),
            ),
            (
                "COORDINATION_MERGE_TARGET_ROOT".to_string(),
                self.repo_path.clone(),
            ),
            (
                "COORDINATION_SHELL_CWD_POLICY".to_string(),
                "project_root_visible_branch_root_editable".to_string(),
            ),
            (
                "COORDINATION_SHELL_CWD_IS_PROJECT_ROOT".to_string(),
                "1".to_string(),
            ),
            (
                "COORDINATION_DIRECT_PROJECT_ROOT_WRITES_POLICY".to_string(),
                "block_patch_and_merge".to_string(),
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
                "COORDINATION_OBJECTIVE_KEY".to_string(),
                self.objective_key.clone(),
            ),
            ("COORDINATION_MCP_ALWAYS_ON".to_string(), "1".to_string()),
        ];

        if let Some(value) = &self.workspace_id {
            values.push(("COORDINATION_WORKSPACE_ID".to_string(), value.clone()));
            values.push(("CLOUD_MCP_WORKSPACE_ID".to_string(), value.clone()));
        }
        if let Some(value) = &self.agent_slot_id {
            values.push(("COORDINATION_AGENT_SLOT_ID".to_string(), value.clone()));
        }
        if let Some(value) = &self.slot_key {
            values.push(("COORDINATION_SLOT_KEY".to_string(), value.clone()));
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
        if let Some(value) = &self.context_run_id {
            values.push((
                "COORDINATION_CONTEXT_RUN_ID".to_string(),
                value.clone(),
            ));
        }
        if let Some(value) = &self.context_role {
            values.push(("COORDINATION_CONTEXT_ROLE".to_string(), value.clone()));
        }

        values
    }

    pub fn banner(&self) -> String {
        let task = self.task_id.as_deref().unwrap_or("none");
        let workspace = self.workspace_id.as_deref().unwrap_or("none");
        let slot = self.slot_key.as_deref().unwrap_or("none");
        let worktree = self.worktree_path.as_deref().unwrap_or(&self.write_root);
        let branch = self
            .slot_key
            .as_deref()
            .map(|slot_key| format!("agent/{slot_key}"))
            .unwrap_or_else(|| "none".to_string());
        let mut banner = format!(
            "COORDINATION ENABLED\nProject root: {}\nAgent branch: {}\nAgent branch root: {}\nMerge target root: {}\nShell cwd is the project root for orientation; the editable checkout is COORDINATION_AGENT_BRANCH_ROOT.\nAgent: {}\nSlot: {}\nSession: {}\nWorkspace: {}\nObjective Key: {}\nTask: {}\nMCP config: {}\nThis slot reuses the same MCP config and branch root across sessions.\nCoordinator MCP: always on\nCloud MCP context pack: always on\nDo not edit the shared project root directly. Direct project-root writes are policy violations and block patch/merge.\nBefore editing:\n1. call cloud-diffforge.cloud_get_context_pack with the user's prompt plus your own public work_summary/task_title so other agents know what you are about to do\n2. call get_brief immediately so the kernel records MCP client mount proof\n3. claim_task\n4. search_memory for relevant decisions/contracts/handoffs\n5. post_plan\n6. acquire_lease for files/symbols/db resources\n7. edit only inside COORDINATION_AGENT_BRANCH_ROOT\n8. after each file-change subtask, call cloud-diffforge.cloud_subtask_checkpoint with a terse public brief and changed files\n9. write contract/handoff memory if another agent depends on your work\n10. submit_patch when done, then report done to Cloud MCP with cloud_subtask_checkpoint or cloud_update_context_task\nFor merge-resolution tasks: fetch Cloud MCP context first, resolve only leased files, submit_patch, and never apply_merge.\nDo not merge directly. The user applies accepted patches through the local merge gate.\n",
            self.repo_path,
            branch,
            worktree,
            self.repo_path,
            self.agent_id,
            slot,
            self.session_id,
            workspace,
            self.objective_key,
            task,
            self.mcp_config_path
        );

        if self.enforcement_mode == "coordination_only" {
            banner.push_str(
                "WARNING: Safe parallel write isolation is unavailable because git worktree setup failed or this repo has no .git. submit_patch and merge are blocked by default.\n",
            );
        }

        banner
    }
}

fn cloud_mcp_repo_id_for_path(path: &str) -> String {
    let digest = Sha1::digest(path.as_bytes());
    let hex = format!("{digest:x}");
    format!("repo-{}", &hex[..12.min(hex.len())])
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
