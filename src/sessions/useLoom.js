import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT } from "./sessionsRosterBootstrap.js";

import {
  archiveOutcomeView,
  cancelOutcomeView,
  confirmOutcomeView,
  draftFenceFor,
  draftView,
  installItemView,
  installJobView,
  LOOM_CURSOR_BASELINE,
  loomConflictView,
  loomCursorAdvances,
  loomCursorOrNull,
  loomUnavailableFromError,
  personaBindingView,
  registryDeltaView,
  registryEntryView,
  registryFenceFor,
  registryListView,
  registryWatchView,
  registrationReceiptView,
  retryOutcomeView,
  validationView,
  watchOutcomeView,
} from "./loomModel.js";

/* These are the Tauri event names registered by the Loom SDK bridge. A gap
   or reconnect is a baseline-re-read signal; neither is reduced locally. */
export const LOOM_REGISTRY_DELTA_EVENT = "loom-registry-delta";
export const LOOM_REGISTRY_CAUGHT_UP_EVENT = "loom-registry-caught-up";

const NEW_FEATURES = Object.freeze([
  "validate",
  "authoring",
  "archive",
  "watch",
  "cancel",
]);

const EMPTY_FEATURE_FLAGS = Object.freeze(Object.fromEntries(
  NEW_FEATURES.map((feature) => [feature, false]),
));

const EMPTY_FEATURE_ERRORS = Object.freeze(Object.fromEntries(
  NEW_FEATURES.map((feature) => [feature, ""]),
));

function entryMatches(entry, registryKind, id) {
  return entry?.registryKind === registryKind && entry?.id === id;
}

function entryFromDelta(delta, fallback = null) {
  if (delta.entry && typeof delta.entry === "object") {
    const registryKind = delta.registryKind
      ?? (delta.entry.kind === "workflow" ? "workflow" : fallback?.registryKind)
      ?? "agent_type";
    return registryEntryView(delta.entry, registryKind, delta.kind === "archived");
  }
  return fallback;
}

/* Apply only known, cursor-validated deltas. A fact the delta does not carry
   is retained; an unknown action is handled by re-baselining in the effect. */
function applyRegistryDelta(current, delta) {
  const registryKind = delta.registryKind
    ?? (delta.entry?.kind === "workflow" ? "workflow" : "agent_type");
  const id = delta.id ?? delta.entry?.id ?? null;
  if (!id) return current;
  const activeKey = registryKind === "workflow" ? "activeWorkflows" : "activeAgentTypes";
  const active = current[activeKey];
  const activeExisting = active.find((entry) => entryMatches(entry, registryKind, id)) ?? null;
  const archived = Array.isArray(current.archivedEntries) ? current.archivedEntries : [];
  const archivedExisting = archived.find((entry) => entryMatches(entry, registryKind, id)) ?? null;
  const withoutActive = active.filter((entry) => !entryMatches(entry, registryKind, id));
  const withoutArchived = archived.filter((entry) => !entryMatches(entry, registryKind, id));

  if (delta.kind === "removed") {
    return {
      ...current,
      [activeKey]: withoutActive,
      archivedEntries: current.archivedEntries == null ? null : withoutArchived,
    };
  }
  if (delta.kind === "archived") {
    const entry = entryFromDelta(delta, activeExisting ?? archivedExisting);
    if (!entry) return current;
    return {
      ...current,
      [activeKey]: withoutActive,
      archivedEntries: [...withoutArchived, { ...entry, archived: true }],
    };
  }
  if (["unarchived", "upserted", "registered", "updated"].includes(delta.kind)) {
    const entry = entryFromDelta(delta, archivedExisting ?? activeExisting);
    if (!entry) return current;
    return {
      ...current,
      [activeKey]: [...withoutActive, { ...entry, archived: false }],
      archivedEntries: current.archivedEntries == null ? null : withoutArchived,
    };
  }
  return current;
}

/* React seam for the Loom agent-type registry. The hook carries daemon facts
   through the loomModel transforms and adds nothing of its own: cli_present
   is stored verbatim (its key ABSENCE is the "unprobed" third state, so it
   must not be reshaped), install jobs keep unknown states raw, and the only
   persona-binding truth is the receipts this hook has actually seen. A
   daemon that lacks the feature settles into `unavailable` once — no retry
   spam. */

export function useLoom({ enabled = true } = {}) {
  const [registry, setRegistry] = useState({
    activeAgentTypes: [],
    activeWorkflows: [],
    /* null = archived excluded by default / not explicitly read. */
    archivedEntries: null,
    cliPresent: {},
  });
  /* agentTypeId -> { jobs: installJobView[], items: installItemView[], error } */
  const [installByType, setInstallByType] = useState({});
  /* sessionId -> personaBindingView. ONLY receipts populate this: a session
     without an entry has an UNKNOWN binding, not "no persona". */
  const [personaBySession, setPersonaBySession] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [featureUnavailable, setFeatureUnavailable] = useState(EMPTY_FEATURE_FLAGS);
  const [featureErrors, setFeatureErrors] = useState(EMPTY_FEATURE_ERRORS);
  const [authoringConflict, setAuthoringConflict] = useState(null);
  const [cancelByJob, setCancelByJob] = useState({});
  const [registryWatchId, setRegistryWatchId] = useState(null);
  const [registryCursor, setRegistryCursor] = useState(null);

  const unavailableRef = useRef(false);
  const featureUnavailableRef = useRef({ ...EMPTY_FEATURE_FLAGS });
  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  const settleError = useCallback((thrown, fallback) => {
    if (loomUnavailableFromError(thrown)) {
      markUnavailable();
      return true;
    }
    setError(String(thrown?.message ?? thrown ?? fallback));
    return false;
  }, [markUnavailable]);

  const markFeatureUnavailable = useCallback((feature) => {
    featureUnavailableRef.current[feature] = true;
    setFeatureUnavailable((current) => ({ ...current, [feature]: true }));
  }, []);

  const clearFeatureError = useCallback((feature) => {
    setFeatureErrors((current) => (
      current[feature] ? { ...current, [feature]: "" } : current
    ));
  }, []);

  const settleFeatureError = useCallback((feature, thrown, fallback) => {
    if (loomUnavailableFromError(thrown)) {
      markFeatureUnavailable(feature);
      return true;
    }
    setFeatureErrors((current) => ({
      ...current,
      [feature]: String(thrown?.message ?? thrown ?? fallback),
    }));
    return false;
  }, [markFeatureUnavailable]);

  const installRegistryView = useCallback((view) => {
    setRegistry((current) => ({
      activeAgentTypes: view.activeAgentTypes,
      activeWorkflows: view.activeWorkflows,
      archivedEntries: view.archivedIncluded
        ? view.archivedEntries
        : current.archivedEntries,
      cliPresent: view.cliPresentPublished ? view.cliPresent : current.cliPresent,
    }));
  }, []);

  const list = useCallback(async () => {
    /* An unavailable daemon stays unavailable for this hook's lifetime —
       never poll a feature the daemon told us it does not have. */
    if (unavailableRef.current) return false;
    setLoading(true);
    try {
      const result = await invoke("loom_list");
      /* registryListView applies the shipped agentTypeView and keeps the
         default read's archived set UNKNOWN rather than manufacturing []. */
      installRegistryView(registryListView(result, { includeArchived: false }));
      setAuthoringConflict((current) => (
        current?.source === "archive" ? null : current
      ));
      setError("");
      return true;
    } catch (thrown) {
      settleError(thrown, "Unable to list agent types.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [installRegistryView, settleError]);

  /* Only this explicit read is allowed to establish an empty archived set.
     Its feature gate is independent of the default registry list. */
  const listArchived = useCallback(async () => {
    if (!enabled || featureUnavailableRef.current.archive) return null;
    try {
      const result = await invoke("loom_list", { include_archived: true });
      const view = registryListView(result, { includeArchived: true });
      installRegistryView(view);
      clearFeatureError("archive");
      return view;
    } catch (thrown) {
      settleFeatureError("archive", thrown, "Unable to read archived registry entries.");
      return null;
    }
  }, [clearFeatureError, enabled, installRegistryView, settleFeatureError]);

  useEffect(() => {
    if (!enabled) return;
    void list();
  }, [enabled, list]);

  const installStatus = useCallback(async (agentTypeId) => {
    if (!agentTypeId || unavailableRef.current) return null;
    try {
      const status = await invoke("loom_install_status", { agent_type_id: agentTypeId });
      const view = {
        jobs: Array.isArray(status?.jobs) ? status.jobs.map(installJobView) : [],
        items: Array.isArray(status?.items) ? status.items.map(installItemView) : [],
        error: "",
      };
      setInstallByType((current) => ({ ...current, [agentTypeId]: view }));
      return view;
    } catch (thrown) {
      if (!settleError(thrown, "Unable to read install status.")) {
        setInstallByType((current) => ({
          ...current,
          [agentTypeId]: {
            jobs: current[agentTypeId]?.jobs || [],
            items: current[agentTypeId]?.items || [],
            error: String(thrown?.message ?? thrown ?? "Unable to read install status."),
          },
        }));
      }
      return null;
    }
  }, [settleError]);

  const register = useCallback(async (fields) => {
    if (unavailableRef.current) return null;
    try {
      const receipt = await invoke("loom_register_agent_type", {
        id: fields.id,
        name: fields.name,
        job: fields.job,
        in_type: fields.inType,
        out_type: fields.outType,
        clis: fields.clis,
        apis: fields.apis,
        skills: fields.skills,
        scripts: fields.scripts,
        color: fields.color,
        glyph: fields.glyph,
      });
      const view = registrationReceiptView(receipt);
      await list();
      /* An absent install_job_id means there is NO install job to disclose —
         only a receipt that names one warrants an install-status read. */
      if (view.installJobId != null) void installStatus(view.id);
      return view;
    } catch (thrown) {
      settleError(thrown, "Unable to register the agent type.");
      return null;
    }
  }, [installStatus, list, settleError]);

  /* Requeue applies only to a job the daemon reported failed; the section
     never offers this for other states, and the daemon's rejection (or an
     unknown future outcome) is returned verbatim for display. */
  const retry = useCallback(async (installJobId) => {
    if (!installJobId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("loom_install_retry", { install_job_id: installJobId });
      const outcome = retryOutcomeView(receipt?.outcome);
      if (outcome.status === "requeued") {
        const fresh = outcome.job;
        setInstallByType((current) => {
          const bucket = current[fresh.agentTypeId];
          if (!bucket) return current;
          return {
            ...current,
            [fresh.agentTypeId]: {
              ...bucket,
              jobs: bucket.jobs.map((row) => (row.jobId === fresh.jobId ? fresh : row)),
            },
          };
        });
      }
      return outcome;
    } catch (thrown) {
      settleError(thrown, "Unable to retry the install job.");
      return null;
    }
  }, [settleError]);

  const watch = useCallback(async (installJobId, afterCursor = 0) => {
    if (!installJobId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("loom_install_watch", {
        install_job_id: installJobId,
        after_cursor: afterCursor,
      });
      const outcome = watchOutcomeView(receipt?.outcome);
      if (outcome.status === "watching" && outcome.events.length > 0) {
        const latest = outcome.events[outcome.events.length - 1].job;
        setInstallByType((current) => {
          const bucket = current[latest.agentTypeId];
          if (!bucket) return current;
          return {
            ...current,
            [latest.agentTypeId]: {
              ...bucket,
              jobs: bucket.jobs.map((row) => (row.jobId === latest.jobId ? latest : row)),
            },
          };
        });
      }
      return outcome;
    } catch (thrown) {
      settleError(thrown, "Unable to watch the install job.");
      return null;
    }
  }, [settleError]);

  const validate = useCallback(async (kind, text) => {
    if (!enabled || featureUnavailableRef.current.validate) return null;
    try {
      const receipt = await invoke("loom_validate", { kind, text });
      const view = validationView(receipt);
      clearFeatureError("validate");
      return view;
    } catch (thrown) {
      settleFeatureError("validate", thrown, "Unable to validate this draft.");
      return null;
    }
  }, [clearFeatureError, enabled, settleFeatureError]);

  const authorDraft = useCallback(async (sessionId, kind, prose) => {
    if (!enabled || !sessionId || featureUnavailableRef.current.authoring) return null;
    setAuthoringConflict(null);
    try {
      const receipt = await invoke("loom_author_draft", {
        session_id: sessionId,
        kind,
        prose,
      });
      const view = draftView(receipt?.draft);
      clearFeatureError("authoring");
      return view;
    } catch (thrown) {
      const conflict = loomConflictView(thrown);
      if (conflict) setAuthoringConflict({ ...conflict, source: "authoring" });
      settleFeatureError("authoring", thrown, "Unable to draft this registry entry.");
      return null;
    }
  }, [clearFeatureError, enabled, settleFeatureError]);

  const authorRevise = useCallback(async (draft, kind, text) => {
    if (!enabled || featureUnavailableRef.current.authoring) return null;
    const fence = draftFenceFor(draft);
    if (fence == null) {
      setFeatureErrors((current) => ({
        ...current,
        authoring: "Re-read the authoring draft before revising; its fence was not published.",
      }));
      return null;
    }
    setAuthoringConflict(null);
    try {
      const receipt = await invoke("loom_author_revise", {
        authoring_id: fence.authoring_id,
        expected_revision: fence.expected_revision,
        kind,
        text,
      });
      const view = draftView(receipt?.draft);
      clearFeatureError("authoring");
      return view;
    } catch (thrown) {
      const conflict = loomConflictView(thrown);
      if (conflict) setAuthoringConflict({ ...conflict, source: "authoring" });
      /* Conflict is terminal for this attempt: never resubmit with the
         daemon's current value. An explicit new draft read is required. */
      settleFeatureError("authoring", thrown, "Unable to revise this authoring draft.");
      return null;
    }
  }, [clearFeatureError, enabled, settleFeatureError]);

  const authorConfirm = useCallback(async (draft, kind, text, listedEntry = null) => {
    if (!enabled || featureUnavailableRef.current.authoring) return null;
    const authoringFence = draftFenceFor(draft);
    if (authoringFence == null) {
      setFeatureErrors((current) => ({
        ...current,
        authoring: "Re-read the authoring draft before confirming; its fence was not published.",
      }));
      return null;
    }
    /* expected_rev/expected_digest come from an entry the client listed, or
       from the returned draft when it explicitly carried those values. */
    const registryFence = registryFenceFor(listedEntry) ?? registryFenceFor(draft);
    const payload = {
      authoring_id: authoringFence.authoring_id,
      expected_revision: authoringFence.expected_revision,
      kind,
      text,
    };
    if (registryFence != null) {
      payload.expected_rev = registryFence.expected_rev;
      payload.expected_digest = registryFence.expected_digest;
    }
    setAuthoringConflict(null);
    try {
      const receipt = await invoke("loom_author_confirm", payload);
      const outcome = confirmOutcomeView(receipt);
      clearFeatureError("authoring");
      if (outcome.kind === "confirmed") {
        await list();
        if (registry.archivedEntries != null) void listArchived();
      }
      return outcome;
    } catch (thrown) {
      const conflict = loomConflictView(thrown);
      if (conflict) setAuthoringConflict({ ...conflict, source: "authoring" });
      /* Never auto-retry a confirm with current_rev/current_digest. */
      settleFeatureError("authoring", thrown, "Unable to confirm this authoring draft.");
      return null;
    }
  }, [clearFeatureError, enabled, list, listArchived, registry.archivedEntries, settleFeatureError]);

  const setArchived = useCallback(async (entry, shouldArchive) => {
    if (!enabled || featureUnavailableRef.current.archive) return null;
    const kind = entry?.registryKind;
    const id = entry?.id;
    const fence = registryFenceFor(entry);
    if (!kind || !id || fence == null || fence.expected_rev == null) {
      setFeatureErrors((current) => ({
        ...current,
        archive: "Re-read this registry entry before changing its archive state; its CAS fence was not published.",
      }));
      return null;
    }
    const payload = {
      kind,
      id,
      expected_rev: fence.expected_rev,
    };
    if (fence.expected_digest != null) {
      payload.expected_digest = fence.expected_digest;
    }
    setAuthoringConflict(null);
    try {
      const receipt = shouldArchive
        ? await invoke("loom_archive", payload)
        : await invoke("loom_unarchive", payload);
      const outcome = archiveOutcomeView(receipt);
      clearFeatureError("archive");
      if (["changed", "already", "not_found"].includes(outcome.kind)) {
        await list();
        if (registry.archivedEntries != null || shouldArchive) void listArchived();
      }
      return outcome;
    } catch (thrown) {
      const conflict = loomConflictView(thrown);
      if (conflict) setAuthoringConflict({ ...conflict, source: "archive" });
      /* Current fences are display-only; an explicit list read is required. */
      settleFeatureError("archive", thrown, "Unable to change this entry's archive state.");
      return null;
    }
  }, [clearFeatureError, enabled, list, listArchived, registry.archivedEntries, settleFeatureError]);

  const cancelInstall = useCallback(async (installJobId) => {
    if (!enabled || !installJobId || featureUnavailableRef.current.cancel) return null;
    try {
      const receipt = await invoke("loom_install_cancel", { install_job_id: installJobId });
      const outcome = cancelOutcomeView(receipt);
      setCancelByJob((current) => ({ ...current, [installJobId]: outcome }));
      clearFeatureError("cancel");
      if (outcome.kind === "cancelled" || outcome.kind === "already_terminal") {
        const owner = Object.entries(installByType).find(([, bucket]) => (
          bucket?.jobs?.some((job) => job.jobId === installJobId)
        ));
        if (owner) void installStatus(owner[0]);
      }
      return outcome;
    } catch (thrown) {
      settleFeatureError("cancel", thrown, "Unable to cancel this install job.");
      return null;
    }
  }, [clearFeatureError, enabled, installByType, installStatus, settleFeatureError]);

  /* One registry watch registration. after_cursor is a validated decimal
     STRING and advances only from daemon-published string cursors. */
  const registryWatch = useCallback(async (afterCursor) => {
    if (!enabled || featureUnavailableRef.current.watch) return null;
    const position = loomCursorOrNull(afterCursor) ?? LOOM_CURSOR_BASELINE;
    try {
      const receipt = await invoke("loom_watch", { after_cursor: position });
      const view = registryWatchView(receipt);
      clearFeatureError("watch");
      return view;
    } catch (thrown) {
      settleFeatureError("watch", thrown, "Unable to watch the Loom registry.");
      return null;
    }
  }, [clearFeatureError, enabled, settleFeatureError]);

  const registryWatchRef = useRef(registryWatch);
  useEffect(() => {
    registryWatchRef.current = registryWatch;
  }, [registryWatch]);

  useEffect(() => {
    if (!enabled || featureUnavailable.watch) return undefined;
    let disposed = false;
    let localWatchId = null;
    let heldCursor = LOOM_CURSOR_BASELINE;
    let daemonGeneration = null;
    let watchEpoch = 0;
    let rebaselinePromise = null;
    const pending = [];
    const pendingCaughtUps = [];
    const unlisteners = [];

    const rebaseline = () => {
      if (rebaselinePromise) return rebaselinePromise;
      const epoch = watchEpoch;
      const request = registryWatchRef.current(heldCursor).then((view) => {
        if (!disposed && epoch === watchEpoch && view) {
          localWatchId = view.watchId;
          heldCursor = view.cursor ?? LOOM_CURSOR_BASELINE;
          installRegistryView(view.baseline);
          setRegistryWatchId(view.watchId);
          setRegistryCursor(view.cursor);
          const queued = pending.splice(0);
          for (const delta of queued) receiveDelta(delta);
          const queuedCaughtUps = pendingCaughtUps.splice(0);
          for (const caughtUp of queuedCaughtUps) receiveCaughtUp(caughtUp);
        }
        return view;
      }).finally(() => {
        if (rebaselinePromise === request) rebaselinePromise = null;
      });
      rebaselinePromise = request;
      return request;
    };

    const receiveDelta = (payload) => {
      const delta = registryDeltaView(payload);
      if (localWatchId == null) {
        pending.push(payload);
        return;
      }
      if (delta.watchId != null && delta.watchId !== localWatchId) return;
      if (delta.kind === "rebaseline" || delta.kind === "unknown" || delta.cursor == null) {
        void rebaseline();
        return;
      }
      /* A published after_cursor that does not equal our held cursor is an
         explicit gap. Re-read the baseline; do not infer missing deltas. */
      if (delta.afterCursor != null && delta.afterCursor !== heldCursor) {
        void rebaseline();
        return;
      }
      if (!loomCursorAdvances(heldCursor, delta.cursor)) return;
      heldCursor = delta.cursor;
      setRegistryCursor(delta.cursor);
      setRegistry((current) => applyRegistryDelta(current, delta));
    };

    const receiveCaughtUp = (payload) => {
      if (localWatchId == null) {
        pendingCaughtUps.push(payload);
        return;
      }
      if (payload?.watch_id != null && payload.watch_id !== localWatchId) return;
      const highWater = loomCursorOrNull(payload?.high_water_cursor);
      /* Caught-up above our held cursor proves a missed delta (including a
         reconnect gap). Re-register for an authoritative baseline. */
      if (highWater != null && loomCursorAdvances(heldCursor, highWater)) {
        void rebaseline();
      }
    };

    const receiveRosterBootstrap = (payload) => {
      if (payload?.state !== "reachable" || payload.daemon_generation == null) return;
      if (daemonGeneration == null) {
        daemonGeneration = payload.daemon_generation;
        return;
      }
      if (payload.daemon_generation === daemonGeneration) return;
      /* A new SDK connection invalidates the connection-scoped watch id.
         Start from the protocol baseline string and accept only the fresh
         loom.watch baseline; never splice old/new pushed tails together. */
      daemonGeneration = payload.daemon_generation;
      watchEpoch += 1;
      rebaselinePromise = null;
      localWatchId = null;
      heldCursor = LOOM_CURSOR_BASELINE;
      setRegistryWatchId(null);
      setRegistryCursor(null);
      void rebaseline();
    };

    Promise.all([
      listen(LOOM_REGISTRY_DELTA_EVENT, (event) => receiveDelta(event.payload)),
      listen(LOOM_REGISTRY_CAUGHT_UP_EVENT, (event) => receiveCaughtUp(event.payload)),
      listen(HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT, (event) => (
        receiveRosterBootstrap(event.payload)
      )),
    ]).then((stops) => {
      if (disposed) {
        for (const stop of stops) stop();
        return;
      }
      unlisteners.push(...stops);
      void rebaseline();
    }).catch((thrown) => {
      settleFeatureError("watch", thrown, "Unable to listen for Loom registry updates.");
    });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [enabled, featureUnavailable.watch, installRegistryView, settleFeatureError]);

  /* Persona binding: binds an agent-type persona to the session and NOTHING
     more — no install, no PATH proof, no execution grant. The daemon's
     receipt (not the request) is the binding authority we store. The wire
     command REQUIRES a String agent_type_id — the SDK has no unbind — so
     only a real, non-empty agent-type id is ever dispatched. */
  const select = useCallback(async (sessionId, agentTypeId) => {
    const typeId = typeof agentTypeId === "string" ? agentTypeId.trim() : "";
    if (!sessionId || !typeId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("session_select_agent_type", {
        session_id: sessionId,
        agent_type_id: typeId,
      });
      const binding = personaBindingView(receipt);
      const key = binding.sessionId || sessionId;
      setPersonaBySession((current) => ({ ...current, [key]: binding }));
      return binding;
    } catch (thrown) {
      settleError(thrown, "Unable to bind the persona.");
      return null;
    }
  }, [settleError]);

  return {
    agentTypes: registry.activeAgentTypes,
    workflowEntries: registry.activeWorkflows,
    archivedEntries: registry.archivedEntries,
    cliPresent: registry.cliPresent,
    installByType,
    personaBySession,
    cancelByJob,
    registryWatchId,
    registryCursor,
    loading,
    error,
    unavailable,
    featureUnavailable,
    featureErrors,
    authoringConflict,
    list,
    listArchived,
    register,
    installStatus,
    retry,
    watch,
    validate,
    authorDraft,
    authorRevise,
    authorConfirm,
    setArchived,
    cancelInstall,
    registryWatch,
    select,
  };
}
