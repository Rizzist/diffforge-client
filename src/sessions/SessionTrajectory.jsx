import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import { cacheRereadMetric } from "./cacheMetric.js";
import {
  exactTrajectoryUsagePoints,
  trajectoryDurationLabel,
  trajectorySummaryMetrics,
} from "./trajectoryMetrics.js";

/* Trajectory view: a canvas strip of the session's event stream (Input /
   Model / Tools lanes + a tokens bar lane), metrics header, and a synced
   detail list. Fed by session_projection_trajectory — lean points only,
   payloads never cross the wire. Usage rows fold into per-turn token/cache
   stats anchored to the preceding assistant event; cache-miss shading only
   appears when the harness actually reported cache counts. The header never
   derives a cache percentage from those counts: outside this UI, a labelled
   estimate is too easily mistaken for the harness measurement.

   The canvas is viewport-sized and sticky inside the scroller (a spacer div
   carries the logical width): browser canvases cap at ~32k device px, so a
   long session must never size the backing store — the visible x-window is
   repainted on scroll instead, which also keeps the lane labels pinned. */

const STEP_PX = 11;
const TURN_GAP_PX = 9;
const SQUARE_PX = 8;
const LANE_TOP = 8;
const LANE_H = 17;
const TOKEN_LANE_H = 22;
const STRIP_PAD = 10;
const LABEL_GUTTER = 54;
const STRIP_H = LANE_TOP + LANE_H * 3 + TOKEN_LANE_H + 8;
const LIST_ROW_PX = 26;
const CACHE_MISS_MIN_INPUT = 1000;
const TOOLTIP_CLAMP_PX = 150;

function formatTokens(n) {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatClock(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "";
  return new Date(Number(ms)).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function cssColor(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/* Lane + color class for one event point. */
function eventClass(point) {
  if (point.kind === "error") {
    return { lane: 1, color: "error" };
  }
  if (point.kind === "tool") {
    return { lane: 2, color: point.tool_status === "failed" ? "error" : "tool" };
  }
  if (point.role === "user") {
    return { lane: 0, color: "input" };
  }
  return { lane: 1, color: "model" };
}

export default function SessionTrajectory({ session }) {
  const sessionId = session?.id || "";
  // Absent and zero are different facts; see cacheMetric.js.
  const cacheMetric = cacheRereadMetric(session);
  const [points, setPoints] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [selectedKey, setSelectedKey] = useState(null);
  const [hover, setHover] = useState(null); // { x, point } — x in content coords
  const [paintTick, setPaintTick] = useState(0);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(300);
  const [durationNowMs, setDurationNowMs] = useState(() => Date.now());
  const canvasRef = useRef(null);
  const stripScrollRef = useRef(null);
  const listRef = useRef(null);
  const stickRightRef = useRef(true);
  const listStickRef = useRef(true);
  const scrollFrameRef = useRef(0);
  const refreshTimerRef = useRef(0);

  const repaint = useCallback(() => setPaintTick((t) => t + 1), []);

  const fetchTrajectory = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await invoke("session_projection_trajectory", {
        session_id: sessionId,
      });
      const next = Array.isArray(result?.points) ? result.points : [];
      setPoints(next);
      setLoadState(next.length ? "ready" : "empty");
    } catch {
      setLoadState((state) => (state === "ready" ? state : "error"));
    }
  }, [sessionId]);

  /* Lifecycle mirrors the transcript: ensure cold fold, attach live feed,
     refetch (debounced) on appends. The disposed re-checks around attach
     matter: a quick view switch during the initial awaits would otherwise
     spawn a live feed nobody owns. */
  useEffect(() => {
    if (!sessionId) return undefined;
    let disposed = false;
    setPoints([]);
    setSelectedKey(null);
    setLoadState("loading");
    stickRightRef.current = true;
    listStickRef.current = true;

    (async () => {
      try {
        await invoke("session_projection_ensure", { session_id: sessionId });
        if (disposed) return;
        await fetchTrajectory();
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
      if (disposed || event?.payload?.session_id !== sessionId) return;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = 0;
        void fetchTrajectory();
      }, 300);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      void invoke("session_projection_detach", { session_id: sessionId }).catch(() => {});
    };
  }, [sessionId, fetchTrajectory]);

  /* Keep the harness-defined live elapsed coordinate moving. A terminal
     snapshot is fixed, and an absent terminal on a non-live snapshot remains
     unknown rather than borrowing the event stream's timestamps. */
  const durationIsLive = session?.agent_metrics?.live === true
    && session?.agent_metrics?.terminal_at_ms == null;
  useEffect(() => {
    setDurationNowMs(Date.now());
    if (!durationIsLive) return undefined;
    const timer = window.setInterval(() => setDurationNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [durationIsLive, sessionId]);

  /* Repaint when the app theme flips (canvas reads CSS variables) and when
     the window moves to a display with a different pixel ratio. */
  useEffect(() => {
    if (typeof MutationObserver !== "function") return undefined;
    const observer = new MutationObserver(repaint);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-forge-theme"],
    });
    return () => observer.disconnect();
  }, [repaint]);

  useEffect(() => {
    let disposed = false;
    let media = null;
    const arm = () => {
      if (disposed || typeof window.matchMedia !== "function") return;
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => {
        media.removeEventListener("change", onChange);
        repaint();
        arm();
      };
      media.addEventListener("change", onChange);
    };
    arm();
    return () => {
      disposed = true;
    };
  }, [repaint]);

  const derived = useMemo(() => {
    const events = [];
    const usageRaw = [];
    let lastAssistant = null;
    for (const point of points) {
      if (point.kind === "usage") {
        usageRaw.push({ ...point, anchorKey: lastAssistant?.key ?? null });
        continue;
      }
      /* Row identity is (seq, ordinal); ordinal defaults to 0 pre-pipe. */
      const entry = { ...point, key: `${point.seq}:${point.ordinal || 0}`, tokens: null };
      events.push(entry);
      if (
        (point.kind === "message" || point.kind === "thinking")
        && point.role === "assistant"
      ) {
        lastAssistant = entry;
      }
    }
    const exactUsage = exactTrajectoryUsagePoints(usageRaw);
    const byKey = new Map(events.map((entry) => [entry.key, entry]));
    let cacheKnown = false;
    for (const usage of exactUsage) {
      const anchor = usage.anchorKey != null ? byKey.get(usage.anchorKey) : null;
      if (usage.cached != null) {
        cacheKnown = true;
      }
      if (anchor) {
        anchor.tokens = {
          input: usage.input,
          output: usage.output,
          cached: usage.cached,
        };
      }
    }
    return {
      events,
      cacheKnown,
    };
  }, [points]);
  const summaryMetrics = useMemo(() => trajectorySummaryMetrics(session), [session]);
  const durationLabel = trajectoryDurationLabel(session, durationNowMs);

  /* Layout geometry is pure data — the draw effect and hit-testing share it. */
  const geometry = useMemo(() => {
    let x = LABEL_GUTTER + STRIP_PAD;
    const separators = [];
    const placed = derived.events.map((event, index) => {
      if (event.role === "user" && index > 0) {
        separators.push(x - Math.ceil(TURN_GAP_PX / 2));
        x += TURN_GAP_PX;
      }
      const at = { ...event, x };
      x += STEP_PX;
      return at;
    });
    const maxTokens = placed.reduce((max, event) => {
      const total = (event.tokens?.input ?? 0) + (event.tokens?.output ?? 0);
      return Math.max(max, total);
    }, 0);
    return { placed, separators, width: Math.max(x + STRIP_PAD, 320), maxTokens };
  }, [derived]);

  /* Paint the visible x-window onto the viewport-sized sticky canvas. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const scroller = stripScrollRef.current;
    if (!canvas || !scroller) return;
    const viewWidth = Math.max(scroller.clientWidth, 60);
    const scrollLeft = scroller.scrollLeft;
    const colors = {
      input: cssColor("--forge-green", "#34d27b"),
      model: cssColor("--forge-trajectory-model", "#8b7cf6"),
      tool: cssColor("--forge-amber", "#e8a33d"),
      error: cssColor("--forge-red", "#e5534b"),
      grid: cssColor("--forge-border", "rgba(128,128,128,0.25)"),
      label: cssColor("--forge-text-muted", "#8a919c"),
      surface: cssColor("--forge-surface", "#101418"),
      hit: cssColor("--forge-green", "#34d27b"),
      ring: cssColor("--forge-text", "#e8ecf1"),
    };

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewWidth * dpr);
    canvas.height = Math.floor(STRIP_H * dpr);
    canvas.style.width = `${viewWidth}px`;
    canvas.style.height = `${STRIP_H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewWidth, STRIP_H);
    ctx.save();
    ctx.translate(-scrollLeft, 0);

    const minX = scrollLeft - STEP_PX * 2;
    const maxX = scrollLeft + viewWidth + STEP_PX * 2;

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (const sx of geometry.separators) {
      if (sx < minX || sx > maxX) continue;
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, LANE_TOP - 3);
      ctx.lineTo(sx + 0.5, LANE_TOP + 3 * LANE_H + 2);
      ctx.stroke();
    }

    for (const event of geometry.placed) {
      if (event.x < minX || event.x > maxX) continue;
      const { lane, color } = eventClass(event);
      const y = LANE_TOP + lane * LANE_H;
      ctx.fillStyle = colors[color];
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(event.x, y, SQUARE_PX, SQUARE_PX, 2);
      } else {
        ctx.rect(event.x, y, SQUARE_PX, SQUARE_PX);
      }
      ctx.fill();

      if (event.key === selectedKey) {
        ctx.strokeStyle = colors.ring;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(event.x - 2, y - 2, SQUARE_PX + 4, SQUARE_PX + 4);
      }

      /* Cache underline: only when the harness reported cache counts. */
      const tokens = event.tokens;
      if (tokens && tokens.cached != null) {
        const miss = tokens.cached === 0 && (tokens.input ?? 0) >= CACHE_MISS_MIN_INPUT;
        ctx.fillStyle = miss ? colors.error : colors.hit;
        ctx.fillRect(event.x, y + SQUARE_PX + 2, SQUARE_PX, 2);
      }

      /* Tokens bar: log-scaled, cached share tinted green from the top. */
      if (tokens && geometry.maxTokens > 0) {
        const total = (tokens.input ?? 0) + (tokens.output ?? 0);
        if (total > 0) {
          const h = Math.max(
            2,
            Math.round(
              (Math.log10(total + 1) / Math.log10(geometry.maxTokens + 1)) * (TOKEN_LANE_H - 6),
            ),
          );
          const barY = LANE_TOP + 3 * LANE_H + (TOKEN_LANE_H - 4) - h;
          ctx.fillStyle = colors.model;
          ctx.fillRect(event.x + 1, barY, SQUARE_PX - 2, h);
          const cachedShare = tokens.input > 0 && tokens.cached != null
            ? Math.min(1, tokens.cached / Math.max(tokens.input, tokens.cached))
            : 0;
          if (cachedShare > 0) {
            ctx.fillStyle = colors.hit;
            ctx.fillRect(event.x + 1, barY, SQUARE_PX - 2, Math.max(1, Math.round(h * cachedShare)));
          }
        }
      }
    }

    ctx.restore();

    /* Lane labels stay pinned: painted last in viewport coords over an
       opaque gutter so squares scroll underneath them. */
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, LABEL_GUTTER - 8, STRIP_H);
    ctx.font = "600 9px ui-sans-serif, system-ui";
    ctx.fillStyle = colors.label;
    ctx.textBaseline = "middle";
    ["Input", "Model", "Tools"].forEach((name, lane) => {
      ctx.fillText(name, STRIP_PAD, LANE_TOP + lane * LANE_H + SQUARE_PX / 2 + 1);
    });
    ctx.fillText("Tokens", STRIP_PAD, LANE_TOP + 3 * LANE_H + TOKEN_LANE_H / 2);
  }, [geometry, selectedKey, paintTick]);

  /* Stick to the live edge on new data; scrolling repaints the window. */
  useEffect(() => {
    const scroller = stripScrollRef.current;
    if (stickRightRef.current && scroller) {
      scroller.scrollLeft = scroller.scrollWidth;
    }
    repaint();
  }, [geometry, repaint]);

  useEffect(() => {
    const scroller = stripScrollRef.current;
    if (!scroller || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(repaint);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [repaint, loadState]);

  const onStripScroll = useCallback(() => {
    const node = stripScrollRef.current;
    if (!node) return;
    stickRightRef.current =
      node.scrollWidth - node.scrollLeft - node.clientWidth < 40;
    setHover(null);
    if (!scrollFrameRef.current) {
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = 0;
        repaint();
      });
    }
  }, [repaint]);

  useEffect(() => () => {
    if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const hitTest = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const scroller = stripScrollRef.current;
    if (!canvas || !scroller) return null;
    const rect = canvas.getBoundingClientRect();
    const viewX = clientX - rect.left;
    if (viewX < LABEL_GUTTER - 8) return null; // squares under the gutter are hidden
    const mx = viewX + scroller.scrollLeft;
    const my = clientY - rect.top;
    let best = null;
    for (const event of geometry.placed) {
      const { lane } = eventClass(event);
      const y = LANE_TOP + lane * LANE_H;
      const dx = Math.abs(mx - (event.x + SQUARE_PX / 2));
      const inLane = my >= y - 4 && my <= y + SQUARE_PX + 6;
      const inTokens = my > LANE_TOP + 3 * LANE_H && event.tokens;
      if (dx <= STEP_PX / 2 + 1 && (inLane || inTokens)) {
        if (!best || dx < best.dx) best = { dx, event };
      }
    }
    return best?.event || null;
  }, [geometry]);

  const onStripMove = useCallback((mouse) => {
    const event = hitTest(mouse.clientX, mouse.clientY);
    const scroller = stripScrollRef.current;
    if (!event || !scroller) {
      setHover(null);
      return;
    }
    /* Tooltip lives in the scroller's CONTENT coordinates: clamp the pointer
       position into the visible window, then add scrollLeft. */
    const hostRect = scroller.getBoundingClientRect();
    const viewX = mouse.clientX - hostRect.left;
    const lo = Math.min(TOOLTIP_CLAMP_PX, scroller.clientWidth / 2);
    const hi = Math.max(lo, scroller.clientWidth - TOOLTIP_CLAMP_PX);
    setHover({
      x: scroller.scrollLeft + Math.min(Math.max(viewX, lo), hi),
      point: event,
    });
  }, [hitTest]);

  const scrollListTo = useCallback((key) => {
    const index = derived.events.findIndex((event) => event.key === key);
    if (index < 0 || !listRef.current) return;
    listStickRef.current = false;
    listRef.current.scrollTop = Math.max(0, index * LIST_ROW_PX - listHeight / 2);
  }, [derived.events, listHeight]);

  const onStripClick = useCallback((mouse) => {
    const event = hitTest(mouse.clientX, mouse.clientY);
    if (!event) return;
    setSelectedKey(event.key);
    scrollListTo(event.key);
  }, [hitTest, scrollListTo]);

  /* List: fixed-height rows → exact windowing without measurement. */
  useEffect(() => {
    const node = listRef.current;
    if (!node || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(() => setListHeight(node.clientHeight));
    observer.observe(node);
    setListHeight(node.clientHeight);
    return () => observer.disconnect();
  }, [loadState]);

  useEffect(() => {
    if (listStickRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [derived.events.length]);

  const onListScroll = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    setListScrollTop(node.scrollTop);
    listStickRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 50;
  }, []);

  if (loadState === "loading" && !points.length) {
    return <TrajectoryNotice>Reading the session's event stream…</TrajectoryNotice>;
  }
  if ((loadState === "empty" || loadState === "error") && !derived.events.length) {
    return (
      <TrajectoryNotice>
        No trajectory yet — events appear here as the session works.
      </TrajectoryNotice>
    );
  }

  const firstIndex = Math.max(0, Math.floor(listScrollTop / LIST_ROW_PX) - 8);
  const visibleCount = Math.ceil(listHeight / LIST_ROW_PX) + 16;
  const visible = derived.events.slice(firstIndex, firstIndex + visibleCount);

  return (
    <TrajectoryRoot>
      <TrajectoryHeader>
        <Metric title="Elapsed time from the harness-published session lifecycle">
          <em>Duration</em>
          <span>{durationLabel}</span>
        </Metric>
        <Metric title="User turns">
          <em>Turns</em>
          <span>{summaryMetrics.turns ?? "—"}</span>
        </Metric>
        <Metric title="Tool calls">
          <em>Calls</em>
          <span>{summaryMetrics.calls ?? "—"}</span>
        </Metric>
        {summaryMetrics.tokenTotal != null && (
          <Metric title="Total tokens across model calls">
            <em>Tokens</em>
            <span>{formatTokens(summaryMetrics.tokenTotal)}</span>
          </Metric>
        )}
        {/* Only the harness measurement may create a cache header metric.
            Token counts cannot supply a substitute: a tilde or special label
            is lost when the number is screenshotted, quoted, or compared on
            another surface. When the measurement is absent, the metric is
            absent too. "re-read" remains the shared harness qualifier. */}
        {cacheMetric != null && (
          <Metric title="Of the context that could have been served from the provider prompt cache, the share that actually was. Measured by the harness, not estimated.">
            <em>{cacheMetric.label}</em>
            <span>{cacheMetric.value}</span>
          </Metric>
        )}
        <Legend>
          <i data-color="input" /> Input
          <i data-color="model" /> Model
          <i data-color="tool" /> Tools
          <i data-color="error" /> Error
          {derived.cacheKnown && (
            <LegendCache>
              <b data-kind="hit" /> cache hit
              <b data-kind="miss" /> miss
            </LegendCache>
          )}
        </Legend>
      </TrajectoryHeader>

      <StripScroller
        onClick={onStripClick}
        onMouseLeave={() => setHover(null)}
        onMouseMove={onStripMove}
        onScroll={onStripScroll}
        ref={stripScrollRef}
      >
        <StripCanvas ref={canvasRef} />
        <StripSpacer aria-hidden="true" style={{ width: geometry.width }} />
        {hover && (
          <StripTooltip style={{ left: hover.x }}>
            <TooltipKind data-color={eventClass(hover.point).color}>
              {hover.point.kind === "message" ? hover.point.role : hover.point.kind}
            </TooltipKind>
            <TooltipTime>{formatClock(hover.point.at_ms)}</TooltipTime>
            {hover.point.label && <TooltipLabel>{hover.point.label}</TooltipLabel>}
            {hover.point.tokens && (
              <TooltipTokens>
                {formatTokens((hover.point.tokens.input ?? 0) + (hover.point.tokens.output ?? 0))} tok
                {hover.point.tokens.cached != null
                  && ` · ${formatTokens(hover.point.tokens.cached)} cached`}
              </TooltipTokens>
            )}
          </StripTooltip>
        )}
      </StripScroller>

      <EventList onScroll={onListScroll} ref={listRef}>
        <div aria-hidden="true" style={{ height: firstIndex * LIST_ROW_PX }} />
        {visible.map((event) => {
          const { color } = eventClass(event);
          return (
            <EventRow
              data-selected={event.key === selectedKey ? "true" : undefined}
              key={event.key}
              onClick={() => setSelectedKey(event.key)}
              title={event.label}
              type="button"
            >
              <EventChip data-color={color}>
                {event.kind === "message" ? event.role : event.kind}
              </EventChip>
              <EventLabel>{event.label || "—"}</EventLabel>
              {event.tokens && (
                <EventTokens>
                  {formatTokens((event.tokens.input ?? 0) + (event.tokens.output ?? 0))}
                </EventTokens>
              )}
              <EventTime>{formatClock(event.at_ms)}</EventTime>
            </EventRow>
          );
        })}
        <div
          aria-hidden="true"
          style={{
            height: Math.max(0, (derived.events.length - firstIndex - visible.length) * LIST_ROW_PX),
          }}
        />
      </EventList>
    </TrajectoryRoot>
  );
}

const TrajectoryRoot = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

const TrajectoryHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 9px 14px 7px;
  border-bottom: 1px solid var(--forge-border);
`;

const Metric = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;

  em {
    color: var(--forge-text-muted);
    font-size: 9.5px;
    font-style: normal;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  span {
    color: var(--forge-text);
    font-size: 12px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
`;

const Legend = styled.span`
  display: inline-flex;
  margin-left: auto;
  align-items: center;
  gap: 5px;
  color: var(--forge-text-muted);
  font-size: 9.5px;
  font-weight: 600;

  i {
    width: 7px;
    height: 7px;
    margin-left: 7px;
    border-radius: 2px;
  }

  i[data-color="input"] { background: var(--forge-green); }
  i[data-color="model"] { background: var(--forge-trajectory-model, #8b7cf6); }
  i[data-color="tool"] { background: var(--forge-amber); }
  i[data-color="error"] { background: var(--forge-red); }
`;

const LegendCache = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 9px;
  padding-left: 9px;
  border-left: 1px solid var(--forge-border);

  b {
    width: 8px;
    height: 2px;
    border-radius: 1px;
  }

  b[data-kind="hit"] { background: var(--forge-green); }
  b[data-kind="miss"] { background: var(--forge-red); }
`;

const StripScroller = styled.div`
  position: relative;
  flex: 0 0 auto;
  height: ${STRIP_H}px;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-surface);
`;

/* Sticky viewport canvas: stays pinned while the spacer provides the scroll
   range; the draw effect translates by scrollLeft. */
const StripCanvas = styled.canvas`
  position: sticky;
  left: 0;
  display: block;
  cursor: crosshair;
`;

const StripSpacer = styled.div`
  height: 1px;
  margin-top: -1px;
  pointer-events: none;
`;

const StripTooltip = styled.div`
  position: absolute;
  top: 6px;
  z-index: 5;
  display: grid;
  max-width: 300px;
  gap: 2px;
  padding: 6px 9px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: var(--forge-surface-raised, var(--forge-surface));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  font-size: 10.5px;
  pointer-events: none;
  transform: translateX(-50%);
`;

const TooltipKind = styled.em`
  font-size: 8.5px;
  font-style: normal;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &[data-color="input"] { color: var(--forge-green); }
  &[data-color="model"] { color: var(--forge-trajectory-model, #8b7cf6); }
  &[data-color="tool"] { color: var(--forge-amber); }
  &[data-color="error"] { color: var(--forge-red); }
`;

const TooltipTime = styled.span`
  color: var(--forge-text-muted);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
`;

const TooltipLabel = styled.span`
  overflow: hidden;
  display: -webkit-box;
  color: var(--forge-text);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
`;

const TooltipTokens = styled.span`
  color: var(--forge-text-soft);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
`;

const EventList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 8px;
`;

const EventRow = styled.button`
  display: flex;
  width: 100%;
  height: ${LIST_ROW_PX}px;
  align-items: center;
  gap: 9px;
  padding: 0 14px;
  border: 0;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: var(--forge-surface-hover);
  }

  &[data-selected="true"] {
    background: var(--forge-surface-selected);
    color: var(--forge-text);
  }
`;

const EventChip = styled.em`
  flex: 0 0 auto;
  min-width: 58px;
  font-size: 8.5px;
  font-style: normal;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &[data-color="input"] { color: var(--forge-green); }
  &[data-color="model"] { color: var(--forge-trajectory-model, #8b7cf6); }
  &[data-color="tool"] { color: var(--forge-amber); }
  &[data-color="error"] { color: var(--forge-red); }
`;

const EventLabel = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
`;

const EventTokens = styled.span`
  flex: 0 0 auto;
  color: var(--forge-text-muted);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
`;

const EventTime = styled.span`
  flex: 0 0 auto;
  color: var(--forge-text-disabled);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
`;

const TrajectoryNotice = styled.div`
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--forge-text-disabled);
  font-size: 12px;
`;
