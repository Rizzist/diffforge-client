import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Add } from "@styled-icons/material-rounded/Add";
import { Close } from "@styled-icons/material-rounded/Close";
import { KeyboardVoice } from "@styled-icons/material-rounded/KeyboardVoice";
import { Send } from "@styled-icons/material-rounded/Send";

/* Composer for the session UI view, in the dashboard's visual language:
   a chips row (MODEL / EFFORT / SPEED / PROVIDER / ACCOUNT) above a pill
   input with mic + circular send. Enter submits, Shift+Enter newlines.

   Typing "/" at the start opens a native slash-command palette. The command
   list ships with the documented harness baseline and is replaced wholesale
   by the daemon's enumeration once the harness exposes it (pass
   `slashCommands`). Chip options likewise: current values come from the
   harness snapshot; option lists grow as the harness exposes levers —
   selections are session-local hints until then. */

const BASELINE_SLASH_COMMANDS = [
  { command: "/help", hint: "Show harness help" },
  { command: "/sessions", hint: "List sessions" },
  { command: "/model", hint: "Switch model" },
  { command: "/accounts", hint: "Provider accounts" },
  { command: "/export", hint: "Export this session" },
  { command: "/theme", hint: "TUI theme" },
];

const EFFORT_OPTIONS = ["default", "low", "medium", "high", "xhigh"];
const SPEED_OPTIONS = ["default", "fast"];

export default function SessionComposer({
  disabled = false,
  onSubmit,
  onVoice = null,
  placeholder = "Message Haider…",
  autoFocus = false,
  chipValues = {},
  chipOptions = {},
  chipCapabilities = {},
  value = "",
  onValueChange = null,
  onMirrorType = null,
  onChipChange = null,
  slashCommands = null,
}) {
  /* The draft text is SURFACE-owned (value/onValueChange): the composer
     unmounts on every view/session switch, so component-local text would be
     lost. The input_mirror_v1 reconcile (and its revision clock) lives in
     SessionSurface for the same reason; local typing still publishes into
     the daemon surface through onMirrorType. */
  const [busy, setBusy] = useState(false);
  const [openMenu, setOpenMenu] = useState("");
  const [attachments, setAttachments] = useState([]);
  const textareaRef = useRef(null);
  const rootRef = useRef(null);

  const pickAttachments = useCallback(async () => {
    try {
      const picked = await openFileDialog({ multiple: true, title: "Attach files" });
      const paths = (Array.isArray(picked) ? picked : picked ? [picked] : [])
        .map((entry) => (typeof entry === "string" ? entry : entry?.path))
        .filter(Boolean);
      if (paths.length) {
        setAttachments((current) => [
          ...current,
          ...paths.filter((path) => !current.includes(path)),
        ]);
      }
    } catch {
      // Dialog cancelled/unavailable — nothing to attach.
    }
  }, []);

  const commands = Array.isArray(slashCommands) && slashCommands.length
    ? slashCommands
    : BASELINE_SLASH_COMMANDS;
  const slashActive = value.startsWith("/") && !value.includes("\n");
  const slashMatches = useMemo(() => {
    if (!slashActive) {
      return [];
    }
    const query = value.slice(1).toLowerCase();
    return commands
      .filter((entry) => entry.command.slice(1).toLowerCase().startsWith(query))
      .slice(0, 8);
  }, [commands, slashActive, value]);

  /* Menus and palette close on outside click. */
  useEffect(() => {
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpenMenu("");
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const submit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || busy || disabled) {
      return;
    }
    setBusy(true);
    try {
      const accepted = await onSubmit(prompt, attachments);
      if (accepted !== false) {
        onValueChange?.("");
        setAttachments([]);
      }
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [attachments, busy, disabled, onSubmit, onValueChange, value]);

  const chip = (key, label, fallbackOptions = []) => {
    const current = String(chipValues[key] || "default");
    const options = Array.isArray(chipOptions[key]) && chipOptions[key].length
      ? chipOptions[key]
      : fallbackOptions;
    const display = current === "default" ? "Default" : current;
    /* Switching is gated per chip by the harness capability sniff; until the
       daemon exposes a headless door, menus browse the library read-only. */
    const switchable = chipCapabilities[`${key}_switch`] === true;
    return (
      <ChipWrap key={key}>
        <Chip
          data-open={openMenu === key ? "true" : undefined}
          onClick={() => setOpenMenu((open) => (open === key ? "" : key))}
          type="button"
        >
          <em>{label}</em>
          <span>{display}</span>
          <ChipCaret aria-hidden="true">▾</ChipCaret>
        </Chip>
        {openMenu === key && (
          <ChipMenu role="menu">
            {options.length ? options.map((option) => (
              <ChipMenuItem
                data-active={option === current ? "true" : undefined}
                data-readonly={switchable ? undefined : "true"}
                key={option}
                onClick={() => {
                  if (!switchable) {
                    return;
                  }
                  setOpenMenu("");
                  onChipChange?.(key, option);
                }}
                role="menuitem"
                type="button"
              >
                {option === "default" ? "Default" : option}
              </ChipMenuItem>
            )) : (
              <ChipMenuEmpty>Harness-managed — options arrive with the daemon integration.</ChipMenuEmpty>
            )}
            {!switchable && options.length > 0 && (
              <ChipMenuEmpty>Read-only — switching lands with the next harness update.</ChipMenuEmpty>
            )}
          </ChipMenu>
        )}
      </ChipWrap>
    );
  };

  const modelChip = () => {
    const groups = Array.isArray(chipOptions.modelGroups) ? chipOptions.modelGroups : [];
    const current = String(chipValues.model || "default");
    const provider = String(chipValues.modelProvider || "");
    const switchable = chipCapabilities.model_switch === true;
    return (
      <ChipWrap key="model">
        <Chip
          data-open={openMenu === "model" ? "true" : undefined}
          onClick={() => setOpenMenu((open) => (open === "model" ? "" : "model"))}
          type="button"
        >
          <em>Model</em>
          {provider && <ChipDim>{provider}/</ChipDim>}
          <span>{current === "default" ? "Default" : current}</span>
          <ChipCaret aria-hidden="true">▾</ChipCaret>
        </Chip>
        {openMenu === "model" && (
          <ChipMenu role="menu">
            {groups.length ? groups.map((group) => (
              <ChipGroup key={group.provider} data-unavailable={group.available ? undefined : "true"}>
                <ChipGroupHead>
                  <span>{group.provider}</span>
                  <em>{group.available ? (group.auth_state || "ready") : "no credential"}</em>
                </ChipGroupHead>
                {group.models.map((model) => (
                  <ChipMenuItem
                    data-active={model === current && group.provider === provider ? "true" : undefined}
                    data-readonly={switchable && group.available ? undefined : "true"}
                    key={`${group.provider}/${model}`}
                    onClick={() => {
                      if (!switchable || !group.available) return;
                      setOpenMenu("");
                      onChipChange?.("model", `${group.provider}/${model}`);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {model}
                  </ChipMenuItem>
                ))}
              </ChipGroup>
            )) : (
              <ChipMenuEmpty>Model catalog unavailable — is the harness running?</ChipMenuEmpty>
            )}
            {!switchable && groups.length > 0 && (
              <ChipMenuEmpty>Read-only — switching lands with the next harness update.</ChipMenuEmpty>
            )}
          </ChipMenu>
        )}
      </ChipWrap>
    );
  };

  return (
    <ComposerRoot ref={rootRef}>
      <ChipsRow>
        {modelChip()}
        {chip("effort", "Effort", EFFORT_OPTIONS)}
        {chipOptions.speedApplicable ? chip("speed", "Speed", SPEED_OPTIONS) : null}
      </ChipsRow>

      <ComposerBarWrap>
        {slashActive && slashMatches.length > 0 && (
          <SlashPalette role="listbox">
            {slashMatches.map((entry) => (
              <SlashItem
                key={entry.command}
                onClick={() => {
                  onValueChange?.(`${entry.command} `);
                  textareaRef.current?.focus();
                }}
                role="option"
                type="button"
              >
                <strong>{entry.command}</strong>
                <span>{entry.hint}</span>
              </SlashItem>
            ))}
          </SlashPalette>
        )}
        {attachments.length > 0 && (
          <AttachmentChips>
            {attachments.map((path) => (
              <AttachmentChip key={path} title={path}>
                <span>{path.split("/").pop()}</span>
                <AttachmentRemove
                  aria-label="Remove attachment"
                  onClick={() => setAttachments((current) => current.filter((entry) => entry !== path))}
                  type="button"
                >
                  <Close aria-hidden="true" />
                </AttachmentRemove>
              </AttachmentChip>
            ))}
          </AttachmentChips>
        )}
        <ComposerField data-busy={busy ? "true" : undefined}>
          <ComposerRoundButton
            aria-label="Attach files"
            data-variant="attach"
            onClick={() => void pickAttachments()}
            title="Attach files or images"
            type="button"
          >
            <Add aria-hidden="true" />
          </ComposerRoundButton>
          <ComposerInput
            autoFocus={autoFocus}
            disabled={disabled || busy}
            onChange={(event) => {
              const text = event.target.value;
              onValueChange?.(text);
              onMirrorType?.(text);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && slashActive) {
                onValueChange?.("");
                return;
              }
              if (event.key === "Tab" && slashActive && slashMatches.length) {
                event.preventDefault();
                onValueChange?.(`${slashMatches[0].command} `);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
            ref={textareaRef}
            rows={1}
            value={value}
          />
          <ComposerRoundButton
            aria-label="Voice input"
            data-variant="mic"
            disabled={!onVoice}
            onClick={() => onVoice?.()}
            title={onVoice ? "Voice input" : "Voice transcription connects with the daemon integration"}
            type="button"
          >
            <KeyboardVoice aria-hidden="true" />
          </ComposerRoundButton>
          <ComposerRoundButton
            aria-label="Send"
            data-variant="send"
            disabled={disabled || busy || !value.trim()}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? "…" : <Send aria-hidden="true" />}
          </ComposerRoundButton>
        </ComposerField>
      </ComposerBarWrap>
    </ComposerRoot>
  );
}

const ComposerRoot = styled.div`
  flex: 0 0 auto;
  /* Session Deck measure: shares the transcript column, including its
     scaling side gutter (near-none narrow → 56px before centering wins). */
  width: min(54rem, calc(100% - 2 * clamp(20px, 7%, 64px)));
  margin: 6px auto 12px;
`;

const ChipsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 6px 8px;
`;

const ChipWrap = styled.div`
  position: relative;
`;

const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10.5px;
  cursor: pointer;

  em {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-style: normal;
    font-weight: 760;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  span {
    font-weight: 700;
  }

  &:hover,
  &[data-open="true"] {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
  }
`;

const ChipCaret = styled.i`
  color: var(--forge-text-muted);
  font-size: 8px;
  font-style: normal;
`;

const ChipMenu = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 8;
  min-width: 150px;
  max-height: 220px;
  overflow-y: auto;
  display: grid;
  gap: 1px;
  padding: 4px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: var(--forge-surface-raised);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.45);
`;

const ChipMenuItem = styled.button`
  padding: 5px 9px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &[data-active="true"] {
    color: var(--forge-text);
    background: var(--forge-surface-selected);
  }

  &[data-readonly="true"] {
    opacity: 0.55;
    cursor: default;
  }
`;

const ChipDim = styled.span`
  color: var(--forge-text-muted);
  font-weight: 500;
`;

const ChipGroup = styled.div`
  &[data-unavailable="true"] {
    opacity: 0.55;
  }

  & + & {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--forge-border);
  }
`;

const ChipGroupHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 8px 2px;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;

  em {
    font-size: 8.5px;
    font-style: normal;
    font-weight: 550;
    text-transform: none;
    letter-spacing: 0;
  }
`;

const ChipMenuEmpty = styled.div`
  max-width: 190px;
  padding: 7px 9px;
  color: var(--forge-text-muted);
  font-size: 10.5px;
  line-height: 1.45;
`;

const ComposerBarWrap = styled.div`
  position: relative;
`;

const AttachmentChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 6px 6px;
`;

const AttachmentChip = styled.span`
  display: inline-flex;
  max-width: 220px;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 3px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10.5px;
  font-weight: 600;

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const AttachmentRemove = styled.button`
  display: grid;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;

  svg {
    width: 11px;
    height: 11px;
  }

  &:hover {
    color: var(--forge-text);
    background: rgba(255, 255, 255, 0.1);
  }
`;

const SlashPalette = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 8;
  display: grid;
  gap: 1px;
  padding: 5px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 12px;
  background: var(--forge-surface-raised);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
`;

const SlashItem = styled.button`
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;

  strong {
    color: var(--forge-text);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11.5px;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 10.5px;
  }

  &:hover {
    background: var(--forge-surface-hover);
  }
`;

/* Dashboard structure: one pill textarea with the mic + send circles
   absolutely positioned INSIDE its right end. */
const ComposerField = styled.div`
  position: relative;
  width: 100%;
  min-width: 0;
`;

const ComposerInput = styled.textarea`
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  max-height: min(150px, 32vh);
  resize: none;
  padding: 13px 86px 13px 48px;
  border: 1px solid var(--forge-border);
  border-radius: 24px;
  color: var(--forge-text);
  background: var(--forge-surface-raised);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  outline: none;

  &::placeholder {
    color: var(--forge-text-muted);
  }

  &:focus {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.5);
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

const ComposerRoundButton = styled.button`
  position: absolute;
  bottom: 8px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  padding: 0;
  border-radius: 999px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &[data-variant="attach"] {
    left: 8px;
    border: 1px solid var(--forge-border);
    color: var(--forge-text-muted);
    background: transparent;
  }

  &[data-variant="attach"]:hover:not(:disabled) {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
  }

  &[data-variant="mic"] {
    right: 44px;
    border: 1px solid var(--forge-border);
    color: var(--forge-text-muted);
    background: transparent;
  }

  &[data-variant="mic"]:hover:not(:disabled) {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
  }

  &[data-variant="send"] {
    right: 8px;
    border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.45);
    color: var(--forge-accent-soft);
    background: rgba(var(--forge-tint-rgb), 0.22);
  }

  &[data-variant="send"]:hover:not(:disabled) {
    color: #fff;
    border-color: var(--forge-accent);
    background: var(--forge-accent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;
