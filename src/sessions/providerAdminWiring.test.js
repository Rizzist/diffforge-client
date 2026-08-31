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

test("[pin] the five provider-admin commands are invoked only from the hook", () => {
  const hook = read("./useProviderAdmin.js");
  const panel = read("./ProviderAdminPanel.jsx");
  const sources = frontendSources(SRC_ROOT);
  const commands = [
    "provider_configure",
    "provider_remove",
    "provider_set_trust",
    "lockdown_status",
    "lockdown_set_quota",
  ];

  assert.match(hook, /invokeCommand\("provider_configure", args\)/);
  assert.match(hook, /invokeCommand\("provider_remove", \{\s*provider,\s*expected_revision: expectedRevision,\s*\}\)/);
  assert.match(hook, /invokeCommand\("provider_set_trust", \{\s*name: provider,\s*trust,\s*expected_revision: expectedRevision,\s*\}\)/);
  assert.match(hook, /const args = \{\};[\s\S]*?args\.provider = provider;[\s\S]*?invokeCommand\("lockdown_status", args\)/,
    "lockdown.status must omit the provider key for the global read");
  assert.match(hook, /invokeCommand\("lockdown_set_quota", \{ bytes \}\)/);

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invokeCommand\\("${command}"`, "g")) || []).length, 1,
      `useProviderAdmin must own one ${command} dispatch site`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invokeCommand("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/useProviderAdmin.js"]);
  }
  assert.doesNotMatch(panel, /invoke\(/, "ProviderAdminPanel must remain presentational");
});

test("[pin] the existing provider-list door is reused for every authority re-read", () => {
  const hook = read("./useProviderAdmin.js");
  const surface = read("./SessionSurface.jsx");

  assert.equal((surface.match(/invoke\("haider_library_snapshot"/g) || []).length, 1,
    "SessionSurface must retain one existing model-picker library read");
  assert.doesNotMatch(hook, /invoke(?:Command)?\("(?:haider_library_snapshot|provider_list)"/,
    "provider admin must not create a second provider-list door");
  assert.ok(surface.includes("onLoadProviderAdmin?.(refreshLibrary)"));
  assert.ok(surface.includes("onRefresh={() => onReadProviderAdmin?.(refreshLibrary)}"));
  for (const callback of [
    "onConfigureProvider?.(modeName, fields, refreshLibrary)",
    "onRemoveProvider?.(row, refreshLibrary)",
    "onSetProviderTrust?.(row, trust, refreshLibrary)",
    "onSetLockdownQuota?.(bytes, refreshLibrary)",
  ]) {
    assert.ok(surface.includes(callback), `${callback} must reuse the existing reader`);
  }
});

test("[pin] configure, remove, and lockdown feature bits settle independently", () => {
  const hook = read("./useProviderAdmin.js");
  for (const feature of ["Configure", "Remove", "Lockdown"]) {
    assert.ok(hook.includes(`const ${feature.toLowerCase()}UnavailableRef = useRef(false);`));
    assert.match(hook, new RegExp(
      `const mark${feature}Unavailable = useCallback\\(\\(\\) => \\{[\\s\\S]*?if \\(${feature.toLowerCase()}UnavailableRef\\.current\\) return;[\\s\\S]*?set${feature}Unavailable\\(true\\)`,
    ));
  }

  const configureBlock = hook.slice(
    hook.indexOf("const configure = useCallback"),
    hook.indexOf("const remove = useCallback"),
  );
  const removeBlock = hook.slice(
    hook.indexOf("const remove = useCallback"),
    hook.indexOf("const setTrust = useCallback"),
  );
  const trustBlock = hook.slice(
    hook.indexOf("const setTrust = useCallback"),
    hook.indexOf("const setQuota = useCallback"),
  );
  assert.ok(configureBlock.includes("configureUnavailableRef.current"));
  assert.doesNotMatch(configureBlock, /removeUnavailableRef|lockdownUnavailableRef/);
  assert.ok(removeBlock.includes("removeUnavailableRef.current"));
  assert.doesNotMatch(removeBlock, /configureUnavailableRef|lockdownUnavailableRef/);
  assert.ok(trustBlock.includes("lockdownUnavailableRef.current"));
  assert.doesNotMatch(trustBlock, /configureUnavailableRef|removeUnavailableRef/);
});

test("[pin] receipt lands before re-read, rows are never optimistic, and conflicts never retry", () => {
  const hook = read("./useProviderAdmin.js");
  const finish = hook.slice(
    hook.indexOf("const finishMutation"),
    hook.indexOf("const configure = useCallback"),
  );
  assert.ok(finish.indexOf("setLastReceipt(receiptView)") < finish.indexOf("await load(readProviders)"),
    "the receipt must be reflected before authority is re-read");
  assert.doesNotMatch(hook, /setProviders|setProviderRows|setProviderAdminRows/,
    "mutation receipts must never rewrite provider rows");
  assert.equal((hook.match(/invokeCommand\("provider_remove"/g) || []).length, 1);
  assert.equal((hook.match(/invokeCommand\("provider_set_trust"/g) || []).length, 1);
  assert.doesNotMatch(hook, /currentRevision/,
    "the hook must never consume the conflict's current revision as retry input");
});

test("[pin finding 1] every provider fence passes the single conflict gate", () => {
  const hook = read("./useProviderAdmin.js");
  const panel = read("./ProviderAdminPanel.jsx");
  for (const [start, end, feature] of [
    ["const configure = useCallback", "const remove = useCallback", "configure"],
    ["const remove = useCallback", "const setTrust = useCallback", "remove"],
    ["const setTrust = useCallback", "const setQuota = useCallback", "lockdown"],
  ]) {
    const block = hook.slice(hook.indexOf(start), hook.indexOf(end));
    assert.match(block, new RegExp(
      `if \\(!fencedMutationAllowed\\("${feature}", provider, (?:args\\.expected_revision|expectedRevision)\\)\\) return null;`,
    ), `${feature} must stop before invoke when the provider fence gate refuses it`);
  }
  assert.ok(hook.includes("completeAuthorityRead(snapshot, clearConflict)"));
  assert.ok(panel.includes("Remove · re-read required"));
  assert.ok(panel.includes("Full trust · re-read required"));
  assert.ok(panel.includes("Lockdown · re-read required"));
  assert.ok(panel.includes("Re-read provider authority"));
});

test("[pin fix 2] automatic provider loads retain conflicts; only explicit re-read releases", () => {
  const hook = read("./useProviderAdmin.js");
  const shell = read("../app/AppShell.jsx");
  const surface = read("./SessionSurface.jsx");
  const load = hook.slice(
    hook.indexOf("const load = useCallback"),
    hook.indexOf("const reread = useCallback"),
  );
  const reread = hook.slice(
    hook.indexOf("const reread = useCallback"),
    hook.indexOf("const finishMutation"),
  );
  const viewEntry = surface.slice(
    surface.indexOf("/* Provider management reuses"),
    surface.indexOf("/* Monitor manager (P4)"),
  );

  assert.match(load, /readAuthority\(readProviders\)/,
    "automatic load must use the non-releasing authority read");
  assert.doesNotMatch(load, /true|clearConflict|release/,
    "automatic load must have no conflict-release capability");
  assert.match(reread, /readAuthority\(readProviders, true\)/,
    "only explicit re-read may request conflict release");
  assert.equal((hook.match(/readAuthority\(readProviders, true\)/g) || []).length, 1,
    "the releasing authority read must have exactly one caller");
  assert.match(viewEntry, /onLoadProviderAdmin\?\.\(refreshLibrary\)/,
    "Providers view entry must call the non-releasing load");
  assert.doesNotMatch(viewEntry, /onReadProviderAdmin/,
    "Providers view entry must never call the releasing re-read");
  assert.ok(shell.includes("onLoadProviderAdmin={providerAdminApi.load}"));
  assert.ok(shell.includes("onReadProviderAdmin={providerAdminApi.reread}"));
  assert.ok(surface.includes("onRefresh={() => onReadProviderAdmin?.(refreshLibrary)}"),
    "the explicit Re-read button must remain wired to the releasing path");
});

test("[pin finding 6] the published facts render the modeled auth requirement", () => {
  const panel = read("./ProviderAdminPanel.jsx");
  assert.ok(panel.includes(
    "<Fact><span>Authentication requirement</span><strong>{categoryLabel(row.authRequirement)}</strong></Fact>",
  ), "every provider card must render the raw-preserving auth requirement view");
});

test("[pin] provider fences have no increment or permissive zero fallback", () => {
  const model = read("./providerAdminModel.js");
  const hook = read("./useProviderAdmin.js");
  const fenceHelper = model.slice(
    model.indexOf("export function fenceFor"),
    model.indexOf("export function conflictView"),
  );
  const fencedMutations = hook.slice(
    hook.indexOf("const remove = useCallback"),
    hook.indexOf("const setQuota = useCallback"),
  );
  for (const source of [fenceHelper, fencedMutations]) {
    assert.doesNotMatch(source, /\+\s*1|\?\?\s*0|\|\|\s*0/,
      "a provider fence must be echoed without + 1, ?? 0, or || 0");
  }
  assert.match(fenceHelper, /return published\(row, "revision"\);/);
  assert.match(fencedMutations, /expected_revision: expectedRevision/);
});

test("[pin] AppShell wires and SessionSurface mounts the management panel", () => {
  const shell = read("../app/AppShell.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(shell, /import \{ useProviderAdmin \} from "\.\.\/sessions\/useProviderAdmin\.js"/);
  assert.match(shell,
    /const providerAdminApi = useProviderAdmin\(\{ enabled: authState === "authenticated" \}\)/);
  for (const prop of [
    "providerAdminLockdownByProvider={providerAdminApi.lockdownByProvider}",
    "providerAdminGlobalLockdown={providerAdminApi.globalLockdown}",
    "providerAdminConflict={providerAdminApi.conflict}",
    "providerAdminConfigureUnavailable={providerAdminApi.configureUnavailable}",
    "providerAdminRemoveUnavailable={providerAdminApi.removeUnavailable}",
    "providerAdminLockdownUnavailable={providerAdminApi.lockdownUnavailable}",
    "onLoadProviderAdmin={providerAdminApi.load}",
    "onReadProviderAdmin={providerAdminApi.reread}",
    "onConfigureProvider={providerAdminApi.configure}",
    "onRemoveProvider={providerAdminApi.remove}",
    "onSetProviderTrust={providerAdminApi.setTrust}",
    "onSetLockdownQuota={providerAdminApi.setQuota}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }

  assert.match(surface, /import ProviderAdminPanel from "\.\/ProviderAdminPanel\.jsx"/);
  assert.ok(surface.includes('selectView("providers")'));
  assert.ok(surface.includes('(viewModes[id] || "ui") !== "providers"'));
  assert.match(surface, /mode === "providers" && session && session\.id !== "draft"/);
  assert.ok(surface.includes("providers={providerAdminRows}"));
  assert.ok(surface.includes("providerRevision={providerAdminRevision}"));
});

test("[pin] trust is per-provider disclosed and conflict copy requires a re-read", () => {
  const panel = read("./ProviderAdminPanel.jsx");
  const hook = read("./useProviderAdmin.js");

  assert.doesNotMatch(`${panel}\n${hook}`, /trust all/i);
  for (const disclosure of [
    "Review trust change",
    "Current published trust",
    "Requested trust",
    "Revision fence",
    "This changes the daemon security policy for exactly one provider.",
  ]) {
    assert.ok(panel.includes(disclosure), `trust disclosure must show ${disclosure}`);
  }
  assert.ok(panel.includes("Re-read provider authority before trying the action again."));
  assert.ok(panel.includes("this action was never retried"));
  assert.ok(panel.includes("Re-read provider authority"));
});
