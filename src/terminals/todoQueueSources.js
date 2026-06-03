export const TODO_QUEUE_SOURCE_TODO_AUTO = "tui-todo-auto-queue";
export const TODO_QUEUE_SOURCE_VOICE_AGENT = "tui-voice-agent-queue";
export const TODO_QUEUE_SOURCE_VOICE_PLAN = "tui-voice-plan-queue";
export const TODO_QUEUE_SOURCE_REMOTE_CONTROL = "next-remote-control";

export function normalizeTodoQueueSourceValue(value) {
  return String(value || "").trim();
}

export function getTodoQueueAutoQueueSourceForSource({ source } = {}) {
  const normalizedSource = normalizeTodoQueueSourceValue(source);
  if (
    normalizedSource === TODO_QUEUE_SOURCE_VOICE_AGENT
    || normalizedSource === TODO_QUEUE_SOURCE_VOICE_PLAN
    || normalizedSource === TODO_QUEUE_SOURCE_REMOTE_CONTROL
  ) {
    return normalizedSource;
  }

  return TODO_QUEUE_SOURCE_TODO_AUTO;
}

export function getTodoQueuePromptEventSourceForSource({ source } = {}) {
  const normalizedSource = normalizeTodoQueueSourceValue(source);
  if (normalizedSource === TODO_QUEUE_SOURCE_TODO_AUTO) {
    return "todo-auto-queue";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_VOICE_AGENT) {
    return "voice-agent-queue";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_VOICE_PLAN) {
    return "voice-plan-queue";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_REMOTE_CONTROL) {
    return "remote-control";
  }

  return "terminal-view-drop";
}

export function getTodoQueueLifecycleSourceForSource({ source } = {}) {
  const normalizedSource = normalizeTodoQueueSourceValue(source);
  if (
    normalizedSource === TODO_QUEUE_SOURCE_TODO_AUTO
    || normalizedSource === TODO_QUEUE_SOURCE_VOICE_AGENT
    || normalizedSource === TODO_QUEUE_SOURCE_VOICE_PLAN
    || normalizedSource === TODO_QUEUE_SOURCE_REMOTE_CONTROL
  ) {
    return normalizedSource;
  }

  return "tui-todo-drop";
}
