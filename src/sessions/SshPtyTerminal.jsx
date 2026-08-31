import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Terminal as XTerm } from "@xterm/xterm";

import { measureTerminalGrid } from "../terminals/terminalResizeController.js";
import { guardXtermDuringPushToTalk } from "../terminals/xtermPushToTalkGuard.js";
import {
  TERMINAL_DARK_THEME,
  TERMINAL_LIGHT_THEME,
} from "../terminals/WorkspaceTerminal/terminalCore.js";
import { SSH_PTY_TRANSIENT_MARKER } from "./sshPtyModel.js";

const SSH_TERM = "xterm-256color";
const RESIZE_DEBOUNCE_MS = 120;
const MEASURE_RETRY_FRAMES = 30;

function terminalTheme() {
  return document.documentElement.dataset.forgeTheme === "light"
    ? TERMINAL_LIGHT_THEME
    : TERMINAL_DARK_THEME;
}

function measuredGrid(container, term) {
  const measurement = measureTerminalGrid({
    container,
    term,
    minCols: 1,
    minRows: 1,
  });
  return measurement.ok
    ? { cols: measurement.cols, rows: measurement.rows }
    : null;
}

function receiptShellId(receipt) {
  const id = receipt?.id ?? receipt?.shell?.id ?? receipt?.row?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export default function SshPtyTerminal({
  profileName,
  outputByShell = {},
  stateByShell = {},
  closedByShell = {},
  eofByShell = {},
  subscriptionId = 0,
  opening = false,
  error = "",
  unavailable = false,
  onBack = null,
  onOpen = null,
  onInput = null,
  onResize = null,
  onEof = null,
}) {
  const hostRef = useRef(null);
  const mountRef = useRef(null);
  const termRef = useRef(null);
  const shellIdRef = useRef(null);
  const fitRef = useRef(() => {});
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const writtenEntriesRef = useRef(new WeakSet());
  const markerBoundaryRef = useRef(null);
  const discardBoundaryRef = useRef(null);
  const firstOutputFitBoundaryRef = useRef(null);
  const [shellId, setShellId] = useState(null);

  inputRef.current = onInput;
  resizeRef.current = onResize;
  shellIdRef.current = shellId;
  const closed = shellId != null && closedByShell[shellId] === true;
  const closedRef = useRef(closed);
  const unavailableRef = useRef(unavailable);
  closedRef.current = closed;
  unavailableRef.current = unavailable;

  /* This mirrors SessionTerminal's one-xterm-per-mount lifecycle: shared
     themes, shared push-to-talk guard, measured-grid resize observer, and
     disposal without an implicit daemon close. EOF is user-explicit. */
  useEffect(() => {
    const container = mountRef.current;
    const observedHost = hostRef.current;
    if (!container || !observedHost || !profileName || unavailable) {
      return undefined;
    }

    let disposed = false;
    let term = null;
    let detachPushToTalk = () => {};
    let resizeObserver = null;
    let themeObserver = null;
    let resizeTimer = 0;
    let lateFitTimer = 0;
    let measureFrame = 0;
    let measureAttempts = 0;
    let openingRequest = false;
    let lastSentGrid = null;

    const applyTheme = () => {
      if (disposed || !term) return;
      term.options.theme = terminalTheme();
      term.refresh(0, Math.max(0, term.rows - 1));
    };

    const fitTerminal = () => {
      if (disposed || !term) return false;
      const grid = measuredGrid(container, term);
      if (!grid) return false;
      if (term.cols !== grid.cols || term.rows !== grid.rows) {
        term.resize(grid.cols, grid.rows);
      }
      const id = shellIdRef.current;
      if (id && (lastSentGrid?.cols !== grid.cols || lastSentGrid?.rows !== grid.rows)) {
        lastSentGrid = grid;
        void resizeRef.current?.(id, grid);
      }
      return true;
    };

    const openWhenMeasured = async () => {
      if (disposed || openingRequest || shellIdRef.current || !term) return;
      const grid = measuredGrid(container, term);
      if (!grid) return;
      if (term.cols !== grid.cols || term.rows !== grid.rows) {
        term.resize(grid.cols, grid.rows);
      }
      openingRequest = true;
      const receipt = await onOpen?.(profileName, SSH_TERM, grid);
      openingRequest = false;
      if (disposed) return;
      const id = receiptShellId(receipt);
      if (!id) return;
      lastSentGrid = grid;
      shellIdRef.current = id;
      setShellId(id);
      fitTerminal();
      term.focus();
    };

    const requestMeasuredOpen = () => {
      if (disposed || measureFrame || shellIdRef.current || openingRequest) return;
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = 0;
        if (disposed || shellIdRef.current || openingRequest) return;
        const measurable = measuredGrid(container, term);
        if (measurable) {
          void openWhenMeasured();
          return;
        }
        measureAttempts += 1;
        if (measureAttempts < MEASURE_RETRY_FRAMES) requestMeasuredOpen();
      });
    };

    const scheduleFit = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = 0;
        if (!fitTerminal()) requestMeasuredOpen();
      }, RESIZE_DEBOUNCE_MS);
    };

    term = new XTerm({
      allowProposedApi: true,
      altClickMovesCursor: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      customGlyphs: true,
      fastScrollModifier: "alt",
      fastScrollSensitivity: 5,
      fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
      fontSize: 12,
      lineHeight: 1,
      macOptionIsMeta: true,
      scrollback: 10_000,
      smoothScrollDuration: 0,
      theme: terminalTheme(),
    });
    termRef.current = term;
    term.open(container);
    detachPushToTalk = guardXtermDuringPushToTalk(term);
    markerBoundaryRef.current = subscriptionId;
    term.writeln(`\x1b[2m${SSH_PTY_TRANSIENT_MARKER}\x1b[0m`);

    term.onData((data) => {
      const id = shellIdRef.current;
      if (!id || closedRef.current || unavailableRef.current) return;
      /* Verbatim xterm emission: no line editing and no synthesized echo. */
      void inputRef.current?.(id, data);
    });

    try {
      void import("@xterm/addon-unicode11").then(({ Unicode11Addon }) => {
        if (disposed || !term) return;
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";
      }).catch(() => {});
    } catch {
      // xterm's default widths remain usable when the optional addon is absent.
    }

    fitRef.current = fitTerminal;
    window.addEventListener("resize", scheduleFit);
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(observedHost);
    }
    if (typeof MutationObserver === "function") {
      themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-forge-theme"],
      });
    }
    requestMeasuredOpen();
    lateFitTimer = window.setTimeout(() => {
      lateFitTimer = 0;
      if (!fitTerminal()) requestMeasuredOpen();
    }, 250);
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!disposed) scheduleFit();
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener("resize", scheduleFit);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      if (resizeTimer) window.clearTimeout(resizeTimer);
      if (lateFitTimer) window.clearTimeout(lateFitTimer);
      if (measureFrame) window.cancelAnimationFrame(measureFrame);
      detachPushToTalk();
      fitRef.current = () => {};
      term?.dispose();
      termRef.current = null;
      shellIdRef.current = null;
    };
  }, [onOpen, profileName, unavailable]);

  /* A listener reconnect is a new capture boundary. The hook clears older
     connection bytes; the terminal renders the mandatory visible gap marker. */
  useEffect(() => {
    const term = termRef.current;
    if (!term || markerBoundaryRef.current === subscriptionId) return;
    markerBoundaryRef.current = subscriptionId;
    discardBoundaryRef.current = null;
    firstOutputFitBoundaryRef.current = null;
    writtenEntriesRef.current = new WeakSet();
    term.writeln(`\r\n\x1b[2m${SSH_PTY_TRANSIENT_MARKER}\x1b[0m`);
  }, [subscriptionId]);

  /* Client buffering is bounded to bytes captured by this subscription.
     Weak identity prevents duplicate xterm writes without inventing a daemon
     sequence/cursor. A remount starts with a fresh set and an explicit marker. */
  useEffect(() => {
    const term = termRef.current;
    const buffer = shellId == null ? null : outputByShell[shellId];
    if (!term || !buffer) return;
    if (buffer.subscriptionId !== markerBoundaryRef.current) {
      markerBoundaryRef.current = buffer.subscriptionId;
      discardBoundaryRef.current = null;
      firstOutputFitBoundaryRef.current = null;
      writtenEntriesRef.current = new WeakSet();
      term.writeln(`\r\n\x1b[2m${SSH_PTY_TRANSIENT_MARKER}\x1b[0m`);
    }
    if (buffer.bufferDiscarded
      && discardBoundaryRef.current !== buffer.subscriptionId) {
      discardBoundaryRef.current = buffer.subscriptionId;
      term.writeln("\r\n\x1b[2m[connection-transient] Earlier captured output was discarded from the bounded client buffer.\x1b[0m");
    }
    let wrote = false;
    for (const entry of buffer.entries || []) {
      if (!entry || writtenEntriesRef.current.has(entry)) continue;
      writtenEntriesRef.current.add(entry);
      if (entry.bytes instanceof Uint8Array) {
        term.write(entry.bytes);
        wrote = true;
      }
    }
    if (wrote && firstOutputFitBoundaryRef.current !== buffer.subscriptionId) {
      firstOutputFitBoundaryRef.current = buffer.subscriptionId;
      window.requestAnimationFrame(() => fitRef.current());
    }
  }, [outputByShell, shellId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.disableStdin = closed || unavailable;
  }, [closed, unavailable]);

  const publishedState = shellId == null ? null : stateByShell[shellId];
  const stateLabel = unavailable
    ? "unavailable"
    : publishedState?.label ?? "state not published";

  return (
    <PtyRoot aria-label={`Interactive SSH shell · ${profileName}`}>
      <PtyToolbar>
        <PtyIdentity>
          <strong>{profileName}</strong>
          <span>
            {shellId == null ? "Shell id not published yet" : shellId}
            {" · state: "}
            <StateValue data-recognized={publishedState?.state?.recognized ? "true" : "false"}>
              {stateLabel}
            </StateValue>
          </span>
        </PtyIdentity>
        <PtyActions>
          <QuietButton
            disabled={!shellId || closed || unavailable || eofByShell[shellId] === true}
            onClick={() => onEof?.(shellId)}
            type="button"
          >
            {eofByShell[shellId] === true ? "Sending EOF…" : closed ? "Closed" : "Send EOF / close"}
          </QuietButton>
          <QuietButton onClick={() => onBack?.()} type="button">Back to profiles</QuietButton>
        </PtyActions>
      </PtyToolbar>
      <PtyNotice>
        {SSH_PTY_TRANSIENT_MARKER}
        {opening && " Waiting for the daemon open receipt."}
        {closed && " This shell is closed from a published shell event."}
      </PtyNotice>
      {unavailable && (
        <UnavailableNotice>
          Interactive SSH PTY access is unavailable on this daemon.
        </UnavailableNotice>
      )}
      {error && !unavailable && <ErrorNotice role="alert">{error}</ErrorNotice>}
      <TerminalHost ref={hostRef}>
        <TerminalMount ref={mountRef} />
      </TerminalHost>
    </PtyRoot>
  );
}

const PtyRoot = styled.section`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  color: var(--forge-text);
  background: ${TERMINAL_DARK_THEME.background};
`;

const PtyToolbar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-surface-raised);
`;

const PtyIdentity = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong { font-size: 11px; }
  span {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 8.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const StateValue = styled.em`
  color: ${({ "data-recognized": recognized }) => (
    recognized === "true" ? "var(--forge-text-soft)" : "#e6ae6d"
  )};
  font-style: normal;
`;

const PtyActions = styled.div`
  display: flex;
  flex: none;
  gap: 6px;
`;

const QuietButton = styled.button`
  padding: 5px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font: inherit;
  font-size: 9px;
  cursor: pointer;

  &:disabled { cursor: default; opacity: 0.48; }
`;

const PtyNotice = styled.div`
  padding: 5px 10px;
  border-bottom: 1px solid var(--forge-border);
  color: var(--forge-text-muted);
  background: var(--forge-surface);
  font-size: 8px;
`;

const ErrorNotice = styled.div`
  padding: 6px 10px;
  color: #ef8a8a;
  background: color-mix(in srgb, #ef6a6a 9%, var(--forge-surface));
  font-size: 8.5px;
`;

const UnavailableNotice = styled(ErrorNotice)`
  color: var(--forge-text-muted);
`;

const TerminalHost = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  flex: 1;
  box-sizing: border-box;
  padding: 3px;
  overflow: hidden;
  background: ${TERMINAL_DARK_THEME.background};

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_LIGHT_THEME.background};
  }
`;

const TerminalMount = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  .xterm {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .xterm .xterm-viewport {
    background: transparent !important;
  }
`;
