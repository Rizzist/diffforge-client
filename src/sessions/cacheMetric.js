/* The harness measures prompt-cache re-read and publishes it in basis points on
   the opaque session payload. Nothing between the daemon and here names the
   field, which is why it appeared the moment the roster stopped being
   overwritten by the lossier CLI projection.

   Lives in its own module rather than inside the component so the one rule that
   matters can be tested: ABSENT AND ZERO ARE DIFFERENT FACTS. */

/** Reads the harness-measured re-read rate, in basis points, or null.
 *
 * Absent means the daemon did not measure this session — a first turn has
 * nothing that could have been re-read, so no rate exists rather than a rate of
 * zero. Zero means it measured and nothing was re-read. Collapsing them would
 * invent a measurement the daemon never took, so this returns null only for
 * genuinely absent values and passes a real 0 through untouched. */
export function measuredCacheRereadBasisPoints(session) {
  /* 0.0.943 promoted this to a top-level field, copied from the same snapshot
     rather than recomputed, so the two cannot disagree. Prefer it: the nested
     path sits behind TWO Options, which means three different absences — no
     metrics snapshot, no usage, no measured rate — all arriving as "no
     number", and a reader has to flatten them anyway.

     The nested path stays permanently, not as a migration step. Sessions
     written by every daemon up to 942 keep only the deep shape, and this
     client reads whatever is on the other end of the socket. */
  for (const value of [
    session?.cache_reread_hit_basis_points,
    session?.agent_metrics?.usage?.cache_reread_hit_basis_points,
  ]) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/** Basis points to a display string. 10000bp = 100%.
 *
 * Held to one decimal below 10% so a small-but-real rate never rounds away to
 * "0%" — that would render as the measured-zero case, which is a different
 * fact and the one thing this metric must not blur. */
export function formatBasisPoints(basisPoints) {
  const pct = basisPoints / 100;
  if (pct > 0 && pct < 10) {
    return `${pct.toFixed(1)}%`;
  }
  return `${Math.round(pct)}%`;
}
