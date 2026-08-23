function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function pair(value, description = value) {
  const normalized = text(value);
  return normalized ? [normalized, text(description) || normalized] : null;
}

function uniquePairs(pairs) {
  const seen = new Set();
  return pairs.filter((entry) => {
    if (!entry || seen.has(entry[0])) return false;
    seen.add(entry[0]);
    return true;
  });
}

/* client-contract-v1 §4.2: CommandSlotsWire is exactly five arrays of JSON
   pairs. A list of strings happens to look plausible but is a different wire
   type and makes the daemon reject or ignore the entire dynamic catalog. */
export function buildCommandSlots(library) {
  const providers = Array.isArray(library?.providers) ? library.providers : [];
  const models = Array.isArray(library?.models) ? library.models : [];
  const accounts = Array.isArray(library?.accounts) ? library.accounts : [];
  const efforts = Array.isArray(library?.efforts) ? library.efforts : [];
  const customCommands = Array.isArray(library?.custom_commands) ? library.custom_commands : [];
  return {
    providers: uniquePairs(providers.map((entry) => pair(entry?.provider, entry?.provider))),
    models: uniquePairs(models.map((entry) => {
      if (typeof entry === "string") return pair(entry);
      const model = text(entry?.model);
      const provider = text(entry?.provider);
      return pair(provider && model ? `${provider}/${model}` : model, provider
        ? `${provider} · ${model}`
        : model);
    })),
    accounts: uniquePairs(accounts.map((entry) => pair(
      entry?.alias,
      entry?.label || entry?.identity || entry?.alias,
    ))),
    efforts: uniquePairs(efforts.map((entry) => pair(entry))),
    custom_commands: uniquePairs(customCommands.map((entry) => (
      typeof entry === "string"
        ? pair(entry)
        : pair(entry?.name, entry?.description || entry?.name)
    ))),
  };
}

/* A v3 snapshot with providers:null is the pre-handshake placeholder, not an
   authoritative empty catalog. Legacy snapshots predate the provider array,
   so their model list remains final rather than being polled forever. */
export function librarySnapshotNeedsRetry(library) {
  if (!library || typeof library !== "object") return true;
  return Number(library.version) >= 3 && !Array.isArray(library.providers);
}

/* Provider rows are the inventory; flattened model rows only decorate it.
   Starting from models silently drops unavailable providers whose published
   model list is empty, which turns "unavailable" into "does not exist." */
export function modelGroupsFromLibrary(library) {
  const providers = Array.isArray(library?.providers) ? library.providers : [];
  const models = Array.isArray(library?.models) ? library.models : [];
  const groups = [];
  const byProvider = new Map();
  const ensureGroup = (provider, fields = {}) => {
    const id = text(provider);
    if (!id) return null;
    let group = byProvider.get(id);
    if (!group) {
      group = { provider: id, available: false, status: "unavailable", models: [] };
      byProvider.set(id, group);
      groups.push(group);
    }
    Object.assign(group, fields);
    return group;
  };

  for (const entry of providers) {
    const availability = text(entry?.availability);
    const available = availability === "available" && entry?.enabled === true;
    const group = ensureGroup(entry?.provider, {
      available,
      status: available ? (text(entry?.auth_state) || "ready") : "unavailable",
    });
    if (!group) continue;
    for (const model of Array.isArray(entry?.models) ? entry.models : []) {
      const name = text(model);
      if (name && !group.models.includes(name)) group.models.push(name);
    }
  }

  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const group = ensureGroup(entry.provider, {
      ...(byProvider.has(text(entry.provider)) ? {} : {
        available: Boolean(entry.available),
        status: entry.available ? (text(entry.auth_state) || "ready") : "unavailable",
      }),
    });
    const model = text(entry.model);
    if (group && model && !group.models.includes(model)) group.models.push(model);
  }

  groups.sort((left, right) => (
    Number(right.available) - Number(left.available)
    || left.provider.localeCompare(right.provider)
  ));
  return groups;
}

/* §9.2: omitted availability on a legacy daemon is ambiguous. Only an
   explicit available state can turn [] into the fact “there are no rows.” */
export function snapshotState(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "loading";
  if (!Object.hasOwn(snapshot, "availability")) return "legacy_unknown";
  const state = text(snapshot.availability?.state);
  return ["available", "unavailable", "unknown"].includes(state) ? state : "unknown";
}

export function accountListPresentation(snapshot, loadError = "") {
  if (text(loadError)) return { state: "unavailable", reason: text(loadError) };
  const state = snapshotState(snapshot);
  const descriptors = Array.isArray(snapshot?.descriptors) ? snapshot.descriptors : [];
  if (state === "available" && descriptors.length === 0) return { state: "empty", descriptors };
  return { state, descriptors, reason: text(snapshot?.availability?.reason) };
}

export function credentialStatus(descriptor) {
  return text(descriptor?.status?.status || descriptor?.status) || "unknown";
}

export function accountAuthMethodLabel(descriptor) {
  const method = text(descriptor?.auth_method);
  if (method === "oauth") return "OAuth";
  if (method === "api_key") return "API key";
  return "Unknown authentication";
}

export function providerAuthOptions(library, authMethod) {
  const providers = Array.isArray(library?.providers) ? library.providers : [];
  return providers
    .filter((provider) => Array.isArray(provider?.auth_methods)
      && provider.auth_methods.includes(authMethod))
    .map((provider) => text(provider.provider))
    .filter(Boolean)
    .filter((provider, index, rows) => rows.indexOf(provider) === index)
    .sort();
}
