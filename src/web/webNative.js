import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
const HIDDEN_NATIVE_WEBVIEW_OFFSET = 100000;
const NATIVE_WEBVIEW_EXCLUSION_SELECTOR = "[data-native-webview-exclusion]";
const NATIVE_WEBVIEW_EXCLUSION_MARGIN = 4;
const NATIVE_WEBVIEW_EXCLUSION_LIFT_DATASET_KEY = "nativeWebviewExclusionLift";
const nativeWebviewVisibleRects = new Map();

function hiddenNativeRect() {
  const viewportWidth = typeof window !== "undefined" ? Number(window.innerWidth || 0) : 0;
  const viewportHeight = typeof window !== "undefined" ? Number(window.innerHeight || 0) : 0;
  return {
    height: MIN_NATIVE_DIMENSION,
    width: MIN_NATIVE_DIMENSION,
    x: Math.max(HIDDEN_NATIVE_WEBVIEW_OFFSET, Math.round(viewportWidth + HIDDEN_NATIVE_WEBVIEW_OFFSET)),
    y: Math.max(HIDDEN_NATIVE_WEBVIEW_OFFSET, Math.round(viewportHeight + HIDDEN_NATIVE_WEBVIEW_OFFSET)),
  };
}

function rectsOverlap(leftRect, rightRect) {
  if (!leftRect || !rightRect) {
    return false;
  }
  const horizontalOverlap = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
  const verticalOverlap = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
  return horizontalOverlap > 0 && verticalOverlap > 0;
}

function nativeRectToViewportRect(rect) {
  if (!rect) {
    return null;
  }
  const left = Number(rect.x || 0);
  const top = Number(rect.y || 0);
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  if (!Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
  };
}

export function applyNativeWebviewExclusionLifts() {
  if (typeof document === "undefined") {
    return;
  }

  const visibleRects = Array.from(nativeWebviewVisibleRects.values())
    .map(nativeRectToViewportRect)
    .filter(Boolean);

  document.querySelectorAll(NATIVE_WEBVIEW_EXCLUSION_SELECTOR).forEach((element) => {
    const currentLift = Math.max(
      0,
      Number.parseFloat(element?.dataset?.[NATIVE_WEBVIEW_EXCLUSION_LIFT_DATASET_KEY] || "0") || 0,
    );
    const exclusionRect = element?.getBoundingClientRect?.();
    if (!exclusionRect || exclusionRect.width <= 0 || exclusionRect.height <= 0) {
      delete element.dataset[NATIVE_WEBVIEW_EXCLUSION_LIFT_DATASET_KEY];
      element.style.transform = "";
      return;
    }

    const baseRect = {
      bottom: exclusionRect.bottom + currentLift,
      height: exclusionRect.height,
      left: exclusionRect.left,
      right: exclusionRect.right,
      top: exclusionRect.top + currentLift,
      width: exclusionRect.width,
    };

    let nextLift = 0;
    visibleRects.forEach((nativeRect) => {
      if (!rectsOverlap(baseRect, nativeRect)) {
        return;
      }
      nextLift = Math.max(
        nextLift,
        baseRect.bottom + NATIVE_WEBVIEW_EXCLUSION_MARGIN - nativeRect.top,
      );
    });

    nextLift = Math.max(0, Math.ceil(nextLift));
    nextLift = Math.min(nextLift, Math.max(0, Math.floor(baseRect.top)));

    if (nextLift > 0) {
      element.dataset[NATIVE_WEBVIEW_EXCLUSION_LIFT_DATASET_KEY] = String(nextLift);
      element.style.transform = `translateY(-${nextLift}px)`;
    } else {
      delete element.dataset[NATIVE_WEBVIEW_EXCLUSION_LIFT_DATASET_KEY];
      element.style.transform = "";
    }
  });
}

function setNativeWebviewVisibleRect(label, rect) {
  const safeLabel = String(label || "").trim();
  const visibleRect = nativeRectToViewportRect(rect);
  if (!safeLabel || !visibleRect) {
    return;
  }
  nativeWebviewVisibleRects.set(safeLabel, {
    height: visibleRect.height,
    width: visibleRect.width,
    x: visibleRect.x,
    y: visibleRect.y,
  });
  applyNativeWebviewExclusionLifts();
}

function clearNativeWebviewVisibleRect(label) {
  const safeLabel = String(label || "").trim();
  if (safeLabel && nativeWebviewVisibleRects.delete(safeLabel)) {
    applyNativeWebviewExclusionLifts();
  }
}

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

// Moves a living webview into `parentWindowLabel` without reloading it. Resolves
// false when no webview exists for the label (caller falls back to a fresh open).
export async function invokeWebviewAdopt({ label, rect, parentWindowLabel }) {
  const adopted = await invoke("workspace_webview_adopt", {
    height: rect.height,
    label,
    width: rect.width,
    windowLabel: parentWindowLabel || undefined,
    x: rect.x,
    y: rect.y,
  });
  return adopted === true;
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
  clearNativeWebviewVisibleRect(safeLabel);
  await invoke("workspace_webview_close", { label: safeLabel }).catch(() => {});
}

export async function invokeWebviewEval({ label, script, expectResult = true }) {
  const safeLabel = String(label || "").trim();
  if (!safeLabel) {
    throw new Error("Workspace web view is unavailable.");
  }
  return invoke("workspace_webview_eval", {
    expectResult,
    label: safeLabel,
    script,
  });
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
  // While suspended the hook does not touch the native webview at all — another
  // window owns it (pop-out adoption). The label is kept so it can be re-adopted.
  suspended = false,
  // When set (with a nonce bump), the hook adopts this existing webview into its
  // own window instead of creating a fresh one — preserving the live page.
  adoptLabel = "",
  adoptNonce = 0,
  // The url the adopted webview is believed to be showing; lets later url-prop
  // syncs to that value skip a needless reload right after adoption.
  adoptCurrentUrl = "",
  onLabelChange,
}) {
  const [status, setStatus] = useState("idle");
  const [reloadKey, setReloadKey] = useState(0);

  const labelRef = useRef("");
  const generationRef = useRef(0);
  const openKeyRef = useRef("");
  const openBaseKeyRef = useRef("");
  const rectKeyRef = useRef("");
  const visibleRef = useRef(visible);
  const onNavigateRef = useRef(onNavigate);
  const onErrorRef = useRef(onError);
  const mountedRef = useRef(false);
  const fitBurstCleanupRef = useRef(null);
  const suspendedRef = useRef(Boolean(suspended));
  const onLabelChangeRef = useRef(onLabelChange);
  // Adoption is one-shot per nonce: once consumed, later url/reload changes go
  // through the normal open-and-navigate path instead of re-adopting.
  const consumedAdoptNonceRef = useRef(0);
  // adoptLabel is read through a ref (NOT part of the open key or effect deps):
  // callers store the current label in state/session, so keying the open effect
  // on it creates an open → label change → re-open feedback loop.
  const adoptLabelRef = useRef("");
  const adoptCurrentUrlRef = useRef("");
  // The url the current webview itself last reported loading. When the url prop
  // catches up to a navigation the page already made, no re-open is needed.
  const lastLoadedUrlRef = useRef("");

  visibleRef.current = visible;
  onNavigateRef.current = onNavigate;
  onErrorRef.current = onError;
  suspendedRef.current = Boolean(suspended);
  onLabelChangeRef.current = onLabelChange;
  adoptLabelRef.current = String(adoptLabel || "").trim();
  adoptCurrentUrlRef.current = String(adoptCurrentUrl || "").trim();

  const runtimeEnabled = Boolean(enabled) && hasTauriRuntime();
  const safeViewportInsetBottom = Math.max(0, Math.round(Number(viewportInsetBottom) || 0));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const assignLabel = useCallback((nextLabel) => {
    const safeLabel = String(nextLabel || "").trim();
    if (labelRef.current === safeLabel) {
      return;
    }
    labelRef.current = safeLabel;
    onLabelChangeRef.current?.(safeLabel);
  }, []);

  const fit = useCallback((label, nextVisible, options = {}) => {
    const safeLabel = String(label || "").trim();
    if (!safeLabel || !hasTauriRuntime() || suspendedRef.current) {
      return;
    }
    // Late fit-burst frames can fire for a label this hook no longer owns;
    // acting on them re-registers stale visible rects (and re-shows webviews
    // that were already closed or handed to another window).
    if (safeLabel !== labelRef.current) {
      return;
    }
    const shouldShow = Boolean(nextVisible);
    const viewport = viewportRef.current;
    const rect = shouldShow
      ? viewportNativeRect(viewport, { insetBottom: safeViewportInsetBottom })
      : hiddenNativeRect();
    if (!rect) {
      return;
    }
    if (rect.width < MIN_NATIVE_DIMENSION || rect.height < MIN_NATIVE_DIMENSION) {
      rectKeyRef.current = "";
      clearNativeWebviewVisibleRect(safeLabel);
      void invokeWebviewFit({ label: safeLabel, rect: hiddenNativeRect(), visible: false }).catch(() => {});
      return;
    }
    if (shouldShow) {
      setNativeWebviewVisibleRect(safeLabel, rect);
    } else {
      clearNativeWebviewVisibleRect(safeLabel);
    }
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
    assignLabel("");
    rectKeyRef.current = "";
    openKeyRef.current = "";
    openBaseKeyRef.current = "";
    lastLoadedUrlRef.current = "";
    generationRef.current += 1;
    if (label) {
      clearNativeWebviewVisibleRect(label);
      void invokeWebviewClose(label);
    }
  }, [assignLabel]);

  useLayoutEffect(() => {
    const label = labelRef.current;
    if (!runtimeEnabled || visible || !label) {
      return undefined;
    }
    fit(label, false, { force: true });
    scheduleFitBurst(label, false, { delays: [0, 32, 80], frames: 3 });
    return undefined;
  }, [fit, runtimeEnabled, scheduleFitBurst, visible]);

  const evaluate = useCallback((script, options = {}) => {
    const label = labelRef.current;
    if (!runtimeEnabled || !label) {
      return Promise.reject(new Error("Workspace web view is unavailable."));
    }
    return invokeWebviewEval({
      expectResult: options.expectResult !== false,
      label,
      script,
    });
  }, [runtimeEnabled]);

  // Open (or re-open) the webview when the url / reload counter / parent changes.
  useEffect(() => {
    if (suspended) {
      // Another window owns the webview right now; leave it entirely alone.
      return undefined;
    }
    if (!runtimeEnabled || !url) {
      closeCurrent();
      return undefined;
    }

    const openBaseKey = webviewOpenKey({
      parentWindowLabel,
      reloadKey: `${reloadKey}|${adoptNonce}`,
      scopeParts,
      url: "",
    });
    const openKey = `${openBaseKey}${url}`;

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

    // Only the url changed, and it changed to the page the webview itself
    // reported loading (in-page navigation echoed back through onNavigate):
    // the webview is already there — re-opening would flash a full reload.
    if (
      labelRef.current
      && openBaseKeyRef.current === openBaseKey
      && lastLoadedUrlRef.current
      && lastLoadedUrlRef.current === url
    ) {
      openKeyRef.current = openKey;
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

      // Adoption first: take over the living webview (same page, same session,
      // no reload) instead of creating a fresh one. Falls through on failure.
      const targetAdoptLabel = adoptLabelRef.current;
      const adoptionPending = Boolean(targetAdoptLabel)
        && adoptNonce > 0
        && consumedAdoptNonceRef.current !== adoptNonce;
      if (adoptionPending) {
        consumedAdoptNonceRef.current = adoptNonce;
        try {
          const adopted = await invokeWebviewAdopt({
            label: targetAdoptLabel,
            parentWindowLabel,
            rect,
          });
          if (disposed || generationRef.current !== generation) {
            return;
          }
          if (adopted) {
            assignLabel(targetAdoptLabel);
            openKeyRef.current = openKey;
            openBaseKeyRef.current = openBaseKey;
            lastLoadedUrlRef.current = adoptCurrentUrlRef.current || url;
            rectKeyRef.current = "";
            if (previousLabel && previousLabel !== targetAdoptLabel) {
              clearNativeWebviewVisibleRect(previousLabel);
              void invokeWebviewClose(previousLabel);
            }
            if (mountedRef.current) {
              setStatus("ready");
            }
            fit(targetAdoptLabel, visibleRef.current, { force: true });
            scheduleFitBurst(targetAdoptLabel, visibleRef.current, { delays: [80, 180, 320], frames: 4 });
            return;
          }
        } catch {
          // The webview is gone or could not be moved; open a fresh one below.
        }
        if (disposed || generationRef.current !== generation) {
          return;
        }
      }

      const label = webviewLabel(scopeParts, generation);
      assignLabel(label);
      openKeyRef.current = openKey;
      openBaseKeyRef.current = openBaseKey;
      lastLoadedUrlRef.current = "";
      rectKeyRef.current = "";

      if (previousLabel) {
        clearNativeWebviewVisibleRect(previousLabel);
        await invokeWebviewClose(previousLabel);
      }
      if (disposed || generationRef.current !== generation) {
        if (generationRef.current === generation && labelRef.current === label) {
          assignLabel("");
          openKeyRef.current = "";
          openBaseKeyRef.current = "";
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
          assignLabel("");
          openKeyRef.current = "";
          openBaseKeyRef.current = "";
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
    // adoptLabel is intentionally NOT a dep (read via adoptLabelRef): it tracks
    // whichever label this hook last reported, so keying on it would loop.
  }, [runtimeEnabled, url, reloadKey, parentWindowLabel, viewportRef, scopeParts, fit, scheduleFitBurst, closeCurrent, visible, safeViewportInsetBottom, suspended, adoptNonce, assignLabel]);

  // Re-fit (and show/hide) whenever visibility flips.
  useEffect(() => {
    fit(labelRef.current, visible, { force: true });
    scheduleFitBurst(labelRef.current, visible, { delays: [80, 180], frames: visible ? 3 : 2 });
  }, [fit, scheduleFitBurst, visible]);

  // Entering suspension: park the webview offscreen ONCE, then go silent so the
  // adopting window can take ownership without the grid fighting its fits.
  const prevSuspendedRef = useRef(false);
  useEffect(() => {
    const wasSuspended = prevSuspendedRef.current;
    prevSuspendedRef.current = Boolean(suspended);
    if (!suspended || wasSuspended) {
      return;
    }
    const label = labelRef.current;
    if (!label || !hasTauriRuntime()) {
      return;
    }
    stopFitBurst();
    rectKeyRef.current = "";
    clearNativeWebviewVisibleRect(label);
    void invokeWebviewFit({ label, rect: hiddenNativeRect(), visible: false }).catch(() => {});
  }, [stopFitBurst, suspended]);

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
    const exclusionObserver = new ResizeObserver(applyNativeWebviewExclusionLifts);
    const viewport = viewportRef.current;
    if (viewport) {
      observer.observe(viewport);
      const surface = viewport.closest("[data-workspace-web-surface]");
      if (surface && surface !== viewport) {
        observer.observe(surface);
      }
    }
    if (typeof document !== "undefined") {
      document.querySelectorAll(NATIVE_WEBVIEW_EXCLUSION_SELECTOR).forEach((element) => {
        exclusionObserver.observe(element);
      });
    }
    window.addEventListener("resize", scheduleFit);
    window.addEventListener("scroll", scheduleFit, true);
    frameHandle = window.requestAnimationFrame(burstFit);
    return () => {
      observer.disconnect();
      exclusionObserver.disconnect();
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
          lastLoadedUrlRef.current = loadedUrl;
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

  // Close on unmount — unless suspended: then a pop-out window owns the webview
  // and closing it here would blank that window.
  useEffect(() => () => {
    stopFitBurst();
    if (!suspendedRef.current) {
      closeCurrent();
    }
  }, [closeCurrent, stopFitBurst]);

  const reload = useCallback(() => {
    setStatus("loading");
    setReloadKey((key) => key + 1);
  }, []);

  const getNativeLabel = useCallback(() => labelRef.current, []);

  return { status, reload, evaluate, getNativeLabel };
}
