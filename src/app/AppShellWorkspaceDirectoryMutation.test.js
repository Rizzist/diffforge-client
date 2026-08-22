import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const appShellSource = await readFile(path.join(appDir, "AppShell.jsx"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = appShellSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = appShellSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return appShellSource.slice(start, end);
}

test("workspace directory mutations preserve raw path strings", () => {
  const extractor = sourceBetween(
    "const remoteCommandRawStringField",
    "const remoteCommandBooleanField",
  );
  assert.match(extractor, /typeof value === "string"/);
  assert.match(extractor, /return value;/);
  assert.doesNotMatch(extractor, /\.trim\(\)/);
});

test("GUI remote dispatcher invokes all workspace directory mutation commands", () => {
  const handler = sourceBetween(
    '"workspace_directory_create",\n        "workspace_directory_remove",',
    'if (["workspace_create", "create_workspace"].includes(normalizedKind))',
  );
  for (const command of [
    "workspace_directory_create",
    "workspace_directory_remove",
    "workspace_directory_rename",
  ]) {
    assert.match(handler, new RegExp(command));
  }
  assert.match(handler, /invoke\(mutationCommand, invokePayload\)/);
  assert.match(handler, /base_path: basePath/);
  assert.match(handler, /relative_path: relativePath/);
  assert.match(handler, /create_parents/);
  assert.match(handler, /recursive/);
  assert.match(handler, /new_name/);
  assert.match(handler, /remoteCommandRawBooleanField\(event, \["recursive"\]\)/);
  assert.doesNotMatch(handler, /invokePayload\.recursive = remoteCommandBooleanField/);
  assert.match(handler, /error_code: error\?\.code \|\| error\?\.error_code/);
});

test("workspace directory mutations bypass the existing-workspace gate", () => {
  const gate = sourceBetween(
    "const workspaceOptionalAction = [",
    "if (\n            !workspaceId",
  );
  for (const command of [
    "workspace_directory_create",
    "workspace_directory_remove",
    "workspace_directory_rename",
  ]) {
    assert.match(gate, new RegExp(command));
  }
});
