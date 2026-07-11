// PaneErrorBoundary contract tests (plain `node --test`, no DOM renderer).
//
// The suite pins the boundary's crash-isolation contract at the class level:
// a throw is converted into error state (getDerivedStateFromError), the render
// swaps to the compact fallback WITHOUT re-throwing (so React never unwinds
// past the boundary and AppShell's remote-command listener / activation status
// emitter stay mounted), retry + resetKey clear the error and remount the
// child subtree via a new Fragment key, and componentDidCatch logs with the
// pane label while swallowing reporter failures.

import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement } from "react";

import PaneErrorBoundary, { describePaneBoundaryError } from "./PaneErrorBoundary.js";

function makeInstance(props = {}) {
  const instance = new PaneErrorBoundary({ label: "Test pane", ...props });
  // Off-tree setState stub: mirror React's behavior of merging updater output
  // into state so retry/reset logic is testable without a DOM renderer.
  instance.setState = (updater) => {
    const patch = typeof updater === "function" ? updater(instance.state) : updater;
    instance.state = { ...instance.state, ...patch };
  };
  return instance;
}

function collectElements(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, out);
    return out;
  }
  if (isValidElement(node)) {
    out.push(node);
    collectElements(node.props?.children, out);
  }
  return out;
}

function collectText(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (isValidElement(node)) collectText(node.props?.children, out);
  return out;
}

test("getDerivedStateFromError converts a child throw into error state", () => {
  const boom = new Error("boom");
  assert.deepEqual(PaneErrorBoundary.getDerivedStateFromError(boom), { error: boom });
  // Even a falsy throw value must still flip the boundary into fallback mode.
  const derived = PaneErrorBoundary.getDerivedStateFromError(undefined);
  assert.ok(derived.error instanceof Error);
});

test("renders children (keyed by attempt) when there is no error", () => {
  const child = createElement("span", { id: "healthy-child" });
  const instance = makeInstance({ children: child });
  const rendered = instance.render();
  assert.ok(isValidElement(rendered));
  assert.equal(rendered.key, "0");
  assert.equal(rendered.props.children, child);
});

test("renders the non-fatal fallback instead of children once an error is caught", () => {
  const child = createElement("span", { id: "crashed-child" });
  const instance = makeInstance({ children: child });
  instance.state = { attempt: 0, error: new Error("emitClientActionAck is not defined") };

  const fallback = instance.render();
  assert.ok(isValidElement(fallback));
  assert.equal(fallback.props["data-pane-error-boundary"], "Test pane");
  assert.equal(fallback.props.role, "alert");

  const elements = collectElements(fallback);
  // The crashed child must NOT appear anywhere in the fallback tree.
  assert.ok(!elements.some((el) => el.props?.id === "crashed-child"));

  const text = collectText(fallback).join(" ");
  assert.match(text, /This panel hit an error/);
  assert.match(text, /Test pane: emitClientActionAck is not defined/);
  assert.match(text, /Reload panel/);
});

test("shell variant renders interface copy for the app-level boundary", () => {
  const instance = makeInstance({ variant: "shell" });
  instance.state = { attempt: 0, error: new Error("shell boom") };
  const fallback = instance.render();
  assert.equal(fallback.props["data-variant"], "shell");
  const text = collectText(fallback).join(" ");
  assert.match(text, /The interface hit an error/);
  assert.match(text, /Reload interface/);
});

test("the retry button resets the boundary and remounts children under a fresh key", () => {
  const child = createElement("span", { id: "child" });
  const instance = makeInstance({ children: child });
  instance.state = { attempt: 0, error: new Error("boom") };

  const fallback = instance.render();
  const retryButton = collectElements(fallback).find((el) => el.props?.type === "button");
  assert.ok(retryButton, "fallback exposes a retry button");
  assert.equal(typeof retryButton.props.onClick, "function");

  retryButton.props.onClick();
  assert.equal(instance.state.error, null);
  assert.equal(instance.state.attempt, 1);

  const rendered = instance.render();
  assert.equal(rendered.key, "1", "children remount under a new attempt key");
  assert.equal(rendered.props.children, child);
});

test("a resetKey change auto-clears a stale error (workspace/pane switch)", () => {
  const instance = makeInstance({ resetKey: "workspace-b" });
  instance.state = { attempt: 2, error: new Error("boom") };
  instance.componentDidUpdate({ resetKey: "workspace-a" });
  assert.equal(instance.state.error, null);
  assert.equal(instance.state.attempt, 3);

  // Same resetKey must NOT clear the error (that would retry-loop a crash).
  instance.state = { attempt: 3, error: new Error("boom again") };
  instance.componentDidUpdate({ resetKey: "workspace-b" });
  assert.ok(instance.state.error);
});

test("componentDidCatch logs the pane label and never re-throws, even if reporters fail", () => {
  const seen = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    seen.push(args);
  };
  try {
    const onErrorCalls = [];
    const instance = makeInstance({
      label: "Terminal panels",
      onError: (...args) => {
        onErrorCalls.push(args);
        throw new Error("reporter exploded");
      },
    });
    const boom = new Error("boom");
    // Must not throw despite the exploding onError reporter.
    instance.componentDidCatch(boom, { componentStack: "at TerminalView" });

    assert.equal(onErrorCalls.length, 1);
    assert.equal(onErrorCalls[0][0], boom);
    assert.equal(onErrorCalls[0][2], "Terminal panels");
    assert.ok(
      seen.some((args) => String(args[0]).includes('"Terminal panels" crashed')),
      "console.error names the crashed pane",
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("describePaneBoundaryError copes with strings, empty errors, and long messages", () => {
  assert.equal(describePaneBoundaryError("plain string"), "plain string");
  assert.equal(describePaneBoundaryError(null), "Unknown error");
  assert.equal(describePaneBoundaryError(new Error("")), "Error");
  assert.equal(describePaneBoundaryError(new Error("x".repeat(500))).length, 300);
});
