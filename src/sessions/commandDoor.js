export const COMMAND_DOOR_FEATURE = "command_door_v1";

export const COMMAND_NO_CONNECTION = "haider_command_no_connection";
export const COMMAND_FEATURE_MISSING = "haider_command_feature_missing";
export const COMMAND_LIST_FAILED = "haider_command_list_failed";
export const COMMAND_INVOKE_FAILED = "haider_command_invoke_failed";
export const COMMAND_PARK_FAILED = "haider_command_park_failed";

const IMPLEMENTED_CLIENT_COMMANDS = new Set([
  "accounts",
  "help",
  "model",
  "sessions",
  "theme",
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function commandToken(command) {
  return cleanText(command).split(/\s+/, 1)[0] || "/command";
}

function catalogName(item) {
  return cleanText(item?.name).replace(/^\//, "").toLowerCase();
}

function displayCommand(item, typedCommand = "") {
  const label = cleanText(item?.label);
  if (label.startsWith("/")) return label;
  const name = catalogName(item);
  return name ? `/${name}` : commandToken(typedCommand);
}

function commandArguments(command) {
  const trimmed = cleanText(command);
  const space = trimmed.search(/\s/);
  return space < 0 ? "" : trimmed.slice(space).trim();
}

function catalogItems(catalog) {
  if (Array.isArray(catalog)) return catalog;
  return Array.isArray(catalog?.items) ? catalog.items : [];
}

export function findCatalogCommand(catalog, command) {
  const rows = catalogItems(catalog);
  const name = commandToken(command).replace(/^\//, "").toLowerCase();
  const argument = commandArguments(command).toLowerCase();
  /* Argument rows are choices UNDER their parent command. Prefer the exact
     parent+argument row, then fall back to the parent BuiltIn/Custom row. */
  const argumentRow = rows.find((item) => (
    item?.kind === "argument"
      && catalogName(item) === name
      && cleanText(item?.value).toLowerCase() === argument
  ));
  return argumentRow || rows.find((item) => (
    item?.kind !== "argument" && catalogName(item) === name
  )) || null;
}

export function catalogToSlashCommands(catalog) {
  return catalogItems(catalog).map((item) => {
    const parent = displayCommand(item);
    const command = item?.kind === "argument"
      ? `${parent} ${cleanText(item?.value)}`.trim()
      : parent;
    return {
      command,
      hint: cleanText(item?.description) || cleanText(item?.arg_hint) || cleanText(item?.label),
      item,
    };
  }).filter((entry) => entry.command.startsWith("/") && entry.command.length > 1);
}

function withDescription(prefix, description) {
  const detail = cleanText(description);
  return detail ? `${prefix} ${detail}` : prefix;
}

/* Ownership is checked BEFORE kind. In particular, a current-daemon
   Argument row can have unknown ownership when its parent cannot be resolved;
   it must never fall through into the known `/model` local handler. */
export function routeClientCommand(item, typedCommand, executeLocal = () => {}) {
  const shown = displayCommand(item, typedCommand);
  if (item?.ownership !== "client_view") {
    const ownership = cleanText(item?.ownership) || "unknown";
    return {
      type: "refused",
      message: ownership === "unknown"
        ? `DiffForge did not run ${shown} because the command owner is unknown.`
        : `DiffForge did not run ${shown} because it belongs to the Haider daemon.`,
    };
  }

  if (item?.kind === "custom") {
    return {
      type: "custom",
      message: withDescription(`Custom command ${shown}.`, item?.description),
      expansion: cleanText(item?.value),
      item,
    };
  }

  const name = catalogName(item);
  if ((item?.kind === "built_in" || item?.kind === "argument")
    && IMPLEMENTED_CLIENT_COMMANDS.has(name)) {
    const action = {
      type: "client_action",
      action: name,
      argument: item?.kind === "argument"
        ? cleanText(item?.value)
        : commandArguments(typedCommand),
      item,
    };
    const result = executeLocal(action, typedCommand);
    return result && typeof result === "object" ? result : action;
  }

  if (item?.kind === "built_in" || item?.kind === "argument") {
    return {
      type: "unhandled",
      message: withDescription(`Unhandled command ${shown}.`, item?.description),
      item,
    };
  }

  return {
    type: "refused",
    message: withDescription(
      `DiffForge did not run ${shown} because its command kind is unknown.`,
      item?.description,
    ),
  };
}

function receiptMessage(receipt) {
  if (typeof receipt === "string" && receipt.trim()) return receipt.trim();
  if (receipt && typeof receipt === "object") {
    for (const key of ["message", "summary", "title", "label"]) {
      if (typeof receipt[key] === "string" && receipt[key].trim()) {
        return receipt[key].trim();
      }
    }
  }
  return "Command completed.";
}

export function commandOutcomeResult(outcome) {
  switch (outcome?.kind) {
    case "receipt":
      return { type: "receipt", message: receiptMessage(outcome.receipt), receipt: outcome.receipt };
    case "parked":
      /* The entire opaque card survives. Rust persists it before this result
         reaches JS; SessionTranscript then renders NeedsInputCard, whose sole
         answer door remains session_answer_menu. */
      return { type: "parked", needsInput: outcome.needs_input };
    case "unsupported": {
      const command = typeof outcome.command === "string"
        ? outcome.command
        : displayCommand(outcome.command);
      return {
        type: "unsupported",
        message: withDescription(`Haider does not support ${command || "this command"}.`, outcome.reason),
      };
    }
    default:
      return {
        type: "unhandled_outcome",
        message: "Haider returned a command result this DiffForge build does not understand.",
      };
  }
}

export function commandFailureCode(failure) {
  return cleanText(failure?.message || failure).split(":", 1)[0].trim();
}

export function commandFailureMessage(failure, phase = "invoke") {
  const code = commandFailureCode(failure);
  if (code === COMMAND_NO_CONNECTION) {
    return "No live connection to the Haider daemon, so commands are unavailable.";
  }
  if (code === COMMAND_FEATURE_MISSING) {
    return "The connected Haider daemon does not offer commands.";
  }
  if (code === COMMAND_LIST_FAILED) {
    return "DiffForge reached Haider, but could not load the command catalog.";
  }
  if (code === COMMAND_INVOKE_FAILED) {
    return "DiffForge reached Haider, but the command did not complete.";
  }
  if (code === COMMAND_PARK_FAILED) {
    return "Haider requested input, but DiffForge could not place its command menu in this session.";
  }
  const text = cleanText(failure?.message || failure);
  if (text) return text;
  return phase === "list"
    ? "The command catalog could not be loaded."
    : "The command did not complete.";
}

/* A catalog belongs to exactly one `in_session`+slots observation. This
   executor deliberately owns NO catalog state: every invocation re-lists
   immediately in its current context before routing by ownership. */
export function createCommandDoorExecutor({ listCommands, invokeCommand, executeLocal }) {
  return async ({ command, inSession, slots = {} }) => {
    let catalog;
    try {
      catalog = await listCommands({ query: "", in_session: inSession, slots });
    } catch (failure) {
      return { type: "error", message: commandFailureMessage(failure, "list") };
    }
    const item = findCatalogCommand(catalog, command);
    if (!item) {
      return {
        type: "not_found",
        message: `${commandToken(command)} is not in the command catalog for this context.`,
      };
    }
    if (item.ownership === "client_view") {
      return routeClientCommand(item, command, executeLocal);
    }
    if (item.ownership !== "daemon_operation") {
      return routeClientCommand(item, command, executeLocal);
    }

    let outcome;
    try {
      outcome = await invokeCommand({ command, item });
    } catch (failure) {
      return { type: "error", message: commandFailureMessage(failure, "invoke") };
    }
    if (outcome?.kind === "client_owned") {
      const returned = outcome.command && typeof outcome.command === "object"
        ? outcome.command
        : findCatalogCommand(catalog, command);
      return routeClientCommand(returned, command, executeLocal);
    }
    return commandOutcomeResult(outcome);
  };
}
