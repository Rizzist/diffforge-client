//! Headless encrypted credential vault (plan §3.8): opt-in fallback for
//! machines without a usable OS credential store. Argon2id KDF over a
//! user-supplied passphrase + XChaCha20-Poly1305 AEAD, written 0600 via an
//! atomic temp-file rename. Key material is zeroized on drop; the plaintext
//! JSON never touches disk.
//!
//! Unlock sources (checked in order, headless-friendly):
//! 1. `DIFFFORGE_EMAIL_VAULT_PASSPHRASE` env var;
//! 2. a passphrase file named by `DIFFFORGE_EMAIL_VAULT_PASSPHRASE_FILE`;
//! 3. systemd `LoadCredential` (`$CREDENTIALS_DIRECTORY/diffforge-email-vault`).
//! The CLI additionally prompts on a TTY (see cli.rs).

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use secrecy::{ExposeSecret, SecretString};
use serde_json::{json, Value};
use zeroize::Zeroize;

pub const VAULT_FILE: &str = "email-credential-vault.json";
const VAULT_VERSION: u64 = 1;
const ARGON2_M_COST_KIB: u32 = 64 * 1024;
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 1;

pub fn vault_default_path() -> Option<PathBuf> {
    crate::cloud_mcp_local_data_file_path(VAULT_FILE)
}

/// Resolve the vault passphrase from the headless unlock sources. Returns
/// None when no source is configured (the vault then reports `locked`).
pub fn vault_passphrase_from_environment() -> Option<SecretString> {
    if let Ok(value) = std::env::var("DIFFFORGE_EMAIL_VAULT_PASSPHRASE") {
        if !value.is_empty() {
            return Some(SecretString::from(value));
        }
    }
    if let Ok(path) = std::env::var("DIFFFORGE_EMAIL_VAULT_PASSPHRASE_FILE") {
        if let Ok(mut contents) = std::fs::read_to_string(path) {
            let trimmed = contents.trim().to_string();
            contents.zeroize();
            if !trimmed.is_empty() {
                return Some(SecretString::from(trimmed));
            }
        }
    }
    if let Ok(dir) = std::env::var("CREDENTIALS_DIRECTORY") {
        let path = Path::new(&dir).join("diffforge-email-vault");
        if let Ok(mut contents) = std::fs::read_to_string(path) {
            let trimmed = contents.trim().to_string();
            contents.zeroize();
            if !trimmed.is_empty() {
                return Some(SecretString::from(trimmed));
            }
        }
    }
    None
}

fn derive_key(passphrase: &SecretString, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(ARGON2_M_COST_KIB, ARGON2_T_COST, ARGON2_P_COST, Some(32))
        .map_err(|error| format!("vault argon2 params invalid: {error}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.expose_secret().as_bytes(), salt, &mut key)
        .map_err(|error| format!("vault key derivation failed: {error}"))?;
    Ok(key)
}

fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0u8; len];
    getrandom::getrandom(&mut bytes).map_err(|error| format!("vault rng failed: {error}"))?;
    Ok(bytes)
}

/// Atomic 0600 write: temp file in the same directory, permissions set
/// before content, fsync, rename over the target.
fn write_atomic_0600(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "vault path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| format!("vault dir create failed: {error}"))?;
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "vault".to_string()),
        std::process::id()
    ));
    {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temp)
            .map_err(|error| format!("vault temp open failed: {error}"))?;
        file.write_all(contents)
            .map_err(|error| format!("vault temp write failed: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("vault temp sync failed: {error}"))?;
    }
    std::fs::rename(&temp, path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("vault rename failed: {error}")
    })
}

/// An unlocked vault: a name→secret map held in memory, zeroized on drop.
pub struct EncryptedVault {
    path: PathBuf,
    passphrase: SecretString,
    secrets: BTreeMap<String, String>,
}

impl Drop for EncryptedVault {
    fn drop(&mut self) {
        for (_, value) in self.secrets.iter_mut() {
            value.zeroize();
        }
    }
}

impl EncryptedVault {
    pub fn exists_at(path: &Path) -> bool {
        path.is_file()
    }

    /// Create a new empty vault (refuses to clobber an existing one).
    pub fn create(path: &Path, passphrase: SecretString) -> Result<Self, String> {
        if path.exists() {
            return Err("vault already exists".to_string());
        }
        let vault = EncryptedVault {
            path: path.to_path_buf(),
            passphrase,
            secrets: BTreeMap::new(),
        };
        vault.persist()?;
        Ok(vault)
    }

    /// Open + decrypt an existing vault.
    pub fn unlock(path: &Path, passphrase: SecretString) -> Result<Self, String> {
        let raw =
            std::fs::read_to_string(path).map_err(|error| format!("vault read failed: {error}"))?;
        let envelope: Value = serde_json::from_str(&raw)
            .map_err(|error| format!("vault envelope corrupt: {error}"))?;
        let version = envelope.get("version").and_then(Value::as_u64).unwrap_or(0);
        if version != VAULT_VERSION {
            return Err(format!("vault version {version} unsupported"));
        }
        let salt = BASE64
            .decode(envelope.get("salt").and_then(Value::as_str).unwrap_or(""))
            .map_err(|error| format!("vault salt corrupt: {error}"))?;
        let nonce_bytes = BASE64
            .decode(envelope.get("nonce").and_then(Value::as_str).unwrap_or(""))
            .map_err(|error| format!("vault nonce corrupt: {error}"))?;
        let ciphertext = BASE64
            .decode(
                envelope
                    .get("ciphertext")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            )
            .map_err(|error| format!("vault ciphertext corrupt: {error}"))?;
        if nonce_bytes.len() != 24 {
            return Err("vault nonce length invalid".to_string());
        }
        let mut key = derive_key(&passphrase, &salt)?;
        let cipher = XChaCha20Poly1305::new((&key).into());
        let plaintext = cipher
            .decrypt(XNonce::from_slice(&nonce_bytes), ciphertext.as_ref())
            .map_err(|_| "vault unlock failed: wrong passphrase or corrupt file".to_string());
        key.zeroize();
        let mut plaintext = plaintext?;
        let parsed: Result<Value, _> = serde_json::from_slice(&plaintext);
        plaintext.zeroize();
        let parsed = parsed.map_err(|error| format!("vault payload corrupt: {error}"))?;
        let mut secrets = BTreeMap::new();
        if let Some(map) = parsed.get("secrets").and_then(Value::as_object) {
            for (name, value) in map {
                if let Some(text) = value.as_str() {
                    secrets.insert(name.clone(), text.to_string());
                }
            }
        }
        Ok(EncryptedVault {
            path: path.to_path_buf(),
            passphrase,
            secrets,
        })
    }

    fn persist(&self) -> Result<(), String> {
        let salt = random_bytes(16)?;
        let nonce_bytes = random_bytes(24)?;
        let mut key = derive_key(&self.passphrase, &salt)?;
        let cipher = XChaCha20Poly1305::new((&key).into());
        let mut plaintext = json!({ "secrets": self.secrets }).to_string().into_bytes();
        let ciphertext = cipher
            .encrypt(XNonce::from_slice(&nonce_bytes), plaintext.as_ref())
            .map_err(|_| "vault encryption failed".to_string());
        key.zeroize();
        plaintext.zeroize();
        let ciphertext = ciphertext?;
        let envelope = json!({
            "version": VAULT_VERSION,
            "kdf": {
                "algorithm": "argon2id",
                "m_cost_kib": ARGON2_M_COST_KIB,
                "t_cost": ARGON2_T_COST,
                "p_cost": ARGON2_P_COST,
            },
            "cipher": "xchacha20poly1305",
            "salt": BASE64.encode(&salt),
            "nonce": BASE64.encode(&nonce_bytes),
            "ciphertext": BASE64.encode(&ciphertext),
        });
        write_atomic_0600(&self.path, envelope.to_string().as_bytes())
    }

    pub fn get(&self, name: &str) -> Option<SecretString> {
        self.secrets
            .get(name)
            .map(|value| SecretString::from(value.clone()))
    }

    pub fn set(&mut self, name: &str, value: &SecretString) -> Result<(), String> {
        self.secrets
            .insert(name.to_string(), value.expose_secret().to_string());
        self.persist()
    }

    pub fn delete(&mut self, name: &str) -> Result<bool, String> {
        if let Some(mut removed) = self.secrets.remove(name) {
            removed.zeroize();
            self.persist()?;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn names(&self) -> Vec<String> {
        self.secrets.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "diffforge-email-vault-test-{}-{}",
            std::process::id(),
            uuid::Uuid::now_v7()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn vault_round_trip_and_wrong_passphrase() {
        let dir = temp_dir();
        let path = dir.join(VAULT_FILE);
        let mut vault = EncryptedVault::create(&path, SecretString::from("correct horse")).unwrap();
        vault
            .set("profile-a", &SecretString::from("app-password-123"))
            .unwrap();
        drop(vault);

        let reopened = EncryptedVault::unlock(&path, SecretString::from("correct horse")).unwrap();
        assert_eq!(
            reopened.get("profile-a").unwrap().expose_secret(),
            "app-password-123"
        );
        assert!(EncryptedVault::unlock(&path, SecretString::from("wrong")).is_err());

        // Ciphertext on disk never contains the secret.
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("app-password-123"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn vault_file_is_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let path = dir.join(VAULT_FILE);
        let _vault = EncryptedVault::create(&path, SecretString::from("pass")).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn vault_delete_and_refuse_clobber() {
        let dir = temp_dir();
        let path = dir.join(VAULT_FILE);
        let mut vault = EncryptedVault::create(&path, SecretString::from("pass")).unwrap();
        vault.set("x", &SecretString::from("y")).unwrap();
        assert!(vault.delete("x").unwrap());
        assert!(!vault.delete("x").unwrap());
        assert!(EncryptedVault::create(&path, SecretString::from("pass")).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
