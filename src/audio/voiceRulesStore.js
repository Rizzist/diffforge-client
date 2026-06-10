import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { EMPTY_VOICE_TEXT_RULES, normalizeVoiceTextRules } from "./voicePipeline.js";

export const VOICE_TEXT_RULES_CHANGED_EVENT = "forge-voice-text-rules-changed";

let cachedVoiceTextRules = EMPTY_VOICE_TEXT_RULES;

export function peekVoiceTextRules() {
  return cachedVoiceTextRules;
}

export async function loadVoiceTextRules() {
  try {
    cachedVoiceTextRules = normalizeVoiceTextRules(await invoke("voice_text_rules_get"));
  } catch {
    // Rules are an enhancement layer; dictation works without them.
  }

  return cachedVoiceTextRules;
}

export async function saveVoiceTextRules(rules) {
  cachedVoiceTextRules = normalizeVoiceTextRules(
    await invoke("voice_text_rules_set", { rules: normalizeVoiceTextRules(rules) }),
  );

  return cachedVoiceTextRules;
}

/**
 * Keeps the module cache fresh across windows (the widget window and the
 * Audio tab both edit/consume the same rules). Returns an unsubscribe.
 */
export function subscribeVoiceTextRules(onChange) {
  let disposed = false;
  let unlisten = () => {};

  listen(VOICE_TEXT_RULES_CHANGED_EVENT, (event) => {
    if (disposed) {
      return;
    }

    cachedVoiceTextRules = normalizeVoiceTextRules(event.payload);
    onChange?.(cachedVoiceTextRules);
  })
    .then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }

      unlisten = nextUnlisten;
    })
    .catch(() => {});

  return () => {
    disposed = true;
    unlisten();
  };
}
