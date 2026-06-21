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

export const ACCOUNT_DOCUMENTS_CONTRACT = "diffforge.account_documents.v1";

export function normalizedDocumentCollection() {
  return "documents";
}

export function normalizedDocumentKind(value, collection = "documents") {
  const normalized = text(value).toLowerCase();
  if (["arch", "architecture", "architectures", "graph", "graphs"].includes(normalized)) return "architecture";
  if (["skill", "skills"].includes(normalized)) return "skill";
  if (["instruction", "instructions"].includes(normalized)) return "instruction";
  if (["generic", "document", "documents", "doc", "docs"].includes(normalized)) return "document";
  const rawCollection = text(collection).toLowerCase();
  if (["arch", "architecture", "architectures", "graph", "graphs"].includes(rawCollection)) return "architecture";
  if (["skill", "skills"].includes(rawCollection)) return "skill";
  if (["instruction", "instructions"].includes(rawCollection)) return "instruction";
  return "document";
}

export function documentExtensionForKind(kind, collection = "documents") {
  return normalizedDocumentKind(kind, collection) === "architecture" ? "arch" : "md";
}

export function normalizedDocumentId(value) {
  const cleaned = text(value)
    .split(/[\\/]/u)
    .filter(Boolean)
    .pop() || "";
  return cleaned.replace(/\.(?:md|markdown|arch)$/iu, "").trim();
}

export function accountDocumentStorageKey(document) {
  const id = normalizedDocumentId(document?.doc_id || document?.document_id || document?.id);
  return id || "";
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
  const base = text(normalizedDocumentId(title), text(title))
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
  const id = normalizedDocumentId(unit?.doc_id || unit?.document_id || unit?.id);
  if (!id) return null;
  const collection = normalizedDocumentCollection();
  const documentKind = normalizedDocumentKind(
    unit?.document_kind || unit?.kind || unit?.type,
    unit?.collection || unit?.document_collection || unit?.source || collection,
  );
  const extension = text(unit?.extension || unit?.ext, documentExtensionForKind(documentKind, collection));
  const hasContentFlag = unit?.has_content !== undefined || unit?.has_content_payload !== undefined;
  const explicitContentPayload = unit?.has_content_payload === true;
  const explicitNoContentPayload = unit?.has_content_payload === false;
  const hasContentPayload = explicitContentPayload
    || (!explicitNoContentPayload && (
      unit?.content_md !== undefined
      || unit?.content !== undefined
      || unit?.body !== undefined
    ));
  const hasContent = unit?.hydrated === true
    || unit?.has_content === true
    || unit?.has_content_payload === true
    || (!hasContentFlag && hasContentPayload);
  return {
    assetId: text(unit?.asset_id),
    blobId: text(unit?.blob_id),
    content: String(unit?.content_md ?? unit?.content ?? unit?.body ?? ""),
    contentHash: text(unit?.content_hash || unit?.hash || unit?.sha256),
    collection,
    documentKind,
    extension,
    hasContent,
    hasContentPayload,
    icon: text(unit?.icon),
    id,
    localPath: text(unit?.local_path),
    mimeType: text(unit?.mime_type),
    localSavedAt: text(unit?.local_saved_at),
    pendingPush: unit?.pending_push === true,
    sha256: text(unit?.sha256),
    sizeBytes: Number.isFinite(Number(unit?.size_bytes))
      ? Number(unit?.size_bytes)
      : 0,
    source: text(unit?.source, documentKind),
    syncStatus: text(unit?.sync_status),
    title: text(unit?.title || unit?.name || unit?.label, id),
    tone: text(unit?.tone),
    updatedAt: text(unit?.updated_at),
  };
}

export function skillsFromUnits(units) {
  const byId = new Map();
  (Array.isArray(units) ? units : []).forEach((unit) => {
    const skill = skillFromUnit(unit);
    if (!skill) return;
    const key = accountDocumentStorageKey(skill) || skill.id;
    const removed = unit?.deleted === true || unit?.current === false || unit?.tombstoned === true;
    if (removed) {
      byId.delete(key);
    } else {
      byId.set(key, skill);
    }
  });
  return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function mergeSkillUnits(currentSkills, units) {
  const byId = new Map((Array.isArray(currentSkills) ? currentSkills : [])
    .map((skill) => [accountDocumentStorageKey(skill) || skill.id, skill]));
  (Array.isArray(units) ? units : []).forEach((unit) => {
    const skill = skillFromUnit(unit);
    if (!skill) return;
    const key = accountDocumentStorageKey(skill) || skill.id;
    const removed = unit?.deleted === true || unit?.current === false || unit?.tombstoned === true;
    if (removed) {
      byId.delete(key);
    } else {
      const existing = byId.get(key) || {};
      const hasContentPayload = skill.hasContentPayload === true;
      const incomingHash = text(skill.contentHash || skill.sha256);
      const existingHash = text(existing.contentHash || existing.sha256);
      const contentStale = !hasContentPayload
        && Boolean(String(existing.content || ""))
        && Boolean(incomingHash)
        && Boolean(existingHash)
        && incomingHash !== existingHash;
      byId.set(key, {
        ...existing,
        ...skill,
        content: hasContentPayload ? skill.content : existing.content || "",
        contentStale: hasContentPayload ? false : Boolean(existing.contentStale || contentStale),
      });
    }
  });
  return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function skillsToSkillUnits(skills) {
  return (Array.isArray(skills) ? skills : [])
    .map((skill) => ({
      asset_id: text(skill?.assetId),
      blob_id: text(skill?.blobId),
      collection: normalizedDocumentCollection(),
      content: String(skill?.content || "").trim(),
      content_md: String(skill?.content || "").trim(),
      doc_id: normalizedDocumentId(skill?.id),
      document_id: normalizedDocumentId(skill?.id),
      document_kind: normalizedDocumentKind(skill?.documentKind || skill?.source, skill?.collection || skill?.source),
      icon: text(skill?.icon),
      id: normalizedDocumentId(skill?.id),
      local_path: text(skill?.localPath),
      mime_type: text(skill?.mimeType),
      sha256: text(skill?.sha256),
      size_bytes: Number.isFinite(Number(skill?.sizeBytes)) ? Number(skill.sizeBytes) : 0,
      source: text(skill?.source, "custom"),
      title: text(skill?.title, "Untitled skill"),
      tone: text(skill?.tone),
      updated_at: text(skill?.updatedAt),
    }))
    .filter((skill) => skill.id && skill.title);
}

export function accountDocumentUnitFromRow(row, removed = false) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const id = normalizedDocumentId(row.doc_id || row.document_id || row.id);
  if (!id) return null;
  const collection = normalizedDocumentCollection();
  const hasContentPayload = row.content_md !== undefined
    || row.content !== undefined
    || row.body !== undefined;
  const hasContent = hasContentPayload
    || row.has_content === true
    || row.has_content_payload === true
    || row.hydrated === true;
  const documentKind = normalizedDocumentKind(
    row.document_kind || row.kind || row.type,
    row.collection || row.document_collection || row.source || collection,
  );
  const extension = text(row.extension || row.ext, documentExtensionForKind(documentKind, collection));
  return {
    ...row,
    collection,
    content: hasContentPayload ? String(row.content_md ?? row.content ?? row.body ?? "") : "",
    contentMd: String(row.content_md ?? row.content ?? row.body ?? ""),
    current: removed ? false : row.current,
    deleted: removed || row.deleted === true || row.tombstoned === true,
    documentId: id,
    documentKind,
    extension,
    has_content_payload: hasContentPayload,
    hasContent,
    hasContentPayload,
    id,
    source: text(row.source, documentKind),
    title: text(row.title || row.name || row.label, id),
  };
}

function documentPayloadCandidates(payload) {
  return [
    payload,
    payload?.payload,
    payload?.data,
    payload?.event,
    payload?.projection,
    payload?.cloud_response,
    payload?.source_response,
    payload?.payload?.payload,
    payload?.payload?.data,
    payload?.payload?.projection,
    payload?.data?.payload,
    payload?.data?.projection,
  ];
}

export function accountDocumentUnitsFromPayload(payload) {
  const units = [];
  const pushDocument = (row, removed = false) => {
    const unit = accountDocumentUnitFromRow(row, removed);
    if (unit) units.push(unit);
  };
  const pushOps = (ops) => {
    (Array.isArray(ops) ? ops : []).forEach((op) => {
      if (Array.isArray(op)) {
        const kind = text(op[0]).toLowerCase();
        const id = normalizedDocumentId(op[1]);
        if (!id) return;
        if (["d", "delete", "remove", "removed", "tombstone", "tombstoned"].includes(kind)) {
          pushDocument({ doc_id: id, document_id: id, id }, true);
          return;
        }
        if (!["u", "upsert", "save", "edit", "put"].includes(kind)) return;
        pushDocument({
          asset_id: text(op[6]),
          blob_id: text(op[7]),
          collection: "documents",
          content_hash: text(op[3]),
          doc_id: id,
          document_id: id,
          document_kind: text(op[10], "document"),
          file_path: text(op[11]),
          id,
          mime_type: text(op[9]),
          sha256: text(op[8]),
          size_bytes: Number.isFinite(Number(op[4])) ? Number(op[4]) : 0,
          title: text(op[5], id),
        });
        return;
      }
      if (!op || typeof op !== "object") return;
      const kind = text(op.op || op.operation || op.action || op.kind).toLowerCase();
      const removed = ["d", "delete", "remove", "removed", "tombstone", "tombstoned"].includes(kind);
      pushDocument(op.document || op.doc || op.item || op, removed);
    });
  };
  documentPayloadCandidates(payload).forEach((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const candidateKind = text(candidate.op || candidate.operation || candidate.action || candidate.kind).toLowerCase();
    const candidateRemoved = [
      "account_document_deleted",
      "d",
      "delete",
      "remove",
      "removed",
      "tombstone",
      "tombstoned",
    ].includes(candidateKind);
    if (candidate.doc_id || candidate.document_id || candidate.id) {
      pushDocument(candidate, candidateRemoved);
    }
    pushDocument(candidate.document || candidate.doc || candidate.item);
    (candidate.documents || candidate.docs || candidate.items || []).forEach((row) => pushDocument(row));
    (candidate.removed_documents || candidate.removed_docs || [])
      .forEach((row) => pushDocument(row, true));
    pushOps(candidate.ops);
    pushOps(candidate.removed);
  });
  const byKey = new Map();
  units.forEach((unit) => {
    const key = accountDocumentStorageKey(unit);
    if (key) byKey.set(key, unit);
  });
  return Array.from(byKey.values());
}

export function accountDocumentRequestFromSkill(skill, { local_only = false } = {}) {
  const collection = normalizedDocumentCollection();
  const documentKind = normalizedDocumentKind(skill?.documentKind || skill?.source, collection);
  const extension = text(skill?.extension, documentExtensionForKind(documentKind, collection));
  const id = normalizedDocumentId(skill?.id || skill?.doc_id || skill?.document_id) || skillSlug(skill?.title || "document");
  const mimeType = text(
    skill?.mimeType,
    extension === "arch" ? "text/vnd.diffforge.arch" : "text/markdown",
  );
  return {
    document: {
      asset_id: text(skill?.assetId),
      collection,
      content: String(skill?.content || ""),
      content_md: String(skill?.content || ""),
      doc_id: id,
      document_id: id,
      document_kind: documentKind,
      extension,
      id,
      local_path: text(skill?.localPath),
      mime_type: mimeType,
      name: text(skill?.title, id),
      source: documentKind,
      title: text(skill?.title, id),
    },
    local_only: Boolean(local_only),
  };
}

export function skillsToToolEntries(skills) {
  return (Array.isArray(skills) ? skills : [])
    .map((skill) => ({
      body: String(skill?.content || ""),
      title: text(skill?.title || skill?.id),
    }))
    .filter((entry) => entry.title || entry.body.trim());
}
