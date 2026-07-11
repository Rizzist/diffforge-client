export const TODO_QUEUE_COMPOSER_IDLE_BEFORE_SEND_MS = 60 * 1000;

const TODO_QUEUE_HUMAN_COMPOSER_SOURCES = new Set([
  "bigview_sync_after_delta",
  "bigview_sync_shared_only",
  "terminal_input_observed",
]);

function composerSourceLooksHumanInput(source) {
  const normalizedSource = String(source || "").trim().toLowerCase();
  if (!normalizedSource) {
    return false;
  }

  return TODO_QUEUE_HUMAN_COMPOSER_SOURCES.has(normalizedSource)
    || normalizedSource.startsWith("tui-manual-input")
    || normalizedSource.includes("manual_input");
}

export function getTodoQueueComposerTargetAvailability(record = {}, options = {}) {
  const draftValue = String(record?.value || "");
  const source = String(record?.source || "").trim();
  const updatedAt = String(record?.updated_at || "").trim();
  const updatedAtMs = Date.parse(updatedAt) || 0;
  const nowMs = Number.isFinite(Number(options.now_ms))
    ? Number(options.now_ms)
    : Date.now();
  const idleBeforeSendMs = Math.max(
    0,
    Number(options.idleBeforeSendMs ?? TODO_QUEUE_COMPOSER_IDLE_BEFORE_SEND_MS) || 0,
  );
  const idleAgeMs = updatedAtMs ? Math.max(0, nowMs - updatedAtMs) : null;
  const humanInputSource = composerSourceLooksHumanInput(source);

  const base = {
    composerDraftLength: draftValue.length,
    composerDraftSource: source,
    composerDraftUpdatedAt: updatedAt,
    composerDraftUpdatedAtMs: updatedAtMs,
    composerIdleAgeMs: idleAgeMs,
    composerIdleBeforeSendMs: idleBeforeSendMs,
    composerHumanInputSource: humanInputSource,
  };

  if (draftValue.length > 0) {
    return {
      ...base,
      available: false,
      message: "This terminal already has unsent composer text.",
      reason: "composer_draft_present",
    };
  }

  if (
    humanInputSource
    && updatedAtMs
    && idleAgeMs !== null
    && idleAgeMs < idleBeforeSendMs
  ) {
    return {
      ...base,
      available: false,
      message: "This terminal input was edited less than a minute ago.",
      reason: "composer_recently_active",
    };
  }

  return {
    ...base,
    available: true,
    message: "",
    reason: "",
  };
}
