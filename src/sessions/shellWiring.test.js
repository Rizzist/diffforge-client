import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function frontendSources(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...frontendSources(path));
    if (entry.isFile()
      && /\.(?:js|jsx|mjs)$/.test(entry.name)
      && !/\.test\.(?:js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test("[pin] the three shell commands and four push names live only in approved shell hooks", () => {
  const hook = read("./useShells.js");
  const panel = read("./ShellsPanel.jsx");
  const sources = frontendSources(SRC_ROOT);
  const commands = ["shell_list", "shell_close", "shell_exec"];
  const events = ["shell-opened", "shell-state", "shell-closed", "shell-output"];
  const eventOwners = {
    "shell-opened": ["sessions/useShells.js"],
    "shell-state": ["sessions/useShells.js", "sessions/useSshPty.js"],
    "shell-closed": ["sessions/useShells.js", "sessions/useSshPty.js"],
    "shell-output": ["sessions/useShells.js", "sessions/useSshPty.js"],
  };

  assert.match(hook, /invoke\("shell_list", \{ session_id: sessionId \}\)/,
    "shell_list must use the pinned session_id key");
  assert.match(hook, /invoke\("shell_close", \{ shell_id: id \}\)/,
    "shell_close must use the pinned shell_id key");
  assert.match(hook, /const payload = \{ session_id: sessionId, command: body \};/,
    "shell_exec must start with the pinned required snake_case keys");
  assert.match(hook, /payload\.branch_id = branchId;/,
    "a present branch id must use branch_id");
  assert.match(hook, /payload\.cwd = cwd\.trim\(\);/,
    "a present cwd must use cwd");
  assert.match(hook, /invoke\("shell_exec", payload\)/,
    "shell_exec must dispatch the omission-preserving payload");

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `useShells must own exactly one ${command} dispatch`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/useShells.js"],
      `${command} must be invoked only from useShells.js`);
  }

  for (const eventName of events) {
    assert.equal((hook.match(new RegExp(`listen\\("${eventName}"`, "g")) || []).length, 1,
      `${eventName} must be listened to exactly once`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(eventName))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, eventOwners[eventName],
      `${eventName} must stay centralized in its approved shell hooks`);
  }

  assert.doesNotMatch(panel, /invoke\(/,
    "ShellsPanel must remain presentational");
});

test("[pin] close and exec are receipt-first, shell state is push/row-only, and unavailable settles once", () => {
  const hook = read("./useShells.js");
  const closeStart = hook.indexOf("const close = useCallback");
  const execStart = hook.indexOf("const exec = useCallback", closeStart);
  const outputStart = hook.indexOf("const handleOutput", execStart);
  const listenerStart = hook.indexOf("useEffect(() => {", outputStart);
  const closeBlock = hook.slice(closeStart, execStart);
  const execBlock = hook.slice(execStart, hook.indexOf("const handleShellEvent", execStart));
  const outputBlock = hook.slice(outputStart, listenerStart);

  assert.ok(closeBlock.indexOf('await invoke("shell_close"')
    < closeBlock.indexOf("setCloseOutcomeByShell"),
  "close UI facts must land only after the daemon receipt resolves");
  assert.ok(closeBlock.indexOf('await invoke("shell_close"')
    < closeBlock.indexOf("commitPublishedShell"),
  "a close must not update the registry before its returned row");
  assert.doesNotMatch(closeBlock, /state:\s*["']closed["']/,
    "the close path must never manufacture closed state");

  assert.ok(execBlock.indexOf('await invoke("shell_exec"')
    < execBlock.indexOf("setExecReceiptBySession"),
  "exec UI facts must land only after the daemon receipt resolves");
  assert.doesNotMatch(outputBlock, /setBySession|commitPublishedShell/,
    "output activity must never infer shell lifecycle state");

  assert.match(hook, /if \(unavailableRef\.current\) return;[\s\S]*unavailableRef\.current = true;/,
    "markUnavailable must settle only once");
  assert.match(hook,
    /const list = useCallback[\s\S]*?if \(!enabled \|\| !sessionId \|\| unavailableRef\.current\) return null;/,
    "list must stop dispatching after unavailable settles");
  assert.match(hook,
    /const close = useCallback[\s\S]*?if \(!enabled \|\| !id \|\| unavailableRef\.current\) return null;/,
    "close must stop dispatching after unavailable settles");
  assert.match(hook,
    /const exec = useCallback[\s\S]*?if \(!enabled \|\| !sessionId \|\| !body\.trim\(\) \|\| unavailableRef\.current\) return null;/,
    "exec must stop dispatching after unavailable settles");
});

test("[pin] AppShell owns useShells and SessionSurface mounts the per-session Shells view", () => {
  const shell = read("../app/AppShell.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(shell, /import \{ useShells \} from "\.\.\/sessions\/useShells\.js"/);
  assert.match(shell,
    /const shellRegistryApi = useShells\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must own one auth-gated shell hook");
  for (const prop of [
    "shellRegistryBySession={shellRegistryApi.bySession}",
    "shellOutputByShell={shellRegistryApi.outputByShell}",
    "shellCloseOutcomeByShell={shellRegistryApi.closeOutcomeByShell}",
    "shellExecReceiptBySession={shellRegistryApi.execReceiptBySession}",
    "shellClosingByShell={shellRegistryApi.closingByShell}",
    "shellExecutingBySession={shellRegistryApi.executingBySession}",
    "shellRegistryError={shellRegistryApi.error}",
    "shellRegistryLoading={shellRegistryApi.loading}",
    "shellRegistryUnavailable={shellRegistryApi.unavailable}",
    "onLoadShells={shellRegistryApi.list}",
    "onCloseShell={shellRegistryApi.close}",
    "onExecShell={shellRegistryApi.exec}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }

  assert.match(surface, /import ShellsPanel from "\.\/ShellsPanel\.jsx"/);
  assert.ok(surface.includes('selectView("shells")'),
    "the per-session view toggle must offer Shells");
  assert.ok(surface.includes('(viewModes[id] || "ui") !== "shells"'),
    "the registry list must be gated on entering Shells");
  assert.ok(surface.includes("onLoadShells?.(id)"),
    "entering Shells must list that session's registry");
  assert.match(surface, /mode === "shells" && session && session\.id !== "draft"/,
    "ShellsPanel must mount only for a real session in Shells mode");
  assert.ok(surface.includes("<ShellsPanel"));
  assert.ok(surface.includes("shells={shellRegistryBySession[session.id]}"),
    "the panel must receive the selected session's unread-or-published registry");
  assert.doesNotMatch(surface, /shellRegistryBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "an unread shell registry must not collapse into an empty list");
});

test("[pin] the panel states the transient boundary and offers no earlier-output affordance", () => {
  const panel = read("./ShellsPanel.jsx");
  const hook = read("./useShells.js");

  assert.ok(panel.includes("Live output is connection-transient."),
    "the output surface must name connection-transient delivery");
  assert.ok(panel.includes("Buffered output starts when this subscription began"),
    "the output surface must name its capture boundary");
  assert.ok(panel.includes("output before this point was not captured"),
    "the output surface must admit missed prior output");
  assert.doesNotMatch(panel, /load earlier|replay output/i,
    "the panel must not offer nonexistent earlier output");
  assert.ok(hook.includes("const OUTPUT_ENTRY_CAP = 200;"),
    "per-shell output must have a bounded entry count");
  assert.ok(hook.includes("[id]: boundedOutputView(current[id], { ...payload, id })"),
    "each daemon shell id must own its separate bounded buffer");
});
