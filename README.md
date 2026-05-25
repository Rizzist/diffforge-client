# Diff Forge AI

Tauri desktop shell for Diff Forge AI.

## Commands

```bash
npm install
npm run dev
npm run build
```

`npm run dev` launches the native Tauri window and uses Vite hot reloading inside the JavaScript WebView. `npm run build` and `npm run package` create the downloadable Windows installer under `src-tauri/target/release/bundle/nsis/`.

During development, Vite runs on `127.0.0.1` as a private hot-reload feed for the native WebView. That URL is not the product surface and is not used by packaged builds.

Desktop login opens `https://diffforge.ai/desktop/login` in the system browser, receives a `diffforge://auth/callback` deep link, exchanges the one-time code with `https://diffforge.ai/api/desktop/sessions/exchange`, and validates stored desktop sessions on app launch.

Cloud MCP traffic defaults to `https://balancer.diffforge.ai`. Localhost Cloud
MCP URL overrides are ignored unless `RUST_DIFFFORGE_ALLOW_LOCAL_CLOUD_MCP=1`
is set for development. After desktop login, the app keeps the desktop session
token locally and exchanges it through `next-diffforge` for short-lived
Appwrite JWTs before opening balancer websockets or syncing coordination
events.
