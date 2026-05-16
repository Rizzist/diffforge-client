// Centralized display-only masking for terminal agent paths.
//
// Diff Forge intentionally runs coding agents inside functional git worktrees
// such as:
//   /repo/.agents/worktrees/codex-01
// Those paths are implementation detail. Users should see the core repo name
// (for example `/testforge`) while edits still happen in the isolated worktree.
//
// Keep this file as the single frontend place that decides how functional repo
// paths are collapsed for terminal chrome and raw PTY/Codex output.

import {
  collapseFunctionalRepoPathToCoreRepoPath as collapseWorkspaceFunctionalRepoPathToCoreRepoPath,
  createWorkspacePathAliases,
  getWorkspaceDisplayRootLabel,
  normalizeWorkspacePathSeparators,
  workspacePathLeaf,
  workspacePathLooksCaseInsensitive,
  workspacePathRegExpSource,
} from "../workspace/workspaceDisplayIdentity.js";

const FUNCTIONAL_REPO_WORKTREE_MARKER = "/.agents/worktrees";
const FUNCTIONAL_REPO_AGENTS_MARKER = "/.agents";
const ANSI_CSI_PATTERN = String.raw`\u001b\[[0-?]*[ -/]*[@-~]`;
const FUNCTIONAL_REPO_PATH_BOUNDARY = String.raw`(?=$|[\s"'` + "`" + String.raw`<>()\[\]{}|;,\u001b])`;
const FUNCTIONAL_REPO_PATH_CHILD = String.raw`((?:[\/\\][^\s"'` + "`" + String.raw`<>()\[\]{}|;,\u001b]+)*)`;
const FUNCTIONAL_REPO_PATH_TERMINATORS = new Set([
  "",
  " ",
  "\t",
  "\r",
  "\n",
  "\"",
  "'",
  "`",
  "<",
  ">",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "|",
  ";",
  ",",
  "\u001b",
]);

function replacementForCoreRepo(coreRepoPath, childPath = "") {
  const repoName = workspacePathLeaf(coreRepoPath);
  if (!repoName) return childPath || "";
  const normalizedChild = normalizeWorkspacePathSeparators(childPath).replace(/^\/+/, "");
  return normalizedChild ? `/${repoName}/${normalizedChild}` : `/${repoName}`;
}

export function collapseFunctionalRepoPathToCoreRepoPath(value) {
  return collapseWorkspaceFunctionalRepoPathToCoreRepoPath(value);
}

export function getCoreRepoDisplayLabel(value, fallback = "Project") {
  return getWorkspaceDisplayRootLabel(collapseFunctionalRepoPathToCoreRepoPath(value), fallback);
}

function regexFlagsForPath(value) {
  return workspacePathLooksCaseInsensitive(value) ? "gi" : "g";
}

function maskKnownFunctionalPath(text, functionalRepoPath, coreRepoPath) {
  const functionalPath = normalizeWorkspacePathSeparators(functionalRepoPath).replace(/\/+$/g, "");
  const corePath = normalizeWorkspacePathSeparators(coreRepoPath).replace(/\/+$/g, "");

  if (!functionalPath || !corePath || functionalPath === corePath) {
    return text;
  }

  let next = text;
  const variants = createWorkspacePathAliases(functionalPath);
  for (const variant of variants) {
    const pathSource = workspacePathRegExpSource(variant);
    if (!pathSource) continue;
    const pattern = new RegExp(
      `${pathSource}((?:[/\\\\][^\\s"'\\\`<>()\\[\\]{}|;,\\u001b]+)*)(?=$|[\\s"'\\\`<>()\\[\\]{}|;,\\u001b])`,
      regexFlagsForPath(variant),
    );
    next = next.replace(pattern, (_match, childPath = "") => (
      replacementForCoreRepo(corePath, childPath)
    ));
  }
  return next;
}

function maskKnownCorePath(text, coreRepoPath) {
  const corePath = normalizeWorkspacePathSeparators(coreRepoPath).replace(/\/+$/g, "");

  if (!corePath) {
    return text;
  }

  let next = text;
  const variants = createWorkspacePathAliases(corePath);
  for (const variant of variants) {
    const pathSource = workspacePathRegExpSource(variant);
    if (!pathSource) continue;
    const pattern = new RegExp(
      `${pathSource}((?:[/\\\\][^\\s"'\\\`<>()\\[\\]{}|;,\\u001b]+)*)(?=$|[\\s"'\\\`<>()\\[\\]{}|;,\\u001b])`,
      regexFlagsForPath(variant),
    );
    next = next.replace(pattern, (_match, childPath = "") => (
      replacementForCoreRepo(corePath, childPath)
    ));
  }
  return next;
}

function maskEllipsizedFunctionalPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|[\/\\]|[A-Za-z]:[\/\\]|\\\\)[^\s"'`<>()\[\]{}|;,\u001b]*?(?:…|\.\.\.)[\/\\]worktrees[\/\\][^\/\\\s"'`<>()\[\]{}|;,\u001b]+)((?:[\/\\][^\s"'`<>()\[\]{}|;,\u001b]+)*)/g,
    (_match, _functionalPath, childPath = "") => (
      replacementForCoreRepo(coreRepoPath, childPath)
    ),
  );
}

function maskCodexShortenedFunctionalPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|[\/\\]|[A-Za-z]:[\/\\]|\\\\)[^\s"'`<>()\[\]{}|;,\u001b]*[\/\\]([^\/\\\s"'`<>()\[\]{}|;,\u001b]+)[\/\\]\.agents[\/\\]work(?:…|\.\.\.))(?=$|[\s"'`<>()\[\]{}|;,\u001b])/g,
    (_match, _functionalPath, repoName) => (
      replacementForCoreRepo(coreRepoPath || repoName)
    ),
  );
}

function maskAnsiDecoratedCoreAgentsPath(text, coreRepoPath) {
  const corePath = normalizeWorkspacePathSeparators(coreRepoPath).replace(/\/+$/g, "");
  if (!corePath) {
    return text;
  }

  let next = String(text || "");
  const variants = createWorkspacePathAliases(corePath);
  for (const variant of variants) {
    const pathSource = workspacePathRegExpSource(variant);
    if (!pathSource) continue;
    const pattern = new RegExp(
      `${pathSource}(?:${ANSI_CSI_PATTERN})+[\\\\/]\\.(?:a|ag|age|agen|agent|agents[^\\s"'\\\`<>()\\[\\]{}|;,\\u001b]*)(?:…|\\.\\.\\.)?(?=$|[\\s"'\\\`<>()\\[\\]{}|;,\\u001b])`,
      regexFlagsForPath(variant),
    );
    next = next.replace(pattern, () => replacementForCoreRepo(corePath));
  }
  return next;
}

function maskPartialAgentsMarkerPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|[\/\\]|[A-Za-z]:[\/\\]|\\\\)[^\s"'`<>()\[\]{}|;,\u001b]*[\/\\]([^\/\\\s"'`<>()\[\]{}|;,\u001b]+)[\/\\]\.(?:a|ag|age|agen|agent|agents)(?:…|\.\.\.)?)(?=$|[\s"'`<>()\[\]{}|;,\u001b])/g,
    (_match, _functionalPath, repoName) => (
      replacementForCoreRepo(coreRepoPath || repoName)
    ),
  );
}

function maskFullWorktreePath(text) {
  return String(text || "").replace(
    /((?:~|[\/\\]|[A-Za-z]:[\/\\]|\\\\)[^\s"'`<>()\[\]{}|;,\u001b]*[\/\\]([^\/\\\s"'`<>()\[\]{}|;,\u001b]+)[\/\\]\.agents[\/\\]worktrees[\/\\][^\/\\\s"'`<>()\[\]{}|;,\u001b]+)((?:[\/\\][^\s"'`<>()\[\]{}|;,\u001b]+)*)/g,
    (_match, _functionalPath, repoName, childPath = "") => (
      replacementForCoreRepo(repoName, childPath)
    ),
  );
}

function maskAnyAgentsInternalPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|[\/\\]|[A-Za-z]:[\/\\]|\\\\)[^\s"'`<>()\[\]{}|;,\u001b]*[\/\\]([^\/\\\s"'`<>()\[\]{}|;,\u001b]+)[\/\\]\.agents[^\s"'`<>()\[\]{}|;,\u001b]*)/g,
    (_match, _functionalPath, repoName) => (
      replacementForCoreRepo(coreRepoPath || repoName)
    ),
  );
}

function maskPrivateRuntimeNamespaceLeaks(text, coreRepoPath) {
  const corePath = normalizeWorkspacePathSeparators(coreRepoPath).replace(/\/+$/g, "");
  if (!corePath) {
    return text;
  }

  const coreDisplay = replacementForCoreRepo(corePath);
  const coreDisplaySource = workspacePathRegExpSource(coreDisplay);
  if (!coreDisplay || !coreDisplaySource) {
    return text;
  }

  let next = String(text || "");
  const normalizedChild = (childPath = "") => normalizeWorkspacePathSeparators(childPath).replace(/^\/+/, "");
  const displayWithChild = (childPath = "") => replacementForCoreRepo(corePath, normalizedChild(childPath));

  next = next.replace(
    new RegExp(`${coreDisplaySource}[\\\\/]\\.agents[\\\\/]worktrees[\\\\/][^\\\\/\\s"'\\\`<>()\\[\\]{}|;,\\u001b]+${FUNCTIONAL_REPO_PATH_CHILD}${FUNCTIONAL_REPO_PATH_BOUNDARY}`, "g"),
    (_match, childPath = "") => displayWithChild(childPath),
  );
  next = next.replace(
    new RegExp(`${coreDisplaySource}[\\\\/]\\.agents[^\\s"'\\\`<>()\\[\\]{}|;,\\u001b]*${FUNCTIONAL_REPO_PATH_BOUNDARY}`, "g"),
    () => coreDisplay,
  );

  const leadingBoundary = String.raw`(^|[\s"'` + "`" + String.raw`<>()\[\]{}|;,\u001b])`;
  next = next.replace(
    new RegExp(`${leadingBoundary}[\\\\/]?\\.agents[\\\\/]worktrees[\\\\/][^\\\\/\\s"'\\\`<>()\\[\\]{}|;,\\u001b]+${FUNCTIONAL_REPO_PATH_CHILD}${FUNCTIONAL_REPO_PATH_BOUNDARY}`, "g"),
    (_match, boundary = "", childPath = "") => `${boundary}${displayWithChild(childPath)}`,
  );
  next = next.replace(
    new RegExp(`${leadingBoundary}[\\\\/]?\\.agents[^\\s"'\\\`<>()\\[\\]{}|;,\\u001b]*${FUNCTIONAL_REPO_PATH_BOUNDARY}`, "g"),
    (_match, boundary = "") => `${boundary}${coreDisplay}`,
  );

  return next;
}

function maskTodoAttachmentDisplayText(text) {
  return String(text || "")
    .replace(
      /\[image-attached(?:\s+\d+)?\][^\r\n]*?\s+->\s+(?:[A-Za-z]:[\\/]|\\\\|\/|~)[^\r\n]*/g,
      "[image-attached]",
    )
    .replace(
      /(\[pasted-lines\s+\d+\])[^\r\n]*?\s+->\s+(?:[A-Za-z]:[\\/]|\\\\|\/|~)[^\r\n]*/g,
      "$1",
    )
    .replace(
      /(?:[A-Za-z]:[\\/]|\\\\|\/|~)[^\r\n\s"'`<>()\[\]{}|;,\u001b]*diffforge-todo-attachments[\\/][^\r\n\s"'`<>()\[\]{}|;,\u001b]*-images-[^\r\n\s"'`<>()\[\]{}|;,\u001b]*/gi,
      "[image-attached]",
    )
    .replace(
      /(?:[A-Za-z]:[\\/]|\\\\|\/|~)[^\r\n\s"'`<>()\[\]{}|;,\u001b]*diffforge-todo-attachments[\\/][^\r\n\s"'`<>()\[\]{}|;,\u001b]*-text-[^\r\n\s"'`<>()\[\]{}|;,\u001b]*pasted-lines-?(\d+)?[^\r\n\s"'`<>()\[\]{}|;,\u001b]*/gi,
      (_match, lineCount = "") => (lineCount ? `[pasted-lines ${lineCount}]` : "[pasted-lines]"),
    );
}

function maskTrailingKnownCoreRepoPath(text, coreRepoPath) {
  const corePath = normalizeWorkspacePathSeparators(coreRepoPath).replace(/\/+$/g, "");
  if (!corePath) {
    return { masked: false, text };
  }

  const variants = createWorkspacePathAliases(corePath)
    .map((variant) => normalizeWorkspacePathSeparators(variant).replace(/\/+$/g, ""))
    .sort((left, right) => right.length - left.length);

  for (const variant of variants) {
    const pathSource = workspacePathRegExpSource(variant);
    if (!pathSource) {
      continue;
    }

    const match = String(text || "").match(new RegExp(`${pathSource}$`, regexFlagsForPath(variant).replace("g", "")));
    if (!match) {
      continue;
    }

    const start = match.index ?? (text.length - match[0].length);
    const boundaryStart = rewindAnsiSequencesBeforeIndex(text, start);
    const before = text.slice(0, boundaryStart);
    const previous = before[before.length - 1] || "";
    if (before && !FUNCTIONAL_REPO_PATH_TERMINATORS.has(previous)) {
      continue;
    }

    return {
      masked: true,
      text: `${text.slice(0, start)}${replacementForCoreRepo(corePath)}`,
    };
  }

  return { masked: false, text };
}

function hasFunctionalRepoPathTerminator(text) {
  return [...String(text || "")].some((character) => (
    FUNCTIONAL_REPO_PATH_TERMINATORS.has(character)
  ));
}

function shouldCarryLeadingAgentsContinuation(rest) {
  const normalized = normalizeWorkspacePathSeparators(rest);
  if (!normalized) {
    return false;
  }
  if (`${FUNCTIONAL_REPO_WORKTREE_MARKER}/`.startsWith(normalized)) {
    return true;
  }
  if (normalized.startsWith(`${FUNCTIONAL_REPO_WORKTREE_MARKER}/`)) {
    const afterMarker = normalized.slice(FUNCTIONAL_REPO_WORKTREE_MARKER.length + 1);
    return Boolean(afterMarker)
      && !afterMarker.includes("/")
      && !hasFunctionalRepoPathTerminator(afterMarker);
  }
  return normalized.startsWith(FUNCTIONAL_REPO_AGENTS_MARKER)
    && !hasFunctionalRepoPathTerminator(normalized);
}

function stripLeadingAgentsContinuationAfterCoreRepo(text) {
  const source = String(text || "");
  const ansiPrefix = source.match(new RegExp(`^(?:${ANSI_CSI_PATTERN})*`))?.[0] || "";
  const rest = source.slice(ansiPrefix.length);

  if (shouldCarryLeadingAgentsContinuation(rest)) {
    return { consumed: true, carry: source, text: "" };
  }

  const worktreeMatch = rest.match(
    /^[\/\\]\.agents[\/\\]worktrees[\/\\][^\/\\\s"'`<>()\[\]{}|;,\u001b]+((?:[\/\\][^\s"'`<>()\[\]{}|;,\u001b]+)*)([\s\S]*)$/,
  );

  if (worktreeMatch) {
    if (!worktreeMatch[1] && !worktreeMatch[2]) {
      return { consumed: true, carry: source, text: "" };
    }

    const childPath = normalizeWorkspacePathSeparators(worktreeMatch[1] || "");
    return {
      consumed: true,
      text: `${ansiPrefix}${childPath}${worktreeMatch[2] || ""}`,
    };
  }

  const internalAgentsMatch = rest.match(
    /^[\/\\]\.agents(?=$|[\/\\\s"'`<>()\[\]{}|;,\u001b]|…|\.{3})(?:[\/\\][^\s"'`<>()\[\]{}|;,\u001b]*)?(?:…|\.\.\.)?([\s\S]*)$/,
  );
  if (internalAgentsMatch) {
    return {
      consumed: true,
      text: `${ansiPrefix}${internalAgentsMatch[1] || ""}`,
    };
  }

  const partialAgentsMarkerMatch = rest.match(
    /^[\/\\]\.([A-Za-z]*)(?:…|\.\.\.)?([\s\S]*)$/,
  );
  if (
    partialAgentsMarkerMatch
    && ["a", "ag", "age", "agen", "agent"].includes(partialAgentsMarkerMatch[1] || "")
  ) {
    return {
      consumed: true,
      text: `${ansiPrefix}${partialAgentsMarkerMatch[2] || ""}`,
    };
  }

  return { consumed: false, text: source };
}

export function maskFunctionalRepoPathsForDisplayText(value, options = {}) {
  const text = String(value || "");
  const knownMasked = maskKnownFunctionalPath(
    maskTodoAttachmentDisplayText(text),
    options.functionalRepoPath,
    options.coreRepoPath,
  );
  const coreMasked = maskKnownCorePath(
    knownMasked,
    options.coreRepoPath,
  );
  const codexShortenedMasked = maskCodexShortenedFunctionalPath(
    coreMasked,
    options.coreRepoPath,
  );
  const ansiDecoratedMasked = maskAnsiDecoratedCoreAgentsPath(
    codexShortenedMasked,
    options.coreRepoPath,
  );
  const partialAgentsMasked = maskPartialAgentsMarkerPath(
    ansiDecoratedMasked,
    options.coreRepoPath,
  );
  const ellipsizedMasked = maskEllipsizedFunctionalPath(
    partialAgentsMasked,
    options.coreRepoPath,
  );
  const worktreeMasked = maskFullWorktreePath(ellipsizedMasked);
  const agentsMasked = maskAnyAgentsInternalPath(worktreeMasked, options.coreRepoPath);

  return maskPrivateRuntimeNamespaceLeaks(agentsMasked, options.coreRepoPath);
}

function rewindAnsiSequencesBeforeIndex(text, index) {
  let next = index;
  while (next > 0) {
    const before = text.slice(0, next);
    const match = before.match(new RegExp(`(?:${ANSI_CSI_PATTERN})$`));
    if (!match) {
      break;
    }
    next -= match[0].length;
  }
  return next;
}

function findFunctionalPathCarryStart(text) {
  const normalized = normalizeWorkspacePathSeparators(text);
  let markerIndex = normalized.lastIndexOf(FUNCTIONAL_REPO_WORKTREE_MARKER);
  if (markerIndex < 0) {
    markerIndex = normalized.lastIndexOf(FUNCTIONAL_REPO_AGENTS_MARKER);
  }
  if (markerIndex < 0) {
    const matches = [...normalized.matchAll(/(?:…|\.\.\.)[\/\\]worktrees/g)];
    markerIndex = matches.length ? matches[matches.length - 1].index : -1;
  }
  if (markerIndex < 0) {
    for (let length = FUNCTIONAL_REPO_AGENTS_MARKER.length - 1; length >= 2; length -= 1) {
      const prefix = FUNCTIONAL_REPO_AGENTS_MARKER.slice(0, length);
      if (normalized.endsWith(prefix)) {
        markerIndex = normalized.length - prefix.length;
        break;
      }
    }
  }
  if (markerIndex < 0) return -1;

  let start = rewindAnsiSequencesBeforeIndex(text, markerIndex);
  while (start > 0) {
    const previous = text[start - 1];
    if (FUNCTIONAL_REPO_PATH_TERMINATORS.has(previous)) break;
    start -= 1;
  }
  return start;
}

function shouldCarryFunctionalPathTail(text) {
  if (!text) return false;
  const normalized = normalizeWorkspacePathSeparators(text);
  const markerIndex = normalized.lastIndexOf(FUNCTIONAL_REPO_WORKTREE_MARKER);
  if (markerIndex >= 0) {
    const afterMarker = normalized.slice(markerIndex + FUNCTIONAL_REPO_WORKTREE_MARKER.length);
    if (/^\/[^\s"'`<>()\[\]{}|;,\u001b]+/.test(afterMarker)) {
      return false;
    }
    return !/[ \t\r\n"'`<>()\[\]{}|;,\u001b]/.test(afterMarker);
  }

  const agentsMarkerIndex = normalized.lastIndexOf(FUNCTIONAL_REPO_AGENTS_MARKER);
  if (agentsMarkerIndex >= 0) {
    const afterMarker = normalized.slice(agentsMarkerIndex + FUNCTIONAL_REPO_AGENTS_MARKER.length);
    if (afterMarker.includes("…") || afterMarker.includes("...")) {
      return false;
    }
    if (afterMarker === "" || "/worktrees".startsWith(afterMarker)) {
      return !/[ \t\r\n"'`<>()\[\]{}|;,\u001b]/.test(afterMarker);
    }
    return false;
  }

  for (let length = FUNCTIONAL_REPO_AGENTS_MARKER.length - 1; length >= 2; length -= 1) {
    if (normalized.endsWith(FUNCTIONAL_REPO_AGENTS_MARKER.slice(0, length))) {
      return true;
    }
  }

  const matches = [...normalized.matchAll(/(?:…|\.\.\.)[\/\\]worktrees/g)];
  const lastMatch = matches[matches.length - 1];
  if (!lastMatch) return false;

  const afterMarker = normalized.slice(lastMatch.index + lastMatch[0].length);
  if (/^[\/\\][^\s"'`<>()\[\]{}|;,\u001b]+/.test(afterMarker)) {
    return false;
  }
  return !/[ \t\r\n"'`<>()\[\]{}|;,\u001b]/.test(afterMarker);
}

export function createCoreRepoNameDisplayMasker(options = {}) {
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let coreRepoPath = options.coreRepoPath || "";
  let functionalRepoPath = options.functionalRepoPath || "";
  let carry = "";
  let lastWriteEndedWithCoreRepoReplacement = false;

  return {
    setPaths(nextOptions = {}) {
      if (Object.prototype.hasOwnProperty.call(nextOptions, "coreRepoPath")) {
        coreRepoPath = nextOptions.coreRepoPath || "";
      }
      if (Object.prototype.hasOwnProperty.call(nextOptions, "functionalRepoPath")) {
        functionalRepoPath = nextOptions.functionalRepoPath || "";
      }
    },

    maskBytes(data) {
      let text = `${carry}${decoder.decode(data, { stream: true })}`;
      carry = "";

      if (lastWriteEndedWithCoreRepoReplacement) {
        const stripped = stripLeadingAgentsContinuationAfterCoreRepo(text);
        text = stripped.text;
        if (stripped.carry) {
          carry = stripped.carry;
        }
        lastWriteEndedWithCoreRepoReplacement = Boolean(stripped.carry);
      }

      let readyText = text;
      if (shouldCarryFunctionalPathTail(text)) {
        const carryStart = findFunctionalPathCarryStart(text);
        if (carryStart >= 0) {
          readyText = text.slice(0, carryStart);
          carry = text.slice(carryStart);
        }
      }

      if (!readyText) {
        return new Uint8Array();
      }

      const maskedText = maskFunctionalRepoPathsForDisplayText(readyText, {
        coreRepoPath,
        functionalRepoPath,
      });
      const trailingCoreRepoMasked = maskTrailingKnownCoreRepoPath(maskedText, coreRepoPath);
      lastWriteEndedWithCoreRepoReplacement = trailingCoreRepoMasked.masked;

      return encoder.encode(trailingCoreRepoMasked.text);
    },

    flush() {
      const text = `${carry}${decoder.decode()}`;
      carry = "";
      lastWriteEndedWithCoreRepoReplacement = false;
      return text
        ? encoder.encode(maskFunctionalRepoPathsForDisplayText(text, {
          coreRepoPath,
          functionalRepoPath,
        }))
        : new Uint8Array();
    },
  };
}
