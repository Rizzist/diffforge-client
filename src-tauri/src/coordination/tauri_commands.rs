use std::path::PathBuf;

use serde_json::{json, Value};

use super::{
    kernel::{api_error, api_ok, CoordinationKernel},
    watcher,
};

fn kernel(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<CoordinationKernel, String> {
    let repo_path = repo_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_repo_path);
    CoordinationKernel::open(repo_path, db_path.map(PathBuf::from))
}

fn default_repo_path() -> PathBuf {
    crate::default_working_directory().unwrap_or_else(|_| PathBuf::from("."))
}

fn result(value: Result<Value, String>) -> Result<Value, String> {
    value
}

#[tauri::command]
pub fn coordination_init(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    Ok(api_ok(json!({
        "repo_path": kernel.paths.repo_path.display().to_string(),
        "db_path": kernel.paths.db_path.display().to_string(),
        "agents_root": kernel.paths.agents_root.display().to_string(),
    })))
}

#[tauri::command]
pub fn coordination_get_snapshot(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.get_snapshot())
}

#[tauri::command]
pub fn coordination_log_ui_surface_event(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.log_ui_surface_event(&input))
}

#[tauri::command]
pub fn coordination_cleanup_bloat_dry_run(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.cleanup_bloat_dry_run())
}

#[tauri::command]
pub fn coordination_start_file_watcher(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Option<Value>,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    result(watcher::start_file_watcher(&kernel, input))
}

#[tauri::command]
pub fn coordination_stop_file_watcher(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    result(watcher::stop_file_watcher(&kernel))
}

#[tauri::command]
pub fn coordination_get_file_watcher_status(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    result(watcher::file_watcher_status(&kernel))
}

#[tauri::command]
pub fn coordination_get_alignment_report(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.get_alignment_report())
}

#[tauri::command]
pub fn coordination_get_workspace_mcp_status(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .get_workspace_mcp_status(
                Some(req_text(&workspace_id, "workspace_id")?),
                workspace_name.as_deref(),
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_create_task(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .create_task(
                input["title"].as_str().unwrap_or("Untitled task"),
                input["body"].as_str(),
                input["priority"].as_i64().unwrap_or(0),
                input["risk_level"].as_i64().unwrap_or(1),
                input["context_run_id"].as_str(),
                input["source_plan_item_id"].as_str(),
                input["assigned_role"].as_str(),
                input["expected_output"].as_str(),
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_add_task_dependency(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .add_task_dependency(
                req(&input, "task_id")?,
                req(&input, "depends_on_task_id")?,
                input["dependency_kind"].as_str(),
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_list_task_dependencies(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.list_task_dependencies(input["task_id"].as_str()))
}

#[tauri::command]
pub fn coordination_claim_task(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .claim_task(
                req(&input, "task_id")?,
                req(&input, "agent_id")?,
                req(&input, "session_id")?,
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_create_session(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    if let Some(slot_key) = input["slot_key"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
    {
        return result(
            kernel
                .create_session_for_slot_key(
                    slot_key,
                    input["agent_name"].as_str().unwrap_or("Local agent"),
                    input["agent_kind"].as_str().unwrap_or("coding_agent"),
                    input["role"].as_str(),
                    input["task_id"].as_str(),
                    input["pty_id"].as_str(),
                    input["write_enabled"].as_bool().unwrap_or(true),
                    input["context_run_id"].as_str(),
                    input["context_role"].as_str(),
                )
                .map(api_ok_from_data),
        );
    }
    let agent_id = match input["agent_id"].as_str() {
        Some(agent_id) if !agent_id.is_empty() => agent_id.to_string(),
        _ => {
            let agent = kernel.create_or_get_agent(
                input["agent_name"].as_str().unwrap_or("Local agent"),
                input["agent_kind"].as_str().unwrap_or("coding_agent"),
                input["role"].as_str(),
            )?;
            agent["id"].as_str().unwrap_or_default().to_string()
        }
    };
    result(
        kernel
            .create_session(
                &agent_id,
                input["task_id"].as_str(),
                input["pty_id"].as_str(),
                input["write_enabled"].as_bool().unwrap_or(true),
                input["context_run_id"].as_str(),
                input["context_role"].as_str(),
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_heartbeat_session(
    repo_path: Option<String>,
    db_path: Option<String>,
    session_id: String,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .heartbeat_session(&session_id)
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_acquire_lease(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.acquire_lease(
        req(&input, "task_id")?,
        req(&input, "agent_id")?,
        req(&input, "session_id")?,
        req(&input, "resource_key")?,
        input["mode"].as_str().unwrap_or("write"),
        input["ttl_seconds"].as_i64(),
        input["reason"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_release_lease(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.release_lease(
        req(&input, "lease_id")?,
        input["fence_token"].as_i64().unwrap_or(0),
    ))
}

#[tauri::command]
pub fn coordination_list_events(
    repo_path: Option<String>,
    db_path: Option<String>,
    limit: Option<i64>,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.list_events(limit))
}

#[tauri::command]
pub fn coordination_list_active_leases(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Option<Value>,
) -> Result<Value, String> {
    let input = input.unwrap_or_else(|| json!({}));
    result(kernel(repo_path, db_path)?.list_active_leases(
        input["task_id"].as_str(),
        input["agent_id"].as_str(),
        input["resource_key"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_list_resources(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Option<Value>,
) -> Result<Value, String> {
    let input = input.unwrap_or_else(|| json!({}));
    result(kernel(repo_path, db_path)?.list_resources(
        input["resource_type"].as_str(),
        input["min_risk_level"].as_i64(),
    ))
}

#[tauri::command]
pub fn coordination_write_memory(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.write_memory(
        req(&input, "memory_kind")?,
        req(&input, "title")?,
        req(&input, "body")?,
        input["trust_level"].as_str(),
        input["task_id"].as_str(),
        input["evidence_artifact_id"].as_str(),
        input["context_run_id"].as_str(),
        input["agent_id"].as_str(),
        input["certified_by"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_search_memory(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.search_memory(
        input["query"].as_str(),
        input["memory_kind"].as_str(),
        input["trust_level"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_write_contract_memory(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.write_contract_memory(&input))
}

#[tauri::command]
pub fn coordination_write_handoff_memory(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.write_handoff_memory(&input))
}

#[tauri::command]
pub fn coordination_get_repo_policy(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .repo_policy()
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_update_repo_policy(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.update_repo_policy(&input))
}

#[tauri::command]
pub fn coordination_create_worktree(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .create_worktree_for_session(
                req(&input, "agent_id")?,
                req(&input, "session_id")?,
                input["task_id"].as_str(),
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_validate_patch(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.validate_patch(
        req(&input, "task_id")?,
        req(&input, "agent_id")?,
        req(&input, "session_id")?,
        input["worktree_id"].as_str(),
        input["summary"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_submit_patch(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.submit_patch(
        req(&input, "task_id")?,
        req(&input, "agent_id")?,
        req(&input, "session_id")?,
        input["worktree_id"].as_str(),
        input["summary"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_request_merge(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.request_merge(
        req(&input, "patch_id")?,
        input["target_branch"].as_str(),
        input["strategy"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_initialize_merge_resolution(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.initialize_merge_resolution(
        req(&input, "patch_id")?,
        input["resolver_agent_id"].as_str(),
        input["resolver_session_id"].as_str(),
        input["target_branch"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_apply_merge(
    repo_path: Option<String>,
    db_path: Option<String>,
    merge_job_id: String,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.apply_merge(&merge_job_id))
}

#[tauri::command]
pub fn coordination_list_workspace_violations(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Option<Value>,
) -> Result<Value, String> {
    let input = input.unwrap_or_else(|| json!({}));
    result(kernel(repo_path, db_path)?.list_workspace_violations(
        input["task_id"].as_str(),
        input["agent_id"].as_str(),
        input["session_id"].as_str(),
        input["worktree_id"].as_str(),
        input["status"].as_str().or(Some("open")),
    ))
}

#[tauri::command]
pub fn coordination_list_workspace_changes(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Option<Value>,
) -> Result<Value, String> {
    let input = input.unwrap_or_else(|| json!({}));
    result(kernel(repo_path, db_path)?.list_workspace_changes(
        input["task_id"].as_str(),
        input["agent_id"].as_str(),
        input["session_id"].as_str(),
        input["worktree_id"].as_str(),
        input["resource_key"].as_str(),
        input["limit"].as_i64(),
    ))
}

#[tauri::command]
pub fn coordination_resolve_workspace_violation(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.resolve_workspace_violation(
        req(&input, "violation_id")?,
        req(&input, "resolution")?,
        input["reason"].as_str().unwrap_or("Resolved by user."),
        req(&input, "human_actor")?,
    ))
}

#[tauri::command]
pub fn coordination_db_classify_sql(
    repo_path: Option<String>,
    db_path: Option<String>,
    sql: String,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.db_classify_sql(&sql))
}

#[tauri::command]
pub fn coordination_db_get_mode(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.db_get_mode())
}

#[tauri::command]
pub fn coordination_db_request_change(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.db_request_change(&input))
}

#[tauri::command]
pub fn coordination_db_list_change_requests(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Option<Value>,
) -> Result<Value, String> {
    let input = input.unwrap_or_else(|| json!({}));
    result(
        kernel(repo_path, db_path)?
            .db_list_change_requests(input["status"].as_str(), input["task_id"].as_str()),
    )
}

#[tauri::command]
pub fn coordination_db_get_change_request(
    repo_path: Option<String>,
    db_path: Option<String>,
    db_change_request_id: String,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.db_get_change_request(&db_change_request_id))
}

#[tauri::command]
pub fn coordination_db_request_approval(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.db_request_approval(
        req(&input, "db_change_request_id")?,
        req(&input, "agent_id")?,
        input["session_id"].as_str(),
        input["reason"].as_str(),
        input["risk_summary"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_db_propose_migration(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?.db_propose_migration(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
            req(&input, "migration_name")?,
            input["engine"].as_str().unwrap_or("unknown"),
            req(&input, "up_sql")?,
            input["down_sql_or_rollforward_plan"]
                .as_str()
                .unwrap_or("Roll forward manually after review."),
            input["summary"].as_str(),
        ),
    )
}

#[tauri::command]
pub fn coordination_request_approval(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.request_approval(
        req(&input, "task_id")?,
        req(&input, "agent_id")?,
        input["session_id"].as_str(),
        req(&input, "approval_kind")?,
        req(&input, "reason")?,
        input["risk_summary"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_resolve_approval(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.resolve_approval(
        req(&input, "approval_id")?,
        req(&input, "decision")?,
        input["human_actor"].as_str().unwrap_or("local"),
        input["reason"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_scan_workspace_violations(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    result(watcher::scan_known_violations(&kernel(repo_path, db_path)?))
}

fn api_ok_from_data(value: Value) -> Value {
    api_ok(value)
}

fn req<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required."))
}

fn req_text<'a>(input: &'a str, key: &str) -> Result<&'a str, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(format!("{key} is required."));
    }
    Ok(trimmed)
}

#[allow(dead_code)]
fn safe_command_error(error: String) -> Value {
    api_error("coordination_command_failed", error, json!({}))
}
