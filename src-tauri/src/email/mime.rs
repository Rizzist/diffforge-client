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

/// Extract addr-spec addresses from a TEXT-form header value — the fallback
/// for headers mail-parser surfaces as raw text (e.g. Return-Path).
fn extract_addresses_from_text(value: &str) -> Vec<String> {
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

/// Normalize a raw addr-spec for comparison (review R4-3): strip the RFC
/// 5322 obsolete route form (`<@relay,@relay2:user@dom>` ⇒ `user@dom`),
/// unquote quoted local parts (`"archive"@dom` ≡ `archive@dom`), and
/// lowercase. None = the entry carries no comparable addr-spec.
fn normalize_addr_spec(raw: &str) -> Option<String> {
    let mut addr = raw.trim();
    if addr.is_empty() {
        return None;
    }
    // Obsolete route prefix (`@relay,@relay2:user@dom`).
    if addr.starts_with('@') {
        addr = addr.split_once(':').map(|(_, rest)| rest)?.trim();
    }
    let (local, domain) = addr.rsplit_once('@')?;
    let local = local.trim();
    let domain = domain.trim();
    if domain.is_empty() {
        return None;
    }
    let local = if local.len() >= 2 && local.starts_with('"') && local.ends_with('"') {
        let inner = &local[1..local.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut escaped = false;
        for ch in inner.chars() {
            if escaped {
                out.push(ch);
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else {
                out.push(ch);
            }
        }
        out
    } else {
        local.to_string()
    };
    if local.is_empty() {
        return None;
    }
    Some(format!("{local}@{domain}").to_ascii_lowercase())
}

/// Normalized addr-specs from a STRUCTURALLY parsed header value (reviews
/// R3-5/R4-3): mail-parser's RFC 5322 parser handles group syntax
/// (`hidden:archive@x;`), comments, and quoted locals; every yielded entry
/// is then normalized to a comparable addr-spec. FAIL CLOSED: an entry the
/// parser yields WITHOUT a comparable addr-spec (encoded-word-only, empty,
/// route-only) in a transmitted address header is an error, never a skip —
/// an unmatchable entry could be exactly the smuggled bcc address.
fn addresses_of(value: &mail_parser::HeaderValue<'_>) -> Result<Vec<String>, String> {
    use mail_parser::{Address, HeaderValue};
    let mut out = Vec::new();
    let mut push = |raw: &str| -> Result<(), String> {
        match normalize_addr_spec(raw) {
            Some(address) => {
                out.push(address);
                Ok(())
            }
            None => Err(format!(
                "address header entry has no comparable addr-spec: {raw:?}"
            )),
        }
    };
    match value {
        HeaderValue::Address(Address::List(list)) => {
            for addr in list {
                match addr.address.as_deref() {
                    Some(address) => push(address)?,
                    None => {
                        return Err(
                            "address header entry without an addr-spec fails closed".to_string()
                        )
                    }
                }
            }
        }
        HeaderValue::Address(Address::Group(groups)) => {
            for group in groups {
                for addr in &group.addresses {
                    match addr.address.as_deref() {
                        Some(address) => push(address)?,
                        None => {
                            return Err(
                                "address header entry without an addr-spec fails closed"
                                    .to_string(),
                            )
                        }
                    }
                }
            }
        }
        HeaderValue::Text(text) => {
            for token in extract_addresses_from_text(text) {
                push(&token)?;
            }
        }
        HeaderValue::TextList(items) => {
            for item in items {
                for token in extract_addresses_from_text(item) {
                    push(&token)?;
                }
            }
        }
        _ => {}
    }
    Ok(out)
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

    // Structural RFC 5322 parse (review R3-5): every header decision below
    // works on mail-parser's address parser output — group syntax, comments,
    // and quoted local parts are normalized to addr-specs, so none of them
    // can smuggle an address past the comparisons. An unparsable message
    // fails closed.
    let parsed = mail_parser::MessageParser::default()
        .parse(bytes)
        .ok_or_else(|| "frozen MIME failed RFC 5322 parsing".to_string())?;
    use mail_parser::HeaderName;
    let header_value = |wanted: &[HeaderName<'static>]| -> Result<Vec<String>, String> {
        let mut out = Vec::new();
        for header in parsed
            .headers()
            .iter()
            .filter(|header| wanted.iter().any(|name| name == &header.name))
        {
            out.extend(addresses_of(header.value())?);
        }
        Ok(out)
    };

    // Bcc must never appear as a header in the frozen MIME (§3b) — and the
    // standardized resent variant is just as much of a disclosure channel.
    if parsed
        .headers()
        .iter()
        .any(|header| matches!(header.name, HeaderName::Bcc | HeaderName::ResentBcc))
    {
        return Err("frozen MIME must not carry a Bcc or Resent-Bcc header".to_string());
    }

    let from_addresses = header_value(&[HeaderName::From])?;
    let identity_lower =
        normalize_addr_spec(identity_address).unwrap_or_else(|| identity_address.to_ascii_lowercase());
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

    let header_recipients: BTreeSet<String> = header_value(&[HeaderName::To])?
        .into_iter()
        .chain(header_value(&[HeaderName::Cc])?)
        .collect();
    // Envelope addresses ride the SAME normalization so the comparison is
    // symmetric (quoted locals, case).
    let normalize_envelope = |address: &str| {
        normalize_addr_spec(address).unwrap_or_else(|| address.to_ascii_lowercase())
    };
    let envelope_visible: BTreeSet<String> = envelope
        .recipients
        .iter()
        .filter(|recipient| recipient.role != "bcc")
        .map(|recipient| normalize_envelope(&recipient.address))
        .collect();
    let envelope_bcc: BTreeSet<String> = envelope
        .recipients
        .iter()
        .filter(|recipient| recipient.role == "bcc")
        .map(|recipient| normalize_envelope(&recipient.address))
        .collect();

    // Bcc envelope addresses must not leak into ANY transmitted
    // mailbox-bearing header (reviews R2-7/R3-5): To/Cc, Reply-To,
    // From/Sender, Return-Path, and every resent variant all disclose the
    // address to visible recipients. The scan is structural — RFC 5322
    // parsed, so groups/comments/quoting cannot evade it. The granted
    // identity itself is exempt: a self-bcc (archive copy) discloses
    // nothing, since the sender's own address is already visible by
    // construction.
    let transmitted_addresses: BTreeSet<String> = header_value(&[
        HeaderName::To,
        HeaderName::Cc,
        HeaderName::ReplyTo,
        HeaderName::From,
        HeaderName::Sender,
        HeaderName::ReturnPath,
        HeaderName::ResentTo,
        HeaderName::ResentCc,
        HeaderName::ResentFrom,
        HeaderName::ResentSender,
    ])?
    .into_iter()
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
        // RFC 5322 GROUP syntax must not evade the scan (review R3-5): the
        // bcc address hidden inside a display-group still leaks.
        let group_leak = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReply-To: hidden:archive@acme.example;\r\n\r\nhello\r\n";
        assert!(verify_mime(
            group_leak,
            &sha256_hex(group_leak),
            group_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // Comment/quoting obfuscation must not evade it either.
        let comment_leak = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nResent-Cc: (archival) \"a\" <archive@acme.example>\r\n\r\nhello\r\n";
        assert!(verify_mime(
            comment_leak,
            &sha256_hex(comment_leak),
            comment_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // Quoted-local-part obfuscation must not evade the scan (R4-3):
        // `"archive"@dom` normalizes to archive@dom for comparison.
        let quoted_leak = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReply-To: \"archive\"@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            quoted_leak,
            &sha256_hex(quoted_leak),
            quoted_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // RFC 5322 obsolete-route form must not evade it either:
        // `<@relay.example:archive@acme.example>` strips to the addr-spec.
        let route_leak = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReply-To: <@relay.example:archive@acme.example>\r\n\r\nhello\r\n";
        assert!(verify_mime(
            route_leak,
            &sha256_hex(route_leak),
            route_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // An address-header entry with NO comparable addr-spec fails closed
        // — an unmatchable entry could be exactly the smuggled address.
        let unmatchable = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReply-To: ghost-without-domain\r\n\r\nhello\r\n";
        assert!(verify_mime(
            unmatchable,
            &sha256_hex(unmatchable),
            unmatchable.len() as u64,
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
