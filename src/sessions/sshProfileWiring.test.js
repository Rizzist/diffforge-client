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

test("[pin] all six SSH profile commands use pinned keys and live only in useSshProfiles", () => {
  const hook = read("./useSshProfiles.js");
  const panel = read("./SshProfilesPanel.jsx");
  const sources = frontendSources(SRC_ROOT);
  const commands = [
    "ssh_list",
    "ssh_add",
    "ssh_update",
    "ssh_remove",
    "ssh_test",
    "ssh_set_session_scope",
  ];

  assert.match(hook, /invoke\("ssh_list", \{ session_id: sessionId \}\)/,
    "ssh_list must use the pinned optional session_id spelling");
  assert.match(hook, /invoke\("ssh_add", addArgs\(profile\)\)/,
    "ssh_add must receive the profile-only pure arguments");
  assert.match(hook, /invoke\("ssh_update", updateArgs\(name, changes\)\)/,
    "ssh_update must receive the pinned name/changes pure arguments");
  assert.match(hook, /invoke\("ssh_remove", \{ name \}\)/,
    "ssh_remove must send only name");
  assert.match(hook, /const args = \{ name \};[\s\S]*args\.timeout_s = timeoutS;/,
    "ssh_test must preserve optional timeout_s with its pinned spelling");
  assert.match(hook, /invoke\("ssh_test", args\)/);
  assert.match(hook,
    /invoke\("ssh_set_session_scope", \{\s*session_id: sessionId,\s*scope,\s*\}\)/,
    "scope changes must send only session_id and scope");

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `useSshProfiles must own exactly one ${command} dispatch`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/useSshProfiles.js"],
      `${command} must be invoked only from useSshProfiles.js`);
  }

  assert.doesNotMatch(panel, /invoke\(/,
    "SshProfilesPanel must remain presentational");
});

test("[pin] secrets clear immediately after dispatch and never enter rendered errors", () => {
  const hook = read("./useSshProfiles.js");
  const panel = read("./SshProfilesPanel.jsx");
  const addStart = hook.indexOf("const add = useCallback");
  const updateStart = hook.indexOf("const update = useCallback", addStart);
  const removeStart = hook.indexOf("const remove = useCallback", updateStart);
  const addBlock = hook.slice(addStart, updateStart);
  const updateBlock = hook.slice(updateStart, removeStart);

  const addDispatch = addBlock.indexOf('invoke("ssh_add"');
  const addDispatchClear = addBlock.indexOf("clearSubmittedSecrets();", addDispatch);
  const updateDispatch = updateBlock.indexOf('invoke("ssh_update"');
  const updateDispatchClear = updateBlock.indexOf("clearSubmittedSecrets();", updateDispatch);
  assert.ok(addDispatch < addDispatchClear);
  assert.ok(addDispatchClear < addBlock.indexOf("await request"),
    "add secrets must clear from component state before awaiting the daemon");
  assert.ok(addBlock.indexOf("profile = null;") < addBlock.indexOf("await request"),
    "the hook must drop its add request reference before awaiting the daemon");
  assert.ok(updateDispatch < updateDispatchClear);
  assert.ok(updateDispatchClear < updateBlock.indexOf("await request"),
    "update secrets must clear from component state before awaiting the daemon");
  assert.ok(updateBlock.indexOf("changes = null;") < updateBlock.indexOf("await request"),
    "the hook must drop its update request reference before awaiting the daemon");

  assert.match(panel,
    /password: "",\s*privateKey: "",\s*passphrase: "",/,
    "the component clear callback must blank every secret control");
  assert.ok(panel.includes("Secrets are never loaded, echoed, placed in receipts, or kept after submit."));
  assert.doesNotMatch(hook, /setError\(String\(thrown|setError\(thrown|thrown\?\.message/,
    "transport errors must not put potentially echoed request material in panel state");
});

test("[pin] receipts precede authority re-listing and unavailable settles once", () => {
  const hook = read("./useSshProfiles.js");
  const finishStart = hook.indexOf("const finishMutation");
  const addStart = hook.indexOf("const add = useCallback", finishStart);
  const finishBlock = hook.slice(finishStart, addStart);
  const scopeStart = hook.indexOf("const setSessionScope = useCallback");
  const effectStart = hook.indexOf("useEffect(() => {", scopeStart);
  const scopeBlock = hook.slice(scopeStart, effectStart);

  assert.ok(finishBlock.indexOf("setMutationReceiptBySession")
    < finishBlock.indexOf("await list(sessionId)"),
  "add/update/remove receipts must land before the authority re-list");
  assert.doesNotMatch(finishBlock, /setBySession/,
    "mutation receipts must never optimistically edit profile rows");
  assert.ok(scopeBlock.indexOf("setScopeReceiptBySession")
    < scopeBlock.indexOf("await list(sessionId)"),
  "the daemon scope receipt must land before its follow-up profile re-list");

  assert.match(hook, /if \(unavailableRef\.current\) return;[\s\S]*unavailableRef\.current = true;/,
    "feature absence must settle once");
  for (const callback of ["list", "add", "update", "remove", "test", "setSessionScope"]) {
    const start = hook.indexOf(`const ${callback} = useCallback`);
    assert.notEqual(start, -1);
    assert.ok(hook.slice(start, start + 700).includes("unavailableRef.current"),
      `${callback} must stop dispatching after unavailable settles`);
  }
});

test("[pin] add/update/remove receipts invalidate their cached test before re-listing", () => {
  const hook = read("./useSshProfiles.js");
  const finishStart = hook.indexOf("const finishMutation");
  const addStart = hook.indexOf("const add = useCallback", finishStart);
  const updateStart = hook.indexOf("const update = useCallback", addStart);
  const removeStart = hook.indexOf("const remove = useCallback", updateStart);
  const testStart = hook.indexOf("const test = useCallback", removeStart);
  const finishBlock = hook.slice(finishStart, addStart);
  const mutationBlocks = {
    add: hook.slice(addStart, updateStart),
    update: hook.slice(updateStart, removeStart),
    remove: hook.slice(removeStart, testStart),
  };

  const invalidation = "invalidateTestOutcomeForMutation(current, action, receipt)";
  assert.ok(finishBlock.includes(invalidation),
    "the shared receipt path must invalidate the affected name");
  assert.ok(finishBlock.indexOf(invalidation) < finishBlock.indexOf("await list(sessionId)"),
    "test invalidation must happen before the authority re-list");
  for (const [action, block] of Object.entries(mutationBlocks)) {
    assert.ok(block.includes(`finishMutation(sessionId, "${action}", receipt)`),
      `${action} must route its successful receipt through the invalidating path`);
  }
});

test("[pin] AppShell owns the hook and SessionSurface mounts the wired SSH Profiles view", () => {
  const shell = read("../app/AppShell.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(shell, /import \{ useSshProfiles \} from "\.\.\/sessions\/useSshProfiles\.js"/);
  assert.match(shell,
    /const sshProfileApi = useSshProfiles\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must own one auth-gated SSH profile hook");
  for (const prop of [
    "sshProfilesBySession={sshProfileApi.bySession}",
    "sshProfileTestsBySession={sshProfileApi.testBySession}",
    "sshScopeReceiptBySession={sshProfileApi.scopeReceiptBySession}",
    "sshMutationReceiptBySession={sshProfileApi.mutationReceiptBySession}",
    "sshProfileUnavailable={sshProfileApi.unavailable}",
    "onLoadSshProfiles={sshProfileApi.list}",
    "onAddSshProfile={sshProfileApi.add}",
    "onUpdateSshProfile={sshProfileApi.update}",
    "onRemoveSshProfile={sshProfileApi.remove}",
    "onTestSshProfile={sshProfileApi.test}",
    "onSetSessionSshScope={sshProfileApi.setSessionScope}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }

  assert.match(surface, /import SshProfilesPanel from "\.\/SshProfilesPanel\.jsx"/);
  assert.ok(surface.includes('selectView("sshProfiles")'),
    "the per-session view toggle must offer SSH Profiles");
  assert.ok(surface.includes('(viewModes[id] || "ui") !== "sshProfiles"'),
    "profile reads must occur only when entering the view");
  assert.ok(surface.includes("onLoadSshProfiles?.(id)"));
  assert.match(surface, /mode === "sshProfiles" && session && session\.id !== "draft"/,
    "the panel must mount only for a real session in SSH Profiles mode");
  assert.ok(surface.includes("profiles={sshProfilesBySession[session.id]}"));
  assert.ok(surface.includes("scopeReceipt={sshScopeReceiptBySession[session.id]}"));
  assert.doesNotMatch(surface, /sshProfilesBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "an unread profile registry must not collapse into an empty list");
});

test("[pin] legacy local SSH commands stay absent and honest untested wording is present", () => {
  const hook = read("./useSshProfiles.js");
  const panel = read("./SshProfilesPanel.jsx");
  const combined = `${hook}\n${panel}`;
  for (const legacy of [
    "ssh_profiles_list",
    "ssh_profile_save",
    "ssh_profile_delete",
    "terminal_ssh_connect",
  ]) {
    assert.equal(combined.includes(legacy), false,
      `the daemon profile surface must never reference legacy command ${legacy}`);
  }

  assert.ok(panel.includes('return "not tested";'),
    "an untested profile must say not tested");
  assert.ok(panel.includes("Reachability remains “not tested” until a published test outcome arrives."));
  assert.doesNotMatch(panel, /reachable\s*\?\?\s*true|error\s*\?\s*["']unreachable/i,
    "the panel must not infer reachability from success or error state");
});
