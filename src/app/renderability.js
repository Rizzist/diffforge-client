import { getCurrentWindow } from "@tauri-apps/api/window";

const listeners = new Set();
let initialized = false;
let tauriListenersInitialized = false;
let tauriProbeId = 0;
let snapshot = {
  documentVisible: true,
  renderable: true,
  windowMinimized: false,
  windowVisible: true,
};

function readDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function emitRenderabilityChange() {
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Renderability subscribers must not break the shared signal.
    }
  });
}

function applySnapshot(patch) {
  const next = {
    ...snapshot,
    ...patch,
  };
  next.renderable = Boolean(next.documentVisible && next.windowVisible && !next.windowMinimized);

  if (
    next.documentVisible === snapshot.documentVisible
    && next.renderable === snapshot.renderable
    && next.windowMinimized === snapshot.windowMinimized
    && next.windowVisible === snapshot.windowVisible
  ) {
    return;
  }

  snapshot = next;
  emitRenderabilityChange();
}

async function refreshTauriWindowState() {
  const probeId = tauriProbeId + 1;
  tauriProbeId = probeId;

  try {
    const appWindow = getCurrentWindow?.();
    if (!appWindow) {
      return;
    }

    const [windowMinimized, windowVisible] = await Promise.all([
      typeof appWindow.isMinimized === "function" ? appWindow.isMinimized() : false,
      typeof appWindow.isVisible === "function" ? appWindow.isVisible() : true,
    ]);

    if (probeId !== tauriProbeId) {
      return;
    }

    applySnapshot({
      windowMinimized: Boolean(windowMinimized),
      windowVisible: windowVisible !== false,
    });
  } catch {
    // Non-Tauri web contexts fall back to document.visibilityState.
  }
}

function refreshDocumentVisibility() {
  applySnapshot({ documentVisible: readDocumentVisible() });
  void refreshTauriWindowState();
}

function initializeTauriListeners() {
  if (tauriListenersInitialized) {
    return;
  }
  tauriListenersInitialized = true;

  try {
    const appWindow = getCurrentWindow?.();
    const refresh = () => {
      void refreshTauriWindowState();
    };

    if (typeof appWindow?.listen === "function") {
      [
        "tauri://blur",
        "tauri://focus",
        "tauri://resize",
        "tauri://suspended",
        "tauri://resumed",
      ].forEach((eventName) => {
        appWindow.listen(eventName, refresh).catch(() => {});
      });
    }

    if (typeof appWindow?.onResized === "function") {
      appWindow.onResized(refresh).catch(() => {});
    }
  } catch {
    // Cheaply available Tauri listeners are optional.
  }
}

function initializeRenderability() {
  if (initialized) {
    return;
  }
  initialized = true;

  applySnapshot({ documentVisible: readDocumentVisible() });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", refreshDocumentVisibility);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", refreshDocumentVisibility);
    window.addEventListener("pagehide", refreshDocumentVisibility);
    window.addEventListener("resize", refreshDocumentVisibility);
  }

  initializeTauriListeners();
  void refreshTauriWindowState();
}

export function getRenderabilitySnapshot() {
  initializeRenderability();
  return snapshot;
}

export function subscribeToRenderability(listener) {
  initializeRenderability();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
