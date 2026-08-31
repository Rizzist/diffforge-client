import assert from "node:assert/strict";
import test from "node:test";

import {
  closeOutcomeView,
  execReceiptView,
  outputBufferView,
  shellRowView,
  shellUnavailableFromError,
} from "./shellModel.js";

test("[pin] unknown kind, scope, and state stay raw and visibly unrecognized", () => {
  const row = shellRowView({
    id: "shell-future",
    kind: { kind: "container" },
    scope: { kind: "orbital" },
    state: { state: "hibernating" },
    cwd: "/published/work",
    cwd_or_host: "published-host",
    title: "Published shell",
  });

  assert.deepEqual(row.kind, {
    kind: "unknown",
    raw: "container",
    label: "container",
    recognized: false,
  });
  assert.equal(row.scope.raw, "orbital");
  assert.equal(row.scope.recognized, false);
  assert.equal(row.state.raw, "hibernating");
  assert.equal(row.state.recognized, false);
  assert.equal(row.cwd, "/published/work");
  assert.equal(row.cwdOrHost, "published-host");
  assert.equal(row.title, "Published shell");

  const absentScope = shellRowView({
    id: "shell-no-scope",
    kind: { kind: "local" },
    status: { status: "running" },
  });
  assert.equal(absentScope.kind.raw, "local");
  assert.equal(absentScope.kind.recognized, true);
  assert.deepEqual(absentScope.scope, {
    kind: "absent",
    raw: null,
    label: "not published",
    recognized: false,
  }, "absent scope must never be inferred as local from the shell kind");
});

test("[pin] absent run_id is typed absence and never fabricated from coordinates", () => {
  const absent = execReceiptView({
    session_id: "session-7",
    item_id: "item-91",
    accepted_seq: "18446744073709551614",
    worker_generation: 12,
  });
  assert.equal(absent.runId, null);
  assert.equal(absent.runIdPublished, false);
  assert.equal(absent.runIdLabel, "no run id published");
  assert.equal(absent.acceptedSeq, "18446744073709551614");
  assert.notEqual(absent.runId, absent.itemId);

  const present = execReceiptView({
    session_id: "session-7",
    run_id: "run-daemon-4",
    item_id: "item-92",
    accepted_seq: "42",
  });
  assert.equal(present.runId, "run-daemon-4");
  assert.equal(present.runIdPublished, true);
});

test("[pin] an already-closed shell_close receipt is a normal closed outcome", () => {
  const outcome = closeOutcomeView({
    already_closed: true,
    shell: {
      id: "shell-closed",
      kind: { kind: "ssh", profile: "build-host" },
      scope: "ssh",
      status: { status: "closed", code: 0 },
      cwd: "/srv/build",
    },
  });

  assert.equal(outcome.normal, true);
  assert.equal(outcome.kind, "closed");
  assert.equal(outcome.alreadyClosed, true);
  assert.equal(outcome.shell.state.raw, "closed");
  assert.equal(outcome.shell.profile, "build-host");

  const closedRow = closeOutcomeView({
    shell: { id: "shell-closed-row", kind: "local", status: "closed" },
  });
  assert.equal(closedRow.normal, true);
  assert.equal(closedRow.kind, "closed");
  assert.equal(closedRow.alreadyClosed, false);
});

test("[pin] output buffer begins at subscription and never claims replay or history", () => {
  const view = outputBufferView([
    { id: "shell-1", stream: "stdout", chunk_b64: "aGVsbG8=" },
  ]);

  assert.equal(view.delivery, "connection_transient");
  assert.equal(view.replayable, false);
  assert.equal(view.complete, false);
  assert.equal(view.startsAt, "subscription_start");
  assert.equal(view.priorOutputCaptured, false);
  assert.match(view.notice, /Buffered output starts when this subscription began/);
  assert.match(view.notice, /output before this point was not captured/);
  assert.equal(view.entries[0].text, "hello");
  assert.equal(view.entries[0].stream.raw, "stdout");
});

test("shellUnavailableFromError reuses the shared feature-gate detector", () => {
  assert.equal(shellUnavailableFromError({ code: "missing_feature" }), true);
  assert.equal(shellUnavailableFromError(
    new Error("missing_feature: daemon does not advertise shell_registry_v1"),
  ), true);
  assert.equal(shellUnavailableFromError("does not advertise shell.exec"), true);
  assert.equal(shellUnavailableFromError(new Error("connection reset")), false);
});
