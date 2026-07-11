export function shouldReconcileProviderTurnCompletion(event = {}) {
  return Boolean(
    event
      && event.type === "provider-turn-completed"
      && event.pane_id
      && event.reconcile_coordination === true,
  );
}

export function getProviderTurnCompletionIntent(event = {}) {
  return String(event?.provider_turn_intent || "casual_message").trim() || "casual_message";
}
