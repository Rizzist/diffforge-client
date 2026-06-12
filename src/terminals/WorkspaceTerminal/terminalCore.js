import {
  logTerminalDiagnosticEvent,
  logThreadBridgeDiagnosticEvent,
} from "../terminalDiagnostics";
import { stripLiveViewControlSequences } from "../liveViewSanitizer.js";

export const TERMINAL_THEME_BACKGROUND = "#020304";
export const WORKSPACE_TERMINAL_PANE_PREFIX = "workspace-terminal";
export const MIN_WORKSPACE_TERMINAL_COUNT = 1;
export const MAX_WORKSPACE_TERMINAL_COUNT = 24;
export const WORKSPACE_TERMINAL_PRIMARY_COLUMNS = 2;
export const WORKSPACE_TERMINAL_WIDE_START_INDEX = 4;
export const WORKSPACE_TERMINAL_WIDE_COLUMNS = 4;
export const TERMINAL_DEFAULT_COLS = 80;
export const TERMINAL_DEFAULT_ROWS = 24;
export const TERMINAL_MIN_COLS = 20;
export const TERMINAL_MIN_ROWS = 6;
export const TERMINAL_MAX_COLS = 400;
export const TERMINAL_MAX_ROWS = 160;

function detectTerminalWebglRendererDefault() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platformText = [
    navigator.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (platformText.includes("linux")) {
    return false;
  }

  return platformText.includes("mac") || platformText.includes("win");
}

export const TERMINAL_ENABLE_WEBGL_RENDERER = detectTerminalWebglRendererDefault();
export const TERMINAL_START_LAYOUT_WAIT_MS = 4000;
export const TERMINAL_START_LAYOUT_HIDDEN_POLL_MS = 120;
export const TERMINAL_START_LAYOUT_STILL_WAITING_LOG_MS = 4000;
export const TERMINAL_START_METRIC_WAIT_MS = 900;
export const TERMINAL_START_METRIC_STILL_WAITING_LOG_MS = 4000;
export const TERMINAL_START_METRIC_POLL_MS = 16;
export const TERMINAL_START_GEOMETRY_WAIT_MS = 1400;
export const TERMINAL_START_GEOMETRY_POLL_MS = 16;
export const TERMINAL_DEFAULT_SCROLLBACK_ROWS = 10000;
// Inactive panes keep a shallow buffer: xterm resize reflows are linear in
// buffer rows, so 24 background panes at 10k rows dominate maximize cost
// (and memory). History beyond this depth is trimmed while a pane is
// inactive; activation restores the full scrollback budget going forward.
export const TERMINAL_BACKGROUND_SCROLLBACK_ROWS = 2000;
export const TERMINAL_WEBGL_IDLE_DELAY_MS = 420;
export const TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS = 80;
export const TERMINAL_WEBGL_BACKGROUND_DELAY_MS = 650;
export const TERMINAL_WEBGL_STAGGER_MS = 220;
export const TERMINAL_WEBGL_MAX_DELAY_MS = 2600;
export const TERMINAL_BLANK_STARTUP_PROBE_MS = 800;
export const TERMINAL_BLANK_STARTUP_CONFIRM_MS = 800;
export const TERMINAL_BACKEND_PREP_DETAIL_MS = 2500;
export const TERMINAL_AGENT_COLOR_SLOT_COUNT = 16;
export const TERMINAL_AUDIO_INPUT_REFOCUS_EVENT = "forge-terminal-audio-input-refocus";
export const TERMINAL_INPUT_HOT_EVENT = "diffforge:terminal-input-hot";
export const TERMINAL_INPUT_EVENT = "forge-terminal-input";
export const TERMINAL_INPUT_ERROR_EVENT = "forge-terminal-input-error";
export const TERMINAL_PROMPT_SUBMITTED_EVENT = "forge-terminal-prompt-submitted";
export const WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT = "diffforge:workspace-thread-prompt-accepted";
export const TERMINAL_ACTIVITY_HOOK_EVENT = "forge-terminal-activity-hook";
export const TERMINAL_ARCHITECTURE_ACTIVITY_EVENT = "diffforge:terminal-architecture-activity";
export const TERMINAL_SUBMIT_DIAGNOSTIC_SNAPSHOT_REQUEST_EVENT = "diffforge:terminal-submit-diagnostic-snapshot-request";
export const TERMINAL_PARKED_PROMPT_EVENT = "forge-terminal-parked-prompt";
export const WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT = "diffforge:workspace-thread-archive-terminal-reset";
export const TERMINAL_OUTPUT_DIAGNOSTIC_WINDOW_MS = 1000;
export const TERMINAL_OUTPUT_BATCH_MAX_MS = 8;
export const TERMINAL_GLOBAL_RENDER_BACKGROUND_MS = 180;
export const TERMINAL_OUTPUT_BATCH_MAX_BYTES = 16 * 1024;
export const TERMINAL_OUTPUT_FLUSH_ACTIVE_MAX_BYTES = TERMINAL_OUTPUT_BATCH_MAX_BYTES;
export const TERMINAL_OUTPUT_FLUSH_BACKGROUND_MAX_BYTES = TERMINAL_OUTPUT_BATCH_MAX_BYTES;
export const TERMINAL_OUTPUT_FLUSH_MIN_BYTES = 512;
export const TERMINAL_OUTPUT_WRITE_MIN_BYTES = 2 * 1024;
export const TERMINAL_OUTPUT_WRITE_TARGET_MS = 8;
export const TERMINAL_GLOBAL_RENDER_BACKGROUND_MIN_MS = TERMINAL_GLOBAL_RENDER_BACKGROUND_MS;
export const TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS = 700;
export const TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MIN_MS = 420;
export const TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MAX_MS = 1200;
export const TERMINAL_GLOBAL_RENDER_INTERACTIVE_GRACE_MS = 900;
export const TERMINAL_GLOBAL_RENDER_MAX_PANES_PER_FRAME = 2;
export const TERMINAL_GLOBAL_RENDER_BACKGROUND_PANES_PER_FRAME = 1;
export const TERMINAL_GLOBAL_RENDER_FRAME_BUDGET_MS = TERMINAL_OUTPUT_BATCH_MAX_MS;
export const TERMINAL_OUTPUT_CHUNK_DIAGNOSTIC_SLOW_MS = 8;
export const TERMINAL_OUTPUT_WRITE_DIAGNOSTIC_SLOW_MS = 16;
export const TERMINAL_INPUT_BATCH_MS = 8;
export const TERMINAL_DELETE_INPUT_BATCH_MS = 28;
export const TERMINAL_INPUT_BATCH_MAX_CHARS = 64;
export const TERMINAL_ENTER_SEQUENCE = "\x1b[13u";
export const TERMINAL_ENTER_SEQUENCE_MOD1 = "\x1b[13;1u";
export const TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";
export const TODO_DRAG_MIME = "application/x-diffforge-todo";
export const TERMINAL_CODEX_RESIZE_GATE_MAX_BYTES = 0;
export const TERMINAL_CODEX_RESIZE_GATE_MAX_MS = 0;
export const TERMINAL_CODEX_RESIZE_GATE_RETRY_MS = 0;
export const TERMINAL_CODEX_RESIZE_GATE_SETTLE_MS = 0;
export const TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_DELAYS_MS = [];
export const TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS = 0;
export const TERMINAL_CODEX_RESIZE_OUTPUT_PROBE_THROTTLE_MS = 0;
export const TERMINAL_CODEX_RESIZE_PAINT_PROBE_DELAYS_MS = [];
export const TERMINAL_CODEX_RESIZE_PAINT_PROBE_WINDOW_MS = 0;
export const TERMINAL_CODEX_RESIZE_SCROLLBACK_CLEANUP_MS = 0;
export const TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_DELAYS_MS = [];
export const TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_MS = 0;
export const TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS = 0;
export const TERMINAL_CLAUDE_RESIZE_BLANK_FRAME_GUARD_MS = 0;
export const TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_CHARS = 0;
export const TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS = 0;
export const TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_RATIO = 1;
export const TERMINAL_SLASH_COMMAND_MAX_LINE_CHARS = 240;
export const TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_DELAYS_MS = [];
export const TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_THROTTLE_MS = 0;
export const TERMINAL_SLASH_COMMAND_PROBE_DELAYS_MS = [];
export const TERMINAL_SLASH_COMMAND_PROBE_WINDOW_MS = 0;
export const TERMINAL_STABILITY_RESIZE_PROBE_DELAYS_MS = [];
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_DELAYS_MS = [];
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_MS = 0;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_RETRIES = 0;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_OUTPUT_QUIET_MS = 0;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_REDRAW_QUIET_MS = 0;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_RETRY_MS = 0;
export const TERMINAL_TRANSIENT_HEADER_ARTIFACT_STABLE_PLAN_MS = 0;
export const TERMINAL_STABILITY_DISABLED_FEATURES = Object.freeze({
  claudeResizeBlankFrameGuard: false,
  claudeResizeDuplicateRepaintGuard: false,
  codexResizeGate: false,
  codexResizeLiveTailCleanup: false,
  codexResizePaintProbe: false,
  codexResizeScrollbackCleanup: false,
  dropEraseDisplay2OutsideSync: false,
  normalizerPipeline: false,
  outputNormalizer: false,
  resizeDiagnostics: false,
  slashCommandDiagnostics: false,
  slashMenuCloseResize: false,
  transientHeaderArtifactCleanup: false,
});

export function getTerminalAgentKind(agentId) {
  const normalizedAgentId = String(agentId || "").toLowerCase();
  if (normalizedAgentId.includes("generic") || normalizedAgentId.includes("shell")) {
    return "generic";
  }

  if (normalizedAgentId.includes("claude")) {
    return "claude";
  }

  if (normalizedAgentId.includes("opencode") || normalizedAgentId.includes("open-code")) {
    return "opencode";
  }

  if (normalizedAgentId.includes("codex")) {
    return "codex";
  }

  return "agent";
}

function encodeTerminalComposerText(value) {
  return String(value || "").replace(/\n/g, TERMINAL_SHIFT_ENTER_SEQUENCE);
}

export function buildTerminalComposerDraftInput(previousValue, nextValue, forceReplace = false) {
  const previous = String(previousValue || "");
  const next = String(nextValue || "");
  if (previous === next && !forceReplace) {
    return "";
  }

  if (forceReplace) {
    return `\x15${encodeTerminalComposerText(next)}`;
  }

  if (next.startsWith(previous)) {
    return encodeTerminalComposerText(next.slice(previous.length));
  }

  if (previous.startsWith(next)) {
    return "\x7f".repeat(previous.length - next.length);
  }

  return `\x15${encodeTerminalComposerText(next)}`;
}

export function logThreadBridgeDiagnostic(phase, fields = {}) {
  logThreadBridgeDiagnosticEvent(phase, fields);
}

let activeTerminalKeyboardTarget = null;

export function decodeTerminalDiagnosticBytes(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return String(data || "");
}

export function sanitizeTerminalDiagnosticText(value, maxLength = 140) {
  const text = stripLiveViewControlSequences(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

export function getTerminalOutputVisibleCharCount(data, fallback = 0) {
  const text = stripLiveViewControlSequences(decodeTerminalDiagnosticBytes(data));
  return text.length || fallback;
}

export function getTerminalOutputVisibleByteEstimate(data, fallback = 0) {
  const bytes = data instanceof Uint8Array
    ? data
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : null;

  if (!bytes?.byteLength) {
    return fallback;
  }

  let visible = 0;
  let escapeUntilFinal = false;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (escapeUntilFinal) {
      if (byte >= 0x40 && byte <= 0x7e) {
        escapeUntilFinal = false;
      }
      continue;
    }
    if (byte === 0x1b) {
      escapeUntilFinal = true;
      continue;
    }
    if (byte >= 0x20 && byte !== 0x7f) {
      visible += 1;
    }
  }

  return visible || fallback;
}

export function getTerminalOutputByteStats(data) {
  const text = decodeTerminalDiagnosticBytes(data);
  let escapeBytes = 0;
  let controlBytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x1b) {
      escapeBytes += 1;
    } else if (code < 0x20 || code === 0x7f) {
      controlBytes += 1;
    }
  }
  return {
    bytes: Number(data?.byteLength || text.length || 0),
    controlBytes,
    escapeBytes,
    visibleChars: getTerminalOutputVisibleCharCount(text, 0),
  };
}

export function getTerminalOutputDebugFields(data) {
  const stats = getTerminalOutputByteStats(data);
  return {
    ...stats,
    preview: sanitizeTerminalDiagnosticText(decodeTerminalDiagnosticBytes(data), 120),
  };
}

export function getTerminalInputDebugFields(data) {
  const text = decodeTerminalDiagnosticBytes(data);
  return {
    bytes: text.length,
    controlBytes: getTerminalOutputByteStats(text).controlBytes,
    preview: sanitizeTerminalDiagnosticText(text, 80),
    visibleChars: getTerminalOutputVisibleCharCount(text, 0),
  };
}

export function getTerminalOutputControlProfile(data) {
  return getTerminalOutputByteStats(data);
}

export function getFirstCsiParam() {
  return null;
}

export function getCsiParamNumbers() {
  return [];
}

export function createSlashCommandDiagnosticState() {
  return {
    keydownLine: "",
    line: "",
  };
}

export function getTerminalSlashCommandLineSnapshot(value) {
  const text = sanitizeTerminalDiagnosticText(value, TERMINAL_SLASH_COMMAND_MAX_LINE_CHARS);
  const commandPreview = text.trimStart();
  return {
    commandPreview,
    startsWithSlash: commandPreview.startsWith("/"),
    text,
  };
}

export function getTerminalSlashCommandInputSummary(value) {
  return getTerminalSlashCommandLineSnapshot(value);
}

export function isTerminalSlashCommandDiagnosticAgentKind() {
  return false;
}

export function createCodexSlashMenuCloseCleanupState() {
  return {
    active: false,
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
    scrollbackCleanupStartViewportY: 0,
    scrollbackCleanupStartedAtBottom: false,
    scrollbackCleanupUntil: 0,
    startedAt: 0,
    startedAtBottom: false,
    startState: null,
    targetSize: null,
  };
}

export function normalizeCodexResizeGateSize(value = {}) {
  return {
    cols: Math.max(0, Number(value.cols || 0)),
    rows: Math.max(0, Number(value.rows || 0)),
  };
}

export function codexResizeGateSizesEqual(left, right) {
  return Number(left?.cols || 0) === Number(right?.cols || 0)
    && Number(left?.rows || 0) === Number(right?.rows || 0);
}

export function concatTerminalByteArrays(...arrays) {
  const chunks = arrays.filter((array) => array?.byteLength);
  const total = chunks.reduce((sum, array) => sum + array.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((array) => {
    output.set(array, offset);
    offset += array.byteLength;
  });
  return output;
}

export function coalesceCodexResizeRepaintBytes(data) {
  return data;
}

export function getTerminalStabilityFeatureFlags() {
  return TERMINAL_STABILITY_DISABLED_FEATURES;
}

export function getWindowsTerminalCompactState() {
  return {};
}

export function getTerminalRendererPaintDiagnostics() {
  return {};
}

export function getTerminalBufferDiagnostics() {
  return {};
}

export function getTerminalBufferRowsDiagnostic() {
  return [];
}

export function getTerminalCursorHomeDiagnostic() {
  return {};
}

export function getTerminalViewportAnchorDiagnostic() {
  return {};
}

export function findTerminalViewportAnchorMatch() {
  return null;
}

export function isWindowsTerminalGeometrySettled() {
  return true;
}

export function getTerminalTransientHeaderArtifactCleanupPlan() {
  return null;
}

export function applyTerminalTransientHeaderArtifactCleanup() {
  return {
    deletedBlocks: [],
    deletedRows: 0,
    reason: "disabled",
    refreshed: false,
  };
}

export function adjustTerminalRowAfterDeletion(row) {
  return row;
}

export function getCodexResizeTopArtifactPurgePlan() {
  return null;
}

export function applyCodexResizeTopArtifactPurge() {
  return false;
}

export function getCodexResizeTopArtifactAdjustment() {
  return null;
}

export function getCodexResizeLiveTailCleanupPlan() {
  return null;
}

export function getClaudeResizeDuplicateRepaintDecision() {
  return {
    action: "pass",
    matchedRows: 0,
    ratio: 0,
  };
}

export function extractNativeSessionIdFromOutput(agentId, text) {
  const output = stripLiveViewControlSequences(text);
  if (
    /\b(?:No saved session|No conversation found|Invalid session ID|Terminal Exited|Process ended)\b/i
      .test(output)
  ) {
    return "";
  }
  const patterns = agentId === "codex"
    ? [
      /\bcodex(?:\.cmd|\.exe)?\s+resume\s+([0-9a-fA-F-]{8,}|[^\s"'`]+)/i,
      /\bresume\s+([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})\b/i,
    ]
    : agentId === "claude"
      ? [
        /\bclaude(?:\.cmd|\.exe)?\s+--resume\s+([^\s"'`]+)/i,
        /\bsession\s+id\s*[:=]\s*([0-9a-zA-Z_-]{8,})/i,
      ]
      : agentId === "opencode"
        ? [
          /\bopencode(?:\.cmd|\.exe)?\s+(?:--session|-s)\s+([^\s"'`]+)/i,
          /\bsession\s+id\s*[:=]\s*([0-9a-zA-Z_-]{8,})/i,
        ]
        : [];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    const sessionId = String(match?.[1] || "").trim();
    if (sessionId) {
      return sessionId;
    }
  }

  return "";
}

export const terminalKeyboardTargetMatches = (paneId, instanceId) => (
  activeTerminalKeyboardTarget?.paneId === paneId
  && Number(activeTerminalKeyboardTarget?.instanceId || 0) === Number(instanceId || 0)
);

export const setActiveTerminalKeyboardTarget = (paneId, instanceId) => {
  activeTerminalKeyboardTarget = {
    instanceId: Number(instanceId || 0),
    paneId,
  };
};

export const clearActiveTerminalKeyboardTargetIfCurrent = (paneId, instanceId) => {
  if (terminalKeyboardTargetMatches(paneId, instanceId)) {
    activeTerminalKeyboardTarget = null;
  }
};

export const terminalRenderNow = () => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
);

export const terminalGlobalRenderScheduler = (() => {
  const entries = new Map();
  let rafId = 0;
  let timerId = 0;
  let frameId = 0;
  let interactiveEntryId = "";
  let interactiveUntil = 0;

  const hasWindow = () => typeof window !== "undefined";

  const clearTimer = () => {
    if (timerId && hasWindow()) {
      window.clearTimeout(timerId);
    }
    timerId = 0;
  };

  const entryAge = (entry, now = terminalRenderNow()) => {
    const queuedAt = Number(entry.getQueuedAt?.() || 0);
    return queuedAt > 0 ? Math.max(0, now - queuedAt) : 0;
  };

  const entryBytes = (entry) => Math.max(0, Number(entry.getPendingBytes?.() || 0));

  const isEntryActive = (entry) => Boolean(entry.isActive?.());

  const entryHasPriority = (entry) => Boolean(entry.hasPriorityPending?.());

  const isInteractiveWindow = (now = terminalRenderNow()) => interactiveUntil > now;

  const getGlobalInputHotRemainingMs = () => {
    if (!hasWindow()) {
      return 0;
    }
    return Math.max(0, Number(window.__diffforgeTerminalInputHotUntil || 0) - Date.now());
  };

  const isInputHotWindow = (now = terminalRenderNow()) => (
    isInteractiveWindow(now) || getGlobalInputHotRemainingMs() > 0
  );

  const isEntryInteractive = (entry) => (
    interactiveEntryId
    && entry?.id
    && entry.id === interactiveEntryId
    && isInteractiveWindow()
  );

  const isEntryDue = (entry, now = terminalRenderNow()) => {
    if (!entry.hasPending?.()) {
      return false;
    }

    const age = entryAge(entry, now);
    if (isEntryActive(entry)) {
      return age >= 0;
    }

    if (entryHasPriority(entry)) {
      return true;
    }

    if (isInteractiveWindow(now)) {
      return age >= TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MIN_MS;
    }

    if (entryBytes(entry) >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
      return true;
    }

    return age >= TERMINAL_GLOBAL_RENDER_BACKGROUND_MIN_MS;
  };

  const nextDelayMs = (now = terminalRenderNow()) => {
    let delay = null;

    entries.forEach((entry) => {
      if (!entry.hasPending?.()) {
        return;
      }

      if (isEntryActive(entry)) {
        delay = 0;
        return;
      }

      if (entryHasPriority(entry)) {
        delay = 0;
        return;
      }

      const age = entryAge(entry, now);
      const backgroundMinMs = isInputHotWindow(now)
        ? TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MIN_MS
        : TERMINAL_GLOBAL_RENDER_BACKGROUND_MIN_MS;
      const remaining = Math.max(0, backgroundMinMs - age);
      delay = delay == null ? remaining : Math.min(delay, remaining);
    });

    return delay;
  };

  const scheduleFrame = () => {
    if (!hasWindow() || rafId) {
      return;
    }

    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      flushFrame();
    });
  };

  const scheduleTimer = () => {
    if (!hasWindow() || rafId) {
      return;
    }

    const delay = nextDelayMs();
    if (delay == null) {
      clearTimer();
      return;
    }

    if (delay <= 0) {
      clearTimer();
      scheduleFrame();
      return;
    }

    clearTimer();
    timerId = window.setTimeout(() => {
      timerId = 0;
      scheduleFrame();
    }, Math.min(
      delay,
      isInputHotWindow()
        ? TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MAX_MS
        : TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS,
    ));
  };

  const scheduleNext = () => {
    const delay = nextDelayMs();
    if (delay == null) {
      clearTimer();
      return;
    }

    if (delay <= 0) {
      clearTimer();
      scheduleFrame();
      return;
    }

    scheduleTimer();
  };

  const compareEntries = (now) => (left, right) => {
    const leftActive = isEntryActive(left);
    const rightActive = isEntryActive(right);
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }

    const leftPriority = entryHasPriority(left);
    const rightPriority = entryHasPriority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority ? -1 : 1;
    }

    const leftInteractive = isEntryInteractive(left);
    const rightInteractive = isEntryInteractive(right);
    if (leftInteractive !== rightInteractive) {
      return leftInteractive ? -1 : 1;
    }

    const leftAge = entryAge(left, now);
    const rightAge = entryAge(right, now);
    const backgroundMaxMs = isInputHotWindow(now)
      ? TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MAX_MS
      : TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS;
    const leftOverdue = leftAge >= backgroundMaxMs;
    const rightOverdue = rightAge >= backgroundMaxMs;
    if (leftOverdue !== rightOverdue) {
      return leftOverdue ? -1 : 1;
    }

    const leftBytes = entryBytes(left);
    const rightBytes = entryBytes(right);
    if (leftBytes !== rightBytes) {
      return rightBytes - leftBytes;
    }

    return rightAge - leftAge;
  };

  const flushReasonForEntry = (entry, now) => {
    const age = entryAge(entry, now);
    if (entryBytes(entry) >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
      return "global_max_bytes_frame";
    }
    if (isEntryActive(entry)) {
      return "global_active_frame";
    }
    if (entryHasPriority(entry)) {
      return "global_priority_frame";
    }
    if (age >= (
      isInputHotWindow(now)
        ? TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MAX_MS
        : TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS
    )) {
      return "global_background_max_latency_frame";
    }
    return "global_background_frame";
  };

  const flushFrame = () => {
    const frameStartedAt = terminalRenderNow();
    const candidates = Array.from(entries.values())
      .filter((entry) => isEntryDue(entry, frameStartedAt))
      .sort(compareEntries(frameStartedAt));

    let flushed = 0;
    let activeFlushed = 0;
    let backgroundFlushed = 0;
    let deferred = 0;
    let bytes = 0;

    frameId += 1;

    for (const entry of candidates) {
      const active = isEntryActive(entry);
      const age = entryAge(entry, frameStartedAt);
      const priority = entryHasPriority(entry);
      const starved = age >= (
        isInputHotWindow(frameStartedAt)
          ? TERMINAL_GLOBAL_RENDER_INTERACTIVE_BACKGROUND_MAX_MS
          : TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS
      );
      const elapsedMs = terminalRenderNow() - frameStartedAt;
      const reachedPaneBudget = flushed >= TERMINAL_GLOBAL_RENDER_MAX_PANES_PER_FRAME;
      const reachedBackgroundBudget = !active
        && backgroundFlushed >= TERMINAL_GLOBAL_RENDER_BACKGROUND_PANES_PER_FRAME
        && !starved
        && !priority;
      const reachedTimeBudget = !active
        && flushed > 0
        && elapsedMs >= TERMINAL_GLOBAL_RENDER_FRAME_BUDGET_MS
        && !starved
        && !priority;

      if (reachedPaneBudget || reachedBackgroundBudget || reachedTimeBudget) {
        deferred += 1;
        continue;
      }

      const entryPendingBytes = entryBytes(entry);
      bytes += entryPendingBytes;
      entry.flush(flushReasonForEntry(entry, frameStartedAt));
      flushed += 1;
      if (active) {
        activeFlushed += 1;
      } else {
        backgroundFlushed += 1;
      }
    }

    const elapsedMs = terminalRenderNow() - frameStartedAt;
    logTerminalDiagnosticEvent(
      "frontend.global_render_frame",
      {
        activeFlushed,
        backgroundFlushed,
        bytes,
        candidates: candidates.length,
        deferred,
        elapsedMs,
        frameId,
        flushed,
        registered: entries.size,
      },
      { minElapsedMs: TERMINAL_GLOBAL_RENDER_FRAME_BUDGET_MS },
    );

    scheduleNext();
  };

  return {
    cancel() {
      scheduleNext();
    },
    register(entry) {
      if (!entry?.id) {
        return;
      }
      entries.set(entry.id, entry);
      scheduleNext();
    },
    request(id) {
      const entry = entries.get(id);
      if (!entry?.hasPending?.()) {
        scheduleNext();
        return;
      }
      if (isEntryActive(entry) || entryHasPriority(entry) || entryBytes(entry) >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
        clearTimer();
        scheduleFrame();
      } else {
        scheduleTimer();
      }
    },
    noteInteractiveInput(id, options = {}) {
      const entryId = String(id || "").trim();
      if (!entryId) {
        return;
      }
      const now = terminalRenderNow();
      const durationMs = Math.max(
        TERMINAL_GLOBAL_RENDER_INTERACTIVE_GRACE_MS,
        Number(options.durationMs || 0),
      );
      interactiveEntryId = entryId;
      interactiveUntil = Math.max(interactiveUntil, now + durationMs);
      scheduleNext();
    },
    isInteractiveInputActive(id = "") {
      const globalInputHotActive = getGlobalInputHotRemainingMs() > 0;
      if (!isInteractiveWindow() && !globalInputHotActive) {
        return false;
      }
      const entryId = String(id || "").trim();
      return globalInputHotActive || !entryId || entryId === interactiveEntryId;
    },
    unregister(id) {
      entries.delete(id);
      if (interactiveEntryId === id) {
        interactiveEntryId = "";
        interactiveUntil = 0;
      }
      scheduleNext();
    },
  };
})();
