import assert from "node:assert/strict";
import test from "node:test";

import { terminalHarnessPresentation } from "./terminalHarnessAvailability.js";

test("persisted legacy terminal harness values deserialize and render unavailable", () => {
  for (const persisted of ["codex", "claude", "opencode", "kimi", "grok-cli"]) {
    const row = JSON.parse(JSON.stringify({ role_id: persisted }));
    const presentation = terminalHarnessPresentation(row.role_id);
    assert.equal(presentation.availability, "unavailable", persisted);
    assert.equal(presentation.selectable, false, persisted);
    assert.match(presentation.reason, /no longer supported/i, persisted);
  }
});

test("Haider availability stays unknown until an authority publishes it", () => {
  assert.deepEqual(terminalHarnessPresentation("haider"), {
    availability: "unknown",
    id: "haider",
    label: "Haider",
    reason: "",
    selectable: true,
  });
  assert.equal(
    terminalHarnessPresentation("haider", { state: "unavailable", reason: "daemon offline" }).reason,
    "daemon offline",
  );
});
