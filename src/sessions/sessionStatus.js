/* Surface status is structured. The display line is intentionally ignored:
   it is presentation text, not a second status protocol. */
export function surfaceStatusLabel(surface, session) {
  return String(surface?.detail || surface?.state || "").trim()
    || String(session?.state_raw || "").trim()
    || (session?.status === "running" ? "Running"
      : session?.status === "waiting" ? "Waiting"
        : session?.status === "error" ? "Error"
          : session?.status === "idle" ? "Idle" : "Unknown");
}
