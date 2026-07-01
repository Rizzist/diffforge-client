import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const POLL_MS = 220;

function buildWebElementPickerScript(action) {
  const safeAction = JSON.stringify(String(action || "selection"));
  return `(() => {
    const action = ${safeAction};
    const KEY = "__diffforgeWebElementPicker";
    const OVERLAY_ID = "diffforge-web-element-picker-overlay";
    const LABEL_ID = "diffforge-web-element-picker-label";
    const AGENT_PROMPT_OVERLAY_ID = "diffforge-web-agent-prompt-overlay";
    const MAX_TEXT = 420;
    const MAX_PARENT_TEXT = 180;
    const MAX_SELECTOR_DEPTH = 7;
    const STYLE_KEYS = [
      "display",
      "position",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "color",
      "backgroundColor",
      "borderColor",
      "borderRadius",
      "padding",
      "margin",
      "gap",
      "alignItems",
      "justifyContent",
      "gridTemplateColumns",
      "width",
      "height"
    ];

    function clampText(value, maxLength) {
      const normalized = String(value || "").replace(/\\s+/g, " ").trim();
      if (!normalized || normalized.length <= maxLength) {
        return normalized;
      }
      return normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "...";
    }

    function cssEscape(value) {
      const raw = String(value || "");
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(raw);
      }
      return raw.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    }

    function number(value) {
      const next = Number(value);
      return Number.isFinite(next) ? Math.round(next * 10) / 10 : 0;
    }

    function rectFor(element) {
      const rect = element.getBoundingClientRect();
      return {
        bottom: number(rect.bottom),
        height: number(rect.height),
        left: number(rect.left),
        right: number(rect.right),
        top: number(rect.top),
        width: number(rect.width),
        x: number(rect.x),
        y: number(rect.y)
      };
    }

    function elementName(element) {
      if (!element || !element.tagName) {
        return "";
      }
      const tag = element.tagName.toLowerCase();
      const id = element.id ? "#" + element.id : "";
      const classes = Array.from(element.classList || []).slice(0, 3).map((name) => "." + name).join("");
      return tag + id + classes;
    }

    function nthOfType(element) {
      if (!element || !element.parentElement) {
        return 1;
      }
      const tag = element.tagName;
      return Array.from(element.parentElement.children || [])
        .filter((child) => child.tagName === tag)
        .indexOf(element) + 1;
    }

    function selectorPart(element) {
      const tag = element.tagName.toLowerCase();
      if (element.id) {
        return tag + "#" + cssEscape(element.id);
      }
      const classes = Array.from(element.classList || [])
        .filter(Boolean)
        .slice(0, 2)
        .map((name) => "." + cssEscape(name))
        .join("");
      return tag + classes + ":nth-of-type(" + nthOfType(element) + ")";
    }

    function selectorFor(element) {
      if (!element || !element.tagName) {
        return "";
      }
      if (element.id) {
        return selectorPart(element);
      }
      const parts = [];
      let cursor = element;
      while (cursor && cursor.nodeType === 1 && parts.length < MAX_SELECTOR_DEPTH) {
        parts.unshift(selectorPart(cursor));
        if (cursor.id || cursor === document.body || cursor === document.documentElement) {
          break;
        }
        cursor = cursor.parentElement;
      }
      return parts.join(" > ");
    }

    function attributeMap(element) {
      const attributes = {};
      [
        "id",
        "class",
        "role",
        "aria-label",
        "name",
        "type",
        "href",
        "src",
        "alt",
        "title",
        "placeholder"
      ].forEach((name) => {
        const value = element.getAttribute && element.getAttribute(name);
        if (value) {
          attributes[name] = clampText(value, 220);
        }
      });
      return attributes;
    }

    function styleMap(element) {
      const styles = {};
      const computed = window.getComputedStyle ? window.getComputedStyle(element) : null;
      if (!computed) {
        return styles;
      }
      STYLE_KEYS.forEach((key) => {
        const value = computed[key];
        if (value && value !== "normal" && value !== "none" && value !== "0px") {
          styles[key] = String(value);
        }
      });
      return styles;
    }

    function collect(element) {
      const rect = rectFor(element);
      const parent = element.parentElement || null;
      const id = "webctx_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      return {
        attributes: attributeMap(element),
        capturedAtMs: Date.now(),
        childrenCount: element.children ? element.children.length : 0,
        devicePixelRatio: number(window.devicePixelRatio || 1),
        element: elementName(element),
        id,
        kind: "web-element",
        pageRect: {
          height: rect.height,
          left: number(rect.left + window.scrollX),
          top: number(rect.top + window.scrollY),
          width: rect.width
        },
        parent: parent ? {
          element: elementName(parent),
          selector: selectorFor(parent),
          text: clampText(parent.textContent, MAX_PARENT_TEXT)
        } : null,
        rect,
        scroll: {
          x: number(window.scrollX),
          y: number(window.scrollY)
        },
        selector: selectorFor(element),
        styles: styleMap(element),
        tagName: element.tagName.toLowerCase(),
        text: clampText(element.textContent, MAX_TEXT),
        title: document.title || "",
        url: location.href,
        viewport: {
          height: number(window.innerHeight),
          width: number(window.innerWidth)
        }
      };
    }

    function selectableFromPoint(x, y) {
      let element = document.elementFromPoint(x, y);
      if (element && (element.id === AGENT_PROMPT_OVERLAY_ID || element.closest?.("#" + AGENT_PROMPT_OVERLAY_ID))) {
        return null;
      }
      while (element && (element.id === OVERLAY_ID || element.id === LABEL_ID)) {
        element = element.parentElement;
      }
      if (!element || element === document.documentElement) {
        return document.body || null;
      }
      return element;
    }

    function createOverlay() {
      let overlay = document.getElementById(OVERLAY_ID);
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.setAttribute("aria-hidden", "true");
        overlay.style.cssText = [
          "position:fixed",
          "z-index:2147483646",
          "pointer-events:none",
          "box-sizing:border-box",
          "border:2px solid #60a5fa",
          "outline:1px solid rgba(15,23,42,.55)",
          "background:rgba(37,99,235,.13)",
          "border-radius:6px",
          "box-shadow:0 0 0 1px rgba(255,255,255,.24),0 10px 30px rgba(15,23,42,.24)",
          "display:none"
        ].join(";");
        document.documentElement.appendChild(overlay);
      }
      let label = document.getElementById(LABEL_ID);
      if (!label) {
        label = document.createElement("div");
        label.id = LABEL_ID;
        label.setAttribute("aria-hidden", "true");
        label.style.cssText = [
          "position:fixed",
          "z-index:2147483647",
          "pointer-events:none",
          "max-width:360px",
          "padding:4px 7px",
          "border:1px solid rgba(255,255,255,.22)",
          "border-radius:999px",
          "background:rgba(3,7,18,.9)",
          "color:#e5edff",
          "font:700 11px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
          "box-shadow:0 8px 24px rgba(0,0,0,.28)",
          "white-space:nowrap",
          "overflow:hidden",
          "text-overflow:ellipsis",
          "display:none"
        ].join(";");
        document.documentElement.appendChild(label);
      }
      return { overlay, label };
    }

    function createController() {
      const state = {
        enabled: false,
        hotElement: null,
        selection: null,
        selectedElement: null
      };

      function updateOverlay(element, selected) {
        const { overlay, label } = createOverlay();
        if (!element || !element.isConnected) {
          overlay.style.display = "none";
          label.style.display = "none";
          return;
        }
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          overlay.style.display = "none";
          label.style.display = "none";
          return;
        }
        overlay.style.display = "block";
        overlay.style.left = Math.max(0, rect.left) + "px";
        overlay.style.top = Math.max(0, rect.top) + "px";
        overlay.style.width = Math.max(1, rect.width) + "px";
        overlay.style.height = Math.max(1, rect.height) + "px";
        overlay.style.borderColor = selected ? "#34d399" : "#60a5fa";
        overlay.style.background = selected ? "rgba(16,185,129,.14)" : "rgba(37,99,235,.13)";
        label.textContent = (selected ? "Selected " : "Select ") + elementName(element);
        label.style.display = "block";
        label.style.left = Math.max(8, Math.min(window.innerWidth - 140, rect.left)) + "px";
        label.style.top = Math.max(8, rect.top - 28) + "px";
      }

      function hideOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        const label = document.getElementById(LABEL_ID);
        if (overlay) overlay.style.display = "none";
        if (label) label.style.display = "none";
      }

      function handleMove(event) {
        if (!state.enabled) return;
        const element = selectableFromPoint(event.clientX, event.clientY);
        state.hotElement = element;
        updateOverlay(element, false);
      }

      function handlePointerDown(event) {
        if (!state.enabled || event.button !== 0) return;
        const element = state.hotElement || selectableFromPoint(event.clientX, event.clientY);
        if (!element) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const suppressNextClick = (nextEvent) => {
          nextEvent.preventDefault();
          nextEvent.stopImmediatePropagation();
          document.removeEventListener("click", suppressNextClick, true);
        };
        document.addEventListener("click", suppressNextClick, true);
        window.setTimeout(() => {
          document.removeEventListener("click", suppressNextClick, true);
        }, 900);
        state.selection = collect(element);
        state.selectedElement = element;
        state.enabled = false;
        removeListeners();
        updateOverlay(element, true);
      }

      function handleKeyDown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          state.selection = null;
          state.selectedElement = null;
          state.enabled = false;
          removeListeners();
          hideOverlay();
        }
      }

      function handleRefresh() {
        if (state.selection && state.selectedElement) {
          updateOverlay(state.selectedElement, true);
        } else if (state.enabled && state.hotElement) {
          updateOverlay(state.hotElement, false);
        }
      }

      function addListeners() {
        document.addEventListener("mousemove", handleMove, true);
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("scroll", handleRefresh, true);
        window.addEventListener("resize", handleRefresh, true);
      }

      function removeListeners() {
        document.removeEventListener("mousemove", handleMove, true);
        document.removeEventListener("pointerdown", handlePointerDown, true);
        document.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("scroll", handleRefresh, true);
        window.removeEventListener("resize", handleRefresh, true);
      }

      return {
        clear() {
          removeListeners();
          state.enabled = false;
          state.hotElement = null;
          state.selection = null;
          state.selectedElement = null;
          hideOverlay();
          return this.snapshot();
        },
        disable() {
          removeListeners();
          state.enabled = false;
          if (state.selection && state.selectedElement) {
            updateOverlay(state.selectedElement, true);
          } else {
            hideOverlay();
          }
          return this.snapshot();
        },
        enable() {
          removeListeners();
          state.enabled = true;
          state.hotElement = null;
          state.selection = null;
          state.selectedElement = null;
          hideOverlay();
          addListeners();
          return this.snapshot();
        },
        snapshot() {
          return {
            enabled: state.enabled,
            selection: state.selection
          };
        }
      };
    }

    const controller = window[KEY] || (window[KEY] = createController());
    if (action === "enable") return controller.enable();
    if (action === "disable") return controller.disable();
    if (action === "clear") return controller.clear();
    return controller.snapshot();
  })()`;
}

function safeText(value, maxLength = 180) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function normalizeContext(raw, meta = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const selection = raw.selection && typeof raw.selection === "object"
    ? raw.selection
    : raw.kind === "web-element"
      ? raw
      : null;
  if (!selection) {
    return null;
  }
  const id = String(selection.id || "").trim();
  const selector = String(selection.selector || "").trim();
  const element = String(selection.element || selection.tagName || "").trim();
  if (!id && !selector && !element) {
    return null;
  }
  return {
    ...selection,
    element,
    id: id || `webctx_${Date.now().toString(36)}`,
    kind: "web-element",
    panelKind: String(meta.panelKind || "web").trim() || "web",
    paneId: String(meta.paneId || "").trim(),
    selector,
    text: safeText(selection.text, 420),
    title: safeText(selection.title, 160),
    url: String(selection.url || meta.currentUrl || "").trim(),
    workspaceId: String(meta.workspaceId || "").trim(),
  };
}

export function webElementContextLabel(context) {
  if (!context) {
    return "";
  }
  const element = String(context.element || context.tagName || "").trim();
  const host = (() => {
    try {
      return new URL(context.url || "").host;
    } catch {
      return "";
    }
  })();
  return [element || "element", host].filter(Boolean).join(" on ");
}

export function useWebElementPicker({
  currentUrl = "",
  enabled = true,
  evaluate,
  panelKind = "web",
  paneId = "",
  workspaceId = "",
} = {}) {
  const [armed, setArmed] = useState(false);
  const [selectedContext, setSelectedContext] = useState(null);
  const [error, setError] = useState("");
  const mountedRef = useRef(false);
  const selectedIdRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const meta = useMemo(() => ({
    currentUrl,
    panelKind,
    paneId,
    workspaceId,
  }), [currentUrl, panelKind, paneId, workspaceId]);

  const runPickerAction = useCallback(async (action, options = {}) => {
    if (!enabled || typeof evaluate !== "function") {
      throw new Error("Web element picker is unavailable.");
    }
    return evaluate(buildWebElementPickerScript(action), options);
  }, [enabled, evaluate]);

  const clearSelection = useCallback(async () => {
    selectedIdRef.current = "";
    setSelectedContext(null);
    setArmed(false);
    setError("");
    if (typeof evaluate === "function") {
      await evaluate(buildWebElementPickerScript("clear"), { expectResult: false }).catch(() => {});
    }
  }, [evaluate]);

  const stopPicker = useCallback(async () => {
    setArmed(false);
    if (typeof evaluate === "function") {
      await evaluate(buildWebElementPickerScript("disable"), { expectResult: false }).catch(() => {});
    }
  }, [evaluate]);

  const armPicker = useCallback(async () => {
    setError("");
    try {
      selectedIdRef.current = "";
      setSelectedContext(null);
      await runPickerAction("enable", { expectResult: false });
      if (mountedRef.current) {
        setArmed(true);
      }
    } catch (err) {
      if (mountedRef.current) {
        setArmed(false);
        setError(err?.message || String(err || "Unable to start element picker."));
      }
    }
  }, [runPickerAction]);

  const togglePicker = useCallback(() => {
    if (armed) {
      void stopPicker();
      return;
    }
    void armPicker();
  }, [armPicker, armed, stopPicker]);

  useEffect(() => {
    if (!enabled) {
      selectedIdRef.current = "";
      setSelectedContext(null);
      setArmed(false);
      setError("");
      if (typeof evaluate === "function") {
        void evaluate(buildWebElementPickerScript("clear"), { expectResult: false }).catch(() => {});
      }
    }
  }, [enabled, evaluate]);

  useEffect(() => {
    selectedIdRef.current = "";
    setSelectedContext(null);
    setArmed(false);
    setError("");
    if (typeof evaluate === "function") {
      void evaluate(buildWebElementPickerScript("clear"), { expectResult: false }).catch(() => {});
    }
  }, [currentUrl, evaluate]);

  useEffect(() => {
    if (!armed || !enabled || typeof evaluate !== "function") {
      return undefined;
    }
    let disposed = false;
    let timeoutId = 0;
    const poll = async () => {
      if (disposed) {
        return;
      }
      try {
        const result = await evaluate(buildWebElementPickerScript("selection"), { expectResult: true });
        if (disposed) {
          return;
        }
        const nextContext = normalizeContext(result, meta);
        setError("");
        if (nextContext) {
          if (selectedIdRef.current !== nextContext.id) {
            selectedIdRef.current = nextContext.id;
            setSelectedContext(nextContext);
          }
          if (result?.enabled === false) {
            setArmed(false);
            return;
          }
        } else if (result?.enabled === false) {
          setArmed(false);
          return;
        }
      } catch (err) {
        if (!disposed) {
          setError(err?.message || String(err || "Unable to read selected element."));
        }
      }
      timeoutId = window.setTimeout(poll, POLL_MS);
    };
    timeoutId = window.setTimeout(poll, 80);
    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [armed, enabled, evaluate, meta]);

  const contextRefs = useMemo(() => (
    selectedContext ? [selectedContext] : []
  ), [selectedContext]);

  return {
    armed,
    armPicker,
    clearSelection,
    contextRefs,
    error,
    selectedContext,
    stopPicker,
    togglePicker,
  };
}
