export const REMOTE_PERMISSION_CONFIG_REQUEST_EVENT = "diffforge:remote-permission-config-request";
export const REMOTE_PERMISSION_CONFIG_RESULT_EVENT = "diffforge:remote-permission-config-result";

export const REMOTE_PERMISSION_CONFIG_SOURCE = "remote-permission-config";

export const CODEX_PERMISSION_MODE_LABELS = {
  "read-only": "Read Only",
  auto: "Auto-review",
  "full-access": "Full Access",
};

const CODEX_PERMISSION_PROFILE_LABELS = [
  { key: "read-only", labels: ["read only", "read-only"] },
  { key: "auto-review", labels: ["auto-review", "auto review"] },
  { key: "auto", labels: ["auto"] },
  { key: "default", labels: ["default"] },
  { key: "full-access", labels: ["full access", "full-access"] },
];

export const CLAUDE_PERMISSION_MODE_STATUS = {
  default: ["manual mode on", "default mode on"],
  acceptEdits: ["accept edits on", "acceptedits on"],
  plan: ["plan mode on"],
  auto: ["auto mode on"],
  dontAsk: ["don't ask on", "dont ask on", "dontask on"],
  bypassPermissions: ["bypass permissions on", "bypasspermissions on"],
};

const CLAUDE_PERMISSION_ALIASES = new Map([
  ["manual", "default"],
  ["default", "default"],
  ["acceptedits", "acceptEdits"],
  ["accept-edits", "acceptEdits"],
  ["accept_edits", "acceptEdits"],
  ["plan", "plan"],
  ["auto", "auto"],
  ["dontask", "dontAsk"],
  ["dont-ask", "dontAsk"],
  ["dont_ask", "dontAsk"],
  ["don'task", "dontAsk"],
  ["bypasspermissions", "bypassPermissions"],
  ["bypass-permissions", "bypassPermissions"],
  ["bypass_permissions", "bypassPermissions"],
]);

const CODEX_PERMISSION_ALIASES = new Map([
  ["read-only", "read-only"],
  ["readonly", "read-only"],
  ["read_only", "read-only"],
  ["auto", "auto"],
  ["default", "auto"],
  ["full-access", "full-access"],
  ["full_access", "full-access"],
  ["danger-full-access", "full-access"],
]);

function normalizePermissionToken(value = "") {
  return String(value || "")
    .trim()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

function compactPermissionText(value = "") {
  return normalizePermissionToken(value)
    .toLowerCase()
    .replace(/[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function terminalRowLooksLikeTranscript(row = "") {
  return /^\s*(assistant|user|human|system|developer|tool)\b/i.test(normalizePermissionToken(row));
}

export function normalizePermissionModeForProvider(provider, value) {
  const safeProvider = String(provider || "").trim().toLowerCase();
  const raw = normalizePermissionToken(value);
  const key = raw.toLowerCase().replace(/\s+/g, "-");
  if (safeProvider === "codex") {
    return CODEX_PERMISSION_ALIASES.get(key) || "";
  }
  if (safeProvider === "claude") {
    return CLAUDE_PERMISSION_ALIASES.get(key) || CLAUDE_PERMISSION_ALIASES.get(key.replace(/-/g, "")) || "";
  }
  if (safeProvider === "opencode") {
    return raw ? raw.toLowerCase() : "";
  }
  return raw;
}

export function codexPermissionLabelForMode(mode) {
  return CODEX_PERMISSION_MODE_LABELS[normalizePermissionModeForProvider("codex", mode)] || "";
}

export function extractVisibleTerminalRows(text = "") {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizePermissionToken(line).replace(/\u00a0/g, " ").trim())
    .filter(Boolean);
}

const CODEX_PERMISSION_POINTER_REGEX = /^\s*(?:>|›|❯|▶|●|◉)\s*/u;

function codexPermissionPickerRow(row = "", rowIndex = -1) {
  if (terminalRowLooksLikeTranscript(row)) {
    return null;
  }
  const selected = CODEX_PERMISSION_POINTER_REGEX.test(row);
  const withoutPointer = normalizePermissionToken(row).replace(CODEX_PERMISSION_POINTER_REGEX, "");
  const numberedMatch = withoutPointer.match(/^([1-9][0-9]?)\s*[.)]\s*(.+)$/u);
  const labelText = compactPermissionText(numberedMatch?.[2] || withoutPointer);
  const profile = CODEX_PERMISSION_PROFILE_LABELS.find(({ labels }) => (
    labels.some((label) => labelText === label || labelText.startsWith(`${label} `))
  ));
  if (!profile) {
    return null;
  }
  return {
    key: profile.key,
    label: row,
    numbered: Boolean(numberedMatch),
    rowIndex,
    selected,
    text: labelText,
  };
}

function codexPermissionPickerBlocks(rows = []) {
  const candidates = rows
    .map((row, rowIndex) => codexPermissionPickerRow(row, rowIndex))
    .filter(Boolean);
  const blocks = [];
  let currentBlock = [];
  for (const candidate of candidates) {
    if (
      currentBlock.length
      && (
        candidate.rowIndex - currentBlock[currentBlock.length - 1].rowIndex > 4
        || currentBlock.some((row) => row.key === candidate.key)
        || (candidate.selected && currentBlock.some((row) => row.selected))
      )
    ) {
      blocks.push(currentBlock);
      currentBlock = [];
    }
    currentBlock.push(candidate);
  }
  if (currentBlock.length) {
    blocks.push(currentBlock);
  }

  return blocks.filter((block) => {
    const keys = block.map((row) => row.key);
    const uniqueKeys = new Set(keys);
    const selectedRows = block.filter((row) => row.selected);
    const legacyShape = keys.length === 3
      && ["read-only", "auto", "full-access"].every((key) => uniqueKeys.has(key));
    const currentShape = keys.length === 3
      && ["default", "auto-review", "full-access"].every((key) => uniqueKeys.has(key));
    return (
      selectedRows.length === 1
      && uniqueKeys.size === keys.length
      && (legacyShape || currentShape)
    );
  });
}

function codexPermissionTargetKeys(mode = "") {
  const targetMode = normalizePermissionModeForProvider("codex", mode);
  if (targetMode === "auto") {
    // Prefer the current profile name, then the legacy name. "Default" is a
    // safe compatibility fallback only when neither explicit auto label exists.
    return ["auto-review", "auto", "default"];
  }
  return targetMode ? [targetMode] : [];
}

export function findCodexPermissionPickerTarget(text = "", mode = "") {
  const targetMode = normalizePermissionModeForProvider("codex", mode);
  const targetLabel = codexPermissionLabelForMode(targetMode);
  const rows = extractVisibleTerminalRows(text);
  const pickerCandidates = rows
    .map((row, rowIndex) => codexPermissionPickerRow(row, rowIndex))
    .filter(Boolean);
  const validBlocks = codexPermissionPickerBlocks(rows);
  if (validBlocks.length !== 1) {
    return {
      ambiguous: validBlocks.length > 1,
      arrowDownCount: -1,
      found: false,
      label: targetLabel,
      rows: pickerCandidates.map((row) => row.label),
      selectedIndex: -1,
      targetIndex: -1,
      targetMode,
    };
  }

  const pickerRows = validBlocks[0];
  const targetKeys = codexPermissionTargetKeys(targetMode);
  let targetIndex = -1;
  for (const targetKey of targetKeys) {
    const matches = pickerRows
      .map((row, index) => (row.key === targetKey ? index : -1))
      .filter((index) => index >= 0);
    if (matches.length > 1) {
      targetIndex = -1;
      break;
    }
    if (matches.length === 1) {
      targetIndex = matches[0];
      break;
    }
  }
  const selectedIndex = pickerRows.findIndex((row) => row.selected);
  const arrowDownCount = targetIndex < 0
    ? -1
    : (targetIndex - selectedIndex + pickerRows.length) % pickerRows.length;
  return {
    ambiguous: false,
    arrowDownCount,
    found: targetIndex >= 0 && selectedIndex >= 0,
    label: targetLabel,
    rows: pickerRows.map((row) => row.label),
    selectedIndex,
    targetIndex,
    targetMode,
  };
}

export function codexPermissionPickerOpen(text = "") {
  const rows = extractVisibleTerminalRows(text);
  return codexPermissionPickerBlocks(rows).length === 1;
}

export function extractTerminalStatusRows(text = "", rowLimit = 5) {
  const rows = extractVisibleTerminalRows(text);
  const tailRows = rows.slice(-Math.max(1, Number(rowLimit) || 5));
  return tailRows.filter((row) => {
    if (terminalRowLooksLikeTranscript(row)) {
      return false;
    }
    const compact = compactPermissionText(row);
    const normalized = normalizePermissionToken(row).toLowerCase();
    return (
      compact.includes("status")
      || compact.includes("footer")
      || compact.includes("mode on")
      || /\bmode\s*[:=]/.test(normalized)
      || compact.includes("accept edits on")
      || compact.includes("dont ask on")
      || compact.includes("don't ask on")
      || compact.includes("bypass permissions on")
      || compact.includes("agent")
      || compact.includes("permission")
      || compact.includes("approval")
      || compact.includes("sandbox")
      || compact.includes("read only")
      || compact.includes("read-only")
      || compact.includes("full access")
      || compact.includes("full-access")
      || compact.includes("workspace write")
      || compact.includes("workspace-write")
      || compact.includes("danger full access")
      || compact.includes("danger-full-access")
    );
  });
}

export function codexPermissionModeFromStatusText(text = "") {
  const compact = compactPermissionText(extractTerminalStatusRows(text, 8).join(" "));
  if (!compact) {
    return "";
  }
  if (
    compact.includes("full access")
    || compact.includes("full-access")
    || compact.includes("danger full access")
    || compact.includes("danger-full-access")
    || (compact.includes("approval") && compact.includes("never") && compact.includes("danger"))
  ) {
    return "full-access";
  }
  if (
    compact.includes("read only")
    || compact.includes("read-only")
    || (compact.includes("sandbox") && compact.includes("read-only"))
  ) {
    return "read-only";
  }
  if (
    compact.includes("auto")
    || /\bpermissions?\s*[:=]?\s*default\b/.test(compact)
    || (compact.includes("on request") && (compact.includes("workspace write") || compact.includes("workspace-write")))
    || (compact.includes("on-request") && (compact.includes("workspace write") || compact.includes("workspace-write")))
  ) {
    return "auto";
  }
  return "";
}

export function codexPermissionPostSelectionState(text = "", mode = "") {
  const targetMode = normalizePermissionModeForProvider("codex", mode);
  const rows = extractVisibleTerminalRows(text);
  const statusRows = extractTerminalStatusRows(text, 8);
  const errorRows = rows.filter((row) => (
    /\b(error|failed|failure|invalid|unavailable|not allowed|unable)\b/i.test(row)
  )).slice(-4);
  const currentMode = codexPermissionModeFromStatusText(text);
  return {
    errorRows,
    evidenceRows: statusRows,
    matched: Boolean(targetMode && currentMode === targetMode),
    mode: currentMode,
    targetMode,
  };
}

export function claudePermissionModeFromText(text = "") {
  const compact = compactPermissionText(extractTerminalStatusRows(text, 2).join(" "));
  for (const [mode, needles] of Object.entries(CLAUDE_PERMISSION_MODE_STATUS)) {
    if (needles.some((needle) => compact.includes(compactPermissionText(needle)))) {
      return mode;
    }
  }
  return "";
}

export function claudePermissionTargetAvailableInCycle(mode, seenModes = []) {
  const targetMode = normalizePermissionModeForProvider("claude", mode);
  if (targetMode === "dontAsk") {
    return false;
  }
  if (targetMode === "bypassPermissions" || targetMode === "auto") {
    return seenModes.includes(targetMode);
  }
  return ["default", "acceptEdits", "plan"].includes(targetMode);
}

export function opencodeAgentModeFromText(text = "") {
  const rows = extractTerminalStatusRows(text, 5);
  const rowHasFooterContext = (row) => (
    /\b(?:tab|shift|ctrl|esc|enter|agents|status|footer|keybind|shortcut)\b/i.test(row)
  );
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!rowHasFooterContext(row)) {
      continue;
    }
    const normalized = normalizePermissionToken(row);
    const patterns = [
      /^\s*(?:current\s+agent|agent)\s*[:=]\s*([a-z0-9_-]{1,64})/i,
      /^\s*(?:status|footer)\b.*\b(?:current\s+agent|agent)\s*[:=]\s*([a-z0-9_-]{1,64})/i,
      /^\s*agent\s+([a-z0-9_-]{1,64})\b/i,
      /^\s*mode\s*[:=]\s*([a-z0-9_-]{1,64})/i,
    ];
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
    }
    const leading = normalized.match(/^\s*(build|plan)\b/i);
    if (leading?.[1] && /\b(?:tab|agents?|auto)\b/i.test(row)) {
      return leading[1].toLowerCase();
    }
  }
  return "";
}

export function appendUniqueMode(seenModes = [], mode = "") {
  const safeMode = String(mode || "").trim();
  if (!safeMode || seenModes.includes(safeMode)) {
    return seenModes;
  }
  return [...seenModes, safeMode];
}

export async function cyclePermissionModeWithBestEffortRestore({
  cycleMode,
  maxCycleSteps = 8,
  originalMode = "",
  targetMode = "",
} = {}) {
  const safeOriginalMode = String(originalMode || "").trim();
  const safeTargetMode = String(targetMode || "").trim();
  const cycle = typeof cycleMode === "function" ? cycleMode : null;
  const stepLimit = Math.max(1, Math.floor(Number(maxCycleSteps) || 8));
  let currentMode = safeOriginalMode;
  let seenModes = appendUniqueMode([], currentMode);
  let cycleError = null;

  if (!cycle || !safeOriginalMode || !safeTargetMode) {
    return {
      applied: false,
      currentMode,
      cycleError: new Error("Permission cycling requires the original mode, target mode, and cycle callback."),
      restoreError: null,
      restored: currentMode === safeOriginalMode,
      seenModes,
    };
  }

  try {
    for (let index = 0; index < stepLimit; index += 1) {
      currentMode = String(await cycle() || "").trim();
      seenModes = appendUniqueMode(seenModes, currentMode);
      if (currentMode === safeTargetMode) {
        return {
          applied: true,
          currentMode,
          cycleError: null,
          restoreError: null,
          restored: false,
          seenModes,
        };
      }
      if (currentMode === safeOriginalMode) {
        break;
      }
    }
  } catch (error) {
    cycleError = error;
  }

  // A rejected write may still have reached the PTY before the error was
  // observed, so a cycle error makes the current mode unknown even when the
  // last successfully parsed value was the original.
  let restored = !cycleError && currentMode === safeOriginalMode;
  let restoreError = null;
  if (!restored) {
    for (let index = 0; index < stepLimit; index += 1) {
      try {
        currentMode = String(await cycle() || "").trim();
        seenModes = appendUniqueMode(seenModes, currentMode);
        if (currentMode === safeOriginalMode) {
          restored = true;
          break;
        }
      } catch (error) {
        restoreError = error;
        break;
      }
    }
  }

  return {
    applied: false,
    currentMode,
    cycleError,
    restoreError,
    restored,
    seenModes,
  };
}
