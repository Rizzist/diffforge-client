import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// SSR of the composer isn't possible under `node --test` (it imports
// modelBrand.jsx's SVG JSX, which node can't transpile), so the composer
// chip wiring is pinned by source structure. These assertions still break if
// the MODEL brand mark or any of the three chips is unwired.
const composerSource = readFileSync(
  fileURLToPath(new URL("./SessionComposer.jsx", import.meta.url)),
  "utf8",
);

test("the composer imports the shared model/provider brand mark", () => {
  assert.match(composerSource, /import \{ ModelBrandIcon \} from ".\/modelBrand\.jsx"/);
});

test("the MODEL chip leads with the brand mark for the session's real model", () => {
  assert.match(
    composerSource,
    /<Chip[\s\S]*?<ModelBrandIcon model=\{current\} provider=\{provider\} \/>[\s\S]*?<em>Model<\/em>/,
    "ModelBrandIcon renders inside the MODEL chip, driven by the reality values",
  );
});

test("the composer chips row renders MODEL, EFFORT, and PERMISSIONS", () => {
  const row = composerSource.match(/<ChipsRow>([\s\S]*?)<\/ChipsRow>/);
  assert.ok(row, "ChipsRow is present");
  const body = row[1];
  assert.match(body, /\{modelChip\(\)\}/, "MODEL chip");
  assert.match(body, /\{chip\("effort", "Effort"\)\}/, "EFFORT chip");
  assert.match(body, /\{permissionOverrideChip\(\)\}/, "PERMISSIONS chip");
});

test("the PERMISSIONS chip keeps its honest daemon-policy / auto-allow values", () => {
  assert.match(composerSource, /<em>Permissions<\/em>/);
  assert.match(composerSource, /autoAllow \? "Auto-allow" : "Daemon policy"/);
});
