/* Pure state machine for the pre-login Haider runtime setup gate (F1-UI).

   The gate sits between the auth boot ceremony and the sign-in card: when
   the local status says the runtime is NOT installed, the setup screen holds
   the ceremony; every other answer lets login proceed. Absence of knowledge
   is never rendered as a fact — a failed/timed-out status check settles into
   the NON-BLOCKING "unknown" stage (a dismissible notice over the entry
   card), and every rendered fact below comes verbatim from a command result
   or event payload. Nothing here invokes: the hook owns the wire.

   Stages: checking -> needed | unknown | complete
           needed/unknown/failed -> installing -> starting -> done -> complete
           needed/unknown/failed -> skipped */

const DECIMAL_STRING = /^\d+$/;

export const SETUP_STAGES = [
  "checking", // status request in flight (non-blocking: no receipt yet)
  "needed", // status EXPLICITLY said installed:false — the blocking setup screen
  "unknown", // status failed/timed out/unconfirmed — non-blocking notice only
  "installing", // haider_install_latest in flight (progress events)
  "starting", // install landed; haider_daemon_start in flight
  "done", // outcome facts on screen for a short hold
  "failed", // install/start rejected — Retry (if retryable) / Continue
  "skipped", // the user chose to continue without the runtime
  "complete", // gate closed (already installed, finished, or acknowledged)
];

/* Blocking stages hold the auth ceremony before the entry card. "checking"
   and "unknown" are deliberately absent: only a receipt that EXPLICITLY
   published installed:false may gate — before a receipt (or after a failed,
   timed-out, or malformed one) login proceeds untouched. */
const GATE_STAGES = new Set(["needed", "installing", "starting", "done", "failed"]);

export const INSTALL_PHASES = ["resolving", "downloading", "verifying", "installing"];

export const INSTALL_PHASE_LABELS = {
  resolving: "Resolving latest release",
  downloading: "Downloading",
  verifying: "Verifying",
  installing: "Installing",
};

export const INITIAL_SETUP_STATE = {
  stage: "checking",
  status: null, // last successful haider_runtime_status view
  statusError: null, // rejection view when the status check failed
  progress: null, // { phase, downloadedBytes, totalBytes } — strings verbatim
  install: null, // { installedVersion, path, restartNeeded }
  start: null, // { started, error }
  failure: null, // { code, message, retryable, during: "install"|"start" }
  noticeDismissed: false,
};

/* ---- byte counters: decimal STRINGS end to end ----------------------- */

/* HOUSE LAW: byte counters ride the wire as decimal strings and are NEVER
   Number()-coerced — above 2^53 that would silently name a different byte.
   Comparisons and display math go through BigInt. */
export function decimalBytesOrNull(value) {
  return typeof value === "string" && DECIMAL_STRING.test(value) ? value : null;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(value) {
  const decimal = decimalBytesOrNull(value);
  if (decimal == null) return null;
  const bytes = BigInt(decimal);
  let unit = 0;
  let divisor = 1n;
  while (unit < BYTE_UNITS.length - 1 && bytes >= divisor * 1024n) {
    divisor *= 1024n;
    unit += 1;
  }
  if (unit === 0) return `${bytes.toString()} B`;
  const tenths = (bytes * 10n) / divisor;
  return `${(tenths / 10n).toString()}.${(tenths % 10n).toString()} ${BYTE_UNITS[unit]}`;
}

/* Whole percent 0..100, or null whenever either side is unknown — an
   unknown total renders as indeterminate, never as a guessed fraction. */
export function progressPercent(downloadedBytes, totalBytes) {
  const downloaded = decimalBytesOrNull(downloadedBytes);
  const total = decimalBytesOrNull(totalBytes);
  if (downloaded == null || total == null) return null;
  const totalBig = BigInt(total);
  if (totalBig === 0n) return null;
  const downloadedBig = BigInt(downloaded);
  const clamped = downloadedBig > totalBig ? totalBig : downloadedBig;
  return Number((clamped * 100n) / totalBig);
}

/* ---- wire views ------------------------------------------------------ */

/* SDK rejections are { code, message, retryable }. Only an explicit
   retryable:true earns a Retry affordance. */
export function runtimeErrorView(error) {
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message: String(error?.message ?? error ?? "The command failed."),
    retryable: error?.retryable === true,
  };
}

export function runtimeStatusView(receipt) {
  return {
    installed: receipt?.installed === true,
    version: typeof receipt?.version === "string" ? receipt.version : null,
    running: receipt?.running === true,
    installPath: typeof receipt?.install_path === "string" ? receipt.install_path : "",
    latestKnown: typeof receipt?.latest_known === "string" ? receipt.latest_known : null,
    updateAvailable: typeof receipt?.update_available === "boolean"
      ? receipt.update_available
      : null,
  };
}

/* ---- transitions (each guards its source stage; foreign-stage calls are
   ignored, so a late status resolution can never override a timeout) ---- */

export function statusResolved(state, receipt) {
  if (state.stage !== "checking") return state;
  /* Already installed -> the gate never opens. Existing surfaces own
     daemon presence/absence from here. */
  if (receipt?.installed === true) {
    return { ...state, stage: "complete", status: runtimeStatusView(receipt), statusError: null };
  }
  /* Only an EXPLICIT installed:false is a confirmed absence and may gate. */
  if (receipt?.installed === false) {
    return { ...state, stage: "needed", status: runtimeStatusView(receipt), statusError: null };
  }
  /* A receipt without an explicit installed boolean (missing, null, or a
     coerced lookalike) proves nothing — settle the NON-blocking unknown
     stage, exactly like a failed check. */
  return statusUnknown(state, {
    message: "The runtime status did not publish an explicit installed fact.",
  });
}

export function statusUnknown(state, error) {
  if (state.stage !== "checking") return state;
  return { ...state, stage: "unknown", statusError: runtimeErrorView(error) };
}

export function installRequested(state) {
  if (!["needed", "unknown", "failed"].includes(state.stage)) return state;
  return { ...state, stage: "installing", progress: null, failure: null };
}

/* One "haider-install-progress" payload. Unknown phases and malformed
   counters are dropped whole — a bad frame never corrupts the last good
   one. Byte strings are stored verbatim. */
export function installProgress(state, payload) {
  if (state.stage !== "installing") return state;
  if (!INSTALL_PHASES.includes(payload?.phase)) return state;
  const downloadedBytes = decimalBytesOrNull(payload.downloaded_bytes);
  if (downloadedBytes == null) return state;
  return {
    ...state,
    progress: {
      phase: payload.phase,
      downloadedBytes,
      /* total_bytes is nullable on the wire: null means "size unknown". */
      totalBytes: payload.total_bytes === null ? null : decimalBytesOrNull(payload.total_bytes),
    },
  };
}

export function installResolved(state, receipt) {
  if (state.stage !== "installing") return state;
  return {
    ...state,
    stage: "starting",
    install: {
      installedVersion: typeof receipt?.installed_version === "string"
        ? receipt.installed_version
        : null,
      path: typeof receipt?.path === "string" ? receipt.path : "",
      restartNeeded: receipt?.restart_needed === true,
    },
  };
}

export function installFailed(state, error) {
  if (state.stage !== "installing") return state;
  return {
    ...state,
    stage: "failed",
    failure: { ...runtimeErrorView(error), during: "install" },
  };
}

export function startResolved(state, receipt) {
  if (state.stage !== "starting") return state;
  return {
    ...state,
    stage: "done",
    start: {
      started: receipt?.started === true,
      error: typeof receipt?.error === "string" && receipt.error.length > 0
        ? receipt.error
        : null,
    },
  };
}

export function startFailed(state, error) {
  if (state.stage !== "starting") return state;
  return {
    ...state,
    stage: "failed",
    failure: { ...runtimeErrorView(error), during: "start" },
  };
}

/* Retrying a failed daemon start re-enters "starting" without repeating the
   install; a failed install retries through installRequested. */
export function retryStartRequested(state) {
  if (state.stage !== "failed" || state.failure?.during !== "start") return state;
  return { ...state, stage: "starting", failure: null };
}

export function continueWithout(state) {
  if (!["needed", "unknown", "failed"].includes(state.stage)) return state;
  return { ...state, stage: "skipped" };
}

export function setupCompleted(state) {
  if (state.stage !== "done") return state;
  return { ...state, stage: "complete" };
}

export function noticeDismissed(state) {
  if (state.stage !== "unknown") return state;
  return { ...state, noticeDismissed: true };
}

/* ---- selectors ------------------------------------------------------- */

export function setupGateActive(state) {
  return GATE_STAGES.has(state?.stage);
}

export function setupNoticeVisible(state) {
  return state?.stage === "unknown" && state?.noticeDismissed !== true;
}

/* Progress facts shaped for display. Percent stays null (indeterminate)
   until the daemon has published both counters. */
export function progressView(state) {
  const progress = state?.progress;
  if (!progress) {
    return { phaseLabel: "Preparing", downloadedText: null, totalText: null, percent: null };
  }
  return {
    phaseLabel: INSTALL_PHASE_LABELS[progress.phase] ?? progress.phase,
    downloadedText: formatBytes(progress.downloadedBytes),
    totalText: progress.totalBytes == null ? null : formatBytes(progress.totalBytes),
    percent: progressPercent(progress.downloadedBytes, progress.totalBytes),
  };
}

/* Outcome facts for the "done" hold. The daemon outcome is EXACTLY what
   haider_daemon_start returned — a reported start error is never masked.
   restart_needed rides alongside as its own conservative flag: the SDK also
   sets it for UNKNOWN endpoint health, so it never overrides the start
   outcome and never asserts that a previous daemon exists or is live. */
export function doneView(state) {
  const install = state?.install;
  const start = state?.start;
  return {
    installedVersion: install?.installedVersion ?? null,
    restartPending: install?.restartNeeded === true,
    daemon: start == null
      ? "not_reported"
      : start.error != null
        ? "start_error"
        : start.started
          ? "started"
          : "already_running",
    startError: start?.error ?? null,
  };
}
