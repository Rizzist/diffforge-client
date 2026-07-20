//! DKIM key generation + signing for native delivery (plan §3.8):
//! RSA-2048 primary, staged selector rotation (active|next|retired), and the
//! journal-held private key resolved by locator. mail-auth performs the
//! signing and the round-trip verification; the `rsa` crate generates the
//! keypair.
//!
//! The journal stores the PUBLIC fingerprint + locator only (§10.1); the
//! private key material lives in the credential store like every other
//! secret.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use mail_auth::common::crypto::{RsaKey, Sha256};
use mail_auth::common::headers::HeaderWriter;
use mail_auth::dkim::DkimSigner;
use rsa::pkcs1::{EncodeRsaPrivateKey, EncodeRsaPublicKey};
use rsa::pkcs8::EncodePublicKey;
use rsa::traits::PublicKeyParts;
use rsa::RsaPrivateKey;
use secrecy::{ExposeSecret, SecretString};
use sha2::Digest;

pub const DKIM_RSA_BITS: usize = 2048;

/// A freshly generated DKIM keypair. The private PEM is a secret; the public
/// TXT record + fingerprint are publishable.
pub struct GeneratedDkimKey {
    /// PKCS#1 PEM of the private key — store via the credential stack.
    pub private_key_pem: SecretString,
    /// The `p=` base64 of the SubjectPublicKeyInfo (what goes in the TXT
    /// record value `v=DKIM1; k=rsa; p=...`).
    pub public_key_b64: String,
    /// SHA-256 fingerprint (lowercase hex) of the SPKI DER — journaled and
    /// re-checked before native DATA (§10.2 dkim key check).
    pub pubkey_fingerprint_sha256: String,
    /// The full TXT record value ready to display in the DNS wizard.
    pub dns_txt_value: String,
}

/// Generate an RSA-2048 DKIM keypair. CPU-bound; callers run it off the hot
/// path.
pub fn generate_rsa_dkim_key() -> Result<GeneratedDkimKey, String> {
    let mut rng = rand_from_getrandom()?;
    let private = RsaPrivateKey::new(&mut rng, DKIM_RSA_BITS)
        .map_err(|error| format!("dkim key generation failed: {error}"))?;
    let private_pem = private
        .to_pkcs1_pem(rsa::pkcs1::LineEnding::LF)
        .map_err(|error| format!("dkim private pem failed: {error}"))?
        .to_string();
    let public = private.to_public_key();
    let spki_der = public
        .to_public_key_der()
        .map_err(|error| format!("dkim spki der failed: {error}"))?;
    let public_key_b64 = BASE64.encode(spki_der.as_bytes());
    let fingerprint = sha2::Sha256::digest(spki_der.as_bytes());
    let fingerprint_hex = fingerprint
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    // Touch the PKCS#1 public encoder so a future ed25519 dual-sign path has
    // the symmetric helper wired; also validates the key is well-formed.
    let _ = public
        .to_pkcs1_der()
        .map_err(|error| format!("dkim pkcs1 public der failed: {error}"))?;
    let _ = public.size();
    Ok(GeneratedDkimKey {
        private_key_pem: SecretString::from(private_pem),
        dns_txt_value: format!("v=DKIM1; k=rsa; p={public_key_b64}"),
        public_key_b64,
        pubkey_fingerprint_sha256: fingerprint_hex,
    })
}

fn rand_from_getrandom() -> Result<rsa::rand_core::OsRng, String> {
    // rsa re-exports rand_core; OsRng pulls from the OS CSPRNG (same source
    // as getrandom). A dependency on a separate rand crate is avoided.
    Ok(rsa::rand_core::OsRng)
}

/// The fingerprint of an existing private key PEM — used to re-check the
/// journaled fingerprint matches local material before native DATA (§10.2).
pub fn fingerprint_of_private_pem(private_key_pem: &str) -> Result<String, String> {
    use rsa::pkcs1::DecodeRsaPrivateKey;
    let private = RsaPrivateKey::from_pkcs1_pem(private_key_pem)
        .map_err(|error| format!("dkim private pem parse failed: {error}"))?;
    let spki_der = private
        .to_public_key()
        .to_public_key_der()
        .map_err(|error| format!("dkim spki der failed: {error}"))?;
    let fingerprint = sha2::Sha256::digest(spki_der.as_bytes());
    Ok(fingerprint
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Sign a message with the journal-held private key and return the message
/// with the `DKIM-Signature:` header prepended (relaxed/relaxed, the h=
/// header set covers From/To/Subject/Date/Message-ID).
pub fn sign_message(
    private_key_pem: &SecretString,
    domain: &str,
    selector: &str,
    message: &[u8],
) -> Result<Vec<u8>, String> {
    let key = RsaKey::<Sha256>::from_pkcs1_pem(private_key_pem.expose_secret())
        .map_err(|error| format!("dkim signing key load failed: {error}"))?;
    let signer = DkimSigner::from_key(key)
        .domain(domain.to_string())
        .selector(selector.to_string())
        .headers([
            "From",
            "To",
            "Cc",
            "Subject",
            "Date",
            "Message-ID",
            "MIME-Version",
            "Content-Type",
        ]);
    let signature = signer
        .sign(message)
        .map_err(|error| format!("dkim signing failed: {error}"))?;
    let header = signature.to_header();
    let mut signed = header.into_bytes();
    signed.extend_from_slice(message);
    Ok(signed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mail_auth::common::verify::VerifySignature;

    #[test]
    fn generate_key_produces_stable_fingerprint() {
        let key = generate_rsa_dkim_key().unwrap();
        assert!(key.public_key_b64.len() > 300, "spki base64 present");
        assert_eq!(key.pubkey_fingerprint_sha256.len(), 64);
        assert!(key.dns_txt_value.starts_with("v=DKIM1; k=rsa; p="));
        let recomputed = fingerprint_of_private_pem(key.private_key_pem.expose_secret()).unwrap();
        assert_eq!(recomputed, key.pubkey_fingerprint_sha256);
    }

    #[test]
    fn sign_prepends_dkim_signature_header() {
        let key = generate_rsa_dkim_key().unwrap();
        let message = b"From: ops@acme.example\r\nTo: rcpt@partner.example\r\nSubject: hi\r\nDate: Mon, 20 Jul 2026 00:00:00 +0000\r\nMessage-ID: <1@acme.example>\r\n\r\nbody\r\n";
        let signed = sign_message(&key.private_key_pem, "acme.example", "dfmail1", message).unwrap();
        let text = String::from_utf8_lossy(&signed);
        assert!(text.starts_with("DKIM-Signature:"));
        assert!(text.contains("d=acme.example"));
        assert!(text.contains("s=dfmail1"));
        assert!(text.contains("a=rsa-sha256"));
    }

    // Full round-trip: sign, then verify with mail-auth's DKIM verifier
    // against the generated public key seeded into the resolver cache — no
    // DNS is touched (the cache is checked before any lookup).
    #[test]
    fn dkim_sign_then_mail_auth_verifier_passes() {
        use std::borrow::Borrow;
        use std::collections::HashMap;
        use std::hash::Hash;
        use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
        use std::sync::{Arc, Mutex};
        use std::time::Instant;

        use mail_auth::common::parse::TxtRecordParser;
        use mail_auth::common::verify::DomainKey;
        use mail_auth::hickory_resolver::config::{ResolverConfig, ResolverOpts};
        use mail_auth::{
            AuthenticatedMessage, DkimResult, MessageAuthenticator, Parameters, ResolverCache,
            Txt, MX,
        };

        struct SeededCache<K, V>(Mutex<HashMap<K, V>>);
        impl<K: Eq + Hash, V: Clone> ResolverCache<K, V> for SeededCache<K, V> {
            fn get<Q>(&self, name: &Q) -> Option<V>
            where
                K: Borrow<Q>,
                Q: Hash + Eq + ?Sized,
            {
                self.0.lock().unwrap().get(name).cloned()
            }
            fn remove<Q>(&self, name: &Q) -> Option<V>
            where
                K: Borrow<Q>,
                Q: Hash + Eq + ?Sized,
            {
                self.0.lock().unwrap().remove(name)
            }
            fn insert(&self, key: K, value: V, _valid_until: Instant) {
                self.0.lock().unwrap().insert(key, value);
            }
        }

        let key = generate_rsa_dkim_key().unwrap();
        let message = b"From: Acme Ops <ops@acme.example>\r\nTo: billing@partner.example\r\nSubject: round trip\r\nDate: Mon, 20 Jul 2026 00:00:00 +0000\r\nMessage-ID: <rt@acme.example>\r\n\r\nround trip body\r\n";
        let signed = sign_message(&key.private_key_pem, "acme.example", "dfmail1", message).unwrap();

        let authenticated = AuthenticatedMessage::parse(&signed).expect("message parses");
        let domain_key =
            DomainKey::parse(key.dns_txt_value.as_bytes()).expect("domain key parses");
        let txt_cache: SeededCache<String, Txt> = SeededCache(Mutex::new(HashMap::new()));
        let record = Txt::DomainKey(Arc::new(domain_key));
        // txt_lookup keys are lowercased FQDNs with a trailing dot; seed both
        // forms so the cache hit is unambiguous.
        txt_cache.insert(
            "dfmail1._domainkey.acme.example.".to_string(),
            record.clone(),
            Instant::now() + std::time::Duration::from_secs(600),
        );
        txt_cache.insert(
            "dfmail1._domainkey.acme.example".to_string(),
            record,
            Instant::now() + std::time::Duration::from_secs(600),
        );

        let authenticator =
            MessageAuthenticator::new(ResolverConfig::cloudflare(), ResolverOpts::default())
                .expect("authenticator builds");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let outputs = runtime.block_on(authenticator.verify_dkim(Parameters {
            params: &authenticated,
            cache_txt: Some(&txt_cache),
            cache_mx: None::<&SeededCache<String, Arc<Vec<MX>>>>,
            cache_ptr: None::<&SeededCache<IpAddr, Arc<Vec<String>>>>,
            cache_ipv4: None::<&SeededCache<String, Arc<Vec<Ipv4Addr>>>>,
            cache_ipv6: None::<&SeededCache<String, Arc<Vec<Ipv6Addr>>>>,
        }));
        assert!(!outputs.is_empty(), "one DKIM signature evaluated");
        assert!(
            outputs
                .iter()
                .any(|output| matches!(output.result(), DkimResult::Pass)),
            "mail-auth verifier must pass the round trip: {:?}",
            outputs.iter().map(|output| output.result()).collect::<Vec<_>>()
        );

        // Negative control: a tampered body must not verify.
        let mut tampered = signed.clone();
        let body_at = tampered.len() - 6;
        tampered[body_at] ^= 0x01;
        let tampered_message = AuthenticatedMessage::parse(&tampered).expect("tampered parses");
        let outputs = runtime.block_on(authenticator.verify_dkim(Parameters {
            params: &tampered_message,
            cache_txt: Some(&txt_cache),
            cache_mx: None::<&SeededCache<String, Arc<Vec<MX>>>>,
            cache_ptr: None::<&SeededCache<IpAddr, Arc<Vec<String>>>>,
            cache_ipv4: None::<&SeededCache<String, Arc<Vec<Ipv4Addr>>>>,
            cache_ipv6: None::<&SeededCache<String, Arc<Vec<Ipv6Addr>>>>,
        }));
        assert!(
            !outputs
                .iter()
                .any(|output| matches!(output.result(), DkimResult::Pass)),
            "tampered body must fail verification"
        );
    }

    #[test]
    fn signed_header_parses_back_to_a_signature() {
        use mail_auth::dkim::Signature;
        let key = generate_rsa_dkim_key().unwrap();
        let message = b"From: ops@acme.example\r\nSubject: hi\r\nDate: Mon, 20 Jul 2026 00:00:00 +0000\r\n\r\nhello world\r\n";
        let signed = sign_message(&key.private_key_pem, "acme.example", "dfmail1", message).unwrap();
        let header_line: String = String::from_utf8_lossy(&signed)
            .lines()
            .take_while(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\r\n");
        let value = header_line
            .strip_prefix("DKIM-Signature:")
            .unwrap()
            .trim_start();
        let parsed = Signature::parse(value.as_bytes()).expect("signature parses");
        assert_eq!(parsed.domain(), "acme.example");
        assert!(!parsed.signature().is_empty());
    }
}
