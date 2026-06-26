export const WORKSPACE_TOOL_TODO_DRAG_MIME = "application/x-diffforge-workspace-tool-todo";
export const WORKSPACE_TOOL_DOC_DRAG_MIME = "application/x-diffforge-workspace-doc";
export const WORKSPACE_TOOL_DOC_DRAG_KIND = "loopspace_document_ref";

// Cross-window drag payload store.
//
// During a native HTML5 doc drag the dataTransfer text is only readable inside
// the originating window and only on `drop` — it is blocked during `dragover`
// and unavailable once the cursor leaves over a separate breakout window. To
// commit a drop onto a popped-out terminal window we therefore stash the
// payload here at drag start so the main window can commit by terminal index
// without re-reading the dataTransfer. Mirrors the workspace-file drag store in
// WorkspaceTerminal/threadRuntime.js.
let activeWorkspaceToolDrag = null;

export function setActiveWorkspaceToolDrag(payload) {
  activeWorkspaceToolDrag = payload && typeof payload === "object" ? payload : null;
}

export function getActiveWorkspaceToolDrag() {
  return activeWorkspaceToolDrag;
}

export function clearActiveWorkspaceToolDrag() {
  activeWorkspaceToolDrag = null;
}
