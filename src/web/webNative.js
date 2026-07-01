import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

// Shared building blocks for the native Tauri child-webview overlay used by the
// left-nav Web view, the in-grid Web pane, and the Web pane breakout window.
//
// A native child webview always composites ON TOP of the DOM and cannot be
// reparented, so each surface positions exactly one child webview over a DOM
// "viewport" element and keeps it fitted as the layout changes. Iframes cannot
// be used because most sites (Google) refuse to be framed.

export const DEFAULT_WEB_URL = "https://www.google.com";
export const WEB_SEARCH_URL = "https://www.google.com/search?q=";
export const WORKSPACE_WEBVIEW_LOAD_EVENT = "workspace-webview-load";

const LOCAL_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const MIN_NATIVE_DIMENSION = 24;

export function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export function nativeErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const message = String(error || "").trim();
  return message || fallback;
}

// Turn an address-bar value into a navigable https URL, or a Google search.
export function normalizeWebInput(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
  if (hasScheme) {
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href;
      }
      return "";
    } catch {
      return "";
    }
  }

  if (LOCAL_HOST_PATTERN.test(raw)) {
    try {
      return new URL(`http://${raw}`).href;
    } catch {
      return "";
    }
  }

  const looksLikeHost = /^[^\s/]+\.[^\s]+/.test(raw);
  if (looksLikeHost) {
    try {
      return new URL(`https://${raw}`).href;
    } catch {
      return "";
    }
  }

  return `${WEB_SEARCH_URL}${encodeURIComponent(raw)}`;
}

export function hostForUrl(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

// Build a label that satisfies the Rust validator: starts with "workspace-web-",
// only [A-Za-z0-9_-], <= 96 chars. `scopeParts` makes it unique per surface.
export function webviewLabel(scopeParts = [], sequence = 0) {
  const raw = (Array.isArray(scopeParts) ? scopeParts : [scopeParts])
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join("-")
    .toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "pane";
  return `workspace-web-${slug}-${sequence}`;
}

// Compute the window-relative logical rect for a viewport element, clamped to
// the nearest [data-workspace-web-surface] ancestor and the window bounds. These
// coordinates match what add_child/set_position expect (relative to the parent
// window's content area).
export function viewportNativeRect(viewport, options = {}) {
  if (!viewport) {
    return null;
  }
  const insetBottom = Math.max(
    0,
    Math.round(Number(options?.insetBottom ?? options?.bottomInset ?? 0) || 0),
  );
  const rect = viewport.getBoundingClientRect();
  const surfaceRect = viewport.closest("[data-workspace-web-surface]")?.getBoundingClientRect?.() || null;
  const bounds = {
    bottom: Math.max(0, window.innerHeight || 0),
    left: 0,
    right: Math.max(0, window.innerWidth || 0),
    top: 0,
  };
  if (surfaceRect) {
    bounds.bottom = Math.min(bounds.bottom, surfaceRect.bottom);
    bounds.left = Math.max(bounds.left, surfaceRect.left);
    bounds.right = Math.min(bounds.right, surfaceRect.right);
    bounds.top = Math.max(bounds.top, surfaceRect.top);
  }
  const left = Math.max(bounds.left, rect.left);
  const top = Math.max(bounds.top, rect.top);
  const right = Math.min(bounds.right, rect.right);
  const rawBottom = Math.min(bounds.bottom, rect.bottom);
  const heightBeforeInset = Math.max(0, rawBottom - top);
  const effectiveInsetBottom = Math.min(
    insetBottom,
    Math.max(0, heightBeforeInset - MIN_NATIVE_DIMENSION),
  );
  const bottom = rawBottom - effectiveInsetBottom;
  return {
    height: Math.max(0, Math.round(bottom - top)),
    width: Math.max(0, Math.round(right - left)),
    x: Math.max(0, Math.round(left)),
    y: Math.max(0, Math.round(top)),
  };
}

function webviewOpenKey({ parentWindowLabel, reloadKey, scopeParts, url }) {
  const scopeKey = (Array.isArray(scopeParts) ? scopeParts : [scopeParts])
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join("\u001f");
  return [
    String(parentWindowLabel || ""),
    scopeKey,
    String(url || ""),
    String(reloadKey || 0),
  ].join("\u001e");
}

// Thin invoke wrappers around the Rust commands.
export async function invokeWebviewOpen({ label, url, rect, parentWindowLabel }) {
  await invoke("workspace_webview_open", {
    height: rect.height,
    label,
    url,
    width: rect.width,
    windowLabel: parentWindowLabel || undefined,
    x: rect.x,
    y: rect.y,
  });
}

export async function invokeWebviewFit({ label, rect, visible }) {
  await invoke("workspace_webview_fit", {
    height: rect.height,
    label,
    visible,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  });
}

export async function invokeWebviewClose(label) {
  const safeLabel = String(label || "").trim();
  if (!safeLabel) {
    return;
  }
  await invoke("workspace_webview_close", { label: safeLabel }).catch(() => {});
}

// useNativeWebview manages one native child webview positioned over `viewportRef`,
// showing `url`, visible when `visible` is true. It re-opens when `url` (or the
// reload counter) changes, keeps fitted on resize via a ResizeObserver + a short
// requestAnimationFrame burst, and reports navigations via `onNavigate`.
export function useNativeWebview({
  viewportRef,
  url,
  visible = true,
  enabled = true,
  layoutKey = "",
  parentWindowLabel,
  scopeParts,
  viewportInsetBottom = 0,
  onNavigate,
  onError,
}) {
  const [status, setStatus] = useState("idle");
  const [reloadKey, setReloadKey] = useState(0);

  const labelRef = useRef("");
  const generationRef = useRef(0);
  const openKeyRef = useRef("");
  const rectKeyRef = useRef("");
  const visibleRef = useRef(visible);
  const onNavigateRef = useRef(onNavigate);
  const onErrorRef = useRef(onError);
  const mountedRef = useRef(false);
  const fitBurstCleanupRef = useRef(null);

  visibleRef.current = visible;
  onNavigateRef.current = onNavigate;
  onErrorRef.current = onError;

  const runtimeEnabled = Boolean(enabled) && hasTauriRuntime();
  const safeViewportInsetBottom = Math.max(0, Math.round(Number(viewportInsetBottom) || 0));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fit = useCallback((label, nextVisible, options = {}) => {
    const viewport = viewportRef.current;
    const safeLabel = String(label || "").trim();
    if (!safeLabel || !viewport || !hasTauriRuntime()) {
      return;
    }
    const rect = viewportNativeRect(viewport, { insetBottom: safeViewportInsetBottom });
    if (!rect) {
      return;
    }
    if (rect.width < MIN_NATIVE_DIMENSION || rect.height < MIN_NATIVE_DIMENSION) {
      rectKeyRef.current = "";
      void invokeWebviewFit({ label: safeLabel, rect, visible: false }).catch(() => {});
      return;
    }
    const shouldShow = Boolean(nextVisible);
    const rectKey = `${rect.x}:${rect.y}:${rect.width}:${rect.height}:${shouldShow ? "show" : "hide"}`;
    if (options.force === true || rectKeyRef.current !== rectKey) {
      rectKeyRef.current = rectKey;
      void invokeWebviewFit({ label: safeLabel, rect, visible: shouldShow }).catch(() => {});
    }
  }, [safeViewportInsetBottom, viewportRef]);

  const stopFitBurst = useCallback(() => {
    fitBurstCleanupRef.current?.();
    fitBurstCleanupRef.current = null;
  }, []);

  const scheduleFitBurst = useCallback((label, nextVisible, options = {}) => {
    stopFitBurst();
    const safeLabel = String(label || "").trim();
    if (!safeLabel) {
      return () => {};
    }

    const frameCount = Number.isFinite(Number(options.frames))
      ? Math.max(1, Number(options.frames))
      : 18;
    const delayMs = Array.isArray(options.delays)
      ? options.delays
      : [0, 32, 80, 160, 320];
    const timeoutIds = new Set();
    let disposed = false;
    let frameHandle = 0;
    let framesRun = 0;

    const run = () => {
      if (disposed) {
        return;
      }
      fit(safeLabel, nextVisible, { force: true });
      framesRun += 1;
      if (framesRun < frameCount) {
        frameHandle = window.requestAnimationFrame(run);
      }
    };

    frameHandle = window.requestAnimationFrame(run);
    delayMs.forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        fit(safeLabel, nextVisible, { force: true });
      }, Math.max(0, Number(delay) || 0));
      timeoutIds.add(timeoutId);
    });

    const cleanup = () => {
      disposed = true;
      if (frameHandle) {
        window.cancelAnimationFrame(frameHandle);
      }
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIds.clear();
    };
    fitBurstCleanupRef.current = cleanup;
    return cleanup;
  }, [fit, stopFitBurst]);

  const closeCurrent = useCallback(() => {
    const label = labelRef.current;
    labelRef.current = "";
    rectKeyRef.current = "";
    openKeyRef.current = "";
    generationRef.current += 1;
    if (label) {
      void invokeWebviewClose(label);
    }
  }, []);

  // Open (or re-open) the webview when the url / reload counter / parent changes.
  useEffect(() => {
    if (!runtimeEnabled || !url) {
      closeCurrent();
      return undefined;
    }

    const openKey = webviewOpenKey({ parentWindowLabel, reloadKey, scopeParts, url });

    if (!visible) {
      fit(labelRef.current, false, { force: true });
      scheduleFitBurst(labelRef.current, false, { delays: [80], frames: 2 });
      return undefined;
    }

    if (labelRef.current && openKeyRef.current === openKey) {
      fit(labelRef.current, true, { force: true });
      scheduleFitBurst(labelRef.current, true, { delays: [80, 180], frames: 3 });
      return undefined;
    }

    let disposed = false;
    let attempts = 0;
    let stableRectKey = "";
    let stableRectFrames = 0;

    const openNow = async () => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      const rect = viewportNativeRect(viewport, { insetBottom: safeViewportInsetBottom });
      if (!rect || rect.width < MIN_NATIVE_DIMENSION || rect.height < MIN_NATIVE_DIMENSION) {
        return;
      }

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const previousLabel = labelRef.current;
      const label = webviewLabel(scopeParts, generation);
      labelRef.current = label;
      openKeyRef.current = openKey;
      rectKeyRef.current = "";

      if (previousLabel) {
        await invokeWebviewClose(previousLabel);
      }
      if (disposed || generationRef.current !== generation) {
        if (generationRef.current === generation && labelRef.current === label) {
          labelRef.current = "";
          openKeyRef.current = "";
        }
        return;
      }

      if (mountedRef.current) {
        setStatus("loading");
      }

      try {
        await invokeWebviewOpen({ label, url, rect, parentWindowLabel });
        if (disposed || generationRef.current !== generation) {
          fit(label, visibleRef.current, { force: true });
          return;
        }
        fit(label, visibleRef.current, { force: true });
        scheduleFitBurst(label, visibleRef.current, { delays: [80, 180, 320], frames: 4 });
      } catch (error) {
        if (!disposed && generationRef.current === generation) {
          labelRef.current = "";
          openKeyRef.current = "";
          if (mountedRef.current) {
            setStatus("error");
          }
          onErrorRef.current?.(error);
        }
      }
    };

    const tryOpen = () => {
      if (disposed) {
        return;
      }
      const viewport = viewportRef.current;
      const rect = viewport ? viewportNativeRect(viewport, { insetBottom: safeViewportInsetBottom }) : null;
      if (rect && rect.width >= MIN_NATIVE_DIMENSION && rect.height >= MIN_NATIVE_DIMENSION) {
        const nextRectKey = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
        if (nextRectKey === stableRectKey) {
          stableRectFrames += 1;
        } else {
          stableRectKey = nextRectKey;
          stableRectFrames = 1;
        }
        if (stableRectFrames >= 2) {
          void openNow();
          return;
        }
      }
      attempts += 1;
      if (attempts < 30) {
        window.requestAnimationFrame(tryOpen);
      }
    };

    window.requestAnimationFrame(tryOpen);

    return () => {
      disposed = true;
    };
  }, [runtimeEnabled, url, reloadKey, parentWindowLabel, viewportRef, scopeParts, fit, scheduleFitBurst, closeCurrent, visible, safeViewportInsetBottom]);

  // Re-fit (and show/hide) whenever visibility flips.
  useEffect(() => {
    fit(labelRef.current, visible, { force: true });
    scheduleFitBurst(labelRef.current, visible, { delays: [80, 180], frames: visible ? 3 : 2 });
  }, [fit, scheduleFitBurst, visible]);

  // Native child webviews do not inherit CSS transforms from their DOM
  // placeholders. Fullscreen/restore and grid reflow move the pane with
  // transforms, so force-fit through those transitions and once they settle.
  useEffect(() => {
    if (!runtimeEnabled) {
      return undefined;
    }
    const label = labelRef.current;
    if (!label) {
      return undefined;
    }
    fit(label, visibleRef.current, { force: true });
    return scheduleFitBurst(label, visibleRef.current, {
      delays: [0, 32, 80, 160, 240, 360],
      frames: 18,
    });
  }, [fit, layoutKey, runtimeEnabled, scheduleFitBurst]);

  // Keep fitted on container/window resize, and re-show after a visibility flip
  // (e.g. when a pane drag ends) via a short rAF burst.
  useEffect(() => {
    if (!runtimeEnabled) {
      return undefined;
    }
    let frameHandle = 0;
    let burstCount = 0;
    const scheduleFit = () => {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = window.requestAnimationFrame(() => fit(labelRef.current, visibleRef.current, { force: true }));
    };
    const burstFit = () => {
      scheduleFit();
      burstCount += 1;
      if (burstCount < 6) {
        frameHandle = window.requestAnimationFrame(burstFit);
      }
    };
    const observer = new ResizeObserver(scheduleFit);
    const viewport = viewportRef.current;
    if (viewport) {
      observer.observe(viewport);
      const surface = viewport.closest("[data-workspace-web-surface]");
      if (surface && surface !== viewport) {
        observer.observe(surface);
      }
    }
    window.addEventListener("resize", scheduleFit);
    window.addEventListener("scroll", scheduleFit, true);
    frameHandle = window.requestAnimationFrame(burstFit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleFit);
      window.removeEventListener("scroll", scheduleFit, true);
      window.cancelAnimationFrame(frameHandle);
    };
  }, [fit, runtimeEnabled, viewportRef, visible]);

  useEffect(() => {
    if (!runtimeEnabled) {
      return undefined;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }
    const targets = [
      viewport,
      viewport.closest("[data-workspace-web-surface]"),
      viewport.closest("[data-terminal-surface-slot]"),
    ].filter((target, index, list) => target && list.indexOf(target) === index);
    if (!targets.length) {
      return undefined;
    }
    const scheduleTransitionFit = () => {
      const label = labelRef.current;
      if (!label) {
        return;
      }
      fit(label, visibleRef.current, { force: true });
      scheduleFitBurst(label, visibleRef.current, {
        delays: [0, 48, 120, 220, 360],
        frames: 12,
      });
    };
    const events = [
      "animationend",
      "animationstart",
      "transitioncancel",
      "transitionend",
      "transitionrun",
      "transitionstart",
    ];
    targets.forEach((target) => {
      events.forEach((eventName) => {
        target.addEventListener(eventName, scheduleTransitionFit);
      });
    });
    return () => {
      targets.forEach((target) => {
        events.forEach((eventName) => {
          target.removeEventListener(eventName, scheduleTransitionFit);
        });
      });
    };
  }, [fit, runtimeEnabled, scheduleFitBurst, viewportRef]);

  // Track page-load events for the current webview to drive status + navigations.
  useEffect(() => {
    if (!hasTauriRuntime()) {
      return undefined;
    }
    let disposed = false;
    let unlisten = null;
    listen(WORKSPACE_WEBVIEW_LOAD_EVENT, (event) => {
      const payload = event?.payload || {};
      const label = String(payload.label || "").trim();
      if (!label || label !== labelRef.current) {
        return;
      }
      const loadEvent = String(payload.event || "").trim().toLowerCase();
      if (loadEvent === "started") {
        setStatus("loading");
        fit(labelRef.current, visibleRef.current, { force: true });
        scheduleFitBurst(labelRef.current, visibleRef.current, { delays: [100], frames: 2 });
        return;
      }
      if (loadEvent === "finished") {
        setStatus("ready");
        fit(labelRef.current, visibleRef.current, { force: true });
        scheduleFitBurst(labelRef.current, visibleRef.current, { delays: [80, 180], frames: 3 });
        const loadedUrl = String(payload.url || "").trim();
        if (loadedUrl) {
          onNavigateRef.current?.(loadedUrl);
        }
      }
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, [fit, scheduleFitBurst]);

  // Close on unmount.
  useEffect(() => () => {
    stopFitBurst();
    closeCurrent();
  }, [closeCurrent, stopFitBurst]);

  const reload = useCallback(() => {
    setStatus("loading");
    setReloadKey((key) => key + 1);
  }, []);

  return { status, reload };
}
