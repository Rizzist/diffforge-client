// PaneErrorBoundary — reusable React error boundary that isolates a single
// pane/view subtree so a render- or lifecycle-phase throw inside one panel
// (e.g. the TerminalView emitClientActionAck ReferenceError) can NEVER unmount
// the rest of the React root. AppShell owns the cloud remote-command listener,
// the workspace activation status emitter, and the live-state sync effects —
// those hooks only survive a child crash if the throw is absorbed below
// AppShell. Every heavy pane mount site wraps its pane in this boundary, and
// AppShell wraps its whole rendered frame in a `variant="shell"` instance so
// even a non-pane render throw leaves AppShell (and its listeners) mounted.
//
// Written without JSX on purpose: the frontend test suite runs under plain
// `node --test` (no JSX transform), so keeping this file .js lets
// PaneErrorBoundary.test.js import the real component.

import { Component, Fragment, createElement } from "react";
import styledInterop from "styled-components";

// Dual-package interop: Vite resolves styled-components' ESM build (default
// export IS the styled factory), while plain `node --test` resolves the CJS
// build (factory lives one `.default` deeper). Normalize so both work.
const styled = styledInterop?.div ? styledInterop : styledInterop.default;

// Fallback chrome follows the app's forge token system (dark default with
// light-theme overrides supplied by the tokens themselves). No entrance
// animation — the fallback appears for users mid-incident, and skipping motion
// keeps it trivially compliant with prefers-reduced-motion; the only
// transition is gated behind no-preference below.
const PaneErrorFallback = styled.div`
  align-items: center;
  background: var(--forge-surface, #0d1117);
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 10px;
  box-sizing: border-box;
  color: var(--forge-text, #f4f7fa);
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 24px 20px;
  text-align: center;
  width: 100%;

  &[data-variant="shell"] {
    border: none;
    border-radius: 0;
    height: 100vh;
    width: 100vw;
  }
`;

const PaneErrorGlyph = styled.span`
  align-items: center;
  background: var(--forge-surface-raised, #11161d);
  border: 1px solid var(--forge-border-strong, rgba(230, 236, 245, 0.16));
  border-radius: 50%;
  color: var(--forge-text-soft, #b6c0cc);
  display: inline-flex;
  font-size: 15px;
  font-weight: 700;
  height: 32px;
  justify-content: center;
  line-height: 1;
  width: 32px;
`;

const PaneErrorTitle = styled.strong`
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
`;

const PaneErrorDetail = styled.span`
  color: var(--forge-text-muted, #7a8493);
  font-size: 12px;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PaneErrorRetryButton = styled.button`
  background: var(--forge-surface-control, #151b23);
  border: 1px solid var(--forge-border-strong, rgba(230, 236, 245, 0.16));
  border-radius: 7px;
  color: var(--forge-text, #f4f7fa);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;

  @media (prefers-reduced-motion: no-preference) {
    transition: background 120ms ease, border-color 120ms ease;
  }

  &:hover {
    background: var(--forge-surface-hover, rgba(230, 236, 245, 0.055));
    border-color: var(--forge-accent, #3b82f6);
  }

  &:focus-visible {
    outline: 2px solid var(--forge-accent, #3b82f6);
    outline-offset: 2px;
  }
`;

export function describePaneBoundaryError(error) {
  if (!error) return "Unknown error";
  const message = typeof error === "string" ? error : error.message;
  return String(message || error.name || "Unknown error").slice(0, 300);
}

export default class PaneErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // `attempt` keys the children wrapper so "Reload panel" fully remounts the
    // crashed subtree instead of resuming it with whatever broken state threw.
    this.state = { attempt: 0, error: null };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error("Unknown render error") };
  }

  componentDidCatch(error, info) {
    const label = this.props.label || "panel";
    const componentStack = info?.componentStack || "";
    // The boundary is the last line of defense for AppShell's listeners; log
    // loudly with the pane identity so crash reports name the culprit pane.
    try {
      console.error(
        `[PaneErrorBoundary] "${label}" crashed during render/lifecycle; ` +
          "the pane was isolated and the rest of the app kept running.",
        error,
        componentStack,
      );
    } catch {
      // Logging must never re-throw inside the boundary.
    }
    if (typeof this.props.onError === "function") {
      try {
        this.props.onError(error, info, label);
      } catch {
        // Caller-supplied reporters must not break recovery either.
      }
    }
  }

  componentDidUpdate(prevProps) {
    // When the caller swaps what the pane shows (workspace switch, view
    // change), clear a stale error automatically so the fresh content mounts.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState((state) => ({ attempt: state.attempt + 1, error: null }));
    }
  }

  handleRetry() {
    this.setState((state) => ({ attempt: state.attempt + 1, error: null }));
  }

  render() {
    const { error, attempt } = this.state;
    if (error) {
      const label = this.props.label || "panel";
      const variant = this.props.variant === "shell" ? "shell" : "pane";
      const isShell = variant === "shell";
      return createElement(
        PaneErrorFallback,
        {
          "data-pane-error-boundary": label,
          "data-variant": variant,
          role: "alert",
        },
        createElement(PaneErrorGlyph, { "aria-hidden": "true" }, "!"),
        createElement(
          PaneErrorTitle,
          null,
          isShell ? "The interface hit an error" : "This panel hit an error",
        ),
        createElement(
          PaneErrorDetail,
          { title: describePaneBoundaryError(error) },
          `${label}: ${describePaneBoundaryError(error)}`,
        ),
        createElement(
          PaneErrorRetryButton,
          { onClick: this.handleRetry, type: "button" },
          isShell ? "Reload interface" : "Reload panel",
        ),
      );
    }
    return createElement(Fragment, { key: attempt }, this.props.children);
  }
}
