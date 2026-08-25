import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FEATURE_QUEUE_CONTROL_V1,
  sessionComposerDeliveryModeProps,
} from "./queueViewModel.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");

test("persistent queue UI is feature-gated while own-submit confirmation is independent", () => {
  const surface = read("SessionSurface.jsx");
  const panel = read("SessionQueuePanel.jsx");
  assert.match(surface, /queueControlAvailable\(rpcFeatures\)/);
  assert.match(surface, /queueStateForFeatures\(rpcFeatures\)/);
  assert.match(panel, /if \(!confirmation && !presentation\.renderQueue\) return null/);
  assert.match(panel, /\{confirmation && \(/);
});

test("queue_control_v1 exclusively supplies the delivery-mode chip callback", () => {
  const onChange = () => {};
  const absent = sessionComposerDeliveryModeProps([], onChange);
  assert.equal(
    Object.hasOwn(absent, "onDeliveryModeChange"),
    false,
    "composer callback must be absent without queue_control_v1",
  );
  assert.deepEqual(
    sessionComposerDeliveryModeProps([FEATURE_QUEUE_CONTROL_V1], onChange),
    { onDeliveryModeChange: onChange },
  );

  const surface = read("SessionSurface.jsx");
  assert.match(
    surface,
    /\{\.\.\.sessionComposerDeliveryModeProps\(\s*rpcFeatures,/,
    "the rendered composer must use the feature-gated prop seam",
  );
  assert.doesNotMatch(
    surface,
    /onDeliveryModeChange\s*=/,
    "SessionSurface must not install an unconditional delivery-mode callback",
  );
});

test("SessionSurface wires the feature-to-submit decision through the pinned pure seam", () => {
  const surface = read("SessionSurface.jsx");
  assert.match(
    surface,
    /effectiveSessionDeliveryMode\(rpcFeatures, requestedMode\)/,
    "production submission must call the feature-to-mode decision seam",
  );
  assert.match(
    surface,
    /const submitIntoSession = useCallback[\s\S]*?\}, \[[\s\S]*?rpcFeatures,[\s\S]*?\]\);/,
    "the submit callback must refresh when advertised features change",
  );
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
