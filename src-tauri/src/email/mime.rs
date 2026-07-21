//! Frozen-MIME verification against the `email_send_prepare` grant
//! (plan §4.3): sha256 + size_bytes must match the descriptor, the From
//! header must carry the granted identity address, and header recipients
//! must agree with the envelope — with bcc recipients present in the
//! envelope ONLY, never in the MIME headers (§3b: bcc is envelope-only and
//! the manifest split is the proof; the device re-checks before any send).

use std::{collections::BTreeSet, ops::Range};

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

/// Q-encoding (RFC 2047) payload decoder: `_` = space, `=XX` = hex byte.
fn decode_rfc2047_q(payload: &str) -> Vec<u8> {
    let hex = |byte: u8| match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    };
    let bytes = payload.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'_' => {
                out.push(b' ');
                index += 1;
            }
            b'=' if index + 2 < bytes.len() => {
                if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                    out.push((high << 4) | low);
                    index += 3;
                } else {
                    out.push(b'=');
                    index += 1;
                }
            }
            other => {
                out.push(other);
                index += 1;
            }
        }
    }
    out
}

/// Decode RFC 2047 encoded words (`=?charset?B|Q?payload?=`) anywhere in a
/// header value, converting the declared charset to UTF-8. Undecodable
/// words stay literal — the guard then still sees their raw bytes.
fn decode_rfc2047(input: &str) -> String {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine as _;
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("=?") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let decoded = after.split_once('?').and_then(|(charset, tail)| {
            let (encoding, tail) = tail.split_once('?')?;
            let end = tail.find("?=")?;
            let payload = &tail[..end];
            let bytes = match encoding {
                "b" | "B" => BASE64.decode(payload.as_bytes()).ok()?,
                "q" | "Q" => decode_rfc2047_q(payload),
                _ => return None,
            };
            let text = mail_parser::decoders::charsets::map::charset_decoder(charset.as_bytes())
                .map(|decoder| decoder(&bytes))
                .unwrap_or_else(|| String::from_utf8_lossy(&bytes).into_owned());
            Some((text, &tail[end + 2..]))
        });
        match decoded {
            Some((text, remainder)) => {
                out.push_str(&text);
                rest = remainder;
            }
            None => {
                out.push_str("=?");
                rest = &rest[start + 2..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The ORIGINAL header value bytes (never the parser's reconstruction):
/// unfolded, RFC 2047-decoded, lowercased — the haystack for the raw
/// bcc-containment guard (review R6). The parser may drop or mangle
/// malformed content, but a leaked address's bytes are physically HERE.
fn raw_header_value_decoded(bytes: &[u8], header: &mail_parser::Header<'_>) -> String {
    let start = (header.offset_start as usize).min(bytes.len());
    let end = (header.offset_end as usize).min(bytes.len());
    let raw = String::from_utf8_lossy(&bytes[start..end.max(start)]);
    let unfolded: String = raw
        .chars()
        .filter(|ch| *ch != '\r' && *ch != '\n')
        .collect();
    decode_rfc2047(&unfolded).to_lowercase()
}

#[derive(Debug)]
struct DecodedHeaderBlock {
    text: String,
    /// One flag per UTF-8 byte in `text`. True means that byte is part of an
    /// addr-spec token actually extracted by the structured parser.
    extracted_addr_spec: Vec<bool>,
}

#[derive(Debug)]
struct CleanAddressValue {
    source_span: Range<usize>,
    extracted: Vec<String>,
}

#[derive(Clone, Copy)]
struct TaggedChar {
    ch: char,
    address_value: Option<usize>,
}

/// Bytes which can belong to an addr-spec token in a decoded address-header
/// value. Display names, comments, quoted phrases, group names, and obsolete
/// route prefixes deliberately stay false: parser output has no offsets, so
/// an extracted address string must never protect an identical string in one
/// of those disclosure-bearing regions.
fn addr_spec_eligible_bytes(value: &str) -> Vec<bool> {
    let mut eligible = vec![true; value.len()];
    let mut in_quote = false;
    let mut quote_escaped = false;
    let mut comment_depth = 0usize;
    let mut comment_escaped = false;
    let mut angle_depth = 0usize;
    let mut angle_content_start = 0usize;
    let mut segment_start = 0usize;

    for (index, ch) in value.char_indices() {
        let end = index + ch.len_utf8();
        if comment_depth > 0 {
            eligible[index..end].fill(false);
            if comment_escaped {
                comment_escaped = false;
            } else {
                match ch {
                    '\\' => comment_escaped = true,
                    '(' => comment_depth += 1,
                    ')' => comment_depth -= 1,
                    _ => {}
                }
            }
            continue;
        }
        if in_quote {
            eligible[index..end].fill(false);
            if quote_escaped {
                quote_escaped = false;
            } else {
                match ch {
                    '\\' => quote_escaped = true,
                    '"' => in_quote = false,
                    _ => {}
                }
            }
            continue;
        }

        match ch {
            '(' => {
                eligible[index..end].fill(false);
                comment_depth = 1;
            }
            '"' => {
                eligible[index..end].fill(false);
                in_quote = true;
            }
            '<' if angle_depth == 0 => {
                // Everything before an angle-addr in this list entry is its
                // display phrase, even if it happens to look like an address.
                eligible[segment_start..end].fill(false);
                angle_depth = 1;
                angle_content_start = end;
            }
            '<' => angle_depth += 1,
            '>' if angle_depth > 0 => angle_depth -= 1,
            ':' if angle_depth > 0 => {
                // In an angle-addr, bytes before the final ':' are an
                // obsolete route prefix, not the extracted addr-spec.
                eligible[angle_content_start..end].fill(false);
                angle_content_start = end;
            }
            ':' => {
                // At top level this is a group delimiter; its name is not an
                // address even when it contains address-looking text.
                eligible[segment_start..end].fill(false);
                segment_start = end;
            }
            ',' | ';' if angle_depth == 0 => segment_start = end,
            _ => {}
        }
    }
    eligible
}

/// Locate only literal decoded occurrences of addr-specs that the structured
/// parser actually extracted. The syntax mask prevents a coincidental copy
/// in a display name/comment/route from receiving the carve-out.
fn extracted_addr_spec_ranges(value: &str, extracted: &[String]) -> Vec<Range<usize>> {
    let eligible = addr_spec_eligible_bytes(value);
    let mut ranges = Vec::new();
    for address in extracted {
        if address.is_empty() {
            continue;
        }
        let mut search_start = 0;
        while let Some(relative_start) = value[search_start..].find(address) {
            let start = search_start + relative_start;
            let end = start + address.len();
            if eligible[start..end].iter().all(|is_eligible| *is_eligible) {
                ranges.push(start..end);
            }
            search_start = start
                + address
                    .chars()
                    .next()
                    .expect("non-empty extracted address")
                    .len_utf8();
        }
    }
    ranges.sort_unstable_by_key(|range| (range.start, range.end));
    ranges.dedup();
    ranges
}

/// The complete ORIGINAL header block, ending before the first RFC 5322
/// blank-line body separator. Folded continuation lines are unfolded while
/// physical boundaries between distinct header lines remain visible. For a
/// cleanly parsed address header, only decoded bytes belonging to a located,
/// extracted addr-spec token are tagged for the narrow-belt carve-out.
/// Malformed colon-less lines and all other bytes remain fully enforced.
fn raw_header_block_decoded(
    bytes: &[u8],
    clean_address_values: &[CleanAddressValue],
) -> DecodedHeaderBlock {
    let crlf_end = bytes.windows(4).position(|window| window == b"\r\n\r\n");
    let lf_end = bytes.windows(2).position(|window| window == b"\n\n");
    let header_end = match (crlf_end, lf_end) {
        (Some(crlf), Some(lf)) => crlf.min(lf),
        (Some(crlf), None) => crlf,
        (None, Some(lf)) => lf,
        (None, None) => bytes.len(),
    };
    // Split at every clean-span edge before UTF-8 decoding so each produced
    // character has an unambiguous source jurisdiction. Header value offsets
    // are ASCII syntax boundaries, so they cannot bisect a valid UTF-8 code
    // point in a conforming message.
    let mut cuts = vec![0, header_end];
    for value in clean_address_values {
        cuts.push(value.source_span.start.min(header_end));
        cuts.push(value.source_span.end.min(header_end));
    }
    cuts.sort_unstable();
    cuts.dedup();

    let mut tagged = Vec::with_capacity(header_end);
    for edges in cuts.windows(2) {
        let start = edges[0];
        let end = edges[1];
        if start == end {
            continue;
        }
        let address_value = clean_address_values
            .iter()
            .position(|value| value.source_span.start <= start && end <= value.source_span.end);
        tagged.extend(
            String::from_utf8_lossy(&bytes[start..end])
                .chars()
                .map(|ch| TaggedChar { ch, address_value }),
        );
    }

    // Normalize physical line endings first.
    let mut normalized = Vec::with_capacity(tagged.len());
    let mut index = 0;
    while index < tagged.len() {
        if tagged[index].ch == '\r' {
            let address_value = tagged[index].address_value;
            if tagged.get(index + 1).map(|tagged| tagged.ch) == Some('\n') {
                index += 1;
            }
            normalized.push(TaggedChar {
                ch: '\n',
                address_value,
            });
        } else {
            normalized.push(tagged[index]);
        }
        index += 1;
    }

    // Unfold continuation lines, but retain newlines between distinct fields
    // as sentinels so no token can be synthesized across header boundaries.
    let mut unfolded = Vec::with_capacity(normalized.len());
    for (index, tagged) in normalized.iter().copied().enumerate() {
        if tagged.ch != '\n'
            || !normalized
                .get(index + 1)
                .map(|next| matches!(next.ch, ' ' | '\t'))
                .unwrap_or(false)
        {
            unfolded.push(tagged);
        }
    }

    // Value-span edges cannot occur inside an encoded word. Decode each
    // address value as one run, locate its extracted addr-specs in that
    // decoded text, and transfer only those token ranges to the global map.
    let mut decoded = DecodedHeaderBlock {
        text: String::with_capacity(header_end),
        extracted_addr_spec: Vec::with_capacity(header_end),
    };
    let mut run_start = 0;
    while run_start < unfolded.len() {
        let address_value = unfolded[run_start].address_value;
        let mut run_end = run_start + 1;
        while run_end < unfolded.len() && unfolded[run_end].address_value == address_value {
            run_end += 1;
        }
        let run: String = unfolded[run_start..run_end]
            .iter()
            .map(|tagged| tagged.ch)
            .collect();
        let run = decode_rfc2047(&run).to_lowercase();
        let carved = address_value
            .map(|index| extracted_addr_spec_ranges(&run, &clean_address_values[index].extracted))
            .unwrap_or_default();
        for (index, ch) in run.char_indices() {
            let end = index + ch.len_utf8();
            let is_extracted = carved
                .iter()
                .any(|range| range.start <= index && end <= range.end);
            decoded.text.push(ch);
            decoded
                .extracted_addr_spec
                .extend(std::iter::repeat_n(is_extracted, ch.len_utf8()));
        }
        run_start = run_end;
    }
    decoded
}

/// Whitespace-free companion for the complete raw header block. Newlines
/// between distinct physical header fields remain as sentinels so stripping
/// folding whitespace cannot synthesize an address across two unrelated
/// fields.
fn strip_header_whitespace(input: &DecodedHeaderBlock) -> DecodedHeaderBlock {
    let mut stripped = DecodedHeaderBlock {
        text: String::with_capacity(input.text.len()),
        extracted_addr_spec: Vec::with_capacity(input.extracted_addr_spec.len()),
    };
    for (index, ch) in input.text.char_indices() {
        if ch == '\n' || !ch.is_whitespace() {
            stripped.text.push(ch);
            stripped.extracted_addr_spec.extend(std::iter::repeat_n(
                input.extracted_addr_spec[index],
                ch.len_utf8(),
            ));
        }
    }
    stripped
}

/// Find narrow raw-belt token hits. Only the conservative characters that
/// common free-text address detectors treat as address continuation suppress
/// a match: ASCII alphanumeric plus `.`, `-`, `_`, and local-side `+`.
/// Full RFC 5322 atext belongs exclusively to the structured belt.
fn addr_spec_token_ranges(haystack: &str, needle: &str) -> Vec<Range<usize>> {
    if needle.is_empty() {
        return Vec::new();
    }

    let local_part_continues =
        |ch: char| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | '+');
    let domain_continues = |ch: char| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_');
    let mut ranges = Vec::new();
    let mut search_start = 0;
    while let Some(relative_start) = haystack[search_start..].find(needle) {
        let start = search_start + relative_start;
        let end = start + needle.len();
        let before_is_boundary = haystack[..start]
            .chars()
            .next_back()
            .map(|ch| !local_part_continues(ch))
            .unwrap_or(true);
        let mut after = haystack[end..].chars();
        let after_is_boundary = match after.next() {
            // A dot extends the domain only when it opens another ordinary
            // ASCII label. A terminal/pre-boundary dot is the root-FQDN form
            // of the same address and must therefore match.
            Some('.') => !after
                .next()
                .map(|ch| ch.is_ascii_alphanumeric())
                .unwrap_or(false),
            Some(ch) => !domain_continues(ch),
            None => true,
        };
        if before_is_boundary && after_is_boundary {
            ranges.push(start..end);
        }

        search_start = start + needle.chars().next().expect("non-empty needle").len_utf8();
    }
    ranges
}

/// A narrow raw-belt hit stands unless every byte of the hit falls within an
/// addr-spec token actually extracted by the structured parser. Structured
/// comparison has already rejected exact bcc addr-specs before this carve-out
/// is consulted.
fn contains_unprotected_addr_spec_token(block: &DecodedHeaderBlock, needle: &str) -> bool {
    addr_spec_token_ranges(&block.text, needle)
        .into_iter()
        .any(|range| {
            !block.extracted_addr_spec[range]
                .iter()
                .all(|is_extracted| *is_extracted)
        })
}

/// Split a TEXT-form address list on TOP-LEVEL commas only — commas inside
/// quoted strings (`"a,b"@dom`) and inside angle brackets (obsolete routes
/// `<@a,@b:user@dom>`) never split.
fn split_address_list(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escaped = false;
    let mut angle_depth = 0usize;
    for ch in value.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_quotes => {
                current.push(ch);
                escaped = true;
            }
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            '<' if !in_quotes => {
                angle_depth += 1;
                current.push(ch);
            }
            '>' if !in_quotes => {
                angle_depth = angle_depth.saturating_sub(1);
                current.push(ch);
            }
            ',' if !in_quotes && angle_depth == 0 => {
                // A bracket-stripped obsolete route (`@a,@b:user@dom`) keeps
                // its commas until the route's ':' arrives (review R6-3) —
                // never split a route prefix into phantom addresses.
                let head = current.trim_start();
                if head.starts_with('@') && !head.contains(':') {
                    current.push(ch);
                } else {
                    out.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    out.push(current);
    out
}

/// Normalize ONE text-form address token to a comparable addr-spec — the
/// SAME normalization the structured path uses (review R5): the angle-addr
/// form takes the bracketed addr-spec (obsolete routes included); the bare
/// form must BE an addr-spec (quoted local parts with escapes handled by
/// `normalize_addr_spec`). None = no comparable addr-spec in this token.
fn normalize_address_token(token: &str) -> Option<String> {
    let token = token.trim();
    if let (Some(open), Some(close)) = (token.rfind('<'), token.rfind('>')) {
        if open < close {
            return normalize_addr_spec(token[open + 1..close].trim());
        }
        // Mismatched angle brackets: nothing comparable here.
        return None;
    }
    if token.contains('<') || token.contains('>') {
        return None;
    }
    normalize_addr_spec(token)
}

/// Extract comparable addr-specs from a TEXT-form header value (the form
/// mail-parser yields for Return-Path). FAIL CLOSED (review R5): a
/// non-empty text value that yields no comparable addr-spec — or any
/// individual token that cannot be normalized — rejects the message, same
/// as the structured-path rule; ad-hoc quote stripping is gone.
fn extract_addresses_from_text(value: &str) -> Result<Vec<String>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for token in split_address_list(trimmed) {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        match normalize_address_token(token) {
            Some(address) => out.push(address),
            None => {
                return Err(format!(
                    "text address header entry has no comparable addr-spec: {token:?}"
                ));
            }
        }
    }
    if out.is_empty() {
        return Err(format!(
            "text address header value has no comparable addr-spec: {trimmed:?}"
        ));
    }
    Ok(out)
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
    let domain = domain.strip_suffix('.').unwrap_or(domain);
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
        // An UNQUOTED local part carrying whitespace or quote characters is
        // not a valid addr-spec — never guess at one (fail closed upstream).
        if local.chars().any(|ch| ch.is_whitespace() || ch == '"') {
            return None;
        }
        local.to_string()
    };
    if local.is_empty() {
        return None;
    }
    if domain
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '"' | '<' | '>' | '(' | ')' | ',' | ';' | ':'))
    {
        return None;
    }
    Some(format!("{local}@{domain}").to_lowercase())
}

/// mail-parser 0.11 treats a quoted local part in a bare addr-spec as a
/// display name plus an address missing its local part (`"local"@dom` becomes
/// name `local`, address `@dom`). Recover only candidates whose ORIGINAL raw
/// syntax has the closing quote immediately followed by `@`; a display name
/// followed by a malformed `<@dom>` therefore cannot be mistaken for one.
fn quoted_local_addr_specs(raw_value: &str) -> Vec<String> {
    let bytes = raw_value.as_bytes();
    let mut addresses = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'"' {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        let mut escaped = false;
        while index < bytes.len() {
            match bytes[index] {
                _ if escaped => escaped = false,
                b'\\' => escaped = true,
                b'"' => break,
                _ => {}
            }
            index += 1;
        }
        if index >= bytes.len() || index + 1 >= bytes.len() || bytes[index + 1] != b'@' {
            index += 1;
            continue;
        }
        let mut end = index + 2;
        while end < bytes.len()
            && !bytes[end].is_ascii_whitespace()
            && !matches!(bytes[end], b'<' | b'>' | b'(' | b')' | b',' | b';')
        {
            end += 1;
        }
        if let Some(address) = normalize_addr_spec(&raw_value[start..end]) {
            addresses.push(address);
        }
        index = end;
    }
    addresses
}

/// Normalized addr-specs from a STRUCTURALLY parsed header value (reviews
/// R3-5/R4-3): mail-parser's RFC 5322 parser handles group syntax
/// (`hidden:archive@x;`), comments, and quoted locals; every yielded entry
/// is then normalized to a comparable addr-spec. FAIL CLOSED: an entry the
/// parser yields WITHOUT a comparable addr-spec (encoded-word-only, empty,
/// route-only) in a transmitted address header is an error, never a skip —
/// an unmatchable entry could be exactly the smuggled bcc address.
fn addresses_of(
    value: &mail_parser::HeaderValue<'_>,
    raw_value: &str,
) -> Result<Vec<String>, String> {
    use mail_parser::{Address, HeaderValue};
    let mut out = Vec::new();
    let mut quoted_candidates = quoted_local_addr_specs(raw_value);
    let mut push = |raw: &str| -> Result<(), String> {
        let normalized = normalize_addr_spec(raw).or_else(|| {
            let suffix = raw.to_lowercase();
            if !suffix.starts_with('@') {
                return None;
            }
            let index = quoted_candidates
                .iter()
                .position(|candidate| candidate.ends_with(&suffix))?;
            Some(quoted_candidates.remove(index))
        });
        match normalized {
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
                        );
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
                            return Err("address header entry without an addr-spec fails closed"
                                .to_string());
                        }
                    }
                }
            }
        }
        HeaderValue::Text(text) => {
            // Already-normalized addr-specs; failures are already rejects.
            out.extend(extract_addresses_from_text(text)?);
        }
        HeaderValue::TextList(items) => {
            for item in items {
                out.extend(extract_addresses_from_text(item)?);
            }
        }
        // A truly empty value discloses nothing.
        HeaderValue::Empty => {}
        // An address-designated header carrying a non-address value is
        // parser confusion — fail closed, never a silent skip (review R5:
        // exhaustive enumeration, no catch-all Ok).
        HeaderValue::DateTime(_) | HeaderValue::ContentType(_) | HeaderValue::Received(_) => {
            return Err("address header carries a non-address value; fails closed".to_string());
        }
    }
    Ok(out)
}

/// `mail-parser` parses Return-Path through its message-id/text path and may
/// retain an angle address while dropping unrelated leading bytes. Allow its
/// extracted token to be located for carving only when the entire decoded
/// field body itself is one comparable path. Other address headers use the
/// parser's address form, where `addresses_of` already requires every yielded
/// entry to carry a valid addr-spec. In either case, the caller carves only
/// located addr-spec bytes, never the full value.
fn can_carve_extracted_addr_specs(
    name: &mail_parser::HeaderName<'_>,
    raw_trimmed: &str,
    extracted: &[String],
) -> bool {
    if extracted.is_empty() {
        return false;
    }
    if !matches!(name, mail_parser::HeaderName::ReturnPath) {
        return true;
    }

    let candidate = if let Some(inner) = raw_trimmed
        .strip_prefix('<')
        .and_then(|value| value.strip_suffix('>'))
    {
        inner
    } else if raw_trimmed.contains(['<', '>']) {
        return false;
    } else {
        raw_trimmed
    };
    normalize_addr_spec(candidate)
        .filter(|address| extracted.len() == 1 && address == &extracted[0])
        .is_some()
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
            let raw = raw_header_value_decoded(bytes, header);
            out.extend(addresses_of(header.value(), &raw)?);
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
        normalize_addr_spec(identity_address).unwrap_or_else(|| identity_address.to_lowercase());
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
    let normalize_envelope =
        |address: &str| normalize_addr_spec(address).unwrap_or_else(|| address.to_lowercase());
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
    // mailbox-bearing header (reviews R2-7/R3-5/R6) — To/Cc, Reply-To,
    // From/Sender, Return-Path, and every resent variant all disclose the
    // address to visible recipients. TWO independent belts:
    //
    //   1. STRUCTURED: mail-parser's RFC 5322 output, normalized to
    //      comparable addr-specs (groups/comments/quoting/routes) — the
    //      allow-precision check.
    //   2. RAW CONTAINMENT: the COMPLETE ORIGINAL header block (unfolded +
    //      RFC 2047-decoded, lowercased, plus a whitespace-stripped variant)
    //      with deliberately narrow free-text token boundaries. Hits inside
    //      located addr-spec tokens extracted by belt 1 are carved out; hits
    //      in display names, comments, quoted phrases, route prefixes, and
    //      every non-address header byte stand.
    //
    // FAIL CLOSED: a header whose RAW value is non-empty but yields no
    // confidently-parsed addr-spec rejects — except the two legitimate
    // no-address forms: a truly empty value and the RFC 5321 null
    // reverse-path `<>`. The granted identity is exempt from the leak set:
    // a self-bcc (archive copy) discloses nothing.
    let is_transmitted_address_header = |name: &HeaderName<'_>| {
        matches!(
            name,
            HeaderName::To
                | HeaderName::Cc
                | HeaderName::ReplyTo
                | HeaderName::From
                | HeaderName::Sender
                | HeaderName::ReturnPath
                | HeaderName::ResentTo
                | HeaderName::ResentCc
                | HeaderName::ResentFrom
                | HeaderName::ResentSender
        )
    };
    let strip_ws =
        |value: &str| -> String { value.chars().filter(|ch| !ch.is_whitespace()).collect() };
    let bcc_needles: Vec<(String, String)> = envelope_bcc
        .iter()
        .filter(|address| *address != &identity_lower)
        .map(|address| (address.clone(), strip_ws(address)))
        .collect();

    // Belt 1 runs first. A successfully parsed address header contributes
    // only its extracted addr-spec strings for token-range location, and a
    // structured bcc equality always rejects before belt 2 can carve a hit.
    let mut clean_address_values = Vec::new();
    let mut structured_failure = None;
    for header in parsed.headers() {
        if !is_transmitted_address_header(&header.name) {
            continue;
        }
        let raw = raw_header_value_decoded(bytes, header);
        // The one non-empty address field body that legitimately carries no
        // addr-spec is the RFC 5321 null reverse-path. It is legal only in
        // Return-Path, never in To/From/etc.
        let raw_trim = raw.trim();
        let is_null_reverse_path =
            matches!(header.name, HeaderName::ReturnPath) && raw_trim == "<>";

        let extracted = match if is_null_reverse_path {
            Ok(Vec::new())
        } else {
            addresses_of(header.value(), &raw)
        } {
            Ok(extracted) => extracted,
            Err(error) => {
                // Keep the span raw-enforced. If it contains the bcc needle,
                // belt 2 reports the disclosure; otherwise this parse error
                // still fails closed immediately after belt 2.
                structured_failure.get_or_insert(error);
                continue;
            }
        };
        for address in &extracted {
            if bcc_needles.iter().any(|(needle, _)| needle == address) {
                return Err(format!("bcc recipient leaked into MIME headers: {address}"));
            }
        }
        // Dropped-content fail-closed: raw bytes present but the parser
        // yielded nothing comparable (e.g. an unclosed angle-addr the
        // parser turned into Empty) — reject unless it is a legitimate
        // no-address form.
        if extracted.is_empty() && !raw_trim.is_empty() && !is_null_reverse_path {
            structured_failure.get_or_insert_with(|| {
                format!(
                    "address header value not confidently parseable: {:?}",
                    header.name.as_str()
                )
            });
            continue;
        }
        if can_carve_extracted_addr_specs(&header.name, raw_trim, &extracted) {
            let start = (header.offset_start as usize).min(bytes.len());
            let end = (header.offset_end as usize).min(bytes.len()).max(start);
            clean_address_values.push(CleanAddressValue {
                source_span: start..end,
                extracted,
            });
        }
    }

    // Belt 2 scans the entire original header region. Source tags derived
    // from mail-parser's value offsets identify each decoded value, then only
    // located extracted addr-spec token bytes receive the carve-out.
    let raw_headers = raw_header_block_decoded(bytes, &clean_address_values);
    let raw_headers_stripped = strip_header_whitespace(&raw_headers);
    for (needle, needle_stripped) in &bcc_needles {
        if contains_unprotected_addr_spec_token(&raw_headers, needle)
            || contains_unprotected_addr_spec_token(&raw_headers_stripped, needle_stripped)
        {
            return Err(format!("bcc recipient leaked into MIME headers: {needle}"));
        }
    }
    if let Some(error) = structured_failure {
        return Err(error);
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

    fn message_with_address_header(header: &str) -> Vec<u8> {
        format!(
            "From: ops@acme.example\r\nTo: billing@partner.example\r\n{header}\r\n\r\nhello\r\n"
        )
        .into_bytes()
    }

    fn assert_bcc_leak_rejected(header: &str, bcc_address: &str) {
        let mime = message_with_address_header(header);
        let result = verify_mime(
            &mime,
            &sha256_hex(&mime),
            mime.len() as u64,
            "ops@acme.example",
            &envelope(&[("to", "billing@partner.example"), ("bcc", bcc_address)]),
        );
        let error = match result {
            Err(error) => error,
            Ok(verified) => panic!(
                "a transmitted address header must not disclose an envelope-bcc address: {header:?} passed as {verified:?}"
            ),
        };
        assert!(
            error.contains("bcc recipient leaked into MIME headers"),
            "expected the bcc-leak guard to reject {header:?}, got: {error}"
        );
    }

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
        // Round-5 repro: Return-Path rides mail-parser's TEXT form — a
        // quoted-local bcc address there must normalize and leak-match
        // (the old ad-hoc quote stripping produced `archive"@…` ≠ bcc).
        let text_quoted_leak = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReturn-Path: \"archive\"@acme.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            text_quoted_leak,
            &sha256_hex(text_quoted_leak),
            text_quoted_leak.len() as u64,
            "ops@acme.example",
            &bcc_envelope,
        )
        .is_err());
        // Garbage in a TEXT-form address header fails closed even with no
        // bcc match — a non-empty value with no comparable addr-spec could
        // be exactly the smuggled form.
        let text_garbage = b"From: ops@acme.example\r\nTo: billing@partner.example\r\nReturn-Path: utterly not an address\r\n\r\nhello\r\n";
        assert!(verify_mime(
            text_garbage,
            &sha256_hex(text_garbage),
            text_garbage.len() as u64,
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
    fn systemic_bcc_guard_rejects_structured_and_raw_obfuscations() {
        // Structured normalization remains the precision belt for valid but
        // non-literal forms whose bytes do not contain the canonical needle.
        for header in [
            "Reply-To: \"archive\"@acme.example",
            "Reply-To: <\"archive\"@acme.example>",
            "Reply-To: hidden:archive@acme.example;",
            "Reply-To: Archive (comment) <archive@acme.example>",
            "Reply-To: <@relay.example:archive@acme.example>",
            "Reply-To: innocent@example.net, archive@acme.example",
            "Reply-To: =?UTF-8?B?YXJjaGl2ZUBhY21lLmV4YW1wbGU=?=",
            "Reply-To: innocent@example.net (=?UTF-8?B?YXJjaGl2ZUBhY21lLmV4YW1wbGU=?=)",
            "Resent-To: archive@acme.example",
            "Resent-Cc: archive@acme.example",
            "Resent-From: archive@acme.example",
            "Resent-Sender: archive@acme.example",
        ] {
            assert_bcc_leak_rejected(header, "archive@acme.example");
        }

        // R6-1: mail-parser drops the unclosed value entirely and keeps only
        // the angle address in the mixed form. The original-byte guard sees
        // the canonical bcc addr-spec before either parser loss.
        assert_bcc_leak_rejected("Return-Path: <archive@acme.example", "archive@acme.example");
        assert_bcc_leak_rejected("Return-Path: archive@x <innocent@y>", "archive@x");

        // R6-2: the parser may retain CFWS as if it were part of the domain;
        // canonical containment in the original field body still rejects.
        assert_bcc_leak_rejected(
            "Return-Path: <archive@acme.example(comment)>",
            "archive@acme.example",
        );
        assert_bcc_leak_rejected(
            "To: <archive@acme.example(comment)>",
            "archive@acme.example",
        );

        // Folding cannot split a canonical needle past the whitespace-free
        // raw guard.
        assert_bcc_leak_rejected(
            "Reply-To: archive@\r\n acme.example",
            "archive@acme.example",
        );
    }

    #[test]
    fn narrow_raw_belt_does_not_carve_display_name_disclosures() {
        let mime = b"From: sender@acme.example\r\nTo: \"archive@acme.example\" <innocent@example.net>\r\n\r\nhello\r\n";
        let error = verify_mime(
            mime,
            &sha256_hex(mime),
            mime.len() as u64,
            "sender@acme.example",
            &envelope(&[
                ("to", "innocent@example.net"),
                ("bcc", "archive@acme.example"),
            ]),
        )
        .expect_err("a bcc address in an address display name must be rejected");
        assert!(
            error.contains("bcc recipient leaked into MIME headers"),
            "display-name disclosure must be caught by the narrow raw belt: {error}"
        );
    }

    #[test]
    fn whole_raw_header_block_rejects_colonless_bcc_leaks() {
        // mail-parser drops malformed pre-separator lines that have no colon,
        // so these bytes are outside every parsed Header value span.
        assert_bcc_leak_rejected("Bcc archive@acme.example", "archive@acme.example");
        assert_bcc_leak_rejected("Reply-To archive@acme.example", "archive@acme.example");
    }

    #[test]
    fn narrow_raw_belt_rejects_free_text_atext_delimiters() {
        assert_bcc_leak_rejected("Subject: ops@example.com", "ops@example.com");

        // These are all RFC 5322 atext characters, but common free-text
        // address detectors treat them as delimiters around an addr-spec.
        // They therefore belong to the raw belt's narrow boundary class,
        // not its continuation class.
        for (before, after) in [
            ("'", "'"),
            ("!", "!"),
            ("$", "$"),
            ("&", "&"),
            ("*", "*"),
            ("/", "/"),
            ("=", "="),
            ("`", "`"),
            ("{", "}"),
            ("|", "|"),
        ] {
            let header = format!("Subject: {before}ops@example.com{after}");
            assert_bcc_leak_rejected(&header, "ops@example.com");
        }
    }

    #[test]
    fn raw_bcc_guard_requires_addr_spec_token_boundaries() {
        assert_eq!(
            normalize_addr_spec("archive@acme.example."),
            Some("archive@acme.example".to_string()),
            "structured normalization must canonicalize a root-FQDN trailing dot"
        );

        // A bcc addr-spec embedded in a longer local part or followed by a
        // longer domain is a distinct visible address, not a disclosure.
        // `dev!ops@...` specifically exercises the carve-out: the narrow raw
        // belt sees `!` as a boundary, but its hit lies wholly inside the
        // extracted `dev!ops@...` token and the structured belt sees the
        // longer, distinct addr-spec.
        for (visible, bcc) in [
            ("devops@example.com", "ops@example.com"),
            ("dev!ops@example.com", "ops@example.com"),
            ("a@b.com.attacker.example", "a@b.com"),
            ("user@acme.example.org", "user@acme.example"),
        ] {
            let mime =
                format!("From: sender@acme.example\r\nTo: {visible}\r\n\r\nhello\r\n").into_bytes();
            let result = verify_mime(
                &mime,
                &sha256_hex(&mime),
                mime.len() as u64,
                "sender@acme.example",
                &envelope(&[("to", visible), ("bcc", bcc)]),
            );
            assert!(
                result.is_ok(),
                "distinct visible address {visible:?} must not match bcc {bcc:?}: {result:?}"
            );
        }

        // A root-FQDN trailing dot terminates the same domain rather than
        // extending it with another label, including before CFWS.
        for header in [
            "To: <archive@acme.example.>",
            "Subject: archive@acme.example.",
            "Subject: archive@acme.example.(comment)",
        ] {
            assert_bcc_leak_rejected(header, "archive@acme.example");
        }

        // A complete, delimited token still discloses the bcc recipient.
        assert_bcc_leak_rejected("To: ops@example.com", "ops@example.com");

        // The same bcc address as a genuinely delimited To token still
        // rejects before the visible-recipient mismatch can mask the leak.
        let leaked = b"From: sender@acme.example\r\nTo: devops@example.com, ops@example.com\r\n\r\nhello\r\n";
        let error = verify_mime(
            leaked,
            &sha256_hex(leaked),
            leaked.len() as u64,
            "sender@acme.example",
            &envelope(&[("to", "devops@example.com"), ("bcc", "ops@example.com")]),
        )
        .expect_err("a delimited bcc addr-spec in To must be rejected");
        assert!(
            error.contains("bcc recipient leaked into MIME headers"),
            "expected the token-bounded raw guard to reject the leak, got: {error}"
        );
    }

    #[test]
    fn legitimate_address_headers_and_null_reverse_path_are_accepted() {
        for header in [
            "Return-Path: <sender@example.net>",
            "Return-Path: <>",
            "Return-Path: <@relay1.example,@relay2.example:sender@example.net>",
            "Reply-To: \"support\"@example.net",
            "Reply-To:",
        ] {
            let mime = message_with_address_header(header);
            assert!(
                verify_mime(
                    &mime,
                    &sha256_hex(&mime),
                    mime.len() as u64,
                    "ops@acme.example",
                    &envelope(&[
                        ("to", "billing@partner.example"),
                        ("bcc", "archive@acme.example"),
                    ]),
                )
                .is_ok(),
                "legitimate header should pass: {header:?}"
            );
        }

        let multi_recipient = b"From: ops@acme.example\r\nTo: billing@partner.example, legal@example.net\r\n\r\nhello\r\n";
        assert!(verify_mime(
            multi_recipient,
            &sha256_hex(multi_recipient),
            multi_recipient.len() as u64,
            "ops@acme.example",
            &envelope(&[
                ("to", "billing@partner.example"),
                ("to", "legal@example.net"),
                ("bcc", "archive@acme.example"),
            ]),
        )
        .is_ok());

        // RFC 2047 in a display name is benign when its decoded text does
        // not disclose the bcc addr-spec.
        let encoded_display_name = b"From: =?UTF-8?Q?Acme_Operations?= <ops@acme.example>\r\nTo: billing@partner.example\r\n\r\nhello\r\n";
        assert!(verify_mime(
            encoded_display_name,
            &sha256_hex(encoded_display_name),
            encoded_display_name.len() as u64,
            "ops@acme.example",
            &envelope(&[
                ("to", "billing@partner.example"),
                ("bcc", "archive@acme.example"),
            ]),
        )
        .is_ok());
    }

    #[test]
    fn null_path_is_rejected_outside_return_path() {
        let mime = message_with_address_header("Reply-To: <>");
        assert!(verify_mime(
            &mime,
            &sha256_hex(&mime),
            mime.len() as u64,
            "ops@acme.example",
            &envelope(&[
                ("to", "billing@partner.example"),
                ("bcc", "archive@acme.example"),
            ]),
        )
        .is_err());
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
