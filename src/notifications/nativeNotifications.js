export const NATIVE_NOTIFICATION_STORAGE_KEY = "diffforge.nativeNotifications.v1";

function readSettings() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { enabled: true };
    }
    const parsed = JSON.parse(window.localStorage.getItem(NATIVE_NOTIFICATION_STORAGE_KEY) || "{}");
    return { enabled: parsed?.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

export function readNativeNotificationSettings() {
  return readSettings();
}

export function writeNativeNotificationSettings(settings = {}) {
  const nextSettings = { enabled: settings?.enabled !== false };
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(NATIVE_NOTIFICATION_STORAGE_KEY, JSON.stringify(nextSettings));
    }
  } catch {
    // Runtime notification checks still default safely if persistence fails.
  }
  return nextSettings;
}

function windowIsFocused() {
  try {
    return typeof document !== "undefined"
      && document.visibilityState === "visible"
      && document.hasFocus();
  } catch {
    return false;
  }
}

let pluginModulePromise = null;

function loadNotificationPlugin() {
  if (!pluginModulePromise) {
    pluginModulePromise = import("@tauri-apps/plugin-notification").catch(() => null);
  }
  return pluginModulePromise;
}

let permissionGranted = null;

async function ensurePluginPermission(plugin) {
  if (permissionGranted === true) return true;
  if (await plugin.isPermissionGranted()) {
    permissionGranted = true;
    return true;
  }
  const permission = await plugin.requestPermission();
  permissionGranted = permission === "granted";
  return permissionGranted;
}

export async function getNativeNotificationPermissionStatus() {
  if (!readSettings().enabled) {
    return {
      appEnabled: false,
      granted: false,
      permission: "disabled",
      message: "Native notifications are disabled in Diff Forge settings.",
    };
  }

  try {
    const plugin = await loadNotificationPlugin();
    if (plugin && typeof plugin.isPermissionGranted === "function") {
      const granted = await plugin.isPermissionGranted();
      const browserPermission = typeof window !== "undefined" && window.Notification
        ? window.Notification.permission
        : "";
      return {
        appEnabled: true,
        granted,
        permission: granted ? "granted" : browserPermission || "default",
        message: granted
          ? "Native notifications are enabled."
          : "Allow notifications to receive background todo and agent alerts.",
      };
    }
  } catch {
    // Fall through to the web Notification API status.
  }

  const permission = typeof window !== "undefined" && window.Notification
    ? window.Notification.permission
    : "unavailable";
  return {
    appEnabled: true,
    granted: permission === "granted",
    permission,
    message: permission === "granted"
      ? "Native notifications are enabled."
      : permission === "denied"
        ? "Enable notifications for Diff Forge AI in System Settings."
        : "Allow notifications to receive background todo and agent alerts.",
  };
}

export async function requestNativeNotificationPermission() {
  const plugin = await loadNotificationPlugin();
  if (plugin && typeof plugin.requestPermission === "function") {
    const permission = await plugin.requestPermission();
    permissionGranted = permission === "granted";
    return getNativeNotificationPermissionStatus();
  }

  if (typeof window !== "undefined" && typeof window.Notification === "function") {
    const permission = await window.Notification.requestPermission();
    permissionGranted = permission === "granted";
    return getNativeNotificationPermissionStatus();
  }

  return getNativeNotificationPermissionStatus();
}

/**
 * Send a native OS notification. By default it is suppressed while the app
 * window is focused and visible, because in-app SFX and badges already cover
 * that case. Failures are swallowed: notifications are convenience signals.
 */
export async function sendNativeNotification({ title, body = "", suppressWhenFocused = true } = {}) {
  const safeTitle = String(title || "").trim();
  if (!safeTitle) {
    return { sent: false, reason: "no_title" };
  }
  if (!readSettings().enabled) {
    return { sent: false, reason: "disabled" };
  }
  if (suppressWhenFocused && windowIsFocused()) {
    return { sent: false, reason: "window_focused" };
  }

  const safeBody = String(body || "").trim().slice(0, 280);

  try {
    const plugin = await loadNotificationPlugin();
    if (plugin && typeof plugin.sendNotification === "function") {
      if (await ensurePluginPermission(plugin)) {
        plugin.sendNotification({ body: safeBody, title: safeTitle });
        return { sent: true, transport: "tauri" };
      }
      return { sent: false, reason: "permission_denied" };
    }
  } catch {
    // Fall through to the web Notification API.
  }

  try {
    if (typeof window !== "undefined" && typeof window.Notification === "function") {
      if (window.Notification.permission === "default") {
        await window.Notification.requestPermission();
      }
      if (window.Notification.permission === "granted") {
        new window.Notification(safeTitle, { body: safeBody });
        return { sent: true, transport: "web" };
      }
    }
  } catch {
    // Notifications are best effort.
  }

  return { sent: false, reason: "unavailable" };
}
