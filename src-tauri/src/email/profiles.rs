//! Sender-profile management: journal rows (secret locators only, §10.1)
//! plus credential material in the credential stack. Mirrors the SSH-vault
//! UX conventions (plan §3.8): `has_secret`-style display, an untouched
//! save preserves the stored secret, and clearing is explicit — with no
//! plaintext storage anywhere.

use rusqlite::{params, OptionalExtension};
use secrecy::SecretString;
use serde_json::{json, Value};

use super::credentials::CredentialStack;
use super::journal::EmailJournal;

pub const PROFILE_MODES: [&str; 2] = ["provider", "native"];
pub const SMTP_SECURITY_STARTTLS: &str = "starttls";
pub const SMTP_SECURITY_IMPLICIT: &str = "implicit_tls";

#[derive(Clone, Debug)]
pub struct SenderProfile {
    pub profile_ref: String,
    pub mode: String,
    pub provider_kind: Option<String>,
    pub display_name: Option<String>,
    pub from_address: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_security: Option<String>,
    pub username: Option<String>,
    pub secret_locator: Option<String>,
    pub has_credentials: bool,
    pub created_at_ms: i64,
    pub last_test_at_ms: Option<i64>,
    pub last_test_ok: Option<bool>,
}

impl SenderProfile {
    /// UI/summary projection — never includes the locator or any secret.
    pub fn summary(&self) -> Value {
        json!({
            "profile_ref": self.profile_ref,
            "mode": self.mode,
            "provider_kind": self.provider_kind,
            "display_name": self.display_name,
            "from_address": self.from_address,
            "smtp_host": self.smtp_host,
            "smtp_port": self.smtp_port,
            "smtp_security": self.smtp_security,
            "username": self.username,
            "has_secret": self.has_credentials,
            "has_credentials": self.has_credentials,
            "created_at_ms": self.created_at_ms,
            "last_test_at_ms": self.last_test_at_ms,
            "last_test_ok": self.last_test_ok,
        })
    }

    /// §8 capabilities-sync profile entry.
    pub fn capability_entry(&self) -> Value {
        let mut entry = json!({
            "profile_ref": self.profile_ref,
            "has_credentials": self.has_credentials,
            "mode": self.mode,
        });
        if let (Some(at_ms), Some(ok)) = (self.last_test_at_ms, self.last_test_ok) {
            entry["last_test"] = json!({ "at_ms": at_ms, "ok": ok });
        }
        entry
    }
}

/// A save request from the UI/CLI. `secret: None` = untouched (preserve);
/// `secret: Some("")` = explicit clear; `secret: Some(value)` = set.
#[derive(Clone, Debug)]
pub struct ProfileSaveRequest {
    pub profile_ref: Option<String>,
    pub mode: String,
    pub provider_kind: Option<String>,
    pub display_name: Option<String>,
    pub from_address: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_security: Option<String>,
    pub username: Option<String>,
    pub secret: Option<String>,
}

impl ProfileSaveRequest {
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let mode = value
            .get("mode")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|mode| !mode.is_empty())
            .unwrap_or("provider")
            .to_string();
        if !PROFILE_MODES.contains(&mode.as_str()) {
            return Err(format!("unknown profile mode: {mode}"));
        }
        let text = |key: &str| -> Option<String> {
            value
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string)
        };
        let smtp_port = value
            .get("smtp_port")
            .and_then(Value::as_u64)
            .map(|port| u16::try_from(port).map_err(|_| "smtp_port out of range".to_string()))
            .transpose()?;
        // secret: only treated as touched when the key is present.
        let secret = match value.get("secret") {
            None | Some(Value::Null) => None,
            Some(Value::String(secret)) => Some(secret.clone()),
            Some(_) => return Err("secret must be a string".to_string()),
        };
        Ok(ProfileSaveRequest {
            profile_ref: text("profile_ref"),
            mode,
            provider_kind: text("provider_kind"),
            display_name: text("display_name"),
            from_address: text("from_address"),
            smtp_host: text("smtp_host"),
            smtp_port,
            smtp_security: text("smtp_security"),
            username: text("username"),
            secret,
        })
    }

    fn validate(&self) -> Result<(), String> {
        if self.mode == "provider" {
            if self.smtp_host.is_none() {
                return Err("provider profiles need an SMTP host".to_string());
            }
            let security = self
                .smtp_security
                .as_deref()
                .or(match self.smtp_port {
                    Some(465) => Some(SMTP_SECURITY_IMPLICIT),
                    Some(587) | None => Some(SMTP_SECURITY_STARTTLS),
                    Some(_) => None,
                })
                .ok_or_else(|| {
                    "non-standard SMTP port requires explicit smtp_security".to_string()
                })?;
            if security != SMTP_SECURITY_STARTTLS && security != SMTP_SECURITY_IMPLICIT {
                return Err(format!("unknown smtp_security: {security}"));
            }
        }
        Ok(())
    }
}

fn load_row(journal: &EmailJournal, profile_ref: &str) -> Result<Option<SenderProfile>, String> {
    journal
        .connection()
        .query_row(
            "SELECT profile_ref, mode, provider_kind, display_name, from_address, smtp_host,
                    smtp_port, smtp_security, username, secret_locator, has_credentials,
                    created_at_ms, last_test_at_ms, last_test_ok
             FROM email_sender_profiles WHERE profile_ref = ?1",
            [profile_ref],
            map_profile_row,
        )
        .optional()
        .map_err(|error| format!("email profile load failed: {error}"))
}

fn map_profile_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SenderProfile> {
    Ok(SenderProfile {
        profile_ref: row.get(0)?,
        mode: row.get(1)?,
        provider_kind: row.get(2)?,
        display_name: row.get(3)?,
        from_address: row.get(4)?,
        smtp_host: row.get(5)?,
        smtp_port: row
            .get::<_, Option<i64>>(6)?
            .and_then(|port| u16::try_from(port).ok()),
        smtp_security: row.get(7)?,
        username: row.get(8)?,
        secret_locator: row.get(9)?,
        has_credentials: row.get::<_, i64>(10)? != 0,
        created_at_ms: row.get(11)?,
        last_test_at_ms: row.get(12)?,
        last_test_ok: row.get::<_, Option<i64>>(13)?.map(|value| value != 0),
    })
}

pub fn list_profiles(journal: &EmailJournal) -> Result<Vec<SenderProfile>, String> {
    let mut statement = journal
        .connection()
        .prepare(
            "SELECT profile_ref, mode, provider_kind, display_name, from_address, smtp_host,
                    smtp_port, smtp_security, username, secret_locator, has_credentials,
                    created_at_ms, last_test_at_ms, last_test_ok
             FROM email_sender_profiles ORDER BY created_at_ms ASC",
        )
        .map_err(|error| format!("email profiles prepare failed: {error}"))?;
    let rows = statement
        .query_map([], map_profile_row)
        .map_err(|error| format!("email profiles query failed: {error}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|error| format!("email profiles row failed: {error}"))?);
    }
    Ok(out)
}

pub fn load_profile(
    journal: &EmailJournal,
    profile_ref: &str,
) -> Result<Option<SenderProfile>, String> {
    load_row(journal, profile_ref)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Save (create or update) a profile. Secret handling follows the SSH-vault
/// convention: untouched preserves, explicit empty clears, value replaces.
pub fn save_profile(
    journal: &mut EmailJournal,
    credentials: &CredentialStack,
    request: &ProfileSaveRequest,
) -> Result<SenderProfile, String> {
    request.validate()?;
    let profile_ref = request.profile_ref.clone().unwrap_or_else(|| {
        format!(
            "profile-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..12]
        )
    });
    let existing = load_row(journal, &profile_ref)?;
    let (secret_locator, has_credentials) = match request.secret.as_deref() {
        None => existing
            .as_ref()
            .map(|profile| (profile.secret_locator.clone(), profile.has_credentials))
            .unwrap_or((None, false)),
        Some("") => {
            if let Some(locator) = existing.as_ref().and_then(|p| p.secret_locator.as_deref()) {
                let _ = credentials.delete(locator);
            }
            (None, false)
        }
        Some(secret) => {
            let locator =
                credentials.store(&profile_ref, &SecretString::from(secret.to_string()))?;
            (Some(locator), true)
        }
    };
    let now = now_ms();
    let created_at_ms = existing
        .as_ref()
        .map(|profile| profile.created_at_ms)
        .unwrap_or(now);
    journal
        .connection()
        .execute(
            "INSERT INTO email_sender_profiles
             (profile_ref, mode, provider_kind, display_name, from_address, smtp_host, smtp_port,
              smtp_security, username, secret_locator, has_credentials, created_at_ms,
              updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(profile_ref) DO UPDATE SET
                mode = excluded.mode,
                provider_kind = excluded.provider_kind,
                display_name = excluded.display_name,
                from_address = excluded.from_address,
                smtp_host = excluded.smtp_host,
                smtp_port = excluded.smtp_port,
                smtp_security = excluded.smtp_security,
                username = excluded.username,
                secret_locator = excluded.secret_locator,
                has_credentials = excluded.has_credentials,
                updated_at_ms = excluded.updated_at_ms",
            params![
                profile_ref,
                request.mode,
                request.provider_kind,
                request.display_name,
                request.from_address,
                request.smtp_host,
                request.smtp_port.map(i64::from),
                request.smtp_security,
                request.username,
                secret_locator,
                has_credentials as i64,
                created_at_ms,
                now
            ],
        )
        .map_err(|error| format!("email profile save failed: {error}"))?;
    load_row(journal, &profile_ref)?.ok_or_else(|| "email profile vanished after save".to_string())
}

pub fn delete_profile(
    journal: &mut EmailJournal,
    credentials: &CredentialStack,
    profile_ref: &str,
) -> Result<bool, String> {
    let Some(existing) = load_row(journal, profile_ref)? else {
        return Ok(false);
    };
    if let Some(locator) = existing.secret_locator.as_deref() {
        let _ = credentials.delete(locator);
    }
    journal
        .connection()
        .execute(
            "DELETE FROM email_sender_profiles WHERE profile_ref = ?1",
            [profile_ref],
        )
        .map_err(|error| format!("email profile delete failed: {error}"))?;
    Ok(true)
}

pub fn record_profile_test(
    journal: &mut EmailJournal,
    profile_ref: &str,
    ok: bool,
) -> Result<(), String> {
    journal
        .connection()
        .execute(
            "UPDATE email_sender_profiles
             SET last_test_at_ms = ?2, last_test_ok = ?3, updated_at_ms = ?2
             WHERE profile_ref = ?1",
            params![profile_ref, now_ms(), ok as i64],
        )
        .map(|_| ())
        .map_err(|error| format!("email profile test record failed: {error}"))
}

/// Device-local cache of the cloud's BindingRows (from
/// `email_sender_capabilities_sync` / resume responses), kept in journal
/// meta so binding_id → profile_ref resolves without a cloud round-trip.
/// This is a cache of cloud state, not a journal table of record.
pub const BINDINGS_CACHE_META_KEY: &str = "bindings_cache";

pub fn store_bindings_cache(journal: &mut EmailJournal, bindings: &Value) -> Result<(), String> {
    if !bindings.is_array() {
        return Err("bindings cache must be an array".to_string());
    }
    journal.meta_set(BINDINGS_CACHE_META_KEY, &bindings.to_string())
}

pub fn binding_profile_ref(
    journal: &EmailJournal,
    binding_id: &str,
) -> Result<Option<String>, String> {
    let Some(raw) = journal.meta_get(BINDINGS_CACHE_META_KEY)? else {
        return Ok(None);
    };
    let bindings: Value =
        serde_json::from_str(&raw).map_err(|error| format!("bindings cache corrupt: {error}"))?;
    Ok(bindings.as_array().and_then(|items| {
        items.iter().find_map(|binding| {
            let matches = binding
                .get("binding_id")
                .and_then(Value::as_str)
                .is_some_and(|id| id == binding_id);
            if matches {
                binding
                    .get("profile_ref")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            } else {
                None
            }
        })
    }))
}

/// Credential probe (§9.4 companion): does the stored locator resolve to
/// material right now?
pub fn probe_profile_credentials(
    journal: &EmailJournal,
    credentials: &CredentialStack,
    profile_ref: &str,
) -> Result<Value, String> {
    let profile = load_row(journal, profile_ref)?
        .ok_or_else(|| format!("unknown email profile: {profile_ref}"))?;
    let resolved = match profile.secret_locator.as_deref() {
        Some(locator) => credentials
            .resolve(locator)
            .map(|secret| secret.is_some())
            .unwrap_or(false),
        None => false,
    };
    Ok(json!({
        "profile_ref": profile_ref,
        "has_credentials": profile.has_credentials,
        "credentials_resolve": resolved,
        "credential_store": credentials.health().as_str(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::email::credentials::{CredentialStore, MemoryCredentialStore};
    use secrecy::ExposeSecret;

    fn temp_journal() -> EmailJournal {
        let dir = std::env::temp_dir().join(format!(
            "diffforge-email-profiles-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        EmailJournal::open_at(&dir.join("journal.sqlite")).unwrap()
    }

    fn memory_stack() -> (CredentialStack, std::sync::Arc<MemoryCredentialStore>) {
        // CredentialStack uses OS/vault; for tests we exercise the memory
        // store through the trait directly where needed. Profile tests use a
        // stack whose OS backend may be unavailable in CI, so secrets go
        // through set/resolve on the memory store via a stack-free path.
        (
            CredentialStack::new(),
            std::sync::Arc::new(MemoryCredentialStore::new()),
        )
    }

    #[test]
    fn save_preserves_secret_when_untouched_and_clears_explicitly() {
        let mut journal = temp_journal();
        let (_stack, memory) = memory_stack();

        // Store the secret through the memory backend, then wire the locator
        // in by hand — the journal law under test is locator handling, not
        // the OS keyring.
        let locator = memory
            .set("profile-test", &SecretString::from("hunter2"))
            .unwrap();
        journal
            .connection()
            .execute(
                "INSERT INTO email_sender_profiles
                 (profile_ref, mode, smtp_host, smtp_port, smtp_security, secret_locator,
                  has_credentials, created_at_ms, updated_at_ms)
                 VALUES ('profile-test', 'provider', 'smtp.example.com', 587, 'starttls', ?1,
                         1, 1, 1)",
                [&locator],
            )
            .unwrap();

        // Untouched save (no `secret` key): locator + has_credentials survive.
        let request = ProfileSaveRequest::from_value(&serde_json::json!({
            "profile_ref": "profile-test",
            "mode": "provider",
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "display_name": "Renamed",
        }))
        .unwrap();
        let stack = CredentialStack::new();
        let saved = save_profile(&mut journal, &stack, &request).unwrap();
        assert!(saved.has_credentials, "untouched save must preserve secret");
        assert_eq!(saved.secret_locator.as_deref(), Some(locator.as_str()));
        assert_eq!(saved.display_name.as_deref(), Some("Renamed"));
        assert_eq!(
            memory.get(&locator).unwrap().unwrap().expose_secret(),
            "hunter2"
        );

        // Explicit clear removes credentials.
        let clear = ProfileSaveRequest::from_value(&serde_json::json!({
            "profile_ref": "profile-test",
            "mode": "provider",
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "secret": "",
        }))
        .unwrap();
        let cleared = save_profile(&mut journal, &stack, &clear).unwrap();
        assert!(!cleared.has_credentials);
        assert!(cleared.secret_locator.is_none());
    }

    #[test]
    fn summary_never_exposes_locator_or_secret() {
        let mut journal = temp_journal();
        let stack = CredentialStack::new();
        journal
            .connection()
            .execute(
                "INSERT INTO email_sender_profiles
                 (profile_ref, mode, smtp_host, smtp_port, smtp_security, secret_locator,
                  has_credentials, created_at_ms, updated_at_ms)
                 VALUES ('profile-x', 'provider', 'smtp.example.com', 465, 'implicit_tls',
                         'memory://diffforge/email/profile-x', 1, 1, 1)",
                [],
            )
            .unwrap();
        let profiles = list_profiles(&journal).unwrap();
        assert_eq!(profiles.len(), 1);
        let summary = profiles[0].summary().to_string();
        assert!(!summary.contains("locator"));
        assert!(!summary.contains("memory://"));
        assert!(summary.contains("\"has_secret\":true"));
        let _ = delete_profile(&mut journal, &stack, "profile-x").unwrap();
        assert!(list_profiles(&journal).unwrap().is_empty());
    }

    #[test]
    fn validation_rejects_plaintext_and_unknown_modes() {
        assert!(ProfileSaveRequest::from_value(&serde_json::json!({
            "mode": "carrier_pigeon",
        }))
        .is_err());
        // Non-standard port without explicit security fails closed.
        let request = ProfileSaveRequest::from_value(&serde_json::json!({
            "mode": "provider",
            "smtp_host": "smtp.example.com",
            "smtp_port": 2525,
        }))
        .unwrap();
        assert!(request.validate().is_err());
    }
}
