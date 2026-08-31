import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import {
  createProviderConflictGate,
  useProviderAdmin,
} from "./useProviderAdmin.js";

function installNullRenderDom() {
  const previous = new Map();
  for (const name of ["document", "window", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  const window = {
    HTMLIFrameElement: class HTMLIFrameElement {},
    addEventListener() {},
    document: null,
    removeEventListener() {},
  };
  const document = {
    addEventListener() {},
    createElement() {
      return {};
    },
    defaultView: window,
    documentElement: {},
    nodeType: 9,
    removeEventListener() {},
  };
  window.document = document;
  const container = {
    addEventListener() {},
    appendChild() {},
    insertBefore() {},
    namespaceURI: "http://www.w3.org/1999/xhtml",
    nodeName: "DIV",
    nodeType: 1,
    ownerDocument: document,
    removeChild() {},
    removeEventListener() {},
    tagName: "DIV",
    textContent: "",
  };
  globalThis.window = window;
  globalThis.document = document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    container,
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

function ProviderAdminHarness({ capture, invokeCommand }) {
  capture(useProviderAdmin({ invokeCommand }));
  return null;
}

test("[pin finding 1] conflict blocks resubmission until a decimal-string authority re-read", async () => {
  const staleRevision = "0009007199254740993";
  const freshRevision = "0009007199254740999";
  const provider = "future-provider";
  const gate = createProviderConflictGate();
  gate.completeAuthorityRead({
    provider_revision: staleRevision,
    providers: [{ provider }],
  });
  assert.equal(gate.heldRevision(provider), staleRevision);
  gate.markConflicted(provider);
  assert.equal(gate.fenceBlockReason(provider, staleRevision), "conflicted");
  assert.equal(gate.completeAuthorityRead({ provider_revision: freshRevision }, true), false,
    "a revision without a published provider list must not release the conflict");
  assert.equal(gate.completeAuthorityRead({
    provider_revision: 9007199254740999,
    providers: [{ provider }],
  }, true), false,
    "a locally numeric revision must not release the conflict");
  assert.equal(gate.completeAuthorityRead({
    provider_revision: freshRevision,
    providers: [{ provider }],
  }), true);
  assert.equal(gate.fenceBlockReason(provider, freshRevision), "conflicted",
    "an automatic load must leave the provider conflicted");
  assert.equal(gate.heldRevision(provider), staleRevision,
    "an automatic load must not replace a conflicted provider's held revision");
  assert.equal(gate.completeAuthorityRead({
    provider_revision: freshRevision,
    providers: [{ provider }],
  }, true), true);
  assert.equal(gate.heldRevision(provider), freshRevision,
    "the held revision must equal the freshly read decimal string character-for-character");
  assert.equal(gate.fenceBlockReason(provider, staleRevision), "stale_revision");
  assert.equal(gate.fenceBlockReason(provider, freshRevision), null);

  const calls = [];
  let removeCalls = 0;
  const invokeCommand = async (command, args) => {
    calls.push({ args, command });
    if (command === "lockdown_status") {
      return { activation: "configured", provider: args.provider ?? null };
    }
    assert.equal(command, "provider_remove");
    removeCalls += 1;
    if (removeCalls === 1) {
      return {
        kind: "revision_conflict",
        expected_revision: staleRevision,
        current_revision: freshRevision,
      };
    }
    return { removed: true };
  };
  const freshSnapshot = {
    provider_revision: freshRevision,
    providers: [{ provider }],
  };
  const staleRow = { name: provider, revision: staleRevision };
  const freshRow = { name: provider, revision: freshRevision };
  const dom = installNullRenderDom();
  const root = createRoot(dom.container);
  let api = null;
  const capture = (next) => {
    api = next;
  };

  try {
    await act(async () => {
      root.render(createElement(ProviderAdminHarness, { capture, invokeCommand }));
    });
    await act(async () => {
      await api.load(async () => ({ ...freshSnapshot, provider_revision: staleRevision }));
    });
    await act(async () => {
      await api.remove(staleRow, async () => freshSnapshot);
    });
    assert.equal(removeCalls, 1, "the first submit reaches the daemon and receives the conflict");

    await act(async () => {
      await api.remove(staleRow, async () => freshSnapshot);
    });
    assert.equal(removeCalls, 1, "a second submit must not invoke while the provider is conflicted");

    await act(async () => {
      await api.load(async () => freshSnapshot);
    });
    assert.equal(api.conflict?.provider, provider,
      "the automatic authority load must preserve the displayed conflict");
    await act(async () => {
      await api.remove(freshRow, async () => freshSnapshot);
    });
    assert.equal(removeCalls, 1,
      "the freshly loaded row remains blocked until the user explicitly re-reads");

    await act(async () => {
      await api.reread(async () => null);
      await api.reread(async () => ({ ...freshSnapshot, provider_revision: 9007199254740999 }));
      await api.remove(staleRow, async () => freshSnapshot);
    });
    assert.equal(removeCalls, 1,
      "failed and non-string re-reads must not release the conflict gate");

    await act(async () => {
      await api.reread(async () => freshSnapshot);
    });
    assert.equal(api.conflict, null, "the successful explicit re-read releases the displayed conflict");

    await act(async () => {
      await api.remove(staleRow, async () => freshSnapshot);
    });
    assert.equal(removeCalls, 1, "the stale held fence remains blocked after the re-read");

    await act(async () => {
      await api.remove(freshRow, async () => freshSnapshot);
    });
    assert.equal(removeCalls, 2, "the freshly re-read fence is the first resubmission allowed to invoke");
    const removeInvokes = calls.filter((call) => call.command === "provider_remove");
    assert.equal(removeInvokes.at(-1).args.expected_revision, freshRevision);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.restore();
  }
});
