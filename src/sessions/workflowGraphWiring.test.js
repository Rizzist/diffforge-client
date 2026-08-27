import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* Source-introspection wiring pins for the workflow live-runtime graph UI
   (P6). These guard consumer wiring the pure workflowGraphModel tests
   cannot observe: the two Tauri commands with their snake_case arg keys
   living ONLY in useWorkflowGraph.js (the single reconcile point), the
   watch-as-CHANGE-SIGNAL loop (re-fetch state, advance after_cursor =
   next_cursor, never reduce events into node states), the surface/shell
   mounts, and the house-law honesty wording (ast_digest fence, no-live-
   graph vs not-read-yet, unrecognized activity). */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("[pin] useWorkflowGraph invokes the two workflow_graph commands with snake_case arg keys", () => {
  const source = read("./useWorkflowGraph.js");

  const stateStart = source.indexOf('invoke("workflow_graph_state"');
  assert.notEqual(stateStart, -1, "workflow_graph_state must be invoked");
  assert.match(source, /invoke\("workflow_graph_state", payload\)/,
    "workflow_graph_state must send a built payload so graph_id can be ABSENT");
  const stateBlock = source.slice(source.lastIndexOf("const loadState =", stateStart), stateStart);
  assert.ok(stateBlock.includes("session_id: sessionId"),
    "workflow_graph_state must key by session_id");
  assert.ok(stateBlock.includes('if (typeof graphId === "string" && graphId.length > 0)'),
    "graph_id is OPTIONAL: it rides the payload only when the caller names one");
  assert.ok(stateBlock.includes("payload.graph_id = graphId;"),
    "graph_id must be the caller's id verbatim");
  assert.doesNotMatch(source, /graph_id:\s*(?:null|""|undefined)/,
    "graph_id is never sent as null/empty filler — the key is omitted instead");

  const watchStart = source.indexOf('invoke("workflow_graph_watch"');
  assert.notEqual(watchStart, -1, "workflow_graph_watch must be invoked");
  const watchBlock = source.slice(watchStart, source.indexOf("})", watchStart));
  for (const key of ["session_id: sessionId", "after_cursor: afterCursor", "limit,"]) {
    assert.ok(watchBlock.includes(key), `workflow_graph_watch must pass ${key}`);
  }
});

test("[pin] both workflow_graph invokes live ONLY in useWorkflowGraph.js — the single reconcile point", () => {
  const hook = read("./useWorkflowGraph.js");
  for (const command of ["workflow_graph_state", "workflow_graph_watch"]) {
    assert.ok(hook.includes(`invoke("${command}"`), `useWorkflowGraph must own ${command}`);
    for (const consumer of ["./WorkflowGraphView.jsx", "./SessionSurface.jsx", "../app/AppShell.jsx"]) {
      assert.ok(!read(consumer).includes(`invoke("${command}"`),
        `${consumer} must not invoke ${command}`);
    }
  }
  assert.ok(!read("./WorkflowGraphView.jsx").includes("invoke("),
    "WorkflowGraphView is presentational — it must not call invoke at all");
});

test("[pin] the watch is a CHANGE SIGNAL: on events/advance/gap the hook RE-FETCHES state and never reduces the graph client-side", () => {
  const hook = read("./useWorkflowGraph.js");
  /* The signal decode is the model's watchSignal — never an ad-hoc local
     reduction. */
  assert.match(hook, /const signal = watchSignal\(page\);/,
    "the watch page must be decoded through watchSignal");
  /* changed ⇒ re-fetch workflow_graph_state for the authoritative
     projection. */
  const signalIndex = hook.indexOf("const signal = watchSignal(page);");
  const changedIndex = hook.indexOf("if (signal.changed) {", signalIndex);
  assert.notEqual(changedIndex, -1, "the change signal must be checked");
  const changedBlock = hook.slice(changedIndex, hook.indexOf("}", changedIndex));
  assert.ok(changedBlock.includes("loadStateRef.current(watchSessionId)"),
    "a change signal must RE-FETCH workflow_graph_state — the authority");
  /* graphBySession is written ONLY from workflow_graph_state reads: one
     writer, sitting directly on the state invoke — the watch path cannot
     reduce events into node states. */
  assert.equal((hook.match(/setGraphBySession\(/g) || []).length, 1,
    "exactly one graphBySession writer: the workflow_graph_state read");
  const writerIndex = hook.indexOf("setGraphBySession(");
  const stateInvokeIndex = hook.indexOf('invoke("workflow_graph_state"');
  assert.ok(stateInvokeIndex !== -1 && writerIndex > stateInvokeIndex
    && writerIndex - stateInvokeIndex < 600,
    "the graphBySession writer must sit directly on the workflow_graph_state read");
  const watchInvokeIndex = hook.indexOf('invoke("workflow_graph_watch"');
  assert.ok(writerIndex < watchInvokeIndex,
    "the watch path must never write graphBySession");
  /* The state stored is the daemon's, through graphStateView — null kept
     honest as the "none" view. */
  assert.match(hook, /const view = graphStateView\(state \?\? null\);/,
    "a null state must become the typed honest 'none' view, never be dropped");
});

test("[pin] cursor honesty in the loop: baseline from through_cursor, then after_cursor = next_cursor verbatim", () => {
  const hook = read("./useWorkflowGraph.js");
  /* The watch resumes from the retained cursor, and only the model's
     verbatim nextAfterCursor ever replaces it. */
  assert.match(hook, /watchRef\.current\(watchSessionId, cursorRef\.current\)/,
    "the watch must be issued from the retained after_cursor");
  assert.match(hook, /cursorRef\.current = signal\.nextAfterCursor;/,
    "after_cursor must advance to the page's next_cursor VERBATIM");
  assert.match(hook, /setCursor\(signal\.nextAfterCursor\);/,
    "the displayed live cursor is the same verbatim position");
  /* The baseline comes from the state read's through_cursor — never a
     locally invented position (0 only for the honest no-graph case, as a
     pure change-signal start). */
  assert.match(hook, /view\?\.kind === "graph" && view\.throughCursor != null\s*\n?\s*\? view\.throughCursor/,
    "a live graph's watch must baseline from its through_cursor verbatim");
  /* A dropped position re-baselines from a fresh state read (reconnect
     re-fetches rather than guessing). */
  assert.match(hook, /if \(cursorRef\.current == null\) \{\s*\n\s*await baseline\(\);/,
    "a null position must re-baseline from workflow_graph_state");
  /* u64 precision: cursors are decimal STRINGS end to end. The no-graph
     baseline is the string "0", and neither the hook nor the model ever
     numeric-parses a cursor — Number() would silently collapse
     9007199254740993 to 9007199254740992 and replay the wrong span. */
  assert.ok(hook.includes(': "0";'),
    "the no-graph baseline must be the decimal string \"0\", never the number 0");
  assert.doesNotMatch(hook, /Number\(|parseInt\(|parseFloat\(/,
    "the hook must never numeric-parse a cursor");
  const model = read("./workflowGraphModel.js");
  assert.match(model, /BigInt\(/,
    "cursor comparisons must be BigInt over the decimal strings, never JS number math");
  assert.doesNotMatch(model, /Number\(|parseInt\(|parseFloat\(/,
    "the model must never numeric-parse a cursor");
});

test("[pin] settle-once unavailable: a feature-gated daemon stops every dispatch", () => {
  const hook = read("./useWorkflowGraph.js");
  assert.match(hook, /workflowGraphUnavailableFromError\(thrown\)/,
    "failures must be classified through the shared unavailable helper");
  assert.ok((hook.match(/if \(!enabled \|\| !sessionId \|\| unavailableRef\.current\) return null;/g) || []).length >= 2,
    "both invokes must refuse to dispatch once unavailable settles");
  assert.match(hook, /if \(cancelled \|\| unavailableRef\.current\) return;/,
    "the poll loop must stop once unavailable settles — no retry spam");
});

test("[pin] SessionSurface mounts the Graph view off the view toggle, display-only, unread kept distinct", () => {
  const surface = read("./SessionSurface.jsx");
  assert.match(surface, /import WorkflowGraphView from "\.\/WorkflowGraphView\.jsx"/,
    "SessionSurface must import WorkflowGraphView");
  assert.ok(surface.includes('selectView("graph")'),
    "the view toggle must offer the Graph mode");
  assert.ok(surface.includes('mode === "graph" && session.id !== "draft"'),
    "the graph view mounts only for a real session in graph mode");
  assert.ok(surface.includes("entry={workflowGraphBySession[session.id]}"),
    "the view shows only the workflow_graph_state read for the session");
  /* An unseen state read must stay undefined — collapsing it would
     fabricate a "no live graph" claim for a state we never read. */
  assert.doesNotMatch(surface, /workflowGraphBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "the entry prop must never default an unseen read");
  /* Entering the view starts the hook's watch; leaving stops it. */
  assert.ok(surface.includes('(viewModes[id] || "ui") !== "graph"'),
    "the watch effect must key off the graph view mode");
  assert.ok(surface.includes('onWatchWorkflowGraph?.(id)'),
    "entering the graph view must start the watch for the active session");
  assert.ok(surface.includes('onWatchWorkflowGraph?.("")'),
    "leaving the graph view must stop the watch");
});

test("[pin] AppShell owns useWorkflowGraph beside useFleet and feeds the surface", () => {
  const shell = read("../app/AppShell.jsx");
  assert.match(shell, /import \{ useWorkflowGraph \} from "\.\.\/sessions\/useWorkflowGraph\.js"/,
    "AppShell must import useWorkflowGraph");
  assert.match(shell, /const workflowGraphApi = useWorkflowGraph\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must call useWorkflowGraph gated on authentication");
  for (const prop of [
    "workflowGraphBySession={workflowGraphApi.graphBySession}",
    "workflowGraphCursor={workflowGraphApi.cursor}",
    "workflowGraphEvents={workflowGraphApi.recentEvents}",
    "workflowGraphError={workflowGraphApi.error}",
    "workflowGraphUnavailable={workflowGraphApi.unavailable}",
    "onWatchWorkflowGraph={workflowGraphApi.startWatch}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
});

test("[pin] the view renders the honest wording: fence, no-live-graph vs not-read, unknown activity, unavailable", () => {
  const view = read("./WorkflowGraphView.jsx");
  /* THE fence badge: ast_digest verbatim, "as of", never recomputed. */
  assert.ok(view.includes("ast digest (fence)"),
    "the fence badge must name ast_digest as the topology fence");
  assert.ok(view.includes("as of this digest"),
    "the fence wording must say the topology is as-of the digest");
  assert.ok(view.includes("never recomputed locally"),
    "the fence wording must disclaim local recomputation");
  assert.ok(view.includes("entry.astDigest ??"),
    "an absent digest must render typed absence, never a computed value");
  /* Unread and none are DISTINCT surfaces. */
  assert.ok(view.includes("Workflow graph not read yet."),
    "an unseen read renders not-read-yet");
  assert.ok(view.includes("No live workflow graph for this session."),
    "a null state renders the honest no-live-graph wording");
  assert.match(view, /entry\?\.kind === "none"/,
    "only an actual read that said null may claim no-live-graph");
  assert.match(view, /entry == null && \(/,
    "the unread hint must key off the entry being absent, not kind none");
  /* Unknown journal facts render as unrecognized activity, verbatim. */
  assert.ok(view.includes("unrecognized activity"),
    "an unknown event must render as an unrecognized activity");
  assert.match(view, /event\.kind === "unknown"/,
    "the unknown branch must key off the model's preserved kind");
  assert.ok(view.includes("event.typeRaw"),
    "the unknown activity must show the daemon's raw type verbatim");
  /* Per-node state honesty + unpublished-edges honesty. */
  assert.ok(view.includes("state not published"),
    "a node without a published state admits it, never guesses");
  assert.ok(view.includes("Topology edges not published"),
    "an ast without an edge list is not-published, never a zero-edge topology");
  /* Unavailable is its own surface. */
  assert.ok(view.includes("unavailable on this daemon"),
    "the feature-gated state renders honestly");
  /* Display-only: no dispatches of any kind. */
  assert.doesNotMatch(view, /onClick|onChange|invoke\(/,
    "the graph view is display-only — it dispatches nothing");
});
