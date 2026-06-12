import { listen } from "@tauri-apps/api/event";

const AUDIO_PUSH_TO_TALK_EVENT = "forge-audio-push-to-talk";

/**
 * Holding the push-to-talk shortcut keeps Option/Alt down for the whole
 * dictation, and xterm treats a held Alt as column-select arming: the pointer
 * turns into a crosshair over any terminal and clicks start column selection.
 * While the shortcut is held this forces macOptionClickForcesSelection on,
 * which makes xterm ignore the Alt modifier for cursor styling and selection
 * mode, so speaking never changes how the terminal looks or reacts to clicks.
 * The previous value is restored on release. Returns an unsubscribe.
 */
export function guardXtermDuringPushToTalk(terminal) {
  let disposed = false;
  let savedForcesSelection = null;
  let unlisten = () => {};

  listen(AUDIO_PUSH_TO_TALK_EVENT, (event) => {
    if (disposed) {
      return;
    }

    const pressed = Boolean(event?.payload?.pressed);
    try {
      if (pressed && savedForcesSelection === null) {
        savedForcesSelection = terminal.options.macOptionClickForcesSelection === true;
        terminal.options.macOptionClickForcesSelection = true;
      } else if (!pressed && savedForcesSelection !== null) {
        terminal.options.macOptionClickForcesSelection = savedForcesSelection;
        savedForcesSelection = null;
      }
    } catch {
      // The terminal may be mid-disposal; cursor guarding is best-effort.
    }
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
