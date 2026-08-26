// Workspace-view state is ADE-local presentation intent. This file is intentionally
// self-contained except for `sessions_database_path`: including it from lib.rs keeps
// the view store beside sessions and spaces in the existing sessions.sqlite file.
//
// This boundary stores references only. Session transcripts, rosters, run facts,
// native window labels, and process-incarnation identifiers do not belong here.

const WORKSPACE_VIEW_SCHEMA_VERSION: i64 = 1;
const WORKSPACE_VIEW_JSON_MAX_BYTES: usize = 1024 * 1024;
const BREAKOUT_GEOMETRY_JSON_MAX_BYTES: usize = 16 * 1024;
const BREAKOUT_VIEW_STATE_JSON_MAX_BYTES: usize = 256 * 1024;
const WORKSPACE_VIEW_MAX_OPEN_SESSIONS: usize = 4096;
const BREAKOUT_CLEAR_MAX_KEEP_IDS: usize = 900;
const BREAKOUT_PRESENTATION_STATE_KEYS: &[&str] = &["activeSubTab", "viewMode"];

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceView {
    pub open_sessions: Vec<String>,
    pub active_target: WorkspaceViewActiveTarget,
    pub active_space_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkspaceViewActiveTarget {
    Session { session_ref: String },
    Space { space_id: String },
    Home,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct WorkspaceViewRecord {
    pub profile_id: String,
    pub revision: u64,
    pub updated_at_ms: i64,
    pub schema_version: i64,
    pub view_json: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BreakoutKind {
    Session,
    SpaceLeaf,
}

impl BreakoutKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::SpaceLeaf => "space_leaf",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "session" => Ok(Self::Session),
            "space_leaf" => Ok(Self::SpaceLeaf),
            _ => Err(format!(
                "Breakout kind '{value}' is unsupported; expected 'session' or 'space_leaf'."
            )),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BreakoutGeometry {
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximized: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct BreakoutRecord {
    pub id: String,
    pub profile_id: String,
    pub kind: BreakoutKind,
    pub session_ref: Option<String>,
    pub space_id: Option<String>,
    pub leaf_id: Option<String>,
    pub geometry_json: Option<String>,
    pub view_state_json: Option<String>,
    pub revision: u64,
    pub updated_at_ms: i64,
    pub schema_version: i64,
}

#[derive(Debug, PartialEq, Eq)]
enum WorkspaceViewDeserializationError {
    Invalid(String),
    CanonicalByteDivergence,
}

impl std::fmt::Display for WorkspaceViewDeserializationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::CanonicalByteDivergence => formatter.write_str(
                "Workspace view canonical-byte divergence: input bytes differ from canonical serialization.",
            ),
        }
    }
}

impl std::error::Error for WorkspaceViewDeserializationError {}

impl From<WorkspaceViewDeserializationError> for String {
    fn from(error: WorkspaceViewDeserializationError) -> Self {
        error.to_string()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BreakoutJsonField {
    Geometry,
    ViewState,
}

impl BreakoutJsonField {
    fn label(self) -> &'static str {
        match self {
            Self::Geometry => "Breakout geometry",
            Self::ViewState => "Breakout view state",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum BreakoutJsonDeserializationError {
    Invalid {
        field: BreakoutJsonField,
        message: String,
    },
    CanonicalByteDivergence(BreakoutJsonField),
}

impl std::fmt::Display for BreakoutJsonDeserializationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid { field, message } => {
                write!(formatter, "{} is invalid: {message}", field.label())
            }
            Self::CanonicalByteDivergence(field) => write!(
                formatter,
                "{} canonical-byte divergence: input bytes differ from canonical serialization.",
                field.label()
            ),
        }
    }
}

impl std::error::Error for BreakoutJsonDeserializationError {}

impl From<BreakoutJsonDeserializationError> for String {
    fn from(error: BreakoutJsonDeserializationError) -> Self {
        error.to_string()
    }
}

fn workspace_view_nonempty_trimmed(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.trim() != value {
        return Err(format!("{label} must be non-empty and already trimmed."));
    }
    Ok(())
}

fn workspace_view_validate_reference(value: &str, label: &str) -> Result<(), String> {
    workspace_view_nonempty_trimmed(value, label)?;
    if value.len() > 4096 {
        return Err(format!("{label} may contain at most 4096 bytes."));
    }
    Ok(())
}

fn workspace_view_validate_profile_id(profile_id: &str) -> Result<(), String> {
    workspace_view_nonempty_trimmed(profile_id, "Profile id")?;
    if profile_id.len() > 512 {
        return Err("Profile id may contain at most 512 bytes.".to_string());
    }
    Ok(())
}

fn workspace_view_validate_view(view: &WorkspaceView) -> Result<(), String> {
    if view.open_sessions.len() > WORKSPACE_VIEW_MAX_OPEN_SESSIONS {
        return Err(format!(
            "A workspace view may contain at most {WORKSPACE_VIEW_MAX_OPEN_SESSIONS} open session references."
        ));
    }
    let mut open_sessions = std::collections::HashSet::new();
    for session_ref in &view.open_sessions {
        workspace_view_validate_reference(session_ref, "Open session reference")?;
        if !open_sessions.insert(session_ref.as_str()) {
            return Err(format!(
                "Open session reference '{session_ref}' is duplicated."
            ));
        }
    }
    match &view.active_target {
        WorkspaceViewActiveTarget::Session { session_ref } => {
            workspace_view_validate_reference(session_ref, "Active session reference")?;
        }
        WorkspaceViewActiveTarget::Space { space_id } => {
            workspace_view_validate_reference(space_id, "Active target space id")?;
        }
        WorkspaceViewActiveTarget::Home => {}
    }
    if let Some(space_id) = view.active_space_id.as_deref() {
        workspace_view_validate_reference(space_id, "Active space id")?;
    }
    Ok(())
}

fn workspace_view_parse_canonical_view(
    view_json: &str,
) -> Result<(WorkspaceView, String), WorkspaceViewDeserializationError> {
    if view_json.len() > WORKSPACE_VIEW_JSON_MAX_BYTES {
        return Err(WorkspaceViewDeserializationError::Invalid(format!(
            "Workspace view exceeds the {WORKSPACE_VIEW_JSON_MAX_BYTES}-byte limit."
        )));
    }
    let view = serde_json::from_str::<WorkspaceView>(view_json).map_err(|error| {
        WorkspaceViewDeserializationError::Invalid(format!(
            "Unable to decode workspace view: {error}"
        ))
    })?;
    workspace_view_validate_view(&view).map_err(WorkspaceViewDeserializationError::Invalid)?;
    let canonical = serde_json::to_string(&view).map_err(|error| {
        WorkspaceViewDeserializationError::Invalid(format!(
            "Unable to encode canonical workspace view: {error}"
        ))
    })?;
    if canonical.as_bytes() != view_json.as_bytes() {
        return Err(WorkspaceViewDeserializationError::CanonicalByteDivergence);
    }
    Ok((view, canonical))
}

fn workspace_view_validate_geometry(geometry: &BreakoutGeometry) -> Result<(), String> {
    if geometry.width == 0 || geometry.height == 0 {
        return Err("Breakout geometry width and height must be positive.".to_string());
    }
    if let Some(display) = geometry.display.as_deref() {
        workspace_view_validate_reference(display, "Breakout geometry display")?;
    }
    Ok(())
}

fn workspace_view_parse_canonical_geometry(
    geometry_json: &str,
) -> Result<(BreakoutGeometry, String), BreakoutJsonDeserializationError> {
    if geometry_json.len() > BREAKOUT_GEOMETRY_JSON_MAX_BYTES {
        return Err(BreakoutJsonDeserializationError::Invalid {
            field: BreakoutJsonField::Geometry,
            message: format!("the JSON exceeds the {BREAKOUT_GEOMETRY_JSON_MAX_BYTES}-byte limit"),
        });
    }
    let geometry = serde_json::from_str::<BreakoutGeometry>(geometry_json).map_err(|error| {
        BreakoutJsonDeserializationError::Invalid {
            field: BreakoutJsonField::Geometry,
            message: format!("unable to decode JSON: {error}"),
        }
    })?;
    workspace_view_validate_geometry(&geometry).map_err(|message| {
        BreakoutJsonDeserializationError::Invalid {
            field: BreakoutJsonField::Geometry,
            message,
        }
    })?;
    let canonical = serde_json::to_string(&geometry).map_err(|error| {
        BreakoutJsonDeserializationError::Invalid {
            field: BreakoutJsonField::Geometry,
            message: format!("unable to encode canonical JSON: {error}"),
        }
    })?;
    if canonical.as_bytes() != geometry_json.as_bytes() {
        return Err(BreakoutJsonDeserializationError::CanonicalByteDivergence(
            BreakoutJsonField::Geometry,
        ));
    }
    Ok((geometry, canonical))
}

fn workspace_view_sort_json_value(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Array(values) => serde_json::Value::Array(
            values
                .into_iter()
                .map(workspace_view_sort_json_value)
                .collect(),
        ),
        serde_json::Value::Object(entries) => {
            let mut entries = entries.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            let mut sorted = serde_json::Map::new();
            for (key, value) in entries {
                sorted.insert(key, workspace_view_sort_json_value(value));
            }
            serde_json::Value::Object(sorted)
        }
        scalar => scalar,
    }
}

fn workspace_view_validate_presentation_state(value: &serde_json::Value) -> Result<(), String> {
    let serde_json::Value::Object(entries) = value else {
        return Err(
            "presentation state must be a JSON object; use an absent value for unknown state"
                .to_string(),
        );
    };
    for (key, child) in entries {
        if !BREAKOUT_PRESENTATION_STATE_KEYS.contains(&key.as_str()) {
            return Err(format!(
                "field '{key}' is not in the breakout presentation-state allowlist"
            ));
        }
        if !matches!(
            child,
            serde_json::Value::Null | serde_json::Value::String(_)
        ) {
            return Err(format!(
                "field '{key}' must be a string or null; breakout presentation state does not allow nested objects or arrays"
            ));
        }
    }
    Ok(())
}

fn workspace_view_parse_canonical_view_state(
    view_state_json: &str,
) -> Result<(serde_json::Value, String), BreakoutJsonDeserializationError> {
    if view_state_json.len() > BREAKOUT_VIEW_STATE_JSON_MAX_BYTES {
        return Err(BreakoutJsonDeserializationError::Invalid {
            field: BreakoutJsonField::ViewState,
            message: format!(
                "the JSON exceeds the {BREAKOUT_VIEW_STATE_JSON_MAX_BYTES}-byte limit"
            ),
        });
    }
    let view_state =
        serde_json::from_str::<serde_json::Value>(view_state_json).map_err(|error| {
            BreakoutJsonDeserializationError::Invalid {
                field: BreakoutJsonField::ViewState,
                message: format!("unable to decode JSON: {error}"),
            }
        })?;
    workspace_view_validate_presentation_state(&view_state).map_err(|message| {
        BreakoutJsonDeserializationError::Invalid {
            field: BreakoutJsonField::ViewState,
            message,
        }
    })?;
    let view_state = workspace_view_sort_json_value(view_state);
    let canonical = serde_json::to_string(&view_state).map_err(|error| {
        BreakoutJsonDeserializationError::Invalid {
            field: BreakoutJsonField::ViewState,
            message: format!("unable to encode canonical JSON: {error}"),
        }
    })?;
    if canonical.as_bytes() != view_state_json.as_bytes() {
        return Err(BreakoutJsonDeserializationError::CanonicalByteDivergence(
            BreakoutJsonField::ViewState,
        ));
    }
    Ok((view_state, canonical))
}

fn workspace_view_validate_breakout_coordinates(
    kind: BreakoutKind,
    session_ref: Option<&str>,
    space_id: Option<&str>,
    leaf_id: Option<&str>,
) -> Result<(), String> {
    match (kind, session_ref, space_id, leaf_id) {
        (BreakoutKind::Session, Some(session_ref), None, None) => {
            workspace_view_validate_reference(session_ref, "Breakout session reference")
        }
        (BreakoutKind::SpaceLeaf, None, Some(space_id), Some(leaf_id)) => {
            workspace_view_validate_reference(space_id, "Breakout space id")?;
            workspace_view_validate_reference(leaf_id, "Breakout leaf id")
        }
        (BreakoutKind::Session, _, _, _) => Err(
            "A session breakout requires session_ref and forbids space_id and leaf_id.".to_string(),
        ),
        (BreakoutKind::SpaceLeaf, _, _, _) => Err(
            "A space_leaf breakout requires space_id and leaf_id and forbids session_ref."
                .to_string(),
        ),
    }
}

fn workspace_view_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn workspace_view_write_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

fn workspace_view_table_exists(
    connection: &rusqlite::Connection,
    table: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [table],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Unable to inspect the workspace view SQLite store: {error}"))
}

fn workspace_view_table_columns(
    connection: &rusqlite::Connection,
    table: &str,
) -> Result<std::collections::HashSet<String>, String> {
    if table != "workspace_view" && table != "breakout_window" {
        return Err(format!("Unsupported workspace view table '{table}'."));
    }
    let query = format!("PRAGMA table_info({table})");
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("Unable to inspect the {table} SQLite schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to query the {table} SQLite schema: {error}"))?
        .collect::<Result<std::collections::HashSet<_>, _>>()
        .map_err(|error| format!("Unable to decode the {table} SQLite schema: {error}"))?;
    Ok(columns)
}

fn workspace_view_require_columns(
    connection: &rusqlite::Connection,
    table: &str,
    expected: &[&str],
    stored_version: i64,
) -> Result<(), String> {
    let columns = workspace_view_table_columns(connection, table)?;
    let missing = expected
        .iter()
        .filter(|column| !columns.contains(**column))
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Workspace view schema version {stored_version} table '{table}' is missing columns: {}.",
            missing.join(", ")
        ))
    }
}

fn workspace_view_initialize_database(connection: &mut rusqlite::Connection) -> Result<(), String> {
    connection
        .execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|error| format!("Unable to configure the workspace view SQLite store: {error}"))?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin workspace view SQLite migration: {error}"))?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_view_schema (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                version INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Unable to initialize workspace view schema metadata: {error}"))?;
    let stored_version = match transaction.query_row(
        "SELECT version FROM workspace_view_schema WHERE singleton = 1",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(version) => version,
        Err(rusqlite::Error::QueryReturnedNoRows) => 0,
        Err(error) => {
            return Err(format!(
                "Unable to read workspace view schema version: {error}"
            ))
        }
    };
    if stored_version > WORKSPACE_VIEW_SCHEMA_VERSION {
        return Err(format!(
            "Workspace view schema version {stored_version} is newer than supported version {WORKSPACE_VIEW_SCHEMA_VERSION}."
        ));
    }

    if stored_version == 0 {
        if workspace_view_table_exists(&transaction, "workspace_view")?
            || workspace_view_table_exists(&transaction, "breakout_window")?
        {
            return Err(
                "An unversioned workspace view table already exists; refusing a destructive migration."
                    .to_string(),
            );
        }
        transaction
            .execute_batch(
                "CREATE TABLE workspace_view (
                    profile_id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    updated_at_ms INTEGER NOT NULL,
                    schema_version INTEGER NOT NULL,
                    view_json TEXT NOT NULL
                 );
                 CREATE TABLE breakout_window (
                    id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('session', 'space_leaf')),
                    session_ref TEXT,
                    space_id TEXT,
                    leaf_id TEXT,
                    geometry_json TEXT,
                    view_state_json TEXT,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    updated_at_ms INTEGER NOT NULL,
                    schema_version INTEGER NOT NULL,
                    CHECK (
                        (kind = 'session' AND session_ref IS NOT NULL
                            AND space_id IS NULL AND leaf_id IS NULL)
                        OR
                        (kind = 'space_leaf' AND session_ref IS NULL
                            AND space_id IS NOT NULL AND leaf_id IS NOT NULL)
                    )
                 );
                 CREATE INDEX idx_breakout_window_profile
                    ON breakout_window(profile_id, id);",
            )
            .map_err(|error| format!("Unable to create workspace view SQLite schema: {error}"))?;
        transaction
            .execute(
                "INSERT INTO workspace_view_schema(singleton, version) VALUES (1, ?1)",
                [WORKSPACE_VIEW_SCHEMA_VERSION],
            )
            .map_err(|error| format!("Unable to version workspace view SQLite schema: {error}"))?;
    }

    workspace_view_require_columns(
        &transaction,
        "workspace_view",
        &[
            "profile_id",
            "revision",
            "updated_at_ms",
            "schema_version",
            "view_json",
        ],
        stored_version,
    )?;
    workspace_view_require_columns(
        &transaction,
        "breakout_window",
        &[
            "id",
            "profile_id",
            "kind",
            "session_ref",
            "space_id",
            "leaf_id",
            "geometry_json",
            "view_state_json",
            "revision",
            "updated_at_ms",
            "schema_version",
        ],
        stored_version,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit workspace view SQLite migration: {error}"))?;
    Ok(())
}

fn workspace_view_open_database() -> Result<rusqlite::Connection, String> {
    let path = sessions_database_path()?;
    let mut connection = rusqlite::Connection::open(&path)
        .map_err(|error| format!("Unable to open workspace view SQLite store: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("Unable to configure workspace view SQLite timeout: {error}"))?;
    workspace_view_initialize_database(&mut connection)?;
    Ok(connection)
}

struct WorkspaceViewStoredRow {
    profile_id: String,
    revision: i64,
    updated_at_ms: i64,
    schema_version: i64,
    view_json: String,
}

fn workspace_view_decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceViewStoredRow> {
    Ok(WorkspaceViewStoredRow {
        profile_id: row.get(0)?,
        revision: row.get(1)?,
        updated_at_ms: row.get(2)?,
        schema_version: row.get(3)?,
        view_json: row.get(4)?,
    })
}

fn workspace_view_validate_stored_row(
    row: WorkspaceViewStoredRow,
) -> Result<WorkspaceViewRecord, String> {
    workspace_view_validate_profile_id(&row.profile_id)?;
    if row.schema_version != WORKSPACE_VIEW_SCHEMA_VERSION {
        return Err(format!(
            "Workspace view for profile '{}' uses unsupported schema version {}.",
            row.profile_id, row.schema_version
        ));
    }
    let revision = u64::try_from(row.revision).map_err(|_| {
        format!(
            "Workspace view for profile '{}' has invalid revision {}.",
            row.profile_id, row.revision
        )
    })?;
    if revision == 0 {
        return Err(format!(
            "Workspace view for profile '{}' has invalid revision 0.",
            row.profile_id
        ));
    }
    workspace_view_parse_canonical_view(&row.view_json)?;
    Ok(WorkspaceViewRecord {
        profile_id: row.profile_id,
        revision,
        updated_at_ms: row.updated_at_ms,
        schema_version: row.schema_version,
        view_json: row.view_json,
    })
}

fn workspace_view_get_from_connection(
    connection: &rusqlite::Connection,
    profile_id: &str,
) -> Result<Option<WorkspaceViewRecord>, String> {
    workspace_view_validate_profile_id(profile_id)?;
    let stored = match connection.query_row(
        "SELECT profile_id, revision, updated_at_ms, schema_version, view_json
         FROM workspace_view WHERE profile_id = ?1",
        [profile_id],
        workspace_view_decode_row,
    ) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(format!("Unable to read workspace view: {error}")),
    };
    workspace_view_validate_stored_row(stored).map(Some)
}

fn workspace_view_save_in_connection(
    connection: &mut rusqlite::Connection,
    profile_id: &str,
    view_json: String,
    expected_revision: Option<u64>,
    now_ms: i64,
) -> Result<WorkspaceViewRecord, String> {
    workspace_view_validate_profile_id(profile_id)?;
    let (_, canonical) = workspace_view_parse_canonical_view(&view_json)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin workspace view save: {error}"))?;
    let current_revision = match transaction.query_row(
        "SELECT revision FROM workspace_view WHERE profile_id = ?1",
        [profile_id],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(revision) => Some(revision),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(error) => return Err(format!("Unable to read workspace view revision: {error}")),
    };
    if let Some(expected) = expected_revision {
        let current = current_revision.and_then(|revision| u64::try_from(revision).ok());
        if current != Some(expected) {
            return Err(format!(
                "Workspace view revision conflict: expected {expected}, current {}.",
                current
                    .map(|revision| revision.to_string())
                    .unwrap_or_else(|| "absent".to_string())
            ));
        }
    }
    let next_revision = current_revision
        .unwrap_or(0)
        .checked_add(1)
        .filter(|revision| *revision > 0)
        .ok_or_else(|| "Workspace view revision is exhausted.".to_string())?;
    transaction
        .execute(
            "INSERT INTO workspace_view (
                profile_id, revision, updated_at_ms, schema_version, view_json
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(profile_id) DO UPDATE SET
                revision = excluded.revision,
                updated_at_ms = excluded.updated_at_ms,
                schema_version = excluded.schema_version,
                view_json = excluded.view_json",
            rusqlite::params![
                profile_id,
                next_revision,
                now_ms,
                WORKSPACE_VIEW_SCHEMA_VERSION,
                canonical,
            ],
        )
        .map_err(|error| format!("Unable to save workspace view: {error}"))?;
    let saved = workspace_view_get_from_connection(&transaction, profile_id)?
        .ok_or_else(|| "Saved workspace view was not found.".to_string())?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit workspace view save: {error}"))?;
    Ok(saved)
}

struct BreakoutStoredRow {
    id: String,
    profile_id: String,
    kind: String,
    session_ref: Option<String>,
    space_id: Option<String>,
    leaf_id: Option<String>,
    geometry_json: Option<String>,
    view_state_json: Option<String>,
    revision: i64,
    updated_at_ms: i64,
    schema_version: i64,
}

fn breakout_decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BreakoutStoredRow> {
    Ok(BreakoutStoredRow {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        kind: row.get(2)?,
        session_ref: row.get(3)?,
        space_id: row.get(4)?,
        leaf_id: row.get(5)?,
        geometry_json: row.get(6)?,
        view_state_json: row.get(7)?,
        revision: row.get(8)?,
        updated_at_ms: row.get(9)?,
        schema_version: row.get(10)?,
    })
}

fn breakout_validate_stored_row(row: BreakoutStoredRow) -> Result<BreakoutRecord, String> {
    workspace_view_validate_reference(&row.id, "Breakout id")?;
    workspace_view_validate_profile_id(&row.profile_id)?;
    if row.schema_version != WORKSPACE_VIEW_SCHEMA_VERSION {
        return Err(format!(
            "Breakout '{}' uses unsupported schema version {}.",
            row.id, row.schema_version
        ));
    }
    let kind = BreakoutKind::parse(&row.kind)?;
    workspace_view_validate_breakout_coordinates(
        kind,
        row.session_ref.as_deref(),
        row.space_id.as_deref(),
        row.leaf_id.as_deref(),
    )?;
    if let Some(geometry_json) = row.geometry_json.as_deref() {
        workspace_view_parse_canonical_geometry(geometry_json)?;
    }
    if let Some(view_state_json) = row.view_state_json.as_deref() {
        workspace_view_parse_canonical_view_state(view_state_json)?;
    }
    let revision = u64::try_from(row.revision)
        .ok()
        .filter(|revision| *revision > 0)
        .ok_or_else(|| {
            format!(
                "Breakout '{}' has invalid revision {}.",
                row.id, row.revision
            )
        })?;
    Ok(BreakoutRecord {
        id: row.id,
        profile_id: row.profile_id,
        kind,
        session_ref: row.session_ref,
        space_id: row.space_id,
        leaf_id: row.leaf_id,
        geometry_json: row.geometry_json,
        view_state_json: row.view_state_json,
        revision,
        updated_at_ms: row.updated_at_ms,
        schema_version: row.schema_version,
    })
}

const BREAKOUT_SELECT_COLUMNS: &str = "id, profile_id, kind, session_ref, space_id, leaf_id, geometry_json, view_state_json, revision, updated_at_ms, schema_version";

fn breakout_list_from_connection(
    connection: &rusqlite::Connection,
    profile_id: &str,
) -> Result<Vec<BreakoutRecord>, String> {
    workspace_view_validate_profile_id(profile_id)?;
    let query = format!(
        "SELECT {BREAKOUT_SELECT_COLUMNS} FROM breakout_window
         WHERE profile_id = ?1 ORDER BY id ASC"
    );
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("Unable to prepare breakout list: {error}"))?;
    let rows = statement
        .query_map([profile_id], breakout_decode_row)
        .map_err(|error| format!("Unable to list breakouts: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode breakout row: {error}"))?;
    rows.into_iter().map(breakout_validate_stored_row).collect()
}

#[allow(clippy::too_many_arguments)]
fn breakout_upsert_in_connection(
    connection: &mut rusqlite::Connection,
    profile_id: &str,
    id: &str,
    kind: BreakoutKind,
    session_ref: Option<String>,
    space_id: Option<String>,
    leaf_id: Option<String>,
    geometry_json: Option<String>,
    view_state_json: Option<String>,
    now_ms: i64,
) -> Result<BreakoutRecord, String> {
    workspace_view_validate_profile_id(profile_id)?;
    workspace_view_validate_reference(id, "Breakout id")?;
    workspace_view_validate_breakout_coordinates(
        kind,
        session_ref.as_deref(),
        space_id.as_deref(),
        leaf_id.as_deref(),
    )?;
    let geometry_json = match geometry_json {
        Some(json) => Some(workspace_view_parse_canonical_geometry(&json)?.1),
        None => None,
    };
    let view_state_json = match view_state_json {
        Some(json) => Some(workspace_view_parse_canonical_view_state(&json)?.1),
        None => None,
    };
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin breakout upsert: {error}"))?;
    let existing = match transaction.query_row(
        "SELECT profile_id, revision FROM breakout_window WHERE id = ?1",
        [id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    ) {
        Ok(existing) => Some(existing),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(error) => return Err(format!("Unable to read breakout revision: {error}")),
    };
    if let Some((existing_profile_id, _)) = existing.as_ref() {
        if existing_profile_id != profile_id {
            return Err(format!(
                "Breakout id '{id}' already belongs to another profile."
            ));
        }
    }
    let next_revision = existing
        .map(|(_, revision)| revision)
        .unwrap_or(0)
        .checked_add(1)
        .filter(|revision| *revision > 0)
        .ok_or_else(|| format!("Breakout '{id}' revision is exhausted."))?;
    transaction
        .execute(
            "INSERT INTO breakout_window (
                id, profile_id, kind, session_ref, space_id, leaf_id,
                geometry_json, view_state_json, revision, updated_at_ms, schema_version
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
                profile_id = excluded.profile_id,
                kind = excluded.kind,
                session_ref = excluded.session_ref,
                space_id = excluded.space_id,
                leaf_id = excluded.leaf_id,
                geometry_json = excluded.geometry_json,
                view_state_json = excluded.view_state_json,
                revision = excluded.revision,
                updated_at_ms = excluded.updated_at_ms,
                schema_version = excluded.schema_version",
            rusqlite::params![
                id,
                profile_id,
                kind.as_str(),
                session_ref,
                space_id,
                leaf_id,
                geometry_json,
                view_state_json,
                next_revision,
                now_ms,
                WORKSPACE_VIEW_SCHEMA_VERSION,
            ],
        )
        .map_err(|error| format!("Unable to upsert breakout: {error}"))?;
    let saved = breakout_get_from_connection(&transaction, profile_id, id)?
        .ok_or_else(|| "Upserted breakout was not found.".to_string())?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit breakout upsert: {error}"))?;
    Ok(saved)
}

fn breakout_get_from_connection(
    connection: &rusqlite::Connection,
    profile_id: &str,
    id: &str,
) -> Result<Option<BreakoutRecord>, String> {
    let query = format!(
        "SELECT {BREAKOUT_SELECT_COLUMNS} FROM breakout_window
         WHERE profile_id = ?1 AND id = ?2"
    );
    let stored = match connection.query_row(
        &query,
        rusqlite::params![profile_id, id],
        breakout_decode_row,
    ) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(format!("Unable to read breakout: {error}")),
    };
    breakout_validate_stored_row(stored).map(Some)
}

fn breakout_remove_in_connection(
    connection: &mut rusqlite::Connection,
    profile_id: &str,
    id: &str,
) -> Result<(), String> {
    workspace_view_validate_profile_id(profile_id)?;
    workspace_view_validate_reference(id, "Breakout id")?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin breakout removal: {error}"))?;
    transaction
        .execute(
            "DELETE FROM breakout_window WHERE profile_id = ?1 AND id = ?2",
            rusqlite::params![profile_id, id],
        )
        .map_err(|error| format!("Unable to remove breakout: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit breakout removal: {error}"))
}

fn breakout_clear_missing_in_connection(
    connection: &mut rusqlite::Connection,
    profile_id: &str,
    keep_ids: Vec<String>,
) -> Result<(), String> {
    workspace_view_validate_profile_id(profile_id)?;
    if keep_ids.len() > BREAKOUT_CLEAR_MAX_KEEP_IDS {
        return Err(format!(
            "breakout_clear_missing accepts at most {BREAKOUT_CLEAR_MAX_KEEP_IDS} ids."
        ));
    }
    let mut unique = std::collections::HashSet::new();
    for id in &keep_ids {
        workspace_view_validate_reference(id, "Breakout keep id")?;
        if !unique.insert(id.as_str()) {
            return Err(format!("Breakout keep id '{id}' is duplicated."));
        }
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin missing-breakout cleanup: {error}"))?;
    if keep_ids.is_empty() {
        transaction
            .execute(
                "DELETE FROM breakout_window WHERE profile_id = ?1",
                [profile_id],
            )
            .map_err(|error| format!("Unable to clear profile breakouts: {error}"))?;
    } else {
        let placeholders = std::iter::repeat_n("?", keep_ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let query = format!(
            "DELETE FROM breakout_window WHERE profile_id = ? AND id NOT IN ({placeholders})"
        );
        let values = std::iter::once(profile_id.to_string())
            .chain(keep_ids.into_iter())
            .collect::<Vec<_>>();
        transaction
            .execute(&query, rusqlite::params_from_iter(values))
            .map_err(|error| format!("Unable to clear missing breakouts: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit missing-breakout cleanup: {error}"))
}

fn workspace_view_get_blocking(profile_id: String) -> Result<Option<WorkspaceViewRecord>, String> {
    let connection = workspace_view_open_database()?;
    workspace_view_get_from_connection(&connection, profile_id.trim())
}

fn workspace_view_save_blocking(
    profile_id: String,
    view_json: String,
    expected_revision: Option<u64>,
) -> Result<WorkspaceViewRecord, String> {
    let _guard = workspace_view_write_lock()
        .lock()
        .map_err(|_| "Workspace view write lock is unavailable.".to_string())?;
    let mut connection = workspace_view_open_database()?;
    workspace_view_save_in_connection(
        &mut connection,
        profile_id.trim(),
        view_json,
        expected_revision,
        workspace_view_now_ms(),
    )
}

fn breakout_list_blocking(profile_id: String) -> Result<Vec<BreakoutRecord>, String> {
    let connection = workspace_view_open_database()?;
    breakout_list_from_connection(&connection, profile_id.trim())
}

#[allow(clippy::too_many_arguments)]
fn breakout_upsert_blocking(
    profile_id: String,
    id: String,
    kind: BreakoutKind,
    session_ref: Option<String>,
    space_id: Option<String>,
    leaf_id: Option<String>,
    geometry_json: Option<String>,
    view_state_json: Option<String>,
) -> Result<BreakoutRecord, String> {
    let _guard = workspace_view_write_lock()
        .lock()
        .map_err(|_| "Workspace view write lock is unavailable.".to_string())?;
    let mut connection = workspace_view_open_database()?;
    breakout_upsert_in_connection(
        &mut connection,
        profile_id.trim(),
        id.trim(),
        kind,
        session_ref,
        space_id,
        leaf_id,
        geometry_json,
        view_state_json,
        workspace_view_now_ms(),
    )
}

fn breakout_remove_in_connection_guarded(
    connection: &mut rusqlite::Connection,
    profile_id: &str,
    id: &str,
    application_exit_committed: bool,
) -> Result<bool, String> {
    if application_exit_committed {
        return Ok(false);
    }
    breakout_remove_in_connection(connection, profile_id, id)?;
    Ok(true)
}

fn breakout_remove_blocking_unchecked(profile_id: String, id: String) -> Result<(), String> {
    let _guard = workspace_view_write_lock()
        .lock()
        .map_err(|_| "Workspace view write lock is unavailable.".to_string())?;
    let mut connection = workspace_view_open_database()?;
    breakout_remove_in_connection(&mut connection, profile_id.trim(), id.trim())
}

fn breakout_remove_blocking_with_exit_guard(
    application_exit_committed: &std::sync::atomic::AtomicBool,
    application_exit_mutation_gate: &std::sync::Mutex<()>,
    profile_id: String,
    id: String,
) -> Result<bool, String> {
    let _exit_guard = application_exit_mutation_gate
        .lock()
        .map_err(|_| "Application exit mutation gate is unavailable.".to_string())?;
    let _guard = workspace_view_write_lock()
        .lock()
        .map_err(|_| "Workspace view write lock is unavailable.".to_string())?;
    let mut connection = workspace_view_open_database()?;
    breakout_remove_in_connection_guarded(
        &mut connection,
        profile_id.trim(),
        id.trim(),
        application_exit_committed.load(std::sync::atomic::Ordering::Acquire),
    )
}

fn breakout_clear_missing_blocking(
    profile_id: String,
    keep_ids: Vec<String>,
) -> Result<(), String> {
    let _guard = workspace_view_write_lock()
        .lock()
        .map_err(|_| "Workspace view write lock is unavailable.".to_string())?;
    let mut connection = workspace_view_open_database()?;
    breakout_clear_missing_in_connection(&mut connection, profile_id.trim(), keep_ids)
}

#[tauri::command(rename_all = "snake_case")]
async fn workspace_view_get(profile_id: String) -> Result<Option<WorkspaceViewRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_view_get_blocking(profile_id))
        .await
        .map_err(|error| format!("Workspace view get worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn workspace_view_save(
    profile_id: String,
    view_json: String,
    expected_revision: Option<u64>,
) -> Result<WorkspaceViewRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workspace_view_save_blocking(profile_id, view_json, expected_revision)
    })
    .await
    .map_err(|error| format!("Workspace view save worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn breakout_list(profile_id: String) -> Result<Vec<BreakoutRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || breakout_list_blocking(profile_id))
        .await
        .map_err(|error| format!("Breakout list worker failed: {error}"))?
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
async fn breakout_upsert(
    profile_id: String,
    id: String,
    kind: BreakoutKind,
    session_ref: Option<String>,
    space_id: Option<String>,
    leaf_id: Option<String>,
    geometry_json: Option<String>,
    view_state_json: Option<String>,
) -> Result<BreakoutRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        breakout_upsert_blocking(
            profile_id,
            id,
            kind,
            session_ref,
            space_id,
            leaf_id,
            geometry_json,
            view_state_json,
        )
    })
    .await
    .map_err(|error| format!("Breakout upsert worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn breakout_remove(
    application_exit_committed: tauri::State<'_, std::sync::Arc<std::sync::atomic::AtomicBool>>,
    application_exit_mutation_gate: tauri::State<'_, std::sync::Arc<std::sync::Mutex<()>>>,
    profile_id: String,
    id: String,
) -> Result<(), String> {
    let application_exit_committed = std::sync::Arc::clone(application_exit_committed.inner());
    let application_exit_mutation_gate =
        std::sync::Arc::clone(application_exit_mutation_gate.inner());
    tauri::async_runtime::spawn_blocking(move || {
        breakout_remove_blocking_with_exit_guard(
            &application_exit_committed,
            &application_exit_mutation_gate,
            profile_id,
            id,
        )
        .map(drop)
    })
    .await
    .map_err(|error| format!("Breakout remove worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn breakout_clear_missing(profile_id: String, keep_ids: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        breakout_clear_missing_blocking(profile_id, keep_ids)
    })
    .await
    .map_err(|error| format!("Breakout cleanup worker failed: {error}"))?
}

#[cfg(test)]
mod breakout_exit_guard_tests {
    use super::*;

    fn connection() -> rusqlite::Connection {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        workspace_view_initialize_database(&mut connection).unwrap();
        connection
    }

    fn insert_breakout(connection: &mut rusqlite::Connection, id: &str) {
        breakout_upsert_in_connection(
            connection,
            "profile-exit-guard",
            id,
            BreakoutKind::Session,
            Some(format!("session-{id}")),
            None,
            None,
            None,
            None,
            10,
        )
        .unwrap();
    }

    fn breakout_exists(connection: &rusqlite::Connection, id: &str) -> bool {
        breakout_get_from_connection(connection, "profile-exit-guard", id)
            .unwrap()
            .is_some()
    }

    #[test]
    fn breakout_remove_guard_is_noop_while_exiting_and_removes_while_running() {
        let mut connection = connection();
        insert_breakout(&mut connection, "remove-before");
        insert_breakout(&mut connection, "retain-after");

        assert!(breakout_remove_in_connection_guarded(
            &mut connection,
            "profile-exit-guard",
            "remove-before",
            false,
        )
        .unwrap());
        assert!(!breakout_exists(&connection, "remove-before"));

        assert!(!breakout_remove_in_connection_guarded(
            &mut connection,
            "profile-exit-guard",
            "retain-after",
            true,
        )
        .unwrap());
        assert!(breakout_exists(&connection, "retain-after"));
    }
}
