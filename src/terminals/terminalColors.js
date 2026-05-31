export const TODO_QUEUE_DEFAULT_DOT_COLOR = "#8bb8ff";

export const TERMINAL_AGENT_COLOR_HEX_BY_SLOT = [
  "#ff9d48",
  "#3ccb7f",
  "#e5c45f",
  "#68d8d6",
  "#f46d8a",
  "#aac66d",
  "#d0d7e6",
  "#c084fc",
  "#ffbf66",
  "#7bdc9d",
  "#ff8a9c",
  "#56d0b6",
  "#d8b34d",
  "#9fb6d9",
  "#f0f4ff",
  "#f7a8ff",
];

const RESERVED_TERMINAL_COLORS = new Set([
  TODO_QUEUE_DEFAULT_DOT_COLOR.toLowerCase(),
]);

export function normalizeTerminalColorSlot(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function normalizeTerminalHexColor(value) {
  if (typeof value !== "string") {
    return "";
  }

  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color) || RESERVED_TERMINAL_COLORS.has(color)) {
    return "";
  }

  return color;
}

export function terminalColorForSlot(value) {
  const slot = normalizeTerminalColorSlot(value) ?? 0;
  return TERMINAL_AGENT_COLOR_HEX_BY_SLOT[slot % TERMINAL_AGENT_COLOR_HEX_BY_SLOT.length];
}

export function sanitizeTerminalColor(value, fallbackSlot = 0) {
  return normalizeTerminalHexColor(value) || terminalColorForSlot(fallbackSlot);
}
