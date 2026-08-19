import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import styled from "styled-components";

import SessionComposer from "./SessionComposer.jsx";
import SessionTerminal from "./SessionTerminal.jsx";
import SessionTranscript from "./SessionTranscript.jsx";

/* Main-pane surface for sessions.

   Core ideas (per the approved design):
   - A session is harness data, NOT a PTY. Selecting a session never spawns
     anything: the default UI view renders the projection transcript.
   - "New chat" opens a zero-cost DRAFT (no store row, no directory, no
     process). The first submitted prompt creates the real session via
     session_start_with_prompt and it materializes in the rail.
   - Each session has a UI | Terminal toggle. The Terminal view spawns its
     `haider tui` PTY lazily on first entry and stays mounted afterwards. */

export default function SessionSurface({
  activeSessionId,
  draftOpen,
  onDraftMaterialized,
  openSessions,
}) {
  /* Per-session view mode + which sessions have ever opened a terminal
     (those PTY hosts stay mounted so switching back is instant). */
  const [viewModes, setViewModes] = useState({});
  const [terminalStarted, setTerminalStarted] = useState({});
  const [draftError, setDraftError] = useState("");
  const submitBusyRef = useRef(false);

  const modeFor = (sessionId) => viewModes[sessionId] || "ui";
  const setModeFor = useCallback((sessionId, mode) => {
    setViewModes((current) => ({ ...current, [sessionId]: mode }));
    if (mode === "terminal") {
      setTerminalStarted((current) => ({ ...current, [sessionId]: true }));
    }
  }, []);

  const submitDraft = useCallback(async (prompt) => {
    if (submitBusyRef.current) {
      return false;
    }
    submitBusyRef.current = true;
    setDraftError("");
    try {
      const row = await invoke("session_start_with_prompt", {
        prompt,
        pinned_dir: null,
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

  const submitIntoSession = useCallback(async (session, prompt) => {
    try {
      await invoke("session_submit_prompt", {
        session_id: session.id,
        prompt,
      });
      return true;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (message.includes("haider_run_session_unsupported")) {
        // Harness build without --session: hand the user the terminal.
        setModeFor(session.id, "terminal");
        return false;
      }
      return false;
    }
  }, [setModeFor]);

  if (draftOpen) {
    return (
      <SessionSurfaceRoot>
        <SessionPane data-active="true">
          <SessionHeader>
            <SessionHeaderTitle>New chat</SessionHeaderTitle>
          </SessionHeader>
          <DraftBody>
            <DraftHint>
              <h2>Where to?</h2>
              <p>Type below — the Haider harness creates the session (and its folder) on your first message. Nothing runs until then.</p>
              {draftError && <DraftError>{draftError}</DraftError>}
            </DraftHint>
          </DraftBody>
          <SessionComposer autoFocus onSubmit={submitDraft} placeholder="Start a new session…" />
        </SessionPane>
      </SessionSurfaceRoot>
    );
  }

  if (!openSessions.length) {
    return (
      <SessionSurfaceRoot data-empty="true">
        <DraftHint data-center="true">
          <h2>Where were we?</h2>
          <p>Start a new chat or pick a session from the rail. Sessions live on the Haider harness — no terminals run until you need them.</p>
        </DraftHint>
      </SessionSurfaceRoot>
    );
  }

  return (
    <SessionSurfaceRoot>
      {openSessions.map((session) => {
        const active = session.id === activeSessionId;
        const mode = modeFor(session.id);
        const terminalEverStarted = Boolean(terminalStarted[session.id]);
        return (
          <SessionPane data-active={active ? "true" : "false"} key={session.id}>
            <SessionHeader>
              <SessionHeaderTitle title={session.dir}>{session.title}</SessionHeaderTitle>
              <SessionViewToggle role="tablist" aria-label="Session view">
                <SessionViewButton
                  aria-selected={mode === "ui"}
                  data-active={mode === "ui" ? "true" : undefined}
                  onClick={() => setModeFor(session.id, "ui")}
                  role="tab"
                  type="button"
                >
                  UI
                </SessionViewButton>
                <SessionViewButton
                  aria-selected={mode === "terminal"}
                  data-active={mode === "terminal" ? "true" : undefined}
                  onClick={() => setModeFor(session.id, "terminal")}
                  role="tab"
                  type="button"
                >
                  Terminal
                </SessionViewButton>
              </SessionViewToggle>
            </SessionHeader>

            {/* UI view: projection transcript + composer; mounted only while
                selected (attach/detach follows), no PTY involved. */}
            {mode === "ui" && active && (
              <>
                <SessionTranscript session={session} />
                <SessionComposer
                  onSubmit={(prompt) => submitIntoSession(session, prompt)}
                />
              </>
            )}

            {/* Terminal view: lazy PTY, kept alive once started. */}
            {terminalEverStarted && (
              <TerminalHostLayer data-visible={mode === "terminal" ? "true" : "false"}>
                <SessionTerminal active={active && mode === "terminal"} session={session} />
              </TerminalHostLayer>
            )}
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

const SessionHeader = styled.div`
  display: flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-surface);
`;

const SessionHeaderTitle = styled.strong`
  overflow: hidden;
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const SessionViewToggle = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: var(--forge-surface-control);
`;

const SessionViewButton = styled.button`
  padding: 2px 10px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text);
    background: rgba(var(--forge-tint-rgb), 0.2);
  }

  &:hover:not([data-active="true"]) {
    color: var(--forge-text-soft);
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

const DraftHint = styled.div`
  max-width: 440px;
  text-align: center;

  &[data-center="true"] {
    place-self: center;
  }

  h2 {
    margin: 0 0 8px;
    color: var(--forge-text);
    font-size: 22px;
    font-weight: 650;
  }

  p {
    margin: 0;
    color: var(--forge-text-muted);
    font-size: 12.5px;
    line-height: 1.5;
  }
`;

const DraftError = styled.div`
  margin-top: 12px;
  color: var(--forge-red);
  font-size: 12px;
`;
