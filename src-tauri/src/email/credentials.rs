//! Credential storage for email sender profiles and DKIM private keys
//! (plan §3.8). The journal stores secret LOCATORS only (§10.1); material
//! lives in the OS store (macOS Keychain / Windows Credential Manager /
//! libsecret via the `keyring` crate) or, headless opt-in, in the
//! Argon2id + XChaCha20-Poly1305 vault (`encrypted_vault.rs`).
//!
//! Backend unavailable ⇒ report `locked`/`unavailable`, NEVER fall back to
//! plaintext. SSH-vault UX conventions apply (has_secret, untouched save
//! preserves, explicit clear) without its plaintext storage.

use std::sync::Mutex;

use secrecy::SecretString;

use super::encrypted_vault::{
    vault_default_path, vault_passphrase_from_environment, EncryptedVault,
};

/// Keychain service the OS backend stores under (non-sync).
pub const EMAIL_KEYRING_SERVICE: &str = "ai.diffforge.email";
pub const LOCATOR_KEYCHAIN_PREFIX: &str = "keychain://diffforge/email/";
pub const LOCATOR_VAULT_PREFIX: &str = "vault://diffforge/email/";

/// §8 `email_sender_capabilities_sync.credential_store` closed values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CredentialStoreHealth {
    Healthy,
    Locked,
    Unavailable,
}

impl CredentialStoreHealth {
    pub fn as_str(self) -> &'static str {
        match self {
            CredentialStoreHealth::Healthy => "healthy",
            CredentialStoreHealth::Locked => "locked",
            CredentialStoreHealth::Unavailable => "unavailable",
        }
    }
}

/// Read-side abstraction the send workers depend on: resolve a journaled
/// locator to secret material. `CredentialStack` implements it for
/// production; `MemoryCredentialStore` for tests.
pub trait SecretResolver: Send + Sync {
    fn resolve_locator(&self, locator: &str) -> Result<Option<SecretString>, String>;
}

pub trait CredentialStore: Send + Sync {
    fn backend(&self) -> &'static str;
    fn health(&self) -> CredentialStoreHealth;
    /// Store secret material under `name`; returns the locator to journal.
    fn set(&self, name: &str, value: &SecretString) -> Result<String, String>;
    /// Resolve a locator minted by this backend.
    fn get(&self, locator: &str) -> Result<Option<SecretString>, String>;
    fn delete(&self, locator: &str) -> Result<(), String>;
}

fn locator_name<'a>(locator: &'a str, prefix: &str) -> Result<&'a str, String> {
    locator
        .strip_prefix(prefix)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| format!("credential locator not owned by this backend: {locator}"))
}

/// OS credential store via the `keyring` crate. On platforms without a
/// native backend feature the crate falls back to its mock store; we treat
/// that as unavailable by probing a round-trip at health time.
pub struct OsKeyringStore;

impl OsKeyringStore {
    fn entry(name: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(EMAIL_KEYRING_SERVICE, name)
            .map_err(|error| format!("keyring entry failed: {error}"))
    }
}

impl CredentialStore for OsKeyringStore {
    fn backend(&self) -> &'static str {
        "os_keyring"
    }

    fn health(&self) -> CredentialStoreHealth {
        // Never touch the real OS keychain from unit tests: macOS Security
        // framework calls can block indefinitely in headless test contexts
        // (and would prompt in signed ones). Tests exercise credential flows
        // through MemoryCredentialStore / the vault.
        if cfg!(test) {
            return CredentialStoreHealth::Unavailable;
        }
        let probe_name = "diffforge-health-probe";
        let Ok(entry) = Self::entry(probe_name) else {
            return CredentialStoreHealth::Unavailable;
        };
        match entry.set_password("ok") {
            Ok(()) => {
                let readable = matches!(entry.get_password().as_deref(), Ok("ok"));
                let _ = entry.delete_credential();
                if readable {
                    CredentialStoreHealth::Healthy
                } else {
                    CredentialStoreHealth::Unavailable
                }
            }
            Err(keyring::Error::NoStorageAccess(_)) => CredentialStoreHealth::Locked,
            Err(_) => CredentialStoreHealth::Unavailable,
        }
    }

    fn set(&self, name: &str, value: &SecretString) -> Result<String, String> {
        use secrecy::ExposeSecret;
        let entry = Self::entry(name)?;
        entry
            .set_password(value.expose_secret())
            .map_err(|error| format!("keyring store failed: {error}"))?;
        Ok(format!("{LOCATOR_KEYCHAIN_PREFIX}{name}"))
    }

    fn get(&self, locator: &str) -> Result<Option<SecretString>, String> {
        let name = locator_name(locator, LOCATOR_KEYCHAIN_PREFIX)?;
        let entry = Self::entry(name)?;
        match entry.get_password() {
            Ok(password) => Ok(Some(SecretString::from(password))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("keyring read failed: {error}")),
        }
    }

    fn delete(&self, locator: &str) -> Result<(), String> {
        let name = locator_name(locator, LOCATOR_KEYCHAIN_PREFIX)?;
        let entry = Self::entry(name)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("keyring delete failed: {error}")),
        }
    }
}

/// Headless vault-backed store. `Locked` until a passphrase source unlocks
/// it; never silently creates a vault (creation is an explicit CLI step).
pub struct VaultCredentialStore {
    vault: Mutex<Option<EncryptedVault>>,
}

impl VaultCredentialStore {
    pub fn new() -> Self {
        VaultCredentialStore {
            vault: Mutex::new(None),
        }
    }

    pub fn try_unlock_from_environment(&self) -> Result<bool, String> {
        let Some(path) = vault_default_path() else {
            return Ok(false);
        };
        if !EncryptedVault::exists_at(&path) {
            return Ok(false);
        }
        let Some(passphrase) = vault_passphrase_from_environment() else {
            return Ok(false);
        };
        let vault = EncryptedVault::unlock(&path, passphrase)?;
        *self
            .vault
            .lock()
            .map_err(|_| "vault store poisoned".to_string())? = Some(vault);
        Ok(true)
    }

    pub fn unlock_with(&self, vault: EncryptedVault) -> Result<(), String> {
        *self
            .vault
            .lock()
            .map_err(|_| "vault store poisoned".to_string())? = Some(vault);
        Ok(())
    }
}

impl Default for VaultCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialStore for VaultCredentialStore {
    fn backend(&self) -> &'static str {
        "encrypted_vault"
    }

    fn health(&self) -> CredentialStoreHealth {
        let Some(path) = vault_default_path() else {
            return CredentialStoreHealth::Unavailable;
        };
        let unlocked = self
            .vault
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);
        if unlocked {
            CredentialStoreHealth::Healthy
        } else if EncryptedVault::exists_at(&path) {
            CredentialStoreHealth::Locked
        } else {
            CredentialStoreHealth::Unavailable
        }
    }

    fn set(&self, name: &str, value: &SecretString) -> Result<String, String> {
        let mut guard = self
            .vault
            .lock()
            .map_err(|_| "vault store poisoned".to_string())?;
        let vault = guard
            .as_mut()
            .ok_or_else(|| "vault is locked; unlock it before storing secrets".to_string())?;
        vault.set(name, value)?;
        Ok(format!("{LOCATOR_VAULT_PREFIX}{name}"))
    }

    fn get(&self, locator: &str) -> Result<Option<SecretString>, String> {
        let name = locator_name(locator, LOCATOR_VAULT_PREFIX)?;
        let guard = self
            .vault
            .lock()
            .map_err(|_| "vault store poisoned".to_string())?;
        let vault = guard
            .as_ref()
            .ok_or_else(|| "vault is locked".to_string())?;
        Ok(vault.get(name))
    }

    fn delete(&self, locator: &str) -> Result<(), String> {
        let name = locator_name(locator, LOCATOR_VAULT_PREFIX)?;
        let mut guard = self
            .vault
            .lock()
            .map_err(|_| "vault store poisoned".to_string())?;
        let vault = guard
            .as_mut()
            .ok_or_else(|| "vault is locked".to_string())?;
        vault.delete(name)?;
        Ok(())
    }
}

/// In-memory store for tests — never used in production paths.
pub struct MemoryCredentialStore {
    pub secrets: Mutex<std::collections::BTreeMap<String, String>>,
    pub health: Mutex<CredentialStoreHealth>,
}

impl MemoryCredentialStore {
    pub fn new() -> Self {
        MemoryCredentialStore {
            secrets: Mutex::new(Default::default()),
            health: Mutex::new(CredentialStoreHealth::Healthy),
        }
    }
}

impl Default for MemoryCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

pub const LOCATOR_MEMORY_PREFIX: &str = "memory://diffforge/email/";

impl CredentialStore for MemoryCredentialStore {
    fn backend(&self) -> &'static str {
        "memory"
    }

    fn health(&self) -> CredentialStoreHealth {
        *self.health.lock().unwrap()
    }

    fn set(&self, name: &str, value: &SecretString) -> Result<String, String> {
        use secrecy::ExposeSecret;
        self.secrets
            .lock()
            .unwrap()
            .insert(name.to_string(), value.expose_secret().to_string());
        Ok(format!("{LOCATOR_MEMORY_PREFIX}{name}"))
    }

    fn get(&self, locator: &str) -> Result<Option<SecretString>, String> {
        let name = locator_name(locator, LOCATOR_MEMORY_PREFIX)?;
        Ok(self
            .secrets
            .lock()
            .unwrap()
            .get(name)
            .map(|value| SecretString::from(value.clone())))
    }

    fn delete(&self, locator: &str) -> Result<(), String> {
        let name = locator_name(locator, LOCATOR_MEMORY_PREFIX)?;
        self.secrets.lock().unwrap().remove(name);
        Ok(())
    }
}

/// The production credential stack: OS keyring first; the vault only when
/// it exists AND unlocks (opt-in headless). `resolve` dispatches on the
/// locator scheme so mixed journals keep working after a backend switch.
pub struct CredentialStack {
    pub os: OsKeyringStore,
    pub vault: VaultCredentialStore,
}

impl CredentialStack {
    pub fn new() -> Self {
        let stack = CredentialStack {
            os: OsKeyringStore,
            vault: VaultCredentialStore::new(),
        };
        let _ = stack.vault.try_unlock_from_environment();
        stack
    }

    /// Overall health for capability reporting (§8): healthy when the
    /// preferred writable backend is healthy; locked when a vault exists but
    /// is locked and the OS store is unusable; unavailable otherwise.
    pub fn health(&self) -> CredentialStoreHealth {
        match self.os.health() {
            CredentialStoreHealth::Healthy => CredentialStoreHealth::Healthy,
            os_health => match self.vault.health() {
                CredentialStoreHealth::Healthy => CredentialStoreHealth::Healthy,
                CredentialStoreHealth::Locked => CredentialStoreHealth::Locked,
                CredentialStoreHealth::Unavailable => os_health,
            },
        }
    }

    /// Store under the preferred backend, returning the locator.
    pub fn store(&self, name: &str, value: &SecretString) -> Result<String, String> {
        if self.os.health() == CredentialStoreHealth::Healthy {
            return self.os.set(name, value);
        }
        if self.vault.health() == CredentialStoreHealth::Healthy {
            return self.vault.set(name, value);
        }
        Err(
            "no usable credential store: OS store unavailable and vault locked or absent"
                .to_string(),
        )
    }

    pub fn resolve(&self, locator: &str) -> Result<Option<SecretString>, String> {
        if locator.starts_with(LOCATOR_KEYCHAIN_PREFIX) {
            self.os.get(locator)
        } else if locator.starts_with(LOCATOR_VAULT_PREFIX) {
            self.vault.get(locator)
        } else {
            Err(format!("unknown credential locator scheme: {locator}"))
        }
    }

    pub fn delete(&self, locator: &str) -> Result<(), String> {
        if locator.starts_with(LOCATOR_KEYCHAIN_PREFIX) {
            self.os.delete(locator)
        } else if locator.starts_with(LOCATOR_VAULT_PREFIX) {
            self.vault.delete(locator)
        } else {
            Err(format!("unknown credential locator scheme: {locator}"))
        }
    }
}

impl Default for CredentialStack {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretResolver for CredentialStack {
    fn resolve_locator(&self, locator: &str) -> Result<Option<SecretString>, String> {
        self.resolve(locator)
    }
}

/// Non-blocking cached credential-store health for hot paths (the device
/// profile is rebuilt on every presence/ack payload — it must NEVER wait on
/// a Keychain round-trip). Returns the last probed value immediately and
/// refreshes on a detached thread when stale (60s TTL). Reports
/// `unavailable` until the first probe lands; the authoritative value rides
/// `email_sender_capabilities_sync`, which probes synchronously off the hot
/// path.
pub fn cached_store_health() -> CredentialStoreHealth {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    const TTL: Duration = Duration::from_secs(60);
    static STATE: Mutex<Option<(Instant, CredentialStoreHealth)>> = Mutex::new(None);
    static PROBING: AtomicBool = AtomicBool::new(false);

    let cached = STATE.lock().ok().and_then(|guard| *guard);
    let (stale, value) = match cached {
        Some((at, value)) => (at.elapsed() > TTL, value),
        None => (true, CredentialStoreHealth::Unavailable),
    };
    if stale && !PROBING.swap(true, Ordering::SeqCst) {
        std::thread::spawn(move || {
            let health = CredentialStack::new().health();
            if let Ok(mut guard) = STATE.lock() {
                *guard = Some((Instant::now(), health));
            }
            PROBING.store(false, Ordering::SeqCst);
        });
    }
    value
}

impl SecretResolver for MemoryCredentialStore {
    fn resolve_locator(&self, locator: &str) -> Result<Option<SecretString>, String> {
        self.get(locator)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trip_and_locator_scoping() {
        let store = MemoryCredentialStore::new();
        let locator = store
            .set("profile-1", &SecretString::from("secret-value"))
            .unwrap();
        assert_eq!(locator, format!("{LOCATOR_MEMORY_PREFIX}profile-1"));
        use secrecy::ExposeSecret;
        assert_eq!(
            store.get(&locator).unwrap().unwrap().expose_secret(),
            "secret-value"
        );
        assert!(store.get("keychain://diffforge/email/profile-1").is_err());
        store.delete(&locator).unwrap();
        assert!(store.get(&locator).unwrap().is_none());
    }

    #[test]
    fn vault_store_reports_locked_states() {
        let store = VaultCredentialStore::new();
        // No vault file + no unlock: setting must fail, never plaintext.
        assert!(store
            .set("profile-1", &SecretString::from("secret"))
            .is_err());
    }
}
