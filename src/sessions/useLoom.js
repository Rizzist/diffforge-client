import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  agentTypeView,
  installItemView,
  installJobView,
  loomUnavailableFromError,
  personaBindingView,
  registrationReceiptView,
  retryOutcomeView,
  watchOutcomeView,
} from "./loomModel.js";

/* React seam for the Loom agent-type registry. The hook carries daemon facts
   through the loomModel transforms and adds nothing of its own: cli_present
   is stored verbatim (its key ABSENCE is the "unprobed" third state, so it
   must not be reshaped), install jobs keep unknown states raw, and the only
   persona-binding truth is the receipts this hook has actually seen. A
   daemon that lacks the feature settles into `unavailable` once — no retry
   spam. */

export function useLoom({ enabled = true } = {}) {
  const [agentTypes, setAgentTypes] = useState([]);
  /* Verbatim wire map { program: bool }. A missing key means "not probed". */
  const [cliPresent, setCliPresent] = useState({});
  /* agentTypeId -> { jobs: installJobView[], items: installItemView[], error } */
  const [installByType, setInstallByType] = useState({});
  /* sessionId -> personaBindingView. ONLY receipts populate this: a session
     without an entry has an UNKNOWN binding, not "no persona". */
  const [personaBySession, setPersonaBySession] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const unavailableRef = useRef(false);
  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  const settleError = useCallback((thrown, fallback) => {
    if (loomUnavailableFromError(thrown)) {
      markUnavailable();
      return true;
    }
    setError(String(thrown?.message ?? thrown ?? fallback));
    return false;
  }, [markUnavailable]);

  const list = useCallback(async () => {
    /* An unavailable daemon stays unavailable for this hook's lifetime —
       never poll a feature the daemon told us it does not have. */
    if (unavailableRef.current) return false;
    setLoading(true);
    try {
      const result = await invoke("loom_list");
      setAgentTypes(Array.isArray(result?.agent_types)
        ? result.agent_types.map(agentTypeView)
        : []);
      setCliPresent(result?.cli_present && typeof result.cli_present === "object"
        ? result.cli_present
        : {});
      setError("");
      return true;
    } catch (thrown) {
      settleError(thrown, "Unable to list agent types.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [settleError]);

  useEffect(() => {
    if (!enabled) return;
    void list();
  }, [enabled, list]);

  const installStatus = useCallback(async (agentTypeId) => {
    if (!agentTypeId || unavailableRef.current) return null;
    try {
      const status = await invoke("loom_install_status", { agent_type_id: agentTypeId });
      const view = {
        jobs: Array.isArray(status?.jobs) ? status.jobs.map(installJobView) : [],
        items: Array.isArray(status?.items) ? status.items.map(installItemView) : [],
        error: "",
      };
      setInstallByType((current) => ({ ...current, [agentTypeId]: view }));
      return view;
    } catch (thrown) {
      if (!settleError(thrown, "Unable to read install status.")) {
        setInstallByType((current) => ({
          ...current,
          [agentTypeId]: {
            jobs: current[agentTypeId]?.jobs || [],
            items: current[agentTypeId]?.items || [],
            error: String(thrown?.message ?? thrown ?? "Unable to read install status."),
          },
        }));
      }
      return null;
    }
  }, [settleError]);

  const register = useCallback(async (fields) => {
    if (unavailableRef.current) return null;
    try {
      const receipt = await invoke("loom_register_agent_type", {
        id: fields.id,
        name: fields.name,
        job: fields.job,
        in_type: fields.inType,
        out_type: fields.outType,
        clis: fields.clis,
        apis: fields.apis,
        skills: fields.skills,
        scripts: fields.scripts,
        color: fields.color,
        glyph: fields.glyph,
      });
      const view = registrationReceiptView(receipt);
      await list();
      /* An absent install_job_id means there is NO install job to disclose —
         only a receipt that names one warrants an install-status read. */
      if (view.installJobId != null) void installStatus(view.id);
      return view;
    } catch (thrown) {
      settleError(thrown, "Unable to register the agent type.");
      return null;
    }
  }, [installStatus, list, settleError]);

  /* Requeue applies only to a job the daemon reported failed; the section
     never offers this for other states, and the daemon's rejection (or an
     unknown future outcome) is returned verbatim for display. */
  const retry = useCallback(async (installJobId) => {
    if (!installJobId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("loom_install_retry", { install_job_id: installJobId });
      const outcome = retryOutcomeView(receipt?.outcome);
      if (outcome.status === "requeued") {
        const fresh = outcome.job;
        setInstallByType((current) => {
          const bucket = current[fresh.agentTypeId];
          if (!bucket) return current;
          return {
            ...current,
            [fresh.agentTypeId]: {
              ...bucket,
              jobs: bucket.jobs.map((row) => (row.jobId === fresh.jobId ? fresh : row)),
            },
          };
        });
      }
      return outcome;
    } catch (thrown) {
      settleError(thrown, "Unable to retry the install job.");
      return null;
    }
  }, [settleError]);

  const watch = useCallback(async (installJobId, afterCursor = 0) => {
    if (!installJobId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("loom_install_watch", {
        install_job_id: installJobId,
        after_cursor: afterCursor,
      });
      const outcome = watchOutcomeView(receipt?.outcome);
      if (outcome.status === "watching" && outcome.events.length > 0) {
        const latest = outcome.events[outcome.events.length - 1].job;
        setInstallByType((current) => {
          const bucket = current[latest.agentTypeId];
          if (!bucket) return current;
          return {
            ...current,
            [latest.agentTypeId]: {
              ...bucket,
              jobs: bucket.jobs.map((row) => (row.jobId === latest.jobId ? latest : row)),
            },
          };
        });
      }
      return outcome;
    } catch (thrown) {
      settleError(thrown, "Unable to watch the install job.");
      return null;
    }
  }, [settleError]);

  /* Persona binding: binds an agent-type persona to the session and NOTHING
     more — no install, no PATH proof, no execution grant. The daemon's
     receipt (not the request) is the binding authority we store. The wire
     command REQUIRES a String agent_type_id — the SDK has no unbind — so
     only a real, non-empty agent-type id is ever dispatched. */
  const select = useCallback(async (sessionId, agentTypeId) => {
    const typeId = typeof agentTypeId === "string" ? agentTypeId.trim() : "";
    if (!sessionId || !typeId || unavailableRef.current) return null;
    try {
      const receipt = await invoke("session_select_agent_type", {
        session_id: sessionId,
        agent_type_id: typeId,
      });
      const binding = personaBindingView(receipt);
      const key = binding.sessionId || sessionId;
      setPersonaBySession((current) => ({ ...current, [key]: binding }));
      return binding;
    } catch (thrown) {
      settleError(thrown, "Unable to bind the persona.");
      return null;
    }
  }, [settleError]);

  return {
    agentTypes,
    cliPresent,
    installByType,
    personaBySession,
    loading,
    error,
    unavailable,
    list,
    register,
    installStatus,
    retry,
    watch,
    select,
  };
}
