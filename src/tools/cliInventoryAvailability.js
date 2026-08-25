export function readCliInventoryPublication(publication) {
  const state = String(publication?.state || "").trim();
  if (state === "published") {
    if (!Array.isArray(publication?.statuses)) {
      throw new Error("Published agent inventory is missing its statuses list.");
    }
    return { state, statuses: publication.statuses, reason: "" };
  }
  if (state === "unavailable") {
    const reason = String(publication?.reason || "").trim();
    if (!reason) {
      throw new Error("Unavailable agent inventory is missing its reason.");
    }
    return { state, statuses: null, reason };
  }
  throw new Error("Agent inventory did not publish an availability state.");
}

function inventoryText(value) {
  return String(value ?? "").trim();
}

function agentUpdateProgressFields(status) {
  return {
    update_stage: inventoryText(status?.update_stage || status?.updateStage).toLowerCase(),
    update_stage_seq: Number(status?.update_stage_seq ?? status?.updateStageSeq) || 0,
    update_to_version: inventoryText(status?.update_to_version || status?.updateToVersion),
    update_error_reason: inventoryText(status?.update_error_reason || status?.updateErrorReason),
    update_failed_stage: inventoryText(status?.update_failed_stage || status?.updateFailedStage),
  };
}

/* A snapshot exists only when the backend explicitly published a list. In
   particular, null is the typed value for an unavailable inventory and must
   never be reinterpreted as a healthy empty snapshot. */
export function cliSnapshotFromStatuses(statuses) {
  if (!Array.isArray(statuses)) {
    throw new TypeError("CLI snapshot requires a published statuses array.");
  }
  return statuses.map((status) => ({
    agent_id: inventoryText(status?.provider || status?.id),
    agent_label: inventoryText(status?.label),
    installed: Boolean(status?.installed),
    authenticated: Boolean(status?.authenticated),
    version: inventoryText(status?.version),
    npm_package_version: inventoryText(status?.npm_package_version),
    npm_latest_version: inventoryText(status?.npm_latest_version),
    update_available: Boolean(status?.npm_update_available),
    ...agentUpdateProgressFields(status),
    active_model: inventoryText(status?.active_model),
  }));
}
