import { createElement } from "react";

const SESSION_AVAILABILITY_PRESENTATIONS = Object.freeze({
  "daemon-unavailable": Object.freeze({
    label: "Daemon unavailable",
    detail: "Haider is unavailable, so this session could not be confirmed in the published roster.",
  }),
  "not-published": Object.freeze({
    label: "Not published",
    detail: "This local session has not been published by Haider yet.",
  }),
  "legacy-provenance": Object.freeze({
    label: "Legacy provenance",
    detail: "This session has legacy provenance, so Haider availability cannot be verified.",
  }),
});

function normalizedAvailabilityReason(session) {
  return String(session?.session_availability_reason || "").trim();
}

export function sessionAvailabilityPresentation(session) {
  const reason = normalizedAvailabilityReason(session);
  const known = SESSION_AVAILABILITY_PRESENTATIONS[reason];
  if (known) {
    return {
      ...known,
      ariaLabel: `Session unavailable: ${known.label}`,
      reason,
    };
  }
  if (String(session?.session_availability || "").trim() !== "unavailable") {
    return null;
  }
  if (reason) {
    /* A published-but-unrecognized reason is still a published fact: carry the
       token verbatim, never rewrite it into prose. */
    return {
      ariaLabel: "Session unavailable: unrecognized reason",
      detail: `Session unavailable: the daemon published an unrecognized reason "${reason}".`,
      label: "Unavailable",
      reason,
    };
  }
  /* Absent reason is UNKNOWN — never fabricated into a category. The reason
     token "unknown" marks the absence itself, not a daemon-published value. */
  return {
    ariaLabel: "Session unavailable: reason unknown",
    detail: "This session is unavailable; the daemon did not publish a reason.",
    label: "Unavailable",
    reason: "unknown",
  };
}

/* Kept free of JSX so the exact user-visible affordance can be server-rendered
   by the Node contract tests without introducing a second presentation path. */
export function SessionAvailabilityAffordance({ className, session }) {
  const presentation = sessionAvailabilityPresentation(session);
  if (!presentation) return null;
  return createElement("span", {
    "aria-label": presentation.ariaLabel,
    className,
    "data-session-availability": presentation.reason,
    role: "status",
    title: presentation.detail,
  }, presentation.label);
}
