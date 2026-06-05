const TERMINAL_WINDOWS_PTY_BACKEND = "conpty";
const TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES = new Set([
  1000,
  1002,
  1003,
  1006,
  1007,
  1047,
  1048,
  1049,
  2004,
  2026,
]);

function isWindowsTerminalHost() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = String(navigator.platform || "");
  const userAgent = String(navigator.userAgent || "");

  return /windows|win32|win64|wince/i.test(`${platform} ${userAgent}`);
}

const TERMINAL_IS_WINDOWS_HOST = isWindowsTerminalHost();

function buildWindowsPtyOptions(info = null) {
  if (!TERMINAL_IS_WINDOWS_HOST) {
    return undefined;
  }

  const buildNumber = Number(info?.buildNumber ?? info?.build_number ?? 0);
  if (Number.isFinite(buildNumber) && buildNumber > 0) {
    return {
      backend: TERMINAL_WINDOWS_PTY_BACKEND,
      buildNumber,
    };
  }

  return {
    backend: TERMINAL_WINDOWS_PTY_BACKEND,
  };
}

export {
  TERMINAL_IS_WINDOWS_HOST,
  TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES,
  TERMINAL_WINDOWS_PTY_BACKEND,
  buildWindowsPtyOptions,
};
