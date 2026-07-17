#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) == Some("--coordination-mcp") {
        let mcp_args = args.drain(2..).collect::<Vec<_>>();
        let context = rust_diffforge_lib::coordination::mcp::McpContext::from_args(&mcp_args);
        if let Err(error) = rust_diffforge_lib::coordination::mcp::run_stdio_server(context) {
            eprintln!("coordination mcp error: {error}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--coordination-mcp-proxy") {
        let proxy_args = args.drain(2..).collect::<Vec<_>>();
        if let Err(error) =
            rust_diffforge_lib::coordination::mcp::run_shared_daemon_stdio_proxy(proxy_args)
        {
            eprintln!("coordination mcp proxy error: {error}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--workspace-mcp-gateway") {
        let mcp_args = args.drain(2..).collect::<Vec<_>>();
        let context = rust_diffforge_lib::coordination::mcp::McpContext::from_args(&mcp_args);
        if let Err(error) =
            rust_diffforge_lib::coordination::mcp::run_workspace_gateway_stdio_server(context)
        {
            eprintln!("workspace mcp gateway error: {error}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--cloud-mcp-proxy") {
        let proxy_args = args.drain(2..).collect::<Vec<_>>();
        if let Err(error) = rust_diffforge_lib::run_cloud_mcp_stdio_proxy(proxy_args) {
            eprintln!("cloud mcp proxy error: {error}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--app-control-mcp") {
        let mcp_args = args.drain(2..).collect::<Vec<_>>();
        if let Err(error) = rust_diffforge_lib::run_app_control_mcp_stdio_server(mcp_args) {
            eprintln!("app-control mcp error: {error}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("auth") {
        let auth_args = args.drain(2..).collect::<Vec<_>>();
        std::process::exit(rust_diffforge_lib::run_desktop_auth_cli(&auth_args));
    }
    if args.get(1).map(String::as_str) == Some("daemon") {
        rust_diffforge_lib::run_daemon();
        return;
    }
    if args.get(1).map(String::as_str) == Some("--snipping-capture-helper") {
        let helper_args = args.drain(2..).collect::<Vec<_>>();
        std::process::exit(rust_diffforge_lib::run_snipping_capture_helper(
            &helper_args,
        ));
    }
    if args.get(1).map(String::as_str) == Some("--agent-update-elevated-helper") {
        let helper_args = args.drain(2..).collect::<Vec<_>>();
        std::process::exit(rust_diffforge_lib::run_agent_update_elevated_helper(
            &helper_args,
        ));
    }
    if args.get(1).map(String::as_str) == Some("--claude-worktree-guard") {
        let guard_args = args.drain(2..).collect::<Vec<_>>();
        std::process::exit(rust_diffforge_lib::run_claude_worktree_guard(&guard_args));
    }
    if args.get(1).map(String::as_str) == Some("--diff-forge-write-guard") {
        let guard_args = args.drain(2..).collect::<Vec<_>>();
        std::process::exit(rust_diffforge_lib::run_diff_forge_write_guard(&guard_args));
    }
    if args.get(1).map(String::as_str) == Some("--diff-forge-activity-hook") {
        let hook_args = args.drain(2..).collect::<Vec<_>>();
        std::process::exit(rust_diffforge_lib::run_diff_forge_activity_hook(&hook_args));
    }

    rust_diffforge_lib::run()
}
