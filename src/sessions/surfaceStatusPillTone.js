import { sessionActivityVisualState } from "./sessionActivity.js";

/* The work-header status pill's ring/text tone — a truthful read of the
   session's real state, never a manufactured "good":

     good  — connected and healthy (idle or running)
     warn  — waiting on a human, or not yet published
     bad   — errored, or the daemon/publication is unavailable
     ""    — state genuinely unknown; the pill stays neutral

   Availability degradation outranks the run bucket: an unpublished or
   daemon-less session is not "idle-green" just because its last-known coarse
   status was idle. This mirrors the dot-coloring the inline <i> pill used
   before the brand mark replaced it. JSX-free so it can be unit-tested. */
export function surfaceStatusPillTone(session, statusPillView, availability) {
  const reason = availability?.reason;
  if (reason === "daemon-unavailable") return "bad";
  if (reason === "not-published") return "warn";
  if (reason === "legacy-provenance") return "";
  if (statusPillView?.status === "unavailable") return "bad";

  const state = sessionActivityVisualState(session);
  if (state === "error") return "bad";
  if (state === "waiting") return "warn";
  if (state === "running" || state === "idle") return "good";
  return "";
}
