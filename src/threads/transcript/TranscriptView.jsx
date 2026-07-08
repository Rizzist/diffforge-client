// The rebuilt transcript view: turn-folded, virtualized rendering of the
// durable-record transcript items.
//
// - @tanstack/react-virtual virtualizes the row list against the panel's
//   scroll container (passed in via scrollRef): rows absolutely position
//   inside TranscriptCanvas offset by scrollMargin, and an anchor-to-top end
//   spacer sizes the canvas while a turn is running.
// - Turns fold t3-style: settled turns collapse to a "Worked for ..." header
//   while the user prompt and the final assistant answer stay visible. The
//   active/latest turn is always expanded; sessions open with prior turns
//   folded.
// - While a turn is running, the latest user row is pinned to the viewport
//   top with a computed end spacer, so the existing stick-to-bottom logic
//   lands the fresh turn at the top of the viewport (t3's send feel).
// - External navigation (the message rail in dashboard.js) can scroll to any
//   source item by dispatching `diffforge:transcript-scroll-to-item` on the
//   scroll container with `detail.domId`; folded turns auto-expand.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  buildTranscriptRows,
  extractTurnDiffs,
  extractTurnSummaries,
  rowHeightEstimate,
  transcriptArray,
  usageTotalsByTurn,
} from "./builders.mjs";
import { TranscriptRowBody, WorkingRow } from "./TranscriptRows";
import {
  RowEnter,
  TranscriptCanvas,
  TranscriptColumn,
  TranscriptEmpty,
  TranscriptRowShell,
  TranscriptStaticList,
} from "./styles";

export const TRANSCRIPT_SCROLL_TO_ITEM_EVENT = "diffforge:transcript-scroll-to-item";

const WORKING_ROW_KEY = "__transcript-working";
const EMPTY_EXPANDED_SET = new Set();
// Bottom padding of TranscriptColumn plus breathing room, used when sizing
// the anchor-to-top end spacer.
const COLUMN_BOTTOM_PAD_PX = 40;

function rowSpacing(row = {}) {
  switch (row.kind) {
    case "tool":
    case "reasoning":
    case "subagent-note":
    case "fold":
    case "command":
      return "tight";
    case "working":
      return "none";
    default:
      return "";
  }
}

// Entrance animation captured once per row instance: the animation class is
// fixed at mount, so parent re-renders (which later mark the key as animated)
// never cut a playing animation short.
function RowEnterOnce({ animate = false, children }) {
  const [initialAnimate] = useState(animate);
  return <RowEnter $animate={initialAnimate}>{children}</RowEnter>;
}

function rowContainsDomId(row, domId) {
  if (!row || !domId) return false;
  if (row.domId === domId) return true;
  if (row.kind === "subagent-group") {
    // Subagent groups can nest (parent_id chains) — recurse.
    return transcriptArray(row.childRows).some((child) => rowContainsDomId(child, domId));
  }
  return false;
}

function groupContainsDomId(group, domId) {
  if (!group || !domId) return false;
  const scan = (rows) => transcriptArray(rows).some((row) => rowContainsDomId(row, domId));
  if (group.divider) return scan(group.rows);
  return scan(group.anchorRows) || scan(group.workRows) || scan(group.tailRows);
}

export const AgentTranscript = memo(function AgentTranscript({
  items = [],
  diffSummaries = [],
  messages = [],
  emptyLabel = "No synced chat records yet.",
  itemIdPrefix = "agent-thread-item",
  windowKey = "",
  scrollRef = null,
  busy = false,
  workingLabel = "Working",
  workingStartedAtMs = 0,
  onFetchTruncated = null,
  // Height (px) of any overlay chrome floating over the scroller's top edge
  // (e.g. the terminal-chat header bar). The anchor-to-top end spacer treats
  // the viewport as starting below this inset so anchored user prompts are
  // never hidden behind the overlay.
  anchorTopInsetPx = 0,
  // Optional (action, message, contentText) callback enabling user-bubble
  // affordances (Edit / Resend / Continue) on interrupted/queued/failed rows.
  onUserMessageAction = null,
  // The current session's id(s); subagent rows whose session reference
  // matches are treated as local (no "Open session" chip).
  sessionId = "",
  // Optional (sessionRef) => void wiring the subagent "Open session" chip to
  // the host's session-open navigation.
  onOpenSession = null,
}) {
  const safeItems = useMemo(() => transcriptArray(items), [items]);
  const turnSummaries = useMemo(() => extractTurnSummaries(messages), [messages]);
  const turnDiffs = useMemo(() => extractTurnDiffs(messages), [messages]);
  const usageByTurn = useMemo(() => usageTotalsByTurn(messages), [messages]);

  // Fold state is keyed by windowKey so switching sessions resets it and
  // sessions open with prior turns folded.
  const [foldState, setFoldState] = useState(() => ({ key: windowKey, expanded: EMPTY_EXPANDED_SET }));
  const expandedTurnKeys = foldState.key === windowKey ? foldState.expanded : EMPTY_EXPANDED_SET;
  const toggleTurn = useCallback((groupKey) => {
    if (!groupKey) return;
    setFoldState((current) => {
      const expanded = new Set(current.key === windowKey ? current.expanded : []);
      if (expanded.has(groupKey)) {
        expanded.delete(groupKey);
      } else {
        expanded.add(groupKey);
      }
      return { key: windowKey, expanded };
    });
  }, [windowKey]);

  // Per-row disclosure state (tool/reasoning/file-change expansion) is hoisted
  // here, keyed by row key, so virtualized unmounts never lose it.
  const [rowOpenState, setRowOpenState] = useState(() => ({ key: windowKey, open: EMPTY_EXPANDED_SET }));
  const openRowKeys = rowOpenState.key === windowKey ? rowOpenState.open : EMPTY_EXPANDED_SET;
  const toggleRowOpen = useCallback((rowKey) => {
    if (!rowKey) return;
    setRowOpenState((current) => {
      const open = new Set(current.key === windowKey ? current.open : []);
      if (open.has(rowKey)) {
        open.delete(rowKey);
      } else {
        open.add(rowKey);
      }
      return { key: windowKey, open };
    });
  }, [windowKey]);
  // Batch setter (expand-all / collapse-all in the file-change card).
  const setRowsOpen = useCallback((rowKeys, openValue) => {
    const keys = Array.isArray(rowKeys) ? rowKeys.filter(Boolean) : [];
    if (!keys.length) return;
    setRowOpenState((current) => {
      const open = new Set(current.key === windowKey ? current.open : []);
      keys.forEach((key) => {
        if (openValue) {
          open.add(key);
        } else {
          open.delete(key);
        }
      });
      return { key: windowKey, open };
    });
  }, [windowKey]);

  const built = useMemo(() => buildTranscriptRows(safeItems, {
    itemIdPrefix,
    diffSummaries,
    turnSummaries,
    turnDiffs,
    usageByTurn,
    expandedTurnKeys,
    busy,
    sessionId,
  }), [busy, diffSummaries, expandedTurnKeys, itemIdPrefix, safeItems, sessionId, turnDiffs, turnSummaries, usageByTurn]);

  const rows = useMemo(() => {
    if (!busy || !built.rows.length) return built.rows;
    return [...built.rows, { kind: "working", key: WORKING_ROW_KEY }];
  }, [built.rows, busy]);

  // Rows in the active turn render markdown in "live" mode (highlighting
  // bypassed while the message is still updating).
  const liveGroupKey = busy ? built.latestGroupKey : "";

  // Entrance animation only for rows appended to the live turn. Keys are
  // marked animated after their first committed render, so scroll-away/back
  // remounts within one window never re-animate.
  const seenKeysRef = useRef(new Set());
  const animatedKeysRef = useRef(new Set());
  const enterKeys = useMemo(() => {
    const seen = seenKeysRef.current;
    const fresh = new Set();
    const initial = seen.size === 0;
    rows.forEach((row) => {
      if (!seen.has(row.key)) {
        seen.add(row.key);
        if (!initial && row.groupKey && row.groupKey === liveGroupKey) {
          fresh.add(row.key);
        }
      }
    });
    return fresh;
  }, [liveGroupKey, rows]);
  useEffect(() => {
    enterKeys.forEach((key) => animatedKeysRef.current.add(key));
  }, [enterKeys]);
  useEffect(() => {
    seenKeysRef.current = new Set();
    animatedKeysRef.current = new Set();
  }, [windowKey]);

  // Re-render once after mount so the virtualizer picks up the scroll
  // container ref (ancestor refs attach after child effects on first mount).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const canvasRef = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const refreshScrollMargin = useCallback(() => {
    const canvas = canvasRef.current;
    const scroller = scrollRef?.current;
    if (!canvas || !scroller) return;
    const margin = Math.max(
      0,
      Math.round(
        canvas.getBoundingClientRect().top
          - scroller.getBoundingClientRect().top
          + scroller.scrollTop,
      ),
    );
    setScrollMargin((current) => (Math.abs(current - margin) > 1 ? margin : current));
  }, [scrollRef]);
  useLayoutEffect(() => {
    refreshScrollMargin();
  }, [mounted, refreshScrollMargin, rows.length, windowKey]);
  // Layout above the list can change without the row count changing (error
  // hints, load-older buttons, header reflow): watch the scroller, the
  // canvas's offset parent and the scroller's non-transcript children, and
  // re-attach when those children mount or unmount, so scrollMargin never
  // goes stale.
  useEffect(() => {
    const scroller = scrollRef?.current;
    if (!canvasRef.current || !scroller || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => refreshScrollMargin());
    const observeTargets = () => {
      observer.disconnect();
      observer.observe(scroller);
      const canvas = canvasRef.current;
      const offsetParent = canvas?.offsetParent;
      if (offsetParent && offsetParent !== scroller) {
        observer.observe(offsetParent);
      }
      Array.from(scroller.children).forEach((child) => {
        if (canvas && !child.contains(canvas)) {
          observer.observe(child);
        }
      });
    };
    observeTargets();
    let mutations = null;
    if (typeof MutationObserver !== "undefined") {
      mutations = new MutationObserver(() => {
        observeTargets();
        refreshScrollMargin();
      });
      mutations.observe(scroller, { childList: true });
    }
    return () => {
      observer.disconnect();
      mutations?.disconnect();
    };
  }, [mounted, refreshScrollMargin, scrollRef, windowKey]);

  const getScrollElement = useCallback(() => scrollRef?.current || null, [scrollRef]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => rowHeightEstimate(rows[index] || {}),
    getItemKey: (index) => `${windowKey}:${rows[index]?.key ?? index}`,
    getScrollElement,
    overscan: 6,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Prepend restore ("load earlier"): anchor to the previous first row's key
  // instead of trusting scroll-height deltas over estimated rows. Viewports
  // already scrolled past the old first row keep their offset via the
  // prepended span instead.
  const prependAnchorRef = useRef({ key: "", firstRowKey: "" });
  useLayoutEffect(() => {
    const previous = prependAnchorRef.current;
    const firstRowKey = rows.length ? rows[0].key : "";
    prependAnchorRef.current = { key: windowKey, firstRowKey };
    if (previous.key !== windowKey || !previous.firstRowKey || previous.firstRowKey === firstRowKey) {
      return;
    }
    if (!scrollRef?.current) return;
    const index = rows.findIndex((row) => row.key === previous.firstRowKey);
    if (index <= 0) return;
    const measurement = virtualizer.measurementsCache?.[index];
    if (!measurement) return;
    const offset = virtualizer.scrollOffset ?? 0;
    if (offset <= measurement.end) {
      virtualizer.scrollToIndex(index, { align: "start" });
    } else {
      virtualizer.scrollToOffset(offset + Math.max(0, measurement.start - scrollMargin));
    }
  }, [rows, scrollMargin, scrollRef, virtualizer, windowKey]);

  // Anchor-new-turn-to-top: while the latest turn is running, size an end
  // spacer so "scroll to bottom" lands with the turn's user prompt at the
  // top of the visible viewport (below any overlay chrome measured by
  // anchorTopInsetPx: effectiveHeight = clientHeight - inset).
  let endSpacer = 0;
  let endSpacerMeasured = false;
  if (busy) {
    let anchorIndex = -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].kind === "user" && rows[index].groupKey === built.latestGroupKey) {
        anchorIndex = index;
        break;
      }
    }
    const scroller = scrollRef?.current;
    const anchorMeasurement = anchorIndex >= 0 ? virtualizer.measurementsCache?.[anchorIndex] : null;
    if (scroller && anchorMeasurement) {
      const anchorStartInCanvas = anchorMeasurement.start - scrollMargin;
      const below = totalSize - anchorStartInCanvas;
      const topInset = Math.max(0, Math.round(Number(anchorTopInsetPx) || 0));
      endSpacer = Math.max(0, Math.round((scroller.clientHeight - topInset) - below - COLUMN_BOTTOM_PAD_PX));
      endSpacerMeasured = true;
    }
  }

  // External scroll-to-item requests (message rail); folded turns expand
  // first, then the row scrolls into view on the next layout pass.
  const [pendingScrollDomId, setPendingScrollDomId] = useState("");
  useEffect(() => {
    const scroller = scrollRef?.current;
    if (!scroller) return undefined;
    const handler = (event) => {
      const domId = event?.detail?.domId;
      if (!domId) return;
      const foldedGroup = transcriptArray(built.groups).find((group) => (
        !group.divider && groupContainsDomId(group, domId)
      ));
      if (foldedGroup && foldedGroup.key !== built.latestGroupKey && !expandedTurnKeys.has(foldedGroup.key)) {
        toggleTurn(foldedGroup.key);
      }
      setPendingScrollDomId(domId);
    };
    scroller.addEventListener(TRANSCRIPT_SCROLL_TO_ITEM_EVENT, handler);
    return () => scroller.removeEventListener(TRANSCRIPT_SCROLL_TO_ITEM_EVENT, handler);
  }, [built.groups, built.latestGroupKey, expandedTurnKeys, scrollRef, toggleTurn]);
  useEffect(() => {
    if (!pendingScrollDomId) return;
    const index = rows.findIndex((row) => rowContainsDomId(row, pendingScrollDomId));
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "center" });
    }
    setPendingScrollDomId("");
  }, [pendingScrollDomId, rows, virtualizer]);

  if (!safeItems.length) {
    return <TranscriptEmpty>{emptyLabel}</TranscriptEmpty>;
  }

  const hasScroller = Boolean(scrollRef?.current);
  if (!hasScroller && !mounted) {
    // First paint before the scroll container ref is attached: render nothing
    // heavy; the post-mount re-render virtualizes.
    return <TranscriptColumn />;
  }

  if (!hasScroller) {
    // Defensive fallback: no scroll container available, render statically.
    return (
      <TranscriptColumn>
        <TranscriptStaticList>
          {rows.map((row) => (
            <TranscriptRowShell
              $spacing={rowSpacing(row)}
              id={row.domId || undefined}
              key={row.key}
              style={{ position: "static" }}
            >
              {row.kind === "working" ? (
                <WorkingRow label={workingLabel} startedAtMs={workingStartedAtMs} />
              ) : (
                <TranscriptRowBody
                  live={row.groupKey === liveGroupKey && Boolean(liveGroupKey)}
                  onFetchTruncated={onFetchTruncated}
                  onOpenSession={onOpenSession}
                  onSetRowsOpen={setRowsOpen}
                  onToggleRowOpen={toggleRowOpen}
                  onToggleTurn={toggleTurn}
                  onUserMessageAction={onUserMessageAction}
                  openRowKeys={openRowKeys}
                  row={row}
                />
              )}
            </TranscriptRowShell>
          ))}
        </TranscriptStaticList>
      </TranscriptColumn>
    );
  }

  return (
    <TranscriptColumn>
      <TranscriptCanvas
        data-transcript-end-spacer={endSpacerMeasured ? endSpacer : undefined}
        ref={canvasRef}
        style={{ height: `${totalSize + endSpacer}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) return null;
          const live = Boolean(liveGroupKey) && row.groupKey === liveGroupKey;
          return (
            <TranscriptRowShell
              $spacing={rowSpacing(row)}
              data-index={virtualItem.index}
              id={row.domId || undefined}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualItem.start - scrollMargin}px)` }}
            >
              {row.kind === "working" ? (
                <WorkingRow label={workingLabel} startedAtMs={workingStartedAtMs} />
              ) : (
                <RowEnterOnce animate={enterKeys.has(row.key) && !animatedKeysRef.current.has(row.key)}>
                  <TranscriptRowBody
                    live={live}
                    onFetchTruncated={onFetchTruncated}
                    onOpenSession={onOpenSession}
                    onSetRowsOpen={setRowsOpen}
                    onToggleRowOpen={toggleRowOpen}
                    onToggleTurn={toggleTurn}
                    onUserMessageAction={onUserMessageAction}
                    openRowKeys={openRowKeys}
                    row={row}
                  />
                </RowEnterOnce>
              )}
            </TranscriptRowShell>
          );
        })}
      </TranscriptCanvas>
    </TranscriptColumn>
  );
});
