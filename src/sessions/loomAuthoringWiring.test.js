import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const srcRoot = dirname(fileURLToPath(new URL("../index.jsx", import.meta.url)));

function productionSources(root = srcRoot) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (/\.(?:js|jsx|mjs)$/.test(entry.name) && !/\.test\.(?:js|mjs)$/.test(entry.name)) {
        found.push([path, readFileSync(path, "utf8")]);
      }
    }
  };
  visit(root);
  return found;
}

const WAVE3_COMMANDS = [
  "loom_validate",
  "loom_author_draft",
  "loom_author_revise",
  "loom_author_confirm",
  "loom_archive",
  "loom_unarchive",
  "loom_install_cancel",
  "loom_watch",
];

test("[pin] Wave 3 Loom invokes are hook-only and use exact snake_case SDK keys", () => {
  const hook = read("./useLoom.js");
  const allSources = productionSources();
  for (const command of WAVE3_COMMANDS) {
    const owners = allSources.filter(([, source]) => source.includes(`\"${command}\"`));
    assert.deepEqual(
      owners.map(([path]) => path),
      [fileURLToPath(new URL("./useLoom.js", import.meta.url))],
      `${command} must have one production reconcile point: useLoom.js`,
    );
  }

  assert.match(hook, /invoke\("loom_validate", \{ kind, text \}\)/);
  assert.match(hook, /invoke\("loom_author_draft", \{[\s\S]*?session_id: sessionId,[\s\S]*?kind,[\s\S]*?prose,/);
  assert.match(hook, /invoke\("loom_author_revise", \{[\s\S]*?authoring_id:[\s\S]*?expected_revision:[\s\S]*?kind,[\s\S]*?text,/);
  const confirmPayload = hook.slice(
    hook.indexOf("const authorConfirm = useCallback"),
    hook.indexOf("const setArchived = useCallback"),
  );
  for (const key of [
    "authoring_id:", "expected_revision:", "kind,", "text,",
    "payload.expected_rev", "payload.expected_digest",
  ]) {
    assert.ok(confirmPayload.includes(key), `confirm must carry ${key}`);
  }
  const archivePayload = hook.slice(
    hook.indexOf("const setArchived = useCallback"),
    hook.indexOf("const cancelInstall = useCallback"),
  );
  for (const key of ["kind,", "id,", "expected_rev:", "payload.expected_digest"]) {
    assert.ok(archivePayload.includes(key), `archive/unarchive must carry ${key}`);
  }
  assert.match(hook, /invoke\("loom_install_cancel", \{ install_job_id: installJobId \}\)/);
  assert.match(hook, /invoke\("loom_watch", \{ after_cursor: position \}\)/);
  assert.match(hook, /invoke\("loom_list", \{ include_archived: true \}\)/);
});

test("[pin] validate, authoring, archive, watch, and cancel settle unavailable independently", () => {
  const hook = read("./useLoom.js");
  for (const feature of ["validate", "authoring", "archive", "watch", "cancel"]) {
    assert.match(hook, new RegExp(`featureUnavailableRef\\.current\\.${feature}`),
      `${feature} must have its own settle-once guard`);
    assert.ok(hook.includes(`settleFeatureError(\"${feature}\"`),
      `${feature} errors must settle only that feature`);
  }
  assert.match(hook, /markFeatureUnavailable\(feature\)/,
    "the per-feature error seam must not promote one missing bit to global Loom unavailability");
});

test("[pin] authoring and registry fences are echoed, optional when unread, and never auto-retried", () => {
  const model = read("./loomModel.js");
  const hook = read("./useLoom.js");
  const fenceHelpers = model.slice(
    model.indexOf("export function draftFenceFor"),
    model.indexOf("function publishedReason"),
  );
  assert.match(fenceHelpers, /authoring_id: draft\.authoringId/);
  assert.match(fenceHelpers, /expected_revision: draft\.expectedRevision/);
  assert.match(fenceHelpers, /fence\.expected_rev = expectedRev/);
  assert.match(fenceHelpers, /fence\.expected_digest = expectedDigest/);
  assert.doesNotMatch(fenceHelpers, /\+\s*1|\?\?\s*0|\b(?:Number|parseInt)\s*\(/,
    "fence helpers must never increment, default, or numeric-parse a read fence");
  assert.doesNotMatch(hook, /current(?:Revision|Rev|Digest)[\s\S]{0,120}invoke\(/,
    "typed current conflict coordinates are display-only, never retry inputs");
  assert.ok(hook.includes("explicit new draft read is required"));
  assert.ok(hook.includes("explicit list read is required"));
  assert.doesNotMatch(hook, /canonicalDigestPreview/,
    "a validation preview must never become a confirm/archive fence");
});

test("[pin] registry watch uses the SDK event names and exact decimal-string cursor discipline", () => {
  const hook = read("./useLoom.js");
  const model = read("./loomModel.js");
  assert.match(hook, /LOOM_REGISTRY_DELTA_EVENT = "loom-registry-delta"/);
  assert.match(hook, /LOOM_REGISTRY_CAUGHT_UP_EVENT = "loom-registry-caught-up"/);
  assert.match(hook, /listen\(LOOM_REGISTRY_DELTA_EVENT/);
  assert.match(hook, /listen\(LOOM_REGISTRY_CAUGHT_UP_EVENT/);
  assert.match(model, /const DECIMAL_CURSOR = \/\^\\d\+\$\//);
  assert.match(model, /BigInt\(next\) > BigInt\(held\)/);
  assert.doesNotMatch(`${hook}\n${model}`, /\b(?:Number|parseInt)\s*\(/,
    "registry cursors must never take a numeric JavaScript round-trip");
  assert.match(hook, /heldCursor = delta\.cursor;[\s\S]*?setRegistryCursor\(delta\.cursor\)/,
    "after_cursor advances verbatim from the pushed decimal string");
  assert.match(hook, /setRegistry\(\(current\) => applyRegistryDelta\(current, delta\)\)/,
    "a pushed delta must update the visible registry");
  assert.match(hook, /Caught-up above our held cursor[\s\S]*?void rebaseline\(\)/,
    "a gap/reconnect signal must re-read a baseline instead of guessing missing deltas");
});

test("[pin] Loom rail wording is honest about preview, not-confirmed, and default archive exclusion", () => {
  const rail = read("./LoomRailSection.jsx");
  assert.ok(rail.includes("Canonical digest preview (not saved)"),
    "canonical_digest must be labeled preview-not-saved");
  assert.ok(rail.includes("Not confirmed"),
    "confirmed:null must render a real not-confirmed outcome");
  assert.ok(rail.includes("Archived entries are excluded by default"),
    "the default empty list must claim only none active");
  assert.ok(rail.includes("No archived entries in the explicit include-archived read."),
    "only an explicit inclusive read may claim the archived set is empty");
  assert.match(rail, /line \{factText\(validationError\.line\)\}, column \{factText\(validationError\.column\)\}/,
    "one-based line and column must both render verbatim");
  assert.ok(rail.includes("Already terminal: {factText(cancelByJob[installJob.jobId].state)}"),
    "already_terminal must display the daemon state verbatim");
  assert.ok(rail.includes("Unrecognized cancel outcome: {rawText(cancelByJob[installJob.jobId].raw)}"),
    "unknown cancellation must render raw");
});

test("[pin] AppShell and SessionsRail wire every Wave 3 value/action into the inline Loom section", () => {
  const shell = read("../app/AppShell.jsx");
  const sessionsRail = read("./SessionsRail.jsx");
  for (const prop of [
    "loomWorkflowEntries={loomApi.workflowEntries}",
    "loomArchivedEntries={loomApi.archivedEntries}",
    "loomCancelByJob={loomApi.cancelByJob}",
    "loomRegistryCursor={loomApi.registryCursor}",
    "loomFeatureUnavailable={loomApi.featureUnavailable}",
    "loomFeatureErrors={loomApi.featureErrors}",
    "loomAuthoringConflict={loomApi.authoringConflict}",
    "onListArchivedLoom={loomApi.listArchived}",
    "onRefreshLoomRegistry={loomApi.list}",
    "onValidateLoom={loomApi.validate}",
    "onDraftLoom={loomApi.authorDraft}",
    "onReviseLoom={loomApi.authorRevise}",
    "onConfirmLoom={loomApi.authorConfirm}",
    "onSetLoomArchived={loomApi.setArchived}",
    "onCancelAgentInstall={loomApi.cancelInstall}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
  for (const prop of [
    "activeSessionId={activeSessionId}",
    "workflowEntries={loomWorkflowEntries}",
    "archivedEntries={loomArchivedEntries}",
    "cancelByJob={loomCancelByJob}",
    "registryCursor={loomRegistryCursor}",
    "onValidate={onValidateLoom}",
    "onRefreshRegistry={onRefreshLoomRegistry}",
    "onAuthorDraft={onDraftLoom}",
    "onAuthorRevise={onReviseLoom}",
    "onAuthorConfirm={onConfirmLoom}",
    "onSetArchived={onSetLoomArchived}",
    "onCancelInstall={onCancelAgentInstall}",
  ]) {
    assert.ok(sessionsRail.includes(prop), `SessionsRail must pass ${prop}`);
  }
});
