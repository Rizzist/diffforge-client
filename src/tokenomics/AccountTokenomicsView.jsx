import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { FilterListOff } from "@styled-icons/material-rounded/FilterListOff";
import {
  billingStatusPlanName,
  dailyUsageTitle,
  dailyUsageValue,
  formatCredits,
  formatCost,
  formatCostTitle,
  formatPaceMultiplier,
  formatTokenTitle,
  formatTokens,
  numeric,
  paceMultiplierFromDelta,
  resolveAccountDisplayedCreditWalletState,
  rowActivityTokens,
  rowCache,
  rowCost,
  rowInput,
  rowOutput,
  rowProviderAccountKey,
  rowProviderAccountLabel,
  rowTotal,
} from "./tokenomicsFormat.js";
import {
  mergeProviderLimitRowsForDisplay,
  mergeProviderLimits,
  mergeProviderLimitSamples,
  parseLimitTimestamp,
  projectProviderLimitForDisplay,
  providerLimitKey,
  providerLimitSampleKey,
} from "./tokenomicsProviderLimitMerge.js";
import {
  prioritizedTokenomicsIdentityKeyClaims,
  registerTokenomicsIdentityAlias,
  tokenomicsAccountsFromDistinctKeys,
  uniqueTokenomicsAliasesByOwner,
} from "./tokenomicsAccountIdentity.js";
import {
  HISTORICAL_ACCOUNT_FILTER_PROVIDERS,
  mergeTokenomicsProviderAccounts,
  providerKey,
  rowDeviceId,
  rowScopeKey,
  tokenomicsCurrentProfileIdsByProvider,
  tokenomicsProfileIdFromAccountKey,
  tokenomicsProviderProfileAccountKey,
  tokenomicsRowAgentProfileId,
  tokenomicsRowReferencesRemovedProfile,
} from "./tokenomicsAccountRoster.js";
import {
  reconcileProviderTerminalStaleRows,
  recordRestartedProviderTerminalClaim,
} from "./providerTerminalRestart.js";
import {
  createHarnessRosterState,
  createHarnessRosterWatchUnavailable,
  driveHarnessRosterStartup,
  harnessAccountAlias,
  harnessAccountChipPresentation,
  harnessRosterApplySignal,
  harnessRosterErrorCode,
  harnessRosterOnListError,
  harnessRosterOnListResult,
  harnessRosterOnWatchState,
  harnessRosterPresentation,
  harnessSwapAllowed,
  harnessSwapBegin,
  harnessSwapConfirm,
  harnessSwapDismissFailure,
  harnessSwapFail,
} from "./harnessAccountRoster.js";
import {
  createHarnessAddFlowState,
  createHarnessImportCatalogState,
  createHarnessImportState,
  createHarnessRemoveState,
  harnessAddFlowBegin,
  harnessAddFlowCancel,
  harnessAddFlowClaimPayload,
  harnessAddFlowDismiss,
  harnessAddFlowExpire,
  harnessAddFlowOnClaimError,
  harnessAddFlowOnClaimResult,
  harnessAddFlowOnStartError,
  harnessAddFlowOnStartResult,
  harnessAddFlowOnStatus,
  harnessAddFlowOnStatusError,
  harnessAddFlowShouldPoll,
  harnessApiKeySubmitPayload,
  harnessImportBegin,
  harnessImportCatalogOnError,
  harnessImportCatalogOnResult,
  harnessImportCatalogPresentation,
  harnessImportDismiss,
  harnessImportOnError,
  harnessImportOnResult,
  harnessManageFailureMessage,
  harnessOauthExpiryWaitMs,
  harnessRemoveBegin,
  harnessRemoveDismiss,
  harnessRemoveOnError,
  harnessRemoveOnRefreshResult,
  harnessRemoveOnResult,
  harnessRemoveRequest,
} from "./harnessAccountManage.js";
import { providerAuthOptions } from "../sessions/haiderClientContract.js";
import {
  harnessAccountMeterPresentation,
  harnessAccountUsagePresentation,
  harnessMeterLine,
  harnessProviderAccent,
} from "./harnessAccountUsage.js";
import {
  tokenomicsDailyBucketPresentation,
  tokenomicsDailyBucketTitle,
  tokenomicsLedgerAuthority,
  tokenomicsPeriodCellValue,
} from "./tokenomicsLedgerHonesty.js";
import {
  TERMINAL_SESSION_RESTART_MODES,
  TERMINAL_SESSION_RESTART_REQUEST_EVENT,
  TERMINAL_SESSION_RESTART_RESULT_EVENT,
  createTerminalSessionRestartCoordinatorId,
} from "../terminals/terminalSessionRestart.js";
import {
  tokenomicsAuthorityLimit,
  tokenomicsUsageAuthorityPresentation,
} from "./tokenomicsUsageAuthority.js";

const TOKENOMICS_UPDATED_EVENT = "diffforge://tokenomics-updated";
const TOKENOMICS_VIEW_POLL_INTERVAL_MS = 60_000;
const TOKENOMICS_LIVE_LIMIT_REFRESH_INTERVAL_MS = 60_000;
const TOKENOMICS_SUMMARY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS = 250;
const TOKENOMICS_LIMIT_CLOUD_SYNC_REASON = "tokenomics_limits_changed";
const TOKENOMICS_DAILY_WINDOW_DAYS = 30;
const TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS = TOKENOMICS_DAILY_WINDOW_DAYS;
const TOKENOMICS_DAILY_RANGE_OPTIONS = [7, TOKENOMICS_DAILY_WINDOW_DAYS];
const TOKENOMICS_DAILY_WARN_LIMIT_PERCENT = 13;
const TOKENOMICS_DAILY_DANGER_LIMIT_PERCENT = 20;
const TOKENOMICS_USAGE_RATE_WINDOWS = [
  { key: "5_hour", label: "5h" },
  { key: "weekly", label: "Weekly" },
];

const PROVIDERS = [
  { id: "all", label: "All", match: () => true },
  { id: "codex", label: "Codex", match: (row) => providerKey(row) === "codex" },
  { id: "claude", label: "Claude", match: (row) => providerKey(row) === "claude" },
  { id: "opencode", label: "OpenCode", match: (row) => providerKey(row) === "opencode" },
];

const PROVIDER_LABELS = {
  anthropic: "Claude Code",
  claude: "Claude Code",
  openai: "Codex",
  codex: "Codex",
  opencode: "OpenCode",
  "haider-code": "Haider Code",
};

const PROVIDER_MODELS = {
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5"],
  claude: ["fable-5", "opus-4-8", "sonnet-4-6", "haiku-4-5"],
  all: ["codex", "claude", "opencode"],
};

const PROVIDER_ACCENTS = {
  all: "#60a5fa",
  codex: "#60a5fa",
  claude: "#fb923c",
  opencode: "#34d399",
  "haider-code": "#a78bfa",
};

const TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE = "__none__";

/* Rust boundary event for the live account roster watch (haider_rpc_ade.rs,
   account_list_watch_v1). Payloads are revision-only change signals or watch
   readiness transitions — never roster data. */
const HARNESS_ROSTER_CHANGED_EVENT = "account-roster-changed";

/* Live harness roster wiring. Every decision lives in harnessAccountRoster.js;
   this hook only performs the invokes/listens those decisions call for. */
function useHarnessAccountRoster(active) {
  const [rosterState, setRosterState] = useState(createHarnessRosterState);
  const rosterStateRef = useRef(rosterState);
  rosterStateRef.current = rosterState;
  const rosterMountedRef = useRef(true);
  const rosterWritableRef = useRef(active);
  rosterWritableRef.current = active;
  const listRequestSequenceRef = useRef(0);

  useEffect(() => () => {
    rosterMountedRef.current = false;
    rosterWritableRef.current = false;
  }, []);

  const relist = useCallback(async () => {
    const sequence = ++listRequestSequenceRef.current;
    try {
      const result = await invoke("account_list", { provider: null });
      if (!rosterWritableRef.current) return "inactive";
      if (sequence !== listRequestSequenceRef.current) return "superseded";
      setRosterState((prev) => harnessRosterOnListResult(prev, result));
      return "refreshed";
    } catch (error) {
      if (!rosterWritableRef.current) return "inactive";
      if (sequence !== listRequestSequenceRef.current) return "superseded";
      setRosterState((prev) => harnessRosterOnListError(prev, error));
      return "failed";
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let unlisten = null;
    /* Register the event listener first. Only after registration resolves may
       the watch be attached, and only after that settles may the baseline be
       listed. This closes the revision-loss gap and keeps listener failures
       visible as Snapshot with their real reason. */
    void driveHarnessRosterStartup({
      registerListener: () => listen(HARNESS_ROSTER_CHANGED_EVENT, (event) => {
        if (cancelled) return;
        /* relist depends only on the payload (never on state), so deciding it
           outside the updater cannot drift from what the updater applies. */
        const { relist: relistNow } = harnessRosterApplySignal(rosterStateRef.current, event?.payload);
        setRosterState((prev) => harnessRosterApplySignal(prev, event?.payload).state);
        /* A roster-changed signal carries no roster data: re-list is the only
           way its change reaches pixels. */
        if (relistNow) relist();
      }),
      attachWatch: () => invoke("account_list_watch"),
      takeBaseline: relist,
      onListenerFailure: (error) => {
        setRosterState((prev) => harnessRosterOnWatchState(
          prev,
          createHarnessRosterWatchUnavailable(harnessRosterErrorCode(error)),
        ));
      },
      onWatchResult: (watch) => {
        setRosterState((prev) => harnessRosterOnWatchState(prev, watch));
      },
      onWatchFailure: (error) => {
        setRosterState((prev) => harnessRosterOnWatchState(
          prev,
          createHarnessRosterWatchUnavailable(harnessRosterErrorCode(error)),
        ));
      },
      /* relist owns request sequencing and applies the baseline itself. */
      onBaselineResult: () => {},
      onBaselineFailure: () => {},
      isCancelled: () => cancelled,
    }).then(({ unlisten: next }) => {
      if (cancelled) {
        if (next) next();
        return;
      }
      unlisten = next;
    });
    return () => {
      /* Deactivation and unmount supersede every list issued by this active
         lifetime, even if reactivation's listener rejects before a new
         baseline can advance the sequence. */
      listRequestSequenceRef.current += 1;
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [active, relist]);

  const swapAccount = useCallback(async (descriptor, confirmNewEpoch = false) => {
    if (!rosterWritableRef.current) return;
    const alias = harnessAccountAlias(descriptor);
    const gate = harnessSwapAllowed(rosterStateRef.current, descriptor);
    if (!confirmNewEpoch && !gate.allowed) return;
    if (confirmNewEpoch && !alias) return;
    setRosterState((prev) => harnessSwapBegin(prev, alias));
    try {
      const result = await invoke("account_set_active", {
        alias,
        confirm_new_epoch: Boolean(confirmNewEpoch),
      });
      if (!rosterMountedRef.current) return;
      /* A point success clears only the marker. account_list remains the sole
         authority for active flags and revision. Clearing the local operation
         marker is safe while inactive and prevents a stuck swap on reopen. */
      setRosterState((prev) => harnessSwapConfirm(prev, alias, result));
      if (rosterWritableRef.current) void relist();
    } catch (error) {
      if (!rosterMountedRef.current) return;
      if (!rosterWritableRef.current) {
        setRosterState((prev) => harnessSwapConfirm(prev));
        return;
      }
      setRosterState((prev) => harnessSwapFail(prev, alias, error));
    }
  }, [relist]);

  const dismissSwapFailure = useCallback(() => {
    setRosterState((prev) => harnessSwapDismissFailure(prev));
  }, []);

  return { rosterState, swapAccount, dismissSwapFailure, relist };
}

/* ---- harness account management wiring (add / import / remove) ----------
   Every decision lives in harnessAccountManage.js; this hook only performs
   the invokes those decisions call for. The roster itself is NEVER edited
   here: a completed add or remove reaches pixels exclusively through the
   daemon's account_list (the roster watch, plus the explicit re-list each
   success triggers). */

const HARNESS_OAUTH_POLL_MS = 1500;
const HARNESS_OAUTH_MAX_POLL_LIFETIME_MS = 10 * 60 * 1000;

function useHarnessAccountManagement(active, relist) {
  const [addMode, setAddMode] = useState(""); // "" | "oauth" | "api_key"
  const addModeRef = useRef(addMode);
  addModeRef.current = addMode;
  const [libraryState, setLibraryState] = useState({ state: "idle", library: null, reason: "" });
  const libraryReadGenerationRef = useRef(0);
  const [catalog, setCatalog] = useState(createHarnessImportCatalogState);
  const catalogReadGenerationRef = useRef(0);
  const [addFlow, setAddFlow] = useState(createHarnessAddFlowState);
  const addFlowRef = useRef(addFlow);
  addFlowRef.current = addFlow;
  const [oauthDraft, setOauthDraft] = useState({ provider: "", alias: "" });
  const [importState, setImportState] = useState(createHarnessImportState);
  const importStateRef = useRef(importState);
  importStateRef.current = importState;
  const [removeState, setRemoveState] = useState(createHarnessRemoveState);
  const removeStateRef = useRef(removeState);
  removeStateRef.current = removeState;
  const [apiMetadata, setApiMetadata] = useState({ provider: "", alias: "" });
  const apiMetadataRef = useRef(apiMetadata);
  apiMetadataRef.current = apiMetadata;
  const apiKeyRef = useRef("");
  const apiKeyInputRef = useRef(null);
  const [apiKeyPresent, setApiKeyPresent] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const apiBusyRef = useRef(apiBusy);
  apiBusyRef.current = apiBusy;
  const apiAttemptGenerationRef = useRef(0);
  const [apiError, setApiError] = useState("");
  const managementMountedRef = useRef(true);
  const managementActiveRef = useRef(active);
  managementActiveRef.current = active;
  const managementCanWrite = useCallback(
    () => managementMountedRef.current && managementActiveRef.current,
    [],
  );

  const resetPublishedAuthorities = useCallback(() => {
    libraryReadGenerationRef.current += 1;
    catalogReadGenerationRef.current += 1;
    if (!managementMountedRef.current) return;
    setLibraryState({ state: "idle", library: null, reason: "" });
    setCatalog(createHarnessImportCatalogState());
  }, []);

  const commitAddFlow = useCallback((next) => {
    addFlowRef.current = next;
    if (managementCanWrite()) setAddFlow(next);
  }, [managementCanWrite]);

  const commitImportState = useCallback((next) => {
    importStateRef.current = next;
    if (managementCanWrite()) setImportState(next);
  }, [managementCanWrite]);

  const commitRemoveState = useCallback((next) => {
    removeStateRef.current = next;
    if (managementCanWrite()) setRemoveState(next);
  }, [managementCanWrite]);

  const clearApiKeySecret = useCallback(() => {
    apiAttemptGenerationRef.current += 1;
    apiBusyRef.current = false;
    apiKeyRef.current = "";
    if (apiKeyInputRef.current) apiKeyInputRef.current.value = "";
    if (managementCanWrite()) {
      setApiKeyPresent(false);
      setApiBusy(false);
    }
  }, [managementCanWrite]);

  const cancelDaemonFlow = useCallback(async (payload) => {
    if (!payload) return;
    try {
      await invoke("account_oauth_cancel", payload);
    } catch (error) {
      /* Cancellation is best-effort after unmount. While the surface remains
         writable, retain the daemon's reason on the cancelled attempt. */
      if (!managementCanWrite()) return;
      const current = addFlowRef.current;
      if (current.phase !== "cancelled") return;
      commitAddFlow({
        ...current,
        message: `Cancellation could not be confirmed (${harnessRosterErrorCode(error) || "connection changed"}).`,
      });
    }
  }, [commitAddFlow, managementCanWrite]);

  const openOauthAuthorization = useCallback(async (attempt = addFlowRef.current) => {
    const authorizationUrl = String(attempt?.authorizationUrl || "").trim();
    if (!authorizationUrl) return;
    try {
      await openUrl(authorizationUrl);
    } catch (error) {
      if (!managementCanWrite()) return;
      const current = addFlowRef.current;
      if (
        current.phase !== "pending"
        || current.flowId !== attempt.flowId
        || current.attemptId !== attempt.attemptId
        || current.authorizationUrl !== authorizationUrl
      ) return;
      commitAddFlow({
        ...current,
        message: `The browser could not be opened (${harnessRosterErrorCode(error) || "open failed"}); use the URL below.`,
      });
    }
  }, [commitAddFlow, managementCanWrite]);

  useEffect(() => {
    managementMountedRef.current = true;
    return () => {
      managementMountedRef.current = false;
      managementActiveRef.current = false;
      apiAttemptGenerationRef.current += 1;
      libraryReadGenerationRef.current += 1;
      catalogReadGenerationRef.current += 1;
      apiKeyRef.current = "";
      const { state: cancelled, cancelPayload } = harnessAddFlowCancel(addFlowRef.current);
      addFlowRef.current = cancelled;
      void cancelDaemonFlow(cancelPayload);
    };
  }, [cancelDaemonFlow]);

  useEffect(() => {
    if (active) return;
    apiAttemptGenerationRef.current += 1;
    apiKeyRef.current = "";
    const { cancelPayload } = harnessAddFlowCancel(addFlowRef.current);
    const idleAddFlow = createHarnessAddFlowState();
    const idleImport = createHarnessImportState();
    const idleRemove = createHarnessRemoveState();
    addFlowRef.current = idleAddFlow;
    importStateRef.current = idleImport;
    removeStateRef.current = idleRemove;
    apiBusyRef.current = false;
    addModeRef.current = "";
    resetPublishedAuthorities();
    if (apiKeyInputRef.current) apiKeyInputRef.current.value = "";
    /* The component is still mounted here. Reset the rendered state as well
       as the refs so a later reactivation cannot resurrect an abandoned
       starting/claiming/import/remove/API attempt. */
    if (managementMountedRef.current) {
      setAddFlow(idleAddFlow);
      setImportState(idleImport);
      setRemoveState(idleRemove);
      setApiBusy(false);
      setApiKeyPresent(false);
      setApiError("");
      setAddMode("");
    }
    void cancelDaemonFlow(cancelPayload);
  }, [active, cancelDaemonFlow, resetPublishedAuthorities]);

  /* The provider options for both add paths come from PUBLISHED authorities:
     the library snapshot's per-provider auth_methods (OAuth sign-in and API
     key), and the daemon's import catalog (import sources) — never a local
     provider list. */
  useEffect(() => {
    if (!active || !addMode) return undefined;
    const readGeneration = ++libraryReadGenerationRef.current;
    setLibraryState({ state: "loading", library: null, reason: "" });
    invoke("haider_library_snapshot").then((snapshot) => {
      if (!managementCanWrite() || libraryReadGenerationRef.current !== readGeneration) return;
      setLibraryState({ state: "loaded", library: snapshot, reason: "" });
    }).catch((error) => {
      if (!managementCanWrite() || libraryReadGenerationRef.current !== readGeneration) return;
      setLibraryState({ state: "error", library: null, reason: harnessRosterErrorCode(error) });
    });
    return () => {
      if (libraryReadGenerationRef.current === readGeneration) libraryReadGenerationRef.current += 1;
    };
  }, [active, addMode, managementCanWrite]);

  useEffect(() => {
    if (!active || addMode !== "oauth") return undefined;
    const readGeneration = ++catalogReadGenerationRef.current;
    setCatalog(createHarnessImportCatalogState());
    /* Registration is pending post-excision; rejection renders as a failed read. */
    invoke("haider_account_oauth_import_sources").then((result) => {
      if (!managementCanWrite() || catalogReadGenerationRef.current !== readGeneration) return;
      setCatalog(harnessImportCatalogOnResult(result));
    }).catch((error) => {
      if (!managementCanWrite() || catalogReadGenerationRef.current !== readGeneration) return;
      setCatalog(harnessImportCatalogOnError(error));
    });
    return () => {
      if (catalogReadGenerationRef.current === readGeneration) catalogReadGenerationRef.current += 1;
    };
  }, [active, addMode, managementCanWrite]);

  const startOauth = useCallback(async () => {
    const begun = harnessAddFlowBegin(addFlowRef.current, oauthDraft);
    if (begun === addFlowRef.current || begun.phase !== "starting") return;
    commitAddFlow(begun);
    try {
      const result = await invoke("account_oauth_start", {
        provider: begun.provider,
        desired_alias: begun.alias,
      });
      const next = harnessAddFlowOnStartResult(begun, result);
      /* Close/unmount may win while start is in flight. Always await the
         result, then cancel a daemon-created flow instead of dropping it. */
      if (addFlowRef.current !== begun || !managementCanWrite()) {
        if (next.phase === "pending") {
          void cancelDaemonFlow({ flow_id: next.flowId, attempt_id: next.attemptId });
        }
        return;
      }
      commitAddFlow(next);
      if (next.phase === "pending" && next.authorizationUrl) {
        void openOauthAuthorization(next);
      }
    } catch (error) {
      if (addFlowRef.current !== begun || !managementCanWrite()) return;
      const next = harnessAddFlowOnStartError(begun, error);
      commitAddFlow(next);
    }
  }, [cancelDaemonFlow, commitAddFlow, managementCanWrite, oauthDraft, openOauthAuthorization]);

  /* One status request at a time. A separate expiry timer bounds even a stuck
     bridge promise; cleanup stops both timers, and every post-await state write
     is gated by the live surface plus all three attempt identities. */
  useEffect(() => {
    if (!active || !harnessAddFlowShouldPoll(addFlow)) return undefined;
    let pollCancelled = false;
    let pollTimer = 0;
    let expiryTimer = 0;
    const effectFlowId = addFlow.flowId;
    const effectAttemptId = addFlow.attemptId;
    const fallbackExpiresAtMs = Date.now() + HARNESS_OAUTH_MAX_POLL_LIFETIME_MS;
    const deadlineMs = Number.isInteger(addFlow.expiresAtMs)
      ? addFlow.expiresAtMs
      : fallbackExpiresAtMs;
    const wallStartedAtMs = Date.now();
    const monotonicStartedAtMs = performance.now();
    const monotonicDeadlineMs = monotonicStartedAtMs + Math.max(0, deadlineMs - wallStartedAtMs);

    const expire = () => {
      if (pollCancelled || !managementCanWrite()) return;
      const current = addFlowRef.current;
      if (current.flowId !== effectFlowId || current.attemptId !== effectAttemptId) return;
      const expired = harnessAddFlowExpire(current, Math.max(Date.now(), deadlineMs), fallbackExpiresAtMs);
      if (expired.state === current) return;
      pollCancelled = true;
      window.clearTimeout(pollTimer);
      commitAddFlow(expired.state);
      void cancelDaemonFlow(expired.cancelPayload);
    };

    const armExpiry = () => {
      if (pollCancelled || !managementCanWrite()) return;
      const waitMs = harnessOauthExpiryWaitMs({
        deadlineMs,
        wallNowMs: Date.now(),
        monotonicDeadlineMs,
        monotonicNowMs: performance.now(),
      });
      if (waitMs > 0) {
        expiryTimer = window.setTimeout(armExpiry, waitMs);
        return;
      }
      expire();
    };

    const poll = async () => {
      if (pollCancelled || !managementCanWrite()) return;
      const flow = addFlowRef.current;
      if (
        !harnessAddFlowShouldPoll(flow)
        || flow.flowId !== effectFlowId
        || flow.attemptId !== effectAttemptId
      ) return;
      let next;
      try {
        const result = await invoke("account_oauth_status", {
          flow_id: flow.flowId,
          attempt_id: flow.attemptId,
        });
        if (pollCancelled || !managementCanWrite()) return;
        next = harnessAddFlowOnStatus(
          addFlowRef.current,
          flow.flowId,
          flow.attemptId,
          result,
        );
      } catch (error) {
        if (pollCancelled || !managementCanWrite()) return;
        next = harnessAddFlowOnStatusError(
          addFlowRef.current,
          flow.flowId,
          flow.attemptId,
          error,
        );
      }
      if (next === addFlowRef.current) {
        pollTimer = window.setTimeout(poll, HARNESS_OAUTH_POLL_MS);
        return;
      }
      commitAddFlow(next);
      if (next.phase !== "claiming") return;
      const claimAttempt = next;
      const claim = harnessAddFlowClaimPayload(claimAttempt);
      try {
        await invoke("account_oauth_add", claim);
        const settled = harnessAddFlowOnClaimResult(claimAttempt);
        /* A completed add NEVER fabricates a roster entry: the new account
           appears only through the daemon's account_list re-read. Settlement
           belongs to this attempt, so panel close cannot suppress the read. */
        if (settled.relist) void relist();
        if (managementCanWrite() && addFlowRef.current === claimAttempt) {
          commitAddFlow(settled.state);
        }
      } catch (error) {
        if (!managementCanWrite() || addFlowRef.current !== claimAttempt) return;
        commitAddFlow(harnessAddFlowOnClaimError(claimAttempt, error));
      }
    };

    armExpiry();
    if (!pollCancelled) {
      pollTimer = window.setTimeout(poll, Math.min(HARNESS_OAUTH_POLL_MS, Math.max(0, deadlineMs - Date.now())));
    }
    return () => {
      pollCancelled = true;
      window.clearTimeout(pollTimer);
      window.clearTimeout(expiryTimer);
    };
  }, [
    active,
    addFlow.phase,
    addFlow.flowId,
    addFlow.attemptId,
    addFlow.expiresAtMs,
    cancelDaemonFlow,
    commitAddFlow,
    managementCanWrite,
    relist,
  ]);

  const cancelOauth = useCallback(() => {
    const { state: next, cancelPayload } = harnessAddFlowCancel(addFlowRef.current);
    /* Clear the REF synchronously: state clears only on the next render, and
       a poll landing in that window must not claim a dismissed flow. */
    commitAddFlow(next);
    void cancelDaemonFlow(cancelPayload);
  }, [cancelDaemonFlow, commitAddFlow]);

  const dismissAddFlow = useCallback(() => {
    const next = harnessAddFlowDismiss(addFlowRef.current);
    commitAddFlow(next);
  }, [commitAddFlow]);

  const importSource = useCallback((source) => {
    const { state: next, payload } = harnessImportBegin(importStateRef.current, source);
    commitImportState(next);
    if (!payload) return;
    const importAttempt = next;
    invoke("haider_account_oauth_import", payload).then(() => {
      const settled = harnessImportOnResult(importAttempt);
      if (managementCanWrite() && importStateRef.current === importAttempt) {
        commitImportState(settled.state);
      }
      /* Same law as the sign-in flow: the imported account arrives only via
         the daemon's account_list re-read. */
      if (settled.relist) void relist();
    }).catch((error) => {
      if (!managementCanWrite() || importStateRef.current !== importAttempt) return;
      commitImportState(harnessImportOnError(importAttempt, error).state);
    });
  }, [commitImportState, managementCanWrite, relist]);

  const dismissImport = useCallback(() => {
    commitImportState(harnessImportDismiss(importStateRef.current));
  }, [commitImportState]);

  const editApiMetadata = useCallback((field, value) => {
    if (field !== "provider" && field !== "alias") return;
    const next = { ...apiMetadataRef.current, [field]: String(value ?? "") };
    apiMetadataRef.current = next;
    if (managementCanWrite()) setApiMetadata(next);
  }, [managementCanWrite]);

  const editApiKey = useCallback((value) => {
    apiKeyRef.current = String(value ?? "");
    if (managementCanWrite()) setApiKeyPresent(apiKeyRef.current.length > 0);
  }, [managementCanWrite]);

  const submitApiKey = useCallback(async () => {
    if (apiBusyRef.current || !managementCanWrite()) return;
    const payload = harnessApiKeySubmitPayload({
      provider: apiMetadataRef.current.provider,
      alias: apiMetadataRef.current.alias,
      key: apiKeyRef.current,
    });
    if (!payload) return;
    const attemptGeneration = ++apiAttemptGenerationRef.current;
    const apiAttemptIsCurrent = () => (
      apiAttemptGenerationRef.current === attemptGeneration && managementCanWrite()
    );
    apiBusyRef.current = true;
    setApiBusy(true);
    setApiError("");
    try {
      await invoke("account_add_api_key", payload);
      if (!apiAttemptIsCurrent()) return;
      const emptyMetadata = { provider: "", alias: "" };
      apiMetadataRef.current = emptyMetadata;
      setApiMetadata(emptyMetadata);
      addModeRef.current = "";
      resetPublishedAuthorities();
      setAddMode("");
      void relist();
    } catch (error) {
      if (!apiAttemptIsCurrent()) return;
      setApiError(harnessManageFailureMessage(harnessRosterErrorCode(error)));
    } finally {
      /* Every attempt wipes its own short-lived payload. Only the current
         generation may touch the ref/DOM/rendered state: an older settlement
         cannot erase a newer secret or close its panel after reactivation. */
      payload.api_key = "";
      if (apiAttemptIsCurrent()) {
        apiKeyRef.current = "";
        if (apiKeyInputRef.current) apiKeyInputRef.current.value = "";
        apiBusyRef.current = false;
        setApiKeyPresent(false);
        setApiBusy(false);
      }
    }
  }, [managementCanWrite, relist, resetPublishedAuthorities]);

  const requestRemove = useCallback((descriptor, revision) => {
    commitRemoveState(harnessRemoveRequest(
      removeStateRef.current,
      harnessAccountAlias(descriptor),
      revision,
    ));
  }, [commitRemoveState]);

  const dismissRemove = useCallback(() => {
    commitRemoveState(harnessRemoveDismiss(removeStateRef.current));
  }, [commitRemoveState]);

  const confirmRemove = useCallback(() => {
    const { state: next, payload } = harnessRemoveBegin(removeStateRef.current);
    commitRemoveState(next);
    if (!payload) return;
    const removeAttempt = next;
    invoke("account_remove", {
      alias: payload.alias,
      expected_revision: payload.expected_revision,
    }).then(() => {
      const settled = harnessRemoveOnResult(removeAttempt);
      if (managementCanWrite() && removeStateRef.current === removeAttempt) {
        commitRemoveState(settled.state);
      }
      /* The chip disappears only when account_list stops publishing it —
         never by a local splice ahead of the daemon's confirmation. */
      if (settled.relist) void relist();
    }).catch(async (error) => {
      if (!managementCanWrite() || removeStateRef.current !== removeAttempt) return;
      const failed = harnessRemoveOnError(removeAttempt, error);
      commitRemoveState(failed.state);
      if (!failed.relist) return;
      const refreshed = await relist();
      if (managementCanWrite() && removeStateRef.current === failed.state) {
        commitRemoveState(harnessRemoveOnRefreshResult(failed.state, refreshed));
      }
    });
  }, [commitRemoveState, managementCanWrite, relist]);

  const toggleAddPanel = useCallback(() => {
    const next = addModeRef.current ? "" : "oauth";
    if (!next) clearApiKeySecret();
    resetPublishedAuthorities();
    addModeRef.current = next;
    if (managementCanWrite()) setAddMode(next);
  }, [clearApiKeySecret, managementCanWrite, resetPublishedAuthorities]);

  const selectAddMode = useCallback((nextMode) => {
    const next = nextMode === "oauth" || nextMode === "api_key" ? nextMode : "";
    if (addModeRef.current === "api_key" && next !== "api_key") clearApiKeySecret();
    if (addModeRef.current !== next) resetPublishedAuthorities();
    addModeRef.current = next;
    if (managementCanWrite()) setAddMode(next);
  }, [clearApiKeySecret, managementCanWrite, resetPublishedAuthorities]);

  const closeAddPanel = useCallback(() => {
    cancelOauth();
    clearApiKeySecret();
    resetPublishedAuthorities();
    setApiError("");
    addModeRef.current = "";
    setAddMode("");
  }, [cancelOauth, clearApiKeySecret, resetPublishedAuthorities]);

  const oauthProviders = useMemo(
    () => providerAuthOptions(libraryState.library, "oauth"),
    [libraryState.library],
  );
  const apiProviders = useMemo(
    () => providerAuthOptions(libraryState.library, "api_key"),
    [libraryState.library],
  );

  return {
    addMode,
    setAddMode: selectAddMode,
    toggleAddPanel,
    closeAddPanel,
    libraryState,
    oauthProviders,
    apiProviders,
    catalogPresentation: harnessImportCatalogPresentation(catalog),
    addFlow,
    oauthDraft,
    setOauthDraft,
    startOauth,
    cancelOauth,
    dismissAddFlow,
    openOauthAuthorization,
    importState,
    importSource,
    dismissImport,
    apiMetadata,
    apiKeyInputRef,
    apiKeyPresent,
    apiBusy,
    apiError,
    editApiMetadata,
    editApiKey,
    submitApiKey,
    removeState,
    requestRemove,
    dismissRemove,
    confirmRemove,
  };
}
/* ---- end harness account management wiring ---- */

function scheduleTokenomicsIdleTask(callback, { delay_ms: delayMs = 0, timeout = 1200 } = {}) {
  if (typeof window === "undefined") {
    callback();
    return () => {};
  }

  let cancelled = false;
  let frame = 0;
  let idle = 0;
  let timer = 0;

  const run = () => {
    if (!cancelled) {
      callback();
    }
  };

  const scheduleIdle = () => {
    if (cancelled) {
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout });
      return;
    }
    timer = window.setTimeout(run, delayMs);
  };

  if (typeof window.requestAnimationFrame === "function") {
    frame = window.requestAnimationFrame(scheduleIdle);
  } else {
    timer = window.setTimeout(scheduleIdle, delayMs);
  }

  return () => {
    cancelled = true;
    if (frame && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frame);
    }
    if (idle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idle);
    }
    if (timer) {
      window.clearTimeout(timer);
    }
  };
}

function createTokenomicsStoreState() {
  return {
    summary: null,
    status: "loading",
    error: "",
    selectedProvider: "all",
    selectedProviderAccountKeys: createDefaultProviderAccountKeys(),
    selectedDeviceId: "all",
  };
}

function createDefaultProviderAccountKeys() {
  return HISTORICAL_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
    acc[providerId] = "all";
    return acc;
  }, {});
}

function normalizeProviderAccountKey(value) {
  return String(value || "all").trim() || "all";
}

function providerAccountKeyIsUnknown(value) {
  const key = String(value || "").trim().toLowerCase();
  return !key || key.endsWith(":unknown");
}

function normalizeProviderAccountLabel(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeTokenomicsEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function tokenomicsEmailLocalPart(value) {
  return normalizeTokenomicsEmail(value).split("@")[0] || "";
}

function normalizeTokenomicsAliasLabel(value, providerId = "") {
  let label = normalizeProviderAccountLabel(value)
    .replace(/[·•]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const providerWords = providerId === "claude"
    ? ["claude code", "claude", "anthropic"]
    : providerId === "codex"
      ? ["codex", "openai"]
      : [];
  for (const word of providerWords) {
    if (label === word) return "";
    if (label.startsWith(`${word} `)) {
      label = label.slice(word.length).trim();
      break;
    }
  }
  return label;
}

function tokenomicsProfileLabelCandidates(profile = {}, providerId = "") {
  const email = normalizeTokenomicsEmail(profile?.email || profile?.identity?.email);
  const local = tokenomicsEmailLocalPart(email);
  const raw = [
    profile?.alias,
    profile?.label,
    profile?.name,
    email,
    local,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const labels = new Set();
  for (const value of raw) {
    labels.add(normalizeProviderAccountLabel(value));
    labels.add(normalizeTokenomicsAliasLabel(value, providerId));
    if (providerId === "claude") {
      labels.add(normalizeTokenomicsAliasLabel(`Claude ${value}`, providerId));
      labels.add(normalizeTokenomicsAliasLabel(`Claude Code ${value}`, providerId));
    } else if (providerId === "codex") {
      labels.add(normalizeTokenomicsAliasLabel(`Codex ${value}`, providerId));
    }
  }
  labels.delete("");
  labels.delete("default");
  return [...labels];
}

function tokenomicsAccountLabelScore(label, providerId = "") {
  const raw = String(label || "").trim();
  const clean = normalizeTokenomicsAliasLabel(label, providerId);
  if (!clean || clean === "default" || clean === "account") return 0;
  if (clean.includes("@")) return 1;
  if (/[A-Z]/u.test(raw) && /[a-z]/u.test(raw)) return 5;
  if (/[\s-]/u.test(clean) && /[a-z]/iu.test(clean) && !/\d/u.test(clean)) return 4;
  if (/^[a-z0-9._-]+$/iu.test(clean)) return 2;
  return 4;
}

function preferredTokenomicsAccountLabel(nextLabel, currentLabel, providerId = "") {
  const next = String(nextLabel || "").trim();
  const current = String(currentLabel || "").trim();
  if (!current) return next;
  if (!next) return current;
  const nextScore = tokenomicsAccountLabelScore(next, providerId);
  const currentScore = tokenomicsAccountLabelScore(current, providerId);
  if (nextScore !== currentScore) return nextScore > currentScore ? next : current;
  return next.length < current.length ? next : current;
}

function normalizeProviderAccountKeys(value, fallbackKey = "all") {
  const fallback = normalizeProviderAccountKey(fallbackKey);
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return HISTORICAL_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
    acc[providerId] = normalizeProviderAccountKey(source[providerId] || fallback);
    return acc;
  }, {});
}

function accountKeyForProvider(accountKeys, providerId) {
  if (accountKeys && typeof accountKeys === "object" && !Array.isArray(accountKeys)) {
    return normalizeProviderAccountKey(accountKeys[providerId]);
  }
  return normalizeProviderAccountKey(accountKeys);
}

function accountFilterIsAll(selectedProvider, accountKeys) {
  if (selectedProvider === "all") {
    return HISTORICAL_ACCOUNT_FILTER_PROVIDERS.every((providerId) => accountKeyForProvider(accountKeys, providerId) === "all");
  }
  return accountKeyForProvider(accountKeys, selectedProvider) === "all";
}

function rowMatchesAccountFilter(row, selectedProvider, accountKeys) {
  const providerId = selectedProvider === "all" ? providerKey(row) : selectedProvider;
  const selectedAccountKey = accountKeyForProvider(accountKeys, providerId);
  if (selectedAccountKey === TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE) return false;
  return selectedAccountKey === "all" || rowProviderAccountKey(row) === selectedAccountKey;
}

const TOKENOMICS_DEFAULT_ACCOUNT_KEY = "local-account";

function normalizeTokenomicsAccountKey(accountKey) {
  return String(accountKey || TOKENOMICS_DEFAULT_ACCOUNT_KEY).trim() || TOKENOMICS_DEFAULT_ACCOUNT_KEY;
}

function providerAccent(provider) {
  return PROVIDER_ACCENTS[provider] || "#60a5fa";
}

function formatCreditBytes(value) {
  const bytes = numeric(value);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function storageByteValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return number;
    }
  }
  return 0;
}

function tokenomicsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function tokenomicsObjectHasAny(value, keys = []) {
  const object = tokenomicsObject(value);
  if (!object) return false;
  return keys.some((key) => object[key] != null && object[key] !== "");
}

function storageUsageHasMeaningfulData(storageUsage) {
  const raw = tokenomicsObject(storageUsage);
  if (!raw) return false;
  const usage = tokenomicsObject(raw.usage);
  return Boolean(
    raw.known === true
      || usage
      || tokenomicsObjectHasAny(raw, [
        "totalBytes",
        "total_bytes",
        "totalUsedBytes",
        "total_used_bytes",
        "sqliteBytes",
        "sqlite_bytes",
        "sqliteUsedBytes",
        "sqlite_used_bytes",
        "assetsBytes",
        "assets_bytes",
        "assetsUsedBytes",
        "assets_used_bytes",
      ])
  );
}

function formatStorageBytes(value) {
  const bytes = storageByteValue(value);
  const mib = 1024 ** 2;
  const gib = 1024 ** 3;
  if (bytes <= 0) return "0 GB";
  if (bytes >= gib) {
    const amount = bytes / gib;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)} GB`;
  }
  if (bytes >= mib) return `${Math.round(bytes / mib)} MB`;
  return formatCreditBytes(bytes) || "0 GB";
}

function storageLimitsForPlan(planName) {
  const normalized = String(planName || "").trim().toLowerCase();
  if (normalized === "ultra") {
    return { total_bytes: 250 * 1024 ** 3, sqlite_bytes: 50 * 1024 ** 3, assets_bytes: 200 * 1024 ** 3 };
  }
  if (normalized === "pro") {
    return { total_bytes: 50 * 1024 ** 3, sqlite_bytes: 15 * 1024 ** 3, assets_bytes: 35 * 1024 ** 3 };
  }
  if (normalized === "plus") {
    return { total_bytes: 10 * 1024 ** 3, sqlite_bytes: 3 * 1024 ** 3, assets_bytes: 7 * 1024 ** 3 };
  }
  return { total_bytes: 0, sqlite_bytes: 0, assets_bytes: 0 };
}

function storageUsageModel(billingStatus = {}, liveStorageUsage = null) {
  const planName = String(
    billingStatusPlanName(billingStatus)
      || liveStorageUsage?.planName
      || liveStorageUsage?.plan_name
      || "free",
  ).trim().toLowerCase();
  const raw = liveStorageUsage
    || billingStatus?.storage?.usage
    || {};
  const usage = raw?.usage || raw || {};
  const fallback = storageLimitsForPlan(planName);
  const explicitLimits = raw?.limits
    || billingStatus?.storage?.limits
    || billingStatus?.entitlements?.storage
    || billingStatus?.limits?.storage
    || billingStatus?.user?.entitlements?.storage
    || {};
  const limits = {
    total_bytes: storageByteValue(explicitLimits.totalBytes, explicitLimits.total_bytes, fallback.total_bytes),
    sqlite_bytes: storageByteValue(explicitLimits.sqliteBytes, explicitLimits.sqlite_bytes, fallback.sqlite_bytes),
    assets_bytes: storageByteValue(explicitLimits.assetsBytes, explicitLimits.assets_bytes, fallback.assets_bytes),
  };
  const rows = [
    {
      key: "total",
      label: "Total",
      used: storageByteValue(usage.totalBytes, usage.total_bytes, raw.totalUsedBytes, raw.total_used_bytes),
      limit: limits.total_bytes,
    },
    {
      key: "sqlite",
      label: "SQLite",
      used: storageByteValue(usage.sqliteBytes, usage.sqlite_bytes, raw.sqliteUsedBytes, raw.sqlite_used_bytes),
      limit: limits.sqlite_bytes,
    },
    {
      key: "assets",
      label: "Assets",
      used: storageByteValue(usage.assetsBytes, usage.assets_bytes, raw.assetsUsedBytes, raw.assets_used_bytes),
      limit: limits.assets_bytes,
    },
  ].map((row) => ({
    ...row,
    percent: row.limit > 0 ? Math.min(100, Math.max(0, Math.round((row.used / row.limit) * 100))) : 0,
  }));
  return {
    known: Boolean(storageUsageHasMeaningfulData(raw) || storageUsageHasMeaningfulData(billingStatus?.storage?.usage)),
    rows,
  };
}

function providerLabel(row) {
  const key = providerKey(row);
  return PROVIDER_LABELS[key] || PROVIDER_LABELS[String(row?.provider || "").toLowerCase()] || row?.label || "Agent";
}

function providerDisplayName(providerId) {
  if (providerId === "codex") return "Codex";
  if (providerId === "claude") return "Claude Code";
  if (providerId === "haider-code") return "Haider Code";
  return PROVIDERS.find((provider) => provider.id === providerId)?.label || providerId || "Provider";
}

function providerAccountHeading(providerId) {
  if (providerId === "codex") return "Codex";
  if (providerId === "claude") return "Claude";
  return providerDisplayName(providerId);
}

function tokenomicsDeviceIdentityRows(summary = {}) {
  const value = summary && typeof summary === "object" ? summary : {};
  return [
    ...(Array.isArray(value.device_identities) ? value.device_identities : []),
    ...(Array.isArray(value.deviceIdentities) ? value.deviceIdentities : []),
    ...(Array.isArray(value.devices) ? value.devices : []),
    ...(Array.isArray(value.device_aliases) ? value.device_aliases : []),
    ...(Array.isArray(value.deviceAliases) ? value.deviceAliases : []),
  ];
}

function tokenomicsDeviceIdentityLabel(identity = {}) {
  return String(
    identity?.display_name || identity?.label || identity?.device_name || identity?.machine_name || identity?.hostname || identity?.name || "",
  ).trim();
}

function tokenomicsDeviceIdentityIds(identity = {}) {
  return [
    rowDeviceId(identity),
    identity?.id,
    identity?.device_id,
    identity?.machine_id,
    identity?.native_device_id,
    identity?.target_device_id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function tokenomicsIndexKey(providerId, value) {
  const clean = String(value || "").trim();
  return clean ? `${providerId}\u0000${clean}` : "";
}

function tokenomicsEmailGroupId(providerId, email) {
  return `${providerId}:email:${email}`;
}

function tokenomicsEnsureAccountGroup(groups, providerId, email) {
  const groupId = tokenomicsEmailGroupId(providerId, email);
  let group = groups.get(groupId);
  if (!group) {
    group = {
      id: groupId,
      provider_id: providerId,
      email,
      label: tokenomicsEmailLocalPart(email) || email,
      keys: new Set(),
      keyTotals: new Map(),
    };
    groups.set(groupId, group);
  }
  return group;
}

function tokenomicsAccountRowIsActive(row = {}) {
  return row?.active_provider_account === true || row?.active_agent_profile === true;
}

function tokenomicsAddGroupKey(index, group, key, total = 0) {
  const clean = String(key || "").trim();
  if (!clean || providerAccountKeyIsUnknown(clean)) return;
  group.keys.add(clean);
  group.keyTotals.set(clean, (group.keyTotals.get(clean) || 0) + Math.max(0, numeric(total)));
  index.byKey.set(tokenomicsIndexKey(group.provider_id, clean), group);
}

function tokenomicsAddGroupLabel(index, group, label) {
  const normalized = normalizeProviderAccountLabel(label);
  const stripped = normalizeTokenomicsAliasLabel(label, group.provider_id);
  [normalized, stripped].filter(Boolean).forEach((candidate) => {
    const key = tokenomicsIndexKey(group.provider_id, candidate);
    registerTokenomicsIdentityAlias(index.byLabel, index.ambiguousLabels, key, group);
  });
}

function tokenomicsAccountRowsFromSummary(summary = {}) {
  const rows = [];
  if (!summary || typeof summary !== "object") return rows;
  Object.values(summary).forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((row) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        if (
          rowProviderAccountKey(row) || row?.provider_account_label || row?.subscription_key
        ) {
          rows.push(row);
        }
      }
    });
  });
  return rows;
}

function buildTokenomicsAccountIdentityIndex(agentAccounts) {
  const groups = new Map();
  const index = {
    groups,
    byKey: new Map(),
    byLabel: new Map(),
    ambiguousLabels: new Set(),
    byProfileId: new Map(),
    activeByProvider: new Map(),
    providerGroupCount: new Map(),
  };
  for (const providerId of HISTORICAL_ACCOUNT_FILTER_PROVIDERS) {
    const entry = agentAccounts?.[providerId];
    const profiles = Array.isArray(entry?.profiles) ? entry.profiles : [];
    const uniqueProfileLabels = uniqueTokenomicsAliasesByOwner(
      profiles.map((profile) => ({
        owner: normalizeTokenomicsEmail(profile?.email || profile?.identity?.email),
        aliases: tokenomicsProfileLabelCandidates(profile, providerId),
      })),
    );
    // Provider-side display names are not unique across accounts — only use
    // one as a row-matching alias when a single profile claims it.
    const displayNameCounts = new Map();
    for (const profile of profiles) {
      const name = normalizeProviderAccountLabel(profile?.identity?.display_name);
      if (name) displayNameCounts.set(name, (displayNameCounts.get(name) || 0) + 1);
    }
    for (const profile of profiles) {
      const email = normalizeTokenomicsEmail(profile?.email || profile?.identity?.email);
      if (!email) continue;
      const group = tokenomicsEnsureAccountGroup(groups, providerId, email);
      const label = profile?.alias || (!profile?.is_default ? profile?.label : "") || tokenomicsEmailLocalPart(email) || email;
      group.label = preferredTokenomicsAccountLabel(label, group.label, providerId);
      if (providerId === "claude") {
        // Claude registry labels name accounts exactly like the accounts
        // settings UI; row labels (oauth display names, "Claude · x"
        // fallbacks) must never override them during the summary passes.
        // Other providers keep the historical row-label preference.
        group.labelPinned = true;
      }
      const profileId = String(profile?.id || "").trim();
      if (profileId) {
        index.byProfileId.set(tokenomicsIndexKey(providerId, profileId), group);
      }
      tokenomicsAddGroupKey(index, group, tokenomicsProviderProfileAccountKey(providerId, profile?.id));
      tokenomicsProfileLabelCandidates(profile, providerId).forEach((candidate) => {
        if (uniqueProfileLabels.has(candidate)) {
          tokenomicsAddGroupLabel(index, group, candidate);
        } else {
          [
            normalizeProviderAccountLabel(candidate),
            normalizeTokenomicsAliasLabel(candidate, providerId),
          ].filter(Boolean).forEach((ambiguous) => {
            index.ambiguousLabels.add(tokenomicsIndexKey(providerId, ambiguous));
          });
        }
      });
      const displayName = normalizeProviderAccountLabel(profile?.identity?.display_name);
      if (displayName && displayNameCounts.get(displayName) === 1) {
        tokenomicsAddGroupLabel(index, group, profile.identity.display_name);
      }
      if (profile?.is_active) {
        index.activeByProvider.set(providerId, group);
      }
    }
    // OAuth keys belong to the identity email observed beside the key, not
    // blindly to the registry email. Process matching-email claims first so a
    // stale pushed/legacy profile can never win ownership through registry
    // order; mismatches still get a correctly labeled identity-email group.
    prioritizedTokenomicsIdentityKeyClaims(profiles).forEach((claim) => {
      const group = tokenomicsEnsureAccountGroup(groups, providerId, claim.ownerEmail);
      const owner = index.byKey.get(tokenomicsIndexKey(providerId, claim.key));
      if (!owner || owner === group) {
        tokenomicsAddGroupKey(index, group, claim.key);
      }
    });
  }
  for (const group of groups.values()) {
    index.providerGroupCount.set(group.provider_id, (index.providerGroupCount.get(group.provider_id) || 0) + 1);
  }
  return groups.size ? index : null;
}

function tokenomicsResolveAccountGroup(row, index) {
  if (!index) return null;
  const providerId = providerKey(row);
  if (!HISTORICAL_ACCOUNT_FILTER_PROVIDERS.includes(providerId)) return null;
  const key = rowProviderAccountKey(row);
  const byKey = index.byKey.get(tokenomicsIndexKey(providerId, key));
  if (byKey) return byKey;
  const profileId = tokenomicsRowAgentProfileId(row);
  if (profileId) {
    const byProfileId = index.byProfileId.get(tokenomicsIndexKey(providerId, profileId));
    if (byProfileId) return byProfileId;
    const profileKey = tokenomicsProviderProfileAccountKey(providerId, profileId);
    const byProfileKey = index.byKey.get(tokenomicsIndexKey(providerId, profileKey));
    if (byProfileKey) return byProfileKey;
  }
  if (tokenomicsAccountRowIsActive(row)) {
    const active = index.activeByProvider.get(providerId);
    if (active) return active;
  }
  const rawLabel = rowProviderAccountLabel(row);
  const labels = [
    normalizeProviderAccountLabel(rawLabel),
    normalizeTokenomicsAliasLabel(rawLabel, providerId),
  ].filter(Boolean);
  for (const label of labels) {
    const byLabel = index.byLabel.get(tokenomicsIndexKey(providerId, label));
    if (byLabel) return byLabel;
  }
  const labelEmail = normalizeTokenomicsEmail(String(rawLabel || "").match(/[^\s<>]+@[^\s<>]+/u)?.[0]);
  if (labelEmail) {
    const byEmail = index.groups.get(tokenomicsEmailGroupId(providerId, labelEmail));
    if (byEmail) return byEmail;
  }
  if (index.providerGroupCount.get(providerId) === 1) {
    return [...index.groups.values()].find((group) => group.provider_id === providerId) || null;
  }
  return null;
}

function tokenomicsCanonicalAccountKey(group) {
  if (!group) return "";
  const keys = [...group.keys].filter((key) => !providerAccountKeyIsUnknown(key));
  if (!keys.length) return "";
  return keys.sort((left, right) => {
    const leftProfile = left.includes(":profile:");
    const rightProfile = right.includes(":profile:");
    if (leftProfile !== rightProfile) return leftProfile ? 1 : -1;
    const totalDelta = (group.keyTotals.get(right) || 0) - (group.keyTotals.get(left) || 0);
    if (totalDelta) return totalDelta;
    return left.localeCompare(right);
  })[0];
}

function tokenomicsCanonicalizeAccountRow(row, index) {
  const group = tokenomicsResolveAccountGroup(row, index);
  if (!group) return row;
  const canonicalKey = tokenomicsCanonicalAccountKey(group);
  if (!canonicalKey) return row;
  const label = group.label || rowProviderAccountLabel(row);
  return {
    ...row,
    provider_account_key: canonicalKey,
    provider_account_label: label,
  };
}

function canonicalizeTokenomicsAccountSummary(summary = {}, agentAccounts = null) {
  const index = buildTokenomicsAccountIdentityIndex(agentAccounts);
  if (!index || !summary || typeof summary !== "object") return summary;
  const rows = tokenomicsAccountRowsFromSummary(summary);
  for (let pass = 0; pass < 2; pass += 1) {
    rows.forEach((row) => {
      const group = tokenomicsResolveAccountGroup(row, index);
      if (!group) return;
      const key = rowProviderAccountKey(row);
      tokenomicsAddGroupKey(index, group, key, rowTotal(row));
      if (!group.labelPinned) {
        group.label = preferredTokenomicsAccountLabel(rowProviderAccountLabel(row), group.label, group.provider_id);
      }
      tokenomicsAddGroupLabel(index, group, rowProviderAccountLabel(row));
    });
  }
  return Object.fromEntries(Object.entries(summary).map(([key, value]) => {
    if (!Array.isArray(value)) return [key, value];
    return [key, value.map((row) => (
      row && typeof row === "object" && !Array.isArray(row)
        ? tokenomicsCanonicalizeAccountRow(row, index)
        : row
    ))];
  }));
}

function tokenomicsIdentityLooksNative(identity = {}) {
  if (!identity || typeof identity !== "object") return false;
  if (identity.current === true || identity.current === "true") return true;
  const clientKind = [
    identity.client_kind,
    identity.source,
    identity.agent_id,
  ].map((value) => String(value || "").trim()).join(" ").toLowerCase();
  const platformAndForm = [
    identity.platform,
    identity.os,
    identity.form_factor,
    identity.device_type,
  ].map((value) => String(value || "").trim()).join(" ").toLowerCase();
  const nativeRuntime = ["native", "desktop", "tauri", "rust"].some((token) => clientKind.includes(token));
  const webOnly = clientKind.includes("web") && !nativeRuntime;
  const mobileOnly = !nativeRuntime
    && ["mobile", "phone", "tablet", "android", "ios"].some((token) => platformAndForm.includes(token));
  return nativeRuntime && !webOnly && !mobileOnly;
}

function mappedNativeDeviceIds(summary = {}) {
  const ids = new Set();
  const currentDeviceId = String(summary?.current_device_id || "").trim();
  if (currentDeviceId) ids.add(currentDeviceId);
  tokenomicsDeviceIdentityRows(summary).forEach((identity) => {
    if (!tokenomicsIdentityLooksNative(identity)) return;
    tokenomicsDeviceIdentityIds(identity).forEach((id) => ids.add(id));
  });
  return ids;
}

function rowsForMappedNativeDevices(rows = [], nativeDeviceIds = new Set()) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    const id = rowDeviceId(row);
    return !id || nativeDeviceIds.has(id);
  });
}

function summaryForMappedNativeDevices(summary = {}) {
  return summary;
}

function summaryArray(summary = {}, ...keys) {
  let fallback = [];
  for (const key of keys) {
    const rows = Array.isArray(summary?.[key]) ? summary[key] : [];
    if (rows.length) return rows;
    if (!fallback.length) fallback = rows;
  }
  return fallback;
}

function summaryIsTokenomicsV2(summary = {}) {
  return String(summary?.schema_version || "").toLowerCase() === "tokenomics_v2";
}

function hourlyRowsForDisplay(summary = {}) {
  return summaryArray(summary, "hourly");
}

function providerRowsForDisplay(summary = {}) {
  const legacy = summaryArray(summary, "by_device_provider");
  return legacy.length ? legacy : hourlyRowsForDisplay(summary);
}

function accountRowsForDisplay(summary = {}) {
  const legacy = summaryArray(summary, "by_device_account");
  return legacy.length ? legacy : hourlyRowsForDisplay(summary);
}

function modelRowsForDisplay(summary = {}) {
  const hourly = hourlyRowsForDisplay(summary);
  if (summaryIsTokenomicsV2(summary)) return hourly;
  const legacy = summaryArray(summary, "by_device_model");
  return legacy.length ? legacy : hourly;
}

function dailyRowsForDisplay(summary = {}) {
  const daily = summaryArray(summary, "daily_by_device_provider", "daily");
  if (daily.length) return daily;
  return hourlyRowsForDisplay(summary);
}

function usageRowsForDisplay(summary = {}) {
  const legacy = [
    ...summaryArray(summary, "by_device"),
    ...summaryArray(summary, "by_device_provider"),
    ...summaryArray(summary, "by_device_account"),
    ...summaryArray(summary, "by_device_model"),
    ...dailyRowsForDisplay(summary),
  ];
  return legacy.length ? legacy : hourlyRowsForDisplay(summary);
}

function normalizedLimitWindowKind(kind) {
  const clean = String(kind || "").trim().toLowerCase();
  if (["session_5h", "5-hour", "5h", "five_hour", "five-hour"].includes(clean)) return "5_hour";
  return clean;
}

function normalizeLimitRowForDisplay(row = {}) {
  const rawWindowKind = row?.window_kind ?? row?.limit_kind ?? row?.provider_window_kind ?? "";
  const windowKind = normalizedLimitWindowKind(rawWindowKind);
  if (!windowKind || windowKind === rawWindowKind) return row;
  return {
    ...row,
    provider_window_kind: row?.provider_window_kind ?? rawWindowKind,
    window_kind: windowKind,
    limit_kind: windowKind,
  };
}

function limitRowsForDisplay(summary = {}) {
  return [
    ...summaryArray(summary, "limits"),
    ...summaryArray(summary, "latest_windows"),
  ].map(normalizeLimitRowForDisplay);
}

function tokenomicsDeviceIdentityMap(summary = {}) {
  const byId = new Map();
  tokenomicsDeviceIdentityRows(summary).forEach((identity) => {
    const label = tokenomicsDeviceIdentityLabel(identity);
    [...new Set(tokenomicsDeviceIdentityIds(identity))].forEach((id) => {
      const current = byId.get(id) || {};
      byId.set(id, {
        ...current,
        ...identity,
        display_name: label || current.display_name || "",
      });
    });
  });
  return byId;
}

function genericDeviceLabel(deviceId) {
  const lower = String(deviceId || "").toLowerCase();
  if (lower.includes("windows") || lower.startsWith("win")) return "Windows PC";
  if (lower.includes("macos") || lower.includes("macbook") || lower.startsWith("mac")) return "Mac device";
  if (lower.includes("linux")) return "Linux device";
  const clean = String(deviceId || "").trim();
  const suffix = clean.length > 10 ? `${clean.slice(0, 6)}...${clean.slice(-4)}` : clean || "unknown";
  return `Device ${suffix}`;
}

function dedupeDeviceLabels(devices) {
  const counts = new Map();
  devices.forEach((device) => counts.set(device.label, (counts.get(device.label) || 0) + 1));
  const seen = new Map();
  return devices.map((device) => {
    if (device.current || counts.get(device.label) <= 1) return device;
    const next = (seen.get(device.label) || 0) + 1;
    seen.set(device.label, next);
    return { ...device, label: `${device.label} ${next}` };
  });
}

function deviceLabel(deviceId, currentDeviceId = "", identityMap = new Map()) {
  if (!deviceId) return "Unknown device";
  const identityLabel = tokenomicsDeviceIdentityLabel(identityMap.get(deviceId));
  if (identityLabel) return identityLabel;
  return genericDeviceLabel(deviceId);
}

function filterRows(rows, selectedProvider, selectedAccountKeys = "all", selectedDeviceId = "all", selectedScopeKey = "all") {
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  return rows.filter((row) => (
    provider.match(row)
      && rowMatchesAccountFilter(row, selectedProvider, selectedAccountKeys)
      && (selectedDeviceId === "all" || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
}

function aggregateRows(rows) {
  return rows.reduce(
    (acc, row) => ({
      input: acc.input + rowInput(row),
      output: acc.output + rowOutput(row),
      cache: acc.cache + rowCache(row),
      total: acc.total + rowActivityTokens(row),
      cost: acc.cost + rowCost(row),
      events: acc.events + numeric(row?.event_count),
    }),
    { input: 0, output: 0, cache: 0, total: 0, cost: 0, events: 0 },
  );
}

function bucketDayKey(row) {
  const raw = row?.bucket_start || row?.bucket_day;
  if (!raw) return "";
  const value = String(raw);
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dayKeyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromDayKey(key) {
  return new Date(`${key}T00:00:00Z`);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function compactDayLabel(key) {
  return dateFromDayKey(key)
    .toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })
    .slice(0, 1);
}

function fullDayLabel(key, todayKey) {
  const today = dateFromDayKey(todayKey);
  const yesterdayKey = dayKeyUtc(addUtcDays(today, -1));
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return dateFromDayKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function weeklyLimitUsedPercent(row = {}) {
  return limitNumberOrNull(
    row.used_percent,
    row.limit_used_percent,
    row.used,
  );
}

function weeklyLimitRowTime(row = {}) {
  return parseLimitTimestamp(
    row.sample_at ?? row.sample_bucket_start ?? row.sample_observed_at ?? row.limit_observed_at ?? row.updated_at ?? row.last_known_at,
  );
}

function weeklyLimitRowResetKey(row = {}) {
  return String(row.reset_at ?? row.limit_resets_at ?? "");
}

function weeklyLimitSeriesKey(row = {}) {
  return [rowScopeKey(row), rowDeviceId(row) || "unknown-device", providerKey(row), rowProviderAccountKey(row)].join("::");
}

function matchingWeeklyLimitRows(rows, selectedProvider, selectedAccountKeys, selectedDeviceId = "all", selectedScopeKey = "all") {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    normalizedLimitWindowKind(row?.window_kind || row?.limit_kind || "") === "weekly"
      && (selectedProvider === "all" || providerKey(row) === selectedProvider)
      && rowMatchesAccountFilter(row, selectedProvider, selectedAccountKeys)
      && (selectedDeviceId === "all" || !rowDeviceId(row) || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
}

function directDailyWeeklyLimitPercents(limitSamples, selectedProvider, selectedAccountKeys, selectedDeviceId = "all", selectedScopeKey = "all") {
  const bySeries = new Map();
  for (const row of matchingWeeklyLimitRows(limitSamples, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey)) {
    const used = weeklyLimitUsedPercent(row);
    const time = weeklyLimitRowTime(row);
    if (used == null || !time) continue;
    const key = weeklyLimitSeriesKey(row);
    const series = bySeries.get(key) || [];
    series.push({
      day: dayKeyUtc(time),
      resetKey: weeklyLimitRowResetKey(row),
      time: time.getTime(),
      used: Math.max(0, Math.min(100, used)),
    });
    bySeries.set(key, series);
  }

  const byDay = new Map();
  for (const series of bySeries.values()) {
    series.sort((left, right) => left.time - right.time);
    let windowEntries = [];
    const flushWindow = () => {
      const latest = windowEntries[windowEntries.length - 1];
      if (latest?.used > 0) {
        byDay.set(latest.day, Math.max(byDay.get(latest.day) || 0, latest.used));
      }
      windowEntries = [];
    };
    for (const entry of series) {
      const previous = windowEntries[windowEntries.length - 1] || null;
      const sameWindow = previous
        ? (!entry.resetKey || !previous.resetKey || entry.resetKey === previous.resetKey)
        : true;
      if (previous && (!sameWindow || entry.used < previous.used)) {
        flushWindow();
      }
      windowEntries.push(entry);
    }
    flushWindow();
  }
  return byDay;
}

function withDailyWeeklyLimitPercents(rows, limitSamples, limits, selectedProvider, selectedAccountKeys, selectedDeviceId = "all", selectedScopeKey = "all") {
  const directPercents = directDailyWeeklyLimitPercents(limitSamples, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
  const withDirectPercents = rows.map((row) => {
    const weeklyLimitPercent = directPercents.get(row.key);
    return {
      ...row,
      weeklyLimitPercent: weeklyLimitPercent == null ? null : Math.max(0, Math.min(100, weeklyLimitPercent)),
      weeklyLimitPercentEstimated: false,
    };
  });
  return withDailyTokenReferenceLimitPercents(withDirectPercents);
}

function dailyTokenReferencePercentPerToken(rows) {
  return rows.reduce((highest, row) => {
    const total = dailyUsageValue(row);
    const percent = limitNumberOrNull(row?.weeklyLimitPercent);
    if (total <= 0 || percent == null || percent <= TOKENOMICS_DAILY_WARN_LIMIT_PERCENT) {
      return highest;
    }
    const percentPerToken = percent / total;
    return Number.isFinite(percentPerToken) ? Math.max(highest, percentPerToken) : highest;
  }, 0);
}

function withDailyTokenReferenceLimitPercents(rows) {
  const percentPerToken = dailyTokenReferencePercentPerToken(rows);
  if (!(percentPerToken > 0)) return rows;
  return rows.map((row) => {
    if (limitNumberOrNull(row?.weeklyLimitPercent) != null) return row;
    const total = dailyUsageValue(row);
    if (total <= 0) return row;
    const estimatedPercent = Math.max(0, Math.min(100, total * percentPerToken));
    if (estimatedPercent <= TOKENOMICS_DAILY_WARN_LIMIT_PERCENT) return row;
    return {
      ...row,
      weeklyLimitPercent: estimatedPercent,
      weeklyLimitPercentEstimated: true,
    };
  });
}

function buildDailyRows(dailyRows, limitSamples, limits, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all", windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const filtered = filterRows(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
  const byDay = new Map();
  for (const row of filtered) {
    const key = bucketDayKey(row);
    if (!key) continue;
    const current = byDay.get(key) || { key, rows: [] };
    current.rows.push(row);
    byDay.set(key, current);
  }

  const todayKey = dayKeyUtc(new Date());
  const latestDataKey = [...byDay.keys()].sort().pop() || todayKey;
  const endKey = latestDataKey > todayKey ? latestDataKey : todayKey;
  const endDate = dateFromDayKey(endKey);
  const buckets = [];
  for (let offset = Math.max(1, windowDays) - 1; offset >= 0; offset -= 1) {
    const date = addUtcDays(endDate, -offset);
    const key = dayKeyUtc(date);
    const match = byDay.get(key);
    const aggregate = aggregateRows(match?.rows || []);
    buckets.push({
      key,
      ...aggregate,
      /* Kept for the tri-state daily presentation: a bucket with no rows is
         "no usage recorded", never a measured zero, and a bucket whose rows
         are all pre-ledger archive is labelled as archive. */
      rows: match?.rows || [],
    });
  }
  const rows = buckets.map((row) => ({
    ...row,
    label: compactDayLabel(row.key),
    titleLabel: fullDayLabel(row.key, todayKey),
  }));
  return withDailyWeeklyLimitPercents(rows, limitSamples, limits, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
}

function rollingWindowAggregate(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all", windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const today = dateFromDayKey(dayKeyUtc(new Date()));
  const startKey = dayKeyUtc(addUtcDays(today, -(Math.max(1, windowDays) - 1)));
  const endKey = dayKeyUtc(today);
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey)
    .filter((row) => {
      const key = bucketDayKey(row);
      return key >= startKey && key <= endKey;
    });
  return { ...aggregateRows(rows), rowCount: rows.length };
}

function todayAggregate(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all") {
  const today = dayKeyUtc(new Date());
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey)
    .filter((row) => bucketDayKey(row) === today);
  return { ...aggregateRows(rows), rowCount: rows.length };
}

function limitNumberOrNull(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function limitTimestampMs(row = {}) {
  return parseLimitTimestamp(
    row.sample_at ?? row.sample_observed_at ?? row.limit_observed_at ?? row.updated_at ?? row.last_known_at,
  )?.getTime() || 0;
}

function filterLimits(limits, selectedProvider, selectedAccountKeys = "all", selectedScopeKey = "all", selectedDeviceId = "all") {
  if (!Array.isArray(limits)) return [];
  return mergeProviderLimitRowsForDisplay(limits.filter((limit) => (
    (selectedProvider === "all" || providerKey(limit) === selectedProvider)
      && rowMatchesAccountFilter(limit, selectedProvider, selectedAccountKeys)
      && (selectedDeviceId === "all" || !rowDeviceId(limit) || rowDeviceId(limit) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(limit) === selectedScopeKey)
  )), selectedDeviceId);
}

function providerLimitUsesActiveAccount(row = {}) {
  return row?.active_provider_account === true || row?.active_agent_profile === true;
}

function activeProviderAccountKeyForLimits(limits, selectedProvider, selectedScopeKey = "all", selectedDeviceId = "all") {
  if (selectedProvider === "all") return "";
  const rows = (Array.isArray(limits) ? limits : []).filter((row) => (
    providerKey(row) === selectedProvider
      && rowProviderAccountKey(row)
      && (selectedDeviceId === "all" || !rowDeviceId(row) || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
  const activeRow = rows.find(providerLimitUsesActiveAccount);
  if (activeRow) return rowProviderAccountKey(activeRow) || "";
  // No active-account tag (e.g. a keychain-based Claude profile publishes no
  // flagged row): fall back to the most recently observed account with live
  // data so the gauge tracks one plan instead of averaging every account.
  const candidates = rows.filter(hasKnownLimitPercent);
  const pool = candidates.length ? candidates : rows;
  const latest = pool.reduce(
    (best, row) => (best == null || limitTimestampMs(row) > limitTimestampMs(best) ? row : best),
    null,
  );
  return rowProviderAccountKey(latest) || "";
}

function limitAccountKeyForDisplay(limits, selectedProvider, selectedAccountKey = "all", selectedScopeKey = "all", selectedDeviceId = "all") {
  if (selectedAccountKey && selectedAccountKey !== "all") {
    return selectedAccountKey;
  }
  return activeProviderAccountKeyForLimits(limits, selectedProvider, selectedScopeKey, selectedDeviceId) || "all";
}

function limitResetDate(limit = {}) {
  const direct = parseLimitTimestamp(limit.reset_at ?? limit.limit_resets_at);
  if (direct) return direct;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds);
  const updatedAt = parseLimitTimestamp(
    limit.limit_observed_at ?? limit.sample_observed_at ?? limit.updated_at ?? limit.last_known_at,
  );
  if (resetAfterSeconds != null && updatedAt) {
    return new Date(updatedAt.getTime() + Math.max(0, resetAfterSeconds) * 1000);
  }
  return null;
}

function hasKnownLimitPercent(limit = {}) {
  return limitNumberOrNull(
    limit.remaining_percent,
    limit.used_percent,
    limit.limit_used_percent,
  ) != null;
}

function limitDisplayPercentKind(limit = {}, fallbackWindowKind = "") {
  const explicit = String(
    limit.display_percent_kind ?? limit.limit_display_percent_kind ?? "",
  ).toLowerCase();
  if (explicit === "remaining" || explicit === "used") return explicit;
  if (providerKey(limit) === "codex" || providerKey(limit) === "claude") return "remaining";
  const windowKind = String(
    fallbackWindowKind || limit.window_kind || limit.limit_kind || "",
  );
  return windowKind === "weekly" ? "remaining" : "used";
}

function limitDisplayPercent(limit = {}, usedPercent = null, remainingPercent = null, fallbackWindowKind = "") {
  const displayKind = limitDisplayPercentKind(limit, fallbackWindowKind);
  const percent = displayKind === "remaining" ? remainingPercent : usedPercent;
  return percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
}

function formatLimitResetDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

function limitResetLabelIsPlaceholder(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return text === "reset time unavailable"
    || text === "resets with provider window"
    || text === "resets on provider schedule"
    || text.includes("provider limit unavailable")
    || text.includes("provider schedule unavailable")
    || text.includes("provider window reset")
    || text.includes("open claude code")
    || text.includes("claude code has not reported");
}

function meaningfulLimitResetLabel(limit = {}) {
  const explicit = String(limit.reset_label || "").trim();
  return explicit && !limitResetLabelIsPlaceholder(explicit) ? explicit : "";
}

function limitHasResetTiming(limit = {}) {
  if (meaningfulLimitResetLabel(limit)) return true;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds);
  if (resetAfterSeconds != null && resetAfterSeconds > 0) return true;
  const resetDate = limitResetDate(limit);
  return Boolean(resetDate && resetDate.getTime() > Date.now());
}

function limitResetReferenceRow(rows = []) {
  const pool = Array.isArray(rows) ? rows : [];
  // A projected "assume fresh" row (client_reset_pending) is a guess: it
  // must not narrate the card's reset timing while live rows exist —
  // otherwise the caption reads "window ended; assuming 100%" beside a real
  // over-pace warning contributed by a live account.
  const live = pool.filter((row) => !row?.client_reset_pending);
  const preferred = live.length ? live : pool;
  const candidates = preferred.filter(limitHasResetTiming);
  const source = candidates.length ? candidates : preferred;
  return [...source].sort((left, right) => {
    const activeDelta = Number(providerLimitUsesActiveAccount(right)) - Number(providerLimitUsesActiveAccount(left));
    if (activeDelta) return activeDelta;
    return limitTimestampMs(right) - limitTimestampMs(left);
  })[0] || {};
}

function computedLimitResetLabel(limit = {}, windowKind = "5_hour") {
  const explicit = meaningfulLimitResetLabel(limit);
  if (explicit) return explicit;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds);
  if (resetAfterSeconds != null && resetAfterSeconds > 0) {
    return `Resets in ${formatLimitResetDuration(resetAfterSeconds)}`;
  }
  const resetDate = limitResetDate(limit);
  if (resetDate) {
    const secondsUntilReset = Math.round((resetDate.getTime() - Date.now()) / 1000);
    if (secondsUntilReset > 0) {
      return `Resets in ${formatLimitResetDuration(secondsUntilReset)}`;
    }
  }
  return windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule";
}

// One account per provider: limit gauges always describe a single plan (the
// active account when tagged, else the freshest live account), never an
// average across every logged-in account of that provider.
function limitDisplayAccountRows(rows) {
  const byProvider = new Map();
  for (const row of rows) {
    const provider = providerKey(row);
    const group = byProvider.get(provider) || [];
    group.push(row);
    byProvider.set(provider, group);
  }
  const kept = [];
  for (const group of byProvider.values()) {
    const accountKeys = new Set(group.map((row) => rowProviderAccountKey(row) || ""));
    if (accountKeys.size <= 1) {
      kept.push(...group);
      continue;
    }
    const activeRows = group.filter(providerLimitUsesActiveAccount);
    const liveRows = group.filter(hasKnownLimitPercent);
    const pool = activeRows.length ? activeRows : (liveRows.length ? liveRows : group);
    const chosen = pool.reduce((best, row) => (limitTimestampMs(row) > limitTimestampMs(best) ? row : best), pool[0]);
    const chosenKey = rowProviderAccountKey(chosen) || "";
    kept.push(...group.filter((row) => (rowProviderAccountKey(row) || "") === chosenKey));
  }
  return kept;
}

function mergeLimits(limits, windowKind, authorityPresentation = null) {
  const normalizedWindowKind = normalizedLimitWindowKind(windowKind);
  const authorityLimit = tokenomicsAuthorityLimit(authorityPresentation, normalizedWindowKind);
  if (authorityLimit) return authorityLimit;
  const rows = limitDisplayAccountRows(
    limits
      .map(normalizeLimitRowForDisplay)
      .filter((limit) => normalizedLimitWindowKind(limit?.window_kind || limit?.limit_kind || "") === normalizedWindowKind),
  ).map((limit) => projectProviderLimitForDisplay(limit));
  if (!rows.length) {
    return {
      window_kind: normalizedWindowKind,
      label: normalizedWindowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit",
      plan_detected: false,
      plan_name: "No plan detected",
      confidence: "unknown",
      remaining_percent: null,
      used_percent: null,
      display_percent: null,
      display_percent_kind: limitDisplayPercentKind({}, windowKind),
      paceDelta: null,
      pace_status: "unknown",
      overPace: false,
      status_label: "Plan limit not exposed",
      reset_label: normalizedWindowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule",
      rate_points: [],
    };
  }
  const used = rows.reduce((sum, row) => sum + numeric(row?.used), 0);
  const allowanceValues = rows.map((row) => numeric(row?.allowance)).filter((value) => value > 0);
  const allowance = allowanceValues.length ? allowanceValues.reduce((sum, value) => sum + value, 0) : null;
  const explicitUsedPercents = rows
    .map((row) => limitNumberOrNull(row?.used_percent, row?.limit_used_percent))
    .filter((value) => value != null);
  const explicitRemainingPercents = rows
    .map((row) => limitNumberOrNull(row?.remaining_percent))
    .filter((value) => value != null);
  const averagePercent = (values) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  const usedPercent = explicitUsedPercents.length
    ? averagePercent(explicitUsedPercents)
    : allowance
      ? Math.max(0, Math.min(100, Math.round((used / allowance) * 100)))
      : null;
  const remainingPercent = explicitRemainingPercents.length
    ? Math.max(0, Math.min(100, averagePercent(explicitRemainingPercents)))
    : (usedPercent == null ? null : Math.max(0, 100 - usedPercent));
  const displayPercentKind = limitDisplayPercentKind(rows[0], normalizedWindowKind);
  const displayPercent = limitDisplayPercent(rows[0], usedPercent, remainingPercent, normalizedWindowKind);
  const paceDelta = averagePercent(rows
    .map((row) => limitNumberOrNull(row?.pace_delta_percent))
    .filter((value) => value != null));
  const plans = [...new Set(rows.map((row) => row?.plan_name).filter(Boolean))];
  const confidences = [...new Set(rows.map((row) => row?.confidence).filter(Boolean))];
  const ratePoints = rows.flatMap((row) => Array.isArray(row?.rate_points) ? (row.rate_points) : []);
  const limitSource = rows.find((row) => row?.limit_source)?.limit_source || "";
  const providerKeys = [...new Set(rows.map(providerKey).filter(Boolean))];
  const claudeUnavailable = isClaudeLimitUnavailable(rows);
  const paceStatus = limitPaceStatus(rows);
  const overPace = paceStatus === "over_pace" || (paceDelta != null && paceDelta > 0);
  const resetReference = limitResetReferenceRow(rows);
  return {
    window_kind: normalizedWindowKind,
    label: rows[0]?.label || (normalizedWindowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit"),
    plan_detected: rows.some((row) => Boolean(row?.plan_detected)),
    plan_name: plans.length ? plans.join(" + ") : "No plan detected",
    confidence: confidences.includes("estimated") ? "estimated" : (confidences[0] || "unknown"),
    limit_source: limitSource,
    providerKeys,
    remaining_percent: remainingPercent,
    used_percent: usedPercent,
    display_percent: displayPercent,
    display_percent_kind: displayPercentKind,
    paceDelta,
    pace_status: paceStatus,
    overPace,
    // A card built ONLY from projected "assume fresh" rows has no observed
    // usage: "Safe at current pace" would be a claim about a pace nobody
    // measured yet.
    status_label: rows.every((row) => row?.client_reset_pending)
      ? "Window ended; usage unknown"
      : limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable, paceStatus),
    reset_label: limitResetLabel(rows, normalizedWindowKind, claudeUnavailable, resetReference),
    rate_points: ratePoints,
    limit_window_seconds: limitNumberOrNull(resetReference?.limit_window_seconds, rows[0]?.limit_window_seconds, rows[0]?.limit_window_seconds) ?? 0,
    reset_after_seconds: limitNumberOrNull(resetReference?.reset_after_seconds, rows[0]?.reset_after_seconds, rows[0]?.reset_after_seconds) ?? 0,
  };
}

function isClaudeLimitUnavailable(rows) {
  return rows.some((row) => {
    if (providerKey(row) !== "claude") return false;
    const source = String(row?.limit_source || "").toLowerCase();
    const confidence = String(row?.confidence || "").toLowerCase();
    const status = String(row?.status_label || "").toLowerCase();
    return source === "claude_statusline_unavailable"
      || source === "not_exposed"
      || confidence === "unknown"
      || status.includes("not exposed")
      || status.includes("unavailable");
  });
}

function truthyLimitValue(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function limitPaceStatus(rows) {
  if (!Array.isArray(rows) || !rows.length) return "unknown";
  if (rows.some((row) => {
    const status = String(row?.pace_status || "").toLowerCase();
    return status === "over_pace" || truthyLimitValue(row?.pace_exhausts_before_reset);
  })) {
    return "over_pace";
  }
  if (rows.some((row) => String(row?.pace_status || "").toLowerCase() === "on_pace")) {
    return "on_pace";
  }
  return "unknown";
}

function limitResetLabel(rows, windowKind, claudeUnavailable, resetReference = null) {
  const reference = resetReference || limitResetReferenceRow(rows);
  const explicit = meaningfulLimitResetLabel(reference);
  if (!claudeUnavailable) {
    const current = computedLimitResetLabel(reference, windowKind);
    return current || (windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule");
  }
  if (limitHasResetTiming(reference)) {
    const current = computedLimitResetLabel(reference, windowKind);
    if (current && !limitResetLabelIsPlaceholder(current)) return current;
  }
  const rawExplicit = String(reference?.reset_label || "").trim();
  if (!rawExplicit || rawExplicit.includes("Provider limit unavailable")) {
    return "Open Claude Code to publish live limits";
  }
  if (rawExplicit.includes("Provider schedule unavailable")) {
    return "Claude Code has not reported its weekly window";
  }
  return rawExplicit;
}

function limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable = false, paceStatus = "unknown") {
  if (remainingPercent == null) {
    if (claudeUnavailable) return "Live limits unavailable";
    return rows.find((row) => row?.status_label)?.status_label || "Plan limit not exposed";
  }
  if (remainingPercent <= 0) return "Limit exhausted";
  if (paceStatus === "over_pace" || (paceDelta != null && paceDelta > 0)) return "Pace will exhaust before reset";
  if (remainingPercent < 18) return "Pace is running hot";
  if (remainingPercent < 38 || (paceDelta != null && paceDelta > 8)) return "Watch current pace";
  return "Safe at current pace";
}

function usageRateRowsFromLimit(limit, hourlyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all", windowKind = "5_hour") {
  const windowSeconds = usageRateWindowSeconds(limit, windowKind);
  const bucketCount = Math.max(1, Math.ceil(windowSeconds / 3600));
  const rows = filterRows(Array.isArray(hourlyRows) ? hourlyRows : [], selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
  if (rows.some((row) => row?.window_index != null)) {
    const byIndex = new Map();
    for (const row of rows) {
      const index = numeric(row?.window_index);
      const previous = byIndex.get(index) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
      byIndex.set(index, {
        total: previous.total + rowActivityTokens(row),
        input: previous.input + rowInput(row),
        output: previous.output + rowOutput(row),
        cache: previous.cache + rowCache(row),
        cost: previous.cost + rowCost(row),
      });
    }
    return Array.from({ length: bucketCount }, (_, index) => {
      const aggregate = byIndex.get(index) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
      const remaining = bucketCount - 1 - index;
      return {
        key: `rolling-${index}`,
        label: remaining === 0 ? "now" : `-${remaining}h`,
        ...aggregate,
      };
    });
  }
  const byHour = new Map();
  for (const row of rows) {
    const date = parseHourBucketDate(row);
    if (!date) continue;
    const key = hourKey(date);
    const previous = byHour.get(key) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
    byHour.set(key, {
      total: previous.total + rowActivityTokens(row),
      input: previous.input + rowInput(row),
      output: previous.output + rowOutput(row),
      cache: previous.cache + rowCache(row),
      cost: previous.cost + rowCost(row),
    });
  }

  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const recent = [];
  for (let offset = bucketCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCHours(now.getUTCHours() - offset);
    const key = hourKey(date);
    const aggregate = byHour.get(key) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
    recent.push({
      key,
      label: offset === 0 ? "now" : `-${offset}h`,
      ...aggregate,
    });
  }
  return recent;
}

function parseHourBucketDate(row) {
  const raw = row?.bucket_start;
  if (!raw) return null;
  const value = String(raw);
  const date = new Date(value.length === 13 ? `${value}:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hourKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}`;
}

function usageRatePath(points, width, height) {
  if (!points.length) return "";
  const max = Math.max(1, ...points.map((point) => numeric(point.total)));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  return points
    .map((point, index) => {
      const x = index * step;
      const y = height - Math.max(4, Math.min(height - 4, (numeric(point.total) / max) * (height - 12)));
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function usageRateBarWidth(pointCount) {
  if (pointCount <= 1) return 8;
  const step = 340 / Math.max(1, pointCount - 1);
  return Math.max(1.1, Math.min(8, step * 0.58));
}

function usageRateAxisLabel(remainingHours) {
  if (remainingHours <= 0) return "now";
  if (remainingHours >= 24) return `-${Math.ceil(remainingHours / 24)}d`;
  return `-${remainingHours}h`;
}

function usageRateAxisLabels(rows, windowKind) {
  if (!rows.length) return [];
  if (rows.length <= 12) {
    return rows.map((row) => ({ key: row.key, label: row.label }));
  }
  const lastIndex = rows.length - 1;
  return rows
    .map((row, index) => {
      const remaining = lastIndex - index;
      const show = index === 0
        || index === lastIndex
        || (windowKind === "weekly" ? remaining % 24 === 0 : remaining % 6 === 0);
      return show ? { key: row.key, label: usageRateAxisLabel(remaining) } : null;
    })
    .filter(Boolean);
}

// The graph must follow the toggle: a limit row can carry a window duration
// that contradicts its kind (old builds classified codex windows by API
// position, so "5h" rows could hold week- or month-long windows, and stale
// cloud-synced rows from un-updated devices still can). Durations outside the
// toggle's band snap to its canonical window instead of silently redrawing
// the other graph.
function usageRateWindowSeconds(limit, windowKind) {
  const seconds = numeric(limit?.limit_window_seconds);
  if (windowKind === "weekly") {
    return seconds >= 5 * 24 * 3600 && seconds <= 14 * 24 * 3600 ? seconds : 7 * 24 * 60 * 60;
  }
  return seconds >= 3600 && seconds <= 6 * 3600 ? seconds : 5 * 60 * 60;
}

function limitSourceText(limit) {
  if (limit?.authority_state === "unavailable") return limit.reset_label || "The daemon could not publish usage";
  if (limit?.authority_state === "local_only") return limit.reset_label || "Only daemon journal counters are available";
  if (limit?.authority_state === "unknown") return limit.reset_label || "No authoritative reading has been published";
  const source = limit?.limit_source || "";
  const isClaude = Array.isArray(limit?.providerKeys) && limit.providerKeys.includes("claude");
  if (source === "claude_statusline_unavailable") return "Live Claude Code limits unavailable";
  if (source === "claude_statusline") return "Live Claude Code usage";
  if (source === "codex_usage_api") return "Live Codex usage";
  if (limit?.confidence === "live") return "Live provider usage";
  if (isClaude && (source === "not_exposed" || limit?.confidence === "unknown")) return "Live Claude Code limits unavailable";
  if (source === "not_exposed") return "Provider limit not exposed";
  if (source === "local_inferred") return "Limits estimated from local CLI usage";
  if (limit?.confidence === "estimated") return "Limits estimated from local CLI usage";
  return "Provider limit not exposed";
}

function planStatusTitle(limit, selectedProvider) {
  if (limit?.authority_state) return limit.plan_name || limit.status_label || "Usage unknown";
  if (!limit?.plan_detected) {
    return selectedProvider === "claude" ? "No Claude account detected" : "No provider plan detected";
  }
  const name = String(limit?.plan_name || "").trim();
  if (selectedProvider === "claude" && name === "Claude subscription") {
    return "Claude account signed in";
  }
  return name || (selectedProvider === "claude" ? "Claude account signed in" : "Provider plan detected");
}

function statusTone(remainingPercent, paceDelta = null, paceStatus = "unknown") {
  const paceDeltaValue = limitNumberOrNull(paceDelta);
  if (remainingPercent == null) return "unknown";
  if (remainingPercent <= 15 || paceStatus === "over_pace" || (paceDeltaValue != null && paceDeltaValue > 0)) return "danger";
  if (remainingPercent <= 38 || (paceDeltaValue != null && paceDeltaValue > 8)) return "warn";
  return "good";
}

function limitPercentTone(percent, displayPercentKind = "used") {
  if (percent == null) return "unknown";
  const value = Number(percent);
  if (!Number.isFinite(value)) return "unknown";
  if (displayPercentKind === "remaining") {
    if (value <= 15) return "danger";
    if (value <= 38) return "warn";
    return "good";
  }
  if (value >= 82) return "danger";
  if (value >= 62) return "warn";
  return "good";
}

function toneColor(tone) {
  if (tone === "danger") return "#ff5a5f";
  if (tone === "warn") return "#fb923c";
  if (tone === "unknown") return "#94a3b8";
  return "#60a5fa";
}

function dailyPercentTone(value, weeklyLimitPercent) {
  if (value <= 0) return "quiet";
  if (weeklyLimitPercent == null) return "good";
  if (weeklyLimitPercent > TOKENOMICS_DAILY_DANGER_LIMIT_PERCENT) return "danger";
  if (weeklyLimitPercent > TOKENOMICS_DAILY_WARN_LIMIT_PERCENT) return "warn";
  return "good";
}

function dailyLimitTitle(row) {
  const percent = limitNumberOrNull(row?.weeklyLimitPercent);
  if (percent == null) return dailyUsageTitle(row);
  const source = row?.weeklyLimitPercentEstimated ? "est. weekly limit" : "weekly limit";
  return `${dailyUsageTitle(row)} · ${source} ${Math.round(percent)}%`;
}

function dailyLimitTone(row) {
  return dailyPercentTone(dailyUsageValue(row), limitNumberOrNull(row?.weeklyLimitPercent));
}

function dailyBarHeight(value, maxValue) {
  const total = numeric(value);
  if (total <= 0) return 5;
  const max = Math.max(1, numeric(maxValue));
  return Math.max(11, Math.round((total / max) * 94));
}

function modelBreakdown(modelRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all") {
  const rows = filterRows(modelRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
  const byModel = new Map();
  for (const row of rows) {
    const rawModel = String(row?.model || "").trim();
    const agentKind = String(row?.agent_kind || "").trim();
    const label = rawModel && rawModel !== agentKind ? rawModel : providerLabel(row);
    const key = label || "Unknown model";
    const current = byModel.get(key) || { label: key, total: 0 };
    current.total += rowInput(row) + rowOutput(row) + rowCache(row);
    byModel.set(key, current);
  }
  const total = [...byModel.values()].reduce((sum, row) => sum + row.total, 0);
  if (total <= 0) {
    return (PROVIDER_MODELS[selectedProvider] || []).map((label) => ({ label, percent: 0 })).slice(0, 5);
  }

  return [...byModel.values()]
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
    .slice(0, 5)
    .map((row) => ({
      label: row.label,
      percent: Math.max(1, Math.round((row.total / total) * 100)),
    }));
}

function providerAccountOptions(summary, selectedProvider, selectedDeviceId = "all", selectedScopeKey = "all", agentAccounts = null) {
  if (selectedProvider === "all") return [];
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  const currentProfileIds = tokenomicsCurrentProfileIdsByProvider(agentAccounts);
  const usageRows = accountRowsForDisplay(summary);
  const accountRows = summaryArray(summary, "provider_accounts");
  const limitRows = limitRowsForDisplay(summary);
  // Usage history and the durable account catalog are never gated on the
  // CURRENT registry view: canonical-dedupe hiding (or mid-login churn) must
  // not erase known accounts. Only ephemeral live-limit rows — whose whole
  // point is "what is signed in right now" — honor profile removal.
  const rows = [
    ...usageRows,
    ...accountRows,
    ...limitRows.filter((row) => !tokenomicsRowReferencesRemovedProfile(row, currentProfileIds)),
  ].filter((row) => (
    provider.match(row)
      && (selectedDeviceId === "all" || !rowDeviceId(row) || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
  const byKey = new Map();
  for (const row of rows) {
    const key = rowProviderAccountKey(row);
    if (providerAccountKeyIsUnknown(key)) continue;
    const current = byKey.get(key) || {
      key,
      label: rowProviderAccountLabel(row),
      total: 0,
    };
    current.total += rowTotal(row);
    if (!current.label || current.label === key) {
      current.label = rowProviderAccountLabel(row);
    }
    byKey.set(key, current);
  }
  // Identity canonicalization has already folded legitimate aliases onto the
  // same key. Never collapse different keys solely because their display
  // labels match: unrelated accounts commonly share names like "support".
  const accounts = tokenomicsAccountsFromDistinctKeys(byKey);
  if (!accounts.length) return [];
  return [{ key: "all", label: "All" }, ...accounts];
}

function providerAccountOptionsByProvider(summary, selectedDeviceId = "all", selectedScopeKey = "all", agentAccounts = null) {
  return HISTORICAL_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
    acc[providerId] = providerAccountOptions(summary, providerId, selectedDeviceId, selectedScopeKey, agentAccounts);
    return acc;
  }, {});
}

function providerAccountOptionGroups(optionsByProvider, selectedProvider) {
  const providerIds = selectedProvider === "all"
    ? HISTORICAL_ACCOUNT_FILTER_PROVIDERS
    : HISTORICAL_ACCOUNT_FILTER_PROVIDERS.filter((providerId) => providerId === selectedProvider);

  return providerIds
    .map((providerId) => {
      const options = optionsByProvider?.[providerId] || [];
      const visibleOptions = options.length ? options : (selectedProvider === "all" ? [{ key: "all", label: "All" }] : []);
      if (!visibleOptions.length) return null;
      const displayName = providerDisplayName(providerId);
      const heading = providerAccountHeading(providerId);
      return {
        provider_id: providerId,
        label: heading,
        options: selectedProvider === "all"
          ? [
            ...visibleOptions,
            {
              key: TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE,
              label: "",
              title: `Hide ${displayName} accounts from All`,
              activeTitle: `Show ${displayName} accounts in All`,
              iconOnly: true,
            },
          ]
          : visibleOptions,
      };
    })
    .filter(Boolean);
}

function lastUpdatedText(value) {
  if (!value) return "Updated just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated just now";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `Updated ${seconds || 1} sec ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.round(minutes / 60)} hr ago`;
}

function providerLimitDisplayedRemainingPercent(row = {}) {
  const remaining = limitNumberOrNull(row?.remaining_percent);
  if (remaining != null) return Math.max(0, Math.min(100, Math.round(remaining)));
  const used = limitNumberOrNull(row?.used_percent, row?.limit_used_percent);
  if (used != null) return Math.max(0, Math.min(100, Math.round(100 - used)));
  const allowance = limitNumberOrNull(row?.allowance);
  const usedAmount = limitNumberOrNull(row?.used);
  if (allowance && usedAmount != null) {
    return Math.max(0, Math.min(100, Math.round(100 - ((usedAmount / allowance) * 100))));
  }
  return null;
}

function tokenomicsLimitSignatureText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text.toLowerCase();
  }
  return "";
}

function tokenomicsLimitSignaturePercent(...values) {
  const value = limitNumberOrNull(...values);
  return value == null ? "" : String(Math.max(0, Math.min(100, Math.round(value))));
}

function tokenomicsLimitSignatureNumber(...values) {
  const value = limitNumberOrNull(...values);
  return value == null ? "" : String(Math.round(value));
}

function tokenomicsLimitResetSignature(row = {}) {
  const reset = limitResetDate(row);
  if (!reset) return "";
  return String(Math.round(reset.getTime() / 60_000));
}

function providerLimitSyncSignature(row = {}) {
  const remaining = providerLimitDisplayedRemainingPercent(row);
  const used = tokenomicsLimitSignaturePercent(
    row?.used_percent,
    row?.limit_used_percent,
  );
  const paceDelta = tokenomicsLimitSignatureNumber(row?.pace_delta_percent);
  const paceTrajectoryDelta = tokenomicsLimitSignatureNumber(
    row?.pace_trajectory_delta_percent,
  );
  const projectedUsed = tokenomicsLimitSignatureNumber(
    row?.pace_projected_used_percent,
    row?.pace_trajectory_projected_used_percent,
  );
  return [
    providerLimitKey(row),
    `remaining:${remaining == null ? "" : remaining}`,
    `used:${used}`,
    `status:${tokenomicsLimitSignatureText(row?.status_label)}`,
    `pace:${tokenomicsLimitSignatureText(row?.pace_status, row?.pace_trajectory_status)}`,
    `pace_delta:${paceDelta}`,
    `pace_trajectory_delta:${paceTrajectoryDelta}`,
    `projected_used:${projectedUsed}`,
    `source:${tokenomicsLimitSignatureText(row?.limit_source, row?.source)}`,
    `source_kind:${tokenomicsLimitSignatureText(row?.limit_source_kind)}`,
    `confidence:${tokenomicsLimitSignatureText(row?.confidence)}`,
    `plan:${tokenomicsLimitSignatureText(row?.plan_name)}`,
    `reset:${tokenomicsLimitResetSignature(row)}`,
    `active:${providerLimitUsesActiveAccount(row) ? "1" : "0"}`,
  ].join(";");
}

function tokenomicsLimitPercentSignature(summary = {}) {
  const limits = limitRowsForDisplay(summary);
  const limitSignature = mergeProviderLimits([], limits)
    .map(providerLimitSyncSignature)
    .filter(Boolean)
    .sort()
    .join("|");
  const samples = Array.isArray(summary?.limit_samples)
    ? summary.limit_samples
    : (Array.isArray(summary?.limitSamples) ? summary.limitSamples : []);
  const sampleSignature = mergeProviderLimitSamples([], samples)
    .map((row) => {
      const used = limitNumberOrNull(row?.used_percent, row?.limit_used_percent);
      if (used == null) return "";
      const paceDelta = tokenomicsLimitSignatureNumber(row?.pace_delta_percent);
      return [
        providerLimitSampleKey(row),
        `used:${Math.max(0, Math.min(100, Math.round(used)))}`,
        `pace:${tokenomicsLimitSignatureText(row?.pace_status)}`,
        `pace_delta:${paceDelta}`,
        `source:${tokenomicsLimitSignatureText(row?.limit_source, row?.source)}`,
        `confidence:${tokenomicsLimitSignatureText(row?.confidence)}`,
      ].join(";");
    })
    .filter(Boolean)
    .sort()
    .join("|");
  return [limitSignature, sampleSignature].filter(Boolean).join("|");
}

function dailyRollupMergeKey(row = {}) {
  return [
    bucketDayKey(row),
    rowDeviceId(row) || "unknown-device",
    rowScopeKey(row),
    providerKey(row),
    String(row?.agent_kind || ""),
    String(row?.model || ""),
    rowProviderAccountKey(row) || "unknown-account",
  ].join("\u001f");
}

function mergeDailyRollupRows(previousRows, nextRows) {
  const previous = Array.isArray(previousRows) ? previousRows : [];
  if (!Array.isArray(nextRows) || !nextRows.length) return previous;
  const merged = new Map();
  previous.forEach((row) => merged.set(dailyRollupMergeKey(row), row));
  nextRows.forEach((row) => merged.set(dailyRollupMergeKey(row), row));
  return [...merged.values()].sort((left, right) => bucketDayKey(right).localeCompare(bucketDayKey(left)));
}

function mergeTokenomicsSummary(previous, next) {
  if (!previous) return next || {};
  if (!next) return previous;
  const nextIsV2 = String(next.schema_version || "").toLowerCase() === "tokenomics_v2";
  const previousIsV2 = summaryIsTokenomicsV2(previous);
  const clearLegacyRows = nextIsV2 || previousIsV2;
  return {
    ...previous,
    ...next,
    provider_accounts: mergeTokenomicsProviderAccounts(previous, next),
    total: next.total || previous.total,
    by_device: next.by_device || (clearLegacyRows ? undefined : previous.by_device),
    by_device_provider: next.by_device_provider || (clearLegacyRows ? undefined : previous.by_device_provider),
    by_device_account: next.by_device_account || (clearLegacyRows ? undefined : previous.by_device_account),
    by_device_model: next.by_device_model || (clearLegacyRows ? undefined : previous.by_device_model),
    daily_by_device_provider: next.daily_by_device_provider || (clearLegacyRows ? undefined : previous.daily_by_device_provider),
    monthly_by_device_provider: next.monthly_by_device_provider || (clearLegacyRows ? undefined : previous.monthly_by_device_provider),
    hourly: next.hourly || previous.hourly,
    sources: next.sources || previous.sources,
    limits: mergeProviderLimits(previous.limits, next.limits),
    limit_samples: mergeProviderLimitSamples(previous.limit_samples, next.limit_samples),
    device_identities: next.device_identities || previous.device_identities,
  };
}

function mergeTokenomicsSummaryDelta(previous, next) {
  if (!previous) return next || {};
  if (!next) return previous;
  const nextDaily = next.daily_by_device_provider;
  const mergedDaily = mergeDailyRollupRows(
    previous.daily_by_device_provider,
    nextDaily,
  );
  return {
    ...previous,
    schema_version: next.schema_version || previous.schema_version,
    updated_at: next.updated_at || previous.updated_at,
    daily_by_device_provider: mergedDaily,
  };
}

const tokenomicsStore = {
  account_key: TOKENOMICS_DEFAULT_ACCOUNT_KEY,
  loadedAccountKey: "",
  requestEpoch: 0,
  state: createTokenomicsStoreState(),
  loadedOnce: false,
  loadPromise: null,
  liveLimitsPromise: null,
  liveLimitsLastAt: 0,
  summaryRefreshLastAt: 0,
  pollInterval: null,
  pollSubscriberCount: 0,
  limitPercentSignature: "",
  limitSyncInFlight: false,
  limitSyncPending: false,
  updatedListenerPromise: null,
  updatedUnlisten: null,
  notifyFrame: 0,
  notifyTimer: 0,
  notifyVisibilityListening: false,
  notifiedStateSignature: "",
  subscribers: new Set(),
};

const tokenomicsSummaryNotifySignatureCache = new WeakMap();

function tokenomicsHashNotifyText(hash, value) {
  const text = String(value ?? "");
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next = Math.imul(next ^ text.charCodeAt(index), 16777619);
  }
  return next >>> 0;
}

function tokenomicsHashNotifyValue(hash, value) {
  if (Array.isArray(value)) {
    return value.reduce(
      (next, item) => tokenomicsHashNotifyValue(next, item),
      tokenomicsHashNotifyText(hash, `array:${value.length}`),
    );
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce(
      (next, key) => tokenomicsHashNotifyValue(tokenomicsHashNotifyText(next, key), value[key]),
      hash,
    );
  }
  return tokenomicsHashNotifyText(hash, value);
}

function tokenomicsSummaryNotifySignature(summary) {
  if (!summary || typeof summary !== "object") return "";
  const cached = tokenomicsSummaryNotifySignatureCache.get(summary);
  if (cached) return cached;
  const signature = tokenomicsHashNotifyValue(2166136261, summary).toString(36);
  tokenomicsSummaryNotifySignatureCache.set(summary, signature);
  return signature;
}

function tokenomicsSubscriberStateSignature(state = {}) {
  return [
    state.status,
    state.error,
    state.selectedProvider,
    state.selectedAccountKey,
    HISTORICAL_ACCOUNT_FILTER_PROVIDERS
      .map((providerId) => `${providerId}:${accountKeyForProvider(state.selectedProviderAccountKeys, providerId)}`)
      .join("\u001e"),
    tokenomicsSummaryNotifySignature(state.summary),
  ].map((value) => String(value ?? "")).join("\u001f");
}

function stopTokenomicsNotifyVisibilityListener() {
  if (!tokenomicsStore.notifyVisibilityListening || typeof document === "undefined") {
    return;
  }
  document.removeEventListener("visibilitychange", handleTokenomicsNotifyVisibilityChange);
  tokenomicsStore.notifyVisibilityListening = false;
}

function moveTokenomicsNotifyToHiddenTimer() {
  if (typeof window === "undefined" || tokenomicsStore.notifyTimer || !tokenomicsStore.notifyFrame) {
    return false;
  }
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(tokenomicsStore.notifyFrame);
  }
  tokenomicsStore.notifyFrame = 0;
  stopTokenomicsNotifyVisibilityListener();
  tokenomicsStore.notifyTimer = window.setTimeout(flushTokenomicsSubscribers, TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS);
  return true;
}

function handleTokenomicsNotifyVisibilityChange() {
  if (typeof document !== "undefined" && document.hidden) {
    moveTokenomicsNotifyToHiddenTimer();
  }
}

function ensureTokenomicsNotifyVisibilityListener() {
  if (tokenomicsStore.notifyVisibilityListening || typeof document === "undefined") {
    return;
  }
  document.addEventListener("visibilitychange", handleTokenomicsNotifyVisibilityChange);
  tokenomicsStore.notifyVisibilityListening = true;
}

function flushTokenomicsSubscribers() {
  tokenomicsStore.notifyFrame = 0;
  tokenomicsStore.notifyTimer = 0;
  stopTokenomicsNotifyVisibilityListener();
  const signature = tokenomicsSubscriberStateSignature(tokenomicsStore.state);
  if (signature === tokenomicsStore.notifiedStateSignature) {
    return;
  }
  tokenomicsStore.notifiedStateSignature = signature;
  for (const subscriber of tokenomicsStore.subscribers) {
    subscriber(tokenomicsStore.state);
  }
}

function notifyTokenomicsSubscribers() {
  if (!tokenomicsStore.subscribers.size) {
    return;
  }
  if (typeof window === "undefined") {
    flushTokenomicsSubscribers();
    return;
  }
  const hidden = typeof document !== "undefined" && document.hidden;
  if (hidden && !tokenomicsStore.notifyTimer) {
    if (moveTokenomicsNotifyToHiddenTimer()) {
      return;
    }
    tokenomicsStore.notifyTimer = window.setTimeout(flushTokenomicsSubscribers, TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS);
    return;
  }
  if (tokenomicsStore.notifyFrame || tokenomicsStore.notifyTimer) {
    return;
  }
  if (typeof window.requestAnimationFrame !== "function") {
    tokenomicsStore.notifyTimer = window.setTimeout(
      flushTokenomicsSubscribers,
      hidden ? TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS : 0,
    );
    return;
  }
  ensureTokenomicsNotifyVisibilityListener();
  tokenomicsStore.notifyFrame = window.requestAnimationFrame(flushTokenomicsSubscribers);
}

function updateTokenomicsStore(patchOrUpdater) {
  const previous = tokenomicsStore.state;
  const patch = typeof patchOrUpdater === "function"
    ? patchOrUpdater(previous)
    : patchOrUpdater;
  tokenomicsStore.state = {
    ...previous,
    ...(patch || {}),
  };
  notifyTokenomicsSubscribers();
}

function subscribeTokenomicsStore(subscriber) {
  tokenomicsStore.subscribers.add(subscriber);
  subscriber(tokenomicsStore.state);
  if (tokenomicsStore.subscribers.size === 1 && !tokenomicsStore.notifyFrame && !tokenomicsStore.notifyTimer) {
    tokenomicsStore.notifiedStateSignature = tokenomicsSubscriberStateSignature(tokenomicsStore.state);
  }
  return () => {
    tokenomicsStore.subscribers.delete(subscriber);
  };
}

function tokenomicsErrorMessage(caught) {
  return caught?.message || String(caught || "Unable to load Tokenomics.");
}

function rememberTokenomicsLimitSignature(summary) {
  const signature = tokenomicsLimitPercentSignature(summary);
  if (signature) {
    tokenomicsStore.limitPercentSignature = signature;
  }
  return signature;
}

function scheduleTokenomicsLimitCloudSync() {
  tokenomicsStore.limitSyncPending = true;
  if (tokenomicsStore.limitSyncInFlight) {
    return;
  }

  scheduleTokenomicsIdleTask(() => {
    if (!tokenomicsStore.limitSyncPending || tokenomicsStore.limitSyncInFlight) {
      return;
    }
    tokenomicsStore.limitSyncPending = false;
    tokenomicsStore.limitSyncInFlight = true;
    invoke("cloud_mcp_schedule_tokenomics_sync", {
      reason: TOKENOMICS_LIMIT_CLOUD_SYNC_REASON,
      full: false,
      resync_last_30_days: false,
    })
      .catch(() => {})
      .finally(() => {
        tokenomicsStore.limitSyncInFlight = false;
        if (tokenomicsStore.limitSyncPending) {
          scheduleTokenomicsLimitCloudSync();
        }
      });
  }, { delay_ms: 0, timeout: 1200 });
}

function mergeSummaryIntoTokenomicsStore(next, { syncLimitChanges = false } = {}) {
  let nextSignature = "";
  let shouldSyncLimits = false;
  tokenomicsStore.loadedAccountKey = tokenomicsStore.account_key;
  updateTokenomicsStore((previous) => ({
    summary: (() => {
      const merged = mergeTokenomicsSummary(previous.summary, next || {});
      const previousSignature = tokenomicsStore.limitPercentSignature || tokenomicsLimitPercentSignature(previous.summary);
      nextSignature = tokenomicsLimitPercentSignature(merged);
      shouldSyncLimits = Boolean(syncLimitChanges && nextSignature && previousSignature !== nextSignature);
      return merged;
    })(),
  }));
  if (nextSignature) {
    tokenomicsStore.limitPercentSignature = nextSignature;
  }
  if (shouldSyncLimits) {
    scheduleTokenomicsLimitCloudSync();
  }
}

function mergeSummaryDeltaIntoTokenomicsStore(next) {
  if (!next) return;
  tokenomicsStore.loadedAccountKey = tokenomicsStore.account_key;
  updateTokenomicsStore((previous) => ({
    summary: mergeTokenomicsSummaryDelta(previous.summary, next),
  }));
}

function resetTokenomicsStoreForAccount(accountKey) {
  const incomingAccountKey = String(accountKey || "").trim();
  if (!incomingAccountKey) {
    return;
  }

  const normalizedAccountKey = normalizeTokenomicsAccountKey(incomingAccountKey);
  if (tokenomicsStore.account_key === normalizedAccountKey) {
    return;
  }

  const currentAccountKey = String(tokenomicsStore.account_key || "").trim();
  const currentIsInitialAccount = !currentAccountKey || currentAccountKey === TOKENOMICS_DEFAULT_ACCOUNT_KEY;
  const loadedAccountKey = String(tokenomicsStore.loadedAccountKey || "").trim();
  const loadedForDifferentRealAccount = Boolean(
    loadedAccountKey
      && loadedAccountKey !== TOKENOMICS_DEFAULT_ACCOUNT_KEY
      && loadedAccountKey !== normalizedAccountKey,
  );

  if (currentIsInitialAccount && !loadedForDifferentRealAccount) {
    tokenomicsStore.account_key = normalizedAccountKey;
    if (tokenomicsStore.state.summary) {
      tokenomicsStore.loadedAccountKey = normalizedAccountKey;
    }
    return;
  }

  tokenomicsStore.account_key = normalizedAccountKey;
  tokenomicsStore.requestEpoch += 1;
  tokenomicsStore.loadedOnce = false;
  tokenomicsStore.loadedAccountKey = "";
  tokenomicsStore.loadPromise = null;
  tokenomicsStore.liveLimitsPromise = null;
  tokenomicsStore.liveLimitsLastAt = 0;
  tokenomicsStore.summaryRefreshLastAt = 0;
  tokenomicsStore.limitPercentSignature = "";
  tokenomicsStore.limitSyncPending = false;
  tokenomicsStore.state = createTokenomicsStoreState();
  notifyTokenomicsSubscribers();
}

function ensureTokenomicsUpdatedListener() {
  if (!tokenomicsStore.updatedUnlisten && !tokenomicsStore.updatedListenerPromise) {
    tokenomicsStore.updatedListenerPromise = listen(TOKENOMICS_UPDATED_EVENT, () => {
      void refreshVisibleTokenomicsLimits({ force: true });
    })
      .then((handler) => {
        if (tokenomicsStore.pollSubscriberCount <= 0) {
          handler();
          return;
        }
        tokenomicsStore.updatedUnlisten = handler;
      })
      .catch(() => {})
      .finally(() => {
        tokenomicsStore.updatedListenerPromise = null;
      });
  }
}

function stopTokenomicsUpdatedListener() {
  if (tokenomicsStore.updatedUnlisten) {
    try {
      tokenomicsStore.updatedUnlisten();
    } catch {
      // ignore
    }
    tokenomicsStore.updatedUnlisten = null;
  }
}

function refreshTokenomicsLiveLimits({ force = false, syncLimitChanges = false } = {}) {
  const now = Date.now();
  const requestEpoch = tokenomicsStore.requestEpoch;
  if (tokenomicsStore.liveLimitsPromise) {
    return tokenomicsStore.liveLimitsPromise;
  }
  if (!force && now - tokenomicsStore.liveLimitsLastAt < TOKENOMICS_LIVE_LIMIT_REFRESH_INTERVAL_MS) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }

  tokenomicsStore.liveLimitsLastAt = now;
  tokenomicsStore.liveLimitsPromise = invoke("tokenomics_get_live_limits")
    .then((limitsSummary) => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        mergeSummaryIntoTokenomicsStore(limitsSummary || {}, { syncLimitChanges });
      }
      return tokenomicsStore.state.summary;
    })
    .catch((caught) => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        updateTokenomicsStore({ error: tokenomicsErrorMessage(caught) });
      }
      return tokenomicsStore.state.summary;
    })
    .finally(() => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        tokenomicsStore.liveLimitsPromise = null;
      }
    });
  return tokenomicsStore.liveLimitsPromise;
}

function refreshTokenomicsSummaryIfStale({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - tokenomicsStore.summaryRefreshLastAt < TOKENOMICS_SUMMARY_REFRESH_INTERVAL_MS) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }
  tokenomicsStore.summaryRefreshLastAt = now;
  return loadTokenomicsStore({ force: true, summaryOnly: true });
}

function refreshVisibleTokenomicsLimits({ force = false } = {}) {
  return refreshTokenomicsLiveLimits({ force, syncLimitChanges: true })
    .finally(() => {
      void refreshTokenomicsSummaryIfStale();
    });
}

function loadTokenomicsStore({ background = false, force = false } = {}) {
  const hasSummary = Boolean(tokenomicsStore.state.summary);
  const requestEpoch = tokenomicsStore.requestEpoch;
  if (tokenomicsStore.loadPromise) return tokenomicsStore.loadPromise;
  if (!force && tokenomicsStore.loadedOnce && hasSummary) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }

  updateTokenomicsStore((previous) => ({
    error: "",
    status: background && previous.summary ? "ready" : "loading",
  }));

  tokenomicsStore.loadPromise = invoke("tokenomics_get_summary")
    .then((next) => {
      if (tokenomicsStore.requestEpoch !== requestEpoch) {
        return tokenomicsStore.state.summary;
      }
      tokenomicsStore.loadedOnce = true;
      tokenomicsStore.loadedAccountKey = tokenomicsStore.account_key;
      tokenomicsStore.summaryRefreshLastAt = Date.now();
      updateTokenomicsStore((previous) => ({
        error: "",
        status: "ready",
        summary: mergeTokenomicsSummary(previous.summary, next || {}),
      }));
      rememberTokenomicsLimitSignature(tokenomicsStore.state.summary);
      return tokenomicsStore.state.summary;
    })
    .catch((caught) => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        updateTokenomicsStore((previous) => ({
          error: tokenomicsErrorMessage(caught),
          status: previous.summary ? "ready" : "error",
        }));
      }
      return tokenomicsStore.state.summary;
    })
    .finally(() => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        tokenomicsStore.loadPromise = null;
      }
    });
  return tokenomicsStore.loadPromise;
}

export function warmAccountTokenomics({ account_key: accountKey = "" } = {}) {
  resetTokenomicsStoreForAccount(accountKey);
  const summaryPromise = loadTokenomicsStore({ background: true });
  summaryPromise.finally(() => {
    scheduleTokenomicsIdleTask(() => {
      void refreshTokenomicsLiveLimits({ syncLimitChanges: true });
    }, { delay_ms: 120, timeout: 1500 });
  });
  return summaryPromise;
}
function startTokenomicsViewPolling() {
  ensureTokenomicsUpdatedListener();
  tokenomicsStore.pollSubscriberCount += 1;
  let disposed = false;
  const refreshVisibleTokenomics = ({ force = false } = {}) => {
    if (disposed) return;
    void refreshVisibleTokenomicsLimits({ force });
  };
  // Tokenomics is DEVICE-level state: view activation (workspace switches
  // re-activate the keep-alive Tokens tab) must only subscribe and render the
  // cached store. The shared interval below + focus/visibility listeners +
  // rust push events own freshness; force-refreshing here made every
  // workspace open pay account-level provider HTTP + a multi-MB summary.
  refreshVisibleTokenomics({ force: false });
  // Summary staleness check rides idle so it can never land inside the
  // activation window; the 5-minute guard makes repeated activations free.
  {
    const deferSummaryRefresh = () => {
      if (disposed) return;
      // Idle callbacks can land inside a workspace-activation window (opens
      // have idle gaps between commits). Re-defer while an activation is
      // recent so the multi-MB summary parse never competes with an open.
      const mark = window.__DF_LAST_ACTIVATION_MARK;
      const msSinceActivation = mark ? performance.now() - Number(mark.t || 0) : Infinity;
      if (msSinceActivation < 3000) {
        window.setTimeout(deferSummaryRefresh, 3000);
        return;
      }
      void refreshTokenomicsSummaryIfStale();
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(deferSummaryRefresh, { timeout: 4000 });
    } else {
      window.setTimeout(deferSummaryRefresh, 1500);
    }
  }
  window.addEventListener("focus", refreshVisibleTokenomics);
  document.addEventListener("visibilitychange", refreshVisibleTokenomics);

  if (!tokenomicsStore.pollInterval) {
    // The shared interval must not close over any one subscriber's disposed
    // flag: with multiple mounted views (route view + kept-alive tool panel),
    // the first subscriber unmounting would otherwise leave a permanently
    // no-op interval behind for the survivors. Its lifetime is already gated
    // by pollSubscriberCount below.
    tokenomicsStore.pollInterval = window.setInterval(() => {
      void refreshVisibleTokenomicsLimits({ force: false });
    }, TOKENOMICS_VIEW_POLL_INTERVAL_MS);
  }

  return () => {
    disposed = true;
    window.removeEventListener("focus", refreshVisibleTokenomics);
    document.removeEventListener("visibilitychange", refreshVisibleTokenomics);
    tokenomicsStore.pollSubscriberCount = Math.max(0, tokenomicsStore.pollSubscriberCount - 1);
    if (tokenomicsStore.pollSubscriberCount === 0 && tokenomicsStore.pollInterval) {
      window.clearInterval(tokenomicsStore.pollInterval);
      tokenomicsStore.pollInterval = null;
    }
    if (tokenomicsStore.pollSubscriberCount === 0) {
      stopTokenomicsUpdatedListener();
    }
  };
}

function tokenomicsLoadingLabel(status) {
  return status === "refreshing" ? "Refreshing daemon usage" : "Loading usage history";
}

/* null means UNKNOWN (the ledger authority could not vouch for the period),
   which renders as an em dash — never as a fabricated 0. */
function TokenCell({ value, unknown_reason: unknownReason = "" }) {
  if (value == null) {
    return <td title={unknownReason || "Usage history is not available"}>—</td>;
  }
  return <td title={formatTokenTitle(value)}>{formatTokens(value)}</td>;
}

function CostCell({ value, unknown_reason: unknownReason = "" }) {
  if (value == null) {
    return <td title={unknownReason || "Usage history is not available"}>—</td>;
  }
  return <td title={formatCostTitle(value)}>{formatCost(value)}</td>;
}

/* Resolves one Today/Last-30-Days row of cells through the pinned tri-state
   decision: recorded rows render their sums; an empty period renders 0 only
   while the ledger authority is available, and otherwise renders unknown. */
function periodRowCells(aggregate, ledgerAuthority) {
  const cell = tokenomicsPeriodCellValue(aggregate?.input ?? 0, aggregate?.rowCount ?? 0, ledgerAuthority);
  if (cell.known) {
    return {
      input: aggregate.input,
      output: aggregate.output,
      cache: aggregate.cache,
      cost: aggregate.cost,
      reason: "",
    };
  }
  const reason = `Usage history unknown — ${cell.reason}`;
  return { input: null, output: null, cache: null, cost: null, reason };
}

function LimitMetricCard({ icon: Icon, limit, title }) {
  const displayPercent = limit.display_percent;
  const displayKind = limit.display_percent_kind || "used";
  const paceDelta = limitNumberOrNull(limit.paceDelta);
  const paceText = paceDelta == null
    ? "No data"
    : `${paceDelta > 0 ? "▲" : "▼"}${Math.abs(paceDelta)}%`;
  const paceMultiplier = paceMultiplierFromDelta(paceDelta);
  const paceMultiplierText = paceMultiplier == null ? "" : formatPaceMultiplier(paceMultiplier);
  const progressLabel = displayKind === "remaining" ? `${title} remaining` : `${title} used`;
  return (
    <LimitCard tone={statusTone(limit.remaining_percent, limit.paceDelta, limit.pace_status)}>
      <MetricHeading>
        <MetricName>
          <Icon aria-hidden="true" />
          <span>{title}</span>
        </MetricName>
        <MetricScore>
          <strong>{displayPercent == null ? "—" : `${displayPercent}%`}</strong>
          <span>{paceText}</span>
        </MetricScore>
      </MetricHeading>
      <ProgressTrack aria-label={progressLabel}>
        <ProgressFill
          $empty={displayPercent == null}
          $tone={limitPercentTone(displayPercent, displayKind)}
          style={{ width: `${displayPercent ?? 0}%` }}
        />
      </ProgressTrack>
      <MetricFoot>
        <span>{limit.reset_label}</span>
        <strong>
          {paceMultiplierText ? (
            <PaceMultiplier
              title={`Current pace ${paceMultiplierText}`}
            >
              [{paceMultiplierText}]
            </PaceMultiplier>
          ) : null}
          {limit.status_label}
        </strong>
      </MetricFoot>
    </LimitCard>
  );
}

function ProviderLimitGroup({ five_hour: fiveHour, provider_id: providerId, weekly }) {
  const statusLimit = providerId === "haider-code" ? weekly : fiveHour;
  return (
    <ProviderLimitColumn>
      <ProviderLimitHeading $provider={providerId}>
        <strong>{providerDisplayName(providerId)}</strong>
      </ProviderLimitHeading>
      <PlanStatusLine>
        <strong>{planStatusTitle(statusLimit, providerId)}</strong>
        <span>{limitSourceText(statusLimit)}</span>
      </PlanStatusLine>
      <LimitMetricCard icon={ClockIcon} limit={fiveHour} title="5-Hour Session" />
      <LimitMetricCard icon={CalendarIcon} limit={weekly} title="Weekly Limit" />
    </ProviderLimitColumn>
  );
}

function HarnessAccountChipView({
  descriptor,
  swap,
  usage,
  meter,
  on_swap: onSwap,
}) {
  const usageKnown = usage.state === "known";
  const meterLine = harnessMeterLine(meter);
  const {
    authKindLabel,
    confirmEpoch,
    disabled,
    inFlight,
    isActive,
    label,
    provider,
    swappable,
    title,
  } = harnessAccountChipPresentation(descriptor, swap, {
    meterTitle: meterLine.title,
    usageKnown,
    usageTitle: usageKnown
      ? `${formatTokenTitle(usage.totalTokens)} recorded in the harness ledger`
      : "",
  });
  const accent = harnessProviderAccent(provider);
  /* Swap is an OAuth affordance: a PUBLISHED api_key auth kind renders no
     click-to-swap (owner intent — the provider selects API-key accounts).
     An UNKNOWN kind keeps the affordance: absence is never read as api_key. */
  return (
    <HarnessAccountChip
      $accent={accent}
      $active={isActive}
      $inFlight={inFlight}
      $swappable={swappable}
      aria-pressed={isActive}
      disabled={disabled}
      onClick={isActive || !swappable ? undefined : () => onSwap(descriptor, confirmEpoch)}
      title={title}
      type="button"
    >
      <HarnessChipTop>
        <HarnessChipName>{label}</HarnessChipName>
        {isActive ? <HarnessChipBadge $accent={accent}>Active</HarnessChipBadge> : null}
        {inFlight ? <HarnessChipBadge $accent={accent} $busy>Switching…</HarnessChipBadge> : null}
        {confirmEpoch ? <HarnessChipBadge $accent={accent} $confirm>Click again to confirm</HarnessChipBadge> : null}
      </HarnessChipTop>
      <HarnessChipMeta>
        <span data-role="provider">{provider}</span>
        {authKindLabel ? <span data-role="auth">{authKindLabel}</span> : null}
        <span data-role="usage" data-known={usageKnown ? "true" : "false"}>
          {usageKnown ? formatTokens(usage.totalTokens) : "—"}
        </span>
        {meterLine.text ? (
          <span data-role="meter" data-tone={meterLine.tone}>{meterLine.text}</span>
        ) : null}
      </HarnessChipMeta>
    </HarnessAccountChip>
  );
}

/* The parent has many unrelated tokenomics controls. This memo boundary keeps
   lane scans and meter selection off chip renders until their raw inputs, the
   descriptor, or swap state actually change. The pinned pure seams remain the
   only source of usage/meter facts. */
const HarnessAccountChipRow = memo(function HarnessAccountChipRow({
  descriptor,
  harness_hourly_rows: harnessHourlyRows,
  on_swap: onSwap,
  summary,
  swap,
}) {
  return (
    <HarnessAccountChipView
      descriptor={descriptor}
      meter={harnessAccountMeterPresentation(summary, descriptor)}
      on_swap={onSwap}
      swap={swap}
      usage={harnessAccountUsagePresentation(harnessHourlyRows, descriptor?.alias)}
    />
  );
});

const AccountTokenomicsView = memo(function AccountTokenomicsView({
  account_key: accountKey = "",
  active = true,
  billing_status: billingStatus = null,
  storage_usage: storageUsage = null,
} = {}) {
  const [{
    summary,
    status,
    error,
    selectedProvider,
    selectedProviderAccountKeys,
    selectedAccountKey: legacySelectedAccountKey,
  }, setTokenomicsState] = useState(() => tokenomicsStore.state);
  const [dailyWindowDays, setDailyWindowDays] = useState(TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS);
  const [usageRateWindowKind, setUsageRateWindowKind] = useState("5_hour");
  const { rosterState, swapAccount, dismissSwapFailure, relist } = useHarnessAccountRoster(active);
  const manage = useHarnessAccountManagement(active, relist);
  const harnessRoster = useMemo(() => harnessRosterPresentation(rosterState), [rosterState]);
  const lastUsageRosterRevisionRef = useRef(null);
  /* Management affordances appear only when the daemon supports account
     management; an unsupported/unavailable/loading roster hides them. */
  const harnessManageVisible = harnessRoster.phase === "ready"
    || harnessRoster.phase === "empty"
    || harnessRoster.phase === "unverified";
  /* Per-account ledger lanes and historical filters both read stored summary
     rows. The live account_list roster must not rewrite those archive keys. */
  const harnessHourlyRows = useMemo(() => hourlyRowsForDisplay(summary), [summary]);
  const refresh = useCallback(async () => {
    updateTokenomicsStore({ error: "", status: "refreshing" });
    await refreshTokenomicsLiveLimits({ force: true, syncLimitChanges: true });
    await loadTokenomicsStore({ force: true });
    updateTokenomicsStore({ status: "ready" });
  }, []);
  const isRefreshing = status === "refreshing";

  const setSelectedProvider = useCallback((provider) => {
    updateTokenomicsStore({ selectedProvider: provider });
  }, []);

  // The provider filter buttons were removed — the three color-coded provider
  // rows always render, so pin any persisted store filter back to "all".
  useEffect(() => {
    if (!active) {
      return;
    }
    setSelectedProvider("all");
  }, [active, setSelectedProvider]);

  const setSelectedProviderAccountKey = useCallback((providerId, nextAccountKey) => {
    updateTokenomicsStore((previous) => ({
      selectedProviderAccountKeys: {
        ...normalizeProviderAccountKeys(previous.selectedProviderAccountKeys, previous.selectedAccountKey),
        [providerId]: normalizeProviderAccountKey(nextAccountKey),
      },
      selectedAccountKey: "all",
    }));
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    resetTokenomicsStoreForAccount(accountKey);
    void refreshVisibleTokenomicsLimits({ force: true });
    void loadTokenomicsStore({ background: true, force: false });
  }, [accountKey, active]);

  useLayoutEffect(() => {
    if (active) {
      setTokenomicsState(tokenomicsStore.state);
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setTokenomicsState(tokenomicsStore.state);
    const unsubscribeStore = subscribeTokenomicsStore(setTokenomicsState);
    const stopPolling = startTokenomicsViewPolling();
    return () => {
      stopPolling();
      unsubscribeStore();
    };
  }, [active]);

  /* The excised credential registry used to trigger a usage refresh whenever
     its account signature changed. account_list now owns that fact: a newly
     published roster revision refreshes the live meters and stored summary,
     while the historical display remains independent of the live roster. */
  useEffect(() => {
    if (!active) {
      lastUsageRosterRevisionRef.current = null;
      return undefined;
    }
    const revision = rosterState.revision;
    if (!Number.isInteger(revision)) return undefined;
    const previousRevision = lastUsageRosterRevisionRef.current;
    lastUsageRosterRevisionRef.current = revision;
    if (previousRevision == null || previousRevision === revision) return undefined;
    let cancelled = false;
    void refreshTokenomicsLiveLimits({
      force: true,
      syncLimitChanges: true,
    }).finally(() => {
      if (!cancelled) void refreshTokenomicsSummaryIfStale({ force: true });
    });
    return () => {
      cancelled = true;
    };
  }, [active, rosterState.revision]);

  const visibleSummary = useMemo(
    () => (summary ? summaryForMappedNativeDevices(summary) : null),
    [summary],
  );
  // Cloud sync is intentionally ignored on this client, so Tokenomics always
  // renders the local device only. There is no device picker: the device filter
  // is pinned to this machine's id (falling back to "all" before the current
  // device id is known, which is local-only data anyway).
  const localDeviceId = String(
    visibleSummary?.current_device_id || "",
  ).trim();
  const selectedDeviceId = localDeviceId || "all";
  const providers = providerRowsForDisplay(visibleSummary);
  const modelRows = modelRowsForDisplay(visibleSummary);
  const providerRows = providers;
  const selectedScopeKey = "all";
  const providerAccountKeys = useMemo(
    () => normalizeProviderAccountKeys(selectedProviderAccountKeys, legacySelectedAccountKey),
    [legacySelectedAccountKey, selectedProviderAccountKeys],
  );
  const selectedAccountFilter = useMemo(() => (
    selectedProvider === "all"
      ? providerAccountKeys
      : accountKeyForProvider(providerAccountKeys, selectedProvider)
  ), [providerAccountKeys, selectedProvider]);
  const accountOptionsByProvider = useMemo(
    () => providerAccountOptionsByProvider(visibleSummary, selectedDeviceId, selectedScopeKey),
    [visibleSummary, selectedDeviceId, selectedScopeKey],
  );
  const accountOptionGroups = useMemo(
    () => providerAccountOptionGroups(accountOptionsByProvider, selectedProvider),
    [accountOptionsByProvider, selectedProvider],
  );
  useEffect(() => {
    let nextKeys = null;
    for (const providerId of HISTORICAL_ACCOUNT_FILTER_PROVIDERS) {
      const selectedKey = accountKeyForProvider(providerAccountKeys, providerId);
      if (selectedProvider === "all" && selectedKey === TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE) {
        continue;
      }
      const options = accountOptionsByProvider[providerId] || [];
      if (selectedKey !== "all" && !options.some((option) => option.key === selectedKey)) {
        nextKeys = nextKeys || { ...providerAccountKeys };
        nextKeys[providerId] = "all";
      }
    }
    if (nextKeys) {
      updateTokenomicsStore({ selectedProviderAccountKeys: nextKeys, selectedAccountKey: "all" });
    }
  }, [accountOptionsByProvider, providerAccountKeys, selectedProvider]);
  const dailyRaw = dailyRowsForDisplay(visibleSummary);
  const hourlyRaw = hourlyRowsForDisplay(visibleSummary);
  const limitRowsRaw = useMemo(() => limitRowsForDisplay(visibleSummary), [visibleSummary]);
  const limitSamplesRaw = Array.isArray(visibleSummary?.limit_samples)
    ? visibleSummary.limit_samples
    : (Array.isArray(visibleSummary?.limitSamples) ? visibleSummary.limitSamples : []);
  const dailyRows = useMemo(
    () => buildDailyRows(dailyRaw, limitSamplesRaw, limitRowsRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey, dailyWindowDays),
    [dailyRaw, dailyWindowDays, limitRowsRaw, limitSamplesRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const today = useMemo(
    () => todayAggregate(dailyRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey),
    [dailyRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const last30Days = useMemo(
    () => rollingWindowAggregate(dailyRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey),
    [dailyRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const ledgerAuthority = useMemo(() => tokenomicsLedgerAuthority(summary), [summary]);
  const todayCells = useMemo(() => periodRowCells(today, ledgerAuthority), [ledgerAuthority, today]);
  const last30DayCells = useMemo(() => periodRowCells(last30Days, ledgerAuthority), [last30Days, ledgerAuthority]);
  const deviceAccountRows = accountRowsForDisplay(visibleSummary);
  const totalRows = accountFilterIsAll(selectedProvider, selectedAccountFilter) ? providerRows : deviceAccountRows;
  const total = useMemo(
    () => aggregateRows(filterRows(totalRows, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey)),
    [selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey, totalRows],
  );
  const selectedLimitAccountFilter = useMemo(
    () => {
      if (selectedProvider === "all") {
        return HISTORICAL_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
          acc[providerId] = limitAccountKeyForDisplay(
            limitRowsRaw,
            providerId,
            accountKeyForProvider(providerAccountKeys, providerId),
            selectedScopeKey,
            selectedDeviceId,
          );
          return acc;
        }, {});
      }
      return limitAccountKeyForDisplay(
        limitRowsRaw,
        selectedProvider,
        accountKeyForProvider(providerAccountKeys, selectedProvider),
        selectedScopeKey,
        selectedDeviceId,
      );
    },
    [limitRowsRaw, providerAccountKeys, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const limits = useMemo(
    () => filterLimits(limitRowsRaw, selectedProvider, selectedLimitAccountFilter, selectedScopeKey, selectedDeviceId),
    [limitRowsRaw, selectedDeviceId, selectedLimitAccountFilter, selectedProvider, selectedScopeKey],
  );
  const fiveHour = useMemo(() => mergeLimits(
    limits,
    "5_hour",
    selectedProvider === "all"
      ? null
      : tokenomicsUsageAuthorityPresentation(visibleSummary, selectedProvider, "5_hour"),
  ), [limits, selectedProvider, visibleSummary]);
  const weekly = useMemo(() => mergeLimits(
    limits,
    "weekly",
    selectedProvider === "all"
      ? null
      : tokenomicsUsageAuthorityPresentation(visibleSummary, selectedProvider, "weekly"),
  ), [limits, selectedProvider, visibleSummary]);
  const usageRateLimit = usageRateWindowKind === "weekly" ? weekly : fiveHour;
  const sessionUsageRows = useMemo(
    () => usageRateRowsFromLimit(usageRateLimit, hourlyRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey, usageRateWindowKind),
    [hourlyRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey, usageRateLimit, usageRateWindowKind],
  );
  const sessionUsageBarWidth = usageRateBarWidth(sessionUsageRows.length);
  const sessionUsageLabels = usageRateAxisLabels(sessionUsageRows, usageRateWindowKind);
  const maxSessionUsage = Math.max(1, ...sessionUsageRows.map((row) => row.total));
  const activeSessionRows = sessionUsageRows.filter((row) => row.total > 0);
  const averageSessionUsage = activeSessionRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, activeSessionRows.length);
  const maxDaily = Math.max(1, ...dailyRows.map((row) => dailyUsageValue(row)));
  const breakdown = useMemo(
    () => modelBreakdown(modelRows, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey),
    [modelRows, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  // Credits precedence: the auth/billing snapshot seeds the widget immediately
  // (pre-websocket); later live/hot snapshots only update the display when
  // they are themselves meaningful/known. The last good wallet is kept in a
  // ref so a transient empty/unknown snapshot can never flicker the widget
  // back to 0 — while a genuine known:true zeroed balance still shows 0.
  const displayedCreditsRef = useRef({
    accountKey: "",
    awaitingBillingStatus: false,
    billingStatus: null,
    credits: null,
  });
  const displayedCreditsState = useMemo(
    () => resolveAccountDisplayedCreditWalletState(
      displayedCreditsRef.current,
      accountKey,
      billingStatus,
    ),
    [accountKey, billingStatus],
  );
  useLayoutEffect(() => {
    displayedCreditsRef.current = displayedCreditsState;
  }, [displayedCreditsState]);
  const credits = displayedCreditsState.credits;
  // OpenCode is intentionally excluded from live limit gauges — OpenCode Go has
  // no usage API, and users track spend via their own plugins. OpenCode usage is
  // surfaced through the token-usage charts/account cards below, not estimates.
  const providerLimitGroups = useMemo(() => {
    const providerIds = ["codex", "claude"];
    if (visibleSummary?.haider_code_plan_status?.supported === true) {
      providerIds.push("haider-code");
    }
    return providerIds.map((providerId) => {
      const providerAccountKey = limitAccountKeyForDisplay(
        limitRowsRaw,
        providerId,
        accountKeyForProvider(providerAccountKeys, providerId),
        selectedScopeKey,
        selectedDeviceId,
      );
      const providerLimits = filterLimits(limitRowsRaw, providerId, providerAccountKey, selectedScopeKey, selectedDeviceId);
      return {
        provider_id: providerId,
        five_hour: mergeLimits(
          providerLimits,
          "5_hour",
          tokenomicsUsageAuthorityPresentation(visibleSummary, providerId, "5_hour"),
        ),
        weekly: mergeLimits(
          providerLimits,
          "weekly",
          tokenomicsUsageAuthorityPresentation(visibleSummary, providerId, "weekly"),
        ),
      };
    });
  }, [limitRowsRaw, providerAccountKeys, selectedDeviceId, selectedScopeKey, visibleSummary]);
  const storage = useMemo(
    () => storageUsageModel(billingStatus, storageUsage),
    [billingStatus, storageUsage],
  );

  return (
    <TokenomicsShell>
      <TokenomicsPanel>
        {/* HISTORY filters: chips derived from STORED usage rows so archive
            data referencing retired accounts stays filterable. This is not
            the account roster — live harness accounts render in the
            Accounts card at the bottom. */}
        {accountOptionGroups.length > 0 ? (
          <ProviderAccountRows aria-label="Usage history account filters"
            title="Filters over recorded usage history — live accounts are in the Accounts card below">
            {accountOptionGroups.map((group) => (
              <ProviderAccountRow key={group.provider_id}>
                <AccountTabs role="tablist" aria-label={`${group.label} filter`}>
                  {group.options.map((account) => {
                    const active = accountKeyForProvider(providerAccountKeys, group.provider_id) === account.key;
                    const title = active && account.activeTitle ? account.activeTitle : (account.title || account.label);
                    return (
                      <AccountTab
                        aria-label={account.iconOnly ? title : undefined}
                        key={account.key}
                        $active={active}
                        $iconOnly={account.iconOnly}
                        $provider={group.provider_id}
                        onClick={() => setSelectedProviderAccountKey(
                          group.provider_id,
                          active && account.key === TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE ? "all" : account.key,
                        )}
                        role="tab"
                        title={title}
                        type="button"
                      >
                        {account.iconOnly ? <FilterListOff aria-hidden="true" /> : account.label}
                      </AccountTab>
                    );
                  })}
                </AccountTabs>
              </ProviderAccountRow>
            ))}
          </ProviderAccountRows>
        ) : null}

        {error ? <TokenomicsError>{error}</TokenomicsError> : null}

        {status !== "ready" && !visibleSummary ? (
          <TokenomicsLoading role="status" aria-live="polite">
            <span />
            <strong>{tokenomicsLoadingLabel(status)}</strong>
          </TokenomicsLoading>
        ) : null}

        {selectedProvider === "all" ? (
          <ProviderLimitGrid>
            {providerLimitGroups.map((group) => (
              <ProviderLimitGroup
                key={group.provider_id}
                five_hour={group.five_hour}
                provider_id={group.provider_id}
                weekly={group.weekly}
              />
            ))}
          </ProviderLimitGrid>
        ) : selectedProvider === "opencode" ? null : (
          <>
            <PlanStatusLine>
              <strong>{planStatusTitle(fiveHour, selectedProvider)}</strong>
              <span>{limitSourceText(fiveHour)}</span>
            </PlanStatusLine>
            <LimitMetricCard icon={ClockIcon} limit={fiveHour} title="5-Hour Session" />
            <LimitMetricCard icon={CalendarIcon} limit={weekly} title="Weekly Limit" />
          </>
        )}

        <ChartGrid>
          <ChartCard>
            <PanelTitle>
              <span>
                <RateIcon aria-hidden="true" />
                Usage Rate
              </span>
              <RangeToggle aria-label="Usage rate window" role="group">
                {TOKENOMICS_USAGE_RATE_WINDOWS.map((window) => (
                  <RangeToggleButton
                    key={window.key}
                    $active={usageRateWindowKind === window.key}
                    aria-pressed={usageRateWindowKind === window.key}
                    onClick={() => setUsageRateWindowKind(window.key)}
                    type="button"
                  >
                    {window.label}
                  </RangeToggleButton>
                ))}
              </RangeToggle>
            </PanelTitle>
            <RateGraph viewBox="0 0 360 104" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" y1="18" x2="360" y2="18" />
              <line x1="0" y1="52" x2="360" y2="52" />
              <line x1="0" y1="86" x2="360" y2="86" />
              {[90, 180, 270].map((x) => <line key={x} x1={x} y1="10" x2={x} y2="94" className="v" />)}
              {sessionUsageRows.map((row, index) => {
                const step = sessionUsageRows.length > 1 ? 340 / (sessionUsageRows.length - 1) : 0;
                const x = 10 + index * step;
                const height = Math.max(row.total > 0 ? 5 : 3, (row.total / maxSessionUsage) * 70);
                const y = 90 - height;
                const isHot = averageSessionUsage > 0 && row.total > averageSessionUsage * 1.35;
                return (
                  <rect
                    key={row.key}
                    x={x - (sessionUsageBarWidth / 2)}
                    y={y}
                    width={sessionUsageBarWidth}
                    height={height}
                    rx={sessionUsageBarWidth > 3 ? "2" : "1"}
                    className={isHot ? "hot" : "cool"}
                  />
                );
              })}
              <path d={usageRatePath(sessionUsageRows, 360, 96)} />
            </RateGraph>
            <SessionRateLabels>
              {sessionUsageLabels.map((row) => (
                <span key={row.key}>{row.label}</span>
              ))}
            </SessionRateLabels>
          </ChartCard>

          <ChartCard>
            <PanelTitle>
              <span>
                <BarsIcon aria-hidden="true" />
                Daily Usage
              </span>
              <RangeToggle aria-label="Daily usage range" role="group">
                {TOKENOMICS_DAILY_RANGE_OPTIONS.map((days) => (
                  <RangeToggleButton
                    key={days}
                    $active={dailyWindowDays === days}
                    aria-pressed={dailyWindowDays === days}
                    onClick={() => setDailyWindowDays(days)}
                    type="button"
                  >
                    {days}d
                  </RangeToggleButton>
                ))}
              </RangeToggle>
            </PanelTitle>
            <DailyChart $days={dailyRows.length}>
              {dailyRows.map((row) => {
                /* Tri-state daily pixels: no rows → a hollow "no usage
                   recorded" marker (never a measured 0), recorded rows →
                   the measured bar, all-archive rows labelled as archive. */
                const presentation = tokenomicsDailyBucketPresentation(row);
                const noData = presentation.kind === "no_data";
                const title = tokenomicsDailyBucketTitle(
                  row,
                  presentation,
                  dailyLimitTitle({ ...row, label: row.titleLabel || row.label }),
                );
                return (
                  <DailyColumn key={row.key}>
                    <DailyBar
                      $noData={noData ? true : undefined}
                      $tone={noData ? "quiet" : dailyLimitTone(row)}
                      style={noData ? undefined : { height: `${dailyBarHeight(dailyUsageValue(row), maxDaily)}%` }}
                      title={title}
                    />
                    <small>{row.label}</small>
                  </DailyColumn>
                );
              })}
            </DailyChart>
          </ChartCard>
        </ChartGrid>

        <UsageCard>
          <PanelTitle>
            <span>
              <HashIcon aria-hidden="true" />
              Token Usage
            </span>
          </PanelTitle>
          <UsageTable>
            <thead>
              <tr>
                <th />
                <th>Input</th>
                <th>Output</th>
                <th>Cache</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Today</td>
                <TokenCell value={todayCells.input} unknown_reason={todayCells.reason} />
                <TokenCell value={todayCells.output} unknown_reason={todayCells.reason} />
                <TokenCell value={todayCells.cache} unknown_reason={todayCells.reason} />
                <CostCell value={todayCells.cost} unknown_reason={todayCells.reason} />
              </tr>
              <tr>
                <td title="Last 30 Days">Last 30 Days</td>
                <TokenCell value={last30DayCells.input} unknown_reason={last30DayCells.reason} />
                <TokenCell value={last30DayCells.output} unknown_reason={last30DayCells.reason} />
                <TokenCell value={last30DayCells.cache} unknown_reason={last30DayCells.reason} />
                <CostCell value={last30DayCells.cost} unknown_reason={last30DayCells.reason} />
              </tr>
            </tbody>
          </UsageTable>
          <ModelList>
            {breakdown.length ? breakdown.map((item) => (
              <ModelRow
                $provider={HISTORICAL_ACCOUNT_FILTER_PROVIDERS.includes(String(item.label || "").toLowerCase())
                  ? String(item.label).toLowerCase()
                  : undefined}
                key={item.label}
              >
                <span>{item.label}</span>
                <strong>{item.percent}%</strong>
              </ModelRow>
            )) : (
              <TokenomicsEmpty>Usage populates automatically after using Codex, Claude Code, or OpenCode.</TokenomicsEmpty>
            )}
          </ModelList>
        </UsageCard>

        <CreditsCard>
          <CreditsTitle>
            <span>Diff Forge Credits</span>
            <strong>{credits?.plan_name || "Plan"}</strong>
          </CreditsTitle>
          <CreditsGrid>
            <CreditMetric>
              <span>Used</span>
              <strong>{credits ? formatCredits(credits.term_used_credits) : "—"}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Remaining</span>
              <strong>{credits ? formatCredits(credits.term_remaining_credits) : "—"}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Reserved</span>
              <strong>{credits ? formatCredits(credits.term_reserved_credits) : "—"}</strong>
            </CreditMetric>
          </CreditsGrid>
        </CreditsCard>

        <StorageCard>
          <StorageTitle>
            <span>Storage</span>
            <strong>{storage.known ? "Live" : "Waiting"}</strong>
          </StorageTitle>
          <StorageRows>
            {storage.rows.map((row) => (
              <StorageRow key={row.key}>
                <StorageRowTop>
                  <span>{row.label}</span>
                  <strong>{formatStorageBytes(row.used)} / {formatStorageBytes(row.limit)}</strong>
                </StorageRowTop>
                <StorageTrack aria-label={`${row.label} storage used`}>
                  <StorageFill style={{ width: `${row.percent}%` }} />
                </StorageTrack>
              </StorageRow>
            ))}
          </StorageRows>
        </StorageCard>

        {/* LIVE harness accounts: account_list + the roster watch. Separate
            from the history filter pills above by design — this row is real
            accounts with live swap, never derived from stored usage rows. */}
        <HarnessAccountsCard aria-label="Harness accounts">
          <PanelTitle>
            <span>
              <AccountsIcon aria-hidden="true" />
              Accounts
            </span>
            <HarnessWatchBadge
              $live={harnessRoster.watchLive ? true : undefined}
              title={harnessRoster.watchLive
                ? "Roster changes arrive live from the harness"
                : `Snapshot only — ${harnessRoster.staleReason || "the live roster watch is unavailable"}`}
            >
              <i aria-hidden="true" />
              {harnessRoster.watchLive ? "Live" : "Snapshot"}
            </HarnessWatchBadge>
          </PanelTitle>
          {harnessRoster.phase === "loading" ? (
            <TokenomicsEmpty>Loading harness accounts…</TokenomicsEmpty>
          ) : harnessRoster.phase === "unsupported" ? (
            <TokenomicsEmpty>
              This harness does not support account management (account_management_v1 is not advertised) — not the same as having no accounts.
            </TokenomicsEmpty>
          ) : harnessRoster.phase === "unavailable" ? (
            <TokenomicsEmpty>
              Accounts unavailable{harnessRoster.reason ? ` — ${harnessRoster.reason}` : ""}.
            </TokenomicsEmpty>
          ) : harnessRoster.phase === "empty" ? (
            <TokenomicsEmpty>No harness accounts yet — add one with the + chip.</TokenomicsEmpty>
          ) : harnessRoster.phase === "unverified" ? (
            <TokenomicsEmpty>The harness has not confirmed its account roster yet.</TokenomicsEmpty>
          ) : null}
          {harnessRoster.descriptors.length > 0 || harnessManageVisible ? (
            <HarnessAccountChips aria-label="Harness accounts — click one to make it active" role="group">
              {harnessRoster.descriptors.map((descriptor) => (
                <HarnessChipShell key={harnessAccountAlias(descriptor)}>
                  <HarnessAccountChipRow
                    descriptor={descriptor}
                    harness_hourly_rows={harnessHourlyRows}
                    on_swap={swapAccount}
                    summary={summary}
                    swap={rosterState.swap}
                  />
                  {harnessManageVisible ? (
                    <HarnessChipRemove
                      aria-label={`Remove ${harnessAccountAlias(descriptor)}`}
                      disabled={manage.removeState.phase === "confirm" || manage.removeState.phase === "in_flight"}
                      onClick={() => manage.requestRemove(descriptor, rosterState.revision)}
                      title="Remove this account from the harness vault"
                      type="button"
                    >
                      ×
                    </HarnessChipRemove>
                  ) : null}
                </HarnessChipShell>
              ))}
              {harnessManageVisible ? (
                <HarnessAddChip
                  aria-expanded={manage.addMode ? "true" : "false"}
                  aria-label="Add a harness account"
                  onClick={manage.toggleAddPanel}
                  title="Add an account — OAuth sign-in, import, or API key"
                  type="button"
                >
                  +
                </HarnessAddChip>
              ) : null}
            </HarnessAccountChips>
          ) : null}
          {rosterState.swap.phase === "failed" ? (
            <HarnessSwapError role="alert">
              <span>{rosterState.swap.message}</span>
              <button onClick={dismissSwapFailure} type="button">Dismiss</button>
            </HarnessSwapError>
          ) : null}
          {manage.removeState.phase === "confirm" ? (
            <HarnessManageConfirm role="alertdialog" aria-label={`Remove ${manage.removeState.alias}?`}>
              <span>
                Remove {manage.removeState.alias}? The credential leaves the
                harness vault (removal is durable).
              </span>
              <button
                data-danger="true"
                onClick={manage.confirmRemove}
                type="button"
              >
                Remove
              </button>
              <button onClick={manage.dismissRemove} type="button">Keep</button>
            </HarnessManageConfirm>
          ) : manage.removeState.phase === "in_flight" ? (
            <HarnessManageConfirm>
              <span>Removing {manage.removeState.alias}… waiting for the daemon.</span>
            </HarnessManageConfirm>
          ) : manage.removeState.phase === "failed" ? (
            <HarnessSwapError role="alert">
              <span>Remove failed — {manage.removeState.message}</span>
              <button onClick={manage.dismissRemove} type="button">Dismiss</button>
            </HarnessSwapError>
          ) : null}
          {harnessManageVisible && manage.addMode ? (
            <HarnessManagePanel>
              <HarnessManageModeRow aria-label="Add account method">
                <button
                  data-active={manage.addMode === "oauth" ? "true" : undefined}
                  onClick={() => manage.setAddMode("oauth")}
                  type="button"
                >
                  OAuth sign-in
                </button>
                <button
                  data-active={manage.addMode === "api_key" ? "true" : undefined}
                  onClick={() => manage.setAddMode("api_key")}
                  type="button"
                >
                  API key
                </button>
                <button
                  aria-label="Close add account"
                  data-close="true"
                  onClick={manage.closeAddPanel}
                  type="button"
                >
                  Close
                </button>
              </HarnessManageModeRow>
              {manage.addMode === "oauth" && manage.addFlow.phase === "idle" ? (
                <>
                  <HarnessManageForm
                    onSubmit={(event) => {
                      event.preventDefault();
                      void manage.startOauth();
                    }}
                  >
                    <label>
                      Provider
                      {manage.libraryState.state === "loading" || manage.libraryState.state === "idle" ? (
                        <HarnessManageNote>Reading the daemon's provider catalog…</HarnessManageNote>
                      ) : manage.libraryState.state === "error" ? (
                        <HarnessManageNote data-tone="error">
                          Provider catalog unavailable — {manage.libraryState.reason}
                        </HarnessManageNote>
                      ) : manage.oauthProviders.length === 0 ? (
                        <HarnessManageNote>
                          The daemon published no providers advertising OAuth sign-in.
                        </HarnessManageNote>
                      ) : (
                        <select
                          onChange={(event) => manage.setOauthDraft((draft) => ({ ...draft, provider: event.target.value }))}
                          value={manage.oauthDraft.provider}
                        >
                          <option value="">Choose…</option>
                          {manage.oauthProviders.map((provider) => (
                            <option key={provider} value={provider}>{provider}</option>
                          ))}
                        </select>
                      )}
                    </label>
                    <label>
                      Alias (optional)
                      <input
                        autoComplete="off"
                        onChange={(event) => manage.setOauthDraft((draft) => ({ ...draft, alias: event.target.value }))}
                        placeholder={manage.oauthDraft.provider || "derived"}
                        value={manage.oauthDraft.alias}
                      />
                    </label>
                    <button disabled={!manage.oauthDraft.provider} type="submit">Start sign-in</button>
                  </HarnessManageForm>
                  <HarnessManageImport>
                    <strong>Import an existing sign-in</strong>
                    {manage.catalogPresentation.phase === "loading" ? (
                      <HarnessManageNote>Reading the daemon's import catalog…</HarnessManageNote>
                    ) : manage.catalogPresentation.phase === "unpublished" ? (
                      <HarnessManageNote>This daemon does not publish an import catalog.</HarnessManageNote>
                    ) : manage.catalogPresentation.phase === "unavailable" ? (
                      <HarnessManageNote data-tone="error">
                        Import catalog unavailable — {manage.catalogPresentation.reason}
                      </HarnessManageNote>
                    ) : manage.catalogPresentation.phase === "empty" ? (
                      <HarnessManageNote>The daemon's import catalog lists no sources.</HarnessManageNote>
                    ) : (
                      <HarnessManageImportRow>
                        {manage.catalogPresentation.rows.map((row) => (
                          <button
                            disabled={row.available !== true || manage.importState.phase === "in_flight"}
                            key={row.source}
                            onClick={() => manage.importSource(row.source)}
                            title={row.available === true
                              ? `Import the ${row.source} sign-in${row.provider ? ` (${row.provider})` : ""}`
                              : row.available === false
                                ? (row.unavailableReason || "Unavailable")
                                : "Availability unknown — the daemon did not say"}
                            type="button"
                          >
                            {row.source}
                            {manage.importState.phase === "in_flight" && manage.importState.source === row.source
                              ? " — importing…"
                              : ""}
                          </button>
                        ))}
                      </HarnessManageImportRow>
                    )}
                    {manage.importState.phase === "failed" ? (
                      <HarnessManageNote data-tone="error">
                        Import failed — {manage.importState.message}
                        {" "}
                        <button onClick={manage.dismissImport} type="button">Dismiss</button>
                      </HarnessManageNote>
                    ) : null}
                  </HarnessManageImport>
                </>
              ) : null}
              {manage.addMode === "oauth" && manage.addFlow.phase !== "idle" ? (
                <HarnessManageFlowCard data-phase={manage.addFlow.phase}>
                  {manage.addFlow.phase === "starting" ? (
                    <span>Starting sign-in for {manage.addFlow.provider}…</span>
                  ) : null}
                  {manage.addFlow.phase === "pending" ? (
                    <>
                      <span>
                        {manage.addFlow.userCode
                          ? "Enter this code in your browser to finish signing in:"
                          : manage.addFlow.authorizationUrl
                            ? "Finish signing in with your browser — this completes automatically."
                            : "The daemon started the flow but published no URL or code."}
                      </span>
                      {manage.addFlow.userCode ? (
                        <HarnessManageCode>{manage.addFlow.userCode}</HarnessManageCode>
                      ) : null}
                      {manage.addFlow.authorizationUrl ? (
                        <HarnessManageUrl
                          onClick={() => void manage.openOauthAuthorization()}
                          type="button"
                        >
                          {manage.addFlow.authorizationUrl}
                        </HarnessManageUrl>
                      ) : null}
                      {manage.addFlow.message ? (
                        <HarnessManageNote data-tone="error">{manage.addFlow.message}</HarnessManageNote>
                      ) : null}
                      <button onClick={manage.cancelOauth} type="button">Cancel</button>
                    </>
                  ) : null}
                  {manage.addFlow.phase === "claiming" ? (
                    <span>Completing sign-in…</span>
                  ) : null}
                  {manage.addFlow.phase === "succeeded" ? (
                    <>
                      <span>Signed in — the roster updates from the daemon's account list.</span>
                      <button onClick={manage.dismissAddFlow} type="button">Done</button>
                    </>
                  ) : null}
                  {manage.addFlow.phase === "unavailable" ? (
                    <>
                      <span>
                        Sign-in is unavailable for {manage.addFlow.provider}
                        {manage.addFlow.message ? ` — ${manage.addFlow.message}` : ""}.
                      </span>
                      <button onClick={manage.dismissAddFlow} type="button">Close</button>
                    </>
                  ) : null}
                  {manage.addFlow.phase === "failed" ? (
                    <>
                      <span>{manage.addFlow.message}</span>
                      <button onClick={manage.dismissAddFlow} type="button">Close</button>
                    </>
                  ) : null}
                  {manage.addFlow.phase === "cancelled" ? (
                    <>
                      <span>Sign-in cancelled.</span>
                      <button onClick={manage.dismissAddFlow} type="button">Close</button>
                    </>
                  ) : null}
                </HarnessManageFlowCard>
              ) : null}
              {manage.addMode === "api_key" ? (
                <>
                  <HarnessManageForm
                    onSubmit={(event) => {
                      event.preventDefault();
                      void manage.submitApiKey();
                    }}
                  >
                    <label>
                      Provider
                      {manage.libraryState.state === "loading" || manage.libraryState.state === "idle" ? (
                        <HarnessManageNote>Reading the daemon's provider catalog…</HarnessManageNote>
                      ) : manage.libraryState.state === "error" ? (
                        <HarnessManageNote data-tone="error">
                          Provider catalog unavailable — {manage.libraryState.reason}
                        </HarnessManageNote>
                      ) : manage.apiProviders.length === 0 ? (
                        <HarnessManageNote>
                          The daemon published no providers advertising API-key auth.
                        </HarnessManageNote>
                      ) : (
                        <select
                          onChange={(event) => manage.editApiMetadata("provider", event.target.value)}
                          value={manage.apiMetadata.provider}
                        >
                          <option value="">Choose…</option>
                          {manage.apiProviders.map((provider) => (
                            <option key={provider} value={provider}>{provider}</option>
                          ))}
                        </select>
                      )}
                    </label>
                    <label>
                      Alias (optional)
                      <input
                        autoComplete="off"
                        onChange={(event) => manage.editApiMetadata("alias", event.target.value)}
                        placeholder="derived if empty"
                        value={manage.apiMetadata.alias}
                      />
                    </label>
                    <label data-grow="true">
                      API key
                      <input
                        autoComplete="off"
                        onChange={(event) => manage.editApiKey(event.target.value)}
                        placeholder="sk-…"
                        ref={manage.apiKeyInputRef}
                        type="password"
                      />
                    </label>
                    <button
                      disabled={!manage.apiMetadata.provider || !manage.apiKeyPresent || manage.apiBusy}
                      type="submit"
                    >
                      {manage.apiBusy ? "Validating…" : "Add key"}
                    </button>
                  </HarnessManageForm>
                  {manage.apiError ? (
                    <HarnessManageNote data-tone="error">{manage.apiError}</HarnessManageNote>
                  ) : null}
                  <HarnessManageNote>
                    API-key accounts carry no switch — the provider selects
                    them. The key is validated once and never shown again.
                  </HarnessManageNote>
                </>
              ) : null}
            </HarnessManagePanel>
          ) : null}
        </HarnessAccountsCard>
        <TokenomicsFooter>
          <span>{lastUpdatedText(summary?.updated_at)}</span>
          <TokenomicsRescanButton
            disabled={isRefreshing}
            onClick={() => {
              void refresh();
            }}
            title="Refresh daemon usage"
            type="button"
          >
            <TokenomicsRescanIcon aria-hidden="true" data-spinning={isRefreshing ? "true" : undefined} />
            <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
          </TokenomicsRescanButton>
        </TokenomicsFooter>
      </TokenomicsPanel>
    </TokenomicsShell>
  );
});

export default AccountTokenomicsView;

function ClockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function CalendarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="5" y="6" width="14" height="13" rx="2" />
      <path d="M8 4v4M16 4v4M5 10h14M9 14h.01M12 14h.01M15 14h.01" />
    </svg>
  );
}

function RateIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M4 19V5M4 16l5-5 4 3 6-8M8 19h12" />
    </svg>
  );
}

function BarsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="4" y="11" width="4" height="8" rx="1" />
      <rect x="10" y="7" width="4" height="12" rx="1" />
      <rect x="16" y="4" width="4" height="15" rx="1" />
    </svg>
  );
}

function HashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />
    </svg>
  );
}

const TokenomicsShell = styled.section`
  display: grid;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  overflow-x: hidden;
  padding: clamp(6px, 1.8vw, 12px);
  color: #e5eefb;
  background:
    radial-gradient(circle at 50% 0%, rgba(var(--forge-tint-rgb), 0.06), transparent 38%),
    linear-gradient(180deg, #05080d, #020304 68%, #05080d);

  &,
  * {
    box-sizing: border-box;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
    background:
      radial-gradient(circle at 50% 0%, rgba(var(--forge-tint-rgb), 0.1), transparent 34%),
      radial-gradient(circle at 100% 12%, rgba(249, 115, 22, 0.08), transparent 28%),
      linear-gradient(180deg, #f8fafc, #eef4ff);
  }
`;

const TokenomicsPanel = styled.div`
  position: relative;
  display: grid;
  gap: 9px;
  align-self: start;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;

  html[data-forge-theme="light"] & {
    background: transparent;
    box-shadow: none;
  }
`;

const ProviderAccountRows = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
`;

const ProviderAccountRow = styled.div`
  display: block;
  min-width: 0;
`;

const AccountTabs = styled.div`
  display: flex;
  gap: 5px;
  min-width: 0;
  overflow-x: auto;
  padding: 2px 1px 4px;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

/* Pill design mirrors the web dashboard's provider account filter rows
   (UsageAccountTab in next-diffforge dashboard.js): fully round pills, the
   provider accent carried by the active pill's ring + text, neutral dark
   pills otherwise, and a compact 32px icon-only exclude pill per row. */
const AccountTab = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: ${({ $iconOnly }) => ($iconOnly ? "center" : "flex-start")};
  gap: 6px;
  flex: 0 0 auto;
  width: ${({ $iconOnly }) => ($iconOnly ? "32px" : "auto")};
  min-width: ${({ $iconOnly }) => ($iconOnly ? "32px" : "0")};
  max-width: 200px;
  min-height: 26px;
  padding: ${({ $iconOnly }) => ($iconOnly ? "0" : "0 8px")};
  border: 1px solid ${({ $active, $provider }) => ($active ? providerAccent($provider) : "rgba(148, 163, 184, 0.16)")};
  border-radius: 999px;
  color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#94a3b8")};
  background: ${({ $active, $provider }) => ($active
    ? `color-mix(in srgb, ${providerAccent($provider)} 14%, rgba(16, 21, 28, 0.74))`
    : "rgba(16, 21, 28, 0.48)")};
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 130ms ease, border-color 130ms ease;

  svg {
    width: 14px;
    height: 14px;
    flex: none;
  }

  &:hover {
    border-color: ${({ $provider }) => providerAccent($provider)};
    color: #ffffff;
  }

  html[data-forge-theme="light"] & {
    border-color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "rgba(71, 85, 105, 0.2)")};
    color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#475569")};
    background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 10%, #ffffff)` : "#f8fafc")};

    &:hover {
      color: #0f172a;
    }
  }
`;

const TokenomicsError = styled.div`
  padding: 8px 10px;
  border: 1px solid rgba(255, 79, 91, 0.34);
  border-radius: 8px;
  color: #ff7f89;
  background: rgba(255, 79, 91, 0.1);
  font-size: 12px;
  font-weight: 800;
`;

const TokenomicsLoading = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.2);
  border-radius: 8px;
  color: #9fb2cc;
  background: rgba(var(--forge-tint-rgb), 0.08);
  font-size: 11px;
  font-weight: 900;

  span {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    border: 2px solid rgba(var(--forge-tint-soft-rgb), 0.18);
    border-top-color: var(--forge-tint-soft);
    border-radius: 999px;
    animation: tokenomics-spin 0.8s linear infinite;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    min-width: 0;
    color: #7f8da3;
    font-size: 10px;
    font-weight: 800;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes tokenomics-spin {
    to {
      transform: rotate(360deg);
    }
  }

  html[data-forge-theme="light"] & {
    color: #475569;
    border-color: rgba(var(--forge-tint-rgb), 0.16);
    background: rgba(var(--forge-tint-rgb), 0.07);
  }
`;

const ProviderLimitGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 10px;
  min-width: 0;
`;

const ProviderLimitColumn = styled.div`
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
`;

const ProviderLimitHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 0 2px 1px;
  color: ${({ $provider }) => providerAccent($provider)};
  font-size: 13px;
  font-weight: 800;

  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const PlanStatusLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 0 2px;
  color: #7a8493;
  font-size: clamp(9px, 2.2vw, 10.5px);
  font-weight: 700;

  strong {
    min-width: 0;
    overflow: hidden;
    color: #e5eefb;
    text-overflow: ellipsis;
    white-space: normal;
  }

  span {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: normal;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;

    strong {
      color: #0f172a;
    }
  }
`;

const LimitCard = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background: #0d1117;
  container-type: inline-size;

  --tone: ${({ tone }) => toneColor(tone)};

  @container (max-width: 450px) {
    gap: 6px;
    padding: 8px;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #f8fafc;
  }
`;

const MetricHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;

  @container (max-width: 450px) {
    gap: 6px;
  }
`;

const MetricName = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: #f4f7fa;
  font-size: clamp(12px, 3.1vw, 13px);
  font-weight: 750;

  @container (max-width: 450px) {
    gap: 6px;
    font-size: 12px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
  }

  @container (max-width: 450px) {
    svg {
      width: 13px;
      height: 13px;
    }
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const MetricScore = styled.div`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  color: var(--tone);
  font-size: clamp(10px, 2.4vw, 12px);
  font-weight: 900;
  white-space: nowrap;

  strong {
    font-size: clamp(12px, 3vw, 15px);
  }

  @container (max-width: 450px) {
    gap: 4px;
    font-size: 10px;

    strong {
      font-size: 13px;
    }
  }
`;

const ProgressTrack = styled.div`
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #1b2330;

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.12);
  }

  @container (max-width: 450px) {
    height: 5px;
  }
`;

const ProgressFill = styled.div`
  height: 100%;
  min-width: ${({ $empty }) => ($empty ? "0" : "7px")};
  border-radius: inherit;
  --bar-tone: ${({ $tone }) => toneColor($tone)};
  background: var(--bar-tone);
`;

const MetricFoot = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: #7a8493;
  font-size: clamp(9px, 2.5vw, 10.5px);
  font-weight: 650;

  @container (max-width: 450px) {
    gap: 6px;
    font-size: 9px;
    line-height: 1.15;
  }

  span {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: visible;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  strong {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 62%;
    overflow: visible;
    color: var(--tone);
    font-weight: 750;
    line-height: 1.15;
    text-align: right;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const PaceMultiplier = styled.b`
  display: inline-block;
  margin-right: 4px;
  color: currentColor;
  font-weight: 950;
`;

const ChartCard = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background: #0d1117;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #f8fafc;
  }
`;

const ChartGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
  gap: 9px;
  min-width: 0;
  align-items: stretch;
`;

const PanelTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(12px, 3.1vw, 14px);
  font-weight: 900;

  > span {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  small {
    color: #738196;
    font-size: 10px;
    font-weight: 900;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    fill: none;
    stroke: var(--forge-tint-soft);
    stroke-width: 2;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;

    small {
      color: #64748b;
    }
  }
`;

const RateGraph = styled.svg`
  display: block;
  width: 100%;
  height: 90px;
  overflow: visible;

  line {
    stroke: rgba(153, 173, 197, 0.15);
    stroke-width: 1;
  }

  line.v {
    stroke: rgba(153, 173, 197, 0.1);
  }

  rect.cool {
    fill: rgba(var(--forge-tint-rgb), 0.36);
  }

  rect.hot {
    fill: rgba(251, 146, 60, 0.48);
  }

  path {
    fill: none;
    stroke: #fb923c;
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
`;

const SessionRateLabels = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
  margin-top: -3px;

  span {
    color: #8593a8;
    font-size: 9px;
    font-weight: 900;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const RangeToggle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.18);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.16);
    background: rgba(241, 245, 249, 0.82);
  }
`;

const RangeToggleButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  min-height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  color: ${({ $active }) => ($active ? "var(--forge-tint-soft)" : "#738196")};
  background: ${({ $active }) => ($active ? "rgba(var(--forge-tint-rgb), 0.20)" : "transparent")};
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  cursor: pointer;

  &:hover {
    color: #e5eefb;
  }

  html[data-forge-theme="light"] & {
    color: ${({ $active }) => ($active ? "var(--forge-tint)" : "#64748b")};
    background: ${({ $active }) => ($active ? "rgba(var(--forge-tint-rgb), 0.12)" : "transparent")};

    &:hover {
      color: #0f172a;
    }
  }
`;

const DailyChart = styled.div`
  display: grid;
  grid-template-columns: repeat(${({ $days }) => $days || TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS}, minmax(0, 1fr));
  align-items: end;
  gap: ${({ $days }) => (($days || 0) > 7 ? "4px" : "7px")};
  min-height: 96px;
`;

const DailyColumn = styled.div`
  display: grid;
  grid-template-rows: 68px auto;
  align-items: end;
  gap: 7px;
  min-width: 0;

  small {
    overflow: hidden;
    color: #7f8ea3;
    font-size: 9px;
    font-weight: 900;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const DailyBar = styled.div`
  align-self: end;
  min-height: 8px;
  border-radius: 5px 5px 2px 2px;
  /* A day with no recorded rows is a hollow marker, visually distinct from a
     measured (even zero) bar: no fill, a faint dashed outline. */
  border: ${({ $noData }) => ($noData ? "1px dashed rgba(114, 130, 150, 0.4)" : "0")};
  background: ${({ $noData, $tone }) => {
    if ($noData) return "transparent";
    if ($tone === "danger") return "#ff5a5f";
    if ($tone === "warn") return "#facc15";
    if ($tone === "quiet") return "rgba(114, 130, 150, 0.25)";
    return "#60a5fa";
  }};
  box-shadow: ${({ $tone }) => {
    if (!$tone || $tone === "quiet") return "none";
    if ($tone === "danger") return "0 0 18px rgba(255, 90, 95, 0.16)";
    if ($tone === "warn") return "0 0 18px rgba(250, 204, 21, 0.16)";
    return "0 0 18px rgba(96, 165, 250, 0.16)";
  }};
`;

const UsageCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--forge-tint-rgb), 0.07), transparent 36%),
    #0d1117;

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.15);
    background:
      radial-gradient(circle at 0% 0%, rgba(var(--forge-tint-rgb), 0.08), transparent 36%),
      #f8fafc;
  }
`;

const UsageTable = styled.table`
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;

  th,
  td {
    overflow: hidden;
    padding: 4px 2px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    width: 32%;
    color: #7f9ac1;
    text-align: left;
  }

  th:last-child,
  td:last-child {
    width: 21%;
  }

  th {
    color: #7f9ac1;
    font-size: 9px;
    font-weight: 800;
  }

  td {
    color: #e5eefb;
    font-size: 10px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  td:first-child {
    font-weight: 800;
  }

  html[data-forge-theme="light"] & {
    th:first-child,
    td:first-child,
    th {
      color: #64748b;
    }

    td {
      color: #0f172a;
    }
  }
`;

const ModelList = styled.div`
  display: grid;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px solid rgba(150, 184, 222, 0.16);
`;

const ModelRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #dfe9f8;
  font-size: clamp(10px, 2.6vw, 12px);
  font-weight: 800;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${({ $provider }) => ($provider ? providerAccent($provider) : "inherit")};
  }

  strong {
    color: #a8c3ee;
    font-weight: 800;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;

    strong {
      color: #2563eb;
    }
  }
`;

const CreditsCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(251, 146, 60, 0.18);
  border-radius: 11px;
  background:
    radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.07), transparent 34%),
    #0d1117;

  html[data-forge-theme="light"] & {
    border-color: rgba(249, 115, 22, 0.18);
    background:
      radial-gradient(circle at 100% 0%, rgba(249, 115, 22, 0.08), transparent 34%),
      #f8fafc;
  }
`;

const CreditsTitle = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(11px, 2.8vw, 13px);
  font-weight: 900;

  strong {
    color: #fb923c;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const CreditsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`;

const CreditMetric = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 12, 0.22);

  span {
    overflow: hidden;
    color: #8794a8;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  strong {
    overflow: hidden;
    color: #e5eefb;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: #ffffff;

    span {
      color: #64748b;
    }

    strong {
      color: #0f172a;
    }
  }
`;

const StorageCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background:
    radial-gradient(circle at 100% 0%, rgba(52, 211, 153, 0.06), transparent 34%),
    #0d1117;

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.14);
    background:
      radial-gradient(circle at 100% 0%, rgba(52, 211, 153, 0.08), transparent 34%),
      #f8fafc;
  }
`;

const StorageTitle = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(11px, 2.8vw, 13px);
  font-weight: 900;

  strong {
    color: var(--forge-tint-soft);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const StorageRows = styled.div`
  display: grid;
  gap: 8px;
`;

const StorageRow = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

const StorageRowTop = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #8794a8;
  font-size: 10px;
  font-weight: 900;

  strong {
    color: #e5eefb;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;

    strong {
      color: #0f172a;
    }
  }
`;

const StorageTrack = styled.div`
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.2);

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.1);
  }
`;

const StorageFill = styled.div`
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #60a5fa, #34d399);
  box-shadow: 0 0 16px rgba(96, 165, 250, 0.28);
`;

const tokenomicsRescanSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const TokenomicsFooter = styled.footer`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 0 2px;
  color: rgba(165, 183, 210, 0.52);
  font-size: 10px;
  font-weight: 900;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const TokenomicsRescanButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 24px;
  padding: 4px 9px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.28);
  border-radius: 999px;
  color: var(--forge-tint-soft);
  background: rgba(var(--forge-tint-rgb), 0.1);
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    color 120ms ease,
    opacity 120ms ease;

  &:hover:not(:disabled) {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
    color: #e5eefb;
    background: rgba(var(--forge-tint-rgb), 0.18);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-tint-soft-rgb), 0.72);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.72;
    cursor: default;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.25);
    color: var(--forge-tint);
    background: rgba(var(--forge-tint-rgb), 0.08);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    color: var(--forge-tint);
    background: rgba(var(--forge-tint-rgb), 0.15);
  }
`;

const TokenomicsRescanIcon = styled(Refresh)`
  width: 13px;
  height: 13px;
  flex: none;

  &[data-spinning="true"] {
    animation: ${tokenomicsRescanSpin} 850ms linear infinite;
  }
`;

const TokenomicsEmpty = styled.div`
  color: #9db1c9;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.5;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

/* ---- LIVE harness accounts row (account_list + roster watch) ---- */

const HarnessAccountsCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--forge-tint-rgb), 0.07), transparent 36%),
    #0d1117;

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.15);
    background:
      radial-gradient(circle at 0% 0%, rgba(var(--forge-tint-rgb), 0.08), transparent 36%),
      #f8fafc;
  }
`;

const HarnessWatchBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid ${({ $live }) => ($live ? "rgba(52, 211, 153, 0.4)" : "rgba(250, 204, 21, 0.36)")};
  border-radius: 999px;
  color: ${({ $live }) => ($live ? "#34d399" : "#facc15")};
  background: ${({ $live }) => ($live ? "rgba(52, 211, 153, 0.08)" : "rgba(250, 204, 21, 0.07)")};
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  white-space: nowrap;

  i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
  }

  html[data-forge-theme="light"] & {
    color: ${({ $live }) => ($live ? "#047857" : "#a16207")};
    border-color: ${({ $live }) => ($live ? "rgba(4, 120, 87, 0.3)" : "rgba(161, 98, 7, 0.3)")};
    background: ${({ $live }) => ($live ? "rgba(4, 120, 87, 0.06)" : "rgba(161, 98, 7, 0.06)")};
  }
`;

const HarnessAccountChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
`;

const HarnessAccountChip = styled.button`
  display: grid;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 128px;
  max-width: 240px;
  padding: 7px 10px;
  border: 1px solid ${({ $accent, $active }) => ($active ? $accent : "rgba(148, 163, 184, 0.16)")};
  border-radius: 10px;
  color: #dfe9f8;
  background: ${({ $accent, $active }) => ($active
    ? `color-mix(in srgb, ${$accent} 12%, rgba(16, 21, 28, 0.74))`
    : "rgba(16, 21, 28, 0.48)")};
  font: inherit;
  text-align: left;
  cursor: ${({ $active, $swappable }) => ($active || $swappable === false ? "default" : "pointer")};
  opacity: ${({ $inFlight }) => ($inFlight ? 0.78 : 1)};
  transition: border-color 130ms ease, background 130ms ease, opacity 130ms ease;

  &:hover:not(:disabled) {
    border-color: ${({ $accent }) => $accent};
  }

  &:focus-visible {
    outline: 2px solid ${({ $accent }) => $accent};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: default;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
    border-color: ${({ $accent, $active }) => ($active ? $accent : "rgba(71, 85, 105, 0.2)")};
    background: ${({ $accent, $active }) => ($active
      ? `color-mix(in srgb, ${$accent} 10%, #ffffff)`
      : "#f8fafc")};
  }
`;

const HarnessChipTop = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const HarnessChipName = styled.strong`
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HarnessChipBadge = styled.span`
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid ${({ $accent }) => `color-mix(in srgb, ${$accent} 55%, transparent)`};
  color: ${({ $accent }) => $accent};
  background: ${({ $accent }) => `color-mix(in srgb, ${$accent} 12%, transparent)`};
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  white-space: nowrap;
  ${({ $busy }) => ($busy ? "animation: harness-chip-pulse 900ms ease-in-out infinite;" : "")}

  @keyframes harness-chip-pulse {
    50% {
      opacity: 0.45;
    }
  }
`;

const HarnessChipMeta = styled.span`
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  color: #94a3b8;
  font-size: 10px;
  font-weight: 700;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span[data-role="usage"][data-known="true"] {
    color: #a8c3ee;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  span[data-role="meter"][data-tone="known"] {
    color: #a8c3ee;
    font-variant-numeric: tabular-nums;
  }

  span[data-role="meter"][data-tone="stale"] {
    color: #facc15;
    font-variant-numeric: tabular-nums;
  }

  span[data-role="meter"][data-tone="bad"] {
    color: #ff7f89;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;

    span[data-role="usage"][data-known="true"],
    span[data-role="meter"][data-tone="known"] {
      color: #2563eb;
    }

    span[data-role="meter"][data-tone="stale"] {
      color: #a16207;
    }

    span[data-role="meter"][data-tone="bad"] {
      color: #dc2626;
    }
  }
`;

const HarnessSwapError = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid rgba(255, 79, 91, 0.34);
  border-radius: 8px;
  color: #ff7f89;
  background: rgba(255, 79, 91, 0.1);
  font-size: 11px;
  font-weight: 800;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    flex: none;
    padding: 2px 8px;
    border: 1px solid rgba(255, 79, 91, 0.4);
    border-radius: 999px;
    color: inherit;
    background: transparent;
    font: inherit;
    font-size: 9px;
    font-weight: 900;
    cursor: pointer;
  }
`;

/* ---- harness account management (add / import / remove) styles ---- */

const HarnessChipShell = styled.div`
  position: relative;
  display: flex;
  min-width: 0;
`;

const HarnessChipRemove = styled.button`
  position: absolute;
  top: -5px;
  right: -5px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 999px;
  color: #94a3b8;
  background: #0d1117;
  font-size: 11px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;

  ${HarnessChipShell}:hover &,
  ${HarnessChipShell}:focus-within & {
    opacity: 1;
  }

  &:hover {
    color: #ff7f89;
    border-color: rgba(255, 79, 91, 0.5);
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
    background: #f8fafc;
    border-color: rgba(71, 85, 105, 0.3);

    &:hover {
      color: #dc2626;
      border-color: rgba(220, 38, 38, 0.45);
    }
  }
`;

const HarnessAddChip = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  min-width: 34px;
  min-height: 44px;
  padding: 0 10px;
  border: 1px dashed rgba(148, 163, 184, 0.32);
  border-radius: 10px;
  color: #94a3b8;
  background: transparent;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  transition: border-color 130ms ease, color 130ms ease;

  &:hover,
  &[aria-expanded="true"] {
    border-color: rgba(96, 165, 250, 0.6);
    color: #a8c3ee;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
    border-color: rgba(71, 85, 105, 0.32);

    &:hover,
    &[aria-expanded="true"] {
      border-color: rgba(37, 99, 235, 0.55);
      color: #2563eb;
    }
  }
`;

const HarnessManagePanel = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 9px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  border-radius: 10px;
  background: rgba(16, 21, 28, 0.4);

  html[data-forge-theme="light"] & {
    background: #f1f5f9;
    border-color: rgba(71, 85, 105, 0.24);
  }
`;

const HarnessManageModeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;

  button {
    padding: 2px 9px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 999px;
    color: #94a3b8;
    background: transparent;
    font: inherit;
    font-size: 10px;
    font-weight: 800;
    cursor: pointer;
  }

  button[data-active="true"] {
    color: #a8c3ee;
    border-color: rgba(96, 165, 250, 0.55);
    background: rgba(96, 165, 250, 0.09);
  }

  button[data-close="true"] {
    margin-left: auto;
  }

  html[data-forge-theme="light"] & button {
    color: #64748b;
    border-color: rgba(71, 85, 105, 0.26);
  }

  html[data-forge-theme="light"] & button[data-active="true"] {
    color: #2563eb;
    border-color: rgba(37, 99, 235, 0.5);
    background: rgba(37, 99, 235, 0.07);
  }
`;

const HarnessManageForm = styled.form`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;

  label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    color: #738196;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }

  label[data-grow="true"] {
    flex: 1;
    min-width: 150px;
  }

  input,
  select {
    padding: 4px 8px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 8px;
    color: #dfe9f8;
    background: rgba(13, 17, 23, 0.85);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
  }

  > button[type="submit"] {
    padding: 4px 12px;
    border: 0;
    border-radius: 999px;
    color: #fff;
    background: #2563eb;
    font: inherit;
    font-size: 10px;
    font-weight: 900;
    cursor: pointer;
  }

  > button[type="submit"]:disabled {
    opacity: 0.5;
    cursor: default;
  }

  html[data-forge-theme="light"] & input,
  html[data-forge-theme="light"] & select {
    color: #0f172a;
    background: #ffffff;
    border-color: rgba(71, 85, 105, 0.26);
  }
`;

const HarnessManageNote = styled.span`
  color: #9db1c9;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.5;
  text-transform: none;
  letter-spacing: normal;

  &[data-tone="error"] {
    color: #ff7f89;
  }

  button {
    padding: 1px 7px;
    border: 1px solid currentColor;
    border-radius: 999px;
    color: inherit;
    background: transparent;
    font: inherit;
    font-size: 9px;
    font-weight: 900;
    cursor: pointer;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;

    &[data-tone="error"] {
      color: #dc2626;
    }
  }
`;

const HarnessManageImport = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;

  strong {
    color: #738196;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
`;

const HarnessManageImportRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  button {
    padding: 3px 10px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 999px;
    color: #dfe9f8;
    background: rgba(16, 21, 28, 0.48);
    font: inherit;
    font-size: 10.5px;
    font-weight: 800;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  button:hover:not(:disabled) {
    border-color: rgba(96, 165, 250, 0.6);
  }

  html[data-forge-theme="light"] & button {
    color: #0f172a;
    background: #ffffff;
    border-color: rgba(71, 85, 105, 0.26);
  }
`;

const HarnessManageFlowCard = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(96, 165, 250, 0.3);
  border-radius: 9px;
  color: #dfe9f8;
  background: rgba(96, 165, 250, 0.05);
  font-size: 11px;
  font-weight: 700;

  &[data-phase="failed"],
  &[data-phase="unavailable"] {
    border-color: rgba(255, 79, 91, 0.34);
    color: #ff7f89;
    background: rgba(255, 79, 91, 0.07);
  }

  &[data-phase="succeeded"] {
    border-color: rgba(52, 211, 153, 0.4);
    color: #34d399;
    background: rgba(52, 211, 153, 0.07);
  }

  span {
    min-width: 0;
  }

  button {
    padding: 2px 9px;
    border: 1px solid currentColor;
    border-radius: 999px;
    color: inherit;
    background: transparent;
    font: inherit;
    font-size: 9px;
    font-weight: 900;
    cursor: pointer;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;

    &[data-phase="failed"],
    &[data-phase="unavailable"] {
      color: #dc2626;
    }

    &[data-phase="succeeded"] {
      color: #047857;
    }
  }
`;

const HarnessManageCode = styled.code`
  padding: 2px 9px;
  border: 1px dashed rgba(148, 163, 184, 0.4);
  border-radius: 7px;
  color: #dfe9f8;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;

  html[data-forge-theme="light"] & {
    color: #0f172a;
    border-color: rgba(71, 85, 105, 0.4);
  }
`;

const HarnessManageUrl = styled.button`
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0 !important;
  color: #a8c3ee;
  background: transparent;
  font: inherit;
  font-size: 10.5px;
  text-decoration: underline;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  html[data-forge-theme="light"] & {
    color: #2563eb;
  }
`;

const HarnessManageConfirm = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid rgba(250, 204, 21, 0.36);
  border-radius: 8px;
  color: #facc15;
  background: rgba(250, 204, 21, 0.07);
  font-size: 11px;
  font-weight: 800;

  span {
    min-width: 0;
    flex: 1;
  }

  button {
    flex: none;
    padding: 2px 9px;
    border: 1px solid currentColor;
    border-radius: 999px;
    color: inherit;
    background: transparent;
    font: inherit;
    font-size: 9px;
    font-weight: 900;
    cursor: pointer;
  }

  button[data-danger="true"] {
    border-color: rgba(255, 79, 91, 0.6);
    color: #ff7f89;
    background: rgba(255, 79, 91, 0.09);
  }

  html[data-forge-theme="light"] & {
    color: #a16207;
    border-color: rgba(161, 98, 7, 0.3);
    background: rgba(161, 98, 7, 0.05);

    button[data-danger="true"] {
      color: #dc2626;
      border-color: rgba(220, 38, 38, 0.5);
    }
  }
`;

function AccountsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M15.5 5.6a3.5 3.5 0 0 1 0 5.8M17.6 14.4c1.6.8 2.6 2.4 2.9 4.6" />
    </svg>
  );
}
