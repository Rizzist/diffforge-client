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

test("[pin] all three runtime commands and the progress event live only in useHaiderRuntimeSetup", () => {
  const hook = read("./useHaiderRuntimeSetup.js");
  const sources = frontendSources(SRC_ROOT);
  const commands = ["haider_runtime_status", "haider_install_latest", "haider_daemon_start"];

  assert.match(hook, /invoke\("haider_runtime_status"\)/,
    "the status probe must be the argument-free OFFLINE local check (no refreshLatest)");
  assert.match(hook, /invoke\("haider_install_latest"\)/);
  assert.match(hook, /invoke\("haider_daemon_start"\)/);

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `useHaiderRuntimeSetup must own exactly one ${command} dispatch`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["app/useHaiderRuntimeSetup.js"],
      `${command} must be invoked only from useHaiderRuntimeSetup.js`);
  }

  /* LITERAL event name, subscribed exactly once, unsubscribed on unmount. */
  assert.equal((hook.match(/listen\("haider-install-progress"/g) || []).length, 1,
    "haider-install-progress must be listened to exactly once");
  const listenOwners = sources
    .filter((path) => readFileSync(path, "utf8").includes('listen("haider-install-progress"'))
    .map((path) => relative(SRC_ROOT, path));
  assert.deepEqual(listenOwners, ["app/useHaiderRuntimeSetup.js"],
    "the progress subscription must stay centralized in useHaiderRuntimeSetup.js");
  assert.ok(hook.includes("if (unlisten) unlisten();"),
    "the progress listener must be cleaned up on unmount");

  assert.doesNotMatch(read("./HaiderRuntimeSetup.jsx"), /invoke\(|listen\(/,
    "HaiderRuntimeSetup must remain presentational");
});

test("[pin] the progress subscription lands before the install dispatch", () => {
  const hook = read("./useHaiderRuntimeSetup.js");
  const subscribeAt = hook.indexOf('listenerReadyRef.current = listen("haider-install-progress"');
  assert.notEqual(subscribeAt, -1,
    "the mount effect must register the progress listener into listenerReadyRef");
  const awaitAt = hook.indexOf("if (listenerReadyRef.current) await listenerReadyRef.current;");
  const installAt = hook.indexOf('await invoke("haider_install_latest")');
  assert.ok(awaitAt !== -1 && installAt !== -1 && awaitAt < installAt,
    "install must await the subscription before invoking (subscribe-before-install contract)");
});

test("[pin] nothing installs without a click and one mutation runs at a time", () => {
  const hook = read("./useHaiderRuntimeSetup.js");
  /* The install command dispatches from runInstall alone, and runInstall is
     reached only through the install/retry click handlers. */
  assert.equal((hook.match(/void runInstall\(\)/g) || []).length, 2,
    "runInstall must be reached only from the install and retry click handlers");
  assert.ok(hook.includes("if (busyRef.current) return;"),
    "overlapping mutations must be refused locally, not just by the SDK's busy rejection");
  assert.match(hook, /if \(stage !== "needed" && stage !== "unknown"\) return;/,
    "the Install click must dispatch only from a decision point");
  assert.match(hook, /if \(stage !== "failed" \|\| failure\?\.retryable !== true\) return;/,
    "Retry must require an EXPLICIT retryable rejection");
});

test("[pin] byte counters are never Number()-coerced", () => {
  const model = read("./haiderRuntimeSetupModel.js");
  const hook = read("./useHaiderRuntimeSetup.js");
  const screen = read("./HaiderRuntimeSetup.jsx");

  assert.doesNotMatch(hook, /Number\(/);
  assert.doesNotMatch(screen, /Number\(|parseInt\(|parseFloat\(/);
  /* the model's single Number(...) call narrows a BigInt percent (<= 100n) —
     every wire counter goes through BigInt instead */
  assert.equal((model.match(/Number\((?!\))/g) || []).length, 1);
  assert.ok(model.includes("Number((clamped * 100n) / totalBig)"));
  assert.ok(model.includes("BigInt(decimal)"),
    "byte comparisons and formatting must ride BigInt");
});

test("[pin] AppShell seats the gate after boot and before the entry card", () => {
  const shell = read("./AppShell.jsx");

  assert.match(shell,
    /import HaiderRuntimeSetupScreen, \{ HaiderRuntimeSetupNotice \} from "\.\/HaiderRuntimeSetup\.jsx"/);
  assert.match(shell, /import \{ useHaiderRuntimeSetup \} from "\.\/useHaiderRuntimeSetup\.js"/);
  assert.ok(shell.includes("const haiderSetup = useHaiderRuntimeSetup();"),
    "AppShell must own exactly one app-level setup hook instance");

  /* The seam: the ceremony holds its boot backdrop instead of showing the
     entry card while the gate is active — and ONLY pre-login. */
  assert.ok(shell.includes("const haiderSetupBlocking = authBootDone"));
  assert.ok(shell.includes('&& authState === "signedOut"'));
  assert.ok(shell.includes("&& haiderSetupGateActive(haiderSetup.state)"));
  assert.ok(shell.includes('? (haiderSetupBlocking ? "boot" : "entry")'),
    "the entry phase must yield to the setup gate, never race it");

  assert.ok(shell.includes("{authFlowActive && haiderSetupBlocking && ("),
    "the setup screen must render only while the ceremony is up and the gate holds");
  assert.ok(shell.includes("<HaiderRuntimeSetupScreen"));
  assert.ok(shell.includes("onContinueWithout={haiderSetup.continueWithout}"));
  assert.ok(shell.includes("onInstall={haiderSetup.install}"));
  assert.ok(shell.includes("onRetry={haiderSetup.retry}"));

  /* Unknown status is a notice OVER the login card, never a gate. */
  assert.ok(shell.includes('{authFlowActive && authFlowPhase === "entry"'));
  assert.ok(shell.includes("&& haiderSetupNoticeVisible(haiderSetup.state) && ("));
  assert.ok(shell.includes("<HaiderRuntimeSetupNotice"));
  assert.ok(shell.includes("onDismiss={haiderSetup.dismissNotice}"));
});

test("[pin] the screen renders only returned facts and honest daemon claims", () => {
  const screen = read("./HaiderRuntimeSetup.jsx");

  assert.ok(screen.includes("A daemon restart may still be pending"),
    "restart_needed must read as conditionally pending — it also covers unknown health");
  assert.ok(screen.includes("{outcome.restartPending && ("),
    "the restart caveat must be its own line, never a replacement for the start outcome");
  assert.ok(screen.includes("The daemon did not confirm it is running: {outcome.startError}"),
    "a reported start error must be displayed verbatim");
  assert.doesNotMatch(screen, /previous daemon keeps running|daemon is running\./,
    "no implied-healthy or asserted-previous-daemon wording may return");
  assert.ok(screen.includes("{outcome.installedVersion && <Copy>Installed {outcome.installedVersion}.</Copy>}"),
    "the version line must render the returned installed_version or nothing");
  assert.ok(screen.includes("failure?.retryable === true && ("),
    "Retry must appear only for an explicitly retryable rejection");
  assert.ok(screen.includes("Continue without it"),
    "a continue-without affordance must exist");
  assert.ok(screen.includes("progress.percent == null"),
    "an unknown total must render indeterminate, not a fabricated fraction");
});
