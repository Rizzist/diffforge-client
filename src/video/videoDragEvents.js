// Pointer-based in-pane drag for media tiles → timeline lanes. HTML5 DnD is
// deliberately NOT used: the app-wide drag listeners (terminal/file drop
// routing) hit-test HTML5 drags against other panes' surfaces, which both
// highlighted the wrong pane and swallowed drops. A window CustomEvent channel
// scoped by paneToken keeps the drag entirely inside one video pane.

export const VIDEO_ASSET_POINTER_DRAG_EVENT = "diffforge-video-asset-pointer-drag";

export function emitVideoAssetDrag(detail) {
  try {
    window.dispatchEvent(new CustomEvent(VIDEO_ASSET_POINTER_DRAG_EVENT, { detail }));
  } catch {
    /* CustomEvent unavailable — drag degrades to double-click/add button */
  }
}
