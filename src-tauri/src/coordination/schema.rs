pub const INITIAL_MIGRATION_VERSION: i64 = 1;
pub const INITIAL_MIGRATION_NAME: &str = "coordination_kernel_initial";
pub const SLOT_MIGRATION_VERSION: i64 = 2;
pub const SLOT_MIGRATION_NAME: &str = "coordination_kernel_slots";
pub const RUNTIME_GUARD_MIGRATION_VERSION: i64 = 3;
pub const RUNTIME_GUARD_MIGRATION_NAME: &str = "coordination_kernel_runtime_guards";
pub const MIGRATION_VERSION: i64 = RUNTIME_GUARD_MIGRATION_VERSION;
pub const MIGRATION_NAME: &str = RUNTIME_GUARD_MIGRATION_NAME;

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
  orchestration_run_id TEXT,
  orchestration_role TEXT,
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
  orchestration_run_id TEXT,
  orchestration_plan_item_id TEXT,
  assigned_role TEXT,
  expected_output TEXT,
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
  orchestration_run_id TEXT,
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
  orchestration_run_id TEXT,
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
  orchestration_run_id TEXT,
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
  cloud_orchestrator_enabled INTEGER NOT NULL DEFAULT 0,
  cloud_orchestrator_mode TEXT NOT NULL DEFAULT 'disabled',
  cloud_context_export_policy TEXT NOT NULL DEFAULT 'local_only',
  cloud_allow_code_export INTEGER NOT NULL DEFAULT 0,
  cloud_allow_terminal_log_export INTEGER NOT NULL DEFAULT 0,
  cloud_allow_patch_export INTEGER NOT NULL DEFAULT 0,
  cloud_auto_create_tasks INTEGER NOT NULL DEFAULT 0,
  cloud_auto_assign_agents INTEGER NOT NULL DEFAULT 0,
  cloud_auto_spawn_terminals INTEGER NOT NULL DEFAULT 0,
  cloud_auto_merge INTEGER NOT NULL DEFAULT 0,
  cloud_contract_memory_enabled INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS cloud_orchestrator_configs(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'disabled',
  endpoint_url TEXT,
  api_key_ref TEXT,
  model_hint TEXT,
  context_export_policy TEXT NOT NULL DEFAULT 'local_only',
  allow_code_export INTEGER NOT NULL DEFAULT 0,
  allow_terminal_log_export INTEGER NOT NULL DEFAULT 0,
  allow_patch_export INTEGER NOT NULL DEFAULT 0,
  auto_create_tasks INTEGER NOT NULL DEFAULT 0,
  auto_assign_agents INTEGER NOT NULL DEFAULT 0,
  auto_spawn_terminals INTEGER NOT NULL DEFAULT 0,
  auto_merge INTEGER NOT NULL DEFAULT 0,
  sync_interval_seconds INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  status TEXT NOT NULL DEFAULT 'disabled',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_runs(
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  cloud_run_id TEXT,
  root_task_id TEXT,
  context_snapshot_artifact_id TEXT,
  plan_artifact_id TEXT,
  summary TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_plan_items(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  parent_item_id TEXT,
  task_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  assigned_role TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  risk_level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  required_resources_json TEXT,
  expected_outputs_json TEXT,
  depends_on_json TEXT,
  contract_memory_ids_json TEXT,
  qa_checks_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_agent_assignments(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan_item_id TEXT,
  task_id TEXT,
  requested_agent_kind TEXT,
  requested_agent_name TEXT,
  assigned_agent_id TEXT,
  session_id TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_messages(
  id TEXT PRIMARY KEY,
  run_id TEXT,
  direction TEXT NOT NULL,
  message_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  redaction_level TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  artifact_id TEXT,
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
CREATE INDEX IF NOT EXISTS idx_leases_resource_status ON leases(resource_id, status);
CREATE INDEX IF NOT EXISTS idx_leases_active_resource ON leases(resource_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
CREATE INDEX IF NOT EXISTS idx_violations_status ON workspace_violations(status);
CREATE INDEX IF NOT EXISTS idx_patches_status ON patches(status);
CREATE INDEX IF NOT EXISTS idx_merge_jobs_status ON merge_jobs(status);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(memory_kind, trust_level);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_slot ON worktrees(agent_slot_id) WHERE agent_slot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_path ON worktrees(path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_branch ON worktrees(branch_name);
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
