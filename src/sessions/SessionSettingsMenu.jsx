import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

import LoomRailSection from "./LoomRailSection.jsx";
import WorkflowRailSection from "./WorkflowRailSection.jsx";
import SessionPersonaSelect from "./SessionPersonaSelect.jsx";
import WorkflowStatusChip from "./WorkflowStatusChip.jsx";
import { viewportMenuPosition } from "./viewportMenuPosition.js";

/* The Settings (gear) menu panel — the agent-settings host shared by
   SessionSurface (ordinary sessions and the draft) and SpaceSurface (active
   spaces), so the capabilities that left the rail stay reachable from BOTH
   primary navigation routes.

   Contents, top to bottom:
   - `children`: the host's own session-view entries (SessionSurface passes
     its nine relocated SDK-surface menu items; SpaceSurface passes none —
     those views are SessionSurface projections that never rendered inside
     spaces).
   - the per-session persona binding control and the display-only workflow
     status chip (F2.1: both left the header row), draft-gated exactly as
     they were in the header. Their honesty contracts are untouched: an
     UNSEEN persona receipt or graph_status read stays undefined here — it
     is never defaulted into a "No persona" / "no workflow" claim.
   - the Agent Types (Loom) and Workflows sections, the same always-mounted
     components the rail carried, props unchanged.

   Mount discipline (F2 verify P2): the host mounts this component
   UNCONDITIONALLY and `open` only toggles visibility. Dismissing the menu
   (Escape, outside click, or picking an entry) therefore never unmounts the
   Loom/Workflow editors — their in-progress drafts, filters, and
   component-local conflict state survive close/reopen, exactly as they
   survived in the permanently mounted rail. Only unmounting the host
   surface itself (e.g. switching between the ordinary surface and a space)
   recreates them.

   Idiom: same anchored portal as SessionSurface's title menu —
   viewport-fitted position via viewportMenuPosition, re-placed on
   resize/scroll, dismissed on outside mousedown or Escape. */

export default function SessionSettingsMenu({
  anchorRef,
  open = false,
  onDismiss = null,
  session = null,
  children = null,
  activeSessionId = "",
  loomAgentTypes = [],
  loomPersonaBySession = {},
  onSelectPersona = null,
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
}) {
  const panelRef = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const place = () => {
      const anchor = anchorRef?.current?.getBoundingClientRect();
      const menu = panelRef.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      const viewport = window.visualViewport;
      setPosition(viewportMenuPosition(anchor, menu, {
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
  }, [anchorRef, open]);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const close = (event) => {
      if (anchorRef?.current?.contains(event.target)
        || panelRef.current?.contains(event.target)) {
        return;
      }
      onDismiss?.();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        onDismiss?.();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onDismiss, open]);

  /* The portal is UNCONDITIONAL — see the mount-discipline note above.
     `data-open` gates visibility only. */
  return createPortal(
    <SettingsMenuPanel
      $left={position?.left}
      $positioned={Boolean(position)}
      $top={position?.top}
      aria-label="Agent settings"
      data-open={open ? "true" : "false"}
      ref={panelRef}
      role="menu"
    >
      {children}
      {session && session.id !== "draft" && (
        <SettingsMenuSection data-section="session">
          <SessionPersonaSelect
            agentTypes={loomAgentTypes}
            binding={loomPersonaBySession[session.id]}
            onSelect={onSelectPersona}
            sessionId={session.id}
          />
          <WorkflowStatusChip
            statusView={workflowStatusBySession[session.id]}
            unavailable={workflowUnavailable}
          />
        </SettingsMenuSection>
      )}
      <SettingsMenuSection data-section="loom">
        <LoomRailSection
          activeSessionId={activeSessionId}
          agentTypes={loomAgentTypes}
          workflowEntries={loomWorkflowEntries}
          archivedEntries={loomArchivedEntries}
          cliPresent={loomCliPresent}
          installByType={loomInstallByType}
          cancelByJob={loomCancelByJob}
          registryCursor={loomRegistryCursor}
          listError={loomListError}
          featureUnavailable={loomFeatureUnavailable}
          featureErrors={loomFeatureErrors}
          authoringConflict={loomAuthoringConflict}
          onListArchived={onListArchivedLoom}
          onValidate={onValidateLoom}
          onAuthorDraft={onDraftLoom}
          onAuthorRevise={onReviseLoom}
          onAuthorConfirm={onConfirmLoom}
          onSetArchived={onSetLoomArchived}
          onRefreshInstall={onRefreshAgentInstall}
          onRefreshRegistry={onRefreshLoomRegistry}
          onRegister={onRegisterAgentType}
          onRetryInstall={onRetryAgentInstall}
          onCancelInstall={onCancelAgentInstall}
          unavailable={loomUnavailable}
        />
      </SettingsMenuSection>
      <SettingsMenuSection data-section="workflow">
        <WorkflowRailSection
          activeSessionId={activeSessionId}
          catalog={workflowCatalog}
          instanceById={workflowInstanceById}
          listError={workflowListError}
          onAbandon={onAbandonWorkflow}
          onPin={onPinWorkflow}
          onReadInstance={onReadWorkflowInstance}
          onRegisterWorkflow={onRegisterWorkflow}
          onSwitch={onSwitchWorkflow}
          statusBySession={workflowStatusBySession}
          unavailable={workflowUnavailable}
          workflows={workflowRecords}
        />
      </SettingsMenuSection>
    </SettingsMenuPanel>,
    document.body,
  );
}

/* ---- shared view chrome ------------------------------------------------ */

/* The segmented view control and its buttons, shared so SpaceSurface can
   render the SAME Chat/Shell/Traj + gear chrome for the focused space
   member instead of forking a second toggle. */
export const SessionViewToggle = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  background: var(--forge-surface-control);
`;

export const SessionViewButton = styled.button`
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

/* ---- menu chrome ------------------------------------------------------- */

/* Same anchored-portal chrome as SessionSurface's title menu, widened to
   host the relocated rail sections. Hidden — never unmounted — while
   closed, so the sections' state survives dismissal. */
const SettingsMenuPanel = styled.div`
  position: fixed;
  top: ${({ $top }) => `${$top ?? 0}px`};
  left: ${({ $left }) => `${$left ?? 0}px`};
  z-index: 40;
  display: grid;
  width: 340px;
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

  &[data-open="false"] {
    display: none;
  }
`;

export const SettingsMenuItem = styled.button`
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

  &[data-active="true"] {
    color: var(--forge-text);
    background: rgba(var(--forge-tint-rgb), 0.22);
    box-shadow: inset 0 0 0 1px rgba(var(--forge-tint-soft-rgb), 0.35);
  }
`;

const SettingsMenuSection = styled.div`
  display: grid;
  margin-top: 4px;
  padding: 6px 4px 2px;
  border-top: 1px solid var(--forge-border);

  &:first-child {
    margin-top: 0;
    padding-top: 2px;
    border-top: 0;
  }

  /* The relocated header controls sit side by side on one compact row. */
  &[data-section="session"] {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
`;
