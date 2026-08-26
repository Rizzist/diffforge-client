import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createServer } from "vite";

let modulesPromise;

async function productionModules() {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const server = await createServer({
        appType: "custom",
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        server: { middlewareMode: true },
        ssr: { noExternal: ["styled-components", /^@xterm\//] },
      });
      try {
        const [appShell, host] = await Promise.all([
          server.ssrLoadModule("/src/app/AppShell.jsx"),
          server.ssrLoadModule("/src/sessions/SessionWindowHost.jsx"),
        ]);
        return { appShell, host };
      } finally {
        await server.close();
      }
    })();
  }
  return modulesPromise;
}

function reachableBarrier(generation = 1) {
  return {
    state: "reachable",
    profile_id: "profile-breakout-test",
    daemon_generation: generation,
    applied_at_ms: 1_756_200_000_123 + generation,
  };
}

test("[integration pin] rail pop-out and host never attach a cached unknown or tombstoned ref", async () => {
  const {
    appShell: { createRosterGatedSessionWindowCallback },
    host: { attachLiveSessionWindowTarget, createSessionWindowTargetAuthority },
  } = await productionModules();
  const cached = {
    id: "session-cached",
    provider_session_id: "provider-cached",
    title: "Cached row must not become live",
  };

  let opened;
  const openRailSession = createRosterGatedSessionWindowCallback({
    roster: { state: "unreachable", reason: "Awaiting a fresh complete daemon roster." },
    sessionsById: new Map([[cached.id, cached]]),
    openWindow: async (request) => {
      opened = request;
      return "session-window-cached";
    },
  });
  const label = await openRailSession(cached);
  assert.equal(label, "session-window-cached");
  assert.equal(opened.presentation.mode, "unknown");
  assert.equal(
    opened.title,
    cached.id,
    "the rail callback must not forward a cached row title through a non-live open",
  );

  const unknownTargets = [];
  let unknownLocalReads = 0;
  const unknownAuthority = createSessionWindowTargetAuthority({
    params: { sessionId: opened.sessionId },
    publishTarget: (target) => unknownTargets.push(target),
    readSessions: async () => {
      unknownLocalReads += 1;
      return [cached];
    },
  });
  const unknown = await unknownAuthority.refresh();
  const attachCalls = [];
  assert.equal(unknown.mode, "unknown");
  assert.equal(
    unknownLocalReads,
    0,
    "a bare successful local read must not even run before a complete daemon barrier",
  );
  assert.equal(
    attachLiveSessionWindowTarget(
      { ...unknown, session: cached },
      (providerId) => attachCalls.push(providerId),
    ),
    false,
    "unknown cached refs must be rejected at the surface_attach boundary",
  );
  assert.deepEqual(attachCalls, [], "unknown cached refs must never call surface_attach");

  let tombstoneOpen;
  const openTombstonedRailSession = createRosterGatedSessionWindowCallback({
    roster: { state: "reachable", sessionRefs: [] },
    sessionsById: new Map([[cached.id, cached]]),
    openWindow: async (request) => { tombstoneOpen = request; return "tombstone-window"; },
  });
  await openTombstonedRailSession(cached);
  assert.equal(tombstoneOpen.presentation.mode, "tombstone");
  assert.equal(tombstoneOpen.title, cached.id);

  const tombstoneAuthority = createSessionWindowTargetAuthority({
    params: { sessionId: tombstoneOpen.sessionId },
    publishTarget: () => {},
    readSessions: async () => [],
  });
  const tombstone = await tombstoneAuthority.publishBootstrap(reachableBarrier());
  assert.equal(tombstone.mode, "tombstone");
  assert.equal(
    attachLiveSessionWindowTarget(
      { ...tombstone, session: cached },
      (providerId) => attachCalls.push(providerId),
    ),
    false,
    "tombstoned refs must be rejected at the surface_attach boundary",
  );
  assert.deepEqual(attachCalls, [], "tombstoned refs must never call surface_attach");

  const liveAuthority = createSessionWindowTargetAuthority({
    params: { sessionId: cached.id },
    publishTarget: () => {},
    readSessions: async () => [cached],
  });
  const live = await liveAuthority.publishBootstrap(reachableBarrier(2));
  assert.equal(live.mode, "live");
  assert.equal(
    attachLiveSessionWindowTarget(live, (providerId) => attachCalls.push(providerId)),
    true,
    "only a ref confirmed through a complete daemon barrier may attach",
  );
  assert.deepEqual(attachCalls, [cached.provider_session_id]);

  const shellSource = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  const hostSource = readFileSync(new URL("./SessionWindowHost.jsx", import.meta.url), "utf8");
  assert.match(
    shellSource,
    /const openSessionWindow = useMemo\(\(\) => createRosterGatedSessionWindowCallback\(/,
    "AppShell must instantiate the behaviorally exercised production callback",
  );
  assert.match(
    shellSource,
    /onPopOutSession=\{openSessionWindow\}/,
    "the rail must receive the behaviorally exercised production callback",
  );
  assert.match(
    hostSource,
    /targetAuthority\.publishBootstrap\(event\?\.payload\)/,
    "the standalone host must drive its authority from the native complete-roster event",
  );
  assert.match(
    hostSource,
    /attachLiveSessionWindowTarget\(\s*target,/,
    "the production surface_attach effect must drive the behaviorally pinned live-only seam",
  );
});

test("[integration pin] a newer daemon barrier cancels an older projected-row promotion", async () => {
  const { host: { createSessionWindowTargetAuthority } } = await productionModules();
  let releaseOldRead;
  const oldRead = new Promise((resolve) => { releaseOldRead = resolve; });
  const published = [];
  const authority = createSessionWindowTargetAuthority({
    params: { sessionId: "session-old-generation" },
    publishTarget: (target) => published.push(target),
    readSessions: async () => oldRead,
  });

  const stalePromotion = authority.publishBootstrap(reachableBarrier(7));
  const reset = await authority.publishBootstrap({
    state: "pending",
    reason: "Daemon reconnected; awaiting its next complete roster.",
  });
  assert.equal(reset.mode, "unknown");
  releaseOldRead([{
    id: "session-old-generation",
    provider_session_id: "provider-old-generation",
  }]);
  assert.equal(
    await stalePromotion,
    null,
    "the older projected-row continuation must be cancelled by the newer daemon barrier",
  );
  assert.equal(
    published.some((target) => target.mode === "live"),
    false,
    "rows read under an older complete-roster revision must never publish live",
  );
});
