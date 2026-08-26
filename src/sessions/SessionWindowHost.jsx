import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import {
  ButtonCloseIcon,
  ButtonFullscreenExitIcon,
  ButtonFullscreenIcon,
  GlobalStyle,
} from "../app/appStyles.js";
import { usePopoutWindowFullscreen } from "../app/usePopoutWindowFullscreen.js";
import SessionComposer from "./SessionComposer.jsx";
import SessionTrajectory from "./SessionTrajectory.jsx";
import SessionTranscript from "./SessionTranscript.jsx";
import { sessionAvailabilityPresentation } from "./sessionAvailability.js";
import {
  createSpaceSessionSubmitFor,
  enterSpaceState,
  rosterFromSessionsRead,
  sessionsByIdMap,
  spaceLeafPresentation,
} from "./spacesController.js";
import { spaceLeafById } from "./spacesModel.js";
import { listSessions } from "./sessionsModel.js";
import {
  createSessionsRosterGate,
  HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT,
  HAIDER_ROSTER_BOOTSTRAP_REQUEST_EVENT,
  reduceSessionsRosterGate,
} from "./sessionsRosterBootstrap.js";
import {
  applySessionSurfaceStatusEvent,
  surfaceStatusPillView,
} from "./sessionStatus.js";
import {
  normalizedSessionWindowTheme,
  SESSION_WINDOW_CONTROL_EVENT,
  SESSION_WINDOW_CONTROL_FOCUS_MAIN,
  SESSION_WINDOW_CONTROL_RETURN,
  SESSION_WINDOW_REFRESH_EVENT,
  SESSION_WINDOW_THEME_STORAGE_PREFIX,
  sessionWindowRosterPresentation,
  sessionWindowShouldRefresh,
} from "./sessionWindowBridge.js";

function currentWebviewLabel() {
  try {
    return getCurrentWebviewWindow().label || "";
  } catch {
    return "";
  }
}

function parseSessionWindowParams() {
  const hash = typeof window !== "undefined" ? window.location.hash || "" : "";
  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
  return {
    leafId: params.get("leaf_id") || params.get("leafId") || "",
    sessionId: params.get("session_id") || params.get("sessionId") || "",
    spaceId: params.get("space_id") || params.get("spaceId") || "",
    theme: normalizedSessionWindowTheme(params.get("theme")),
    title: params.get("title") || "Session",
    windowId: params.get("window_id") || params.get("windowId") || currentWebviewLabel(),
  };
}

function readStoredTheme(fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    return normalizedSessionWindowTheme(
      window.localStorage?.getItem(`${SESSION_WINDOW_THEME_STORAGE_PREFIX}session`) || fallback,
    );
  } catch {
    return fallback;
  }
}

function writeStoredTheme(theme) {
  try {
    window.localStorage?.setItem(`${SESSION_WINDOW_THEME_STORAGE_PREFIX}session`, theme);
  } catch {
    // Cosmetic preference only.
  }
}

function safeWindowCall(windowHandle, action, ...args) {
  try {
    Promise.resolve(windowHandle?.[action]?.(...args)).catch(() => {});
  } catch {
    // The native handle can disappear during close/return races.
  }
}

function unknownTarget(reason, scope = "session", sessionRef = "") {
  return {
    mode: "unknown",
    reason: String(reason || "The daemon session roster is unavailable."),
    scope,
    session: null,
    sessionRef,
    sessions: [],
    viewKind: null,
  };
}

export function resolveSessionWindowLeafTarget({
  leafId,
  record,
  roster,
  sessions = [],
  sessionsRead,
} = {}) {
  const authoritativeRoster = roster ?? rosterFromSessionsRead(sessionsRead);
  const entered = enterSpaceState(record, authoritativeRoster);
  if (!entered.ok) return unknownTarget(entered.error.message, "leaf");
  const leaf = spaceLeafById(entered.state, leafId);
  if (!leaf) {
    return {
      mode: "tombstone",
      reason: `The saved space layout no longer contains leaf “${leafId}”.`,
      scope: "leaf",
      session: null,
      sessionRef: "",
      sessions,
      viewKind: null,
    };
  }
  const presentation = spaceLeafPresentation(leaf, sessionsByIdMap(sessions));
  return {
    ...presentation,
    scope: "leaf",
    sessionRef: leaf.sessionRef,
    sessions,
    viewKind: leaf.viewKind,
  };
}

function projectedSessionsFromGate(gate) {
  return gate?.read?.ok === true && Array.isArray(gate.read.rows)
    ? gate.read.rows
    : [];
}

function ordinarySessionTarget(params, gate) {
  const sessions = projectedSessionsFromGate(gate);
  const roster = gate?.roster;
  const presentation = sessionWindowRosterPresentation({
    reason: roster?.state === "unreachable" ? roster.reason : "",
    rosterState: roster?.state === "reachable" ? "reachable" : "unreachable",
    sessionId: params.sessionId,
    sessions,
  });
  return {
    ...presentation,
    scope: "session",
    sessionRef: params.sessionId,
    sessions,
    viewKind: presentation.mode === "live" ? "chat" : null,
  };
}

/* A standalone webview owns its own bootstrap barrier. Its local sessions_list
   projection is never consulted until native has published a complete daemon
   roster, and every new barrier revision invalidates an in-flight local read.
   Keeping this workflow outside React lets the production effect ordering be
   driven behaviorally without weakening the fail-closed boundary. */
export function createSessionWindowTargetAuthority({
  params = {},
  publishTarget = () => {},
  readSessions = listSessions,
  readSpace = (spaceId) => invoke("space_get", { space_id: spaceId }),
} = {}) {
  let gate = createSessionsRosterGate();
  let sequence = 0;
  let disposed = false;

  const publishResolvedTarget = async (attempt, gateSnapshot) => {
    const sessions = projectedSessionsFromGate(gateSnapshot);
    let nextTarget;
    if (!params.spaceId) {
      nextTarget = ordinarySessionTarget(params, gateSnapshot);
    } else {
      let record;
      try {
        record = await readSpace(params.spaceId);
      } catch (error) {
        nextTarget = unknownTarget(
          String(error?.message || error || "The saved space layout is unavailable."),
          "leaf",
        );
      }
      if (!nextTarget) {
        nextTarget = resolveSessionWindowLeafTarget({
          leafId: params.leafId,
          record,
          roster: gateSnapshot.roster,
          sessions,
        });
      }
    }
    if (disposed || sequence !== attempt || gate !== gateSnapshot) return null;
    publishTarget(nextTarget);
    return nextTarget;
  };

  const refresh = async () => {
    const attempt = sequence + 1;
    sequence = attempt;
    let gateSnapshot = gate;
    if (gateSnapshot.barrier.state === "reachable") {
      const { barrierRevision, confirmationRevision } = gateSnapshot;
      let read;
      try {
        read = { ok: true, rows: await readSessions() };
      } catch (error) {
        read = { ok: false, error };
      }
      if (disposed || sequence !== attempt) return null;
      gate = reduceSessionsRosterGate(gate, {
        type: "sessions-read",
        barrierRevision,
        confirmationRevision,
        read,
      });
      gateSnapshot = gate;
    }
    return publishResolvedTarget(attempt, gateSnapshot);
  };

  return Object.freeze({
    activate() {
      disposed = false;
    },
    currentGate: () => gate,
    dispose() {
      disposed = true;
      sequence += 1;
    },
    publishBootstrap(value) {
      gate = reduceSessionsRosterGate(gate, { type: "barrier", value });
      return refresh();
    },
    refresh,
  });
}

/* Defense in depth at the side-effect boundary: even a malformed non-live
   target carrying a cached session row cannot reach surface_attach. */
export function attachLiveSessionWindowTarget(target, attach) {
  if (target?.mode !== "live" || typeof attach !== "function") return false;
  const providerId = String(target.session?.provider_session_id || "").trim();
  if (!providerId) return false;
  Promise.resolve(attach(providerId)).catch(() => {});
  return true;
}

export function sessionWindowTargetMessage(target, urlSessionRef = "") {
  const reason = String(target?.reason || "").trim();
  const currentLeafSessionRef = target?.scope === "leaf"
    ? String(target?.sessionRef || "").trim()
    : "";
  if (reason) {
    return currentLeafSessionRef
      ? `${reason} The current saved leaf refers to “${currentLeafSessionRef}”.`
      : reason;
  }
  const sessionRef = currentLeafSessionRef
    || (target?.scope === "session" ? String(urlSessionRef || "").trim() : "");
  return sessionRef
    ? `The published session roster no longer lists “${sessionRef}”.`
    : "The requested session is no longer present.";
}

export function returnSessionWindowToMain(sendControl, currentWindow) {
  return Promise.resolve()
    .then(() => sendControl(SESSION_WINDOW_CONTROL_RETURN))
    .finally(() => safeWindowCall(currentWindow, "close"));
}

export default function SessionWindowHost() {
  const [params] = useState(parseSessionWindowParams);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const windowLabel = useMemo(() => currentWebviewLabel() || params.windowId, [params.windowId]);
  const [theme, setTheme] = useState(() => readStoredTheme(params.theme));
  const [target, setTarget] = useState(() => unknownTarget(
    "The daemon session roster has not answered yet.",
    params.spaceId ? "leaf" : "session",
  ));
  const [surfaceStatus, setSurfaceStatus] = useState({});
  const [composerText, setComposerText] = useState("");
  const [pastedBlocks, setPastedBlocks] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const editGenerationRef = useRef(0);
  const submitCommandFor = useMemo(() => createSpaceSessionSubmitFor(invoke), []);
  const targetAuthority = useMemo(() => createSessionWindowTargetAuthority({
    params,
    publishTarget: setTarget,
  }), [params]);
  const { isFullscreen, toggleFullscreen } = usePopoutWindowFullscreen(currentWindow);

  const refreshTarget = useCallback(
    () => targetAuthority.refresh(),
    [targetAuthority],
  );

  useEffect(() => {
    document.documentElement.dataset.forgeTheme = theme;
    document.documentElement.dataset.sessionWindow = "true";
    document.body.dataset.sessionWindow = "true";
    writeStoredTheme(theme);
    return () => {
      delete document.documentElement.dataset.sessionWindow;
      delete document.body.dataset.sessionWindow;
    };
  }, [theme]);

  useEffect(() => {
    targetAuthority.activate();
    void refreshTarget();
    let disposed = false;
    const unlisteners = [];
    void listen(SESSION_WINDOW_REFRESH_EVENT, (event) => {
      if (!disposed && sessionWindowShouldRefresh(params, event?.payload)) void refreshTarget();
    }).then((stop) => {
      if (disposed) stop();
      else unlisteners.push(stop);
    }).catch(() => {});
    void listen(HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT, (event) => {
      if (!disposed) void targetAuthority.publishBootstrap(event?.payload);
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisteners.push(stop);
      /* Request only after this webview's listener is installed, otherwise a
         synchronous current-state reply can be lost and cached rows might be
         mistaken for the first authoritative answer. */
      void emit(HAIDER_ROSTER_BOOTSTRAP_REQUEST_EVENT, {}).catch(() => {});
    }).catch(() => {});
    return () => {
      disposed = true;
      targetAuthority.dispose();
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [params, refreshTarget, targetAuthority]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen("session-surface", (event) => {
      if (disposed) return;
      applySessionSurfaceStatusEvent(event, target.sessions, setSurfaceStatus);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [target.sessions]);

  useEffect(() => {
    attachLiveSessionWindowTarget(
      target,
      (providerId) => invoke("surface_attach", { session_id: providerId }),
    );
  }, [target]);

  const sendControl = useCallback((control) => {
    return emit(SESSION_WINDOW_CONTROL_EVENT, {
      control,
      leaf_id: params.leafId || null,
      session_id: target.sessionRef || params.sessionId,
      space_id: params.spaceId || null,
      window_id: windowLabel,
    }).catch(() => {});
  }, [params.leafId, params.sessionId, params.spaceId, target.sessionRef, windowLabel]);

  const returnToMain = useCallback(() => {
    void returnSessionWindowToMain(sendControl, currentWindow);
  }, [currentWindow, sendControl]);

  const startWindowDrag = useCallback((event) => {
    if (event?.button !== 0
      || event?.target?.closest?.("button, input, textarea, select, a, [contenteditable='true']")) {
      return;
    }
    event?.preventDefault?.();
    safeWindowCall(currentWindow, "startDragging");
  }, [currentWindow]);

  const changeComposerText = useCallback((text) => {
    editGenerationRef.current += 1;
    setComposerText(text);
  }, []);
  const changePastedBlocks = useCallback((blocks) => {
    editGenerationRef.current += 1;
    setPastedBlocks(blocks);
  }, []);
  const changeAttachments = useCallback((next) => {
    editGenerationRef.current += 1;
    setAttachments((current) => (typeof next === "function" ? next(current) : next));
  }, []);
  const submit = useCallback(async (prompt, submitAttachments) => {
    const session = target.session;
    if (!session) return false;
    const generation = editGenerationRef.current;
    try {
      await submitCommandFor(session)(prompt, submitAttachments || []);
      if (editGenerationRef.current === generation) {
        setComposerText("");
        setPastedBlocks([]);
        setAttachments([]);
      }
      return true;
    } catch {
      return false;
    }
  }, [submitCommandFor, target.session]);

  const session = target.session;
  const title = session?.title || params.title || params.sessionId || "Session";
  const availability = session ? sessionAvailabilityPresentation(session) : null;
  const status = session
    ? surfaceStatusPillView(surfaceStatus[session.id] || null, session, availability)
    : null;
  const cardTitle = target.scope === "leaf" && target.mode === "tombstone"
    ? "Leaf removed"
    : target.mode === "tombstone"
      ? "Session removed"
      : "Session state unknown";

  return (
    <>
      <GlobalStyle />
      <SessionWindowShell data-theme={theme}>
        <SessionWindowChrome data-tauri-drag-region="true" onMouseDown={startWindowDrag}>
          <SessionWindowIdentity data-tauri-drag-region="true">
            <strong>{params.spaceId ? "Space leaf" : "Session"}</strong>
            <span>{title}</span>
          </SessionWindowIdentity>
          <SessionWindowActions>
            <SessionWindowButton
              onClick={() => sendControl(SESSION_WINDOW_CONTROL_FOCUS_MAIN)}
              type="button"
            >
              Focus main
            </SessionWindowButton>
            <SessionWindowButton onClick={returnToMain} type="button">Return</SessionWindowButton>
            <SessionWindowIconButton
              aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
              type="button"
            >
              {isFullscreen
                ? <ButtonFullscreenExitIcon aria-hidden="true" />
                : <ButtonFullscreenIcon aria-hidden="true" />}
            </SessionWindowIconButton>
            <SessionWindowIconButton
              aria-label="Close session window"
              onClick={() => safeWindowCall(currentWindow, "close")}
              title="Close"
              type="button"
            >
              <ButtonCloseIcon aria-hidden="true" />
            </SessionWindowIconButton>
          </SessionWindowActions>
        </SessionWindowChrome>

        <SessionWindowBody>
          {target.mode === "live" ? (
            <SessionWindowLive>
              <SessionWindowSessionHeader data-tauri-drag-region="true" onMouseDown={startWindowDrag}>
                <strong>{title}</strong>
                <SessionWindowStatus
                  data-session-availability={availability?.reason}
                  data-status={status.status}
                  data-status-authority={status.authority}
                  data-status-source={status.source}
                  data-structured-status={status.structuredStatus}
                  title={status.title}
                >
                  <i aria-hidden="true" />
                  <span>{status.label}</span>
                </SessionWindowStatus>
                <SessionWindowThemeButton
                  onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
                  type="button"
                >
                  {theme === "light" ? "Dark" : "Light"}
                </SessionWindowThemeButton>
              </SessionWindowSessionHeader>
              {target.viewKind === "trajectory" ? (
                <SessionWindowView><SessionTrajectory session={session} /></SessionWindowView>
              ) : target.viewKind === "shell" ? (
                <SessionWindowStateCard data-tone="unknown" role="status">
                  <small>shell</small>
                  <strong>Shell view not rendered in spaces yet</strong>
                  <span>Return to the main session surface to open this session's shell.</span>
                </SessionWindowStateCard>
              ) : (
                <SessionWindowView>
                  <SessionTranscript onAnswered={refreshTarget} session={session} />
                  <SessionComposer
                    attachments={attachments}
                    onAttachmentsChange={changeAttachments}
                    onPastedBlocksChange={changePastedBlocks}
                    onSubmit={submit}
                    onValueChange={changeComposerText}
                    pastedBlocks={pastedBlocks}
                    placeholder={`Message ${title}…`}
                    value={composerText}
                  />
                </SessionWindowView>
              )}
            </SessionWindowLive>
          ) : (
            <SessionWindowStateCard data-tone={target.mode} role="status">
              <small>{target.mode}</small>
              <strong>{cardTitle}</strong>
              <span>{sessionWindowTargetMessage(target, params.sessionId)}</span>
            </SessionWindowStateCard>
          )}
        </SessionWindowBody>
      </SessionWindowShell>
    </>
  );
}

const SessionWindowShell = styled.div`
  display: flex;
  width: 100vw;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--forge-border-strong);
  background: var(--forge-bg);
`;

const SessionWindowChrome = styled.header`
  display: flex;
  min-height: 38px;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-surface-raised);
  user-select: none;
`;

const SessionWindowIdentity = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 8px;

  strong { color: var(--forge-text); font-size: 11px; }
  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 11px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const SessionWindowActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
`;

const SessionWindowButton = styled.button`
  padding: 4px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10px;
  cursor: pointer;

  &:hover { color: var(--forge-text); border-color: var(--forge-border-strong); }
`;

const SessionWindowIconButton = styled(SessionWindowButton)`
  display: grid;
  width: 26px;
  height: 26px;
  padding: 0;
  place-items: center;

  svg { width: 12px; height: 12px; }
`;

const SessionWindowBody = styled.main`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1;
  place-items: center;
`;

const SessionWindowLive = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
`;

const SessionWindowSessionHeader = styled.div`
  display: flex;
  min-height: 38px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--forge-border);

  > strong {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--forge-text);
    font-size: 13px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const SessionWindowStatus = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10px;
  font-weight: 700;

  i { width: 6px; height: 6px; border-radius: 50%; background: var(--forge-text-muted); }
  &[data-status="running"] i { background: var(--forge-green); }
  &[data-status="waiting"] i { background: var(--forge-amber); }
  &[data-status="error"] i,
  &[data-session-availability="daemon-unavailable"] i { background: var(--forge-red); }
`;

const SessionWindowThemeButton = styled(SessionWindowButton)`
  flex: 0 0 auto;
`;

const SessionWindowView = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

const SessionWindowStateCard = styled.div`
  display: grid;
  width: min(460px, calc(100vw - 48px));
  gap: 8px;
  padding: 22px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 12px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-raised);

  small {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  strong { color: var(--forge-text); font-size: 15px; }
  span { font-size: 12px; line-height: 1.55; }
`;
