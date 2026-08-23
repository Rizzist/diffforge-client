import { invoke } from "@tauri-apps/api/core";

/* Session model helpers for the Codex-style session rail. A session is a
   Haider conversation bound to a dedicated directory
   (~/Documents/DiffForge/<YYYY-MM-DD>/<slug>/ with work/ + outputs/), or a
   pinned existing folder. Rust owns the store (sessions.sqlite) and emits
   "sessions-changed" after every mutation. */

export function normalizeSessionRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const id = String(row.id || "").trim();
  if (!id) {
    return null;
  }
  /* Spread FIRST. This function used to build a fresh object field by field,
     which meant any field it did not name was discarded no matter what Rust
     sent — and that dropped a harness field four separate times in one day.
     Everything the daemon sends now survives, including fields this file has
     never heard of.

     Only names with a REAL shape contract belong below: the UI dereferences
     them and needs a guaranteed type. Adding a name here for any other reason
     re-creates the mirror. Absent stays absent — it means "the daemon didn't
     say", which is neither zero nor empty. */
  const latestAtMs = Object.hasOwn(row, "latest_at_ms")
    && row.latest_at_ms != null
    && Number.isFinite(Number(row.latest_at_ms))
    ? Number(row.latest_at_ms)
    : null;
  return {
    ...row,
    id,
    title: String(row.title || "").trim() || "New session",
    slug: String(row.slug || ""),
    dir: String(row.dir || ""),
    kind: row.kind === "pinned" ? "pinned" : "generated",
    provider: row.provider == null ? null : String(row.provider),
    provider_session_id: String(row.provider_session_id || ""),
    created_at_ms: Number(row.created_at_ms) || 0,
    latest_at_ms: latestAtMs,
    status: row.status == null ? "unknown" : String(row.status),
    first_user_message: String(row.first_user_message || ""),
    model: row.model == null ? null : String(row.model),
    pinned: row.pinned === true || row.pinned === 1,
    title_locked: row.title_locked === true || row.title_locked === 1,
    state_raw: String(row.state_raw || ""),
  };
}

/* "haider" is the local bootstrap integration sentinel, not a provider.
   Keep it out of provider/model labels while preserving real ids such as
   "haider-code". */
export function sessionModelProviderFallback(provider) {
  const value = String(provider || "").trim();
  return value === "haider" ? "" : value;
}

export async function listSessions() {
  const rows = await invoke("sessions_list");
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeSessionRow)
    .filter(Boolean);
}

export async function createSession({ title = "", pinnedDir = "" } = {}) {
  const row = await invoke("session_create", {
    args: {
      title: title || null,
      pinned_dir: pinnedDir || null,
    },
  });
  return normalizeSessionRow(row);
}

export async function updateSession(id, patch = {}) {
  return invoke("session_update", {
    args: {
      id,
      title: patch.title ?? null,
      status: patch.status ?? null,
      provider_session_id: patch.providerSessionId ?? null,
      first_user_message: patch.firstUserMessage ?? null,
      touch: patch.touch === true ? true : null,
    },
  });
}

export async function deleteSession(id, { deleteDir = false } = {}) {
  return invoke("session_delete", { args: { id, delete_dir: deleteDir } });
}

/* The agent's cwd: generated sessions work inside work/, pinned sessions run
   at the pinned folder itself. */
export function sessionWorkingDirectory(session) {
  const providerSessionId = String(session?.provider_session_id || "").trim();
  if (providerSessionId) {
    const workspace = Object.hasOwn(session || {}, "workspace_cwd")
      ? String(session.workspace_cwd || "").trim()
      : Object.hasOwn(session?.metadata || {}, "cwd")
        ? String(session.metadata.cwd || "").trim()
        : "";
    return workspace;
  }
  if (!session?.dir) {
    return "";
  }
  return session.kind === "generated" ? `${session.dir}/work` : session.dir;
}

const SESSION_DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function sessionDayLabel(ms, nowMs = Date.now()) {
  const dayStart = startOfLocalDay(ms);
  const todayStart = startOfLocalDay(nowMs);
  if (dayStart === todayStart) {
    return "Today";
  }
  if (dayStart === todayStart - SESSION_DAY_MS) {
    return "Yesterday";
  }
  const date = new Date(dayStart);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/* Newest-first day groups: [{ key, label, sessions: [...] }]. */
export function groupSessionsByDay(sessions, nowMs = Date.now()) {
  const groups = [];
  const byKey = new Map();
  for (const session of sessions) {
    const hasPublishedRecency = Object.hasOwn(session, "latest_at_ms");
    const stamp = hasPublishedRecency ? session.latest_at_ms : session.created_at_ms;
    const known = stamp != null && Number.isFinite(Number(stamp));
    const key = known ? String(startOfLocalDay(Number(stamp))) : "unknown";
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: known ? sessionDayLabel(Number(stamp), nowMs) : "Unknown",
        sessions: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }
  return groups;
}

export function formatSessionRelativeTime(ms, nowMs = Date.now()) {
  if (ms == null || !Number.isFinite(Number(ms))) {
    return "";
  }
  const measured = Number(ms);
  const delta = Math.max(0, nowMs - measured);
  if (delta < 60_000) {
    return "now";
  }
  if (delta < 60 * 60_000) {
    return `${Math.floor(delta / 60_000)}m`;
  }
  if (delta < SESSION_DAY_MS) {
    return `${Math.floor(delta / (60 * 60_000))}h`;
  }
  if (delta < 7 * SESSION_DAY_MS) {
    return `${Math.floor(delta / SESSION_DAY_MS)}d`;
  }
  return new Date(measured).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
