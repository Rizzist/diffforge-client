import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import styled from "styled-components";
import {
  answerNeedsInputWithReconnect,
  isNeedsInputCardAnswerable,
  needsInputFailureMessage,
} from "./needsInputAnswer.js";

/* 937 session_needs_input_v1: ONE card renders every human park — permission,
   recovery, update, secret, question, trust_hook, choice, conflict, file,
   exhausted, and whatever the daemon adds next. The harness owns the park and
   its vocabulary; this only renders what it published and answers through
   menu.answer. The `kind` enum GROWS, so nothing here may switch
   exhaustively: an unknown kind renders the generic arm rather than nothing. */

/* Only the label differs by kind — the card shape is deliberately identical
   everywhere so a new kind is legible on the day it ships. */
const KIND_LABELS = {
  permission: "Permission needed",
  recovery: "Recovery needed",
  update: "Update available",
  secret: "Secret needed",
  question: "Question",
  trust_hook: "Trust check",
  choice: "Choose",
  conflict: "Conflict",
  file: "File decision",
  exhausted: "Limit reached",
  approval: "Approval needed",
  /* The daemon's own catch-all value: a neutral label beats echoing the
     literal word "unknown" at the user. */
  unknown: "Needs you",
};

function kindLabel(kind) {
  const clean = String(kind || "").trim();
  if (KIND_LABELS[clean]) return KIND_LABELS[clean];
  /* Unknown (newer daemon than this build): show the raw kind humanised
     rather than a wrong guess or an empty card. */
  return clean ? clean.replace(/_/g, " ") : "Needs you";
}

const OS_PERMISSION_PREFIX = "computer-os-permission-";
/* SystemPermission::as_str in the harness protocol. Adding one here is a
   deliberate act, which is the point. */
const OS_PERMISSIONS = ["screen_recording", "accessibility"];
const OPEN_SETTINGS_KEY = "__open_settings__";

export default function NeedsInputCard({
  card,
  sessionId,
  onAnswered = null,
}) {
  const [busyKey, setBusyKey] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState("");
  /* Answer state belongs to ONE park. Without this, a card replaced while an
     answer is in flight inherits the previous card's disabled buttons and
     error line — and a never-resolving call would wedge its successor. */
  const parkKey = `${card?.menu_id || ""}:${card?.request_seq ?? ""}`;
  const parkKeyRef = useRef(parkKey);
  if (parkKeyRef.current !== parkKey) {
    parkKeyRef.current = parkKey;
    if (busyKey) setBusyKey("");
    if (error) setError("");
  }

  const answer = useCallback(async (optionKey) => {
    if (busyKey) return;
    setBusyKey(optionKey);
    setError("");
    try {
      await answerNeedsInputWithReconnect({
        invokeAnswer: () => (
          /* menu_id/request_seq/worker_generation ride VERBATIM off the card
             — they are the daemon's staleness fence, never re-derived. */
          invoke("session_answer_menu", {
            session_id: sessionId,
            menu_id: card.menu_id,
            request_seq: card.request_seq,
            worker_generation: card.worker_generation,
            option_key: optionKey,
          })
        ),
        onReconnect: () => setReconnecting(true),
      });
      onAnswered?.();
    } catch (failure) {
      setError(needsInputFailureMessage(failure));
    } finally {
      setBusyKey("");
      setReconnecting(false);
    }
  }, [busyKey, card, onAnswered, sessionId]);

  /* EVERY field but kind and title is omit-when-default on the wire, so the
     minimal card is literally {kind, title} and absent always means the
     default — never "unknown". */
  const options = Array.isArray(card?.options) ? card.options : [];
  const body = Array.isArray(card?.safe_body) ? card.safe_body : [];
  /* Those are also the daemon's CAS fence: without all three the card is
     informational, and offering buttons would answer with nulls. Checked
     STRICTLY — Number(null) and Number("") are both a finite 0, so coercion
     would let a fenceless card through as answerable. */
  const answerable = isNeedsInputCardAnswerable(card);
  /* secret_answer absent means false. Those cards are badge-only by design —
     answered where the vault input lives, never here. */
  const secret = card?.secret_answer === true;
  /* An OS permission park. The daemon builds the menu id as
     `computer-os-permission-{effect}-{permission}` (worker.rs), and keys the
     open-settings door by the FULL menu id, so the only thing to derive is
     the trailing permission name. */
  const osPermission = (() => {
    const menuId = String(card?.menu_id || "");
    if (card?.kind !== "permission" || !menuId.startsWith(OS_PERMISSION_PREFIX)) return "";
    /* Match KNOWN names rather than taking everything after the last dash:
       today no permission contains a dash, but the day one does, splitting
       would send a wrong permission SILENTLY — and this door opens system
       panes. An unrecognised name yields no button, so the card degrades to
       "you can still Retry" instead of guessing which pane to open. */
    return OS_PERMISSIONS.find((name) => menuId.endsWith(`-${name}`)) || "";
  })();

  const openSettings = useCallback(async () => {
    if (busyKey || !osPermission) return;
    setBusyKey(OPEN_SETTINGS_KEY);
    setError("");
    try {
      await invoke("computer_permission_open_settings", {
        session_id: sessionId,
        menu_id: card.menu_id,
        permission: osPermission,
      });
    } catch (failure) {
      setError(needsInputFailureMessage(failure, "System Settings did not open."));
    } finally {
      setBusyKey("");
    }
  }, [busyKey, card?.menu_id, osPermission, sessionId]);

  return (
    <Card data-kind={card?.kind || "unknown"} role="group">
      <Head>
        <KindTag>{kindLabel(card?.kind)}</KindTag>
        {card?.title && <Title>{card.title}</Title>}
      </Head>

      {/* Law 4: the daemon strips body and options from secret menus because
          their durable body is the one place vaulted material could appear.
          Inventing copy here would claim an answer location it never
          published — the badge IS the whole card. */}
      {secret ? null : (
        <>
          {body.length > 0 && (
            <Body>
              {body.map((line, index) => (
                // Evidence lines are positional and may legitimately repeat.
                // eslint-disable-next-line react/no-array-index-key
                <li key={index}>{line}</li>
              ))}
            </Body>
          )}
          {answerable && (
            <Options>
              {/* An OS permission park cannot be answered by the menu alone:
                  macOS needs a real grant, so the card's own option can only
                  re-check. This opens the right pane on the machine running
                  the DAEMON — the one missing the permission — which stays
                  correct even when this UI is somewhere else entirely. */}
              {osPermission && (
                <OptionButton
                  disabled={Boolean(busyKey)}
                  onClick={() => void openSettings()}
                  type="button"
                >
                  <span>{busyKey === OPEN_SETTINGS_KEY ? "opening…" : "Open Settings"}</span>
                  <OptionDetail>Grant it, then re-check.</OptionDetail>
                </OptionButton>
              )}
              {options.map((option) => (
                <OptionButton
                  disabled={Boolean(busyKey)}
                  key={option.key}
                  onClick={() => void answer(option.key)}
                  title={option.detail || undefined}
                  type="button"
                >
                  <span>
                    {busyKey === option.key
                      ? (reconnecting ? "reconnecting…" : "…")
                      : (option.label || option.key)}
                  </span>
                  {/* The consequence the daemon wrote for this choice. It was
                      tooltip-only, which hides the one thing that makes the
                      choice informed — an answer is not reversible. */}
                  {option.detail && <OptionDetail>{option.detail}</OptionDetail>}
                </OptionButton>
              ))}
            </Options>
          )}
        </>
      )}

      {error && <ErrorLine role="status">{error}</ErrorLine>}
    </Card>
  );
}

const Card = styled.div`
  width: 100%;
  max-width: 48.5rem;
  margin: 10px auto;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--forge-amber) 42%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--forge-amber) 7%, var(--forge-surface));
`;

const Head = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
`;

const KindTag = styled.span`
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--forge-amber);
  background: color-mix(in srgb, var(--forge-amber) 15%, transparent);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const Title = styled.strong`
  min-width: 0;
  color: var(--forge-text);
  font-size: 13.5px;
  font-weight: 640;
`;

const Body = styled.ul`
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--forge-chat-text);
  font-size: 12.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;

  li { margin: 2px 0; }
`;

const Options = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 11px;
`;

const OptionDetail = styled.span`
  color: var(--forge-text-muted);
  font-size: 10.5px;
  font-weight: 500;
`;

const OptionButton = styled.button`
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 4px 13px;
  border: 1px solid color-mix(in srgb, var(--forge-amber) 45%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--forge-text);
  font-size: 11.5px;
  font-weight: 640;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) ${OptionDetail} {
    color: var(--forge-text-soft);
  }

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--forge-amber) 16%, transparent);
  }

  &:disabled { opacity: 0.5; cursor: default; }
`;

const ErrorLine = styled.p`
  margin: 9px 0 0;
  color: var(--forge-red);
  font-size: 11.5px;
`;
