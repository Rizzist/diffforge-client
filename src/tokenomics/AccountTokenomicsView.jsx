import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  dailyUsageTitle,
  dailyUsageValue,
  formatCost,
  formatCostTitle,
  formatTokenTitle,
  formatTokens,
  numeric,
  rowActivityTokens,
  rowCache,
  rowCost,
  rowInput,
  rowOutput,
  rowProviderAccountKey,
  rowProviderAccountLabel,
  rowTotal,
} from "./tokenomicsFormat.js";

const TOKENOMICS_SCAN_PROGRESS_EVENT = "diffforge://tokenomics-scan-progress";
const TOKENOMICS_VIEW_POLL_INTERVAL_MS = 10_000;
const TOKENOMICS_DAILY_WINDOW_DAYS = 30;
const TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS = 7;
const TOKENOMICS_DAILY_RANGE_OPTIONS = [7, TOKENOMICS_DAILY_WINDOW_DAYS];
const TOKENOMICS_USAGE_RATE_WINDOWS = [
  { key: "5_hour", label: "5h" },
  { key: "weekly", label: "Weekly" },
];

const PROVIDERS = [
  { id: "all", label: "All", match: () => true },
  { id: "codex", label: "Codex", match: (row) => providerKey(row) === "codex" },
  { id: "claude", label: "Claude", match: (row) => providerKey(row) === "claude" },
];

const PROVIDER_LABELS = {
  anthropic: "Claude Code",
  claude: "Claude Code",
  openai: "Codex",
  codex: "Codex",
  opencode: "OpenCode",
};

const PROVIDER_MODELS = {
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5"],
  claude: ["fable-5", "opus-4-8", "sonnet-4-6", "haiku-4-5"],
  all: ["codex", "claude", "opencode"],
};

const PROVIDER_ACCENTS = {
  all: "#60a5fa",
  codex: "#60a5fa",
  claude: "#fb923c",
};

const AGENT_ACCOUNTS_CHANGED_EVENT = "agent-accounts-changed";

const AgentAccountsSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Zero min-content contribution: the tokenomics panel is a single grid
     column, so without this a wide pill (long account email) widens the
     whole column past the rail and clips every card. */
  min-width: 0;
  max-width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.35);

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.2);
    background: rgba(241, 245, 249, 0.7);
  }
`;

const AgentAccountsHeader = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 10px;
  min-width: 0;

  strong {
    color: rgba(226, 232, 240, 0.92);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  span {
    color: rgba(148, 163, 184, 0.75);
    font-size: 11px;
  }

  html[data-forge-theme="light"] & strong {
    color: rgba(30, 41, 59, 0.9);
  }
`;

const AgentAccountsRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
`;

const AgentAccountsKindLabel = styled.span`
  min-width: 56px;
  color: rgba(148, 163, 184, 0.85);
  font-size: 11.5px;
  font-weight: 750;
`;

const AgentAccountPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  color: rgba(203, 213, 225, 0.9);
  background: rgba(30, 41, 59, 0.55);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;

  /* The active account keeps the exact unselected design — its only marker
     is the small green dot on the left. */
  &[data-active="true"] {
    cursor: default;
  }

  &:hover:not([data-active="true"]) {
    border-color: rgba(125, 176, 255, 0.5);
  }

  /* The account name; ellipsizes so one pill can never force the panel
     wider than a thin rail (210px floor). */
  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    overflow: hidden;
    min-width: 0;
    color: rgba(148, 163, 184, 0.75);
    font-size: 10.5px;
    font-style: normal;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Dot semantics: green = the active account, amber = captured but needs a
     login; authenticated inactive accounts carry no dot at all. */
  i {
    display: none;
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 999px;
    font-style: normal;
  }

  i[data-state="active"] {
    display: inline-block;
    background: rgba(74, 222, 128, 0.9);
  }

  i[data-state="needs-login"] {
    display: inline-block;
    background: rgba(251, 146, 60, 0.95);
  }

  html[data-forge-theme="light"] & {
    color: rgba(30, 41, 59, 0.85);
    background: rgba(255, 255, 255, 0.85);
  }
`;

const AgentAccountIconButton = styled.button`
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: rgba(148, 163, 184, 0.7);
  background: transparent;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: rgba(226, 232, 240, 0.95);
    background: rgba(125, 176, 255, 0.25);
  }

  &[data-danger="true"]:hover {
    color: #fff;
    background: rgba(214, 69, 69, 0.85);
  }

  &[data-armed="true"] {
    padding: 0 6px;
    color: #fff;
    background: rgba(214, 69, 69, 0.85);
    font-size: 10px;
  }
`;

const AgentAccountEditorForm = styled.form`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid rgba(125, 176, 255, 0.3);
  border-radius: 10px;
  color: rgba(203, 213, 225, 0.9);
  background: rgba(30, 41, 59, 0.45);
  font-size: 11.5px;

  input[type="text"] {
    flex: 1 1 110px;
    min-width: 0;
    max-width: 180px;
    padding: 4px 9px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 999px;
    color: inherit;
    background: rgba(2, 6, 14, 0.5);
    font-size: 11.5px;
    outline: none;

    html[data-forge-theme="light"] & {
      background: #ffffff;
    }
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: rgba(148, 163, 184, 0.85);
    font-weight: 650;
    cursor: pointer;
  }

  button {
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 750;
    cursor: pointer;
  }

  button[type="submit"] {
    border: 1px solid rgba(74, 222, 128, 0.45);
    color: rgba(187, 247, 208, 0.95);
    background: rgba(34, 197, 94, 0.12);
  }

  button[type="button"] {
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: rgba(148, 163, 184, 0.9);
    background: transparent;
  }

  html[data-forge-theme="light"] & {
    color: rgba(30, 41, 59, 0.85);
    background: rgba(241, 245, 249, 0.8);
  }
`;

/* Agent account profiles: per-CLI account switching managed beside the usage
   data that motivates the switch. There is no add flow — signing into another
   account in any terminal is captured automatically by the Rust watcher.
   Switching only affects NEW terminal spawns; running panes show a restart
   chip instead (never forced). */
function AgentAccountsManager() {
  const [accounts, setAccounts] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState("");
  const [actionError, setActionError] = useState("");
  const confirmDeleteTimerRef = useRef(null);

  const refresh = useCallback(() => {
    invoke("agent_accounts_state").then((state) => {
      setAccounts(state?.agents || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten = null;
    refresh();
    // Logins inside profile dirs change identity dots without any event, so
    // a slow poll backs up the capture-watcher events.
    const interval = window.setInterval(refresh, 6000);
    listen(AGENT_ACCOUNTS_CHANGED_EVENT, () => {
      if (!cancelled) {
        refresh();
      }
    }).then((next) => {
      if (cancelled) {
        next();
        return;
      }
      unlisten = next;
    }).catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (confirmDeleteTimerRef.current) {
        window.clearTimeout(confirmDeleteTimerRef.current);
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, [refresh]);

  const setActive = useCallback((kind, profileId) => {
    setActionError("");
    invoke("agent_accounts_set_active", { agentKind: kind, profileId })
      .then(refresh)
      .catch((error) => setActionError(String(error?.message || error || "Unable to switch account.")));
  }, [refresh]);

  const requestDelete = useCallback((kind, profileId) => {
    const key = `${kind}:${profileId}`;
    if (confirmDeleteKey !== key) {
      setConfirmDeleteKey(key);
      if (confirmDeleteTimerRef.current) {
        window.clearTimeout(confirmDeleteTimerRef.current);
      }
      confirmDeleteTimerRef.current = window.setTimeout(() => setConfirmDeleteKey(""), 2600);
      return;
    }
    setConfirmDeleteKey("");
    setActionError("");
    invoke("agent_accounts_remove", { agentKind: kind, profileId })
      .then(refresh)
      .catch((error) => setActionError(String(error?.message || error || "Unable to delete account.")));
  }, [confirmDeleteKey, refresh]);

  const submitEdit = useCallback((event) => {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setActionError("");
    invoke("agent_accounts_update_display", {
      agentKind: editing.kind,
      profileId: editing.profileId,
      alias: editing.alias,
      showAlias: editing.showAlias,
      showEmail: editing.showEmail,
    }).then(() => {
      setEditing(null);
      refresh();
    }).catch((error) => setActionError(String(error?.message || error || "Unable to update account.")));
  }, [editing, refresh]);

  if (!accounts) {
    return null;
  }

  return (
    <AgentAccountsSection aria-label="Agent account profiles">
      <AgentAccountsHeader>
        <strong>Agent accounts</strong>
        <span>Sign into another account in any terminal — it’s captured here automatically.</span>
      </AgentAccountsHeader>
      {["claude", "codex"].map((kind) => {
        const entry = accounts[kind];
        if (!entry) {
          return null;
        }
        const profiles = Array.isArray(entry.profiles) ? entry.profiles : [];
        return (
          <Fragment key={kind}>
            <AgentAccountsRow>
              <AgentAccountsKindLabel>
                {kind === "claude" ? "Claude" : "Codex"}
              </AgentAccountsKindLabel>
              {profiles.map((profile) => {
                const email = profile.identity?.email || "";
                const alias = String(profile.alias || "").trim();
                const showAlias = profile.showAlias !== false;
                const showEmail = profile.showEmail !== false;
                const name = profile.isDefault
                  ? (profile.label || "Default")
                  : ((showAlias && alias) || profile.label || "Account");
                const canEdit = !profile.isDefault && Boolean(email);
                const canDelete = !profile.isDefault && !profile.isActive;
                const deleteArmed = confirmDeleteKey === `${kind}:${profile.id}`;
                return (
                  <AgentAccountPill
                    data-active={profile.isActive ? "true" : "false"}
                    key={profile.id}
                    onClick={() => {
                      if (!profile.isActive) {
                        setActive(kind, profile.id);
                      }
                    }}
                    title={profile.isActive
                      ? `Active: new ${kind} terminals use this account`
                      : `Use this account for new ${kind} terminals`}
                    type="button"
                  >
                    <i
                      aria-hidden="true"
                      data-state={profile.isActive
                        ? "active"
                        : profile.identity?.authReady ? "none" : "needs-login"}
                    />
                    <span>{name}</span>
                    {email && (profile.isDefault || showEmail) ? <em>{email}</em> : null}
                    {!profile.identity?.authReady && !profile.isDefault ? <em>needs login</em> : null}
                    {canEdit && (
                      <AgentAccountIconButton
                        aria-label={`Edit ${name}`}
                        as="span"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditing({
                            kind,
                            profileId: profile.id,
                            name,
                            alias,
                            showAlias,
                            showEmail,
                          });
                        }}
                        role="button"
                        title="Edit alias & what the pill shows"
                      >
                        ✎
                      </AgentAccountIconButton>
                    )}
                    {canDelete && (
                      <AgentAccountIconButton
                        aria-label={`Delete ${name}`}
                        as="span"
                        data-armed={deleteArmed ? "true" : "false"}
                        data-danger="true"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestDelete(kind, profile.id);
                        }}
                        role="button"
                        title="Delete this account profile and its saved login"
                      >
                        {deleteArmed ? "sure?" : "×"}
                      </AgentAccountIconButton>
                    )}
                  </AgentAccountPill>
                );
              })}
            </AgentAccountsRow>
            {editing?.kind === kind ? (
              <AgentAccountEditorForm onSubmit={submitEdit}>
                <input
                  aria-label="Account alias"
                  autoFocus
                  maxLength={40}
                  onChange={(event) => setEditing((current) => (
                    current ? { ...current, alias: event.target.value } : current
                  ))}
                  placeholder={`Alias for ${editing.name}`}
                  type="text"
                  value={editing.alias}
                />
                <label>
                  <input
                    checked={editing.showAlias}
                    onChange={(event) => setEditing((current) => (
                      current ? { ...current, showAlias: event.target.checked } : current
                    ))}
                    type="checkbox"
                  />
                  show alias
                </label>
                <label>
                  <input
                    checked={editing.showEmail}
                    onChange={(event) => setEditing((current) => (
                      current ? { ...current, showEmail: event.target.checked } : current
                    ))}
                    type="checkbox"
                  />
                  show email
                </label>
                <button type="submit">Save</button>
                <button onClick={() => setEditing(null)} type="button">Cancel</button>
              </AgentAccountEditorForm>
            ) : null}
          </Fragment>
        );
      })}
      {actionError ? <TokenomicsError>{actionError}</TokenomicsError> : null}
    </AgentAccountsSection>
  );
}

function createTokenomicsStoreState() {
  return {
    summary: null,
    status: "loading",
    error: "",
    selectedProvider: "all",
    selectedScopeKey: "all",
    selectedAccountKey: "all",
    selectedDeviceId: "all",
    scanProgress: null,
  };
}

function normalizeTokenomicsAccountKey(accountKey) {
  return String(accountKey || "local-account").trim() || "local-account";
}

function providerAccent(provider) {
  return PROVIDER_ACCENTS[provider] || "#60a5fa";
}

function formatCredits(value) {
  if (value == null || value === "") return "0";
  const raw = typeof value === "string" ? value.trim() : String(value);
  if (!raw || raw === "NaN") return "0";
  const [whole, decimal] = raw.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${decimal != null ? `.${decimal}` : ""}`;
}

function formatCreditBytes(value) {
  const bytes = numeric(value);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function storageByteValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return number;
    }
  }
  return 0;
}

function formatStorageBytes(value) {
  const bytes = storageByteValue(value);
  const mib = 1024 ** 2;
  const gib = 1024 ** 3;
  if (bytes <= 0) return "0 GB";
  if (bytes >= gib) {
    const amount = bytes / gib;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)} GB`;
  }
  if (bytes >= mib) return `${Math.round(bytes / mib)} MB`;
  return formatCreditBytes(bytes) || "0 GB";
}

function storageLimitsForPlan(planName) {
  const normalized = String(planName || "").trim().toLowerCase();
  if (normalized === "ultra") {
    return { totalBytes: 15 * 1024 ** 3, sqliteBytes: 6 * 1024 ** 3, assetsBytes: 9 * 1024 ** 3 };
  }
  if (normalized === "pro") {
    return { totalBytes: 5 * 1024 ** 3, sqliteBytes: 3 * 1024 ** 3, assetsBytes: 2 * 1024 ** 3 };
  }
  if (normalized === "plus") {
    return { totalBytes: 2 * 1024 ** 3, sqliteBytes: 1.5 * 1024 ** 3, assetsBytes: 0.5 * 1024 ** 3 };
  }
  return { totalBytes: 0, sqliteBytes: 0, assetsBytes: 0 };
}

function storageUsageModel(billingStatus = {}, summary = {}, liveStorageUsage = null) {
  const planName = String(
    billingStatus?.planName
      || billingStatus?.credits?.planName
      || liveStorageUsage?.planName
      || liveStorageUsage?.plan_name
      || "free",
  ).trim().toLowerCase();
  const raw = liveStorageUsage
    || summary?.storageUsage
    || summary?.storage_usage
    || billingStatus?.storage?.usage
    || {};
  const usage = raw?.usage || raw || {};
  const fallback = storageLimitsForPlan(planName);
  const explicitLimits = raw?.limits
    || billingStatus?.storage?.limits
    || billingStatus?.entitlements?.storage
    || billingStatus?.limits?.storage
    || billingStatus?.user?.entitlements?.storage
    || {};
  const limits = {
    totalBytes: storageByteValue(explicitLimits.totalBytes, explicitLimits.total_bytes, fallback.totalBytes),
    sqliteBytes: storageByteValue(explicitLimits.sqliteBytes, explicitLimits.sqlite_bytes, fallback.sqliteBytes),
    assetsBytes: storageByteValue(explicitLimits.assetsBytes, explicitLimits.assets_bytes, fallback.assetsBytes),
  };
  const rows = [
    { key: "total", label: "Total", used: storageByteValue(usage.totalBytes, usage.total_bytes), limit: limits.totalBytes },
    { key: "sqlite", label: "SQLite", used: storageByteValue(usage.sqliteBytes, usage.sqlite_bytes), limit: limits.sqliteBytes },
    { key: "assets", label: "Assets", used: storageByteValue(usage.assetsBytes, usage.assets_bytes), limit: limits.assetsBytes },
  ].map((row) => ({
    ...row,
    percent: row.limit > 0 ? Math.min(100, Math.max(0, Math.round((row.used / row.limit) * 100))) : 0,
  }));
  return {
    known: Boolean(raw?.known || raw?.usage || billingStatus?.storage?.usage),
    rows,
  };
}

function providerKey(row) {
  const agent = String(row?.agent_kind || row?.agentKind || "").toLowerCase();
  const provider = String(row?.provider || "").toLowerCase();
  if (agent.includes("codex") || provider.includes("openai") || provider.includes("codex")) return "codex";
  if (agent.includes("claude") || provider.includes("anthropic") || provider.includes("claude")) return "claude";
  if (agent.includes("opencode") || provider.includes("opencode")) return "opencode";
  return provider || agent || "agent";
}

function providerLabel(row) {
  const key = providerKey(row);
  return PROVIDER_LABELS[key] || PROVIDER_LABELS[String(row?.provider || "").toLowerCase()] || row?.label || "Agent";
}

function providerDisplayName(providerId) {
  if (providerId === "codex") return "Codex";
  if (providerId === "claude") return "Claude Code";
  return PROVIDERS.find((provider) => provider.id === providerId)?.label || providerId || "Provider";
}

function rowDeviceId(row) {
  return String(row?.device_id || row?.deviceId || row?.machine_id || row?.machineId || "").trim();
}

function rowScopeKey(row) {
  const explicit = String(row?.billing_scope_key || row?.billingScopeKey || "").trim();
  if (explicit) return explicit;
  const type = String(row?.billing_scope_type || row?.billingScopeType || row?.scope_type || row?.scopeType || "").trim().toLowerCase();
  const teamId = String(row?.billing_team_id || row?.billingTeamId || row?.team_id || row?.teamId || "").trim();
  if (type === "team" || teamId) return teamId ? `team:${teamId}` : "team";
  if (type === "personal") return "personal";
  return "unknown";
}

function rowScopeLabel(row, key = rowScopeKey(row)) {
  const explicit = String(row?.billing_scope_label || row?.billingScopeLabel || "").trim();
  if (explicit && explicit !== "Unknown scope") return explicit;
  if (key === "personal") return "Personal";
  if (key.startsWith("team:")) {
    const teamId = key.slice("team:".length);
    return teamId ? `Team ${teamId.length > 16 ? `${teamId.slice(0, 6)}...${teamId.slice(-4)}` : teamId}` : "Team";
  }
  if (key === "team") return "Team";
  return "Unknown scope";
}

function tokenomicsDeviceIdentityRows(summary = {}) {
  const value = summary && typeof summary === "object" ? summary : {};
  return [
    ...(Array.isArray(value.device_identities) ? value.device_identities : []),
    ...(Array.isArray(value.deviceIdentities) ? value.deviceIdentities : []),
    ...(Array.isArray(value.devices) ? value.devices : []),
  ];
}

function tokenomicsDeviceIdentityLabel(identity = {}) {
  return String(
    identity?.display_name
      || identity?.displayName
      || identity?.label
      || identity?.device_name
      || identity?.deviceName
      || identity?.machine_name
      || identity?.machineName
      || identity?.hostname
      || identity?.name
      || "",
  ).trim();
}

function tokenomicsDeviceIdentityIds(identity = {}) {
  return [
    rowDeviceId(identity),
    identity?.id,
    identity?.device_id,
    identity?.deviceId,
    identity?.machine_id,
    identity?.machineId,
    identity?.native_device_id,
    identity?.nativeDeviceId,
    identity?.target_device_id,
    identity?.targetDeviceId,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function tokenomicsDeviceIdentityMap(summary = {}) {
  const byId = new Map();
  tokenomicsDeviceIdentityRows(summary).forEach((identity) => {
    const label = tokenomicsDeviceIdentityLabel(identity);
    [...new Set(tokenomicsDeviceIdentityIds(identity))].forEach((id) => {
      const current = byId.get(id) || {};
      byId.set(id, {
        ...current,
        ...identity,
        display_name: label || current.display_name || current.displayName || "",
        displayName: label || current.displayName || current.display_name || "",
      });
    });
  });
  return byId;
}

function genericDeviceLabel(deviceId) {
  const lower = String(deviceId || "").toLowerCase();
  if (lower.includes("windows") || lower.startsWith("win")) return "Windows PC";
  if (lower.includes("macos") || lower.includes("macbook") || lower.startsWith("mac")) return "Mac device";
  if (lower.includes("linux")) return "Linux device";
  return "Other device";
}

function dedupeDeviceLabels(devices) {
  const counts = new Map();
  devices.forEach((device) => counts.set(device.label, (counts.get(device.label) || 0) + 1));
  const seen = new Map();
  return devices.map((device) => {
    if (device.current || counts.get(device.label) <= 1) return device;
    const next = (seen.get(device.label) || 0) + 1;
    seen.set(device.label, next);
    return { ...device, label: `${device.label} ${next}` };
  });
}

function deviceLabel(deviceId, currentDeviceId = "", identityMap = new Map()) {
  if (!deviceId) return "Unknown device";
  if (currentDeviceId && deviceId === currentDeviceId) return "This Device";
  const identityLabel = tokenomicsDeviceIdentityLabel(identityMap.get(deviceId));
  return identityLabel || genericDeviceLabel(deviceId);
}

function filterRows(rows, selectedProvider, selectedAccountKey = "all", selectedDeviceId = "all", selectedScopeKey = "all") {
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  return rows.filter((row) => (
    provider.match(row)
      && (selectedAccountKey === "all" || rowProviderAccountKey(row) === selectedAccountKey)
      && (selectedDeviceId === "all" || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
}

function aggregateRows(rows) {
  return rows.reduce(
    (acc, row) => ({
      input: acc.input + rowInput(row),
      output: acc.output + rowOutput(row),
      cache: acc.cache + rowCache(row),
      total: acc.total + rowActivityTokens(row),
      cost: acc.cost + rowCost(row),
      events: acc.events + numeric(row?.event_count, row?.eventCount),
    }),
    { input: 0, output: 0, cache: 0, total: 0, cost: 0, events: 0 },
  );
}

function bucketDayKey(row) {
  const raw = row?.bucket_start || row?.bucketStart || row?.bucket_day || row?.bucketDay;
  if (!raw) return "";
  const value = String(raw);
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dayKeyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromDayKey(key) {
  return new Date(`${key}T00:00:00Z`);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function compactDayLabel(key) {
  return dateFromDayKey(key)
    .toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })
    .slice(0, 1);
}

function fullDayLabel(key, todayKey) {
  const today = dateFromDayKey(todayKey);
  const yesterdayKey = dayKeyUtc(addUtcDays(today, -1));
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return dateFromDayKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function weeklyLimitUsedPercent(row = {}) {
  return limitNumberOrNull(
    row.used_percent,
    row.usedPercent,
    row.limit_used_percent,
    row.limitUsedPercent,
    row.used,
  );
}

function weeklyLimitRowTime(row = {}) {
  return parseLimitTimestamp(
    row.sample_at
      ?? row.sampleAt
      ?? row.sample_bucket_start
      ?? row.sampleBucketStart
      ?? row.updated_at
      ?? row.updatedAt
      ?? row.last_known_at
      ?? row.lastKnownAt,
  );
}

function weeklyLimitRowResetKey(row = {}) {
  return String(row.reset_at ?? row.resetAt ?? row.limit_resets_at ?? row.limitResetsAt ?? "");
}

function weeklyLimitSeriesKey(row = {}) {
  return [rowScopeKey(row), providerKey(row), rowProviderAccountKey(row)].join("::");
}

function matchingWeeklyLimitRows(rows, selectedProvider, selectedAccountKey, selectedScopeKey = "all") {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    String(row?.window_kind || row?.windowKind || row?.limit_kind || row?.limitKind || "") === "weekly"
      && (selectedProvider === "all" || providerKey(row) === selectedProvider)
      && (selectedAccountKey === "all" || rowProviderAccountKey(row) === selectedAccountKey)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
}

function directDailyWeeklyLimitPercents(limitSamples, selectedProvider, selectedAccountKey, selectedScopeKey = "all") {
  const bySeries = new Map();
  for (const row of matchingWeeklyLimitRows(limitSamples, selectedProvider, selectedAccountKey, selectedScopeKey)) {
    const used = weeklyLimitUsedPercent(row);
    const time = weeklyLimitRowTime(row);
    if (used == null || !time) continue;
    const key = weeklyLimitSeriesKey(row);
    const series = bySeries.get(key) || [];
    series.push({
      day: dayKeyUtc(time),
      resetKey: weeklyLimitRowResetKey(row),
      time: time.getTime(),
      used: Math.max(0, Math.min(100, used)),
    });
    bySeries.set(key, series);
  }

  const byDay = new Map();
  for (const series of bySeries.values()) {
    series.sort((left, right) => left.time - right.time);
    let previous = null;
    for (const entry of series) {
      if (previous) {
        const sameWindow = !entry.resetKey || !previous.resetKey || entry.resetKey === previous.resetKey;
        const delta = sameWindow && entry.used >= previous.used ? entry.used - previous.used : entry.used;
        if (delta > 0) {
          byDay.set(entry.day, Math.max(byDay.get(entry.day) || 0, delta));
        }
      }
      previous = entry;
    }
  }
  return byDay;
}

function latestWeeklyLimitUsedPercent(limitSamples, limits, selectedProvider, selectedAccountKey, selectedScopeKey = "all") {
  const candidates = [
    ...matchingWeeklyLimitRows(limitSamples, selectedProvider, selectedAccountKey, selectedScopeKey),
    ...matchingWeeklyLimitRows(limits, selectedProvider, selectedAccountKey, selectedScopeKey),
  ]
    .map((row) => ({
      time: weeklyLimitRowTime(row)?.getTime() || 0,
      used: weeklyLimitUsedPercent(row),
    }))
    .filter((row) => row.used != null)
    .sort((left, right) => right.time - left.time);
  if (!candidates.length) return null;
  const latestTime = candidates[0].time;
  return Math.max(
    ...candidates
      .filter((row) => row.time === latestTime || latestTime === 0)
      .map((row) => Math.max(0, Math.min(100, row.used))),
  );
}

function withDailyWeeklyLimitPercents(rows, limitSamples, limits, selectedProvider, selectedAccountKey, selectedScopeKey = "all") {
  const directPercents = directDailyWeeklyLimitPercents(limitSamples, selectedProvider, selectedAccountKey, selectedScopeKey);
  let knownTokenTotal = 0;
  let knownPercentTotal = 0;
  const seeded = rows.map((row) => {
    const weeklyLimitPercent = directPercents.get(row.key);
    const total = dailyUsageValue(row);
    if (weeklyLimitPercent != null && total > 0) {
      knownTokenTotal += total;
      knownPercentTotal += weeklyLimitPercent;
    }
    return { ...row, weeklyLimitPercent, weeklyLimitPercentEstimated: false };
  });

  const tokenPercentRatio = knownTokenTotal > 0 && knownPercentTotal > 0
    ? knownPercentTotal / knownTokenTotal
    : null;
  const latestUsedPercent = latestWeeklyLimitUsedPercent(limitSamples, limits, selectedProvider, selectedAccountKey, selectedScopeKey);
  const visibleTokenTotal = seeded.reduce((sum, row) => sum + dailyUsageValue(row), 0);

  return seeded.map((row) => {
    if (row.weeklyLimitPercent != null || dailyUsageValue(row) <= 0) return row;
    let weeklyLimitPercent = null;
    if (tokenPercentRatio != null) {
      weeklyLimitPercent = dailyUsageValue(row) * tokenPercentRatio;
    } else if (latestUsedPercent != null && visibleTokenTotal > 0) {
      weeklyLimitPercent = (dailyUsageValue(row) / visibleTokenTotal) * latestUsedPercent;
    }
    return {
      ...row,
      weeklyLimitPercent: weeklyLimitPercent == null ? null : Math.max(0, Math.min(100, weeklyLimitPercent)),
      weeklyLimitPercentEstimated: weeklyLimitPercent != null,
    };
  });
}

function buildDailyRows(dailyRows, limitSamples, limits, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey = "all", windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const filtered = filterRows(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey);
  const byDay = new Map();
  for (const row of filtered) {
    const key = bucketDayKey(row);
    if (!key) continue;
    const current = byDay.get(key) || { key, rows: [] };
    current.rows.push(row);
    byDay.set(key, current);
  }

  const todayKey = dayKeyUtc(new Date());
  const latestDataKey = [...byDay.keys()].sort().pop() || todayKey;
  const endKey = latestDataKey > todayKey ? latestDataKey : todayKey;
  const endDate = dateFromDayKey(endKey);
  const buckets = [];
  for (let offset = Math.max(1, windowDays) - 1; offset >= 0; offset -= 1) {
    const date = addUtcDays(endDate, -offset);
    const key = dayKeyUtc(date);
    const match = byDay.get(key);
    const aggregate = aggregateRows(match?.rows || []);
    buckets.push({
      key,
      ...aggregate,
    });
  }
  const rows = buckets.map((row) => ({
    ...row,
    label: compactDayLabel(row.key),
    titleLabel: fullDayLabel(row.key, todayKey),
  }));
  return withDailyWeeklyLimitPercents(rows, limitSamples, limits, selectedProvider, selectedAccountKey, selectedScopeKey);
}

function rollingWindowAggregate(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey = "all", windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const today = dateFromDayKey(dayKeyUtc(new Date()));
  const startKey = dayKeyUtc(addUtcDays(today, -(Math.max(1, windowDays) - 1)));
  const endKey = dayKeyUtc(today);
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey)
    .filter((row) => {
      const key = bucketDayKey(row);
      return key >= startKey && key <= endKey;
    });
  return aggregateRows(rows);
}

function todayAggregate(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey = "all") {
  const today = dayKeyUtc(new Date());
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey)
    .filter((row) => bucketDayKey(row) === today);
  return aggregateRows(rows);
}

function filterLimits(limits, selectedProvider, selectedAccountKey = "all", selectedScopeKey = "all") {
  if (!Array.isArray(limits)) return [];
  return limits.filter((limit) => (
    (selectedProvider === "all" || providerKey(limit) === selectedProvider)
      && (selectedAccountKey === "all" || rowProviderAccountKey(limit) === selectedAccountKey)
      && (selectedScopeKey === "all" || rowScopeKey(limit) === selectedScopeKey)
  ));
}

function limitNumberOrNull(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseLimitTimestamp(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (/^resets\s+/i.test(text) && !/^resets\s+in\b/i.test(text)) {
    return parseLimitTimestamp(text.replace(/^resets\s+/i, ""));
  }
  if (text.startsWith("unix:")) {
    const unixSeconds = Number(text.slice(5));
    if (Number.isFinite(unixSeconds) && unixSeconds > 0) {
      return new Date(unixSeconds * 1000);
    }
  }
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return new Date(number < 1_000_000_000_000 ? number * 1000 : number);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function limitResetDate(limit = {}) {
  const direct = parseLimitTimestamp(limit.reset_at ?? limit.resetAt ?? limit.limit_resets_at ?? limit.limitResetsAt);
  if (direct) return direct;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds, limit.resetAfterSeconds);
  const updatedAt = parseLimitTimestamp(limit.updated_at ?? limit.updatedAt ?? limit.last_known_at ?? limit.lastKnownAt);
  if (resetAfterSeconds != null && updatedAt) {
    return new Date(updatedAt.getTime() + Math.max(0, resetAfterSeconds) * 1000);
  }
  return null;
}

function hasKnownLimitPercent(limit = {}) {
  return limitNumberOrNull(
    limit.remaining_percent,
    limit.remainingPercent,
    limit.used_percent,
    limit.usedPercent,
    limit.limit_used_percent,
    limit.limitUsedPercent,
  ) != null;
}

function limitDisplayPercentKind(limit = {}, fallbackWindowKind = "") {
  const explicit = String(
    limit.display_percent_kind
      ?? limit.displayPercentKind
      ?? limit.limit_display_percent_kind
      ?? limit.limitDisplayPercentKind
      ?? "",
  ).toLowerCase();
  if (explicit === "remaining" || explicit === "used") return explicit;
  const windowKind = String(
    fallbackWindowKind
      || limit.window_kind
      || limit.windowKind
      || limit.limit_kind
      || limit.limitKind
      || "",
  );
  return windowKind === "weekly" ? "remaining" : "used";
}

function limitDisplayPercent(limit = {}, usedPercent = null, remainingPercent = null, fallbackWindowKind = "") {
  const displayKind = limitDisplayPercentKind(limit, fallbackWindowKind);
  const percent = displayKind === "remaining" ? remainingPercent : usedPercent;
  return percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
}

function isProviderResetEstimate(limit = {}) {
  if (!(limit?.client_estimated || limit?.clientEstimated)) return false;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds, limit.resetAfterSeconds);
  const resetLabel = String(limit.reset_label || limit.resetLabel || "");
  return resetAfterSeconds === 0 && /provider window reset/i.test(resetLabel);
}

function clientProjectedLimit(limit = {}) {
  const resetDate = limitResetDate(limit);
  if (!resetDate || !hasKnownLimitPercent(limit)) return limit;
  const secondsUntilReset = Math.round((resetDate.getTime() - Date.now()) / 1000);
  if (secondsUntilReset > 0) {
    return {
      ...limit,
      reset_after_seconds: secondsUntilReset,
      resetAfterSeconds: secondsUntilReset,
    };
  }
  const resetWindowKind = String(limit.window_kind || limit.windowKind || limit.limit_kind || limit.limitKind || "");
  const resetDisplayKind = limitDisplayPercentKind(limit, resetWindowKind);
  const resetDisplayPercent = resetDisplayKind === "remaining" ? 100 : 0;
  return {
    ...limit,
    used: 0,
    allowance: 100,
    remaining: 100,
    used_percent: 0,
    usedPercent: 0,
    limit_used_percent: 0,
    limitUsedPercent: 0,
    remaining_percent: 100,
    remainingPercent: 100,
    display_percent: resetDisplayPercent,
    displayPercent: resetDisplayPercent,
    display_percent_kind: resetDisplayKind,
    displayPercentKind: resetDisplayKind,
    reset_after_seconds: 0,
    resetAfterSeconds: 0,
    status_label: "Available",
    statusLabel: "Available",
    reset_label: "Provider window reset; waiting for live refresh",
    resetLabel: "Provider window reset; waiting for live refresh",
    client_estimated: true,
    clientEstimated: true,
  };
}

function mergeLimits(limits, windowKind) {
  const rows = limits
    .filter((limit) => String(limit?.window_kind || limit?.windowKind || limit?.limit_kind || limit?.limitKind || "") === windowKind)
    .map(clientProjectedLimit);
  if (!rows.length) {
    return {
      windowKind,
      label: windowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit",
      planDetected: false,
      planName: "No plan detected",
      confidence: "unknown",
      remainingPercent: null,
      usedPercent: null,
      displayPercent: null,
      displayPercentKind: limitDisplayPercentKind({}, windowKind),
      paceDelta: 0,
      paceStatus: "unknown",
      overPace: false,
      statusLabel: "Plan limit not exposed",
      resetLabel: windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule",
      ratePoints: [],
    };
  }
  const resetEstimated = rows.length > 0 && rows.every(isProviderResetEstimate);
  const used = rows.reduce((sum, row) => sum + numeric(row?.used), 0);
  const allowanceValues = rows.map((row) => numeric(row?.allowance)).filter((value) => value > 0);
  const allowance = allowanceValues.length ? allowanceValues.reduce((sum, value) => sum + value, 0) : null;
  const usedPercent = resetEstimated
    ? 0
    : allowance
      ? Math.max(0, Math.min(100, Math.round((used / allowance) * 100)))
      : null;
  const remainingPercent = resetEstimated ? 100 : (usedPercent == null ? null : Math.max(0, 100 - usedPercent));
  const displayPercentKind = limitDisplayPercentKind(rows[0], windowKind);
  const displayPercent = resetEstimated
    ? (displayPercentKind === "remaining" ? 100 : 0)
    : limitDisplayPercent(rows[0], usedPercent, remainingPercent, windowKind);
  const paceDelta = resetEstimated
    ? 0
    : Math.round(rows.reduce((sum, row) => sum + numeric(row?.pace_delta_percent, row?.paceDeltaPercent), 0) / rows.length);
  const plans = [...new Set(rows.map((row) => row?.plan_name || row?.planName).filter(Boolean))];
  const confidences = [...new Set(rows.map((row) => row?.confidence).filter(Boolean))];
  const ratePoints = rows.flatMap((row) => Array.isArray(row?.rate_points || row?.ratePoints) ? (row.rate_points || row.ratePoints) : []);
  const limitSource = rows.find((row) => row?.limit_source || row?.limitSource)?.limit_source || rows.find((row) => row?.limitSource)?.limitSource || "";
  const providerKeys = [...new Set(rows.map(providerKey).filter(Boolean))];
  const claudeUnavailable = isClaudeLimitUnavailable(rows);
  const paceStatus = resetEstimated ? "on_pace" : limitPaceStatus(rows);
  const overPace = paceStatus === "over_pace" || paceDelta > 0;
  return {
    windowKind,
    label: rows[0]?.label || (windowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit"),
    planDetected: rows.some((row) => Boolean(row?.plan_detected ?? row?.planDetected)),
    planName: plans.length ? plans.join(" + ") : "No plan detected",
    confidence: confidences.includes("estimated") ? "estimated" : (confidences[0] || "unknown"),
    limitSource,
    providerKeys,
    remainingPercent,
    usedPercent,
    displayPercent,
    displayPercentKind,
    paceDelta,
    paceStatus,
    overPace,
    statusLabel: resetEstimated ? "Available" : limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable, paceStatus),
    resetLabel: limitResetLabel(rows, windowKind, claudeUnavailable),
    ratePoints,
    limitWindowSeconds: numeric(rows[0]?.limit_window_seconds, rows[0]?.limitWindowSeconds),
    resetAfterSeconds: numeric(rows[0]?.reset_after_seconds, rows[0]?.resetAfterSeconds),
    credits: rows.find((row) => row?.credits)?.credits || null,
  };
}

function isClaudeLimitUnavailable(rows) {
  return rows.some((row) => {
    if (providerKey(row) !== "claude") return false;
    const source = String(row?.limit_source || row?.limitSource || "").toLowerCase();
    const confidence = String(row?.confidence || "").toLowerCase();
    const status = String(row?.status_label || row?.statusLabel || "").toLowerCase();
    return source === "claude_statusline_unavailable"
      || source === "not_exposed"
      || confidence === "unknown"
      || status.includes("not exposed")
      || status.includes("unavailable");
  });
}

function truthyLimitValue(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function limitPaceStatus(rows) {
  if (!Array.isArray(rows) || !rows.length) return "unknown";
  if (rows.some((row) => {
    const status = String(row?.pace_status || row?.paceStatus || "").toLowerCase();
    return status === "over_pace" || truthyLimitValue(row?.pace_exhausts_before_reset ?? row?.paceExhaustsBeforeReset);
  })) {
    return "over_pace";
  }
  if (rows.some((row) => String(row?.pace_status || row?.paceStatus || "").toLowerCase() === "on_pace")) {
    return "on_pace";
  }
  return "unknown";
}

function limitResetLabel(rows, windowKind, claudeUnavailable) {
  const current = rows[0]?.reset_label || rows[0]?.resetLabel || "";
  if (!claudeUnavailable) {
    return current || (windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule");
  }
  if (!current || current.includes("Provider limit unavailable")) {
    return "Open Claude Code to publish live limits";
  }
  if (current.includes("Provider schedule unavailable")) {
    return "Claude Code has not reported its weekly window";
  }
  return current;
}

function limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable = false, paceStatus = "unknown") {
  if (remainingPercent == null) {
    if (claudeUnavailable) return "Live limits unavailable";
    return rows.find((row) => row?.status_label || row?.statusLabel)?.status_label || "Plan limit not exposed";
  }
  if (remainingPercent <= 0) return "Limit exhausted";
  if (paceStatus === "over_pace" || paceDelta > 0) return "Pace will exhaust before reset";
  if (remainingPercent < 18) return "Pace is running hot";
  if (remainingPercent < 38 || paceDelta > 8) return "Watch current pace";
  return "Safe at current pace";
}

function usageRateRowsFromLimit(limit, hourlyRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey = "all") {
  const windowSeconds = sessionWindowSeconds(limit);
  const bucketCount = Math.max(1, Math.ceil(windowSeconds / 3600));
  const rows = filterRows(Array.isArray(hourlyRows) ? hourlyRows : [], selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey);
  if (rows.some((row) => row?.window_index != null || row?.windowIndex != null)) {
    const byIndex = new Map();
    for (const row of rows) {
      const index = numeric(row?.window_index, row?.windowIndex);
      const previous = byIndex.get(index) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
      byIndex.set(index, {
        total: previous.total + rowActivityTokens(row),
        input: previous.input + rowInput(row),
        output: previous.output + rowOutput(row),
        cache: previous.cache + rowCache(row),
        cost: previous.cost + rowCost(row),
      });
    }
    return Array.from({ length: bucketCount }, (_, index) => {
      const aggregate = byIndex.get(index) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
      const remaining = bucketCount - 1 - index;
      return {
        key: `rolling-${index}`,
        label: remaining === 0 ? "now" : `-${remaining}h`,
        ...aggregate,
      };
    });
  }
  const byHour = new Map();
  for (const row of rows) {
    const date = parseHourBucketDate(row);
    if (!date) continue;
    const key = hourKey(date);
    const previous = byHour.get(key) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
    byHour.set(key, {
      total: previous.total + rowActivityTokens(row),
      input: previous.input + rowInput(row),
      output: previous.output + rowOutput(row),
      cache: previous.cache + rowCache(row),
      cost: previous.cost + rowCost(row),
    });
  }

  const now = new Date();
  now.setMinutes(0, 0, 0);
  const recent = [];
  for (let offset = bucketCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(now.getHours() - offset);
    const key = hourKey(date);
    const aggregate = byHour.get(key) || { total: 0, input: 0, output: 0, cache: 0, cost: 0 };
    recent.push({
      key,
      label: offset === 0 ? "now" : `-${offset}h`,
      ...aggregate,
    });
  }
  return recent;
}

function parseHourBucketDate(row) {
  const raw = row?.bucket_start || row?.bucketStart;
  if (!raw) return null;
  const value = String(raw);
  const date = new Date(value.length === 13 ? `${value}:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hourKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}`;
}

function usageRatePath(points, width, height) {
  if (!points.length) return "";
  const max = Math.max(1, ...points.map((point) => numeric(point.total)));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  return points
    .map((point, index) => {
      const x = index * step;
      const y = height - Math.max(4, Math.min(height - 4, (numeric(point.total) / max) * (height - 12)));
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function usageRateBarWidth(pointCount) {
  if (pointCount <= 1) return 8;
  const step = 340 / Math.max(1, pointCount - 1);
  return Math.max(1.1, Math.min(8, step * 0.58));
}

function usageRateAxisLabel(remainingHours) {
  if (remainingHours <= 0) return "now";
  if (remainingHours >= 24) return `-${Math.ceil(remainingHours / 24)}d`;
  return `-${remainingHours}h`;
}

function usageRateAxisLabels(rows, windowKind) {
  if (!rows.length) return [];
  if (rows.length <= 12) {
    return rows.map((row) => ({ key: row.key, label: row.label }));
  }
  const lastIndex = rows.length - 1;
  return rows
    .map((row, index) => {
      const remaining = lastIndex - index;
      const show = index === 0
        || index === lastIndex
        || (windowKind === "weekly" ? remaining % 24 === 0 : remaining % 6 === 0);
      return show ? { key: row.key, label: usageRateAxisLabel(remaining) } : null;
    })
    .filter(Boolean);
}

function sessionWindowSeconds(limit) {
  return numeric(limit?.limitWindowSeconds, limit?.limit_window_seconds) || 5 * 60 * 60;
}

function limitSourceText(limit) {
  const source = limit?.limitSource || limit?.limit_source || "";
  const isClaude = Array.isArray(limit?.providerKeys) && limit.providerKeys.includes("claude");
  if (source === "claude_statusline_unavailable") return "Live Claude Code limits unavailable";
  if (source === "claude_statusline") return "Live Claude Code usage";
  if (source === "codex_usage_api") return "Live Codex usage";
  if (limit?.confidence === "live") return "Live provider usage";
  if (isClaude && (source === "not_exposed" || limit?.confidence === "unknown")) return "Live Claude Code limits unavailable";
  if (source === "not_exposed") return "Provider limit not exposed";
  if (source === "local_inferred") return "Limits estimated from local CLI usage";
  if (limit?.confidence === "estimated") return "Limits estimated from local CLI usage";
  return "Provider limit not exposed";
}

function planStatusTitle(limit, selectedProvider) {
  if (!limit?.planDetected) {
    return selectedProvider === "claude" ? "No Claude account detected" : "No provider plan detected";
  }
  const name = String(limit?.planName || "").trim();
  if (selectedProvider === "claude" && name === "Claude subscription") {
    return "Claude account signed in";
  }
  return name || (selectedProvider === "claude" ? "Claude account signed in" : "Provider plan detected");
}

function codexCreditBalance(limits) {
  const match = limits.find((limit) => {
    const credits = limit?.credits;
    return credits && (credits.balance != null || credits.has_credits || credits.hasCredits);
  });
  return match?.credits || null;
}

function statusTone(remainingPercent, paceDelta = 0, paceStatus = "unknown") {
  if (remainingPercent == null) return "unknown";
  if (remainingPercent <= 15 || paceStatus === "over_pace" || paceDelta > 0) return "danger";
  if (remainingPercent <= 38 || paceDelta > 8) return "warn";
  return "good";
}

function limitPercentTone(percent, displayPercentKind = "used") {
  if (percent == null) return "unknown";
  const value = Number(percent);
  if (!Number.isFinite(value)) return "unknown";
  if (displayPercentKind === "remaining") {
    if (value <= 15) return "danger";
    if (value <= 38) return "warn";
    return "good";
  }
  if (value >= 82) return "danger";
  if (value >= 62) return "warn";
  return "good";
}

function toneColor(tone) {
  if (tone === "danger") return "#ff5a5f";
  if (tone === "warn") return "#fb923c";
  if (tone === "unknown") return "#94a3b8";
  return "#60a5fa";
}

function dailyPercentTone(value, weeklyLimitPercent) {
  if (value <= 0) return "quiet";
  if (weeklyLimitPercent == null) return "good";
  if (weeklyLimitPercent > 20) return "danger";
  if (weeklyLimitPercent > 13) return "warn";
  return "good";
}

function dailyLimitTitle(row) {
  const percent = limitNumberOrNull(row?.weeklyLimitPercent);
  if (percent == null) return dailyUsageTitle(row);
  const source = row?.weeklyLimitPercentEstimated ? "est. weekly limit" : "weekly limit";
  return `${dailyUsageTitle(row)} · ${source} ${Math.round(percent)}%`;
}

function dailyLimitTone(row) {
  return dailyPercentTone(dailyUsageValue(row), limitNumberOrNull(row?.weeklyLimitPercent));
}

function dailyBarHeight(value, maxValue) {
  const total = numeric(value);
  if (total <= 0) return 5;
  const max = Math.max(1, numeric(maxValue));
  return Math.max(11, Math.round((total / max) * 94));
}

function modelBreakdown(modelRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey = "all") {
  const rows = filterRows(modelRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey);
  const byModel = new Map();
  for (const row of rows) {
    const rawModel = String(row?.model || "").trim();
    const agentKind = String(row?.agent_kind || row?.agentKind || "").trim();
    const label = rawModel && rawModel !== agentKind ? rawModel : providerLabel(row);
    const key = label || "Unknown model";
    const current = byModel.get(key) || { label: key, total: 0 };
    current.total += rowActivityTokens(row);
    byModel.set(key, current);
  }
  const total = [...byModel.values()].reduce((sum, row) => sum + row.total, 0);
  if (total <= 0) {
    return (PROVIDER_MODELS[selectedProvider] || []).map((label) => ({ label, percent: 0 })).slice(0, 5);
  }

  return [...byModel.values()]
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
    .slice(0, 5)
    .map((row) => ({
      label: row.label,
      percent: Math.max(1, Math.round((row.total / total) * 100)),
    }));
}

function providerAccountOptions(summary, selectedProvider, selectedDeviceId = "all", selectedScopeKey = "all") {
  if (selectedProvider === "all") return [];
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  const usageRows = Array.isArray(summary?.by_device_account) ? summary.by_device_account : [];
  const limitRows = Array.isArray(summary?.limits) ? summary.limits : [];
  const rows = [
    ...usageRows,
    ...limitRows,
  ].filter((row) => (
    provider.match(row)
      && ((row?.window_kind || row?.windowKind || row?.limit_kind || row?.limitKind)
        || selectedDeviceId === "all"
        || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
  const byKey = new Map();
  for (const row of rows) {
    const key = rowProviderAccountKey(row);
    if (!key) continue;
    const current = byKey.get(key) || {
      key,
      label: rowProviderAccountLabel(row),
      total: 0,
    };
    current.total += rowTotal(row);
    if (!current.label || current.label === key) {
      current.label = rowProviderAccountLabel(row);
    }
    byKey.set(key, current);
  }
  const accounts = [...byKey.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  if (!accounts.length) return [];
  return [{ key: "all", label: "All accounts" }, ...accounts];
}

function deviceOptions(summary, selectedScopeKey = "all") {
  const currentDeviceId = String(summary?.current_device_id || summary?.currentDeviceId || "").trim();
  const identityMap = tokenomicsDeviceIdentityMap(summary);
  const rows = [
    ...(Array.isArray(summary?.by_device) ? summary.by_device : []),
    ...(Array.isArray(summary?.by_device_provider) ? summary.by_device_provider : []),
    ...(Array.isArray(summary?.by_device_account) ? summary.by_device_account : []),
    ...(Array.isArray(summary?.by_device_model) ? summary.by_device_model : []),
    ...(Array.isArray(summary?.daily_by_device_provider) ? summary.daily_by_device_provider : []),
    ...(Array.isArray(summary?.hourly) ? summary.hourly : []),
  ];
  const byDevice = new Map();
  for (const row of rows) {
    if (selectedScopeKey !== "all" && rowScopeKey(row) !== selectedScopeKey) continue;
    const id = rowDeviceId(row);
    if (!id) continue;
    const current = byDevice.get(id) || {
      key: id,
      current: currentDeviceId === id,
      label: deviceLabel(id, currentDeviceId, identityMap),
      total: 0,
    };
    current.current = current.current || currentDeviceId === id;
    current.label = deviceLabel(id, currentDeviceId, identityMap);
    current.total += rowTotal(row);
    byDevice.set(id, current);
  }
  const devices = [...byDevice.values()].sort((a, b) => {
    if (a.key === currentDeviceId) return -1;
    if (b.key === currentDeviceId) return 1;
    return b.total - a.total || a.label.localeCompare(b.label);
  });
  return [{ key: "all", label: "All devices" }, ...dedupeDeviceLabels(devices)];
}

function scopeOptions(summary) {
  const rows = [
    ...(Array.isArray(summary?.by_device_provider) ? summary.by_device_provider : []),
    ...(Array.isArray(summary?.by_device_account) ? summary.by_device_account : []),
    ...(Array.isArray(summary?.by_device_model) ? summary.by_device_model : []),
    ...(Array.isArray(summary?.daily_by_device_provider) ? summary.daily_by_device_provider : []),
    ...(Array.isArray(summary?.hourly) ? summary.hourly : []),
    ...(Array.isArray(summary?.limits) ? summary.limits : []),
  ];
  const byScope = new Map();
  for (const row of rows) {
    const key = rowScopeKey(row);
    if (!key || key === "unknown") continue;
    const current = byScope.get(key) || {
      key,
      label: rowScopeLabel(row, key),
      total: 0,
    };
    current.total += rowTotal(row);
    byScope.set(key, current);
  }
  const scopes = [...byScope.values()].sort((left, right) => {
    if (left.key === "personal") return -1;
    if (right.key === "personal") return 1;
    return right.total - left.total || left.label.localeCompare(right.label);
  });
  if (!scopes.length) return [];
  return [{ key: "all", label: "All scopes" }, ...scopes];
}

function lastUpdatedText(value) {
  if (!value) return "Updated just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated just now";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `Updated ${seconds || 1} sec ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.round(minutes / 60)} hr ago`;
}

function providerLimitKey(row = {}) {
  return [
    rowScopeKey(row),
    providerKey(row),
    rowProviderAccountKey(row),
    String(row?.window_kind || row?.windowKind || row?.limit_kind || row?.limitKind || "provider_limit"),
  ].join("::");
}

function providerLimitSampleKey(row = {}) {
  return [
    rowScopeKey(row),
    providerKey(row),
    rowProviderAccountKey(row),
    String(row?.window_kind || row?.windowKind || row?.limit_kind || row?.limitKind || "provider_limit"),
    String(row?.sample_bucket_start || row?.sampleBucketStart || row?.bucket_start || row?.bucketStart || ""),
  ].join("::");
}

function providerLimitIsUnknown(row = {}) {
  const source = String(row?.limit_source || row?.limitSource || "").toLowerCase();
  const confidence = String(row?.confidence || "").toLowerCase();
  const status = String(row?.status_label || row?.statusLabel || "").toLowerCase();
  const hasPercent = row?.remaining_percent != null
    || row?.remainingPercent != null
    || row?.used_percent != null
    || row?.usedPercent != null;
  return source === "not_exposed"
    || confidence === "unknown"
    || status.includes("not exposed")
    || (!hasPercent && row?.allowance == null && row?.used == null);
}

function mergeProviderLimits(previousLimits, nextLimits) {
  const previousRows = Array.isArray(previousLimits) ? previousLimits : [];
  if (!Array.isArray(nextLimits)) return previousRows;
  if (!nextLimits.length && previousRows.length) return previousRows;

  const merged = new Map();
  previousRows.forEach((row) => merged.set(providerLimitKey(row), row));
  nextLimits.forEach((row) => {
    const key = providerLimitKey(row);
    const existing = merged.get(key);
    if (existing && !providerLimitIsUnknown(existing) && providerLimitIsUnknown(row)) {
      return;
    }
    merged.set(key, row);
  });
  return [...merged.values()];
}

function mergeProviderLimitSamples(previousSamples, nextSamples) {
  const previousRows = Array.isArray(previousSamples) ? previousSamples : [];
  if (!Array.isArray(nextSamples)) return previousRows;
  if (!nextSamples.length && previousRows.length) return previousRows;

  const merged = new Map();
  previousRows.forEach((row) => merged.set(providerLimitSampleKey(row), row));
  nextSamples.forEach((row) => merged.set(providerLimitSampleKey(row), row));
  return [...merged.values()];
}

function providerLimitDisplayedRemainingPercent(row = {}) {
  const remaining = limitNumberOrNull(row?.remaining_percent, row?.remainingPercent);
  if (remaining != null) return Math.max(0, Math.min(100, Math.round(remaining)));
  const used = limitNumberOrNull(row?.used_percent, row?.usedPercent, row?.limit_used_percent, row?.limitUsedPercent);
  if (used != null) return Math.max(0, Math.min(100, Math.round(100 - used)));
  const allowance = limitNumberOrNull(row?.allowance);
  const usedAmount = limitNumberOrNull(row?.used);
  if (allowance && usedAmount != null) {
    return Math.max(0, Math.min(100, Math.round(100 - ((usedAmount / allowance) * 100))));
  }
  return null;
}

function tokenomicsLimitPercentSignature(summary = {}) {
  const limits = Array.isArray(summary?.limits) ? summary.limits : [];
  const limitSignature = mergeProviderLimits([], limits)
    .map((row) => {
      const remaining = providerLimitDisplayedRemainingPercent(row);
      if (remaining == null) return "";
      return `${providerLimitKey(row)}=${remaining}`;
    })
    .filter(Boolean)
    .sort()
    .join("|");
  const samples = Array.isArray(summary?.limit_samples)
    ? summary.limit_samples
    : (Array.isArray(summary?.limitSamples) ? summary.limitSamples : []);
  const sampleSignature = mergeProviderLimitSamples([], samples)
    .map((row) => {
      const used = limitNumberOrNull(row?.used_percent, row?.usedPercent, row?.limit_used_percent, row?.limitUsedPercent);
      if (used == null) return "";
      return `${providerLimitSampleKey(row)}=${Math.round(used)}`;
    })
    .filter(Boolean)
    .sort()
    .join("|");
  return [limitSignature, sampleSignature].filter(Boolean).join("|");
}

function mergeTokenomicsSummary(previous, next) {
  if (!previous) return stripLegacyTokenomicsSummaryFields(next || {});
  if (!next) return previous;
  const merged = {
    ...previous,
    ...next,
    total: next.total || previous.total,
    by_device: next.by_device || previous.by_device,
    by_device_provider: next.by_device_provider || previous.by_device_provider,
    by_device_account: next.by_device_account || previous.by_device_account,
    by_device_model: next.by_device_model || previous.by_device_model,
    daily_by_device_provider: next.daily_by_device_provider || previous.daily_by_device_provider,
    monthly_by_device_provider: next.monthly_by_device_provider || previous.monthly_by_device_provider,
    hourly: next.hourly || previous.hourly,
    sources: next.sources || previous.sources,
    limits: mergeProviderLimits(previous.limits, next.limits),
    limit_samples: mergeProviderLimitSamples(previous.limit_samples || previous.limitSamples, next.limit_samples || next.limitSamples),
    limitSamples: mergeProviderLimitSamples(previous.limitSamples || previous.limit_samples, next.limitSamples || next.limit_samples),
    device_identities: next.device_identities || previous.device_identities,
    deviceIdentities: next.deviceIdentities || previous.deviceIdentities,
    credits: next.credits || previous.credits,
    storage_usage: next.storage_usage || previous.storage_usage,
    storageUsage: next.storageUsage || previous.storageUsage,
  };
  return stripLegacyTokenomicsSummaryFields(merged);
}

function stripLegacyTokenomicsSummaryFields(summary) {
  const clean = { ...summary };
  for (const key of [
    "by_provider",
    "by_account",
    "by_model",
    "daily_by_provider",
    "monthly_by_provider",
    "hourly_by_provider",
    "session_hourly_by_provider",
    "accounts",
    "rollups",
  ]) {
    delete clean[key];
  }
  return clean;
}

const tokenomicsStore = {
  accountKey: "local-account",
  requestEpoch: 0,
  state: createTokenomicsStoreState(),
  loadedOnce: false,
  loadPromise: null,
  liveLimitsPromise: null,
  pollInterval: null,
  pollSubscriberCount: 0,
  limitPercentSignature: "",
  limitSyncInFlight: false,
  limitSyncPending: false,
  progressListenerPromise: null,
  progressUnlisten: null,
  subscribers: new Set(),
};

/* Device-authoritative cloud sync of the DISPLAY model: whatever summary
   this store renders is published verbatim so the next dashboard and other
   devices show byte-identical numbers. Throttled here; Rust additionally
   hash-skips unchanged summaries so steady-state ticks cost nothing. */
const TOKENOMICS_DISPLAY_PUBLISH_MIN_MS = 15_000;
let tokenomicsDisplayPublishLastMs = 0;
let tokenomicsDisplayPublishTimer = 0;

function publishTokenomicsDisplaySnapshot() {
  const summary = tokenomicsStore.state.summary;
  if (!summary || typeof summary !== "object") {
    return;
  }
  const now = Date.now();
  const wait = Math.max(0, TOKENOMICS_DISPLAY_PUBLISH_MIN_MS - (now - tokenomicsDisplayPublishLastMs));
  if (tokenomicsDisplayPublishTimer) {
    return;
  }
  tokenomicsDisplayPublishTimer = window.setTimeout(() => {
    tokenomicsDisplayPublishTimer = 0;
    tokenomicsDisplayPublishLastMs = Date.now();
    const current = tokenomicsStore.state.summary;
    if (!current || typeof current !== "object") {
      return;
    }
    invoke("tokenomics_publish_display_snapshot", { summary: current }).catch(() => {});
  }, wait);
}

function notifyTokenomicsSubscribers() {
  for (const subscriber of tokenomicsStore.subscribers) {
    subscriber(tokenomicsStore.state);
  }
  publishTokenomicsDisplaySnapshot();
}

function updateTokenomicsStore(patchOrUpdater) {
  const previous = tokenomicsStore.state;
  const patch = typeof patchOrUpdater === "function"
    ? patchOrUpdater(previous)
    : patchOrUpdater;
  tokenomicsStore.state = {
    ...previous,
    ...(patch || {}),
  };
  notifyTokenomicsSubscribers();
}

function subscribeTokenomicsStore(subscriber) {
  tokenomicsStore.subscribers.add(subscriber);
  subscriber(tokenomicsStore.state);
  return () => {
    tokenomicsStore.subscribers.delete(subscriber);
  };
}

function tokenomicsErrorMessage(caught) {
  return caught?.message || String(caught || "Unable to load Tokenomics.");
}

function rememberTokenomicsLimitSignature(summary) {
  const signature = tokenomicsLimitPercentSignature(summary);
  if (signature) {
    tokenomicsStore.limitPercentSignature = signature;
  }
  return signature;
}

function scheduleTokenomicsLimitCloudSync() {
  if (tokenomicsStore.limitSyncInFlight) {
    tokenomicsStore.limitSyncPending = true;
    return;
  }
  tokenomicsStore.limitSyncInFlight = true;
  invoke("cloud_mcp_schedule_tokenomics_sync", {
    reason: "tokenomics_limits_changed",
    full: false,
    resyncLast30Days: false,
  })
    .catch(() => {})
    .finally(() => {
      tokenomicsStore.limitSyncInFlight = false;
      if (tokenomicsStore.limitSyncPending) {
        tokenomicsStore.limitSyncPending = false;
        scheduleTokenomicsLimitCloudSync();
      }
    });
}

function mergeSummaryIntoTokenomicsStore(next, { syncLimitChanges = false } = {}) {
  let nextSignature = "";
  let shouldSyncLimits = false;
  updateTokenomicsStore((previous) => ({
    summary: (() => {
      const merged = mergeTokenomicsSummary(previous.summary, next || {});
      const previousSignature = tokenomicsStore.limitPercentSignature || tokenomicsLimitPercentSignature(previous.summary);
      nextSignature = tokenomicsLimitPercentSignature(merged);
      shouldSyncLimits = Boolean(syncLimitChanges && previousSignature && nextSignature && previousSignature !== nextSignature);
      return merged;
    })(),
  }));
  if (nextSignature) {
    tokenomicsStore.limitPercentSignature = nextSignature;
  }
  if (shouldSyncLimits) {
    scheduleTokenomicsLimitCloudSync();
  }
}

function resetTokenomicsStoreForAccount(accountKey) {
  const normalizedAccountKey = normalizeTokenomicsAccountKey(accountKey);
  if (tokenomicsStore.accountKey === normalizedAccountKey) {
    return;
  }

  tokenomicsStore.accountKey = normalizedAccountKey;
  tokenomicsStore.requestEpoch += 1;
  tokenomicsStore.loadedOnce = false;
  tokenomicsStore.loadPromise = null;
  tokenomicsStore.liveLimitsPromise = null;
  tokenomicsStore.limitPercentSignature = "";
  tokenomicsStore.limitSyncPending = false;
  tokenomicsStore.state = createTokenomicsStoreState();
  notifyTokenomicsSubscribers();
}

function ensureTokenomicsProgressListener() {
  if (tokenomicsStore.progressUnlisten || tokenomicsStore.progressListenerPromise) {
    return;
  }

  tokenomicsStore.progressListenerPromise = listen(TOKENOMICS_SCAN_PROGRESS_EVENT, (event) => {
    const payload = event.payload || null;
    updateTokenomicsStore({ scanProgress: payload });
    if (payload?.summary) {
      mergeSummaryIntoTokenomicsStore(payload.summary);
    }
  })
    .then((handler) => {
      tokenomicsStore.progressUnlisten = handler;
    })
    .catch(() => {})
    .finally(() => {
      tokenomicsStore.progressListenerPromise = null;
    });
}

function refreshTokenomicsLiveLimits({ syncLimitChanges = false } = {}) {
  const requestEpoch = tokenomicsStore.requestEpoch;
  if (tokenomicsStore.liveLimitsPromise) {
    return tokenomicsStore.liveLimitsPromise;
  }
  tokenomicsStore.liveLimitsPromise = invoke("tokenomics_get_live_limits")
    .then((limitsSummary) => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        mergeSummaryIntoTokenomicsStore(limitsSummary || {}, { syncLimitChanges });
      }
      return tokenomicsStore.state.summary;
    })
    .catch(() => tokenomicsStore.state.summary)
    .finally(() => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        tokenomicsStore.liveLimitsPromise = null;
      }
    });
  return tokenomicsStore.liveLimitsPromise;
}

function loadTokenomicsStore({ scan = false, force = false } = {}) {
  const hasSummary = Boolean(tokenomicsStore.state.summary);
  const shouldScan = Boolean(scan || !tokenomicsStore.loadedOnce);
  const requestEpoch = tokenomicsStore.requestEpoch;

  if (tokenomicsStore.loadPromise) {
    return tokenomicsStore.loadPromise;
  }
  if (!force && !shouldScan && tokenomicsStore.loadedOnce && hasSummary) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }

  updateTokenomicsStore((previous) => ({
    error: "",
    scanProgress: shouldScan ? null : previous.scanProgress,
    status: shouldScan ? "scanning" : (previous.summary ? "ready" : "loading"),
  }));

  tokenomicsStore.loadPromise = (async () => {
    try {
      if (shouldScan) {
        void refreshTokenomicsLiveLimits();
      }

      const next = shouldScan
        ? await invoke("tokenomics_scan_usage")
        : await invoke("tokenomics_get_summary");
      if (tokenomicsStore.requestEpoch !== requestEpoch) {
        return tokenomicsStore.state.summary;
      }
      tokenomicsStore.loadedOnce = true;
      updateTokenomicsStore((previous) => ({
        error: "",
        status: "ready",
        summary: mergeTokenomicsSummary(previous.summary, next || {}),
      }));
      rememberTokenomicsLimitSignature(tokenomicsStore.state.summary);
      return tokenomicsStore.state.summary;
    } catch (caught) {
      if (tokenomicsStore.requestEpoch !== requestEpoch) {
        return tokenomicsStore.state.summary;
      }
      updateTokenomicsStore((previous) => ({
        error: tokenomicsErrorMessage(caught),
        status: previous.summary ? "ready" : "error",
      }));
      return tokenomicsStore.state.summary;
    }
  })();

  tokenomicsStore.loadPromise.finally(() => {
    if (tokenomicsStore.requestEpoch === requestEpoch) {
      tokenomicsStore.loadPromise = null;
    }
  });

  return tokenomicsStore.loadPromise;
}

export function startAccountTokenomicsStartupScan(accountKey = "") {
  resetTokenomicsStoreForAccount(accountKey);
  ensureTokenomicsProgressListener();
  return loadTokenomicsStore({ scan: true, force: true });
}

function startTokenomicsViewPolling() {
  ensureTokenomicsProgressListener();
  tokenomicsStore.pollSubscriberCount += 1;
  void loadTokenomicsStore().finally(() => {
    void refreshTokenomicsLiveLimits({ syncLimitChanges: true });
  });

  if (!tokenomicsStore.pollInterval) {
    tokenomicsStore.pollInterval = window.setInterval(() => {
      void refreshTokenomicsLiveLimits({ syncLimitChanges: true });
      void loadTokenomicsStore({ force: true });
    }, TOKENOMICS_VIEW_POLL_INTERVAL_MS);
  }

  return () => {
    tokenomicsStore.pollSubscriberCount = Math.max(0, tokenomicsStore.pollSubscriberCount - 1);
    if (tokenomicsStore.pollSubscriberCount === 0 && tokenomicsStore.pollInterval) {
      window.clearInterval(tokenomicsStore.pollInterval);
      tokenomicsStore.pollInterval = null;
    }
  };
}

function tokenomicsLoadingLabel(status, summary, progress) {
  const phase = String(progress?.phase || "");
  if (phase === "complete") return "Finalizing usage";
  if (phase === "catch_up") return "Catching up usage";
  if (phase === "day_start" || phase === "backfill_start") return "Scanning 30-day usage";
  return status === "scanning" || !summary ? "Scanning usage" : "Loading usage";
}

function tokenomicsLoadingDetail(progress) {
  const dayIndex = numeric(progress?.day_index, progress?.dayIndex);
  const dayTotal = numeric(progress?.day_total, progress?.dayTotal);
  const dayLabel = String(progress?.day_label || progress?.dayLabel || "").trim();
  const files = numeric(progress?.files_scanned, progress?.filesScanned);
  const events = numeric(progress?.inserted_events, progress?.insertedEvents);
  const parts = [];
  if (dayLabel) parts.push(dayLabel);
  if (dayIndex > 0 && dayTotal > 0) parts.push(`${dayIndex}/${dayTotal}`);
  parts.push(`${files} files`);
  parts.push(`${events} events`);
  return parts.join(" · ");
}

function TokenCell({ value }) {
  return <td title={formatTokenTitle(value)}>{formatTokens(value)}</td>;
}

function CostCell({ value }) {
  return <td title={formatCostTitle(value)}>{formatCost(value)}</td>;
}

function LimitMetricCard({ icon: Icon, limit, title }) {
  const displayPercent = limit.displayPercent;
  const displayKind = limit.displayPercentKind || "used";
  const progressLabel = displayKind === "remaining" ? `${title} remaining` : `${title} used`;
  return (
    <LimitCard tone={statusTone(limit.remainingPercent, limit.paceDelta, limit.paceStatus)}>
      <MetricHeading>
        <MetricName>
          <Icon aria-hidden="true" />
          <span>{title}</span>
        </MetricName>
        <MetricScore>
          <strong>{displayPercent == null ? "—" : `${displayPercent}%`}</strong>
          <span>{limit.paceDelta > 0 ? "▲" : "▼"}{Math.abs(limit.paceDelta)}%</span>
        </MetricScore>
      </MetricHeading>
      <ProgressTrack aria-label={progressLabel}>
        <ProgressFill
          $tone={limitPercentTone(displayPercent, displayKind)}
          style={{ width: `${displayPercent ?? 0}%` }}
        />
      </ProgressTrack>
      <MetricFoot>
        <span>{limit.resetLabel}</span>
        <strong>{limit.statusLabel}</strong>
      </MetricFoot>
    </LimitCard>
  );
}

function ProviderLimitGroup({ fiveHour, providerId, weekly }) {
  return (
    <ProviderLimitColumn>
      <ProviderLimitHeading $provider={providerId}>
        <strong>{providerDisplayName(providerId)}</strong>
      </ProviderLimitHeading>
      <PlanStatusLine>
        <strong>{planStatusTitle(fiveHour, providerId)}</strong>
        <span>{limitSourceText(fiveHour)}</span>
      </PlanStatusLine>
      <LimitMetricCard icon={ClockIcon} limit={fiveHour} title="5-Hour Session" />
      <LimitMetricCard icon={CalendarIcon} limit={weekly} title="Weekly Limit" />
    </ProviderLimitColumn>
  );
}

export default function AccountTokenomicsView({ accountKey = "", billingStatus = null, storageUsage = null } = {}) {
  const [{
    summary,
    status,
    error,
	    selectedProvider,
	    selectedScopeKey = "all",
	    selectedAccountKey,
	    selectedDeviceId,
    scanProgress,
  }, setTokenomicsState] = useState(() => tokenomicsStore.state);
  const [dailyWindowDays, setDailyWindowDays] = useState(TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS);
  const [usageRateWindowKind, setUsageRateWindowKind] = useState("5_hour");

  const refresh = useCallback(async ({ scan = false } = {}) => {
    await loadTokenomicsStore({ scan, force: true });
  }, []);

  const setSelectedProvider = useCallback((provider) => {
    updateTokenomicsStore({ selectedProvider: provider, selectedAccountKey: "all" });
  }, []);

  const setSelectedScopeKey = useCallback((nextScopeKey) => {
    updateTokenomicsStore({ selectedScopeKey: nextScopeKey || "all", selectedAccountKey: "all", selectedDeviceId: "all" });
  }, []);

  const setSelectedAccountKey = useCallback((nextAccountKey) => {
    updateTokenomicsStore({ selectedAccountKey: nextAccountKey || "all" });
  }, []);

  const setSelectedDeviceId = useCallback((nextDeviceId) => {
    updateTokenomicsStore({ selectedDeviceId: nextDeviceId || "all", selectedAccountKey: "all" });
  }, []);

  useEffect(() => {
    resetTokenomicsStoreForAccount(accountKey);
    void loadTokenomicsStore();
  }, [accountKey]);

  useEffect(() => {
    const unsubscribeStore = subscribeTokenomicsStore(setTokenomicsState);
    const stopPolling = startTokenomicsViewPolling();
    return () => {
      stopPolling();
      unsubscribeStore();
    };
  }, []);

  const providers = Array.isArray(summary?.by_device_provider) ? summary.by_device_provider : [];
  const deviceFiltered = selectedDeviceId !== "all";
  const modelRows = Array.isArray(summary?.by_device_model) ? summary.by_device_model : [];
  const providerRows = providers;
  const scopes = useMemo(() => scopeOptions(summary), [summary]);
  const devices = useMemo(() => deviceOptions(summary, selectedScopeKey), [summary, selectedScopeKey]);
  const accountOptions = useMemo(
    () => providerAccountOptions(summary, selectedProvider, selectedDeviceId, selectedScopeKey),
    [summary, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  useEffect(() => {
    if (
      selectedScopeKey !== "all"
      && !scopes.some((option) => option.key === selectedScopeKey)
    ) {
      updateTokenomicsStore({ selectedScopeKey: "all", selectedAccountKey: "all", selectedDeviceId: "all" });
    }
  }, [scopes, selectedScopeKey]);
  useEffect(() => {
    if (
      selectedDeviceId !== "all"
      && !devices.some((option) => option.key === selectedDeviceId)
    ) {
      updateTokenomicsStore({ selectedDeviceId: "all", selectedAccountKey: "all" });
    }
  }, [devices, selectedDeviceId]);
  useEffect(() => {
    if (selectedProvider === "all") {
      if (selectedAccountKey !== "all") {
        updateTokenomicsStore({ selectedAccountKey: "all" });
      }
      return;
    }
    if (
      selectedAccountKey !== "all"
      && !accountOptions.some((option) => option.key === selectedAccountKey)
    ) {
      updateTokenomicsStore({ selectedAccountKey: "all" });
    }
  }, [accountOptions, selectedAccountKey, selectedProvider]);
  const dailyRaw = Array.isArray(summary?.daily_by_device_provider) ? summary.daily_by_device_provider : [];
  const hourlyRaw = Array.isArray(summary?.hourly) ? summary.hourly : [];
  const limitSamplesRaw = Array.isArray(summary?.limit_samples)
    ? summary.limit_samples
    : (Array.isArray(summary?.limitSamples) ? summary.limitSamples : []);
  const dailyRows = useMemo(
    () => buildDailyRows(dailyRaw, limitSamplesRaw, summary?.limits, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey, dailyWindowDays),
    [dailyRaw, dailyWindowDays, limitSamplesRaw, selectedAccountKey, selectedDeviceId, selectedProvider, selectedScopeKey, summary?.limits],
  );
  const today = useMemo(
    () => todayAggregate(dailyRaw, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey),
    [dailyRaw, selectedAccountKey, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const last30Days = useMemo(
    () => rollingWindowAggregate(dailyRaw, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey),
    [dailyRaw, selectedAccountKey, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const deviceAccountRows = Array.isArray(summary?.by_device_account) ? summary.by_device_account : [];
  const totalRows = deviceFiltered
    ? (selectedAccountKey === "all" ? providerRows : deviceAccountRows)
    : selectedAccountKey === "all" ? providerRows : deviceAccountRows;
  const total = useMemo(
    () => aggregateRows(filterRows(totalRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey)),
    [selectedAccountKey, selectedDeviceId, selectedProvider, selectedScopeKey, totalRows],
  );
  const limits = useMemo(
    () => filterLimits(summary?.limits, selectedProvider, selectedAccountKey, selectedScopeKey),
    [selectedAccountKey, selectedProvider, selectedScopeKey, summary?.limits],
  );
  const fiveHour = useMemo(() => mergeLimits(limits, "5_hour"), [limits]);
  const weekly = useMemo(() => mergeLimits(limits, "weekly"), [limits]);
  const usageRateLimit = usageRateWindowKind === "weekly" ? weekly : fiveHour;
  const sessionUsageRows = useMemo(
    () => usageRateRowsFromLimit(usageRateLimit, hourlyRaw, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey),
    [hourlyRaw, selectedAccountKey, selectedDeviceId, selectedProvider, selectedScopeKey, usageRateLimit],
  );
  const sessionUsageBarWidth = usageRateBarWidth(sessionUsageRows.length);
  const sessionUsageLabels = usageRateAxisLabels(sessionUsageRows, usageRateWindowKind);
  const maxSessionUsage = Math.max(1, ...sessionUsageRows.map((row) => row.total));
  const activeSessionRows = sessionUsageRows.filter((row) => row.total > 0);
  const averageSessionUsage = activeSessionRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, activeSessionRows.length);
  const openAiCredits = useMemo(() => selectedProvider === "codex" ? codexCreditBalance(limits) : null, [limits, selectedProvider]);
  const maxDaily = Math.max(1, ...dailyRows.map((row) => dailyUsageValue(row)));
  const breakdown = useMemo(
    () => modelBreakdown(modelRows, selectedProvider, selectedAccountKey, selectedDeviceId, selectedScopeKey),
    [modelRows, selectedAccountKey, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const credits = billingStatus?.credits || summary?.credits || {};
  const providerLimitGroups = useMemo(() => (
    ["codex", "claude"].map((providerId) => {
      const providerLimits = filterLimits(summary?.limits, providerId, "all", selectedScopeKey);
      return {
        providerId,
        fiveHour: mergeLimits(providerLimits, "5_hour"),
        weekly: mergeLimits(providerLimits, "weekly"),
      };
    })
  ), [selectedScopeKey, summary?.limits]);
  const storage = useMemo(
    () => storageUsageModel(billingStatus, summary, storageUsage),
    [billingStatus, storageUsage, summary],
  );

  return (
    <TokenomicsShell>
      <TokenomicsPanel>
        <ProviderTabs role="tablist" aria-label="Tokenomics provider filter">
          {PROVIDERS.map((provider) => (
            <ProviderTab
              key={provider.id}
              $active={selectedProvider === provider.id}
              $provider={provider.id}
              onClick={() => setSelectedProvider(provider.id)}
              role="tab"
              type="button"
            >
              {provider.label}
            </ProviderTab>
          ))}
        </ProviderTabs>
        {scopes.length > 2 ? (
          <AccountTabs role="tablist" aria-label="Billing scope filter">
            {scopes.map((scope) => (
              <AccountTab
                key={scope.key}
                $active={selectedScopeKey === scope.key}
                $provider={selectedProvider}
                onClick={() => setSelectedScopeKey(scope.key)}
                role="tab"
                title={scope.label}
                type="button"
              >
                {scope.label}
              </AccountTab>
            ))}
          </AccountTabs>
        ) : null}
        {accountOptions.length > 0 ? (
          <AccountTabs role="tablist" aria-label="Provider account filter">
            {accountOptions.map((account) => (
              <AccountTab
                key={account.key}
                $active={selectedAccountKey === account.key}
                $provider={selectedProvider}
                onClick={() => setSelectedAccountKey(account.key)}
                role="tab"
                title={account.label}
                type="button"
              >
                {account.label}
              </AccountTab>
            ))}
          </AccountTabs>
        ) : null}
        {devices.length > 2 ? (
          <AccountTabs role="tablist" aria-label="Tokenomics device filter">
            {devices.map((device) => (
              <AccountTab
                key={device.key}
                $active={selectedDeviceId === device.key}
                $provider={selectedProvider}
                onClick={() => setSelectedDeviceId(device.key)}
                role="tab"
                title={device.label}
                type="button"
              >
                {device.label}
              </AccountTab>
            ))}
          </AccountTabs>
        ) : null}

        {error ? <TokenomicsError>{error}</TokenomicsError> : null}

        {status !== "ready" ? (
          <TokenomicsLoading role="status" aria-live="polite">
            <span />
            <strong>{tokenomicsLoadingLabel(status, summary, scanProgress)}</strong>
            {scanProgress ? <small>{tokenomicsLoadingDetail(scanProgress)}</small> : null}
          </TokenomicsLoading>
        ) : null}

        {selectedProvider === "all" ? (
          <ProviderLimitGrid>
            {providerLimitGroups.map((group) => (
              <ProviderLimitGroup
                key={group.providerId}
                fiveHour={group.fiveHour}
                providerId={group.providerId}
                weekly={group.weekly}
              />
            ))}
          </ProviderLimitGrid>
        ) : (
          <>
            <PlanStatusLine>
              <strong>{planStatusTitle(fiveHour, selectedProvider)}</strong>
              <span>{limitSourceText(fiveHour)}</span>
            </PlanStatusLine>
            {openAiCredits ? (
              <ProviderCreditsLine>
                <span>OpenAI credits</span>
                <strong>
                  {openAiCredits.unlimited ? "Unlimited" : formatCredits(openAiCredits.balance)}
                </strong>
              </ProviderCreditsLine>
            ) : null}
            <LimitMetricCard icon={ClockIcon} limit={fiveHour} title="5-Hour Session" />
            <LimitMetricCard icon={CalendarIcon} limit={weekly} title="Weekly Limit" />
          </>
        )}

        <ChartGrid>
          <ChartCard>
            <PanelTitle>
              <span>
                <RateIcon aria-hidden="true" />
                Usage Rate
              </span>
              <RangeToggle aria-label="Usage rate window" role="group">
                {TOKENOMICS_USAGE_RATE_WINDOWS.map((window) => (
                  <RangeToggleButton
                    key={window.key}
                    $active={usageRateWindowKind === window.key}
                    aria-pressed={usageRateWindowKind === window.key}
                    onClick={() => setUsageRateWindowKind(window.key)}
                    type="button"
                  >
                    {window.label}
                  </RangeToggleButton>
                ))}
              </RangeToggle>
            </PanelTitle>
            <RateGraph viewBox="0 0 360 104" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" y1="18" x2="360" y2="18" />
              <line x1="0" y1="52" x2="360" y2="52" />
              <line x1="0" y1="86" x2="360" y2="86" />
              {[90, 180, 270].map((x) => <line key={x} x1={x} y1="10" x2={x} y2="94" className="v" />)}
              {sessionUsageRows.map((row, index) => {
                const step = sessionUsageRows.length > 1 ? 340 / (sessionUsageRows.length - 1) : 0;
                const x = 10 + index * step;
                const height = Math.max(row.total > 0 ? 5 : 3, (row.total / maxSessionUsage) * 70);
                const y = 90 - height;
                const isHot = averageSessionUsage > 0 && row.total > averageSessionUsage * 1.35;
                return (
                  <rect
                    key={row.key}
                    x={x - (sessionUsageBarWidth / 2)}
                    y={y}
                    width={sessionUsageBarWidth}
                    height={height}
                    rx={sessionUsageBarWidth > 3 ? "2" : "1"}
                    className={isHot ? "hot" : "cool"}
                  />
                );
              })}
              <path d={usageRatePath(sessionUsageRows, 360, 96)} />
            </RateGraph>
            <SessionRateLabels>
              {sessionUsageLabels.map((row) => (
                <span key={row.key}>{row.label}</span>
              ))}
            </SessionRateLabels>
          </ChartCard>

          <ChartCard>
            <PanelTitle>
              <span>
                <BarsIcon aria-hidden="true" />
                Daily Usage
              </span>
              <RangeToggle aria-label="Daily usage range" role="group">
                {TOKENOMICS_DAILY_RANGE_OPTIONS.map((days) => (
                  <RangeToggleButton
                    key={days}
                    $active={dailyWindowDays === days}
                    aria-pressed={dailyWindowDays === days}
                    onClick={() => setDailyWindowDays(days)}
                    type="button"
                  >
                    {days}d
                  </RangeToggleButton>
                ))}
              </RangeToggle>
            </PanelTitle>
            <DailyChart $days={dailyRows.length}>
              {dailyRows.map((row) => (
                <DailyColumn key={row.key}>
                  <DailyBar
                    $tone={dailyLimitTone(row)}
                    style={{ height: `${dailyBarHeight(dailyUsageValue(row), maxDaily)}%` }}
                    title={dailyLimitTitle({ ...row, label: row.titleLabel || row.label })}
                  />
                  <small>{row.label}</small>
                </DailyColumn>
              ))}
            </DailyChart>
          </ChartCard>
        </ChartGrid>

        <UsageCard>
          <PanelTitle>
            <span>
              <HashIcon aria-hidden="true" />
              Token Usage
            </span>
          </PanelTitle>
          <UsageTable>
            <thead>
              <tr>
                <th />
                <th>Input</th>
                <th>Output</th>
                <th>Cache</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Today</td>
                <TokenCell value={today.input} />
                <TokenCell value={today.output} />
                <TokenCell value={today.cache} />
                <CostCell value={today.cost} />
              </tr>
              <tr>
                <td title="Last 30 Days">Last 30 Days</td>
                <TokenCell value={last30Days.input} />
                <TokenCell value={last30Days.output} />
                <TokenCell value={last30Days.cache} />
                <CostCell value={last30Days.cost} />
              </tr>
            </tbody>
          </UsageTable>
          <ModelList>
            {breakdown.length ? breakdown.map((item) => (
              <ModelRow key={item.label}>
                <span>{item.label}</span>
                <strong>{item.percent}%</strong>
              </ModelRow>
            )) : (
              <TokenomicsEmpty>Rescan after using Codex or Claude Code to populate usage.</TokenomicsEmpty>
            )}
          </ModelList>
        </UsageCard>

        <CreditsCard>
          <CreditsTitle>
            <span>Diff Forge Credits</span>
            <strong>{credits?.planName || credits?.term?.plan_name || "Plan"}</strong>
          </CreditsTitle>
          <CreditsGrid>
            <CreditMetric>
              <span>Used</span>
              <strong>{formatCredits(credits.termUsedCredits ?? credits.used_credits ?? credits.total?.used_credits ?? credits.localMeteredUsedCredits ?? credits.local_metered_used_credits)}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Remaining</span>
              <strong>{formatCredits(credits.termRemainingCredits ?? credits.remaining_credits ?? credits.total?.remaining_credits)}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Reserved</span>
              <strong>{formatCredits(credits.termReservedCredits ?? credits.reserved_credits ?? credits.total?.reserved_credits)}</strong>
            </CreditMetric>
          </CreditsGrid>
        </CreditsCard>

        <StorageCard>
          <StorageTitle>
            <span>Storage</span>
            <strong>{storage.known ? "Live" : "Waiting"}</strong>
          </StorageTitle>
          <StorageRows>
            {storage.rows.map((row) => (
              <StorageRow key={row.key}>
                <StorageRowTop>
                  <span>{row.label}</span>
                  <strong>{formatStorageBytes(row.used)} / {formatStorageBytes(row.limit)}</strong>
                </StorageRowTop>
                <StorageTrack aria-label={`${row.label} storage used`}>
                  <StorageFill style={{ width: `${row.percent}%` }} />
                </StorageTrack>
              </StorageRow>
            ))}
          </StorageRows>
        </StorageCard>

        <AgentAccountsManager />

        <TokenomicsFooter>
          <span>{lastUpdatedText(summary?.updated_at || summary?.updatedAt)}</span>
          <FooterButton disabled={status === "scanning"} onClick={() => refresh({ scan: true })} type="button">
            {status === "scanning" ? "Scanning" : "Rescan"}
          </FooterButton>
        </TokenomicsFooter>
      </TokenomicsPanel>
    </TokenomicsShell>
  );
}

function ClockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function CalendarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="5" y="6" width="14" height="13" rx="2" />
      <path d="M8 4v4M16 4v4M5 10h14M9 14h.01M12 14h.01M15 14h.01" />
    </svg>
  );
}

function RateIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M4 19V5M4 16l5-5 4 3 6-8M8 19h12" />
    </svg>
  );
}

function BarsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect x="4" y="11" width="4" height="8" rx="1" />
      <rect x="10" y="7" width="4" height="12" rx="1" />
      <rect x="16" y="4" width="4" height="15" rx="1" />
    </svg>
  );
}

function HashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />
    </svg>
  );
}

const TokenomicsShell = styled.section`
  display: grid;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  overflow-x: hidden;
  padding: clamp(6px, 1.8vw, 12px);
  color: #e5eefb;
  background:
    radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.13), transparent 34%),
    radial-gradient(circle at 100% 12%, rgba(251, 146, 60, 0.08), transparent 28%),
    linear-gradient(180deg, #05070a, #020304 68%, #05070a);

  &,
  * {
    box-sizing: border-box;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
    background:
      radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.1), transparent 34%),
      radial-gradient(circle at 100% 12%, rgba(249, 115, 22, 0.08), transparent 28%),
      linear-gradient(180deg, #f8fafc, #eef4ff);
  }
`;

const TokenomicsPanel = styled.div`
  position: relative;
  display: grid;
  gap: 9px;
  align-self: start;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;

  html[data-forge-theme="light"] & {
    background: transparent;
    box-shadow: none;
  }
`;

const ProviderTabs = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 12, 0.82);

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #eef4ff;
  }
`;

const ProviderTab = styled.button`
  min-width: 0;
  min-height: 30px;
  border: 1px solid ${({ $active, $provider }) => ($active ? providerAccent($provider) : "transparent")};
  border-radius: 7px;
  color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#9aa8bc")};
  background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 18%, transparent)` : "transparent")};
  font: inherit;
  font-size: clamp(10px, 2.4vw, 12px);
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#475569")};
    background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 12%, #ffffff)` : "transparent")};
  }
`;

const AccountTabs = styled.div`
  display: flex;
  gap: 5px;
  min-width: 0;
  overflow-x: auto;
  padding: 2px 1px 4px;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const AccountTab = styled.button`
  flex: 0 0 auto;
  max-width: 210px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid ${({ $active, $provider }) => ($active ? providerAccent($provider) : "rgba(148, 163, 184, 0.16)")};
  border-radius: 7px;
  color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#94a3b8")};
  background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 14%, rgba(15, 23, 42, 0.74))` : "rgba(15, 23, 42, 0.48)")};
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#475569")};
    background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 10%, #ffffff)` : "#f8fafc")};
  }
`;

const TokenomicsError = styled.div`
  padding: 8px 10px;
  border: 1px solid rgba(255, 79, 91, 0.34);
  border-radius: 8px;
  color: #ff7f89;
  background: rgba(255, 79, 91, 0.1);
  font-size: 12px;
  font-weight: 800;
`;

const TokenomicsLoading = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(96, 165, 250, 0.2);
  border-radius: 8px;
  color: #9fb2cc;
  background: rgba(96, 165, 250, 0.08);
  font-size: 11px;
  font-weight: 900;

  span {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    border: 2px solid rgba(96, 165, 250, 0.18);
    border-top-color: #60a5fa;
    border-radius: 999px;
    animation: tokenomics-spin 0.8s linear infinite;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    min-width: 0;
    color: #7f8da3;
    font-size: 10px;
    font-weight: 800;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes tokenomics-spin {
    to {
      transform: rotate(360deg);
    }
  }

  html[data-forge-theme="light"] & {
    color: #475569;
    border-color: rgba(37, 99, 235, 0.16);
    background: rgba(37, 99, 235, 0.07);
  }
`;

const ProviderLimitGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 10px;
  min-width: 0;
`;

const ProviderLimitColumn = styled.div`
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
`;

const ProviderLimitHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 0 2px 1px;
  color: ${({ $provider }) => providerAccent($provider)};
  font-size: 12px;
  font-weight: 950;

  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const PlanStatusLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 0 2px;
  color: #8fa0b6;
  font-size: clamp(9px, 2.2vw, 11px);
  font-weight: 900;

  strong {
    min-width: 0;
    overflow: hidden;
    color: #e5eefb;
    text-overflow: ellipsis;
    white-space: normal;
  }

  span {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: normal;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;

    strong {
      color: #0f172a;
    }
  }
`;

const ProviderCreditsLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid rgba(251, 146, 60, 0.2);
  border-radius: 8px;
  color: #aab6c8;
  background: rgba(251, 146, 60, 0.07);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  span,
  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #fb923c;
    text-align: right;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(249, 115, 22, 0.2);
    color: #64748b;
    background: rgba(249, 115, 22, 0.08);
  }
`;

const LimitCard = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.72);
  container-type: inline-size;

  --tone: ${({ tone }) => toneColor(tone)};

  @container (max-width: 450px) {
    gap: 6px;
    padding: 8px;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #f8fafc;
  }
`;

const MetricHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;

  @container (max-width: 450px) {
    gap: 6px;
  }
`;

const MetricName = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: #e5eefb;
  font-size: clamp(12px, 3.1vw, 14px);
  font-weight: 900;

  @container (max-width: 450px) {
    gap: 6px;
    font-size: 12px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
  }

  @container (max-width: 450px) {
    svg {
      width: 13px;
      height: 13px;
    }
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const MetricScore = styled.div`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  color: var(--tone);
  font-size: clamp(10px, 2.4vw, 12px);
  font-weight: 900;
  white-space: nowrap;

  strong {
    font-size: clamp(12px, 3vw, 15px);
  }

  @container (max-width: 450px) {
    gap: 4px;
    font-size: 10px;

    strong {
      font-size: 13px;
    }
  }
`;

const ProgressTrack = styled.div`
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.12);
  }

  @container (max-width: 450px) {
    height: 6px;
  }
`;

const ProgressFill = styled.div`
  height: 100%;
  min-width: 7px;
  border-radius: inherit;
  --bar-tone: ${({ $tone }) => toneColor($tone)};
  background: var(--bar-tone);
  box-shadow: 0 0 18px color-mix(in srgb, var(--bar-tone) 72%, transparent);
`;

const MetricFoot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: #8794a8;
  font-size: clamp(9px, 2.5vw, 11px);
  font-weight: 900;

  @container (max-width: 450px) {
    gap: 6px;
    font-size: 9px;
    line-height: 1.15;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--tone);
    font-weight: 900;
    text-align: right;
    text-overflow: ellipsis;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const ChartCard = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.72);
  overflow: hidden;

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.08);
    background: #f8fafc;
  }
`;

const ChartGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
  gap: 9px;
  min-width: 0;
  align-items: stretch;
`;

const PanelTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(12px, 3.1vw, 14px);
  font-weight: 900;

  > span {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  small {
    color: #738196;
    font-size: 10px;
    font-weight: 900;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    fill: none;
    stroke: #60a5fa;
    stroke-width: 2;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;

    small {
      color: #64748b;
    }
  }
`;

const RateGraph = styled.svg`
  display: block;
  width: 100%;
  height: 90px;
  overflow: visible;

  line {
    stroke: rgba(153, 173, 197, 0.15);
    stroke-width: 1;
  }

  line.v {
    stroke: rgba(153, 173, 197, 0.1);
  }

  rect.cool {
    fill: rgba(96, 165, 250, 0.36);
  }

  rect.hot {
    fill: rgba(251, 146, 60, 0.48);
  }

  path {
    fill: none;
    stroke: #fb923c;
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
`;

const SessionRateLabels = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
  margin-top: -3px;

  span {
    color: #8593a8;
    font-size: 9px;
    font-weight: 900;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const RangeToggle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);

  html[data-forge-theme="light"] & {
    border-color: rgba(37, 99, 235, 0.16);
    background: rgba(241, 245, 249, 0.82);
  }
`;

const RangeToggleButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  min-height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  color: ${({ $active }) => ($active ? "#bfdbfe" : "#738196")};
  background: ${({ $active }) => ($active ? "rgba(96, 165, 250, 0.20)" : "transparent")};
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  cursor: pointer;

  &:hover {
    color: #e5eefb;
  }

  html[data-forge-theme="light"] & {
    color: ${({ $active }) => ($active ? "#1d4ed8" : "#64748b")};
    background: ${({ $active }) => ($active ? "rgba(37, 99, 235, 0.12)" : "transparent")};

    &:hover {
      color: #0f172a;
    }
  }
`;

const DailyChart = styled.div`
  display: grid;
  grid-template-columns: repeat(${({ $days }) => $days || TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS}, minmax(0, 1fr));
  align-items: end;
  gap: ${({ $days }) => (($days || 0) > 7 ? "4px" : "7px")};
  min-height: 96px;
`;

const DailyColumn = styled.div`
  display: grid;
  grid-template-rows: 68px auto;
  align-items: end;
  gap: 7px;
  min-width: 0;

  small {
    overflow: hidden;
    color: #7f8ea3;
    font-size: 9px;
    font-weight: 900;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const DailyBar = styled.div`
  align-self: end;
  min-height: 8px;
  border-radius: 5px 5px 2px 2px;
  background: ${({ $tone }) => {
    if ($tone === "danger") return "#ff5a5f";
    if ($tone === "warn") return "#facc15";
    if ($tone === "quiet") return "rgba(114, 130, 150, 0.25)";
    return "#60a5fa";
  }};
  box-shadow: ${({ $tone }) => ($tone && $tone !== "quiet" ? "0 0 18px rgba(96, 165, 250, 0.16)" : "none")};
`;

const UsageCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(96, 165, 250, 0.17);
  border-radius: 8px;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.12), transparent 36%),
    rgba(15, 23, 42, 0.76);

  html[data-forge-theme="light"] & {
    border-color: rgba(37, 99, 235, 0.15);
    background:
      radial-gradient(circle at 0% 0%, rgba(37, 99, 235, 0.08), transparent 36%),
      #f8fafc;
  }
`;

const UsageTable = styled.table`
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;

  th,
  td {
    overflow: hidden;
    padding: 4px 2px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    width: 32%;
    color: #7f9ac1;
    text-align: left;
  }

  th:last-child,
  td:last-child {
    width: 21%;
  }

  th {
    color: #7f9ac1;
    font-size: 9px;
    font-weight: 800;
  }

  td {
    color: #e5eefb;
    font-size: 10px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  td:first-child {
    font-weight: 800;
  }

  html[data-forge-theme="light"] & {
    th:first-child,
    td:first-child,
    th {
      color: #64748b;
    }

    td {
      color: #0f172a;
    }
  }
`;

const ModelList = styled.div`
  display: grid;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px solid rgba(150, 184, 222, 0.16);
`;

const ModelRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #dfe9f8;
  font-size: clamp(10px, 2.6vw, 12px);
  font-weight: 800;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #a8c3ee;
    font-weight: 800;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;

    strong {
      color: #2563eb;
    }
  }
`;

const CreditsCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(251, 146, 60, 0.18);
  border-radius: 8px;
  background:
    radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.1), transparent 34%),
    rgba(15, 23, 42, 0.72);

  html[data-forge-theme="light"] & {
    border-color: rgba(249, 115, 22, 0.18);
    background:
      radial-gradient(circle at 100% 0%, rgba(249, 115, 22, 0.08), transparent 34%),
      #f8fafc;
  }
`;

const CreditsTitle = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(11px, 2.8vw, 13px);
  font-weight: 900;

  strong {
    color: #fb923c;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const CreditsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`;

const CreditMetric = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 12, 0.22);

  span {
    overflow: hidden;
    color: #8794a8;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  strong {
    overflow: hidden;
    color: #e5eefb;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.1);
    background: #ffffff;

    span {
      color: #64748b;
    }

    strong {
      color: #0f172a;
    }
  }
`;

const StorageCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(96, 165, 250, 0.17);
  border-radius: 8px;
  background:
    radial-gradient(circle at 100% 0%, rgba(52, 211, 153, 0.08), transparent 34%),
    rgba(15, 23, 42, 0.72);

  html[data-forge-theme="light"] & {
    border-color: rgba(37, 99, 235, 0.14);
    background:
      radial-gradient(circle at 100% 0%, rgba(52, 211, 153, 0.08), transparent 34%),
      #f8fafc;
  }
`;

const StorageTitle = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #e5eefb;
  font-size: clamp(11px, 2.8vw, 13px);
  font-weight: 900;

  strong {
    color: #60a5fa;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const StorageRows = styled.div`
  display: grid;
  gap: 8px;
`;

const StorageRow = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

const StorageRowTop = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #8794a8;
  font-size: 10px;
  font-weight: 900;

  strong {
    color: #e5eefb;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;

    strong {
      color: #0f172a;
    }
  }
`;

const StorageTrack = styled.div`
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.2);

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.1);
  }
`;

const StorageFill = styled.div`
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #60a5fa, #34d399);
  box-shadow: 0 0 16px rgba(96, 165, 250, 0.28);
`;

const TokenomicsFooter = styled.footer`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 0 2px;
  color: rgba(165, 183, 210, 0.52);
  font-size: 10px;
  font-weight: 900;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const FooterButton = styled.button`
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 999px;
  color: #60a5fa;
  background: rgba(37, 99, 235, 0.12);
  font: inherit;
  font-size: 10px;
  font-weight: 900;

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const TokenomicsEmpty = styled.div`
  color: #9db1c9;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.5;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;
