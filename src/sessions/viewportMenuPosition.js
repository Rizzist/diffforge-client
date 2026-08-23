export const VIEWPORT_MENU_MARGIN = 8;
export const VIEWPORT_MENU_GAP = 4;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/* Place a fixed-position menu beside its trigger, preferring the trigger's
   left edge so the menu opens rightward. When that would cross a viewport
   edge, shift only far enough to keep the whole measured panel visible. */
export function viewportMenuPosition(
  anchor,
  menu,
  viewport,
  margin = VIEWPORT_MENU_MARGIN,
  gap = VIEWPORT_MENU_GAP,
) {
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  const menuWidth = Math.min(
    Math.max(0, Number(menu?.width) || 0),
    Math.max(0, viewportWidth - margin * 2),
  );
  const menuHeight = Math.min(
    Math.max(0, Number(menu?.height) || 0),
    Math.max(0, viewportHeight - margin * 2),
  );
  const maximumLeft = Math.max(margin, viewportWidth - margin - menuWidth);
  const maximumTop = Math.max(margin, viewportHeight - margin - menuHeight);
  const below = (Number(anchor?.bottom) || 0) + gap;
  const above = (Number(anchor?.top) || 0) - gap - menuHeight;
  const preferredTop = below + menuHeight <= viewportHeight - margin ? below : above;

  return {
    left: clamp(Number(anchor?.left) || 0, margin, maximumLeft),
    top: clamp(preferredTop, margin, maximumTop),
  };
}
