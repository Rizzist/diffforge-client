export function shouldReconcileProviderTurnCompletion(event = {}) {
  return Boolean(
    event
      && event.type === "provider-turn-completed"
      && event.paneId
      && event.reconcileCoordination === true,
  );
}

export function getProviderTurnCompletionIntent(event = {}) {
  return String(event?.providerTurnIntent || "casual_message").trim() || "casual_message";
}
