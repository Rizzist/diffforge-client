import { useCallback, useEffect, useRef, useState } from "react";

import {
  ButtonAddIcon,
  ButtonKeyIcon,
  ButtonHubIcon,
  TerminalRestartButton,
} from "../app/appStyles.js";
import { SshClientForm } from "./SshClientForm.jsx";
import {
  SSH_AUTH_KEY,
  connectTerminalSsh,
  describeSshProfile,
} from "./sshProfileContract.js";
import { useSshProfiles } from "./useSshProfiles.js";
import {
  SshPickerAddButton,
  SshPickerDivider,
  SshPickerFloating,
  SshPickerHeading,
  SshPickerMenu,
  SshPickerOption,
  SshPickerOptionIcon,
  SshPickerOptionMain,
  SshMessage,
} from "./sshStyles.js";

// Per-terminal SSH launcher. Rendered only on plain shell terminals. Opening
// the menu lazily loads the saved clients; picking one types the ssh command
// into this pane's PTY (and arms the password autofill on the backend).
export function SshClientPicker({ pane_id: paneId, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState("right");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const wrapperRef = useRef(null);
  const { profiles, status, error, isLoading, ensureLoaded, save } = useSshProfiles({ lazy: true });

  const closeMenu = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setMessage(null);
  }, []);

  const toggleMenu = useCallback(() => {
    setOpen((current) => {
      if (current) {
        return false;
      }
      ensureLoaded();
      setMessage(null);
      setCreating(false);
      const wrapper = wrapperRef.current;
      const rect = wrapper?.getBoundingClientRect();
      if (rect) {
        const menuWidth = 320;
        setAlign(rect.left + menuWidth > window.innerWidth ? "right" : "left");
      }
      return true;
    });
  }, [ensureLoaded]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      const wrapper = wrapperRef.current;
      if (
        wrapper
        && typeof Node !== "undefined"
        && event.target instanceof Node
        && wrapper.contains(event.target)
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, closeMenu]);

  const handleConnect = useCallback(async (profile) => {
    if (busy || !paneId) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await connectTerminalSsh(paneId, profile.id);
      if (result?.started) {
        closeMenu();
      } else {
        setMessage({
          tone: "error",
          text: result?.message || "Could not start the SSH session.",
        });
      }
    } catch (connectError) {
      setMessage({
        tone: "error",
        text: typeof connectError === "string"
          ? connectError
          : connectError?.message || "Could not start the SSH session.",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, closeMenu, paneId]);

  const handleCreate = useCallback(async (form) => {
    setBusy(true);
    const result = await save(form);
    setBusy(false);
    if (result.ok) {
      setCreating(false);
      setMessage({ tone: "success", text: `Saved ${result.profile?.name || "client"}.` });
    }
    return result;
  }, [save]);

  return (
    <SshPickerFloating ref={wrapperRef}>
      <TerminalRestartButton
        aria-expanded={open ? "true" : "false"}
        aria-haspopup="menu"
        aria-label="Connect over SSH"
        disabled={disabled}
        onClick={toggleMenu}
        title="Connect over SSH"
        type="button"
      >
        <ButtonAddIcon aria-hidden="true" />
      </TerminalRestartButton>
      {open && (
        <SshPickerMenu data-align={align} role="menu">
          <SshPickerHeading>
            <span>SSH clients</span>
            <span>{isLoading ? "Loading" : `${profiles.length}`}</span>
          </SshPickerHeading>

          {message && <SshMessage data-tone={message.tone}>{message.text}</SshMessage>}
          {error && <SshMessage data-tone="error">{error}</SshMessage>}

          {!creating && (
            <>
              {status !== "idle" && !isLoading && profiles.length === 0 && !error && (
                <SshMessage data-tone="info">No saved clients yet. Create one below.</SshMessage>
              )}
              {profiles.map((profile) => (
                <SshPickerOption
                  disabled={busy}
                  key={profile.id}
                  onClick={() => handleConnect(profile)}
                  role="menuitem"
                  title={`Connect to ${describeSshProfile(profile)}`}
                  type="button"
                >
                  <SshPickerOptionIcon aria-hidden="true">
                    {profile.auth_method === SSH_AUTH_KEY ? <ButtonKeyIcon /> : <ButtonHubIcon />}
                  </SshPickerOptionIcon>
                  <SshPickerOptionMain>
                    <strong>{profile.name}</strong>
                    <small>{describeSshProfile(profile)}</small>
                  </SshPickerOptionMain>
                </SshPickerOption>
              ))}
              <SshPickerDivider />
              <SshPickerAddButton onClick={() => setCreating(true)} type="button">
                <ButtonAddIcon aria-hidden="true" />
                <strong>New SSH client</strong>
              </SshPickerAddButton>
            </>
          )}

          {creating && (
            <SshClientForm
              busy={busy}
              compact
              onCancel={() => setCreating(false)}
              onSave={handleCreate}
              submitLabel="Save client"
            />
          )}
        </SshPickerMenu>
      )}
    </SshPickerFloating>
  );
}
