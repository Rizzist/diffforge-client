import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("tokenomics has daemon input without legacy live scanners", () => {
  const backend = source("src-tauri/src/tokenomics.rs");
  const scheduler = source("src-tauri/src/cloud_mcp.rs");
  const commands = source("src-tauri/src/lib.rs");
  const frontend = source("src/tokenomics/AccountTokenomicsView.jsx");
  const combined = [backend, scheduler, commands, frontend].join("\n");

  for (const retiredEntryPoint of [
    "fn tokenomics_scan_usage_for",
    "tokenomics_scan_realtime_usage",
    "fn tokenomics_resync_last_30_days",
    "cloud_mcp_start_tokenomics_source_watcher",
    "tokenomics_periodic_watch_roots",
    'invoke("tokenomics_scan_usage")',
  ]) {
    assert.equal(
      combined.includes(retiredEntryPoint),
      false,
      `legacy scanner implementation ${retiredEntryPoint} must stay removed`,
    );
  }

  assert.match(backend, /haider_rpc_ade::usage_report_rpc\(\)\.await/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS tokenomics_scan_state/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS tokenomics_rollups/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS tokenomics_cloud_rollups/);
  assert.match(backend, /tokenomics_rollups\([\s\S]*?device_id TEXT NOT NULL/);
  assert.match(backend, /tokenomics_cloud_rollups\([\s\S]*?device_id TEXT NOT NULL/);
});
