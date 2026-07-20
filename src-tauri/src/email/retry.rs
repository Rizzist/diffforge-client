//! Retry classification for native + provider delivery (contract §6b.2/
//! §10.1): decides whether an SMTP outcome may be retried, and under which
//! backoff. The hard law: ambiguity at/after DATA is NEVER auto-retried
//! (delivery_unknown). Pre-`MAIL FROM` failures retry by class; pre-DATA 4xx
//! uses bounded backoff ≤24h.

use super::contract::ResponseClass;

pub const PRE_DATA_MAX_BACKOFF_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetryDecision {
    /// Retry this MX/attempt after `backoff_ms`.
    Retry { backoff_ms: i64 },
    /// Try the next MX host in priority order (connection/TLS to this host
    /// failed but the domain may have other exchanges).
    NextMx,
    /// Permanent per-recipient/domain failure — bounce, do not retry.
    Permanent,
    /// Ambiguous at/after DATA — settle delivery_unknown, NEVER retry.
    DeliveryUnknown,
}

/// Classify a pre-DATA / connect failure. `at_or_after_data` short-circuits
/// to DeliveryUnknown regardless of class — the boundary fact wins.
pub fn classify_retry(class: ResponseClass, at_or_after_data: bool, attempt: u32) -> RetryDecision {
    if at_or_after_data {
        return RetryDecision::DeliveryUnknown;
    }
    match class {
        // Connection/TLS to a specific MX host: try the next MX.
        ResponseClass::ConnectionFailed | ResponseClass::TlsFailed => RetryDecision::NextMx,
        // Timeouts and temporary rejections: bounded exponential backoff.
        ResponseClass::Timeout | ResponseClass::RejectedTemporary | ResponseClass::Deferred => {
            RetryDecision::Retry {
                backoff_ms: backoff_for_attempt(attempt),
            }
        }
        // Permanent rejection: bounce.
        ResponseClass::RejectedPermanent => RetryDecision::Permanent,
        // Accepted/none shouldn't reach the retry classifier.
        ResponseClass::Accepted | ResponseClass::None => RetryDecision::Permanent,
    }
}

/// Exponential backoff with a 24h cap: 1m, 4m, 16m, ... capped.
pub fn backoff_for_attempt(attempt: u32) -> i64 {
    let base = 60_000i64; // 1 minute
    let factor = 4i64.saturating_pow(attempt.min(8));
    (base.saturating_mul(factor)).min(PRE_DATA_MAX_BACKOFF_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn at_or_after_data_is_never_retried() {
        for class in [
            ResponseClass::ConnectionFailed,
            ResponseClass::Timeout,
            ResponseClass::RejectedTemporary,
            ResponseClass::Accepted,
        ] {
            assert_eq!(
                classify_retry(class, true, 0),
                RetryDecision::DeliveryUnknown
            );
        }
    }

    #[test]
    fn connect_and_tls_failures_advance_mx() {
        assert_eq!(
            classify_retry(ResponseClass::ConnectionFailed, false, 0),
            RetryDecision::NextMx
        );
        assert_eq!(
            classify_retry(ResponseClass::TlsFailed, false, 0),
            RetryDecision::NextMx
        );
    }

    #[test]
    fn temporary_backoff_is_bounded_to_24h() {
        assert_eq!(backoff_for_attempt(0), 60_000);
        assert_eq!(backoff_for_attempt(1), 240_000);
        assert!(backoff_for_attempt(20) <= PRE_DATA_MAX_BACKOFF_MS);
        match classify_retry(ResponseClass::RejectedTemporary, false, 3) {
            RetryDecision::Retry { backoff_ms } => {
                assert!(backoff_ms <= PRE_DATA_MAX_BACKOFF_MS)
            }
            other => panic!("expected retry, got {other:?}"),
        }
    }

    #[test]
    fn permanent_rejection_bounces() {
        assert_eq!(
            classify_retry(ResponseClass::RejectedPermanent, false, 0),
            RetryDecision::Permanent
        );
    }
}
