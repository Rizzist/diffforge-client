import { lifecycleUnavailableFromError } from "./lifecycleModel.js";

/* Pure projections for workspace hooks and the canonical session tool
   inventory. Trust is intentionally fail-closed: only the daemon's typed
   `trust_state: trusted` fact authorizes a trusted presentation. Hook
   execution classifications are displayed only when published, and tool
   schemas/defaults stay opaque values owned by the daemon. */

const KNOWN_HOOK_POLICIES = new Set(["workspace"]);
const KNOWN_HOOK_KINDS = new Set(["command"]);
const KNOWN_HOOK_TRUST_STATES = new Set([
  "trusted",
  "untrusted",
  "revoked_by_edit",
]);

function owns(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function categoryView(value, knownValues, absentLabel = "not published") {
  if (typeof value !== "string") {
    return {
      kind: "absent",
      raw: null,
      label: absentLabel,
      recognized: false,
    };
  }
  if (knownValues.has(value)) {
    return { kind: "known", raw: value, label: value, recognized: true };
  }
  return { kind: "unknown", raw: value, label: value, recognized: false };
}

function hookTrustView(value) {
  if (value === "trusted") {
    return {
      kind: "trusted",
      raw: value,
      label: "Trusted",
      recognized: true,
      trusted: true,
    };
  }
  if (KNOWN_HOOK_TRUST_STATES.has(value)) {
    return {
      kind: value,
      raw: value,
      label: value === "revoked_by_edit"
        ? "UNTRUSTED · revoked by edit"
        : "UNTRUSTED",
      recognized: true,
      trusted: false,
    };
  }
  if (typeof value === "string") {
    return {
      kind: "unknown",
      raw: value,
      label: `UNTRUSTED · ${value} (unrecognized trust state)`,
      recognized: false,
      trusted: false,
    };
  }
  return {
    kind: "absent",
    raw: null,
    label: "UNTRUSTED · trust state not published",
    recognized: false,
    trusted: false,
  };
}

/* No field is derived from name, source, event, timing, or the legacy
   `trusted` boolean. In particular, an absent kind stays unspecified and no
   `mode` property is fabricated. */
export function hookSummaryView(summary) {
  return {
    name: stringOrNull(summary?.name),
    source: stringOrNull(summary?.source),
    digest: stringOrNull(summary?.digest),
    kind: categoryView(
      summary?.kind,
      KNOWN_HOOK_KINDS,
      "unspecified (not published)",
    ),
    event: stringOrNull(summary?.event),
    trust: hookTrustView(summary?.trust_state),
    decision: owns(summary, "decision") ? summary.decision : undefined,
    timeoutMs: owns(summary, "timeout_ms") ? summary.timeout_ms : undefined,
  };
}

/* Policy is an enum-like published fact: known values are classified only
   for display, while future values remain raw and visibly unrecognized.
   Revision is carried verbatim (including u64-scale decimal strings). */
export function hookListView(result) {
  return {
    policy: categoryView(result?.policy, KNOWN_HOOK_POLICIES),
    revision: owns(result, "revision") ? result.revision : undefined,
    rows: Array.isArray(result?.hooks) ? result.hooks.map(hookSummaryView) : [],
  };
}

/* Tool input_schema, effects, dispatch, and permission default are opaque
   inventory facts. Keeping their original references makes accidental
   normalization or form-schema interpretation visible in tests. */
export function toolManifestView(entry) {
  const manifest = entry?.manifest;
  return {
    name: stringOrNull(manifest?.name),
    description: stringOrNull(manifest?.description),
    effects: owns(manifest, "effects") ? manifest.effects : undefined,
    dispatch: owns(manifest, "dispatch") ? manifest.dispatch : undefined,
    inputSchema: owns(manifest, "input_schema") ? manifest.input_schema : undefined,
    permissionDefault: owns(entry, "default") ? entry.default : undefined,
  };
}

/* The digest is already the daemon's identity. Never trim, hash, normalize,
   or supplement it at the JavaScript boundary. */
export function trustArgs(digest) {
  return { digest };
}

export function capabilityUnavailableFromError(error) {
  return error?.code === "missing_feature" || lifecycleUnavailableFromError(error);
}
