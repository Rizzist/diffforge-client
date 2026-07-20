//! MX resolution for native delivery (plan §3.8): priority ordering with
//! equal-priority randomization, Null-MX (RFC 7505) as a terminal no-mail
//! signal, and A/AAAA fallback ONLY when no MX records exist at all.
//! The production resolver rides the hickory resolver re-exported by
//! mail-auth; tests use the in-memory fake — no live DNS in cargo test.

use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MxTarget {
    pub host: String,
    pub priority: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MxResolution {
    /// MX records exist; deliver to these in priority order.
    Targets(Vec<MxTarget>),
    /// Null MX ("0 .") — the domain refuses mail. Terminal, never retried.
    NullMx,
    /// No MX records at all; RFC 5321 A/AAAA fallback hosts (the bare
    /// domain) may be used.
    NoMx { fallback_hosts: Vec<String> },
    /// NXDOMAIN / no records anywhere — terminal for the recipient domain.
    NoSuchDomain,
}

pub trait MxResolver: Send + Sync {
    fn resolve_mx(&self, domain: &str) -> Result<MxResolution, String>;
}

/// Order candidate hosts per RFC 5321 §5.1: ascending priority, ties
/// shuffled. Null MX yields an error string the caller treats as a
/// permanent per-domain failure.
pub fn ordered_delivery_hosts(resolution: &MxResolution) -> Result<Vec<String>, String> {
    match resolution {
        MxResolution::NullMx => Err("null MX: domain does not accept mail".to_string()),
        MxResolution::NoSuchDomain => Err("recipient domain does not exist".to_string()),
        MxResolution::NoMx { fallback_hosts } => Ok(fallback_hosts.clone()),
        MxResolution::Targets(targets) => {
            let mut by_priority: BTreeMap<u16, Vec<String>> = BTreeMap::new();
            for target in targets {
                by_priority
                    .entry(target.priority)
                    .or_default()
                    .push(target.host.clone());
            }
            let mut out = Vec::new();
            for (_, mut group) in by_priority {
                // Equal-priority randomization: Fisher-Yates with a cheap
                // time+len seed (test-controllable determinism not needed —
                // ordering within a priority group is explicitly arbitrary).
                let mut seed = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.subsec_nanos() as u64)
                    .unwrap_or(0)
                    .wrapping_add(group.len() as u64);
                let mut index = group.len();
                while index > 1 {
                    seed = seed
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    let pick = (seed >> 33) as usize % index;
                    index -= 1;
                    group.swap(pick, index);
                }
                out.extend(group);
            }
            Ok(out)
        }
    }
}

/// Detect Null MX in a raw record set: a single MX whose exchange is the
/// root (".") with preference 0.
pub fn classify_mx_records(records: Vec<MxTarget>) -> MxResolution {
    if records.is_empty() {
        return MxResolution::NoMx {
            fallback_hosts: vec![],
        };
    }
    if records
        .iter()
        .all(|record| record.priority == 0 && (record.host == "." || record.host.is_empty()))
    {
        return MxResolution::NullMx;
    }
    MxResolution::Targets(
        records
            .into_iter()
            .filter(|record| record.host != "." && !record.host.is_empty())
            .map(|mut record| {
                if record.host.ends_with('.') {
                    record.host.pop();
                }
                record
            })
            .collect(),
    )
}

/// How an MX lookup error classifies (review #15). Matched STRUCTURALLY on
/// hickory's error kind + response code — never on the error's display
/// string, whose wording changes across hickory versions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MxErrorDisposition {
    /// NXDOMAIN — the domain does not exist. Terminal, no fallback.
    NxDomain,
    /// NODATA — the domain exists but holds no MX records. RFC 5321 A/AAAA
    /// fallback applies ONLY if an explicit address lookup finds records.
    NoData,
    /// Transport/server failure — retryable, never a fallback candidate.
    Transport(String),
}

pub fn mx_error_disposition(
    error: &mail_auth::hickory_resolver::proto::ProtoError,
) -> MxErrorDisposition {
    use mail_auth::hickory_resolver::proto::op::ResponseCode;
    use mail_auth::hickory_resolver::proto::ProtoErrorKind;
    match error.kind() {
        ProtoErrorKind::NoRecordsFound(no_records) => match no_records.response_code {
            // Only an authoritative empty answer is NODATA. SERVFAIL,
            // REFUSED, and every other code is a server/transport failure —
            // retryable, and NEVER an A/AAAA fallback candidate (a flaky
            // resolver must not reroute mail to the bare domain).
            ResponseCode::NoError => MxErrorDisposition::NoData,
            ResponseCode::NXDomain => MxErrorDisposition::NxDomain,
            other => MxErrorDisposition::Transport(format!(
                "mx lookup answered {other:?} (no records)"
            )),
        },
        _ => MxErrorDisposition::Transport(error.to_string()),
    }
}

/// Production resolver over mail-auth's hickory re-export. Lookups run on a
/// dedicated current-thread runtime so callers stay synchronous.
pub struct HickoryMxResolver;

impl MxResolver for HickoryMxResolver {
    fn resolve_mx(&self, domain: &str) -> Result<MxResolution, String> {
        use mail_auth::hickory_resolver::config::{ResolverConfig, ResolverOpts};
        use mail_auth::hickory_resolver::name_server::TokioConnectionProvider;
        use mail_auth::hickory_resolver::TokioResolver;

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("mx resolver runtime failed: {error}"))?;
        let domain = domain.to_string();
        runtime.block_on(async move {
            let resolver = TokioResolver::builder_with_config(
                ResolverConfig::default(),
                TokioConnectionProvider::default(),
            )
            .with_options(ResolverOpts::default())
            .build();

            // RFC 5321 §5.1: the implicit-MX fallback to the bare domain is
            // only valid when the domain actually holds address records — a
            // NODATA answer for MX says nothing about A/AAAA, so we look
            // them up explicitly instead of guessing.
            async fn nodata_fallback(
                resolver: &TokioResolver,
                domain: &str,
            ) -> Result<MxResolution, String> {
                match resolver.lookup_ip(format!("{domain}.")).await {
                    Ok(addresses) if addresses.iter().next().is_some() => {
                        Ok(MxResolution::NoMx {
                            fallback_hosts: vec![domain.to_string()],
                        })
                    }
                    Ok(_) => Ok(MxResolution::NoSuchDomain),
                    Err(error) => match mx_error_disposition(&error) {
                        MxErrorDisposition::NxDomain | MxErrorDisposition::NoData => {
                            Ok(MxResolution::NoSuchDomain)
                        }
                        MxErrorDisposition::Transport(text) => {
                            Err(format!("a/aaaa fallback lookup failed: {text}"))
                        }
                    },
                }
            }

            match resolver.mx_lookup(format!("{domain}.")).await {
                Ok(lookup) => {
                    let records: Vec<MxTarget> = lookup
                        .iter()
                        .map(|mx| MxTarget {
                            host: mx.exchange().to_utf8(),
                            priority: mx.preference(),
                        })
                        .collect();
                    let classified = classify_mx_records(records);
                    if let MxResolution::NoMx { .. } = classified {
                        // Empty answer set == NODATA: same explicit A/AAAA
                        // verification path.
                        return nodata_fallback(&resolver, &domain).await;
                    }
                    Ok(classified)
                }
                Err(error) => match mx_error_disposition(&error) {
                    // NXDOMAIN is terminal for the recipient domain — never
                    // an A/AAAA fallback candidate.
                    MxErrorDisposition::NxDomain => Ok(MxResolution::NoSuchDomain),
                    MxErrorDisposition::NoData => nodata_fallback(&resolver, &domain).await,
                    MxErrorDisposition::Transport(text) => {
                        Err(format!("mx lookup failed: {text}"))
                    }
                },
            }
        })
    }
}

/// In-memory fake for tests.
#[derive(Default)]
pub struct FakeMxResolver {
    pub map: Mutex<BTreeMap<String, MxResolution>>,
}

impl FakeMxResolver {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn set(&self, domain: &str, resolution: MxResolution) {
        self.map
            .lock()
            .unwrap()
            .insert(domain.to_string(), resolution);
    }
}

impl MxResolver for FakeMxResolver {
    fn resolve_mx(&self, domain: &str) -> Result<MxResolution, String> {
        self.map
            .lock()
            .unwrap()
            .get(domain)
            .cloned()
            .ok_or_else(|| format!("no fake MX entry for {domain}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_mx_is_terminal() {
        let resolution = classify_mx_records(vec![MxTarget {
            host: ".".to_string(),
            priority: 0,
        }]);
        assert_eq!(resolution, MxResolution::NullMx);
        assert!(ordered_delivery_hosts(&resolution).is_err());
    }

    #[test]
    fn priority_ordering_holds_with_tie_shuffle() {
        let resolution = classify_mx_records(vec![
            MxTarget {
                host: "mx2.example.com.".to_string(),
                priority: 20,
            },
            MxTarget {
                host: "mx1a.example.com.".to_string(),
                priority: 10,
            },
            MxTarget {
                host: "mx1b.example.com.".to_string(),
                priority: 10,
            },
        ]);
        let hosts = ordered_delivery_hosts(&resolution).unwrap();
        assert_eq!(hosts.len(), 3);
        assert_eq!(hosts[2], "mx2.example.com", "highest number last");
        assert!(hosts[..2].contains(&"mx1a.example.com".to_string()));
        assert!(hosts[..2].contains(&"mx1b.example.com".to_string()));
    }

    #[test]
    fn mx_error_disposition_is_structural_not_string_matched() {
        use mail_auth::hickory_resolver::proto::op::{Query, ResponseCode};
        use mail_auth::hickory_resolver::proto::rr::{Name, RecordType};
        use mail_auth::hickory_resolver::proto::{NoRecords, ProtoError, ProtoErrorKind};

        let query = Query::query(Name::from_ascii("nomx.example.").unwrap(), RecordType::MX);
        // NODATA: the domain exists, no MX records → A/AAAA verification.
        let nodata =
            ProtoError::from(NoRecords::new(query.clone(), ResponseCode::NoError));
        assert_eq!(mx_error_disposition(&nodata), MxErrorDisposition::NoData);
        // NXDOMAIN: the domain does not exist → terminal, never a fallback.
        let nxdomain = ProtoError::from(NoRecords::new(query, ResponseCode::NXDomain));
        assert_eq!(mx_error_disposition(&nxdomain), MxErrorDisposition::NxDomain);
        // A transport-class error is neither: retryable, no fallback.
        let transport = ProtoError::from(ProtoErrorKind::Msg("connection refused".to_string()));
        assert!(matches!(
            mx_error_disposition(&transport),
            MxErrorDisposition::Transport(_)
        ));
        // SERVFAIL/REFUSED are server failures, NOT NODATA (review R2-8):
        // they must never trigger the bare-domain A/AAAA fallback.
        for code in [ResponseCode::ServFail, ResponseCode::Refused] {
            let query = Query::query(Name::from_ascii("nomx.example.").unwrap(), RecordType::MX);
            let error = ProtoError::from(NoRecords::new(query, code));
            assert!(
                matches!(
                    mx_error_disposition(&error),
                    MxErrorDisposition::Transport(_)
                ),
                "{code:?} must classify as transport"
            );
        }
    }

    #[test]
    fn no_such_domain_is_terminal_like_null_mx() {
        assert!(ordered_delivery_hosts(&MxResolution::NoSuchDomain).is_err());
    }

    #[test]
    fn a_fallback_only_without_mx() {
        let no_mx = MxResolution::NoMx {
            fallback_hosts: vec!["example.com".to_string()],
        };
        assert_eq!(
            ordered_delivery_hosts(&no_mx).unwrap(),
            vec!["example.com".to_string()]
        );
        // With MX present the bare domain never appears.
        let with_mx = classify_mx_records(vec![MxTarget {
            host: "mx.example.com".to_string(),
            priority: 10,
        }]);
        let hosts = ordered_delivery_hosts(&with_mx).unwrap();
        assert_eq!(hosts, vec!["mx.example.com".to_string()]);
    }
}
