use std::path::{Component, Path};

const WRITE_LIKE_MODES: &[&str] = &[
    "write",
    "exclusive",
    "contract",
    "db_plan",
    "db_migration",
    "db_destructive",
    "db_exclusive",
    "migration_proposal",
    "migration_exclusive",
    "sandbox_write",
    "data_backfill",
    "security_policy",
    "destructive",
    "prod_write",
];

const KNOWN_LEASE_MODES: &[&str] = &[
    "read",
    "write",
    "exclusive",
    "contract",
    "db_read",
    "db_plan",
    "db_migration",
    "db_destructive",
    "db_exclusive",
    "migration_proposal",
    "migration_exclusive",
    "sandbox_write",
    "data_backfill",
    "security_policy",
    "destructive",
    "prod_write",
];

const KNOWN_RESOURCE_PREFIXES: &[&str] = &[
    "file", "glob", "symbol", "route", "package", "env", "port", "contract", "db",
];

pub fn normalize_resource_key(value: &str) -> String {
    let trimmed = value.trim();
    let Some((prefix, rest)) = trimmed.split_once(':') else {
        return trimmed.to_ascii_lowercase();
    };
    let prefix = prefix.trim().to_ascii_lowercase();
    let rest = rest.trim();

    match prefix.as_str() {
        "file" | "glob" => format!("{prefix}:{}", normalize_resource_path(rest)),
        "route" => format!("route:{}", normalize_route_resource(rest)),
        "env" => format!("env:{}", rest.to_ascii_uppercase()),
        "package" | "contract" => format!("{prefix}:{}", rest.to_ascii_lowercase()),
        "port" => format!("port:{}", rest.trim()),
        "symbol" => format!("symbol:{}", rest.trim()),
        "db" => format!("db:{}", normalize_db_resource_tail(rest)),
        _ => format!("{prefix}:{rest}"),
    }
}

pub fn normalize_resource_key_checked(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Resource key is required.".to_string());
    }

    let Some((prefix, rest)) = trimmed.split_once(':') else {
        return Err("Resource key must include a known prefix like file:, glob:, route:, package:, contract:, env:, port:, or db:.".to_string());
    };
    let prefix = prefix.trim().to_ascii_lowercase();
    let rest = rest.trim();
    if rest.is_empty() {
        return Err("Resource key value is required.".to_string());
    }
    if !KNOWN_RESOURCE_PREFIXES.contains(&prefix.as_str()) {
        return Err(format!("Unknown resource key prefix: {prefix}"));
    }
    if matches!(prefix.as_str(), "file" | "glob") {
        reject_path_escape(rest)?;
    }
    if prefix == "port" {
        let port = rest
            .parse::<u16>()
            .map_err(|_| "Port resource must be a number from 1 to 65535.".to_string())?;
        if port == 0 {
            return Err("Port resource must be a number from 1 to 65535.".to_string());
        }
    }
    if prefix == "route" {
        validate_route_resource(rest)?;
    }
    if prefix == "db" {
        validate_db_resource_tail(rest)?;
    }
    if contains_secret_like_resource_value(rest) {
        return Err(
            "Resource key must not contain credentials, tokens, or connection strings.".to_string(),
        );
    }

    Ok(normalize_resource_key(trimmed))
}

pub fn validate_lease_mode(value: &str) -> Result<String, String> {
    let mode = value.trim().to_ascii_lowercase();
    if KNOWN_LEASE_MODES.contains(&mode.as_str()) {
        return Ok(mode);
    }
    Err(format!("Unknown lease mode: {value}"))
}

pub fn resource_type(resource_key: &str) -> String {
    resource_key
        .split_once(':')
        .map(|(prefix, _)| prefix.to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn resource_risk_level(resource_key: &str, mode: &str) -> i64 {
    let mode = mode.trim().to_ascii_lowercase();
    let resource_key = normalize_resource_key(resource_key);
    if matches!(
        mode.as_str(),
        "db_destructive" | "db_exclusive" | "destructive" | "prod_write" | "security_policy"
    ) || is_broad_db_resource(&resource_key)
    {
        return 5;
    }
    if resource_key.starts_with("env:")
        || resource_key.starts_with("db:prod_data:")
        || resource_key.starts_with("db:policy:")
    {
        return 5;
    }
    if resource_key.starts_with("db:")
        || matches!(mode.as_str(), "migration_proposal" | "migration_exclusive")
    {
        return 4;
    }
    1
}

pub fn is_write_like(mode: &str) -> bool {
    let mode = mode.trim().to_ascii_lowercase();
    WRITE_LIKE_MODES.contains(&mode.as_str())
}

pub fn lease_modes_conflict(existing: &str, requested: &str) -> bool {
    lease_mode_conflict_reason(existing, requested).is_some()
}

pub fn lease_mode_conflict_reason(existing: &str, requested: &str) -> Option<String> {
    let existing = existing.trim().to_ascii_lowercase();
    let requested = requested.trim().to_ascii_lowercase();

    if existing == "read" && requested == "read" {
        return None;
    }

    if existing == "exclusive" || requested == "exclusive" {
        return Some("exclusive_conflicts_with_all".to_string());
    }

    if is_db_mode(&existing) || is_db_mode(&requested) {
        return db_modes_conflict_reason(&existing, &requested);
    }

    if existing == "read" || requested == "read" {
        return None;
    }

    if existing == "destructive"
        || requested == "destructive"
        || existing == "prod_write"
        || requested == "prod_write"
    {
        return Some("destructive_or_prod_write_conflict".to_string());
    }

    if is_write_like(&existing) && is_write_like(&requested) {
        return Some("write_like_modes_conflict".to_string());
    }

    None
}

pub fn resources_conflict(a: &str, b: &str) -> bool {
    resource_conflict_reason(a, b).is_some()
}

pub fn resource_conflict_reason(a: &str, b: &str) -> Option<String> {
    let a = normalize_resource_key(a);
    let b = normalize_resource_key(b);

    if a == b {
        return Some("exact_resource_match".to_string());
    }

    if let (Some(a_path), Some(b_path)) = (a.strip_prefix("file:"), b.strip_prefix("glob:")) {
        return glob_covers_path(b_path, a_path).then(|| "glob_covers_file".to_string());
    }
    if let (Some(a_path), Some(b_path)) = (a.strip_prefix("glob:"), b.strip_prefix("file:")) {
        return glob_covers_path(a_path, b_path).then(|| "glob_covers_file".to_string());
    }
    if let (Some(a_glob), Some(b_glob)) = (a.strip_prefix("glob:"), b.strip_prefix("glob:")) {
        return globs_overlap(a_glob, b_glob).then(|| "glob_overlap".to_string());
    }
    if a.starts_with("db:") && b.starts_with("db:") {
        return db_resources_conflict_reason(&a, &b);
    }
    if let (Some(a_route), Some(b_route)) = (a.strip_prefix("route:"), b.strip_prefix("route:")) {
        return route_resources_conflict(a_route, b_route).then(|| "route_overlap".to_string());
    }

    None
}

pub fn resource_covers(lease_key: &str, changed_key: &str) -> bool {
    let lease_key = normalize_resource_key(lease_key);
    let changed_key = normalize_resource_key(changed_key);

    if lease_key == changed_key {
        return true;
    }

    if let (Some(glob), Some(path)) = (
        lease_key.strip_prefix("glob:"),
        changed_key.strip_prefix("file:"),
    ) {
        return glob_covers_path(glob, path);
    }

    db_resources_conflict(&lease_key, &changed_key)
}

pub fn path_to_file_resource(path: &str) -> String {
    format!("file:{}", normalize_resource_path(path))
}

pub fn normalize_resource_path(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

pub fn reject_path_escape(path: &str) -> Result<(), String> {
    let candidate = Path::new(path);

    if candidate.is_absolute() {
        return Err("Changed path is absolute and cannot be accepted.".to_string());
    }

    for component in candidate.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err("Changed path escapes the worktree root.".to_string());
        }
    }

    Ok(())
}

fn glob_covers_path(glob: &str, path: &str) -> bool {
    let glob = normalize_resource_path(glob);
    let path = normalize_resource_path(path);

    if let Some(prefix) = glob.strip_suffix("/**") {
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    if let Some(prefix) = glob.strip_suffix("/*") {
        if !path.starts_with(&format!("{prefix}/")) {
            return false;
        }
        return !path[prefix.len() + 1..].contains('/');
    }

    glob == path
}

fn normalize_route_resource(value: &str) -> String {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    let (method, path) = if parts.len() >= 2 && looks_like_http_method(parts[0]) {
        (Some(parts[0].to_ascii_uppercase()), parts[1])
    } else {
        (None, value.trim())
    };
    let mut path = path.replace('\\', "/");
    while path.contains("//") {
        path = path.replace("//", "/");
    }
    if !path.starts_with('/') {
        path.insert(0, '/');
    }
    if path.len() > 1 {
        path = path.trim_end_matches('/').to_string();
    }
    match method {
        Some(method) => format!("{method} {path}"),
        None => path,
    }
}

fn validate_route_resource(value: &str) -> Result<(), String> {
    let normalized = normalize_route_resource(value);
    let path = normalized
        .split_whitespace()
        .last()
        .unwrap_or(normalized.as_str());
    if !path.starts_with('/') {
        return Err("Route resource must include an absolute route path.".to_string());
    }
    if path.contains("..") {
        return Err("Route resource cannot contain '..'.".to_string());
    }
    Ok(())
}

fn route_resources_conflict(a: &str, b: &str) -> bool {
    let a = parse_route_resource(a);
    let b = parse_route_resource(b);
    a.path == b.path && (a.method.is_none() || b.method.is_none() || a.method == b.method)
}

struct ParsedRoute {
    method: Option<String>,
    path: String,
}

fn parse_route_resource(value: &str) -> ParsedRoute {
    let normalized = normalize_route_resource(value);
    let parts = normalized.split_whitespace().collect::<Vec<_>>();
    if parts.len() == 2 && looks_like_http_method(parts[0]) {
        return ParsedRoute {
            method: Some(parts[0].to_string()),
            path: parts[1].to_string(),
        };
    }
    ParsedRoute {
        method: None,
        path: normalized,
    }
}

fn looks_like_http_method(value: &str) -> bool {
    matches!(
        value.to_ascii_uppercase().as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
    )
}

fn globs_overlap(a: &str, b: &str) -> bool {
    let a_prefix = a
        .strip_suffix("/**")
        .or_else(|| a.strip_suffix("/*"))
        .unwrap_or(a);
    let b_prefix = b
        .strip_suffix("/**")
        .or_else(|| b.strip_suffix("/*"))
        .unwrap_or(b);
    let a_prefix = normalize_resource_path(a_prefix);
    let b_prefix = normalize_resource_path(b_prefix);

    a_prefix == b_prefix
        || a_prefix.starts_with(&format!("{b_prefix}/"))
        || b_prefix.starts_with(&format!("{a_prefix}/"))
}

fn db_resources_conflict(a: &str, b: &str) -> bool {
    db_resources_conflict_reason(a, b).is_some()
}

fn db_resources_conflict_reason(a: &str, b: &str) -> Option<String> {
    if a == b {
        return Some("exact_db_resource_match".to_string());
    }

    if a.starts_with("db:migration_stream:") || b.starts_with("db:migration_stream:") {
        return Some("db_migration_stream_serializes_migrations".to_string());
    }

    if a.starts_with("db:database:") || b.starts_with("db:database:") {
        return Some("db_database_resource_is_broad".to_string());
    }

    if a.starts_with("db:schema:") || b.starts_with("db:schema:") {
        return Some("db_schema_resource_is_broad".to_string());
    }

    if is_broad_db_resource(a) || is_broad_db_resource(b) {
        return Some("db_high_risk_broad_resource".to_string());
    }

    let Some(a_table) = db_table_name(a) else {
        return (a.starts_with("db:policy:") && b.starts_with("db:policy:"))
            .then(|| "db_policy_resource_overlap".to_string());
    };
    let Some(b_table) = db_table_name(b) else {
        return (b.starts_with("db:policy:") && a.starts_with("db:policy:"))
            .then(|| "db_policy_resource_overlap".to_string());
    };

    (a_table == b_table).then(|| "db_same_table_family".to_string())
}

fn is_db_mode(mode: &str) -> bool {
    mode.starts_with("db_")
        || matches!(
            mode,
            "migration_proposal"
                | "migration_exclusive"
                | "data_backfill"
                | "security_policy"
                | "destructive"
                | "prod_write"
        )
}

fn db_modes_conflict_reason(existing: &str, requested: &str) -> Option<String> {
    if existing == "db_destructive"
        || requested == "db_destructive"
        || existing == "destructive"
        || requested == "destructive"
        || existing == "prod_write"
        || requested == "prod_write"
        || existing == "db_exclusive"
        || requested == "db_exclusive"
        || existing == "migration_exclusive"
        || requested == "migration_exclusive"
    {
        return Some("db_destructive_or_exclusive_mode_conflict".to_string());
    }

    if matches!(
        (existing, requested),
        ("db_plan", "db_migration")
            | ("db_migration", "db_plan")
            | ("db_plan", "migration_proposal")
            | ("migration_proposal", "db_plan")
            | ("db_migration", "db_migration")
            | ("db_migration", "migration_proposal")
            | ("migration_proposal", "db_migration")
            | ("migration_proposal", "migration_proposal")
            | ("data_backfill", _)
            | (_, "data_backfill")
            | ("security_policy", _)
            | (_, "security_policy")
    ) {
        return Some("db_write_like_modes_conflict".to_string());
    }

    None
}

fn is_broad_db_resource(value: &str) -> bool {
    matches!(
        value,
        "db:tenant_isolation" | "db:security_policy" | "db:auth" | "db:pii"
    )
}

fn db_table_name(value: &str) -> Option<String> {
    let tail = value.strip_prefix("db:")?;
    if let Some(table) = tail.strip_prefix("table:") {
        return Some(table.to_string());
    }
    if let Some(column) = tail.strip_prefix("column:") {
        return column.split('.').next().map(str::to_string);
    }
    if let Some(index) = tail.strip_prefix("index:") {
        return index.split('.').next().map(str::to_string);
    }
    if let Some(constraint) = tail.strip_prefix("constraint:") {
        return constraint.split('.').next().map(str::to_string);
    }
    if let Some(fk) = tail.strip_prefix("foreign_key:") {
        return fk.split('.').next().map(str::to_string);
    }
    if let Some(backfill) = tail.strip_prefix("backfill:") {
        return backfill.split('.').next().map(str::to_string);
    }
    if let Some(data) = tail.strip_prefix("data:") {
        return data.split('.').next().map(str::to_string);
    }
    None
}

fn normalize_db_resource_tail(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase().replace('\\', "/");
    let parts = normalized
        .split(':')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    parts.join(":")
}

fn validate_db_resource_tail(value: &str) -> Result<(), String> {
    let normalized = normalize_db_resource_tail(value);
    if normalized.contains("://") || normalized.contains('@') {
        return Err("DB resource keys must not contain connection strings.".to_string());
    }
    let Some((kind, rest)) = normalized.split_once(':') else {
        if is_broad_db_resource(&format!("db:{normalized}")) {
            return Ok(());
        }
        return Err("DB resource key must include a supported DB resource kind.".to_string());
    };
    let supported = matches!(
        kind,
        "database"
            | "schema"
            | "table"
            | "column"
            | "index"
            | "constraint"
            | "enum"
            | "view"
            | "function"
            | "data"
            | "migration_stream"
            | "foreign_key"
            | "backfill"
            | "policy"
            | "prod_data"
    );
    if !supported {
        return Err(format!("Unsupported DB resource kind: {kind}"));
    }
    if rest.trim().is_empty() {
        return Err("DB resource key value is required.".to_string());
    }
    Ok(())
}

fn contains_secret_like_resource_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("://")
        || lower.contains("password=")
        || lower.contains("passwd=")
        || lower.contains("token=")
        || lower.contains("api_key=")
        || lower.contains("secret=")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_glob_conflict_and_coverage() {
        assert!(resources_conflict("file:src/a.js", "glob:src/**"));
        assert!(resource_covers("glob:src/**", "file:src/a.js"));
        assert!(!resource_covers("file:src/a.js", "file:src/b.js"));
    }

    #[test]
    fn db_table_column_conflict() {
        assert!(resources_conflict(
            "db:table:users",
            "db:column:users.email"
        ));
        assert!(resource_covers("db:table:users", "db:column:users.email"));
    }

    #[test]
    fn checked_resource_keys_reject_file_path_escapes() {
        assert!(normalize_resource_key_checked("file:../secret").is_err());
        assert!(normalize_resource_key_checked("glob:src/../../secret/**").is_err());
        assert!(normalize_resource_key_checked("unknown:thing").is_err());
        assert!(normalize_resource_key_checked("src/main.rs").is_err());
        assert!(normalize_resource_key_checked("db:postgres://prod.example/app").is_err());
        assert_eq!(
            normalize_resource_key_checked("file:src\\main.rs").unwrap(),
            "file:src/main.rs"
        );
    }

    #[test]
    fn lease_modes_are_known_and_conflict_by_contract() {
        assert!(validate_lease_mode("made_up_mode").is_err());
        assert!(!lease_modes_conflict("read", "write"));
        assert!(lease_modes_conflict("write", "write"));
        assert!(lease_modes_conflict("contract", "contract"));
        assert!(lease_modes_conflict("db_plan", "db_migration"));
        assert!(lease_modes_conflict("db_destructive", "db_read"));
    }

    #[test]
    fn resource_registry_normalizes_non_file_keys() {
        assert_eq!(
            normalize_resource_key_checked("env:node_env").unwrap(),
            "env:NODE_ENV"
        );
        assert_eq!(
            normalize_resource_key_checked("package:@APP/Auth").unwrap(),
            "package:@app/auth"
        );
        assert_eq!(
            normalize_resource_key_checked("contract:Auth/Login").unwrap(),
            "contract:auth/login"
        );
        assert_eq!(
            normalize_resource_key_checked("route:get //api/users/").unwrap(),
            "route:GET /api/users"
        );
        assert_eq!(
            normalize_resource_key_checked("port:3000").unwrap(),
            "port:3000"
        );
        assert!(normalize_resource_key_checked("port:0").is_err());
    }

    #[test]
    fn route_resources_overlap_by_path_and_method() {
        assert!(resources_conflict(
            "route:/api/users",
            "route:GET /api/users"
        ));
        assert!(resources_conflict(
            "route:GET /api/users",
            "route:get //api/users/"
        ));
        assert!(!resources_conflict(
            "route:POST /api/users",
            "route:GET /api/users"
        ));
    }

    #[test]
    fn db_coordination_resources_overlap_broadly_where_expected() {
        assert!(resources_conflict(
            "db:migration_stream:main",
            "db:table:users"
        ));
        assert!(resources_conflict("db:table:users", "db:data:users"));
        assert!(resources_conflict(
            "db:tenant_isolation",
            "db:column:users.account_id"
        ));
        assert!(resources_conflict(
            "db:schema:public",
            "db:view:active_users"
        ));
    }
}
