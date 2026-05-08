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

    rust_diffforge_lib::run()
}
