import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

const DEFAULT_MIN_COLS = 20;
const DEFAULT_MIN_ROWS = 6;
const DEFAULT_MAX_COLS = 400;
const DEFAULT_MAX_ROWS = 160;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_DEBOUNCE_MS = 16;
const MAX_INVALID_CELL_RETRIES = 30;

function clampDimension(value, fallback, minimum, maximum) {
  const numericValue = Number.isFinite(value) ? Math.floor(value) : fallback;

  return Math.min(maximum, Math.max(minimum, numericValue));
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function callSafely(callback, payload) {
  if (typeof callback !== "function") {
    return;
  }

  try {
    callback(payload);
  } catch {
    // Resize callbacks are diagnostic hooks; resizing must not depend on telemetry.
  }
}

function getOptionValue(value, fallback) {
  return typeof value === "function" ? value() : value ?? fallback;
}

function getPositiveNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

function getContainerResizeSnapshot(container) {
  if (!container || typeof container.getBoundingClientRect !== "function") {
    return {};
  }

  const bounds = container.getBoundingClientRect();

  return {
    containerHeight: Number(bounds.height),
    containerWidth: Number(bounds.width),
  };
}

export function getTerminalActualCellSize(term) {
  const dimensions = term?._core?._renderService?.dimensions;
  const actualCellWidth = getPositiveNumber(dimensions?.actualCellWidth);
  const actualCellHeight = getPositiveNumber(dimensions?.actualCellHeight);

  if (actualCellWidth && actualCellHeight) {
    return {
      actualCellWidth,
      actualCellHeight,
      metricSource: "actual",
      valid: true,
    };
  }

  const cssCellWidth = getPositiveNumber(dimensions?.css?.cell?.width);
  const cssCellHeight = getPositiveNumber(dimensions?.css?.cell?.height);

  if (cssCellWidth && cssCellHeight) {
    return {
      actualCellWidth: cssCellWidth,
      actualCellHeight: cssCellHeight,
      metricSource: "css_cell",
      valid: true,
    };
  }

  return {
    actualCellWidth: Number(dimensions?.actualCellWidth),
    actualCellHeight: Number(dimensions?.actualCellHeight),
    metricSource: "missing",
    valid: false,
  };
}

export function measureTerminalGrid({
  container,
  term,
  defaultCols = DEFAULT_COLS,
  defaultRows = DEFAULT_ROWS,
  minCols = DEFAULT_MIN_COLS,
  minRows = DEFAULT_MIN_ROWS,
  maxCols = DEFAULT_MAX_COLS,
  maxRows = DEFAULT_MAX_ROWS,
} = {}) {
  if (!container || !term) {
    return {
      ok: false,
      reason: "missing_terminal_or_container",
      cols: defaultCols,
      rows: defaultRows,
    };
  }

  const bounds = container.getBoundingClientRect();
  const containerWidth = Number(bounds.width);
  const containerHeight = Number(bounds.height);

  if (!Number.isFinite(containerWidth) || !Number.isFinite(containerHeight)) {
    return {
      ok: false,
      reason: "invalid_container_bounds",
      cols: defaultCols,
      rows: defaultRows,
      containerHeight,
      containerWidth,
    };
  }

  if (containerWidth < 1 || containerHeight < 1) {
    return {
      ok: false,
      reason: "zero_container",
      cols: defaultCols,
      rows: defaultRows,
      containerHeight,
      containerWidth,
    };
  }

  const {
    actualCellWidth,
    actualCellHeight,
    metricSource,
    valid: hasValidCellMetrics,
  } = getTerminalActualCellSize(term);

  if (!hasValidCellMetrics) {
    return {
      ok: false,
      reason: "invalid_cell_metrics",
      cols: defaultCols,
      rows: defaultRows,
      actualCellHeight,
      actualCellWidth,
      containerHeight,
      containerWidth,
      metricSource,
    };
  }

  const rawCols = Math.floor(containerWidth / actualCellWidth);
  const rawRows = Math.floor(containerHeight / actualCellHeight);
  const cols = clampDimension(rawCols, defaultCols, minCols, maxCols);
  const rows = clampDimension(rawRows, defaultRows, minRows, maxRows);

  return {
    ok: true,
    actualCellHeight,
    actualCellWidth,
    cols,
    containerHeight,
    containerWidth,
    metricSource,
    rawCols,
    rawRows,
    rows,
  };
}

export function createTerminalResizeController({
  canResize,
  command = "resize_terminal",
  container,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  defaultCols = DEFAULT_COLS,
  defaultRows = DEFAULT_ROWS,
  getWebglAddon,
  instanceId,
  maxCols = DEFAULT_MAX_COLS,
  maxRows = DEFAULT_MAX_ROWS,
  minCols = DEFAULT_MIN_COLS,
  minRows = DEFAULT_MIN_ROWS,
  onDone,
  onError,
  onSchedule,
  onSkip,
  onStart,
  paneId,
  term,
} = {}) {
  if (!container || !term || typeof ResizeObserver !== "function") {
    return null;
  }

  let debounceTimer = 0;
  let disposed = false;
  let inFlight = false;
  let invalidCellRetryCount = 0;
  let lastAppliedSize = null;
  let pendingAfterFlight = false;
  let pendingReason = "";

  const getPaneId = () => getOptionValue(paneId, "");
  const getInstanceId = () => getOptionValue(instanceId, undefined);
  const getCanResize = () => (typeof canResize === "function" ? canResize() : canResize !== false);

  const clearDebounce = () => {
    if (!debounceTimer) {
      return;
    }

    window.clearTimeout(debounceTimer);
    debounceTimer = 0;
  };

  const schedule = (reason = "resize_observer", delayMs = debounceMs) => {
    if (disposed) {
      return;
    }

    const normalizedDelayMs = Math.max(0, delayMs);
    callSafely(onSchedule, {
      ...getContainerResizeSnapshot(container),
      canResize: getCanResize(),
      cols: term.cols,
      delayMs: normalizedDelayMs,
      hasDebounceTimer: Boolean(debounceTimer),
      inFlight,
      lastAppliedCols: lastAppliedSize?.cols ?? null,
      lastAppliedRows: lastAppliedSize?.rows ?? null,
      pendingAfterFlight,
      reason,
      rows: term.rows,
    });

    clearDebounce();
    debounceTimer = window.setTimeout(() => {
      debounceTimer = 0;
      resizeNow(reason);
    }, normalizedDelayMs);
  };

  const observer = new ResizeObserver(() => {
    schedule("resize_observer", debounceMs);
  });

  async function resizeNow(reason = "manual") {
    if (disposed) {
      return false;
    }

    if (inFlight) {
      pendingAfterFlight = true;
      pendingReason = reason;
      callSafely(onSkip, {
        ...getContainerResizeSnapshot(container),
        cols: term.cols,
        inFlight: true,
        lastAppliedCols: lastAppliedSize?.cols ?? null,
        lastAppliedRows: lastAppliedSize?.rows ?? null,
        pendingAfterFlight,
        reason,
        rows: term.rows,
        skipped: "in_flight",
      });
      return false;
    }

    if (!getCanResize()) {
      callSafely(onSkip, { reason, skipped: "backend_not_ready" });
      return false;
    }

    const measuredAt = nowMs();
    const measurement = measureTerminalGrid({
      container,
      term,
      defaultCols,
      defaultRows,
      minCols,
      minRows,
      maxCols,
      maxRows,
    });

    if (!measurement.ok) {
      callSafely(onSkip, {
        ...measurement,
        reason,
        skipped: measurement.reason,
      });

      if (
        measurement.reason === "invalid_cell_metrics"
        && invalidCellRetryCount < MAX_INVALID_CELL_RETRIES
      ) {
        invalidCellRetryCount += 1;
        schedule("invalid_cell_metrics_retry", debounceMs);
      }

      return false;
    }

    invalidCellRetryCount = 0;

    const { cols, rows } = measurement;

    if (lastAppliedSize?.cols === cols && lastAppliedSize?.rows === rows) {
      callSafely(onSkip, {
        ...measurement,
        reason,
        skipped: "duplicate_size",
      });
      return false;
    }

    const request = { cols, rows };
    const resolvedPaneId = getPaneId();
    const resolvedInstanceId = getInstanceId();

    if (resolvedPaneId) {
      request.paneId = resolvedPaneId;
    }

    if (resolvedInstanceId) {
      request.instanceId = resolvedInstanceId;
    }

    inFlight = true;
    callSafely(onStart, {
      ...measurement,
      reason,
      request,
    });

    try {
      await invoke(command, request);

      if (disposed) {
        return false;
      }

      term.resize(cols, rows);

      const webglAddon = typeof getWebglAddon === "function" ? getWebglAddon() : null;
      const clearTextureAtlas = webglAddon?.clearTextureAtlas;
      const clearedTextureAtlas = typeof clearTextureAtlas === "function";

      if (clearedTextureAtlas) {
        try {
          clearTextureAtlas.call(webglAddon);
        } catch {
          // WebGL atlas clearing is best-effort; xterm has already accepted the grid.
        }
      }

      lastAppliedSize = { cols, rows };
      callSafely(onDone, {
        ...measurement,
        clearedTextureAtlas,
        elapsedMs: nowMs() - measuredAt,
        reason,
      });
      return true;
    } catch (error) {
      callSafely(onError, {
        ...measurement,
        error,
        elapsedMs: nowMs() - measuredAt,
        reason,
      });
      return false;
    } finally {
      inFlight = false;

      if (pendingAfterFlight && !disposed) {
        const nextReason = pendingReason || "pending_resize";
        pendingAfterFlight = false;
        pendingReason = "";
        schedule(nextReason, debounceMs);
      }
    }
  }

  observer.observe(container);

  return {
    dispose() {
      disposed = true;
      clearDebounce();
      observer.disconnect();
    },
    resizeNow,
    schedule,
  };
}

export function useTerminalResizeController(options = {}) {
  const {
    enabled = true,
    containerRef,
    termRef,
  } = options;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const controller = createTerminalResizeController({
      ...options,
      container: options.container || containerRef?.current,
      term: options.term || termRef?.current,
    });

    return () => {
      controller?.dispose();
    };
  }, [enabled, options.paneId, options.instanceId]);
}
