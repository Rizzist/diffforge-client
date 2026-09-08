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
import styled from "styled-components";
import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { Build } from "@styled-icons/material-rounded/Build";
import { Forum } from "@styled-icons/material-rounded/Forum";
import { History } from "@styled-icons/material-rounded/History";
import { Language } from "@styled-icons/material-rounded/Language";
import { Mediation } from "@styled-icons/material-rounded/Mediation";
import { NotificationsActive } from "@styled-icons/material-rounded/NotificationsActive";
import { Terminal as TerminalGlyph } from "@styled-icons/material-rounded/Terminal";

import {
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
  adoptSurfaceCallerIdentity,
  applySessionSurfaceStatusEvent,
  surfaceInputMirrorPlan,
  surfaceRunStatusView,
} from "./sessionStatus.js";
import {
  SessionAvailabilityAffordance,
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
import SessionTerminal from "./SessionTerminal.jsx";
import SessionView, {
  ChatHostLayer,
  TerminalHostLayer,
  EmptyState,
  EmptyStateIcon,
} from "./SessionView.jsx";
import FleetPanel from "./FleetPanel.jsx";
import FleetChildTranscript from "./FleetChildTranscript.jsx";
import PeersPanel from "./PeersPanel.jsx";
import ShellsPanel from "./ShellsPanel.jsx";
import SshProfilesPanel from "./SshProfilesPanel.jsx";
import SshPtyTerminal from "./SshPtyTerminal.jsx";
import CapabilitiesPanel from "./CapabilitiesPanel.jsx";
import ProviderAdminPanel from "./ProviderAdminPanel.jsx";
import MonitorPanel from "./MonitorPanel.jsx";
import CheckpointPanel from "./CheckpointPanel.jsx";
import WorkflowGraphView from "./WorkflowGraphView.jsx";
import SessionSettingsMenu, {
  SettingsMenuItem,
} from "./SessionSettingsMenu.jsx";
import { findFleetNode, fleetSessionIds } from "./fleetModel.js";
import {
  formatSessionRelativeTime,
  sessionWorkingDirectory,
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
import { providerRowView } from "./providerAdminModel.js";
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

/* PANEL_KINDS and SETTINGS_MENU_MODES (the gear's relocated-mode list that
   lights it when a settings surface is current) moved to SessionView.jsx with
   the toggle and gear anchor. */

function publishedCheckpointBranchId(session) {
  return typeof session?.branch_id === "string" && session.branch_id.length > 0
    ? session.branch_id
    : null;
}

export default function SessionSurface({
  activeSessionId,
  appThemeIsLight = false,
  draftOpen,
  draftCreateCapabilities = {},
  draftCreateStatus = null,
  onCreateDraftSession = null,
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
  /* Loom registry + workflow catalog: relocated from the rail's Agent Types
     and Workflows sections into the Settings menu (F2-UI Part B). The same
     inline sections render here verbatim, so their honesty and
     feature-absence behaviors are unchanged. */
  loomWorkflowEntries = [],
  loomArchivedEntries = null,
  loomCliPresent = {},
  loomInstallByType = {},
  loomCancelByJob = {},
  loomRegistryCursor = null,
  loomListError = "",
  loomUnavailable = false,
  loomFeatureUnavailable = {},
  loomFeatureErrors = {},
  loomAuthoringConflict = null,
  onRegisterAgentType = null,
  onRefreshLoomRegistry = null,
  onListArchivedLoom = null,
  onValidateLoom = null,
  onDraftLoom = null,
  onReviseLoom = null,
  onConfirmLoom = null,
  onSetLoomArchived = null,
  onRefreshAgentInstall = null,
  onRetryAgentInstall = null,
  onCancelAgentInstall = null,
  workflowCatalog = { kind: "unread", entries: [] },
  workflowRecords = [],
  workflowInstanceById = {},
  workflowListError = "",
  onReadWorkflowInstance = null,
  onRegisterWorkflow = null,
  onPinWorkflow = null,
  onSwitchWorkflow = null,
  onAbandonWorkflow = null,
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
  peerRoster = null,
  peerOwnName = null,
  peerInbox = [],
  peerSentById = {},
  peerError = "",
  peerLoading = false,
  peerSending = false,
  peerUnavailable = false,
  onLoadPeers = null,
  onSendPeerMessage = null,
  shellRegistryBySession = {},
  shellOutputByShell = {},
  shellCloseOutcomeByShell = {},
  shellExecReceiptBySession = {},
  shellClosingByShell = {},
  shellExecutingBySession = {},
  shellRegistryError = "",
  shellRegistryLoading = false,
  shellRegistryUnavailable = false,
  onLoadShells = null,
  onCloseShell = null,
  onExecShell = null,
  sshProfilesBySession = {},
  sshProfileTestsBySession = {},
  sshScopeReceiptBySession = {},
  sshMutationReceiptBySession = {},
  sshProfileLoading = false,
  sshProfileAdding = false,
  sshProfileUpdatingByName = {},
  sshProfileRemovingByName = {},
  sshProfileTestingByName = {},
  sshProfileSettingScopeBySession = {},
  sshProfileError = "",
  sshProfileUnavailable = false,
  onLoadSshProfiles = null,
  onAddSshProfile = null,
  onUpdateSshProfile = null,
  onRemoveSshProfile = null,
  onTestSshProfile = null,
  onSetSessionSshScope = null,
  sshPtyOutputByShell = {},
  sshPtyStateByShell = {},
  sshPtyClosedByShell = {},
  sshPtyEofByShell = {},
  sshPtySubscriptionId = 0,
  sshPtyOpening = false,
  sshPtyError = "",
  sshPtyUnavailable = false,
  onOpenSshPty = null,
  onInputSshPty = null,
  onResizeSshPty = null,
  onEofSshPty = null,
  capabilityHooksByCwd = {},
  capabilityToolsBySession = {},
  capabilityHookReceiptByDigest = {},
  capabilityHookPendingByDigest = {},
  capabilityHookError = "",
  capabilityToolError = "",
  capabilityHookLoading = false,
  capabilityToolLoading = false,
  capabilityHooksUnavailable = false,
  capabilityToolsUnavailable = false,
  onLoadCapabilities = null,
  onLoadCapabilityHooks = null,
  onLoadCapabilityTools = null,
  onTrustHook = null,
  onRevokeHook = null,
  providerAdminLockdownByProvider = {},
  providerAdminGlobalLockdown = undefined,
  providerAdminLastReceipt = null,
  providerAdminConflict = null,
  providerAdminConfigurePending = false,
  providerAdminRemovePendingByProvider = {},
  providerAdminTrustPendingByProvider = {},
  providerAdminQuotaPending = false,
  providerAdminLockdownLoading = false,
  providerAdminConfigureError = "",
  providerAdminRemoveError = "",
  providerAdminLockdownError = "",
  providerAdminConfigureUnavailable = false,
  providerAdminRemoveUnavailable = false,
  providerAdminLockdownUnavailable = false,
  onLoadProviderAdmin = null,
  onReadProviderAdmin = null,
  onConfigureProvider = null,
  onRemoveProvider = null,
  onSetProviderTrust = null,
  onSetLockdownQuota = null,
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
  /* Public saved-profile name selected for the interactive PTY view. The
     daemon retains all credentials; no profile object enters this path. */
  const [sshPtyProfileBySession, setSshPtyProfileBySession] = useState({});
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
     mirrorCallerOwnerRef holds the daemon-published caller identity (970
     `session.surface_watch.caller_owner`), the authoritative self test when
     present; on 969 daemons that omit it, mirrorHistoryRef remembers our
     recent publishes so any pending echo (revision AND text match) teaches
     us our owner id; foreign lanes keep per-owner applied floors in
     mirrorForeignRef. A fresh TUI's revision 1 applies. */
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
     legacy self-echo matching must survive multiple in-flight publishes — a
     single-slot "latest" let an older echo resurrect a just-cleared prompt
     by masquerading as foreign. Cleared once the owner id is learned. Keys
     are DECIMAL STRINGS: the SDK delivers echo revisions as decimal u64
     strings (possibly above 2^53), never as JS numbers. */
  const mirrorHistoryRef = useRef({}); // sessionId -> Map(revisionString -> text)
  /* Daemon-published caller identity (970): mirrored verbatim from
     `caller_owner` on every accepted session-surface payload; "" until a
     new daemon publishes it, and cleared again when a legacy re-adoption
     emits payloads without the field — identity is watch-scoped, never
     remembered across a watch that did not establish it. */
  const mirrorCallerOwnerRef = useRef("");
  const mirrorSelfOwnerRef = useRef(""); // legacy echo-learned connection id
  const mirrorForeignRef = useRef({}); // sessionId -> {owner -> floorString}
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
    /* String key: the echo comes back with a decimal-string revision. The
       wire publish itself keeps the numeric u64. */
    history.set(String(revision), text);
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
  const [draftCreateOptions, setDraftCreateOptions] = useState({
    interactionMode: "",
    autoAllow: false,
    maxTokens: "4096",
  });
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
  const providerAdminRevision = library?.provider_revision == null
    ? undefined
    : library.provider_revision;
  const providerAdminRows = useMemo(() => (
    Array.isArray(library?.providers)
      ? library.providers.map((row) => providerRowView(row, providerAdminRevision))
      : undefined
  ), [library, providerAdminRevision]);
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
      /* `caller_owner` (970, A03): the daemon publishes OUR OWN identity at
         the watch-adoption barrier — adopted verbatim, no matching, no
         guessing. The SDK fences it by session/connection epoch and stamps
         the adopted watch's retained identity on EVERY payload it emits, so
         each accepted payload is mirrored exactly: a payload without the
         field can only come from a watch whose adoption established no
         identity (legacy 969 response) — the retained identity is cleared,
         the echo-matching fallback below returns to force, and absence
         never fabricates an identity. */
      mirrorCallerOwnerRef.current = adoptSurfaceCallerIdentity(
        payload,
        mirrorCallerOwnerRef.current,
      );
      if (payload.input?.text != null) {
        /* input_mirror_v1, owner-aware (rev934 P1-1, A03): suppression keys
           on owner-identity EQUALITY against the published caller_owner when
           adopted — never revision+text resemblance, which two publishers
           can share. Legacy fallback (no caller_owner): our own accepted
           publish echoed back (revision AND text match) names our lane and
           drops; other frames from that learned owner drop as echoes; every
           foreign lane applies when its OWN revision advances — a fresh
           publisher's revision 1 is newer than nothing of ours. */
        const plan = surfaceInputMirrorPlan(payload.input, {
          callerOwner: mirrorCallerOwnerRef.current,
          learnedOwner: mirrorSelfOwnerRef.current,
          history: mirrorHistoryRef.current[local.id],
          floors: mirrorForeignRef.current[local.id],
        });
        if (plan.kind === "self-echo") {
          /* One of OUR publishes echoed back — drop; a self-echo never
             carries apply text, so it cannot clobber newer local typing or
             staged attachments. Our own refs already render as LOCAL chips:
             an echo must not leave them up as stale read-only "TUI" chips.
             Legacy fallback only: learn the owner from the exact echo. */
          if (plan.learnOwner) {
            mirrorSelfOwnerRef.current = plan.learnOwner;
            mirrorHistoryRef.current[local.id]?.clear();
          }
          setMirrorAttachments((current) => (
            (current[local.id] || []).length
              ? { ...current, [local.id]: [] }
              : current
          ));
        } else if (plan.kind === "apply") {
          const floors = (mirrorForeignRef.current[local.id] ||= {});
          floors[plan.owner] = plan.revision;
          /* A remote apply IS an edit for generation purposes: a pending
             submit's success-clear must not wipe TUI-typed text that
             arrived while the submit was in flight. */
          editGenRef.current[local.id] = (editGenRef.current[local.id] || 0) + 1;
          setComposerTexts((current) => (
            (current[local.id] || "") === plan.text
              ? current
              : { ...current, [local.id]: plan.text }
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
  const activeCapabilityCwd = useMemo(() => sessionWorkingDirectory(
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

  const openSshPtyView = useCallback((sessionId, profileName) => {
    if (!sessionId || typeof profileName !== "string" || !profileName) return;
    setSshPtyProfileBySession((current) => ({
      ...current,
      [sessionId]: profileName,
    }));
    setModeFor(sessionId, "sshPty");
  }, [setModeFor]);

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

  /* Peer messaging is app-level authority (its SDK commands carry no
     session id) presented as a per-session tab. Entering the view refreshes
     the roster and this client's peer name; usePeers.js owns all invokes and
     keeps its pushed inbox alive independently of the selected session. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "peers") return;
    onLoadPeers?.();
  }, [activeSessionId, viewModes, onLoadPeers]);

  /* Shell registry (Wave5-UI-a): entering the view performs one authoritative
     per-session list. Lifecycle/output pushes remain attached in useShells;
     no registry state is inferred while this view is hidden. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "shells") return;
    onLoadShells?.(id);
  }, [activeSessionId, viewModes, onLoadShells]);

  /* SSH profile registry: a session-scoped list publishes both the public
     rows and each row's explicit in_scope fact. The returned set-scope
     receipt remains the only authority for the aggregate session scope. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "sshProfiles") return;
    onLoadSshProfiles?.(id);
  }, [activeSessionId, viewModes, onLoadSshProfiles]);

  /* Hooks and tools have independent feature gates but share one coherent
     view entry. useCapabilities.js runs the two reads independently, so a
     missing hooks_v1 never suppresses tool_inventory_v1 (or vice versa). */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "capabilities") return;
    onLoadCapabilities?.(activeCapabilityCwd, id);
  }, [activeCapabilityCwd, activeSessionId, viewModes, onLoadCapabilities]);

  /* Provider management reuses the library snapshot already consumed by the
     model picker. The provider-admin hook performs only lockdown reads and
     receives this existing authority reader for post-receipt re-listing. */
  useEffect(() => {
    const id = activeSessionId;
    if (!id || id === "draft" || (viewModes[id] || "ui") !== "providers") return;
    onLoadProviderAdmin?.(refreshLibrary);
  }, [activeSessionId, viewModes, onLoadProviderAdmin, refreshLibrary]);

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
      const prefs = composerPrefs.draft || {};
      const values = chipValuesFor(null);
      const numericMaxTokens = Number(draftCreateOptions.maxTokens);
      if (draftCreateCapabilities.native
        && (!Number.isSafeInteger(numericMaxTokens) || numericMaxTokens <= 0)) {
        setDraftError("Max output tokens must be a positive whole number.");
        return false;
      }
      const admission = {};
      if (draftCreateCapabilities.admission) {
        if (!values.modelProvider) admission.resolve_provider = true;
        if (!values.model) admission.resolve_model = true;
        if (prefs.effort && prefs.effort !== "default") admission.effort = prefs.effort;
        if (prefs.speed === "fast") admission.fast = true;
        if (prefs.account && prefs.account !== "default") admission.account_alias = prefs.account;
      } else if (draftCreateCapabilities.native
        && (!values.modelProvider || !values.model)) {
        setDraftError("Choose a published provider and model before creating this session.");
        return false;
      }
      const legacyMaterialize = () => invoke("session_start_with_prompt", {
        prompt,
        pinned_dir: null,
        attachments: attachments?.length ? attachments : null,
        config: runConfigFromPrefs(prefs),
      });
      const row = onCreateDraftSession
        ? await onCreateDraftSession({
          attachments,
          draft: {
            cwd: "",
            provider: values.modelProvider,
            model: values.model,
            maxTokens: numericMaxTokens,
          },
          legacyMaterialize,
          options: {
            maxTokens: numericMaxTokens,
            ...(draftCreateOptions.interactionMode
              ? { interactionMode: draftCreateOptions.interactionMode }
              : {}),
            ...(draftCreateCapabilities.permissionOverrides && draftCreateOptions.autoAllow
              ? { permissionOverrides: { auto_allow: true } }
              : {}),
            ...(Object.keys(admission).length ? { admission } : {}),
          },
          prompt,
        })
        : await legacyMaterialize();
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
      if (!onCreateDraftSession) {
        setDraftError("The session did not start. Check that haider is installed.");
      }
      return false;
    } catch (error) {
      setDraftError(String(error?.message || error || "Unable to start the session."));
      return false;
    } finally {
      submitBusyRef.current = false;
    }
  }, [
    composerPrefs,
    draftCreateCapabilities,
    draftCreateOptions,
    onCreateDraftSession,
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

  /* Settings (gear) menu at the end of the view toggle: the full
     agent-settings menu hosting the nine relocated SDK surfaces, the
     persona/workflow-chip row, and the Agent Types and Workflows sections
     that left the rail. The panel itself (anchored portal, position,
     Escape/outside dismissal) is the shared SessionSettingsMenu, mounted
     ONCE at the surface root and only hidden while closed so the relocated
     editors keep their state across dismissal (F2 verify P2). This surface
     tracks the menu-owning session: its gear anchors the panel and its nine
     view entries ride in as children. */
  const [settingsMenuSession, setSettingsMenuSession] = useState(null);
  const settingsMenuButtonRef = useRef(null);
  const closeSettingsMenu = useCallback(() => setSettingsMenuSession(null), []);

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

  /* The one-line header (title + Chat/Shell/Traj toggle + gear anchor + status
     pill + theme) moved to SessionView.jsx, which SessionSurface mounts per
     pane. The state/handlers those controls drive stay here and pass in as an
     explicit props contract; see the <SessionView …/> mounts below. */

  /* ONE view-dispatch authority for the toggle tabs AND the Settings menu
     entries: leave any panel tab for the chat tab, then set the session's
     view mode. (No tabs state exists for the draft, so it never re-selects.) */
  const activeChatTabFor = (sessionId) => {
    const tabsState = sessionId !== "draft" ? tabsStateFor(sessionId) : null;
    return !tabsState
      || !tabsState.tabs.some((tab) => tab.id === tabsState.activeTabId)
      || tabsState.activeTabId === "chat";
  };
  const selectViewOn = (sessionId, viewMode) => {
    if (!activeChatTabFor(sessionId)) {
      selectTab(sessionId, "chat");
    }
    setModeFor(sessionId, viewMode);
  };

  /* The Settings menu's nine relocated surface entries, built for the
     menu-owning session and passed into the shared SessionSettingsMenu as
     children. Each entry dispatches the byte-identical selectView mode its
     tab did, behind the byte-identical draft guard, and closes the menu. */
  const settingsMenuEntriesFor = (session) => {
    const activeTabIsChat = activeChatTabFor(session.id);
    const selectView = (viewMode) => selectViewOn(session.id, viewMode);
    return (
      <>
        {session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "fleet" ? "true" : undefined}
            onClick={() => {
              selectView("fleet");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Subagents"
            type="button"
          >
            <AccountTree aria-hidden="true" size={13} />
            <span>Fleet</span>
          </SettingsMenuItem>
        )}
        {session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "peers" ? "true" : undefined}
            onClick={() => {
              selectView("peers");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Peer messaging"
            type="button"
          >
            <Forum aria-hidden="true" size={13} />
            <span>Peers</span>
          </SettingsMenuItem>
        )}
        {session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "shells" ? "true" : undefined}
            onClick={() => {
              selectView("shells");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Live shell registry"
            type="button"
          >
            <TerminalGlyph aria-hidden="true" size={13} />
            <span>Shells</span>
          </SettingsMenuItem>
        )}
        {session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "capabilities" ? "true" : undefined}
            onClick={() => {
              selectView("capabilities");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Workspace hooks and session tools"
            type="button"
          >
            <Build aria-hidden="true" size={13} />
            <span>Hooks &amp; Tools</span>
          </SettingsMenuItem>
        )}
        {session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && ["sshProfiles", "sshPty"].includes(modeFor(session.id)) ? "true" : undefined}
            onClick={() => {
              selectView("sshProfiles");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="SSH Profiles"
            type="button"
          >
            <Language aria-hidden="true" size={13} />
            <span>SSH Profiles</span>
          </SettingsMenuItem>
        )}
        {session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "providers" ? "true" : undefined}
            onClick={() => {
              selectView("providers");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Provider management"
            type="button"
          >
            <Build aria-hidden="true" size={13} />
            <span>Providers</span>
          </SettingsMenuItem>
        )}
        {session && session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "monitors" ? "true" : undefined}
            onClick={() => {
              selectView("monitors");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Monitors"
            type="button"
          >
            <NotificationsActive aria-hidden="true" size={13} />
            <span>Monitors</span>
          </SettingsMenuItem>
        )}
        {session && session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "checkpoints" ? "true" : undefined}
            onClick={() => {
              selectView("checkpoints");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Checkpoint timeline"
            type="button"
          >
            <History aria-hidden="true" size={13} />
            <span>History</span>
          </SettingsMenuItem>
        )}
        {session.id !== "draft" && (
          <SettingsMenuItem
            data-active={activeTabIsChat && modeFor(session.id) === "graph" ? "true" : undefined}
            onClick={() => {
              selectView("graph");
              closeSettingsMenu();
            }}
            role="menuitem"
            title="Live workflow graph"
            type="button"
          >
            <Mediation aria-hidden="true" size={13} />
            <span>Graph</span>
          </SettingsMenuItem>
        )}
      </>
    );
  };

  /* The floating cluster (Chat/Shell/Traj toggle, panel tabs, gear anchor,
     status pill, theme) moved to SessionView.jsx. Its dispatches ride in as
     bound props from the per-pane <SessionView …/> mounts below. */

  /* The nine agent-settings surfaces the gear opens (fleet/peers/shells/ssh/
     capabilities/providers/monitors/checkpoints/graph): each a hook-backed
     presentational panel this surface owns. They mount inside the unified
     SessionView through this slot, keyed by the session's current mode exactly
     as their tabs were — so the view chrome is shared while every SDK boundary
     stays here. */
  const renderAgentSurface = (session, mode) => (
    <>
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
      {/* App-level peer roster, receipt-backed compose, and
          pushed inbox shown in this per-session tab. PeersPanel
          is presentational; usePeers.js owns the SDK boundary. */}
      {mode === "peers" && session && session.id !== "draft" && (
        <PeersHostLayer>
          <PeersPanel
            error={peerError}
            inbox={peerInbox}
            loading={peerLoading}
            onRefresh={() => onLoadPeers?.()}
            onSend={(to, message, summary) => (
              summary === undefined
                ? onSendPeerMessage?.(to, message)
                : onSendPeerMessage?.(to, message, summary)
            )}
            ownName={peerOwnName}
            peers={peerRoster}
            sending={peerSending}
            sentById={peerSentById}
            unavailable={peerUnavailable}
          />
        </PeersHostLayer>
      )}
      {/* Unified local + SSH shell registry, receipt-backed close
          and direct command execution, and connection-transient
          pushed output. ShellsPanel is presentational; every SDK
          boundary lives in useShells.js. */}
      {mode === "shells" && session && session.id !== "draft" && (
        <ShellsHostLayer>
          <ShellsPanel
            closeOutcomeByShell={shellCloseOutcomeByShell}
            closingByShell={shellClosingByShell}
            error={shellRegistryError}
            execReceipt={shellExecReceiptBySession[session.id]}
            executing={shellExecutingBySession[session.id] === true}
            loading={shellRegistryLoading}
            onClose={(shellId) => onCloseShell?.(shellId)}
            onExec={(command, cwd) => (
              cwd === undefined
                ? onExecShell?.(
                  session.id,
                  publishedCheckpointBranchId(session),
                  command,
                )
                : onExecShell?.(
                  session.id,
                  publishedCheckpointBranchId(session),
                  command,
                  cwd,
                )
            )}
            onRefresh={() => onLoadShells?.(session.id)}
            outputByShell={shellOutputByShell}
            shells={shellRegistryBySession[session.id]}
            unavailable={shellRegistryUnavailable}
          />
        </ShellsHostLayer>
      )}
      {/* Daemon-owned SSH profile CRUD, published reachability,
          and explicit session routing scope. The panel is
          presentational; useSshProfiles.js owns all dispatches. */}
      {mode === "sshProfiles" && session && session.id !== "draft" && (
        <SshProfilesHostLayer>
          <SshProfilesPanel
            adding={sshProfileAdding}
            error={sshProfileError}
            loading={sshProfileLoading}
            mutationReceipt={sshMutationReceiptBySession[session.id]}
            onAdd={(profile, clearSecrets) => (
              onAddSshProfile?.(session.id, profile, clearSecrets)
            )}
            onRefresh={() => onLoadSshProfiles?.(session.id)}
            onOpenShell={(name) => openSshPtyView(session.id, name)}
            onRemove={(name) => onRemoveSshProfile?.(session.id, name)}
            onSetScope={(scope) => onSetSessionSshScope?.(session.id, scope)}
            onTest={(name) => onTestSshProfile?.(session.id, name)}
            onUpdate={(name, changes, clearSecrets) => (
              onUpdateSshProfile?.(session.id, name, changes, clearSecrets)
            )}
            profiles={sshProfilesBySession[session.id]}
            removingByName={sshProfileRemovingByName}
            scopeReceipt={sshScopeReceiptBySession[session.id]}
            sessionId={session.id}
            settingScope={sshProfileSettingScopeBySession[session.id] === true}
            sshPtyOpening={sshPtyOpening}
            sshPtyUnavailable={sshPtyUnavailable}
            testingByName={sshProfileTestingByName}
            testsByName={sshProfileTestsBySession[session.id]}
            unavailable={sshProfileUnavailable}
            updatingByName={sshProfileUpdatingByName}
          />
        </SshProfilesHostLayer>
      )}
      {/* Interactive saved-profile PTY. The sibling terminal
          mirrors SessionTerminal's lifecycle and shared helpers;
          useSshPty owns every daemon boundary and pushed fact. */}
      {mode === "sshPty" && session && session.id !== "draft"
        && sshPtyProfileBySession[session.id] && (
        <SshPtyHostLayer>
          <SshPtyTerminal
            closedByShell={sshPtyClosedByShell}
            eofByShell={sshPtyEofByShell}
            error={sshPtyError}
            onBack={() => setModeFor(session.id, "sshProfiles")}
            onEof={onEofSshPty}
            onInput={onInputSshPty}
            onOpen={onOpenSshPty}
            onResize={onResizeSshPty}
            opening={sshPtyOpening}
            outputByShell={sshPtyOutputByShell}
            profileName={sshPtyProfileBySession[session.id]}
            stateByShell={sshPtyStateByShell}
            subscriptionId={sshPtySubscriptionId}
            unavailable={sshPtyUnavailable}
          />
        </SshPtyHostLayer>
      )}
      {/* Workspace hook trust + canonical session tools. The
          panel is presentational; useCapabilities.js owns all
          four commands and re-lists hooks after each receipt. */}
      {mode === "capabilities" && session && session.id !== "draft" && (() => {
        const capabilityCwd = sessionWorkingDirectory(session);
        return (
          <CapabilitiesHostLayer>
            <CapabilitiesPanel
              cwd={capabilityCwd}
              hookError={capabilityHookError}
              hookLoading={capabilityHookLoading}
              hookPendingByDigest={capabilityHookPendingByDigest}
              hookReceiptByDigest={capabilityHookReceiptByDigest}
              hooks={capabilityHooksByCwd[capabilityCwd]}
              hooksUnavailable={capabilityHooksUnavailable}
              onRefreshHooks={() => onLoadCapabilityHooks?.(capabilityCwd)}
              onRefreshTools={() => onLoadCapabilityTools?.(session.id)}
              onRevoke={(digest) => onRevokeHook?.(capabilityCwd, digest)}
              onTrust={(digest) => onTrustHook?.(capabilityCwd, digest)}
              toolError={capabilityToolError}
              toolLoading={capabilityToolLoading}
              tools={capabilityToolsBySession[session.id]}
              toolsUnavailable={capabilityToolsUnavailable}
            />
          </CapabilitiesHostLayer>
        );
      })()}
      {/* Provider management is distinct from provider/model
          selection. It reuses the existing library snapshot;
          useProviderAdmin.js owns the five management invokes. */}
      {mode === "providers" && session && session.id !== "draft" && (
        <ProviderAdminHostLayer>
          <ProviderAdminPanel
            configureError={providerAdminConfigureError}
            configurePending={providerAdminConfigurePending}
            configureUnavailable={providerAdminConfigureUnavailable}
            conflict={providerAdminConflict}
            globalLockdown={providerAdminGlobalLockdown}
            lastReceipt={providerAdminLastReceipt}
            lockdownByProvider={providerAdminLockdownByProvider}
            lockdownError={providerAdminLockdownError}
            lockdownLoading={providerAdminLockdownLoading}
            lockdownUnavailable={providerAdminLockdownUnavailable}
            onConfigure={(modeName, fields) => (
              onConfigureProvider?.(modeName, fields, refreshLibrary)
            )}
            onRefresh={() => onReadProviderAdmin?.(refreshLibrary)}
            onRemove={(row) => onRemoveProvider?.(row, refreshLibrary)}
            onSetQuota={(bytes) => onSetLockdownQuota?.(bytes, refreshLibrary)}
            onSetTrust={(row, trust) => (
              onSetProviderTrust?.(row, trust, refreshLibrary)
            )}
            providerAvailability={library?.provider_availability}
            providerRevision={providerAdminRevision}
            providers={providerAdminRows}
            quotaPending={providerAdminQuotaPending}
            removeError={providerAdminRemoveError}
            removePendingByProvider={providerAdminRemovePendingByProvider}
            removeUnavailable={providerAdminRemoveUnavailable}
            trustPendingByProvider={providerAdminTrustPendingByProvider}
          />
        </ProviderAdminHostLayer>
      )}
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
  );

  /* The three surface bodies (draft / home / open sessions) share ONE
     return below so the Settings menu host keeps its mount — and the
     relocated Loom/Workflow editors their state — across draft/home/session
     transitions, exactly as the always-mounted rail sections did. */
  let surfaceBody;
  if (draftOpen) {
    // Draft = the harness itself. Default view is the Chat composer —
    // selected and immediately typeable — with the plain haider TUI mounted
    // warm behind it (Shell toggle). Feature-gated daemons use the native
    // create -> attach -> first-submit path; older daemons retain the shipped
    // session_start_with_prompt materialization unchanged.
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
    surfaceBody = (
      <SessionView
        active
        session={draftSession}
        onHeaderDragStart={onHeaderDragStart}
        titleMenuFor={titleMenuFor}
        titleMenuRef={titleMenuRef}
        titleMenuButtonRef={titleMenuButtonRef}
        titleMenuPanelRef={titleMenuPanelRef}
        titleMenuPosition={titleMenuPosition}
        onToggleTitleMenu={() => setTitleMenuFor(
          (current) => (current === "draft" ? "" : "draft"),
        )}
        onCloseTitleMenu={() => setTitleMenuFor("")}
        titleRenamingId={titleRenamingId}
        titleDraft={titleDraft}
        onTitleDraftChange={setTitleDraft}
        onCommitTitleRename={commitTitleRename}
        onCancelTitleRename={() => setTitleRenamingId("")}
        onTogglePin={toggleSessionPin}
        onBeginRename={beginTitleRename}
        onCompactSession={onCompactSession}
        onForkSession={onForkSession}
        onOpenSession={onOpenSession}
        onRetrySession={onRetrySession}
        lifecyclePendingBySession={lifecyclePendingBySession}
        lifecycleErrorBySession={lifecycleErrorBySession}
        lifecycleUnavailableByAction={lifecycleUnavailableByAction}
        onPopOutSession={onPopOutSession}
        mode={draftMode}
        tabsState={null}
        onSelectView={(viewMode) => selectViewOn("draft", viewMode)}
        onSelectTab={(tabId) => selectTab("draft", tabId)}
        onCloseTab={(tabId) => closeTab("draft", tabId)}
        onAddTab={() => addTab("draft")}
        settingsMenuOpen={settingsMenuSession?.id === "draft"}
        settingsMenuButtonRef={settingsMenuButtonRef}
        onToggleSettingsMenu={() => setSettingsMenuSession(
          (current) => (current?.id === "draft" ? null : draftSession),
        )}
        surfaceStatusForSession={null}
        appThemeIsLight={appThemeIsLight}
        onToggleTheme={onToggleTheme}
        paneBody={(
          <>
            {/* Both draft views stay mounted (hidden one display:none) so
                Chat↔Shell flips are instant and the TUI stays warm. */}
            <ChatHostLayer data-visible={draftMode === "ui" ? "true" : "false"}>
              <DraftBody>
                <EmptyState>
                  <EmptyStateIcon aria-hidden="true">
                    <TerminalGlyph size={22} />
                  </EmptyStateIcon>
                  <h2>No session yet.</h2>
                  <p>Send a message below — the Haider harness creates the session on your first message. Nothing runs until then.</p>
                  {draftError && <DraftError>{draftError}</DraftError>}
                  {draftCreateStatus?.message && (
                    <DraftError
                      data-state={draftCreateStatus.phase}
                      role={draftCreateStatus.phase === "rejected" ? "alert" : "status"}
                    >
                      {draftCreateStatus.message}
                    </DraftError>
                  )}
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
                createCapabilities={draftCreateCapabilities}
                createOptions={draftCreateCapabilities.native ? draftCreateOptions : null}
                onAttachmentsChange={(next) => handleAttachmentsChange({ id: "draft" }, next)}
                onChipChange={(key, option) => handleChipChange("draft", key, option)}
                onChipMenuOpen={() => { void refreshLibrary(); }}
                onCreateOptionChange={(key, value) => setDraftCreateOptions((current) => ({
                  ...current,
                  [key]: value,
                }))}
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
          </>
        )}
      />
    );
  } else if (!activeSessionId) {
    // Home: the flame hero with the plan tiers, plus recent sessions to
    // continue — including ones created directly in the haider CLI once the
    // bridge imports them.
    // Max 3 recents, like the CLI's own launcher list.
    const recentSessions = sessions.slice(0, 3);
    surfaceBody = (
      <SessionView
        active
        session={null}
        showToggle={false}
        onHeaderDragStart={onHeaderDragStart}
        appThemeIsLight={appThemeIsLight}
        onToggleTheme={onToggleTheme}
        paneBody={(
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
        )}
      />
    );
  } else {
    const sessionPanes = openSessions.map((session) => {
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
          <SessionView
            active={active}
            key={session.id}
            session={session}
            onHeaderDragStart={onHeaderDragStart}
            titleMenuFor={titleMenuFor}
            titleMenuRef={titleMenuRef}
            titleMenuButtonRef={titleMenuButtonRef}
            titleMenuPanelRef={titleMenuPanelRef}
            titleMenuPosition={titleMenuPosition}
            onToggleTitleMenu={() => setTitleMenuFor(
              (current) => (current === session.id ? "" : session.id),
            )}
            onCloseTitleMenu={() => setTitleMenuFor("")}
            titleRenamingId={titleRenamingId}
            titleDraft={titleDraft}
            onTitleDraftChange={setTitleDraft}
            onCommitTitleRename={commitTitleRename}
            onCancelTitleRename={() => setTitleRenamingId("")}
            onTogglePin={toggleSessionPin}
            onBeginRename={beginTitleRename}
            onCompactSession={onCompactSession}
            onForkSession={onForkSession}
            onOpenSession={onOpenSession}
            onRetrySession={onRetrySession}
            lifecyclePendingBySession={lifecyclePendingBySession}
            lifecycleErrorBySession={lifecycleErrorBySession}
            lifecycleUnavailableByAction={lifecycleUnavailableByAction}
            onPopOutSession={onPopOutSession}
            mode={mode}
            tabsState={tabsStateFor(session.id)}
            onSelectView={(viewMode) => selectViewOn(session.id, viewMode)}
            onSelectTab={(tabId) => selectTab(session.id, tabId)}
            onCloseTab={(tabId) => closeTab(session.id, tabId)}
            onAddTab={() => addTab(session.id)}
            settingsMenuOpen={settingsMenuSession?.id === session.id}
            settingsMenuButtonRef={settingsMenuButtonRef}
            onToggleSettingsMenu={() => setSettingsMenuSession(
              (current) => (current?.id === session.id ? null : session),
            )}
            surfaceStatusForSession={surfaceStatus[session.id] || null}
            appThemeIsLight={appThemeIsLight}
            onToggleTheme={onToggleTheme}
            chatTabActive={chatTabActive}
            runStatusView={runStatusView}
            onSessionsRefresh={onSessionsRefresh}
            onTranscriptSyncing={(syncing) => handleTranscriptSyncing(session.id, syncing)}
            queueState={queueState}
            queueActionBusy={queueActionBusy}
            queueActionError={queueActionError}
            submissionConfirmation={submissionConfirmations[session.id] || null}
            onPromoteSteer={(id) => { void mutateQueuedRow("promoteSteer", id); }}
            onQueueRefresh={() => setQueueRefreshGeneration((value) => value + 1)}
            onQueueRemove={(id) => { void mutateQueuedRow("remove", id); }}
            composerChipCapabilities={library?.capabilities || {}}
            composerChipOptions={chipOptionsFor(session)}
            composerChipValues={chipValuesFor(session)}
            composerCommandMenuRequest={commandMenuRequests[session.id] || null}
            composerCommandNotice={commandResults[session.id] || null}
            composerDeliveryMode={composerDeliveryModes[session.id] || "queue"}
            onChipChange={(key, option) => handleChipChange(session.id, key, option)}
            onChipMenuOpen={() => {
              void refreshLibrary();
              refreshConfig(session.id);
            }}
            composerAttachments={composerAttachments[session.id] || []}
            composerHoldNotice={submitHold[session.id] || ""}
            onCancelTurn={cancelTurnFor(session)}
            composerMirrorAttachments={mirrorAttachments[session.id] || []}
            onAttachmentsChange={(next) => handleAttachmentsChange(session, next)}
            onMirrorType={(text) => publishMirror(session, text)}
            rpcFeatures={rpcFeatures}
            onSetDeliveryMode={(deliveryMode) => setComposerDeliveryModes((current) => ({
              ...current,
              [session.id]: normalizeDeliveryMode(deliveryMode),
            }))}
            onSubmit={(prompt, attachments, deliveryMode) => (
              submitIntoSession(session, prompt, attachments, deliveryMode)
            )}
            onPastedBlocksChange={(blocks) => setComposerPastesFor(session.id, blocks)}
            onValueChange={(text) => setComposerText(session.id, text)}
            composerPastedBlocks={composerPastes[session.id] || []}
            composerSlashCommands={commandDoorAvailable ? slashCommands : []}
            composerValue={composerTexts[session.id] || ""}
            shellPref={shellPrefs[session.id]}
            shellTouched={shellTouched[session.id]}
            bindingAuthority={sessionBinding.authority}
            onTuiAttached={handleLegacyTuiAttached}
            paneIdOverride={paneOverrides[session.id]}
            onSetTabPanel={(tabId, kind) => setTabPanel(session.id, tabId, kind)}
            renderAgentSurface={renderAgentSurface}
          />
        );
      });
    surfaceBody = <>{sessionPanes}</>;
  }

  return (
    <SessionSurfaceRoot>
      {surfaceBody}
      {/* ONE always-mounted Settings menu instance for the whole surface
          (portal chrome and mount discipline live in SessionSettingsMenu):
          dismissal only hides it, so the relocated Agent Types / Workflows
          editors keep their drafts, filters, and conflict state. The nine
          session-view entries ride in as children for the menu-owning
          session; persona + workflow chip render from the same session. */}
      <SessionSettingsMenu
        activeSessionId={activeSessionId}
        anchorRef={settingsMenuButtonRef}
        loomAgentTypes={loomAgentTypes}
        loomPersonaBySession={loomPersonaBySession}
        onSelectPersona={onSelectPersona}
        loomWorkflowEntries={loomWorkflowEntries}
        loomArchivedEntries={loomArchivedEntries}
        loomCliPresent={loomCliPresent}
        loomInstallByType={loomInstallByType}
        loomCancelByJob={loomCancelByJob}
        loomRegistryCursor={loomRegistryCursor}
        loomListError={loomListError}
        loomUnavailable={loomUnavailable}
        loomFeatureUnavailable={loomFeatureUnavailable}
        loomFeatureErrors={loomFeatureErrors}
        loomAuthoringConflict={loomAuthoringConflict}
        onRegisterAgentType={onRegisterAgentType}
        onRefreshLoomRegistry={onRefreshLoomRegistry}
        onListArchivedLoom={onListArchivedLoom}
        onValidateLoom={onValidateLoom}
        onDraftLoom={onDraftLoom}
        onReviseLoom={onReviseLoom}
        onConfirmLoom={onConfirmLoom}
        onSetLoomArchived={onSetLoomArchived}
        onRefreshAgentInstall={onRefreshAgentInstall}
        onRetryAgentInstall={onRetryAgentInstall}
        onCancelAgentInstall={onCancelAgentInstall}
        workflowCatalog={workflowCatalog}
        workflowRecords={workflowRecords}
        workflowInstanceById={workflowInstanceById}
        workflowListError={workflowListError}
        onReadWorkflowInstance={onReadWorkflowInstance}
        onRegisterWorkflow={onRegisterWorkflow}
        onPinWorkflow={onPinWorkflow}
        onSwitchWorkflow={onSwitchWorkflow}
        onAbandonWorkflow={onAbandonWorkflow}
        workflowStatusBySession={workflowStatusBySession}
        workflowUnavailable={workflowUnavailable}
        onDismiss={closeSettingsMenu}
        open={Boolean(settingsMenuSession)}
        session={settingsMenuSession}
      >
        {settingsMenuSession ? settingsMenuEntriesFor(settingsMenuSession) : null}
      </SessionSettingsMenu>
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

/* Per-session host for the app-level peer messaging surface. */
const PeersHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* Shell registry host: ShellsPanel owns its vertical scroll. */
const ShellsHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* SSH profile manager host: SshProfilesPanel owns its vertical scroll. */
const SshProfilesHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* Interactive SSH terminal host: SshPtyTerminal owns the measured xterm box. */
const SshPtyHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* Workspace capability manager host: CapabilitiesPanel owns its scroll. */
const CapabilitiesHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

/* Provider administration host: ProviderAdminPanel owns its scroll. */
const ProviderAdminHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
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

const DraftError = styled.div`
  margin-top: 12px;
  color: var(--forge-red);
  font-size: 12px;
`;
