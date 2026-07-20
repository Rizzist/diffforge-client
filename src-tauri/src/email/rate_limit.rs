//! Per-destination-domain pacing for native delivery (plan §3.8): token
//! buckets capped at ≤2 concurrent connections per domain with warm-up, and
//! the greylist retry schedule (~5m/15m/30m/1h/2h/4h, jittered, capped at
//! 48h). State is journaled in `email_domain_rate_state`.

use rusqlite::{params, OptionalExtension};

use super::journal::EmailJournal;

pub const MAX_CONNECTIONS_PER_DOMAIN: i64 = 2;

/// Greylist backoff ladder in seconds: 5m, 15m, 30m, 1h, 2h, 4h. Stage index
/// beyond the last repeats 4h; the whole schedule is bounded to 48h.
pub const GREYLIST_LADDER_SECS: [i64; 6] =
    [5 * 60, 15 * 60, 30 * 60, 60 * 60, 2 * 60 * 60, 4 * 60 * 60];
pub const GREYLIST_MAX_AGE_MS: i64 = 48 * 60 * 60 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Deterministic ±20% jitter derived from the domain + stage, so retries
/// spread without a live RNG (tests can assert exact bounds).
fn jitter_millis(base_secs: i64, domain: &str, stage: u32) -> i64 {
    let mut hash: u64 = 1469598103934665603;
    for byte in domain.bytes().chain(std::iter::once(stage as u8)) {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    let base_ms = base_secs * 1000;
    let span = (base_ms / 5).max(1); // ±20%
    let offset = (hash % (2 * span as u64)) as i64 - span;
    base_ms + offset
}

/// The next greylist retry time for `stage` (0-based), or None if the retry
/// window would exceed the 48h cap from `first_deferral_at_ms`.
pub fn greylist_next_retry_at(domain: &str, stage: u32, first_deferral_at_ms: i64) -> Option<i64> {
    let index = (stage as usize).min(GREYLIST_LADDER_SECS.len() - 1);
    let base = GREYLIST_LADDER_SECS[index];
    let delay = jitter_millis(base, domain, stage);
    let candidate = now_ms() + delay;
    if candidate - first_deferral_at_ms > GREYLIST_MAX_AGE_MS {
        return None; // exceeded the 48h horizon — give up (terminal)
    }
    Some(candidate)
}

/// Try to acquire a connection slot for `domain`. Returns true when a slot
/// was reserved (≤2 concurrent), false when the domain is at its cap.
pub fn acquire_connection_slot(journal: &EmailJournal, domain: &str) -> Result<bool, String> {
    let open: i64 = journal
        .connection()
        .query_row(
            "SELECT connections_open FROM email_domain_rate_state WHERE domain = ?1",
            [domain],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("rate slot read failed: {error}"))?
        .unwrap_or(0);
    if open >= MAX_CONNECTIONS_PER_DOMAIN {
        return Ok(false);
    }
    journal
        .connection()
        .execute(
            "INSERT INTO email_domain_rate_state (domain, connections_open, last_send_at_ms)
             VALUES (?1, 1, ?2)
             ON CONFLICT(domain) DO UPDATE SET
                connections_open = connections_open + 1,
                last_send_at_ms = ?2",
            params![domain, now_ms()],
        )
        .map_err(|error| format!("rate slot acquire failed: {error}"))?;
    Ok(true)
}

pub fn release_connection_slot(journal: &EmailJournal, domain: &str) -> Result<(), String> {
    journal
        .connection()
        .execute(
            "UPDATE email_domain_rate_state
             SET connections_open = MAX(connections_open - 1, 0)
             WHERE domain = ?1",
            [domain],
        )
        .map(|_| ())
        .map_err(|error| format!("rate slot release failed: {error}"))
}

pub fn record_sent(journal: &EmailJournal, domain: &str) -> Result<(), String> {
    journal
        .connection()
        .execute(
            "INSERT INTO email_domain_rate_state
             (domain, window_started_at_ms, sent_in_window, last_send_at_ms)
             VALUES (?1, ?2, 1, ?2)
             ON CONFLICT(domain) DO UPDATE SET
                sent_in_window = sent_in_window + 1,
                last_send_at_ms = ?2,
                greylist_stage = 0,
                greylist_until_ms = NULL,
                first_deferral_at_ms = NULL",
            params![domain, now_ms()],
        )
        .map(|_| ())
        .map_err(|error| format!("rate record sent failed: {error}"))
}

/// Advance the greylist stage for a temporarily-deferred domain. Returns the
/// next retry time, or None when the 48h horizon is exceeded (terminal).
pub fn record_greylist_deferral(
    journal: &EmailJournal,
    domain: &str,
) -> Result<Option<i64>, String> {
    let now = now_ms();
    let (stage, first): (u32, i64) = journal
        .connection()
        .query_row(
            "SELECT greylist_stage, COALESCE(first_deferral_at_ms, ?2)
             FROM email_domain_rate_state WHERE domain = ?1",
            params![domain, now],
            |row| Ok((row.get::<_, i64>(0)? as u32, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| format!("rate greylist read failed: {error}"))?
        .unwrap_or((0, now));
    let next = greylist_next_retry_at(domain, stage, first);
    journal
        .connection()
        .execute(
            "INSERT INTO email_domain_rate_state
             (domain, deferred_in_window, greylist_stage, greylist_until_ms,
              first_deferral_at_ms)
             VALUES (?1, 1, ?2, ?3, ?4)
             ON CONFLICT(domain) DO UPDATE SET
                deferred_in_window = deferred_in_window + 1,
                greylist_stage = ?2,
                greylist_until_ms = ?3,
                first_deferral_at_ms = COALESCE(first_deferral_at_ms, ?4)",
            params![domain, (stage + 1) as i64, next, first],
        )
        .map_err(|error| format!("rate greylist record failed: {error}"))?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_journal() -> EmailJournal {
        let dir = std::env::temp_dir().join(format!(
            "diffforge-email-rate-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        EmailJournal::open_at(&dir.join("journal.sqlite")).unwrap()
    }

    #[test]
    fn connection_cap_is_two() {
        let journal = temp_journal();
        assert!(acquire_connection_slot(&journal, "partner.example").unwrap());
        assert!(acquire_connection_slot(&journal, "partner.example").unwrap());
        assert!(!acquire_connection_slot(&journal, "partner.example").unwrap());
        release_connection_slot(&journal, "partner.example").unwrap();
        assert!(acquire_connection_slot(&journal, "partner.example").unwrap());
    }

    #[test]
    fn greylist_ladder_respects_bounds_and_horizon() {
        // Each stage stays within ±20% of its base delay.
        for (stage, base) in GREYLIST_LADDER_SECS.iter().enumerate() {
            let delay = jitter_millis(*base, "partner.example", stage as u32);
            let base_ms = base * 1000;
            assert!(delay >= base_ms - base_ms / 5);
            assert!(delay <= base_ms + base_ms / 5);
        }
        // A first deferral 47h ago still schedules; 49h ago gives up.
        let now = now_ms();
        assert!(greylist_next_retry_at("d", 0, now - 47 * 60 * 60 * 1000).is_some());
        assert!(greylist_next_retry_at("d", 5, now - 49 * 60 * 60 * 1000).is_none());
    }

    #[test]
    fn deferral_advances_stage_then_success_resets() {
        let journal = temp_journal();
        let first = record_greylist_deferral(&journal, "partner.example").unwrap();
        assert!(first.is_some());
        let stage: i64 = journal
            .connection()
            .query_row(
                "SELECT greylist_stage FROM email_domain_rate_state WHERE domain = 'partner.example'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stage, 1);
        record_sent(&journal, "partner.example").unwrap();
        let reset: i64 = journal
            .connection()
            .query_row(
                "SELECT greylist_stage FROM email_domain_rate_state WHERE domain = 'partner.example'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(reset, 0);
    }
}
