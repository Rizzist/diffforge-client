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

test("[pin] all four capability commands use exact keys and live only in useCapabilities", () => {
  const hook = read("./useCapabilities.js");
  const panel = read("./CapabilitiesPanel.jsx");
  const sources = frontendSources(SRC_ROOT);
  const commands = ["hooks_list", "hooks_trust", "hooks_revoke", "tools_inventory"];

  assert.match(hook, /invoke\("hooks_list", \{ cwd \}\)/,
    "hooks_list must send only the cwd key");
  assert.match(hook, /invoke\("tools_inventory", \{ session_id: sessionId \}\)/,
    "tools_inventory must send the pinned session_id key");
  assert.match(hook, /invoke\("hooks_trust", trustArgs\(digest\)\)/,
    "hooks_trust must receive the digest-only pure arguments");
  assert.match(hook, /invoke\("hooks_revoke", trustArgs\(digest\)\)/,
    "hooks_revoke must receive the digest-only pure arguments");

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `useCapabilities must own exactly one ${command} dispatch`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/useCapabilities.js"],
      `${command} must be invoked only from useCapabilities.js`);
  }

  assert.doesNotMatch(panel, /invoke\(/,
    "CapabilitiesPanel must remain presentational");
});

test("[pin] hook and tool gates settle independently and trust receipts re-list authority", () => {
  const hook = read("./useCapabilities.js");

  assert.ok(hook.includes("const hooksUnavailableRef = useRef(false);"));
  assert.ok(hook.includes("const toolsUnavailableRef = useRef(false);"));
  assert.match(hook,
    /const markHooksUnavailable = useCallback\([\s\S]*?if \(hooksUnavailableRef\.current\) return;[\s\S]*?setHooksUnavailable\(true\)/,
    "hooks feature absence must settle its own lane once");
  assert.match(hook,
    /const markToolsUnavailable = useCallback\([\s\S]*?if \(toolsUnavailableRef\.current\) return;[\s\S]*?setToolsUnavailable\(true\)/,
    "tools feature absence must settle its own lane once");

  const hookSettlement = hook.slice(
    hook.indexOf("const settleHookError"),
    hook.indexOf("const settleToolError"),
  );
  const toolSettlement = hook.slice(
    hook.indexOf("const settleToolError"),
    hook.indexOf("const listHooks"),
  );
  assert.ok(hookSettlement.includes("markHooksUnavailable()"));
  assert.doesNotMatch(hookSettlement, /markToolsUnavailable/,
    "a missing hooks feature must not disable tools");
  assert.ok(toolSettlement.includes("markToolsUnavailable()"));
  assert.doesNotMatch(toolSettlement, /markHooksUnavailable/,
    "a missing tools feature must not disable hooks");
  assert.match(hook,
    /const \[hooks, tools\] = await Promise\.all\(\[hookRead, toolRead\]\);/,
    "the coherent view must read each independently gated half");

  const finishStart = hook.indexOf("const finishHookMutation");
  const trustStart = hook.indexOf("const trust = useCallback", finishStart);
  const finish = hook.slice(finishStart, trustStart);
  assert.ok(finish.indexOf("setHookReceiptByDigest") < finish.indexOf("await listHooks(cwd)"),
    "the mutation receipt must land before an authority re-list");
  assert.doesNotMatch(finish, /setHooksByCwd/,
    "a trust receipt must never optimistically rewrite a hook row");
});

test("[pin] AppShell owns the hook and SessionSurface mounts the wired Hooks & Tools view", () => {
  const shell = read("../app/AppShell.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(shell,
    /import \{ useCapabilities \} from "\.\.\/sessions\/useCapabilities\.js"/);
  assert.match(shell,
    /const capabilityApi = useCapabilities\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must own one auth-gated capability hook");
  for (const prop of [
    "capabilityHooksByCwd={capabilityApi.hooksByCwd}",
    "capabilityToolsBySession={capabilityApi.toolsBySession}",
    "capabilityHookReceiptByDigest={capabilityApi.hookReceiptByDigest}",
    "capabilityHookPendingByDigest={capabilityApi.hookPendingByDigest}",
    "capabilityHooksUnavailable={capabilityApi.hooksUnavailable}",
    "capabilityToolsUnavailable={capabilityApi.toolsUnavailable}",
    "onLoadCapabilities={capabilityApi.load}",
    "onLoadCapabilityHooks={capabilityApi.listHooks}",
    "onLoadCapabilityTools={capabilityApi.listTools}",
    "onTrustHook={capabilityApi.trust}",
    "onRevokeHook={capabilityApi.revoke}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }

  assert.match(surface, /import CapabilitiesPanel from "\.\/CapabilitiesPanel\.jsx"/);
  assert.ok(surface.includes('selectView("capabilities")'),
    "the per-session view toggle must offer Hooks & Tools");
  assert.ok(surface.includes('(viewModes[id] || "ui") !== "capabilities"'),
    "capability reads must occur only when entering the view");
  assert.ok(surface.includes("onLoadCapabilities?.(activeCapabilityCwd, id)"));
  assert.match(surface,
    /mode === "capabilities" && session && session\.id !== "draft"/,
    "the manager must mount only for a real session in capability mode");
  assert.ok(surface.includes("hooks={capabilityHooksByCwd[capabilityCwd]}"));
  assert.ok(surface.includes("tools={capabilityToolsBySession[session.id]}"));
  assert.doesNotMatch(surface,
    /capability(?:HooksByCwd\[capabilityCwd\]|ToolsBySession\[session\.id\])\s*(?:\|\||\?\?)/,
    "unread capability facts must not collapse into honest empty lists");
});

test("[pin] trust is an informed per-hook action using only the row's published digest", () => {
  const model = read("./capabilityModel.js");
  const hook = read("./useCapabilities.js");
  const panel = read("./CapabilitiesPanel.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(model, /export function trustArgs\(digest\) \{\s*return \{ digest \};\s*\}/,
    "the wire helper must return the daemon digest without derivation");
  assert.match(panel, /onClick=\{\(\) => onTrust\?\.\(hook\.digest\)\}/,
    "the trust button must send the exact digest on the displayed hook row");
  assert.match(surface, /onTrust=\{\(digest\) => onTrustHook\?\.\(capabilityCwd, digest\)\}/,
    "the mount must relay that digest without replacement");
  assert.match(hook, /invoke\("hooks_trust", trustArgs\(digest\)\)/,
    "the hook must pass the relayed digest to the command boundary");

  assert.ok(panel.includes("Review trust action for"),
    "trust must be behind an explicit review disclosure");
  for (const disclosure of [
    "Trust exactly this daemon-published hook?",
    "Name:",
    "Source:",
    "Digest:",
  ]) {
    assert.ok(panel.includes(disclosure), `trust review must disclose ${disclosure}`);
  }
  assert.doesNotMatch(panel, /trust all|auto[- ]trust/i,
    "the panel must expose no bulk or automatic trust affordance");
  assert.doesNotMatch(hook, /useEffect\([\s\S]{0,500}hooks_trust/,
    "merely mounting or viewing must not dispatch trust");
});

test("[pin] the surface admits unspecified run kind and keeps tool schemas raw and collapsed", () => {
  const panel = read("./CapabilitiesPanel.jsx");

  assert.ok(panel.includes("Run kind: unspecified (not published). No execution mode inferred."),
    "an absent hook classification must have explicit no-inference wording");
  assert.ok(panel.includes("Published kind: {categoryLabel(hook.kind)}"),
    "a real published kind may be shown verbatim");
  assert.doesNotMatch(panel, /long-lived|one-shot|server hook/i,
    "the panel must not label execution style from names or paths");
  assert.match(panel,
    /<OpaqueDetails>\s*<summary>Raw input schema · opaque<\/summary>\s*<RawBlock>/,
    "input schemas must be raw and collapsed by default");
  assert.doesNotMatch(panel, /<input[^>]+inputSchema|schema\.properties|json-schema-form/i,
    "opaque schemas must never be interpreted as validated forms");
  assert.ok(panel.includes("permission default · daemon fact"));
  assert.ok(panel.includes("Remembered decision {index + 1} · raw daemon fact"));
});
