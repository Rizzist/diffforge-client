import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";

/* Virtualized transcript for the session UI view, fed by the Rust
   projection store (haider_projection.rs):
     - session_projection_ensure(session_id)  → cold fold via haider export
     - session_projection_window(session_id, start_index, count)
     - session_projection_attach/detach       → live watch + coalesced
       "session-rows-appended" events
   Rows are append-only and keyed by seq, so measured heights never
   invalidate — the height cache is permanent per (session, seq). Only the
   live tail row mutates until its item seals.

   Rendering groups the flat rows into turn blocks: a user bubble opens a
   turn; consecutive tool rows collapse into ONE cluster card (named,
   status-colored, expandable — auto-expanded when anything failed). Tool
   identity comes from row.meta (the full pipe/export item rides every row),
   never from the lossy summary text alone. */

const ROW_ESTIMATE_PX = 44;
const OVERSCAN_ROWS = 12;
const WINDOW_FETCH_SIZE = 80;

/* ---- tool row interpretation ------------------------------------------ */

function toolNameOf(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  for (const key of ["name", "tool", "command", "path", "call_id"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  // Live-fold text leads with the name ("name · status · summary").
  const lead = String(row?.text || "").split("·")[0].trim();
  if (lead && !/^tool call settled/i.test(lead) && lead.length <= 48) {
    return lead;
  }
  return "tool";
}

function toolStatusOf(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  let raw = "";
  for (const key of ["status", "phase", "outcome"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      raw = value;
      break;
    }
  }
  if (!raw) {
    const settled = /settled as ([a-z]+)/i.exec(String(row?.text || ""));
    if (settled) raw = settled[1];
  }
  const status = raw.toLowerCase();
  if (/^(completed?|success|succeeded|ok|done)$/.test(status)) return "ok";
  if (/^(failed?|failure|error|errored)$/.test(status)) return "failed";
  if (/^(cancell?ed|aborted)$/.test(status)) return "cancelled";
  if (/^(running|in_progress|pending|started|active)$/.test(status)) return "running";
  return "ok";
}

const TOOL_STATUS_LABEL = {
  ok: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  running: "Running",
};

/* Secondary dim detail: what the call touched. Sidecar v3 (0.0.934) ships
   args_preview/result_preview on cold rows; live meta may carry the raw keys. */
function toolDetailOf(row, name) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  for (const key of ["args_preview", "command", "path", "query", "url", "prompt", "summary"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim() && value.trim() !== name
      && !/^tool call settled/i.test(value)) {
      return value.trim();
    }
  }
  if (meta.args && typeof meta.args === "object") {
    try {
      return JSON.stringify(meta.args);
    } catch {
      return "";
    }
  }
  return "";
}

/* Cold history rows carry only the export turn envelope (plus, from sidecar
   v3, capped previews); anything beyond these keys means the live watch
   recorded the full call item. Thin rows go through the item detail door. */
const THIN_META_KEYS = new Set([
  "role", "name", "summary", "at_ms", "seq", "ordinal", "branch_id",
  "kind", "type", "status", "item", "args_preview", "result_preview",
]);

function toolMetaIsRich(row) {
  const meta = row?.meta;
  if (!meta || typeof meta !== "object") return false;
  return Object.keys(meta).some((key) => !THIN_META_KEYS.has(key));
}

function iconKindOf(name) {
  const id = String(name || "").toLowerCase();
  if (/web|fetch|http|search|url/.test(id)) return "globe";
  if (/^fs|file|read|write|edit|glob|grep|path|patch/.test(id)) return "file";
  if (/shell|bash|command|exec|terminal|process/.test(id)) return "terminal";
  if (/child|agent|task|spawn|subagent|workflow/.test(id)) return "spark";
  if (/compact|context|archive/.test(id)) return "box";
  return "gear";
}

function ToolIcon({ name }) {
  const kind = iconKindOf(name);
  return (
    <IconSvg viewBox="0 0 16 16" aria-hidden="true">
      {kind === "globe" && (
        <>
          <circle cx="8" cy="8" r="6.2" />
          <ellipse cx="8" cy="8" rx="2.8" ry="6.2" />
          <path d="M2 8h12" />
        </>
      )}
      {kind === "file" && (
        <>
          <path d="M4 1.8h5.2L12 4.6v9.6H4z" strokeLinejoin="round" />
          <path d="M9.2 1.8v2.8H12" strokeLinejoin="round" />
        </>
      )}
      {kind === "terminal" && (
        <>
          <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" />
          <path d="M4.6 6l2.4 2-2.4 2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.6 10.4h2.8" strokeLinecap="round" />
        </>
      )}
      {kind === "spark" && (
        <path
          d="M8 1.5l1.5 4.6L14 8l-4.5 1.9L8 14.5 6.5 9.9 2 8l4.5-1.9z"
          fill="currentColor"
          stroke="none"
        />
      )}
      {kind === "box" && (
        <>
          <rect x="2" y="5" width="12" height="8.6" rx="1.4" />
          <path d="M2.6 5l1.2-2.4h8.4L13.4 5M6.4 8h3.2" strokeLinecap="round" />
        </>
      )}
      {kind === "gear" && (
        <>
          <circle cx="8" cy="8" r="2.4" />
          <path
            d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.7 3.7l1.5 1.5M10.8 10.8l1.5 1.5M12.3 3.7l-1.5 1.5M5.2 10.8l-1.5 1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </IconSvg>
  );
}

function timeShort(atMs) {
  if (!Number.isFinite(atMs) || atMs <= 0) return "";
  return new Date(atMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(atMs) {
  return new Date(atMs).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/* Flat window rows → render blocks. Consecutive tool rows fuse into one
   cluster; day dividers slot in where the calendar date changes. Cluster
   keys pin to the FIRST row's identity — append-only rows keep them stable
   so React state (expansion) survives live growth. */
function buildBlocks(rows) {
  const blocks = [];
  let lastDay = "";
  for (const row of rows) {
    if (row.kind === "usage") continue;
    if (Number.isFinite(row.at_ms) && row.at_ms > 0) {
      const day = new Date(row.at_ms).toDateString();
      if (day !== lastDay) {
        if (lastDay) {
          blocks.push({ type: "day", key: `day:${row.seq}:${row.ordinal || 0}`, at_ms: row.at_ms });
        }
        lastDay = day;
      }
    }
    if (row.kind === "tool") {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "tools") {
        last.rows.push(row);
      } else {
        blocks.push({ type: "tools", key: `tools:${row.seq}:${row.ordinal || 0}`, rows: [row] });
      }
    } else {
      blocks.push({ type: "row", key: `${row.seq}:${row.ordinal || 0}`, row });
    }
  }
  return blocks;
}

/* ---- tool cluster card ------------------------------------------------ */

function ToolCluster({ rows, sessionId }) {
  const failedCount = rows.reduce(
    (count, row) => count + (toolStatusOf(row) === "failed" ? 1 : 0),
    0,
  );
  const [open, setOpen] = useState(failedCount > 0 || rows.length === 1);
  const [detailKey, setDetailKey] = useState("");
  const [detailDocs, setDetailDocs] = useState({}); // key -> {state, doc}
  useEffect(() => {
    // A failure arriving in a live cluster must surface itself.
    if (failedCount > 0) setOpen(true);
  }, [failedCount]);

  /* Thin rows fetch the full item through the 0.0.934 detail door on first
     open (haider session <id> item <seq> --json); pre-934 harnesses fall
     back to the sidecar previews or the honest note. */
  const toggleDetail = (row, key) => {
    if (detailKey === key) {
      setDetailKey("");
      return;
    }
    setDetailKey(key);
    if (toolMetaIsRich(row) || detailDocs[key]) return;
    setDetailDocs((current) => ({ ...current, [key]: { state: "loading" } }));
    invoke("session_item_get", { session_id: sessionId, seq: row.seq })
      .then((doc) => {
        const ok = doc && doc.schema === "haider.item.v1";
        setDetailDocs((current) => ({
          ...current,
          [key]: ok ? { state: "ok", doc } : { state: "error" },
        }));
      })
      .catch(() => {
        setDetailDocs((current) => ({ ...current, [key]: { state: "error" } }));
      });
  };

  const counts = { ok: 0, failed: 0, cancelled: 0, running: 0 };
  for (const row of rows) {
    counts[toolStatusOf(row)] += 1;
  }

  return (
    <ClusterCard data-failed={failedCount > 0}>
      {rows.length > 1 && (
        <ClusterHead
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <Chevron data-open={open} aria-hidden="true" />
          <span>{rows.length} tool calls</span>
          {counts.ok > 0 && <CountTag data-status="ok">{counts.ok} ok</CountTag>}
          {counts.failed > 0 && <CountTag data-status="failed">{counts.failed} failed</CountTag>}
          {counts.cancelled > 0 && (
            <CountTag data-status="cancelled">{counts.cancelled} cancelled</CountTag>
          )}
          {counts.running > 0 && <CountTag data-status="running">{counts.running} running</CountTag>}
        </ClusterHead>
      )}
      {open && (
        <ClusterRows>
          {rows.map((row) => {
            const key = `${row.seq}:${row.ordinal || 0}`;
            const name = toolNameOf(row);
            const status = toolStatusOf(row);
            const detail = toolDetailOf(row, name);
            const detailOpen = detailKey === key;
            const fetched = detailDocs[key];
            const previewFallback = [row.meta?.args_preview, row.meta?.result_preview]
              .filter((value) => typeof value === "string" && value.trim())
              .join("\n→ ");
            return (
              <ClusterRowWrap key={key}>
                <ClusterRow
                  data-status={status}
                  onClick={() => toggleDetail(row, key)}
                  type="button"
                >
                  <ToolIcon name={name} />
                  <ToolName>{name}</ToolName>
                  {detail && <ToolDetail>{detail}</ToolDetail>}
                  <StatusWord data-status={status}>{TOOL_STATUS_LABEL[status]}</StatusWord>
                  <ToolTime>{timeShort(row.at_ms)}</ToolTime>
                </ClusterRow>
                {detailOpen && (
                  toolMetaIsRich(row) ? (
                    <DetailPre>
                      {JSON.stringify(row.meta, null, 1).slice(0, 4000)}
                    </DetailPre>
                  ) : fetched?.state === "ok" ? (
                    <DetailPre>
                      {JSON.stringify(fetched.doc, null, 1).slice(0, 4000)}
                    </DetailPre>
                  ) : fetched?.state === "loading" ? (
                    <DetailNote>fetching call details…</DetailNote>
                  ) : previewFallback ? (
                    <DetailPre>{previewFallback}</DetailPre>
                  ) : (
                    <DetailNote>
                      Full call details aren’t carried in cold history — live
                      sessions record them.
                    </DetailNote>
                  )
                )}
              </ClusterRowWrap>
            );
          })}
        </ClusterRows>
      )}
    </ClusterCard>
  );
}

/* ---- transcript ------------------------------------------------------- */

export default function SessionTranscript({ session, runStatus = "", onSyncingChange }) {
  const sessionId = session?.id || "";
  const scrollerRef = useRef(null);
  const [totalRows, setTotalRows] = useState(0);
  const [liveTail, setLiveTail] = useState(null);
  const [windowState, setWindowState] = useState({ start: 0, rows: [] });
  const [loadState, setLoadState] = useState("loading"); // loading | ready | empty | error
  const [caughtUp, setCaughtUp] = useState(true);
  /* Additive sync lift (Session Deck): report whether this projection is
     still catching up — cold load or a live fold gap — so the shell's rail
     pill can show it. Read through a ref so an inline callback prop can't
     retrigger the effect; unmount reports false (a hidden transcript is not
     syncing anything the shell should show). Nothing else here changes. */
  const onSyncingChangeRef = useRef(onSyncingChange);
  onSyncingChangeRef.current = onSyncingChange;
  const syncing = loadState === "loading" || !caughtUp;
  useEffect(() => {
    onSyncingChangeRef.current?.(syncing);
  }, [syncing]);
  useEffect(() => () => {
    onSyncingChangeRef.current?.(false);
  }, []);
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
      setCaughtUp(result?.caught_up !== false);
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
  }, [windowState, liveTail, runStatus]);

  const measureRow = useCallback((key, element) => {
    if (element && !heightsRef.current.has(key)) {
      heightsRef.current.set(key, element.offsetHeight);
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

  const blocks = useMemo(() => buildBlocks(windowState.rows), [windowState.rows]);

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
      {!caughtUp && (
        <SyncHint aria-live="polite">syncing history…</SyncHint>
      )}
      {topSpacer > 0 && <div aria-hidden="true" style={{ height: topSpacer }} />}
      {blocks.map((block) => {
        if (block.type === "day") {
          return (
            <DayDivider key={block.key} aria-hidden="true">
              <span>{dayLabel(block.at_ms)}</span>
            </DayDivider>
          );
        }
        if (block.type === "tools") {
          return (
            <TranscriptRow
              data-kind="tool"
              data-role="tool"
              key={block.key}
              ref={(element) => measureRow(block.key, element)}
            >
              <RowBody data-kind="tool" data-role="tool">
                <ToolCluster rows={block.rows} sessionId={sessionId} />
              </RowBody>
            </TranscriptRow>
          );
        }
        const row = block.row;
        return (
          <TranscriptRow
            data-kind={row.kind || "message"}
            data-role={row.role || ""}
            key={block.key}
            ref={(element) => measureRow(block.key, element)}
          >
            {row.role === "user" && (
              <TimeGhost aria-hidden="true">{timeShort(row.at_ms)}</TimeGhost>
            )}
            <RowBody data-kind={row.kind || "message"} data-role={row.role || ""}>
              {row.kind === "error" ? (
                <ErrorCard>
                  <ErrorTag>run failed</ErrorTag>
                  <RowText>{row.text}</RowText>
                </ErrorCard>
              ) : row.role === "assistant" ? (
                <MarkdownBody>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.text}</ReactMarkdown>
                </MarkdownBody>
              ) : (
                <RowText>{row.text}</RowText>
              )}
            </RowBody>
          </TranscriptRow>
        );
      })}
      {liveTail && (
        <TranscriptRow data-kind="live" data-role={liveTail.role || "assistant"}>
          <RowBody data-kind="message" data-role={liveTail.role || "assistant"}>
            <MarkdownBody>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveTail.text}</ReactMarkdown>
              <LiveCaret aria-hidden="true" />
            </MarkdownBody>
          </RowBody>
        </TranscriptRow>
      )}
      {!liveTail && runStatus && (
        <ShimmerRow aria-live="polite">
          <ShimmerDot aria-hidden="true" />
          <span>{runStatus}</span>
        </ShimmerRow>
      )}
      {bottomSpacer > 0 && <div aria-hidden="true" style={{ height: bottomSpacer }} />}
    </TranscriptScroller>
  );
}

const TranscriptScroller = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Session Deck measure: the scroller spans the pane (scrollbar at the
     edge) while its content centers on the shared ~54rem column the
     composer also uses. The side gutter SCALES — near-none when the pane
     is narrow, growing with width (to 56px) until the centering wins. */
  padding: 8px max(min(7%, 64px), calc((100% - 54rem) / 2)) 8px;
`;

const TranscriptRow = styled.div`
  position: relative;
  display: flex;
  padding: 5px 0;

  &[data-role="user"] {
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    padding-top: 18px;
  }
`;

const TimeGhost = styled.span`
  flex: 0 0 auto;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity 120ms ease;

  ${TranscriptRow}:hover & {
    opacity: 0.8;
  }
`;

const RowBody = styled.div`
  max-width: 76%;
  min-width: 0;

  &[data-role="user"] {
    max-width: min(64%, 60ch);
    padding: 8px 13px;
    border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.28);
    border-radius: 14px 14px 5px 14px;
    background: rgba(var(--forge-tint-rgb), 0.12);
  }

  &[data-role="assistant"] {
    max-width: min(76%, 72ch);
    padding: 2px 0 6px;
  }

  &[data-kind="tool"] {
    max-width: min(88%, 78ch);
    flex: 1;
  }

  &[data-kind="error"] {
    max-width: min(76%, 72ch);
  }
`;

/* Assistant messages render as markdown — readable measure, calm rhythm. */
const MarkdownBody = styled.div`
  color: var(--forge-text);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;

  > *:first-child { margin-top: 0; }
  > *:last-child { margin-bottom: 0; }

  p { margin: 0 0 10px; }
  ul, ol { margin: 6px 0 12px; padding-left: 22px; }
  li { margin: 3px 0; }
  li > p { margin: 0; }

  h1, h2, h3, h4, h5, h6 {
    margin: 16px 0 7px;
    font-weight: 700;
    line-height: 1.3;
  }
  h1 { font-size: 16px; }
  h2 { font-size: 15px; }
  h3 { font-size: 14px; }
  h4, h5, h6 { font-size: 13px; }

  strong { font-weight: 680; }

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--forge-surface-control, rgba(128, 128, 128, 0.14));
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11.5px;
  }

  pre {
    margin: 8px 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--forge-border);
    border-radius: 8px;
    background: var(--forge-surface);
    overflow-x: auto;

    code {
      padding: 0;
      border-radius: 0;
      background: transparent;
      font-size: 11.5px;
      line-height: 1.55;
    }
  }

  blockquote {
    margin: 8px 0 12px;
    padding: 2px 0 2px 12px;
    border-left: 2px solid var(--forge-border-strong);
    color: var(--forge-text-soft);
  }

  a {
    color: var(--forge-ember);
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }

  table {
    margin: 8px 0 12px;
    border-collapse: collapse;
    display: block;
    max-width: 100%;
    overflow-x: auto;
    font-size: 12px;
  }
  th, td {
    padding: 4px 10px;
    border: 1px solid var(--forge-border);
  }
  th {
    background: var(--forge-surface);
    font-weight: 650;
  }

  hr {
    margin: 12px 0;
    border: 0;
    border-top: 1px solid var(--forge-border);
  }
`;

const RowText = styled.div`
  color: var(--forge-text);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

/* ---- tool cluster styles ---------------------------------------------- */

const ClusterCard = styled.div`
  min-width: 0;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface);
  overflow: hidden;

  &[data-failed="true"] {
    border-color: color-mix(in srgb, var(--forge-red) 35%, var(--forge-border));
  }
`;

const ClusterHead = styled.button`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--forge-text-soft);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--forge-surface-hover);
  }
`;

const Chevron = styled.span`
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 5px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  opacity: 0.7;
  transition: transform 120ms ease;

  &[data-open="true"] {
    transform: rotate(90deg);
  }
`;

const CountTag = styled.span`
  font-weight: 650;

  &[data-status="ok"] { color: var(--forge-green); }
  &[data-status="failed"] { color: var(--forge-red); }
  &[data-status="cancelled"] { color: var(--forge-text-muted); }
  &[data-status="running"] { color: var(--forge-amber); }
`;

const ClusterRows = styled.div`
  display: flex;
  flex-direction: column;
`;

const ClusterRowWrap = styled.div`
  &:not(:last-child) {
    border-bottom: 1px solid var(--forge-border);
  }
`;

const ClusterRow = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: var(--forge-text-soft);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--forge-surface-hover);
  }
`;

const IconSvg = styled.svg`
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  color: var(--forge-text-muted);
`;

const ToolName = styled.span`
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--forge-text);
  font-weight: 640;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const ToolDetail = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const StatusWord = styled.span`
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;

  &[data-status="ok"] { color: var(--forge-green); }
  &[data-status="failed"] { color: var(--forge-red); }
  &[data-status="cancelled"] { color: var(--forge-text-muted); }
  &[data-status="running"] { color: var(--forge-amber); }
`;

const ToolTime = styled.span`
  flex: 0 0 auto;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
`;

const DetailPre = styled.pre`
  margin: 0;
  max-height: 220px;
  padding: 8px 12px 10px;
  overflow: auto;
  border-top: 1px dashed var(--forge-border);
  color: var(--forge-text-soft);
  background: var(--forge-bg-deep, transparent);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const DetailNote = styled.div`
  padding: 6px 12px 8px;
  border-top: 1px dashed var(--forge-border);
  color: var(--forge-text-muted);
  font-size: 10.5px;
  font-style: italic;
`;

/* ---- error / dividers / live ------------------------------------------ */

const ErrorCard = styled.div`
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 40%, var(--forge-border));
  border-left: 3px solid var(--forge-red);
  border-radius: 8px;
  background: color-mix(in srgb, var(--forge-red) 7%, var(--forge-surface));
`;

const ErrorTag = styled.div`
  margin-bottom: 3px;
  color: var(--forge-red);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const DayDivider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0 8px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;

  &::before,
  &::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--forge-border);
  }
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

const ShimmerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0 4px;
  color: var(--forge-text-muted);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
`;

const ShimmerDot = styled.span`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--forge-amber);
  animation: session-shimmer-pulse 1.2s ease-in-out infinite;

  @keyframes session-shimmer-pulse {
    50% {
      opacity: 0.25;
      transform: scale(0.8);
    }
  }
`;

const SyncHint = styled.div`
  position: sticky;
  top: 0;
  z-index: 2;
  width: fit-content;
  margin: 0 auto 4px;
  padding: 2px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: var(--forge-surface);
  font-size: 9.5px;
  font-weight: 600;
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
