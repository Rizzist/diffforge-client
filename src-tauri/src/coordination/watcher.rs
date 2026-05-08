use serde_json::json;

use super::kernel::{api_ok, CoordinationKernel};

pub fn scan_known_violations(kernel: &CoordinationKernel) -> Result<serde_json::Value, String> {
    Ok(api_ok(json!({
        "watcher": "stub",
        "message": "Patch and merge gates are authoritative. notify-based live watching can be enabled in a later pass without weakening submit_patch validation.",
        "repo_path": kernel.paths.repo_path.display().to_string()
    })))
}
