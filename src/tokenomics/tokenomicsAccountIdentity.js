export function uniqueTokenomicsAliasesByOwner(entries = []) {
  const ownersByAlias = new Map();
  entries.forEach((entry) => {
    const owner = String(entry?.owner || "").trim();
    if (!owner) return;
    [...new Set(Array.isArray(entry?.aliases) ? entry.aliases : [])].forEach((alias) => {
      const key = String(alias || "").trim();
      if (!key) return;
      const owners = ownersByAlias.get(key) || new Set();
      owners.add(owner);
      ownersByAlias.set(key, owners);
    });
  });
  return new Set(
    [...ownersByAlias.entries()]
      .filter(([, owners]) => owners.size === 1)
      .map(([alias]) => alias),
  );
}

export function registerTokenomicsIdentityAlias(byAlias, ambiguousAliases, alias, owner) {
  const key = String(alias || "").trim();
  if (!key || ambiguousAliases.has(key)) return false;
  const current = byAlias.get(key);
  if (current && current !== owner) {
    byAlias.delete(key);
    ambiguousAliases.add(key);
    return false;
  }
  byAlias.set(key, owner);
  return true;
}

export function prioritizedTokenomicsIdentityKeyClaims(profiles = []) {
  const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
  return profiles
    .map((profile, registryOrder) => {
      const key = String(profile?.identity?.tokenomics_account_key || "").trim();
      const identityEmail = normalizeEmail(profile?.identity?.email);
      if (!key || !identityEmail) return null;
      const profileEmail = normalizeEmail(profile?.email || profile?.identity?.email);
      return {
        key,
        ownerEmail: identityEmail,
        identityMatchesProfile: identityEmail === profileEmail,
        registryOrder,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      Number(right.identityMatchesProfile) - Number(left.identityMatchesProfile)
      || left.registryOrder - right.registryOrder
    ));
}

export function tokenomicsAccountsFromDistinctKeys(byKey) {
  return [...(byKey instanceof Map ? byKey.values() : [])]
    .sort((left, right) => (
      Number(right?.total || 0) - Number(left?.total || 0)
      || String(left?.label || "").localeCompare(String(right?.label || ""))
    ));
}
