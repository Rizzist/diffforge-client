import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import styled from "styled-components";

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

export default function NeedsInputCard({ card, sessionId, onAnswered = null }) {
  const [busyKey, setBusyKey] = useState("");
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
      /* menu_id/request_seq/worker_generation ride VERBATIM off the card —
         they are the daemon's staleness fence, never re-derived here. */
      await invoke("session_answer_menu", {
        session_id: sessionId,
        menu_id: card.menu_id,
        request_seq: card.request_seq,
        worker_generation: card.worker_generation,
        option_key: optionKey,
      });
      onAnswered?.();
    } catch (failure) {
      /* Daemon codes pass through VERBATIM. Only the two states we genuinely
         know are reworded; pattern-matching the rest would rewrite codes this
         build has never seen into a confident guess about what went wrong. */
      const code = String(failure?.message || failure || "").trim();
      setError(
        code === "haider_needs_input_unavailable"
          ? "The harness connection is unavailable."
          : code === "haider_needs_input_answer_uncertain"
            /* The answer may already have landed; the command id is derived,
               so pressing again replays the receipt instead of double-
               answering. Say so plainly rather than implying failure. */
            ? "The reply may not have been confirmed — pressing again is safe."
            : code === "haider_needs_input_stale"
              ? "This request moved on — the current one will appear here."
              : code.startsWith("already_resolved")
                ? "Already answered — this park has closed."
                : code || "The answer did not go through.",
      );
    } finally {
      setBusyKey("");
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
  const answerable = typeof card?.menu_id === "string"
    && card.menu_id.length > 0
    && typeof card?.request_seq === "number"
    && Number.isFinite(card.request_seq)
    && typeof card?.worker_generation === "number"
    && Number.isFinite(card.worker_generation)
    && options.length > 0;
  /* secret_answer absent means false. Those cards are badge-only by design —
     answered where the vault input lives, never here. */
  const secret = card?.secret_answer === true;

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
              {options.map((option) => (
                <OptionButton
                  disabled={Boolean(busyKey)}
                  key={option.key}
                  onClick={() => void answer(option.key)}
                  title={option.detail || undefined}
                  type="button"
                >
                  {busyKey === option.key ? "…" : (option.label || option.key)}
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

const OptionButton = styled.button`
  padding: 4px 13px;
  border: 1px solid color-mix(in srgb, var(--forge-amber) 45%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--forge-text);
  font-size: 11.5px;
  font-weight: 640;
  cursor: pointer;

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
