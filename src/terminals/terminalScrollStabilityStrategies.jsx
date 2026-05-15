const TERMINAL_SCROLL_STABILITY_MODE_NORMALIZER = "normalizer";
const TERMINAL_AGENT_STABILITY_KINDS = new Set(["codex", "claude"]);
const TERMINAL_ESC = 0x1b;
const TERMINAL_CSI = 0x5b;
const TERMINAL_DEC_PRIVATE = 0x3f;
const TERMINAL_CSI_FINAL_MIN = 0x40;
const TERMINAL_CSI_FINAL_MAX = 0x7e;
const TERMINAL_CSI_ED = 0x4a;
const TERMINAL_CSI_DEC_SET = 0x68;
const TERMINAL_CSI_DEC_RESET = 0x6c;
const TERMINAL_MODE_SYNC_OUTPUT = 2026;
const TERMINAL_MAX_PENDING_ESCAPE_BYTES = 96;
const TERMINAL_WINDOWS_PTY_BACKEND = "conpty";
const TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES = new Set([
  1000,
  1002,
  1003,
  1006,
  1007,
  1047,
  1048,
  1049,
  2004,
  2026,
]);

function isWindowsTerminalHost() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = String(navigator.platform || "");
  const userAgent = String(navigator.userAgent || "");

  return /windows|win32|win64|wince/i.test(`${platform} ${userAgent}`);
}

function isMacTerminalHost() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = String(navigator.platform || "");
  const userAgent = String(navigator.userAgent || "");

  return /mac|darwin/i.test(`${platform} ${userAgent}`);
}

const TERMINAL_IS_WINDOWS_HOST = isWindowsTerminalHost();
const TERMINAL_IS_MACOS_HOST = isMacTerminalHost();

function getTerminalAgentScrollStabilityMode({
  agentKind = "",
  isMacHost = TERMINAL_IS_MACOS_HOST,
  isWindowsHost = TERMINAL_IS_WINDOWS_HOST,
} = {}) {
  if (!isMacHost && !isWindowsHost) {
    return "";
  }

  const resolvedAgentKind = String(agentKind || "").toLowerCase();
  return TERMINAL_AGENT_STABILITY_KINDS.has(resolvedAgentKind)
    ? TERMINAL_SCROLL_STABILITY_MODE_NORMALIZER
    : "";
}

function buildWindowsPtyOptions(info = null) {
  if (!TERMINAL_IS_WINDOWS_HOST) {
    return undefined;
  }

  const buildNumber = Number(info?.buildNumber ?? info?.build_number ?? 0);
  if (Number.isFinite(buildNumber) && buildNumber > 0) {
    return {
      backend: TERMINAL_WINDOWS_PTY_BACKEND,
      buildNumber,
    };
  }

  return {
    backend: TERMINAL_WINDOWS_PTY_BACKEND,
  };
}

function createTerminalOutputNormalizer({
  dropEraseDisplay2OutsideSync = false,
  enabled = false,
} = {}) {
  return {
    dropEraseDisplay2OutsideSync: Boolean(dropEraseDisplay2OutsideSync),
    droppedEraseDisplay2OutsideSync: 0,
    droppedEraseScrollback3: 0,
    droppedSyncEraseDisplay2: 0,
    enabled: Boolean(enabled),
    inSyncOutput: false,
    passedEraseDisplay2: 0,
    pendingEscape: new Uint8Array(0),
    syncBlocksEnded: 0,
    syncBlocksSeen: 0,
  };
}

function concatTerminalBytes(left, right) {
  if (!left?.byteLength) {
    return right;
  }
  if (!right?.byteLength) {
    return left;
  }

  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
}

function findTerminalCsiFinal(bytes, start) {
  for (let index = start; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte >= TERMINAL_CSI_FINAL_MIN && byte <= TERMINAL_CSI_FINAL_MAX) {
      return index;
    }
  }

  return -1;
}

function parseTerminalCsiParams(bytes, paramsStart, finalIndex) {
  const numbers = [];
  let value = "";

  for (let index = paramsStart; index < finalIndex; index += 1) {
    const byte = bytes[index];
    if (byte >= 0x30 && byte <= 0x39) {
      value += String.fromCharCode(byte);
      continue;
    }

    if (value) {
      numbers.push(Number.parseInt(value, 10));
      value = "";
    }
  }

  if (value) {
    numbers.push(Number.parseInt(value, 10));
  }

  return numbers.filter((number) => Number.isFinite(number));
}

function copyTerminalBytes(source, sourceStart, sourceEnd, target, targetStart) {
  const segment = source.subarray(sourceStart, sourceEnd);
  target.set(segment, targetStart);
  return targetStart + segment.byteLength;
}

function normalizeTerminalOutputBytes(normalizer, data, options = {}) {
  if (!normalizer?.enabled || !data?.byteLength) {
    return data;
  }

  const allowEraseDisplay2InSync = options.allowEraseDisplay2InSync === true;
  const allowEraseDisplay2OutsideSync = options.allowEraseDisplay2OutsideSync === true;
  const pendingEscape = normalizer.pendingEscape;
  const input = pendingEscape?.byteLength
    ? concatTerminalBytes(pendingEscape, data)
    : data;
  const output = new Uint8Array(input.byteLength);
  let outputOffset = 0;
  let index = 0;
  let changed = Boolean(pendingEscape?.byteLength);

  normalizer.pendingEscape = new Uint8Array(0);

  while (index < input.length) {
    if (input[index] === TERMINAL_ESC && index + 1 >= input.length) {
      normalizer.pendingEscape = input.subarray(index).slice();
      changed = true;
      break;
    }

    if (input[index] !== TERMINAL_ESC || input[index + 1] !== TERMINAL_CSI) {
      output[outputOffset] = input[index];
      outputOffset += 1;
      index += 1;
      continue;
    }

    const csiFinalIndex = findTerminalCsiFinal(input, index + 2);
    if (csiFinalIndex < 0) {
      const pending = input.subarray(index);
      if (pending.byteLength <= TERMINAL_MAX_PENDING_ESCAPE_BYTES) {
        normalizer.pendingEscape = pending.slice();
        changed = true;
        break;
      }

      outputOffset = copyTerminalBytes(input, index, input.length, output, outputOffset);
      index = input.length;
      break;
    }

    const finalByte = input[csiFinalIndex];
    const hasDecPrivatePrefix = input[index + 2] === TERMINAL_DEC_PRIVATE;
    const paramsStart = index + (hasDecPrivatePrefix ? 3 : 2);
    const params = parseTerminalCsiParams(input, paramsStart, csiFinalIndex);
    const firstParam = params.length > 0 ? params[0] : 0;

    if (
      hasDecPrivatePrefix
      && (finalByte === TERMINAL_CSI_DEC_SET || finalByte === TERMINAL_CSI_DEC_RESET)
    ) {
      if (params.includes(TERMINAL_MODE_SYNC_OUTPUT)) {
        normalizer.inSyncOutput = finalByte === TERMINAL_CSI_DEC_SET;
        if (normalizer.inSyncOutput) {
          normalizer.syncBlocksSeen += 1;
        } else {
          normalizer.syncBlocksEnded += 1;
        }
        changed = true;
      }

      outputOffset = copyTerminalBytes(input, index, csiFinalIndex + 1, output, outputOffset);
      index = csiFinalIndex + 1;
      continue;
    }

    if (!hasDecPrivatePrefix && finalByte === TERMINAL_CSI_ED) {
      if (firstParam === 3) {
        normalizer.droppedEraseScrollback3 += 1;
        changed = true;
        index = csiFinalIndex + 1;
        continue;
      }

      if (firstParam === 2) {
        if (normalizer.inSyncOutput && !allowEraseDisplay2InSync) {
          normalizer.droppedSyncEraseDisplay2 += 1;
          changed = true;
          index = csiFinalIndex + 1;
          continue;
        }

        if (normalizer.dropEraseDisplay2OutsideSync && !allowEraseDisplay2OutsideSync) {
          normalizer.droppedEraseDisplay2OutsideSync += 1;
          changed = true;
          index = csiFinalIndex + 1;
          continue;
        }

        normalizer.passedEraseDisplay2 += 1;
      }
    }

    outputOffset = copyTerminalBytes(input, index, csiFinalIndex + 1, output, outputOffset);
    index = csiFinalIndex + 1;
  }

  if (!changed && outputOffset === input.byteLength && input === data) {
    return data;
  }

  return output.slice(0, outputOffset);
}

export {
  TERMINAL_IS_MACOS_HOST,
  TERMINAL_IS_WINDOWS_HOST,
  TERMINAL_SCROLL_STABILITY_MODE_NORMALIZER,
  TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES,
  TERMINAL_WINDOWS_PTY_BACKEND,
  buildWindowsPtyOptions,
  createTerminalOutputNormalizer,
  getTerminalAgentScrollStabilityMode,
  normalizeTerminalOutputBytes,
};
