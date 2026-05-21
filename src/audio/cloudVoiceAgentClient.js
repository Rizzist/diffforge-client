import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const CLOUD_VOICE_AGENT_EVENT = "forge-cloud-voice-agent-event";

export function startCloudVoiceAgentStream(request = {}) {
  return invoke("start_cloud_voice_agent_stream", { request });
}

export function stopCloudVoiceAgentStream() {
  return invoke("stop_cloud_voice_agent_stream");
}

export function subscribeCloudVoiceAgentEvents(handler) {
  return listen(CLOUD_VOICE_AGENT_EVENT, (event) => {
    handler(event.payload || {});
  });
}
