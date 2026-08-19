import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Forum } from "@styled-icons/material-rounded/Forum";
import { Language } from "@styled-icons/material-rounded/Language";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { Terminal as TerminalGlyph } from "@styled-icons/material-rounded/Terminal";
import { Timeline } from "@styled-icons/material-rounded/Timeline";

import {
  ButtonDarkModeIcon,
  ButtonLightModeIcon,
  ButtonRefreshIcon,
  ButtonCloseIcon,
  ButtonAddIcon,
} from "../app/appStyles.js";
import { PlanFlame } from "../app/PlanFlame.jsx";
import SessionComposer from "./SessionComposer.jsx";
import SessionTerminal from "./SessionTerminal.jsx";
import SessionTrajectory from "./SessionTrajectory.jsx";
import SessionTranscript from "./SessionTranscript.jsx";
import { formatSessionRelativeTime } from "./sessionsModel.js";

/* Main-pane surface for sessions.

   Structure (per the approved design):
   - The header is a TAB BAR: the session's Chat tab plus user-created panel
     tabs; "+" opens a new tab showing the panel picker (Web, PCB Design,
     AI Video Editor). Panel embedding is staged — picker + branded stubs
     now, live panels as they are re-scoped to sessions.
   - The Chat/Shell toggle, run-state pill, new-chat (reset to draft), and
     theme toggle FLOAT top-right over the content, dashboard-style.
   - A session is harness data, not a PTY: Chat view reads the projection;
     the Shell PTY spawns lazily on first entry and stays mounted.
   - "New chat" is a zero-cost draft; the first prompt materializes it. */

const PANEL_KINDS = {
  web: { label: "Web", Icon: Language },
  pcb: { label: "PCB Design", Icon: Memory },
  video: { label: "AI Video Editor", Icon: Movie },
};

export default function SessionSurface({
  activeSessionId,
  appThemeIsLight = false,
  draftOpen,
  onDraftMaterialized,
  onOpenSession,
  onResetToDraft,
  onToggleTheme,
  openSessions,
  planKey = "free",
  sessions = [],
}) {
  const [viewModes, setViewModes] = useState({});
  const [terminalStarted, setTerminalStarted] = useState({});
  const [sessionTabs, setSessionTabs] = useState({});
  const [composerPrefs, setComposerPrefs] = useState({});
  const [usageMeta, setUsageMeta] = useState(null);
  const [draftError, setDraftError] = useState("");
  const submitBusyRef = useRef(false);

  /* Current provider/account context from the harness (haider status). */
  useEffect(() => {
    let disposed = false;
    void invoke("haider_usage_snapshot").then((snapshot) => {
      if (!disposed && snapshot && typeof snapshot === "object") {
        setUsageMeta(snapshot);
      }
    }).catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const chipValuesFor = (session) => {
    const prefs = composerPrefs[session?.id || "draft"] || {};
    return {
      model: prefs.model || "default",
      effort: prefs.effort || "default",
      speed: prefs.speed || "default",
      provider: prefs.provider || session?.provider || usageMeta?.account?.provider || "default",
      account: prefs.account || usageMeta?.account?.alias || "default",
    };
  };
  const handleChipChange = useCallback((sessionId, key, option) => {
    setComposerPrefs((current) => ({
      ...current,
      [sessionId]: { ...(current[sessionId] || {}), [key]: option },
    }));
  }, []);

  const modeFor = (sessionId) => viewModes[sessionId] || "ui";
  const setModeFor = useCallback((sessionId, mode) => {
    setViewModes((current) => ({ ...current, [sessionId]: mode }));
    if (mode === "terminal") {
      setTerminalStarted((current) => ({ ...current, [sessionId]: true }));
    }
  }, []);

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

  const submitDraft = useCallback(async (prompt, attachments) => {
    if (submitBusyRef.current) {
      return false;
    }
    submitBusyRef.current = true;
    setDraftError("");
    try {
      const row = await invoke("session_start_with_prompt", {
        prompt,
        pinned_dir: null,
        attachments: attachments?.length ? attachments : null,
      });
      if (row?.id) {
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
  }, [onDraftMaterialized]);

  const submitIntoSession = useCallback(async (session, prompt, attachments) => {
    try {
      await invoke("session_submit_prompt", {
        session_id: session.id,
        prompt,
        attachments: attachments?.length ? attachments : null,
      });
      return true;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (message.includes("haider_run_session_unsupported")) {
        setModeFor(session.id, "terminal");
        return false;
      }
      return false;
    }
  }, [setModeFor]);

  const floatingControls = (session, { showToggle = true } = {}) => (
    <FloatingControls>
      {showToggle && session && (
      <SessionViewToggle aria-label="Session view" role="tablist">
        <SessionViewButton
          aria-selected={modeFor(session.id) === "ui"}
          data-active={modeFor(session.id) === "ui" ? "true" : undefined}
          onClick={() => setModeFor(session.id, "ui")}
          role="tab"
          type="button"
        >
          <Forum aria-hidden="true" size={13} />
          <span>Chat</span>
        </SessionViewButton>
        <SessionViewButton
          aria-selected={modeFor(session.id) === "terminal"}
          data-active={modeFor(session.id) === "terminal" ? "true" : undefined}
          onClick={() => setModeFor(session.id, "terminal")}
          role="tab"
          type="button"
        >
          <TerminalGlyph aria-hidden="true" size={13} />
          <span>Shell</span>
        </SessionViewButton>
        {session.id !== "draft" && (
          <SessionViewButton
            aria-selected={modeFor(session.id) === "trajectory"}
            data-active={modeFor(session.id) === "trajectory" ? "true" : undefined}
            onClick={() => setModeFor(session.id, "trajectory")}
            role="tab"
            type="button"
          >
            <Timeline aria-hidden="true" size={13} />
            <span>Trajectory</span>
          </SessionViewButton>
        )}
      </SessionViewToggle>
      )}
      {session && session.id !== "draft" && (
        <StatusPill data-status={session.status}>
          <i aria-hidden="true" />
          <span>
            {session.status === "running"
              ? "Running"
              : session.status === "waiting"
                ? "Waiting"
                : session.status === "error"
                  ? "Error"
                  : "Idle"}
          </span>
        </StatusPill>
      )}
      <HeaderIconButton
        aria-label="New chat"
        onClick={onResetToDraft}
        title="New chat (⌘N)"
        type="button"
      >
        <ButtonRefreshIcon aria-hidden="true" />
      </HeaderIconButton>
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

  if (draftOpen) {
    // Draft = the harness itself. Default view is the plain haider TUI at
    // its main menu (the harness creates the session when the user acts);
    // the Chat toggle offers the composer path, which also defers creation
    // to the harness (session_start_with_prompt only surfaces bound rows).
    const draftSession = {
      id: "draft",
      title: "New chat",
      dir: "",
      kind: "pinned",
      provider: "haider",
      provider_session_id: "",
      status: "idle",
    };
    const draftMode = viewModes.draft || "terminal";
    return (
      <SessionSurfaceRoot>
        <SessionPane data-active="true">
          <SessionTabBar>
            <TabChip data-active="true" type="button">
              <Forum aria-hidden="true" size={12} />
              <span>New chat</span>
            </TabChip>
            {floatingControls(draftSession)}
          </SessionTabBar>
          <PaneContent>
            {draftMode === "ui" ? (
              <>
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
                  autoFocus
                  chipValues={chipValuesFor(null)}
                  onChipChange={(key, option) => handleChipChange("draft", key, option)}
                  onSubmit={submitDraft}
                  placeholder="Message Haider…"
                />
              </>
            ) : (
              <TerminalHostLayer data-visible="true">
                <SessionTerminal active session={draftSession} />
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
          <SessionTabBar>
            {floatingControls(null, { showToggle: false })}
          </SessionTabBar>
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
                    <HomeContinueDot aria-hidden="true" data-status={session.status} />
                    <span>{session.title}</span>
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
        const terminalEverStarted = Boolean(terminalStarted[session.id]);
        const { tabs, activeTabId } = tabsStateFor(session.id);
        const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
        const chatTabActive = activeTab.id === "chat";
        return (
          <SessionPane data-active={active ? "true" : "false"} key={session.id}>
            <SessionTabBar>
              {tabs.map((tab) => {
                const panel = PANEL_KINDS[tab.kind];
                const TabIcon = tab.kind === "chat"
                  ? Forum
                  : panel?.Icon || ButtonAddIcon;
                const label = tab.kind === "chat"
                  ? session.title
                  : panel?.label || "New tab";
                return (
                  <TabChip
                    data-active={tab.id === activeTab.id ? "true" : undefined}
                    key={tab.id}
                    onClick={() => selectTab(session.id, tab.id)}
                    title={label}
                    type="button"
                  >
                    <TabIcon aria-hidden="true" size={12} />
                    <span>{label}</span>
                    {tab.id !== "chat" && (
                      <TabClose
                        aria-label="Close tab"
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTab(session.id, tab.id);
                        }}
                        role="button"
                        tabIndex={-1}
                      >
                        <ButtonCloseIcon aria-hidden="true" />
                      </TabClose>
                    )}
                  </TabChip>
                );
              })}
              <TabAddButton
                aria-label="New tab"
                onClick={() => addTab(session.id)}
                title="New tab"
                type="button"
              >
                <ButtonAddIcon aria-hidden="true" />
              </TabAddButton>
              {floatingControls(session)}
            </SessionTabBar>

            <PaneContent>
              {/* Chat tab: transcript + composer, or the lazy Shell PTY. */}
              {chatTabActive && mode === "ui" && active && (
                <>
                  <SessionTranscript session={session} />
                  <SessionComposer
                    chipValues={chipValuesFor(session)}
                    onChipChange={(key, option) => handleChipChange(session.id, key, option)}
                    onSubmit={(prompt, attachments) => submitIntoSession(session, prompt, attachments)}
                  />
                </>
              )}
              {chatTabActive && mode === "trajectory" && active && (
                <SessionTrajectory session={session} />
              )}
              {chatTabActive && terminalEverStarted && (
                <TerminalHostLayer data-visible={mode === "terminal" ? "true" : "false"}>
                  <SessionTerminal active={active && mode === "terminal"} session={session} />
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

const SessionTabBar = styled.div`
  display: flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  overflow-x: auto;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-surface);
`;

const TabChip = styled.button`
  display: inline-flex;
  max-width: 220px;
  min-height: 24px;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  svg {
    flex: 0 0 auto;
  }

  &:hover {
    color: var(--forge-text-soft);
    background: var(--forge-surface-hover);
  }

  &[data-active="true"] {
    color: var(--forge-text);
    border-color: rgba(var(--forge-tint-soft-rgb), 0.4);
    background: rgba(var(--forge-tint-rgb), 0.14);
  }
`;

const TabClose = styled.span`
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
  border-radius: 4px;
  color: var(--forge-text-muted);

  svg {
    width: 10px;
    height: 10px;
  }

  &:hover {
    color: var(--forge-text);
    background: rgba(255, 255, 255, 0.1);
  }
`;

const TabAddButton = styled.button`
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  color: var(--forge-text-soft);
  background: transparent;
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

const PaneContent = styled.div`
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

const FloatingControls = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  margin-left: auto;
  align-items: center;
  gap: 8px;
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
`;

const StatusPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10px;
  font-weight: 700;

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

const TerminalHostLayer = styled.div`
  flex: 1;
  min-height: 0;

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

  span {
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
