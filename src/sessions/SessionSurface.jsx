import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Edit } from "@styled-icons/material-rounded/Edit";
import { Forum } from "@styled-icons/material-rounded/Forum";
import { Language } from "@styled-icons/material-rounded/Language";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { MoreHoriz } from "@styled-icons/material-rounded/MoreHoriz";
import { Movie } from "@styled-icons/material-rounded/Movie";
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
import SessionTerminal from "./SessionTerminal.jsx";
import SessionTrajectory from "./SessionTrajectory.jsx";
import SessionTranscript from "./SessionTranscript.jsx";
import { formatSessionRelativeTime } from "./sessionsModel.js";

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
  onHeaderDragStart = null,
  onOpenSession,
  onResetToDraft,
  onSyncingChange,
  onToggleTheme,
  openSessions,
  planKey = "free",
  sessions = [],
}) {
  const [viewModes, setViewModes] = useState({});
  const [sessionTabs, setSessionTabs] = useState({});
  /* Composer drafts are SURFACE-owned, keyed by session id ("draft" for the
     unmaterialized chat): the composer unmounts on view/session switches, so
     the text must outlive it. Daemon revision lanes are PER-CONNECTION
     (rev934 P1-1), so frames are discriminated by OWNER, never by comparing
     revisions across lanes: mirrorRevisionsRef stamps only OUR publishes;
     mirrorPublishedRef remembers the last publish so our own echo (revision
     AND text match) teaches us our owner id; foreign lanes keep per-owner
     applied floors in mirrorForeignRef. A fresh TUI's revision 1 applies. */
  const [composerTexts, setComposerTexts] = useState({});
  const mirrorRevisionsRef = useRef({});
  const mirrorPublishedRef = useRef({}); // sessionId -> {text, revision}
  const mirrorSelfOwnerRef = useRef(""); // learned daemon connection id
  const mirrorForeignRef = useRef({}); // sessionId -> {owner -> floor}
  const setComposerText = useCallback((sessionId, text) => {
    setComposerTexts((current) => ({ ...current, [sessionId]: text }));
  }, []);
  const [composerPrefs, setComposerPrefs] = useState({});
  const [usageMeta, setUsageMeta] = useState(null);
  const [library, setLibrary] = useState(null);
  const [draftError, setDraftError] = useState("");
  const submitBusyRef = useRef(false);

  /* Current provider/account context + model library from the harness. */
  useEffect(() => {
    let disposed = false;
    void invoke("haider_usage_snapshot").then((snapshot) => {
      if (!disposed && snapshot && typeof snapshot === "object") {
        setUsageMeta(snapshot);
      }
    }).catch(() => {});
    void invoke("haider_library_snapshot").then((snapshot) => {
      if (!disposed && snapshot && typeof snapshot === "object") {
        setLibrary(snapshot);
      }
    }).catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  /* Chips show REALITY (the session's actual model/provider, the harness's
     actual account), never an unapplied local preference — switching stays
     read-only until the harness exposes a headless door for it. */
  /* Live session config (0.0.933 session_config_v1) — fetched per session,
     applied through session_config_set; chips reflect the daemon's truth. */
  const [sessionConfigs, setSessionConfigs] = useState({});
  const [paneOverrides, setPaneOverrides] = useState({});
  const [surfaceStatus, setSurfaceStatus] = useState({});

  const refreshConfig = useCallback((sessionId) => {
    void invoke("session_config_get", { session_id: sessionId })
      .then((config) => {
        if (config && typeof config === "object") {
          setSessionConfigs((current) => ({ ...current, [sessionId]: config }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSessionId && activeSessionId !== "draft") {
      refreshConfig(activeSessionId);
      void invoke("surface_attach", { session_id: activeSessionId }).catch(() => {});
    }
  }, [activeSessionId, refreshConfig]);

  /* Daemon-owned volatile surfaces (input mirror + status segment): events
     arrive keyed by PROVIDER session id; map to local rows. */
  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("session-surface", (event) => {
      if (disposed) return;
      const payload = event?.payload || {};
      const local = sessions.find(
        (row) => row.provider_session_id === payload.session_id,
      );
      if (!local) return;
      if (payload.status?.line != null) {
        setSurfaceStatus((current) => ({ ...current, [local.id]: payload.status.line }));
      }
      if (payload.input?.text != null) {
        /* input_mirror_v1, owner-aware (rev934 P1-1): our own accepted
           publish echoed back (revision AND text match) names our lane and
           drops; other frames from that learned owner drop as echoes; every
           foreign lane applies when its OWN revision advances — a fresh
           publisher's revision 1 is newer than nothing of ours. */
        const { text, owner = "" } = payload.input;
        const revision = payload.input.revision || 0;
        const published = mirrorPublishedRef.current[local.id];
        if (published && published.revision === revision && published.text === text) {
          if (owner) mirrorSelfOwnerRef.current = owner;
        } else if (!owner || owner !== mirrorSelfOwnerRef.current) {
          const floors = (mirrorForeignRef.current[local.id] ||= {});
          if (!(owner in floors) || revision > floors[owner]) {
            floors[owner] = revision;
            setComposerTexts((current) => (
              (current[local.id] || "") === text
                ? current
                : { ...current, [local.id]: text }
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

  /* tui_attach_announce_v1: the TUI told us which session its PTY now
     serves — auto-select it and re-home the live pane under it. */
  const handleTuiAttached = useCallback(({ paneId, providerSessionId, hostSessionId }) => {
    if (!providerSessionId) {
      return; // back at the launcher — the pane keeps its host session
    }
    const target = sessions.find(
      (row) => row.provider_session_id === providerSessionId,
    );
    if (!target || target.id === hostSessionId) {
      return;
    }
    setPaneOverrides((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (next[key] === paneId) delete next[key];
      }
      next[target.id] = paneId;
      return next;
    });
    /* Land where the user actually was: a hop driven from a live Shell keeps
       the Shell; materializing from the Chat composer (the warm hidden TUI
       announcing the bind) must land in Chat. */
    if ((viewModes[hostSessionId] || "ui") === "terminal") {
      setViewModes((current) => ({ ...current, [target.id]: "terminal" }));
    }
    onOpenSession?.(target);
  }, [sessions, onOpenSession, viewModes]);

  /* ONE model chip: provider, model, and the provider's bound account are a
     single coherent choice (a deepseek model can never ride an openai
     account). The menu groups the catalog by provider; selecting applies
     "provider/model" through the harness. */
  const chipValuesFor = (session) => {
    const config = session ? sessionConfigs[session.id] : null;
    const prefs = composerPrefs[session?.id || "draft"] || {};
    const prefModel = (prefs.model || "").split("/").pop() || null;
    return {
      model: config?.model || prefModel || session?.model || "default",
      modelProvider: config?.provider || (prefs.model || "").split("/")[0] || session?.provider || "",
      effort: config?.effort || prefs.effort || "default",
      speed: config?.speed === "fast" || prefs.speed === "fast" ? "fast" : "default",
    };
  };
  const chipOptionsFor = (session) => {
    const models = Array.isArray(library?.models) ? library.models : [];
    const groups = [];
    const byProvider = new Map();
    for (const entry of models) {
      if (!entry?.model || !entry?.provider) continue;
      let group = byProvider.get(entry.provider);
      if (!group) {
        group = {
          provider: entry.provider,
          available: Boolean(entry.available),
          auth_state: entry.auth_state || "",
          models: [],
        };
        byProvider.set(entry.provider, group);
        groups.push(group);
      }
      group.available = group.available || Boolean(entry.available);
      if (!group.models.includes(entry.model)) group.models.push(entry.model);
    }
    groups.sort((a, b) => (b.available - a.available) || a.provider.localeCompare(b.provider));
    const config = session ? sessionConfigs[session.id] : null;
    return {
      modelGroups: groups,
      speedApplicable: config?.speed != null,
    };
  };
  /* Bound sessions apply through the harness (session_config_set) so the
     TUI, the daemon, and the chips agree; the draft stashes prefs that ride
     the first `haider run` as flags. */
  const handleChipChange = useCallback((sessionId, key, option) => {
    setComposerPrefs((current) => ({
      ...current,
      [sessionId]: { ...(current[sessionId] || {}), [key]: option },
    }));
    if (sessionId !== "draft") {
      const value = option === "default" ? null : option;
      const patch = { session_id: sessionId };
      if (key === "model") patch.model = value;
      else if (key === "effort") patch.effort = value;
      else if (key === "speed") patch.speed = value === null ? "normal" : value;
      else if (key === "account") patch.account = value;
      else return;
      void invoke("session_config_set", patch)
        .then(() => refreshConfig(sessionId))
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
  const setModeFor = useCallback((sessionId, mode) => {
    setViewModes((current) => ({ ...current, [sessionId]: mode }));
  }, []);

  /* Session-history sync, lifted from the transcript's additive callback
     (projection caught_up + cold-load state) and reported upward for the
     rail's syncing pill. Keyed per session; only the ACTIVE session's state
     surfaces. */
  const [transcriptSyncing, setTranscriptSyncing] = useState({});
  const handleTranscriptSyncing = useCallback((sessionId, syncing) => {
    setTranscriptSyncing((current) => (
      Boolean(current[sessionId]) === Boolean(syncing)
        ? current
        : { ...current, [sessionId]: Boolean(syncing) }
    ));
  }, []);
  const activeTranscriptSyncing = Boolean(
    !draftOpen && activeSessionId && transcriptSyncing[activeSessionId],
  );
  useEffect(() => {
    onSyncingChange?.(activeTranscriptSyncing);
  }, [activeTranscriptSyncing, onSyncingChange]);

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
      const config = runConfigFromPrefs(composerPrefs.draft || {});
      const row = await invoke("session_start_with_prompt", {
        prompt,
        pinned_dir: null,
        attachments: attachments?.length ? attachments : null,
        config,
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

  /* Session title chrome: the title is the workspace's first content line;
     its ellipsis menu carries Pin/Unpin + Rename (the same harness doors the
     rail's context menu uses). */
  const [titleMenuFor, setTitleMenuFor] = useState("");
  const [titleRenamingId, setTitleRenamingId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const titleMenuRef = useRef(null);
  useEffect(() => {
    if (!titleMenuFor) {
      return undefined;
    }
    const close = (event) => {
      if (titleMenuRef.current && titleMenuRef.current.contains(event.target)) {
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
    if (!id || !title) {
      return;
    }
    try {
      await invoke("session_rename", { session_id: id, title });
    } catch {
      // Store predates renaming — leave the daemon title in place.
    }
  }, [titleDraft, titleRenamingId]);

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

  const renderTitleBlock = (session) => (
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
        <TitleMenuWrap ref={titleMenuFor === session.id ? titleMenuRef : undefined}>
          <HeaderIconButton
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
          {titleMenuFor === session.id && (
            <TitleMenu role="menu">
              <TitleMenuItem
                onClick={() => void toggleSessionPin(session)}
                role="menuitem"
                type="button"
              >
                <PushPin aria-hidden="true" />
                <span>{session.pinned ? "Unpin" : "Pin"}</span>
              </TitleMenuItem>
              <TitleMenuItem
                onClick={() => beginTitleRename(session)}
                role="menuitem"
                type="button"
              >
                <Edit aria-hidden="true" />
                <span>Rename</span>
              </TitleMenuItem>
            </TitleMenu>
          )}
        </TitleMenuWrap>
      </TitleRow>
  );

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
    /* status_segment_v1: the pill mirrors the TUI's bottom-left strip
       byte-for-byte when the daemon publishes it; state_raw and the buckets
       are the fallbacks. */
    const statusLine = session && session.id !== "draft"
      ? ((surfaceStatus[session.id] || "").trim()
        || (session.state_raw || "").trim()
        || (session.status === "running"
          ? "Running"
          : session.status === "waiting"
            ? "Waiting"
            : session.status === "error"
              ? "Error"
              : "Idle"))
      : "";
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
          <StatusPill data-status={session.status} title={statusLine}>
            <i aria-hidden="true" />
            <span>{statusLine}</span>
          </StatusPill>
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
                autoFocus
                chipCapabilities={library?.capabilities || {}}
                chipOptions={chipOptionsFor(null)}
                chipValues={chipValuesFor(null)}
                onChipChange={(key, option) => handleChipChange("draft", key, option)}
                onSubmit={submitDraft}
                onValueChange={(text) => setComposerText("draft", text)}
                placeholder="Message Haider…"
                value={composerTexts.draft || ""}
              />
            </ChatHostLayer>
            <TerminalHostLayer data-visible={draftMode === "terminal" ? "true" : "false"}>
              <SessionTerminal active={draftMode === "terminal"} session={draftSession} />
            </TerminalHostLayer>
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
        const { tabs, activeTabId } = tabsStateFor(session.id);
        const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
        const chatTabActive = activeTab.id === "chat";
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
                  <ChatHostLayer data-visible={mode === "ui" ? "true" : "false"}>
                    <SessionTranscript
                      onSyncingChange={(syncing) => handleTranscriptSyncing(session.id, syncing)}
                      runStatus={session.status === "running"
                        ? ((surfaceStatus[session.id] || "").trim()
                          || (session.state_raw || "").trim()
                          || "working…")
                        : ""}
                      session={session}
                    />
                    <SessionComposer
                      chipCapabilities={library?.capabilities || {}}
                      chipOptions={chipOptionsFor(session)}
                      chipValues={chipValuesFor(session)}
                      onChipChange={(key, option) => handleChipChange(session.id, key, option)}
                      onMirrorType={(text) => {
                        /* Local typing publishes on OUR monotone lane; the
                           remembered (text, revision) lets the echo teach us
                           our daemon-assigned owner id. */
                        const revision = (mirrorRevisionsRef.current[session.id] || 0) + 1;
                        mirrorRevisionsRef.current[session.id] = revision;
                        mirrorPublishedRef.current[session.id] = { text, revision };
                        void invoke("surface_publish_input", {
                          session_id: session.id,
                          text,
                          revision,
                        }).catch(() => {});
                      }}
                      onSubmit={(prompt, attachments) => submitIntoSession(session, prompt, attachments)}
                      onValueChange={(text) => setComposerText(session.id, text)}
                      value={composerTexts[session.id] || ""}
                    />
                  </ChatHostLayer>
                  {mode === "trajectory" && (
                    <TrajectoryHostLayer>
                      <SessionTrajectory session={session} />
                    </TrajectoryHostLayer>
                  )}
                  <TerminalHostLayer data-visible={mode === "terminal" ? "true" : "false"}>
                    <SessionTerminal
                      active={mode === "terminal"}
                      onTuiAttached={handleTuiAttached}
                      paneIdOverride={paneOverrides[session.id]}
                      session={session}
                    />
                  </TerminalHostLayer>
                </>
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
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  display: grid;
  min-width: 148px;
  gap: 1px;
  padding: 4px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 9px;
  background: var(--forge-surface-raised, var(--forge-surface));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
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
