import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { Forum } from "@styled-icons/material-rounded/Forum";
import { History } from "@styled-icons/material-rounded/History";
import { Language } from "@styled-icons/material-rounded/Language";
import { Mediation } from "@styled-icons/material-rounded/Mediation";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { MoreHoriz } from "@styled-icons/material-rounded/MoreHoriz";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { NotificationsActive } from "@styled-icons/material-rounded/NotificationsActive";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { Terminal as TerminalGlyph } from "@styled-icons/material-rounded/Terminal";
import { Timeline } from "@styled-icons/material-rounded/Timeline";

import {
  ButtonDarkModeIcon,
  ButtonLightModeIcon,
  ButtonCloseIcon,
  ButtonAddIcon,
} from "../app/appStyles.js";
import { PlanFlame } from "../app/PlanFlame.jsx";
import SessionComposer from "./SessionComposer.jsx";
import {
  COMMAND_DOOR_FEATURE,
  catalogToSlashCommands,
  createCommandDoorExecutor,
} from "./commandDoor.js";
import {
  buildCommandSlots,
  librarySnapshotNeedsRetry,
  modelGroupsFromLibrary,
  modelOptionCatalog,
} from "./haiderClientContract.js";
import {
  applySessionSurfaceStatusEvent,
  surfaceRunStatusView,
  surfaceStatusPillView,
} from "./sessionStatus.js";
import {
  SessionAvailabilityAffordance,
  sessionAvailabilityPresentation,
} from "./sessionAvailability.js";
import {
  rehomeSessionPane,
  rehomeSessionViewMode,
  sessionPaneId,
} from "./sessionPaneOwnership.js";
import {
  applyLegacySessionBinding,
  applyResidentBindingSnapshot,
  initialSessionBindingState,
  sessionBindingAnnouncement,
} from "./sessionTerminalBinding.js";
import SessionPersonaSelect from "./SessionPersonaSelect.jsx";
import WorkflowStatusChip from "./WorkflowStatusChip.jsx";
import SessionTerminal from "./SessionTerminal.jsx";
import SessionTrajectory from "./SessionTrajectory.jsx";
import SessionTranscript from "./SessionTranscript.jsx";
import FleetPanel from "./FleetPanel.jsx";
import FleetChildTranscript from "./FleetChildTranscript.jsx";
import MonitorPanel from "./MonitorPanel.jsx";
import CheckpointPanel from "./CheckpointPanel.jsx";
import WorkflowGraphView from "./WorkflowGraphView.jsx";
import SessionLifecycleMenuItems from "./SessionLifecycleMenuItems.jsx";
import { findFleetNode, fleetSessionIds } from "./fleetModel.js";
import {
  formatSessionRelativeTime,
  sessionModelProviderFallback,
} from "./sessionsModel.js";
import {
  sessionActivityVisualState,
  sessionRunCanCancel,
  sessionRunIsActive,
} from "./sessionActivity.js";
import {
  activeSessionSyncReport,
  createSessionSyncLifecycleReporter,
  sessionSyncTransportState,
} from "./sessionSync.js";
import { viewportMenuPosition } from "./viewportMenuPosition.js";
import SessionQueuePanel from "./SessionQueuePanel.jsx";
import {
  applyQueueDelta,
  createQueueInvokeBoundary,
  effectiveSessionDeliveryMode,
  FEATURE_QUEUE_CONTROL_V1,
  mutateQueueRowWithRetry,
  queueControlAvailable,
  queueListFailed,
  queueListStarted,
  queueListSucceeded,
  queueStateForFeatures,
  sessionComposerDeliveryModeProps,
} from "./queueViewModel.js";
import {
  normalizeDeliveryMode,
  ownSubmissionConfirmation,
  submitSessionPrompt,
} from "./sessionSubmit.js";

/* Main-pane surface for sessions — the Session Deck workspace.

   Structure (per the approved /sdc design, user iteration 2):
   - NO top bar. ONE header row on every tab: small session title + its
     ellipsis menu (Pin/Rename) on the left, the view cluster on the right —
     Chat|Shell|Traj segmented toggle (panel tabs — Web, PCB, AI Video —
     ride the same control via its "+"), the exact harness status pill, and
     the theme toggle. The row wraps only when the pane is narrow. App-level
     pills (Background, sync) are RAIL-owned, never here.
   - Transcript and composer share one centered ~54rem measure; the Shell
     view alone bleeds full-width.
   - A session is harness data, not a PTY: Chat view reads the projection.
     For the ACTIVE session (and the draft) Chat and Shell BOTH stay mounted
     — the unselected view collapses to display:none — so toggling is
     instant and the shell is already warm. Background sessions mount
     nothing; their PTYs persist daemon-side and are re-adopted on return.
   - "New chat" is a draft; the first prompt materializes it. */

/* Waking a dormant session is a PTY spawn plus a harness handshake, so the
   submit ladder is patient — the alternative is dropping what the user
   typed, which is the one thing here that cannot be recreated. */
const SUBMIT_WAKE_ATTEMPTS = 6;
const SUBMIT_WAKE_BACKOFF_MS = 700;
const SUBMIT_HOLD_CLEAR_MS = 6000;
const SUBMIT_CONFIRMATION_MS = 5000;

const queueInvokeBoundary = createQueueInvokeBoundary(invoke);


const PANEL_KINDS = {
  web: { label: "Web", Icon: Language },
  pcb: { label: "PCB Design", Icon: Memory },
  video: { label: "AI Video Editor", Icon: Movie },
};

function publishedCheckpointBranchId(session) {
  return typeof session?.branch_id === "string" && session.branch_id.length > 0
    ? session.branch_id
    : null;
}

export default function SessionSurface({
  activeSessionId,
  appThemeIsLight = false,
  draftOpen,
  onDraftMaterialized,
  onHeaderDragStart = null,
  onOpenSession,
  onPopOutSession = null,
  onResetToDraft,
  onSessionsRefresh = null,
  onShellWarm = null,
  onSyncingChange,
  shellPrefs = {},
  onToggleTheme,
  openSessions,
  planKey = "free",
  sessions = [],
  loomAgentTypes = [],
  loomPersonaBySession = {},
  onSelectPersona = null,
  workflowStatusBySession = {},
  workflowUnavailable = false,
  fleetBySession = {},
  fleetChildDigests = {},
  fleetError = "",
  fleetLoading = false,
  fleetUnavailable = false,
  onLoadFleet = null,
  onObserveFleetChild = null,
  onObserveFleetBatch = null,
  onSendAgentMessage = null,
  descendantEntry = null,
  descendantError = "",
  descendantLoading = false,
  descendantMode = "unavailable",
  descendantRepair = null,
  descendantSessionId = "",
  onReconnectDescendantStream = null,
  onStartDescendantStream = null,
  onStopDescendantStream = null,
  monitorBySession = {},
  monitorDeliveries = [],
  monitorCursor = null,
  monitorWatchOutcome = null,
  monitorError = "",
  monitorLoading = false,
  monitorUnavailable = false,
  onLoadMonitors = null,
  onRegisterMonitor = null,
  onRemoveMonitor = null,
  onStartMonitorWatch = null,
  onStopMonitorWatch = null,
  checkpointBySession = {},
  checkpointConflictBySession = {},
  checkpointErrorBySession = {},
  checkpointLoadingBySession = {},
  checkpointPendingBySession = {},
  checkpointReceiptBySession = {},
  checkpointUnavailable = false,
  onLoadCheckpoints = null,
  onLoadMoreCheckpoints = null,
  onUndoCheckpoint = null,
  onRedoCheckpoint = null,
  onRollbackCheckpointTurn = null,
  workflowGraphBySession = {},
  workflowGraphCursor = null,
  workflowGraphEvents = [],
  workflowGraphError = "",
  workflowGraphUnavailable = false,
  onWatchWorkflowGraph = null,
  lifecyclePendingBySession = {},
  lifecycleErrorBySession = {},
  lifecycleUnavailableByAction = {},
  onRenameSession = null,
  onCompactSession = null,
  onForkSession = null,
  onRetrySession = null,
}) {
  const [viewModes, setViewModes] = useState({});
  /* Fleet drilldown selection: sessionId -> selected agent_id. Only the REAL
     agent id from the snapshot is stored; the node view is re-resolved from
     the CURRENT tree on every render, so a refresh never leaves a stale
     node copy rendered. */
  const [fleetSelected, setFleetSelected] = useState({});
  /* Spawn discipline: selecting a session never spawns anything — the Shell
     PTY mounts (and adopts/spawns) only after the Shell view is first shown
     for that session; from then on it stays warm-mounted. */
  const [shellTouched, setShellTouched] = useState({});
  const [sessionTabs, setSessionTabs] = useState({});
  /* Composer drafts are SURFACE-owned, keyed by session id ("draft" for the
     unmaterialized chat): the composer unmounts on view/session switches, so
     the text must outlive it. Daemon revision lanes are PER-CONNECTION
     (rev934 P1-1), so frames are discriminated by OWNER, never by comparing
     revisions across lanes: mirrorRevisionsRef stamps only OUR publishes;
     mirrorHistoryRef remembers our recent publishes so any pending echo
     (revision AND text match) teaches us our owner id; foreign lanes keep
     per-owner applied floors in mirrorForeignRef. A fresh TUI's revision 1
     applies. */
  const [composerTexts, setComposerTexts] = useState({});
  const composerTextsRef = useRef(composerTexts);
  composerTextsRef.current = composerTexts;
  /* Paste blocks are surface-owned like the text — they must survive the
     composer unmounting on view/session switches, or the mirror and the
     submit diverge from what the chips show. */
  const [composerPastes, setComposerPastes] = useState({});
  /* Edit generation per session: a submit's success-clear applies only if
     the user hasn't edited since — a stale completion from a session the
     user switched away from must never wipe fresh text. */
  const editGenRef = useRef({});
  const setComposerPastesFor = useCallback((sessionId, blocks) => {
    editGenRef.current[sessionId] = (editGenRef.current[sessionId] || 0) + 1;
    setComposerPastes((current) => ({ ...current, [sessionId]: blocks }));
  }, []);
  const mirrorRevisionsRef = useRef({});
  /* Bounded history of OUR recent publishes (revision → text) per session:
     self-echo matching must survive multiple in-flight publishes — a
     single-slot "latest" let an older echo resurrect a just-cleared prompt
     by masquerading as foreign. Cleared once the owner id is learned. */
  const mirrorHistoryRef = useRef({}); // sessionId -> Map(revision -> text)
  const mirrorSelfOwnerRef = useRef(""); // learned daemon connection id
  const mirrorForeignRef = useRef({}); // sessionId -> {owner -> floor}
  const setComposerText = useCallback((sessionId, text) => {
    editGenRef.current[sessionId] = (editGenRef.current[sessionId] || 0) + 1;
    setComposerTexts((current) => ({ ...current, [sessionId]: text }));
  }, []);
  /* ONE publish door for local composer content (typing, paste blocks, the
     post-submit clear): stamps our monotone lane, records history for
     self-echo matching, publishes under the PROVIDER session id. */
  const publishMirrorNow = useCallback((session, text) => {
    const providerId = (session?.provider_session_id || "").trim();
    if (!providerId) return;
    const revision = (mirrorRevisionsRef.current[session.id] || 0) + 1;
    mirrorRevisionsRef.current[session.id] = revision;
    const history = (mirrorHistoryRef.current[session.id] ||= new Map());
    history.set(revision, text);
    while (history.size > 32) {
      history.delete(history.keys().next().value);
    }
    /* input_mirror_attachments_v1: PASTE-staged files ride the publish as
       artifact refs (uploaded backend-side; feature-gated there too). Only
       our own staged temp files qualify — dialog-picked paths are submit
       attachments, not mirror refs. The ""-clear never carries refs: a
       cleared composer has no attachments, and the consumed temp files may
       already be gone. */
    const staged = text === ""
      ? []
      : (composerAttachmentsRef.current[session.id] || [])
        .filter((path) => path.includes("diffforge-paste-"));
    void invoke("surface_publish_input", {
      session_id: providerId,
      text,
      attachments: staged.length ? staged : null,
      revision,
    }).catch(() => {});
  }, []);
  /* Composer attachments are SURFACE-owned (the composer unmounts on view
     switches, which silently dropped them from submits AND the mirror). The
     ref is the synchronous authority — async stage callbacks compute from it
     through updater functions, and state changes NEVER run side effects
     inside a React updater (deferred-replay hazard). The mirrored text is
     the same blocks-plus-typed composite the composer sends, so a publish
     triggered by a stage landing cannot wipe paste blocks from the TUI. */
  const [composerAttachments, setComposerAttachments] = useState({});
  const composerAttachmentsRef = useRef({});
  const composerPastesRef = useRef(composerPastes);
  composerPastesRef.current = composerPastes;
  const compositeMirrorText = useCallback((id) => {
    const blocks = composerPastesRef.current[id] || [];
    const typed = composerTextsRef.current[id] ?? "";
    const parts = blocks.map((block) => block.text);
    if (typed.trim() || !parts.length) parts.push(typed);
    return parts.join("\n\n");
  }, []);
  const handleAttachmentsChange = useCallback((session, next) => {
    const id = session?.id;
    if (!id) return;
    const previous = composerAttachmentsRef.current[id] || [];
    const resolved = typeof next === "function" ? next(previous) : next;
    const unchanged = resolved.length === previous.length
      && resolved.every((path, index) => path === previous[index]);
    if (unchanged) return;
    composerAttachmentsRef.current[id] = resolved;
    setComposerAttachments((current) => ({ ...current, [id]: resolved }));
    if (id !== "draft") {
      publishMirrorNow(session, compositeMirrorText(id));
    }
  }, [compositeMirrorText, publishMirrorNow]);
  /* #10: trailing-edge debounce (~40ms) — the mirror is a SNAPSHOT, not a
     keylog, so only the last state of a burst needs the wire. The
     submit-clear ("" text) flushes immediately and cancels any pending
     burst so a stale keystroke can never resurrect the prompt. */
  const mirrorDebounceRef = useRef({}); // sessionId -> timeout id
  const publishMirror = useCallback((session, text) => {
    const id = session?.id;
    if (!id) return;
    const pending = mirrorDebounceRef.current[id];
    if (pending) {
      window.clearTimeout(pending);
      delete mirrorDebounceRef.current[id];
    }
    if (text === "") {
      publishMirrorNow(session, "");
      return;
    }
    mirrorDebounceRef.current[id] = window.setTimeout(() => {
      delete mirrorDebounceRef.current[id];
      publishMirrorNow(session, text);
    }, 40);
  }, [publishMirrorNow]);
  const [composerPrefs, setComposerPrefs] = useState({});
  const [mirrorAttachments, setMirrorAttachments] = useState({});
  const [usageMeta, setUsageMeta] = useState(null);
  const [library, setLibrary] = useState(null);
  const [rpcFeatures, setRpcFeatures] = useState([]);
  const [queueState, setQueueState] = useState(() => queueStateForFeatures([]));
  const queueStateRef = useRef(queueState);
  const commitQueueState = useCallback((next) => {
    const resolved = typeof next === "function" ? next(queueStateRef.current) : next;
    queueStateRef.current = resolved;
    setQueueState(resolved);
    return resolved;
  }, []);
  const [queueActionBusy, setQueueActionBusy] = useState("");
  const [queueActionError, setQueueActionError] = useState("");
  const [queueRefreshGeneration, setQueueRefreshGeneration] = useState(0);
  const [commandCatalogState, setCommandCatalogState] = useState({ key: "", items: [] });
  const [commandResults, setCommandResults] = useState({});
  const [commandMenuRequests, setCommandMenuRequests] = useState({});
  const [draftError, setDraftError] = useState("");
  const submitBusyRef = useRef(false);

  const refreshLibrary = useCallback(async () => {
    try {
      const snapshot = await invoke("haider_library_snapshot");
      if (snapshot && typeof snapshot === "object") {
        setLibrary(snapshot);
        return snapshot;
      }
    } catch {
      // The retry loop below keeps an unavailable startup self-healing.
    }
    return null;
  }, []);

  /* Current provider/account context + model library from the harness. */
  useEffect(() => {
    let disposed = false;
    let libraryRetry = null;
    let libraryAttempt = 0;
    const refreshLibraryUntilAuthoritative = async () => {
      const snapshot = await refreshLibrary();
      if (disposed || !librarySnapshotNeedsRetry(snapshot)) return;
      const retryDelays = [500, 1_000, 2_000, 5_000, 10_000, 30_000];
      const delay = retryDelays[Math.min(libraryAttempt, retryDelays.length - 1)];
      libraryAttempt += 1;
      libraryRetry = window.setTimeout(refreshLibraryUntilAuthoritative, delay);
    };
    void invoke("haider_usage_snapshot").then((snapshot) => {
      if (!disposed && snapshot && typeof snapshot === "object") {
        setUsageMeta(snapshot);
      }
    }).catch(() => {});
    void refreshLibraryUntilAuthoritative();
    void invoke("rpc_features").then((features) => {
      if (!disposed && Array.isArray(features)) setRpcFeatures(features);
    }).catch(() => {});
    return () => {
      disposed = true;
      if (libraryRetry) window.clearTimeout(libraryRetry);
    };
  }, [refreshLibrary]);

  const commandSlots = useMemo(() => buildCommandSlots(library), [library]);
  const commandSlotsKey = useMemo(() => JSON.stringify(commandSlots), [commandSlots]);
  const commandContextId = draftOpen ? "draft" : activeSessionId;
  const commandInSession = Boolean(commandContextId && commandContextId !== "draft");
  const commandContextKey = `${commandContextId || "none"}:${commandInSession}:${commandSlotsKey}`;
  const commandText = composerTexts[commandContextId] || "";
  const slashInputActive = commandText.startsWith("/") && !commandText.includes("\n");
  const commandDoorAvailable = rpcFeatures.includes(COMMAND_DOOR_FEATURE);
  const queueDoorAvailable = queueControlAvailable(rpcFeatures);
  const activeQueueSession = sessions.find((row) => row.id === activeSessionId) || null;
  const activeQueueSessionId = activeQueueSession?.id || "";
  const activeQueueProviderId = activeQueueSession?.provider_session_id || "";

  /* Re-sniff when a slash interaction begins so a daemon upgraded or started
     after the surface mounted can expose its door. Until the bit is present,
     the composer receives an empty catalog and cannot present a false UI. */
  useEffect(() => {
    if (!slashInputActive) return undefined;
    let disposed = false;
    void invoke("rpc_features").then((features) => {
      if (!disposed && Array.isArray(features)) setRpcFeatures(features);
    }).catch(() => {});
    return () => { disposed = true; };
  }, [commandContextId, slashInputActive]);

  /* Palette enumeration is disposable display state, keyed by the full
     command context. Crossing launcher/session (or any session/slots change)
     immediately exposes an EMPTY list, never the prior context's ownership.
     Submission performs another list below and never consumes this state. */
  useEffect(() => {
    if (!slashInputActive || !commandDoorAvailable || !commandContextId) {
      setCommandCatalogState({ key: commandContextKey, items: [] });
      return undefined;
    }
    let disposed = false;
    setCommandCatalogState({ key: commandContextKey, items: [] });
    void invoke("command_list", {
      query: "",
      in_session: commandInSession,
      slots: commandSlots,
    }).then((items) => {
      if (!disposed) {
        setCommandCatalogState({
          key: commandContextKey,
          items: Array.isArray(items) ? items : [],
        });
      }
    }).catch(() => {
      if (!disposed) setCommandCatalogState({ key: commandContextKey, items: [] });
    });
    return () => { disposed = true; };
  }, [
    commandContextId,
    commandContextKey,
    commandDoorAvailable,
    commandInSession,
    commandSlots,
    slashInputActive,
  ]);

  const slashCommands = commandCatalogState.key === commandContextKey
    ? catalogToSlashCommands(commandCatalogState.items)
    : [];

  /* queue_control_v1: install the event listener before asking for the list.
     QueueChanged frames that beat the response are buffered by the pure
     model and replayed above the snapshot revision. The Rust lane owns how
     the ordinary session attach is forwarded to this Tauri event. */
  useEffect(() => {
    setQueueActionBusy("");
    setQueueActionError("");
    if (!queueDoorAvailable || !activeQueueSessionId) {
      commitQueueState(queueStateForFeatures(rpcFeatures));
      return undefined;
    }

    let disposed = false;
    let unlisten = null;
    let listSequence = 0;
    commitQueueState(queueStateForFeatures([FEATURE_QUEUE_CONTROL_V1]));

    const relist = async () => {
      const sequence = listSequence + 1;
      listSequence = sequence;
      commitQueueState((current) => queueListStarted(current));
      try {
        const snapshot = await queueInvokeBoundary.list({ sessionId: activeQueueSessionId });
        if (disposed || sequence !== listSequence) return;
        const responseSession = typeof snapshot?.session_id === "string"
          ? snapshot.session_id
          : "";
        if (responseSession
          && responseSession !== activeQueueSessionId
          && responseSession !== activeQueueProviderId) {
          commitQueueState((current) => queueListFailed(
            current,
            "queue.list returned a different session.",
          ));
          return;
        }
        commitQueueState((current) => queueListSucceeded(current, snapshot).state);
      } catch (error) {
        if (!disposed && sequence === listSequence) {
          commitQueueState((current) => queueListFailed(current, error));
        }
      }
    };

    const receiveDelta = (event) => {
      if (disposed) return;
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") {
        commitQueueState((current) => queueListFailed(current, "Malformed queue watch payload."));
        return;
      }
      const eventSession = typeof payload.session_id === "string" ? payload.session_id : "";
      if (!eventSession) {
        commitQueueState((current) => queueListFailed(current, "Queue watch payload omitted its session."));
        void relist();
        return;
      }
      if (eventSession !== activeQueueSessionId && eventSession !== activeQueueProviderId) return;
      if (payload.watch_failed === true) {
        commitQueueState((current) => queueListFailed(
          current,
          payload.reason || "The session queue watch failed.",
        ));
        return;
      }
      const envelope = payload.envelope;
      const applied = applyQueueDelta(queueStateRef.current, envelope?.payload, {
        envelopeSeq: envelope?.seq,
        streamGap: payload.gap === true,
      });
      commitQueueState(applied.state);
      if (applied.relist) void relist();
    };

    void listen("session-queue-changed", receiveDelta).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      void relist();
    }).catch((error) => {
      if (!disposed) commitQueueState((current) => queueListFailed(current, error));
    });

    return () => {
      disposed = true;
      listSequence += 1;
      if (unlisten) unlisten();
    };
  }, [
    activeQueueProviderId,
    activeQueueSessionId,
    commitQueueState,
    queueDoorAvailable,
    queueRefreshGeneration,
    rpcFeatures,
  ]);

  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const mutateQueuedRow = useCallback(async (action, id) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || queueActionBusy) return;
    const busyKey = `${action}:${id}`;
    setQueueActionBusy(busyKey);
    setQueueActionError("");
    try {
      const result = await mutateQueueRowWithRetry({
        boundary: queueInvokeBoundary,
        sessionId,
        id,
        action,
        state: queueStateRef.current,
      });
      if (activeSessionIdRef.current !== sessionId) return;
      commitQueueState((current) => {
        if (result.state?.kind === "unknown") return result.state;
        const currentRevision = Number.isSafeInteger(current?.revision) ? current.revision : -1;
        const resultRevision = Number.isSafeInteger(result.state?.revision)
          ? result.state.revision
          : -1;
        return currentRevision >= resultRevision ? current : result.state;
      });
      if (result.status === "conflict") {
        setQueueActionError("The queue changed again. Review the refreshed list and retry.");
      } else if (result.status === "unknown") {
        setQueueActionError("The queue could not be refreshed after it changed.");
      }
    } catch (error) {
      if (activeSessionIdRef.current === sessionId) {
        setQueueActionError(String(error?.message || error || "Queue action failed."));
      }
    } finally {
      if (activeSessionIdRef.current === sessionId) {
        setQueueActionBusy((current) => (current === busyKey ? "" : current));
      }
    }
  }, [commitQueueState, queueActionBusy]);

  /* Chips show REALITY (the session's actual model/provider, the harness's
     actual account), never an unapplied local preference — switching stays
     read-only until the harness exposes a headless door for it. */
  /* Live session config (0.0.933 session_config_v1) — fetched per session,
     applied through session_config_set; chips reflect the daemon's truth. */
  const [sessionConfigs, setSessionConfigs] = useState({});
  const [paneOverrides, setPaneOverrides] = useState({});
  const paneOverridesRef = useRef(paneOverrides);
  paneOverridesRef.current = paneOverrides;
  const [sessionBinding, setSessionBinding] = useState(initialSessionBindingState);
  const deliveredBindingRef = useRef("");
  /* The binding frame has no pane id, so capture the active mounted resident
     surface at the instant the observation arrives. Keeping this in a ref
     lets the one long-lived listener see the current render without making
     a cached observation follow later navigation. The predicate deliberately
     mirrors the SessionTerminal render conditions below. */
  const residentSurfaceRef = useRef(null);
  let residentSurface = null;
  if (draftOpen) {
    const mounted = (viewModes.draft || "ui") === "terminal"
      || Boolean(shellTouched.draft);
    if (mounted) {
      residentSurface = {
        paneId: paneOverridesRef.current.draft || sessionPaneId("draft"),
        hostSessionId: "draft",
      };
    }
  } else if (
    activeSessionId
    && openSessions.some((session) => session.id === activeSessionId)
  ) {
    const tabsState = sessionTabs[activeSessionId]
      || { tabs: [{ id: "chat" }], activeTabId: "chat" };
    const tabs = Array.isArray(tabsState.tabs) && tabsState.tabs.length
      ? tabsState.tabs
      : [{ id: "chat" }];
    const activeTab = tabs.find((tab) => tab.id === tabsState.activeTabId) || tabs[0];
    const chatTabActive = activeTab.id === "chat";
    const mode = viewModes[activeSessionId] || "ui";
    const pref = shellPrefs[activeSessionId];
    const mounted = pref === true
      || (chatTabActive && (
        mode === "terminal"
        || (shellTouched[activeSessionId] && pref !== false)
      ));
    if (mounted) {
      residentSurface = {
        paneId: paneOverridesRef.current[activeSessionId]
          || sessionPaneId(activeSessionId),
        hostSessionId: activeSessionId,
      };
    }
  }
  /* Native events must see only committed UI state. A render React later
     discards must not become the owner of a binding observation. */
  useLayoutEffect(() => {
    residentSurfaceRef.current = residentSurface;
    return () => {
      residentSurfaceRef.current = null;
    };
  }, [residentSurface?.hostSessionId, residentSurface?.paneId]);
  /* A new TUI-created session can announce before the roster refresh that
     makes its provider id resolvable. Keep the latest announcement per pane
     and finish the same rehome when that row arrives. */
  const pendingTuiAttachmentsRef = useRef(new Map());
  const [surfaceStatus, setSurfaceStatus] = useState({});

  /* The daemon push is unsolicited and can beat React mounting, so listen
     first and then read the Rust-side cache. A push that lands during the
     snapshot call wins; worker_generation cannot order unbound -> bound
     because both frames intentionally share one generation. */
  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    let pushes = 0;
    void listen("resident-session-binding", (event) => {
      if (disposed) return;
      pushes += 1;
      setSessionBinding((current) => (
        applyResidentBindingSnapshot(
          current,
          event?.payload,
          residentSurfaceRef.current,
        )
      ));
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      void invoke("resident_session_binding_snapshot").then((snapshot) => {
        /* The cache is bootstrap-only. If the live listener has observed any
           push — before or during this invoke — applying the same cached
           frame again would invent a second protocol observation. */
        if (disposed || pushes !== 0) return;
        setSessionBinding((current) => (
          applyResidentBindingSnapshot(
            current,
            snapshot,
            residentSurfaceRef.current,
          )
        ));
      }).catch(() => {});
    }).catch(() => {});
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  /* OSC and terminal_open are one legacy lane. While capability negotiation
     is unknown the last announcement is buffered; a capable Welcome drops
     it, while an older daemon releases it as the fallback source of truth. */
  const handleLegacyTuiAttached = useCallback((announcement) => {
    setSessionBinding((current) => (
      applyLegacySessionBinding(current, announcement)
    ));
  }, []);

  /* Config fetches are LATEST-WINS per session: a slow menu-open GET must
     never overwrite the state a later post-SET GET already applied. */
  const configFetchSeqRef = useRef({});
  const refreshConfig = useCallback((sessionId) => {
    const seq = (configFetchSeqRef.current[sessionId] || 0) + 1;
    configFetchSeqRef.current[sessionId] = seq;
    void invoke("session_config_get", { session_id: sessionId })
      .then((config) => {
        if (config && typeof config === "object") {
          /* Staleness is rechecked INSIDE the updater: React may defer the
             enqueued state write past a synchronous invalidation bump. */
          setSessionConfigs((current) => (
            configFetchSeqRef.current[sessionId] === seq
              ? { ...current, [sessionId]: config }
              : current
          ));
        }
      })
      .catch(() => {});
  }, []);

  /* The roster mirrors daemon truth: if a session's model changed elsewhere
     (TUI switch), a cached config that disagrees is stale — drop it so the
     chips fall back to the fresh roster row. */
  const sessionConfigsRef = useRef({});
  useEffect(() => {
    sessionConfigsRef.current = sessionConfigs;
  }, [sessionConfigs]);
  /* Last roster model seen per session: the fence keys on roster CHANGE,
     independent of whether a config ever committed — an in-flight FIRST GET
     must also die when the model moved under it. */
  const rosterModelRef = useRef({});
  useEffect(() => {
    /* Fencing is SYNCHRONOUS in the effect body (updaters can be deferred /
       replayed — a bump inside one would let a pending GET slip its seq
       check first). The prune updater stays pure. */
    const staleIds = [];
    for (const row of sessions) {
      const model = (row.model || "").trim();
      const previous = rosterModelRef.current[row.id];
      rosterModelRef.current[row.id] = model;
      if (previous !== undefined && previous !== model) {
        if (configFetchSeqRef.current[row.id]) {
          configFetchSeqRef.current[row.id] += 1;
        }
        staleIds.push(row.id);
        continue;
      }
      const config = sessionConfigsRef.current[row.id];
      if (model && config?.model && config.model !== model) {
        staleIds.push(row.id);
        configFetchSeqRef.current[row.id] = (configFetchSeqRef.current[row.id] || 0) + 1;
      }
    }
    /* Sessions REMOVED from the roster are fenced too: a pre-removal GET
       must never commit after a re-add. Seq tombstone stays; the roster
       mirror entry goes so a re-add starts fresh. */
    const liveIds = new Set(sessions.map((row) => row.id));
    for (const id of Object.keys(rosterModelRef.current)) {
      if (!liveIds.has(id)) {
        delete rosterModelRef.current[id];
        if (configFetchSeqRef.current[id]) {
          configFetchSeqRef.current[id] += 1;
        }
        staleIds.push(id);
      }
    }
    if (!staleIds.length) return;
    setSessionConfigs((current) => {
      const next = { ...current };
      let changed = false;
      for (const id of staleIds) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sessions]);

  /* Click path stays LOCAL: chips render from the roster row the bridge
     already mirrors (model/provider ride every summary) — the config fetch
     moved to chip-menu-open, the one moment that tolerates a beat. The only
     daemon touch on click is the cheap surface_attach frame.
     Surfaces are keyed by the DAEMON'S session ids: always attach/publish
     with provider_session_id, never the local row id — a local id names a
     phantom surface the TUI will never touch (the "empty TUI on open" bug:
     ADE-born sessions have local id ≠ provider id). */
  useEffect(() => {
    if (activeSessionId && activeSessionId !== "draft") {
      const providerId = (sessions.find((row) => row.id === activeSessionId)
        ?.provider_session_id || "").trim();
      if (providerId) {
        void invoke("surface_attach", { session_id: providerId }).catch(() => {});
      }
    }
  }, [activeSessionId, sessions]);

  /* Shell pre-warm: the click itself spawns nothing, but once a selection
     SETTLES (~1.2s of dwell) the terminal mounts hidden so the PTY spawn +
     TUI attach replay happen while the user reads the chat — the first
     Shell flip then feels instant. */
  useEffect(() => {
    if (!activeSessionId || activeSessionId === "draft") return undefined;
    const timer = window.setTimeout(() => {
      setShellTouched((current) => (
        current[activeSessionId] ? current : { ...current, [activeSessionId]: true }
      ));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeSessionId]);

  /* Daemon-owned volatile surfaces (input mirror + status segment): events
     arrive keyed by PROVIDER session id; map to local rows. */
  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("session-surface", (event) => {
      if (disposed) return;
      /* status_segment_structured_v1: pass the untouched event into the
         adapter. It preserves optional fields on a present status and removes
         this session's entry when the whole status is absent (typed clear). */
      const surfaceEvent = applySessionSurfaceStatusEvent(
        event,
        sessions,
        setSurfaceStatus,
      );
      if (!surfaceEvent) return;
      const { local, payload } = surfaceEvent;
      if (payload.input?.text != null) {
        /* input_mirror_v1, owner-aware (rev934 P1-1): our own accepted
           publish echoed back (revision AND text match) names our lane and
           drops; other frames from that learned owner drop as echoes; every
           foreign lane applies when its OWN revision advances — a fresh
           publisher's revision 1 is newer than nothing of ours. */
        const { text, owner = "" } = payload.input;
        const revision = payload.input.revision || 0;
        const history = mirrorHistoryRef.current[local.id];
        if (history && history.get(revision) === text) {
          /* One of OUR publishes echoed back (any pending one, not just the
             latest) — learn the owner and drop. Our own refs already render
             as LOCAL chips: an echo must not leave them up as stale
             read-only "TUI" chips. */
          if (owner) {
            mirrorSelfOwnerRef.current = owner;
            history.clear();
          }
          setMirrorAttachments((current) => (
            (current[local.id] || []).length
              ? { ...current, [local.id]: [] }
              : current
          ));
        } else if (!owner || owner !== mirrorSelfOwnerRef.current) {
          const floors = (mirrorForeignRef.current[local.id] ||= {});
          if (!(owner in floors) || revision > floors[owner]) {
            floors[owner] = revision;
            /* A remote apply IS an edit for generation purposes: a pending
               submit's success-clear must not wipe TUI-typed text that
               arrived while the submit was in flight. */
            editGenRef.current[local.id] = (editGenRef.current[local.id] || 0) + 1;
            setComposerTexts((current) => (
              (current[local.id] || "") === text
                ? current
                : { ...current, [local.id]: text }
            ));
            /* A remote frame is the FULL composer truth: local paste blocks
               AND local staged attachments would mix stale content into the
               newer draft — clear both. */
            setComposerPastes((current) => (
              (current[local.id] || []).length
                ? { ...current, [local.id]: [] }
                : current
            ));
            if ((composerAttachmentsRef.current[local.id] || []).length) {
              composerAttachmentsRef.current[local.id] = [];
              setComposerAttachments((current) => ({ ...current, [local.id]: [] }));
            }
            /* input_mirror_attachments_v1: refs from the owning surface
               render as read-only chips (metadata only — no bytes). */
            const refs = Array.isArray(payload.input.attachments)
              ? payload.input.attachments
              : [];
            setMirrorAttachments((current) => (
              (current[local.id] || []).length || refs.length
                ? { ...current, [local.id]: refs }
                : current
            ));
          }
        }
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [sessions]);

  /* session_seen_v1 (936): viewing a chat ACKS it through the daemon's
     session.seen door — the harness owns seen-state, the ADE only reports.
     750ms debounce (TUI precedent) so flicking through the rail doesn't
     spray receipts; the receipt round-trips into the roster and clears the
     rail dot everywhere. Re-arms when fresh activity lands while viewing. */
  useEffect(() => {
    if (!activeSessionId || activeSessionId === "draft") return undefined;
    const row = sessions.find((entry) => entry.id === activeSessionId);
    if (!row?.provider_session_id) return undefined;
    if (!(Number(row.last_activity_ms) > Number(row.seen_at_ms || 0))) return undefined;
    const timer = window.setTimeout(() => {
      void invoke("session_mark_seen", { session_id: activeSessionId }).catch(() => {});
    }, 750);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, sessions]);

  const rehomeAttachedTui = useCallback(({
    paneId,
    hostSessionId,
  }, target) => {
    if (!target || target.id === hostSessionId) return;
    const currentPanes = paneOverridesRef.current;
    const nextPanes = rehomeSessionPane(currentPanes, {
      paneId,
      hostSessionId,
      targetSessionId: target.id,
    });
    if (nextPanes === currentPanes) return;
    paneOverridesRef.current = nextPanes;
    setPaneOverrides(nextPanes);
    /* Land where the user actually was: a hop driven from a live Shell keeps
       the Shell; materializing from the Chat composer (the warm hidden TUI
       announcing the bind) must land in Chat. */
    /* A rehomed pane means a live TUI to adopt: mark the target
       shell-touched UNCONDITIONALLY so its terminal mounts (warm) even when
       the hop lands in Chat; only the VISIBLE mode stays conditional. */
    setShellTouched((current) => (
      current[target.id] ? current : { ...current, [target.id]: true }
    ));
    setViewModes((current) => rehomeSessionViewMode(current, {
      hostSessionId,
      targetSessionId: target.id,
    }));
    onOpenSession?.(target);
  }, [onOpenSession]);

  /* The selected binding authority told us which session the resident
     surface now serves — auto-select it and re-home the live pane under it. */
  const handleTuiAttached = useCallback((announcement) => {
    const { paneId, providerSessionId } = announcement;
    if (!providerSessionId) {
      pendingTuiAttachmentsRef.current.delete(paneId);
      return; // back at the launcher — the pane keeps its host session
    }
    const target = sessions.find(
      (row) => row.provider_session_id === providerSessionId,
    );
    if (!target) {
      pendingTuiAttachmentsRef.current.set(paneId, announcement);
      onSessionsRefresh?.();
      return;
    }
    pendingTuiAttachmentsRef.current.delete(paneId);
    rehomeAttachedTui(announcement, target);
  }, [onSessionsRefresh, rehomeAttachedTui, sessions]);

  /* A PROTOCOL OBSERVATION MUST NOT REHOME A PANE.

     resident_session_binding is profile-global. The daemon holds N publishers
     keyed by connection and collapses them to a single most-recent winner,
     discarding the owner before the frame goes out. So it answers "is anything
     in this profile bound, and to what" — a real fact, and the one that let the
     terminal scrape retire — but it cannot answer "which session is THIS pane
     showing". Routing it into handleTuiAttached inferred a pane from a fact
     that never named one: with two shells open, a hop in one rehomed the
     other, and nothing errored.

     Per-pane identity stays with OSC 7791, which is per-pane BY CONSTRUCTION
     because it arrives inside that pane's own stream. These are two different
     facts at two different scopes — not two sources for one fact — so both may
     live at once, provided neither is ever read as the other. */
  useEffect(() => {
    if (sessionBinding.authority === "protocol") return;
    const announcement = sessionBindingAnnouncement(sessionBinding);
    if (!announcement) return;
    const deliveryKey = [
      sessionBinding.authority,
      announcement.paneId,
      announcement.hostSessionId,
      announcement.providerSessionId ?? "<unbound>",
    ].join("\u0000");
    if (deliveredBindingRef.current === deliveryKey) return;
    deliveredBindingRef.current = deliveryKey;
    handleTuiAttached(announcement);
  }, [
    handleTuiAttached,
    sessionBinding,
  ]);

  /* The binding and roster lanes are independent. Resolve announcements that
     arrived first as soon as their freshly-created session is imported. */
  useEffect(() => {
    for (const [paneId, announcement] of pendingTuiAttachmentsRef.current) {
      const target = sessions.find(
        (row) => row.provider_session_id === announcement.providerSessionId,
      );
      if (!target) continue;
      pendingTuiAttachmentsRef.current.delete(paneId);
      rehomeAttachedTui(announcement, target);
    }
  }, [rehomeAttachedTui, sessions]);

  /* ONE model chip: provider, model, and the provider's bound account are a
     single coherent choice (a deepseek model can never ride an openai
     account). The menu groups the catalog by provider; selecting applies
     "provider/model" through the harness. */
  const chipValuesFor = (session) => {
    const config = session ? sessionConfigs[session.id] : null;
    const prefs = session ? {} : (composerPrefs.draft || {});
    const prefModel = typeof prefs.model === "string" ? prefs.model.split("/").pop() : null;
    const configHas = (key) => config && Object.hasOwn(config, key);
    const sessionHas = (key) => session && Object.hasOwn(session, key);
    const model = configHas("model") ? config.model
      : prefModel || (sessionHas("model") ? session.model : null);
    return {
      model,
      modelProvider: configHas("provider")
        ? config.provider
        : (prefs.model || "").split("/")[0]
          || (sessionHas("provider") ? sessionModelProviderFallback(session.provider) : ""),
      effort: configHas("effort")
        ? (config.effort ?? "default")
        : prefs.effort ?? (sessionHas("effort") ? (session.effort ?? "default") : null),
      speed: configHas("speed")
        ? config.speed
        : prefs.speed ?? (sessionHas("speed") ? session.speed : null),
    };
  };
  const chipOptionsFor = (session) => {
    const values = chipValuesFor(session);
    const catalog = modelOptionCatalog(library, values.modelProvider, values.model);
    return {
      modelGroups: modelGroupsFromLibrary(library),
      ...catalog,
    };
  };
  /* Bound sessions apply through the harness (session_config_set) so the
     TUI, the daemon, and the chips agree; the draft stashes prefs that ride
     the first `haider run` as flags. */
  const handleChipChange = useCallback((sessionId, key, option) => {
    if (sessionId === "draft") {
      setComposerPrefs((current) => ({
        ...current,
        draft: { ...(current.draft || {}), [key]: option },
      }));
    } else {
      const value = option === "default" ? null : option;
      const patch = { session_id: sessionId };
      if (key === "model") patch.model = value;
      else if (key === "effort") patch.effort = value;
      else if (key === "speed") patch.speed = value === null ? "normal" : value;
      else if (key === "account") patch.account = value;
      else return;
      void invoke("session_config_set", patch)
        .then(() => {
          /* The mutation receipt proves acceptance but is not a config
             snapshot. Keep showing the prior daemon value until the winning
             config door supplies the current one. */
          refreshConfig(sessionId);
        })
        .catch(() => {});
    }
  }, [refreshConfig]);

  const runConfigFromPrefs = (prefs) => {
    const pick = (value) => (value && value !== "default" ? value : null);
    const config = {
      model: pick(prefs.model),
      effort: pick(prefs.effort),
      speed: prefs.speed === "fast" ? "fast" : null,
      account: pick(prefs.account),
    };
    return Object.values(config).some((v) => v) ? config : null;
  };

  const modeFor = (sessionId) => viewModes[sessionId] || "ui";
  const activeCheckpointBranchId = useMemo(() => publishedCheckpointBranchId(
    sessions.find((candidate) => candidate.id === activeSessionId),
  ), [activeSessionId, sessions]);
  const setModeFor = useCallback((sessionId, mode) => {
    setViewModes((current) => ({ ...current, [sessionId]: mode }));
    if (mode === "terminal") {
      setShellTouched((current) => (
        current[sessionId] ? current : { ...current, [sessionId]: true }
      ));
    }
  }, []);

  /* Shell keep-warm: viewing a shell reports it warm to the shell, and it
     STAYS mounted until the user turns it off from the rail — so switching
     back never pays xterm re-instantiation + scrollback replay again (the
     0.2-0.8s flip cost). PTYs were always daemon-persistent; this only keeps
     the VIEW alive. Ownership sits above so the rail can toggle it. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft") return;
    if ((viewModes[id] || "ui") !== "terminal") return;
    const { tabs, activeTabId } = sessionTabs[id] || { tabs: [{ id: "chat" }], activeTabId: "chat" };
    if ((tabs.find((tab) => tab.id === activeTabId) || tabs[0]).id !== "chat") return;
    onShellWarm?.(id);
  }, [activeSessionId, viewModes, sessionTabs, onShellWarm]);

  /* Fleet view: entering it reads the session's fleet snapshot from the
     daemon (session.fleet). The read is on-view only — no polling — and
     useFleet settles once into unavailable if the daemon lacks the
     feature. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft") return;
    if ((viewModes[id] || "ui") !== "fleet") return;
    onLoadFleet?.(id);
  }, [activeSessionId, viewModes, onLoadFleet]);

  /* The live attachment follows Fleet-view ownership exactly. The snapshot
     read above remains mounted as the honest fallback; leaving or switching
     sessions always detaches the live stream. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "fleet") {
      void onStopDescendantStream?.();
      return undefined;
    }
    void onStartDescendantStream?.(id);
    return () => {
      void onStopDescendantStream?.();
    };
  }, [
    activeSessionId,
    viewModes,
    onStartDescendantStream,
    onStopDescendantStream,
  ]);

  /* Monitor manager (P4): entering the view reads the authoritative
     registry and starts its delivery watch. Leaving, switching sessions,
     or unmounting stops the watch; all four invokes remain centralized in
     useMonitor.js. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "monitors") {
      onStopMonitorWatch?.();
      return undefined;
    }
    onLoadMonitors?.(id);
    onStartMonitorWatch?.(id);
    return () => {
      onStopMonitorWatch?.();
    };
  }, [
    activeSessionId,
    viewModes,
    onLoadMonitors,
    onStartMonitorWatch,
    onStopMonitorWatch,
  ]);

  /* Checkpoint timeline: one authority read when the per-session view is
     entered. Pagination and every mutation remain centralized in
     useCheckpoints.js; a feature-gated daemon settles unavailable once. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "checkpoints") return;
    onLoadCheckpoints?.(id, activeCheckpointBranchId);
  }, [activeCheckpointBranchId, activeSessionId, viewModes, onLoadCheckpoints]);

  /* Live workflow graph view (P6): entering it starts the watch-as-change-
     signal poll for the active session (workflow.graph.watch signals, then
     workflow.graph.state re-fetches carry the authority — both invokes
     live in useWorkflowGraph.js); leaving the view stops the poll. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "graph") {
      onWatchWorkflowGraph?.("");
      return;
    }
    onWatchWorkflowGraph?.(id);
  }, [activeSessionId, viewModes, onWatchWorkflowGraph]);

  /* Session-history sync, lifted from the transcript's additive callback
     (projection caught_up + cold-load state) and reported upward for the
     rail's syncing pill. Keyed per session; only the ACTIVE session's state
     surfaces. */
  const [transcriptSyncing, setTranscriptSyncing] = useState({});
  const handleTranscriptSyncing = useCallback((sessionId, syncing) => {
    /* Carried as reported: true | false | null. Collapsing null to false here
       is what let the rail claim "Synced" for a projection nobody had
       observed. */
    const reported = sessionSyncTransportState(syncing);
    setTranscriptSyncing((current) => (
      (current[sessionId] ?? null) === reported
        ? current
        : { ...current, [sessionId]: reported }
    ));
  }, []);
  const activeTranscriptSyncing = activeSessionSyncReport(
    draftOpen,
    activeSessionId,
    transcriptSyncing,
  );
  const syncLifecycle = useMemo(
    () => createSessionSyncLifecycleReporter(onSyncingChange),
    [onSyncingChange],
  );
  useEffect(() => {
    syncLifecycle.report(activeTranscriptSyncing);
  }, [activeTranscriptSyncing, syncLifecycle]);
  useEffect(() => () => {
    syncLifecycle.unmount();
  }, [syncLifecycle]);

  const tabsStateFor = (sessionId) => sessionTabs[sessionId] || {
    tabs: [{ id: "chat", kind: "chat" }],
    activeTabId: "chat",
  };
  const patchTabs = useCallback((sessionId, mutate) => {
    setSessionTabs((current) => {
      const existing = current[sessionId] || {
        tabs: [{ id: "chat", kind: "chat" }],
        activeTabId: "chat",
      };
      return { ...current, [sessionId]: mutate(existing) };
    });
  }, []);
  const addTab = useCallback((sessionId) => {
    const tabId = `tab-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    patchTabs(sessionId, (state) => ({
      tabs: [...state.tabs, { id: tabId, kind: "picker" }],
      activeTabId: tabId,
    }));
  }, [patchTabs]);
  const selectTab = useCallback((sessionId, tabId) => {
    patchTabs(sessionId, (state) => ({ ...state, activeTabId: tabId }));
  }, [patchTabs]);
  const closeTab = useCallback((sessionId, tabId) => {
    patchTabs(sessionId, (state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== tabId);
      return {
        tabs,
        activeTabId: state.activeTabId === tabId ? "chat" : state.activeTabId,
      };
    });
  }, [patchTabs]);
  const setTabPanel = useCallback((sessionId, tabId, kind) => {
    patchTabs(sessionId, (state) => ({
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, kind } : tab)),
    }));
  }, [patchTabs]);

  /* A submit into a session whose shell is closed holds the typed text in
     place while the session comes up, rather than failing silently. */
  const [submitHold, setSubmitHold] = useState({});
  const [composerDeliveryModes, setComposerDeliveryModes] = useState({});
  const [submissionConfirmations, setSubmissionConfirmations] = useState({});
  const submissionConfirmationTimersRef = useRef({});
  useEffect(() => () => {
    for (const timer of Object.values(submissionConfirmationTimersRef.current)) {
      window.clearTimeout(timer);
    }
  }, []);
  const recordSubmissionConfirmation = useCallback((sessionId, result, prompt) => {
    const confirmation = ownSubmissionConfirmation(result, prompt);
    setSubmissionConfirmations((current) => ({
      ...current,
      [sessionId]: confirmation,
    }));
    const existing = submissionConfirmationTimersRef.current[sessionId];
    if (existing) window.clearTimeout(existing);
    submissionConfirmationTimersRef.current[sessionId] = window.setTimeout(() => {
      delete submissionConfirmationTimersRef.current[sessionId];
      setSubmissionConfirmations((current) => {
        if (current[sessionId]?.id !== confirmation.id) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    }, SUBMIT_CONFIRMATION_MS);
  }, []);

  const submitCommand = useCallback(async (session, prompt) => {
    const contextId = session?.id || "draft";
    const inSession = Boolean(session);
    const gen = editGenRef.current[contextId] || 0;
    const clearComposer = () => {
      if ((editGenRef.current[contextId] || 0) !== gen) return;
      setComposerText(contextId, "");
      setComposerPastesFor(contextId, []);
      if (session) publishMirror(session, "");
    };
    const executeLocal = (action) => {
      if (action.action === "model") {
        if (action.argument) {
          handleChipChange(contextId, "model", action.argument);
          return {
            type: "client_action",
            message: `Model set to ${action.argument} for this launcher context.`,
          };
        }
        setCommandMenuRequests((current) => ({
          ...current,
          [contextId]: {
            menu: "model",
            sequence: (current[contextId]?.sequence || 0) + 1,
          },
        }));
        return { type: "client_action", message: "Choose a model from the model menu." };
      }
      if (action.action === "theme") {
        const requested = String(action.argument || "").toLowerCase();
        const alreadyRequested = (requested === "light" && appThemeIsLight)
          || (requested === "dark" && !appThemeIsLight);
        if (!alreadyRequested) onToggleTheme?.();
        return {
          type: "client_action",
          message: requested
            ? `Theme set to ${requested}.`
            : "Theme toggled.",
        };
      }
      if (action.action === "help") {
        return {
          type: "client_action",
          message: "Type / to browse the commands offered for this context.",
        };
      }
      if (action.action === "sessions") {
        return { type: "client_action", message: "Sessions are available in the session rail." };
      }
      if (action.action === "accounts") {
        return { type: "client_action", message: "Account controls are available from the provider account menu." };
      }
      return null;
    };
    const execute = createCommandDoorExecutor({
      /* This list is intentionally fresh even if the palette just listed the
         same text. Palette state is display-only and may belong to a prior
         launcher/session boundary; ownership is decided only here. */
      listCommands: (args) => invoke("command_list", args),
      invokeCommand: ({ command }) => invoke("command_invoke", {
        command_id: globalThis.crypto?.randomUUID?.()
          || `diffforge-command-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
        command,
        session_id: session?.id || "",
      }),
      executeLocal,
    });
    const result = await execute({ command: prompt, inSession, slots: commandSlots });

    if (result.type === "parked") {
      /* Rust has already persisted the opaque card. Refreshing makes the
         existing SessionTranscript -> NeedsInputCard path render it; no
         command-specific answer callback exists here. */
      clearComposer();
      setCommandResults((current) => {
        if (!(contextId in current)) return current;
        const next = { ...current };
        delete next[contextId];
        return next;
      });
      onSessionsRefresh?.();
      return true;
    }

    if (result.type === "custom") {
      if ((editGenRef.current[contextId] || 0) === gen) {
        const expansion = result.expansion || "";
        setComposerText(contextId, expansion);
        setComposerPastesFor(contextId, []);
        if (session) publishMirror(session, expansion);
      }
      setCommandResults((current) => ({ ...current, [contextId]: result }));
      return true;
    }

    setCommandResults((current) => ({ ...current, [contextId]: result }));
    if (["receipt", "client_action", "unsupported"].includes(result.type)) {
      clearComposer();
      return true;
    }
    /* Feature/offline failures, unknown ownership, version-skewed client
       commands, and unknown outcomes stay in the composer for correction or
       retry, with the visible result above it. */
    return false;
  }, [
    appThemeIsLight,
    commandSlots,
    handleChipChange,
    onSessionsRefresh,
    onToggleTheme,
    publishMirror,
    setComposerPastesFor,
    setComposerText,
  ]);

  const submitDraft = useCallback(async (prompt, attachments) => {
    if (submitBusyRef.current) {
      return false;
    }
    submitBusyRef.current = true;
    setDraftError("");
    if (/^\/\S/.test(prompt.trim())) {
      try {
        return await submitCommand(null, prompt);
      } finally {
        submitBusyRef.current = false;
      }
    }
    /* Same generation guard as bound submits: the draft's clear applies only
       if the user hasn't typed again while materialization ran. */
    const gen = editGenRef.current.draft || 0;
    try {
      const config = runConfigFromPrefs(composerPrefs.draft || {});
      const row = await invoke("session_start_with_prompt", {
        prompt,
        pinned_dir: null,
        attachments: attachments?.length ? attachments : null,
        config,
      });
      if (row?.id) {
        if ((editGenRef.current.draft || 0) === gen) {
          setComposerText("draft", "");
          setComposerPastesFor("draft", []);
        }
        setViewModes((current) => rehomeSessionViewMode(current, {
          hostSessionId: "draft",
          targetSessionId: row.id,
        }));
        onDraftMaterialized(row);
        return true;
      }
      setDraftError("The session did not start. Check that haider is installed.");
      return false;
    } catch (error) {
      setDraftError(String(error?.message || error || "Unable to start the session."));
      return false;
    } finally {
      submitBusyRef.current = false;
    }
  }, [
    composerPrefs,
    onDraftMaterialized,
    setComposerPastesFor,
    setComposerText,
    submitCommand,
  ]);

  /* A stop button exists only when the harness has published an active state
     and named the run to stop. run_id and worker_generation are ONE
     observation and ride verbatim: the
     generation fences a resurrected worker and the run id fences the specific
     run, so a cancel that raced a turn boundary cannot kill the next turn.
     An absent run_id supplies no cancel coordinate, so it never creates a
     stop button; activity caution is resolved separately from run_state. */
  const cancelTurnFor = useCallback((session) => {
    const runId = session?.run_id;
    const generation = session?.worker_generation;
    if (!sessionRunCanCancel(session)) return null;
    if (typeof generation !== "number" || !Number.isFinite(generation)) return null;
    return async () => {
      try {
        await invoke("session_cancel_turn", {
          session_id: session.id,
          run_id: runId,
          worker_generation: generation,
        });
      } catch {
        /* already_terminal and a lost receipt are both benign here: the
           command id is derived, so the roster's next state is the truth. */
      }
      onSessionsRefresh?.();
    };
  }, [onSessionsRefresh]);

  const submitIntoSession = useCallback(async (session, prompt, attachments, requestedMode) => {
    if (/^\/\S/.test(prompt.trim())) {
      return submitCommand(session, prompt);
    }
    /* Clearing is SURFACE-owned and generation-guarded: a completion that
       lands after the user edited again (or switched away and back) clears
       nothing. The empty mirror publish rides the same history-recording
       door, so its echo can never resurrect the prompt. */
    const gen = editGenRef.current[session.id] || 0;
    /* Offer and forward a delivery mode only when the daemon advertises
       queue_control_v1. The Rust submit boundary silently ignores an
       unknown `mode` argument (serde drops it), so sending one to a daemon
       that cannot honour it would render "Steer" while performing a plain
       queued send — a fabricated affordance. Absent the bit, the mode is
       not merely hidden: it is not sent. */
    const deliveryMode = effectiveSessionDeliveryMode(rpcFeatures, requestedMode);
    const send = () => submitSessionPrompt(invoke, {
      sessionId: session.id,
      prompt,
      attachments: attachments || [],
      ...(deliveryMode === undefined ? {} : { mode: deliveryMode }),
    });
    const accept = (result) => {
      recordSubmissionConfirmation(session.id, result, prompt);
      if ((editGenRef.current[session.id] || 0) === gen) {
        setComposerText(session.id, "");
        setComposerPastesFor(session.id, []);
        publishMirror(session, "");
      }
      return true;
    };
    try {
      const result = await send();
      return accept(result);
    } catch (error) {
      const message = String(error?.message || error || "");
      if (message.includes("haider_run_session_unsupported")) {
        setModeFor(session.id, "terminal");
        return false;
      }
      /* A session whose shell is closed has nothing to submit THROUGH, and
         the message must not be lost for it: hold the typed text in place —
         the composer greys it rather than clearing — bring the session up,
         and send once it answers. The text only clears on a real accept. */
      setSubmitHold((current) => ({ ...current, [session.id]: "Starting the session…" }));
      onShellWarm?.(session.id);
      setShellTouched((current) => (
        current[session.id] ? current : { ...current, [session.id]: true }
      ));
      try {
        for (let attempt = 0; attempt < SUBMIT_WAKE_ATTEMPTS; attempt += 1) {
          await new Promise((resolve) => { window.setTimeout(resolve, SUBMIT_WAKE_BACKOFF_MS); });
          try {
            const result = await send();
            return accept(result);
          } catch (retryError) {
            if (String(retryError?.message || retryError || "")
              .includes("haider_run_session_unsupported")) {
              setModeFor(session.id, "terminal");
              return false;
            }
          }
        }
        /* Still nothing after waking: say so and KEEP the text, because the
           user's words are the one thing here that cannot be recreated. */
        setSubmitHold((current) => ({
          ...current,
          [session.id]: "Could not reach this session — your message is kept here.",
        }));
        return false;
      } finally {
        window.setTimeout(() => {
          setSubmitHold((current) => {
            if (!(session.id in current)) return current;
            const next = { ...current };
            delete next[session.id];
            return next;
          });
        }, SUBMIT_HOLD_CLEAR_MS);
      }
    }
  }, [
    onShellWarm,
    publishMirror,
    recordSubmissionConfirmation,
    rpcFeatures,
    setComposerPastesFor,
    setComposerText,
    setModeFor,
    submitCommand,
  ]);

  /* Session title chrome: the title is the workspace's first content line;
     its ellipsis menu carries Pin/Unpin plus the same receipt-backed
     lifecycle controls as the rail's context menu. */
  const [titleMenuFor, setTitleMenuFor] = useState("");
  const [titleRenamingId, setTitleRenamingId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const titleMenuRef = useRef(null);
  const titleMenuButtonRef = useRef(null);
  const titleMenuPanelRef = useRef(null);
  const [titleMenuPosition, setTitleMenuPosition] = useState(null);
  useLayoutEffect(() => {
    if (!titleMenuFor) {
      setTitleMenuPosition(null);
      return undefined;
    }
    const place = () => {
      const anchor = titleMenuButtonRef.current?.getBoundingClientRect();
      const menu = titleMenuPanelRef.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      const viewport = window.visualViewport;
      setTitleMenuPosition(viewportMenuPosition(anchor, menu, {
        width: viewport?.width || window.innerWidth,
        height: viewport?.height || window.innerHeight,
      }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [titleMenuFor]);
  useEffect(() => {
    if (!titleMenuFor) {
      return undefined;
    }
    const close = (event) => {
      if (titleMenuRef.current?.contains(event.target)
        || titleMenuPanelRef.current?.contains(event.target)) {
        return;
      }
      setTitleMenuFor("");
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setTitleMenuFor("");
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [titleMenuFor]);
  const toggleSessionPin = useCallback(async (session) => {
    setTitleMenuFor("");
    try {
      await invoke("session_set_pinned", {
        session_id: session.id,
        pinned: !session.pinned,
      });
    } catch {
      // Store predates pinning — the menu action is a quiet no-op.
    }
  }, []);
  const beginTitleRename = useCallback((session) => {
    setTitleMenuFor("");
    setTitleRenamingId(session.id);
    setTitleDraft(session.title || "");
  }, []);
  const commitTitleRename = useCallback(async () => {
    const id = titleRenamingId;
    const title = titleDraft.trim();
    setTitleRenamingId("");
    if (!id) {
      return;
    }
    /* Empty is the daemon-defined clear operation. The hook omits title and
       refreshes the authority; this surface never invents a replacement. */
    await onRenameSession?.(id, title || undefined);
  }, [onRenameSession, titleDraft, titleRenamingId]);

  const lifecycleNoticeFor = (sessionId) => {
    const pending = lifecyclePendingBySession[sessionId] || {};
    const pendingAction = Object.keys(pending).find((action) => pending[action]);
    if (pendingAction) {
      return {
        kind: "pending",
        text: {
          rename: "Renaming…",
          compact: "Compacting…",
          fork: "Forking…",
          retry: "Retrying…",
        }[pendingAction],
      };
    }
    const error = Object.values(lifecycleErrorBySession[sessionId] || {}).find(Boolean);
    return error ? { kind: "error", text: "Lifecycle action failed", title: error } : null;
  };

  /* ONE header row for every tab: small title + its menu on the left, the
     view cluster (segmented, status pill, theme) on the right; wraps to a
     second line only when the pane is too narrow. */
  const workHeader = (session, options = {}) => (
    /* The header doubles as a window-drag region (AppShell's titlebar
       handler: interactive elements opt out, double-click zooms). */
    <WorkHeader onMouseDown={onHeaderDragStart || undefined}>
      {session ? renderTitleBlock(session) : <span />}
      <WorkHeaderSpacer aria-hidden="true" />
      {floatingControls(session, options)}
    </WorkHeader>
  );

  const renderTitleBlock = (session) => {
    const lifecycleNotice = lifecycleNoticeFor(session.id);
    return (
      <TitleRow>
        {titleRenamingId === session.id ? (
          <TitleRenameInput
            aria-label="Rename session"
            autoFocus
            onBlur={() => void commitTitleRename()}
            onChange={(event) => setTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitTitleRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setTitleRenamingId("");
              }
            }}
            value={titleDraft}
          />
        ) : (
          <h1 title={session.title}>{session.title}</h1>
        )}
        {lifecycleNotice && (
          <LifecycleTitleNotice
            data-kind={lifecycleNotice.kind}
            role={lifecycleNotice.kind === "pending" ? "status" : "alert"}
            title={lifecycleNotice.title}
          >
            {lifecycleNotice.text}
          </LifecycleTitleNotice>
        )}
        <TitleMenuWrap ref={titleMenuFor === session.id ? titleMenuRef : undefined}>
          <HeaderIconButton
            ref={titleMenuFor === session.id ? titleMenuButtonRef : undefined}
            aria-expanded={titleMenuFor === session.id}
            aria-haspopup="menu"
            aria-label="Session menu"
            onClick={() => setTitleMenuFor(
              (current) => (current === session.id ? "" : session.id),
            )}
            title="Session options"
            type="button"
          >
            <MoreHoriz aria-hidden="true" size={15} />
          </HeaderIconButton>
          {titleMenuFor === session.id && createPortal(
            <TitleMenu
              $left={titleMenuPosition?.left}
              $positioned={Boolean(titleMenuPosition)}
              $top={titleMenuPosition?.top}
              ref={titleMenuPanelRef}
              role="menu"
            >
              <TitleMenuItem
                onClick={() => void toggleSessionPin(session)}
                role="menuitem"
                type="button"
              >
                <PushPin aria-hidden="true" />
                <span>{session.pinned ? "Unpin" : "Pin"}</span>
              </TitleMenuItem>
              {session.id !== "draft" && (
                <SessionLifecycleMenuItems
                  errorBySession={lifecycleErrorBySession}
                  onBeginRename={beginTitleRename}
                  onCompact={onCompactSession}
                  onDismiss={() => setTitleMenuFor("")}
                  onFork={onForkSession}
                  onForked={(receipt) => onOpenSession?.({ id: receipt.sessionId })}
                  onRetry={onRetrySession}
                  pendingBySession={lifecyclePendingBySession}
                  session={session}
                  unavailableByAction={lifecycleUnavailableByAction}
                />
              )}
            </TitleMenu>,
            document.body,
          )}
        </TitleMenuWrap>
        {session.id !== "draft" && onPopOutSession && (
          <HeaderIconButton
            aria-label="Pop out session"
            onClick={() => onPopOutSession(session)}
            title="Open this session in its own window"
            type="button"
          >
            <OpenInNew aria-hidden="true" />
          </HeaderIconButton>
        )}
      </TitleRow>
    );
  };

  /* Floating cluster, top-right of the workspace — ONLY view-scoped chrome:
     the segmented view control (with the session's panel tabs riding it),
     the exact harness status pill, and the theme toggle. */
  const floatingControls = (session, { showToggle = true } = {}) => {
    const tabsState = session && session.id !== "draft" ? tabsStateFor(session.id) : null;
    const panelTabs = tabsState ? tabsState.tabs.filter((tab) => tab.kind !== "chat") : [];
    const activeTabIsChat = !tabsState
      || !tabsState.tabs.some((tab) => tab.id === tabsState.activeTabId)
      || tabsState.activeTabId === "chat";
    const selectView = (viewMode) => {
      if (tabsState && !activeTabIsChat) {
        selectTab(session.id, "chat");
      }
      setModeFor(session.id, viewMode);
    };
    /* status_segment_structured_v1: only state/detail can carry structured
       authority. The raw line/local bucket remain useful presentation, with
       provenance beside the rendered label instead of masquerading as it. */
    const availability = session && session.id !== "draft"
      ? sessionAvailabilityPresentation(session)
      : null;
    const statusPillView = session && session.id !== "draft"
      ? surfaceStatusPillView(surfaceStatus[session.id] || null, session, availability)
      : null;
    const statusLine = statusPillView?.label || "";
    return (
      <FloatingControls>
        {showToggle && session && (
        <SessionViewToggle aria-label="Session view" role="tablist">
          <SessionViewButton
            aria-selected={activeTabIsChat && modeFor(session.id) === "ui"}
            data-active={activeTabIsChat && modeFor(session.id) === "ui" ? "true" : undefined}
            onClick={() => selectView("ui")}
            role="tab"
            type="button"
          >
            <Forum aria-hidden="true" size={13} />
            <span>Chat</span>
          </SessionViewButton>
          <SessionViewButton
            aria-selected={activeTabIsChat && modeFor(session.id) === "terminal"}
            data-active={activeTabIsChat && modeFor(session.id) === "terminal" ? "true" : undefined}
            onClick={() => selectView("terminal")}
            role="tab"
            type="button"
          >
            <TerminalGlyph aria-hidden="true" size={13} />
            <span>Shell</span>
          </SessionViewButton>
          {session.id !== "draft" && (
            <SessionViewButton
              aria-selected={activeTabIsChat && modeFor(session.id) === "trajectory"}
              data-active={activeTabIsChat && modeFor(session.id) === "trajectory" ? "true" : undefined}
              onClick={() => selectView("trajectory")}
              role="tab"
              title="Trajectory"
              type="button"
            >
              <Timeline aria-hidden="true" size={13} />
              <span>Traj</span>
            </SessionViewButton>
          )}
          {session.id !== "draft" && (
            <SessionViewButton
              aria-selected={activeTabIsChat && modeFor(session.id) === "fleet"}
              data-active={activeTabIsChat && modeFor(session.id) === "fleet" ? "true" : undefined}
              onClick={() => selectView("fleet")}
              role="tab"
              title="Subagents"
              type="button"
            >
              <AccountTree aria-hidden="true" size={13} />
              <span>Fleet</span>
            </SessionViewButton>
          )}
          {session && session.id !== "draft" && (
            <SessionViewButton
              aria-selected={activeTabIsChat && modeFor(session.id) === "monitors"}
              data-active={activeTabIsChat && modeFor(session.id) === "monitors" ? "true" : undefined}
              onClick={() => selectView("monitors")}
              role="tab"
              title="Monitors"
              type="button"
            >
              <NotificationsActive aria-hidden="true" size={13} />
              <span>Monitors</span>
            </SessionViewButton>
          )}
          {session && session.id !== "draft" && (
            <SessionViewButton
              aria-selected={activeTabIsChat && modeFor(session.id) === "checkpoints"}
              data-active={activeTabIsChat && modeFor(session.id) === "checkpoints" ? "true" : undefined}
              onClick={() => selectView("checkpoints")}
              role="tab"
              title="Checkpoint timeline"
              type="button"
            >
              <History aria-hidden="true" size={13} />
              <span>History</span>
            </SessionViewButton>
          )}
          {session.id !== "draft" && (
            <SessionViewButton
              aria-selected={activeTabIsChat && modeFor(session.id) === "graph"}
              data-active={activeTabIsChat && modeFor(session.id) === "graph" ? "true" : undefined}
              onClick={() => selectView("graph")}
              role="tab"
              title="Live workflow graph"
              type="button"
            >
              <Mediation aria-hidden="true" size={13} />
              <span>Graph</span>
            </SessionViewButton>
          )}
          {panelTabs.map((tab) => {
            const panel = PANEL_KINDS[tab.kind];
            const PanelIcon = panel?.Icon || ButtonAddIcon;
            const label = panel?.label || "New panel";
            return (
              <SessionViewButton
                aria-selected={tabsState.activeTabId === tab.id}
                data-active={tabsState.activeTabId === tab.id ? "true" : undefined}
                key={tab.id}
                onClick={() => selectTab(session.id, tab.id)}
                role="tab"
                title={label}
                type="button"
              >
                <PanelIcon aria-hidden="true" size={13} />
                <span>{label}</span>
                <PanelSegClose
                  aria-label="Close panel"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(session.id, tab.id);
                  }}
                  role="button"
                  tabIndex={-1}
                >
                  <ButtonCloseIcon aria-hidden="true" />
                </PanelSegClose>
              </SessionViewButton>
            );
          })}
          {session.id !== "draft" && (
            <SegAddButton
              aria-label="New panel"
              onClick={() => addTab(session.id)}
              title="New panel"
              type="button"
            >
              <ButtonAddIcon aria-hidden="true" />
            </SegAddButton>
          )}
        </SessionViewToggle>
        )}
        {session && session.id !== "draft" && (
          <StatusPill
            data-session-availability={availability?.reason}
            data-status={statusPillView.status}
            data-status-authority={statusPillView.authority}
            data-status-source={statusPillView.source}
            data-structured-status={statusPillView.structuredStatus}
            title={statusPillView.title}
          >
            <i aria-hidden="true" />
            <span>{availability?.label || statusLine}</span>
          </StatusPill>
        )}
        {/* Persona binding control beside the status pill. A binding is NOT
            readiness: the pill keeps sole authority over run state, and the
            select's own labeling says persona-only. An UNSEEN receipt stays
            undefined (binding unknown) — it is never collapsed to null, which
            would falsely claim "No persona". */}
        {session && session.id !== "draft" && (
          <SessionPersonaSelect
            agentTypes={loomAgentTypes}
            binding={loomPersonaBySession[session.id]}
            onSelect={onSelectPersona}
            sessionId={session.id}
          />
        )}
        {/* Workflow indicator beside the persona select. DISPLAY-ONLY, and
            its state is ONLY what graph_status reported for this session
            (never the workflows list, the persona, or lineage). An UNSEEN
            read stays undefined — it is never collapsed into a "No
            workflow" claim for a status we never read. */}
        {session && session.id !== "draft" && (
          <WorkflowStatusChip
            statusView={workflowStatusBySession[session.id]}
            unavailable={workflowUnavailable}
          />
        )}
        <HeaderIconButton
          aria-label={appThemeIsLight ? "Switch to dark theme" : "Switch to light theme"}
          onClick={onToggleTheme}
          title={appThemeIsLight ? "Dark theme" : "Light theme"}
          type="button"
        >
          {appThemeIsLight
            ? <ButtonDarkModeIcon aria-hidden="true" />
            : <ButtonLightModeIcon aria-hidden="true" />}
        </HeaderIconButton>
      </FloatingControls>
    );
  };

  if (draftOpen) {
    // Draft = the harness itself. Default view is the Chat composer —
    // selected and immediately typeable — with the plain haider TUI mounted
    // warm behind it (Shell toggle). Both defer creation to the harness
    // (session_start_with_prompt only surfaces bound rows).
    const draftSession = {
      id: "draft",
      title: "New chat",
      dir: "",
      kind: "pinned",
      provider: "haider",
      provider_session_id: "",
      status: "idle",
    };
    const draftMode = modeFor("draft");
    return (
      <SessionSurfaceRoot>
        <SessionPane data-active="true">
          {workHeader(draftSession)}
          <PaneContent>
            {/* Both draft views stay mounted (hidden one display:none) so
                Chat↔Shell flips are instant and the TUI stays warm. */}
            <ChatHostLayer data-visible={draftMode === "ui" ? "true" : "false"}>
              <DraftBody>
                <EmptyState>
                  <EmptyStateIcon aria-hidden="true">
                    <TerminalGlyph size={22} />
                  </EmptyStateIcon>
                  <h2>No session yet.</h2>
                  <p>Send a message below — the Haider harness creates the session and its folder on your first message. Nothing runs until then.</p>
                  {draftError && <DraftError>{draftError}</DraftError>}
                </EmptyState>
              </DraftBody>
              <SessionComposer
                attachments={composerAttachments.draft || []}
                autoFocus
                chipCapabilities={{
                  ...(library?.capabilities || {}),
                  /* At the launcher `/model` is explicitly client_view: this
                     menu chooses first-run defaults and mutates no daemon
                     session truth. */
                  model_switch: commandDoorAvailable
                    || library?.capabilities?.model_switch === true,
                }}
                chipOptions={chipOptionsFor(null)}
                chipValues={chipValuesFor(null)}
                commandMenuRequest={commandMenuRequests.draft || null}
                commandNotice={commandResults.draft || null}
                onAttachmentsChange={(next) => handleAttachmentsChange({ id: "draft" }, next)}
                onChipChange={(key, option) => handleChipChange("draft", key, option)}
                onChipMenuOpen={() => { void refreshLibrary(); }}
                onSubmit={submitDraft}
                onPastedBlocksChange={(blocks) => setComposerPastesFor("draft", blocks)}
                onValueChange={(text) => setComposerText("draft", text)}
                pastedBlocks={composerPastes.draft || []}
                placeholder="Message Haider…"
                slashCommands={commandDoorAvailable ? slashCommands : []}
                value={composerTexts.draft || ""}
              />
            </ChatHostLayer>
            {(draftMode === "terminal" || shellTouched.draft) && (
              <TerminalHostLayer data-visible={draftMode === "terminal" ? "true" : "false"}>
                <SessionTerminal
                  active={draftMode === "terminal"}
                  bindingAuthority={sessionBinding.authority}
                  onTuiAttached={handleLegacyTuiAttached}
                  paneIdOverride={paneOverrides.draft}
                  session={draftSession}
                />
              </TerminalHostLayer>
            )}
          </PaneContent>
        </SessionPane>
      </SessionSurfaceRoot>
    );
  }

  if (!activeSessionId) {
    // Home: the flame hero with the plan tiers, plus recent sessions to
    // continue — including ones created directly in the haider CLI once the
    // bridge imports them.
    // Max 3 recents, like the CLI's own launcher list.
    const recentSessions = sessions.slice(0, 3);
    return (
      <SessionSurfaceRoot>
        <SessionPane data-active="true">
          {workHeader(null, { showToggle: false })}
          <PaneContent>
            <HomeBody>
              <HomeLogo alt="" src="/logo.webp" />
              <HomeContinue>
                <HomeContinueTitle>
                  {recentSessions.length ? "Continue" : "Start your first session"}
                </HomeContinueTitle>
                {recentSessions.map((session) => (
                  <HomeContinueRow
                    key={session.id}
                    onClick={() => onOpenSession?.(session)}
                    type="button"
                  >
                    <HomeContinueDot
                      aria-hidden="true"
                      data-status={sessionActivityVisualState(session)}
                    />
                    <HomeContinueSessionTitle>{session.title}</HomeContinueSessionTitle>
                    <HomeAvailabilityAffordance session={session} />
                    <em>{formatSessionRelativeTime(session.latest_at_ms)}</em>
                  </HomeContinueRow>
                ))}
                <HomeNewChat onClick={onResetToDraft} type="button">
                  <ButtonAddIcon aria-hidden="true" />
                  <span>New chat</span>
                </HomeNewChat>
              </HomeContinue>
              <HomeFlame>
                <PlanFlame active plan={planKey} showControls />
              </HomeFlame>
            </HomeBody>
          </PaneContent>
        </SessionPane>
      </SessionSurfaceRoot>
    );
  }

  return (
    <SessionSurfaceRoot>
      {openSessions.map((session) => {
        const active = session.id === activeSessionId;
        const mode = modeFor(session.id);
        const { tabs, activeTabId } = tabsStateFor(session.id);
        const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
        const chatTabActive = activeTab.id === "chat";
        const runStatusView = surfaceRunStatusView(
          surfaceStatus[session.id],
          session,
          sessionActivityVisualState(session) === "running",
          sessionRunIsActive(session),
        );
        return (
          <SessionPane data-active={active ? "true" : "false"} key={session.id}>
            {workHeader(session)}

            <PaneContent>
              {/* Chat tab: Chat and Shell BOTH stay mounted for the ACTIVE
                  session — the unselected view is display:none — so flips
                  are instant, xterm state survives, and the shell is live
                  before the first toggle. Background sessions mount neither;
                  their PTYs persist daemon-side and are re-adopted here. */}
              {chatTabActive && active && (
                <>
                  <ChatHostLayer
                    data-run-status-authority={runStatusView.authority}
                    data-run-status-source={runStatusView.source}
                    data-run-structured-status={runStatusView.structuredStatus}
                    data-visible={mode === "ui" ? "true" : "false"}
                  >
                    <SessionTranscript
                      onAnswered={onSessionsRefresh}
                      onSyncingChange={(syncing) => handleTranscriptSyncing(session.id, syncing)}
                      runStatus={runStatusView.label}
                      session={session}
                    />
                    <SessionQueuePanel
                      actionBusy={queueActionBusy}
                      actionError={queueActionError}
                      confirmation={submissionConfirmations[session.id] || null}
                      onPromoteSteer={(id) => { void mutateQueuedRow("promoteSteer", id); }}
                      onRefresh={() => setQueueRefreshGeneration((value) => value + 1)}
                      onRemove={(id) => { void mutateQueuedRow("remove", id); }}
                      state={queueState}
                    />
                    <SessionComposer
                      chipCapabilities={library?.capabilities || {}}
                      chipOptions={chipOptionsFor(session)}
                      chipValues={chipValuesFor(session)}
                      commandMenuRequest={commandMenuRequests[session.id] || null}
                      commandNotice={commandResults[session.id] || null}
                      deliveryMode={composerDeliveryModes[session.id] || "queue"}
                      onChipChange={(key, option) => handleChipChange(session.id, key, option)}
                      onChipMenuOpen={() => {
                        void refreshLibrary();
                        refreshConfig(session.id);
                      }}
                      attachments={composerAttachments[session.id] || []}
                      holdNotice={submitHold[session.id] || ""}
                      onCancelTurn={cancelTurnFor(session)}
                      mirrorAttachments={mirrorAttachments[session.id] || []}
                      onAttachmentsChange={(next) => handleAttachmentsChange(session, next)}
                      onMirrorType={(text) => publishMirror(session, text)}
                      {...sessionComposerDeliveryModeProps(
                        rpcFeatures,
                        (deliveryMode) => setComposerDeliveryModes((current) => ({
                          ...current,
                          [session.id]: normalizeDeliveryMode(deliveryMode),
                        })),
                      )}
                      onSubmit={(prompt, attachments, deliveryMode) => (
                        submitIntoSession(session, prompt, attachments, deliveryMode)
                      )}
                      onPastedBlocksChange={(blocks) => setComposerPastesFor(session.id, blocks)}
                      onValueChange={(text) => setComposerText(session.id, text)}
                      pastedBlocks={composerPastes[session.id] || []}
                      slashCommands={commandDoorAvailable ? slashCommands : []}
                      value={composerTexts[session.id] || ""}
                    />
                  </ChatHostLayer>
                  {mode === "trajectory" && (
                    <TrajectoryHostLayer>
                      <SessionTrajectory session={session} />
                    </TrajectoryHostLayer>
                  )}
                  {/* Fleet view (P2): descendant tree + rollup chips from
                      session.fleet, drilldown into a child's OWN transcript,
                      agent.message composer. Presentational components only —
                      every invoke lives in useFleet.js (AppShell-owned). */}
                  {mode === "fleet" && session.id !== "draft" && (() => {
                    const snapshotEntry = fleetBySession[session.id];
                    const liveForSession = descendantMode === "live"
                      && descendantSessionId === session.id
                      && descendantEntry;
                    const fleetEntry = liveForSession ? descendantEntry : snapshotEntry;
                    const fleetSelectedAgentId = fleetSelected[session.id] || "";
                    const fleetSelectedNode = fleetEntry
                      ? findFleetNode(fleetEntry.tree, fleetSelectedAgentId)
                      : null;
                    return (
                      <FleetHostLayer>
                        <FleetPanel
                          entry={fleetEntry}
                          error={fleetError}
                          fallbackEntry={snapshotEntry}
                          loading={fleetLoading}
                          onObserveAll={() => {
                            if (!fleetEntry) return;
                            /* SDK bound: at most 64 ids per observe batch. */
                            onObserveFleetBatch?.(
                              fleetSessionIds(fleetEntry.tree).slice(0, 64),
                            );
                          }}
                          onRefresh={() => onLoadFleet?.(session.id)}
                          onReconnect={() => onReconnectDescendantStream?.(session.id)}
                          onSelectNode={(node) => {
                            setFleetSelected((current) => ({
                              ...current,
                              [session.id]: node.agentId,
                            }));
                            if (node.sessionId) onObserveFleetChild?.(node.sessionId);
                          }}
                          onSendMessage={(node, text) => (
                            /* agent.message addresses a DIRECT child of its
                               session_id — so the dispatch uses the node's
                               REAL parent_session_id from the fleet, never an
                               assumed parent. */
                            onSendAgentMessage?.(node.parentSessionId, node.agentId, text)
                          )}
                          selectedAgentId={fleetSelectedAgentId}
                          streamError={descendantError}
                          streamLoading={descendantLoading}
                          streamMode={descendantSessionId === session.id
                            ? descendantMode
                            : "unavailable"}
                          streamRepair={descendantSessionId === session.id
                            ? descendantRepair
                            : null}
                          unavailable={fleetUnavailable}
                        />
                        {fleetSelectedNode && (
                          <FleetChildTranscript
                            digest={fleetChildDigests[fleetSelectedNode.sessionId]}
                            node={fleetSelectedNode}
                            onObserve={() => onObserveFleetChild?.(fleetSelectedNode.sessionId)}
                          />
                        )}
                      </FleetHostLayer>
                    );
                  })()}
                  {/* Monitor manager (P4): per-source availability, the
                      listed registry, register/remove controls, and the
                      live delivery stream. MonitorPanel is presentational;
                      useMonitor.js owns every daemon dispatch. */}
                  {mode === "monitors" && session && session.id !== "draft" && (
                    <MonitorHostLayer>
                      <MonitorPanel
                        cursor={monitorCursor}
                        deliveries={monitorDeliveries}
                        entry={monitorBySession[session.id]}
                        error={monitorError}
                        loading={monitorLoading}
                        onRefresh={() => onLoadMonitors?.(session.id)}
                        onRegister={(spec) => onRegisterMonitor?.(session.id, spec)}
                        onRemove={(monitorId) => onRemoveMonitor?.(session.id, monitorId)}
                        unavailable={monitorUnavailable}
                        watchOutcome={monitorWatchOutcome}
                      />
                    </MonitorHostLayer>
                  )}
                  {/* Durable workspace checkpoint timeline (Wave2): newest-
                      first authority list plus receipt-backed undo, redo,
                      and turn rollback. CheckpointPanel is presentational;
                      all four invokes live in useCheckpoints.js. */}
                  {mode === "checkpoints" && session && session.id !== "draft" && (
                    <CheckpointHostLayer>
                      <CheckpointPanel
                        branchId={publishedCheckpointBranchId(session)}
                        conflict={checkpointConflictBySession[session.id]}
                        entry={checkpointBySession[session.id]}
                        error={checkpointErrorBySession[session.id] || ""}
                        loading={checkpointLoadingBySession[session.id] === true}
                        onLoadMore={() => onLoadMoreCheckpoints?.(
                          session.id,
                          publishedCheckpointBranchId(session),
                        )}
                        onRedo={(target) => onRedoCheckpoint?.(
                          session.id,
                          publishedCheckpointBranchId(session),
                          target,
                        )}
                        onRefresh={() => onLoadCheckpoints?.(
                          session.id,
                          publishedCheckpointBranchId(session),
                        )}
                        onRollbackTurn={(runId) => onRollbackCheckpointTurn?.(
                          session.id,
                          publishedCheckpointBranchId(session),
                          runId,
                        )}
                        onUndo={(target) => onUndoCheckpoint?.(
                          session.id,
                          publishedCheckpointBranchId(session),
                          target,
                        )}
                        pending={checkpointPendingBySession[session.id]}
                        receipt={checkpointReceiptBySession[session.id]}
                        unavailable={checkpointUnavailable}
                      />
                    </CheckpointHostLayer>
                  )}
                  {/* Live workflow graph (P6): the workflow_graph_v1
                      projection — topology + per-node runtime state from
                      workflow.graph.state, kept live by the hook's
                      workflow.graph.watch change-signal loop. The view is
                      presentational only — both invokes live in
                      useWorkflowGraph.js (AppShell-owned) — and an UNSEEN
                      state read stays undefined here: it is never
                      collapsed into a "no live graph" claim. */}
                  {mode === "graph" && session.id !== "draft" && (
                    <GraphHostLayer>
                      <WorkflowGraphView
                        cursor={workflowGraphCursor}
                        entry={workflowGraphBySession[session.id]}
                        error={workflowGraphError}
                        events={workflowGraphEvents}
                        unavailable={workflowGraphUnavailable}
                      />
                    </GraphHostLayer>
                  )}
                </>
              )}
              {/* Three honest reasons to mount: you are looking at it; it is
                  kept warm (stays mounted while you work elsewhere, so
                  switching back skips xterm re-instantiation + replay); or
                  it is pre-warming for an open session. Turning it OFF from
                  the rail suppresses the last two, so off means off. */}
              {(() => {
                const pref = shellPrefs[session.id];
                const viewing = chatTabActive && active && mode === "terminal";
                const preWarm = chatTabActive && active
                  && shellTouched[session.id] && pref !== false;
                return viewing || preWarm || pref === true;
              })() && (
                <TerminalHostLayer
                  data-visible={chatTabActive && active && mode === "terminal" ? "true" : "false"}
                >
                  <SessionTerminal
                    active={chatTabActive && active && mode === "terminal"}
                    bindingAuthority={sessionBinding.authority}
                    onTuiAttached={handleLegacyTuiAttached}
                    paneIdOverride={paneOverrides[session.id]}
                    session={session}
                  />
                </TerminalHostLayer>
              )}

              {/* Panel tabs: picker, then staged panel stubs. */}
              {!chatTabActive && activeTab.kind === "picker" && (
                <PanelPickerBody>
                  <EmptyState>
                    <h2>Choose a panel</h2>
                    <p>Panels attach to this session and work inside its folder.</p>
                  </EmptyState>
                  <PanelPickerGrid>
                    {Object.entries(PANEL_KINDS).map(([kind, panel]) => (
                      <PanelPickerCard
                        key={kind}
                        onClick={() => setTabPanel(session.id, activeTab.id, kind)}
                        type="button"
                      >
                        <panel.Icon aria-hidden="true" size={22} />
                        <strong>{panel.label}</strong>
                      </PanelPickerCard>
                    ))}
                  </PanelPickerGrid>
                </PanelPickerBody>
              )}
              {!chatTabActive && PANEL_KINDS[activeTab.kind] && (
                <PanelPickerBody>
                  <EmptyState>
                    <EmptyStateIcon aria-hidden="true">
                      {(() => {
                        const PanelIcon = PANEL_KINDS[activeTab.kind].Icon;
                        return <PanelIcon size={22} />;
                      })()}
                    </EmptyStateIcon>
                    <h2>{PANEL_KINDS[activeTab.kind].label}</h2>
                    <p>This panel is being rebuilt session-native. It will open inside this session's folder.</p>
                  </EmptyState>
                </PanelPickerBody>
              )}
            </PaneContent>
          </SessionPane>
        );
      })}
    </SessionSurfaceRoot>
  );
}

const SessionSurfaceRoot = styled.div`
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  min-width: 0;
  min-height: 0;
  background: var(--forge-bg);
`;

const SessionPane = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  min-height: 0;
  flex-direction: column;

  &[data-active="false"] {
    visibility: hidden;
    pointer-events: none;
  }
`;

const PaneContent = styled.div`
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* The old top bar's controls live HERE — floating in the workspace's
   top-right corner, scoped visually to the session under them. */
/* The view cluster rides the header row (right side), wrapping under the
   title only when the pane is too narrow. */
const FloatingControls = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`;

/* ONE row of workspace chrome, on every tab: title + menu left, cluster
   right. Normal flow — content starts below it, no overlay clearances. */
const WorkHeader = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 10px 16px 8px;
  border-bottom: 1px solid var(--forge-border);
  /* Drag region (see workHeader). */
  user-select: none;
  -webkit-user-select: none;
`;

const WorkHeaderSpacer = styled.span`
  flex: 1;
`;

const SessionViewToggle = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  background: var(--forge-surface-control);
`;

const SessionViewButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 11px;
  border: 0;
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;

  svg {
    flex: 0 0 auto;
  }

  &[data-active="true"] {
    color: var(--forge-text);
    background: rgba(var(--forge-tint-rgb), 0.22);
    box-shadow: inset 0 0 0 1px rgba(var(--forge-tint-soft-rgb), 0.35);
  }

  &:hover:not([data-active="true"]):not(:disabled) {
    color: var(--forge-text-soft);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }

  > span {
    max-width: 120px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

/* Close affordance on a panel segment (design note 5: panels are workspace
   tabs riding behind the segmented control). */
const PanelSegClose = styled.span`
  display: grid;
  width: 13px;
  height: 13px;
  margin-left: 1px;
  place-items: center;
  border-radius: 4px;
  color: var(--forge-text-muted);

  svg {
    width: 9px;
    height: 9px;
  }

  &:hover {
    color: var(--forge-text);
    background: rgba(255, 255, 255, 0.12);
  }
`;

const SegAddButton = styled.button`
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  place-items: center;
  align-self: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;

  svg {
    width: 11px;
    height: 11px;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const StatusPill = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10px;
  font-weight: 700;

  /* The harness line stays byte-exact; a floating pill just can't grow
     without bound, so extreme lines clip visually (full text on hover). */
  > span {
    max-width: 300px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--forge-text-disabled);
  }

  &[data-status="running"] i {
    background: var(--forge-green);
  }

  &[data-status="waiting"] i {
    background: var(--forge-amber);
  }

  &[data-status="error"] i {
    background: var(--forge-red);
  }

  &[data-session-availability="daemon-unavailable"] i {
    background: var(--forge-red);
  }

  &[data-session-availability="not-published"] i {
    background: var(--forge-amber);
  }

  &[data-session-availability="legacy-provenance"] i {
    background: var(--forge-text-muted);
  }
`;

const HeaderIconButton = styled.button`
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
  }
`;

/* ---- content-first title line ---------------------------------------- */

const TitleRow = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;

  h1 {
    min-width: 0;
    max-width: 34rem;
    margin: 0;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 14px;
    font-weight: 680;
    letter-spacing: -0.01em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const TitleRenameInput = styled.input`
  flex: 1;
  min-width: 0;
  padding: 2px 8px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 8px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.015em;
  outline: none;
`;

const TitleMenuWrap = styled.div`
  position: relative;
  flex: 0 0 auto;
`;

const TitleMenu = styled.div`
  position: fixed;
  top: ${({ $top }) => `${$top ?? 0}px`};
  left: ${({ $left }) => `${$left ?? 0}px`};
  z-index: 40;
  display: grid;
  width: 280px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  gap: 1px;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--forge-border-strong);
  border-radius: 9px;
  background: var(--forge-surface-raised, var(--forge-surface));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  box-sizing: border-box;
  visibility: ${({ $positioned }) => ($positioned ? "visible" : "hidden")};
`;

const TitleMenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  text-align: left;

  svg {
    width: 13px;
    height: 13px;
    opacity: 0.8;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const LifecycleTitleNotice = styled.em`
  flex: 0 0 auto;
  color: var(--forge-amber);
  font-size: 9.5px;
  font-style: normal;

  &[data-kind="error"] { color: var(--forge-red); }
`;

/* Keep-warm wrappers: the active session's Chat and Shell both stay mounted;
   the view not selected collapses to display:none. */
const TerminalHostLayer = styled.div`
  flex: 1;
  min-height: 0;

  &[data-visible="false"] {
    display: none;
  }
`;

const TrajectoryHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* Fleet view host: the tree/rollup panel on top (own scroll), the selected
   child's transcript filling the rest. */
const FleetHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;

  > section[aria-label="Subagents"] {
    flex: none;
    max-height: 45%;
  }
`;

/* Monitor manager host: MonitorPanel owns its vertical scroll. */
const MonitorHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* Checkpoint timeline host: CheckpointPanel owns its vertical scroll. */
const CheckpointHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* Live workflow-graph view host: the graph section owns the scroll. */
const GraphHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

const ChatHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;

  &[data-visible="false"] {
    display: none;
  }
`;

const DraftBody = styled.div`
  flex: 1;
  display: grid;
  min-height: 0;
  place-items: center;
`;

const HomeBody = styled.div`
  flex: 1;
  display: grid;
  min-height: 0;
  align-content: center;
  justify-items: center;
  gap: 10px;
  overflow-y: auto;
  padding: 24px 0;
`;

const HomeFlame = styled.div`
  width: min(560px, 90%);
`;

const HomeLogo = styled.img`
  width: 84px;
  height: 84px;
  margin-bottom: 4px;
  /* App-icon rounding (~22% of edge), matching WorkspaceIdleLogo — the
     square logo art reads hard-cornered against both themes. */
  border-radius: 18px;
  filter: drop-shadow(0 10px 30px rgba(47, 128, 255, 0.25));
`;

const HomeContinueDot = styled.i`
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--forge-green);

  &[data-status="running"],
  &[data-status="waiting"] {
    background: var(--forge-amber);
    animation: home-dot-work 1.1s ease-in-out infinite;
  }

  &[data-status="error"] {
    background: var(--forge-red);
    animation: none;
  }

  &[data-status="unknown"] {
    background: var(--forge-text-disabled);
    animation: none;
  }

  @keyframes home-dot-work {
    50% {
      opacity: 0.35;
    }
  }
`;

const HomeContinue = styled.div`
  display: grid;
  width: min(420px, 88%);
  gap: 4px;
`;

const HomeContinueTitle = styled.div`
  margin: 6px 6px 4px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const HomeContinueRow = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;

  > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  em {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-style: normal;
  }

  &:hover {
    color: var(--forge-text);
    border-color: rgba(var(--forge-tint-soft-rgb), 0.45);
  }
`;

const HomeContinueSessionTitle = styled.span``;

const HomeAvailabilityAffordance = styled(SessionAvailabilityAffordance)`
  flex: 0 0 auto !important;
  max-width: 92px;
  padding: 1px 4px;
  border: 1px solid color-mix(in srgb, var(--forge-amber) 42%, transparent);
  border-radius: 4px;
  color: var(--forge-amber);
  font-size: 8px;
  line-height: 1.25;

  &[data-session-availability="daemon-unavailable"] {
    border-color: color-mix(in srgb, var(--forge-red) 42%, transparent);
    color: var(--forge-red);
  }

  &[data-session-availability="legacy-provenance"] {
    border-color: var(--forge-border-strong);
    color: var(--forge-text-muted);
  }
`;

const HomeNewChat = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 6px;
  padding: 7px 0;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.4);
  border-radius: 9px;
  color: var(--forge-text);
  background: rgba(var(--forge-tint-rgb), 0.14);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    background: rgba(var(--forge-tint-rgb), 0.24);
  }
`;

const PanelPickerBody = styled.div`
  flex: 1;
  display: grid;
  min-height: 0;
  place-content: center;
  gap: 22px;
  justify-items: center;
`;

const PanelPickerGrid = styled.div`
  display: flex;
  gap: 12px;
`;

const PanelPickerCard = styled.button`
  display: grid;
  width: 132px;
  justify-items: center;
  gap: 10px;
  padding: 18px 12px 14px;
  border: 1px solid var(--forge-border);
  border-radius: 12px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  cursor: pointer;

  strong {
    font-size: 11.5px;
    font-weight: 700;
  }

  &:hover {
    color: var(--forge-text);
    border-color: rgba(var(--forge-tint-soft-rgb), 0.45);
    background: var(--forge-surface-hover);
  }
`;

const EmptyState = styled.div`
  max-width: 460px;
  text-align: center;

  h2 {
    margin: 12px 0 6px;
    color: var(--forge-text);
    font-size: 19px;
    font-weight: 700;
  }

  p {
    margin: 0;
    color: var(--forge-text-muted);
    font-size: 12.5px;
    line-height: 1.55;
  }
`;

const EmptyStateIcon = styled.span`
  display: inline-grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.4);
  border-radius: 12px;
  color: var(--forge-accent-soft);
  background: rgba(var(--forge-tint-rgb), 0.12);
`;

const DraftError = styled.div`
  margin-top: 12px;
  color: var(--forge-red);
  font-size: 12px;
`;
