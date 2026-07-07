// Mobile bottom-sheet overlay for expanded tool / file-change cards.
// Rendered through a portal so panel transforms can't trap the fixed
// positioning. Dismiss by tapping the scrim, pressing Escape, or dragging the
// handle down.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SheetBody, SheetHandle, SheetPanel, SheetScrim, SheetTitle } from "./styles";

const MOBILE_QUERY = "(max-width: 860px)";

export function useIsMobileViewport() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function BottomSheet({ title = null, onClose, children }) {
  const panelRef = useRef(null);
  const dragRef = useRef({ active: false, startY: 0, delta: 0 });

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  const handlePointerDown = (event) => {
    dragRef.current = { active: true, startY: event.clientY, delta: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.delta = Math.max(0, event.clientY - drag.startY);
    const panel = panelRef.current;
    if (panel) {
      panel.style.transform = `translateY(${drag.delta}px)`;
      panel.style.transition = "none";
    }
  };
  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag.active) return;
    dragRef.current = { active: false, startY: 0, delta: 0 };
    const panel = panelRef.current;
    if (drag.delta > 110) {
      onClose?.();
      return;
    }
    if (panel) {
      panel.style.transition = "transform 160ms ease";
      panel.style.transform = "translateY(0)";
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <SheetScrim onClick={() => onClose?.()} />
      <SheetPanel ref={panelRef} role="dialog" aria-modal="true">
        <SheetHandle
          onPointerCancel={endDrag}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
        />
        {title ? <SheetTitle>{title}</SheetTitle> : null}
        <SheetBody>{children}</SheetBody>
      </SheetPanel>
    </>,
    document.body,
  );
}
