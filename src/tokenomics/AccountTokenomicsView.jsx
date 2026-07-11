import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { FilterListOff } from "@styled-icons/material-rounded/FilterListOff";
import {
  billingStatusPlanName,
  dailyUsageTitle,
  dailyUsageValue,
  formatCredits,
  formatCost,
  formatCostTitle,
  formatPaceMultiplier,
  formatTokenTitle,
  formatTokens,
  numeric,
  paceMultiplierFromDelta,
  resolveAccountDisplayedCreditWalletState,
  rowActivityTokens,
  rowCache,
  rowCost,
  rowInput,
  rowOutput,
  rowProviderAccountKey,
  rowProviderAccountLabel,
  rowTotal,
} from "./tokenomicsFormat.js";
import {
  mergeProviderLimitRowsForDisplay,
  mergeProviderLimits,
  mergeProviderLimitSamples,
  projectProviderLimitForDisplay,
  providerLimitKey,
  providerLimitSampleKey,
} from "./tokenomicsProviderLimitMerge.js";
import {
  prioritizedTokenomicsIdentityKeyClaims,
  registerTokenomicsIdentityAlias,
  tokenomicsAccountsFromDistinctKeys,
  uniqueTokenomicsAliasesByOwner,
} from "./tokenomicsAccountIdentity.js";

const TOKENOMICS_SCAN_PROGRESS_EVENT = "diffforge://tokenomics-scan-progress";
const TOKENOMICS_UPDATED_EVENT = "diffforge://tokenomics-updated";
const TOKENOMICS_VIEW_POLL_INTERVAL_MS = 60_000;
const TOKENOMICS_HOT_TAIL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TOKENOMICS_LIVE_LIMIT_REFRESH_INTERVAL_MS = 60_000;
const TOKENOMICS_SUMMARY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS = 250;
const TOKENOMICS_LIMIT_CLOUD_SYNC_REASON = "tokenomics_limits_changed";
const TOKENOMICS_DAILY_WINDOW_DAYS = 30;
const TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS = TOKENOMICS_DAILY_WINDOW_DAYS;
const TOKENOMICS_DAILY_RANGE_OPTIONS = [7, TOKENOMICS_DAILY_WINDOW_DAYS];
const TOKENOMICS_DAILY_WARN_LIMIT_PERCENT = 13;
const TOKENOMICS_DAILY_DANGER_LIMIT_PERCENT = 20;
const TOKENOMICS_USAGE_RATE_WINDOWS = [
  { key: "5_hour", label: "5h" },
  { key: "weekly", label: "Weekly" },
];

const PROVIDERS = [
  { id: "all", label: "All", match: () => true },
  { id: "codex", label: "Codex", match: (row) => providerKey(row) === "codex" },
  { id: "claude", label: "Claude", match: (row) => providerKey(row) === "claude" },
  { id: "opencode", label: "OpenCode", match: (row) => providerKey(row) === "opencode" },
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
  opencode: "#34d399",
};

const PROVIDER_ACCOUNT_FILTER_PROVIDERS = ["codex", "claude", "opencode"];
const TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE = "__none__";

const AGENT_ACCOUNTS_CHANGED_EVENT = "agent-accounts-changed";

function scheduleTokenomicsIdleTask(callback, { delay_ms: delayMs = 0, timeout = 1200 } = {}) {
  if (typeof window === "undefined") {
    callback();
    return () => {};
  }

  let cancelled = false;
  let frame = 0;
  let idle = 0;
  let timer = 0;

  const run = () => {
    if (!cancelled) {
      callback();
    }
  };

  const scheduleIdle = () => {
    if (cancelled) {
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout });
      return;
    }
    timer = window.setTimeout(run, delayMs);
  };

  if (typeof window.requestAnimationFrame === "function") {
    frame = window.requestAnimationFrame(scheduleIdle);
  } else {
    timer = window.setTimeout(scheduleIdle, delayMs);
  }

  return () => {
    cancelled = true;
    if (frame && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frame);
    }
    if (idle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idle);
    }
    if (timer) {
      window.clearTimeout(timer);
    }
  };
}

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
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
`;

const AgentAccountsKindRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const AgentAccountsKindLabel = styled.span`
  color: rgba(148, 163, 184, 0.85);
  font-size: 11.5px;
  font-weight: 750;
`;

const AgentAccountsPillsRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
`;

const AgentAccountAddButton = styled.button`
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 999px;
  color: rgba(148, 163, 184, 0.9);
  background: transparent;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;

  &:hover {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.6);
    color: rgba(226, 232, 240, 0.95);
    background: rgba(var(--forge-tint-rgb), 0.18);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.45);
    color: rgba(30, 41, 59, 0.75);
  }
`;

const AgentAccountLoginHint = styled.div`
  color: rgba(148, 163, 184, 0.8);
  font-size: 11px;
  line-height: 1.45;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
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
    border-color: rgba(var(--forge-tint-soft-rgb), 0.5);
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
    background: rgba(var(--forge-tint-rgb), 0.25);
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
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.3);
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
   data that motivates the switch. The per-kind "+" only opens the CLI's login
   in a terminal — signing into another account in any terminal is captured
   automatically by the Rust watcher. Switching only affects NEW terminal
   spawns; running panes show a restart chip instead (never forced). */
function useAgentAccountsState(active = true) {
  const [accounts, setAccounts] = useState(null);
  const refresh = useCallback(() => {
    invoke("agent_accounts_state").then((state) => {
      setAccounts(state?.agents || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    let unlisten = null;
    refresh();
    const interval = window.setInterval(refresh, 6000);
    listen(AGENT_ACCOUNTS_CHANGED_EVENT, () => {
      if (!cancelled) refresh();
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
      if (unlisten) unlisten();
    };
  }, [active, refresh]);

  return { accounts, refresh };
}

function tokenomicsAgentCredentialProfileSignature(profile = {}) {
  const identity = profile?.identity || {};
  const authStatus = profile?.auth_status || {};
  return [
    String(profile?.id || "").trim(),
    profile?.is_active ? "active" : "inactive",
    normalizeTokenomicsEmail(identity?.email || profile?.email),
    identity?.auth_ready ? "auth-ready" : "auth-missing",
    authStatus?.needs_login ? "needs-login" : "login-ok",
    String(authStatus?.reason || "").trim(),
  ].join("~");
}

function tokenomicsAgentCredentialSignature(agentAccounts) {
  if (!agentAccounts || typeof agentAccounts !== "object") return "";
  return PROVIDER_ACCOUNT_FILTER_PROVIDERS.map((providerId) => {
    const entry = agentAccounts?.[providerId] || {};
    const profiles = Array.isArray(entry?.profiles) ? entry.profiles : [];
    const profileParts = profiles
      .map((profile) => tokenomicsAgentCredentialProfileSignature(profile))
      .sort();
    return [
      providerId,
      String(entry?.active_profile_id || "").trim(),
      profileParts.join("|"),
    ].join(":");
  }).join("||");
}

function collapseAgentProfilesByEmail(profiles = []) {
  const byEmail = new Map();
  const visible = [];
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const email = normalizeTokenomicsEmail(profile?.identity?.email || profile?.email);
    if (!email) {
      visible.push(profile);
      continue;
    }
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, profile);
      visible.push(profile);
      continue;
    }
    if (
      profile?.is_active
      && !existing.is_default
      && !existing.is_active
    ) {
      const index = visible.indexOf(existing);
      const merged = { ...profile, alias: profile.alias || existing.alias };
      if (index >= 0) visible[index] = merged;
      byEmail.set(email, merged);
    } else if (profile?.is_active && existing.is_default && !existing.is_active) {
      const index = visible.indexOf(existing);
      const merged = { ...existing, is_active: true, alias: existing.alias || profile.alias };
      if (index >= 0) visible[index] = merged;
      byEmail.set(email, merged);
    }
  }
  return visible;
}

function AgentAccountsManager({ active = true }) {
  const [accounts, setAccounts] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState("");
  const [actionError, setActionError] = useState("");
  const [loginPendingKind, setLoginPendingKind] = useState("");
  const confirmDeleteTimerRef = useRef(null);
  const loginPendingTimerRef = useRef(null);

  const refresh = useCallback(() => {
    invoke("agent_accounts_state").then((state) => {
      setAccounts(state?.agents || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    let unlisten = null;
    refresh();
    // Logins inside profile dirs change identity dots without any event, so
    // a slow poll backs up the capture-watcher events.
    const interval = window.setInterval(refresh, 6000);
    listen(AGENT_ACCOUNTS_CHANGED_EVENT, (event) => {
      if (!cancelled) {
        if (event?.payload?.captured) {
          setLoginPendingKind("");
        }
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
      if (loginPendingTimerRef.current) {
        window.clearTimeout(loginPendingTimerRef.current);
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, [active, refresh]);

  const setActive = useCallback((kind, profileId) => {
    setActionError("");
    invoke("agent_accounts_set_active", { agent_kind: kind, profile_id: profileId })
      .then(refresh)
      .catch((error) => setActionError(String(error?.message || error || "Unable to switch account.")));
  }, [refresh]);

  const beginLogin = useCallback((kind) => {
    setActionError("");
    invoke("start_agent_account_login", { provider: kind }).then(() => {
      setLoginPendingKind(kind);
      if (loginPendingTimerRef.current) {
        window.clearTimeout(loginPendingTimerRef.current);
      }
      // The hint is only a pointer at the terminal that just opened; the
      // capture watcher clears it sooner once the new login is pinned.
      loginPendingTimerRef.current = window.setTimeout(() => setLoginPendingKind(""), 30000);
    }).catch((error) => setActionError(String(error?.message || error || "Unable to open the login terminal.")));
  }, []);

  const beginProfileLogin = useCallback((kind, profileId) => {
    setActionError("");
    invoke("agent_accounts_start_profile_login", { agent_kind: kind, profile_id: profileId }).then(() => {
      setLoginPendingKind(kind);
      if (loginPendingTimerRef.current) {
        window.clearTimeout(loginPendingTimerRef.current);
      }
      loginPendingTimerRef.current = window.setTimeout(() => setLoginPendingKind(""), 30000);
      refresh();
    }).catch((error) => setActionError(String(error?.message || error || "Unable to open the account login terminal.")));
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
    invoke("agent_accounts_remove", { agent_kind: kind, profile_id: profileId })
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
      agent_kind: editing.kind,
      profile_id: editing.profile_id,
      alias: editing.alias,
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
      {["claude", "codex", "opencode"].map((kind) => {
        const entry = accounts[kind];
        if (!entry) {
          return null;
        }
        const kindLabel = PROVIDER_LABELS[kind] || kind;
        const profiles = collapseAgentProfilesByEmail(entry.profiles);
        return (
          <Fragment key={kind}>
            <AgentAccountsRow>
              <AgentAccountsKindRow>
                <AgentAccountsKindLabel>
                  {kindLabel}
                </AgentAccountsKindLabel>
                <AgentAccountAddButton
                  aria-label={`Add ${kindLabel} account`}
                  onClick={() => beginLogin(kind)}
                  title={`Open the ${kindLabel} login in a terminal to add another account`}
                  type="button"
                >
                  +
                </AgentAccountAddButton>
              </AgentAccountsKindRow>
              <AgentAccountsPillsRow>
                {profiles.map((profile) => {
                  const email = profile.identity?.email || "";
                  const alias = String(profile.alias || "").trim();
                  // The alias HIDES the email (streaming privacy): captured
                  // pills show the alias as their name, the default pill keeps
                  // "Default" and shows the alias where the email was.
                  const name = profile.is_default
                    ? (profile.label || "Default")
                    : (alias || profile.label || "Account");
                  const detail = profile.is_default ? (alias || email) : (alias ? "" : email);
                  const authStatus = profile.auth_status || {};
                  const needsLogin = Boolean(authStatus.needs_login || (!profile.identity?.auth_ready && !profile.is_default));
                  const canEdit = Boolean(email);
                  const canDelete = !profile.is_default && !profile.is_active;
                  const deleteArmed = confirmDeleteKey === `${kind}:${profile.id}`;
                  return (
                    <AgentAccountPill
                      data-active={profile.is_active && !needsLogin ? "true" : "false"}
                      key={profile.id}
                      onClick={() => {
                        if (needsLogin) {
                          beginProfileLogin(kind, profile.id);
                          return;
                        }
                        if (!profile.is_active) {
                          setActive(kind, profile.id);
                        }
                      }}
                      title={needsLogin
                        ? (authStatus.message || "Sign in again for this account")
                        : profile.is_active
                        ? `Active: new ${kind} terminals use this account`
                        : `Use this account for new ${kind} terminals`}
                      type="button"
                    >
                      <i
                        aria-hidden="true"
                        data-state={needsLogin ? "needs-login" : profile.is_active ? "active" : "none"}
                      />
                      <span>{name}</span>
                      {detail ? <em>{detail}</em> : null}
                      {needsLogin ? <em>needs login</em> : null}
                      {needsLogin && (
                        <AgentAccountIconButton
                          aria-label={`Sign in again for ${name}`}
                          as="span"
                          onClick={(event) => {
                            event.stopPropagation();
                            beginProfileLogin(kind, profile.id);
                          }}
                          role="button"
                          title={authStatus.message || "Sign in again for this account"}
                        >
                          ↻
                        </AgentAccountIconButton>
                      )}
                      {canEdit && (
                        <AgentAccountIconButton
                          aria-label={`Edit ${name}`}
                          as="span"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditing({
                              kind,
                              profile_id: profile.id,
                              name,
                              alias,
                            });
                          }}
                          role="button"
                          title="Set an alias to show instead of the email"
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
              </AgentAccountsPillsRow>
            </AgentAccountsRow>
            {editing?.kind === kind ? (
              <AgentAccountEditorForm onSubmit={submitEdit}>
                <input
                  aria-label="Account alias (shown instead of the email)"
                  autoFocus
                  maxLength={40}
                  onChange={(event) => setEditing((current) => (
                    current ? { ...current, alias: event.target.value } : current
                  ))}
                  placeholder={`Alias for ${editing.name} — hides the email`}
                  type="text"
                  value={editing.alias}
                />
                <button type="submit">Save</button>
                <button onClick={() => setEditing(null)} type="button">Cancel</button>
              </AgentAccountEditorForm>
            ) : null}
          </Fragment>
        );
      })}
      {loginPendingKind ? (
        <AgentAccountLoginHint role="status">
          {`Finish signing in inside the ${PROVIDER_LABELS[loginPendingKind] || "agent"} terminal that just opened — the account appears here automatically.`}
        </AgentAccountLoginHint>
      ) : null}
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
    selectedProviderAccountKeys: createDefaultProviderAccountKeys(),
    selectedDeviceId: "all",
    scanProgress: null,
  };
}

function createDefaultProviderAccountKeys() {
  return PROVIDER_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
    acc[providerId] = "all";
    return acc;
  }, {});
}

function normalizeProviderAccountKey(value) {
  return String(value || "all").trim() || "all";
}

function providerAccountKeyIsUnknown(value) {
  const key = String(value || "").trim().toLowerCase();
  return !key || key.endsWith(":unknown");
}

function normalizeProviderAccountLabel(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeTokenomicsEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function tokenomicsEmailLocalPart(value) {
  return normalizeTokenomicsEmail(value).split("@")[0] || "";
}

function tokenomicsProviderProfileAccountKey(providerId, profileId) {
  const cleanProfileId = String(profileId || "").trim();
  if (!cleanProfileId || cleanProfileId === "default") return "";
  if (providerId === "claude") return `anthropic:claude:profile:${cleanProfileId}`;
  if (providerId === "codex") return `openai:codex:profile:${cleanProfileId}`;
  if (providerId === "opencode") return `opencode:opencode:profile:${cleanProfileId}`;
  return "";
}

function tokenomicsProfileIdFromAccountKey(providerId, accountKey) {
  const clean = String(accountKey || "").trim();
  const prefix = tokenomicsProviderProfileAccountKey(providerId, "__profile__").replace("__profile__", "");
  return prefix && clean.startsWith(prefix) ? clean.slice(prefix.length).trim() : "";
}

function normalizeTokenomicsAliasLabel(value, providerId = "") {
  let label = normalizeProviderAccountLabel(value)
    .replace(/[·•]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const providerWords = providerId === "claude"
    ? ["claude code", "claude", "anthropic"]
    : providerId === "codex"
      ? ["codex", "openai"]
      : [];
  for (const word of providerWords) {
    if (label === word) return "";
    if (label.startsWith(`${word} `)) {
      label = label.slice(word.length).trim();
      break;
    }
  }
  return label;
}

function tokenomicsProfileLabelCandidates(profile = {}, providerId = "") {
  const email = normalizeTokenomicsEmail(profile?.email || profile?.identity?.email);
  const local = tokenomicsEmailLocalPart(email);
  const raw = [
    profile?.alias,
    profile?.label,
    profile?.name,
    email,
    local,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const labels = new Set();
  for (const value of raw) {
    labels.add(normalizeProviderAccountLabel(value));
    labels.add(normalizeTokenomicsAliasLabel(value, providerId));
    if (providerId === "claude") {
      labels.add(normalizeTokenomicsAliasLabel(`Claude ${value}`, providerId));
      labels.add(normalizeTokenomicsAliasLabel(`Claude Code ${value}`, providerId));
    } else if (providerId === "codex") {
      labels.add(normalizeTokenomicsAliasLabel(`Codex ${value}`, providerId));
    }
  }
  labels.delete("");
  labels.delete("default");
  return [...labels];
}

function tokenomicsRowAgentProfileId(row = {}) {
  return String(row?.agent_profile_id || "").trim();
}

function tokenomicsAccountLabelScore(label, providerId = "") {
  const raw = String(label || "").trim();
  const clean = normalizeTokenomicsAliasLabel(label, providerId);
  if (!clean || clean === "default" || clean === "account") return 0;
  if (clean.includes("@")) return 1;
  if (/[A-Z]/u.test(raw) && /[a-z]/u.test(raw)) return 5;
  if (/[\s-]/u.test(clean) && /[a-z]/iu.test(clean) && !/\d/u.test(clean)) return 4;
  if (/^[a-z0-9._-]+$/iu.test(clean)) return 2;
  return 4;
}

function preferredTokenomicsAccountLabel(nextLabel, currentLabel, providerId = "") {
  const next = String(nextLabel || "").trim();
  const current = String(currentLabel || "").trim();
  if (!current) return next;
  if (!next) return current;
  const nextScore = tokenomicsAccountLabelScore(next, providerId);
  const currentScore = tokenomicsAccountLabelScore(current, providerId);
  if (nextScore !== currentScore) return nextScore > currentScore ? next : current;
  return next.length < current.length ? next : current;
}

function normalizeProviderAccountKeys(value, fallbackKey = "all") {
  const fallback = normalizeProviderAccountKey(fallbackKey);
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return PROVIDER_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
    acc[providerId] = normalizeProviderAccountKey(source[providerId] || fallback);
    return acc;
  }, {});
}

function accountKeyForProvider(accountKeys, providerId) {
  if (accountKeys && typeof accountKeys === "object" && !Array.isArray(accountKeys)) {
    return normalizeProviderAccountKey(accountKeys[providerId]);
  }
  return normalizeProviderAccountKey(accountKeys);
}

function accountFilterIsAll(selectedProvider, accountKeys) {
  if (selectedProvider === "all") {
    return PROVIDER_ACCOUNT_FILTER_PROVIDERS.every((providerId) => accountKeyForProvider(accountKeys, providerId) === "all");
  }
  return accountKeyForProvider(accountKeys, selectedProvider) === "all";
}

function rowMatchesAccountFilter(row, selectedProvider, accountKeys) {
  const providerId = selectedProvider === "all" ? providerKey(row) : selectedProvider;
  const selectedAccountKey = accountKeyForProvider(accountKeys, providerId);
  if (selectedAccountKey === TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE) return false;
  return selectedAccountKey === "all" || rowProviderAccountKey(row) === selectedAccountKey;
}

const TOKENOMICS_DEFAULT_ACCOUNT_KEY = "local-account";

function normalizeTokenomicsAccountKey(accountKey) {
  return String(accountKey || TOKENOMICS_DEFAULT_ACCOUNT_KEY).trim() || TOKENOMICS_DEFAULT_ACCOUNT_KEY;
}

function providerAccent(provider) {
  return PROVIDER_ACCENTS[provider] || "#60a5fa";
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

function tokenomicsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function tokenomicsObjectHasAny(value, keys = []) {
  const object = tokenomicsObject(value);
  if (!object) return false;
  return keys.some((key) => object[key] != null && object[key] !== "");
}

function storageUsageHasMeaningfulData(storageUsage) {
  const raw = tokenomicsObject(storageUsage);
  if (!raw) return false;
  const usage = tokenomicsObject(raw.usage);
  return Boolean(
    raw.known === true
      || usage
      || tokenomicsObjectHasAny(raw, [
        "totalBytes",
        "total_bytes",
        "totalUsedBytes",
        "total_used_bytes",
        "sqliteBytes",
        "sqlite_bytes",
        "sqliteUsedBytes",
        "sqlite_used_bytes",
        "assetsBytes",
        "assets_bytes",
        "assetsUsedBytes",
        "assets_used_bytes",
      ])
  );
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
    return { total_bytes: 250 * 1024 ** 3, sqlite_bytes: 50 * 1024 ** 3, assets_bytes: 200 * 1024 ** 3 };
  }
  if (normalized === "pro") {
    return { total_bytes: 50 * 1024 ** 3, sqlite_bytes: 15 * 1024 ** 3, assets_bytes: 35 * 1024 ** 3 };
  }
  if (normalized === "plus") {
    return { total_bytes: 10 * 1024 ** 3, sqlite_bytes: 3 * 1024 ** 3, assets_bytes: 7 * 1024 ** 3 };
  }
  return { total_bytes: 0, sqlite_bytes: 0, assets_bytes: 0 };
}

function storageUsageModel(billingStatus = {}, liveStorageUsage = null) {
  const planName = String(
    billingStatusPlanName(billingStatus)
      || liveStorageUsage?.planName
      || liveStorageUsage?.plan_name
      || "free",
  ).trim().toLowerCase();
  const raw = liveStorageUsage
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
    total_bytes: storageByteValue(explicitLimits.totalBytes, explicitLimits.total_bytes, fallback.total_bytes),
    sqlite_bytes: storageByteValue(explicitLimits.sqliteBytes, explicitLimits.sqlite_bytes, fallback.sqlite_bytes),
    assets_bytes: storageByteValue(explicitLimits.assetsBytes, explicitLimits.assets_bytes, fallback.assets_bytes),
  };
  const rows = [
    {
      key: "total",
      label: "Total",
      used: storageByteValue(usage.totalBytes, usage.total_bytes, raw.totalUsedBytes, raw.total_used_bytes),
      limit: limits.total_bytes,
    },
    {
      key: "sqlite",
      label: "SQLite",
      used: storageByteValue(usage.sqliteBytes, usage.sqlite_bytes, raw.sqliteUsedBytes, raw.sqlite_used_bytes),
      limit: limits.sqlite_bytes,
    },
    {
      key: "assets",
      label: "Assets",
      used: storageByteValue(usage.assetsBytes, usage.assets_bytes, raw.assetsUsedBytes, raw.assets_used_bytes),
      limit: limits.assets_bytes,
    },
  ].map((row) => ({
    ...row,
    percent: row.limit > 0 ? Math.min(100, Math.max(0, Math.round((row.used / row.limit) * 100))) : 0,
  }));
  return {
    known: Boolean(storageUsageHasMeaningfulData(raw) || storageUsageHasMeaningfulData(billingStatus?.storage?.usage)),
    rows,
  };
}

function providerKey(row) {
  const agent = String(row?.agent_kind || "").toLowerCase();
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

function providerAccountHeading(providerId) {
  if (providerId === "codex") return "Codex";
  if (providerId === "claude") return "Claude";
  return providerDisplayName(providerId);
}

function rowDeviceId(row) {
  return String(row?.device_id || row?.machine_id || "").trim();
}

function rowScopeKey(row) {
  const explicit = String(row?.billing_scope_key || "").trim();
  if (explicit) return explicit;
  const type = String(row?.billing_scope_type || row?.scope_type || "").trim().toLowerCase();
  const teamId = String(row?.billing_team_id || row?.team_id || "").trim();
  if (type === "team" || teamId) return teamId ? `team:${teamId}` : "team";
  if (type === "personal") return "personal";
  return "unknown";
}

function tokenomicsDeviceIdentityRows(summary = {}) {
  const value = summary && typeof summary === "object" ? summary : {};
  return [
    ...(Array.isArray(value.device_identities) ? value.device_identities : []),
    ...(Array.isArray(value.deviceIdentities) ? value.deviceIdentities : []),
    ...(Array.isArray(value.devices) ? value.devices : []),
    ...(Array.isArray(value.device_aliases) ? value.device_aliases : []),
    ...(Array.isArray(value.deviceAliases) ? value.deviceAliases : []),
  ];
}

function tokenomicsDeviceIdentityLabel(identity = {}) {
  return String(
    identity?.display_name || identity?.label || identity?.device_name || identity?.machine_name || identity?.hostname || identity?.name || "",
  ).trim();
}

function tokenomicsDeviceIdentityIds(identity = {}) {
  return [
    rowDeviceId(identity),
    identity?.id,
    identity?.device_id,
    identity?.machine_id,
    identity?.native_device_id,
    identity?.target_device_id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function tokenomicsIndexKey(providerId, value) {
  const clean = String(value || "").trim();
  return clean ? `${providerId}\u0000${clean}` : "";
}

function tokenomicsEmailGroupId(providerId, email) {
  return `${providerId}:email:${email}`;
}

function tokenomicsEnsureAccountGroup(groups, providerId, email) {
  const groupId = tokenomicsEmailGroupId(providerId, email);
  let group = groups.get(groupId);
  if (!group) {
    group = {
      id: groupId,
      provider_id: providerId,
      email,
      label: tokenomicsEmailLocalPart(email) || email,
      keys: new Set(),
      keyTotals: new Map(),
    };
    groups.set(groupId, group);
  }
  return group;
}

function tokenomicsAccountRowIsActive(row = {}) {
  return row?.active_provider_account === true || row?.active_agent_profile === true;
}

function tokenomicsAddGroupKey(index, group, key, total = 0) {
  const clean = String(key || "").trim();
  if (!clean || providerAccountKeyIsUnknown(clean)) return;
  group.keys.add(clean);
  group.keyTotals.set(clean, (group.keyTotals.get(clean) || 0) + Math.max(0, numeric(total)));
  index.byKey.set(tokenomicsIndexKey(group.provider_id, clean), group);
}

function tokenomicsAddGroupLabel(index, group, label) {
  const normalized = normalizeProviderAccountLabel(label);
  const stripped = normalizeTokenomicsAliasLabel(label, group.provider_id);
  [normalized, stripped].filter(Boolean).forEach((candidate) => {
    const key = tokenomicsIndexKey(group.provider_id, candidate);
    registerTokenomicsIdentityAlias(index.byLabel, index.ambiguousLabels, key, group);
  });
}

function tokenomicsAccountRowsFromSummary(summary = {}) {
  const rows = [];
  if (!summary || typeof summary !== "object") return rows;
  Object.values(summary).forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((row) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        if (
          rowProviderAccountKey(row) || row?.provider_account_label || row?.subscription_key
        ) {
          rows.push(row);
        }
      }
    });
  });
  return rows;
}

function buildTokenomicsAccountIdentityIndex(agentAccounts) {
  const groups = new Map();
  const index = {
    groups,
    byKey: new Map(),
    byLabel: new Map(),
    ambiguousLabels: new Set(),
    byProfileId: new Map(),
    activeByProvider: new Map(),
    providerGroupCount: new Map(),
  };
  for (const providerId of PROVIDER_ACCOUNT_FILTER_PROVIDERS) {
    const entry = agentAccounts?.[providerId];
    const profiles = Array.isArray(entry?.profiles) ? entry.profiles : [];
    const uniqueProfileLabels = uniqueTokenomicsAliasesByOwner(
      profiles.map((profile) => ({
        owner: normalizeTokenomicsEmail(profile?.email || profile?.identity?.email),
        aliases: tokenomicsProfileLabelCandidates(profile, providerId),
      })),
    );
    // Provider-side display names are not unique across accounts — only use
    // one as a row-matching alias when a single profile claims it.
    const displayNameCounts = new Map();
    for (const profile of profiles) {
      const name = normalizeProviderAccountLabel(profile?.identity?.display_name);
      if (name) displayNameCounts.set(name, (displayNameCounts.get(name) || 0) + 1);
    }
    for (const profile of profiles) {
      const email = normalizeTokenomicsEmail(profile?.email || profile?.identity?.email);
      if (!email) continue;
      const group = tokenomicsEnsureAccountGroup(groups, providerId, email);
      const label = profile?.alias || (!profile?.is_default ? profile?.label : "") || tokenomicsEmailLocalPart(email) || email;
      group.label = preferredTokenomicsAccountLabel(label, group.label, providerId);
      if (providerId === "claude") {
        // Claude registry labels name accounts exactly like the accounts
        // settings UI; row labels (oauth display names, "Claude · x"
        // fallbacks) must never override them during the summary passes.
        // Other providers keep the historical row-label preference.
        group.labelPinned = true;
      }
      const profileId = String(profile?.id || "").trim();
      if (profileId) {
        index.byProfileId.set(tokenomicsIndexKey(providerId, profileId), group);
      }
      tokenomicsAddGroupKey(index, group, tokenomicsProviderProfileAccountKey(providerId, profile?.id));
      tokenomicsProfileLabelCandidates(profile, providerId).forEach((candidate) => {
        if (uniqueProfileLabels.has(candidate)) {
          tokenomicsAddGroupLabel(index, group, candidate);
        } else {
          [
            normalizeProviderAccountLabel(candidate),
            normalizeTokenomicsAliasLabel(candidate, providerId),
          ].filter(Boolean).forEach((ambiguous) => {
            index.ambiguousLabels.add(tokenomicsIndexKey(providerId, ambiguous));
          });
        }
      });
      const displayName = normalizeProviderAccountLabel(profile?.identity?.display_name);
      if (displayName && displayNameCounts.get(displayName) === 1) {
        tokenomicsAddGroupLabel(index, group, profile.identity.display_name);
      }
      if (profile?.is_active) {
        index.activeByProvider.set(providerId, group);
      }
    }
    // OAuth keys belong to the identity email observed beside the key, not
    // blindly to the registry email. Process matching-email claims first so a
    // stale pushed/legacy profile can never win ownership through registry
    // order; mismatches still get a correctly labeled identity-email group.
    prioritizedTokenomicsIdentityKeyClaims(profiles).forEach((claim) => {
      const group = tokenomicsEnsureAccountGroup(groups, providerId, claim.ownerEmail);
      const owner = index.byKey.get(tokenomicsIndexKey(providerId, claim.key));
      if (!owner || owner === group) {
        tokenomicsAddGroupKey(index, group, claim.key);
      }
    });
  }
  for (const group of groups.values()) {
    index.providerGroupCount.set(group.provider_id, (index.providerGroupCount.get(group.provider_id) || 0) + 1);
  }
  return groups.size ? index : null;
}

function tokenomicsCurrentProfileIdsByProvider(agentAccounts) {
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

function tokenomicsRowReferencesRemovedProfile(row, currentProfileIdsByProvider) {
  const providerId = providerKey(row);
  const profileId = tokenomicsRowAgentProfileId(row)
    || tokenomicsProfileIdFromAccountKey(providerId, rowProviderAccountKey(row));
  if (!profileId || profileId === "default") return false;
  if (!currentProfileIdsByProvider) return true;
  const currentIds = currentProfileIdsByProvider[providerId];
  if (!currentIds) return false;
  return Boolean(profileId && !currentIds.has(profileId));
}

function tokenomicsResolveAccountGroup(row, index) {
  if (!index) return null;
  const providerId = providerKey(row);
  if (!PROVIDER_ACCOUNT_FILTER_PROVIDERS.includes(providerId)) return null;
  const key = rowProviderAccountKey(row);
  const byKey = index.byKey.get(tokenomicsIndexKey(providerId, key));
  if (byKey) return byKey;
  const profileId = tokenomicsRowAgentProfileId(row);
  if (profileId) {
    const byProfileId = index.byProfileId.get(tokenomicsIndexKey(providerId, profileId));
    if (byProfileId) return byProfileId;
    const profileKey = tokenomicsProviderProfileAccountKey(providerId, profileId);
    const byProfileKey = index.byKey.get(tokenomicsIndexKey(providerId, profileKey));
    if (byProfileKey) return byProfileKey;
  }
  if (tokenomicsAccountRowIsActive(row)) {
    const active = index.activeByProvider.get(providerId);
    if (active) return active;
  }
  const rawLabel = rowProviderAccountLabel(row);
  const labels = [
    normalizeProviderAccountLabel(rawLabel),
    normalizeTokenomicsAliasLabel(rawLabel, providerId),
  ].filter(Boolean);
  for (const label of labels) {
    const byLabel = index.byLabel.get(tokenomicsIndexKey(providerId, label));
    if (byLabel) return byLabel;
  }
  const labelEmail = normalizeTokenomicsEmail(String(rawLabel || "").match(/[^\s<>]+@[^\s<>]+/u)?.[0]);
  if (labelEmail) {
    const byEmail = index.groups.get(tokenomicsEmailGroupId(providerId, labelEmail));
    if (byEmail) return byEmail;
  }
  if (index.providerGroupCount.get(providerId) === 1) {
    return [...index.groups.values()].find((group) => group.provider_id === providerId) || null;
  }
  return null;
}

function tokenomicsCanonicalAccountKey(group) {
  if (!group) return "";
  const keys = [...group.keys].filter((key) => !providerAccountKeyIsUnknown(key));
  if (!keys.length) return "";
  return keys.sort((left, right) => {
    const leftProfile = left.includes(":profile:");
    const rightProfile = right.includes(":profile:");
    if (leftProfile !== rightProfile) return leftProfile ? 1 : -1;
    const totalDelta = (group.keyTotals.get(right) || 0) - (group.keyTotals.get(left) || 0);
    if (totalDelta) return totalDelta;
    return left.localeCompare(right);
  })[0];
}

function tokenomicsCanonicalizeAccountRow(row, index) {
  const group = tokenomicsResolveAccountGroup(row, index);
  if (!group) return row;
  const canonicalKey = tokenomicsCanonicalAccountKey(group);
  if (!canonicalKey) return row;
  const label = group.label || rowProviderAccountLabel(row);
  return {
    ...row,
    provider_account_key: canonicalKey,
    provider_account_label: label,
  };
}

function canonicalizeTokenomicsAccountSummary(summary = {}, agentAccounts = null) {
  const index = buildTokenomicsAccountIdentityIndex(agentAccounts);
  if (!index || !summary || typeof summary !== "object") return summary;
  const rows = tokenomicsAccountRowsFromSummary(summary);
  for (let pass = 0; pass < 2; pass += 1) {
    rows.forEach((row) => {
      const group = tokenomicsResolveAccountGroup(row, index);
      if (!group) return;
      const key = rowProviderAccountKey(row);
      tokenomicsAddGroupKey(index, group, key, rowTotal(row));
      if (!group.labelPinned) {
        group.label = preferredTokenomicsAccountLabel(rowProviderAccountLabel(row), group.label, group.provider_id);
      }
      tokenomicsAddGroupLabel(index, group, rowProviderAccountLabel(row));
    });
  }
  return Object.fromEntries(Object.entries(summary).map(([key, value]) => {
    if (!Array.isArray(value)) return [key, value];
    return [key, value.map((row) => (
      row && typeof row === "object" && !Array.isArray(row)
        ? tokenomicsCanonicalizeAccountRow(row, index)
        : row
    ))];
  }));
}

function tokenomicsIdentityLooksNative(identity = {}) {
  if (!identity || typeof identity !== "object") return false;
  if (identity.current === true || identity.current === "true") return true;
  const clientKind = [
    identity.client_kind,
    identity.source,
    identity.agent_id,
  ].map((value) => String(value || "").trim()).join(" ").toLowerCase();
  const platformAndForm = [
    identity.platform,
    identity.os,
    identity.form_factor,
    identity.device_type,
  ].map((value) => String(value || "").trim()).join(" ").toLowerCase();
  const nativeRuntime = ["native", "desktop", "tauri", "rust"].some((token) => clientKind.includes(token));
  const webOnly = clientKind.includes("web") && !nativeRuntime;
  const mobileOnly = !nativeRuntime
    && ["mobile", "phone", "tablet", "android", "ios"].some((token) => platformAndForm.includes(token));
  return nativeRuntime && !webOnly && !mobileOnly;
}

function mappedNativeDeviceIds(summary = {}) {
  const ids = new Set();
  const currentDeviceId = String(summary?.current_device_id || "").trim();
  if (currentDeviceId) ids.add(currentDeviceId);
  tokenomicsDeviceIdentityRows(summary).forEach((identity) => {
    if (!tokenomicsIdentityLooksNative(identity)) return;
    tokenomicsDeviceIdentityIds(identity).forEach((id) => ids.add(id));
  });
  return ids;
}

function rowsForMappedNativeDevices(rows = [], nativeDeviceIds = new Set()) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    const id = rowDeviceId(row);
    return !id || nativeDeviceIds.has(id);
  });
}

function summaryForMappedNativeDevices(summary = {}) {
  return summary;
}

function summaryArray(summary = {}, ...keys) {
  let fallback = [];
  for (const key of keys) {
    const rows = Array.isArray(summary?.[key]) ? summary[key] : [];
    if (rows.length) return rows;
    if (!fallback.length) fallback = rows;
  }
  return fallback;
}

function summaryIsTokenomicsV2(summary = {}) {
  return String(summary?.schema_version || "").toLowerCase() === "tokenomics_v2";
}

function hourlyRowsForDisplay(summary = {}) {
  return summaryArray(summary, "hourly");
}

function providerRowsForDisplay(summary = {}) {
  const legacy = summaryArray(summary, "by_device_provider");
  return legacy.length ? legacy : hourlyRowsForDisplay(summary);
}

function accountRowsForDisplay(summary = {}) {
  const legacy = summaryArray(summary, "by_device_account");
  return legacy.length ? legacy : hourlyRowsForDisplay(summary);
}

function modelRowsForDisplay(summary = {}) {
  const hourly = hourlyRowsForDisplay(summary);
  if (summaryIsTokenomicsV2(summary)) return hourly;
  const legacy = summaryArray(summary, "by_device_model");
  return legacy.length ? legacy : hourly;
}

function dailyRowsForDisplay(summary = {}) {
  const daily = summaryArray(summary, "daily_by_device_provider", "daily");
  if (daily.length) return daily;
  return hourlyRowsForDisplay(summary);
}

function usageRowsForDisplay(summary = {}) {
  const legacy = [
    ...summaryArray(summary, "by_device"),
    ...summaryArray(summary, "by_device_provider"),
    ...summaryArray(summary, "by_device_account"),
    ...summaryArray(summary, "by_device_model"),
    ...dailyRowsForDisplay(summary),
  ];
  return legacy.length ? legacy : hourlyRowsForDisplay(summary);
}

function normalizedLimitWindowKind(kind) {
  const clean = String(kind || "").trim().toLowerCase();
  if (["session_5h", "5-hour", "5h", "five_hour", "five-hour"].includes(clean)) return "5_hour";
  return clean;
}

function normalizeLimitRowForDisplay(row = {}) {
  const rawWindowKind = row?.window_kind ?? row?.limit_kind ?? row?.provider_window_kind ?? "";
  const windowKind = normalizedLimitWindowKind(rawWindowKind);
  if (!windowKind || windowKind === rawWindowKind) return row;
  return {
    ...row,
    provider_window_kind: row?.provider_window_kind ?? rawWindowKind,
    window_kind: windowKind,
    limit_kind: windowKind,
  };
}

function limitRowsForDisplay(summary = {}) {
  return [
    ...summaryArray(summary, "limits"),
    ...summaryArray(summary, "latest_windows"),
  ].map(normalizeLimitRowForDisplay);
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
        display_name: label || current.display_name || "",
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
  const clean = String(deviceId || "").trim();
  const suffix = clean.length > 10 ? `${clean.slice(0, 6)}...${clean.slice(-4)}` : clean || "unknown";
  return `Device ${suffix}`;
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
  const identityLabel = tokenomicsDeviceIdentityLabel(identityMap.get(deviceId));
  if (identityLabel) return identityLabel;
  return genericDeviceLabel(deviceId);
}

function filterRows(rows, selectedProvider, selectedAccountKeys = "all", selectedDeviceId = "all", selectedScopeKey = "all") {
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  return rows.filter((row) => (
    provider.match(row)
      && rowMatchesAccountFilter(row, selectedProvider, selectedAccountKeys)
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
      events: acc.events + numeric(row?.event_count),
    }),
    { input: 0, output: 0, cache: 0, total: 0, cost: 0, events: 0 },
  );
}

function bucketDayKey(row) {
  const raw = row?.bucket_start || row?.bucket_day;
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
    row.limit_used_percent,
    row.used,
  );
}

function weeklyLimitRowTime(row = {}) {
  return parseLimitTimestamp(
    row.sample_at ?? row.sample_bucket_start ?? row.sample_observed_at ?? row.limit_observed_at ?? row.updated_at ?? row.last_known_at,
  );
}

function weeklyLimitRowResetKey(row = {}) {
  return String(row.reset_at ?? row.limit_resets_at ?? "");
}

function weeklyLimitSeriesKey(row = {}) {
  return [rowScopeKey(row), rowDeviceId(row) || "unknown-device", providerKey(row), rowProviderAccountKey(row)].join("::");
}

function matchingWeeklyLimitRows(rows, selectedProvider, selectedAccountKeys, selectedDeviceId = "all", selectedScopeKey = "all") {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    normalizedLimitWindowKind(row?.window_kind || row?.limit_kind || "") === "weekly"
      && (selectedProvider === "all" || providerKey(row) === selectedProvider)
      && rowMatchesAccountFilter(row, selectedProvider, selectedAccountKeys)
      && (selectedDeviceId === "all" || !rowDeviceId(row) || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
}

function directDailyWeeklyLimitPercents(limitSamples, selectedProvider, selectedAccountKeys, selectedDeviceId = "all", selectedScopeKey = "all") {
  const bySeries = new Map();
  for (const row of matchingWeeklyLimitRows(limitSamples, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey)) {
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
    let windowEntries = [];
    const flushWindow = () => {
      const latest = windowEntries[windowEntries.length - 1];
      if (latest?.used > 0) {
        byDay.set(latest.day, Math.max(byDay.get(latest.day) || 0, latest.used));
      }
      windowEntries = [];
    };
    for (const entry of series) {
      const previous = windowEntries[windowEntries.length - 1] || null;
      const sameWindow = previous
        ? (!entry.resetKey || !previous.resetKey || entry.resetKey === previous.resetKey)
        : true;
      if (previous && (!sameWindow || entry.used < previous.used)) {
        flushWindow();
      }
      windowEntries.push(entry);
    }
    flushWindow();
  }
  return byDay;
}

function withDailyWeeklyLimitPercents(rows, limitSamples, limits, selectedProvider, selectedAccountKeys, selectedDeviceId = "all", selectedScopeKey = "all") {
  const directPercents = directDailyWeeklyLimitPercents(limitSamples, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
  const withDirectPercents = rows.map((row) => {
    const weeklyLimitPercent = directPercents.get(row.key);
    return {
      ...row,
      weeklyLimitPercent: weeklyLimitPercent == null ? null : Math.max(0, Math.min(100, weeklyLimitPercent)),
      weeklyLimitPercentEstimated: false,
    };
  });
  return withDailyTokenReferenceLimitPercents(withDirectPercents);
}

function dailyTokenReferencePercentPerToken(rows) {
  return rows.reduce((highest, row) => {
    const total = dailyUsageValue(row);
    const percent = limitNumberOrNull(row?.weeklyLimitPercent);
    if (total <= 0 || percent == null || percent <= TOKENOMICS_DAILY_WARN_LIMIT_PERCENT) {
      return highest;
    }
    const percentPerToken = percent / total;
    return Number.isFinite(percentPerToken) ? Math.max(highest, percentPerToken) : highest;
  }, 0);
}

function withDailyTokenReferenceLimitPercents(rows) {
  const percentPerToken = dailyTokenReferencePercentPerToken(rows);
  if (!(percentPerToken > 0)) return rows;
  return rows.map((row) => {
    if (limitNumberOrNull(row?.weeklyLimitPercent) != null) return row;
    const total = dailyUsageValue(row);
    if (total <= 0) return row;
    const estimatedPercent = Math.max(0, Math.min(100, total * percentPerToken));
    if (estimatedPercent <= TOKENOMICS_DAILY_WARN_LIMIT_PERCENT) return row;
    return {
      ...row,
      weeklyLimitPercent: estimatedPercent,
      weeklyLimitPercentEstimated: true,
    };
  });
}

function buildDailyRows(dailyRows, limitSamples, limits, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all", windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const filtered = filterRows(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
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
  return withDailyWeeklyLimitPercents(rows, limitSamples, limits, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
}

function rollingWindowAggregate(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all", windowDays = TOKENOMICS_DAILY_WINDOW_DAYS) {
  const today = dateFromDayKey(dayKeyUtc(new Date()));
  const startKey = dayKeyUtc(addUtcDays(today, -(Math.max(1, windowDays) - 1)));
  const endKey = dayKeyUtc(today);
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey)
    .filter((row) => {
      const key = bucketDayKey(row);
      return key >= startKey && key <= endKey;
    });
  return aggregateRows(rows);
}

function todayAggregate(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all") {
  const today = dayKeyUtc(new Date());
  const rows = filterRows(dailyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey)
    .filter((row) => bucketDayKey(row) === today);
  return aggregateRows(rows);
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

function limitTimestampMs(row = {}) {
  return parseLimitTimestamp(
    row.sample_at ?? row.sample_observed_at ?? row.limit_observed_at ?? row.updated_at ?? row.last_known_at,
  )?.getTime() || 0;
}

function filterLimits(limits, selectedProvider, selectedAccountKeys = "all", selectedScopeKey = "all", selectedDeviceId = "all") {
  if (!Array.isArray(limits)) return [];
  return mergeProviderLimitRowsForDisplay(limits.filter((limit) => (
    (selectedProvider === "all" || providerKey(limit) === selectedProvider)
      && rowMatchesAccountFilter(limit, selectedProvider, selectedAccountKeys)
      && (selectedDeviceId === "all" || !rowDeviceId(limit) || rowDeviceId(limit) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(limit) === selectedScopeKey)
  )), selectedDeviceId);
}

function providerLimitUsesActiveAccount(row = {}) {
  return row?.active_provider_account === true || row?.active_agent_profile === true;
}

function activeProviderAccountKeyForLimits(limits, selectedProvider, selectedScopeKey = "all", selectedDeviceId = "all") {
  if (selectedProvider === "all") return "";
  const rows = (Array.isArray(limits) ? limits : []).filter((row) => (
    providerKey(row) === selectedProvider
      && rowProviderAccountKey(row)
      && (selectedDeviceId === "all" || !rowDeviceId(row) || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
  const activeRow = rows.find(providerLimitUsesActiveAccount);
  if (activeRow) return rowProviderAccountKey(activeRow) || "";
  // No active-account tag (e.g. a keychain-based Claude profile publishes no
  // flagged row): fall back to the most recently observed account with live
  // data so the gauge tracks one plan instead of averaging every account.
  const candidates = rows.filter(hasKnownLimitPercent);
  const pool = candidates.length ? candidates : rows;
  const latest = pool.reduce(
    (best, row) => (best == null || limitTimestampMs(row) > limitTimestampMs(best) ? row : best),
    null,
  );
  return rowProviderAccountKey(latest) || "";
}

function limitAccountKeyForDisplay(limits, selectedProvider, selectedAccountKey = "all", selectedScopeKey = "all", selectedDeviceId = "all") {
  if (selectedAccountKey && selectedAccountKey !== "all") {
    return selectedAccountKey;
  }
  return activeProviderAccountKeyForLimits(limits, selectedProvider, selectedScopeKey, selectedDeviceId) || "all";
}

function limitResetDate(limit = {}) {
  const direct = parseLimitTimestamp(limit.reset_at ?? limit.limit_resets_at);
  if (direct) return direct;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds);
  const updatedAt = parseLimitTimestamp(
    limit.limit_observed_at ?? limit.sample_observed_at ?? limit.updated_at ?? limit.last_known_at,
  );
  if (resetAfterSeconds != null && updatedAt) {
    return new Date(updatedAt.getTime() + Math.max(0, resetAfterSeconds) * 1000);
  }
  return null;
}

function hasKnownLimitPercent(limit = {}) {
  return limitNumberOrNull(
    limit.remaining_percent,
    limit.used_percent,
    limit.limit_used_percent,
  ) != null;
}

function limitDisplayPercentKind(limit = {}, fallbackWindowKind = "") {
  const explicit = String(
    limit.display_percent_kind ?? limit.limit_display_percent_kind ?? "",
  ).toLowerCase();
  if (explicit === "remaining" || explicit === "used") return explicit;
  if (providerKey(limit) === "codex" || providerKey(limit) === "claude") return "remaining";
  const windowKind = String(
    fallbackWindowKind || limit.window_kind || limit.limit_kind || "",
  );
  return windowKind === "weekly" ? "remaining" : "used";
}

function limitDisplayPercent(limit = {}, usedPercent = null, remainingPercent = null, fallbackWindowKind = "") {
  const displayKind = limitDisplayPercentKind(limit, fallbackWindowKind);
  const percent = displayKind === "remaining" ? remainingPercent : usedPercent;
  return percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
}

function formatLimitResetDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

function limitResetLabelIsPlaceholder(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return text === "reset time unavailable"
    || text === "resets with provider window"
    || text === "resets on provider schedule"
    || text.includes("provider limit unavailable")
    || text.includes("provider schedule unavailable")
    || text.includes("provider window reset")
    || text.includes("open claude code")
    || text.includes("claude code has not reported");
}

function meaningfulLimitResetLabel(limit = {}) {
  const explicit = String(limit.reset_label || "").trim();
  return explicit && !limitResetLabelIsPlaceholder(explicit) ? explicit : "";
}

function limitHasResetTiming(limit = {}) {
  if (meaningfulLimitResetLabel(limit)) return true;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds);
  if (resetAfterSeconds != null && resetAfterSeconds > 0) return true;
  const resetDate = limitResetDate(limit);
  return Boolean(resetDate && resetDate.getTime() > Date.now());
}

function limitResetReferenceRow(rows = []) {
  const candidates = (Array.isArray(rows) ? rows : []).filter(limitHasResetTiming);
  const source = candidates.length ? candidates : (Array.isArray(rows) ? rows : []);
  return [...source].sort((left, right) => {
    const activeDelta = Number(providerLimitUsesActiveAccount(right)) - Number(providerLimitUsesActiveAccount(left));
    if (activeDelta) return activeDelta;
    return limitTimestampMs(right) - limitTimestampMs(left);
  })[0] || {};
}

function computedLimitResetLabel(limit = {}, windowKind = "5_hour") {
  const explicit = meaningfulLimitResetLabel(limit);
  if (explicit) return explicit;
  const resetAfterSeconds = limitNumberOrNull(limit.reset_after_seconds);
  if (resetAfterSeconds != null && resetAfterSeconds > 0) {
    return `Resets in ${formatLimitResetDuration(resetAfterSeconds)}`;
  }
  const resetDate = limitResetDate(limit);
  if (resetDate) {
    const secondsUntilReset = Math.round((resetDate.getTime() - Date.now()) / 1000);
    if (secondsUntilReset > 0) {
      return `Resets in ${formatLimitResetDuration(secondsUntilReset)}`;
    }
  }
  return windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule";
}

// One account per provider: limit gauges always describe a single plan (the
// active account when tagged, else the freshest live account), never an
// average across every logged-in account of that provider.
function limitDisplayAccountRows(rows) {
  const byProvider = new Map();
  for (const row of rows) {
    const provider = providerKey(row);
    const group = byProvider.get(provider) || [];
    group.push(row);
    byProvider.set(provider, group);
  }
  const kept = [];
  for (const group of byProvider.values()) {
    const accountKeys = new Set(group.map((row) => rowProviderAccountKey(row) || ""));
    if (accountKeys.size <= 1) {
      kept.push(...group);
      continue;
    }
    const activeRows = group.filter(providerLimitUsesActiveAccount);
    const liveRows = group.filter(hasKnownLimitPercent);
    const pool = activeRows.length ? activeRows : (liveRows.length ? liveRows : group);
    const chosen = pool.reduce((best, row) => (limitTimestampMs(row) > limitTimestampMs(best) ? row : best), pool[0]);
    const chosenKey = rowProviderAccountKey(chosen) || "";
    kept.push(...group.filter((row) => (rowProviderAccountKey(row) || "") === chosenKey));
  }
  return kept;
}

function mergeLimits(limits, windowKind) {
  const normalizedWindowKind = normalizedLimitWindowKind(windowKind);
  const rows = limitDisplayAccountRows(
    limits
      .map(normalizeLimitRowForDisplay)
      .filter((limit) => normalizedLimitWindowKind(limit?.window_kind || limit?.limit_kind || "") === normalizedWindowKind),
  ).map((limit) => projectProviderLimitForDisplay(limit));
  if (!rows.length) {
    return {
      window_kind: normalizedWindowKind,
      label: normalizedWindowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit",
      plan_detected: false,
      plan_name: "No plan detected",
      confidence: "unknown",
      remaining_percent: null,
      used_percent: null,
      display_percent: null,
      display_percent_kind: limitDisplayPercentKind({}, windowKind),
      paceDelta: null,
      pace_status: "unknown",
      overPace: false,
      status_label: "Plan limit not exposed",
      reset_label: normalizedWindowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule",
      rate_points: [],
    };
  }
  const used = rows.reduce((sum, row) => sum + numeric(row?.used), 0);
  const allowanceValues = rows.map((row) => numeric(row?.allowance)).filter((value) => value > 0);
  const allowance = allowanceValues.length ? allowanceValues.reduce((sum, value) => sum + value, 0) : null;
  const explicitUsedPercents = rows
    .map((row) => limitNumberOrNull(row?.used_percent, row?.limit_used_percent))
    .filter((value) => value != null);
  const explicitRemainingPercents = rows
    .map((row) => limitNumberOrNull(row?.remaining_percent))
    .filter((value) => value != null);
  const averagePercent = (values) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  const usedPercent = explicitUsedPercents.length
    ? averagePercent(explicitUsedPercents)
    : allowance
      ? Math.max(0, Math.min(100, Math.round((used / allowance) * 100)))
      : null;
  const remainingPercent = explicitRemainingPercents.length
    ? Math.max(0, Math.min(100, averagePercent(explicitRemainingPercents)))
    : (usedPercent == null ? null : Math.max(0, 100 - usedPercent));
  const displayPercentKind = limitDisplayPercentKind(rows[0], normalizedWindowKind);
  const displayPercent = limitDisplayPercent(rows[0], usedPercent, remainingPercent, normalizedWindowKind);
  const paceDelta = averagePercent(rows
    .map((row) => limitNumberOrNull(row?.pace_delta_percent))
    .filter((value) => value != null));
  const plans = [...new Set(rows.map((row) => row?.plan_name).filter(Boolean))];
  const confidences = [...new Set(rows.map((row) => row?.confidence).filter(Boolean))];
  const ratePoints = rows.flatMap((row) => Array.isArray(row?.rate_points) ? (row.rate_points) : []);
  const limitSource = rows.find((row) => row?.limit_source)?.limit_source || "";
  const providerKeys = [...new Set(rows.map(providerKey).filter(Boolean))];
  const claudeUnavailable = isClaudeLimitUnavailable(rows);
  const paceStatus = limitPaceStatus(rows);
  const overPace = paceStatus === "over_pace" || (paceDelta != null && paceDelta > 0);
  const resetReference = limitResetReferenceRow(rows);
  return {
    window_kind: normalizedWindowKind,
    label: rows[0]?.label || (normalizedWindowKind === "5_hour" ? "5-Hour Session" : "Weekly Limit"),
    plan_detected: rows.some((row) => Boolean(row?.plan_detected)),
    plan_name: plans.length ? plans.join(" + ") : "No plan detected",
    confidence: confidences.includes("estimated") ? "estimated" : (confidences[0] || "unknown"),
    limit_source: limitSource,
    providerKeys,
    remaining_percent: remainingPercent,
    used_percent: usedPercent,
    display_percent: displayPercent,
    display_percent_kind: displayPercentKind,
    paceDelta,
    pace_status: paceStatus,
    overPace,
    status_label: limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable, paceStatus),
    reset_label: limitResetLabel(rows, normalizedWindowKind, claudeUnavailable, resetReference),
    rate_points: ratePoints,
    limit_window_seconds: limitNumberOrNull(resetReference?.limit_window_seconds, rows[0]?.limit_window_seconds, rows[0]?.limit_window_seconds) ?? 0,
    reset_after_seconds: limitNumberOrNull(resetReference?.reset_after_seconds, rows[0]?.reset_after_seconds, rows[0]?.reset_after_seconds) ?? 0,
  };
}

function isClaudeLimitUnavailable(rows) {
  return rows.some((row) => {
    if (providerKey(row) !== "claude") return false;
    const source = String(row?.limit_source || "").toLowerCase();
    const confidence = String(row?.confidence || "").toLowerCase();
    const status = String(row?.status_label || "").toLowerCase();
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
    const status = String(row?.pace_status || "").toLowerCase();
    return status === "over_pace" || truthyLimitValue(row?.pace_exhausts_before_reset);
  })) {
    return "over_pace";
  }
  if (rows.some((row) => String(row?.pace_status || "").toLowerCase() === "on_pace")) {
    return "on_pace";
  }
  return "unknown";
}

function limitResetLabel(rows, windowKind, claudeUnavailable, resetReference = null) {
  const reference = resetReference || limitResetReferenceRow(rows);
  const explicit = meaningfulLimitResetLabel(reference);
  if (!claudeUnavailable) {
    const current = computedLimitResetLabel(reference, windowKind);
    return current || (windowKind === "5_hour" ? "Resets with provider window" : "Resets on provider schedule");
  }
  if (limitHasResetTiming(reference)) {
    const current = computedLimitResetLabel(reference, windowKind);
    if (current && !limitResetLabelIsPlaceholder(current)) return current;
  }
  const rawExplicit = String(reference?.reset_label || "").trim();
  if (!rawExplicit || rawExplicit.includes("Provider limit unavailable")) {
    return "Open Claude Code to publish live limits";
  }
  if (rawExplicit.includes("Provider schedule unavailable")) {
    return "Claude Code has not reported its weekly window";
  }
  return rawExplicit;
}

function limitStatusLabel(remainingPercent, paceDelta, rows, claudeUnavailable = false, paceStatus = "unknown") {
  if (remainingPercent == null) {
    if (claudeUnavailable) return "Live limits unavailable";
    return rows.find((row) => row?.status_label)?.status_label || "Plan limit not exposed";
  }
  if (remainingPercent <= 0) return "Limit exhausted";
  if (paceStatus === "over_pace" || (paceDelta != null && paceDelta > 0)) return "Pace will exhaust before reset";
  if (remainingPercent < 18) return "Pace is running hot";
  if (remainingPercent < 38 || (paceDelta != null && paceDelta > 8)) return "Watch current pace";
  return "Safe at current pace";
}

function usageRateRowsFromLimit(limit, hourlyRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all") {
  const windowSeconds = sessionWindowSeconds(limit);
  const bucketCount = Math.max(1, Math.ceil(windowSeconds / 3600));
  const rows = filterRows(Array.isArray(hourlyRows) ? hourlyRows : [], selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
  if (rows.some((row) => row?.window_index != null)) {
    const byIndex = new Map();
    for (const row of rows) {
      const index = numeric(row?.window_index);
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
  now.setUTCMinutes(0, 0, 0);
  const recent = [];
  for (let offset = bucketCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCHours(now.getUTCHours() - offset);
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
  const raw = row?.bucket_start;
  if (!raw) return null;
  const value = String(raw);
  const date = new Date(value.length === 13 ? `${value}:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hourKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
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
  return numeric(limit?.limit_window_seconds) || 5 * 60 * 60;
}

function limitSourceText(limit) {
  const source = limit?.limit_source || "";
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
  if (!limit?.plan_detected) {
    return selectedProvider === "claude" ? "No Claude account detected" : "No provider plan detected";
  }
  const name = String(limit?.plan_name || "").trim();
  if (selectedProvider === "claude" && name === "Claude subscription") {
    return "Claude account signed in";
  }
  return name || (selectedProvider === "claude" ? "Claude account signed in" : "Provider plan detected");
}

function statusTone(remainingPercent, paceDelta = null, paceStatus = "unknown") {
  const paceDeltaValue = limitNumberOrNull(paceDelta);
  if (remainingPercent == null) return "unknown";
  if (remainingPercent <= 15 || paceStatus === "over_pace" || (paceDeltaValue != null && paceDeltaValue > 0)) return "danger";
  if (remainingPercent <= 38 || (paceDeltaValue != null && paceDeltaValue > 8)) return "warn";
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
  if (weeklyLimitPercent > TOKENOMICS_DAILY_DANGER_LIMIT_PERCENT) return "danger";
  if (weeklyLimitPercent > TOKENOMICS_DAILY_WARN_LIMIT_PERCENT) return "warn";
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

function modelBreakdown(modelRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey = "all") {
  const rows = filterRows(modelRows, selectedProvider, selectedAccountKeys, selectedDeviceId, selectedScopeKey);
  const byModel = new Map();
  for (const row of rows) {
    const rawModel = String(row?.model || "").trim();
    const agentKind = String(row?.agent_kind || "").trim();
    const label = rawModel && rawModel !== agentKind ? rawModel : providerLabel(row);
    const key = label || "Unknown model";
    const current = byModel.get(key) || { label: key, total: 0 };
    current.total += rowInput(row) + rowOutput(row) + rowCache(row);
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

function providerAccountOptions(summary, selectedProvider, selectedDeviceId = "all", selectedScopeKey = "all", agentAccounts = null) {
  if (selectedProvider === "all") return [];
  const provider = PROVIDERS.find((item) => item.id === selectedProvider) || PROVIDERS[0];
  const currentProfileIds = tokenomicsCurrentProfileIdsByProvider(agentAccounts);
  const usageRows = accountRowsForDisplay(summary);
  const accountRows = summaryArray(summary, "provider_accounts");
  const limitRows = limitRowsForDisplay(summary);
  const rows = [
    ...usageRows,
    ...accountRows,
    ...limitRows,
  ].filter((row) => (
    provider.match(row)
      && !tokenomicsRowReferencesRemovedProfile(row, currentProfileIds)
      && (selectedDeviceId === "all" || !rowDeviceId(row) || rowDeviceId(row) === selectedDeviceId)
      && (selectedScopeKey === "all" || rowScopeKey(row) === selectedScopeKey)
  ));
  const byKey = new Map();
  for (const row of rows) {
    const key = rowProviderAccountKey(row);
    if (providerAccountKeyIsUnknown(key)) continue;
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
  // Identity canonicalization has already folded legitimate aliases onto the
  // same key. Never collapse different keys solely because their display
  // labels match: unrelated accounts commonly share names like "support".
  const accounts = tokenomicsAccountsFromDistinctKeys(byKey);
  if (!accounts.length) return [];
  return [{ key: "all", label: "All" }, ...accounts];
}

function providerAccountOptionsByProvider(summary, selectedDeviceId = "all", selectedScopeKey = "all", agentAccounts = null) {
  return PROVIDER_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
    acc[providerId] = providerAccountOptions(summary, providerId, selectedDeviceId, selectedScopeKey, agentAccounts);
    return acc;
  }, {});
}

function providerAccountOptionGroups(optionsByProvider, selectedProvider) {
  const providerIds = selectedProvider === "all"
    ? PROVIDER_ACCOUNT_FILTER_PROVIDERS
    : PROVIDER_ACCOUNT_FILTER_PROVIDERS.filter((providerId) => providerId === selectedProvider);

  return providerIds
    .map((providerId) => {
      const options = optionsByProvider?.[providerId] || [];
      const visibleOptions = options.length ? options : (selectedProvider === "all" ? [{ key: "all", label: "All" }] : []);
      if (!visibleOptions.length) return null;
      const displayName = providerDisplayName(providerId);
      const heading = providerAccountHeading(providerId);
      return {
        provider_id: providerId,
        label: heading,
        options: selectedProvider === "all"
          ? [
            ...visibleOptions,
            {
              key: TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE,
              label: "",
              title: `Hide ${displayName} accounts from All`,
              activeTitle: `Show ${displayName} accounts in All`,
              iconOnly: true,
            },
          ]
          : visibleOptions,
      };
    })
    .filter(Boolean);
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

function providerLimitDisplayedRemainingPercent(row = {}) {
  const remaining = limitNumberOrNull(row?.remaining_percent);
  if (remaining != null) return Math.max(0, Math.min(100, Math.round(remaining)));
  const used = limitNumberOrNull(row?.used_percent, row?.limit_used_percent);
  if (used != null) return Math.max(0, Math.min(100, Math.round(100 - used)));
  const allowance = limitNumberOrNull(row?.allowance);
  const usedAmount = limitNumberOrNull(row?.used);
  if (allowance && usedAmount != null) {
    return Math.max(0, Math.min(100, Math.round(100 - ((usedAmount / allowance) * 100))));
  }
  return null;
}

function tokenomicsLimitSignatureText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text.toLowerCase();
  }
  return "";
}

function tokenomicsLimitSignaturePercent(...values) {
  const value = limitNumberOrNull(...values);
  return value == null ? "" : String(Math.max(0, Math.min(100, Math.round(value))));
}

function tokenomicsLimitSignatureNumber(...values) {
  const value = limitNumberOrNull(...values);
  return value == null ? "" : String(Math.round(value));
}

function tokenomicsLimitResetSignature(row = {}) {
  const reset = limitResetDate(row);
  if (!reset) return "";
  return String(Math.round(reset.getTime() / 60_000));
}

function providerLimitSyncSignature(row = {}) {
  const remaining = providerLimitDisplayedRemainingPercent(row);
  const used = tokenomicsLimitSignaturePercent(
    row?.used_percent,
    row?.limit_used_percent,
  );
  const paceDelta = tokenomicsLimitSignatureNumber(row?.pace_delta_percent);
  const paceTrajectoryDelta = tokenomicsLimitSignatureNumber(
    row?.pace_trajectory_delta_percent,
  );
  const projectedUsed = tokenomicsLimitSignatureNumber(
    row?.pace_projected_used_percent,
    row?.pace_trajectory_projected_used_percent,
  );
  return [
    providerLimitKey(row),
    `remaining:${remaining == null ? "" : remaining}`,
    `used:${used}`,
    `status:${tokenomicsLimitSignatureText(row?.status_label)}`,
    `pace:${tokenomicsLimitSignatureText(row?.pace_status, row?.pace_trajectory_status)}`,
    `pace_delta:${paceDelta}`,
    `pace_trajectory_delta:${paceTrajectoryDelta}`,
    `projected_used:${projectedUsed}`,
    `source:${tokenomicsLimitSignatureText(row?.limit_source, row?.source)}`,
    `source_kind:${tokenomicsLimitSignatureText(row?.limit_source_kind)}`,
    `confidence:${tokenomicsLimitSignatureText(row?.confidence)}`,
    `plan:${tokenomicsLimitSignatureText(row?.plan_name)}`,
    `reset:${tokenomicsLimitResetSignature(row)}`,
    `active:${providerLimitUsesActiveAccount(row) ? "1" : "0"}`,
  ].join(";");
}

function tokenomicsLimitPercentSignature(summary = {}) {
  const limits = limitRowsForDisplay(summary);
  const limitSignature = mergeProviderLimits([], limits)
    .map(providerLimitSyncSignature)
    .filter(Boolean)
    .sort()
    .join("|");
  const samples = Array.isArray(summary?.limit_samples)
    ? summary.limit_samples
    : (Array.isArray(summary?.limitSamples) ? summary.limitSamples : []);
  const sampleSignature = mergeProviderLimitSamples([], samples)
    .map((row) => {
      const used = limitNumberOrNull(row?.used_percent, row?.limit_used_percent);
      if (used == null) return "";
      const paceDelta = tokenomicsLimitSignatureNumber(row?.pace_delta_percent);
      return [
        providerLimitSampleKey(row),
        `used:${Math.max(0, Math.min(100, Math.round(used)))}`,
        `pace:${tokenomicsLimitSignatureText(row?.pace_status)}`,
        `pace_delta:${paceDelta}`,
        `source:${tokenomicsLimitSignatureText(row?.limit_source, row?.source)}`,
        `confidence:${tokenomicsLimitSignatureText(row?.confidence)}`,
      ].join(";");
    })
    .filter(Boolean)
    .sort()
    .join("|");
  return [limitSignature, sampleSignature].filter(Boolean).join("|");
}

function dailyRollupMergeKey(row = {}) {
  return [
    bucketDayKey(row),
    rowDeviceId(row) || "unknown-device",
    rowScopeKey(row),
    providerKey(row),
    String(row?.agent_kind || ""),
    String(row?.model || ""),
    rowProviderAccountKey(row) || "unknown-account",
  ].join("\u001f");
}

function mergeDailyRollupRows(previousRows, nextRows) {
  const previous = Array.isArray(previousRows) ? previousRows : [];
  if (!Array.isArray(nextRows) || !nextRows.length) return previous;
  const merged = new Map();
  previous.forEach((row) => merged.set(dailyRollupMergeKey(row), row));
  nextRows.forEach((row) => merged.set(dailyRollupMergeKey(row), row));
  return [...merged.values()].sort((left, right) => bucketDayKey(right).localeCompare(bucketDayKey(left)));
}

function mergeTokenomicsSummary(previous, next) {
  if (!previous) return next || {};
  if (!next) return previous;
  const nextIsV2 = String(next.schema_version || "").toLowerCase() === "tokenomics_v2";
  const previousIsV2 = summaryIsTokenomicsV2(previous);
  const clearLegacyRows = nextIsV2 || previousIsV2;
  return {
    ...previous,
    ...next,
    total: next.total || previous.total,
    by_device: next.by_device || (clearLegacyRows ? undefined : previous.by_device),
    by_device_provider: next.by_device_provider || (clearLegacyRows ? undefined : previous.by_device_provider),
    by_device_account: next.by_device_account || (clearLegacyRows ? undefined : previous.by_device_account),
    by_device_model: next.by_device_model || (clearLegacyRows ? undefined : previous.by_device_model),
    daily_by_device_provider: next.daily_by_device_provider || (clearLegacyRows ? undefined : previous.daily_by_device_provider),
    monthly_by_device_provider: next.monthly_by_device_provider || (clearLegacyRows ? undefined : previous.monthly_by_device_provider),
    hourly: next.hourly || previous.hourly,
    sources: next.sources || previous.sources,
    limits: mergeProviderLimits(previous.limits, next.limits),
    limit_samples: mergeProviderLimitSamples(previous.limit_samples, next.limit_samples),
    device_identities: next.device_identities || previous.device_identities,
  };
}

function mergeTokenomicsSummaryDelta(previous, next) {
  if (!previous) return next || {};
  if (!next) return previous;
  const nextDaily = next.daily_by_device_provider;
  const mergedDaily = mergeDailyRollupRows(
    previous.daily_by_device_provider,
    nextDaily,
  );
  return {
    ...previous,
    schema_version: next.schema_version || previous.schema_version,
    updated_at: next.updated_at || previous.updated_at,
    daily_by_device_provider: mergedDaily,
  };
}

const tokenomicsStore = {
  account_key: TOKENOMICS_DEFAULT_ACCOUNT_KEY,
  loadedAccountKey: "",
  requestEpoch: 0,
  state: createTokenomicsStoreState(),
  loadedOnce: false,
  loadPromise: null,
  liveLimitsPromise: null,
  liveLimitsForcedRefreshQueued: false,
  liveLimitsLastAt: 0,
  hotTailPromise: null,
  hotTailLastAt: 0,
  summaryRefreshLastAt: 0,
  pollInterval: null,
  pollSubscriberCount: 0,
  warmScanEpoch: -1,
  limitPercentSignature: "",
  limitSyncInFlight: false,
  limitSyncPending: false,
  progressListenerPromise: null,
  progressUnlisten: null,
  updatedListenerPromise: null,
  updatedUnlisten: null,
  notifyFrame: 0,
  notifyTimer: 0,
  notifyVisibilityListening: false,
  notifiedStateSignature: "",
  subscribers: new Set(),
};

const tokenomicsSummaryNotifySignatureCache = new WeakMap();

function tokenomicsHashNotifyText(hash, value) {
  const text = String(value ?? "");
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next = Math.imul(next ^ text.charCodeAt(index), 16777619);
  }
  return next >>> 0;
}

function tokenomicsHashNotifyValue(hash, value) {
  if (Array.isArray(value)) {
    return value.reduce(
      (next, item) => tokenomicsHashNotifyValue(next, item),
      tokenomicsHashNotifyText(hash, `array:${value.length}`),
    );
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce(
      (next, key) => tokenomicsHashNotifyValue(tokenomicsHashNotifyText(next, key), value[key]),
      hash,
    );
  }
  return tokenomicsHashNotifyText(hash, value);
}

function tokenomicsProgressNotifySignature(progress) {
  if (!progress || typeof progress !== "object") return progress ? String(progress) : "";
  return [
    progress.phase,
    progress.provider,
    progress.agent_kind,
    progress.provider_account_key,
    progress.provider_account_label,
    progress.day_index,
    progress.day_total,
    progress.day_label,
    progress.files_scanned,
    progress.inserted_events,
    progress.day_files_scanned,
    progress.day_inserted_events,
    progress.candidate_count,
    progress.day_candidate_count,
    progress.cached,
    progress.mode,
  ].map((value) => String(value ?? "")).join("\u001f");
}

function tokenomicsSummaryNotifySignature(summary) {
  if (!summary || typeof summary !== "object") return "";
  const cached = tokenomicsSummaryNotifySignatureCache.get(summary);
  if (cached) return cached;
  const signature = tokenomicsHashNotifyValue(2166136261, summary).toString(36);
  tokenomicsSummaryNotifySignatureCache.set(summary, signature);
  return signature;
}

function tokenomicsSubscriberStateSignature(state = {}) {
  return [
    state.status,
    state.error,
    state.selectedProvider,
    state.selectedAccountKey,
    PROVIDER_ACCOUNT_FILTER_PROVIDERS
      .map((providerId) => `${providerId}:${accountKeyForProvider(state.selectedProviderAccountKeys, providerId)}`)
      .join("\u001e"),
    tokenomicsProgressNotifySignature(state.scanProgress),
    tokenomicsSummaryNotifySignature(state.summary),
  ].map((value) => String(value ?? "")).join("\u001f");
}

function stopTokenomicsNotifyVisibilityListener() {
  if (!tokenomicsStore.notifyVisibilityListening || typeof document === "undefined") {
    return;
  }
  document.removeEventListener("visibilitychange", handleTokenomicsNotifyVisibilityChange);
  tokenomicsStore.notifyVisibilityListening = false;
}

function moveTokenomicsNotifyToHiddenTimer() {
  if (typeof window === "undefined" || tokenomicsStore.notifyTimer || !tokenomicsStore.notifyFrame) {
    return false;
  }
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(tokenomicsStore.notifyFrame);
  }
  tokenomicsStore.notifyFrame = 0;
  stopTokenomicsNotifyVisibilityListener();
  tokenomicsStore.notifyTimer = window.setTimeout(flushTokenomicsSubscribers, TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS);
  return true;
}

function handleTokenomicsNotifyVisibilityChange() {
  if (typeof document !== "undefined" && document.hidden) {
    moveTokenomicsNotifyToHiddenTimer();
  }
}

function ensureTokenomicsNotifyVisibilityListener() {
  if (tokenomicsStore.notifyVisibilityListening || typeof document === "undefined") {
    return;
  }
  document.addEventListener("visibilitychange", handleTokenomicsNotifyVisibilityChange);
  tokenomicsStore.notifyVisibilityListening = true;
}

function flushTokenomicsSubscribers() {
  tokenomicsStore.notifyFrame = 0;
  tokenomicsStore.notifyTimer = 0;
  stopTokenomicsNotifyVisibilityListener();
  const signature = tokenomicsSubscriberStateSignature(tokenomicsStore.state);
  if (signature === tokenomicsStore.notifiedStateSignature) {
    return;
  }
  tokenomicsStore.notifiedStateSignature = signature;
  for (const subscriber of tokenomicsStore.subscribers) {
    subscriber(tokenomicsStore.state);
  }
}

function notifyTokenomicsSubscribers() {
  if (!tokenomicsStore.subscribers.size) {
    return;
  }
  if (typeof window === "undefined") {
    flushTokenomicsSubscribers();
    return;
  }
  const hidden = typeof document !== "undefined" && document.hidden;
  if (hidden && !tokenomicsStore.notifyTimer) {
    if (moveTokenomicsNotifyToHiddenTimer()) {
      return;
    }
    tokenomicsStore.notifyTimer = window.setTimeout(flushTokenomicsSubscribers, TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS);
    return;
  }
  if (tokenomicsStore.notifyFrame || tokenomicsStore.notifyTimer) {
    return;
  }
  if (typeof window.requestAnimationFrame !== "function") {
    tokenomicsStore.notifyTimer = window.setTimeout(
      flushTokenomicsSubscribers,
      hidden ? TOKENOMICS_HIDDEN_NOTIFY_DELAY_MS : 0,
    );
    return;
  }
  ensureTokenomicsNotifyVisibilityListener();
  tokenomicsStore.notifyFrame = window.requestAnimationFrame(flushTokenomicsSubscribers);
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
  if (tokenomicsStore.subscribers.size === 1 && !tokenomicsStore.notifyFrame && !tokenomicsStore.notifyTimer) {
    tokenomicsStore.notifiedStateSignature = tokenomicsSubscriberStateSignature(tokenomicsStore.state);
  }
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
  tokenomicsStore.limitSyncPending = true;
  if (tokenomicsStore.limitSyncInFlight) {
    return;
  }

  scheduleTokenomicsIdleTask(() => {
    if (!tokenomicsStore.limitSyncPending || tokenomicsStore.limitSyncInFlight) {
      return;
    }
    tokenomicsStore.limitSyncPending = false;
    tokenomicsStore.limitSyncInFlight = true;
    invoke("cloud_mcp_schedule_tokenomics_sync", {
      reason: TOKENOMICS_LIMIT_CLOUD_SYNC_REASON,
      full: false,
      resync_last_30_days: false,
    })
      .catch(() => {})
      .finally(() => {
        tokenomicsStore.limitSyncInFlight = false;
        if (tokenomicsStore.limitSyncPending) {
          scheduleTokenomicsLimitCloudSync();
        }
      });
  }, { delay_ms: 0, timeout: 1200 });
}

function mergeSummaryIntoTokenomicsStore(next, { syncLimitChanges = false } = {}) {
  let nextSignature = "";
  let shouldSyncLimits = false;
  tokenomicsStore.loadedAccountKey = tokenomicsStore.account_key;
  updateTokenomicsStore((previous) => ({
    summary: (() => {
      const merged = mergeTokenomicsSummary(previous.summary, next || {});
      const previousSignature = tokenomicsStore.limitPercentSignature || tokenomicsLimitPercentSignature(previous.summary);
      nextSignature = tokenomicsLimitPercentSignature(merged);
      shouldSyncLimits = Boolean(syncLimitChanges && nextSignature && previousSignature !== nextSignature);
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

function mergeSummaryDeltaIntoTokenomicsStore(next) {
  if (!next) return;
  tokenomicsStore.loadedAccountKey = tokenomicsStore.account_key;
  updateTokenomicsStore((previous) => ({
    summary: mergeTokenomicsSummaryDelta(previous.summary, next),
  }));
}

function resetTokenomicsStoreForAccount(accountKey) {
  const incomingAccountKey = String(accountKey || "").trim();
  if (!incomingAccountKey) {
    return;
  }

  const normalizedAccountKey = normalizeTokenomicsAccountKey(incomingAccountKey);
  if (tokenomicsStore.account_key === normalizedAccountKey) {
    return;
  }

  const currentAccountKey = String(tokenomicsStore.account_key || "").trim();
  const currentIsInitialAccount = !currentAccountKey || currentAccountKey === TOKENOMICS_DEFAULT_ACCOUNT_KEY;
  const loadedAccountKey = String(tokenomicsStore.loadedAccountKey || "").trim();
  const loadedForDifferentRealAccount = Boolean(
    loadedAccountKey
      && loadedAccountKey !== TOKENOMICS_DEFAULT_ACCOUNT_KEY
      && loadedAccountKey !== normalizedAccountKey,
  );

  if (currentIsInitialAccount && !loadedForDifferentRealAccount) {
    tokenomicsStore.account_key = normalizedAccountKey;
    if (tokenomicsStore.state.summary) {
      tokenomicsStore.loadedAccountKey = normalizedAccountKey;
    }
    return;
  }

  tokenomicsStore.account_key = normalizedAccountKey;
  tokenomicsStore.requestEpoch += 1;
  tokenomicsStore.loadedOnce = false;
  tokenomicsStore.loadedAccountKey = "";
  tokenomicsStore.loadPromise = null;
  tokenomicsStore.liveLimitsPromise = null;
  tokenomicsStore.liveLimitsForcedRefreshQueued = false;
  tokenomicsStore.liveLimitsLastAt = 0;
  tokenomicsStore.hotTailPromise = null;
  tokenomicsStore.hotTailLastAt = 0;
  tokenomicsStore.summaryRefreshLastAt = 0;
  tokenomicsStore.limitPercentSignature = "";
  tokenomicsStore.limitSyncPending = false;
  tokenomicsStore.warmScanEpoch = -1;
  tokenomicsStore.state = createTokenomicsStoreState();
  notifyTokenomicsSubscribers();
}

function ensureTokenomicsProgressListener() {
  if (!tokenomicsStore.progressUnlisten && !tokenomicsStore.progressListenerPromise) {
    tokenomicsStore.progressListenerPromise = listen(TOKENOMICS_SCAN_PROGRESS_EVENT, (event) => {
      const payload = event.payload || null;
      updateTokenomicsStore({ scanProgress: payload });
      if (payload?.summary) {
        mergeSummaryIntoTokenomicsStore(payload.summary);
      }
      const summaryDelta = payload?.summary_delta;
      if (summaryDelta) {
        mergeSummaryDeltaIntoTokenomicsStore(summaryDelta);
      }
    })
      .then((handler) => {
        if (tokenomicsStore.pollSubscriberCount <= 0) {
          handler();
          return;
        }
        tokenomicsStore.progressUnlisten = handler;
      })
      .catch(() => {})
      .finally(() => {
        tokenomicsStore.progressListenerPromise = null;
      });
  }

  if (!tokenomicsStore.updatedUnlisten && !tokenomicsStore.updatedListenerPromise) {
    tokenomicsStore.updatedListenerPromise = listen(TOKENOMICS_UPDATED_EVENT, () => {
      void refreshTokenomicsSummaryIfStale({ force: true });
    })
      .then((handler) => {
        if (tokenomicsStore.pollSubscriberCount <= 0) {
          handler();
          return;
        }
        tokenomicsStore.updatedUnlisten = handler;
      })
      .catch(() => {})
      .finally(() => {
        tokenomicsStore.updatedListenerPromise = null;
      });
  }
}

function stopTokenomicsProgressListener() {
  if (tokenomicsStore.progressUnlisten) {
    try {
      tokenomicsStore.progressUnlisten();
    } catch {
      // ignore
    }
    tokenomicsStore.progressUnlisten = null;
  }
  if (tokenomicsStore.updatedUnlisten) {
    try {
      tokenomicsStore.updatedUnlisten();
    } catch {
      // ignore
    }
    tokenomicsStore.updatedUnlisten = null;
  }
}

function refreshTokenomicsLiveLimits({ force = false, force_provider_refresh: forceProviderRefresh = false, syncLimitChanges = false } = {}) {
  const now = Date.now();
  const requestEpoch = tokenomicsStore.requestEpoch;
  if (tokenomicsStore.liveLimitsPromise) {
    if (forceProviderRefresh) {
      tokenomicsStore.liveLimitsForcedRefreshQueued = true;
      return tokenomicsStore.liveLimitsPromise.finally(() => {
        if (tokenomicsStore.requestEpoch !== requestEpoch || !tokenomicsStore.liveLimitsForcedRefreshQueued) {
          return tokenomicsStore.state.summary;
        }
        tokenomicsStore.liveLimitsForcedRefreshQueued = false;
        return refreshTokenomicsLiveLimits({
          force: true,
          force_provider_refresh: true,
          syncLimitChanges,
        });
      });
    }
    return tokenomicsStore.liveLimitsPromise;
  }
  if (!force && now - tokenomicsStore.liveLimitsLastAt < TOKENOMICS_LIVE_LIMIT_REFRESH_INTERVAL_MS) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }

  tokenomicsStore.liveLimitsLastAt = now;
  tokenomicsStore.liveLimitsPromise = invoke("tokenomics_get_live_limits", {
    force_provider_refresh: forceProviderRefresh,
  })
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

function refreshTokenomicsSummaryIfStale({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - tokenomicsStore.summaryRefreshLastAt < TOKENOMICS_SUMMARY_REFRESH_INTERVAL_MS) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }
  tokenomicsStore.summaryRefreshLastAt = now;
  return loadTokenomicsStore({ force: true, summaryOnly: true });
}

function refreshVisibleTokenomicsLimits({ force = false, force_provider_refresh: forceProviderRefresh = true } = {}) {
  return refreshTokenomicsLiveLimits({ force, force_provider_refresh: forceProviderRefresh, syncLimitChanges: true })
    .finally(() => {
      void refreshTokenomicsSummaryIfStale();
    });
}

function refreshTokenomicsHotTail({ force = false } = {}) {
  const now = Date.now();
  const requestEpoch = tokenomicsStore.requestEpoch;
  if (tokenomicsStore.hotTailPromise) {
    return tokenomicsStore.hotTailPromise;
  }
  if (!force && now - tokenomicsStore.hotTailLastAt < TOKENOMICS_HOT_TAIL_REFRESH_INTERVAL_MS) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }

  tokenomicsStore.hotTailLastAt = now;
  tokenomicsStore.hotTailPromise = invoke("tokenomics_scan_realtime_usage")
    .then((next) => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        mergeSummaryIntoTokenomicsStore(next || {});
      }
      return tokenomicsStore.state.summary;
    })
    .catch(() => tokenomicsStore.state.summary)
    .finally(() => {
      if (tokenomicsStore.requestEpoch === requestEpoch) {
        tokenomicsStore.hotTailPromise = null;
      }
    });
  return tokenomicsStore.hotTailPromise;
}

function loadTokenomicsStore({
  background = false,
  force = false,
  resync = false,
  scan = false,
  summaryOnly = false,
} = {}) {
  const forceResync = Boolean(resync);
  if (forceResync) {
    tokenomicsStore.requestEpoch += 1;
    tokenomicsStore.loadPromise = null;
    tokenomicsStore.liveLimitsPromise = null;
  }
  const hasSummary = Boolean(tokenomicsStore.state.summary);
  const shouldScan = !summaryOnly && Boolean(scan || forceResync || !tokenomicsStore.loadedOnce);
  const requestEpoch = tokenomicsStore.requestEpoch;

  if (tokenomicsStore.loadPromise) {
    return tokenomicsStore.loadPromise;
  }
  if (!force && summaryOnly && hasSummary) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }
  if (!force && !shouldScan && tokenomicsStore.loadedOnce && hasSummary) {
    return Promise.resolve(tokenomicsStore.state.summary);
  }

  updateTokenomicsStore((previous) => ({
    error: "",
    scanProgress: shouldScan ? null : previous.scanProgress,
    status: background && previous.summary
      ? "ready"
      : shouldScan
        ? "scanning"
        : (previous.summary ? "ready" : "loading"),
  }));

  tokenomicsStore.loadPromise = (async () => {
    try {
      if (shouldScan) {
        void refreshTokenomicsLiveLimits({
          force: true,
          force_provider_refresh: true,
          syncLimitChanges: true,
        });
      }

      const next = forceResync
        ? await invoke("tokenomics_resync_last_30_days")
        : summaryOnly
          ? await invoke("tokenomics_get_summary")
          : shouldScan
            ? await invoke("tokenomics_scan_usage")
            : await invoke("tokenomics_get_summary");
      if (tokenomicsStore.requestEpoch !== requestEpoch) {
        return tokenomicsStore.state.summary;
      }
      tokenomicsStore.loadedOnce = true;
      tokenomicsStore.loadedAccountKey = tokenomicsStore.account_key;
      if (summaryOnly) {
        tokenomicsStore.summaryRefreshLastAt = Date.now();
      }
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

export function warmAccountTokenomics({ account_key: accountKey = "", scan = false } = {}) {
  resetTokenomicsStoreForAccount(accountKey);
  const requestEpoch = tokenomicsStore.requestEpoch;
  const summaryPromise = loadTokenomicsStore({
    background: true,
    force: false,
    summaryOnly: true,
  });

  if (scan && tokenomicsStore.warmScanEpoch !== requestEpoch) {
    tokenomicsStore.warmScanEpoch = requestEpoch;
    summaryPromise.finally(() => {
      scheduleTokenomicsIdleTask(() => {
        if (tokenomicsStore.requestEpoch !== requestEpoch) {
          return;
        }
        void loadTokenomicsStore({
          background: true,
          force: true,
          scan: true,
        }).finally(() => {
          if (tokenomicsStore.requestEpoch === requestEpoch) {
            void refreshTokenomicsLiveLimits({
              force: true,
              force_provider_refresh: true,
              syncLimitChanges: true,
            });
          }
        });
      }, { delay_ms: 120, timeout: 1500 });
    });
  }

  return summaryPromise;
}

function startTokenomicsViewPolling() {
  ensureTokenomicsProgressListener();
  tokenomicsStore.pollSubscriberCount += 1;
  let disposed = false;
  const refreshVisibleTokenomics = ({ force = false, force_provider_refresh: forceProviderRefresh = false } = {}) => {
    if (disposed) return;
    void refreshVisibleTokenomicsLimits({ force, force_provider_refresh: forceProviderRefresh });
  };
  // Tokenomics is DEVICE-level state: view activation (workspace switches
  // re-activate the keep-alive Tokens tab) must only subscribe and render the
  // cached store. The shared interval below + focus/visibility listeners +
  // rust push events own freshness; force-refreshing here made every
  // workspace open pay account-level provider HTTP + a multi-MB summary.
  refreshVisibleTokenomics({ force: false });
  // Summary staleness check rides idle so it can never land inside the
  // activation window; the 5-minute guard makes repeated activations free.
  {
    const deferSummaryRefresh = () => {
      if (disposed) return;
      // Idle callbacks can land inside a workspace-activation window (opens
      // have idle gaps between commits). Re-defer while an activation is
      // recent so the multi-MB summary parse never competes with an open.
      const mark = window.__DF_LAST_ACTIVATION_MARK;
      const msSinceActivation = mark ? performance.now() - Number(mark.t || 0) : Infinity;
      if (msSinceActivation < 3000) {
        window.setTimeout(deferSummaryRefresh, 3000);
        return;
      }
      void refreshTokenomicsSummaryIfStale();
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(deferSummaryRefresh, { timeout: 4000 });
    } else {
      window.setTimeout(deferSummaryRefresh, 1500);
    }
  }
  window.addEventListener("focus", refreshVisibleTokenomics);
  document.addEventListener("visibilitychange", refreshVisibleTokenomics);

  if (!tokenomicsStore.pollInterval) {
    // The shared interval must not close over any one subscriber's disposed
    // flag: with multiple mounted views (route view + kept-alive tool panel),
    // the first subscriber unmounting would otherwise leave a permanently
    // no-op interval behind for the survivors. Its lifetime is already gated
    // by pollSubscriberCount below.
    tokenomicsStore.pollInterval = window.setInterval(() => {
      void refreshVisibleTokenomicsLimits({ force: false, force_provider_refresh: false });
    }, TOKENOMICS_VIEW_POLL_INTERVAL_MS);
  }

  return () => {
    disposed = true;
    window.removeEventListener("focus", refreshVisibleTokenomics);
    document.removeEventListener("visibilitychange", refreshVisibleTokenomics);
    tokenomicsStore.pollSubscriberCount = Math.max(0, tokenomicsStore.pollSubscriberCount - 1);
    if (tokenomicsStore.pollSubscriberCount === 0 && tokenomicsStore.pollInterval) {
      window.clearInterval(tokenomicsStore.pollInterval);
      tokenomicsStore.pollInterval = null;
    }
    if (tokenomicsStore.pollSubscriberCount === 0) {
      stopTokenomicsProgressListener();
    }
  };
}

function tokenomicsLoadingLabel(status, summary, progress) {
  const phase = String(progress?.phase || "");
  if (phase === "limits_ready") return "Updating live limits";
  if (phase === "realtime_current_day") return "Updating today";
  if (phase === "day_complete") return "Updated usage day";
  if (phase === "complete") return "Finalizing usage";
  if (phase === "catch_up") return "Catching up usage";
  if (phase === "day_start" || phase === "backfill_start") return "Scanning usage by day";
  return status === "scanning" ? "Scanning usage" : "Loading usage";
}

function tokenomicsLoadingDetail(progress) {
  const dayIndex = numeric(progress?.day_index);
  const dayTotal = numeric(progress?.day_total);
  const dayLabel = String(progress?.day_label || "").trim();
  const files = numeric(progress?.files_scanned);
  const events = numeric(progress?.inserted_events);
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
  const displayPercent = limit.display_percent;
  const displayKind = limit.display_percent_kind || "used";
  const paceDelta = limitNumberOrNull(limit.paceDelta);
  const paceText = paceDelta == null
    ? "No data"
    : `${paceDelta > 0 ? "▲" : "▼"}${Math.abs(paceDelta)}%`;
  const paceMultiplier = paceMultiplierFromDelta(paceDelta);
  const paceMultiplierText = paceMultiplier == null ? "" : formatPaceMultiplier(paceMultiplier);
  const progressLabel = displayKind === "remaining" ? `${title} remaining` : `${title} used`;
  return (
    <LimitCard tone={statusTone(limit.remaining_percent, limit.paceDelta, limit.pace_status)}>
      <MetricHeading>
        <MetricName>
          <Icon aria-hidden="true" />
          <span>{title}</span>
        </MetricName>
        <MetricScore>
          <strong>{displayPercent == null ? "—" : `${displayPercent}%`}</strong>
          <span>{paceText}</span>
        </MetricScore>
      </MetricHeading>
      <ProgressTrack aria-label={progressLabel}>
        <ProgressFill
          $empty={displayPercent == null}
          $tone={limitPercentTone(displayPercent, displayKind)}
          style={{ width: `${displayPercent ?? 0}%` }}
        />
      </ProgressTrack>
      <MetricFoot>
        <span>{limit.reset_label}</span>
        <strong>
          {paceMultiplierText ? (
            <PaceMultiplier
              title={`Current pace ${paceMultiplierText}`}
            >
              [{paceMultiplierText}]
            </PaceMultiplier>
          ) : null}
          {limit.status_label}
        </strong>
      </MetricFoot>
    </LimitCard>
  );
}

function ProviderLimitGroup({ five_hour: fiveHour, provider_id: providerId, weekly }) {
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

const AccountTokenomicsView = memo(function AccountTokenomicsView({
  account_key: accountKey = "",
  active = true,
  billing_status: billingStatus = null,
  storage_usage: storageUsage = null,
} = {}) {
  const [{
    summary,
    status,
    error,
    selectedProvider,
    selectedProviderAccountKeys,
    selectedAccountKey: legacySelectedAccountKey,
    scanProgress,
  }, setTokenomicsState] = useState(() => tokenomicsStore.state);
  const [dailyWindowDays, setDailyWindowDays] = useState(TOKENOMICS_DEFAULT_DAILY_WINDOW_DAYS);
  const [usageRateWindowKind, setUsageRateWindowKind] = useState("5_hour");
  const { accounts: agentAccounts } = useAgentAccountsState(active);
  const agentCredentialSignature = useMemo(
    () => tokenomicsAgentCredentialSignature(agentAccounts),
    [agentAccounts],
  );
  const lastAgentCredentialSignatureRef = useRef("");

  const refresh = useCallback(async ({ scan = false, resync = false } = {}) => {
    await loadTokenomicsStore({ scan, force: true, resync });
  }, []);
  const isScanning = status === "scanning";

  const setSelectedProvider = useCallback((provider) => {
    updateTokenomicsStore({ selectedProvider: provider });
  }, []);

  // The provider filter buttons were removed — the three color-coded provider
  // rows always render, so pin any persisted store filter back to "all".
  useEffect(() => {
    if (!active) {
      return;
    }
    setSelectedProvider("all");
  }, [active, setSelectedProvider]);

  const setSelectedProviderAccountKey = useCallback((providerId, nextAccountKey) => {
    updateTokenomicsStore((previous) => ({
      selectedProviderAccountKeys: {
        ...normalizeProviderAccountKeys(previous.selectedProviderAccountKeys, previous.selectedAccountKey),
        [providerId]: normalizeProviderAccountKey(nextAccountKey),
      },
      selectedAccountKey: "all",
    }));
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    resetTokenomicsStoreForAccount(accountKey);
    void refreshVisibleTokenomicsLimits({ force: true, force_provider_refresh: true });
    void loadTokenomicsStore({ background: true, force: false, summaryOnly: true });
  }, [accountKey, active]);

  useLayoutEffect(() => {
    if (active) {
      setTokenomicsState(tokenomicsStore.state);
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setTokenomicsState(tokenomicsStore.state);
    const unsubscribeStore = subscribeTokenomicsStore(setTokenomicsState);
    const stopPolling = startTokenomicsViewPolling();
    return () => {
      stopPolling();
      unsubscribeStore();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (!agentCredentialSignature) return;
    const previousSignature = lastAgentCredentialSignatureRef.current;
    lastAgentCredentialSignatureRef.current = agentCredentialSignature;
    if (!previousSignature || previousSignature === agentCredentialSignature) return;
    void refreshTokenomicsLiveLimits({
      force: true,
      force_provider_refresh: true,
      syncLimitChanges: true,
    }).finally(() => {
      void refreshTokenomicsSummaryIfStale({ force: true });
    });
  }, [active, agentCredentialSignature]);

  const visibleSummary = useMemo(
    () => (summary
      ? canonicalizeTokenomicsAccountSummary(summaryForMappedNativeDevices(summary), agentAccounts)
      : null),
    [agentAccounts, summary],
  );
  // Cloud sync is intentionally ignored on this client, so Tokenomics always
  // renders the local device only. There is no device picker: the device filter
  // is pinned to this machine's id (falling back to "all" before the current
  // device id is known, which is local-only data anyway).
  const localDeviceId = String(
    visibleSummary?.current_device_id || "",
  ).trim();
  const selectedDeviceId = localDeviceId || "all";
  const providers = providerRowsForDisplay(visibleSummary);
  const modelRows = modelRowsForDisplay(visibleSummary);
  const providerRows = providers;
  const selectedScopeKey = "all";
  const providerAccountKeys = useMemo(
    () => normalizeProviderAccountKeys(selectedProviderAccountKeys, legacySelectedAccountKey),
    [legacySelectedAccountKey, selectedProviderAccountKeys],
  );
  const selectedAccountFilter = useMemo(() => (
    selectedProvider === "all"
      ? providerAccountKeys
      : accountKeyForProvider(providerAccountKeys, selectedProvider)
  ), [providerAccountKeys, selectedProvider]);
  const accountOptionsByProvider = useMemo(
    () => providerAccountOptionsByProvider(visibleSummary, selectedDeviceId, selectedScopeKey, agentAccounts),
    [agentAccounts, visibleSummary, selectedDeviceId, selectedScopeKey],
  );
  const accountOptionGroups = useMemo(
    () => providerAccountOptionGroups(accountOptionsByProvider, selectedProvider),
    [accountOptionsByProvider, selectedProvider],
  );
  useEffect(() => {
    let nextKeys = null;
    for (const providerId of PROVIDER_ACCOUNT_FILTER_PROVIDERS) {
      const selectedKey = accountKeyForProvider(providerAccountKeys, providerId);
      if (selectedProvider === "all" && selectedKey === TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE) {
        continue;
      }
      const options = accountOptionsByProvider[providerId] || [];
      if (selectedKey !== "all" && !options.some((option) => option.key === selectedKey)) {
        nextKeys = nextKeys || { ...providerAccountKeys };
        nextKeys[providerId] = "all";
      }
    }
    if (nextKeys) {
      updateTokenomicsStore({ selectedProviderAccountKeys: nextKeys, selectedAccountKey: "all" });
    }
  }, [accountOptionsByProvider, providerAccountKeys, selectedProvider]);
  const dailyRaw = dailyRowsForDisplay(visibleSummary);
  const hourlyRaw = hourlyRowsForDisplay(visibleSummary);
  const limitRowsRaw = useMemo(() => limitRowsForDisplay(visibleSummary), [visibleSummary]);
  const limitSamplesRaw = Array.isArray(visibleSummary?.limit_samples)
    ? visibleSummary.limit_samples
    : (Array.isArray(visibleSummary?.limitSamples) ? visibleSummary.limitSamples : []);
  const dailyRows = useMemo(
    () => buildDailyRows(dailyRaw, limitSamplesRaw, limitRowsRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey, dailyWindowDays),
    [dailyRaw, dailyWindowDays, limitRowsRaw, limitSamplesRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const today = useMemo(
    () => todayAggregate(dailyRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey),
    [dailyRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const last30Days = useMemo(
    () => rollingWindowAggregate(dailyRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey),
    [dailyRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const deviceAccountRows = accountRowsForDisplay(visibleSummary);
  const totalRows = accountFilterIsAll(selectedProvider, selectedAccountFilter) ? providerRows : deviceAccountRows;
  const total = useMemo(
    () => aggregateRows(filterRows(totalRows, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey)),
    [selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey, totalRows],
  );
  const selectedLimitAccountFilter = useMemo(
    () => {
      if (selectedProvider === "all") {
        return PROVIDER_ACCOUNT_FILTER_PROVIDERS.reduce((acc, providerId) => {
          acc[providerId] = limitAccountKeyForDisplay(
            limitRowsRaw,
            providerId,
            accountKeyForProvider(providerAccountKeys, providerId),
            selectedScopeKey,
            selectedDeviceId,
          );
          return acc;
        }, {});
      }
      return limitAccountKeyForDisplay(
        limitRowsRaw,
        selectedProvider,
        accountKeyForProvider(providerAccountKeys, selectedProvider),
        selectedScopeKey,
        selectedDeviceId,
      );
    },
    [limitRowsRaw, providerAccountKeys, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  const limits = useMemo(
    () => filterLimits(limitRowsRaw, selectedProvider, selectedLimitAccountFilter, selectedScopeKey, selectedDeviceId),
    [limitRowsRaw, selectedDeviceId, selectedLimitAccountFilter, selectedProvider, selectedScopeKey],
  );
  const fiveHour = useMemo(() => mergeLimits(limits, "5_hour"), [limits]);
  const weekly = useMemo(() => mergeLimits(limits, "weekly"), [limits]);
  const usageRateLimit = usageRateWindowKind === "weekly" ? weekly : fiveHour;
  const sessionUsageRows = useMemo(
    () => usageRateRowsFromLimit(usageRateLimit, hourlyRaw, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey),
    [hourlyRaw, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey, usageRateLimit],
  );
  const sessionUsageBarWidth = usageRateBarWidth(sessionUsageRows.length);
  const sessionUsageLabels = usageRateAxisLabels(sessionUsageRows, usageRateWindowKind);
  const maxSessionUsage = Math.max(1, ...sessionUsageRows.map((row) => row.total));
  const activeSessionRows = sessionUsageRows.filter((row) => row.total > 0);
  const averageSessionUsage = activeSessionRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, activeSessionRows.length);
  const maxDaily = Math.max(1, ...dailyRows.map((row) => dailyUsageValue(row)));
  const breakdown = useMemo(
    () => modelBreakdown(modelRows, selectedProvider, selectedAccountFilter, selectedDeviceId, selectedScopeKey),
    [modelRows, selectedAccountFilter, selectedDeviceId, selectedProvider, selectedScopeKey],
  );
  // Credits precedence: the auth/billing snapshot seeds the widget immediately
  // (pre-websocket); later live/hot snapshots only update the display when
  // they are themselves meaningful/known. The last good wallet is kept in a
  // ref so a transient empty/unknown snapshot can never flicker the widget
  // back to 0 — while a genuine known:true zeroed balance still shows 0.
  const displayedCreditsRef = useRef({
    accountKey: "",
    awaitingBillingStatus: false,
    billingStatus: null,
    credits: null,
  });
  const displayedCreditsState = useMemo(
    () => resolveAccountDisplayedCreditWalletState(
      displayedCreditsRef.current,
      accountKey,
      billingStatus,
    ),
    [accountKey, billingStatus],
  );
  useLayoutEffect(() => {
    displayedCreditsRef.current = displayedCreditsState;
  }, [displayedCreditsState]);
  const credits = displayedCreditsState.credits;
  // OpenCode is intentionally excluded from live limit gauges — OpenCode Go has
  // no usage API, and users track spend via their own plugins. OpenCode usage is
  // surfaced through the token-usage charts/account cards below, not estimates.
  const providerLimitGroups = useMemo(() => (
    ["codex", "claude"].map((providerId) => {
      const providerAccountKey = limitAccountKeyForDisplay(
        limitRowsRaw,
        providerId,
        accountKeyForProvider(providerAccountKeys, providerId),
        selectedScopeKey,
        selectedDeviceId,
      );
      const providerLimits = filterLimits(limitRowsRaw, providerId, providerAccountKey, selectedScopeKey, selectedDeviceId);
      return {
        provider_id: providerId,
        five_hour: mergeLimits(providerLimits, "5_hour"),
        weekly: mergeLimits(providerLimits, "weekly"),
      };
    })
  ), [limitRowsRaw, providerAccountKeys, selectedDeviceId, selectedScopeKey]);
  const storage = useMemo(
    () => storageUsageModel(billingStatus, storageUsage),
    [billingStatus, storageUsage],
  );

  return (
    <TokenomicsShell>
      <TokenomicsPanel>
        {accountOptionGroups.length > 0 ? (
          <ProviderAccountRows aria-label="Provider account filters">
            {accountOptionGroups.map((group) => (
              <ProviderAccountRow key={group.provider_id}>
                <AccountTabs role="tablist" aria-label={`${group.label} filter`}>
                  {group.options.map((account) => {
                    const active = accountKeyForProvider(providerAccountKeys, group.provider_id) === account.key;
                    const title = active && account.activeTitle ? account.activeTitle : (account.title || account.label);
                    return (
                      <AccountTab
                        aria-label={account.iconOnly ? title : undefined}
                        key={account.key}
                        $active={active}
                        $iconOnly={account.iconOnly}
                        $provider={group.provider_id}
                        onClick={() => setSelectedProviderAccountKey(
                          group.provider_id,
                          active && account.key === TOKENOMICS_PROVIDER_ACCOUNT_FILTER_NONE ? "all" : account.key,
                        )}
                        role="tab"
                        title={title}
                        type="button"
                      >
                        {account.iconOnly ? <FilterListOff aria-hidden="true" /> : account.label}
                      </AccountTab>
                    );
                  })}
                </AccountTabs>
              </ProviderAccountRow>
            ))}
          </ProviderAccountRows>
        ) : null}

        {error ? <TokenomicsError>{error}</TokenomicsError> : null}

        {status !== "ready" && !visibleSummary ? (
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
                key={group.provider_id}
                five_hour={group.five_hour}
                provider_id={group.provider_id}
                weekly={group.weekly}
              />
            ))}
          </ProviderLimitGrid>
        ) : selectedProvider === "opencode" ? null : (
          <>
            <PlanStatusLine>
              <strong>{planStatusTitle(fiveHour, selectedProvider)}</strong>
              <span>{limitSourceText(fiveHour)}</span>
            </PlanStatusLine>
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
              <ModelRow
                $provider={PROVIDER_ACCOUNT_FILTER_PROVIDERS.includes(String(item.label || "").toLowerCase())
                  ? String(item.label).toLowerCase()
                  : undefined}
                key={item.label}
              >
                <span>{item.label}</span>
                <strong>{item.percent}%</strong>
              </ModelRow>
            )) : (
              <TokenomicsEmpty>Usage populates automatically after using Codex, Claude Code, or OpenCode.</TokenomicsEmpty>
            )}
          </ModelList>
        </UsageCard>

        <CreditsCard>
          <CreditsTitle>
            <span>Diff Forge Credits</span>
            <strong>{credits?.plan_name || "Plan"}</strong>
          </CreditsTitle>
          <CreditsGrid>
            <CreditMetric>
              <span>Used</span>
              <strong>{credits ? formatCredits(credits.term_used_credits) : "—"}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Remaining</span>
              <strong>{credits ? formatCredits(credits.term_remaining_credits) : "—"}</strong>
            </CreditMetric>
            <CreditMetric>
              <span>Reserved</span>
              <strong>{credits ? formatCredits(credits.term_reserved_credits) : "—"}</strong>
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

        <AgentAccountsManager active={active} />

        <TokenomicsFooter>
          <span>{lastUpdatedText(summary?.updated_at)}</span>
          <TokenomicsRescanButton
            disabled={isScanning}
            onClick={() => {
              void refresh({ resync: true });
            }}
            title="Rescan token usage"
            type="button"
          >
            <TokenomicsRescanIcon aria-hidden="true" data-spinning={isScanning ? "true" : undefined} />
            <span>{isScanning ? "Scanning" : "Rescan"}</span>
          </TokenomicsRescanButton>
        </TokenomicsFooter>
      </TokenomicsPanel>
    </TokenomicsShell>
  );
});

export default AccountTokenomicsView;

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
    radial-gradient(circle at 50% 0%, rgba(var(--forge-tint-rgb), 0.06), transparent 38%),
    linear-gradient(180deg, #05080d, #020304 68%, #05080d);

  &,
  * {
    box-sizing: border-box;
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
    background:
      radial-gradient(circle at 50% 0%, rgba(var(--forge-tint-rgb), 0.1), transparent 34%),
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

const ProviderAccountRows = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
`;

const ProviderAccountRow = styled.div`
  display: block;
  min-width: 0;
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

/* Pill design mirrors the web dashboard's provider account filter rows
   (UsageAccountTab in next-diffforge dashboard.js): fully round pills, the
   provider accent carried by the active pill's ring + text, neutral dark
   pills otherwise, and a compact 32px icon-only exclude pill per row. */
const AccountTab = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: ${({ $iconOnly }) => ($iconOnly ? "center" : "flex-start")};
  gap: 6px;
  flex: 0 0 auto;
  width: ${({ $iconOnly }) => ($iconOnly ? "32px" : "auto")};
  min-width: ${({ $iconOnly }) => ($iconOnly ? "32px" : "0")};
  max-width: 200px;
  min-height: 26px;
  padding: ${({ $iconOnly }) => ($iconOnly ? "0" : "0 8px")};
  border: 1px solid ${({ $active, $provider }) => ($active ? providerAccent($provider) : "rgba(148, 163, 184, 0.16)")};
  border-radius: 999px;
  color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#94a3b8")};
  background: ${({ $active, $provider }) => ($active
    ? `color-mix(in srgb, ${providerAccent($provider)} 14%, rgba(16, 21, 28, 0.74))`
    : "rgba(16, 21, 28, 0.48)")};
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 130ms ease, border-color 130ms ease;

  svg {
    width: 14px;
    height: 14px;
    flex: none;
  }

  &:hover {
    border-color: ${({ $provider }) => providerAccent($provider)};
    color: #ffffff;
  }

  html[data-forge-theme="light"] & {
    border-color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "rgba(71, 85, 105, 0.2)")};
    color: ${({ $active, $provider }) => ($active ? providerAccent($provider) : "#475569")};
    background: ${({ $active, $provider }) => ($active ? `color-mix(in srgb, ${providerAccent($provider)} 10%, #ffffff)` : "#f8fafc")};

    &:hover {
      color: #0f172a;
    }
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
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.2);
  border-radius: 8px;
  color: #9fb2cc;
  background: rgba(var(--forge-tint-rgb), 0.08);
  font-size: 11px;
  font-weight: 900;

  span {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    border: 2px solid rgba(var(--forge-tint-soft-rgb), 0.18);
    border-top-color: var(--forge-tint-soft);
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
    border-color: rgba(var(--forge-tint-rgb), 0.16);
    background: rgba(var(--forge-tint-rgb), 0.07);
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
  font-size: 13px;
  font-weight: 800;

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
  color: #7a8493;
  font-size: clamp(9px, 2.2vw, 10.5px);
  font-weight: 700;

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

const LimitCard = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background: #0d1117;
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
  color: #f4f7fa;
  font-size: clamp(12px, 3.1vw, 13px);
  font-weight: 750;

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
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #1b2330;

  html[data-forge-theme="light"] & {
    background: rgba(15, 23, 42, 0.12);
  }

  @container (max-width: 450px) {
    height: 5px;
  }
`;

const ProgressFill = styled.div`
  height: 100%;
  min-width: ${({ $empty }) => ($empty ? "0" : "7px")};
  border-radius: inherit;
  --bar-tone: ${({ $tone }) => toneColor($tone)};
  background: var(--bar-tone);
`;

const MetricFoot = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: #7a8493;
  font-size: clamp(9px, 2.5vw, 10.5px);
  font-weight: 650;

  @container (max-width: 450px) {
    gap: 6px;
    font-size: 9px;
    line-height: 1.15;
  }

  span {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: visible;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  strong {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 62%;
    overflow: visible;
    color: var(--tone);
    font-weight: 750;
    line-height: 1.15;
    text-align: right;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const PaceMultiplier = styled.b`
  display: inline-block;
  margin-right: 4px;
  color: currentColor;
  font-weight: 950;
`;

const ChartCard = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background: #0d1117;
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
    stroke: var(--forge-tint-soft);
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
    fill: rgba(var(--forge-tint-rgb), 0.36);
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
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.18);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.16);
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
  color: ${({ $active }) => ($active ? "var(--forge-tint-soft)" : "#738196")};
  background: ${({ $active }) => ($active ? "rgba(var(--forge-tint-rgb), 0.20)" : "transparent")};
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  cursor: pointer;

  &:hover {
    color: #e5eefb;
  }

  html[data-forge-theme="light"] & {
    color: ${({ $active }) => ($active ? "var(--forge-tint)" : "#64748b")};
    background: ${({ $active }) => ($active ? "rgba(var(--forge-tint-rgb), 0.12)" : "transparent")};

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
  box-shadow: ${({ $tone }) => {
    if (!$tone || $tone === "quiet") return "none";
    if ($tone === "danger") return "0 0 18px rgba(255, 90, 95, 0.16)";
    if ($tone === "warn") return "0 0 18px rgba(250, 204, 21, 0.16)";
    return "0 0 18px rgba(96, 165, 250, 0.16)";
  }};
`;

const UsageCard = styled.div`
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--forge-tint-rgb), 0.07), transparent 36%),
    #0d1117;

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.15);
    background:
      radial-gradient(circle at 0% 0%, rgba(var(--forge-tint-rgb), 0.08), transparent 36%),
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
    color: ${({ $provider }) => ($provider ? providerAccent($provider) : "inherit")};
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
  border-radius: 11px;
  background:
    radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.07), transparent 34%),
    #0d1117;

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
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 11px;
  background:
    radial-gradient(circle at 100% 0%, rgba(52, 211, 153, 0.06), transparent 34%),
    #0d1117;

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.14);
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
    color: var(--forge-tint-soft);
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

const tokenomicsRescanSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
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

const TokenomicsRescanButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 24px;
  padding: 4px 9px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.28);
  border-radius: 999px;
  color: var(--forge-tint-soft);
  background: rgba(var(--forge-tint-rgb), 0.1);
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    color 120ms ease,
    opacity 120ms ease;

  &:hover:not(:disabled) {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
    color: #e5eefb;
    background: rgba(var(--forge-tint-rgb), 0.18);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-tint-soft-rgb), 0.72);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.72;
    cursor: default;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(var(--forge-tint-rgb), 0.25);
    color: var(--forge-tint);
    background: rgba(var(--forge-tint-rgb), 0.08);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    color: var(--forge-tint);
    background: rgba(var(--forge-tint-rgb), 0.15);
  }
`;

const TokenomicsRescanIcon = styled(Refresh)`
  width: 13px;
  height: 13px;
  flex: none;

  &[data-spinning="true"] {
    animation: ${tokenomicsRescanSpin} 850ms linear infinite;
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
