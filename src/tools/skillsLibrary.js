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
  if (["html", "htm", "webpage", "web_page", "web-page"].includes(normalized)) return "html";
  if (["skill", "skills"].includes(normalized)) return "skill";
  if (["generic", "document", "documents", "doc", "docs", "markdown", "md"].includes(normalized)) return "document";
  const rawCollection = text(collection).toLowerCase();
  if (["arch", "architecture", "architectures", "graph", "graphs"].includes(rawCollection)) return "architecture";
  if (["html", "htm", "webpage", "web_page", "web-page"].includes(rawCollection)) return "html";
  if (["skill", "skills"].includes(rawCollection)) return "skill";
  return "document";
}

export function documentExtensionForKind(kind, collection = "documents") {
  const normalized = normalizedDocumentKind(kind, collection);
  if (normalized === "architecture") return "arch";
  if (normalized === "html") return "html";
  return "md";
}

export function normalizedDocumentPath(value) {
  return text(value)
    .replace(/\\/gu, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function documentHasHtmlSignal(value = {}) {
  const extension = text(value?.extension || value?.ext || value?.file_extension)
    .replace(/^\./u, "")
    .toLowerCase();
  if (extension === "html" || extension === "htm") return true;
  const mimeType = text(value?.mime_type).toLowerCase();
  if (mimeType.startsWith("text/html") || mimeType === "application/xhtml+xml") return true;
  const path = normalizedDocumentPath(
    value?.file_path || value?.path_key || value?.file_name || value?.local_path || value?.draft_path,
  ).toLowerCase();
  return path.endsWith(".html") || path.endsWith(".htm");
}

function documentKindFromParts(value = {}, collection = "documents") {
  const documentKind = normalizedDocumentKind(
    value?.document_kind || value?.source || value?.kind || value?.type,
    collection,
  );
  if (documentKind === "document" && documentHasHtmlSignal(value)) return "html";
  return documentKind;
}

export function normalizedDocumentId(value) {
  const parts = normalizedDocumentPath(value).split("/").filter(Boolean);
  if (!parts.length) return "";
  const last = parts.pop().replace(/\.(?:md|markdown|arch|html|htm)$/iu, "").trim();
  if (last) parts.push(last);
  return parts.join("/");
}

function documentRowType(row) {
  const entryKind = text(row?.entry_kind).toLowerCase();
  if (entryKind === "folder" || entryKind === "document") return entryKind;
  const kind = text(row?.kind).toLowerCase();
  const rowType = text(row?.row_type || row?.type).toLowerCase();
  return rowType === "folder" || kind === "account_document_folder" ? "folder" : "document";
}

function documentFileNameFromParts(row, extension = "md") {
  const explicit = normalizedDocumentPath(row?.file_name).split("/").filter(Boolean).pop() || "";
  if (explicit) return `${explicit.replace(/\.(?:md|markdown|arch|html|htm)$/iu, "")}.${extension}`;
  const pathName = normalizedDocumentPath(row?.file_path || row?.path_key).split("/").filter(Boolean).pop() || "";
  if (pathName) return `${pathName.replace(/\.(?:md|markdown|arch|html|htm)$/iu, "")}.${extension}`;
  const id = normalizedDocumentId(row?.doc_id || row?.document_id || row?.id || row?.title || "document");
  const leaf = id.split("/").filter(Boolean).pop() || "document";
  return `${leaf}.${extension}`;
}

export function documentMimeTypeForKind(kind, collection = "documents") {
  const extension = documentExtensionForKind(kind, collection);
  if (extension === "arch") return "text/vnd.diffforge.arch";
  if (extension === "html") return "text/html";
  return "text/markdown";
}

function documentFilePathFromParts(row, extension = "md") {
  const explicit = normalizedDocumentPath(row?.file_path || row?.path_key);
  if (explicit && /\.[A-Za-z0-9]+$/u.test(explicit.split("/").pop() || "")) {
    const parent = explicit.split("/").slice(0, -1).join("/");
    const fileName = documentFileNameFromParts({ file_name: explicit.split("/").pop() }, extension);
    return parent ? `${parent}/${fileName}` : fileName;
  }
  const folderPath = normalizedDocumentPath(row?.folder_path || row?.parent_path_key);
  if (!folderPath) {
    const idPath = normalizedDocumentId(row?.id || row?.doc_id || row?.document_id || row?.title || row?.name);
    const idParts = idPath.split("/").filter(Boolean);
    if (idParts.length > 1) {
      const leaf = idParts.pop();
      return `${idParts.join("/")}/${leaf}.${extension}`;
    }
  }
  const fileName = documentFileNameFromParts(row, extension);
  return folderPath ? `${folderPath}/${fileName}` : fileName;
}

export function accountDocumentStorageKey(document) {
  const rowType = documentRowType(document);
  const pathKey = normalizedDocumentPath(
    document?.path_key || document?.file_path || document?.document_key || document?.storage_key,
  );
  if (pathKey) return rowType === "folder" ? `folder:${pathKey}` : pathKey;
  const id = normalizedDocumentId(document?.doc_id || document?.document_id || document?.id);
  return id ? (rowType === "folder" ? `folder:${id}` : id) : "";
}

function accountDocumentVisiblePath(document) {
  return normalizedDocumentPath(
    document?.path_key || document?.file_path || document?.folder_path || document?.id || document?.doc_id || document?.document_id,
  );
}

function documentPathIsSameOrChild(path, parentPath) {
  const normalizedPath = normalizedDocumentPath(path);
  const normalizedParent = normalizedDocumentPath(parentPath);
  return Boolean(
    normalizedPath
      && normalizedParent
      && (normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)),
  );
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
  const parts = text(normalizedDocumentId(title), text(title))
    .split("/")
    .map((part) => part
      .replace(/[^A-Za-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 64))
    .filter(Boolean);
  const base = parts.join("/") || "skill";
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  return id;
}

export function skillFromUnit(unit) {
  const rowType = documentRowType(unit);
  const collection = normalizedDocumentCollection();
  const documentKind = documentKindFromParts(unit, unit?.collection || unit?.document_collection || unit?.source || collection);
  const extension = text(unit?.extension || unit?.ext, documentExtensionForKind(documentKind, collection));
  const folderPath = normalizedDocumentPath(unit?.folder_path || unit?.parent_path_key);
  const filePath = rowType === "folder"
    ? normalizedDocumentPath(unit?.file_path || unit?.path_key || unit?.folder_path || unit?.id)
    : documentFilePathFromParts(unit, extension);
  const pathKey = normalizedDocumentPath(unit?.path_key || filePath);
  const parentPathKey = rowType === "folder"
    ? normalizedDocumentPath(unit?.parent_path_key || normalizedDocumentPath(pathKey).split("/").slice(0, -1).join("/"))
    : normalizedDocumentPath(unit?.parent_path_key || folderPath || pathKey.split("/").slice(0, -1).join("/"));
  const fileName = rowType === "folder"
    ? text(unit?.file_name, pathKey.split("/").filter(Boolean).pop() || "folder")
    : documentFileNameFromParts({ ...unit, file_path: filePath }, extension);
  const id = rowType === "folder"
    ? normalizedDocumentPath(unit?.folder_id || pathKey || unit?.id)
    : normalizedDocumentId(unit?.doc_id || unit?.document_id || unit?.id || filePath || pathKey);
  if (!id) return null;
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
	    asset_id: text(unit?.asset_id),
	    blob_id: text(unit?.blob_id),
	    base_content_hash: text(unit?.base_content_hash),
	    canonical_local_path: text(unit?.canonical_local_path),
	    content: rowType === "folder" ? "" : String(unit?.content_md ?? unit?.content ?? unit?.body ?? ""),
	    content_hash: text(unit?.content_hash || unit?.hash || unit?.sha256),
	    collection,
	    document_kind: documentKind,
	    draft: unit?.draft === true || unit?.is_draft === true || text(unit?.sync_status) === "draft",
	    draft_id: text(unit?.draft_id),
	    draft_path: text(unit?.draft_path),
	    extension,
    file_name: fileName,
    file_path: filePath,
    folder_id: text(unit?.folder_id, rowType === "folder" ? id : parentPathKey),
    folder_path: rowType === "folder" ? pathKey : folderPath || parentPathKey,
    has_content: rowType === "folder" ? false : hasContent,
    has_content_payload: rowType === "folder" ? false : hasContentPayload,
	    icon: text(unit?.icon),
	    id,
	    isDraft: unit?.draft === true || unit?.is_draft === true || text(unit?.sync_status) === "draft",
	    local_path: text(unit?.local_path),
    mime_type: text(unit?.mime_type),
    local_saved_at: text(unit?.local_saved_at),
    parent_path_key: parentPathKey,
    path_key: pathKey,
    pending_push: unit?.pending_push === true,
    row_type: rowType,
    sha256: text(unit?.sha256),
    size_bytes: Number.isFinite(Number(unit?.size_bytes))
      ? Number(unit?.size_bytes)
      : 0,
	    source: text(unit?.source, documentKind),
	    sync_status: text(unit?.sync_status),
    title: text(unit?.title || unit?.name || unit?.label, rowType === "folder" ? fileName : id),
    tone: text(unit?.tone),
    updated_at: text(unit?.updated_at),
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
      if (documentRowType(skill) === "folder") {
        const folderPath = accountDocumentVisiblePath(skill);
        Array.from(byId.entries()).forEach(([candidateKey, candidate]) => {
          if (documentPathIsSameOrChild(accountDocumentVisiblePath(candidate), folderPath)) {
            byId.delete(candidateKey);
          }
        });
      }
    } else {
      const existing = byId.get(key) || {};
      const hasContentPayload = skill.has_content_payload === true;
      const incomingHash = text(skill.content_hash || skill.sha256);
      const existingHash = text(existing.content_hash || existing.sha256);
      const incomingStatus = text(skill.sync_status);
      const incomingPending = skill.pending_push === true
        || ["local_pending", "sync_failed", "upload_failed"].includes(incomingStatus);
      const incomingSynced = incomingStatus === "synced";
      const pendingPush = incomingPending || (existing.pending_push === true && !incomingSynced);
      const preserveExistingPayload = !hasContentPayload
        && existing.has_content_payload === true
        && (!incomingHash || !existingHash || incomingHash === existingHash);
      const contentStale = !hasContentPayload
        && !preserveExistingPayload
        && Boolean(String(existing.content || ""))
        && Boolean(incomingHash)
        && Boolean(existingHash)
        && incomingHash !== existingHash;
      byId.set(key, {
        ...existing,
        ...skill,
        content: hasContentPayload ? skill.content : existing.content || "",
        content_stale: hasContentPayload || preserveExistingPayload
          ? false
          : Boolean(existing.content_stale || contentStale),
        has_content: hasContentPayload || preserveExistingPayload
          ? true
          : skill.has_content,
        has_content_payload: hasContentPayload || preserveExistingPayload,
        local_saved_at: pendingPush ? text(skill.local_saved_at, existing.local_saved_at) : text(skill.local_saved_at),
        pending_push: pendingPush,
        sync_status: pendingPush && !incomingStatus
          ? text(existing.sync_status, "local_pending")
          : incomingStatus,
      });
    }
  });
  return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function skillsToSkillUnits(skills) {
  return (Array.isArray(skills) ? skills : [])
    .filter((skill) => documentRowType(skill) !== "folder")
    .map((skill) => ({
      asset_id: text(skill?.asset_id),
      blob_id: text(skill?.blob_id),
      collection: normalizedDocumentCollection(),
      content: String(skill?.content || "").trim(),
      content_md: String(skill?.content || "").trim(),
      doc_id: normalizedDocumentId(skill?.id || skill?.path_key || skill?.file_path),
      document_id: normalizedDocumentId(skill?.id || skill?.path_key || skill?.file_path),
      document_kind: documentKindFromParts(skill, skill?.collection || skill?.source),
      entry_kind: "document",
      file_name: text(skill?.file_name),
      file_path: normalizedDocumentPath(skill?.file_path || skill?.path_key),
      folder_id: normalizedDocumentPath(skill?.folder_id || skill?.folder_path),
      folder_path: normalizedDocumentPath(skill?.folder_path),
      icon: text(skill?.icon),
      id: normalizedDocumentId(skill?.id || skill?.path_key || skill?.file_path),
      local_path: text(skill?.local_path),
      mime_type: text(skill?.mime_type),
      parent_folder_id: normalizedDocumentPath(skill?.folder_id || skill?.folder_path),
      parent_path_key: normalizedDocumentPath(skill?.parent_path_key),
      path_key: normalizedDocumentPath(skill?.path_key || skill?.file_path),
      sha256: text(skill?.sha256),
      size_bytes: Number.isFinite(Number(skill?.size_bytes)) ? Number(skill.size_bytes) : 0,
      source: text(skill?.source, "custom"),
      title: text(skill?.title, "Untitled skill"),
      tone: text(skill?.tone),
      updated_at: text(skill?.updated_at),
    }))
    .filter((skill) => skill.id && skill.title);
}

export function accountDocumentUnitFromRow(row, removed = false) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const collection = normalizedDocumentCollection();
  const rowType = documentRowType(row);
  const hasContentPayload = row.content_md !== undefined
    || row.content !== undefined
    || row.body !== undefined;
  const hasContent = hasContentPayload
    || row.has_content === true
    || row.has_content_payload === true
    || row.hydrated === true;
  const documentKind = documentKindFromParts(row, row.collection || row.document_collection || row.source || collection);
  const extension = text(row.extension || row.ext, documentExtensionForKind(documentKind, collection));
  const filePath = rowType === "folder"
    ? normalizedDocumentPath(row.file_path || row.path_key || row.folder_path || row.id)
    : documentFilePathFromParts(row, extension);
  const pathKey = normalizedDocumentPath(row.path_key || filePath);
  const parentPathKey = rowType === "folder"
    ? normalizedDocumentPath(row.parent_path_key || pathKey.split("/").slice(0, -1).join("/"))
    : normalizedDocumentPath(row.parent_path_key || row.folder_path || pathKey.split("/").slice(0, -1).join("/"));
  const fileName = rowType === "folder"
    ? text(row.file_name, pathKey.split("/").filter(Boolean).pop() || "folder")
    : documentFileNameFromParts({ ...row, file_path: filePath }, extension);
  const id = rowType === "folder"
    ? normalizedDocumentPath(row.folder_id || pathKey || row.id)
    : normalizedDocumentId(row.doc_id || row.document_id || row.id || filePath || pathKey);
  if (!id) return null;
  return {
    ...row,
    collection,
    content: rowType === "folder" ? "" : hasContentPayload ? String(row.content_md ?? row.content ?? row.body ?? "") : "",
    content_md: String(row.content_md ?? row.content ?? row.body ?? ""),
    current: removed ? false : row.current,
    deleted: removed || row.deleted === true || row.tombstoned === true,
    document_id: id,
    document_kind: documentKind,
    extension,
    file_name: fileName,
    file_path: filePath,
    folder_id: text(row.folder_id, rowType === "folder" ? id : parentPathKey),
    folder_path: rowType === "folder" ? pathKey : normalizedDocumentPath(row.folder_path || parentPathKey),
    has_content: rowType === "folder" ? false : hasContent,
    has_content_payload: rowType === "folder" ? false : hasContentPayload,
    id,
    parent_path_key: parentPathKey,
    path_key: pathKey,
    row_type: rowType,
    source: text(row.source, documentKind),
    title: text(row.title || row.name || row.label, rowType === "folder" ? fileName : id),
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
        const entryKind = text(op[1]).toLowerCase();
        if (!["folder", "document"].includes(entryKind)) return;
        const rawId = text(op[2]);
        if (["d", "delete", "remove", "removed", "tombstone", "tombstoned"].includes(kind)) {
          if (entryKind === "folder") {
            const folderId = normalizedDocumentPath(rawId);
            if (!folderId) return;
            pushDocument({
              entry_kind: "folder",
              folder_id: folderId,
              folder_path: folderId,
              id: folderId,
              kind: "folder",
              path_key: folderId,
              row_type: "folder",
              type: "folder",
            }, true);
          } else {
            const id = normalizedDocumentId(rawId);
            if (!id) return;
            const filePath = documentFilePathFromParts({ id }, "md");
            const parentPathKey = normalizedDocumentPath(filePath.split("/").slice(0, -1).join("/"));
            pushDocument({
              doc_id: id,
              document_id: id,
              entry_kind: "document",
              file_name: filePath.split("/").pop() || "",
              file_path: filePath,
              folder_id: parentPathKey,
              folder_path: parentPathKey,
              id,
              kind: "document",
              parent_folder_id: parentPathKey,
              parent_path_key: parentPathKey,
              path_key: filePath,
              row_type: "document",
              type: "document",
            }, true);
          }
          return;
        }
        if (!["u", "upsert", "save", "edit", "put"].includes(kind)) return;
        if (entryKind === "folder") {
          const folderId = normalizedDocumentPath(rawId);
          if (!folderId) return;
          const folderPath = normalizedDocumentPath(op[13] || folderId);
          const pathKey = normalizedDocumentPath(op[16] || folderPath || folderId);
          pushDocument({
            collection: "documents",
            entry_kind: "folder",
            file_name: text(op[15], pathKey.split("/").filter(Boolean).pop() || folderId),
            file_path: normalizedDocumentPath(op[14]),
            folder_id: folderId,
            folder_path: folderPath || pathKey,
            id: folderId,
            kind: "folder",
            meta_hash: text(op[3]),
            parent_folder_id: normalizedDocumentPath(op[12]),
            parent_path_key: normalizedDocumentPath(op[17]),
            path_key: pathKey || folderId,
            row_type: "folder",
            title: text(op[6], folderId),
            type: "folder",
          });
          return;
        }
        const mime = text(op[10]).toLowerCase();
        const extension = mime === "text/vnd.diffforge.arch" ? "arch" : mime === "text/html" ? "html" : "md";
        const id = normalizedDocumentId(rawId);
        if (!id) return;
        const filePath = documentFilePathFromParts({ file_path: op[14], id }, extension);
        const parentPathKey = normalizedDocumentPath(op[17] || op[13] || op[12] || filePath.split("/").slice(0, -1).join("/"));
        pushDocument({
          asset_id: text(op[7]),
          blob_id: text(op[8]),
          collection: "documents",
          content_hash: text(op[4]),
          doc_id: id,
          document_id: id,
          document_kind: text(op[11], "document"),
          entry_kind: "document",
          file_name: filePath.split("/").pop() || "",
          file_path: filePath,
          folder_id: normalizedDocumentPath(op[12] || parentPathKey),
          folder_path: normalizedDocumentPath(op[13] || parentPathKey),
          id,
          meta_hash: text(op[3]),
          mime_type: text(op[10]),
          parent_folder_id: normalizedDocumentPath(op[12] || parentPathKey),
          parent_path_key: parentPathKey,
          path_key: normalizedDocumentPath(op[16] || filePath),
          row_type: "document",
          sha256: text(op[9]),
          size_bytes: Number.isFinite(Number(op[5])) ? Number(op[5]) : 0,
          title: text(op[6], id),
          type: "document",
        });
        return;
      }
      if (!op || typeof op !== "object") return;
      const kind = text(op.op || op.operation || op.action || op.kind).toLowerCase();
      const removed = ["d", "delete", "remove", "removed", "tombstone", "tombstoned"].includes(kind);
      pushDocument(op.document || op, removed);
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
    pushDocument(candidate.document);
    (candidate.documents || []).forEach((row) => pushDocument(row));
    (candidate.removed_documents || [])
      .forEach((row) => pushDocument(row, true));
    (Array.isArray(candidate.deleted) ? candidate.deleted : [])
      .forEach((row) => pushDocument(row, true));
    pushOps(candidate.ops);
    pushOps(candidate.removed);
  });
  const byKey = new Map();
  const unitHasContentPayload = (unit) => unit?.has_content_payload === true;
  const mergeDocumentUnit = (existing, incoming) => {
    if (!existing) return incoming;
    if (incoming?.deleted === true || incoming?.current === false || incoming?.tombstoned === true) {
      return incoming;
    }
    if (existing?.deleted === true || existing?.current === false || existing?.tombstoned === true) {
      return existing;
    }
    const existingHasPayload = unitHasContentPayload(existing);
    const incomingHasPayload = unitHasContentPayload(incoming);
    if (!existingHasPayload || incomingHasPayload) {
      return { ...existing, ...incoming };
    }
    return {
      ...existing,
      ...incoming,
      body: existing.body,
      content: existing.content,
      content_md: existing.content_md,
      has_content: true,
      has_content_payload: true,
    };
  };
  units.forEach((unit) => {
    const key = accountDocumentStorageKey(unit);
    if (key) byKey.set(key, mergeDocumentUnit(byKey.get(key), unit));
  });
  return Array.from(byKey.values());
}

export function accountDocumentRequestFromSkill(skill, { allow_conflict = false, local_only = false } = {}) {
  const collection = normalizedDocumentCollection();
  const rowKind = text(skill?.entry_kind || skill?.row_type || skill?.type || skill?.kind).toLowerCase();
  if (rowKind === "folder" || rowKind === "account_document_folder") {
    const folderPath = normalizedDocumentPath(
      skill?.path_key || skill?.folder_path || skill?.folder_id || skill?.id,
    );
    const parts = folderPath.split("/").filter(Boolean);
    const fileName = text(skill?.file_name || skill?.title || skill?.name, parts[parts.length - 1] || "folder");
    const parentPathKey = normalizedDocumentPath(
      skill?.parent_path_key || skill?.parent_folder_id || parts.slice(0, -1).join("/"),
    );
    return {
      document: {
        collection,
        doc_id: folderPath,
        document_id: folderPath,
        entry_kind: "folder",
        file_name: fileName,
        file_path: folderPath,
        folder_id: folderPath,
        folder_path: folderPath,
        id: folderPath,
        kind: "folder",
        name: text(skill?.title, fileName),
        parent_folder_id: parentPathKey,
        parent_path_key: parentPathKey,
        path_key: folderPath,
        row_type: "folder",
        title: text(skill?.title, fileName),
        type: "folder",
      },
      local_only: Boolean(local_only),
    };
  }
  const documentKind = documentKindFromParts(skill, collection);
  const extension = text(skill?.extension, documentExtensionForKind(documentKind, collection));
  const filePath = documentFilePathFromParts(skill, extension);
  const pathKey = normalizedDocumentPath(skill?.path_key || filePath);
  const parentPathKey = normalizedDocumentPath(skill?.parent_path_key || pathKey.split("/").slice(0, -1).join("/"));
  const fileName = documentFileNameFromParts({ ...skill, file_path: pathKey }, extension);
  const id = normalizedDocumentId(skill?.id || skill?.doc_id || skill?.document_id || pathKey) || skillSlug(skill?.title || "document");
  const mimeType = documentKind === "html" || documentKind === "architecture"
    ? documentMimeTypeForKind(documentKind, collection)
    : text(skill?.mime_type, documentMimeTypeForKind(documentKind, collection));
  const document = {
    allow_empty_overwrite: skill?.allow_empty_overwrite === true,
    asset_id: text(skill?.asset_id),
    base_content_hash: text(skill?.base_content_hash),
    canonical_local_path: text(skill?.canonical_local_path),
    collection,
    content: String(skill?.content || ""),
    content_md: String(skill?.content || ""),
    doc_id: id,
    document_id: id,
    document_kind: documentKind,
    draft_id: text(skill?.draft_id),
    draft_path: text(skill?.draft_path),
    entry_kind: "document",
    extension,
    file_name: fileName,
    file_path: pathKey,
    folder_id: parentPathKey,
    folder_path: parentPathKey,
    has_content_payload: true,
    id,
    local_path: text(skill?.local_path),
    mime_type: mimeType,
    name: text(skill?.title, id),
    parent_folder_id: parentPathKey,
    parent_path_key: parentPathKey,
    path_key: pathKey,
    row_type: "document",
    source: documentKind,
    title: text(skill?.title, id),
    type: "document",
  };
  Object.keys(document).forEach((key) => {
    if (document[key] === "" && key !== "content" && key !== "content_md") delete document[key];
  });
  return {
    ...(allow_conflict ? { allow_conflict: true } : {}),
    document,
    local_only: Boolean(local_only),
  };
}

export function accountDocumentHydrateRequestFromSkill(skill) {
  const collection = normalizedDocumentCollection();
  const documentKind = documentKindFromParts(skill, collection);
  const extension = text(skill?.extension, documentExtensionForKind(documentKind, collection));
  const filePath = documentFilePathFromParts(skill, extension);
  const pathKey = normalizedDocumentPath(skill?.path_key || filePath);
  const parentPathKey = normalizedDocumentPath(skill?.parent_path_key || pathKey.split("/").slice(0, -1).join("/"));
  const fileName = documentFileNameFromParts({ ...skill, file_path: pathKey }, extension);
  const id = normalizedDocumentId(skill?.id || skill?.doc_id || skill?.document_id || pathKey) || skillSlug(skill?.title || "document");
  const contentHash = text(skill?.content_hash || skill?.sha256);
  const document = {
    asset_id: text(skill?.asset_id),
    blob_id: text(skill?.blob_id),
    collection,
    content_hash: contentHash,
    doc_id: id,
    document_id: id,
    document_kind: documentKind,
    entry_kind: "document",
    extension,
    file_name: fileName,
    file_path: pathKey,
    folder_id: parentPathKey,
    folder_path: parentPathKey,
    id,
    local_path: text(skill?.local_path),
    mime_type: documentKind === "html" || documentKind === "architecture"
      ? documentMimeTypeForKind(documentKind, collection)
      : text(skill?.mime_type),
    name: text(skill?.title || skill?.name, id),
    parent_folder_id: parentPathKey,
    parent_path_key: parentPathKey,
    path_key: pathKey,
    row_type: "document",
    sha256: contentHash,
    source: documentKind,
    title: text(skill?.title || skill?.name, id),
    type: "document",
  };
  const sizeBytes = Number(skill?.size_bytes);
  if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
    document.size_bytes = sizeBytes;
  }
  return { document };
}

export function skillsToToolEntries(skills) {
  return (Array.isArray(skills) ? skills : [])
    .filter((skill) => documentRowType(skill) !== "folder")
    .map((skill) => ({
      body: String(skill?.content || ""),
      title: text(skill?.title || skill?.id),
    }))
    .filter((entry) => entry.title || entry.body.trim());
}
