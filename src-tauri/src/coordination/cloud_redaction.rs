pub fn redact_summary_text(value: &str) -> String {
    value
        .lines()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            !lower.contains("secret")
                && !lower.contains("token")
                && !lower.contains("password")
                && !lower.contains("api_key")
        })
        .collect::<Vec<_>>()
        .join("\n")
}
