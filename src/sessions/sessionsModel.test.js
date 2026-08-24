import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveSessionPaneId,
  rehomeSessionPane,
  rehomeSessionViewMode,
  sessionPaneId,
} from "./sessionPaneOwnership.js";
import {
  normalizeSessionRow,
  groupSessionsByDay,
  formatSessionRelativeTime,
  partitionSessionsForRail,
  sessionWorkingDirectory,
  sessionModelProviderFallback,
} from "./sessionsModel.js";

/* normalizeSessionRow USED TO build a FRESH row object, so any harness field
   it did not name was silently discarded — no error, nothing to notice. That
   defect shipped invisibly once: 935's roster scalars, 936's attention state
   and 937's park card were all arriving correctly from the daemon and being
   dropped one layer above the bridge, so features that were green in Rust and
   correct in their components simply never appeared.

   It now spreads the incoming row, so the whole class is gone rather than
   patched — see the unknown-field test at the bottom of this file, which is
   the one that fails if anyone rebuilds the mirror.

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
  // committed run coordinates
  run_id: "run-ee1a29d3",
  worker_generation: 97,
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
  assert.equal(row.run_id, "run-ee1a29d3");
  assert.equal(row.worker_generation, 97);
});

test("normalizeSessionRow passes the park card through verbatim", () => {
  const row = normalizeSessionRow(DAEMON_ROW);

  // Reshaping it here would break kinds and fields the daemon adds later.
  assert.deepEqual(row.needs_input, DAEMON_ROW.needs_input);
  assert.equal(row.needs_input.request_seq, 1843);
  assert.equal(row.needs_input.options[0].key, "probe");
});

test("absent harness fields stay absent, never a fabricated default", () => {
  // A daemon that omits these said nothing about them — which is NOT the same
  // as zero, "" or false, and a surface must be able to tell those apart.
  // Which nullish spelling arrives is deliberately not asserted: the normalizer
  // no longer enumerates these fields, and pinning null here would mean listing
  // all nine again — the exact mirror this refactor deleted. Rust's serializer
  // does emit an explicit null for each; what matters at this boundary is only
  // that nothing invents a value the daemon never sent.
  const row = normalizeSessionRow({
    id: "local-1",
    title: "Bare row",
    created_at_ms: 1,
    latest_at_ms: 1,
  });

  for (const field of [
    "effort",
    "speed",
    "seen_at_ms",
    "last_activity_ms",
    "waiting_kind",
    "waiting_menu_id",
    "run_id",
    "worker_generation",
    "needs_input",
  ]) {
    assert.ok(
      row[field] === null || row[field] === undefined,
      `${field} was fabricated as ${JSON.stringify(row[field])}`,
    );
  }
});

test("a null session provider stays unknown instead of becoming haider", () => {
  const row = normalizeSessionRow({
    id: "provider-unknown",
    provider: null,
  });

  assert.equal(row.provider, null);
  assert.notEqual(row.provider, "haider");
});

test("the model-provider fallback rejects only the bootstrap sentinel", () => {
  assert.equal(sessionModelProviderFallback("haider"), "");
  assert.equal(sessionModelProviderFallback("haider-code"), "haider-code");
  assert.equal(sessionModelProviderFallback(null), "");
});

test("daemon recency preserves measured zero and keeps absence unknown", () => {
  const measured = normalizeSessionRow({
    id: "measured-zero",
    provider_session_id: "session-1",
    created_at_ms: 99,
    latest_at_ms: 0,
  });
  const absent = normalizeSessionRow({
    id: "absent",
    provider_session_id: "session-2",
    created_at_ms: 99,
  });

  assert.equal(measured.latest_at_ms, 0);
  assert.notEqual(formatSessionRelativeTime(0, 1_000), "");
  assert.equal(absent.latest_at_ms, null);
  assert.equal(groupSessionsByDay([absent], 3 * 24 * 60 * 60 * 1000)[0].label, "Unknown");
  assert.equal(
    groupSessionsByDay([{ created_at_ms: 99 }], 3 * 24 * 60 * 60 * 1000)[0].label,
    "Unknown",
  );
});

test("the rail separates unordered and local sessions from activity-ranked sessions", () => {
  const groups = partitionSessionsForRail([
    { id: "ranked-old", provider_session_id: "provider-old", latest_at_ms: 100 },
    { id: "unordered-first", provider_session_id: "provider-a", created_at_ms: 1, latest_at_ms: null },
    { id: "local-old", provider_session_id: "", latest_at_ms: 200 },
    { id: "ranked-new", provider_session_id: "provider-new", latest_at_ms: 300 },
    { id: "unordered-second", provider_session_id: "provider-b", created_at_ms: 999, latest_at_ms: null },
    { id: "local-new", provider_session_id: "", latest_at_ms: 400 },
  ]);

  assert.deepEqual(groups.ranked.map(({ id }) => id), ["ranked-new", "ranked-old"]);
  assert.deepEqual(groups.local.map(({ id }) => id), ["local-new", "local-old"]);
  assert.deepEqual(
    groups.unordered.map(({ id }) => id),
    ["unordered-first", "unordered-second"],
  );
});

test("bound sessions use only the published workspace cwd", () => {
  assert.equal(sessionWorkingDirectory({
    provider_session_id: "session-imported",
    workspace_cwd: "/published/workspace",
    dir: "/client/import/default",
    kind: "pinned",
  }), "/published/workspace");
  assert.equal(sessionWorkingDirectory({
    provider_session_id: "session-legacy",
    dir: "/client/import/default",
    kind: "pinned",
  }), "");
  assert.equal(sessionWorkingDirectory({
    provider_session_id: "session-typed-metadata",
    metadata: { cwd: "/typed/metadata/workspace" },
    dir: "/client/import/default",
    kind: "pinned",
  }), "/typed/metadata/workspace");
});

test("session pane rehome swaps identities instead of aliasing one pane", () => {
  const panes = rehomeSessionPane({}, {
    paneId: sessionPaneId("session-a"),
    hostSessionId: "session-a",
    targetSessionId: "session-b",
  });

  assert.equal(effectiveSessionPaneId(panes, "session-a"), sessionPaneId("session-b"));
  assert.equal(effectiveSessionPaneId(panes, "session-b"), sessionPaneId("session-a"));
  assert.equal(new Set([
    effectiveSessionPaneId(panes, "session-a"),
    effectiveSessionPaneId(panes, "session-b"),
  ]).size, 2);
});

test("chained pane rehomes stay bijective and reject stale announcements", () => {
  const first = rehomeSessionPane({}, {
    paneId: sessionPaneId("session-a"),
    hostSessionId: "session-a",
    targetSessionId: "session-b",
  });
  const second = rehomeSessionPane(first, {
    paneId: effectiveSessionPaneId(first, "session-b"),
    hostSessionId: "session-b",
    targetSessionId: "session-c",
  });
  const effective = ["session-a", "session-b", "session-c"]
    .map((sessionId) => effectiveSessionPaneId(second, sessionId));

  assert.equal(new Set(effective).size, effective.length);
  assert.strictEqual(rehomeSessionPane(second, {
    paneId: sessionPaneId("session-a"),
    hostSessionId: "session-b",
    targetSessionId: "session-a",
  }), second);
});

test("draft materialization lands on the surface that started the session", () => {
  const chat = rehomeSessionViewMode({ "session-new": "terminal" }, {
    hostSessionId: "draft",
    targetSessionId: "session-new",
  });
  const shell = rehomeSessionViewMode({ draft: "terminal" }, {
    hostSessionId: "draft",
    targetSessionId: "session-new",
  });

  assert.equal(chat["session-new"], "ui");
  assert.equal(shell["session-new"], "terminal");
});

test("an in-TUI session hop keeps the live Shell visible", () => {
  const modes = rehomeSessionViewMode({
    "session-a": "terminal",
    "session-b": "ui",
  }, {
    hostSessionId: "session-a",
    targetSessionId: "session-b",
  });

  assert.equal(modes["session-b"], "terminal");
});

/* The regression that proves the mirror is gone rather than merely up to date.
   This field is not mentioned anywhere in the ADE — it stands in for whatever
   the daemon adds next. If someone reintroduces field-by-field copying, every
   other test in this file still passes and only this one fails. */
test("normalizeSessionRow carries a field the ADE has never heard of", () => {
  const row = normalizeSessionRow({
    id: "unknown-field",
    daemon_field_added_after_ade_had_shipped: { nested: ["shape", 7] },
  });
  assert.deepEqual(row.daemon_field_added_after_ade_had_shipped, {
    nested: ["shape", 7],
  });
});
