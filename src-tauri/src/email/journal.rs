//! The durable device send journal (`email-send-journal.sqlite`, contract
//! §10.1). Lives in the DATA root (never the cache root), WAL + foreign
//! keys, `synchronous=FULL` at SMTP boundaries, and crash-safe versioned
//! marker-last migrations per the `coordination/db.rs` idiom: idempotent DDL
//! executes first and the `email_schema_migrations` marker row is inserted
//! LAST, so a crash between the two replays the idempotent DDL on reopen.
//!
//! Journal laws (§10.1) implemented here:
//! - receipt + job insert happen in ONE transaction;
//! - higher generation / lease-epoch fences lower;
//! - tombstone dominates (a tombstoned generation never re-executes);
//! - `data_started` is committed (FULL) before DATA;
//! - loss at/after DATA recovers terminal-if-persisted else
//!   `delivery_unknown`, never auto-retried;
//! - terminal outcomes are journaled before they are reported;
//! - tombstones have NO time-based deletion; compaction only after the
//!   cloud `email_generation_retired` ack.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::contract::{self, SendPhase};
use super::email_killpoint;

pub const EMAIL_JOURNAL_FILE: &str = "email-send-journal.sqlite";
const EMAIL_JOURNAL_BUSY_TIMEOUT_MS: u64 = 30_000;

/// Lease epochs are full-range `u64` on the wire (§0.2) but SQLite INTEGER
/// is signed. The journal stores them as fixed-width 20-digit decimal TEXT
/// (`contract::u64_to_sortable`): lossless across the entire u64 range, and
/// lexicographic order == numeric order, so the TEXT `<=`/`=` fences below
/// never alias or corrupt epochs above `i64::MAX`. Every journal read/write
/// goes through this pair.
pub(crate) fn epoch_to_db(epoch: u64) -> String {
    contract::u64_to_sortable(epoch)
}

pub(crate) fn epoch_from_db(text: &str) -> Result<u64, String> {
    contract::u64_from_sortable(text)
}

/// Versioned migrations. Each entry is (version, name, idempotent DDL batch).
/// NEVER edit a shipped entry — append a new version instead.
const EMAIL_JOURNAL_MIGRATIONS: &[(i64, &str, &str)] = &[(
    1,
    "email_journal_v1",
    "
    CREATE TABLE IF NOT EXISTS email_journal_meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_sender_profiles (
        profile_ref TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        provider_kind TEXT,
        display_name TEXT,
        from_address TEXT,
        smtp_host TEXT,
        smtp_port INTEGER,
        smtp_security TEXT,
        username TEXT,
        secret_locator TEXT,
        has_credentials INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER,
        last_test_at_ms INTEGER,
        last_test_ok INTEGER
    );
    CREATE TABLE IF NOT EXISTS email_dkim_keys (
        domain TEXT NOT NULL,
        selector TEXT NOT NULL,
        state TEXT NOT NULL,
        pubkey_fingerprint_sha256 TEXT NOT NULL,
        public_key_b64 TEXT,
        secret_locator TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (domain, selector)
    );
    CREATE TABLE IF NOT EXISTS email_command_receipts (
        command_id TEXT PRIMARY KEY,
        payload_sha256 TEXT NOT NULL,
        received_at_ms INTEGER NOT NULL,
        ack_result TEXT NOT NULL,
        first_status_event_id TEXT,
        source TEXT
    );
    CREATE TABLE IF NOT EXISTS email_send_jobs (
        send_job_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        command_id TEXT NOT NULL,
        binding_id TEXT,
        mode TEXT,
        phase TEXT NOT NULL,
        phase_rank INTEGER NOT NULL,
        lease_id TEXT,
        -- Full-range u64 lease epochs ride the fixed-width 20-digit decimal
        -- TEXT form (contract::u64_to_sortable): lossless, and lexicographic
        -- order == numeric order, so the TEXT <=/= fences below never alias
        -- or corrupt epochs above i64::MAX. The default is encoded zero.
        lease_epoch TEXT NOT NULL DEFAULT '00000000000000000000',
        lease_expires_at_ms INTEGER,
        mime_sha256 TEXT,
        mime_size_bytes INTEGER,
        data_started INTEGER NOT NULL DEFAULT 0,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        superseded INTEGER NOT NULL DEFAULT 0,
        last_smtp_code INTEGER,
        last_response_class TEXT,
        terminal_outcome TEXT,
        terminal_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (send_job_id, generation)
    );
    CREATE TABLE IF NOT EXISTS email_send_recipients (
        send_job_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        recipient_ref TEXT NOT NULL,
        role TEXT NOT NULL,
        address TEXT NOT NULL,
        domain TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        smtp_code INTEGER,
        enhanced_code TEXT,
        response_class TEXT,
        response_sanitized TEXT,
        retry_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (send_job_id, generation, recipient_ref),
        FOREIGN KEY (send_job_id, generation)
            REFERENCES email_send_jobs (send_job_id, generation)
    );
    CREATE TABLE IF NOT EXISTS email_send_attempts (
        send_job_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        attempt INTEGER NOT NULL,
        started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER,
        phase_reached TEXT,
        outcome TEXT,
        dest_host_sanitized TEXT,
        PRIMARY KEY (send_job_id, generation, attempt),
        FOREIGN KEY (send_job_id, generation)
            REFERENCES email_send_jobs (send_job_id, generation)
    );
    CREATE TABLE IF NOT EXISTS email_send_events (
        status_event_id TEXT PRIMARY KEY,
        send_job_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        phase TEXT NOT NULL,
        phase_rank INTEGER NOT NULL,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        outbox_state TEXT NOT NULL DEFAULT 'pending',
        handed_off_at_ms INTEGER,
        cloud_acked_at_ms INTEGER,
        cloud_applied INTEGER,
        cloud_audit TEXT,
        created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_send_events_job_idx
        ON email_send_events (send_job_id, generation, phase_rank);
    CREATE TABLE IF NOT EXISTS email_send_tombstones (
        send_job_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        terminal_outcome TEXT NOT NULL,
        journaled_at_ms INTEGER NOT NULL,
        cloud_generation_retired_acked INTEGER NOT NULL DEFAULT 0,
        retired_acked_at_ms INTEGER,
        compacted INTEGER NOT NULL DEFAULT 0,
        compacted_at_ms INTEGER,
        PRIMARY KEY (send_job_id, generation)
    );
    CREATE TABLE IF NOT EXISTS email_domain_rate_state (
        domain TEXT PRIMARY KEY,
        window_started_at_ms INTEGER,
        sent_in_window INTEGER NOT NULL DEFAULT 0,
        deferred_in_window INTEGER NOT NULL DEFAULT 0,
        connections_open INTEGER NOT NULL DEFAULT 0,
        last_send_at_ms INTEGER,
        greylist_stage INTEGER NOT NULL DEFAULT 0,
        greylist_until_ms INTEGER,
        first_deferral_at_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS email_native_preflight_runs (
        preflight_id TEXT PRIMARY KEY,
        profile_ref TEXT NOT NULL,
        domain TEXT NOT NULL,
        ran_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        result TEXT NOT NULL,
        qualified INTEGER NOT NULL DEFAULT 0,
        eligible INTEGER NOT NULL DEFAULT 0,
        result_sha256 TEXT NOT NULL,
        result_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_native_preflight_checks (
        preflight_id TEXT NOT NULL,
        check_id TEXT NOT NULL,
        status TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 0,
        observed TEXT,
        expected TEXT,
        remediation TEXT,
        PRIMARY KEY (preflight_id, check_id),
        FOREIGN KEY (preflight_id)
            REFERENCES email_native_preflight_runs (preflight_id)
    );
    CREATE TABLE IF NOT EXISTS email_egress_ip_observations (
        observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        observed_at_ms INTEGER NOT NULL,
        egress_ip TEXT NOT NULL,
        source TEXT NOT NULL,
        port25_open INTEGER,
        profile_ref TEXT
    );
    ",
)];

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Default journal location: the DATA root (plan §3.8 — data root, not cache
/// root), resolved through the same helper the rest of the device uses.
pub fn email_journal_default_path() -> Option<PathBuf> {
    crate::cloud_mcp_local_data_file_path(EMAIL_JOURNAL_FILE)
}

/// Outcome of a wake-command intake write (§9.4 / §10.1).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandIntake {
    /// Receipt + job inserted in one txn. Ack `accepted`.
    Accepted { first_status_event_id: String },
    /// Same command_id + same payload hash already journaled. Ack `duplicate`.
    Duplicate {
        first_status_event_id: Option<String>,
    },
    /// Same command_id + DIFFERENT payload hash: security rejection (§10.1).
    SecurityRejected { journaled_sha256: String },
    /// The (job, generation) is tombstoned — tombstone dominates. Ack
    /// `duplicate` (the terminal outcome already exists; never re-execute).
    Tombstoned { terminal_outcome: String },
    /// A higher generation exists for this send_job_id — the command is
    /// stale and fenced. Ack `rejected`.
    FencedByHigherGeneration { current_generation: u32 },
}

#[derive(Clone, Debug, Default)]
pub struct SendJobRow {
    pub send_job_id: String,
    pub generation: u32,
    pub command_id: String,
    pub binding_id: String,
    pub mode: Option<String>,
    pub phase: String,
    pub phase_rank: u32,
    pub lease_id: Option<String>,
    pub lease_epoch: u64,
    pub lease_expires_at_ms: Option<i64>,
    pub mime_sha256: Option<String>,
    pub mime_size_bytes: Option<i64>,
    pub data_started: bool,
    pub cancel_requested: bool,
    pub superseded: bool,
    pub last_smtp_code: Option<u16>,
    pub last_response_class: Option<String>,
    pub terminal_outcome: Option<String>,
    pub terminal_at_ms: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct RecipientRow {
    pub recipient_ref: String,
    pub role: String,
    pub address: String,
    pub domain: String,
    pub status: String,
    pub smtp_code: Option<u16>,
    pub enhanced_code: Option<String>,
    pub response_class: Option<String>,
    /// Free-text provider line — LOCAL ONLY, never crosses the wire (§9.6).
    pub response_sanitized: Option<String>,
    pub retry_at_ms: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct PendingEventRow {
    pub status_event_id: String,
    pub send_job_id: String,
    pub generation: u32,
    pub payload: Value,
}

pub struct EmailJournal {
    connection: Connection,
    path: PathBuf,
}

impl EmailJournal {
    /// Open (creating if needed) at the default data-root location.
    pub fn open_default() -> Result<Self, String> {
        let path = email_journal_default_path()
            .ok_or_else(|| "email journal data root unavailable".to_string())?;
        Self::open_at(&path)
    }

    /// Open (creating if needed) at an explicit path — the test entry point.
    pub fn open_at(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "unable to create email journal dir {}: {error}",
                    parent.display()
                )
            })?;
        }
        let connection = Connection::open(path)
            .map_err(|error| format!("unable to open email journal {}: {error}", path.display()))?;
        connection
            .busy_timeout(std::time::Duration::from_millis(
                EMAIL_JOURNAL_BUSY_TIMEOUT_MS,
            ))
            .map_err(|error| format!("unable to set email journal busy timeout: {error}"))?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| format!("unable to enable email journal WAL: {error}"))?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| format!("unable to enable email journal foreign keys: {error}"))?;
        // NORMAL between SMTP boundaries; boundary writes upgrade to FULL.
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(|error| format!("unable to set email journal synchronous: {error}"))?;
        let journal = EmailJournal {
            connection,
            path: path.to_path_buf(),
        };
        journal.run_migrations()?;
        Ok(journal)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// Crash-safe versioned migrations, marker-last (coordination/db.rs
    /// idiom): the idempotent DDL batch runs first, then the marker row is
    /// inserted. A crash between the two replays the DDL next open.
    fn run_migrations(&self) -> Result<(), String> {
        self.connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS email_schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at_ms INTEGER NOT NULL
                );",
            )
            .map_err(|error| format!("unable to create email journal migrations table: {error}"))?;
        for (version, name, ddl) in EMAIL_JOURNAL_MIGRATIONS {
            let applied: i64 = self
                .connection
                .query_row(
                    "SELECT COUNT(1) FROM email_schema_migrations WHERE version = ?1",
                    [version],
                    |row| row.get(0),
                )
                .map_err(|error| format!("unable to inspect email journal migrations: {error}"))?;
            if applied > 0 {
                continue;
            }
            self.connection
                .execute_batch(ddl)
                .map_err(|error| format!("email journal migration {name} failed: {error}"))?;
            email_killpoint("journal_migration_pre_marker");
            // Marker LAST, together with the meta version stamp.
            self.connection
                .execute(
                    "INSERT INTO email_schema_migrations (version, name, applied_at_ms)
                     VALUES (?1, ?2, ?3)",
                    params![version, name, now_ms()],
                )
                .map_err(|error| format!("unable to record email journal migration: {error}"))?;
            self.connection
                .execute(
                    "INSERT INTO email_journal_meta (k, v) VALUES ('journal_schema_version', ?1)
                     ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                    params![version.to_string()],
                )
                .map_err(|error| {
                    format!("unable to stamp email journal schema version: {error}")
                })?;
        }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, String> {
        self.meta_get("journal_schema_version")?
            .and_then(|value| value.parse::<i64>().ok())
            .ok_or_else(|| "email journal schema version missing".to_string())
    }

    pub fn meta_get(&self, key: &str) -> Result<Option<String>, String> {
        self.connection
            .query_row(
                "SELECT v FROM email_journal_meta WHERE k = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("unable to read email journal meta {key}: {error}"))
    }

    pub fn meta_set(&self, key: &str, value: &str) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT INTO email_journal_meta (k, v) VALUES (?1, ?2)
                 ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                params![key, value],
            )
            .map(|_| ())
            .map_err(|error| format!("unable to write email journal meta {key}: {error}"))
    }

    /// Run `write` with `synchronous=FULL` (SMTP-boundary durability), then
    /// restore NORMAL. The FULL pragma applies to the commit performed inside
    /// `write`, which is where the boundary law bites.
    fn with_full_synchronous<T>(
        &mut self,
        write: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        self.connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(|error| format!("unable to raise email journal durability: {error}"))?;
        let result = write(&mut self.connection);
        let _ = self.connection.pragma_update(None, "synchronous", "NORMAL");
        result
    }

    // ------------------------------------------------------------------
    // Command intake (§9.4): receipt + job in ONE transaction, ahead of any
    // ack. `first_status_event_id` is minted here so the ack can carry it.
    // ------------------------------------------------------------------

    pub fn record_send_command(
        &mut self,
        send_job_id: &str,
        generation: u32,
        command_id: &str,
        binding_id: &str,
        payload_sha256: &str,
        source: &str,
        build_received_event: impl FnOnce(&str) -> Value,
    ) -> Result<CommandIntake, String> {
        let now = now_ms();
        self.with_full_synchronous(|connection| {
            let txn = connection
                .transaction()
                .map_err(|error| format!("email intake txn begin failed: {error}"))?;

            // Receipt dedup FIRST: a reused command_id with a different
            // payload hash is a security rejection (§10.1) even when the
            // generation is tombstoned — identity always wins over dominance.
            if let Some((existing_hash, first_event)) = txn
                .query_row(
                    "SELECT payload_sha256, first_status_event_id
                     FROM email_command_receipts WHERE command_id = ?1",
                    [command_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(|error| format!("email intake receipt check failed: {error}"))?
            {
                txn.commit()
                    .map_err(|error| format!("email intake txn commit failed: {error}"))?;
                if existing_hash == payload_sha256 {
                    return Ok(CommandIntake::Duplicate {
                        first_status_event_id: first_event,
                    });
                }
                return Ok(CommandIntake::SecurityRejected {
                    journaled_sha256: existing_hash,
                });
            }

            // Tombstone dominates — a tombstoned generation never re-executes.
            if let Some(outcome) = txn
                .query_row(
                    "SELECT terminal_outcome FROM email_send_tombstones
                     WHERE send_job_id = ?1 AND generation = ?2",
                    params![send_job_id, generation],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("email intake tombstone check failed: {error}"))?
            {
                // Still journal the receipt so redeliveries dedupe cheaply.
                txn.execute(
                    "INSERT OR IGNORE INTO email_command_receipts
                     (command_id, payload_sha256, received_at_ms, ack_result, source)
                     VALUES (?1, ?2, ?3, 'duplicate', ?4)",
                    params![command_id, payload_sha256, now, source],
                )
                .map_err(|error| format!("email intake receipt insert failed: {error}"))?;
                txn.commit()
                    .map_err(|error| format!("email intake txn commit failed: {error}"))?;
                return Ok(CommandIntake::Tombstoned {
                    terminal_outcome: outcome,
                });
            }

            // Higher generation fences lower (§10.1). The high-water mark
            // spans BOTH live jobs and tombstones — compaction deletes the
            // job row but the tombstone survives forever, so a lower
            // generation stays fenced after compaction.
            if let Some(current) = txn
                .query_row(
                    "SELECT MAX(generation) FROM (
                         SELECT generation FROM email_send_jobs WHERE send_job_id = ?1
                         UNION ALL
                         SELECT generation FROM email_send_tombstones WHERE send_job_id = ?1
                     )",
                    [send_job_id],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .map_err(|error| format!("email intake generation check failed: {error}"))?
            {
                if current > i64::from(generation) {
                    txn.execute(
                        "INSERT OR IGNORE INTO email_command_receipts
                         (command_id, payload_sha256, received_at_ms, ack_result, source)
                         VALUES (?1, ?2, ?3, 'rejected', ?4)",
                        params![command_id, payload_sha256, now, source],
                    )
                    .map_err(|error| format!("email intake receipt insert failed: {error}"))?;
                    txn.commit()
                        .map_err(|error| format!("email intake txn commit failed: {error}"))?;
                    return Ok(CommandIntake::FencedByHigherGeneration {
                        current_generation: u32::try_from(current).unwrap_or(u32::MAX),
                    });
                }
            }

            let first_status_event_id = uuid::Uuid::new_v4().to_string();
            // Receipt + job + the phase-received event in ONE transaction
            // (§10.1 law; the event row makes the ack's
            // first_status_event_id durable — an ack must never reference an
            // event the journal does not hold).
            txn.execute(
                "INSERT INTO email_command_receipts
                 (command_id, payload_sha256, received_at_ms, ack_result,
                  first_status_event_id, source)
                 VALUES (?1, ?2, ?3, 'accepted', ?4, ?5)",
                params![
                    command_id,
                    payload_sha256,
                    now,
                    first_status_event_id,
                    source
                ],
            )
            .map_err(|error| format!("email intake receipt insert failed: {error}"))?;
            txn.execute(
                "INSERT INTO email_send_jobs
                 (send_job_id, generation, command_id, binding_id, phase, phase_rank,
                  lease_epoch, created_at_ms, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, 'received', 1, ?5, ?6, ?6)",
                params![
                    send_job_id,
                    generation,
                    command_id,
                    binding_id,
                    epoch_to_db(0),
                    now
                ],
            )
            .map_err(|error| format!("email intake job insert failed: {error}"))?;
            let received_payload = build_received_event(&first_status_event_id);
            txn.execute(
                "INSERT OR IGNORE INTO email_send_events
                 (status_event_id, send_job_id, generation, phase, phase_rank, payload_sha256,
                  payload_json, outbox_state, created_at_ms)
                 VALUES (?1, ?2, ?3, 'received', ?4, ?5, ?6, 'pending', ?7)",
                params![
                    first_status_event_id,
                    send_job_id,
                    generation,
                    SendPhase::Received.rank(),
                    contract::canonical_payload_sha256(&received_payload),
                    received_payload.to_string(),
                    now
                ],
            )
            .map_err(|error| format!("email intake received event insert failed: {error}"))?;
            // New generation supersedes lower non-terminal generations.
            txn.execute(
                "UPDATE email_send_jobs SET superseded = 1, updated_at_ms = ?3
                 WHERE send_job_id = ?1 AND generation < ?2 AND terminal_outcome IS NULL",
                params![send_job_id, generation, now],
            )
            .map_err(|error| format!("email intake supersede update failed: {error}"))?;
            email_killpoint("pre_receipt_commit");
            txn.commit()
                .map_err(|error| format!("email intake txn commit failed: {error}"))?;
            Ok(CommandIntake::Accepted {
                first_status_event_id,
            })
        })
    }

    /// Companion-command receipt (probe/preflight): durable receipt before
    /// ack, same dedup identity, no job row.
    pub fn record_companion_command(
        &mut self,
        command_id: &str,
        payload_sha256: &str,
        source: &str,
    ) -> Result<CommandIntake, String> {
        let now = now_ms();
        self.with_full_synchronous(|connection| {
            let txn = connection
                .transaction()
                .map_err(|error| format!("email companion txn begin failed: {error}"))?;
            if let Some((existing_hash, first_event)) = txn
                .query_row(
                    "SELECT payload_sha256, first_status_event_id
                     FROM email_command_receipts WHERE command_id = ?1",
                    [command_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(|error| format!("email companion receipt check failed: {error}"))?
            {
                txn.commit()
                    .map_err(|error| format!("email companion txn commit failed: {error}"))?;
                if existing_hash == payload_sha256 {
                    return Ok(CommandIntake::Duplicate {
                        first_status_event_id: first_event,
                    });
                }
                return Ok(CommandIntake::SecurityRejected {
                    journaled_sha256: existing_hash,
                });
            }
            txn.execute(
                "INSERT INTO email_command_receipts
                 (command_id, payload_sha256, received_at_ms, ack_result, source)
                 VALUES (?1, ?2, ?3, 'accepted', ?4)",
                params![command_id, payload_sha256, now, source],
            )
            .map_err(|error| format!("email companion receipt insert failed: {error}"))?;
            txn.commit()
                .map_err(|error| format!("email companion txn commit failed: {error}"))?;
            Ok(CommandIntake::Accepted {
                first_status_event_id: String::new(),
            })
        })
    }

    // ------------------------------------------------------------------
    // Send-job lifecycle
    // ------------------------------------------------------------------

    pub fn load_job(
        &self,
        send_job_id: &str,
        generation: u32,
    ) -> Result<Option<SendJobRow>, String> {
        self.connection
            .query_row(
                "SELECT send_job_id, generation, command_id, binding_id, mode, phase, phase_rank,
                        lease_id, lease_epoch, lease_expires_at_ms, mime_sha256, mime_size_bytes,
                        data_started, cancel_requested, superseded, last_smtp_code,
                        last_response_class, terminal_outcome, terminal_at_ms
                 FROM email_send_jobs WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation],
                |row| {
                    Ok(SendJobRow {
                        send_job_id: row.get(0)?,
                        generation: row.get::<_, i64>(1)? as u32,
                        command_id: row.get(2)?,
                        binding_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        mode: row.get(4)?,
                        phase: row.get(5)?,
                        phase_rank: row.get::<_, i64>(6)? as u32,
                        lease_id: row.get(7)?,
                        lease_epoch: {
                            let text = row.get::<_, String>(8)?;
                            epoch_from_db(&text).map_err(|error| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    8,
                                    rusqlite::types::Type::Text,
                                    error.into(),
                                )
                            })?
                        },
                        lease_expires_at_ms: row.get(9)?,
                        mime_sha256: row.get(10)?,
                        mime_size_bytes: row.get(11)?,
                        data_started: row.get::<_, i64>(12)? != 0,
                        cancel_requested: row.get::<_, i64>(13)? != 0,
                        superseded: row.get::<_, i64>(14)? != 0,
                        last_smtp_code: row
                            .get::<_, Option<i64>>(15)?
                            .and_then(|code| u16::try_from(code).ok()),
                        last_response_class: row.get(16)?,
                        terminal_outcome: row.get(17)?,
                        terminal_at_ms: row.get(18)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("email journal job load failed: {error}"))
    }

    /// Advance the ladder phase — ranks only move forward (§6b.2). A lower or
    /// equal rank is a no-op (SMTP retries under a valid lease restart wire
    /// phases locally, but the journal keeps the max rank).
    pub fn advance_phase(
        &mut self,
        send_job_id: &str,
        generation: u32,
        phase: SendPhase,
    ) -> Result<bool, String> {
        let changed = self
            .connection
            .execute(
                "UPDATE email_send_jobs
                 SET phase = ?3, phase_rank = ?4, updated_at_ms = ?5
                 WHERE send_job_id = ?1 AND generation = ?2 AND phase_rank < ?4
                   AND terminal_outcome IS NULL",
                params![
                    send_job_id,
                    generation,
                    phase.as_str(),
                    phase.rank(),
                    now_ms()
                ],
            )
            .map_err(|error| format!("email journal phase advance failed: {error}"))?;
        Ok(changed > 0)
    }

    pub fn record_lease(
        &mut self,
        send_job_id: &str,
        generation: u32,
        mode: &str,
        lease_id: &str,
        lease_epoch: u64,
        lease_expires_at_ms: i64,
        mime_sha256: &str,
        mime_size_bytes: i64,
    ) -> Result<(), String> {
        // Higher lease epoch fences lower: never write an older epoch over a
        // newer one (§10.1).
        let updated = self
            .connection
            .execute(
                "UPDATE email_send_jobs
                 SET mode = ?3, lease_id = ?4, lease_epoch = ?5, lease_expires_at_ms = ?6,
                     mime_sha256 = ?7, mime_size_bytes = ?8, updated_at_ms = ?9
                 WHERE send_job_id = ?1 AND generation = ?2 AND lease_epoch <= ?5
                   AND terminal_outcome IS NULL",
                params![
                    send_job_id,
                    generation,
                    mode,
                    lease_id,
                    epoch_to_db(lease_epoch),
                    lease_expires_at_ms,
                    mime_sha256,
                    mime_size_bytes,
                    now_ms()
                ],
            )
            .map_err(|error| format!("email journal lease record failed: {error}"))?;
        if updated == 0 {
            return Err("email journal lease record fenced by newer epoch or terminal".to_string());
        }
        Ok(())
    }

    pub fn extend_lease(
        &mut self,
        send_job_id: &str,
        generation: u32,
        lease_epoch: u64,
        lease_expires_at_ms: i64,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE email_send_jobs SET lease_expires_at_ms = ?4, updated_at_ms = ?5
                 WHERE send_job_id = ?1 AND generation = ?2 AND lease_epoch = ?3",
                params![
                    send_job_id,
                    generation,
                    epoch_to_db(lease_epoch),
                    lease_expires_at_ms,
                    now_ms()
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("email journal lease extend failed: {error}"))
    }

    pub fn replace_recipients(
        &mut self,
        send_job_id: &str,
        generation: u32,
        recipients: &[RecipientRow],
    ) -> Result<(), String> {
        let now = now_ms();
        let txn = self
            .connection
            .transaction()
            .map_err(|error| format!("email recipients txn begin failed: {error}"))?;
        txn.execute(
            "DELETE FROM email_send_recipients WHERE send_job_id = ?1 AND generation = ?2",
            params![send_job_id, generation],
        )
        .map_err(|error| format!("email recipients clear failed: {error}"))?;
        for recipient in recipients {
            txn.execute(
                "INSERT INTO email_send_recipients
                 (send_job_id, generation, recipient_ref, role, address, domain, status,
                  smtp_code, enhanced_code, response_class, response_sanitized, retry_at_ms,
                  updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    send_job_id,
                    generation,
                    recipient.recipient_ref,
                    recipient.role,
                    recipient.address,
                    recipient.domain,
                    recipient.status,
                    recipient.smtp_code.map(i64::from),
                    recipient.enhanced_code,
                    recipient.response_class,
                    recipient.response_sanitized,
                    recipient.retry_at_ms,
                    now
                ],
            )
            .map_err(|error| format!("email recipients insert failed: {error}"))?;
        }
        txn.commit()
            .map_err(|error| format!("email recipients txn commit failed: {error}"))
    }

    pub fn update_recipient_status(
        &mut self,
        send_job_id: &str,
        generation: u32,
        recipient_ref: &str,
        status: &str,
        smtp_code: Option<u16>,
        enhanced_code: Option<&str>,
        response_class: Option<&str>,
        response_sanitized: Option<&str>,
        retry_at_ms: Option<i64>,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE email_send_recipients
                 SET status = ?4, smtp_code = ?5, enhanced_code = ?6, response_class = ?7,
                     response_sanitized = ?8, retry_at_ms = ?9, updated_at_ms = ?10
                 WHERE send_job_id = ?1 AND generation = ?2 AND recipient_ref = ?3",
                params![
                    send_job_id,
                    generation,
                    recipient_ref,
                    status,
                    smtp_code.map(i64::from),
                    enhanced_code,
                    response_class,
                    response_sanitized,
                    retry_at_ms,
                    now_ms()
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("email recipient status update failed: {error}"))
    }

    pub fn load_recipients(
        &self,
        send_job_id: &str,
        generation: u32,
    ) -> Result<Vec<RecipientRow>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT recipient_ref, role, address, domain, status, smtp_code, enhanced_code,
                        response_class, response_sanitized, retry_at_ms
                 FROM email_send_recipients
                 WHERE send_job_id = ?1 AND generation = ?2 ORDER BY recipient_ref",
            )
            .map_err(|error| format!("email recipients prepare failed: {error}"))?;
        let rows = statement
            .query_map(params![send_job_id, generation], |row| {
                Ok(RecipientRow {
                    recipient_ref: row.get(0)?,
                    role: row.get(1)?,
                    address: row.get(2)?,
                    domain: row.get(3)?,
                    status: row.get(4)?,
                    smtp_code: row
                        .get::<_, Option<i64>>(5)?
                        .and_then(|code| u16::try_from(code).ok()),
                    enhanced_code: row.get(6)?,
                    response_class: row.get(7)?,
                    response_sanitized: row.get(8)?,
                    retry_at_ms: row.get(9)?,
                })
            })
            .map_err(|error| format!("email recipients query failed: {error}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|error| format!("email recipients row failed: {error}"))?);
        }
        Ok(out)
    }

    pub fn begin_attempt(
        &mut self,
        send_job_id: &str,
        generation: u32,
        dest_host_sanitized: Option<&str>,
    ) -> Result<u32, String> {
        let next: i64 = self
            .connection
            .query_row(
                "SELECT COALESCE(MAX(attempt), 0) + 1 FROM email_send_attempts
                 WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation],
                |row| row.get(0),
            )
            .map_err(|error| format!("email attempt sequence failed: {error}"))?;
        self.connection
            .execute(
                "INSERT INTO email_send_attempts
                 (send_job_id, generation, attempt, started_at_ms, dest_host_sanitized)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![send_job_id, generation, next, now_ms(), dest_host_sanitized],
            )
            .map_err(|error| format!("email attempt insert failed: {error}"))?;
        Ok(next as u32)
    }

    pub fn finish_attempt(
        &mut self,
        send_job_id: &str,
        generation: u32,
        attempt: u32,
        phase_reached: &str,
        outcome: &str,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE email_send_attempts
                 SET ended_at_ms = ?4, phase_reached = ?5, outcome = ?6
                 WHERE send_job_id = ?1 AND generation = ?2 AND attempt = ?3",
                params![
                    send_job_id,
                    generation,
                    attempt,
                    now_ms(),
                    phase_reached,
                    outcome
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("email attempt finish failed: {error}"))
    }

    /// Request a cancel. Honored strictly before `data_started` (§6b.2): if
    /// the DATA boundary already committed the request is refused with the
    /// `data_boundary_crossed` shape.
    pub fn request_cancel(
        &mut self,
        send_job_id: &str,
        generation: u32,
    ) -> Result<Result<(), String>, String> {
        let job = self
            .load_job(send_job_id, generation)?
            .ok_or_else(|| "email cancel: unknown job".to_string())?;
        if job.data_started {
            return Ok(Err("data_boundary_crossed".to_string()));
        }
        if job.terminal_outcome.is_some() {
            return Ok(Err("already_terminal".to_string()));
        }
        self.connection
            .execute(
                "UPDATE email_send_jobs SET cancel_requested = 1, updated_at_ms = ?3
                 WHERE send_job_id = ?1 AND generation = ?2 AND data_started = 0",
                params![send_job_id, generation, now_ms()],
            )
            .map_err(|error| format!("email cancel update failed: {error}"))?;
        Ok(Ok(()))
    }

    /// The DATA-boundary write (§6b.2 / §10.1): `data_started` committed with
    /// `synchronous=FULL` BEFORE the DATA command goes on the wire. The
    /// update is MONOTONIC — a job already at or past `data_completed` is
    /// never regressed back to `data_started` (a duplicate worker attempting
    /// it gets an error and must stop).
    pub fn mark_data_started(&mut self, send_job_id: &str, generation: u32) -> Result<(), String> {
        self.with_full_synchronous(|connection| {
            let txn = connection
                .transaction()
                .map_err(|error| format!("email data_started txn begin failed: {error}"))?;
            let updated = txn
                .execute(
                    "UPDATE email_send_jobs
                     SET data_started = 1, phase = 'data_started', phase_rank = ?3,
                         updated_at_ms = ?4
                     WHERE send_job_id = ?1 AND generation = ?2 AND terminal_outcome IS NULL
                       AND phase_rank < ?5",
                    params![
                        send_job_id,
                        generation,
                        SendPhase::DataStarted.rank(),
                        now_ms(),
                        SendPhase::DataCompleted.rank()
                    ],
                )
                .map_err(|error| format!("email data_started update failed: {error}"))?;
            if updated == 0 {
                return Err(
                    "email data_started on unknown, terminal, or already-completed job".to_string(),
                );
            }
            txn.commit()
                .map_err(|error| format!("email data_started commit failed: {error}"))
        })
    }

    /// Journal the provider 2xx BEFORE reporting it (§10.1): phase
    /// data_completed + the sanitized code, committed FULL. Monotonic (only
    /// a job that crossed `data_started` and is not settled can complete).
    /// When `settle_pending_recipients` carries the sanitized provider line,
    /// every still-pending recipient row flips to `submitted` in the SAME
    /// transaction — a crash can never leave a persisted 2xx alongside
    /// `pending` recipient rows.
    pub fn mark_data_completed(
        &mut self,
        send_job_id: &str,
        generation: u32,
        smtp_code: Option<u16>,
        response_class: &str,
        settle_pending_recipients: Option<&str>,
    ) -> Result<(), String> {
        self.with_full_synchronous(|connection| {
            let txn = connection
                .transaction()
                .map_err(|error| format!("email data_completed txn begin failed: {error}"))?;
            let updated = txn
                .execute(
                    "UPDATE email_send_jobs
                     SET phase = 'data_completed', phase_rank = ?3, last_smtp_code = ?4,
                         last_response_class = ?5, updated_at_ms = ?6
                     WHERE send_job_id = ?1 AND generation = ?2 AND terminal_outcome IS NULL
                       AND data_started = 1 AND phase_rank < ?7",
                    params![
                        send_job_id,
                        generation,
                        SendPhase::DataCompleted.rank(),
                        smtp_code.map(i64::from),
                        response_class,
                        now_ms(),
                        SendPhase::Settled.rank()
                    ],
                )
                .map_err(|error| format!("email data_completed update failed: {error}"))?;
            if updated == 0 {
                return Err(
                    "email data_completed on unknown, terminal, or pre-DATA job".to_string()
                );
            }
            if let Some(sanitized) = settle_pending_recipients {
                txn.execute(
                    "UPDATE email_send_recipients
                     SET status = 'submitted', smtp_code = ?3, response_class = ?4,
                         response_sanitized = ?5, updated_at_ms = ?6
                     WHERE send_job_id = ?1 AND generation = ?2 AND status = 'pending'",
                    params![
                        send_job_id,
                        generation,
                        smtp_code.map(i64::from),
                        response_class,
                        sanitized,
                        now_ms()
                    ],
                )
                .map_err(|error| format!("email data_completed recipients failed: {error}"))?;
            }
            txn.commit()
                .map_err(|error| format!("email data_completed commit failed: {error}"))
        })
    }

    /// Terminal settlement: outcome + tombstone + the settled event row in
    /// ONE FULL transaction — journaled before reported (§10.1). Returns
    /// false when the pair was already terminal (idempotent).
    pub fn journal_terminal(
        &mut self,
        send_job_id: &str,
        generation: u32,
        terminal_outcome: &str,
        settled_event: &PendingEventRow,
    ) -> Result<bool, String> {
        if !contract::TERMINAL_OUTCOMES.contains(&terminal_outcome) {
            return Err(format!("unknown terminal outcome: {terminal_outcome}"));
        }
        let now = now_ms();
        let payload_json = settled_event.payload.to_string();
        let payload_sha = contract::canonical_payload_sha256(&settled_event.payload);
        self.with_full_synchronous(|connection| {
            let txn = connection
                .transaction()
                .map_err(|error| format!("email terminal txn begin failed: {error}"))?;
            let updated = txn
                .execute(
                    "UPDATE email_send_jobs
                     SET phase = 'settled', phase_rank = ?3, terminal_outcome = ?4,
                         terminal_at_ms = ?5, updated_at_ms = ?5
                     WHERE send_job_id = ?1 AND generation = ?2 AND terminal_outcome IS NULL",
                    params![
                        send_job_id,
                        generation,
                        SendPhase::Settled.rank(),
                        terminal_outcome,
                        now
                    ],
                )
                .map_err(|error| format!("email terminal update failed: {error}"))?;
            if updated == 0 {
                return Ok(false);
            }
            txn.execute(
                "INSERT OR IGNORE INTO email_send_tombstones
                 (send_job_id, generation, terminal_outcome, journaled_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![send_job_id, generation, terminal_outcome, now],
            )
            .map_err(|error| format!("email tombstone insert failed: {error}"))?;
            txn.execute(
                "INSERT OR IGNORE INTO email_send_events
                 (status_event_id, send_job_id, generation, phase, phase_rank, payload_sha256,
                  payload_json, outbox_state, created_at_ms)
                 VALUES (?1, ?2, ?3, 'settled', ?4, ?5, ?6, 'pending', ?7)",
                params![
                    settled_event.status_event_id,
                    send_job_id,
                    generation,
                    SendPhase::Settled.rank(),
                    payload_sha,
                    payload_json,
                    now
                ],
            )
            .map_err(|error| format!("email terminal event insert failed: {error}"))?;
            txn.commit()
                .map_err(|error| format!("email terminal commit failed: {error}"))?;
            Ok(true)
        })
    }

    // ------------------------------------------------------------------
    // Send events (§9.2/§9.3): journal row first, outbox handoff second,
    // cloud ack recorded when it lands.
    // ------------------------------------------------------------------

    pub fn insert_send_event(
        &mut self,
        send_job_id: &str,
        generation: u32,
        phase: SendPhase,
        status_event_id: &str,
        payload: &Value,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT OR IGNORE INTO email_send_events
                 (status_event_id, send_job_id, generation, phase, phase_rank, payload_sha256,
                  payload_json, outbox_state, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8)",
                params![
                    status_event_id,
                    send_job_id,
                    generation,
                    phase.as_str(),
                    phase.rank(),
                    contract::canonical_payload_sha256(payload),
                    payload.to_string(),
                    now_ms()
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("email send event insert failed: {error}"))
    }

    pub fn mark_event_handed_off(&mut self, status_event_id: &str) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE email_send_events
                 SET outbox_state = CASE WHEN outbox_state = 'acked' THEN outbox_state
                                        ELSE 'handed_off' END,
                     handed_off_at_ms = COALESCE(handed_off_at_ms, ?2)
                 WHERE status_event_id = ?1",
                params![status_event_id, now_ms()],
            )
            .map(|_| ())
            .map_err(|error| format!("email send event handoff failed: {error}"))
    }

    /// Load the journaled `settled` event for a pair, if any — the ORIGINAL
    /// terminal report. A duplicate settle attempt re-hands THIS event
    /// (review #7): a terminal payload that lost the settle race must never
    /// be reported, because it was never journaled.
    pub fn load_settled_event(
        &self,
        send_job_id: &str,
        generation: u32,
    ) -> Result<Option<(PendingEventRow, String)>, String> {
        self.connection
            .query_row(
                "SELECT status_event_id, payload_json, outbox_state FROM email_send_events
                 WHERE send_job_id = ?1 AND generation = ?2 AND phase = 'settled'
                 ORDER BY created_at_ms ASC LIMIT 1",
                params![send_job_id, generation],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("email settled event load failed: {error}"))?
            .map(|(status_event_id, payload_json, outbox_state)| {
                let payload = serde_json::from_str::<Value>(&payload_json)
                    .map_err(|error| format!("email settled event payload corrupt: {error}"))?;
                Ok((
                    PendingEventRow {
                        status_event_id,
                        send_job_id: send_job_id.to_string(),
                        generation,
                        payload,
                    },
                    outbox_state,
                ))
            })
            .transpose()
    }

    /// Record the §9.3 settlement ack. Stale-generation acks are SUCCESS with
    /// `applied: false, audit: "stale_generation"` — the event is cloud-acked
    /// either way.
    pub fn record_cloud_ack(
        &mut self,
        status_event_id: &str,
        applied: bool,
        audit: Option<&str>,
    ) -> Result<(), String> {
        if let Some(audit_slug) = audit {
            if !contract::SETTLEMENT_AUDITS.contains(&audit_slug) {
                return Err(format!("unknown settlement audit slug: {audit_slug}"));
            }
        }
        self.connection
            .execute(
                "UPDATE email_send_events
                 SET outbox_state = 'acked', cloud_acked_at_ms = ?2, cloud_applied = ?3,
                     cloud_audit = ?4
                 WHERE status_event_id = ?1",
                params![status_event_id, now_ms(), applied as i64, audit],
            )
            .map(|_| ())
            .map_err(|error| format!("email send event ack record failed: {error}"))
    }

    /// Events not yet cloud-acked for ONE (send_job_id, generation), oldest
    /// first — the worker flushes these before running so the ack's
    /// `first_status_event_id` (journaled at intake) always reaches the
    /// outbox, including on duplicate redelivery after an ack-side crash.
    pub fn pending_events_for(
        &self,
        send_job_id: &str,
        generation: u32,
    ) -> Result<Vec<PendingEventRow>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT status_event_id, send_job_id, generation, payload_json
                 FROM email_send_events
                 WHERE outbox_state = 'pending' AND send_job_id = ?1 AND generation = ?2
                 ORDER BY created_at_ms ASC",
            )
            .map_err(|error| format!("email pending events prepare failed: {error}"))?;
        let rows = statement
            .query_map(params![send_job_id, generation], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| format!("email pending events query failed: {error}"))?;
        let mut out = Vec::new();
        for row in rows {
            let (status_event_id, send_job_id, generation, payload_json) =
                row.map_err(|error| format!("email pending events row failed: {error}"))?;
            let payload = serde_json::from_str::<Value>(&payload_json)
                .map_err(|error| format!("email pending event payload corrupt: {error}"))?;
            out.push(PendingEventRow {
                status_event_id,
                send_job_id,
                generation: generation as u32,
                payload,
            });
        }
        Ok(out)
    }

    /// Events not yet cloud-acked, oldest first — the resume path re-hands
    /// these to the durable outbox.
    pub fn pending_events(&self) -> Result<Vec<PendingEventRow>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT status_event_id, send_job_id, generation, payload_json
                 FROM email_send_events WHERE outbox_state != 'acked'
                 ORDER BY created_at_ms ASC",
            )
            .map_err(|error| format!("email pending events prepare failed: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| format!("email pending events query failed: {error}"))?;
        let mut out = Vec::new();
        for row in rows {
            let (status_event_id, send_job_id, generation, payload_json) =
                row.map_err(|error| format!("email pending events row failed: {error}"))?;
            let payload = serde_json::from_str::<Value>(&payload_json)
                .map_err(|error| format!("email pending event payload corrupt: {error}"))?;
            out.push(PendingEventRow {
                status_event_id,
                send_job_id,
                generation: generation as u32,
                payload,
            });
        }
        Ok(out)
    }

    // ------------------------------------------------------------------
    // Tombstones (§10.1): no time-based deletion; compaction only after the
    // §9.4 email_generation_retired ack.
    // ------------------------------------------------------------------

    pub fn record_generation_retired(
        &mut self,
        send_job_id: &str,
        generation: u32,
    ) -> Result<bool, String> {
        let updated = self
            .connection
            .execute(
                "UPDATE email_send_tombstones
                 SET cloud_generation_retired_acked = 1,
                     retired_acked_at_ms = COALESCE(retired_acked_at_ms, ?3)
                 WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation, now_ms()],
            )
            .map_err(|error| format!("email tombstone retire ack failed: {error}"))?;
        Ok(updated > 0)
    }

    /// Compact retired-acked tombstones: the tombstone ROW stays forever
    /// (dominance must survive), but the bulky job/recipient/attempt rows and
    /// cloud-acked event rows for the pair are dropped. Tombstones without
    /// the retirement ack are untouched — this is the whole law.
    pub fn compact_retired_tombstones(&mut self) -> Result<u32, String> {
        let candidates: Vec<(String, u32)> = {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT t.send_job_id, t.generation FROM email_send_tombstones t
                     WHERE t.cloud_generation_retired_acked = 1 AND t.compacted = 0
                       AND NOT EXISTS (
                           SELECT 1 FROM email_send_events e
                           WHERE e.send_job_id = t.send_job_id AND e.generation = t.generation
                             AND e.outbox_state != 'acked'
                       )",
                )
                .map_err(|error| format!("email compaction prepare failed: {error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u32))
                })
                .map_err(|error| format!("email compaction query failed: {error}"))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|error| format!("email compaction row failed: {error}"))?);
            }
            out
        };
        let mut compacted = 0u32;
        for (send_job_id, generation) in candidates {
            let txn = self
                .connection
                .transaction()
                .map_err(|error| format!("email compaction txn begin failed: {error}"))?;
            txn.execute(
                "DELETE FROM email_send_recipients WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation],
            )
            .map_err(|error| format!("email compaction recipients failed: {error}"))?;
            txn.execute(
                "DELETE FROM email_send_attempts WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation],
            )
            .map_err(|error| format!("email compaction attempts failed: {error}"))?;
            txn.execute(
                "DELETE FROM email_send_events WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation],
            )
            .map_err(|error| format!("email compaction events failed: {error}"))?;
            txn.execute(
                "DELETE FROM email_send_jobs WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation],
            )
            .map_err(|error| format!("email compaction job failed: {error}"))?;
            txn.execute(
                "UPDATE email_send_tombstones SET compacted = 1, compacted_at_ms = ?3
                 WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation, now_ms()],
            )
            .map_err(|error| format!("email compaction mark failed: {error}"))?;
            txn.commit()
                .map_err(|error| format!("email compaction commit failed: {error}"))?;
            compacted += 1;
        }
        Ok(compacted)
    }

    pub fn tombstone(
        &self,
        send_job_id: &str,
        generation: u32,
    ) -> Result<Option<(String, bool, bool)>, String> {
        self.connection
            .query_row(
                "SELECT terminal_outcome, cloud_generation_retired_acked, compacted
                 FROM email_send_tombstones WHERE send_job_id = ?1 AND generation = ?2",
                params![send_job_id, generation],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? != 0,
                        row.get::<_, i64>(2)? != 0,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("email tombstone read failed: {error}"))
    }

    // ------------------------------------------------------------------
    // Crash recovery (plan §6 device matrix)
    // ------------------------------------------------------------------

    /// Classify every non-terminal job after a crash/restart:
    /// - phase `data_completed` with a persisted response → finish as
    ///   `submitted` (terminal-if-persisted);
    /// - `data_started` without a persisted outcome → `delivery_unknown`,
    ///   NEVER retransmitted;
    /// - pre-DATA phases → left non-terminal for the resume/reoffer path
    ///   (retryable under a fresh lease).
    ///
    /// Returns (send_job_id, generation, journaled_outcome) for every job the
    /// recovery settled. The caller reports the settled events afterwards —
    /// terminal is journaled before reported.
    pub fn recover_after_restart(
        &mut self,
        device_id: &str,
    ) -> Result<Vec<(String, u32, String)>, String> {
        let incomplete: Vec<SendJobRow> = {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT send_job_id, generation FROM email_send_jobs
                     WHERE terminal_outcome IS NULL AND data_started = 1",
                )
                .map_err(|error| format!("email recovery prepare failed: {error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u32))
                })
                .map_err(|error| format!("email recovery query failed: {error}"))?;
            let mut out = Vec::new();
            for row in rows {
                let (send_job_id, generation) =
                    row.map_err(|error| format!("email recovery row failed: {error}"))?;
                if let Some(job) = self.load_job(&send_job_id, generation)? {
                    out.push(job);
                }
            }
            out
        };
        let mut settled = Vec::new();
        for job in incomplete {
            if let Some(entry) = self.classify_and_settle_incomplete(&job, device_id)? {
                settled.push(entry);
            }
        }
        Ok(settled)
    }

    /// Recover ONE incomplete (data_started, non-terminal) pair — the same
    /// classification the startup sweep uses, callable from the send worker
    /// when it encounters a job that already crossed DATA (§10.1: such a
    /// generation may NEVER re-enter SMTP; a duplicate wake terminalizes it
    /// instead of re-running it).
    pub fn recover_incomplete_pair(
        &mut self,
        send_job_id: &str,
        generation: u32,
        device_id: &str,
    ) -> Result<Option<(String, u32, String)>, String> {
        let Some(job) = self.load_job(send_job_id, generation)? else {
            return Ok(None);
        };
        if job.terminal_outcome.is_some() || !job.data_started {
            return Ok(None);
        }
        self.classify_and_settle_incomplete(&job, device_id)
    }

    fn classify_and_settle_incomplete(
        &mut self,
        job: &SendJobRow,
        device_id: &str,
    ) -> Result<Option<(String, u32, String)>, String> {
        {
            let job = job.clone();
            let persisted_success = job.phase == SendPhase::DataCompleted.as_str()
                && job
                    .last_response_class
                    .as_deref()
                    .is_some_and(|class| class == "accepted");
            // Persisted provider success is authoritative for recipients that
            // never got their row flip (pre-#8-fix journals): force them to
            // `submitted` before building the terminal event so the report
            // can never contradict the persisted 2xx.
            if persisted_success {
                self.connection
                    .execute(
                        "UPDATE email_send_recipients
                         SET status = 'submitted', smtp_code = COALESCE(smtp_code, ?3),
                             response_class = COALESCE(response_class, 'accepted'),
                             updated_at_ms = ?4
                         WHERE send_job_id = ?1 AND generation = ?2 AND status = 'pending'",
                        params![
                            job.send_job_id,
                            job.generation,
                            job.last_smtp_code.map(i64::from),
                            now_ms()
                        ],
                    )
                    .map_err(|error| format!("email recovery recipient force failed: {error}"))?;
            }
            let (outcome, error_class, delivery_state, response_class) = if persisted_success {
                ("submitted", "none", "submitted", "accepted")
            } else {
                (
                    "delivery_unknown",
                    "delivery_unknown",
                    "delivery_unknown",
                    "connection_failed",
                )
            };
            let status_event_id = uuid::Uuid::new_v4().to_string();
            let recipients = self.load_recipients(&job.send_job_id, job.generation)?;
            let per_recipient: Vec<Value> = recipients
                .iter()
                .map(|recipient| {
                    let mut entry = json!({
                        "recipient_ref": recipient.recipient_ref,
                        "role": recipient.role,
                        "address": recipient.address,
                        "delivery_state": if persisted_success {
                            recipient.status.clone()
                        } else {
                            delivery_state.to_string()
                        },
                        "updated_at_ms": now_ms(),
                    });
                    if persisted_success {
                        if let (Some(code), Some(class)) =
                            (recipient.smtp_code, recipient.response_class.as_deref())
                        {
                            entry["response"] = json!({
                                "smtp_code": code,
                                "response_class": class,
                            });
                            if let Some(enhanced) = recipient.enhanced_code.as_deref() {
                                entry["response"]["enhanced_code"] = json!(enhanced);
                            }
                        }
                    } else {
                        entry["response"] = json!({"response_class": response_class});
                    }
                    entry
                })
                .collect();
            let mut payload = json!({
                "contract": contract::EMAIL_CONTRACT,
                "schema_version": contract::EMAIL_SCHEMA_VERSION,
                "status_event_id": status_event_id,
                "command_id": job.command_id,
                "send_job_id": job.send_job_id,
                "generation": job.generation,
                "device_id": device_id,
                "binding_id": job.binding_id,
                "phase": "settled",
                "phase_rank": SendPhase::Settled.rank(),
                "data_started": true,
                "occurred_at_ms": now_ms(),
                "per_recipient": per_recipient,
                "error_class": error_class,
            });
            if let Some(mode) = job.mode.as_deref() {
                payload["mode"] = json!(mode);
            }
            if let Some(lease_id) = job.lease_id.as_deref() {
                payload["lease_id"] = json!(lease_id);
            }
            payload["lease_epoch"] = json!(contract::u64_to_wire(job.lease_epoch));
            if let Some(mime_sha256) = job.mime_sha256.as_deref() {
                payload["mime_sha256"] = json!(mime_sha256);
            }
            if persisted_success {
                if let Some(code) = job.last_smtp_code {
                    payload["response"] = json!({
                        "smtp_code": code,
                        "response_class": "accepted",
                    });
                }
            }
            let event = PendingEventRow {
                status_event_id: status_event_id.clone(),
                send_job_id: job.send_job_id.clone(),
                generation: job.generation,
                payload,
            };
            if self.journal_terminal(&job.send_job_id, job.generation, outcome, &event)? {
                return Ok(Some((
                    job.send_job_id.clone(),
                    job.generation,
                    outcome.to_string(),
                )));
            }
            Ok(None)
        }
    }

    /// Journal summaries for `email_send_resume` (§8): every non-terminal
    /// job's (send_job_id, generation, phase, lease_epoch).
    pub fn resume_summaries(&self) -> Result<Vec<Value>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT send_job_id, generation, phase, lease_epoch FROM email_send_jobs
                 WHERE terminal_outcome IS NULL AND superseded = 0
                 ORDER BY created_at_ms ASC",
            )
            .map_err(|error| format!("email resume summaries prepare failed: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                let lease_epoch_text = row.get::<_, String>(3)?;
                let lease_epoch = epoch_from_db(&lease_epoch_text).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        error.into(),
                    )
                })?;
                Ok(json!({
                    "send_job_id": row.get::<_, String>(0)?,
                    "generation": row.get::<_, i64>(1)?,
                    "phase": row.get::<_, String>(2)?,
                    // Decode the sortable-TEXT DB form back to the §0.2
                    // unsigned decimal string (no zero padding on the wire).
                    "lease_epoch": lease_epoch.to_string(),
                }))
            })
            .map_err(|error| format!("email resume summaries query failed: {error}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|error| format!("email resume summaries row failed: {error}"))?);
        }
        Ok(out)
    }

    /// Cheap health probe used by preflight `journal_health` and the UI.
    pub fn health_check(&self) -> Result<Value, String> {
        let quick_check: String = self
            .connection
            .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
            .map_err(|error| format!("email journal quick_check failed: {error}"))?;
        let jobs: i64 = self
            .connection
            .query_row("SELECT COUNT(1) FROM email_send_jobs", [], |row| row.get(0))
            .map_err(|error| format!("email journal count failed: {error}"))?;
        let tombstones: i64 = self
            .connection
            .query_row("SELECT COUNT(1) FROM email_send_tombstones", [], |row| {
                row.get(0)
            })
            .map_err(|error| format!("email journal count failed: {error}"))?;
        let pending_events: i64 = self
            .connection
            .query_row(
                "SELECT COUNT(1) FROM email_send_events WHERE outbox_state != 'acked'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("email journal count failed: {error}"))?;
        Ok(json!({
            "ok": quick_check == "ok",
            "quick_check": quick_check,
            "schema_version": self.schema_version()?,
            "jobs": jobs,
            "tombstones": tombstones,
            "pending_events": pending_events,
            "path": self.path.display().to_string(),
        }))
    }
}
