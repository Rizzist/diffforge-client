import { invoke } from "@tauri-apps/api/core";

const TRANSCRIPT_TARGET_SAMPLE_RATE = 16000;
const TRANSCRIPT_VERSION = "1.0";
const TRANSCRIBABLE_EXTENSIONS = new Set([
  "aac", "flac", "m4a", "m4v", "mov", "mp3", "mp4", "ogg", "opus", "wav", "webm", "wma",
]);

export const TRANSCRIPTION_STAGES = {
  decoding: "Extracting audio",
  done: "Transcript attached",
  reading: "Reading media file",
  saving: "Saving transcript",
  transcribing: "Transcribing",
  uploading: "Uploading audio",
};

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function mediaFileExtension(path) {
  const filename = text(path).split(/[\\/]/u).pop() || "";
  const match = filename.match(/\.([^.\\/]+)$/u);
  return text(match?.[1]).toLowerCase();
}

export function mediaPathIsTranscribable(path) {
  return TRANSCRIBABLE_EXTENSIONS.has(mediaFileExtension(path));
}

async function dataUrlToArrayBuffer(dataUrl) {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
}

function audioBufferToMono16k(audioBuffer) {
  const offlineLength = Math.max(
    1,
    Math.ceil(audioBuffer.duration * TRANSCRIPT_TARGET_SAMPLE_RATE),
  );
  const offline = new OfflineAudioContext(1, offlineLength, TRANSCRIPT_TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

function float32ToWavBytes(samples, sampleRate) {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function srtTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)},${pad(millis, 3)}`;
}

export function buildSrtFromUtterances(utterances) {
  return (Array.isArray(utterances) ? utterances : [])
    .map((utterance, index) => {
      const start = Math.max(0, Number(utterance?.start) || 0);
      const end = Math.max(start, Number(utterance?.end) || start);
      return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${text(utterance?.text)}\n`;
    })
    .join("\n");
}

export async function getMediaTranscriptStatus(mediaPath) {
  const path = text(mediaPath);
  if (!path || !mediaPathIsTranscribable(path)) {
    return { exists: false, jsonPath: "", srtPath: "", updatedAtMs: 0 };
  }
  try {
    const status = await invoke("hyperframe_media_transcript_status", { mediaPath: path });
    return {
      exists: Boolean(status?.exists),
      jsonPath: text(status?.jsonPath),
      srtPath: text(status?.srtPath),
      updatedAtMs: Number(status?.updatedAtMs) || 0,
    };
  } catch {
    return { exists: false, jsonPath: "", srtPath: "", updatedAtMs: 0 };
  }
}

async function extractWavBase64(mediaPath, onStage) {
  onStage?.("reading");
  const dataUrl = await invoke("snipping_read_asset_data_url", { path: mediaPath });
  const encoded = await dataUrlToArrayBuffer(dataUrl);

  onStage?.("decoding");
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Audio decoding is unavailable in this webview.");
  }
  const decodeContext = new AudioContextConstructor();
  let audioBuffer;
  try {
    audioBuffer = await decodeContext.decodeAudioData(encoded);
  } catch {
    throw new Error("Unable to decode an audio track from this media file.");
  } finally {
    decodeContext.close().catch(() => {});
  }
  if (!audioBuffer?.duration) {
    throw new Error("This media file has no decodable audio track.");
  }
  const monoBuffer = await audioBufferToMono16k(audioBuffer);
  const wavBytes = float32ToWavBytes(monoBuffer.getChannelData(0), TRANSCRIPT_TARGET_SAMPLE_RATE);
  return {
    audioBase64: bytesToBase64(wavBytes),
    durationSeconds: audioBuffer.duration,
  };
}

/**
 * Full pipeline: media file -> mono 16k WAV -> transcription provider -> SRT + JSON
 * sidecars written next to the media file (so transcript scope always matches the
 * asset's tracked/untracked/cloud scope automatically).
 */
export async function transcribeMediaAsset({
  apiKey = "",
  language = "en",
  mediaPath,
  mediaName = "",
  onStage,
  provider = "deepgram",
}) {
  const path = text(mediaPath);
  if (!path) throw new Error("A local media path is required for transcription.");
  if (!mediaPathIsTranscribable(path)) {
    throw new Error("This file type cannot be transcribed.");
  }

  const { audioBase64, durationSeconds } = await extractWavBase64(path, onStage);

  onStage?.(provider === "deepgram" ? "uploading" : "transcribing");
  const result = await invoke("hyperframe_transcribe_audio", {
    request: {
      apiKey: apiKey || undefined,
      audioBase64,
      language,
      provider,
    },
  });

  onStage?.("saving");
  const utterances = Array.isArray(result?.utterances) ? result.utterances : [];
  const transcriptJson = {
    durationSeconds: Number(result?.durationSeconds) || durationSeconds,
    generatedAt: new Date().toISOString(),
    language: text(result?.language, language),
    source: {
      name: text(mediaName, path.split(/[\\/]/u).pop() || "media"),
      path,
    },
    tool: text(result?.tool, provider),
    utterances,
    version: TRANSCRIPT_VERSION,
    words: Array.isArray(result?.words) ? result.words : [],
  };
  const saved = await invoke("hyperframe_save_media_transcript", {
    request: {
      mediaPath: path,
      srtText: buildSrtFromUtterances(utterances),
      transcriptJson: JSON.stringify(transcriptJson, null, 2),
    },
  });

  onStage?.("done");
  return {
    durationSeconds: transcriptJson.durationSeconds,
    jsonPath: text(saved?.jsonPath),
    language: transcriptJson.language,
    srtPath: text(saved?.srtPath),
    tool: transcriptJson.tool,
    utteranceCount: utterances.length,
  };
}
