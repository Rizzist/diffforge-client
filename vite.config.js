import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Opt-in only: React's profiling build makes <Profiler> onRender report real
// commit durations (names the slow subtree behind UI freezes), but it also
// slows every commit — measured as a large share of workspace-open lag in
// daily debug builds. Export VITE_REACT_PROFILING=1 to re-enable for hunts.
const useReactProfiling = process.env.VITE_REACT_PROFILING === "1";

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
