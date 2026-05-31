import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_DEFAULT_DOT_COLOR,
  TERMINAL_AGENT_COLOR_HEX_BY_SLOT,
  normalizeTerminalHexColor,
  sanitizeTerminalColor,
  terminalColorForSlot,
} from "./terminalColors.js";

test("terminal palette reserves the default todo dot color", () => {
  assert.equal(
    TERMINAL_AGENT_COLOR_HEX_BY_SLOT.includes(TODO_QUEUE_DEFAULT_DOT_COLOR),
    false,
  );
});

test("reserved todo color is not accepted as a terminal color", () => {
  assert.equal(normalizeTerminalHexColor("#8BB8FF"), "");
  assert.equal(sanitizeTerminalColor("#8BB8FF", 1), terminalColorForSlot(1));
});

test("terminal colors normalize valid hex and fall back by slot", () => {
  assert.equal(normalizeTerminalHexColor(" #FF9D48 "), "#ff9d48");
  assert.equal(sanitizeTerminalColor("not-a-color", 2), terminalColorForSlot(2));
});
