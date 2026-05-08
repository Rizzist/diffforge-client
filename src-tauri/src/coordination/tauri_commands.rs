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
    std::env::current_dir()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from).or(Some(path)))
        .unwrap_or_else(|| PathBuf::from("."))
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
        "cloud": kernel.get_cloud_orchestrator_status()?,
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
            .ensure_workspace_mcp_config(
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
                input["orchestration_run_id"].as_str(),
                input["orchestration_plan_item_id"].as_str(),
                input["assigned_role"].as_str(),
                input["expected_output"].as_str(),
            )
            .map(api_ok_from_data),
    )
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
                input["orchestration_run_id"].as_str(),
                input["orchestration_role"].as_str(),
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
        input["orchestration_run_id"].as_str(),
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
        req(&input, "approval_kind")?,
        req(&input, "reason")?,
        input["risk_summary"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_get_cloud_orchestrator_status(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .get_cloud_orchestrator_status()
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_update_cloud_orchestrator_config(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.update_cloud_orchestrator_config(&input))
}

#[tauri::command]
pub fn coordination_create_orchestration_run(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .create_orchestration_run(req(&input, "objective")?, input.get("constraints").cloned()),
    )
}

#[tauri::command]
pub fn coordination_create_cloud_context_export(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?.create_cloud_context_export(
            input["run_id"].as_str(),
            input["export_kind"]
                .as_str()
                .unwrap_or("full_redacted_brief"),
        ),
    )
}

#[tauri::command]
pub fn coordination_import_orchestration_plan(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.import_orchestration_plan(
        req(&input, "run_id")?,
        input.get("plan_json").unwrap_or(&input),
    ))
}

#[tauri::command]
pub fn coordination_adopt_orchestration_plan(
    repo_path: Option<String>,
    db_path: Option<String>,
    run_id: String,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.adopt_orchestration_plan(&run_id))
}

#[tauri::command]
pub fn coordination_list_orchestration_runs(
    repo_path: Option<String>,
    db_path: Option<String>,
    status: Option<String>,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.list_orchestration_runs(status.as_deref()))
}

#[tauri::command]
pub fn coordination_get_orchestration_brief(
    repo_path: Option<String>,
    db_path: Option<String>,
    run_id: String,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.get_orchestration_brief(&run_id))
}

#[tauri::command]
pub fn coordination_orchestrator_sync_once(
    repo_path: Option<String>,
    db_path: Option<String>,
    run_id: Option<String>,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.cloud_sync_once(run_id.as_deref()))
}

#[tauri::command]
pub fn coordination_propose_agent_assignments(
    repo_path: Option<String>,
    db_path: Option<String>,
    run_id: String,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.propose_agent_assignments(&run_id))
}

#[tauri::command]
pub fn coordination_adopt_agent_assignment(
    repo_path: Option<String>,
    db_path: Option<String>,
    assignment_id: String,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.adopt_agent_assignment(&assignment_id))
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
