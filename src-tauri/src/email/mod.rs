//! Device-side email stack (`diffforge.email.v1`).
//!
//! Implements the Track D surface of the frozen email contract
//! (`cloud-diffforge/docs/email-v1-contract.md` v2): the durable send
//! journal (§10.1), credential storage, the wake-command intake with the
//! journal-before-ack law (§9.4), SMTP submission (provider 587/465) and
//! native direct-to-MX delivery, the native preflight (§10.2), and the
//! `diffforge email` CLI.
//!
//! Contract laws that shape this module (do not weaken them):
//! - the device journals `(send_job_id, generation, command_id,
//!   payload_hash)` durably BEFORE any `remote_command_ack`, in both live
//!   intake and account-sync-resume replay;
//! - `data_started` is journaled with `synchronous=FULL` before the SMTP
//!   `DATA` command; any loss at/after DATA settles as `delivery_unknown`
//!   and is never auto-retried;
//! - provider 2xx responses are journaled before they are reported;
//! - terminal outcomes are journaled before they are reported;
//! - tombstones have NO time-based deletion; compaction happens only after
//!   the cloud `email_generation_retired` ack;
//! - higher generation / lease-epoch fences lower; tombstone dominates.

pub mod capability;
pub mod cli;
pub mod cloud_transport;
pub mod contract;
pub mod credentials;
pub mod dkim;
pub mod encrypted_vault;
pub mod journal;
pub mod mime;
pub mod mx;
pub mod native_delivery;
pub mod preflight;
pub mod profiles;
pub mod rate_limit;
pub mod remote;
pub mod retry;
pub mod smtp_session;
pub mod submission;
pub mod test_support;
#[cfg(test)]
mod tests;
pub mod ui;

/// Cross-repo fixture corpus location (`cloud-diffforge/tests/contracts/
/// email-v1/`). Overridable via `EMAIL_V1_FIXTURES_DIR`; tests that parse
/// fixtures skip (with a note) when the sibling repo is absent, unless
/// `EMAIL_V1_REQUIRE_FIXTURES=1` forces a failure.
#[cfg(test)]
pub fn test_fixtures_dir() -> Option<std::path::PathBuf> {
    let candidate = std::env::var("EMAIL_V1_FIXTURES_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../cloud-diffforge/tests/contracts/email-v1")
        });
    if candidate.is_dir() {
        return Some(candidate);
    }
    if std::env::var("EMAIL_V1_REQUIRE_FIXTURES").as_deref() == Ok("1") {
        panic!(
            "EMAIL_V1_REQUIRE_FIXTURES=1 but fixture corpus missing at {}",
            candidate.display()
        );
    }
    None
}

/// Kill-switch hook for the crash-injection matrix (plan §6). When the
/// `DIFFFORGE_EMAIL_KILLPOINT` env var names this point, the process dies
/// immediately (no unwinding, no flushing) — the closest portable stand-in
/// for `kill -9`. Production builds never set the variable; the check is one
/// env read on cold paths only (journal/report boundaries, not byte loops).
pub fn email_killpoint(name: &str) {
    if let Ok(value) = std::env::var("DIFFFORGE_EMAIL_KILLPOINT") {
        if value == name {
            eprintln!("email killpoint hit: {name}");
            std::process::abort();
        }
    }
}
