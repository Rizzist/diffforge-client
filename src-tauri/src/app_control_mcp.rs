const APP_CONTROL_MCP_UNAVAILABLE: &str =
    "App-control MCP is unavailable in session-native Haider.";

#[derive(Clone, Default)]
struct AppControlMcpState;

impl AppControlMcpState {
    fn new() -> Self {
        Self
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn app_control_mcp_reply(
    _state: State<'_, AppControlMcpState>,
    _request_id: String,
    _response: Value,
) -> Result<(), String> {
    Err(APP_CONTROL_MCP_UNAVAILABLE.to_string())
}

pub fn run_app_control_mcp_stdio_server(_args: Vec<String>) -> Result<(), String> {
    Err(APP_CONTROL_MCP_UNAVAILABLE.to_string())
}
