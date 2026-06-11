const NOTIFICATION_SFX_STORAGE_KEY = "diffforge.notificationSfx.v1";
const DEFAULT_VOLUME = 0.32;
const DING_SOUND_PATH = "/ding.mp3";
const DING_SOUND_MIN_INTERVAL_MS = 1200;
const TONE_MIN_INTERVAL_MS = 180;

// Each tone is a named recipe of oscillator notes. Tones marked `preferDing`
// keep the legacy ding.mp3 behavior; everything else gets a distinct synth
// sound so users can tell events apart without looking.
const TONE_RECIPES = {
  // Generic notification / terminal ready. Two-tone rise (legacy default).
  ready: {
    gain: 1,
    notes: [
      { duration: 0.07, frequency: 880, offset: 0 },
      { duration: 0.08, frequency: 1174.66, offset: 0.095 },
    ],
    preferDing: true,
    type: "sine",
  },
  // Agents finished. Major triad run.
  fanfare: {
    gain: 0.82,
    notes: [
      { duration: 0.06, frequency: 523.25, offset: 0 },
      { duration: 0.06, frequency: 659.25, offset: 0.075 },
      { duration: 0.09, frequency: 783.99, offset: 0.15 },
    ],
    type: "sine",
  },
  // Todo queue fully drained. Longer resolve up to the octave.
  drained: {
    gain: 0.85,
    notes: [
      { duration: 0.07, frequency: 523.25, offset: 0 },
      { duration: 0.07, frequency: 659.25, offset: 0.09 },
      { duration: 0.07, frequency: 783.99, offset: 0.18 },
      { duration: 0.16, frequency: 1046.5, offset: 0.27 },
    ],
    type: "sine",
  },
  // Approval / explicit user input required. Insistent double ping.
  attention: {
    gain: 1,
    notes: [
      { duration: 0.09, frequency: 987.77, offset: 0 },
      { duration: 0.12, frequency: 987.77, offset: 0.16 },
    ],
    type: "triangle",
  },
  // Agent or tool failure. Descending minor third.
  alert: {
    gain: 0.9,
    notes: [
      { duration: 0.1, frequency: 466.16, offset: 0 },
      { duration: 0.16, frequency: 369.99, offset: 0.12 },
    ],
    type: "triangle",
  },
  // Remote todo arrived. Soft "incoming" knock: low then bright.
  arrive: {
    gain: 0.9,
    notes: [
      { duration: 0.05, frequency: 587.33, offset: 0 },
      { duration: 0.1, frequency: 880, offset: 0.06 },
      { duration: 0.08, frequency: 1318.51, offset: 0.13 },
    ],
    type: "sine",
  },
  // Voice capture armed. Quick rising chirp.
  voiceOn: {
    gain: 0.85,
    notes: [
      { duration: 0.05, frequency: 659.25, offset: 0 },
      { duration: 0.09, frequency: 1046.5, offset: 0.055 },
    ],
    type: "sine",
  },
  // Voice capture stopped. Mirrored falling chirp.
  voiceOff: {
    gain: 0.85,
    notes: [
      { duration: 0.05, frequency: 1046.5, offset: 0 },
      { duration: 0.09, frequency: 659.25, offset: 0.055 },
    ],
    type: "sine",
  },
  // Snip captured. Shutter-like double click.
  shutter: {
    gain: 0.7,
    notes: [
      { duration: 0.025, frequency: 1975.53, offset: 0 },
      { duration: 0.035, frequency: 1318.51, offset: 0.04 },
    ],
    type: "square",
  },
  // Task parked / low-priority heads up. Single muted tone.
  soft: {
    gain: 0.6,
    notes: [
      { duration: 0.12, frequency: 587.33, offset: 0 },
    ],
    type: "sine",
  },
};

const KIND_TO_TONE = {
  "agent.failed": "alert",
  "all.done": "fanfare",
  "approval.required": "attention",
  "snip.captured": "shutter",
  "task.parked": "soft",
  "task.resume.ready": "ready",
  "task.resume_ready": "ready",
  "terminal.ready": "ready",
  "todo.arrived": "arrive",
  "todo.completed": "ready",
  "todo.queue.drained": "drained",
  "tool.failed": "alert",
  "user.input.required": "attention",
  "voice.off": "voiceOff",
  "voice.on": "voiceOn",
};

export function resolveNotificationSfxTone(kind) {
  const normalized = String(kind || "").trim().toLowerCase().replace(/_/g, ".");
  return KIND_TO_TONE[normalized] || "ready";
}

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

function playTone(context, frequency, startAt, duration, gainNode, type = "sine") {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(1, startAt + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(envelope);
  envelope.connect(gainNode);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function playSequence(context, notes, volume, type = "sine") {
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
      type,
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
  let dingAudioLoaded = false;
  let lastDingPlayedAtMs = 0;
  let lastTonePlayedAtMs = {};
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
    return context.state === "running" ? context : null;
  };

  const playDing = async (volume) => {
    const audio = ensureDingAudio();
    if (!audio) return false;
    const playedAtMs = Date.now();
    if (playedAtMs - lastDingPlayedAtMs < DING_SOUND_MIN_INTERVAL_MS) {
      return true;
    }
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.max(0.01, Math.min(0.82, volume));
      await audio.play();
      lastDingPlayedAtMs = playedAtMs;
      return true;
    } catch {
      return false;
    }
  };

  const playToneRecipe = async (toneKey, volume) => {
    const recipe = TONE_RECIPES[toneKey] || TONE_RECIPES.ready;
    const nowMs = Date.now();
    if (nowMs - (lastTonePlayedAtMs[toneKey] || 0) < TONE_MIN_INTERVAL_MS) {
      return true;
    }
    const activeContext = await ensureContext();
    if (!activeContext) return false;
    lastTonePlayedAtMs[toneKey] = nowMs;
    playSequence(activeContext, recipe.notes, volume * recipe.gain, recipe.type);
    return true;
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
      dingAudioLoaded = false;
      lastDingPlayedAtMs = 0;
      lastTonePlayedAtMs = {};
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
      if (!settings.enabled) return;
      const toneKey = resolveNotificationSfxTone(kind);
      const recipe = TONE_RECIPES[toneKey] || TONE_RECIPES.ready;
      if (recipe.preferDing) {
        if (await playDing(settings.volume)) {
          return;
        }
        await playToneRecipe(toneKey, settings.volume);
        return;
      }
      if (await playToneRecipe(toneKey, settings.volume)) {
        return;
      }
      // Synth context unavailable (autoplay-locked webview); the ding element
      // can still get sound out for important events.
      await playDing(settings.volume);
    },

    async unlock() {
      if (unlocked && dingAudioLoaded && (!context || context.state === "running")) {
        return;
      }
      unlocked = true;
      const audio = ensureDingAudio();
      if (audio && !dingAudioLoaded) {
        try {
          audio.load();
          dingAudioLoaded = true;
        } catch {
          // Loading the MP3 is opportunistic; the oscillator fallback still works.
        }
      }
      await ensureContext();
    },
  };
}

let sharedNotificationSfx = null;

export function getSharedNotificationSfx() {
  if (!sharedNotificationSfx) {
    sharedNotificationSfx = createWorkspaceNotificationSfx();
  }
  return sharedNotificationSfx;
}

export function disposeSharedNotificationSfx() {
  if (sharedNotificationSfx) {
    sharedNotificationSfx.dispose();
    sharedNotificationSfx = null;
  }
}

export function playNotificationSfx(kind) {
  return getSharedNotificationSfx().play(kind);
}

export function unlockNotificationSfx() {
  return getSharedNotificationSfx().unlock();
}
