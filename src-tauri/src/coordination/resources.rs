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

pub fn normalize_resource_key(value: &str) -> String {
    let trimmed = value.trim();
    let Some((prefix, rest)) = trimmed.split_once(':') else {
        return trimmed.to_ascii_lowercase();
    };
    let prefix = prefix.trim().to_ascii_lowercase();
    let rest = rest.trim();

    match prefix.as_str() {
        "file" | "glob" => format!("{prefix}:{}", normalize_resource_path(rest)),
        "route" => format!(
            "route:{}",
            rest.split_whitespace().collect::<Vec<_>>().join(" ")
        ),
        "symbol" | "package" | "env" | "port" => format!("{prefix}:{rest}"),
        "db" => format!("db:{}", rest.to_ascii_lowercase().replace('\\', "/")),
        _ => format!("{prefix}:{rest}"),
    }
}

pub fn normalize_resource_key_checked(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Resource key is required.".to_string());
    }

    let Some((prefix, rest)) = trimmed.split_once(':') else {
        return Ok(normalize_resource_key(trimmed));
    };
    let prefix = prefix.trim().to_ascii_lowercase();
    let rest = rest.trim();
    if rest.is_empty() {
        return Err("Resource key value is required.".to_string());
    }
    if matches!(prefix.as_str(), "file" | "glob") {
        reject_path_escape(rest)?;
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
    if matches!(mode, "destructive" | "prod_write" | "security_policy") {
        return 5;
    }
    if resource_key.starts_with("env:")
        || resource_key.starts_with("db:prod_data:")
        || resource_key.starts_with("db:policy:")
    {
        return 5;
    }
    if resource_key.starts_with("db:")
        || matches!(mode, "migration_proposal" | "migration_exclusive")
    {
        return 4;
    }
    1
}

pub fn is_write_like(mode: &str) -> bool {
    WRITE_LIKE_MODES.contains(&mode)
}

pub fn lease_modes_conflict(existing: &str, requested: &str) -> bool {
    let existing = existing.trim().to_ascii_lowercase();
    let requested = requested.trim().to_ascii_lowercase();

    if existing == "read" && requested == "read" {
        return false;
    }

    if existing == "exclusive" || requested == "exclusive" {
        return true;
    }

    if is_db_mode(&existing) || is_db_mode(&requested) {
        return db_modes_conflict(&existing, &requested);
    }

    if existing == "read" || requested == "read" {
        return false;
    }

    if existing == "destructive"
        || requested == "destructive"
        || existing == "prod_write"
        || requested == "prod_write"
    {
        return true;
    }

    is_write_like(&existing) && is_write_like(&requested)
}

pub fn resources_conflict(a: &str, b: &str) -> bool {
    let a = normalize_resource_key(a);
    let b = normalize_resource_key(b);

    if a == b {
        return true;
    }

    if let (Some(a_path), Some(b_path)) = (a.strip_prefix("file:"), b.strip_prefix("glob:")) {
        return glob_covers_path(b_path, a_path);
    }
    if let (Some(a_path), Some(b_path)) = (a.strip_prefix("glob:"), b.strip_prefix("file:")) {
        return glob_covers_path(a_path, b_path);
    }
    if let (Some(a_glob), Some(b_glob)) = (a.strip_prefix("glob:"), b.strip_prefix("glob:")) {
        return globs_overlap(a_glob, b_glob);
    }
    if a.starts_with("db:") && b.starts_with("db:") {
        return db_resources_conflict(&a, &b);
    }

    false
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
    if a == b {
        return true;
    }

    if a.starts_with("db:migration_stream:") || b.starts_with("db:migration_stream:") {
        return true;
    }

    if a.starts_with("db:database:") || b.starts_with("db:database:") {
        return true;
    }

    if is_broad_db_resource(a) || is_broad_db_resource(b) {
        return true;
    }

    let Some(a_table) = db_table_name(a) else {
        return a.starts_with("db:policy:") && b.starts_with("db:policy:");
    };
    let Some(b_table) = db_table_name(b) else {
        return b.starts_with("db:policy:") && a.starts_with("db:policy:");
    };

    a_table == b_table
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

fn db_modes_conflict(existing: &str, requested: &str) -> bool {
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
        return true;
    }

    matches!(
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
    )
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
}
