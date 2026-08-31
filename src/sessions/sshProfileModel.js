import { shellUnavailableFromError } from "./shellModel.js";

/* Pure projections for the daemon-owned SSH profile registry. Public rows
   are copied through an identity-only allowlist. In particular, no raw row
   reference or additive field is retained: auth, passwords, key material,
   paths to keys, passphrases, and vault references can never reach pixels. */

const KNOWN_TEST_OUTCOMES = new Set(["reachable", "unreachable"]);
const KNOWN_SCOPE_KINDS = new Set(["all", "allow", "none"]);

function owns(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function publishedScalarOrNull(value) {
  return value == null || ["string", "number", "boolean"].includes(typeof value)
    ? (value ?? null)
    : null;
}

function categoryView(raw, knownValues, absentLabel) {
  if (typeof raw !== "string") {
    return {
      kind: "absent",
      raw: null,
      label: absentLabel,
      recognized: false,
    };
  }
  if (knownValues.has(raw)) {
    return { kind: "known", raw, label: raw, recognized: true };
  }
  return { kind: "unknown", raw, label: raw, recognized: false };
}

function hostKeyView(hostKey) {
  if (!hostKey || typeof hostKey !== "object" || Array.isArray(hostKey)) return null;
  return {
    algorithm: stringOrNull(hostKey.algorithm),
    fingerprint: stringOrNull(hostKey.fingerprint),
    pinnedAtMs: publishedScalarOrNull(hostKey.pinned_at_ms),
  };
}

export function profileRowView(row) {
  return {
    name: stringOrNull(row?.name),
    description: stringOrNull(row?.description),
    host: stringOrNull(row?.host),
    user: stringOrNull(row?.user),
    port: publishedScalarOrNull(row?.port),
    defaultCwd: stringOrNull(row?.default_cwd),
    hostKey: hostKeyView(row?.host_key),
    lastUsedMs: publishedScalarOrNull(row?.last_used_ms),
    multiplexing: typeof row?.multiplexing === "boolean" ? row.multiplexing : null,
    inScope: typeof row?.in_scope === "boolean" ? row.in_scope : null,
  };
}

/* A profile starts untested. Once a receipt exists, only its published
   `outcome` enum may establish reachability. RPC success, `connected`, host
   identity, and host-key facts are deliberately ignored as substitutes. */
export function testOutcomeView(receipt) {
  if (receipt == null) {
    return {
      kind: "untested",
      outcome: null,
      reachable: null,
      label: "not tested",
      recognized: true,
      profileName: null,
      hostKeyPinned: null,
    };
  }
  const outcome = categoryView(
    receipt?.outcome,
    KNOWN_TEST_OUTCOMES,
    "outcome not published",
  );
  return {
    kind: outcome.kind,
    outcome: outcome.raw,
    reachable: outcome.raw === "reachable"
      ? true
      : outcome.raw === "unreachable" ? false : null,
    label: outcome.label,
    recognized: outcome.recognized,
    profileName: stringOrNull(receipt?.profile?.name),
    hostKeyPinned: typeof receipt?.host_key_pinned === "boolean"
      ? receipt.host_key_pinned
      : null,
  };
}

/* The returned scope is the only current-scope authority. Absence is an
   explicit unknown state, never a client-created `none` or `local` scope. */
export function scopeView(scope) {
  const kind = categoryView(scope?.kind, KNOWN_SCOPE_KINDS, "not published");
  return {
    ...kind,
    names: kind.raw === "allow" && Array.isArray(scope?.names)
      ? scope.names.filter((name) => typeof name === "string")
      : [],
  };
}

/* These wrappers preserve the daemon's verbatim request objects. A secret is
   carried by exactly one invoke argument (`profile` or `changes`); the hook
   clears the submitting component's secret state immediately after dispatch
   and never projects either request through profileRowView. */
export function addArgs(profile) {
  return { profile };
}

export function updateArgs(name, changes) {
  return { name, changes };
}

export function sshUnavailableFromError(error) {
  return error?.code === "missing_feature" || shellUnavailableFromError(error);
}

