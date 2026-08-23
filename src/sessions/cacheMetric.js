/* The harness measures prompt-cache re-read and publishes it in basis points on
   the opaque session payload. This is the only cache percentage the client may
   render: the harness contract forbids calculating a substitute from token
   counts. A labelled estimate is still indistinguishable from a measurement
   once it is screenshotted, quoted, or compared outside its original UI.

   Lives in its own module rather than inside the component so both rules can be
   tested: ABSENT AND ZERO ARE DIFFERENT FACTS, and absent produces no metric. */

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
     client reads whatever is on the other end of the socket.

     Selection is on PRESENCE, not on the value being usable. A promoted field
     that is present says the current daemon answered, and its answer stands
     even when that answer is null — falling through to the older nested number
     would let a stale projection overwrite a fresh "not measured".

     `promoted || nested` is the obvious form and is wrong for a measured 0.
     Testing `typeof value === "number"` fixes that case and still falls
     through on a present null, which is the same defect one layer down. Only
     presence closes both. No live session currently sends an explicit null
     here — checked across 100 — but that is a fact about today's serialization,
     not a promise the wire makes. */
  if (session && Object.hasOwn(session, "cache_reread_hit_basis_points")) {
    return finiteOrNull(session.cache_reread_hit_basis_points);
  }
  const usage = session?.agent_metrics?.usage;
  if (usage && Object.hasOwn(usage, "cache_reread_hit_basis_points")) {
    return finiteOrNull(usage.cache_reread_hit_basis_points);
  }
  return null;
}

/** Returns the cache header metric backed by a harness measurement, or null. */
export function cacheRereadMetric(session) {
  const basisPoints = measuredCacheRereadBasisPoints(session);
  if (basisPoints == null) return null;
  return {
    label: "Cache re-read",
    value: formatBasisPoints(basisPoints),
  };
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
