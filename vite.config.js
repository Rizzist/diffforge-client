import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Debug/dev bundles swap in React's profiling build so <Profiler> onRender
// reports real commit durations (names the slow subtree behind UI freezes).
// The tauri debug pipeline (`tauri build --debug`) exports TAURI_ENV_DEBUG.
const useReactProfiling = process.env.TAURI_ENV_DEBUG === "true"
  || process.env.VITE_REACT_PROFILING === "1";

export default defineConfig({
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  // Keep component/function names through minification so runtime diagnostics
  // (renderLoopProbe commit-storm censuses) report real names, not "ti"/"Zo".
  esbuild: { keepNames: true },
  plugins: [react()],
  resolve: {
    alias: useReactProfiling
      ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }]
      : [],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
