export function createPlaybackStore(initialMs = 0) {
  let ms = Math.max(0, Number(initialMs) || 0);
  let playing = false;
  const listeners = new Set();

  const notify = () => {
    for (const listener of [...listeners]) {
      listener(ms, playing);
    }
  };

  return {
    getMs() {
      return ms;
    },
    setMs(nextMs) {
      ms = Math.max(0, Number(nextMs) || 0);
      notify();
    },
    getPlaying() {
      return playing;
    },
    setPlaying(nextPlaying) {
      playing = Boolean(nextPlaying);
      notify();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
