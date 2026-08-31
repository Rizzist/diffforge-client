import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  deliveryView,
  peerDescriptorView,
  peerMessageView,
  peerUnavailableFromError,
  sendArgs,
} from "./peerModel.js";

/* AppShell-owned peer_messaging_v1 seam. All three SDK commands and both
   pushed-event names live here. The roster/inbox are app-level facts (the
   peer commands have no session coordinate), while SessionSurface chooses
   where to present them as a per-session Peers tab.

   Inbox rows are bounded and accepted only with the daemon's msg_id. A
   delivery change can arrive before its message/receipt, so a small bounded
   map holds that published fact until the matching daemon id appears. No
   local id or optimistic delivery state is ever synthesized. */

const INBOX_CAP = 100;
const SENT_CAP = 50;
const DELIVERY_FACT_CAP = 200;

function boundedObjectWith(current, key, value, cap) {
  const next = { ...current };
  delete next[key];
  next[key] = value;
  const keys = Object.keys(next);
  for (let index = 0; index < keys.length - cap; index += 1) {
    delete next[keys[index]];
  }
  return next;
}

export function usePeers({ enabled = true } = {}) {
  /* null = roster unread; [] = the daemon honestly published no peers. */
  const [peers, setPeers] = useState(null);
  /* null = own peer name unread/not published; the empty string remains an
     explicitly published empty name rather than being filled locally. */
  const [ownName, setOwnName] = useState(null);
  const [inbox, setInbox] = useState([]);
  /* msg_id -> receipt-backed sent row. Rows land only after peer_send
     resolves, initially with the exact returned delivery. */
  const [sentById, setSentById] = useState({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const mountedRef = useRef(true);
  const unavailableRef = useRef(false);
  const pendingCountRef = useRef(0);
  const deliveryByIdRef = useRef(new Map());

  const beginLoading = useCallback(() => {
    pendingCountRef.current += 1;
    if (mountedRef.current) setLoading(true);
  }, []);
  const endLoading = useCallback(() => {
    pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
    if (mountedRef.current && pendingCountRef.current === 0) setLoading(false);
  }, []);

  const markUnavailable = useCallback(() => {
    if (unavailableRef.current) return;
    unavailableRef.current = true;
    if (row.msgId == null || !mountedRef.current) return;
    setUnavailable(true);
    setError("");
  }, []);

  const settleError = useCallback((thrown, fallback) => {
    if (peerUnavailableFromError(thrown)) {
      markUnavailable();
      return "unavailable";
    }
    if (unavailableRef.current) return "unavailable";
    if (mountedRef.current) {
      setError(String(thrown?.message ?? thrown ?? fallback));
    }
    return "error";
  }, [markUnavailable]);

  /* peer.list -> the unwrapped descriptor array. */
  const list = useCallback(async () => {
    if (!enabled || unavailableRef.current) return null;
    beginLoading();
    try {
      const descriptors = await invoke("peer_list");
      if (!Array.isArray(descriptors)) {
        throw new Error("Peer roster response was not a descriptor array.");
      }
      const views = descriptors.map(peerDescriptorView);
      if (mountedRef.current && !unavailableRef.current) setPeers(views);
      return views;
    } catch (thrown) {
      settleError(thrown, "Unable to list peers.");
      return null;
    } finally {
      endLoading();
    }
  }, [beginLoading, enabled, endLoading, settleError]);

  /* peer.name -> this client's own unwrapped peer name. */
  const readName = useCallback(async () => {
    if (!enabled || unavailableRef.current) return null;
    beginLoading();
    try {
      const receipt = await invoke("peer_name");
      const name = typeof receipt === "string"
        ? receipt
        : typeof receipt?.name === "string" ? receipt.name : null;
      if (name == null) throw new Error("Peer-name response published no name.");
      if (mountedRef.current && !unavailableRef.current) setOwnName(name);
      return name;
    } catch (thrown) {
      settleError(thrown, "Unable to read this client's peer name.");
      return null;
    } finally {
      endLoading();
    }
  }, [beginLoading, enabled, endLoading, settleError]);

  const load = useCallback(async () => {
    if (!enabled || unavailableRef.current) return null;
    if (mountedRef.current) setError("");
    const [roster, name] = await Promise.all([list(), readName()]);
    return { roster, name };
  }, [enabled, list, readName]);

  /* No optimistic send: sentById is untouched until the unwrapped daemon
     receipt arrives. The receipt's delivery is the initial state; only a
     peer-delivery-changed push may replace it. */
  const send = useCallback(async (to, message, summary) => {
    const target = typeof to === "string" ? to.trim() : "";
    const body = typeof message === "string" ? message : "";
    if (!enabled || unavailableRef.current || !target || !body.trim()) return null;
    if (mountedRef.current) {
      setSending(true);
      setError("");
    }
    try {
      const receipt = await invoke("peer_send", sendArgs(target, body, summary));
      const msgId = typeof receipt?.msg_id === "string" && receipt.msg_id.length > 0
        ? receipt.msg_id
        : null;
      const returned = { msgId, delivery: deliveryView(receipt) };
      if (mountedRef.current && msgId != null && !unavailableRef.current) {
        /* If the delivery event won the race, using it here is still an
           event-driven update; otherwise the exact returned state lands. */
        const eventDelivery = deliveryByIdRef.current.get(msgId);
        setSentById((current) => boundedObjectWith(current, msgId, {
          msgId,
          delivery: eventDelivery ?? returned.delivery,
        }, SENT_CAP));
      }
      return returned;
    } catch (thrown) {
      settleError(thrown, "Unable to send the peer message.");
      return null;
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [enabled, settleError]);

  const handleMessage = useCallback((payload) => {
    const row = peerMessageView(payload);
    /* msg_id is the daemon's dedupe key. Keyless frames cannot be stored:
       retaining them would require inventing a local identity. */
    if (!mountedRef.current) return;
    setInbox((current) => {
      if (current.some((entry) => entry.msgId === row.msgId)) return current;
      return [...current, {
        ...row,
        delivery: deliveryByIdRef.current.get(row.msgId) ?? null,
      }].slice(-INBOX_CAP);
    });
  }, []);

  const handleDelivery = useCallback((payload) => {
    const msgId = typeof payload?.msg_id === "string" && payload.msg_id.length > 0
      ? payload.msg_id
      : null;
    if (msgId == null) return;
    const delivery = deliveryView(payload);
    const facts = deliveryByIdRef.current;
    facts.delete(msgId);
    facts.set(msgId, delivery);
    while (facts.size > DELIVERY_FACT_CAP) {
      facts.delete(facts.keys().next().value);
    }
    if (!mountedRef.current) return;
    setInbox((current) => current.map((entry) => (
      entry.msgId === msgId ? { ...entry, delivery } : entry
    )));
    setSentById((current) => (
      current[msgId]
        ? { ...current, [msgId]: { ...current[msgId], delivery } }
        : current
    ));
  }, []);

  /* Exact Tauri event constants mirrored from the peer SDK bridge. Like the
     descendant stream, listeners are established once and unlistened on
     disable/unmount; the event payload itself is the unwrapped wire row. */
  useEffect(() => {
    if (!enabled || unavailable) return undefined;
    let disposed = false;
    let unlisteners = [];
    void Promise.all([
      listen("peer-message-received", (event) => {
        if (!disposed) handleMessage(event?.payload ?? {});
      }),
      listen("peer-delivery-changed", (event) => {
        if (!disposed) handleDelivery(event?.payload ?? {});
      }),
    ]).then((stops) => {
      if (disposed) {
        for (const stop of stops) stop();
      } else {
        unlisteners = stops;
      }
    }).catch((thrown) => {
      if (!disposed) settleError(thrown, "Unable to subscribe to peer messages.");
    });
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
      unlisteners = [];
    };
  }, [enabled, handleDelivery, handleMessage, settleError, unavailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    peers,
    ownName,
    inbox,
    sentById,
    loading,
    sending,
    error,
    unavailable,
    list,
    readName,
    load,
    send,
  };
}
