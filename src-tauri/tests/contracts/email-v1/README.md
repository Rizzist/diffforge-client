# email-v1 golden fixture corpus

Canonical spec: `docs/email-v1-contract.md` (v2; SS11 defines this corpus; the lock file
`tests/contracts/email-v1.lock` pins the set).

Every fixture is one JSON object `{description, expect, payload}`.

Conventions:

- `expect: "valid"` means the payload parses and a conforming implementation accepts it;
  `expect: "reject:<reason-slug>"` means a conforming validator/handler must refuse it for
  that reason.
- SS0.4 split: everything state-shaped is a structured refusal - a `valid` fixture whose
  mutation-envelope `result` (or read payload) carries `refusal: <slug>` from the closed
  registry (see `refusals__slug_registry__closed.json`). `reject:*` fixtures carry the
  outer `{code, message, retryable}` error envelope and are reserved for requests that
  cannot be admitted (malformed/fail-closed input, addressing, authorization,
  availability, `idempotency_conflict`).
- Mutation responses use the SS0.4 envelope `{contract, schema_version, duplicate,
  mailbox_revision, email_mutation_seq, coverage, result}`; read responses are plain
  contract payloads. Every payload carries `contract` + `schema_version` except the four
  envelope-free shapes: the claim (SS4.2), the coverage tuple (SS0.2), the engine manifest
  lane entry (SS7) and device journal rows (SS10.1).
- SS0.2 u64s (`seq`/revision/generation-count family) are decimal JSON strings on every
  email-owned surface; engine manifest lane entries and journal rows keep native numeric
  scalars. Byte counts are always `size_bytes` (lane entries keep SSD's native `size`).
  Inapplicable fields are absent, never null; the single semantic null is `coverage: null`.
- Send-event fixtures are `{event, ack}` pairs (SS9.2/SS9.3); the events are
  phase-discriminated with `phase_rank` and no `terminal` bool.
  `send_event__email_send_event__stale_generation` is `valid`: stale generations get a
  SUCCESS ack with `applied: false, audit: "stale_generation"`, never an error.
- Request-area payloads are `{request, response}` (happy/refusal) or `{request, error}`
  (outer error). Claim and coverage-tuple verification-time context (now, expected
  audience, true body hash, seen jti) lives in the description.
- All values are hand-written stable literals; ids reuse one cast (account
  `acct_mfrggzdfmztwq2lknnwg23tpob`, receipt `01J2ZK7Q8R9S6T5V4W3X2Y1Z0A`, etc.) so
  cross-fixture references line up.

## Fixtures (150)

- `coverage__tuple__basic.json` - [valid] The SSE.6 force_seal_and_wait coverage tuple: envelope-free engine surface with engine-native scalars; seq/epoch become string u64s only when embedded in email payloads (SS0.2/SS5b/SS7).
- `events__address_upsert__basic.json` - [valid] address_upsert after-image of the email_addresses row (SS6).
- `events__binding_upsert__basic.json` - [valid] binding_upsert after-image of the email_sender_bindings row; device_profile_ref opaque, no secrets (SS6).
- `events__counter_snapshot__basic.json` - [valid] counter_snapshot full counters map; periodic after-values, never deltas (SS6).
- `events__domain_mirror_upsert__basic.json` - [valid] domain_mirror_upsert DomainRow after-image with orthogonal mx_state (SS5b/SS6).
- `events__draft_upsert__basic.json` - [valid] draft_upsert after-image of the draft row plus its immutable revision ref (SS6).
- `events__identity_upsert__basic.json` - [valid] identity_upsert after-image of the email_identities row (SS6).
- `events__ingress_receipt__basic.json` - [valid] ingress_receipt row after-image binding receipt_id to message_uid and ingest seq (SS6).
- `events__label_assignment__basic.json` - [valid] label_assignment (message_uid, label_id, present) after-value (SS6).
- `events__label_upsert__basic.json` - [valid] label_upsert after-image of the label row (SS6).
- `events__message_classified__basic.json` - [valid] message_classified run summary after-image (SS6).
- `events__message_ingested__basic.json` - [valid] message_ingested after-image: full email_messages row plus InboundRecipient rows (no delivery fields), object refs and receipt_id (SS6).
- `events__message_ingested__truncated_text.json` - [valid] message_ingested whose normalized plain text exceeded the 32 KiB inline cap: inline_text_truncated true, full text only via object refs (SS5/SS6).
- `events__message_state__basic.json` - [valid] message_state after-image carrying only the changed axes plus revision_seq (SS6).
- `events__purge_finalized__basic.json` - [valid] purge_finalized content-free completion record (SS6).
- `events__purge_intent__basic.json` - [valid] purge_intent purge-job row with frozen object refs recorded before any deletion (SS6).
- `events__purge_state__basic.json` - [valid] purge_state ladder transition coverage_pending -> compacting: every SS6b.4 transition emits one (SS6).
- `events__purge_state__full_ladder.json` - [valid] Happy-path purge ladder: one purge_state event per SS6b.4 transition from intent_recorded through finalized, closed by the canonical purge_finalized kind - there is no purge_completed kind (SS6/SS6b.4).
- `events__push_generation__basic.json` - [valid] push_generation PushGenerationRow after-image: scope_key, string push-generation counter, updated_at_ms (SS0/SS5b/SS6).
- `events__rule_upsert__basic.json` - [valid] rule_upsert after-image of the rule row (SS6).
- `events__send_job_upsert__basic.json` - [valid] send_job_upsert full send-job row after-image; every state transition emits one (SS6).
- `events__send_recipient_state__basic.json` - [valid] send_recipient_state after-value: full OutboundRecipientState with SanitizedResponse - the only SMTP response representation on the wire (SS5b/SS6/SS9.6).
- `events__settings_upsert__basic.json` - [valid] settings_upsert section after-image with its revision (SS6).
- `events__thread_upsert__basic.json` - [valid] thread_upsert with thread row plus projection row after-images (SS6).
- `events__tombstone__basic.json` - [valid] Unified tombstone event carrying entity_kind, entity_id, seq; the sole delete kind - v1 label_delete/rule_delete/draft_discard kinds do not exist (SS6).
- `events__tombstone__send_generation.json` - [valid] Unified tombstone for entity_kind send_generation: emitted when a generation bump retires the old (send_job_id, generation); entity_id is the retired pair (SS6/SS6b.6).
- `events__unknown_kind__fails_closed.json` - [unknown_event_kind] Event with unknown kind future_kind_v9: replay MUST fail closed, never skip-and-continue (SS0/SS6).
- `generation_retired__ack__basic.json` - [valid] Cloud->device email_generation_retired ack: sent once cloud durably settled/tombstoned the generation; the device MAY compact the matching journal tombstone only after receiving it (SS9.4/SS10.1).
- `ingest__claim__bad_body_hash.json` - [body_hash_mismatch] Claim whose body_sha256 does not match the forwarded pointer body (actual body sha256 is 865c0c0b...8741 doubled; claim carries fedcba98... constant) (SS4). kid is hop-namespaced; job_key bound on both hops, storage_client_id bound on hop 2 (SS4.2).
- `ingest__claim__expired.json` - [claim_expired] Claim with exp earlier than iat (exp 1784899870 < iat 1784899900): expired at any verification time even with 30s skew; now~1784900000s (SS4). kid is hop-namespaced; job_key bound on both hops (SS4.2).
- `ingest__claim__replayed_jti.json` - [jti_replayed] Otherwise-valid claim replayed with a jti already present in the hop-local nonce cache (SS4). kid is hop-namespaced; job_key bound on both hops, storage_client_id bound on hop 2 (SS4.2).
- `ingest__claim__valid.json` - [valid] Edge->balancer hop claim: aud balancer-email-dispatch, exp = iat+45 <= iat+60, body hash matches the pointer body; verified at now~1784900010s (SS4). kid is hop-namespaced; job_key bound on both hops (SS4.2).
- `ingest__claim__wrong_aud.json` - [audience_mismatch] Balancer->cloud hop claim presented at /v1/internal/api/email/ingest but carrying aud balancer-email-dispatch instead of cloud-diffforge-email-ingest (SS4). kid is hop-namespaced; job_key bound on both hops, storage_client_id bound on hop 2 (SS4.2).
- `ingest__pointer__basic.json` - [valid] Pointer body forwarded exact-byte edge->balancer->cloud referencing raw and edge-manifest B2 objects (SS4).
- `ingest__response__deletion_fenced.json` - [valid] Ingest response outcome=deletion_fenced: the account deletion fence is active; the edge quarantines the job and no stale queue object may ever revive mail for a fenced account (SS4.4/SS4.5/SS6b.7).
- `ingest__response__duplicate.json` - [valid] Ingest response outcome=duplicate for a redelivered receipt: original ingest's message_uid and seq returned; coverage is current (SS4).
- `ingest__response__hash_conflict.json` - [valid] Ingest response outcome=hash_conflict: same receipt_id with a different raw sha256 - security conflict; the edge moves the job to email-queue-quarantine/, never overwrites (SS3/SS4/SS6b).
- `ingest__response__ingested_covered.json` - [valid] Ingest response outcome=ingested with a non-null coverage tuple (string u64s when embedded): the edge may retire the job marker (SS0/SS4).
- `ingest__response__ingested_uncovered.json` - [valid] Ingest response outcome=ingested with coverage null: ingested but not yet sealed, job marker must NOT be retired (SS4).
- `invalidation__email_mailbox_invalidated__small.json` - [valid] Coalesced web_only invalidation naming a few ids; no subjects, addresses, previews or bodies (SS9).
- `invalidation__email_mailbox_invalidated__truncated.json` - [valid] Invalidation at the 20-id cap with truncated true: clients must fall back to email_changes (SS9).
- `journal__email_command_receipts__row.json` - [valid] email_command_receipts row: command_id PK with payload hash; hash mismatch on redelivery is a security rejection(envelope-free per SS0.1; SS10.1).
- `journal__email_dkim_keys__row.json` - [valid] email_dkim_keys row: public fingerprint plus locator, lifecycle state active|next|retired(envelope-free per SS0.1; SS10.1).
- `journal__email_domain_rate_state__row.json` - [valid] Device email_domain_rate_state row: per-destination-domain pacing and backoff(envelope-free per SS0.1; SS10.1).
- `journal__email_egress_ip_observations__row.json` - [valid] Device email_egress_ip_observations row feeding static-ip stability checks(envelope-free per SS0.1; SS10.1).
- `journal__email_journal_meta__row.json` - [valid] email_journal_meta k/v row: versioned-marker schema state(envelope-free per SS0.1; SS10.1).
- `journal__email_native_preflight_checks__row.json` - [valid] Device email_native_preflight_checks row for a single check outcome(envelope-free per SS0.1; SS10.1).
- `journal__email_native_preflight_runs__row.json` - [valid] Device email_native_preflight_runs row summarizing one preflight execution(envelope-free per SS0.1; SS10.1).
- `journal__email_send_attempts__row.json` - [valid] Device email_send_attempts row recording one SMTP attempt(envelope-free per SS0.1; SS10.1).
- `journal__email_send_events__row.json` - [valid] Device email_send_events row: status_event_id PK, payload hash, outbox handoff and cloud ack(envelope-free per SS0.1; SS10.1).
- `journal__email_send_jobs__row.json` - [valid] Device email_send_jobs row: (job, generation) PK, phase ladder position, lease and fence state, data_started committed before DATA(envelope-free per SS0.1; SS10.1).
- `journal__email_send_recipients__row.json` - [valid] Device email_send_recipients row for one envelope recipient(envelope-free per SS0.1; SS10.1).
- `journal__email_send_tombstones__row.json` - [valid] Device email_send_tombstones row: no time-based deletion, compaction only after cloud generation-retired ack(envelope-free per SS0.1; SS10.1).
- `journal__email_sender_profiles__row.json` - [valid] email_sender_profiles row: secret locators only, never secret material(envelope-free per SS0.1; SS10.1).
- `manifest__lane_entry__base_only.json` - [valid] Lane entry with base only, no segments: covered_seq equals base_seq (SS7).
- `manifest__lane_entry__base_plus_segments.json` - [valid] Lane entry with base 4300 plus contiguous segments 4301-4305 and 4306-4309; covered_seq 4309 (SS7).
- `manifest__lane_entry__gap_fails.json` - [segment_gap] Lane entry with segments [1..5] and [7..9]: seq 6 is missing, composition MUST fail closed (SS7).
- `preflight__result__failed_cgnat.json` - [valid] Preflight result failing public_ip/static_ip/ptr_fcrdns because the egress ip is CGNAT 100.64.0.0/10: result failed (SS10.2).
- `preflight__result__pending_first_observation.json` - [valid] First preflight run: observations incomplete, result pending; no egress ip yet, seed not attempted (SS10.2).
- `preflight__result__qualified.json` - [valid] Preflight result with all 14 checks passing including the seed test: result qualified (SS10.2).
- `prepare__email_send_prepare__credential_required.json` - [valid] email_send_prepare when the bound profile has no usable credentials: structured refusal credential_required; job parks in the credential_required state until a probe succeeds (SS0/SS6b/SS8).
- `prepare__email_send_prepare__leased.json` - [valid] email_send_prepare granting a lease in native mode: lease with memory-only fence_token, mime descriptor, envelope, identity and native DKIM block (SS8).
- `prepare__email_send_prepare__superseded.json` - [valid] email_send_prepare for a generation that was retargeted: structured refusal superseded inside the mutation envelope; no lease or mime (SS0/SS8).
- `purge_floor__reset_marker__basic.json` - [valid] Content of checkpoints/resets/1784900500000-email-purge.json - exactly contract, schema_version, floor_seq, purge_id, purge_epoch, published_at_ms; composition refuses pre-floor events (SS2/SS7.3).
- `queue__commit__basic.json` - [valid] commit.json whose single PUT is the atomic acceptance flip for the receipt's job objects (SS3).
- `queue__edge_manifest__multi_account.json` - [valid] Edge manifest fanned out to two recipient accounts, exercising per_account routing and the optional possible_duplicate_of_receipt_id (SS3).
- `queue__edge_manifest__single.json` - [valid] Edge manifest for a single-recipient-account receipt; evidence only, no SPF/DKIM/DMARC verdicts (SS3).
- `queue__edge_manifest__utf8.json` - [valid] Edge manifest for an SMTPUTF8 session with a UTF-8 internationalized domain, exercising non-ASCII JSON round-trip (SS3).
- `queue__job__basic.json` - [valid] Per-recipient queue job object written by the edge before commit.json flips acceptance (SS3).
- `queue__quarantined__basic.json` - [valid] Quarantined job object under email-queue-quarantine/: original job plus appended quarantined block with reason hash_conflict; operator-resolved, never revived automatically (SS3.2/SS6b.5).
- `queue__retired__basic.json` - [valid] Retired job marker: original job object plus appended ingested block, moved to email-queue-done on coverage (SS3).
- `refusals__slug_registry__closed.json` - [valid] The closed SS0.4 refusal-slug registry, exactly these 11: a refusal is a structured result with a refusal discriminant; unknown slugs fail closed and everything state-shaped is a refusal, never an outer error (SS0.3/SS0.4).
- `requests__email_bootstrap__happy.json` - [valid] email_bootstrap happy path: entitlements, revision, counters, LabelRow/DomainRow/IdentityRow/BindingRow lists, per-section settings revisions, earliest_change_seq (SS8).
- `requests__email_bootstrap__not_entitled.json` - [not_entitled] email_bootstrap for an account without the email entitlement (SS8).
- `requests__email_changes__happy.json` - [valid] email_changes incremental catch-up from since_seq; ChangeEntry carries exactly seq/entity_kind/entity_id/op - the v1 free-form hint is deleted (SS5b/SS8).
- `requests__email_changes__resync_required.json` - [valid] email_changes with since_seq older than the truncated change log: structured refusal resync_required with current_seq and earliest_change_seq; client must snapshot-resync (SS0/SS8).
- `requests__email_classification_correct__happy.json` - [valid] email_classification_correct in create_rule mode returning the minted rule_id (SS8).
- `requests__email_classification_correct__invalid_mode.json` - [invalid_mode] email_classification_correct with unknown mode auto (SS8).
- `requests__email_domain_create__domain_exists.json` - [domain_exists] email_domain_create for a domain already registered on this account (SS8).
- `requests__email_domain_create__happy.json` - [valid] email_domain_create returning the pending DomainRow plus the expected DNS records to publish (SS5b/SS8).
- `requests__email_domain_verify__happy.json` - [valid] email_domain_verify with matching expected_revision: DomainRow flips to verified (SS5b/SS8).
- `requests__email_domain_verify__not_ready.json` - [valid] email_domain_verify while the required verification DNS records are not yet published: structured refusal not_ready with missing_records (SS0/SS8).
- `requests__email_draft_create__happy.json` - [valid] email_draft_create as a reply, returning draft_id and revision_seq 1 (SS8).
- `requests__email_draft_create__identity_not_found.json` - [identity_not_found] email_draft_create referencing an identity_id that does not exist (SS8).
- `requests__email_draft_discard__happy.json` - [valid] email_draft_discard at the current revision_seq; emits the unified tombstone event with entity_kind draft (SS6/SS8).
- `requests__email_draft_discard__revision_conflict.json` - [valid] email_draft_discard with a stale revision_seq: structured refusal revision_conflict carrying current_revision_seq (SS0/SS8).
- `requests__email_draft_get__happy.json` - [valid] email_draft_get returning the draft row (SS8).
- `requests__email_draft_get__not_found.json` - [not_found] email_draft_get for an unknown draft_id (SS8).
- `requests__email_draft_update__conflict_copy.json` - [valid] email_draft_update against a stale base_revision_seq: structured refusal conflict_copy - the edits land in a conflict copy and the conflict-copy write IS the recorded spine bump (SS0/SS8).
- `requests__email_draft_update__happy.json` - [valid] email_draft_update against the current base_revision_seq with inline body under 32 KiB (SS8).
- `requests__email_message_body__happy.json` - [valid] email_message_body plain format small enough to return inline: BodyResult discriminated on source=inline (SS5b/SS8).
- `requests__email_message_body__invalid_format.json` - [invalid_format] email_message_body with unknown format value rich (SS8).
- `requests__email_messages_mutate__happy.json` - [valid] email_messages_mutate applying read plus label_add to one message; SS0 mutation-result envelope with changed ids (SS8).
- `requests__email_messages_mutate__idempotency_conflict.json` - [idempotency_conflict] Same client_request_id replayed with a DIFFERENT operation hash: outer error idempotency_conflict - first-writer-wins, nothing re-executes (SS0.4).
- `requests__email_messages_mutate__revision_conflict.json` - [valid] email_messages_mutate with a stale expected_mailbox_revision: structured refusal revision_conflict; no spine bump occurred (SS0/SS8).
- `requests__email_native_preflight_get__expired.json` - [preflight_expired] email_native_preflight_get for a preflight past its 24h expires_at_ms (SS8/SS10).
- `requests__email_native_preflight_get__happy.json` - [valid] email_native_preflight_get returning the stored full SS10.2 PreflightResult plus stored_revision (SS8/SS10).
- `requests__email_native_preflight_report__expired.json` - [preflight_expired] email_native_preflight_report whose result expires_at_ms is already in the past on arrival (SS8/SS10).
- `requests__email_native_preflight_report__happy.json` - [valid] email_native_preflight_report storing a full SS10.2 result; mutation-envelope response returns stored_revision and the stored result verdict (SS8/SS10).
- `requests__email_purge_request__confirm_required.json` - [confirm_required] email_purge_request without confirm: destructive ops require confirm true (SS8).
- `requests__email_purge_request__happy.json` - [valid] email_purge_request with confirm true (destructive): coverage tuple returned because purge intent is a force-seal consumer (SS7/SS8).
- `requests__email_purge_status__happy.json` - [valid] email_purge_status returning the purge job row mid-deletion (SS8).
- `requests__email_purge_status__not_found.json` - [not_found] email_purge_status for an unknown purge_id (SS8).
- `requests__email_quarantine_release__happy.json` - [valid] email_quarantine_release moving quarantined messages to a destination (SS8).
- `requests__email_quarantine_release__invalid_destination.json` - [invalid_destination] email_quarantine_release with a destination that is not a valid location (SS8).
- `requests__email_rule_upsert__happy.json` - [valid] email_rule_upsert row-shaped with expected_revision (SS8).
- `requests__email_rule_upsert__invalid_predicate.json` - [invalid_predicate] email_rule_upsert whose predicate_json does not parse as a predicate tree (SS8).
- `requests__email_search__happy.json` - [valid] email_search happy path; projection rows annotated with matched_fields (SS8).
- `requests__email_search__invalid_cursor.json` - [invalid_cursor] email_search with a cursor whose HMAC does not verify; cursors are opaque and authenticated (SS0/SS8).
- `requests__email_send_cancel__data_boundary_crossed.json` - [valid] email_send_cancel after DATA started: structured refusal data_boundary_crossed (was a v1 outer error; converted per SS0.4) - the cancel window closed at data_started evidence (SS0/SS6b/SS8).
- `requests__email_send_cancel__happy.json` - [valid] email_send_cancel before data_started: job moves to cancelled (SS8).
- `requests__email_send_lease_renew__fenced.json` - [valid] email_send_lease_renew after a higher lease epoch fenced this holder: structured refusal fenced with current_lease_epoch; the holder must stop before the next SMTP boundary (SS0/SS6b/SS8).
- `requests__email_send_lease_renew__happy.json` - [valid] email_send_lease_renew with the live fence_token: lease extended (SS8).
- `requests__email_send_queue__happy.json` - [valid] email_send_queue with the required human_confirm, minting (send_job_id, generation 1) (SS8).
- `requests__email_send_queue__human_confirm_required.json` - [human_confirm_required] email_send_queue without human_confirm (agent author cannot supply it): REQUIRED confirm missing (SS8).
- `requests__email_send_resume__happy.json` - [valid] email_send_resume after reconnect: journal summaries in, reoffered command payloads and stale generations out (SS8).
- `requests__email_send_resume__unknown_phase.json` - [unknown_phase] email_send_resume reporting an unknown SMTP phase: unknown phases fail closed (SS0/SS8).
- `requests__email_send_retarget__duplicate_ack_required.json` - [duplicate_ack_required] email_send_retarget without duplicate_ack: user must acknowledge possible duplicate delivery (SS8).
- `requests__email_send_retarget__generation_conflict.json` - [valid] email_send_retarget losing the SS6b.6 compare-and-create race: structured refusal generation_conflict with the current (generation, state); nothing re-executes (SS0/SS6b.6/SS8).
- `requests__email_send_retarget__happy.json` - [valid] email_send_retarget to a new binding with duplicate_ack true: generation bumps to 2 (SS8).
- `requests__email_send_retry_unknown__happy.json` - [valid] email_send_retry_unknown on a delivery_unknown job with duplicate_ack: generation bumps (SS8).
- `requests__email_send_retry_unknown__not_delivery_unknown.json` - [valid] email_send_retry_unknown on a job that is not in delivery_unknown state: structured refusal generation_conflict with the current (generation, state) (SS0/SS6b/SS8).
- `requests__email_sender_binding_upsert__happy.json` - [valid] email_sender_binding_upsert row-shaped with expected_revision (SS8).
- `requests__email_sender_binding_upsert__revision_conflict.json` - [valid] email_sender_binding_upsert with a stale expected_revision: structured refusal revision_conflict carrying the current revision (SS0/SS8).
- `requests__email_sender_capabilities_sync__happy.json` - [valid] email_sender_capabilities_sync from a healthy daemon runtime; response returns accepted revision and bindings (SS8).
- `requests__email_sender_capabilities_sync__version_too_old.json` - [capability_version_too_old] email_sender_capabilities_sync with capability_version below min_required_version (SS8).
- `requests__email_settings_get__happy.json` - [valid] email_settings_get for named sections returning typed SettingsSectionRow entries (SS5b/SS8).
- `requests__email_settings_get__unknown_section.json` - [unknown_settings_section] email_settings_get naming a settings section that does not exist (SS8).
- `requests__email_thread_get__happy.json` - [valid] email_thread_get happy path returning thread plus message projections; inline_text present because a <=32 KiB plain derivation exists (SS8).
- `requests__email_thread_get__not_found.json` - [not_found] email_thread_get for a thread_id that does not exist in this mailbox (SS8).
- `requests__email_threads_list__happy.json` - [valid] email_threads_list happy path over the location axis with a full thread_projection row (SS8).
- `requests__email_threads_list__limit_exceeded.json` - [limit_exceeded] email_threads_list with limit 500 above the contract cap of 100 (SS8).
- `requests__email_transfer_download_prepare__happy.json` - [valid] email_transfer_download_prepare (non-mutation) for a message attachment via DownloadRef ref_kind=message_part, returning a one-use TransferDescriptor (SS5b/SS8).
- `requests__email_transfer_download_prepare__part_id_required.json` - [part_id_required] email_transfer_download_prepare for part attachment without the required part_id (SS8).
- `requests__email_transfer_upload_complete__happy.json` - [valid] email_transfer_upload_complete with observed hash and size matching the prepared transfer (SS8).
- `requests__email_transfer_upload_complete__sha256_mismatch.json` - [sha256_mismatch] email_transfer_upload_complete whose observed_sha256 differs from the declared sha256 (SS8).
- `requests__email_transfer_upload_prepare__happy.json` - [valid] email_transfer_upload_prepare for a draft attachment returning the one-use PUT target (SS8).
- `requests__email_transfer_upload_prepare__max_size_bytes_exceeded.json` - [max_size_bytes_exceeded] email_transfer_upload_prepare declaring a size above the transfer max_bytes cap (SS8).
- `send_event__email_send_event__data_started.json` - [valid] Phase data_started (phase_rank 8): the cancel window is now closed and loss after this point settles as delivery_unknown; data_started journaled before DATA (SS6b.2/SS9.2). Paired ack (SS9.3).
- `send_event__email_send_event__delivery_unknown.json` - [valid] Terminal delivery_unknown settlement: connection lost at/after DATA with no server response; error_class delivery_unknown, never auto-retried (SS6b/SS9/SS10). Paired ack applied (SS9.3).
- `send_event__email_send_event__prepared.json` - [valid] Phase prepared (phase_rank 2): adds mode, lease_id, lease_epoch; mime and data_started fields still absent (SS9.2). Paired ack (SS9.3).
- `send_event__email_send_event__progress.json` - [valid] Non-terminal ticker event at phase connecting (phase_rank 6), before DATA; fields below the phase are absent, no terminal bool - terminal is derived (SS9.2). Paired with its applied ack (SS9.3).
- `send_event__email_send_event__received.json` - [valid] Phase received (phase_rank 1): common fields ONLY - ids exist, no mode/lease/mime yet; per-phase fields are absent below their phase (SS9.2). Paired ack (SS9.3).
- `send_event__email_send_event__stale_generation.json` - [valid] Event for generation 1 arriving while the job's current generation is 2: SUCCESS ack with applied false, audit stale_generation - recorded audit-only, never an error; the device may mark the event cloud-acked (SS9.3).
- `send_event__email_send_event__terminal.json` - [valid] Terminal settlement at phase settled (phase_rank 10) with per-recipient OutboundRecipientState and job-level SanitizedResponse; terminal is derived from phase - no terminal bool, no free provider text (SS9.2/SS9.6). Paired ack applied (SS9.3).
- `u64__string__number_rejected.json` - [u64_number_encoding] u64 spot check rejection: email_mutation_seq above 2^53 encoded as a JSON number instead of a decimal string - parsers MUST refuse; the SS0.2 list is string-only on the wire (SS0.2).
- `u64__string__valid.json` - [valid] u64-as-string spot check: every SS0.2-listed counter serializes as a decimal string (no sign, no leading zeros); bounded u32s, size_bytes and *_at_ms stay JSON numbers (SS0.2).
- `wake_command__email_credential_probe__exact.json` - [valid] Companion command email_credential_probe: own minimal payload - profile_ref and target device only, non-destructive (SS9.4).
- `wake_command__email_preflight_run__exact.json` - [valid] Companion command email_preflight_run: own minimal payload with optional requested_checks, non-destructive (SS9.4).
- `wake_command__email_send__exact.json` - [valid] Wake command payload, exactly these fields and nothing else: no recipients, hashes, keys or tokens (SS9).

## Consciously skipped twin shapes (SS8 settings CRUD batching)

Per SS11 review guidance, trivially-identical request kinds are represented by a covered
pair instead of their own fixtures:

- `email_domain_dns_check` - read-back twin of email_domain_verify (same row shape, non-mutating check)
- `email_domain_update` - row-shaped upsert twin of email_domain_create + expected_revision (see email_sender_binding_upsert pair)
- `email_domain_delete` - destructive delete twin; confirm/expected_revision pattern covered by email_purge_request + revision_conflict pairs; emits the unified `tombstone` kind
- `email_address_upsert` - row-shaped upsert twin; row shape covered by events__address_upsert__basic
- `email_address_delete` - delete twin of the upsert pattern (tombstone entity_kind address)
- `email_identity_upsert` - row-shaped upsert twin; row shape covered by events__identity_upsert__basic
- `email_identity_delete` - delete twin of the upsert pattern (tombstone entity_kind identity)
- `email_sender_binding_delete` - delete twin of email_sender_binding_upsert (tombstone entity_kind binding)
- `email_sender_test` - row-shaped trigger; success/failure envelope identical to the covered CRUD pairs
- `email_label_upsert` - row-shaped upsert twin; row shape covered by events__label_upsert__basic and email_bootstrap
- `email_label_delete` - delete twin of the upsert pattern (tombstone entity_kind label; the v1 label_delete EVENT kind no longer exists)
- `email_rule_delete` - delete twin of email_rule_upsert (tombstone entity_kind rule; the v1 rule_delete EVENT kind no longer exists)
- `email_rule_reorder` - priority-only variant of email_rule_upsert
- `email_classification_settings_update` / `email_retention_settings_update` - settings-section upsert twins; SettingsSectionRow covered by email_settings_get + events__settings_upsert__basic
- `email_send_prepare (requests area)` - request/response fully covered by the three prepare__email_send_prepare__* fixtures
- `email_native_preflight_start` - trigger with plain ack `{started: true}` (SS8); result path covered by email_native_preflight_report and preflight__result__*
