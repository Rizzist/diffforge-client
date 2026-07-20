//! Cloud transport for the device email stack (contract §8/§9): typed
//! `email_send_prepare` / `email_send_lease_renew` / `email_send_resume` /
//! `email_sender_capabilities_sync` calls over the shared app websocket, the
//! prepared-transfer MIME download, and settlement events through the
//! durable outbox with `(send_job_id, generation, status_event_id)`
//! idempotency.
//!
//! Everything is behind `EmailCloudTransport` so the submission and native
//! delivery state machines run against a scripted fake in tests (the track
//! rule: no live infrastructure anywhere near cargo test).

use std::time::Duration;

use serde_json::{json, Value};

use super::contract::{self, is_known_refusal_slug, u64_from_wire};
use super::mime::{EnvelopeRecipient, PrepareEnvelope};

#[derive(Clone, Debug)]
pub struct NativeGrant {
    pub dkim_domain: String,
    pub dkim_selector: String,
    pub dkim_pubkey_fingerprint: String,
    pub ehlo: String,
    pub authorized_ips: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct PrepareGrant {
    pub lease_id: String,
    pub lease_epoch: u64,
    /// Memory-only by contract (§8) — never journaled, never logged.
    pub fence_token: String,
    pub expires_at_ms: i64,
    pub mime_transfer_id: String,
    pub mime_path: String,
    pub mime_sha256: String,
    pub mime_size_bytes: u64,
    pub envelope: PrepareEnvelope,
    pub identity_id: String,
    pub identity_address: String,
    pub mode: String,
    pub native: Option<NativeGrant>,
}

#[derive(Clone, Debug)]
pub enum PrepareOutcome {
    Leased(Box<PrepareGrant>),
    /// Closed-registry refusal slug (§0.4). Unknown slugs fail closed at
    /// parse time and never reach here.
    Refused {
        slug: String,
    },
}

#[derive(Clone, Debug)]
pub enum RenewOutcome {
    Extended {
        expires_at_ms: i64,
    },
    Refused {
        slug: String,
        current_lease_epoch: Option<u64>,
    },
}

pub trait EmailCloudTransport: Send + Sync {
    fn prepare(
        &self,
        send_job_id: &str,
        generation: u32,
        command_id: &str,
        binding_id: &str,
        last_lease_epoch: u64,
    ) -> Result<PrepareOutcome, String>;

    fn lease_renew(
        &self,
        send_job_id: &str,
        generation: u32,
        lease_id: &str,
        lease_epoch: u64,
        fence_token: &str,
        phase: &str,
    ) -> Result<RenewOutcome, String>;

    fn download_mime(&self, path: &str, transfer_id: &str) -> Result<Vec<u8>, String>;

    /// Hand a §9.2 send event to the durable outbox (idempotent on
    /// `(send_job_id, generation, status_event_id)`).
    fn emit_send_event(&self, payload: &Value) -> Result<(), String>;
}

/// Parse the §0.4 mutation-envelope `data` of an email_send_prepare
/// response. Fail-closed everywhere: unknown refusal slugs, missing grant
/// fields, and number-encoded u64s are errors.
pub fn parse_prepare_data(data: &Value) -> Result<PrepareOutcome, String> {
    let result = data
        .get("result")
        .ok_or_else(|| "prepare response missing result".to_string())?;
    if let Some(slug) = result.get("refusal").and_then(Value::as_str) {
        if !is_known_refusal_slug(slug) {
            return Err(format!("prepare refusal slug fails closed: {slug}"));
        }
        return Ok(PrepareOutcome::Refused {
            slug: slug.to_string(),
        });
    }
    let status = result.get("status").and_then(Value::as_str).unwrap_or("");
    if status != "leased" {
        return Err(format!("prepare result status fails closed: {status}"));
    }
    let lease = result
        .get("lease")
        .ok_or_else(|| "prepare grant missing lease".to_string())?;
    let mime = result
        .get("mime")
        .ok_or_else(|| "prepare grant missing mime descriptor".to_string())?;
    let envelope = result
        .get("envelope")
        .ok_or_else(|| "prepare grant missing envelope".to_string())?;
    let identity = result
        .get("identity")
        .ok_or_else(|| "prepare grant missing identity".to_string())?;
    let text = |value: &Value, key: &str| -> Result<String, String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("prepare grant missing {key}"))
    };
    let mode = text(result, "mode")?;
    if mode != "provider" && mode != "native" {
        return Err(format!("prepare mode fails closed: {mode}"));
    }
    let native = if let Some(native) = result.get("native") {
        Some(NativeGrant {
            dkim_domain: text(native, "dkim_domain")?,
            dkim_selector: text(native, "dkim_selector")?,
            dkim_pubkey_fingerprint: text(native, "dkim_pubkey_fingerprint")?,
            ehlo: text(native, "ehlo")?,
            authorized_ips: native
                .get("authorized_ips")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        })
    } else {
        None
    };
    if mode == "native" && native.is_none() {
        return Err("native prepare grant missing native block".to_string());
    }
    let recipients = envelope
        .get("recipients")
        .and_then(Value::as_array)
        .ok_or_else(|| "prepare envelope missing recipients".to_string())?
        .iter()
        .map(|recipient| {
            Ok(EnvelopeRecipient {
                recipient_ref: text(recipient, "recipient_ref")?,
                role: {
                    let role = text(recipient, "role")?;
                    if role != "to" && role != "cc" && role != "bcc" {
                        return Err(format!("envelope role fails closed: {role}"));
                    }
                    role
                },
                address: text(recipient, "address")?,
                domain: text(recipient, "domain")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(PrepareOutcome::Leased(Box::new(PrepareGrant {
        lease_id: text(lease, "lease_id")?,
        lease_epoch: u64_from_wire(
            lease
                .get("lease_epoch")
                .ok_or_else(|| "prepare lease missing lease_epoch".to_string())?,
        )?,
        fence_token: text(lease, "fence_token")?,
        expires_at_ms: lease
            .get("expires_at_ms")
            .and_then(Value::as_i64)
            .ok_or_else(|| "prepare lease missing expires_at_ms".to_string())?,
        mime_transfer_id: text(mime, "transfer_id")?,
        mime_path: text(mime, "path")?,
        mime_sha256: text(mime, "sha256")?,
        mime_size_bytes: mime
            .get("size_bytes")
            .and_then(Value::as_u64)
            .ok_or_else(|| "prepare mime missing size_bytes".to_string())?,
        envelope: PrepareEnvelope {
            mail_from: text(envelope, "mail_from")?,
            recipients,
        },
        identity_id: text(identity, "identity_id")?,
        identity_address: text(identity, "address")?,
        mode,
        native,
    })))
}

/// Parse an email_send_lease_renew response `data` (plain, non-mutation).
pub fn parse_renew_data(data: &Value) -> Result<RenewOutcome, String> {
    if let Some(slug) = data.get("refusal").and_then(Value::as_str) {
        if !matches!(slug, "fenced" | "cancelled" | "superseded") {
            return Err(format!("lease renew refusal fails closed: {slug}"));
        }
        let current_lease_epoch = match data.get("current_lease_epoch") {
            Some(value) => Some(u64_from_wire(value)?),
            None => None,
        };
        return Ok(RenewOutcome::Refused {
            slug: slug.to_string(),
            current_lease_epoch,
        });
    }
    let expires_at_ms = data
        .get("expires_at_ms")
        .and_then(Value::as_i64)
        .ok_or_else(|| "lease renew response missing expires_at_ms".to_string())?;
    Ok(RenewOutcome::Extended { expires_at_ms })
}

/// Outbox idempotency key for a send event (§0.4 settlement identity).
pub fn send_event_idempotency_key(
    send_job_id: &str,
    generation: u32,
    status_event_id: &str,
) -> String {
    format!("email-send-event:{send_job_id}:{generation}:{status_event_id}")
}

/// Production transport over the shared app websocket + durable outbox.
/// Methods are synchronous by design: the send worker runs on a blocking
/// thread and parks on the async runtime only for the round-trip itself.
pub struct WsCloudTransport {
    pub state: crate::CloudMcpState,
}

const EMAIL_WS_TIMEOUT: Duration = Duration::from_secs(20);

impl WsCloudTransport {
    fn ws_request(&self, request_kind: &str, payload: Value) -> Result<Value, String> {
        let state = self.state.clone();
        let kind = request_kind.to_string();
        tauri::async_runtime::block_on(async move {
            crate::cloud_mcp_ws_request_with_timeout(&state, &kind, &payload, EMAIL_WS_TIMEOUT)
                .await
        })
    }
}

impl EmailCloudTransport for WsCloudTransport {
    fn prepare(
        &self,
        send_job_id: &str,
        generation: u32,
        command_id: &str,
        binding_id: &str,
        last_lease_epoch: u64,
    ) -> Result<PrepareOutcome, String> {
        let response = self.ws_request(
            "email_send_prepare",
            json!({
                "contract": contract::EMAIL_CONTRACT,
                "schema_version": contract::EMAIL_SCHEMA_VERSION,
                "send_job_id": send_job_id,
                "generation": generation,
                "command_id": command_id,
                "binding_id": binding_id,
                "last_lease_epoch": contract::u64_to_wire(last_lease_epoch),
                "client_request_id": uuid::Uuid::now_v7().to_string(),
            }),
        )?;
        let data = response
            .get("data")
            .ok_or_else(|| "prepare response missing data".to_string())?;
        parse_prepare_data(data)
    }

    fn lease_renew(
        &self,
        send_job_id: &str,
        generation: u32,
        lease_id: &str,
        lease_epoch: u64,
        fence_token: &str,
        phase: &str,
    ) -> Result<RenewOutcome, String> {
        let response = self.ws_request(
            "email_send_lease_renew",
            json!({
                "contract": contract::EMAIL_CONTRACT,
                "schema_version": contract::EMAIL_SCHEMA_VERSION,
                "send_job_id": send_job_id,
                "generation": generation,
                "lease_id": lease_id,
                "lease_epoch": contract::u64_to_wire(lease_epoch),
                "fence_token": fence_token,
                "phase": phase,
            }),
        )?;
        let data = response
            .get("data")
            .ok_or_else(|| "lease renew response missing data".to_string())?;
        parse_renew_data(data)
    }

    fn download_mime(&self, path: &str, _transfer_id: &str) -> Result<Vec<u8>, String> {
        let url = if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else {
            crate::api_endpoint(path)
        };
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|error| format!("mime download client failed: {error}"))?
            .get(&url)
            .send()
            .map_err(|error| format!("mime download request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("mime download returned {}", response.status()));
        }
        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(|error| format!("mime download body failed: {error}"))
    }

    fn emit_send_event(&self, payload: &Value) -> Result<(), String> {
        let send_job_id = payload
            .get("send_job_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        // Generation is REQUIRED, bounded u32, and starts at 1 (§1): a
        // missing, zero, or out-of-range value must never silently default
        // or wrap — that would mint a different idempotency identity than
        // the payload.
        let generation = payload
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| "send event payload missing generation".to_string())
            .and_then(super::remote::checked_generation)?;
        let status_event_id = payload
            .get("status_event_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if send_job_id.is_empty() || status_event_id.is_empty() {
            return Err("send event payload missing identity".to_string());
        }
        let idempotency_key =
            send_event_idempotency_key(&send_job_id, generation, &status_event_id);
        let mut outbox_payload = payload.clone();
        if let Some(object) = outbox_payload.as_object_mut() {
            // The outbox reads `idempotency_key` as its durable dedup key —
            // (send_job_id, generation, status_event_id) per §0.4.
            object.insert(
                "idempotency_key".to_string(),
                json!(idempotency_key.clone()),
            );
        }
        let state = self.state.clone();
        tauri::async_runtime::block_on(async move {
            crate::cloud_mcp_enqueue_background_sync(
                &state,
                idempotency_key,
                contract::EMAIL_SEND_EVENT_KIND,
                outbox_payload,
                crate::cloud_mcp_outbox_priority_for_event(contract::EMAIL_SEND_EVENT_KIND),
                "email_send_event",
            )
            .await;
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures_dir() -> Option<std::path::PathBuf> {
        crate::email::test_fixtures_dir()
    }

    #[test]
    fn parse_prepare_fixtures() {
        let Some(dir) = fixtures_dir() else {
            eprintln!("email-v1 fixtures unavailable; skipping");
            return;
        };
        let leased: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("prepare__email_send_prepare__leased.json")).unwrap(),
        )
        .unwrap();
        let data = &leased["payload"]["response"]["data"];
        match parse_prepare_data(data).unwrap() {
            PrepareOutcome::Leased(grant) => {
                assert_eq!(grant.mode, "native");
                assert_eq!(grant.lease_epoch, 1);
                assert_eq!(grant.envelope.recipients.len(), 1);
                assert!(grant.native.is_some());
                assert_eq!(grant.mime_size_bytes, 51234);
            }
            other => panic!("expected leased, got {other:?}"),
        }

        for (fixture, slug) in [
            ("prepare__email_send_prepare__superseded.json", "superseded"),
            (
                "prepare__email_send_prepare__credential_required.json",
                "credential_required",
            ),
        ] {
            let value: Value =
                serde_json::from_str(&std::fs::read_to_string(dir.join(fixture)).unwrap()).unwrap();
            match parse_prepare_data(&value["payload"]["response"]["data"]).unwrap() {
                PrepareOutcome::Refused { slug: parsed } => assert_eq!(parsed, slug),
                other => panic!("expected refusal, got {other:?}"),
            }
        }
    }

    #[test]
    fn parse_renew_fixtures() {
        let Some(dir) = fixtures_dir() else {
            eprintln!("email-v1 fixtures unavailable; skipping");
            return;
        };
        let happy: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("requests__email_send_lease_renew__happy.json"))
                .unwrap(),
        )
        .unwrap();
        match parse_renew_data(&happy["payload"]["response"]["data"]).unwrap() {
            RenewOutcome::Extended { expires_at_ms } => assert_eq!(expires_at_ms, 1784900230500),
            other => panic!("expected extended, got {other:?}"),
        }
        let fenced: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("requests__email_send_lease_renew__fenced.json"))
                .unwrap(),
        )
        .unwrap();
        match parse_renew_data(&fenced["payload"]["response"]["data"]).unwrap() {
            RenewOutcome::Refused {
                slug,
                current_lease_epoch,
            } => {
                assert_eq!(slug, "fenced");
                assert_eq!(current_lease_epoch, Some(2));
            }
            other => panic!("expected fenced, got {other:?}"),
        }
    }

    #[test]
    fn unknown_prepare_refusal_fails_closed() {
        let data = json!({
            "contract": "diffforge.email.v1",
            "schema_version": 1,
            "result": { "refusal": "mystery" }
        });
        assert!(parse_prepare_data(&data).is_err());
    }

    #[test]
    fn number_encoded_lease_epoch_fails_closed() {
        let data = json!({
            "contract": "diffforge.email.v1",
            "schema_version": 1,
            "result": {
                "status": "leased",
                "lease": {
                    "lease_id": "l1",
                    "lease_epoch": 1,
                    "fence_token": "f",
                    "expires_at_ms": 1
                },
                "mime": {"transfer_id": "t", "path": "/x", "sha256": "s", "size_bytes": 1},
                "envelope": {"mail_from": "a@b.c", "recipients": []},
                "identity": {"identity_id": "i", "display_name": "d", "address": "a@b.c"},
                "mode": "provider"
            }
        });
        assert!(parse_prepare_data(&data).is_err());
    }
}
