import { invoke } from "@tauri-apps/api/core";

import { logTerminalDiagnosticDuration, logTerminalDiagnosticEvent } from "./terminalDiagnostics";

const DEFAULT_MIN_COLS = 20;
const DEFAULT_MIN_ROWS = 6;
const DEFAULT_MAX_COLS = 400;
const DEFAULT_MAX_ROWS = 160;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_DEBOUNCE_MS = 0;
const DEFAULT_NATIVE_RESIZE_TRAILING_MS = 260;
const DEFAULT_NATIVE_RESIZE_COMMIT_MS = 260;
const MAX_INVALID_CELL_RETRIES = 30;
const RESIZE_DIAGNOSTIC_SLOW_MS = 16;

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
    const frameStartedAt = nowMs();
    resizeFrameHandle = 0;
    const controllers = Array.from(pendingFrameResizeControllers);
    pendingFrameResizeControllers.clear();
    controllers.forEach((controller) => controller.flushScheduledResize());
    logTerminalDiagnosticDuration(
      "frontend.resize_frame.slow",
      frameStartedAt,
      { controllers: controllers.length },
      { minElapsedMs: RESIZE_DIAGNOSTIC_SLOW_MS },
    );

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

function getElementLayoutSize(element) {
  const clientWidth = getPositiveNumber(element?.clientWidth);
  const clientHeight = getPositiveNumber(element?.clientHeight);

  if (clientWidth && clientHeight) {
    return {
      height: clientHeight,
      source: "client",
      width: clientWidth,
    };
  }

  const offsetWidth = getPositiveNumber(element?.offsetWidth);
  const offsetHeight = getPositiveNumber(element?.offsetHeight);

  if (offsetWidth && offsetHeight) {
    return {
      height: offsetHeight,
      source: "offset",
      width: offsetWidth,
    };
  }

  const bounds = typeof element?.getBoundingClientRect === "function"
    ? element.getBoundingClientRect()
    : null;
  const rectWidth = getPositiveNumber(bounds?.width);
  const rectHeight = getPositiveNumber(bounds?.height);

  return {
    height: rectHeight || Number(bounds?.height),
    source: "rect",
    width: rectWidth || Number(bounds?.width),
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

  const layoutSize = getElementLayoutSize(container);
  const visualBounds = typeof container.getBoundingClientRect === "function"
    ? container.getBoundingClientRect()
    : null;
  const containerWidth = Number(layoutSize.width);
  const containerHeight = Number(layoutSize.height);
  const visualContainerWidth = Number(visualBounds?.width);
  const visualContainerHeight = Number(visualBounds?.height);

  if (!Number.isFinite(containerWidth) || !Number.isFinite(containerHeight)) {
    return {
      ok: false,
      reason: "invalid_container_bounds",
      cols: defaultCols,
      rows: defaultRows,
      containerHeight,
      containerMeasureSource: layoutSize.source,
      containerWidth,
      visualContainerHeight,
      visualContainerWidth,
    };
  }

  if (containerWidth < 1 || containerHeight < 1) {
    return {
      ok: false,
      reason: "zero_container",
      cols: defaultCols,
      rows: defaultRows,
      containerHeight,
      containerMeasureSource: layoutSize.source,
      containerWidth,
      visualContainerHeight,
      visualContainerWidth,
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
      containerMeasureSource: layoutSize.source,
      containerWidth,
      metricSource,
      visualContainerHeight,
      visualContainerWidth,
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
    containerMeasureSource: layoutSize.source,
    containerWidth,
    metricSource,
    rawCols,
    rawRows,
    rows,
    visualContainerHeight,
    visualContainerWidth,
  };
}

export function createTerminalResizeController({
  canResize,
  command = "resize_terminal",
  container,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  defaultCols = DEFAULT_COLS,
  defaultRows = DEFAULT_ROWS,
  instanceId,
  maxCols = DEFAULT_MAX_COLS,
  maxRows = DEFAULT_MAX_ROWS,
  minCols = DEFAULT_MIN_COLS,
  minRows = DEFAULT_MIN_ROWS,
  nativeResizeCommitMs = DEFAULT_NATIVE_RESIZE_COMMIT_MS,
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
  let nativeResizeBurstActive = false;
  let nativeResizeBurstId = 0;
  let nativeResizeBurstStartedAt = 0;
  let nativeResizeBurstStartSize = null;
  let nativeResizeTimer = 0;
  let pendingNativeForce = false;
  let pendingNativeRequest = null;
  let pendingNativeReason = "";
  let queuedForResizeFrame = false;
  let queuedResizeDeadlineMs = 0;
  let queuedResizeOptions = null;
  let queuedResizeReason = "";
  let webglAtlasClearTimer = 0;

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

  const clearWebglAtlasClearTimer = () => {
    if (!webglAtlasClearTimer) {
      return;
    }

    window.clearTimeout(webglAtlasClearTimer);
    webglAtlasClearTimer = 0;
  };

  const clearWebglAtlasNow = () => false;

  const scheduleWebglAtlasClear = () => {
    clearWebglAtlasClearTimer();
  };

  const getNativeResizeDelayMs = (delayMs, force = false) => {
    if (force) {
      return Math.max(0, Number(delayMs || 0));
    }

    return Math.max(
      0,
      Number(delayMs ?? nativeResizeTrailingMs),
      Number(nativeResizeCommitMs || 0),
    );
  };

  const getNativeResizeSizeSignature = (request) => (
    request
      ? `${request.paneId || ""}:${request.instanceId || ""}:${request.cols || 0}x${request.rows || 0}`
      : ""
  );

  const logNativeResizeCoalescing = (action, fields = {}) => {
    logTerminalDiagnosticEvent("frontend.resize_native_coalesced", {
      action,
      ...fields,
    });
  };

  const flushNativeResize = async () => {
    nativeResizeTimer = 0;

    if (disposed || !pendingNativeRequest) {
      nativeResizeBurstActive = false;
      return;
    }

    if (nativeInFlight) {
      nativePendingAfterFlight = true;
      return;
    }

    const request = pendingNativeRequest;
    const reason = pendingNativeReason;
    const force = pendingNativeForce;
    const burstId = nativeResizeBurstId;
    const burstElapsedMs = nativeResizeBurstStartedAt ? nowMs() - nativeResizeBurstStartedAt : 0;
    const burstStartSize = nativeResizeBurstStartSize;
    pendingNativeRequest = null;
    pendingNativeReason = "";
    pendingNativeForce = false;
    nativeResizeBurstActive = false;
    nativeResizeBurstStartedAt = 0;
    nativeResizeBurstStartSize = null;

    if (
      !force
      &&
      lastNativeAppliedSize?.cols === request.cols
      && lastNativeAppliedSize?.rows === request.rows
      && lastNativeAppliedSize?.paneId === request.paneId
      && lastNativeAppliedSize?.instanceId === request.instanceId
    ) {
      logNativeResizeCoalescing("skip_duplicate_commit", {
        burstElapsedMs,
        burstId,
        cols: request.cols,
        paneId: request.paneId || "",
        reason,
        rows: request.rows,
      });
      return;
    }

    nativeInFlight = true;
    const invokeStartedAt = nowMs();
    try {
      await invoke(command, request);
      logTerminalDiagnosticDuration(
        "frontend.resize_native_invoke.slow",
        invokeStartedAt,
        {
          cols: request.cols,
          paneId: request.paneId || "",
          reason,
          rows: request.rows,
        },
        { minElapsedMs: RESIZE_DIAGNOSTIC_SLOW_MS },
      );
      logNativeResizeCoalescing("commit", {
        burstElapsedMs,
        burstId,
        cols: request.cols,
        force,
        paneId: request.paneId || "",
        previousCols: burstStartSize?.cols ?? null,
        previousRows: burstStartSize?.rows ?? null,
        reason,
        rows: request.rows,
      });
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

  const scheduleNativeResize = (request, reason, delayMs, force = false) => {
    if (disposed || !request?.cols || !request?.rows) {
      return;
    }

    const normalizedDelayMs = getNativeResizeDelayMs(delayMs, force);
    const previousPendingSignature = getNativeResizeSizeSignature(pendingNativeRequest);
    const nextPendingSignature = getNativeResizeSizeSignature(request);
    if (force) {
      nativeResizeBurstActive = false;
      nativeResizeBurstStartedAt = 0;
      nativeResizeBurstStartSize = null;
    } else if (!nativeResizeBurstActive) {
      nativeResizeBurstActive = true;
      nativeResizeBurstId += 1;
      nativeResizeBurstStartedAt = nowMs();
      nativeResizeBurstStartSize = lastNativeAppliedSize
        ? {
          cols: lastNativeAppliedSize.cols,
          rows: lastNativeAppliedSize.rows,
        }
        : null;
      logNativeResizeCoalescing("start", {
        burstId: nativeResizeBurstId,
        cols: request.cols,
        delayMs: normalizedDelayMs,
        paneId: request.paneId || "",
        previousCols: nativeResizeBurstStartSize?.cols ?? null,
        previousRows: nativeResizeBurstStartSize?.rows ?? null,
        reason,
        rows: request.rows,
      });
    } else if (previousPendingSignature !== nextPendingSignature) {
      logNativeResizeCoalescing("retarget", {
        burstElapsedMs: nowMs() - nativeResizeBurstStartedAt,
        burstId: nativeResizeBurstId,
        cols: request.cols,
        delayMs: normalizedDelayMs,
        paneId: request.paneId || "",
        previousPending: previousPendingSignature,
        reason,
        rows: request.rows,
      });
    }

    pendingNativeRequest = request;
    pendingNativeReason = reason;
    pendingNativeForce = Boolean(force);
    clearNativeResizeTimer();
    nativeResizeTimer = window.setTimeout(
      flushNativeResize,
      normalizedDelayMs,
    );
  };

  const schedule = (reason = "resize_observer", delayMs = debounceMs, options = {}) => {
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
    queuedResizeOptions = {
      ...(queuedResizeOptions || {}),
      ...(options || {}),
    };

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
    schedule("resize_observer", debounceMs, {
      deferWebglAtlasClear: true,
      frontendFirst: true,
      nativeDelayMs: nativeResizeTrailingMs,
    });
  });

  function flushScheduledResize() {
    if (disposed || !queuedForResizeFrame) {
      queuedForResizeFrame = false;
      queuedResizeOptions = null;
      return;
    }

    if (nowMs() < queuedResizeDeadlineMs) {
      enqueueResizeController(controller);
      return;
    }

    const reason = queuedResizeReason || "resize_observer";
    const options = queuedResizeOptions || {};
    queuedForResizeFrame = false;
    queuedResizeDeadlineMs = 0;
    queuedResizeOptions = null;
    queuedResizeReason = "";
    resizeNow(reason, {
      nativeDelayMs: nativeResizeTrailingMs,
      ...options,
    });
  }

  async function resizeNow(reason = "manual", options = {}) {
    if (disposed) {
      return false;
    }

    if (!getCanResize()) {
      callSafely(onSkip, { reason, skipped: "backend_not_ready" });
      return false;
    }

    const resizeStartedAt = nowMs();
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
    const measureMs = nowMs() - measuredAt;

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

    if (
      !options.force
      && lastAppliedSize?.cols === cols
      && lastAppliedSize?.rows === rows
    ) {
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
    if (options.forceNative) {
      request.force = true;
    }
    const resolvedPaneId = getPaneId();
    const resolvedInstanceId = getInstanceId();

    if (resolvedPaneId) {
      request.paneId = resolvedPaneId;
    }

    if (resolvedInstanceId) {
      request.instanceId = resolvedInstanceId;
    }

    const notifyStart = () => {
      callSafely(onStart, {
        ...measurement,
        reason,
        request,
      });
    };

    if (!options.frontendFirst) {
      notifyStart();
    }

    try {
      const termResizeStartedAt = nowMs();
      term.resize(cols, rows);
      const termResizeMs = nowMs() - termResizeStartedAt;

      if (options.frontendFirst) {
        notifyStart();
      }

      const atlasFields = {
        cols,
        paneId: request.paneId || "",
        reason,
        rows,
      };
      const deferredTextureAtlasClear = options.deferWebglAtlasClear === true;
      const clearedTextureAtlas = deferredTextureAtlasClear
        ? false
        : clearWebglAtlasNow(atlasFields);

      if (deferredTextureAtlasClear) {
        scheduleWebglAtlasClear(atlasFields);
      }

      const elapsedMs = nowMs() - resizeStartedAt;
      logTerminalDiagnosticEvent(
        "frontend.resize.slow",
        {
          clearedTextureAtlas,
          deferredTextureAtlasClear,
          cols,
          elapsedMs,
          measureMs,
          paneId: request.paneId || "",
          reason,
          rows,
          termResizeMs,
        },
        { minElapsedMs: RESIZE_DIAGNOSTIC_SLOW_MS },
      );

      lastAppliedSize = { cols, rows };
      callSafely(onDone, {
        ...measurement,
        clearedTextureAtlas,
        deferredTextureAtlasClear,
        elapsedMs: nowMs() - measuredAt,
        reason,
      });
      scheduleNativeResize(
        request,
        reason,
        options.nativeDelayMs ?? 0,
        options.forceNative || options.force,
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
      queuedResizeOptions = null;
      clearNativeResizeTimer();
      clearWebglAtlasClearTimer();
      nativeResizeBurstActive = false;
      nativeResizeBurstStartedAt = 0;
      nativeResizeBurstStartSize = null;
      observer.disconnect();
    },
    flushScheduledResize,
    getLastNativeAppliedSize: () => (lastNativeAppliedSize ? { ...lastNativeAppliedSize } : null),
    hasPendingNativeResize: () => Boolean(pendingNativeRequest || nativeInFlight),
    resizeNow,
    schedule,
  };

  observer.observe(container);

  return controller;
}
