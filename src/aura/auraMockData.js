// Placeholder data for Aura Mode. UI-only for now — this module is the seam
// where live account/device/workspace/panel/todo/script/loop state will be
// injected later. Tree shape mirrors the fleet: account → devices →
// workspaces → panels (terminals are one panel kind among web/pcb/video/docs);
// the local device also carries scripts, and loop runs hang off the account.

export const AURA_MOCK_STATE = {
  account: { id: "acct", name: "Diff Forge AI" },
  devices: [
    {
      id: "dev-local",
      name: "MacBook Pro",
      kind: "local",
      status: "online",
      workspaces: [
        {
          id: "ws-rust",
          name: "rust-diffforge",
          panels: [
            { id: "p1", name: "claude", kind: "terminal", state: "attention" },
            { id: "p2", name: "tauri dev", kind: "terminal", state: "running" },
            { id: "p3", name: "codex", kind: "terminal", state: "running" },
            { id: "p4", name: "preview", kind: "web", state: "idle" },
          ],
          todos: {
            queued: 1,
            running: 2,
            done: 22,
            active: ["Aura single sphere", "Widget error sizing"],
            waiting: ["Commit review pass"],
          },
        },
        {
          id: "ws-next",
          name: "next-diffforge",
          panels: [
            { id: "p5", name: "opencode", kind: "terminal", state: "idle" },
            { id: "p6", name: "vite", kind: "terminal", state: "done" },
            { id: "p7", name: "docs", kind: "docs", state: "idle" },
          ],
          todos: {
            queued: 0,
            running: 1,
            done: 9,
            active: ["DataFast bot tracking"],
            waiting: [],
          },
        },
        {
          id: "ws-video",
          name: "diffforge-video",
          panels: [
            { id: "p8", name: "render", kind: "terminal", state: "running" },
            { id: "p9", name: "timeline", kind: "video", state: "running" },
          ],
          todos: {
            queued: 2,
            running: 1,
            done: 5,
            active: ["Hero v9 beat sheet"],
            waiting: ["Upscale pass", "Take detection"],
          },
        },
      ],
      scripts: [
        { id: "sc-1", name: "deploy-web", state: "running" },
        { id: "sc-2", name: "nightly-sync", state: "idle" },
        { id: "sc-3", name: "asset-prune", state: "failed" },
        { id: "sc-4", name: "perf-audit", state: "done" },
      ],
    },
    {
      id: "dev-cloud",
      name: "byoc-us-east",
      kind: "cloud",
      status: "online",
      workspaces: [
        {
          id: "ws-cloud",
          name: "cloud-diffforge",
          panels: [
            { id: "p10", name: "claude", kind: "terminal", state: "running" },
            { id: "p11", name: "server", kind: "terminal", state: "idle" },
          ],
          todos: {
            queued: 3,
            running: 2,
            done: 14,
            active: ["Settlement ledger", "WS envelope v2"],
            waiting: ["Capability pipe", "Heartbeat merge"],
          },
        },
      ],
      scripts: [],
    },
    {
      id: "dev-studio",
      name: "Studio PC",
      kind: "remote",
      status: "standby",
      workspaces: [
        {
          id: "ws-pcb",
          name: "pcb-lab",
          panels: [
            { id: "p12", name: "runframe", kind: "pcb", state: "done" },
            { id: "p13", name: "shell", kind: "terminal", state: "idle" },
          ],
          todos: { queued: 1, running: 0, done: 7, active: [], waiting: ["Fanout retest"] },
        },
      ],
      scripts: [],
    },
  ],
  loopRuns: [
    { id: "lr-1", name: "nightly-regression", state: "running" },
    { id: "lr-2", name: "asset-sweep", state: "queued" },
  ],
  activityFeed: [
    "rust-diffforge / claude needs attention",
    "deploy-web script running on MacBook Pro",
    "loop nightly-regression on lap 3",
    "todo completed in cloud-diffforge",
    "diffforge-video render at 62%",
    "asset-prune script failed — exit 1",
    "byoc-us-east synced 1 workspace",
  ],
};

export const AURA_STATE_COLORS = {
  running: "#4fd8ff",
  attention: "#ffb24d",
  idle: "#77839a",
  done: "#52e5a3",
  failed: "#ff6b6b",
  standby: "#77839a",
  online: "#52e5a3",
  queued: "#ffd27d",
};

export const AURA_STATE_LABELS = {
  running: "Running",
  attention: "Needs attention",
  idle: "Idle",
  done: "Completed",
  failed: "Failed",
  standby: "Standby",
  online: "Online",
  queued: "Queued",
};

export const AURA_DEVICE_KIND_COLORS = {
  local: "#ffb24d",
  cloud: "#4fd8ff",
  remote: "#b48cff",
};

export const AURA_DEVICE_KIND_LABELS = {
  local: "This device",
  cloud: "Cloud",
  remote: "Remote",
};

/* Panel kinds: shape + trim color distinguish the type; the node core still
   glows with the state color. */
export const AURA_PANEL_KIND_META = {
  terminal: { label: "Terminal", color: "#8fb7ff" },
  web: { label: "Web", color: "#4fd8ff" },
  pcb: { label: "PCB", color: "#52e5a3" },
  video: { label: "Video", color: "#ff7ab8" },
  docs: { label: "Docs", color: "#ffd27d" },
};

/* Workspace state = worst panel state (attention > running > done > idle). */
export function auraWorkspaceState(workspace) {
  const states = (workspace?.panels || []).map((panel) => panel.state);
  if (states.includes("attention")) return "attention";
  if (states.includes("running")) return "running";
  if (states.length && states.every((state) => state === "done")) return "done";
  return "idle";
}
