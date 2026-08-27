import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  compileErrorListView,
  fenceFor,
  graphStatusView,
  revisionConflictView,
  workflowCatalogView,
  workflowInstanceView,
  workflowRecordView,
  workflowRegistrationReceiptView,
  workflowUnavailableFromError,
} from "./workflowModel.js";

/* React seam for the workflow / convergence-graph surface (P1′). EVERY
   invoke() for the eight workflow commands lives in this file — the single
   reconcile point if the SDK's arg names drift. The hook carries daemon
   facts through the workflowModel transforms and adds nothing of its own:
   - the catalog is a typed tri-state (unread / unavailable / available) —
     a loom_list whose workflow_catalog is null (or absent) is the catalog
     feature being UNAVAILABLE, never an empty catalog;
   - instanceById stores what workflow_instance_get actually said, kind
     "missing" included — a missing instance is never replaced by a current
     row, built-in, or local compile;
   - the ONLY fence ever sent is fenceFor() over an instance this hook has
     actually read: expected_digest is copied verbatim from that instance's
     template_digest, and when there is no read the key is OMITTED entirely
     (never null, never "", never fabricated);
   - a revision_conflict is decoded and RETURNED for display — there is no
     auto-resubmit-with-current-digest path anywhere in this hook;
   - statusBySession is written ONLY from graph_status reads (house law:
     workflow state never derives from loom.list.workflows, a selected
     agent_type, or session lineage);
   - a daemon that lacks the feature settles into `unavailable` once — no
     retry spam. */

export function useWorkflow({ enabled = true } = {}) {
  /* Tri-state catalog: unread (never listed) / unavailable / available. */
  const [catalog, setCatalog] = useState({ kind: "unread", entries: [] });
  /* Verbatim compiled user-workflow records (opaque views). */
  const [workflows, setWorkflows] = useState([]);
  /* workflowId -> workflowInstanceView (kind "instance" | "missing"). */
  const [instanceById, setInstanceById] = useState({});
  /* sessionId -> graphStatusView (kind "active" | "none"). ONLY graph_status
     reads populate this: a session without an entry has an UNREAD workflow
     state, which is NOT the same claim as "no workflow". */
  const [statusBySession, setStatusBySession] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const unavailableRef = useRef(false);
  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  const settleError = useCallback((thrown, fallback) => {
    if (workflowUnavailableFromError(thrown)) {
      markUnavailable();
      return true;
    }
    setError(String(thrown?.message ?? thrown ?? fallback));
    return false;
  }, [markUnavailable]);

  /* instanceById mirror so mutation callbacks read the LATEST reads without
     re-creating themselves on every instance fetch. */
  const instanceByIdRef = useRef({});
  useEffect(() => {
    instanceByIdRef.current = instanceById;
  }, [instanceById]);

  const list = useCallback(async () => {
    /* An unavailable daemon stays unavailable for this hook's lifetime —
       never poll a feature the daemon told us it does not have. */
    if (unavailableRef.current) return false;
    setLoading(true);
    try {
      const result = await invoke("loom_list");
      /* ADDITIVE fields on the same command: workflows + workflow_catalog
         (Array | null). loom_list does NOT throw when only the catalog
         feature is missing — it returns null, and the catalog view types
         that null (or an absent field) as "unavailable", never as an
         empty catalog. Only a real array is "available". */
      setCatalog(workflowCatalogView(result));
      setWorkflows(Array.isArray(result?.workflows)
        ? result.workflows.map(workflowRecordView)
        : []);
      setError("");
      return true;
    } catch (thrown) {
      settleError(thrown, "Unable to list workflows.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [settleError]);

  useEffect(() => {
    if (!enabled) return;
    void list();
  }, [enabled, list]);

  const instance = useCallback(async (workflowId, templateDigest = undefined) => {
    if (!workflowId || unavailableRef.current) return null;
    try {
      const payload = { workflow_id: workflowId };
      /* template_digest is OPTIONAL on the wire: included only when the
         caller actually has one — never null/empty filler. */
      if (typeof templateDigest === "string" && templateDigest.length > 0) {
        payload.template_digest = templateDigest;
      }
      const result = await invoke("workflow_instance_get", payload);
      /* instance: null is "does not exist" — stored as kind "missing",
         never substituted with anything. */
      const view = workflowInstanceView(result?.instance ?? null);
      setInstanceById((current) => ({ ...current, [workflowId]: view }));
      return view;
    } catch (thrown) {
      settleError(thrown, "Unable to read the workflow instance.");
      return null;
    }
  }, [settleError]);

  const status = useCallback(async (sessionId) => {
    if (!sessionId || unavailableRef.current) return null;
    try {
      const result = await invoke("graph_status", { session_id: sessionId });
      /* null/absent = no active pinned workflow: honest "none". */
      const view = graphStatusView(result ?? null);
      setStatusBySession((current) => ({ ...current, [sessionId]: view }));
      return view;
    } catch (thrown) {
      settleError(thrown, "Unable to read the workflow status.");
      return null;
    }
  }, [settleError]);

  const inspect = useCallback(async (sessionId, cursor = undefined, limit = 100) => {
    if (!sessionId || unavailableRef.current) return null;
    try {
      /* cursor is Option<String> on the wire: it rides the payload ONLY as
         a non-empty string — a numeric cursor would fail deserialization,
         and with no cursor the key is OMITTED entirely. limit stays a
         number (u32). */
      const payload = { session_id: sessionId, limit };
      if (typeof cursor === "string" && cursor.length > 0) payload.cursor = cursor;
      const result = await invoke("graph_inspect", payload);
      /* The snapshot is OPAQUE — returned raw for a bounded/raw view, no
         fabricated structure. */
      return result?.snapshot ?? null;
    } catch (thrown) {
      settleError(thrown, "Unable to inspect the graph.");
      return null;
    }
  }, [settleError]);

  /* Mutation outcome shape shared by pin/switch: a revision_conflict is
     decoded and RETURNED so the view can show expected vs current and ask
     the user to RE-READ the instance. It is never auto-retried here. */
  const settleMutation = useCallback((thrown, fallback) => {
    const conflict = revisionConflictView(thrown);
    if (conflict) return { ok: false, conflict };
    settleError(thrown, fallback);
    return { ok: false, conflict: null };
  }, [settleError]);

  const pin = useCallback(async (sessionId, template) => {
    if (!sessionId || !template || unavailableRef.current) return null;
    try {
      const payload = { session_id: sessionId, template };
      /* THE fence rule: expected_digest iff copied from an instance this
         hook actually read (its template_digest, verbatim). With no read
         the key is ABSENT — no null, no empty, no fabricated fence. */
      const fence = fenceFor(instanceByIdRef.current[template]);
      if (fence !== undefined) payload.expected_digest = fence;
      const receipt = await invoke("graph_pin", payload);
      /* House law: workflow state comes only from graph_status — re-read
         the projection instead of synthesizing a local "pinned" state. */
      void status(sessionId);
      return { ok: true, receipt: receipt ?? null, conflict: null };
    } catch (thrown) {
      return settleMutation(thrown, "Unable to pin the workflow.");
    }
  }, [settleMutation, status]);

  const switchGraph = useCallback(async (sessionId, oldGraphId, template) => {
    if (!sessionId || !oldGraphId || !template || unavailableRef.current) return null;
    try {
      const payload = {
        session_id: sessionId,
        old_graph_id: oldGraphId,
        template,
      };
      /* Same fence rule as pin. */
      const fence = fenceFor(instanceByIdRef.current[template]);
      if (fence !== undefined) payload.expected_digest = fence;
      const receipt = await invoke("graph_switch", payload);
      void status(sessionId);
      return { ok: true, receipt: receipt ?? null, conflict: null };
    } catch (thrown) {
      return settleMutation(thrown, "Unable to switch the workflow.");
    }
  }, [settleMutation, status]);

  const abandon = useCallback(async (sessionId, why) => {
    if (!sessionId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("graph_abandon", {
        session_id: sessionId,
        why: String(why ?? ""),
      });
      void status(sessionId);
      return { ok: true, receipt: receipt ?? null };
    } catch (thrown) {
      settleError(thrown, "Unable to abandon the workflow.");
      return null;
    }
  }, [settleError, status]);

  const runSetOpen = useCallback(async (sessionId, planItemId, planEventSeq) => {
    if (!sessionId || !planItemId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("graph_run_set_open", {
        session_id: sessionId,
        plan_item_id: planItemId,
        plan_event_seq: planEventSeq,
      });
      void status(sessionId);
      return { ok: true, receipt: receipt ?? null };
    } catch (thrown) {
      settleError(thrown, "Unable to open the run set.");
      return null;
    }
  }, [settleError, status]);

  const registerWorkflow = useCallback(async (source) => {
    const pipeSource = typeof source === "string" ? source : "";
    if (!pipeSource.trim() || unavailableRef.current) return null;
    try {
      const receipt = await invoke("loom_register_workflow", { source: pipeSource });
      const view = workflowRegistrationReceiptView(receipt);
      /* Refresh the catalog + workflows through the same authority. */
      void list();
      return { ok: true, receipt: view, errors: [] };
    } catch (thrown) {
      if (workflowUnavailableFromError(thrown)) {
        markUnavailable();
        return { ok: false, receipt: null, errors: [] };
      }
      /* A bad pipe REJECTS with the compile error list — surfaced VERBATIM,
         never swallowed, never a pretended success. */
      return { ok: false, receipt: null, errors: compileErrorListView(thrown) };
    }
  }, [list, markUnavailable]);

  return {
    catalog,
    workflows,
    instanceById,
    statusBySession,
    loading,
    error,
    unavailable,
    list,
    instance,
    status,
    inspect,
    pin,
    switch: switchGraph,
    abandon,
    runSetOpen,
    registerWorkflow,
  };
}
