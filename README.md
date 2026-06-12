<div align="center">

```text
██████╗ ██╗███████╗███████╗    ███████╗ ██████╗ ██████╗  ██████╗ ███████╗     █████╗ ██╗
██╔══██╗██║██╔════╝██╔════╝    ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝    ██╔══██╗██║
██║  ██║██║█████╗  █████╗      █████╗  ██║   ██║██████╔╝██║  ███╗█████╗      ███████║██║
██║  ██║██║██╔══╝  ██╔══╝      ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝      ██╔══██║██║
██████╔╝██║██║     ██║         ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗    ██║  ██║██║
╚═════╝ ╚═╝╚═╝     ╚═╝         ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝    ╚═╝  ╚═╝╚═╝
```

### ⚒️ **The Paragon of ADEs** — Agentic Development Environments

*Where AI agents, voice, screenshots, assets, and your entire dev workflow are forged into one native desktop app.*

![Rust](https://img.shields.io/badge/Rust-core-orange?logo=rust) ![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-webview-61DAFB?logo=react) ![macOS](https://img.shields.io/badge/macOS-✓-black?logo=apple) ![Windows](https://img.shields.io/badge/Windows-✓-0078D4) ![Linux](https://img.shields.io/badge/Linux-✓-FCC624?logo=linux&logoColor=black)

</div>

---

## 🔥 What is Diff Forge AI?

**Diff Forge AI** is not another IDE with a chatbot bolted on. It is an **ADE — an Agentic Development Environment**: a native desktop command center built in **Rust + Tauri** where *fleets of AI coding agents* do the work, and you direct, observe, and forge the results.

IDEs were built for humans typing. ADEs are built for humans **orchestrating** — multiple agents across multiple terminals and worktrees, coordinated by a local kernel that handles file leases, patch submission, and merge safety, so agents never trample each other. You snip a screenshot, speak a prompt, drag an asset, and the forge takes it from there.

> 🏛️ **A Paragon of ADEs** — every subsystem (voice, vision, assets, terminals, todos, tokenomics) is a first-class citizen wired into the agent loop, not a plugin afterthought.

---

## 🧰 The Toolset

### 🤖 Multi-Agent Terminals & Coordination Kernel
- Run **many coding agents in parallel** (Claude Code, Codex, and friends) in native terminal panes.
- A local **coordination kernel (MCP)** hands out task contexts, **file leases**, and checkpoints — agents queue instead of colliding, and parked agents **auto-wake** when their dependencies merge.
- **Isolated agent worktrees** with automatic patch validation, integration, and cloud-synced task history.
- **Multi-account agent profiles** — auto-captured credentials, per-profile usage tracking, instant identity switching per terminal.

### ✂️ Snipping Studio
- Global-hotkey **full screenshots** and **area snips** with a frozen, multi-display, mixed-DPI-correct overlay.
- 🫥 **Auto-hides desktop icon clutter** during capture (ScreenCaptureKit window exclusion on macOS — zero flicker, zero Finder restarts) and brings it back after.
- Instant **draggable snip previews** that stack, reorder with snappy physics, and drop straight into agent prompts.
- A full **annotation editor** — arrows, boxes, highlights, text, crop — with copy/paste of annotations between snips.
- Works on the main screen, other Spaces, and **over other apps' fullscreen windows**.

### 🎙️ Voice, Dictation & Speech-to-Text
- **Push-to-talk dictation** anywhere via a Wispr-style bottom-bar widget with live waveform feedback.
- Three transcription engines: **local Whisper** (offline), **cloud Deepgram** (warm-socket fast path for near-instant starts), and a **GPT-Realtime voice agent** that can drive the app hands-free.
- **Voice text rules** for custom vocabulary correction, and mic arbitration that lets dictation *borrow* the mic from a live voice-agent session and hand it back.
- 🎛️ Voice **device control** — the voice agent can trigger the same remote-control registry the dashboard uses.

### 🗃️ Asset Management & Custom Clouds
- A local-first **asset vault**: snips, recordings, files, and generated artifacts organized per workspace, with untracked (never-committed) storage for scratch media.
- ☁️ **Bring your own bucket** — register custom **S3 / Cloudflare R2 / Backblaze B2** clouds, verified with a live write-probe; credentials stay server-side.
- Drag-and-drop assets into terminals, threads, and agent prompts; media transcripts inline.

### 🗺️ Architecture Graphs
- A live **Architecture tab** rendering an eraser-style DSL (`.arch` files) — containers, API corridors, data flows, state machines, deployment maps.
- Agents read and write the same graphs through MCP tools, so **your diagrams stay in sync with what the agents actually build**.
- Provider-aware icons (AWS/GCP/Azure tokens, product logos) and one-click **run targets** for graph-level operations.

### ✅ Todos, Threads & Dispatch
- Server-authoritative **todo sync across devices** with a full **history viewer** (device names + platform icons, not raw IDs).
- A Rust-side **dispatch brain**: receipts ledger, hook settlement, and native notifications — todos route to the right agent terminal automatically.
- Workspace **threads** for long-running conversations with full asset and snip context.

### 📊 Tokenomics
- Real-time **credit and usage metering** across every agent account and provider.
- Device-authoritative display snapshots synced through the cloud — what you see is exactly what was spent.
- Per-profile sources with an account **switcher UI** and stale-data indicators.

### 🫥 Background Mode & Tray
- Collapse the whole app into a **menu-bar / tray popover** (Tokenomics · Activity · Snippets) that works **over fullscreen apps on macOS** (accessory activation policy + status-window level, like a real menu-bar app).
- ⌨️ Global **activity overlay** hotkey for an instant glance at running agents without switching windows.

### 🌐 Workspaces, Cloud Sync & Presence
- **Local-first workspaces** with a cloud catalog authority — open the same project graph from any device.
- A resilient **cloud sync outbox** (coalescing, backoff, replay) keeps task lifecycles, checkpoints, and lane claims flowing even through flaky networks.
- **Connection-authoritative presence** — every device shows up instantly, with live state broadcast.

### 🎛️ Remote Controls & Dashboard
- A unified **remote-control registry**: one control spec expands into the web dashboard, websocket commands, and the voice agent's tool surface simultaneously.
- Start snips, toggle modes, and steer agents **from your phone or another machine**.

### 🔌 MCP Everywhere
- A **workspace MCP gateway** mounts any user-installed MCP server into every agent terminal, namespaced and hot-reloadable.
- Cloud MCP context packs are fetched by the Rust core and published to agents automatically — no manual wiring.

### 🛠️ And the rest of the forge…
- 📁 **Files & Git views** with diff-centric navigation
- 🌍 Embedded **web view** for in-app reference and testing
- 🧪 **Developer process manager** for dev servers and long-running jobs
- 🔔 Native **notifications** with action routing back into the app
- 🧭 **Spec graphs**, **plans**, and **diagnostics** panels
- ⚡ Obsessively tuned: warm window pools, code-split webviews, paint-then-show windows, prewarmed sockets — *everything opens instantly*

---

## 🏗️ How It's Built

```text
┌────────────────────────────────────────────────────────────────────┐
│  🖥️  Diff Forge AI (this repo)                                     │
│                                                                    │
│   React WebViews ──────────── Tauri IPC ──────────── Rust Core     │
│   (app shell, snipping        (commands,             (terminals,   │
│    overlays, widgets,          events)                capture,     │
│    tray popover)                                      audio, sync, │
│                                                       coordination)│
└───────────────────────────────┬────────────────────────────────────┘
                                │  WebSockets / HTTPS
                    ┌───────────▼────────────┐
                    │ ☁️  Diff Forge Cloud   │
                    │  presence · todo sync  │
                    │  tokenomics · assets   │
                    │  remote controls       │
                    └────────────────────────┘
```

| Layer | Tech |
|---|---|
| 🦀 Native core | Rust, Tauri v2, ScreenCaptureKit / CoreGraphics / Win32, xcap, whisper |
| 🎨 UI | React 18, styled-components, Vite (code-split per window) |
| 🔗 Agent protocol | Model Context Protocol (MCP) — local kernel + workspace gateway |
| ☁️ Cloud | Rust websocket services, SQLite, S3-compatible object storage |

---

## 🚀 Development

```bash
npm install
npm run dev     # native Tauri window + Vite hot reload in the WebView
npm run build   # production bundles
```

`npm run dev` launches the native Tauri window and uses Vite hot reloading inside the JavaScript WebView. `npm run build` and `npm run package` create the downloadable Windows installer under `src-tauri/target/release/bundle/nsis/`.

During development, Vite runs on `127.0.0.1` as a private hot-reload feed for the native WebView. That URL is not the product surface and is not used by packaged builds.

### 🔐 Auth & Cloud

Desktop login opens `https://diffforge.ai/desktop/login` in the system browser, receives a `diffforge://auth/callback` deep link, exchanges the one-time code with `https://diffforge.ai/api/desktop/sessions/exchange`, and validates stored desktop sessions on app launch.

Cloud MCP traffic is pinned to `https://balancer.diffforge.ai`. Cloud MCP URL overrides are ignored unless `RUST_DIFFFORGE_ALLOW_LOCAL_CLOUD_MCP=1` is set for development. After desktop login, the app keeps the desktop session token locally and exchanges it through `next-diffforge` for short-lived Appwrite JWTs before opening balancer websockets or syncing coordination events.

---

<div align="center">

**🔥 Forged for the age of agents. ⚒️**

*Diff Forge AI — snip it, say it, ship it.*

</div>
