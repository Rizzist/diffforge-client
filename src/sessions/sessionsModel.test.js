import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSessionRow } from "./sessionsModel.js";

/* normalizeSessionRow builds a FRESH row object, so any harness field it does
   not name is silently discarded — no error, nothing to notice. That defect
   shipped invisibly once: 935's roster scalars, 936's attention state and
   937's park card were all arriving correctly from the daemon and being
   dropped one layer above the bridge, so features that were green in Rust and
   correct in their components simply never appeared.

   Decoding a field is not the same as KEEPING it. These assertions exist to
   fail when a field stops surviving the trip to the surfaces that render it —
   the only kind of test that catches this class of bug. */

const DAEMON_ROW = {
  id: "1787319159127-fa66eaf2",
  title: "what? deepseek v4 flash has vision now?!?",
  slug: "what-deepseek-v4-flash",
  dir: "/Users/x/Documents/DiffForge/2026-08-21/what-deepseek",
  kind: "generated",
  provider: "haider",
  provider_session_id: "session-29388562c512cd0c",
  created_at_ms: 1787319159127,
  latest_at_ms: 1787319179764,
  status: "waiting",
  state_raw: "waiting",
  first_user_message: "what?",
  model: "deepseek-v4-flash",
  pinned: false,
  title_locked: false,
  // 935 roster scalars
  effort: "high",
  speed: "fast",
  // 936 attention state
  seen_at_ms: 1787329015454,
  last_activity_ms: 1787319179764,
  waiting_kind: "permission",
  waiting_menu_id: "menu-77",
  // 937 park card
  needs_input: {
    kind: "recovery",
    title: "Effect outcome unknown",
    safe_body: ["probe: no result committed"],
    menu_id: "effect-recovery-8145",
    request_seq: 1843,
    worker_generation: 122,
    options: [{ key: "probe", label: "Probe" }],
  },
};

test("normalizeSessionRow keeps every harness field the UI renders", () => {
  const row = normalizeSessionRow(DAEMON_ROW);

  assert.equal(row.effort, "high");
  assert.equal(row.speed, "fast");
  assert.equal(row.seen_at_ms, 1787329015454);
  assert.equal(row.last_activity_ms, 1787319179764);
  assert.equal(row.waiting_kind, "permission");
  assert.equal(row.waiting_menu_id, "menu-77");
});

test("normalizeSessionRow passes the park card through verbatim", () => {
  const row = normalizeSessionRow(DAEMON_ROW);

  // Reshaping it here would break kinds and fields the daemon adds later.
  assert.deepEqual(row.needs_input, DAEMON_ROW.needs_input);
  assert.equal(row.needs_input.request_seq, 1843);
  assert.equal(row.needs_input.options[0].key, "probe");
});

test("absent harness fields normalize to null, never to a fabricated default", () => {
  // A daemon that omits these said nothing about them — which is NOT the same
  // as zero, "" or false, and a surface must be able to tell those apart.
  const row = normalizeSessionRow({
    id: "local-1",
    title: "Bare row",
    created_at_ms: 1,
    latest_at_ms: 1,
  });

  assert.equal(row.effort, null);
  assert.equal(row.speed, null);
  assert.equal(row.seen_at_ms, null);
  assert.equal(row.last_activity_ms, null);
  assert.equal(row.waiting_kind, null);
  assert.equal(row.waiting_menu_id, null);
  assert.equal(row.needs_input, null);
});
