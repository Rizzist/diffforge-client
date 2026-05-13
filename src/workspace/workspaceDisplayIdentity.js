const FUNCTIONAL_REPO_WORKTREE_MARKER = "/.agents/worktrees";
const FUNCTIONAL_REPO_AGENTS_MARKER = "/.agents";

export function normalizeWorkspacePathSeparators(value) {
  let text = String(value || "").trim().replace(/\\/g, "/");

  if (/^\/\/\?\/UNC\//i.test(text)) {
    text = `//${text.slice(8)}`;
  } else if (/^\/\/\?\//i.test(text)) {
    text = text.slice(4);
  } else if (/^\/\/\.\/UNC\//i.test(text)) {
    text = `//${text.slice(8)}`;
  } else if (/^\/\/\.\//i.test(text)) {
    text = text.slice(4);
  }

  return text;
}

export function trimWorkspacePathSeparators(value) {
  const text = normalizeWorkspacePathSeparators(value);
  if (/^[A-Za-z]:\/?$/.test(text)) return text.replace(/\/+$/g, "/");
  if (/^\/+$/.test(text)) return "/";
  return text.replace(/\/+$/g, "");
}

export function workspacePathLeaf(value) {
  const text = trimWorkspacePathSeparators(value);
  const parts = text.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1] || "";
  return /^[A-Za-z]:$/.test(leaf) ? "" : leaf;
}

export function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function workspacePathRegExpSource(value) {
  const normalized = trimWorkspacePathSeparators(value);
  if (!normalized) return "";

  if (normalized.startsWith("//")) {
    const parts = normalized.slice(2).split("/").filter(Boolean);
    return `[\\\\/]{2}${parts.map(escapeRegExp).join("[\\\\/]")}`;
  }

  if (normalized.startsWith("/")) {
    const parts = normalized.split("/").filter(Boolean);
    return `[\\\\/]${parts.map(escapeRegExp).join("[\\\\/]")}`;
  }

  return normalized
    .split("/")
    .filter(Boolean)
    .map(escapeRegExp)
    .join("[\\\\/]");
}

export function workspacePathLooksCaseInsensitive(value) {
  const text = normalizeWorkspacePathSeparators(value);
  return /^[A-Za-z]:\//.test(text)
    || /^\/\/[^/]+\/[^/]+/.test(text)
    || /^\/mnt\/[A-Za-z]\//.test(text)
    || /^\/[A-Za-z]\//.test(text);
}

export function collapseFunctionalRepoPathToCoreRepoPath(value) {
  const normalized = trimWorkspacePathSeparators(value);
  const lower = normalized.toLowerCase();
  const markerIndex = lower.indexOf(FUNCTIONAL_REPO_WORKTREE_MARKER);

  if (markerIndex > 0) {
    return normalized.slice(0, markerIndex).replace(/\/+$/g, "");
  }

  return normalized;
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const text = String(value || "").trim();
    const key = normalizeWorkspacePathSeparators(text).toLowerCase();
    if (!text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function homePathAliases(value) {
  const text = normalizeWorkspacePathSeparators(value);
  const aliases = [];
  const patterns = [
    /^\/Users\/[^/]+\/(.+)$/i,
    /^\/home\/[^/]+\/(.+)$/i,
    /^[A-Za-z]:\/Users\/[^/]+\/(.+)$/i,
    /^\/mnt\/[A-Za-z]\/Users\/[^/]+\/(.+)$/i,
    /^\/[A-Za-z]\/Users\/[^/]+\/(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) aliases.push(`~/${match[1]}`);
  }

  return aliases;
}

function shellBridgePathAliases(value) {
  const text = normalizeWorkspacePathSeparators(value);
  const aliases = [];
  const driveMatch = text.match(/^([A-Za-z]):\/(.+)$/);
  const wslMatch = text.match(/^\/mnt\/([A-Za-z])\/(.+)$/);
  const msysMatch = text.match(/^\/([A-Za-z])\/(.+)$/);

  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    aliases.push(`/mnt/${drive}/${driveMatch[2]}`);
    aliases.push(`/${drive}/${driveMatch[2]}`);
  }

  if (wslMatch) {
    const drive = wslMatch[1].toUpperCase();
    aliases.push(`${drive}:/${wslMatch[2]}`);
    aliases.push(`/${wslMatch[1].toLowerCase()}/${wslMatch[2]}`);
  }

  if (msysMatch && msysMatch[2].includes("/")) {
    const drive = msysMatch[1].toUpperCase();
    aliases.push(`${drive}:/${msysMatch[2]}`);
    aliases.push(`/mnt/${msysMatch[1].toLowerCase()}/${msysMatch[2]}`);
  }

  return aliases;
}

export function createWorkspacePathAliases(value) {
  const core = collapseFunctionalRepoPathToCoreRepoPath(value);
  const normalized = trimWorkspacePathSeparators(value);
  return unique([
    normalized,
    core,
    ...homePathAliases(normalized),
    ...homePathAliases(core),
    ...shellBridgePathAliases(normalized),
    ...shellBridgePathAliases(core),
  ]);
}

export function createWorkspaceDisplayIdentity(rootPath, fallback = "Project") {
  const coreRoot = collapseFunctionalRepoPathToCoreRepoPath(rootPath);
  const repoName = workspacePathLeaf(coreRoot);
  const displayRoot = repoName ? `/${repoName}` : fallback;

  return {
    aliases: createWorkspacePathAliases(coreRoot),
    coreRoot,
    displayRoot,
    fallback,
    repoName,
  };
}

export function getWorkspaceDisplayRootLabel(value, fallback = "Project") {
  return createWorkspaceDisplayIdentity(value, fallback).displayRoot;
}

function pathStartsWithRoot(path, root) {
  const normalizedPath = trimWorkspacePathSeparators(path);
  const normalizedRoot = trimWorkspacePathSeparators(root);
  if (!normalizedPath || !normalizedRoot) return false;

  const insensitive = workspacePathLooksCaseInsensitive(normalizedPath)
    || workspacePathLooksCaseInsensitive(normalizedRoot);
  const left = insensitive ? normalizedPath.toLowerCase() : normalizedPath;
  const right = insensitive ? normalizedRoot.toLowerCase() : normalizedRoot;

  return left === right || left.startsWith(`${right}/`);
}

function relativePathForRoot(path, root) {
  const normalizedPath = trimWorkspacePathSeparators(path);
  const normalizedRoot = trimWorkspacePathSeparators(root);
  if (!pathStartsWithRoot(normalizedPath, normalizedRoot)) return null;
  if (normalizedPath.length === normalizedRoot.length) return "";
  return normalizedPath.slice(normalizedRoot.length + 1).replace(/^\/+/, "");
}

function functionalWorktreeRelativePath(value, identity) {
  const normalized = trimWorkspacePathSeparators(value);
  const lower = normalized.toLowerCase();
  const marker = `${FUNCTIONAL_REPO_WORKTREE_MARKER}/`;
  const markerIndex = lower.indexOf(marker);
  if (markerIndex < 0) return null;

  const beforeMarker = normalized.slice(0, markerIndex);
  const matchesRoot = [identity.coreRoot, ...(identity.aliases || [])]
    .some((alias) => pathStartsWithRoot(beforeMarker, alias) && pathStartsWithRoot(alias, beforeMarker));
  if (!matchesRoot) return null;

  const afterMarker = normalized.slice(markerIndex + marker.length);
  const parts = afterMarker.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(1).join("/");
}

export function workspaceRelativePath(value, identityOrRoot) {
  const identity = typeof identityOrRoot === "object" && identityOrRoot
    ? identityOrRoot
    : createWorkspaceDisplayIdentity(identityOrRoot || "");
  const functionalRelative = functionalWorktreeRelativePath(value, identity);
  if (functionalRelative !== null) return functionalRelative;

  const aliases = [identity.coreRoot, ...(identity.aliases || [])].filter(Boolean);
  for (const alias of aliases) {
    const relative = relativePathForRoot(value, alias);
    if (relative !== null) return relative;
  }

  return null;
}

export function isWorkspacePathLike(value) {
  const raw = String(value || "");
  const text = normalizeWorkspacePathSeparators(value);
  const compact = !/\s/.test(text);
  return /^[A-Za-z]:\//.test(text)
    || /^\/[^/]/.test(text)
    || /^\/\/[^/]+\/[^/]+/.test(text)
    || /^~\//.test(text)
    || text.includes(FUNCTIONAL_REPO_AGENTS_MARKER)
    || (compact && (text.includes("/") || raw.includes("\\")));
}

export function getWorkspacePathDisplayLabel(value, options = {}) {
  const identity = options.identity || createWorkspaceDisplayIdentity(
    options.rootPath || value,
    options.fallback || "Project",
  );
  const includeChildPath = options.includeChildPath !== false;
  const relative = workspaceRelativePath(value, identity);
  if (relative !== null) {
    return includeChildPath && relative ? `${identity.displayRoot}/${relative}` : identity.displayRoot;
  }

  if (!includeChildPath) {
    const leaf = workspacePathLeaf(value);
    return leaf ? `/${leaf}` : identity.displayRoot;
  }

  const normalized = normalizeWorkspacePathSeparators(value).replace(/^\.\/+/, "");
  return normalized || identity.displayRoot;
}
