import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

const AUDIO_INPUT_DEVICE_STORAGE_KEY = "diffforge.audio.inputDeviceId";
const AUDIO_INPUT_SETUP_STORAGE_KEY = "diffforge.audio.inputSetupReady";
const AUDIO_ORCHESTRATOR_SUBMISSION_MODE_STORAGE_KEY = "diffforge.audio.orchestratorSubmissionMode";
const AUDIO_RECORDER_AUTO_OPEN_STORAGE_KEY = "diffforge.audio.autoOpenRecorder";
const AUDIO_RECORDER_MODE_STORAGE_KEY = "diffforge.audio.recorderMode";
export const AUDIO_WIDGET_THEME_STORAGE_KEY = "diffforge.audio.widgetTheme";
const AUDIO_TRANSCRIPTION_RESULT_STORAGE_KEY = "diffforge.audio.lastTranscriptionResult";
const AUDIO_TRANSCRIPTION_HISTORY_STORAGE_KEY = "diffforge.audio.transcriptionHistory";
const AUDIO_TRANSCRIPTION_PROVIDER_STORAGE_KEY = "diffforge.audio.transcriptionProvider";
const AUDIO_DEEPGRAM_API_KEY_STORAGE_KEY = "diffforge.audio.deepgramApiKey";
const AUDIO_DEEPGRAM_LANGUAGE_STORAGE_KEY = "diffforge.audio.deepgramLanguage";
export const AUDIO_TRANSCRIPTION_PROVIDER_LOCAL = "local";
export const AUDIO_TRANSCRIPTION_PROVIDER_CLOUD = "cloud";
export const AUDIO_TRANSCRIPTION_PROVIDER_FORGE = "forge";
const AUDIO_FORGE_LLM_CLEANUP_STORAGE_KEY = "diffforge.audio.forgeLlmCleanup";
export const AUDIO_RECORDER_MODE_PUSH_TO_TALK = "push-to-talk";
export const AUDIO_RECORDER_MODE_TOGGLE_TO_TALK = "toggle-to-talk";
export const AUDIO_RECORDER_MODE_HYBRID = "hybrid";
export const AUDIO_TRANSCRIPTION_STATUS_INSERTED = "inserted";
export const AUDIO_TRANSCRIPTION_STATUS_CANCELLED = "cancelled";
export const AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO = "auto";
export const AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL = "manual";
export const AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT = "diffforge:audio-orchestrator-submission-mode";
export const AUDIO_WIDGET_THEME_DARK = "dark";
export const AUDIO_WIDGET_THEME_LIGHT = "light";
const AUDIO_WIDGET_STYLE_STORAGE_KEY = "diffforge.audio.widgetStyle";
export const AUDIO_WIDGET_STYLE_BUBBLE = "bubble";
export const AUDIO_WIDGET_STYLE_HIDDEN = "hidden";
export const AUDIO_WIDGET_STYLE_BAR = "bar";
export const AUDIO_DEEPGRAM_DEFAULT_LANGUAGE = "en";
const AUDIO_INPUT_STATS_EVENT = "forge-audio-input-stats";
export const AUDIO_TRANSCRIPTION_RESULT_EVENT = "forge-audio-transcription-result";
const MAX_AUDIO_TRANSCRIPTION_HISTORY_ITEMS = 500;
const EMPTY_CAPTURE_STATS = {
  bufferMs: 0,
  frequencyBands: [],
  peak: 0,
  rms: 0,
  timeDomainSamples: [],
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAudioTranscriptionProvider(value) {
  if (
    value === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
    || value === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
  ) {
    return value;
  }

  return AUDIO_TRANSCRIPTION_PROVIDER_LOCAL;
}

function normalizeAudioRecorderMode(value) {
  if (value === AUDIO_RECORDER_MODE_TOGGLE_TO_TALK || value === AUDIO_RECORDER_MODE_HYBRID) {
    return value;
  }

  return AUDIO_RECORDER_MODE_PUSH_TO_TALK;
}

export function normalizeOrchestratorVoiceSubmissionMode(value) {
  return value === AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL
    ? AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL
    : AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO;
}

export function normalizeAudioWidgetTheme(value) {
  return value === AUDIO_WIDGET_THEME_LIGHT ? AUDIO_WIDGET_THEME_LIGHT : AUDIO_WIDGET_THEME_DARK;
}

export function normalizeAudioWidgetStyle(value) {
  if (value === AUDIO_WIDGET_STYLE_HIDDEN || value === AUDIO_WIDGET_STYLE_BAR) {
    return value;
  }

  return AUDIO_WIDGET_STYLE_BUBBLE;
}

export function readAudioWidgetStyle() {
  if (!canUseStorage()) {
    return AUDIO_WIDGET_STYLE_BUBBLE;
  }

  return normalizeAudioWidgetStyle(window.localStorage.getItem(AUDIO_WIDGET_STYLE_STORAGE_KEY));
}

export function writeAudioWidgetStyle(style) {
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_WIDGET_STYLE_STORAGE_KEY, normalizeAudioWidgetStyle(style));
  }
}

function inferAudioTranscriptionProvider(value) {
  const provider = normalizeAudioTranscriptionProvider(value?.provider);

  if (
    provider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
    || provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
  ) {
    return provider;
  }

  const source = String(value?.source || "").toLowerCase();
  if (source.includes("forge")) {
    return AUDIO_TRANSCRIPTION_PROVIDER_FORGE;
  }
  if (source.includes("deepgram") || source.includes("cloud")) {
    return AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
  }

  return AUDIO_TRANSCRIPTION_PROVIDER_LOCAL;
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

export function readAudioRecorderMode() {
  if (!canUseStorage()) {
    return AUDIO_RECORDER_MODE_PUSH_TO_TALK;
  }

  return normalizeAudioRecorderMode(window.localStorage.getItem(AUDIO_RECORDER_MODE_STORAGE_KEY));
}

export function writeAudioRecorderMode(mode) {
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_RECORDER_MODE_STORAGE_KEY, normalizeAudioRecorderMode(mode));
  }
}

export function readOrchestratorVoiceSubmissionMode() {
  if (!canUseStorage()) {
    return AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO;
  }

  return normalizeOrchestratorVoiceSubmissionMode(
    window.localStorage.getItem(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_STORAGE_KEY),
  );
}

export function writeOrchestratorVoiceSubmissionMode(mode) {
  const normalizedMode = normalizeOrchestratorVoiceSubmissionMode(mode);
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_STORAGE_KEY, normalizedMode);
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT, {
      detail: { mode: normalizedMode },
    }));
  }
}

export function readAudioWidgetTheme() {
  if (!canUseStorage()) {
    return AUDIO_WIDGET_THEME_DARK;
  }

  return normalizeAudioWidgetTheme(window.localStorage.getItem(AUDIO_WIDGET_THEME_STORAGE_KEY));
}

export function writeAudioWidgetTheme(theme) {
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_WIDGET_THEME_STORAGE_KEY, normalizeAudioWidgetTheme(theme));
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

export function readForgeLlmCleanup() {
  return !canUseStorage()
    || window.localStorage.getItem(AUDIO_FORGE_LLM_CLEANUP_STORAGE_KEY) !== "false";
}

export function writeForgeLlmCleanup(enabled) {
  if (canUseStorage()) {
    window.localStorage.setItem(AUDIO_FORGE_LLM_CLEANUP_STORAGE_KEY, enabled ? "true" : "false");
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

  const provider = inferAudioTranscriptionProvider(value);
  const source = typeof value.source === "string" && value.source.trim()
    ? value.source.trim()
    : provider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
      ? "deepgram-nova-3-live"
      : provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        ? "forge-nova3-dictation"
        : "whisper-local";
  const audioMs = Number(value.audioMs || value.durationMs || 0);
  const rawLanguage = typeof value.language === "string" ? value.language.trim() : "";
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const sourceText = typeof value.sourceText === "string" && value.sourceText.trim() !== text
    ? value.sourceText.trim()
    : "";

  return {
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    id: typeof value.id === "string" ? value.id : String(Date.now()),
    audioMs: Number.isFinite(audioMs) && audioMs > 0 ? Math.round(audioMs) : 0,
    language: rawLanguage ? normalizeDeepgramLanguage(rawLanguage) : "",
    provider,
    source,
    sourceText,
    status: value.status === AUDIO_TRANSCRIPTION_STATUS_CANCELLED
      ? AUDIO_TRANSCRIPTION_STATUS_CANCELLED
      : AUDIO_TRANSCRIPTION_STATUS_INSERTED,
    text,
    wordCount,
  };
}

function compareTranscriptionResultCreatedAt(left, right) {
  const leftTime = new Date(left?.createdAt || 0).getTime();
  const rightTime = new Date(right?.createdAt || 0).getTime();

  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function normalizeTranscriptionHistory(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();

  return items
    .map(normalizeTranscriptionResult)
    .filter(Boolean)
    .filter((result) => {
      const key = result.id || `${result.createdAt}:${result.text}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort(compareTranscriptionResultCreatedAt)
    .slice(0, MAX_AUDIO_TRANSCRIPTION_HISTORY_ITEMS);
}

function readStoredAudioTranscriptionHistory() {
  if (!canUseStorage()) {
    return [];
  }

  try {
    return normalizeTranscriptionHistory(
      JSON.parse(window.localStorage.getItem(AUDIO_TRANSCRIPTION_HISTORY_STORAGE_KEY) || "[]"),
    );
  } catch {
    return [];
  }
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

export function readAudioTranscriptionHistory() {
  if (!canUseStorage()) {
    return [];
  }

  const history = readStoredAudioTranscriptionHistory();
  if (history.length) {
    return history;
  }

  const lastResult = readLastAudioTranscriptionResult();
  return lastResult ? [lastResult] : [];
}

export async function publishAudioTranscriptionResult(value) {
  const result = normalizeTranscriptionResult(value);

  if (!result) {
    return null;
  }

  if (canUseStorage()) {
    const existingHistory = readStoredAudioTranscriptionHistory();
    const legacyLastResult = existingHistory.length ? null : readLastAudioTranscriptionResult();
    window.localStorage.setItem(AUDIO_TRANSCRIPTION_RESULT_STORAGE_KEY, JSON.stringify(result));
    const nextHistory = normalizeTranscriptionHistory([
      result,
      ...(legacyLastResult ? [legacyLastResult] : []),
      ...existingHistory,
    ]);
    window.localStorage.setItem(AUDIO_TRANSCRIPTION_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
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
