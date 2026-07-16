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

const loopspaceViewAliases = [
  "loopspace_view",
  "loops_view",
  "show_loopspaces",
  "open_loopspaces",
];
const loopspaceSelectAliases = [
  "loopspace_select",
  "select_loopspace",
  "open_loopspace",
];

test("loopspace navigation aliases bypass the selected-workspace requirement", () => {
  const deviceOnlyClassifier = sourceBetween(
    "const remoteCommandIsDeviceOnlyNavigationAction",
    "const remoteCommandWorkspaceTab",
  );
  for (const alias of [...loopspaceViewAliases, ...loopspaceSelectAliases]) {
    assert.match(deviceOnlyClassifier, new RegExp(`["]${alias}["]`));
  }

  const workspaceGate = sourceBetween(
    "const requiresWorkspace = remoteCommandOptionalBooleanField",
    "if (!claimRemoteCommandReceipt",
  );
  assert.match(workspaceGate, /&& !deviceOnlyNavigationAction/);
});

test("loopspace view keeps its dedicated completed navigation handler", () => {
  const handler = sourceBetween(
    "if ([\n        \"loopspace_view\"",
    "if ([\n        \"loopspace_select\"",
  );
  for (const alias of loopspaceViewAliases) {
    assert.match(handler, new RegExp(`["]${alias}["]`));
  }
  assert.match(handler, /enterLoopspacesMode\("remote_control_navigation"\)/);
  assert.match(handler, /recordRemoteCommandStatus\(event, "completed", "Opened Loopspaces on this desktop\."/);
});

test("loopspace selection reports whether a current loopspace was actually selected", () => {
  const selector = sourceBetween(
    "const selectLoopspaceFromRail = useCallback",
    "const deactivateWorkspace = useCallback",
  );
  assert.match(selector, /if \(!loopspace\) \{\s+return false;/);
  assert.match(selector, /setSelectedLoopspaceId\(loopspace\.id\);[\s\S]*return true;/);

  const handler = sourceBetween(
    "if ([\n        \"loopspace_select\"",
    "if ([\n        \"provider_auth_start\"",
  );
  assert.match(handler, /const didSelectLoopspace = selectLoopspaceFromRail\(loopspaceId\);/);
  assert.match(handler, /if \(!didSelectLoopspace\)/);
  assert.match(handler, /recordRemoteCommandStatus\(event, "failed", "That loopspace is not available on this desktop\."/);
  assert.ok(
    handler.indexOf("if (!didSelectLoopspace)") < handler.indexOf("Selected loopspace ${loopspaceId}"),
    "completion is only recorded after the selection-success guard",
  );
});

test("the remote-command listener refreshes with the loopspace selector and catalog", () => {
  const effectTail = sourceBetween(
    "startRemoteCommandListener();\n    return () => {",
    "useEffect(() => {\n    let disposed = false;\n    const activeRuntimeWorkspaceIds",
  );
  const dependencyList = effectTail.slice(effectTail.lastIndexOf("}, ["));
  assert.match(dependencyList, /\bloopspaces\b/);
  assert.match(dependencyList, /\bselectLoopspaceFromRail\b/);
});
