import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/* Source-introspection wiring pins for the subagent fleet UI (P2). These
   guard consumer wiring the pure fleetModel tests cannot observe: the five
   fleet commands with their snake_case arg keys living ONLY in
   useFleet.js (the single reconcile point), the SessionSurface Fleet view
   mount fed from AppShell's useFleet, the authoritative child transcript
   reuse, and the house-law honesty wording (folded/bounded, no-data,
   fallback labeling, unread ≠ empty). */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const srcRoot = fileURLToPath(new URL("../", import.meta.url));

function productionJsSources(directory = srcRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionJsSources(path);
    if (!/\.(?:js|jsx|mjs)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

test("[pin] useFleet invokes the five fleet commands with snake_case arg keys", () => {
  const source = read("./useFleet.js");

  assert.match(source, /invoke\("session_fleet", \{ session_id: sessionId \}\)/,
    "session_fleet must key by session_id");

  const observeStart = source.indexOf('invoke("session_observe", {');
  assert.notEqual(observeStart, -1, "session_observe must be invoked");
  const observeBlock = source.slice(observeStart, source.indexOf("})", observeStart));
  for (const key of [
    "session_id: childSessionId",
    "last_event_limit: lastEventLimit",
    "metadata_only: metadataOnly",
  ]) {
    assert.ok(observeBlock.includes(key), `session_observe must pass ${key}`);
  }

  const batchStart = source.indexOf('invoke("session_observe_batch", {');
  assert.notEqual(batchStart, -1, "session_observe_batch must be invoked");
  const batchBlock = source.slice(batchStart, source.indexOf("})", batchStart));
  for (const key of [
    "session_ids: ids",
    "last_event_limit: lastEventLimit",
    "metadata_only: metadataOnly",
  ]) {
    assert.ok(batchBlock.includes(key), `session_observe_batch must pass ${key}`);
  }

  const messageStart = source.indexOf('invoke("agent_message", {');
  assert.notEqual(messageStart, -1, "agent_message must be invoked");
  const messageBlock = source.slice(messageStart, source.indexOf("})", messageStart));
  for (const key of ["session_id: sessionId", "agent: agentId", "text: body"]) {
    assert.ok(messageBlock.includes(key), `agent_message must pass ${key}`);
  }

  const cancelStart = source.indexOf('invoke("agent_cancel", {');
  assert.notEqual(cancelStart, -1, "agent_cancel must be invoked");
  const cancelBlock = source.slice(cancelStart, source.indexOf("})", cancelStart));
  for (const key of ["session_id: sessionId", "agent: agentId"]) {
    assert.ok(cancelBlock.includes(key), `agent_cancel must pass ${key}`);
  }
  assert.ok(!cancelBlock.includes("text:"),
    "agent_cancel accepts only the real parent session + agent coordinates");
});

test("[pin] every fleet invoke lives in useFleet.js — components are presentational", () => {
  const hook = read("./useFleet.js");
  for (const command of [
    "session_fleet", "session_observe", "session_observe_batch", "agent_message", "agent_cancel",
  ]) {
    assert.ok(hook.includes(`invoke("${command}"`), `useFleet must own ${command}`);
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `exactly one ${command} dispatch`);
  }
  for (const consumer of ["./FleetPanel.jsx", "./FleetChildTranscript.jsx"]) {
    const text = read(consumer);
    assert.ok(!text.includes("invoke("),
      `${consumer} must not call invoke at all — every dispatch rides useFleet callbacks`);
  }
});

test("[pin] agent_cancel exists only in useFleet and its gate cannot disable other fleet commands", () => {
  const hook = read("./useFleet.js");
  assert.equal((hook.match(/invoke\("agent_cancel"/g) || []).length, 1,
    "agent_cancel has exactly one centralized dispatch");
  const owners = productionJsSources()
    .filter(({ source }) => source.includes('invoke("agent_cancel"'))
    .map(({ path }) => relative(srcRoot, path).replaceAll("\\", "/"));
  assert.deepEqual(owners, ["sessions/useFleet.js"],
    "no other production JS/JSX module may dispatch agent_cancel");
  assert.match(hook, /const cancelUnavailableRef = useRef\(false\)/,
    "cancel has an independent settle-once feature gate");
  assert.match(hook, /cancelUnavailableRef\.current = true/,
    "a feature-gated cancel settles unavailable once");
  assert.match(hook, /!agentId \|\| cancelUnavailableRef\.current/,
    "settled cancel unavailability must stop future cancel dispatches");
  assert.doesNotMatch(hook, /cancelUnavailableRef\.current[\s\S]{0,160}markUnavailable\(/,
    "cancel unavailability must not mark the other fleet commands unavailable");
  assert.equal((hook.match(/unavailableRef\.current\) return null;/g) || []).length, 4,
    "the original four commands retain their independent shared gate");
});

test("[pin] dispatches carry only REAL coordinates: batch bound 1..64, message trims to non-empty", () => {
  const source = read("./useFleet.js");
  /* observe_batch: the SDK's 1..=64 bound is enforced BEFORE the wire. */
  assert.match(source, /ids\.length < 1 \|\| ids\.length > 64/,
    "an out-of-range observe batch must never reach the wire");
  assert.match(source, /filter\(\(id\) => typeof id === "string" && id\.length > 0\)/,
    "only real string session ids ride the batch");
  /* agent_message: only a real (session_id, agent, text) triple dispatches. */
  assert.match(source, /if \(!enabled \|\| !sessionId \|\| !agentId \|\| !body \|\| unavailableRef\.current\) return null;/,
    "agent_message must be guarded on all three real coordinates AND unavailability");
  /* settle-once unavailability: every callback checks the ref. */
  assert.equal((source.match(/unavailableRef\.current\) return null;/g) || []).length, 4,
    "all four callbacks must stop dispatching once the daemon settled unavailable");
  assert.match(source, /fleetUnavailableFromError\(thrown\)/,
    "feature-gate errors must settle through fleetUnavailableFromError");
});

test("[pin] SessionSurface mounts the Fleet view: toggle + FleetPanel + child transcript, draft-guarded", () => {
  const surface = read("./SessionSurface.jsx");
  assert.match(surface, /import FleetPanel from "\.\/FleetPanel\.jsx"/,
    "SessionSurface must import FleetPanel");
  assert.match(surface, /import FleetChildTranscript from "\.\/FleetChildTranscript\.jsx"/,
    "SessionSurface must import FleetChildTranscript");

  /* The segmented toggle grows a Fleet tab, draft-guarded like Traj. */
  const fleetButton = surface.indexOf('selectView("fleet")');
  assert.notEqual(fleetButton, -1, "the view toggle must offer the fleet view");
  const buttonGuard = surface.lastIndexOf('session.id !== "draft"', fleetButton);
  assert.ok(buttonGuard !== -1 && fleetButton - buttonGuard < 400,
    "the Fleet toggle must be draft-guarded");

  /* The mount rides the per-session view mode and stays draft-guarded. */
  const mount = surface.indexOf("<FleetPanel");
  assert.notEqual(mount, -1, "FleetPanel must be mounted");
  const modeGuard = surface.lastIndexOf('mode === "fleet" && session.id !== "draft"', mount);
  assert.ok(modeGuard !== -1 && mount - modeGuard < 1200,
    "the fleet layer must mount only for mode 'fleet' on a real session");

  /* Selection resolves through the REAL agent id against the CURRENT tree. */
  assert.match(surface, /findFleetNode\(fleetEntry\.tree, fleetSelectedAgentId\)/,
    "the selected node must be re-resolved from the current tree by agent id");

  /* The drilldown mounts the child transcript off the resolved node. */
  const child = surface.indexOf("<FleetChildTranscript");
  assert.ok(child > mount, "FleetChildTranscript must mount inside the fleet layer");
  assert.ok(surface.includes("node={fleetSelectedNode}"),
    "the child transcript must receive the resolved fleet node");

  /* agent.message goes to the node's REAL parent session id — never an
     assumed parent. */
  assert.match(surface, /onSendAgentMessage\?\.\(node\.parentSessionId, node\.agentId, text\)/,
    "the message dispatch must use the node's real parent_session_id + agent_id");

  /* The observe batch is bounded to the SDK's 64. */
  assert.match(surface, /fleetSessionIds\(fleetEntry\.tree\)\.slice\(0, 64\)/,
    "observe-all must ride only published session ids, bounded to 64");
});

test("[pin] AppShell owns useFleet and feeds the surface", () => {
  const shell = read("../app/AppShell.jsx");
  assert.match(shell, /import \{ useFleet \} from "\.\.\/sessions\/useFleet\.js"/,
    "AppShell must import useFleet");
  assert.match(shell, /const fleetApi = useFleet\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must call useFleet gated on authentication");
  for (const prop of [
    "fleetBySession={fleetApi.fleetBySession}",
    "fleetChildDigests={fleetApi.childDigests}",
    "fleetError={fleetApi.error}",
    "fleetLoading={fleetApi.loading}",
    "fleetUnavailable={fleetApi.unavailable}",
    "onLoadFleet={fleetApi.loadFleet}",
    "onObserveFleetChild={fleetApi.observeChild}",
    "onObserveFleetBatch={fleetApi.observeBatch}",
    "onSendAgentMessage={fleetApi.sendMessage}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
});

test("[pin] the honest wording renders: folded/bounded, no-data, fallback labeling, unread ≠ empty", () => {
  const panel = read("./FleetPanel.jsx");
  /* House law 1: a folded remainder is SHOWN, never a silent leaf. */
  assert.ok(panel.includes("more not shown (bounded)"),
    "folded children must render as an explicit 'N more not shown' row");
  assert.match(panel, /node\.foldedChildren > 0 && \(/,
    "the folded row must key off the folded count itself");
  /* House law 2: a bounded snapshot says so. */
  assert.ok(panel.includes("Bounded snapshot — not the complete tree"),
    "a truncated/incomplete snapshot must be labeled bounded");
  assert.match(panel, /truncation\?\.kind === "bounded"/,
    "the banner must key off the typed truncation view");
  assert.match(panel, /rollup\.metricsComplete === false && \(/,
    "metrics_complete:false — and ONLY an explicit false — surfaces the partial-metrics marker");
  assert.ok(panel.includes("metrics partial"),
    "metrics_complete:false must surface as a partial-metrics marker");
  assert.ok(panel.includes("metrics completeness unknown"),
    "an absent completeness flag must render as unknown — never asserted partial or complete");
  assert.match(panel, /rollup\.metricsComplete == null && \(/,
    "the unknown marker must key off the tri-state null");
  /* House law 3: absence renders as no data, never zero. */
  assert.ok(panel.includes('rollup.usage != null ? compactJson(rollup.usage) : "no data"'),
    "absent usage must render as 'no data'");
  assert.ok(panel.includes('if (ms == null) return "no data";'),
    "absent elapsed must render as 'no data', never 0ms");
  assert.doesNotMatch(panel, /usage \?\? 0|elapsedMs \?\? 0|toolAttempts \?\? 0/,
    "no metric may default to zero");
  /* House law 4: the fallback label is visibly a fallback. */
  for (const consumer of ["./FleetPanel.jsx", "./FleetChildTranscript.jsx"]) {
    const text = read(consumer);
    assert.ok(text.includes("No daemon callsign — showing the agent id (client fallback)"),
      `${consumer} must label the agent-id fallback as a client fallback`);
    assert.ok(text.includes("label.fallback"),
      `${consumer} must branch on the fallback flag, never render the id as an identity`);
  }
  /* Unread, unavailable, and empty stay DISTINCT surfaces. */
  assert.ok(panel.includes("Fleet not read."), "an unread fleet has its own wording");
  assert.ok(panel.includes("No subagents."), "an available-but-empty fleet has its own wording");
  assert.ok(panel.includes("Subagent fleet is unavailable on this daemon."),
    "an unavailable fleet has its own wording");
});

test("[pin] Cancel stays receipt-first, decimal-string-safe, and honestly addressed", () => {
  const model = read("./fleetModel.js");
  const hook = read("./useFleet.js");
  const panel = read("./FleetPanel.jsx");

  assert.match(hook, /const \[cancelByAgent, setCancelByAgent\] = useState\(\{\}\)/,
    "cancel pending/receipt/error state must be per agent node");
  assert.match(hook, /pending: view\.status\.kind === "accepted"/,
    "accepted stays pending while authority still publishes a non-terminal node");
  assert.match(panel, /const eligibility = cancelEligibility\(node\)/,
    "the control must use the published-state-only model helper");
  assert.match(panel, /onCancelAgent\(node\.parentSessionId, node\.agentId\)/,
    "Cancel must dispatch with the node's real parent session + agent id");
  assert.equal((panel.match(/parent session unknown; cannot address this agent/g) || []).length, 1,
    "unknown-parent wording must live once in the shared addressing helper");
  assert.match(panel, /const addressing = nodeAddressing\(node\)/,
    "Cancel must use the shared node-addressing helper");
  assert.match(panel, /const selectedAddressing = nodeAddressing\(selectedNode\)/,
    "the message composer must use that same addressing helper");
  assert.match(panel, /requestPending = Boolean\(cancelState\?\.pending\)[\s\S]{0,80}eligibility\.kind !== "terminal"/,
    "a terminal fleet publication must end the accepted-receipt pending presentation");

  for (const wording of [
    "cancel requested (pending)",
    "already finished",
    "unrecognized cancel status:",
  ]) {
    assert.ok(panel.includes(wording), `FleetPanel must render “${wording}”`);
  }
  assert.match(panel, /terminalSeq != null &&/,
    "terminal_seq absence must omit the sequence wording");

  const cancelModelStart = model.indexOf("export function cancelReceiptView");
  assert.notEqual(cancelModelStart, -1, "cancelReceiptView must exist");
  const cancelModelBlock = model.slice(
    cancelModelStart,
    model.indexOf("export function cancelEligibility", cancelModelStart),
  );
  assert.match(cancelModelBlock, /typeof receipt\?\.terminal_seq === "string"/,
    "terminal_seq must accept the pinned string shape only");
  assert.doesNotMatch(cancelModelBlock, /Number\(|parseInt\(/,
    "terminal_seq must never pass through lossy JS number parsing");
  assert.doesNotMatch(`${hook}\n${panel}`, /Number\([^\n]*terminalSeq|parseInt\([^\n]*terminalSeq/,
    "terminal_seq consumers must show the preserved string without numeric parsing");
});

test("[pin] the child transcript is authoritative: the child session's own feed, real lineage", () => {
  const child = read("./FleetChildTranscript.jsx");
  assert.match(child, /import SessionTranscript from "\.\/SessionTranscript\.jsx"/,
    "the drilldown must reuse the shared SessionTranscript — not a resurrected thread transcript");
  assert.match(child, /<SessionTranscript session=\{\{ id: node\.sessionId \}\} \/>/,
    "the nested transcript must be keyed by the child's REAL session id");
  /* Lineage renders the published ids; an absent parent is unknown. */
  assert.ok(child.includes('under parent {node.parentSessionId ?? "unknown"}'),
    "an absent parent must render as unknown, never a guessed id");
  assert.match(child, /node\.parentAgentId != null &&/,
    "parent agent id renders only when the fleet published one");
  /* No fabricated identity anywhere near the child header. */
  assert.doesNotMatch(child, /["'`]Subagent \$|title.*=.*node\.sessionId\.slice/,
    "no title may be fabricated from an id");
  /* The observe digest is verbatim and its absence is honest. */
  assert.ok(child.includes("Not observed yet."),
    "an unfetched digest must say so, never render an empty fabricated digest");
  assert.ok(child.includes("Observe digest (session.observe — verbatim)"),
    "the digest block must name its authority");
  /* The deleted src/threads/transcript/* must stay deleted. */
  for (const consumer of ["./FleetPanel.jsx", "./FleetChildTranscript.jsx", "./useFleet.js"]) {
    assert.ok(!read(consumer).includes("threads/transcript"),
      `${consumer} must not resurrect src/threads/transcript/*`);
  }
});
