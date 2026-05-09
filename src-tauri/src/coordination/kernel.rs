use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, types::ValueRef, Connection, ErrorCode, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    alignment,
    db::{canonical_repo_path, open_connection, process_path_text, StoragePaths, REPO_ID},
    events,
    models::{ApiEnvelope, ApiErrorEnvelope, PatchValidationResult, TerminalCoordinationContext},
    resources::{
        is_write_like, lease_modes_conflict, normalize_resource_key, path_to_file_resource,
        reject_path_escape, resource_covers, resource_risk_level, resource_type,
        resources_conflict,
    },
    sql_classifier,
};

const SESSION_STALE_SECONDS: i64 = 1800;
const DEFAULT_LEASE_TTL_SECONDS: i64 = 1800;
const CODEX_AUTO_APPROVED_COORDINATION_TOOLS: &[&str] = &[
    "get_brief",
    "claim_task",
    "post_plan",
    "acquire_lease",
    "db_acquire_lease",
    "renew_lease",
    "release_lease",
    "list_active_leases",
    "announce_change",
    "validate_patch",
    "list_workspace_violations",
    "search_memory",
    "db_get_mode",
    "db_classify_sql",
    "request_approval",
    "orchestrator_get_status",
    "orchestrator_list_runs",
    "orchestrator_get_brief",
];

pub fn now_rfc3339() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));

    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}

fn uuid() -> String {
    Uuid::new_v4().to_string()
}

fn bool_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

pub fn api_ok(data: Value) -> Value {
    serde_json::to_value(ApiEnvelope {
        ok: true,
        data: Some(data),
        warnings: Vec::new(),
        error: None,
    })
    .unwrap_or_else(|_| json!({"ok": true, "data": {}}))
}

pub fn api_ok_warnings(data: Value, warnings: Vec<String>) -> Value {
    serde_json::to_value(ApiEnvelope {
        ok: true,
        data: Some(data.clone()),
        warnings,
        error: None,
    })
    .unwrap_or_else(|_| json!({"ok": true, "data": data}))
}

pub fn api_error(code: &str, message: impl Into<String>, details: Value) -> Value {
    serde_json::to_value(ApiEnvelope {
        ok: false,
        data: None,
        warnings: Vec::new(),
        error: Some(ApiErrorEnvelope {
            code: code.to_string(),
            message: message.into(),
            details,
        }),
    })
    .unwrap_or_else(|_| json!({"ok": false, "error": {"code": code, "message": "Coordination error", "details": {}}}))
}

pub struct CoordinationKernel {
    pub paths: StoragePaths,
    pub conn: Connection,
}

impl CoordinationKernel {
    pub fn init(repo_path: impl AsRef<Path>, db_path: Option<PathBuf>) -> Result<Self, String> {
        Self::init_with_options(repo_path, db_path, true)
    }

    pub fn open(repo_path: impl AsRef<Path>, db_path: Option<PathBuf>) -> Result<Self, String> {
        Self::init_with_options(repo_path, db_path, false)
    }

    fn init_with_options(
        repo_path: impl AsRef<Path>,
        db_path: Option<PathBuf>,
        emit_recovery_event: bool,
    ) -> Result<Self, String> {
        let repo_path = canonical_repo_path(repo_path)?;
        let paths = StoragePaths::new(repo_path, db_path);
        let (conn, existed) = open_connection(&paths)?;
        let kernel = Self { paths, conn };

        kernel.insert_default_repo_policy()?;
        kernel.insert_default_cloud_config()?;
        kernel.expire_old_leases()?;
        kernel.mark_stale_sessions_interrupted()?;
        kernel.mark_duplicate_pty_sessions_interrupted()?;
        kernel.mark_unsafe_coordination_only_sessions_interrupted()?;
        if emit_recovery_event {
            kernel.emit_event(
                if existed {
                    events::KERNEL_RECOVERED
                } else {
                    events::KERNEL_INITIALIZED
                },
                "kernel",
                REPO_ID,
                EventRefs::default(),
                json!({
                    "repo_path": kernel.paths.repo_path.display().to_string(),
                    "db_path": kernel.paths.db_path.display().to_string(),
                    "cloud_orchestrator_enabled": false,
                }),
            )?;
        }

        Ok(kernel)
    }

    fn insert_default_repo_policy(&self) -> Result<(), String> {
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT OR IGNORE INTO repo_policies(
                    repo_id, repo_path, repo_has_sql, sql_engine, sql_mcp_default,
                    raw_sql_mcp_allowed, per_agent_db_required, shadow_validation_required,
                    prod_requires_human, agent_worktree_required, patch_lease_validation_required,
                    merge_gate_required, root_repo_write_policy, unleased_write_policy,
                    no_git_write_policy, merge_requires_clean_target,
                    merge_requires_human_for_unleased_override, cloud_orchestrator_enabled,
                    cloud_orchestrator_mode, cloud_context_export_policy,
                    cloud_allow_code_export, cloud_allow_terminal_log_export,
                    cloud_allow_patch_export, cloud_auto_create_tasks,
                    cloud_auto_assign_agents, cloud_auto_spawn_terminals,
                    cloud_auto_merge, cloud_contract_memory_enabled, policy_json,
                    created_at, updated_at
                ) VALUES(?1, ?2, 0, NULL, 'off', 0, 1, 1, 1, 1, 1, 1,
                    'detect_and_reject_patch', 'reject_patch', 'coordination_only', 1, 1,
                    0, 'disabled', 'local_only', 0, 0, 0, 0, 0, 0, 0, 1, NULL, ?3, ?3)",
                params![REPO_ID, self.paths.repo_path.display().to_string(), now],
            )
            .map_err(|error| format!("Unable to create default repo policy: {error}"))?;
        Ok(())
    }

    fn insert_default_cloud_config(&self) -> Result<(), String> {
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT OR IGNORE INTO cloud_orchestrator_configs(
                    id, repo_id, enabled, mode, endpoint_url, api_key_ref, model_hint,
                    context_export_policy, allow_code_export, allow_terminal_log_export,
                    allow_patch_export, auto_create_tasks, auto_assign_agents,
                    auto_spawn_terminals, auto_merge, sync_interval_seconds, last_sync_at,
                    status, created_at, updated_at
                ) VALUES('default', ?1, 0, 'disabled', NULL, NULL, NULL, 'local_only',
                    0, 0, 0, 0, 0, 0, 0, 0, NULL, 'disabled', ?2, ?2)",
                params![REPO_ID, now],
            )
            .map_err(|error| format!("Unable to create default cloud config: {error}"))?;
        Ok(())
    }

    pub fn emit_event(
        &self,
        event_type: &str,
        actor_type: &str,
        actor_id: &str,
        refs: EventRefs,
        payload: Value,
    ) -> Result<String, String> {
        let payload_json = payload.to_string();
        let task_id = refs.task_id.as_deref();
        let agent_id = refs.agent_id.as_deref();
        let session_id = refs.session_id.as_deref();
        let resource_id = refs.resource_id.as_deref();
        let artifact_id = refs.artifact_id.as_deref();
        let orchestration_run_id = refs.orchestration_run_id.as_deref();

        for attempt in 0..12 {
            let id = uuid();
            match self.conn.execute(
                "INSERT INTO events(
                    id, seq, event_type, actor_type, actor_id, task_id, agent_id, session_id,
                    resource_id, artifact_id, orchestration_run_id, payload_json, created_at
                ) VALUES(
                    ?1,
                    (SELECT COALESCE(MAX(seq), 0) + 1 FROM events),
                    ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
                )",
                params![
                    id,
                    event_type,
                    actor_type,
                    actor_id,
                    task_id,
                    agent_id,
                    session_id,
                    resource_id,
                    artifact_id,
                    orchestration_run_id,
                    payload_json,
                    now_rfc3339()
                ],
            ) {
                Ok(_) => return Ok(id),
                Err(error) if is_retryable_event_insert_error(&error) && attempt < 11 => {
                    std::thread::sleep(Duration::from_millis(15 + attempt * 10));
                }
                Err(error) => {
                    return Err(format!(
                        "Unable to append coordination event {event_type}: {error}"
                    ));
                }
            }
        }

        Err(format!(
            "Unable to append coordination event {event_type}: event sequence remained busy"
        ))
    }

    pub fn create_or_get_agent(
        &self,
        name: &str,
        kind: &str,
        role: Option<&str>,
    ) -> Result<Value, String> {
        let name = non_empty(name, "Agent name")?;
        let kind = non_empty(kind, "Agent kind")?;
        let now = now_rfc3339();
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM agents WHERE name = ?1 AND kind = ?2",
                params![name, kind],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Unable to inspect existing agent: {error}"))?;
        let id = existing.unwrap_or_else(uuid);

        self.conn
            .execute(
                "INSERT INTO agents(id, name, kind, status, role, created_at, updated_at)
                 VALUES(?1, ?2, ?3, 'available', ?4, ?5, ?5)
                 ON CONFLICT(id) DO UPDATE SET status='available', role=COALESCE(excluded.role, agents.role), updated_at=excluded.updated_at",
                params![id, name, kind, role, now],
            )
            .map_err(|error| format!("Unable to register agent: {error}"))?;
        self.emit_event(
            "agent_registered",
            "agent",
            &id,
            EventRefs {
                agent_id: Some(id.clone()),
                ..EventRefs::default()
            },
            json!({"name": name, "kind": kind, "role": role}),
        )?;

        Ok(json!({"id": id, "name": name, "kind": kind, "role": role, "status": "available"}))
    }

    pub fn create_task(
        &self,
        title: &str,
        body: Option<&str>,
        priority: i64,
        risk_level: i64,
        orchestration_run_id: Option<&str>,
        orchestration_plan_item_id: Option<&str>,
        assigned_role: Option<&str>,
        expected_output: Option<&str>,
    ) -> Result<Value, String> {
        let title = non_empty(title, "Task title")?;
        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO tasks(
                    id, title, body, status, priority, risk_level, orchestration_run_id,
                    orchestration_plan_item_id, assigned_role, expected_output, created_at, updated_at
                ) VALUES(?1, ?2, ?3, 'ready', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![
                    id,
                    title,
                    body,
                    priority,
                    risk_level,
                    orchestration_run_id,
                    orchestration_plan_item_id,
                    assigned_role,
                    expected_output,
                    now
                ],
            )
            .map_err(|error| format!("Unable to create coordination task: {error}"))?;
        self.emit_event(
            "task_created",
            "user",
            "local",
            EventRefs {
                task_id: Some(id.clone()),
                orchestration_run_id: orchestration_run_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({"title": title, "priority": priority, "risk_level": risk_level}),
        )?;

        Ok(json!({"id": id, "title": title, "status": "ready"}))
    }

    pub fn claim_task(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
    ) -> Result<Value, String> {
        self.ensure_session_active(session_id, agent_id)?;
        let blockers = self.unsatisfied_dependencies(task_id)?;
        if !blockers.is_empty() {
            self.emit_event(
                "task_blocked",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: Some(session_id.to_string()),
                    ..EventRefs::default()
                },
                json!({"blocking_tasks": blockers}),
            )?;
            return Err(format!(
                "Task {task_id} is blocked by unfinished dependencies."
            ));
        }

        let now = now_rfc3339();
        let changed = self
            .conn
            .execute(
                "UPDATE tasks
                 SET status='claimed', claimed_by_agent_id=?1, claimed_session_id=?2, updated_at=?3
                 WHERE id=?4 AND (claimed_session_id IS NULL OR claimed_session_id='')",
                params![agent_id, session_id, now, task_id],
            )
            .map_err(|error| format!("Unable to claim task: {error}"))?;

        if changed == 0 {
            return Err("Task is already claimed or does not exist.".to_string());
        }

        self.conn
            .execute(
                "UPDATE agent_sessions SET task_id=?1, updated_at=?2 WHERE id=?3",
                params![task_id, now, session_id],
            )
            .map_err(|error| format!("Unable to attach session to claimed task: {error}"))?;
        self.emit_event(
            "task_claimed",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({}),
        )?;

        Ok(
            json!({"task_id": task_id, "agent_id": agent_id, "session_id": session_id, "status": "claimed"}),
        )
    }

    fn unsatisfied_dependencies(&self, task_id: &str) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT depends_on_task_id
                 FROM task_dependencies d
                 LEFT JOIN tasks t ON t.id = d.depends_on_task_id
                 WHERE d.task_id = ?1 AND COALESCE(t.status, '') NOT IN ('done', 'completed')",
            )
            .map_err(|error| format!("Unable to inspect task dependencies: {error}"))?;
        let rows = stmt
            .query_map([task_id], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Unable to read task dependencies: {error}"))?;

        let mut dependencies = Vec::new();
        for row in rows {
            dependencies
                .push(row.map_err(|error| format!("Unable to read dependency row: {error}"))?);
        }
        Ok(dependencies)
    }

    pub fn post_plan(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        plan: &str,
    ) -> Result<Value, String> {
        self.ensure_session_active(session_id, agent_id)?;
        self.ensure_session_authorized_for_task(session_id, task_id)?;
        self.emit_event(
            "plan_posted",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({"plan": plan}),
        )?;

        Ok(json!({"posted": true}))
    }

    pub fn create_session(
        &self,
        agent_id: &str,
        task_id: Option<&str>,
        pty_id: Option<&str>,
        write_enabled: bool,
        orchestration_run_id: Option<&str>,
        orchestration_role: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_agent_exists(agent_id)?;
        let id = uuid();
        let now = now_rfc3339();
        let mut enforcement_mode = if write_enabled {
            "worktree_required"
        } else {
            "read_only"
        }
        .to_string();
        let mut write_root = self.paths.repo_path.display().to_string();
        let mut worktree_id = None;
        let mut base_git_sha = None;
        let mut warnings = Vec::new();

        self.conn
            .execute(
                "INSERT INTO agent_sessions(
                    id, agent_id, task_id, orchestration_run_id, orchestration_role, pty_id,
                    status, write_root, enforcement_mode, last_heartbeat_at, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?9, ?9)",
                params![
                    id,
                    agent_id,
                    task_id,
                    orchestration_run_id,
                    orchestration_role,
                    pty_id,
                    write_root,
                    enforcement_mode,
                    now
                ],
            )
            .map_err(|error| format!("Unable to create agent session: {error}"))?;

        if write_enabled {
            match self.create_worktree_for_session(agent_id, &id, task_id) {
                Ok(worktree) => {
                    worktree_id = Some(worktree["id"].as_str().unwrap_or_default().to_string());
                    write_root = worktree["path"].as_str().unwrap_or_default().to_string();
                    base_git_sha = worktree["baseSha"].as_str().map(str::to_string);
                    self.conn
                        .execute(
                            "UPDATE agent_sessions
                             SET worktree_id=?1, write_root=?2, base_git_sha=?3, current_git_sha=?3,
                                 enforcement_mode='worktree_required', updated_at=?4
                             WHERE id=?5",
                            params![worktree_id, write_root, base_git_sha, now_rfc3339(), id],
                        )
                        .map_err(|error| {
                            format!("Unable to attach worktree to session: {error}")
                        })?;
                    self.emit_event(
                        "session_write_root_assigned",
                        "agent",
                        agent_id,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            session_id: Some(id.clone()),
                            task_id: task_id.map(str::to_string),
                            orchestration_run_id: orchestration_run_id.map(str::to_string),
                            ..EventRefs::default()
                        },
                        json!({"worktree_id": worktree_id, "write_root": write_root, "enforcement_mode": enforcement_mode}),
                    )?;
                }
                Err(error) => {
                    enforcement_mode = "coordination_only".to_string();
                    warnings.push(error.clone());
                    warnings.push("Safe git worktree isolation is unavailable; submit_patch and merge are blocked by default.".to_string());
                    self.conn
                        .execute(
                            "UPDATE agent_sessions SET enforcement_mode='coordination_only', write_root=?1, updated_at=?2 WHERE id=?3",
                            params![self.paths.repo_path.display().to_string(), now_rfc3339(), id],
                        )
                        .map_err(|update_error| {
                            format!("Unable to mark session coordination_only after worktree failure: {update_error}")
                        })?;
                    self.emit_event(
                        "workspace_violation_created",
                        "kernel",
                        REPO_ID,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            session_id: Some(id.clone()),
                            task_id: task_id.map(str::to_string),
                            orchestration_run_id: orchestration_run_id.map(str::to_string),
                            ..EventRefs::default()
                        },
                        json!({"violation_kind": "unknown_worktree_write", "severity": "warning", "error": error}),
                    )?;
                }
            }
        }

        self.emit_event(
            "agent_started",
            "agent",
            agent_id,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                session_id: Some(id.clone()),
                task_id: task_id.map(str::to_string),
                orchestration_run_id: orchestration_run_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "pty_id": pty_id,
                "write_enabled": write_enabled,
                "worktree_id": worktree_id,
                "write_root": write_root,
                "enforcement_mode": enforcement_mode,
            }),
        )?;

        Ok(json!({
            "id": id,
            "agentId": agent_id,
            "taskId": task_id,
            "ptyId": pty_id,
            "worktreeId": worktree_id,
            "writeRoot": write_root,
            "enforcementMode": enforcement_mode,
            "baseGitSha": base_git_sha,
            "status": "active",
            "warnings": warnings,
        }))
    }

    pub fn prepare_terminal_context(
        &self,
        agent_name: &str,
        agent_kind: &str,
        pty_id: Option<&str>,
        workspace_id: Option<&str>,
        workspace_name: Option<&str>,
        task_id: Option<&str>,
        orchestration_run_id: Option<&str>,
        orchestration_role: Option<&str>,
    ) -> Result<TerminalCoordinationContext, String> {
        let objective_key = require_workspace_objective_key(workspace_id)?;
        let _workspace_mcp = self.ensure_workspace_mcp_config(workspace_id, workspace_name)?;
        let agent = self.create_or_get_agent(agent_name, agent_kind, orchestration_role)?;
        let agent_id = agent["id"]
            .as_str()
            .ok_or_else(|| "Unable to read created agent id.".to_string())?
            .to_string();
        let session = self.create_session(
            &agent_id,
            task_id,
            pty_id,
            true,
            orchestration_run_id,
            orchestration_role,
        )?;
        let session_id = session["id"]
            .as_str()
            .ok_or_else(|| "Unable to read created session id.".to_string())?
            .to_string();
        let worktree_id = session["worktreeId"].as_str().map(str::to_string);
        let write_root = session["writeRoot"]
            .as_str()
            .unwrap_or_else(|| self.paths.repo_path.to_str().unwrap_or(""))
            .to_string();
        let worktree_path = worktree_id
            .as_ref()
            .and_then(|_| session["writeRoot"].as_str().map(str::to_string));
        let enforcement_mode = session["enforcementMode"]
            .as_str()
            .unwrap_or("coordination_only")
            .to_string();
        let cloud_status = self.get_cloud_orchestrator_status()?;
        let cloud_enabled = cloud_status["enabled"].as_bool().unwrap_or(false);
        let warnings = session["warnings"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mcp_config = self.write_session_mcp_config(
            &agent_id,
            &session_id,
            workspace_id,
            &objective_key,
            task_id,
            worktree_id.as_deref(),
            worktree_path.as_deref(),
            orchestration_run_id,
            orchestration_role,
        )?;

        Ok(TerminalCoordinationContext {
            agent_id,
            session_id,
            task_id: task_id.map(str::to_string),
            worktree_id,
            worktree_path,
            write_root,
            enforcement_mode,
            db_path: self.paths.db_path.display().to_string(),
            repo_path: self.paths.repo_path.display().to_string(),
            mcp_config_path: mcp_config.generic_path,
            codex_mcp_config_path: mcp_config.codex_path,
            claude_mcp_config_path: mcp_config.claude_path,
            mcp_command: "coordination_mcp".to_string(),
            workspace_id: workspace_id.map(str::to_string),
            objective_key,
            orchestration_run_id: orchestration_run_id.map(str::to_string),
            orchestration_role: orchestration_role.map(str::to_string),
            cloud_orchestrator_enabled: cloud_enabled,
            warnings,
        })
    }

    pub fn interrupt_session(&self, session_id: &str, reason: &str) -> Result<Value, String> {
        let session = self.query_one(
            "SELECT * FROM agent_sessions WHERE id=?1",
            &[&session_id],
            "Session does not exist.",
        )?;
        let current_status = session["status"].as_str().unwrap_or("unknown");
        if current_status != "active" {
            return Ok(json!({
                "id": session_id,
                "status": current_status,
                "interrupted": false,
                "reason": "already_not_active",
            }));
        }

        let active_leases = self.query_json(
            "SELECT id, task_id, agent_id, session_id, resource_id FROM leases WHERE session_id=?1 AND status='active'",
            &[&session_id],
        )?;
        let active_worktrees = self.query_json(
            "SELECT id, path, branch_name FROM worktrees WHERE session_id=?1 AND status='active'",
            &[&session_id],
        )?;
        let now = now_rfc3339();
        self.conn
            .execute(
                "UPDATE agent_sessions SET status='interrupted', updated_at=?1 WHERE id=?2 AND status='active'",
                params![now, session_id],
            )
            .map_err(|error| format!("Unable to interrupt session: {error}"))?;
        self.conn
            .execute(
                "UPDATE leases
                 SET status='expired', expires_at=?1, last_heartbeat_at=?1
                 WHERE session_id=?2 AND status='active'",
                params![now, session_id],
            )
            .map_err(|error| format!("Unable to expire interrupted session leases: {error}"))?;
        self.conn
            .execute(
                "UPDATE worktrees
                 SET status='interrupted', updated_at=?1
                 WHERE session_id=?2 AND status='active'",
                params![now, session_id],
            )
            .map_err(|error| format!("Unable to mark interrupted session worktrees: {error}"))?;

        for lease in &active_leases {
            self.emit_event(
                "lease_expired",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: lease["task_id"].as_str().map(str::to_string),
                    agent_id: lease["agent_id"].as_str().map(str::to_string),
                    session_id: lease["session_id"].as_str().map(str::to_string),
                    resource_id: lease["resource_id"].as_str().map(str::to_string),
                    ..EventRefs::default()
                },
                json!({
                    "lease_id": lease["id"],
                    "reason": "session_interrupted",
                    "interrupt_reason": reason,
                }),
            )?;
        }

        self.emit_event(
            "agent_interrupted",
            "kernel",
            REPO_ID,
            EventRefs {
                session_id: session["id"].as_str().map(str::to_string),
                agent_id: session["agent_id"].as_str().map(str::to_string),
                task_id: session["task_id"].as_str().map(str::to_string),
                orchestration_run_id: session["orchestration_run_id"].as_str().map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "reason": reason,
                "expired_leases": active_leases.len(),
                "interrupted_worktrees": active_worktrees.len(),
            }),
        )?;

        Ok(json!({
            "id": session_id,
            "status": "interrupted",
            "interrupted": true,
            "expired_leases": active_leases.len(),
            "interrupted_worktrees": active_worktrees.len(),
        }))
    }

    pub fn ensure_workspace_mcp_config(
        &self,
        workspace_id: Option<&str>,
        workspace_name: Option<&str>,
    ) -> Result<Value, String> {
        let objective_key = require_workspace_objective_key(workspace_id)?;
        let workspace_slug = slug(&objective_key);
        let (command, mut args) = self.coordination_mcp_command_spec();
        args.extend([
            "--repo-path".to_string(),
            process_path_text(&self.paths.repo_path),
            "--db-path".to_string(),
            process_path_text(&self.paths.db_path),
            "--objective-key".to_string(),
            objective_key.clone(),
        ]);
        if let Some(value) = workspace_id.filter(|value| !value.trim().is_empty()) {
            args.extend(["--workspace-id".to_string(), value.to_string()]);
        }

        let generic_config = json!({
            "mcpServers": {
                "coordination-kernel": {
                    "command": command.clone(),
                    "args": args.clone(),
                    "env": {
                        "COORDINATION_ENABLED": "1",
                        "COORDINATION_WORKSPACE_ID": workspace_id,
                        "COORDINATION_OBJECTIVE_KEY": objective_key,
                        "COORDINATION_REPO_PATH": process_path_text(&self.paths.repo_path),
                        "COORDINATION_DB_PATH": process_path_text(&self.paths.db_path),
                        "COORDINATION_MCP_ALWAYS_ON": "1"
                    },
                    "diffforge": {
                        "scope": "workspace",
                        "workspaceId": workspace_id,
                        "workspaceName": workspace_name,
                        "objectiveKey": objective_key,
                        "alwaysOn": true,
                        "toggleable": false,
                        "authority": "local_coordination_kernel"
                    }
                }
            }
        });
        let generic_path = self
            .paths
            .mcp_root
            .join(format!("workspace-{workspace_slug}.json"));
        let codex_path = self
            .paths
            .mcp_root
            .join(format!("workspace-{workspace_slug}.codex.toml"));
        let claude_path = self
            .paths
            .mcp_root
            .join(format!("workspace-{workspace_slug}.claude.json"));
        write_json_file(&generic_path, &generic_config)?;
        write_text_file(&codex_path, &codex_config_toml(&command, &args))?;
        write_json_file(&claude_path, &generic_config)?;

        Ok(json!({
            "server_name": "coordination-kernel",
            "scope": "workspace",
            "enabled": true,
            "always_on": true,
            "toggleable": false,
            "workspace_id": workspace_id,
            "workspace_name": workspace_name,
            "objective_key": objective_key,
            "repo_path": process_path_text(&self.paths.repo_path),
            "db_path": process_path_text(&self.paths.db_path),
            "command": command,
            "args": args,
            "config_path": process_path_text(&generic_path),
            "codex_config_path": process_path_text(&codex_path),
            "claude_config_path": process_path_text(&claude_path),
        }))
    }

    fn write_session_mcp_config(
        &self,
        agent_id: &str,
        session_id: &str,
        workspace_id: Option<&str>,
        objective_key: &str,
        task_id: Option<&str>,
        worktree_id: Option<&str>,
        worktree_path: Option<&str>,
        orchestration_run_id: Option<&str>,
        orchestration_role: Option<&str>,
    ) -> Result<SessionMcpConfigPaths, String> {
        let (command, mut args) = self.coordination_mcp_command_spec();
        args.extend([
            "--repo-path".to_string(),
            process_path_text(&self.paths.repo_path),
            "--db-path".to_string(),
            process_path_text(&self.paths.db_path),
            "--agent-id".to_string(),
            agent_id.to_string(),
            "--session-id".to_string(),
            session_id.to_string(),
            "--objective-key".to_string(),
            objective_key.to_string(),
        ]);
        if let Some(value) = workspace_id {
            args.extend(["--workspace-id".to_string(), value.to_string()]);
        }
        if let Some(value) = task_id {
            args.extend(["--task-id".to_string(), value.to_string()]);
        }
        if let Some(value) = worktree_id {
            args.extend(["--worktree-id".to_string(), value.to_string()]);
        }
        if let Some(value) = worktree_path {
            args.extend(["--worktree-path".to_string(), value.to_string()]);
        }
        if let Some(value) = orchestration_run_id {
            args.extend(["--orchestration-run-id".to_string(), value.to_string()]);
        }
        if let Some(value) = orchestration_role {
            args.extend(["--orchestration-role".to_string(), value.to_string()]);
        }

        let generic_config = json!({
            "mcpServers": {
                "coordination-kernel": {
                    "command": command.clone(),
                    "args": args.clone(),
                    "env": {
                        "COORDINATION_ENABLED": "1",
                        "COORDINATION_AGENT_ID": agent_id,
                        "COORDINATION_SESSION_ID": session_id,
                        "COORDINATION_WORKSPACE_ID": workspace_id,
                        "COORDINATION_OBJECTIVE_KEY": objective_key,
                        "COORDINATION_MCP_ALWAYS_ON": "1"
                    },
                    "diffforge": {
                        "scope": "workspace",
                        "workspaceId": workspace_id,
                        "objectiveKey": objective_key,
                        "alwaysOn": true,
                        "toggleable": false
                    }
                }
            }
        });
        let claude_config = generic_config.clone();
        let generic_path = self.paths.mcp_root.join(format!("{session_id}.json"));
        let codex_path = self.paths.mcp_root.join(format!("{session_id}.codex.toml"));
        let claude_path = self
            .paths
            .mcp_root
            .join(format!("{session_id}.claude.json"));
        write_json_file(&generic_path, &generic_config)?;
        write_text_file(&codex_path, &codex_config_toml(&command, &args))?;
        write_json_file(&claude_path, &claude_config)?;
        if let Some(worktree_path) = worktree_path {
            self.write_worktree_mcp_activation_files(
                worktree_path,
                &generic_config,
                &command,
                &args,
            )?;
        }
        Ok(SessionMcpConfigPaths {
            generic_path: process_path_text(&generic_path),
            codex_path: process_path_text(&codex_path),
            claude_path: process_path_text(&claude_path),
        })
    }

    fn coordination_mcp_command_spec(&self) -> (String, Vec<String>) {
        if let Ok(current_exe) = std::env::current_exe() {
            if current_exe.exists() {
                return (
                    process_path_text(&current_exe),
                    vec!["--coordination-mcp".to_string()],
                );
            }
        }

        let exe_name = if cfg!(windows) {
            "coordination_mcp.exe"
        } else {
            "coordination_mcp"
        };

        if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
            let candidate = PathBuf::from(manifest_dir)
                .join("target")
                .join("debug")
                .join(exe_name);
            if candidate.exists() {
                return (process_path_text(&candidate), Vec::new());
            }
        }

        (exe_name.to_string(), Vec::new())
    }

    fn write_worktree_mcp_activation_files(
        &self,
        worktree_path: &str,
        generic_config: &Value,
        command: &str,
        args: &[String],
    ) -> Result<(), String> {
        let worktree = PathBuf::from(worktree_path);
        if !worktree.exists() {
            return Ok(());
        }

        self.ensure_worktree_mcp_files_ignored(&worktree)?;
        write_json_file(&worktree.join(".mcp.json"), generic_config)?;
        let codex_dir = worktree.join(".codex");
        fs::create_dir_all(&codex_dir)
            .map_err(|error| format!("Unable to create {}: {error}", codex_dir.display()))?;
        write_text_file(
            &codex_dir.join("config.toml"),
            &codex_config_toml(command, args),
        )?;
        Ok(())
    }

    fn ensure_worktree_mcp_files_ignored(&self, worktree: &Path) -> Result<(), String> {
        let exclude_path_text = run_git(worktree, &["rev-parse", "--git-path", "info/exclude"])?;
        let exclude_path = {
            let trimmed = exclude_path_text.trim();
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                path
            } else {
                worktree.join(path)
            }
        };
        if let Some(parent) = exclude_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to create git exclude directory: {error}"))?;
        }
        let existing = fs::read_to_string(&exclude_path).unwrap_or_default();
        let additions = [".mcp.json", ".codex/"];
        let mut next = existing.clone();
        for addition in additions {
            if !existing.lines().any(|line| line.trim() == addition) {
                if !next.ends_with('\n') && !next.is_empty() {
                    next.push('\n');
                }
                next.push_str(addition);
                next.push('\n');
            }
        }
        if next != existing {
            fs::write(&exclude_path, next)
                .map_err(|error| format!("Unable to update {}: {error}", exclude_path.display()))?;
        }
        Ok(())
    }

    pub fn heartbeat_session(&self, session_id: &str) -> Result<Value, String> {
        let changed = self
            .conn
            .execute(
                "UPDATE agent_sessions SET last_heartbeat_at=?1, updated_at=?1 WHERE id=?2 AND status='active'",
                params![now_rfc3339(), session_id],
            )
            .map_err(|error| format!("Unable to heartbeat session: {error}"))?;
        if changed == 0 {
            return Err("Session is not active.".to_string());
        }
        Ok(json!({"session_id": session_id, "status": "active"}))
    }

    pub fn acquire_lease(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        resource_key: &str,
        mode: &str,
        ttl_seconds: Option<i64>,
        reason: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_session_active(session_id, agent_id)?;
        self.ensure_session_authorized_for_task(session_id, task_id)?;
        self.expire_old_leases()?;
        let resource_key = normalize_resource_key(resource_key);
        let mode = non_empty(mode, "Lease mode")?;
        let resource_id = self.create_or_get_resource(&resource_key, mode)?;
        self.emit_event(
            "lease_requested",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                resource_id: Some(resource_id.clone()),
                ..EventRefs::default()
            },
            json!({"resource_key": resource_key, "mode": mode, "reason": reason}),
        )?;

        let blockers = self.active_conflicting_leases(&resource_key, mode)?;
        if let Some(blocker) = blockers.first() {
            let conflict_id = uuid();
            self.conn
                .execute(
                    "INSERT INTO lease_conflicts(id, requested_resource_id, requested_by_agent_id, blocking_lease_id, task_id, status, created_at)
                     VALUES(?1, ?2, ?3, ?4, ?5, 'open', ?6)",
                    params![conflict_id, resource_id, agent_id, blocker["id"].as_str().unwrap_or_default(), task_id, now_rfc3339()],
                )
                .map_err(|error| format!("Unable to record lease conflict: {error}"))?;
            self.emit_event(
                "lease_denied",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: Some(session_id.to_string()),
                    resource_id: Some(resource_id),
                    ..EventRefs::default()
                },
                json!({"resource_key": resource_key, "mode": mode, "blockers": blockers}),
            )?;
            return Ok(api_error(
                "lease_conflict",
                "Resource is already covered by an active conflicting lease.",
                json!({"blockers": blockers}),
            ));
        }

        let fence_token: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(fence_token), 0) + 1 FROM leases WHERE resource_id=?1",
                [&resource_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Unable to allocate lease fence token: {error}"))?;
        let lease_id = uuid();
        let now = now_rfc3339();
        let expires_at = rfc3339_after_seconds(ttl_seconds.unwrap_or(DEFAULT_LEASE_TTL_SECONDS));
        self.conn
            .execute(
                "INSERT INTO leases(
                    id, resource_id, task_id, agent_id, session_id, mode, status, fence_token,
                    reason, acquired_at, expires_at, last_heartbeat_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?10, ?9)",
                params![
                    lease_id,
                    resource_id,
                    task_id,
                    agent_id,
                    session_id,
                    mode,
                    fence_token,
                    reason,
                    now,
                    expires_at
                ],
            )
            .map_err(|error| format!("Unable to acquire lease: {error}"))?;
        self.emit_event(
            "lease_granted",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                resource_id: Some(resource_id.clone()),
                ..EventRefs::default()
            },
            json!({"lease_id": lease_id, "resource_key": resource_key, "mode": mode, "fence_token": fence_token, "expires_at": expires_at}),
        )?;

        Ok(api_ok(json!({
            "lease_id": lease_id,
            "resource_id": resource_id,
            "resource_key": resource_key,
            "mode": mode,
            "fence_token": fence_token,
            "expires_at": expires_at
        })))
    }

    fn active_conflicting_leases(
        &self,
        resource_key: &str,
        mode: &str,
    ) -> Result<Vec<Value>, String> {
        let active = self.list_active_leases_internal(None, None, None)?;
        Ok(active
            .into_iter()
            .filter(|lease| {
                let existing_key = lease["resource_key"].as_str().unwrap_or_default();
                let existing_mode = lease["mode"].as_str().unwrap_or_default();
                lease_modes_conflict(existing_mode, mode)
                    && resources_conflict(existing_key, resource_key)
            })
            .collect())
    }

    fn create_or_get_resource(&self, resource_key: &str, mode: &str) -> Result<String, String> {
        if let Some(id) = self
            .conn
            .query_row(
                "SELECT id FROM resources WHERE resource_key=?1",
                [resource_key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Unable to inspect resource: {error}"))?
        {
            return Ok(id);
        }

        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO resources(id, resource_key, resource_type, risk_level, metadata_json, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, NULL, ?5, ?5)",
                params![
                    id,
                    resource_key,
                    resource_type(resource_key),
                    resource_risk_level(resource_key, mode),
                    now
                ],
            )
            .map_err(|error| format!("Unable to create resource record: {error}"))?;
        Ok(id)
    }

    pub fn renew_lease(
        &self,
        lease_id: &str,
        fence_token: i64,
        ttl_seconds: Option<i64>,
    ) -> Result<Value, String> {
        let lease = self.get_lease(lease_id)?;
        if lease["fence_token"].as_i64() != Some(fence_token) {
            return Err("Lease fence token does not match.".to_string());
        }
        if lease["status"].as_str() != Some("active") {
            return Err("Lease is not active.".to_string());
        }
        if is_expired(lease["expires_at"].as_str().unwrap_or_default()) {
            self.expire_old_leases()?;
            return Err("Lease is expired and cannot be renewed.".to_string());
        }

        let expires_at = rfc3339_after_seconds(ttl_seconds.unwrap_or(DEFAULT_LEASE_TTL_SECONDS));
        self.conn
            .execute(
                "UPDATE leases SET expires_at=?1, last_heartbeat_at=?2 WHERE id=?3",
                params![expires_at, now_rfc3339(), lease_id],
            )
            .map_err(|error| format!("Unable to renew lease: {error}"))?;
        self.emit_event(
            "lease_renewed",
            "agent",
            lease["agent_id"].as_str().unwrap_or_default(),
            EventRefs {
                task_id: lease["task_id"].as_str().map(str::to_string),
                agent_id: lease["agent_id"].as_str().map(str::to_string),
                session_id: lease["session_id"].as_str().map(str::to_string),
                resource_id: lease["resource_id"].as_str().map(str::to_string),
                ..EventRefs::default()
            },
            json!({"lease_id": lease_id, "fence_token": fence_token, "expires_at": expires_at}),
        )?;

        Ok(api_ok(
            json!({"lease_id": lease_id, "fence_token": fence_token, "expires_at": expires_at}),
        ))
    }

    pub fn release_lease(&self, lease_id: &str, fence_token: i64) -> Result<Value, String> {
        let lease = self.get_lease(lease_id)?;
        if lease["fence_token"].as_i64() != Some(fence_token) {
            return Err("Lease fence token does not match.".to_string());
        }
        if lease["status"].as_str() != Some("active") {
            return Err("Lease is not active.".to_string());
        }
        let now = now_rfc3339();
        self.conn
            .execute(
                "UPDATE leases SET status='released', released_at=?1 WHERE id=?2",
                params![now, lease_id],
            )
            .map_err(|error| format!("Unable to release lease: {error}"))?;
        self.emit_event(
            "lease_released",
            "agent",
            lease["agent_id"].as_str().unwrap_or_default(),
            EventRefs {
                task_id: lease["task_id"].as_str().map(str::to_string),
                agent_id: lease["agent_id"].as_str().map(str::to_string),
                session_id: lease["session_id"].as_str().map(str::to_string),
                resource_id: lease["resource_id"].as_str().map(str::to_string),
                ..EventRefs::default()
            },
            json!({"lease_id": lease_id, "fence_token": fence_token}),
        )?;

        Ok(api_ok(json!({"lease_id": lease_id, "status": "released"})))
    }

    fn get_lease(&self, lease_id: &str) -> Result<Value, String> {
        let mut rows = self.query_json(
            "SELECT l.*, r.resource_key
             FROM leases l
             JOIN resources r ON r.id = l.resource_id
             WHERE l.id = ?1",
            &[&lease_id],
        )?;
        rows.pop()
            .ok_or_else(|| "Lease does not exist.".to_string())
    }

    pub fn expire_old_leases(&self) -> Result<(), String> {
        let now = now_rfc3339();
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, agent_id, session_id, resource_id FROM leases WHERE status='active' AND expires_at < ?1")
            .map_err(|error| format!("Unable to prepare lease expiration query: {error}"))?;
        let rows = stmt
            .query_map([now.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| format!("Unable to query expired leases: {error}"))?;
        let expired = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to read expired lease row: {error}"))?;

        self.conn
            .execute(
                "UPDATE leases SET status='expired' WHERE status='active' AND expires_at < ?1",
                [now.as_str()],
            )
            .map_err(|error| format!("Unable to expire leases: {error}"))?;

        for (id, task_id, agent_id, session_id, resource_id) in expired {
            self.emit_event(
                "lease_expired",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: Some(task_id),
                    agent_id: Some(agent_id),
                    session_id: Some(session_id),
                    resource_id: Some(resource_id),
                    ..EventRefs::default()
                },
                json!({"lease_id": id}),
            )?;
        }

        Ok(())
    }

    pub fn list_active_leases(
        &self,
        task_id: Option<&str>,
        agent_id: Option<&str>,
        resource_key: Option<&str>,
    ) -> Result<Value, String> {
        Ok(api_ok(
            json!({"leases": self.list_active_leases_internal(task_id, agent_id, resource_key)?}),
        ))
    }

    fn list_active_leases_internal(
        &self,
        task_id: Option<&str>,
        agent_id: Option<&str>,
        resource_key: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        self.expire_old_leases()?;
        let mut sql = "SELECT l.*, r.resource_key, r.resource_type
            FROM leases l JOIN resources r ON r.id = l.resource_id
            WHERE l.status='active' AND l.expires_at >= ?1"
            .to_string();
        let now = now_rfc3339();
        let mut owned = vec![now];

        if let Some(value) = task_id {
            sql.push_str(" AND l.task_id = ?");
            owned.push(value.to_string());
        }
        if let Some(value) = agent_id {
            sql.push_str(" AND l.agent_id = ?");
            owned.push(value.to_string());
        }
        if let Some(value) = resource_key {
            sql.push_str(" AND r.resource_key = ?");
            owned.push(normalize_resource_key(value));
        }
        sql.push_str(" ORDER BY l.expires_at ASC");
        let params = owned
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();

        self.query_json(&sql, &params)
    }

    pub fn announce_change(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        paths: Vec<String>,
        summary: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_session_active(session_id, agent_id)?;
        let mut warnings = Vec::new();
        let mut normalized_paths = Vec::new();

        for path in paths {
            reject_path_escape(&path)?;
            let normalized = path.replace('\\', "/");
            let resource_key = path_to_file_resource(&normalized);
            normalized_paths.push(normalized.clone());
            if self
                .find_covering_lease(task_id, agent_id, session_id, &resource_key)?
                .is_none()
            {
                warnings.push(format!(
                    "{normalized} has no active lease; submit_patch will reject it."
                ));
                self.create_workspace_violation(
                    Some(task_id),
                    Some(agent_id),
                    Some(session_id),
                    None,
                    "unleased_write",
                    Some(&normalized),
                    Some(&resource_key),
                    "warning",
                    json!({"summary": summary}),
                )?;
            }
        }

        self.emit_event(
            "change_announced",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({"paths": normalized_paths, "summary": summary, "warnings": warnings}),
        )?;

        Ok(api_ok_warnings(
            json!({"paths": normalized_paths}),
            warnings,
        ))
    }

    pub fn submit_patch(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        worktree_id: Option<&str>,
        summary: Option<&str>,
    ) -> Result<Value, String> {
        let validation =
            self.run_patch_validation(task_id, agent_id, session_id, worktree_id, summary, true)?;
        if validation.status == "passed" {
            self.emit_event(
                "patch_submitted",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: Some(session_id.to_string()),
                    artifact_id: validation.diff_artifact_id.clone(),
                    ..EventRefs::default()
                },
                json!({"patch_id": validation.patch_id, "changed_files": validation.changed_files}),
            )?;
            return Ok(api_ok_warnings(
                json!({
                    "patch_id": validation.patch_id,
                    "validation_status": "passed",
                    "changed_files": validation.changed_files,
                    "diff_artifact_id": validation.diff_artifact_id
                }),
                validation.warnings,
            ));
        }

        Ok(api_error(
            "patch_validation_failed",
            "Patch rejected because changed files are not covered by valid leases or policy checks failed.",
            json!({"violations": validation.violations, "validation_id": validation.validation_id}),
        ))
    }

    pub fn validate_patch(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        worktree_id: Option<&str>,
        summary: Option<&str>,
    ) -> Result<Value, String> {
        let validation =
            self.run_patch_validation(task_id, agent_id, session_id, worktree_id, summary, false)?;
        if validation.status == "passed" {
            return Ok(api_ok_warnings(
                json!({
                    "validation_id": validation.validation_id,
                    "validation_status": "passed",
                    "changed_files": validation.changed_files,
                    "diff_artifact_id": validation.diff_artifact_id,
                }),
                validation.warnings,
            ));
        }
        Ok(api_error(
            "patch_validation_failed",
            "Patch validation failed.",
            json!({"violations": validation.violations, "validation_id": validation.validation_id}),
        ))
    }

    fn run_patch_validation(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        worktree_id: Option<&str>,
        summary: Option<&str>,
        submit: bool,
    ) -> Result<PatchValidationResult, String> {
        self.emit_event(
            "patch_validation_started",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({"worktree_id": worktree_id, "submit": submit, "summary": summary}),
        )?;
        self.expire_old_leases()?;
        self.ensure_session_active(session_id, agent_id)?;
        self.ensure_session_authorized_for_task(session_id, task_id)?;
        let policy = self.repo_policy()?;
        let worktree_required = policy["agent_worktree_required"].as_i64().unwrap_or(1) == 1;
        let Some(worktree_id) = worktree_id.filter(|value| !value.trim().is_empty()) else {
            self.create_workspace_violation(
                Some(task_id),
                Some(agent_id),
                Some(session_id),
                None,
                "patch_without_worktree",
                None,
                None,
                "error",
                json!({"summary": summary}),
            )?;
            let validation = self.finish_patch_validation(
                None,
                task_id,
                agent_id,
                session_id,
                "",
                "failed",
                "Patch rejected: worktree_id is required.",
                json!({"reason": "worktree_required"}),
            )?;
            return Ok(PatchValidationResult {
                status: "failed".to_string(),
                validation_id: validation,
                patch_id: None,
                diff_artifact_id: None,
                diff_hash: None,
                changed_files: Vec::new(),
                violations: vec![json!({"violation_kind": "patch_without_worktree"})],
                warnings: Vec::new(),
            });
        };
        if worktree_required && worktree_id.is_empty() {
            return Err("worktree_id is required under the default repo policy.".to_string());
        }

        let worktree = self.get_worktree(worktree_id)?;
        if worktree["session_id"].as_str() != Some(session_id) {
            return Err("Worktree does not belong to this session.".to_string());
        }
        if worktree["agent_id"].as_str() != Some(agent_id) {
            return Err("Worktree does not belong to this agent.".to_string());
        }
        let worktree_path = PathBuf::from(worktree["path"].as_str().unwrap_or_default());
        if !worktree_path.exists() {
            return Err("Worktree path does not exist.".to_string());
        }
        let canonical_worktree = worktree_path
            .canonicalize()
            .map_err(|error| format!("Unable to canonicalize worktree path: {error}"))?;
        let canonical_worktrees_root = self
            .paths
            .worktrees_root
            .canonicalize()
            .unwrap_or_else(|_| self.paths.worktrees_root.clone());
        if !canonical_worktree.starts_with(&canonical_worktrees_root) {
            self.create_workspace_violation(
                Some(task_id),
                Some(agent_id),
                Some(session_id),
                Some(worktree_id),
                "path_escape",
                Some(&canonical_worktree.display().to_string()),
                None,
                "critical",
                json!({"expected_root": canonical_worktrees_root.display().to_string()}),
            )?;
            return Err("Worktree path escapes the configured .agents/worktrees root.".to_string());
        }

        let changed = self.changed_files(&canonical_worktree)?;
        if changed.is_empty() {
            let validation_id = self.finish_patch_validation(
                None,
                task_id,
                agent_id,
                session_id,
                worktree_id,
                "warning",
                "No changed files were detected.",
                json!({"changed_files": []}),
            )?;
            return Ok(PatchValidationResult {
                status: "warning".to_string(),
                validation_id,
                patch_id: None,
                diff_artifact_id: None,
                diff_hash: None,
                changed_files: Vec::new(),
                violations: Vec::new(),
                warnings: vec!["No changed files were detected.".to_string()],
            });
        }

        let mut violations = Vec::new();
        let patch_id = if submit { Some(uuid()) } else { None };
        let mut patch_file_rows = Vec::new();

        for changed_file in &changed {
            reject_path_escape(&changed_file.path)?;
            let full_path = canonical_worktree.join(&changed_file.path);
            if full_path.exists() {
                let canonical_target = full_path.canonicalize().map_err(|error| {
                    format!(
                        "Unable to canonicalize changed path {}: {error}",
                        changed_file.path
                    )
                })?;
                if !canonical_target.starts_with(&canonical_worktree) {
                    self.create_workspace_violation(
                        Some(task_id),
                        Some(agent_id),
                        Some(session_id),
                        Some(worktree_id),
                        "path_escape",
                        Some(&changed_file.path),
                        None,
                        "critical",
                        json!({"target": canonical_target.display().to_string()}),
                    )?;
                    violations
                        .push(json!({"path": changed_file.path, "violation_kind": "path_escape"}));
                    continue;
                }
            }
            let resource_key = path_to_file_resource(&changed_file.path);
            let lease = self.find_covering_lease(task_id, agent_id, session_id, &resource_key)?;
            let file_validation_id = uuid();
            match lease {
                Some(lease) => {
                    self.conn
                        .execute(
                            "INSERT INTO patch_file_lease_validations(id, patch_id, patch_file_id, path, resource_key, lease_id, fence_token, status, reason, created_at)
                             VALUES(?1, ?2, NULL, ?3, ?4, ?5, ?6, 'passed', NULL, ?7)",
                            params![
                                file_validation_id,
                                patch_id,
                                changed_file.path,
                                resource_key,
                                lease["id"].as_str(),
                                lease["fence_token"].as_i64(),
                                now_rfc3339()
                            ],
                        )
                        .map_err(|error| format!("Unable to record patch file lease validation: {error}"))?;
                }
                None => {
                    self.conn
                        .execute(
                            "INSERT INTO patch_file_lease_validations(id, patch_id, patch_file_id, path, resource_key, lease_id, fence_token, status, reason, created_at)
                             VALUES(?1, ?2, NULL, ?3, ?4, NULL, NULL, 'failed', 'No active covering lease owned by this session.', ?5)",
                            params![file_validation_id, patch_id, changed_file.path, resource_key, now_rfc3339()],
                        )
                        .map_err(|error| format!("Unable to record failed patch file lease validation: {error}"))?;
                    self.create_workspace_violation(
                        Some(task_id),
                        Some(agent_id),
                        Some(session_id),
                        Some(worktree_id),
                        "patch_without_lease",
                        Some(&changed_file.path),
                        Some(&resource_key),
                        "error",
                        json!({"change_kind": changed_file.change_kind}),
                    )?;
                    violations.push(json!({
                        "path": changed_file.path,
                        "resource_key": resource_key,
                        "violation_kind": "patch_without_lease"
                    }));
                }
            }
            patch_file_rows.push(changed_file.clone());
        }

        let open_violations = self.open_blocking_violations(session_id, worktree_id)?;
        for violation in open_violations {
            violations.push(violation);
        }

        if !violations.is_empty() {
            let patch_status = if submit {
                Some("validation_failed")
            } else {
                None
            };
            let actual_patch_id = if submit {
                let patch_id = patch_id.clone().unwrap_or_else(uuid);
                self.create_patch_row(
                    &patch_id,
                    task_id,
                    agent_id,
                    session_id,
                    worktree_id,
                    worktree["base_sha"].as_str(),
                    None,
                    None,
                    patch_status.unwrap_or("validation_failed"),
                    1,
                    None,
                    None,
                    summary,
                )?;
                Some(patch_id)
            } else {
                None
            };
            let validation_id = self.finish_patch_validation(
                actual_patch_id.as_deref(),
                task_id,
                agent_id,
                session_id,
                worktree_id,
                "failed",
                "Patch validation failed.",
                json!({"violations": violations, "changed_files": changed.iter().map(|item| item.path.clone()).collect::<Vec<_>>()}),
            )?;
            self.emit_event(
                "patch_validation_failed",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: Some(session_id.to_string()),
                    ..EventRefs::default()
                },
                json!({"validation_id": validation_id, "violations": violations}),
            )?;
            return Ok(PatchValidationResult {
                status: "failed".to_string(),
                validation_id,
                patch_id: actual_patch_id,
                diff_artifact_id: None,
                diff_hash: None,
                changed_files: changed.into_iter().map(|item| item.path).collect(),
                violations,
                warnings: Vec::new(),
            });
        }

        self.mark_untracked_intent_to_add(&canonical_worktree, &changed)?;
        let base_sha = worktree["base_sha"].as_str().unwrap_or("HEAD");
        let diff = run_git(&canonical_worktree, &["diff", "--binary", base_sha])?;
        let diff_artifact_id = self.write_artifact(
            Some(task_id),
            Some(agent_id),
            "patch_diff",
            &format!("patches/{}.diff", patch_id.clone().unwrap_or_else(uuid)),
            diff.as_bytes(),
            json!({"worktree_id": worktree_id, "summary": summary}),
        )?;
        let diff_hash = sha256_hex(diff.as_bytes());
        let head_sha = run_git(&canonical_worktree, &["rev-parse", "HEAD"])
            .ok()
            .map(|value| value.trim().to_string());
        let actual_patch_id = if submit {
            let actual_patch_id = patch_id.clone().unwrap_or_else(uuid);
            self.create_patch_row(
                &actual_patch_id,
                task_id,
                agent_id,
                session_id,
                worktree_id,
                Some(base_sha),
                head_sha.as_deref(),
                Some(&diff_artifact_id),
                "submitted",
                1,
                None,
                Some(&diff_hash),
                summary,
            )?;
            for changed_file in &patch_file_rows {
                self.conn
                    .execute(
                        "INSERT INTO patch_files(id, patch_id, path, change_kind, old_hash, new_hash, lines_added, lines_removed)
                         VALUES(?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL)",
                        params![uuid(), actual_patch_id, changed_file.path, changed_file.change_kind],
                    )
                    .map_err(|error| format!("Unable to record patch file: {error}"))?;
            }
            Some(actual_patch_id)
        } else {
            None
        };
        let validation_id = self.finish_patch_validation(
            actual_patch_id.as_deref(),
            task_id,
            agent_id,
            session_id,
            worktree_id,
            "passed",
            "Patch validation passed.",
            json!({
                "changed_files": changed.iter().map(|item| item.path.clone()).collect::<Vec<_>>(),
                "diff_artifact_id": diff_artifact_id,
                "diff_hash": diff_hash,
            }),
        )?;
        if let Some(patch_id) = &actual_patch_id {
            self.conn
                .execute(
                    "UPDATE patches SET validation_id=?1 WHERE id=?2",
                    params![validation_id, patch_id],
                )
                .map_err(|error| format!("Unable to attach validation to patch: {error}"))?;
        }
        self.emit_event(
            "patch_validation_passed",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                artifact_id: Some(diff_artifact_id.clone()),
                ..EventRefs::default()
            },
            json!({"validation_id": validation_id, "patch_id": actual_patch_id, "changed_files": changed.iter().map(|item| item.path.clone()).collect::<Vec<_>>()}),
        )?;

        Ok(PatchValidationResult {
            status: "passed".to_string(),
            validation_id,
            patch_id: actual_patch_id,
            diff_artifact_id: Some(diff_artifact_id),
            diff_hash: Some(diff_hash),
            changed_files: changed.into_iter().map(|item| item.path).collect(),
            violations: Vec::new(),
            warnings: Vec::new(),
        })
    }

    fn create_patch_row(
        &self,
        patch_id: &str,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        worktree_id: &str,
        base_sha: Option<&str>,
        head_sha: Option<&str>,
        diff_artifact_id: Option<&str>,
        status: &str,
        risk_level: i64,
        validation_id: Option<&str>,
        diff_hash: Option<&str>,
        summary: Option<&str>,
    ) -> Result<(), String> {
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO patches(
                    id, task_id, agent_id, session_id, worktree_id, base_sha, head_sha,
                    diff_artifact_id, status, risk_level, validation_id, diff_hash, summary,
                    created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
                params![
                    patch_id,
                    task_id,
                    agent_id,
                    session_id,
                    worktree_id,
                    base_sha,
                    head_sha,
                    diff_artifact_id,
                    status,
                    risk_level,
                    validation_id,
                    diff_hash,
                    summary,
                    now
                ],
            )
            .map_err(|error| format!("Unable to create patch row: {error}"))?;
        Ok(())
    }

    fn finish_patch_validation(
        &self,
        patch_id: Option<&str>,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        worktree_id: &str,
        status: &str,
        summary: &str,
        details: Value,
    ) -> Result<String, String> {
        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO patch_validations(
                    id, patch_id, task_id, agent_id, session_id, worktree_id, status,
                    validation_summary, details_json, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![
                    id,
                    patch_id,
                    task_id,
                    agent_id,
                    session_id,
                    worktree_id,
                    status,
                    summary,
                    details.to_string(),
                    now
                ],
            )
            .map_err(|error| format!("Unable to record patch validation: {error}"))?;
        Ok(id)
    }

    fn find_covering_lease(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        resource_key: &str,
    ) -> Result<Option<Value>, String> {
        let active = self.list_active_leases_internal(Some(task_id), Some(agent_id), None)?;
        Ok(active.into_iter().find(|lease| {
            lease["session_id"].as_str() == Some(session_id)
                && is_write_like(lease["mode"].as_str().unwrap_or_default())
                && resource_covers(
                    lease["resource_key"].as_str().unwrap_or_default(),
                    resource_key,
                )
        }))
    }

    fn open_blocking_violations(
        &self,
        session_id: &str,
        worktree_id: &str,
    ) -> Result<Vec<Value>, String> {
        self.query_json(
            "SELECT * FROM workspace_violations
             WHERE status='open'
               AND (session_id = ?1 OR worktree_id = ?2)
               AND (severity IN ('error', 'critical') OR violation_kind='unleased_write')",
            &[&session_id, &worktree_id],
        )
    }

    fn changed_files(&self, worktree_path: &Path) -> Result<Vec<ChangedFile>, String> {
        let output = run_git_bytes(worktree_path, &["status", "--porcelain", "-z"])?;
        let mut files = Vec::new();
        let mut parts = output
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty());

        while let Some(entry) = parts.next() {
            if entry.len() < 4 {
                continue;
            }
            let status = String::from_utf8_lossy(&entry[0..2]).to_string();
            let path = String::from_utf8_lossy(&entry[3..]).replace('\\', "/");
            if status.starts_with('R') || status.starts_with('C') {
                if let Some(next_path) = parts.next() {
                    files.push(ChangedFile {
                        path: String::from_utf8_lossy(next_path).replace('\\', "/"),
                        change_kind: if status.starts_with('R') {
                            "renamed"
                        } else {
                            "copied"
                        }
                        .to_string(),
                        untracked: false,
                    });
                }
            } else {
                let change_kind = if status == "??" {
                    "added"
                } else if status.contains('D') {
                    "deleted"
                } else if status.contains('A') {
                    "added"
                } else {
                    "modified"
                };
                files.push(ChangedFile {
                    path,
                    change_kind: change_kind.to_string(),
                    untracked: status == "??",
                });
            }
        }

        files.sort_by(|a, b| a.path.cmp(&b.path));
        files.dedup_by(|a, b| a.path == b.path);
        Ok(files)
    }

    fn mark_untracked_intent_to_add(
        &self,
        worktree_path: &Path,
        changed: &[ChangedFile],
    ) -> Result<(), String> {
        let untracked = changed
            .iter()
            .filter(|item| item.untracked)
            .map(|item| item.path.as_str())
            .collect::<Vec<_>>();

        if untracked.is_empty() {
            return Ok(());
        }

        let mut args = vec!["add", "-N", "--"];
        args.extend(untracked);
        run_git(worktree_path, &args).map(|_| ())
    }

    pub fn request_merge(
        &self,
        patch_id: &str,
        target_branch: Option<&str>,
        strategy: Option<&str>,
    ) -> Result<Value, String> {
        let strategy = strategy.unwrap_or("patch_apply");
        if strategy != "patch_apply" {
            return Err("Only patch_apply merge strategy is implemented in this pass.".to_string());
        }
        let patch = self.get_patch(patch_id)?;
        let validation = patch["validation_id"]
            .as_str()
            .ok_or_else(|| "Patch has no validation.".to_string())
            .and_then(|id| self.get_patch_validation(id))?;
        if validation["status"].as_str() != Some("passed")
            || patch["status"].as_str() != Some("submitted")
        {
            let job_id = self.create_merge_job(
                &patch,
                "failed",
                target_branch,
                strategy,
                Some("Patch validation did not pass."),
            )?;
            self.emit_event(
                "merge_failed",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({"merge_job_id": job_id, "patch_id": patch_id, "reason": "patch_validation_not_passed"}),
            )?;
            return Ok(api_error(
                "merge_blocked",
                "Patch validation did not pass.",
                json!({"merge_job_id": job_id}),
            ));
        }
        self.verify_patch_artifact_hash(&patch)?;
        if self.repo_policy()?["merge_requires_clean_target"]
            .as_i64()
            .unwrap_or(1)
            == 1
            && !self.repo_is_clean()?
        {
            let job_id = self.create_merge_job(
                &patch,
                "blocked",
                target_branch,
                strategy,
                Some("Target repo root is dirty."),
            )?;
            self.create_workspace_violation(
                patch["task_id"].as_str(),
                patch["agent_id"].as_str(),
                patch["session_id"].as_str(),
                patch["worktree_id"].as_str(),
                "dirty_target_repo",
                None,
                None,
                "error",
                json!({"patch_id": patch_id}),
            )?;
            self.emit_event(
                "merge_blocked",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({"merge_job_id": job_id, "patch_id": patch_id, "reason": "dirty_target_repo"}),
            )?;
            return Ok(api_error(
                "merge_blocked",
                "Target repo root is dirty.",
                json!({"merge_job_id": job_id}),
            ));
        }
        self.git_apply_check(&patch)?;
        let job_id = self.create_merge_job(&patch, "queued", target_branch, strategy, None)?;
        self.conn
            .execute(
                "UPDATE patches SET status='merge_queued', updated_at=?1 WHERE id=?2",
                params![now_rfc3339(), patch_id],
            )
            .map_err(|error| format!("Unable to mark patch merge_queued: {error}"))?;
        self.emit_event(
            "merge_queued",
            "kernel",
            REPO_ID,
            EventRefs::from_patch(&patch),
            json!({"merge_job_id": job_id, "patch_id": patch_id, "strategy": strategy}),
        )?;

        Ok(api_ok(json!({"merge_job_id": job_id, "status": "queued"})))
    }

    pub fn apply_merge(&self, merge_job_id: &str) -> Result<Value, String> {
        let job = self.get_merge_job(merge_job_id)?;
        let status = job["status"].as_str().unwrap_or_default();
        if !matches!(status, "queued" | "checking") {
            return Err("Merge job must be queued or checking before apply.".to_string());
        }
        let patch_id = job["patch_id"].as_str().unwrap_or_default();
        let patch = self.get_patch(patch_id)?;
        self.verify_patch_artifact_hash(&patch)?;
        if self.repo_policy()?["merge_requires_clean_target"]
            .as_i64()
            .unwrap_or(1)
            == 1
            && !self.repo_is_clean()?
        {
            self.update_merge_job(merge_job_id, "blocked", Some("Target repo root is dirty."))?;
            return Ok(api_error(
                "merge_blocked",
                "Target repo root is dirty.",
                json!({"merge_job_id": merge_job_id}),
            ));
        }
        self.git_apply_check(&patch)?;
        self.update_merge_job(merge_job_id, "applying", None)?;
        self.emit_event(
            "merge_started",
            "kernel",
            REPO_ID,
            EventRefs::from_patch(&patch),
            json!({"merge_job_id": merge_job_id}),
        )?;
        let artifact = self.get_artifact(patch["diff_artifact_id"].as_str().unwrap_or_default())?;
        let diff_path = PathBuf::from(artifact["path"].as_str().unwrap_or_default());
        match run_git(
            &self.paths.repo_path,
            &["apply", diff_path.to_str().unwrap_or_default()],
        ) {
            Ok(_) => {
                self.update_merge_job(merge_job_id, "succeeded", None)?;
                self.conn
                    .execute(
                        "UPDATE patches SET status='merged', updated_at=?1 WHERE id=?2",
                        params![now_rfc3339(), patch_id],
                    )
                    .map_err(|error| format!("Unable to mark patch merged: {error}"))?;
                self.emit_event(
                    "merge_succeeded",
                    "kernel",
                    REPO_ID,
                    EventRefs::from_patch(&patch),
                    json!({"merge_job_id": merge_job_id}),
                )?;
                Ok(api_ok(
                    json!({"merge_job_id": merge_job_id, "status": "succeeded"}),
                ))
            }
            Err(error) => {
                self.update_merge_job(merge_job_id, "failed", Some(&error))?;
                self.emit_event(
                    "merge_failed",
                    "kernel",
                    REPO_ID,
                    EventRefs::from_patch(&patch),
                    json!({"merge_job_id": merge_job_id, "error": error}),
                )?;
                Ok(api_error(
                    "merge_failed",
                    "git apply failed.",
                    json!({"merge_job_id": merge_job_id}),
                ))
            }
        }
    }

    fn create_merge_job(
        &self,
        patch: &Value,
        status: &str,
        target_branch: Option<&str>,
        strategy: &str,
        error_message: Option<&str>,
    ) -> Result<String, String> {
        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO merge_jobs(
                    id, patch_id, task_id, agent_id, session_id, worktree_id, status,
                    target_branch, strategy, error_message, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![
                    id,
                    patch["id"].as_str(),
                    patch["task_id"].as_str(),
                    patch["agent_id"].as_str(),
                    patch["session_id"].as_str(),
                    patch["worktree_id"].as_str(),
                    status,
                    target_branch,
                    strategy,
                    error_message,
                    now
                ],
            )
            .map_err(|error| format!("Unable to create merge job: {error}"))?;
        Ok(id)
    }

    fn update_merge_job(
        &self,
        merge_job_id: &str,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE merge_jobs SET status=?1, error_message=?2, updated_at=?3 WHERE id=?4",
                params![status, error_message, now_rfc3339(), merge_job_id],
            )
            .map_err(|error| format!("Unable to update merge job: {error}"))?;
        Ok(())
    }

    fn repo_is_clean(&self) -> Result<bool, String> {
        let status = run_git_bytes(&self.paths.repo_path, &["status", "--porcelain", "-z"])?;
        Ok(status.is_empty())
    }

    fn git_apply_check(&self, patch: &Value) -> Result<(), String> {
        let artifact = self.get_artifact(patch["diff_artifact_id"].as_str().unwrap_or_default())?;
        let diff_path = PathBuf::from(artifact["path"].as_str().unwrap_or_default());
        run_git(
            &self.paths.repo_path,
            &["apply", "--check", diff_path.to_str().unwrap_or_default()],
        )
        .map(|_| ())
        .map_err(|error| format!("git apply --check failed: {error}"))
    }

    fn verify_patch_artifact_hash(&self, patch: &Value) -> Result<(), String> {
        let artifact_id = patch["diff_artifact_id"]
            .as_str()
            .ok_or_else(|| "Patch has no diff artifact.".to_string())?;
        let artifact = self.get_artifact(artifact_id)?;
        let path = PathBuf::from(artifact["path"].as_str().unwrap_or_default());
        let data = fs::read(&path).map_err(|error| {
            format!("Unable to read patch artifact {}: {error}", path.display())
        })?;
        let hash = sha256_hex(&data);
        if patch["diff_hash"].as_str().unwrap_or_default() != hash {
            return Err("Patch artifact hash changed after validation.".to_string());
        }
        Ok(())
    }

    fn get_patch(&self, patch_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM patches WHERE id=?1",
            &[&patch_id],
            "Patch does not exist.",
        )
    }

    fn get_patch_validation(&self, validation_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM patch_validations WHERE id=?1",
            &[&validation_id],
            "Patch validation does not exist.",
        )
    }

    fn get_merge_job(&self, merge_job_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM merge_jobs WHERE id=?1",
            &[&merge_job_id],
            "Merge job does not exist.",
        )
    }

    fn get_artifact(&self, artifact_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM artifacts WHERE id=?1",
            &[&artifact_id],
            "Artifact does not exist.",
        )
    }

    pub fn write_memory(
        &self,
        memory_kind: &str,
        title: &str,
        body: &str,
        trust_level: Option<&str>,
        task_id: Option<&str>,
        evidence_artifact_id: Option<&str>,
        orchestration_run_id: Option<&str>,
        created_by_agent_id: Option<&str>,
        certified_by: Option<&str>,
    ) -> Result<Value, String> {
        let trust_level = trust_level.unwrap_or("draft");
        if trust_level == "certified" && evidence_artifact_id.is_none() && certified_by.is_none() {
            return Err(
                "Certified memory requires evidence_artifact_id or certified_by.".to_string(),
            );
        }
        let memory_kind = normalize_memory_kind(memory_kind);
        let id = uuid();
        let directory = self.paths.memory_root.join(memory_directory(&memory_kind));
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Unable to create memory directory: {error}"))?;
        let filename = format!("{}_{}.md", slug(title), &id[..8]);
        let path = directory.join(filename);
        fs::write(&path, body).map_err(|error| {
            format!(
                "Unable to write memory markdown {}: {error}",
                path.display()
            )
        })?;
        let summary = body
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .chars()
            .take(280)
            .collect::<String>();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO memories(
                    id, memory_kind, trust_level, title, body_path, summary, evidence_artifact_id,
                    task_id, orchestration_run_id, created_by_agent_id, certified_by, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
                params![
                    id,
                    memory_kind,
                    trust_level,
                    title,
                    path.display().to_string(),
                    summary,
                    evidence_artifact_id,
                    task_id,
                    orchestration_run_id,
                    created_by_agent_id,
                    certified_by,
                    now
                ],
            )
            .map_err(|error| format!("Unable to record memory: {error}"))?;
        let event_type = match memory_kind.as_str() {
            "contract" => "contract_memory_written",
            "handoff" => "handoff_memory_written",
            _ => "memory_written",
        };
        self.emit_event(
            event_type,
            "agent",
            created_by_agent_id.unwrap_or("local"),
            EventRefs {
                task_id: task_id.map(str::to_string),
                agent_id: created_by_agent_id.map(str::to_string),
                artifact_id: evidence_artifact_id.map(str::to_string),
                orchestration_run_id: orchestration_run_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({"memory_id": id, "memory_kind": memory_kind, "title": title, "trust_level": trust_level}),
        )?;

        Ok(api_ok(
            json!({"memory_id": id, "memory_kind": memory_kind, "title": title, "body_path": path.display().to_string()}),
        ))
    }

    pub fn write_contract_memory(&self, input: &Value) -> Result<Value, String> {
        let title = required_string(input, "title")?;
        let contract_name = input["contract_name"].as_str().unwrap_or(title);
        let agent_id = input["created_by_agent_id"]
            .as_str()
            .or_else(|| input["agent_id"].as_str())
            .unwrap_or("local");
        let task_id = input["task_id"].as_str();
        let run_id = input["orchestration_run_id"].as_str();
        let resources = input["resource_keys"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .map(|value| format!("- {}", normalize_resource_key(value)))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        let body = format!(
            "# Contract: {contract_name}\n\nStatus: {}\nVersion: 1\nCreated By Agent: {agent_id}\nTask: {}\nOrchestration Run: {}\nProducer Role: {}\nConsumer Role: {}\nResource Keys:\n{}\n\n## Purpose\n\n{}\n\n## Interface\n\n{}\n\n## Inputs\n\n{}\n\n## Outputs\n\n{}\n\n## Invariants\n\n{}\n\n## Handoff Notes\n\n{}\n\n## Evidence\n\n{}\n\n## Breaking Change Policy\n\n{}\n",
            input["status"].as_str().unwrap_or("draft"),
            task_id.unwrap_or("none"),
            run_id.unwrap_or("none"),
            input["producer_role"].as_str().unwrap_or("unknown"),
            input["consumer_role"].as_str().unwrap_or("unknown"),
            if resources.is_empty() { "- none".to_string() } else { resources },
            input["purpose"].as_str().unwrap_or("Coordinates cross-agent expectations."),
            input["interface"].as_str().unwrap_or(""),
            input["inputs"].as_str().unwrap_or(""),
            input["outputs"].as_str().unwrap_or(""),
            input["invariants"].as_str().unwrap_or(""),
            input["handoff_notes"].as_str().unwrap_or(""),
            input["evidence_artifact_id"].as_str().unwrap_or("none"),
            input["breaking_change_policy"].as_str().unwrap_or("Acquire a covering contract/resource lease and submit through the kernel patch gate.")
        );

        self.write_memory(
            "contract",
            title,
            &body,
            Some("draft"),
            task_id,
            input["evidence_artifact_id"].as_str(),
            run_id,
            Some(agent_id),
            None,
        )
    }

    pub fn write_handoff_memory(&self, input: &Value) -> Result<Value, String> {
        let title = required_string(input, "title")?;
        let from_agent_id = input["from_agent_id"].as_str().unwrap_or("local");
        let from_task_id = input["from_task_id"].as_str();
        let contracts = json_list_lines(input.get("relevant_contract_ids"));
        let resources = input
            .get("relevant_resources")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .map(|value| format!("- {}", normalize_resource_key(value)))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|| "- none".to_string());
        let run_id = input["orchestration_run_id"].as_str();
        let body = format!(
            "# Handoff: {title}\n\nFrom Agent: {from_agent_id}\nFrom Task: {}\nTo Role: {}\nStatus: {}\nOrchestration Run: {}\n\n## Completed\n\n{}\n\n## Needed Next\n\n{}\n\n## Relevant Contracts\n\n{}\n\n## Relevant Resources\n\n{}\n\n## Risks\n\n{}\n\n## Evidence\n\n{}\n",
            from_task_id.unwrap_or("none"),
            input["to_role"].as_str().unwrap_or("unknown"),
            input["status"].as_str().unwrap_or("open"),
            run_id.unwrap_or("none"),
            input["completed"].as_str().unwrap_or(""),
            input["needed_next"].as_str().unwrap_or(""),
            contracts,
            resources,
            input["risks"].as_str().unwrap_or(""),
            input["evidence_artifact_id"].as_str().unwrap_or("none")
        );

        self.write_memory(
            "handoff",
            title,
            &body,
            Some("draft"),
            from_task_id,
            input["evidence_artifact_id"].as_str(),
            run_id,
            Some(from_agent_id),
            None,
        )
    }

    pub fn search_memory(
        &self,
        query: Option<&str>,
        memory_kind: Option<&str>,
        trust_level: Option<&str>,
    ) -> Result<Value, String> {
        let mut sql = "SELECT * FROM memories WHERE 1=1".to_string();
        let mut values = Vec::new();
        if let Some(kind) = memory_kind.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND memory_kind=?");
            values.push(kind.to_string());
        }
        if let Some(trust) = trust_level.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND trust_level=?");
            values.push(trust.to_string());
        }
        if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND (title LIKE ? OR summary LIKE ?)");
            values.push(format!("%{query}%"));
            values.push(format!("%{query}%"));
        }
        sql.push_str(" ORDER BY created_at DESC LIMIT 80");
        let params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        let mut rows = self.query_json(&sql, &params)?;

        if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let query_lower = query.to_ascii_lowercase();
            for row in &mut rows {
                if let Some(path) = row["body_path"].as_str() {
                    if let Ok(body) = fs::read_to_string(path) {
                        if body.to_ascii_lowercase().contains(&query_lower) {
                            row["snippet"] = Value::String(body.chars().take(360).collect());
                        }
                    }
                }
            }
        }

        Ok(api_ok(json!({"memories": rows})))
    }

    pub fn db_get_mode(&self) -> Result<Value, String> {
        let policy = self.repo_policy()?;
        Ok(api_ok(json!({
            "repo_has_sql": policy["repo_has_sql"],
            "sql_engine": policy["sql_engine"],
            "sql_mcp_default": policy["sql_mcp_default"],
            "raw_sql_mcp_allowed": policy["raw_sql_mcp_allowed"],
            "effective_mode": policy["sql_mcp_default"],
            "execution_configured": false,
            "message": "SQL execution is not configured. Classifier and migration proposal storage are local-only."
        })))
    }

    pub fn db_classify_sql(&self, sql: &str) -> Result<Value, String> {
        let classification = sql_classifier::classify_sql(sql);
        serde_json::to_value(classification)
            .map(api_ok)
            .map_err(|error| format!("Unable to serialize SQL classification: {error}"))
    }

    pub fn db_query_readonly(&self, sql: &str, environment: Option<&str>) -> Result<Value, String> {
        let policy = self.repo_policy()?;
        let mode = policy["sql_mcp_default"].as_str().unwrap_or("off");
        let classification = sql_classifier::classify_sql(sql);
        if mode == "off" {
            self.emit_event(
                "sql_command_blocked",
                "agent",
                "local",
                EventRefs::default(),
                json!({"reason": "sql_mcp_default_off", "classification": classification.classification}),
            )?;
            return Ok(api_error(
                "sql_disabled",
                "SQL MCP mode is off for this repo.",
                json!({"mode": mode}),
            ));
        }
        if !matches!(
            classification.classification.as_str(),
            "readonly_metadata" | "readonly_data" | "explain"
        ) {
            return Ok(api_error(
                "sql_blocked",
                "Only readonly SQL can use db_query_readonly.",
                json!({"classification": classification.classification}),
            ));
        }
        if environment.unwrap_or("sandbox") == "prod" {
            return Ok(api_error("prod_sql_blocked", "Production SQL is blocked without explicit human approval and configured credentials.", json!({})));
        }
        Ok(api_error(
            "sql_execution_not_configured",
            "Readonly SQL execution is not configured. No sandbox connection exists.",
            json!({"classification": classification.classification}),
        ))
    }

    pub fn db_propose_migration(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        migration_name: &str,
        engine: &str,
        up_sql: &str,
        down_sql_or_rollforward_plan: &str,
        summary: Option<&str>,
    ) -> Result<Value, String> {
        let policy = self.repo_policy()?;
        let mode = policy["sql_mcp_default"].as_str().unwrap_or("off");
        if mode == "off" {
            return Ok(api_error(
                "sql_disabled",
                "SQL MCP migration proposal mode is off.",
                json!({"mode": mode}),
            ));
        }
        let migration_resource = "db:migration_stream:main";
        if self
            .find_covering_lease(task_id, agent_id, session_id, migration_resource)?
            .is_none()
        {
            return Ok(api_error(
                "db_lease_required",
                "Acquire db:migration_stream:main or a covering db resource lease before proposing a migration.",
                json!({"resource_key": migration_resource}),
            ));
        }
        let classification = sql_classifier::classify_sql(up_sql);
        let migration_id = uuid();
        let artifact_body = format!(
            "-- Summary: {}\n-- Engine: {engine}\n\n-- Up\n{up_sql}\n\n-- Down or roll-forward plan\n{down_sql_or_rollforward_plan}\n",
            summary.unwrap_or("")
        );
        let artifact_id = self.write_artifact(
            Some(task_id),
            Some(agent_id),
            "db_migration_proposal",
            &format!("migrations/{}_{}.sql", slug(migration_name), &migration_id[..8]),
            artifact_body.as_bytes(),
            json!({"classification": classification.classification, "risk_level": classification.risk_level}),
        )?;
        let artifact = self.get_artifact(&artifact_id)?;
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO db_migrations(
                    id, task_id, patch_id, agent_id, migration_name, migration_path, engine, status,
                    data_loss_risk, created_at, updated_at
                ) VALUES(?1, ?2, NULL, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, ?8)",
                params![
                    migration_id,
                    task_id,
                    agent_id,
                    migration_name,
                    artifact["path"].as_str(),
                    engine,
                    if classification.destructive {
                        "high"
                    } else {
                        "unknown"
                    },
                    now
                ],
            )
            .map_err(|error| format!("Unable to record migration proposal: {error}"))?;
        self.emit_event(
            "db_migration_proposed",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                artifact_id: Some(artifact_id.clone()),
                ..EventRefs::default()
            },
            json!({"migration_id": migration_id, "migration_name": migration_name, "classification": classification.classification}),
        )?;

        Ok(api_ok(
            json!({"migration_id": migration_id, "artifact_id": artifact_id, "status": "draft"}),
        ))
    }

    pub fn db_validate_shadow(&self, migration_id: &str) -> Result<Value, String> {
        self.emit_event(
            "db_shadow_validation_requested",
            "agent",
            "local",
            EventRefs::default(),
            json!({"migration_id": migration_id}),
        )?;
        Ok(api_error(
            "shadow_db_not_configured",
            "No local shadow database is configured for migration validation.",
            json!({"migration_id": migration_id}),
        ))
    }

    pub fn request_approval(
        &self,
        task_id: &str,
        agent_id: &str,
        approval_kind: &str,
        reason: &str,
        risk_summary: Option<&str>,
    ) -> Result<Value, String> {
        let id = uuid();
        self.conn
            .execute(
                "INSERT INTO approvals(id, task_id, requested_by_agent_id, approval_kind, status, reason, risk_summary, created_at)
                 VALUES(?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7)",
                params![id, task_id, agent_id, approval_kind, reason, risk_summary, now_rfc3339()],
            )
            .map_err(|error| format!("Unable to create approval request: {error}"))?;
        self.emit_event(
            "approval_requested",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                ..EventRefs::default()
            },
            json!({"approval_id": id, "approval_kind": approval_kind, "reason": reason, "risk_summary": risk_summary}),
        )?;
        Ok(api_ok(json!({"approval_id": id, "status": "pending"})))
    }

    pub fn get_cloud_orchestrator_status(&self) -> Result<Value, String> {
        let config = self.query_one(
            "SELECT * FROM cloud_orchestrator_configs WHERE id='default'",
            &[],
            "Cloud orchestrator config does not exist.",
        )?;
        let recent_sync_jobs = self.query_json(
            "SELECT * FROM cloud_sync_jobs ORDER BY created_at DESC LIMIT 10",
            &[],
        )?;
        let recent_runs = self.query_json(
            "SELECT * FROM orchestration_runs ORDER BY created_at DESC LIMIT 20",
            &[],
        )?;
        Ok(json!({
            "enabled": config["enabled"].as_i64().unwrap_or(0) == 1,
            "mode": config["mode"],
            "status": config["status"],
            "endpoint_configured": config["endpoint_url"].as_str().map(|value| !value.is_empty()).unwrap_or(false),
            "context_export_policy": config["context_export_policy"],
            "allow_code_export": config["allow_code_export"].as_i64().unwrap_or(0) == 1,
            "allow_terminal_log_export": config["allow_terminal_log_export"].as_i64().unwrap_or(0) == 1,
            "allow_patch_export": config["allow_patch_export"].as_i64().unwrap_or(0) == 1,
            "auto_create_tasks": config["auto_create_tasks"].as_i64().unwrap_or(0) == 1,
            "auto_assign_agents": config["auto_assign_agents"].as_i64().unwrap_or(0) == 1,
            "auto_spawn_terminals": config["auto_spawn_terminals"].as_i64().unwrap_or(0) == 1,
            "auto_merge": false,
            "last_sync_at": config["last_sync_at"],
            "local_coordination_available": true,
            "message": if config["enabled"].as_i64().unwrap_or(0) == 1 { "Cloud adapter is configured as advisory only." } else { "Cloud orchestrator disabled; local-only coordination is active." },
            "recent_sync_jobs": recent_sync_jobs,
            "recent_orchestration_runs": recent_runs,
        }))
    }

    pub fn update_cloud_orchestrator_config(&self, input: &Value) -> Result<Value, String> {
        let enabled = input["enabled"].as_bool().unwrap_or(false);
        let mode = input["mode"]
            .as_str()
            .unwrap_or(if enabled { "mock" } else { "disabled" });
        if !matches!(mode, "disabled" | "mock" | "http_stub") {
            return Err(
                "Cloud orchestrator mode must be disabled, mock, or http_stub.".to_string(),
            );
        }
        if input["api_key"].as_str().is_some() {
            return Err("Raw API keys must not be stored. Use api_key_ref.".to_string());
        }
        let policy = input["context_export_policy"]
            .as_str()
            .unwrap_or("local_only");
        if !matches!(
            policy,
            "local_only" | "redacted_summaries" | "task_graph_only" | "full_with_explicit_approval"
        ) {
            return Err("Invalid cloud context export policy.".to_string());
        }
        let allow_code_export = input["allow_code_export"].as_bool().unwrap_or(false);
        let allow_log_export = input["allow_terminal_log_export"]
            .as_bool()
            .unwrap_or(false);
        let allow_patch_export = input["allow_patch_export"].as_bool().unwrap_or(false);
        if policy != "full_with_explicit_approval"
            && (allow_code_export || allow_log_export || allow_patch_export)
        {
            return Err("Raw code, terminal log, and patch export require full_with_explicit_approval policy.".to_string());
        }
        let now = now_rfc3339();
        self.conn
            .execute(
                "UPDATE cloud_orchestrator_configs SET
                    enabled=?1, mode=?2, endpoint_url=?3, api_key_ref=?4, model_hint=?5,
                    context_export_policy=?6, allow_code_export=?7, allow_terminal_log_export=?8,
                    allow_patch_export=?9, auto_create_tasks=?10, auto_assign_agents=?11,
                    auto_spawn_terminals=?12, auto_merge=0, status=?13, updated_at=?14
                 WHERE id='default'",
                params![
                    bool_i64(enabled),
                    if enabled { mode } else { "disabled" },
                    input["endpoint_url"].as_str(),
                    input["api_key_ref"].as_str(),
                    input["model_hint"].as_str(),
                    policy,
                    bool_i64(allow_code_export),
                    bool_i64(allow_log_export),
                    bool_i64(allow_patch_export),
                    bool_i64(input["auto_create_tasks"].as_bool().unwrap_or(false)),
                    bool_i64(input["auto_assign_agents"].as_bool().unwrap_or(false)),
                    bool_i64(input["auto_spawn_terminals"].as_bool().unwrap_or(false)),
                    if enabled { mode } else { "disabled" },
                    now
                ],
            )
            .map_err(|error| format!("Unable to update cloud orchestrator config: {error}"))?;
        self.emit_event(
            "cloud_orchestrator_config_updated",
            "user",
            "local",
            EventRefs::default(),
            json!({"enabled": enabled, "mode": mode, "context_export_policy": policy}),
        )?;
        Ok(api_ok(self.get_cloud_orchestrator_status()?))
    }

    pub fn create_orchestration_run(
        &self,
        objective: &str,
        constraints: Option<Value>,
    ) -> Result<Value, String> {
        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO orchestration_runs(id, repo_id, objective, status, source, summary, created_by, created_at, updated_at)
                 VALUES(?1, ?2, ?3, 'draft', 'local', ?4, 'user', ?5, ?5)",
                params![id, REPO_ID, objective, constraints.as_ref().map(Value::to_string), now],
            )
            .map_err(|error| format!("Unable to create orchestration run: {error}"))?;
        self.emit_event(
            "orchestration_run_created",
            "user",
            "local",
            EventRefs {
                orchestration_run_id: Some(id.clone()),
                ..EventRefs::default()
            },
            json!({"objective": objective, "constraints": constraints, "cloud_enabled": false}),
        )?;
        Ok(api_ok(
            json!({"run_id": id, "status": "draft", "source": "local", "cloud": "disabled_or_advisory"}),
        ))
    }

    pub fn create_cloud_context_export(
        &self,
        run_id: Option<&str>,
        export_kind: &str,
    ) -> Result<Value, String> {
        let status = self.get_cloud_orchestrator_status()?;
        let policy = status["context_export_policy"]
            .as_str()
            .unwrap_or("local_only");
        let export = json!({
            "repo_id": REPO_ID,
            "run_id": run_id,
            "export_kind": export_kind,
            "redaction_policy": policy,
            "source_code": "redacted",
            "terminal_logs": "redacted",
            "env_vars": "redacted",
            "patches": "redacted",
            "task_summary": self.query_json("SELECT id, title, status, priority, risk_level, assigned_role FROM tasks ORDER BY updated_at DESC LIMIT 50", &[])?,
            "lease_summary": self.list_active_leases_internal(None, None, None)?,
            "memory_summary": self.query_json("SELECT id, memory_kind, trust_level, title, summary FROM memories ORDER BY updated_at DESC LIMIT 50", &[])?,
            "event_summary": self.query_json("SELECT seq, event_type, actor_type, actor_id, task_id, agent_id, session_id, created_at FROM events ORDER BY seq DESC LIMIT 80", &[])?,
            "cloud_disabled": !status["enabled"].as_bool().unwrap_or(false),
        });
        let bytes = serde_json::to_vec_pretty(&export)
            .map_err(|error| format!("Unable to serialize cloud context export: {error}"))?;
        let artifact_id = self.write_artifact(
            None,
            None,
            "cloud_context_export",
            &format!("cloud/context-exports/{}_{}.json", export_kind, uuid()),
            &bytes,
            json!({"run_id": run_id, "export_kind": export_kind, "redaction_policy": policy}),
        )?;
        let artifact = self.get_artifact(&artifact_id)?;
        let export_id = uuid();
        self.conn
            .execute(
                "INSERT INTO cloud_context_exports(id, run_id, repo_id, export_kind, redaction_policy, artifact_id, content_hash, status, created_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'created', ?8)",
                params![export_id, run_id, REPO_ID, export_kind, policy, artifact_id, artifact["content_hash"].as_str(), now_rfc3339()],
            )
            .map_err(|error| format!("Unable to record cloud context export: {error}"))?;
        self.emit_event(
            "cloud_context_export_created",
            "kernel",
            REPO_ID,
            EventRefs {
                artifact_id: Some(artifact_id.clone()),
                orchestration_run_id: run_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({"export_id": export_id, "export_kind": export_kind, "redaction_policy": policy}),
        )?;
        Ok(api_ok(
            json!({"export_id": export_id, "artifact_id": artifact_id, "redaction_policy": policy, "sent_to_cloud": false}),
        ))
    }

    pub fn import_orchestration_plan(&self, run_id: &str, plan: &Value) -> Result<Value, String> {
        let plan_bytes = serde_json::to_vec_pretty(plan)
            .map_err(|error| format!("Unable to serialize orchestration plan: {error}"))?;
        let artifact_id = self.write_artifact(
            None,
            None,
            "orchestration_plan",
            &format!("cloud/received-plans/{}_plan.json", run_id),
            &plan_bytes,
            json!({"run_id": run_id}),
        )?;
        let items = plan["items"].as_array().cloned().unwrap_or_default();
        let mut item_ids = Vec::new();
        let mut title_to_id = HashMap::new();
        for item in &items {
            let id = uuid();
            let title = item["title"].as_str().unwrap_or("Untitled plan item");
            title_to_id.insert(title.to_string(), id.clone());
            item_ids.push(id.clone());
            self.conn
                .execute(
                    "INSERT INTO orchestration_plan_items(
                        id, run_id, parent_item_id, title, body, assigned_role, priority, risk_level,
                        status, required_resources_json, expected_outputs_json, depends_on_json,
                        contract_memory_ids_json, qa_checks_json, created_at, updated_at
                    ) VALUES(?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, 'proposed', ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                    params![
                        id,
                        run_id,
                        title,
                        item["body"].as_str(),
                        item["role"].as_str().or_else(|| item["assigned_role"].as_str()),
                        item["priority"].as_i64().unwrap_or(0),
                        item["risk_level"].as_i64().unwrap_or(1),
                        item.get("required_resources").map(Value::to_string),
                        item.get("expected_outputs").map(Value::to_string),
                        item.get("depends_on").map(Value::to_string),
                        item.get("contracts").map(Value::to_string),
                        plan.get("qa_checks").map(Value::to_string),
                        now_rfc3339()
                    ],
                )
                .map_err(|error| format!("Unable to store orchestration plan item: {error}"))?;
        }
        for contract in plan["contracts"].as_array().cloned().unwrap_or_default() {
            let mut input = contract;
            if input["title"].is_null() {
                input["title"] = Value::String("Orchestration contract".to_string());
            }
            input["orchestration_run_id"] = Value::String(run_id.to_string());
            let _ = self.write_contract_memory(&input)?;
        }
        self.conn
            .execute(
                "UPDATE orchestration_runs SET status='plan_received', plan_artifact_id=?1, summary=?2, updated_at=?3 WHERE id=?4",
                params![artifact_id, plan["summary"].as_str(), now_rfc3339(), run_id],
            )
            .map_err(|error| format!("Unable to update orchestration run after import: {error}"))?;
        self.emit_event(
            "orchestration_plan_imported",
            "kernel",
            REPO_ID,
            EventRefs {
                artifact_id: Some(artifact_id.clone()),
                orchestration_run_id: Some(run_id.to_string()),
                ..EventRefs::default()
            },
            json!({"item_count": item_ids.len()}),
        )?;
        Ok(api_ok(
            json!({"run_id": run_id, "plan_artifact_id": artifact_id, "plan_item_ids": item_ids, "status": "plan_received"}),
        ))
    }

    pub fn adopt_orchestration_plan(&self, run_id: &str) -> Result<Value, String> {
        let items = self.query_json(
            "SELECT * FROM orchestration_plan_items WHERE run_id=?1 AND status='proposed' ORDER BY priority DESC, created_at ASC",
            &[&run_id],
        )?;
        let mut plan_to_task = BTreeMap::new();

        for item in &items {
            let expected_output = item["expected_outputs_json"]
                .as_str()
                .map(|value| value.chars().take(500).collect::<String>());
            let task = self.create_task(
                item["title"].as_str().unwrap_or("Orchestration task"),
                item["body"].as_str(),
                item["priority"].as_i64().unwrap_or(0),
                item["risk_level"].as_i64().unwrap_or(1),
                Some(run_id),
                item["id"].as_str(),
                item["assigned_role"].as_str(),
                expected_output.as_deref(),
            )?;
            let task_id = task["id"].as_str().unwrap_or_default().to_string();
            plan_to_task.insert(
                item["id"].as_str().unwrap_or_default().to_string(),
                task_id.clone(),
            );
            self.conn
                .execute(
                    "UPDATE orchestration_plan_items SET task_id=?1, status='task_created', updated_at=?2 WHERE id=?3",
                    params![task_id, now_rfc3339(), item["id"].as_str()],
                )
                .map_err(|error| format!("Unable to mark plan item adopted: {error}"))?;
            self.emit_event(
                "orchestration_task_generated",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: Some(task_id),
                    orchestration_run_id: Some(run_id.to_string()),
                    ..EventRefs::default()
                },
                json!({"plan_item_id": item["id"]}),
            )?;
        }

        for item in &items {
            let Some(task_id) = item["id"]
                .as_str()
                .and_then(|id| plan_to_task.get(id))
                .cloned()
            else {
                continue;
            };
            let depends = item["depends_on_json"]
                .as_str()
                .and_then(|value| serde_json::from_str::<Value>(value).ok())
                .and_then(|value| value.as_array().cloned())
                .unwrap_or_default();
            for dependency in depends {
                let dependency_key = dependency.as_str().unwrap_or_default();
                let dependency_task_id = plan_to_task.get(dependency_key).cloned().or_else(|| {
                    items
                        .iter()
                        .find(|candidate| candidate["title"].as_str() == Some(dependency_key))
                        .and_then(|candidate| candidate["id"].as_str())
                        .and_then(|id| plan_to_task.get(id))
                        .cloned()
                });
                if let Some(depends_on_task_id) = dependency_task_id {
                    self.conn
                        .execute(
                            "INSERT OR IGNORE INTO task_dependencies(task_id, depends_on_task_id, dependency_kind, created_at)
                             VALUES(?1, ?2, 'finish_before_start', ?3)",
                            params![task_id, depends_on_task_id, now_rfc3339()],
                        )
                        .map_err(|error| format!("Unable to create task dependency: {error}"))?;
                }
            }
        }

        self.conn
            .execute(
                "UPDATE orchestration_runs SET status='adopted', updated_at=?1 WHERE id=?2",
                params![now_rfc3339(), run_id],
            )
            .map_err(|error| format!("Unable to mark orchestration run adopted: {error}"))?;
        self.emit_event(
            "orchestration_plan_adopted",
            "kernel",
            REPO_ID,
            EventRefs {
                orchestration_run_id: Some(run_id.to_string()),
                ..EventRefs::default()
            },
            json!({"task_count": plan_to_task.len()}),
        )?;
        Ok(api_ok(
            json!({"run_id": run_id, "status": "adopted", "created_tasks": plan_to_task}),
        ))
    }

    pub fn propose_agent_assignments(&self, run_id: &str) -> Result<Value, String> {
        let items = self.query_json(
            "SELECT * FROM orchestration_plan_items WHERE run_id=?1 ORDER BY priority DESC, created_at ASC",
            &[&run_id],
        )?;
        let mut created = Vec::new();
        let mut seen = HashSet::new();
        for item in items {
            let role = item["assigned_role"].as_str().unwrap_or("coding_agent");
            let key = format!("{}:{}", item["id"].as_str().unwrap_or_default(), role);
            if !seen.insert(key) {
                continue;
            }
            let id = uuid();
            self.conn
                .execute(
                    "INSERT INTO orchestration_agent_assignments(
                        id, run_id, plan_item_id, task_id, requested_agent_kind, requested_agent_name,
                        role, status, created_at, updated_at
                    ) VALUES(?1, ?2, ?3, ?4, 'coding_agent', ?5, ?6, 'proposed', ?7, ?7)",
                    params![
                        id,
                        run_id,
                        item["id"].as_str(),
                        item["task_id"].as_str(),
                        format!("{} agent", role),
                        role,
                        now_rfc3339()
                    ],
                )
                .map_err(|error| format!("Unable to propose agent assignment: {error}"))?;
            created.push(id);
        }
        self.emit_event(
            "orchestration_assignments_proposed",
            "kernel",
            REPO_ID,
            EventRefs {
                orchestration_run_id: Some(run_id.to_string()),
                ..EventRefs::default()
            },
            json!({"assignment_count": created.len()}),
        )?;
        Ok(api_ok(json!({"assignment_ids": created})))
    }

    pub fn adopt_agent_assignment(&self, assignment_id: &str) -> Result<Value, String> {
        let assignment = self.query_one(
            "SELECT * FROM orchestration_agent_assignments WHERE id=?1",
            &[&assignment_id],
            "Assignment does not exist.",
        )?;
        let role = assignment["role"].as_str().unwrap_or("coding_agent");
        let agent =
            self.create_or_get_agent(&format!("{role} agent"), "coding_agent", Some(role))?;
        let agent_id = agent["id"].as_str().unwrap_or_default();
        self.conn
            .execute(
                "UPDATE orchestration_agent_assignments SET assigned_agent_id=?1, status='accepted', updated_at=?2 WHERE id=?3",
                params![agent_id, now_rfc3339(), assignment_id],
            )
            .map_err(|error| format!("Unable to adopt assignment: {error}"))?;
        self.emit_event(
            "orchestration_assignment_adopted",
            "kernel",
            REPO_ID,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                orchestration_run_id: assignment["run_id"].as_str().map(str::to_string),
                task_id: assignment["task_id"].as_str().map(str::to_string),
                ..EventRefs::default()
            },
            json!({"assignment_id": assignment_id, "role": role}),
        )?;
        Ok(api_ok(
            json!({"assignment_id": assignment_id, "agent_id": agent_id, "status": "accepted"}),
        ))
    }

    pub fn cloud_sync_once(&self, run_id: Option<&str>) -> Result<Value, String> {
        let status = self.get_cloud_orchestrator_status()?;
        let enabled = status["enabled"].as_bool().unwrap_or(false);
        let mode = status["mode"].as_str().unwrap_or("disabled");
        if !enabled || mode == "disabled" {
            self.emit_event(
                "cloud_sync_skipped",
                "kernel",
                REPO_ID,
                EventRefs {
                    orchestration_run_id: run_id.map(str::to_string),
                    ..EventRefs::default()
                },
                json!({"reason": "Cloud orchestrator disabled"}),
            )?;
            return Ok(api_ok_warnings(
                json!({"status": "skipped", "enabled": false, "local_coordination_available": true}),
                vec!["Cloud orchestrator disabled; no network call was made.".to_string()],
            ));
        }
        if mode == "mock" {
            let imported = self.import_mock_plans(run_id)?;
            return Ok(api_ok(
                json!({"status": "mock_processed", "imported": imported}),
            ));
        }
        Ok(api_error(
            "cloud_http_stub",
            "http_stub mode is a placeholder and made no network call.",
            json!({}),
        ))
    }

    fn import_mock_plans(&self, run_id: Option<&str>) -> Result<Vec<Value>, String> {
        let mut imported = Vec::new();
        for entry in fs::read_dir(self.paths.cloud_root.join("mock-plans"))
            .map_err(|error| format!("Unable to read mock plan directory: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("Unable to read mock plan entry: {error}"))?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let body = fs::read_to_string(&path)
                .map_err(|error| format!("Unable to read mock plan {}: {error}", path.display()))?;
            let plan: Value = serde_json::from_str(&body).map_err(|error| {
                format!("Unable to parse mock plan {}: {error}", path.display())
            })?;
            let actual_run_id = match run_id {
                Some(value) => value.to_string(),
                None => {
                    let objective = plan["objective"]
                        .as_str()
                        .unwrap_or("Mock orchestration plan");
                    let run = self.create_orchestration_run(objective, None)?;
                    run["data"]["run_id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string()
                }
            };
            let result = self.import_orchestration_plan(&actual_run_id, &plan)?;
            imported.push(json!({"path": path.display().to_string(), "result": result}));
        }
        Ok(imported)
    }

    pub fn list_orchestration_runs(&self, status: Option<&str>) -> Result<Value, String> {
        let runs = if let Some(status) = status.filter(|value| !value.trim().is_empty()) {
            self.query_json(
                "SELECT * FROM orchestration_runs WHERE status=?1 ORDER BY created_at DESC",
                &[&status],
            )?
        } else {
            self.query_json(
                "SELECT * FROM orchestration_runs ORDER BY created_at DESC",
                &[],
            )?
        };
        let plan_items = self.query_json(
            "SELECT * FROM orchestration_plan_items ORDER BY created_at ASC",
            &[],
        )?;
        let assignments = self.query_json(
            "SELECT * FROM orchestration_agent_assignments ORDER BY created_at ASC",
            &[],
        )?;
        Ok(api_ok(
            json!({"runs": runs, "plan_items": plan_items, "assignments": assignments}),
        ))
    }

    pub fn get_orchestration_brief(&self, run_id: &str) -> Result<Value, String> {
        let run = self.query_one(
            "SELECT * FROM orchestration_runs WHERE id=?1",
            &[&run_id],
            "Run does not exist.",
        )?;
        Ok(api_ok(json!({
            "run": run,
            "tasks": self.query_json("SELECT * FROM tasks WHERE orchestration_run_id=?1 ORDER BY priority DESC, created_at ASC", &[&run_id])?,
            "plan_items": self.query_json("SELECT * FROM orchestration_plan_items WHERE run_id=?1 ORDER BY priority DESC, created_at ASC", &[&run_id])?,
            "assignments": self.query_json("SELECT * FROM orchestration_agent_assignments WHERE run_id=?1 ORDER BY created_at ASC", &[&run_id])?,
            "contracts": self.query_json("SELECT * FROM memories WHERE orchestration_run_id=?1 AND memory_kind='contract' ORDER BY created_at DESC", &[&run_id])?,
            "handoffs": self.query_json("SELECT * FROM memories WHERE orchestration_run_id=?1 AND memory_kind='handoff' ORDER BY created_at DESC", &[&run_id])?,
            "recent_events": self.query_json("SELECT * FROM events WHERE orchestration_run_id=?1 ORDER BY seq DESC LIMIT 50", &[&run_id])?,
            "open_blockers": self.query_json("SELECT * FROM workspace_violations WHERE status='open' ORDER BY created_at DESC LIMIT 50", &[])?,
            "leases": self.list_active_leases_internal(None, None, None)?,
            "patches": self.query_json("SELECT * FROM patches WHERE orchestration_run_id=?1 ORDER BY created_at DESC", &[&run_id])?,
            "cloud": self.get_cloud_orchestrator_status()?,
        })))
    }

    pub fn get_brief(
        &self,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        task_id: Option<&str>,
        orchestration_run_id: Option<&str>,
    ) -> Result<Value, String> {
        let session = if let Some(session_id) = session_id {
            self.query_json("SELECT * FROM agent_sessions WHERE id=?1", &[&session_id])?
        } else {
            Vec::new()
        };
        let task = if let Some(task_id) = task_id {
            self.query_json("SELECT * FROM tasks WHERE id=?1", &[&task_id])?
        } else {
            Vec::new()
        };
        Ok(api_ok(json!({
            "agents": if let Some(agent_id) = agent_id { self.query_json("SELECT * FROM agents WHERE id=?1", &[&agent_id])? } else { Vec::new() },
            "sessions": session,
            "task": task,
            "orchestration": if let Some(run_id) = orchestration_run_id { self.get_orchestration_brief(run_id)?["data"].clone() } else { Value::Null },
            "active_leases": self.list_active_leases_internal(task_id, agent_id, None)?,
            "repo_policy": self.repo_policy()?,
            "open_workspace_violations": self.list_workspace_violations(task_id, agent_id, session_id, None, Some("open"))?["data"]["violations"].clone(),
            "recent_events": self.query_json("SELECT * FROM events ORDER BY seq DESC LIMIT 50", &[])?,
            "contract_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='contract' ORDER BY updated_at DESC LIMIT 20", &[])?,
            "handoff_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='handoff' ORDER BY updated_at DESC LIMIT 20", &[])?,
            "cloud_orchestrator": self.get_cloud_orchestrator_status()?,
        })))
    }

    pub fn get_snapshot(&self) -> Result<Value, String> {
        Ok(api_ok(json!({
            "tasks": self.query_json("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT 200", &[])?,
            "sessions": self.query_json("SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 200", &[])?,
            "active_leases": self.list_active_leases_internal(None, None, None)?,
            "events": self.query_json("SELECT * FROM events ORDER BY seq DESC LIMIT 200", &[])?,
            "worktrees": self.query_json("SELECT * FROM worktrees ORDER BY updated_at DESC LIMIT 200", &[])?,
            "open_workspace_violations": self.query_json("SELECT * FROM workspace_violations WHERE status='open' ORDER BY created_at DESC LIMIT 200", &[])?,
            "patch_validations": self.query_json("SELECT * FROM patch_validations ORDER BY updated_at DESC LIMIT 200", &[])?,
            "patches": self.query_json("SELECT * FROM patches ORDER BY updated_at DESC LIMIT 200", &[])?,
            "merge_jobs": self.query_json("SELECT * FROM merge_jobs ORDER BY updated_at DESC LIMIT 200", &[])?,
            "repo_policy": self.repo_policy()?,
            "sql_policy": self.db_get_mode()?["data"].clone(),
            "memories": self.query_json("SELECT id, memory_kind, trust_level, title, summary, task_id, orchestration_run_id, created_at, updated_at FROM memories ORDER BY updated_at DESC LIMIT 200", &[])?,
            "contract_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='contract' ORDER BY updated_at DESC LIMIT 100", &[])?,
            "handoff_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='handoff' ORDER BY updated_at DESC LIMIT 100", &[])?,
            "cloud_orchestrator": self.get_cloud_orchestrator_status()?,
            "orchestration_runs": self.query_json("SELECT * FROM orchestration_runs ORDER BY updated_at DESC LIMIT 100", &[])?,
            "orchestration_plan_items": self.query_json("SELECT * FROM orchestration_plan_items ORDER BY updated_at DESC LIMIT 200", &[])?,
            "orchestration_assignments": self.query_json("SELECT * FROM orchestration_agent_assignments ORDER BY updated_at DESC LIMIT 200", &[])?,
        })))
    }

    pub fn get_alignment_report(&self) -> Result<Value, String> {
        let context = "vault_debug";
        let mut checks = Vec::new();
        let policy = self.repo_policy()?;
        let cloud = self.get_cloud_orchestrator_status()?;
        let sessions = self.query_json(
            "SELECT * FROM agent_sessions WHERE status='active' ORDER BY updated_at DESC LIMIT 200",
            &[],
        )?;
        let worktrees = self.query_json(
            "SELECT * FROM worktrees ORDER BY updated_at DESC LIMIT 200",
            &[],
        )?;
        let open_violations = self.query_json(
            "SELECT * FROM workspace_violations WHERE status='open' ORDER BY created_at DESC LIMIT 200",
            &[],
        )?;
        let patch_rows = self.query_json(
            "SELECT p.id, p.status, p.validation_id, p.task_id, p.agent_id, p.session_id, p.worktree_id,
                    v.status AS validation_status
             FROM patches p
             LEFT JOIN patch_validations v ON v.id = p.validation_id
             ORDER BY p.updated_at DESC LIMIT 200",
            &[],
        )?;
        let merge_rows = self.query_json(
            "SELECT m.id, m.status, m.strategy, m.patch_id, m.error_message,
                    p.status AS patch_status, v.status AS validation_status
             FROM merge_jobs m
             LEFT JOIN patches p ON p.id = m.patch_id
             LEFT JOIN patch_validations v ON v.id = p.validation_id
             ORDER BY m.updated_at DESC LIMIT 200",
            &[],
        )?;

        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "policy.worktree_required",
            if value_i64(&policy, "agent_worktree_required") == 1 {
                "aligned"
            } else {
                "violation"
            },
            if value_i64(&policy, "agent_worktree_required") == 1 {
                "Write-enabled app-launched agents require isolated worktrees."
            } else {
                "agent_worktree_required is disabled, so app-launched agents could edit the control workspace."
            },
            json!({"agent_worktree_required": value_i64(&policy, "agent_worktree_required")}),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "policy.patch_lease_gate",
            if value_i64(&policy, "patch_lease_validation_required") == 1 {
                "aligned"
            } else {
                "violation"
            },
            if value_i64(&policy, "patch_lease_validation_required") == 1 {
                "Patch submission requires active lease coverage."
            } else {
                "patch_lease_validation_required is disabled, so lease coverage is not authoritative."
            },
            json!({"patch_lease_validation_required": value_i64(&policy, "patch_lease_validation_required")}),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "policy.merge_gate",
            if value_i64(&policy, "merge_gate_required") == 1 {
                "aligned"
            } else {
                "violation"
            },
            if value_i64(&policy, "merge_gate_required") == 1 {
                "The kernel merge/apply gate remains required."
            } else {
                "merge_gate_required is disabled, so accepted patches could bypass the kernel gate."
            },
            json!({"merge_gate_required": value_i64(&policy, "merge_gate_required")}),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "policy.unleased_write_rejection",
            if policy["unleased_write_policy"].as_str() == Some("reject_patch") {
                "aligned"
            } else {
                "warning"
            },
            if policy["unleased_write_policy"].as_str() == Some("reject_patch") {
                "Open unleased writes reject patch submission by default."
            } else {
                "unleased_write_policy is not reject_patch; review override posture before trusting patch acceptance."
            },
            json!({"unleased_write_policy": policy["unleased_write_policy"].clone()}),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "policy.sql_safe_default",
            if policy["sql_mcp_default"].as_str() == Some("off")
                && value_i64(&policy, "raw_sql_mcp_allowed") == 0
            {
                "aligned"
            } else {
                "warning"
            },
            if policy["sql_mcp_default"].as_str() == Some("off")
                && value_i64(&policy, "raw_sql_mcp_allowed") == 0
            {
                "SQL MCP execution remains off and raw SQL access is blocked."
            } else {
                "SQL MCP policy has been loosened from the local-first safe default."
            },
            json!({
                "sql_mcp_default": policy["sql_mcp_default"].clone(),
                "raw_sql_mcp_allowed": value_i64(&policy, "raw_sql_mcp_allowed")
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "cloud.disabled_or_advisory",
            if cloud["enabled"].as_bool().unwrap_or(false) {
                "warning"
            } else {
                "aligned"
            },
            if cloud["enabled"].as_bool().unwrap_or(false) {
                "Cloud orchestrator is enabled; it must remain advisory and local gates are still authoritative."
            } else {
                "Cloud orchestrator is disabled/local-only and no cloud sync is required for local coordination."
            },
            json!({
                "enabled": cloud["enabled"].clone(),
                "mode": cloud["mode"].clone(),
                "context_export_policy": cloud["context_export_policy"].clone()
            }),
        );

        let export_risk = cloud["allow_code_export"].as_bool().unwrap_or(false)
            || cloud["allow_terminal_log_export"]
                .as_bool()
                .unwrap_or(false)
            || cloud["allow_patch_export"].as_bool().unwrap_or(false);
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "cloud.export_policy",
            if export_risk { "violation" } else { "aligned" },
            if export_risk {
                "Cloud export permits raw code, terminal logs, or patches; the optimized proposal blocks those by default."
            } else {
                "Cloud export policy does not allow raw code, terminal logs, or raw patch export."
            },
            json!({
                "allow_code_export": cloud["allow_code_export"].clone(),
                "allow_terminal_log_export": cloud["allow_terminal_log_export"].clone(),
                "allow_patch_export": cloud["allow_patch_export"].clone()
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "cloud.auto_merge",
            if cloud["auto_merge"].as_bool().unwrap_or(false) {
                "violation"
            } else {
                "aligned"
            },
            if cloud["auto_merge"].as_bool().unwrap_or(false) {
                "Cloud auto-merge is enabled, which would violate the local merge authority invariant."
            } else {
                "Cloud auto-merge is disabled; merges must pass the local kernel gate."
            },
            json!({"auto_merge": cloud["auto_merge"].clone()}),
        );

        for session in &sessions {
            let session_id = session["id"].as_str().unwrap_or("unknown");
            let enforcement_mode = session["enforcement_mode"].as_str().unwrap_or("unknown");
            let write_root = session["write_root"].as_str().unwrap_or("");
            let worktree_id = session["worktree_id"].as_str().unwrap_or("");
            if enforcement_mode == "worktree_required" {
                let missing_worktree = worktree_id.is_empty();
                let writes_repo_root =
                    same_path_text(write_root, &process_path_text(&self.paths.repo_path));
                let under_worktrees = path_text_under_path(write_root, &self.paths.worktrees_root);
                let status = if missing_worktree || writes_repo_root || !under_worktrees {
                    "violation"
                } else {
                    "aligned"
                };
                let reason = if missing_worktree {
                    "Active write-enabled session has worktree_required mode but no worktree_id."
                } else if writes_repo_root {
                    "Active write-enabled session write_root points at the shared control repo."
                } else if !under_worktrees {
                    "Active write-enabled session write_root is outside .agents/worktrees."
                } else {
                    "Active write-enabled session is isolated in a recorded worktree."
                };
                record_alignment_check(
                    &self.paths.repo_path,
                    &mut checks,
                    context,
                    "session.worktree_isolation",
                    status,
                    reason,
                    json!({
                        "session_id": session_id,
                        "agent_id": session["agent_id"].clone(),
                        "worktree_id": worktree_id,
                        "write_root": write_root,
                        "repo_path": process_path_text(&self.paths.repo_path),
                        "worktrees_root": process_path_text(&self.paths.worktrees_root)
                    }),
                );

                let mut missing = Vec::new();
                for path in [
                    self.paths.mcp_root.join(format!("{session_id}.json")),
                    self.paths.mcp_root.join(format!("{session_id}.codex.toml")),
                    self.paths
                        .mcp_root
                        .join(format!("{session_id}.claude.json")),
                ] {
                    if !path.exists() {
                        missing.push(process_path_text(&path));
                    }
                }
                if !write_root.is_empty() {
                    let worktree_path = PathBuf::from(write_root);
                    for path in [
                        worktree_path.join(".mcp.json"),
                        worktree_path.join(".codex").join("config.toml"),
                    ] {
                        if !path.exists() {
                            missing.push(process_path_text(&path));
                        }
                    }
                }
                record_alignment_check(
                    &self.paths.repo_path,
                    &mut checks,
                    context,
                    "session.mcp_auto_activation",
                    if missing.is_empty() {
                        "aligned"
                    } else {
                        "warning"
                    },
                    if missing.is_empty() {
                        "Session has generated MCP config and worktree-local activation files."
                    } else {
                        "Session is missing one or more generated MCP activation files."
                    },
                    json!({
                        "session_id": session_id,
                        "worktree_id": worktree_id,
                        "missing_paths": missing,
                    }),
                );
            } else if enforcement_mode == "coordination_only" {
                record_alignment_check(
                    &self.paths.repo_path,
                    &mut checks,
                    context,
                    "session.coordination_only",
                    "warning",
                    "Session degraded to coordination_only, usually because git worktree creation was unavailable; patch/merge should remain blocked by default.",
                    json!({
                        "session_id": session_id,
                        "agent_id": session["agent_id"].clone(),
                        "write_root": write_root,
                    }),
                );
            }
        }

        for worktree in &worktrees {
            let path = worktree["path"].as_str().unwrap_or("");
            let exists = !path.is_empty() && PathBuf::from(path).exists();
            record_alignment_check(
                &self.paths.repo_path,
                &mut checks,
                context,
                "worktree.record_path",
                if exists { "aligned" } else { "warning" },
                if exists {
                    "Recorded worktree path exists."
                } else {
                    "Recorded worktree path is missing; the session may be stale or the worktree was removed externally."
                },
                json!({
                    "worktree_id": worktree["id"].clone(),
                    "session_id": worktree["session_id"].clone(),
                    "path": path,
                    "status": worktree["status"].clone(),
                }),
            );
        }

        let severe_violations = open_violations
            .iter()
            .filter(|violation| {
                matches!(violation["severity"].as_str(), Some("error" | "critical"))
            })
            .count();
        let unleased_violations = open_violations
            .iter()
            .filter(|violation| violation["violation_kind"].as_str() == Some("unleased_write"))
            .count();
        let root_repo_violations = open_violations
            .iter()
            .filter(|violation| violation["violation_kind"].as_str() == Some("root_repo_write"))
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "violations.open_blockers",
            if severe_violations > 0 || unleased_violations > 0 || root_repo_violations > 0 {
                "violation"
            } else if open_violations.is_empty() {
                "aligned"
            } else {
                "warning"
            },
            if severe_violations > 0 {
                "Open error/critical workspace violations must be resolved or human-overridden before accepting patches."
            } else if unleased_violations > 0 {
                "Open unleased-write violations exist and should reject patch submission by default."
            } else if root_repo_violations > 0 {
                "Shared repo root writes were detected; the control workspace may be dirty or externally modified."
            } else if open_violations.is_empty() {
                "No open workspace violations are currently recorded."
            } else {
                "Only low-severity open workspace violations are present."
            },
            json!({
                "open_count": open_violations.len(),
                "severe_count": severe_violations,
                "unleased_write_count": unleased_violations,
                "root_repo_write_count": root_repo_violations,
            }),
        );

        for patch in &patch_rows {
            let status = patch["status"].as_str().unwrap_or("unknown");
            let validation_status = patch["validation_status"].as_str().unwrap_or("missing");
            let accepted_state = matches!(status, "submitted" | "merge_queued" | "merged");
            record_alignment_check(
                &self.paths.repo_path,
                &mut checks,
                context,
                "patch.validation_authority",
                if accepted_state && validation_status != "passed" {
                    "violation"
                } else {
                    "aligned"
                },
                if accepted_state && validation_status != "passed" {
                    "Patch is in an accepted/mergeable state without a passed validation."
                } else {
                    "Patch state is consistent with its validation record."
                },
                json!({
                    "patch_id": patch["id"].clone(),
                    "patch_status": status,
                    "validation_status": validation_status,
                    "session_id": patch["session_id"].clone(),
                    "worktree_id": patch["worktree_id"].clone(),
                }),
            );
        }

        for merge in &merge_rows {
            let merge_status = merge["status"].as_str().unwrap_or("unknown");
            let validation_status = merge["validation_status"].as_str().unwrap_or("missing");
            let bad_merge_state = matches!(
                merge_status,
                "queued" | "checking" | "applying" | "succeeded"
            ) && validation_status != "passed";
            record_alignment_check(
                &self.paths.repo_path,
                &mut checks,
                context,
                "merge.gate_authority",
                if bad_merge_state {
                    "violation"
                } else {
                    "aligned"
                },
                if bad_merge_state {
                    "Merge job is active or succeeded without a passed patch validation."
                } else {
                    "Merge job state is consistent with patch validation authority."
                },
                json!({
                    "merge_job_id": merge["id"].clone(),
                    "merge_status": merge_status,
                    "patch_id": merge["patch_id"].clone(),
                    "patch_status": merge["patch_status"].clone(),
                    "validation_status": validation_status,
                    "strategy": merge["strategy"].clone(),
                }),
            );
        }

        let aligned_count = checks
            .iter()
            .filter(|check| check["status"].as_str() == Some("aligned"))
            .count();
        let warning_count = checks
            .iter()
            .filter(|check| check["status"].as_str() == Some("warning"))
            .count();
        let violation_count = checks
            .iter()
            .filter(|check| check["status"].as_str() == Some("violation"))
            .count();
        let overall_status = if violation_count > 0 {
            "violation"
        } else if warning_count > 0 {
            "warning"
        } else {
            "aligned"
        };
        let recent_events =
            self.query_json("SELECT * FROM events ORDER BY seq DESC LIMIT 60", &[])?;

        Ok(api_ok(json!({
            "summary": {
                "status": overall_status,
                "aligned": aligned_count,
                "warnings": warning_count,
                "violations": violation_count,
                "generated_at": now_rfc3339(),
                "repo_path": process_path_text(&self.paths.repo_path),
                "log": alignment::log_metadata(&self.paths.repo_path),
            },
            "checks": checks,
            "policy": policy,
            "cloud": cloud,
            "sessions": sessions,
            "worktrees": worktrees,
            "open_workspace_violations": open_violations,
            "patches": patch_rows,
            "merge_jobs": merge_rows,
            "events": recent_events,
        })))
    }

    pub fn repo_policy(&self) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM repo_policies WHERE repo_id=?1",
            &[&REPO_ID],
            "Repo policy does not exist.",
        )
    }

    pub fn update_repo_policy(&self, patch: &Value) -> Result<Value, String> {
        let allowed = [
            "sql_mcp_default",
            "repo_has_sql",
            "sql_engine",
            "raw_sql_mcp_allowed",
            "agent_worktree_required",
            "patch_lease_validation_required",
            "merge_gate_required",
            "unleased_write_policy",
            "merge_requires_clean_target",
        ];
        for key in allowed {
            if let Some(value) = patch.get(key) {
                let sql =
                    format!("UPDATE repo_policies SET {key}=?1, updated_at=?2 WHERE repo_id=?3");
                if value.is_boolean() {
                    self.conn
                        .execute(
                            &sql,
                            params![
                                bool_i64(value.as_bool().unwrap_or(false)),
                                now_rfc3339(),
                                REPO_ID
                            ],
                        )
                        .map_err(|error| format!("Unable to update repo policy {key}: {error}"))?;
                } else if let Some(number) = value.as_i64() {
                    self.conn
                        .execute(&sql, params![number, now_rfc3339(), REPO_ID])
                        .map_err(|error| format!("Unable to update repo policy {key}: {error}"))?;
                } else if let Some(text) = value.as_str() {
                    self.conn
                        .execute(&sql, params![text, now_rfc3339(), REPO_ID])
                        .map_err(|error| format!("Unable to update repo policy {key}: {error}"))?;
                }
            }
        }
        self.emit_event(
            "sql_policy_updated",
            "user",
            "local",
            EventRefs::default(),
            json!({"patch": patch}),
        )?;
        Ok(api_ok(self.repo_policy()?))
    }

    pub fn list_events(&self, limit: Option<i64>) -> Result<Value, String> {
        let limit = limit.unwrap_or(200).clamp(1, 1000);
        Ok(api_ok(
            json!({"events": self.query_json(&format!("SELECT * FROM events ORDER BY seq DESC LIMIT {limit}"), &[])?}),
        ))
    }

    pub fn list_workspace_violations(
        &self,
        task_id: Option<&str>,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        worktree_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Value, String> {
        let mut sql = "SELECT * FROM workspace_violations WHERE 1=1".to_string();
        let mut values = Vec::new();
        for (column, value) in [
            ("task_id", task_id),
            ("agent_id", agent_id),
            ("session_id", session_id),
            ("worktree_id", worktree_id),
            ("status", status),
        ] {
            if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
                sql.push_str(&format!(" AND {column}=?"));
                values.push(value.to_string());
            }
        }
        sql.push_str(" ORDER BY created_at DESC LIMIT 200");
        let params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        Ok(api_ok(
            json!({"violations": self.query_json(&sql, &params)?}),
        ))
    }

    pub fn resolve_workspace_violation(
        &self,
        violation_id: &str,
        resolution: &str,
        reason: &str,
        human_actor: &str,
    ) -> Result<Value, String> {
        if !matches!(resolution, "resolved" | "overridden") {
            return Err("Resolution must be resolved or overridden.".to_string());
        }
        if resolution == "overridden" && human_actor.trim().is_empty() {
            return Err("Override requires a human_actor.".to_string());
        }
        self.conn
            .execute(
                "UPDATE workspace_violations SET status=?1, resolved_at=?2, details_json=json_set(COALESCE(details_json, '{}'), '$.resolution_reason', ?3, '$.human_actor', ?4) WHERE id=?5",
                params![resolution, now_rfc3339(), reason, human_actor, violation_id],
            )
            .map_err(|error| format!("Unable to resolve workspace violation: {error}"))?;
        self.emit_event(
            "workspace_violation_resolved",
            "human",
            human_actor,
            EventRefs::default(),
            json!({"violation_id": violation_id, "resolution": resolution, "reason": reason}),
        )?;
        Ok(api_ok(
            json!({"violation_id": violation_id, "status": resolution}),
        ))
    }

    pub fn create_workspace_violation(
        &self,
        task_id: Option<&str>,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        worktree_id: Option<&str>,
        violation_kind: &str,
        path: Option<&str>,
        resource_key: Option<&str>,
        severity: &str,
        details: Value,
    ) -> Result<String, String> {
        let id = uuid();
        let normalized_resource = resource_key.map(normalize_resource_key);
        self.conn
            .execute(
                "INSERT INTO workspace_violations(
                    id, repo_id, task_id, agent_id, session_id, worktree_id, violation_kind,
                    path, resource_key, severity, status, details_json, created_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11, ?12)",
                params![
                    id,
                    REPO_ID,
                    task_id,
                    agent_id,
                    session_id,
                    worktree_id,
                    violation_kind,
                    path,
                    normalized_resource,
                    severity,
                    details.to_string(),
                    now_rfc3339()
                ],
            )
            .map_err(|error| format!("Unable to record workspace violation: {error}"))?;
        let event_type = match violation_kind {
            "unleased_write" => "unleased_write_detected",
            "root_repo_write" => "root_repo_write_detected",
            _ => "workspace_violation_created",
        };
        self.emit_event(
            event_type,
            "kernel",
            REPO_ID,
            EventRefs {
                task_id: task_id.map(str::to_string),
                agent_id: agent_id.map(str::to_string),
                session_id: session_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({"violation_id": id, "violation_kind": violation_kind, "path": path, "severity": severity}),
        )?;
        if event_type != "workspace_violation_created" {
            self.emit_event(
                "workspace_violation_created",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: task_id.map(str::to_string),
                    agent_id: agent_id.map(str::to_string),
                    session_id: session_id.map(str::to_string),
                    ..EventRefs::default()
                },
                json!({"violation_id": id, "violation_kind": violation_kind, "path": path, "severity": severity}),
            )?;
        }
        Ok(id)
    }

    fn mark_stale_sessions_interrupted(&self) -> Result<(), String> {
        let stale_before = rfc3339_after_seconds(-SESSION_STALE_SECONDS);
        let stale = self.query_json(
            "SELECT id FROM agent_sessions WHERE status='active' AND last_heartbeat_at < ?1",
            &[&stale_before],
        )?;
        for session in stale {
            if let Some(session_id) = session["id"].as_str() {
                let _ = self.interrupt_session(session_id, "stale_heartbeat")?;
            }
        }
        Ok(())
    }

    fn mark_duplicate_pty_sessions_interrupted(&self) -> Result<(), String> {
        let sessions = self.query_json(
            "SELECT id, pty_id, updated_at, created_at
             FROM agent_sessions
             WHERE status='active' AND pty_id IS NOT NULL AND pty_id <> ''
             ORDER BY pty_id ASC, updated_at DESC, created_at DESC",
            &[],
        )?;
        let mut seen_pty_ids = HashSet::new();
        for session in sessions {
            let Some(pty_id) = session["pty_id"].as_str() else {
                continue;
            };
            if seen_pty_ids.insert(pty_id.to_string()) {
                continue;
            }
            if let Some(session_id) = session["id"].as_str() {
                let _ = self.interrupt_session(session_id, "duplicate_pty_session_recovered")?;
            }
        }
        Ok(())
    }

    fn mark_unsafe_coordination_only_sessions_interrupted(&self) -> Result<(), String> {
        if !repo_has_git(&self.paths.repo_path) {
            return Ok(());
        }

        let sessions = self.query_json(
            "SELECT id FROM agent_sessions WHERE status='active' AND enforcement_mode='coordination_only'",
            &[],
        )?;
        for session in sessions {
            if let Some(session_id) = session["id"].as_str() {
                let _ = self.interrupt_session(session_id, "unsafe_coordination_only_recovered")?;
            }
        }
        Ok(())
    }

    fn ensure_agent_exists(&self, agent_id: &str) -> Result<(), String> {
        let exists: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(1) FROM agents WHERE id=?1",
                [agent_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Unable to inspect agent: {error}"))?;
        if exists == 0 {
            return Err("Agent does not exist.".to_string());
        }
        Ok(())
    }

    fn ensure_session_active(&self, session_id: &str, agent_id: &str) -> Result<Value, String> {
        let session = self.query_one(
            "SELECT * FROM agent_sessions WHERE id=?1 AND agent_id=?2",
            &[&session_id, &agent_id],
            "Session does not exist for this agent.",
        )?;
        if session["status"].as_str() != Some("active") {
            return Err("Session is not active.".to_string());
        }
        Ok(session)
    }

    fn ensure_session_authorized_for_task(
        &self,
        session_id: &str,
        task_id: &str,
    ) -> Result<(), String> {
        let task = self.query_one(
            "SELECT * FROM tasks WHERE id=?1",
            &[&task_id],
            "Task does not exist.",
        )?;
        if let Some(claimed) = task["claimed_session_id"].as_str() {
            if !claimed.is_empty() && claimed != session_id {
                return Err("Task is claimed by another session.".to_string());
            }
        }
        Ok(())
    }

    pub fn create_worktree_for_session(
        &self,
        agent_id: &str,
        session_id: &str,
        task_id: Option<&str>,
    ) -> Result<Value, String> {
        if !self.paths.repo_path.join(".git").exists() {
            return Err("Repo has no .git; worktree isolation is unavailable.".to_string());
        }
        run_git(&self.paths.repo_path, &["rev-parse", "--show-toplevel"])?;
        let base_sha = run_git(&self.paths.repo_path, &["rev-parse", "HEAD"])?
            .trim()
            .to_string();
        let safe_agent = safe_id(agent_id);
        let safe_task = safe_id(task_id.unwrap_or(session_id));
        let mut branch = format!("agent/{safe_agent}/{safe_task}");
        let mut path = self
            .paths
            .worktrees_root
            .join(format!("{safe_agent}_{safe_task}"));
        let mut suffix = 0usize;
        while path.exists() || self.branch_exists(&branch)? {
            suffix += 1;
            branch = format!("agent/{safe_agent}/{safe_task}-{suffix}");
            path = self
                .paths
                .worktrees_root
                .join(format!("{safe_agent}_{safe_task}_{suffix}"));
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to create worktree root: {error}"))?;
        }
        let path_string = process_path_text(&path);
        run_git(
            &self.paths.repo_path,
            &["worktree", "add", "-b", &branch, &path_string],
        )?;
        let canonical_worktree = path.canonicalize().unwrap_or(path);
        let worktree_path_text = process_path_text(&canonical_worktree);
        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO worktrees(id, agent_id, session_id, path, branch_name, base_sha, current_sha, status, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6, 'active', ?7, ?7)",
                params![
                    id,
                    agent_id,
                    session_id,
                    worktree_path_text.clone(),
                    branch.clone(),
                    base_sha.clone(),
                    now
                ],
            )
            .map_err(|error| format!("Unable to record worktree: {error}"))?;
        self.emit_event(
            "worktree_created",
            "kernel",
            REPO_ID,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                task_id: task_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({"worktree_id": id, "path": worktree_path_text.clone(), "branch_name": branch.clone(), "base_sha": base_sha.clone()}),
        )?;

        Ok(json!({
            "id": id,
            "agentId": agent_id,
            "sessionId": session_id,
            "path": worktree_path_text,
            "branchName": branch,
            "baseSha": base_sha,
            "status": "active",
        }))
    }

    fn branch_exists(&self, branch: &str) -> Result<bool, String> {
        let status = Command::new("git")
            .current_dir(PathBuf::from(process_path_text(&self.paths.repo_path)))
            .args([
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ])
            .status()
            .map_err(|error| format!("Unable to inspect git branches: {error}"))?;
        Ok(status.success())
    }

    fn get_worktree(&self, worktree_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM worktrees WHERE id=?1",
            &[&worktree_id],
            "Worktree does not exist.",
        )
    }

    fn write_artifact(
        &self,
        task_id: Option<&str>,
        agent_id: Option<&str>,
        artifact_kind: &str,
        relative_path: &str,
        bytes: &[u8],
        metadata: Value,
    ) -> Result<String, String> {
        let safe_relative = relative_path.replace('\\', "/");
        reject_path_escape(&safe_relative)?;
        let path = self.paths.artifacts_root.join(&safe_relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to create artifact directory: {error}"))?;
        }
        fs::write(&path, bytes)
            .map_err(|error| format!("Unable to write artifact {}: {error}", path.display()))?;
        let id = uuid();
        let hash = sha256_hex(bytes);
        self.conn
            .execute(
                "INSERT INTO artifacts(id, task_id, agent_id, artifact_kind, path, content_hash, size_bytes, metadata_json, created_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    task_id,
                    agent_id,
                    artifact_kind,
                    path.display().to_string(),
                    hash,
                    bytes.len() as i64,
                    metadata.to_string(),
                    now_rfc3339()
                ],
            )
            .map_err(|error| format!("Unable to record artifact: {error}"))?;
        Ok(id)
    }

    fn query_one(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
        missing: &str,
    ) -> Result<Value, String> {
        let mut rows = self.query_json(sql, params)?;
        rows.pop().ok_or_else(|| missing.to_string())
    }

    pub fn query_json(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> Result<Vec<Value>, String> {
        let mut statement = self
            .conn
            .prepare(sql)
            .map_err(|error| format!("Unable to prepare query: {error}"))?;
        let column_names = statement
            .column_names()
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let mut rows = statement
            .query(params)
            .map_err(|error| format!("Unable to execute query: {error}"))?;
        let mut values = Vec::new();

        while let Some(row) = rows
            .next()
            .map_err(|error| format!("Unable to read query row: {error}"))?
        {
            let mut object = serde_json::Map::new();
            for (index, name) in column_names.iter().enumerate() {
                let value = match row
                    .get_ref(index)
                    .map_err(|error| format!("Unable to read column {name}: {error}"))?
                {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(value) => Value::Number(value.into()),
                    ValueRef::Real(value) => serde_json::Number::from_f64(value)
                        .map(Value::Number)
                        .unwrap_or(Value::Null),
                    ValueRef::Text(value) => {
                        let text = String::from_utf8_lossy(value).to_string();
                        if (name.ends_with("_json")
                            || matches!(name.as_str(), "payload_json" | "details_json"))
                            && !text.trim().is_empty()
                        {
                            serde_json::from_str(&text).unwrap_or(Value::String(text))
                        } else {
                            Value::String(text)
                        }
                    }
                    ValueRef::Blob(value) => Value::String(format!("<{} bytes>", value.len())),
                };
                object.insert(name.clone(), value);
            }
            values.push(Value::Object(object));
        }

        Ok(values)
    }
}

#[derive(Default)]
pub struct EventRefs {
    pub task_id: Option<String>,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    pub resource_id: Option<String>,
    pub artifact_id: Option<String>,
    pub orchestration_run_id: Option<String>,
}

struct SessionMcpConfigPaths {
    generic_path: String,
    codex_path: String,
    claude_path: String,
}

impl EventRefs {
    fn from_patch(patch: &Value) -> Self {
        Self {
            task_id: patch["task_id"].as_str().map(str::to_string),
            agent_id: patch["agent_id"].as_str().map(str::to_string),
            session_id: patch["session_id"].as_str().map(str::to_string),
            resource_id: None,
            artifact_id: patch["diff_artifact_id"].as_str().map(str::to_string),
            orchestration_run_id: patch["orchestration_run_id"].as_str().map(str::to_string),
        }
    }
}

#[derive(Clone)]
struct ChangedFile {
    path: String,
    change_kind: String,
    untracked: bool,
}

fn non_empty<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required."));
    }
    Ok(trimmed)
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required."))
}

fn rfc3339_after_seconds(seconds: i64) -> String {
    let now = SystemTime::now();
    let target = if seconds >= 0 {
        now + Duration::from_secs(seconds as u64)
    } else {
        now - Duration::from_secs((-seconds) as u64)
    };
    let duration = target
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}

fn is_expired(value: &str) -> bool {
    value < now_rfc3339().as_str()
}

fn is_retryable_event_insert_error(error: &rusqlite::Error) -> bool {
    match error {
        rusqlite::Error::SqliteFailure(inner, message) => {
            matches!(
                inner.code,
                ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked
            ) || (message
                .as_deref()
                .unwrap_or_default()
                .contains("events.seq")
                && matches!(inner.code, ErrorCode::ConstraintViolation))
        }
        _ => false,
    }
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let bytes = run_git_bytes(cwd, args)?;
    String::from_utf8(bytes).map_err(|error| format!("Git output was not UTF-8: {error}"))
}

fn repo_has_git(repo_path: &Path) -> bool {
    run_git(repo_path, &["rev-parse", "--is-inside-work-tree"])
        .map(|value| value.trim() == "true")
        .unwrap_or(false)
}

fn run_git_bytes(cwd: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .current_dir(PathBuf::from(process_path_text(cwd)))
        .args(args)
        .output()
        .map_err(|error| format!("Unable to run git {}: {error}", args.join(" ")))?;

    if output.status.success() {
        return Ok(output.stdout);
    }

    Err(format!(
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create {}: {error}", parent.display()))?;
    }
    let mut file = fs::File::create(path)
        .map_err(|error| format!("Unable to create {}: {error}", path.display()))?;
    let body = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to serialize {}: {error}", path.display()))?;
    file.write_all(&body)
        .map_err(|error| format!("Unable to write {}: {error}", path.display()))
}

fn write_text_file(path: &Path, value: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create {}: {error}", parent.display()))?;
    }
    fs::write(path, value).map_err(|error| format!("Unable to write {}: {error}", path.display()))
}

fn codex_config_toml(command: &str, args: &[String]) -> String {
    let args = args
        .iter()
        .map(|arg| format!("\"{}\"", toml_escape(arg)))
        .collect::<Vec<_>>()
        .join(", ");

    let mut config = format!(
        "[mcp_servers.coordination-kernel]\ncommand = \"{}\"\nargs = [{}]\ndefault_tools_approval_mode = \"prompt\"\n",
        toml_escape(command),
        args
    );

    for tool in CODEX_AUTO_APPROVED_COORDINATION_TOOLS {
        config.push_str(&format!(
            "\n[mcp_servers.coordination-kernel.tools.{}]\napproval_mode = \"approve\"\n",
            tool
        ));
    }

    config
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn safe_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>()
}

fn slug(value: &str) -> String {
    let slug = safe_id(value);
    if slug.is_empty() {
        "item".to_string()
    } else {
        slug
    }
}

fn normalize_memory_kind(value: &str) -> String {
    match value {
        "decision" | "contract" | "handoff" | "bug" | "migration" | "qa" | "run_summary" => {
            value.to_string()
        }
        "decisions" => "decision".to_string(),
        "contracts" => "contract".to_string(),
        "handoffs" => "handoff".to_string(),
        "bugs" => "bug".to_string(),
        "migrations" => "migration".to_string(),
        "runs" => "run_summary".to_string(),
        _ => "decision".to_string(),
    }
}

fn memory_directory(kind: &str) -> &'static str {
    match kind {
        "contract" => "contracts",
        "handoff" => "handoffs",
        "bug" => "bugs",
        "migration" => "migrations",
        "qa" => "qa",
        "run_summary" => "runs",
        _ => "decisions",
    }
}

fn json_list_lines(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| format!("- {item}"))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| "- none".to_string())
}

fn record_alignment_check(
    repo_path: &Path,
    checks: &mut Vec<Value>,
    context: &str,
    check: &str,
    status: &str,
    reason: impl Into<String>,
    details: Value,
) {
    let entry = alignment::check_entry(context, check, status, reason, details);
    if let Err(error) = alignment::write_check(repo_path, &entry) {
        checks.push(alignment::check_entry(
            context,
            "alignment.log_write",
            "warning",
            format!(
                "Alignment check was computed, but the JSONL log could not be written: {error}"
            ),
            json!({}),
        ));
    }
    checks.push(entry);
}

fn require_workspace_objective_key(workspace_id: Option<&str>) -> Result<String, String> {
    workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            "Server-backed workspace id is required for the Coordination Kernel MCP objective key."
                .to_string()
        })
}

fn value_i64(value: &Value, key: &str) -> i64 {
    value[key].as_i64().unwrap_or(0)
}

fn same_path_text(left: &str, right: &str) -> bool {
    normalize_path_for_compare(left) == normalize_path_for_compare(right)
}

fn path_text_under_path(child: &str, parent: &Path) -> bool {
    let child = normalize_path_for_compare(child);
    let mut parent = normalize_path_for_compare(&process_path_text(parent));
    if parent.is_empty() || child.is_empty() {
        return false;
    }
    if !parent.ends_with('/') {
        parent.push('/');
    }
    child.starts_with(&parent)
}

fn normalize_path_for_compare(value: &str) -> String {
    let normalized = value.replace('\\', "/").trim_end_matches('/').to_string();
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

    use serde_json::json;

    use super::*;

    fn temp_repo(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("diffforge_kernel_test_{}_{}", name, uuid()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn init_git_repo(name: &str) -> PathBuf {
        let repo = temp_repo(name);
        run(&repo, "git", &["init"]);
        fs::write(repo.join("src.txt"), "initial\n").unwrap();
        run(&repo, "git", &["add", "src.txt"]);
        run(
            &repo,
            "git",
            &[
                "-c",
                "user.email=test@example.com",
                "-c",
                "user.name=Test",
                "commit",
                "-m",
                "init",
            ],
        );
        repo
    }

    fn run(cwd: &Path, command: &str, args: &[&str]) {
        let output = Command::new(command)
            .current_dir(cwd)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{} {} failed: {}",
            command,
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn initializes_schema_and_defaults() {
        let repo = temp_repo("schema");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let policy = kernel.repo_policy().unwrap();
        assert_eq!(policy["agent_worktree_required"].as_i64(), Some(1));
        assert_eq!(policy["patch_lease_validation_required"].as_i64(), Some(1));
        assert_eq!(policy["merge_gate_required"].as_i64(), Some(1));
        assert_eq!(
            policy["unleased_write_policy"].as_str(),
            Some("reject_patch")
        );
        assert_eq!(policy["cloud_orchestrator_enabled"].as_i64(), Some(0));
        assert_eq!(
            kernel.get_cloud_orchestrator_status().unwrap()["mode"].as_str(),
            Some("disabled")
        );
    }

    #[test]
    fn alignment_report_logs_kernel_policy_state() {
        let repo = temp_repo("alignment");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let report = kernel.get_alignment_report().unwrap();
        assert_eq!(report["ok"].as_bool(), Some(true));
        assert_eq!(
            report["data"]["summary"]["log"]["enabled"].as_bool(),
            Some(alignment::is_enabled())
        );
        assert!(report["data"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check["check"].as_str() == Some("policy.worktree_required")));
        if alignment::is_enabled() {
            let log_path =
                PathBuf::from(report["data"]["summary"]["log"]["path"].as_str().unwrap());
            assert!(log_path.exists());
        }
    }

    #[test]
    fn workspace_mcp_requires_server_workspace_id() {
        let repo = temp_repo("workspace_mcp_required");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        assert!(kernel
            .ensure_workspace_mcp_config(None, Some("Missing"))
            .is_err());

        let status = kernel
            .ensure_workspace_mcp_config(Some("workspace-server-uuid"), Some("Workspace"))
            .unwrap();
        assert_eq!(
            status["objective_key"].as_str(),
            Some("workspace-server-uuid")
        );
        assert_eq!(
            status["workspace_id"].as_str(),
            Some("workspace-server-uuid")
        );
        assert_eq!(status["always_on"].as_bool(), Some(true));
        assert_eq!(status["toggleable"].as_bool(), Some(false));
        assert!(PathBuf::from(status["config_path"].as_str().unwrap()).exists());
    }

    #[test]
    fn codex_mcp_config_prompts_by_default_and_approves_safe_tools() {
        let repo = temp_repo("codex_mcp_tool_approvals");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let status = kernel
            .ensure_workspace_mcp_config(Some("workspace-server-uuid"), Some("Workspace"))
            .unwrap();
        let config = fs::read_to_string(status["codex_config_path"].as_str().unwrap()).unwrap();

        assert!(config.contains("default_tools_approval_mode = \"prompt\""));
        for tool in [
            "get_brief",
            "claim_task",
            "acquire_lease",
            "validate_patch",
            "db_classify_sql",
            "request_approval",
            "orchestrator_get_status",
        ] {
            assert!(config.contains(&format!(
                "[mcp_servers.coordination-kernel.tools.{tool}]\napproval_mode = \"approve\""
            )));
        }
        for prompt_gated_tool in [
            "submit_patch",
            "request_merge",
            "resolve_workspace_violation",
            "db_query_readonly",
            "db_propose_migration",
            "db_validate_shadow",
            "write_memory",
            "orchestrator_create_context_export",
            "orchestrator_sync_once",
        ] {
            assert!(!config.contains(&format!(
                "[mcp_servers.coordination-kernel.tools.{prompt_gated_tool}]"
            )));
        }
    }

    #[test]
    fn duplicate_task_claim_is_rejected() {
        let repo = temp_repo("claim");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let task = kernel
            .create_task("Task", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        assert!(kernel.claim_task(task_id, agent_id, session_id).is_err());
    }

    #[test]
    fn no_git_session_degrades_to_coordination_only() {
        let repo = temp_repo("nogit");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let session = kernel
            .create_session(agent["id"].as_str().unwrap(), None, None, true, None, None)
            .unwrap();
        assert_eq!(
            session["enforcementMode"].as_str(),
            Some("coordination_only")
        );
    }

    #[test]
    fn git_repo_recovery_interrupts_unsafe_coordination_only_sessions() {
        let repo = init_git_repo("unsafe_coordination_only");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap().to_string();
        let session_id = uuid();
        let now = now_rfc3339();

        kernel
            .conn
            .execute(
                "INSERT INTO agent_sessions(
                    id, agent_id, status, write_root, enforcement_mode,
                    last_heartbeat_at, created_at, updated_at
                ) VALUES(?1, ?2, 'active', ?3, 'coordination_only', ?4, ?4, ?4)",
                params![session_id, agent_id, repo.display().to_string(), now],
            )
            .unwrap();
        drop(kernel);

        let recovered = CoordinationKernel::open(&repo, None).unwrap();
        let session = recovered
            .query_one(
                "SELECT status FROM agent_sessions WHERE id=?1",
                &[&session_id],
                "missing session",
            )
            .unwrap();
        assert_eq!(session["status"].as_str(), Some("interrupted"));
    }

    #[test]
    fn interrupt_session_marks_session_and_expires_active_leases() {
        let repo = temp_repo("interrupt_session");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let task = kernel
            .create_task("Task", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        let lease = kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "file:src/a.js",
                "write",
                Some(600),
                None,
            )
            .unwrap();
        let lease_id = lease["data"]["lease_id"].as_str().unwrap().to_string();

        kernel
            .interrupt_session(session_id, "terminal_close")
            .unwrap();
        let session = kernel
            .query_one(
                "SELECT status FROM agent_sessions WHERE id=?1",
                &[&session_id],
                "missing session",
            )
            .unwrap();
        let lease = kernel
            .query_one(
                "SELECT status FROM leases WHERE id=?1",
                &[&lease_id],
                "missing lease",
            )
            .unwrap();
        assert_eq!(session["status"].as_str(), Some("interrupted"));
        assert_eq!(lease["status"].as_str(), Some("expired"));
    }

    #[test]
    fn recovery_interrupts_duplicate_pty_sessions_and_marks_worktrees() {
        let repo = init_git_repo("duplicate_pty_sessions");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let first = kernel
            .create_session(
                agent_id,
                None,
                Some("workspace-terminal-test-0-codex"),
                true,
                None,
                None,
            )
            .unwrap();
        let second = kernel
            .create_session(
                agent_id,
                None,
                Some("workspace-terminal-test-0-codex"),
                true,
                None,
                None,
            )
            .unwrap();
        let first_id = first["id"].as_str().unwrap().to_string();
        let second_id = second["id"].as_str().unwrap().to_string();
        let first_worktree_id = first["worktreeId"].as_str().unwrap().to_string();
        let second_worktree_id = second["worktreeId"].as_str().unwrap().to_string();
        kernel
            .conn
            .execute(
                "UPDATE agent_sessions SET updated_at='1000.000Z' WHERE id=?1",
                params![first_id],
            )
            .unwrap();
        kernel
            .conn
            .execute(
                "UPDATE agent_sessions SET updated_at='2000.000Z' WHERE id=?1",
                params![second_id],
            )
            .unwrap();
        drop(kernel);

        let recovered = CoordinationKernel::open(&repo, None).unwrap();
        let first_session = recovered
            .query_one(
                "SELECT status FROM agent_sessions WHERE id=?1",
                &[&first_id],
                "missing first session",
            )
            .unwrap();
        let second_session = recovered
            .query_one(
                "SELECT status FROM agent_sessions WHERE id=?1",
                &[&second_id],
                "missing second session",
            )
            .unwrap();
        let first_worktree = recovered
            .query_one(
                "SELECT status FROM worktrees WHERE id=?1",
                &[&first_worktree_id],
                "missing first worktree",
            )
            .unwrap();
        let second_worktree = recovered
            .query_one(
                "SELECT status FROM worktrees WHERE id=?1",
                &[&second_worktree_id],
                "missing second worktree",
            )
            .unwrap();
        assert_eq!(first_session["status"].as_str(), Some("interrupted"));
        assert_eq!(second_session["status"].as_str(), Some("active"));
        assert_eq!(first_worktree["status"].as_str(), Some("interrupted"));
        assert_eq!(second_worktree["status"].as_str(), Some("active"));
    }

    #[test]
    fn lease_conflict_and_fence_behavior() {
        let repo = temp_repo("lease");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let task = kernel
            .create_task("Task", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        let lease = kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "file:src/a.js",
                "write",
                Some(100),
                None,
            )
            .unwrap();
        let lease_id = lease["data"]["lease_id"].as_str().unwrap();
        assert!(kernel.renew_lease(lease_id, 999, Some(100)).is_err());
        let conflict = kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "glob:src/**",
                "write",
                Some(100),
                None,
            )
            .unwrap();
        assert_eq!(conflict["ok"].as_bool(), Some(false));
    }

    #[test]
    fn memory_and_cloud_local_run_work() {
        let repo = temp_repo("memory");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let memory = kernel
            .write_memory(
                "decision",
                "Keep local",
                "Local memory body",
                Some("draft"),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert!(PathBuf::from(memory["data"]["body_path"].as_str().unwrap()).exists());
        let run = kernel.create_orchestration_run("Do a thing", None).unwrap();
        let run_id = run["data"]["run_id"].as_str().unwrap();
        let plan = json!({"items": [{"title": "Slice A", "role": "architect"}]});
        kernel.import_orchestration_plan(run_id, &plan).unwrap();
        assert!(kernel
            .query_json("SELECT * FROM tasks", &[])
            .unwrap()
            .is_empty());
        kernel.adopt_orchestration_plan(run_id).unwrap();
        assert_eq!(
            kernel.query_json("SELECT * FROM tasks", &[]).unwrap().len(),
            1
        );
    }

    #[test]
    fn worktree_session_and_patch_without_lease_fails() {
        let repo = init_git_repo("patch_no_lease");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let task = kernel
            .create_task("Task", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, true, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let worktree_id = session["worktreeId"]
            .as_str()
            .unwrap_or_else(|| panic!("missing worktreeId in session: {session}"));
        let write_root = PathBuf::from(session["writeRoot"].as_str().unwrap());
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        fs::write(write_root.join("src.txt"), "changed\n").unwrap();

        let response = kernel
            .submit_patch(
                task_id,
                agent_id,
                session_id,
                Some(worktree_id),
                Some("no lease"),
            )
            .unwrap();
        assert_eq!(response["ok"].as_bool(), Some(false));
        assert_eq!(
            response["error"]["code"].as_str(),
            Some("patch_validation_failed")
        );
    }

    #[test]
    fn worktree_patch_with_active_lease_passes() {
        let repo = init_git_repo("patch_with_lease");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let task = kernel
            .create_task("Task", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, true, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let worktree_id = session["worktreeId"]
            .as_str()
            .unwrap_or_else(|| panic!("missing worktreeId in session: {session}"));
        let write_root = PathBuf::from(session["writeRoot"].as_str().unwrap());
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "file:src.txt",
                "write",
                Some(600),
                None,
            )
            .unwrap();
        fs::write(write_root.join("src.txt"), "changed\n").unwrap();

        let response = kernel
            .submit_patch(
                task_id,
                agent_id,
                session_id,
                Some(worktree_id),
                Some("leased"),
            )
            .unwrap();
        assert_eq!(response["ok"].as_bool(), Some(true));
        assert_eq!(
            response["data"]["validation_status"].as_str(),
            Some("passed")
        );
    }
}
