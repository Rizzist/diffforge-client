//! Wire-contract constants, closed enums, and canonical-JSON helpers for
//! `diffforge.email.v1` (contract §§0, 5b, 6b, 9, 10).
//!
//! Everything here fails closed on unknown values (§0.3): parsing an
//! unrecognized phase, ack, refusal slug, response class, error class, or
//! preflight check id returns an error instead of a default.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub const EMAIL_CONTRACT: &str = "diffforge.email.v1";
pub const EMAIL_SCHEMA_VERSION: u64 = 1;

/// Device email capability version reported in the device profile and in
/// `email_sender_capabilities_sync`. The cloud suppresses `email_send` to
/// devices below its minimum (§9.5), so bumping this is how a device opts
/// into newer command shapes.
pub const EMAIL_CAPABILITY_VERSION: u64 = 1;

/// Wake + companion command kinds (§9.4).
pub const EMAIL_COMMAND_SEND: &str = "email_send";
pub const EMAIL_COMMAND_CREDENTIAL_PROBE: &str = "email_credential_probe";
pub const EMAIL_COMMAND_PREFLIGHT_RUN: &str = "email_preflight_run";
/// Cloud→device retirement ack kind (§9.4).
pub const EMAIL_GENERATION_RETIRED_KIND: &str = "email_generation_retired";
/// Device→cloud send ticker/settlement event kind (§9.2).
pub const EMAIL_SEND_EVENT_KIND: &str = "email_send_event";

/// §6b.2 device phase ladder. Ranks are monotonic per (send_job_id,
/// generation); `settled` is the only terminal phase and terminal is derived
/// (`phase == settled`) — there is no `terminal` bool anywhere.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SendPhase {
    Received,
    Prepared,
    LeaseHeld,
    Downloading,
    Verified,
    Connecting,
    MailFromSent,
    DataStarted,
    DataCompleted,
    Settled,
}

impl SendPhase {
    pub fn rank(self) -> u32 {
        match self {
            SendPhase::Received => 1,
            SendPhase::Prepared => 2,
            SendPhase::LeaseHeld => 3,
            SendPhase::Downloading => 4,
            SendPhase::Verified => 5,
            SendPhase::Connecting => 6,
            SendPhase::MailFromSent => 7,
            SendPhase::DataStarted => 8,
            SendPhase::DataCompleted => 9,
            SendPhase::Settled => 10,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SendPhase::Received => "received",
            SendPhase::Prepared => "prepared",
            SendPhase::LeaseHeld => "lease_held",
            SendPhase::Downloading => "downloading",
            SendPhase::Verified => "verified",
            SendPhase::Connecting => "connecting",
            SendPhase::MailFromSent => "mail_from_sent",
            SendPhase::DataStarted => "data_started",
            SendPhase::DataCompleted => "data_completed",
            SendPhase::Settled => "settled",
        }
    }

    /// Fail-closed parse (§0.3): unknown phases are an error, never a default.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "received" => Ok(SendPhase::Received),
            "prepared" => Ok(SendPhase::Prepared),
            "lease_held" => Ok(SendPhase::LeaseHeld),
            "downloading" => Ok(SendPhase::Downloading),
            "verified" => Ok(SendPhase::Verified),
            "connecting" => Ok(SendPhase::Connecting),
            "mail_from_sent" => Ok(SendPhase::MailFromSent),
            "data_started" => Ok(SendPhase::DataStarted),
            "data_completed" => Ok(SendPhase::DataCompleted),
            "settled" => Ok(SendPhase::Settled),
            other => Err(format!("unknown email send phase: {other}")),
        }
    }

    pub fn is_terminal(self) -> bool {
        self == SendPhase::Settled
    }

    pub const ALL: [SendPhase; 10] = [
        SendPhase::Received,
        SendPhase::Prepared,
        SendPhase::LeaseHeld,
        SendPhase::Downloading,
        SendPhase::Verified,
        SendPhase::Connecting,
        SendPhase::MailFromSent,
        SendPhase::DataStarted,
        SendPhase::DataCompleted,
        SendPhase::Settled,
    ];
}

/// Job-level terminal outcomes mirrored from the cloud send-job terminal set
/// (§6b.1) as journaled by the device.
pub const TERMINAL_OUTCOMES: [&str; 6] = [
    "submitted",
    "partially_submitted",
    "failed",
    "provider_rejected",
    "delivery_unknown",
    "cancelled",
];

/// §5b OutboundRecipientState.delivery_state closed enum.
pub const DELIVERY_STATES: [&str; 5] = [
    "pending",
    "submitted",
    "deferred",
    "bounced",
    "delivery_unknown",
];

/// §5b SanitizedResponse.response_class closed enum — the ONLY provider/SMTP
/// response representation that crosses the wire (§9.6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResponseClass {
    None,
    Accepted,
    Deferred,
    RejectedPermanent,
    RejectedTemporary,
    ConnectionFailed,
    TlsFailed,
    Timeout,
}

impl ResponseClass {
    pub fn as_str(self) -> &'static str {
        match self {
            ResponseClass::None => "none",
            ResponseClass::Accepted => "accepted",
            ResponseClass::Deferred => "deferred",
            ResponseClass::RejectedPermanent => "rejected_permanent",
            ResponseClass::RejectedTemporary => "rejected_temporary",
            ResponseClass::ConnectionFailed => "connection_failed",
            ResponseClass::TlsFailed => "tls_failed",
            ResponseClass::Timeout => "timeout",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "none" => Ok(ResponseClass::None),
            "accepted" => Ok(ResponseClass::Accepted),
            "deferred" => Ok(ResponseClass::Deferred),
            "rejected_permanent" => Ok(ResponseClass::RejectedPermanent),
            "rejected_temporary" => Ok(ResponseClass::RejectedTemporary),
            "connection_failed" => Ok(ResponseClass::ConnectionFailed),
            "tls_failed" => Ok(ResponseClass::TlsFailed),
            "timeout" => Ok(ResponseClass::Timeout),
            other => Err(format!("unknown response_class: {other}")),
        }
    }

    /// True when no server code exists — `smtp_code` MUST be absent (never 0)
    /// for these classes (§5b).
    pub fn has_no_server_code(self) -> bool {
        matches!(
            self,
            ResponseClass::None
                | ResponseClass::ConnectionFailed
                | ResponseClass::TlsFailed
                | ResponseClass::Timeout
        )
    }
}

/// §9.2 settled-event error_class closed enum.
pub const ERROR_CLASSES: [&str; 9] = [
    "none",
    "credential",
    "connect",
    "tls",
    "protocol",
    "policy",
    "timeout",
    "delivery_unknown",
    "cancelled",
];

/// §9.4 command-ack results.
pub const COMMAND_ACKS: [&str; 3] = ["accepted", "duplicate", "rejected"];

/// §9.3 settlement-ack audit slugs.
pub const SETTLEMENT_AUDITS: [&str; 4] = [
    "duplicate",
    "stale_generation",
    "payload_hash_conflict",
    "rank_superseded",
];

/// §0.4 closed refusal-slug registry (exactly these 11).
pub const REFUSAL_SLUGS: [&str; 11] = [
    "already_terminal",
    "cancelled",
    "conflict_copy",
    "credential_required",
    "data_boundary_crossed",
    "fenced",
    "generation_conflict",
    "not_ready",
    "resync_required",
    "revision_conflict",
    "superseded",
];

pub fn is_known_refusal_slug(slug: &str) -> bool {
    REFUSAL_SLUGS.contains(&slug)
}

/// §10.2 preflight check ids (14, closed).
pub const PREFLIGHT_CHECK_IDS: [&str; 14] = [
    "public_ip",
    "static_ip",
    "port25_egress",
    "ptr_fcrdns",
    "helo_hostname",
    "dnsbl_clean",
    "always_on",
    "clock_skew",
    "journal_health",
    "credential_store",
    "spf_published",
    "dkim_published",
    "dmarc_published",
    "seed_test",
];

pub const PREFLIGHT_CHECK_STATUSES: [&str; 5] = ["pass", "fail", "warn", "pending", "unavailable"];
pub const PREFLIGHT_RESULTS: [&str; 4] = ["qualified", "pending", "failed", "degraded"];

/// Deterministic wake-command id shape (§1): `email-send:{send_job_id}:{generation}`.
pub fn email_send_command_id(send_job_id: &str, generation: u32) -> String {
    format!("email-send:{send_job_id}:{generation}")
}

/// u64-as-string wire rule (§0.2): decimal string, no sign, no leading zeros.
pub fn u64_to_wire(value: u64) -> String {
    value.to_string()
}

/// Fail-closed u64-string parse: JSON numbers are refused for §0.2-listed
/// counters (see fixture `u64__string__number_rejected`).
pub fn u64_from_wire(value: &Value) -> Result<u64, String> {
    let text = value
        .as_str()
        .ok_or_else(|| "u64 counters must be decimal strings on the wire".to_string())?;
    if text.is_empty() {
        return Err("u64 string is empty".to_string());
    }
    if text.starts_with('+') || text.starts_with('-') {
        return Err("u64 string must be unsigned".to_string());
    }
    if text.len() > 1 && text.starts_with('0') {
        return Err("u64 string must not carry leading zeros".to_string());
    }
    if !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("u64 string is not decimal: {text}"));
    }
    text.parse::<u64>()
        .map_err(|error| format!("u64 string out of range: {error}"))
}

/// Canonical JSON (§0.2): UTF-8, object keys sorted lexicographically by byte
/// value, no insignificant whitespace. Used for payload hashes and
/// `result_sha256`.
pub fn canonical_json(value: &Value) -> String {
    fn write(value: &Value, out: &mut String) {
        match value {
            Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
                out.push('{');
                for (index, key) in keys.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(key).unwrap_or_default());
                    out.push(':');
                    write(&map[key.as_str()], out);
                }
                out.push('}');
            }
            Value::Array(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write(item, out);
                }
                out.push(']');
            }
            other => {
                out.push_str(&serde_json::to_string(other).unwrap_or_default());
            }
        }
    }
    let mut out = String::new();
    write(value, &mut out);
    out
}

/// Lowercase-hex SHA-256 of the canonical JSON of a payload.
pub fn canonical_payload_sha256(value: &Value) -> String {
    let canonical = canonical_json(value);
    let digest = Sha256::digest(canonical.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Lowercase-hex SHA-256 of raw bytes.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// §5b SanitizedResponse. `smtp_code` is absent (never 0) when the class has
/// no server code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SanitizedResponse {
    pub smtp_code: Option<u16>,
    pub enhanced_code: Option<String>,
    pub response_class: ResponseClass,
}

impl SanitizedResponse {
    pub fn to_value(&self) -> Value {
        let mut map = Map::new();
        if !self.response_class.has_no_server_code() {
            if let Some(code) = self.smtp_code {
                map.insert("smtp_code".to_string(), Value::from(code));
            }
        }
        if let Some(enhanced) = self
            .enhanced_code
            .as_ref()
            .filter(|value| !value.is_empty())
        {
            map.insert("enhanced_code".to_string(), Value::from(enhanced.clone()));
        }
        map.insert(
            "response_class".to_string(),
            Value::from(self.response_class.as_str()),
        );
        Value::Object(map)
    }

    pub fn from_value(value: &Value) -> Result<Self, String> {
        let class_text = value
            .get("response_class")
            .and_then(Value::as_str)
            .ok_or_else(|| "SanitizedResponse requires response_class".to_string())?;
        let response_class = ResponseClass::parse(class_text)?;
        let smtp_code = value
            .get("smtp_code")
            .and_then(Value::as_u64)
            .map(|code| u16::try_from(code).map_err(|_| "smtp_code out of range".to_string()))
            .transpose()?;
        if response_class.has_no_server_code() && smtp_code.is_some() {
            return Err(format!(
                "smtp_code must be absent for response_class {}",
                response_class.as_str()
            ));
        }
        Ok(SanitizedResponse {
            smtp_code,
            enhanced_code: value
                .get("enhanced_code")
                .and_then(Value::as_str)
                .map(str::to_string),
            response_class,
        })
    }
}

/// Extract + validate a wake/companion command payload (§9.4). Returns the
/// parsed command or a fail-closed error. The payload may sit at the event
/// root or under `payload`.
#[derive(Clone, Debug)]
pub enum EmailCommand {
    Send {
        command_id: String,
        send_job_id: String,
        generation: u32,
        binding_id: String,
        target_device_id: String,
    },
    CredentialProbe {
        command_id: String,
        profile_ref: String,
        target_device_id: String,
    },
    PreflightRun {
        command_id: String,
        profile_ref: String,
        domain: String,
        requested_checks: Vec<String>,
        target_device_id: String,
    },
}

impl EmailCommand {
    pub fn command_id(&self) -> &str {
        match self {
            EmailCommand::Send { command_id, .. } => command_id,
            EmailCommand::CredentialProbe { command_id, .. } => command_id,
            EmailCommand::PreflightRun { command_id, .. } => command_id,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            EmailCommand::Send { .. } => EMAIL_COMMAND_SEND,
            EmailCommand::CredentialProbe { .. } => EMAIL_COMMAND_CREDENTIAL_PROBE,
            EmailCommand::PreflightRun { .. } => EMAIL_COMMAND_PREFLIGHT_RUN,
        }
    }
}

pub fn is_email_command_kind(kind: &str) -> bool {
    matches!(
        kind,
        EMAIL_COMMAND_SEND | EMAIL_COMMAND_CREDENTIAL_PROBE | EMAIL_COMMAND_PREFLIGHT_RUN
    )
}

fn command_field<'a>(payload: &'a Value, key: &str) -> Option<&'a Value> {
    payload
        .get(key)
        .or_else(|| payload.get("payload").and_then(|inner| inner.get(key)))
}

fn command_text(payload: &Value, key: &str) -> Result<String, String> {
    command_field(payload, key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("email command missing {key}"))
}

pub fn parse_email_command(kind: &str, payload: &Value) -> Result<EmailCommand, String> {
    match kind {
        EMAIL_COMMAND_SEND => {
            let generation = command_field(payload, "generation")
                .and_then(Value::as_u64)
                .ok_or_else(|| "email_send missing numeric generation".to_string())?;
            let generation = u32::try_from(generation)
                .map_err(|_| "email_send generation out of u32 range".to_string())?;
            if generation == 0 {
                return Err("email_send generation must start at 1".to_string());
            }
            Ok(EmailCommand::Send {
                command_id: command_text(payload, "command_id")?,
                send_job_id: command_text(payload, "send_job_id")?,
                generation,
                binding_id: command_text(payload, "binding_id")?,
                target_device_id: command_text(payload, "target_device_id")?,
            })
        }
        EMAIL_COMMAND_CREDENTIAL_PROBE => Ok(EmailCommand::CredentialProbe {
            command_id: command_text(payload, "command_id")?,
            profile_ref: command_text(payload, "profile_ref")?,
            target_device_id: command_text(payload, "target_device_id")?,
        }),
        EMAIL_COMMAND_PREFLIGHT_RUN => Ok(EmailCommand::PreflightRun {
            command_id: command_text(payload, "command_id")?,
            profile_ref: command_text(payload, "profile_ref")?,
            domain: command_text(payload, "domain")?,
            requested_checks: command_field(payload, "requested_checks")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            target_device_id: command_text(payload, "target_device_id")?,
        }),
        other => Err(format!("unknown email command kind: {other}")),
    }
}

/// The §9.4 dedup identity hash for a wake command: SHA-256 over the
/// canonical JSON of the semantic command payload (root or nested), so a
/// redelivery wrapped in different transport envelopes still matches while a
/// tampered payload does not.
pub fn email_command_payload_hash(command: &EmailCommand) -> String {
    let semantic = match command {
        EmailCommand::Send {
            command_id,
            send_job_id,
            generation,
            binding_id,
            target_device_id,
        } => serde_json::json!({
            "command_id": command_id,
            "command_kind": EMAIL_COMMAND_SEND,
            "send_job_id": send_job_id,
            "generation": generation,
            "binding_id": binding_id,
            "target_device_id": target_device_id,
        }),
        EmailCommand::CredentialProbe {
            command_id,
            profile_ref,
            target_device_id,
        } => serde_json::json!({
            "command_id": command_id,
            "command_kind": EMAIL_COMMAND_CREDENTIAL_PROBE,
            "profile_ref": profile_ref,
            "target_device_id": target_device_id,
        }),
        EmailCommand::PreflightRun {
            command_id,
            profile_ref,
            domain,
            requested_checks,
            target_device_id,
        } => serde_json::json!({
            "command_id": command_id,
            "command_kind": EMAIL_COMMAND_PREFLIGHT_RUN,
            "profile_ref": profile_ref,
            "domain": domain,
            "requested_checks": requested_checks,
            "target_device_id": target_device_id,
        }),
    };
    canonical_payload_sha256(&semantic)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn phase_ranks_match_contract_ladder() {
        let expected = [
            ("received", 1),
            ("prepared", 2),
            ("lease_held", 3),
            ("downloading", 4),
            ("verified", 5),
            ("connecting", 6),
            ("mail_from_sent", 7),
            ("data_started", 8),
            ("data_completed", 9),
            ("settled", 10),
        ];
        for (name, rank) in expected {
            let phase = SendPhase::parse(name).expect(name);
            assert_eq!(phase.rank(), rank, "{name}");
            assert_eq!(phase.as_str(), name);
        }
        assert!(SendPhase::parse("terminal").is_err());
        assert!(SendPhase::Settled.is_terminal());
        assert!(!SendPhase::DataCompleted.is_terminal());
    }

    #[test]
    fn u64_wire_rule_fails_closed_on_numbers() {
        assert_eq!(
            u64_from_wire(&json!("18446744073709551615")).unwrap(),
            u64::MAX
        );
        assert!(u64_from_wire(&json!(42)).is_err());
        assert!(u64_from_wire(&json!("042")).is_err());
        assert!(u64_from_wire(&json!("+42")).is_err());
        assert!(u64_from_wire(&json!("")).is_err());
        assert_eq!(u64_from_wire(&json!("0")).unwrap(), 0);
    }

    #[test]
    fn canonical_json_sorts_keys_bytewise() {
        let value = json!({"b": 1, "a": {"z": true, "aa": [2, 1]}, "A": "x"});
        assert_eq!(
            canonical_json(&value),
            "{\"A\":\"x\",\"a\":{\"aa\":[2,1],\"z\":true},\"b\":1}"
        );
    }

    #[test]
    fn sanitized_response_smtp_code_absent_without_server_code() {
        let response = SanitizedResponse {
            smtp_code: Some(250),
            enhanced_code: None,
            response_class: ResponseClass::ConnectionFailed,
        };
        let value = response.to_value();
        assert!(value.get("smtp_code").is_none());
        assert!(SanitizedResponse::from_value(
            &json!({"response_class": "timeout", "smtp_code": 250})
        )
        .is_err());
        let accepted = SanitizedResponse::from_value(
            &json!({"response_class": "accepted", "smtp_code": 250, "enhanced_code": "2.0.0"}),
        )
        .unwrap();
        assert_eq!(accepted.smtp_code, Some(250));
    }

    #[test]
    fn refusal_registry_is_closed() {
        assert!(is_known_refusal_slug("fenced"));
        assert!(!is_known_refusal_slug("mystery_slug"));
        assert_eq!(REFUSAL_SLUGS.len(), 11);
    }

    #[test]
    fn parse_email_send_command_requires_fields() {
        let payload = json!({
            "command_id": "email-send:job-1:1",
            "send_job_id": "job-1",
            "generation": 1,
            "binding_id": "bind-1",
            "target_device_id": "device-1",
        });
        let command = parse_email_command(EMAIL_COMMAND_SEND, &payload).unwrap();
        assert_eq!(command.command_id(), "email-send:job-1:1");
        let missing = json!({"command_id": "x", "send_job_id": "y", "generation": 1});
        assert!(parse_email_command(EMAIL_COMMAND_SEND, &missing).is_err());
        assert!(parse_email_command("email_other", &payload).is_err());
    }

    #[test]
    fn command_payload_hash_is_envelope_independent() {
        let root = json!({
            "command_id": "email-send:job-1:1",
            "send_job_id": "job-1",
            "generation": 1,
            "binding_id": "bind-1",
            "target_device_id": "device-1",
        });
        let nested = json!({
            "transport_noise": true,
            "payload": root.clone(),
        });
        let a = parse_email_command(EMAIL_COMMAND_SEND, &root).unwrap();
        let b = parse_email_command(EMAIL_COMMAND_SEND, &nested).unwrap();
        assert_eq!(email_command_payload_hash(&a), email_command_payload_hash(&b));
        let tampered = json!({
            "command_id": "email-send:job-1:1",
            "send_job_id": "job-1",
            "generation": 1,
            "binding_id": "bind-OTHER",
            "target_device_id": "device-1",
        });
        let c = parse_email_command(EMAIL_COMMAND_SEND, &tampered).unwrap();
        assert_ne!(email_command_payload_hash(&a), email_command_payload_hash(&c));
    }
}
