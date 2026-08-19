#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().collect::<Vec<_>>();
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
    if args.get(1).map(String::as_str) == Some("email") {
        let email_args = args.drain(2..).collect::<Vec<_>>();
        std::process::exit(rust_diffforge_lib::email::cli::run_email_cli(&email_args));
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
    rust_diffforge_lib::run()
}
