export const SKILL_TONES = {
  amber: "#cca700",
  blue: "#3794ff",
  cyan: "#29b8db",
  green: "#3fb950",
  orange: "#ff8c00",
  purple: "#b180d7",
  red: "#f14c4c",
  slate: "#8ea0b8",
};

const TONE_KEYS = Object.keys(SKILL_TONES);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function skillToneColor(tone, seed = "") {
  if (SKILL_TONES[tone]) return SKILL_TONES[tone];
  const source = text(seed, "skill");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return SKILL_TONES[TONE_KEYS[hash % TONE_KEYS.length]];
}

export function skillSlug(title, existingIds = new Set()) {
  const base = text(title)
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64) || "skill";
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  return id;
}

export function skillFromUnit(unit) {
  const id = text(unit?.skill_id || unit?.skillId || unit?.id);
  if (!id) return null;
  return {
    assetId: text(unit?.asset_id || unit?.assetId),
    blobId: text(unit?.blob_id || unit?.blobId),
    content: String(unit?.content_md ?? unit?.contentMd ?? unit?.content ?? unit?.body ?? ""),
    contentHash: text(unit?.content_hash || unit?.contentHash || unit?.hash || unit?.sha256),
    icon: text(unit?.icon),
    id,
    mimeType: text(unit?.mime_type || unit?.mimeType),
    localSavedAt: text(unit?.local_saved_at || unit?.localSavedAt),
    pendingPush: unit?.pending_push === true || unit?.pendingPush === true,
    sha256: text(unit?.sha256),
    sizeBytes: Number.isFinite(Number(unit?.size_bytes ?? unit?.sizeBytes))
      ? Number(unit?.size_bytes ?? unit?.sizeBytes)
      : 0,
    source: text(unit?.source, "custom"),
    syncStatus: text(unit?.sync_status || unit?.syncStatus),
    title: text(unit?.title || unit?.name || unit?.label, id),
    tone: text(unit?.tone),
    updatedAt: text(unit?.updated_at || unit?.updatedAt),
  };
}

export function skillsFromUnits(units) {
  const byId = new Map();
  (Array.isArray(units) ? units : []).forEach((unit) => {
    const skill = skillFromUnit(unit);
    if (!skill) return;
    const removed = unit?.deleted === true || unit?.current === false || unit?.tombstoned === true;
    if (removed) {
      byId.delete(skill.id);
    } else {
      byId.set(skill.id, skill);
    }
  });
  return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function mergeSkillUnits(currentSkills, units) {
  const byId = new Map((Array.isArray(currentSkills) ? currentSkills : []).map((skill) => [skill.id, skill]));
  (Array.isArray(units) ? units : []).forEach((unit) => {
    const skill = skillFromUnit(unit);
    if (!skill) return;
    const removed = unit?.deleted === true || unit?.current === false || unit?.tombstoned === true;
    if (removed) {
      byId.delete(skill.id);
    } else {
      const existing = byId.get(skill.id) || {};
      byId.set(skill.id, {
        ...existing,
        ...skill,
        content: skill.content || existing.content || "",
      });
    }
  });
  return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function skillsToSkillUnits(skills) {
  return (Array.isArray(skills) ? skills : [])
    .map((skill) => ({
      assetId: text(skill?.assetId),
      blobId: text(skill?.blobId),
      content: String(skill?.content || "").trim(),
      contentMd: String(skill?.content || "").trim(),
      icon: text(skill?.icon),
      id: text(skill?.id),
      mimeType: text(skill?.mimeType),
      sha256: text(skill?.sha256),
      sizeBytes: Number.isFinite(Number(skill?.sizeBytes)) ? Number(skill.sizeBytes) : 0,
      skillId: text(skill?.id),
      source: text(skill?.source, "custom"),
      title: text(skill?.title, "Untitled skill"),
      tone: text(skill?.tone),
      updatedAt: text(skill?.updatedAt),
    }))
    .filter((skill) => skill.id && skill.title);
}

export function skillsToToolEntries(skills) {
  return (Array.isArray(skills) ? skills : [])
    .map((skill) => ({
      body: String(skill?.content || ""),
      title: text(skill?.title || skill?.id),
    }))
    .filter((entry) => entry.title || entry.body.trim());
}
