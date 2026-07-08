<div align="center">

# بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

*In the Name of God, the Most Beneficent, the Most Merciful*

<br/>

<img src=".github/diffforge-banner.svg" alt="DIFF FORGE AI" width="760">

### ⚒️ **The Paragon of ADEs** — Agentic Development Environments

*Where AI agents, voice, screenshots, assets, loops, and your entire dev workflow are forged into one native desktop app.*

![Version](https://img.shields.io/github/v/release/Rizzist/diffforge-client?label=Diff%20Forge&color=2f80ff) ![Rust](https://img.shields.io/badge/Rust-core-orange?logo=rust) ![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![macOS](https://img.shields.io/badge/macOS-✓-black?logo=apple) ![Windows](https://img.shields.io/badge/Windows-✓-0078D4) ![Linux](https://img.shields.io/badge/Linux-✓-FCC624?logo=linux&logoColor=black)

<br/>

[![Watch Diff Forge in action](.github/diffforge-demo-thumb.jpg)](https://www.diffforge.ai)

*The forge at work — agents, voice, snips, loops, and the grid. **[See it live at diffforge.ai →](https://www.diffforge.ai)***

</div>

---

## 🔥 What is Diff Forge AI?

**Diff Forge AI** is not another IDE with a chatbot bolted on. It is an **ADE — an Agentic Development Environment**: a native desktop command center built in **Rust + Tauri** where *fleets of AI coding agents* — **Claude Code, Codex, and OpenCode** — do the work, and you direct, observe, and forge the results.

IDEs were built for humans typing. ADEs are built for humans **orchestrating** — many agents across terminals, panes, swarms, and automated loops, coordinated by a local kernel that tracks tasks, checkpoints, and merge safety so you always know who's doing what. You snip a screenshot, speak a prompt, drag an asset, wire a loop, and the forge takes it from there.

> 🏛️ **A Paragon of ADEs** — every subsystem (voice, vision, assets, terminals, todos, loops, tokenomics) is a first-class citizen wired into the agent loop, not a plugin afterthought.

---

## 🧰 The Toolset

### 🤖 Multi-Agent Terminals & Coordination Kernel
- Run **many coding agents in parallel** — first-class **Claude Code**, **Codex**, and **OpenCode** terminals (plus plain shells) in a native grid with tabs, Big View, and breakout windows.
- Pick **model, reasoning effort, and speed per launch** — GPT‑5.5 / GPT‑5.4 for Codex, Sonnet / Opus / Fable for Claude, any model string for OpenCode — with per-workspace defaults, and change them mid-session with idle-aware injection.
- A local **coordination kernel (MCP)** hands out task context and checkpoints, with optional **isolated agent worktrees** and automatic patch validation and integration — shared activity state, not write barriers.
- **Multi-account agent profiles** — auto-captured credentials, per-profile usage tracking, instant identity switching per terminal.
- Parked agents **auto-wake** when dependencies merge; queued prompts, shutdown recovery, and transcript-backed status survive restarts.

### 🌀 Loopspaces — Visual Agent Automation
- A node-graph **loop builder**: dispatch todos to agents, run scripts, send messages, read and write documents and assets — wired together on a canvas with contract-validated edges.
- **Manual, cron, and webhook triggers** fire loops; a lockstep runtime executes them with a live event timeline and **checkpoint/resume** durability.
- Watch and steer runs from the desktop or the web dashboard's **Loops** tab — the same runtime state, everywhere.

### 🐝 Swarm Panel
- Spin up a **constellation of agents** — Codex, Claude Code, and OpenCode members — inside one pane, each with its own status, stats, and activity feed.
- **Plan and Implement run modes** with scout → fan-out → collect → synthesize orchestration and full run history.
- Swarm outcomes settle into todos, so results flow back into the normal dispatch loop.

### 🎬 Video Editor
- A full **video pane**: media bin with folders and filters, multi-track timeline, preview transport, text overlays, and popout editing windows.
- **Word-level transcript editing** — search the transcript, cut by words, keep ranges, generate captions.
- **AI media generation** built in: text-to-video, image-to-video, image edit, and upscaling — rendered straight into the project's media library.
- **HyperFrames** code compositions (declare → author → render) and ffmpeg-powered export, frame capture, and format conversion.

### 🔌 PCB Workbench
- Design circuit boards as **tscircuit `.board.tsx` files** under `hardware/` — live schematic, PCB wiring, 3D, assembly, pinout, simulation, and BOM tabs.
- An **element picker** (2D and 3D) that slices the exact component into agent context — point at a resistor, ask the agent about it.
- Board ownership manifests, file watchers, multi-slot resizable panels, and native popout windows.

### 🌐 Web Panels
- **Native child webviews** as workspace panes — validated navigation, lifecycle control, and popouts that **adopt the live webview without a reload**.
- A **web element picker** and prompt overlay: select something on the page and submit it straight to the agent of your choice.

### ✂️ Snipping Studio
- Global-hotkey **full screenshots**, **area snips**, and **area recordings** with a frozen, multi-display, mixed-DPI-correct overlay.
- 🫥 **Auto-hides desktop icon clutter** during capture (ScreenCaptureKit window exclusion on macOS — zero flicker, zero Finder restarts) and brings it back after.
- Instant **draggable snip previews** that stack, reorder with snappy physics, and drop straight into agent prompts, threads, and todos.
- A full **annotation editor** — arrows, boxes, highlights, text, crop — with copy/paste of annotations between snips.
- Works on the main screen, other Spaces, and **over other apps' fullscreen windows**.

### 🎙️ Voice, Dictation & Speech-to-Text
- **Push-to-talk dictation** anywhere via a Wispr-style bottom-bar widget with live waveform and a realtime transcript overlay.
- Three transcription engines: **local Whisper** (offline), **cloud Deepgram**, and the **Diff Forge Cloud fast path** (warm sockets, near-instant starts).
- A separate **GPT-Realtime voice agent** that can drive the app hands-free through the same remote-control registry the dashboard uses.
- **Dictionaries, snippets, transforms, polishing, and voice text rules** for custom vocabulary — plus handsfree insertion into whatever app has focus.
- Mic arbitration that lets dictation *borrow* the mic from a live voice-agent session and hand it back.

### 🔔 Notifications & Attention
- Native notifications (macOS UserNotifications, plugin fallback elsewhere) for **approvals, agent questions, failures, todo completion, and all-work-done** — an attention ladder pings you once, at the right level, and suppresses itself when you're already looking.
- Per-pane seen state, notification sounds, and workspace badges that mirror across devices.
- 📱 **Web Push to your phone** — loop and agent events land on the installed Diff Forge PWA, no desktop required.

### 🗃️ Asset Management & Custom Clouds
- A local-first **asset vault**: snips, recordings, files, and generated artifacts per workspace — plus **account-level assets**, tracked or untracked, private or public.
- ☁️ **Bring your own bucket** — register custom **S3 / Cloudflare R2 / Backblaze B2** clouds, verified with a live write-probe; credentials stay server-side.
- Drag-and-drop assets into terminals, threads, and agent prompts; media transcripts inline.

### ✅ Todos, Threads & Dispatch
- Server-authoritative **todo sync across devices** with a full **history viewer** (device names + platform icons, not raw IDs).
- A Rust-side **dispatch brain**: receipts ledger, hook settlement, and native notifications — todos route to the right agent terminal automatically.
- Workspace **threads** for long-running conversations with full asset and snip context, and **plans** with editable steps, timers, and tags.

### 📊 Tokenomics
- Real-time **credit and usage metering** across every agent account and provider — local SQLite event ledger with rollups, provider-limit merging, and retention pruning.
- Device-authoritative display snapshots synced through the cloud — what you see is exactly what was spent.
- Per-profile sources with an account **switcher UI** and stale-data indicators.

### 🫥 Background Mode & Tray
- Collapse the whole app into a **menu-bar / tray popover** (Tokenomics · Activity · Snippets) that works **over fullscreen apps on macOS** (accessory activation policy + status-window level, like a real menu-bar app).
- **Open at login**, configurable tray-click actions, and permission flows for capture and accessibility.
- ⌨️ Global **activity overlay** hotkey for an instant glance at running agents without switching windows.

### 🌐 Workspaces, Cloud Sync & Presence
- **Local-first workspaces** with a cloud catalog authority — open the same project graph from any device.
- A resilient **cloud sync outbox** (coalescing, backoff, replay) keeps todos, loops, assets, docs, tokenomics, and live device state flowing even through flaky networks; agent task history stays local by design.
- **Connection-authoritative presence** — every device shows up instantly, with live state broadcast.

### 🎛️ Remote Controls & Dashboard
- A unified **remote-control registry**: one control spec expands into the web dashboard, websocket commands, and the voice agent's tool surface simultaneously.
- A token-protected **app-control MCP bridge** (short-lived signed route tokens over the live connection) exposes docs, scripts, assets, workspaces, loops, and the video editor to remote tooling.
- Start snips, toggle modes, and steer agents **from your phone or another machine**.

### 🔌 MCP, Tools, Docs & Scripts
- A **workspace MCP gateway** mounts any user-installed MCP server into every agent terminal, namespaced and hot-reloadable — with an **MCP marketplace**, curated CLI and skill catalogs, and a secrets MCP.
- Account **Docs** with draft/publish flows and a rich renderer, local **Scripts** with one-click buttons, and a standalone **Tools window** you can pop out.
- Cloud MCP context packs are fetched by the Rust core and published to agents automatically — no manual wiring.

### 🛠️ And the rest of the forge…
- 📁 **Files & Git views** with diff-centric navigation
- 🖥️ **VM sandbox pane** and a **developer process manager** for dev servers and long-running jobs
- 🧭 **Plans** and **diagnostics** panels
- ⚡ Obsessively tuned: warm window pools, code-split webviews, paint-then-show windows, prewarmed sockets, WebGL terminals, energy-profiled idle — *everything opens instantly*

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
                    │  loops · tokenomics    │
                    │  assets · web push     │
                    │  remote controls       │
                    └────────────────────────┘
```

| Layer | Tech |
|---|---|
| 🦀 Native core | Rust, Tauri v2, ScreenCaptureKit / CoreGraphics / Win32 / PipeWire, xcap + scap, whisper |
| 🎨 UI | React 19, styled-components, Vite (code-split per window) |
| 🔗 Agent protocol | Model Context Protocol (MCP) — local kernel + workspace gateway + app-control bridge |
| ☁️ Cloud | Rust websocket services, SQLite, S3-compatible object storage |

---

## 🚀 Development

```bash
npm install
npm run dev     # native Tauri window + Vite hot reload in the WebView
npm run build   # production bundles
```

`npm run dev` launches the native Tauri window and uses Vite hot reloading inside the JavaScript WebView. `npm run build` and `npm run package` create the Windows NSIS installer locally under `src-tauri/target/release/bundle/nsis/`; release CI builds and publishes **macOS, Windows, and Linux** bundles (with `latest.json` + SHA256SUMS) as GitHub releases on this repo.

During development, Vite runs on `127.0.0.1` as a private hot-reload feed for the native WebView. That URL is not the product surface and is not used by packaged builds.

### 🔐 Auth & Cloud

Desktop login opens `https://diffforge.ai/desktop/login` in the system browser, receives a `diffforge://auth/callback` deep link (`diffforge-dev://` in dev builds), exchanges the one-time code with `https://diffforge.ai/api/desktop/sessions/exchange`, and validates stored desktop sessions on app launch. The Diff Forge CLI shares the same desktop auth state. In local-cloud development, the login and API base resolve to local `next-diffforge` when `RUST_DIFFFORGE_ALLOW_LOCAL_CLOUD_MCP=1`, or explicitly through `RUST_DIFFFORGE_WEB_LOGIN_URL` and `RUST_DIFFFORGE_API_BASE_URL`.

Cloud MCP traffic is pinned to `https://balancer.diffforge.ai`. Cloud MCP URL overrides are ignored unless `RUST_DIFFFORGE_ALLOW_LOCAL_CLOUD_MCP=1` is set for development. After desktop login, the app keeps the desktop session token locally and exchanges it through `next-diffforge` for short-lived Appwrite JWTs before opening balancer websockets or syncing coordination events.

---

## 📜 License

Licensed under the **[Kingdom of Abraham Permissive License (KOA-P-1.0)](LICENSE.md)** — an MIT-equivalent license for the AI Agents Era. Every copy must carry the license in full. See the [Kingdom Of Abraham Licenses](https://github.com/Rizzist/Kingdom-Of-Abraham-Licenses) collection.

---

<div align="center">

**🔥 Forged for the age of agents. ⚒️**

*Diff Forge AI — snip it, say it, ship it.*

</div>
