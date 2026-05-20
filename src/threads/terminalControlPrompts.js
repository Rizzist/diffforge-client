const TERMINAL_MODEL_PICKER_CONFIRMATION_PATTERN = /press\s+enter\s+to\s+confirm/i;
const TERMINAL_MODEL_PICKER_ESCAPE_PATTERN = /\besc(?:ape)?\b/i;
const TERMINAL_MODEL_PICKER_BACK_PATTERN = /\bgo\s+back\b/i;
const TERMINAL_MODEL_PICKER_ROW_PATTERN = /^\d+\.\s+gpt-[a-z0-9][a-z0-9._:/-]*(?:\s|$)/i;

export function normalizeTerminalControlPromptText(value) {
  let text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  while (/^[›❯❱>*•●○◉✓✔+\-]\s*/u.test(text)) {
    text = text.replace(/^[›❯❱>*•●○◉✓✔+\-]\s*/u, "").trim();
  }

  return text;
}

export function isTerminalModelPickerUiPrompt(value) {
  const text = normalizeTerminalControlPromptText(value);
  if (!text) {
    return false;
  }

  if (TERMINAL_MODEL_PICKER_ROW_PATTERN.test(text)) {
    return true;
  }

  return (
    TERMINAL_MODEL_PICKER_CONFIRMATION_PATTERN.test(text)
    && TERMINAL_MODEL_PICKER_ESCAPE_PATTERN.test(text)
    && TERMINAL_MODEL_PICKER_BACK_PATTERN.test(text)
  );
}

export function isTerminalControlHistoryPrompt(value) {
  return String(value || "").trimStart().startsWith("/")
    || isTerminalModelPickerUiPrompt(value);
}
