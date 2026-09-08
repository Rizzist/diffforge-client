import { createPortal } from "react-dom";
import styled from "styled-components";
import { Forum } from "@styled-icons/material-rounded/Forum";
import { History } from "@styled-icons/material-rounded/History";
import { Language } from "@styled-icons/material-rounded/Language";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { MoreHoriz } from "@styled-icons/material-rounded/MoreHoriz";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { Terminal as TerminalGlyph } from "@styled-icons/material-rounded/Terminal";
import { Timeline } from "@styled-icons/material-rounded/Timeline";

import {
  ButtonDarkModeIcon,
  ButtonLightModeIcon,
  ButtonCloseIcon,
  ButtonAddIcon,
} from "../app/appStyles.js";
import SessionComposer from "./SessionComposer.jsx";
import { SurfaceStatusPill } from "./SurfaceStatusPill.jsx";
import { sessionAvailabilityPresentation } from "./sessionAvailability.js";
import { surfaceStatusPillView } from "./sessionStatus.js";
import SessionTerminal from "./SessionTerminal.jsx";
import SessionTrajectory from "./SessionTrajectory.jsx";
import SessionTranscript from "./SessionTranscript.jsx";
import SessionQueuePanel from "./SessionQueuePanel.jsx";
import SessionLifecycleMenuItems from "./SessionLifecycleMenuItems.jsx";
import {
  SessionViewButton,
  SessionViewToggle,
} from "./SessionSettingsMenu.jsx";
import { sessionComposerDeliveryModeProps } from "./queueViewModel.js";

/* F9 Phase 1 — the ONE session view.

   The end goal of F9 is a single session-view component rendered identically in
   three hosts: the standalone SessionSurface, a space leaf (SpaceSurface), and a
   popout window (SessionWindowHost). This is the foundation: SessionView owns
   the one-line header (title + Chat/Shell/Traj toggle + gear Settings anchor +
   the model/effort/permission selectors that ride the composer), the active
   view's real content (SessionTranscript / SessionTerminal PTY /
   SessionTrajectory via the mode), and the composer.

   SessionSurface remains the owner of all state, hooks, listeners, and
   availability. It computes each session's inputs and passes them here as an
   explicit props contract; SessionView renders the real view. Two things stay
   with the host by construction and ride in as slots: the always-mounted
   Settings menu PANEL (mounted once at the surface root so its Loom/Workflow
   editors keep their drafts across dismissal — the gear button here just
   anchors and toggles it), and the nine agent-settings surfaces the gear opens
   (`renderAgentSurface`, each already a hook-backed presentational panel). The
   draft launcher and the home hero pass their own body as `paneBody`.

   `active` drives the exact `data-active` visibility the inline pane used, so
   the standalone surface is byte-identical to before this extraction. */
export default function SessionView({
  // pane
  active = true,
  paneBody = null,
  // header identity + drag region
  session,
  showToggle = true,
  onHeaderDragStart = null,
  // title block
  titleMenuFor = "",
  titleMenuRef = null,
  titleMenuButtonRef = null,
  titleMenuPanelRef = null,
  titleMenuPosition = null,
  onToggleTitleMenu = null,
  onCloseTitleMenu = null,
  titleRenamingId = "",
  titleDraft = "",
  onTitleDraftChange = null,
  onCommitTitleRename = null,
  onCancelTitleRename = null,
  onTogglePin = null,
  onBeginRename = null,
  onCompactSession = null,
  onForkSession = null,
  onOpenSession = null,
  onRetrySession = null,
  lifecyclePendingBySession = {},
  lifecycleErrorBySession = {},
  lifecycleUnavailableByAction = {},
  onPopOutSession = null,
  // view toggle + gear anchor
  mode = "ui",
  tabsState = null,
  onSelectView = null,
  onSelectTab = null,
  onCloseTab = null,
  onAddTab = null,
  settingsMenuOpen = false,
  settingsMenuButtonRef = null,
  onToggleSettingsMenu = null,
  surfaceStatusForSession = null,
  appThemeIsLight = false,
  onToggleTheme = null,
  // session body
  chatTabActive = true,
  runStatusView = null,
  onSessionsRefresh = null,
  onTranscriptSyncing = null,
  queueState = null,
  queueActionBusy = "",
  queueActionError = "",
  submissionConfirmation = null,
  onPromoteSteer = null,
  onQueueRefresh = null,
  onQueueRemove = null,
  // composer
  composerChipCapabilities = {},
  composerChipOptions = null,
  composerChipValues = null,
  composerCommandMenuRequest = null,
  composerCommandNotice = null,
  composerDeliveryMode = "queue",
  onChipChange = null,
  onChipMenuOpen = null,
  composerAttachments = [],
  composerHoldNotice = "",
  onCancelTurn = null,
  composerMirrorAttachments = [],
  onAttachmentsChange = null,
  onMirrorType = null,
  rpcFeatures = [],
  onSetDeliveryMode = null,
  onSubmit = null,
  onPastedBlocksChange = null,
  onValueChange = null,
  composerPastedBlocks = [],
  composerSlashCommands = [],
  composerValue = "",
  // terminal (keep-warm gating)
  shellPref = undefined,
  shellTouched = false,
  bindingAuthority = null,
  onTuiAttached = null,
  paneIdOverride = undefined,
  // panel picker
  onSetTabPanel = null,
  // agent-settings surfaces slot (fleet/peers/shells/ssh/capabilities/
  // providers/monitors/checkpoints/graph)
  renderAgentSurface = null,
}) {
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

  const renderTitleBlock = (titleSession) => {
    const lifecycleNotice = lifecycleNoticeFor(titleSession.id);
    return (
      <TitleRow>
        {titleRenamingId === titleSession.id ? (
          <TitleRenameInput
            aria-label="Rename session"
            autoFocus
            onBlur={() => void onCommitTitleRename?.()}
            onChange={(event) => onTitleDraftChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onCommitTitleRename?.();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancelTitleRename?.();
              }
            }}
            value={titleDraft}
          />
        ) : (
          <h1 title={titleSession.title}>{titleSession.title}</h1>
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
        <TitleMenuWrap ref={titleMenuFor === titleSession.id ? titleMenuRef : undefined}>
          <HeaderIconButton
            ref={titleMenuFor === titleSession.id ? titleMenuButtonRef : undefined}
            aria-expanded={titleMenuFor === titleSession.id}
            aria-haspopup="menu"
            aria-label="Session menu"
            onClick={() => onToggleTitleMenu?.(titleSession)}
            title="Session options"
            type="button"
          >
            <MoreHoriz aria-hidden="true" size={15} />
          </HeaderIconButton>
          {titleMenuFor === titleSession.id && createPortal(
            <TitleMenu
              $left={titleMenuPosition?.left}
              $positioned={Boolean(titleMenuPosition)}
              $top={titleMenuPosition?.top}
              ref={titleMenuPanelRef}
              role="menu"
            >
              <TitleMenuItem
                onClick={() => void onTogglePin?.(titleSession)}
                role="menuitem"
                type="button"
              >
                <PushPin aria-hidden="true" />
                <span>{titleSession.pinned ? "Unpin" : "Pin"}</span>
              </TitleMenuItem>
              {titleSession.id !== "draft" && (
                <SessionLifecycleMenuItems
                  errorBySession={lifecycleErrorBySession}
                  onBeginRename={onBeginRename}
                  onCompact={onCompactSession}
                  onDismiss={() => onCloseTitleMenu?.()}
                  onFork={onForkSession}
                  onForked={(receipt) => onOpenSession?.({ id: receipt.sessionId })}
                  onRetry={onRetrySession}
                  pendingBySession={lifecyclePendingBySession}
                  session={titleSession}
                  unavailableByAction={lifecycleUnavailableByAction}
                />
              )}
            </TitleMenu>,
            document.body,
          )}
        </TitleMenuWrap>
        {titleSession.id !== "draft" && onPopOutSession && (
          <HeaderIconButton
            aria-label="Pop out session"
            onClick={() => onPopOutSession(titleSession)}
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
  const floatingControls = () => {
    const panelTabs = tabsState ? tabsState.tabs.filter((tab) => tab.kind !== "chat") : [];
    const activeTabIsChat = !tabsState
      || !tabsState.tabs.some((tab) => tab.id === tabsState.activeTabId)
      || tabsState.activeTabId === "chat";
    const selectView = onSelectView;
    /* With only Chat/Shell/Traj left as tabs, the gear carries the active
       state whenever the current view is one of the relocated
       agent-settings surfaces, so the user can still see where they are. */
    const settingsViewActive = Boolean(session)
      && activeTabIsChat
      && SETTINGS_MENU_MODES.includes(mode);
    /* status_segment_structured_v1: only state/detail can carry structured
       authority. The raw line/local bucket remain useful presentation, with
       provenance beside the rendered label instead of masquerading as it. */
    const availability = session && session.id !== "draft"
      ? sessionAvailabilityPresentation(session)
      : null;
    const statusPillView = session && session.id !== "draft"
      ? surfaceStatusPillView(surfaceStatusForSession, session, availability)
      : null;
    const statusLine = statusPillView?.label || "";
    return (
      <FloatingControls>
        {showToggle && session && (
        <SessionViewToggle aria-label="Session view" role="tablist">
          <SessionViewButton
            aria-selected={activeTabIsChat && mode === "ui"}
            data-active={activeTabIsChat && mode === "ui" ? "true" : undefined}
            onClick={() => selectView("ui")}
            role="tab"
            type="button"
          >
            <Forum aria-hidden="true" size={13} />
            <span>Chat</span>
          </SessionViewButton>
          <SessionViewButton
            aria-selected={activeTabIsChat && mode === "terminal"}
            data-active={activeTabIsChat && mode === "terminal" ? "true" : undefined}
            onClick={() => selectView("terminal")}
            role="tab"
            type="button"
          >
            <TerminalGlyph aria-hidden="true" size={13} />
            <span>Shell</span>
          </SessionViewButton>
          {session.id !== "draft" && (
            <SessionViewButton
              aria-selected={activeTabIsChat && mode === "trajectory"}
              data-active={activeTabIsChat && mode === "trajectory" ? "true" : undefined}
              onClick={() => selectView("trajectory")}
              role="tab"
              title="Trajectory"
              type="button"
            >
              <Timeline aria-hidden="true" size={13} />
              <span>Traj</span>
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
                onClick={() => onSelectTab(tab.id)}
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
                    onCloseTab(tab.id);
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
              onClick={() => onAddTab()}
              title="New panel"
              type="button"
            >
              <ButtonAddIcon aria-hidden="true" />
            </SegAddButton>
          )}
          {/* Settings (gear): anchors the shared agent-settings menu (mounted
              once at the surface root). Every relocated surface entry
              dispatches the exact same selectView mode its tab did, behind
              the same draft guard it had. */}
          <SessionViewButton
            ref={settingsMenuOpen ? settingsMenuButtonRef : undefined}
            aria-expanded={settingsMenuOpen}
            aria-haspopup="menu"
            aria-label="Agent settings"
            data-active={settingsViewActive ? "true" : undefined}
            onClick={() => onToggleSettingsMenu?.(session)}
            title="Agent settings"
            type="button"
          >
            <Settings aria-hidden="true" size={13} />
          </SessionViewButton>
        </SessionViewToggle>
        )}
        {session && session.id !== "draft" && (
          <SurfaceStatusPill
            availability={availability}
            session={session}
            statusLine={statusLine}
            statusPillView={statusPillView}
          />
        )}
        {/* F2.1: the persona binding control and the display-only workflow
            chip left this row for the Settings menu — the header is ONE
            line: name … view toggle … status pill. */}
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

  /* ONE header row for every tab: small title + its menu on the left, the
     view cluster (segmented, status pill, theme) on the right; wraps to a
     second line only when the pane is too narrow. */
  const workHeader = (
    /* The header doubles as a window-drag region (AppShell's titlebar
       handler: interactive elements opt out, double-click zooms). */
    <WorkHeader onMouseDown={onHeaderDragStart || undefined}>
      {session ? renderTitleBlock(session) : <span />}
      <WorkHeaderSpacer aria-hidden="true" />
      {floatingControls()}
    </WorkHeader>
  );

  let paneContent;
  if (paneBody != null) {
    // Draft launcher / home hero: the host builds its own body.
    paneContent = paneBody;
  } else {
    const activeTab = tabsState
      ? (tabsState.tabs.find((tab) => tab.id === tabsState.activeTabId) || tabsState.tabs[0])
      : { id: "chat", kind: "chat" };
    paneContent = (
      <>
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
                onSyncingChange={onTranscriptSyncing}
                runStatus={runStatusView.label}
                session={session}
              />
              <SessionQueuePanel
                actionBusy={queueActionBusy}
                actionError={queueActionError}
                confirmation={submissionConfirmation}
                onPromoteSteer={onPromoteSteer}
                onRefresh={onQueueRefresh}
                onRemove={onQueueRemove}
                state={queueState}
              />
              <SessionComposer
                chipCapabilities={composerChipCapabilities}
                chipOptions={composerChipOptions}
                chipValues={composerChipValues}
                commandMenuRequest={composerCommandMenuRequest}
                commandNotice={composerCommandNotice}
                deliveryMode={composerDeliveryMode}
                onChipChange={onChipChange}
                onChipMenuOpen={onChipMenuOpen}
                attachments={composerAttachments}
                holdNotice={composerHoldNotice}
                onCancelTurn={onCancelTurn}
                mirrorAttachments={composerMirrorAttachments}
                onAttachmentsChange={onAttachmentsChange}
                onMirrorType={onMirrorType}
                {...sessionComposerDeliveryModeProps(rpcFeatures, onSetDeliveryMode)}
                onSubmit={onSubmit}
                onPastedBlocksChange={onPastedBlocksChange}
                onValueChange={onValueChange}
                pastedBlocks={composerPastedBlocks}
                slashCommands={composerSlashCommands}
                value={composerValue}
              />
            </ChatHostLayer>
            {mode === "trajectory" && (
              <TrajectoryHostLayer>
                <SessionTrajectory session={session} />
              </TrajectoryHostLayer>
            )}
            {/* The nine agent-settings surfaces (fleet/peers/shells/ssh/
                capabilities/providers/monitors/checkpoints/graph) the gear
                opens: each a hook-backed presentational panel the host owns,
                mounted here through the same mode gate they always had. */}
            {renderAgentSurface?.(session, mode)}
          </>
        )}
        {/* Three honest reasons to mount: you are looking at it; it is
            kept warm (stays mounted while you work elsewhere, so
            switching back skips xterm re-instantiation + replay); or
            it is pre-warming for an open session. Turning it OFF from
            the rail suppresses the last two, so off means off. */}
        {(() => {
          const pref = shellPref;
          const viewing = chatTabActive && active && mode === "terminal";
          const preWarm = chatTabActive && active
            && shellTouched && pref !== false;
          return viewing || preWarm || pref === true;
        })() && (
          <TerminalHostLayer
            data-visible={chatTabActive && active && mode === "terminal" ? "true" : "false"}
          >
            <SessionTerminal
              active={chatTabActive && active && mode === "terminal"}
              bindingAuthority={bindingAuthority}
              onTuiAttached={onTuiAttached}
              paneIdOverride={paneIdOverride}
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
                  onClick={() => onSetTabPanel(activeTab.id, kind)}
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
      </>
    );
  }

  return (
    <SessionPane data-active={active ? "true" : "false"}>
      {workHeader}
      <PaneContent>{paneContent}</PaneContent>
    </SessionPane>
  );
}

const PANEL_KINDS = {
  web: { label: "Web", Icon: Language },
  pcb: { label: "PCB Design", Icon: Memory },
  video: { label: "AI Video Editor", Icon: Movie },
};

/* View modes hosted by the Settings (gear) menu instead of the tab bar
   (F2-UI): every SDK-backed agent-settings surface. The gear shows the
   active state whenever one of these is the session's current view;
   "sshPty" rides the SSH Profiles entry exactly as it rode its tab. */
const SETTINGS_MENU_MODES = [
  "fleet",
  "peers",
  "shells",
  "capabilities",
  "sshProfiles",
  "sshPty",
  "providers",
  "monitors",
  "checkpoints",
  "graph",
];

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
  flex-wrap: nowrap;
  gap: 8px;
`;

/* ONE row of workspace chrome, on every tab: title + menu left, cluster
   right. Normal flow — content starts below it, no overlay clearances.
   F2.1: a SINGLE line — nothing wraps; a long session name ellipsizes in
   the title block instead. */
const WorkHeader = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: nowrap;
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
  flex-shrink: 1;
  overflow: hidden;
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
export const TerminalHostLayer = styled.div`
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

export const ChatHostLayer = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;

  &[data-visible="false"] {
    display: none;
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

export const EmptyState = styled.div`
  display: flex;
  max-width: 480px;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  text-align: center;

  h2 {
    margin: 20px 0 10px;
    color: var(--forge-text);
    font-size: 20px;
    font-weight: 700;
  }

  p {
    max-width: 42ch;
    margin: 0;
    color: var(--forge-text-muted);
    font-size: 12.5px;
    line-height: 1.65;
  }
`;

export const EmptyStateIcon = styled.span`
  display: inline-grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.4);
  border-radius: 14px;
  color: var(--forge-accent-soft);
  background: rgba(var(--forge-tint-rgb), 0.12);
`;
