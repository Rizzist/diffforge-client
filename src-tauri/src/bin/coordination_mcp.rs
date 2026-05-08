use rust_diffforge_lib::coordination::mcp::{run_stdio_server, McpContext};

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let context = McpContext::from_args(&args);

    if let Err(error) = run_stdio_server(context) {
        eprintln!("coordination_mcp error: {error}");
        std::process::exit(1);
    }
}
