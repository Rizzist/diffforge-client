import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const CLOUD_VOICE_AGENT_EVENT = "forge-cloud-voice-agent-event";
export const VOICE_ORCHESTRATOR_DIAGNOSTIC_LOGGING_ENABLED = false;

export function cloudVoiceAgentEventKind(event) {
  return String(event?.kind || event?.event_kind || event?.eventKind || event?.type || "").trim();
}

function cleanVoiceOrchestratorDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 512);
}

export function logVoiceOrchestratorDiagnosticEvent(phase, fields = {}) {
  if (!VOICE_ORCHESTRATOR_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }

  invoke("voice_orchestrator_diagnostic_log", {
    phase: cleanVoiceOrchestratorDiagnosticText(phase),
    fields: {
      source: "frontend",
      surface: "voice_agent",
      ...fields,
    },
  }).catch(() => {});
}

export function startCloudVoiceAgentStream(request = {}) {
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.start_stream.invoke", {
    repoId: request?.repoId || request?.repo_id || "",
    submissionMode: request?.submissionMode || request?.submission_mode || "",
    workspaceId: request?.workspaceId || request?.workspace_id || "",
  });
  return invoke("start_cloud_voice_agent_stream", { request })
    .then((result) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.start_stream.ok", {
        active: Boolean(result?.active),
        repoId: result?.repoId || result?.repo_id || "",
        sampleRate: result?.sampleRate || result?.sample_rate || null,
        workspaceId: result?.workspaceId || result?.workspace_id || "",
      });
      return result;
    })
    .catch((error) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.start_stream.error", {
        message: cleanVoiceOrchestratorDiagnosticText(error?.message || error),
      });
      throw error;
    });
}

export function stopCloudVoiceAgentStream() {
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.stop_stream.invoke");
  return invoke("stop_cloud_voice_agent_stream")
    .then((result) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.stop_stream.ok");
      return result;
    })
    .catch((error) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.stop_stream.error", {
        message: cleanVoiceOrchestratorDiagnosticText(error?.message || error),
      });
      throw error;
    });
}

export function finishCloudVoiceAgentInput() {
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.finish_input.invoke");
  return invoke("finish_cloud_voice_agent_input")
    .then((result) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.finish_input.ok");
      return result;
    })
    .catch((error) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.finish_input.error", {
        message: cleanVoiceOrchestratorDiagnosticText(error?.message || error),
      });
      throw error;
    });
}

export function setCloudVoiceAgentInputEnabled(enabled) {
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.input_enabled.invoke", {
    enabled: Boolean(enabled),
  });
  return invoke("set_cloud_voice_agent_input_enabled", { enabled: Boolean(enabled) })
    .then((result) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.input_enabled.ok", {
        enabled: Boolean(result?.enabled),
        micAttached: Boolean(result?.micAttached || result?.mic_attached),
      });
      return result;
    })
    .catch((error) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.input_enabled.error", {
        message: cleanVoiceOrchestratorDiagnosticText(error?.message || error),
      });
      throw error;
    });
}

export function sendCloudVoiceAgentTextMessage(request = {}) {
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.text_message.invoke", {
    repoId: request?.repoId || request?.repo_id || "",
    textLength: String(request?.text || "").length,
    turnIndex: request?.turnIndex || request?.turn_index || 0,
    workspaceId: request?.workspaceId || request?.workspace_id || "",
  });
  return invoke("send_cloud_voice_agent_text_message", { request })
    .then((result) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.text_message.ok");
      return result;
    })
    .catch((error) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.text_message.error", {
        message: cleanVoiceOrchestratorDiagnosticText(error?.message || error),
      });
      throw error;
    });
}

export function subscribeCloudVoiceAgentEvents(handler) {
  return listen(CLOUD_VOICE_AGENT_EVENT, (event) => {
    const payload = event.payload || {};
    logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.event.received", {
      hasError: Boolean(payload?.error),
      kind: cleanVoiceOrchestratorDiagnosticText(cloudVoiceAgentEventKind(payload)),
      repoId: payload?.repo_id || payload?.repoId || "",
      voiceSessionId: payload?.voice_session_id || payload?.voiceSessionId || "",
      workspaceId: payload?.workspace_id || payload?.workspaceId || "",
    });
    handler(payload);
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
    async prime() {
      try {
        await ensureAudioContext();
      } catch (error) {
        onError?.(error);
      }
    },
    async handleEvent(event) {
      if (closed) {
        return;
      }
      const kind = cloudVoiceAgentEventKind(event);
      try {
        if (kind === "voice_agent_tts_start") {
          await ensureAudioContext();
          logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.tts.start", {
            phase: cleanVoiceOrchestratorDiagnosticText(event?.phase || ""),
            sampleRate: event?.audio?.sample_rate || event?.audio?.sampleRate || null,
            utteranceId: cleanVoiceOrchestratorDiagnosticText(event?.utterance_id || event?.utteranceId || ""),
          });
          return;
        }
        if (kind === "voice_agent_tts_audio") {
          // Frames the Rust core already played through the macOS
          // voice-processing unit (echo-cancelled native output) must not be
          // scheduled a second time here.
          const nativePlayback = Boolean(
            event?.audio?.native_playback
              ?? event?.audio?.nativePlayback
              ?? event?.native_playback
              ?? event?.nativePlayback,
          );
          logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.tts.audio", {
            base64Chars: String(event?.audio?.base64 || "").length,
            nativePlayback,
            phase: cleanVoiceOrchestratorDiagnosticText(event?.phase || ""),
            utteranceId: cleanVoiceOrchestratorDiagnosticText(event?.utterance_id || event?.utteranceId || ""),
          });
          if (!nativePlayback) {
            await playLinear16Chunk(event);
          }
          return;
        }
        if (kind === "voice_agent_tts_end") {
          logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.tts.end", {
            phase: cleanVoiceOrchestratorDiagnosticText(event?.phase || ""),
            utteranceId: cleanVoiceOrchestratorDiagnosticText(event?.utterance_id || event?.utteranceId || ""),
          });
          return;
        }
        if (kind === "voice_agent_tts_error") {
          logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.tts.error", {
            code: cleanVoiceOrchestratorDiagnosticText(event?.error?.code || ""),
            message: cleanVoiceOrchestratorDiagnosticText(event?.error?.message || event?.message || ""),
            phase: cleanVoiceOrchestratorDiagnosticText(event?.phase || ""),
          });
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
