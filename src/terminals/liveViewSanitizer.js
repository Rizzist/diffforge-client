const ESC = "\u001b";
const C1_CSI = "\u009b";
const C1_DCS = "\u0090";
const C1_OSC = "\u009d";
const C1_PM = "\u009e";
const C1_APC = "\u009f";
const C1_ST = "\u009c";
const MAX_PENDING_CONTROL_SEQUENCE = 8192;
const MAX_PENDING_LINE_CHARS = 2000;
const MAX_RECENT_LINES = 160;

function isCsiFinalCode(codePoint) {
  return codePoint >= 0x40 && codePoint <= 0x7e;
}

function isEscapeIntermediateCode(codePoint) {
  return codePoint >= 0x20 && codePoint <= 0x2f;
}

function isEscapeFinalCode(codePoint) {
  return codePoint >= 0x30 && codePoint <= 0x7e;
}

function findStringTerminatorIndex(input, start) {
  for (let index = start; index < input.length; index += 1) {
    const codePoint = input.charCodeAt(index);
    if (codePoint === 0x07 || codePoint === 0x9c) {
      return index + 1;
    }
    if (codePoint === 0x1b && input.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }
  }

  return -1;
}

function findEscapeSequenceEndIndex(input, start) {
  let cursor = start;
  while (cursor < input.length && isEscapeIntermediateCode(input.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor >= input.length) {
    return -1;
  }

  return isEscapeFinalCode(input.charCodeAt(cursor)) ? cursor + 1 : start + 1;
}

function setPendingControlSequence(state, value) {
  const text = String(value || "");
  state.pendingControlSequence = text.length > MAX_PENDING_CONTROL_SEQUENCE ? "" : text;
}

function compactWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+$/g, "")
    .trimStart();
}

function rememberLine(state, line) {
  const key = compactWhitespace(line).toLowerCase();
  if (!key) {
    return;
  }
  state.recentLines.push(key);
  if (state.recentLines.length > MAX_RECENT_LINES) {
    state.recentLines.splice(0, state.recentLines.length - MAX_RECENT_LINES);
  }
}

function hasRecentLine(state, line) {
  const key = compactWhitespace(line).toLowerCase();
  return Boolean(key && state.recentLines.includes(key));
}

function normalizeFrameLine(value) {
  return stripLiveViewControlSequences(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[┌┐└┘╭╮╰╯│┃║]/g, " ")
    .replace(/[─━═]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBorderOrFrameLine(value) {
  const text = String(value || "").trim();
  return text.length > 0
    && /^[\s\-_=|+~`'".:;•·*─━═╭╮╰╯┌┐└┘│┃║\\/\u2500-\u257f]+$/.test(text)
    && /[\-_=|+─━═╭╮╰╯┌┐└┘│┃║\\/\u2500-\u257f]{3,}/.test(text);
}

function isCodexChromeLine(value) {
  const text = normalizeFrameLine(value);
  if (!text) {
    return true;
  }

  return /\bOpenAI Codex\b/i.test(text)
    || /^model\s*:/i.test(text)
    || /^(directory|cwd|workdir)\s*:/i.test(text)
    || /^gpt-[\w.-]+(?:\s+\w+)?\s*[·•]\s+\/.+/i.test(text)
    || /^(low|medium|high|xhigh)\s*[·•]\s+\/.+/i.test(text)
    || /^\/[^\s]+(?:\/[^\s]+)*$/.test(text)
    || /^Tip:\s+Try the Codex App\b/i.test(text)
    || /^landing-page=true\b/i.test(text)
    || /^https:\/\/chatgpt\.com\/codex\b/i.test(text)
    || /^Run ['"`]codex app['"`]/i.test(text);
}

function isPromptEchoLine(value) {
  const text = compactWhitespace(value);
  return /^([›>❯]\s*)+\S/.test(text)
    || /[›❯]\s*\S/.test(text)
    || /^•\s+.+[›❯]\s*\S/.test(text);
}

function isLiveViewArtifactLine(value, options = {}) {
  const agentKind = String(options.agentKind || "").toLowerCase();
  const text = compactWhitespace(value);
  if (!text) {
    return true;
  }
  if (isBorderOrFrameLine(text) || isPromptEchoLine(text)) {
    return true;
  }
  if (/\\?\]?(?:10|11);rgb:[0-9a-f/]+/i.test(text) || /\brgb:[0-9a-f/]+\b/i.test(text)) {
    return true;
  }
  if (agentKind === "codex" && isCodexChromeLine(text)) {
    return true;
  }
  return false;
}

export function isLiveViewArtifactText(value, options = {}) {
  const rawText = String(value || "");
  if (!rawText.trim()) {
    return true;
  }

  const cleanedText = cleanLiveViewText(rawText, options);
  if (!cleanedText) {
    return true;
  }

  const lines = cleanedText
    .split(/\n+/)
    .map(compactWhitespace)
    .filter(Boolean);

  return lines.length > 0 && lines.every((line) => isLiveViewArtifactLine(line, options));
}

function applyCsiToLine(state, sequence) {
  const finalCode = sequence[sequence.length - 1] || "";
  const body = sequence.slice(2, -1);
  const params = body
    .replace(/[?!><=]/g, "")
    .split(";")
    .map((value) => Number.parseInt(value, 10));
  const firstParam = Number.isFinite(params[0]) ? params[0] : 0;

  if (finalCode === "K") {
    if (firstParam === 1) {
      state.currentLine = state.currentLine.slice(state.cursorColumn);
      state.cursorColumn = 0;
    } else if (firstParam === 2) {
      state.currentLine = "";
      state.cursorColumn = 0;
    } else {
      state.currentLine = state.currentLine.slice(0, state.cursorColumn);
    }
    return;
  }

  if (finalCode === "J") {
    if (firstParam === 2 || firstParam === 3) {
      state.currentLine = "";
      state.cursorColumn = 0;
      state.pendingLines = [];
    }
    return;
  }

  if (finalCode === "G") {
    state.cursorColumn = Math.max(0, (firstParam || 1) - 1);
    return;
  }

  if (finalCode === "H" || finalCode === "f") {
    state.currentLine = "";
    state.cursorColumn = 0;
  }
}

function appendPrintable(state, character) {
  const before = state.currentLine.slice(0, state.cursorColumn);
  const after = state.currentLine.slice(state.cursorColumn + 1);
  state.currentLine = `${before}${character}${after}`;
  state.cursorColumn += 1;
  if (state.currentLine.length > MAX_PENDING_LINE_CHARS) {
    state.currentLine = state.currentLine.slice(-MAX_PENDING_LINE_CHARS);
    state.cursorColumn = Math.min(state.cursorColumn, state.currentLine.length);
  }
}

function pushCurrentLine(state) {
  const line = state.currentLine;
  state.currentLine = "";
  state.cursorColumn = 0;
  state.pendingLines.push(line);
}

export function createLiveViewSanitizer() {
  return {
    currentLine: "",
    cursorColumn: 0,
    pendingControlSequence: "",
    pendingLines: [],
    recentLines: [],
  };
}

export function sanitizeLiveViewOutput(state, data, options = {}) {
  const sanitizer = state || createLiveViewSanitizer();
  const input = `${sanitizer.pendingControlSequence || ""}${String(data || "")}`;
  let strippedControlSequences = 0;
  let index = 0;

  setPendingControlSequence(sanitizer, "");

  while (index < input.length) {
    const character = input[index] || "";
    const codePoint = input.charCodeAt(index);

    if (character === ESC) {
      const next = input[index + 1] || "";
      if (!next) {
        setPendingControlSequence(sanitizer, input.slice(index));
        break;
      }

      if (next === "[") {
        let cursor = index + 2;
        while (cursor < input.length && !isCsiFinalCode(input.charCodeAt(cursor))) {
          cursor += 1;
        }
        if (cursor >= input.length) {
          setPendingControlSequence(sanitizer, input.slice(index));
          break;
        }
        const sequence = input.slice(index, cursor + 1);
        applyCsiToLine(sanitizer, sequence);
        strippedControlSequences += 1;
        index = cursor + 1;
        continue;
      }

      if (next === "]" || next === "P" || next === "^" || next === "_" || next === "X") {
        const terminatorIndex = findStringTerminatorIndex(input, index + 2);
        if (terminatorIndex < 0) {
          setPendingControlSequence(sanitizer, input.slice(index));
          break;
        }
        strippedControlSequences += 1;
        index = terminatorIndex;
        continue;
      }

      const escapeEndIndex = findEscapeSequenceEndIndex(input, index + 1);
      if (escapeEndIndex < 0) {
        setPendingControlSequence(sanitizer, input.slice(index));
        break;
      }
      strippedControlSequences += 1;
      index = escapeEndIndex;
      continue;
    }

    if (character === C1_CSI) {
      let cursor = index + 1;
      while (cursor < input.length && !isCsiFinalCode(input.charCodeAt(cursor))) {
        cursor += 1;
      }
      if (cursor >= input.length) {
        setPendingControlSequence(sanitizer, input.slice(index));
        break;
      }
      applyCsiToLine(sanitizer, `\u001b[${input.slice(index + 1, cursor + 1)}`);
      strippedControlSequences += 1;
      index = cursor + 1;
      continue;
    }

    if (character === C1_DCS || character === C1_OSC || character === C1_PM || character === C1_APC) {
      const terminatorIndex = findStringTerminatorIndex(input, index + 1);
      if (terminatorIndex < 0) {
        setPendingControlSequence(sanitizer, input.slice(index));
        break;
      }
      strippedControlSequences += 1;
      index = terminatorIndex;
      continue;
    }

    if (character === C1_ST) {
      strippedControlSequences += 1;
      index += 1;
      continue;
    }

    if (codePoint === 0x0d) {
      sanitizer.cursorColumn = 0;
      if (input.charCodeAt(index + 1) === 0x0a) {
        pushCurrentLine(sanitizer);
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (codePoint === 0x0a) {
      pushCurrentLine(sanitizer);
      index += 1;
      continue;
    }

    if (codePoint === 0x09) {
      appendPrintable(sanitizer, "\t");
      index += 1;
      continue;
    }

    if (codePoint === 0x08 || codePoint === 0x7f) {
      sanitizer.cursorColumn = Math.max(0, sanitizer.cursorColumn - 1);
      sanitizer.currentLine = `${sanitizer.currentLine.slice(0, sanitizer.cursorColumn)}${sanitizer.currentLine.slice(sanitizer.cursorColumn + 1)}`;
      index += 1;
      continue;
    }

    if (codePoint < 0x20) {
      strippedControlSequences += 1;
      index += 1;
      continue;
    }

    appendPrintable(sanitizer, character);
    index += 1;
  }

  const lines = sanitizer.pendingLines.splice(0);
  const visibleLines = [];
  for (const line of lines) {
    const text = compactWhitespace(line);
    if (!text || isLiveViewArtifactLine(text, options) || hasRecentLine(sanitizer, text)) {
      continue;
    }
    visibleLines.push(text);
    rememberLine(sanitizer, text);
  }

  return {
    pendingControlSequence: sanitizer.pendingControlSequence || "",
    strippedControlSequences,
    text: visibleLines.length ? `${visibleLines.join("\n")}\n` : "",
  };
}

export function flushLiveViewOutput(state, options = {}) {
  const sanitizer = state || createLiveViewSanitizer();
  const text = compactWhitespace(sanitizer.currentLine);
  sanitizer.currentLine = "";
  sanitizer.cursorColumn = 0;
  if (!text || isLiveViewArtifactLine(text, options) || hasRecentLine(sanitizer, text)) {
    return "";
  }
  rememberLine(sanitizer, text);
  return `${text}\n`;
}

export function stripLiveViewControlSequences(value) {
  const sanitizer = createLiveViewSanitizer();
  sanitizeLiveViewOutput(sanitizer, value, {});
  return [
    ...sanitizer.pendingLines,
    sanitizer.currentLine,
  ]
    .map(compactWhitespace)
    .filter(Boolean)
    .join("\n");
}

export function cleanLiveViewText(value, options = {}) {
  const sanitizer = createLiveViewSanitizer();
  const firstPass = sanitizeLiveViewOutput(sanitizer, value, options).text;
  const finalLine = flushLiveViewOutput(sanitizer, options);
  return `${firstPass}${finalLine}`
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
