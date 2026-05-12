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

const FUNCTIONAL_REPO_WORKTREE_MARKER = "/.agents/worktrees";
const FUNCTIONAL_REPO_AGENTS_MARKER = "/.agents";
const ANSI_CSI_PATTERN = String.raw`\u001b\[[0-?]*[ -/]*[@-~]`;
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

function normalizePathSeparators(value) {
  return String(value || "").replace(/\\/g, "/");
}

function pathLeaf(value) {
  const text = normalizePathSeparators(value).replace(/\/+$/g, "");
  const parts = text.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function homePathVariant(value) {
  const text = normalizePathSeparators(value);
  const match = text.match(/^\/Users\/[^/]+\/(.+)$/);
  return match ? `~/${match[1]}` : "";
}

function replacementForCoreRepo(coreRepoPath, childPath = "") {
  const repoName = pathLeaf(coreRepoPath);
  if (!repoName) return childPath || "";
  const normalizedChild = normalizePathSeparators(childPath).replace(/^\/+/, "");
  return normalizedChild ? `/${repoName}/${normalizedChild}` : `/${repoName}`;
}

export function collapseFunctionalRepoPathToCoreRepoPath(value) {
  const text = String(value || "");
  const normalized = normalizePathSeparators(text);
  const markerIndex = normalized.indexOf(FUNCTIONAL_REPO_WORKTREE_MARKER);

  if (markerIndex <= 0) {
    return text;
  }

  return text.slice(0, markerIndex).replace(/[\\/]+$/g, "");
}

export function getCoreRepoDisplayLabel(value, fallback = "Project") {
  const repoName = pathLeaf(collapseFunctionalRepoPathToCoreRepoPath(value));
  return repoName ? `/${repoName}` : fallback;
}

function maskKnownFunctionalPath(text, functionalRepoPath, coreRepoPath) {
  const functionalPath = normalizePathSeparators(functionalRepoPath).replace(/\/+$/g, "");
  const corePath = normalizePathSeparators(coreRepoPath).replace(/\/+$/g, "");

  if (!functionalPath || !corePath || functionalPath === corePath) {
    return text;
  }

  let next = text;
  const variants = [functionalPath, homePathVariant(functionalPath)].filter(Boolean);
  for (const variant of variants) {
    const pattern = new RegExp(`${escapeRegExp(variant)}((?:[/\\\\][^\\s"'\\\`<>()\\[\\]{}|;,\\u001b]+)*)`, "g");
    next = next.replace(pattern, (_match, childPath = "") => (
      replacementForCoreRepo(corePath, childPath)
    ));
  }
  return next;
}

function maskEllipsizedFunctionalPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|\/|[A-Za-z]:\/)[^\s"'`<>()\[\]{}|;,\u001b]*?(?:…|\.\.\.)[\/\\]worktrees[\/\\][^\/\\\s"'`<>()\[\]{}|;,\u001b]+)((?:[\/\\][^\s"'`<>()\[\]{}|;,\u001b]+)*)/g,
    (_match, _functionalPath, childPath = "") => (
      replacementForCoreRepo(coreRepoPath, childPath)
    ),
  );
}

function maskCodexShortenedFunctionalPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|\/|[A-Za-z]:\/)[^\s"'`<>()\[\]{}|;,\u001b]*\/([^\/\\\s"'`<>()\[\]{}|;,\u001b]+)[\/\\]\.agents[\/\\]work(?:…|\.\.\.))(?=$|[\s"'`<>()\[\]{}|;,\u001b])/g,
    (_match, _functionalPath, repoName) => (
      replacementForCoreRepo(coreRepoPath || repoName)
    ),
  );
}

function maskAnsiDecoratedCoreAgentsPath(text, coreRepoPath) {
  const corePath = normalizePathSeparators(coreRepoPath).replace(/\/+$/g, "");
  if (!corePath) {
    return text;
  }

  let next = String(text || "");
  const variants = [corePath, homePathVariant(corePath)].filter(Boolean);
  for (const variant of variants) {
    const pattern = new RegExp(
      `${escapeRegExp(variant)}(?:${ANSI_CSI_PATTERN})+[\\\\/]\\.(?:a|ag|age|agen|agent|agents[^\\s"'\\\`<>()\\[\\]{}|;,\\u001b]*)(?:…|\\.\\.\\.)?(?=$|[\\s"'\\\`<>()\\[\\]{}|;,\\u001b])`,
      "g",
    );
    next = next.replace(pattern, () => replacementForCoreRepo(corePath));
  }
  return next;
}

function maskPartialAgentsMarkerPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|\/|[A-Za-z]:\/)[^\s"'`<>()\[\]{}|;,\u001b]*\/([^\/\\\s"'`<>()\[\]{}|;,\u001b]+)[\/\\]\.(?:a|ag|age|agen|agent|agents)(?:…|\.\.\.)?)(?=$|[\s"'`<>()\[\]{}|;,\u001b])/g,
    (_match, _functionalPath, repoName) => (
      replacementForCoreRepo(coreRepoPath || repoName)
    ),
  );
}

function maskFullWorktreePath(text) {
  return String(text || "").replace(
    /((?:~|\/|[A-Za-z]:\/)[^\s"'`<>()\[\]{}|;,\u001b]*\/([^\/\s"'`<>()\[\]{}|;,\u001b]+)\/\.agents\/worktrees\/[^\/\\\s"'`<>()\[\]{}|;,\u001b]+)((?:[\/\\][^\s"'`<>()\[\]{}|;,\u001b]+)*)/g,
    (_match, _functionalPath, repoName, childPath = "") => (
      replacementForCoreRepo(repoName, childPath)
    ),
  );
}

function maskAnyAgentsInternalPath(text, coreRepoPath) {
  return String(text || "").replace(
    /((?:~|\/|[A-Za-z]:\/)[^\s"'`<>()\[\]{}|;,\u001b]*\/([^\/\\\s"'`<>()\[\]{}|;,\u001b]+)[\/\\]\.agents[^\s"'`<>()\[\]{}|;,\u001b]*)/g,
    (_match, _functionalPath, repoName) => (
      replacementForCoreRepo(coreRepoPath || repoName)
    ),
  );
}

function maskTrailingKnownCoreRepoPath(text, coreRepoPath) {
  const corePath = normalizePathSeparators(coreRepoPath).replace(/\/+$/g, "");
  if (!corePath) {
    return { masked: false, text };
  }

  const variants = [corePath, homePathVariant(corePath)]
    .filter(Boolean)
    .map((variant) => normalizePathSeparators(variant).replace(/\/+$/g, ""))
    .sort((left, right) => right.length - left.length);

  for (const variant of variants) {
    if (!variant || !String(text || "").endsWith(variant)) {
      continue;
    }

    const start = text.length - variant.length;
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
  const normalized = normalizePathSeparators(rest);
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

    const childPath = normalizePathSeparators(worktreeMatch[1] || "");
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
    text,
    options.functionalRepoPath,
    options.coreRepoPath,
  );
  const codexShortenedMasked = maskCodexShortenedFunctionalPath(
    knownMasked,
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

  return maskAnyAgentsInternalPath(worktreeMasked, options.coreRepoPath);
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
  let markerIndex = text.lastIndexOf(FUNCTIONAL_REPO_WORKTREE_MARKER);
  if (markerIndex < 0) {
    markerIndex = text.lastIndexOf(FUNCTIONAL_REPO_AGENTS_MARKER);
  }
  if (markerIndex < 0) {
    const matches = [...text.matchAll(/(?:…|\.\.\.)[\/\\]worktrees/g)];
    markerIndex = matches.length ? matches[matches.length - 1].index : -1;
  }
  if (markerIndex < 0) {
    for (let length = FUNCTIONAL_REPO_AGENTS_MARKER.length - 1; length >= 2; length -= 1) {
      const prefix = FUNCTIONAL_REPO_AGENTS_MARKER.slice(0, length);
      if (text.endsWith(prefix)) {
        markerIndex = text.length - prefix.length;
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
  const markerIndex = text.lastIndexOf(FUNCTIONAL_REPO_WORKTREE_MARKER);
  if (markerIndex >= 0) {
    const afterMarker = text.slice(markerIndex + FUNCTIONAL_REPO_WORKTREE_MARKER.length);
    if (/^\/[^\s"'`<>()\[\]{}|;,\u001b]+/.test(afterMarker)) {
      return false;
    }
    return !/[ \t\r\n"'`<>()\[\]{}|;,\u001b]/.test(afterMarker);
  }

  const agentsMarkerIndex = text.lastIndexOf(FUNCTIONAL_REPO_AGENTS_MARKER);
  if (agentsMarkerIndex >= 0) {
    const afterMarker = normalizePathSeparators(
      text.slice(agentsMarkerIndex + FUNCTIONAL_REPO_AGENTS_MARKER.length),
    );
    if (afterMarker.includes("…") || afterMarker.includes("...")) {
      return false;
    }
    if (afterMarker === "" || "/worktrees".startsWith(afterMarker)) {
      return !/[ \t\r\n"'`<>()\[\]{}|;,\u001b]/.test(afterMarker);
    }
    return false;
  }

  for (let length = FUNCTIONAL_REPO_AGENTS_MARKER.length - 1; length >= 2; length -= 1) {
    if (text.endsWith(FUNCTIONAL_REPO_AGENTS_MARKER.slice(0, length))) {
      return true;
    }
  }

  const matches = [...text.matchAll(/(?:…|\.\.\.)[\/\\]worktrees/g)];
  const lastMatch = matches[matches.length - 1];
  if (!lastMatch) return false;

  const afterMarker = text.slice(lastMatch.index + lastMatch[0].length);
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
