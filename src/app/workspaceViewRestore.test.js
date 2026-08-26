import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decideWorkspaceViewHydration,
  reconcileWorkspaceOpenSessions,
  selectWorkspaceRestoreTarget,
  validateWorkspaceViewSnapshot,
  workspaceOpenSessionPresentation,
  workspaceViewGetFailureIsInvalidSnapshot,
  workspaceViewRestoreArmArgs,
} from "./workspaceViewRestore.js";
import { serializeWorkspaceView } from "./workspaceViewPersistence.js";

function recordFor({
  profileId = "profile-a",
  revision = 7,
  openSessionRefs = ["session-a"],
  activeTarget = { kind: "session", sessionRef: "session-a" },
  activeSpaceId = null,
} = {}) {
  return {
    profile_id: profileId,
    revision,
    updated_at_ms: 1_700_000_000_000,
    schema_version: 1,
    view_json: serializeWorkspaceView({ openSessionRefs, activeTarget, activeSpaceId }),
  };
}

test("[pin] restored open-set preserves a confirmed tombstone without filter erasure", () => {
  const entries = reconcileWorkspaceOpenSessions(
    ["session-live", "session-removed", "session-later"],
    { state: "reachable", sessionRefs: ["session-live", "session-later"] },
  );
  assert.deepEqual(entries, [
    { sessionRef: "session-live", state: "live" },
    { sessionRef: "session-removed", state: "tombstone" },
    { sessionRef: "session-later", state: "live" },
  ]);
});

test("[pin] persisted refs remain unknown until a fresh complete roster authorizes a verdict", () => {
  const unavailable = reconcileWorkspaceOpenSessions(
    ["session-a", "session-b"],
    {
      state: "unreachable",
      reason: "The projected rows have not landed yet.",
      confirmedSessionRefs: ["session-a"],
    },
  );
  assert.deepEqual(unavailable, [
    {
      sessionRef: "session-a",
      state: "unknown",
      reason: "The projected rows have not landed yet.",
    },
    {
      sessionRef: "session-b",
      state: "unknown",
      reason: "The projected rows have not landed yet.",
    },
  ], "a direct confirmation cannot promote a persisted boot ref");

  assert.deepEqual(
    reconcileWorkspaceOpenSessions(
      ["session-a", "session-b"],
      { state: "reachable", sessionRefs: ["session-a"] },
    ),
    [
      { sessionRef: "session-a", state: "live" },
      { sessionRef: "session-b", state: "tombstone" },
    ],
  );
});

test("[pin] session, space, and Home targets restore; a missing session falls back live then Home", () => {
  const entries = [
    { sessionRef: "session-tombstone", state: "tombstone" },
    { sessionRef: "session-live", state: "live" },
  ];
  assert.deepEqual(
    selectWorkspaceRestoreTarget(
      { kind: "session", sessionRef: "session-tombstone" },
      entries,
    ),
    { kind: "session", sessionRef: "session-tombstone", state: "tombstone" },
    "roster absence must not be confused with absence from the restored open-set",
  );
  assert.deepEqual(
    selectWorkspaceRestoreTarget({ kind: "space", spaceId: "space-a" }, entries),
    { kind: "space", spaceId: "space-a" },
  );
  assert.deepEqual(
    selectWorkspaceRestoreTarget({ kind: "home" }, entries),
    { kind: "home" },
  );
  assert.deepEqual(
    selectWorkspaceRestoreTarget(
      { kind: "session", sessionRef: "not-open" },
      entries,
    ),
    { kind: "session", sessionRef: "session-live", state: "live" },
  );
  assert.deepEqual(
    selectWorkspaceRestoreTarget(
      { kind: "session", sessionRef: "not-open" },
      [{ sessionRef: "session-tombstone", state: "tombstone" }],
    ),
    { kind: "home" },
  );
});

test("[pin] a missing active ref retries its live fallback after an unavailable boot roster", () => {
  const hydration = decideWorkspaceViewHydration({
    record: recordFor({
      openSessionRefs: ["session-later-live"],
      activeTarget: { kind: "session", sessionRef: "not-open" },
    }),
    profileId: "profile-a",
    roster: { state: "unreachable", reason: "Projected rows pending." },
  });
  assert.deepEqual(hydration.target, { kind: "home" });
  assert.equal(hydration.targetSelectionPending, true);
  assert.deepEqual(hydration.requestedTarget, {
    kind: "session",
    sessionRef: "not-open",
  });
  assert.deepEqual(
    selectWorkspaceRestoreTarget(
      hydration.requestedTarget,
      reconcileWorkspaceOpenSessions(
        hydration.openSessionRefs,
        { state: "reachable", sessionRefs: ["session-later-live"] },
      ),
    ),
    { kind: "session", sessionRef: "session-later-live", state: "live" },
  );
});

test("[pin] invalid or profile-mismatched snapshots hydrate fresh Home without importing intent", () => {
  const mismatch = decideWorkspaceViewHydration({
    record: recordFor({
      profileId: "profile-other",
      openSessionRefs: ["must-not-import"],
      activeTarget: { kind: "session", sessionRef: "must-not-import" },
    }),
    profileId: "profile-a",
    roster: { state: "reachable", sessionRefs: ["must-not-import"] },
  });
  assert.equal(mismatch.source, "invalid");
  assert.equal(mismatch.revision, null);
  assert.deepEqual(mismatch.openSessionRefs, []);
  assert.deepEqual(mismatch.openEntries, []);
  assert.deepEqual(mismatch.target, { kind: "home" });

  const partial = recordFor();
  delete partial.schema_version;
  const invalid = decideWorkspaceViewHydration({
    record: partial,
    profileId: "profile-a",
    roster: { state: "reachable", sessionRefs: ["session-a"] },
  });
  assert.equal(invalid.source, "invalid");
  assert.deepEqual(invalid.openSessionRefs, []);
  assert.deepEqual(invalid.target, { kind: "home" });
  assert.match(invalid.reason, /partial or unsupported/);
});

test("[pin] transient workspace-view reads stay distinct from corrupt stored snapshots", () => {
  assert.equal(
    workspaceViewGetFailureIsInvalidSnapshot(
      "Workspace view canonical-byte divergence: input bytes differ from canonical serialization.",
    ),
    true,
  );
  assert.equal(
    workspaceViewGetFailureIsInvalidSnapshot(
      "Workspace view for profile 'profile-a' uses unsupported schema version 2.",
    ),
    true,
  );
  assert.equal(
    workspaceViewGetFailureIsInvalidSnapshot(
      "Unable to read workspace view: database is locked",
    ),
    false,
  );
  assert.equal(
    workspaceViewGetFailureIsInvalidSnapshot(new Error("IPC channel closed")),
    false,
  );
});

test("[pin] snapshot validation rejects unsupported and non-canonical bytes", () => {
  assert.throws(
    () => validateWorkspaceViewSnapshot(
      { ...recordFor(), schema_version: 2 },
      "profile-a",
    ),
    /unsupported/,
  );
  const reordered = recordFor();
  reordered.view_json = JSON.stringify(JSON.parse(reordered.view_json), null, 2);
  assert.throws(
    () => validateWorkspaceViewSnapshot(reordered, "profile-a"),
    /canonical-byte divergence/,
  );
  const oversized = recordFor();
  oversized.view_json = `"${"x".repeat(1024 * 1024)}"`;
  assert.throws(
    () => validateWorkspaceViewSnapshot(oversized, "profile-a"),
    /exceeds the 1048576-byte limit/,
  );
});

test("[pin] Home-over-space remains a valid draft restore while a space target must match", () => {
  const draftOverSpace = validateWorkspaceViewSnapshot(recordFor({
    openSessionRefs: [],
    activeTarget: { kind: "home" },
    activeSpaceId: "space-under-draft",
  }), "profile-a");
  assert.equal(draftOverSpace.status, "restored");
  assert.equal(draftOverSpace.activeSpaceId, "space-under-draft");

  const mismatched = recordFor({
    activeTarget: { kind: "space", spaceId: "space-target" },
    activeSpaceId: "space-other",
  });
  assert.throws(
    () => validateWorkspaceViewSnapshot(mismatched, "profile-a"),
    /does not match/,
  );
});

test("[pin] workspace-view persistence cannot arm before restore hydration completes", () => {
  assert.equal(workspaceViewRestoreArmArgs({
    phase: "loading",
    profileId: "profile-a",
    revision: 11,
  }), null);
  assert.equal(workspaceViewRestoreArmArgs({
    phase: "applying-space",
    profileId: "profile-a",
    revision: 11,
  }), null);
  assert.deepEqual(workspaceViewRestoreArmArgs({
    phase: "complete",
    profileId: "profile-a",
    revision: 11,
  }), {
    profileId: "profile-a",
    revision: 11,
  });
  assert.deepEqual(workspaceViewRestoreArmArgs({
    phase: "complete",
    profileId: "profile-a",
    revision: null,
  }), {
    profileId: "profile-a",
    revision: null,
  }, "invalid/absent hydration arms a fresh revision only after Home is applied");
});

test("[pin] only a live verdict with a projected row is attachable", () => {
  const sessions = new Map([["session-live", { id: "session-live", title: "Live" }]]);
  assert.deepEqual(
    workspaceOpenSessionPresentation(
      { sessionRef: "session-live", state: "live" },
      sessions,
    ),
    { mode: "live", session: { id: "session-live", title: "Live" } },
  );
  assert.deepEqual(
    workspaceOpenSessionPresentation(
      { sessionRef: "session-stale", state: "tombstone" },
      new Map([["session-stale", { id: "session-stale" }]]),
    ),
    { mode: "tombstone" },
    "a cached row cannot revive a fresh-roster tombstone",
  );
  assert.match(
    workspaceOpenSessionPresentation(
      { sessionRef: "session-missing-row", state: "live" },
      sessions,
    ).reason,
    /projected row is unavailable/,
  );
});

test("[pin] AppShell keeps non-live restored refs off SessionSurface", () => {
  const source = readFileSync(new URL("./AppShell.jsx", import.meta.url), "utf8");
  assert.match(source, /openSessionEntries[\s\S]*?reconcileWorkspaceOpenSessions/,
    "the restored ordered intent must have its own reconciled representation");
  const openEntriesStart = source.indexOf("const openSessionEntries");
  assert.doesNotMatch(
    source.slice(
      openEntriesStart,
      source.indexOf("const publishSessionsRosterGate", openEntriesStart),
    ),
    /filter\(Boolean\)/,
    "restored intent must never erase absent entries through filter(Boolean)",
  );
  assert.match(source, /activeOpenSessionPresentation\?\.mode !== "live"/,
    "non-live ordinary entries must take the honest-card path");
  assert.match(
    source,
    /<RestoredUnavailableSessionTabs[\s\S]*?entries=\{unavailableOpenSessions\}[\s\S]*?onClose=\{closeUnavailableSessionTab\}[\s\S]*?onSelect=\{selectUnavailableSessionTab\}/,
    "inactive unavailable refs must remain selectable and closable",
  );
});

test("[pin] a restored divergent space uses the existing typed error path, never a reset", () => {
  const hook = readFileSync(new URL("../sessions/useSpaces.js", import.meta.url), "utf8");
  const bootDoor = hook.slice(
    hook.indexOf("const restoreActiveSpaceAtBoot"),
    hook.indexOf("const mutateSpace", hook.indexOf("const restoreActiveSpaceAtBoot")),
  );
  assert.match(bootDoor, /\(spaceId\) => enterSpace\(spaceId\)/,
    "boot restore must delegate to the ordinary strict space entry pipeline");
  const enter = hook.slice(
    hook.indexOf("const enterSpace = useCallback"),
    hook.indexOf("const restoreActiveSpaceAtBoot"),
  );
  assert.match(enter, /const result = enterSpaceState\(latest\.record, rosterRef\.current\)/,
    "the restored record must pass enterSpaceState canonical validation");
  assert.match(enter, /setSpaceError\(result\.error\)/,
    "a divergent result must publish its typed error");
  const invalidResultBranch = enter.slice(
    enter.indexOf("setSpaceError(result.error)"),
    enter.indexOf("}, [publishState])"),
  );
  assert.doesNotMatch(invalidResultBranch, /publishState\(/,
    "the error branch must never synthesize an empty/reset layout");

  const shell = readFileSync(new URL("./AppShell.jsx", import.meta.url), "utf8");
  const hydration = shell.slice(
    shell.indexOf("const applyWorkspaceViewHydration"),
    shell.indexOf("const restoreWorkspaceViewForProfile"),
  );
  assert.match(hydration, /await restoreActiveSpaceAtBoot\(hydration\.target\.spaceId\)/,
    "AppShell must await the typed space result before completing hydration");
});
