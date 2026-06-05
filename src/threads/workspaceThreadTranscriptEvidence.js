function normalizeWorkspaceThreadProjectionText(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function workspaceThreadMessageTimestampMs(message) {
  const createdAt = String(message?.createdAt || message?.created_at || "").trim();
  const numericTimestamp = Number.parseFloat(createdAt);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 1_000_000_000) {
    return numericTimestamp < 10_000_000_000 ? numericTimestamp * 1000 : numericTimestamp;
  }

  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function transcriptMessageIndicatesTurnComplete(message) {
  const id = normalizeWorkspaceThreadProjectionText(message?.id).toLowerCase();
  const kind = normalizeWorkspaceThreadProjectionText(message?.kind).toLowerCase();
  const status = normalizeWorkspaceThreadProjectionText(message?.status).toLowerCase();
  const title = normalizeWorkspaceThreadProjectionText(message?.title).toLowerCase();
  return kind === "task_complete"
    || kind === "final_answer"
    || status === "task_complete"
    || id.includes("task-complete")
    || title === "task complete";
}

function transcriptMessageStartsUserTurn(message) {
  return String(message?.role || "").trim().toLowerCase() === "user";
}

export function transcriptHasTurnCompletionForPrompt(messages, event = {}) {
  const promptText = normalizeWorkspaceThreadProjectionText(
    event.expectedUserMessage || event.userMessage || event.message,
  );
  const submittedAtMs = workspaceThreadMessageTimestampMs({
    createdAt: event.messageCreatedAt || event.submittedAt || event.createdAt,
  });
  const matchedBy = String(event.matchedBy || "").trim().toLowerCase();
  const allowTimestampFallback = event.allowTimestampFallback === true
    || matchedBy.includes("timestamp")
    || matchedBy.includes("recovery");
  const transcriptMessages = Array.isArray(messages) ? messages : [];
  let userIndex = -1;

  if (promptText) {
    transcriptMessages.forEach((message, index) => {
      const role = String(message?.role || "").trim().toLowerCase();
      const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
      if (
        role === "user"
        && normalizeWorkspaceThreadProjectionText(message?.text || message?.message) === promptText
        && (
          !submittedAtMs
          || !messageTimestampMs
          || messageTimestampMs >= submittedAtMs - 30000
        )
      ) {
        userIndex = index;
      }
    });
  }

  if (userIndex < 0 && submittedAtMs && (!promptText || allowTimestampFallback)) {
    transcriptMessages.forEach((message, index) => {
      const role = String(message?.role || "").trim().toLowerCase();
      const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
      if (role === "user" && messageTimestampMs && messageTimestampMs >= submittedAtMs - 30000) {
        userIndex = index;
      }
    });
  }

  if (promptText && userIndex < 0 && !allowTimestampFallback) {
    return false;
  }

  const turnEndIndex = userIndex >= 0
    ? transcriptMessages.findIndex((message, index) => (
      index > userIndex && transcriptMessageStartsUserTurn(message)
    ))
    : -1;
  const searchEndIndex = turnEndIndex >= 0 ? turnEndIndex : transcriptMessages.length;

  return transcriptMessages.some((message, index) => {
    if (userIndex >= 0 && (index <= userIndex || index >= searchEndIndex)) {
      return false;
    }
    if (!transcriptMessageIndicatesTurnComplete(message)) {
      return false;
    }
    const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
    return submittedAtMs
      ? Boolean(messageTimestampMs && messageTimestampMs >= submittedAtMs - 30000)
      : true;
  });
}
