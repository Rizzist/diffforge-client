import assert from "node:assert/strict";
import test from "node:test";

import { selectTodoQueueDispatchCandidate } from "./todoQueueScheduler.js";

test("targeted item for a free terminal skips over a blocked targeted item", () => {
  const result = selectTodoQueueDispatchCandidate({
    queuedItems: [
      { id: "green-target", target: "green" },
      { id: "orange-target", target: "orange" },
    ],
    resolveItemTarget: (item) => ({
      hasExplicitTerminalTarget: true,
      reason: item.target === "green" ? "busy_turn" : "",
      target: item.target === "orange" ? { terminal: "orange" } : null,
    }),
  });

  assert.equal(result.item.id, "orange-target");
  assert.deepEqual(result.target, { terminal: "orange" });
});

test("generic item dispatches when targeted lane is blocked", () => {
  const result = selectTodoQueueDispatchCandidate({
    queuedItems: [
      { id: "green-target", target: "green" },
      { id: "generic" },
    ],
    resolveItemTarget: (item) => ({
      hasExplicitTerminalTarget: Boolean(item.target),
      reason: item.target ? "busy_turn" : "",
      target: item.target ? null : { terminal: "orange" },
    }),
  });

  assert.equal(result.item.id, "generic");
  assert.deepEqual(result.target, { terminal: "orange" });
});

test("boundary item at the front does not block regular queued work", () => {
  const result = selectTodoQueueDispatchCandidate({
    queuedItems: [
      { id: "barrier", boundary: true },
      { id: "regular" },
    ],
    isBoundaryItem: (item) => Boolean(item.boundary),
    resolveItemTarget: (item) => ({
      hasExplicitTerminalTarget: false,
      target: item.id === "regular" ? { terminal: "green" } : null,
    }),
  });

  assert.equal(result.item.id, "regular");
});

test("boundary item is selected when it is the only queued item", () => {
  const result = selectTodoQueueDispatchCandidate({
    queuedItems: [{ id: "barrier", boundary: true }],
    isBoundaryItem: (item) => Boolean(item.boundary),
    resolveItemTarget: () => ({
      hasExplicitTerminalTarget: false,
      target: { terminal: "green" },
    }),
  });

  assert.equal(result.item.id, "barrier");
});
