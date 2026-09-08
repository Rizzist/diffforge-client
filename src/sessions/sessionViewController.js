import { surfaceRunStatusView } from "./sessionStatus.js";

/* F9 Phase 2 — the shared session-view controller.

   `SessionView` is the ONE presentational session view (F9 Phase 1). Every host
   that mounts it must hand it the same explicit prop bundle. This module is the
   single place that bundle is assembled, so the standalone surface and a space
   leaf (and, later, the popout) feed SessionView from one source instead of
   three hand-wired copies drifting apart.

   It is a PURE builder, not a React hook: each host already owns its own
   per-session state (SessionSurface in its state maps, SpaceSurface in its
   drafts/pastes/attachments maps), so the controller only maps those resolved
   values onto SessionView's contract with honest defaults for anything a host
   does not have. Naming it `use*` would be misleading (it holds no hook state)
   and would trip the rules-of-hooks lint when a host calls it inside a leaf
   loop, which SpaceSurface does. */

/* SessionView's `mode` vocabulary vs. the spaces model's leaf `viewKind`
   vocabulary. Chat is the "ui" mode; shell is the "terminal" mode. */
export const SESSION_VIEW_MODE_BY_VIEW_KIND = {
  chat: "ui",
  shell: "terminal",
  trajectory: "trajectory",
};

export const SPACE_LEAF_VIEW_KIND_BY_MODE = {
  ui: "chat",
  terminal: "shell",
  trajectory: "trajectory",
};

export function sessionViewModeForViewKind(viewKind) {
  return SESSION_VIEW_MODE_BY_VIEW_KIND[viewKind] || "ui";
}

export function spaceLeafViewKindForMode(mode) {
  return SPACE_LEAF_VIEW_KIND_BY_MODE[mode] || "chat";
}

/* Assemble the SessionView prop bundle for one session pane.

   `ctx` carries whatever the host has resolved; every field falls back to an
   honest default so a lean host (a space leaf) can supply only the values it
   truly owns. The result is the complete, explicit contract SessionView reads —
   the caller only adds React `key` on the element. */
export function buildSessionViewProps(session, ctx = {}) {
  const mode = ctx.mode || "ui";
  return {
    // pane + header framing
    session,
    active: ctx.active ?? true,
    /* Standalone leaves the header on (default); a space leaf turns it off so
       the space's own header stays the single identity/toggle/gear driver. */
    showHeader: ctx.showHeader ?? true,
    showToggle: ctx.showToggle ?? true,
    paneBody: ctx.paneBody ?? null,
    onHeaderDragStart: ctx.onHeaderDragStart ?? null,

    // title block + lifecycle menu
    titleMenuFor: ctx.titleMenuFor ?? "",
    titleMenuRef: ctx.titleMenuRef ?? null,
    titleMenuButtonRef: ctx.titleMenuButtonRef ?? null,
    titleMenuPanelRef: ctx.titleMenuPanelRef ?? null,
    titleMenuPosition: ctx.titleMenuPosition ?? null,
    onToggleTitleMenu: ctx.onToggleTitleMenu ?? null,
    onCloseTitleMenu: ctx.onCloseTitleMenu ?? null,
    titleRenamingId: ctx.titleRenamingId ?? "",
    titleDraft: ctx.titleDraft ?? "",
    onTitleDraftChange: ctx.onTitleDraftChange ?? null,
    onCommitTitleRename: ctx.onCommitTitleRename ?? null,
    onCancelTitleRename: ctx.onCancelTitleRename ?? null,
    onTogglePin: ctx.onTogglePin ?? null,
    onBeginRename: ctx.onBeginRename ?? null,
    onCompactSession: ctx.onCompactSession ?? null,
    onForkSession: ctx.onForkSession ?? null,
    onOpenSession: ctx.onOpenSession ?? null,
    onRetrySession: ctx.onRetrySession ?? null,
    lifecyclePendingBySession: ctx.lifecyclePendingBySession ?? {},
    lifecycleErrorBySession: ctx.lifecycleErrorBySession ?? {},
    lifecycleUnavailableByAction: ctx.lifecycleUnavailableByAction ?? {},
    onPopOutSession: ctx.onPopOutSession ?? null,

    // view toggle + gear anchor
    mode,
    tabsState: ctx.tabsState ?? null,
    onSelectView: ctx.onSelectView ?? null,
    onSelectTab: ctx.onSelectTab ?? null,
    onCloseTab: ctx.onCloseTab ?? null,
    onAddTab: ctx.onAddTab ?? null,
    settingsMenuOpen: ctx.settingsMenuOpen ?? false,
    settingsMenuButtonRef: ctx.settingsMenuButtonRef ?? null,
    onToggleSettingsMenu: ctx.onToggleSettingsMenu ?? null,
    surfaceStatusForSession: ctx.surfaceStatusForSession ?? null,
    appThemeIsLight: ctx.appThemeIsLight ?? false,
    onToggleTheme: ctx.onToggleTheme ?? null,

    // session body
    chatTabActive: ctx.chatTabActive ?? true,
    runStatusView: ctx.runStatusView ?? surfaceRunStatusView(null, session, false, false),
    onSessionsRefresh: ctx.onSessionsRefresh ?? null,
    onTranscriptSyncing: ctx.onTranscriptSyncing ?? null,
    queueState: ctx.queueState ?? null,
    queueActionBusy: ctx.queueActionBusy ?? "",
    queueActionError: ctx.queueActionError ?? "",
    submissionConfirmation: ctx.submissionConfirmation ?? null,
    onPromoteSteer: ctx.onPromoteSteer ?? null,
    onQueueRefresh: ctx.onQueueRefresh ?? null,
    onQueueRemove: ctx.onQueueRemove ?? null,

    // composer. chipOptions/chipValues MUST be objects, never null: the real
    // SessionComposer dereferences them during render (e.g. chipOptions[key],
    // chipOptions.speedApplicable, chipValues.model), and a JS default parameter
    // does not fill an explicit null. An empty object is the honest "no chip
    // state yet" — a lean host (a space leaf) renders the composer without
    // fabricating options, and without crashing.
    composerChipCapabilities: ctx.composerChipCapabilities ?? {},
    composerChipOptions: ctx.composerChipOptions ?? {},
    composerChipValues: ctx.composerChipValues ?? {},
    composerCommandMenuRequest: ctx.composerCommandMenuRequest ?? null,
    composerCommandNotice: ctx.composerCommandNotice ?? null,
    composerDeliveryMode: ctx.composerDeliveryMode ?? "queue",
    onChipChange: ctx.onChipChange ?? null,
    onChipMenuOpen: ctx.onChipMenuOpen ?? null,
    composerAttachments: ctx.composerAttachments ?? [],
    composerHoldNotice: ctx.composerHoldNotice ?? "",
    onCancelTurn: ctx.onCancelTurn ?? null,
    composerMirrorAttachments: ctx.composerMirrorAttachments ?? [],
    onAttachmentsChange: ctx.onAttachmentsChange ?? null,
    onMirrorType: ctx.onMirrorType ?? null,
    rpcFeatures: ctx.rpcFeatures ?? [],
    onSetDeliveryMode: ctx.onSetDeliveryMode ?? null,
    onSubmit: ctx.onSubmit ?? null,
    onPastedBlocksChange: ctx.onPastedBlocksChange ?? null,
    onValueChange: ctx.onValueChange ?? null,
    composerPastedBlocks: ctx.composerPastedBlocks ?? [],
    composerSlashCommands: ctx.composerSlashCommands ?? [],
    composerValue: ctx.composerValue ?? "",

    // terminal (keep-warm gating). A space leaf showing shell is viewing the
    // terminal (mode "terminal", active), so SessionView mounts the real
    // SessionTerminal regardless of these keep-warm hints.
    shellPref: ctx.shellPref,
    shellTouched: ctx.shellTouched ?? false,
    bindingAuthority: ctx.bindingAuthority ?? null,
    onTuiAttached: ctx.onTuiAttached ?? null,
    paneIdOverride: ctx.paneIdOverride,

    // panel picker + agent-settings surfaces slot
    onSetTabPanel: ctx.onSetTabPanel ?? null,
    renderAgentSurface: ctx.renderAgentSurface ?? null,
  };
}

/* The space-leaf context for buildSessionViewProps. A live leaf owns its
   composer state (typed text, paste blocks, staged attachments) in the space
   surface's per-session maps and its view from the leaf's own `viewKind`; every
   other SessionView input is a host-level facility a space does not carry, so it
   rides in as an honest default (no fake queue, status, or lifecycle). The shell
   here mounts the real SessionTerminal bound to this session's own pane
   (sessionPaneId(session.id)); standalone is never co-mounted with a space, so a
   leaf shell cannot steal the standalone shell's binding. */
export function buildSpaceLeafSessionViewProps(session, leaf, ctx = {}) {
  return buildSessionViewProps(session, {
    active: true,
    showHeader: false,
    chatTabActive: true,
    mode: sessionViewModeForViewKind(leaf.viewKind),
    tabsState: null,
    /* A space leaf runs no queue-control surface, so it declares the queue
       honestly unsupported (renders no panel) rather than leaving it null,
       which the queue view model reads as "unknown" and would surface a phantom
       "queue state unknown" panel on every space chat leaf. */
    queueState: { kind: "unsupported" },
    onSelectView: ctx.onSetLeafView
      ? (viewMode) => ctx.onSetLeafView(leaf.id, spaceLeafViewKindForMode(viewMode))
      : null,
    // composer — the only stateful surface a space leaf owns
    composerValue: ctx.composerValue ?? "",
    onValueChange: ctx.onValueChange ?? null,
    composerPastedBlocks: ctx.composerPastedBlocks ?? [],
    onPastedBlocksChange: ctx.onPastedBlocksChange ?? null,
    composerAttachments: ctx.composerAttachments ?? [],
    onAttachmentsChange: ctx.onAttachmentsChange ?? null,
    onSubmit: ctx.onSubmit ?? null,
  });
}
