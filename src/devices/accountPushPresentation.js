export const LEGACY_ACCOUNT_UNAVAILABLE_REASON =
  "This stored legacy CLI account is unavailable; add the account to the Haider vault.";

/* A persisted pre-Haider row is still valid JSON and therefore must remain
   renderable, but it is not a credential authority. Only daemon descriptors
   with both their published alias and provider can be offered to push. */
export function accountPushRosterRow(row) {
  const alias = String(row?.alias || "").trim();
  const provider = String(row?.provider || "").trim();
  const authMethod = String(row?.auth_method || "").trim();
  const daemonDescriptor = Boolean(
    alias
      && provider
      && ["api_key", "oauth"].includes(authMethod)
      && typeof row?.identity === "string"
      && typeof row?.active === "boolean"
      && row?.status != null,
  );
  if (!daemonDescriptor) {
    return {
      alias,
      provider,
      state: "unavailable",
      reason: LEGACY_ACCOUNT_UNAVAILABLE_REASON,
      source: row,
    };
  }
  return {
    alias,
    provider,
    state: "available",
    reason: "",
    source: row,
  };
}
