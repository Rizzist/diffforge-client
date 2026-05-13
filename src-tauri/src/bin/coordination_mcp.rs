use rust_diffforge_lib::coordination::mcp::{
    run_shared_daemon_stdio_proxy, run_stdio_server, McpContext,
};

fn main() {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    if matches!(
        args.first().map(String::as_str),
        Some("--coordination-mcp-proxy" | "--proxy")
    ) {
        let proxy_args = args.drain(1..).collect::<Vec<_>>();
        if let Err(error) = run_shared_daemon_stdio_proxy(proxy_args) {
            eprintln!("coordination_mcp proxy error: {error}");
            std::process::exit(1);
        }
        return;
    }
    let context = McpContext::from_args(&args);

    if let Err(error) = run_stdio_server(context) {
        eprintln!("coordination_mcp error: {error}");
        std::process::exit(1);
    }
}
