import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import {
  ButtonRefreshIcon,
  FileDisclosure,
  FileExplorerActions,
  FileExplorerHeader,
  FileExplorerPane,
  FileIconButton,
  FileKindIcon,
  FileRootPath,
  FilesWorkspaceSurface,
  FileTree,
  FileTreeButton,
  FileTreeEmpty,
  FileTreeItem,
  FileTreeName,
  PanelKicker,
  ResizeHandle,
  ResizePanel,
  ResizePanelGroup,
} from "../app/appStyles.js";
import McpsWorkspaceView from "../mcps/McpsWorkspaceView.jsx";
import { CLI_CATALOG, cliInstallManager } from "./cliCatalog.js";
import { SKILLS_CATALOG, skillCliBinary, skillCliIcon } from "./skillsCatalog.js";
import {
  ACCOUNT_DOCUMENTS_CONTRACT,
  accountDocumentHydrateRequestFromSkill,
  accountDocumentRequestFromSkill,
  accountDocumentStorageKey,
  accountDocumentUnitsFromPayload,
  documentExtensionForKind,
  mergeSkillUnits,
  normalizedDocumentCollection,
  normalizedDocumentKind,
  normalizedDocumentPath,
  skillsFromUnits,
  skillSlug,
  skillToneColor,
} from "./skillsLibrary.js";
import {
  clearWorkspaceToolsDocumentDraft,
  getWorkspaceToolsDocumentDraft,
  getWorkspaceToolsAccountSkills,
  hasWorkspaceToolsLoaded,
  noteAccountSkillUnits,
  setWorkspaceToolsDocumentDraft,
  subscribeWorkspaceTools,
} from "./workspaceToolsStore.js";

const SECTIONS = [
  { id: "docs", label: "Docs" },
  { id: "mcps", label: "MCPs" },
  { id: "clis", label: "CLIs" },
];

export const GLOBAL_MCP_DEFAULTS_SCOPE = "global-defaults";
const GLOBAL_MCP_DEFAULTS_WORKSPACE_ID = "account-global-mcp-defaults";
const SKILL_EDITOR_THEME_STORAGE_KEY = "diffforge.tools.skillEditorTheme";
const ACCOUNT_DOCS_BACKGROUND_REFRESH_TIMEOUT_MS = 4_500;
const ACCOUNT_DOCS_FOREGROUND_REFRESH_TIMEOUT_MS = 12_000;
const SKILL_DOCUMENT_A4_WIDTH_PX = 794;
const SKILL_DOCUMENT_A4_HEIGHT_PX = 1123;
const SKILL_DOCUMENT_CANVAS_INLINE_GUTTER_PX = 48;
const SKILL_DOCUMENT_MIN_SCALE = 0.38;
const SKILL_DOCUMENT_MAX_SCALE = 1.35;
const DOCUMENT_TYPE_OPTIONS = [
  { id: "skill", label: "Skill", collection: "documents", extension: "md" },
  { id: "architecture", label: "Architecture", collection: "documents", extension: "arch" },
  { id: "instruction", label: "Instruction", collection: "documents", extension: "md" },
  { id: "document", label: "Document", collection: "documents", extension: "md" },
];

function normalizedSectionId(value, fallback = "docs") {
  const normalized = text(value);
  if (["architectures", "architecture", "skills", "skill"].includes(normalized)) return "docs";
  return SECTIONS.some((entry) => entry.id === normalized) ? normalized : fallback;
}

function normalizedSkillEditorTheme(value, fallback = "dark") {
  return value === "light" || value === "dark" ? value : fallback;
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function compactDocumentText(value, maxLength = 1200) {
  const raw = String(value ?? "");
  if (raw.length <= maxLength) {
    return { text: raw, truncated: false };
  }
  return { text: raw.slice(0, maxLength), truncated: true };
}

function documentDraftFingerprint(value) {
  const source = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}:${source.length}`;
}

function documentOffsetPosition(content, offset) {
  const safeContent = String(content ?? "");
  const safeOffset = Math.max(0, Math.min(safeContent.length, Number(offset) || 0));
  const before = safeContent.slice(0, safeOffset);
  const lines = before.split("\n");
  return {
    column: lines[lines.length - 1].length + 1,
    line: lines.length,
    offset: safeOffset,
  };
}

function documentSelectionContext(content, selection) {
  const source = String(content ?? "");
  const start = Math.max(0, Math.min(source.length, Number(selection?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(selection?.end) || start));
  const selected = source.slice(start, end);
  const selectedText = compactDocumentText(selected, 8000);
  const prefix = compactDocumentText(source.slice(Math.max(0, start - 1400), start), 1400);
  const suffix = compactDocumentText(source.slice(end, Math.min(source.length, end + 1400)), 1400);
  return {
    active: end > start,
    direction: text(selection?.direction),
    end,
    endPosition: documentOffsetPosition(source, end),
    prefixText: prefix.text,
    prefixTruncated: start > 1400 || prefix.truncated,
    selectedText: selectedText.text,
    selectedTextLength: selected.length,
    selectedTextTruncated: selectedText.truncated,
    start,
    startPosition: documentOffsetPosition(source, start),
    suffixText: suffix.text,
    suffixTruncated: source.length - end > 1400 || suffix.truncated,
    updatedAtMs: Number(selection?.updatedAtMs) || 0,
  };
}

function documentSelectionSegments(content, selection) {
  const source = String(content ?? "");
  const start = Math.max(0, Math.min(source.length, Number(selection?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(selection?.end) || start));
  if (end <= start) return null;
  return {
    active: true,
    after: source.slice(end),
    before: source.slice(0, start),
    selected: source.slice(start, end),
    start,
    end,
  };
}

function documentTypeOption(value, collection = "documents") {
  const kind = normalizedDocumentKind(value, collection);
  return DOCUMENT_TYPE_OPTIONS.find((entry) => entry.id === kind) || DOCUMENT_TYPE_OPTIONS[0];
}

function documentTypeLabel(value, collection = "documents") {
  return documentTypeOption(value, collection).label;
}

function clampSkillDocumentScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(SKILL_DOCUMENT_MAX_SCALE, Math.max(SKILL_DOCUMENT_MIN_SCALE, numeric));
}

function roundedDocumentPx(value, min = 0) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? Math.max(min, numeric) : min;
  return `${Math.round(safeValue)}px`;
}

function skillDocumentPageStyle(scale) {
  const safeScale = clampSkillDocumentScale(scale);
  return {
    "--skill-document-page-scale": String(safeScale),
    "--skill-document-page-width": roundedDocumentPx(SKILL_DOCUMENT_A4_WIDTH_PX * safeScale),
    "--skill-document-page-height": roundedDocumentPx(SKILL_DOCUMENT_A4_HEIGHT_PX * safeScale),
    "--skill-document-page-padding-top": roundedDocumentPx(52 * safeScale, 20),
    "--skill-document-page-padding-inline": roundedDocumentPx(58 * safeScale, 22),
    "--skill-document-page-padding-bottom": roundedDocumentPx(76 * safeScale, 26),
    "--skill-document-title-font-size": roundedDocumentPx(30 * safeScale, 16),
    "--skill-document-title-padding-bottom": roundedDocumentPx(7 * safeScale, 4),
    "--skill-document-body-margin-top": roundedDocumentPx(24 * safeScale, 10),
    "--skill-document-body-margin-left": roundedDocumentPx(-10 * safeScale, -20),
    "--skill-document-body-bleed": roundedDocumentPx(20 * safeScale),
    "--skill-document-body-padding-inline": roundedDocumentPx(10 * safeScale, 4),
    "--skill-document-body-padding-top": roundedDocumentPx(8 * safeScale, 4),
    "--skill-document-body-padding-bottom": roundedDocumentPx(24 * safeScale, 10),
    "--skill-document-body-font-size": roundedDocumentPx(15 * safeScale, 10),
    "--skill-document-body-min-height": roundedDocumentPx(900 * safeScale, 320),
  };
}

function documentFileName(document) {
  const collection = normalizedDocumentCollection();
  const kind = normalizedDocumentKind(document?.documentKind || document?.source, collection);
  const extension = text(document?.extension, documentExtensionForKind(kind, collection));
  const explicit = text(document?.fileName || document?.file_name);
  if (explicit) return explicit;
  const filePath = normalizedDocumentPath(document?.filePath || document?.file_path || document?.pathKey || document?.path_key);
  const pathName = filePath.split("/").filter(Boolean).pop();
  if (pathName) return pathName;
  const id = text(document?.id || document?.documentId || document?.document_id, skillSlug(document?.title || "document"));
  const suffix = `.${extension}`;
  const leaf = id.split("/").filter(Boolean).pop() || id;
  return leaf.toLowerCase().endsWith(suffix.toLowerCase()) ? leaf : `${leaf}${suffix}`;
}

function documentPreviewLine(document) {
  const contentLine = String(document?.content || "").split("\n").map((line) => line.trim()).find(Boolean);
  return text(contentLine, text(document?.localPath, `${documentTypeLabel(document?.documentKind, document?.collection)} doc`));
}

function documentPathMetadata(document) {
  const extension = text(document?.extension, documentExtensionForKind(document?.documentKind || document?.source, document?.collection));
  const explicitPath = normalizedDocumentPath(document?.pathKey || document?.path_key || document?.filePath || document?.file_path);
  if (explicitPath) {
    const parentPathKey = normalizedDocumentPath(document?.parentPathKey || document?.parent_path_key || explicitPath.split("/").slice(0, -1).join("/"));
    return {
      fileName: explicitPath.split("/").filter(Boolean).pop() || documentFileName(document),
      filePath: explicitPath,
      folderId: parentPathKey,
      folderPath: parentPathKey,
      parentPathKey,
      pathKey: explicitPath,
    };
  }
  const idPath = normalizedDocumentPath(document?.id || document?.documentId || document?.document_id || skillSlug(document?.title || "document"));
  const idParts = idPath.split("/").filter(Boolean);
  const leaf = idParts.pop() || "document";
  const folderPath = normalizedDocumentPath(document?.folderPath || document?.folder_path || document?.parentPathKey || document?.parent_path_key || idParts.join("/"));
  const fileName = `${leaf.replace(/\.(?:md|markdown|arch)$/iu, "")}.${extension}`;
  const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
  return {
    fileName,
    filePath,
    folderId: folderPath,
    folderPath,
    parentPathKey: folderPath,
    pathKey: filePath,
  };
}

function documentIsFolderRow(document) {
  return text(document?.entryKind || document?.entry_kind).toLowerCase() === "folder"
    || text(document?.rowType || document?.row_type || document?.type).toLowerCase() === "folder"
    || text(document?.kind).toLowerCase() === "account_document_folder";
}

function documentEditorDraft(document) {
  const option = documentTypeOption(document?.documentKind || document?.source, document?.collection);
  const content = String(document?.content || "");
  const title = text(document?.title || document?.name || document?.id);
  const isDraft = Boolean(document?.isDraft || document?.draft || text(document?.syncStatus || document?.sync_status) === "draft");
  return {
    assetId: text(document?.assetId || document?.asset_id),
    baseContent: isDraft ? String(document?.baseContent ?? "") : content,
    baseTitle: isDraft ? text(document?.baseTitle, title) : title,
    collection: option.collection,
    content,
    contentHash: text(document?.contentHash || document?.content_hash || document?.sha256),
    documentKey: isDraft
      ? text(document?.documentKey || document?.document_key || accountDocumentStorageKey(document))
      : accountDocumentStorageKey(document),
    documentKind: option.id,
    draft: isDraft,
    extension: text(document?.extension, option.extension),
    fileName: text(document?.fileName || document?.file_name),
    filePath: normalizedDocumentPath(document?.filePath || document?.file_path),
    folderId: normalizedDocumentPath(document?.folderId || document?.folder_id),
    folderPath: normalizedDocumentPath(document?.folderPath || document?.folder_path),
    id: text(document?.id || document?.documentId || document?.document_id),
    isDraft,
    localPath: text(document?.localPath || document?.local_path),
    parentPathKey: normalizedDocumentPath(document?.parentPathKey || document?.parent_path_key),
    pathKey: normalizedDocumentPath(document?.pathKey || document?.path_key),
    rowType: "document",
    selectedKey: text(document?.selectedKey || document?.selected_key),
    source: option.id,
    syncStatus: isDraft ? "draft" : text(document?.syncStatus || document?.sync_status),
    title,
  };
}

function documentHasMaterializedContent(document) {
  return document?.hasContentPayload === true || documentHasInlineContent(document);
}

function documentHasInlineContent(document) {
  return String(document?.content ?? document?.content_md ?? document?.contentMd ?? document?.body ?? "").length > 0;
}

function documentCanHydrate(document) {
  if (documentIsFolderRow(document)) return false;
  const key = accountDocumentStorageKey(document) || text(document?.id);
  if (!key) return false;
  if (document?.pendingPush === true || text(document?.syncStatus || document?.sync_status) === "local_pending") {
    return false;
  }
  if (document?.contentStale === true) return true;
  if (documentHasInlineContent(document)) return false;
  return Boolean(
    text(document?.assetId || document?.asset_id)
    || text(document?.blobId || document?.blob_id)
    || text(document?.contentHash || document?.content_hash || document?.sha256)
    || document?.hasContent === true
    || document?.hasContentPayload === true
    || Number(document?.sizeBytes ?? document?.size_bytes) > 0,
  );
}

function documentDraftKey(document) {
  const explicit = text(document?.documentKey || document?.document_key);
  if (explicit.startsWith("draft:")) return explicit;
  const pathKey = normalizedDocumentPath(document?.pathKey || document?.path_key || document?.filePath || document?.file_path);
  const base = pathKey || accountDocumentStorageKey(document) || text(document?.id || document?.title, "untitled");
  return `draft:${base}`;
}

function editorHasUnsavedDraft(editor, selectedDocument = null) {
  if (!editor) return false;
  if (editor.isDraft === true || editor.draft === true || text(editor.syncStatus || editor.sync_status) === "draft") {
    return true;
  }
  return String(editor.content || "") !== String(editor.baseContent ?? "")
    || text(editor.title) !== text(editor.baseTitle || selectedDocument?.title || editor.title);
}

function editorDraftSnapshot(editor, selectedKey = "", selectedDocument = null) {
  if (!editor) return null;
  const documentKind = normalizedDocumentKind(editor.documentKind || editor.source, editor.collection);
  const pathMeta = documentPathMetadata({
    ...selectedDocument,
    ...editor,
    documentKind,
    extension: text(editor.extension, documentExtensionForKind(documentKind)),
  });
  return {
    ...editor,
    ...pathMeta,
    collection: normalizedDocumentCollection(),
    documentKey: documentDraftKey({ ...editor, ...pathMeta }),
    documentKind,
    draft: true,
    isDraft: true,
    rowType: "document",
    selectedKey: text(selectedKey),
    source: documentKind,
    syncStatus: "draft",
    updatedAt: new Date().toISOString(),
  };
}

function editorWithRemoteDocumentContent(current, document) {
  if (!current || !document) return current;
  const currentKey = current.documentKey || accountDocumentStorageKey(current);
  const documentKey = accountDocumentStorageKey(document);
  if (!currentKey || currentKey !== documentKey) return current;
  const baseContent = String(current.baseContent ?? current.content ?? "");
  const bodyDirty = String(current.content || "") !== baseContent;
  const currentTitle = text(current.title);
  const baseTitle = text(current.baseTitle, currentTitle);
  const remoteTitle = text(document.title || document.name, currentTitle);
  const titleDirty = currentTitle !== baseTitle;
  const nextMetadata = {
    assetId: text(document.assetId || document.asset_id, current.assetId),
    baseTitle: remoteTitle,
    collection: normalizedDocumentCollection(),
    documentKind: normalizedDocumentKind(document.documentKind || document.document_kind || document.source, current.collection),
    extension: text(document.extension || document.ext, current.extension),
    fileName: text(document.fileName || document.file_name, current.fileName),
    filePath: normalizedDocumentPath(document.filePath || document.file_path || current.filePath),
    folderId: normalizedDocumentPath(document.folderId || document.folder_id || current.folderId),
    folderPath: normalizedDocumentPath(document.folderPath || document.folder_path || current.folderPath),
    localPath: text(document.localPath || document.local_path, current.localPath),
    parentPathKey: normalizedDocumentPath(document.parentPathKey || document.parent_path_key || current.parentPathKey),
    pathKey: normalizedDocumentPath(document.pathKey || document.path_key || current.pathKey),
    source: normalizedDocumentKind(document.documentKind || document.document_kind || document.source, current.collection),
    title: titleDirty ? currentTitle : remoteTitle,
  };
  if (bodyDirty) {
    if (
      current.assetId === nextMetadata.assetId
      && current.baseTitle === nextMetadata.baseTitle
      && current.documentKind === nextMetadata.documentKind
      && current.extension === nextMetadata.extension
      && current.fileName === nextMetadata.fileName
      && current.filePath === nextMetadata.filePath
      && current.folderId === nextMetadata.folderId
      && current.folderPath === nextMetadata.folderPath
      && current.localPath === nextMetadata.localPath
      && current.parentPathKey === nextMetadata.parentPathKey
      && current.pathKey === nextMetadata.pathKey
      && current.source === nextMetadata.source
      && current.title === nextMetadata.title
    ) {
      return current;
    }
    return {
      ...current,
      ...nextMetadata,
    };
  }
  if (!documentHasMaterializedContent(document)) {
    if (
      current.assetId === nextMetadata.assetId
      && current.baseTitle === nextMetadata.baseTitle
      && current.documentKind === nextMetadata.documentKind
      && current.extension === nextMetadata.extension
      && current.fileName === nextMetadata.fileName
      && current.filePath === nextMetadata.filePath
      && current.folderId === nextMetadata.folderId
      && current.folderPath === nextMetadata.folderPath
      && current.localPath === nextMetadata.localPath
      && current.parentPathKey === nextMetadata.parentPathKey
      && current.pathKey === nextMetadata.pathKey
      && current.source === nextMetadata.source
      && current.title === nextMetadata.title
    ) {
      return current;
    }
    return {
      ...current,
      ...nextMetadata,
    };
  }
  const content = String(document.content || "");
  if (
    current.content === content
    && current.contentHash === text(document.contentHash || document.content_hash || document.sha256)
    && current.baseTitle === nextMetadata.baseTitle
    && current.fileName === nextMetadata.fileName
    && current.filePath === nextMetadata.filePath
    && current.folderId === nextMetadata.folderId
    && current.folderPath === nextMetadata.folderPath
    && current.localPath === text(document.localPath || document.local_path, current.localPath)
    && current.parentPathKey === nextMetadata.parentPathKey
    && current.pathKey === nextMetadata.pathKey
    && current.title === nextMetadata.title
  ) {
    return current;
  }
  return {
    ...current,
    ...nextMetadata,
    baseContent: content,
    content,
    contentHash: text(document.contentHash || document.content_hash || document.sha256),
  };
}

function getErrorMessage(error, fallback) {
  return error?.message || String(error || fallback || "Something went wrong.");
}

function clampProgressPercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function accountToolsEventCandidates(payload) {
  return [
    payload,
    payload?.payload,
    payload?.data,
    payload?.event,
    payload?.payload?.payload,
    payload?.payload?.data,
    payload?.data?.payload,
  ];
}

function accountToolsEventHasKnownPayload(payload) {
  return accountToolsEventCandidates(payload).some((candidate) => (
    candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
      && (
        candidate.contract === ACCOUNT_DOCUMENTS_CONTRACT
        || candidate.contract === "diffforge.account_clis.v1"
        || candidate.contract === "diffforge.account_mcps.v1"
        || candidate.document
        || candidate.documents
        || candidate.kind === "account_cli_changed"
        || candidate.kind === "account_mcp_changed"
        || candidate.ops
        || candidate.delta === true
        || candidate.clis
        || candidate.mcps
        || candidate.servers
      )
  ));
}

function accountToolsSkillPayloadIsFull(payload) {
  return accountToolsEventCandidates(payload).some((candidate) => (
    candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
      && (
        candidate.authoritative === true
        || candidate.snapshot_full === true
        || candidate.snapshotFull === true
      )
  ));
}

function accountToolsSkillMetaFromEventPayload(payload) {
  const meta = { error: "", revision: null, updatedAt: "", updatedBy: "" };
  const applyMeta = (source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    if (meta.revision === null && source.revision !== undefined && source.revision !== null) {
      const revision = Number(source.revision);
      if (Number.isFinite(revision)) meta.revision = revision;
    }
    meta.updatedAt = text(meta.updatedAt, text(source.updated_at || source.updatedAt));
    meta.updatedBy = text(meta.updatedBy, text(source.updated_by_device_name || source.updatedByDeviceName));
    meta.error = text(meta.error, text(source.last_sync_error || source.lastSyncError || source.error));
  };
  accountToolsEventCandidates(payload).forEach((candidate) => {
    applyMeta(candidate);
    applyMeta(candidate?.skills);
  });
  return meta;
}

function applySkillUnitsToLibrary(library, units) {
  return {
    skills: mergeSkillUnits(library?.skills || [], units),
  };
}

function replaceSkillUnitsInLibrary(units, currentSkills = []) {
  const incomingSkills = skillsFromUnits(units);
  const incomingKeys = new Set(incomingSkills.map((skill) => accountDocumentStorageKey(skill) || skill.id).filter(Boolean));
  return {
    skills: mergeSkillUnits(
      (Array.isArray(currentSkills) ? currentSkills : [])
        .filter((skill) => incomingKeys.has(accountDocumentStorageKey(skill) || skill.id)),
      units,
    ),
  };
}

function withLocalPendingSkill(skill, localSavedAt = new Date().toISOString()) {
  return {
    ...skill,
    hasContent: true,
    hasContentPayload: true,
    localSavedAt,
    pendingPush: true,
    syncStatus: "local_pending",
  };
}

function clearLocalPendingSkill(skill) {
  return {
    ...skill,
    localSavedAt: "",
    pendingPush: false,
    syncStatus: skill?.syncStatus === "local_pending" ? "" : text(skill?.syncStatus),
  };
}

function timeAgo(value) {
  const at = Date.parse(String(value || ""));
  const ms = Number.isFinite(at) ? at : Number(value) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function cliSnapshotFromStatuses(statuses) {
  return (Array.isArray(statuses) ? statuses : []).map((status) => ({
    agentId: text(status?.provider || status?.id),
    agentLabel: text(status?.label),
    installed: Boolean(status?.installed),
    authenticated: Boolean(status?.authenticated),
    version: text(status?.version),
    npmPackageVersion: text(status?.npmPackageVersion || status?.npm_package_version),
    npmLatestVersion: text(status?.npmLatestVersion || status?.npm_latest_version),
    updateAvailable: Boolean(status?.npmUpdateAvailable || status?.npm_update_available),
    activeModel: text(status?.activeModel || status?.active_model),
  }));
}

function SkillIconGlyph({ icon, title }) {
  const CliIcon = skillCliIcon(icon);
  if (CliIcon) return <CliIcon />;
  const key = String(icon || "");
  if (key.startsWith("codicon:")) {
    return <span className={`codicon codicon-${key.slice("codicon:".length)}`} />;
  }
  return <span>{text(title, "S").slice(0, 1).toUpperCase()}</span>;
}

function ToolsHydrationProgress({ placement = "panel", progress }) {
  if (!progress?.visible) return null;
  const percent = clampProgressPercent(progress.percent);
  const title = text(progress.title, "Hydrating account tools");
  const meta = text(progress.error || progress.meta, `${Math.round(percent)}%`);

  return (
    <ToolsHydrationPanel data-placement={placement} data-state={text(progress.state, "hydrating")}>
      <ToolsHydrationCopy>
        <strong>{title}</strong>
        <span>{meta}</span>
      </ToolsHydrationCopy>
      <ToolsHydrationTrack
        aria-label={title}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={meta}
        role="progressbar"
      >
        <ToolsHydrationFill style={{ width: `${percent}%` }} />
      </ToolsHydrationTrack>
    </ToolsHydrationPanel>
  );
}

export default function ToolsWorkspaceView({
  onAppControlContextChange = null,
  onAppControlDocumentActions = null,
  defaultWorkingDirectory = "",
  initialSection = "",
  rightToolsOrchestratorOpen = false,
  workspaces = [],
}) {
  const [section, setSection] = useState(() => normalizedSectionId(initialSection));

  useEffect(() => {
    const nextSection = normalizedSectionId(initialSection);
    setSection((current) => (current === nextSection ? current : nextSection));
  }, [initialSection]);

  // ---- MCP scope (global defaults vs per-workspace) ----
  const [mcpScope, setMcpScope] = useState(GLOBAL_MCP_DEFAULTS_SCOPE);
  const [globalMcpDefaults, setGlobalMcpDefaults] = useState({
    error: "",
    rootDirectory: "",
    state: "loading",
    workspaceId: GLOBAL_MCP_DEFAULTS_WORKSPACE_ID,
  });

  useEffect(() => {
    let cancelled = false;
    invoke("coordination_global_mcp_defaults_root")
      .then((response) => {
        if (cancelled) return;
        const data = response?.data || response || {};
        setGlobalMcpDefaults({
          error: "",
          rootDirectory: text(data.rootDirectory || data.root_directory),
          state: "ready",
          workspaceId: text(data.workspaceId || data.workspace_id, GLOBAL_MCP_DEFAULTS_WORKSPACE_ID),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setGlobalMcpDefaults((current) => ({
          ...current,
          error: getErrorMessage(error, "Unable to resolve the global MCP defaults store."),
          state: "error",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const workspaceOptions = useMemo(() => (
    (Array.isArray(workspaces) ? workspaces : [])
      .map((workspace) => ({
        id: text(workspace?.id),
        name: text(workspace?.name, text(workspace?.id, "Workspace")),
        rootDirectory: text(workspace?.rootDirectory, defaultWorkingDirectory),
      }))
      .filter((workspace) => workspace.id)
  ), [defaultWorkingDirectory, workspaces]);

  const activeMcpScope = mcpScope !== GLOBAL_MCP_DEFAULTS_SCOPE
    && workspaceOptions.some((workspace) => workspace.id === mcpScope)
    ? mcpScope
    : GLOBAL_MCP_DEFAULTS_SCOPE;
  const activeMcpWorkspace = activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE
    ? {
      id: globalMcpDefaults.workspaceId,
      name: "Global defaults",
    }
    : workspaceOptions.find((workspace) => workspace.id === activeMcpScope);
  const activeMcpRootDirectory = activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE
    ? globalMcpDefaults.rootDirectory
    : text(activeMcpWorkspace?.rootDirectory, defaultWorkingDirectory);
  const mcpScopeReady = activeMcpScope !== GLOBAL_MCP_DEFAULTS_SCOPE
    || (globalMcpDefaults.state === "ready" && Boolean(globalMcpDefaults.rootDirectory));

  // ---- Docs (account-level markdown documents backed by per-document assets) ----
  const [skillsLibrary, setSkillsLibrary] = useState(() => ({
    skills: getWorkspaceToolsAccountSkills(),
  }));
  const [skillsRevision, setSkillsRevision] = useState(null);
  const [skillsMeta, setSkillsMeta] = useState({ updatedAt: "", updatedBy: "", offline: false });
  const [skillsState, setSkillsState] = useState(() => (hasWorkspaceToolsLoaded() ? "ready" : "loading"));
  const [skillsError, setSkillsError] = useState("");
  const [skillsHydration, setSkillsHydration] = useState({
    error: "",
    meta: "",
    percent: 0,
    state: "idle",
    title: "",
    visible: false,
  });
  const skillsHydrationRunRef = useRef(0);
  const hydratingDocKeyRef = useRef("");
  const [hydratingDocKeys, setHydratingDocKeys] = useState(() => new Set());
  const [skillsQuery, setSkillsQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [newDocDraft, setNewDocDraft] = useState({ name: "", type: "skill" });
  const [documentDraft, setDocumentDraft] = useState(() => getWorkspaceToolsDocumentDraft());
  // "library:<collection>:<id>" or "catalog:<id>" — selecting a document shows its contents.
  const [selectedSkillKey, setSelectedSkillKey] = useState(() => text(getWorkspaceToolsDocumentDraft()?.selectedKey));
  // { id: ""|documentId, title, content } while creating/editing.
  const [skillEditor, setSkillEditor] = useState(() => {
    const restoredDraft = getWorkspaceToolsDocumentDraft();
    return restoredDraft ? documentEditorDraft(restoredDraft) : null;
  });
  const [skillEditorSelection, setSkillEditorSelection] = useState({
    direction: "",
    end: 0,
    start: 0,
    updatedAtMs: 0,
  });
  const [lastDocumentSelection, setLastDocumentSelection] = useState(null);
  const documentSelectionClearAtRef = useRef(0);
  const [skillEditorTheme, setSkillEditorTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    try {
      return normalizedSkillEditorTheme(window.localStorage?.getItem(SKILL_EDITOR_THEME_STORAGE_KEY));
    } catch {
      return "dark";
    }
  });
  const skillDocumentCanvasRef = useRef(null);
  const [skillDocumentScale, setSkillDocumentScale] = useState(1);
  const docsExplorerPanelRef = useRef(null);
  const [docsExplorerCollapsed, setDocsExplorerCollapsed] = useState(false);
  const [docsExplorerSize, setDocsExplorerSize] = useState("238px");

  const collapseDocsExplorer = useCallback(() => {
    setDocsExplorerCollapsed(true);
  }, []);

  const expandDocsExplorer = useCallback(() => {
    setDocsExplorerCollapsed(false);
  }, []);

  const syncDocsExplorerCollapsedState = useCallback((panelSize) => {
    const pixels = Number(panelSize?.pixels);
    const percentage = Number(panelSize?.percentage);
    const collapsed = Number.isFinite(pixels) ? pixels <= 58 : Number.isFinite(percentage) && percentage <= 6;
    setDocsExplorerCollapsed(collapsed);
    if (!collapsed && Number.isFinite(pixels)) {
      setDocsExplorerSize(`${Math.round(pixels)}px`);
    }
  }, []);

  useEffect(() => {
    if (docsExplorerCollapsed) return undefined;
    if (typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      docsExplorerPanelRef.current?.resize?.(docsExplorerSize);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [docsExplorerCollapsed, docsExplorerSize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem(SKILL_EDITOR_THEME_STORAGE_KEY, skillEditorTheme);
    } catch {
      // The editor theme is cosmetic; storage failures should not block editing.
    }
  }, [skillEditorTheme]);

  // ---- CLIs ----
  const [cliStatuses, setCliStatuses] = useState([]);
  const [cliState, setCliState] = useState("loading");
  const [cliError, setCliError] = useState("");
  const [cliBusy, setCliBusy] = useState({});
  const [cliMessage, setCliMessage] = useState("");
  const cliReportedRef = useRef("");
  const [catalogChecks, setCatalogChecks] = useState({});
  const [catalogBusy, setCatalogBusy] = useState({});
  const [catalogQuery, setCatalogQuery] = useState("");

  const loadAccountTools = useCallback(async ({ showProgress = false } = {}) => {
    const hydrationRunId = skillsHydrationRunRef.current + 1;
    skillsHydrationRunRef.current = hydrationRunId;
    let progressTimer = null;
    if (showProgress) {
      setSkillsHydration({
        error: "",
        meta: "Checking account document assets",
        percent: 6,
        runId: hydrationRunId,
        state: "hydrating",
        title: "Refreshing docs",
        visible: true,
      });
    } else {
      setSkillsHydration((current) => ({ ...current, visible: false, state: "idle" }));
    }
    if (showProgress && typeof window !== "undefined") {
      progressTimer = window.setInterval(() => {
        setSkillsHydration((current) => {
          if (current.runId !== hydrationRunId || current.state !== "hydrating") return current;
          const nextPercent = Math.min(92, Math.max(8, Number(current.percent || 0) + 7));
          return {
            ...current,
            meta: nextPercent < 62 ? "Checking document metadata" : "Refreshing document library",
            percent: nextPercent,
          };
        });
      }, 360);
    }
    setSkillsState((current) => (current === "ready" ? "refreshing" : "loading"));
    setSkillsError("");
    let lastLocalLibrary = null;
    try {
      try {
        const localData = await invoke("cloud_mcp_get_account_documents", {
          request: { limit: 2000, local_only: true },
        });
        if (skillsHydrationRunRef.current === hydrationRunId) {
          const localUnits = accountDocumentUnitsFromPayload(localData);
          const localSkillsLibrary = { skills: skillsFromUnits(localUnits) };
          lastLocalLibrary = localSkillsLibrary;
          setSkillsLibrary(localSkillsLibrary);
          noteAccountSkillUnits(localSkillsLibrary.skills);
          setSkillsState("ready");
        }
      } catch {
        // Local cache is best-effort; the full Cloud revalidation below can still succeed.
      }
      const data = await invoke("cloud_mcp_get_account_documents", {
        request: {
          cloud_timeout_ms: showProgress
            ? ACCOUNT_DOCS_FOREGROUND_REFRESH_TIMEOUT_MS
            : ACCOUNT_DOCS_BACKGROUND_REFRESH_TIMEOUT_MS,
          limit: 2000,
        },
      });
      const skills = data || {};
      const units = accountDocumentUnitsFromPayload(data);
      let parsedSkillsLibrary = replaceSkillUnitsInLibrary(
        units,
        lastLocalLibrary?.skills || getWorkspaceToolsAccountSkills(),
      );
      if (!parsedSkillsLibrary.skills.length && lastLocalLibrary?.skills?.length && data?.offline) {
        parsedSkillsLibrary = lastLocalLibrary;
      }
      setSkillsLibrary(parsedSkillsLibrary);
      noteAccountSkillUnits(parsedSkillsLibrary.skills);
      const nextRevision = Number(skills.revision ?? skills.seq ?? skills.sequence);
      setSkillsRevision(Number.isFinite(nextRevision) ? nextRevision : null);
      setSkillsMeta({
        updatedAt: text(skills.updated_at || skills.updatedAt),
        updatedBy: text(skills.updated_by_device_name || skills.updatedByDeviceName),
        offline: Boolean(data?.offline),
      });
      setSkillsState("ready");
      if (showProgress && skillsHydrationRunRef.current === hydrationRunId) {
        const hydratedUnits = units.filter((unit) => (
          text(unit?.content_md ?? unit?.contentMd ?? unit?.content).length
        ));
        const readyCount = parsedSkillsLibrary.skills.length || units.length;
        const readyLabel = readyCount
          ? `${readyCount} doc${readyCount === 1 ? "" : "s"} ready`
          : "Document library ready";
        const hydratedLabel = units.length
          ? ` · ${hydratedUnits.length || units.length}/${units.length} downloaded`
          : "";
        const offline = Boolean(data?.offline);
        setSkillsHydration({
          error: "",
          meta: offline ? "Showing cached docs" : `${readyLabel}${hydratedLabel}`,
          percent: 100,
          runId: hydrationRunId,
          state: "ready",
          title: offline ? "Docs loaded from cache" : "Docs hydrated",
          visible: true,
        });
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            if (skillsHydrationRunRef.current === hydrationRunId) {
              setSkillsHydration((current) => (
                current.state === "ready" ? { ...current, visible: false } : current
              ));
            }
          }, 1600);
        }
      }
    } catch (error) {
      const message = getErrorMessage(error, "Unable to load account tools.");
      setSkillsError(message);
      setSkillsState(lastLocalLibrary?.skills?.length ? "ready" : "error");
      if (showProgress && skillsHydrationRunRef.current === hydrationRunId) {
        setSkillsHydration({
          error: message,
          meta: "Document hydration failed",
          percent: 100,
          runId: hydrationRunId,
          state: "error",
          title: "Document hydration needs attention",
          visible: true,
        });
      } else {
        setSkillsHydration((current) => ({ ...current, visible: false, state: "idle" }));
      }
    } finally {
      if (progressTimer) {
        window.clearInterval(progressTimer);
      }
    }
  }, []);

  const refreshCliStatuses = useCallback(async ({ report = true } = {}) => {
    setCliState((current) => (current === "ready" ? "refreshing" : "loading"));
    setCliError("");
    try {
      const statuses = await invoke("agent_statuses");
      const list = Array.isArray(statuses) ? statuses : [];
      setCliStatuses(list);
      setCliState("ready");
      let checks = {};
      try {
        checks = await invoke("tools_check_cli_binaries", {
          binaries: CLI_CATALOG.map((entry) => entry.binary),
        }) || {};
        setCatalogChecks(checks);
      } catch {
        // Catalog detection is best-effort.
      }
      if (report) {
        const catalogSnapshot = CLI_CATALOG.map((entry) => ({
          agentId: `cli-${entry.id}`,
          agentLabel: entry.label,
          installed: Boolean(checks?.[entry.binary]?.installed),
        }));
        const snapshot = [...cliSnapshotFromStatuses(list), ...catalogSnapshot];
        const key = JSON.stringify(snapshot);
        if (key !== cliReportedRef.current) {
          cliReportedRef.current = key;
          invoke("cloud_mcp_report_cli_snapshot", { clis: snapshot }).catch(() => {});
        }
      }
    } catch (error) {
      setCliError(getErrorMessage(error, "Unable to read CLI statuses."));
      setCliState("error");
    }
  }, []);

  useEffect(() => {
    const cachedSkills = getWorkspaceToolsAccountSkills();
    if (hasWorkspaceToolsLoaded()) {
      setSkillsLibrary({ skills: cachedSkills });
      setSkillsState("ready");
    } else {
      void loadAccountTools({ showProgress: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeWorkspaceTools(() => {
      setSkillsLibrary({ skills: getWorkspaceToolsAccountSkills() });
      setDocumentDraft(getWorkspaceToolsDocumentDraft());
      if (hasWorkspaceToolsLoaded()) {
        setSkillsState((current) => (current === "loading" ? "ready" : current));
      }
    });
  }, []);

  useEffect(() => {
    void refreshCliStatuses();
  }, [refreshCliStatuses]);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("cloud-mcp-account-documents-updated", (event) => {
      if (disposed) {
        return;
      }
      const skillUnits = accountDocumentUnitsFromPayload(event?.payload);
      const replaceSkills = accountToolsSkillPayloadIsFull(event?.payload);
      if (skillUnits.length || replaceSkills) {
        const materializedSkills = skillsFromUnits(skillUnits.filter(documentHasMaterializedContent));
        const pendingHydrationSkills = skillsFromUnits(skillUnits)
          .filter((entry) => !documentHasMaterializedContent(entry) && documentCanHydrate(entry));
        const skillMeta = accountToolsSkillMetaFromEventPayload(event?.payload);
        setSkillsLibrary((current) => {
          const nextLibrary = replaceSkills
            ? replaceSkillUnitsInLibrary(skillUnits, current.skills)
            : applySkillUnitsToLibrary(current, skillUnits);
          noteAccountSkillUnits(nextLibrary.skills);
          return nextLibrary;
        });
        if (pendingHydrationSkills.length) {
          setHydratingDocKeys((current) => {
            const next = new Set(current);
            pendingHydrationSkills.forEach((entry) => {
              const key = accountDocumentStorageKey(entry) || entry.id;
              if (key) next.add(key);
            });
            return next;
          });
        }
        if (materializedSkills.length) {
          setHydratingDocKeys((current) => {
            const next = new Set(current);
            materializedSkills.forEach((entry) => {
              next.delete(accountDocumentStorageKey(entry) || entry.id);
            });
            return next;
          });
          setSkillEditor((current) => {
            const incoming = materializedSkills.find((entry) => (
              accountDocumentStorageKey(entry) === (current?.documentKey || accountDocumentStorageKey(current))
            ));
            return editorWithRemoteDocumentContent(current, incoming);
          });
        }
        const revisionUnit = skillUnits.find((unit) => unit?.revision != null);
        const revision = Number.isFinite(Number(skillMeta.revision))
          ? Number(skillMeta.revision)
          : Number(revisionUnit?.revision);
        setSkillsRevision((current) => (Number.isFinite(revision) ? revision : current));
        const updatedUnit = skillUnits.find((unit) => unit?.updated_at || unit?.updatedAt);
        const errorUnit = skillUnits.find((unit) => unit?.last_sync_error || unit?.lastSyncError || unit?.error);
        setSkillsMeta((current) => ({
          ...current,
          updatedAt: text(skillMeta.updatedAt || updatedUnit?.updated_at || updatedUnit?.updatedAt, current.updatedAt),
          updatedBy: text(skillMeta.updatedBy, current.updatedBy),
          offline: false,
        }));
        setSkillsState("ready");
        setSkillsError(text(skillMeta.error || errorUnit?.last_sync_error || errorUnit?.lastSyncError || errorUnit?.error));
        return;
      }
      if (!accountToolsEventHasKnownPayload(event?.payload)) {
        void loadAccountTools({ showProgress: false });
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, [loadAccountTools, skillsRevision]);

  // The Rust inventory watcher reports CLI installs/updates made outside the
  // app (terminals, remote levers, background mode); apply them live.
  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("agent-inventory-changed", (event) => {
      if (disposed) {
        return;
      }
      const statuses = Array.isArray(event?.payload?.statuses) ? event.payload.statuses : [];
      if (!statuses.length) {
        return;
      }
      setCliStatuses(statuses);
      setCliState("ready");
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, []);

  // Applies the next docs list locally right away, then asks Rust to save/delete
  // the underlying account document files and Cloud metadata.
  const persistSkillsLibrary = useCallback(async (nextSkills, forcedSkillIds = []) => {
    const forcedIds = new Set((Array.isArray(forcedSkillIds) ? forcedSkillIds : []).map(text).filter(Boolean));
    const nextLibrary = { skills: nextSkills };
    const nextByKey = new Map(nextLibrary.skills.map((skill) => [accountDocumentStorageKey(skill), skill]));
    const currentByKey = new Map(skillsLibrary.skills.map((skill) => [accountDocumentStorageKey(skill), skill]));
    const removed = Array.from(currentByKey.entries())
      .filter(([key, skill]) => key && !nextByKey.has(key) && !documentIsFolderRow(skill))
      .map(([, skill]) => skill);
    const upserts = nextLibrary.skills.filter((skill) => {
      if (documentIsFolderRow(skill)) return false;
      const key = accountDocumentStorageKey(skill);
      const keyOrId = key || text(skill?.id);
      const current = key ? currentByKey.get(key) : null;
      return forcedIds.has(keyOrId)
        || !current
        || String(current.content || "") !== String(skill.content || "")
        || text(current.title) !== text(skill.title)
        || text(current.documentKind) !== text(skill.documentKind)
        || text(current.collection) !== text(skill.collection)
        || normalizedDocumentPath(current.pathKey || current.path_key || current.filePath || current.file_path) !== normalizedDocumentPath(skill.pathKey || skill.path_key || skill.filePath || skill.file_path)
        || skill.pendingPush === true;
    });
    setSkillsLibrary(nextLibrary);
    setSkillsState("saving");
    setSkillsError("");
    noteAccountSkillUnits(nextLibrary.skills);
    try {
      const results = [];
      for (const skill of removed) {
        results.push(await invoke("cloud_mcp_delete_account_document", {
          request: accountDocumentRequestFromSkill(skill),
        }));
      }
      for (const skill of upserts) {
        results.push(await invoke("cloud_mcp_save_account_document", {
          request: accountDocumentRequestFromSkill(skill),
        }));
      }
      const result = [...results].reverse().find((entry) => entry) || {};
      const failed = results.find((entry) => text(entry?.cloud_error || entry?.cloudError));
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
      setSkillsMeta((current) => ({
        ...current,
        updatedAt: text(result?.updated_at || result?.updatedAt, current.updatedAt),
        offline: false,
      }));
      if (failed) {
        throw new Error(text(failed.cloud_error || failed.cloudError, "Cloud did not accept the document sync."));
      }
      const savedResultsByKey = new Map(results
        .filter((entry) => entry?.kind === "account_document_saved")
        .map((entry) => {
          const document = entry.document || {};
          return [accountDocumentStorageKey(document) || text(document.id || document.document_id || document.doc_id), entry];
        })
        .filter(([key]) => key));
      const syncedLibrary = {
        skills: nextLibrary.skills.map((skill) => {
          const key = accountDocumentStorageKey(skill) || text(skill?.id);
          const result = savedResultsByKey.get(key);
          if (result && result.cloud_synced !== true && result.cloudSynced !== true) {
            return withLocalPendingSkill(skill, text(result.document?.local_saved_at || result.document?.localSavedAt || skill.localSavedAt));
          }
          return clearLocalPendingSkill(skill);
        }),
      };
      setSkillsLibrary(syncedLibrary);
      noteAccountSkillUnits(syncedLibrary.skills);
      setSkillsState("ready");
      return true;
    } catch (error) {
      // Stale revision or offline: the local list keeps the change so nothing
      // is lost; the next successful save syncs the full unit set.
      setSkillsError(getErrorMessage(error, "Unable to sync docs."));
      setSkillsState("ready");
      return false;
    }
  }, [skillsLibrary.skills, skillsRevision]);

  const saveSkillsLibraryLocal = useCallback(async (nextSkills, pendingSkillIds = []) => {
    const pendingIds = new Set((Array.isArray(pendingSkillIds) ? pendingSkillIds : []).map(text).filter(Boolean));
    const localSavedAt = new Date().toISOString();
    const nextLibrary = {
      skills: nextSkills.map((skill) => (
        pendingIds.has(accountDocumentStorageKey(skill) || skill.id) ? withLocalPendingSkill(skill, localSavedAt) : skill
      )),
    };
    setSkillsLibrary(nextLibrary);
    setSkillsState("savingLocal");
    setSkillsError("");
    noteAccountSkillUnits(nextLibrary.skills);
    try {
      const results = [];
      for (const skill of nextLibrary.skills.filter((entry) => pendingIds.has(accountDocumentStorageKey(entry) || entry.id) && !documentIsFolderRow(entry))) {
        results.push(await invoke("cloud_mcp_save_account_document", {
          request: accountDocumentRequestFromSkill(skill, { local_only: true }),
        }));
      }
      const result = [...results].reverse().find((entry) => entry) || {};
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
      setSkillsMeta((current) => ({
        ...current,
        updatedAt: text(result?.local_saved_at || result?.localSavedAt || current.updatedAt),
        offline: false,
      }));
      setSkillsState("ready");
      return true;
    } catch (error) {
      setSkillsError(getErrorMessage(error, "Unable to save doc locally."));
      setSkillsState("ready");
      return false;
    }
  }, [skillsRevision]);

  const addCatalogSkill = useCallback((entry) => {
    const existingIds = new Set(skillsLibrary.skills.map((skill) => skill.id));
    const preferredId = skillSlug(entry.title || entry.id);
    if (existingIds.has(preferredId)) {
      setSelectedSkillKey(`library:${preferredId}`);
      const existing = skillsLibrary.skills.find((skill) => skill.id === preferredId);
      if (existing) setSkillEditor(documentEditorDraft(existing));
      return;
    }
    if (existingIds.has(entry.id)) {
      setSelectedSkillKey(`library:${entry.id}`);
      const existing = skillsLibrary.skills.find((skill) => skill.id === entry.id);
      if (existing) setSkillEditor(documentEditorDraft(existing));
      return;
    }
    const skillId = skillSlug(entry.title || entry.id, existingIds);
    const pathMeta = documentPathMetadata({
      documentKind: "skill",
      extension: "md",
      id: skillId,
    });
    const skill = {
      collection: "documents",
      content: String(entry.content || ""),
      documentKind: "skill",
      extension: "md",
      ...pathMeta,
      icon: text(entry.icon),
      id: skillId,
      rowType: "document",
      source: "skill",
      title: skillId,
      tone: text(entry.tone),
      updatedAt: new Date().toISOString(),
    };
    void persistSkillsLibrary([...skillsLibrary.skills, skill]);
    setSelectedSkillKey(`library:${accountDocumentStorageKey(skill)}`);
    setSkillEditor(documentEditorDraft(skill));
  }, [persistSkillsLibrary, skillsLibrary.skills]);

  const removeSkill = useCallback((skillKeyOrId) => {
    if (skillEditor?.isDraft || skillEditor?.draft || text(skillEditor?.syncStatus) === "draft") {
      const draftKey = text(skillEditor.documentKey || documentDraftKey(skillEditor));
      if (!skillKeyOrId || skillKeyOrId === draftKey || String(skillKeyOrId).startsWith("draft:")) {
        clearWorkspaceToolsDocumentDraft(draftKey);
        setSelectedSkillKey("");
        setSkillEditor(null);
        return;
      }
    }
    const skill = skillsLibrary.skills.find((entry) => (
      !documentIsFolderRow(entry)
      && (accountDocumentStorageKey(entry) === skillKeyOrId || entry.id === skillKeyOrId)
    ));
    if (!skill) return;
    const skillKey = accountDocumentStorageKey(skill) || skill.id;
    if (typeof window !== "undefined" && !window.confirm(`Remove the doc "${skill.title}"?`)) {
      return;
    }
    void persistSkillsLibrary(skillsLibrary.skills.filter((entry) => (
      (accountDocumentStorageKey(entry) || entry.id) !== skillKey
    )));
    setSelectedSkillKey("");
    setSkillEditor(null);
  }, [persistSkillsLibrary, skillEditor, skillsLibrary.skills]);

  const saveSkillEditor = useCallback(async (mode = "push", editorOverride = null) => {
    const activeEditor = editorOverride || skillEditor;
    if (!activeEditor || !text(activeEditor.title)) return false;
    const typeOption = documentTypeOption(activeEditor.documentKind || activeEditor.source, activeEditor.collection);
    const editorCollection = typeOption.collection;
    const editorKind = text(activeEditor.documentKind, typeOption.id);
    const editorExtension = text(activeEditor.extension, typeOption.extension);
    const displayTitle = text(activeEditor.title);
    const existing = activeEditor.id
      ? skillsLibrary.skills.find((entry) => (
        !documentIsFolderRow(entry)
        && (
        (activeEditor.documentKey && accountDocumentStorageKey(entry) === activeEditor.documentKey)
        || entry.id === activeEditor.id
        )
      ))
      : null;
    const updatedAt = new Date().toISOString();
    let nextSkills;
    let savedId;
    let savedPathMeta;
    if (existing) {
      savedId = existing.id;
      const existingKey = accountDocumentStorageKey(existing) || existing.id;
      savedPathMeta = documentPathMetadata({
        ...existing,
        ...activeEditor,
        extension: editorExtension,
        id: savedId,
      });
      nextSkills = skillsLibrary.skills.map((entry) => ((accountDocumentStorageKey(entry) || entry.id) === existingKey
        ? {
          ...entry,
          content: String(activeEditor.content || ""),
          documentKind: editorKind,
          extension: editorExtension,
          collection: editorCollection,
          ...savedPathMeta,
          rowType: "document",
          source: editorKind,
          title: displayTitle,
          updatedAt,
        }
        : entry));
    } else {
      savedId = skillSlug(activeEditor.title, new Set(skillsLibrary.skills.map((entry) => entry.id)));
      savedPathMeta = documentPathMetadata({
        ...activeEditor,
        extension: editorExtension,
        id: savedId,
      });
      nextSkills = [...skillsLibrary.skills, {
        collection: editorCollection,
        content: String(activeEditor.content || ""),
        documentKind: editorKind,
        extension: editorExtension,
        ...savedPathMeta,
        icon: "",
        id: savedId,
        localPath: text(activeEditor.localPath),
        rowType: "document",
        source: editorKind,
        title: displayTitle,
        tone: "",
        updatedAt,
      }];
    }
    const savedKey = accountDocumentStorageKey({ id: savedId, ...savedPathMeta, rowType: "document" }) || savedId;
    const activeDraftKey = activeEditor.isDraft || activeEditor.draft || text(activeEditor.syncStatus) === "draft"
      ? text(activeEditor.documentKey || documentDraftKey(activeEditor))
      : "";
    const savePromise = mode === "local"
      ? saveSkillsLibraryLocal(nextSkills, [savedKey])
      : persistSkillsLibrary(nextSkills, [savedKey]);
    const savedSkill = nextSkills.find((entry) => (accountDocumentStorageKey(entry) || entry.id) === savedKey);
    setSelectedSkillKey(`library:${savedKey}`);
    setSkillEditor({
      ...documentEditorDraft(savedSkill),
      documentKey: savedKey,
    });
    const ok = await savePromise;
    if (ok && activeDraftKey) {
      clearWorkspaceToolsDocumentDraft(activeDraftKey);
    }
    return ok;
  }, [persistSkillsLibrary, saveSkillsLibraryLocal, skillEditor, skillsLibrary.skills]);

  const runCliAction = useCallback(async (provider, action) => {
    const key = `${provider}:${action}`;
    setCliBusy((current) => ({ ...current, [provider]: action }));
    setCliMessage("");
    setCliError("");
    try {
      const command = action === "install"
        ? "install_agent"
        : action === "update"
          ? "update_agent"
          : "uninstall_agent";
      const result = await invoke(command, { provider });
      setCliMessage(text(result?.message, `${action} finished.`));
      await refreshCliStatuses();
    } catch (error) {
      setCliError(getErrorMessage(error, `Unable to ${action} ${provider}.`));
    } finally {
      setCliBusy((current) => {
        const next = { ...current };
        if (next[provider] === action) delete next[provider];
        return next;
      });
      void key;
    }
  }, [refreshCliStatuses]);

  const runCatalogAction = useCallback(async (entry, action) => {
    const target = cliInstallManager(entry);
    if (!target) {
      setCliError(`${entry.label} has no managed install; install it manually.`);
      return;
    }
    setCatalogBusy((current) => ({ ...current, [entry.id]: action }));
    setCliMessage("");
    setCliError("");
    try {
      const result = await invoke("tools_run_cli_action", {
        manager: target.manager,
        package: target.package,
        action,
      });
      if (result?.ok === false) {
        setCliError(text(result?.message, `${action} failed.`));
      } else {
        setCliMessage(text(result?.message, `${entry.label} ${action} completed.`));
      }
      await refreshCliStatuses();
    } catch (error) {
      setCliError(getErrorMessage(error, `Unable to ${action} ${entry.label}.`));
    } finally {
      setCatalogBusy((current) => {
        const next = { ...current };
        if (next[entry.id] === action) delete next[entry.id];
        return next;
      });
    }
  }, [refreshCliStatuses]);

  // One flat "installed programs" list: coding-agent CLIs and the developer
  // catalog merged, installed entries first, filtered by the search query.
  const cliRows = useMemo(() => {
    const query = text(catalogQuery).toLowerCase();
    const agentRows = (Array.isArray(cliStatuses) ? cliStatuses : []).map((status) => {
      const provider = text(status?.provider || status?.id);
      const label = text(status?.label, provider);
      return {
        busyAction: cliBusy[provider] || "",
        icon: null,
        id: `agent:${provider}`,
        installed: Boolean(status?.installed),
        kind: "agent",
        label,
        manageable: true,
        provider,
        searchText: `${label} ${provider}`.toLowerCase(),
        sub: "coding agent",
        updateAvailable: Boolean(status?.npmUpdateAvailable || status?.npm_update_available),
        version: text(status?.version),
      };
    });
    const catalogRows = CLI_CATALOG.map((entry) => ({
      busyAction: catalogBusy[entry.id] || "",
      entry,
      icon: entry.icon || null,
      id: `catalog:${entry.id}`,
      installed: Boolean(catalogChecks?.[entry.binary]?.installed),
      kind: "catalog",
      label: entry.label,
      manageable: Boolean(cliInstallManager(entry)),
      searchText: `${entry.label} ${entry.binary}`.toLowerCase(),
      sub: entry.binary,
      updateAvailable: false,
      version: "",
    }));
    return [...agentRows, ...catalogRows]
      .filter((row) => !query || row.searchText.includes(query))
      .sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [catalogBusy, catalogChecks, catalogQuery, cliBusy, cliStatuses]);

  const handleCliRowAction = useCallback((row, action) => {
    if (row.kind === "agent") {
      void runCliAction(row.provider, action);
    } else if (row.entry) {
      void runCatalogAction(row.entry, action);
    }
  }, [runCatalogAction, runCliAction]);

  const pendingSkillCount = useMemo(
    () => skillsLibrary.skills.filter((skill) => !documentIsFolderRow(skill) && skill?.pendingPush === true).length,
    [skillsLibrary.skills],
  );

  const skillsStatusTone = skillsMeta.offline || pendingSkillCount > 0 ? "warn" : "good";

  const skillsStatusLabel = useMemo(() => {
    if (skillsState === "loading") return "Loading…";
    if (skillsState === "saving") return "Syncing…";
    if (skillsState === "savingLocal") return "Saving locally…";
    if (pendingSkillCount > 0) {
      return `${pendingSkillCount} local change${pendingSkillCount === 1 ? "" : "s"} pending push`;
    }
    if (skillsMeta.offline) return "Offline — showing cached copy";
    const parts = [];
    if (skillsRevision !== null) parts.push(`rev ${skillsRevision}`);
    if (skillsMeta.updatedAt) parts.push(`updated ${timeAgo(skillsMeta.updatedAt)}`);
    if (skillsMeta.updatedBy) parts.push(`by ${skillsMeta.updatedBy}`);
    return parts.join(" · ") || "Synced to your account";
  }, [pendingSkillCount, skillsMeta, skillsRevision, skillsState]);

  const docsExplorerModel = useMemo(() => {
    const query = text(skillsQuery).toLowerCase();
    const hydrationPassActive = skillsHydration.visible === true && skillsHydration.state === "hydrating";
    const folders = new Map();
    const ensureFolder = (rawPath, source = {}) => {
      const path = normalizedDocumentPath(rawPath);
      if (!path) return null;
      const parts = path.split("/").filter(Boolean);
      let current = "";
      let node = null;
      parts.forEach((part, index) => {
        current = current ? `${current}/${part}` : part;
        const existing = folders.get(current);
        if (existing) {
          node = existing;
          return;
        }
        const parentPathKey = parts.slice(0, index).join("/");
        node = {
          childCount: 0,
          depth: index + 1,
          displayName: part,
          fileName: part,
          folderPath: current,
          key: `folder:${current}`,
          parentPathKey,
          pathKey: current,
          rowType: "folder",
          searchText: `${part} ${current}`.toLowerCase(),
          storageKey: `folder:${current}`,
          title: part,
        };
        folders.set(current, node);
      });
      if (node && source) {
        node.displayName = text(source.title || source.fileName || source.file_name, node.displayName);
        node.fileName = text(source.fileName || source.file_name, node.fileName);
        node.localPath = text(source.localPath || source.local_path, node.localPath);
        node.searchText = `${node.displayName} ${node.fileName} ${node.pathKey} ${text(node.localPath)}`.toLowerCase();
      }
      return node;
    };
    const docs = [];
    (skillsLibrary.skills || []).forEach((skill) => {
      if (documentIsFolderRow(skill)) {
        const pathKey = normalizedDocumentPath(skill.pathKey || skill.path_key || skill.folderPath || skill.folder_path || skill.id);
        const folder = ensureFolder(pathKey, skill);
        if (folder) {
          folder.explicit = true;
          folder.localPath = text(skill.localPath || skill.local_path, folder.localPath);
          folder.searchText = `${folder.displayName} ${folder.fileName} ${folder.pathKey} ${folder.localPath}`.toLowerCase();
        }
        return;
      }
        const key = accountDocumentStorageKey(skill) || skill.id;
        if (!key) return;
        const fileName = documentFileName(skill);
        const displayName = text(skill.title, fileName);
        const pathKey = normalizedDocumentPath(skill.pathKey || skill.path_key || skill.filePath || skill.file_path || key);
        const parentPathKey = normalizedDocumentPath(skill.parentPathKey || skill.parent_path_key || skill.folderPath || skill.folder_path || pathKey.split("/").slice(0, -1).join("/"));
        ensureFolder(parentPathKey);
        const row = {
          ...skill,
          depth: parentPathKey ? parentPathKey.split("/").filter(Boolean).length + 1 : 1,
          displayName,
          fileName,
          filePath: normalizedDocumentPath(skill.filePath || skill.file_path || pathKey),
          folderPath: parentPathKey,
          hydrating: hydratingDocKeys.has(key) || (hydrationPassActive && documentCanHydrate(skill)),
          key: `library:${key}`,
          parentPathKey,
          pathKey,
          preview: documentPreviewLine(skill),
          rowType: "document",
          storageKey: key,
          typeLabel: documentTypeLabel(skill.documentKind, skill.collection),
        };
        const matches = (
        !query
        || row.displayName.toLowerCase().includes(query)
        || row.fileName.toLowerCase().includes(query)
        || row.title.toLowerCase().includes(query)
        || row.pathKey.toLowerCase().includes(query)
        || row.preview.toLowerCase().includes(query)
        || row.typeLabel.toLowerCase().includes(query)
        || text(row.localPath).toLowerCase().includes(query)
        );
        if (matches) docs.push(row);
    });
    if (documentDraft) {
      const draftKey = documentDraft.documentKey || documentDraftKey(documentDraft);
      const fileName = documentFileName(documentDraft);
      const displayName = text(documentDraft.title, fileName);
      const pathKey = normalizedDocumentPath(documentDraft.pathKey || documentDraft.path_key || documentDraft.filePath || documentDraft.file_path || fileName);
      const parentPathKey = normalizedDocumentPath(documentDraft.parentPathKey || documentDraft.parent_path_key || documentDraft.folderPath || documentDraft.folder_path || pathKey.split("/").slice(0, -1).join("/"));
      ensureFolder(parentPathKey);
      const row = {
        ...documentDraft,
        depth: parentPathKey ? parentPathKey.split("/").filter(Boolean).length + 1 : 1,
        displayName,
        draft: true,
        fileName,
        filePath: normalizedDocumentPath(documentDraft.filePath || documentDraft.file_path || pathKey),
        folderPath: parentPathKey,
        hydrating: false,
        isDraft: true,
        key: `draft:${draftKey}`,
        parentPathKey,
        pathKey,
        preview: documentPreviewLine(documentDraft),
        rowType: "document",
        selectedKey: text(documentDraft.selectedKey),
        storageKey: draftKey,
        syncStatus: "draft",
        typeLabel: `${documentTypeLabel(documentDraft.documentKind, documentDraft.collection)} draft`,
      };
      const matches = (
        !query
        || row.displayName.toLowerCase().includes(query)
        || row.fileName.toLowerCase().includes(query)
        || row.title.toLowerCase().includes(query)
        || row.pathKey.toLowerCase().includes(query)
        || row.preview.toLowerCase().includes(query)
        || row.typeLabel.toLowerCase().includes(query)
      );
      if (matches) docs.push(row);
    }
    docs.forEach((row) => {
      let current = row.parentPathKey;
      while (current) {
        const folder = folders.get(current);
        if (folder) folder.childCount += 1;
        current = current.split("/").slice(0, -1).join("/");
      }
    });
    const rows = [];
    const pushFolder = (folderPath) => {
      Array.from(folders.values())
        .filter((folder) => folder.parentPathKey === folderPath)
        .filter((folder) => (
          !query
          || folder.childCount > 0
          || folder.searchText.includes(query)
        ))
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .forEach((folder) => {
          rows.push(folder);
          pushFolder(folder.pathKey);
        });
      docs
        .filter((row) => row.parentPathKey === folderPath)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .forEach((row) => rows.push(row));
    };
    pushFolder("");
    return { files: docs, rows };
  }, [documentDraft, hydratingDocKeys, skillsHydration.state, skillsHydration.visible, skillsLibrary.skills, skillsQuery]);
  const docFileRows = docsExplorerModel.files;
  const docsExplorerRows = docsExplorerModel.rows;

  const defaultSkillRows = useMemo(() => {
    const query = text(templateQuery).toLowerCase();
    const ownedIds = new Set(skillsLibrary.skills.map((skill) => skill.id));
    return SKILLS_CATALOG
      .map((entry) => {
        const defaultId = skillSlug(entry.title || entry.id);
        const added = ownedIds.has(defaultId) || ownedIds.has(entry.id);
        const cliInstalled = Boolean(catalogChecks?.[skillCliBinary(entry)]?.installed);
        return {
          ...entry,
          added,
          cliInstalled,
          defaultFileName: `${defaultId}.md`,
          defaultId,
          searchLabel: `${entry.title} ${entry.description || ""} ${defaultId} ${cliInstalled ? "cli installed" : ""}`.toLowerCase(),
        };
      })
      .filter((row) => !query || row.searchLabel.includes(query))
      .sort((a, b) => {
        if (a.added !== b.added) return a.added ? 1 : -1;
        if (a.cliInstalled !== b.cliInstalled) return a.cliInstalled ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
  }, [catalogChecks, skillsLibrary.skills, templateQuery]);

  const startNewDocument = useCallback(() => {
    const requestedName = text(newDocDraft.name);
    if (!requestedName) return;
    const option = documentTypeOption(newDocDraft.type);
    const existingIds = new Set(skillsLibrary.skills.map((entry) => entry.id));
    const docId = skillSlug(requestedName, existingIds);
    const pathMeta = documentPathMetadata({
      documentKind: option.id,
      extension: option.extension,
      id: docId,
      title: docId,
    });
    setSelectedSkillKey("");
    const draftEditor = {
      baseContent: "",
      collection: option.collection,
      content: "",
      contentHash: "",
      documentKey: documentDraftKey({ id: docId, ...pathMeta }),
      documentKind: option.id,
      draft: true,
      extension: option.extension,
      ...pathMeta,
      id: docId,
      isDraft: true,
      localPath: "",
      rowType: "document",
      source: option.id,
      syncStatus: "draft",
      title: docId,
    };
    setSkillEditor(draftEditor);
    setWorkspaceToolsDocumentDraft(editorDraftSnapshot(draftEditor, "", null));
    setNewDocDraft((current) => ({ ...current, name: "" }));
  }, [newDocDraft, skillsLibrary.skills]);

  const selectedSkill = useMemo(() => {
    const [scope, ...rest] = selectedSkillKey.split(":");
    const key = rest.join(":");
    if (!key) return null;
    if (scope === "library") {
      const skill = skillsLibrary.skills.find((entry) => (
        !documentIsFolderRow(entry)
        && (accountDocumentStorageKey(entry) === key || entry.id === key)
      ));
      return skill ? { ...skill, owned: true } : null;
    }
    if (scope === "catalog") {
      const entry = SKILLS_CATALOG.find((candidate) => candidate.id === key);
      return entry ? { ...entry, owned: false } : null;
    }
    return null;
  }, [selectedSkillKey, skillsLibrary.skills]);

  useEffect(() => {
    if (!skillEditor) return;
    if (!editorHasUnsavedDraft(skillEditor, selectedSkill)) return;
    setWorkspaceToolsDocumentDraft(editorDraftSnapshot(skillEditor, selectedSkillKey, selectedSkill));
  }, [selectedSkill, selectedSkillKey, skillEditor]);

  useEffect(() => {
    if (!selectedSkill?.owned || !documentHasMaterializedContent(selectedSkill)) return;
    setSkillEditor((current) => editorWithRemoteDocumentContent(current, selectedSkill));
  }, [selectedSkill]);

  useEffect(() => {
    const selectedKey = selectedSkill?.owned ? accountDocumentStorageKey(selectedSkill) : "";
    if (!selectedKey) return;
    const editorKey = skillEditor?.documentKey || accountDocumentStorageKey(skillEditor) || skillEditor?.id || "";
    const editorMatchesSelected = editorKey === selectedKey;
    const editorContent = String(skillEditor?.content || "");
    const editorBaseContent = String(skillEditor?.baseContent ?? skillEditor?.content ?? "");
    if (editorMatchesSelected && editorContent !== editorBaseContent) return;
    if (
      (String(selectedSkill?.content || "").length > 0 || (editorMatchesSelected && editorContent.length > 0))
      && selectedSkill?.contentStale !== true
    ) return;
    if (hydratingDocKeyRef.current === selectedKey) return;
    hydratingDocKeyRef.current = selectedKey;
    setHydratingDocKeys((current) => {
      const next = new Set(current);
      next.add(selectedKey);
      return next;
    });
    let cancelled = false;
    invoke("cloud_mcp_hydrate_account_document", {
      request: accountDocumentHydrateRequestFromSkill(selectedSkill),
    }).then((result) => {
      if (cancelled) return;
      const units = accountDocumentUnitsFromPayload(result);
      if (units.length) {
        const hydratedSkills = skillsFromUnits(units);
        const hydratedSkill = hydratedSkills.find((entry) => accountDocumentStorageKey(entry) === selectedKey);
        setSkillsLibrary((current) => {
          const nextLibrary = applySkillUnitsToLibrary(current, units);
          noteAccountSkillUnits(nextLibrary.skills);
          return nextLibrary;
        });
        if (documentHasMaterializedContent(hydratedSkill)) {
          setSkillEditor((current) => {
            return editorWithRemoteDocumentContent(current, hydratedSkill);
          });
        }
      }
    }).catch((error) => {
      if (!cancelled) {
        setSkillsError(getErrorMessage(error, "Unable to hydrate doc content."));
      }
    }).finally(() => {
      if (hydratingDocKeyRef.current === selectedKey) {
        hydratingDocKeyRef.current = "";
      }
      setHydratingDocKeys((current) => {
        const next = new Set(current);
        next.delete(selectedKey);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSkillKey, selectedSkill, skillEditor]);

  const skillEditorDocumentKey = skillEditor
    ? skillEditor.documentKey || accountDocumentStorageKey(skillEditor) || skillEditor.id
    : "";
  useEffect(() => {
    setSkillEditorSelection({
      direction: "",
      end: 0,
      start: 0,
      updatedAtMs: Date.now(),
    });
    setLastDocumentSelection(null);
  }, [skillEditorDocumentKey]);

  const selectedDocumentRefreshing = Boolean(
    skillEditor
    && skillEditorDocumentKey
    && (
      hydratingDocKeys.has(skillEditorDocumentKey)
      || (
        selectedSkill?.owned
        && (accountDocumentStorageKey(selectedSkill) || selectedSkill.id) === skillEditorDocumentKey
        && String(skillEditor.content || "").length === 0
        && String(skillEditor.content || "") === String(skillEditor.baseContent ?? skillEditor.content ?? "")
        && (selectedSkill.contentStale === true || (!documentHasMaterializedContent(selectedSkill) && documentCanHydrate(selectedSkill)))
      )
    ),
  );
  const skillEditorBusy = skillsState === "saving" || skillsState === "savingLocal";
  const skillEditorReadOnly = selectedDocumentRefreshing || skillEditorBusy;
  const skillEditorOpen = Boolean(skillEditor);
  const skillDocumentMetricsStyle = useMemo(
    () => skillDocumentPageStyle(skillDocumentScale),
    [skillDocumentScale],
  );
  const appControlDocumentContext = useMemo(() => {
    const content = String(skillEditor?.content || "");
    const preview = compactDocumentText(content, 1400);
    const draftFingerprint = documentDraftFingerprint(content);
    const editorDraft = editorHasUnsavedDraft(skillEditor, selectedSkill);
    const localPath = editorDraft ? "" : text(skillEditor?.localPath || selectedSkill?.localPath || selectedSkill?.local_path);
    const documentKind = normalizedDocumentKind(
      skillEditor?.documentKind || skillEditor?.source || selectedSkill?.documentKind || selectedSkill?.source,
      skillEditor?.collection || selectedSkill?.collection,
    );
    const pathMeta = skillEditor ? documentPathMetadata({
      ...selectedSkill,
      ...skillEditor,
      documentKind,
      extension: text(skillEditor.extension || selectedSkill?.extension, documentExtensionForKind(documentKind)),
    }) : {};
    const liveSelectionContext = skillEditor ? documentSelectionContext(content, skillEditorSelection) : null;
    const preservedSelectionContext = skillEditor
      && lastDocumentSelection
      && lastDocumentSelection.documentKey === skillEditorDocumentKey
      && lastDocumentSelection.draftFingerprint === draftFingerprint
        ? documentSelectionContext(content, lastDocumentSelection)
        : null;
    const highlightedRange = liveSelectionContext?.active
      ? liveSelectionContext
      : preservedSelectionContext?.active
        ? {
          ...preservedSelectionContext,
          preserved: true,
        }
        : liveSelectionContext;
    return {
      active: section === "docs",
      canDirectEditFile: Boolean(localPath),
      content,
      contentLength: content.length,
      contentPreview: preview.text,
      contentPreviewTruncated: preview.truncated,
      draftContent: content,
      dirty: Boolean(skillEditor && editorDraft),
      document: skillEditor ? {
        collection: normalizedDocumentCollection(),
	        contentHash: text(skillEditor.contentHash || selectedSkill?.contentHash || selectedSkill?.sha256),
	        documentKey: skillEditorDocumentKey,
	        draftFingerprint,
	        extension: text(skillEditor.extension || selectedSkill?.extension, documentExtensionForKind(documentKind)),
	        fileName: pathMeta.fileName,
	        filePath: pathMeta.filePath,
	        folderId: pathMeta.folderId,
	        folderPath: pathMeta.folderPath,
	        id: text(skillEditor.id || selectedSkill?.id || selectedSkill?.documentId),
	        isDraft: editorDraft,
	        kind: documentKind,
	        localPath,
	        parentPathKey: pathMeta.parentPathKey,
	        pathKey: pathMeta.pathKey,
	        pendingPush: editorDraft ? false : Boolean(selectedSkill?.pendingPush),
        source: documentKind,
        syncStatus: editorDraft ? "draft" : text(selectedSkill?.syncStatus),
        title: text(skillEditor.title || selectedSkill?.title),
      } : null,
      editorReadOnly: Boolean(skillEditorReadOnly),
      editorState: skillsState,
      fullContent: content,
      highlightedRange,
      saveModes: ["draft", "local", "publish"],
      section,
      selectedKey: selectedSkillKey,
      surface: "tools",
      type: "tools_document_context",
      updatedAtMs: Date.now(),
    };
  }, [
    section,
    selectedSkill,
    selectedSkillKey,
    skillEditor,
    skillEditorDocumentKey,
    skillEditorReadOnly,
    skillEditorSelection,
    lastDocumentSelection,
    skillsState,
  ]);

  useEffect(() => {
    if (typeof onAppControlContextChange !== "function") return;
    onAppControlContextChange(appControlDocumentContext);
  }, [appControlDocumentContext, onAppControlContextChange]);

  useEffect(() => {
    if (typeof onAppControlContextChange !== "function") return undefined;
    return () => {
      onAppControlContextChange({
        active: false,
        section: "",
        surface: "tools",
        type: "tools_document_context",
        updatedAtMs: Date.now(),
      });
    };
  }, [onAppControlContextChange]);

  const clearDocumentSelection = useCallback(() => {
    const updatedAtMs = Date.now();
    documentSelectionClearAtRef.current = updatedAtMs;
    setSkillEditorSelection({
      direction: "",
      end: 0,
      start: 0,
      updatedAtMs,
    });
    setLastDocumentSelection(null);
  }, []);

  const updateSelectedDocumentFromAppControl = useCallback(async (input = {}) => {
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(input, key);
    const requestedTitle = hasOwn("title")
      ? text(input.title)
      : hasOwn("name")
        ? text(input.name)
        : "";
    const requestedKind = hasOwn("document_kind")
      ? text(input.document_kind)
      : hasOwn("kind")
        ? text(input.kind)
        : "";
    const requestedExtension = hasOwn("extension") || hasOwn("ext")
      ? text(input.extension || input.ext)
      : "";
    const requestedFolderPath = hasOwn("folder_path") ? normalizedDocumentPath(input.folder_path) : "";
    const requestedFileName = hasOwn("file_name") ? text(input.file_name) : "";
    const requestedFilePath = hasOwn("file_path") ? normalizedDocumentPath(input.file_path) : "";
    const requestedPathKey = hasOwn("path_key") ? normalizedDocumentPath(input.path_key) : "";
    const hasContentPatch = hasOwn("content_md") || hasOwn("content");
    const requestedContent = hasOwn("content_md")
      ? String(input.content_md ?? "")
      : hasOwn("content")
        ? String(input.content ?? "")
        : "";
    const baseTitle = requestedTitle || text(skillEditor?.title || newDocDraft.name, "Untitled document");
    if (!skillEditor && !baseTitle) {
      return {
        ok: false,
        error: {
          code: "no_selected_document",
          message: "No Tools document is selected.",
        },
        context: appControlDocumentContext,
      };
    }
    const existingIds = new Set(skillsLibrary.skills.map((entry) => entry.id).filter(Boolean));
    const isExistingDocument = Boolean(selectedSkill?.owned);
    const option = documentTypeOption(requestedKind || skillEditor?.documentKind || skillEditor?.source || newDocDraft.type);
    const draftId = isExistingDocument
      ? text(skillEditor?.id || selectedSkill?.id || selectedSkill?.documentId)
      : skillSlug(baseTitle, existingIds);
    const nextEditor = {
      ...(skillEditor || {
        assetId: "",
        baseContent: "",
        collection: option.collection,
        content: "",
        contentHash: "",
        documentKey: draftId,
        documentKind: option.id,
        extension: option.extension,
        id: draftId,
        localPath: "",
        source: option.id,
        title: draftId,
      }),
    };
    if (requestedTitle) {
      nextEditor.title = requestedTitle;
      if (!isExistingDocument) {
        nextEditor.id = skillSlug(requestedTitle, existingIds);
        nextEditor.documentKey = nextEditor.id;
      }
    }
    if (requestedKind) {
      const nextOption = documentTypeOption(requestedKind);
      nextEditor.collection = nextOption.collection;
      nextEditor.documentKind = nextOption.id;
      nextEditor.source = nextOption.id;
      nextEditor.extension = requestedExtension || nextOption.extension;
    } else if (requestedExtension) {
      nextEditor.extension = requestedExtension.replace(/^\./u, "").toLowerCase() || nextEditor.extension;
    }
    if (requestedFolderPath) {
      nextEditor.folderPath = requestedFolderPath;
      nextEditor.folderId = requestedFolderPath;
      nextEditor.parentPathKey = requestedFolderPath;
    }
    if (requestedFileName) {
      nextEditor.fileName = requestedFileName;
    }
    if (requestedFilePath || requestedPathKey) {
      const nextPath = requestedPathKey || requestedFilePath;
      nextEditor.filePath = nextPath;
      nextEditor.pathKey = nextPath;
      nextEditor.parentPathKey = normalizedDocumentPath(nextPath.split("/").slice(0, -1).join("/"));
      nextEditor.folderPath = nextEditor.parentPathKey;
      nextEditor.folderId = nextEditor.parentPathKey;
    }
    if (hasContentPatch) {
      nextEditor.content = requestedContent;
    }
    const nextDocumentKind = normalizedDocumentKind(nextEditor.documentKind || nextEditor.source, nextEditor.collection);
    const nextPathMeta = documentPathMetadata({
      ...nextEditor,
      documentKind: nextDocumentKind,
      extension: text(nextEditor.extension, documentExtensionForKind(nextDocumentKind)),
    });
    Object.assign(nextEditor, {
      ...nextPathMeta,
      collection: normalizedDocumentCollection(),
      documentKey: documentDraftKey({ ...nextEditor, ...nextPathMeta }),
      documentKind: nextDocumentKind,
      draft: true,
      isDraft: true,
      rowType: "document",
      selectedKey: isExistingDocument ? selectedSkillKey : "",
      source: nextDocumentKind,
      syncStatus: "draft",
    });
    const contextForNextEditor = () => {
      const content = String(nextEditor.content || "");
      const preview = compactDocumentText(content, 1400);
      const documentKind = normalizedDocumentKind(nextEditor.documentKind || nextEditor.source, nextEditor.collection);
      const documentKey = nextEditor.documentKey || accountDocumentStorageKey(nextEditor) || nextEditor.id;
      const pathMeta = documentPathMetadata({
        ...nextEditor,
        documentKind,
        extension: text(nextEditor.extension, documentExtensionForKind(documentKind)),
      });
      return {
        ...appControlDocumentContext,
        active: section === "docs",
        canDirectEditFile: Boolean(nextEditor.localPath),
        content,
        contentLength: content.length,
        contentPreview: preview.text,
        contentPreviewTruncated: preview.truncated,
        dirty: true,
        document: {
          ...(appControlDocumentContext.document || {}),
	          collection: normalizedDocumentCollection(),
	          contentHash: text(nextEditor.contentHash),
	          documentKey,
	          draftFingerprint: documentDraftFingerprint(content),
	          extension: text(nextEditor.extension, documentExtensionForKind(documentKind)),
	          fileName: pathMeta.fileName,
	          filePath: pathMeta.filePath,
	          folderId: pathMeta.folderId,
	          folderPath: pathMeta.folderPath,
	          id: text(nextEditor.id || documentKey),
	          kind: documentKind,
	          localPath: text(nextEditor.localPath),
	          parentPathKey: pathMeta.parentPathKey,
	          pathKey: pathMeta.pathKey,
	          pendingPush: Boolean(nextEditor.pendingPush),
          source: documentKind,
          syncStatus: text(nextEditor.syncStatus),
          title: text(nextEditor.title || nextEditor.id || documentKey),
        },
        draftContent: content,
        fullContent: content,
        highlightedRange: documentSelectionContext(content, skillEditorSelection),
        section,
        selectedKey: isExistingDocument ? selectedSkillKey : "",
        updatedAtMs: Date.now(),
      };
    };
    const nextContext = contextForNextEditor();
    setSelectedSkillKey(isExistingDocument
      ? selectedSkillKey
      : "");
    setSkillEditor(nextEditor);
    setWorkspaceToolsDocumentDraft(editorDraftSnapshot(nextEditor, isExistingDocument ? selectedSkillKey : "", selectedSkill));
    if (hasContentPatch) {
      clearDocumentSelection();
    }

    const requestedMode = text(input.mode || input.save_mode, input.save === true ? "local" : "draft").toLowerCase();
    const shouldSave = input.save === true || !["", "draft", "edit", "update", "none"].includes(requestedMode);
    if (!shouldSave) {
      return {
        ok: true,
        mode: "draft",
        source: "editor_state",
        context: nextContext,
      };
    }
    const localOnly = ["local", "local_only", "local-only", "draft"].includes(requestedMode);
    const ok = await saveSkillEditor(localOnly ? "local" : "push", nextEditor);
    return {
      ok: Boolean(ok),
      mode: localOnly ? "local" : "publish",
      source: "editor_state",
      context: nextContext,
    };
  }, [
    appControlDocumentContext,
    clearDocumentSelection,
    newDocDraft.name,
    newDocDraft.type,
    saveSkillEditor,
    section,
    selectedSkill,
    selectedSkillKey,
    skillEditor,
    skillEditorSelection,
    skillsLibrary.skills,
  ]);

  const appControlDocumentActions = useMemo(() => ({
    getSelectedDocumentContext: async () => appControlDocumentContext,
    saveSelectedDocument: async (input = {}) => {
      if (!skillEditor) {
        return {
          ok: false,
          error: {
            code: "no_selected_document",
            message: "No Tools document is selected.",
          },
          context: appControlDocumentContext,
        };
      }
      const requestedMode = text(input.mode || input.saveMode || input.save_mode || input.action, "publish")
        .toLowerCase();
      const localOnly = ["local", "local_only", "local-only", "draft"].includes(requestedMode);
      const document = appControlDocumentContext.document || {};
      const editorDirty = String(skillEditor.content || "") !== String(skillEditor.baseContent ?? skillEditor.content ?? "");
      if (document.localPath && document.id && !editorDirty) {
        const result = await invoke("cloud_mcp_save_account_document", {
          request: {
            document: {
              collection: normalizedDocumentCollection(),
              doc_id: document.id,
              document_id: document.id,
              document_kind: document.kind,
              extension: document.extension,
              id: document.id,
              local_path: document.localPath,
              name: document.title || document.id,
              source: document.kind,
              title: document.title || document.id,
            },
            local_only: localOnly,
          },
        });
        const units = accountDocumentUnitsFromPayload(result);
        if (units.length) {
          const hydratedSkills = skillsFromUnits(units);
          setSkillsLibrary((current) => {
            const nextLibrary = applySkillUnitsToLibrary(current, units);
            noteAccountSkillUnits(nextLibrary.skills);
            return nextLibrary;
          });
          const hydratedSkill = hydratedSkills.find((entry) => (
            (accountDocumentStorageKey(entry) || entry.id) === (skillEditor.documentKey || accountDocumentStorageKey(skillEditor) || skillEditor.id)
          ));
          if (documentHasMaterializedContent(hydratedSkill)) {
            setSkillEditor((current) => editorWithRemoteDocumentContent(current, hydratedSkill));
          }
        }
        return {
          ok: result?.ok !== false,
          mode: localOnly ? "local" : "publish",
          result,
          source: "local_path",
          context: appControlDocumentContext,
        };
      }
      const ok = await saveSkillEditor(localOnly ? "local" : "push");
      return {
        ok: Boolean(ok),
        mode: localOnly ? "local" : "publish",
        source: "editor_state",
        context: appControlDocumentContext,
      };
    },
    updateSelectedDocument: updateSelectedDocumentFromAppControl,
  }), [appControlDocumentContext, saveSkillEditor, skillEditor, updateSelectedDocumentFromAppControl]);

  useEffect(() => {
    if (typeof onAppControlDocumentActions !== "function") return undefined;
    return onAppControlDocumentActions(appControlDocumentActions);
  }, [appControlDocumentActions, onAppControlDocumentActions]);

  const docsCreateMode = !skillEditor;
  const showDocsTemplatesPane = docsCreateMode && !rightToolsOrchestratorOpen;
  const skillEditorRows = useMemo(() => {
    const content = String(skillEditor?.content || "");
    const estimatedLines = content.split("\n").reduce((total, line) => {
      return total + Math.max(1, Math.ceil(line.length / 82));
    }, 0);
    return Math.max(28, Math.min(260, estimatedLines + 8));
  }, [skillEditor?.content]);
  const preservedSkillEditorSelection = useMemo(() => {
    if (!skillEditor || !lastDocumentSelection) return null;
    const content = String(skillEditor.content || "");
    const documentKey = skillEditor.documentKey || accountDocumentStorageKey(skillEditor) || skillEditor.id || "";
    if (
      !documentKey
      || lastDocumentSelection.documentKey !== documentKey
      || lastDocumentSelection.draftFingerprint !== documentDraftFingerprint(content)
    ) {
      return null;
    }
    return documentSelectionSegments(content, lastDocumentSelection);
  }, [skillEditor, lastDocumentSelection]);
  const scrollSkillDocumentCanvas = useCallback((event) => {
    const canvas = skillDocumentCanvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.scrollTop += event.deltaY;
    canvas.scrollLeft += event.deltaX;
  }, []);
  const updateSkillEditorSelection = useCallback((event) => {
    const target = event?.target;
    const start = Number(target?.selectionStart);
    const end = Number(target?.selectionEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }
    const updatedAtMs = Date.now();
    const eventType = text(event?.type);
    const suppressPreserve = eventType === "blur"
      && updatedAtMs - documentSelectionClearAtRef.current < 400;
    const nextSelection = {
      direction: text(target?.selectionDirection),
      end,
      start,
      updatedAtMs,
    };
    setSkillEditorSelection({
      ...nextSelection,
    });
    if (!skillEditor) {
      return;
    }
    const documentKey = skillEditor.documentKey || accountDocumentStorageKey(skillEditor) || skillEditor.id || "";
    const content = String(skillEditor.content || "");
    if (documentKey && end > start) {
      if (suppressPreserve) {
        setLastDocumentSelection(null);
        return;
      }
      setLastDocumentSelection({
        ...nextSelection,
        contentLength: content.length,
        documentKey,
        draftFingerprint: documentDraftFingerprint(content),
      });
      return;
    }
    if (suppressPreserve || (target && typeof document !== "undefined" && document.activeElement === target)) {
      setLastDocumentSelection(null);
    }
  }, [skillEditor]);
  useEffect(() => {
    if (!skillEditorOpen || typeof window === "undefined") return undefined;
    const canvas = skillDocumentCanvasRef.current;
    if (!canvas) return undefined;

    let animationFrame = 0;
    const updateScale = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width) return;
      const availableWidth = Math.max(1, bounds.width - SKILL_DOCUMENT_CANVAS_INLINE_GUTTER_PX);
      const nextScale = clampSkillDocumentScale(availableWidth / SKILL_DOCUMENT_A4_WIDTH_PX);
      setSkillDocumentScale((current) => (
        Math.abs(current - nextScale) < 0.005 ? current : nextScale
      ));
    };
    const scheduleUpdate = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateScale);
    };

    updateScale();
    const ResizeObserverConstructor = window.ResizeObserver;
    const observer = typeof ResizeObserverConstructor === "function"
      ? new ResizeObserverConstructor(scheduleUpdate)
      : null;
    observer?.observe(canvas);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [skillEditorOpen]);

  return (
    <ToolsHubShell aria-label="Global toolkit" data-section={section}>
      <ToolsHubHeader>
        <ToolsSectionNav aria-label="Tool sections" role="tablist">
          {SECTIONS.map((entry) => (
            <ToolsSectionButton
              aria-selected={section === entry.id}
              data-active={section === entry.id ? "true" : "false"}
              key={entry.id}
              onClick={() => setSection(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </ToolsSectionButton>
          ))}
        </ToolsSectionNav>
      </ToolsHubHeader>

      {section === "mcps" && (
        <ToolsMcpPane aria-label="MCP settings">
          {globalMcpDefaults.error && activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE && (
            <ToolsError role="alert">{globalMcpDefaults.error}</ToolsError>
          )}
          <ToolsHubFill>
            {mcpScopeReady && activeMcpWorkspace ? (
              <McpsWorkspaceView
                defaultWorkingDirectory={activeMcpRootDirectory || defaultWorkingDirectory}
                key={activeMcpScope}
                onScopeChange={setMcpScope}
                rootDirectory={activeMcpRootDirectory}
                scopeOptions={[
                  { value: GLOBAL_MCP_DEFAULTS_SCOPE, label: "Global defaults" },
                  ...workspaceOptions.map((workspaceOption) => ({
                    value: workspaceOption.id,
                    label: workspaceOption.name,
                  })),
                ]}
                scopeValue={activeMcpScope}
                workspace={activeMcpWorkspace}
              />
            ) : (
              <ToolsEmpty>
                {globalMcpDefaults.state === "error"
                  ? "The global MCP defaults store is unavailable."
                  : "Loading MCP scope…"}
              </ToolsEmpty>
            )}
          </ToolsHubFill>
        </ToolsMcpPane>
      )}

      {(section === "docs" || section === "clis") && (
        <ToolsScroll data-section={section}>
          <ToolsLayout data-section={section}>
            {section === "docs" && (
              <DocsWorkspaceSurface
                aria-label="Docs workspace"
                style={{ "--docs-explorer-offset": docsExplorerCollapsed ? "0px" : docsExplorerSize }}
              >
                {docsExplorerCollapsed && (
                  <DocsExplorerRestoreButton
                    aria-label="Show document explorer"
                    onClick={expandDocsExplorer}
                    title="Show document explorer"
                    type="button"
                  >
                    <span className="codicon codicon-layout-sidebar-left" aria-hidden="true" />
                    <span>Explorer</span>
                  </DocsExplorerRestoreButton>
                )}
                <DocsWorkspaceGrid
                  data-surface="files"
                  data-show-explorer={docsExplorerCollapsed ? "false" : "true"}
                  data-show-templates={showDocsTemplatesPane ? "true" : "false"}
                  key={`${docsCreateMode ? "docs-create" : "docs-edit"}-${docsExplorerCollapsed ? "explorer-hidden" : "explorer-visible"}-${showDocsTemplatesPane ? "templates-visible" : "templates-hidden"}`}
                  orientation="horizontal"
                >
                  {!docsExplorerCollapsed && (
                    <>
                      <ResizePanel
                        data-surface="files"
                        defaultSize={docsExplorerSize}
                        groupResizeBehavior="preserve-pixel-size"
                        id="docs-explorer"
                        maxSize="360px"
                        minSize="184px"
                        onResize={syncDocsExplorerCollapsedState}
                        panelRef={docsExplorerPanelRef}
                      >
                        <DocsFilesPane
                          aria-label="Document files"
                          data-collapsed="false"
                    >
                      <FileExplorerHeader>
                        <div>
                          <PanelKicker>Explorer</PanelKicker>
                        </div>
                        <FileExplorerActions>
                          <FileIconButton
                            aria-label="Refresh docs"
                            disabled={skillsState === "loading" || skillsState === "refreshing"}
                            onClick={() => void loadAccountTools({ showProgress: true })}
                            title="Refresh docs"
                            type="button"
                          >
                            <ButtonRefreshIcon aria-hidden="true" />
                          </FileIconButton>
                          <FileIconButton
                            aria-label="Collapse docs explorer"
                            onClick={collapseDocsExplorer}
                            title="Collapse docs explorer"
                            type="button"
                          >
                            <span
                              className="codicon codicon-chevron-left"
                              aria-hidden="true"
                            />
                          </FileIconButton>
                        </FileExplorerActions>
                      </FileExplorerHeader>
                      <>
                          <DocsRootPath title="Account documents">account-documents / personal</DocsRootPath>
                          <DocsExplorerSearchInput
                            aria-label="Search document files"
                            onChange={(event) => setSkillsQuery(event.target.value)}
                            placeholder="Search .md, .arch…"
                            type="search"
                            value={skillsQuery}
                          />
                          <FileTree aria-label="Account document explorer">
                            <FileTreeItem>
                              <DocsExplorerFolderButton
                                $depth={0}
                                as="div"
                                data-selected="false"
                              >
                                <FileDisclosure>
                                  <span className="codicon codicon-chevron-down" aria-hidden="true" />
                                </FileDisclosure>
                                <FileKindIcon data-file-tone="folder">
                                  <span className="codicon codicon-folder-opened" aria-hidden="true" />
                                </FileKindIcon>
                                <FileTreeName title="documents">documents</FileTreeName>
                                <DocsExplorerCount>{docFileRows.length || ""}</DocsExplorerCount>
                              </DocsExplorerFolderButton>
                              {docsExplorerRows.length ? (
                                docsExplorerRows.map((row) => {
                                  if (row.rowType === "folder") {
                                    return (
                                      <DocsExplorerFolderButton
                                        $depth={row.depth}
                                        as="div"
                                        data-selected="false"
                                        key={row.key}
                                        title={[row.pathKey, text(row.localPath)].filter(Boolean).join(" · ")}
                                      >
                                        <FileDisclosure>
                                          <span className="codicon codicon-chevron-down" aria-hidden="true" />
                                        </FileDisclosure>
                                        <FileKindIcon data-file-tone="folder">
                                          <span className="codicon codicon-folder-opened" aria-hidden="true" />
                                        </FileKindIcon>
                                        <FileTreeName title={row.pathKey}>{row.displayName}</FileTreeName>
                                        <DocsExplorerCount>{row.childCount || ""}</DocsExplorerCount>
                                      </DocsExplorerFolderButton>
                                    );
                                  }
                                  const active = selectedSkillKey === row.key
                                    || (row.isDraft && skillEditor?.documentKey && skillEditor.documentKey === row.storageKey);
                                  const iconClass = row.extension === "arch" ? "codicon-file-code" : "codicon-markdown";
                                  const fileTone = row.extension === "arch" ? "data" : "markdown";
                                  return (
                                    <DocsExplorerFileButton
                                      $depth={row.depth}
                                      data-selected={active ? "true" : "false"}
                                      key={row.key}
                                      onClick={() => {
                                        if (row.isDraft) {
                                          setSelectedSkillKey(text(row.selectedKey));
                                          setSkillEditor(documentEditorDraft(row));
                                        } else {
                                          setSelectedSkillKey(row.key);
                                          setSkillEditor(documentEditorDraft(row));
                                        }
                                      }}
                                      title={[row.displayName, row.pathKey, text(row.localPath)].filter(Boolean).join(" · ")}
                                      type="button"
                                    >
                                      <FileDisclosure />
                                      <FileKindIcon data-file-tone={fileTone}>
                                        <span className={`codicon ${iconClass}`} aria-hidden="true" />
                                      </FileKindIcon>
                                      <FileTreeName title={row.pathKey}>{row.displayName}</FileTreeName>
                                      <DocsExplorerStatus title={row.isDraft ? "Draft" : row.hydrating ? "Hydrating document" : row.pendingPush ? "Pending push" : row.typeLabel}>
                                        {row.hydrating ? (
                                          <DocsExplorerSpinner aria-label="Hydrating document" role="status" />
                                        ) : row.isDraft ? "DRAFT" : row.pendingPush ? "●" : ""}
                                      </DocsExplorerStatus>
                                    </DocsExplorerFileButton>
                                  );
                                })
                              ) : (
                                <FileTreeEmpty>{text(skillsQuery) ? "No matching docs." : "No docs saved yet."}</FileTreeEmpty>
                              )}
                            </FileTreeItem>
                          </FileTree>
                      </>
                        </DocsFilesPane>
                      </ResizePanel>

                      <ResizeHandle data-direction="horizontal" data-surface="files" />
                    </>
                  )}

                  <ResizePanel
                    data-surface="files"
                    id="docs-editor"
                    minSize="360px"
                  >
                    <DocsCenterPane aria-label="Document editor">
                  {skillsError && <ToolsError role="alert">{skillsError}</ToolsError>}
                  {skillEditor ? (
                    <>
                      <SkillDocumentEditor
                        aria-busy={selectedDocumentRefreshing ? "true" : "false"}
                        data-page-theme={skillEditorTheme}
                        data-refreshing={selectedDocumentRefreshing ? "true" : "false"}
                      >
                        <SkillDocumentToolbar>
                          <SkillDocumentToolbarControls data-side="left">
                            <SkillDocumentThemeSwitch aria-label="Document editor page theme">
                              {["dark", "light"].map((theme) => (
                                <SkillDocumentThemeButton
                                  aria-pressed={skillEditorTheme === theme}
                                  data-active={skillEditorTheme === theme ? "true" : "false"}
                                  key={theme}
                                  onClick={() => setSkillEditorTheme(theme)}
                                  type="button"
                                >
                                  {theme === "dark" ? "Dark" : "Light"}
                                </SkillDocumentThemeButton>
                              ))}
                            </SkillDocumentThemeSwitch>
                          </SkillDocumentToolbarControls>
                          <SkillDocumentToolbarControls data-side="right">
                            <SkillDocumentActions data-placement="toolbar">
                              <ToolsGhostButton
                                onClick={() => {
                                  setSkillEditor(null);
                                  setSelectedSkillKey("");
                                }}
                                type="button"
                              >
                                Close
                              </ToolsGhostButton>
                              {skillEditor.id && (
                                <ToolsGhostButton
                                  data-danger="true"
                                  disabled={skillEditorReadOnly}
                                  onClick={() => removeSkill(skillEditor.documentKey || accountDocumentStorageKey(skillEditor) || skillEditor.id)}
                                  type="button"
                                >
                                  Delete
                                </ToolsGhostButton>
                              )}
                              <ToolsGhostButton
                                disabled={!text(skillEditor.title) || skillEditorReadOnly}
                                onClick={() => void saveSkillEditor("local")}
                                type="button"
                              >
                                {skillsState === "savingLocal" ? "Saving locally…" : "Save Local"}
                              </ToolsGhostButton>
                              <ToolsPrimaryButton
                                disabled={!text(skillEditor.title) || skillEditorReadOnly}
                                onClick={() => void saveSkillEditor("push")}
                                type="button"
                              >
                                {skillsState === "saving" ? "Saving…" : "Save"}
                              </ToolsPrimaryButton>
                            </SkillDocumentActions>
                          </SkillDocumentToolbarControls>
                        </SkillDocumentToolbar>
                        <SkillDocumentCanvas ref={skillDocumentCanvasRef} style={skillDocumentMetricsStyle}>
                          {selectedDocumentRefreshing && (
                            <SkillDocumentRefreshOverlay role="status">
                              <DocsExplorerSpinner aria-hidden="true" />
                              <span>Refreshing document</span>
                            </SkillDocumentRefreshOverlay>
                          )}
                          <SkillDocumentPage onPointerDownCapture={clearDocumentSelection}>
                            <SkillDocumentTitleInput
                              aria-label="Document name"
                              readOnly={skillEditorReadOnly}
                              onChange={(event) => setSkillEditor((current) => ({ ...current, title: event.target.value }))}
                              placeholder="doc_name"
                              value={skillEditor.title}
                            />
                            <SkillDocumentBodyStack>
                              {preservedSkillEditorSelection?.active && (
                                <SkillDocumentSelectionOverlay aria-hidden="true">
                                  <span>{preservedSkillEditorSelection.before}</span>
                                  <SkillDocumentSelectionMark>{preservedSkillEditorSelection.selected}</SkillDocumentSelectionMark>
                                  <span>{preservedSkillEditorSelection.after}</span>
                                </SkillDocumentSelectionOverlay>
                              )}
                              <ToolsSkillsEditor
                                aria-label="Document content"
                                readOnly={skillEditorReadOnly}
                                onChange={(event) => {
                                  updateSkillEditorSelection(event);
                                  setSkillEditor((current) => ({ ...current, content: event.target.value }));
                                }}
                                onBlur={updateSkillEditorSelection}
                                onKeyUp={updateSkillEditorSelection}
                                onMouseUp={updateSkillEditorSelection}
                                onSelect={updateSkillEditorSelection}
                                onWheelCapture={scrollSkillDocumentCanvas}
                                placeholder={skillEditor.extension === "arch" ? "title System_Map" : "# Notes"}
                                rows={skillEditorRows}
                                spellCheck={false}
                                value={skillEditor.content}
                              />
                            </SkillDocumentBodyStack>
                          </SkillDocumentPage>
                        </SkillDocumentCanvas>
                      </SkillDocumentEditor>
                    </>
                  ) : (
                    <DocsCreateModal>
                      <DocsCreateHeader>
                        <div>
                          <ToolsPanelTitle>New doc</ToolsPanelTitle>
                          <DocsCreateFileName>
                            {text(newDocDraft.name)
                              ? `${skillSlug(newDocDraft.name)}.${documentTypeOption(newDocDraft.type).extension}`
                              : `untitled.${documentTypeOption(newDocDraft.type).extension}`}
                          </DocsCreateFileName>
                        </div>
                        <ToolsStatusPill data-tone={skillsStatusTone}>
                          {skillsStatusLabel}
                        </ToolsStatusPill>
                      </DocsCreateHeader>
                      <DocsCreateFields>
                        <DocsField>
                          <label htmlFor="tools-doc-name">Name</label>
                          <input
                            autoComplete="off"
                            id="tools-doc-name"
                            onChange={(event) => setNewDocDraft((current) => ({ ...current, name: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                startNewDocument();
                              }
                            }}
                            placeholder="My_New_Doc"
                            value={newDocDraft.name}
                          />
                        </DocsField>
                        <DocsField>
                          <label htmlFor="tools-doc-type">Type</label>
                          <select
                            id="tools-doc-type"
                            onChange={(event) => setNewDocDraft((current) => ({ ...current, type: event.target.value }))}
                            value={newDocDraft.type}
                          >
                            {DOCUMENT_TYPE_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </DocsField>
                      </DocsCreateFields>
                      <ToolsPrimaryButton
                        disabled={!text(newDocDraft.name)}
                        onClick={startNewDocument}
                        type="button"
                      >
                        Create
                      </ToolsPrimaryButton>
                    </DocsCreateModal>
                  )}
                    </DocsCenterPane>
                  </ResizePanel>

                  {showDocsTemplatesPane && (
                    <>
                      <ResizeHandle data-direction="horizontal" data-surface="files" />
                      <ResizePanel
                        data-surface="files"
                        defaultSize="282px"
                        groupResizeBehavior="preserve-pixel-size"
                        id="docs-defaults"
                        maxSize="340px"
                        minSize="238px"
                      >
                        <DocsTemplatesPane aria-label="Default skills">
                  <DocsPaneHeader>
                    <div>
                      <DocsPaneKicker>Defaults</DocsPaneKicker>
                      <DocsPaneTitle>Skills</DocsPaneTitle>
                    </div>
                  </DocsPaneHeader>
                  <DocsSearchInput
                    aria-label="Search default skills"
                    onChange={(event) => setTemplateQuery(event.target.value)}
                    placeholder="Search defaults…"
                    type="search"
                    value={templateQuery}
                  />
                  <DocsTemplateList role="list">
                    {defaultSkillRows.map((row) => (
                      <DocsTemplateRow
                        data-added={row.added ? "true" : "false"}
                        key={row.id}
                        role="listitem"
                      >
                        <SkillRowIcon
                          aria-hidden="true"
                          style={{ "--skill-color": skillToneColor(row.tone, row.title) }}
                        >
                          <SkillIconGlyph icon={row.icon} title={row.title} />
                        </SkillRowIcon>
                        <DocsTemplateCopy>
                          <strong>{row.defaultFileName}</strong>
                          <span>{row.description}</span>
                        </DocsTemplateCopy>
                        <CliRowButton
                          disabled={row.added || skillsState === "saving"}
                          onClick={() => addCatalogSkill(row)}
                          type="button"
                        >
                          {row.added ? "Added" : "Add"}
                        </CliRowButton>
                      </DocsTemplateRow>
                    ))}
                    {!defaultSkillRows.length && (
                      <ToolsEmpty>No default skills match.</ToolsEmpty>
                    )}
                  </DocsTemplateList>
                        </DocsTemplatesPane>
                      </ResizePanel>
                    </>
                  )}
                </DocsWorkspaceGrid>
                <ToolsHydrationProgress placement="docs-floating" progress={skillsHydration} />
              </DocsWorkspaceSurface>
            )}

            {section === "clis" && (
              <ToolsPanel aria-label="CLIs">
                <CliSearchRow>
                  <CliSearchInput
                    aria-label="Search CLIs by name"
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Search CLIs…"
                    type="search"
                    value={catalogQuery}
                  />
                  <ToolsGhostButton
                    disabled={cliState === "loading" || cliState === "refreshing"}
                    onClick={() => void refreshCliStatuses()}
                    title="Re-check installed CLIs"
                    type="button"
                  >
                    {cliState === "refreshing" ? "Checking…" : "Refresh"}
                  </ToolsGhostButton>
                </CliSearchRow>
                {cliError && <ToolsError role="alert">{cliError}</ToolsError>}
                {cliMessage && <ToolsNotice>{cliMessage}</ToolsNotice>}
                {cliState === "loading" ? (
                  <ToolsEmpty>Checking installed CLIs…</ToolsEmpty>
                ) : (
                  <CliList aria-label="CLI programs" role="list">
                    {cliRows.map((row) => {
                      const Icon = row.icon;
                      return (
                        <CliRow
                          data-installed={row.installed ? "true" : "false"}
                          key={row.id}
                          role="listitem"
                        >
                          <CliRowIcon aria-hidden="true">
                            {Icon ? <Icon /> : <span>{row.label.slice(0, 1).toUpperCase()}</span>}
                          </CliRowIcon>
                          <CliRowName>
                            <strong>{row.label}</strong>
                            {row.sub && <span>{row.sub}</span>}
                          </CliRowName>
                          <CliRowState>
                            {row.busyAction ? (
                              <CliStateText data-tone="busy">
                                {row.busyAction === "install"
                                  ? "Installing…"
                                  : row.busyAction === "update"
                                    ? "Updating…"
                                    : "Uninstalling…"}
                              </CliStateText>
                            ) : row.installed ? (
                              <>
                                <CliRowButton
                                  data-danger="true"
                                  data-hover-only="true"
                                  onClick={() => handleCliRowAction(row, "uninstall")}
                                  type="button"
                                >
                                  Uninstall
                                </CliRowButton>
                                {row.updateAvailable && (
                                  <CliRowButton
                                    onClick={() => handleCliRowAction(row, "update")}
                                    type="button"
                                  >
                                    Update
                                  </CliRowButton>
                                )}
                                <CliStateText data-tone="good">
                                  {row.version ? `Installed · ${row.version}` : "Installed"}
                                </CliStateText>
                              </>
                            ) : row.manageable ? (
                              <>
                                <CliRowButton
                                  data-hover-only="true"
                                  onClick={() => handleCliRowAction(row, "install")}
                                  type="button"
                                >
                                  Install
                                </CliRowButton>
                                <CliStateText data-tone="muted">Not installed</CliStateText>
                              </>
                            ) : (
                              <CliStateText
                                data-tone="muted"
                                title="No managed installer for this device — install manually"
                              >
                                Not installed
                              </CliStateText>
                            )}
                          </CliRowState>
                        </CliRow>
                      );
                    })}
                    {!cliRows.length && (
                      <ToolsEmpty>{`No CLIs match "${text(catalogQuery)}".`}</ToolsEmpty>
                    )}
                  </CliList>
                )}
              </ToolsPanel>
            )}
          </ToolsLayout>
        </ToolsScroll>
      )}
    </ToolsHubShell>
  );
}

const ToolsHubShell = styled.section`
  --tools-border: rgba(230, 236, 245, 0.1);
  --tools-border-subtle: rgba(230, 236, 245, 0.06);
  --tools-bg:
    radial-gradient(circle at 78% 8%, rgba(var(--forge-accent-rgb), 0.095), transparent 18rem),
    linear-gradient(90deg, rgba(230, 236, 245, 0.018) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.014) 1px, transparent 1px),
    rgba(4, 7, 12, 0.94);
  --tools-header-bg: rgba(5, 8, 13, 0.96);
  --tools-panel-bg: rgba(9, 13, 20, 0.72);
  --tools-panel-bg-strong: rgba(8, 11, 16, 0.84);
  --tools-editor-bg: rgba(6, 9, 14, 0.88);
  --tools-control-bg: rgba(7, 9, 13, 0.66);
  --tools-control-bg-soft: rgba(230, 236, 245, 0.05);
  --tools-input-bg: rgba(5, 8, 13, 0.78);
  --tools-template-bg: rgba(3, 6, 10, 0.34);
  --tools-progress-bg: linear-gradient(180deg, rgba(20, 29, 44, 0.92), rgba(10, 15, 24, 0.92));
  --tools-progress-error-bg: linear-gradient(180deg, rgba(49, 24, 24, 0.94), rgba(20, 12, 14, 0.94));
  --tools-doc-desk: linear-gradient(180deg, rgba(12, 16, 24, 0.96), rgba(5, 8, 13, 0.98));
  --tools-doc-page: #0d1118;
  --tools-doc-page-border: rgba(230, 236, 245, 0.1);

  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--forge-text);
  background: var(--tools-bg);
  background-size: auto, 68px 68px, 68px 68px, auto;

  html[data-forge-space="loopspaces"] & {
    --tools-border: rgba(255, 209, 102, 0.14);
    --tools-border-subtle: rgba(255, 209, 102, 0.075);
    --tools-bg:
      radial-gradient(circle at 76% 8%, rgba(var(--forge-accent-rgb), 0.15), transparent 18rem),
      radial-gradient(circle at 28% 96%, rgba(var(--forge-accent-soft-rgb), 0.055), transparent 20rem),
      linear-gradient(90deg, rgba(var(--forge-accent-soft-rgb), 0.03) 1px, transparent 1px),
      linear-gradient(180deg, rgba(var(--forge-accent-soft-rgb), 0.022) 1px, transparent 1px),
      rgba(5, 4, 2, 0.96);
    --tools-header-bg: rgba(8, 5, 2, 0.96);
    --tools-panel-bg: rgba(14, 10, 5, 0.74);
    --tools-panel-bg-strong: rgba(12, 8, 4, 0.86);
    --tools-editor-bg: rgba(8, 6, 3, 0.9);
    --tools-control-bg: rgba(12, 8, 4, 0.72);
    --tools-control-bg-soft: rgba(var(--forge-accent-soft-rgb), 0.055);
    --tools-input-bg: rgba(8, 6, 3, 0.8);
    --tools-template-bg: rgba(9, 6, 3, 0.42);
    --tools-progress-bg: linear-gradient(180deg, rgba(37, 26, 10, 0.94), rgba(13, 9, 4, 0.94));
    --tools-progress-error-bg: linear-gradient(180deg, rgba(49, 24, 24, 0.94), rgba(20, 12, 14, 0.94));
    --tools-doc-desk: linear-gradient(180deg, rgba(18, 12, 5, 0.96), rgba(5, 4, 2, 0.98));
    --tools-doc-page: #100d08;
    --tools-doc-page-border: rgba(255, 209, 102, 0.14);
  }

  html[data-forge-theme="light"] & {
    --tools-border: rgba(0, 0, 0, 0.1);
    --tools-border-subtle: rgba(0, 0, 0, 0.065);
    --tools-bg:
      linear-gradient(180deg, rgba(var(--forge-accent-rgb), 0.045), transparent 22rem),
      var(--forge-bg, #f5f5f7);
    --tools-header-bg: rgba(255, 255, 255, 0.88);
    --tools-panel-bg: rgba(255, 255, 255, 0.86);
    --tools-panel-bg-strong: #ffffff;
    --tools-editor-bg: #f5f5f7;
    --tools-control-bg: rgba(255, 255, 255, 0.78);
    --tools-control-bg-soft: rgba(var(--forge-accent-rgb), 0.075);
    --tools-input-bg: #ffffff;
    --tools-template-bg: rgba(255, 255, 255, 0.72);
    --tools-progress-bg: linear-gradient(180deg, #ffffff, #f5f7fb);
    --tools-progress-error-bg: linear-gradient(180deg, #fff5f5, #fffafa);
    --tools-doc-desk: linear-gradient(180deg, #eef2f7, #dbe3ed);
    --tools-doc-page: #fffdf8;
    --tools-doc-page-border: rgba(29, 29, 31, 0.14);
  }
`;

const ToolsHubHeader = styled.header`
  z-index: 30;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 48px;
  overflow: hidden;
  padding: 6px 10px;
  border-bottom: 1px solid var(--tools-border, rgba(230, 236, 245, 0.08));
  background: var(--tools-header-bg);
  backdrop-filter: blur(12px);
`;

const ToolsHubFill = styled.div`
  position: relative;
  z-index: 0;
  display: grid;
  /* Explicit bounded row: without it the implicit auto row sizes to content,
     the child's height:100% resolves as auto, and the inner scroll pane gets
     clipped instead of scrolling (the "can't scroll the MCP list" bug). */
  grid-template-rows: minmax(0, 1fr);
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ToolsHubStack = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;

  &[data-has-progress="true"] {
    grid-template-rows: auto minmax(0, 1fr);
  }

  > * {
    min-width: 0;
    min-height: 0;
  }
`;

const ToolsScroll = styled.div`
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overflow-anchor: none;
  scrollbar-gutter: stable;
  padding: 14px 16px 24px;

  &[data-section="docs"] {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    max-height: 100%;
    overflow: hidden;
    padding: 0;
  }
`;

const ToolsHydrationPanel = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.22);
  border-radius: 8px;
  background: var(--tools-progress-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  &[data-placement="hub"],
  &[data-placement="editor"] {
    margin: 10px 10px 0;
  }

  &[data-placement="docs-floating"] {
    position: absolute;
    left: calc(var(--docs-explorer-offset, 0px) + 14px);
    bottom: 12px;
    z-index: 60;
    width: min(320px, calc(100% - var(--docs-explorer-offset, 0px) - 28px));
    gap: 5px;
    padding: 7px 8px;
    border-radius: 7px;
    pointer-events: none;
    box-shadow:
      0 16px 34px rgba(0, 0, 0, 0.36),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  &[data-placement="docs-floating"] strong {
    font-size: 10px;
  }

  &[data-placement="docs-floating"] span {
    font-size: 9px;
  }

  &[data-state="error"] {
    border-color: rgba(255, 132, 119, 0.34);
    background: var(--tools-progress-error-bg);
  }

  &[data-state="ready"] {
    border-color: rgba(113, 214, 151, 0.28);
  }
`;

const ToolsHydrationCopy = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 12px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text, #f4f7fa);
    font-size: 11px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    font-weight: 720;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ToolsHydrationTrack = styled.div`
  position: relative;
  height: 5px;
  min-width: 0;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);

  ${ToolsHydrationPanel}[data-placement="docs-floating"] & {
    height: 3px;
  }
`;

const ToolsHydrationFill = styled.div`
  height: 100%;
  min-width: 4px;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--forge-accent-soft, #7db0ff), #8fe0aa);
  transition: width 180ms ease;
`;

const ToolsMcpPane = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  /* McpWorkspaceSurface carries its own padding; doubling it up left a wide
     dead band around the whole MCPs tab. */
  padding: 0;
`;

const ToolsLayout = styled.section`
  display: grid;
  align-content: start;
  width: min(1080px, 100%);
  justify-self: center;
  margin: 0 auto;
  gap: 12px;
  min-width: 0;

  &[data-section="docs"] {
    grid-template-rows: minmax(0, 1fr);
    align-content: stretch;
    width: 100%;
    height: 100%;
    max-height: 100%;
    min-height: 0;
    margin: 0;
    gap: 0;
    overflow: hidden;
  }
`;

const ToolsSectionNav = styled.nav`
  display: inline-flex;
  align-items: stretch;
  flex: 0 0 auto;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding: 3px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.1));
  border-radius: 9px;
  background: var(--tools-control-bg);

  &::-webkit-scrollbar {
    display: none;
  }
`;

const ToolsSectionButton = styled.button`
  position: relative;
  flex: 0 0 auto;
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 11px;
  font-weight: 760;
  cursor: pointer;
  white-space: nowrap;

  &[data-active="true"] {
    color: var(--forge-text, #f4f7fa);
    background: rgba(var(--forge-accent-soft-rgb), 0.14);
  }

  &:hover:not([data-active="true"]) {
    color: var(--forge-text-soft, #b6c0cc);
  }
`;

const ToolsPanel = styled.section`
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.1));
  border-radius: 10px;
  background: var(--tools-panel-bg);

  &[data-mode="editor"] {
    gap: 0;
    padding: 0;
    overflow: hidden;
    background: var(--tools-panel-bg-strong);
  }
`;

const DocsWorkspaceSurface = styled(FilesWorkspaceSurface)`
  --files-vscode-sidebar: var(--tools-panel-bg-strong);
  --files-vscode-editor: var(--tools-editor-bg);
  --files-vscode-editor-gutter: var(--tools-panel-bg);
  --files-vscode-tab: var(--tools-control-bg);
  --files-vscode-tab-active: var(--tools-editor-bg);
  --files-vscode-border: var(--tools-border);
  --files-vscode-border-subtle: var(--tools-border-subtle);
  --files-vscode-hover: rgba(var(--forge-accent-rgb), 0.1);
  --files-vscode-selection: rgba(var(--forge-accent-rgb), 0.25);
  --files-vscode-selection-inactive: rgba(var(--forge-accent-rgb), 0.08);
  --files-vscode-blue: var(--forge-accent-soft);
  --files-vscode-focus: var(--forge-accent);

  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: var(--tools-bg);
`;

const DocsWorkspaceGrid = styled(ResizePanelGroup)`
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
`;

const DocsExplorerRestoreButton = styled.button`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 70;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  max-width: 156px;
  padding: 0 10px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 7px;
  color: var(--forge-text-soft, #b6c0cc);
  background: var(--tools-control-bg);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
  font: inherit;
  font-size: 11px;
  font-weight: 760;
  line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition: border-color 140ms ease, color 140ms ease, background 140ms ease, transform 140ms ease;

  span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover,
  &:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.36);
    color: var(--forge-accent-soft, #7db0ff);
    background: rgba(var(--forge-accent-rgb), 0.14);
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-accent-soft-rgb), 0.32);
    outline-offset: 2px;
  }
`;

const DocsPaneBase = styled.aside`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--files-vscode-border);
  border-radius: 0;
  background: var(--tools-panel-bg);
`;

const DocsFilesPane = styled(FileExplorerPane)`
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  border-right: 0;

  &[data-collapsed="true"] {
    grid-template-rows: auto minmax(0, 1fr);
  }

  &[data-collapsed="true"] ${FileExplorerHeader} {
    min-height: 36px;
    justify-content: center;
    padding: 0;
  }

  &[data-collapsed="true"] ${FileExplorerActions} {
    justify-content: center;
    width: 100%;
  }
`;

const DocsTemplatesPane = styled(DocsPaneBase)`
  display: flex;
  flex-direction: column;
  align-self: stretch;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
`;

const DocsRootPath = styled(FileRootPath)`
  padding-right: 10px;
`;

const DocsExplorerSearchInput = styled.input`
  width: calc(100% - 16px);
  min-width: 0;
  height: 26px;
  margin: 6px 8px;
  padding: 0 8px;
  border: 1px solid var(--files-vscode-border);
  border-radius: 4px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-editor);
  font-size: 11px;
  outline: none;

  &::placeholder {
    color: var(--files-vscode-text-muted);
  }

  &:focus-visible {
    border-color: var(--files-vscode-focus);
    box-shadow: 0 0 0 1px var(--files-vscode-focus);
  }
`;

const DocsExplorerFolderButton = styled(FileTreeButton)`
  cursor: default;
`;

const DocsExplorerFileButton = styled(FileTreeButton)`
  cursor: pointer;
`;

const DocsExplorerCount = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--files-vscode-text-muted);
  font-size: 10px;
  font-weight: 650;
  line-height: 22px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const docsExplorerSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const DocsExplorerStatus = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #e2c08d;
  font-size: 10px;
  line-height: 22px;
  text-align: center;
`;

const DocsExplorerSpinner = styled.span`
  width: 11px;
  height: 11px;
  border: 2px solid rgba(var(--forge-accent-soft-rgb), 0.18);
  border-top-color: var(--forge-accent-soft, #7db0ff);
  border-radius: 999px;
  animation: ${docsExplorerSpin} 740ms linear infinite;
`;

const DocsCenterPane = styled.section`
  position: relative;
  display: grid;
  align-content: stretch;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  border: 0;
  border-right: 1px solid var(--files-vscode-border);
  border-radius: 0;
  background: var(--tools-editor-bg);

  ${DocsWorkspaceGrid}[data-show-templates="false"] & {
    border-right: 0;
  }
`;

const DocsPaneHeader = styled.header`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 14px 14px 8px;
`;

const DocsPaneKicker = styled.div`
  margin-bottom: 2px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const DocsPaneTitle = styled.div`
  overflow: hidden;
  color: var(--forge-text, #f4f7fa);
  font-size: 13px;
  font-weight: 820;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ToolsSearchInput = styled.input`
  width: min(220px, 100%);
  padding: 7px 11px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  color: var(--forge-text, #f4f7fa);
  background: var(--tools-input-bg);
  font-size: 12px;

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-accent-soft-rgb), 0.35);
    outline-offset: -1px;
  }
`;

const DocsSearchInput = styled(ToolsSearchInput)`
  flex: 0 0 auto;
  width: calc(100% - 28px);
  margin: 8px 14px 14px;
`;

const DocsCreateModal = styled.div`
  grid-row: 2;
  align-self: start;
  justify-self: center;
  display: grid;
  gap: 14px;
  width: min(420px, calc(100% - 28px));
  min-width: 0;
  max-height: calc(100% - 56px);
  margin-top: 28px;
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  background: var(--tools-panel-bg-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
`;

const DocsCreateHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
`;

const DocsCreateFileName = styled.div`
  overflow: hidden;
  color: var(--forge-text-muted, #7a8493);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DocsCreateFields = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 10px;
  min-width: 0;
`;

const DocsField = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;

  label {
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.13));
    border-radius: 7px;
    color: var(--forge-text, #f4f7fa);
    background: var(--tools-input-bg);
    color-scheme: var(--forge-color-scheme, dark);
    font-size: 12px;
    font-weight: 650;
    outline: none;
  }

  input {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  }

  input:focus-visible,
  select:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.44);
    box-shadow: 0 0 0 2px rgba(var(--forge-accent-rgb), 0.14);
  }
`;

const DocTypeSelect = styled.select`
  height: 28px;
  max-width: 138px;
  min-width: 112px;
  padding: 0 9px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 7px;
  color: var(--forge-text-soft, #b6c0cc);
  background: var(--tools-control-bg);
  color-scheme: var(--forge-color-scheme, dark);
  font-size: 10.5px;
  font-weight: 760;
  outline: none;
`;

const DocsTemplateList = styled.div`
  display: grid;
  align-content: start;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 12px;
  scrollbar-gutter: stable;
  border-top: 1px solid var(--tools-border-subtle, rgba(230, 236, 245, 0.07));
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
  background: var(--tools-template-bg);
`;

const DocsTemplateRow = styled.div`
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 50px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--tools-border-subtle, rgba(230, 236, 245, 0.05));

  &:last-child {
    border-bottom: 0;
  }

  &[data-added="true"] {
    opacity: 0.64;
  }
`;

const DocsTemplateCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong {
    overflow: hidden;
    color: var(--forge-text, #f4f7fa);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 11px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    display: -webkit-box;
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    line-height: 1.25;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
`;

const ToolsPanelTitle = styled.h3`
  margin: 0 0 3px;
  font-size: 14px;
  font-weight: 800;
`;

const ToolsPanelHint = styled.p`
  margin: 0;
  max-width: 560px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 12px;
`;

const ToolsStatusPill = styled.span`
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  overflow: hidden;
  padding: 4px 10px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 999px;
  color: var(--forge-text-soft, #b6c0cc);
  font-size: 10px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-tone="good"] {
    border-color: rgba(60, 203, 127, 0.25);
    color: rgba(140, 230, 180, 0.95);
  }

  &[data-tone="warn"] {
    border-color: rgba(223, 165, 90, 0.3);
    color: rgba(240, 200, 140, 0.95);
  }

  &[data-tone="muted"] {
    color: var(--forge-text-muted, #7a8493);
  }

  html[data-forge-theme="light"] &[data-tone="good"] {
    border-color: rgba(10, 127, 69, 0.28);
    color: #0a7f45;
    background: rgba(10, 127, 69, 0.06);
  }

  html[data-forge-theme="light"] &[data-tone="warn"] {
    border-color: rgba(139, 90, 0, 0.28);
    color: #8b5a00;
    background: rgba(139, 90, 0, 0.06);
  }
`;

const SkillDocumentEditor = styled.div`
  --skill-editor-desk: var(--tools-doc-desk);
  --skill-editor-page: var(--tools-doc-page);
  --skill-editor-page-border: var(--tools-doc-page-border);
  --skill-editor-page-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
  --skill-editor-page-text: #e8edf5;
  --skill-editor-page-muted: #778396;
  --skill-editor-page-placeholder: rgba(119, 131, 150, 0.72);
  --skill-editor-page-rule: rgba(230, 236, 245, 0.08);

  display: grid;
  grid-row: 2;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--tools-editor-bg);

  &[data-page-theme="light"] {
    --skill-editor-desk: linear-gradient(180deg, #dfe6ef, #cbd5e1);
    --skill-editor-page: #fffdf8;
    --skill-editor-page-border: rgba(40, 50, 65, 0.16);
    --skill-editor-page-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
    --skill-editor-page-text: #1c2430;
    --skill-editor-page-muted: #647084;
    --skill-editor-page-placeholder: rgba(100, 112, 132, 0.68);
    --skill-editor-page-rule: rgba(30, 41, 59, 0.14);
  }
`;

const SkillDocumentToolbar = styled.div`
  display: flex;
  position: relative;
  z-index: 5;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--tools-border, rgba(230, 236, 245, 0.08));
  background: var(--tools-control-bg);
`;

const SkillDocumentToolbarCopy = styled.div`
  display: grid;
  flex: 1 1 320px;
  min-width: 0;
  gap: 2px;
`;

const SkillDocumentToolbarControls = styled.div`
  display: flex;
  flex: 0 1 auto;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-width: 0;

  &[data-side="right"] {
    justify-content: flex-end;
    overflow-x: auto;
    scrollbar-width: none;
  }

  &[data-side="right"]::-webkit-scrollbar {
    display: none;
  }
`;

const SkillDocumentThemeSwitch = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  background: var(--tools-control-bg);
`;

const SkillDocumentThemeButton = styled.button`
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 10px;
  font-weight: 780;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text, #f4f7fa);
    background: rgba(var(--forge-accent-soft-rgb), 0.16);
  }

  &:hover:not([data-active="true"]) {
    color: var(--forge-text-soft, #b6c0cc);
  }
`;

const SkillDocumentCanvas = styled.div`
  display: grid;
  position: relative;
  align-content: start;
  justify-items: center;
  box-sizing: border-box;
  height: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px 24px max(72px, var(--skill-document-page-padding-bottom, 76px));
  scroll-padding-bottom: 112px;
  scrollbar-gutter: stable;
  background: var(--skill-editor-desk);
`;

const SkillDocumentRefreshOverlay = styled.div`
  display: inline-flex;
  position: sticky;
  top: 10px;
  z-index: 4;
  align-items: center;
  gap: 8px;
  justify-self: center;
  margin-bottom: 10px;
  padding: 7px 10px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.22);
  border-radius: 999px;
  color: var(--forge-text-soft, #b6c0cc);
  background: color-mix(in srgb, var(--tools-control-bg) 88%, transparent);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0;
  pointer-events: none;
`;

const SkillDocumentPage = styled.div`
  display: grid;
  align-content: start;
  box-sizing: border-box;
  width: var(--skill-document-page-width, 794px);
  min-height: var(--skill-document-page-height, 1123px);
  aspect-ratio: 210 / 297;
  padding:
    var(--skill-document-page-padding-top, 52px)
    var(--skill-document-page-padding-inline, 58px)
    var(--skill-document-page-padding-bottom, 76px);
  border: 1px solid var(--skill-editor-page-border);
  border-radius: 4px;
  color: var(--skill-editor-page-text);
  background: var(--skill-editor-page);
  box-shadow: var(--skill-editor-page-shadow);
  transition:
    filter 140ms ease,
    opacity 140ms ease;

  ${SkillDocumentEditor}[data-refreshing="true"] & {
    filter: grayscale(0.28);
    opacity: 0.58;
  }
`;

const SkillDocumentTitleInput = styled.input`
  width: 100%;
  min-width: 0;
  padding: 0 0 var(--skill-document-title-padding-bottom, 7px);
  border: 0;
  border-bottom: 1px solid var(--skill-editor-page-rule);
  color: var(--skill-editor-page-text);
  background: transparent;
  font-family: ui-serif, Georgia, "Times New Roman", serif;
  font-size: var(--skill-document-title-font-size, 30px);
  font-weight: 760;
  line-height: 1.18;
  outline: none;

  &::placeholder {
    color: var(--skill-editor-page-placeholder);
  }

  &:read-only {
    cursor: default;
  }
`;

const SkillDocumentBodyStack = styled.div`
  position: relative;
  display: grid;
  width: calc(100% + var(--skill-document-body-bleed, 20px));
  min-width: 0;
  min-height: var(--skill-document-body-min-height, 900px);
  margin-top: var(--skill-document-body-margin-top, 24px);
  margin-left: var(--skill-document-body-margin-left, -10px);

  > * {
    grid-area: 1 / 1;
  }
`;

const SkillDocumentSelectionOverlay = styled.div`
  position: relative;
  z-index: 0;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: var(--skill-document-body-min-height, 900px);
  padding:
    var(--skill-document-body-padding-top, 8px)
    var(--skill-document-body-padding-inline, 10px)
    var(--skill-document-body-padding-bottom, 24px);
  border-radius: 8px;
  color: transparent;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: var(--skill-document-body-font-size, 15px);
  font-weight: 520;
  line-height: 1.72;
  overflow: hidden;
  overflow-wrap: anywhere;
  pointer-events: none;
  white-space: pre-wrap;
`;

const SkillDocumentSelectionMark = styled.span`
  border-radius: 4px;
  background: rgba(var(--forge-accent-soft-rgb), 0.24);
  box-shadow:
    0 0 0 1px rgba(var(--forge-accent-soft-rgb), 0.16),
    0 0 0 3px rgba(var(--forge-accent-soft-rgb), 0.055);
`;

const ToolsSkillsEditor = styled.textarea`
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: var(--skill-document-body-min-height, 900px);
  padding:
    var(--skill-document-body-padding-top, 8px)
    var(--skill-document-body-padding-inline, 10px)
    var(--skill-document-body-padding-bottom, 24px);
  border: 0;
  border-radius: 8px;
  color: var(--skill-editor-page-text);
  background: transparent;
  caret-color: var(--forge-accent-soft, #7db0ff);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: var(--skill-document-body-font-size, 15px);
  font-weight: 520;
  line-height: 1.72;
  outline: none;
  overflow: hidden;
  resize: none;
  transition:
    background 140ms ease,
    box-shadow 140ms ease;

  &:focus-visible {
    background: rgba(var(--forge-accent-soft-rgb), 0.035);
    box-shadow: inset 0 0 0 1px rgba(var(--forge-accent-soft-rgb), 0.1);
  }

  &::selection {
    background: rgba(var(--forge-accent-soft-rgb), 0.28);
  }

  &::placeholder {
    color: var(--skill-editor-page-placeholder);
  }

  &:read-only {
    caret-color: transparent;
    cursor: default;
  }
`;

const SkillDocumentActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--tools-border, rgba(230, 236, 245, 0.08));
  background: var(--tools-control-bg);

  &[data-placement="toolbar"] {
    flex-wrap: nowrap;
    align-items: center;
    overflow: visible;
    padding: 0;
    border-top: 0;
    background: transparent;
  }

  &[data-placement="toolbar"] button {
    height: 31px;
    padding: 0 12px;
    white-space: nowrap;
  }
`;

const ToolsPrimaryButton = styled.button`
  padding: 8px 16px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.35);
  border-radius: 8px;
  color: var(--forge-accent-soft, rgba(200, 222, 255, 0.98));
  background: rgba(var(--forge-accent-rgb), 0.18);
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(var(--forge-accent-rgb), 0.3);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const ToolsGhostButton = styled.button`
  padding: 8px 14px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  color: var(--forge-text-soft, #b6c0cc);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--forge-text, #f4f7fa);
    border-color: rgba(230, 236, 245, 0.24);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }

  &[data-danger="true"] {
    border-color: rgba(239, 107, 107, 0.3);
    color: rgba(250, 180, 180, 0.92);
  }

  &[data-danger="true"]:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.5);
    color: rgba(255, 205, 205, 1);
    background: rgba(127, 29, 29, 0.18);
  }
`;

const ToolsError = styled.p`
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(239, 107, 107, 0.3);
  border-radius: 8px;
  color: rgba(255, 200, 200, 0.95);
  background: rgba(60, 14, 18, 0.4);
  font-size: 12px;
  font-weight: 600;
`;

const ToolsNotice = styled.p`
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(60, 203, 127, 0.25);
  border-radius: 8px;
  color: rgba(170, 235, 200, 0.95);
  background: rgba(10, 40, 25, 0.35);
  font-size: 12px;
  font-weight: 600;
`;

const ToolsEmpty = styled.p`
  margin: 0;
  align-self: center;
  justify-self: center;
  color: var(--forge-text-muted, #7a8493);
  font-size: 12px;
`;

// --- Minimalist CLI list (installed-programs style) ------------------------

const CliSearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CliSearchInput = styled(ToolsSearchInput)`
  flex: 1 1 auto;
  width: 100%;
`;

const CliList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.08));
  border-radius: 9px;
  background: var(--tools-panel-bg);
`;

const CliRow = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--tools-border-subtle, rgba(230, 236, 245, 0.05));

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--tools-control-bg-soft);
  }

  /* Install/Uninstall affordances stay hidden until the row is hovered, so
     the resting view is just icon + name + state. */
  [data-hover-only="true"] {
    opacity: 0;
    pointer-events: none;
    transition: opacity 110ms ease;
  }

  &:hover [data-hover-only="true"],
  &:focus-within [data-hover-only="true"] {
    opacity: 1;
    pointer-events: auto;
  }
`;

const CliRowIcon = styled.span`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 6px;
  color: var(--forge-text-soft, #b6c0cc);
  background: rgba(230, 236, 245, 0.06);

  svg {
    width: 14px;
    height: 14px;
  }

  span {
    font-size: 11px;
    font-weight: 800;
  }
`;

const CliRowName = styled.div`
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;

  strong {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const CliRowState = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const cliBusyPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
`;

const CliStateText = styled.span`
  color: var(--forge-text-muted, #7a8493);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;

  &[data-tone="good"] {
    color: rgba(140, 230, 180, 0.95);
  }

  &[data-tone="busy"] {
    color: rgba(240, 200, 140, 0.95);
    animation: ${cliBusyPulse} 1.2s ease-in-out infinite;
  }
`;

const CliRowButton = styled.button`
  padding: 3px 9px;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.3);
  border-radius: 6px;
  color: var(--forge-accent-soft, rgba(200, 222, 255, 0.95));
  background: rgba(var(--forge-accent-rgb), 0.12);
  font-size: 10.5px;
  font-weight: 750;
  cursor: pointer;

  &:hover {
    background: rgba(var(--forge-accent-rgb), 0.24);
  }

  &[data-danger="true"] {
    border-color: rgba(239, 107, 107, 0.3);
    color: rgba(250, 180, 180, 0.92);
    background: transparent;
  }

  &[data-danger="true"]:hover {
    background: rgba(127, 29, 29, 0.2);
  }
`;

// --- Skills library (list + detail) ----------------------------------------


const SkillsList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.08));
  border-radius: 9px;
  background: var(--tools-panel-bg);
`;

const SkillRow = styled.button`
  display: grid;
  width: 100%;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 6px 10px;
  border: 0;
  border-bottom: 1px solid var(--tools-border-subtle, rgba(230, 236, 245, 0.05));
  color: var(--forge-text, #f4f7fa);
  background: transparent;
  cursor: pointer;
  text-align: left;

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--tools-control-bg-soft);
  }
`;

const SkillRowIcon = styled.span`
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  border-radius: 8px;
  color: var(--skill-color, #8ea0b8);
  background: color-mix(in srgb, var(--skill-color, #8ea0b8) 14%, transparent);

  svg {
    width: 16px;
    height: 16px;
  }

  .codicon {
    font-size: 16px;
  }

  > span:not(.codicon) {
    font-size: 13px;
    font-weight: 800;
  }
`;

const SkillRowCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 1px;

  strong {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const SkillRowSide = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const SkillRowChevron = styled.span`
  color: var(--forge-text-muted, #7a8493);
  font-size: 15px;
  font-weight: 700;
`;

const SkillSourceBadge = styled.span`
  padding: 2px 7px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.14));
  border-radius: 999px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 9.5px;
  font-weight: 780;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;

  &[data-source="catalog"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.3);
    color: var(--forge-accent-soft, rgba(180, 210, 255, 0.92));
  }

  &[data-source="cli"] {
    border-color: rgba(60, 203, 127, 0.3);
    color: rgba(150, 230, 185, 0.92);
  }

  &[data-source="pending"] {
    border-color: rgba(223, 165, 90, 0.32);
    color: rgba(240, 200, 140, 0.94);
  }
`;

const SkillDetailHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const SkillDetailActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const SkillDetailTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;

  > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong {
    font-size: 16px;
    font-weight: 800;
  }

  span {
    color: var(--forge-text-muted, #7a8493);
    font-size: 12px;
  }
`;

const SkillDetailMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 11px;
  font-weight: 650;
`;

const SkillContent = styled.pre`
  margin: 0;
  min-width: 0;
  overflow-x: auto;
  padding: 14px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.08));
  border-radius: 9px;
  color: var(--forge-text, #e8eef8);
  background: var(--tools-panel-bg-strong);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
`;
