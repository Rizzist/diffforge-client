/* Testable form of the legacy omission fallback. */
export function projectionCaughtUp(result) {
  return typeof result?.caught_up === "boolean" ? result.caught_up : null;
}
