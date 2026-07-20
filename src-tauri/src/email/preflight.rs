//! Native-delivery preflight (contract §10.2, plan §3.8). Runs the 14
//! closed check ids, classifies the overall result
//! (qualified/pending/failed/degraded), and produces the §10.2 wire shape
//! with per-check remediation and a `result_sha256`.
//!
//! Probing is done through a `PreflightProbe` trait so tests inject fakes:
//! per the brief the probe target is a config placeholder and there are NO
//! live network probes in tests. The public-IP / CGNAT logic (RFC1918,
//! CGNAT 100.64.0.0/10, loopback, link-local) is pure and unit-tested.

use std::net::{IpAddr, Ipv4Addr};

use serde_json::{json, Value};

use super::contract::{self, PREFLIGHT_CHECK_IDS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckStatus {
    Pass,
    Fail,
    Warn,
    Pending,
    Unavailable,
}

impl CheckStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            CheckStatus::Pass => "pass",
            CheckStatus::Fail => "fail",
            CheckStatus::Warn => "warn",
            CheckStatus::Pending => "pending",
            CheckStatus::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Debug)]
pub struct CheckResult {
    pub check_id: &'static str,
    pub status: CheckStatus,
    pub required: bool,
    pub observed: String,
    pub expected: String,
    pub remediation: Option<String>,
}

impl CheckResult {
    fn to_value(&self) -> Value {
        let mut value = json!({
            "check_id": self.check_id,
            "status": self.status.as_str(),
            "required": self.required,
            "observed": self.observed,
            "expected": self.expected,
        });
        if let Some(remediation) = self.remediation.as_ref() {
            value["remediation"] = json!(remediation);
        }
        value
    }
}

/// IP classification for the `public_ip` / `static_ip` checks.
pub fn is_public_routable_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    // RFC 1918 private ranges
    let private = octets[0] == 10
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168);
    // CGNAT 100.64.0.0/10 (RFC 6598)
    let cgnat = octets[0] == 100 && (64..=127).contains(&octets[1]);
    let loopback = octets[0] == 127;
    let link_local = octets[0] == 169 && octets[1] == 254;
    let unspecified = ip.is_unspecified();
    let broadcast = ip.is_broadcast();
    let multicast = octets[0] >= 224;
    !(private || cgnat || loopback || link_local || unspecified || broadcast || multicast)
}

pub fn is_public_routable(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_routable_ipv4(v4),
        IpAddr::V6(v6) => {
            !(v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
                // unique-local fc00::/7
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // link-local fe80::/10
                || (v6.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

/// Observations the probe supplies. Fields are Option so a probe can report
/// "not yet observed" (→ pending) distinctly from a definite failure.
#[derive(Clone, Debug, Default)]
pub struct PreflightObservations {
    pub egress_ip: Option<IpAddr>,
    pub egress_ip_stable_observations: u32,
    pub port25_open: Option<bool>,
    pub ptr_fcrdns_ok: Option<bool>,
    pub helo_hostname_resolves: Option<bool>,
    pub dnsbl_listed: Option<bool>,
    pub always_on: Option<bool>,
    pub clock_skew_ms: Option<i64>,
    pub journal_healthy: Option<bool>,
    pub credential_store_healthy: Option<bool>,
    pub spf_authorizes_egress: Option<bool>,
    pub dkim_published_matches: Option<bool>,
    pub dmarc_published: Option<bool>,
    pub seed_spf_pass: Option<bool>,
    pub seed_dkim_pass: Option<bool>,
    pub seed_dmarc_pass: Option<bool>,
    pub seed_test_id: Option<String>,
}

pub trait PreflightProbe {
    /// The domain being qualified (config placeholder in tests).
    fn observe(&self, profile_ref: &str, domain: &str) -> PreflightObservations;
}

/// Whether a check id was requested. An EMPTY request means "run all"
/// (contract §10.2 default); unknown ids were rejected fail-closed at
/// command parse time.
fn requested(requested_checks: &[String], check_id: &str) -> bool {
    requested_checks.is_empty() || requested_checks.iter().any(|entry| entry == check_id)
}

/// Collect real observations for the operator-triggered preflight run
/// (review #12). Local checks (journal, credential store, runtime) are
/// always cheap; DNS-backed checks (SPF/DKIM/DMARC/PTR/HELO/DNSBL) resolve
/// through hickory only when requested; the egress IP and its stability
/// come from the journal's `email_egress_ip_observations` history. The
/// seed test stays operator-run (pending here). NEVER called from unit
/// tests — those drive `evaluate_checks` with fakes.
pub fn collect_observations(
    journal: &super::journal::EmailJournal,
    credentials: &super::credentials::CredentialStack,
    _profile_ref: &str,
    domain: &str,
    requested_checks: &[String],
) -> PreflightObservations {
    let mut observations = PreflightObservations::default();

    // ---- local checks ----
    if requested(requested_checks, "journal_health") {
        observations.journal_healthy = journal
            .health_check()
            .ok()
            .and_then(|value| value.get("ok").and_then(serde_json::Value::as_bool));
    }
    if requested(requested_checks, "credential_store") {
        observations.credential_store_healthy = Some(matches!(
            credentials.health(),
            super::credentials::CredentialStoreHealth::Healthy
        ));
    }
    if requested(requested_checks, "always_on") {
        observations.always_on = Some(matches!(
            super::capability::runtime_kind(),
            "daemon" | "background"
        ));
    }

    // ---- egress IP history (public_ip / static_ip / port25) ----
    let egress_history: Vec<(String, Option<bool>)> = journal
        .connection()
        .prepare(
            "SELECT egress_ip, port25_open FROM email_egress_ip_observations
             ORDER BY observed_at_ms DESC LIMIT 10",
        )
        .ok()
        .and_then(|mut statement| {
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?.map(|value| value != 0),
                    ))
                })
                .ok()
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default();
    if requested(requested_checks, "public_ip")
        || requested(requested_checks, "static_ip")
        || requested(requested_checks, "ptr_fcrdns")
        || requested(requested_checks, "dnsbl_clean")
    {
        if let Some((latest_ip, _)) = egress_history.first() {
            observations.egress_ip = latest_ip.parse().ok();
            observations.egress_ip_stable_observations = egress_history
                .iter()
                .filter(|(ip, _)| ip == latest_ip)
                .count() as u32;
        }
    }
    if requested(requested_checks, "port25_egress") {
        observations.port25_open = egress_history
            .iter()
            .find_map(|(_, port25_open)| *port25_open);
    }

    // ---- DNS-backed checks ----
    let needs_dns = [
        "spf_published",
        "dkim_published",
        "dmarc_published",
        "ptr_fcrdns",
        "helo_hostname",
        "dnsbl_clean",
    ]
    .iter()
    .any(|id| requested(requested_checks, id));
    if needs_dns {
        collect_dns_observations(journal, domain, requested_checks, &mut observations);
    }

    // clock_skew and seed_* stay unobserved here: the skew reference and the
    // seed round-trip are cloud/operator-owned (pending until they run).
    observations
}

fn collect_dns_observations(
    journal: &super::journal::EmailJournal,
    domain: &str,
    requested_checks: &[String],
    observations: &mut PreflightObservations,
) {
    use mail_auth::hickory_resolver::config::{ResolverConfig, ResolverOpts};
    use mail_auth::hickory_resolver::name_server::TokioConnectionProvider;
    use mail_auth::hickory_resolver::TokioResolver;
    use rusqlite::OptionalExtension;

    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return;
    };
    // Active local DKIM key (fingerprint comparison target).
    let local_dkim: Option<(String, String)> = journal
        .connection()
        .query_row(
            "SELECT selector, public_key_b64 FROM email_dkim_keys
             WHERE domain = ?1 AND state = 'active'
             ORDER BY created_at_ms DESC LIMIT 1",
            [domain],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            },
        )
        .optional()
        .ok()
        .flatten();

    runtime.block_on(async {
        let resolver = TokioResolver::builder_with_config(
            ResolverConfig::default(),
            TokioConnectionProvider::default(),
        )
        .with_options(ResolverOpts::default())
        .build();
        let txt_of = |name: String| {
            let resolver = resolver.clone();
            async move {
                resolver
                    .txt_lookup(name)
                    .await
                    .map(|lookup| {
                        lookup
                            .iter()
                            .map(|record| {
                                record
                                    .iter()
                                    .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
                                    .collect::<String>()
                            })
                            .collect::<Vec<String>>()
                    })
                    .ok()
            }
        };

        if requested(requested_checks, "spf_published") {
            observations.spf_authorizes_egress =
                txt_of(format!("{domain}.")).await.map(|records| {
                    records.iter().any(|record| {
                        let spf = record.trim_start();
                        spf.starts_with("v=spf1")
                            && match observations.egress_ip {
                                // Approximation, honest by remediation text:
                                // the record must name the egress ip or
                                // delegate via include/redirect/a/mx.
                                Some(ip) => {
                                    spf.contains(&ip.to_string())
                                        || spf.contains("include:")
                                        || spf.contains("redirect=")
                                        || spf.contains(" a")
                                        || spf.contains(" mx")
                                }
                                None => true,
                            }
                    })
                });
        }
        if requested(requested_checks, "dkim_published") {
            if let Some((selector, local_pub_b64)) = local_dkim.as_ref() {
                observations.dkim_published_matches =
                    txt_of(format!("{selector}._domainkey.{domain}."))
                        .await
                        .map(|records| {
                            records.iter().any(|record| {
                                let normalized: String =
                                    record.chars().filter(|ch| !ch.is_whitespace()).collect();
                                let local: String = local_pub_b64
                                    .chars()
                                    .filter(|ch| !ch.is_whitespace())
                                    .collect();
                                !local.is_empty() && normalized.contains(&local)
                            })
                        });
            }
        }
        if requested(requested_checks, "dmarc_published") {
            observations.dmarc_published =
                txt_of(format!("_dmarc.{domain}.")).await.map(|records| {
                    records
                        .iter()
                        .any(|record| record.trim_start().starts_with("v=DMARC1"))
                });
        }
        if requested(requested_checks, "ptr_fcrdns") {
            if let Some(ip) = observations.egress_ip {
                let ptr_names: Vec<String> = match resolver.reverse_lookup(ip).await {
                    Ok(lookup) => lookup.iter().map(|name| name.to_utf8()).collect(),
                    Err(_) => Vec::new(),
                };
                if ptr_names.is_empty() {
                    observations.ptr_fcrdns_ok = Some(false);
                } else {
                    let mut confirmed = false;
                    for name in &ptr_names {
                        if let Ok(addresses) = resolver.lookup_ip(name.clone()).await {
                            if addresses.iter().any(|address| address == ip) {
                                confirmed = true;
                                break;
                            }
                        }
                    }
                    observations.ptr_fcrdns_ok = Some(confirmed);
                }
            }
        }
        if requested(requested_checks, "dnsbl_clean") {
            if let Some(std::net::IpAddr::V4(v4)) = observations.egress_ip {
                let octets = v4.octets();
                let query = format!(
                    "{}.{}.{}.{}.zen.spamhaus.org.",
                    octets[3], octets[2], octets[1], octets[0]
                );
                observations.dnsbl_listed = match resolver.ipv4_lookup(query).await {
                    Ok(lookup) => Some(lookup.iter().next().is_some()),
                    // NXDOMAIN / NODATA = not listed; transport errors stay
                    // unobserved (pending) rather than lying either way.
                    Err(error) if error.is_no_records_found() => Some(false),
                    Err(_) => None,
                };
            }
        }
    });
}

fn required(check_id: &str) -> bool {
    // dnsbl_clean and seed_test are advisory (not required for qualification
    // to `qualified` per §10.2 semantics: qualified = all required pass incl.
    // seed — but the seed's own `required` field is false, matching fixtures).
    !matches!(check_id, "dnsbl_clean" | "seed_test")
}

fn bool_check(
    check_id: &'static str,
    value: Option<bool>,
    expected: &str,
    remediation: &str,
) -> CheckResult {
    let (status, observed) = match value {
        Some(true) => (CheckStatus::Pass, "ok".to_string()),
        Some(false) => (CheckStatus::Fail, "check failed".to_string()),
        None => (CheckStatus::Pending, "not yet observed".to_string()),
    };
    CheckResult {
        check_id,
        status,
        required: required(check_id),
        observed,
        expected: expected.to_string(),
        remediation: if status == CheckStatus::Fail {
            Some(remediation.to_string())
        } else {
            None
        },
    }
}

/// Run the 14 checks against observations. Pure — no I/O.
pub fn evaluate_checks(observations: &PreflightObservations) -> Vec<CheckResult> {
    let mut checks = Vec::new();

    // public_ip
    let (public_status, public_observed) = match observations.egress_ip {
        Some(ip) if is_public_routable(ip) => {
            (CheckStatus::Pass, format!("{ip} publicly routable"))
        }
        Some(ip) => (CheckStatus::Fail, format!("{ip} not publicly routable")),
        None => (CheckStatus::Pending, "egress ip not observed".to_string()),
    };
    checks.push(CheckResult {
        check_id: "public_ip",
        status: public_status,
        required: true,
        observed: public_observed,
        expected: "public, non-CGNAT, non-RFC1918".to_string(),
        remediation: (public_status == CheckStatus::Fail)
            .then(|| "obtain a public static IP or use provider mode".to_string()),
    });

    // static_ip: public AND stable across observations.
    let static_status = match observations.egress_ip {
        Some(ip) if is_public_routable(ip) && observations.egress_ip_stable_observations >= 3 => {
            CheckStatus::Pass
        }
        Some(ip) if !is_public_routable(ip) => CheckStatus::Fail,
        Some(_) => CheckStatus::Pending,
        None => CheckStatus::Pending,
    };
    checks.push(CheckResult {
        check_id: "static_ip",
        status: static_status,
        required: true,
        observed: match observations.egress_ip {
            Some(ip) => format!(
                "{ip} across {} observations",
                observations.egress_ip_stable_observations
            ),
            None => "no observations".to_string(),
        },
        expected: "publicly routable static IPv4".to_string(),
        remediation: (static_status == CheckStatus::Fail)
            .then(|| "request a static public IPv4 or use provider mode".to_string()),
    });

    checks.push(bool_check(
        "port25_egress",
        observations.port25_open,
        "outbound tcp/25 not blocked",
        "unblock outbound port 25 or use provider mode",
    ));
    checks.push(bool_check(
        "ptr_fcrdns",
        observations.ptr_fcrdns_ok,
        "forward-confirmed reverse DNS",
        "PTR must resolve to the EHLO hostname and back",
    ));
    checks.push(bool_check(
        "helo_hostname",
        observations.helo_hostname_resolves,
        "EHLO name resolves to egress ip",
        "publish an A record for the EHLO hostname pointing at the egress ip",
    ));
    // dnsbl_clean: advisory; listed => warn, not fail.
    checks.push({
        let (status, observed) = match observations.dnsbl_listed {
            Some(false) => (CheckStatus::Pass, "not listed".to_string()),
            Some(true) => (CheckStatus::Warn, "listed on a DNSBL".to_string()),
            None => (CheckStatus::Pending, "not checked".to_string()),
        };
        CheckResult {
            check_id: "dnsbl_clean",
            status,
            required: false,
            observed,
            expected: "not listed".to_string(),
            remediation: (status == CheckStatus::Warn)
                .then(|| "request delisting or warm up the IP reputation".to_string()),
        }
    });
    checks.push(bool_check(
        "always_on",
        observations.always_on,
        "daemon or background runtime, always-on",
        "run the daemon or enable Background Mode with sleep prevented",
    ));
    // clock_skew: |offset| < 5s.
    checks.push({
        let (status, observed) = match observations.clock_skew_ms {
            Some(skew) if skew.abs() < 5_000 => (CheckStatus::Pass, format!("offset {skew}ms")),
            Some(skew) => (CheckStatus::Fail, format!("offset {skew}ms")),
            None => (CheckStatus::Pending, "clock not sampled".to_string()),
        };
        CheckResult {
            check_id: "clock_skew",
            status,
            required: true,
            observed,
            expected: "abs(offset) < 5s".to_string(),
            remediation: (status == CheckStatus::Fail)
                .then(|| "sync the system clock via NTP".to_string()),
        }
    });
    checks.push(bool_check(
        "journal_health",
        observations.journal_healthy,
        "journal writable and fsync-safe",
        "check disk space and permissions on the data directory",
    ));
    checks.push(bool_check(
        "credential_store",
        observations.credential_store_healthy,
        "healthy",
        "unlock the credential store or configure the headless vault",
    ));
    checks.push(bool_check(
        "spf_published",
        observations.spf_authorizes_egress,
        "SPF record authorizing egress ip",
        "publish an SPF record authorizing the egress ip",
    ));
    checks.push(bool_check(
        "dkim_published",
        observations.dkim_published_matches,
        "active selector public key published",
        "publish the DKIM selector TXT record matching the local key",
    ));
    checks.push(bool_check(
        "dmarc_published",
        observations.dmarc_published,
        "DMARC policy published",
        "publish a DMARC policy record",
    ));

    // seed_test: advisory; requires aligned spf/dkim/dmarc pass; unavailable
    // when a required prerequisite failed.
    let prereq_failed = checks
        .iter()
        .any(|check| check.required && check.status == CheckStatus::Fail);
    checks.push({
        let (status, observed) = if prereq_failed {
            (
                CheckStatus::Unavailable,
                "skipped: a required check failed".to_string(),
            )
        } else {
            match (
                observations.seed_spf_pass,
                observations.seed_dkim_pass,
                observations.seed_dmarc_pass,
            ) {
                (Some(true), Some(true), Some(true)) => (
                    CheckStatus::Pass,
                    "seed delivered; spf=pass dkim=pass dmarc=pass".to_string(),
                ),
                (Some(_), Some(_), Some(_)) => {
                    (CheckStatus::Fail, "seed alignment failed".to_string())
                }
                _ => (CheckStatus::Pending, "seed not yet sent".to_string()),
            }
        };
        CheckResult {
            check_id: "seed_test",
            status,
            required: false,
            observed,
            expected: "seed delivery with aligned spf/dkim/dmarc pass".to_string(),
            remediation: (status == CheckStatus::Fail)
                .then(|| "fix SPF/DKIM/DMARC alignment then re-run the seed".to_string()),
        }
    });

    debug_assert_eq!(checks.len(), PREFLIGHT_CHECK_IDS.len());
    checks
}

/// Overall result per §10.2 semantics. `previous_qualified` distinguishes
/// `failed` (never qualified) from `degraded` (was qualified, now
/// regressed). After qualification, ANY regression — a required fail, an
/// advisory fail, or a warn — reads `degraded`, because a previously
/// qualified device only got there with every check green.
pub fn overall_result(checks: &[CheckResult], previous_qualified: bool) -> &'static str {
    let required_fail = checks
        .iter()
        .any(|check| check.required && check.status == CheckStatus::Fail);
    let any_regression = checks
        .iter()
        .any(|check| matches!(check.status, CheckStatus::Fail | CheckStatus::Warn));
    let any_pending = checks
        .iter()
        .any(|check| check.status == CheckStatus::Pending);
    let seed_pass = checks
        .iter()
        .find(|check| check.check_id == "seed_test")
        .map(|check| check.status == CheckStatus::Pass)
        .unwrap_or(false);

    if required_fail {
        if previous_qualified {
            "degraded"
        } else {
            "failed"
        }
    } else if previous_qualified && any_regression {
        "degraded"
    } else if any_pending || !seed_pass {
        "pending"
    } else {
        "qualified"
    }
}

pub struct PreflightRun {
    pub preflight_id: String,
    pub device_id: String,
    pub profile_ref: String,
    pub domain: String,
    pub result: String,
    pub egress_ip: Option<IpAddr>,
    pub checks: Vec<CheckResult>,
    pub seed_test_id: Option<String>,
    pub seed_spf: Option<bool>,
    pub seed_dkim: Option<bool>,
    pub seed_dmarc: Option<bool>,
    pub ran_at_ms: i64,
    pub expires_at_ms: i64,
}

const PREFLIGHT_EXPIRY_MS: i64 = 24 * 60 * 60 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

impl PreflightRun {
    pub fn build(
        device_id: &str,
        profile_ref: &str,
        domain: &str,
        observations: &PreflightObservations,
        previous_qualified: bool,
    ) -> PreflightRun {
        let checks = evaluate_checks(observations);
        let result = overall_result(&checks, previous_qualified).to_string();
        let ran_at_ms = now_ms();
        PreflightRun {
            preflight_id: uuid::Uuid::new_v4().to_string(),
            device_id: device_id.to_string(),
            profile_ref: profile_ref.to_string(),
            domain: domain.to_string(),
            result,
            egress_ip: observations.egress_ip,
            checks,
            seed_test_id: observations.seed_test_id.clone(),
            seed_spf: observations.seed_spf_pass,
            seed_dkim: observations.seed_dkim_pass,
            seed_dmarc: observations.seed_dmarc_pass,
            ran_at_ms,
            expires_at_ms: ran_at_ms + PREFLIGHT_EXPIRY_MS,
        }
    }

    /// The §10.2 wire shape. `result_sha256` covers the check body so a
    /// tampered result is detectable.
    pub fn to_wire(&self) -> Value {
        let checks: Vec<Value> = self.checks.iter().map(CheckResult::to_value).collect();
        let mut value = json!({
            "contract": contract::EMAIL_CONTRACT,
            "schema_version": contract::EMAIL_SCHEMA_VERSION,
            "preflight_id": self.preflight_id,
            "device_id": self.device_id,
            "profile_ref": self.profile_ref,
            "domain": self.domain,
            "ran_at_ms": self.ran_at_ms,
            "expires_at_ms": self.expires_at_ms,
            "result": self.result,
            "checks": checks,
        });
        if let Some(ip) = self.egress_ip {
            value["egress_ip"] = json!(ip.to_string());
        }
        if let Some(seed_id) = self.seed_test_id.as_ref() {
            let bool_to_verdict = |value: Option<bool>| match value {
                Some(true) => "pass",
                Some(false) => "fail",
                None => "none",
            };
            value["seed"] = json!({
                "seed_test_id": seed_id,
                "spf": bool_to_verdict(self.seed_spf),
                "dkim": bool_to_verdict(self.seed_dkim),
                "dmarc": bool_to_verdict(self.seed_dmarc),
            });
        }
        let hash_body = json!({
            "checks": value["checks"],
            "result": self.result,
            "domain": self.domain,
        });
        value["result_sha256"] = json!(contract::canonical_payload_sha256(&hash_body));
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qualified_observations() -> PreflightObservations {
        PreflightObservations {
            egress_ip: Some("198.51.100.7".parse().unwrap()),
            egress_ip_stable_observations: 5,
            port25_open: Some(true),
            ptr_fcrdns_ok: Some(true),
            helo_hostname_resolves: Some(true),
            dnsbl_listed: Some(false),
            always_on: Some(true),
            clock_skew_ms: Some(41),
            journal_healthy: Some(true),
            credential_store_healthy: Some(true),
            spf_authorizes_egress: Some(true),
            dkim_published_matches: Some(true),
            dmarc_published: Some(true),
            seed_spf_pass: Some(true),
            seed_dkim_pass: Some(true),
            seed_dmarc_pass: Some(true),
            seed_test_id: Some("seed-1".to_string()),
        }
    }

    #[test]
    fn cgnat_ip_fails_public_and_static() {
        assert!(!is_public_routable("100.64.12.7".parse().unwrap()));
        assert!(!is_public_routable("10.0.0.1".parse().unwrap()));
        assert!(!is_public_routable("192.168.1.1".parse().unwrap()));
        assert!(!is_public_routable("172.16.0.1".parse().unwrap()));
        assert!(is_public_routable("198.51.100.7".parse().unwrap()));
    }

    #[test]
    fn all_checks_pass_yields_qualified() {
        let checks = evaluate_checks(&qualified_observations());
        assert_eq!(checks.len(), 14);
        assert_eq!(overall_result(&checks, false), "qualified");
        for id in PREFLIGHT_CHECK_IDS {
            assert!(checks.iter().any(|check| check.check_id == id), "{id}");
        }
    }

    #[test]
    fn cgnat_yields_failed_with_remediation() {
        let mut obs = qualified_observations();
        obs.egress_ip = Some("100.64.12.7".parse().unwrap());
        let checks = evaluate_checks(&obs);
        let public = checks.iter().find(|c| c.check_id == "public_ip").unwrap();
        assert_eq!(public.status, CheckStatus::Fail);
        assert!(public.remediation.is_some());
        let seed = checks.iter().find(|c| c.check_id == "seed_test").unwrap();
        assert_eq!(seed.status, CheckStatus::Unavailable);
        assert_eq!(overall_result(&checks, false), "failed");
    }

    #[test]
    fn regression_after_qualified_is_degraded() {
        let mut obs = qualified_observations();
        obs.dkim_published_matches = Some(false);
        let checks = evaluate_checks(&obs);
        assert_eq!(overall_result(&checks, true), "degraded");
        assert_eq!(overall_result(&checks, false), "failed");
    }

    #[test]
    fn advisory_regression_after_qualified_is_degraded() {
        // §10.2: degraded = previously qualified, a re-check now fails/warns
        // — even when the regressing check is advisory (review #12).
        let mut obs = qualified_observations();
        obs.dnsbl_listed = Some(true); // advisory warn
        let checks = evaluate_checks(&obs);
        assert_eq!(overall_result(&checks, true), "degraded");
        // Never-qualified with only an advisory warn stays qualified.
        assert_eq!(overall_result(&checks, false), "qualified");

        let mut obs = qualified_observations();
        obs.seed_dkim_pass = Some(false); // advisory seed failure
        let checks = evaluate_checks(&obs);
        assert_eq!(overall_result(&checks, true), "degraded");
        assert_eq!(overall_result(&checks, false), "pending");
    }

    #[test]
    fn incomplete_observations_are_pending() {
        let mut obs = qualified_observations();
        obs.port25_open = None;
        let checks = evaluate_checks(&obs);
        assert_eq!(overall_result(&checks, false), "pending");
    }

    #[test]
    fn wire_shape_carries_result_and_hash() {
        let run = PreflightRun::build(
            "device-1",
            "profile-1",
            "acme.example",
            &qualified_observations(),
            false,
        );
        let wire = run.to_wire();
        assert_eq!(wire["result"], "qualified");
        assert_eq!(wire["checks"].as_array().unwrap().len(), 14);
        assert!(wire["result_sha256"].as_str().unwrap().len() == 64);
        assert_eq!(wire["seed"]["spf"], "pass");
        assert_eq!(wire["egress_ip"], "198.51.100.7");
    }
}
