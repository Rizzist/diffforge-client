import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueuePaneControlOperation,
  paneControlOperationPending,
} from "./paneControlQueue.js";

test("pane control queue serializes full operations and survives rejection", async () => {
  const queue = new Map();
  const events = [];
  let releaseFirst;
  const firstBarrier = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = enqueuePaneControlOperation(queue, "pane-1", async () => {
    events.push("first:start");
    await firstBarrier;
    events.push("first:end");
    throw new Error("expected");
  });
  const second = enqueuePaneControlOperation(queue, "pane-1", async () => {
    events.push("second:start");
    await Promise.resolve();
    events.push("second:end");
    return "done";
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["first:start"]);
  assert.equal(paneControlOperationPending(queue, "pane-1"), true);
  releaseFirst();
  await assert.rejects(first, /expected/);
  assert.equal(await second, "done");
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(queue.size, 0);
  assert.equal(paneControlOperationPending(queue, "pane-1"), false);
});

test("pane control queue permits different panes concurrently", async () => {
  const queue = new Map();
  const events = [];
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const first = enqueuePaneControlOperation(queue, "pane-a", async () => {
    events.push("a");
    await barrier;
  });
  const second = enqueuePaneControlOperation(queue, "pane-b", async () => {
    events.push("b");
  });
  await second;
  assert.deepEqual(events, ["a", "b"]);
  release();
  await first;
});

