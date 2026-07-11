export const LOOPSPACE_AUTOMATION_APP_CONTROL_MAX_TERMINALS = 3;

export function appControlPreAcceptanceFailureDefersAck({
  failed = false,
  recoveryScheduled = false,
  terminalAccepted = false,
} = {}) {
  return Boolean(failed && !terminalAccepted && recoveryScheduled);
}

function appControlRoutingDetailSources(detail = {}) {
  const event = detail?.event && typeof detail.event === "object" ? detail.event : {};
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const dispatchSource = detail?.dispatch_source && typeof detail.dispatch_source === "object" ? detail.dispatch_source : {};
  const dispatchTarget = detail?.dispatch_target && typeof detail.dispatch_target === "object" ? detail.dispatch_target : {};
  return [detail, event, payload, dispatchSource, dispatchTarget];
}

function appControlRoutingDetailValue(detail = {}, keys = []) {
  for (const source of appControlRoutingDetailSources(detail)) {
    for (const key of keys) {
      const value = source?.[key];
      if (value === undefined || value === null) {
        continue;
      }
      const text = String(value).trim();
      if (text) {
        return value;
      }
    }
  }
  return "";
}

function appControlRoutingDetailString(detail = {}, keys = []) {
  return String(appControlRoutingDetailValue(detail, keys) || "").trim();
}

function appControlRoutingDetailInteger(detail = {}, keys = []) {
  const value = appControlRoutingDetailValue(detail, keys);
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? number : null;
}

function appControlRoutingDetailBoolean(detail = {}, keys = [], fallback = true) {
  const value = appControlRoutingDetailValue(detail, keys);
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off", "disabled"].includes(text)) {
    return false;
  }
  if (["1", "true", "yes", "on", "enabled"].includes(text)) {
    return true;
  }
  return fallback;
}

export function remoteCommandIsMessageIntent(detail = {}) {
  const actionKind = appControlRoutingDetailString(detail, ["action_kind"])
    .toLowerCase()
    .replace(/[. -]+/g, "_");
  if (actionKind === "message") {
    return true;
  }
  if (actionKind === "todo") {
    return false;
  }
  const commandKind = appControlRoutingDetailString(detail, [
    "command_kind",
    "action",
    "command",
  ])
    .toLowerCase()
    .replace(/[. -]+/g, "_");
  return [
    "terminal_orchestrator_send_message",
    "terminal_send_message",
    "orchestrator_send_message",
    "loopspace_send_message",
    "send_message",
  ].includes(commandKind);
}

function clampLoopspaceAutomationMaxTotal(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number)) {
    return LOOPSPACE_AUTOMATION_APP_CONTROL_MAX_TERMINALS;
  }
  return Math.max(1, Math.min(LOOPSPACE_AUTOMATION_APP_CONTROL_MAX_TERMINALS, number));
}

function normalizeTerminalIndexes(indexes = [], maxTerminalCount = 4) {
  const safeMaxTerminalCount = Math.max(1, Number.parseInt(maxTerminalCount, 10) || 1);
  const normalized = [];
  for (const value of Array.isArray(indexes) ? indexes : []) {
    const index = Number.parseInt(value, 10);
    if (
      Number.isInteger(index)
      && index >= 0
      && index < safeMaxTerminalCount
      && !normalized.includes(index)
    ) {
      normalized.push(index);
    }
  }
  return normalized.length ? normalized : [0];
}

export function isLoopspaceAutomationAppControlMessage(detail = {}) {
  const sourceKind = appControlRoutingDetailString(detail, [
    "source_kind",
    "kind",
    "cause",
  ]).toLowerCase();
  if (sourceKind === "loopspace_runtime" || sourceKind === "cloud_loopspace_runtime") {
    return true;
  }

  const source = appControlRoutingDetailString(detail, ["source", "reason"]).toLowerCase();
  if (source === "cloud_loopspace_runtime" || source === "loopspace_runtime") {
    return true;
  }

  return Boolean(
    appControlRoutingDetailString(detail, ["loop_runtime_run_id", "run_id"])
      || appControlRoutingDetailString(detail, ["loopspace_id"])
      || appControlRoutingDetailString(detail, ["trigger_run_id"]),
  );
}

export function appControlMessageHasExplicitTerminalTarget(detail = {}) {
  return Boolean(
    appControlRoutingDetailString(detail, [
      "target_terminal_id",
      "terminal_id",
      "pane_id",
    ])
      || Number.isInteger(appControlRoutingDetailInteger(detail, [
        "target_terminal_index",
        "terminal_index",
      ]))
      || appControlRoutingDetailString(detail, [
        "target_terminal_name",
        "target_terminal_nickname",
        "terminal_name",
        "terminal_nickname",
        "target_name",
        "name",
      ])
      || appControlRoutingDetailString(detail, [
        "target_thread_id",
        "thread_id",
      ]),
  );
}

export function loopspaceAutomationAutoSpawnEnabled(detail = {}) {
  return appControlRoutingDetailBoolean(detail, [
    "orchestrator_auto_spawn",
    "auto_spawn_orchestrator",
  ], true);
}

export function getLoopspaceAutomationAutoSpawnMaxTotal(detail = {}) {
  const explicitMaxTotal = appControlRoutingDetailInteger(detail, [
    "orchestrator_auto_spawn_max_total",
    "max_auto_pool_size",
  ]);
  if (Number.isInteger(explicitMaxTotal)) {
    return clampLoopspaceAutomationMaxTotal(explicitMaxTotal);
  }

  const explicitAdditional = appControlRoutingDetailInteger(detail, [
    "orchestrator_auto_spawn_max_additional",
    "max_additional_orchestrators",
  ]);
  if (Number.isInteger(explicitAdditional)) {
    return clampLoopspaceAutomationMaxTotal(explicitAdditional + 1);
  }

  return LOOPSPACE_AUTOMATION_APP_CONTROL_MAX_TERMINALS;
}

export function buildAppControlPromptWithAttachmentMarkers(text = "", stageResult = {}) {
  const prompt = String(text || "").trim();
  const markerBlock = String(stageResult?.marker_block || "").trim();
  const warningBlock = String(stageResult?.warning_block || "").trim();
  const attachmentBlock = [markerBlock, warningBlock].filter(Boolean).join("\n");
  if (!attachmentBlock) {
    return prompt;
  }
  /* LS/1 structured prompts carry the user message in a msg: section that
     ends at the steps: line; attachment markers appended after the final
     done line sit outside the protocol and the agent won't tie the image to
     the message. Insert them at the end of the msg: section instead. */
  if (prompt.startsWith("LS/1 ")) {
    const lines = prompt.split("\n");
    const msgIndex = lines.indexOf("msg:");
    const stepsIndex = msgIndex === -1
      ? -1
      : lines.findIndex((line, index) => index > msgIndex && line === "steps:");
    if (msgIndex !== -1 && stepsIndex !== -1) {
      const insertAt = lines[stepsIndex - 1]?.trim() === "" ? stepsIndex - 1 : stepsIndex;
      return [
        ...lines.slice(0, insertAt),
        ...attachmentBlock.split("\n"),
        ...lines.slice(insertAt),
      ].join("\n");
    }
  }
  return [prompt, attachmentBlock].filter(Boolean).join("\n\n");
}

export function selectLoopspaceAutomationAppControlTerminal({
  indexes = [],
  rolesByIndex = {},
  target_role: targetRole = "",
  preferredIndex = null,
  maxAutoTerminalCount = LOOPSPACE_AUTOMATION_APP_CONTROL_MAX_TERMINALS,
  maxTerminalCount = 4,
  isTerminalBusy = () => false,
  getQueueDepth = () => 0,
} = {}) {
  const safeMaxTerminalCount = Math.max(1, Number.parseInt(maxTerminalCount, 10) || 1);
  const safeMaxAutoTerminalCount = Math.max(
    1,
    Math.min(
      safeMaxTerminalCount,
      LOOPSPACE_AUTOMATION_APP_CONTROL_MAX_TERMINALS,
      Number.parseInt(maxAutoTerminalCount, 10) || LOOPSPACE_AUTOMATION_APP_CONTROL_MAX_TERMINALS,
    ),
  );
  const currentIndexes = normalizeTerminalIndexes(indexes, safeMaxTerminalCount);
  const requestedRole = String(targetRole || "").trim().toLowerCase();
  const preferredTerminalIndex = Number.parseInt(preferredIndex, 10);
  const terminalStates = currentIndexes.map((index) => {
    const queueDepth = Math.max(0, Number.parseInt(getQueueDepth(index), 10) || 0);
    const busy = Boolean(isTerminalBusy(index));
    return {
      busy,
      index,
      load: queueDepth + (busy ? 1 : 0),
      queueDepth,
      role: String(rolesByIndex?.[index] || "").trim().toLowerCase(),
    };
  });
  const idleStates = terminalStates.filter((state) => !state.busy && state.queueDepth === 0);
  const idleRoleMatch = requestedRole
    ? idleStates.find((state) => state.role === requestedRole)
    : null;
  if (idleRoleMatch) {
    return {
      autoSpawned: false,
      maxAutoPoolSize: safeMaxAutoTerminalCount,
      orchestratorPoolSize: currentIndexes.length,
      reason: "idle_role_match",
      terminal_index: idleRoleMatch.index,
    };
  }

  const idlePreferred = Number.isInteger(preferredTerminalIndex)
    ? idleStates.find((state) => state.index === preferredTerminalIndex)
    : null;
  if (idlePreferred) {
    return {
      autoSpawned: false,
      maxAutoPoolSize: safeMaxAutoTerminalCount,
      orchestratorPoolSize: currentIndexes.length,
      reason: "idle_preferred",
      terminal_index: idlePreferred.index,
    };
  }

  const idleAny = idleStates[0] || null;
  if (idleAny) {
    return {
      autoSpawned: false,
      maxAutoPoolSize: safeMaxAutoTerminalCount,
      orchestratorPoolSize: currentIndexes.length,
      reason: "idle_available",
      terminal_index: idleAny.index,
    };
  }

  if (currentIndexes.length < safeMaxAutoTerminalCount) {
    for (let index = 0; index < safeMaxTerminalCount; index += 1) {
      if (!currentIndexes.includes(index)) {
        return {
          autoSpawned: true,
          maxAutoPoolSize: safeMaxAutoTerminalCount,
          orchestratorPoolSize: currentIndexes.length + 1,
          previousPoolSize: currentIndexes.length,
          reason: "auto_spawn_loopspace_automation",
          terminal_index: index,
        };
      }
    }
  }

  const leastLoaded = terminalStates
    .slice()
    .sort((left, right) => (
      left.load - right.load
        || left.queueDepth - right.queueDepth
        || left.index - right.index
    ))[0];

  return {
    autoSpawned: false,
    maxAutoPoolSize: safeMaxAutoTerminalCount,
    orchestratorPoolSize: currentIndexes.length,
    queueDepth: leastLoaded?.queueDepth || 0,
    reason: "least_loaded_queue",
    shouldQueue: true,
    terminal_index: leastLoaded?.index ?? currentIndexes[0] ?? 0,
  };
}
