import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");

test("persistent queue UI is feature-gated while own-submit confirmation is independent", () => {
  const surface = read("SessionSurface.jsx");
  const panel = read("SessionQueuePanel.jsx");
  assert.match(surface, /rpcFeatures\.includes\(FEATURE_QUEUE_CONTROL_V1\)/);
  assert.match(surface, /queueStateForFeatures\(rpcFeatures\)/);
  assert.match(panel, /if \(!confirmation && !presentation\.renderQueue\) return null/);
  assert.match(panel, /\{confirmation && \(/);
});

test("queue chips render authoritative row text directly and expose Steer delete overflow", () => {
  const panel = read("SessionQueuePanel.jsx");
  assert.match(panel, /<QueueText>\{row\.text\}<\/QueueText>/);
  assert.doesNotMatch(panel, /row\.text\.(?:trim|replace|slice)\(/);
  assert.match(panel, />\s*\{promoteBusy \? "Steering…" : "Steer"\}\s*<\/SteerButton>/);
  assert.match(panel, /aria-label="Delete queued message"/);
  assert.match(panel, /aria-label="Queued message details"/);
});

test("composer forwards its selected mode to the submit callback", () => {
  const composer = read("SessionComposer.jsx");
  assert.match(composer, /normalizeDeliveryMode\(deliveryMode\)/);
  assert.match(composer, /DELIVERY_MODES\.map/);
  assert.match(composer, /onDeliveryModeChange\(mode\.value\)/);
  assert.match(composer, /\{onCancelTurn && \(/);
  assert.match(composer, /aria-label="Stop"[\s\S]*aria-label="Send"/);
});
