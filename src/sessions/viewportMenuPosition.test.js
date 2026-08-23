import assert from "node:assert/strict";
import test from "node:test";
import { viewportMenuPosition } from "./viewportMenuPosition.js";

const menu = { width: 148, height: 76 };
const viewport = { width: 860, height: 600 };

test("title menu opens rightward from a left-side trigger", () => {
  assert.deepEqual(
    viewportMenuPosition({ left: 224, top: 32, bottom: 56 }, menu, viewport),
    { left: 224, top: 60 },
  );
});

test("title menu shifts left only when its right edge would clip", () => {
  const position = viewportMenuPosition(
    { left: 810, top: 32, bottom: 56 },
    menu,
    viewport,
  );

  assert.deepEqual(position, { left: 704, top: 60 });
  assert.equal(position.left + menu.width, viewport.width - 8);
});

test("title menu remains inside both sides of a viewport narrower than the panel", () => {
  const narrowViewport = { width: 132, height: 240 };
  const position = viewportMenuPosition(
    { left: 4, top: 20, bottom: 44 },
    menu,
    narrowViewport,
  );
  const renderedWidth = narrowViewport.width - 16;

  assert.equal(position.left, 8);
  assert.equal(position.left + renderedWidth, narrowViewport.width - 8);
});

test("title menu opens above and clamps vertically near the bottom edge", () => {
  assert.deepEqual(
    viewportMenuPosition({ left: 224, top: 570, bottom: 594 }, menu, viewport),
    { left: 224, top: 490 },
  );
});
