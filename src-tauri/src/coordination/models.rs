use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::path::Path;

fn bool_is_false(value: &bool) -> bool {
    !*value
}

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
    pub agent_kind: String,
    pub agent_slot_id: Option<String>,
    pub slot_key: Option<String>,
    pub session_id: String,
    pub terminal_launch_epoch: Option<String>,
    pub task_id: Option<String>,
    pub worktree_id: Option<String>,
    pub worktree_path: Option<String>,
    pub write_root: String,
    pub enforcement_mode: String,
    pub db_path: String,
    pub repo_path: String,
    pub mcp_config_path: String,
    pub codex_mcp_config_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_home_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_profile: Option<String>,
    #[serde(default, skip_serializing_if = "bool_is_false")]
    pub codex_bypass_hook_trust: bool,
    pub claude_mcp_config_path: String,
    pub mcp_command: String,
    pub workspace_id: Option<String>,
    pub workspace_mcp_allowed_tools: Vec<String>,
    pub objective_key: String,
    pub context_run_id: Option<String>,
    pub context_role: Option<String>,
    pub warnings: Vec<String>,
}

impl TerminalCoordinationContext {
    fn architecture_root_path(&self) -> String {
        Path::new(&self.repo_path)
            .join(".agents")
            .join("architectures")
            .display()
            .to_string()
    }

    fn architecture_guide_path(&self) -> String {
        Path::new(&self.repo_path)
            .join(".agents")
            .join("architectures")
            .join("AGENTS.md")
            .display()
            .to_string()
    }

    fn architecture_icon_reference_path(&self) -> String {
        Path::new(&self.repo_path)
            .join(".agents")
            .join("architectures")
            .join("icon-aliases.json")
            .display()
            .to_string()
    }

    pub fn file_authority(&self) -> &'static str {
        match self.enforcement_mode.as_str() {
            "general_worker" => "task_scoped",
            "worktree_required" => "git_worktree_patch",
            "bounded_direct_edit" => "bounded_direct_edit",
            "activity_only" => "none",
            "remote_unmanaged" => "remote_unmanaged",
            "coordination_only" => "none",
            "read_only" => "none",
            _ => "external_unmanaged",
        }
    }

    pub fn session_mode(&self) -> &'static str {
        match self.enforcement_mode.as_str() {
            "general_worker" => "general",
            "worktree_required" => "managed_patch",
            "bounded_direct_edit" => "direct_edit",
            "activity_only" => "activity",
            "remote_unmanaged" => "remote_ops",
            "coordination_only" | "read_only" => "activity",
            _ => "free",
        }
    }

    pub fn completion_mode(&self) -> &'static str {
        if self.enforcement_mode == "worktree_required" {
            "submit_patch"
        } else {
            "complete_task"
        }
    }

    pub fn env_vars(&self) -> Vec<(String, String)> {
        let cloud_mcp_repo_id = cloud_mcp_repo_id_for_path(&self.repo_path);
        let architecture_root = self.architecture_root_path();
        let architecture_guide = self.architecture_guide_path();
        let architecture_icon_reference = self.architecture_icon_reference_path();
        let cwd_policy = if self.enforcement_mode == "worktree_required" {
            "visible_project_root_with_explicit_worktree_writes"
        } else {
            "coordination_root_editable"
        };
        let shell_cwd_is_project_root = if self.enforcement_mode == "worktree_required" {
            "1"
        } else {
            "1"
        };
        let direct_write_policy = if self.enforcement_mode == "bounded_direct_edit" {
            "allowed_for_bounded_direct_edit"
        } else if self.enforcement_mode == "general_worker" {
            "resolved_by_task_authority"
        } else if self.enforcement_mode == "worktree_required" {
            "deny_root_use_agent_branch_root"
        } else {
            "not_a_file_editing_authority"
        };
        let patch_gate = if self.enforcement_mode == "worktree_required" {
            "required"
        } else {
            "not_available"
        };
        let mut values = vec![
            ("COORDINATION_ENABLED".to_string(), "1".to_string()),
            ("COORDINATION_AGENT_ID".to_string(), self.agent_id.clone()),
            (
                "COORDINATION_AGENT_KIND".to_string(),
                self.agent_kind.clone(),
            ),
            ("DIFFFORGE_AGENT_KIND".to_string(), self.agent_kind.clone()),
            ("CLOUD_MCP_AGENT_KIND".to_string(), self.agent_kind.clone()),
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
            (
                "COORDINATION_TERMINAL_LAUNCH_EPOCH".to_string(),
                self.terminal_launch_epoch.clone().unwrap_or_default(),
            ),
            ("COORDINATION_REPO_PATH".to_string(), self.repo_path.clone()),
            ("DIFFFORGE_REPO_PATH".to_string(), self.repo_path.clone()),
            ("CLOUD_MCP_REPO_PATH".to_string(), self.repo_path.clone()),
            ("CLOUD_MCP_REPO_ID".to_string(), cloud_mcp_repo_id),
            (
                "DIFFFORGE_ARCHITECTURES_ROOT".to_string(),
                architecture_root.clone(),
            ),
            (
                "COORDINATION_ARCHITECTURES_ROOT".to_string(),
                architecture_root,
            ),
            (
                "DIFFFORGE_ARCHITECTURE_GUIDE".to_string(),
                architecture_guide,
            ),
            (
                "DIFFFORGE_ARCHITECTURE_ICON_REFERENCE".to_string(),
                architecture_icon_reference,
            ),
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
                "COORDINATION_VISIBLE_ROOT".to_string(),
                self.repo_path.clone(),
            ),
            ("DIFFFORGE_VISIBLE_ROOT".to_string(), self.repo_path.clone()),
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
                cwd_policy.to_string(),
            ),
            (
                "COORDINATION_SHELL_CWD_IS_PROJECT_ROOT".to_string(),
                shell_cwd_is_project_root.to_string(),
            ),
            (
                "COORDINATION_DIRECT_PROJECT_ROOT_WRITES_POLICY".to_string(),
                direct_write_policy.to_string(),
            ),
            (
                "COORDINATION_ENFORCEMENT_MODE".to_string(),
                self.enforcement_mode.clone(),
            ),
            (
                "COORDINATION_FILE_AUTHORITY".to_string(),
                self.file_authority().to_string(),
            ),
            (
                "COORDINATION_SESSION_MODE".to_string(),
                self.session_mode().to_string(),
            ),
            (
                "COORDINATION_COMPLETION_MODE".to_string(),
                self.completion_mode().to_string(),
            ),
            (
                "COORDINATION_PATCH_GATE".to_string(),
                patch_gate.to_string(),
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
            (
                "DIFFFORGE_WORKSPACE_MCP_ALLOWED_TOOLS".to_string(),
                self.workspace_mcp_allowed_tools.join(","),
            ),
        ];

        if self.agent_kind.to_ascii_lowercase().contains("codex") {
            if let Some(home_path) = &self.codex_home_path {
                if !home_path.trim().is_empty() {
                    values.push(("CODEX_HOME".to_string(), home_path.clone()));
                    values.push(("DIFFFORGE_CODEX_HOME".to_string(), home_path.clone()));
                }
            }
            if let Some(profile) = &self.codex_profile {
                if !profile.trim().is_empty() {
                    values.push(("DIFFFORGE_CODEX_PROFILE".to_string(), profile.clone()));
                }
            }
            if self.codex_bypass_hook_trust {
                values.push((
                    "DIFFFORGE_CODEX_BYPASS_HOOK_TRUST".to_string(),
                    "1".to_string(),
                ));
            }
        }

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
            values.push(("COORDINATION_CONTEXT_RUN_ID".to_string(), value.clone()));
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
        let architecture_root = self.architecture_root_path();
        let architecture_guide = self.architecture_guide_path();
        let architecture_icon_reference = self.architecture_icon_reference_path();
        let branch = self
            .slot_key
            .as_deref()
            .map(|slot_key| format!("agent/{slot_key}"))
            .unwrap_or_else(|| "none".to_string());
        let mut banner = if self.enforcement_mode == "worktree_required" {
            format!(
            "COORDINATION ENABLED\nProject root: {}\nAgent branch: {}\nAgent branch root: {}\nMerge target root: {}\n\
Merge integration branch: diff-forge/integration\nShell cwd opens in the visible project root, not inside .agents/worktrees. The visible project root is read-only for coordinated Git writes; this terminal's assigned agent branch root is the only writable Git surface.\nAgent: {}\nSlot: {}\nSession: {}\nWorkspace: {}\nObjective Key: {}\nTask: {}\nMCP config: {}\nArchitecture root: {}\nArchitecture guide: {}\nArchitecture icon reference: {}\nThis slot reuses the same MCP config and branch root across sessions.\nCoordinator MCP: always on\nCloud MCP lifecycle: automatic through Diff Forge Rust, not agent-called\nArchitecture graphs are repo-scoped Diff Forge artifacts. For architecture/diagram/system-map work, inspect existing .arch files under the architecture root, then create or update .agents/architectures/graphs/*.arch using the eraser-like DSL. Do not create ARCHITECTURE.md, docs/architecture.md, Draw.io, SVG, or PNG architecture artifacts unless the user explicitly asks for those formats. Use icon aliases such as api, database, worker, aws:s3, postgres, redis, github, or cockroachdb; unknown icons should fall back to semantic aliases.\nDo not directly edit the shared project root or another agent slot's worktree. Git writes require start_task, a write lease, and explicit file targets under the assigned branch root shown above.\nRead-only inspection is free: open, search, and inspect files normally from the visible project root without calling start_task or checkpoint.\nBefore the first edit:\n1. call coordination-kernel.start_task only when you are ready to edit, with a short plan for the immediate change. Cloud MCP must return a task_id first; Rust then mirrors that exact id locally, refreshes cloud context, and returns the current task_id, branch root, and peer state.\n2. acquire_lease using the task_id returned by start_task and resource_key values such as file:index.html or glob:src/**. Do not send paths[] to acquire_lease. If a lease says queued behind an active lease or unmerged patch, do not recreate that file, do not sleep or poll manually, and do not mark the work done. Stop on the blocked work; Rust will wake and resume this same terminal after the dependency patch is accepted, integration is refreshed, and the file is ready. Continue only with non-overlapping files whose leases succeed.\n3. after the lease, inspect from the visible project root. For Git-managed edits, target the assigned branch root in COORDINATION_AGENT_BRANCH_ROOT explicitly; never write into the merge target root or another slot's .agents/worktrees directory.\n4. when Rust resumes a parked task, inspect the refreshed target file/context first, then call start_task again with your continuation edit plan, acquire the lease with the returned task_id, and continue.\n5. call checkpoint with that task_id only while a task is active and after meaningful edit progress; do not checkpoint reconnaissance.\n6. submit_patch with that task_id when done. A passing submit_patch automatically queues and applies the accepted patch as a local integration-branch commit when safe.\nFor autonomous intent-resolution tasks: treat current integration as source of truth, preserve every compatible task intent without asking the user, resolve only leased files, submit_patch, and never apply_merge.\nDo not call request_merge or apply_merge directly; submit_patch owns the automatic accept/apply path.\n",
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
            self.mcp_config_path,
            architecture_root,
            architecture_guide,
            architecture_icon_reference
        )
        } else {
            let authority_note = match self.enforcement_mode.as_str() {
                "general_worker" => "This terminal is a general workspace worker. It starts in the workspace root; file authority is resolved when concrete task work requests it.",
                "bounded_direct_edit" => "This terminal may edit only this bounded project root directly. It does not have git worktree isolation and must finish with complete_task instead of submit_patch.",
                "activity_only" => "This terminal is for coordinated activity tracking. It has no local file authority; use start_task/checkpoint/complete_task for visible work logs.",
                "remote_unmanaged" => "This terminal is for remote or external operations. It has no local file authority; use start_task/checkpoint/complete_task for visible work logs.",
                _ => "This terminal is coordinated for task tracking only. It has no patch submission authority.",
            };
            format!(
                "COORDINATION ENABLED\nProject root: {}\nCoordination root: {}\nAgent: {}\nSlot: {}\nSession: {}\nWorkspace: {}\nObjective Key: {}\nTask: {}\nMCP config: {}\nArchitecture root: {}\nArchitecture guide: {}\nArchitecture icon reference: {}\nCoordinator MCP: always on\nCloud MCP lifecycle: automatic through Diff Forge Rust, not agent-called\nMode: {}\nFile authority: {}\nCompletion: complete_task\n{}\nArchitecture graphs are repo-scoped Diff Forge artifacts. For architecture/diagram/system-map work, inspect existing .arch files under the architecture root, then create or update .agents/architectures/graphs/*.arch using the eraser-like DSL. Do not create ARCHITECTURE.md, docs/architecture.md, Draw.io, SVG, or PNG architecture artifacts unless the user explicitly asks for those formats. Use icon aliases such as api, database, worker, aws:s3, postgres, redis, github, or cockroachdb; unknown icons should fall back to semantic aliases.\nRead-only inspection is free: open, search, and inspect files normally without calling start_task or checkpoint.\nWhen work begins, call coordination-kernel.start_task with a short plan. For local file edits, acquire a lease before editing; Diff Forge will return the direct project root or isolated worktree authority for this task. Checkpoint only meaningful active progress. Finish with submit_patch when an isolated worktree is assigned, otherwise complete_task.\n",
                self.repo_path,
                self.write_root,
                self.agent_id,
                slot,
                self.session_id,
                workspace,
                self.objective_key,
                task,
                self.mcp_config_path,
                architecture_root,
                architecture_guide,
                architecture_icon_reference,
                self.session_mode(),
                self.file_authority(),
                authority_note,
            )
        };

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
