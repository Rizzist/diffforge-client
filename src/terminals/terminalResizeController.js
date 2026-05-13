import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

const DEFAULT_MIN_COLS = 20;
const DEFAULT_MIN_ROWS = 6;
const DEFAULT_MAX_COLS = 400;
const DEFAULT_MAX_ROWS = 160;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_DEBOUNCE_MS = 16;
const DEFAULT_NATIVE_RESIZE_TRAILING_MS = 100;
const MAX_INVALID_CELL_RETRIES = 30;

const pendingFrameResizeControllers = new Set();
let resizeFrameHandle = 0;

function clampDimension(value, fallback, minimum, maximum) {
  const numericValue = Number.isFinite(value) ? Math.floor(value) : fallback;

  return Math.min(maximum, Math.max(minimum, numericValue));
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function requestResizeFrame() {
  if (resizeFrameHandle) {
    return;
  }

  resizeFrameHandle = window.requestAnimationFrame(() => {
    resizeFrameHandle = 0;
    const controllers = Array.from(pendingFrameResizeControllers);
    pendingFrameResizeControllers.clear();
    controllers.forEach((controller) => controller.flushScheduledResize());

    if (pendingFrameResizeControllers.size) {
      requestResizeFrame();
    }
  });
}

function enqueueResizeController(controller) {
  if (!controller) {
    return;
  }

  pendingFrameResizeControllers.add(controller);
  requestResizeFrame();
}

function removeResizeController(controller) {
  pendingFrameResizeControllers.delete(controller);
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
  nativeResizeTrailingMs = DEFAULT_NATIVE_RESIZE_TRAILING_MS,
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

  let controller = null;
  let disposed = false;
  let invalidCellRetryCount = 0;
  let lastAppliedSize = null;
  let lastNativeAppliedSize = null;
  let nativeInFlight = false;
  let nativePendingAfterFlight = false;
  let nativeResizeTimer = 0;
  let pendingNativeRequest = null;
  let pendingNativeReason = "";
  let queuedForResizeFrame = false;
  let queuedResizeDeadlineMs = 0;
  let queuedResizeReason = "";

  const getPaneId = () => getOptionValue(paneId, "");
  const getInstanceId = () => getOptionValue(instanceId, undefined);
  const getCanResize = () => (typeof canResize === "function" ? canResize() : canResize !== false);

  const clearNativeResizeTimer = () => {
    if (!nativeResizeTimer) {
      return;
    }

    window.clearTimeout(nativeResizeTimer);
    nativeResizeTimer = 0;
  };

  const flushNativeResize = async () => {
    nativeResizeTimer = 0;

    if (disposed || !pendingNativeRequest) {
      return;
    }

    if (nativeInFlight) {
      nativePendingAfterFlight = true;
      return;
    }

    const request = pendingNativeRequest;
    const reason = pendingNativeReason;
    pendingNativeRequest = null;
    pendingNativeReason = "";

    if (
      lastNativeAppliedSize?.cols === request.cols
      && lastNativeAppliedSize?.rows === request.rows
      && lastNativeAppliedSize?.paneId === request.paneId
      && lastNativeAppliedSize?.instanceId === request.instanceId
    ) {
      return;
    }

    nativeInFlight = true;
    try {
      await invoke(command, request);
      lastNativeAppliedSize = {
        cols: request.cols,
        instanceId: request.instanceId,
        paneId: request.paneId,
        rows: request.rows,
      };
    } catch (error) {
      callSafely(onError, {
        cols: request.cols,
        error,
        reason,
        rows: request.rows,
      });
    } finally {
      nativeInFlight = false;

      if (!disposed && (nativePendingAfterFlight || pendingNativeRequest)) {
        nativePendingAfterFlight = false;
        clearNativeResizeTimer();
        nativeResizeTimer = window.setTimeout(flushNativeResize, 0);
      }
    }
  };

  const scheduleNativeResize = (request, reason, delayMs) => {
    if (disposed || !request?.cols || !request?.rows) {
      return;
    }

    pendingNativeRequest = request;
    pendingNativeReason = reason;
    clearNativeResizeTimer();
    nativeResizeTimer = window.setTimeout(
      flushNativeResize,
      Math.max(0, delayMs),
    );
  };

  const schedule = (reason = "resize_observer", delayMs = debounceMs) => {
    if (disposed) {
      return;
    }

    const normalizedDelayMs = Math.max(0, delayMs);
    callSafely(onSchedule, {
      canResize: getCanResize(),
      cols: term.cols,
      delayMs: normalizedDelayMs,
      hasDebounceTimer: queuedForResizeFrame,
      inFlight: nativeInFlight,
      lastAppliedCols: lastAppliedSize?.cols ?? null,
      lastAppliedRows: lastAppliedSize?.rows ?? null,
      pendingAfterFlight: nativePendingAfterFlight || Boolean(pendingNativeRequest),
      reason,
      rows: term.rows,
    });

    queuedResizeReason = reason;

    if (!queuedForResizeFrame) {
      queuedForResizeFrame = true;
      queuedResizeDeadlineMs = nowMs() + normalizedDelayMs;
    } else {
      queuedResizeDeadlineMs = Math.min(
        queuedResizeDeadlineMs,
        nowMs() + normalizedDelayMs,
      );
    }

    enqueueResizeController(controller);
  };

  const observer = new ResizeObserver(() => {
    schedule("resize_observer", debounceMs);
  });

  function flushScheduledResize() {
    if (disposed || !queuedForResizeFrame) {
      queuedForResizeFrame = false;
      return;
    }

    if (nowMs() < queuedResizeDeadlineMs) {
      enqueueResizeController(controller);
      return;
    }

    const reason = queuedResizeReason || "resize_observer";
    queuedForResizeFrame = false;
    queuedResizeDeadlineMs = 0;
    queuedResizeReason = "";
    resizeNow(reason, { nativeDelayMs: nativeResizeTrailingMs });
  }

  async function resizeNow(reason = "manual", options = {}) {
    if (disposed) {
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
        inFlight: nativeInFlight,
        pendingAfterFlight: nativePendingAfterFlight || Boolean(pendingNativeRequest),
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

    callSafely(onStart, {
      ...measurement,
      reason,
      request,
    });

    try {
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
      scheduleNativeResize(
        request,
        reason,
        options.nativeDelayMs ?? 0,
      );
      return true;
    } catch (error) {
      callSafely(onError, {
        ...measurement,
        error,
        elapsedMs: nowMs() - measuredAt,
        reason,
      });
      return false;
    }
  }

  controller = {
    dispose() {
      disposed = true;
      queuedForResizeFrame = false;
      removeResizeController(controller);
      clearNativeResizeTimer();
      observer.disconnect();
    },
    flushScheduledResize,
    resizeNow,
    schedule,
  };

  observer.observe(container);

  return controller;
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
