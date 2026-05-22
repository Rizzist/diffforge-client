const TERMINAL_MODEL_PICKER_CONFIRMATION_PATTERN = /press\s+enter\s+to\s+confirm/i;
const TERMINAL_MODEL_PICKER_ESCAPE_PATTERN = /\besc(?:ape)?\b/i;
const TERMINAL_MODEL_PICKER_BACK_PATTERN = /\bgo\s+back\b/i;
const TERMINAL_MODEL_PICKER_TITLE_PATTERN = /select\s+model(?:\s+and\s+effort)?/i;
const TERMINAL_MODEL_PICKER_EXACT_TITLE_PATTERN = /select\s+model\s+and\s+effort/i;
const TERMINAL_MODEL_PICKER_LEGACY_HELP_PATTERN = /access\s+legacy\s+models\s+by\s+running\s+codex\s+-m/i;
const TERMINAL_MODEL_PICKER_ROW_PATTERN = /^\d+\.\s+gpt-[a-z0-9][a-z0-9._:/-]*(?:\s|$)/i;
const TERMINAL_REASONING_PICKER_TITLE_PATTERN = /select\s+reasoning\s+level(?:\s+for\s+\S+)?/i;
const TERMINAL_REASONING_PICKER_ROW_PATTERN = /^\d+\.\s+(?:low|medium|high|xhigh|extra\s+high)(?:\s|$)/i;

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

  if (
    TERMINAL_MODEL_PICKER_ROW_PATTERN.test(text)
    || TERMINAL_REASONING_PICKER_ROW_PATTERN.test(text)
  ) {
    return true;
  }

  if (
    TERMINAL_MODEL_PICKER_LEGACY_HELP_PATTERN.test(text)
    || (
      TERMINAL_MODEL_PICKER_TITLE_PATTERN.test(text)
      && (
        TERMINAL_MODEL_PICKER_EXACT_TITLE_PATTERN.test(text)
        || /\bgpt-/.test(text)
      )
    )
    || TERMINAL_REASONING_PICKER_TITLE_PATTERN.test(text)
  ) {
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
