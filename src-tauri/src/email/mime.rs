//! Frozen-MIME verification against the `email_send_prepare` grant
//! (plan §4.3): sha256 + size_bytes must match the descriptor, the From
//! header must carry the granted identity address, and header recipients
//! must agree with the envelope — with bcc recipients present in the
//! envelope ONLY, never in the MIME headers (§3b: bcc is envelope-only and
//! the manifest split is the proof; the device re-checks before any send).

use std::collections::BTreeSet;

use super::contract::sha256_hex;

#[derive(Clone, Debug)]
pub struct EnvelopeRecipient {
    pub recipient_ref: String,
    pub role: String, // to|cc|bcc
    pub address: String,
    pub domain: String,
}

#[derive(Clone, Debug)]
pub struct PrepareEnvelope {
    pub mail_from: String,
    pub recipients: Vec<EnvelopeRecipient>,
}

#[derive(Clone, Debug)]
pub struct VerifiedMime {
    pub sha256: String,
    pub size_bytes: usize,
    pub from_addresses: Vec<String>,
    pub header_recipients: Vec<String>,
}

/// Unfold headers (RFC 5322 continuation lines) and return (name, value)
/// pairs for the top-level header block.
fn parse_headers(bytes: &[u8]) -> Vec<(String, String)> {
    let end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 2)
        .or_else(|| {
            bytes
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|position| position + 1)
        })
        .unwrap_or(bytes.len());
    let header_text = String::from_utf8_lossy(&bytes[..end]);
    let mut headers: Vec<(String, String)> = Vec::new();
    for raw_line in header_text.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if line.is_empty() {
            continue;
        }
        if (line.starts_with(' ') || line.starts_with('\t')) && !headers.is_empty() {
            if let Some(last) = headers.last_mut() {
                last.1.push(' ');
                last.1.push_str(line.trim());
            }
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }
    headers
}

/// Extract addr-spec addresses from a structured address header value.
fn extract_addresses(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in value.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let address = if let (Some(open), Some(close)) = (part.rfind('<'), part.rfind('>')) {
            if open < close {
                part[open + 1..close].trim().to_string()
            } else {
                part.to_string()
            }
        } else {
            part.split_whitespace()
                .find(|token| token.contains('@'))
                .unwrap_or("")
                .trim_matches(|c| c == '"' || c == ';')
                .to_string()
        };
        if address.contains('@') {
            out.push(address.to_ascii_lowercase());
        }
    }
    out
}

/// Verify downloaded MIME bytes against the prepare grant. Every failure is
/// terminal for the attempt (the device never patches the frozen MIME).
pub fn verify_mime(
    bytes: &[u8],
    expected_sha256: &str,
    expected_size_bytes: u64,
    identity_address: &str,
    envelope: &PrepareEnvelope,
) -> Result<VerifiedMime, String> {
    let actual_sha = sha256_hex(bytes);
    if !actual_sha.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "mime sha256 mismatch: expected {expected_sha256}, got {actual_sha}"
        ));
    }
    if bytes.len() as u64 != expected_size_bytes {
        return Err(format!(
            "mime size mismatch: expected {expected_size_bytes}, got {}",
            bytes.len()
        ));
    }

    let headers = parse_headers(bytes);
    let header_value = |name: &str| -> Vec<String> {
        headers
            .iter()
            .filter(|(header, _)| header == name)
            .flat_map(|(_, value)| extract_addresses(value))
            .collect()
    };

    // Bcc must never appear as a header in the frozen MIME (§3b) — and the
    // standardized resent variant is just as much of a disclosure channel.
    if headers
        .iter()
        .any(|(name, _)| name == "bcc" || name == "resent-bcc")
    {
        return Err("frozen MIME must not carry a Bcc or Resent-Bcc header".to_string());
    }

    let from_addresses = header_value("from");
    let identity_lower = identity_address.to_ascii_lowercase();
    // From is bound to EXACTLY the granted identity (review R2-7): a second
    // mailbox riding the From list is both an impersonation surface and a
    // bcc-disclosure channel.
    if from_addresses.is_empty()
        || !from_addresses
            .iter()
            .all(|address| address == &identity_lower)
    {
        return Err(format!(
            "MIME From must carry exactly the granted identity address {identity_address}"
        ));
    }

    let header_recipients: BTreeSet<String> = header_value("to")
        .into_iter()
        .chain(header_value("cc"))
        .collect();
    let envelope_visible: BTreeSet<String> = envelope
        .recipients
        .iter()
        .filter(|recipient| recipient.role != "bcc")
        .map(|recipient| recipient.address.to_ascii_lowercase())
        .collect();
    let envelope_bcc: BTreeSet<String> = envelope
        .recipients
        .iter()
        .filter(|recipient| recipient.role == "bcc")
        .map(|recipient| recipient.address.to_ascii_lowercase())
        .collect();

    // Bcc envelope addresses must not leak into ANY transmitted
    // mailbox-bearing header (review R2-7): To/Cc, Reply-To, From/Sender,
    // Return-Path, and every resent variant all disclose the address to
    // visible recipients. The scan is structural — each header value is
    // parsed as an address list, never substring-matched. The granted
    // identity itself is exempt: a self-bcc (archive copy) discloses
    // nothing, since the sender's own address is already visible by
    // construction.
    let transmitted_addresses: BTreeSet<String> = [
        "to",
        "cc",
        "reply-to",
        "from",
        "sender",
        "return-path",
        "resent-to",
        "resent-cc",
        "resent-from",
        "resent-sender",
    ]
    .iter()
    .flat_map(|name| header_value(name))
    .collect();
    if let Some(leaked) = envelope_bcc
        .iter()
        .filter(|address| *address != &identity_lower)
        .find(|address| transmitted_addresses.contains(*address))
    {
        return Err(format!("bcc recipient leaked into MIME headers: {leaked}"));
    }
    // Visible headers must match the envelope's to/cc set exactly.
    if header_recipients != envelope_visible {
        return Err(format!(
            "MIME To/Cc set does not match the prepare envelope (headers: {header_recipients:?}, envelope: {envelope_visible:?})"
        ));
    }

    Ok(VerifiedMime {
        sha256: actual_sha,
        size_bytes: bytes.len(),
        from_addresses,
        header_recipients: header_recipients.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::email::contract::sha256_hex;

    fn envelope(recipients: &[(&str, &str)]) -> PrepareEnvelope {
        PrepareEnvelope {
            mail_from: "bounce@acme.example".to_string(),
            recipients: recipients
                .iter()
                .enumerate()
                .map(|(index, (role, address))| EnvelopeRecipient {
                    recipient_ref: format!("r{}", index + 1),
                    role: role.to_string(),
                    address: address.to_string(),
                    domain: address.split('@').nth(1).unwrap_or("").to_string(),
                })
                .collect(),
        }
    }

    const BODY: &[u8] = b"From: Acme Ops <ops@acme.example>\r\nTo: billing@partner.example\r\nSubject: invoice\r\n\r\nhello\r\n";

    #[test]
    fn accepts_matching_mime() {
        let sha = sha256_hex(BODY);
        let verified = verify_mime(
            BODY,
            &sha,
            BODY.len() as u64,
            "ops@acme.example",
            &envelope(&[("to", "billing@partner.example")]),
        )
        .unwrap();
        assert_eq!(verified.size_bytes, BODY.len());
        assert_eq!(verified.from_addresses, vec!["ops@acme.example"]);
    }

    #[test]
    fn rejects_sha_and_size_mismatch() {
        let sha = sha256_hex(BODY);
        assert!(verify_mime(
            BODY,
            "0000000000000000000000000000000000000000000000000000000000000000",
            BODY.len() as u64,
            "ops@acme.example",
            &envelope(&[("to", "billing@partner.example")]),
        )
        .is_err());
        assert!(verify_mime(
            BODY,
            &sha,
            BODY.len() as u64 + 1,
            "ops@acme.example",
            &envelope(&[("to", "billing@partner.example")]),
        )
        .is_err());
    }

    #[test]
    fn rejects_wrong_from_identity() {
        let sha = sha256_hex(BODY);
        assert!(verify_mime(
            BODY,
            &sha,
            BODY.len() as u64,
            "someone-else@acme.example",
            &envelope(&[("to", "billing@partner.example")]),
        )
        .is_err());
    }

    #[test]
    fn bcc_is_envelope_only() {
        // Envelope carries a bcc recipient; headers must not.
        let sha = sha256_hex(BODY);
        let verified = verify_mime(
            BODY,
            &sha,
            BODY.len() as u64,
            "ops@acme.example",
            &envelope(&[
                ("to", "billing@partner.example"),
                ("bcc", "archive@acme.example"),
            ]),
        );
        assert!(verified.is_ok(), "bcc in envelope only is the happy path");

        // A Bcc header in the MIME is an outright failure.
        let with_bcc = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nBcc: archive@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            with_bcc,
            &sha256_hex(with_bcc),
            with_bcc.len() as u64,
            "ops@acme.example",
            &envelope(&[
                ("to", "billing@partner.example"),
                ("bcc", "archive@acme.example"),
            ]),
        )
        .is_err());

        // A bcc address leaking into To is a failure even without the header.
        let leaked = b"From: ops@acme.example\r\nTo: billing@partner.example, archive@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            leaked,
            &sha256_hex(leaked),
            leaked.len() as u64,
            "ops@acme.example",
            &envelope(&[
                ("to", "billing@partner.example"),
                ("bcc", "archive@acme.example"),
            ]),
        )
        .is_err());
    }

    #[test]
    fn resent_bcc_and_all_address_header_leaks_are_rejected() {
        let bcc_envelope = envelope(&[
            ("to", "billing@partner.example"),
            ("bcc", "archive@acme.example"),
        ]);
        // A Resent-Bcc header is rejected outright, like Bcc.
        let resent = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nResent-Bcc: archive@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            resent,
            &sha256_hex(resent),
            resent.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // Envelope-bcc leaking through Reply-To is rejected.
        let reply_to = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReply-To: archive@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            reply_to,
            &sha256_hex(reply_to),
            reply_to.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // Envelope-bcc leaking through Resent-To is rejected.
        let resent_to = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nResent-To: archive@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            resent_to,
            &sha256_hex(resent_to),
            resent_to.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // A benign Reply-To (non-bcc address) still passes.
        let benign = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReply-To: ops@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            benign,
            &sha256_hex(benign),
            benign.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_ok());
        // From carrying a SECOND mailbox is rejected outright — even when it
        // is the leaked bcc address (review R2-7's example).
        let from_leak = b"From: ops@acme.example, archive@acme.example\r\nTo: billing@partner.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            from_leak,
            &sha256_hex(from_leak),
            from_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // Sender leaking an envelope-bcc address is rejected.
        let sender_leak = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nSender: archive@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            sender_leak,
            &sha256_hex(sender_leak),
            sender_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // Return-Path leaking an envelope-bcc address is rejected.
        let return_path_leak = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReturn-Path: <archive@acme.example>\r\n\r\nhello\r\n";
        assert!(verify_mime(
            return_path_leak,
            &sha256_hex(return_path_leak),
            return_path_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // A self-bcc (envelope bcc = the granted identity) stays legal: the
        // sender's own address in From discloses nothing.
        let self_bcc_envelope = envelope(&[
            ("to", "billing@partner.example"),
            ("bcc", "ops@acme.example"),
        ]);
        assert!(verify_mime(
            BODY,
            &sha256_hex(BODY),
            BODY.len() as u64,
            "ops@acme.example",
            &self_bcc_envelope,
        )
        .is_ok());
    }

    #[test]
    fn header_envelope_recipient_set_must_match() {
        let extra = b"From: ops@acme.example\r\nTo: billing@partner.example, other@partner.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            extra,
            &sha256_hex(extra),
            extra.len() as u64,
            "ops@acme.example",
            &envelope(&[("to", "billing@partner.example")]),
        )
        .is_err());
    }
}
