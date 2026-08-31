import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  admissionView,
  createArgs,
  createReceiptView,
  createUnavailableFromError,
} from "./sessionCreateModel.js";
import { createSession, updateSession } from "./sessionsModel.js";
import { submitSessionPrompt } from "./sessionSubmit.js";

export const SESSION_MUTATION_FEATURE = "session_mutation_v1";
export const SESSION_PERMISSION_OVERRIDES_FEATURE = "session_permission_overrides_v1";
export const AUTONOMOUS_INTERACTION_FEATURE = "autonomous_interaction_v1";
export const SESSION_CREATE_ADMISSION_FEATURE = "session_create_admission_v1";

function errorMessage(error, fallback) {
  return String(error?.message ?? error ?? fallback);
}

function firstPromptTitle(prompt) {
  const compact = String(prompt || "").split(/\s+/).filter(Boolean).join(" ");
  return compact.slice(0, 48) || "New session";
}

function receiptPinnedDirectory(receipt) {
  return typeof receipt?.metadata?.cwd === "string" ? receipt.metadata.cwd.trim() : "";
}

function receiptRow(row, receipt) {
  return {
    ...row,
    id: receipt.sessionId,
    session_id: receipt.sessionId,
    provider_session_id: receipt.sessionId,
    created_seq: receipt.createdSeq,
    worker_generation: receipt.workerGeneration,
    metadata: receipt.metadata,
  };
}

async function runLegacy(legacyMaterialize) {
  if (typeof legacyMaterialize !== "function") {
    return {
      kind: "error",
      error: new Error("The legacy session materialization path is unavailable."),
      prepared: null,
    };
  }
  try {
    const row = await legacyMaterialize();
    return row?.id
      ? { kind: "legacy", row, prepared: null }
      : {
        kind: "error",
        error: new Error("The legacy session materialization path returned no session."),
        prepared: null,
      };
  } catch (error) {
    return { kind: "error", error, prepared: null };
  }
}

/* Testable orchestration behind the React hook. A prepared value is retained
   only after the daemon has already created something; an explicit user retry
   can then resume attach/mirror/submit without creating a duplicate session. */
export async function runSessionCreate({
  invokeCommand = invoke,
  featureAvailable,
  draft,
  options,
  prompt,
  attachments = [],
  legacyMaterialize,
  prepared = null,
  mirrorReceipt = createSession,
  submitPrompt = submitSessionPrompt,
  updateMirror = updateSession,
  onPhase = () => {},
}) {
  if (!featureAvailable && !prepared) return runLegacy(legacyMaterialize);

  let receipt = prepared?.receipt || null;
  let attached = prepared?.attached === true;
  let row = prepared?.row || null;

  if (!receipt) {
    onPhase("creating");
    let rawReceipt;
    try {
      rawReceipt = await invokeCommand("ade_session_create", createArgs(draft, options));
    } catch (error) {
      const admission = admissionView(error);
      if (admission.admission) {
        return { kind: "admission", admission, error, prepared: null };
      }
      if (createUnavailableFromError(error)) {
        const legacy = await runLegacy(legacyMaterialize);
        return { ...legacy, nativeUnavailable: true };
      }
      return { kind: "error", error, prepared: null };
    }
    receipt = createReceiptView(rawReceipt);
    if (!receipt.sessionId || !receipt.createdSeq || !receipt.workerGeneration
      || receipt.metadata === undefined) {
      return {
        kind: "error",
        error: new Error("The daemon returned an incomplete session.create receipt."),
        prepared: null,
      };
    }
  }

  if (!attached) {
    onPhase("attaching");
    try {
      const attach = await invokeCommand("surface_attach", {
        session_id: receipt.sessionId,
      });
      if (attach?.accepted !== true) {
        throw new Error("The daemon did not accept the new session attachment.");
      }
      attached = true;
    } catch (error) {
      return {
        kind: "error",
        error,
        prepared: { receipt, attached: false, row: null },
      };
    }
  }

  if (!row) {
    onPhase("mirroring");
    try {
      row = await mirrorReceipt({
        receipt,
        title: firstPromptTitle(prompt),
        pinnedDir: receiptPinnedDirectory(receipt),
      }, invokeCommand);
      if (!row?.id) {
        throw new Error("The local roster mirror did not return a session row.");
      }
      if (row.id !== receipt.sessionId) {
        throw new Error(
          `The local session mirror returned “${row.id}” instead of the daemon receipt identity “${receipt.sessionId}”. The first prompt was not submitted and the draft is preserved.`,
        );
      }
    } catch (error) {
      return {
        kind: "error",
        error,
        prepared: { receipt, attached: true, row: null },
      };
    }
  }

  onPhase("submitting");
  try {
    await submitPrompt(invokeCommand, {
      sessionId: receipt.sessionId,
      prompt,
      attachments: Array.isArray(attachments) ? attachments : [],
    });
  } catch (error) {
    return {
      kind: "error",
      error,
      prepared: { receipt, attached: true, row },
    };
  }

  let finished = row;
  try {
    finished = await updateMirror(receipt.sessionId, {
      firstUserMessage: prompt,
      touch: true,
    }, invokeCommand) || row;
  } catch {
    /* The prompt is already durably admitted. A failed local decoration may
       not turn that receipt into a failed send or encourage a duplicate. */
  }
  return {
    kind: "created",
    receipt,
    row: receiptRow(finished, receipt),
    prepared: null,
  };
}

const IDLE_STATUS = Object.freeze({ phase: "idle", message: "", admission: null });

export function useSessionCreate({ enabled = true } = {}) {
  const [features, setFeatures] = useState(null);
  const [status, setStatus] = useState(IDLE_STATUS);
  const [unavailable, setUnavailable] = useState(false);
  const featuresRef = useRef(null);
  const preparedRef = useRef(null);
  const unavailableRef = useRef(false);
  const mountedRef = useRef(true);

  const publishStatus = useCallback((next) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const refreshFeatures = useCallback(async () => {
    if (!enabled) return [];
    try {
      const published = await invoke("rpc_features");
      const next = Array.isArray(published) ? published : [];
      featuresRef.current = next;
      if (mountedRef.current) setFeatures(next);
      return next;
    } catch {
      featuresRef.current = [];
      if (mountedRef.current) setFeatures([]);
      return [];
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshFeatures();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshFeatures]);

  const materialize = useCallback(async (request) => {
    const published = featuresRef.current ?? await refreshFeatures();
    const featureAvailable = !unavailableRef.current
      && published.includes(SESSION_MUTATION_FEATURE);
    publishStatus({ phase: "starting", message: "Creating session…", admission: null });
    const result = await runSessionCreate({
      ...request,
      featureAvailable,
      prepared: preparedRef.current,
      onPhase: (phase) => publishStatus({
        phase,
        admission: null,
        message: phase === "creating"
          ? "Creating session…"
          : phase === "attaching"
            ? "Attaching the new session…"
            : phase === "mirroring"
              ? "Adding the accepted session to the local roster…"
              : "Submitting the first prompt…",
      }),
    });
    preparedRef.current = result.prepared || null;
    if (result.nativeUnavailable) {
      unavailableRef.current = true;
      if (mountedRef.current) setUnavailable(true);
    }

    if (result.kind === "created" || result.kind === "legacy") {
      publishStatus(IDLE_STATUS);
      return result.row;
    }
    if (result.kind === "admission") {
      const prefix = result.admission.state === "pending"
        ? "Session creation pending"
        : result.admission.state === "rejected"
          ? "Session not created"
          : "Session admission outcome unknown";
      const raw = result.admission.state === "unknown" && result.admission.data
        ? ` Raw: ${JSON.stringify(result.admission.data)}`
        : "";
      publishStatus({
        phase: result.admission.state,
        admission: result.admission,
        message: `${prefix}: ${result.admission.reason}${raw}`,
      });
      return null;
    }
    publishStatus({
      phase: "error",
      admission: null,
      message: errorMessage(result.error, "Unable to create the session."),
    });
    return null;
  }, [publishStatus, refreshFeatures]);

  const reset = useCallback(() => {
    preparedRef.current = null;
    publishStatus(IDLE_STATUS);
  }, [publishStatus]);

  const capabilities = useMemo(() => {
    const published = Array.isArray(features) ? features : [];
    return Object.freeze({
      native: enabled && !unavailable && published.includes(SESSION_MUTATION_FEATURE),
      permissionOverrides: published.includes(SESSION_PERMISSION_OVERRIDES_FEATURE),
      autonomous: published.includes(AUTONOMOUS_INTERACTION_FEATURE),
      admission: published.includes(SESSION_CREATE_ADMISSION_FEATURE),
    });
  }, [enabled, features, unavailable]);

  return {
    capabilities,
    featureChecked: features !== null,
    materialize,
    reset,
    status,
    unavailable,
  };
}
