import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { readDeepgramLanguage } from "./audioCapture.js";

export const CLOUD_VOICE_AGENT_EVENT = "forge-cloud-voice-agent-event";
export const VOICE_ORCHESTRATOR_DIAGNOSTIC_LOGGING_ENABLED = false;
const CLOUD_VOICE_AGENT_PREWARM_FRESH_MS = 15_000;

let cloudVoiceAgentPrewarmPromise = null;
let cloudVoiceAgentPrewarmReadyAt = 0;

function cleanVoiceControlText(value, maxLength = 180) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeVoiceControlRequest(request = {}) {
  const ownerId = cleanVoiceControlText(
    request?.ownerId
      || request?.owner_id
      || request?.owner
      || "",
    120,
  );
  const clientSessionId = cleanVoiceControlText(
    request?.clientSessionId
      || request?.client_session_id
      || "",
    180,
  );
  const voiceSessionId = cleanVoiceControlText(
    request?.voiceSessionId
      || request?.voice_session_id
      || "",
    180,
  );
  return {
    clientSessionId,
    ownerId,
    voiceSessionId,
  };
}

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
  /* The audio-settings language rides every session start so the cloud can
     speak its "let me think about that" acknowledgement in the user's
     language. Callers may override; the setting is the default. */
  let language = "";
  try {
    language = String(request?.language || readDeepgramLanguage() || "").trim();
  } catch {
    /* settings read must not block voice start */
  }
  const requestWithLanguage = language ? { ...request, language } : request;
  return invoke("start_cloud_voice_agent_stream", { request: requestWithLanguage })
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

export async function prewarmCloudVoiceAgentStream(options = {}) {
  const requireBilling = Boolean(options?.requireBilling);
  const onStatus = typeof options?.onStatus === "function" ? options.onStatus : null;
  const emitStatus = (phase, message) => {
    try {
      onStatus?.({ phase, message });
    } catch (_error) {
      // Status callbacks are UI sugar; prewarm should not fail because of one.
    }
  };
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.prewarm.invoke");
  if (requireBilling) {
    emitStatus("credits_billing", "Starting..");
    await invoke("cloud_mcp_get_billing_status").catch((error) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.prewarm.billing_error", {
        message: cleanVoiceOrchestratorDiagnosticText(error?.message || error),
      });
      throw error;
    });
  }
  if (!requireBilling && cloudVoiceAgentPrewarmReadyAt > 0) {
    const ageMs = Date.now() - cloudVoiceAgentPrewarmReadyAt;
    if (ageMs >= 0 && ageMs < CLOUD_VOICE_AGENT_PREWARM_FRESH_MS) {
      emitStatus("credits_ready", "Voice ready");
      return true;
    }
  }
  emitStatus("credits_wallet", "Working..");
  const prewarmPromise = cloudVoiceAgentPrewarmPromise || invoke("prewarm_cloud_voice_agent_stream");
  if (!requireBilling && !cloudVoiceAgentPrewarmPromise) {
    cloudVoiceAgentPrewarmPromise = prewarmPromise;
  }

  return prewarmPromise
    .then((result) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.prewarm.ok");
      if (!requireBilling) {
        cloudVoiceAgentPrewarmReadyAt = Date.now();
      }
      emitStatus("credits_ready", "Voice ready");
      return result;
    })
    .catch((error) => {
      logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.prewarm.error", {
        message: cleanVoiceOrchestratorDiagnosticText(error?.message || error),
      });
      throw error;
    })
    .finally(() => {
      if (!requireBilling && cloudVoiceAgentPrewarmPromise === prewarmPromise) {
        cloudVoiceAgentPrewarmPromise = null;
      }
    });
}

export function stopCloudVoiceAgentStream(request = {}) {
  const controlRequest = normalizeVoiceControlRequest(request);
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.stop_stream.invoke");
  return invoke("stop_cloud_voice_agent_stream", { request: controlRequest })
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

export function finishCloudVoiceAgentInput(request = {}) {
  const controlRequest = normalizeVoiceControlRequest(request);
  logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.finish_input.invoke");
  return invoke("finish_cloud_voice_agent_input", { request: controlRequest })
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
  let closeTimer = 0;
  let nextStartTime = 0;
  let trailingByte = new Uint8Array(0);

  const clearCloseTimer = () => {
    if (!closeTimer || typeof window === "undefined") {
      return;
    }
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  };

  const closeWhenIdle = (settleMs = 450) => {
    if (closed || typeof window === "undefined") {
      return;
    }
    clearCloseTimer();
    const context = audioContext;
    if (!context || context.state === "closed") {
      return;
    }
    const scheduledAudioMs = Math.max(0, (nextStartTime - context.currentTime) * 1000);
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      const closingContext = audioContext;
      audioContext = null;
      nextStartTime = 0;
      if (closingContext && closingContext.state !== "closed") {
        closingContext.close().catch(() => {});
      }
    }, Math.ceil(scheduledAudioMs) + Math.max(0, settleMs));
  };

  const ensureAudioContext = async () => {
    if (closed) {
      return null;
    }
    clearCloseTimer();
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
    closeWhenIdle(700);
  };

  return {
    async prime() {
      return true;
    },
    async handleEvent(event) {
      if (closed) {
        return;
      }
      const kind = cloudVoiceAgentEventKind(event);
      try {
        if (kind === "voice_agent_tts_start") {
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
          closeWhenIdle(450);
          return;
        }
        if (kind === "voice_agent_tts_error") {
          logVoiceOrchestratorDiagnosticEvent("voice_agent.frontend.tts.error", {
            code: cleanVoiceOrchestratorDiagnosticText(event?.error?.code || ""),
            message: cleanVoiceOrchestratorDiagnosticText(event?.error?.message || event?.message || ""),
            phase: cleanVoiceOrchestratorDiagnosticText(event?.phase || ""),
          });
          closeWhenIdle(0);
        }
      } catch (error) {
        onError?.(error);
      }
    },
    async close() {
      closed = true;
      clearCloseTimer();
      trailingByte = new Uint8Array(0);
      const context = audioContext;
      audioContext = null;
      if (context && context.state !== "closed") {
        await context.close().catch(() => {});
      }
    },
  };
}
