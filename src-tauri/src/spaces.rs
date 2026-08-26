// Spaces are ADE-local state. This file is intentionally self-contained except
// for `sessions_database_path`: when S1 includes it from lib.rs, that existing
// crate-local helper keeps spaces in the same sessions.sqlite file as sessions.

const SPACES_SCHEMA_VERSION: i64 = 1;
const SPACE_LAYOUT_MAX_BYTES: usize = 4 * 1024 * 1024;
const SPACE_MAX_NODES: usize = 4096;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpaceLayout {
    pub members: Vec<String>,
    pub root: Option<SpaceLayoutNode>,
}

impl SpaceLayout {
    fn empty() -> Self {
        Self {
            members: Vec::new(),
            root: None,
        }
    }

    fn canonicalized(mut self) -> Self {
        self.members.sort();
        self
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SpaceLayoutNode {
    Stack {
        id: String,
        tabs: Vec<SpaceLayoutNode>,
        active: String,
    },
    Split {
        id: String,
        direction: SpaceSplitDirection,
        children: Vec<SpaceLayoutNode>,
        #[serde(deserialize_with = "spaces_deserialize_split_sizes")]
        sizes: Vec<u64>,
    },
    Leaf {
        id: String,
        #[serde(rename = "sessionRef")]
        session_ref: String,
        #[serde(rename = "viewKind")]
        view_kind: SpaceViewKind,
        #[serde(rename = "viewState")]
        view_state: SpaceViewState,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpaceSplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpaceViewKind {
    Chat,
    Shell,
    Trajectory,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpaceViewState {
    pub active_sub_tab: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct SpaceRecord {
    pub id: String,
    pub name: String,
    pub ordinal: i64,
    pub layout_json: String,
    pub focused_leaf: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub schema_version: i64,
}

// A listed space is either ready (canonical, enterable) or divergent (its stored
// bytes are not canonical / not decodable). Listing must NOT fail wholesale on one
// bad row: a single corrupt layout would otherwise hide every other space and make
// the typed "nothing was normalized or reset" card unreachable, because there would
// be no id to enter. A divergent entry still carries id/name/ordinal so the rail can
// list it and route entry into the typed error card; the strict canonical gate stays
// enforced by space_get / space_save_layout / reconcile_space.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SpaceListEntry {
    Ready(SpaceRecord),
    Divergent {
        id: String,
        name: String,
        ordinal: i64,
        reason: String,
    },
}

impl SpaceListEntry {
    fn id(&self) -> &str {
        match self {
            SpaceListEntry::Ready(record) => &record.id,
            SpaceListEntry::Divergent { id, .. } => id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SpaceRosterSnapshot {
    Reachable { session_refs: Vec<String> },
    Unreachable { reason: String },
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct SpaceLeafReconciliation {
    pub leaf_id: String,
    pub session_ref: String,
    #[serde(flatten)]
    pub availability: SpaceLeafAvailability,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SpaceLeafAvailability {
    Live,
    Tombstone,
    Unknown { reason: String },
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum SpaceSplitWireWeight {
    Integer(u64),
    Float(f64),
}

fn spaces_deserialize_split_sizes<'de, D>(deserializer: D) -> Result<Vec<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let weights = <Vec<SpaceSplitWireWeight> as serde::Deserialize>::deserialize(deserializer)?;
    weights
        .into_iter()
        .map(|weight| match weight {
            SpaceSplitWireWeight::Integer(value) => Ok(value),
            SpaceSplitWireWeight::Float(value)
                if value.is_finite()
                    && value >= 0.0
                    && value.fract() == 0.0
                    && value <= u64::MAX as f64 =>
            {
                Ok(value as u64)
            }
            SpaceSplitWireWeight::Float(_) => Err(serde::de::Error::custom(
                "split sizes must use non-negative integer values",
            )),
        })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
enum SpaceLayoutDeserializationError {
    Invalid(String),
    CanonicalByteDivergence,
}

impl std::fmt::Display for SpaceLayoutDeserializationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::CanonicalByteDivergence => formatter.write_str(
                "Space layout canonical-byte divergence: input bytes differ from canonical serialization.",
            ),
        }
    }
}

impl std::error::Error for SpaceLayoutDeserializationError {}

impl From<SpaceLayoutDeserializationError> for String {
    fn from(error: SpaceLayoutDeserializationError) -> Self {
        error.to_string()
    }
}

#[derive(Default)]
struct SpaceLayoutValidation {
    node_ids: std::collections::HashSet<String>,
    leaf_ids: std::collections::HashSet<String>,
    leaf_session_refs: Vec<String>,
}

fn spaces_nonempty_trimmed(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.trim() != value {
        return Err(format!("{label} must be non-empty and already trimmed."));
    }
    Ok(())
}

fn spaces_validate_node(
    node: &SpaceLayoutNode,
    validation: &mut SpaceLayoutValidation,
    leaf_allowed: bool,
) -> Result<(), String> {
    if validation.node_ids.len() >= SPACE_MAX_NODES {
        return Err(format!(
            "A space layout may contain at most {SPACE_MAX_NODES} nodes."
        ));
    }
    let id = match node {
        SpaceLayoutNode::Stack { id, .. }
        | SpaceLayoutNode::Split { id, .. }
        | SpaceLayoutNode::Leaf { id, .. } => id,
    };
    spaces_nonempty_trimmed(id, "Layout node id")?;
    if !validation.node_ids.insert(id.clone()) {
        return Err(format!("Layout node id '{id}' is duplicated."));
    }

    match node {
        SpaceLayoutNode::Stack { tabs, active, .. } => {
            if leaf_allowed {
                return Err("A stack cannot be nested inside another stack.".to_string());
            }
            if tabs.is_empty() {
                return Err("A saved stack must contain at least one leaf.".to_string());
            }
            let mut stack_session_refs = std::collections::HashSet::new();
            let mut active_exists = false;
            for tab in tabs {
                let SpaceLayoutNode::Leaf {
                    id: leaf_id,
                    session_ref,
                    ..
                } = tab
                else {
                    return Err("Stack tabs must be leaf nodes.".to_string());
                };
                spaces_validate_node(tab, validation, true)?;
                if !stack_session_refs.insert(session_ref.as_str()) {
                    return Err(format!(
                        "Session reference '{session_ref}' is duplicated within one stack."
                    ));
                }
                active_exists |= leaf_id == active;
            }
            if !active_exists {
                return Err(format!("Stack '{id}' has no active leaf named '{active}'."));
            }
        }
        SpaceLayoutNode::Split {
            children, sizes, ..
        } => {
            if leaf_allowed {
                return Err("A split cannot be nested inside a stack.".to_string());
            }
            if children.len() < 2 {
                return Err("A saved split must contain at least two children.".to_string());
            }
            if sizes.len() != children.len() {
                return Err("Split sizes must have one value per child.".to_string());
            }
            if sizes.contains(&0) {
                return Err("Split sizes must be positive integer weights.".to_string());
            }
            for child in children {
                if matches!(child, SpaceLayoutNode::Leaf { .. }) {
                    return Err("Split children must be stacks or splits.".to_string());
                }
                spaces_validate_node(child, validation, false)?;
            }
        }
        SpaceLayoutNode::Leaf {
            id,
            session_ref,
            view_state,
            ..
        } => {
            if !leaf_allowed {
                return Err("A leaf must belong to a stack.".to_string());
            }
            spaces_nonempty_trimmed(session_ref, "Leaf session reference")?;
            if let Some(active_sub_tab) = view_state.active_sub_tab.as_deref() {
                spaces_nonempty_trimmed(active_sub_tab, "Active sub-tab")?;
            }
            validation.leaf_ids.insert(id.clone());
            validation.leaf_session_refs.push(session_ref.clone());
        }
    }
    Ok(())
}

fn spaces_validate_layout(layout: &SpaceLayout, focused_leaf: Option<&str>) -> Result<(), String> {
    let mut members = std::collections::HashSet::new();
    for member in &layout.members {
        spaces_nonempty_trimmed(member, "Space member session reference")?;
        if !members.insert(member.as_str()) {
            return Err(format!("Space member '{member}' is duplicated."));
        }
    }

    let mut validation = SpaceLayoutValidation::default();
    if let Some(root) = layout.root.as_ref() {
        if matches!(root, SpaceLayoutNode::Leaf { .. }) {
            return Err("A layout root must be a stack or split.".to_string());
        }
        spaces_validate_node(root, &mut validation, false)?;
    }
    for session_ref in &validation.leaf_session_refs {
        if !members.contains(session_ref.as_str()) {
            return Err(format!(
                "Open session reference '{session_ref}' is not a member of the space."
            ));
        }
    }

    match (layout.root.as_ref(), focused_leaf) {
        (None, None) => Ok(()),
        (None, Some(_)) => Err("An empty space cannot have a focused leaf.".to_string()),
        (Some(_), None) => Err("A non-empty space must have one focused leaf.".to_string()),
        (Some(_), Some(focused)) => {
            spaces_nonempty_trimmed(focused, "Focused leaf")?;
            if validation.leaf_ids.contains(focused) {
                Ok(())
            } else {
                Err(format!(
                    "Focused leaf '{focused}' does not exist in the layout."
                ))
            }
        }
    }
}

fn spaces_parse_canonical_layout(
    layout_json: &str,
    focused_leaf: Option<&str>,
) -> Result<(SpaceLayout, String), SpaceLayoutDeserializationError> {
    if layout_json.len() > SPACE_LAYOUT_MAX_BYTES {
        return Err(SpaceLayoutDeserializationError::Invalid(format!(
            "Space layout exceeds the {SPACE_LAYOUT_MAX_BYTES}-byte limit."
        )));
    }
    let layout = serde_json::from_str::<SpaceLayout>(layout_json)
        .map_err(|error| {
            SpaceLayoutDeserializationError::Invalid(format!(
                "Unable to decode space layout: {error}"
            ))
        })?
        .canonicalized();
    spaces_validate_layout(&layout, focused_leaf)
        .map_err(SpaceLayoutDeserializationError::Invalid)?;
    let canonical = serde_json::to_string(&layout).map_err(|error| {
        SpaceLayoutDeserializationError::Invalid(format!(
            "Unable to encode canonical space layout: {error}"
        ))
    })?;
    if canonical.as_bytes() != layout_json.as_bytes() {
        return Err(SpaceLayoutDeserializationError::CanonicalByteDivergence);
    }
    Ok((layout, canonical))
}

fn spaces_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn spaces_write_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

fn spaces_table_exists(connection: &rusqlite::Connection) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'spaces')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Unable to inspect the spaces SQLite store: {error}"))
}

fn spaces_table_columns(
    connection: &rusqlite::Connection,
) -> Result<std::collections::HashSet<String>, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(spaces)")
        .map_err(|error| format!("Unable to inspect the spaces SQLite schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to query the spaces SQLite schema: {error}"))?
        .collect::<Result<std::collections::HashSet<_>, _>>()
        .map_err(|error| format!("Unable to decode the spaces SQLite schema: {error}"))?;
    Ok(columns)
}

fn spaces_initialize_database(connection: &mut rusqlite::Connection) -> Result<(), String> {
    connection
        .execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|error| format!("Unable to configure the spaces SQLite store: {error}"))?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin spaces SQLite migration: {error}"))?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS spaces_schema (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                version INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Unable to initialize spaces schema metadata: {error}"))?;
    let stored_version = transaction.query_row(
        "SELECT version FROM spaces_schema WHERE singleton = 1",
        [],
        |row| row.get::<_, i64>(0),
    );
    let stored_version = match stored_version {
        Ok(version) => version,
        Err(rusqlite::Error::QueryReturnedNoRows) => 0,
        Err(error) => return Err(format!("Unable to read spaces schema version: {error}")),
    };
    if stored_version > SPACES_SCHEMA_VERSION {
        return Err(format!(
            "Spaces schema version {stored_version} is newer than supported version {SPACES_SCHEMA_VERSION}."
        ));
    }

    if stored_version == 0 {
        if spaces_table_exists(&transaction)? {
            return Err(
                "An unversioned spaces table already exists; refusing a destructive migration."
                    .to_string(),
            );
        }
        transaction
            .execute_batch(
                "CREATE TABLE spaces (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    layout_json TEXT NOT NULL,
                    focused_leaf TEXT,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL,
                    schema_version INTEGER NOT NULL
                 );
                 CREATE INDEX idx_spaces_ordinal ON spaces(ordinal, created_at_ms, id);",
            )
            .map_err(|error| format!("Unable to create spaces SQLite schema: {error}"))?;
        transaction
            .execute(
                "INSERT INTO spaces_schema(singleton, version) VALUES (1, ?1)",
                [SPACES_SCHEMA_VERSION],
            )
            .map_err(|error| format!("Unable to version spaces SQLite schema: {error}"))?;
    }

    let columns = spaces_table_columns(&transaction)?;
    let expected = [
        "id",
        "name",
        "ordinal",
        "layout_json",
        "focused_leaf",
        "created_at_ms",
        "updated_at_ms",
        "schema_version",
    ];
    let missing = expected
        .iter()
        .filter(|column| !columns.contains(**column))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "Spaces schema version {stored_version} is missing columns: {}.",
            missing.join(", ")
        ));
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit spaces SQLite migration: {error}"))?;
    Ok(())
}

fn spaces_open_database() -> Result<rusqlite::Connection, String> {
    let path = sessions_database_path()?;
    let mut connection = rusqlite::Connection::open(&path)
        .map_err(|error| format!("Unable to open spaces SQLite store: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("Unable to configure spaces SQLite timeout: {error}"))?;
    spaces_initialize_database(&mut connection)?;
    Ok(connection)
}

const SPACES_SELECT_COLUMNS: &str =
    "id, name, ordinal, layout_json, focused_leaf, created_at_ms, updated_at_ms, schema_version";

fn spaces_decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SpaceRecord> {
    Ok(SpaceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        ordinal: row.get(2)?,
        layout_json: row.get(3)?,
        focused_leaf: row.get(4)?,
        created_at_ms: row.get(5)?,
        updated_at_ms: row.get(6)?,
        schema_version: row.get(7)?,
    })
}

fn spaces_validate_stored_record(record: SpaceRecord) -> Result<SpaceRecord, String> {
    if record.schema_version != SPACES_SCHEMA_VERSION {
        return Err(format!(
            "Space '{}' uses unsupported layout schema version {}.",
            record.id, record.schema_version
        ));
    }
    spaces_nonempty_trimmed(&record.id, "Space id")?;
    spaces_nonempty_trimmed(&record.name, "Space name")?;
    let (_, canonical) =
        spaces_parse_canonical_layout(&record.layout_json, record.focused_leaf.as_deref())?;
    if record.layout_json != canonical {
        return Err(format!(
            "Space '{}' contains a non-canonical saved layout.",
            record.id
        ));
    }
    Ok(record)
}

fn space_get_from_connection(
    connection: &rusqlite::Connection,
    space_id: &str,
) -> Result<SpaceRecord, String> {
    let query = format!("SELECT {SPACES_SELECT_COLUMNS} FROM spaces WHERE id = ?1");
    let record = match connection.query_row(&query, [space_id], spaces_decode_row) {
        Ok(record) => record,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Err("Space was not found.".to_string()),
        Err(error) => return Err(format!("Unable to read space: {error}")),
    };
    spaces_validate_stored_record(record)
}

fn spaces_list_from_connection(
    connection: &rusqlite::Connection,
) -> Result<Vec<SpaceListEntry>, String> {
    let query = format!(
        "SELECT {SPACES_SELECT_COLUMNS} FROM spaces ORDER BY ordinal ASC, created_at_ms ASC, id ASC"
    );
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("Unable to prepare spaces list: {error}"))?;
    let records = statement
        .query_map([], spaces_decode_row)
        .map_err(|error| format!("Unable to list spaces: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode space row: {error}"))?;
    // Per-row typing: a row that fails validation (non-canonical bytes, bad schema
    // version) is surfaced as Divergent, never dropped and never allowed to fail the
    // whole listing. Its identity is preserved so the rail can list it and entering
    // it reaches the typed error card via space_get's strict validation.
    Ok(records
        .into_iter()
        .map(|record| {
            let id = record.id.clone();
            let name = record.name.clone();
            let ordinal = record.ordinal;
            match spaces_validate_stored_record(record) {
                Ok(valid) => SpaceListEntry::Ready(valid),
                Err(reason) => SpaceListEntry::Divergent {
                    id,
                    name,
                    ordinal,
                    reason,
                },
            }
        })
        .collect())
}

fn space_create_in_connection(
    connection: &mut rusqlite::Connection,
    name: String,
    ordinal: Option<i64>,
    now_ms: i64,
    id: String,
) -> Result<SpaceRecord, String> {
    let name = name.trim().to_string();
    spaces_nonempty_trimmed(&name, "Space name")?;
    if name.chars().count() > 128 {
        return Err("Space name may contain at most 128 characters.".to_string());
    }
    spaces_nonempty_trimmed(&id, "Space id")?;
    let layout_json = serde_json::to_string(&SpaceLayout::empty())
        .map_err(|error| format!("Unable to encode empty space layout: {error}"))?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin space creation: {error}"))?;
    let ordinal = match ordinal {
        Some(ordinal) => ordinal,
        None => transaction
            .query_row(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM spaces",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Unable to choose space ordinal: {error}"))?,
    };
    transaction
        .execute(
            "INSERT INTO spaces (
                id, name, ordinal, layout_json, focused_leaf,
                created_at_ms, updated_at_ms, schema_version
             ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5, ?6)",
            rusqlite::params![
                id,
                name,
                ordinal,
                layout_json,
                now_ms,
                SPACES_SCHEMA_VERSION,
            ],
        )
        .map_err(|error| format!("Unable to create space: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit space creation: {error}"))?;
    space_get_from_connection(connection, &id)
}

fn space_rename_in_connection(
    connection: &mut rusqlite::Connection,
    space_id: &str,
    name: String,
    now_ms: i64,
) -> Result<SpaceRecord, String> {
    let name = name.trim().to_string();
    spaces_nonempty_trimmed(&name, "Space name")?;
    if name.chars().count() > 128 {
        return Err("Space name may contain at most 128 characters.".to_string());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin space rename: {error}"))?;
    let changed = transaction
        .execute(
            "UPDATE spaces SET name = ?2, updated_at_ms = ?3 WHERE id = ?1",
            rusqlite::params![space_id, name, now_ms],
        )
        .map_err(|error| format!("Unable to rename space: {error}"))?;
    if changed == 0 {
        return Err("Space was not found.".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit space rename: {error}"))?;
    space_get_from_connection(connection, space_id)
}

fn space_save_layout_in_connection(
    connection: &mut rusqlite::Connection,
    space_id: &str,
    layout_json: String,
    focused_leaf: Option<String>,
    now_ms: i64,
) -> Result<SpaceRecord, String> {
    let (_, canonical) = spaces_parse_canonical_layout(&layout_json, focused_leaf.as_deref())?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin space layout save: {error}"))?;
    let changed = transaction
        .execute(
            "UPDATE spaces
             SET layout_json = ?2, focused_leaf = ?3,
                 updated_at_ms = ?4, schema_version = ?5
             WHERE id = ?1",
            rusqlite::params![
                space_id,
                canonical,
                focused_leaf,
                now_ms,
                SPACES_SCHEMA_VERSION,
            ],
        )
        .map_err(|error| format!("Unable to save space layout: {error}"))?;
    if changed == 0 {
        return Err("Space was not found.".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit space layout save: {error}"))?;
    space_get_from_connection(connection, space_id)
}

fn space_delete_in_connection(
    connection: &mut rusqlite::Connection,
    space_id: &str,
) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin space deletion: {error}"))?;
    let changed = transaction
        .execute("DELETE FROM spaces WHERE id = ?1", [space_id])
        .map_err(|error| format!("Unable to delete space: {error}"))?;
    if changed == 0 {
        return Err("Space was not found.".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit space deletion: {error}"))
}

fn spaces_list_blocking() -> Result<Vec<SpaceListEntry>, String> {
    let connection = spaces_open_database()?;
    spaces_list_from_connection(&connection)
}

fn space_get_blocking(space_id: String) -> Result<SpaceRecord, String> {
    let connection = spaces_open_database()?;
    space_get_from_connection(&connection, space_id.trim())
}

fn space_create_blocking(name: String, ordinal: Option<i64>) -> Result<SpaceRecord, String> {
    let _guard = spaces_write_lock()
        .lock()
        .map_err(|_| "Spaces write lock is unavailable.".to_string())?;
    let mut connection = spaces_open_database()?;
    let id = format!("space-{}", uuid::Uuid::new_v4().simple());
    space_create_in_connection(&mut connection, name, ordinal, spaces_now_ms(), id)
}

fn space_rename_blocking(space_id: String, name: String) -> Result<SpaceRecord, String> {
    let _guard = spaces_write_lock()
        .lock()
        .map_err(|_| "Spaces write lock is unavailable.".to_string())?;
    let mut connection = spaces_open_database()?;
    space_rename_in_connection(&mut connection, space_id.trim(), name, spaces_now_ms())
}

fn space_save_layout_blocking(
    space_id: String,
    layout_json: String,
    focused_leaf: Option<String>,
) -> Result<SpaceRecord, String> {
    let _guard = spaces_write_lock()
        .lock()
        .map_err(|_| "Spaces write lock is unavailable.".to_string())?;
    let mut connection = spaces_open_database()?;
    space_save_layout_in_connection(
        &mut connection,
        space_id.trim(),
        layout_json,
        focused_leaf,
        spaces_now_ms(),
    )
}

fn space_delete_blocking(space_id: String) -> Result<(), String> {
    let _guard = spaces_write_lock()
        .lock()
        .map_err(|_| "Spaces write lock is unavailable.".to_string())?;
    let mut connection = spaces_open_database()?;
    space_delete_in_connection(&mut connection, space_id.trim())
}

fn spaces_collect_leaves<'a>(node: &'a SpaceLayoutNode, leaves: &mut Vec<(&'a str, &'a str)>) {
    match node {
        SpaceLayoutNode::Stack { tabs, .. } => {
            for tab in tabs {
                spaces_collect_leaves(tab, leaves);
            }
        }
        SpaceLayoutNode::Split { children, .. } => {
            for child in children {
                spaces_collect_leaves(child, leaves);
            }
        }
        SpaceLayoutNode::Leaf {
            id, session_ref, ..
        } => leaves.push((id, session_ref)),
    }
}

// Pure query layer: the caller owns roster authority. Reachable+empty means
// vanished (tombstone); unreachable means unknown and never means empty.
pub fn reconcile_space(
    saved_space: &SpaceRecord,
    live_roster: &SpaceRosterSnapshot,
) -> Result<Vec<SpaceLeafReconciliation>, String> {
    let (layout, canonical) = spaces_parse_canonical_layout(
        &saved_space.layout_json,
        saved_space.focused_leaf.as_deref(),
    )?;
    if canonical != saved_space.layout_json {
        return Err("Saved space layout is not canonical.".to_string());
    }
    let live_refs = match live_roster {
        SpaceRosterSnapshot::Reachable { session_refs } => {
            let mut refs = std::collections::HashSet::new();
            for session_ref in session_refs {
                spaces_nonempty_trimmed(session_ref, "Live roster session reference")?;
                refs.insert(session_ref.as_str());
            }
            Some(refs)
        }
        SpaceRosterSnapshot::Unreachable { reason } => {
            spaces_nonempty_trimmed(reason, "Unreachable roster reason")?;
            None
        }
    };
    let mut leaves = Vec::new();
    if let Some(root) = layout.root.as_ref() {
        spaces_collect_leaves(root, &mut leaves);
    }
    Ok(leaves
        .into_iter()
        .map(|(leaf_id, session_ref)| {
            let availability = match (&live_refs, live_roster) {
                (Some(refs), _) if refs.contains(session_ref) => SpaceLeafAvailability::Live,
                (Some(_), _) => SpaceLeafAvailability::Tombstone,
                (None, SpaceRosterSnapshot::Unreachable { reason }) => {
                    SpaceLeafAvailability::Unknown {
                        reason: reason.clone(),
                    }
                }
                (None, SpaceRosterSnapshot::Reachable { .. }) => unreachable!(),
            };
            SpaceLeafReconciliation {
                leaf_id: leaf_id.to_string(),
                session_ref: session_ref.to_string(),
                availability,
            }
        })
        .collect())
}

#[tauri::command]
async fn spaces_list() -> Result<Vec<SpaceListEntry>, String> {
    tauri::async_runtime::spawn_blocking(spaces_list_blocking)
        .await
        .map_err(|error| format!("Spaces list worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn space_create(name: String, ordinal: Option<i64>) -> Result<SpaceRecord, String> {
    tauri::async_runtime::spawn_blocking(move || space_create_blocking(name, ordinal))
        .await
        .map_err(|error| format!("Space create worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn space_rename(space_id: String, name: String) -> Result<SpaceRecord, String> {
    tauri::async_runtime::spawn_blocking(move || space_rename_blocking(space_id, name))
        .await
        .map_err(|error| format!("Space rename worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn space_delete(space_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || space_delete_blocking(space_id))
        .await
        .map_err(|error| format!("Space delete worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn space_save_layout(
    space_id: String,
    layout_json: String,
    focused_leaf: Option<String>,
) -> Result<SpaceRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        space_save_layout_blocking(space_id, layout_json, focused_leaf)
    })
    .await
    .map_err(|error| format!("Space layout save worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn space_get(space_id: String) -> Result<SpaceRecord, String> {
    tauri::async_runtime::spawn_blocking(move || space_get_blocking(space_id))
        .await
        .map_err(|error| format!("Space get worker failed: {error}"))?
}
