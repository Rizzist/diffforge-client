import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";
import { CropFree } from "@styled-icons/material-rounded/CropFree";
import { ScreenshotMonitor } from "@styled-icons/material-rounded/ScreenshotMonitor";
import { Videocam } from "@styled-icons/material-rounded/Videocam";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle, keyframes } from "styled-components";

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
export const SNIPPING_RECORDING_CONTROLS_HASH = "#/snipping-recording-controls";

const SNIPPING_SHORTCUTS_CHANGED_EVENT = "forge-snipping-shortcuts-changed";
const SNIPPING_CAPTURE_SAVED_EVENT = "forge-snipping-capture-saved";
export const SNIPPING_PERMISSION_ATTENTION_EVENT = "forge-snipping-permission-attention";
export const SNIPPING_CAPTURE_ATTENTION_EVENT = "forge-snipping-capture-attention";
const SNIPPING_AREA_OVERLAY_STARTED_EVENT = "forge-snipping-area-overlay-started";
const SNIPPING_AREA_OVERLAY_SNAPSHOT_EVENT = "forge-snipping-area-overlay-snapshot";
const SNIPPING_AREA_CURSOR_DEBUG_LOGGING_ENABLED = true;
const SNIPPING_AREA_CURSOR_DEBUG_MOUSE_SAMPLE_MS = 120;
const SNIPPING_ACTION_FULL = "full-screenshot";
const SNIPPING_ACTION_AREA = "area-snip";
const SNIPPING_ACTION_RECORDING = "area-recording";
const SNIPPING_PERMISSION_HIGHLIGHT_MS = 4200;
const RECORDING_MIN_SELECTION_SIZE = 36;
const RECORDING_RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function clearOverlaySnapshotPath(monitor) {
  if (!monitor || typeof monitor !== "object") return monitor || null;
  return {
    ...monitor,
    snapshotPath: "",
    snapshot_path: "",
  };
}
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

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function viewportBounds() {
  if (typeof window === "undefined") {
    return { width: RECORDING_MIN_SELECTION_SIZE, height: RECORDING_MIN_SELECTION_SIZE };
  }
  return {
    width: Math.max(RECORDING_MIN_SELECTION_SIZE, window.innerWidth || 0),
    height: Math.max(RECORDING_MIN_SELECTION_SIZE, window.innerHeight || 0),
  };
}

function fullViewportSelection() {
  const viewport = viewportBounds();
  return {
    left: 0,
    top: 0,
    width: viewport.width,
    height: viewport.height,
  };
}

function normalizeRecordingSelection(selection) {
  const viewport = viewportBounds();
  const width = clampNumber(
    Number(selection?.width),
    RECORDING_MIN_SELECTION_SIZE,
    viewport.width,
  );
  const height = clampNumber(
    Number(selection?.height),
    RECORDING_MIN_SELECTION_SIZE,
    viewport.height,
  );
  return {
    left: clampNumber(Number(selection?.left), 0, Math.max(0, viewport.width - width)),
    top: clampNumber(Number(selection?.top), 0, Math.max(0, viewport.height - height)),
    width,
    height,
  };
}

function recordingSelectionFromDrag({ startX, startY, endX, endY }) {
  const viewport = viewportBounds();
  const left = clampNumber(Math.min(startX, endX), 0, viewport.width);
  const top = clampNumber(Math.min(startY, endY), 0, viewport.height);
  const right = clampNumber(Math.max(startX, endX), 0, viewport.width);
  const bottom = clampNumber(Math.max(startY, endY), 0, viewport.height);
  return normalizeRecordingSelection({
    left,
    top,
    width: Math.max(RECORDING_MIN_SELECTION_SIZE, right - left),
    height: Math.max(RECORDING_MIN_SELECTION_SIZE, bottom - top),
  });
}

function resizeRecordingSelection(selection, handle, dx, dy) {
  const current = normalizeRecordingSelection(selection);
  let left = current.left;
  let top = current.top;
  let right = current.left + current.width;
  let bottom = current.top + current.height;

  if (handle?.includes("w")) left += dx;
  if (handle?.includes("e")) right += dx;
  if (handle?.includes("n")) top += dy;
  if (handle?.includes("s")) bottom += dy;

  if (right - left < RECORDING_MIN_SELECTION_SIZE) {
    if (handle?.includes("w")) {
      left = right - RECORDING_MIN_SELECTION_SIZE;
    } else {
      right = left + RECORDING_MIN_SELECTION_SIZE;
    }
  }
  if (bottom - top < RECORDING_MIN_SELECTION_SIZE) {
    if (handle?.includes("n")) {
      top = bottom - RECORDING_MIN_SELECTION_SIZE;
    } else {
      bottom = top + RECORDING_MIN_SELECTION_SIZE;
    }
  }

  return normalizeRecordingSelection({
    left,
    top,
    width: right - left,
    height: bottom - top,
  });
}

function formatRecordingElapsed(startedAtMs, nowMs) {
  const elapsedMs = Math.max(0, Number(nowMs || Date.now()) - Number(startedAtMs || Date.now()));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function defaultRecordingShortcut() {
  return isMacPlatform() ? "Command+Shift+Digit5" : "Control+Shift+Digit5";
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
  const recording = defaultRecordingShortcut();

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
    areaRecording: {
      shortcut: recording,
      defaultShortcut: recording,
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

function shortcutConflictMessage(entries) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      if (shortcutConflict(entries[leftIndex].shortcut, entries[rightIndex].shortcut)) {
        return `${entries[leftIndex].label} and ${entries[rightIndex].label} need different shortcuts.`;
      }
    }
  }
  return "";
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
  permissionAttentionId = 0,
  captureAttention = null,
}) {
  const [status, setStatus] = useState(fallbackSnippingStatus);
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState("idle");
  const [capturingShortcut, setCapturingShortcut] = useState("");
  const [lastCapture, setLastCapture] = useState(null);
  const [permissionHighlightId, setPermissionHighlightId] = useState(0);
  const permissionPanelRef = useRef(null);

  const snippingEnabled = Boolean(status?.enabled);
  const hideDesktopIcons = status?.hideDesktopIcons !== false;
  const uploadPublic = status?.uploadPublic !== false;
  const permissions = status?.permissions || fallbackPermissions();
  const fullShortcut = status?.fullScreenshot?.shortcut || defaultFullShortcut();
  const areaShortcut = status?.areaSnip?.shortcut || defaultAreaShortcut();
  const recordingShortcut = status?.areaRecording?.shortcut || defaultRecordingShortcut();
  const fullError = status?.fullScreenshot?.error || "";
  const areaError = status?.areaSnip?.error || "";
  const recordingError = status?.areaRecording?.error || "";
  const shortcutConflictError = shortcutConflictMessage([
    { label: "Full screenshot", shortcut: fullShortcut },
    { label: "Area snip", shortcut: areaShortcut },
    { label: "Area recording", shortcut: recordingShortcut },
  ]);
  const permissionMissing = Boolean(
    permissions.screenCaptureRequired && !permissions.screenCaptureGranted,
  );
  const shortcutReady = snippingEnabled
    && !permissionMissing
    && !fullError
    && !areaError
    && !recordingError
    && !shortcutConflictError
    && Boolean(status?.fullScreenshot?.registered)
    && Boolean(status?.areaSnip?.registered)
    && Boolean(status?.areaRecording?.registered);
  const savingShortcut = actionState === "saving";
  const togglingSnipping = actionState === "toggling";
  const togglingDesktopIcons = actionState === "toggling-desktop-icons";
  const togglingUploadPublic = actionState === "toggling-upload-public";
  const capturingFull = actionState === "capturing-full";
  const capturingArea = actionState === "capturing-area";
  const capturingRecording = actionState === "capturing-recording";
  const openingPermissions = actionState === "opening-permissions";
  const captureDisabled = !snippingEnabled || capturingFull || capturingArea || capturingRecording || togglingSnipping;

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

  const captureRecording = useCallback(async () => {
    if (!snippingEnabled) return;
    setActionState("capturing-recording");
    setError("");
    try {
      await invoke("snipping_begin_area_recording");
    } catch (captureError) {
      setError(getErrorMessage(captureError, "Unable to start area recording."));
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
    const attentionId = Number(permissionAttentionId || 0);
    if (!attentionId) return undefined;

    setPermissionHighlightId(attentionId);
    loadStatus();

    const scrollFrame = window.requestAnimationFrame(() => {
      permissionPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    const clearTimer = window.setTimeout(() => {
      setPermissionHighlightId((current) => (current === attentionId ? 0 : current));
    }, SNIPPING_PERMISSION_HIGHLIGHT_MS);

    return () => {
      window.cancelAnimationFrame(scrollFrame);
      window.clearTimeout(clearTimer);
    };
  }, [loadStatus, permissionAttentionId]);

  useEffect(() => {
    const attentionId = Number(captureAttention?.id || 0);
    if (!attentionId) return;

    const message = text(captureAttention?.message, "Unable to start snipping.");
    setError(message);
    setActionState("idle");
    loadStatus();
  }, [captureAttention, loadStatus]);

  useEffect(() => {
    let cancelled = false;
    let unlistenShortcuts = null;
    let unlistenCaptures = null;
    let unlistenCaptureAttention = null;

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

    listen(SNIPPING_CAPTURE_ATTENTION_EVENT, (event) => {
      if (!cancelled) {
        const message = text(event?.payload?.message, "Unable to start snipping.");
        setError(message);
        setActionState("idle");
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenCaptureAttention = unlisten;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      unlistenShortcuts?.();
      unlistenCaptures?.();
      unlistenCaptureAttention?.();
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
            <p>Screenshots, area snips, and recordings straight into local-only untracked assets.</p>
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
              <AudioStatePill data-installed={snippingEnabled && !capturingFull && !capturingArea && !capturingRecording}>
                {!snippingEnabled ? "Disabled" : capturingFull || capturingArea || capturingRecording ? "Capturing" : "Local only"}
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
              <SecondaryButton disabled={captureDisabled} onClick={captureRecording} type="button">
                <Videocam aria-hidden="true" />
                <span>{capturingRecording ? "Opening..." : "Record area"}</span>
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
                  ? "Snip uploads publish and copy a public URL automatically."
                  : "Snip uploads create a private Cloud copy first."}
              </SettingsHint>
              <McpSwitchButton
                aria-pressed={uploadPublic ? "true" : "false"}
                disabled={togglingUploadPublic}
                onClick={() => setUploadPublic(!uploadPublic)}
                type="button"
              >
                <span aria-hidden="true" />
                {togglingUploadPublic ? "Switching" : uploadPublic ? "Auto URL" : "Private only"}
              </McpSwitchButton>
            </AudioRecorderOptionRow>
            {lastCapture?.localPath && (
              <AudioInputMeta>Last snip: {lastCapture.localPath}</AudioInputMeta>
            )}
          </AudioDevicePanel>

          <SnippingPermissionsPanel ref={permissionPanelRef}>
            {permissionHighlightId ? (
              <SnippingPermissionHighlightFlash
                aria-hidden="true"
                key={`snipping-permission-highlight-${permissionHighlightId}`}
              />
            ) : null}
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
                <strong>{!snippingEnabled ? "Disabled" : status?.fullScreenshot?.registered && status?.areaSnip?.registered && status?.areaRecording?.registered ? "Registered" : "Unavailable"}</strong>
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
          </SnippingPermissionsPanel>
        </SnippingActionGrid>

        <AudioDevicePanel aria-label="Snipping shortcut settings">
          <AudioDeviceHeader>
            <div>
              <SettingsLabel>Bindings</SettingsLabel>
              <SettingsHint>Global hotkeys are registered only while Snipping is on.</SettingsHint>
            </div>
            <AudioStatePill data-installed={snippingEnabled && !fullError && !areaError && !recordingError && !shortcutConflictError}>
              {!snippingEnabled ? "Disabled" : savingShortcut ? "Saving" : fullError || areaError || recordingError || shortcutConflictError ? "Conflict" : "Ready"}
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

            <AudioShortcutCard data-error={Boolean(recordingError || shortcutConflictError)}>
              <span>Area recording</span>
              <AudioShortcutKey data-capturing={capturingShortcut === SNIPPING_ACTION_RECORDING}>
                {capturingShortcut === SNIPPING_ACTION_RECORDING ? "Press key" : formatShortcutLabel(recordingShortcut)}
              </AudioShortcutKey>
              <AudioShortcutActions>
                <SecondaryButton disabled={savingShortcut} onClick={() => setCapturingShortcut(SNIPPING_ACTION_RECORDING)} type="button">
                  <ButtonKeyIcon aria-hidden="true" />
                  <span>{capturingShortcut === SNIPPING_ACTION_RECORDING ? "Listening..." : "Change"}</span>
                </SecondaryButton>
              </AudioShortcutActions>
              {(recordingError || shortcutConflictError) && <AudioInputMeta>{recordingError || shortcutConflictError}</AudioInputMeta>}
            </AudioShortcutCard>
          </AudioShortcutGrid>

          <AudioRecorderOptionRow>
            <SettingsHint>
              Defaults: {formatShortcutLabel(status?.fullScreenshot?.defaultShortcut || defaultFullShortcut())} / {formatShortcutLabel(status?.areaSnip?.defaultShortcut || defaultAreaShortcut())} / {formatShortcutLabel(status?.areaRecording?.defaultShortcut || defaultRecordingShortcut())}
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
  const [overlayMode, setOverlayMode] = useState("image");
  const [recordingSelection, setRecordingSelection] = useState(null);
  const dragRef = useRef(null);
  const recordingDragRef = useRef(null);
  const activePointerIdRef = useRef(null);
  const capturingRef = useRef(false);
  const lastCursorMoveLogAtRef = useRef(0);

  const setCapturingState = useCallback((value) => {
    capturingRef.current = Boolean(value);
    setCapturing(Boolean(value));
  }, []);
  // One overlay window exists per display; backend events carry the target
  // overlay's label so each webview only applies its own monitor/backdrop.
  const windowLabel = useMemo(() => {
    try {
      return getCurrentWindow().label;
    } catch {
      return "";
    }
  }, []);

  const readCursorStyle = useCallback((element) => {
    try {
      return element ? window.getComputedStyle(element).cursor : "";
    } catch {
      return "";
    }
  }, []);

  const cursorDebugSnapshot = useCallback((event, extra = {}) => {
    const rootElement = event?.currentTarget || document.getElementById("app");
    const pointer = event ? {
      type: event.type,
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      isPrimary: event.isPrimary,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      movementX: event.movementX,
      movementY: event.movementY,
      pressure: event.pressure,
    } : null;
    return {
      windowLabel,
      activePointerId: activePointerIdRef.current,
      dragging: Boolean(dragRef.current),
      capturing: capturingRef.current,
      drag: dragRef.current,
      pointer,
      cssCursor: {
        target: readCursorStyle(rootElement),
        html: readCursorStyle(document.documentElement),
        body: readCursorStyle(document.body),
        app: readCursorStyle(document.getElementById("app")),
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      ...extra,
    };
  }, [readCursorStyle, windowLabel]);

  const logCursorDebug = useCallback((phase, fields = {}) => {
    if (!SNIPPING_AREA_CURSOR_DEBUG_LOGGING_ENABLED) return;
    invoke("snipping_log_area_cursor_event", {
      request: {
        phase,
        fields,
      },
    }).catch(() => {});
  }, []);

  const logCursorMoveDebug = useCallback((phase, event, fields = {}) => {
    if (!SNIPPING_AREA_CURSOR_DEBUG_LOGGING_ENABLED) return;
    const now = window.performance?.now?.() ?? Date.now();
    if (now - lastCursorMoveLogAtRef.current < SNIPPING_AREA_CURSOR_DEBUG_MOUSE_SAMPLE_MS) {
      return;
    }
    lastCursorMoveLogAtRef.current = now;
    logCursorDebug(phase, cursorDebugSnapshot(event, fields));
  }, [cursorDebugSnapshot, logCursorDebug]);

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
    if (overlayMode === "recording") {
      return recordingSelection ? normalizeRecordingSelection(recordingSelection) : null;
    }
    if (!drag) return null;
    const viewportWidth = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerHeight;
    const left = Math.max(0, Math.min(drag.startX, drag.endX));
    const top = Math.max(0, Math.min(drag.startY, drag.endY));
    const width = Math.min(Math.abs(drag.endX - drag.startX), Math.max(0, viewportWidth - left));
    const height = Math.min(Math.abs(drag.endY - drag.startY), Math.max(0, viewportHeight - top));
    return { left, top, width, height };
  }, [drag, overlayMode, recordingSelection]);

  const closeOverlay = useCallback(async (reason = "request") => {
    logCursorDebug("close_overlay", cursorDebugSnapshot(null, { reason }));
    setCapturingState(false);
    activePointerIdRef.current = null;
    dragRef.current = null;
    recordingDragRef.current = null;
    setDrag(null);
    setRecordingSelection(null);
    setOverlayMonitor((current) => (current ? clearOverlaySnapshotPath(current) : current));
    try {
      await invoke("snipping_cancel_area_snip");
    } catch {
      try {
        await getCurrentWindow().close();
      } catch {
        // Overlay close is best effort.
      }
    }
  }, [cursorDebugSnapshot, logCursorDebug, setCapturingState]);

  const applyOverlayMonitor = useCallback((monitor, mode = "image") => {
    const nextMode = mode === "recording" ? "recording" : "image";
    setOverlayMonitor(monitor && typeof monitor === "object" ? monitor : null);
    setOverlayMode(nextMode);
    setError("");
    if (dragRef.current || activePointerIdRef.current !== null || capturingRef.current) {
      return;
    }
    setCapturingState(false);
    setDrag(null);
    setRecordingSelection(nextMode === "recording" ? fullViewportSelection() : null);
  }, [setCapturingState]);

  const loadOverlayStatus = useCallback(async () => {
    try {
      const status = await invoke("snipping_area_overlay_status");
      applyOverlayMonitor(status?.monitor || null, status?.mode);
      logCursorDebug("status_loaded", cursorDebugSnapshot(null, {
        overlayMonitor: status?.monitor || null,
        mode: status?.mode,
      }));
    } catch (statusError) {
      const message = getErrorMessage(statusError, "Unable to prepare snipping overlay.");
      logCursorDebug("status_error", cursorDebugSnapshot(null, { message }));
      if (!message.includes("No active snipping overlay monitor")) {
        setError(message);
      }
    }
  }, [applyOverlayMonitor, cursorDebugSnapshot, logCursorDebug]);

  useEffect(() => {
    loadOverlayStatus();
  }, [loadOverlayStatus]);

  useEffect(() => {
    logCursorDebug("overlay_mounted", cursorDebugSnapshot(null));
    return () => {
      logCursorDebug("overlay_unmounted", cursorDebugSnapshot(null));
    };
  }, [cursorDebugSnapshot, logCursorDebug]);

  useEffect(() => {
    let cancelled = false;
    let readySent = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let fallbackTimer = 0;
    const markReady = () => {
      if (cancelled || readySent) {
        return;
      }
      readySent = true;
      invoke("snipping_area_overlay_ready").catch(() => {});
    };

    if (typeof window.requestAnimationFrame === "function") {
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(markReady);
      });
    }
    fallbackTimer = window.setTimeout(markReady, 120);

    return () => {
      cancelled = true;
      if (firstFrame) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenOverlayStarted = null;
    let unlistenOverlaySnapshot = null;

    listen(SNIPPING_AREA_OVERLAY_STARTED_EVENT, (event) => {
      if (cancelled) return;
      const targetLabel = text(event.payload?.overlayLabel || event.payload?.overlay_label);
      if (targetLabel && windowLabel && targetLabel !== windowLabel) return;
      logCursorDebug("overlay_started_event", cursorDebugSnapshot(null, {
        targetLabel,
        monitor: event.payload?.monitor || event.payload || null,
        mode: event.payload?.mode,
      }));
      applyOverlayMonitor(
        clearOverlaySnapshotPath(event.payload?.monitor || event.payload || null),
        event.payload?.mode,
      );
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
      logCursorDebug("overlay_snapshot_event", cursorDebugSnapshot(null, {
        targetLabel,
        snapshotPath,
      }));
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
  }, [applyOverlayMonitor, cursorDebugSnapshot, logCursorDebug, windowLabel]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay("escape_key");
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeOverlay]);

  useEffect(() => {
    if (overlayMode !== "recording") return undefined;
    setRecordingSelection((current) => normalizeRecordingSelection(current || fullViewportSelection()));
    const onResize = () => {
      setRecordingSelection((current) => normalizeRecordingSelection(current || fullViewportSelection()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [overlayMode, overlayMonitor]);

  const overlayPoint = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }, []);

  const releasePointerCapture = useCallback((event) => {
    const pointerId = activePointerIdRef.current;
    if (pointerId === null) return;
    try {
      event?.currentTarget?.releasePointerCapture?.(pointerId);
    } catch {
      // Pointer capture can already be gone after OS-level cancellation.
    }
    activePointerIdRef.current = null;
  }, []);

  const cancelActiveDrag = useCallback((event, reason = event?.type || "pointer_cancel") => {
    logCursorDebug("pointer_cancel", cursorDebugSnapshot(event, { reason }));
    releasePointerCapture(event);
    dragRef.current = null;
    recordingDragRef.current = null;
    setDrag(null);
  }, [cursorDebugSnapshot, logCursorDebug, releasePointerCapture]);

  const beginDrag = useCallback((event) => {
    if (event.target?.closest?.("button")) {
      return;
    }
    if ((event.pointerType === "mouse" && event.button !== 0) || capturingRef.current) {
      logCursorDebug("pointer_down_ignored", cursorDebugSnapshot(event, {
        reason: capturingRef.current ? "capturing" : "non_primary_mouse_button",
      }));
      return;
    }
    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    let captureAcquired = true;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      captureAcquired = false;
      activePointerIdRef.current = null;
    }
    const point = overlayPoint(event);
    if (overlayMode === "recording") {
      const currentSelection = normalizeRecordingSelection(recordingSelection || fullViewportSelection());
      const handle = text(event.target?.closest?.("[data-recording-resize-handle]")?.getAttribute("data-recording-resize-handle"));
      const insideSelection = point.x >= currentSelection.left
        && point.x <= currentSelection.left + currentSelection.width
        && point.y >= currentSelection.top
        && point.y <= currentSelection.top + currentSelection.height;
      recordingDragRef.current = {
        mode: handle ? "resize" : insideSelection ? "move" : "new",
        handle,
        startX: point.x,
        startY: point.y,
        initialSelection: currentSelection,
      };
      setRecordingSelection(currentSelection);
      setDrag(null);
      logCursorDebug("recording_pointer_down", cursorDebugSnapshot(event, {
        point,
        captureAcquired,
        recordingDrag: recordingDragRef.current,
      }));
      return;
    }
    const nextDrag = {
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
    logCursorDebug("pointer_down", cursorDebugSnapshot(event, {
      point,
      captureAcquired,
      drag: nextDrag,
    }));
  }, [cursorDebugSnapshot, logCursorDebug, overlayMode, overlayPoint, recordingSelection]);

  const updateDrag = useCallback((event) => {
    if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
      logCursorMoveDebug("pointer_move_ignored", event, { reason: "pointer_id_mismatch" });
      return;
    }
    if (overlayMode === "recording") {
      const recordingDrag = recordingDragRef.current;
      if (!recordingDrag || capturingRef.current) {
        logCursorMoveDebug("recording_pointer_move_idle", event, {
          reason: capturingRef.current ? "capturing" : "no_drag",
        });
        return;
      }
      const point = overlayPoint(event);
      const dx = point.x - recordingDrag.startX;
      const dy = point.y - recordingDrag.startY;
      let nextSelection = recordingDrag.initialSelection;
      if (recordingDrag.mode === "move") {
        nextSelection = normalizeRecordingSelection({
          ...recordingDrag.initialSelection,
          left: recordingDrag.initialSelection.left + dx,
          top: recordingDrag.initialSelection.top + dy,
        });
      } else if (recordingDrag.mode === "resize") {
        nextSelection = resizeRecordingSelection(
          recordingDrag.initialSelection,
          recordingDrag.handle,
          dx,
          dy,
        );
      } else {
        nextSelection = recordingSelectionFromDrag({
          startX: recordingDrag.startX,
          startY: recordingDrag.startY,
          endX: point.x,
          endY: point.y,
        });
      }
      setRecordingSelection(nextSelection);
      logCursorMoveDebug("recording_pointer_move_drag", event, {
        point,
        recordingDrag,
        selection: nextSelection,
      });
      return;
    }
    if (!dragRef.current || capturingRef.current) {
      logCursorMoveDebug("pointer_move_idle", event, {
        reason: capturingRef.current ? "capturing" : "no_drag",
      });
      return;
    }
    const point = overlayPoint(event);
    const nextDrag = {
      ...dragRef.current,
      endX: point.x,
      endY: point.y,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
    logCursorMoveDebug("pointer_move_drag", event, {
      point,
      drag: nextDrag,
    });
  }, [logCursorMoveDebug, overlayMode, overlayPoint]);

  const finishDrag = useCallback(async (event) => {
    if (event && activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
      logCursorDebug("pointer_up_ignored", cursorDebugSnapshot(event, {
        reason: "pointer_id_mismatch",
      }));
      return;
    }
    event?.preventDefault?.();
    const currentDrag = dragRef.current;
    const currentRecordingDrag = recordingDragRef.current;
    logCursorDebug("pointer_up", cursorDebugSnapshot(event, {
      drag: currentDrag,
      recordingDrag: currentRecordingDrag,
    }));
    dragRef.current = null;
    recordingDragRef.current = null;
    releasePointerCapture(event);
    if (overlayMode === "recording") {
      setRecordingSelection((current) => normalizeRecordingSelection(current || fullViewportSelection()));
      setDrag(null);
      return;
    }
    if (!currentDrag || capturingRef.current) {
      logCursorDebug("pointer_up_no_capture", cursorDebugSnapshot(event, {
        reason: capturingRef.current ? "capturing" : "no_drag",
      }));
      setDrag(null);
      return;
    }

    const viewportWidth = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerHeight;
    const left = Math.max(0, Math.min(currentDrag.startX, currentDrag.endX));
    const top = Math.max(0, Math.min(currentDrag.startY, currentDrag.endY));
    const width = Math.min(Math.abs(currentDrag.endX - currentDrag.startX), Math.max(0, viewportWidth - left));
    const height = Math.min(Math.abs(currentDrag.endY - currentDrag.startY), Math.max(0, viewportHeight - top));

    if (width < 4 || height < 4) {
      logCursorDebug("finish_small_area", cursorDebugSnapshot(event, {
        selection: { left, top, width, height },
      }));
      closeOverlay("small_area");
      return;
    }

    setCapturingState(true);
    setError("");
    const overlayWindow = getCurrentWindow();
    try {
      logCursorDebug("finish_capture_request", cursorDebugSnapshot(event, {
        selection: { left, top, width, height },
      }));
      await invoke("snipping_finish_area_snip", {
        request: {
          x: left,
          y: top,
          width,
          height,
          scaleFactor: window.devicePixelRatio || 1,
        },
      });
      setCapturingState(false);
      dragRef.current = null;
      setDrag(null);
      setOverlayMonitor((current) => (current ? clearOverlaySnapshotPath(current) : current));
      logCursorDebug("finish_capture_success", cursorDebugSnapshot(event, {
        selection: { left, top, width, height },
      }));
      try {
        await overlayWindow.hide();
      } catch {
        // Rust also hides the overlay after capture.
      }
    } catch (captureError) {
      setCapturingState(false);
      const message = getErrorMessage(captureError, "Unable to capture selected area.");
      logCursorDebug("finish_capture_error", cursorDebugSnapshot(event, {
        message,
        selection: { left, top, width, height },
      }));
      setError(message);
    }
  }, [closeOverlay, cursorDebugSnapshot, logCursorDebug, overlayMode, releasePointerCapture, setCapturingState]);

  const startRecording = useCallback(async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const activeSelection = normalizeRecordingSelection(recordingSelection || fullViewportSelection());
    if (!activeSelection || capturingRef.current) return;
    setCapturingState(true);
    setError("");
    const overlayWindow = getCurrentWindow();
    try {
      logCursorDebug("recording_start_request", cursorDebugSnapshot(event, {
        selection: activeSelection,
      }));
      await invoke("snipping_start_area_recording", {
        request: {
          x: activeSelection.left,
          y: activeSelection.top,
          width: activeSelection.width,
          height: activeSelection.height,
          scaleFactor: window.devicePixelRatio || 1,
        },
      });
      setRecordingSelection(null);
      setCapturingState(false);
      setOverlayMonitor((current) => (current ? clearOverlaySnapshotPath(current) : current));
      try {
        await overlayWindow.hide();
      } catch {
        // Rust also hides the overlay after recording starts.
      }
    } catch (recordingError) {
      setCapturingState(false);
      const message = getErrorMessage(recordingError, "Unable to start recording.");
      logCursorDebug("recording_start_error", cursorDebugSnapshot(event, {
        message,
        selection: activeSelection,
      }));
      setError(message);
    }
  }, [cursorDebugSnapshot, logCursorDebug, recordingSelection, setCapturingState]);

  const cancelRecordingSelection = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    closeOverlay("recording_cancel_button");
  }, [closeOverlay]);

  return (
    <>
      <SnippingOverlayGlobalStyle />
      <SnippingOverlayRoot
        data-snipping-mode={overlayMode}
        onLostPointerCapture={(event) => cancelActiveDrag(event, "lost_pointer_capture")}
        onPointerCancel={(event) => cancelActiveDrag(event, "pointer_cancel")}
        onPointerDown={beginDrag}
        onPointerEnter={(event) => logCursorDebug("pointer_enter", cursorDebugSnapshot(event))}
        onPointerLeave={(event) => logCursorDebug("pointer_leave", cursorDebugSnapshot(event))}
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        style={snapshotUrl ? { "--snipping-overlay-snapshot": `url("${snapshotUrl}")` } : undefined}
      >
        {!selection && !capturing && (
          <SnippingOverlayHint aria-hidden="true">
            {overlayMode === "recording" ? "Drag to record · Esc to cancel" : "Drag to snip · Esc to cancel"}
          </SnippingOverlayHint>
        )}
        {selection && (
          <SnippingSelectionBox
            aria-hidden="true"
            data-mode={overlayMode}
            style={{
              left: `${selection.left}px`,
              top: `${selection.top}px`,
              width: `${selection.width}px`,
              height: `${selection.height}px`,
            }}
          >
            <span>{Math.round(selection.width)} × {Math.round(selection.height)}</span>
            {overlayMode === "recording" && !capturing && (
              RECORDING_RESIZE_HANDLES.map((handle) => (
                <SnippingRecordingResizeHandle
                  aria-hidden="true"
                  data-recording-resize-handle={handle}
                  data-side={handle}
                  key={handle}
                />
              ))
            )}
          </SnippingSelectionBox>
        )}
        {overlayMode === "recording" && selection && !capturing && (
          <SnippingRecordingControlDock onPointerDown={(event) => event.stopPropagation()}>
            <span>{Math.round(selection.width)} × {Math.round(selection.height)}</span>
            <button onClick={startRecording} type="button">
              <Videocam aria-hidden="true" />
              Record
            </button>
            <button onClick={cancelRecordingSelection} type="button">
              Cancel
            </button>
          </SnippingRecordingControlDock>
        )}
        {error && <SnippingOverlayError>{error}</SnippingOverlayError>}
      </SnippingOverlayRoot>
    </>
  );
}

export function SnippingRecordingControlsWindow() {
  const [status, setStatus] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [stopping, setStopping] = useState(false);
  const active = Boolean(status?.active);
  const elapsed = formatRecordingElapsed(status?.startedAtMs || status?.started_at_ms, nowMs);

  const loadStatus = useCallback(async () => {
    try {
      const nextStatus = await invoke("snipping_recording_status");
      setStatus(nextStatus || { active: false });
      if (nextStatus?.active) {
        setStopping(false);
      }
      if (!nextStatus?.active && !stopping) {
        window.setTimeout(() => {
          getCurrentWindow().hide().catch(() => {});
        }, 160);
      }
    } catch {
      setStatus({ active: false });
    }
  }, [stopping]);

  useEffect(() => {
    loadStatus();
    const statusTimer = window.setInterval(loadStatus, 800);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadStatus]);

  const stopRecording = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await invoke("snipping_stop_recording");
      await getCurrentWindow().hide();
    } catch {
      setStopping(false);
    }
  }, [stopping]);

  return (
    <>
      <RecordingControlsGlobalStyle />
      <RecordingControlsRoot data-active={active ? "true" : "false"}>
        <RecordingPulse aria-hidden="true" />
        <RecordingTime>{active ? elapsed : "0:00"}</RecordingTime>
        <button disabled={!active || stopping} onClick={stopRecording} type="button">
          {stopping ? "Stopping" : "Stop"}
        </button>
      </RecordingControlsRoot>
    </>
  );
}

const RecordingControlsGlobalStyle = createGlobalStyle`
  html,
  body,
  #app {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: transparent !important;
    user-select: none;
  }
`;

const RecordingControlsRoot = styled.main`
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-columns: 16px minmax(58px, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 7px 8px 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  color: rgba(248, 250, 252, 0.94);
  background: rgba(8, 11, 16, 0.9);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  backdrop-filter: blur(16px);

  button {
    height: 34px;
    min-width: 72px;
    padding: 0 13px;
    border: 1px solid rgba(248, 113, 113, 0.42);
    border-radius: 10px;
    color: #fff;
    background: rgba(185, 28, 28, 0.92);
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.66;
  }
`;

const RecordingPulse = styled.span`
  width: 11px;
  height: 11px;
  border-radius: 999px;
  background: #ef4444;
  box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.18);
`;

const RecordingTime = styled.strong`
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 820;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  button {
    min-height: 42px;
    justify-content: center;
  }

  @media (max-width: 760px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 580px) {
    grid-template-columns: 1fr;
  }
`;

const snippingPermissionHighlightPulse = keyframes`
  0% { opacity: 0; }
  8% { opacity: 1; }
  42% { opacity: 0.66; }
  62% { opacity: 1; }
  100% { opacity: 0; }
`;

const SnippingPermissionsPanel = styled(AudioDevicePanel)`
  position: relative;
  align-self: start;
  overflow: visible;
`;

const SnippingPermissionHighlightFlash = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  border: 2px solid rgba(250, 204, 21, 0.98);
  border-radius: inherit;
  box-shadow:
    0 0 15px 4px rgba(250, 204, 21, 0.62),
    0 0 38px 10px rgba(250, 204, 21, 0.34),
    inset 0 0 20px rgba(250, 204, 21, 0.26);
  opacity: 0;
  animation: ${snippingPermissionHighlightPulse} 2s ease-in-out infinite;

  html[data-forge-theme="light"] & {
    border-color: rgba(202, 138, 4, 0.92);
    box-shadow:
      0 0 15px 4px rgba(202, 138, 4, 0.42),
      0 0 34px 9px rgba(202, 138, 4, 0.24),
      inset 0 0 18px rgba(202, 138, 4, 0.16);
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

  #app,
  #app [data-snipping-mode="image"],
  #app [data-snipping-mode="image"] * {
    cursor: crosshair !important;
  }

  #app [data-snipping-mode="recording"],
  #app [data-snipping-mode="recording"] * {
    cursor: pointer;
  }

  @keyframes recordingSelectionMarch {
    to {
      background-position:
        12px 0,
        -12px 100%,
        0 -12px,
        100% 12px;
    }
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
  cursor: crosshair;
  touch-action: none;

  &[data-snipping-mode="recording"] {
    cursor: pointer;
  }
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

  &[data-mode="recording"] {
    border: 0;
    box-shadow:
      0 0 0 100000px rgba(8, 10, 14, 0.14);
    pointer-events: auto;
  }

  &[data-mode="recording"]::before {
    content: "";
    position: absolute;
    inset: -1px;
    border: 1px dashed rgba(248, 250, 252, 0.92);
    border-radius: 4px;
    background:
      linear-gradient(90deg, #0f172a 50%, transparent 0) 0 0 / 12px 1px repeat-x,
      linear-gradient(90deg, #0f172a 50%, transparent 0) 0 100% / 12px 1px repeat-x,
      linear-gradient(0deg, #0f172a 50%, transparent 0) 0 0 / 1px 12px repeat-y,
      linear-gradient(0deg, #0f172a 50%, transparent 0) 100% 0 / 1px 12px repeat-y;
    animation: recordingSelectionMarch 720ms linear infinite;
    pointer-events: none;
  }

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

const SnippingRecordingResizeHandle = styled.i`
  position: absolute;
  z-index: 3;
  display: block;
  border: 0;
  background: transparent;
  box-shadow: none;
  touch-action: none;

  &[data-side="nw"] {
    left: -14px;
    top: -14px;
    width: 28px;
    height: 28px;
    cursor: nwse-resize !important;
  }

  &[data-side="n"] {
    left: 14px;
    right: 14px;
    top: -12px;
    height: 24px;
    cursor: ns-resize !important;
  }

  &[data-side="ne"] {
    right: -14px;
    top: -14px;
    width: 28px;
    height: 28px;
    cursor: nesw-resize !important;
  }

  &[data-side="e"] {
    right: -12px;
    top: 14px;
    bottom: 14px;
    width: 24px;
    cursor: ew-resize !important;
  }

  &[data-side="se"] {
    right: -14px;
    bottom: -14px;
    width: 28px;
    height: 28px;
    cursor: nwse-resize !important;
  }

  &[data-side="s"] {
    left: 14px;
    right: 14px;
    bottom: -12px;
    height: 24px;
    cursor: ns-resize !important;
  }

  &[data-side="sw"] {
    left: -14px;
    bottom: -14px;
    width: 28px;
    height: 28px;
    cursor: nesw-resize !important;
  }

  &[data-side="w"] {
    left: -12px;
    top: 14px;
    bottom: 14px;
    width: 24px;
    cursor: ew-resize !important;
  }
`;

const SnippingRecordingControlDock = styled.div`
  position: absolute;
  left: 50%;
  bottom: 22px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 12px;
  background: rgba(9, 12, 18, 0.86);
  box-shadow:
    0 18px 46px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transform: translateX(-50%);
  pointer-events: auto;
  backdrop-filter: blur(16px);

  > span {
    min-width: 84px;
    padding: 0 8px;
    color: rgba(226, 232, 240, 0.82);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 760;
    font-variant-numeric: tabular-nums;
    text-align: center;
    white-space: nowrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 82px;
    height: 30px;
    padding: 0 11px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    color: rgba(248, 250, 252, 0.9);
    background: rgba(10, 12, 16, 0.88);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    font-size: 12px;
    font-weight: 760;
    line-height: 1;
    cursor: pointer !important;
  }

  button:first-of-type {
    border-color: rgba(248, 113, 113, 0.38);
    background: rgba(185, 28, 28, 0.86);
  }

  svg {
    width: 15px;
    height: 15px;
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
