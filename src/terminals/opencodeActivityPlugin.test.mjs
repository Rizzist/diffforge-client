import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const TERMINAL_CLI_PATH = path.join(REPO_ROOT, "src-tauri/src/terminal_cli.rs");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function activityPluginSource() {
  const rust = await readFile(TERMINAL_CLI_PATH, "utf8");
  const match = rust.match(
    /const DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS: &str = r#"([\s\S]*?)"#;/,
  );
  assert.ok(match, "embedded OpenCode activity plugin source should be extractable");
  return match[1]
    .replace("const IDLE_STOP_DELAY_MS = 1500;", "const IDLE_STOP_DELAY_MS = 25;")
    .replace(
      "const NATIVE_RESULT_REVALIDATION_TIMEOUT_MS = 90_000;",
      "const NATIVE_RESULT_REVALIDATION_TIMEOUT_MS = 80;",
    )
    .replace(
      "const PROVIDER_INTERACTION_LIST_TIMEOUT_MS = 3_000;",
      "const PROVIDER_INTERACTION_LIST_TIMEOUT_MS = 25;",
    )
    .replace("Math.min(2_000, 250 *", "Math.min(20, 5 *");
}

async function createHarness(client) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "diffforge-opencode-plugin-"));
  const pluginPath = path.join(directory, "plugin.mjs");
  const hookPath = path.join(directory, "hook.mjs");
  const logPath = path.join(directory, "events.jsonl");
  await writeFile(pluginPath, await activityPluginSource(), "utf8");
  await writeFile(
    hookPath,
    `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  await appendFile(${JSON.stringify(logPath)}, input + "\\n", "utf8");
  process.stdout.write("null\\n");
});
`,
    "utf8",
  );
  await chmod(hookPath, 0o755);

  const previousHookBin = process.env.DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN;
  process.env.DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN = hookPath;
  let module;
  try {
    module = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}-${Math.random()}`);
  } finally {
    if (previousHookBin === undefined) {
      delete process.env.DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN;
    } else {
      process.env.DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN = previousHookBin;
    }
  }
  const hooks = await module.DiffForgeActivityPlugin({ client });

  const events = async () => {
    try {
      const log = await readFile(logPath, "utf8");
      return log
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  };
  const waitFor = async (predicate, message, timeoutMs = 1_000) => {
    const deadline = Date.now() + timeoutMs;
    do {
      const observed = await events();
      if (predicate(observed)) return observed;
      await sleep(10);
    } while (Date.now() < deadline);
    assert.fail(`${message}; observed ${JSON.stringify(await events())}`);
  };
  const fire = (type, sessionID, properties = {}) => hooks.event({
    event: {
      type,
      properties: { ...properties, sessionID },
    },
  });
  const cleanup = async () => {
    await fire("global.disposed", "");
    await sleep(40);
    await rm(directory, { recursive: true, force: true });
  };

  return { cleanup, events, fire, hooks, waitFor };
}

test("a delayed reply cannot resolve a still-open reused request id", async () => {
  const sessionID = "session-reused-id";
  const requestID = "permission-reused";
  const first = { id: requestID, sessionID, title: "generation A" };
  const second = { id: requestID, sessionID, title: "generation B" };
  let permissions = [first];
  const harness = await createHarness({
    permission: { list: async () => permissions },
    question: { list: async () => [] },
  });

  try {
    await harness.fire("permission.asked", sessionID, first);
    let observed = await harness.waitFor(
      (events) => events.filter((event) => event.hook_event_name === "PermissionRequest").length === 1,
      "generation A should be emitted",
    );
    const firstInteraction = observed.find(
      (event) => event.hook_event_name === "PermissionRequest",
    );

    permissions = [];
    await harness.fire("session.idle", sessionID);
    await harness.waitFor(
      (events) => events.some(
        (event) => event.hook_event_name === "PermissionResult"
          && event.resolved_interaction_id === firstInteraction.interaction_id,
      ),
      "generation A should reconcile after disappearing",
    );

    permissions = [second];
    await harness.fire("permission.asked", sessionID, second);
    observed = await harness.waitFor(
      (events) => events.filter((event) => event.hook_event_name === "PermissionRequest").length === 2,
      "generation B should be emitted for the reused id",
    );
    const secondInteraction = observed.filter(
      (event) => event.hook_event_name === "PermissionRequest",
    )[1];
    assert.notEqual(secondInteraction.interaction_id, firstInteraction.interaction_id);
    assert.notEqual(secondInteraction.interaction_revision, firstInteraction.interaction_revision);

    await harness.fire("permission.replied", sessionID, {
      id: requestID,
      reply: "once",
      delayed_generation: "A",
    });
    await sleep(180);
    observed = await harness.events();
    assert.equal(
      observed.some(
        (event) => event.hook_event_name === "PermissionResult"
          && event.resolved_interaction_id === secondInteraction.interaction_id,
      ),
      false,
      "A's delayed reply must not resolve still-open B",
    );

    permissions = [];
    await harness.fire("permission.replied", sessionID, {
      id: requestID,
      reply: "once",
      generation: "B",
    });
    await harness.waitFor(
      (events) => events.some(
        (event) => event.hook_event_name === "PermissionResult"
          && event.resolved_interaction_id === secondInteraction.interaction_id
          && event.resolved_interaction_revision === secondInteraction.interaction_revision,
      ),
      "a genuine structured reply should still resolve exact generation B",
    );
  } finally {
    await harness.cleanup();
  }
});

test("an idle continuation drops its Stop when a new turn starts during reconciliation", async () => {
  const sessionID = "session-idle-race";
  let permissionList = async () => [];
  const harness = await createHarness({
    permission: { list: (options) => permissionList(options) },
    question: { list: async () => [] },
  });

  try {
    await harness.hooks["chat.message"](
      { sessionID },
      { parts: [{ type: "text", text: "turn one" }] },
    );
    await harness.waitFor(
      (events) => events.some((event) => event.hook_event_name === "UserPromptSubmit"),
      "the first turn should start",
    );

    let releaseList;
    permissionList = () => new Promise((resolve) => { releaseList = resolve; });
    const idle = harness.fire("session.idle", sessionID);
    while (!releaseList) await sleep(1);

    await harness.hooks["chat.message"](
      { sessionID },
      { parts: [{ type: "text", text: "turn two" }] },
    );
    permissionList = async () => [];
    releaseList([]);
    await idle;
    await sleep(80);

    const observed = await harness.events();
    assert.equal(
      observed.filter((event) => event.hook_event_name === "UserPromptSubmit").length,
      2,
    );
    assert.equal(
      observed.some((event) => event.hook_event_name === "Stop"),
      false,
      "the stale idle hook must not schedule Stop for turn two",
    );
  } finally {
    await harness.cleanup();
  }
});

test("malformed list items skip reconciliation instead of appearing empty", async () => {
  const sessionID = "session-malformed-list";
  const request = { id: "permission-malformed", sessionID, title: "still open" };
  let permissions = [request];
  const harness = await createHarness({
    permission: { list: async () => permissions },
    question: { list: async () => [] },
  });

  try {
    await harness.fire("permission.asked", sessionID, request);
    const observed = await harness.waitFor(
      (events) => events.some((event) => event.hook_event_name === "PermissionRequest"),
      "the tracked permission should be emitted",
    );
    const interaction = observed.find(
      (event) => event.hook_event_name === "PermissionRequest",
    );

    for (const malformed of [{ data: [null] }, [{}]]) {
      permissions = malformed;
      await harness.fire("session.idle", sessionID);
      await sleep(40);
      assert.equal(
        (await harness.events()).some(
          (event) => event.hook_event_name === "PermissionResult"
            && event.resolved_interaction_id === interaction.interaction_id,
        ),
        false,
      );
    }

    permissions = [];
    await harness.fire("session.idle", sessionID);
    await harness.waitFor(
      (events) => events.some(
        (event) => event.hook_event_name === "PermissionResult"
          && event.resolved_interaction_id === interaction.interaction_id,
      ),
      "a valid empty list should retain genuine disappearance behavior",
    );
  } finally {
    await harness.cleanup();
  }
});

test("a hung provider list is evicted so the next cycle can resolve a disappearance", async () => {
  const sessionID = "session-hung-list";
  const request = { id: "permission-hung-list", sessionID, title: "hung once" };
  let calls = 0;
  const signals = [];
  const harness = await createHarness({
    permission: {
      list: (options = {}) => {
        calls += 1;
        signals.push(options.signal);
        if (calls === 1) return new Promise(() => {});
        return Promise.resolve([]);
      },
    },
    question: { list: async () => [] },
  });

  try {
    await harness.fire("permission.asked", sessionID, request);
    const observed = await harness.waitFor(
      (events) => events.some((event) => event.hook_event_name === "PermissionRequest"),
      "the tracked permission should be emitted",
    );
    const interaction = observed.find(
      (event) => event.hook_event_name === "PermissionRequest",
    );

    await harness.fire("session.idle", sessionID);
    assert.equal(calls, 1, "the first reconciliation should issue one SDK request");
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.aborted, true, "timeout should abort the underlying request");

    await harness.fire("session.idle", sessionID);
    assert.equal(calls, 2, "the next reconciliation should issue a fresh SDK request");
    await harness.waitFor(
      (events) => events.some(
        (event) => event.hook_event_name === "PermissionResult"
          && event.resolved_interaction_id === interaction.interaction_id,
      ),
      "the fresh empty list should resolve the disappeared permission",
    );
  } finally {
    await harness.cleanup();
  }
});

test("responsive provider lists do not accumulate concurrent requests", async () => {
  let calls = 0;
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const harness = await createHarness({
    permission: {
      list: async () => {
        calls += 1;
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        await sleep(5);
        activeCalls -= 1;
        return [];
      },
    },
    question: { list: async () => [] },
  });

  try {
    await harness.fire("session.idle", "session-responsive-list");
    await harness.fire("session.idle", "session-responsive-list");
    await harness.fire("session.idle", "session-responsive-list");
    assert.equal(calls, 3, "settled requests should be evicted between cycles");
    assert.equal(maxActiveCalls, 1, "responsive cycles should not overlap requests by kind");
    assert.equal(activeCalls, 0);
  } finally {
    await harness.cleanup();
  }
});
