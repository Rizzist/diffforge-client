import assert from "node:assert/strict";
import test from "node:test";

import {
  createPtyCaptureState,
  inputArgs,
  openArgs,
  outputChunkView,
  ptyStateView,
  reducePtyCaptureState,
  resizeArgs,
  SSH_PTY_TRANSIENT_MARKER,
} from "./sshPtyModel.js";

function decodeInput(args) {
  const binary = atob(args.data_b64);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

test("[pin 1] output is byte-verbatim and explicitly connection-transient", () => {
  const view = outputChunkView({
    id: "shell-pty",
    stream: "future_combined",
    chunk_b64: "AP+AQQ0K",
  });

  assert.deepEqual([...view.bytes], [0, 255, 128, 65, 13, 10]);
  assert.equal(view.shellId, "shell-pty");
  assert.deepEqual(view.stream, {
    raw: "future_combined",
    recognized: false,
    label: "future_combined",
  });
  assert.equal(view.delivery, "connection_transient");
  assert.equal(view.replayable, false);
  assert.equal(view.complete, false);
  assert.equal(view.priorOutputCaptured, false);
  assert.equal(Object.hasOwn(view, "cursor"), false);
  assert.equal(outputChunkView({ id: "shell-pty", chunk_b64: "not base64!" }).bytes, null,
    "malformed delivery must not grow fabricated replacement bytes");
});

test("[pin finding 1] a published reconnect resets prior PTY output before the next chunk", () => {
  let capture = reducePtyCaptureState(createPtyCaptureState(), {
    type: "listener-boundary",
  });
  capture = reducePtyCaptureState(capture, {
    type: "transport-published",
    payload: {
      state: "reachable",
      profile_id: "profile-a",
      daemon_generation: 7,
    },
  });
  const prior = outputChunkView({ id: "shell-pty", stream: "stdout", chunk_b64: "b2xk" });
  capture = reducePtyCaptureState(capture, { type: "output", chunk: prior });
  assert.deepEqual(capture.outputByShell["shell-pty"].entries, [prior]);
  assert.equal(capture.subscriptionId, 1);

  capture = reducePtyCaptureState(capture, {
    type: "transport-published",
    payload: { state: "pending", reason: "fresh connection" },
  });
  assert.deepEqual(capture.outputByShell, {},
    "the published reconnect signal must reset the old connection before more output");
  assert.equal(capture.subscriptionId, 2,
    "the terminal must receive a new marker boundary at reconnect");

  const after = outputChunkView({ id: "shell-pty", stream: "stdout", chunk_b64: "bmV3" });
  capture = reducePtyCaptureState(capture, { type: "output", chunk: after });
  assert.deepEqual(capture.outputByShell["shell-pty"].entries, [after],
    "post-reconnect bytes must never be appended behind prior-connection bytes");
  assert.equal(capture.outputByShell["shell-pty"].marker, SSH_PTY_TRANSIENT_MARKER);
  assert.equal(capture.outputByShell["shell-pty"].subscriptionId, 2);
});

test("[pin 2] state is accepted only from published state/closed events", () => {
  const receipt = {
    id: "shell-pty",
    status: { status: "running" },
  };
  assert.deepEqual(ptyStateView(receipt).state, {
    kind: "absent",
    raw: null,
    label: "not published",
    recognized: false,
  }, "a successful open receipt is not published lifecycle state");

  const running = ptyStateView({ shell: receipt }, "shell-state");
  assert.equal(running.published, true);
  assert.equal(running.state.raw, "running");
  assert.equal(running.state.recognized, true);
  assert.equal(running.closed, false);

  const future = ptyStateView({
    shell: { ...receipt, status: { status: "future_suspended" } },
  }, "shell-state");
  assert.equal(future.state.raw, "future_suspended");
  assert.equal(future.state.recognized, false);
  assert.equal(future.label, "future_suspended (unrecognized)");

  const closed = ptyStateView({ shell: receipt }, "shell-closed");
  assert.equal(closed.closed, true,
    "a shell-closed publication closes honestly without rewriting its raw state");
  assert.equal(closed.state.raw, "running");
});

test("[pin 3] open and resize carry the measured grid verbatim without defaults", () => {
  const measured = { cols: 137, rows: 41 };
  assert.deepEqual(openArgs({
    name: "production",
    host: "ignored.invalid",
    auth: { kind: "ignored" },
  }, "xterm-256color", measured), {
    name: "production",
    term: "xterm-256color",
    size: measured,
  });
  assert.deepEqual(resizeArgs("shell-pty", measured), {
    id: "shell-pty",
    size: measured,
  });
  assert.throws(() => resizeArgs("shell-pty", {}), /measured positive integer/);
  assert.throws(() => openArgs("production", "xterm-256color", { cols: 80 }),
    /measured positive integer/);
});

test("[pin 4] xterm input survives the wire envelope without editing or echo text", () => {
  const emitted = "\u001b[1;5A\r\n λ \u0000 ";
  const args = inputArgs("shell-pty", emitted);
  assert.deepEqual(Object.keys(args).sort(), ["data_b64", "id"]);
  assert.equal(decodeInput(args), emitted);
  assert.equal(decodeInput(inputArgs("shell-pty", "")), "",
    "empty input is not replaced, trimmed, or line-buffered");
});
