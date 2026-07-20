//! One SMTP submission/transaction session over lettre's low-level client
//! (plan §4.3, contract §6b.2/§9.6/§10.1):
//!
//! - 587 = STARTTLS **required** (a server that does not offer STARTTLS is a
//!   tls_failed outcome, never a plaintext session);
//! - 465 = implicit TLS from the first byte;
//! - certificate + hostname validation is mandatory — there is no insecure
//!   escape hatch (tests add a private trust anchor, validation stays on);
//! - AUTH is only ever sent after TLS is established;
//! - the caller journals `data_started` BEFORE the DATA command via the
//!   `before_data` hook; ambiguity at/after DATA is `delivery_unknown`
//!   (never retried) and is surfaced as `at_or_after_data = true`;
//! - the provider 2xx is returned for journaling BEFORE it is reported.
//!
//! Raw response text stays in `local_detail` — journal-local only, never on
//! the wire (§9.6).

use std::time::Duration;

use lettre::address::Address;
use lettre::transport::smtp::client::{Certificate, SmtpConnection, TlsParameters};
use lettre::transport::smtp::commands::{Data, Mail, Quit, Rcpt};
use lettre::transport::smtp::extension::ClientId;
use lettre::transport::smtp::response::Response;
use secrecy::{ExposeSecret, SecretString};

use super::contract::ResponseClass;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SmtpSecurity {
    StartTls,
    ImplicitTls,
}

#[derive(Clone, Debug)]
pub struct SmtpTarget {
    /// Hostname used for TLS SNI + certificate hostname validation.
    pub host: String,
    pub port: u16,
    /// Socket-level connect override (tests dial 127.0.0.1 while validating
    /// the certificate for `host`). None = connect to `host`.
    pub connect_host: Option<String>,
    pub security: SmtpSecurity,
    /// EHLO/HELO client identity.
    pub ehlo: String,
    /// Additional trust anchor (PEM). Validation still runs in full against
    /// this root, hostname check included. Test-only wiring.
    pub extra_root_cert_pem: Option<String>,
    pub timeout: Duration,
}

#[derive(Clone, Debug)]
pub struct SmtpCredentials {
    pub username: String,
    pub secret: SecretString,
}

/// Classified failure — the only shape that leaves this module besides a
/// success Response. `local_detail` never crosses the wire.
#[derive(Clone, Debug)]
pub struct SmtpFailure {
    pub response_class: ResponseClass,
    pub smtp_code: Option<u16>,
    pub enhanced_code: Option<String>,
    pub local_detail: String,
    pub at_or_after_data: bool,
}

impl SmtpFailure {
    fn new(class: ResponseClass, detail: impl Into<String>) -> Self {
        SmtpFailure {
            response_class: class,
            smtp_code: None,
            enhanced_code: None,
            local_detail: detail.into(),
            at_or_after_data: false,
        }
    }

    /// Is this a credential failure (535 / 5.7.x auth family)?
    pub fn is_credential_failure(&self) -> bool {
        matches!(self.smtp_code, Some(534) | Some(535) | Some(538))
            || self
                .enhanced_code
                .as_deref()
                .is_some_and(|code| code.starts_with("5.7.8") || code.starts_with("5.7.9"))
    }
}

pub fn response_code_u16(response: &Response) -> u16 {
    let code = response.code();
    (code.severity as u8 as u16) * 100 + (code.category as u8 as u16) * 10 + code.detail as u16
}

fn enhanced_code_of(response: &Response) -> Option<String> {
    let text = response.first_line()?;
    let candidate = text.split_whitespace().next()?;
    let mut parts = candidate.split('.');
    let a = parts.next()?.parse::<u8>().ok()?;
    let _b = parts.next()?.parse::<u16>().ok()?;
    let _c = parts.next()?.parse::<u16>().ok()?;
    if parts.next().is_some() || !(2..=5).contains(&a) {
        return None;
    }
    Some(candidate.to_string())
}

fn classify_response_failure(response: &Response) -> SmtpFailure {
    let code = response_code_u16(response);
    let class = if (400..500).contains(&code) {
        ResponseClass::RejectedTemporary
    } else {
        ResponseClass::RejectedPermanent
    };
    SmtpFailure {
        response_class: class,
        smtp_code: Some(code),
        enhanced_code: enhanced_code_of(response),
        local_detail: response
            .message()
            .collect::<Vec<&str>>()
            .join(" ")
            .chars()
            .take(300)
            .collect(),
        at_or_after_data: false,
    }
}

fn classify_transport_error(
    error: &lettre::transport::smtp::Error,
    stage_class: ResponseClass,
) -> SmtpFailure {
    if let Some(code) = error.status() {
        let numeric = (code.severity as u8 as u16) * 100
            + (code.category as u8 as u16) * 10
            + code.detail as u16;
        let class = if (400..500).contains(&numeric) {
            ResponseClass::RejectedTemporary
        } else {
            ResponseClass::RejectedPermanent
        };
        return SmtpFailure {
            response_class: class,
            smtp_code: Some(numeric),
            enhanced_code: None,
            local_detail: error.to_string().chars().take(300).collect(),
            at_or_after_data: false,
        };
    }
    let text = error.to_string();
    let lower = text.to_ascii_lowercase();
    let class = if lower.contains("timed out") || lower.contains("timeout") {
        ResponseClass::Timeout
    } else if lower.contains("tls") || lower.contains("certificate") || lower.contains("handshake")
    {
        ResponseClass::TlsFailed
    } else {
        stage_class
    };
    SmtpFailure {
        response_class: class,
        smtp_code: None,
        enhanced_code: None,
        local_detail: text.chars().take(300).collect(),
        at_or_after_data: false,
    }
}

fn tls_parameters(target: &SmtpTarget) -> Result<TlsParameters, SmtpFailure> {
    let mut builder = TlsParameters::builder(target.host.clone());
    if let Some(pem) = target.extra_root_cert_pem.as_deref() {
        let certificate = Certificate::from_pem(pem.as_bytes()).map_err(|error| {
            SmtpFailure::new(
                ResponseClass::TlsFailed,
                format!("trust anchor parse failed: {error}"),
            )
        })?;
        builder = builder.add_root_certificate(certificate);
    }
    // NOTE deliberately absent: dangerous_accept_invalid_certs /
    // dangerous_accept_invalid_hostnames. Validation is mandatory (§law).
    builder.build_rustls().map_err(|error| {
        SmtpFailure::new(
            ResponseClass::TlsFailed,
            format!("tls parameters failed: {error}"),
        )
    })
}

pub struct SmtpSession {
    connection: SmtpConnection,
    authenticated: bool,
}

impl std::fmt::Debug for SmtpSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SmtpSession")
            .field("authenticated", &self.authenticated)
            .finish_non_exhaustive()
    }
}

impl SmtpSession {
    /// Connect + EHLO (+ mandatory STARTTLS upgrade on the plain path).
    /// After this returns the channel is ALWAYS encrypted.
    pub fn connect(target: &SmtpTarget) -> Result<SmtpSession, SmtpFailure> {
        let client_id = ClientId::Domain(target.ehlo.clone());
        let tls = tls_parameters(target)?;
        let connect_host = target
            .connect_host
            .clone()
            .unwrap_or_else(|| target.host.clone());
        let server = (connect_host.as_str(), target.port);
        let mut connection = match target.security {
            SmtpSecurity::ImplicitTls => {
                SmtpConnection::connect(server, Some(target.timeout), &client_id, Some(&tls), None)
                    .map_err(|error| {
                        classify_transport_error(&error, ResponseClass::ConnectionFailed)
                    })?
            }
            SmtpSecurity::StartTls => {
                let mut connection =
                    SmtpConnection::connect(server, Some(target.timeout), &client_id, None, None)
                        .map_err(|error| {
                        classify_transport_error(&error, ResponseClass::ConnectionFailed)
                    })?;
                if !connection.can_starttls() {
                    let _ = connection.command(Quit);
                    return Err(SmtpFailure::new(
                        ResponseClass::TlsFailed,
                        "server did not advertise STARTTLS; refusing plaintext session",
                    ));
                }
                connection
                    .starttls(&tls, &client_id)
                    .map_err(|error| classify_transport_error(&error, ResponseClass::TlsFailed))?;
                connection
            }
        };
        if !connection.is_encrypted() {
            let _ = connection.command(Quit);
            return Err(SmtpFailure::new(
                ResponseClass::TlsFailed,
                "channel not encrypted after negotiation",
            ));
        }
        Ok(SmtpSession {
            connection,
            authenticated: false,
        })
    }

    /// AUTH — only reachable on an encrypted session by construction.
    pub fn authenticate(&mut self, credentials: &SmtpCredentials) -> Result<(), SmtpFailure> {
        use lettre::transport::smtp::authentication::{Credentials, Mechanism};
        debug_assert!(self.connection.is_encrypted());
        let creds = Credentials::new(
            credentials.username.clone(),
            credentials.secret.expose_secret().to_string(),
        );
        match self
            .connection
            .auth(&[Mechanism::Plain, Mechanism::Login], &creds)
        {
            Ok(response) if response.is_positive() => {
                self.authenticated = true;
                Ok(())
            }
            Ok(response) => Err(classify_response_failure(&response)),
            Err(error) => Err(classify_transport_error(
                &error,
                ResponseClass::ConnectionFailed,
            )),
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.authenticated
    }

    /// One mail transaction. `before_data` runs after all RCPTs are accepted
    /// and BEFORE the DATA command reaches the wire — the caller commits
    /// `data_started` there; returning Err aborts (cancel/fence honored
    /// strictly before DATA). `after_mail_from` runs once MAIL FROM was
    /// accepted (phase mail_from_sent).
    ///
    /// Failures carry `at_or_after_data` so the caller can apply the
    /// delivery_unknown law without guessing.
    pub fn send_transaction(
        &mut self,
        mail_from: &str,
        recipients: &[String],
        message: &[u8],
        mut after_mail_from: impl FnMut(),
        mut before_data: impl FnMut() -> Result<(), String>,
    ) -> Result<(Response, Vec<(String, Response)>), SmtpFailure> {
        let from_address = if mail_from.is_empty() {
            None
        } else {
            Some(mail_from.parse::<Address>().map_err(|error| {
                SmtpFailure::new(
                    ResponseClass::None,
                    format!("mail_from parse failed: {error}"),
                )
            })?)
        };
        let response = self
            .connection
            .command(Mail::new(from_address, vec![]))
            .map_err(|error| classify_transport_error(&error, ResponseClass::ConnectionFailed))?;
        if !response.is_positive() {
            return Err(classify_response_failure(&response));
        }
        after_mail_from();

        let mut rcpt_responses = Vec::new();
        for recipient in recipients {
            let address = recipient.parse::<Address>().map_err(|error| {
                SmtpFailure::new(
                    ResponseClass::None,
                    format!("recipient parse failed: {error}"),
                )
            })?;
            let response = self
                .connection
                .command(Rcpt::new(address, vec![]))
                .map_err(|error| {
                    classify_transport_error(&error, ResponseClass::ConnectionFailed)
                })?;
            if !response.is_positive() {
                return Err(classify_response_failure(&response));
            }
            rcpt_responses.push((recipient.clone(), response));
        }

        // ---- the DATA boundary (§6b.2) ----
        before_data().map_err(|reason| SmtpFailure::new(ResponseClass::None, reason))?;
        super::email_killpoint("post_data_started_pre_data_cmd");

        let response = self.connection.command(Data).map_err(|error| {
            let mut failure = classify_transport_error(&error, ResponseClass::ConnectionFailed);
            // The DATA command itself went on the wire; ambiguity from here
            // on is at/after DATA.
            failure.at_or_after_data = true;
            failure
        })?;
        if !response.is_positive() {
            // A clean 4xx/5xx to DATA is a server refusal BEFORE the message
            // bytes moved — unambiguous, retry-eligible by class.
            return Err(classify_response_failure(&response));
        }

        // Killpoint honesty (review #17): this client-side point fires after
        // the server's 354 but BEFORE any body byte leaves the device — it is
        // named for exactly that window. The true mid-body death is injected
        // by the SINK (`mid_data_body`, test_support.rs), which aborts the
        // process only after body bytes are on the wire.
        super::email_killpoint("post_data_354_pre_body");
        let final_response = self.connection.message(message).map_err(|error| {
            let mut failure = classify_transport_error(&error, ResponseClass::ConnectionFailed);
            failure.at_or_after_data = true;
            failure
        })?;
        super::email_killpoint("post_2xx_pre_journal");
        if !final_response.is_positive() {
            let mut failure = classify_response_failure(&final_response);
            // A definitive server verdict after DATA is not ambiguous, but it
            // still crossed the DATA boundary; the caller must not retry the
            // same transaction bytes.
            failure.at_or_after_data = true;
            return Err(failure);
        }
        Ok((final_response, rcpt_responses))
    }

    pub fn quit(mut self) {
        let _ = self.connection.command(Quit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::email::test_support::{SinkBehavior, SinkMode, SmtpSink, SINK_TLS_CERT_PEM};

    fn target(port: u16, security: SmtpSecurity) -> SmtpTarget {
        SmtpTarget {
            host: "localhost".to_string(),
            port,
            connect_host: Some("127.0.0.1".to_string()),
            security,
            ehlo: "device.test.diffforge.ai".to_string(),
            extra_root_cert_pem: Some(SINK_TLS_CERT_PEM.to_string()),
            timeout: Duration::from_secs(10),
        }
    }

    #[test]
    fn starttls_session_submits_and_auths_after_tls_only() {
        let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
        let mut session = SmtpSession::connect(&target(sink.port, SmtpSecurity::StartTls)).unwrap();
        session
            .authenticate(&SmtpCredentials {
                username: "user@example.com".to_string(),
                secret: SecretString::from("app-password"),
            })
            .unwrap();
        let mut data_started_hook_ran = false;
        let (response, rcpts) = session
            .send_transaction(
                "sender@example.com",
                &["rcpt@example.net".to_string()],
                b"From: sender@example.com\r\nTo: rcpt@example.net\r\nSubject: hi\r\n\r\nbody\r\n",
                || {},
                || {
                    data_started_hook_ran = true;
                    Ok(())
                },
            )
            .unwrap();
        assert!(data_started_hook_ran);
        assert_eq!(response_code_u16(&response), 250);
        assert_eq!(rcpts.len(), 1);
        session.quit();
        let state = sink.state();
        assert_eq!(state.messages.len(), 1);
        assert!(state.messages[0].tls_active, "message must ride TLS");
        assert!(state.messages[0].authenticated);
        assert!(!state.auth_before_tls, "AUTH must only happen after TLS");
    }

    #[test]
    fn implicit_tls_session_submits() {
        let sink = SmtpSink::start(SinkMode::ImplicitTls, SinkBehavior::default());
        let mut session =
            SmtpSession::connect(&target(sink.port, SmtpSecurity::ImplicitTls)).unwrap();
        let (response, _) = session
            .send_transaction(
                "sender@example.com",
                &["rcpt@example.net".to_string()],
                b"From: sender@example.com\r\n\r\nbody\r\n",
                || {},
                || Ok(()),
            )
            .unwrap();
        assert_eq!(response_code_u16(&response), 250);
        session.quit();
        assert_eq!(sink.state().messages.len(), 1);
    }

    #[test]
    fn missing_starttls_is_tls_failed_never_plaintext() {
        let behavior = SinkBehavior {
            advertise_starttls: false,
            ..SinkBehavior::default()
        };
        let sink = SmtpSink::start(SinkMode::Plain, behavior);
        let error = SmtpSession::connect(&target(sink.port, SmtpSecurity::StartTls)).unwrap_err();
        assert_eq!(error.response_class, ResponseClass::TlsFailed);
        assert_eq!(sink.state().messages.len(), 0);
    }

    #[test]
    fn wrong_hostname_fails_certificate_validation() {
        let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
        let mut bad_target = target(sink.port, SmtpSecurity::StartTls);
        bad_target.host = "not-the-cert-name.example".to_string();
        let error = SmtpSession::connect(&bad_target).unwrap_err();
        assert_eq!(error.response_class, ResponseClass::TlsFailed);
    }

    #[test]
    fn untrusted_cert_fails_without_the_anchor() {
        let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
        let mut bare_target = target(sink.port, SmtpSecurity::StartTls);
        bare_target.extra_root_cert_pem = None; // only webpki roots remain
        let error = SmtpSession::connect(&bare_target).unwrap_err();
        assert_eq!(error.response_class, ResponseClass::TlsFailed);
    }

    #[test]
    fn auth_535_classifies_as_credential_failure() {
        let behavior = SinkBehavior {
            auth_response: "535 5.7.8 authentication credentials invalid".to_string(),
            ..SinkBehavior::default()
        };
        let sink = SmtpSink::start(SinkMode::Plain, behavior);
        let mut session = SmtpSession::connect(&target(sink.port, SmtpSecurity::StartTls)).unwrap();
        let error = session
            .authenticate(&SmtpCredentials {
                username: "user".to_string(),
                secret: SecretString::from("wrong"),
            })
            .unwrap_err();
        assert_eq!(error.smtp_code, Some(535));
        assert!(error.is_credential_failure());
    }

    #[test]
    fn rcpt_rejection_is_classified_pre_data() {
        let mut rcpt_responses = std::collections::BTreeMap::new();
        rcpt_responses.insert(
            "bad@example.net".to_string(),
            "550 5.1.1 user unknown".to_string(),
        );
        let behavior = SinkBehavior {
            rcpt_responses,
            ..SinkBehavior::default()
        };
        let sink = SmtpSink::start(SinkMode::Plain, behavior);
        let mut session = SmtpSession::connect(&target(sink.port, SmtpSecurity::StartTls)).unwrap();
        let error = session
            .send_transaction(
                "sender@example.com",
                &["bad@example.net".to_string()],
                b"From: sender@example.com\r\n\r\nbody\r\n",
                || {},
                || Ok(()),
            )
            .unwrap_err();
        assert_eq!(error.smtp_code, Some(550));
        assert_eq!(error.response_class, ResponseClass::RejectedPermanent);
        assert!(!error.at_or_after_data);
    }

    #[test]
    fn mid_data_disconnect_is_at_or_after_data() {
        let behavior = SinkBehavior {
            drop_mid_data: true,
            ..SinkBehavior::default()
        };
        let sink = SmtpSink::start(SinkMode::Plain, behavior);
        let mut session = SmtpSession::connect(&target(sink.port, SmtpSecurity::StartTls)).unwrap();
        let big_body = format!(
            "From: sender@example.com\r\n\r\n{}\r\n",
            "x".repeat(64 * 1024)
        );
        let error = session
            .send_transaction(
                "sender@example.com",
                &["rcpt@example.net".to_string()],
                big_body.as_bytes(),
                || {},
                || Ok(()),
            )
            .unwrap_err();
        assert!(
            error.at_or_after_data,
            "mid-DATA loss must mark the boundary"
        );
    }

    #[test]
    fn missing_final_response_after_data_is_ambiguous() {
        let behavior = SinkBehavior {
            drop_after_data_before_response: true,
            ..SinkBehavior::default()
        };
        let sink = SmtpSink::start(SinkMode::Plain, behavior);
        let mut session = SmtpSession::connect(&target(sink.port, SmtpSecurity::StartTls)).unwrap();
        let error = session
            .send_transaction(
                "sender@example.com",
                &["rcpt@example.net".to_string()],
                b"From: sender@example.com\r\n\r\nbody\r\n",
                || {},
                || Ok(()),
            )
            .unwrap_err();
        assert!(error.at_or_after_data);
    }

    #[test]
    fn greylist_451_at_mail_from_is_temporary_pre_data() {
        let behavior = SinkBehavior {
            greylist_mail_from: true,
            ..SinkBehavior::default()
        };
        let sink = SmtpSink::start(SinkMode::Plain, behavior);
        let mut session = SmtpSession::connect(&target(sink.port, SmtpSecurity::StartTls)).unwrap();
        let error = session
            .send_transaction(
                "sender@example.com",
                &["rcpt@example.net".to_string()],
                b"From: s@e\r\n\r\nb\r\n",
                || {},
                || Ok(()),
            )
            .unwrap_err();
        assert_eq!(error.smtp_code, Some(451));
        assert_eq!(error.response_class, ResponseClass::RejectedTemporary);
        assert!(!error.at_or_after_data);
    }
}
