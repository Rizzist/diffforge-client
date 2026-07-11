// Placeholder data for Aura Mode. UI-only for now — this module is the seam
// where live workspace/terminal/todo/docs/MCP state will be injected later.

export const AURA_MOCK_STATE = {
  workspaces: [
    {
      id: "ws-cloud",
      name: "cloud-diffforge",
      accent: "#4fd8ff",
      terminals: [
        { id: "t1", name: "claude", state: "running" },
        { id: "t2", name: "codex", state: "running" },
        { id: "t3", name: "server", state: "idle" },
      ],
      todos: { queued: 3, running: 2, done: 14 },
    },
    {
      id: "ws-rust",
      name: "rust-diffforge",
      accent: "#ff9a3c",
      terminals: [
        { id: "t4", name: "claude", state: "attention" },
        { id: "t5", name: "tauri dev", state: "running" },
      ],
      todos: { queued: 1, running: 1, done: 22 },
    },
    {
      id: "ws-next",
      name: "next-diffforge",
      accent: "#b48cff",
      terminals: [
        { id: "t6", name: "opencode", state: "idle" },
        { id: "t7", name: "vite", state: "done" },
      ],
      todos: { queued: 0, running: 1, done: 9 },
    },
    {
      id: "ws-video",
      name: "diffforge-video",
      accent: "#52e5a3",
      terminals: [{ id: "t8", name: "render", state: "running" }],
      todos: { queued: 2, running: 0, done: 5 },
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
};

export const AURA_STATE_COLORS = {
  running: "#4fd8ff",
  attention: "#ffb24d",
  idle: "#77839a",
  done: "#52e5a3",
};

export const AURA_STATE_LABELS = {
  running: "Running",
  attention: "Needs attention",
  idle: "Idle",
  done: "Completed",
};
