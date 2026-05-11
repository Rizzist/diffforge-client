use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, types::ValueRef, Connection, ErrorCode, OptionalExtension};
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    alignment,
    db::{
        canonical_repo_path, open_connection, process_path_text, SchemaMigrationDiagnostics,
        StoragePaths, REPO_ID,
    },
    events,
    models::{ApiEnvelope, ApiErrorEnvelope, PatchValidationResult, TerminalCoordinationContext},
    resources::{
        is_write_like, lease_mode_conflict_reason, normalize_resource_key,
        normalize_resource_key_checked, path_to_file_resource, reject_path_escape,
        resource_conflict_reason, resource_covers, resource_risk_level, resource_type,
        validate_lease_mode,
    },
    sql_classifier,
};

const SESSION_STALE_SECONDS: i64 = 1800;
const DEFAULT_LEASE_TTL_SECONDS: i64 = 1800;
const MCP_CLIENT_EVENT_TYPES: &[&str] = &[
    "mcp_agent_server_started",
    "mcp_agent_client_initialized",
    "mcp_agent_tools_listed",
    "mcp_agent_tool_called",
    "mcp_agent_tool_failed",
];
const CODEX_AUTO_APPROVED_COORDINATION_TOOLS: &[&str] = &[
    "get_brief",
    "claim_task",
    "post_plan",
    "acquire_lease",
    "renew_lease",
    "release_lease",
    "list_resources",
    "list_active_leases",
    "list_task_dependencies",
    "announce_change",
    "validate_patch",
    "list_workspace_violations",
    "list_workspace_changes",
    "file_watcher_status",
    "search_memory",
    "get_slot_status",
    "db_get_mode",
    "db_classify_sql",
    "db_request_change",
    "db_list_change_requests",
    "db_get_change_request",
    "db_request_approval",
    "request_approval",
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
        let (conn, existed, storage_diagnostics) = open_connection(&paths)?;
        let kernel = Self { paths, conn };

        kernel.insert_default_repo_policy()?;
        kernel.expire_old_leases()?;
        kernel.mark_stale_sessions_interrupted()?;
        kernel.mark_duplicate_pty_sessions_interrupted()?;
        kernel.mark_unsafe_coordination_only_sessions_interrupted()?;
        kernel.mark_invalid_worktree_sessions_interrupted()?;
        if emit_recovery_event {
            let storage_payload = storage_diagnostics.to_json();
            let lifecycle_event = if existed {
                "kernel.recovered"
            } else {
                "kernel.initialized"
            };
            kernel.emit_event(
                "kernel_storage_opened",
                "kernel",
                REPO_ID,
                EventRefs::default(),
                storage_payload.clone(),
            )?;
            for migration in &storage_diagnostics.migrations {
                kernel.emit_schema_migration_log_event(migration)?;
            }
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
                    "storage": storage_payload,
                }),
            )?;
            kernel.write_alignment_lifecycle_log(
                "kernel_startup",
                lifecycle_event,
                "aligned",
                if existed {
                    "Kernel storage opened and recovery checks completed."
                } else {
                    "Kernel storage created and initialization checks completed."
                },
                storage_diagnostics.to_json(),
            );
        }

        Ok(kernel)
    }

    fn emit_schema_migration_log_event(
        &self,
        migration: &SchemaMigrationDiagnostics,
    ) -> Result<(), String> {
        let event_type = match migration.status.as_str() {
            "applied" => "schema_migration_applied",
            "already_applied" => "schema_migration_checked",
            _ => "schema_migration_ensured",
        };
        self.emit_event(
            event_type,
            "kernel",
            REPO_ID,
            EventRefs::default(),
            migration.to_json(),
        )?;
        Ok(())
    }

    fn write_alignment_lifecycle_log(
        &self,
        context: &str,
        event: &str,
        status: &str,
        reason: &str,
        details: Value,
    ) {
        if let Err(error) = alignment::write_lifecycle(
            &self.paths.repo_path,
            context,
            event,
            status,
            reason,
            details,
        ) {
            let _ = self.emit_event(
                "alignment_log_write_failed",
                "kernel",
                REPO_ID,
                EventRefs::default(),
                json!({
                    "context": context,
                    "event": event,
                    "error": error,
                }),
            );
        }
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
                    merge_requires_human_for_unleased_override, cloud_context_export_policy,
                    cloud_allow_code_export, cloud_allow_terminal_log_export,
                    cloud_allow_patch_export, cloud_auto_create_tasks,
                    cloud_auto_assign_agents, cloud_auto_spawn_terminals,
                    cloud_auto_merge, cloud_contract_memory_enabled, policy_json,
                    created_at, updated_at
                ) VALUES(?1, ?2, 0, NULL, 'off', 0, 1, 1, 1, 1, 1, 1,
                    'detect_and_reject_patch', 'reject_patch', 'coordination_only', 1, 1,
                    'local_only', 0, 0, 0, 0, 0, 0, 0, 1, NULL, ?3, ?3)",
                params![REPO_ID, self.paths.repo_path.display().to_string(), now],
            )
            .map_err(|error| format!("Unable to create default repo policy: {error}"))?;
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
        let agent_slot_id = refs.agent_slot_id.as_deref();
        let session_id = refs.session_id.as_deref();
        let resource_id = refs.resource_id.as_deref();
        let artifact_id = refs.artifact_id.as_deref();
        let context_run_id = refs.context_run_id.as_deref();

        for attempt in 0..12 {
            let id = uuid();
            match self.conn.execute(
                "INSERT INTO events(
                    id, seq, event_type, actor_type, actor_id, task_id, agent_id, agent_slot_id, session_id,
                    resource_id, artifact_id, context_run_id, payload_json, created_at
                ) VALUES(
                    ?1,
                    (SELECT COALESCE(MAX(seq), 0) + 1 FROM events),
                    ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
                )",
                params![
                    id,
                    event_type,
                    actor_type,
                    actor_id,
                    task_id,
                    agent_id,
                    agent_slot_id,
                    session_id,
                    resource_id,
                    artifact_id,
                    context_run_id,
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

    pub fn normalize_slot_key(&self, slot_key: &str) -> Result<String, String> {
        normalize_agent_slot_key(slot_key)
    }

    pub fn get_or_create_agent_slot(
        &self,
        slot_key: &str,
        agent_name: &str,
        agent_kind: &str,
        role: Option<&str>,
    ) -> Result<Value, String> {
        let slot_key = normalize_agent_slot_key(slot_key)?;
        let agent = self.create_or_get_agent(agent_name, agent_kind, role)?;
        self.get_or_create_agent_slot_for_agent(&slot_key, &agent)
    }

    fn get_or_create_agent_slot_for_agent(
        &self,
        slot_key: &str,
        agent: &Value,
    ) -> Result<Value, String> {
        let slot_key = normalize_agent_slot_key(slot_key)?;
        let agent_id = required_string(agent, "id")?;
        let agent_name = required_string(agent, "name")?;
        let agent_kind = required_string(agent, "kind")?;
        let mcp_config_path = self
            .paths
            .mcp_root
            .join("agents")
            .join(format!("{slot_key}.json"));
        let mcp_config_path_text = process_path_text(&mcp_config_path);

        if let Some(slot_id) = self
            .conn
            .query_row(
                "SELECT id FROM agent_slots WHERE slot_key=?1",
                [&slot_key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Unable to inspect agent slot: {error}"))?
        {
            let now = now_rfc3339();
            self.conn
                .execute(
                    "UPDATE agent_slots
                     SET agent_id=?1, agent_name=?2, agent_kind=?3, mcp_config_path=?4,
                         status=CASE WHEN status='disabled' THEN status ELSE 'available' END,
                         updated_at=?5
                     WHERE id=?6",
                    params![
                        agent_id,
                        agent_name,
                        agent_kind,
                        mcp_config_path_text,
                        now,
                        slot_id
                    ],
                )
                .map_err(|error| format!("Unable to refresh agent slot: {error}"))?;
            self.emit_event(
                "agent_slot_reused",
                "agent",
                agent_id,
                EventRefs {
                    agent_id: Some(agent_id.to_string()),
                    agent_slot_id: Some(slot_id.clone()),
                    ..EventRefs::default()
                },
                json!({"slot_key": slot_key}),
            )?;
            return self.get_agent_slot_by_id(&slot_id);
        }

        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO agent_slots(
                    id, slot_key, agent_id, agent_name, agent_kind, status,
                    active_session_id, default_task_id, mcp_config_path, worktree_id,
                    created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, 'available', NULL, NULL, ?6, NULL, ?7, ?7)",
                params![
                    id,
                    slot_key,
                    agent_id,
                    agent_name,
                    agent_kind,
                    mcp_config_path_text,
                    now
                ],
            )
            .map_err(|error| format!("Unable to create agent slot: {error}"))?;
        self.emit_event(
            "agent_slot_created",
            "agent",
            agent_id,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: Some(id.clone()),
                ..EventRefs::default()
            },
            json!({"slot_key": slot_key, "mcp_config_path": mcp_config_path_text}),
        )?;
        self.get_agent_slot_by_id(&id)
    }

    fn get_agent_slot_by_id(&self, slot_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM agent_slots WHERE id=?1",
            &[&slot_id],
            "Agent slot does not exist.",
        )
    }

    fn get_agent_by_id(&self, agent_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM agents WHERE id=?1",
            &[&agent_id],
            "Agent does not exist.",
        )
    }

    pub fn get_slot_status(
        &self,
        agent_slot_id: Option<&str>,
        slot_key: Option<&str>,
    ) -> Result<Value, String> {
        let slot = if let Some(agent_slot_id) =
            agent_slot_id.filter(|value| !value.trim().is_empty())
        {
            self.get_agent_slot_by_id(agent_slot_id)?
        } else if let Some(slot_key) = slot_key.filter(|value| !value.trim().is_empty()) {
            let slot_key = normalize_agent_slot_key(slot_key)?;
            self.query_one(
                "SELECT * FROM agent_slots WHERE slot_key=?1",
                &[&slot_key],
                "Agent slot does not exist.",
            )?
        } else {
            return Ok(api_ok(json!({
                "slots": self.query_json("SELECT * FROM agent_slots ORDER BY slot_key", &[])?,
                "mcp_configs": self.query_json("SELECT * FROM mcp_configs ORDER BY updated_at DESC", &[])?,
            })));
        };
        let slot_id = slot["id"].as_str().unwrap_or_default();
        Ok(api_ok(json!({
            "slot": slot,
            "session": self.query_json(
                "SELECT * FROM agent_sessions WHERE agent_slot_id=?1 ORDER BY updated_at DESC LIMIT 1",
                &[&slot_id],
            )?,
            "worktree": self.query_json(
                "SELECT * FROM worktrees WHERE agent_slot_id=?1 ORDER BY updated_at DESC LIMIT 1",
                &[&slot_id],
            )?,
            "mcp_config": self.query_json(
                "SELECT * FROM mcp_configs WHERE agent_slot_id=?1",
                &[&slot_id],
            )?,
        })))
    }

    pub fn create_task(
        &self,
        title: &str,
        body: Option<&str>,
        priority: i64,
        risk_level: i64,
        context_run_id: Option<&str>,
        source_plan_item_id: Option<&str>,
        assigned_role: Option<&str>,
        expected_output: Option<&str>,
    ) -> Result<Value, String> {
        let title = non_empty(title, "Task title")?;
        let id = uuid();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO tasks(
                    id, title, body, status, priority, risk_level, context_run_id,
                    source_plan_item_id, assigned_role, expected_output, created_at, updated_at
                ) VALUES(?1, ?2, ?3, 'ready', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![
                    id,
                    title,
                    body,
                    priority,
                    risk_level,
                    context_run_id,
                    source_plan_item_id,
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
                context_run_id: context_run_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({"title": title, "priority": priority, "risk_level": risk_level}),
        )?;

        Ok(json!({"id": id, "title": title, "status": "ready"}))
    }

    pub fn add_task_dependency(
        &self,
        task_id: &str,
        depends_on_task_id: &str,
        dependency_kind: Option<&str>,
    ) -> Result<Value, String> {
        let dependency_kind = normalize_task_dependency_kind(dependency_kind);
        self.begin_immediate_transaction("add task dependency")?;
        let result = (|| -> Result<Value, String> {
            self.insert_task_dependency_checked(
                task_id,
                depends_on_task_id,
                &dependency_kind,
                "user",
                "local",
            )
        })();
        match self.finish_transaction(result, "add task dependency") {
            Ok(value) => Ok(value),
            Err(error) => {
                let _ = self.emit_event(
                    "task_dependency_rejected",
                    "user",
                    "local",
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({
                        "depends_on_task_id": depends_on_task_id,
                        "dependency_kind": dependency_kind,
                        "error": error,
                    }),
                );
                Err(error)
            }
        }
    }

    pub fn list_task_dependencies(&self, task_id: Option<&str>) -> Result<Value, String> {
        let dependencies = if let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) {
            self.task_dependency_rows(task_id)?
        } else {
            self.query_json(
                "SELECT d.task_id,
                        dependent.title AS task_title,
                        dependent.status AS task_status,
                        d.depends_on_task_id,
                        prerequisite.title AS depends_on_title,
                        prerequisite.status AS depends_on_status,
                        d.dependency_kind,
                        d.created_at
                 FROM task_dependencies d
                 LEFT JOIN tasks dependent ON dependent.id = d.task_id
                 LEFT JOIN tasks prerequisite ON prerequisite.id = d.depends_on_task_id
                 ORDER BY d.created_at DESC
                 LIMIT 500",
                &[],
            )?
        };
        let blockers = if let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) {
            self.unsatisfied_dependency_details(task_id)?
        } else {
            Vec::new()
        };
        Ok(api_ok(json!({
            "dependencies": dependencies,
            "blocking_dependencies": blockers,
        })))
    }

    fn insert_task_dependency_checked(
        &self,
        task_id: &str,
        depends_on_task_id: &str,
        dependency_kind: &str,
        actor_type: &str,
        actor_id: &str,
    ) -> Result<Value, String> {
        let task = self.query_one(
            "SELECT * FROM tasks WHERE id=?1",
            &[&task_id],
            "Dependent task does not exist.",
        )?;
        let dependency = self.query_one(
            "SELECT * FROM tasks WHERE id=?1",
            &[&depends_on_task_id],
            "Dependency task does not exist.",
        )?;
        if task_id == depends_on_task_id {
            return Err("A task cannot depend on itself.".to_string());
        }
        if self.task_dependency_would_cycle(task_id, depends_on_task_id)? {
            return Err("Task dependency would create a cycle.".to_string());
        }

        let now = now_rfc3339();
        let changed = self
            .conn
            .execute(
                "INSERT OR IGNORE INTO task_dependencies(
                    task_id, depends_on_task_id, dependency_kind, created_at
                 ) VALUES(?1, ?2, ?3, ?4)",
                params![task_id, depends_on_task_id, dependency_kind, now],
            )
            .map_err(|error| format!("Unable to create task dependency: {error}"))?;
        let reused = changed == 0;
        self.emit_event(
            if reused {
                "task_dependency_reused"
            } else {
                "task_dependency_created"
            },
            actor_type,
            actor_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                context_run_id: task["context_run_id"].as_str().map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "task_id": task_id,
                "task_title": task["title"].clone(),
                "depends_on_task_id": depends_on_task_id,
                "depends_on_title": dependency["title"].clone(),
                "dependency_kind": dependency_kind,
                "reused": reused,
            }),
        )?;
        self.refresh_task_dependency_blocked_status(task_id, actor_type, actor_id)?;
        Ok(json!({
            "task_id": task_id,
            "depends_on_task_id": depends_on_task_id,
            "dependency_kind": dependency_kind,
            "reused": reused,
        }))
    }

    pub fn claim_task(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
    ) -> Result<Value, String> {
        let session = self.ensure_session_active(session_id, agent_id)?;
        let agent_slot_id = session["agent_slot_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);

        self.begin_immediate_transaction("claim task")?;
        let result = (|| -> Result<Value, String> {
            let _ = self.query_one(
                "SELECT * FROM tasks WHERE id=?1",
                &[&task_id],
                "Task does not exist.",
            )?;
            let blockers = self.unsatisfied_dependency_details(task_id)?;
            if !blockers.is_empty() {
                self.conn
                    .execute(
                        "UPDATE tasks
                         SET status='blocked', updated_at=?1
                         WHERE id=?2
                           AND (claimed_session_id IS NULL OR claimed_session_id='')
                           AND status NOT IN ('done', 'completed', 'merged')",
                        params![now_rfc3339(), task_id],
                    )
                    .map_err(|error| format!("Unable to mark task blocked: {error}"))?;
                self.emit_event(
                    "task_blocked",
                    "agent",
                    agent_id,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        agent_id: Some(agent_id.to_string()),
                        agent_slot_id: agent_slot_id.clone(),
                        session_id: Some(session_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({
                        "blocking_dependencies": blockers.clone(),
                        "reason": "unsatisfied_dependencies",
                    }),
                )?;
                return Ok(api_error(
                    "task_blocked",
                    format!("Task {task_id} is blocked by unfinished dependencies."),
                    json!({"blocking_dependencies": blockers}),
                ));
            }

            let now = now_rfc3339();
            let changed = self
                .conn
                .execute(
                    "UPDATE tasks
                     SET status='claimed', claimed_by_agent_id=?1, claimed_session_id=?2, updated_at=?3
                     WHERE id=?4
                       AND (claimed_session_id IS NULL OR claimed_session_id='')
                       AND status NOT IN ('done', 'completed', 'merged')",
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
                    agent_slot_id: agent_slot_id.clone(),
                    session_id: Some(session_id.to_string()),
                    ..EventRefs::default()
                },
                json!({"dependency_gate": "satisfied"}),
            )?;

            Ok(
                json!({"task_id": task_id, "agent_id": agent_id, "session_id": session_id, "status": "claimed"}),
            )
        })();

        self.finish_transaction(result, "claim task")
    }

    fn task_dependency_rows(&self, task_id: &str) -> Result<Vec<Value>, String> {
        let mut rows = self.query_json(
            "SELECT d.task_id,
                    dependent.title AS task_title,
                    dependent.status AS task_status,
                    d.depends_on_task_id,
                    prerequisite.title AS depends_on_title,
                    prerequisite.status AS depends_on_status,
                    d.dependency_kind,
                    d.created_at
             FROM task_dependencies d
             LEFT JOIN tasks dependent ON dependent.id = d.task_id
             LEFT JOIN tasks prerequisite ON prerequisite.id = d.depends_on_task_id
             WHERE d.task_id=?1
             ORDER BY d.created_at ASC",
            &[&task_id],
        )?;
        for row in &mut rows {
            let status = row["depends_on_status"].as_str().unwrap_or("").to_string();
            let dependency_exists = !status.is_empty();
            let satisfied = dependency_exists && task_dependency_satisfied_status(&status);
            if let Some(object) = row.as_object_mut() {
                object.insert(
                    "dependency_exists".to_string(),
                    Value::Bool(dependency_exists),
                );
                object.insert("satisfied".to_string(), Value::Bool(satisfied));
            }
        }
        Ok(rows)
    }

    fn unsatisfied_dependency_details(&self, task_id: &str) -> Result<Vec<Value>, String> {
        Ok(self
            .task_dependency_rows(task_id)?
            .into_iter()
            .filter(|dependency| dependency["satisfied"].as_bool() != Some(true))
            .collect())
    }

    fn task_dependency_would_cycle(
        &self,
        task_id: &str,
        depends_on_task_id: &str,
    ) -> Result<bool, String> {
        if task_id == depends_on_task_id {
            return Ok(true);
        }
        let cycle_count: i64 = self
            .conn
            .query_row(
                "WITH RECURSIVE dependency_tree(id) AS (
                    SELECT depends_on_task_id
                    FROM task_dependencies
                    WHERE task_id=?1
                    UNION
                    SELECT d.depends_on_task_id
                    FROM task_dependencies d
                    JOIN dependency_tree tree ON d.task_id = tree.id
                 )
                 SELECT COUNT(1) FROM dependency_tree WHERE id=?2",
                params![depends_on_task_id, task_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Unable to inspect task dependency graph: {error}"))?;
        Ok(cycle_count > 0)
    }

    fn refresh_task_dependency_blocked_status(
        &self,
        task_id: &str,
        actor_type: &str,
        actor_id: &str,
    ) -> Result<(), String> {
        let task = self.query_one(
            "SELECT * FROM tasks WHERE id=?1",
            &[&task_id],
            "Task does not exist.",
        )?;
        let blockers = self.unsatisfied_dependency_details(task_id)?;
        let now = now_rfc3339();
        if blockers.is_empty() {
            let changed = self
                .conn
                .execute(
                    "UPDATE tasks
                     SET status='ready', updated_at=?1
                     WHERE id=?2
                       AND status='blocked'
                       AND (claimed_session_id IS NULL OR claimed_session_id='')",
                    params![now, task_id],
                )
                .map_err(|error| format!("Unable to mark task unblocked: {error}"))?;
            if changed > 0 {
                self.emit_event(
                    "task_unblocked",
                    actor_type,
                    actor_id,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        context_run_id: task["context_run_id"]
                            .as_str()
                            .map(str::to_string),
                        ..EventRefs::default()
                    },
                    json!({"reason": "dependencies_satisfied"}),
                )?;
            }
        } else {
            let changed = self
                .conn
                .execute(
                    "UPDATE tasks
                     SET status='blocked', updated_at=?1
                     WHERE id=?2
                       AND (claimed_session_id IS NULL OR claimed_session_id='')
                       AND status IN ('ready', 'created')",
                    params![now, task_id],
                )
                .map_err(|error| format!("Unable to mark task blocked: {error}"))?;
            if changed > 0 {
                self.emit_event(
                    "task_blocked",
                    actor_type,
                    actor_id,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        context_run_id: task["context_run_id"]
                            .as_str()
                            .map(str::to_string),
                        ..EventRefs::default()
                    },
                    json!({
                        "reason": "dependency_added",
                        "blocking_dependencies": blockers,
                    }),
                )?;
            }
        }
        Ok(())
    }

    fn refresh_dependent_tasks(&self, depends_on_task_id: &str) -> Result<(), String> {
        let dependents = self.query_json(
            "SELECT task_id, dependency_kind
             FROM task_dependencies
             WHERE depends_on_task_id=?1
             ORDER BY created_at ASC",
            &[&depends_on_task_id],
        )?;
        for dependent in dependents {
            let Some(task_id) = dependent["task_id"].as_str() else {
                continue;
            };
            self.emit_event(
                "task_dependency_satisfied",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    ..EventRefs::default()
                },
                json!({
                    "depends_on_task_id": depends_on_task_id,
                    "dependency_kind": dependent["dependency_kind"].clone(),
                }),
            )?;
            self.refresh_task_dependency_blocked_status(task_id, "kernel", REPO_ID)?;
        }
        Ok(())
    }

    pub fn post_plan(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        plan: &str,
    ) -> Result<Value, String> {
        let session = self.ensure_session_active(session_id, agent_id)?;
        let agent_slot_id = session["agent_slot_id"].as_str();
        self.ensure_session_authorized_for_task(session_id, task_id)?;
        self.emit_event(
            "plan_posted",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: agent_slot_id.map(str::to_string),
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
        context_run_id: Option<&str>,
        context_role: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_agent_exists(agent_id)?;
        let agent = self.get_agent_by_id(agent_id)?;
        let slot_key = derive_slot_key(agent["kind"].as_str().unwrap_or("agent"), pty_id, None)?;
        let slot = self.get_or_create_agent_slot_for_agent(&slot_key, &agent)?;
        self.create_session_for_slot(
            &slot,
            task_id,
            pty_id,
            write_enabled,
            context_run_id,
            context_role,
        )
    }

    pub fn create_session_for_slot_key(
        &self,
        slot_key: &str,
        agent_name: &str,
        agent_kind: &str,
        role: Option<&str>,
        task_id: Option<&str>,
        pty_id: Option<&str>,
        write_enabled: bool,
        context_run_id: Option<&str>,
        context_role: Option<&str>,
    ) -> Result<Value, String> {
        let slot = self.get_or_create_agent_slot(slot_key, agent_name, agent_kind, role)?;
        self.create_session_for_slot(
            &slot,
            task_id,
            pty_id,
            write_enabled,
            context_run_id,
            context_role,
        )
    }

    fn create_session_for_slot(
        &self,
        slot: &Value,
        task_id: Option<&str>,
        pty_id: Option<&str>,
        write_enabled: bool,
        context_run_id: Option<&str>,
        context_role: Option<&str>,
    ) -> Result<Value, String> {
        let agent_id = required_string(slot, "agent_id")?;
        let agent_slot_id = required_string(slot, "id")?;
        let slot_key = required_string(slot, "slot_key")?;
        self.ensure_agent_exists(agent_id)?;

        if let Some(active_session_id) = slot["active_session_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            if let Ok(existing) = self.query_one(
                "SELECT * FROM agent_sessions WHERE id=?1",
                &[&active_session_id],
                "Session does not exist.",
            ) {
                if existing["status"].as_str() == Some("active") && session_is_fresh(&existing) {
                    let existing_pty = existing["pty_id"].as_str().unwrap_or("");
                    let requested_pty = pty_id.unwrap_or("");
                    if !requested_pty.is_empty() && existing_pty == requested_pty {
                        self.heartbeat_session(active_session_id)?;
                        if let Some(task_id) = task_id {
                            self.conn
                                .execute(
                                    "UPDATE agent_sessions SET task_id=?1, updated_at=?2 WHERE id=?3",
                                    params![task_id, now_rfc3339(), active_session_id],
                                )
                                .map_err(|error| {
                                    format!("Unable to refresh active slot session: {error}")
                                })?;
                        }
                        self.emit_event(
                            "agent_session_reused",
                            "agent",
                            agent_id,
                            EventRefs {
                                agent_id: Some(agent_id.to_string()),
                                agent_slot_id: Some(agent_slot_id.to_string()),
                                session_id: Some(active_session_id.to_string()),
                                task_id: task_id
                                    .or_else(|| existing["task_id"].as_str())
                                    .map(str::to_string),
                                context_run_id: context_run_id
                                    .or_else(|| existing["context_run_id"].as_str())
                                    .map(str::to_string),
                                ..EventRefs::default()
                            },
                            json!({
                                "slot_key": slot_key,
                                "pty_id": requested_pty,
                                "reason": "same_fresh_pty_reused",
                            }),
                        )?;
                        let existing = self.query_one(
                            "SELECT * FROM agent_sessions WHERE id=?1",
                            &[&active_session_id],
                            "Session does not exist after reuse.",
                        )?;
                        let worktree_path = existing["worktree_id"]
                            .as_str()
                            .and_then(|_| existing["write_root"].as_str());
                        let mcp_config = self.write_or_update_slot_mcp_config(
                            agent_slot_id,
                            active_session_id,
                            task_id.or_else(|| existing["task_id"].as_str()),
                            existing["worktree_id"].as_str(),
                            worktree_path,
                            context_run_id
                                .or_else(|| existing["context_run_id"].as_str()),
                            context_role.or_else(|| existing["context_role"].as_str()),
                        )?;
                        return Ok(self.session_response(&existing, slot, &mcp_config, Vec::new()));
                    }
                    self.emit_event(
                        "agent_slot_busy",
                        "kernel",
                        REPO_ID,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            agent_slot_id: Some(agent_slot_id.to_string()),
                            session_id: Some(active_session_id.to_string()),
                            task_id: existing["task_id"].as_str().map(str::to_string),
                            context_run_id: existing["context_run_id"]
                                .as_str()
                                .map(str::to_string),
                            ..EventRefs::default()
                        },
                        json!({
                            "slot_key": slot_key,
                            "active_session_id": active_session_id,
                            "existing_pty_id": existing_pty,
                            "requested_pty_id": requested_pty,
                            "reason": "fresh_active_session_for_different_pty",
                        }),
                    )?;
                    return Err(format!(
                        "slot_busy: agent slot {slot_key} already has active session {active_session_id}."
                    ));
                }

                if existing["status"].as_str() == Some("active") {
                    let _ = self.interrupt_session(active_session_id, "stale_slot_session")?;
                }
            }
        }

        let active_sessions = self.query_json(
            "SELECT * FROM agent_sessions
             WHERE agent_slot_id=?1 AND status='active'
             ORDER BY updated_at DESC, created_at DESC",
            &[&agent_slot_id],
        )?;
        for existing in active_sessions {
            let Some(existing_session_id) = existing["id"].as_str() else {
                continue;
            };
            if !session_is_fresh(&existing) {
                let _ =
                    self.interrupt_session(existing_session_id, "stale_slot_session_recovered")?;
                continue;
            }

            let existing_pty = existing["pty_id"].as_str().unwrap_or("");
            let requested_pty = pty_id.unwrap_or("");
            if !requested_pty.is_empty() && existing_pty == requested_pty {
                self.conn
                    .execute(
                        "UPDATE agent_slots
                         SET active_session_id=?1, status='active', updated_at=?2
                         WHERE id=?3",
                        params![existing_session_id, now_rfc3339(), agent_slot_id],
                    )
                    .map_err(|error| format!("Unable to repair active slot pointer: {error}"))?;
                self.heartbeat_session(existing_session_id)?;
                let mcp_config = self.write_or_update_slot_mcp_config(
                    agent_slot_id,
                    existing_session_id,
                    task_id.or_else(|| existing["task_id"].as_str()),
                    existing["worktree_id"].as_str(),
                    existing["worktree_id"]
                        .as_str()
                        .and_then(|_| existing["write_root"].as_str()),
                    context_run_id.or_else(|| existing["context_run_id"].as_str()),
                    context_role.or_else(|| existing["context_role"].as_str()),
                )?;
                self.emit_event(
                    "agent_session_reused",
                    "agent",
                    agent_id,
                    EventRefs {
                        agent_id: Some(agent_id.to_string()),
                        agent_slot_id: Some(agent_slot_id.to_string()),
                        session_id: Some(existing_session_id.to_string()),
                        task_id: task_id
                            .or_else(|| existing["task_id"].as_str())
                            .map(str::to_string),
                        context_run_id: context_run_id
                            .or_else(|| existing["context_run_id"].as_str())
                            .map(str::to_string),
                        ..EventRefs::default()
                    },
                    json!({
                        "slot_key": slot_key,
                        "pty_id": requested_pty,
                        "reason": "repaired_missing_slot_active_session_pointer",
                    }),
                )?;
                let repaired_slot = self.get_agent_slot_by_id(agent_slot_id)?;
                let repaired_session = self.query_one(
                    "SELECT * FROM agent_sessions WHERE id=?1",
                    &[&existing_session_id],
                    "Session does not exist after slot pointer repair.",
                )?;
                return Ok(self.session_response(
                    &repaired_session,
                    &repaired_slot,
                    &mcp_config,
                    Vec::new(),
                ));
            }

            self.conn
                .execute(
                    "UPDATE agent_slots
                     SET active_session_id=?1, status='active', updated_at=?2
                     WHERE id=?3",
                    params![existing_session_id, now_rfc3339(), agent_slot_id],
                )
                .map_err(|error| format!("Unable to repair busy slot pointer: {error}"))?;
            self.emit_event(
                "agent_slot_busy",
                "kernel",
                REPO_ID,
                EventRefs {
                    agent_id: Some(agent_id.to_string()),
                    agent_slot_id: Some(agent_slot_id.to_string()),
                    session_id: Some(existing_session_id.to_string()),
                    task_id: existing["task_id"].as_str().map(str::to_string),
                    context_run_id: existing["context_run_id"]
                        .as_str()
                        .map(str::to_string),
                    ..EventRefs::default()
                },
                json!({
                    "slot_key": slot_key,
                    "active_session_id": existing_session_id,
                    "existing_pty_id": existing_pty,
                    "requested_pty_id": requested_pty,
                    "reason": "fresh_active_session_found_without_slot_pointer",
                }),
            )?;
            return Err(format!(
                "slot_busy: agent slot {slot_key} already has active session {existing_session_id}."
            ));
        }

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

        if write_enabled {
            match self.create_or_reuse_worktree_for_slot(agent_slot_id) {
                Ok(worktree) => {
                    worktree_id = Some(worktree["id"].as_str().unwrap_or_default().to_string());
                    write_root = worktree["path"].as_str().unwrap_or_default().to_string();
                    base_git_sha = worktree["baseSha"].as_str().map(str::to_string);
                    self.emit_event(
                        "session_write_root_assigned",
                        "agent",
                        agent_id,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            agent_slot_id: Some(agent_slot_id.to_string()),
                            session_id: Some(id.clone()),
                            task_id: task_id.map(str::to_string),
                            context_run_id: context_run_id.map(str::to_string),
                            ..EventRefs::default()
                        },
                        json!({"slot_key": slot_key, "worktree_id": worktree_id, "write_root": write_root, "enforcement_mode": enforcement_mode}),
                    )?;
                }
                Err(error) => {
                    enforcement_mode = "coordination_only".to_string();
                    warnings.push(error.clone());
                    warnings.push("Safe git worktree isolation is unavailable; submit_patch and merge are blocked by default.".to_string());
                    self.emit_event(
                        "workspace_violation_created",
                        "kernel",
                        REPO_ID,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            agent_slot_id: Some(agent_slot_id.to_string()),
                            session_id: Some(id.clone()),
                            task_id: task_id.map(str::to_string),
                            context_run_id: context_run_id.map(str::to_string),
                            ..EventRefs::default()
                        },
                        json!({"violation_kind": "unknown_worktree_write", "severity": "warning", "error": error}),
                    )?;
                }
            }
        }

        self.conn
            .execute(
                "INSERT INTO agent_sessions(
                    id, agent_id, agent_slot_id, task_id, context_run_id,
                    context_role, pty_id, worktree_id, base_git_sha, current_git_sha,
                    status, write_root, enforcement_mode, last_heartbeat_at, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 'active', ?10, ?11, ?12, ?12, ?12)",
                params![
                    id,
                    agent_id,
                    agent_slot_id,
                    task_id,
                    context_run_id,
                    context_role,
                    pty_id,
                    worktree_id,
                    base_git_sha,
                    write_root,
                    enforcement_mode,
                    now
                ],
            )
            .map_err(|error| format!("Unable to create agent session: {error}"))?;
        self.conn
            .execute(
                "UPDATE agent_slots
                 SET active_session_id=?1, worktree_id=COALESCE(?2, worktree_id), status='active', updated_at=?3
                 WHERE id=?4",
                params![id, worktree_id, now_rfc3339(), agent_slot_id],
            )
            .map_err(|error| format!("Unable to attach session to agent slot: {error}"))?;

        let mcp_config = self.write_or_update_slot_mcp_config(
            agent_slot_id,
            &id,
            task_id,
            worktree_id.as_deref(),
            if worktree_id.is_some() {
                Some(write_root.as_str())
            } else {
                None
            },
            context_run_id,
            context_role,
        )?;

        self.emit_event(
            "agent_started",
            "agent",
            agent_id,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: Some(agent_slot_id.to_string()),
                session_id: Some(id.clone()),
                task_id: task_id.map(str::to_string),
                context_run_id: context_run_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "slot_key": slot_key,
                "agent_slot_id": agent_slot_id,
                "pty_id": pty_id,
                "write_enabled": write_enabled,
                "worktree_id": worktree_id,
                "write_root": write_root,
                "enforcement_mode": enforcement_mode,
            }),
        )?;

        let session = self.query_one(
            "SELECT * FROM agent_sessions WHERE id=?1",
            &[&id],
            "Session does not exist after creation.",
        )?;
        Ok(self.session_response(&session, slot, &mcp_config, warnings))
    }

    pub fn prepare_terminal_context(
        &self,
        agent_name: &str,
        agent_kind: &str,
        pty_id: Option<&str>,
        workspace_id: Option<&str>,
        workspace_name: Option<&str>,
        task_id: Option<&str>,
        context_run_id: Option<&str>,
        context_role: Option<&str>,
    ) -> Result<TerminalCoordinationContext, String> {
        let objective_key = require_workspace_objective_key(workspace_id)?;
        let _workspace_mcp = self.ensure_workspace_mcp_config(workspace_id, workspace_name)?;
        let agent = self.create_or_get_agent(agent_name, agent_kind, context_role)?;
        let agent_id = agent["id"]
            .as_str()
            .ok_or_else(|| "Unable to read created agent id.".to_string())?
            .to_string();
        let session = self.create_session(
            &agent_id,
            task_id,
            pty_id,
            true,
            context_run_id,
            context_role,
        )?;
        let session_id = session["id"]
            .as_str()
            .ok_or_else(|| "Unable to read created session id.".to_string())?
            .to_string();
        let agent_slot_id = session["agentSlotId"].as_str().map(str::to_string);
        let slot_key = session["slotKey"].as_str().map(str::to_string);
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
        let warnings = session["warnings"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mcp_config_path = session["mcpConfigPath"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let codex_mcp_config_path = session["codexMcpConfigPath"]
            .as_str()
            .unwrap_or(mcp_config_path.as_str())
            .to_string();
        let claude_mcp_config_path = session["claudeMcpConfigPath"]
            .as_str()
            .unwrap_or(mcp_config_path.as_str())
            .to_string();

        Ok(TerminalCoordinationContext {
            agent_id,
            agent_slot_id,
            slot_key,
            session_id,
            task_id: task_id.map(str::to_string),
            worktree_id,
            worktree_path,
            write_root,
            enforcement_mode,
            db_path: self.paths.db_path.display().to_string(),
            repo_path: self.paths.repo_path.display().to_string(),
            mcp_config_path,
            codex_mcp_config_path,
            claude_mcp_config_path,
            mcp_command: "coordination_mcp".to_string(),
            workspace_id: workspace_id.map(str::to_string),
            objective_key,
            context_run_id: context_run_id.map(str::to_string),
            context_role: context_role.map(str::to_string),
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
            "SELECT id, task_id, agent_id, agent_slot_id, session_id, resource_id FROM leases WHERE session_id=?1 AND status='active'",
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
        self.conn
            .execute(
                "UPDATE agent_slots
                 SET active_session_id=NULL, status='available', updated_at=?1
                 WHERE active_session_id=?2",
                params![now, session_id],
            )
            .map_err(|error| format!("Unable to release interrupted session slot: {error}"))?;

        for lease in &active_leases {
            self.emit_event(
                "lease_expired",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: lease["task_id"].as_str().map(str::to_string),
                    agent_id: lease["agent_id"].as_str().map(str::to_string),
                    agent_slot_id: lease["agent_slot_id"].as_str().map(str::to_string),
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
                agent_slot_id: session["agent_slot_id"].as_str().map(str::to_string),
                task_id: session["task_id"].as_str().map(str::to_string),
                context_run_id: session["context_run_id"].as_str().map(str::to_string),
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
        let (cloud_command, cloud_args) =
            self.cloud_mcp_command_spec(workspace_id, workspace_name, None, None);

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
                },
                "cloud-diffforge": {
                    "command": cloud_command.clone(),
                    "args": cloud_args.clone(),
                    "env": {
                        "CLOUD_MCP_BASE_URL": cloud_mcp_base_url_for_config(),
                        "CLOUD_MCP_REPO_PATH": process_path_text(&self.paths.repo_path),
                        "CLOUD_MCP_REPO_ID": cloud_mcp_repo_id_for_path(&self.paths.repo_path),
                        "CLOUD_MCP_WORKSPACE_ID": workspace_id,
                        "CLOUD_MCP_WORKSPACE_NAME": workspace_name,
                        "CLOUD_MCP_CLIENT_ID": "rust-diffforge-agent"
                    },
                    "diffforge": {
                        "scope": "workspace",
                        "workspaceId": workspace_id,
                        "workspaceName": workspace_name,
                        "alwaysOn": true,
                        "toggleable": false,
                        "authority": "cloud_context_pack"
                    }
                }
            }
        });
        let generic_path = self.paths.mcp_root.join("coordination.json");
        let codex_path = self.paths.mcp_root.join("coordination.codex.toml");
        let claude_path = self.paths.mcp_root.join("coordination.claude.json");
        write_json_file_atomic(&generic_path, &generic_config)?;
        write_text_file_atomic(
            &codex_path,
            &codex_config_toml(&command, &args, Some((&cloud_command, &cloud_args))),
        )?;
        write_json_file_atomic(&claude_path, &generic_config)?;
        self.write_agent_contract_files(&self.paths.repo_path)?;
        let (repo_mcp_path, repo_codex_path) = self.write_repo_root_mcp_activation_files(
            &generic_config,
            &command,
            &args,
            &cloud_command,
            &cloud_args,
        )?;

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
            "repo_mcp_path": process_path_text(&repo_mcp_path),
            "repo_codex_config_path": process_path_text(&repo_codex_path),
        }))
    }

    pub fn get_workspace_mcp_status(
        &self,
        workspace_id: Option<&str>,
        workspace_name: Option<&str>,
    ) -> Result<Value, String> {
        let mut status = self.ensure_workspace_mcp_config(workspace_id, workspace_name)?;
        let health = self.workspace_mcp_health(&status);
        self.emit_event(
            "mcp_health_checked",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
                "health": health,
            }),
        )?;
        if let Some(object) = status.as_object_mut() {
            object.insert("health".to_string(), health);
        }
        Ok(status)
    }

    fn workspace_mcp_health(&self, status: &Value) -> Value {
        let command = status["command"].as_str().unwrap_or_default();
        let args = status["args"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let config_path = status["config_path"].as_str().unwrap_or_default();
        let codex_config_path = status["codex_config_path"].as_str().unwrap_or_default();
        let claude_config_path = status["claude_config_path"].as_str().unwrap_or_default();
        let config_files_exist = Path::new(config_path).exists()
            && Path::new(codex_config_path).exists()
            && Path::new(claude_config_path).exists();
        let command_exists = mcp_command_can_be_spawned(command);
        let probe = probe_mcp_stdio(command, &args);
        let responded = probe["responded"].as_bool() == Some(true);
        let tool_count = probe["tool_count"].as_u64().unwrap_or(0);
        let healthy = config_files_exist && command_exists && responded && tool_count > 0;
        let client_mount = self.mcp_client_mount_summary().unwrap_or_else(|error| {
            json!({
                "status": "error",
                "error": error,
                "active_session_count": 0,
                "confirmed_session_count": 0,
                "mounts": [],
                "events": [],
            })
        });

        json!({
            "status": if healthy { "healthy" } else { "warning" },
            "config_generated": config_files_exist,
            "configured_always_on": status["always_on"].as_bool() == Some(true),
            "toggleable": status["toggleable"].clone(),
            "authority": "local_coordination_kernel",
            "command": command,
            "command_exists_or_path_resolvable": command_exists,
            "spawn_probe": probe,
            "agent_client_mount": client_mount["status"].clone(),
            "agent_client_mount_summary": client_mount,
        })
    }

    pub fn mcp_client_mount_summary(&self) -> Result<Value, String> {
        let sessions = self.query_json(
            "SELECT s.*, a.name AS agent_name, sl.slot_key
             FROM agent_sessions s
             LEFT JOIN agents a ON a.id = s.agent_id
             LEFT JOIN agent_slots sl ON sl.id = s.agent_slot_id
             WHERE s.status='active'
             ORDER BY s.updated_at DESC LIMIT 200",
            &[],
        )?;
        let events = self.mcp_client_events(500)?;
        let mut mounts = Vec::new();
        let mut confirmed = 0usize;
        let mut initialized = 0usize;
        let mut partial = 0usize;

        for session in &sessions {
            let session_id = session["id"].as_str().unwrap_or_default();
            let matching = events
                .iter()
                .filter(|event| event["session_id"].as_str() == Some(session_id))
                .collect::<Vec<_>>();
            let latest = matching.first().copied();
            let tools_listed = matching.iter().any(|event| {
                event["event_type"].as_str() == Some("mcp_agent_tools_listed")
                    && event["payload_json"]["details"]["tool_count"]
                        .as_u64()
                        .unwrap_or(0)
                        > 0
            });
            let successful_tool_calls = matching
                .iter()
                .filter(|event| event["event_type"].as_str() == Some("mcp_agent_tool_called"))
                .count();
            let failed_tool_calls = matching
                .iter()
                .filter(|event| event["event_type"].as_str() == Some("mcp_agent_tool_failed"))
                .count();
            let initialized_seen = matching
                .iter()
                .any(|event| event["event_type"].as_str() == Some("mcp_agent_client_initialized"));
            let server_started = matching
                .iter()
                .any(|event| event["event_type"].as_str() == Some("mcp_agent_server_started"));
            let status = if tools_listed || successful_tool_calls > 0 {
                confirmed += 1;
                "confirmed"
            } else if initialized_seen {
                initialized += 1;
                "initialized"
            } else if server_started {
                partial += 1;
                "server_started"
            } else {
                "not_seen"
            };
            mounts.push(json!({
                "session_id": session_id,
                "agent_id": session["agent_id"].clone(),
                "agent_name": session["agent_name"].clone(),
                "agent_slot_id": session["agent_slot_id"].clone(),
                "slot_key": session["slot_key"].clone(),
                "worktree_id": session["worktree_id"].clone(),
                "write_root": session["write_root"].clone(),
                "status": status,
                "latest_event_type": latest.and_then(|event| event["event_type"].as_str()).unwrap_or("none"),
                "latest_event_at": latest.and_then(|event| event["created_at"].as_str()).unwrap_or("none"),
                "tools_listed": tools_listed,
                "successful_tool_calls": successful_tool_calls,
                "failed_tool_calls": failed_tool_calls,
                "event_count": matching.len(),
            }));
        }

        let active_count = sessions.len();
        let status = if active_count == 0 {
            "idle"
        } else if confirmed == active_count {
            "confirmed"
        } else if confirmed > 0 {
            "partial"
        } else if initialized > 0 {
            "initialized_only"
        } else if partial > 0 {
            "server_started_only"
        } else {
            "not_seen"
        };

        Ok(json!({
            "status": status,
            "active_session_count": active_count,
            "confirmed_session_count": confirmed,
            "initialized_session_count": initialized,
            "server_started_only_count": partial,
            "event_count": events.len(),
            "mounts": mounts,
            "events": events,
        }))
    }

    fn mcp_client_events(&self, limit: i64) -> Result<Vec<Value>, String> {
        let limit = limit.clamp(1, 1000);
        let event_types = MCP_CLIENT_EVENT_TYPES
            .iter()
            .map(|event_type| format!("'{event_type}'"))
            .collect::<Vec<_>>()
            .join(", ");
        self.query_json(
            &format!(
                "SELECT * FROM events WHERE event_type IN ({event_types}) ORDER BY seq DESC LIMIT {limit}"
            ),
            &[],
        )
    }

    fn write_or_update_slot_mcp_config(
        &self,
        agent_slot_id: &str,
        session_id: &str,
        task_id: Option<&str>,
        worktree_id: Option<&str>,
        worktree_path: Option<&str>,
        context_run_id: Option<&str>,
        context_role: Option<&str>,
    ) -> Result<SessionMcpConfigPaths, String> {
        let slot = self.get_agent_slot_by_id(agent_slot_id)?;
        let agent_id = required_string(&slot, "agent_id")?;
        let slot_key = required_string(&slot, "slot_key")?;
        let (command, mut args) = self.coordination_mcp_command_spec();
        args.extend([
            "--repo-path".to_string(),
            process_path_text(&self.paths.repo_path),
            "--db-path".to_string(),
            process_path_text(&self.paths.db_path),
            "--agent-id".to_string(),
            agent_id.to_string(),
            "--agent-slot-id".to_string(),
            agent_slot_id.to_string(),
            "--slot-key".to_string(),
            slot_key.to_string(),
            "--session-id".to_string(),
            session_id.to_string(),
        ]);
        if let Some(value) = task_id {
            args.extend(["--task-id".to_string(), value.to_string()]);
        }
        if let Some(value) = worktree_id {
            args.extend(["--worktree-id".to_string(), value.to_string()]);
        }
        if let Some(value) = worktree_path {
            args.extend(["--worktree-path".to_string(), value.to_string()]);
        }
        let (cloud_command, cloud_args) =
            self.cloud_mcp_command_spec(None, None, Some(agent_id), Some(session_id));

        let generic_config = json!({
            "mcpServers": {
                "coordination-kernel": {
                    "command": command.clone(),
                    "args": args.clone(),
                    "env": {
                        "COORDINATION_ENABLED": "1",
                        "COORDINATION_AGENT_ID": agent_id,
                        "COORDINATION_AGENT_SLOT_ID": agent_slot_id,
                        "COORDINATION_SLOT_KEY": slot_key,
                        "COORDINATION_SESSION_ID": session_id,
                        "COORDINATION_MCP_ALWAYS_ON": "1"
                    },
                    "diffforge": {
                        "scope": "workspace",
                        "slotKey": slot_key,
                        "agentSlotId": agent_slot_id,
                        "alwaysOn": true,
                        "toggleable": false,
                        "authority": "local_coordination_kernel"
                    }
                },
                "cloud-diffforge": {
                    "command": cloud_command.clone(),
                    "args": cloud_args.clone(),
                    "env": {
                        "CLOUD_MCP_BASE_URL": cloud_mcp_base_url_for_config(),
                        "CLOUD_MCP_REPO_PATH": process_path_text(&self.paths.repo_path),
                        "CLOUD_MCP_REPO_ID": cloud_mcp_repo_id_for_path(&self.paths.repo_path),
                        "CLOUD_MCP_AGENT_ID": agent_id,
                        "CLOUD_MCP_SESSION_ID": session_id,
                        "CLOUD_MCP_CLIENT_ID": "rust-diffforge-agent"
                    },
                    "diffforge": {
                        "scope": "agent",
                        "slotKey": slot_key,
                        "agentSlotId": agent_slot_id,
                        "sessionId": session_id,
                        "alwaysOn": true,
                        "toggleable": false,
                        "authority": "cloud_context_pack"
                    }
                }
            }
        });
        let claude_config = generic_config.clone();
        let generic_path = self
            .paths
            .mcp_root
            .join("agents")
            .join(format!("{slot_key}.json"));
        let codex_path = self
            .paths
            .mcp_root
            .join("agents")
            .join(format!("{slot_key}.codex.toml"));
        let claude_path = self
            .paths
            .mcp_root
            .join("agents")
            .join(format!("{slot_key}.claude.json"));
        write_json_file_atomic(&generic_path, &generic_config)?;
        write_text_file_atomic(
            &codex_path,
            &codex_config_toml(&command, &args, Some((&cloud_command, &cloud_args))),
        )?;
        write_json_file_atomic(&claude_path, &claude_config)?;
        self.write_repo_root_dynamic_mcp_activation_files()?;
        if let (Some(_worktree_id), Some(worktree_path)) = (worktree_id, worktree_path) {
            if !path_text_under_path(worktree_path, &self.paths.worktrees_root) {
                return Err(format!(
                    "Refusing to write MCP activation files outside .agents/worktrees: {worktree_path}"
                ));
            }
            self.write_worktree_mcp_activation_files(
                worktree_path,
                &generic_config,
                &command,
                &args,
                &cloud_command,
                &cloud_args,
            )?;
        }
        let config_bytes = serde_json::to_vec(&generic_config)
            .map_err(|error| format!("Unable to serialize MCP config for hashing: {error}"))?;
        let config_hash = sha256_hex(&config_bytes);
        let config_id = self
            .conn
            .query_row(
                "SELECT id FROM mcp_configs WHERE agent_slot_id=?1",
                [agent_slot_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Unable to inspect MCP config record: {error}"))?
            .unwrap_or_else(uuid);
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO mcp_configs(
                    id, agent_slot_id, path, config_hash, last_written_session_id,
                    status, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)
                ON CONFLICT(agent_slot_id) DO UPDATE SET
                    path=excluded.path,
                    config_hash=excluded.config_hash,
                    last_written_session_id=excluded.last_written_session_id,
                    status='active',
                    updated_at=excluded.updated_at",
                params![
                    config_id,
                    agent_slot_id,
                    process_path_text(&generic_path),
                    config_hash,
                    session_id,
                    now
                ],
            )
            .map_err(|error| format!("Unable to record MCP config: {error}"))?;
        self.emit_event(
            "mcp_config_written",
            "kernel",
            REPO_ID,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: Some(agent_slot_id.to_string()),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({"slot_key": slot_key, "path": process_path_text(&generic_path)}),
        )?;
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

    fn cloud_mcp_command_spec(
        &self,
        workspace_id: Option<&str>,
        workspace_name: Option<&str>,
        agent_id: Option<&str>,
        session_id: Option<&str>,
    ) -> (String, Vec<String>) {
        let command = std::env::current_exe()
            .ok()
            .filter(|path| path.exists())
            .map(|path| process_path_text(&path))
            .unwrap_or_else(|| {
                if cfg!(windows) {
                    "rust-diffforge.exe".to_string()
                } else {
                    "rust-diffforge".to_string()
                }
            });
        let repo_path = process_path_text(&self.paths.repo_path);
        let repo_id = cloud_mcp_repo_id_for_path(&self.paths.repo_path);
        let mut args = vec![
            "--cloud-mcp-proxy".to_string(),
            "--base-url".to_string(),
            cloud_mcp_base_url_for_config(),
            "--repo-path".to_string(),
            repo_path,
            "--repo-id".to_string(),
            repo_id,
            "--client-id".to_string(),
            "rust-diffforge-agent".to_string(),
        ];
        if let Some(value) = workspace_id.filter(|value| !value.trim().is_empty()) {
            args.extend(["--workspace-id".to_string(), value.to_string()]);
        }
        if let Some(value) = workspace_name.filter(|value| !value.trim().is_empty()) {
            args.extend(["--workspace-name".to_string(), value.to_string()]);
        }
        if let Some(value) = agent_id.filter(|value| !value.trim().is_empty()) {
            args.extend(["--agent-id".to_string(), value.to_string()]);
        }
        if let Some(value) = session_id.filter(|value| !value.trim().is_empty()) {
            args.extend(["--session-id".to_string(), value.to_string()]);
        }
        (command, args)
    }

    fn write_worktree_mcp_activation_files(
        &self,
        worktree_path: &str,
        generic_config: &Value,
        command: &str,
        args: &[String],
        cloud_command: &str,
        cloud_args: &[String],
    ) -> Result<(), String> {
        let worktree = PathBuf::from(worktree_path);
        if !worktree.exists() {
            return Ok(());
        }

        self.ensure_worktree_mcp_files_ignored(&worktree)?;
        let worktree_text = process_path_text(&worktree);
        if !path_text_under_path(&worktree_text, &self.paths.worktrees_root) {
            return Err(format!(
                "Refusing to write MCP activation files outside .agents/worktrees: {}",
                worktree.display()
            ));
        }

        write_json_file_atomic(&worktree.join(".mcp.json"), generic_config)?;
        let codex_dir = worktree.join(".codex");
        fs::create_dir_all(&codex_dir)
            .map_err(|error| format!("Unable to create {}: {error}", codex_dir.display()))?;
        write_text_file_atomic(
            &codex_dir.join("config.toml"),
            &codex_config_toml(command, args, Some((cloud_command, cloud_args))),
        )?;
        self.write_agent_contract_files(&worktree)?;
        Ok(())
    }

    fn write_repo_root_dynamic_mcp_activation_files(&self) -> Result<(PathBuf, PathBuf), String> {
        let (command, mut args) = self.coordination_mcp_command_spec();
        args.extend([
            "--repo-path".to_string(),
            process_path_text(&self.paths.repo_path),
            "--db-path".to_string(),
            process_path_text(&self.paths.db_path),
        ]);

        let (cloud_command, cloud_args) = self.cloud_mcp_command_spec(None, None, None, None);
        let generic_config = json!({
            "mcpServers": {
                "coordination-kernel": {
                    "command": command.clone(),
                    "args": args.clone(),
                    "env": {
                        "COORDINATION_ENABLED": "1",
                        "COORDINATION_REPO_PATH": process_path_text(&self.paths.repo_path),
                        "COORDINATION_DB_PATH": process_path_text(&self.paths.db_path),
                        "COORDINATION_MCP_ALWAYS_ON": "1"
                    },
                    "diffforge": {
                        "scope": "repo-root-dynamic-agent",
                        "alwaysOn": true,
                        "toggleable": false,
                        "identitySource": "terminal_environment",
                        "authority": "local_coordination_kernel"
                    }
                },
                "cloud-diffforge": {
                    "command": cloud_command.clone(),
                    "args": cloud_args.clone(),
                    "env": {
                        "CLOUD_MCP_BASE_URL": cloud_mcp_base_url_for_config(),
                        "CLOUD_MCP_REPO_PATH": process_path_text(&self.paths.repo_path),
                        "CLOUD_MCP_REPO_ID": cloud_mcp_repo_id_for_path(&self.paths.repo_path),
                        "CLOUD_MCP_CLIENT_ID": "rust-diffforge-agent"
                    },
                    "diffforge": {
                        "scope": "repo-root-dynamic-agent",
                        "alwaysOn": true,
                        "toggleable": false,
                        "identitySource": "terminal_environment",
                        "authority": "cloud_context_pack"
                    }
                }
            }
        });

        self.write_repo_root_mcp_activation_files(
            &generic_config,
            &command,
            &args,
            &cloud_command,
            &cloud_args,
        )
    }

    fn write_repo_root_mcp_activation_files(
        &self,
        generic_config: &Value,
        command: &str,
        args: &[String],
        cloud_command: &str,
        cloud_args: &[String],
    ) -> Result<(PathBuf, PathBuf), String> {
        self.ensure_repo_root_mcp_files_ignored()?;

        let mcp_path = self.paths.repo_path.join(".mcp.json");
        write_json_file_atomic(&mcp_path, generic_config)?;

        let codex_dir = self.paths.repo_path.join(".codex");
        fs::create_dir_all(&codex_dir)
            .map_err(|error| format!("Unable to create {}: {error}", codex_dir.display()))?;
        let codex_path = codex_dir.join("config.toml");
        write_text_file_atomic(
            &codex_path,
            &codex_config_toml(command, args, Some((cloud_command, cloud_args))),
        )?;
        self.write_agent_contract_files(&self.paths.repo_path)?;

        Ok((mcp_path, codex_path))
    }

    fn write_agent_contract_files(&self, root: &Path) -> Result<(), String> {
        if !root.exists() {
            return Ok(());
        }
        let contract = diffforge_agent_contract_markdown();
        let mut generated = Vec::new();
        if write_or_update_generated_agent_contract(&root.join("AGENTS.md"), &contract)? {
            generated.push("AGENTS.md");
        }
        if write_or_update_generated_agent_contract(&root.join("CLAUDE.md"), &contract)? {
            generated.push("CLAUDE.md");
        }
        if !generated.is_empty() {
            ensure_git_info_exclude_entries(root, &generated)?;
        }
        Ok(())
    }

    fn ensure_repo_root_mcp_files_ignored(&self) -> Result<(), String> {
        let exclude_path_text = run_git(&self.paths.repo_path, &["rev-parse", "--git-path", "info/exclude"])?;
        let exclude_path = {
            let trimmed = exclude_path_text.trim();
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                path
            } else {
                self.paths.repo_path.join(path)
            }
        };
        if let Some(parent) = exclude_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("Unable to create git exclude directory {}: {error}", parent.display())
            })?;
        }
        let existing = fs::read_to_string(&exclude_path).unwrap_or_default();
        let mut additions = Vec::new();
        if !existing.lines().any(|line| line.trim() == ".mcp.json") {
            additions.push(".mcp.json");
        }
        if !existing.lines().any(|line| line.trim() == ".codex/config.toml") {
            additions.push(".codex/config.toml");
        }
        if additions.is_empty() {
            return Ok(());
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&exclude_path)
            .map_err(|error| format!("Unable to open {}: {error}", exclude_path.display()))?;
        if !existing.ends_with('\n') && !existing.is_empty() {
            writeln!(file).map_err(|error| format!("Unable to update {}: {error}", exclude_path.display()))?;
        }
        writeln!(file, "# Diff Forge local MCP activation files")
            .map_err(|error| format!("Unable to update {}: {error}", exclude_path.display()))?;
        for addition in additions {
            writeln!(file, "{addition}")
                .map_err(|error| format!("Unable to update {}: {error}", exclude_path.display()))?;
        }
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
            write_text_file_atomic(&exclude_path, &next)?;
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
        let session = self.ensure_session_active(session_id, agent_id)?;
        self.ensure_session_owns_task(session_id, task_id)?;
        let agent_slot_id = session["agent_slot_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        self.expire_old_leases()?;
        let resource_key = normalize_resource_key_checked(resource_key)?;
        let mode = validate_lease_mode(mode)?;

        self.begin_immediate_transaction("acquire lease")?;
        let result = (|| -> Result<Value, String> {
            let (resource_id, resource_created) =
                self.create_or_get_resource(&resource_key, &mode)?;
            self.emit_event(
                if resource_created {
                    "resource_registered"
                } else {
                    "resource_reused"
                },
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    agent_slot_id: agent_slot_id.clone(),
                    session_id: Some(session_id.to_string()),
                    resource_id: Some(resource_id.clone()),
                    ..EventRefs::default()
                },
                json!({
                    "resource_key": resource_key.clone(),
                    "resource_type": resource_type(&resource_key),
                    "risk_level": resource_risk_level(&resource_key, &mode),
                    "mode": mode.clone(),
                }),
            )?;
            self.emit_event(
                "lease_requested",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    agent_slot_id: agent_slot_id.clone(),
                    session_id: Some(session_id.to_string()),
                    resource_id: Some(resource_id.clone()),
                    ..EventRefs::default()
                },
                json!({"resource_key": resource_key.clone(), "mode": mode.clone(), "reason": reason}),
            )?;

            let blockers = self.active_conflicting_leases(&resource_key, &mode)?;
            if !blockers.is_empty() {
                let mut conflict_ids = Vec::new();
                for blocker in &blockers {
                    let conflict_id = uuid();
                    self.conn
                        .execute(
                            "INSERT INTO lease_conflicts(id, requested_resource_id, requested_by_agent_id, requested_by_slot_id, blocking_lease_id, task_id, status, created_at)
                             VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7)",
                            params![
                                conflict_id,
                                resource_id,
                                agent_id,
                                agent_slot_id.as_deref(),
                                blocker["id"].as_str().unwrap_or_default(),
                                task_id,
                                now_rfc3339()
                            ],
                        )
                        .map_err(|error| format!("Unable to record lease conflict: {error}"))?;
                    self.emit_event(
                        "lease_conflict_detected",
                        "kernel",
                        REPO_ID,
                        EventRefs {
                            task_id: Some(task_id.to_string()),
                            agent_id: Some(agent_id.to_string()),
                            agent_slot_id: agent_slot_id.clone(),
                            session_id: Some(session_id.to_string()),
                            resource_id: Some(resource_id.clone()),
                            ..EventRefs::default()
                        },
                        json!({
                            "conflict_id": conflict_id,
                            "requested_resource_key": resource_key.clone(),
                            "requested_mode": mode.clone(),
                            "blocking_lease_id": blocker["id"].clone(),
                            "blocking_resource_key": blocker["resource_key"].clone(),
                            "blocking_mode": blocker["mode"].clone(),
                            "mode_conflict_reason": blocker["mode_conflict_reason"].clone(),
                            "resource_conflict_reason": blocker["resource_conflict_reason"].clone(),
                            "conflict_reason": blocker["conflict_reason"].clone(),
                        }),
                    )?;
                    conflict_ids.push(conflict_id);
                }
                self.emit_event(
                    "lease_denied",
                    "agent",
                    agent_id,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        agent_id: Some(agent_id.to_string()),
                        agent_slot_id: agent_slot_id.clone(),
                        session_id: Some(session_id.to_string()),
                        resource_id: Some(resource_id),
                        ..EventRefs::default()
                    },
                    json!({
                        "resource_key": resource_key.clone(),
                        "mode": mode.clone(),
                        "blockers": blockers.clone(),
                        "conflict_ids": conflict_ids,
                        "detector": "resource_registry_overlap_v1",
                    }),
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
            let expires_at =
                rfc3339_after_seconds(ttl_seconds.unwrap_or(DEFAULT_LEASE_TTL_SECONDS));
            self.conn
                .execute(
                    "INSERT INTO leases(
                        id, resource_id, task_id, agent_id, agent_slot_id, session_id, mode, status, fence_token,
                        reason, acquired_at, expires_at, last_heartbeat_at
                    ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?9, ?10, ?11, ?10)",
                    params![
                        lease_id,
                        resource_id,
                        task_id,
                        agent_id,
                        agent_slot_id.as_deref(),
                        session_id,
                        mode.as_str(),
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
                    agent_slot_id: agent_slot_id.clone(),
                    session_id: Some(session_id.to_string()),
                    resource_id: Some(resource_id.clone()),
                    ..EventRefs::default()
                },
                json!({"lease_id": lease_id.clone(), "resource_key": resource_key.clone(), "mode": mode.clone(), "fence_token": fence_token, "expires_at": expires_at.clone()}),
            )?;

            Ok(api_ok(json!({
                "lease_id": lease_id.clone(),
                "resource_id": resource_id,
                "resource_key": resource_key,
                "mode": mode,
                "fence_token": fence_token,
                "expires_at": expires_at
            })))
        })();

        self.finish_transaction(result, "acquire lease")
    }

    fn active_conflicting_leases(
        &self,
        resource_key: &str,
        mode: &str,
    ) -> Result<Vec<Value>, String> {
        let now = now_rfc3339();
        let active = self.query_json(
            "SELECT l.*, r.resource_key, r.resource_type
             FROM leases l
             JOIN resources r ON r.id = l.resource_id
             WHERE l.status='active' AND l.expires_at >= ?1
             ORDER BY l.expires_at ASC",
            &[&now],
        )?;
        Ok(active
            .into_iter()
            .filter_map(|mut lease| {
                let existing_key = lease["resource_key"].as_str().unwrap_or_default();
                let existing_mode = lease["mode"].as_str().unwrap_or_default();
                let mode_reason = lease_mode_conflict_reason(existing_mode, mode)?;
                let resource_reason = resource_conflict_reason(existing_key, resource_key)?;
                if let Some(object) = lease.as_object_mut() {
                    object.insert(
                        "requested_resource_key".to_string(),
                        Value::String(resource_key.to_string()),
                    );
                    object.insert(
                        "requested_mode".to_string(),
                        Value::String(mode.to_string()),
                    );
                    object.insert(
                        "mode_conflict_reason".to_string(),
                        Value::String(mode_reason.clone()),
                    );
                    object.insert(
                        "resource_conflict_reason".to_string(),
                        Value::String(resource_reason.clone()),
                    );
                    object.insert(
                        "conflict_reason".to_string(),
                        Value::String(format!("{mode_reason};{resource_reason}")),
                    );
                }
                Some(lease)
            })
            .collect())
    }

    pub fn list_resources(
        &self,
        resource_type_filter: Option<&str>,
        min_risk_level: Option<i64>,
    ) -> Result<Value, String> {
        let mut sql = "SELECT * FROM resources WHERE 1=1".to_string();
        let mut values = Vec::new();
        if let Some(resource_type) = resource_type_filter.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND resource_type=?");
            values.push(resource_type.trim().to_ascii_lowercase());
        }
        if let Some(min_risk_level) = min_risk_level {
            sql.push_str(" AND risk_level >= ?");
            values.push(min_risk_level.to_string());
        }
        sql.push_str(" ORDER BY risk_level DESC, resource_type ASC, resource_key ASC LIMIT 500");
        let params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        Ok(api_ok(
            json!({"resources": self.query_json(&sql, &params)?}),
        ))
    }

    fn create_or_get_resource(
        &self,
        resource_key: &str,
        mode: &str,
    ) -> Result<(String, bool), String> {
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
            self.conn
                .execute(
                    "UPDATE resources
                     SET risk_level=MAX(risk_level, ?1), updated_at=?2
                     WHERE id=?3",
                    params![resource_risk_level(resource_key, mode), now_rfc3339(), id],
                )
                .map_err(|error| format!("Unable to refresh resource record: {error}"))?;
            return Ok((id, false));
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
        Ok((id, true))
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
                agent_slot_id: lease["agent_slot_id"].as_str().map(str::to_string),
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
                agent_slot_id: lease["agent_slot_id"].as_str().map(str::to_string),
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
            .prepare("SELECT id, task_id, agent_id, agent_slot_id, session_id, resource_id FROM leases WHERE status='active' AND expires_at < ?1")
            .map_err(|error| format!("Unable to prepare lease expiration query: {error}"))?;
        let rows = stmt
            .query_map([now.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
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

        for (id, task_id, agent_id, agent_slot_id, session_id, resource_id) in expired {
            self.emit_event(
                "lease_expired",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: Some(task_id),
                    agent_id: Some(agent_id),
                    agent_slot_id,
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
        let session = self.ensure_session_active(session_id, agent_id)?;
        self.ensure_session_owns_task(session_id, task_id)?;
        let agent_slot_id = session["agent_slot_id"].as_str();
        let worktree_id = session["worktree_id"].as_str();
        let mut warnings = Vec::new();
        let mut normalized_paths = Vec::new();
        let mut changes = Vec::new();

        for path in paths {
            reject_path_escape(&path)?;
            let normalized = normalize_change_path(&path)?;
            let resource_key = path_to_file_resource(&normalized);
            normalized_paths.push(normalized.clone());
            let lease = self.find_covering_lease(task_id, agent_id, session_id, &resource_key)?;
            let mut violation_id = None;
            if lease.is_none() {
                warnings.push(format!(
                    "{normalized} has no active lease; submit_patch will reject it."
                ));
                violation_id = Some(self.create_workspace_violation(
                    Some(task_id),
                    Some(agent_id),
                    Some(session_id),
                    worktree_id,
                    "unleased_write",
                    Some(&normalized),
                    Some(&resource_key),
                    "warning",
                    json!({
                        "summary": summary,
                        "change_source": "manual_announce",
                    }),
                )?);
            }
            let change = self.record_workspace_change(WorkspaceChangeInput {
                task_id: Some(task_id),
                agent_id: Some(agent_id),
                agent_slot_id,
                session_id: Some(session_id),
                worktree_id,
                change_source: "manual_announce",
                path: &normalized,
                resource_key: &resource_key,
                change_kind: "modified",
                lease: lease.as_ref(),
                violation_id: violation_id.as_deref(),
                summary,
                details: json!({"announced": true}),
            })?;
            changes.push(change);
        }

        self.emit_event(
            "change_announced",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: agent_slot_id.map(str::to_string),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({
                "paths": normalized_paths,
                "summary": summary,
                "warnings": warnings,
                "change_count": changes.len(),
                "changes": changes.clone(),
            }),
        )?;

        Ok(api_ok_warnings(
            json!({"paths": normalized_paths, "changes": changes}),
            warnings,
        ))
    }

    pub fn list_workspace_changes(
        &self,
        task_id: Option<&str>,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        worktree_id: Option<&str>,
        resource_key: Option<&str>,
        limit: Option<i64>,
    ) -> Result<Value, String> {
        let mut sql = "SELECT * FROM workspace_changes WHERE 1=1".to_string();
        let mut values = Vec::new();
        for (column, value) in [
            ("task_id", task_id),
            ("agent_id", agent_id),
            ("session_id", session_id),
            ("worktree_id", worktree_id),
        ] {
            if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
                sql.push_str(&format!(" AND {column}=?"));
                values.push(value.to_string());
            }
        }
        if let Some(value) = resource_key.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND resource_key=?");
            values.push(normalize_resource_key(value));
        }
        let limit = limit.unwrap_or(200).clamp(1, 1000);
        sql.push_str(&format!(" ORDER BY created_at DESC LIMIT {limit}"));
        let params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        Ok(api_ok(json!({"changes": self.query_json(&sql, &params)?})))
    }

    pub fn active_file_watcher_targets(&self) -> Result<Vec<Value>, String> {
        self.query_json(
            "SELECT w.id AS worktree_id,
                    w.path,
                    w.branch_name,
                    w.agent_slot_id,
                    s.agent_id,
                    COUNT(s.id) AS active_session_count
             FROM worktrees w
             JOIN agent_sessions s ON s.worktree_id = w.id
             WHERE s.status='active'
               AND s.task_id IS NOT NULL
               AND s.task_id <> ''
               AND w.status='active'
               AND w.path IS NOT NULL
               AND w.path <> ''
             GROUP BY w.id, w.path, w.branch_name, w.agent_slot_id, s.agent_id
             ORDER BY w.path ASC",
            &[],
        )
    }

    pub fn list_file_watchers(&self) -> Result<Value, String> {
        Ok(api_ok(json!({
            "watchers": self.query_json("SELECT * FROM file_watchers ORDER BY updated_at DESC LIMIT 50", &[])?,
            "active_targets": self.active_file_watcher_targets()?,
        })))
    }

    pub fn record_file_watcher_event(
        &self,
        watcher_id: &str,
        status: &str,
        backend: &str,
        watched_paths: &[String],
        debounce_ms: i64,
        event_type: &str,
        details: Value,
        last_error: Option<&str>,
    ) -> Result<Value, String> {
        let now = now_rfc3339();
        let watched_paths_json =
            serde_json::to_string(watched_paths).unwrap_or_else(|_| "[]".to_string());
        let last_scan_at =
            if event_type.contains("scan_finished") || event_type.contains("scan_failed") {
                Some(now.as_str())
            } else {
                None
            };
        let last_event_at = if event_type.contains("scan_triggered")
            || event_type.contains("paths_refreshed")
            || event_type.contains("event_detected")
        {
            Some(now.as_str())
        } else {
            None
        };
        let stopped_at = if status == "stopped" {
            Some(now.as_str())
        } else {
            None
        };
        self.conn
            .execute(
                "INSERT INTO file_watchers(
                    id, repo_id, status, backend, watched_paths_json, watched_path_count,
                    debounce_ms, last_scan_at, last_event_at, last_error, started_at, stopped_at, updated_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                    status=excluded.status,
                    backend=excluded.backend,
                    watched_paths_json=excluded.watched_paths_json,
                    watched_path_count=excluded.watched_path_count,
                    debounce_ms=excluded.debounce_ms,
                    last_scan_at=COALESCE(excluded.last_scan_at, file_watchers.last_scan_at),
                    last_event_at=COALESCE(excluded.last_event_at, file_watchers.last_event_at),
                    last_error=excluded.last_error,
                    stopped_at=excluded.stopped_at,
                    updated_at=excluded.updated_at",
                params![
                    watcher_id,
                    REPO_ID,
                    status,
                    backend,
                    watched_paths_json,
                    watched_paths.len() as i64,
                    debounce_ms,
                    last_scan_at,
                    last_event_at,
                    last_error,
                    now,
                    stopped_at,
                ],
            )
            .map_err(|error| format!("Unable to record file watcher state: {error}"))?;
        self.emit_event(
            event_type,
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "watcher_id": watcher_id,
                "status": status,
                "backend": backend,
                "watched_path_count": watched_paths.len(),
                "watched_paths": watched_paths,
                "debounce_ms": debounce_ms,
                "last_error": last_error,
                "details": details,
            }),
        )?;
        self.query_one(
            "SELECT * FROM file_watchers WHERE id=?1",
            &[&watcher_id],
            "File watcher state was not recorded.",
        )
    }

    pub fn scan_workspace_changes(&self) -> Result<Value, String> {
        let sessions = self.query_json(
            "SELECT s.id AS session_id, s.task_id, s.agent_id, s.agent_slot_id, s.worktree_id,
                    w.path AS worktree_path
             FROM agent_sessions s
             JOIN worktrees w ON w.id = s.worktree_id
             WHERE s.status='active'
               AND s.task_id IS NOT NULL
               AND s.task_id <> ''
               AND s.worktree_id IS NOT NULL
               AND s.worktree_id <> ''
             ORDER BY s.updated_at DESC",
            &[],
        )?;
        self.emit_event(
            "change_scan_started",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({"session_count": sessions.len(), "scanner": "git_status"}),
        )?;
        let mut changes = Vec::new();
        let mut warnings = Vec::new();
        for session in sessions {
            let session_id = session["session_id"].as_str().unwrap_or_default();
            let task_id = session["task_id"].as_str().unwrap_or_default();
            let agent_id = session["agent_id"].as_str().unwrap_or_default();
            let agent_slot_id = session["agent_slot_id"].as_str();
            let worktree_id = session["worktree_id"].as_str();
            let worktree_path = PathBuf::from(session["worktree_path"].as_str().unwrap_or(""));
            if !worktree_path.exists() {
                warnings.push(format!(
                    "Skipping session {session_id}; worktree path is missing."
                ));
                continue;
            }
            let canonical_worktree = worktree_path.canonicalize().map_err(|error| {
                format!(
                    "Unable to canonicalize worktree path {}: {error}",
                    worktree_path.display()
                )
            })?;
            if !canonical_worktree.starts_with(
                self.paths
                    .worktrees_root
                    .canonicalize()
                    .unwrap_or_else(|_| self.paths.worktrees_root.clone()),
            ) {
                warnings.push(format!(
                    "Skipping session {session_id}; worktree path escapes .agents/worktrees."
                ));
                continue;
            }
            for changed_file in self.changed_files(&canonical_worktree)? {
                reject_path_escape(&changed_file.path)?;
                let resource_key = path_to_file_resource(&changed_file.path);
                let lease =
                    self.find_covering_lease(task_id, agent_id, session_id, &resource_key)?;
                let mut violation_id = None;
                if lease.is_none() {
                    violation_id = Some(self.create_workspace_violation(
                        Some(task_id),
                        Some(agent_id),
                        Some(session_id),
                        worktree_id,
                        "unleased_write",
                        Some(&changed_file.path),
                        Some(&resource_key),
                        "warning",
                        json!({
                            "change_source": "watcher_scan",
                            "change_kind": changed_file.change_kind,
                        }),
                    )?);
                }
                let change = self.record_workspace_change(WorkspaceChangeInput {
                    task_id: Some(task_id),
                    agent_id: Some(agent_id),
                    agent_slot_id,
                    session_id: Some(session_id),
                    worktree_id,
                    change_source: "watcher_scan",
                    path: &changed_file.path,
                    resource_key: &resource_key,
                    change_kind: &changed_file.change_kind,
                    lease: lease.as_ref(),
                    violation_id: violation_id.as_deref(),
                    summary: Some("Workspace change scan"),
                    details: json!({"untracked": changed_file.untracked}),
                })?;
                changes.push(change);
            }
        }
        self.emit_event(
            "change_scan_finished",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "change_count": changes.len(),
                "warning_count": warnings.len(),
                "scanner": "git_status",
            }),
        )?;
        Ok(api_ok_warnings(
            json!({"changes": changes, "scanner": "git_status"}),
            warnings,
        ))
    }

    fn record_workspace_change(&self, input: WorkspaceChangeInput<'_>) -> Result<Value, String> {
        let id = uuid();
        let now = now_rfc3339();
        let lease_id = input
            .lease
            .and_then(|lease| lease["id"].as_str())
            .map(str::to_string);
        let fence_token = input.lease.and_then(|lease| lease["fence_token"].as_i64());
        let lease_status = if lease_id.is_some() {
            "covered"
        } else {
            "unleased"
        };
        self.conn
            .execute(
                "INSERT INTO workspace_changes(
                    id, repo_id, task_id, agent_id, agent_slot_id, session_id, worktree_id,
                    change_source, path, resource_key, change_kind, lease_id, fence_token,
                    lease_status, violation_id, summary, details_json, created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    id,
                    REPO_ID,
                    input.task_id,
                    input.agent_id,
                    input.agent_slot_id,
                    input.session_id,
                    input.worktree_id,
                    input.change_source,
                    input.path,
                    input.resource_key,
                    input.change_kind,
                    lease_id.as_deref(),
                    fence_token,
                    lease_status,
                    input.violation_id,
                    input.summary,
                    input.details.to_string(),
                    now,
                ],
            )
            .map_err(|error| format!("Unable to record workspace change: {error}"))?;
        self.emit_event(
            "file_changed",
            input.agent_id.map(|_| "agent").unwrap_or("kernel"),
            input.agent_id.unwrap_or(REPO_ID),
            EventRefs {
                task_id: input.task_id.map(str::to_string),
                agent_id: input.agent_id.map(str::to_string),
                agent_slot_id: input.agent_slot_id.map(str::to_string),
                session_id: input.session_id.map(str::to_string),
                resource_id: input
                    .lease
                    .and_then(|lease| lease["resource_id"].as_str())
                    .map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "change_id": id,
                "change_source": input.change_source,
                "path": input.path,
                "resource_key": input.resource_key,
                "change_kind": input.change_kind,
                "lease_id": lease_id.clone(),
                "fence_token": fence_token,
                "lease_status": lease_status,
                "violation_id": input.violation_id,
                "summary": input.summary,
            }),
        )?;
        Ok(json!({
            "id": id,
            "path": input.path,
            "resource_key": input.resource_key,
            "change_kind": input.change_kind,
            "change_source": input.change_source,
            "lease_id": lease_id,
            "fence_token": fence_token,
            "lease_status": lease_status,
            "violation_id": input.violation_id,
        }))
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
            let session = self.ensure_session_active(session_id, agent_id)?;
            let agent_slot_id = session["agent_slot_id"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string);
            let merge_resolution = self.complete_merge_resolution_task(
                task_id,
                validation.patch_id.as_deref(),
                validation.diff_artifact_id.as_deref(),
            )?;
            self.conn
                .execute(
                    "UPDATE tasks SET status='patch_submitted', updated_at=?1 WHERE id=?2",
                    params![now_rfc3339(), task_id],
                )
                .map_err(|error| format!("Unable to mark task patch_submitted: {error}"))?;
            self.emit_event(
                "patch_submitted",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    agent_slot_id,
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
                    "diff_artifact_id": validation.diff_artifact_id,
                    "merge_resolution": merge_resolution
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
        self.expire_old_leases()?;
        let session = self.ensure_session_active(session_id, agent_id)?;
        self.ensure_session_owns_task(session_id, task_id)?;
        let agent_slot_id = session["agent_slot_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        self.emit_event(
            "patch_validation_started",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: agent_slot_id.clone(),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({"worktree_id": worktree_id, "submit": submit, "summary": summary}),
        )?;
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
        if session["worktree_id"].as_str() != Some(worktree_id) {
            return Err("Session is not linked to this worktree.".to_string());
        }
        if worktree["agent_id"].as_str() != Some(agent_id) {
            return Err("Worktree does not belong to this agent.".to_string());
        }
        let session_slot = session["agent_slot_id"].as_str().unwrap_or("");
        let worktree_slot = worktree["agent_slot_id"].as_str().unwrap_or("");
        let legacy_session_match = worktree["session_id"].as_str() == Some(session_id);
        if !worktree_slot.is_empty() && worktree_slot != session_slot {
            return Err("Worktree does not belong to this agent slot.".to_string());
        }
        if worktree_slot.is_empty() && !legacy_session_match {
            return Err("Worktree does not belong to this session.".to_string());
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

        if policy["root_repo_write_policy"].as_str() == Some("detect_and_reject_patch") {
            let target_changes = self.repo_dirty_project_files()?;
            if !target_changes.is_empty() {
                let changed_files = target_changes
                    .iter()
                    .map(|change| change.path.clone())
                    .collect::<Vec<_>>();
                let violation_id = self.create_workspace_violation(
                    Some(task_id),
                    Some(agent_id),
                    Some(session_id),
                    Some(worktree_id),
                    "direct_project_root_write",
                    None,
                    None,
                    "error",
                    json!({
                        "summary": summary,
                        "changed_files": changed_files,
                        "policy": "root_repo_write_policy",
                    }),
                )?;
                let validation_id = self.finish_patch_validation(
                    None,
                    task_id,
                    agent_id,
                    session_id,
                    worktree_id,
                    "failed",
                    "Patch rejected: the shared project root has uncommitted changes; agent edits must stay in the isolated branch root.",
                    json!({
                        "reason": "direct_project_root_write",
                        "changed_files": changed_files,
                        "violation_id": violation_id,
                    }),
                )?;
                return Ok(PatchValidationResult {
                    status: "failed".to_string(),
                    validation_id,
                    patch_id: None,
                    diff_artifact_id: None,
                    diff_hash: None,
                    changed_files: Vec::new(),
                    violations: vec![json!({
                        "violation_kind": "direct_project_root_write",
                        "violation_id": violation_id,
                    })],
                    warnings: Vec::new(),
                });
            }
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
            let mut violation_id = None;
            match lease.as_ref() {
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
                    violation_id = Some(self.create_workspace_violation(
                        Some(task_id),
                        Some(agent_id),
                        Some(session_id),
                        Some(worktree_id),
                        "patch_without_lease",
                        Some(&changed_file.path),
                        Some(&resource_key),
                        "error",
                        json!({"change_kind": changed_file.change_kind}),
                    )?);
                    violations.push(json!({
                        "path": changed_file.path,
                        "resource_key": resource_key,
                        "violation_kind": "patch_without_lease",
                        "violation_id": violation_id.clone(),
                    }));
                }
            }
            self.record_workspace_change(WorkspaceChangeInput {
                task_id: Some(task_id),
                agent_id: Some(agent_id),
                agent_slot_id: agent_slot_id.as_deref(),
                session_id: Some(session_id),
                worktree_id: Some(worktree_id),
                change_source: "patch_validation",
                path: &changed_file.path,
                resource_key: &resource_key,
                change_kind: &changed_file.change_kind,
                lease: lease.as_ref(),
                violation_id: violation_id.as_deref(),
                summary,
                details: json!({
                    "submit": submit,
                    "validation_file_id": file_validation_id,
                    "untracked": changed_file.untracked,
                }),
            })?;
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
                    agent_slot_id: agent_slot_id.clone(),
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
                agent_slot_id: agent_slot_id.clone(),
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
        let agent_slot_id = self
            .query_one(
                "SELECT agent_slot_id FROM agent_sessions WHERE id=?1",
                &[&session_id],
                "Session does not exist.",
            )?
            .get("agent_slot_id")
            .and_then(Value::as_str)
            .map(str::to_string);
        self.conn
            .execute(
                "INSERT INTO patches(
                    id, task_id, agent_id, agent_slot_id, session_id, worktree_id, base_sha, head_sha,
                    diff_artifact_id, status, risk_level, validation_id, diff_hash, summary,
                    created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
                params![
                    patch_id,
                    task_id,
                    agent_id,
                    agent_slot_id,
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
        let output = run_git_bytes(
            worktree_path,
            &["status", "--porcelain", "-z", "--untracked-files=all"],
        )?;
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

    pub fn initialize_merge_resolution(
        &self,
        patch_id: &str,
        resolver_agent_id: Option<&str>,
        resolver_session_id: Option<&str>,
        target_branch: Option<&str>,
    ) -> Result<Value, String> {
        self.expire_old_leases()?;
        let patch = self.get_patch(patch_id)?;
        let validation = patch["validation_id"]
            .as_str()
            .ok_or_else(|| "Patch has no validation.".to_string())
            .and_then(|id| self.get_patch_validation(id))?;
        if validation["status"].as_str() != Some("passed")
            || patch["status"].as_str() != Some("submitted")
        {
            return Ok(api_error(
                "merge_resolution_blocked",
                "Patch must be submitted with passed validation before merge resolution can be initialized.",
                json!({
                    "patch_id": patch_id,
                    "patch_status": patch["status"].clone(),
                    "validation_status": validation["status"].clone(),
                }),
            ));
        }
        self.verify_patch_artifact_hash(&patch)?;

        let policy = self.repo_policy()?;
        if policy["merge_gate_required"].as_i64().unwrap_or(1) != 1 {
            let job_id = self.create_merge_job(
                &patch,
                "blocked",
                target_branch,
                "merge_resolution",
                Some("The local merge gate is not enabled."),
            )?;
            return Ok(api_error(
                "merge_resolution_blocked",
                "The local merge gate must remain enabled before merge resolution can be initialized.",
                json!({"merge_job_id": job_id, "patch_id": patch_id}),
            ));
        }
        if policy["merge_requires_clean_target"].as_i64().unwrap_or(1) == 1
            && !self.repo_is_clean()?
        {
            let job_id = self.create_merge_job(
                &patch,
                "blocked",
                target_branch,
                "merge_resolution",
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
                json!({"patch_id": patch_id, "merge_resolution": true}),
            )?;
            return Ok(api_error(
                "merge_resolution_blocked",
                "Target repo root is dirty.",
                json!({"merge_job_id": job_id, "patch_id": patch_id}),
            ));
        }

        let changed_files = self.patch_file_paths(patch_id)?;
        if changed_files.is_empty() {
            return Ok(api_error(
                "merge_resolution_blocked",
                "Patch has no recorded changed files.",
                json!({"patch_id": patch_id}),
            ));
        }

        if let Some(existing) = self.existing_active_merge_resolution(patch_id)? {
            return Ok(api_ok(json!({
                "status": "already_initialized",
                "merge_job_id": existing["merge_job_id"].clone(),
                "resolution_task_id": existing["resolution_task_id"].clone(),
                "resolver_agent_id": existing["resolver_agent_id"].clone(),
                "resolver_session_id": existing["resolver_session_id"].clone(),
                "resolver_prompt": existing["resolver_prompt"].clone(),
                "changed_files": changed_files,
            })));
        }

        let resolver_session =
            self.select_merge_resolution_session(&patch, resolver_agent_id, resolver_session_id)?;
        let actual_resolver_agent_id = resolver_session["agent_id"]
            .as_str()
            .ok_or_else(|| "Resolver session is missing agent_id.".to_string())?;
        let actual_resolver_session_id = resolver_session["id"]
            .as_str()
            .ok_or_else(|| "Resolver session is missing id.".to_string())?;
        let resolver_worktree_id = resolver_session["worktree_id"].as_str();

        let active_blockers =
            self.active_merge_resolution_blockers(&changed_files, actual_resolver_agent_id)?;
        if !active_blockers.is_empty() {
            let job_id = self.create_merge_job(
                &patch,
                "blocked",
                target_branch,
                "merge_resolution",
                Some("Other active agents still hold file leases for this patch."),
            )?;
            self.emit_event(
                "merge_resolution_blocked",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({
                    "merge_job_id": job_id,
                    "patch_id": patch_id,
                    "reason": "active_file_leases",
                    "blockers": active_blockers,
                }),
            )?;
            return Ok(api_error(
                "merge_resolution_blocked_active_leases",
                "Another active agent still owns at least one changed file; wait for that lease to release before initializing resolution.",
                json!({"merge_job_id": job_id, "patch_id": patch_id, "blockers": active_blockers}),
            ));
        }

        if self.git_apply_check(&patch).is_ok() {
            let queued = self.request_merge(patch_id, target_branch, Some("patch_apply"))?;
            if queued["ok"].as_bool() == Some(true) {
                return Ok(api_ok(json!({
                    "status": "queued_without_resolution",
                    "resolution_needed": false,
                    "merge_job_id": queued["data"]["merge_job_id"].clone(),
                    "patch_id": patch_id,
                    "changed_files": changed_files,
                })));
            }
            return Ok(queued);
        }

        let merge_job_id = self.create_merge_job(
            &patch,
            "resolution_initialized",
            target_branch,
            "merge_resolution",
            Some("Patch does not apply cleanly; resolver agent initialized."),
        )?;
        let resolution_task = self.create_task(
            &format!("Resolve merge for patch {}", short_id(patch_id)),
            Some("Merge resolution is being initialized by the local coordination kernel."),
            100,
            3,
            None,
            None,
            Some("merge_resolution"),
            Some("Submit a resolved patch. Do not apply the merge."),
        )?;
        let resolution_task_id = resolution_task["id"]
            .as_str()
            .ok_or_else(|| "Resolution task response is missing id.".to_string())?
            .to_string();
        self.claim_task(
            &resolution_task_id,
            actual_resolver_agent_id,
            actual_resolver_session_id,
        )?;

        let released_leases =
            self.release_resolver_file_leases(&changed_files, actual_resolver_agent_id)?;
        let mut resolution_leases = Vec::new();
        for path in &changed_files {
            let lease = self.acquire_lease(
                &resolution_task_id,
                actual_resolver_agent_id,
                actual_resolver_session_id,
                &path_to_file_resource(path),
                "write",
                Some(DEFAULT_LEASE_TTL_SECONDS),
                Some("merge_resolution"),
            )?;
            if lease["ok"].as_bool() == Some(false) {
                return Ok(api_error(
                    "merge_resolution_lease_failed",
                    "Unable to acquire one of the merge-resolution file leases.",
                    json!({
                        "patch_id": patch_id,
                        "merge_job_id": merge_job_id,
                        "resolution_task_id": resolution_task_id,
                        "failed_path": path,
                        "lease_response": lease,
                    }),
                ));
            }
            resolution_leases.push(lease["data"].clone());
        }

        let cloud_context = json!({
            "tool": "cloud_get_context_pack",
            "arguments": {
                "agent_id": "$CLOUD_MCP_AGENT_ID",
                "self_agent_id": "$CLOUD_MCP_AGENT_ID",
                "repo_id": "$CLOUD_MCP_REPO_ID",
                "lane": format!("merge-resolution:{patch_id}"),
                "prompt": format!("Resolve merge for patch {patch_id}"),
                "record_prompt": true,
                "patch_id": patch_id,
                "merge_job_id": merge_job_id.clone(),
                "resolution_task_id": resolution_task_id.clone(),
            }
        });
        let resolver_prompt = merge_resolution_prompt(
            patch_id,
            &merge_job_id,
            &resolution_task_id,
            &changed_files,
            &cloud_context,
        );
        self.conn
            .execute(
                "UPDATE tasks
                 SET body=?1, parent_task_id=?2, expected_output=?3, updated_at=?4
                 WHERE id=?5",
                params![
                    resolver_prompt.clone(),
                    patch["task_id"].as_str(),
                    "Resolved patch submitted through submit_patch; no apply_merge from the agent.",
                    now_rfc3339(),
                    resolution_task_id
                ],
            )
            .map_err(|error| format!("Unable to update merge resolution task: {error}"))?;
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO merge_resolution_tasks(
                    id, merge_job_id, patch_id, resolution_task_id, resolver_agent_id,
                    resolver_session_id, resolver_worktree_id, status, changed_files_json,
                    cloud_context_json, resolver_prompt, created_at, updated_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'initialized', ?8, ?9, ?10, ?11, ?11)",
                params![
                    uuid(),
                    merge_job_id,
                    patch_id,
                    resolution_task_id,
                    actual_resolver_agent_id,
                    actual_resolver_session_id,
                    resolver_worktree_id,
                    json!(changed_files.clone()).to_string(),
                    cloud_context.to_string(),
                    resolver_prompt.clone(),
                    now
                ],
            )
            .map_err(|error| format!("Unable to record merge resolution task: {error}"))?;
        self.emit_event(
            "merge_resolution_initialized",
            "kernel",
            REPO_ID,
            EventRefs {
                task_id: Some(resolution_task_id.clone()),
                agent_id: Some(actual_resolver_agent_id.to_string()),
                session_id: Some(actual_resolver_session_id.to_string()),
                artifact_id: patch["diff_artifact_id"].as_str().map(str::to_string),
                ..EventRefs::from_patch(&patch)
            },
            json!({
                "patch_id": patch_id,
                "merge_job_id": merge_job_id,
                "resolution_task_id": resolution_task_id,
                "resolver_agent_id": actual_resolver_agent_id,
                "resolver_session_id": actual_resolver_session_id,
                "changed_files": changed_files,
                "released_prior_resolver_leases": released_leases,
                "resolution_leases": resolution_leases,
                "cloud_context": cloud_context,
            }),
        )?;

        Ok(api_ok(json!({
            "status": "resolution_initialized",
            "resolution_needed": true,
            "patch_id": patch_id,
            "merge_job_id": merge_job_id,
            "resolution_task_id": resolution_task_id,
            "resolver_agent_id": actual_resolver_agent_id,
            "resolver_session_id": actual_resolver_session_id,
            "resolver_worktree_id": resolver_worktree_id,
            "changed_files": changed_files,
            "released_prior_resolver_leases": released_leases,
            "resolution_leases": resolution_leases,
            "cloud_context": cloud_context,
            "resolver_prompt": resolver_prompt,
        })))
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
        let policy = self.repo_policy()?;
        if policy["merge_gate_required"].as_i64().unwrap_or(1) != 1 {
            let job_id = self.create_merge_job(
                &patch,
                "blocked",
                target_branch,
                strategy,
                Some("The local merge gate is not enabled."),
            )?;
            self.emit_event(
                "merge_blocked",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({"merge_job_id": job_id, "patch_id": patch_id, "reason": "merge_gate_disabled"}),
            )?;
            return Ok(api_error(
                "merge_blocked",
                "The local merge gate must remain enabled before a patch can be queued.",
                json!({"merge_job_id": job_id}),
            ));
        }
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
        let blocking_violations = self.open_blocking_violations(
            patch["session_id"].as_str().unwrap_or_default(),
            patch["worktree_id"].as_str().unwrap_or_default(),
        )?;
        if !blocking_violations.is_empty() {
            let job_id = self.create_merge_job(
                &patch,
                "blocked",
                target_branch,
                strategy,
                Some("Open blocking workspace violations exist."),
            )?;
            self.emit_event(
                "merge_blocked",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({"merge_job_id": job_id, "patch_id": patch_id, "reason": "open_workspace_violations", "violations": blocking_violations.clone()}),
            )?;
            return Ok(api_error(
                "merge_blocked",
                "Open blocking workspace violations must be resolved before merge.",
                json!({"merge_job_id": job_id, "violations": blocking_violations}),
            ));
        }
        if policy["merge_requires_clean_target"].as_i64().unwrap_or(1) == 1
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
        let validation = patch["validation_id"]
            .as_str()
            .ok_or_else(|| "Patch has no validation.".to_string())
            .and_then(|id| self.get_patch_validation(id))?;
        if validation["status"].as_str() != Some("passed")
            || patch["status"].as_str() != Some("merge_queued")
        {
            self.update_merge_job(
                merge_job_id,
                "blocked",
                Some("Patch is no longer in a merge-queued state with passed validation."),
            )?;
            self.emit_event(
                "merge_blocked",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({"merge_job_id": merge_job_id, "patch_id": patch_id, "reason": "patch_not_merge_queued"}),
            )?;
            return Ok(api_error(
                "merge_blocked",
                "Patch must be merge_queued with passed validation before apply.",
                json!({"merge_job_id": merge_job_id}),
            ));
        }
        self.verify_patch_artifact_hash(&patch)?;
        let policy = self.repo_policy()?;
        if policy["merge_gate_required"].as_i64().unwrap_or(1) != 1 {
            self.update_merge_job(
                merge_job_id,
                "blocked",
                Some("The local merge gate is not enabled."),
            )?;
            self.emit_event(
                "merge_blocked",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({"merge_job_id": merge_job_id, "patch_id": patch_id, "reason": "merge_gate_disabled"}),
            )?;
            return Ok(api_error(
                "merge_blocked",
                "The local merge gate must remain enabled before a patch can be applied.",
                json!({"merge_job_id": merge_job_id}),
            ));
        }
        let blocking_violations = self.open_blocking_violations(
            patch["session_id"].as_str().unwrap_or_default(),
            patch["worktree_id"].as_str().unwrap_or_default(),
        )?;
        if !blocking_violations.is_empty() {
            self.update_merge_job(
                merge_job_id,
                "blocked",
                Some("Open blocking workspace violations exist."),
            )?;
            self.emit_event(
                "merge_blocked",
                "kernel",
                REPO_ID,
                EventRefs::from_patch(&patch),
                json!({"merge_job_id": merge_job_id, "patch_id": patch_id, "reason": "open_workspace_violations", "violations": blocking_violations.clone()}),
            )?;
            return Ok(api_error(
                "merge_blocked",
                "Open blocking workspace violations must be resolved before merge apply.",
                json!({"merge_job_id": merge_job_id, "violations": blocking_violations}),
            ));
        }
        if policy["merge_requires_clean_target"].as_i64().unwrap_or(1) == 1
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
                self.conn
                    .execute(
                        "UPDATE tasks SET status='merged', updated_at=?1 WHERE id=?2",
                        params![now_rfc3339(), patch["task_id"].as_str()],
                    )
                    .map_err(|error| format!("Unable to mark task merged: {error}"))?;
                if let Some(task_id) = patch["task_id"].as_str() {
                    self.refresh_dependent_tasks(task_id)?;
                }
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
        Ok(self.repo_dirty_project_files()?.is_empty())
    }

    fn repo_dirty_project_files(&self) -> Result<Vec<ChangedFile>, String> {
        Ok(self
            .changed_files(&self.paths.repo_path)?
            .into_iter()
            .filter(|change| !is_coordination_owned_root_status_path(&change.path))
            .collect())
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

    fn patch_file_paths(&self, patch_id: &str) -> Result<Vec<String>, String> {
        Ok(self
            .query_json(
                "SELECT path FROM patch_files WHERE patch_id=?1 ORDER BY path ASC",
                &[&patch_id],
            )?
            .into_iter()
            .filter_map(|row| row["path"].as_str().map(str::to_string))
            .collect())
    }

    fn existing_active_merge_resolution(&self, patch_id: &str) -> Result<Option<Value>, String> {
        let mut rows = self.query_json(
            "SELECT mrt.*, mj.status AS merge_job_status
             FROM merge_resolution_tasks mrt
             LEFT JOIN merge_jobs mj ON mj.id=mrt.merge_job_id
             WHERE mrt.patch_id=?1 AND mrt.status IN ('initialized', 'active')
             ORDER BY mrt.updated_at DESC LIMIT 1",
            &[&patch_id],
        )?;
        Ok(rows.pop())
    }

    fn select_merge_resolution_session(
        &self,
        patch: &Value,
        resolver_agent_id: Option<&str>,
        resolver_session_id: Option<&str>,
    ) -> Result<Value, String> {
        let agent_id = resolver_agent_id
            .filter(|value| !value.trim().is_empty())
            .or_else(|| patch["agent_id"].as_str())
            .ok_or_else(|| {
                "Patch is missing agent_id and no resolver_agent_id was provided.".to_string()
            })?;
        if let Some(session_id) = resolver_session_id.filter(|value| !value.trim().is_empty()) {
            return self.ensure_session_active(session_id, agent_id);
        }
        if let Some(session_id) = patch["session_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            if let Ok(session) = self.ensure_session_active(session_id, agent_id) {
                return Ok(session);
            }
        }
        let mut sessions = self.query_json(
            "SELECT * FROM agent_sessions
             WHERE agent_id=?1 AND status='active'
             ORDER BY updated_at DESC LIMIT 1",
            &[&agent_id],
        )?;
        sessions.pop().ok_or_else(|| {
            format!(
                "No active resolver session exists for agent {agent_id}; open or restart that agent before initializing merge resolution."
            )
        })
    }

    fn active_merge_resolution_blockers(
        &self,
        changed_files: &[String],
        resolver_agent_id: &str,
    ) -> Result<Vec<Value>, String> {
        let active = self.list_active_leases_internal(None, None, None)?;
        let requested = changed_files
            .iter()
            .map(|path| (path.clone(), path_to_file_resource(path)))
            .collect::<Vec<_>>();
        let mut blockers = Vec::new();
        for lease in active {
            if lease["agent_id"].as_str() == Some(resolver_agent_id) {
                continue;
            }
            if !is_write_like(lease["mode"].as_str().unwrap_or_default()) {
                continue;
            }
            let existing_key = lease["resource_key"].as_str().unwrap_or_default();
            for (path, resource_key) in &requested {
                if resource_conflict_reason(existing_key, resource_key).is_some() {
                    let mut blocker = lease.clone();
                    if let Some(object) = blocker.as_object_mut() {
                        object.insert("requested_path".to_string(), Value::String(path.clone()));
                        object.insert(
                            "requested_resource_key".to_string(),
                            Value::String(resource_key.clone()),
                        );
                    }
                    blockers.push(blocker);
                    break;
                }
            }
        }
        Ok(blockers)
    }

    fn release_resolver_file_leases(
        &self,
        changed_files: &[String],
        resolver_agent_id: &str,
    ) -> Result<Vec<Value>, String> {
        let active = self.list_active_leases_internal(None, Some(resolver_agent_id), None)?;
        let requested = changed_files
            .iter()
            .map(|path| path_to_file_resource(path))
            .collect::<Vec<_>>();
        let now = now_rfc3339();
        let mut released = Vec::new();
        for lease in active {
            if !is_write_like(lease["mode"].as_str().unwrap_or_default()) {
                continue;
            }
            let existing_key = lease["resource_key"].as_str().unwrap_or_default();
            if !requested
                .iter()
                .any(|resource_key| resource_conflict_reason(existing_key, resource_key).is_some())
            {
                continue;
            }
            let Some(lease_id) = lease["id"].as_str() else {
                continue;
            };
            self.conn
                .execute(
                    "UPDATE leases SET status='released', released_at=?1 WHERE id=?2 AND status='active'",
                    params![now, lease_id],
                )
                .map_err(|error| format!("Unable to release prior resolver lease: {error}"))?;
            self.emit_event(
                "lease_released_for_merge_resolution",
                "kernel",
                REPO_ID,
                EventRefs {
                    task_id: lease["task_id"].as_str().map(str::to_string),
                    agent_id: lease["agent_id"].as_str().map(str::to_string),
                    agent_slot_id: lease["agent_slot_id"].as_str().map(str::to_string),
                    session_id: lease["session_id"].as_str().map(str::to_string),
                    resource_id: lease["resource_id"].as_str().map(str::to_string),
                    ..EventRefs::default()
                },
                json!({
                    "lease_id": lease_id,
                    "resource_key": lease["resource_key"].clone(),
                    "reason": "same_agent_merge_resolution_transfer",
                }),
            )?;
            released.push(lease);
        }
        Ok(released)
    }

    fn complete_merge_resolution_task(
        &self,
        task_id: &str,
        resolved_patch_id: Option<&str>,
        resolved_diff_artifact_id: Option<&str>,
    ) -> Result<Value, String> {
        let rows = self.query_json(
            "SELECT * FROM merge_resolution_tasks
             WHERE resolution_task_id=?1 AND status IN ('initialized', 'active')
             ORDER BY updated_at DESC",
            &[&task_id],
        )?;
        if rows.is_empty() {
            return Ok(Value::Null);
        }
        let now = now_rfc3339();
        let mut completed = Vec::new();
        for row in rows {
            let Some(id) = row["id"].as_str() else {
                continue;
            };
            let merge_job_id = row["merge_job_id"].as_str().unwrap_or_default();
            self.conn
                .execute(
                    "UPDATE merge_resolution_tasks
                     SET status='resolved', resolved_patch_id=?1, updated_at=?2
                     WHERE id=?3",
                    params![resolved_patch_id, now, id],
                )
                .map_err(|error| format!("Unable to mark merge resolution resolved: {error}"))?;
            self.conn
                .execute(
                    "UPDATE merge_jobs
                     SET status='resolution_submitted', result_artifact_id=COALESCE(?1, result_artifact_id), updated_at=?2
                     WHERE id=?3",
                    params![resolved_diff_artifact_id, now, merge_job_id],
                )
                .map_err(|error| format!("Unable to update merge job after resolution submit: {error}"))?;
            self.emit_event(
                "merge_resolution_patch_submitted",
                "agent",
                row["resolver_agent_id"].as_str().unwrap_or(REPO_ID),
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: row["resolver_agent_id"].as_str().map(str::to_string),
                    session_id: row["resolver_session_id"].as_str().map(str::to_string),
                    artifact_id: resolved_diff_artifact_id.map(str::to_string),
                    ..EventRefs::default()
                },
                json!({
                    "merge_job_id": merge_job_id,
                    "patch_id": row["patch_id"].clone(),
                    "resolved_patch_id": resolved_patch_id,
                    "resolution_task_id": task_id,
                }),
            )?;
            completed.push(json!({
                "merge_job_id": merge_job_id,
                "patch_id": row["patch_id"].clone(),
                "resolved_patch_id": resolved_patch_id,
                "resolution_task_id": task_id,
                "status": "resolved",
            }));
        }
        Ok(json!({
            "status": "resolved",
            "items": completed,
        }))
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
        context_run_id: Option<&str>,
        created_by_agent_id: Option<&str>,
        certified_by: Option<&str>,
    ) -> Result<Value, String> {
        let memory_kind = normalize_memory_kind(memory_kind);
        let trust_level = match normalize_trust_level(trust_level) {
            Ok(value) => value,
            Err(error) => {
                self.log_memory_write_rejected(
                    &memory_kind,
                    title,
                    trust_level,
                    &error,
                    json!({"reason": "invalid_trust_level"}),
                );
                return Err(error);
            }
        };
        if let Some(artifact_id) = evidence_artifact_id {
            if let Err(error) = self.get_artifact(artifact_id) {
                self.log_memory_write_rejected(
                    &memory_kind,
                    title,
                    Some(&trust_level),
                    &error,
                    json!({"reason": "missing_evidence_artifact", "evidence_artifact_id": artifact_id}),
                );
                return Err(error);
            }
        }
        if let Some(task_id) = task_id {
            if let Err(error) = self.query_one(
                "SELECT id FROM tasks WHERE id=?1",
                &[&task_id],
                "Task does not exist.",
            ) {
                self.log_memory_write_rejected(
                    &memory_kind,
                    title,
                    Some(&trust_level),
                    &error,
                    json!({"reason": "missing_task", "task_id": task_id}),
                );
                return Err(error);
            }
        }
        if let Some(agent_id) = created_by_agent_id.filter(|value| *value != "local") {
            if let Err(error) = self.ensure_agent_exists(agent_id) {
                self.log_memory_write_rejected(
                    &memory_kind,
                    title,
                    Some(&trust_level),
                    &error,
                    json!({"reason": "missing_agent", "agent_id": agent_id}),
                );
                return Err(error);
            }
        }
        if trust_level == "certified"
            && evidence_artifact_id.is_none()
            && !certified_by
                .map(is_trusted_memory_certifier)
                .unwrap_or(false)
        {
            let error = "Certified memory requires an evidence artifact or trusted UI certifier."
                .to_string();
            self.log_memory_write_rejected(
                &memory_kind,
                title,
                Some(&trust_level),
                &error,
                json!({"reason": "certified_memory_missing_evidence"}),
            );
            return Err(error);
        }
        let created_by_slot_id = created_by_agent_id
            .filter(|value| *value != "local")
            .and_then(|agent_id| self.artifact_agent_slot_id(agent_id).ok())
            .flatten();
        let id = uuid();
        let directory = self.paths.memory_root.join(memory_directory(&memory_kind));
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Unable to create memory directory: {error}"))?;
        let filename = format!("{}_{}.md", slug(title), &id[..8]);
        let path = directory.join(filename);
        if !path_text_under_path(&process_path_text(&path), &self.paths.memory_root) {
            return Err("Memory path escapes .agents/memory.".to_string());
        }
        write_text_file_atomic(&path, body)?;
        let summary = body
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .chars()
            .take(280)
            .collect::<String>();
        let now = now_rfc3339();
        let event_type = match memory_kind.as_str() {
            "contract" => "contract_memory_written",
            "handoff" => "handoff_memory_written",
            _ => "memory_written",
        };
        self.begin_immediate_transaction("write memory")?;
        let result = (|| -> Result<(), String> {
            self.conn
                .execute(
                    "INSERT INTO memories(
                        id, memory_kind, trust_level, title, body_path, summary, evidence_artifact_id,
                        task_id, context_run_id, created_by_agent_id, created_by_slot_id,
                        certified_by, created_at, updated_at
                    ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                    params![
                        id,
                        memory_kind,
                        trust_level,
                        title,
                        path.display().to_string(),
                        summary,
                        evidence_artifact_id,
                        task_id,
                        context_run_id,
                        created_by_agent_id,
                        created_by_slot_id.as_deref(),
                        certified_by,
                        now
                    ],
                )
                .map_err(|error| format!("Unable to record memory: {error}"))?;
            self.emit_event(
                event_type,
                "agent",
                created_by_agent_id.unwrap_or("local"),
                EventRefs {
                    task_id: task_id.map(str::to_string),
                    agent_id: created_by_agent_id.map(str::to_string),
                    agent_slot_id: created_by_slot_id.clone(),
                    artifact_id: evidence_artifact_id.map(str::to_string),
                    context_run_id: context_run_id.map(str::to_string),
                    ..EventRefs::default()
                },
                json!({
                    "memory_id": id.clone(),
                    "memory_kind": memory_kind.clone(),
                    "title": title,
                    "trust_level": trust_level.clone(),
                    "body_path": path.display().to_string(),
                    "summary": summary.clone(),
                    "evidence_artifact_id": evidence_artifact_id,
                    "created_by_slot_id": created_by_slot_id.clone(),
                }),
            )?;
            if trust_level == "certified" {
                self.emit_event(
                    "memory_certified",
                    if certified_by.is_some() {
                        "human"
                    } else {
                        "kernel"
                    },
                    certified_by.unwrap_or(REPO_ID),
                    EventRefs {
                        task_id: task_id.map(str::to_string),
                        agent_id: created_by_agent_id.map(str::to_string),
                        agent_slot_id: created_by_slot_id.clone(),
                        artifact_id: evidence_artifact_id.map(str::to_string),
                        context_run_id: context_run_id.map(str::to_string),
                        ..EventRefs::default()
                    },
                    json!({
                        "memory_id": id.clone(),
                        "memory_kind": memory_kind.clone(),
                        "title": title,
                        "evidence_artifact_id": evidence_artifact_id,
                        "certified_by": certified_by,
                    }),
                )?;
            }
            Ok(())
        })();

        if let Err(error) = self.finish_transaction(result, "write memory") {
            let _ = fs::remove_file(&path);
            return Err(error);
        }

        Ok(api_ok(
            json!({"memory_id": id, "memory_kind": memory_kind, "title": title, "body_path": path.display().to_string()}),
        ))
    }

    fn log_memory_write_rejected(
        &self,
        memory_kind: &str,
        title: &str,
        trust_level: Option<&str>,
        error: &str,
        details: Value,
    ) {
        let _ = self.emit_event(
            "memory_write_rejected",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "memory_kind": memory_kind,
                "title": title,
                "trust_level": trust_level,
                "error": error,
                "details": details,
            }),
        );
    }

    pub fn write_contract_memory(&self, input: &Value) -> Result<Value, String> {
        let title = required_string(input, "title")?;
        let contract_name = input["contract_name"].as_str().unwrap_or(title);
        let agent_id = input["created_by_agent_id"]
            .as_str()
            .or_else(|| input["agent_id"].as_str())
            .unwrap_or("local");
        let task_id = input["task_id"].as_str();
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
            "# Contract: {contract_name}\n\nStatus: {}\nVersion: 1\nCreated By Agent: {agent_id}\nTask: {}\nProducer Role: {}\nConsumer Role: {}\nResource Keys:\n{}\n\n## Purpose\n\n{}\n\n## Interface\n\n{}\n\n## Inputs\n\n{}\n\n## Outputs\n\n{}\n\n## Invariants\n\n{}\n\n## Handoff Notes\n\n{}\n\n## Evidence\n\n{}\n\n## Breaking Change Policy\n\n{}\n",
            input["status"].as_str().unwrap_or("draft"),
            task_id.unwrap_or("none"),
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
            None,
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
        let body = format!(
            "# Handoff: {title}\n\nFrom Agent: {from_agent_id}\nFrom Task: {}\nTo Role: {}\nStatus: {}\n\n## Completed\n\n{}\n\n## Needed Next\n\n{}\n\n## Relevant Contracts\n\n{}\n\n## Relevant Resources\n\n{}\n\n## Risks\n\n{}\n\n## Evidence\n\n{}\n",
            from_task_id.unwrap_or("none"),
            input["to_role"].as_str().unwrap_or("unknown"),
            input["status"].as_str().unwrap_or("open"),
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
            None,
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
                    let body_path = PathBuf::from(path);
                    if !path_text_under_path(
                        &process_path_text(&body_path),
                        &self.paths.memory_root,
                    ) {
                        row["snippet"] =
                            Value::String("[memory body path outside memory root]".to_string());
                        continue;
                    }
                    if let Ok(body) = fs::read_to_string(path) {
                        if body.to_ascii_lowercase().contains(&query_lower) {
                            row["snippet"] = Value::String(body.chars().take(360).collect());
                        }
                    }
                }
            }
        }

        self.emit_event(
            "memory_searched",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "query_present": query.map(|value| !value.trim().is_empty()).unwrap_or(false),
                "memory_kind": memory_kind,
                "trust_level": trust_level,
                "result_count": rows.len(),
            }),
        )?;

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

    fn record_approval_gate_log(
        &self,
        approval_id: Option<&str>,
        task_id: Option<&str>,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        action: &str,
        decision: Option<&str>,
        human_actor: Option<&str>,
        status: &str,
        reason: Option<&str>,
        details: Value,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO approval_gate_logs(
                    id, approval_id, task_id, agent_id, session_id, action, decision,
                    human_actor, status, reason, details_json, created_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    uuid(),
                    approval_id,
                    task_id,
                    agent_id,
                    session_id,
                    action,
                    decision,
                    human_actor,
                    status,
                    reason,
                    details.to_string(),
                    now_rfc3339()
                ],
            )
            .map_err(|error| format!("Unable to record approval gate log: {error}"))?;
        Ok(())
    }

    fn record_db_coordination_rejection(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        reason: &str,
        details: Value,
    ) -> Result<(), String> {
        self.emit_event(
            "db_change_request_rejected",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: Some(session_id.to_string()),
                ..EventRefs::default()
            },
            json!({"reason": reason, "details": details}),
        )?;
        Ok(())
    }

    fn find_covering_db_lease(
        &self,
        task_id: &str,
        agent_id: &str,
        session_id: &str,
        resource_key: &str,
        destructive: bool,
    ) -> Result<Option<Value>, String> {
        let active = self.list_active_leases_internal(Some(task_id), Some(agent_id), None)?;
        Ok(active.into_iter().find(|lease| {
            if lease["session_id"].as_str() != Some(session_id) {
                return false;
            }
            let mode = lease["mode"].as_str().unwrap_or_default();
            let allowed = if destructive {
                matches!(mode, "db_destructive" | "db_exclusive")
            } else {
                matches!(
                    mode,
                    "db_plan" | "db_migration" | "db_destructive" | "db_exclusive"
                )
            };
            allowed
                && resource_covers(
                    lease["resource_key"].as_str().unwrap_or_default(),
                    resource_key,
                )
        }))
    }

    pub fn db_request_change(&self, input: &Value) -> Result<Value, String> {
        let policy = self.repo_policy()?;
        let mode = policy["sql_mcp_default"].as_str().unwrap_or("off");
        let task_id = required_string(input, "task_id")?;
        let agent_id = required_string(input, "agent_id")?;
        let session_id = required_string(input, "session_id")?;
        if mode == "off" {
            let _ = self.record_db_coordination_rejection(
                task_id,
                agent_id,
                session_id,
                "sql_mcp_default_off",
                json!({"mode": mode}),
            );
            return Ok(api_error(
                "sql_disabled",
                "Production SQL coordination is disabled for this repo policy.",
                json!({"mode": mode}),
            ));
        }

        let _ = self.ensure_session_active(session_id, agent_id)?;
        self.ensure_session_owns_task(session_id, task_id)?;
        let change_kind = non_empty(
            input["change_kind"].as_str().unwrap_or("other"),
            "DB change kind",
        )?;
        let title = required_string(input, "title")?;
        let summary = required_string(input, "summary")?;
        let resources = input["resources"]
            .as_array()
            .ok_or_else(|| "DB change request requires at least one DB resource.".to_string())?;
        if resources.is_empty() {
            let _ = self.record_db_coordination_rejection(
                task_id,
                agent_id,
                session_id,
                "missing_db_resources",
                json!({"change_kind": change_kind}),
            );
            return Ok(api_error(
                "db_resources_required",
                "DB change request requires at least one DB resource.",
                json!({}),
            ));
        }

        let mut normalized_resources = Vec::new();
        let mut destructive = db_change_kind_destructive(change_kind);
        let mut risk_level = input["risk_level"].as_i64().unwrap_or(3).clamp(1, 5);
        for resource in resources {
            let resource_key = required_string(resource, "resource_key")?;
            let normalized = normalize_resource_key_checked(resource_key)?;
            if !normalized.starts_with("db:") {
                return Err("DB change request resources must use db: resource keys.".to_string());
            }
            let operation = resource["operation"].as_str().unwrap_or("change").trim();
            if matches!(
                operation,
                "drop" | "remove" | "delete" | "destructive" | "rollback" | "truncate"
            ) {
                destructive = true;
            }
            if normalized.contains("tenant_isolation")
                || normalized.contains("security_policy")
                || normalized.contains("auth")
                || normalized.contains("pii")
            {
                risk_level = risk_level.max(5);
            }
            normalized_resources.push(json!({
                "resource_key": normalized,
                "operation": if operation.is_empty() { "change" } else { operation },
            }));
        }
        if destructive {
            risk_level = risk_level.max(4);
        }

        for resource in &normalized_resources {
            let resource_key = resource["resource_key"].as_str().unwrap_or_default();
            if self
                .find_covering_db_lease(task_id, agent_id, session_id, resource_key, destructive)?
                .is_none()
            {
                let _ = self.record_db_coordination_rejection(
                    task_id,
                    agent_id,
                    session_id,
                    "db_lease_required",
                    json!({
                        "resource_key": resource_key,
                        "destructive": destructive,
                        "required_modes": if destructive {
                            json!(["db_destructive", "db_exclusive"])
                        } else {
                            json!(["db_plan", "db_migration", "db_destructive", "db_exclusive"])
                        }
                    }),
                );
                return Ok(api_error(
                    "db_lease_required",
                    "Acquire an active covering DB lease before requesting a production SQL change.",
                    json!({"resource_key": resource_key, "destructive": destructive}),
                ));
            }
        }

        let id = uuid();
        let now = now_rfc3339();
        self.begin_immediate_transaction("request db change")?;
        let result = (|| -> Result<(), String> {
            self.conn
                .execute(
                    "INSERT INTO db_change_requests(
                        id, task_id, requested_by_agent_id, requested_by_session_id,
                        change_kind, title, summary, status, risk_level, destructive,
                        production_impact, rollback_summary, created_at, updated_at
                    ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'requested', ?8, ?9, ?10, ?11, ?12, ?12)",
                    params![
                        id,
                        task_id,
                        agent_id,
                        session_id,
                        change_kind,
                        title,
                        summary,
                        risk_level,
                        bool_i64(destructive),
                        input["production_impact"].as_str(),
                        input["rollback_summary"].as_str(),
                        now
                    ],
                )
                .map_err(|error| format!("Unable to create DB change request: {error}"))?;
            for resource in &normalized_resources {
                let resource_key = resource["resource_key"].as_str().unwrap_or_default();
                let operation = resource["operation"].as_str().unwrap_or("change");
                self.conn
                    .execute(
                        "INSERT INTO db_change_request_resources(
                            id, db_change_request_id, resource_key, resource_type, operation, created_at
                        ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            uuid(),
                            id,
                            resource_key,
                            resource_type(resource_key),
                            operation,
                            now
                        ],
                    )
                    .map_err(|error| format!("Unable to record DB change resource: {error}"))?;
            }
            self.emit_event(
                "db_change_requested",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: Some(session_id.to_string()),
                    ..EventRefs::default()
                },
                json!({
                    "db_change_request_id": id,
                    "change_kind": change_kind,
                    "risk_level": risk_level,
                    "destructive": destructive,
                    "resources": normalized_resources,
                }),
            )?;
            if destructive {
                self.emit_event(
                    "db_change_approval_required",
                    "kernel",
                    REPO_ID,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        agent_id: Some(agent_id.to_string()),
                        session_id: Some(session_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({"db_change_request_id": id, "risk_level": risk_level}),
                )?;
            }
            Ok(())
        })();
        self.finish_transaction(result, "request db change")?;
        Ok(api_ok(json!({
            "db_change_request_id": id,
            "status": "requested",
            "risk_level": risk_level,
            "destructive": destructive,
        })))
    }

    pub fn db_list_change_requests(
        &self,
        status: Option<&str>,
        task_id: Option<&str>,
    ) -> Result<Value, String> {
        let mut sql = "SELECT * FROM db_change_requests WHERE 1=1".to_string();
        let mut values = Vec::new();
        if let Some(status) = status.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND status=?");
            values.push(status.to_string());
        }
        if let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND task_id=?");
            values.push(task_id.to_string());
        }
        sql.push_str(" ORDER BY updated_at DESC LIMIT 200");
        let params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        Ok(api_ok(json!({
            "change_requests": self.query_json(&sql, &params)?,
        })))
    }

    pub fn db_get_change_request(&self, db_change_request_id: &str) -> Result<Value, String> {
        let request = self.query_one(
            "SELECT * FROM db_change_requests WHERE id=?1",
            &[&db_change_request_id],
            "DB change request does not exist.",
        )?;
        let resources = self.query_json(
            "SELECT * FROM db_change_request_resources WHERE db_change_request_id=?1 ORDER BY created_at ASC",
            &[&db_change_request_id],
        )?;
        Ok(api_ok(
            json!({"change_request": request, "resources": resources}),
        ))
    }

    pub fn log_ui_surface_event(&self, input: &Value) -> Result<Value, String> {
        let surface = non_empty(
            input["surface"]
                .as_str()
                .unwrap_or("coordination_workspace"),
            "UI surface",
        )?;
        let action = non_empty(input["action"].as_str().unwrap_or("event"), "UI action")?;
        let status = non_empty(input["status"].as_str().unwrap_or("info"), "UI status")?;
        let command_name = input["command_name"].as_str();
        let actor = input["actor"].as_str().unwrap_or("ui");
        let details = input.get("details").cloned().unwrap_or_else(|| json!({}));
        let id = uuid();
        self.conn
            .execute(
                "INSERT INTO coordination_ui_surface_logs(
                    id, repo_id, surface, action, status, command_name, actor, details_json, created_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    REPO_ID,
                    surface,
                    action,
                    status,
                    command_name,
                    actor,
                    details.to_string(),
                    now_rfc3339()
                ],
            )
            .map_err(|error| format!("Unable to record UI surface log: {error}"))?;
        self.emit_event(
            "ui_surface_logged",
            "ui",
            actor,
            EventRefs::default(),
            json!({
                "ui_surface_log_id": id,
                "surface": surface,
                "action": action,
                "status": status,
                "command_name": command_name,
            }),
        )?;
        Ok(api_ok(json!({"ui_surface_log_id": id, "status": status})))
    }

    pub fn cleanup_bloat_dry_run(&self) -> Result<Value, String> {
        self.cleanup_coordination_bloat(true)
    }

    fn cleanup_coordination_bloat(&self, dry_run: bool) -> Result<Value, String> {
        self.emit_event(
            "coordination_bloat_audit_started",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({"dry_run": dry_run}),
        )?;

        let mut allowed_mcp_paths = HashSet::new();
        for path in [
            self.paths.mcp_root.join("coordination.json"),
            self.paths.mcp_root.join("coordination.codex.toml"),
            self.paths.mcp_root.join("coordination.claude.json"),
        ] {
            allowed_mcp_paths.insert(normalize_path_for_compare(&process_path_text(&path)));
        }

        let slots = self.query_json(
            "SELECT id, slot_key, mcp_config_path FROM agent_slots ORDER BY slot_key ASC",
            &[],
        )?;
        for slot in &slots {
            if let Some(path) = slot["mcp_config_path"].as_str() {
                allowed_mcp_paths.insert(normalize_path_for_compare(path));
            }
            if let Some(slot_key) = slot["slot_key"].as_str() {
                for path in [
                    self.paths
                        .mcp_root
                        .join("agents")
                        .join(format!("{slot_key}.json")),
                    self.paths
                        .mcp_root
                        .join("agents")
                        .join(format!("{slot_key}.codex.toml")),
                    self.paths
                        .mcp_root
                        .join("agents")
                        .join(format!("{slot_key}.claude.json")),
                ] {
                    allowed_mcp_paths.insert(normalize_path_for_compare(&process_path_text(&path)));
                }
            }
        }
        for config in self.query_json("SELECT path FROM mcp_configs ORDER BY path ASC", &[])? {
            if let Some(path) = config["path"].as_str() {
                allowed_mcp_paths.insert(normalize_path_for_compare(path));
            }
        }

        let mut unexpected_mcp_files = Vec::new();
        let mut stale_temp_files = Vec::new();
        for directory in [
            self.paths.mcp_root.clone(),
            self.paths.mcp_root.join("agents"),
        ] {
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let path_text = process_path_text(&path);
                let filename = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string();
                if filename.ends_with(".tmp") || filename.contains(".tmp.") {
                    stale_temp_files.push(json!({"path": path_text, "kind": "mcp_temp_file"}));
                    continue;
                }
                if !allowed_mcp_paths.contains(&normalize_path_for_compare(&path_text)) {
                    unexpected_mcp_files.push(json!({
                        "path": path_text,
                        "kind": "unexpected_mcp_file",
                    }));
                }
            }
        }

        let mut allowed_worktree_paths = HashSet::new();
        for worktree in self.query_json(
            "SELECT path FROM worktrees WHERE path IS NOT NULL AND path<>'' ORDER BY path ASC",
            &[],
        )? {
            if let Some(path) = worktree["path"].as_str() {
                allowed_worktree_paths.insert(normalize_path_for_compare(path));
            }
        }
        for slot in &slots {
            if let Some(slot_key) = slot["slot_key"].as_str() {
                let path = self.paths.worktrees_root.join(slot_key);
                allowed_worktree_paths
                    .insert(normalize_path_for_compare(&process_path_text(&path)));
            }
        }

        let mut unexpected_worktree_dirs = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.paths.worktrees_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let path_text = process_path_text(&path);
                if !allowed_worktree_paths.contains(&normalize_path_for_compare(&path_text)) {
                    unexpected_worktree_dirs.push(json!({
                        "path": path_text,
                        "kind": "unexpected_worktree_dir",
                    }));
                }
            }
        }

        let unexpected_mcp_file_count = unexpected_mcp_files.len();
        let unexpected_worktree_dir_count = unexpected_worktree_dirs.len();
        let stale_temp_file_count = stale_temp_files.len();
        let status = if unexpected_mcp_file_count == 0
            && unexpected_worktree_dir_count == 0
            && stale_temp_file_count == 0
        {
            "clean"
        } else {
            "attention_required"
        };
        let details = json!({
            "dry_run": dry_run,
            "allowed_mcp_path_count": allowed_mcp_paths.len(),
            "allowed_worktree_path_count": allowed_worktree_paths.len(),
            "unexpected_mcp_files": unexpected_mcp_files,
            "unexpected_worktree_dirs": unexpected_worktree_dirs,
            "stale_temp_files": stale_temp_files,
            "destructive_cleanup_performed": false,
            "destructive_cleanup_note": "This audit is non-destructive; unknown MCP files and worktrees are never deleted automatically.",
        });
        let audit_id = uuid();
        self.conn
            .execute(
                "INSERT INTO coordination_bloat_audits(
                    id, repo_id, dry_run, status, unexpected_mcp_file_count,
                    unexpected_worktree_dir_count, stale_temp_file_count, details_json, created_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    audit_id,
                    REPO_ID,
                    bool_i64(dry_run),
                    status,
                    unexpected_mcp_file_count as i64,
                    unexpected_worktree_dir_count as i64,
                    stale_temp_file_count as i64,
                    details.to_string(),
                    now_rfc3339()
                ],
            )
            .map_err(|error| format!("Unable to record coordination bloat audit: {error}"))?;
        self.emit_event(
            "coordination_bloat_audit_finished",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "audit_id": audit_id,
                "status": status,
                "dry_run": dry_run,
                "unexpected_mcp_file_count": unexpected_mcp_file_count,
                "unexpected_worktree_dir_count": unexpected_worktree_dir_count,
                "stale_temp_file_count": stale_temp_file_count,
            }),
        )?;
        Ok(api_ok(json!({
            "audit_id": audit_id,
            "status": status,
            "dry_run": dry_run,
            "unexpected_mcp_files": details["unexpected_mcp_files"].clone(),
            "unexpected_worktree_dirs": details["unexpected_worktree_dirs"].clone(),
            "stale_temp_files": details["stale_temp_files"].clone(),
            "destructive_cleanup_performed": false,
        })))
    }

    pub fn db_request_approval(
        &self,
        db_change_request_id: &str,
        agent_id: &str,
        session_id: Option<&str>,
        reason: Option<&str>,
        risk_summary: Option<&str>,
    ) -> Result<Value, String> {
        let request = self.query_one(
            "SELECT * FROM db_change_requests WHERE id=?1",
            &[&db_change_request_id],
            "DB change request does not exist.",
        )?;
        let task_id = request["task_id"].as_str().unwrap_or_default();
        let approval = self.request_approval(
            task_id,
            agent_id,
            session_id,
            "production_sql_change",
            reason.unwrap_or("Review and approve production SQL coordination request."),
            risk_summary.or_else(|| request["summary"].as_str()),
        )?;
        let approval_id = approval["data"]["approval_id"]
            .as_str()
            .ok_or_else(|| "Approval request did not return an approval_id.".to_string())?;
        self.conn
            .execute(
                "UPDATE db_change_requests
                 SET approval_id=?1, status='review_requested', updated_at=?2
                 WHERE id=?3",
                params![approval_id, now_rfc3339(), db_change_request_id],
            )
            .map_err(|error| format!("Unable to link DB approval request: {error}"))?;
        self.emit_event(
            "db_change_review_requested",
            "agent",
            agent_id,
            EventRefs {
                task_id: Some(task_id.to_string()),
                agent_id: Some(agent_id.to_string()),
                session_id: session_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "db_change_request_id": db_change_request_id,
                "approval_id": approval_id,
                "reused": approval["data"]["reused"].as_bool().unwrap_or(false),
            }),
        )?;
        Ok(api_ok(json!({
            "db_change_request_id": db_change_request_id,
            "approval_id": approval_id,
            "status": "review_requested",
        })))
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
            let _ = self.record_db_coordination_rejection(
                task_id,
                agent_id,
                session_id,
                "db_migration_stream_lease_required",
                json!({"resource_key": migration_resource}),
            );
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
        let change_request_id = uuid();
        let change_kind = if classification.destructive {
            "rollback"
        } else {
            "other"
        };
        self.conn
            .execute(
                "INSERT INTO db_change_requests(
                    id, task_id, requested_by_agent_id, requested_by_session_id,
                    change_kind, title, summary, status, risk_level, destructive,
                    production_impact, rollback_summary, migration_id, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'migration_attached', ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![
                    change_request_id,
                    task_id,
                    agent_id,
                    session_id,
                    change_kind,
                    migration_name,
                    summary.unwrap_or("Production SQL migration proposal."),
                    classification.risk_level,
                    bool_i64(classification.destructive),
                    "Migration proposal only; this MCP does not execute production SQL.",
                    "See migration proposal artifact for rollback or roll-forward text.",
                    migration_id,
                    now
                ],
            )
            .map_err(|error| format!("Unable to record DB change request for migration proposal: {error}"))?;
        self.conn
            .execute(
                "INSERT INTO db_change_request_resources(
                    id, db_change_request_id, resource_key, resource_type, operation, created_at
                ) VALUES(?1, ?2, ?3, ?4, 'migrate', ?5)",
                params![
                    uuid(),
                    change_request_id,
                    migration_resource,
                    resource_type(migration_resource),
                    now
                ],
            )
            .map_err(|error| format!("Unable to record migration DB resource: {error}"))?;
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
            json!({
                "migration_id": migration_id,
                "db_change_request_id": change_request_id,
                "migration_name": migration_name,
                "classification": classification.classification,
                "risk_level": classification.risk_level,
                "destructive": classification.destructive,
            }),
        )?;

        Ok(api_ok(
            json!({"migration_id": migration_id, "db_change_request_id": change_request_id, "artifact_id": artifact_id, "status": "draft"}),
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
        session_id: Option<&str>,
        approval_kind: &str,
        reason: &str,
        risk_summary: Option<&str>,
    ) -> Result<Value, String> {
        let task = self.query_one(
            "SELECT * FROM tasks WHERE id=?1",
            &[&task_id],
            "Task does not exist.",
        )?;
        if agent_id != "local" {
            self.ensure_agent_exists(agent_id)?;
            if let Some(session_id) = session_id {
                let _ = self.ensure_session_active(session_id, agent_id)?;
                if let Err(error) = self.ensure_session_owns_task(session_id, task_id) {
                    let _ = self.record_approval_gate_log(
                        None,
                        Some(task_id),
                        Some(agent_id),
                        Some(session_id),
                        "request",
                        None,
                        None,
                        "rejected",
                        Some(&error),
                        json!({"approval_kind": approval_kind}),
                    );
                    let _ = self.emit_event(
                        "approval_request_rejected",
                        "agent",
                        agent_id,
                        EventRefs {
                            task_id: Some(task_id.to_string()),
                            agent_id: Some(agent_id.to_string()),
                            session_id: Some(session_id.to_string()),
                            ..EventRefs::default()
                        },
                        json!({"approval_kind": approval_kind, "reason": error}),
                    );
                    return Err(error);
                }
            } else if task["claimed_by_agent_id"].as_str() != Some(agent_id) {
                let reason = "Approval requests from agents require a task claimed by that agent.";
                let _ = self.record_approval_gate_log(
                    None,
                    Some(task_id),
                    Some(agent_id),
                    None,
                    "request",
                    None,
                    None,
                    "rejected",
                    Some(reason),
                    json!({"approval_kind": approval_kind}),
                );
                let _ = self.emit_event(
                    "approval_request_rejected",
                    "agent",
                    agent_id,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        agent_id: Some(agent_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({"approval_kind": approval_kind, "reason": reason}),
                );
                return Err(reason.to_string());
            }
        }
        let approval_kind = non_empty(approval_kind, "Approval kind")?;
        let reason = non_empty(reason, "Approval reason")?;
        if let Some(existing) = self
            .query_json(
                "SELECT * FROM approvals
                 WHERE task_id=?1 AND requested_by_agent_id=?2 AND approval_kind=?3 AND status='pending'
                 ORDER BY created_at DESC
                 LIMIT 1",
                &[&task_id, &agent_id, &approval_kind],
            )?
            .into_iter()
            .next()
        {
            let existing_id = existing["id"].as_str().unwrap_or_default();
            self.record_approval_gate_log(
                Some(existing_id),
                Some(task_id),
                Some(agent_id),
                session_id,
                "request",
                None,
                None,
                "reused",
                Some("Existing pending approval request reused."),
                json!({"approval_kind": approval_kind}),
            )?;
            self.emit_event(
                "approval_request_reused",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: session_id.map(str::to_string),
                    ..EventRefs::default()
                },
                json!({"approval_id": existing_id, "approval_kind": approval_kind}),
            )?;
            return Ok(api_ok_warnings(
                json!({"approval_id": existing["id"], "status": "pending", "reused": true}),
                vec!["Existing pending approval request reused.".to_string()],
            ));
        }
        let id = uuid();
        self.begin_immediate_transaction("request approval")?;
        let result = (|| -> Result<(), String> {
            self.conn
                .execute(
                    "INSERT INTO approvals(id, task_id, requested_by_agent_id, approval_kind, status, reason, risk_summary, created_at)
                     VALUES(?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7)",
                    params![id, task_id, agent_id, approval_kind, reason, risk_summary, now_rfc3339()],
                )
                .map_err(|error| format!("Unable to create approval request: {error}"))?;
            self.record_approval_gate_log(
                Some(&id),
                Some(task_id),
                Some(agent_id),
                session_id,
                "request",
                None,
                None,
                "pending",
                Some(reason),
                json!({"approval_kind": approval_kind, "risk_summary": risk_summary}),
            )?;
            self.emit_event(
                "approval_requested",
                "agent",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: session_id.map(str::to_string),
                    ..EventRefs::default()
                },
                json!({"approval_id": id, "approval_kind": approval_kind, "reason": reason, "risk_summary": risk_summary}),
            )?;
            Ok(())
        })();
        self.finish_transaction(result, "request approval")?;
        Ok(api_ok(json!({"approval_id": id, "status": "pending"})))
    }

    pub fn resolve_approval(
        &self,
        approval_id: &str,
        decision: &str,
        human_actor: &str,
        reason: Option<&str>,
    ) -> Result<Value, String> {
        let human_actor = non_empty(human_actor, "Human actor")?;
        if !is_trusted_memory_certifier(human_actor) {
            let _ = self.record_approval_gate_log(
                Some(approval_id),
                None,
                None,
                None,
                "resolve",
                Some(decision),
                Some(human_actor),
                "rejected",
                Some("Approval decisions require a trusted local UI/human actor."),
                json!({}),
            );
            let _ = self.emit_event(
                "approval_resolution_rejected",
                "agent",
                human_actor,
                EventRefs::default(),
                json!({"approval_id": approval_id, "decision": decision, "reason": "untrusted_actor"}),
            );
            return Err("Approval decisions require a trusted local UI/human actor.".to_string());
        }
        let status = match decision.trim().to_ascii_lowercase().as_str() {
            "approve" | "approved" | "grant" | "granted" => "approved",
            "deny" | "denied" | "reject" | "rejected" => "denied",
            _ => return Err("Approval decision must be approved or denied.".to_string()),
        };
        let approval = self.query_one(
            "SELECT * FROM approvals WHERE id=?1",
            &[&approval_id],
            "Approval request does not exist.",
        )?;
        if approval["status"].as_str() != Some("pending") {
            self.record_approval_gate_log(
                Some(approval_id),
                approval["task_id"].as_str(),
                approval["requested_by_agent_id"].as_str(),
                None,
                "resolve",
                Some(status),
                Some(human_actor),
                "rejected",
                Some("Only pending approval requests can be resolved."),
                json!({"existing_status": approval["status"].clone()}),
            )?;
            self.emit_event(
                "approval_resolution_rejected",
                "user",
                human_actor,
                EventRefs {
                    task_id: approval["task_id"].as_str().map(str::to_string),
                    agent_id: approval["requested_by_agent_id"]
                        .as_str()
                        .map(str::to_string),
                    ..EventRefs::default()
                },
                json!({"approval_id": approval_id, "decision": status, "reason": "not_pending"}),
            )?;
            return Err("Only pending approval requests can be resolved.".to_string());
        }
        self.begin_immediate_transaction("resolve approval")?;
        let result = (|| -> Result<(), String> {
            self.conn
                .execute(
                    "UPDATE approvals
                     SET status=?1, approved_by=?2, resolved_at=?3
                     WHERE id=?4 AND status='pending'",
                    params![status, human_actor, now_rfc3339(), approval_id],
                )
                .map_err(|error| format!("Unable to resolve approval: {error}"))?;
            self.record_approval_gate_log(
                Some(approval_id),
                approval["task_id"].as_str(),
                approval["requested_by_agent_id"].as_str(),
                None,
                "resolve",
                Some(status),
                Some(human_actor),
                status,
                reason,
                json!({}),
            )?;
            let db_status = if status == "approved" {
                "approved"
            } else {
                "rejected"
            };
            let linked_db_requests = self.query_json(
                "SELECT * FROM db_change_requests WHERE approval_id=?1",
                &[&approval_id],
            )?;
            if !linked_db_requests.is_empty() {
                self.conn
                    .execute(
                        "UPDATE db_change_requests SET status=?1, updated_at=?2 WHERE approval_id=?3",
                        params![db_status, now_rfc3339(), approval_id],
                    )
                    .map_err(|error| format!("Unable to update DB change approval status: {error}"))?;
                for request in linked_db_requests {
                    self.emit_event(
                        if status == "approved" {
                            "db_change_approved"
                        } else {
                            "db_change_rejected"
                        },
                        "user",
                        human_actor,
                        EventRefs {
                            task_id: request["task_id"].as_str().map(str::to_string),
                            agent_id: request["requested_by_agent_id"]
                                .as_str()
                                .map(str::to_string),
                            session_id: request["requested_by_session_id"]
                                .as_str()
                                .map(str::to_string),
                            ..EventRefs::default()
                        },
                        json!({
                            "db_change_request_id": request["id"],
                            "approval_id": approval_id,
                            "status": db_status,
                            "reason": reason,
                        }),
                    )?;
                }
            }
            self.emit_event(
                if status == "approved" {
                    "approval_granted"
                } else {
                    "approval_denied"
                },
                "user",
                human_actor,
                EventRefs {
                    task_id: approval["task_id"].as_str().map(str::to_string),
                    agent_id: approval["requested_by_agent_id"]
                        .as_str()
                        .map(str::to_string),
                    ..EventRefs::default()
                },
                json!({"approval_id": approval_id, "status": status, "reason": reason}),
            )?;
            Ok(())
        })();
        self.finish_transaction(result, "resolve approval")?;
        Ok(api_ok(
            json!({"approval_id": approval_id, "status": status}),
        ))
    }

    pub fn get_brief(
        &self,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        task_id: Option<&str>,
        context_run_id: Option<&str>,
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
            "task_dependencies": if let Some(task_id) = task_id { self.list_task_dependencies(Some(task_id))?["data"].clone() } else { Value::Null },
            "active_leases": self.list_active_leases_internal(task_id, agent_id, None)?,
            "repo_policy": self.repo_policy()?,
            "pending_approvals": if let Some(task_id) = task_id { self.query_json("SELECT * FROM approvals WHERE task_id=?1 AND status='pending' ORDER BY created_at DESC", &[&task_id])? } else { Vec::new() },
            "db_change_requests": if let Some(task_id) = task_id { self.query_json("SELECT * FROM db_change_requests WHERE task_id=?1 ORDER BY updated_at DESC", &[&task_id])? } else { Vec::new() },
            "workspace_changes": self.list_workspace_changes(task_id, agent_id, session_id, None, None, Some(100))?["data"]["changes"].clone(),
            "open_workspace_violations": self.list_workspace_violations(task_id, agent_id, session_id, None, Some("open"))?["data"]["violations"].clone(),
            "recent_events": self.query_json("SELECT * FROM events ORDER BY seq DESC LIMIT 50", &[])?,
            "contract_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='contract' ORDER BY updated_at DESC LIMIT 20", &[])?,
            "handoff_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='handoff' ORDER BY updated_at DESC LIMIT 20", &[])?,
        })))
    }

    pub fn get_snapshot(&self) -> Result<Value, String> {
        Ok(api_ok(json!({
            "tasks": self.query_json("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT 200", &[])?,
            "task_dependencies": self.list_task_dependencies(None)?["data"]["dependencies"].clone(),
            "agent_slots": self.query_json("SELECT * FROM agent_slots ORDER BY slot_key ASC LIMIT 200", &[])?,
            "mcp_configs": self.query_json("SELECT * FROM mcp_configs ORDER BY updated_at DESC LIMIT 200", &[])?,
            "mcp_health_events": self.query_json("SELECT * FROM events WHERE event_type='mcp_health_checked' ORDER BY seq DESC LIMIT 50", &[])?,
            "mcp_client_mounts": self.mcp_client_mount_summary()?,
            "sessions": self.query_json("SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 200", &[])?,
            "resources": self.query_json("SELECT * FROM resources ORDER BY updated_at DESC LIMIT 200", &[])?,
            "active_leases": self.list_active_leases_internal(None, None, None)?,
            "events": self.query_json("SELECT * FROM events ORDER BY seq DESC LIMIT 200", &[])?,
            "worktrees": self.query_json("SELECT * FROM worktrees ORDER BY updated_at DESC LIMIT 200", &[])?,
            "file_watchers": self.query_json("SELECT * FROM file_watchers ORDER BY updated_at DESC LIMIT 50", &[])?,
            "workspace_changes": self.query_json("SELECT * FROM workspace_changes ORDER BY created_at DESC LIMIT 200", &[])?,
            "open_workspace_violations": self.query_json("SELECT * FROM workspace_violations WHERE status='open' ORDER BY created_at DESC LIMIT 200", &[])?,
            "patch_validations": self.query_json("SELECT * FROM patch_validations ORDER BY updated_at DESC LIMIT 200", &[])?,
            "patches": self.query_json(
                "SELECT p.*, v.status AS validation_status
                 FROM patches p
                 LEFT JOIN patch_validations v ON v.id = p.validation_id
                 ORDER BY p.updated_at DESC LIMIT 200",
                &[],
            )?,
            "merge_jobs": self.query_json(
                "SELECT m.*, mrt.resolution_task_id, mrt.resolver_agent_id, mrt.resolver_session_id,
                        mrt.resolved_patch_id,
                        mrt.resolver_worktree_id, mrt.status AS resolution_status
                 FROM merge_jobs m
                 LEFT JOIN merge_resolution_tasks mrt ON mrt.merge_job_id=m.id
                 ORDER BY m.updated_at DESC LIMIT 200",
                &[],
            )?,
            "merge_resolution_tasks": self.query_json("SELECT * FROM merge_resolution_tasks ORDER BY updated_at DESC LIMIT 200", &[])?,
            "artifacts": self.query_json("SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 200", &[])?,
            "artifact_storage_logs": self.query_json("SELECT * FROM artifact_storage_logs ORDER BY created_at DESC LIMIT 200", &[])?,
            "approvals": self.query_json("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200", &[])?,
            "approval_gate_logs": self.query_json("SELECT * FROM approval_gate_logs ORDER BY created_at DESC LIMIT 200", &[])?,
            "repo_policy": self.repo_policy()?,
            "sql_policy": self.db_get_mode()?["data"].clone(),
            "db_change_requests": self.query_json("SELECT * FROM db_change_requests ORDER BY updated_at DESC LIMIT 200", &[])?,
            "db_change_request_resources": self.query_json("SELECT * FROM db_change_request_resources ORDER BY created_at DESC LIMIT 200", &[])?,
            "db_migrations": self.query_json("SELECT * FROM db_migrations ORDER BY updated_at DESC LIMIT 200", &[])?,
            "ui_surface_logs": self.query_json("SELECT * FROM coordination_ui_surface_logs ORDER BY created_at DESC LIMIT 200", &[])?,
            "bloat_audits": self.query_json("SELECT * FROM coordination_bloat_audits ORDER BY created_at DESC LIMIT 50", &[])?,
            "memories": self.query_json("SELECT id, memory_kind, trust_level, title, summary, task_id, context_run_id, created_at, updated_at FROM memories ORDER BY updated_at DESC LIMIT 200", &[])?,
            "contract_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='contract' ORDER BY updated_at DESC LIMIT 100", &[])?,
            "handoff_memories": self.query_json("SELECT * FROM memories WHERE memory_kind='handoff' ORDER BY updated_at DESC LIMIT 100", &[])?,
        })))
    }

    pub fn get_alignment_report(&self) -> Result<Value, String> {
        let context = "vault_debug";
        let mut checks = Vec::new();
        let policy = self.repo_policy()?;
        let sessions = self.query_json(
            "SELECT * FROM agent_sessions WHERE status='active' ORDER BY updated_at DESC LIMIT 200",
            &[],
        )?;
        let worktrees = self.query_json(
            "SELECT * FROM worktrees ORDER BY updated_at DESC LIMIT 200",
            &[],
        )?;
        let active_watcher_targets = self.active_file_watcher_targets()?;
        let file_watchers = self.query_json(
            "SELECT * FROM file_watchers ORDER BY updated_at DESC LIMIT 50",
            &[],
        )?;
        let file_watcher_events = self.query_json(
            "SELECT * FROM events WHERE event_type LIKE 'file_watcher_%' ORDER BY seq DESC LIMIT 200",
            &[],
        )?;
        let resources = self.query_json(
            "SELECT * FROM resources ORDER BY updated_at DESC LIMIT 500",
            &[],
        )?;
        let artifacts = self.query_json(
            "SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let artifact_storage_logs = self.query_json(
            "SELECT * FROM artifact_storage_logs ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let artifact_storage_events = self.query_json(
            "SELECT * FROM events WHERE event_type IN ('artifact_stored', 'artifact_storage_logged', 'artifact_storage_reused', 'artifact_storage_failed') ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let memories = self.query_json(
            "SELECT * FROM memories ORDER BY updated_at DESC LIMIT 500",
            &[],
        )?;
        let memory_events = self.query_json(
            "SELECT * FROM events WHERE event_type IN ('memory_written', 'contract_memory_written', 'handoff_memory_written', 'memory_certified', 'memory_write_rejected', 'memory_searched') ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let lease_conflict_rows = self.query_json(
            "SELECT * FROM lease_conflicts ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let lease_conflict_detector_events = self.query_json(
            "SELECT * FROM events WHERE event_type='lease_conflict_detected' ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let open_violations = self.query_json(
            "SELECT * FROM workspace_violations WHERE status='open' ORDER BY created_at DESC LIMIT 200",
            &[],
        )?;
        let all_workspace_violations = self.query_json(
            "SELECT * FROM workspace_violations ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let workspace_resolution_events = self.query_json(
            "SELECT * FROM events WHERE event_type IN ('workspace_violation_resolved', 'workspace_violation_resolution_rejected') ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let workspace_changes = self.query_json(
            "SELECT * FROM workspace_changes ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let file_changed_events = self.query_json(
            "SELECT * FROM events WHERE event_type='file_changed' ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let change_scan_events = self.query_json(
            "SELECT * FROM events WHERE event_type IN ('change_scan_started', 'change_scan_finished') ORDER BY seq DESC LIMIT 100",
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
        let task_dependencies = self.list_task_dependencies(None)?["data"]["dependencies"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let approvals = self.query_json(
            "SELECT * FROM approvals ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let approval_gate_logs = self.query_json(
            "SELECT * FROM approval_gate_logs ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let approval_events = self.query_json(
            "SELECT * FROM events WHERE event_type IN ('approval_requested', 'approval_request_reused', 'approval_request_rejected', 'approval_granted', 'approval_denied', 'approval_resolution_rejected', 'db_change_approval_required') ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let db_change_requests = self.query_json(
            "SELECT * FROM db_change_requests ORDER BY updated_at DESC LIMIT 500",
            &[],
        )?;
        let db_change_request_resources = self.query_json(
            "SELECT * FROM db_change_request_resources ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let db_migrations = self.query_json(
            "SELECT * FROM db_migrations ORDER BY updated_at DESC LIMIT 500",
            &[],
        )?;
        let db_coordination_events = self.query_json(
            "SELECT * FROM events WHERE event_type IN ('db_change_requested', 'db_change_request_rejected', 'db_migration_proposed', 'db_change_approval_required') ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let ui_surface_logs = self.query_json(
            "SELECT * FROM coordination_ui_surface_logs ORDER BY created_at DESC LIMIT 500",
            &[],
        )?;
        let ui_surface_events = self.query_json(
            "SELECT * FROM events WHERE event_type='ui_surface_logged' ORDER BY seq DESC LIMIT 500",
            &[],
        )?;
        let bloat_audits = self.query_json(
            "SELECT * FROM coordination_bloat_audits ORDER BY created_at DESC LIMIT 100",
            &[],
        )?;
        let bloat_events = self.query_json(
            "SELECT * FROM events WHERE event_type IN ('coordination_bloat_audit_started', 'coordination_bloat_audit_finished') ORDER BY seq DESC LIMIT 200",
            &[],
        )?;
        let mcp_health_events = self.query_json(
            "SELECT * FROM events WHERE event_type='mcp_health_checked' ORDER BY seq DESC LIMIT 50",
            &[],
        )?;
        let mcp_client_mounts = self.mcp_client_mount_summary()?;
        let task_ids = self
            .query_json("SELECT id FROM tasks", &[])?
            .into_iter()
            .filter_map(|task| task["id"].as_str().map(str::to_string))
            .collect::<HashSet<_>>();

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
        let mcp_tools = crate::coordination::mcp::TOOL_NAMES;
        let request_merge_listed = mcp_tools.contains(&"request_merge");
        let violation_resolver_listed = mcp_tools.contains(&"resolve_workspace_violation");
        let apply_merge_listed = mcp_tools.contains(&"apply_merge");
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "mcp.agent_tool_surface",
            if !request_merge_listed && !violation_resolver_listed && !apply_merge_listed {
                "aligned"
            } else {
                "violation"
            },
            if request_merge_listed {
                "request_merge is exposed to agents; merge/resolution initialization must remain trusted UI/kernel-only."
            } else if violation_resolver_listed {
                "resolve_workspace_violation is exposed to agents; violation resolution must remain trusted UI/human-only."
            } else if apply_merge_listed {
                "apply_merge is exposed to agents; merge application must remain trusted UI/human-only."
            } else {
                "Agent MCP exposes submit_patch only; merge resolution initialization, violation resolution, and merge application stay off the agent surface."
            },
            json!({
                "request_merge_listed": request_merge_listed,
                "resolve_workspace_violation_listed": violation_resolver_listed,
                "apply_merge_listed": apply_merge_listed,
                "tool_count": mcp_tools.len(),
            }),
        );
        let latest_mcp_health = mcp_health_events.first();
        let latest_mcp_health_payload = latest_mcp_health
            .map(|event| event["payload_json"].clone())
            .unwrap_or(Value::Null);
        let latest_mcp_health_status = latest_mcp_health_payload["health"]["status"]
            .as_str()
            .unwrap_or("missing");
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "mcp.always_on_runtime_health",
            if latest_mcp_health_status == "healthy" {
                "aligned"
            } else {
                "warning"
            },
            if latest_mcp_health.is_none() {
                "No MCP runtime health check has been recorded yet; open the MCP workspace view or run the workspace MCP status check."
            } else if latest_mcp_health_status == "healthy" {
                "Always-on coordination MCP config was generated and the local stdio server responded to initialize plus tools/list."
            } else {
                "Always-on coordination MCP config exists, but the latest runtime probe did not prove a healthy stdio server."
            },
            json!({
                "health_event_count": mcp_health_events.len(),
                "latest_health": latest_mcp_health_payload,
            }),
        );
        let mcp_client_mount_status = mcp_client_mounts["status"].as_str().unwrap_or("not_seen");
        let active_mcp_session_count = mcp_client_mounts["active_session_count"]
            .as_u64()
            .unwrap_or(0);
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "mcp.agent_client_mount",
            if active_mcp_session_count == 0 || mcp_client_mount_status == "confirmed" {
                "aligned"
            } else {
                "warning"
            },
            if active_mcp_session_count == 0 {
                "No active agent sessions need agent-client MCP mount proof."
            } else if mcp_client_mount_status == "confirmed" {
                "Every active agent session has agent-scoped MCP tools/list or tool-call evidence."
            } else if mcp_client_mount_status == "partial" {
                "Some active agent sessions have MCP mount evidence, but at least one active session has not listed or called tools yet."
            } else if mcp_client_mount_status == "initialized_only" {
                "An agent-scoped MCP client initialized, but no tools/list or tool-call proof has been logged yet."
            } else if mcp_client_mount_status == "server_started_only" {
                "An agent-scoped MCP server process started, but client initialize/tools-list evidence has not been logged yet."
            } else {
                "Active agent sessions exist, but no agent-scoped MCP client mount events have been recorded."
            },
            json!({
                "mount_status": mcp_client_mount_status,
                "active_session_count": active_mcp_session_count,
                "confirmed_session_count": mcp_client_mounts["confirmed_session_count"].clone(),
                "initialized_session_count": mcp_client_mounts["initialized_session_count"].clone(),
                "server_started_only_count": mcp_client_mounts["server_started_only_count"].clone(),
                "event_count": mcp_client_mounts["event_count"].clone(),
                "mounts": mcp_client_mounts["mounts"].clone(),
            }),
        );
        let unknown_resource_count = resources
            .iter()
            .filter(|resource| {
                resource["resource_type"].as_str() == Some("unknown")
                    || !resource["resource_key"]
                        .as_str()
                        .unwrap_or_default()
                        .contains(':')
            })
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "resources.registry_integrity",
            if unknown_resource_count > 0 {
                "violation"
            } else {
                "aligned"
            },
            if unknown_resource_count > 0 {
                "Resource registry contains unknown or untyped resources, so leases may be bypassed by key variants."
            } else {
                "Resource registry contains normalized typed resource keys."
            },
            json!({
                "resource_count": resources.len(),
                "unknown_resource_count": unknown_resource_count,
            }),
        );

        let logged_artifact_ids = artifact_storage_logs
            .iter()
            .filter_map(|log| log["artifact_id"].as_str())
            .collect::<HashSet<_>>();
        let mut artifact_missing_file_count = 0usize;
        let mut artifact_path_escape_count = 0usize;
        let mut artifact_hash_mismatch_count = 0usize;
        for artifact in &artifacts {
            let path = artifact["path"].as_str().unwrap_or_default();
            if !path_text_under_path(path, &self.paths.artifacts_root) {
                artifact_path_escape_count += 1;
                continue;
            }
            let path = PathBuf::from(path);
            if !path.exists() {
                artifact_missing_file_count += 1;
                continue;
            }
            match fs::read(&path) {
                Ok(bytes) => {
                    if artifact["content_hash"].as_str().unwrap_or_default() != sha256_hex(&bytes) {
                        artifact_hash_mismatch_count += 1;
                    }
                }
                Err(_) => artifact_missing_file_count += 1,
            }
        }
        let artifact_missing_log_count = artifacts
            .iter()
            .filter(|artifact| {
                artifact["id"]
                    .as_str()
                    .map(|id| !logged_artifact_ids.contains(id))
                    .unwrap_or(true)
            })
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "artifact_storage.integrity",
            if artifact_path_escape_count > 0
                || artifact_missing_file_count > 0
                || artifact_hash_mismatch_count > 0
            {
                "violation"
            } else {
                "aligned"
            },
            if artifact_path_escape_count > 0 {
                "One or more artifact rows point outside .agents/artifacts."
            } else if artifact_missing_file_count > 0 {
                "One or more artifact rows point at missing or unreadable files."
            } else if artifact_hash_mismatch_count > 0 {
                "One or more artifact files no longer match their stored content hashes."
            } else {
                "Artifact rows point at rooted files with matching content hashes."
            },
            json!({
                "artifact_count": artifacts.len(),
                "path_escape_count": artifact_path_escape_count,
                "missing_file_count": artifact_missing_file_count,
                "hash_mismatch_count": artifact_hash_mismatch_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "artifact_storage.logs",
            if artifact_missing_log_count > 0 {
                "warning"
            } else {
                "aligned"
            },
            if artifact_missing_log_count > 0 {
                "Some artifact rows do not have artifact_storage_logs; newer writes include durable storage audit evidence."
            } else {
                "Artifact storage attempts are represented in durable artifact_storage_logs and append-only events."
            },
            json!({
                "artifact_count": artifacts.len(),
                "artifact_storage_log_count": artifact_storage_logs.len(),
                "artifact_storage_event_count": artifact_storage_events.len(),
                "artifact_missing_log_count": artifact_missing_log_count,
            }),
        );

        let mut memory_body_missing_count = 0usize;
        let mut memory_body_escape_count = 0usize;
        let mut certified_without_evidence_count = 0usize;
        let mut memory_evidence_missing_count = 0usize;
        for memory in &memories {
            let body_path = memory["body_path"].as_str().unwrap_or_default();
            if !path_text_under_path(body_path, &self.paths.memory_root) {
                memory_body_escape_count += 1;
            } else if !PathBuf::from(body_path).exists() {
                memory_body_missing_count += 1;
            }

            let trust_level = memory["trust_level"].as_str().unwrap_or_default();
            let evidence_artifact_id = memory["evidence_artifact_id"]
                .as_str()
                .filter(|value| !value.trim().is_empty());
            let certified_by = memory["certified_by"]
                .as_str()
                .filter(|value| !value.trim().is_empty());
            if trust_level == "certified" {
                if evidence_artifact_id.is_none()
                    && !certified_by
                        .map(is_trusted_memory_certifier)
                        .unwrap_or(false)
                {
                    certified_without_evidence_count += 1;
                }
                if let Some(artifact_id) = evidence_artifact_id {
                    if self.get_artifact(artifact_id).is_err() {
                        memory_evidence_missing_count += 1;
                    }
                }
            }
        }
        let memory_write_event_count = memory_events
            .iter()
            .filter(|event| {
                matches!(
                    event["event_type"].as_str(),
                    Some("memory_written" | "contract_memory_written" | "handoff_memory_written")
                )
            })
            .count();
        let memory_missing_event_count = memories.len().saturating_sub(memory_write_event_count);
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "memory.body_files",
            if memory_body_escape_count > 0 || memory_body_missing_count > 0 {
                "violation"
            } else {
                "aligned"
            },
            if memory_body_escape_count > 0 {
                "One or more memory rows point outside .agents/memory."
            } else if memory_body_missing_count > 0 {
                "One or more memory body markdown files are missing."
            } else {
                "Coordination memory rows point at rooted markdown body files."
            },
            json!({
                "memory_count": memories.len(),
                "body_escape_count": memory_body_escape_count,
                "body_missing_count": memory_body_missing_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "memory.certification",
            if certified_without_evidence_count > 0 || memory_evidence_missing_count > 0 {
                "violation"
            } else {
                "aligned"
            },
            if certified_without_evidence_count > 0 {
                "Certified memory exists without evidence artifact or trusted certifier."
            } else if memory_evidence_missing_count > 0 {
                "Certified memory references missing evidence artifacts."
            } else {
                "Certified memory has evidence artifacts or trusted certifier attribution."
            },
            json!({
                "certified_without_evidence_count": certified_without_evidence_count,
                "missing_evidence_artifact_count": memory_evidence_missing_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "memory.logs",
            if memory_missing_event_count > 0 {
                "warning"
            } else {
                "aligned"
            },
            if memory_missing_event_count > 0 {
                "Some memory rows do not have matching memory-written events; newer writes include memory audit events."
            } else {
                "Memory writes/searches/rejections/certifications are represented in append-only events."
            },
            json!({
                "memory_count": memories.len(),
                "memory_event_count": memory_events.len(),
                "memory_write_event_count": memory_write_event_count,
                "memory_missing_event_count": memory_missing_event_count,
            }),
        );

        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "leases.conflict_detector_logs",
            if lease_conflict_rows.len() > lease_conflict_detector_events.len() {
                "warning"
            } else {
                "aligned"
            },
            if lease_conflict_rows.len() > lease_conflict_detector_events.len() {
                "Some historical lease_conflicts do not have matching lease_conflict_detected events; newer conflicts include detector evidence."
            } else {
                "Lease conflicts have detector events with mode/resource overlap reasons."
            },
            json!({
                "lease_conflict_count": lease_conflict_rows.len(),
                "lease_conflict_detector_event_count": lease_conflict_detector_events.len(),
            }),
        );
        let missing_dependency_count = task_dependencies
            .iter()
            .filter(|dependency| {
                dependency["task_status"].is_null() || dependency["depends_on_status"].is_null()
            })
            .count();
        let mut cyclic_dependency_count = 0;
        for dependency in &task_dependencies {
            if let (Some(task_id), Some(depends_on_task_id)) = (
                dependency["task_id"].as_str(),
                dependency["depends_on_task_id"].as_str(),
            ) {
                if self.task_dependency_would_cycle(task_id, depends_on_task_id)? {
                    cyclic_dependency_count += 1;
                }
            }
        }
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "task_dependencies.graph_integrity",
            if missing_dependency_count > 0 || cyclic_dependency_count > 0 {
                "violation"
            } else {
                "aligned"
            },
            if cyclic_dependency_count > 0 {
                "Task dependency graph contains a cycle, so dependency ordering is not trustworthy."
            } else if missing_dependency_count > 0 {
                "Task dependency rows reference missing tasks."
            } else {
                "Task dependencies reference existing tasks and no cycles were detected."
            },
            json!({
                "dependency_count": task_dependencies.len(),
                "missing_dependency_count": missing_dependency_count,
                "cyclic_dependency_count": cyclic_dependency_count,
            }),
        );

        let resolved_by_untrusted_count = approvals
            .iter()
            .filter(|approval| {
                matches!(
                    approval["status"].as_str(),
                    Some("approved" | "denied" | "rejected")
                ) && !approval["approved_by"]
                    .as_str()
                    .map(is_trusted_memory_certifier)
                    .unwrap_or(false)
            })
            .count();
        let logged_approval_ids = approval_gate_logs
            .iter()
            .filter_map(|log| log["approval_id"].as_str())
            .collect::<HashSet<_>>();
        let approval_missing_log_count = approvals
            .iter()
            .filter(|approval| {
                approval["id"]
                    .as_str()
                    .map(|id| !logged_approval_ids.contains(id))
                    .unwrap_or(true)
            })
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "approval_gate.trusted_resolution",
            if resolved_by_untrusted_count > 0 {
                "violation"
            } else {
                "aligned"
            },
            if resolved_by_untrusted_count > 0 {
                "Resolved approval rows exist without trusted local UI/human actors."
            } else {
                "Approval decisions are restricted to trusted local UI/human actors."
            },
            json!({
                "approval_count": approvals.len(),
                "resolved_by_untrusted_count": resolved_by_untrusted_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "approval_gate.logs",
            if approval_missing_log_count > 0 {
                "warning"
            } else {
                "aligned"
            },
            if approval_missing_log_count > 0 {
                "Some historical approval rows do not have approval_gate_logs; newer request/reuse/reject/resolve paths log durable evidence."
            } else {
                "Approval requests, reuses, rejections, and resolutions have durable gate logs and append-only events."
            },
            json!({
                "approval_count": approvals.len(),
                "approval_gate_log_count": approval_gate_logs.len(),
                "approval_event_count": approval_events.len(),
                "approval_missing_log_count": approval_missing_log_count,
            }),
        );

        let db_request_ids_with_resources = db_change_request_resources
            .iter()
            .filter_map(|resource| resource["db_change_request_id"].as_str())
            .collect::<HashSet<_>>();
        let db_requests_missing_resources = db_change_requests
            .iter()
            .filter(|request| {
                request["id"]
                    .as_str()
                    .map(|id| !db_request_ids_with_resources.contains(id))
                    .unwrap_or(true)
            })
            .count();
        let db_authority_violations = db_change_requests
            .iter()
            .filter(|request| {
                matches!(
                    request["status"].as_str(),
                    Some("approved" | "applied_externally" | "rolled_back_externally")
                ) && request["approval_id"]
                    .as_str()
                    .map(|value| value.trim().is_empty())
                    .unwrap_or(true)
            })
            .count();
        let db_migration_request_ids = db_change_requests
            .iter()
            .filter_map(|request| request["migration_id"].as_str())
            .collect::<HashSet<_>>();
        let migration_missing_request_count = db_migrations
            .iter()
            .filter(|migration| {
                migration["id"]
                    .as_str()
                    .map(|id| !db_migration_request_ids.contains(id))
                    .unwrap_or(true)
            })
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "production_sql.coordination_records",
            if db_requests_missing_resources > 0 || migration_missing_request_count > 0 {
                "warning"
            } else {
                "aligned"
            },
            if db_requests_missing_resources > 0 {
                "One or more DB change requests lack resource rows, so production SQL collision scope is unclear."
            } else if migration_missing_request_count > 0 {
                "Some historical DB migration proposals do not have linked DB change request records."
            } else {
                "Production SQL work is represented as local DB change requests, resource rows, and migration metadata only."
            },
            json!({
                "db_change_request_count": db_change_requests.len(),
                "db_change_request_resource_count": db_change_request_resources.len(),
                "db_migration_count": db_migrations.len(),
                "requests_missing_resources": db_requests_missing_resources,
                "migrations_missing_request_count": migration_missing_request_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "production_sql.no_execution_authority",
            if db_authority_violations > 0 {
                "violation"
            } else {
                "aligned"
            },
            if db_authority_violations > 0 {
                "DB change requests reached approved/applied states without linked human approval."
            } else {
                "Production SQL coordination stores requests/proposals only; execution and approval remain outside agent MCP tools."
            },
            json!({
                "db_authority_violation_count": db_authority_violations,
                "db_coordination_event_count": db_coordination_events.len(),
                "raw_sql_mcp_allowed": value_i64(&policy, "raw_sql_mcp_allowed"),
                "sql_mcp_default": policy["sql_mcp_default"].clone(),
            }),
        );

        let ui_surface_log_gap =
            ui_surface_logs.is_empty() || ui_surface_events.len() < ui_surface_logs.len();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "tauri_ui.surface_logs",
            if ui_surface_log_gap {
                "warning"
            } else {
                "aligned"
            },
            if ui_surface_logs.is_empty() {
                "No UI surface logs have been recorded yet; opening the Coordination panel should write refresh/audit events."
            } else if ui_surface_events.len() < ui_surface_logs.len() {
                "Some UI surface rows do not have matching append-only ui_surface_logged events."
            } else {
                "Tauri/UI surface actions are durably recorded and mirrored into append-only events."
            },
            json!({
                "ui_surface_log_count": ui_surface_logs.len(),
                "ui_surface_event_count": ui_surface_events.len(),
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "tauri_ui.snapshot_debug_surface",
            "aligned",
            "Coordination snapshot exposes UI logs, bloat audits, approvals, DB requests, leases, violations, and events.",
            json!({
                "snapshot_sections": [
                    "ui_surface_logs",
                    "mcp_health_events",
                    "mcp_client_mounts",
                    "bloat_audits",
                    "approval_gate_logs",
                    "db_change_requests",
                    "workspace_changes",
                    "open_workspace_violations",
                    "events"
                ]
            }),
        );

        let latest_bloat_audit = bloat_audits.first();
        let bloat_attention_count = bloat_audits
            .iter()
            .filter(|audit| audit["status"].as_str() == Some("attention_required"))
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "cleanup_bloat.audit_logs",
            if bloat_audits.is_empty() {
                "warning"
            } else {
                "aligned"
            },
            if bloat_audits.is_empty() {
                "No cleanup/bloat audit has been run yet; run the dry-run audit from the Coordination panel."
            } else {
                "Cleanup/bloat dry-run audits are durably recorded and mirrored into append-only events."
            },
            json!({
                "bloat_audit_count": bloat_audits.len(),
                "bloat_event_count": bloat_events.len(),
                "attention_required_count": bloat_attention_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "cleanup_bloat.no_automatic_delete",
            "aligned",
            "Cleanup/bloat handling is audit-only here; unknown MCP files and worktrees are not deleted automatically.",
            json!({
                "latest_audit_id": latest_bloat_audit.and_then(|audit| audit["id"].as_str()),
                "latest_status": latest_bloat_audit.and_then(|audit| audit["status"].as_str()),
                "latest_unexpected_mcp_file_count": latest_bloat_audit
                    .and_then(|audit| audit["unexpected_mcp_file_count"].as_i64())
                    .unwrap_or(0),
                "latest_unexpected_worktree_dir_count": latest_bloat_audit
                    .and_then(|audit| audit["unexpected_worktree_dir_count"].as_i64())
                    .unwrap_or(0),
            }),
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
                if let Some(agent_slot_id) = session["agent_slot_id"].as_str() {
                    if let Ok(slot) = self.get_agent_slot_by_id(agent_slot_id) {
                        let slot_key = slot["slot_key"].as_str().unwrap_or("");
                        for path in [
                            self.paths
                                .mcp_root
                                .join("agents")
                                .join(format!("{slot_key}.json")),
                            self.paths
                                .mcp_root
                                .join("agents")
                                .join(format!("{slot_key}.codex.toml")),
                            self.paths
                                .mcp_root
                                .join("agents")
                                .join(format!("{slot_key}.claude.json")),
                        ] {
                            if !path.exists() {
                                missing.push(process_path_text(&path));
                            }
                        }
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
        let untrusted_resolved_violation_count = all_workspace_violations
            .iter()
            .filter(|violation| {
                matches!(
                    violation["status"].as_str(),
                    Some("resolved" | "overridden")
                ) && !violation["details_json"]["human_actor"]
                    .as_str()
                    .map(is_trusted_memory_certifier)
                    .unwrap_or(false)
            })
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "violations.resolution_authority",
            if untrusted_resolved_violation_count > 0 {
                "violation"
            } else {
                "aligned"
            },
            if untrusted_resolved_violation_count > 0 {
                "Resolved or overridden workspace violations exist without trusted local UI/human attribution."
            } else {
                "Workspace violation resolution is restricted to trusted local UI/human actors and logged."
            },
            json!({
                "workspace_violation_count": all_workspace_violations.len(),
                "workspace_resolution_event_count": workspace_resolution_events.len(),
                "untrusted_resolved_violation_count": untrusted_resolved_violation_count,
            }),
        );

        let unleased_change_count = workspace_changes
            .iter()
            .filter(|change| change["lease_status"].as_str() == Some("unleased"))
            .count();
        let unleased_without_violation_count = workspace_changes
            .iter()
            .filter(|change| {
                change["lease_status"].as_str() == Some("unleased")
                    && change["violation_id"]
                        .as_str()
                        .unwrap_or("")
                        .trim()
                        .is_empty()
            })
            .count();
        let missing_change_event_count = workspace_changes
            .len()
            .saturating_sub(file_changed_events.len());
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "change_tracking.durable_logs",
            if missing_change_event_count > 0 {
                "warning"
            } else {
                "aligned"
            },
            if missing_change_event_count > 0 {
                "Some durable workspace_changes rows do not have matching recent file_changed events; inspect historical migrations or external writes."
            } else {
                "Workspace changes are recorded durably and mirrored into append-only file_changed events."
            },
            json!({
                "workspace_change_count": workspace_changes.len(),
                "file_changed_event_count": file_changed_events.len(),
                "recent_scan_event_count": change_scan_events.len(),
                "missing_change_event_count": missing_change_event_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "change_tracking.unleased_visibility",
            if unleased_without_violation_count > 0 {
                "violation"
            } else {
                "aligned"
            },
            if unleased_without_violation_count > 0 {
                "One or more unleased workspace changes lack a linked workspace violation, so patch risk would be harder to debug."
            } else if unleased_change_count > 0 {
                "Unleased workspace changes are visible and linked to workspace violations."
            } else {
                "No unleased workspace changes are currently recorded."
            },
            json!({
                "unleased_change_count": unleased_change_count,
                "unleased_without_violation_count": unleased_without_violation_count,
            }),
        );

        let running_watcher_count = file_watchers
            .iter()
            .filter(|watcher| watcher["status"].as_str() == Some("running"))
            .count();
        let watcher_error_count = file_watchers
            .iter()
            .filter(|watcher| {
                watcher["status"].as_str() == Some("error")
                    || watcher["last_error"]
                        .as_str()
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false)
            })
            .count();
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "file_watcher.runtime",
            if watcher_error_count > 0 {
                "violation"
            } else if !active_watcher_targets.is_empty() && running_watcher_count == 0 {
                "warning"
            } else {
                "aligned"
            },
            if watcher_error_count > 0 {
                "The file watcher has an error state; unleased writes may only be detected by manual scans."
            } else if !active_watcher_targets.is_empty() && running_watcher_count == 0 {
                "Active worktree sessions exist, but no running file watcher is recorded."
            } else if active_watcher_targets.is_empty() {
                "No active worktree sessions need live file watching."
            } else {
                "A running file watcher is recorded for active worktree sessions."
            },
            json!({
                "active_target_count": active_watcher_targets.len(),
                "running_watcher_count": running_watcher_count,
                "watcher_error_count": watcher_error_count,
            }),
        );
        record_alignment_check(
            &self.paths.repo_path,
            &mut checks,
            context,
            "file_watcher.logs",
            if file_watchers.is_empty() && file_watcher_events.is_empty() {
                "warning"
            } else {
                "aligned"
            },
            if file_watchers.is_empty() && file_watcher_events.is_empty() {
                "No file watcher runtime logs have been recorded yet; start the watcher or run a watcher scan to establish evidence."
            } else {
                "File watcher state and append-only file_watcher_* events are available for debugging."
            },
            json!({
                "file_watcher_state_count": file_watchers.len(),
                "file_watcher_event_count": file_watcher_events.len(),
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

        let mut aligned_count = checks
            .iter()
            .filter(|check| check["status"].as_str() == Some("aligned"))
            .count();
        let mut warning_count = checks
            .iter()
            .filter(|check| check["status"].as_str() == Some("warning"))
            .count();
        let mut violation_count = checks
            .iter()
            .filter(|check| check["status"].as_str() == Some("violation"))
            .count();
        let mut overall_status = if violation_count > 0 {
            "violation"
        } else if warning_count > 0 {
            "warning"
        } else {
            "aligned"
        };
        let recent_events =
            self.query_json("SELECT * FROM events ORDER BY seq DESC LIMIT 60", &[])?;

        if let Err(error) = alignment::write_lifecycle(
            &self.paths.repo_path,
            context,
            "alignment.report_generated",
            overall_status,
            "Alignment report generated for local coordination kernel audit.",
            json!({
                "aligned": aligned_count,
                "warnings": warning_count,
                "violations": violation_count,
                "active_session_count": sessions.len(),
                "worktree_count": worktrees.len(),
                "file_watcher_count": file_watchers.len(),
                "resource_count": resources.len(),
                "artifact_count": artifacts.len(),
                "artifact_storage_log_count": artifact_storage_logs.len(),
                "memory_count": memories.len(),
                "lease_conflict_count": lease_conflict_rows.len(),
                "workspace_change_count": workspace_changes.len(),
                "open_workspace_violation_count": open_violations.len(),
                "task_dependency_count": task_dependencies.len(),
                "approval_count": approvals.len(),
                "approval_gate_log_count": approval_gate_logs.len(),
                "db_change_request_count": db_change_requests.len(),
                "db_migration_count": db_migrations.len(),
                "ui_surface_log_count": ui_surface_logs.len(),
                "mcp_health_event_count": mcp_health_events.len(),
                "mcp_client_mount_status": mcp_client_mounts["status"].clone(),
                "bloat_audit_count": bloat_audits.len(),
                "patch_count": patch_rows.len(),
                "merge_job_count": merge_rows.len(),
            }),
        ) {
            checks.push(alignment::check_entry(
                context,
                "alignment.report_log_write",
                "warning",
                format!("Unable to write alignment report lifecycle log: {error}"),
                json!({"error": error}),
            ));
            aligned_count = checks
                .iter()
                .filter(|check| check["status"].as_str() == Some("aligned"))
                .count();
            warning_count = checks
                .iter()
                .filter(|check| check["status"].as_str() == Some("warning"))
                .count();
            violation_count = checks
                .iter()
                .filter(|check| check["status"].as_str() == Some("violation"))
                .count();
            overall_status = if violation_count > 0 {
                "violation"
            } else if warning_count > 0 {
                "warning"
            } else {
                "aligned"
            };
        }

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
            "sessions": sessions,
            "worktrees": worktrees,
            "file_watchers": file_watchers,
            "active_file_watcher_targets": active_watcher_targets,
            "resources": resources,
            "artifacts": artifacts,
            "artifact_storage_logs": artifact_storage_logs,
            "memories": memories,
            "lease_conflicts": lease_conflict_rows,
            "workspace_changes": workspace_changes,
            "open_workspace_violations": open_violations,
            "task_dependencies": task_dependencies,
            "approvals": approvals,
            "approval_gate_logs": approval_gate_logs,
            "db_change_requests": db_change_requests,
            "db_change_request_resources": db_change_request_resources,
            "db_migrations": db_migrations,
            "ui_surface_logs": ui_surface_logs,
            "mcp_health_events": mcp_health_events,
            "mcp_client_mounts": mcp_client_mounts,
            "bloat_audits": bloat_audits,
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
            "agent_worktree_required",
            "patch_lease_validation_required",
            "merge_gate_required",
            "unleased_write_policy",
            "merge_requires_clean_target",
        ];
        let hard_gates = [
            "agent_worktree_required",
            "patch_lease_validation_required",
            "merge_gate_required",
            "merge_requires_clean_target",
        ];
        if patch["raw_sql_mcp_allowed"].as_bool() == Some(true)
            || patch["raw_sql_mcp_allowed"].as_i64().unwrap_or(0) != 0
        {
            return Err(
                "raw_sql_mcp_allowed cannot be enabled; the coordination MCP does not expose raw SQL execution."
                    .to_string(),
            );
        }
        if let Some(mode) = patch["sql_mcp_default"].as_str() {
            if !matches!(mode, "off" | "proposal_only" | "metadata_only") {
                return Err(
                    "sql_mcp_default must be off, proposal_only, or metadata_only.".to_string(),
                );
            }
        }
        if let Some(policy) = patch["unleased_write_policy"].as_str() {
            if policy != "reject_patch" {
                return Err(
                    "unleased_write_policy cannot be loosened; use reject_patch.".to_string(),
                );
            }
        }
        for key in hard_gates {
            if patch[key].as_bool() == Some(false) || patch[key].as_i64() == Some(0) {
                return Err(format!(
                    "{key} cannot be disabled through the client policy gate."
                ));
            }
        }
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
            "repo_policy_updated",
            "human",
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
        let human_actor = non_empty(human_actor, "Human actor")?;
        if !is_trusted_memory_certifier(human_actor) {
            let _ = self.emit_event(
                "workspace_violation_resolution_rejected",
                "agent",
                human_actor,
                EventRefs::default(),
                json!({
                    "violation_id": violation_id,
                    "resolution": resolution,
                    "reason": "untrusted_actor"
                }),
            );
            return Err(
                "Workspace violation resolution requires a trusted local UI/human actor."
                    .to_string(),
            );
        }
        let violation = self.query_one(
            "SELECT * FROM workspace_violations WHERE id=?1",
            &[&violation_id],
            "Workspace violation does not exist.",
        )?;
        if violation["status"].as_str() != Some("open") {
            self.emit_event(
                "workspace_violation_resolution_rejected",
                "human",
                human_actor,
                EventRefs {
                    task_id: violation["task_id"].as_str().map(str::to_string),
                    agent_id: violation["agent_id"].as_str().map(str::to_string),
                    session_id: violation["session_id"].as_str().map(str::to_string),
                    ..EventRefs::default()
                },
                json!({
                    "violation_id": violation_id,
                    "resolution": resolution,
                    "reason": "not_open",
                    "existing_status": violation["status"].clone()
                }),
            )?;
            return Err("Only open workspace violations can be resolved.".to_string());
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
            EventRefs {
                task_id: violation["task_id"].as_str().map(str::to_string),
                agent_id: violation["agent_id"].as_str().map(str::to_string),
                session_id: violation["session_id"].as_str().map(str::to_string),
                ..EventRefs::default()
            },
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

    fn mark_invalid_worktree_sessions_interrupted(&self) -> Result<(), String> {
        let sessions = self.query_json(
            "SELECT * FROM agent_sessions
             WHERE status='active' AND enforcement_mode='worktree_required'",
            &[],
        )?;
        for session in sessions {
            let Some(session_id) = session["id"].as_str() else {
                continue;
            };
            let Some(problem) = self.session_worktree_isolation_problem(&session)? else {
                continue;
            };
            let _ = self.create_workspace_violation(
                session["task_id"].as_str(),
                session["agent_id"].as_str(),
                Some(session_id),
                session["worktree_id"].as_str(),
                "invalid_worktree_isolation",
                problem["path"].as_str(),
                None,
                "error",
                json!({
                    "reason": problem["reason"].clone(),
                    "details": problem,
                    "recovery_action": "session_interrupted",
                }),
            )?;
            let _ = self.interrupt_session(session_id, "invalid_worktree_isolation_recovered")?;
        }
        Ok(())
    }

    fn session_worktree_isolation_problem(&self, session: &Value) -> Result<Option<Value>, String> {
        let session_id = session["id"].as_str().unwrap_or("unknown");
        let worktree_id = match session["worktree_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            Some(value) => value,
            None => {
                return Ok(Some(json!({
                    "reason": "missing_worktree_id",
                    "session_id": session_id,
                    "path": session["write_root"].as_str(),
                })));
            }
        };
        let write_root = session["write_root"].as_str().unwrap_or("");
        if write_root.trim().is_empty() {
            return Ok(Some(json!({
                "reason": "missing_write_root",
                "session_id": session_id,
                "worktree_id": worktree_id,
            })));
        }
        if same_path_text(write_root, &process_path_text(&self.paths.repo_path)) {
            return Ok(Some(json!({
                "reason": "write_root_is_control_repo",
                "session_id": session_id,
                "worktree_id": worktree_id,
                "path": write_root,
            })));
        }
        if !path_text_under_path(write_root, &self.paths.worktrees_root) {
            return Ok(Some(json!({
                "reason": "write_root_outside_worktrees_root",
                "session_id": session_id,
                "worktree_id": worktree_id,
                "path": write_root,
                "expected_root": process_path_text(&self.paths.worktrees_root),
            })));
        }
        let worktree = match self.get_worktree(worktree_id) {
            Ok(worktree) => worktree,
            Err(error) => {
                return Ok(Some(json!({
                    "reason": "missing_worktree_record",
                    "session_id": session_id,
                    "worktree_id": worktree_id,
                    "path": write_root,
                    "error": error,
                })));
            }
        };
        let worktree_path = worktree["path"].as_str().unwrap_or("");
        if !same_path_text(write_root, worktree_path) {
            return Ok(Some(json!({
                "reason": "session_write_root_mismatches_worktree_record",
                "session_id": session_id,
                "worktree_id": worktree_id,
                "path": write_root,
                "recorded_path": worktree_path,
            })));
        }
        let worktree_path = PathBuf::from(worktree_path);
        match self.validate_git_worktree_path(
            &worktree_path,
            worktree["branch_name"].as_str().unwrap_or(""),
        ) {
            Ok(_) => Ok(None),
            Err(error) => Ok(Some(json!({
                "reason": "invalid_git_worktree",
                "session_id": session_id,
                "worktree_id": worktree_id,
                "path": process_path_text(&worktree_path),
                "expected_branch": worktree["branch_name"].as_str(),
                "error": error,
            }))),
        }
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

    fn ensure_session_owns_task(&self, session_id: &str, task_id: &str) -> Result<(), String> {
        let task = self.query_one(
            "SELECT * FROM tasks WHERE id=?1",
            &[&task_id],
            "Task does not exist.",
        )?;
        match task["claimed_session_id"].as_str() {
            Some(claimed) if !claimed.is_empty() && claimed == session_id => Ok(()),
            Some(claimed) if !claimed.is_empty() => {
                Err("Task is claimed by another session.".to_string())
            }
            _ => Err("Task must be claimed by this session first.".to_string()),
        }
    }

    pub fn create_or_reuse_worktree_for_slot(&self, agent_slot_id: &str) -> Result<Value, String> {
        let slot = self.get_agent_slot_by_id(agent_slot_id)?;
        let agent_id = required_string(&slot, "agent_id")?;
        let slot_key = required_string(&slot, "slot_key")?;
        if !self.paths.repo_path.join(".git").exists() {
            return Err("Repo has no .git; worktree isolation is unavailable.".to_string());
        }
        run_git(&self.paths.repo_path, &["rev-parse", "--show-toplevel"])?;
        let base_sha = run_git(&self.paths.repo_path, &["rev-parse", "HEAD"])?
            .trim()
            .to_string();
        let mut branch = format!("agent/{slot_key}");
        let stable_path = self.paths.worktrees_root.join(slot_key);
        let mut path = stable_path.clone();

        if let Some(existing_id) = slot["worktree_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            if let Ok(existing) = self.get_worktree(existing_id) {
                let existing_path = PathBuf::from(existing["path"].as_str().unwrap_or_default());
                let existing_path_text = process_path_text(&existing_path);
                let existing_branch = existing["branch_name"]
                    .as_str()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or(branch.as_str())
                    .to_string();
                if !path_text_under_path(&existing_path_text, &self.paths.worktrees_root) {
                    self.emit_event(
                        "worktree_reuse_failed",
                        "kernel",
                        REPO_ID,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            agent_slot_id: Some(agent_slot_id.to_string()),
                            ..EventRefs::default()
                        },
                        json!({
                            "slot_key": slot_key,
                            "recorded_path": existing["path"],
                            "expected_root": process_path_text(&self.paths.worktrees_root),
                            "reason": "recorded_worktree_path_escapes_worktrees_root"
                        }),
                    )?;
                } else if existing_path.exists() {
                    if let Err(error) =
                        self.validate_git_worktree_path(&existing_path, &existing_branch)
                    {
                        self.emit_event(
                            "worktree_reuse_failed",
                            "kernel",
                            REPO_ID,
                            EventRefs {
                                agent_id: Some(agent_id.to_string()),
                                agent_slot_id: Some(agent_slot_id.to_string()),
                                ..EventRefs::default()
                            },
                            json!({
                                "slot_key": slot_key,
                                "worktree_id": existing_id,
                                "path": process_path_text(&existing_path),
                                "branch_name": existing_branch.clone(),
                                "reason": "recorded_worktree_path_is_not_valid",
                                "error": error,
                            }),
                        )?;
                    } else {
                        self.conn
                            .execute(
                                "UPDATE worktrees SET status='active', current_sha=?1, updated_at=?2 WHERE id=?3",
                                params![base_sha, now_rfc3339(), existing_id],
                            )
                            .map_err(|error| format!("Unable to refresh worktree: {error}"))?;
                        self.emit_event(
                            "worktree_reused",
                            "kernel",
                            REPO_ID,
                            EventRefs {
                                agent_id: Some(agent_id.to_string()),
                                agent_slot_id: Some(agent_slot_id.to_string()),
                                ..EventRefs::default()
                            },
                            json!({"slot_key": slot_key, "worktree_id": existing_id, "path": existing["path"], "branch_name": existing_branch.clone()}),
                        )?;
                        return Ok(json!({
                            "id": existing_id,
                            "agentId": agent_id,
                            "agentSlotId": agent_slot_id,
                            "slotKey": slot_key,
                            "path": existing["path"],
                            "branchName": existing_branch,
                            "baseSha": existing["base_sha"],
                            "status": "active",
                        }));
                    }
                } else {
                    self.emit_event(
                        "worktree_reuse_failed",
                        "kernel",
                        REPO_ID,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            agent_slot_id: Some(agent_slot_id.to_string()),
                            ..EventRefs::default()
                        },
                        json!({
                            "slot_key": slot_key,
                            "worktree_id": existing_id,
                            "path": process_path_text(&existing_path),
                            "branch_name": existing_branch,
                            "reason": "recorded_worktree_path_missing"
                        }),
                    )?;
                    self.prune_stale_git_worktrees_for_slot(
                        slot_key,
                        &agent_id,
                        agent_slot_id,
                        "recorded_worktree_path_missing",
                    )?;
                }
            }
        }

        if path.exists() {
            if let Err(error) = self.validate_git_worktree_path(&path, &branch) {
                self.emit_event(
                    "worktree_reuse_failed",
                    "kernel",
                    REPO_ID,
                    EventRefs {
                        agent_id: Some(agent_id.to_string()),
                        agent_slot_id: Some(agent_slot_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({
                        "slot_key": slot_key,
                        "path": process_path_text(&path),
                        "branch_name": branch.clone(),
                        "reason": "stable_path_exists_but_is_not_valid_slot_worktree",
                        "error": error,
                    }),
                )?;
                let replacement = self.next_isolated_worktree_target(slot_key)?;
                path = replacement.0;
                branch = replacement.1;
            }
        }

        if !path.exists() {
            self.prune_stale_git_worktrees_for_slot(
                slot_key,
                &agent_id,
                agent_slot_id,
                "before_worktree_add",
            )?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Unable to create worktree root: {error}"))?;
            }
            let path_string = process_path_text(&path);
            let args = if self.branch_exists(&branch)? {
                vec!["worktree", "add", &path_string, &branch]
            } else {
                vec!["worktree", "add", "-b", &branch, &path_string]
            };
            if let Err(error) = run_git(&self.paths.repo_path, &args) {
                self.emit_event(
                    "worktree_create_failed",
                    "kernel",
                    REPO_ID,
                    EventRefs {
                        agent_id: Some(agent_id.to_string()),
                        agent_slot_id: Some(agent_slot_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({
                        "slot_key": slot_key,
                        "path": path_string,
                        "branch_name": branch.clone(),
                        "error": error.clone(),
                        "will_retry_after_prune": true
                    }),
                )?;
                self.prune_stale_git_worktrees_for_slot(
                    slot_key,
                    &agent_id,
                    agent_slot_id,
                    "worktree_add_failed_retry_prune",
                )?;
                if let Err(retry_error) = run_git(&self.paths.repo_path, &args) {
                    self.emit_event(
                        "worktree_create_failed",
                        "kernel",
                        REPO_ID,
                        EventRefs {
                            agent_id: Some(agent_id.to_string()),
                            agent_slot_id: Some(agent_slot_id.to_string()),
                            ..EventRefs::default()
                        },
                        json!({
                            "slot_key": slot_key,
                            "path": path_string,
                            "branch_name": branch,
                            "first_error": error,
                            "retry_error": retry_error,
                            "reason": "retry_after_prune_failed"
                        }),
                    )?;
                    return Err(retry_error);
                }
                self.emit_event(
                    "worktree_create_recovered_after_prune",
                    "kernel",
                    REPO_ID,
                    EventRefs {
                        agent_id: Some(agent_id.to_string()),
                        agent_slot_id: Some(agent_slot_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({"slot_key": slot_key, "path": path_string, "branch_name": branch}),
                )?;
            }
        }
        let canonical_worktree = path.canonicalize().unwrap_or(path);
        let worktree_path_text = process_path_text(&canonical_worktree);
        if !path_text_under_path(&worktree_path_text, &self.paths.worktrees_root) {
            self.emit_event(
                "worktree_reuse_failed",
                "kernel",
                REPO_ID,
                EventRefs {
                    agent_id: Some(agent_id.to_string()),
                    agent_slot_id: Some(agent_slot_id.to_string()),
                    ..EventRefs::default()
                },
                json!({"slot_key": slot_key, "path": worktree_path_text, "reason": "stable_worktree_path_escapes_worktrees_root"}),
            )?;
            return Err(format!(
                "Stable worktree path escapes .agents/worktrees for slot {slot_key}."
            ));
        }
        let existing_row_id = self
            .conn
            .query_row(
                "SELECT id FROM worktrees WHERE agent_slot_id=?1",
                [agent_slot_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Unable to inspect stable worktree row: {error}"))?;
        let id = existing_row_id.clone().unwrap_or_else(uuid);
        let now = now_rfc3339();
        if existing_row_id.is_some() {
            self.conn
                .execute(
                    "UPDATE worktrees
                     SET agent_id=?1, path=?2, branch_name=?3, base_sha=?4,
                         current_sha=?4, status='active', updated_at=?5
                     WHERE id=?6",
                    params![
                        agent_id,
                        worktree_path_text.clone(),
                        branch.clone(),
                        base_sha.clone(),
                        now,
                        id
                    ],
                )
                .map_err(|error| format!("Unable to update worktree: {error}"))?;
        } else {
            self.conn
                .execute(
                    "INSERT INTO worktrees(
                        id, agent_slot_id, agent_id, session_id, path, branch_name,
                        base_sha, current_sha, status, created_at, updated_at
                    ) VALUES(?1, ?2, ?3, NULL, ?4, ?5, ?6, ?6, 'active', ?7, ?7)",
                    params![
                        id,
                        agent_slot_id,
                        agent_id,
                        worktree_path_text.clone(),
                        branch.clone(),
                        base_sha.clone(),
                        now
                    ],
                )
                .map_err(|error| format!("Unable to record worktree: {error}"))?;
        }
        self.conn
            .execute(
                "UPDATE agent_slots SET worktree_id=?1, updated_at=?2 WHERE id=?3",
                params![id, now_rfc3339(), agent_slot_id],
            )
            .map_err(|error| format!("Unable to attach worktree to slot: {error}"))?;
        self.emit_event(
            if slot["worktree_id"].as_str().is_some() {
                "worktree_recovered"
            } else {
                "worktree_created"
            },
            "kernel",
            REPO_ID,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: Some(agent_slot_id.to_string()),
                ..EventRefs::default()
            },
            json!({"slot_key": slot_key, "worktree_id": id, "path": worktree_path_text.clone(), "branch_name": branch.clone(), "base_sha": base_sha.clone()}),
        )?;

        Ok(json!({
            "id": id,
            "agentId": agent_id,
            "agentSlotId": agent_slot_id,
            "slotKey": slot_key,
            "path": worktree_path_text,
            "branchName": branch,
            "baseSha": base_sha,
            "status": "active",
        }))
    }

    fn next_isolated_worktree_target(&self, slot_key: &str) -> Result<(PathBuf, String), String> {
        for _ in 0..32 {
            let suffix = uuid()
                .chars()
                .filter(|ch| *ch != '-')
                .take(8)
                .collect::<String>();
            let path = self
                .paths
                .worktrees_root
                .join(format!("{slot_key}-{suffix}"));
            let branch = format!("agent/{slot_key}-{suffix}");
            if path.exists() || self.branch_exists(&branch)? {
                continue;
            }
            return Ok((path, branch));
        }

        Err(format!(
            "Unable to allocate a free isolated worktree path for slot {slot_key}."
        ))
    }

    fn prune_stale_git_worktrees_for_slot(
        &self,
        slot_key: &str,
        agent_id: &str,
        agent_slot_id: &str,
        reason: &str,
    ) -> Result<(), String> {
        run_git(&self.paths.repo_path, &["worktree", "prune"]).map_err(|error| {
            format!("Unable to prune stale git worktree metadata before isolated launch: {error}")
        })?;
        self.emit_event(
            "worktree_stale_registry_pruned",
            "kernel",
            REPO_ID,
            EventRefs {
                agent_id: Some(agent_id.to_string()),
                agent_slot_id: Some(agent_slot_id.to_string()),
                ..EventRefs::default()
            },
            json!({"slot_key": slot_key, "reason": reason}),
        )?;
        Ok(())
    }

    pub fn create_worktree_for_session(
        &self,
        agent_id: &str,
        session_id: &str,
        _task_id: Option<&str>,
    ) -> Result<Value, String> {
        let session = self.query_one(
            "SELECT * FROM agent_sessions WHERE id=?1 AND agent_id=?2",
            &[&session_id, &agent_id],
            "Session does not exist for this agent.",
        )?;
        let agent_slot_id = if let Some(slot_id) = session["agent_slot_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            slot_id.to_string()
        } else {
            let agent = self.get_agent_by_id(agent_id)?;
            let slot_key = derive_slot_key(
                agent["kind"].as_str().unwrap_or("agent"),
                session["pty_id"].as_str(),
                None,
            )?;
            let slot = self.get_or_create_agent_slot_for_agent(&slot_key, &agent)?;
            let slot_id = required_string(&slot, "id")?.to_string();
            self.conn
                .execute(
                    "UPDATE agent_sessions SET agent_slot_id=?1, updated_at=?2 WHERE id=?3",
                    params![slot_id, now_rfc3339(), session_id],
                )
                .map_err(|error| format!("Unable to attach legacy session to slot: {error}"))?;
            slot_id
        };
        let worktree = self.create_or_reuse_worktree_for_slot(&agent_slot_id)?;
        self.conn
            .execute(
                "UPDATE agent_sessions
                 SET worktree_id=?1, write_root=?2, base_git_sha=?3,
                     current_git_sha=?3, enforcement_mode='worktree_required',
                     updated_at=?4
                 WHERE id=?5",
                params![
                    worktree["id"].as_str(),
                    worktree["path"].as_str(),
                    worktree["baseSha"].as_str(),
                    now_rfc3339(),
                    session_id
                ],
            )
            .map_err(|error| format!("Unable to attach stable worktree to session: {error}"))?;
        Ok(worktree)
    }

    fn branch_exists(&self, branch: &str) -> Result<bool, String> {
        let safe_directory = format!(
            "safe.directory={}",
            git_safe_directory_value(&self.paths.repo_path)
        );
        let branch_ref = format!("refs/heads/{branch}");
        let status = Command::new("git")
            .current_dir(PathBuf::from(process_path_text(&self.paths.repo_path)))
            .args([
                "-c",
                safe_directory.as_str(),
                "show-ref",
                "--verify",
                "--quiet",
                branch_ref.as_str(),
            ])
            .status()
            .map_err(|error| format!("Unable to inspect git branches: {error}"))?;
        Ok(status.success())
    }

    fn validate_git_worktree_path(
        &self,
        worktree_path: &Path,
        expected_branch: &str,
    ) -> Result<(), String> {
        if !worktree_path.exists() {
            return Err(format!(
                "Recorded worktree path is missing: {}",
                worktree_path.display()
            ));
        }
        let canonical_worktree = worktree_path.canonicalize().map_err(|error| {
            format!(
                "Unable to canonicalize worktree path {}: {error}",
                worktree_path.display()
            )
        })?;
        let canonical_worktrees_root = self
            .paths
            .worktrees_root
            .canonicalize()
            .unwrap_or_else(|_| self.paths.worktrees_root.clone());
        if !canonical_worktree.starts_with(&canonical_worktrees_root) {
            return Err(format!(
                "Worktree path escapes .agents/worktrees: {}",
                canonical_worktree.display()
            ));
        }
        let inside = run_git(&canonical_worktree, &["rev-parse", "--is-inside-work-tree"])?;
        if inside.trim() != "true" {
            return Err(format!(
                "Worktree path is not inside a git worktree: {}",
                canonical_worktree.display()
            ));
        }
        let top_level = run_git(&canonical_worktree, &["rev-parse", "--show-toplevel"])?;
        if !same_path_text(top_level.trim(), &process_path_text(&canonical_worktree)) {
            return Err(format!(
                "Git top-level {} does not match recorded worktree path {}.",
                top_level.trim(),
                canonical_worktree.display()
            ));
        }
        let expected_branch = expected_branch.trim();
        if !expected_branch.is_empty() {
            let actual_branch = run_git(&canonical_worktree, &["branch", "--show-current"])?;
            if actual_branch.trim() != expected_branch {
                return Err(format!(
                    "Worktree branch mismatch: expected {expected_branch}, found {}.",
                    actual_branch.trim()
                ));
            }
        }
        Ok(())
    }

    fn get_worktree(&self, worktree_id: &str) -> Result<Value, String> {
        self.query_one(
            "SELECT * FROM worktrees WHERE id=?1",
            &[&worktree_id],
            "Worktree does not exist.",
        )
    }

    fn session_response(
        &self,
        session: &Value,
        slot: &Value,
        mcp_config: &SessionMcpConfigPaths,
        warnings: Vec<String>,
    ) -> Value {
        json!({
            "id": session["id"].as_str().unwrap_or_default(),
            "agentId": session["agent_id"].as_str().unwrap_or_default(),
            "agentSlotId": slot["id"].as_str().unwrap_or_default(),
            "slotKey": slot["slot_key"].as_str().unwrap_or_default(),
            "taskId": session["task_id"].as_str(),
            "ptyId": session["pty_id"].as_str(),
            "worktreeId": session["worktree_id"].as_str(),
            "writeRoot": session["write_root"].as_str().unwrap_or_else(|| self.paths.repo_path.to_str().unwrap_or("")),
            "enforcementMode": session["enforcement_mode"].as_str().unwrap_or("coordination_only"),
            "baseGitSha": session["base_git_sha"].as_str(),
            "status": session["status"].as_str().unwrap_or("unknown"),
            "mcpConfigPath": mcp_config.generic_path.clone(),
            "codexMcpConfigPath": mcp_config.codex_path.clone(),
            "claudeMcpConfigPath": mcp_config.claude_path.clone(),
            "warnings": warnings,
        })
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
        let id = uuid();
        let hash = sha256_hex(bytes);
        let agent_slot_id = agent_id
            .and_then(|value| self.artifact_agent_slot_id(value).ok())
            .flatten();
        let path = match self.artifact_target_path(relative_path, &hash) {
            Ok(path) => path,
            Err(error) => {
                let _ = self.record_artifact_storage_log(ArtifactStorageLogInput {
                    artifact_id: None,
                    task_id,
                    agent_id,
                    agent_slot_id: agent_slot_id.as_deref(),
                    artifact_kind,
                    requested_path: relative_path,
                    stored_path: None,
                    content_hash: Some(&hash),
                    size_bytes: Some(bytes.len() as i64),
                    status: "rejected",
                    action: "path_rejected",
                    error: Some(&error),
                    metadata: metadata.clone(),
                });
                return Err(error);
            }
        };
        let wrote_file = !path.exists();
        if wrote_file {
            if let Err(error) = write_bytes_atomic(&path, bytes) {
                let _ = self.record_artifact_storage_log(ArtifactStorageLogInput {
                    artifact_id: None,
                    task_id,
                    agent_id,
                    agent_slot_id: agent_slot_id.as_deref(),
                    artifact_kind,
                    requested_path: relative_path,
                    stored_path: Some(&path),
                    content_hash: Some(&hash),
                    size_bytes: Some(bytes.len() as i64),
                    status: "failed",
                    action: "file_write_failed",
                    error: Some(&error),
                    metadata: metadata.clone(),
                });
                return Err(error);
            }
        } else {
            let existing = match fs::read(&path) {
                Ok(existing) => existing,
                Err(error) => {
                    let error = format!(
                        "Unable to read existing artifact {}: {error}",
                        path.display()
                    );
                    let _ = self.record_artifact_storage_log(ArtifactStorageLogInput {
                        artifact_id: None,
                        task_id,
                        agent_id,
                        agent_slot_id: agent_slot_id.as_deref(),
                        artifact_kind,
                        requested_path: relative_path,
                        stored_path: Some(&path),
                        content_hash: Some(&hash),
                        size_bytes: Some(bytes.len() as i64),
                        status: "failed",
                        action: "existing_read_failed",
                        error: Some(&error),
                        metadata: metadata.clone(),
                    });
                    return Err(error);
                }
            };
            if sha256_hex(&existing) != hash {
                let error = "Existing artifact path has different content.".to_string();
                let _ = self.record_artifact_storage_log(ArtifactStorageLogInput {
                    artifact_id: None,
                    task_id,
                    agent_id,
                    agent_slot_id: agent_slot_id.as_deref(),
                    artifact_kind,
                    requested_path: relative_path,
                    stored_path: Some(&path),
                    content_hash: Some(&hash),
                    size_bytes: Some(bytes.len() as i64),
                    status: "failed",
                    action: "existing_hash_mismatch",
                    error: Some(&error),
                    metadata: metadata.clone(),
                });
                return Err(error);
            }
        }

        self.begin_immediate_transaction("store artifact")?;
        let result = (|| -> Result<(), String> {
            self.conn
                .execute(
                    "INSERT INTO artifacts(
                        id, task_id, agent_id, agent_slot_id, artifact_kind, path,
                        content_hash, size_bytes, metadata_json, created_at
                    ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        id,
                        task_id,
                        agent_id,
                        agent_slot_id.as_deref(),
                        artifact_kind,
                        path.display().to_string(),
                        hash,
                        bytes.len() as i64,
                        metadata.to_string(),
                        now_rfc3339()
                    ],
                )
                .map_err(|error| format!("Unable to record artifact: {error}"))?;
            self.record_artifact_storage_log(ArtifactStorageLogInput {
                artifact_id: Some(&id),
                task_id,
                agent_id,
                agent_slot_id: agent_slot_id.as_deref(),
                artifact_kind,
                requested_path: relative_path,
                stored_path: Some(&path),
                content_hash: Some(&hash),
                size_bytes: Some(bytes.len() as i64),
                status: "stored",
                action: if wrote_file {
                    "file_written"
                } else {
                    "file_reused"
                },
                error: None,
                metadata: metadata.clone(),
            })?;
            self.emit_event(
                "artifact_stored",
                if agent_id.is_some() { "agent" } else { "kernel" },
                agent_id.unwrap_or(REPO_ID),
                EventRefs {
                    task_id: task_id.map(str::to_string),
                    agent_id: agent_id.map(str::to_string),
                    agent_slot_id: agent_slot_id.clone(),
                    artifact_id: Some(id.clone()),
                    ..EventRefs::default()
                },
                json!({"artifact_kind": artifact_kind, "path": path.display().to_string(), "content_hash": hash, "size_bytes": bytes.len()}),
            )?;
            Ok(())
        })();

        if let Err(error) = self.finish_transaction(result, "store artifact") {
            if wrote_file {
                let _ = fs::remove_file(&path);
            }
            return Err(error);
        }

        Ok(id)
    }

    fn record_artifact_storage_log(
        &self,
        input: ArtifactStorageLogInput<'_>,
    ) -> Result<String, String> {
        let id = uuid();
        let stored_path_text = input.stored_path.map(process_path_text);
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO artifact_storage_logs(
                    id, artifact_id, repo_id, task_id, agent_id, agent_slot_id, artifact_kind,
                    requested_path, stored_path, content_hash, size_bytes, status, action,
                    error, metadata_json, created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    id,
                    input.artifact_id,
                    REPO_ID,
                    input.task_id,
                    input.agent_id,
                    input.agent_slot_id,
                    input.artifact_kind,
                    input.requested_path,
                    stored_path_text.as_deref(),
                    input.content_hash,
                    input.size_bytes,
                    input.status,
                    input.action,
                    input.error,
                    input.metadata.to_string(),
                    now
                ],
            )
            .map_err(|error| format!("Unable to record artifact storage log: {error}"))?;
        let event_type = match input.status {
            "stored" if input.action == "file_reused" => "artifact_storage_reused",
            "stored" => "artifact_storage_logged",
            "rejected" | "failed" => "artifact_storage_failed",
            _ => "artifact_storage_logged",
        };
        self.emit_event(
            event_type,
            if input.agent_id.is_some() {
                "agent"
            } else {
                "kernel"
            },
            input.agent_id.unwrap_or(REPO_ID),
            EventRefs {
                task_id: input.task_id.map(str::to_string),
                agent_id: input.agent_id.map(str::to_string),
                agent_slot_id: input.agent_slot_id.map(str::to_string),
                artifact_id: input.artifact_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "artifact_storage_log_id": id.clone(),
                "artifact_id": input.artifact_id,
                "artifact_kind": input.artifact_kind,
                "requested_path": input.requested_path,
                "stored_path": stored_path_text,
                "content_hash": input.content_hash,
                "size_bytes": input.size_bytes,
                "status": input.status,
                "action": input.action,
                "error": input.error,
            }),
        )?;
        Ok(id)
    }

    fn artifact_target_path(
        &self,
        relative_path: &str,
        content_hash: &str,
    ) -> Result<PathBuf, String> {
        let safe_relative = relative_path.replace('\\', "/");
        reject_path_escape(&safe_relative)?;
        let requested = self.paths.artifacts_root.join(&safe_relative);
        if !path_text_under_path(&process_path_text(&requested), &self.paths.artifacts_root) {
            return Err("Artifact path escapes .agents/artifacts.".to_string());
        }
        if requested.is_dir() {
            return Err("Artifact path points to a directory.".to_string());
        }
        if !requested.exists() {
            return Ok(requested);
        }

        let existing = fs::read(&requested).map_err(|error| {
            format!(
                "Unable to read existing artifact {}: {error}",
                requested.display()
            )
        })?;
        if sha256_hex(&existing) == content_hash {
            return Ok(requested);
        }

        for _ in 0..32 {
            let candidate = suffixed_path(&requested, &uuid()[..8]);
            if !candidate.exists() {
                return Ok(candidate);
            }
        }
        Err("Unable to allocate unique artifact path.".to_string())
    }

    fn artifact_agent_slot_id(&self, agent_id: &str) -> Result<Option<String>, String> {
        let rows = self.query_json(
            "SELECT agent_slot_id
             FROM agent_sessions
             WHERE agent_id=?1 AND status='active' AND agent_slot_id IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 2",
            &[&agent_id],
        )?;
        if rows.len() == 1 {
            return Ok(rows[0]["agent_slot_id"].as_str().map(str::to_string));
        }
        Ok(None)
    }

    fn begin_immediate_transaction(&self, context: &str) -> Result<(), String> {
        self.conn
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|error| format!("Unable to begin {context} transaction: {error}"))
    }

    fn commit_transaction(&self, context: &str) -> Result<(), String> {
        self.conn
            .execute_batch("COMMIT")
            .map_err(|error| format!("Unable to commit {context} transaction: {error}"))
    }

    fn rollback_transaction_quiet(&self) {
        let _ = self.conn.execute_batch("ROLLBACK");
    }

    fn finish_transaction<T>(&self, result: Result<T, String>, context: &str) -> Result<T, String> {
        match result {
            Ok(value) => {
                if let Err(error) = self.commit_transaction(context) {
                    self.rollback_transaction_quiet();
                    Err(error)
                } else {
                    Ok(value)
                }
            }
            Err(error) => {
                self.rollback_transaction_quiet();
                Err(error)
            }
        }
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
    pub agent_slot_id: Option<String>,
    pub session_id: Option<String>,
    pub resource_id: Option<String>,
    pub artifact_id: Option<String>,
    pub context_run_id: Option<String>,
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
            agent_slot_id: patch["agent_slot_id"].as_str().map(str::to_string),
            session_id: patch["session_id"].as_str().map(str::to_string),
            resource_id: None,
            artifact_id: patch["diff_artifact_id"].as_str().map(str::to_string),
            context_run_id: patch["context_run_id"].as_str().map(str::to_string),
        }
    }
}

#[derive(Clone)]
struct ChangedFile {
    path: String,
    change_kind: String,
    untracked: bool,
}

fn is_coordination_owned_root_status_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    normalized == ".gitignore"
        || normalized == ".agents"
        || normalized.starts_with(".agents/")
        || normalized == "logs"
        || normalized.starts_with("logs/")
        || normalized == "logs/coordination-alignment.jsonl"
}

struct WorkspaceChangeInput<'a> {
    task_id: Option<&'a str>,
    agent_id: Option<&'a str>,
    agent_slot_id: Option<&'a str>,
    session_id: Option<&'a str>,
    worktree_id: Option<&'a str>,
    change_source: &'a str,
    path: &'a str,
    resource_key: &'a str,
    change_kind: &'a str,
    lease: Option<&'a Value>,
    violation_id: Option<&'a str>,
    summary: Option<&'a str>,
    details: Value,
}

struct ArtifactStorageLogInput<'a> {
    artifact_id: Option<&'a str>,
    task_id: Option<&'a str>,
    agent_id: Option<&'a str>,
    agent_slot_id: Option<&'a str>,
    artifact_kind: &'a str,
    requested_path: &'a str,
    stored_path: Option<&'a Path>,
    content_hash: Option<&'a str>,
    size_bytes: Option<i64>,
    status: &'a str,
    action: &'a str,
    error: Option<&'a str>,
    metadata: Value,
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

fn mcp_command_can_be_spawned(command: &str) -> bool {
    if command.trim().is_empty() {
        return false;
    }
    let path = Path::new(command);
    if path.is_absolute() || command.contains('/') || command.contains('\\') {
        path.exists()
    } else {
        true
    }
}

fn probe_mcp_stdio(command: &str, args: &[String]) -> Value {
    if command.trim().is_empty() {
        return json!({
            "responded": false,
            "status": "missing_command",
            "error": "MCP command is empty.",
            "tool_count": 0,
        });
    }

    let mut child = match Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return json!({
                "responded": false,
                "status": "spawn_failed",
                "error": error.to_string(),
                "tool_count": 0,
            });
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        let request = concat!(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}\n"
        );
        if let Err(error) = stdin.write_all(request.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            return json!({
                "responded": false,
                "status": "write_failed",
                "error": error.to_string(),
                "tool_count": 0,
            });
        }
    }

    let started_at = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started_at.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return json!({
                    "responded": false,
                    "status": "timeout",
                    "error": "MCP stdio probe timed out.",
                    "tool_count": 0,
                });
            }
            Err(error) => {
                let _ = child.kill();
                return json!({
                    "responded": false,
                    "status": "wait_failed",
                    "error": error.to_string(),
                    "tool_count": 0,
                });
            }
        }
    }

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
            return json!({
                "responded": false,
                "status": "read_failed",
                "error": error.to_string(),
                "tool_count": 0,
            });
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut initialize_responded = false;
    let mut tools_list_responded = false;
    let mut tool_count = 0usize;

    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match message["id"].as_i64() {
            Some(1) if message["result"]["serverInfo"]["name"].as_str().is_some() => {
                initialize_responded = true;
            }
            Some(2) => {
                tools_list_responded = message["result"]["tools"].as_array().is_some();
                tool_count = message["result"]["tools"]
                    .as_array()
                    .map(Vec::len)
                    .unwrap_or(0);
            }
            _ => {}
        }
    }

    let responded = initialize_responded && tools_list_responded && tool_count > 0;
    json!({
        "responded": responded,
        "status": if responded { "responded" } else { "invalid_response" },
        "initialize_responded": initialize_responded,
        "tools_list_responded": tools_list_responded,
        "tool_count": tool_count,
        "exit_code": output.status.code(),
        "stderr": if stderr.is_empty() { Value::Null } else { Value::String(stderr) },
    })
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
    let safe_directory = format!("safe.directory={}", git_safe_directory_value(cwd));
    let mut git_args = Vec::with_capacity(args.len() + 2);
    git_args.push("-c".to_string());
    git_args.push(safe_directory);
    git_args.extend(args.iter().map(|arg| (*arg).to_string()));
    let output = Command::new("git")
        .current_dir(PathBuf::from(process_path_text(cwd)))
        .args(&git_args)
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

fn git_safe_directory_value(path: &Path) -> String {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    process_path_text(&canonical).replace('\\', "/")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn write_json_file_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to serialize {}: {error}", path.display()))?;
    write_bytes_atomic(path, &body)
}

fn write_text_file_atomic(path: &Path, value: &str) -> Result<(), String> {
    write_bytes_atomic(path, value.as_bytes())
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create {}: {error}", parent.display()))?;
    }
    let tmp_path = path.with_file_name(format!(
        "{}.{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("atomic-write"),
        std::process::id(),
        uuid()
    ));
    {
        let mut file = fs::File::create(&tmp_path)
            .map_err(|error| format!("Unable to create {}: {error}", tmp_path.display()))?;
        file.write_all(bytes)
            .map_err(|error| format!("Unable to write {}: {error}", tmp_path.display()))?;
        file.sync_all()
            .map_err(|error| format!("Unable to flush {}: {error}", tmp_path.display()))?;
    }
    match fs::rename(&tmp_path, path) {
        Ok(_) => Ok(()),
        Err(first_error) if path.exists() => {
            fs::remove_file(path).map_err(|error| {
                format!(
                    "Unable to replace existing {} after rename failed ({first_error}): {error}",
                    path.display()
                )
            })?;
            fs::rename(&tmp_path, path).map_err(|error| {
                format!(
                    "Unable to replace {} with {}: {error}",
                    path.display(),
                    tmp_path.display()
                )
            })
        }
        Err(error) => Err(format!(
            "Unable to replace {} with {}: {error}",
            path.display(),
            tmp_path.display()
        )),
    }
}

fn codex_config_toml(
    command: &str,
    args: &[String],
    cloud: Option<(&str, &[String])>,
) -> String {
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

    if let Some((cloud_command, cloud_args)) = cloud {
        let cloud_args = cloud_args
            .iter()
            .map(|arg| format!("\"{}\"", toml_escape(arg)))
            .collect::<Vec<_>>()
            .join(", ");
        config.push_str(&format!(
            "\n[mcp_servers.cloud-diffforge]\ncommand = \"{}\"\nargs = [{}]\ndefault_tools_approval_mode = \"prompt\"\n",
            toml_escape(cloud_command),
            cloud_args
        ));
        for tool in CODEX_AUTO_APPROVED_CLOUD_MCP_TOOLS {
            config.push_str(&format!(
                "\n[mcp_servers.cloud-diffforge.tools.{}]\napproval_mode = \"approve\"\n",
                tool
            ));
        }
    }

    config
}

const CODEX_AUTO_APPROVED_CLOUD_MCP_TOOLS: &[&str] = &[
    "cloud_get_status",
    "cloud_get_context_pack",
    "cloud_get_workspace_snapshot",
    "cloud_record_history_event",
    "cloud_get_history_ledger",
    "cloud_subtask_checkpoint",
    "cloud_agent_heartbeat",
    "cloud_claim_lane",
    "cloud_release_lane",
    "cloud_create_context_task",
    "cloud_update_context_task",
];

fn cloud_mcp_base_url_for_config() -> String {
    std::env::var("CLOUD_DIFFFORGE_BASE_URL")
        .or_else(|_| std::env::var("CLOUD_MCP_BASE_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:8080".to_string())
}

fn cloud_mcp_repo_id_for_path(path: &Path) -> String {
    let input = process_path_text(path);
    let digest = Sha1::digest(input.as_bytes());
    let hash = format!("{digest:x}").chars().take(12).collect::<String>();
    format!("repo-{hash}")
}

const DIFFFORGE_AGENT_CONTRACT_BEGIN: &str = "<!-- DIFFFORGE_AGENT_CONTRACT_BEGIN -->";
const DIFFFORGE_AGENT_CONTRACT_END: &str = "<!-- DIFFFORGE_AGENT_CONTRACT_END -->";

fn diffforge_agent_contract_markdown() -> String {
    format!(
        "{DIFFFORGE_AGENT_CONTRACT_BEGIN}\n\
# Diff Forge agent coordination contract\n\n\
This workspace is coordinated by Diff Forge. The user prompt is still the source of truth, but every app-launched coding agent must publish public coordination state through Cloud MCP so parallel agents can stay in their lanes.\n\n\
## Required Cloud MCP flow for every user task\n\n\
1. Before inspecting or editing files, call `cloud-diffforge.cloud_get_context_pack` with the raw user prompt in `prompt` and your own concise `work_summary` or `task_title` describing what you are about to do.\n\
2. As soon as you know the concrete task, call `cloud-diffforge.cloud_agent_heartbeat` with `status: \"active\"`, the current lane if known, and a public `progress_summary`.\n\
3. After each file-change subtask, call `cloud-diffforge.cloud_subtask_checkpoint` with a terse `subtask`, `brief`, and changed file paths. Do this before moving to the next subtask.\n\
4. When finished, report completion with `cloud-diffforge.cloud_subtask_checkpoint` using `task_status: \"done\"` or update the active context task with `cloud-diffforge.cloud_update_context_task`.\n\
5. Keep briefs public and terse. Do not include hidden reasoning, raw terminal logs, secrets, credentials, or large source dumps.\n\n\
## Local coordination remains authoritative\n\n\
- Use the local coordination kernel for leases, memory, patch submission, and merge safety.\n\
- Edit only inside the assigned agent worktree/branch root when one is provided.\n\
- Cloud MCP is shared context and activity memory; it is not permission to bypass local file safety.\n\
{DIFFFORGE_AGENT_CONTRACT_END}\n"
    )
}

fn write_or_update_generated_agent_contract(path: &Path, contract: &str) -> Result<bool, String> {
    if path.exists() {
        let existing = fs::read_to_string(path)
            .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
        let Some(start) = existing.find(DIFFFORGE_AGENT_CONTRACT_BEGIN) else {
            return Ok(false);
        };
        let Some(end) = existing.find(DIFFFORGE_AGENT_CONTRACT_END) else {
            return Ok(false);
        };
        if end < start {
            return Ok(false);
        }
        let end_index = end + DIFFFORGE_AGENT_CONTRACT_END.len();
        let next = format!("{}{}{}", &existing[..start], contract, &existing[end_index..]);
        if next == existing {
            return Ok(false);
        }
        write_text_file_atomic(path, &next)?;
        return Ok(true);
    }

    write_text_file_atomic(path, contract)?;
    Ok(true)
}

fn ensure_git_info_exclude_entries(root: &Path, additions: &[&str]) -> Result<(), String> {
    let exclude_path_text = match run_git(root, &["rev-parse", "--git-path", "info/exclude"]) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    let exclude_path = {
        let trimmed = exclude_path_text.trim();
        let path = PathBuf::from(trimmed);
        if path.is_absolute() {
            path
        } else {
            root.join(path)
        }
    };
    if let Some(parent) = exclude_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create git exclude directory {}: {error}", parent.display()))?;
    }
    let existing = fs::read_to_string(&exclude_path).unwrap_or_default();
    let missing = additions
        .iter()
        .copied()
        .filter(|addition| !existing.lines().any(|line| line.trim() == *addition))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&exclude_path)
        .map_err(|error| format!("Unable to open {}: {error}", exclude_path.display()))?;
    if !existing.ends_with('\n') && !existing.is_empty() {
        writeln!(file).map_err(|error| format!("Unable to update {}: {error}", exclude_path.display()))?;
    }
    writeln!(file, "# Diff Forge generated agent instruction files")
        .map_err(|error| format!("Unable to update {}: {error}", exclude_path.display()))?;
    for addition in missing {
        writeln!(file, "{addition}")
            .map_err(|error| format!("Unable to update {}: {error}", exclude_path.display()))?;
    }
    Ok(())
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn short_id(value: &str) -> String {
    value.chars().take(8).collect()
}

fn merge_resolution_prompt(
    patch_id: &str,
    merge_job_id: &str,
    resolution_task_id: &str,
    changed_files: &[String],
    cloud_context: &Value,
) -> String {
    let files = if changed_files.is_empty() {
        "- none recorded".to_string()
    } else {
        changed_files
            .iter()
            .map(|path| format!("- {path}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let cloud_context_text =
        serde_json::to_string_pretty(cloud_context).unwrap_or_else(|_| cloud_context.to_string());
    format!(
        "Merge-resolution task initialized by the local coordination kernel.\n\n\
Goal:\n\
Resolve the submitted patch against the current target branch in your isolated worktree, then submit the resolved result as a new patch.\n\n\
IDs:\n\
- Patch: {patch_id}\n\
- Merge job: {merge_job_id}\n\
- Resolution task: {resolution_task_id}\n\n\
Changed files under your temporary resolution lease:\n\
{files}\n\n\
Required first step:\n\
Fetch Cloud MCP context using this context-pack seed so you know what other agents changed and why:\n\
```json\n{cloud_context_text}\n```\n\n\
Rules:\n\
- Stay inside the leased files above unless the local kernel grants more leases.\n\
- Do not call or attempt apply_merge.\n\
- Do not write directly to the shared project root.\n\
- Reconcile intent, not just text conflicts: preserve the submitted patch behavior and account for newer workspace changes.\n\
- When finished, call submit_patch for this resolution task.\n"
    )
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

fn normalize_agent_slot_key(value: &str) -> Result<String, String> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err("Agent slot key is required.".to_string());
    }
    if raw.contains('/') || raw.contains('\\') || raw.contains("..") {
        return Err("Agent slot key cannot contain path separators or '..'.".to_string());
    }
    if looks_like_uuid(raw) {
        return Err("Agent slot key must be stable and cannot be a UUID.".to_string());
    }
    let normalized = raw
        .chars()
        .map(|ch| {
            let ch = ch.to_ascii_lowercase();
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '.', '_'])
        .to_string();
    if normalized.is_empty() {
        return Err("Agent slot key normalizes to empty.".to_string());
    }
    if looks_like_uuid(&normalized) || looks_like_timestamp_key(&normalized) {
        return Err("Agent slot key must not be derived from a UUID or timestamp.".to_string());
    }
    Ok(normalized)
}

fn derive_slot_key(
    agent_kind: &str,
    pty_id: Option<&str>,
    explicit: Option<&str>,
) -> Result<String, String> {
    if let Some(explicit) = explicit.filter(|value| !value.trim().is_empty()) {
        return normalize_agent_slot_key(explicit);
    }
    let kind = safe_id(agent_kind);
    let kind = if kind.is_empty() {
        "agent".to_string()
    } else {
        kind
    };
    if let Some(pty_id) = pty_id {
        let parts = pty_id.split('-').collect::<Vec<_>>();
        for part in parts.iter().rev().skip(1) {
            if let Ok(index) = part.parse::<usize>() {
                return normalize_agent_slot_key(&format!("{kind}-{:02}", index + 1));
            }
        }
    }
    normalize_agent_slot_key(&format!("{kind}-01"))
}

fn looks_like_uuid(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.len() != 5 {
        return false;
    }
    let lengths = [8, 4, 4, 4, 12];
    parts
        .iter()
        .zip(lengths)
        .all(|(part, len)| part.len() == len && part.chars().all(|ch| ch.is_ascii_hexdigit()))
}

fn looks_like_timestamp_key(value: &str) -> bool {
    value.len() >= 10 && value.chars().all(|ch| ch.is_ascii_digit())
}

fn session_is_fresh(session: &Value) -> bool {
    if session["status"].as_str() != Some("active") {
        return false;
    }
    let Some(last_heartbeat) = session["last_heartbeat_at"].as_str() else {
        return false;
    };
    last_heartbeat >= rfc3339_after_seconds(-SESSION_STALE_SECONDS).as_str()
}

fn slug(value: &str) -> String {
    let slug = safe_id(value);
    if slug.is_empty() {
        "item".to_string()
    } else {
        slug
    }
}

fn normalize_task_dependency_kind(value: Option<&str>) -> String {
    let normalized = value.map(safe_id).unwrap_or_default();
    match normalized.as_str() {
        "" | "finish-before-start" => "finish_before_start".to_string(),
        "blocks" => "blocks".to_string(),
        "requires" => "requires".to_string(),
        "review-before-start" => "review_before_start".to_string(),
        _ => normalized.replace('-', "_"),
    }
}

fn task_dependency_satisfied_status(status: &str) -> bool {
    matches!(
        status,
        "done" | "completed" | "merged" | "cancelled" | "skipped"
    )
}

fn suffixed_path(path: &Path, suffix: &str) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact");
    let filename = if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        format!("{stem}_{suffix}.{extension}")
    } else {
        format!("{stem}_{suffix}")
    };
    parent.join(filename)
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

fn normalize_trust_level(value: Option<&str>) -> Result<String, String> {
    let trust_level = value.unwrap_or("draft").trim().to_ascii_lowercase();
    match trust_level.as_str() {
        "" | "draft" => Ok("draft".to_string()),
        "certified" => Ok("certified".to_string()),
        _ => Err("Memory trust_level must be draft or certified.".to_string()),
    }
}

fn is_trusted_memory_certifier(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value == "local" || value.starts_with("ui:") || value.starts_with("human:")
}

fn db_change_kind_destructive(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "remove_table"
            | "drop_table"
            | "remove_column"
            | "drop_column"
            | "remove_index"
            | "drop_index"
            | "remove_constraint"
            | "drop_constraint"
            | "remove_enum"
            | "drop_enum"
            | "remove_view"
            | "drop_view"
            | "remove_function"
            | "drop_function"
            | "rename_table"
            | "rename_column"
            | "rollback"
            | "truncate"
            | "delete_data"
    )
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

fn normalize_change_path(value: &str) -> Result<String, String> {
    reject_path_escape(value)?;
    let normalized = value.replace('\\', "/");
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err("Changed path escapes the worktree root.".to_string()),
            _ => parts.push(part),
        }
    }
    let path = parts.join("/");
    if path.is_empty() {
        return Err("Changed path is required.".to_string());
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        process::Command,
        sync::{Arc, Barrier},
        thread,
    };

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
    fn atomic_text_writes_use_isolated_temp_files_under_concurrency() {
        let repo = temp_repo("atomic_text_concurrency");
        let path = repo.join("coordination.codex.toml");
        let writers = 16;
        let barrier = Arc::new(Barrier::new(writers));
        let handles = (0..writers)
            .map(|index| {
                let barrier = Arc::clone(&barrier);
                let path = path.clone();
                thread::spawn(move || {
                    barrier.wait();
                    write_text_file_atomic(&path, &format!("writer-{index}\n"))
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().unwrap().unwrap();
        }

        let final_body = fs::read_to_string(&path).unwrap();
        assert!(final_body.starts_with("writer-"));
        let temp_files = fs::read_dir(&repo)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("tmp")
            })
            .count();
        assert_eq!(temp_files, 0);
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
    }

    #[test]
    fn storage_and_schema_migration_logging_is_persisted() {
        let repo = temp_repo("storage_logging");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();

        let storage_events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='kernel_storage_opened'",
                &[],
            )
            .unwrap();
        assert_eq!(storage_events.len(), 1);
        let payload = &storage_events[0]["payload_json"];
        assert_eq!(payload["wal_enabled"].as_bool(), Some(true));
        assert_eq!(payload["foreign_keys_enabled"].as_bool(), Some(true));
        assert_eq!(payload["busy_timeout_ms"].as_i64(), Some(30_000));
        assert!(
            payload["paths"]["ensured_directory_count"]
                .as_i64()
                .unwrap_or_default()
                > 0
        );
        assert!(payload["migrations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|migration| migration["name"].as_str() == Some("coordination_kernel_initial")));

        let migration_events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type IN ('schema_migration_applied', 'schema_migration_checked', 'schema_migration_ensured')",
                &[],
            )
            .unwrap();
        assert!(migration_events
            .iter()
            .any(|event| event["payload_json"]["name"].as_str()
                == Some("coordination_kernel_runtime_guards")));

        let migration_rows = kernel
            .query_json("SELECT * FROM schema_migrations ORDER BY version", &[])
            .unwrap();
        assert!(migration_rows
            .iter()
            .any(|row| row["version"].as_i64() == Some(1)));
        assert!(migration_rows
            .iter()
            .any(|row| row["version"].as_i64() == Some(3)));
        assert!(migration_rows
            .iter()
            .any(|row| row["version"].as_i64() == Some(5)));

        if alignment::is_enabled() {
            let log = fs::read_to_string(alignment::log_path(&repo)).unwrap();
            assert!(log.contains("\"event\":\"kernel.initialized\""));
        }
    }

    #[test]
    fn repo_policy_gate_rejects_unsafe_downgrades() {
        let repo = temp_repo("policy_gate");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();

        assert!(kernel
            .update_repo_policy(&json!({"agent_worktree_required": false}))
            .is_err());
        assert!(kernel
            .update_repo_policy(&json!({"patch_lease_validation_required": 0}))
            .is_err());
        assert!(kernel
            .update_repo_policy(&json!({"merge_gate_required": false}))
            .is_err());
        assert!(kernel
            .update_repo_policy(&json!({"unleased_write_policy": "warn"}))
            .is_err());
        assert!(kernel
            .update_repo_policy(&json!({"raw_sql_mcp_allowed": true}))
            .is_err());

        let policy = kernel.repo_policy().unwrap();
        assert_eq!(policy["agent_worktree_required"].as_i64(), Some(1));
        assert_eq!(policy["patch_lease_validation_required"].as_i64(), Some(1));
        assert_eq!(policy["merge_gate_required"].as_i64(), Some(1));
        assert_eq!(
            policy["unleased_write_policy"].as_str(),
            Some("reject_patch")
        );
        assert_eq!(policy["raw_sql_mcp_allowed"].as_i64(), Some(0));
    }

    #[test]
    fn slot_busy_rejects_different_fresh_pty() {
        let repo = init_git_repo("slot_busy");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let first = kernel
            .create_session_for_slot_key(
                "codex-01",
                "Codex",
                "codex",
                None,
                None,
                Some("workspace-terminal-test-0-codex"),
                true,
                None,
                None,
            )
            .unwrap();
        let second = kernel.create_session_for_slot_key(
            "codex-01",
            "Codex",
            "codex",
            None,
            None,
            Some("workspace-terminal-test-1-codex"),
            true,
            None,
            None,
        );

        assert!(second.unwrap_err().contains("slot_busy"));
        let busy_events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='agent_slot_busy'",
                &[],
            )
            .unwrap();
        assert_eq!(busy_events.len(), 1);
        let active = kernel
            .query_json(
                "SELECT * FROM agent_sessions WHERE agent_slot_id=?1 AND status='active'",
                &[&first["agentSlotId"].as_str().unwrap()],
            )
            .unwrap();
        assert_eq!(active.len(), 1);
    }

    #[test]
    fn slot_busy_repairs_missing_active_session_pointer() {
        let repo = init_git_repo("slot_busy_pointer_repair");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let first = kernel
            .create_session_for_slot_key(
                "codex-01",
                "Codex",
                "codex",
                None,
                None,
                Some("workspace-terminal-test-0-codex"),
                true,
                None,
                None,
            )
            .unwrap();
        let slot_id = first["agentSlotId"].as_str().unwrap();
        let session_id = first["id"].as_str().unwrap();
        kernel
            .conn
            .execute(
                "UPDATE agent_slots SET active_session_id=NULL WHERE id=?1",
                params![slot_id],
            )
            .unwrap();

        let second = kernel.create_session_for_slot_key(
            "codex-01",
            "Codex",
            "codex",
            None,
            None,
            Some("workspace-terminal-test-1-codex"),
            true,
            None,
            None,
        );
        assert!(second.unwrap_err().contains("slot_busy"));
        let slot = kernel.get_agent_slot_by_id(slot_id).unwrap();
        assert_eq!(slot["active_session_id"].as_str(), Some(session_id));
    }

    #[test]
    fn mcp_activation_files_are_slot_stable_and_worktree_scoped() {
        let repo = init_git_repo("mcp_activation");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let session = kernel
            .create_session_for_slot_key(
                "codex-01",
                "Codex",
                "codex",
                None,
                None,
                Some("workspace-terminal-test-0-codex"),
                true,
                None,
                None,
            )
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let mcp_config_path = session["mcpConfigPath"].as_str().unwrap();
        let worktree_path = session["writeRoot"].as_str().unwrap();

        assert!(normalize_path_for_compare(mcp_config_path)
            .ends_with(".agents/mcp/agents/codex-01.json"));
        assert!(!mcp_config_path.contains(session_id));
        assert!(PathBuf::from(mcp_config_path).exists());
        assert!(repo
            .join(".agents")
            .join("mcp")
            .join("agents")
            .join("codex-01.codex.toml")
            .exists());
        assert!(repo
            .join(".agents")
            .join("mcp")
            .join("agents")
            .join("codex-01.claude.json")
            .exists());

        let worktree = PathBuf::from(worktree_path);
        assert!(path_text_under_path(
            worktree_path,
            &kernel.paths.worktrees_root
        ));
        assert!(worktree.join(".mcp.json").exists());
        assert!(worktree.join(".codex").join("config.toml").exists());
        assert!(!repo.join(".mcp.json").exists());
        assert!(!repo.join(".codex").join("config.toml").exists());
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
            let log = fs::read_to_string(log_path).unwrap();
            assert!(log.contains("\"event\":\"alignment.report_generated\""));
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
            "get_slot_status",
            "db_classify_sql",
            "db_request_approval",
            "request_approval",
        ] {
            assert!(config.contains(&format!(
                "[mcp_servers.coordination-kernel.tools.{tool}]\napproval_mode = \"approve\""
            )));
        }
        for prompt_gated_tool in [
            "submit_patch",
            "resolve_workspace_violation",
            "db_query_readonly",
            "db_propose_migration",
            "db_validate_shadow",
            "write_memory",
            "request_merge",
        ] {
            assert!(!config.contains(&format!(
                "[mcp_servers.coordination-kernel.tools.{prompt_gated_tool}]"
            )));
        }
    }

    #[test]
    fn local_mcp_surface_keeps_merge_resolution_and_apply_trusted() {
        let repo = temp_repo("mcp_surface");
        let _kernel = CoordinationKernel::init(&repo, None).unwrap();
        let tools = crate::coordination::mcp::TOOL_NAMES;
        assert!(!tools.contains(&"request_merge"));
        assert!(!tools.contains(&"resolve_workspace_violation"));
        assert!(!tools.contains(&"apply_merge"));

        let response = crate::coordination::mcp::dispatch_tool(
            &crate::coordination::mcp::McpContext::default(),
            "resolve_workspace_violation",
            json!({
                "repo_path": process_path_text(&repo),
                "violation_id": "v1",
                "resolution": "resolved",
                "human_actor": "human:test"
            }),
        );
        assert_eq!(response["ok"].as_bool(), Some(false));
        assert_eq!(response["error"]["code"].as_str(), Some("unknown_tool"));
        let allowed = response["error"]["details"]["allowed_tools"]
            .as_array()
            .unwrap();
        assert!(!allowed
            .iter()
            .any(|tool| tool.as_str() == Some("request_merge")));
        assert!(!allowed
            .iter()
            .any(|tool| tool.as_str() == Some("resolve_workspace_violation")));
    }

    #[test]
    fn agent_mcp_tool_call_records_client_mount_proof() {
        let repo = temp_repo("mcp_client_mount");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap().to_string();
        let session = kernel
            .create_session(&agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap().to_string();
        let agent_slot_id = session["agentSlotId"].as_str().map(str::to_string);
        let slot_key = session["slotKey"].as_str().map(str::to_string);

        let initial = kernel.mcp_client_mount_summary().unwrap();
        assert_eq!(initial["status"].as_str(), Some("not_seen"));

        let response = crate::coordination::mcp::dispatch_tool(
            &crate::coordination::mcp::McpContext {
                repo_path: Some(process_path_text(&repo)),
                agent_id: Some(agent_id.clone()),
                agent_slot_id,
                slot_key,
                session_id: Some(session_id.clone()),
                ..crate::coordination::mcp::McpContext::default()
            },
            "get_brief",
            json!({}),
        );
        assert_eq!(response["ok"].as_bool(), Some(true));

        let summary = kernel.mcp_client_mount_summary().unwrap();
        assert_eq!(summary["status"].as_str(), Some("confirmed"));
        assert_eq!(summary["confirmed_session_count"].as_u64(), Some(1));
        assert_eq!(summary["mounts"][0]["status"].as_str(), Some("confirmed"));

        let events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='mcp_agent_tool_called' AND session_id=?1",
                &[&session_id],
            )
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0]["payload_json"]["details"]["tool"].as_str(),
            Some("get_brief")
        );
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
    fn task_dependencies_block_claim_until_satisfied_and_log() {
        let repo = temp_repo("task_dependencies");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let prerequisite = kernel
            .create_task("Prerequisite", None, 0, 1, None, None, None, None)
            .unwrap();
        let dependent = kernel
            .create_task("Dependent", None, 0, 1, None, None, None, None)
            .unwrap();
        let prerequisite_id = prerequisite["id"].as_str().unwrap();
        let dependent_id = dependent["id"].as_str().unwrap();

        kernel
            .add_task_dependency(dependent_id, prerequisite_id, None)
            .unwrap();
        let blocked = kernel
            .claim_task(dependent_id, agent_id, session_id)
            .unwrap();
        assert_eq!(blocked["ok"].as_bool(), Some(false));
        assert_eq!(blocked["error"]["code"].as_str(), Some("task_blocked"));
        let task = kernel
            .query_one(
                "SELECT status FROM tasks WHERE id=?1",
                &[&dependent_id],
                "missing task",
            )
            .unwrap();
        assert_eq!(task["status"].as_str(), Some("blocked"));
        assert!(
            !kernel.list_task_dependencies(Some(dependent_id)).unwrap()["data"]
                ["blocking_dependencies"]
                .as_array()
                .unwrap()
                .is_empty()
        );

        kernel
            .conn
            .execute(
                "UPDATE tasks SET status='merged', updated_at=?1 WHERE id=?2",
                params![now_rfc3339(), prerequisite_id],
            )
            .unwrap();
        kernel.refresh_dependent_tasks(prerequisite_id).unwrap();
        let task = kernel
            .query_one(
                "SELECT status FROM tasks WHERE id=?1",
                &[&dependent_id],
                "missing task",
            )
            .unwrap();
        assert_eq!(task["status"].as_str(), Some("ready"));
        let claimed = kernel
            .claim_task(dependent_id, agent_id, session_id)
            .unwrap();
        assert_eq!(claimed["status"].as_str(), Some("claimed"));
        let events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type IN ('task_dependency_created', 'task_blocked', 'task_dependency_satisfied', 'task_unblocked')",
                &[],
            )
            .unwrap();
        for event_type in [
            "task_dependency_created",
            "task_blocked",
            "task_dependency_satisfied",
            "task_unblocked",
        ] {
            assert!(events
                .iter()
                .any(|event| event["event_type"].as_str() == Some(event_type)));
        }
    }

    #[test]
    fn task_dependency_cycles_are_rejected_and_logged() {
        let repo = temp_repo("task_dependency_cycle");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let first = kernel
            .create_task("First", None, 0, 1, None, None, None, None)
            .unwrap();
        let second = kernel
            .create_task("Second", None, 0, 1, None, None, None, None)
            .unwrap();
        let first_id = first["id"].as_str().unwrap();
        let second_id = second["id"].as_str().unwrap();

        kernel
            .add_task_dependency(first_id, second_id, Some("requires"))
            .unwrap();
        let reused = kernel
            .add_task_dependency(first_id, second_id, Some("requires"))
            .unwrap();
        assert_eq!(reused["reused"].as_bool(), Some(true));
        assert!(kernel
            .add_task_dependency(second_id, first_id, Some("requires"))
            .is_err());
        let rejected = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='task_dependency_rejected'",
                &[],
            )
            .unwrap();
        assert_eq!(rejected.len(), 1);
        let report = kernel.get_alignment_report().unwrap();
        assert!(report["data"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(
                |check| check["check"].as_str() == Some("task_dependencies.graph_integrity")
                    && check["status"].as_str() == Some("aligned")
            ));
    }

    #[test]
    fn task_scoped_changes_require_session_claim() {
        let repo = temp_repo("task_scope");
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

        assert!(kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "file:src/a.js",
                "write",
                Some(100),
                None,
            )
            .is_err());
        assert!(kernel
            .announce_change(
                task_id,
                agent_id,
                session_id,
                vec!["src/a.js".to_string()],
                None
            )
            .is_err());
    }

    #[test]
    fn announce_change_records_durable_changes_events_and_unleased_violations() {
        let repo = temp_repo("change_tracking_manual");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let task = kernel
            .create_task("Track changes", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "file:src/leased.js",
                "write",
                Some(100),
                None,
            )
            .unwrap();

        let response = kernel
            .announce_change(
                task_id,
                agent_id,
                session_id,
                vec!["src/leased.js".to_string(), "src/unleased.js".to_string()],
                Some("manual progress update"),
            )
            .unwrap();
        assert_eq!(response["ok"].as_bool(), Some(true));
        assert_eq!(response["warnings"].as_array().unwrap().len(), 1);

        let changes = kernel
            .list_workspace_changes(
                Some(task_id),
                Some(agent_id),
                Some(session_id),
                None,
                None,
                None,
            )
            .unwrap();
        let rows = changes["data"]["changes"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|change| {
            change["path"].as_str() == Some("src/leased.js")
                && change["lease_status"].as_str() == Some("covered")
        }));
        assert!(rows.iter().any(|change| {
            change["path"].as_str() == Some("src/unleased.js")
                && change["lease_status"].as_str() == Some("unleased")
                && change["violation_id"].as_str().is_some()
        }));

        let file_changed_events = kernel
            .query_json("SELECT * FROM events WHERE event_type='file_changed'", &[])
            .unwrap();
        assert_eq!(file_changed_events.len(), 2);
        let violations = kernel
            .query_json(
                "SELECT * FROM workspace_violations WHERE violation_kind='unleased_write'",
                &[],
            )
            .unwrap();
        assert_eq!(violations.len(), 1);

        let report = kernel.get_alignment_report().unwrap();
        assert!(report["data"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| {
                check["check"].as_str() == Some("change_tracking.unleased_visibility")
                    && check["status"].as_str() == Some("aligned")
            }));
    }

    #[test]
    fn workspace_violation_resolution_requires_trusted_actor_and_logs() {
        let repo = temp_repo("violation_resolution");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let violation_id = kernel
            .create_workspace_violation(
                None,
                None,
                None,
                None,
                "manual_block",
                Some("src.txt"),
                Some("file:src.txt"),
                "error",
                json!({}),
            )
            .unwrap();

        assert!(kernel
            .resolve_workspace_violation(
                &violation_id,
                "resolved",
                "Agent attempted to resolve.",
                "agent:codex",
            )
            .is_err());
        let rejected_events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='workspace_violation_resolution_rejected'",
                &[],
            )
            .unwrap();
        assert_eq!(rejected_events.len(), 1);
        let still_open = kernel
            .query_one(
                "SELECT status FROM workspace_violations WHERE id=?1",
                &[&violation_id],
                "missing violation",
            )
            .unwrap();
        assert_eq!(still_open["status"].as_str(), Some("open"));

        let resolved = kernel
            .resolve_workspace_violation(
                &violation_id,
                "resolved",
                "Reviewed in local UI.",
                "human:reviewer",
            )
            .unwrap();
        assert_eq!(resolved["data"]["status"].as_str(), Some("resolved"));
        let row = kernel
            .query_one(
                "SELECT * FROM workspace_violations WHERE id=?1",
                &[&violation_id],
                "missing violation",
            )
            .unwrap();
        assert_eq!(row["status"].as_str(), Some("resolved"));
        assert_eq!(
            row["details_json"]["human_actor"].as_str(),
            Some("human:reviewer")
        );
        assert!(kernel
            .resolve_workspace_violation(
                &violation_id,
                "overridden",
                "Already handled.",
                "human:reviewer",
            )
            .is_err());
        let report = kernel.get_alignment_report().unwrap();
        assert!(report["data"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| {
                check["check"].as_str() == Some("violations.resolution_authority")
                    && check["status"].as_str() == Some("aligned")
            }));
    }

    #[test]
    fn scan_workspace_changes_records_git_status_changes_and_scan_logs() {
        let repo = init_git_repo("change_tracking_scan");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, Some("pty-change-scan"), true, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let task = kernel
            .create_task("Scan changes", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        let write_root = PathBuf::from(session["writeRoot"].as_str().unwrap());
        fs::write(write_root.join("src.txt"), "changed\n").unwrap();

        let scan = kernel.scan_workspace_changes().unwrap();
        assert_eq!(scan["ok"].as_bool(), Some(true));
        assert_eq!(scan["data"]["scanner"].as_str(), Some("git_status"));
        assert!(!scan["data"]["changes"].as_array().unwrap().is_empty());

        let changes = kernel
            .query_json(
                "SELECT * FROM workspace_changes WHERE change_source='watcher_scan'",
                &[],
            )
            .unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["path"].as_str(), Some("src.txt"));
        assert_eq!(changes[0]["lease_status"].as_str(), Some("unleased"));
        assert!(changes[0]["violation_id"].as_str().is_some());
        let scan_events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type IN ('change_scan_started', 'change_scan_finished')",
                &[],
            )
            .unwrap();
        assert_eq!(scan_events.len(), 2);
    }

    #[test]
    fn file_watcher_runtime_start_stop_and_manual_scan_are_logged() {
        let repo = init_git_repo("file_watcher_runtime");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, Some("pty-file-watcher"), true, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let task = kernel
            .create_task("Watch changes", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();

        let started = crate::coordination::watcher::start_file_watcher(
            &kernel,
            Some(json!({"debounce_ms": 100, "refresh_ms": 1000})),
        )
        .unwrap();
        assert_eq!(started["data"]["status"].as_str(), Some("running"));
        assert!(!started["data"]["watched_paths"]
            .as_array()
            .unwrap()
            .is_empty());

        let status = crate::coordination::watcher::file_watcher_status(&kernel).unwrap();
        assert_eq!(
            status["data"]["runtime"]["status"].as_str(),
            Some("running")
        );
        let manual_scan = crate::coordination::watcher::scan_known_violations(&kernel).unwrap();
        assert_eq!(manual_scan["ok"].as_bool(), Some(true));

        let stopped = crate::coordination::watcher::stop_file_watcher(&kernel).unwrap();
        assert_eq!(stopped["data"]["status"].as_str(), Some("stopped"));
        let watcher_rows = kernel
            .query_json("SELECT * FROM file_watchers", &[])
            .unwrap();
        assert_eq!(watcher_rows.len(), 1);
        assert_eq!(watcher_rows[0]["status"].as_str(), Some("stopped"));

        let events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type LIKE 'file_watcher_%'",
                &[],
            )
            .unwrap();
        for event_type in [
            "file_watcher_started",
            "file_watcher_manual_scan_started",
            "file_watcher_manual_scan_finished",
            "file_watcher_stopped",
        ] {
            assert!(events
                .iter()
                .any(|event| event["event_type"].as_str() == Some(event_type)));
        }
    }

    #[test]
    fn lease_rejects_path_escape_and_unknown_mode() {
        let repo = temp_repo("lease_validation");
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

        assert!(kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "file:../secret.txt",
                "write",
                Some(100),
                None,
            )
            .is_err());
        assert!(kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "file:src/a.js",
                "pretend_write",
                Some(100),
                None,
            )
            .is_err());
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
    fn recovery_interrupts_active_session_with_missing_worktree_path() {
        let repo = init_git_repo("missing_worktree_recovery");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(
                agent_id,
                None,
                Some("pty-missing-worktree"),
                true,
                None,
                None,
            )
            .unwrap();
        let session_id = session["id"].as_str().unwrap().to_string();
        let worktree_path = PathBuf::from(session["writeRoot"].as_str().unwrap());
        fs::remove_dir_all(&worktree_path).unwrap();
        drop(kernel);

        let recovered = CoordinationKernel::init(&repo, None).unwrap();
        let session = recovered
            .query_one(
                "SELECT status FROM agent_sessions WHERE id=?1",
                &[&session_id],
                "missing session",
            )
            .unwrap();
        assert_eq!(session["status"].as_str(), Some("interrupted"));
        let violations = recovered
            .query_json(
                "SELECT * FROM workspace_violations WHERE session_id=?1 AND violation_kind='invalid_worktree_isolation'",
                &[&session_id],
            )
            .unwrap();
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0]["severity"].as_str(), Some("error"));
        let events = recovered
            .query_json(
                "SELECT * FROM events WHERE event_type='agent_interrupted' AND session_id=?1",
                &[&session_id],
            )
            .unwrap();
        assert!(events
            .iter()
            .any(|event| event["payload_json"]["reason"].as_str()
                == Some("invalid_worktree_isolation_recovered")));
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
    fn same_pty_session_reuses_slot_session_and_worktree() {
        let repo = init_git_repo("same_pty_slot_reuse");
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
        assert_eq!(first_id, second_id);
        assert_eq!(first_worktree_id, second_worktree_id);
        assert_eq!(first["mcpConfigPath"], second["mcpConfigPath"]);
        kernel
            .conn
            .execute(
                "UPDATE agent_sessions SET updated_at='1000.000Z' WHERE id=?1",
                params![first_id],
            )
            .unwrap();
        drop(kernel);

        let recovered = CoordinationKernel::open(&repo, None).unwrap();
        let session = recovered
            .query_one(
                "SELECT status FROM agent_sessions WHERE id=?1",
                &[&first_id],
                "missing session",
            )
            .unwrap();
        let worktree = recovered
            .query_one(
                "SELECT status FROM worktrees WHERE id=?1",
                &[&first_worktree_id],
                "missing worktree",
            )
            .unwrap();
        assert_eq!(session["status"].as_str(), Some("active"));
        assert_eq!(worktree["status"].as_str(), Some("active"));
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
        let blockers = conflict["error"]["details"]["blockers"].as_array().unwrap();
        assert_eq!(blockers.len(), 1);
        assert_eq!(
            blockers[0]["mode_conflict_reason"].as_str(),
            Some("write_like_modes_conflict")
        );
        assert_eq!(
            blockers[0]["resource_conflict_reason"].as_str(),
            Some("glob_covers_file")
        );
        let conflict_rows = kernel
            .query_json("SELECT * FROM lease_conflicts", &[])
            .unwrap();
        assert_eq!(conflict_rows.len(), 1);
        let detector_events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='lease_conflict_detected'",
                &[],
            )
            .unwrap();
        assert_eq!(detector_events.len(), 1);
        assert_eq!(
            detector_events[0]["payload_json"]["resource_conflict_reason"].as_str(),
            Some("glob_covers_file")
        );
        let resources = kernel.list_resources(None, None).unwrap();
        assert!(resources["data"]["resources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|resource| resource["resource_key"].as_str() == Some("file:src/a.js")));
    }

    #[test]
    fn memory_write_works() {
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
    }

    #[test]
    fn artifact_storage_is_rooted_and_does_not_overwrite_different_content() {
        let repo = temp_repo("artifact_storage");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        assert!(kernel
            .write_artifact(None, None, "test", "../escape.txt", b"nope", json!({}))
            .is_err());

        let first_id = kernel
            .write_artifact(None, None, "test", "runs/evidence.txt", b"one", json!({}))
            .unwrap();
        let second_id = kernel
            .write_artifact(None, None, "test", "runs/evidence.txt", b"two", json!({}))
            .unwrap();
        let first = kernel.get_artifact(&first_id).unwrap();
        let second = kernel.get_artifact(&second_id).unwrap();
        let first_path = PathBuf::from(first["path"].as_str().unwrap());
        let second_path = PathBuf::from(second["path"].as_str().unwrap());

        assert_ne!(first_path, second_path);
        assert_eq!(fs::read(&first_path).unwrap(), b"one");
        assert_eq!(fs::read(&second_path).unwrap(), b"two");
        let storage_logs = kernel
            .query_json(
                "SELECT * FROM artifact_storage_logs ORDER BY created_at ASC",
                &[],
            )
            .unwrap();
        assert_eq!(storage_logs.len(), 3);
        assert!(storage_logs.iter().any(|log| {
            log["status"].as_str() == Some("rejected")
                && log["action"].as_str() == Some("path_rejected")
        }));
        assert_eq!(
            storage_logs
                .iter()
                .filter(|log| log["status"].as_str() == Some("stored"))
                .count(),
            2
        );
        let storage_events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type IN ('artifact_storage_logged', 'artifact_storage_failed')",
                &[],
            )
            .unwrap();
        assert_eq!(storage_events.len(), 3);
        let report = kernel.get_alignment_report().unwrap();
        assert!(report["data"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| {
                check["check"].as_str() == Some("artifact_storage.logs")
                    && check["status"].as_str() == Some("aligned")
            }));
    }

    #[test]
    fn certified_memory_requires_evidence_or_trusted_ui_certifier() {
        let repo = temp_repo("memory_certification");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        assert!(kernel
            .write_memory(
                "decision",
                "No proof",
                "body",
                Some("certified"),
                None,
                None,
                None,
                None,
                None,
            )
            .is_err());
        assert!(kernel
            .write_memory(
                "decision",
                "Bad proof",
                "body",
                Some("certified"),
                None,
                Some("missing-artifact"),
                None,
                None,
                None,
            )
            .is_err());

        let artifact_id = kernel
            .write_artifact(
                None,
                None,
                "evidence",
                "memory/evidence.txt",
                b"proof",
                json!({}),
            )
            .unwrap();
        let memory = kernel
            .write_memory(
                "decision",
                "With proof",
                "Certified body",
                Some("certified"),
                None,
                Some(&artifact_id),
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(memory["data"]["memory_kind"].as_str(), Some("decision"));
        let ui_memory = kernel
            .write_memory(
                "decision",
                "UI proof",
                "Certified by UI",
                Some("certified"),
                None,
                None,
                None,
                None,
                Some("human:reviewer"),
            )
            .unwrap();
        assert_eq!(ui_memory["ok"].as_bool(), Some(true));
        let rejected = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='memory_write_rejected'",
                &[],
            )
            .unwrap();
        assert_eq!(rejected.len(), 2);
        let certified = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type='memory_certified'",
                &[],
            )
            .unwrap();
        assert_eq!(certified.len(), 2);
        let memories = kernel
            .query_json("SELECT * FROM memories ORDER BY created_at ASC", &[])
            .unwrap();
        assert_eq!(memories.len(), 2);
        for memory in &memories {
            assert!(PathBuf::from(memory["body_path"].as_str().unwrap()).exists());
        }
        let report = kernel.get_alignment_report().unwrap();
        for check_name in ["memory.body_files", "memory.certification", "memory.logs"] {
            assert!(report["data"]["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|check| {
                    check["check"].as_str() == Some(check_name)
                        && check["status"].as_str() == Some("aligned")
                }));
        }
    }

    #[test]
    fn approval_gate_requires_claim_and_trusted_resolution() {
        let repo = temp_repo("approval_gate");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let task = kernel
            .create_task("Needs approval", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        assert!(kernel
            .request_approval(task_id, agent_id, None, "merge", "please", None)
            .is_err());

        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        let approval = kernel
            .request_approval(
                task_id,
                agent_id,
                Some(session_id),
                "merge",
                "please",
                Some("safe after review"),
            )
            .unwrap();
        let reused = kernel
            .request_approval(
                task_id,
                agent_id,
                Some(session_id),
                "merge",
                "please again",
                None,
            )
            .unwrap();
        assert_eq!(reused["data"]["reused"].as_bool(), Some(true));

        let approval_id = approval["data"]["approval_id"].as_str().unwrap();
        assert!(kernel
            .resolve_approval(approval_id, "approved", "agent-fake", None)
            .is_err());
        let resolved = kernel
            .resolve_approval(approval_id, "approved", "human:reviewer", None)
            .unwrap();
        assert_eq!(resolved["data"]["status"].as_str(), Some("approved"));
        assert!(kernel
            .resolve_approval(approval_id, "denied", "human:reviewer", None)
            .is_err());
        let logs = kernel
            .query_json("SELECT * FROM approval_gate_logs", &[])
            .unwrap();
        assert!(logs.iter().any(|log| {
            log["action"].as_str() == Some("request") && log["status"].as_str() == Some("rejected")
        }));
        assert!(logs.iter().any(|log| {
            log["approval_id"].as_str() == Some(approval_id)
                && log["action"].as_str() == Some("request")
                && log["status"].as_str() == Some("pending")
        }));
        assert!(logs.iter().any(|log| {
            log["approval_id"].as_str() == Some(approval_id)
                && log["action"].as_str() == Some("resolve")
                && log["status"].as_str() == Some("approved")
        }));
        let events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type IN ('approval_request_rejected', 'approval_request_reused', 'approval_resolution_rejected', 'approval_granted')",
                &[],
            )
            .unwrap();
        assert!(events.len() >= 4);
    }

    #[test]
    fn ui_surface_and_cleanup_bloat_logs_are_durable() {
        let repo = temp_repo("ui_cleanup_logs");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let ui_log = kernel
            .log_ui_surface_event(&json!({
                "surface": "coordination_workspace",
                "action": "refresh",
                "status": "succeeded",
                "command_name": "coordination_get_snapshot",
                "details": {"taskCount": 0}
            }))
            .unwrap();
        assert_eq!(ui_log["ok"].as_bool(), Some(true));

        fs::write(kernel.paths.mcp_root.join("session-123.json"), "{}").unwrap();
        fs::create_dir_all(kernel.paths.worktrees_root.join("codex-01-session")).unwrap();
        let audit = kernel.cleanup_bloat_dry_run().unwrap();
        assert_eq!(audit["ok"].as_bool(), Some(true));
        assert_eq!(audit["data"]["status"].as_str(), Some("attention_required"));
        assert_eq!(
            audit["data"]["unexpected_mcp_files"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            audit["data"]["unexpected_worktree_dirs"]
                .as_array()
                .unwrap()
                .len(),
            1
        );

        assert_eq!(
            kernel
                .query_json("SELECT * FROM coordination_ui_surface_logs", &[])
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            kernel
                .query_json("SELECT * FROM coordination_bloat_audits", &[])
                .unwrap()
                .len(),
            1
        );
        let events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type IN ('ui_surface_logged', 'coordination_bloat_audit_started', 'coordination_bloat_audit_finished')",
                &[],
            )
            .unwrap();
        assert_eq!(events.len(), 3);
        let snapshot = kernel.get_snapshot().unwrap();
        assert_eq!(
            snapshot["data"]["ui_surface_logs"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            snapshot["data"]["bloat_audits"].as_array().unwrap().len(),
            1
        );

        let report = kernel.get_alignment_report().unwrap();
        for check_name in [
            "tauri_ui.surface_logs",
            "tauri_ui.snapshot_debug_surface",
            "cleanup_bloat.audit_logs",
            "cleanup_bloat.no_automatic_delete",
        ] {
            assert!(report["data"]["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|check| {
                    check["check"].as_str() == Some(check_name)
                        && check["status"].as_str() == Some("aligned")
                }));
        }
    }

    #[test]
    fn production_sql_change_requests_require_db_leases_and_human_approval() {
        let repo = temp_repo("prod_sql_coordination");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        kernel
            .update_repo_policy(&json!({
                "repo_has_sql": true,
                "sql_engine": "postgres",
                "sql_mcp_default": "proposal_only"
            }))
            .unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let task = kernel
            .create_task("Add timezone", None, 0, 2, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();

        let missing_lease = kernel
            .db_request_change(&json!({
                "task_id": task_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "change_kind": "add_column",
                "title": "Add users.timezone",
                "summary": "Add nullable timezone column.",
                "resources": [{"resource_key": "db:table:users", "operation": "alter"}]
            }))
            .unwrap();
        assert_eq!(missing_lease["ok"].as_bool(), Some(false));
        assert_eq!(
            missing_lease["error"]["code"].as_str(),
            Some("db_lease_required")
        );

        kernel
            .acquire_lease(
                task_id,
                agent_id,
                session_id,
                "db:table:users",
                "db_plan",
                Some(600),
                None,
            )
            .unwrap();
        let request = kernel
            .db_request_change(&json!({
                "task_id": task_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "change_kind": "add_column",
                "title": "Add users.timezone",
                "summary": "Add nullable timezone column.",
                "resources": [
                    {"resource_key": "db:table:users", "operation": "alter"},
                    {"resource_key": "db:column:users.timezone", "operation": "add"}
                ],
                "production_impact": "No expected downtime.",
                "rollback_summary": "Drop the column before use."
            }))
            .unwrap();
        assert_eq!(request["ok"].as_bool(), Some(true));
        let request_id = request["data"]["db_change_request_id"].as_str().unwrap();
        assert_eq!(request["data"]["destructive"].as_bool(), Some(false));

        let approval = kernel
            .db_request_approval(
                request_id,
                agent_id,
                Some(session_id),
                Some("Please review additive SQL."),
                None,
            )
            .unwrap();
        let approval_id = approval["data"]["approval_id"].as_str().unwrap();
        kernel
            .resolve_approval(approval_id, "approved", "human:reviewer", None)
            .unwrap();
        let stored = kernel
            .query_one(
                "SELECT status, approval_id FROM db_change_requests WHERE id=?1",
                &[&request_id],
                "missing request",
            )
            .unwrap();
        assert_eq!(stored["status"].as_str(), Some("approved"));
        assert_eq!(stored["approval_id"].as_str(), Some(approval_id));

        let events = kernel
            .query_json(
                "SELECT * FROM events WHERE event_type IN ('db_change_request_rejected', 'db_change_requested', 'db_change_review_requested', 'db_change_approved')",
                &[],
            )
            .unwrap();
        assert_eq!(events.len(), 4);
        let report = kernel.get_alignment_report().unwrap();
        for check_name in [
            "production_sql.coordination_records",
            "production_sql.no_execution_authority",
            "approval_gate.trusted_resolution",
            "approval_gate.logs",
        ] {
            assert!(report["data"]["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|check| {
                    check["check"].as_str() == Some(check_name)
                        && check["status"].as_str() == Some("aligned")
                }));
        }
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
    fn dirty_project_root_blocks_patch_submission() {
        let repo = init_git_repo("dirty_root_blocks_patch");
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
        fs::write(repo.join("src.txt"), "direct root change\n").unwrap();
        fs::write(write_root.join("src.txt"), "branch change\n").unwrap();

        let response = kernel
            .submit_patch(
                task_id,
                agent_id,
                session_id,
                Some(worktree_id),
                Some("dirty root"),
            )
            .unwrap();
        assert_eq!(response["ok"].as_bool(), Some(false));
        assert_eq!(
            response["error"]["details"]["violations"][0]["violation_kind"].as_str(),
            Some("direct_project_root_write")
        );
        let violations = kernel
            .query_json(
                "SELECT * FROM workspace_violations WHERE violation_kind='direct_project_root_write'",
                &[],
            )
            .unwrap();
        assert_eq!(violations.len(), 1);
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
        let task = kernel
            .query_one(
                "SELECT status FROM tasks WHERE id=?1",
                &[&task_id],
                "missing task",
            )
            .unwrap();
        assert_eq!(task["status"].as_str(), Some("patch_submitted"));

        let patch_id = response["data"]["patch_id"].as_str().unwrap();
        kernel
            .create_workspace_violation(
                Some(task_id),
                Some(agent_id),
                Some(session_id),
                Some(worktree_id),
                "manual_block",
                Some("src.txt"),
                Some("file:src.txt"),
                "error",
                json!({}),
            )
            .unwrap();
        let merge = kernel.request_merge(patch_id, None, None).unwrap();
        assert_eq!(merge["ok"].as_bool(), Some(false));
        assert_eq!(merge["error"]["code"].as_str(), Some("merge_blocked"));
    }
}
