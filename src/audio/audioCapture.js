const AUDIO_TARGET_SAMPLE_RATE = 16000;
const AUDIO_RECORDING_MAX_SECONDS = 90;
const AUDIO_BUFFER_MAX_SECONDS = 12;
const AUDIO_BUFFER_PREROLL_SECONDS = 1.2;
const AUDIO_BUFFER_POSTROLL_SECONDS = 0.55;
const AUDIO_MIN_SPEECH_MS = 260;
const AUDIO_VAD_BASE_RMS = 0.012;
const AUDIO_VAD_PEAK = 0.04;
const AUDIO_VAD_NOISE_MULTIPLIER = 3;

export function formatAudioPercent(value) {
  const percent = Number(value);

  if (!Number.isFinite(percent)) {
    return "";
  }

  return `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
}

function mergeFloat32Chunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });

  return merged;
}

function resampleFloat32(samples, sourceRate, targetRate) {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || sourceRate === targetRate) {
    return samples;
  }

  const outputLength = Math.max(1, Math.round(samples.length * (targetRate / sourceRate)));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * (sourceRate / targetRate);
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    const left = samples[leftIndex] || 0;
    const right = samples[rightIndex] || 0;

    output[index] = left + (right - left) * mix;
  }

  return output;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  samples.forEach((sample) => {
    const clipped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    const value = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;

    view.setInt16(offset, value, true);
    offset += bytesPerSample;
  });

  return buffer;
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

function getAudioStats(samples) {
  let sumSquares = 0;
  let peak = 0;

  samples.forEach((sample) => {
    const value = Number.isFinite(sample) ? sample : 0;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  });

  return {
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
  };
}

export async function startLowPowerAudioBuffer({ onStats } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not available in this WebView.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("AudioContext is not available in this WebView.");
  }

  const audioContext = new AudioContextCtor();
  await audioContext.resume();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const maxBufferedSamples = Math.round(audioContext.sampleRate * AUDIO_BUFFER_MAX_SECONDS);
  let totalBufferedSamples = 0;
  let noiseFloor = AUDIO_VAD_BASE_RMS / 2;
  let captureStartedAt = 0;
  let captureSpeechMs = 0;
  let captureSpeechDetected = false;
  let lastSpeechAt = 0;
  let lastStatsAt = 0;
  let closed = false;

  const emitStats = (stats) => {
    const now = performance.now();

    if (!onStats || now - lastStatsAt < 140) {
      return;
    }

    lastStatsAt = now;
    onStats({
      ...stats,
      bufferMs: Math.round((totalBufferedSamples / audioContext.sampleRate) * 1000),
      captureSpeechDetected,
      lastSpeechAgoMs: lastSpeechAt ? Math.max(0, Math.round(now - lastSpeechAt)) : 0,
      noiseFloor,
    });
  };

  const trimBufferedAudio = () => {
    while (totalBufferedSamples > maxBufferedSamples && chunks.length > 1) {
      const removed = chunks.shift();
      totalBufferedSamples -= removed.samples.length;
    }
  };

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);
    const samples = new Float32Array(input);
    const now = performance.now();
    const { rms, peak } = getAudioStats(samples);
    const threshold = Math.max(AUDIO_VAD_BASE_RMS, noiseFloor * AUDIO_VAD_NOISE_MULTIPLIER);
    const speech = rms >= threshold || peak >= AUDIO_VAD_PEAK;
    const durationMs = (samples.length / audioContext.sampleRate) * 1000;

    output.fill(0);
    chunks.push({
      durationMs,
      peak,
      rms,
      samples,
      speech,
      timestamp: now,
    });
    totalBufferedSamples += samples.length;
    trimBufferedAudio();

    if (speech) {
      lastSpeechAt = now;
      if (captureStartedAt) {
        captureSpeechMs += durationMs;
        captureSpeechDetected = true;
      }
    } else if (!captureStartedAt) {
      noiseFloor = (noiseFloor * 0.97) + (rms * 0.03);
    }

    emitStats({
      peak,
      rms,
      speech,
      threshold,
    });
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  return {
    sampleRate: audioContext.sampleRate,
    beginCapture() {
      captureStartedAt = performance.now();
      captureSpeechMs = 0;
      captureSpeechDetected = false;
      lastSpeechAt = 0;
    },
    finishCapture() {
      if (!captureStartedAt) {
        throw new Error("Recorder is not armed.");
      }

      const captureStart = captureStartedAt - (AUDIO_BUFFER_PREROLL_SECONDS * 1000);
      const candidates = chunks.filter((chunk) => (
        chunk.timestamp + chunk.durationMs >= captureStart
      ));
      const firstSpeech = candidates.find((chunk) => chunk.speech);
      const lastSpeech = [...candidates].reverse().find((chunk) => chunk.speech);
      const speechMs = candidates
        .filter((chunk) => chunk.speech)
        .reduce((sum, chunk) => sum + chunk.durationMs, 0);

      captureStartedAt = 0;

      if (!firstSpeech || !lastSpeech || speechMs < AUDIO_MIN_SPEECH_MS) {
        throw new Error("No speech detected.");
      }

      const trimStart = firstSpeech.timestamp - (AUDIO_BUFFER_PREROLL_SECONDS * 1000);
      const trimEnd = lastSpeech.timestamp + lastSpeech.durationMs + (AUDIO_BUFFER_POSTROLL_SECONDS * 1000);
      const speechChunks = candidates.filter((chunk) => (
        chunk.timestamp + chunk.durationMs >= trimStart && chunk.timestamp <= trimEnd
      ));
      const merged = mergeFloat32Chunks(speechChunks.map((chunk) => chunk.samples));
      const maxSamples = Math.round(audioContext.sampleRate * AUDIO_RECORDING_MAX_SECONDS);
      const bounded = merged.length > maxSamples ? merged.slice(merged.length - maxSamples) : merged;
      const resampled = resampleFloat32(bounded, audioContext.sampleRate, AUDIO_TARGET_SAMPLE_RATE);

      return {
        speechMs: Math.round(speechMs),
        wavBuffer: encodeWav(resampled, AUDIO_TARGET_SAMPLE_RATE),
      };
    },
    getCaptureStats() {
      return {
        lastSpeechAgoMs: lastSpeechAt ? Math.max(0, performance.now() - lastSpeechAt) : 0,
        speechDetected: captureSpeechDetected,
        speechMs: captureSpeechMs,
      };
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
    },
  };
}
