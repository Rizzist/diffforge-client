// Placeholder data for Aura Mode. UI-only for now — this module is the seam
// where live device/workspace/terminal/todo/script/docs/MCP state will be
// injected later. Shape mirrors the fleet: devices own workspaces, workspaces
// own terminals + todo queues, and the local device also exposes scripts.

export const AURA_MOCK_STATE = {
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
          terminals: [
            { id: "t4", name: "claude", state: "attention" },
            { id: "t5", name: "tauri dev", state: "running" },
            { id: "t9", name: "codex", state: "running" },
          ],
          todos: {
            queued: 1,
            running: 2,
            done: 22,
            active: ["Aura device tree", "Widget error sizing"],
            waiting: ["Commit review pass"],
          },
        },
        {
          id: "ws-next",
          name: "next-diffforge",
          terminals: [
            { id: "t6", name: "opencode", state: "idle" },
            { id: "t7", name: "vite", state: "done" },
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
          terminals: [{ id: "t8", name: "render", state: "running" }],
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
          terminals: [
            { id: "t1", name: "claude", state: "running" },
            { id: "t2", name: "codex", state: "running" },
            { id: "t3", name: "server", state: "idle" },
          ],
          todos: {
            queued: 3,
            running: 2,
            done: 14,
            active: ["Settlement ledger", "WS envelope v2"],
            waiting: ["Capability pipe", "Heartbeat merge", "Golden transcripts"],
          },
        },
        {
          id: "ws-balancer",
          name: "balancer",
          terminals: [{ id: "t10", name: "drain-watch", state: "idle" }],
          todos: { queued: 0, running: 0, done: 3, active: [], waiting: [] },
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
          terminals: [{ id: "t11", name: "runframe", state: "done" }],
          todos: { queued: 1, running: 0, done: 7, active: [], waiting: ["Fanout retest"] },
        },
      ],
      scripts: [],
    },
  ],
  docs: [
    { id: "doc-1", name: "Architecture.md" },
    { id: "doc-2", name: "Deploy Runbook" },
    { id: "doc-3", name: "Voice Pipeline" },
    { id: "doc-4", name: "Billing Spec" },
    { id: "doc-5", name: "Release Notes" },
  ],
  mcps: [
    { id: "mcp-1", name: "cloud-mcp" },
    { id: "mcp-2", name: "secrets-vault" },
    { id: "mcp-3", name: "browser" },
    { id: "mcp-4", name: "pcb-tools" },
  ],
  activityFeed: [
    "rust-diffforge / claude needs attention",
    "deploy-web script running on MacBook Pro",
    "todo completed in cloud-diffforge",
    "diffforge-video render at 62%",
    "asset-prune script failed — exit 1",
    "byoc-us-east synced 3 workspaces",
    "next-diffforge vite build finished",
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
};

export const AURA_STATE_LABELS = {
  running: "Running",
  attention: "Needs attention",
  idle: "Idle",
  done: "Completed",
  failed: "Failed",
  standby: "Standby",
  online: "Online",
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

/* Unique branch hues, assigned per workspace in encounter order so sibling
   branches never share a color (node cores still show state color). */
export const AURA_BRANCH_HUES = [
  "#4fd8ff",
  "#ffb24d",
  "#b48cff",
  "#52e5a3",
  "#ff7ab8",
  "#ffd27d",
  "#7dffe0",
  "#9db7ff",
];

/* Workspace state = worst terminal state (attention > running > idle/done). */
export function auraWorkspaceState(workspace) {
  const states = (workspace?.terminals || []).map((terminal) => terminal.state);
  if (states.includes("attention")) return "attention";
  if (states.includes("running")) return "running";
  if (states.length && states.every((state) => state === "done")) return "done";
  return "idle";
}
