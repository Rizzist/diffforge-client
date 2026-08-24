import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Add } from "@styled-icons/material-rounded/Add";
import { Close } from "@styled-icons/material-rounded/Close";
import { Edit } from "@styled-icons/material-rounded/Edit";
import {
  accountAuthMethodLabel,
  accountListPresentation,
  credentialStatus,
  providerAuthOptions,
} from "../sessions/haiderClientContract.js";

/* Harness-owned account management (936 account_* doors). The daemon's vault
   is the single credential authority for every surface — this view LISTS,
   ADDS (API key + OAuth), IMPORTS, SWITCHES, and REMOVES through RPC doors
   and never sees a secret back. List freshness is poll-by-revision until the
   watch door lands (937 delta). */

const LIST_POLL_MS = 5000;
/* Matches the daemon's bound; it truncates rather than rejecting, so holding
   the same limit here means the user learns at the keystroke. */
const LABEL_MAX = 64;
const OAUTH_POLL_MS = 1500;

/* Sources this build shipped knowing about. The daemon owns the real catalog
   (account_oauth_import_sources_v1); this list is the floor for daemons that
   predate it, and it is exactly how grok-cli went a release with no import
   path at all while these three looked complete. */
const LEGACY_IMPORT_SOURCES = [
  { source: "codex", available: true },
  { source: "claude-code", available: true },
  { source: "kimi-code", available: true },
];

/* Display spelling only — the catalog decides what exists, this decides how a
   known name is capitalized, and anything new still renders readably. */
const IMPORT_SOURCE_LABELS = {
  codex: "Codex CLI",
  "claude-code": "Claude Code",
  "kimi-code": "Kimi Code",
  "grok-cli": "Grok CLI",
};

function importSourceLabel(source) {
  const known = IMPORT_SOURCE_LABELS[source];
  if (known) {
    return known;
  }
  return String(source || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (
      word.toLowerCase() === "cli"
        ? "CLI"
        : word.charAt(0).toUpperCase() + word.slice(1)
    ))
    .join(" ");
}

const STATUS_LABELS = {
  ok: "ok",
  limited: "limited",
  expired: "expired",
  revoked: "revoked",
  needs_attention: "needs attention",
};

/* Direct-CLI terminal logins (codex/claude/opencode), captured from the
   profile dirs by the Rust watcher. Separate from the harness vault: these
   authenticate raw CLI terminals, not harness sessions. */
const CLI_KINDS = [
  { kind: "claude", label: "Claude Code" },
  { kind: "codex", label: "Codex" },
  { kind: "opencode", label: "OpenCode" },
];

/* One machine login can appear under several profile ids; the email is the
   identity, so fold duplicates and let an active row win. */
function collapseProfilesByEmail(profiles) {
  const byEmail = new Map();
  const visible = [];
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const email = String(profile?.identity?.email || profile?.email || "").trim().toLowerCase();
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
    if (profile?.is_active && !existing.is_active) {
      const index = visible.indexOf(existing);
      const merged = { ...profile, alias: profile.alias || existing.alias };
      if (index >= 0) visible[index] = merged;
      byEmail.set(email, merged);
    }
  }
  return visible;
}

function CliProfilesSection() {
  const [agents, setAgents] = useState(null);
  const [error, setError] = useState("");
  const [pendingKind, setPendingKind] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const pendingRef = useRef("");
  const pendingTimerRef = useRef(null);

  const refresh = useCallback(() => {
    invoke("agent_accounts_state")
      .then((state) => setAgents(state?.agents || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    /* Logins inside profile dirs change identity without emitting an event,
       so a slow poll backs up the capture watcher. */
    const timer = window.setInterval(refresh, 6000);
    return () => {
      window.clearInterval(timer);
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
    };
  }, [refresh]);

  /* Logging in opens a terminal and finishes out of band — hold the kind
     busy briefly so the row reads as pending, and let the watcher settle. */
  const holdPending = useCallback((kind) => {
    pendingRef.current = kind;
    setPendingKind(kind);
    if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => {
      pendingRef.current = "";
      setPendingKind("");
    }, 30000);
  }, []);

  const beginLogin = useCallback((kind) => {
    if (pendingRef.current) return;
    setError("");
    holdPending(kind);
    invoke("start_agent_account_login", { provider: kind })
      .catch((failure) => {
        pendingRef.current = "";
        setPendingKind("");
        setError(String(failure?.message || failure || "Unable to open the login terminal."));
      });
  }, [holdPending]);

  const beginProfileLogin = useCallback((kind, profileId) => {
    if (pendingRef.current) return;
    setError("");
    holdPending(kind);
    invoke("agent_accounts_start_profile_login", { agent_kind: kind, profile_id: profileId })
      .then(refresh)
      .catch((failure) => {
        pendingRef.current = "";
        setPendingKind("");
        setError(String(failure?.message || failure || "Unable to open the account login terminal."));
      });
  }, [holdPending, refresh]);

  /* Codex re-authenticates on switch rather than swapping a stored profile,
     so its "use this" path is the login door. */
  const setActiveProfile = useCallback((kind, profileId) => {
    setError("");
    if (kind === "codex") {
      beginProfileLogin(kind, profileId);
      return;
    }
    invoke("agent_accounts_set_active", { agent_kind: kind, profile_id: profileId })
      .then(refresh)
      .catch((failure) => setError(String(failure?.message || failure || "Unable to switch account.")));
  }, [beginProfileLogin, refresh]);

  const removeProfile = useCallback((kind, profileId) => {
    setConfirmKey("");
    setError("");
    invoke("agent_accounts_remove", { agent_kind: kind, profile_id: profileId })
      .then(refresh)
      .catch((failure) => setError(String(failure?.message || failure || "Unable to delete the profile.")));
  }, [refresh]);

  if (!agents) return null;

  return (
    <>
      <SectionTitle>CLI profiles</SectionTitle>
      <SectionNote>
        Logins for direct CLI terminals. Sign into another account in any
        terminal and it is captured here automatically.
      </SectionNote>
      {error && <Notice data-tone="error" role="status"><span>{error}</span></Notice>}
      {CLI_KINDS.map(({ kind, label }) => {
        const entry = agents[kind];
        if (!entry) return null;
        const profiles = collapseProfilesByEmail(entry.profiles);
        return (
          <ProviderGroup key={kind}>
            <ProviderHeadRow>
              <ProviderName>{label}</ProviderName>
              <GhostButton
                aria-label={`Add a ${label} account`}
                disabled={Boolean(pendingKind)}
                onClick={() => beginLogin(kind)}
                title={`Open the ${label} login in a terminal`}
                type="button"
              >
                <Add aria-hidden="true" />
                Add
              </GhostButton>
            </ProviderHeadRow>
            {!profiles.length ? (
              <EmptyState>No {label} logins captured yet.</EmptyState>
            ) : profiles.map((profile) => {
              const email = profile.identity?.email || "";
              const alias = String(profile.alias || "").trim();
              const name = profile.is_default
                ? (profile.label || "Default")
                : (alias || profile.label || "Account");
              const detail = profile.is_default ? (alias || email) : (alias ? "" : email);
              const needsLogin = Boolean(
                profile.auth_status?.needs_login || !profile.identity?.auth_ready,
              );
              const canDelete = !profile.is_default && !profile.is_active;
              return (
                <AccountRow data-busy={pendingKind === kind ? "true" : undefined} key={profile.id}>
                  <AccountIdentity>
                    <strong>{name}</strong>
                    <span>{detail || kind}</span>
                  </AccountIdentity>
                  {needsLogin ? (
                    <GhostButton
                      disabled={Boolean(pendingKind)}
                      onClick={() => beginProfileLogin(kind, profile.id)}
                      title={profile.auth_status?.message || "Sign in again for this account"}
                      type="button"
                    >
                      Log in
                    </GhostButton>
                  ) : profile.is_active ? (
                    <ActiveTag>Active</ActiveTag>
                  ) : (
                    <GhostButton
                      disabled={Boolean(pendingKind)}
                      onClick={() => setActiveProfile(kind, profile.id)}
                      title={`Use this account for new ${label} terminals`}
                      type="button"
                    >
                      Set active
                    </GhostButton>
                  )}
                  {canDelete && (
                    confirmKey === `${kind}:${profile.id}` ? (
                      <InlineConfirm data-danger="true">
                        <span>Deletes the saved login.</span>
                        <ConfirmButton
                          data-danger="true"
                          onClick={() => removeProfile(kind, profile.id)}
                          type="button"
                        >
                          Delete
                        </ConfirmButton>
                        <GhostButton onClick={() => setConfirmKey("")} type="button">Keep</GhostButton>
                      </InlineConfirm>
                    ) : (
                      <RowIconButton
                        aria-label={`Delete ${name}`}
                        onClick={() => setConfirmKey(`${kind}:${profile.id}`)}
                        title="Delete this profile and its saved login"
                        type="button"
                      >
                        <Close aria-hidden="true" />
                      </RowIconButton>
                    )
                  )}
                </AccountRow>
              );
            })}
          </ProviderGroup>
        );
      })}
    </>
  );
}

function errorCode(error) {
  return String(error?.message || error || "");
}

function publicCodeMessage(code) {
  if (code.includes("unauthorized")) return "The key was rejected (401) — check it and try again.";
  if (code.includes("permission_denied")) return "The identity lacks access to the model or endpoint (403).";
  if (code.includes("provider_error")) return "The provider was unreachable — try again (the entry is retained briefly).";
  if (code.includes("restage_required")) return "The staged secret expired — submit again.";
  if (code.includes("revision_conflict")) return "The account list changed underneath — refreshed; try again.";
  if (code.includes("invalid_argument")) return "The daemon rejected the request (bad alias or provider).";
  if (code.includes("busy")) return "The daemon is busy — try again in a moment.";
  if (code.includes("haider_accounts_unavailable")) return "The harness connection is unavailable.";
  return code || "The request failed.";
}

export default function AccountsView({ active = false }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null); // {tone: "ok"|"error", text}
  const [addMode, setAddMode] = useState(""); // "" | "api" | "oauth"
  const [apiForm, setApiForm] = useState({ provider: "", alias: "", key: "" });
  const [oauthForm, setOauthForm] = useState({ provider: "", alias: "" });
  const [oauthFlow, setOauthFlow] = useState(null); // {provider, alias, flow_id, attempt_id, url, user_code, phase, detail}
  const [confirmRemove, setConfirmRemove] = useState("");
  const [renamingAlias, setRenamingAlias] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [confirmEpoch, setConfirmEpoch] = useState("");
  const [candidates, setCandidates] = useState(null); // {discovery_disabled, candidates}
  const [library, setLibrary] = useState(null);
  /* null until asked. A daemon that publishes no catalog leaves the shipped
     floor in place; one that publishes a catalog replaces it outright. */
  const [importSources, setImportSources] = useState(null);
  const oauthFlowRef = useRef(null);
  oauthFlowRef.current = oauthFlow;

  const refresh = useCallback(async () => {
    try {
      const result = await invoke("account_list", { provider: null });
      setSnapshot(result || null);
      setLoadError("");
    } catch (error) {
      setLoadError(errorCode(error));
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    void invoke("haider_library_snapshot").then(setLibrary).catch(() => {});
    void invoke("account_oauth_import_sources")
      .then((sources) => setImportSources(Array.isArray(sources) ? sources : null))
      .catch(() => setImportSources(null));
    const timer = window.setInterval(() => void refresh(), LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  /* OAuth status poll — 1.5s while a flow is non-terminal (contract §5). */
  useEffect(() => {
    if (!oauthFlow || oauthFlow.phase !== "polling") return undefined;
    const timer = window.setInterval(async () => {
      const flow = oauthFlowRef.current;
      if (!flow) return;
      try {
        const result = await invoke("account_oauth_status", {
          flow_id: flow.flow_id,
          attempt_id: flow.attempt_id,
        });
        const status = result?.status || {};
        const kind = String(status.status || "unknown");
        /* The user may have cancelled (or started another flow) while this
           poll was in flight — claiming then would create an account they
           just dismissed. The ref is the live truth. */
        if (oauthFlowRef.current?.flow_id !== flow.flow_id) return;
        if (kind === "ready") {
          setOauthFlow((current) => (current ? { ...current, phase: "claiming" } : current));
          try {
            await invoke("account_oauth_add", {
              provider: flow.provider,
              alias: flow.alias,
              flow_id: flow.flow_id,
              attempt_id: flow.attempt_id,
              oauth_reference: status.oauth_reference,
            });
            setOauthFlow(null);
            setAddMode("");
            setNotice({ tone: "ok", text: `Signed in: ${status.identity || flow.alias}` });
            void refresh();
          } catch (error) {
            setOauthFlow((current) => (current
              ? { ...current, phase: "failed", detail: publicCodeMessage(errorCode(error)) }
              : current));
          }
        } else if (kind === "failed" || kind === "expired" || kind === "cancelled") {
          setOauthFlow((current) => (current
            ? {
              ...current,
              phase: "failed",
              detail: kind === "failed"
                ? `Sign-in failed (${status.public_code || "unknown"}).`
                : `The sign-in flow ${kind === "expired" ? "expired" : "was cancelled"}.`,
            }
            : current));
        }
        /* waiting_browser / waiting_device / exchanging / unknown: keep polling. */
      } catch {
        /* oauth_flow_not_found after reconnect etc. — flows die with the
           connection (contract gap #4): surface a restart hint. */
        setOauthFlow((current) => (current
          ? { ...current, phase: "failed", detail: "The flow was lost (connection changed) — start again." }
          : current));
      }
    }, OAUTH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [oauthFlow?.phase === "polling", refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (label, action) => {
    setBusy(label);
    setNotice(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      const code = errorCode(error);
      if (code.includes("cache_epoch_confirmation_required")) throw error;
      if (code.includes("revision_conflict")) void refresh();
      setNotice({ tone: "error", text: publicCodeMessage(code) });
      return false;
    } finally {
      setBusy("");
    }
  }, [refresh]);

  const setActiveAccount = useCallback(async (alias, confirmNewEpoch) => {
    try {
      const ok = await run(`active:${alias}`, () => invoke("account_set_active", {
        alias,
        confirm_new_epoch: Boolean(confirmNewEpoch),
      }));
      if (ok) setConfirmEpoch("");
    } catch (error) {
      if (errorCode(error).includes("cache_epoch_confirmation_required")) {
        setConfirmEpoch(alias);
        setBusy("");
      }
    }
  }, [run]);

  /* The daemon truncates an over-long label rather than refusing it, so the
     bound is enforced at the keystroke AND the returned descriptor is treated
     as the truth — a silently shortened name should be visible immediately,
     not discovered later. */
  const commitLabel = useCallback(async (alias) => {
    const next = labelDraft.trim().slice(0, LABEL_MAX);
    setRenamingAlias("");
    await run(`label:${alias}`, () => invoke("account_set_label", {
      alias,
      label: next || null,
    }));
  }, [labelDraft, run]);

  const removeAccount = useCallback((alias) => {
    setConfirmRemove("");
    void run(`remove:${alias}`, () => invoke("account_remove", {
      alias,
      expected_revision: snapshot?.revision ?? null,
    }));
  }, [run, snapshot?.revision]);

  const submitApiKey = useCallback(async () => {
    const { provider, alias, key } = apiForm;
    if (!provider.trim() || !key.trim()) return;
    const ok = await run("add:api", () => invoke("account_add_api_key", {
      provider: provider.trim(),
      alias: alias.trim() || null,
      api_key: key,
      validation_model: null,
    }));
    if (ok) {
      setApiForm({ provider: "", alias: "", key: "" });
      setAddMode("");
      setNotice({ tone: "ok", text: "API key added and validated." });
    }
  }, [apiForm, run]);

  const startOauth = useCallback(async () => {
    const provider = oauthForm.provider;
    const alias = oauthForm.alias.trim() || provider;
    setNotice(null);
    setBusy("add:oauth");
    try {
      const result = await invoke("account_oauth_start", {
        provider,
        desired_alias: alias,
      });
      if (result?.availability && result.availability.available === false) {
        setNotice({
          tone: "error",
          text: `Sign-in is unavailable for ${provider}${result.availability.reason ? ` — ${result.availability.reason}` : ""}.`,
        });
        return;
      }
      const url = result?.authorization_url || "";
      setOauthFlow({
        provider,
        alias,
        flow_id: result?.flow_id,
        attempt_id: result?.attempt_id,
        url,
        user_code: result?.user_code || "",
        phase: "polling",
        detail: "",
      });
      if (url) void openUrl(url).catch(() => {});
    } catch (error) {
      setNotice({ tone: "error", text: publicCodeMessage(errorCode(error)) });
    } finally {
      setBusy("");
    }
  }, [oauthForm]);

  const cancelOauth = useCallback(() => {
    const flow = oauthFlowRef.current;
    /* Clear the REF synchronously: state clears only on the next render, and
       a poll landing in that window would pass the ownership guard and claim
       a flow the user just cancelled. */
    oauthFlowRef.current = null;
    setOauthFlow(null);
    if (flow?.flow_id) {
      void invoke("account_oauth_cancel", {
        flow_id: flow.flow_id,
        attempt_id: flow.attempt_id,
      }).catch(() => {});
    }
  }, []);

  const importSource = useCallback((source) => {
    void run(`import:${source}`, () => invoke("account_oauth_import", { source }))
      .then((ok) => {
        if (ok) setNotice({ tone: "ok", text: "Imported and refreshed the login." });
      });
  }, [run]);

  const scanDevice = useCallback(async () => {
    setBusy("scan");
    try {
      const result = await invoke("account_device_candidates");
      setCandidates(result || { candidates: [] });
      void refresh(); // scanning auto-adopts importable candidates (contract §9)
    } catch (error) {
      setNotice({ tone: "error", text: publicCodeMessage(errorCode(error)) });
    } finally {
      setBusy("");
    }
  }, [refresh]);

  const importCandidate = useCallback((candidate) => {
    void run(`candidate:${candidate}`, () => invoke("account_import_device", { candidate }))
      .then((ok) => {
        if (ok) void scanDevice();
      });
  }, [run, scanDevice]);

  const accountPresentation = accountListPresentation(snapshot, loadError);
  const descriptors = accountPresentation.descriptors || [];
  const grouped = useMemo(() => {
    const byProvider = new Map();
    for (const descriptor of descriptors) {
      const list = byProvider.get(descriptor.provider) || [];
      list.push(descriptor);
      byProvider.set(descriptor.provider, list);
    }
    return [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [descriptors]);

  const apiProviders = useMemo(() => providerAuthOptions(library, "api_key"), [library]);
  const oauthProviders = useMemo(() => providerAuthOptions(library, "oauth"), [library]);

  return (
    <Root aria-label="Accounts" data-active={active ? "true" : undefined}>
      <Header>
        <h1>Accounts</h1>
        <p>
          Managed by the Haider harness — one vault for every surface. Secrets
          enter once and are never shown again.
        </p>
      </Header>

      {notice && (
        <Notice data-tone={notice.tone} role="status">
          <span>{notice.text}</span>
          <NoticeDismiss aria-label="Dismiss" onClick={() => setNotice(null)} type="button">
            <Close aria-hidden="true" />
          </NoticeDismiss>
        </Notice>
      )}

      {(accountPresentation.state === "legacy_unknown" || accountPresentation.state === "unknown")
        && descriptors.length > 0 && (
        <Notice data-tone="warning" role="status">
          Account rows are from a compatibility snapshot whose availability is unknown.
        </Notice>
      )}

      {accountPresentation.state === "unavailable" ? (
        <EmptyState>
          Account inventory is unavailable
          {accountPresentation.reason ? ` — ${accountPresentation.reason}` : ""}.
        </EmptyState>
      ) : accountPresentation.state === "loading" ? (
        <EmptyState>Loading accounts…</EmptyState>
      ) : accountPresentation.state === "empty" ? (
        <EmptyState>No accounts yet — add one below.</EmptyState>
      ) : (accountPresentation.state === "legacy_unknown"
          || accountPresentation.state === "unknown") && !descriptors.length ? (
        <EmptyState>Account inventory availability is unknown.</EmptyState>
      ) : (
        grouped.map(([provider, entries]) => (
          <ProviderGroup key={provider}>
            <ProviderName>{provider}</ProviderName>
            {entries.map((descriptor) => {
              const status = credentialStatus(descriptor);
              return (
                <AccountRow key={descriptor.alias}>
                  {renamingAlias === descriptor.alias ? (
                    <RenameForm
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitLabel(descriptor.alias);
                      }}
                    >
                      <input
                        aria-label={`Label for ${descriptor.alias}`}
                        autoFocus
                        maxLength={LABEL_MAX}
                        onChange={(event) => setLabelDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setRenamingAlias("");
                        }}
                        placeholder={descriptor.identity || descriptor.alias}
                        value={labelDraft}
                      />
                      <ConfirmButton type="submit">Save</ConfirmButton>
                      {/* Empty clears — the erase gesture and an explicit
                          clear are the same intent, daemon-side too. */}
                      <GhostButton onClick={() => setRenamingAlias("")} type="button">
                        Cancel
                      </GhostButton>
                    </RenameForm>
                  ) : (
                  <AccountIdentity>
                    {/* An operator-chosen label outranks a provider identity:
                        it is the only one of the three the user authored. */}
                    <strong>{descriptor.label || descriptor.identity || descriptor.alias}</strong>
                    <span>
                      {descriptor.label ? `${descriptor.identity || descriptor.alias} · ` : ""}
                      {descriptor.alias}
                      {" · "}
                      {accountAuthMethodLabel(descriptor)}
                    </span>
                  </AccountIdentity>
                  )}
                  {renamingAlias !== descriptor.alias && (
                    <RowIconButton
                      aria-label={`Rename ${descriptor.alias}`}
                      onClick={() => {
                        setRenamingAlias(descriptor.alias);
                        setLabelDraft(descriptor.label || "");
                      }}
                      title="Give this account a name of your own"
                      type="button"
                    >
                      <Edit aria-hidden="true" />
                    </RowIconButton>
                  )}
                  <StatusBadge data-state={status}>
                    {STATUS_LABELS[status] || status}
                  </StatusBadge>
                  {confirmEpoch === descriptor.alias ? (
                    <InlineConfirm>
                      <span>Switching changes the prompt-cache epoch.</span>
                      <ConfirmButton
                        onClick={() => void setActiveAccount(descriptor.alias, true)}
                        type="button"
                      >
                        Switch
                      </ConfirmButton>
                      <GhostButton onClick={() => setConfirmEpoch("")} type="button">
                        Keep
                      </GhostButton>
                    </InlineConfirm>
                  ) : descriptor.active ? (
                    <ActiveTag>Active</ActiveTag>
                  ) : (
                    <GhostButton
                      disabled={busy === `active:${descriptor.alias}`}
                      onClick={() => void setActiveAccount(descriptor.alias, false)}
                      type="button"
                    >
                      Set active
                    </GhostButton>
                  )}
                  {confirmRemove === descriptor.alias ? (
                    <InlineConfirm data-danger="true">
                      <span>Removes the credential from the vault.</span>
                      <ConfirmButton
                        data-danger="true"
                        onClick={() => removeAccount(descriptor.alias)}
                        type="button"
                      >
                        Remove
                      </ConfirmButton>
                      <GhostButton onClick={() => setConfirmRemove("")} type="button">
                        Keep
                      </GhostButton>
                    </InlineConfirm>
                  ) : (
                    <RowIconButton
                      aria-label={`Remove ${descriptor.alias}`}
                      disabled={busy === `remove:${descriptor.alias}`}
                      onClick={() => setConfirmRemove(descriptor.alias)}
                      title="Remove account"
                      type="button"
                    >
                      <Close aria-hidden="true" />
                    </RowIconButton>
                  )}
                </AccountRow>
              );
            })}
          </ProviderGroup>
        ))
      )}

      <SectionTitle>Add account</SectionTitle>
      <AddBar>
        <GhostButton
          data-active={addMode === "oauth" ? "true" : undefined}
          onClick={() => setAddMode((mode) => (mode === "oauth" ? "" : "oauth"))}
          type="button"
        >
          <Add aria-hidden="true" />
          Sign in (OAuth)
        </GhostButton>
        <GhostButton
          data-active={addMode === "api" ? "true" : undefined}
          onClick={() => setAddMode((mode) => (mode === "api" ? "" : "api"))}
          type="button"
        >
          <Add aria-hidden="true" />
          API key
        </GhostButton>
        {(importSources || LEGACY_IMPORT_SOURCES).map((entry) => {
          const label = importSourceLabel(entry.source);
          /* available is point-in-time, so an unavailable source is shown and
             disabled rather than hidden — with the daemon's own sentence for
             why, which is the whole reason it sends one. */
          const available = entry.available !== false;
          const reason = entry.unavailable_reason?.message;
          return (
            <GhostButton
              disabled={busy === `import:${entry.source}` || !available}
              key={entry.source}
              onClick={() => importSource(entry.source)}
              title={available
                ? `Import the ${label} login from this machine`
                : reason || `No ${label} login is available on this machine`}
              type="button"
            >
              Import {label}
            </GhostButton>
          );
        })}
        <GhostButton
          disabled={busy === "scan"}
          onClick={() => void scanDevice()}
          title="Scans local CLI stores; importable logins are adopted automatically"
          type="button"
        >
          Scan device logins
        </GhostButton>
      </AddBar>

      {addMode === "api" && (
        <AddForm
          onSubmit={(event) => {
            event.preventDefault();
            void submitApiKey();
          }}
        >
          <FormField>
            <label htmlFor="account-api-provider">Provider</label>
            <select
              id="account-api-provider"
              onChange={(event) => setApiForm((form) => ({ ...form, provider: event.target.value }))}
              value={apiForm.provider}
            >
              <option value="">Choose…</option>
              {apiProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </FormField>
          <FormField>
            <label htmlFor="account-api-alias">Alias (optional)</label>
            <input
              autoComplete="off"
              id="account-api-alias"
              onChange={(event) => setApiForm((form) => ({ ...form, alias: event.target.value }))}
              placeholder="derived if empty"
              value={apiForm.alias}
            />
          </FormField>
          <FormField data-grow="true">
            <label htmlFor="account-api-key">API key</label>
            <input
              autoComplete="off"
              id="account-api-key"
              onChange={(event) => setApiForm((form) => ({ ...form, key: event.target.value }))}
              placeholder="sk-…"
              type="password"
              value={apiForm.key}
            />
          </FormField>
          <ConfirmButton
            disabled={!apiForm.provider || !apiForm.key || busy === "add:api"}
            type="submit"
          >
            {busy === "add:api" ? "Validating…" : "Add"}
          </ConfirmButton>
        </AddForm>
      )}

      {addMode === "oauth" && !oauthFlow && (
        <AddForm
          onSubmit={(event) => {
            event.preventDefault();
            void startOauth();
          }}
        >
          <FormField>
            <label htmlFor="account-oauth-provider">Provider</label>
            <select
              id="account-oauth-provider"
              onChange={(event) => setOauthForm((form) => ({ ...form, provider: event.target.value }))}
              value={oauthForm.provider}
            >
              <option value="">Choose…</option>
              {oauthProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </FormField>
          <FormField>
            <label htmlFor="account-oauth-alias">Alias (optional)</label>
            <input
              autoComplete="off"
              id="account-oauth-alias"
              onChange={(event) => setOauthForm((form) => ({ ...form, alias: event.target.value }))}
              placeholder={oauthForm.provider}
              value={oauthForm.alias}
            />
          </FormField>
          <ConfirmButton disabled={!oauthForm.provider || busy === "add:oauth"} type="submit">
            {busy === "add:oauth" ? "Starting…" : "Start sign-in"}
          </ConfirmButton>
        </AddForm>
      )}

      {oauthFlow && (
        <OauthCard>
          {oauthFlow.phase === "failed" ? (
            <>
              <span>{oauthFlow.detail}</span>
              <GhostButton onClick={() => setOauthFlow(null)} type="button">Close</GhostButton>
            </>
          ) : (
            <>
              <span>
                {oauthFlow.user_code
                  ? "Enter the code in your browser to finish signing in:"
                  : "Finish signing in with your browser — this completes automatically."}
              </span>
              {oauthFlow.user_code && <OauthCode>{oauthFlow.user_code}</OauthCode>}
              {oauthFlow.url && (
                <OauthUrl
                  onClick={() => void openUrl(oauthFlow.url).catch(() => {})}
                  type="button"
                >
                  {oauthFlow.url}
                </OauthUrl>
              )}
              <GhostButton onClick={cancelOauth} type="button">Cancel</GhostButton>
            </>
          )}
        </OauthCard>
      )}

      <CliProfilesSection />

      {candidates && (
        <>
          <SectionTitle>Device logins</SectionTitle>
          {candidates.discovery_disabled ? (
            <EmptyState>Device credential discovery is disabled.</EmptyState>
          ) : !candidates.candidates?.length ? (
            <EmptyState>No importable CLI logins were found.</EmptyState>
          ) : (
            candidates.candidates.map((candidate) => (
              <AccountRow key={candidate.candidate}>
                <AccountIdentity>
                  <strong>{candidate.account_label || candidate.source_label}</strong>
                  <span>{candidate.provider} · {candidate.freshness}</span>
                </AccountIdentity>
                {candidate.import_supported ? (
                  <GhostButton
                    disabled={busy === `candidate:${candidate.candidate}`}
                    onClick={() => importCandidate(candidate.candidate)}
                    type="button"
                  >
                    Import
                  </GhostButton>
                ) : (
                  <StatusBadge data-state="expired">
                    {candidate.unsupported_reason || "unsupported"}
                  </StatusBadge>
                )}
              </AccountRow>
            ))
          )}
        </>
      )}
    </Root>
  );
}

/* ---- styles ----------------------------------------------------------- */

const Root = styled.section`
  max-width: 46rem;
  margin: 0 auto;
  padding: 26px clamp(20px, 6%, 56px) 48px;
  overflow-y: auto;
  height: 100%;
`;

const Header = styled.header`
  margin-bottom: 18px;

  h1 {
    margin: 0 0 4px;
    color: var(--forge-text);
    font-size: 19px;
    font-weight: 700;
  }

  p {
    margin: 0;
    color: var(--forge-text-muted);
    font-size: 12.5px;
    line-height: 1.5;
  }
`;

const Notice = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 8px 12px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  font-size: 12.5px;

  &[data-tone="ok"] {
    border-color: color-mix(in srgb, var(--forge-green) 40%, transparent);
    color: var(--forge-green);
  }

  &[data-tone="error"] {
    border-color: color-mix(in srgb, var(--forge-red) 40%, transparent);
    color: var(--forge-red);
  }

  span { flex: 1; }
`;

const NoticeDismiss = styled.button`
  display: inline-flex;
  padding: 2px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;

  svg { width: 13px; height: 13px; }
`;

const EmptyState = styled.p`
  margin: 10px 0 18px;
  color: var(--forge-text-muted);
  font-size: 13px;
`;

const ProviderGroup = styled.div`
  margin-bottom: 16px;
`;

const ProviderName = styled.h2`
  margin: 0 0 6px;
  color: var(--forge-text-muted);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
`;

const RenameForm = styled.form`
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;

  input {
    flex: 1;
    min-width: 0;
    padding: 4px 9px;
    border: 1px solid var(--forge-border-strong);
    border-radius: 8px;
    background: var(--forge-surface-control);
    color: var(--forge-text);
    font-size: 12.5px;
  }
`;

const ProviderHeadRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  ${ProviderName} { margin-bottom: 6px; }
`;

const SectionNote = styled.p`
  margin: -2px 0 8px;
  color: var(--forge-text-muted);
  font-size: 11.5px;
  line-height: 1.5;
`;

const AccountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface);

  & + & { margin-top: 6px; }

  &[data-busy="true"] { opacity: 0.6; }
`;

const AccountIdentity = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;

  strong {
    overflow: hidden;
    color: var(--forge-text);
    font-size: 13px;
    font-weight: 640;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--forge-text-muted);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 10.5px;
  }
`;

const StatusBadge = styled.span`
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--forge-green);
  background: color-mix(in srgb, var(--forge-green) 12%, transparent);

  &[data-state="limited"],
  &[data-state="needs_attention"] {
    color: var(--forge-amber);
    background: color-mix(in srgb, var(--forge-amber) 12%, transparent);
  }

  &[data-state="expired"],
  &[data-state="revoked"] {
    color: var(--forge-red);
    background: color-mix(in srgb, var(--forge-red) 12%, transparent);
  }
`;

const ActiveTag = styled.span`
  flex: 0 0 auto;
  padding: 2px 9px;
  border: 1px solid color-mix(in srgb, var(--forge-accent) 45%, transparent);
  border-radius: 999px;
  color: var(--forge-accent-soft);
  font-size: 10px;
  font-weight: 700;
`;

const GhostButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 3px 10px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--forge-text-soft);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;

  svg { width: 12px; height: 12px; }

  &:hover:not(:disabled) {
    background: var(--forge-surface-hover);
    color: var(--forge-text);
  }

  &[data-active="true"] {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-accent-soft);
  }

  &:disabled { opacity: 0.5; cursor: default; }
`;

const ConfirmButton = styled.button`
  flex: 0 0 auto;
  padding: 3px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--forge-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;

  &[data-danger="true"] { background: var(--forge-red); }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const RowIconButton = styled.button`
  display: inline-flex;
  flex: 0 0 auto;
  padding: 3px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--forge-text-muted);
  cursor: pointer;

  svg { width: 13px; height: 13px; }

  &:hover:not(:disabled) {
    background: var(--forge-surface-hover);
    color: var(--forge-red);
  }
`;

const InlineConfirm = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;

  span {
    color: var(--forge-amber);
    font-size: 10.5px;
  }

  &[data-danger="true"] span { color: var(--forge-red); }
`;

const SectionTitle = styled.h2`
  margin: 22px 0 8px;
  color: var(--forge-text-muted);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
`;

const AddBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const AddForm = styled.form`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface);
`;

const FormField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;

  &[data-grow="true"] { flex: 1; min-width: 180px; }

  label {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  input, select {
    padding: 5px 9px;
    border: 1px solid var(--forge-border-strong);
    border-radius: 8px;
    background: var(--forge-surface-control);
    color: var(--forge-text);
    font-size: 12.5px;
  }
`;

const OauthCard = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--forge-accent) 35%, transparent);
  border-radius: 10px;
  background: var(--forge-surface);
  color: var(--forge-text-soft);
  font-size: 12.5px;
`;

const OauthCode = styled.code`
  padding: 3px 10px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 8px;
  color: var(--forge-text);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.12em;
`;

const OauthUrl = styled.button`
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--forge-accent-soft);
  font-size: 11.5px;
  text-decoration: underline;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
`;
