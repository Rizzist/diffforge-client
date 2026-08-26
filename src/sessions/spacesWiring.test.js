import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSpaceSessionSubmitFor } from "./spacesController.js";

/* Regression guards for the space UI wiring findings (S1 verify round 2). The
   source checks pin consumer wiring that pure controller tests cannot observe;
   behavioral seams cover the failure-prone data transformations themselves. */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const orderOf = (source, ...needles) => needles.map((needle) => {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `expected to find: ${needle}`);
  return index;
});

test("[pin] finding 1: rail and shell consumers use the single space authority", () => {
  const rail = read("./SessionsRail.jsx");
  const rowAuthorityStart = rail.indexOf("const rowAuthority = spaceRailRowAuthority({");
  const rowBlock = rail.slice(
    rowAuthorityStart,
    rail.indexOf("onContextMenu={(event) => openMenu(event, session)}", rowAuthorityStart),
  );
  assert.match(rowBlock, /data-active=\{rowAuthority\.isActive \? "true" : undefined\}/,
    "row highlight must consume rowAuthority.isActive");
  assert.match(
    rowBlock,
    /rowAuthority\.routeToSpace\s*\? onSelectSpaceSession\?\.\(session\)\s*:\s*onSelectSession\(session\)/s,
    "row clicks must consume rowAuthority.routeToSpace",
  );
  assert.match(rail, /const unseen = session\.id !== effectiveActiveId/,
    "unseen state must use the authority's effective active id");
  assert.match(
    rail,
    /const allSessions = spaceMode\s*\? \(spaceScoped \? sessions\.filter\([^\n]+\) : \[\]\)/,
    "opening/error space mode must not fall back to the ordinary session list",
  );

  const shell = read("../app/AppShell.jsx");
  assert.match(
    shell,
    /activeSessionId && !loopspacesModeActive && !activeSpaceIdForShell/,
    "Terminals/Files must stay hidden throughout space mode",
  );
});

test("[pin] finding 2: hook save errors are isolated by space id", () => {
  const source = read("./useSpaces.js");
  const saveSuccess = source.slice(
    source.indexOf("save: async ({ spaceId, layoutJson, focusedLeaf }) =>"),
    source.indexOf("onError: (error, payload) =>"),
  );
  assert.match(
    saveSuccess,
    /setSaveErrorsBySpace\(\(current\) => \{[\s\S]*?delete next\[spaceId\];[\s\S]*?return next;/,
    "a successful save must clear only its space's error key",
  );
  assert.match(
    source,
    /setSaveErrorsBySpace\(\(current\) => \(\{ \.\.\.current, \[spaceId\]: message \}\)\)/,
    "a save failure must update only its space's error key",
  );
  assert.match(source, /const saveError = saveErrorsBySpace\[activeSpaceId\] \|\| ""/,
    "the active surface must select only its own save error");
});

test("[pin] finding 3: close awaits the bounded spaces flush before confirmation", () => {
  const source = read("../app/AppShell.jsx");
  const closeBlock = source.slice(
    source.indexOf("runWindowAction(async () => {", source.indexOf("const closeWindow")),
    source.indexOf('await invoke("app_confirm_close")', source.indexOf("const closeWindow")),
  );
  assert.match(
    closeBlock,
    /await\s+Promise\.race\(\[\s*Promise\.resolve\(flushSpaceSaves\?\.\(\)\)\.catch\(\(\) => \{\}\),/s,
    "close must await the flush/timeout race, not merely start the flush",
  );
});

test("[pin] finding 4a: deletion resolves before discard and exits only the still-active space", () => {
  const source = read("./useSpaces.js");
  const deleteBlock = source.slice(
    source.indexOf("const deleteSpace = useCallback"),
    source.indexOf("const dismissDeleteError"),
  );
  const [deleteCall, discardCall, resolutionExit] = orderOf(
    deleteBlock,
    'invoke("space_delete"',
    "saverRef.current.discard(spaceId)",
    "if (activeSpaceIdRef.current === spaceId) exitSpace()",
  );
  assert.ok(deleteCall < discardCall && discardCall < resolutionExit,
    "confirmed deletion must precede discard and the resolution-time exit decision");
  assert.doesNotMatch(deleteBlock, /\bwasActive\b/,
    "deletion must not capture stale active-space state before awaiting");

  const failIndex = deleteBlock.indexOf("setDeleteError({");
  const returnAfterFail = deleteBlock.indexOf("return;", failIndex);
  assert.ok(failIndex !== -1 && returnAfterFail > failIndex && returnAfterFail < discardCall,
    "a failed delete must report and return before discard/exit");
});

test("[pin] finding 4b: the active deletion error is a visible dismissable typed strip", () => {
  const shell = read("../app/AppShell.jsx");
  assert.match(shell, /deleteError=\{spacesApi\.activeDeleteError\}/,
    "AppShell must pass the active space's delete error");
  assert.match(shell, /onDismissDeleteError=\{spacesApi\.dismissDeleteError\}/,
    "AppShell must pass the deletion-error dismissal");

  const surface = read("./SpaceSurface.jsx");
  assert.match(surface, /\{deleteError && \(/, "the deletion error must be rendered");
  assert.match(surface, /data-error-type="space-delete" role="alert"/,
    "the deletion strip must be visibly and semantically typed");
  assert.match(surface, /Space deletion failed: \{deleteError\}/,
    "the deletion failure message must be visible");
  assert.match(surface, /onClick=\{\(\) => onDismissDeleteError\?\.\(\)\}/,
    "the deletion strip must be dismissable");
});

test("[pin] finding 6: materialization publishes its confirmed roster fact before reveal", () => {
  const source = read("../app/AppShell.jsx");
  const materialized = source.slice(
    source.indexOf("const handleDraftMaterialized"),
    source.indexOf("useEffect(() =>", source.indexOf("const handleDraftMaterialized")),
  );
  const [publishRoster, revealConfirmed, fallbackExit, ordinaryOpen] = orderOf(
    materialized,
    "setSessionsRoster((current) => rosterWithConfirmedSession(current, session.id))",
    "revealConfirmedSpaceSessionOp(session.id)",
    "exitSpaceOp();",
    "openSessionFromRail(session);",
  );
  assert.ok(publishRoster < revealConfirmed,
    "the confirmed id must enter the roster before the applyable reveal reconciles");
  assert.ok(revealConfirmed < fallbackExit && fallbackExit < ordinaryOpen,
    "a non-applyable reveal must exit space mode before opening ordinarily");

  const hook = read("./useSpaces.js");
  assert.match(
    hook,
    /const confirmedRoster = rosterWithConfirmedSession\(rosterRef\.current, sessionRef\);[\s\S]*?mutateSpace\([\s\S]*?confirmedRoster,/,
    "the synchronous reveal must reconcile against the confirmed fact",
  );
});

test("[pin] finding 7: no-attachment space submits reach invoke without throwing", async () => {
  const calls = [];
  const submitFor = createSpaceSessionSubmitFor(async (command, args) => {
    calls.push([command, args]);
    return undefined;
  });

  await assert.doesNotReject(
    submitFor({ id: "session-plain" })("plain text", []),
    "plain-text submit must pass an array through the shared submit seam",
  );
  assert.deepEqual(calls, [["session_submit_prompt", {
    session_id: "session-plain",
    prompt: "plain text",
    attachments: null,
  }]], "the no-attachment submit must still invoke Tauri exactly once");

  const surface = read("./SpaceSurface.jsx");
  assert.match(surface, /createSpaceSessionSubmitFor\(invoke\)/,
    "SpaceSurface must use the behaviorally pinned submit adapter");
  assert.match(surface, /submitCommandFor\(session\)\(prompt, attachments \|\| \[\]\)/,
    "SpaceSurface must always pass an attachment array");
  assert.match(surface, /onPastedBlocksChange=\{/, "paste blocks must be captured");
  assert.match(surface, /pastedBlocks=\{/, "paste blocks must be controlled");
  assert.match(surface, /onAttachmentsChange=\{/, "attachments must be captured");
  assert.match(surface, /attachments=\{attachmentsBySession/, "attachments must be controlled");
  assert.match(surface, /typeof next === "function" \? next\(previous\) : next/,
    "image-paste updater callbacks must be applied to the prior attachments");
  const submitCatch = surface.slice(
    surface.indexOf("} catch {", surface.indexOf("const submitFor")),
    surface.indexOf("}, [submitCommandFor])", surface.indexOf("const submitFor")),
  );
  assert.doesNotMatch(submitCatch, /setDrafts|setPastesBySession|setAttachmentsBySession/,
    "failed submits must keep text, paste blocks, and attachments");
  assert.doesNotMatch(surface, /attachments: attachments\?\.length \? attachments : null/,
    "SpaceSurface must never reintroduce the null regression");
});
