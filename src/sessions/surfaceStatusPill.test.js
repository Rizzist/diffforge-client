import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { surfaceStatusPillTone } from "./surfaceStatusPillTone.js";

const pillSource = readFileSync(
  fileURLToPath(new URL("./SurfaceStatusPill.jsx", import.meta.url)),
  "utf8",
);

test("healthy connected sessions read the green 'good' tone", () => {
  assert.equal(
    surfaceStatusPillTone({ status: "idle", state_raw: "idle" }, { status: "idle" }, null),
    "good",
  );
  assert.equal(
    surfaceStatusPillTone({ status: "running", run_id: "r1", run_state: "running" }, { status: "running" }, null),
    "good",
  );
});

test("a human-wait reads 'warn', an error reads 'bad'", () => {
  assert.equal(
    surfaceStatusPillTone({ status: "waiting", run_id: "r1", run_state: "waiting" }, { status: "waiting" }, null),
    "warn",
  );
  assert.equal(surfaceStatusPillTone({ status: "error" }, { status: "error" }, null), "bad");
});

test("availability degradation outranks a stale idle bucket (never fake-green)", () => {
  const idleSession = { status: "idle", state_raw: "idle" };
  assert.equal(
    surfaceStatusPillTone(idleSession, { status: "unavailable" }, { reason: "daemon-unavailable" }),
    "bad",
  );
  assert.equal(
    surfaceStatusPillTone(idleSession, { status: "unavailable" }, { reason: "not-published" }),
    "warn",
  );
  // Legacy provenance can't be verified either way → neutral, not green.
  assert.equal(
    surfaceStatusPillTone(idleSession, { status: "unavailable" }, { reason: "legacy-provenance" }),
    "",
  );
});

test("a genuinely unknown state stays neutral rather than reassuring", () => {
  assert.equal(surfaceStatusPillTone({}, {}, null), "");
});

// Wiring pins — SSR of the JSX pill isn't possible under `node --test` (it
// pulls modelBrand.jsx's SVG JSX, which node can't transpile), so the header
// wiring is pinned by the source structure. Mutation-check target: delete the
// <ModelBrandIcon .../> line below and this test fails.
test("the header pill leads with the model/provider brand mark", () => {
  assert.match(pillSource, /import \{ ModelBrandIcon \} from ".\/modelBrand\.jsx"/);
  assert.match(
    pillSource,
    /<StatusPill[\s\S]*?<ModelBrandIcon[\s\S]*?model=\{session\?\.model\}[\s\S]*?provider=\{session\?\.provider\}[\s\S]*?<\/StatusPill>/,
    "ModelBrandIcon sits inside the StatusPill, fed the session model + provider",
  );
});

test("the pill drives its ring/label from the truthful tone, per theme tokens", () => {
  assert.match(pillSource, /data-status-tone=\{tone/);
  assert.match(pillSource, /data-status-tone="good"[\s\S]*?--forge-green-rgb/);
  assert.match(pillSource, /data-status-tone="warn"[\s\S]*?--forge-amber/);
  assert.match(pillSource, /data-status-tone="bad"[\s\S]*?--forge-red/);
});
