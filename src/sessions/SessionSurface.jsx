import { openPath } from "@tauri-apps/plugin-opener";
import styled from "styled-components";

import SessionTerminal from "./SessionTerminal.jsx";

/* The main-pane surface for opened sessions. Every opened session keeps its
   SessionTerminal mounted (hidden when inactive) so PTYs and scrollback
   survive switching; only the active one is visible. */

export default function SessionSurface({ openSessions, activeSessionId }) {
  if (!openSessions.length) {
    return (
      <SessionSurfaceRoot data-empty="true">
        <SessionEmptyState>
          <h2>Where were we?</h2>
          <p>Start a new chat or pick a session from the rail. Every session runs on the Haider harness in its own folder.</p>
        </SessionEmptyState>
      </SessionSurfaceRoot>
    );
  }

  return (
    <SessionSurfaceRoot>
      {openSessions.map((session) => {
        const active = session.id === activeSessionId;
        return (
          <SessionPane data-active={active ? "true" : "false"} key={session.id}>
            <SessionHeader>
              <SessionHeaderTitle title={session.dir}>{session.title}</SessionHeaderTitle>
              <SessionHeaderActions>
                <SessionHeaderButton
                  onClick={() => void openPath(session.dir).catch(() => {})}
                  title={session.dir}
                  type="button"
                >
                  Open folder
                </SessionHeaderButton>
                {session.kind === "generated" && (
                  <SessionHeaderButton
                    onClick={() => void openPath(`${session.dir}/outputs`).catch(() => {})}
                    title={`${session.dir}/outputs`}
                    type="button"
                  >
                    Outputs
                  </SessionHeaderButton>
                )}
              </SessionHeaderActions>
            </SessionHeader>
            <SessionTerminal active={active} session={session} />
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
  justify-content: space-between;
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

const SessionHeaderActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
`;

const SessionHeaderButton = styled.button`
  padding: 3px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
  }
`;

const SessionEmptyState = styled.div`
  place-self: center;
  max-width: 420px;
  text-align: center;

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
