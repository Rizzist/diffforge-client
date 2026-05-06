# Diffforge Desktop

Tauri desktop shell for Diffforge.

## Commands

```bash
npm install
npm run dev
npm run build
```

`npm run dev` launches the native Tauri window and uses Vite hot reloading inside the JavaScript WebView. `npm run build` and `npm run package` create the downloadable Windows installer under `src-tauri/target/release/bundle/nsis/`.

During development, Vite runs on `127.0.0.1` as a private hot-reload feed for the native WebView. That URL is not the product surface and is not used by packaged builds.

The placeholder login screen does not authenticate yet. The app currently checks the hosted Next.js API at `https://diffforge.ai/api/hello` through the Rust Tauri host.
