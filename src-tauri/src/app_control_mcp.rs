const APP_CONTROL_MCP_UNAVAILABLE: &str =
    "App-control MCP is unavailable in session-native Haider.";
const APP_CONTROL_MCP_SERVER_NAME: &str = "diffforge-app-control";
const APP_CONTROL_MCP_SCRIPT_RUN_TIMEOUT_MS: u64 = 60 * 60 * 1000;
const DIFFFORGE_APP_BRIDGE_ENDPOINT_ENV: &str = "DIFFFORGE_APP_BRIDGE_ENDPOINT";
const DIFFFORGE_APP_BRIDGE_TOKEN_ENV: &str = "DIFFFORGE_APP_BRIDGE_TOKEN";

#[derive(Clone)]
struct AppControlMcpEndpoint {
    host: String,
    port: u16,
    token: String,
}

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

async fn app_control_mcp_endpoint_for_state(
    _app: AppHandle,
    _state: &AppControlMcpState,
) -> Result<AppControlMcpEndpoint, String> {
    Err(APP_CONTROL_MCP_UNAVAILABLE.to_string())
}

fn app_control_mcp_command() -> String {
    env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "rust-diffforge".to_string())
}

fn app_control_mcp_args_for_endpoint(endpoint: &AppControlMcpEndpoint) -> Vec<String> {
    vec![
        "--app-control-mcp".to_string(),
        "--endpoint".to_string(),
        format!("{}:{}", endpoint.host, endpoint.port),
        "--token".to_string(),
        endpoint.token.clone(),
    ]
}

pub fn run_app_control_mcp_stdio_server(_args: Vec<String>) -> Result<(), String> {
    Err(APP_CONTROL_MCP_UNAVAILABLE.to_string())
}
