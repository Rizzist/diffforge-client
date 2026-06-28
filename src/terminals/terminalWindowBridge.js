// Window Breakout bridge events. The grid pane in the main window stays the
// source of truth for a broken-out terminal: it broadcasts the header
// identity/state its native window renders, and it executes the control
// clicks the window sends back. Constants live here so TerminalWindowHost and
// WorkspaceTerminal can share them without importing each other.
export const TERMINAL_WINDOW_META_EVENT = "forge-terminal-window-meta";
export const TERMINAL_WINDOW_META_REQUEST_EVENT = "forge-terminal-window-meta-request";
export const TERMINAL_WINDOW_CONTROL_EVENT = "forge-terminal-window-control";

export const TERMINAL_WINDOW_CONTROL_CLOSE_TERMINAL = "close-terminal";
export const TERMINAL_WINDOW_CONTROL_FONT_SIZE = "font-size";
export const TERMINAL_WINDOW_CONTROL_RESTART_AS = "restart-as";
export const TERMINAL_WINDOW_CONTROL_SPLIT_HORIZONTAL = "split-horizontal";
export const TERMINAL_WINDOW_CONTROL_SPLIT_VERTICAL = "split-vertical";
export const TERMINAL_WINDOW_CONTROL_UI_VIEW = "ui-view";
export const TERMINAL_WINDOW_CONTROL_FULLSCREEN = "fullscreen";
