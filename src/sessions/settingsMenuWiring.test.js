import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* F2 + F2-repair + F2.1 regression pins: the session view toggle keeps ONLY
   Chat/Shell/Traj as tabs; the nine relocated SDK surfaces live behind the
   Settings (gear) menu, each entry dispatching the exact selectView mode its
   tab did behind the exact draft guard its tab had; the shared menu panel
   (SessionSettingsMenu) stays MOUNTED while dismissed so the relocated
   Loom/Workflow editors keep their drafts (verify P2); an active space
   renders the same view chrome for its focused member (verify P1); and the
   header is one line with persona + workflow chip relocated into the menu
   (F2.1). Source pins, matching the house wiring-test idiom (node --test
   has no DOM; the JSX is the wiring authority — the mounted-while-closed
   behavior itself is pinned in sessionWindowBreakout.test.js's rendered
   harness). */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const surface = () => read("./SessionSurface.jsx");
const menuModule = () => read("./SessionSettingsMenu.jsx");
const spaceSurface = () => read("./SpaceSurface.jsx");

/* The segmented toggle markup in SessionSurface. */
function toggleBlockOf(source) {
  const start = source.indexOf("<SessionViewToggle");
  const end = source.indexOf("</SessionViewToggle>", start);
  assert.ok(start !== -1 && end > start, "the surface toggle must render");
  return source.slice(start, end);
}

/* The nine relocated entries, built for the menu-owning session. */
function entriesBlockOf(source) {
  const start = source.indexOf("const settingsMenuEntriesFor = (session) => {");
  const end = source.indexOf("const floatingControls", start);
  assert.ok(start !== -1 && end > start, "the settings menu entries builder must exist");
  return source.slice(start, end);
}

const RELOCATED = [
  ["fleet", "Fleet"],
  ["peers", "Peers"],
  ["shells", "Shells"],
  ["capabilities", "Hooks &amp; Tools"],
  ["sshProfiles", "SSH Profiles"],
  ["providers", "Providers"],
  ["monitors", "Monitors"],
  ["checkpoints", "History"],
  ["graph", "Graph"],
];

test("[pin] the view toggle keeps exactly Chat, Shell, Traj as static tabs", () => {
  const toggle = toggleBlockOf(surface());
  /* Three static tabs plus the one dynamic panel-tab template. */
  assert.equal((toggle.match(/role="tab"/g) || []).length, 4,
    "the tablist must hold Chat, Shell, Traj and the panel-tab template only");
  for (const dispatch of ['selectView("ui")', 'selectView("terminal")', 'selectView("trajectory")']) {
    assert.ok(toggle.includes(dispatch), `the toggle must keep the ${dispatch} tab`);
  }
  for (const [mode, label] of RELOCATED) {
    assert.ok(!toggle.includes(`selectView("${mode}")`),
      `the ${mode} dispatch must not remain a tab`);
    assert.ok(!toggle.includes(`<span>${label}</span>`),
      `the ${label} label must not remain in the tab bar`);
  }
  /* The "+" panel affordance survives, draft-guarded as before. */
  const addIndex = toggle.indexOf("<SegAddButton");
  assert.notEqual(addIndex, -1, "the + affordance must remain in the toggle");
  const addGuard = toggle.lastIndexOf('session.id !== "draft"', addIndex);
  assert.ok(addGuard !== -1 && addIndex - addGuard < 80,
    "the + affordance must keep its draft guard");
});

test("[pin] all nine relocated surfaces stay reachable via the Settings menu with exact dispatches", () => {
  const entries = entriesBlockOf(surface());
  for (const [mode, label] of RELOCATED) {
    assert.equal((entries.match(new RegExp(`selectView\\("${mode}"\\)`, "g")) || []).length, 1,
      `the menu must dispatch selectView("${mode}") exactly once`);
    assert.ok(entries.includes(`<span>${label}</span>`),
      `the menu must label the ${mode} entry ${label}`);
  }
  assert.equal((entries.match(/role="menuitem"/g) || []).length, RELOCATED.length,
    "the menu must hold exactly the nine relocated entries as menuitems");
  /* Every entry closes the menu after dispatching. */
  assert.equal((entries.match(/closeSettingsMenu\(\);/g) || []).length, RELOCATED.length,
    "each entry must close the menu after dispatching its view");
  /* SSH keeps its two-mode active state riding the one entry. */
  assert.ok(entries.includes('["sshProfiles", "sshPty"].includes(modeFor(session.id))'),
    "the SSH entry must stay active for both sshProfiles and sshPty modes");
  /* The entries ride into the shared panel as children of the ONE mount. */
  assert.match(surface(),
    /\{settingsMenuSession \? settingsMenuEntriesFor\(settingsMenuSession\) : null\}/,
    "the entries must ride the shared menu mount for the menu-owning session");
});

test("[pin] every relocated entry keeps its draft guard inside the menu", () => {
  const entries = entriesBlockOf(surface());
  /* The original tabs' guards, verbatim: seven plain, two with the
     session && prefix (Monitors, History). */
  assert.equal((entries.match(/\{session\.id !== "draft" && \(/g) || []).length, 7,
    "seven entries keep the plain draft guard");
  assert.equal((entries.match(/\{session && session\.id !== "draft" && \(/g) || []).length, 2,
    "Monitors and History keep their session && draft guards");
});

test("[pin] the gear anchors the shared menu with active state, aria, and Escape dismissal", () => {
  const source = surface();
  const menu = menuModule();
  /* One authority names the relocated modes; the gear's active state derives
     from the same selectView modes the entries dispatch. */
  const modesStart = source.indexOf("const SETTINGS_MENU_MODES = [");
  assert.notEqual(modesStart, -1, "SETTINGS_MENU_MODES must be declared");
  const modesBlock = source.slice(modesStart, source.indexOf("];", modesStart));
  for (const [mode] of RELOCATED) {
    assert.ok(modesBlock.includes(`"${mode}"`), `SETTINGS_MENU_MODES must list ${mode}`);
  }
  assert.ok(modesBlock.includes('"sshPty"'),
    "SETTINGS_MENU_MODES must include sshPty so the gear stays lit in the PTY view");
  assert.match(source,
    /const settingsViewActive = Boolean\(session\)\s*&& activeTabIsChat\s*&& SETTINGS_MENU_MODES\.includes\(modeFor\(session\.id\)\)/,
    "the gear's active state must derive from the relocated-mode list");
  const gearStart = source.indexOf('aria-label="Agent settings"');
  assert.notEqual(gearStart, -1, "the gear button must be labeled Agent settings");
  const gear = source.slice(source.lastIndexOf("<SessionViewButton", gearStart), gearStart + 400);
  assert.ok(gear.includes('data-active={settingsViewActive ? "true" : undefined}'),
    "the gear must show the active state when a relocated view is current");
  assert.ok(gear.includes('aria-haspopup="menu"') && gear.includes("aria-expanded={settingsMenuOpen}"),
    "the gear must carry aria-haspopup/aria-expanded");
  assert.ok(!gear.includes('role="tab"'),
    "the gear is a menu anchor, never a tab");
  /* The shared panel is a role=menu portal with Escape + outside dismissal. */
  assert.match(menu, /role="menu"/);
  assert.match(menu, /event\.key === "Escape"[\s\S]{0,40}onDismiss\?\.\(\)/,
    "Escape must dismiss the Settings menu");
  assert.match(menu, /panelRef\.current\?\.contains\(event\.target\)/,
    "outside mousedown must dismiss the Settings menu");
});

test("[pin] verify P2: dismissing the menu hides it — the Loom/Workflow editors stay mounted", () => {
  const menu = menuModule();
  /* The portal is unconditional; `open` gates visibility only. */
  assert.match(menu, /return createPortal\(/,
    "the panel portal must render unconditionally");
  assert.doesNotMatch(menu, /open\s*&&\s*createPortal/,
    "the portal must never be conditioned on open");
  assert.doesNotMatch(menu, /\{open &&/,
    "no menu content may mount only while open");
  assert.doesNotMatch(menu, /return null/,
    "the menu component must never bail out of rendering — closed is CSS-only");
  assert.ok(menu.includes('data-open={open ? "true" : "false"}'),
    "open must map to a visibility attribute, not a mount boundary");
  assert.match(menu, /&\[data-open="false"\]\s*\{\s*display: none;/,
    "the closed panel hides via display:none");
  /* Both stateful sections live inside that always-mounted panel. */
  const panelStart = menu.indexOf("<SettingsMenuPanel");
  const panelEnd = menu.indexOf("</SettingsMenuPanel>");
  const panel = menu.slice(panelStart, panelEnd);
  assert.ok(panel.includes("<LoomRailSection"),
    "the Agent Types (Loom) section must render inside the always-mounted panel");
  assert.ok(panel.includes("<WorkflowRailSection"),
    "the Workflows section must render inside the always-mounted panel");
  /* The editors' volatile state is still component-local — retention comes
     from the mount discipline, not from lifted copies. */
  assert.ok(read("./WorkflowRailSection.jsx").includes('const [sourceDraft, setSourceDraft] = useState("")'),
    "the workflow register draft remains component-local");
  /* Both hosts mount the panel unconditionally (open is a prop, not a guard). */
  for (const [name, host] of [["SessionSurface", surface()], ["SpaceSurface", spaceSurface()]]) {
    const mount = host.indexOf("<SessionSettingsMenu");
    assert.notEqual(mount, -1, `${name} must mount SessionSettingsMenu`);
    const before = host.slice(Math.max(0, host.lastIndexOf("\n", host.lastIndexOf("\n", mount) - 1)), mount);
    assert.doesNotMatch(before, /&&\s*\($/m,
      `${name} must not gate the menu mount behind a condition`);
  }
  assert.ok(surface().includes("open={Boolean(settingsMenuSession)}"),
    "SessionSurface must drive visibility through the open prop");
  assert.ok(spaceSurface().includes("open={settingsMenuOpen}"),
    "SpaceSurface must drive visibility through the open prop");
});

test("[pin] verify P1: an active space renders the focused member's view controls and the gear", () => {
  const space = spaceSurface();
  /* The SAME chrome, not a fork: imported from the shared module. */
  assert.match(space,
    /import SessionSettingsMenu, \{\s*SessionViewButton,\s*SessionViewToggle,\s*\} from "\.\/SessionSettingsMenu\.jsx"/,
    "SpaceSurface must reuse the shared toggle components");
  for (const kind of ["chat", "shell", "trajectory"]) {
    assert.ok(space.includes(`onSetLeafView?.(focusedLeaf.id, "${kind}")`),
      `the space toggle must dispatch the focused leaf to the ${kind} view`);
    assert.ok(space.includes(`data-active={focusedLeaf.viewKind === "${kind}" ? "true" : undefined}`),
      `the ${kind} button's active state must derive from the leaf's own viewKind`);
  }
  assert.ok(space.includes('aria-label="Agent settings"'),
    "the space header must carry the Settings gear");
  assert.ok(space.includes("session={focusedSession}"),
    "the space menu's session rows must follow the focused member");
  /* The view flip is a real spaces-model op, persisted like every layout op. */
  const hook = read("./useSpaces.js");
  assert.match(hook,
    /const setLeafView = useCallback\(\(leafId, viewKind\) => \{\s*mutateSpace\(\(state\) => setSpaceLeafViewKind\(state, leafId, viewKind\)\);/,
    "useSpaces must route the flip through the one mutation door");
  const shell = read("../app/AppShell.jsx");
  assert.ok(shell.includes("onSetLeafView={spacesApi.setLeafView}"),
    "AppShell must wire the leaf view dispatch to SpaceSurface");
  /* The space menu receives the same agent-settings inputs. */
  for (const prop of [
    "loomAgentTypes={loomApi.agentTypes}",
    "workflowCatalog={workflowApi.catalog}",
    "loomPersonaBySession={loomApi.personaBySession}",
  ]) {
    const first = shell.indexOf(prop);
    assert.ok(first !== -1 && shell.indexOf(prop, first + 1) !== -1,
      `AppShell must pass ${prop} to both SpaceSurface and SessionSurface`);
  }
});

test("[pin] F2.1: one-line header — persona and workflow chip live in the Settings menu", () => {
  const source = surface();
  const menu = menuModule();
  /* The header row and its control cluster never wrap; long names ellipsize
     inside the title block. */
  const headerCss = source.slice(source.indexOf("const WorkHeader = styled"),
    source.indexOf("`;", source.indexOf("const WorkHeader = styled")));
  assert.ok(headerCss.includes("flex-wrap: nowrap"), "the header must be a single line");
  const controlsCss = source.slice(source.indexOf("const FloatingControls = styled"),
    source.indexOf("`;", source.indexOf("const FloatingControls = styled")));
  assert.ok(controlsCss.includes("flex-wrap: nowrap"), "the control cluster must not wrap");
  const titleCss = source.slice(source.indexOf("const TitleRow = styled"),
    source.indexOf("`;", source.indexOf("const TitleRow = styled")));
  assert.ok(titleCss.includes("min-width: 0") && titleCss.includes("overflow: hidden"),
    "the title block must shrink and ellipsize instead of wrapping");
  /* The header no longer hosts either relocated control. */
  assert.ok(!source.includes("<SessionPersonaSelect"),
    "SessionSurface must no longer mount the persona select");
  assert.ok(!source.includes("<WorkflowStatusChip"),
    "SessionSurface must no longer mount the workflow chip");
  /* Both render in the menu with their original props and guards; the
     unseen-receipt honesty survives (no defaulting of either read). */
  const sessionRow = menu.slice(menu.indexOf('{session && session.id !== "draft" && ('),
    menu.indexOf('<SettingsMenuSection data-section="loom">'));
  assert.ok(sessionRow.includes("<SessionPersonaSelect"),
    "the persona select must render in the menu, draft-gated");
  assert.ok(sessionRow.includes("binding={loomPersonaBySession[session.id]}")
    && sessionRow.includes("agentTypes={loomAgentTypes}")
    && sessionRow.includes("onSelect={onSelectPersona}")
    && sessionRow.includes("sessionId={session.id}"),
    "the persona select must keep its identical props");
  assert.ok(sessionRow.includes("<WorkflowStatusChip")
    && sessionRow.includes("statusView={workflowStatusBySession[session.id]}")
    && sessionRow.includes("unavailable={workflowUnavailable}"),
    "the workflow chip must keep its identical display-only props");
  assert.doesNotMatch(menu, /loomPersonaBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "an unseen persona receipt must never be defaulted");
  assert.doesNotMatch(menu, /workflowStatusBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "an unseen graph_status read must never be defaulted");
  /* Persona sits adjacent to the Agent Types section it belongs with. */
  const personaMount = menu.indexOf("<SessionPersonaSelect");
  const loomMount = menu.indexOf("<LoomRailSection");
  assert.ok(personaMount !== -1 && loomMount > personaMount && loomMount - personaMount < 1200,
    "the persona select must sit adjacent to the Agent Types section");
});

test("[pin] the rail renders only the spaces section and the session groups, no orphaned imports", () => {
  const rail = read("./SessionsRail.jsx");
  assert.ok(rail.includes("<SpacesRailSection"), "the spaces section stays in the rail");
  assert.ok(!rail.includes("Loom"),
    "no Loom import, prop, or render may remain in the rail");
  assert.ok(!rail.includes("Workflow") && !rail.includes("workflow"),
    "no workflow import, prop, or render may remain in the rail");
  /* Between the spaces section and the first session group nothing else
     renders: the rail's organizer is spaces + the sessions list. */
  const area = rail.slice(rail.indexOf("<SessionListArea>"), rail.indexOf("</SessionListArea>"));
  const between = area.slice(
    area.indexOf("/>", area.indexOf("<SpacesRailSection")) + 2,
    area.indexOf("{pinned.length > 0 && ("),
  );
  assert.equal(between.trim(), "",
    "only spaces and the session groups may render in the rail's list area");
  /* Loom/workflow capabilities remain reachable — via the shared menu. */
  const menu = menuModule();
  assert.ok(menu.includes("<LoomRailSection"),
    "the Agent Types (Loom) section must render inside the Settings menu");
  assert.ok(menu.includes("<WorkflowRailSection"),
    "the Workflows section must render inside the Settings menu");
});
