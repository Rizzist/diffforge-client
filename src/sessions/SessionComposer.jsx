import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Add } from "@styled-icons/material-rounded/Add";
import { Close } from "@styled-icons/material-rounded/Close";
import { KeyboardVoice } from "@styled-icons/material-rounded/KeyboardVoice";
import { Send } from "@styled-icons/material-rounded/Send";

import { modelGroupSelectionState } from "./haiderClientContract.js";
import {
  DELIVERY_MODES,
  deliveryModePresentation,
  normalizeDeliveryMode,
} from "./sessionSubmit.js";

/* Composer for the session UI view, in the dashboard's visual language:
   a chips row (MODEL / EFFORT / SPEED / PROVIDER / ACCOUNT) above a pill
   input with mic + circular send. Enter submits, Shift+Enter newlines.

   Typing "/" at the start opens the daemon-listed command palette. There is
   deliberately no fallback catalog: presenting commands without the
   command_door_v1 feature would advertise a UI that cannot execute. */

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
  /* Large text pastes collapse into blocks ABOVE the input (Next.js chat
     behavior) — SURFACE-owned like the draft text so they survive view and
     session switches; the MIRRORED text and the submitted prompt carry the
     full content (blocks + typed). */
  pastedBlocks = [],
  onPastedBlocksChange = null,
  onMirrorType = null,
  onChipChange = null,
  onChipMenuOpen = null,
  slashCommands = [],
  commandNotice = null,
  commandMenuRequest = null,
  /* input_mirror_attachments_v1: refs staged on ANOTHER surface (the TUI)
     render as read-only chips. Local attachments are SURFACE-owned like the
     paste blocks (the composer unmounts on every view switch — local state
     silently dropped them from both the submit and the mirror); change
     callbacks accept updater functions so async stage callbacks can't
     clobber each other. */
  mirrorAttachments = [],
  attachments = [],
  onAttachmentsChange = null,
  /* Set while a submit is waiting for its session to come up. The typed text
     stays put and un-editable rather than being cleared or lost — editing it
     mid-flight would send something the user never finished writing. */
  holdNotice = "",
  /* Present only while a turn is running AND the harness has told us which
     run it is. Absent means no stop button — never a guess. */
  onCancelTurn = null,
  /* SessionSurface supplies this callback only with queue_control_v1. Its
     absence removes the chip as well as the mode-selection callback. */
  deliveryMode = "queue",
  onDeliveryModeChange = null,
  /* Draft-only, create-time controls. Existing sessions never receive these
     props, so interaction mode cannot masquerade as a live session toggle. */
  createOptions = null,
  createCapabilities = {},
  onCreateOptionChange = null,
}) {
  /* The draft text is SURFACE-owned (value/onValueChange): the composer
     unmounts on every view/session switch, so component-local text would be
     lost. The input_mirror_v1 reconcile (and its revision clock) lives in
     SessionSurface for the same reason; local typing still publishes into
     the daemon surface through onMirrorType. */
  const [busy, setBusy] = useState(false);
  const [openMenu, setOpenMenu] = useState("");
  const handledCommandMenuRef = useRef(0);
  useEffect(() => {
    const sequence = Number(commandMenuRequest?.sequence || 0);
    if (!sequence || sequence === handledCommandMenuRef.current) return;
    handledCommandMenuRef.current = sequence;
    if (commandMenuRequest?.menu === "model") setOpenMenu("model");
  }, [commandMenuRequest]);
  /* Ref-backed stable identity: the surface passes a fresh inline callback
     every render, and several callers live inside memoized callbacks whose
     dependency arrays must not need to track it. */
  const onAttachmentsChangeRef = useRef(onAttachmentsChange);
  onAttachmentsChangeRef.current = onAttachmentsChange;
  const setAttachments = useCallback((next) => {
    onAttachmentsChangeRef.current?.(next);
  }, []);
  const pasteIdRef = useRef(0);
  const textareaRef = useRef(null);
  const rootRef = useRef(null);

  const compositeText = useCallback((blocks, typed) => {
    const parts = blocks.map((block) => block.text);
    if (typed.trim() || !parts.length) parts.push(typed);
    return parts.join("\n\n");
  }, []);

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

  const commands = Array.isArray(slashCommands) ? slashCommands : [];
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

  /* Image stages are async: Send holds until every pending stage has landed
     in `attachments`, or a paste-then-instant-Enter submits without its
     image and ghosts it onto the next prompt. */
  const [pendingStages, setPendingStages] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const cancelTurn = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await onCancelTurn?.();
    } finally {
      setCancelling(false);
    }
  }, [cancelling, onCancelTurn]);
  const submit = useCallback(async () => {
    const prompt = compositeText(pastedBlocks, value).trim();
    if (!prompt || busy || disabled || pendingStages > 0) {
      return;
    }
    setBusy(true);
    try {
      /* Text/blocks/mirror clearing is SURFACE-owned (generation-guarded in
         submitIntoSession) — a stale completion after a session switch must
         never wipe fresh edits. Attachments are ours; clear locally. */
      const accepted = await onSubmit(
        prompt,
        attachments,
        normalizeDeliveryMode(deliveryMode),
      );
      if (accepted !== false) {
        setAttachments([]);
      }
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [attachments, busy, compositeText, deliveryMode, disabled, onSubmit, pastedBlocks, value]);

  /* Paste routing: image clipboard items stage to temp files and join the
     attachments; oversized text pastes become blocks above the input. Both
     republish the mirror so the TUI sees the same full text. */
  const PASTE_BLOCK_THRESHOLD = 1500;
  const PASTE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
  const PASTE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const handlePaste = useCallback((event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItems = items.filter(
      (item) => item.kind === "file" && PASTE_IMAGE_MIMES.has(item.type),
    );
    if (imageItems.length) {
      event.preventDefault();
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file || file.size === 0 || file.size > PASTE_IMAGE_MAX_BYTES) continue;
        /* readAsDataURL: the browser produces base64 natively — no per-byte
           JS array, bounded by the size cap above. */
        setPendingStages((count) => count + 1);
        const settle = () => setPendingStages((count) => Math.max(0, count - 1));
        const reader = new FileReader();
        reader.onerror = settle;
        reader.onload = () => {
          const result = String(reader.result || "");
          const comma = result.indexOf(",");
          const bytes = comma >= 0 ? result.slice(comma + 1) : "";
          if (!bytes) {
            settle();
            return;
          }
          void invoke("stage_pasted_image", { bytes, mime: file.type })
            .then((path) => {
              if (typeof path === "string" && path) {
                setAttachments((current) => (
                  current.includes(path) ? current : [...current, path]
                ));
              }
            })
            .catch(() => {})
            .finally(settle);
        };
        reader.readAsDataURL(file);
      }
      return;
    }
    const text = event.clipboardData?.getData("text/plain") || "";
    if (text.length > PASTE_BLOCK_THRESHOLD) {
      event.preventDefault();
      pasteIdRef.current += 1;
      const block = {
        id: `paste-${Date.now()}-${pasteIdRef.current}`,
        text,
        lines: text.split("\n").length,
        chars: text.length,
      };
      const next = [...pastedBlocks, block];
      onPastedBlocksChange?.(next);
      onMirrorType?.(compositeText(next, value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeText, onMirrorType, onPastedBlocksChange, pastedBlocks, value]);

  const removePastedBlock = useCallback((id) => {
    const next = pastedBlocks.filter((block) => block.id !== id);
    onPastedBlocksChange?.(next);
    onMirrorType?.(compositeText(next, value));
  }, [compositeText, onMirrorType, onPastedBlocksChange, pastedBlocks, value]);

  /* Staged paste images are OURS to clean: removing the chip deletes the
     temp file (guarded server-side to the staging prefix). */
  const removeAttachment = useCallback((path) => {
    setAttachments((current) => current.filter((entry) => entry !== path));
    if (path.includes("diffforge-paste-")) {
      void invoke("discard_staged_attachment", { path }).catch(() => {});
    }
  }, []);

  const chip = (key, label) => {
    const current = chipValues[key] == null ? "unknown" : String(chipValues[key]);
    const options = Array.isArray(chipOptions[key]) ? chipOptions[key] : [];
    const display = current === "default" ? "Default" : current === "unknown" ? "Unknown" : current;
    /* Switching is gated per chip by the harness capability sniff; until the
       daemon exposes a headless door, menus browse the library read-only. */
    const switchable = chipCapabilities[`${key}_switch`] === true;
    return (
      <ChipWrap key={key}>
        <Chip
          data-open={openMenu === key ? "true" : undefined}
          onClick={() => {
            /* Config detail loads lazily at menu-open — the click path that
               SELECTS a session never fetches (chips render from the roster
               row the bridge already mirrors). */
            if (openMenu !== key) onChipMenuOpen?.();
            setOpenMenu((open) => (open === key ? "" : key));
          }}
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
    const current = chipValues.model == null ? "unknown" : String(chipValues.model);
    const provider = String(chipValues.modelProvider || "");
    const switchable = chipCapabilities.model_switch === true;
    return (
      <ChipWrap key="model">
        <Chip
          data-open={openMenu === "model" ? "true" : undefined}
          onClick={() => {
            if (openMenu !== "model") onChipMenuOpen?.();
            setOpenMenu((open) => (open === "model" ? "" : "model"));
          }}
          type="button"
        >
          <em>Model</em>
          {provider && <ChipDim>{provider}/</ChipDim>}
          <span>{current === "default" ? "Default" : current === "unknown" ? "Unknown" : current}</span>
          <ChipCaret aria-hidden="true">▾</ChipCaret>
        </Chip>
        {openMenu === "model" && (
          <ChipMenu role="menu">
            {groups.length ? groups.map((group) => {
              const selection = modelGroupSelectionState(group, switchable);
              return (
                <ChipGroup
                  data-availability={group.availability}
                  data-disabled={group.enabled === false ? "true" : undefined}
                  key={group.provider}
                >
                  <ChipGroupHead>
                    <span>{group.provider}</span>
                    <em>{group.status || "availability unknown"}</em>
                  </ChipGroupHead>
                  {group.models.map((model) => (
                    <ChipMenuItem
                      aria-disabled={selection.selectable ? undefined : "true"}
                      data-active={model === current && group.provider === provider ? "true" : undefined}
                      data-readonly={selection.selectable ? undefined : "true"}
                      data-readonly-reason={selection.reason || undefined}
                      key={`${group.provider}/${model}`}
                      onClick={() => {
                        if (!selection.selectable) return;
                        setOpenMenu("");
                        onChipChange?.("model", `${group.provider}/${model}`);
                      }}
                      role="menuitem"
                      title={selection.label || undefined}
                      type="button"
                    >
                      {model}
                    </ChipMenuItem>
                  ))}
                </ChipGroup>
              );
            }) : (
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

  const deliveryModeChip = () => {
    if (!onDeliveryModeChange) return null;
    const selected = normalizeDeliveryMode(deliveryMode);
    const current = deliveryModePresentation(selected);
    return (
      <ChipWrap key="delivery-mode">
        <Chip
          data-open={openMenu === "delivery-mode" ? "true" : undefined}
          onClick={() => setOpenMenu((open) => (
            open === "delivery-mode" ? "" : "delivery-mode"
          ))}
          type="button"
        >
          <em>Send</em>
          <span>{current.label}</span>
          <ChipCaret aria-hidden="true">▾</ChipCaret>
        </Chip>
        {openMenu === "delivery-mode" && (
          <ChipMenu role="menu">
            {DELIVERY_MODES.map((mode) => (
              <DeliveryModeItem
                data-active={mode.value === selected ? "true" : undefined}
                key={mode.value}
                onClick={() => {
                  setOpenMenu("");
                  onDeliveryModeChange(mode.value);
                }}
                role="menuitem"
                type="button"
              >
                <strong>{mode.label}</strong>
                <span>{mode.detail}</span>
              </DeliveryModeItem>
            ))}
          </ChipMenu>
        )}
      </ChipWrap>
    );
  };

  const interactionModeChip = () => {
    if (!createOptions) return null;
    const selected = ["interactive", "autonomous"].includes(createOptions.interactionMode)
      ? createOptions.interactionMode
      : "";
    const modes = [
      {
        value: "",
        label: "Daemon default",
        detail: "No interaction mode is sent; the daemon chooses its default.",
      },
      {
        value: "interactive",
        label: "Interactive",
        detail: "The session may pause for operator input.",
      },
      ...(createCapabilities.autonomous ? [{
        value: "autonomous",
        label: "Autonomous",
        detail: "Acts without interaction pauses; permissions still apply.",
      }] : []),
    ];
    const current = modes.find((mode) => mode.value === selected) || modes[0];
    return (
      <ChipWrap key="create-interaction">
        <Chip
          data-open={openMenu === "create-interaction" ? "true" : undefined}
          onClick={() => setOpenMenu((open) => (
            open === "create-interaction" ? "" : "create-interaction"
          ))}
          type="button"
        >
          <em>Interaction</em>
          <span>{current.label}</span>
          <ChipCaret aria-hidden="true">▾</ChipCaret>
        </Chip>
        {openMenu === "create-interaction" && (
          <ChipMenu role="menu">
            {modes.map((mode) => (
              <DeliveryModeItem
                data-active={mode.value === selected ? "true" : undefined}
                key={mode.value || "daemon-default"}
                onClick={() => {
                  setOpenMenu("");
                  onCreateOptionChange?.("interactionMode", mode.value);
                }}
                role="menuitem"
                type="button"
              >
                <strong>{mode.label}</strong>
                <span>{mode.detail}</span>
              </DeliveryModeItem>
            ))}
          </ChipMenu>
        )}
      </ChipWrap>
    );
  };

  const permissionOverrideChip = () => {
    if (!createOptions || !createCapabilities.permissionOverrides) return null;
    const autoAllow = createOptions.autoAllow === true;
    return (
      <ChipWrap key="create-permissions">
        <Chip
          data-open={openMenu === "create-permissions" ? "true" : undefined}
          onClick={() => setOpenMenu((open) => (
            open === "create-permissions" ? "" : "create-permissions"
          ))}
          type="button"
        >
          <em>Permissions</em>
          <span>{autoAllow ? "Auto-allow" : "Daemon policy"}</span>
          <ChipCaret aria-hidden="true">▾</ChipCaret>
        </Chip>
        {openMenu === "create-permissions" && (
          <ChipMenu role="menu">
            <DeliveryModeItem
              data-active={!autoAllow ? "true" : undefined}
              onClick={() => {
                setOpenMenu("");
                onCreateOptionChange?.("autoAllow", false);
              }}
              role="menuitem"
              type="button"
            >
              <strong>Daemon policy</strong>
              <span>No permission override is sent.</span>
            </DeliveryModeItem>
            <DeliveryModeItem
              data-active={autoAllow ? "true" : undefined}
              onClick={() => {
                setOpenMenu("");
                onCreateOptionChange?.("autoAllow", true);
              }}
              role="menuitem"
              type="button"
            >
              <strong>Auto-allow</strong>
              <span>Auto-allows permission requests; separate from autonomy.</span>
            </DeliveryModeItem>
          </ChipMenu>
        )}
      </ChipWrap>
    );
  };

  return (
    <ComposerRoot ref={rootRef}>
      <ChipsRow>
        {modelChip()}
        {chip("effort", "Effort")}
        {chipOptions.speedApplicable ? chip("speed", "Speed") : null}
        {interactionModeChip()}
        {permissionOverrideChip()}
        {createOptions && (
          <CreateTokenField title="Create-time maximum output tokens">
            <em>Max output</em>
            <input
              aria-label="Maximum output tokens"
              inputMode="numeric"
              min="1"
              onChange={(event) => onCreateOptionChange?.("maxTokens", event.target.value)}
              step="1"
              type="number"
              value={createOptions.maxTokens}
            />
          </CreateTokenField>
        )}
        {deliveryModeChip()}
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
        {pastedBlocks.length > 0 && (
          <AttachmentChips>
            {pastedBlocks.map((block) => (
              <PastedBlockChip key={block.id} title={`${block.chars} characters`}>
                <PastedBlockGlyph aria-hidden="true">¶</PastedBlockGlyph>
                <span>Pasted · {block.lines} lines</span>
                <AttachmentRemove
                  aria-label="Remove pasted block"
                  onClick={() => removePastedBlock(block.id)}
                  type="button"
                >
                  <Close aria-hidden="true" />
                </AttachmentRemove>
              </PastedBlockChip>
            ))}
          </AttachmentChips>
        )}
        {attachments.length > 0 && (
          <AttachmentChips>
            {attachments.map((path) => (
              <AttachmentChip key={path} title={path}>
                <span>{path.split("/").pop()}</span>
                <AttachmentRemove
                  aria-label="Remove attachment"
                  onClick={() => removeAttachment(path)}
                  type="button"
                >
                  <Close aria-hidden="true" />
                </AttachmentRemove>
              </AttachmentChip>
            ))}
          </AttachmentChips>
        )}
        {mirrorAttachments.length > 0 && (
          <AttachmentChips>
            {mirrorAttachments.map((ref) => (
              <AttachmentChip
                data-mirror="true"
                key={ref.artifact || ref.name}
                title={ref.mime ? `${ref.mime} · staged in the TUI` : "staged in the TUI"}
              >
                <span>
                  {(ref.name || ref.artifact || "attachment").slice(0, 18)}
                </span>
              </AttachmentChip>
            ))}
          </AttachmentChips>
        )}
        {/* The text is already held un-editable while a submit is in flight;
            without this the user just sees a frozen composer and no reason. */}
        {commandNotice?.message && (
          <CommandNotice data-type={commandNotice.type || "result"} role="status">
            {commandNotice.message}
          </CommandNotice>
        )}
        {holdNotice && <HoldNotice role="status">{holdNotice}</HoldNotice>}
        <ComposerField data-busy={busy || holdNotice ? "true" : undefined}>
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
            $hasStop={Boolean(onCancelTurn)}
            autoFocus={autoFocus}
            disabled={disabled || busy || Boolean(holdNotice)}
            onChange={(event) => {
              const text = event.target.value;
              onValueChange?.(text);
              /* The mirror carries the FULL composer content — paste blocks
                 included — so the TUI input line matches what will submit. */
              onMirrorType?.(compositeText(pastedBlocks, text));
            }}
            onPaste={handlePaste}
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
            data-shifted={onCancelTurn ? "true" : undefined}
            data-variant="mic"
            disabled={!onVoice}
            onClick={() => onVoice?.()}
            title={onVoice ? "Voice input" : "Voice transcription connects with the daemon integration"}
            type="button"
          >
            <KeyboardVoice aria-hidden="true" />
          </ComposerRoundButton>
          {/* Stop is additive to Send. Mid-turn Send is how Queue, Steer, and
              Subturn are submitted; replacing it with Stop would make those
              modes keyboard-only exactly when they matter. Stop still exists
              only when the harness names the exact cancellable run. */}
          {onCancelTurn && (
            <ComposerRoundButton
              aria-label="Stop"
              data-variant="stop"
              disabled={cancelling}
              onClick={() => void cancelTurn()}
              title="Stop this turn"
              type="button"
            >
              {cancelling ? "…" : <StopGlyph aria-hidden="true" />}
            </ComposerRoundButton>
          )}
          <ComposerRoundButton
            aria-label="Send"
            data-variant="send"
            disabled={disabled || busy || pendingStages > 0 || !compositeText(pastedBlocks, value).trim()}
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
  width: min(48.5rem, calc(100% - 2 * clamp(20px, 7%, 64px)));
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

const CreateTokenField = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10.5px;

  em {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-style: normal;
    font-weight: 760;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  input {
    width: 62px;
    padding: 0;
    border: 0;
    outline: 0;
    color: var(--forge-text);
    background: transparent;
    font: inherit;
    font-weight: 700;
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

const DeliveryModeItem = styled(ChipMenuItem)`
  display: grid;
  gap: 2px;

  strong {
    font-size: 11px;
  }

  span {
    max-width: 190px;
    color: var(--forge-text-muted);
    font-size: 9.5px;
    font-weight: 500;
    line-height: 1.35;
    white-space: normal;
  }
`;

const ChipDim = styled.span`
  color: var(--forge-text-muted);
  font-weight: 500;
`;

const ChipGroup = styled.div`
  &[data-availability="unavailable"],
  &[data-disabled="true"] {
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

/* A square inside the round button — the universal "stop", and shape-distinct
   from the send arrow so the control never reads ambiguously mid-turn. */
const StopGlyph = styled.i`
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
`;

const HoldNotice = styled.p`
  margin: 0 0 6px;
  padding-left: 2px;
  color: var(--forge-amber);
  font-size: 11.5px;
`;

const CommandNotice = styled.p`
  margin: 0 0 6px;
  padding-left: 2px;
  color: var(--forge-text-soft);
  font-size: 11.5px;
  line-height: 1.4;

  &[data-type="error"],
  &[data-type="refused"],
  &[data-type="unhandled"],
  &[data-type="unsupported"] {
    color: var(--forge-amber);
  }
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

  /* Read-only refs mirrored from another surface (TUI): dimmed, no remove. */
  &[data-mirror="true"] {
    padding-right: 10px;
    border-style: dashed;
    color: var(--forge-text-muted);
  }
`;

/* Big-paste block: same chip family, tinted so it reads as content-to-send
   rather than a file. */
const PastedBlockChip = styled(AttachmentChip)`
  border-color: rgba(var(--forge-tint-soft-rgb), 0.4);
  background: rgba(var(--forge-tint-rgb), 0.1);
`;

const PastedBlockGlyph = styled.em`
  flex: 0 0 auto;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-style: normal;
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
  padding: 13px ${({ $hasStop }) => ($hasStop ? "122px" : "86px")} 13px 48px;
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

  &[data-variant="mic"][data-shifted="true"] {
    right: 80px;
  }

  &[data-variant="mic"]:hover:not(:disabled) {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
  }

  &[data-variant="stop"] {
    right: 44px;
    border: 1px solid rgba(255, 108, 108, 0.42);
    color: var(--forge-red);
    background: rgba(255, 78, 78, 0.1);
  }

  &[data-variant="stop"]:hover:not(:disabled) {
    color: #fff;
    border-color: var(--forge-red);
    background: var(--forge-red);
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
