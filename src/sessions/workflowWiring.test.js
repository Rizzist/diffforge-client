import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* Source-introspection wiring pins for the workflow / convergence-graph UI
   (P1′). These guard consumer wiring the pure workflowModel tests cannot
   observe: the eight Tauri commands with their snake_case arg keys living
   ONLY in useWorkflow.js (the single reconcile point), the conditional
   fence, the rail/surface mounts, and the house-law honesty wording (two
   digests distinct, catalog-unavailable ≠ empty catalog, revision-conflict
   re-read — never auto-retry). */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const orderOf = (source, ...needles) => needles.map((needle) => {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `expected to find: ${needle}`);
  return index;
});

test("[pin] useWorkflow invokes the eight workflow commands with snake_case arg keys", () => {
  const source = read("./useWorkflow.js");
  assert.match(source, /invoke\("loom_list"\)/,
    "the read side rides loom_list (additive workflows/workflow_catalog fields)");

  const instanceStart = source.indexOf('invoke("workflow_instance_get"');
  assert.notEqual(instanceStart, -1, "workflow_instance_get must be invoked");
  const instanceBlock = source.slice(source.lastIndexOf("const instance =", instanceStart), instanceStart);
  assert.ok(instanceBlock.includes("workflow_id: workflowId"),
    "workflow_instance_get must key by workflow_id");
  assert.ok(instanceBlock.includes("payload.template_digest = templateDigest"),
    "template_digest is OPTIONAL: assigned onto the payload only when the caller has one");

  assert.match(source, /invoke\("graph_status", \{ session_id: sessionId \}\)/,
    "graph_status must key by session_id");

  assert.match(source, /invoke\("graph_inspect", payload\)/,
    "graph_inspect must send the conditionally-built payload (cursor omittable)");
  const inspectStart = source.indexOf("const inspect =");
  const inspectBlock = source.slice(inspectStart, source.indexOf('invoke("graph_inspect"', inspectStart));
  assert.ok(inspectBlock.includes("session_id: sessionId, limit"),
    "graph_inspect must pass session_id and a numeric limit");

  assert.match(source, /invoke\("graph_pin", payload\)/,
    "graph_pin must send the conditionally-built payload");
  assert.match(source, /invoke\("graph_switch", payload\)/,
    "graph_switch must send the conditionally-built payload");
  const switchStart = source.indexOf("const switchGraph =");
  const switchBlock = source.slice(switchStart, source.indexOf('invoke("graph_switch"', switchStart));
  for (const key of ["session_id: sessionId", "old_graph_id: oldGraphId", "template,"]) {
    assert.ok(switchBlock.includes(key), `graph_switch must pass ${key}`);
  }

  const abandonStart = source.indexOf('invoke("graph_abandon"');
  const abandonBlock = source.slice(abandonStart, source.indexOf("})", abandonStart));
  assert.ok(abandonBlock.includes("session_id: sessionId") && abandonBlock.includes("why:"),
    "graph_abandon must pass session_id and why");

  const runSetStart = source.indexOf('invoke("graph_run_set_open"');
  const runSetBlock = source.slice(runSetStart, source.indexOf("})", runSetStart));
  for (const key of ["session_id: sessionId", "plan_item_id: planItemId", "plan_event_seq: planEventSeq"]) {
    assert.ok(runSetBlock.includes(key), `graph_run_set_open must pass ${key}`);
  }

  assert.match(source, /invoke\("loom_register_workflow", \{ source: pipeSource \}\)/,
    "loom_register_workflow must pass the pipe source verbatim");
});

test("[pin] every workflow invoke lives in useWorkflow.js — the single reconcile point", () => {
  const hook = read("./useWorkflow.js");
  for (const command of [
    "workflow_instance_get", "graph_status", "graph_inspect", "graph_pin",
    "graph_switch", "graph_abandon", "graph_run_set_open", "loom_register_workflow",
  ]) {
    assert.ok(hook.includes(`invoke("${command}"`), `useWorkflow must own ${command}`);
    for (const consumer of ["./WorkflowRailSection.jsx", "./WorkflowStatusChip.jsx"]) {
      assert.ok(!read(consumer).includes(`invoke("${command}"`),
        `${consumer} must not invoke ${command} — components are presentational`);
    }
  }
  for (const consumer of ["./WorkflowRailSection.jsx", "./WorkflowStatusChip.jsx"]) {
    assert.ok(!read(consumer).includes("invoke("),
      `${consumer} must not call invoke at all`);
  }
});

test("[pin] the fence is conditional: expected_digest only from a real instance read, never hardcoded", () => {
  const source = read("./useWorkflow.js");
  /* The invoke lines carry a payload variable, so expected_digest can be
     ABSENT — it is never an inline key of the pin/switch call. */
  assert.doesNotMatch(source, /invoke\("graph_pin", \{/,
    "graph_pin must not inline its payload (the fence key must be omittable)");
  assert.doesNotMatch(source, /invoke\("graph_switch", \{/,
    "graph_switch must not inline its payload (the fence key must be omittable)");
  /* The ONLY expected_digest writer is the fence conditional, and the
     fence comes from fenceFor over an instance this hook actually read. */
  const writers = source.match(/payload\.expected_digest = ([^;]+);/g) || [];
  assert.equal(writers.length, 2, "exactly the pin and switch fence writers");
  for (const writer of writers) {
    assert.equal(writer, "payload.expected_digest = fence;",
      "expected_digest must be the fenceFor result verbatim");
  }
  assert.equal((source.match(/if \(fence !== undefined\) payload\.expected_digest = fence;/g) || []).length, 2,
    "the fence key must be OMITTED when fenceFor returns undefined");
  assert.match(source, /fenceFor\(instanceByIdRef\.current\[template\]\)/,
    "the fence must come from an instance READ this hook holds, keyed by the template being pinned");
  assert.doesNotMatch(source, /expected_digest:\s*(?:null|""|fence)/,
    "expected_digest is never sent as null/empty and never inlined");
  const model = read("./workflowModel.js");
  const fenceStart = model.indexOf("export function fenceFor");
  const fenceBlock = model.slice(fenceStart, model.indexOf("}", model.indexOf("return typeof fence", fenceStart)));
  assert.ok(fenceBlock.includes("return undefined"),
    "fenceFor must return undefined (not null/empty) without a real instance");
  assert.ok(fenceBlock.includes("instanceView.templateDigest"),
    "the fence is the instance's template_digest");
  assert.doesNotMatch(fenceBlock, /\.digest\b/,
    "the fence must NEVER be the user-source digest");
});

test("[pin] graph_inspect's cursor is Option<String>: never numeric, key omitted without one", () => {
  const source = read("./useWorkflow.js");
  const inspectStart = source.indexOf("const inspect =");
  assert.notEqual(inspectStart, -1, "the inspect callback must exist");
  const block = source.slice(inspectStart, source.indexOf("}, [settleError]);", inspectStart));
  assert.ok(block.includes("cursor = undefined"),
    "inspect must default cursor to undefined — a numeric default would reach the wire");
  assert.ok(block.includes('invoke("graph_inspect", payload)'),
    "graph_inspect must send a built payload so the cursor key can be ABSENT");
  assert.ok(block.includes('if (typeof cursor === "string" && cursor.length > 0) payload.cursor = cursor;'),
    "cursor rides the payload ONLY as a non-empty string (Option<String>)");
  assert.doesNotMatch(block, /cursor = 0|cursor: 0|cursor,/,
    "no numeric cursor may reach the graph_inspect payload");
  const writers = block.match(/payload\.cursor = ([^;]+);/g) || [];
  assert.deepEqual(writers, ["payload.cursor = cursor;"],
    "the only cursor writer is the string-guarded one");
});

test("[pin] a revision conflict is returned for display and never auto-retried with the current digest", () => {
  const source = read("./useWorkflow.js");
  assert.match(source, /revisionConflictView\(thrown\)/,
    "pin/switch failures must be decoded through revisionConflictView");
  assert.match(source, /if \(conflict\) return \{ ok: false, conflict \};/,
    "a decoded conflict must be RETURNED, not retried");
  /* Exactly one dispatch per mutation command: there is no second
     invoke a conflict path could reach. */
  assert.equal((source.match(/invoke\("graph_pin"/g) || []).length, 1,
    "exactly one graph_pin dispatch — no auto-resubmit path");
  assert.equal((source.match(/invoke\("graph_switch"/g) || []).length, 1,
    "exactly one graph_switch dispatch — no auto-resubmit path");
  /* The hook never reads the conflict's current digest — the value an
     auto-retry would need to substitute behind the user's selection. */
  assert.doesNotMatch(source, /currentDigest/,
    "useWorkflow must never touch the conflict's current digest");
  const model = read("./workflowModel.js");
  assert.match(model, /data\?\.kind === "workflow_revision_conflict"/,
    "the conflict decode must recognize the coordinates UNDER error.data");
  assert.match(model, /const body = data;/,
    "the extraction body is error.data — never the error's top level");
  const section = read("./WorkflowRailSection.jsx");
  assert.ok(section.includes("re-read the"),
    "the conflict panel must ask the user to re-read the instance");
  assert.ok(section.includes("Re-read instance"),
    "the only conflict action is a re-read of the instance");
  assert.ok(section.includes("conflict.expectedDigest") && section.includes("conflict.currentDigest"),
    "the conflict panel must show expected vs current");
  /* The conflict panel's re-read action calls onReadInstance — it must not
     call onPin/onSwitch (that would be the auto-retry). */
  const panelStart = section.indexOf("<WorkflowConflictPanel");
  const panelEnd = section.indexOf("</WorkflowConflictPanel>");
  const panelBlock = section.slice(panelStart, panelEnd);
  assert.ok(panelBlock.includes("onReadInstance?.(entry.id)"),
    "the conflict panel's action must be a re-read");
  assert.ok(!panelBlock.includes("onPin") && !panelBlock.includes("onSwitch"),
    "the conflict panel must offer no resubmit");
});

test("[pin] catalog unavailable and empty catalog stay DISTINCT surfaces", () => {
  const model = read("./workflowModel.js");
  /* The wire field is Array | null: ONLY a real array is an advertised
     catalog — null (or an absent field) is the typed unavailable state,
     and loom_list does not throw for a missing catalog feature. */
  assert.match(model, /if \(!Array\.isArray\(raw\)\) \{\n    return \{ kind: "unavailable", entries: \[\] \};/,
    "a non-array (null/absent) workflow_catalog is the typed unavailable state");
  assert.doesNotMatch(model, /workflow_catalog \?\?|workflow_catalog \|\|/,
    "workflow_catalog null must never be defaulted into an empty array");
  const section = read("./WorkflowRailSection.jsx");
  assert.ok(section.includes("Workflow catalog unavailable on this daemon."),
    "the rail must render catalog absence as unavailability");
  assert.ok(section.includes("No workflows in the catalog."),
    "an available-but-empty catalog has its OWN wording");
  const unavailableMount = section.indexOf('catalog.kind === "unavailable"');
  const emptyMount = section.indexOf('entries.length === 0');
  assert.ok(unavailableMount !== -1 && emptyMount !== -1,
    "both states must be rendered off their own kind checks");
});

test("[pin] the two digests render as two labeled facts and 'missing' renders as does-not-exist", () => {
  const section = read("./WorkflowRailSection.jsx");
  const [sourceDigestLabel, fenceLabel] = orderOf(
    section,
    "<b>source digest</b>",
    "<b>template digest (fence)</b>",
  );
  assert.ok(sourceDigestLabel < fenceLabel, "both digest facts must render, separately labeled");
  assert.ok(section.includes("instanceView.digest ??"),
    "the source digest fact shows the user-source digest (typed absence for built-ins)");
  assert.ok(section.includes("instanceView.templateDigest ??"),
    "the fence fact shows template_digest and only template_digest");
  assert.ok(section.includes("This workflow instance does not exist."),
    "a missing instance must say does-not-exist, never a substituted row");
  const model = read("./workflowModel.js");
  assert.match(model, /if \(instance == null\) return \{ kind: "missing" \};/,
    "instance:null must become the typed missing view");
});

test("[pin] the main-session filter keys only off the published boolean", () => {
  const section = read("./WorkflowRailSection.jsx");
  assert.match(section, /entries\.filter\(\(entry\) => isMainSessionEligible\(entry\)\)/,
    "the eligibility filter must be isMainSessionEligible");
  assert.match(section, /isMainSessionEligible\(entry\) && \(/,
    "the eligibility badge must be isMainSessionEligible");
  assert.doesNotMatch(section, /entry\.id\.(?:startsWith|includes)|entry\.template\b|entry\.workflow\b|mainSessionEligible\s*(?:\|\||\?\?)/,
    "eligibility must never be inferred from id prefix, origin payloads, or template shape");
  const model = read("./workflowModel.js");
  assert.equal((model.match(/main_session_eligible === true/g) || []).length, 2,
    "each published origin maps eligibility from the explicit boolean only");
});

test("[pin] SessionsRail mounts WorkflowRailSection right after LoomRailSection", () => {
  const rail = read("./SessionsRail.jsx");
  assert.match(rail, /import WorkflowRailSection from "\.\/WorkflowRailSection\.jsx"/,
    "SessionsRail must import WorkflowRailSection");
  const [loomMount, workflowMount, pinnedGroup] = orderOf(
    rail,
    "<LoomRailSection",
    "<WorkflowRailSection",
    "{pinned.length > 0 && (",
  );
  assert.ok(loomMount < workflowMount && workflowMount < pinnedGroup,
    "WorkflowRailSection must render after LoomRailSection and before the session groups");
  for (const prop of [
    "catalog={workflowCatalog}",
    "workflows={workflowRecords}",
    "instanceById={workflowInstanceById}",
    "statusBySession={workflowStatusBySession}",
    "listError={workflowListError}",
    "unavailable={workflowUnavailable}",
    "activeSessionId={activeSessionId}",
    "onReadInstance={onReadWorkflowInstance}",
    "onRegisterWorkflow={onRegisterWorkflow}",
    "onPin={onPinWorkflow}",
    "onSwitch={onSwitchWorkflow}",
    "onAbandon={onAbandonWorkflow}",
  ]) {
    assert.ok(rail.includes(prop), `SessionsRail must pass ${prop}`);
  }
});

test("[pin] SessionSurface mounts the workflow chip beside the persona select, display-only", () => {
  const surface = read("./SessionSurface.jsx");
  assert.match(surface, /import WorkflowStatusChip from "\.\/WorkflowStatusChip\.jsx"/,
    "SessionSurface must import WorkflowStatusChip");
  const personaMount = surface.indexOf("<SessionPersonaSelect");
  const chipMount = surface.indexOf("<WorkflowStatusChip");
  assert.ok(personaMount !== -1 && chipMount > personaMount && chipMount - personaMount < 1200,
    "the workflow chip must sit adjacent to the persona select");
  const guardIndex = surface.lastIndexOf('session && session.id !== "draft"', chipMount);
  assert.ok(guardIndex !== -1 && chipMount - guardIndex < 500,
    "the chip must be guarded by session && session.id !== \"draft\"");
  assert.ok(surface.includes("statusView={workflowStatusBySession[session.id]}"),
    "the chip must show only the graph_status read for the session");
  /* An unseen graph_status read must stay undefined — collapsing it would
     fabricate a "No workflow" claim for a status we never read. */
  assert.doesNotMatch(surface, /workflowStatusBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "the statusView prop must never default an unseen read");
  const chip = read("./WorkflowStatusChip.jsx");
  assert.ok(chip.includes('"Workflow not read"') && chip.includes('"No workflow"'),
    "unread and none must be DISTINCT chip states");
  assert.match(chip, /statusView\?\.kind === "none"/,
    "only an actual graph_status read may claim no-workflow");
  assert.ok(chip.includes("graph_status"),
    "the chip must name graph_status as its only state source");
  assert.doesNotMatch(chip, /onClick|onChange/,
    "the chip is display-only — it dispatches nothing");
});

test("[pin] AppShell owns useWorkflow beside useLoom and feeds both consumers", () => {
  const shell = read("../app/AppShell.jsx");
  assert.match(shell, /import \{ useWorkflow \} from "\.\.\/sessions\/useWorkflow\.js"/,
    "AppShell must import useWorkflow");
  assert.match(shell, /const workflowApi = useWorkflow\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must call useWorkflow gated on authentication");
  for (const prop of [
    "workflowCatalog={workflowApi.catalog}",
    "workflowRecords={workflowApi.workflows}",
    "workflowInstanceById={workflowApi.instanceById}",
    "workflowStatusBySession={workflowApi.statusBySession}",
    "workflowListError={workflowApi.error}",
    "workflowUnavailable={workflowApi.unavailable}",
    "onReadWorkflowInstance={workflowApi.instance}",
    "onRegisterWorkflow={workflowApi.registerWorkflow}",
    "onPinWorkflow={workflowApi.pin}",
    "onSwitchWorkflow={workflowApi.switch}",
    "onAbandonWorkflow={workflowApi.abandon}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
  /* The surface chip gets its two props too. */
  assert.equal((shell.match(/workflowStatusBySession=\{workflowApi\.statusBySession\}/g) || []).length, 2,
    "statusBySession must reach both the rail and the surface");
  assert.equal((shell.match(/workflowUnavailable=\{workflowApi\.unavailable\}/g) || []).length, 2,
    "unavailable must reach both the rail and the surface");
  /* The chip is display-only, so the shell owns the graph_status read for
     the active session. */
  assert.match(shell, /void readWorkflowStatus\(activeSessionId\)/,
    "AppShell must read graph_status for the active session");
});

test("[pin] useWorkflow settles unavailable once and register failures surface the compile list verbatim", () => {
  const source = read("./useWorkflow.js");
  for (const transform of [
    "workflowCatalogView", "workflowRecordView", "workflowInstanceView",
    "graphStatusView", "revisionConflictView", "fenceFor",
    "workflowRegistrationReceiptView", "compileErrorListView",
    "workflowUnavailableFromError",
  ]) {
    assert.ok(source.includes(transform), `useWorkflow must use workflowModel's ${transform}`);
  }
  assert.match(source, /if \(unavailableRef\.current\) return/,
    "an unavailable daemon must stop every dispatch — no retry spam");
  assert.match(source, /errors: compileErrorListView\(thrown\)/,
    "a register rejection must carry the daemon's compile error list verbatim");
  const section = read("./WorkflowRailSection.jsx");
  assert.ok(section.includes("setRegisterErrors(result?.errors ?? [])"),
    "the rail must hold the compile error list for display");
  assert.match(section, /registerErrors\.map\(/,
    "the rail must render every compile error line");
  assert.ok(section.includes("Workflows are unavailable on this daemon."),
    "the rail must render the honest unavailable state");
  /* statusBySession is written ONLY from graph_status reads. */
  assert.equal((source.match(/setStatusBySession\(/g) || []).length, 1,
    "exactly one statusBySession writer: the graph_status read");
  const statusWriter = source.indexOf("setStatusBySession(");
  const statusInvoke = source.indexOf('invoke("graph_status"');
  assert.ok(statusInvoke !== -1 && statusWriter > statusInvoke && statusWriter - statusInvoke < 400,
    "the statusBySession writer must sit directly on the graph_status read");
});
