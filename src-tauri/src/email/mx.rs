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
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
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
                        return Ok(MxResolution::NoMx {
                            fallback_hosts: vec![domain.clone()],
                        });
                    }
                    Ok(classified)
                }
                Err(error) => {
                    let text = error.to_string();
                    if text.contains("no record found") || text.contains("NXDomain") {
                        // No MX: A/AAAA fallback on the bare domain — only
                        // valid when the domain itself resolves; the SMTP
                        // connect attempt settles that.
                        Ok(MxResolution::NoMx {
                            fallback_hosts: vec![domain.clone()],
                        })
                    } else {
                        Err(format!("mx lookup failed: {text}"))
                    }
                }
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
            MxTarget { host: "mx2.example.com.".to_string(), priority: 20 },
            MxTarget { host: "mx1a.example.com.".to_string(), priority: 10 },
            MxTarget { host: "mx1b.example.com.".to_string(), priority: 10 },
        ]);
        let hosts = ordered_delivery_hosts(&resolution).unwrap();
        assert_eq!(hosts.len(), 3);
        assert_eq!(hosts[2], "mx2.example.com", "highest number last");
        assert!(hosts[..2].contains(&"mx1a.example.com".to_string()));
        assert!(hosts[..2].contains(&"mx1b.example.com".to_string()));
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
