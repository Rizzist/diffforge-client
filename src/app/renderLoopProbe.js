import { invoke } from "@tauri-apps/api/core";

/*
 * renderLoopProbe — lightweight always-on watchdog for React commit storms
 * (the "app idles at 100% CPU with no visible changes" class of bug). It
 * installs a minimal React DevTools hook shim (must run BEFORE react-dom is
 * evaluated) that counts commits per interval. While a storm is active
 * (>RENDER_PROBE_STORM_COMMITS commits per 5s window) it walks the last
 * committed fiber tree once per window and logs the component names that
 * performed work, so logs/terminal-statuses.jsonl names the looping subtree
 * (phase "frontend.render_probe.storm"). Idle cost: one integer increment per
 * commit and a 5s interval check.
 */

const RENDER_PROBE_INTERVAL_MS = 5000;
const RENDER_PROBE_STORM_COMMITS = 40;
const RENDER_PROBE_MAX_FIBERS = 40000;
const RENDER_PROBE_TOP_NAMES = 24;
/* React fiber flag: this fiber re-rendered in the committed work loop. */
const PERFORMED_WORK_FLAG = 0b1;

function renderProbeComponentName(fiber) {
  const type = fiber.type;
  if (!type || typeof type === "string") {
    return "";
  }
  return (
    type.displayName
    || type.name
    || type.render?.displayName
    || type.render?.name
    || (typeof type === "symbol" ? String(type) : "")
    || ""
  );
}

/* Named ancestor chain for a fiber — locates a subtree in the component tree. */
function renderProbeAncestry(fiber) {
  const names = [];
  let current = fiber?.return;
  while (current && names.length < 8) {
    const name = renderProbeComponentName(current);
    if (name) {
      names.unshift(name);
    }
    current = current.return;
  }
  return names.join(" > ");
}

function renderProbeValuePreview(value) {
  try {
    if (value === null || value === undefined) return String(value);
    const type = typeof value;
    if (type === "function") return "fn";
    if (type !== "object") return String(value).slice(0, 60);
    if (Array.isArray(value)) {
      return `arr(${value.length})[${value.slice(0, 3).map((entry) => renderProbeValuePreview(entry)).join(",").slice(0, 60)}]`;
    }
    return JSON.stringify(value, (key, entryValue) => (
      typeof entryValue === "function" ? "fn" : entryValue
    )).slice(0, 90);
  } catch {
    return "(unpreviewable)";
  }
}

/*
 * Which useState/useReducer hooks changed identity in this commit? Effect
 * hooks are skipped (no update queue). The changed hook's index + value
 * preview names the churning state directly.
 */
function renderProbeChangedHooks(fiber) {
  const changed = [];
  let hook = fiber.memoizedState;
  let altHook = fiber.alternate?.memoizedState;
  let index = 0;
  while (hook && altHook && index < 512 && changed.length < 6) {
    if (hook.queue && hook.memoizedState !== altHook.memoizedState) {
      changed.push(`#${index}=${renderProbeValuePreview(hook.memoizedState)}`);
    }
    hook = hook.next;
    altHook = altHook.next;
    index += 1;
  }
  return changed;
}

function renderProbeCollect(root) {
  const counts = new Map();
  let visited = 0;
  let performedWork = 0;
  // Topmost fibers that re-rendered while their parent did not: these are the
  // roots of the looping subtree(s) — i.e. where the churning state lives.
  const loopRoots = new Map();
  const stack = [root.current?.child].filter(Boolean);
  while (stack.length && visited < RENDER_PROBE_MAX_FIBERS) {
    const fiber = stack.pop();
    visited += 1;
    if ((fiber.flags & PERFORMED_WORK_FLAG) !== 0) {
      performedWork += 1;
      const name = renderProbeComponentName(fiber);
      if (name) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      const parentPerformed = fiber.return
        && (fiber.return.flags & PERFORMED_WORK_FLAG) !== 0;
      if (!parentPerformed && loopRoots.size < 6) {
        const hooks = typeof fiber.type === "function" ? renderProbeChangedHooks(fiber) : [];
        const label = `${name || "(anon)"} @ ${renderProbeAncestry(fiber)}`
          + (hooks.length ? ` :: hooks ${hooks.join(" ")}` : "");
        loopRoots.set(label, (loopRoots.get(label) || 0) + 1);
      }
    }
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  return {
    loopRoots: Array.from(loopRoots.keys()),
    performedWork,
    truncated: visited >= RENDER_PROBE_MAX_FIBERS,
    visited,
    top: Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, RENDER_PROBE_TOP_NAMES)
      .map(([name, count]) => `${name}x${count}`),
  };
}

export function installRenderLoopProbe() {
  if (typeof window === "undefined" || window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    return;
  }

  let commits = 0;
  let lastRoot = null;
  let counter = 0;
  const hook = {
    checkDCE: () => {},
    isDisabled: false,
    supportsFiber: true,
    supportsFlight: false,
    renderers: new Map(),
    inject(renderer) {
      counter += 1;
      hook.renderers.set(counter, renderer);
      return counter;
    },
    getFiberRoots: () => new Set(),
    onScheduleFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    onCommitFiberRoot(_rendererId, root) {
      commits += 1;
      lastRoot = root;
    },
    setStrictMode: () => {},
    sub: () => () => {},
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  let lastCommitCount = 0;
  let stormWindows = 0;
  window.setInterval(() => {
    const delta = commits - lastCommitCount;
    lastCommitCount = commits;
    if (delta < RENDER_PROBE_STORM_COMMITS || !lastRoot) {
      stormWindows = 0;
      return;
    }
    stormWindows += 1;
    let fields;
    try {
      fields = {
        commitsPerWindow: delta,
        stormWindows,
        totalCommits: commits,
        windowMs: RENDER_PROBE_INTERVAL_MS,
        ...renderProbeCollect(lastRoot),
      };
    } catch (error) {
      fields = {
        commitsPerWindow: delta,
        stormWindows,
        error: String(error?.message || error),
      };
    }
    invoke("terminal_status_log", {
      phase: "frontend.render_probe.storm",
      fields,
    }).catch(() => {});
  }, RENDER_PROBE_INTERVAL_MS);
}

installRenderLoopProbe();
