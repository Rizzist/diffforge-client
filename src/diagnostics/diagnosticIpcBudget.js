const DIAGNOSTIC_IPC_BUDGET_WINDOW_MS = 1000;
const DIAGNOSTIC_IPC_BUDGET_MAX_PER_WINDOW = 8;

let budgetWindowStartedAtMs = 0;
let budgetWindowCount = 0;
let globalDroppedCount = 0;

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function refreshBudgetWindow(now) {
  if (
    !budgetWindowStartedAtMs
    || now - budgetWindowStartedAtMs >= DIAGNOSTIC_IPC_BUDGET_WINDOW_MS
  ) {
    budgetWindowStartedAtMs = now;
    budgetWindowCount = 0;
  }
}

export function takeDiagnosticIpcBudget({ force = false } = {}) {
  if (force) {
    const dropped = globalDroppedCount;
    globalDroppedCount = 0;
    return { dropped, skip: false };
  }

  const now = nowMs();
  refreshBudgetWindow(now);

  if (budgetWindowCount >= DIAGNOSTIC_IPC_BUDGET_MAX_PER_WINDOW) {
    globalDroppedCount += 1;
    return { dropped: 0, skip: true };
  }

  budgetWindowCount += 1;
  const dropped = globalDroppedCount;
  globalDroppedCount = 0;
  return { dropped, skip: false };
}

export function withDiagnosticIpcDropCount(fields, dropped) {
  if (!dropped) {
    return fields;
  }
  return {
    ...fields,
    globalSampledDropCount: dropped,
  };
}
