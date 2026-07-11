const terminalMetricsState = {
  terminal_count: 0,
  ipcEvents: 0,
  ipcBytes: 0,
  outputLagMs: 0,
  startupMs: 0,
  gridMs: 0,
  webglMs: 0,
  resizeBatches: 0,
  resizePanes: 0,
  resizeLagMs: 0,
};

export function patchTerminalMetrics(patch) {
  Object.assign(terminalMetricsState, patch);
}

export function addTerminalMetrics(delta) {
  Object.entries(delta).forEach(([key, value]) => {
    terminalMetricsState[key] = (terminalMetricsState[key] || 0) + value;
  });
}
