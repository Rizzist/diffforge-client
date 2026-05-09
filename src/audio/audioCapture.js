import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

const AUDIO_INPUT_DEVICE_STORAGE_KEY = "diffforge.audio.inputDeviceId";
const AUDIO_INPUT_SETUP_STORAGE_KEY = "diffforge.audio.inputSetupReady";
const AUDIO_RECORDER_AUTO_OPEN_STORAGE_KEY = "diffforge.audio.autoOpenRecorder";
const AUDIO_TRANSCRIPTION_RESULT_STORAGE_KEY = "diffforge.audio.lastTranscriptionResult";
const AUDIO_TRANSCRIPTION_PROVIDER_STORAGE_KEY = "diffforge.audio.transcriptionProvider";
const AUDIO_DEEPGRAM_API_KEY_STORAGE_KEY = "diffforge.audio.deepgramApiKey";
const AUDIO_DEEPGRAM_LANGUAGE_STORAGE_KEY = "diffforge.audio.deepgramLanguage";
export const AUDIO_TRANSCRIPTION_PROVIDER_LOCAL = "local";
export const AUDIO_TRANSCRIPTION_PROVIDER_CLOUD = "cloud";
export const AUDIO_DEEPGRAM_DEFAULT_LANGUAGE = "en";
const AUDIO_INPUT_STATS_EVENT = "forge-audio-input-stats";
export const AUDIO_TRANSCRIPTION_RESULT_EVENT = "forge-audio-transcription-result";
const EMPTY_CAPTURE_STATS = {
  bufferMs: 0,
  peak: 0,
  rms: 0,
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAudioTranscriptionProvider(value) {
  return value === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
    ? AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
    : AUDIO_TRANSCRIPTION_PROVIDER_LOCAL;
}

function normalizeDeepgramLanguage(value) {
  const language = String(value || "").trim();

  if (!language || language.length > 24 || !/^[a-zA-Z0-9-]+$/.test(language)) {
    return AUDIO_DEEPGRAM_DEFAULT_LANGUAGE;
  }

  return language;
}

function base64ToArrayBuffer(value) {
  const binary = atob(value || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function readSelectedAudioInputDeviceId() {
  if (!canUseStorage()) {
    return "default";
  }

  return window.localStorage.getItem(AUDIO_INPUT_DEVICE_STORAGE_KEY) || "default";
}

export function writeSelectedAudioInputDeviceId(deviceId) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(AUDIO_INPUT_DEVICE_STORAGE_KEY, deviceId || "default");
}

export function hasAudioInputSetup() {
  return canUseStorage() && window.localStorage.getItem(AUDIO_INPUT_SETUP_STORAGE_KEY) === "true";
}

export function markAudioInputSetupReady() {
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_INPUT_SETUP_STORAGE_KEY, "true");
  }
}

export function readAutoOpenAudioRecorder() {
  return canUseStorage() && window.localStorage.getItem(AUDIO_RECORDER_AUTO_OPEN_STORAGE_KEY) === "true";
}

export function writeAutoOpenAudioRecorder(enabled) {
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_RECORDER_AUTO_OPEN_STORAGE_KEY, enabled ? "true" : "false");
  }
}

export function readAudioTranscriptionProvider() {
  if (!canUseStorage()) {
    return AUDIO_TRANSCRIPTION_PROVIDER_LOCAL;
  }

  return normalizeAudioTranscriptionProvider(
    window.localStorage.getItem(AUDIO_TRANSCRIPTION_PROVIDER_STORAGE_KEY),
  );
}

export function writeAudioTranscriptionProvider(provider) {
  if (canUseStorage()) {
    window.localStorage.setItem(
      AUDIO_TRANSCRIPTION_PROVIDER_STORAGE_KEY,
      normalizeAudioTranscriptionProvider(provider),
    );
  }
}

export function readDeepgramApiKey() {
  if (!canUseStorage()) {
    return "";
  }

  return window.localStorage.getItem(AUDIO_DEEPGRAM_API_KEY_STORAGE_KEY) || "";
}

export function writeDeepgramApiKey(apiKey) {
  if (!canUseStorage()) {
    return;
  }

  const cleanedApiKey = String(apiKey || "").trim();
  if (cleanedApiKey) {
    window.localStorage.setItem(AUDIO_DEEPGRAM_API_KEY_STORAGE_KEY, cleanedApiKey);
  } else {
    window.localStorage.removeItem(AUDIO_DEEPGRAM_API_KEY_STORAGE_KEY);
  }
}

export function readDeepgramLanguage() {
  if (!canUseStorage()) {
    return AUDIO_DEEPGRAM_DEFAULT_LANGUAGE;
  }

  return normalizeDeepgramLanguage(window.localStorage.getItem(AUDIO_DEEPGRAM_LANGUAGE_STORAGE_KEY));
}

export function writeDeepgramLanguage(language) {
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_DEEPGRAM_LANGUAGE_STORAGE_KEY, normalizeDeepgramLanguage(language));
  }
}

function normalizeTranscriptionResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const text = typeof value.text === "string"
    ? value.text
      .split(/\r?\n/)
      .filter((line) => {
        const lowercase = line.trim().toLowerCase();

        return !(
          lowercase.includes("the binary 'main.exe' is deprecated")
          || lowercase.includes("the binary \"main.exe\" is deprecated")
          || lowercase.includes("the binary 'main' is deprecated")
          || lowercase.includes("the binary \"main\" is deprecated")
          || lowercase.includes("deprecation-warning")
        );
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    : "";

  if (!text) {
    return null;
  }

  return {
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    id: typeof value.id === "string" ? value.id : String(Date.now()),
    source: typeof value.source === "string" ? value.source : "audio-widget",
    text,
  };
}

export function readLastAudioTranscriptionResult() {
  if (!canUseStorage()) {
    return null;
  }

  try {
    return normalizeTranscriptionResult(
      JSON.parse(window.localStorage.getItem(AUDIO_TRANSCRIPTION_RESULT_STORAGE_KEY) || "null"),
    );
  } catch {
    return null;
  }
}

export async function publishAudioTranscriptionResult(value) {
  const result = normalizeTranscriptionResult(value);

  if (!result) {
    return null;
  }

  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_TRANSCRIPTION_RESULT_STORAGE_KEY, JSON.stringify(result));
  }

  await emit(AUDIO_TRANSCRIPTION_RESULT_EVENT, result).catch(() => {});

  return result;
}

export function formatAudioPercent(value) {
  const percent = Number(value);

  if (!Number.isFinite(percent)) {
    return "";
  }

  return `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
}

export function getAudioInputErrorMessage(error, fallback = "Unable to open the selected microphone.") {
  const message = String(error?.message || error || "").trim();
  const lowercase = message.toLowerCase();

  if (lowercase.includes("permission") || lowercase.includes("denied") || lowercase.includes("blocked")) {
    return "Diff Forge cannot access that input through the operating system right now. Check system microphone access, then use Enable input here.";
  }

  if (lowercase.includes("not available") || lowercase.includes("not found") || lowercase.includes("no default microphone")) {
    return "That input source is not available. Choose another microphone and refresh sources.";
  }

  if (lowercase.includes("busy") || lowercase.includes("in use") || lowercase.includes("could not be opened")) {
    return "That input source could not be opened. Check the OS input settings or choose another source, then try again.";
  }

  return message || fallback;
}

export async function listAudioInputDevices() {
  return invoke("audio_input_devices");
}

export async function prepareWhisperModel() {
  return invoke("prepare_whisper_model");
}

export async function startLowPowerAudioBuffer({
  deviceId = "default",
  owner = "audio",
  onStats,
} = {}) {
  let closed = false;
  let latestStats = { ...EMPTY_CAPTURE_STATS };
  const unlisten = onStats
    ? await listen(AUDIO_INPUT_STATS_EVENT, (event) => {
      latestStats = {
        ...EMPTY_CAPTURE_STATS,
        ...(event.payload || {}),
      };
      onStats(latestStats);
    })
    : null;

  const status = await invoke("start_audio_input_monitor", {
    request: {
      deviceId,
      owner,
    },
  });

  markAudioInputSetupReady();

  return {
    sampleRate: status?.sampleRate || 16000,
    async beginCapture() {
      await invoke("begin_audio_input_capture");
    },
    async finishCapture() {
      const result = await invoke("finish_audio_input_capture");

      return {
        audioMs: Number(result?.audioMs || 0),
        wavBuffer: base64ToArrayBuffer(result?.audioBase64 || ""),
      };
    },
    getCaptureStats() {
      return {
        bufferMs: latestStats.bufferMs || 0,
        peak: latestStats.peak || 0,
        rms: latestStats.rms || 0,
      };
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
      await invoke("stop_audio_input_monitor", {
        request: {
          owner,
        },
      }).catch(() => {});
    },
  };
}
