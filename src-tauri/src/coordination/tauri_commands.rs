use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
};

use serde_json::{json, Map, Value};

use super::{
    db::{StoragePaths, REPO_ID},
    kernel::{api_ok, CoordinationKernel, EventRefs},
    mcp, watcher,
};

const WORKSPACE_MCP_BACKGROUND_JOB_EVENT: &str = "workspace-mcp-background-job";

#[derive(Clone, Debug)]
struct CoordinationWorkspaceTarget {
    repo_path: PathBuf,
    db_path: Option<PathBuf>,
    mount_id: String,
    project_name: String,
    project_kind: String,
    workspace_relative_path: String,
    is_workspace_root: bool,
    has_git: bool,
    has_agents: bool,
    has_kernel_db: bool,
}

#[derive(Clone, Debug)]
struct CoordinationWorkspaceTargetSet {
    input_root: PathBuf,
    workspace_kind: String,
    is_container: bool,
    targets: Vec<CoordinationWorkspaceTarget>,
}

fn kernel(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<CoordinationKernel, String> {
    let target = coordination_single_workspace_target(repo_path, db_path)?;
    CoordinationKernel::open(target.repo_path, target.db_path)
}

fn kernel_for_worktree_input(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: &Value,
) -> Result<CoordinationKernel, String> {
    let repo_path = repo_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| repo_path_from_worktree_input(input));
    kernel(repo_path, db_path)
}

fn default_repo_path() -> PathBuf {
    crate::default_working_directory().unwrap_or_else(|_| PathBuf::from("."))
}

fn clean_optional_path(value: Option<String>) -> Option<PathBuf> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn coordination_input_root(repo_path: Option<String>) -> Result<PathBuf, String> {
    let repo_path = clean_optional_path(repo_path).unwrap_or_else(default_repo_path);
    if repo_path.exists() {
        return crate::resolve_workspace_root_directory(Some(&crate::workspace_path_display(
            &repo_path,
        )));
    }
    Ok(repo_path)
}

fn coordination_target_kernel_db_path(repo_path: &Path, db_path: Option<&PathBuf>) -> PathBuf {
    db_path
        .cloned()
        .unwrap_or_else(|| StoragePaths::new(repo_path.to_path_buf(), None).db_path)
}

fn coordination_workspace_target_from_root(
    input_root: &Path,
    db_path: Option<PathBuf>,
) -> CoordinationWorkspaceTarget {
    let kernel_db_path = coordination_target_kernel_db_path(input_root, db_path.as_ref());
    CoordinationWorkspaceTarget {
        repo_path: input_root.to_path_buf(),
        db_path,
        mount_id: String::new(),
        project_name: input_root
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| crate::workspace_path_display(input_root)),
        project_kind: "workspace_root".to_string(),
        workspace_relative_path: String::new(),
        is_workspace_root: true,
        has_git: input_root.join(".git").exists(),
        has_agents: input_root.join(".agents").is_dir(),
        has_kernel_db: kernel_db_path.exists(),
    }
}

fn coordination_workspace_target_from_mount(
    mount: &crate::WorkspaceProjectMount,
) -> CoordinationWorkspaceTarget {
    let kernel_db_path = coordination_target_kernel_db_path(&mount.root_path, None);
    CoordinationWorkspaceTarget {
        repo_path: mount.root_path.clone(),
        db_path: None,
        mount_id: mount.mount_id.clone(),
        project_name: mount.project_name.clone(),
        project_kind: mount.project_kind.clone(),
        workspace_relative_path: mount.workspace_relative_path.clone(),
        is_workspace_root: false,
        has_git: mount.has_git,
        has_agents: mount.has_agents,
        has_kernel_db: kernel_db_path.exists(),
    }
}

fn coordination_workspace_target_set(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<CoordinationWorkspaceTargetSet, String> {
    let input_root = coordination_input_root(repo_path)?;
    let requested_db_path = clean_optional_path(db_path);
    let mounts = if input_root.exists() && input_root.is_dir() {
        crate::workspace_project_mounts(&input_root)
    } else {
        Vec::new()
    };
    let selected_root_mount = crate::workspace_selected_root_mount(&input_root, &mounts).is_some();
    let is_container = !selected_root_mount && !mounts.is_empty();
    let workspace_kind = if input_root.exists() && input_root.is_dir() {
        crate::workspace_kind_for_mounts(&input_root, &mounts)
    } else {
        "plain".to_string()
    };
    let targets = if workspace_kind == "broad_area" {
        Vec::new()
    } else if is_container {
        mounts
            .iter()
            .map(coordination_workspace_target_from_mount)
            .collect::<Vec<_>>()
    } else {
        vec![coordination_workspace_target_from_root(
            &input_root,
            requested_db_path,
        )]
    };

    Ok(CoordinationWorkspaceTargetSet {
        input_root,
        workspace_kind,
        is_container,
        targets,
    })
}

fn coordination_single_workspace_target(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<CoordinationWorkspaceTarget, String> {
    let target_set = coordination_workspace_target_set(repo_path, db_path)?;
    if target_set.is_container && target_set.targets.len() > 1 {
        let labels = target_set
            .targets
            .iter()
            .take(5)
            .map(|target| target.workspace_relative_path.clone())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Workspace root is a container with multiple projects ({labels}). Select a project before using coordination commands."
        ));
    }
    target_set
        .targets
        .into_iter()
        .next()
        .ok_or_else(|| "No coordination target is available for this workspace.".to_string())
}

fn coordination_target_value(target: &CoordinationWorkspaceTarget) -> Value {
    json!({
        "repoPath": crate::workspace_path_display(&target.repo_path),
        "repo_path": crate::workspace_path_display(&target.repo_path),
        "dbPath": target.db_path.as_ref().map(|path| crate::workspace_path_display(path)),
        "db_path": target.db_path.as_ref().map(|path| crate::workspace_path_display(path)),
        "mountId": target.mount_id,
        "mount_id": target.mount_id,
        "projectName": target.project_name,
        "project_name": target.project_name,
        "projectKind": target.project_kind,
        "project_kind": target.project_kind,
        "workspaceRelativePath": target.workspace_relative_path,
        "workspace_relative_path": target.workspace_relative_path,
        "isWorkspaceRoot": target.is_workspace_root,
        "is_workspace_root": target.is_workspace_root,
        "hasGit": target.has_git,
        "has_git": target.has_git,
        "hasAgents": target.has_agents,
        "has_agents": target.has_agents,
        "hasKernelDb": target.has_kernel_db,
        "has_kernel_db": target.has_kernel_db,
    })
}

fn coordination_target_annotation(target: &CoordinationWorkspaceTarget) -> Map<String, Value> {
    let mut annotation = Map::new();
    annotation.insert(
        "source_repo_path".to_string(),
        json!(crate::workspace_path_display(&target.repo_path)),
    );
    annotation.insert(
        "sourceRepoPath".to_string(),
        json!(crate::workspace_path_display(&target.repo_path)),
    );
    annotation.insert(
        "source_mount_id".to_string(),
        json!(target.mount_id.clone()),
    );
    annotation.insert("sourceMountId".to_string(), json!(target.mount_id.clone()));
    annotation.insert(
        "source_project_name".to_string(),
        json!(target.project_name.clone()),
    );
    annotation.insert(
        "sourceProjectName".to_string(),
        json!(target.project_name.clone()),
    );
    annotation
}

fn annotate_coordination_snapshot_item(
    item: &Value,
    target: &CoordinationWorkspaceTarget,
) -> Value {
    if let Some(object) = item.as_object() {
        let mut next = object.clone();
        for (key, value) in coordination_target_annotation(target) {
            next.entry(key).or_insert(value);
        }
        Value::Object(next)
    } else {
        item.clone()
    }
}

fn aggregate_container_coordination_snapshots(
    target_set: &CoordinationWorkspaceTargetSet,
) -> Value {
    let mut aggregate = Map::new();
    let mut project_results = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();

    for target in &target_set.targets {
        if !target.has_kernel_db {
            skipped.push(coordination_target_value(target));
            continue;
        }

        match CoordinationKernel::open_for_shutdown_cleanup(
            &target.repo_path,
            target.db_path.clone(),
        )
        .and_then(|kernel| kernel.get_snapshot())
        {
            Ok(snapshot) => {
                let data = snapshot
                    .get("data")
                    .and_then(Value::as_object)
                    .or_else(|| snapshot.as_object());
                if let Some(data) = data {
                    for (key, value) in data {
                        if let Some(items) = value.as_array() {
                            let entry = aggregate
                                .entry(key.clone())
                                .or_insert_with(|| Value::Array(Vec::new()));
                            if let Some(aggregate_items) = entry.as_array_mut() {
                                aggregate_items.extend(
                                    items.iter().map(|item| {
                                        annotate_coordination_snapshot_item(item, target)
                                    }),
                                );
                            }
                        }
                    }
                }
                project_results.push(json!({
                    "repoPath": crate::workspace_path_display(&target.repo_path),
                    "repo_path": crate::workspace_path_display(&target.repo_path),
                    "mountId": target.mount_id,
                    "mount_id": target.mount_id,
                    "projectName": target.project_name,
                    "project_name": target.project_name,
                    "status": "included",
                }));
            }
            Err(error) => {
                errors.push(json!({
                    "repoPath": crate::workspace_path_display(&target.repo_path),
                    "repo_path": crate::workspace_path_display(&target.repo_path),
                    "mountId": target.mount_id,
                    "mount_id": target.mount_id,
                    "projectName": target.project_name,
                    "project_name": target.project_name,
                    "error": error,
                }));
            }
        }
    }

    aggregate.insert("container".to_string(), json!(true));
    aggregate.insert(
        "repoPath".to_string(),
        json!(crate::workspace_path_display(&target_set.input_root)),
    );
    aggregate.insert(
        "repo_path".to_string(),
        json!(crate::workspace_path_display(&target_set.input_root)),
    );
    aggregate.insert(
        "workspaceKind".to_string(),
        json!(target_set.workspace_kind.clone()),
    );
    aggregate.insert(
        "workspace_kind".to_string(),
        json!(target_set.workspace_kind.clone()),
    );
    aggregate.insert(
        "projectMounts".to_string(),
        Value::Array(
            target_set
                .targets
                .iter()
                .map(coordination_target_value)
                .collect(),
        ),
    );
    aggregate.insert(
        "project_mounts".to_string(),
        aggregate["projectMounts"].clone(),
    );
    aggregate.insert(
        "projectSnapshots".to_string(),
        Value::Array(project_results.clone()),
    );
    aggregate.insert(
        "project_snapshots".to_string(),
        Value::Array(project_results),
    );
    aggregate.insert("skippedProjects".to_string(), Value::Array(skipped.clone()));
    aggregate.insert("skipped_projects".to_string(), Value::Array(skipped));
    aggregate.insert("errors".to_string(), Value::Array(errors));

    Value::Object(aggregate)
}

fn repo_path_from_worktree_input(input: &Value) -> Option<String> {
    let worktree_path = input["worktree_path"]
        .as_str()
        .or_else(|| input["worktreePath"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let path = PathBuf::from(worktree_path);
    for ancestor in path.ancestors() {
        if ancestor.file_name().and_then(|value| value.to_str()) != Some("worktrees") {
            continue;
        }
        let agents_dir = ancestor.parent()?;
        if agents_dir.file_name().and_then(|value| value.to_str()) != Some(".agents") {
            continue;
        }
        return agents_dir
            .parent()
            .map(|repo_path| repo_path.display().to_string());
    }
    None
}

fn result(value: Result<Value, String>) -> Result<Value, String> {
    value
}

fn coordination_background_mcp_jobs() -> &'static Mutex<HashSet<String>> {
    static JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn claim_coordination_background_mcp_job(job_key: &str) -> bool {
    coordination_background_mcp_jobs()
        .lock()
        .map(|mut jobs| jobs.insert(job_key.to_string()))
        .unwrap_or(false)
}

fn release_coordination_background_mcp_job(job_key: &str) {
    if let Ok(mut jobs) = coordination_background_mcp_jobs().lock() {
        jobs.remove(job_key);
    }
}

fn background_mcp_job_payload(
    job_key: &str,
    job_type: &str,
    status: &str,
    repo_path: &str,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    extra: Value,
) -> Value {
    json!({
        "jobKey": job_key,
        "job_key": job_key,
        "jobType": job_type,
        "job_type": job_type,
        "status": status,
        "repoPath": repo_path,
        "repo_path": repo_path,
        "workspaceId": workspace_id.unwrap_or_default(),
        "workspace_id": workspace_id.unwrap_or_default(),
        "workspaceName": workspace_name.unwrap_or_default(),
        "workspace_name": workspace_name.unwrap_or_default(),
        "extra": extra,
    })
}

fn emit_background_mcp_job_event(
    app: &tauri::AppHandle,
    kernel: Option<&CoordinationKernel>,
    job_key: &str,
    job_type: &str,
    status: &str,
    repo_path: &str,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    extra: Value,
) {
    let payload = background_mcp_job_payload(
        job_key,
        job_type,
        status,
        repo_path,
        workspace_id,
        workspace_name,
        extra,
    );
    let _ = tauri::Emitter::emit(app, WORKSPACE_MCP_BACKGROUND_JOB_EVENT, payload.clone());
    if let Some(kernel) = kernel {
        let event_type = match status {
            "completed" => "workspace_mcp_registry_changed",
            "failed" => "workspace_mcp_background_job_failed",
            _ => "workspace_mcp_background_job_started",
        };
        let _ = kernel.emit_event(event_type, "kernel", REPO_ID, EventRefs::default(), payload);
    }
}

fn spawn_coordination_background_mcp_job<F>(
    app: tauri::AppHandle,
    target: CoordinationWorkspaceTarget,
    job_key: String,
    job_type: &'static str,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    job: F,
) -> Value
where
    F: FnOnce(&CoordinationKernel, Option<&str>, Option<&str>) -> Result<Value, String>
        + Send
        + 'static,
{
    let repo_path_text = crate::workspace_path_display(&target.repo_path);
    let queued = claim_coordination_background_mcp_job(&job_key);
    let workspace_id_text = workspace_id.clone().unwrap_or_default();
    let workspace_name_text = workspace_name.clone().unwrap_or_default();

    if !queued {
        return api_ok(json!({
            "mode": "background",
            "queued": false,
            "in_flight": true,
            "job_key": job_key,
            "jobKey": job_key,
            "job_type": job_type,
            "jobType": job_type,
            "repo_path": repo_path_text,
            "repoPath": repo_path_text,
            "workspace_id": workspace_id_text,
            "workspaceId": workspace_id_text,
            "workspace_name": workspace_name_text,
            "workspaceName": workspace_name_text,
        }));
    }

    let repo_path = target.repo_path.clone();
    let db_path = target.db_path.clone();
    let thread_job_key = job_key.clone();
    let thread_repo_path_text = repo_path_text.clone();
    let thread_workspace_id = workspace_id.clone();
    let thread_workspace_name = workspace_name.clone();
    thread::spawn(move || {
        let result: Result<(), String> = (|| {
            let kernel = CoordinationKernel::open(repo_path.clone(), db_path.clone())?;
            emit_background_mcp_job_event(
                &app,
                Some(&kernel),
                &thread_job_key,
                job_type,
                "started",
                &thread_repo_path_text,
                thread_workspace_id.as_deref(),
                thread_workspace_name.as_deref(),
                json!({}),
            );
            let output = job(
                &kernel,
                thread_workspace_id.as_deref(),
                thread_workspace_name.as_deref(),
            )?;
            emit_background_mcp_job_event(
                &app,
                Some(&kernel),
                &thread_job_key,
                job_type,
                "completed",
                &thread_repo_path_text,
                thread_workspace_id.as_deref(),
                thread_workspace_name.as_deref(),
                json!({ "result": output }),
            );
            Ok(())
        })();

        if let Err(error) = result {
            let kernel = CoordinationKernel::open(repo_path, db_path).ok();
            emit_background_mcp_job_event(
                &app,
                kernel.as_ref(),
                &thread_job_key,
                job_type,
                "failed",
                &thread_repo_path_text,
                thread_workspace_id.as_deref(),
                thread_workspace_name.as_deref(),
                json!({ "error": error }),
            );
        }
        release_coordination_background_mcp_job(&thread_job_key);
    });

    api_ok(json!({
        "mode": "background",
        "queued": true,
        "in_flight": false,
        "job_key": job_key,
        "jobKey": job_key,
        "job_type": job_type,
        "jobType": job_type,
        "repo_path": repo_path_text,
        "repoPath": repo_path_text,
        "workspace_id": workspace_id_text,
        "workspaceId": workspace_id_text,
        "workspace_name": workspace_name_text,
        "workspaceName": workspace_name_text,
    }))
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
pub fn coordination_workspace_targets(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    let target_set = coordination_workspace_target_set(repo_path, db_path)?;
    Ok(api_ok(json!({
        "repoPath": crate::workspace_path_display(&target_set.input_root),
        "repo_path": crate::workspace_path_display(&target_set.input_root),
        "workspaceKind": target_set.workspace_kind,
        "workspace_kind": target_set.workspace_kind,
        "container": target_set.is_container,
        "targets": target_set
            .targets
            .iter()
            .map(coordination_target_value)
            .collect::<Vec<_>>(),
    })))
}

#[tauri::command]
pub fn coordination_get_snapshot(
    repo_path: Option<String>,
    db_path: Option<String>,
) -> Result<Value, String> {
    let target_set = coordination_workspace_target_set(repo_path, db_path)?;
    if target_set.is_container {
        return Ok(api_ok(aggregate_container_coordination_snapshots(
            &target_set,
        )));
    }
    let target = target_set
        .targets
        .into_iter()
        .next()
        .ok_or_else(|| "No coordination target is available for this workspace.".to_string())?;
    result(CoordinationKernel::open(target.repo_path, target.db_path)?.get_snapshot())
}

#[tauri::command]
pub fn coordination_terminal_todo_plan_snapshot(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Option<Value>,
) -> Result<Value, String> {
    let input = input.unwrap_or_else(|| json!({}));
    let task_id = input["task_id"]
        .as_str()
        .or_else(|| input["taskId"].as_str());
    let session_id = input["session_id"]
        .as_str()
        .or_else(|| input["sessionId"].as_str());
    let agent_id = input["agent_id"]
        .as_str()
        .or_else(|| input["agentId"].as_str());
    let direct_repo_target = input["direct_repo_target"]
        .as_bool()
        .or_else(|| input["directRepoTarget"].as_bool())
        .unwrap_or(false);

    if direct_repo_target
        && repo_path
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    {
        let repo_path = coordination_input_root(repo_path)?;
        let db_path = clean_optional_path(db_path);
        let (kernel, _) = CoordinationKernel::open_for_terminal_launch(repo_path, db_path)?;
        return result(kernel.terminal_todo_plan_snapshot(task_id, session_id, agent_id));
    }

    result(kernel(repo_path, db_path)?.terminal_todo_plan_snapshot(task_id, session_id, agent_id))
}

#[tauri::command]
pub fn coordination_terminal_todo_plan_edit_step_title(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    let task_id = input["task_id"]
        .as_str()
        .or_else(|| input["taskId"].as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "task_id is required.".to_string())?;
    let step_index = input["step_index"]
        .as_i64()
        .or_else(|| input["stepIndex"].as_i64())
        .ok_or_else(|| "step_index is required.".to_string())?;
    let title = input["title"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "title is required.".to_string())?;
    let agent_id = input["agent_id"]
        .as_str()
        .or_else(|| input["agentId"].as_str());
    let session_id = input["session_id"]
        .as_str()
        .or_else(|| input["sessionId"].as_str());
    let mut response =
        kernel.edit_terminal_todo_plan_step_title(task_id, step_index, title, agent_id)?;
    let compact_plan = response["data"]["compact_plan"].clone();
    let cloud = if response["ok"].as_bool() != Some(false) && !compact_plan.is_null() {
        match crate::cloud_mcp_forward_terminal_todo_plan_update(
            Some(&kernel.paths.repo_path.display().to_string()),
            Some(&kernel.paths.db_path),
            input["workspace_id"]
                .as_str()
                .or_else(|| input["workspaceId"].as_str()),
            agent_id,
            session_id,
            Some(task_id),
            input["worktree_id"]
                .as_str()
                .or_else(|| input["worktreeId"].as_str()),
            input["worktree_path"]
                .as_str()
                .or_else(|| input["worktreePath"].as_str()),
            "user_edited_plan_step_title",
            &compact_plan,
        ) {
            Ok(value) => json!({"ok": true, "response": value}),
            Err(error) => json!({"ok": false, "error": error}),
        }
    } else {
        json!({"ok": false, "skipped": true, "reason": "no_compact_plan"})
    };
    if let Some(data) = response.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("cloud".to_string(), cloud);
    }
    Ok(response)
}

#[tauri::command]
pub fn coordination_terminal_todo_plan_finish(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    let direct_repo_target = input["direct_repo_target"]
        .as_bool()
        .or_else(|| input["directRepoTarget"].as_bool())
        .unwrap_or(false);
    let kernel = if direct_repo_target
        && repo_path
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    {
        let repo_path = coordination_input_root(repo_path)?;
        let db_path = clean_optional_path(db_path);
        CoordinationKernel::open(repo_path, db_path)?
    } else {
        kernel(repo_path, db_path)?
    };
    let task_id = input["task_id"]
        .as_str()
        .or_else(|| input["taskId"].as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "task_id is required.".to_string())?
        .to_string();
    let agent_id = input["agent_id"]
        .as_str()
        .or_else(|| input["agentId"].as_str())
        .map(str::to_string);
    let session_id = input["session_id"]
        .as_str()
        .or_else(|| input["sessionId"].as_str())
        .map(str::to_string);
    let workspace_id = input["workspace_id"]
        .as_str()
        .or_else(|| input["workspaceId"].as_str())
        .map(str::to_string);
    let worktree_id = input["worktree_id"]
        .as_str()
        .or_else(|| input["worktreeId"].as_str())
        .map(str::to_string);
    let worktree_path = input["worktree_path"]
        .as_str()
        .or_else(|| input["worktreePath"].as_str())
        .map(str::to_string);
    let finished = kernel.finish_terminal_todo_plan(
        &task_id,
        "completed",
        agent_id.as_deref(),
        session_id.as_deref(),
    )?;
    let mut response = api_ok(json!({
        "plan_finished": finished.is_some(),
        "result": finished,
    }));
    let compact_plan = response["data"]["result"]["compact_plan"].clone();
    let cloud = if !compact_plan.is_null() {
        let repo_path = kernel.paths.repo_path.display().to_string();
        let db_path = kernel.paths.db_path.clone();
        let cloud_task_id = task_id.clone();
        let cloud_agent_id = agent_id.clone();
        let cloud_session_id = session_id.clone();
        let cloud_workspace_id = workspace_id.clone();
        let cloud_worktree_id = worktree_id.clone();
        let cloud_worktree_path = worktree_path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::cloud_mcp_forward_terminal_todo_plan_update(
                Some(&repo_path),
                Some(&db_path),
                cloud_workspace_id.as_deref(),
                cloud_agent_id.as_deref(),
                cloud_session_id.as_deref(),
                Some(&cloud_task_id),
                cloud_worktree_id.as_deref(),
                cloud_worktree_path.as_deref(),
                "user_finished_terminal_todo_plan",
                &compact_plan,
            );
        });
        json!({"ok": true, "queued": true, "mode": "background"})
    } else {
        json!({"ok": false, "skipped": true, "reason": "no_compact_plan"})
    };
    if let Some(data) = response.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("cloud".to_string(), cloud);
    }
    Ok(response)
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
pub fn coordination_workspace_mcp_registry(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .workspace_mcp_registry(
                req_text(&workspace_id, "workspace_id")?,
                workspace_name.as_deref(),
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_workspace_mcp_registry_background(
    app: tauri::AppHandle,
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let target = coordination_single_workspace_target(repo_path, db_path)?;
    let workspace_id = req_text(&workspace_id, "workspace_id")?.to_string();
    let repo_key = crate::workspace_path_display(&target.repo_path).to_lowercase();
    let job_key = format!("workspace_mcp:registry:{repo_key}:{workspace_id}");

    Ok(spawn_coordination_background_mcp_job(
        app,
        target,
        job_key,
        "workspace_mcp_registry",
        Some(workspace_id),
        workspace_name,
        |kernel, workspace_id, workspace_name| {
            let workspace_id =
                workspace_id.ok_or_else(|| "workspace_id is required.".to_string())?;
            let registry = kernel.workspace_mcp_registry(workspace_id, workspace_name)?;
            Ok(json!({
                "summary": registry["summary"].clone(),
            }))
        },
    ))
}

#[tauri::command]
pub fn coordination_add_workspace_mcp_marketplace(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .add_workspace_mcp_marketplace(req_text(&workspace_id, "workspace_id")?, &input)
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_remove_workspace_mcp_marketplace(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    marketplace_id: String,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .remove_workspace_mcp_marketplace(
                req_text(&workspace_id, "workspace_id")?,
                req_text(&marketplace_id, "marketplace_id")?,
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_index_workspace_mcp_marketplace(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    marketplace_id: String,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .index_workspace_mcp_marketplace(
                req_text(&workspace_id, "workspace_id")?,
                req_text(&marketplace_id, "marketplace_id")?,
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_install_workspace_mcp_server(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .install_workspace_mcp_server(req_text(&workspace_id, "workspace_id")?, &input)
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_update_workspace_mcp_server(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    server_id: String,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .update_workspace_mcp_server(
                req_text(&workspace_id, "workspace_id")?,
                req_text(&server_id, "server_id")?,
                &input,
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_uninstall_workspace_mcp_server(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    server_id: String,
) -> Result<Value, String> {
    result(
        kernel(repo_path, db_path)?
            .uninstall_workspace_mcp_server(
                req_text(&workspace_id, "workspace_id")?,
                req_text(&server_id, "server_id")?,
            )
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_upsert_workspace_mcp_secret(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    workspace_name: Option<String>,
    input: Value,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    let workspace_id = req_text(&workspace_id, "workspace_id")?;
    kernel.upsert_workspace_mcp_secret(workspace_id, &input)?;
    result(
        kernel
            .workspace_mcp_registry(workspace_id, workspace_name.as_deref())
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_delete_workspace_mcp_secret(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: String,
    workspace_name: Option<String>,
    secret_id: String,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    let workspace_id = req_text(&workspace_id, "workspace_id")?;
    kernel.delete_workspace_mcp_secret(workspace_id, req_text(&secret_id, "secret_id")?)?;
    result(
        kernel
            .workspace_mcp_registry(workspace_id, workspace_name.as_deref())
            .map(api_ok_from_data),
    )
}

#[tauri::command]
pub fn coordination_activate_shared_mcp_daemon(
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let kernel = kernel(repo_path, db_path)?;
    let workspace_id = workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let data = if let Some(workspace_id) = workspace_id {
        kernel.get_workspace_mcp_status(Some(workspace_id), workspace_name.as_deref())?
    } else {
        mcp::ensure_shared_daemon_for_paths(&kernel.paths.repo_path, &kernel.paths.db_path)?
    };

    Ok(api_ok_from_data(data))
}

#[tauri::command]
pub fn coordination_activate_shared_mcp_daemon_background(
    app: tauri::AppHandle,
    repo_path: Option<String>,
    db_path: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let target = coordination_single_workspace_target(repo_path, db_path)?;
    let workspace_id = workspace_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let workspace_name = workspace_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let repo_key = crate::workspace_path_display(&target.repo_path).to_lowercase();
    let workspace_key = workspace_id.as_deref().unwrap_or("repo");
    let job_key = format!("workspace_mcp:shared_daemon:{repo_key}:{workspace_key}");

    Ok(spawn_coordination_background_mcp_job(
        app,
        target,
        job_key,
        "activate_shared_mcp_daemon",
        workspace_id,
        workspace_name,
        |kernel, workspace_id, workspace_name| {
            let data = if let Some(workspace_id) = workspace_id {
                kernel.get_workspace_mcp_status(Some(workspace_id), workspace_name)?
            } else {
                mcp::ensure_shared_daemon_for_paths(&kernel.paths.repo_path, &kernel.paths.db_path)?
            };
            Ok(json!({
                "daemon": data["daemon"].clone(),
                "health": data["health"].clone(),
                "repo_path": data["repo_path"].clone(),
                "workspace_id": data["workspace_id"].clone(),
            }))
        },
    ))
}

#[tauri::command]
pub fn coordination_deactivate_shared_mcp_daemon(
    repo_path: Option<String>,
    reason: Option<String>,
) -> Result<Value, String> {
    let target_set = coordination_workspace_target_set(repo_path, None)?;
    let reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("workspace_deactivate");

    if target_set.is_container {
        let mut stopped = Vec::new();
        stopped.push(
            mcp::stop_shared_daemon_for_repo(&target_set.input_root, reason).unwrap_or_else(
                |error| {
                    json!({
                        "repo_path": crate::workspace_path_display(&target_set.input_root),
                        "status": "error",
                        "target": "container_parent",
                        "error": error,
                    })
                },
            ),
        );
        stopped.extend(
            target_set
                .targets
                .iter()
                .map(|target| {
                    mcp::stop_shared_daemon_for_repo(&target.repo_path, reason).unwrap_or_else(
                        |error| {
                            json!({
                                "repo_path": crate::workspace_path_display(&target.repo_path),
                                "mount_id": target.mount_id,
                                "project_name": target.project_name,
                                "status": "error",
                                "error": error,
                            })
                        },
                    )
                })
                .collect::<Vec<_>>(),
        );
        return Ok(api_ok(json!({
            "repo_path": crate::workspace_path_display(&target_set.input_root),
            "container": true,
            "reason": reason,
            "stopped": stopped,
        })));
    }

    let target = target_set
        .targets
        .into_iter()
        .next()
        .ok_or_else(|| "No coordination target is available for this workspace.".to_string())?;
    mcp::stop_shared_daemon_for_repo(target.repo_path, reason).map(api_ok_from_data)
}

#[tauri::command]
pub fn coordination_stop_all_shared_mcp_daemons(reason: Option<String>) -> Result<Value, String> {
    let reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("app_shutdown");

    mcp::stop_all_shared_daemons(reason).map(api_ok_from_data)
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
pub fn coordination_submit_patch_status(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel(repo_path, db_path)?.submit_patch_job_status(
        input["submit_job_id"].as_str(),
        input["task_id"].as_str(),
        input["session_id"].as_str(),
    ))
}

#[tauri::command]
pub fn coordination_worktree_diff_summary(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(kernel_for_worktree_input(repo_path, db_path, &input)?.worktree_diff_summary(&input))
}

#[tauri::command]
pub fn coordination_undo_worktree_diff_summary(
    repo_path: Option<String>,
    db_path: Option<String>,
    input: Value,
) -> Result<Value, String> {
    result(
        kernel_for_worktree_input(repo_path, db_path, &input)?.undo_worktree_diff_summary(&input),
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_root(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let root = std::env::temp_dir().join(format!(
            "diffforge-coordination-targets-{name}-{}-{stamp}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn create_package_project(path: &Path) {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("package.json"), "{}\n").unwrap();
    }

    fn data(value: &Value) -> &Value {
        value.get("data").unwrap_or(value)
    }

    #[test]
    fn coordination_targets_expand_container_children_without_parent_agents() {
        let root = test_root("expand-container");
        create_package_project(&root.join("frontend"));
        create_package_project(&root.join("backend"));

        let targets =
            coordination_workspace_targets(Some(root.display().to_string()), None).unwrap();
        let target_data = data(&targets);
        let target_paths = target_data["targets"].as_array().unwrap();

        assert_eq!(target_data["container"].as_bool(), Some(true));
        assert_eq!(target_paths.len(), 2);
        assert!(target_paths.iter().any(|target| {
            target["mountId"].as_str() == Some("backend")
                && target["repoPath"]
                    .as_str()
                    .is_some_and(|path| path.ends_with("backend"))
        }));
        assert!(target_paths.iter().any(|target| {
            target["mountId"].as_str() == Some("frontend")
                && target["repoPath"]
                    .as_str()
                    .is_some_and(|path| path.ends_with("frontend"))
        }));
        assert!(!root.join(".agents").exists());

        let snapshot = coordination_get_snapshot(Some(root.display().to_string()), None).unwrap();
        let snapshot_data = data(&snapshot);
        assert_eq!(snapshot_data["container"].as_bool(), Some(true));
        assert_eq!(
            snapshot_data["skippedProjects"].as_array().unwrap().len(),
            2
        );
        assert!(!root.join(".agents").exists());
        assert!(!root.join("frontend").join(".agents").exists());
        assert!(!root.join("backend").join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn coordination_targets_expand_nested_container_leaf_projects_only() {
        let root = test_root("expand-nested-container");
        create_package_project(&root.join("product-a").join("frontend"));
        create_package_project(&root.join("product-a").join("backend"));
        create_package_project(&root.join("product-b").join("api"));

        let targets =
            coordination_workspace_targets(Some(root.display().to_string()), None).unwrap();
        let target_data = data(&targets);
        let target_paths = target_data["targets"].as_array().unwrap();

        assert_eq!(target_data["container"].as_bool(), Some(true));
        assert_eq!(target_paths.len(), 3);
        assert!(target_paths.iter().any(|target| {
            target["mountId"].as_str() == Some("product-a/frontend")
                && target["repoPath"]
                    .as_str()
                    .is_some_and(|path| path.ends_with("product-a/frontend"))
        }));
        assert!(target_paths.iter().any(|target| {
            target["mountId"].as_str() == Some("product-a/backend")
                && target["repoPath"]
                    .as_str()
                    .is_some_and(|path| path.ends_with("product-a/backend"))
        }));
        assert!(target_paths
            .iter()
            .all(|target| target["projectKind"].as_str() != Some("container")));
        assert!(!root.join(".agents").exists());
        assert!(!root.join(".git").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ambiguous_container_single_repo_commands_refuse_parent_kernel() {
        let root = test_root("refuse-parent");
        create_package_project(&root.join("frontend"));
        create_package_project(&root.join("backend"));

        let error = coordination_workspace_mcp_registry(
            Some(root.display().to_string()),
            None,
            "workspace-1".to_string(),
            Some("Workspace".to_string()),
        )
        .unwrap_err();

        assert!(error.contains("multiple projects"));
        assert!(!root.join(".agents").exists());
        assert!(!root.join("frontend").join(".agents").exists());
        assert!(!root.join("backend").join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn container_snapshot_aggregates_existing_child_kernel_only() {
        let root = test_root("aggregate-child");
        let frontend = root.join("frontend");
        let backend = root.join("backend");
        create_package_project(&frontend);
        create_package_project(&backend);

        let init = coordination_init(Some(frontend.display().to_string()), None).unwrap();
        let init_db_path = PathBuf::from(data(&init)["db_path"].as_str().unwrap_or_default());
        assert!(init_db_path.exists());

        let snapshot = coordination_get_snapshot(Some(root.display().to_string()), None).unwrap();
        let snapshot_data = data(&snapshot);
        let project_snapshots = snapshot_data["projectSnapshots"].as_array().unwrap();
        let skipped_projects = snapshot_data["skippedProjects"].as_array().unwrap();

        assert_eq!(snapshot_data["container"].as_bool(), Some(true));
        assert_eq!(project_snapshots.len(), 1);
        assert_eq!(skipped_projects.len(), 1);
        assert_eq!(project_snapshots[0]["mountId"].as_str(), Some("frontend"));
        assert_eq!(skipped_projects[0]["mountId"].as_str(), Some("backend"));
        assert!(!root.join(".agents").exists());
        assert!(!backend.join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn single_child_container_commands_auto_target_child_project() {
        let root = test_root("single-child");
        let frontend = root.join("frontend");
        create_package_project(&frontend);

        let registry = coordination_workspace_mcp_registry(
            Some(root.display().to_string()),
            None,
            "workspace-1".to_string(),
            Some("Workspace".to_string()),
        )
        .unwrap();
        let registry_data = data(&registry);
        let frontend_path = frontend.canonicalize().unwrap();
        let registry_repo_path = PathBuf::from(
            registry_data["coordination_kernel"]["repo_path"]
                .as_str()
                .unwrap_or_default(),
        )
        .canonicalize()
        .unwrap();

        assert_eq!(
            crate::normalized_path_key(&registry_repo_path),
            crate::normalized_path_key(&frontend_path)
        );
        assert!(!root.join(".agents").exists());
        let registry_db_path = PathBuf::from(
            registry_data["coordination_kernel"]["db_path"]
                .as_str()
                .unwrap_or_default(),
        );
        assert!(registry_db_path.exists());

        let _ = fs::remove_dir_all(root);
    }
}
