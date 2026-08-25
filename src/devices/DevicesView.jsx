import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import styled from "styled-components";
import {
  accountPushRosterRow,
  LEGACY_ACCOUNT_UNAVAILABLE_REASON,
} from "./accountPushPresentation.js";

// Push a Haider-vault account from THIS device to another connected device.
//  - Push:        copy the account credentials to the target device.
//  - Push & Wipe: copy, then surgically remove ONLY this account locally, so the
//                 same subscription is never live on two machines at once (an
//                 OAuth refresh-token rotation on one would sign the other out).
//                 This frees the local machine to run a different account.
// The Tauri backend owns the crypto/transport; this view is the control surface.

const ACCOUNT_ROSTER_CHANGED_EVENT = "account-roster-changed";
const PUSH_CHANGED_EVENT = "agent-account-push-changed";
const PUSH_AVAILABILITY_UNKNOWN = Object.freeze({
  state: "unknown",
  reason: "Account-push availability has not been published by this app.",
});

// Non-terminal states show a spinner; applied/wiped are success; failed is error.
const PUSH_STATE_TEXT = {
  sealing: "Encrypting…",
  uploading: "Sending…",
  delivered: "Delivered…",
  applied: "Account added on that device",
  wiped: "Moved — removed from this device",
  unavailable: "Account push unavailable",
  failed: "Couldn’t push",
};
const PUSH_TERMINAL = new Set(["applied", "wiped", "unavailable", "failed"]);
const PUSH_SUCCESS = new Set(["applied", "wiped"]);

function deviceIdOf(device) {
  return String(device?.device_id || device?.id || "").trim();
}

function deviceNameOf(device) {
  return String(
    device?.display_name || device?.label || device?.name || device?.device_id || "Device",
  ).trim();
}

// Web-dashboard parity: a device is ONLINE when ANY surface is live
// (`connected = native || web` on the dashboard cards). Rows from
// buildAccountLiveDeviceRows carry native_connected/web_connected/liveState;
// legacy rows may only carry connected/online.
function deviceOnlineOf(device) {
  return Boolean(
    device?.connected
      ?? (device?.native_connected
        || device?.web_connected
        || device?.liveState === "live"
        || device?.online),
  );
}

// Account push needs the NATIVE app reachable on the target — a lit WEB
// surface alone cannot receive credentials.
function deviceNativeOnlineOf(device) {
  return Boolean(device?.native_connected ?? device?.connected ?? device?.online);
}

function deviceSurfaceBadgesOf(device) {
  return [
    { active: Boolean(device?.native_connected ?? device?.connected ?? device?.online), id: "native", label: "NATIVE" },
    { active: Boolean(device?.web_connected), id: "web", label: "WEB" },
  ];
}

function devicePlatformOf(device) {
  return String(device?.platform_label || device?.platform || device?.form_factor || "").trim();
}

// null = unknown (backend hasn't published the field yet) → allow the attempt and
// let the command's error be the hard gate; false = explicitly cannot receive.
function devicePushCapableOf(device) {
  const value = device?.push_capable;
  if (value === undefined || value === null) {
    return null;
  }
  return Boolean(value);
}

function accountDisplayName(account) {
  const row = account?.source || {};
  return String(row.label || row.identity || account.alias || "Account").trim();
}

function DeviceGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none">
      <rect x="3" y="4.5" width="18" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 20h7M12 16.5V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PushGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none">
      <path d="M12 16V5M12 5l-4 4M12 5l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DevicePushPanel({
  device,
  accounts,
  availability,
  rosterAvailability,
  push,
  onSubmit,
  onDismiss,
}) {
  const roster = useMemo(
    () => (Array.isArray(accounts) ? accounts : []).map(accountPushRosterRow),
    [accounts],
  );
  const availableAccounts = useMemo(
    () => roster.filter((account) => account.state === "available"),
    [roster],
  );
  const [selectedAlias, setSelectedAlias] = useState(() => availableAccounts[0]?.alias || "");
  const [wipeArmed, setWipeArmed] = useState(false);
  const wipeTimerRef = useRef(null);

  useEffect(() => {
    // Keep the selection valid as the account list changes underneath us.
    if (!availableAccounts.some((account) => account.alias === selectedAlias)) {
      setSelectedAlias(availableAccounts[0]?.alias || "");
    }
  }, [availableAccounts, selectedAlias]);

  useEffect(() => () => {
    if (wipeTimerRef.current) {
      window.clearTimeout(wipeTimerRef.current);
    }
  }, []);

  const disarmWipe = useCallback(() => {
    setWipeArmed(false);
    if (wipeTimerRef.current) {
      window.clearTimeout(wipeTimerRef.current);
      wipeTimerRef.current = null;
    }
  }, []);

  const inFlight = Boolean(push && !PUSH_TERMINAL.has(push.state));
  const capable = devicePushCapableOf(device);
  const selectedAccount = availableAccounts.find((account) => account.alias === selectedAlias);

  const handleWipe = useCallback(() => {
    if (!wipeArmed) {
      setWipeArmed(true);
      if (wipeTimerRef.current) {
        window.clearTimeout(wipeTimerRef.current);
      }
      wipeTimerRef.current = window.setTimeout(() => setWipeArmed(false), 3200);
      return;
    }
    disarmWipe();
    onSubmit(device, {
      agent_kind: selectedAccount?.provider,
      profile_id: selectedAccount?.alias,
      wipe: true,
    });
  }, [device, disarmWipe, onSubmit, selectedAccount, wipeArmed]);

  if (availability?.state !== "available") {
    return (
      <PushPanel>
        <PushEmpty role="status">
          Account push is unavailable — {availability?.reason || PUSH_AVAILABILITY_UNKNOWN.reason}
        </PushEmpty>
        <PushPanelFooter>
          <PushGhostButton onClick={onDismiss} type="button">Close</PushGhostButton>
        </PushPanelFooter>
      </PushPanel>
    );
  }

  if (rosterAvailability?.state !== "available") {
    return (
      <PushPanel>
        <PushEmpty role="status">
          The Haider account roster is {rosterAvailability?.state === "unavailable"
            ? "unavailable"
            : "of unknown availability"}
          {rosterAvailability?.reason ? ` — ${rosterAvailability.reason}` : ""}.
        </PushEmpty>
        <PushPanelFooter>
          <PushGhostButton onClick={onDismiss} type="button">Close</PushGhostButton>
        </PushPanelFooter>
      </PushPanel>
    );
  }

  if (capable === false) {
    return (
      <PushPanel>
        <PushEmpty>
          This device is on an older version that can’t receive accounts yet. Update it, then push.
        </PushEmpty>
        <PushPanelFooter>
          <PushGhostButton onClick={onDismiss} type="button">Close</PushGhostButton>
        </PushPanelFooter>
      </PushPanel>
    );
  }

  if (!availableAccounts.length) {
    return (
      <PushPanel>
        <PushEmpty>
          No transferable Haider-vault account was published. Manage accounts in the Accounts view.
        </PushEmpty>
        {roster.some((account) => account.state === "unavailable") ? (
          <PushEmpty>{LEGACY_ACCOUNT_UNAVAILABLE_REASON}</PushEmpty>
        ) : null}
        <PushPanelFooter>
          <PushGhostButton onClick={onDismiss} type="button">Close</PushGhostButton>
        </PushPanelFooter>
      </PushPanel>
    );
  }

  const canSubmit = Boolean(selectedAccount) && !inFlight;

  return (
    <PushPanel>
      <PushFieldLabel>Account</PushFieldLabel>
      <PushAccountList>
        {availableAccounts.map((account) => {
          const name = accountDisplayName(account);
          const identity = String(account.source?.identity || "").trim();
          const selected = account.alias === selectedAlias;
          return (
            <PushAccountPill
              data-selected={selected ? "true" : undefined}
              disabled={inFlight}
              key={`${account.provider}:${account.alias}`}
              onClick={() => {
                disarmWipe();
                setSelectedAlias(account.alias);
              }}
              title={identity || name}
              type="button"
            >
              <i aria-hidden="true" data-on={selected ? "true" : undefined} />
              <span>{name}</span>
              <em>{account.provider} · {account.alias}</em>
            </PushAccountPill>
          );
        })}
      </PushAccountList>

      {push && push.state ? (
        <PushStatus data-tone={PUSH_SUCCESS.has(push.state) ? "ok" : push.state === "failed" ? "error" : "busy"}>
          {!PUSH_TERMINAL.has(push.state) ? <PushSpinner aria-hidden="true" /> : null}
          <span>
            {PUSH_STATE_TEXT[push.state] || push.state}
            {(push.state === "failed" || push.state === "unavailable") && push.message
              ? ` — ${push.message}`
              : ""}
          </span>
        </PushStatus>
      ) : null}

      <PushHint>
        <strong>Push</strong> copies this account to the device.{" "}
        <strong>Push &amp; Wipe</strong> also removes it from <em>this</em> device — only this one
        account — so the same subscription isn’t signed in on two machines at once.
      </PushHint>

      <PushPanelFooter>
        <PushGhostButton onClick={onDismiss} type="button">
          {push && PUSH_TERMINAL.has(push.state) ? "Close" : "Cancel"}
        </PushGhostButton>
        <PushSpacer />
        <PushDangerButton
          data-armed={wipeArmed ? "true" : undefined}
          disabled={!canSubmit}
          onBlur={disarmWipe}
          onClick={handleWipe}
          type="button"
        >
          {wipeArmed ? "Move here — confirm" : "Push & Wipe"}
        </PushDangerButton>
        <PushPrimaryButton
          disabled={!canSubmit}
          onClick={() => {
            disarmWipe();
            onSubmit(device, {
              agent_kind: selectedAccount?.provider,
              profile_id: selectedAccount?.alias,
              wipe: false,
            });
          }}
          type="button"
        >
          <PushGlyph />
          Push
        </PushPrimaryButton>
      </PushPanelFooter>
    </PushPanel>
  );
}

export default function DevicesView({ active = true, deviceRows = [], local_device_id: localDeviceId = "" }) {
  const [accountSnapshot, setAccountSnapshot] = useState(null);
  const [pushAvailability, setPushAvailability] = useState(PUSH_AVAILABILITY_UNKNOWN);
  const [openDeviceId, setOpenDeviceId] = useState("");
  const [pushByDevice, setPushByDevice] = useState({});

  const refreshAccounts = useCallback(() => {
    invoke("account_list", { provider: null })
      .then((snapshot) => setAccountSnapshot(snapshot || null))
      .catch((error) => setAccountSnapshot({
        availability: {
          state: "unavailable",
          reason: String(error?.message || error || "The Haider account roster is unavailable."),
        },
        descriptors: [],
      }));
  }, []);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    let unlisten = null;
    refreshAccounts();
    void invoke("account_list_watch").catch(() => {});
    void invoke("agent_account_push_availability")
      .then((availability) => {
        if (!cancelled) setPushAvailability(availability || PUSH_AVAILABILITY_UNKNOWN);
      })
      .catch(() => {
        if (!cancelled) setPushAvailability(PUSH_AVAILABILITY_UNKNOWN);
      });
    const interval = window.setInterval(refreshAccounts, 6000);
    listen(ACCOUNT_ROSTER_CHANGED_EVENT, () => {
      if (!cancelled) {
        refreshAccounts();
      }
    })
      .then((next) => {
        if (cancelled) {
          next();
          return;
        }
        unlisten = next;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (unlisten) {
        unlisten();
      }
    };
  }, [active, refreshAccounts]);

  useEffect(() => {
    let cancelled = false;
    let unlisten = null;
    listen(PUSH_CHANGED_EVENT, (event) => {
      if (cancelled) {
        return;
      }
      const payload = event?.payload || {};
      const deviceId = String(payload.target_device_id || "").trim();
      const pushId = payload.push_id || "";
      if (!deviceId) {
        return;
      }
      setPushByDevice((current) => {
        const prev = current[deviceId];
        // Ignore updates from a superseded push for the same device.
        if (prev?.push_id && pushId && prev.push_id !== pushId) {
          return current;
        }
        return {
          ...current,
          [deviceId]: {
            push_id: pushId || prev?.push_id || "",
            agent_kind: payload.agent_kind || prev?.agent_kind || "",
            profile_id: payload.profile_id || prev?.profile_id || "",
            wipe: prev?.wipe ?? false,
            state: payload.state || prev?.state || "",
            message: payload.message || "",
          },
        };
      });
    })
      .then((next) => {
        if (cancelled) {
          next();
          return;
        }
        unlisten = next;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const localId = String(localDeviceId || "").trim().toLowerCase();
  const { thisDevice, remoteDevices } = useMemo(() => {
    const seen = new Set();
    const remotes = [];
    let self = null;
    (deviceRows || []).forEach((device) => {
      const id = deviceIdOf(device).toLowerCase();
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      if (localId && id === localId) {
        self = device;
        return;
      }
      remotes.push(device);
    });
    // Online first, then alphabetical — a stable, scannable order.
    remotes.sort((a, b) => {
      const onlineDelta = Number(deviceOnlineOf(b)) - Number(deviceOnlineOf(a));
      if (onlineDelta !== 0) {
        return onlineDelta;
      }
      return deviceNameOf(a).localeCompare(deviceNameOf(b));
    });
    return { thisDevice: self, remoteDevices: remotes };
  }, [deviceRows, localId]);

  const submitPush = useCallback((device, { agent_kind: agentKind, profile_id: profileId, wipe }) => {
    const deviceId = deviceIdOf(device);
    if (!deviceId || !agentKind || !profileId) {
      return;
    }
    if (pushAvailability?.state !== "available") {
      setPushByDevice((current) => ({
        ...current,
        [deviceId]: {
          push_id: "",
          agent_kind: agentKind,
          profile_id: profileId,
          wipe,
          state: "unavailable",
          message: pushAvailability?.reason || PUSH_AVAILABILITY_UNKNOWN.reason,
        },
      }));
      return;
    }
    setPushByDevice((current) => ({
      ...current,
      [deviceId]: { push_id: "", agent_kind: agentKind, profile_id: profileId, wipe, state: "sealing", message: "" },
    }));
    invoke("agent_account_push_to_device", {
      agent_kind: agentKind,
      profile_id: profileId,
      target_device_id: deviceId,
      wipe_local_after: wipe,
    })
      .then((result) => {
        if (result?.state === "unavailable") {
          setPushAvailability(result);
          setPushByDevice((current) => ({
            ...current,
            [deviceId]: {
              ...(current[deviceId] || { agent_kind: agentKind, profile_id: profileId, wipe }),
              state: "unavailable",
              message: result.reason || "Account push is unavailable.",
            },
          }));
          return;
        }
        const pushId = result?.push_id || "";
        setPushByDevice((current) => (
          current[deviceId]
            ? { ...current, [deviceId]: { ...current[deviceId], push_id: pushId } }
            : current
        ));
      })
      .catch((error) => {
        setPushByDevice((current) => ({
          ...current,
          [deviceId]: {
            ...(current[deviceId] || { agent_kind: agentKind, profile_id: profileId, wipe }),
            state: "failed",
            message: String(error?.message || error || "Push failed."),
          },
        }));
      });
  }, [pushAvailability]);

  const dismissPush = useCallback((deviceId) => {
    setOpenDeviceId((current) => (current === deviceId ? "" : current));
    setPushByDevice((current) => {
      if (!current[deviceId]) {
        return current;
      }
      const next = { ...current };
      delete next[deviceId];
      return next;
    });
  }, []);

  return (
    <DevicesScroll aria-label="Devices" data-active={active ? "true" : undefined}>
      <DevicesInner>
        <DevicesHeader>
          <h1>Devices</h1>
          <p>
            Account push is a device feature for transferring a Haider-vault account. Its current
            availability is published by this app.
          </p>
        </DevicesHeader>

        <PushAvailabilityNotice
          data-state={pushAvailability?.state || "unknown"}
          role="status"
        >
          <strong>Account push</strong>
          <span>
            {pushAvailability?.state === "available"
              ? "Available"
              : pushAvailability?.reason || PUSH_AVAILABILITY_UNKNOWN.reason}
          </span>
        </PushAvailabilityNotice>

        {thisDevice ? (
          <DeviceCard data-self="true">
            <DeviceCardHead>
              <DeviceIconWrap>
                <DeviceGlyph />
              </DeviceIconWrap>
              <DeviceMeta>
                <DeviceName>
                  {deviceNameOf(thisDevice)}
                  <SelfTag>This device</SelfTag>
                </DeviceName>
                <DeviceSub>{devicePlatformOf(thisDevice) || "Local machine"}</DeviceSub>
              </DeviceMeta>
              <SurfaceBadgeRow aria-hidden="true">
                {deviceSurfaceBadgesOf(thisDevice).map((surface) => (
                  <SurfaceBadge
                    data-active={surface.active ? "true" : undefined}
                    data-surface={surface.id}
                    key={surface.id}
                  >
                    {surface.label}
                  </SurfaceBadge>
                ))}
              </SurfaceBadgeRow>
            </DeviceCardHead>
          </DeviceCard>
        ) : null}

        <DevicesSectionLabel>Other devices</DevicesSectionLabel>

        {remoteDevices.length === 0 ? (
          <DevicesEmpty>
            No other devices are connected to your account yet. Add a cloud device from the web
            dashboard, or sign in on another machine — it’ll show up here.
          </DevicesEmpty>
        ) : (
          remoteDevices.map((device) => {
            const deviceId = deviceIdOf(device);
            const online = deviceOnlineOf(device);
            const nativeOnline = deviceNativeOnlineOf(device);
            const push = pushByDevice[deviceId];
            const isOpen = openDeviceId === deviceId;
            return (
              <DeviceCard data-online={online ? "true" : "false"} key={deviceId}>
                <DeviceCardHead>
                  <DeviceIconWrap>
                    <DeviceGlyph />
                  </DeviceIconWrap>
                  <DeviceMeta>
                    <DeviceName>
                      <StatusDot data-online={online ? "true" : "false"} aria-hidden="true" />
                      {deviceNameOf(device)}
                    </DeviceName>
                    <DeviceSub>
                      {devicePlatformOf(device) ? `${devicePlatformOf(device)} · ` : ""}
                      {online ? "Connected" : "Offline"}
                    </DeviceSub>
                  </DeviceMeta>
                  <SurfaceBadgeRow aria-hidden="true">
                    {deviceSurfaceBadgesOf(device).map((surface) => (
                      <SurfaceBadge
                        data-active={surface.active ? "true" : undefined}
                        data-surface={surface.id}
                        key={surface.id}
                      >
                        {surface.label}
                      </SurfaceBadge>
                    ))}
                  </SurfaceBadgeRow>
                  {nativeOnline ? (
                    <PushOpenButton
                      data-open={isOpen ? "true" : undefined}
                      onClick={() => setOpenDeviceId(isOpen ? "" : deviceId)}
                      type="button"
                    >
                      <PushGlyph />
                      {isOpen ? "Close" : "Push account"}
                    </PushOpenButton>
                  ) : (
                    <OfflineNote>
                      {online ? "Open the app on it to push an account" : "Connect it to push an account"}
                    </OfflineNote>
                  )}
                </DeviceCardHead>
                {isOpen && nativeOnline ? (
                  <DevicePushPanel
                    accounts={accountSnapshot?.descriptors}
                    availability={pushAvailability}
                    device={device}
                    onDismiss={() => dismissPush(deviceId)}
                    onSubmit={submitPush}
                    push={push}
                    rosterAvailability={accountSnapshot?.availability}
                  />
                ) : push && PUSH_TERMINAL.has(push.state) ? (
                  <CardStatusStrip data-tone={PUSH_SUCCESS.has(push.state) ? "ok" : "error"}>
                    {PUSH_STATE_TEXT[push.state] || push.state}
                    {(push.state === "failed" || push.state === "unavailable") && push.message
                      ? ` — ${push.message}`
                      : ""}
                  </CardStatusStrip>
                ) : null}
              </DeviceCard>
            );
          })
        )}
      </DevicesInner>
    </DevicesScroll>
  );
}

const DevicesScroll = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 30px clamp(18px, 5vw, 56px) 72px;
`;

const DevicesInner = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
`;

const DevicesHeader = styled.header`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;

  h1 {
    margin: 0;
    color: rgba(226, 232, 240, 0.95);
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  p {
    margin: 0;
    max-width: 60ch;
    color: rgba(148, 163, 184, 0.82);
    font-size: 12.5px;
    line-height: 1.5;
  }

  html[data-forge-theme="light"] & h1 {
    color: rgba(15, 23, 42, 0.92);
  }
  html[data-forge-theme="light"] & p {
    color: #64748b;
  }
`;

const PushAvailabilityNotice = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 10px;
  color: rgba(251, 191, 36, 0.94);
  background: rgba(245, 158, 11, 0.08);
  font-size: 11.5px;
  line-height: 1.4;

  strong { flex: none; }
  span { color: rgba(203, 213, 225, 0.82); }

  &[data-state="available"] {
    border-color: rgba(74, 222, 128, 0.3);
    color: rgba(74, 222, 128, 0.94);
    background: rgba(74, 222, 128, 0.08);
  }

  html[data-forge-theme="light"] & span { color: #475569; }
`;

const DevicesSectionLabel = styled.div`
  margin-top: 8px;
  color: rgba(148, 163, 184, 0.7);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
`;

const DevicesEmpty = styled.div`
  padding: 18px 16px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  color: rgba(148, 163, 184, 0.78);
  font-size: 12px;
  line-height: 1.5;

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.28);
    color: #64748b;
  }
`;

const DeviceCard = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.4);
  transition: border-color 140ms ease;

  &[data-online="false"] {
    opacity: 0.72;
  }

  &[data-self="true"] {
    background: rgba(15, 23, 42, 0.28);
    border-style: dashed;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.2);
    background: rgba(241, 245, 249, 0.7);
  }
`;

const DeviceCardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

const DeviceIconWrap = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  color: rgba(148, 163, 184, 0.9);
  background: rgba(30, 41, 59, 0.6);

  html[data-forge-theme="light"] & {
    color: rgba(51, 65, 85, 0.85);
    background: rgba(255, 255, 255, 0.85);
  }
`;

const DeviceMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
`;

const DeviceName = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: rgba(226, 232, 240, 0.94);
  font-size: 13.5px;
  font-weight: 750;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: rgba(15, 23, 42, 0.9);
  }
`;

const DeviceSub = styled.div`
  color: rgba(148, 163, 184, 0.72);
  font-size: 11.5px;
  font-weight: 600;
`;

const SelfTag = styled.span`
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  color: rgba(148, 163, 184, 0.9);
  background: rgba(148, 163, 184, 0.14);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
`;

const StatusDot = styled.i`
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: rgba(74, 222, 128, 0.9);

  &[data-online="false"] {
    background: rgba(148, 163, 184, 0.5);
  }
`;

const OfflineNote = styled.span`
  flex: none;
  color: rgba(148, 163, 184, 0.62);
  font-size: 11px;
  font-style: italic;
`;

const SurfaceBadgeRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
`;

const SurfaceBadge = styled.span`
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: rgba(148, 163, 184, 0.55);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;

  &[data-active="true"] {
    border-color: rgba(74, 222, 128, 0.45);
    color: rgba(74, 222, 128, 0.95);
    background: rgba(74, 222, 128, 0.1);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.26);
    color: rgba(100, 116, 139, 0.6);

    &[data-active="true"] {
      border-color: rgba(22, 163, 74, 0.4);
      color: rgb(22, 163, 74);
      background: rgba(22, 163, 74, 0.08);
    }
  }
`;

const PushOpenButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 6px 12px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.55);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.95);
  background: rgba(var(--forge-tint-rgb), 0.16);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;

  &:hover {
    background: rgba(var(--forge-tint-rgb), 0.28);
  }

  &[data-open="true"] {
    color: rgba(148, 163, 184, 0.9);
    border-color: rgba(148, 163, 184, 0.3);
    background: transparent;
  }

  html[data-forge-theme="light"] & {
    color: rgba(15, 23, 42, 0.85);
  }
`;

const PushPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 12px;
  background: rgba(2, 6, 12, 0.35);

  html[data-forge-theme="light"] & {
    border-color: rgba(100, 116, 139, 0.2);
    background: rgba(255, 255, 255, 0.6);
  }
`;

const PushFieldLabel = styled.div`
  color: rgba(148, 163, 184, 0.7);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const PushAccountList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const PushAccountPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 5px 11px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  color: rgba(203, 213, 225, 0.9);
  background: rgba(30, 41, 59, 0.5);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;

  &[data-selected="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.75);
    background: rgba(var(--forge-tint-rgb), 0.2);
  }

  &:disabled {
    cursor: default;
  }

  i {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.4);
  }
  i[data-on="true"] {
    background: rgba(74, 222, 128, 0.9);
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    min-width: 0;
    overflow: hidden;
    color: rgba(148, 163, 184, 0.72);
    font-size: 10.5px;
    font-style: normal;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    color: rgba(30, 41, 59, 0.85);
    background: rgba(255, 255, 255, 0.85);
  }
`;

const PushHint = styled.p`
  margin: 2px 0 0;
  color: rgba(148, 163, 184, 0.75);
  font-size: 11px;
  line-height: 1.5;

  strong {
    color: rgba(203, 213, 225, 0.92);
    font-weight: 750;
  }

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
  html[data-forge-theme="light"] & strong {
    color: rgba(30, 41, 59, 0.9);
  }
`;

const PushEmpty = styled.div`
  color: rgba(148, 163, 184, 0.8);
  font-size: 12px;
  line-height: 1.5;
`;

const PushStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 11.5px;
  font-weight: 650;

  &[data-tone="busy"] {
    color: rgba(203, 213, 225, 0.9);
    background: rgba(30, 41, 59, 0.5);
  }
  &[data-tone="ok"] {
    color: rgba(134, 239, 172, 0.95);
    background: rgba(34, 197, 94, 0.14);
  }
  &[data-tone="error"] {
    color: rgba(252, 165, 165, 0.95);
    background: rgba(239, 68, 68, 0.14);
  }
`;

const PushSpinner = styled.span`
  width: 12px;
  height: 12px;
  flex: none;
  border-radius: 999px;
  border: 2px solid rgba(148, 163, 184, 0.35);
  border-top-color: rgba(226, 232, 240, 0.9);
  animation: push-spin 720ms linear infinite;

  @keyframes push-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const PushPanelFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
`;

const PushSpacer = styled.div`
  flex: 1 1 auto;
`;

const PushGhostButton = styled.button`
  padding: 6px 12px;
  border: 0;
  border-radius: 8px;
  color: rgba(148, 163, 184, 0.85);
  background: transparent;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    color: rgba(226, 232, 240, 0.95);
  }
`;

const PushPrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 15px;
  border: 0;
  border-radius: 9px;
  color: #fff;
  background: rgba(var(--forge-tint-rgb), 0.9);
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;
  transition: filter 120ms ease, opacity 120ms ease;

  &:hover {
    filter: brightness(1.08);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const PushDangerButton = styled.button`
  padding: 7px 13px;
  border: 1px solid rgba(214, 69, 69, 0.55);
  border-radius: 9px;
  color: rgba(252, 165, 165, 0.95);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;

  &:hover {
    color: #fff;
    background: rgba(214, 69, 69, 0.35);
  }

  &[data-armed="true"] {
    color: #fff;
    background: rgba(214, 69, 69, 0.85);
    border-color: rgba(214, 69, 69, 0.85);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const CardStatusStrip = styled.div`
  padding: 7px 12px;
  border-radius: 9px;
  font-size: 11.5px;
  font-weight: 650;

  &[data-tone="ok"] {
    color: rgba(134, 239, 172, 0.95);
    background: rgba(34, 197, 94, 0.14);
  }
  &[data-tone="error"] {
    color: rgba(252, 165, 165, 0.95);
    background: rgba(239, 68, 68, 0.14);
  }
`;
