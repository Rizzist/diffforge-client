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
  McpSwitchButton,
  PrimaryButton,
  SecondaryButton,
  SettingsHint,
  SettingsLabel,
  VaultPlaceholderIcon,
} from "../app/appStyles";

export const SNIPPING_OVERLAY_HASH = "#/snipping-overlay";

const SNIPPING_SHORTCUTS_CHANGED_EVENT = "forge-snipping-shortcuts-changed";
const SNIPPING_CAPTURE_SAVED_EVENT = "forge-snipping-capture-saved";
const SNIPPING_AREA_OVERLAY_STARTED_EVENT = "forge-snipping-area-overlay-started";
const SNIPPING_AREA_OVERLAY_SNAPSHOT_EVENT = "forge-snipping-area-overlay-snapshot";
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
    enabled: true,
    hideDesktopIcons: true,
    uploadPublic: true,
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

  const snippingEnabled = Boolean(status?.enabled);
  const hideDesktopIcons = status?.hideDesktopIcons !== false;
  const uploadPublic = status?.uploadPublic !== false;
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
  const shortcutReady = snippingEnabled
    && !permissionMissing
    && !fullError
    && !areaError
    && !shortcutConflictError
    && Boolean(status?.fullScreenshot?.registered)
    && Boolean(status?.areaSnip?.registered);
  const savingShortcut = actionState === "saving";
  const togglingSnipping = actionState === "toggling";
  const togglingDesktopIcons = actionState === "toggling-desktop-icons";
  const togglingUploadPublic = actionState === "toggling-upload-public";
  const capturingFull = actionState === "capturing-full";
  const capturingArea = actionState === "capturing-area";
  const openingPermissions = actionState === "opening-permissions";
  const captureDisabled = !snippingEnabled || capturingFull || capturingArea || togglingSnipping;

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

  const setSnippingEnabled = useCallback(async (enabled) => {
    setActionState("toggling");
    setError("");
    try {
      const nextStatus = await invoke("set_snipping_enabled", {
        request: { enabled },
      });
      setStatus(nextStatus || fallbackSnippingStatus());
      setCapturingShortcut("");
    } catch (toggleError) {
      setError(getErrorMessage(toggleError, "Unable to update snipping switch."));
    } finally {
      setActionState("idle");
    }
  }, []);

  const setHideDesktopIcons = useCallback(async (enabled) => {
    setActionState("toggling-desktop-icons");
    setError("");
    try {
      const nextStatus = await invoke("set_snipping_hide_desktop_icons", {
        request: { enabled },
      });
      setStatus(nextStatus || fallbackSnippingStatus());
    } catch (toggleError) {
      setError(getErrorMessage(toggleError, "Unable to update the desktop icons setting."));
    } finally {
      setActionState("idle");
    }
  }, []);

  const setUploadPublic = useCallback(async (enabled) => {
    setActionState("toggling-upload-public");
    setError("");
    try {
      const nextStatus = await invoke("set_snipping_upload_public", {
        request: { enabled },
      });
      setStatus(nextStatus || fallbackSnippingStatus());
    } catch (toggleError) {
      setError(getErrorMessage(toggleError, "Unable to update the snip upload privacy setting."));
    } finally {
      setActionState("idle");
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
    if (!snippingEnabled) return;
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
  }, [onUntrackedRefresh, snippingEnabled]);

  const captureArea = useCallback(async () => {
    if (!snippingEnabled) return;
    setActionState("capturing-area");
    setError("");
    try {
      await invoke("snipping_begin_area_snip");
    } catch (captureError) {
      setError(getErrorMessage(captureError, "Unable to start area snip."));
    } finally {
      setActionState("idle");
    }
  }, [snippingEnabled]);

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
          <SnippingHeaderActions>
            <McpSwitchButton
              aria-pressed={snippingEnabled ? "true" : "false"}
              disabled={togglingSnipping}
              onClick={() => setSnippingEnabled(!snippingEnabled)}
              type="button"
            >
              <span aria-hidden="true" />
              {togglingSnipping ? "Switching" : snippingEnabled ? "On" : "Off"}
            </McpSwitchButton>
            <AudioStatePill data-installed={shortcutReady}>
              {!snippingEnabled ? "Disabled" : shortcutReady ? "Ready" : permissionMissing ? "Needs access" : "Check shortcuts"}
            </AudioStatePill>
          </SnippingHeaderActions>
        </AudioHeroRow>

        <SnippingActionGrid>
          <AudioDevicePanel>
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Capture</SettingsLabel>
                <SettingsHint>{snippingEnabled
                  ? "Manual snips save into the untracked snips folder."
                  : "Turn on Snipping before taking screenshots."}
                </SettingsHint>
              </div>
              <AudioStatePill data-installed={snippingEnabled && !capturingFull && !capturingArea}>
                {!snippingEnabled ? "Disabled" : capturingFull || capturingArea ? "Capturing" : "Local only"}
              </AudioStatePill>
            </AudioDeviceHeader>
            <SnippingButtonGrid>
              <PrimaryButton disabled={captureDisabled} onClick={captureFull} type="button">
                <ScreenshotMonitor aria-hidden="true" />
                <span>{capturingFull ? "Capturing..." : "Take screenshot"}</span>
              </PrimaryButton>
              <SecondaryButton disabled={captureDisabled} onClick={captureArea} type="button">
                <CropFree aria-hidden="true" />
                <span>{capturingArea ? "Opening..." : "Select area"}</span>
              </SecondaryButton>
            </SnippingButtonGrid>
            <SettingsHint>
              Saves to {status?.untrackedRoot ? `${status.untrackedRoot}/snips` : "the untracked snips folder"}.
            </SettingsHint>
            <AudioRecorderOptionRow>
              <SettingsHint>
                Hide desktop icon clutter while capturing, then bring it back.
              </SettingsHint>
              <McpSwitchButton
                aria-pressed={hideDesktopIcons ? "true" : "false"}
                disabled={togglingDesktopIcons}
                onClick={() => setHideDesktopIcons(!hideDesktopIcons)}
                type="button"
              >
                <span aria-hidden="true" />
                {togglingDesktopIcons ? "Switching" : hideDesktopIcons ? "On" : "Off"}
              </McpSwitchButton>
            </AudioRecorderOptionRow>
            <AudioRecorderOptionRow>
              <SettingsHint>
                {uploadPublic
                  ? "Snip uploads mint a public link instantly, ready to copy."
                  : "Snip uploads stay private; each snip needs an explicit Make public step."}
              </SettingsHint>
              <McpSwitchButton
                aria-pressed={uploadPublic ? "true" : "false"}
                disabled={togglingUploadPublic}
                onClick={() => setUploadPublic(!uploadPublic)}
                type="button"
              >
                <span aria-hidden="true" />
                {togglingUploadPublic ? "Switching" : uploadPublic ? "Public" : "Private"}
              </McpSwitchButton>
            </AudioRecorderOptionRow>
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
                <strong>{!snippingEnabled ? "Disabled" : status?.fullScreenshot?.registered && status?.areaSnip?.registered ? "Registered" : "Unavailable"}</strong>
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
              <SettingsHint>Global hotkeys are registered only while Snipping is on.</SettingsHint>
            </div>
            <AudioStatePill data-installed={snippingEnabled && !fullError && !areaError && !shortcutConflictError}>
              {!snippingEnabled ? "Disabled" : savingShortcut ? "Saving" : fullError || areaError || shortcutConflictError ? "Conflict" : "Ready"}
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

        {error && <FormMessage $state="error">{error}</FormMessage>}
      </SnippingPanel>
    </AudioWorkspaceSurface>
  );
}

export function SnippingOverlayWindow() {
  const [drag, setDrag] = useState(null);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [overlayMonitor, setOverlayMonitor] = useState(null);
  const dragRef = useRef(null);
  // One overlay window exists per display; backend events carry the target
  // overlay's label so each webview only applies its own monitor/backdrop.
  const windowLabel = useMemo(() => {
    try {
      return getCurrentWindow().label;
    } catch {
      return "";
    }
  }, []);

  const snapshotUrl = useMemo(() => {
    const snapshotPath = text(overlayMonitor?.snapshotPath || overlayMonitor?.snapshot_path);
    if (!snapshotPath) return "";
    try {
      return convertFileSrc(snapshotPath);
    } catch {
      return "";
    }
  }, [overlayMonitor]);

  const selection = useMemo(() => {
    if (!drag) return null;
    const viewportWidth = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerHeight;
    const left = Math.max(0, Math.min(drag.startX, drag.endX));
    const top = Math.max(0, Math.min(drag.startY, drag.endY));
    const width = Math.min(Math.abs(drag.endX - drag.startX), Math.max(0, viewportWidth - left));
    const height = Math.min(Math.abs(drag.endY - drag.startY), Math.max(0, viewportHeight - top));
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

  const applyOverlayMonitor = useCallback((monitor) => {
    setOverlayMonitor(monitor && typeof monitor === "object" ? monitor : null);
    setError("");
    setCapturing(false);
    dragRef.current = null;
    setDrag(null);
  }, []);

  const loadOverlayStatus = useCallback(async () => {
    try {
      const status = await invoke("snipping_area_overlay_status");
      applyOverlayMonitor(status?.monitor || null);
    } catch (statusError) {
      const message = getErrorMessage(statusError, "Unable to prepare snipping overlay.");
      if (!message.includes("No active snipping overlay monitor")) {
        setError(message);
      }
    }
  }, [applyOverlayMonitor]);

  useEffect(() => {
    loadOverlayStatus();
  }, [loadOverlayStatus]);

  useEffect(() => {
    let cancelled = false;
    let unlistenOverlayStarted = null;
    let unlistenOverlaySnapshot = null;

    listen(SNIPPING_AREA_OVERLAY_STARTED_EVENT, (event) => {
      if (cancelled) return;
      const targetLabel = text(event.payload?.overlayLabel || event.payload?.overlay_label);
      if (targetLabel && windowLabel && targetLabel !== windowLabel) return;
      applyOverlayMonitor(event.payload?.monitor || event.payload || null);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenOverlayStarted = unlisten;
      }
    }).catch(() => {});

    // The frozen-frame preview is written after the overlay opens; merge it in
    // without resetting an in-progress selection.
    listen(SNIPPING_AREA_OVERLAY_SNAPSHOT_EVENT, (event) => {
      if (cancelled) return;
      const targetLabel = text(event.payload?.overlayLabel || event.payload?.overlay_label);
      if (targetLabel && windowLabel && targetLabel !== windowLabel) return;
      const snapshotPath = text(event.payload?.snapshotPath || event.payload?.snapshot_path);
      if (!snapshotPath) return;
      setOverlayMonitor((current) => (
        current ? { ...current, snapshotPath, snapshot_path: snapshotPath } : current
      ));
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenOverlaySnapshot = unlisten;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      unlistenOverlayStarted?.();
      unlistenOverlaySnapshot?.();
    };
  }, [applyOverlayMonitor, windowLabel]);

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

  const overlayPoint = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }, []);

  const beginDrag = useCallback((event) => {
    if (event.button !== 0 || capturing) return;
    event.preventDefault();
    const point = overlayPoint(event);
    const nextDrag = {
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }, [capturing, overlayPoint]);

  const updateDrag = useCallback((event) => {
    if (!dragRef.current || capturing) return;
    const point = overlayPoint(event);
    const nextDrag = {
      ...dragRef.current,
      endX: point.x,
      endY: point.y,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }, [capturing, overlayPoint]);

  const finishDrag = useCallback(async () => {
    const currentDrag = dragRef.current;
    dragRef.current = null;
    if (!currentDrag || capturing) return;

    const viewportWidth = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerHeight;
    const left = Math.max(0, Math.min(currentDrag.startX, currentDrag.endX));
    const top = Math.max(0, Math.min(currentDrag.startY, currentDrag.endY));
    const width = Math.min(Math.abs(currentDrag.endX - currentDrag.startX), Math.max(0, viewportWidth - left));
    const height = Math.min(Math.abs(currentDrag.endY - currentDrag.startY), Math.max(0, viewportHeight - top));

    if (width < 4 || height < 4) {
      closeOverlay();
      return;
    }

    setCapturing(true);
    setError("");
    const overlayWindow = getCurrentWindow();
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
        await overlayWindow.hide();
      } catch {
        // Rust also hides the overlay after capture.
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
        style={snapshotUrl ? { "--snipping-overlay-snapshot": `url("${snapshotUrl}")` } : undefined}
      >
        {!selection && !capturing && (
          <SnippingOverlayHint aria-hidden="true">
            Drag to snip · Esc to cancel
          </SnippingOverlayHint>
        )}
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
            <span>{Math.round(selection.width)} × {Math.round(selection.height)}</span>
          </SnippingSelectionBox>
        )}
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

const SnippingHeaderActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
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
  background:
    var(--snipping-overlay-snapshot, transparent)
    center / 100% 100%
    no-repeat;
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

const SnippingOverlayHint = styled.div`
  position: absolute;
  top: 28px;
  left: 50%;
  padding: 7px 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  color: rgba(244, 247, 250, 0.92);
  background: rgba(10, 12, 16, 0.78);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  transform: translateX(-50%);
  pointer-events: none;
  backdrop-filter: blur(10px);
`;

const SnippingSelectionBox = styled.div`
  position: absolute;
  border: 1.5px solid rgba(125, 176, 255, 0.95);
  border-radius: 2px;
  /* Subtle spotlight: hint the selection without darkening the screen. */
  box-shadow:
    0 0 0 1px rgba(8, 10, 14, 0.35),
    0 0 0 100000px rgba(8, 10, 14, 0.14);
  pointer-events: none;

  span {
    position: absolute;
    left: 50%;
    top: calc(100% + 8px);
    padding: 4px 9px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    background: rgba(10, 12, 16, 0.88);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    color: rgba(244, 247, 250, 0.92);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    line-height: 1;
    white-space: nowrap;
    transform: translateX(-50%);
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
