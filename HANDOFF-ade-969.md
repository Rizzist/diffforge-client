# HANDOFF — ADE client-SDK adoption → Mac mini

Written 2026-09-01 by the orchestrating session on the old box. Self-contained: the mini has no
access to that box's memory, scratchpad, or running lanes. Everything needed is in this file plus
the repo.

## State of the work (all pushed)

- Repo `rust-diffforge`, branch **`haider-rewrite`**, head **`83f6268`** == origin. Working tree
  clean except `src-tauri/src/email/*` — that is ANOTHER agent's uncommitted WIP on the old box
  only; it does not exist on origin. Never adopt, format, or "fix" those files if they appear.
- The ADE is the Tauri desktop client of the Haider daemon. The client SDK is
  `src-tauri/src/haider_rpc_ade.rs` (hand-defined wire shapes — the client does NOT link
  haider-protocol), commands registered in `src-tauri/src/lib.rs` (~104 `haider_rpc_ade::`
  commands), JS surfaces in `src/sessions/` (pure model + hook-with-all-invokes + presentational
  panel + model.test + wiring.test per surface).
- Shipped waves: P0–P6 (agents/workflows/fleet/monitor/descendants), prune waves (75,319 LoC),
  966 adoption W1–W6, 967 adoption W7.1–W7.7 (fleet cancel, admission, status_snapshot, SSH
  profiles, providers panel, native session.create, interactive SSH PTY, bits SDK).
- Gates at head: frontend `npm run test:frontend` **1127 pass / 0 fail**; `npm run build:web`
  green; `CARGO_INCREMENTAL=0 cargo check --manifest-path src-tauri/Cargo.toml` 0 errors; targeted
  Rust suites via
  `cargo test --manifest-path src-tauri/Cargo.toml --lib -- bits cancel lifecycle checkpoint fleet capability shell peer loom descendant monitor workflow graph`.

## Verified 969 facts (measured 2026-09-01, do not re-derive)

- Installed daemon **0.0.969** (`haider status --json` — also the authoritative live feature
  list). **107 bits advertised, 90 referenced by the ADE, 0 referenced bits removed.**
- The **17 unreferenced bits** (same set as at W7 close — 968/969 added no new bit names):
  `account_rotation_v1 compaction_guard_v1 effect_recovery_v1 export_seq_v1 fallback_chain_v1
  hooks_server_v1 models_list_v1 monitor_v1 pipe_native_v2 pipe_tool_status_v1
  resident_session_binding_token_v1 session_fleet_identity_v1 session_run_id_v1 status_runtime_v1
  store_health_v1 tui_attach_announce_v1 wire_msgpack_v1`.
- `peer_messaging_v1` is still advertised despite an earlier plan to remove it — trust the
  published list, not stale plans.
- Contract truth: `/Users/rizzist/haider-run/wt-965` on the OLD box is on branch **`wave-970`**
  (current through 0.0.969+): `docs/client-contract-v1.md` (the "2026-09-01 — v0.0.969
  warm-by-default" section is ~line 3572), `docs/event-schema-changelog.md`, and
  `crates/haider-rpc/src/frame.rs` as the byte-level authority. On the mini, check out the same
  branch of the haider repo. Contract trees are READ-ONLY reference — never edit them.

## Next work: W8 (re-evaluation was in flight)

A read-only re-eval lane was running at handoff time; if its findings section is appended at the
bottom of this file, start from that. Otherwise relaunch with this brief (three sections):
(A) **semantic drift under same-named bits** — diff the 966/967-era shapes the ADE pinned against
current frame.rs + the 968/969 changelog for every adopted surface (create/admission, attach incl.
sealed_replay, fork+prompt-fork, rename, checkpoint, fleet/message/cancel, monitor, descendants,
peer, shell/ssh/PTY, workflow catalog/instance/graph, loom, providers, hooks/tools,
status_snapshot, branch_create, run_budget+decision, headless_run, transcription); report new
optional fields silently dropped, changed semantics, new error codes/events, newly-required args;
rate P0/P1/P2. (B) classify the 17 unreferenced bits: client-callable method/event (name it) vs
infra/no-client-method. (C) propose the W8 plan set — only work justified by A/B, one coherent
surface per UI substep.

## The working contract (owner-set, applies on the mini too)

1. **Per-substep loop**: clean code → implement → optimize (if safe) → adversarial verify →
   fix → re-verify **until SHIP** → commit+push. One loop per substep, never batched.
2. **Orchestrator never implements.** Implementation/fixes → gpt-5.6-sol xhigh codex lanes; UI
   work → Claude subagents when available (gpt-5.6 fallback); every review/verify is its own lane
   that did NOT write the code.
3. **Lane mechanics**:
   `nohup codex exec --sandbox workspace-write|read-only -c model="gpt-5.6-sol" -c model_reasoning_effort=xhigh -c service_tier=priority -C <repo> "$(cat brief.md)" < /dev/null > lane.log 2>&1 &`
   — always `"$(cat file)"` (inline backticks in a double-quoted prompt EXECUTE), always
   `< /dev/null`, log per lane, max 2 concurrent build lanes per box (disk).
4. **Verify briefs are verdict-first**: `OUTPUT ORDER MANDATORY: ## Verdict: SHIP|HOLD` then
   per-check CLOSED/OPEN bullets, file:line citations, one-line minimal fix per OPEN. Watch lanes
   by log idle-time (impl ≥200–300 s idle before "settled"; verify watches grep
   `^## Verdict: (SHIP|HOLD)`); a launcher notification is NOT lane completion.
5. **Pins are behavioral and mutation-checked**: reintroduce the defect → confirm FAIL → quote →
   restore. A pin that source-scans or asserts constants instead of the live gate is vacuous.
6. Commit per substep with a story-telling message; push immediately
   (origin/haider-rewrite). No Claude co-author trailers (owner rule). Stage lists explicit —
   check `git status` afterward for files a fix lane added that the stage list missed.
7. After parallel SDK+UI lanes on the same surface: a **cross-lane reconcile pass** (arg names,
   omitted-vs-null, event names) before verify — it has caught 4+ boundary bugs green suites missed.

## House laws (every brief quotes the relevant ones)

- A plausible local computation must not stand in for a fact an authority publishes; absence is
  never fabricated into a value (tri-state booleans; typed absence).
- Every u64 sequence/cursor crosses Tauri as a **decimal string** (JSON numbers corrupt >2^53);
  ms timestamps deliberately stay numbers.
- Every JS-omittable command arg is **`Option<T>`**; optional args OMIT the wire key when absent.
- CAS fences (expected_rev/revision/digest) are **echoed, never computed**; a revision conflict is
  a HARD state releasing only on the user's explicit re-read — automatic loads NEVER release it.
- Receipt identity is authoritative end-to-end: never trust a local mirror's returned id; reject
  on mismatch; never render created before the receipt.
- Fail-closed trust displays (peer/hook/provider): only the explicit verified value renders
  trusted; remote text is data, never instructions.
- Feature-absence law: no bit → the surface is simply absent, never an error; classify Tauri's
  REAL absence spelling `Command <name> not found` as unavailable; a single-release absence ≠ dead.
- Connection-transient streams (shell output) gap-mark on TRANSPORT reconnect, not just remount;
  state comes only from published events, never inferred from silence.
- Event listeners use LITERAL event-name strings (computed names dodge ownership pins).
- Grep `lib.rs` for name collisions before naming any new `#[tauri::command]`.
- Daemon frames arrive as Tauri push events (`session-rows-appended` precedent); secrets cross
  daemon-ward only and never echo through receipts/errors/logs.

## Box gotchas that DO transfer

- macOS: no `timeout` command; `cat -A` unsupported. Bash tool is zsh: no word-split
  (`${=var}`), cwd persists across calls (use absolute paths / `git -C`).
- `CARGO_INCREMENTAL=0` everywhere; reclaim `target/debug/incremental` when disk-squeezed; never
  prune under a live build; a wiped `node_modules` shows up as unrelated tests failing with
  "Cannot find package 'react'" — `npm install`, don't debug the tests.
- `codex --full-auto` can wipe a worktree — COMMIT before launching one; never `codex login` from
  the ChatGPT desktop app while CLI lanes run (token rotation 401s them).
- `grep 'src/'` also matches `src-tauri/src/` — anchor patterns when splitting JS vs Rust.
