import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

/* Virtualized transcript for the session UI view, fed by the Rust
   projection store (haider_projection.rs):
     - session_projection_ensure(session_id)  → cold fold via haider export
     - session_projection_window(session_id, start_index, count)
     - session_projection_attach/detach       → live watch + coalesced
       "session-rows-appended" events
   Rows are append-only and keyed by seq, so measured heights never
   invalidate — the height cache is permanent per (session, seq). Only the
   live tail row mutates until its item seals. */

const ROW_ESTIMATE_PX = 44;
const OVERSCAN_ROWS = 12;
const WINDOW_FETCH_SIZE = 80;

export default function SessionTranscript({ session }) {
  const sessionId = session?.id || "";
  const scrollerRef = useRef(null);
  const [totalRows, setTotalRows] = useState(0);
  const [liveTail, setLiveTail] = useState(null);
  const [windowState, setWindowState] = useState({ start: 0, rows: [] });
  const [loadState, setLoadState] = useState("loading"); // loading | ready | empty | error
  const heightsRef = useRef(new Map()); // seq -> measured px
  const stickBottomRef = useRef(true);
  const fetchInFlightRef = useRef(false);

  const fetchWindow = useCallback(async (startIndex) => {
    if (!sessionId || fetchInFlightRef.current) {
      return;
    }
    fetchInFlightRef.current = true;
    try {
      const result = await invoke("session_projection_window", {
        session_id: sessionId,
        start_index: Math.max(0, startIndex),
        count: WINDOW_FETCH_SIZE,
      });
      setTotalRows(Number(result?.total_rows) || 0);
      setLiveTail(result?.live_tail || null);
      setWindowState({
        start: Number(result?.start_index) || 0,
        rows: Array.isArray(result?.rows) ? result.rows : [],
      });
    } catch {
      // window fetch failures are transient; appended events retrigger
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [sessionId]);

  /* Session lifecycle: ensure cold projection, attach live feed. */
  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }
    let disposed = false;
    heightsRef.current = new Map();
    stickBottomRef.current = true;
    setLoadState("loading");
    setWindowState({ start: 0, rows: [] });
    setLiveTail(null);

    (async () => {
      try {
        const total = Number(await invoke("session_projection_ensure", {
          session_id: sessionId,
        })) || 0;
        if (disposed) return;
        setTotalRows(total);
        setLoadState(total > 0 ? "ready" : "empty");
        await fetchWindow(Math.max(0, total - WINDOW_FETCH_SIZE));
        // A quick view switch during the awaits above must not spawn a live
        // feed nobody owns — re-check, and compensate if attach raced close.
        if (disposed) return;
        await invoke("session_projection_attach", { session_id: sessionId });
        if (disposed) {
          void invoke("session_projection_detach", { session_id: sessionId }).catch(() => {});
        }
      } catch {
        if (!disposed) setLoadState("error");
      }
    })();

    let unlisten = null;
    void listen("session-rows-appended", (event) => {
      const payload = event?.payload || {};
      if (disposed || payload.session_id !== sessionId) {
        return;
      }
      setTotalRows(Number(payload.total_rows) || 0);
      setLiveTail(payload.live_tail || null);
      setLoadState("ready");
      if (stickBottomRef.current) {
        void fetchWindow(Math.max(0, (Number(payload.total_rows) || 0) - WINDOW_FETCH_SIZE));
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
      void invoke("session_projection_detach", { session_id: sessionId }).catch(() => {});
    };
  }, [sessionId, fetchWindow]);

  /* Stick-to-bottom bookkeeping + top-edge fetch for scrollback. */
  const onScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickBottomRef.current = distanceFromBottom < 60;
    if (node.scrollTop < ROW_ESTIMATE_PX * 4 && windowState.start > 0) {
      void fetchWindow(Math.max(0, windowState.start - Math.floor(WINDOW_FETCH_SIZE / 2)));
    }
  }, [fetchWindow, windowState.start]);

  useEffect(() => {
    if (!stickBottomRef.current) return;
    const node = scrollerRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [windowState, liveTail]);

  const measureRow = useCallback((seq, element) => {
    if (element && !heightsRef.current.has(seq)) {
      heightsRef.current.set(seq, element.offsetHeight);
    }
  }, []);

  /* Spacer heights from the permanent cache (estimate for unmeasured). */
  const heightFor = (index) => {
    return ROW_ESTIMATE_PX;
  };
  const topSpacer = Array.from({ length: windowState.start }, (_, i) => heightFor(i))
    .reduce((sum, h) => sum + h, 0);
  const rowsBelow = Math.max(0, totalRows - windowState.start - windowState.rows.length);
  const bottomSpacer = rowsBelow * ROW_ESTIMATE_PX;

  if ((loadState === "error" || loadState === "empty") && !liveTail && !windowState.rows.length) {
    // A missing/empty projection is a normal state for young or unbound
    // sessions — show a quiet empty chat, never a hard error wall.
    return (
      <TranscriptNotice data-quiet="true">
        No messages here yet — send one below, or open the Shell view.
      </TranscriptNotice>
    );
  }

  return (
    <TranscriptScroller onScroll={onScroll} ref={scrollerRef}>
      {topSpacer > 0 && <div aria-hidden="true" style={{ height: topSpacer }} />}
      {windowState.rows.filter((row) => row.kind !== "usage").map((row) => (
        <TranscriptRow
          data-kind={row.kind || "message"}
          data-role={row.role || ""}
          key={`${row.seq}:${row.ordinal || 0}`}
          ref={(element) => measureRow(`${row.seq}:${row.ordinal || 0}`, element)}
        >
          <RowBody data-kind={row.kind || "message"} data-role={row.role || ""}>
            {row.kind === "tool" ? (
              <ToolChipRow title={row.text}>
                <ToolChipTag>tool</ToolChipTag>
                <span>{row.text}</span>
              </ToolChipRow>
            ) : (
              <RowText>{row.text}</RowText>
            )}
          </RowBody>
        </TranscriptRow>
      ))}
      {liveTail && (
        <TranscriptRow data-kind="live" data-role={liveTail.role || "assistant"}>
          <RowBody data-kind="message" data-role={liveTail.role || "assistant"}>
            <RowText>
              {liveTail.text}
              <LiveCaret aria-hidden="true" />
            </RowText>
          </RowBody>
        </TranscriptRow>
      )}
      {bottomSpacer > 0 && <div aria-hidden="true" style={{ height: bottomSpacer }} />}
    </TranscriptScroller>
  );
}

const TranscriptScroller = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 14px 6px;
`;

const TranscriptRow = styled.div`
  display: flex;
  padding: 3px 0;

  &[data-role="user"] {
    justify-content: flex-end;
  }
`;

const RowBody = styled.div`
  max-width: 76%;
  min-width: 0;

  &[data-role="user"] {
    padding: 7px 11px;
    border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.28);
    border-radius: 12px 12px 4px 12px;
    background: rgba(var(--forge-tint-rgb), 0.12);
  }

  &[data-role="assistant"] {
    padding: 2px 0;
  }

  &[data-kind="tool"] {
    max-width: 100%;
  }
`;

const RowText = styled.div`
  color: var(--forge-text);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const ToolChipRow = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 4px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: var(--forge-surface);
  color: var(--forge-text-soft);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const ToolChipTag = styled.em`
  flex: 0 0 auto;
  color: var(--forge-amber);
  font-size: 9px;
  font-style: normal;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const LiveCaret = styled.span`
  display: inline-block;
  width: 7px;
  height: 13px;
  margin-left: 3px;
  vertical-align: -2px;
  background: var(--forge-ember);
  animation: session-caret-blink 1s steps(2) infinite;

  @keyframes session-caret-blink {
    50% {
      opacity: 0;
    }
  }
`;

const TranscriptNotice = styled.div`
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--forge-text-muted);
  font-size: 12px;

  &[data-quiet="true"] {
    color: var(--forge-text-disabled);
  }
`;
