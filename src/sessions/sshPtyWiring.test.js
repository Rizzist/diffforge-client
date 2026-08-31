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

test("[pin] the four PTY commands and three focused listeners live in useSshPty", () => {
  const hook = read("./useSshPty.js");
  const terminal = read("./SshPtyTerminal.jsx");
  const panel = read("./SshProfilesPanel.jsx");
  const sources = frontendSources(SRC_ROOT);
  const commands = [
    "ssh_shell_open",
    "ssh_shell_input",
    "ssh_shell_resize",
    "ssh_shell_eof",
  ];
  const events = ["shell-state", "shell-closed", "shell-output"];

  assert.match(hook, /invoke\("ssh_shell_open", args\)/);
  assert.match(hook, /invoke\("ssh_shell_input", inputArgs\(shellId, data\)\)/);
  assert.match(hook, /invoke\("ssh_shell_resize", args\)/);
  assert.match(hook, /invoke\("ssh_shell_eof", \{ id: shellId \}\)/);
  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/useSshPty.js"],
      `${command} must be dispatched only by the PTY hook`);
  }

  for (const eventName of events) {
    assert.equal((hook.match(new RegExp(`listen\\("${eventName}"`, "g")) || []).length, 1,
      `${eventName} must have exactly one literal focused listener`);
    const listeners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`listen("${eventName}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(listeners, ["sessions/useShells.js", "sessions/useSshPty.js"],
      `${eventName} must stay centralized in the registry and focused PTY hooks`);
  }
  assert.match(hook,
    /listen\("haider-roster-bootstrap-changed", \(event\) => \{[\s\S]*?handleTransportPublished\(event\?\.payload \?\? \{\}\)/,
    "the published connection signal must reach the PTY capture boundary");
  assert.match(hook, /emit\("haider-roster-bootstrap-request", \{\}\)/,
    "listener installation must request the current published connection state");
  assert.doesNotMatch(`${terminal}\n${panel}`, /\blisten\(/,
    "the PTY view and profile panel must remain subscription-free");
  assert.doesNotMatch(`${terminal}\n${panel}`, /\binvoke\(/,
    "the PTY view and profile panel must remain command-free");
});

test("[pins 2 and 3] lifecycle is push-only and resize uses a changed measured grid", () => {
  const hook = read("./useSshPty.js");
  const terminal = read("./SshPtyTerminal.jsx");
  const openStart = hook.indexOf("const open = useCallback");
  const inputStart = hook.indexOf("const input = useCallback", openStart);
  const openBlock = hook.slice(openStart, inputStart);
  const outputStart = hook.indexOf("const handleOutput");
  const listenerStart = hook.indexOf("useEffect(() => {", outputStart);
  const outputBlock = hook.slice(outputStart, listenerStart);

  assert.doesNotMatch(openBlock, /setStateByShell|ptyStateView/,
    "a successful open receipt must not become lifecycle state");
  assert.doesNotMatch(outputBlock, /setStateByShell|handleState/,
    "output activity must not infer lifecycle state");
  assert.match(hook, /const handleState[\s\S]*ptyStateView\(payload, sourceEvent\)/,
    "only the listener handler projects published PTY lifecycle");

  assert.match(terminal,
    /measureTerminalGrid\(\{\s*container,\s*term,\s*minCols: 1,\s*minRows: 1,/,
    "the PTY grid must come from the shipped terminal measurement helper");
  assert.match(terminal, /onOpen\?\.\(profileName, SSH_TERM, grid\)/,
    "the measured grid must seed open");
  assert.match(terminal, /resizeRef\.current\?\.\(id, grid\)/,
    "the measured grid must drive resize");
  assert.match(hook,
    /previous\?\.cols === args\.size\.cols && previous\?\.rows === args\.size\.rows/,
    "unchanged grids must not dispatch resize");
  assert.doesNotMatch(terminal, /cols:\s*(?:80|100)|rows:\s*(?:24|30)/,
    "the PTY view must never open with a guessed default grid");
});

test("[pins 1 and 4] terminal bytes and input stay verbatim at the transient boundary", () => {
  const terminal = read("./SshPtyTerminal.jsx");
  const hook = read("./useSshPty.js");
  const model = read("./sshPtyModel.js");
  const combined = `${terminal}\n${hook}\n${model}`;

  assert.ok(combined.includes("output before this point was not captured."));
  assert.ok(combined.includes('delivery: "connection_transient"'));
  assert.ok(combined.includes("priorOutputCaptured: false"));
  assert.doesNotMatch(combined, /load earlier|replay output/i,
    "the PTY surface must not offer nonexistent earlier output");
  assert.match(terminal, /term\.onData\(\(data\) => \{[\s\S]*inputRef\.current\?\.\(id, data\)/,
    "xterm input must be forwarded without local line editing");
  assert.doesNotMatch(terminal, /term\.write\(data\)|term\.writeln\(data\)/,
    "the input path must not synthesize a local echo");
  assert.match(terminal, /term\.write\(entry\.bytes\)/,
    "delivered output bytes must reach xterm without a text rewrite");
  assert.match(terminal, /onClick=\{\(\) => onEof\?\.\(shellId\)\}/,
    "EOF/close must remain an explicit user action");
});

test("[pin] the profile-name-only affordance launches the wired PTY view", () => {
  const model = read("./sshPtyModel.js");
  const hook = read("./useSshPty.js");
  const terminal = read("./SshPtyTerminal.jsx");
  const panel = read("./SshProfilesPanel.jsx");
  const surface = read("./SessionSurface.jsx");
  const shell = read("../app/AppShell.jsx");

  assert.ok(panel.includes('"Open shell"'));
  assert.match(panel, /onClick=\{\(\) => onOpenShell\?\.\(profile\.name\)\}/,
    "the affordance must pass only the public saved-profile name");
  assert.ok(panel.includes("Shell unavailable"));
  assert.ok(surface.includes('<SshPtyTerminal'));
  assert.ok(surface.includes('mode === "sshPty"'));
  assert.ok(surface.includes('onBack={() => setModeFor(session.id, "sshProfiles")}'));
  assert.match(shell, /import \{ useSshPty \} from "\.\.\/sessions\/useSshPty\.js"/);
  assert.match(shell,
    /const sshPtyApi = useSshPty\(\{ enabled: authState === "authenticated" \}\)/);
  for (const prop of [
    "sshPtyOutputByShell={sshPtyApi.outputByShell}",
    "sshPtyStateByShell={sshPtyApi.stateByShell}",
    "sshPtyClosedByShell={sshPtyApi.closedByShell}",
    "sshPtyUnavailable={sshPtyApi.unavailable}",
    "onOpenSshPty={sshPtyApi.open}",
    "onInputSshPty={sshPtyApi.input}",
    "onResizeSshPty={sshPtyApi.resize}",
    "onEofSshPty={sshPtyApi.eof}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }

  assert.match(model,
    /return \{\s*name: profileName\(profile\),\s*term: requiredText\(term, "Terminal type"\),\s*size: measuredSize\(size\),\s*\};/,
    "openArgs must allowlist only name, term, and measured size");
  assert.doesNotMatch(`${model}\n${hook}\n${terminal}`,
    /type=["']password|passphrase|private_key|auth\s*:/i,
    "the interactive PTY path must contain no credential prompt or field");
});
