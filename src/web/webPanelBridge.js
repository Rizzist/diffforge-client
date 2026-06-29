export const WEB_PANEL_HASH = "#/web-panel";

// Cross-window events between the in-grid Web pane (main window) and its
// breakout window. The main window stays the source of truth for which panes
// are popped out; the breakout window hosts the live browser.
export const WEB_PANEL_META_EVENT = "forge-web-panel-meta";
export const WEB_PANEL_META_REQUEST_EVENT = "forge-web-panel-meta-request";
export const WEB_PANEL_CONTROL_EVENT = "forge-web-panel-control";
export const WEB_PANEL_CLOSED_EVENT = "forge-web-panel-closed";

// Controls the breakout window sends back to the main grid.
export const WEB_PANEL_CONTROL_CLOSE = "close";
export const WEB_PANEL_CONTROL_RETURN = "return";
export const WEB_PANEL_CONTROL_FOCUS_MAIN = "focus_main";
export const WEB_PANEL_CONTROL_NAVIGATE = "navigate";
