export const NOTIFICATION_PREFERENCES_CONTRACT = "diffforge.notification_prefs.v1";

export const NOTIFICATION_PREFERENCE_DEFAULT_PUSH = Object.freeze({
  uir_prompts: true,
  agent_update_available: true,
  todo_started: true,
  todo_completed: true,
  loop_run_started: false,
  loop_run_completed: true,
  loop_run_failed: true,
  loop_run_blocked: true,
  awaiting_device: true,
  account_events: true,
});

export const NOTIFICATION_PREFERENCE_PUSH_OPTIONS = Object.freeze([
  {
    key: "uir_prompts",
    label: "Input prompts",
    detail: "User-input-required prompts from agent terminals.",
  },
  {
    key: "agent_update_available",
    label: "Agent updates",
    detail: "New Codex, Claude Code, and OpenCode CLI versions.",
  },
  {
    key: "todo_started",
    label: "Todo started",
    detail: "A terminal started a workspace task.",
  },
  {
    key: "todo_completed",
    label: "Todo completed",
    detail: "A terminal completed a workspace task.",
  },
  {
    key: "loop_run_started",
    label: "Loop started",
    detail: "Loop run admission and start events.",
  },
  {
    key: "loop_run_completed",
    label: "Loop completed",
    detail: "Successful loop run completion.",
  },
  {
    key: "loop_run_failed",
    label: "Loop failed",
    detail: "Failed loop runs that need review.",
  },
  {
    key: "loop_run_blocked",
    label: "Loop blocked",
    detail: "Blocked loop runs and awaiting-device handoffs.",
  },
  {
    key: "awaiting_device",
    label: "Awaiting device",
    detail: "Cloud work waiting for this desktop or another signed-in device.",
  },
  {
    key: "account_events",
    label: "Account events",
    detail: "Plan, usage, and account-level notices.",
  },
]);

export const LOOPSPACE_NOTIFICATION_OVERRIDE_KEYS = Object.freeze([
  "started",
  "completed",
  "failed",
  "blocked",
]);

export const LOOPSPACE_NOTIFICATION_OVERRIDE_OPTIONS = Object.freeze([
  { value: "inherit", label: "Inherit account default" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
]);

const TOP_LEVEL_ALIASES = new Set([
  "version",
  "push",
  "loopspace_overrides",
  "updated_at_ms",
]);

const PUSH_ALIASES = Object.freeze({
  uir_prompts: ["uir_prompts"],
  agent_update_available: ["agent_update_available", "agentUpdateAvailable"],
  todo_started: ["todo_started", "todoStarted"],
  todo_completed: ["todo_completed", "todoCompleted"],
  loop_run_started: ["loop_run_started"],
  loop_run_completed: ["loop_run_completed"],
  loop_run_failed: ["loop_run_failed"],
  loop_run_blocked: ["loop_run_blocked"],
  awaiting_device: ["awaiting_device"],
  account_events: ["account_events"],
});

const PUSH_ALIAS_KEYS = new Set(Object.values(PUSH_ALIASES).flat());
const LOOPSPACE_OVERRIDE_ALIAS_KEYS = new Set(LOOPSPACE_NOTIFICATION_OVERRIDE_KEYS);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function preferenceSource(value) {
  const source = objectValue(value);
  return objectValue(
    source.preferences || source.notification_preferences || source,
  );
}

function readBoolean(source, aliases, fallback) {
  for (const key of aliases) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }
    const value = source[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on", "enabled"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off", "disabled"].includes(normalized)) {
        return false;
      }
    }
  }
  return fallback;
}

function readTimestamp(source) {
  for (const key of ["updated_at_ms"]) {
    const timestamp = Number(source[key]);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return Math.round(timestamp);
    }
  }
  return 0;
}

function normalizeOverrideValue(value) {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["inherit", "default", "null", ""].includes(normalized)) {
      return null;
    }
    if (["true", "1", "yes", "on", "enabled"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", "disabled"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

export function normalizeNotificationPreferences(value) {
  const source = preferenceSource(value);
  const normalized = {};
  Object.entries(source).forEach(([key, entry]) => {
    if (!TOP_LEVEL_ALIASES.has(key)) {
      normalized[key] = entry;
    }
  });

  const sourcePush = objectValue(source.push);
  const push = {};
  Object.entries(sourcePush).forEach(([key, entry]) => {
    if (!PUSH_ALIAS_KEYS.has(key)) {
      push[key] = entry;
    }
  });
  Object.entries(PUSH_ALIASES).forEach(([key, aliases]) => {
    push[key] = readBoolean(sourcePush, aliases, NOTIFICATION_PREFERENCE_DEFAULT_PUSH[key]);
  });

  const sourceOverrides = objectValue(source.loopspace_overrides);
  const loopspaceOverrides = {};
  Object.entries(sourceOverrides).forEach(([loopspaceId, rawOverride]) => {
    const safeLoopspaceId = String(loopspaceId || "").trim();
    if (!safeLoopspaceId) {
      return;
    }
    const sourceOverride = objectValue(rawOverride);
    const override = {};
    Object.entries(sourceOverride).forEach(([key, entry]) => {
      if (!LOOPSPACE_OVERRIDE_ALIAS_KEYS.has(key)) {
        override[key] = entry;
      }
    });
    LOOPSPACE_NOTIFICATION_OVERRIDE_KEYS.forEach((key) => {
      override[key] = normalizeOverrideValue(sourceOverride[key]);
    });
    loopspaceOverrides[safeLoopspaceId] = override;
  });

  normalized.version = 1;
  normalized.push = push;
  normalized.loopspace_overrides = loopspaceOverrides;
  normalized.updated_at_ms = readTimestamp(source);
  return normalized;
}

export function notificationPreferencesUpdatedNow(preferences, nowMs = Date.now()) {
  return {
    ...normalizeNotificationPreferences(preferences),
    updated_at_ms: Math.max(1, Math.round(Number(nowMs) || Date.now())),
  };
}

export function notificationPreferencesSnapshotCanReplaceLocalEdit(
  preferences,
  inFlightUpdatedAtMs = 0,
) {
  const localEditTimestamp = Math.max(0, Math.round(Number(inFlightUpdatedAtMs) || 0));
  if (localEditTimestamp === 0) {
    return true;
  }
  return normalizeNotificationPreferences(preferences).updated_at_ms > localEditTimestamp;
}

const NOTIFICATION_PREFERENCES_LOAD_RETRY_DELAYS_MS = Object.freeze([500, 1_500, 5_000]);

export function notificationPreferencesLoadRetryDelayMs(failedAttempt = 0) {
  const attempt = Math.max(0, Math.floor(Number(failedAttempt) || 0));
  return NOTIFICATION_PREFERENCES_LOAD_RETRY_DELAYS_MS[attempt] ?? null;
}

function loopspaceIdFromPreferenceInventoryEntry(entry) {
  if (typeof entry === "string" || typeof entry === "number") {
    return String(entry).trim();
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "";
  }
  return String(entry.id || entry.loopspace_id || "").trim();
}

export function pruneNotificationPreferenceLoopspaceOverrides(preferences, loopspaces = []) {
  const normalized = normalizeNotificationPreferences(preferences);
  const liveLoopspaceIds = new Set(
    (Array.isArray(loopspaces) ? loopspaces : [])
      .map(loopspaceIdFromPreferenceInventoryEntry)
      .filter(Boolean),
  );
  const loopspaceOverrides = Object.fromEntries(
    Object.entries(normalized.loopspace_overrides)
      .filter(([loopspaceId]) => liveLoopspaceIds.has(loopspaceId)),
  );
  return {
    ...normalized,
    loopspace_overrides: loopspaceOverrides,
  };
}

export function setNotificationPreferencePushValue(preferences, key, enabled, nowMs = Date.now()) {
  const normalized = normalizeNotificationPreferences(preferences);
  if (!Object.prototype.hasOwnProperty.call(NOTIFICATION_PREFERENCE_DEFAULT_PUSH, key)) {
    return notificationPreferencesUpdatedNow(normalized, nowMs);
  }
  return notificationPreferencesUpdatedNow({
    ...normalized,
    push: {
      ...normalized.push,
      [key]: Boolean(enabled),
    },
  }, nowMs);
}

export function setLoopspaceNotificationOverride(preferences, loopspaceId, status, value, nowMs = Date.now()) {
  const normalized = normalizeNotificationPreferences(preferences);
  const safeLoopspaceId = String(loopspaceId || "").trim();
  if (!safeLoopspaceId || !LOOPSPACE_NOTIFICATION_OVERRIDE_KEYS.includes(status)) {
    return notificationPreferencesUpdatedNow(normalized, nowMs);
  }
  return notificationPreferencesUpdatedNow({
    ...normalized,
    loopspace_overrides: {
      ...normalized.loopspace_overrides,
      [safeLoopspaceId]: {
        started: null,
        completed: null,
        failed: null,
        blocked: null,
        ...(normalized.loopspace_overrides[safeLoopspaceId] || {}),
        [status]: normalizeOverrideValue(value),
      },
    },
  }, nowMs);
}

export function loopspaceOverrideSelectValue(value) {
  const normalized = normalizeOverrideValue(value);
  if (normalized === true) return "on";
  if (normalized === false) return "off";
  return "inherit";
}

export function loopspaceOverrideValueFromSelect(value) {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
}

export function notificationPreferencesStatusLabel(state, preferences) {
  if (state === "loading") return "Loading";
  if (state === "saving") return "Saving";
  if (state === "error") return "Error";
  return normalizeNotificationPreferences(preferences).updated_at_ms > 0 ? "Synced" : "Default";
}
