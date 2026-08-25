import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cliSnapshotFromStatuses,
  readCliInventoryPublication,
} from "./cliInventoryAvailability.js";

test("unavailable CLI inventory preserves its reason and has no list value", () => {
  assert.deepEqual(
    readCliInventoryPublication({
      state: "unavailable",
      reason: "Haider inventory is unavailable.",
    }),
    {
      state: "unavailable",
      statuses: null,
      reason: "Haider inventory is unavailable.",
    },
  );
});

test("healthy-empty CLI inventory requires an explicit published list", () => {
  assert.deepEqual(
    readCliInventoryPublication({ state: "published", statuses: [] }),
    { state: "published", statuses: [], reason: "" },
  );
  assert.throws(
    () => readCliInventoryPublication({ state: "published" }),
    /missing its statuses list/,
  );
});

test("CLI snapshots loudly reject unavailable or malformed status values", () => {
  assert.throws(
    () => cliSnapshotFromStatuses(null),
    /requires a published statuses array/,
  );
  assert.throws(
    () => cliSnapshotFromStatuses({}),
    /requires a published statuses array/,
  );
  assert.deepEqual(cliSnapshotFromStatuses([]), []);
});

test("Tools view fetches the typed inventory instead of fabricating an empty list", () => {
  const source = readFileSync(new URL("./ToolsWorkspaceView.jsx", import.meta.url), "utf8");
  assert.match(source, /invoke\("tools_agent_statuses"\)/);
  assert.match(source, /setCliState\("unavailable"\)/);
  assert.doesNotMatch(source, /const\s+list\s*=\s*\[\]\s*;/);
});

test("unavailable CLI publications short-circuit before checks and snapshot reporting", () => {
  const source = readFileSync(new URL("./ToolsWorkspaceView.jsx", import.meta.url), "utf8");
  const refreshStart = source.indexOf("const refreshCliStatuses = useCallback");
  const refreshEnd = source.indexOf("\n  useEffect(() =>", refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);
  const unavailableStart = refresh.indexOf('if (inventory.state === "unavailable")');
  const returnIndex = refresh.indexOf("return;", unavailableStart);
  const checksIndex = refresh.indexOf('invoke("tools_check_cli_binaries"');
  const reportIndex = refresh.indexOf('invoke("cloud_mcp_report_cli_snapshot"');

  assert.ok(unavailableStart >= 0, "refresh must branch on typed unavailability");
  assert.ok(returnIndex > unavailableStart, "unavailable inventory must return from refresh");
  assert.ok(returnIndex < checksIndex, "unavailable inventory reached catalog checks");
  assert.ok(returnIndex < reportIndex, "unavailable inventory reached snapshot publication");
});

test("Tools view renders unavailable inventory with its reason and without the CLI list", () => {
  const source = readFileSync(new URL("./ToolsWorkspaceView.jsx", import.meta.url), "utf8");
  const renderStart = source.indexOf('{section === "clis"');
  const render = source.slice(renderStart);

  assert.match(
    render,
    /cliState === "unavailable"[\s\S]*?<ToolsEmpty[^>]*data-state="unavailable"[^>]*role="status"[\s\S]*?\{cliError\}[\s\S]*?<\/ToolsEmpty>[\s\S]*?: cliState === "loading"/,
  );
  assert.ok(
    render.indexOf('cliState === "unavailable"') < render.indexOf('<CliList'),
    "unavailable branch must guard the normal CLI list",
  );
});
