import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { scopeView, testOutcomeView } from "./sshProfileModel.js";

/* Presentational SSH profile manager. The component owns only inline editor
   state; all six daemon dispatches, receipts, and authority re-lists live in
   useSshProfiles.js. Secret controls are always masked and are blank when an
   update form opens because secrets never return from the daemon. */

const EMPTY_FORM = Object.freeze({
  name: "",
  description: "",
  host: "",
  user: "",
  port: "22",
  defaultCwd: "",
  multiplexing: false,
  authKind: "agent",
  password: "",
  privateKey: "",
  passphrase: "",
});

function blankForm() {
  return { ...EMPTY_FORM };
}

function displayText(value, fallback = "not published") {
  return value == null || value === "" ? fallback : String(value);
}

function testLabel(outcome) {
  if (outcome.kind === "untested") return "not tested";
  if (outcome.recognized) return outcome.label;
  if (outcome.outcome != null) return `${outcome.outcome} (unrecognized)`;
  return outcome.label;
}

function scopeLabel(scope) {
  if (!scope.recognized) {
    return scope.raw == null
      ? "not published"
      : `${scope.raw} (unrecognized)`;
  }
  return scope.raw === "allow"
    ? `allow · ${scope.names.length ? scope.names.join(", ") : "no names published"}`
    : scope.raw;
}

function formFromProfile(profile) {
  return {
    ...blankForm(),
    name: profile.name ?? "",
    description: profile.description ?? "",
    host: profile.host ?? "",
    user: profile.user ?? "",
    port: profile.port == null ? "" : String(profile.port),
    defaultCwd: profile.defaultCwd ?? "",
    multiplexing: profile.multiplexing === true,
    authKind: "unchanged",
  };
}

function authInput(form, updateMode) {
  if (updateMode && form.authKind === "unchanged") return { auth: null, error: "" };
  if (form.authKind === "agent") return { auth: { kind: "agent" }, error: "" };
  if (form.authKind === "password") {
    return form.password
      ? { auth: { kind: "password", password: form.password }, error: "" }
      : { auth: null, error: "Enter a password for password authentication." };
  }
  if (form.authKind === "key_material") {
    if (!form.privateKey) {
      return { auth: null, error: "Enter private key material for key authentication." };
    }
    return {
      auth: {
        kind: "key_material",
        private_key: form.privateKey,
        ...(form.passphrase ? { passphrase: form.passphrase } : {}),
      },
      error: "",
    };
  }
  return { auth: null, error: "Choose an authentication method." };
}

function requestFromForm(form, originalName) {
  const name = form.name.trim();
  const host = form.host.trim();
  const user = form.user.trim();
  const port = Number(form.port);
  if (!name || !host || !user) {
    return { request: null, error: "Name, host, and user are required." };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { request: null, error: "Port must be a whole number from 1 to 65535." };
  }
  const updateMode = originalName != null;
  const auth = authInput(form, updateMode);
  if (auth.error) return { request: null, error: auth.error };

  if (!updateMode) {
    return {
      request: {
        name,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        host,
        user,
        port,
        ...(form.defaultCwd.trim() ? { default_cwd: form.defaultCwd.trim() } : {}),
        multiplexing: form.multiplexing,
        auth: auth.auth,
      },
      error: "",
    };
  }

  return {
    request: {
      ...(name !== originalName ? { name } : {}),
      description: form.description.trim() || null,
      host,
      user,
      port,
      default_cwd: form.defaultCwd.trim() || null,
      multiplexing: form.multiplexing,
      ...(auth.auth == null ? {} : { auth: auth.auth }),
    },
    error: "",
  };
}

function ProfileForm({
  form,
  mode,
  originalName,
  submitting,
  onCancel,
  onChange,
  onSubmit,
}) {
  const updateMode = mode === "update";
  const set = (key, value) => onChange({ ...form, [key]: value });
  return (
    <EditorCard aria-label={updateMode ? `Update ${originalName}` : "Add SSH profile"}>
      <EditorHeading>
        <div>
          <strong>{updateMode ? `Update ${originalName}` : "Add SSH profile"}</strong>
          <span>
            {updateMode
              ? "Identity fields are public daemon facts. Credentials are blank and write-only."
              : "Credentials are dispatched once and immediately cleared from this form."}
          </span>
        </div>
        <QuietButton disabled={submitting} onClick={onCancel} type="button">Cancel</QuietButton>
      </EditorHeading>

      <FieldGrid>
        <FieldLabel>
          <span>Name</span>
          <TextInput
            autoComplete="off"
            onChange={(event) => set("name", event.target.value)}
            value={form.name}
          />
        </FieldLabel>
        <FieldLabel>
          <span>Description</span>
          <TextInput
            autoComplete="off"
            onChange={(event) => set("description", event.target.value)}
            value={form.description}
          />
        </FieldLabel>
        <FieldLabel>
          <span>Host</span>
          <TextInput
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => set("host", event.target.value)}
            spellCheck={false}
            value={form.host}
          />
        </FieldLabel>
        <FieldLabel>
          <span>User</span>
          <TextInput
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => set("user", event.target.value)}
            spellCheck={false}
            value={form.user}
          />
        </FieldLabel>
        <FieldLabel>
          <span>Port</span>
          <TextInput
            inputMode="numeric"
            max="65535"
            min="1"
            onChange={(event) => set("port", event.target.value)}
            type="number"
            value={form.port}
          />
        </FieldLabel>
        <FieldLabel>
          <span>Default working directory</span>
          <TextInput
            autoComplete="off"
            onChange={(event) => set("defaultCwd", event.target.value)}
            spellCheck={false}
            value={form.defaultCwd}
          />
        </FieldLabel>
      </FieldGrid>

      <CheckboxLabel>
        <input
          checked={form.multiplexing}
          onChange={(event) => set("multiplexing", event.target.checked)}
          type="checkbox"
        />
        <span>Request connection multiplexing</span>
      </CheckboxLabel>

      <AuthSection>
        <FieldLabel>
          <span>Authentication</span>
          <SelectInput
            onChange={(event) => set("authKind", event.target.value)}
            value={form.authKind}
          >
            {updateMode && <option value="unchanged">Keep existing credentials</option>}
            <option value="agent">SSH agent</option>
            <option value="password">Password</option>
            <option value="key_material">Private key material</option>
          </SelectInput>
        </FieldLabel>
        {form.authKind === "password" && (
          <FieldLabel>
            <span>Password · write-only</span>
            <TextInput
              autoComplete="new-password"
              onChange={(event) => set("password", event.target.value)}
              type="password"
              value={form.password}
            />
          </FieldLabel>
        )}
        {form.authKind === "key_material" && (
          <>
            <FieldLabel>
              <span>Private key material · write-only</span>
              <SecretTextarea
                autoComplete="off"
                onChange={(event) => set("privateKey", event.target.value)}
                spellCheck={false}
                value={form.privateKey}
              />
            </FieldLabel>
            <FieldLabel>
              <span>Key passphrase · write-only, optional</span>
              <TextInput
                autoComplete="new-password"
                onChange={(event) => set("passphrase", event.target.value)}
                type="password"
                value={form.passphrase}
              />
            </FieldLabel>
          </>
        )}
      </AuthSection>

      <EditorActions>
        <PrimaryButton disabled={submitting} onClick={onSubmit} type="button">
          {submitting ? "Submitting…" : updateMode ? "Update profile" : "Add profile"}
        </PrimaryButton>
        <SecretNotice>
          Secrets are never loaded, echoed, placed in receipts, or kept after submit.
        </SecretNotice>
      </EditorActions>
    </EditorCard>
  );
}

function ProfileCard({
  profile,
  outcome,
  openingShell,
  ptyUnavailable,
  removing,
  testing,
  updating,
  onEdit,
  onOpenShell,
  onRemove,
  onTest,
}) {
  const canAct = profile.name != null && !removing && !testing && !updating;
  const canOpenShell = canAct && !openingShell && !ptyUnavailable;
  return (
    <ProfileItem>
      <ProfileHeader>
        <ProfileIdentity>
          <strong>{displayText(profile.name, "name not published")}</strong>
          <span>{displayText(profile.description, "No description published")}</span>
        </ProfileIdentity>
        <ReachabilityBadge
          data-recognized={outcome.recognized ? "true" : "false"}
          data-reachable={outcome.reachable === true ? "true" : undefined}
          data-unreachable={outcome.reachable === false ? "true" : undefined}
        >
          {testLabel(outcome)}
        </ReachabilityBadge>
      </ProfileHeader>
      <FactsGrid>
        <span>host: <code>{displayText(profile.host)}</code></span>
        <span>user: <code>{displayText(profile.user)}</code></span>
        <span>port: <strong>{displayText(profile.port)}</strong></span>
        <span>default cwd: <code>{displayText(profile.defaultCwd)}</code></span>
        <span>
          session inclusion: <strong>
            {profile.inScope == null ? "not published" : profile.inScope ? "included" : "not included"}
          </strong>
        </span>
        <span>
          multiplexing: <strong>
            {profile.multiplexing == null ? "not published" : profile.multiplexing ? "enabled" : "disabled"}
          </strong>
        </span>
      </FactsGrid>
      {profile.hostKey != null && (
        <HostKeyFacts>
          Host key · algorithm: {displayText(profile.hostKey.algorithm)}
          {" · fingerprint: "}<code>{displayText(profile.hostKey.fingerprint)}</code>
          {" · pinned at: "}{displayText(profile.hostKey.pinnedAtMs)}
        </HostKeyFacts>
      )}
      {outcome.kind !== "untested" && (
        <TestReceipt>
          Test outcome published for {displayText(outcome.profileName, "profile name not published")}
          {" · host key pinned: "}
          {outcome.hostKeyPinned == null ? "not published" : outcome.hostKeyPinned ? "yes" : "no"}
        </TestReceipt>
      )}
      <ProfileActions>
        <PrimaryButton
          disabled={!canOpenShell}
          onClick={() => onOpenShell?.(profile.name)}
          type="button"
        >
          {ptyUnavailable
            ? "Shell unavailable"
            : openingShell
              ? "Opening shell…"
              : "Open shell"}
        </PrimaryButton>
        <QuietButton disabled={!canAct} onClick={onTest} type="button">
          {testing ? "Testing…" : "Test"}
        </QuietButton>
        <QuietButton disabled={!canAct} onClick={onEdit} type="button">
          {updating ? "Updating…" : "Update"}
        </QuietButton>
        <RemoveDisclosure>
          <summary>Remove</summary>
          <RemoveConfirm>
            <span>Remove exactly “{displayText(profile.name)}”?</span>
            <DangerButton disabled={!canAct} onClick={onRemove} type="button">
              {removing ? "Removing…" : "Confirm remove"}
            </DangerButton>
          </RemoveConfirm>
        </RemoveDisclosure>
      </ProfileActions>
    </ProfileItem>
  );
}

export default function SshProfilesPanel({
  sessionId,
  profiles = null,
  testsByName = {},
  scopeReceipt = null,
  mutationReceipt = null,
  loading = false,
  adding = false,
  updatingByName = {},
  removingByName = {},
  testingByName = {},
  settingScope = false,
  sshPtyOpening = false,
  sshPtyUnavailable = false,
  error = "",
  unavailable = false,
  onRefresh = null,
  onAdd = null,
  onUpdate = null,
  onRemove = null,
  onOpenShell = null,
  onTest = null,
  onSetScope = null,
}) {
  const [formMode, setFormMode] = useState("");
  const [originalName, setOriginalName] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [formError, setFormError] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [desiredScopeKind, setDesiredScopeKind] = useState("");
  const [allowedNames, setAllowedNames] = useState([]);
  const [scopeError, setScopeError] = useState("");

  const publishedNames = useMemo(() => (
    Array.isArray(profiles)
      ? profiles.map((profile) => profile.name).filter((name) => name != null)
      : []
  ), [profiles]);

  useEffect(() => {
    setAllowedNames((current) => current.filter((name) => publishedNames.includes(name)));
  }, [publishedNames]);

  const openAdd = () => {
    setForm(blankForm());
    setOriginalName(null);
    setFormError("");
    setFormMode("add");
  };
  const openUpdate = (profile) => {
    setForm(formFromProfile(profile));
    setOriginalName(profile.name);
    setFormError("");
    setFormMode("update");
  };
  const closeForm = () => {
    setForm(blankForm());
    setOriginalName(null);
    setFormError("");
    setFormMode("");
  };
  const clearSecrets = () => {
    setForm((current) => ({
      ...current,
      password: "",
      privateKey: "",
      passphrase: "",
    }));
  };

  const submitForm = async () => {
    if (formSubmitting || adding || (originalName && updatingByName[originalName])) return;
    let built = requestFromForm(form, originalName);
    if (built.error) {
      setFormError(built.error);
      return;
    }
    setFormError("");
    setFormSubmitting(true);
    try {
      let request = built.request;
      const pending = formMode === "update"
        ? onUpdate?.(originalName, request, clearSecrets)
        : onAdd?.(request, clearSecrets);
      built = null;
      request = null;
      clearSecrets();
      const receipt = await pending;
      if (receipt != null) closeForm();
    } finally {
      clearSecrets();
      setFormSubmitting(false);
    }
  };

  const submitScope = async () => {
    if (!desiredScopeKind) {
      setScopeError("Choose a scope to publish for this session.");
      return;
    }
    if (desiredScopeKind === "allow" && allowedNames.length === 0) {
      setScopeError("Choose at least one published profile for an allow scope.");
      return;
    }
    setScopeError("");
    await onSetScope?.(desiredScopeKind === "allow"
      ? { kind: "allow", names: allowedNames }
      : { kind: desiredScopeKind });
  };

  const publishedScope = scopeReceipt?.scope ?? scopeView(null);
  return (
    <PanelRoot aria-label="SSH Profiles">
      <PanelHeading>
        <div>
          <PanelTitle>SSH Profiles</PanelTitle>
          <PanelSubtitle>
            Daemon-owned remote identities, reachability tests, and this session&apos;s SSH scope.
          </PanelSubtitle>
        </div>
        <HeadingActions>
          <QuietButton
            disabled={loading || unavailable}
            onClick={() => onRefresh?.()}
            type="button"
          >
            {loading ? "Reading…" : "Refresh"}
          </QuietButton>
          <PrimaryButton
            disabled={unavailable || Boolean(formMode)}
            onClick={openAdd}
            type="button"
          >
            Add profile
          </PrimaryButton>
        </HeadingActions>
      </PanelHeading>

      {unavailable ? (
        <MutedState>SSH profile management is unavailable on this daemon.</MutedState>
      ) : (
        <>
          {error && <ErrorNotice role="alert">{error}</ErrorNotice>}
          {formMode && (
            <>
              <ProfileForm
                form={form}
                mode={formMode}
                onCancel={closeForm}
                onChange={setForm}
                onSubmit={submitForm}
                originalName={originalName}
                submitting={formSubmitting || adding || Boolean(originalName && updatingByName[originalName])}
              />
              {formError && <ErrorNotice role="alert">{formError}</ErrorNotice>}
            </>
          )}

          <ScopeCard aria-labelledby="ssh-session-scope-title">
            <SectionHeader>
              <div>
                <SectionTitle id="ssh-session-scope-title">Active session SSH scope</SectionTitle>
                <SectionSubtitle>
                  Current scope is shown only from the daemon&apos;s returned scope receipt.
                </SectionSubtitle>
              </div>
              <ScopeFact data-recognized={publishedScope.recognized ? "true" : "false"}>
                {scopeLabel(publishedScope)}
              </ScopeFact>
            </SectionHeader>
            {scopeReceipt != null && (
              <ReceiptNotice>
                Daemon receipt · session id: {displayText(scopeReceipt.sessionId)}
                {scopeReceipt.relisted === true
                  ? " · fresh profile list read from authority"
                  : scopeReceipt.relisted === false
                    ? " · fresh profile list not received"
                    : " · re-listing profile authority…"}
              </ReceiptNotice>
            )}
            <ScopeControls>
              <SelectInput
                aria-label="Desired SSH scope"
                disabled={settingScope}
                onChange={(event) => {
                  setDesiredScopeKind(event.target.value);
                  setScopeError("");
                }}
                value={desiredScopeKind}
              >
                <option value="">Choose a scope…</option>
                <option value="none">none</option>
                <option value="all">all</option>
                <option value="allow">allow selected profiles</option>
              </SelectInput>
              <PrimaryButton disabled={settingScope} onClick={submitScope} type="button">
                {settingScope ? "Publishing…" : "Set session scope"}
              </PrimaryButton>
            </ScopeControls>
            {desiredScopeKind === "allow" && (
              publishedNames.length === 0 ? (
                <MutedState>No published profiles are available to select.</MutedState>
              ) : (
                <AllowedList aria-label="Profiles allowed in session scope">
                  {publishedNames.map((name) => (
                    <CheckboxLabel key={name}>
                      <input
                        checked={allowedNames.includes(name)}
                        onChange={(event) => setAllowedNames((current) => (
                          event.target.checked
                            ? [...new Set([...current, name])]
                            : current.filter((candidate) => candidate !== name)
                        ))}
                        type="checkbox"
                      />
                      <span>{name}</span>
                    </CheckboxLabel>
                  ))}
                </AllowedList>
              )
            )}
            {scopeError && <ErrorNotice role="alert">{scopeError}</ErrorNotice>}
          </ScopeCard>

          {mutationReceipt != null && (
            <ReceiptNotice>
              Daemon {mutationReceipt.action} receipt · profile: {displayText(mutationReceipt.name)}
              {mutationReceipt.relisted === true
                ? " · fresh profile list read from authority"
                : mutationReceipt.relisted === false
                  ? " · fresh profile list not received"
                  : " · re-listing profile authority…"}
            </ReceiptNotice>
          )}

          {sshPtyUnavailable && (
            <MutedState>
              Interactive SSH shell access is unavailable on this daemon; profile management remains available.
            </MutedState>
          )}

          {profiles == null && !error && (
            <MutedState>SSH profiles not read yet.</MutedState>
          )}
          {Array.isArray(profiles) && profiles.length === 0 && (
            <MutedState>No SSH profiles are published by the daemon.</MutedState>
          )}
          {Array.isArray(profiles) && profiles.length > 0 && (
            <ProfileList>
              {profiles.map((profile, index) => {
                const name = profile.name;
                const outcome = name == null
                  ? testOutcomeView(null)
                  : testsByName[name] ?? testOutcomeView(null);
                return (
                  <ProfileCard
                    key={name ?? `profile-without-name:${index}`}
                    onEdit={() => openUpdate(profile)}
                    onOpenShell={onOpenShell}
                    onRemove={() => onRemove?.(name)}
                    onTest={() => onTest?.(name)}
                    openingShell={sshPtyOpening}
                    outcome={outcome}
                    profile={profile}
                    ptyUnavailable={sshPtyUnavailable}
                    removing={name != null && removingByName[name] === true}
                    testing={name != null && testingByName[name] === true}
                    updating={name != null && updatingByName[name] === true}
                  />
                );
              })}
            </ProfileList>
          )}
        </>
      )}
      <BoundaryNote>
        Secrets are write-only: they never come back in profile rows or test/scope receipts.
        Reachability remains “not tested” until a published test outcome arrives.
      </BoundaryNote>
      <SessionFact>UI session: <code>{displayText(sessionId)}</code></SessionFact>
    </PanelRoot>
  );
}

const PanelRoot = styled.section`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  overflow: auto;
  color: var(--forge-text);
  background: var(--forge-bg);
`;

const PanelHeading = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 14px;
  font-weight: 760;
`;

const PanelSubtitle = styled.p`
  margin: 3px 0 0;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const HeadingActions = styled.div`
  display: flex;
  flex: none;
  gap: 6px;
`;

const QuietButton = styled.button`
  padding: 5px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font: inherit;
  font-size: 9px;
  cursor: pointer;

  &:disabled { cursor: default; opacity: 0.48; }
`;

const PrimaryButton = styled(QuietButton)`
  border-color: color-mix(in srgb, var(--forge-accent) 55%, var(--forge-border));
  color: var(--forge-accent-text, var(--forge-text));
  background: color-mix(in srgb, var(--forge-accent) 16%, var(--forge-surface-control));
`;

const DangerButton = styled(QuietButton)`
  border-color: color-mix(in srgb, #ef6a6a 55%, var(--forge-border));
  color: #ef8a8a;
`;

const MutedState = styled.div`
  padding: 8px;
  border: 1px dashed var(--forge-border);
  border-radius: 7px;
  color: var(--forge-text-muted);
  font-size: 9px;
`;

const ErrorNotice = styled.div`
  padding: 8px;
  border: 1px solid color-mix(in srgb, #ef6a6a 45%, var(--forge-border));
  border-radius: 7px;
  color: #ef8a8a;
  background: color-mix(in srgb, #ef6a6a 8%, var(--forge-surface));
  font-size: 9px;
`;

const EditorCard = styled.section`
  display: grid;
  gap: 10px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--forge-accent) 42%, var(--forge-border));
  border-radius: 9px;
  background: var(--forge-surface);
`;

const EditorHeading = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;

  > div { display: grid; gap: 2px; }
  strong { font-size: 11px; }
  span { color: var(--forge-text-muted); font-size: 8.5px; }
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;

const FieldLabel = styled.label`
  display: grid;
  gap: 4px;
  color: var(--forge-text-muted);
  font-size: 8.5px;
`;

const controlStyles = `
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  outline: none;
  color: var(--forge-text);
  background: var(--forge-surface-control);
  font: inherit;
  font-size: 9px;
`;

const TextInput = styled.input`${controlStyles}`;
const SelectInput = styled.select`${controlStyles}`;
const SecretTextarea = styled.textarea`
  ${controlStyles}
  min-height: 68px;
  resize: vertical;
  -webkit-text-security: disc;
`;

const CheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--forge-text-soft);
  font-size: 9px;
`;

const AuthSection = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-top: 9px;
  border-top: 1px solid var(--forge-border);

  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;

const EditorActions = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
`;

const SecretNotice = styled.span`
  color: var(--forge-text-muted);
  font-size: 8px;
`;

const ScopeCard = styled.section`
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-surface);
`;

const SectionHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 11px;
  font-weight: 760;
`;

const SectionSubtitle = styled.p`
  margin: 2px 0 0;
  color: var(--forge-text-muted);
  font-size: 8.5px;
`;

const ScopeFact = styled.strong`
  color: ${({ "data-recognized": recognized }) => (
    recognized === "true" ? "var(--forge-text-soft)" : "#e0a36b"
  )};
  font-size: 9px;
`;

const ScopeControls = styled.div`
  display: grid;
  grid-template-columns: minmax(140px, 240px) auto;
  justify-content: start;
  gap: 7px;
`;

const AllowedList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px 12px;
  padding: 7px;
  border: 1px dashed var(--forge-border);
  border-radius: 7px;
`;

const ReceiptNotice = styled.div`
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--forge-accent) 30%, var(--forge-border));
  border-radius: 7px;
  color: var(--forge-text-soft);
  background: color-mix(in srgb, var(--forge-accent) 6%, var(--forge-surface));
  font-size: 8.5px;
`;

const ProfileList = styled.div`
  display: grid;
  gap: 8px;
`;

const ProfileItem = styled.article`
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-surface);
`;

const ProfileHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

const ProfileIdentity = styled.div`
  display: grid;
  gap: 2px;

  strong { font-size: 11px; }
  span { color: var(--forge-text-muted); font-size: 8.5px; }
`;

const ReachabilityBadge = styled.span`
  padding: 3px 6px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-muted);
  font-size: 8px;

  &[data-reachable="true"] { color: #6fcf97; }
  &[data-unreachable="true"] { color: #ef8a8a; }
  &[data-recognized="false"] { color: #e0a36b; }
`;

const FactsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px 9px;
  color: var(--forge-text-muted);
  font-size: 8.5px;

  code, strong { color: var(--forge-text-soft); font: inherit; }
  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;

const HostKeyFacts = styled.div`
  color: var(--forge-text-muted);
  font-size: 8px;
  overflow-wrap: anywhere;

  code { color: var(--forge-text-soft); font: inherit; }
`;

const TestReceipt = styled(ReceiptNotice)`
  padding: 5px 7px;
`;

const ProfileActions = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 6px;
`;

const RemoveDisclosure = styled.details`
  color: #ef8a8a;
  font-size: 9px;

  > summary {
    padding: 5px 8px;
    border: 1px solid color-mix(in srgb, #ef6a6a 40%, var(--forge-border));
    border-radius: 6px;
    cursor: pointer;
    list-style: none;
  }
`;

const RemoveConfirm = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 6px;
  color: var(--forge-text-muted);
`;

const BoundaryNote = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 8px;
`;

const SessionFact = styled.div`
  color: var(--forge-text-muted);
  font-size: 8px;

  code { color: var(--forge-text-soft); font: inherit; }
`;
