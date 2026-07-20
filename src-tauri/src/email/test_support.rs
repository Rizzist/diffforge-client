//! Test doubles for the email stack: a local capturing SMTP sink (loopback
//! only, scriptable failures at every protocol stage) and the killpoint
//! machinery for the plan-§6 device crash matrix. Nothing here talks to
//! real infrastructure; the sink binds 127.0.0.1:0.
//!
//! The sink serves real TLS (STARTTLS on the plain port, or implicit TLS)
//! using a checked-in self-signed localhost certificate; clients validate
//! it as a custom trust anchor with hostname verification still on — the
//! mandatory-validation code path stays exercised end to end.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// Self-signed cert for CN/SAN `localhost` + `127.0.0.1`, valid to 2046.
/// Test trust anchor ONLY — never shipped into any production trust store.
pub const SINK_TLS_CERT_PEM: &str = "-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUSnit9R/6VlXQTrMu/2t6p1wLCgEwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDcyMDA2NDUzNFoXDTQ2MDcx
NTA2NDUzNFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA7CD/IzZxnJOP6KdvWU5edL1p2bBGR4Pu6a4cuWVylIxH
S+bZ5caSwmOzTMJecZ41x+wLPayRnGL05/XezLJAQGwdBJMYM7rROvZlcupT8pah
/VsUZX2kKL13/tcDflqO33ZNTkbEI7uC+NnL2kscWPaQ7lwEAiCrQVlWaxHe7NvE
ZRCSnXgzJVknhRGXrTwpgXRktH7oToRkhv8Xxym9susy/vEnLrwaLEHRv4Kr95k4
itZhtOc+gc3Mn4GQVIUghrI58NqNfNCGzkpHJmXgEd9RvA5rltW0XWkypCmUYJSa
f6wCAh49nZ8KKfjhtrSadKozsuzu+v7c4HdM/lmJ/wIDAQABo28wbTAdBgNVHQ4E
FgQUVwvaTs6B2h7NRgZk+nD6eGxq6QIwHwYDVR0jBBgwFoAUVwvaTs6B2h7NRgZk
+nD6eGxq6QIwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBACNotl+QchNcc/gMs/UWD5Gwoq5syitu
IO8qp+5Gfh8Jp4jXQP+F48IuWOdCq2nKK13wBHQIZlTk1cpnAha+coy8xhWcIDSW
LYsbGx1+uIWhCsP4zGqqylImmajHZsJPFPBck2YhfDE/noSC+YmXKDtlFiKwxxxh
gLrJU+wv4Tf46nH3KXFKzRoyFWnIkWZpuiKI42WIvQjGwLVfZJXZ9zRFSS4rEtyg
5A+X/B4/3V8mYDCvt819FyhQ9d72lxMwreXb0OHAnaP9VG9QZFxzgdBtETY3iKjT
Cch+G3csJSSYQWe1j3cU0gYcNHqCV96fZ/d5bjia5zVPWOl+fcHve2Y=
-----END CERTIFICATE-----
";

const SINK_TLS_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDsIP8jNnGck4/o
p29ZTl50vWnZsEZHg+7prhy5ZXKUjEdL5tnlxpLCY7NMwl5xnjXH7As9rJGcYvTn
9d7MskBAbB0EkxgzutE69mVy6lPylqH9WxRlfaQovXf+1wN+Wo7fdk1ORsQju4L4
2cvaSxxY9pDuXAQCIKtBWVZrEd7s28RlEJKdeDMlWSeFEZetPCmBdGS0fuhOhGSG
/xfHKb2y6zL+8ScuvBosQdG/gqv3mTiK1mG05z6BzcyfgZBUhSCGsjnw2o180IbO
SkcmZeAR31G8DmuW1bRdaTKkKZRglJp/rAICHj2dnwop+OG2tJp0qjOy7O76/tzg
d0z+WYn/AgMBAAECggEAFbxRKrFKR/rKq8SDMBn8q+D7q2QvM/S7EJuhspcvXZPZ
bu0zGumVJ3unTOY0wgn+3VunCpL7XFqSPKqZ9bG6zwikqyp3IdvigqZHtF+e6/Jd
uu/1XVpGutFQsw6hGF0cUF7tbXUqJ4032HxZPXYzMnqP4MEWRV6IenLPd6T6JkdE
m1cUio+w5uIj8F1mWixsn1SABbk6VGJhJCsVtEPwJ9Qk9/Nj1jDu240XGZNAhsE0
NKWTWCjxZfHkrS2YGbnhQz0v6u5VUO+Um5mtghypGkP2E5IT1WSe3IHvZs7MS+aB
mXDyOnLgGOeoP37DIdMowPWVg7gBXK9EWz+gr1mh8QKBgQD9UwlZDvKp4V0pXuIa
m5pXGmfqQfXlHDcWGRdcrqR15mB7zi33L88QC5e0r1kEdKtnoh8wzfGTt3pAw0oM
DsbuwMg09yq2hC9khGwfGVIAuMq3yrxJKanrYlvVVyt7ZV9KsMie6E2HETz58QS+
zzcpII2eM8IVbsO125cYlIOtFQKBgQDun3ceVAkUxQBCDZKWdqcM1Sn8Ag5XzSI2
Pv12mp16rNDJEORo0hwKwfqLOeBLAGFQOOZhO8MaRgOK/ozJTTZjAe1ku7+dhB6m
TFEjZF/sEVGxsrxj6bboFJ8JIi5B8cghyCkGG4z9rgfhlEnxXwEx5XtWNl5Dose2
LMtUSJSnwwKBgQDfZhIRUuhXPiJNMJrPAjgq5mOLp920zZwaxcffeTgZrS+bHulU
WvoM2VxRAG3NSyI5gzRkcsm/DggnAtHTLljrBmHIq8wkJxAwYcOD7W1uq4hCaux+
zNpHdXcs/fGfoXdWw+44jP6JxX7zoEQiDVVE1KtvP4/CHOtE/kEScS5qPQKBgEHM
GNV1CJgAhkSwZ2Yzy3Y/ZPdHPds6Bh/9GHjWw2urMVrv3HuGzBKvUD2JtO4Zabvs
JKJVD0Q0YA+4huuO7ds5EdN/7aMqZiUm0Ay5RbXbRLKB/W5zaGrwHLYxBZ5LZArk
nWNAv4zHqwaplAYJU1QF2g94qF9wCC+UhHB2Hv9vAoGAaZeU1BPerJDagjK6oSav
VmRMVp6OtYTBXIuY94AAy582wEci37/mvm6lAz6xDyRXOx1VZk3WsWklPXT/G48M
dBy4MZTunYI/xZP4rTWG+TAqksEVhwd4NWFNxc1kjgKgkfpn1zHKREj0y761m09S
WUwsg49vvPpVHgnulDe00lI=
-----END PRIVATE KEY-----
";

fn pem_body(pem: &str) -> Vec<u8> {
    let body: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect();
    BASE64.decode(body.as_bytes()).expect("valid PEM body")
}

/// One captured SMTP transaction (a completed DATA).
#[derive(Clone, Debug)]
pub struct CapturedMessage {
    pub mail_from: String,
    pub rcpt_to: Vec<String>,
    pub data: Vec<u8>,
    pub tls_active: bool,
    pub authenticated: bool,
}

/// Scripted behavior for the sink, keyed by protocol stage. Response strings
/// are full SMTP lines without CRLF.
#[derive(Clone, Debug)]
pub struct SinkBehavior {
    /// Response to AUTH (e.g. "235 2.7.0 accepted" or "535 5.7.8 bad creds").
    pub auth_response: String,
    /// Response to MAIL FROM.
    pub mail_from_response: String,
    /// Per-address RCPT overrides; default below applies otherwise.
    pub rcpt_responses: BTreeMap<String, String>,
    pub rcpt_default_response: String,
    /// Response to the DATA command itself (354 to proceed).
    pub data_command_response: String,
    /// Final response after the message body is received.
    pub data_final_response: String,
    /// Drop the connection midway through receiving DATA (post-354).
    pub drop_mid_data: bool,
    /// Accept the full body then close WITHOUT any final response — the
    /// classic delivery_unknown producer.
    pub drop_after_data_before_response: bool,
    /// Drop right after the greeting (connection-failed class).
    pub drop_after_greeting: bool,
    /// Advertise STARTTLS (plain listener only).
    pub advertise_starttls: bool,
    /// Refuse mail with a 4xx at MAIL FROM (greylist-style temp failure).
    pub greylist_mail_from: bool,
}

impl Default for SinkBehavior {
    fn default() -> Self {
        SinkBehavior {
            auth_response: "235 2.7.0 authentication successful".to_string(),
            mail_from_response: "250 2.1.0 sender ok".to_string(),
            rcpt_responses: BTreeMap::new(),
            rcpt_default_response: "250 2.1.5 recipient ok".to_string(),
            data_command_response: "354 end data with <CR><LF>.<CR><LF>".to_string(),
            data_final_response: "250 2.0.0 queued as sink-0001".to_string(),
            drop_mid_data: false,
            drop_after_data_before_response: false,
            drop_after_greeting: false,
            advertise_starttls: true,
            greylist_mail_from: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SinkMode {
    /// Plain listener; STARTTLS offered/required per behavior.
    Plain,
    /// TLS from the first byte (the 465 shape).
    ImplicitTls,
}

#[derive(Default)]
pub struct SinkState {
    pub messages: Vec<CapturedMessage>,
    pub transcript: Vec<String>,
    /// True if any AUTH command arrived before TLS was established — the
    /// AUTH-only-after-TLS law asserts this stays false.
    pub auth_before_tls: bool,
    pub connections: u32,
}

pub struct SmtpSink {
    pub port: u16,
    pub mode: SinkMode,
    state: Arc<Mutex<SinkState>>,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl SmtpSink {
    pub fn start(mode: SinkMode, behavior: SinkBehavior) -> SmtpSink {
        let listener = TcpListener::bind("127.0.0.1:0").expect("sink bind");
        let port = listener.local_addr().expect("sink addr").port();
        listener.set_nonblocking(true).expect("sink nonblocking");
        let state = Arc::new(Mutex::new(SinkState::default()));
        let shutdown = Arc::new(AtomicBool::new(false));
        let thread_state = state.clone();
        let thread_shutdown = shutdown.clone();
        let handle = std::thread::spawn(move || {
            let tls_config = Arc::new(sink_tls_config());
            while !thread_shutdown.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        stream.set_nonblocking(false).ok();
                        {
                            let mut guard = thread_state.lock().unwrap();
                            guard.connections += 1;
                        }
                        let conn_state = thread_state.clone();
                        let conn_behavior = behavior.clone();
                        let conn_tls = tls_config.clone();
                        std::thread::spawn(move || {
                            let _ = handle_connection(
                                stream,
                                mode,
                                &conn_behavior,
                                &conn_state,
                                &conn_tls,
                            );
                        });
                    }
                    Err(ref error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        SmtpSink {
            port,
            mode,
            state,
            shutdown,
            handle: Some(handle),
        }
    }

    pub fn state(&self) -> SinkState {
        let guard = self.state.lock().unwrap();
        SinkState {
            messages: guard.messages.clone(),
            transcript: guard.transcript.clone(),
            auth_before_tls: guard.auth_before_tls,
            connections: guard.connections,
        }
    }
}

impl Drop for SmtpSink {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn sink_tls_config() -> rustls::ServerConfig {
    let cert = rustls::pki_types::CertificateDer::from(pem_body(SINK_TLS_CERT_PEM));
    let key = rustls::pki_types::PrivateKeyDer::Pkcs8(pem_body(SINK_TLS_KEY_PEM).into());
    rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .expect("sink TLS config")
}

/// A stream that may be plain TCP or TLS-wrapped mid-session.
enum SinkStream {
    Plain(TcpStream),
    Tls(Box<rustls::StreamOwned<rustls::ServerConnection, TcpStream>>),
}

impl SinkStream {
    fn is_tls(&self) -> bool {
        matches!(self, SinkStream::Tls(_))
    }
}

impl Read for SinkStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            SinkStream::Plain(stream) => stream.read(buf),
            SinkStream::Tls(stream) => stream.read(buf),
        }
    }
}

impl Write for SinkStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            SinkStream::Plain(stream) => stream.write(buf),
            SinkStream::Tls(stream) => stream.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            SinkStream::Plain(stream) => stream.flush(),
            SinkStream::Tls(stream) => stream.flush(),
        }
    }
}

fn write_line(stream: &mut SinkStream, line: &str) -> std::io::Result<()> {
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\r\n")?;
    stream.flush()
}

fn read_line(reader: &mut SinkStream) -> std::io::Result<Option<String>> {
    // Byte-at-a-time is fine for a test sink.
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let read = reader.read(&mut byte)?;
        if read == 0 {
            return Ok(if line.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(&line).to_string())
            });
        }
        if byte[0] == b'\n' {
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(Some(String::from_utf8_lossy(&line).to_string()));
        }
        line.push(byte[0]);
    }
}

fn ehlo_response(stream: &mut SinkStream, behavior: &SinkBehavior) -> std::io::Result<()> {
    let mut lines = vec!["250-sink.localhost".to_string(), "250-8BITMIME".to_string()];
    if behavior.advertise_starttls && !stream.is_tls() {
        lines.push("250-STARTTLS".to_string());
    }
    if stream.is_tls() {
        lines.push("250-AUTH PLAIN LOGIN".to_string());
    }
    lines.push("250 SIZE 26214400".to_string());
    for line in lines {
        write_line(stream, &line)?;
    }
    Ok(())
}

fn handle_connection(
    tcp: TcpStream,
    mode: SinkMode,
    behavior: &SinkBehavior,
    state: &Arc<Mutex<SinkState>>,
    tls_config: &Arc<rustls::ServerConfig>,
) -> std::io::Result<()> {
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(20)))?;
    let mut stream = match mode {
        SinkMode::Plain => SinkStream::Plain(tcp),
        SinkMode::ImplicitTls => {
            let server = rustls::ServerConnection::new(tls_config.clone())
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            SinkStream::Tls(Box::new(rustls::StreamOwned::new(server, tcp)))
        }
    };
    write_line(&mut stream, "220 sink.localhost SMTP test sink")?;
    if behavior.drop_after_greeting {
        return Ok(());
    }

    let mut mail_from = String::new();
    let mut rcpt_to: Vec<String> = Vec::new();
    let mut authenticated = false;

    loop {
        let Some(line) = read_line(&mut stream)? else {
            return Ok(());
        };
        {
            let mut guard = state.lock().unwrap();
            guard.transcript.push(line.clone());
        }
        let upper = line.to_ascii_uppercase();
        if upper.starts_with("EHLO") || upper.starts_with("HELO") {
            ehlo_response(&mut stream, behavior)?;
        } else if upper.starts_with("STARTTLS") {
            if stream.is_tls() {
                write_line(&mut stream, "503 5.5.1 already in TLS")?;
                continue;
            }
            write_line(&mut stream, "220 2.0.0 ready to start TLS")?;
            let SinkStream::Plain(tcp) = stream else {
                unreachable!()
            };
            let server = rustls::ServerConnection::new(tls_config.clone())
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            stream = SinkStream::Tls(Box::new(rustls::StreamOwned::new(server, tcp)));
        } else if upper.starts_with("AUTH") {
            if !stream.is_tls() {
                let mut guard = state.lock().unwrap();
                guard.auth_before_tls = true;
            }
            if behavior.auth_response.starts_with("235") {
                authenticated = true;
            }
            // AUTH PLAIN with initial response completes in one line;
            // otherwise challenge once for the payload.
            if upper.starts_with("AUTH PLAIN") && line.trim().len() <= "AUTH PLAIN".len() + 1 {
                write_line(&mut stream, "334 ")?;
                let _ = read_line(&mut stream)?;
            }
            write_line(&mut stream, &behavior.auth_response)?;
        } else if upper.starts_with("MAIL FROM:") {
            mail_from = line["MAIL FROM:".len()..]
                .trim()
                .trim_start_matches('<')
                .trim_end_matches(|c| c == '>' || c == ' ')
                .split(' ')
                .next()
                .unwrap_or("")
                .trim_end_matches('>')
                .to_string();
            if behavior.greylist_mail_from {
                write_line(&mut stream, "451 4.7.1 greylisted, try again later")?;
                continue;
            }
            write_line(&mut stream, &behavior.mail_from_response)?;
        } else if upper.starts_with("RCPT TO:") {
            let address = line["RCPT TO:".len()..]
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
            let response = behavior
                .rcpt_responses
                .get(&address)
                .cloned()
                .unwrap_or_else(|| behavior.rcpt_default_response.clone());
            if response.starts_with("25") {
                rcpt_to.push(address);
            }
            write_line(&mut stream, &response)?;
        } else if upper.starts_with("DATA") {
            if !behavior.data_command_response.starts_with("354") {
                write_line(&mut stream, &behavior.data_command_response)?;
                continue;
            }
            write_line(&mut stream, &behavior.data_command_response)?;
            let mut data: Vec<u8> = Vec::new();
            let mut reader = BufReader::new(&mut stream);
            let mut raw_line = Vec::new();
            loop {
                raw_line.clear();
                let read = read_until_lf(&mut reader, &mut raw_line)?;
                if read == 0 {
                    return Ok(()); // client vanished mid-DATA
                }
                if raw_line == b".\r\n" || raw_line == b".\n" {
                    break;
                }
                data.extend_from_slice(&raw_line);
                if behavior.drop_mid_data && data.len() > 64 {
                    return Ok(()); // simulate connection loss mid-DATA
                }
            }
            if behavior.drop_after_data_before_response {
                return Ok(()); // full body, no response: delivery_unknown
            }
            {
                let mut guard = state.lock().unwrap();
                guard.messages.push(CapturedMessage {
                    mail_from: mail_from.clone(),
                    rcpt_to: rcpt_to.clone(),
                    data: data.clone(),
                    tls_active: stream.is_tls(),
                    authenticated,
                });
            }
            write_line(&mut stream, &behavior.data_final_response)?;
            rcpt_to.clear();
        } else if upper.starts_with("RSET") {
            mail_from.clear();
            rcpt_to.clear();
            write_line(&mut stream, "250 2.0.0 ok")?;
        } else if upper.starts_with("QUIT") {
            write_line(&mut stream, "221 2.0.0 bye")?;
            return Ok(());
        } else if upper.starts_with("NOOP") {
            write_line(&mut stream, "250 2.0.0 ok")?;
        } else {
            write_line(&mut stream, "500 5.5.2 command unrecognized")?;
        }
    }
}

fn read_until_lf<R: BufRead>(reader: &mut R, out: &mut Vec<u8>) -> std::io::Result<usize> {
    reader.read_until(b'\n', out)
}

// ---------------------------------------------------------------------
// Scripted cloud transport (no network, no ws)
// ---------------------------------------------------------------------

use crate::email::cloud_transport::{EmailCloudTransport, PrepareOutcome, RenewOutcome};
use serde_json::Value;
use std::collections::VecDeque;

/// Fake `EmailCloudTransport`: scripted prepare/renew outcomes, in-memory
/// MIME bytes keyed by path, and a capture of every emitted send event.
#[derive(Default)]
pub struct FakeCloudTransport {
    pub prepare_outcomes: Mutex<VecDeque<Result<PrepareOutcome, String>>>,
    pub renew_outcomes: Mutex<VecDeque<Result<RenewOutcome, String>>>,
    pub mime_bytes: Mutex<BTreeMap<String, Vec<u8>>>,
    pub emitted_events: Mutex<Vec<Value>>,
    pub prepare_calls: Mutex<u32>,
    pub renew_calls: Mutex<u32>,
}

impl FakeCloudTransport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn script_prepare(&self, outcome: Result<PrepareOutcome, String>) {
        self.prepare_outcomes.lock().unwrap().push_back(outcome);
    }

    pub fn script_renew(&self, outcome: Result<RenewOutcome, String>) {
        self.renew_outcomes.lock().unwrap().push_back(outcome);
    }

    pub fn put_mime(&self, path: &str, bytes: Vec<u8>) {
        self.mime_bytes
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes);
    }

    pub fn events(&self) -> Vec<Value> {
        self.emitted_events.lock().unwrap().clone()
    }

    pub fn event_phases(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|event| {
                event
                    .get("phase")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect()
    }
}

impl EmailCloudTransport for FakeCloudTransport {
    fn prepare(
        &self,
        _send_job_id: &str,
        _generation: u32,
        _command_id: &str,
        _binding_id: &str,
        _last_lease_epoch: u64,
    ) -> Result<PrepareOutcome, String> {
        *self.prepare_calls.lock().unwrap() += 1;
        self.prepare_outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Err("no scripted prepare outcome".to_string()))
    }

    fn lease_renew(
        &self,
        _send_job_id: &str,
        _generation: u32,
        _lease_id: &str,
        _lease_epoch: u64,
        _fence_token: &str,
        _phase: &str,
    ) -> Result<RenewOutcome, String> {
        *self.renew_calls.lock().unwrap() += 1;
        self.renew_outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| {
                Ok(RenewOutcome::Extended {
                    expires_at_ms: now_ms_for_fake() + 120_000,
                })
            })
    }

    fn download_mime(&self, path: &str, _transfer_id: &str) -> Result<Vec<u8>, String> {
        self.mime_bytes
            .lock()
            .unwrap()
            .get(path)
            .cloned()
            .ok_or_else(|| format!("no scripted mime bytes at {path}"))
    }

    fn emit_send_event(&self, payload: &Value) -> Result<(), String> {
        self.emitted_events.lock().unwrap().push(payload.clone());
        Ok(())
    }
}

fn now_ms_for_fake() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Build a leased PrepareOutcome for tests around a given MIME body.
pub fn leased_grant_for(
    mime_path: &str,
    mime_bytes: &[u8],
    mail_from: &str,
    identity_address: &str,
    recipients: &[(&str, &str)],
    mode: &str,
) -> PrepareOutcome {
    use crate::email::cloud_transport::{NativeGrant, PrepareGrant};
    use crate::email::mime::{EnvelopeRecipient, PrepareEnvelope};
    PrepareOutcome::Leased(Box::new(PrepareGrant {
        lease_id: format!("lease-{}", uuid::Uuid::new_v4()),
        lease_epoch: 1,
        fence_token: "fence-test-token".to_string(),
        expires_at_ms: now_ms_for_fake() + 120_000,
        mime_transfer_id: format!("transfer-{}", uuid::Uuid::new_v4()),
        mime_path: mime_path.to_string(),
        mime_sha256: crate::email::contract::sha256_hex(mime_bytes),
        mime_size_bytes: mime_bytes.len() as u64,
        envelope: PrepareEnvelope {
            mail_from: mail_from.to_string(),
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
        },
        identity_id: "identity-test".to_string(),
        identity_address: identity_address.to_string(),
        mode: mode.to_string(),
        native: if mode == "native" {
            Some(NativeGrant {
                dkim_domain: identity_address
                    .split('@')
                    .nth(1)
                    .unwrap_or("example.com")
                    .to_string(),
                dkim_selector: "dfmail1".to_string(),
                dkim_pubkey_fingerprint: String::new(),
                ehlo: "mail.test.example".to_string(),
                authorized_ips: vec![],
            })
        } else {
            None
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sink_captures_plain_transcript() {
        let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
        let mut stream = TcpStream::connect(("127.0.0.1", sink.port)).unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with("220"));
        stream.write_all(b"EHLO test.local\r\n").unwrap();
        let mut saw_starttls = false;
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line.contains("STARTTLS") {
                saw_starttls = true;
            }
            if line.starts_with("250 ") {
                break;
            }
        }
        assert!(saw_starttls);
        stream.write_all(b"QUIT\r\n").unwrap();
        line.clear();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with("221"));
        let state = sink.state();
        assert_eq!(state.connections, 1);
        assert!(state.transcript.iter().any(|entry| entry.starts_with("EHLO")));
    }
}
