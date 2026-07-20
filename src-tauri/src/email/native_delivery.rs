//! Native direct-to-MX delivery worker (plan §3.8, contract §6b.2/§10):
//! one recipient per transaction, MX priority ordering, DKIM signing with
//! the journal-held key, per-domain rate limiting, greylist backoff, and the
//! never-downgrade-TLS-on-an-advertising-MX rule. Before DATA every attempt
//! re-checks the source IP / lease / DKIM key / port-25 preflight facts
//! (§10.2). Ambiguity at/after DATA settles delivery_unknown and is never
//! retransmitted.
//!
//! The worker composes the same primitives the provider path uses
//! (smtp_session, journal, retry, rate_limit) plus mx + dkim. It is driven
//! per (send_job_id, generation, recipient) so a partial multi-recipient
//! send records per-recipient state independently.

use std::time::Duration;

use secrecy::SecretString;

use super::contract::ResponseClass;
use super::dkim;
use super::mx::{ordered_delivery_hosts, MxResolver};
use super::rate_limit;
use super::retry::{classify_retry, RetryDecision};
use super::smtp_session::{SmtpSecurity, SmtpSession, SmtpTarget};

/// Facts re-checked before native DATA (§10.2). The worker refuses to cross
/// the DATA boundary unless all four hold for the current attempt.
#[derive(Clone, Debug)]
pub struct NativePreDataFacts {
    pub source_ip_authorized: bool,
    pub lease_valid: bool,
    pub dkim_fingerprint_matches: bool,
    pub port25_reachable: bool,
}

impl NativePreDataFacts {
    pub fn all_ok(&self) -> bool {
        self.source_ip_authorized
            && self.lease_valid
            && self.dkim_fingerprint_matches
            && self.port25_reachable
    }

    pub fn first_failure(&self) -> Option<&'static str> {
        if !self.source_ip_authorized {
            Some("source_ip")
        } else if !self.lease_valid {
            Some("lease")
        } else if !self.dkim_fingerprint_matches {
            Some("dkim_key")
        } else if !self.port25_reachable {
            Some("port25")
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeRecipientOutcome {
    Submitted {
        smtp_code: u16,
    },
    Deferred {
        retry_at_ms: Option<i64>,
    },
    Bounced {
        smtp_code: Option<u16>,
    },
    DeliveryUnknown,
    /// Pre-DATA preflight recheck failed — abort without touching the wire.
    PreflightAborted {
        check: &'static str,
    },
}

pub struct NativeDeps<'a> {
    pub mx: &'a dyn MxResolver,
    pub dkim_key_pem: SecretString,
    pub dkim_domain: String,
    pub dkim_selector: String,
    pub ehlo: String,
    pub extra_root_cert_pem: Option<String>,
    pub connect_host_override: Option<String>,
    pub connect_port_override: Option<u16>,
    /// Recompute pre-DATA facts for a specific MX host at attempt time.
    pub recheck_facts: &'a dyn Fn(&str) -> NativePreDataFacts,
}

/// Deliver one recipient. Signs the MIME with DKIM, resolves MX, walks hosts
/// in priority order (advancing on connection/TLS failure), re-checks
/// preflight facts before DATA, and classifies the outcome. The journal
/// writes happen in the caller (submission-style) via `on_data_started`;
/// this function focuses on the SMTP mechanics + classification so the
/// crash-matrix tests can drive it directly.
pub fn deliver_recipient(
    deps: &NativeDeps<'_>,
    recipient_address: &str,
    recipient_domain: &str,
    mail_from: &str,
    mime_bytes: &[u8],
    attempt: u32,
    mut on_data_started: impl FnMut() -> Result<(), String>,
) -> Result<NativeRecipientOutcome, String> {
    // 1) DKIM-sign the frozen MIME with the journal-held key.
    let signed = dkim::sign_message(
        &deps.dkim_key_pem,
        &deps.dkim_domain,
        &deps.dkim_selector,
        mime_bytes,
    )?;

    // 2) Resolve MX and order hosts.
    let resolution = deps.mx.resolve_mx(recipient_domain)?;
    let hosts = match ordered_delivery_hosts(&resolution) {
        Ok(hosts) => hosts,
        // Null MX / NXDOMAIN: permanent, never retried.
        Err(_) => return Ok(NativeRecipientOutcome::Bounced { smtp_code: None }),
    };
    if hosts.is_empty() {
        return Ok(NativeRecipientOutcome::Bounced { smtp_code: None });
    }

    let mut last_temporary: Option<NativeRecipientOutcome> = None;
    for host in hosts {
        // 3) Pre-DATA preflight recheck for THIS host (§10.2).
        let facts = (deps.recheck_facts)(&host);
        if !facts.all_ok() {
            // Preflight failure is not a wire event; abort this delivery so
            // the caller reoffers after re-qualification.
            return Ok(NativeRecipientOutcome::PreflightAborted {
                check: facts.first_failure().unwrap_or("unknown"),
            });
        }

        let target = SmtpTarget {
            host: host.clone(),
            port: deps.connect_port_override.unwrap_or(25),
            connect_host: deps.connect_host_override.clone(),
            // Native MX delivery uses opportunistic STARTTLS, but the
            // never-downgrade rule (§smtp_session) means a host that
            // advertises STARTTLS and then fails the handshake is a
            // tls_failed outcome — we never fall back to plaintext on it.
            security: SmtpSecurity::StartTls,
            ehlo: deps.ehlo.clone(),
            extra_root_cert_pem: deps.extra_root_cert_pem.clone(),
            timeout: Duration::from_secs(60),
        };

        let mut session = match SmtpSession::connect(&target) {
            Ok(session) => session,
            Err(failure) => {
                match classify_retry(failure.response_class, false, attempt) {
                    RetryDecision::NextMx => continue, // try next MX host
                    RetryDecision::Retry { backoff_ms } => {
                        last_temporary = Some(NativeRecipientOutcome::Deferred {
                            retry_at_ms: Some(now_ms() + backoff_ms),
                        });
                        continue;
                    }
                    RetryDecision::Permanent => {
                        return Ok(NativeRecipientOutcome::Bounced {
                            smtp_code: failure.smtp_code,
                        })
                    }
                    RetryDecision::DeliveryUnknown => {
                        return Ok(NativeRecipientOutcome::DeliveryUnknown)
                    }
                }
            }
        };

        // 4) One recipient per transaction (§native ops). `on_data_started`
        // is the caller's data_started journal hook — before DATA.
        let transaction = session.send_transaction(
            mail_from,
            &[recipient_address.to_string()],
            &signed,
            || {},
            &mut on_data_started,
        );
        match transaction {
            Ok((response, _)) => {
                let code = super::smtp_session::response_code_u16(&response);
                session.quit();
                return Ok(NativeRecipientOutcome::Submitted { smtp_code: code });
            }
            Err(failure) => {
                let decision =
                    classify_retry(failure.response_class, failure.at_or_after_data, attempt);
                match decision {
                    RetryDecision::DeliveryUnknown => {
                        // Never retransmit (§10.1). Terminal for this recipient.
                        return Ok(NativeRecipientOutcome::DeliveryUnknown);
                    }
                    RetryDecision::Permanent => {
                        return Ok(NativeRecipientOutcome::Bounced {
                            smtp_code: failure.smtp_code,
                        });
                    }
                    RetryDecision::Retry { backoff_ms } => {
                        // Greylist-style temporary rejection at this host:
                        // defer the recipient, do not walk to another MX with
                        // the same bytes mid-transaction.
                        last_temporary = Some(NativeRecipientOutcome::Deferred {
                            retry_at_ms: Some(now_ms() + backoff_ms),
                        });
                        break;
                    }
                    RetryDecision::NextMx => {
                        // A pre-MAIL-FROM protocol failure — try the next MX.
                        continue;
                    }
                }
            }
        }
    }

    Ok(last_temporary.unwrap_or(NativeRecipientOutcome::Deferred { retry_at_ms: None }))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// A domain that advertised TLS must never be downgraded. Native delivery
/// enforces this by treating a STARTTLS handshake failure as `tls_failed`
/// (which advances MX, never plaintext) — the same guarantee the provider
/// path gives. This helper documents + tests the invariant against a
/// classification of "STARTTLS advertised, handshake failed".
pub fn tls_advertised_failure_never_downgrades(class: ResponseClass) -> bool {
    // tls_failed advances MX / defers — it is never treated as a reason to
    // retry the same host without TLS.
    matches!(
        classify_retry(class, false, 0),
        RetryDecision::NextMx | RetryDecision::Retry { .. }
    ) && class == ResponseClass::TlsFailed
}

/// Convenience: record a native send/greylist result into the rate-limit
/// state (plan §3.8). Called by the caller after `deliver_recipient`.
pub fn apply_rate_outcome(
    journal: &super::journal::EmailJournal,
    domain: &str,
    outcome: &NativeRecipientOutcome,
) -> Result<(), String> {
    match outcome {
        NativeRecipientOutcome::Submitted { .. } => rate_limit::record_sent(journal, domain),
        NativeRecipientOutcome::Deferred { .. } => {
            rate_limit::record_greylist_deferral(journal, domain).map(|_| ())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::email::dkim::generate_rsa_dkim_key;
    use crate::email::mx::{FakeMxResolver, MxResolution, MxTarget};
    use crate::email::test_support::{SinkBehavior, SinkMode, SmtpSink, SINK_TLS_CERT_PEM};

    fn native_deps<'a>(
        mx: &'a FakeMxResolver,
        key: &SecretString,
        recheck: &'a dyn Fn(&str) -> NativePreDataFacts,
        port: u16,
    ) -> NativeDeps<'a> {
        NativeDeps {
            mx,
            dkim_key_pem: key.clone(),
            dkim_domain: "acme.example".to_string(),
            dkim_selector: "dfmail1".to_string(),
            ehlo: "mail.acme.example".to_string(),
            extra_root_cert_pem: Some(SINK_TLS_CERT_PEM.to_string()),
            connect_host_override: Some("127.0.0.1".to_string()),
            connect_port_override: Some(port),
            recheck_facts: recheck,
        }
    }

    fn all_ok(_host: &str) -> NativePreDataFacts {
        NativePreDataFacts {
            source_ip_authorized: true,
            lease_valid: true,
            dkim_fingerprint_matches: true,
            port25_reachable: true,
        }
    }

    #[test]
    fn native_delivers_single_recipient_over_starttls() {
        let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
        let mx = FakeMxResolver::new();
        mx.set(
            "partner.example",
            MxResolution::Targets(vec![MxTarget {
                host: "localhost".to_string(),
                priority: 10,
            }]),
        );
        let key = generate_rsa_dkim_key().unwrap().private_key_pem;
        let recheck = all_ok;
        let deps = native_deps(&mx, &key, &recheck, sink.port);
        let mut data_started = false;
        let outcome = deliver_recipient(
            &deps,
            "billing@partner.example",
            "partner.example",
            "bounce@acme.example",
            b"From: ops@acme.example\r\nTo: billing@partner.example\r\nSubject: hi\r\nDate: Mon, 20 Jul 2026 00:00:00 +0000\r\n\r\nbody\r\n",
            0,
            || {
                data_started = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(matches!(outcome, NativeRecipientOutcome::Submitted { .. }));
        assert!(data_started);
        let state = sink.state();
        assert_eq!(state.messages.len(), 1);
        assert!(state.messages[0].tls_active);
        // The delivered body carries the DKIM signature.
        let text = String::from_utf8_lossy(&state.messages[0].data);
        assert!(text.contains("DKIM-Signature"));
    }

    #[test]
    fn preflight_recheck_aborts_before_wire() {
        let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
        let mx = FakeMxResolver::new();
        mx.set(
            "partner.example",
            MxResolution::Targets(vec![MxTarget {
                host: "localhost".to_string(),
                priority: 10,
            }]),
        );
        let key = generate_rsa_dkim_key().unwrap().private_key_pem;
        let recheck = |_host: &str| NativePreDataFacts {
            source_ip_authorized: true,
            lease_valid: true,
            dkim_fingerprint_matches: false, // key rotated out from under us
            port25_reachable: true,
        };
        let deps = native_deps(&mx, &key, &recheck, sink.port);
        let outcome = deliver_recipient(
            &deps,
            "billing@partner.example",
            "partner.example",
            "bounce@acme.example",
            b"From: ops@acme.example\r\n\r\nbody\r\n",
            0,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(
            outcome,
            NativeRecipientOutcome::PreflightAborted { check: "dkim_key" }
        );
        assert_eq!(sink.state().messages.len(), 0, "no bytes on the wire");
    }

    #[test]
    fn mid_data_loss_is_delivery_unknown_never_retransmitted() {
        let behavior = SinkBehavior {
            drop_after_data_before_response: true,
            ..SinkBehavior::default()
        };
        let sink = SmtpSink::start(SinkMode::Plain, behavior);
        let mx = FakeMxResolver::new();
        mx.set(
            "partner.example",
            MxResolution::Targets(vec![MxTarget {
                host: "localhost".to_string(),
                priority: 10,
            }]),
        );
        let key = generate_rsa_dkim_key().unwrap().private_key_pem;
        let recheck = all_ok;
        let deps = native_deps(&mx, &key, &recheck, sink.port);
        let outcome = deliver_recipient(
            &deps,
            "billing@partner.example",
            "partner.example",
            "bounce@acme.example",
            b"From: ops@acme.example\r\n\r\nbody\r\n",
            0,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(outcome, NativeRecipientOutcome::DeliveryUnknown);
    }

    #[test]
    fn null_mx_bounces() {
        let mx = FakeMxResolver::new();
        mx.set("dead.example", MxResolution::NullMx);
        let key = generate_rsa_dkim_key().unwrap().private_key_pem;
        let recheck = all_ok;
        let deps = native_deps(&mx, &key, &recheck, 25);
        let outcome = deliver_recipient(
            &deps,
            "user@dead.example",
            "dead.example",
            "bounce@acme.example",
            b"From: ops@acme.example\r\n\r\nbody\r\n",
            0,
            || Ok(()),
        )
        .unwrap();
        assert!(matches!(outcome, NativeRecipientOutcome::Bounced { .. }));
    }

    #[test]
    fn tls_failure_never_downgrades() {
        assert!(tls_advertised_failure_never_downgrades(
            ResponseClass::TlsFailed
        ));
        assert!(!tls_advertised_failure_never_downgrades(
            ResponseClass::RejectedPermanent
        ));
    }
}
