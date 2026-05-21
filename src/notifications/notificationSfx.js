const NOTIFICATION_SFX_STORAGE_KEY = "diffforge.notificationSfx.v1";
const DEFAULT_VOLUME = 0.32;

function readSettings() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { enabled: true, volume: DEFAULT_VOLUME };
    }
    const parsed = JSON.parse(window.localStorage.getItem(NOTIFICATION_SFX_STORAGE_KEY) || "{}");
    const volume = Number.parseFloat(parsed?.volume);
    return {
      enabled: parsed?.enabled !== false,
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : DEFAULT_VOLUME,
    };
  } catch {
    return { enabled: true, volume: DEFAULT_VOLUME };
  }
}

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function playTone(context, frequency, startAt, duration, gainNode) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(1, startAt + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(envelope);
  envelope.connect(gainNode);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function playSequence(context, notes, volume) {
  const gainNode = context.createGain();
  const startAt = context.currentTime + 0.01;
  gainNode.gain.setValueAtTime(Math.max(0.01, Math.min(0.6, volume)), startAt);
  gainNode.connect(context.destination);
  notes.forEach((note) => {
    playTone(
      context,
      note.frequency,
      startAt + note.offset,
      note.duration,
      gainNode,
    );
  });
  const endAt = startAt + Math.max(...notes.map((note) => note.offset + note.duration)) + 0.04;
  gainNode.gain.setValueAtTime(Math.max(0.01, Math.min(0.6, volume)), endAt - 0.03);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);
  window.setTimeout(() => {
    try {
      gainNode.disconnect();
    } catch {
      // The node may already be disconnected if the context was closed.
    }
  }, Math.ceil((endAt - context.currentTime) * 1000) + 60);
}

export function createWorkspaceNotificationSfx() {
  let context = null;
  let unlocked = false;

  const ensureContext = async () => {
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) return null;
    if (!context) {
      context = new AudioContextConstructor();
    }
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return null;
      }
    }
    unlocked = context.state === "running";
    return context;
  };

  return {
    dispose() {
      if (context) {
        try {
          context.close();
        } catch {
          // Audio cleanup is best effort.
        }
      }
      context = null;
      unlocked = false;
    },

    async play(kind) {
      const settings = readSettings();
      if (!settings.enabled || !unlocked) return;
      const activeContext = await ensureContext();
      if (!activeContext) return;

      if (kind === "approval.required") {
        playSequence(activeContext, [
          { duration: 0.07, frequency: 880, offset: 0 },
          { duration: 0.08, frequency: 1174.66, offset: 0.095 },
        ], settings.volume);
        return;
      }

      if (kind === "all.done") {
        playSequence(activeContext, [
          { duration: 0.06, frequency: 523.25, offset: 0 },
          { duration: 0.06, frequency: 659.25, offset: 0.075 },
          { duration: 0.09, frequency: 783.99, offset: 0.15 },
        ], settings.volume * 0.82);
      }
    },

    async unlock() {
      await ensureContext();
    },
  };
}
