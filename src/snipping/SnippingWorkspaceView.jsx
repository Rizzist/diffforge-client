import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";
import { CropFree } from "@styled-icons/material-rounded/CropFree";
import { ScreenshotMonitor } from "@styled-icons/material-rounded/ScreenshotMonitor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle } from "styled-components";

import {
  AudioDeviceHeader,
  AudioDevicePanel,
  AudioHeroRow,
  AudioInputMeta,
  AudioRecorderOptionRow,
  AudioShortcutActions,
  AudioShortcutCard,
  AudioShortcutGrid,
  AudioShortcutKey,
  AudioStatePill,
  AudioWorkspaceSurface,
  ButtonFolderIcon,
  ButtonKeyIcon,
  ButtonRefreshIcon,
  ButtonSnippingIcon,
  FormMessage,
  PrimaryButton,
  SecondaryButton,
  SettingsHint,
  SettingsLabel,
  VaultPlaceholderIcon,
} from "../app/appStyles";

export const SNIPPING_OVERLAY_HASH = "#/snipping-overlay";

const SNIPPING_SHORTCUTS_CHANGED_EVENT = "forge-snipping-shortcuts-changed";
const SNIPPING_CAPTURE_SAVED_EVENT = "forge-snipping-capture-saved";
const SNIPPING_ACTION_FULL = "full-screenshot";
const SNIPPING_ACTION_AREA = "area-snip";
const SNIPPING_MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error?.message) {
    return String(error.message);
  }
  return fallback;
}

function isMacPlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac|iphone|ipad|ipod/iu.test(navigator.platform || "");
}

function defaultFullShortcut() {
  return isMacPlatform() ? "Command+Shift+Digit3" : "Control+Shift+Digit3";
}

function defaultAreaShortcut() {
  return isMacPlatform() ? "Command+Shift+Digit4" : "Control+Shift+Digit4";
}

function fallbackPermissions() {
  return {
    platform: isMacPlatform() ? "macos" : "other",
    shortcutAccessibilityRequired: isMacPlatform(),
    shortcutAccessibilityGranted: !isMacPlatform(),
    screenCaptureRequired: isMacPlatform(),
    screenCaptureGranted: !isMacPlatform(),
    screenCaptureSettingsUrl: isMacPlatform()
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      : "",
    message: "",
  };
}

function fallbackSnippingStatus() {
  const full = defaultFullShortcut();
  const area = defaultAreaShortcut();

  return {
    fullScreenshot: {
      shortcut: full,
      defaultShortcut: full,
      registered: false,
      error: "",
    },
    areaSnip: {
      shortcut: area,
      defaultShortcut: area,
      registered: false,
      error: "",
    },
    permissions: fallbackPermissions(),
    untrackedRoot: "",
  };
}

function normalizeShortcutTokenForCompare(token) {
  const compact = String(token || "").trim().replace(/[\s_-]+/gu, "").toLowerCase();

  if (compact === "cmd" || compact === "command" || compact === "meta") {
    return "super";
  }
  if (compact === "ctrl") {
    return "control";
  }
  if (/^[0-9]$/u.test(compact)) {
    return `digit${compact}`;
  }
  return compact;
}

function normalizeKeyboardShortcutCode(value) {
  const compact = String(value || "").trim().replace(/[\s_-]+/gu, "").toLowerCase();

  if (compact === "printscreen" || compact === "print") {
    return "PrintScreen";
  }
  return value;
}

function shortcutFromKeyboardEvent(event) {
  const code = normalizeKeyboardShortcutCode(event.code || event.key || "");

  if (!code) {
    return "";
  }

  if (SNIPPING_MODIFIER_CODES.has(code)) {
    return code;
  }

  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");

  return [...modifiers, code].join("+");
}

function formatShortcutToken(token) {
  const compact = String(token || "").trim().replace(/[\s_-]+/gu, "");
  const lower = compact.toLowerCase();

  if (lower === "control" || lower === "ctrl") return "Ctrl";
  if (lower === "alt" || lower === "option") return isMacPlatform() ? "Option" : "Alt";
  if (lower === "shift") return "Shift";
  if (lower === "super" || lower === "command" || lower === "cmd" || lower === "meta") {
    return isMacPlatform() ? "Command" : "Win";
  }
  if (lower === "printscreen") return "Print Screen";
  if (lower === "escape" || lower === "esc") return "Esc";
  if (/^key[a-z]$/iu.test(compact)) return compact.slice(3).toUpperCase();
  if (/^digit[0-9]$/iu.test(compact)) return compact.slice(5);
  return compact || "Unset";
}

function formatShortcutLabel(value) {
  return String(value || "")
    .split("+")
    .map(formatShortcutToken)
    .filter(Boolean)
    .join(" + ") || "Unset";
}

function shortcutConflict(left, right) {
  const normalize = (value) => String(value || "")
    .split("+")
    .map(normalizeShortcutTokenForCompare)
    .filter(Boolean)
    .join("+");
  return Boolean(left && right && normalize(left) === normalize(right));
}

function assetItems(library) {
  if (Array.isArray(library?.items)) return library.items;
  if (Array.isArray(library?.assets)) return library.assets;
  return [];
}

function assetLocalPath(asset) {
  return text(asset?.localPath || asset?.local_path || asset?.path);
}

function assetName(asset) {
  return text(asset?.name || asset?.filename || assetLocalPath(asset).split(/[\\/]/u).pop(), "snip.png");
}

function assetPreviewUrl(asset) {
  const localPath = assetLocalPath(asset);
  if (!localPath) return "";
  try {
    return convertFileSrc(localPath);
  } catch {
    return "";
  }
}

function assetModifiedMs(asset) {
  const value = Number(asset?.modifiedMs || asset?.modified_ms || asset?.createdMs || asset?.created_ms || 0);
  return Number.isFinite(value) ? value : 0;
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = amount >= 100 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatRecentTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SnippingWorkspaceView({
  untrackedLibrary = null,
  untrackedLoading = false,
  onUntrackedRefresh = null,
}) {
  const [status, setStatus] = useState(fallbackSnippingStatus);
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState("idle");
  const [capturingShortcut, setCapturingShortcut] = useState("");
  const [lastCapture, setLastCapture] = useState(null);

  const permissions = status?.permissions || fallbackPermissions();
  const fullShortcut = status?.fullScreenshot?.shortcut || defaultFullShortcut();
  const areaShortcut = status?.areaSnip?.shortcut || defaultAreaShortcut();
  const fullError = status?.fullScreenshot?.error || "";
  const areaError = status?.areaSnip?.error || "";
  const shortcutConflictError = shortcutConflict(fullShortcut, areaShortcut)
    ? "Full screenshot and area snip need different shortcuts."
    : "";
  const permissionMissing = Boolean(
    permissions.screenCaptureRequired && !permissions.screenCaptureGranted,
  );
  const shortcutReady = !permissionMissing
    && !fullError
    && !areaError
    && !shortcutConflictError
    && Boolean(status?.fullScreenshot?.registered)
    && Boolean(status?.areaSnip?.registered);
  const savingShortcut = actionState === "saving";
  const capturingFull = actionState === "capturing-full";
  const capturingArea = actionState === "capturing-area";
  const openingPermissions = actionState === "opening-permissions";

  const snips = useMemo(() => (
    assetItems(untrackedLibrary)
      .filter((asset) => text(asset?.group).toLowerCase() === "snips")
      .sort((left, right) => assetModifiedMs(right) - assetModifiedMs(left))
      .slice(0, 6)
  ), [untrackedLibrary]);

  const loadStatus = useCallback(async () => {
    try {
      const nextStatus = await invoke("snipping_status");
      setStatus(nextStatus || fallbackSnippingStatus());
      setError("");
    } catch (statusError) {
      setError(getErrorMessage(statusError, "Unable to load snipping settings."));
    }
  }, []);

  const applyShortcut = useCallback(async (action, shortcut) => {
    if (!shortcut) return;
    setActionState("saving");
    setError("");
    try {
      const nextStatus = await invoke("set_snipping_shortcut", {
        request: { action, shortcut },
      });
      setStatus(nextStatus || fallbackSnippingStatus());
      setCapturingShortcut("");
    } catch (shortcutError) {
      setError(getErrorMessage(shortcutError, "Unable to save that snipping shortcut."));
    } finally {
      setActionState("idle");
    }
  }, []);

  const resetShortcuts = useCallback(async () => {
    setActionState("saving");
    setError("");
    try {
      const nextStatus = await invoke("reset_snipping_shortcuts");
      setStatus(nextStatus || fallbackSnippingStatus());
      setCapturingShortcut("");
    } catch (shortcutError) {
      setError(getErrorMessage(shortcutError, "Unable to reset snipping shortcuts."));
    } finally {
      setActionState("idle");
    }
  }, []);

  const openPermissions = useCallback(async () => {
    setActionState("opening-permissions");
    setError("");
    try {
      const nextStatus = await invoke("open_snipping_permissions");
      setStatus(nextStatus || fallbackSnippingStatus());
    } catch (permissionError) {
      setError(getErrorMessage(permissionError, "Unable to open snipping permissions."));
    } finally {
      setActionState("idle");
    }
  }, []);

  const captureFull = useCallback(async () => {
    setActionState("capturing-full");
    setError("");
    try {
      const result = await invoke("snipping_capture_screenshot", {
        request: { mode: "full" },
      });
      setLastCapture(result || null);
      onUntrackedRefresh?.({ silent: true });
    } catch (captureError) {
      setError(getErrorMessage(captureError, "Unable to capture screenshot."));
    } finally {
      setActionState("idle");
    }
  }, [onUntrackedRefresh]);

  const captureArea = useCallback(async () => {
    setActionState("capturing-area");
    setError("");
    try {
      await invoke("snipping_begin_area_snip");
    } catch (captureError) {
      setError(getErrorMessage(captureError, "Unable to start area snip."));
    } finally {
      setActionState("idle");
    }
  }, []);

  const openSnip = useCallback(async (asset) => {
    const localPath = assetLocalPath(asset);
    if (!localPath) return;
    try {
      await openPath(localPath);
    } catch (openError) {
      setError(getErrorMessage(openError, "Unable to open snip."));
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    let unlistenShortcuts = null;
    let unlistenCaptures = null;

    listen(SNIPPING_SHORTCUTS_CHANGED_EVENT, (event) => {
      if (!cancelled) {
        setStatus(event.payload || fallbackSnippingStatus());
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenShortcuts = unlisten;
      }
    }).catch(() => {});

    listen(SNIPPING_CAPTURE_SAVED_EVENT, (event) => {
      if (!cancelled) {
        setLastCapture(event.payload || null);
        onUntrackedRefresh?.({ silent: true });
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenCaptures = unlisten;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      unlistenShortcuts?.();
      unlistenCaptures?.();
    };
  }, [onUntrackedRefresh]);

  useEffect(() => {
    if (!capturingShortcut) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCapturingShortcut("");
        return;
      }

      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) return;

      event.preventDefault();
      applyShortcut(capturingShortcut, shortcut);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [applyShortcut, capturingShortcut]);

  return (
    <AudioWorkspaceSurface>
      <SnippingPanel>
        <AudioHeroRow>
          <VaultPlaceholderIcon aria-hidden="true">
            <ButtonSnippingIcon />
          </VaultPlaceholderIcon>
          <div>
            <h2>Snipping</h2>
            <p>Screenshot and area snip straight into local-only untracked assets.</p>
          </div>
          <AudioStatePill data-installed={shortcutReady}>
            {shortcutReady ? "Ready" : permissionMissing ? "Needs access" : "Check shortcuts"}
          </AudioStatePill>
        </AudioHeroRow>

        <SnippingActionGrid>
          <AudioDevicePanel>
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Capture</SettingsLabel>
                <SettingsHint>Manual snips save into the untracked snips folder.</SettingsHint>
              </div>
              <AudioStatePill data-installed={!capturingFull && !capturingArea}>
                {capturingFull || capturingArea ? "Capturing" : "Local only"}
              </AudioStatePill>
            </AudioDeviceHeader>
            <SnippingButtonGrid>
              <PrimaryButton disabled={capturingFull || capturingArea} onClick={captureFull} type="button">
                <ScreenshotMonitor aria-hidden="true" />
                <span>{capturingFull ? "Capturing..." : "Take screenshot"}</span>
              </PrimaryButton>
              <SecondaryButton disabled={capturingFull || capturingArea} onClick={captureArea} type="button">
                <CropFree aria-hidden="true" />
                <span>{capturingArea ? "Opening..." : "Select area"}</span>
              </SecondaryButton>
            </SnippingButtonGrid>
            <SettingsHint>
              Saves to {status?.untrackedRoot ? `${status.untrackedRoot}/snips` : "the untracked snips folder"}.
            </SettingsHint>
            {lastCapture?.localPath && (
              <AudioInputMeta>Last snip: {lastCapture.localPath}</AudioInputMeta>
            )}
          </AudioDevicePanel>

          <AudioDevicePanel>
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Permissions</SettingsLabel>
                <SettingsHint>{permissions.message || "Shortcut and screen-capture status for this device."}</SettingsHint>
              </div>
              <AudioStatePill data-installed={!permissionMissing}>
                {permissionMissing ? "Needs access" : "Ready"}
              </AudioStatePill>
            </AudioDeviceHeader>
            <SnippingPermissionGrid>
              <SnippingInfoTile>
                <span>Screen capture</span>
                <strong>{permissions.screenCaptureGranted ? "Granted" : "Required"}</strong>
              </SnippingInfoTile>
              <SnippingInfoTile>
                <span>Shortcuts</span>
                <strong>{status?.fullScreenshot?.registered && status?.areaSnip?.registered ? "Registered" : "Unavailable"}</strong>
              </SnippingInfoTile>
            </SnippingPermissionGrid>
            {permissionMissing && (
              <AudioRecorderOptionRow>
                <SettingsHint>macOS System Settings / Privacy & Security / Screen Recording</SettingsHint>
                <SecondaryButton disabled={openingPermissions} onClick={openPermissions} type="button">
                  <ButtonKeyIcon aria-hidden="true" />
                  <span>{openingPermissions ? "Opening..." : "Open Settings"}</span>
                </SecondaryButton>
              </AudioRecorderOptionRow>
            )}
          </AudioDevicePanel>
        </SnippingActionGrid>

        <AudioDevicePanel aria-label="Snipping shortcut settings">
          <AudioDeviceHeader>
            <div>
              <SettingsLabel>Bindings</SettingsLabel>
              <SettingsHint>Global hotkeys are registered at app startup and stay live outside this tab.</SettingsHint>
            </div>
            <AudioStatePill data-installed={!fullError && !areaError && !shortcutConflictError}>
              {savingShortcut ? "Saving" : fullError || areaError || shortcutConflictError ? "Conflict" : "Ready"}
            </AudioStatePill>
          </AudioDeviceHeader>

          <AudioShortcutGrid>
            <AudioShortcutCard data-error={Boolean(fullError || shortcutConflictError)}>
              <span>Full screenshot</span>
              <AudioShortcutKey data-capturing={capturingShortcut === SNIPPING_ACTION_FULL}>
                {capturingShortcut === SNIPPING_ACTION_FULL ? "Press key" : formatShortcutLabel(fullShortcut)}
              </AudioShortcutKey>
              <AudioShortcutActions>
                <SecondaryButton disabled={savingShortcut} onClick={() => setCapturingShortcut(SNIPPING_ACTION_FULL)} type="button">
                  <ButtonKeyIcon aria-hidden="true" />
                  <span>{capturingShortcut === SNIPPING_ACTION_FULL ? "Listening..." : "Change"}</span>
                </SecondaryButton>
              </AudioShortcutActions>
              {(fullError || shortcutConflictError) && <AudioInputMeta>{fullError || shortcutConflictError}</AudioInputMeta>}
            </AudioShortcutCard>

            <AudioShortcutCard data-error={Boolean(areaError || shortcutConflictError)}>
              <span>Area snip</span>
              <AudioShortcutKey data-capturing={capturingShortcut === SNIPPING_ACTION_AREA}>
                {capturingShortcut === SNIPPING_ACTION_AREA ? "Press key" : formatShortcutLabel(areaShortcut)}
              </AudioShortcutKey>
              <AudioShortcutActions>
                <SecondaryButton disabled={savingShortcut} onClick={() => setCapturingShortcut(SNIPPING_ACTION_AREA)} type="button">
                  <ButtonKeyIcon aria-hidden="true" />
                  <span>{capturingShortcut === SNIPPING_ACTION_AREA ? "Listening..." : "Change"}</span>
                </SecondaryButton>
              </AudioShortcutActions>
              {(areaError || shortcutConflictError) && <AudioInputMeta>{areaError || shortcutConflictError}</AudioInputMeta>}
            </AudioShortcutCard>
          </AudioShortcutGrid>

          <AudioRecorderOptionRow>
            <SettingsHint>
              Defaults: {formatShortcutLabel(status?.fullScreenshot?.defaultShortcut || defaultFullShortcut())} / {formatShortcutLabel(status?.areaSnip?.defaultShortcut || defaultAreaShortcut())}
            </SettingsHint>
            <SecondaryButton disabled={savingShortcut} onClick={resetShortcuts} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>Reset defaults</span>
            </SecondaryButton>
          </AudioRecorderOptionRow>
        </AudioDevicePanel>

        <AudioDevicePanel>
          <AudioDeviceHeader>
            <div>
              <SettingsLabel>Recent untracked snips</SettingsLabel>
              <SettingsHint>These are local scratch files. Track them from Assets when they should sync.</SettingsHint>
            </div>
            <SecondaryButton disabled={untrackedLoading} onClick={() => onUntrackedRefresh?.({ silent: false })} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>{untrackedLoading ? "Refreshing..." : "Refresh"}</span>
            </SecondaryButton>
          </AudioDeviceHeader>

          {snips.length ? (
            <SnipPreviewGrid>
              {snips.map((asset) => {
                const localPath = assetLocalPath(asset);
                const previewUrl = assetPreviewUrl(asset);
                return (
                  <SnipPreviewCard key={asset?.id || localPath || assetName(asset)} type="button" onClick={() => openSnip(asset)}>
                    {previewUrl ? (
                      <img alt={assetName(asset)} draggable={false} src={previewUrl} />
                    ) : (
                      <SnipPreviewFallback aria-hidden="true">
                        <ButtonFolderIcon />
                      </SnipPreviewFallback>
                    )}
                    <span>
                      <strong>{assetName(asset)}</strong>
                      <small>{formatFileSize(asset?.sizeBytes || asset?.size_bytes)} / {formatRecentTime(assetModifiedMs(asset))}</small>
                    </span>
                  </SnipPreviewCard>
                );
              })}
            </SnipPreviewGrid>
          ) : (
            <SnippingEmptyState>
              {untrackedLoading ? "Loading snips..." : "No snips yet. Take a screenshot or select an area to create one."}
            </SnippingEmptyState>
          )}
        </AudioDevicePanel>

        {error && <FormMessage $state="error">{error}</FormMessage>}
      </SnippingPanel>
    </AudioWorkspaceSurface>
  );
}

export function SnippingOverlayWindow() {
  const [drag, setDrag] = useState(null);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const dragRef = useRef(null);

  const selection = useMemo(() => {
    if (!drag) return null;
    const left = Math.min(drag.startX, drag.endX);
    const top = Math.min(drag.startY, drag.endY);
    const width = Math.abs(drag.endX - drag.startX);
    const height = Math.abs(drag.endY - drag.startY);
    return { left, top, width, height };
  }, [drag]);

  const closeOverlay = useCallback(async () => {
    try {
      await invoke("snipping_cancel_area_snip");
    } catch {
      try {
        await getCurrentWindow().close();
      } catch {
        // Overlay close is best effort.
      }
    }
  }, []);

  useEffect(() => {
    invoke("snipping_area_overlay_status").catch((statusError) => {
      setError(getErrorMessage(statusError, "Unable to prepare snipping overlay."));
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeOverlay]);

  const beginDrag = useCallback((event) => {
    if (event.button !== 0 || capturing) return;
    event.preventDefault();
    const nextDrag = {
      startX: event.clientX,
      startY: event.clientY,
      endX: event.clientX,
      endY: event.clientY,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }, [capturing]);

  const updateDrag = useCallback((event) => {
    if (!dragRef.current || capturing) return;
    const nextDrag = {
      ...dragRef.current,
      endX: event.clientX,
      endY: event.clientY,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }, [capturing]);

  const finishDrag = useCallback(async () => {
    const currentDrag = dragRef.current;
    dragRef.current = null;
    if (!currentDrag || capturing) return;

    const left = Math.min(currentDrag.startX, currentDrag.endX);
    const top = Math.min(currentDrag.startY, currentDrag.endY);
    const width = Math.abs(currentDrag.endX - currentDrag.startX);
    const height = Math.abs(currentDrag.endY - currentDrag.startY);

    if (width < 4 || height < 4) {
      closeOverlay();
      return;
    }

    setCapturing(true);
    setError("");
    try {
      await invoke("snipping_finish_area_snip", {
        request: {
          x: left,
          y: top,
          width,
          height,
          scaleFactor: window.devicePixelRatio || 1,
        },
      });
      try {
        await getCurrentWindow().close();
      } catch {
        // Rust also closes the overlay after capture.
      }
    } catch (captureError) {
      setCapturing(false);
      setError(getErrorMessage(captureError, "Unable to capture selected area."));
    }
  }, [capturing, closeOverlay]);

  return (
    <>
      <SnippingOverlayGlobalStyle />
      <SnippingOverlayRoot
        onMouseDown={beginDrag}
        onMouseMove={updateDrag}
        onMouseUp={finishDrag}
      >
        <SnippingOverlayShade aria-hidden="true" />
        {selection && (
          <SnippingSelectionBox
            aria-hidden="true"
            style={{
              left: `${selection.left}px`,
              top: `${selection.top}px`,
              width: `${selection.width}px`,
              height: `${selection.height}px`,
            }}
          >
            <span>{Math.round(selection.width)} x {Math.round(selection.height)}</span>
          </SnippingSelectionBox>
        )}
        <SnippingOverlayHint>
          <ScreenshotMonitor aria-hidden="true" />
          <span>{capturing ? "Capturing selected area..." : "Drag to snip / Esc cancels"}</span>
        </SnippingOverlayHint>
        {error && <SnippingOverlayError>{error}</SnippingOverlayError>}
      </SnippingOverlayRoot>
    </>
  );
}

const SnippingPanel = styled.section`
  display: grid;
  width: min(1080px, 100%);
  align-self: start;
  justify-self: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(244, 247, 250, 0.032), rgba(244, 247, 250, 0.01)),
    rgba(17, 22, 29, 0.86);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

const SnippingActionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
  }
`;

const SnippingButtonGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  button {
    min-height: 42px;
    justify-content: center;
  }

  @media (max-width: 580px) {
    grid-template-columns: 1fr;
  }
`;

const SnippingPermissionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const SnippingInfoTile = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.42);

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  strong {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

const SnipPreviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 820px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const SnipPreviewFallback = styled.div`
  display: grid;
  place-items: center;
  color: var(--forge-text-muted);

  svg {
    width: 24px;
    height: 24px;
  }
`;

const SnipPreviewCard = styled.button`
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(7, 9, 13, 0.45);
  text-align: left;

  img,
  ${SnipPreviewFallback} {
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: 7px;
    object-fit: cover;
    background: rgba(0, 0, 0, 0.28);
  }

  > span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12px;
  }

  small {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 650;
  }

  &:hover {
    border-color: rgba(125, 160, 205, 0.34);
    background: rgba(21, 27, 35, 0.72);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

const SnippingEmptyState = styled.div`
  display: grid;
  min-height: 96px;
  place-items: center;
  padding: 18px;
  border: 1px dashed var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 650;
  text-align: center;
`;

const SnippingOverlayGlobalStyle = createGlobalStyle`
  html,
  body,
  #app {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: transparent !important;
    cursor: crosshair;
    user-select: none;
  }
`;

const SnippingOverlayRoot = styled.main`
  position: fixed;
  inset: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
`;

const SnippingOverlayShade = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(1px);
`;

const SnippingSelectionBox = styled.div`
  position: absolute;
  border: 2px solid rgba(255, 205, 132, 0.98);
  border-radius: 4px;
  background: rgba(255, 205, 132, 0.12);
  box-shadow:
    0 0 0 9999px rgba(0, 0, 0, 0.18),
    0 0 28px rgba(255, 205, 132, 0.22);

  span {
    position: absolute;
    right: 6px;
    bottom: 6px;
    padding: 3px 6px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    background: rgba(7, 9, 13, 0.74);
    color: #ffe2b3;
    font-size: 11px;
    font-weight: 760;
  }
`;

const SnippingOverlayHint = styled.div`
  position: absolute;
  top: 18px;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(7, 9, 13, 0.72);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.22);
  transform: translateX(-50%);

  svg {
    width: 16px;
    height: 16px;
    color: #ffd18b;
  }

  span {
    font-size: 12px;
    font-weight: 760;
    white-space: nowrap;
  }
`;

const SnippingOverlayError = styled.div`
  position: absolute;
  right: 18px;
  bottom: 18px;
  max-width: min(520px, calc(100vw - 36px));
  padding: 10px 12px;
  border: 1px solid rgba(239, 107, 107, 0.38);
  border-radius: 10px;
  color: #ffd0d0;
  background: rgba(40, 8, 12, 0.78);
  font-size: 12px;
  font-weight: 700;
`;
