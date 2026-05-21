import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const CLOUD_VOICE_AGENT_EVENT = "forge-cloud-voice-agent-event";

export function startCloudVoiceAgentStream(request = {}) {
  return invoke("start_cloud_voice_agent_stream", { request });
}

export function stopCloudVoiceAgentStream() {
  return invoke("stop_cloud_voice_agent_stream");
}

export function finishCloudVoiceAgentInput() {
  return invoke("finish_cloud_voice_agent_input");
}

export function subscribeCloudVoiceAgentEvents(handler) {
  return listen(CLOUD_VOICE_AGENT_EVENT, (event) => {
    handler(event.payload || {});
  }).then((unlisten) => {
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      try {
        const result = unlisten?.();
        result?.catch?.(() => {});
      } catch {
        // Tauri can throw if the listener was already removed during a hot UI transition.
      }
    };
  });
}

function base64ToUint8Array(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatUint8Arrays(left, right) {
  if (!left?.length) {
    return right || new Uint8Array(0);
  }
  if (!right?.length) {
    return left;
  }
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

function normalizeTtsSampleRate(value) {
  const sampleRate = Number(value);
  return Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 48000
    ? sampleRate
    : 24000;
}

export function createCloudVoiceAgentTtsPlayer({ onError } = {}) {
  let audioContext = null;
  let closed = false;
  let nextStartTime = 0;
  let trailingByte = new Uint8Array(0);

  const ensureAudioContext = async () => {
    if (closed) {
      return null;
    }
    if (!audioContext) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("This browser does not support streaming audio playback.");
      }
      audioContext = new AudioContextCtor();
      nextStartTime = audioContext.currentTime + 0.04;
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    return audioContext;
  };

  const playLinear16Chunk = async (event) => {
    const context = await ensureAudioContext();
    if (!context) {
      return;
    }

    const audio = event?.audio || {};
    const sampleRate = normalizeTtsSampleRate(audio.sample_rate ?? audio.sampleRate);
    let bytes = base64ToUint8Array(audio.base64);
    if (!bytes.length) {
      return;
    }

    bytes = concatUint8Arrays(trailingByte, bytes);
    if (bytes.length % 2 === 1) {
      trailingByte = bytes.slice(bytes.length - 1);
      bytes = bytes.slice(0, bytes.length - 1);
    } else {
      trailingByte = new Uint8Array(0);
    }
    if (!bytes.length) {
      return;
    }

    const sampleCount = bytes.length / 2;
    const buffer = context.createBuffer(1, sampleCount, sampleRate);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = view.getInt16(index * 2, true);
      channel[index] = Math.max(-1, Math.min(1, sample / 32768));
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.035, nextStartTime);
    source.start(startAt);
    nextStartTime = startAt + buffer.duration;
  };

  return {
    async handleEvent(event) {
      if (closed) {
        return;
      }
      const kind = String(event?.kind || event?.type || "").trim();
      try {
        if (kind === "voice_agent_tts_start") {
          await ensureAudioContext();
          return;
        }
        if (kind === "voice_agent_tts_audio") {
          await playLinear16Chunk(event);
        }
      } catch (error) {
        onError?.(error);
      }
    },
    async close() {
      closed = true;
      trailingByte = new Uint8Array(0);
      const context = audioContext;
      audioContext = null;
      if (context && context.state !== "closed") {
        await context.close().catch(() => {});
      }
    },
  };
}
