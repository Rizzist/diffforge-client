import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

/* Presentational peer_messaging_v1 surface. All daemon reads, sends, and
   push subscriptions live in usePeers.js. Peer message text is rendered only
   as a React text node inside MessageBody (white-space:pre-wrap): there is no
   markup interpretation, prompt insertion, execution, or automatic action. */

function categoryLabel(category) {
  if (category?.recognized) return category.raw;
  if (category?.raw != null) return `${category.raw} (unrecognized)`;
  return "not published";
}

function publishedText(value, fallback = "not published") {
  return value == null ? fallback : String(value);
}

function trustBadgeLabel(trust) {
  if (trust?.trusted === true) return "Verified Haider";
  if (trust?.raw === "untrusted_external") return "UNTRUSTED external";
  if (trust?.raw != null) return `UNTRUSTED · ${trust.raw} (unrecognized trust)`;
  return "UNTRUSTED · trust not published";
}

function DeliveryStatus({ delivery }) {
  if (delivery == null) {
    return <DeliveryState data-state="absent">delivery not published</DeliveryState>;
  }
  const state = delivery.state;
  return (
    <DeliveryLine>
      <DeliveryState
        data-recognized={state?.recognized ? "true" : "false"}
        data-state={state?.raw ?? "absent"}
      >
        {categoryLabel(state)}
      </DeliveryState>
      {/* reason:null is genuine absence and renders no reason at all. A
          refused/expired reason, including a future raw value, stays
          verbatim and visibly marked when unrecognized. */}
      {delivery.reason != null && (
        <DeliveryReason>
          reason: {categoryLabel(delivery.reason)}
        </DeliveryReason>
      )}
    </DeliveryLine>
  );
}

export default function PeersPanel({
  peers = null,
  ownName = null,
  inbox = [],
  sentById = {},
  error = "",
  loading = false,
  sending = false,
  unavailable = false,
  onRefresh = null,
  onSend = null,
}) {
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState("");
  const [localError, setLocalError] = useState("");
  const [lastReceipt, setLastReceipt] = useState(null);

  const targetPeers = useMemo(() => (
    Array.isArray(peers) ? peers.filter((peer) => peer.id != null) : []
  ), [peers]);

  useEffect(() => {
    if (target && !targetPeers.some((peer) => peer.id === target)) setTarget("");
  }, [target, targetPeers]);

  const commitSend = useCallback(async () => {
    if (sending) return;
    if (!target) {
      setLocalError("Choose a peer target.");
      return;
    }
    if (!message.trim()) {
      setLocalError("Enter a message.");
      return;
    }
    setLocalError("");
    /* A blank optional field takes the two-argument path, so usePeers cannot
       accidentally emit summary:"". An explicitly present summary takes
       the three-argument path. */
    const receipt = summary === ""
      ? await onSend?.(target, message)
      : await onSend?.(target, message, summary);
    if (receipt) {
      setLastReceipt(receipt);
      setMessage("");
      setSummary("");
    }
  }, [message, onSend, sending, summary, target]);

  const latestSent = lastReceipt?.msgId != null
    ? (sentById[lastReceipt.msgId] ?? lastReceipt)
    : lastReceipt;

  if (unavailable) {
    return (
      <PeersSection aria-label="Peers">
        <PanelTitle>Peers</PanelTitle>
        <MutedState>
          Peer messaging is unavailable on this daemon.
        </MutedState>
      </PeersSection>
    );
  }

  return (
    <PeersSection aria-label="Peers">
      <PanelHeader>
        <div>
          <PanelTitle>Peers</PanelTitle>
          <PanelSubtitle>
            {ownName == null
              ? "Own peer name not read yet."
              : `This client: ${ownName === "" ? "(empty name published)" : ownName}`}
          </PanelSubtitle>
        </div>
        <HeaderButton disabled={loading} onClick={() => onRefresh?.()} type="button">
          {loading ? "Reading…" : "Refresh"}
        </HeaderButton>
      </PanelHeader>

      {error && <ErrorNotice role="alert">{error}</ErrorNotice>}

      <PanelGrid>
        <PanelCard>
          <GroupTitle>Peer roster</GroupTitle>
          {peers == null && (
            <MutedState>Peer roster not read yet.</MutedState>
          )}
          {Array.isArray(peers) && peers.length === 0 && (
            <MutedState>No peers are currently published by the daemon.</MutedState>
          )}
          {Array.isArray(peers) && peers.length > 0 && (
            <RosterList>
              {peers.map((peer, index) => (
                <RosterRow key={peer.id ?? `unidentified-peer:${index}`}>
                  <RosterIdentity>
                    <strong>{peer.name == null ? "(name not published)" : peer.name || "(empty name)"}</strong>
                    <code>{peer.id ?? "id not published"}</code>
                  </RosterIdentity>
                  <RosterBadges>
                    <ValueBadge data-recognized={peer.kind.recognized ? "true" : "false"}>
                      {categoryLabel(peer.kind)}
                    </ValueBadge>
                    <ValueBadge data-recognized={peer.state.recognized ? "true" : "false"}>
                      {categoryLabel(peer.state)}
                    </ValueBadge>
                  </RosterBadges>
                  <RosterFacts>
                    <span>workspace: {publishedText(peer.workspace)}</span>
                    <span>model: {publishedText(peer.model)}</span>
                    <span>started_at: {publishedText(peer.startedAt)}</span>
                    <span>last_seen: {publishedText(peer.lastSeen)}</span>
                  </RosterFacts>
                </RosterRow>
              ))}
            </RosterList>
          )}
        </PanelCard>

        <PanelCard as="form" onSubmit={(event) => {
          event.preventDefault();
          void commitSend();
        }}>
          <GroupTitle>Send to a peer</GroupTitle>
          <Field>
            <label htmlFor="peer-message-target">target</label>
            <Select
              disabled={targetPeers.length === 0}
              id="peer-message-target"
              onChange={(event) => setTarget(event.target.value)}
              value={target}
            >
              <option value="">Choose a peer…</option>
              {targetPeers.map((peer) => (
                <option key={peer.id} value={peer.id}>
                  {peer.name || peer.id} · {peer.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <label htmlFor="peer-message-body">message</label>
            <TextArea
              id="peer-message-body"
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Message text"
              rows={4}
              value={message}
            />
          </Field>
          <Field>
            <label htmlFor="peer-message-summary">summary (optional)</label>
            <Input
              id="peer-message-summary"
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Optional summary"
              value={summary}
            />
          </Field>
          {localError && <LocalNotice role="alert">{localError}</LocalNotice>}
          <SendRow>
            <SendButton
              disabled={sending || targetPeers.length === 0 || !target || !message.trim()}
              type="submit"
            >
              {sending ? "Sending…" : "Send message"}
            </SendButton>
          </SendRow>
          {/* No state appears until peer_send returns. Thereafter this is
              receipt-backed and may change only when sentById is updated by
              a delivery-change push. */}
          {latestSent != null && (
            <SentReceipt role="status">
              <strong>Daemon send receipt</strong>
              <span>msg_id: {latestSent.msgId ?? "not published"}</span>
              <DeliveryStatus delivery={latestSent.delivery} />
            </SentReceipt>
          )}
        </PanelCard>
      </PanelGrid>

      <InboxCard>
        <InboxHeader>
          <GroupTitle>Inbox</GroupTitle>
          <PlainTextLaw>
            Remote peer text is displayed as plain text only. It is never executed or copied into a prompt automatically.
          </PlainTextLaw>
        </InboxHeader>
        {inbox.length === 0 && (
          <MutedState>No peer messages have been received in this client.</MutedState>
        )}
        {inbox.length > 0 && (
          <InboxList>
            {inbox.map((entry) => (
              <MessageCard key={entry.msgId}>
                <MessageHeader>
                  <SenderIdentity>
                    <strong>{entry.from.name == null ? "(sender name not published)" : entry.from.name || "(empty sender name)"}</strong>
                    <span>{entry.from.id ?? "sender id not published"}</span>
                    <span>kind: {categoryLabel(entry.from.kind)}</span>
                  </SenderIdentity>
                  <TrustBadge
                    data-trust={entry.from.trust.trusted ? "verified" : "untrusted"}
                    title={entry.from.trust.raw ?? "No trust value was published"}
                  >
                    {trustBadgeLabel(entry.from.trust)}
                  </TrustBadge>
                </MessageHeader>
                {entry.hasSummary && (
                  <MessageSummary>
                    Summary: {entry.summary === "" ? "(empty summary)" : (entry.summary ?? "(non-text summary published)")}
                  </MessageSummary>
                )}
                {/* Untrusted remote input: a text node only. Never use
                    an HTML injection API or route this value into a
                    composer/prompt without a separate explicit user action. */}
                <MessageBody>{entry.message}</MessageBody>
                <MessageFooter>
                  <MessageTimes>
                    <span>queued_at: {publishedText(entry.queuedAt)}</span>
                    <span>expires_at: {publishedText(entry.expiresAt)}</span>
                  </MessageTimes>
                  <DeliveryStatus delivery={entry.delivery} />
                </MessageFooter>
              </MessageCard>
            ))}
          </InboxList>
        )}
      </InboxCard>
    </PeersSection>
  );
}

const PeersSection = styled.section`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: auto;
  color: var(--forge-text);
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const PanelTitle = styled.h2`
  margin: 0;
  color: var(--forge-text);
  font-size: 15px;
  font-weight: 760;
`;

const PanelSubtitle = styled.div`
  margin-top: 2px;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const HeaderButton = styled.button`
  padding: 5px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 9.5px;
  cursor: pointer;

  &:disabled { cursor: default; opacity: 0.55; }
`;

const PanelGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(240px, 0.9fr) minmax(280px, 1.1fr);
  gap: 10px;

  @media (max-width: 820px) { grid-template-columns: 1fr; }
`;

const PanelCard = styled.section`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-surface-raised);
`;

const GroupTitle = styled.h3`
  margin: 0;
  color: var(--forge-text);
  font-size: 10.5px;
  font-weight: 730;
  letter-spacing: 0.02em;
`;

const MutedState = styled.div`
  padding: 8px 0;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const ErrorNotice = styled.div`
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 42%, transparent);
  border-radius: 7px;
  color: var(--forge-red);
  background: color-mix(in srgb, var(--forge-red) 8%, transparent);
  font-size: 9.5px;
`;

const RosterList = styled.div`
  display: grid;
  gap: 6px;
`;

const RosterRow = styled.article`
  display: grid;
  gap: 5px;
  padding: 7px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  background: var(--forge-surface-control);
`;

const RosterIdentity = styled.div`
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;

  strong { min-width: 0; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  code { color: var(--forge-text-muted); font-size: 8.5px; font-family: var(--forge-mono, monospace); }
`;

const RosterBadges = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const ValueBadge = styled.span`
  padding: 2px 5px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  font-size: 8.5px;

  &[data-recognized="false"] { color: var(--forge-amber); }
`;

const RosterFacts = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 8px;
  color: var(--forge-text-muted);
  font-size: 8.5px;

  span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const Field = styled.div`
  display: grid;
  gap: 3px;

  label {
    color: var(--forge-text-muted);
    font-size: 8.5px;
    font-weight: 650;
    text-transform: uppercase;
  }
`;

const fieldControl = `
  width: 100%;
  box-sizing: border-box;
  padding: 6px 7px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  outline: none;
  color: var(--forge-text);
  background: var(--forge-surface-control);
  font: inherit;
  font-size: 10px;
`;

const Select = styled.select`${fieldControl}`;
const Input = styled.input`${fieldControl}`;
const TextArea = styled.textarea`
  ${fieldControl}
  resize: vertical;
  min-height: 68px;
`;

const LocalNotice = styled.div`
  color: var(--forge-amber);
  font-size: 9px;
`;

const SendRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const SendButton = styled(HeaderButton)`
  color: var(--forge-text);
  font-weight: 680;
`;

const SentReceipt = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 9px;
  padding: 7px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  color: var(--forge-text-muted);
  background: var(--forge-surface-control);
  font-size: 9px;

  strong { color: var(--forge-text-soft); }
`;

const InboxCard = styled(PanelCard)`
  flex: none;
`;

const InboxHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
`;

const PlainTextLaw = styled.div`
  max-width: 620px;
  color: var(--forge-text-muted);
  font-size: 8.5px;
  text-align: right;
`;

const InboxList = styled.div`
  display: grid;
  gap: 7px;
`;

const MessageCard = styled.article`
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: var(--forge-surface-control);
`;

const MessageHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 9px;
`;

const SenderIdentity = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 3px 7px;
  font-size: 8.5px;

  strong { color: var(--forge-text); font-size: 10px; }
  span { color: var(--forge-text-muted); }
`;

const TrustBadge = styled.span`
  flex: none;
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 48%, var(--forge-border));
  border-radius: 999px;
  color: var(--forge-red);
  background: color-mix(in srgb, var(--forge-red) 9%, transparent);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.025em;

  &[data-trust="verified"] {
    border-color: color-mix(in srgb, var(--forge-green) 42%, var(--forge-border));
    color: var(--forge-green);
    background: color-mix(in srgb, var(--forge-green) 8%, transparent);
  }
`;

const MessageSummary = styled.div`
  color: var(--forge-text-muted);
  font-size: 9px;
  font-style: italic;
`;

const MessageBody = styled.pre`
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--forge-text);
  font: inherit;
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
`;

const MessageFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px 12px;
`;

const MessageTimes = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 9px;
  color: var(--forge-text-muted);
  font-size: 8px;
`;

const DeliveryLine = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 7px;
`;

const DeliveryState = styled.span`
  color: var(--forge-text-soft);
  font-size: 8.5px;
  font-weight: 700;

  &[data-recognized="false"] { color: var(--forge-amber); }
  &[data-state="queued"] { color: var(--forge-amber); }
  &[data-state="delivered"] { color: var(--forge-green); }
  &[data-state="expired"], &[data-state="refused"] { color: var(--forge-red); }
  &[data-state="absent"] { color: var(--forge-text-muted); font-weight: 500; }
`;

const DeliveryReason = styled.span`
  color: var(--forge-text-muted);
  font-size: 8.5px;
`;
