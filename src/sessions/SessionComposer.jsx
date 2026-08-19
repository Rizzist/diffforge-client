import { useCallback, useRef, useState } from "react";
import styled from "styled-components";

/* Composer for the session UI view. Enter submits, Shift+Enter newlines.
   The host owns what "submit" means (draft start vs in-session run). */

export default function SessionComposer({
  disabled = false,
  onSubmit,
  placeholder = "Message Haider…",
  autoFocus = false,
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef(null);

  const submit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || busy || disabled) {
      return;
    }
    setBusy(true);
    try {
      const accepted = await onSubmit(prompt);
      if (accepted !== false) {
        setValue("");
      }
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }, [busy, disabled, onSubmit, value]);

  return (
    <ComposerBar data-busy={busy ? "true" : undefined}>
      <ComposerInput
        autoFocus={autoFocus}
        disabled={disabled || busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
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
      <ComposerSend
        aria-label="Send"
        disabled={disabled || busy || !value.trim()}
        onClick={() => void submit()}
        type="button"
      >
        {busy ? "…" : "⏎"}
      </ComposerSend>
    </ComposerBar>
  );
}

const ComposerBar = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  gap: 8px;
  margin: 10px 14px 12px;
  padding: 9px 10px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 12px;
  background: var(--forge-surface-raised);

  &:focus-within {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.5);
  }
`;

const ComposerInput = styled.textarea`
  flex: 1;
  min-width: 0;
  max-height: 160px;
  resize: none;
  border: 0;
  outline: none;
  color: var(--forge-text);
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.45;

  &::placeholder {
    color: var(--forge-text-muted);
  }
`;

const ComposerSend = styled.button`
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.4);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(var(--forge-tint-rgb), 0.18);
  font-size: 12px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(var(--forge-tint-rgb), 0.3);
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
`;
