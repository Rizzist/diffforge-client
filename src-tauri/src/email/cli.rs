//! `diffforge email` CLI (plan §4.3): the BYOC / no-GUI path for managing
//! sender profiles, the headless credential vault, DKIM keys, and preflight.
//! Wired from main.rs. Everything writes through the same journal +
//! credential stack the GUI uses; secrets never print.
//!
//! Subcommands:
//!   diffforge email profiles list
//!   diffforge email profiles show <profile_ref>
//!   diffforge email vault init | status | set <name> | delete <name>
//!   diffforge email dkim generate <domain> <selector>
//!   diffforge email dkim list
//!   diffforge email preflight status <profile_ref> <domain>

use std::io::{IsTerminal, Read, Write};

use secrecy::SecretString;
use serde_json::{json, Value};

use super::credentials::{CredentialStack, CredentialStoreHealth};
use super::dkim;
use super::encrypted_vault::{vault_default_path, EncryptedVault};
use super::journal::EmailJournal;
use super::profiles;

/// Run the CLI and return a process exit code.
pub fn run_email_cli(args: &[String]) -> i32 {
    match dispatch(args) {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
            0
        }
        Err(error) => {
            eprintln!("diffforge email: {error}");
            1
        }
    }
}

fn dispatch(args: &[String]) -> Result<Value, String> {
    let mut journal = EmailJournal::open_default()?;
    let credentials = CredentialStack::new();
    match args.first().map(String::as_str) {
        Some("profiles") => profiles_command(&mut journal, &credentials, &args[1..]),
        Some("vault") => vault_command(&args[1..]),
        Some("dkim") => dkim_command(&mut journal, &credentials, &args[1..]),
        Some("preflight") => preflight_command(&journal, &args[1..]),
        Some("help") | None => Ok(usage()),
        Some(other) => Err(format!("unknown subcommand `{other}`. Try `diffforge email help`.")),
    }
}

fn usage() -> Value {
    json!({
        "usage": [
            "diffforge email profiles list",
            "diffforge email profiles show <profile_ref>",
            "diffforge email vault init",
            "diffforge email vault status",
            "diffforge email vault set <name>",
            "diffforge email vault delete <name>",
            "diffforge email dkim generate <domain> <selector>",
            "diffforge email dkim list",
            "diffforge email preflight status <profile_ref> <domain>",
        ]
    })
}

fn profiles_command(
    journal: &mut EmailJournal,
    credentials: &CredentialStack,
    args: &[String],
) -> Result<Value, String> {
    match args.first().map(String::as_str) {
        Some("list") | None => {
            let profiles = profiles::list_profiles(journal)?;
            Ok(json!({
                "profiles": profiles.iter().map(profiles::SenderProfile::summary).collect::<Vec<_>>(),
            }))
        }
        Some("show") => {
            let profile_ref = args
                .get(1)
                .ok_or_else(|| "profiles show requires a profile_ref".to_string())?;
            let profile = profiles::load_profile(journal, profile_ref)?
                .ok_or_else(|| format!("no profile {profile_ref}"))?;
            Ok(json!({
                "profile": profile.summary(),
                "credential_probe": profiles::probe_profile_credentials(
                    journal, credentials, profile_ref,
                )?,
            }))
        }
        Some(other) => Err(format!("unknown profiles command `{other}`")),
    }
}

fn read_secret_from_tty_or_stdin(prompt: &str) -> Result<SecretString, String> {
    if std::io::stdin().is_terminal() {
        eprint!("{prompt}");
        let _ = std::io::stderr().flush();
    }
    let mut buffer = String::new();
    std::io::stdin()
        .read_to_string(&mut buffer)
        .map_err(|error| format!("unable to read secret: {error}"))?;
    let trimmed = buffer.trim_end_matches(['\n', '\r']).to_string();
    if trimmed.is_empty() {
        return Err("no secret provided on stdin".to_string());
    }
    Ok(SecretString::from(trimmed))
}

fn vault_command(args: &[String]) -> Result<Value, String> {
    let path = vault_default_path().ok_or_else(|| "vault path unavailable".to_string())?;
    match args.first().map(String::as_str) {
        Some("status") | None => Ok(json!({
            "vault_path": path.display().to_string(),
            "exists": EncryptedVault::exists_at(&path),
        })),
        Some("init") => {
            if EncryptedVault::exists_at(&path) {
                return Err("vault already exists".to_string());
            }
            let passphrase = read_secret_from_tty_or_stdin(
                "Set a vault passphrase (read from stdin): ",
            )?;
            let _ = EncryptedVault::create(&path, passphrase)?;
            Ok(json!({ "created": true, "vault_path": path.display().to_string() }))
        }
        Some("set") => {
            let name = args
                .get(1)
                .ok_or_else(|| "vault set requires a name".to_string())?;
            let passphrase = std::env::var("DIFFFORGE_EMAIL_VAULT_PASSPHRASE")
                .ok()
                .map(SecretString::from)
                .ok_or_else(|| {
                    "set DIFFFORGE_EMAIL_VAULT_PASSPHRASE to unlock the vault first".to_string()
                })?;
            let mut vault = EncryptedVault::unlock(&path, passphrase)?;
            let secret = read_secret_from_tty_or_stdin("Secret value (read from stdin): ")?;
            vault.set(name, &secret)?;
            Ok(json!({ "stored": true, "name": name }))
        }
        Some("delete") => {
            let name = args
                .get(1)
                .ok_or_else(|| "vault delete requires a name".to_string())?;
            let passphrase = std::env::var("DIFFFORGE_EMAIL_VAULT_PASSPHRASE")
                .ok()
                .map(SecretString::from)
                .ok_or_else(|| {
                    "set DIFFFORGE_EMAIL_VAULT_PASSPHRASE to unlock the vault first".to_string()
                })?;
            let mut vault = EncryptedVault::unlock(&path, passphrase)?;
            let removed = vault.delete(name)?;
            Ok(json!({ "deleted": removed, "name": name }))
        }
        Some(other) => Err(format!("unknown vault command `{other}`")),
    }
}

fn dkim_command(
    journal: &mut EmailJournal,
    credentials: &CredentialStack,
    args: &[String],
) -> Result<Value, String> {
    match args.first().map(String::as_str) {
        Some("generate") => {
            let domain = args
                .get(1)
                .ok_or_else(|| "dkim generate requires a domain".to_string())?;
            let selector = args
                .get(2)
                .ok_or_else(|| "dkim generate requires a selector".to_string())?;
            let generated = dkim::generate_rsa_dkim_key()?;
            let locator_name = format!("dkim/{domain}/{selector}");
            let locator = credentials.store(&locator_name, &generated.private_key_pem)?;
            journal
                .connection()
                .execute(
                    "INSERT INTO email_dkim_keys
                     (domain, selector, state, pubkey_fingerprint_sha256, public_key_b64,
                      secret_locator, created_at_ms)
                     VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6)
                     ON CONFLICT(domain, selector) DO UPDATE SET
                        state = 'active',
                        pubkey_fingerprint_sha256 = excluded.pubkey_fingerprint_sha256,
                        public_key_b64 = excluded.public_key_b64,
                        secret_locator = excluded.secret_locator",
                    rusqlite::params![
                        domain,
                        selector,
                        generated.pubkey_fingerprint_sha256,
                        generated.public_key_b64,
                        locator,
                        now_ms(),
                    ],
                )
                .map_err(|error| format!("dkim key store failed: {error}"))?;
            Ok(json!({
                "domain": domain,
                "selector": selector,
                "pubkey_fingerprint_sha256": generated.pubkey_fingerprint_sha256,
                "dns_record": {
                    "name": format!("{selector}._domainkey.{domain}"),
                    "type": "TXT",
                    "value": generated.dns_txt_value,
                },
            }))
        }
        Some("list") | None => {
            let mut statement = journal
                .connection()
                .prepare(
                    "SELECT domain, selector, state, pubkey_fingerprint_sha256, created_at_ms
                     FROM email_dkim_keys ORDER BY domain, selector",
                )
                .map_err(|error| format!("dkim list failed: {error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok(json!({
                        "domain": row.get::<_, String>(0)?,
                        "selector": row.get::<_, String>(1)?,
                        "state": row.get::<_, String>(2)?,
                        "pubkey_fingerprint_sha256": row.get::<_, String>(3)?,
                        "created_at_ms": row.get::<_, i64>(4)?,
                    }))
                })
                .map_err(|error| format!("dkim list query failed: {error}"))?;
            let mut keys = Vec::new();
            for row in rows {
                keys.push(row.map_err(|error| format!("dkim list row failed: {error}"))?);
            }
            Ok(json!({ "dkim_keys": keys }))
        }
        Some(other) => Err(format!("unknown dkim command `{other}`")),
    }
}

fn preflight_command(journal: &EmailJournal, args: &[String]) -> Result<Value, String> {
    match args.first().map(String::as_str) {
        Some("status") => {
            let profile_ref = args.get(1).cloned().unwrap_or_default();
            let domain = args.get(2).cloned().unwrap_or_default();
            let mut statement = journal
                .connection()
                .prepare(
                    "SELECT preflight_id, result, qualified, eligible, ran_at_ms, expires_at_ms
                     FROM email_native_preflight_runs
                     WHERE (?1 = '' OR profile_ref = ?1) AND (?2 = '' OR domain = ?2)
                     ORDER BY ran_at_ms DESC LIMIT 5",
                )
                .map_err(|error| format!("preflight status failed: {error}"))?;
            let rows = statement
                .query_map(rusqlite::params![profile_ref, domain], |row| {
                    Ok(json!({
                        "preflight_id": row.get::<_, String>(0)?,
                        "result": row.get::<_, String>(1)?,
                        "qualified": row.get::<_, i64>(2)? != 0,
                        "eligible": row.get::<_, i64>(3)? != 0,
                        "ran_at_ms": row.get::<_, i64>(4)?,
                        "expires_at_ms": row.get::<_, i64>(5)?,
                    }))
                })
                .map_err(|error| format!("preflight status query failed: {error}"))?;
            let mut runs = Vec::new();
            for row in rows {
                runs.push(row.map_err(|error| format!("preflight status row failed: {error}"))?);
            }
            Ok(json!({ "runs": runs, "note": "live preflight probing is operator-gated" }))
        }
        Some(other) => Err(format!("unknown preflight command `{other}`")),
        None => Err("preflight requires a subcommand (status)".to_string()),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Health-report helper reused by the CLI and the GUI invoke handler.
pub fn credential_store_report(credentials: &CredentialStack) -> Value {
    let health = credentials.health();
    json!({
        "health": health.as_str(),
        "usable_for_write": health == CredentialStoreHealth::Healthy,
    })
}
