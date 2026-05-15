import { getTerminalActualCellSize } from "./terminalResizeController";

const TERMINAL_DEFAULT_ROWS = 24;
const TERMINAL_GEOMETRY_TOLERANCE_PX = 3;
const TERMINAL_RENDERER_DOM_ROW_SNAPSHOT_LIMIT = 10;
const TERMINAL_DEC2026_SET_BYTES = new Uint8Array([0x1b, 0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36, 0x68]);
const TERMINAL_DEC2026_RESET_BYTES = new Uint8Array([0x1b, 0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36, 0x6c]);

export const TERMINAL_STABILITY_RUNTIME_SETTING_KEY = "diffforge.terminalStabilityRuntime.v1";
export const TERMINAL_STABILITY_RUNTIME_SETTING_CHANGED_EVENT =
  "forge-terminal-stability-runtime-setting-changed";
export const TERMINAL_STABILITY_RUNTIME_DEFAULT_ENABLED = false;
export const TERMINAL_SLASH_COMMAND_DIAGNOSTIC_AGENT_KINDS = new Set(["codex"]);
export const TERMINAL_SLASH_COMMAND_MAX_LINE_CHARS = 160;
export const TERMINAL_SLASH_COMMAND_PROBE_WINDOW_MS = 6000;
export const TERMINAL_SLASH_COMMAND_PROBE_DELAYS_MS = [0, 34, 120, 320, 900, 1800];
export const TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_DELAYS_MS = [0, 80, 240];
export const TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_THROTTLE_MS = 160;
export const TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_MS = 1800;
export const TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS = 140;
export const TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_DELAYS_MS = [140, 300, 620, 1100];
export const TERMINAL_CODEX_RESIZE_GATE_SETTLE_MS = 140;
export const TERMINAL_CODEX_RESIZE_GATE_RETRY_MS = 48;
export const TERMINAL_CODEX_RESIZE_GATE_MAX_MS = 900;
export const TERMINAL_CODEX_RESIZE_GATE_MAX_BYTES = 768 * 1024;
export const TERMINAL_CODEX_RESIZE_REPAINT_MIN_BYTES = 180;
export const TERMINAL_CODEX_RESIZE_PAINT_PROBE_WINDOW_MS = 5000;
export const TERMINAL_CODEX_RESIZE_PAINT_PROBE_DELAYS_MS = [0, 34, 120, 320];
export const TERMINAL_CODEX_RESIZE_OUTPUT_PROBE_THROTTLE_MS = 160;
export const TERMINAL_CODEX_RESIZE_SCROLLBACK_CLEANUP_MS = 900;
export const TERMINAL_CODEX_RESIZE_TOP_ARTIFACT_LOOKAHEAD_ROWS = 24;
export const TERMINAL_CODEX_RESIZE_TOP_BLANK_PREFIX_MAX_ROWS = 4;
export const TERMINAL_CODEX_RESIZE_ARTIFACT_PURGE_MAX_ROWS = 64;
export const TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS = 1200;
export const TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_DELAYS_MS = [0, 16, 50, 140, 320, 700];
export const TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER = 2;
export const TERMINAL_CLAUDE_RESIZE_BLANK_FRAME_GUARD_MS = 1800;
export const TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_CHARS = 48;
export const TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS = 2;
export const TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_RATIO = 0.72;
export const TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_SCAN_ROWS = 420;
export const TERMINAL_CLAUDE_RESIZE_REPAINT_SHAPE_MIN_MATCHED_CHARS = 96;
export const TERMINAL_CLAUDE_RESIZE_REPAINT_SHAPE_MIN_CHAR_RATIO = 0.44;
export const TERMINAL_STABILITY_RESIZE_PROBE_DELAYS_MS = [0, 80, 240, 700];
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_MS = 1800;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_DELAYS_MS = [0, 80, 240, 520, 1100, 1700];
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_OUTPUT_QUIET_MS = 180;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_REDRAW_QUIET_MS = 360;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_STABLE_PLAN_MS = 160;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_RETRY_MS = 120;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_RETRIES = 12;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_DELETE_ROWS = 160;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_CURRENT_LOOKBACK_ROWS = 12;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_SCAN_BACK_ROWS = 260;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_GAP_ROWS = 24;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_DUPLICATE_LOOKAHEAD_ROWS = 96;

export function getTerminalStabilityFeatureFlags({
  agentKind = "",
  isGenericTerminal = false,
} = {}) {
  const resolvedAgentKind = String(agentKind || "").toLowerCase();
  const isCodex = resolvedAgentKind === "codex";
  const isClaude = resolvedAgentKind === "claude";
  const isManagedAgent = !isGenericTerminal && (isCodex || isClaude);
  const usesNormalizerPipeline = isManagedAgent && (isCodex || isClaude);

  return {
    agentKind: resolvedAgentKind,
    diagnostics: isManagedAgent,
    dropEraseDisplay2OutsideSync: isCodex,
    enabled: usesNormalizerPipeline,
    isNativeBehavior: !usesNormalizerPipeline,
    normalizerPipeline: usesNormalizerPipeline,
    outputNormalizer: isCodex,
    outputNormalizerProfile: isCodex ? "codex" : "",
    resizeDiagnostics: isManagedAgent,
    resizeGate: isCodex,
    resizeLiveTailCleanup: isCodex,
    resizePaintProbe: isCodex,
    resizeRepaintCoalescing: isCodex,
    resizeScrollbackCleanup: isCodex,
    resizeTopArtifactPurge: isCodex,
    slashCommandDiagnostics: isCodex,
    slashMenuCloseResize: isCodex,
    claudeResizeBlankFrameGuard: isClaude,
    claudeResizeDuplicateRepaintGuard: isClaude,
    transientHeaderArtifactCleanup: isClaude,
    transientHeaderArtifactProfile: isClaude ? "claude" : "",
  };
}

export function normalizeTerminalStabilityRuntimeEnabled(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["0", "false", "off", "disabled", "no"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "on", "enabled", "yes"].includes(normalized)) {
      return true;
    }
  }

  return TERMINAL_STABILITY_RUNTIME_DEFAULT_ENABLED;
}

export function readTerminalStabilityRuntimeEnabled() {
  if (typeof window === "undefined") {
    return TERMINAL_STABILITY_RUNTIME_DEFAULT_ENABLED;
  }

  try {
    const storedValue = window.localStorage?.getItem?.(TERMINAL_STABILITY_RUNTIME_SETTING_KEY);
    if (storedValue == null) {
      return TERMINAL_STABILITY_RUNTIME_DEFAULT_ENABLED;
    }

    return normalizeTerminalStabilityRuntimeEnabled(storedValue);
  } catch (_error) {
    return TERMINAL_STABILITY_RUNTIME_DEFAULT_ENABLED;
  }
}

export function persistTerminalStabilityRuntimeEnabled(enabled) {
  const nextEnabled = normalizeTerminalStabilityRuntimeEnabled(enabled);

  if (typeof window !== "undefined") {
    try {
      window.localStorage?.setItem?.(
        TERMINAL_STABILITY_RUNTIME_SETTING_KEY,
        nextEnabled ? "true" : "false",
      );
    } catch (_error) {
      // The runtime toggle is convenience state; the default remains enabled if storage fails.
    }

    try {
      window.dispatchEvent(new CustomEvent(TERMINAL_STABILITY_RUNTIME_SETTING_CHANGED_EVENT, {
        detail: {
          enabled: nextEnabled,
        },
      }));
    } catch (_error) {
      // Older WebViews may reject CustomEvent construction; storage still carries the state.
    }
  }

  return nextEnabled;
}

export function listenTerminalStabilityRuntimeEnabled(listener) {
  if (typeof window === "undefined" || typeof listener !== "function") {
    return () => {};
  }

  const handleSettingChanged = (event) => {
    listener(normalizeTerminalStabilityRuntimeEnabled(event?.detail?.enabled));
  };
  const handleStorage = (event) => {
    if (event?.key === TERMINAL_STABILITY_RUNTIME_SETTING_KEY) {
      listener(normalizeTerminalStabilityRuntimeEnabled(event.newValue));
    }
  };

  window.addEventListener(TERMINAL_STABILITY_RUNTIME_SETTING_CHANGED_EVENT, handleSettingChanged);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(TERMINAL_STABILITY_RUNTIME_SETTING_CHANGED_EVENT, handleSettingChanged);
    window.removeEventListener("storage", handleStorage);
  };
}

export function createCodexResizeGateState() {
  return {
    active: false,
    epoch: 0,
    flushDueAt: 0,
    flushTimer: 0,
    lastObservedSize: null,
    lastOutputPaintProbeAt: 0,
    liveTailCleanupSequence: 0,
    liveTailCleanupUntil: 0,
    liveTailLastCleanedSignature: "",
    paintProbeSequence: 0,
    paintProbeUntil: 0,
    previousSize: null,
    queuedBytes: 0,
    queuedWrites: [],
    scrollbackCleanupAnchor: null,
    scrollbackCleanupLastHandledBaseY: 0,
    scrollbackCleanupLastTargetY: -1,
    scrollbackCleanupStartBaseY: 0,
    scrollbackCleanupStartedAtBottom: false,
    scrollbackCleanupStartViewportY: 0,
    scrollbackCleanupUntil: 0,
    startedAtBottom: false,
    startedAt: 0,
    startState: null,
    targetSize: null,
  };
}

export function createSlashCommandDiagnosticState() {
  return {
    active: false,
    commandName: "",
    commandPreview: "",
    keydownActive: false,
    keydownCommandName: "",
    keydownCommandPreview: "",
    keydownLine: "",
    lastLoggedPreview: "",
    lastKeydownLoggedPreview: "",
    lastOutputProbeAt: 0,
    lastSubmittedCommandName: "",
    lastSubmittedCommandPreview: "",
    line: "",
    probeSequence: 0,
    probeUntil: 0,
    sequence: 0,
  };
}

export function createCodexSlashMenuCloseCleanupState() {
  return {
    active: false,
    cleanupSequence: 0,
    cleanupUntil: 0,
    closeAction: "",
    closeReason: "",
    epoch: 0,
    lastOutputAt: 0,
    quietTimer: 0,
    resizeRequested: false,
    startedAt: 0,
  };
}

export function normalizeCodexResizeGateSize(size) {
  const cols = Number(size?.cols || 0);
  const rows = Number(size?.rows || 0);

  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
    return null;
  }

  return {
    cols: Math.floor(cols),
    rows: Math.floor(rows),
  };
}

export function codexResizeGateSizesEqual(left, right) {
  return Boolean(left)
    && Boolean(right)
    && Number(left.cols || 0) === Number(right.cols || 0)
    && Number(left.rows || 0) === Number(right.rows || 0);
}

export function getTerminalInputDebugFields(data) {
  const text = String(data || "");
  const bytes = Array.from(new TextEncoder().encode(text));

  return {
    bytes: bytes.length,
    chars: Array.from(text).length,
    controlByteHex: bytes
      .filter((byte) => byte < 32 || byte === 127)
      .slice(0, 12)
      .map((byte) => byte.toString(16).padStart(2, "0")),
    escapeCount: bytes.filter((byte) => byte === 0x1b).length,
    hasEscape: bytes.includes(0x1b),
    isBareEscape: bytes.length === 1 && bytes[0] === 0x1b,
    prefixHex: bytes.slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")),
    startsWithEscape: bytes[0] === 0x1b,
  };
}

export function stripTerminalControlSequences(text) {
  const value = String(text || "");
  let output = "";
  let index = 0;

  while (index < value.length) {
    const code = value.charCodeAt(index);

    if (code === 0x1b) {
      const next = value[index + 1] || "";

      if (next === "[") {
        index += 2;
        while (index < value.length) {
          const finalCode = value.charCodeAt(index);
          index += 1;
          if (finalCode >= 0x40 && finalCode <= 0x7e) {
            break;
          }
        }
        continue;
      }

      if (next === "]") {
        index += 2;
        while (index < value.length) {
          const currentCode = value.charCodeAt(index);
          if (currentCode === 0x07) {
            index += 1;
            break;
          }
          if (currentCode === 0x1b && value[index + 1] === "\\") {
            index += 2;
            break;
          }
          index += 1;
        }
        continue;
      }

      index += next ? 2 : 1;
      continue;
    }

    if (code >= 0x20 && code !== 0x7f) {
      output += value[index];
    }
    index += 1;
  }

  return output;
}

export function getTerminalOutputDebugFields(data) {
  const bytes = Array.from(data || []);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data || new Uint8Array());
  const displayText = stripTerminalControlSequences(text);
  const displayChars = Array.from(displayText);

  return {
    bytes: bytes.length,
    chars: displayChars.length,
    controlByteHex: bytes
      .filter((byte) => byte < 32 || byte === 127)
      .slice(0, 16)
      .map((byte) => byte.toString(16).padStart(2, "0")),
    controlBytes: bytes.filter((byte) => byte < 32 || byte === 127).length,
    escapeBytes: bytes.filter((byte) => byte === 0x1b).length,
    hasEscape: bytes.includes(0x1b),
    prefixHex: bytes.slice(0, 24).map((byte) => byte.toString(16).padStart(2, "0")),
    printableChars: displayChars.length,
    safePreview: displayChars
      .slice(0, 120)
      .join("")
      .trim(),
    startsWithEscape: bytes[0] === 0x1b,
    visibleChars: displayChars.filter((character) => !/\s/.test(character)).length,
  };
}

export function getTerminalOutputVisibleCharCount(data, maxCount = Number.POSITIVE_INFINITY) {
  if (!data?.length) {
    return 0;
  }

  let visibleChars = 0;
  let escapeMode = "";

  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];

    if (escapeMode === "csi") {
      if (byte >= 0x40 && byte <= 0x7e) {
        escapeMode = "";
      }
      continue;
    }

    if (escapeMode === "osc") {
      if (byte === 0x07) {
        escapeMode = "";
        continue;
      }
      if (byte === 0x1b && data[index + 1] === 0x5c) {
        index += 1;
        escapeMode = "";
      }
      continue;
    }

    if (byte === 0x1b) {
      const nextByte = data[index + 1];
      if (nextByte === 0x5b) {
        escapeMode = "csi";
        index += 1;
      } else if (nextByte === 0x5d) {
        escapeMode = "osc";
        index += 1;
      } else if (nextByte != null) {
        index += 1;
      }
      continue;
    }

    if (byte > 0x20 && byte !== 0x7f) {
      visibleChars += 1;
      if (visibleChars >= maxCount) {
        return visibleChars;
      }
    }
  }

  return visibleChars;
}

export function getTerminalOutputByteStats(data) {
  if (!data?.length) {
    return {
      controlBytes: 0,
      escapeBytes: 0,
      visibleChars: 0,
    };
  }

  let controlBytes = 0;
  let escapeBytes = 0;
  let visibleChars = 0;
  let escapeMode = "";

  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];

    if (byte < 0x20 || byte === 0x7f) {
      controlBytes += 1;
      if (byte === 0x1b) {
        escapeBytes += 1;
      }
    }

    if (escapeMode === "csi") {
      if (byte >= 0x40 && byte <= 0x7e) {
        escapeMode = "";
      }
      continue;
    }

    if (escapeMode === "osc") {
      if (byte === 0x07) {
        escapeMode = "";
        continue;
      }
      if (byte === 0x1b && data[index + 1] === 0x5c) {
        index += 1;
        escapeMode = "";
      }
      continue;
    }

    if (byte === 0x1b) {
      const nextByte = data[index + 1];
      if (nextByte === 0x5b) {
        escapeMode = "csi";
        index += 1;
      } else if (nextByte === 0x5d) {
        escapeMode = "osc";
        index += 1;
      } else if (nextByte != null) {
        index += 1;
      }
      continue;
    }

    if (byte > 0x20 && byte !== 0x7f) {
      visibleChars += 1;
    }
  }

  return {
    controlBytes,
    escapeBytes,
    visibleChars,
  };
}

export function getTerminalOutputControlProfile(data) {
  const profile = {
    cursorHomeCount: 0,
    eraseDisplayCount: 0,
    eraseLineCount: 0,
    hasCursorHome: false,
    hasEraseDisplay: false,
    hasEraseLine: false,
  };

  if (!data?.length) {
    return profile;
  }

  for (let index = 0; index < data.length - 1; index += 1) {
    if (data[index] !== 0x1b || data[index + 1] !== 0x5b) {
      continue;
    }

    let finalIndex = -1;
    for (let scanIndex = index + 2; scanIndex < data.length; scanIndex += 1) {
      const byte = data[scanIndex];
      if (byte >= 0x40 && byte <= 0x7e) {
        finalIndex = scanIndex;
        break;
      }
    }

    if (finalIndex < 0) {
      break;
    }

    const finalByte = data[finalIndex];
    let paramsText = "";
    for (let paramIndex = index + 2; paramIndex < finalIndex; paramIndex += 1) {
      const byte = data[paramIndex];
      if (
        (byte >= 0x30 && byte <= 0x39)
        || byte === 0x3b
      ) {
        paramsText += String.fromCharCode(byte);
      }
    }

    if (finalByte === 0x48 || finalByte === 0x66) {
      const parts = paramsText.length ? paramsText.split(";") : [];
      const row = parts.length > 0 && parts[0] !== "" ? Number(parts[0]) : 1;
      const column = parts.length > 1 && parts[1] !== "" ? Number(parts[1]) : 1;
      const isHome = parts.length <= 2
        && Number.isFinite(row)
        && Number.isFinite(column)
        && (row === 0 || row === 1)
        && (column === 0 || column === 1);

      if (isHome) {
        profile.cursorHomeCount += 1;
        profile.hasCursorHome = true;
      }
    } else if (finalByte === 0x4a) {
      profile.eraseDisplayCount += 1;
      profile.hasEraseDisplay = true;
    } else if (finalByte === 0x4b) {
      profile.eraseLineCount += 1;
      profile.hasEraseLine = true;
    }

    index = finalIndex;
  }

  return profile;
}

export function getTerminalBufferDiagnostics(terminal) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return null;
  }

  let nonEmptyViewportRows = 0;
  let wrappedViewportRows = 0;
  const viewportStart = Math.max(0, buffer.viewportY || 0);
  const viewportEnd = Math.min(buffer.length || 0, viewportStart + (terminal.rows || 0));

  for (let index = viewportStart; index < viewportEnd; index += 1) {
    const line = buffer.getLine(index);

    if (!line) {
      continue;
    }

    if (line.isWrapped) {
      wrappedViewportRows += 1;
    }

    if (line.translateToString(true).trim().length > 0) {
      nonEmptyViewportRows += 1;
    }
  }

  return {
    baseY: buffer.baseY,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    hasScrollback: Boolean(
      buffer.type !== "alternate"
      && (
        Number(buffer.baseY || 0) > 0
        || Number(buffer.length || 0) > Math.max(1, Number(terminal.rows) || TERMINAL_DEFAULT_ROWS)
      ),
    ),
    length: buffer.length,
    nonEmptyViewportRows,
    type: buffer.type || "",
    viewportY: buffer.viewportY,
    wrappedViewportRows,
  };
}

export function getTerminalElementDiagnostics(element) {
  if (!element) {
    return null;
  }

  const bounds = typeof element.getBoundingClientRect === "function"
    ? element.getBoundingClientRect()
    : null;
  const style = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
    ? window.getComputedStyle(element)
    : null;

  return {
    clientHeight: Math.round(Number(element.clientHeight || 0)),
    clientWidth: Math.round(Number(element.clientWidth || 0)),
    display: style?.display || "",
    offsetHeight: Math.round(Number(element.offsetHeight || 0)),
    offsetWidth: Math.round(Number(element.offsetWidth || 0)),
    overflowY: style?.overflowY || "",
    pointerEvents: style?.pointerEvents || "",
    rectHeight: bounds ? Math.round(Number(bounds.height || 0)) : 0,
    rectWidth: bounds ? Math.round(Number(bounds.width || 0)) : 0,
    scrollHeight: Math.round(Number(element.scrollHeight || 0)),
    scrollTop: Math.round(Number(element.scrollTop || 0)),
    visibility: style?.visibility || "",
  };
}

export function getTerminalCanvasDiagnostics(container) {
  const canvases = Array.from(container?.querySelectorAll?.("canvas") || []);

  return canvases.map((canvas, index) => {
    const style = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(canvas)
      : null;
    const bounds = typeof canvas.getBoundingClientRect === "function"
      ? canvas.getBoundingClientRect()
      : null;

    return {
      className: String(canvas.className || ""),
      clientHeight: Math.round(Number(canvas.clientHeight || 0)),
      clientWidth: Math.round(Number(canvas.clientWidth || 0)),
      height: Math.round(Number(canvas.height || 0)),
      index,
      opacity: style?.opacity || "",
      rectHeight: bounds ? Math.round(Number(bounds.height || 0)) : 0,
      rectTop: bounds ? Math.round(Number(bounds.top || 0)) : 0,
      rectWidth: bounds ? Math.round(Number(bounds.width || 0)) : 0,
      styleHeight: style?.height || "",
      styleTransform: style?.transform || "",
      styleWidth: style?.width || "",
      width: Math.round(Number(canvas.width || 0)),
    };
  });
}

export function getTerminalRowsDomSnapshot(
  container,
  limit = TERMINAL_RENDERER_DOM_ROW_SNAPSHOT_LIMIT,
) {
  const rowsElement = container?.querySelector?.(".xterm-rows") || null;
  const screenElement = container?.querySelector?.(".xterm-screen") || null;
  const textLayerElement = container?.querySelector?.(".xterm-text-layer") || null;
  const containerBounds = typeof container?.getBoundingClientRect === "function"
    ? container.getBoundingClientRect()
    : null;
  const rowsBounds = typeof rowsElement?.getBoundingClientRect === "function"
    ? rowsElement.getBoundingClientRect()
    : null;
  const rowLimit = Math.max(0, Math.floor(Number(limit || 0)));
  const rowElements = Array.from(rowsElement?.children || []).slice(0, rowLimit);

  return {
    childCount: Number(rowsElement?.children?.length || 0),
    firstRows: rowElements.map((rowElement, index) => {
      const bounds = typeof rowElement?.getBoundingClientRect === "function"
        ? rowElement.getBoundingClientRect()
        : null;
      const style = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(rowElement)
        : null;

      return {
        childCount: Number(rowElement?.children?.length || 0),
        className: String(rowElement?.className || ""),
        index,
        rectHeight: bounds ? Math.round(Number(bounds.height || 0)) : 0,
        rectLeft: bounds && containerBounds
          ? Math.round(Number(bounds.left || 0) - Number(containerBounds.left || 0))
          : 0,
        rectTop: bounds && containerBounds
          ? Math.round(Number(bounds.top || 0) - Number(containerBounds.top || 0))
          : 0,
        styleHeight: style?.height || "",
        styleTransform: style?.transform || "",
        text: sanitizeTerminalDiagnosticText(rowElement?.textContent || "", 180),
      };
    }),
    rowsElement: getTerminalElementDiagnostics(rowsElement),
    rowsRectTop: rowsBounds && containerBounds
      ? Math.round(Number(rowsBounds.top || 0) - Number(containerBounds.top || 0))
      : 0,
    screen: getTerminalElementDiagnostics(screenElement),
    textLayer: getTerminalElementDiagnostics(textLayerElement),
  };
}

export function getTerminalRendererPaintDiagnostics(terminal, container, scrollableElement) {
  const screenElement = container?.querySelector?.(".xterm-screen") || null;
  const viewportElement = container?.querySelector?.(".xterm-viewport") || null;
  const rowsElement = container?.querySelector?.(".xterm-rows") || null;
  const textLayerElement = container?.querySelector?.(".xterm-text-layer") || null;
  const cursorLayerElement = container?.querySelector?.(".xterm-cursor-layer") || null;
  const containerBounds = typeof container?.getBoundingClientRect === "function"
    ? container.getBoundingClientRect()
    : null;
  const screenBounds = typeof screenElement?.getBoundingClientRect === "function"
    ? screenElement.getBoundingClientRect()
    : null;
  const dimensions = terminal?._core?._renderService?.dimensions || {};
  const cssCanvas = dimensions?.css?.canvas || {};
  const cssCell = dimensions?.css?.cell || {};
  const deviceCanvas = dimensions?.device?.canvas || {};
  const deviceCell = dimensions?.device?.cell || {};
  const buffer = terminal?.buffer?.active;
  const rows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const baseY = Number(buffer?.baseY || 0);
  const viewportY = Number(buffer?.viewportY || 0);

  return {
    canvasCount: Number(container?.querySelectorAll?.("canvas")?.length || 0),
    canvases: getTerminalCanvasDiagnostics(container),
    cursorLayer: getTerminalElementDiagnostics(cursorLayerElement),
    liveRows: getTerminalBufferRowsDiagnostic(terminal, baseY, rows),
    paintBounds: {
      containerHeight: containerBounds ? Math.round(Number(containerBounds.height || 0)) : 0,
      cssPaintedBottom: container?.style?.getPropertyValue?.("--terminal-xterm-painted-bottom") || "",
      screenBottom: screenBounds && containerBounds
        ? Math.round(Number(screenBounds.bottom || 0) - Number(containerBounds.top || 0))
        : 0,
      unpaintedBottomPx: screenBounds && containerBounds
        ? Math.max(0, Math.round(Number(containerBounds.bottom || 0) - Number(screenBounds.bottom || 0)))
        : 0,
    },
    renderService: {
      actualCellHeight: Number(dimensions.actualCellHeight || 0),
      actualCellWidth: Number(dimensions.actualCellWidth || 0),
      cssCanvasHeight: Number(cssCanvas.height || 0),
      cssCanvasWidth: Number(cssCanvas.width || 0),
      cssCellHeight: Number(cssCell.height || 0),
      cssCellWidth: Number(cssCell.width || 0),
      deviceCanvasHeight: Number(deviceCanvas.height || 0),
      deviceCanvasWidth: Number(deviceCanvas.width || 0),
      deviceCellHeight: Number(deviceCell.height || 0),
      deviceCellWidth: Number(deviceCell.width || 0),
    },
    rowsDom: getTerminalRowsDomSnapshot(container),
    rowsElement: getTerminalElementDiagnostics(rowsElement),
    screen: getTerminalElementDiagnostics(screenElement),
    scrollable: getTerminalElementDiagnostics(scrollableElement),
    textLayer: getTerminalElementDiagnostics(textLayerElement),
    topBand: getTerminalTopBandDiagnostic(terminal),
    viewport: getTerminalElementDiagnostics(viewportElement),
    viewportRows: getTerminalBufferRowsDiagnostic(terminal, viewportY, rows),
  };
}

export function getTerminalModesDiagnostics(terminal) {
  try {
    const modes = terminal?.modes;

    return {
      applicationCursorKeysMode: Boolean(modes?.applicationCursorKeysMode),
      mouseTrackingMode: modes?.mouseTrackingMode || "unavailable",
      originMode: Boolean(modes?.originMode),
      sendFocusMode: Boolean(modes?.sendFocusMode),
      wraparoundMode: Boolean(modes?.wraparoundMode),
    };
  } catch (_error) {
    return {
      applicationCursorKeysMode: false,
      mouseTrackingMode: "unavailable",
      originMode: false,
      sendFocusMode: false,
      wraparoundMode: false,
    };
  }
}

export function getCsiParamNumbers(params) {
  if (!Array.isArray(params)) {
    return [];
  }

  const numbers = [];
  params.forEach((param) => {
    const values = Array.isArray(param) ? param : [param];
    values.forEach((value) => {
      const number = Number(value);
      if (Number.isFinite(number)) {
        numbers.push(number);
      }
    });
  });

  return numbers;
}

export function getFirstCsiParam(params, fallback = 0) {
  const numbers = getCsiParamNumbers(params);
  return numbers.length > 0 ? numbers[0] : fallback;
}

export function getTerminalCursorHomeDiagnostic(params) {
  const numbers = getCsiParamNumbers(params);

  if (numbers.length === 0) {
    return {
      isHome: true,
      variant: "bare",
    };
  }

  if (numbers.length > 2) {
    return {
      isHome: false,
      variant: "",
    };
  }

  const row = numbers[0] ?? 1;
  const column = numbers[1] ?? 1;
  const rowIsHome = row === 0 || row === 1;
  const columnIsHome = column === 0 || column === 1;

  if (!rowIsHome || !columnIsHome) {
    return {
      isHome: false,
      variant: "",
    };
  }

  return {
    isHome: true,
    variant: numbers.length === 1 ? "omitted_column" : "explicit",
  };
}

export function getWindowsTerminalCompactState(terminal, container, scrollableElement) {
  const buffer = getTerminalBufferDiagnostics(terminal) || {};
  const viewportElement = container?.querySelector?.(".xterm-viewport") || null;
  const screenElement = container?.querySelector?.(".xterm-screen") || null;
  const containerState = getTerminalElementDiagnostics(container) || {};
  const viewportState = getTerminalElementDiagnostics(viewportElement) || {};
  const screenState = getTerminalElementDiagnostics(screenElement) || {};
  const scrollableState = getTerminalElementDiagnostics(scrollableElement) || {};
  const cellSize = getTerminalActualCellSize(terminal);
  const cols = Number(terminal?.cols || 0);
  const rows = Number(terminal?.rows || 0);
  const cellWidth = Number(cellSize?.actualCellWidth || 0);
  const cellHeight = Number(cellSize?.actualCellHeight || 0);
  const validCellSize = Boolean(
    cellSize?.valid
    && Number.isFinite(cellWidth)
    && Number.isFinite(cellHeight)
    && cellWidth > 0
    && cellHeight > 0,
  );
  const expectedScreenWidth = validCellSize ? Math.round(cols * cellWidth) : 0;
  const expectedScreenHeight = validCellSize ? Math.round(rows * cellHeight) : 0;

  return {
    baseY: Number(buffer.baseY || 0),
    bufferLength: Number(buffer.length || 0),
    bufferType: buffer.type || "",
    cellHeight,
    cellWidth,
    cols,
    containerHeight: Number(containerState.clientHeight || 0),
    containerWidth: Number(containerState.clientWidth || 0),
    cursorX: Number(buffer.cursorX || 0),
    cursorY: Number(buffer.cursorY || 0),
    expectedScreenHeight,
    expectedScreenWidth,
    hasScrollback: Boolean(buffer.hasScrollback),
    mouseTrackingMode: getTerminalModesDiagnostics(terminal).mouseTrackingMode,
    rows,
    screenHeight: Number(screenState.clientHeight || 0),
    screenHeightDelta: Number(screenState.clientHeight || 0) - expectedScreenHeight,
    screenWidth: Number(screenState.clientWidth || 0),
    screenWidthDelta: Number(screenState.clientWidth || 0) - expectedScreenWidth,
    scrollableHeight: Number(scrollableState.clientHeight || 0),
    scrollableScrollHeight: Number(scrollableState.scrollHeight || 0),
    scrollableScrollTop: Number(scrollableState.scrollTop || 0),
    validCellSize,
    viewportHeight: Number(viewportState.clientHeight || 0),
    viewportScrollHeight: Number(viewportState.scrollHeight || 0),
    viewportScrollTop: Number(viewportState.scrollTop || 0),
    viewportWidth: Number(viewportState.clientWidth || 0),
    viewportY: Number(buffer.viewportY || 0),
  };
}

export function isWindowsTerminalGeometrySettled(state, targetSize) {
  if (!state || !targetSize) {
    return false;
  }

  if (Number(state.cols || 0) !== Number(targetSize.cols || 0)) {
    return false;
  }

  if (Number(state.rows || 0) !== Number(targetSize.rows || 0)) {
    return false;
  }

  if (!state.validCellSize) {
    return false;
  }

  if (
    state.containerHeight <= 0
    || state.containerWidth <= 0
    || state.screenHeight <= 0
    || state.screenWidth <= 0
    || state.viewportHeight <= 0
    || state.viewportWidth <= 0
  ) {
    return false;
  }

  const widthTolerance = Math.max(TERMINAL_GEOMETRY_TOLERANCE_PX, Math.ceil(Number(state.cellWidth || 0)));
  const heightTolerance = Math.max(TERMINAL_GEOMETRY_TOLERANCE_PX, Math.ceil(Number(state.cellHeight || 0)));

  return Math.abs(Number(state.screenWidthDelta || 0)) <= widthTolerance
    && Math.abs(Number(state.screenHeightDelta || 0)) <= heightTolerance;
}

function findTerminalByteSequence(data, sequence, fromIndex = 0) {
  if (!data?.length || !sequence?.length || sequence.length > data.length) {
    return -1;
  }

  const maxStart = data.length - sequence.length;
  for (let index = Math.max(0, fromIndex); index <= maxStart; index += 1) {
    let matched = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (data[index + offset] !== sequence[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return index;
    }
  }

  return -1;
}

export function concatTerminalByteArrays(chunks) {
  const totalBytes = chunks.reduce((total, chunk) => total + Number(chunk?.byteLength || 0), 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  chunks.forEach((chunk) => {
    if (!chunk?.byteLength) {
      return;
    }

    combined.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return combined;
}

export function coalesceCodexResizeRepaintBytes(data) {
  if (!data?.byteLength) {
    return {
      data,
      droppedBytes: 0,
      framesDropped: 0,
      framesSeen: 0,
    };
  }

  const frames = [];
  let searchIndex = 0;

  while (searchIndex < data.length) {
    const start = findTerminalByteSequence(data, TERMINAL_DEC2026_SET_BYTES, searchIndex);
    if (start < 0) {
      break;
    }

    const reset = findTerminalByteSequence(
      data,
      TERMINAL_DEC2026_RESET_BYTES,
      start + TERMINAL_DEC2026_SET_BYTES.length,
    );
    if (reset < 0) {
      break;
    }

    const end = reset + TERMINAL_DEC2026_RESET_BYTES.length;
    frames.push({ end, start });
    searchIndex = end;
  }

  if (frames.length <= 1) {
    return {
      data,
      droppedBytes: 0,
      framesDropped: 0,
      framesSeen: frames.length,
    };
  }

  let selectedFrameIndex = frames.length - 1;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame.end - frame.start >= TERMINAL_CODEX_RESIZE_REPAINT_MIN_BYTES) {
      selectedFrameIndex = index;
      break;
    }
  }

  const selectedFrame = frames[selectedFrameIndex];
  const output = data.slice(selectedFrame.start);

  return {
    data: output,
    droppedBytes: selectedFrame.start,
    framesDropped: selectedFrameIndex,
    framesSeen: frames.length,
  };
}

export function hashTerminalDiagnosticText(value) {
  const text = String(value || "");
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sanitizeTerminalDiagnosticText(value, maxLength = 140) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trimEnd()
    .slice(0, maxLength);
}

export function normalizeTerminalSemanticRowText(value, maxLength = 240) {
  return sanitizeTerminalDiagnosticText(value, maxLength)
    .replace(/\s+/g, " ")
    .trim();
}

function flushTerminalSemanticOutputRow(rows, value, maxRows, maxRowLength) {
  const text = normalizeTerminalSemanticRowText(value, maxRowLength);
  if (text) {
    rows.push(text);
  }

  return rows.length >= maxRows;
}

export function getTerminalOutputSemanticRows(data, {
  maxChars = 16000,
  maxRowLength = 240,
  maxRows = 120,
} = {}) {
  if (!data?.byteLength) {
    return [];
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const rows = [];
  let row = "";
  let index = 0;
  let consumedChars = 0;

  const flushRow = () => {
    const reachedLimit = flushTerminalSemanticOutputRow(rows, row, maxRows, maxRowLength);
    row = "";
    return reachedLimit;
  };

  while (index < text.length && rows.length < maxRows && consumedChars < maxChars) {
    const code = text.charCodeAt(index);

    if (code === 0x1b) {
      const next = text[index + 1] || "";

      if (next === "[") {
        index += 2;
        let final = "";
        while (index < text.length) {
          const finalCode = text.charCodeAt(index);
          final = text[index];
          index += 1;
          if (finalCode >= 0x40 && finalCode <= 0x7e) {
            break;
          }
        }

        if (
          final === "H"
          || final === "f"
          || final === "J"
          || final === "K"
          || final === "A"
          || final === "B"
          || final === "C"
          || final === "D"
          || final === "G"
        ) {
          flushRow();
        }
        continue;
      }

      if (next === "]") {
        index += 2;
        while (index < text.length) {
          const currentCode = text.charCodeAt(index);
          if (currentCode === 0x07) {
            index += 1;
            break;
          }
          if (currentCode === 0x1b && text[index + 1] === "\\") {
            index += 2;
            break;
          }
          index += 1;
        }
        flushRow();
        continue;
      }

      index += next ? 2 : 1;
      flushRow();
      continue;
    }

    if (code === 0x0d || code === 0x0a) {
      if (flushRow()) {
        break;
      }
      if (code === 0x0d && text.charCodeAt(index + 1) === 0x0a) {
        index += 1;
      }
      index += 1;
      continue;
    }

    if (code === 0x09) {
      row += " ";
      consumedChars += 1;
      index += 1;
      continue;
    }

    if (code >= 0x20 && code !== 0x7f) {
      row += text[index];
      consumedChars += 1;
    }
    index += 1;
  }

  flushRow();

  return rows;
}

function getTerminalRecentSemanticRowIndex(terminal, {
  maxRows = TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_SCAN_ROWS,
} = {}) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
      blob: "",
      bufferLength: 0,
      rowCount: 0,
      rows: [],
      rowSet: new Set(),
      scanStart: 0,
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Math.min(bufferLength, Number(buffer.baseY || 0)));
  const viewportY = Math.max(0, Math.min(bufferLength, Number(buffer.viewportY || 0)));
  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const scanEnd = bufferLength;
  const scanStart = Math.max(
    0,
    Math.min(viewportY, Math.max(0, baseY - terminalRows * 3)) - Math.max(0, Number(maxRows || 0)),
  );
  const rows = [];
  const rowSet = new Set();

  for (let rowIndex = scanStart; rowIndex < scanEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    const text = normalizeTerminalSemanticRowText(row.text);
    if (!text) {
      continue;
    }

    rows.push({
      hash: hashTerminalDiagnosticText(text),
      rowIndex,
      text,
      textLength: text.length,
    });
    rowSet.add(text);
  }

  return {
    available: true,
    baseY,
    blob: rows.map((row) => row.text).join(" "),
    bufferLength,
    rowCount: rows.length,
    rows,
    rowSet,
    scanStart,
    terminalRows,
    viewportY,
  };
}

function terminalSemanticRowMatchesExisting(rowText, existingRows) {
  if (!rowText || !existingRows?.available) {
    return false;
  }

  if (existingRows.rowSet.has(rowText)) {
    return true;
  }

  const textLength = rowText.length;
  if (textLength >= 16 && existingRows.blob.includes(rowText)) {
    return true;
  }

  if (textLength < 24) {
    return false;
  }

  return existingRows.rows.some((candidate) => {
    const candidateText = candidate.text || "";
    return candidateText.length >= 16
      && (rowText.includes(candidateText) || candidateText.includes(rowText));
  });
}

function isClaudeResizeDuplicateRepaintAllowedUniqueRow(rowText) {
  const text = normalizeTerminalSemanticRowText(rowText);

  return /^(?:[•✻*]\s*)?(?:Cooked|Sautéed|Thinking|Halted|Working)\b.*\b\d+s\b/i.test(text)
    || /\besc\s+to\s+interrupt\b/i.test(text)
    || /^❯\s*(?:$|[^\s].{0,40}$)/.test(text)
    || /^[?]\s+for\s+shortcuts\b/i.test(text)
    || /^(?:Set|Selected|Switched)\s+model\s+to\b/i.test(text)
    || /^Try\s+"?edit\s+<filepath/i.test(text)
    || /^In\s+\.gitignore/i.test(text);
}

function getClaudeResizeRepaintRowKind(rowText) {
  const text = normalizeTerminalSemanticRowText(rowText);

  if (!text) {
    return "blank";
  }
  if (/\bClaude Code\b\s+v?\d/i.test(text)) {
    return "header_title";
  }
  if (/\b(Haiku|Sonnet|Opus)\b/i.test(text) && /[·•.]/.test(text)) {
    return "header_model";
  }
  if (/(^|\s)(?:~\/|\/|[A-Za-z]:[\\/])\S+\s*$/.test(text)) {
    return "header_directory";
  }
  if (/^❯/.test(text)) {
    return "prompt";
  }
  if (/^[•⏺]\s+/.test(text)) {
    return "assistant";
  }
  if (isClaudeResizeDuplicateRepaintAllowedUniqueRow(text)) {
    return "transient";
  }

  return "content";
}

function getClaudeResizeRepaintShape(rows) {
  const kindCounts = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const kind = getClaudeResizeRepaintRowKind(row?.text || row);
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
  });

  const hasHeader = Number(kindCounts.header_title || 0) > 0
    || Number(kindCounts.header_model || 0) > 0
    || Number(kindCounts.header_directory || 0) > 0;
  const hasTranscript = Number(kindCounts.assistant || 0) > 0
    || Number(kindCounts.prompt || 0) > 0;
  const hasClaudeRepaintShape = hasHeader && hasTranscript;

  return {
    hasClaudeRepaintShape,
    hasHeader,
    hasTranscript,
    kindCounts,
  };
}

export function getClaudeResizeDuplicateRepaintDecision(terminal, data, {
  controlProfile = null,
  maxRows = 120,
} = {}) {
  const profile = controlProfile || {};
  if (!profile.hasCursorHome || !data?.byteLength) {
    return {
      reason: profile.hasCursorHome ? "empty_data" : "no_cursor_home",
      shouldDrop: false,
    };
  }

  const outputRows = getTerminalOutputSemanticRows(data, { maxRows });
  const comparableRows = outputRows
    .map((text, index) => ({
      index,
      text,
      textLength: text.length,
    }))
    .filter((row) => row.textLength >= 3);

  if (comparableRows.length < TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS) {
    return {
      comparableRows: comparableRows.length,
      outputRows: outputRows.length,
      reason: "too_few_comparable_rows",
      shouldDrop: false,
    };
  }

  const existingRows = getTerminalRecentSemanticRowIndex(terminal);
  if (!existingRows.available || existingRows.rowCount <= 0) {
    return {
      comparableRows: comparableRows.length,
      outputRows: outputRows.length,
      reason: "existing_rows_unavailable",
      shouldDrop: false,
    };
  }

  let matchedChars = 0;
  let matchedRows = 0;
  let blockingUniqueRows = 0;
  let blockingUniqueChars = 0;
  let uniqueSubstantialRows = 0;
  const sampleRows = [];
  const uniqueSampleRows = [];

  comparableRows.forEach((row) => {
    const matched = terminalSemanticRowMatchesExisting(row.text, existingRows);
    if (matched) {
      matchedRows += 1;
      matchedChars += row.textLength;
    } else if (row.textLength >= 12) {
      uniqueSubstantialRows += 1;
      if (!isClaudeResizeDuplicateRepaintAllowedUniqueRow(row.text)) {
        blockingUniqueRows += 1;
        blockingUniqueChars += row.textLength;
      }
      if (uniqueSampleRows.length < 4) {
        uniqueSampleRows.push(row.text);
      }
    }

    if (sampleRows.length < 6) {
      sampleRows.push({
        matched,
        text: sanitizeTerminalDiagnosticText(row.text, 120),
        textLength: row.textLength,
      });
    }
  });

  const comparableChars = comparableRows.reduce((total, row) => total + row.textLength, 0);
  const matchedRatio = comparableRows.length > 0 ? matchedRows / comparableRows.length : 0;
  const matchedCharRatio = comparableChars > 0 ? matchedChars / comparableChars : 0;
  const repaintShape = getClaudeResizeRepaintShape(comparableRows);
  const hasClaudeHeader = repaintShape.hasHeader;
  const meetsRowThreshold = matchedRows >= TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS;
  const meetsCharThreshold = matchedChars >= TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_CHARS
    || (hasClaudeHeader && matchedChars >= 28);
  const meetsRatioThreshold = matchedRatio >= TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_RATIO
    || matchedCharRatio >= TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_RATIO;
  const meetsClaudeRepaintShapeThreshold = repaintShape.hasClaudeRepaintShape
    && matchedRows >= TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS
    && matchedChars >= TERMINAL_CLAUDE_RESIZE_REPAINT_SHAPE_MIN_MATCHED_CHARS
    && matchedCharRatio >= TERMINAL_CLAUDE_RESIZE_REPAINT_SHAPE_MIN_CHAR_RATIO;
  const shouldDrop = meetsRowThreshold
    && meetsCharThreshold
    && (meetsRatioThreshold || meetsClaudeRepaintShapeThreshold)
    && blockingUniqueRows <= 0;
  const shouldDropByShape = !shouldDrop
    && meetsClaudeRepaintShapeThreshold
    && blockingUniqueRows <= 0;
  const shouldMaskFallback = !shouldDrop
    && !shouldDropByShape
    && meetsClaudeRepaintShapeThreshold
    && blockingUniqueRows <= 2
    && blockingUniqueChars <= 140;
  const finalShouldDrop = shouldDrop || shouldDropByShape;

  return {
    blockingUniqueChars,
    blockingUniqueRows,
    comparableChars,
    comparableRows: comparableRows.length,
    existingRows: existingRows.rowCount,
    hasClaudeHeader,
    matchedCharRatio,
    matchedChars,
    matchedRatio,
    matchedRows,
    repaintKindCounts: repaintShape.kindCounts,
    outputRows: outputRows.length,
    reason: finalShouldDrop
      ? "duplicate_content_repaint"
      : blockingUniqueRows > 0
        ? "contains_unique_substantial_rows"
        : !meetsRowThreshold
          ? "insufficient_matched_rows"
          : !meetsCharThreshold
            ? "insufficient_matched_chars"
            : "insufficient_match_ratio",
    sampleRows,
    scanStart: existingRows.scanStart,
    shouldMaskFallback,
    shouldDrop: finalShouldDrop,
    shouldDropByShape,
    uniqueSampleRows,
    uniqueSubstantialRows,
  };
}

export function isTerminalSlashCommandDiagnosticAgentKind(agentKind) {
  return TERMINAL_SLASH_COMMAND_DIAGNOSTIC_AGENT_KINDS.has(String(agentKind || "").toLowerCase());
}

export function getTerminalSlashCommandLineSnapshot(line) {
  const rawLine = String(line || "").slice(-TERMINAL_SLASH_COMMAND_MAX_LINE_CHARS);
  const commandText = rawLine.trimStart();
  const startsWithSlash = commandText.startsWith("/");
  const commandName = startsWithSlash
    ? (commandText.slice(1).match(/^[^\s]*/)?.[0] || "")
    : "";

  return {
    commandName: sanitizeTerminalDiagnosticText(commandName, 80),
    commandPreview: startsWithSlash
      ? sanitizeTerminalDiagnosticText(commandText, 120)
      : "",
    lineLength: rawLine.length,
    startsWithSlash,
  };
}

export function getTerminalSlashCommandInputSummary(data) {
  const text = String(data || "");
  const inputDebug = getTerminalInputDebugFields(text);

  return {
    ...inputDebug,
    hasBackspace: text.includes("\x7f") || text.includes("\b"),
    hasDelete: text.includes("\x1b[3~"),
    hasNewline: text.includes("\n"),
    hasReturn: text.includes("\r"),
    printablePreview: sanitizeTerminalDiagnosticText(stripTerminalControlSequences(text), 120),
  };
}

export function getTerminalRowTextDiagnostic(terminal, rowIndex) {
  const line = terminal?.buffer?.active?.getLine?.(rowIndex);
  const text = line?.translateToString?.(false) || "";
  const trimmed = text.trimEnd();

  return {
    hash: hashTerminalDiagnosticText(trimmed),
    isBlank: trimmed.trim().length <= 0,
    isWrapped: Boolean(line?.isWrapped),
    rowIndex: Math.max(0, Math.floor(Number(rowIndex || 0))),
    text: sanitizeTerminalDiagnosticText(trimmed),
    textLength: trimmed.length,
  };
}

export function getTerminalRowsTextDiagnostic(terminal, startIndex, rowCount) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
      rows: [],
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const start = Math.max(0, Math.min(bufferLength, Math.floor(Number(startIndex || 0))));
  const count = Math.max(1, Math.floor(Number(rowCount || 1)));
  const end = Math.max(start, Math.min(bufferLength, start + count));
  const rows = [];
  let blankRows = 0;
  let nonEmptyRows = 0;

  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    rows.push({
      ...row,
      offset: rowIndex - start,
    });

    if (row.isBlank) {
      blankRows += 1;
    } else {
      nonEmptyRows += 1;
    }
  }

  return {
    available: true,
    blankRows,
    bufferLength,
    end,
    nonEmptyRows,
    rowCount: rows.length,
    rows,
    start,
  };
}

export function getTerminalBufferRowsDiagnostic(terminal, startIndex, rowCount) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
      rowHashes: [],
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const start = Math.max(0, Math.min(bufferLength, Math.floor(Number(startIndex || 0))));
  const count = Math.max(1, Math.floor(Number(rowCount || terminal?.rows || TERMINAL_DEFAULT_ROWS)));
  const end = Math.max(start, Math.min(bufferLength, start + count));
  const rowHashes = [];
  let aggregateHash = "811c9dc5";
  let blankPrefixRows = 0;
  let blankSuffixRows = 0;
  let firstNonEmptyRow = -1;
  let lastNonEmptyRow = -1;
  let nonEmptyRows = 0;
  let wrappedRows = 0;

  for (let index = start; index < end; index += 1) {
    const line = buffer.getLine?.(index);
    const text = line?.translateToString?.(false) || "";
    const trimmed = text.trimEnd();
    const rowHash = hashTerminalDiagnosticText(trimmed);
    const isNonEmpty = trimmed.trim().length > 0;

    rowHashes.push(rowHash);
    aggregateHash = hashTerminalDiagnosticText(`${aggregateHash}:${rowHash}:${line?.isWrapped ? 1 : 0}`);

    if (line?.isWrapped) {
      wrappedRows += 1;
    }

    if (isNonEmpty) {
      nonEmptyRows += 1;
      if (firstNonEmptyRow < 0) {
        firstNonEmptyRow = index - start;
      }
      lastNonEmptyRow = index - start;
    } else if (nonEmptyRows === 0) {
      blankPrefixRows += 1;
    }
  }

  for (let offset = rowHashes.length - 1; offset >= 0; offset -= 1) {
    const line = buffer.getLine?.(start + offset);
    const trimmed = (line?.translateToString?.(false) || "").trimEnd();
    if (trimmed.trim().length > 0) {
      break;
    }
    blankSuffixRows += 1;
  }

  return {
    aggregateHash,
    available: true,
    baseY: Number(buffer.baseY || 0),
    blankPrefixRows,
    blankSuffixRows,
    bufferLength,
    cursorX: Number(buffer.cursorX || 0),
    cursorY: Number(buffer.cursorY || 0),
    end,
    firstNonEmptyRow,
    lastNonEmptyRow,
    nonEmptyRows,
    rowCount: end - start,
    rowHashes,
    start,
    viewportY: Number(buffer.viewportY || 0),
    wrappedRows,
  };
}

function getTerminalRowFingerprint(terminal, rowIndex) {
  const line = terminal?.buffer?.active?.getLine?.(rowIndex);
  const text = line?.translateToString?.(false) || "";
  const trimmed = text.trimEnd();
  const semanticHash = hashTerminalDiagnosticText(trimmed);

  return {
    hash: hashTerminalDiagnosticText(`${semanticHash}:${line?.isWrapped ? 1 : 0}`),
    isNonEmpty: trimmed.trim().length > 0,
    isWrapped: Boolean(line?.isWrapped),
    semanticHash,
    textLength: trimmed.length,
  };
}

export function getTerminalViewportAnchorDiagnostic(terminal, maxAnchorRows = 6) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
      rows: [],
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const viewportY = Math.max(0, Math.min(bufferLength, Number(buffer.viewportY || 0)));
  const visibleEnd = Math.max(viewportY, Math.min(bufferLength, viewportY + terminalRows));
  const rows = [];

  for (let index = viewportY; index < visibleEnd && rows.length < maxAnchorRows; index += 1) {
    const fingerprint = getTerminalRowFingerprint(terminal, index);
    if (!fingerprint.isNonEmpty) {
      continue;
    }

    rows.push({
      hash: fingerprint.hash,
      isWrapped: fingerprint.isWrapped,
      offset: index - viewportY,
      semanticHash: fingerprint.semanticHash,
      textLength: fingerprint.textLength,
    });
  }

  return {
    available: rows.length > 0,
    baseY: Number(buffer.baseY || 0),
    bufferLength,
    firstOffset: rows[0]?.offset ?? 0,
    maxOffset: rows.reduce((max, row) => Math.max(max, Number(row.offset || 0)), 0),
    rowCount: rows.length,
    rows,
    terminalRows,
    viewportY,
  };
}

function scoreTerminalViewportAnchorAt(terminal, anchor, candidateViewportY) {
  const anchorRows = Array.isArray(anchor?.rows) ? anchor.rows : [];
  if (!anchorRows.length) {
    return {
      matches: 0,
      requiredMatches: 1,
    };
  }

  let matches = 0;
  anchorRows.forEach((anchorRow) => {
    const rowIndex = candidateViewportY + Number(anchorRow.offset || 0);
    const fingerprint = getTerminalRowFingerprint(terminal, rowIndex);
    if (
      fingerprint.hash === anchorRow.hash
      && fingerprint.isWrapped === anchorRow.isWrapped
    ) {
      matches += 1;
    }
  });

  return {
    matches,
    requiredMatches: Math.min(3, Math.max(1, anchorRows.length)),
  };
}

export function findTerminalViewportAnchorMatch(terminal, anchor, preferredViewportY) {
  const buffer = terminal?.buffer?.active;
  const anchorRows = Array.isArray(anchor?.rows) ? anchor.rows : [];

  if (!buffer || !anchor?.available || !anchorRows.length) {
    return {
      matched: false,
      matches: 0,
      preferredViewportY: 0,
      viewportY: -1,
    };
  }

  const baseY = Math.max(0, Number(buffer.baseY || 0));
  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const maxOffset = Math.max(0, Number(anchor.maxOffset || 0));
  const maxCandidate = Math.max(0, Math.min(baseY, bufferLength - maxOffset - 1));
  const preferred = Math.max(0, Math.min(maxCandidate, Math.floor(Number(preferredViewportY || 0))));
  const requiredMatches = Math.min(3, Math.max(1, anchorRows.length));
  let best = null;

  const consider = (candidateViewportY) => {
    const candidate = Math.max(0, Math.min(maxCandidate, Math.floor(Number(candidateViewportY || 0))));
    const score = scoreTerminalViewportAnchorAt(terminal, anchor, candidate);
    if (score.matches < requiredMatches) {
      return;
    }

    const distance = Math.abs(candidate - preferred);
    if (
      !best
      || score.matches > best.matches
      || (score.matches === best.matches && distance < best.distance)
    ) {
      best = {
        distance,
        matches: score.matches,
        viewportY: candidate,
      };
    }
  };

  const nearStart = Math.max(0, preferred - 40);
  const nearEnd = Math.min(maxCandidate, preferred + 40);
  for (let candidate = nearStart; candidate <= nearEnd; candidate += 1) {
    consider(candidate);
  }

  if (!best) {
    for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
      if (candidate >= nearStart && candidate <= nearEnd) {
        continue;
      }
      consider(candidate);
    }
  }

  if (!best) {
    return {
      matched: false,
      matches: 0,
      preferredViewportY: preferred,
      requiredMatches,
      viewportY: -1,
    };
  }

  return {
    distance: best.distance,
    matched: true,
    matches: best.matches,
    preferredViewportY: preferred,
    requiredMatches,
    viewportY: best.viewportY,
  };
}

export function isCodexBannerTopBorderText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return /^╭[─\s]+╮?$/.test(text);
}

export function isCodexBannerBottomBorderText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return /^╰[─\s]+╯?$/.test(text);
}

export function isCodexBannerTitleText(value) {
  return /OpenAI Codex/.test(sanitizeTerminalDiagnosticText(value));
}

export function isCodexResizeBannerArtifactText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return text.length <= 0
    || isCodexBannerTopBorderText(text)
    || isCodexBannerBottomBorderText(text)
    || isCodexBannerTitleText(text)
    || /^│\s*│?$/.test(text)
    || /^│\s*model:\s+/i.test(text)
    || /^│\s*directory:\s+/i.test(text)
    || /^│$/.test(text);
}

export function getCodexResizeTopArtifactAdjustment(terminal, candidateViewportY) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      adjusted: false,
      reason: "buffer_unavailable",
      viewportY: Math.max(0, Math.floor(Number(candidateViewportY || 0))),
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Math.min(bufferLength, Number(buffer.baseY || 0)));
  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const maxViewportY = Math.max(0, Math.min(baseY, bufferLength - 1));
  const viewportY = Math.max(0, Math.min(maxViewportY, Math.floor(Number(candidateViewportY || 0))));
  const distanceToLiveTop = baseY - viewportY;

  if (distanceToLiveTop <= 0) {
    return {
      adjusted: false,
      baseY,
      distanceToLiveTop,
      reason: "at_live_top",
      viewportY,
    };
  }

  if (distanceToLiveTop > terminalRows + 4) {
    return {
      adjusted: false,
      baseY,
      distanceToLiveTop,
      reason: "too_far_from_live_top",
      viewportY,
    };
  }

  const scanRows = Math.min(
    TERMINAL_CODEX_RESIZE_TOP_ARTIFACT_LOOKAHEAD_ROWS,
    Math.max(terminalRows, distanceToLiveTop + 8),
  );
  const scanEnd = Math.max(viewportY, Math.min(bufferLength, viewportY + scanRows));
  const preLiveBlankRows = [];
  const preLiveNonBlankRows = [];
  const preLiveTopBorderRows = [];
  const preLiveTitleRows = [];
  const liveTitleRows = [];

  for (let rowIndex = viewportY; rowIndex < scanEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);

    if (rowIndex < baseY) {
      if (row.isBlank) {
        preLiveBlankRows.push(rowIndex);
      } else {
        preLiveNonBlankRows.push(rowIndex);
      }

      if (isCodexBannerTopBorderText(row.text)) {
        preLiveTopBorderRows.push(rowIndex);
      }
    }

    if (!isCodexBannerTitleText(row.text)) {
      continue;
    }

    if (rowIndex < baseY) {
      preLiveTitleRows.push(rowIndex);
    } else {
      liveTitleRows.push(rowIndex);
    }
  }

  const hasRepeatedTopBorders = preLiveTopBorderRows.length >= 2;
  const hasStrayTopBorderBeforeLive = preLiveTopBorderRows.length > 0 && liveTitleRows.length > 0;
  const hasBlankPrefixBeforeLive = preLiveBlankRows.length > 0
    && preLiveBlankRows.length <= TERMINAL_CODEX_RESIZE_TOP_BLANK_PREFIX_MAX_ROWS
    && preLiveNonBlankRows.length === 0
    && liveTitleRows.length > 0;
  const hasSplitBannerDuplicate = preLiveTitleRows.length > 0 && liveTitleRows.length > 0;

  if (
    !hasRepeatedTopBorders
    && !hasStrayTopBorderBeforeLive
    && !hasBlankPrefixBeforeLive
    && !hasSplitBannerDuplicate
  ) {
    return {
      adjusted: false,
      baseY,
      distanceToLiveTop,
      liveTitleRows,
      preLiveBlankRows,
      preLiveNonBlankRows,
      preLiveTitleRows,
      preLiveTopBorderRows,
      reason: "no_transient_banner_artifact",
      viewportY,
    };
  }

  return {
    adjusted: true,
    baseY,
    distanceToLiveTop,
    liveTitleRows,
    preLiveBlankRows,
    preLiveNonBlankRows,
    preLiveTitleRows,
    preLiveTopBorderRows,
    reason: hasRepeatedTopBorders
      ? "repeated_codex_banner_top_borders"
      : hasStrayTopBorderBeforeLive
        ? "stray_codex_banner_top_border_before_live"
        : hasBlankPrefixBeforeLive
          ? "blank_prefix_before_live_codex_banner"
          : "split_codex_banner_duplicate",
    viewportY: baseY,
    wasViewportY: viewportY,
  };
}

function getTerminalInternalActiveBuffer(terminal) {
  return terminal?._core?._bufferService?.buffer
    || terminal?._core?._bufferService?.buffers?.active
    || null;
}

export function adjustTerminalRowAfterDeletion(rowIndex, deleteStart, deleteCount) {
  const row = Math.max(0, Math.floor(Number(rowIndex || 0)));
  const start = Math.max(0, Math.floor(Number(deleteStart || 0)));
  const count = Math.max(0, Math.floor(Number(deleteCount || 0)));
  const end = start + count;

  if (count <= 0 || row < start) {
    return row;
  }

  if (row < end) {
    return start;
  }

  return Math.max(0, row - count);
}

export function getCodexResizeTopArtifactPurgePlan(terminal, topArtifactAdjustment) {
  const buffer = terminal?.buffer?.active;

  if (!buffer || !topArtifactAdjustment?.adjusted) {
    return {
      shouldPurge: false,
      reason: "not_adjusted",
    };
  }

  const baseY = Math.max(0, Math.floor(Number(topArtifactAdjustment.baseY || 0)));
  const start = Math.max(0, Math.floor(Number(
    topArtifactAdjustment.wasViewportY ?? topArtifactAdjustment.viewportY ?? 0,
  )));
  const rowCount = Math.max(0, baseY - start);

  if (rowCount <= 0) {
    return {
      shouldPurge: false,
      reason: "empty_range",
    };
  }

  if (rowCount > TERMINAL_CODEX_RESIZE_ARTIFACT_PURGE_MAX_ROWS) {
    return {
      shouldPurge: false,
      reason: "range_too_large",
      rowCount,
      start,
    };
  }

  const rows = [];
  const nonArtifactRows = [];
  let artifactRows = 0;
  let nonBlankRows = 0;

  for (let rowIndex = start; rowIndex < baseY; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    const isArtifact = isCodexResizeBannerArtifactText(row.text);
    rows.push(row);
    if (!row.isBlank) {
      nonBlankRows += 1;
    }
    if (isArtifact) {
      artifactRows += 1;
    } else {
      nonArtifactRows.push(row);
    }
  }

  if (nonArtifactRows.length > 0) {
    return {
      nonArtifactRows,
      reason: "range_contains_non_artifact_rows",
      rowCount,
      rows,
      shouldPurge: false,
      start,
    };
  }

  if (nonBlankRows <= 0 && !topArtifactAdjustment.liveTitleRows?.length) {
    return {
      reason: "blank_range_without_live_banner",
      rowCount,
      rows,
      shouldPurge: false,
      start,
    };
  }

  return {
    artifactRows,
    baseY,
    nonBlankRows,
    reason: topArtifactAdjustment.reason || "top_artifact",
    rowCount,
    rows,
    shouldPurge: true,
    start,
  };
}

export function applyCodexResizeTopArtifactPurge(terminal, purgePlan) {
  if (!purgePlan?.shouldPurge) {
    return {
      purged: false,
      reason: purgePlan?.reason || "no_plan",
    };
  }

  const internalBuffer = getTerminalInternalActiveBuffer(terminal);
  const lines = internalBuffer?.lines;

  if (
    !internalBuffer
    || !lines
    || typeof lines.splice !== "function"
  ) {
    return {
      purged: false,
      reason: "internal_buffer_unavailable",
    };
  }

  const deleteStart = Math.max(0, Math.floor(Number(purgePlan.start || 0)));
  const deleteCount = Math.max(0, Math.floor(Number(purgePlan.rowCount || 0)));

  if (deleteCount <= 0 || deleteStart + deleteCount > Number(lines.length || 0)) {
    return {
      deleteCount,
      deleteStart,
      purged: false,
      reason: "invalid_delete_range",
    };
  }

  const beforeBaseY = Math.max(0, Number(internalBuffer.ybase || 0));
  const beforeViewportY = Math.max(0, Number(internalBuffer.ydisp || 0));
  const beforeSavedY = Math.max(0, Number(internalBuffer.savedY || 0));

  try {
    lines.splice(deleteStart, deleteCount);
    internalBuffer.ybase = adjustTerminalRowAfterDeletion(beforeBaseY, deleteStart, deleteCount);
    internalBuffer.ydisp = Math.min(
      internalBuffer.ybase,
      adjustTerminalRowAfterDeletion(beforeViewportY, deleteStart, deleteCount),
    );
    internalBuffer.savedY = adjustTerminalRowAfterDeletion(beforeSavedY, deleteStart, deleteCount);

    const bufferService = terminal?._core?._bufferService;
    try {
      bufferService?._onScroll?.fire?.(internalBuffer.ydisp);
    } catch (_error) {
    }

    return {
      afterBaseY: Number(internalBuffer.ybase || 0),
      afterViewportY: Number(internalBuffer.ydisp || 0),
      beforeBaseY,
      beforeViewportY,
      deleteCount,
      deleteStart,
      purged: true,
      reason: purgePlan.reason,
    };
  } catch (_error) {
    return {
      deleteCount,
      deleteStart,
      purged: false,
      reason: "delete_failed",
    };
  }
}

function isClaudeHeaderTitleText(value) {
  return /\bClaude Code\b\s+v?\d/i.test(sanitizeTerminalDiagnosticText(value));
}

function isClaudeHeaderModelText(value) {
  const text = sanitizeTerminalDiagnosticText(value);

  return /\b(Haiku|Sonnet|Opus)\b/i.test(text)
    && /[·•.]/.test(text);
}

function isClaudeHeaderDirectoryText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return /(^|\s)(?:~\/|\/|[A-Za-z]:[\\/])\S+\s*$/.test(text);
}

function isClaudeHeaderIconOnlyText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return text.length > 0
    && /[▐▛▜▝▘▌█▀▄]/.test(text)
    && !/[A-Za-z0-9/\\]/.test(text);
}

function isClaudeTransientHeaderGapChromeRow(row) {
  const text = sanitizeTerminalDiagnosticText(row?.text || "").trim();

  return text.length <= 0
    || /^[─━-]+$/.test(text)
    || /\? for shortcuts/i.test(text)
    || /Try\s+"?edit\s+<filepath/i.test(text)
    || /In\s+\.gitignore/i.test(text);
}

function isClaudeTransientHeaderDebrisRow(row) {
  const text = row?.text || "";

  return isClaudeHeaderTitleText(text)
    || isClaudeHeaderModelText(text)
    || isClaudeHeaderDirectoryText(text)
    || isClaudeHeaderIconOnlyText(text);
}

function getClaudeHeaderBlockAt(terminal, rowIndex) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return null;
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const startCandidate = Math.max(0, Math.floor(Number(rowIndex || 0)));
  const firstRow = getTerminalRowTextDiagnostic(terminal, startCandidate);

  if (!isClaudeHeaderTitleText(firstRow.text)) {
    return null;
  }

  const scanEnd = Math.min(bufferLength, startCandidate + 8);
  const titleRows = [startCandidate];
  const modelRows = [];
  const directoryRows = [];
  let lastHeaderRow = startCandidate;

  for (let index = startCandidate; index < scanEnd; index += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, index);
    const isTitle = isClaudeHeaderTitleText(row.text);

    if (index > startCandidate && isTitle && (!modelRows.length || !directoryRows.length)) {
      return null;
    }

    if (isClaudeHeaderModelText(row.text)) {
      modelRows.push(index);
    }
    if (isClaudeHeaderDirectoryText(row.text)) {
      directoryRows.push(index);
    }

    if (modelRows.length && directoryRows.length) {
      lastHeaderRow = Math.max(startCandidate, modelRows[0], directoryRows[0]);
      break;
    }
  }

  if (!modelRows.length || !directoryRows.length) {
    return null;
  }

  let start = startCandidate;

  while (
    start > 0
    && startCandidate - start < 2
    && isClaudeHeaderIconOnlyText(getTerminalRowTextDiagnostic(terminal, start - 1).text)
  ) {
    start -= 1;
  }

  const end = Math.min(bufferLength, lastHeaderRow + 1);
  const blockRows = getTerminalRowsTextDiagnostic(terminal, start, end - start).rows || [];
  const signature = [
    "claude",
    blockRows.find((row) => isClaudeHeaderTitleText(row.text))?.hash || "",
    blockRows.find((row) => isClaudeHeaderModelText(row.text))?.hash || "",
    blockRows.find((row) => isClaudeHeaderDirectoryText(row.text))?.hash || "",
  ].join(":");

  return {
    directoryRows,
    end,
    modelRows,
    profileId: "claude",
    rowCount: end - start,
    rows: blockRows,
    signature,
    start,
    titleRows,
  };
}

export function getTerminalTransientHeaderArtifactProfile({
  agentKind = "",
  profileId = "",
} = {}) {
  const resolvedProfileId = String(profileId || "").toLowerCase();
  const resolvedAgentKind = String(agentKind || "").toLowerCase();

  if (resolvedProfileId === "claude" || (!resolvedProfileId && resolvedAgentKind === "claude")) {
    return {
      currentLookbackRows: TERMINAL_TRANSIENT_HEADER_ARTIFACT_CURRENT_LOOKBACK_ROWS,
      findBlockAt: getClaudeHeaderBlockAt,
      id: "claude",
      isHeaderDebrisRow: isClaudeTransientHeaderDebrisRow,
      isSafeGapChromeRow: isClaudeTransientHeaderGapChromeRow,
      maxGapRows: TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_GAP_ROWS,
      maxDeleteRows: TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_DELETE_ROWS,
      duplicateLookaheadRows: TERMINAL_TRANSIENT_HEADER_ARTIFACT_DUPLICATE_LOOKAHEAD_ROWS,
      scanBackRows: TERMINAL_TRANSIENT_HEADER_ARTIFACT_SCAN_BACK_ROWS,
    };
  }

  return null;
}

function hasMatchingTerminalRowAfter(terminal, row, startIndex, endIndex) {
  if (!row || row.isBlank) {
    return true;
  }

  const buffer = terminal?.buffer?.active;
  if (!buffer) {
    return false;
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const start = Math.max(0, Math.min(bufferLength, Math.floor(Number(startIndex || 0))));
  const end = Math.max(start, Math.min(bufferLength, Math.floor(Number(endIndex || 0))));

  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const candidate = getTerminalRowTextDiagnostic(terminal, rowIndex);
    if (
      !candidate.isBlank
      && candidate.hash === row.hash
      && candidate.textLength === row.textLength
    ) {
      return true;
    }
  }

  return false;
}

function getTransientHeaderArtifactRowSafety(
  terminal,
  profile,
  row,
  duplicateSearchStart,
  duplicateSearchEnd,
) {
  const isChrome = Boolean(profile.isSafeGapChromeRow?.(row));
  const isHeaderDebris = Boolean(profile.isHeaderDebrisRow?.(row));
  const hasDuplicateAfterKeep = hasMatchingTerminalRowAfter(
    terminal,
    row,
    duplicateSearchStart,
    duplicateSearchEnd,
  );
  const isSafe = !row
    || row.isBlank
    || isChrome
    || isHeaderDebris
    || hasDuplicateAfterKeep;

  return {
    hasDuplicateAfterKeep,
    isActionable: Boolean(
      row
      && !row.isBlank
      && (isHeaderDebris || hasDuplicateAfterKeep),
    ),
    isChrome,
    isHeaderDebris,
    isSafe,
  };
}

function getExpandedTransientHeaderDeleteBlock(terminal, profile, block, nextBlock, keepBlock, bufferLength) {
  const deleteBlock = {
    ...block,
    deleteEnd: block.end,
    deleteStart: block.start,
    expandedGapRows: 0,
    gapRejectedRows: [],
  };

  if (
    !nextBlock
    || !keepBlock
    || nextBlock.start > keepBlock.start
    || block.end >= nextBlock.start
  ) {
    return deleteBlock;
  }

  const gapStart = Math.max(0, Math.floor(Number(block.end || 0)));
  const gapEnd = Math.max(gapStart, Math.min(bufferLength, Math.floor(Number(nextBlock.start || 0))));
  const gapRows = gapEnd - gapStart;

  if (gapRows <= 0) {
    return deleteBlock;
  }

  if (gapRows > Math.max(0, Number(profile.maxGapRows || 0))) {
    return {
      ...deleteBlock,
      gapRejectedReason: "gap_too_large",
      gapRows,
    };
  }

  const duplicateSearchStart = gapEnd;
  const duplicateSearchEnd = Math.min(
    bufferLength,
    duplicateSearchStart + Math.max(0, Number(profile.duplicateLookaheadRows || 0)),
  );
  const rejectedRows = [];
  const inspectedRows = [];
  let safePrefixEnd = gapStart;

  for (let rowIndex = gapStart; rowIndex < gapEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    const safety = getTransientHeaderArtifactRowSafety(
      terminal,
      profile,
      row,
      duplicateSearchStart,
      duplicateSearchEnd,
    );

    inspectedRows.push({
      ...row,
      ...safety,
    });

    if (!safety.isSafe) {
      rejectedRows.push(row);
      break;
    }

    safePrefixEnd = rowIndex + 1;
  }

  if (safePrefixEnd <= gapStart) {
    return {
      ...deleteBlock,
      gapRejectedReason: rejectedRows.length > 0
        ? "gap_starts_with_unique_row"
        : "gap_has_no_safe_prefix",
      gapRejectedRows: rejectedRows,
      gapRows,
      inspectedGapRows: inspectedRows,
    };
  }

  return {
    ...deleteBlock,
    deleteEnd: safePrefixEnd,
    expandedGapRows: safePrefixEnd - gapStart,
    gapRejectedReason: rejectedRows.length > 0
      ? "gap_partially_contains_unique_rows"
      : "",
    gapRejectedRows: rejectedRows,
    gapRows,
    inspectedGapRows: inspectedRows,
    rowCount: safePrefixEnd - Number(block.start || 0),
  };
}

function getOrphanTransientHeaderDeleteBlock(terminal, profile, keepBlock, scanStart, bufferLength) {
  if (!keepBlock || Number(keepBlock.start || 0) <= Number(scanStart || 0)) {
    return null;
  }

  const maxGapRows = Math.max(0, Number(profile.maxGapRows || 0));
  const deleteStart = Math.max(
    Math.max(0, Math.floor(Number(scanStart || 0))),
    Math.floor(Number(keepBlock.start || 0)) - maxGapRows,
  );
  const deleteEnd = Math.max(deleteStart, Math.floor(Number(keepBlock.start || 0)));
  const rowCount = deleteEnd - deleteStart;

  if (rowCount <= 0 || rowCount > maxGapRows) {
    return null;
  }

  const duplicateSearchStart = deleteEnd;
  const duplicateSearchEnd = Math.min(
    bufferLength,
    duplicateSearchStart + Math.max(0, Number(profile.duplicateLookaheadRows || 0)),
  );
  const inspectedRows = [];
  const rejectedRows = [];
  let actionableRows = 0;
  let safeDeleteStart = deleteEnd;

  for (let rowIndex = deleteEnd - 1; rowIndex >= deleteStart; rowIndex -= 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    const safety = getTransientHeaderArtifactRowSafety(
      terminal,
      profile,
      row,
      duplicateSearchStart,
      duplicateSearchEnd,
    );

    if (safety.isActionable) {
      actionableRows += 1;
    }

    inspectedRows.unshift({
      ...row,
      ...safety,
    });

    if (!safety.isSafe) {
      rejectedRows.push(row);
      break;
    }

    safeDeleteStart = rowIndex;
  }

  const safeRowCount = deleteEnd - safeDeleteStart;

  if (actionableRows <= 0 || safeRowCount <= 0) {
    return null;
  }

  return {
    deleteEnd,
    deleteStart: safeDeleteStart,
    expandedGapRows: safeRowCount,
    inspectedGapRows: inspectedRows,
    orphanActionableRows: actionableRows,
    orphanPrefix: true,
    profileId: keepBlock.profileId,
    rowCount: safeRowCount,
    signature: `${keepBlock.profileId || "header"}:orphan:${safeDeleteStart}-${deleteEnd}`,
    start: safeDeleteStart,
  };
}

function getOrphanTransientHeaderSuffixDeleteBlock(terminal, profile, keepBlock, bufferLength) {
  if (!keepBlock) {
    return null;
  }

  const maxGapRows = Math.max(0, Number(profile.maxGapRows || 0));
  const deleteStart = Math.max(0, Math.floor(Number(keepBlock.end || 0)));
  const scanEnd = Math.max(
    deleteStart,
    Math.min(bufferLength, deleteStart + maxGapRows),
  );

  if (scanEnd <= deleteStart) {
    return null;
  }

  const inspectedRows = [];
  let actionableRows = 0;
  let deleteEnd = deleteStart;

  for (let rowIndex = deleteStart; rowIndex < scanEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    const isChrome = Boolean(profile.isSafeGapChromeRow?.(row));
    const isHeaderDebris = Boolean(profile.isHeaderDebrisRow?.(row));
    const isSafe = Boolean(row?.isBlank || isChrome || isHeaderDebris);

    inspectedRows.push({
      ...row,
      isChrome,
      isHeaderDebris,
      isSafe,
    });

    if (!isSafe) {
      break;
    }

    if (isHeaderDebris) {
      actionableRows += 1;
    }

    deleteEnd = rowIndex + 1;
  }

  const rowCount = deleteEnd - deleteStart;

  if (actionableRows <= 0 || rowCount <= 0) {
    return null;
  }

  return {
    deleteEnd,
    deleteStart,
    expandedGapRows: rowCount,
    inspectedGapRows: inspectedRows,
    orphanActionableRows: actionableRows,
    orphanSuffix: true,
    profileId: keepBlock.profileId,
    rowCount,
    signature: `${keepBlock.profileId || "header"}:orphan_suffix:${deleteStart}-${deleteEnd}`,
    start: deleteStart,
  };
}

function normalizeTransientHeaderDeleteBlocks(deleteBlocks) {
  const sortedBlocks = (Array.isArray(deleteBlocks) ? deleteBlocks : [])
    .map((block) => {
      const deleteStart = Math.max(
        0,
        Math.floor(Number(block.deleteStart ?? block.start ?? 0)),
      );
      const deleteEnd = Math.max(
        deleteStart,
        Math.floor(Number(block.deleteEnd ?? (deleteStart + Number(block.rowCount || 0)))),
      );

      return {
        ...block,
        deleteEnd,
        deleteStart,
        rowCount: deleteEnd - deleteStart,
        start: deleteStart,
      };
    })
    .filter((block) => Number(block.rowCount || 0) > 0)
    .sort((left, right) => Number(left.start || 0) - Number(right.start || 0));

  const normalizedBlocks = [];

  sortedBlocks.forEach((block) => {
    const previous = normalizedBlocks[normalizedBlocks.length - 1];

    if (!previous || block.deleteStart > previous.deleteEnd) {
      normalizedBlocks.push(block);
      return;
    }

    previous.deleteEnd = Math.max(previous.deleteEnd, block.deleteEnd);
    previous.rowCount = previous.deleteEnd - previous.deleteStart;
    previous.start = previous.deleteStart;
    previous.expandedGapRows = Math.max(
      Number(previous.expandedGapRows || 0),
      previous.rowCount - Number(previous.rows?.length || 0),
    );
    previous.mergedSignatures = [
      ...(previous.mergedSignatures || [previous.signature || ""]),
      block.signature || "",
    ].filter(Boolean);
    previous.signature = previous.mergedSignatures.join("|");
  });

  return normalizedBlocks;
}

export function getTerminalTransientHeaderArtifactCleanupPlan(
  terminal,
  {
    agentKind = "",
    profileId = "",
  } = {},
) {
  const buffer = terminal?.buffer?.active;
  const profile = getTerminalTransientHeaderArtifactProfile({ agentKind, profileId });

  if (!buffer || !profile) {
    return {
      profileId: profile?.id || profileId || "",
      reason: profile ? "buffer_unavailable" : "profile_unavailable",
      shouldCleanup: false,
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Math.min(bufferLength, Number(buffer.baseY || 0)));
  const viewportY = Math.max(0, Math.min(bufferLength, Number(buffer.viewportY || 0)));
  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const scanStart = Math.max(
    0,
    Math.min(
      viewportY,
      baseY - Math.max(terminalRows * 2, Number(profile.scanBackRows || 0)),
    ),
  );
  const blocks = [];

  for (let rowIndex = scanStart; rowIndex < bufferLength; rowIndex += 1) {
    const block = profile.findBlockAt?.(terminal, rowIndex);

    if (!block || block.rowCount <= 0) {
      continue;
    }

    blocks.push(block);
    rowIndex = Math.max(rowIndex, block.end - 1);
  }

  const currentThreshold = Math.max(
    0,
    baseY - terminalRows - Math.max(0, Number(profile.currentLookbackRows || 0)),
  );
  const viewportEnd = Math.min(bufferLength, viewportY + terminalRows);
  const currentBlocks = blocks.filter((block) => (
    block.start >= currentThreshold
    || (block.start >= viewportY && block.start < viewportEnd)
  ));
  const keepBlock = currentBlocks[currentBlocks.length - 1] || blocks[blocks.length - 1];
  const orphanDeleteBlock = getOrphanTransientHeaderDeleteBlock(
    terminal,
    profile,
    keepBlock,
    scanStart,
    bufferLength,
  );
  const orphanSuffixDeleteBlock = getOrphanTransientHeaderSuffixDeleteBlock(
    terminal,
    profile,
    keepBlock,
    bufferLength,
  );

  if (blocks.length <= 1 && !orphanDeleteBlock && !orphanSuffixDeleteBlock) {
    return {
      baseY,
      blockCount: blocks.length,
      blocks,
      bufferLength,
      currentThreshold,
      profileId: profile.id,
      reason: "no_duplicate_header_blocks",
      scanStart,
      shouldCleanup: false,
      terminalRows,
      viewportY,
    };
  }

  if (!keepBlock) {
    return {
      baseY,
      blockCount: blocks.length,
      blocks,
      bufferLength,
      currentThreshold,
      profileId: profile.id,
      reason: "no_current_header_block",
      scanStart,
      shouldCleanup: false,
      terminalRows,
      viewportY,
    };
  }

  const olderBlocks = blocks.filter((block) => block.start < keepBlock.start);
  const deleteBlocks = olderBlocks.map((block) => {
    const blockIndex = blocks.findIndex((candidate) => candidate.start === block.start);
    const nextBlock = blockIndex >= 0 ? blocks[blockIndex + 1] : null;

    return getExpandedTransientHeaderDeleteBlock(
      terminal,
      profile,
      block,
      nextBlock,
      keepBlock,
      bufferLength,
    );
  });
  if (orphanDeleteBlock) {
    deleteBlocks.unshift(orphanDeleteBlock);
  }
  if (orphanSuffixDeleteBlock) {
    deleteBlocks.push(orphanSuffixDeleteBlock);
  }
  const normalizedDeleteBlocks = normalizeTransientHeaderDeleteBlocks(deleteBlocks);
  const deleteRows = normalizedDeleteBlocks
    .reduce((total, block) => total + Number(block.rowCount || 0), 0);

  if (!normalizedDeleteBlocks.length) {
    return {
      baseY,
      blockCount: blocks.length,
      blocks,
      bufferLength,
      currentThreshold,
      keepBlock,
      profileId: profile.id,
      reason: "no_older_duplicate_blocks",
      scanStart,
      shouldCleanup: false,
      terminalRows,
      viewportY,
    };
  }

  if (deleteRows > Number(profile.maxDeleteRows || TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_DELETE_ROWS)) {
    return {
      baseY,
      blockCount: blocks.length,
      blocks,
      bufferLength,
      currentThreshold,
      deleteBlocks: normalizedDeleteBlocks,
      deleteRows,
      keepBlock,
      maxDeleteRows: Number(profile.maxDeleteRows || TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_DELETE_ROWS),
      profileId: profile.id,
      reason: "delete_range_too_large",
      scanStart,
      shouldCleanup: false,
      terminalRows,
      viewportY,
    };
  }

  return {
    baseY,
    blockCount: blocks.length,
    blocks,
    bufferLength,
    currentThreshold,
    deleteBlocks: normalizedDeleteBlocks,
    deleteRows,
    keepBlock,
    profileId: profile.id,
    reason: "duplicate_transient_header_blocks",
    scanStart,
    shouldCleanup: true,
    terminalRows,
    viewportY,
  };
}

export function applyTerminalTransientHeaderArtifactCleanup(terminal, cleanupPlan) {
  if (!cleanupPlan?.shouldCleanup) {
    return {
      cleaned: false,
      reason: cleanupPlan?.reason || "no_plan",
    };
  }

  const internalBuffer = getTerminalInternalActiveBuffer(terminal);
  const lines = internalBuffer?.lines;

  if (
    !internalBuffer
    || !lines
    || typeof lines.splice !== "function"
  ) {
    return {
      cleaned: false,
      reason: "internal_buffer_unavailable",
    };
  }

  const deleteBlocks = Array.isArray(cleanupPlan.deleteBlocks)
    ? cleanupPlan.deleteBlocks.slice().sort((left, right) => Number(right.start || 0) - Number(left.start || 0))
    : [];

  if (!deleteBlocks.length) {
    return {
      cleaned: false,
      reason: "empty_delete_blocks",
    };
  }

  const beforeBaseY = Math.max(0, Number(internalBuffer.ybase || 0));
  const beforeViewportY = Math.max(0, Number(internalBuffer.ydisp || 0));
  const beforeSavedY = Math.max(0, Number(internalBuffer.savedY || 0));
  const deletedBlocks = [];
  let afterBaseY = beforeBaseY;
  let afterViewportY = beforeViewportY;
  let afterSavedY = beforeSavedY;
  let deletedRows = 0;

  try {
    deleteBlocks.forEach((block) => {
      const deleteStart = Math.max(0, Math.floor(Number(block.start || 0)));
      const deleteCount = Math.max(0, Math.floor(Number(block.rowCount || 0)));

      if (deleteCount <= 0 || deleteStart + deleteCount > Number(lines.length || 0)) {
        return;
      }

      lines.splice(deleteStart, deleteCount);
      afterBaseY = adjustTerminalRowAfterDeletion(afterBaseY, deleteStart, deleteCount);
      afterViewportY = adjustTerminalRowAfterDeletion(afterViewportY, deleteStart, deleteCount);
      afterSavedY = adjustTerminalRowAfterDeletion(afterSavedY, deleteStart, deleteCount);
      deletedRows += deleteCount;
      deletedBlocks.push({
        deleteCount,
        deleteStart,
        expandedGapRows: Number(block.expandedGapRows || 0),
        signature: block.signature || "",
      });
    });

    if (deletedRows <= 0) {
      return {
        cleaned: false,
        reason: "no_valid_delete_blocks",
      };
    }

    internalBuffer.ybase = afterBaseY;
    internalBuffer.ydisp = Math.min(afterBaseY, afterViewportY);
    internalBuffer.savedY = afterSavedY;

    const bufferService = terminal?._core?._bufferService;
    try {
      bufferService?._onScroll?.fire?.(internalBuffer.ydisp);
    } catch (_error) {
    }

    return {
      afterBaseY: Number(internalBuffer.ybase || 0),
      afterViewportY: Number(internalBuffer.ydisp || 0),
      beforeBaseY,
      beforeViewportY,
      cleaned: true,
      deletedBlocks,
      deletedRows,
      profileId: cleanupPlan.profileId || "",
      reason: cleanupPlan.reason || "duplicate_transient_header_blocks",
    };
  } catch (_error) {
    return {
      cleaned: false,
      deletedRows,
      profileId: cleanupPlan.profileId || "",
      reason: "delete_failed",
    };
  }
}

export function getTerminalBottomBandDiagnostic(terminal) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
    };
  }

  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Number(buffer.baseY || 0));
  const viewportY = Math.max(0, Number(buffer.viewportY || 0));
  const cursorX = Math.max(0, Number(buffer.cursorX || 0));
  const cursorY = Math.max(0, Number(buffer.cursorY || 0));
  const cursorAbsoluteRow = Math.max(0, Math.min(bufferLength - 1, baseY + cursorY));
  const liveEnd = Math.max(baseY, Math.min(bufferLength, baseY + terminalRows));
  const viewportEnd = Math.max(viewportY, Math.min(bufferLength, viewportY + terminalRows));
  const cursorWindowStart = Math.max(baseY, cursorAbsoluteRow - 5);
  const cursorWindowEnd = Math.min(liveEnd, cursorAbsoluteRow + 7);
  const liveTailStart = Math.max(baseY, liveEnd - 10);
  const viewportTailStart = Math.max(viewportY, viewportEnd - 10);
  let blankRowsBelowCursor = 0;
  let nonEmptyRowsBelowCursor = 0;
  let firstNonEmptyBelowCursor = -1;
  let lastNonEmptyBelowCursor = -1;

  for (let rowIndex = cursorAbsoluteRow + 1; rowIndex < liveEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    if (row.isBlank) {
      blankRowsBelowCursor += 1;
    } else {
      nonEmptyRowsBelowCursor += 1;
      if (firstNonEmptyBelowCursor < 0) {
        firstNonEmptyBelowCursor = rowIndex;
      }
      lastNonEmptyBelowCursor = rowIndex;
    }
  }

  return {
    available: true,
    baseY,
    blankRowsBelowCursor,
    bufferLength,
    cursorAbsoluteRow,
    cursorLine: getTerminalRowTextDiagnostic(terminal, cursorAbsoluteRow),
    cursorWindow: getTerminalRowsTextDiagnostic(terminal, cursorWindowStart, cursorWindowEnd - cursorWindowStart),
    cursorX,
    cursorY,
    firstNonEmptyBelowCursor,
    lastNonEmptyBelowCursor,
    liveEnd,
    liveTail: getTerminalRowsTextDiagnostic(terminal, liveTailStart, liveEnd - liveTailStart),
    nonEmptyRowsBelowCursor,
    terminalRows,
    viewportEnd,
    viewportTail: getTerminalRowsTextDiagnostic(terminal, viewportTailStart, viewportEnd - viewportTailStart),
    viewportY,
  };
}

export function getTerminalTopBandDiagnostic(terminal) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
    };
  }

  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Number(buffer.baseY || 0));
  const viewportY = Math.max(0, Number(buffer.viewportY || 0));
  const cursorX = Math.max(0, Number(buffer.cursorX || 0));
  const cursorY = Math.max(0, Number(buffer.cursorY || 0));
  const sampleRows = Math.min(12, terminalRows);
  const viewportTop = getTerminalRowsTextDiagnostic(terminal, viewportY, sampleRows);
  const liveTop = getTerminalRowsTextDiagnostic(terminal, baseY, sampleRows);
  const viewportTexts = Array.isArray(viewportTop.rows)
    ? viewportTop.rows.map((row) => row.text)
    : [];
  const liveTexts = Array.isArray(liveTop.rows)
    ? liveTop.rows.map((row) => row.text)
    : [];
  const viewportCodexBannerRows = (viewportTop.rows || [])
    .filter((row) => /OpenAI Codex/.test(row.text || ""))
    .map((row) => row.rowIndex);
  const liveCodexBannerRows = (liveTop.rows || [])
    .filter((row) => /OpenAI Codex/.test(row.text || ""))
    .map((row) => row.rowIndex);

  return {
    available: true,
    baseMinusViewport: baseY - viewportY,
    baseY,
    bufferLength,
    cursorX,
    cursorY,
    liveCodexBannerRows,
    liveTop,
    liveTopTextHash: hashTerminalDiagnosticText(liveTexts.join("\n")),
    sampleRows,
    terminalRows,
    viewportCodexBannerRows,
    viewportTop,
    viewportTopTextHash: hashTerminalDiagnosticText(viewportTexts.join("\n")),
    viewportY,
  };
}

function isCodexComposerPromptText(value) {
  return sanitizeTerminalDiagnosticText(value).trimStart().startsWith("›");
}

function isCodexExpectedComposerFooterText(value) {
  const text = sanitizeTerminalDiagnosticText(value)
    .replace(/^[│╭╰╮╯─\s]+/g, "")
    .replace(/[│╭╰╮╯─\s]+$/g, "")
    .trim();

  return /^gpt-[\w.-]+(?:\s+[\w.-]+)?\s+·\s+\/.+/.test(text);
}

function isCodexExpectedComposerFooterBorderText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return /^[│╭╰╮╯─\s]+$/.test(text);
}

function areCodexExpectedComposerFooterRows(rows) {
  const nonEmptyRows = Array.isArray(rows) ? rows : [];

  if (
    nonEmptyRows.length < 1
    || nonEmptyRows.length > TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER + 1
  ) {
    return false;
  }

  let footerRows = 0;
  for (const row of nonEmptyRows) {
    const text = row?.text || "";
    if (isCodexExpectedComposerFooterText(text)) {
      footerRows += 1;
      continue;
    }

    if (isCodexExpectedComposerFooterBorderText(text)) {
      continue;
    }

    return false;
  }

  return footerRows >= 1;
}

export function getCodexResizeLiveTailCleanupPlan(terminal) {
  const bottomBand = getTerminalBottomBandDiagnostic(terminal);

  if (!bottomBand.available) {
    return {
      bottomBand,
      reason: "buffer_unavailable",
      shouldClean: false,
    };
  }

  const terminalRows = Math.max(1, Number(bottomBand.terminalRows || terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const cursorY = Math.max(0, Number(bottomBand.cursorY || 0));
  const cursorAbsoluteRow = Math.max(0, Number(bottomBand.cursorAbsoluteRow || 0));
  const liveEnd = Math.max(cursorAbsoluteRow, Number(bottomBand.liveEnd || 0));
  const nonEmptyRowsBelow = [];

  for (let rowIndex = cursorAbsoluteRow + 1; rowIndex < liveEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    if (!row.isBlank) {
      nonEmptyRowsBelow.push(row);
    }
  }

  const cursorText = bottomBand.cursorLine?.text || "";
  const composerMatched = isCodexComposerPromptText(cursorText);
  const hasOnlyExpectedFooter = areCodexExpectedComposerFooterRows(nonEmptyRowsBelow);

  if (!composerMatched) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "cursor_not_composer",
      shouldClean: false,
    };
  }

  if (cursorY >= terminalRows - 1) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "cursor_on_last_row",
      shouldClean: false,
    };
  }

  if (!nonEmptyRowsBelow.length) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "tail_already_blank",
      shouldClean: false,
    };
  }

  if (hasOnlyExpectedFooter) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "expected_footer_only",
      shouldClean: false,
    };
  }

  const targetRow = Math.max(
    1,
    Math.min(
      terminalRows,
      cursorY + 2 + TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER,
    ),
  );
  const nonEmptySignature = nonEmptyRowsBelow
    .map((row) => `${row.rowIndex}:${row.hash}:${row.textLength}`)
    .join("|");

  return {
    bottomBand,
    composerMatched,
    nonEmptyRowsBelow,
    reason: "stale_live_tail",
    preservedRowsBelowComposer: TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER,
    sequence: `\x1b7\x1b[${targetRow};1H\x1b[0J\x1b8`,
    shouldClean: true,
    signature: [
      terminal?.cols || 0,
      terminalRows,
      bottomBand.baseY,
      cursorAbsoluteRow,
      bottomBand.cursorLine?.hash || "",
      nonEmptySignature,
    ].join(":"),
    targetRow,
  };
}
