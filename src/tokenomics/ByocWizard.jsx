import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled, { keyframes } from "styled-components";
import AppSelect from "../app/AppSelect.jsx";
import { listenShared } from "../app/sharedTauriEvents.js";

// BYOC ("bring your own cloud"): provision a server on the user's cloud
// account and auto-install the Diff Forge daemon on it. Self-contained — the
// backend contract is byoc_provider_catalog / byoc_list_server_options /
// byoc_provision / byoc_saved_providers / byoc_delete_saved_provider, plus the
// "byoc-provision-progress" event and account device presence for the online
// confirmation. Styled locally so appStyles.js stays untouched.

const BYOC_PROGRESS_EVENT = "byoc-provision-progress";
const ACCOUNT_DEVICE_LIVE_STATE_EVENT = "cloud-mcp-account-device-live-state";

// Ordered backend stages → the checklist the user watches. "online" is added
// by the UI once account presence reports the new device.
const PROVISION_STAGES = [
  { key: "minting_token", label: "Issuing provisioning token" },
  { key: "creating_server", label: "Creating the server" },
  { key: "server_created", label: "Server created" },
  { key: "installing", label: "Installing Diff Forge (cloud-init)" },
  { key: "online", label: "Daemon online" },
];

const STAGE_ORDER = PROVISION_STAGES.reduce((acc, stage, index) => {
  acc[stage.key] = index;
  return acc;
}, {});

const STEPS = ["provider", "credentials", "options", "provisioning"];

function deviceMatchesName(record, deviceName) {
  if (!record || !deviceName) return false;
  const target = String(deviceName).trim().toLowerCase();
  const candidates = [
    record.deviceName,
    record.device_name,
    record.name,
    record.hostname,
    record.label,
    record.alias,
  ];
  return candidates.some(
    (value) => typeof value === "string" && value.trim().toLowerCase() === target,
  );
}

function recordIsOnline(record) {
  if (!record || typeof record !== "object") return false;
  // The cloud presence snapshot flags a live device as connected/native_connected
  // (status "connected"), not "online".
  return Boolean(
    record.connected
      || record.native_connected
      || record.nativeConnected
      || record.online
      || record.nativeOnline
      || record.native_online
      || record.status === "connected"
      || record.presence === "online",
  );
}

function collectDeviceRecords(payload) {
  if (!payload || typeof payload !== "object") return [];
  // The event is { kind, event_kind, data: { devices: {…} } } — every other
  // consumer unwraps `.data` first; the device map lives under it.
  const snapshot = payload.data || payload.account_device_live_state_snapshot || payload;
  const bucket =
    snapshot.devices || snapshot.deviceStates || snapshot.registered_devices || snapshot.records;
  if (Array.isArray(bucket)) return bucket;
  if (bucket && typeof bucket === "object") return Object.values(bucket);
  return [];
}

export const ByocWizard = memo(function ByocWizard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ByocLauncher type="button" onClick={() => setOpen(true)}>
        <ByocLauncherIcon aria-hidden="true">☁</ByocLauncherIcon>
        <ByocLauncherText>
          <strong>Add cloud device</strong>
          <span>Provision a server and install Diff Forge on it</span>
        </ByocLauncherText>
        <ByocLauncherPlus aria-hidden="true">+</ByocLauncherPlus>
      </ByocLauncher>
      {open ? <ByocOverlay onClose={() => setOpen(false)} /> : null}
    </>
  );
});

const ByocOverlay = memo(function ByocOverlay({ onClose }) {
  const [leaving, setLeaving] = useState(false);
  const [step, setStep] = useState("provider");
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  const [savedProviders, setSavedProviders] = useState([]);

  const [providerId, setProviderId] = useState("");
  const [credentials, setCredentials] = useState({});
  const [saveCredentials, setSaveCredentials] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [serverOptions, setServerOptions] = useState(null);
  // True when the connection used on-disk saved credentials (secrets stay
  // Rust-side); provision then re-resolves them by the useSaved flag.
  const [usedSaved, setUsedSaved] = useState(false);

  const [region, setRegion] = useState("");
  const [size, setSize] = useState("");
  const [image, setImage] = useState("");
  const [deviceName, setDeviceName] = useState("");

  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");
  const [provisionId, setProvisionId] = useState("");
  const [provisionDeviceName, setProvisionDeviceName] = useState("");
  const [reachedStage, setReachedStage] = useState("");

  const provisionIdRef = useRef("");
  const provisionDeviceNameRef = useRef("");
  provisionIdRef.current = provisionId;
  provisionDeviceNameRef.current = provisionDeviceName;
  // Buffer progress events that arrive before provisionId is known (the
  // backend spawns the worker before the invoke resolves, and listenShared's
  // first registration is async) — replayed once the id lands.
  const bufferedEventsRef = useRef([]);

  const requestClose = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onClose, 200);
  }, [onClose]);

  // Esc closes unless a provision is actively running (avoid orphaning the job
  // in the user's mind mid-create).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !provisioning) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [provisioning, requestClose]);

  useEffect(() => {
    let cancelled = false;
    invoke("byoc_provider_catalog")
      .then((value) => {
        if (cancelled) return;
        setCatalog(value?.providers ? value : { providers: [] });
      })
      .catch((error) => {
        if (!cancelled) setCatalogError(String(error));
      });
    invoke("byoc_saved_providers")
      .then((value) => {
        if (!cancelled) setSavedProviders(Array.isArray(value?.providers) ? value.providers : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = useMemo(
    () => (catalog?.providers || []).find((entry) => entry.id === providerId) || null,
    [catalog, providerId],
  );

  const applyProgress = useCallback((payload) => {
    if (!payload || payload.provisionId !== provisionIdRef.current) return;
    if (payload.deviceName) {
      setProvisionDeviceName(payload.deviceName);
    }
    if (payload.error) {
      setProvisionError(String(payload.error));
      setProvisioning(false);
      return;
    }
    if (payload.stage && payload.stage in STAGE_ORDER) {
      setReachedStage((current) =>
        STAGE_ORDER[payload.stage] >= (STAGE_ORDER[current] ?? -1) ? payload.stage : current,
      );
    }
  }, []);

  // Subscribe as soon as the overlay mounts (not gated on provisionId) so no
  // early stage/error is dropped; buffer until the id is known.
  useEffect(() => {
    const unsubProgress = listenShared(BYOC_PROGRESS_EVENT, (event) => {
      const payload = event?.payload || {};
      if (!provisionIdRef.current) {
        bufferedEventsRef.current.push(payload);
        return;
      }
      applyProgress(payload);
    });
    const unsubPresence = listenShared(ACCOUNT_DEVICE_LIVE_STATE_EVENT, (event) => {
      const targetName = provisionDeviceNameRef.current;
      if (!targetName) return;
      const online = collectDeviceRecords(event?.payload).some(
        (record) => deviceMatchesName(record, targetName) && recordIsOnline(record),
      );
      if (online) {
        setReachedStage("online");
        setProvisioning(false);
      }
    });
    return () => {
      unsubProgress();
      unsubPresence();
    };
  }, [applyProgress]);

  // Replay anything buffered before the provisionId arrived.
  useEffect(() => {
    if (!provisionId || bufferedEventsRef.current.length === 0) return;
    const pending = bufferedEventsRef.current;
    bufferedEventsRef.current = [];
    pending.forEach(applyProgress);
  }, [provisionId, applyProgress]);

  const chooseProvider = useCallback(
    (id) => {
      setProviderId(id);
      setConnectError("");
      setServerOptions(null);
      const saved = savedProviders.find((entry) => entry.provider === id);
      // Saved entries never expose secrets — start fresh fields, but flag that
      // a stored credential set exists so the user knows they can reuse it by
      // re-entering (secrets are write-only from the UI).
      setCredentials({});
      setSaveCredentials(Boolean(saved));
      setStep("credentials");
    },
    [savedProviders],
  );

  const setCredentialField = useCallback((key, value) => {
    setCredentials((current) => ({ ...current, [key]: value }));
  }, []);

  const credentialsComplete = useMemo(() => {
    if (!provider) return false;
    return (provider.credentialFields || []).every((field) => {
      if (field.optional) return true;
      const value = credentials[field.key];
      return typeof value === "string" && value.trim().length > 0;
    });
  }, [provider, credentials]);

  const runConnect = useCallback(
    async (useSaved) => {
      if (!provider || connecting) return;
      setConnecting(true);
      setConnectError("");
      try {
        const options = await invoke("byoc_list_server_options", {
          provider: provider.id,
          credentials: useSaved ? {} : credentials,
          useSaved,
        });
        setUsedSaved(useSaved);
        setServerOptions(options || { regions: [], sizes: [], images: [] });
        setRegion(options?.regions?.[0]?.id || "");
        setSize(options?.sizes?.[0]?.id || "");
        setImage(options?.images?.[0]?.id || "");
        if (!deviceName) {
          setDeviceName(`byoc-${provider.id}-${Math.random().toString(36).slice(2, 7)}`);
        }
        setStep("options");
      } catch (error) {
        setConnectError(String(error));
      } finally {
        setConnecting(false);
      }
    },
    [provider, credentials, connecting, deviceName],
  );

  const connect = useCallback(() => runConnect(false), [runConnect]);
  const connectSaved = useCallback(() => runConnect(true), [runConnect]);
  const hasSavedForProvider = useMemo(
    () => Boolean(provider && savedProviders.some((entry) => entry.provider === provider.id)),
    [provider, savedProviders],
  );

  const optionsComplete = Boolean(region && size && image && deviceName.trim());

  const provision = useCallback(async () => {
    if (!provider || !optionsComplete || provisioning) return;
    setProvisioning(true);
    setProvisionError("");
    setReachedStage("");
    setStep("provisioning");
    try {
      const result = await invoke("byoc_provision", {
        request: {
          provider: provider.id,
          credentials: usedSaved ? {} : credentials,
          useSaved: usedSaved,
          region,
          size,
          image,
          deviceName: deviceName.trim(),
          saveCredentials: usedSaved ? false : saveCredentials,
        },
      });
      setProvisionId(result?.provisionId || "");
      setProvisionDeviceName(result?.deviceName || deviceName.trim());
    } catch (error) {
      setProvisionError(String(error));
      setProvisioning(false);
    }
  }, [
    provider,
    optionsComplete,
    provisioning,
    credentials,
    usedSaved,
    region,
    size,
    image,
    deviceName,
    saveCredentials,
  ]);

  const online = reachedStage === "online";
  const stepIndex = STEPS.indexOf(step);

  return createPortal(
    <ByocBackdrop
      data-leaving={leaving ? "true" : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !provisioning) requestClose();
      }}
    >
      <ByocCard role="dialog" aria-modal="true" aria-label="Add cloud device">
        <ByocHead>
          <div>
            <ByocKicker>Bring your own cloud</ByocKicker>
            <ByocTitle>Add a cloud device</ByocTitle>
          </div>
          <ByocClose type="button" onClick={requestClose} disabled={provisioning} aria-label="Close">
            ×
          </ByocClose>
        </ByocHead>

        <ByocSteps>
          {STEPS.map((name, index) => (
            <ByocStepDot
              key={name}
              data-active={index === stepIndex ? "true" : undefined}
              data-done={index < stepIndex ? "true" : undefined}
            />
          ))}
        </ByocSteps>

        <ByocBody>
          {catalogError ? <ByocError>{catalogError}</ByocError> : null}

          {step === "provider" ? (
            <ByocProviderGrid>
              {(catalog?.providers || []).map((entry) => {
                const saved = savedProviders.find((item) => item.provider === entry.id);
                return (
                  <ByocProviderCard
                    key={entry.id}
                    type="button"
                    data-selected={providerId === entry.id ? "true" : undefined}
                    onClick={() => chooseProvider(entry.id)}
                  >
                    <strong>{entry.label}</strong>
                    {saved ? <ByocSavedTag>Saved credentials</ByocSavedTag> : null}
                  </ByocProviderCard>
                );
              })}
              {!catalog ? <ByocMuted>Loading providers…</ByocMuted> : null}
            </ByocProviderGrid>
          ) : null}

          {step === "credentials" && provider ? (
            <ByocForm>
              {(provider.credentialFields || []).map((field) => (
                <ByocField key={field.key}>
                  <ByocLabel>
                    {field.label}
                    {field.optional ? <ByocOptional> optional</ByocOptional> : null}
                  </ByocLabel>
                  {field.multiline ? (
                    <ByocTextarea
                      value={credentials[field.key] || ""}
                      placeholder={field.placeholder || ""}
                      spellCheck={false}
                      onChange={(event) => setCredentialField(field.key, event.target.value)}
                    />
                  ) : (
                    <ByocInput
                      type={field.secret ? "password" : "text"}
                      value={credentials[field.key] || ""}
                      placeholder={field.placeholder || ""}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(event) => setCredentialField(field.key, event.target.value)}
                    />
                  )}
                  {field.help ? <ByocHelp>{field.help}</ByocHelp> : null}
                </ByocField>
              ))}
              <ByocCheckboxRow
                type="button"
                onClick={() => setSaveCredentials((value) => !value)}
              >
                <ByocCheckbox data-checked={saveCredentials ? "true" : undefined} aria-hidden="true">
                  {saveCredentials ? "✓" : ""}
                </ByocCheckbox>
                <span>Save these credentials on this device (stored locally, file-permission 600)</span>
              </ByocCheckboxRow>
              {connectError ? <ByocError>{connectError}</ByocError> : null}
            </ByocForm>
          ) : null}

          {step === "options" && serverOptions ? (
            <ByocForm>
              <ByocField>
                <ByocLabel>Region</ByocLabel>
                <AppSelect
                  options={(serverOptions.regions || []).map((entry) => ({
                    value: entry.id,
                    label: entry.detail ? `${entry.label} · ${entry.detail}` : entry.label,
                  }))}
                  value={region}
                  onChange={setRegion}
                  placeholder="Choose a region"
                />
              </ByocField>
              <ByocField>
                <ByocLabel>Server size</ByocLabel>
                <AppSelect
                  options={(serverOptions.sizes || []).map((entry) => ({
                    value: entry.id,
                    label: entry.priceHint
                      ? `${entry.label} · ${entry.priceHint}`
                      : entry.detail
                        ? `${entry.label} · ${entry.detail}`
                        : entry.label,
                  }))}
                  value={size}
                  onChange={setSize}
                  placeholder="Choose a size"
                />
              </ByocField>
              <ByocField>
                <ByocLabel>Operating system</ByocLabel>
                <AppSelect
                  options={(serverOptions.images || []).map((entry) => ({
                    value: entry.id,
                    label: entry.detail ? `${entry.label} · ${entry.detail}` : entry.label,
                  }))}
                  value={image}
                  onChange={setImage}
                  placeholder="Choose an OS image"
                />
              </ByocField>
              <ByocField>
                <ByocLabel>Device name</ByocLabel>
                <ByocInput
                  type="text"
                  value={deviceName}
                  spellCheck={false}
                  onChange={(event) => setDeviceName(event.target.value)}
                />
                <ByocHelp>Shown in your device list once the daemon comes online.</ByocHelp>
              </ByocField>
              {provisionError ? <ByocError>{provisionError}</ByocError> : null}
            </ByocForm>
          ) : null}

          {step === "provisioning" ? (
            <ByocProgress>
              {PROVISION_STAGES.map((stage) => {
                const reached = STAGE_ORDER[reachedStage] ?? -1;
                const done = STAGE_ORDER[stage.key] < reached || online;
                const active = STAGE_ORDER[stage.key] === reached && !online;
                return (
                  <ByocProgressRow
                    key={stage.key}
                    data-done={done ? "true" : undefined}
                    data-active={active ? "true" : undefined}
                  >
                    <ByocProgressDot data-done={done ? "true" : undefined} data-active={active ? "true" : undefined} />
                    <span>{stage.label}</span>
                  </ByocProgressRow>
                );
              })}
              {provisionError ? <ByocError>{provisionError}</ByocError> : null}
              {online ? (
                <ByocSuccess>
                  <strong>{provisionDeviceName}</strong> is online and ready.
                </ByocSuccess>
              ) : !provisionError ? (
                <ByocMuted>
                  This can take a few minutes while the server boots and installs Diff Forge. You can
                  close this window — provisioning continues in the background.
                </ByocMuted>
              ) : null}
            </ByocProgress>
          ) : null}
        </ByocBody>

        <ByocFoot>
          {step === "credentials" ? (
            <>
              <ByocGhostButton type="button" onClick={() => setStep("provider")}>
                Back
              </ByocGhostButton>
              {hasSavedForProvider ? (
                <ByocGhostButton
                  type="button"
                  disabled={connecting}
                  onClick={connectSaved}
                  style={{ marginRight: 0 }}
                >
                  Use saved
                </ByocGhostButton>
              ) : null}
              <ByocPrimaryButton
                type="button"
                disabled={!credentialsComplete || connecting}
                onClick={connect}
              >
                {connecting ? "Connecting…" : "Connect"}
              </ByocPrimaryButton>
            </>
          ) : null}
          {step === "options" ? (
            <>
              <ByocGhostButton type="button" onClick={() => setStep("credentials")}>
                Back
              </ByocGhostButton>
              <ByocPrimaryButton
                type="button"
                disabled={!optionsComplete || provisioning}
                onClick={provision}
              >
                OK — provision
              </ByocPrimaryButton>
            </>
          ) : null}
          {step === "provisioning" ? (
            <ByocPrimaryButton type="button" onClick={requestClose}>
              {online ? "Done" : "Close"}
            </ByocPrimaryButton>
          ) : null}
          {step === "provider" ? (
            <ByocMuted>Select a cloud provider to begin.</ByocMuted>
          ) : null}
        </ByocFoot>
      </ByocCard>
    </ByocBackdrop>,
    document.body,
  );
});

export default ByocWizard;

const backdropIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const cardIn = keyframes`
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const ByocLauncher = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px dashed rgba(148, 163, 184, 0.34);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.3);
  color: rgba(226, 232, 240, 0.92);
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, background 120ms ease;

  &:hover {
    border-color: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.5);
    background: rgba(var(--forge-tint-rgb, 16, 185, 129), 0.12);
  }

  html[data-forge-theme="light"] & {
    background: rgba(241, 245, 249, 0.7);
    color: rgba(30, 41, 59, 0.9);
    border-color: rgba(100, 116, 139, 0.4);
  }
`;

const ByocLauncherIcon = styled.span`
  font-size: 16px;
  line-height: 1;
`;

const ByocLauncherText = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;

  strong {
    font-size: 12px;
    font-weight: 800;
  }
  span {
    font-size: 11px;
    color: rgba(148, 163, 184, 0.8);
  }
`;

const ByocLauncherPlus = styled.span`
  font-size: 16px;
  font-weight: 800;
  color: rgba(148, 163, 184, 0.9);
`;

const ByocBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 460;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(3, 6, 12, 0.62);
  backdrop-filter: blur(6px);
  animation: ${backdropIn} 200ms ease both;

  &[data-leaving="true"] {
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
  }
`;

const ByocCard = styled.div`
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  max-height: min(86vh, 720px);
  border: 1px solid var(--forge-border-strong, rgba(148, 163, 184, 0.26));
  border-radius: 16px;
  background: var(--forge-surface-raised, #0e1726);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  animation: ${cardIn} 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(100, 116, 139, 0.28);
  }
`;

const ByocHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 12px;
`;

const ByocKicker = styled.div`
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.9);
`;

const ByocTitle = styled.div`
  margin-top: 3px;
  font-size: 17px;
  font-weight: 800;
  color: var(--forge-text, #e5edf7);

  html[data-forge-theme="light"] & {
    color: #0f172a;
  }
`;

const ByocClose = styled.button`
  flex: none;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  background: transparent;
  color: rgba(148, 163, 184, 0.9);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  &:not(:disabled):hover {
    border-color: rgba(248, 113, 113, 0.6);
    color: rgba(248, 113, 113, 0.95);
  }
`;

const ByocSteps = styled.div`
  display: flex;
  gap: 6px;
  padding: 0 20px 4px;
`;

const ByocStepDot = styled.div`
  height: 3px;
  flex: 1;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.22);
  transition: background 200ms ease;

  &[data-done="true"] {
    background: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.5);
  }
  &[data-active="true"] {
    background: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.95);
  }
`;

const ByocBody = styled.div`
  padding: 14px 20px 4px;
  overflow-y: auto;
`;

const ByocProviderGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
`;

const ByocProviderCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.4);
  color: var(--forge-text, #e5edf7);
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;

  strong {
    font-size: 13px;
    font-weight: 750;
  }

  &:hover {
    border-color: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.55);
    transform: translateY(-1px);
  }
  &[data-selected="true"] {
    border-color: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.8);
    background: rgba(var(--forge-tint-rgb, 16, 185, 129), 0.14);
  }

  html[data-forge-theme="light"] & {
    background: rgba(241, 245, 249, 0.8);
    color: #0f172a;
  }
`;

const ByocSavedTag = styled.span`
  font-size: 10px;
  font-weight: 700;
  color: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.95);
`;

const ByocForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const ByocField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ByocLabel = styled.label`
  font-size: 11.5px;
  font-weight: 750;
  color: rgba(203, 213, 225, 0.92);

  html[data-forge-theme="light"] & {
    color: rgba(51, 65, 85, 0.95);
  }
`;

const ByocOptional = styled.span`
  color: rgba(148, 163, 184, 0.7);
  font-weight: 600;
`;

const inputStyles = `
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--forge-border-strong, rgba(148, 163, 184, 0.26));
  border-radius: 8px;
  background: var(--forge-surface, rgba(13, 17, 23, 0.92));
  color: var(--forge-text, #e5edf7);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;

  &:focus {
    border-color: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.55);
    box-shadow: 0 0 0 3px rgba(var(--forge-accent-rgb, 16, 185, 129), 0.14);
  }
`;

const ByocInput = styled.input`
  ${inputStyles}
`;

const ByocTextarea = styled.textarea`
  ${inputStyles}
  min-height: 96px;
  resize: vertical;
  line-height: 1.4;
`;

const ByocHelp = styled.div`
  font-size: 10.5px;
  color: rgba(148, 163, 184, 0.78);
`;

const ByocCheckboxRow = styled.button`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(203, 213, 225, 0.9);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;

  html[data-forge-theme="light"] & {
    color: rgba(51, 65, 85, 0.95);
  }
`;

const ByocCheckbox = styled.span`
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.5);
  border-radius: 5px;
  font-size: 11px;
  font-weight: 900;
  color: #05060a;
  background: transparent;

  &[data-checked="true"] {
    background: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.95);
    border-color: transparent;
  }
`;

const ByocProgress = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 8px;
`;

const ByocProgressRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: rgba(148, 163, 184, 0.7);

  &[data-active="true"] {
    color: var(--forge-text, #e5edf7);
    font-weight: 700;
  }
  &[data-done="true"] {
    color: rgba(203, 213, 225, 0.92);
  }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const ByocProgressDot = styled.span`
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid rgba(148, 163, 184, 0.35);

  &[data-done="true"] {
    border-color: transparent;
    background: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.95);
  }
  &[data-active="true"] {
    border-color: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.9);
    border-top-color: transparent;
    animation: ${spin} 800ms linear infinite;
  }
`;

const ByocError = styled.div`
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.1);
  color: rgba(252, 165, 165, 0.95);
  font-size: 11.5px;
  word-break: break-word;
`;

const ByocSuccess = styled.div`
  padding: 10px 12px;
  border: 1px solid rgba(var(--forge-accent-rgb, 16, 185, 129), 0.4);
  border-radius: 8px;
  background: rgba(var(--forge-tint-rgb, 16, 185, 129), 0.12);
  color: var(--forge-text, #e5edf7);
  font-size: 12.5px;

  strong {
    font-weight: 800;
  }
`;

const ByocMuted = styled.div`
  font-size: 11px;
  color: rgba(148, 163, 184, 0.75);
  line-height: 1.5;
`;

const ByocFoot = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px 18px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
`;

const ByocPrimaryButton = styled.button`
  padding: 9px 16px;
  border: none;
  border-radius: 9px;
  background: rgba(var(--forge-accent-rgb, 16, 185, 129), 0.95);
  color: #05201a;
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
  transition: filter 120ms ease, opacity 120ms ease;

  &:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const ByocGhostButton = styled.button`
  padding: 9px 14px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 9px;
  background: transparent;
  color: rgba(203, 213, 225, 0.9);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  margin-right: auto;

  &:hover {
    border-color: rgba(148, 163, 184, 0.55);
  }
`;
