const NOTIFICATION_SFX_STORAGE_KEY = "diffforge.notificationSfx.v1";
const DEFAULT_VOLUME = 0.32;
const DING_SOUND_PATH = "/ding.mp3";

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
  let dingAudio = null;
  let unlocked = false;

  const ensureDingAudio = () => {
    if (typeof window === "undefined" || typeof window.Audio !== "function") {
      return null;
    }
    if (!dingAudio) {
      dingAudio = new window.Audio(DING_SOUND_PATH);
      dingAudio.preload = "auto";
    }
    return dingAudio;
  };

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

  const playDing = async (volume) => {
    const audio = ensureDingAudio();
    if (!audio) return false;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.max(0.01, Math.min(0.82, volume));
      await audio.play();
      return true;
    } catch {
      return false;
    }
  };

  const playFallbackTone = async (kind, volume) => {
    const activeContext = await ensureContext();
    if (!activeContext) return;

    if (kind === "all.done") {
      playSequence(activeContext, [
        { duration: 0.06, frequency: 523.25, offset: 0 },
        { duration: 0.06, frequency: 659.25, offset: 0.075 },
        { duration: 0.09, frequency: 783.99, offset: 0.15 },
      ], volume * 0.82);
      return;
    }

    playSequence(activeContext, [
      { duration: 0.07, frequency: 880, offset: 0 },
      { duration: 0.08, frequency: 1174.66, offset: 0.095 },
    ], volume);
  };

  return {
    dispose() {
      if (dingAudio) {
        try {
          dingAudio.pause();
        } catch {
          // Audio cleanup is best effort.
        }
      }
      dingAudio = null;
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
      if (await playDing(settings.volume)) {
        return;
      }
      await playFallbackTone(kind, settings.volume);
    },

    async unlock() {
      unlocked = true;
      const audio = ensureDingAudio();
      try {
        audio?.load();
      } catch {
        // Loading the MP3 is opportunistic; the oscillator fallback still works.
      }
      await ensureContext();
    },
  };
}
