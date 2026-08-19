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
  return {
    id,
    title: String(row.title || "").trim() || "New session",
    slug: String(row.slug || ""),
    dir: String(row.dir || ""),
    kind: row.kind === "pinned" ? "pinned" : "generated",
    provider: String(row.provider || "haider"),
    provider_session_id: String(row.provider_session_id || ""),
    created_at_ms: Number(row.created_at_ms) || 0,
    latest_at_ms: Number(row.latest_at_ms) || Number(row.created_at_ms) || 0,
    status: String(row.status || "idle"),
    first_user_message: String(row.first_user_message || ""),
    model: String(row.model || ""),
    pinned: row.pinned === true || row.pinned === 1,
    title_locked: row.title_locked === true || row.title_locked === 1,
    state_raw: String(row.state_raw || ""),
  };
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
    const stamp = session.latest_at_ms || session.created_at_ms || 0;
    const key = String(startOfLocalDay(stamp || nowMs));
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: sessionDayLabel(stamp || nowMs, nowMs), sessions: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }
  return groups;
}

export function formatSessionRelativeTime(ms, nowMs = Date.now()) {
  if (!ms) {
    return "";
  }
  const delta = Math.max(0, nowMs - ms);
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
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
