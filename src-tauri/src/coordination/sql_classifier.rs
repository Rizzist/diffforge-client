use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SqlClassification {
    pub classification: String,
    pub risk_level: i64,
    pub blocked_by_default: bool,
    pub required_mode: String,
    pub required_approval_kind: Option<String>,
    pub destructive: bool,
    pub statement_count: usize,
}

pub fn classify_sql(sql: &str) -> SqlClassification {
    let stripped = strip_comments(sql);
    let statements = split_statements(&stripped);
    let mut best = SqlClassification {
        classification: "unknown".to_string(),
        risk_level: 0,
        blocked_by_default: true,
        required_mode: "blocked".to_string(),
        required_approval_kind: None,
        destructive: false,
        statement_count: statements.len().max(1),
    };

    for statement in statements {
        let current = classify_statement(&statement);
        if current.risk_level >= best.risk_level {
            best = current;
        }
    }

    best.statement_count = split_statements(&stripped).len().max(1);
    best
}

fn classify_statement(statement: &str) -> SqlClassification {
    let normalized = statement
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    let first = tokens.first().copied().unwrap_or("");
    let second = tokens.get(1).copied().unwrap_or("");
    let third = tokens.get(2).copied().unwrap_or("");
    let destructive_delete = first == "DELETE" && !tokens.iter().any(|token| *token == "WHERE");
    let destructive_update = first == "UPDATE" && !tokens.iter().any(|token| *token == "WHERE");
    let alter_drop = first == "ALTER" && tokens.iter().any(|token| *token == "DROP");
    let security = matches!(first, "GRANT" | "REVOKE")
        || (first == "CREATE" && matches!(second, "ROLE" | "POLICY"))
        || (first == "ALTER" && matches!(second, "ROLE" | "POLICY"))
        || (first == "DROP" && matches!(second, "POLICY"));

    let (classification, risk_level, required_mode, approval, destructive) = if first == "SELECT" {
        ("readonly_data", 2, "schema_readonly", None, false)
    } else if first == "WITH" {
        if normalized.contains(" INSERT ")
            || normalized.contains(" UPDATE ")
            || normalized.contains(" DELETE ")
            || normalized.contains(" MERGE ")
        {
            ("unknown", 5, "blocked", None, true)
        } else {
            ("readonly_data", 2, "schema_readonly", None, false)
        }
    } else if matches!(first, "SHOW" | "PRAGMA" | "DESCRIBE" | "DESC") {
        ("readonly_metadata", 1, "schema_readonly", None, false)
    } else if first == "EXPLAIN" {
        ("explain", 2, "schema_readonly", None, false)
    } else if first == "INSERT" {
        ("dml_insert", 3, "sandbox_readwrite", None, false)
    } else if first == "UPDATE" {
        (
            "dml_update",
            if destructive_update { 5 } else { 3 },
            "sandbox_readwrite",
            destructive_update.then_some("destructive_sql"),
            destructive_update,
        )
    } else if first == "DELETE" {
        (
            "dml_delete",
            if destructive_delete { 5 } else { 3 },
            "sandbox_readwrite",
            destructive_delete.then_some("destructive_sql"),
            destructive_delete,
        )
    } else if first == "CREATE" {
        if security {
            (
                "security_grant_revoke",
                5,
                "prod_human_gate",
                Some("security_policy_change"),
                true,
            )
        } else {
            ("ddl_create", 4, "migration_proposal", None, false)
        }
    } else if first == "ALTER" {
        if security {
            (
                "security_grant_revoke",
                5,
                "prod_human_gate",
                Some("security_policy_change"),
                true,
            )
        } else {
            (
                "ddl_alter",
                if alter_drop { 5 } else { 4 },
                "migration_proposal",
                alter_drop.then_some("destructive_sql"),
                alter_drop,
            )
        }
    } else if first == "DROP" {
        let approval = if second == "POLICY" {
            "security_policy_change"
        } else {
            "destructive_sql"
        };
        ("ddl_drop", 5, "prod_human_gate", Some(approval), true)
    } else if first == "TRUNCATE" {
        (
            "ddl_truncate",
            5,
            "prod_human_gate",
            Some("destructive_sql"),
            true,
        )
    } else if security {
        (
            "security_grant_revoke",
            5,
            "prod_human_gate",
            Some("security_policy_change"),
            true,
        )
    } else if matches!(first, "BEGIN" | "COMMIT" | "ROLLBACK" | "SAVEPOINT") {
        ("transaction_control", 3, "sandbox_readwrite", None, false)
    } else if matches!(first, "VACUUM" | "ANALYZE" | "REINDEX") {
        ("maintenance", 4, "migration_proposal", None, false)
    } else if first.is_empty() {
        ("unknown", 5, "blocked", None, false)
    } else if first == "CREATE" && third == "POLICY" {
        (
            "security_grant_revoke",
            5,
            "prod_human_gate",
            Some("security_policy_change"),
            true,
        )
    } else {
        ("unknown", 5, "blocked", None, true)
    };

    SqlClassification {
        classification: classification.to_string(),
        risk_level,
        blocked_by_default: risk_level > 1,
        required_mode: required_mode.to_string(),
        required_approval_kind: approval.map(str::to_string),
        destructive,
        statement_count: 1,
    }
}

fn strip_comments(sql: &str) -> String {
    let mut output = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut in_single = false;
    let mut in_double = false;

    while let Some(ch) = chars.next() {
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
                output.push(ch);
            }
            continue;
        }
        if in_block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block_comment = false;
            }
            continue;
        }
        if !in_single && !in_double && ch == '-' && chars.peek() == Some(&'-') {
            chars.next();
            in_line_comment = true;
            continue;
        }
        if !in_single && !in_double && ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            in_block_comment = true;
            continue;
        }
        if !in_double && ch == '\'' {
            in_single = !in_single;
        } else if !in_single && ch == '"' {
            in_double = !in_double;
        }
        output.push(ch);
    }

    output
}

fn split_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;

    for ch in sql.chars() {
        if !in_double && ch == '\'' {
            in_single = !in_single;
        } else if !in_single && ch == '"' {
            in_double = !in_double;
        }

        if ch == ';' && !in_single && !in_double {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                statements.push(trimmed.to_string());
            }
            current.clear();
        } else {
            current.push(ch);
        }
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }

    statements
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_common_sql() {
        assert_eq!(
            classify_sql("select * from users").classification,
            "readonly_data"
        );
        assert_eq!(
            classify_sql("insert into users(id) values (1)").classification,
            "dml_insert"
        );
        assert_eq!(
            classify_sql("update users set name='a' where id=1").classification,
            "dml_update"
        );
        assert_eq!(
            classify_sql("delete from users where id=1").classification,
            "dml_delete"
        );
        assert_eq!(
            classify_sql("create table x(id int)").classification,
            "ddl_create"
        );
        assert_eq!(
            classify_sql("alter table x add column y int").classification,
            "ddl_alter"
        );
        assert_eq!(classify_sql("drop table x").classification, "ddl_drop");
        assert_eq!(
            classify_sql("truncate table x").classification,
            "ddl_truncate"
        );
        assert_eq!(
            classify_sql("grant select on users to app").classification,
            "security_grant_revoke"
        );
    }

    #[test]
    fn destructive_delete_is_high_risk() {
        let result = classify_sql("DELETE FROM users");
        assert_eq!(result.risk_level, 5);
        assert!(result.destructive);
    }
}
