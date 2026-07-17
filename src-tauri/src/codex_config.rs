use std::fmt::Write as _;

const PROJECT_HEADER_MARKER: &str = "__diffforge_project_header_marker";

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct CodexProjectPath {
    pub(crate) identity: String,
    pub(crate) path: String,
    windows: bool,
}

impl CodexProjectPath {
    pub(crate) fn parse(path: &str) -> Option<Self> {
        if path.trim().is_empty() {
            return None;
        }

        let windows = codex_path_looks_windows(path);
        let path = if windows {
            normalize_windows_codex_path(path)
        } else {
            normalize_non_windows_codex_path(path)
        };
        if path.is_empty() {
            return None;
        }
        let identity = if windows {
            path.to_lowercase()
        } else {
            path.clone()
        };

        Some(Self {
            identity,
            path,
            windows,
        })
    }

    pub(crate) fn table_header(&self) -> String {
        let key = if self.windows
            && !self.path.contains('\'')
            && !self.path.chars().any(char::is_control)
        {
            format!("'{}'", self.path)
        } else {
            toml_basic_string(&self.path)
        };
        format!("[projects.{key}]")
    }
}

pub(crate) fn codex_project_path_from_header(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') || trimmed.starts_with("[[") {
        return None;
    }

    let document = format!("{trimmed}\n{PROJECT_HEADER_MARKER} = true\n");
    let parsed = toml::from_str::<toml::Value>(&document).ok()?;
    let projects = parsed.get("projects")?.as_table()?;
    let mut project_paths = projects.iter().filter_map(|(path, value)| {
        value
            .as_table()
            .and_then(|table| table.get(PROJECT_HEADER_MARKER))
            .and_then(toml::Value::as_bool)
            .filter(|marker| *marker)
            .map(|_| path.clone())
    });
    let project_path = project_paths.next()?;
    project_paths.next().is_none().then_some(project_path)
}

fn codex_path_looks_windows(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.contains('\\')
        || path.starts_with("//")
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
}

fn normalize_windows_codex_path(path: &str) -> String {
    let mut path = path.replace('/', "\\");
    if path
        .get(..r"\\?\UNC\".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
    {
        path = format!(r"\\{}", &path[r"\\?\UNC\".len()..]);
    } else if path.starts_with(r"\\?\") {
        path = path[r"\\?\".len()..].to_string();
    }

    let is_unc = path.starts_with(r"\\");
    let mut path = if is_unc {
        let components = path
            .trim_start_matches('\\')
            .split('\\')
            .filter(|component| !component.is_empty())
            .collect::<Vec<_>>();
        format!(r"\\{}", components.join(r"\"))
    } else {
        path.split('\\')
            .filter(|component| !component.is_empty())
            .collect::<Vec<_>>()
            .join(r"\")
    };

    if path.as_bytes().get(1) == Some(&b':') {
        path.replace_range(..1, &path[..1].to_ascii_uppercase());
    }

    let without_trailing = path.trim_end_matches('\\').to_string();
    let drive_root = without_trailing.len() == 2
        && without_trailing.as_bytes()[0].is_ascii_alphabetic()
        && without_trailing.as_bytes()[1] == b':';
    let unc_root = without_trailing
        .strip_prefix(r"\\")
        .is_some_and(|rest| rest.split('\\').filter(|part| !part.is_empty()).count() == 2);
    if drive_root || unc_root {
        format!(r"{without_trailing}\")
    } else {
        without_trailing
    }
}

fn normalize_non_windows_codex_path(path: &str) -> String {
    if path == "/" {
        return path.to_string();
    }
    path.trim_end_matches('/').to_string()
}

fn toml_basic_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for ch in value.chars() {
        match ch {
            '\u{0008}' => escaped.push_str(r"\b"),
            '\t' => escaped.push_str(r"\t"),
            '\n' => escaped.push_str(r"\n"),
            '\u{000C}' => escaped.push_str(r"\f"),
            '\r' => escaped.push_str(r"\r"),
            '"' => escaped.push_str(r#"\""#),
            '\\' => escaped.push_str(r"\\"),
            ch if ch.is_control() => {
                let value = ch as u32;
                if value <= u16::MAX as u32 {
                    let _ = write!(escaped, r"\u{value:04X}");
                } else {
                    let _ = write!(escaped, r"\U{value:08X}");
                }
            }
            ch => escaped.push(ch),
        }
    }
    escaped.push('"');
    escaped
}
