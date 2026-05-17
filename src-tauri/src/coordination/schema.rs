pub const INITIAL_MIGRATION_VERSION: i64 = 1;
pub const INITIAL_MIGRATION_NAME: &str = "coordination_kernel_initial";
pub const SLOT_MIGRATION_VERSION: i64 = 2;
pub const SLOT_MIGRATION_NAME: &str = "coordination_kernel_slots";
pub const RUNTIME_GUARD_MIGRATION_VERSION: i64 = 3;
pub const RUNTIME_GUARD_MIGRATION_NAME: &str = "coordination_kernel_runtime_guards";
pub const APPROVAL_SQL_ORCHESTRATION_MIGRATION_VERSION: i64 = 4;
pub const APPROVAL_SQL_ORCHESTRATION_MIGRATION_NAME: &str =
    "coordination_kernel_approval_sql_context_pack_alignment";
pub const MIGRATION_VERSION: i64 = 5;
pub const MIGRATION_NAME: &str = "coordination_kernel_ui_cleanup_alignment";
pub const DEPENDENCY_GRAPH_MIGRATION_VERSION: i64 = 6;
pub const DEPENDENCY_GRAPH_MIGRATION_NAME: &str = "coordination_kernel_dependency_graph_v2";
pub const TASK_LIFECYCLE_MIGRATION_VERSION: i64 = 7;
pub const TASK_LIFECYCLE_MIGRATION_NAME: &str = "coordination_kernel_task_lifecycle_boundaries";
pub const INTEGRATOR_POLICY_MIGRATION_VERSION: i64 = 8;
pub const INTEGRATOR_POLICY_MIGRATION_NAME: &str =
    "coordination_kernel_concurrent_integrator_policy";

pub const CREATE_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations(
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  role TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name, kind)
);

CREATE TABLE IF NOT EXISTS agent_slots(
  id TEXT PRIMARY KEY,
  slot_key TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  active_session_id TEXT,
  default_task_id TEXT,
  mcp_config_path TEXT NOT NULL UNIQUE,
  worktree_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_configs(
  id TEXT PRIMARY KEY,
  agent_slot_id TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL UNIQUE,
  config_hash TEXT,
  last_written_session_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_slot_id TEXT,
  task_id TEXT,
  context_run_id TEXT,
  context_role TEXT,
  pty_id TEXT,
  worktree_id TEXT,
  sandbox_db_id TEXT,
  base_git_sha TEXT,
  current_git_sha TEXT,
  base_schema_fingerprint TEXT,
  current_schema_fingerprint TEXT,
  status TEXT NOT NULL,
  write_root TEXT,
  enforcement_mode TEXT NOT NULL DEFAULT 'worktree_required',
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  risk_level INTEGER NOT NULL DEFAULT 1,
  claimed_by_agent_id TEXT,
  claimed_session_id TEXT,
  parent_task_id TEXT,
  context_run_id TEXT,
  source_plan_item_id TEXT,
  assigned_role TEXT,
  expected_output TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies(
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  dependency_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_resource_intents(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  intent_summary TEXT,
  status TEXT NOT NULL,
  lease_id TEXT,
  depends_on_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, resource_key)
);

CREATE TABLE IF NOT EXISTS task_slice_dependencies(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  depends_on_resource_key TEXT,
  dependency_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, resource_key, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS dependency_edges(
  id TEXT PRIMARY KEY,
  dependent_task_id TEXT NOT NULL,
  prerequisite_kind TEXT NOT NULL,
  prerequisite_key TEXT NOT NULL,
  predicate_kind TEXT NOT NULL,
  predicate_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  composition TEXT NOT NULL DEFAULT 'all_of',
  created_by_type TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  evidence_event_id TEXT,
  satisfied_by_event_id TEXT,
  satisfied_by_artifact_id TEXT,
  invalidated_by_event_id TEXT,
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(dependent_task_id, prerequisite_kind, prerequisite_key, predicate_kind, predicate_json)
);

CREATE TABLE IF NOT EXISTS resources(
  id TEXT PRIMARY KEY,
  resource_key TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL,
  risk_level INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leases(
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_slot_id TEXT,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  fence_token INTEGER NOT NULL,
  reason TEXT,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  last_heartbeat_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lease_conflicts(
  id TEXT PRIMARY KEY,
  requested_resource_id TEXT NOT NULL,
  requested_by_agent_id TEXT NOT NULL,
  requested_by_slot_id TEXT,
  blocking_lease_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  agent_slot_id TEXT,
  session_id TEXT,
  resource_id TEXT,
  artifact_id TEXT,
  context_run_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worktrees(
  id TEXT PRIMARY KEY,
  agent_slot_id TEXT,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  current_sha TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patches(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_slot_id TEXT,
  session_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  base_sha TEXT,
  head_sha TEXT,
  diff_artifact_id TEXT,
  status TEXT NOT NULL,
  risk_level INTEGER NOT NULL,
  validation_id TEXT,
  context_run_id TEXT,
  diff_hash TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patch_files(
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  path TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  old_hash TEXT,
  new_hash TEXT,
  lines_added INTEGER,
  lines_removed INTEGER
);

CREATE TABLE IF NOT EXISTS workspace_changes(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  agent_slot_id TEXT,
  session_id TEXT,
  worktree_id TEXT,
  change_source TEXT NOT NULL,
  path TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  lease_id TEXT,
  fence_token INTEGER,
  lease_status TEXT NOT NULL,
  violation_id TEXT,
  summary TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_watchers(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  status TEXT NOT NULL,
  backend TEXT NOT NULL,
  watched_paths_json TEXT NOT NULL,
  watched_path_count INTEGER NOT NULL DEFAULT 0,
  debounce_ms INTEGER NOT NULL DEFAULT 750,
  last_scan_at TEXT,
  last_event_at TEXT,
  last_error TEXT,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_violations(
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  session_id TEXT,
  worktree_id TEXT,
  violation_kind TEXT NOT NULL,
  path TEXT,
  resource_key TEXT,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS patch_validations(
  id TEXT PRIMARY KEY,
  patch_id TEXT,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  status TEXT NOT NULL,
  validation_summary TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patch_file_lease_validations(
  id TEXT PRIMARY KEY,
  patch_id TEXT,
  patch_file_id TEXT,
  path TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  lease_id TEXT,
  fence_token INTEGER,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merge_jobs(
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  status TEXT NOT NULL,
  target_branch TEXT,
  strategy TEXT NOT NULL,
  approval_id TEXT,
  result_artifact_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merge_resolution_tasks(
  id TEXT PRIMARY KEY,
  merge_job_id TEXT NOT NULL,
  patch_id TEXT NOT NULL,
  resolution_task_id TEXT NOT NULL,
  resolver_agent_id TEXT NOT NULL,
  resolver_session_id TEXT NOT NULL,
  resolver_worktree_id TEXT,
  resolved_patch_id TEXT,
  status TEXT NOT NULL,
  changed_files_json TEXT NOT NULL,
  cloud_context_json TEXT,
  resolver_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_batches(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  status TEXT NOT NULL,
  strategy TEXT NOT NULL,
  base_integration_sha TEXT,
  target_branch TEXT,
  merge_job_id TEXT,
  resolver_task_id TEXT,
  reason_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_batch_items(
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  patch_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  base_sha TEXT,
  changed_files_json TEXT NOT NULL,
  intent_summary TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts(
  id TEXT PRIMARY KEY,
  task_id TEXT,
  agent_id TEXT,
  agent_slot_id TEXT,
  artifact_kind TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_storage_logs(
  id TEXT PRIMARY KEY,
  artifact_id TEXT,
  repo_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  agent_slot_id TEXT,
  artifact_kind TEXT NOT NULL,
  requested_path TEXT NOT NULL,
  stored_path TEXT,
  content_hash TEXT,
  size_bytes INTEGER,
  status TEXT NOT NULL,
  action TEXT NOT NULL,
  error TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories(
  id TEXT PRIMARY KEY,
  memory_kind TEXT NOT NULL,
  trust_level TEXT NOT NULL,
  title TEXT NOT NULL,
  body_path TEXT NOT NULL,
  summary TEXT,
  evidence_artifact_id TEXT,
  task_id TEXT,
  patch_id TEXT,
  db_change_request_id TEXT,
  migration_id TEXT,
  context_run_id TEXT,
  created_by_agent_id TEXT,
  created_by_slot_id TEXT,
  certified_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_links(
  from_memory_id TEXT NOT NULL,
  to_memory_id TEXT NOT NULL,
  link_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_memory_id, to_memory_id, link_kind)
);

CREATE TABLE IF NOT EXISTS repo_policies(
  repo_id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  repo_has_sql INTEGER NOT NULL DEFAULT 0,
  sql_engine TEXT,
  sql_mcp_default TEXT NOT NULL,
  raw_sql_mcp_allowed INTEGER NOT NULL DEFAULT 0,
  per_agent_db_required INTEGER NOT NULL DEFAULT 1,
  shadow_validation_required INTEGER NOT NULL DEFAULT 1,
  prod_requires_human INTEGER NOT NULL DEFAULT 1,
  agent_worktree_required INTEGER NOT NULL DEFAULT 1,
  patch_lease_validation_required INTEGER NOT NULL DEFAULT 1,
  merge_gate_required INTEGER NOT NULL DEFAULT 1,
  root_repo_write_policy TEXT NOT NULL DEFAULT 'detect_and_reject_patch',
  unleased_write_policy TEXT NOT NULL DEFAULT 'reject_patch',
  no_git_write_policy TEXT NOT NULL DEFAULT 'coordination_only',
  merge_requires_clean_target INTEGER NOT NULL DEFAULT 1,
  merge_requires_human_for_unleased_override INTEGER NOT NULL DEFAULT 1,
  cloud_context_export_policy TEXT NOT NULL DEFAULT 'local_only',
  cloud_allow_code_export INTEGER NOT NULL DEFAULT 0,
  cloud_allow_terminal_log_export INTEGER NOT NULL DEFAULT 0,
  cloud_allow_patch_export INTEGER NOT NULL DEFAULT 0,
  cloud_auto_create_tasks INTEGER NOT NULL DEFAULT 0,
  cloud_auto_assign_agents INTEGER NOT NULL DEFAULT 0,
  cloud_auto_spawn_terminals INTEGER NOT NULL DEFAULT 0,
  cloud_auto_merge INTEGER NOT NULL DEFAULT 0,
  cloud_contract_memory_enabled INTEGER NOT NULL DEFAULT 1,
  integrator_enabled INTEGER NOT NULL DEFAULT 0,
  integrator_agent_id TEXT NOT NULL DEFAULT 'codex',
  integrator_model TEXT NOT NULL DEFAULT 'gpt-5.5',
  integrator_reasoning_effort TEXT NOT NULL DEFAULT 'xhigh',
  policy_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  requested_by_agent_id TEXT NOT NULL,
  approval_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  risk_summary TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS approval_gate_logs(
  id TEXT PRIMARY KEY,
  approval_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  session_id TEXT,
  action TEXT NOT NULL,
  decision TEXT,
  human_actor TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS db_change_requests(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  requested_by_agent_id TEXT NOT NULL,
  requested_by_session_id TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_level INTEGER NOT NULL DEFAULT 3,
  destructive INTEGER NOT NULL DEFAULT 0,
  production_impact TEXT,
  rollback_summary TEXT,
  approval_id TEXT,
  migration_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS db_change_request_resources(
  id TEXT PRIMARY KEY,
  db_change_request_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coordination_ui_surface_logs(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  command_name TEXT,
  actor TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coordination_bloat_audits(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  unexpected_mcp_file_count INTEGER NOT NULL DEFAULT 0,
  unexpected_worktree_dir_count INTEGER NOT NULL DEFAULT 0,
  stale_temp_file_count INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sql_connections(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  engine TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sql_sandboxes(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  connection_id TEXT,
  database_name TEXT NOT NULL,
  base_schema_fingerprint TEXT,
  current_schema_fingerprint TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_fingerprints(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  engine TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  migration_head TEXT,
  orm_schema_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS db_migrations(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  patch_id TEXT,
  agent_id TEXT NOT NULL,
  migration_name TEXT NOT NULL,
  migration_path TEXT,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  before_fingerprint TEXT,
  after_fingerprint TEXT,
  data_loss_risk TEXT,
  lock_risk TEXT,
  rollback_plan_artifact_id TEXT,
  schema_diff_artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS db_backfill_jobs(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  migration_id TEXT,
  table_name TEXT NOT NULL,
  status TEXT NOT NULL,
  batch_size INTEGER,
  checkpoint_json TEXT,
  expected_rows INTEGER,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  dry_run_artifact_id TEXT,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_context_exports(
  id TEXT PRIMARY KEY,
  run_id TEXT,
  repo_id TEXT NOT NULL,
  export_kind TEXT NOT NULL,
  redaction_policy TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_sync_jobs(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  sync_kind TEXT NOT NULL,
  error_message TEXT,
  cursor_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_slot_status ON agent_sessions(agent_slot_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_one_active_slot
ON agent_sessions(agent_slot_id)
WHERE status='active' AND agent_slot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_one_active_pty
ON agent_sessions(pty_id)
WHERE status='active' AND pty_id IS NOT NULL AND pty_id <> '';
CREATE INDEX IF NOT EXISTS idx_task_resource_intents_task ON task_resource_intents(task_id, status);
CREATE INDEX IF NOT EXISTS idx_task_resource_intents_resource ON task_resource_intents(resource_key, status);
CREATE INDEX IF NOT EXISTS idx_task_slice_dependencies_task ON task_slice_dependencies(task_id, status);
CREATE INDEX IF NOT EXISTS idx_task_slice_dependencies_resource ON task_slice_dependencies(resource_key, status);
CREATE INDEX IF NOT EXISTS idx_dependency_edges_dependent ON dependency_edges(dependent_task_id, status, required);
CREATE INDEX IF NOT EXISTS idx_dependency_edges_prerequisite ON dependency_edges(prerequisite_kind, prerequisite_key, status);
CREATE INDEX IF NOT EXISTS idx_dependency_edges_predicate ON dependency_edges(predicate_kind, status);
CREATE INDEX IF NOT EXISTS idx_leases_resource_status ON leases(resource_id, status);
CREATE INDEX IF NOT EXISTS idx_leases_active_resource ON leases(resource_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
CREATE INDEX IF NOT EXISTS idx_workspace_changes_task ON workspace_changes(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workspace_changes_session ON workspace_changes(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workspace_changes_resource ON workspace_changes(resource_key, created_at);
CREATE INDEX IF NOT EXISTS idx_file_watchers_status ON file_watchers(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_violations_status ON workspace_violations(status);
CREATE INDEX IF NOT EXISTS idx_patches_status ON patches(status);
CREATE INDEX IF NOT EXISTS idx_merge_jobs_status ON merge_jobs(status);
CREATE INDEX IF NOT EXISTS idx_merge_resolution_tasks_patch ON merge_resolution_tasks(patch_id, status);
CREATE INDEX IF NOT EXISTS idx_integration_batches_status ON integration_batches(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_integration_batch_items_batch ON integration_batch_items(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_integration_batch_items_patch ON integration_batch_items(patch_id);
CREATE INDEX IF NOT EXISTS idx_artifact_storage_logs_artifact ON artifact_storage_logs(artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifact_storage_logs_status ON artifact_storage_logs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(memory_kind, trust_level);
CREATE INDEX IF NOT EXISTS idx_approval_gate_logs_approval ON approval_gate_logs(approval_id, created_at);
CREATE INDEX IF NOT EXISTS idx_approval_gate_logs_task ON approval_gate_logs(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_db_change_requests_status ON db_change_requests(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_db_change_requests_task ON db_change_requests(task_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_db_change_request_resources_request ON db_change_request_resources(db_change_request_id);
CREATE INDEX IF NOT EXISTS idx_ui_surface_logs_surface ON coordination_ui_surface_logs(surface, created_at);
CREATE INDEX IF NOT EXISTS idx_bloat_audits_created ON coordination_bloat_audits(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_slot ON worktrees(agent_slot_id) WHERE agent_slot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_path ON worktrees(path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_branch ON worktrees(branch_name);
"#;

pub const DEPENDENCY_GRAPH_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS dependency_edges(
  id TEXT PRIMARY KEY,
  dependent_task_id TEXT NOT NULL,
  prerequisite_kind TEXT NOT NULL,
  prerequisite_key TEXT NOT NULL,
  predicate_kind TEXT NOT NULL,
  predicate_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  composition TEXT NOT NULL DEFAULT 'all_of',
  created_by_type TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  evidence_event_id TEXT,
  satisfied_by_event_id TEXT,
  satisfied_by_artifact_id TEXT,
  invalidated_by_event_id TEXT,
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(dependent_task_id, prerequisite_kind, prerequisite_key, predicate_kind, predicate_json)
);

CREATE INDEX IF NOT EXISTS idx_dependency_edges_dependent ON dependency_edges(dependent_task_id, status, required);
CREATE INDEX IF NOT EXISTS idx_dependency_edges_prerequisite ON dependency_edges(prerequisite_kind, prerequisite_key, status);
CREATE INDEX IF NOT EXISTS idx_dependency_edges_predicate ON dependency_edges(predicate_kind, status);
"#;

pub const SLOT_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS agent_slots(
  id TEXT PRIMARY KEY,
  slot_key TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  active_session_id TEXT,
  default_task_id TEXT,
  mcp_config_path TEXT NOT NULL UNIQUE,
  worktree_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_configs(
  id TEXT PRIMARY KEY,
  agent_slot_id TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL UNIQUE,
  config_hash TEXT,
  last_written_session_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_slot_status ON agent_sessions(agent_slot_id, status);
CREATE INDEX IF NOT EXISTS idx_leases_active_resource ON leases(resource_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_slot ON worktrees(agent_slot_id) WHERE agent_slot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_path ON worktrees(path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_branch ON worktrees(branch_name);
"#;

pub const RUNTIME_GUARD_SCHEMA_SQL: &str = r#"
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_one_active_slot
ON agent_sessions(agent_slot_id)
WHERE status='active' AND agent_slot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_one_active_pty
ON agent_sessions(pty_id)
WHERE status='active' AND pty_id IS NOT NULL AND pty_id <> '';
"#;
