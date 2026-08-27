import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* Source-introspection wiring pins for the Loom agent-type UI (P1). These
   guard consumer wiring the pure loomModel tests cannot observe: the six
   Tauri commands with their snake_case arg keys, the rail/surface mounts,
   and the house-law honesty wording (tri-state cli presence, persona-not-
   readiness, retry-only-on-failed, no fabricated install job). */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const orderOf = (source, ...needles) => needles.map((needle) => {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `expected to find: ${needle}`);
  return index;
});

test("[pin] useLoom invokes the six loom commands with snake_case arg keys", () => {
  const source = read("./useLoom.js");
  assert.match(source, /invoke\("loom_list"\)/,
    "loom_list must be invoked with no args");
  const registerStart = source.indexOf('invoke("loom_register_agent_type"');
  const registerBlock = source.slice(
    registerStart,
    source.indexOf("registrationReceiptView(", registerStart),
  );
  for (const key of [
    "id:", "name:", "job:", "in_type:", "out_type:",
    "clis:", "apis:", "skills:", "scripts:", "color:", "glyph:",
  ]) {
    assert.ok(registerBlock.includes(key),
      `loom_register_agent_type must pass ${key.replace(":", "")}`);
  }
  assert.match(source, /invoke\("loom_install_status", \{ agent_type_id: /,
    "loom_install_status must key by agent_type_id");
  assert.match(source, /invoke\("loom_install_retry", \{ install_job_id: /,
    "loom_install_retry must key by install_job_id");
  const watchStart = source.indexOf('invoke("loom_install_watch"');
  const watchBlock = source.slice(watchStart, source.indexOf("watchOutcomeView(", watchStart));
  assert.ok(watchBlock.includes("install_job_id:") && watchBlock.includes("after_cursor:"),
    "loom_install_watch must pass install_job_id and after_cursor");
  const selectStart = source.indexOf('invoke("session_select_agent_type"');
  const selectBlock = source.slice(
    selectStart,
    source.indexOf("personaBindingView(", selectStart),
  );
  assert.ok(selectBlock.includes("session_id:") && selectBlock.includes("agent_type_id:"),
    "session_select_agent_type must pass session_id and agent_type_id");
});

test("[pin] useLoom shapes every view through loomModel and never synthesizes an install job id", () => {
  const source = read("./useLoom.js");
  for (const transform of [
    "agentTypeView", "installJobView", "installItemView",
    "registrationReceiptView", "personaBindingView",
    "retryOutcomeView", "watchOutcomeView", "loomUnavailableFromError",
  ]) {
    assert.ok(source.includes(transform), `useLoom must use loomModel's ${transform}`);
  }
  /* The receipt's install_job_id is optional; when absent there is NO job.
     No fallback may derive one from id/rev/digest. */
  assert.match(source, /view\.installJobId != null\b/,
    "an install-status read must be gated on a receipt that names a job");
  assert.doesNotMatch(source, /install_job_id:(?!\s*installJobId\b)/,
    "every install_job_id arg must be the caller's job id verbatim");
  assert.doesNotMatch(source, /digest/,
    "the hook must never touch digest (no job id can be derived from it)");
  /* Unavailable is settle-once: the guard must precede every invoke. */
  assert.match(source, /if \(unavailableRef\.current\) return/,
    "list must stop polling an unavailable daemon");
  const modelSource = read("./loomModel.js");
  assert.match(modelSource, /installJobId: receipt\?\.install_job_id \?\? null/,
    "the receipt view maps an absent install_job_id to null, not a value");
});

test("[pin] SessionsRail mounts LoomRailSection right after SpacesRailSection", () => {
  const rail = read("./SessionsRail.jsx");
  assert.match(rail, /import LoomRailSection from "\.\/LoomRailSection\.jsx"/,
    "SessionsRail must import LoomRailSection");
  const [spacesMount, loomMount, pinnedGroup] = orderOf(
    rail,
    "<SpacesRailSection",
    "<LoomRailSection",
    "{pinned.length > 0 && (",
  );
  assert.ok(spacesMount < loomMount && loomMount < pinnedGroup,
    "LoomRailSection must render after SpacesRailSection and before the session groups");
  for (const prop of [
    "agentTypes={loomAgentTypes}",
    "cliPresent={loomCliPresent}",
    "installByType={loomInstallByType}",
    "onRegister={onRegisterAgentType}",
    "onRefreshInstall={onRefreshAgentInstall}",
    "onRetryInstall={onRetryAgentInstall}",
    "unavailable={loomUnavailable}",
  ]) {
    assert.ok(rail.includes(prop), `SessionsRail must pass ${prop}`);
  }
});

test("[pin] SessionSurface mounts the persona select beside the status pill, sessions only", () => {
  const surface = read("./SessionSurface.jsx");
  assert.match(surface, /import SessionPersonaSelect from "\.\/SessionPersonaSelect\.jsx"/,
    "SessionSurface must import SessionPersonaSelect");
  const mountIndex = surface.indexOf("<SessionPersonaSelect");
  assert.notEqual(mountIndex, -1, "SessionPersonaSelect must be rendered");
  const guardIndex = surface.lastIndexOf('session && session.id !== "draft"', mountIndex);
  assert.ok(guardIndex !== -1 && mountIndex - guardIndex < 400,
    "the persona select must be guarded by session && session.id !== \"draft\"");
  const pillIndex = surface.indexOf("<StatusPill");
  assert.ok(pillIndex !== -1 && mountIndex > pillIndex && mountIndex - pillIndex < 1200,
    "the persona select must sit adjacent to the StatusPill in FloatingControls");
  assert.ok(surface.includes("binding={loomPersonaBySession[session.id]}"),
    "the surface must show only the receipt-backed binding for the session");
  /* An unseen receipt must stay undefined — collapsing it to null/false
     would fabricate a "No persona" claim for an unread binding. */
  assert.doesNotMatch(surface, /loomPersonaBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "the binding prop must never default an unseen receipt");
});

test("[pin] AppShell owns useLoom and feeds both consumers", () => {
  const shell = read("../app/AppShell.jsx");
  assert.match(shell, /import \{ useLoom \} from "\.\.\/sessions\/useLoom\.js"/,
    "AppShell must import useLoom");
  assert.match(shell, /const loomApi = useLoom\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must call useLoom gated on authentication");
  for (const prop of [
    "loomAgentTypes={loomApi.agentTypes}",
    "loomCliPresent={loomApi.cliPresent}",
    "loomInstallByType={loomApi.installByType}",
    "loomUnavailable={loomApi.unavailable}",
    "onRegisterAgentType={loomApi.register}",
    "onRefreshAgentInstall={loomApi.installStatus}",
    "onRetryAgentInstall={loomApi.retry}",
    "loomPersonaBySession={loomApi.personaBySession}",
    "onSelectPersona={loomApi.select}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
});

test("[pin] the rail section renders the honest tri-state and never fabricates presence", () => {
  const section = read("./LoomRailSection.jsx");
  assert.match(section, /cliPresence\(cliPresent, program\)/,
    "CLI badges must come from the tri-state cliPresence transform");
  assert.match(section, /cliPresenceLabel\(presence\)/,
    "the badge label must be the tri-state label (present / missing / not probed)");
  const model = read("./loomModel.js");
  assert.match(model, /hasOwnProperty\.call\(cliPresent, program\)\) return "unprobed"/,
    "a missing cli_present key must be the third state, never a probe result");
  assert.match(model, /return "not probed"/,
    "the unprobed state must have its own honest wording");
  /* No consumer may collapse the map into booleans (which would turn
     "not probed" into "missing"). */
  assert.doesNotMatch(section, /cliPresent\[[^\]]+\]\s*(?:\?\?|\|\|)\s*false/,
    "cli_present must never be defaulted to false");
  assert.doesNotMatch(section, /Boolean\(cliPresent/,
    "cli_present must never be coerced to a boolean presence claim");
});

test("[pin] install disclosure preserves raw states, retries only failed, and admits absence", () => {
  const section = read("./LoomRailSection.jsx");
  /* Unknown daemon states render their raw string. */
  assert.match(section, /installJob\.state\.raw/,
    "the raw daemon state string must reach the render");
  assert.match(section, /\(unrecognized\)/,
    "an unknown state is shown raw and marked unrecognized, never coerced");
  /* Retry is gated on the model's retryable (=== failed only). */
  const retryIndex = section.indexOf("<LoomRetryButton");
  const gateIndex = section.lastIndexOf("installJob.retryable &&", retryIndex);
  assert.ok(retryIndex !== -1 && gateIndex !== -1 && retryIndex - gateIndex < 300,
    "the Retry button must be rendered only when installJobView says retryable");
  assert.equal((section.match(/<LoomRetryButton/g) || []).length, 1,
    "there must be exactly one Retry mount, and it sits behind the retryable gate");
  /* Absence is admitted, not filled in. */
  assert.ok(section.includes("No install job for this agent type."),
    "no jobs must render as honest absence text");
  assert.ok(section.includes("Registering queues installs for:"),
    "the register editor must disclose the CLI installs registering queues");
});

test("[pin] the persona control claims binding only — never readiness or installation", () => {
  const control = read("./SessionPersonaSelect.jsx");
  assert.match(control, />Persona</, "the control must be labeled Persona");
  assert.ok(control.includes("Persona binding only"),
    "the tooltip must say it is a persona binding");
  assert.ok(control.includes("does not install anything"),
    "the tooltip must disclaim installation");
  assert.ok(control.includes("does not make the agent ready"),
    "the tooltip must disclaim readiness");
  assert.match(control, /personaSelectionView\(binding\)/,
    "the shown state must come from the three-state persona view");
  const model = read("./loomModel.js");
  assert.match(model, /agentTypeId: receipt\?\.agent_type \?\? null/,
    "an absent bound agent_type must be null, never a fabricated default");
});

test("[pin] persona placeholders are display-only and no null id ever reaches the wire", () => {
  const control = read("./SessionPersonaSelect.jsx");
  /* Three DISTINCT states: unknown (unseen receipt) is never rendered as
     "No persona" — both words must exist and hang off selection.kind. */
  assert.ok(control.includes('"Persona unknown" : "No persona"'),
    "unknown and none must render as distinct placeholder words");
  const placeholderIndex = control.indexOf('<option disabled value="">');
  assert.notEqual(placeholderIndex, -1,
    "the placeholder option must be disabled (display-only, not an action)");
  /* The change handler dispatches ONLY a real id. */
  assert.match(control, /if \(!event\.target\.value\) return;/,
    "an empty select value must never dispatch");
  const hook = read("./useLoom.js");
  /* session_select_agent_type requires a String agent_type_id: the hook
     must refuse empty ids and never pass null. */
  assert.match(hook, /if \(!sessionId \|\| !typeId \|\| unavailableRef\.current\) return null;/,
    "select must refuse an empty agent-type id");
  assert.match(hook, /agent_type_id: typeId,/,
    "select must dispatch the non-empty string id verbatim");
  assert.doesNotMatch(hook, /agent_type_id:\s*(?:null|agentTypeId \|\| null)/,
    "select must never dispatch a null agent_type_id");
});
