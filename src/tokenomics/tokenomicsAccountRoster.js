import { rowProviderAccountKey } from "./tokenomicsFormat.js";

// Pure roster logic for the tokenomics provider-account pills, extracted from
// AccountTokenomicsView.jsx so the "known accounts can never vanish"
// guarantees stay unit-testable outside the React tree.

export const PROVIDER_ACCOUNT_FILTER_PROVIDERS = ["codex", "claude", "opencode"];

export function providerKey(row) {
  const agent = String(row?.agent_kind || "").toLowerCase();
  const provider = String(row?.provider || "").toLowerCase();
  if (agent.includes("codex") || provider.includes("openai") || provider.includes("codex")) return "codex";
  if (agent.includes("claude") || provider.includes("anthropic") || provider.includes("claude")) return "claude";
  if (agent.includes("opencode") || provider.includes("opencode")) return "opencode";
  return provider || agent || "agent";
}

export function rowDeviceId(row) {
  return String(row?.device_id || row?.machine_id || "").trim();
}

export function rowScopeKey(row) {
  const explicit = String(row?.billing_scope_key || "").trim();
  if (explicit) return explicit;
  const type = String(row?.billing_scope_type || row?.scope_type || "").trim().toLowerCase();
  const teamId = String(row?.billing_team_id || row?.team_id || "").trim();
  if (type === "team" || teamId) return teamId ? `team:${teamId}` : "team";
  if (type === "personal") return "personal";
  return "unknown";
}

export function tokenomicsProviderProfileAccountKey(providerId, profileId) {
  const cleanProfileId = String(profileId || "").trim();
  if (!cleanProfileId || cleanProfileId === "default") return "";
  if (providerId === "claude") return `anthropic:claude:profile:${cleanProfileId}`;
  if (providerId === "codex") return `openai:codex:profile:${cleanProfileId}`;
  if (providerId === "opencode") return `opencode:opencode:profile:${cleanProfileId}`;
  return "";
}

export function tokenomicsProfileIdFromAccountKey(providerId, accountKey) {
  const clean = String(accountKey || "").trim();
  const prefix = tokenomicsProviderProfileAccountKey(providerId, "__profile__").replace("__profile__", "");
  return prefix && clean.startsWith(prefix) ? clean.slice(prefix.length).trim() : "";
}

export function tokenomicsRowAgentProfileId(row = {}) {
  return String(row?.agent_profile_id || "").trim();
}

export function tokenomicsCurrentProfileIdsByProvider(agentAccounts) {
  if (!agentAccounts || typeof agentAccounts !== "object") return null;
  return PROVIDER_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
    const profiles = Array.isArray(agentAccounts?.[providerId]?.profiles)
      ? agentAccounts[providerId].profiles
      : [];
    acc[providerId] = new Set(
      profiles
        .map((profile) => String(profile?.id || "").trim())
        .filter(Boolean),
    );
    return acc;
  }, {});
}

export function tokenomicsRowReferencesRemovedProfile(row, currentProfileIdsByProvider) {
  const providerId = providerKey(row);
  const profileId = tokenomicsRowAgentProfileId(row)
    || tokenomicsProfileIdFromAccountKey(providerId, rowProviderAccountKey(row));
  if (!profileId || profileId === "default") return false;
  // Fail OPEN while the agent-accounts state is still null (initial
  // hydration, registry read failure): an unknown account set must never
  // hide existing history. The old fail-closed default blanked every
  // profile-backed pill for a beat around provider logins.
  if (!currentProfileIdsByProvider) return false;
  const currentIds = currentProfileIdsByProvider[providerId];
  if (!currentIds) return false;
  return Boolean(profileId && !currentIds.has(profileId));
}

// The provider-account catalog is monotonic within a session: a snapshot
// that omits (or transiently empties) accounts must never shrink the pill
// roster. Rows only leave through the backend's explicit retirement
// tombstones (retired_account_keys).
export function mergeTokenomicsProviderAccounts(previous, next) {
  const previousRows = Array.isArray(previous?.provider_accounts) ? previous.provider_accounts : [];
  const nextRows = Array.isArray(next?.provider_accounts) ? next.provider_accounts : [];
  const retired = new Set(
    (Array.isArray(next?.retired_account_keys) ? next.retired_account_keys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean),
  );
  const rowKey = (row) => [
    rowDeviceId(row),
    providerKey(row),
    String(row?.agent_kind || "").trim().toLowerCase(),
    rowProviderAccountKey(row),
    rowScopeKey(row),
  ].join("::");
  const merged = new Map();
  [...previousRows, ...nextRows].forEach((row) => merged.set(rowKey(row), row));
  return [...merged.values()].filter((row) => !retired.has(rowProviderAccountKey(row)));
}
