import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  catalogToSlashCommands,
  commandFailureMessage,
  commandOutcomeResult,
  createCommandDoorExecutor,
  routeClientCommand,
} from "./commandDoor.js";

test("command door: Argument rows render beneath their parent command", () => {
  const rows = catalogToSlashCommands([{
    kind: "argument",
    ownership: "client_view",
    label: "GPT-5",
    description: "Choose GPT-5.",
    name: "model",
    value: "gpt-5",
  }]);
  assert.deepEqual(rows.map((row) => row.command), ["/model gpt-5"]);
  assert.equal(rows.some((row) => row.command === "/gpt-5"), false);
});

test("command door: Unknown ownership is never executed locally", () => {
  let localExecutions = 0;
  const result = routeClientCommand({
    kind: "argument",
    ownership: "unknown",
    label: "Mystery model",
    description: "The parent spec could not be resolved.",
    name: "model",
    value: "future-model",
  }, "/model future-model", () => { localExecutions += 1; });

  assert.equal(localExecutions, 0, "unknown ownership reached the local executor");
  assert.equal(result.type, "refused");
  assert.match(result.message, /owner is unknown/i);
});

test("command door: an unrecognised Custom command renders generically, never as unsupported", () => {
  const result = routeClientCommand({
    kind: "custom",
    ownership: "client_view",
    label: "/release-notes",
    description: "Draft release notes from the current changes.",
    name: "release-notes",
    value: "Draft release notes from the current changes.",
  }, "/release-notes");

  assert.equal(result.type, "custom");
  assert.match(result.message, /release-notes/i);
  assert.doesNotMatch(result.message, /unsupported|unimplemented/i);
});

test("command door: an unrecognised BuiltIn client command is visible and carries its description", () => {
  const description = "Upgrade DiffForge or use the Shell route for this command.";
  const result = routeClientCommand({
    kind: "built_in",
    ownership: "client_view",
    label: "/future-view",
    description,
    name: "future-view",
    value: "",
  }, "/future-view");

  assert.equal(result.type, "unhandled");
  assert.match(result.message, /unhandled command/i);
  assert.match(result.message, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("command door: Parked preserves the existing needs_input fence and creates no answer route", () => {
  const needsInput = {
    kind: "choice",
    title: "Choose a model",
    menu_id: "command-model-1",
    request_seq: 1843,
    worker_generation: 122,
    options: [{ key: "gpt", label: "GPT" }],
  };
  const result = commandOutcomeResult({ kind: "parked", needs_input: needsInput });

  assert.equal(result.type, "parked");
  assert.deepEqual(result.needsInput, needsInput);
  assert.equal(Object.hasOwn(result, "answerRoute"), false);

  const directory = path.dirname(fileURLToPath(import.meta.url));
  const sourceFiles = fs.readdirSync(directory)
    .filter((name) => (name.endsWith(".js") || name.endsWith(".jsx"))
      && !name.endsWith(".test.js"));
  const answerCallers = sourceFiles.filter((name) => (
    fs.readFileSync(path.join(directory, name), "utf8")
      .includes('invoke("session_answer_menu"')
  ));
  assert.deepEqual(answerCallers, ["NeedsInputCard.jsx"]);
  assert.doesNotMatch(
    fs.readFileSync(path.join(directory, "commandDoor.js"), "utf8"),
    /invoke\(["'](?:command\.answer|session_answer_menu)["']|answerRoute\s*:/,
  );
});

test("command door: a launcher catalog is never reused for an in-session invoke", async () => {
  const listContexts = [];
  let daemonInvocations = 0;
  let localExecutions = 0;
  const execute = createCommandDoorExecutor({
    listCommands: async ({ in_session: inSession }) => {
      listContexts.push(inSession);
      return [{
        kind: "built_in",
        ownership: inSession ? "daemon_operation" : "client_view",
        label: "/model",
        description: "Choose the model for this context.",
        name: "model",
        value: "",
      }];
    },
    invokeCommand: async () => {
      daemonInvocations += 1;
      return { kind: "receipt", receipt: { message: "Model selected." } };
    },
    executeLocal: () => { localExecutions += 1; },
  });

  await execute({ command: "/model", inSession: false });
  await execute({ command: "/model", inSession: true });

  assert.deepEqual(listContexts, [false, true]);
  assert.equal(localExecutions, 1);
  assert.equal(daemonInvocations, 1);
});

test("command door: missing command_door_v1 names the connected daemon capability", () => {
  assert.equal(
    commandFailureMessage("haider_command_feature_missing"),
    "The connected Haider daemon does not offer commands.",
  );

  const directory = path.dirname(fileURLToPath(import.meta.url));
  const composerSource = fs.readFileSync(path.join(directory, "SessionComposer.jsx"), "utf8");
  const surfaceSource = fs.readFileSync(path.join(directory, "SessionSurface.jsx"), "utf8");
  assert.doesNotMatch(composerSource, /BASELINE_SLASH_COMMANDS/);
  assert.match(surfaceSource, /rpcFeatures\.includes\(COMMAND_DOOR_FEATURE\)/);
  assert.match(surfaceSource, /commandDoorAvailable \? slashCommands : \[\]/);
});

test("command door: connection, feature, list, invoke, and park failures stay distinct", () => {
  const messages = [
    "haider_command_no_connection",
    "haider_command_feature_missing",
    "haider_command_list_failed",
    "haider_command_invoke_failed",
    "haider_command_park_failed",
  ].map((code) => commandFailureMessage(code));
  assert.equal(new Set(messages).size, messages.length);
});
