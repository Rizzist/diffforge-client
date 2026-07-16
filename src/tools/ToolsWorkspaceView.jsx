import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import {
  ButtonRefreshIcon,
  ButtonBrowserIcon,
  FileDisclosure,
  FileContextMenu,
  FileContextMenuItem,
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
import AppSelect from "../app/AppSelect.jsx";
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
  documentMimeTypeForKind,
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
  getWorkspaceToolsDocumentDrafts,
  getWorkspaceToolsAccountSkills,
  hasWorkspaceToolsLoaded,
  noteAccountSkillUnits,
  setWorkspaceToolsDocumentDraft,
  subscribeWorkspaceTools,
} from "./workspaceToolsStore.js";
import {
  TOOLS_WINDOW_CLOSED_EVENT,
  TOOLS_WINDOW_CONTROL_CLOSE,
  TOOLS_WINDOW_CONTROL_DELETE,
  TOOLS_WINDOW_CONTROL_DISCARD,
  TOOLS_WINDOW_CONTROL_EVENT,
  TOOLS_WINDOW_CONTROL_FOCUS_MAIN,
  TOOLS_WINDOW_CONTROL_RETURN,
  TOOLS_WINDOW_CONTROL_RUN,
  TOOLS_WINDOW_CONTROL_SAVE_LOCAL,
  TOOLS_WINDOW_CONTROL_SAVE_PUSH,
  TOOLS_WINDOW_CONTROL_UPDATE,
  TOOLS_WINDOW_META_EVENT,
  TOOLS_WINDOW_META_REQUEST_EVENT,
} from "./toolsWindowBridge.js";

const SECTIONS = [
  { id: "docs", label: "Docs" },
  { id: "mcps", label: "MCPs" },
  { id: "clis", label: "CLIs" },
  { id: "scripts", label: "Scripts" },
];

export const GLOBAL_MCP_DEFAULTS_SCOPE = "global-defaults";
const GLOBAL_MCP_DEFAULTS_WORKSPACE_ID = "account-global-mcp-defaults";
const SKILL_EDITOR_THEME_STORAGE_KEY = "diffforge.tools.skillEditorTheme";
const ACCOUNT_DOCS_BACKGROUND_REFRESH_TIMEOUT_MS = 4_500;
const ACCOUNT_DOCS_FOREGROUND_REFRESH_TIMEOUT_MS = 12_000;
const ACCOUNT_DOCS_DRAFT_HUMAN_EDIT_GUARD_MS = 2_500;
const SKILL_DOCUMENT_A4_WIDTH_PX = 794;
const SKILL_DOCUMENT_A4_HEIGHT_PX = 1123;
const SKILL_DOCUMENT_CANVAS_INLINE_GUTTER_PX = 48;
const SKILL_DOCUMENT_CANVAS_VERTICAL_GUTTER_PX = 112;
const SKILL_DOCUMENT_MIN_SCALE = 0.25;
const SKILL_DOCUMENT_MAX_SCALE = 1.35;
const SKILL_DOCUMENT_ZOOM_FACTOR_MIN = 0.34;
const SKILL_DOCUMENT_ZOOM_FACTOR_MAX = 2.8;
const SKILL_DOCUMENT_ZOOM_STEP = 1.14;
const SKILL_DOCUMENT_ZOOM_WHEEL_INTENSITY = 0.0014;
const SKILL_DOCUMENT_PAGE_PADDING_TOP_PX = 52;
const SKILL_DOCUMENT_PAGE_PADDING_INLINE_PX = 58;
const SKILL_DOCUMENT_PAGE_PADDING_BOTTOM_PX = 76;
const SKILL_DOCUMENT_TITLE_FONT_SIZE_PX = 30;
const SKILL_DOCUMENT_TITLE_LINE_HEIGHT = 1.18;
const SKILL_DOCUMENT_TITLE_PADDING_BOTTOM_PX = 7;
const SKILL_DOCUMENT_BODY_MARGIN_TOP_PX = 24;
const SKILL_DOCUMENT_BODY_BLEED_PX = 20;
const SKILL_DOCUMENT_BODY_PADDING_INLINE_PX = 10;
const SKILL_DOCUMENT_BODY_PADDING_TOP_PX = 8;
const SKILL_DOCUMENT_BODY_PADDING_BOTTOM_PX = 24;
const SKILL_DOCUMENT_BODY_FONT_SIZE_PX = 15;
const SKILL_DOCUMENT_BODY_LINE_HEIGHT = 1.72;
const SCRIPT_DOCUMENT_BODY_FONT_SCALE = 0.9;
const SCRIPT_DOCUMENT_BODY_LINE_HEIGHT = 1.62;
const SKILL_DOCUMENT_BODY_AVERAGE_CHAR_WIDTH_EM = 0.55;
const SCRIPT_DOCUMENT_BODY_AVERAGE_CHAR_WIDTH_EM = 0.585;
const DOCUMENT_TYPE_OPTIONS = [
  { id: "skill", label: "Skill", collection: "documents", extension: "md" },
  { id: "architecture", label: "Architecture", collection: "documents", extension: "arch" },
  { id: "html", label: "HTML", collection: "documents", extension: "html" },
  { id: "document", label: "Document", collection: "documents", extension: "md" },
];
const SCRIPT_SHELL_OPTIONS = [
  { id: "zsh", label: "Zsh", extension: "sh" },
  { id: "bash", label: "Bash", extension: "sh" },
  { id: "python3", label: "Python", extension: "py" },
  { id: "node", label: "Node", extension: "js" },
  { id: "powershell", label: "PowerShell", extension: "ps1" },
  { id: "cmd", label: "Cmd", extension: "cmd" },
  { id: "bat", label: "Batch", extension: "bat" },
];
const SCRIPT_LEGACY_WORKSPACE_BUTTON_COLOR = "#1f3f7a";
const SCRIPT_LEGACY_LOOPSPACE_BUTTON_COLOR = "#4b3512";
const SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR = "#07101d";
const SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR = "#120c04";
const SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR = "#ffffff";
const SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR = "#ffffff";
const SCRIPT_EXPLORER_FINISH_BADGE_MS = 5000;
const SCRIPT_HISTORY_ESTIMATED_ROW_HEIGHT = 68;
const SCRIPT_HISTORY_ROW_GAP = 8;
const SCRIPT_HISTORY_VIEWPORT_FALLBACK_HEIGHT = 360;
const SCRIPT_HISTORY_VIRTUAL_OVERSCAN_ROWS = 6;
const TOOLS_WINDOW_DEFAULT_WIDTH = 920;
const TOOLS_WINDOW_DEFAULT_HEIGHT = 760;

function normalizedToolsWindowTheme(value, fallback = "dark") {
  const normalized = text(value).toLowerCase();
  return ["dark", "navy", "gold", "light"].includes(normalized) ? normalized : fallback;
}

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
    updated_at_ms: Number(selection?.updated_at_ms) || 0,
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

function documentIsHtml(editor) {
  const kind = normalizedDocumentKind(editor?.document_kind || editor?.source, editor?.collection);
  const extension = text(editor?.extension, documentExtensionForKind(kind, editor?.collection)).toLowerCase();
  const mimeType = text(editor?.mime_type).toLowerCase();
  return kind === "html" || extension === "html" || extension === "htm" || mimeType.startsWith("text/html");
}

function documentTypeLabel(value, collection = "documents") {
  return documentTypeOption(value, collection).label;
}

function clampSkillDocumentScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(SKILL_DOCUMENT_MAX_SCALE, Math.max(SKILL_DOCUMENT_MIN_SCALE, numeric));
}

function clampSkillDocumentZoomFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(SKILL_DOCUMENT_ZOOM_FACTOR_MAX, Math.max(SKILL_DOCUMENT_ZOOM_FACTOR_MIN, numeric));
}

function roundedDocumentPx(value, min = 0) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? Math.max(min, numeric) : min;
  return `${Math.round(safeValue)}px`;
}

function skillDocumentLayoutMetrics(scale, { firstPage = false, script = false } = {}) {
  const safeScale = clampSkillDocumentScale(scale);
  const pageWidth = SKILL_DOCUMENT_A4_WIDTH_PX * safeScale;
  const pageHeight = SKILL_DOCUMENT_A4_HEIGHT_PX * safeScale;
  const paddingTop = Math.max(20, SKILL_DOCUMENT_PAGE_PADDING_TOP_PX * safeScale);
  const paddingInline = Math.max(22, SKILL_DOCUMENT_PAGE_PADDING_INLINE_PX * safeScale);
  const paddingBottom = Math.max(26, SKILL_DOCUMENT_PAGE_PADDING_BOTTOM_PX * safeScale);
  const titleFontSize = Math.max(16, SKILL_DOCUMENT_TITLE_FONT_SIZE_PX * safeScale);
  const titlePaddingBottom = Math.max(4, SKILL_DOCUMENT_TITLE_PADDING_BOTTOM_PX * safeScale);
  const bodyMarginTop = firstPage ? Math.max(10, SKILL_DOCUMENT_BODY_MARGIN_TOP_PX * safeScale) : 0;
  const bodyBleed = Math.max(4, SKILL_DOCUMENT_BODY_BLEED_PX * safeScale);
  const bodyPaddingInline = Math.max(4, SKILL_DOCUMENT_BODY_PADDING_INLINE_PX * safeScale);
  const bodyPaddingTop = Math.max(4, SKILL_DOCUMENT_BODY_PADDING_TOP_PX * safeScale);
  const bodyPaddingBottom = Math.max(10, SKILL_DOCUMENT_BODY_PADDING_BOTTOM_PX * safeScale);
  const baseBodyFontSize = Math.max(10, SKILL_DOCUMENT_BODY_FONT_SIZE_PX * safeScale);
  const bodyFontSize = script ? baseBodyFontSize * SCRIPT_DOCUMENT_BODY_FONT_SCALE : baseBodyFontSize;
  const bodyLineHeight = bodyFontSize * (script ? SCRIPT_DOCUMENT_BODY_LINE_HEIGHT : SKILL_DOCUMENT_BODY_LINE_HEIGHT);
  const titleBlockHeight = firstPage
    ? titleFontSize * SKILL_DOCUMENT_TITLE_LINE_HEIGHT + titlePaddingBottom + 1 + bodyMarginTop
    : 0;
  const bodyHeight = Math.max(1, pageHeight - paddingTop - paddingBottom - 2 - titleBlockHeight);
  const bodyContentHeight = Math.max(1, bodyHeight - bodyPaddingTop - bodyPaddingBottom);
  const bodyContentWidth = Math.max(
    1,
    pageWidth - paddingInline * 2 + bodyBleed - bodyPaddingInline * 2,
  );
  const averageCharWidth = Math.max(
    1,
    bodyFontSize * (script ? SCRIPT_DOCUMENT_BODY_AVERAGE_CHAR_WIDTH_EM : SKILL_DOCUMENT_BODY_AVERAGE_CHAR_WIDTH_EM),
  );
  return {
    bodyFontSize: baseBodyFontSize,
    bodyMarginTop,
    bodyPaddingBottom,
    bodyPaddingInline,
    bodyPaddingTop,
    columns: Math.max(12, Math.floor(bodyContentWidth / averageCharWidth)),
    pageHeight,
    pageWidth,
    paddingBottom,
    paddingInline,
    paddingTop,
    rows: Math.max(1, Math.floor(bodyContentHeight / bodyLineHeight)),
    safeScale,
    titleFontSize,
    titlePaddingBottom,
  };
}

function editorVisualRows(content, columns, { preserveWords = true } = {}) {
  const source = String(content ?? "");
  const safeColumns = Math.max(8, Number.parseInt(columns, 10) || 80);
  if (!source.length) {
    return [{ start: 0, end: 0 }];
  }
  const rows = [];
  let offset = 0;
  while (offset <= source.length) {
    const newlineIndex = source.indexOf("\n", offset);
    const lineEnd = newlineIndex === -1 ? source.length : newlineIndex;
    if (lineEnd === offset) {
      rows.push({
        start: offset,
        end: newlineIndex === -1 ? lineEnd : lineEnd + 1,
      });
    } else {
      let chunkStart = offset;
      while (chunkStart < lineEnd) {
        let chunkEnd = Math.min(lineEnd, chunkStart + safeColumns);
        if (preserveWords && chunkEnd < lineEnd) {
          for (let index = chunkEnd; index > chunkStart + 1; index -= 1) {
            if (/\s/u.test(source.charAt(index - 1))) {
              chunkEnd = index;
              break;
            }
          }
        }
        rows.push({
          start: chunkStart,
          end: chunkEnd === lineEnd && newlineIndex !== -1 ? lineEnd + 1 : chunkEnd,
        });
        chunkStart = chunkEnd;
      }
    }
    if (newlineIndex === -1) break;
    offset = newlineIndex + 1;
    if (offset === source.length) {
      rows.push({ start: source.length, end: source.length });
      break;
    }
  }
  return rows;
}

function paginateEditorText(content, { scale = 1, script = false } = {}) {
  const source = String(content ?? "");
  const firstPageMetrics = skillDocumentLayoutMetrics(scale, { firstPage: true, script });
  const continuationMetrics = skillDocumentLayoutMetrics(scale, { firstPage: false, script });
  const rows = editorVisualRows(
    source,
    Math.min(firstPageMetrics.columns, continuationMetrics.columns),
    { preserveWords: !script },
  );
  if (!source.length) {
    return [{
      capacityRows: firstPageMetrics.rows,
      end: 0,
      firstPage: true,
      index: 0,
      start: 0,
      text: "",
      usedRows: 1,
    }];
  }

  const pages = [];
  let pageStart = 0;
  let pageIndex = 0;
  let pageRows = 0;
  let pageCapacity = firstPageMetrics.rows;

  rows.forEach((row) => {
    if (pageRows >= pageCapacity && row.start > pageStart) {
      pages.push({
        capacityRows: pageCapacity,
        end: row.start,
        firstPage: pageIndex === 0,
        index: pageIndex,
        start: pageStart,
        text: source.slice(pageStart, row.start),
        usedRows: pageRows,
      });
      pageIndex += 1;
      pageStart = row.start;
      pageRows = 0;
      pageCapacity = continuationMetrics.rows;
    }
    pageRows += 1;
  });

  pages.push({
    capacityRows: pageCapacity,
    end: source.length,
    firstPage: pageIndex === 0,
    index: pageIndex,
    start: pageStart,
    text: source.slice(pageStart),
    usedRows: Math.max(1, pageRows),
  });
  return pages;
}

function replaceEditorPageContent(content, page, pageContent) {
  const source = String(content ?? "");
  const start = Math.max(0, Math.min(source.length, Number(page?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(page?.end) || start));
  return `${source.slice(0, start)}${String(pageContent ?? "")}${source.slice(end)}`;
}

function editorPageSelectionSegments(content, selection, page) {
  if (!selection?.active || !page) return null;
  const source = String(content ?? "");
  const pageStart = Math.max(0, Math.min(source.length, Number(page.start) || 0));
  const pageEnd = Math.max(pageStart, Math.min(source.length, Number(page.end) || pageStart));
  const selectionStart = Math.max(pageStart, Math.min(pageEnd, Number(selection.start) || 0));
  const selectionEnd = Math.max(selectionStart, Math.min(pageEnd, Number(selection.end) || selectionStart));
  if (selectionEnd <= selectionStart) return null;
  return {
    active: true,
    after: source.slice(selectionEnd, pageEnd),
    before: source.slice(pageStart, selectionStart),
    selected: source.slice(selectionStart, selectionEnd),
  };
}

function workspaceContextMenuPosition(event, container, menuWidth = 190, menuHeight = 96) {
  const margin = 8;
  const rect = container?.getBoundingClientRect?.();
  if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
    return {
      x: clampNumber(event.clientX - rect.left, margin, Math.max(margin, rect.width - menuWidth - margin)),
      y: clampNumber(event.clientY - rect.top, margin, Math.max(margin, rect.height - menuHeight - margin)),
    };
  }
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : menuWidth + margin * 2;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : menuHeight + margin * 2;
  return {
    x: clampNumber(event.clientX, margin, Math.max(margin, viewportWidth - menuWidth - margin)),
    y: clampNumber(event.clientY, margin, Math.max(margin, viewportHeight - menuHeight - margin)),
  };
}

function documentInlineContent(document) {
  return String(document?.content ?? document?.content_md ?? document?.body ?? "");
}

function skillDocumentPageStyle(scale) {
  const metrics = skillDocumentLayoutMetrics(scale, { firstPage: true });
  return {
    "--skill-document-page-scale": String(metrics.safeScale),
    "--skill-document-page-gap": roundedDocumentPx(34 * metrics.safeScale, 18),
    "--skill-document-page-width": roundedDocumentPx(metrics.pageWidth),
    "--skill-document-page-height": roundedDocumentPx(metrics.pageHeight),
    "--skill-document-page-padding-top": roundedDocumentPx(metrics.paddingTop),
    "--skill-document-page-padding-inline": roundedDocumentPx(metrics.paddingInline),
    "--skill-document-page-padding-bottom": roundedDocumentPx(metrics.paddingBottom),
    "--skill-document-title-font-size": roundedDocumentPx(metrics.titleFontSize),
    "--skill-document-title-padding-bottom": roundedDocumentPx(metrics.titlePaddingBottom),
    "--skill-document-body-margin-top": roundedDocumentPx(metrics.bodyMarginTop),
    "--skill-document-body-margin-left": roundedDocumentPx(-10 * metrics.safeScale, -20),
    "--skill-document-body-bleed": roundedDocumentPx(SKILL_DOCUMENT_BODY_BLEED_PX * metrics.safeScale, 4),
    "--skill-document-body-padding-inline": roundedDocumentPx(metrics.bodyPaddingInline),
    "--skill-document-body-padding-top": roundedDocumentPx(metrics.bodyPaddingTop),
    "--skill-document-body-padding-bottom": roundedDocumentPx(metrics.bodyPaddingBottom),
    "--skill-document-body-font-size": roundedDocumentPx(metrics.bodyFontSize, 10),
  };
}

function documentFileName(document) {
  const collection = normalizedDocumentCollection();
  const kind = normalizedDocumentKind(document?.document_kind || document?.source, collection);
  const extension = text(document?.extension, documentExtensionForKind(kind, collection));
  const explicit = text(document?.file_name);
  if (explicit) return explicit;
  const filePath = normalizedDocumentPath(document?.file_path || document?.path_key);
  const pathName = filePath.split("/").filter(Boolean).pop();
  if (pathName) return pathName;
  const id = text(document?.id || document?.document_id, skillSlug(document?.title || "document"));
  const suffix = `.${extension}`;
  const leaf = id.split("/").filter(Boolean).pop() || id;
  return leaf.toLowerCase().endsWith(suffix.toLowerCase()) ? leaf : `${leaf}${suffix}`;
}

function documentDisplayTitle(document, fallback = "Untitled document") {
  const explicit = text(document?.title || document?.name || document?.label);
  if (explicit) return text(explicit.replace(/\.(?:md|markdown|arch|html|htm)$/iu, ""), fallback);
  const source = text(document?.file_name)
    || normalizedDocumentPath(document?.path_key || document?.file_path)
    || text(document?.document_key)
    || text(document?.id || document?.document_id)
    || text(fallback);
  const cleaned = source.startsWith("draft:") ? source.slice("draft:".length) : source;
  const leaf = cleaned.split(/[\\/]/u).filter(Boolean).pop() || cleaned;
  return text(leaf.replace(/\.(?:md|markdown|arch|html|htm)$/iu, ""), fallback);
}

function documentPreviewLine(document) {
  const contentLine = String(document?.content || "").split("\n").map((line) => line.trim()).find(Boolean);
  return text(contentLine, text(document?.local_path, `${documentTypeLabel(document?.document_kind, document?.collection)} doc`));
}

function documentPathMetadata(document) {
  const extension = text(document?.extension, documentExtensionForKind(document?.document_kind || document?.source, document?.collection));
  const explicitPath = normalizedDocumentPath(document?.path_key || document?.file_path);
  if (explicitPath) {
    const parentPathKey = normalizedDocumentPath(document?.parent_path_key || explicitPath.split("/").slice(0, -1).join("/"));
    return {
      file_name: explicitPath.split("/").filter(Boolean).pop() || documentFileName(document),
      file_path: explicitPath,
      folder_id: parentPathKey,
      folder_path: parentPathKey,
      parent_path_key: parentPathKey,
      path_key: explicitPath,
    };
  }
  const idPath = normalizedDocumentPath(document?.id || document?.document_id || skillSlug(document?.title || "document"));
  const idParts = idPath.split("/").filter(Boolean);
  const leaf = idParts.pop() || "document";
  const folderPath = normalizedDocumentPath(document?.folder_path || document?.parent_path_key || idParts.join("/"));
  const fileName = `${leaf.replace(/\.(?:md|markdown|arch|html|htm)$/iu, "")}.${extension}`;
  const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
  return {
    file_name: fileName,
    file_path: filePath,
    folder_id: folderPath,
    folder_path: folderPath,
    parent_path_key: folderPath,
    path_key: filePath,
  };
}

function scriptShellOption(value) {
  const shell = text(value, "zsh").toLowerCase();
  return SCRIPT_SHELL_OPTIONS.find((entry) => entry.id === shell) || SCRIPT_SHELL_OPTIONS[0];
}

function scriptExtensionForShell(value) {
  return scriptShellOption(value).extension;
}

function scriptButtonColor(value, fallback, legacyFallback) {
  const normalized = text(value, fallback).toLowerCase();
  if (legacyFallback && normalized === legacyFallback.toLowerCase()) return fallback;
  return normalized || fallback;
}

function scriptPathKey(script) {
  return normalizedDocumentPath(script?.path_key || script?.file_path || script?.id);
}

function scriptFileName(script) {
  const explicit = text(script?.file_name);
  if (explicit) return explicit;
  const pathKey = scriptPathKey(script);
  const leaf = pathKey.split("/").filter(Boolean).pop();
  if (leaf) return leaf;
  const extension = text(script?.extension, scriptExtensionForShell(script?.shell));
  return `${skillSlug(script?.title || "script")}.${extension}`;
}

function scriptTitle(script) {
  return text(script?.title || script?.name, scriptFileName(script).replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " "));
}

function scriptEditorDraft(script = {}) {
  const shell = scriptShellOption(script.shell).id;
  const extension = text(script.extension, scriptExtensionForShell(shell)).replace(/^\./u, "").toLowerCase();
  const fileName = scriptFileName({ ...script, extension });
  const pathKey = scriptPathKey(script) || fileName;
  const content = String(script.content ?? "");
  const workspaceButtonColor = text(
    scriptButtonColor(
      script.workspace_button_color,
      SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR,
      SCRIPT_LEGACY_WORKSPACE_BUTTON_COLOR,
    ),
    SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR,
  );
  const loopspaceButtonColor = text(
    scriptButtonColor(
      script.loopspace_button_color,
      SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR,
      SCRIPT_LEGACY_LOOPSPACE_BUTTON_COLOR,
    ),
    SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR,
  );
  const workspaceTextColor = text(
    script.workspace_text_color,
    SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR,
  );
  const loopspaceTextColor = text(
    script.loopspace_text_color,
    SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR,
  );
  const workingDirectory = text(script.working_directory);
  return {
    baseContent: content,
    baseExtension: extension,
    baseLoopspaceButtonColor: loopspaceButtonColor,
    baseLoopspaceTextColor: loopspaceTextColor,
    basePathKey: pathKey,
    baseShell: shell,
    baseTitle: scriptTitle({ ...script, file_name: fileName }),
    baseWorkspaceButtonColor: workspaceButtonColor,
    baseWorkspaceTextColor: workspaceTextColor,
    baseWorkingDirectory: workingDirectory,
    content,
    content_hash: text(script.content_hash),
    extension,
    file_name: fileName,
    id: text(script.id, pathKey),
    local_path: text(script.local_path),
    loopspace_button_color: loopspaceButtonColor,
    loopspace_text_color: loopspaceTextColor,
    path_key: pathKey,
    shell,
    title: scriptTitle({ ...script, file_name: fileName }),
    updated_at: text(script.updated_at),
    workspace_button_color: workspaceButtonColor,
    workspace_text_color: workspaceTextColor,
    working_directory: workingDirectory,
  };
}

function scriptSaveRequest(script = {}) {
  const shell = scriptShellOption(script.shell).id;
  const extension = text(script.extension, scriptExtensionForShell(shell)).replace(/^\./u, "").toLowerCase();
  const fileName = scriptFileName({ ...script, extension });
  return {
    content: String(script.content ?? ""),
    extension,
    file_name: fileName,
    loopspace_button_color: scriptButtonColor(
      script.loopspace_button_color,
      SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR,
      SCRIPT_LEGACY_LOOPSPACE_BUTTON_COLOR,
    ),
    loopspace_text_color: text(script.loopspace_text_color, SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR),
    path_key: scriptPathKey(script) || fileName,
    shell,
    title: scriptTitle({ ...script, file_name: fileName }),
    workspace_button_color: text(
      scriptButtonColor(
        script.workspace_button_color,
        SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR,
        SCRIPT_LEGACY_WORKSPACE_BUTTON_COLOR,
      ),
      SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR,
    ),
    workspace_text_color: text(script.workspace_text_color, SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR),
    working_directory: text(script.working_directory),
  };
}

function scriptHasUnsavedChanges(editor) {
  if (!editor) return false;
  return String(editor.content || "") !== String(editor.baseContent ?? "")
    || text(editor.title) !== text(editor.baseTitle || editor.title)
    || text(editor.workspace_button_color, SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR) !== text(editor.baseWorkspaceButtonColor, SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR)
    || text(editor.loopspace_button_color, SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR) !== text(editor.baseLoopspaceButtonColor, SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR)
    || text(editor.workspace_text_color, SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR) !== text(editor.baseWorkspaceTextColor, SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR)
    || text(editor.loopspace_text_color, SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR) !== text(editor.baseLoopspaceTextColor, SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR)
    || text(editor.shell, "zsh") !== text(editor.baseShell, "zsh")
    || text(editor.extension, scriptExtensionForShell(editor.shell)) !== text(editor.baseExtension, scriptExtensionForShell(editor.baseShell))
    || text(editor.working_directory) !== text(editor.baseWorkingDirectory)
    || text(scriptPathKey(editor)) !== text(editor.basePathKey || scriptPathKey(editor));
}

function scriptRunLabel(script) {
  return text(script?.title || script?.name, scriptFileName(script));
}

function formatScriptLogTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "pending";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatScriptLogDuration(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return "pending";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatScriptTerseDuration(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return "pending";
  let seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86_400);
  seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  if (days > 0) return [days ? `${days}d` : "", hours ? `${hours}h` : ""].filter(Boolean).join(" ");
  if (hours > 0) return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ");
  if (minutes > 0) return [minutes ? `${minutes}m` : "", seconds ? `${seconds}s` : ""].filter(Boolean).join(" ");
  return `${seconds}s`;
}

function formatScriptRunAgo(run = {}, nowMs = Date.now()) {
  const atMs = scriptRunTimestampMs(run.started_at_ms, run.started_at, run.queued_at_ms, run.queued_at);
  if (!atMs) return "unknown";
  const ageMs = Math.max(0, Number(nowMs) - atMs);
  if (ageMs < 30_000) return "just now";
  return `${formatScriptTerseDuration(ageMs)} ago`;
}

function scriptRunRuntimeMs(run = {}, nowMs = Date.now()) {
  if (run.state === "queued") return 0;
  const startedAtMs = scriptRunTimestampMs(run.started_at_ms, run.started_at);
  const endedAtMs = scriptRunTimestampMs(run.ended_at_ms, run.ended_at);
  const explicitDuration = Number(run.duration_ms);
  if (run.state === "running" && startedAtMs) {
    return Math.max(0, Number(nowMs) - startedAtMs);
  }
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
    return explicitDuration;
  }
  if (startedAtMs && endedAtMs) {
    return Math.max(0, endedAtMs - startedAtMs);
  }
  return 0;
}

function formatScriptRunRuntime(run = {}, nowMs = Date.now()) {
  if (run.state === "queued") return "queued";
  return formatScriptTerseDuration(scriptRunRuntimeMs(run, nowMs));
}

function scriptRunTimestampMs(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    const normalized = text(value);
    if (!normalized) continue;
    const numeric = Number(normalized);
    if (Number.isFinite(numeric) && numeric > 1_000_000_000) return numeric;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizedScriptRunState(result = {}) {
  const raw = text(result.state || result.run_status || result.status).toLowerCase();
  if (raw === "queued" || raw === "running" || raw === "completed" || raw === "failed") return raw;
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  if (raw === "error") return "failed";
  if (raw === "ready" || raw === "done" || raw === "finished" || raw === "success" || raw === "succeeded") {
    return result.ok === false ? "failed" : "completed";
  }
  if (result.ok === false) return "failed";
  if (result.ended_at || result.ended_at_ms) return "completed";
  if (result.started_at || result.started_at_ms) return "running";
  if (result.queued_at || result.queued_at_ms) return "queued";
  return "";
}

function scriptRunStatusLabel(run = {}) {
  if (run.state === "queued") return "Queued";
  if (run.state === "running") return "Running";
  if (run.state === "cancelled") return "Cancelled";
  if (run.ok === false || run.state === "failed" || run.state === "error") return "Failed";
  return "Completed";
}

function scriptRunStatusTone(run = {}) {
  if (run.ok === false || run.state === "failed" || run.state === "error" || run.state === "cancelled") return "error";
  return run.state;
}

function scriptRunDisplayLog(result = null) {
  if (!result) return null;
  const chunks = Array.isArray(result.chunks) && result.chunks.length
    ? result.chunks
    : [
      String(result.stdout ?? "").length ? { stream: "stdout", text: String(result.stdout) } : null,
      String(result.stderr ?? "").length ? { stream: "stderr", text: String(result.stderr) } : null,
      text(result.error) ? { stream: "stderr", text: `${String(result.error)}\n` } : null,
    ].filter(Boolean);
  const pathKey = normalizedDocumentPath(
    result.path_key || result.script?.path_key,
  );
  const runId = text(result.run_id);
  const state = normalizedScriptRunState(result);
  const queuedAt = text(result.queued_at);
  const startedAt = text(result.started_at, queuedAt);
  const endedAt = text(result.ended_at);
  const queuedAtMs = scriptRunTimestampMs(result.queued_at_ms, queuedAt);
  const startedAtMs = scriptRunTimestampMs(result.started_at_ms, startedAt, queuedAtMs);
  const endedAtMs = scriptRunTimestampMs(result.ended_at_ms, endedAt);
  const updatedAtMs = scriptRunTimestampMs(
    result.updated_at_ms,
    result.updated_at,
    endedAtMs,
    startedAtMs,
    queuedAtMs,
  );
  return {
    ...result,
    chunks,
    cause: text(result.cause || result.source_kind, "manual"),
    durationLabel: formatScriptLogDuration(result.duration_ms),
    duration_ms: Number(result.duration_ms) || 0,
    ended_at: endedAt,
    endedAtLabel: formatScriptLogTime(endedAt),
    ended_at_ms: endedAtMs,
    exit_code: result.exit_code,
    ok: result.ok,
    path_key: pathKey,
    queued_at: queuedAt,
    queued_at_ms: queuedAtMs,
    run_id: runId,
    run_status: text(result.run_status),
    source_kind: text(result.source_kind),
    started_at: startedAt,
    startedAtLabel: formatScriptLogTime(startedAt),
    started_at_ms: startedAtMs,
    state,
    title: text(
      result.script?.title || result.script?.name || result.script_name || result.name || result.title,
      scriptFileName(result.script || { path_key: pathKey }),
    ),
    updated_at_ms: updatedAtMs,
  };
}

function scriptRunHistorySortValue(run = {}) {
  return scriptRunTimestampMs(
    run.updated_at_ms,
    run.ended_at_ms,
    run.started_at_ms,
    run.queued_at_ms,
    run.ended_at,
    run.started_at,
    run.queued_at,
  );
}

function scriptRunHistoryKey(run = {}) {
  const runId = text(run.run_id);
  if (runId) return `run:${runId}`;
  return [
    "script",
    normalizedDocumentPath(run.path_key),
    scriptRunHistorySortValue(run),
  ].join(":");
}

function scriptRunMatchesPath(run = {}, activePathKey = "") {
  const expected = normalizedDocumentPath(activePathKey);
  if (!expected) return true;
  return normalizedDocumentPath(run.path_key || run.script?.path_key) === expected;
}

function buildScriptHistoryVirtualWindow(rows, viewport, rowHeights) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    return { items: [], totalHeight: 0 };
  }

  const viewportHeight = Math.max(
    1,
    Number(viewport?.height || SCRIPT_HISTORY_VIEWPORT_FALLBACK_HEIGHT),
  );
  const scrollTop = Math.max(0, Number(viewport?.scrollTop || 0));
  const overscanPx = SCRIPT_HISTORY_ESTIMATED_ROW_HEIGHT * SCRIPT_HISTORY_VIRTUAL_OVERSCAN_ROWS;
  const startBoundary = Math.max(0, scrollTop - overscanPx);
  const endBoundary = scrollTop + viewportHeight + overscanPx;
  const offsets = [];
  const heights = [];
  let totalHeight = 0;

  items.forEach((row, index) => {
    const rowKey = scriptRunHistoryKey(row);
    const measuredHeight = Number(rowHeights?.get?.(rowKey) || 0);
    const height = measuredHeight > 0 ? measuredHeight : SCRIPT_HISTORY_ESTIMATED_ROW_HEIGHT;
    offsets[index] = totalHeight;
    heights[index] = height;
    totalHeight += height + (index === items.length - 1 ? 0 : SCRIPT_HISTORY_ROW_GAP);
  });

  let startIndex = 0;
  while (
    startIndex < items.length - 1
    && offsets[startIndex] + heights[startIndex] < startBoundary
  ) {
    startIndex += 1;
  }

  let endIndex = startIndex;
  while (endIndex < items.length && offsets[endIndex] <= endBoundary) {
    endIndex += 1;
  }

  if (endIndex <= startIndex) {
    endIndex = Math.min(items.length, startIndex + 1);
  }

  return {
    items: items.slice(startIndex, endIndex).map((row, sliceIndex) => {
      const index = startIndex + sliceIndex;
      return {
        key: scriptRunHistoryKey(row),
        row,
        top: offsets[index],
      };
    }),
    totalHeight,
  };
}

function documentIsFolderRow(document) {
  return text(document?.entry_kind).toLowerCase() === "folder"
    || text(document?.row_type || document?.type).toLowerCase() === "folder"
    || text(document?.kind).toLowerCase() === "account_document_folder";
}

function documentEditorDraft(document) {
  const option = documentTypeOption(document?.document_kind || document?.source, document?.collection);
  const content = documentInlineContent(document);
  const title = documentDisplayTitle(document);
  const isDraft = Boolean(document?.isDraft || document?.draft || text(document?.sync_status) === "draft");
  return {
	    asset_id: text(document?.asset_id),
	    base_content_hash: text(document?.base_content_hash),
	    baseContent: isDraft ? String(document?.baseContent ?? "") : content,
	    baseTitle: isDraft ? documentDisplayTitle({ title: document?.baseTitle }, title) : title,
	    canonical_local_path: text(document?.canonical_local_path),
	    collection: option.collection,
	    content,
	    content_hash: text(document?.content_hash || document?.sha256),
    document_key: isDraft
      ? text(document?.document_key || accountDocumentStorageKey(document))
      : accountDocumentStorageKey(document),
	    document_kind: option.id,
	    draft: isDraft,
	    draft_id: text(document?.draft_id),
		    draft_path: text(document?.draft_path),
		    extension: text(document?.extension, option.extension),
    mime_type: text(document?.mime_type, documentMimeTypeForKind(option.id, option.collection)),
    file_name: text(document?.file_name),
    file_path: normalizedDocumentPath(document?.file_path),
    folder_id: normalizedDocumentPath(document?.folder_id),
    folder_path: normalizedDocumentPath(document?.folder_path),
    id: text(document?.id || document?.document_id),
    isDraft,
    local_path: text(document?.local_path),
    parent_path_key: normalizedDocumentPath(document?.parent_path_key),
    path_key: normalizedDocumentPath(document?.path_key),
    row_type: "document",
    selected_key: text(document?.selected_key),
    source: option.id,
    sync_status: isDraft ? "draft" : text(document?.sync_status),
    title,
  };
}

function documentHasMaterializedContent(document) {
  return document?.has_content_payload === true || documentHasInlineContent(document);
}

function documentHasInlineContent(document) {
  return documentInlineContent(document).length > 0;
}

function documentContentHash(document) {
  return text(document?.content_hash || document?.sha256);
}

function documentCanHydrate(document) {
  if (documentIsFolderRow(document)) return false;
  const key = accountDocumentStorageKey(document) || text(document?.id);
  if (!key) return false;
  if (document?.pending_push === true || text(document?.sync_status) === "local_pending") {
    return false;
  }
  if (document?.content_stale === true) return true;
  if (documentHasInlineContent(document)) return false;
  return Boolean(
    text(document?.asset_id)
    || text(document?.blob_id)
    || text(document?.content_hash || document?.sha256)
    || document?.has_content === true
    || document?.has_content_payload === true
    || Number(document?.size_bytes) > 0,
  );
}

function documentNeedsHydration(document) {
  if (!documentCanHydrate(document)) return false;
  if (documentHasMaterializedContent(document) && document?.content_stale !== true) return false;
  return true;
}

function documentHasCurrentMaterializedContent(current, incoming) {
  if (!documentHasMaterializedContent(current) || current?.content_stale === true) return false;
  const incomingHash = documentContentHash(incoming);
  if (!incomingHash) return true;
  const currentHash = documentContentHash(current);
  return Boolean(currentHash) && currentHash === incomingHash;
}

function documentDraftKey(document) {
  const explicit = text(document?.document_key);
  if (explicit.startsWith("draft:")) return explicit;
  const pathKey = normalizedDocumentPath(document?.path_key || document?.file_path);
  const base = pathKey || accountDocumentStorageKey(document) || text(document?.id || document?.title, "untitled");
  return `draft:${base}`;
}

function documentDraftClearKey(document, fallback = "") {
  if (!document) return text(fallback);
  return text(document.draft_path)
    || text(document.draft_id)
    || text(document.document_key)
    || normalizedDocumentPath(document.path_key || document.file_path)
    || accountDocumentStorageKey(document)
    || text(document.id)
    || text(fallback);
}

function editorHasUnsavedDraft(editor, selectedDocument = null) {
  if (!editor) return false;
  if (editor.isDraft === true || editor.draft === true || text(editor.sync_status) === "draft") {
    return true;
  }
  return String(editor.content || "") !== String(editor.baseContent ?? "")
    || text(editor.title) !== text(editor.baseTitle || selectedDocument?.title || editor.title);
}

function editorDraftSnapshot(editor, selectedKey = "", selectedDocument = null) {
  if (!editor) return null;
  const documentKind = normalizedDocumentKind(editor.document_kind || editor.source, editor.collection);
  const pathMeta = documentPathMetadata({
    ...selectedDocument,
    ...editor,
    document_kind: documentKind,
    extension: text(editor.extension, documentExtensionForKind(documentKind)),
  });
  return {
    ...editor,
    ...pathMeta,
    collection: normalizedDocumentCollection(),
    document_key: documentDraftKey({ ...editor, ...pathMeta }),
	    document_kind: documentKind,
    mime_type: documentMimeTypeForKind(documentKind),
	    draft: true,
    isDraft: true,
    row_type: "document",
    selected_key: text(selectedKey),
    source: documentKind,
    sync_status: "draft",
    updated_at: new Date().toISOString(),
  };
}

function documentDraftMatchesEditor(draft, editor, selectedKey = "") {
  if (!draft || !editor) return false;
  const normalizeKey = (value) => {
    const raw = text(value);
    if (!raw) return "";
    if (raw.startsWith("library:")) return normalizedDocumentPath(raw.slice("library:".length)) || raw.slice("library:".length);
    if (raw.startsWith("draft:")) return normalizedDocumentPath(raw.slice("draft:".length)) || raw.slice("draft:".length);
    return normalizedDocumentPath(raw) || raw;
  };
  const collectKeys = (value, extraSelectedKey = "") => {
    const keys = new Set();
    [
      value?.document_key,
      value?.path_key,
      value?.file_path,
      accountDocumentStorageKey(value),
      value?.id,
      value?.document_id,
      value?.doc_id,
      value?.selected_key,
      extraSelectedKey,
    ].forEach((candidate) => {
      const key = normalizeKey(candidate);
      if (key) keys.add(key);
    });
    return keys;
  };
  const draftPath = text(draft.draft_path);
  const editorDraftPath = text(editor.draft_path);
  if (draftPath && editorDraftPath && draftPath === editorDraftPath) return true;
  const draftId = text(draft.draft_id);
  const editorDraftId = text(editor.draft_id);
  if (draftId && editorDraftId && draftId === editorDraftId) return true;
  const draftKeys = collectKeys(draft);
  const editorKeys = collectKeys(editor, selectedKey);
  return Array.from(draftKeys).some((key) => editorKeys.has(key));
}

function editorWithRemoteDocumentContent(current, document) {
  if (!current || !document) return current;
  const currentDocumentKey = text(current.document_key);
  const currentStorageKey = accountDocumentStorageKey(current);
  const currentIsDraft = Boolean(
    current.isDraft === true
      || current.draft === true
      || text(current.sync_status) === "draft"
      || currentDocumentKey.startsWith("draft:")
  );
  const currentKey = currentIsDraft && currentDocumentKey.startsWith("draft:")
    ? (currentStorageKey || currentDocumentKey.slice("draft:".length))
    : (currentDocumentKey || currentStorageKey);
  const documentKey = accountDocumentStorageKey(document);
  if (!currentKey || currentKey !== documentKey) return current;
  const baseContent = String(current.baseContent ?? current.content ?? "");
  const bodyDirty = String(current.content || "") !== baseContent;
  const currentTitle = text(current.title);
  const baseTitle = text(current.baseTitle, currentTitle);
  const remoteTitle = text(document.title || document.name, currentTitle);
  const titleDirty = currentTitle !== baseTitle;
  const nextMetadata = {
    asset_id: text(document.asset_id, current.asset_id),
    baseTitle: remoteTitle,
    collection: normalizedDocumentCollection(),
    document_kind: normalizedDocumentKind(document.document_kind || document.source, current.collection),
    extension: text(document.extension || document.ext, current.extension),
    file_name: text(document.file_name, current.file_name),
    file_path: normalizedDocumentPath(document.file_path || current.file_path),
    folder_id: normalizedDocumentPath(document.folder_id || current.folder_id),
    folder_path: normalizedDocumentPath(document.folder_path || current.folder_path),
    local_path: text(document.local_path, current.local_path),
    parent_path_key: normalizedDocumentPath(document.parent_path_key || current.parent_path_key),
    path_key: normalizedDocumentPath(document.path_key || current.path_key),
    source: normalizedDocumentKind(document.document_kind || document.source, current.collection),
    title: titleDirty ? currentTitle : remoteTitle,
  };
  if (currentIsDraft) {
    if (
      current.asset_id === nextMetadata.asset_id
      && current.baseTitle === nextMetadata.baseTitle
      && current.document_kind === nextMetadata.document_kind
      && current.extension === nextMetadata.extension
      && current.file_name === nextMetadata.file_name
      && current.file_path === nextMetadata.file_path
      && current.folder_id === nextMetadata.folder_id
      && current.folder_path === nextMetadata.folder_path
      && current.local_path === nextMetadata.local_path
      && current.parent_path_key === nextMetadata.parent_path_key
      && current.path_key === nextMetadata.path_key
      && current.source === nextMetadata.source
      && current.title === nextMetadata.title
      && current.draft === true
      && current.isDraft === true
      && current.sync_status === "draft"
    ) {
      return current;
    }
    return {
      ...current,
      ...nextMetadata,
      draft: true,
      isDraft: true,
      sync_status: "draft",
    };
  }
  if (bodyDirty) {
    if (
      current.asset_id === nextMetadata.asset_id
      && current.baseTitle === nextMetadata.baseTitle
      && current.document_kind === nextMetadata.document_kind
      && current.extension === nextMetadata.extension
      && current.file_name === nextMetadata.file_name
      && current.file_path === nextMetadata.file_path
      && current.folder_id === nextMetadata.folder_id
      && current.folder_path === nextMetadata.folder_path
      && current.local_path === nextMetadata.local_path
      && current.parent_path_key === nextMetadata.parent_path_key
      && current.path_key === nextMetadata.path_key
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
      current.asset_id === nextMetadata.asset_id
      && current.baseTitle === nextMetadata.baseTitle
      && current.document_kind === nextMetadata.document_kind
      && current.extension === nextMetadata.extension
      && current.file_name === nextMetadata.file_name
      && current.file_path === nextMetadata.file_path
      && current.folder_id === nextMetadata.folder_id
      && current.folder_path === nextMetadata.folder_path
      && current.local_path === nextMetadata.local_path
      && current.parent_path_key === nextMetadata.parent_path_key
      && current.path_key === nextMetadata.path_key
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
  const content = documentInlineContent(document);
  if (
    current.content === content
    && current.content_hash === text(document.content_hash || document.sha256)
    && current.baseTitle === nextMetadata.baseTitle
    && current.file_name === nextMetadata.file_name
    && current.file_path === nextMetadata.file_path
    && current.folder_id === nextMetadata.folder_id
    && current.folder_path === nextMetadata.folder_path
    && current.local_path === text(document.local_path, current.local_path)
    && current.parent_path_key === nextMetadata.parent_path_key
    && current.path_key === nextMetadata.path_key
    && current.title === nextMetadata.title
  ) {
    return current;
  }
  return {
    ...current,
    ...nextMetadata,
    baseContent: content,
    content,
    content_hash: text(document.content_hash || document.sha256),
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

function clampNumber(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(Math.max(numericValue, min), max);
}

function documentFolderRow(folderPath, source = {}) {
  const pathKey = normalizedDocumentPath(folderPath);
  if (!pathKey) return null;
  const parts = pathKey.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] || "folder";
  const parentPathKey = parts.slice(0, -1).join("/");
  return {
    collection: normalizedDocumentCollection(),
    entry_kind: "folder",
    file_name: fileName,
    folder_id: pathKey,
    folder_path: pathKey,
    id: pathKey,
    kind: "folder",
    parent_path_key: parentPathKey,
    path_key: pathKey,
    row_type: "folder",
    title: text(source.title || source.file_name, fileName),
    type: "folder",
    updated_at: text(source.updated_at, new Date().toISOString()),
  };
}

function documentPathIsSameOrChild(path, parentPath) {
  const safePath = normalizedDocumentPath(path);
  const safeParent = normalizedDocumentPath(parentPath);
  return safePath === safeParent || Boolean(safeParent && safePath.startsWith(`${safeParent}/`));
}

function docsCreateTargetFolder(target = {}) {
  const targetKind = text(target.kind, "root");
  if (targetKind === "folder") {
    return normalizedDocumentPath(target.path_key || target.folder_path || target.id);
  }
  if (targetKind === "document") {
    return normalizedDocumentPath(target.parent_path_key || target.folder_path);
  }
  return "";
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
        candidate.authoritative === true || candidate.snapshot_full === true
      )
  ));
}

function accountToolsSkillMetaFromEventPayload(payload) {
  const meta = { error: "", revision: null, updated_at: "", updated_by: "" };
  const applyMeta = (source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    if (meta.revision === null && source.revision !== undefined && source.revision !== null) {
      const revision = Number(source.revision);
      if (Number.isFinite(revision)) meta.revision = revision;
    }
    meta.updated_at = text(meta.updated_at, text(source.updated_at));
    meta.updated_by = text(meta.updated_by, text(source.updated_by_device_name));
    meta.error = text(meta.error, text(source.last_sync_error || source.error));
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
    has_content: true,
    has_content_payload: true,
    local_saved_at: localSavedAt,
    pending_push: true,
    sync_status: "local_pending",
  };
}

function clearLocalPendingSkill(skill) {
  return {
    ...skill,
    local_saved_at: "",
    pending_push: false,
    sync_status: skill?.sync_status === "local_pending" ? "" : text(skill?.sync_status),
  };
}

function skillHasDraftFile(skill) {
  return Boolean(text(skill?.draft_path || skill?.draft_id));
}

function clearDraftFileSkill(skill) {
  if (!skill) return skill;
  const next = { ...skill };
  delete next.allow_empty_overwrite;
  delete next.base_content_hash;
  delete next.canonical_local_path;
  delete next.draft;
  delete next.draft_id;
  delete next.draft_path;
  delete next.isDraft;
  delete next.is_draft;
  if (next.sync_status === "draft") next.sync_status = "";
  if (next.sync_status === "draft") next.sync_status = "";
  return next;
}

async function discardSkillDraftFile(skill) {
  if (!skillHasDraftFile(skill)) return false;
  await invoke("cloud_mcp_discard_account_document_draft", {
    request: accountDocumentRequestFromSkill(skill, { local_only: true }),
  }).catch(() => {});
  return true;
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

// Live install/update stages emitted by the Rust updater; anything outside
// this map ("complete", "failed", or no stage) falls back to normal row UI.
const AGENT_UPDATE_STAGE_LABELS = {
  queued: "Will update when idle",
  downloading: "Downloading…",
  installing: "Installing…",
  verifying: "Verifying…",
};

function agentUpdateProgressFields(status) {
  return {
    update_stage: text(status?.update_stage || status?.updateStage).toLowerCase(),
    update_stage_seq: Number(status?.update_stage_seq ?? status?.updateStageSeq) || 0,
    update_to_version: text(status?.update_to_version || status?.updateToVersion),
    update_error_reason: text(status?.update_error_reason || status?.updateErrorReason),
    update_failed_stage: text(status?.update_failed_stage || status?.updateFailedStage),
  };
}

function cliSnapshotFromStatuses(statuses) {
  return (Array.isArray(statuses) ? statuses : []).map((status) => ({
    agent_id: text(status?.provider || status?.id),
    agent_label: text(status?.label),
    installed: Boolean(status?.installed),
    authenticated: Boolean(status?.authenticated),
    version: text(status?.version),
    npm_package_version: text(status?.npm_package_version),
    npm_latest_version: text(status?.npm_latest_version),
    update_available: Boolean(status?.npm_update_available),
    ...agentUpdateProgressFields(status),
    active_model: text(status?.active_model),
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

function ToolsWorkspaceView({
  agentPromptWorkspaceId = "",
  embeddedDocsOpenRequest = null,
  embeddedDocsPanel = false,
  embeddedDocsWindowOpenRequest = null,
  onEmbeddedDocsSelectionChange = null,
  onAppControlContextChange = null,
  onAppControlDocumentActions = null,
  onAppControlScriptActions = null,
  onLocalScriptsChanged = null,
  default_working_directory: defaultWorkingDirectory = "",
  initialSection = "",
  rightToolsOrchestratorOpen = false,
  scriptLogFocusRequest = null,
  sharedScriptRunResults = {},
  surfaceActive = true,
  workspaces = [],
}) {
  const [section, setSection] = useState(() => normalizedSectionId(embeddedDocsPanel ? "docs" : initialSection));
  const [toolsWindowBreakouts, setToolsWindowBreakouts] = useState({});
  const toolsWindowBreakoutsRef = useRef(toolsWindowBreakouts);
  const embeddedDocsWindowOpenHandledRef = useRef("");
  const surfaceIsActive = Boolean(surfaceActive);

  useEffect(() => {
    const nextSection = normalizedSectionId(embeddedDocsPanel ? "docs" : initialSection);
    setSection((current) => (current === nextSection ? current : nextSection));
  }, [embeddedDocsPanel, initialSection]);

  useEffect(() => {
    toolsWindowBreakoutsRef.current = toolsWindowBreakouts;
  }, [toolsWindowBreakouts]);

  const focusToolsWindow = useCallback(async (label) => {
    const safeLabel = text(label);
    if (!safeLabel) return false;
    return invoke("tools_window_focus", { label: safeLabel })
      .then(Boolean)
      .catch(() => false);
  }, []);

  const closeToolsWindow = useCallback(async (breakoutOrLabel) => {
    const label = typeof breakoutOrLabel === "string"
      ? breakoutOrLabel
      : text(breakoutOrLabel?.label);
    if (!label) return;
    await invoke("tools_window_close", { label }).catch(() => {});
    setToolsWindowBreakouts((current) => {
      const next = { ...current };
      Object.entries(next).forEach(([id, breakout]) => {
        if (breakout?.label === label) delete next[id];
      });
      return next;
    });
  }, []);

  const openToolsWindow = useCallback(async ({
    key,
    mode,
    theme = "dark",
    title = "Tools",
  } = {}) => {
    const normalizedMode = normalizedSectionId(mode, "docs") === "scripts" ? "scripts" : "docs";
    const safeKey = text(key);
    if (!safeKey) return "";
    const result = await invoke("tools_window_open", {
      height: TOOLS_WINDOW_DEFAULT_HEIGHT,
      key: safeKey,
      mode: normalizedMode,
      theme: normalizedToolsWindowTheme(theme),
      title,
      width: TOOLS_WINDOW_DEFAULT_WIDTH,
    });
    const label = text(result?.label);
    if (!label) return "";
    setToolsWindowBreakouts((current) => ({
      ...current,
      [label]: {
        key: safeKey,
        label,
        mode: normalizedMode,
        title,
      },
    }));
    return label;
  }, []);

  // ---- MCP scope (global defaults vs per-workspace) ----
  const [mcpScope, setMcpScope] = useState(GLOBAL_MCP_DEFAULTS_SCOPE);
  const [globalMcpDefaults, setGlobalMcpDefaults] = useState({
    error: "",
    root_directory: "",
    state: "loading",
    workspace_id: GLOBAL_MCP_DEFAULTS_WORKSPACE_ID,
  });

  useEffect(() => {
    let cancelled = false;
    invoke("coordination_global_mcp_defaults_root")
      .then((response) => {
        if (cancelled) return;
        const data = response?.data || response || {};
        setGlobalMcpDefaults({
          error: "",
          root_directory: text(data.root_directory),
          state: response?.ok === false ? "error" : "ready",
          workspace_id: text(data.workspace_id, GLOBAL_MCP_DEFAULTS_WORKSPACE_ID),
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
        root_directory: text(workspace?.root_directory, defaultWorkingDirectory),
      }))
      .filter((workspace) => workspace.id)
  ), [defaultWorkingDirectory, workspaces]);

  const activeMcpScope = mcpScope !== GLOBAL_MCP_DEFAULTS_SCOPE
    && workspaceOptions.some((workspace) => workspace.id === mcpScope)
    ? mcpScope
    : GLOBAL_MCP_DEFAULTS_SCOPE;
  const activeMcpWorkspace = activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE
    ? {
      id: globalMcpDefaults.workspace_id,
      name: "Global defaults",
    }
    : workspaceOptions.find((workspace) => workspace.id === activeMcpScope);
  const activeMcpRootDirectory = activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE
    ? globalMcpDefaults.root_directory
    : text(activeMcpWorkspace?.root_directory, defaultWorkingDirectory);
  const mcpScopeReady = activeMcpScope !== GLOBAL_MCP_DEFAULTS_SCOPE
    || (globalMcpDefaults.state === "ready" && Boolean(globalMcpDefaults.root_directory));

  // ---- Docs (account-level markdown documents backed by per-document assets) ----
  const [skillsLibrary, setSkillsLibrary] = useState(() => ({
    skills: getWorkspaceToolsAccountSkills(),
  }));
  const skillsLibraryRef = useRef(skillsLibrary);
  const [skillsRevision, setSkillsRevision] = useState(null);
  const [skillsMeta, setSkillsMeta] = useState({ updated_at: "", updated_by: "", offline: false });
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
  const documentDraftPersistRef = useRef({ key: "", run: 0 });
  const invalidateDocumentDraftPersist = useCallback(() => {
    documentDraftPersistRef.current = {
      key: "",
      run: documentDraftPersistRef.current.run + 1,
    };
  }, []);
  const [hydratingDocKeys, setHydratingDocKeys] = useState(() => new Set());
  const [skillsQuery, setSkillsQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [newDocDraft, setNewDocDraft] = useState({ createKind: "document", folder_path: "", name: "", type: "document" });
  // In the embedded docs panel there is no side-by-side editor column, so the
  // create form takes over the single column (tree ⇄ create swap) when armed.
  const [docsCreateActive, setDocsCreateActive] = useState(false);
  const [documentDraft, setDocumentDraft] = useState(() => getWorkspaceToolsDocumentDraft());
  const [documentDrafts, setDocumentDrafts] = useState(() => getWorkspaceToolsDocumentDrafts());
  const [documentDraftApplyTick, setDocumentDraftApplyTick] = useState(0);
  // "library:<collection>:<id>" or "catalog:<id>" — selecting a document shows its contents.
  const [selectedSkillKey, setSelectedSkillKey] = useState(() => text(getWorkspaceToolsDocumentDraft()?.selected_key));
  // { id: ""|documentId, title, content } while creating/editing.
  const [skillEditor, setSkillEditor] = useState(() => {
    const restoredDraft = getWorkspaceToolsDocumentDraft();
    return restoredDraft ? documentEditorDraft(restoredDraft) : null;
  });
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
  const [skillEditorSelection, setSkillEditorSelection] = useState({
    direction: "",
    end: 0,
    start: 0,
    updated_at_ms: 0,
  });
  const [lastDocumentSelection, setLastDocumentSelection] = useState(null);
  const lastHumanDocumentEditAtRef = useRef(0);
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
  const docsWorkspaceSurfaceRef = useRef(null);
  const [skillDocumentFitScale, setSkillDocumentFitScale] = useState(1);
  const [skillDocumentZoomFactor, setSkillDocumentZoomFactor] = useState(1);
  const skillDocumentFitScaleRef = useRef(1);
  const skillDocumentScaleRef = useRef(1);
  const skillDocumentZoomFactorRef = useRef(1);
  const docsExplorerPanelRef = useRef(null);
  const [docsExplorerCollapsed, setDocsExplorerCollapsed] = useState(false);
  const [docsExplorerSize, setDocsExplorerSize] = useState("238px");
  const [docsContextMenu, setDocsContextMenu] = useState(null);

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

  // ---- Scripts (local-only runnable files) ----
  const [scriptsLibrary, setScriptsLibrary] = useState({ root: "", scripts: [] });
  const [scriptsState, setScriptsState] = useState("loading");
  const [scriptsError, setScriptsError] = useState("");
  const [scriptsMessage, setScriptsMessage] = useState("");
  const [scriptsQuery, setScriptsQuery] = useState("");
  const [selectedScriptKey, setSelectedScriptKey] = useState("");
  const [selectedScriptLogKey, setSelectedScriptLogKey] = useState("");
  const [scriptPaneTab, setScriptPaneTab] = useState("editor");
  const [scriptEditor, setScriptEditor] = useState(null);
  const [scriptEditorSelection, setScriptEditorSelection] = useState({
    direction: "",
    end: 0,
    start: 0,
    updated_at_ms: 0,
  });
  const [lastScriptSelection, setLastScriptSelection] = useState(null);
  const scriptSelectionClearAtRef = useRef(0);
  const scriptDocumentCanvasRef = useRef(null);
  const scriptLogsTerminalRef = useRef(null);
  const scriptsWorkspaceSurfaceRef = useRef(null);
  const scriptsExplorerPanelRef = useRef(null);
  const [scriptsExplorerCollapsed, setScriptsExplorerCollapsed] = useState(false);
  const [scriptsExplorerSize, setScriptsExplorerSize] = useState("238px");
  const [scriptsContextMenu, setScriptsContextMenu] = useState(null);
  const [newScriptDraft, setNewScriptDraft] = useState({
    loopspace_button_color: SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR,
    loopspace_text_color: SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR,
    name: "",
    shell: "zsh",
    workspace_button_color: SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR,
    workspace_text_color: SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR,
  });
  const [scriptRunResults, setScriptRunResults] = useState({});
  const [scriptRunHistory, setScriptRunHistory] = useState([]);
  const [scriptCompletionMarkers, setScriptCompletionMarkers] = useState({});
  const scriptRunStateRef = useRef({});
  const scriptCompletionTimersRef = useRef(new Map());
  const [scriptHistoryNowMs, setScriptHistoryNowMs] = useState(() => Date.now());
  const scriptHistoryViewportRef = useRef(null);
  const scriptHistoryScrollFrameRef = useRef(0);
  const scriptHistoryRowHeightsRef = useRef(new Map());
  const [scriptHistoryViewport, setScriptHistoryViewport] = useState({
    height: SCRIPT_HISTORY_VIEWPORT_FALLBACK_HEIGHT,
    scrollTop: 0,
  });
  const [scriptHistoryMeasureVersion, setScriptHistoryMeasureVersion] = useState(0);

  const loadLocalScripts = useCallback(async ({ selectKey = "" } = {}) => {
    setScriptsState((current) => (current === "ready" ? "refreshing" : "loading"));
    setScriptsError("");
    try {
      const result = await invoke("local_scripts_list", {
        request: { include_content: false },
      });
      const rows = Array.isArray(result?.scripts) ? result.scripts.map(scriptEditorDraft) : [];
      const rowKeys = new Set(rows.map((row) => scriptPathKey(row) || row.id).filter(Boolean));
      setScriptsLibrary({
        root: text(result?.root),
        scripts: rows,
      });
      setScriptEditor((current) => {
        const currentKey = scriptPathKey(current) || current?.id || "";
        if (currentKey && current?.local_path && !rowKeys.has(currentKey)) {
          return null;
        }
        return current;
      });
      setSelectedScriptKey((current) => (current && !rowKeys.has(current) ? "" : current));
      setScriptsState("ready");
      if (selectKey) {
        const target = rows.find((row) => (scriptPathKey(row) || row.id) === selectKey);
        if (target) {
          setSelectedScriptKey(selectKey);
        }
      }
    } catch (error) {
      setScriptsError(getErrorMessage(error, "Unable to load local scripts."));
      setScriptsState("error");
    }
  }, []);

  const readLocalScript = useCallback(async (script) => {
    const pathKey = scriptPathKey(script);
    if (!pathKey) return;
    setScriptsState((current) => (current === "ready" ? "refreshing" : current));
    setScriptsError("");
    try {
      const result = await invoke("local_scripts_read", {
        request: { path_key: pathKey },
      });
      const editor = scriptEditorDraft(result?.script || script);
      setSelectedScriptKey(scriptPathKey(editor) || editor.id || pathKey);
      setScriptEditor(editor);
      setScriptsLibrary((current) => ({
        ...current,
        scripts: current.scripts.map((row) => (
          (scriptPathKey(row) || row.id) === pathKey ? { ...row, ...editor, content: "" } : row
        )),
      }));
      setScriptsState("ready");
    } catch (error) {
      setScriptsError(getErrorMessage(error, "Unable to read local script."));
      setScriptsState("ready");
    }
  }, []);

  const saveLocalScript = useCallback(async (editor = scriptEditor) => {
    if (!editor) return false;
    setScriptsState("saving");
    setScriptsError("");
    setScriptsMessage("");
    try {
      const result = await invoke("local_scripts_save", {
        request: scriptSaveRequest(editor),
      });
      const saved = scriptEditorDraft(result?.script || editor);
      const key = scriptPathKey(saved) || saved.id;
      setScriptEditor(saved);
      setSelectedScriptKey(key);
      setSelectedScriptLogKey(key);
      setScriptsLibrary((current) => {
        const nextRows = [...current.scripts];
        const index = nextRows.findIndex((row) => (scriptPathKey(row) || row.id) === key);
        const savedRow = { ...saved, content: "" };
        if (index >= 0) {
          nextRows[index] = savedRow;
        } else {
          nextRows.push(savedRow);
        }
        nextRows.sort((a, b) => scriptPathKey(a).localeCompare(scriptPathKey(b)));
        return { ...current, scripts: nextRows };
      });
      setScriptsState("ready");
      setScriptsMessage("Saved locally.");
      onLocalScriptsChanged?.();
      return true;
    } catch (error) {
      setScriptsError(getErrorMessage(error, "Unable to save local script."));
      setScriptsState("ready");
      return false;
    }
  }, [onLocalScriptsChanged, scriptEditor]);

  const runLocalScript = useCallback(async (script = scriptEditor) => {
    const source = script || scriptEditor;
    const pathKey = scriptPathKey(source);
    if (!pathKey) return null;
    setScriptsState("running");
    setScriptsError("");
    setScriptsMessage("");
    const runId = `script:${pathKey}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const startedAt = new Date().toISOString();
    setSelectedScriptLogKey(pathKey);
    setScriptPaneTab("logs");
    setScriptRunResults((current) => ({
      ...current,
      [pathKey]: {
        chunks: [],
        duration_ms: 0,
        ended_at: "",
        error: "",
        exit_code: null,
        ok: null,
        path_key: pathKey,
        run_id: runId,
        script: source,
        state: "running",
        stderr: "",
        stdout: "",
        started_at: startedAt,
        timed_out: false,
        updated_at: Date.now(),
      },
      [runId]: {
        chunks: [],
        duration_ms: 0,
        ended_at: "",
        error: "",
        exit_code: null,
        ok: null,
        path_key: pathKey,
        run_id: runId,
        script: source,
        state: "running",
        stderr: "",
        stdout: "",
        started_at: startedAt,
        timed_out: false,
        updated_at: Date.now(),
      },
    }));
    try {
      const result = await invoke("local_scripts_run", {
        request: {
          default_working_directory: defaultWorkingDirectory,
          cause: "manual",
          path_key: pathKey,
          run_id: runId,
          source_kind: "tools_editor",
        },
      });
      const resultState = text(result?.state || result?.run_status).toLowerCase();
      const queued = result?.queued === true || resultState === "queued";
      const running = resultState === "running";
      setScriptRunResults((current) => {
        const nextLog = {
          chunks: [
            String(result?.stdout ?? "").length ? { stream: "stdout", text: String(result?.stdout ?? "") } : null,
            String(result?.stderr ?? "").length ? { stream: "stderr", text: String(result?.stderr ?? "") } : null,
          ].filter(Boolean),
          duration_ms: queued || running ? 0 : Number(result?.duration_ms) || 0,
          ended_at: queued || running ? "" : text(result?.ended_at, new Date().toISOString()),
          exit_code: result?.exit_code,
          error: text(result?.error),
          ok: queued || running ? null : result?.ok !== false,
          path_key: pathKey,
          run_id: text(result?.run_id, runId),
          script: source,
          state: queued ? "queued" : running ? "running" : result?.ok === false || resultState === "failed" ? "error" : "ready",
          stderr: String(result?.stderr ?? ""),
          stderr_truncated: Boolean(result?.stderr_truncated),
          stdout: String(result?.stdout ?? ""),
          stdout_truncated: Boolean(result?.stdout_truncated),
          timed_out: Boolean(result?.timed_out),
          started_at: text(result?.started_at, startedAt),
          updated_at: Date.now(),
        };
        return {
          ...current,
          [pathKey]: nextLog,
          [nextLog.run_id || runId]: nextLog,
        };
      });
      setScriptsState("ready");
      return result;
    } catch (error) {
      const message = getErrorMessage(error, "Unable to run local script.");
      setScriptsError(message);
      setScriptsState("ready");
      setScriptRunResults((current) => ({
        ...current,
        [pathKey]: {
          ...(current[pathKey] || {}),
          ended_at: new Date().toISOString(),
          error: message,
          path_key: pathKey,
          run_id: runId,
          script: source,
          state: "error",
          updated_at: Date.now(),
        },
        [runId]: {
          ...(current[runId] || current[pathKey] || {}),
          ended_at: new Date().toISOString(),
          error: message,
          path_key: pathKey,
          run_id: runId,
          script: source,
          state: "error",
          updated_at: Date.now(),
        },
      }));
      return null;
    }
  }, [defaultWorkingDirectory, scriptEditor, scriptRunResults, sharedScriptRunResults]);

  const markScriptCompletion = useCallback((pathKey, ok = true) => {
    const safePathKey = normalizedDocumentPath(pathKey);
    if (!safePathKey) return;
    if (typeof window === "undefined") return;
    const timers = scriptCompletionTimersRef.current;
    const existingTimer = timers.get(safePathKey);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      timers.delete(safePathKey);
    }
    setScriptCompletionMarkers((current) => ({
      ...current,
      [safePathKey]: {
        ok: ok !== false,
        updated_at: Date.now(),
      },
    }));
    const timer = window.setTimeout(() => {
      timers.delete(safePathKey);
      setScriptCompletionMarkers((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, safePathKey)) return current;
        const next = { ...current };
        delete next[safePathKey];
        return next;
      });
    }, SCRIPT_EXPLORER_FINISH_BADGE_MS);
    timers.set(safePathKey, timer);
  }, []);

  const loadScriptRunHistory = useCallback(async (pathKey = "") => {
    try {
      const result = await invoke("local_scripts_run_history", {
        request: {
          limit: 100,
          path_key: pathKey,
        },
      });
      setScriptRunHistory(Array.isArray(result?.runs) ? result.runs : []);
    } catch {
      setScriptRunHistory([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      scriptCompletionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      scriptCompletionTimersRef.current.clear();
      if (scriptHistoryScrollFrameRef.current) {
        window.cancelAnimationFrame(scriptHistoryScrollFrameRef.current);
        scriptHistoryScrollFrameRef.current = 0;
      }
    };
  }, []);

  const deleteLocalScript = useCallback(async (script = scriptEditor) => {
    const pathKey = scriptPathKey(script);
    if (!pathKey) return false;
    setScriptsState("deleting");
    setScriptsError("");
    try {
      await invoke("local_scripts_delete", {
        request: { path_key: pathKey },
      });
      setScriptsLibrary((current) => ({
        ...current,
        scripts: current.scripts.filter((row) => (scriptPathKey(row) || row.id) !== pathKey),
      }));
      setScriptEditor((current) => (
        (scriptPathKey(current) || current?.id) === pathKey ? null : current
      ));
      setSelectedScriptKey((current) => (current === pathKey ? "" : current));
      setSelectedScriptLogKey((current) => (current === pathKey ? "" : current));
      setScriptRunResults((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, pathKey)) return current;
        const next = { ...current };
        delete next[pathKey];
        return next;
      });
      setScriptsState("ready");
      setScriptsMessage("Deleted local script.");
      onLocalScriptsChanged?.();
      return true;
    } catch (error) {
      setScriptsError(getErrorMessage(error, "Unable to delete local script."));
      setScriptsState("ready");
      return false;
    }
  }, [onLocalScriptsChanged, scriptEditor]);

  const closeScriptsContextMenu = useCallback(() => {
    setScriptsContextMenu(null);
  }, []);

  const openScriptsContextMenu = useCallback((event, target = {}) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 176;
    const menuHeight = target.kind === "script" ? 80 : 44;
    const position = workspaceContextMenuPosition(event, scriptsWorkspaceSurfaceRef.current, menuWidth, menuHeight);
    setScriptsContextMenu({
      target,
      x: position.x,
      y: position.y,
    });
  }, []);

  const beginCreateLocalScript = useCallback(() => {
    closeScriptsContextMenu();
    setScriptsError("");
    setScriptsMessage("");
    setSelectedScriptKey("");
    setSelectedScriptLogKey("");
    setScriptPaneTab("editor");
    setScriptEditor(null);
    setNewScriptDraft((current) => ({ ...current, name: "" }));
  }, [closeScriptsContextMenu]);

  const createLocalScriptDraft = useCallback(() => {
    const name = text(newScriptDraft.name, "New Script");
    const shell = scriptShellOption(newScriptDraft.shell).id;
    const extension = scriptExtensionForShell(shell);
    const existingScriptNames = new Set(
      scriptsLibrary.scripts
        .flatMap((row) => {
          const key = scriptPathKey(row);
          const fileName = scriptFileName(row);
          const stem = fileName.replace(/\.[^.]+$/u, "");
          return [key, fileName, stem].filter(Boolean);
        }),
    );
    const pathKey = `${skillSlug(name, existingScriptNames)}.${extension}`;
    setSelectedScriptKey("");
    setSelectedScriptLogKey(pathKey);
    setScriptPaneTab("editor");
    setScriptEditor(scriptEditorDraft({
      content: shell === "python3"
        ? "#!/usr/bin/env python3\n\nprint(\"hello from Diff Forge\")\n"
        : shell === "node"
          ? "#!/usr/bin/env node\n\nconsole.log(\"hello from Diff Forge\");\n"
          : "#!/usr/bin/env zsh\n\nprintf 'hello from Diff Forge\\n'\n",
      extension,
      loopspace_button_color: newScriptDraft.loopspace_button_color,
      loopspace_text_color: newScriptDraft.loopspace_text_color,
      path_key: pathKey,
      shell,
      title: name,
      workspace_button_color: newScriptDraft.workspace_button_color,
      workspace_text_color: newScriptDraft.workspace_text_color,
    }));
  }, [newScriptDraft, scriptsLibrary.scripts]);

  const deleteContextScript = useCallback((target = scriptsContextMenu?.target || {}) => {
    closeScriptsContextMenu();
    const script = target.script || target;
    void deleteLocalScript(script);
  }, [closeScriptsContextMenu, deleteLocalScript, scriptsContextMenu]);

  useEffect(() => {
    if (!scriptsContextMenu) return undefined;
    const closeMenu = (event) => {
      if (event?.target?.closest?.("[data-scripts-context-menu='true']")) return;
      closeScriptsContextMenu();
    };
    const closeOnKey = (event) => {
      if (event.key === "Escape") closeScriptsContextMenu();
    };
    window.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", closeOnKey, true);
    window.addEventListener("resize", closeScriptsContextMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", closeOnKey, true);
      window.removeEventListener("resize", closeScriptsContextMenu);
    };
  }, [closeScriptsContextMenu, scriptsContextMenu]);

  const collapseScriptsExplorer = useCallback(() => {
    setScriptsExplorerCollapsed(true);
  }, []);

  const expandScriptsExplorer = useCallback(() => {
    setScriptsExplorerCollapsed(false);
  }, []);

  const syncScriptsExplorerCollapsedState = useCallback((panelSize) => {
    const pixels = Number(panelSize?.pixels);
    const percentage = Number(panelSize?.percentage);
    const collapsed = Number.isFinite(pixels) ? pixels <= 58 : Number.isFinite(percentage) && percentage <= 6;
    setScriptsExplorerCollapsed(collapsed);
    if (!collapsed && Number.isFinite(pixels)) {
      setScriptsExplorerSize(`${Math.round(pixels)}px`);
    }
  }, []);

  useEffect(() => {
    void loadLocalScripts();
  }, [loadLocalScripts]);

  useEffect(() => {
    if (scriptsExplorerCollapsed) return undefined;
    if (typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      scriptsExplorerPanelRef.current?.resize?.(scriptsExplorerSize);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scriptsExplorerCollapsed, scriptsExplorerSize]);

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
        run_id: hydrationRunId,
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
          if (current.run_id !== hydrationRunId || current.state !== "hydrating") return current;
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
          const localSkillsLibrary = {
            skills: mergeSkillUnits(getWorkspaceToolsAccountSkills(), localUnits),
          };
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
        updated_at: text(skills.updated_at),
        updated_by: text(skills.updated_by_device_name),
        offline: Boolean(data?.offline),
      });
      setSkillsState("ready");
      if (showProgress && skillsHydrationRunRef.current === hydrationRunId) {
        const hydratedUnits = units.filter((unit) => (
          text(unit?.content_md ?? unit?.content).length
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
          run_id: hydrationRunId,
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
          run_id: hydrationRunId,
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
          agent_id: `cli-${entry.id}`,
          agent_label: entry.label,
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
	      setDocumentDrafts(getWorkspaceToolsDocumentDrafts());
	      if (hasWorkspaceToolsLoaded()) {
	        setSkillsState((current) => (current === "loading" ? "ready" : current));
	      }
	    });
	  }, []);

	  const selectedDocumentDraft = useMemo(() => {
	    const drafts = Array.isArray(documentDrafts) ? documentDrafts : [];
	    if (!drafts.length) return null;
	    if (skillEditor) {
	      return drafts.find((draft) => documentDraftMatchesEditor(draft, skillEditor, selectedSkillKey)) || null;
	    }
	    if (selectedSkillKey) {
	      return drafts.find((draft) => text(draft?.selected_key) === selectedSkillKey) || null;
	    }
	    return documentDraft || drafts.at(-1) || null;
	  }, [documentDraft, documentDrafts, selectedSkillKey, skillEditor]);

	  useEffect(() => {
	    if (!selectedDocumentDraft) return;
	    const draftEditor = documentEditorDraft(selectedDocumentDraft);
	    const draftContent = String(draftEditor.content || "");
	    const persistKey = [
	      draftEditor.document_key,
	      draftEditor.path_key,
	      draftEditor.title,
	      documentDraftFingerprint(draftContent),
	    ].map(text).join("|");
	    setSkillEditor((current) => {
	      if (!documentDraftMatchesEditor(selectedDocumentDraft, current, selectedSkillKey)) {
	        return current;
	      }
	      const activeHumanEdit = Date.now() - lastHumanDocumentEditAtRef.current < ACCOUNT_DOCS_DRAFT_HUMAN_EDIT_GUARD_MS;
	      const preserveHumanContent = activeHumanEdit
	        && String(current?.content || "") !== draftContent;
	      const next = {
	        ...current,
	        ...draftEditor,
	        content: preserveHumanContent ? String(current?.content || "") : draftEditor.content,
	        draftContentGuarded: preserveHumanContent,
	        document_key: draftEditor.document_key || current.document_key,
	        selected_key: draftEditor.selected_key || current.selected_key,
	      };
	      if (!preserveHumanContent) {
	        delete next.draftContentGuarded;
	      }
      const unchanged = [
        "baseContent",
        "base_content_hash",
        "canonical_local_path",
        "content",
        "content_hash",
        "document_key",
        "draftContentGuarded",
        "draft_id",
        "draft_path",
        "file_path",
        "local_path",
        "path_key",
        "selected_key",
        "sync_status",
        "title",
      ].every((key) => String(current?.[key] ?? "") === String(next?.[key] ?? ""));
      if (unchanged) return current;
	      documentDraftPersistRef.current = {
	        key: persistKey,
	        run: documentDraftPersistRef.current.run + 1,
	      };
	      return next;
	    });
	  }, [documentDraftApplyTick, selectedDocumentDraft, selectedSkillKey]);

	  useEffect(() => {
	    if (!selectedDocumentDraft || !skillEditor) return undefined;
	    if (!documentDraftMatchesEditor(selectedDocumentDraft, skillEditor, selectedSkillKey)) return undefined;
	    const draftEditor = documentEditorDraft(selectedDocumentDraft);
	    if (String(skillEditor.content || "") === String(draftEditor.content || "")) return undefined;
	    const remainingGuardMs = ACCOUNT_DOCS_DRAFT_HUMAN_EDIT_GUARD_MS
	      - (Date.now() - lastHumanDocumentEditAtRef.current);
	    if (remainingGuardMs <= 0) return undefined;
	    const timer = window.setTimeout(() => {
	      setDocumentDraftApplyTick((current) => current + 1);
	    }, remainingGuardMs + 25);
	    return () => window.clearTimeout(timer);
	  }, [selectedDocumentDraft, selectedSkillKey, skillEditor]);

  useEffect(() => {
    void refreshCliStatuses();
  }, [refreshCliStatuses]);

  useEffect(() => {
    skillsLibraryRef.current = skillsLibrary;
  }, [skillsLibrary]);

  useEffect(() => {
    if (!hydratingDocKeys.size) return;
    const skillsByKey = new Map((skillsLibrary.skills || [])
      .map((skill) => [accountDocumentStorageKey(skill) || text(skill?.id), skill])
      .filter(([key]) => key));
    setHydratingDocKeys((current) => {
      let changed = false;
      const next = new Set();
      current.forEach((key) => {
        const skill = skillsByKey.get(key);
        if (skill && documentNeedsHydration(skill)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [hydratingDocKeys.size, skillsLibrary.skills]);

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
          .filter((entry) => {
            const key = accountDocumentStorageKey(entry) || text(entry?.id);
            const existing = key
              ? (skillsLibraryRef.current.skills || [])
                .find((candidate) => (accountDocumentStorageKey(candidate) || text(candidate?.id)) === key)
              : null;
            if (existing && documentHasCurrentMaterializedContent(existing, entry)) {
              return false;
            }
            return documentNeedsHydration(entry);
          });
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
              accountDocumentStorageKey(entry) === (current?.document_key || accountDocumentStorageKey(current))
            ));
            return editorWithRemoteDocumentContent(current, incoming);
          });
        }
        const revisionUnit = skillUnits.find((unit) => unit?.revision != null);
        const revision = Number.isFinite(Number(skillMeta.revision))
          ? Number(skillMeta.revision)
          : Number(revisionUnit?.revision);
        setSkillsRevision((current) => (Number.isFinite(revision) ? revision : current));
        const updatedUnit = skillUnits.find((unit) => unit?.updated_at);
        const errorUnit = skillUnits.find((unit) => unit?.last_sync_error || unit?.error);
        setSkillsMeta((current) => ({
          ...current,
          updated_at: text(skillMeta.updated_at || updatedUnit?.updated_at, current.updated_at),
          updated_by: text(skillMeta.updated_by, current.updated_by),
          offline: false,
        }));
        setSkillsState("ready");
        setSkillsError(text(skillMeta.error || errorUnit?.last_sync_error || errorUnit?.error));
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

  // The Rust updater emits per-stage progress (queued/downloading/installing/
  // verifying/complete/failed) between inventory refreshes; merge each stage
  // into the matching CLI status row so the list tracks the update live.
  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("agent-update-progress", (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const provider = text(payload.provider).toLowerCase();
      const stage = text(payload.stage).toLowerCase();
      if (!provider || !stage) {
        return;
      }
      const stageSeq = Number(payload.stage_seq) || 0;
      setCliStatuses((current) => (Array.isArray(current) ? current : []).map((status) => {
        if (text(status?.provider || status?.id).toLowerCase() !== provider) {
          return status;
        }
        const currentSeq = Number(status?.update_stage_seq ?? status?.updateStageSeq) || 0;
        if (stageSeq && currentSeq && stageSeq < currentSeq) {
          return status;
        }
        return {
          ...status,
          update_stage: stage,
          update_stage_seq: stageSeq,
          update_to_version: text(payload.to_version),
          update_error_reason: text(payload.error_reason),
          update_failed_stage: text(payload.failed_stage),
        };
      }));
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
      .filter(([key]) => key && !nextByKey.has(key))
      .map(([, skill]) => skill);
    const upserts = nextLibrary.skills.filter((skill) => {
      const key = accountDocumentStorageKey(skill);
      const keyOrId = key || text(skill?.id);
      const current = key ? currentByKey.get(key) : null;
      if (documentIsFolderRow(skill)) {
        return forcedIds.has(keyOrId)
          || !current
          || text(current.title) !== text(skill.title)
          || normalizedDocumentPath(current.path_key || current.folder_path || current.id) !== normalizedDocumentPath(skill.path_key || skill.folder_path || skill.id)
          || normalizedDocumentPath(current.parent_path_key || current.parent_folder_id) !== normalizedDocumentPath(skill.parent_path_key || skill.parent_folder_id);
      }
      return forcedIds.has(keyOrId)
        || !current
        || String(current.content || "") !== String(skill.content || "")
        || text(current.title) !== text(skill.title)
        || text(current.document_kind) !== text(skill.document_kind)
        || text(current.collection) !== text(skill.collection)
        || normalizedDocumentPath(current.path_key || current.file_path) !== normalizedDocumentPath(skill.path_key || skill.file_path)
        || skill.pending_push === true;
    });
    setSkillsLibrary(nextLibrary);
    setSkillsState("saving");
    setSkillsError("");
    noteAccountSkillUnits(nextLibrary.skills);
	    try {
	      const results = [];
		      for (const skill of removed) {
		        await discardSkillDraftFile(skill);
		        results.push(await invoke("cloud_mcp_delete_account_document", {
		          request: accountDocumentRequestFromSkill(skill),
		        }));
		      }
		      for (const skill of upserts) {
		        const hasDraftFile = skillHasDraftFile(skill);
		        results.push(await invoke(hasDraftFile ? "cloud_mcp_save_account_document_draft" : "cloud_mcp_save_account_document", {
		          request: accountDocumentRequestFromSkill(skill),
		        }));
	      }
      const result = [...results].reverse().find((entry) => entry) || {};
      const failed = results.find((entry) => text(entry?.cloud_error));
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
      setSkillsMeta((current) => ({
        ...current,
        updated_at: text(result?.updated_at, current.updated_at),
        offline: false,
      }));
      if (failed) {
        throw new Error(text(failed.cloud_error, "Cloud did not accept the document sync."));
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
	          const savedSkill = result ? clearDraftFileSkill(skill) : skill;
	          if (result && result.cloud_synced !== true) {
	            return withLocalPendingSkill(savedSkill, text(result.document?.local_saved_at || skill.local_saved_at));
	          }
	          return clearLocalPendingSkill(savedSkill);
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
		        const hasDraftFile = skillHasDraftFile(skill);
		        results.push(await invoke(hasDraftFile ? "cloud_mcp_save_account_document_draft" : "cloud_mcp_save_account_document", {
		          request: accountDocumentRequestFromSkill(skill, {
		            allow_conflict: hasDraftFile,
		            local_only: true,
		          }),
		        }));
	      }
      const result = [...results].reverse().find((entry) => entry) || {};
      setSkillsRevision(
        Number.isFinite(Number(result?.revision)) ? Number(result.revision) : skillsRevision,
      );
	      setSkillsMeta((current) => ({
	        ...current,
	        updated_at: text(result?.local_saved_at || current.updated_at),
	        offline: false,
	      }));
	      const syncedLibrary = {
	        skills: nextLibrary.skills.map((skill) => {
	          const key = accountDocumentStorageKey(skill) || skill.id;
	          if (!pendingIds.has(key) || documentIsFolderRow(skill)) return skill;
	          return withLocalPendingSkill(clearDraftFileSkill(skill), text(result?.local_saved_at || localSavedAt));
	        }),
	      };
	      setSkillsLibrary(syncedLibrary);
	      noteAccountSkillUnits(syncedLibrary.skills);
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
      document_kind: "skill",
      extension: "md",
      id: skillId,
    });
    const skill = {
      collection: "documents",
      content: String(entry.content || ""),
      document_kind: "skill",
      extension: "md",
      ...pathMeta,
      icon: text(entry.icon),
      id: skillId,
      row_type: "document",
      source: "skill",
      title: skillId,
      tone: text(entry.tone),
      updated_at: new Date().toISOString(),
    };
    void persistSkillsLibrary([...skillsLibrary.skills, skill]);
    setSelectedSkillKey(`library:${accountDocumentStorageKey(skill)}`);
    setSkillEditor(documentEditorDraft(skill));
  }, [persistSkillsLibrary, skillsLibrary.skills]);

	  const removeDocument = useCallback((documentKeyOrId) => {
	    if (skillEditor?.isDraft || skillEditor?.draft || text(skillEditor?.sync_status) === "draft") {
	      const requestedKey = text(documentKeyOrId);
	      const draftKey = documentDraftClearKey(skillEditor);
	      const editorKeys = [
	        draftKey,
	        text(skillEditor.document_key),
	        documentDraftKey(skillEditor),
	        accountDocumentStorageKey(skillEditor),
	        normalizedDocumentPath(skillEditor.path_key || skillEditor.file_path),
	        text(skillEditor.id),
	      ].filter(Boolean);
	      if (
	        !requestedKey
	        || requestedKey.startsWith("draft:")
	        || editorKeys.includes(requestedKey)
	        || editorKeys.includes(normalizedDocumentPath(requestedKey))
	      ) {
	        invalidateDocumentDraftPersist();
	        void discardSkillDraftFile(skillEditor);
	        clearWorkspaceToolsDocumentDraft(draftKey);
	        setSelectedSkillKey("");
	        setSkillEditor(null);
	        return;
	      }
    }
    const document = skillsLibrary.skills.find((entry) => (
      !documentIsFolderRow(entry)
      && (accountDocumentStorageKey(entry) === documentKeyOrId || entry.id === documentKeyOrId)
    ));
    if (!document) return;
    const documentKey = accountDocumentStorageKey(document) || document.id;
	    if (typeof window !== "undefined" && !window.confirm(`Remove the doc "${document.title}"?`)) {
	      return;
	    }
	    invalidateDocumentDraftPersist();
	    void discardSkillDraftFile(document);
	    void persistSkillsLibrary(skillsLibrary.skills.filter((entry) => (
	      (accountDocumentStorageKey(entry) || entry.id) !== documentKey
	    )));
	    setSelectedSkillKey("");
	    setSkillEditor(null);
	  }, [invalidateDocumentDraftPersist, persistSkillsLibrary, skillEditor, skillsLibrary.skills]);

  const closeDocsContextMenu = useCallback(() => {
    setDocsContextMenu(null);
  }, []);

  const openDocsContextMenu = useCallback((event, target = {}) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 190;
    const menuHeight = target.kind === "root" ? 72 : 112;
    const position = workspaceContextMenuPosition(event, docsWorkspaceSurfaceRef.current, menuWidth, menuHeight);
    setDocsContextMenu({
      target,
      x: position.x,
      y: position.y,
    });
  }, []);

  const beginContextCreateDocument = useCallback((target = docsContextMenu?.target || {}) => {
    closeDocsContextMenu();
    const folderPath = docsCreateTargetFolder(target);
    setSelectedSkillKey("");
    setSkillEditor(null);
    setNewDocDraft((current) => ({
      ...current,
      createKind: "document",
      folder_path: folderPath,
    }));
    setDocsCreateActive(true);
  }, [closeDocsContextMenu, docsContextMenu]);

  const beginContextCreateFolder = useCallback((target = docsContextMenu?.target || {}) => {
    closeDocsContextMenu();
    const folderPath = docsCreateTargetFolder(target);
    setSelectedSkillKey("");
    setSkillEditor(null);
    setNewDocDraft((current) => ({
      ...current,
      createKind: "folder",
      folder_path: folderPath,
    }));
    setDocsCreateActive(true);
  }, [closeDocsContextMenu, docsContextMenu]);

  const createDocumentFolder = useCallback((parentPathInput = "", folderNameInput = "") => {
    const parentPath = normalizedDocumentPath(parentPathInput);
    const folderName = text(folderNameInput);
    if (!folderName) return false;
    const normalizedName = skillSlug(folderName || "");
    if (!normalizedName) return false;
    const basePath = parentPath ? `${parentPath}/${normalizedName}` : normalizedName;
    const existingPaths = new Set(skillsLibrary.skills
      .filter(documentIsFolderRow)
      .map((entry) => normalizedDocumentPath(entry.path_key || entry.folder_path || entry.id))
      .filter(Boolean));
    let folderPath = basePath;
    let suffix = 2;
    while (existingPaths.has(folderPath)) {
      folderPath = `${basePath}_${suffix}`;
      suffix += 1;
    }
    const folder = documentFolderRow(folderPath);
    if (!folder) return false;
    const nextSkills = [
      ...skillsLibrary.skills.filter((entry) => (accountDocumentStorageKey(entry) || entry.id) !== accountDocumentStorageKey(folder)),
      folder,
    ];
    void persistSkillsLibrary(nextSkills, [accountDocumentStorageKey(folder)]);
    setSelectedSkillKey("");
    setSkillEditor(null);
    setNewDocDraft((current) => ({
      ...current,
      createKind: "document",
      name: "",
      folder_path: folderPath,
    }));
    setDocsCreateActive(false);
    return true;
  }, [persistSkillsLibrary, skillsLibrary.skills]);

	  const deleteContextTarget = useCallback((target = docsContextMenu?.target || {}) => {
	    closeDocsContextMenu();
	    const targetKind = text(target.kind);
	    if (targetKind === "document") {
	      if (target.isDraft || target.draft || text(target.sync_status) === "draft") {
		        const targetDraft = target.draft_document || target;
		        const targetClearKey = documentDraftClearKey(targetDraft, target.storage_key || target.document_key);
		        invalidateDocumentDraftPersist();
		        void discardSkillDraftFile(targetDraft);
		        clearWorkspaceToolsDocumentDraft(targetClearKey);
		        setDocumentDraft(getWorkspaceToolsDocumentDraft());
		        setDocumentDrafts(getWorkspaceToolsDocumentDrafts());
		        if (
		          (skillEditor?.document_key || documentDraftKey(skillEditor)) === target.storage_key
		          || documentDraftMatchesEditor(targetDraft, skillEditor, selectedSkillKey)
		        ) {
          setSkillEditor(null);
          setSelectedSkillKey("");
        }
        return;
      }
      removeDocument(target.storage_key);
      return;
    }
    if (targetKind !== "folder") return;
    const folderPath = normalizedDocumentPath(target.path_key);
    if (!folderPath) return;
    const affectedDocs = skillsLibrary.skills.filter((entry) => (
      !documentIsFolderRow(entry)
      && documentPathIsSameOrChild(
        entry.path_key || entry.file_path || accountDocumentStorageKey(entry),
        folderPath,
      )
    ));
    const affectedFolders = skillsLibrary.skills.filter((entry) => (
      documentIsFolderRow(entry)
      && documentPathIsSameOrChild(entry.path_key || entry.folder_path || entry.id, folderPath)
    ));
    const label = text(target.display_name || target.title, folderPath);
    const confirmed = typeof window === "undefined" || window.confirm(
      `Delete folder "${label}"${affectedDocs.length ? ` and ${affectedDocs.length} doc${affectedDocs.length === 1 ? "" : "s"}` : ""}?`,
    );
    if (!confirmed) return;
    const removedKeys = new Set([...affectedDocs, ...affectedFolders]
      .map((entry) => accountDocumentStorageKey(entry) || entry.id)
      .filter(Boolean));
    const nextSkills = skillsLibrary.skills.filter((entry) => !removedKeys.has(accountDocumentStorageKey(entry) || entry.id));
    const selectedKey = selectedSkillKey.startsWith("library:") ? selectedSkillKey.slice("library:".length) : "";
    if (
      selectedKey && affectedDocs.some((entry) => (accountDocumentStorageKey(entry) || entry.id) === selectedKey)
    ) {
      setSelectedSkillKey("");
      setSkillEditor(null);
    }
		    documentDrafts.forEach((draft) => {
		      const draftPath = normalizedDocumentPath(draft?.path_key || draft?.file_path);
		      if (draftPath && documentPathIsSameOrChild(draftPath, folderPath)) {
		        invalidateDocumentDraftPersist();
		        void discardSkillDraftFile(draft);
		        clearWorkspaceToolsDocumentDraft(documentDraftClearKey(draft));
		      }
		    });
		    setDocumentDraft(getWorkspaceToolsDocumentDraft());
		    setDocumentDrafts(getWorkspaceToolsDocumentDrafts());
    setNewDocDraft((current) => ({
      ...current,
      folder_path: documentPathIsSameOrChild(current.folder_path, folderPath) ? "" : current.folder_path,
    }));
    void persistSkillsLibrary(nextSkills);
  }, [
    closeDocsContextMenu,
    docsContextMenu,
	    documentDrafts,
	    invalidateDocumentDraftPersist,
	    persistSkillsLibrary,
    removeDocument,
    selectedSkillKey,
    skillEditor,
    skillsLibrary.skills,
  ]);

  useEffect(() => {
    if (!docsContextMenu) return undefined;
    const closeMenu = (event) => {
      if (event?.target?.closest?.("[data-docs-context-menu='true']")) return;
      closeDocsContextMenu();
    };
    const closeOnKey = (event) => {
      if (event.key === "Escape") closeDocsContextMenu();
    };
    window.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", closeOnKey, true);
    window.addEventListener("resize", closeDocsContextMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", closeOnKey, true);
      window.removeEventListener("resize", closeDocsContextMenu);
    };
  }, [closeDocsContextMenu, docsContextMenu]);

  const saveSkillEditor = useCallback(async (mode = "push", editorOverride = null) => {
    const activeEditor = editorOverride || skillEditor;
    if (!activeEditor || !text(activeEditor.title)) return false;
    const typeOption = documentTypeOption(activeEditor.document_kind || activeEditor.source, activeEditor.collection);
    const saveMode = text(mode, "push").toLowerCase();
    const draftMode = saveMode === "draft";
    const editorCollection = typeOption.collection;
    const editorKind = text(activeEditor.document_kind, typeOption.id);
    const editorExtension = text(activeEditor.extension, typeOption.extension);
    const displayTitle = text(activeEditor.title);
    const editorContent = String(activeEditor.content || "");
    const allowEditorEmptyOverwrite = editorContent.length === 0
      && String(activeEditor.baseContent ?? "").length > 0;
    const existing = activeEditor.id
      ? skillsLibrary.skills.find((entry) => (
        !documentIsFolderRow(entry)
        && (
        (activeEditor.document_key && accountDocumentStorageKey(entry) === activeEditor.document_key)
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
          allow_empty_overwrite: allowEditorEmptyOverwrite,
          base_content_hash: text(activeEditor.base_content_hash || entry.base_content_hash),
          canonical_local_path: text(activeEditor.canonical_local_path || entry.canonical_local_path),
          content: editorContent,
          document_kind: editorKind,
          draft_id: text(activeEditor.draft_id || entry.draft_id),
          draft_path: text(activeEditor.draft_path || entry.draft_path),
	          extension: editorExtension,
          collection: editorCollection,
          ...savedPathMeta,
          row_type: "document",
          source: editorKind,
          title: displayTitle,
          updated_at: updatedAt,
        }
        : entry));
    } else {
      savedId = text(activeEditor.id, skillSlug(activeEditor.title, new Set(skillsLibrary.skills.map((entry) => entry.id))));
      savedPathMeta = documentPathMetadata({
        ...activeEditor,
        extension: editorExtension,
        id: savedId,
      });
      nextSkills = [...skillsLibrary.skills, {
        collection: editorCollection,
        allow_empty_overwrite: allowEditorEmptyOverwrite,
        content: editorContent,
        base_content_hash: text(activeEditor.base_content_hash),
        canonical_local_path: text(activeEditor.canonical_local_path),
        document_kind: editorKind,
        draft_id: text(activeEditor.draft_id),
        draft_path: text(activeEditor.draft_path),
        extension: editorExtension,
        ...savedPathMeta,
        icon: "",
        id: savedId,
        local_path: text(activeEditor.local_path),
        row_type: "document",
        source: editorKind,
        title: displayTitle,
        tone: "",
        updated_at: updatedAt,
      }];
    }
    const savedKey = accountDocumentStorageKey({ id: savedId, ...savedPathMeta, row_type: "document" }) || savedId;
    let nextSkillsForSave = nextSkills;
    const pendingSavedSkill = nextSkills.find((entry) => (accountDocumentStorageKey(entry) || entry.id) === savedKey);
    if (pendingSavedSkill && !documentIsFolderRow(pendingSavedSkill)) {
      try {
        const prepareRequest = accountDocumentRequestFromSkill({
          ...pendingSavedSkill,
          base_content_hash: pendingSavedSkill.base_content_hash || activeEditor.base_content_hash || "",
          content: editorContent,
        }, { local_only: true });
        prepareRequest.reuse_existing = false;
        const draftResult = await invoke("cloud_mcp_prepare_account_document_draft", { request: prepareRequest });
        const preparedDocument = draftResult?.document || {};
        const draftFields = {
          base_content_hash: text(draftResult?.base_content_hash || preparedDocument.base_content_hash || pendingSavedSkill.base_content_hash),
          canonical_local_path: text(draftResult?.canonical_local_path || preparedDocument.canonical_local_path || pendingSavedSkill.canonical_local_path),
          draft_id: text(draftResult?.draft_id || preparedDocument.draft_id || pendingSavedSkill.draft_id),
          draft_path: text(draftResult?.draft_path || preparedDocument.draft_path || pendingSavedSkill.draft_path),
        };
        nextSkillsForSave = nextSkills.map((entry) => ((accountDocumentStorageKey(entry) || entry.id) === savedKey
          ? { ...entry, ...draftFields }
          : entry));
        if (draftMode) {
          const selectedKey = `library:${savedKey}`;
          const draftSnapshot = editorDraftSnapshot({
            ...pendingSavedSkill,
            ...draftFields,
            baseContent: String(activeEditor.baseContent ?? pendingSavedSkill.baseContent ?? ""),
            baseTitle: text(activeEditor.baseTitle || pendingSavedSkill.baseTitle || selectedSkill?.title || displayTitle),
            content: editorContent,
            local_path: text(preparedDocument.local_path || activeEditor.local_path),
          }, selectedKey, selectedSkill);
          const nextDraft = {
            ...draftSnapshot,
            ...draftFields,
            content: editorContent,
            content_hash: text(draftResult?.content_hash || preparedDocument.content_hash || draftSnapshot.content_hash),
            local_path: text(preparedDocument.local_path || draftSnapshot.local_path),
          };
	          setWorkspaceToolsDocumentDraft(nextDraft);
	          setDocumentDraft(nextDraft);
	          setDocumentDrafts(getWorkspaceToolsDocumentDrafts());
	          setSelectedSkillKey(selectedKey);
          setSkillEditor(documentEditorDraft(nextDraft));
          setSkillsError("");
          return true;
        }
      } catch (error) {
        setSkillsError(getErrorMessage(error, "Unable to prepare document draft before save."));
        return false;
      }
    }
    const savePromise = saveMode === "local"
      ? saveSkillsLibraryLocal(nextSkillsForSave, [savedKey])
      : persistSkillsLibrary(nextSkillsForSave, [savedKey]);
    const savedSkill = nextSkillsForSave.find((entry) => (accountDocumentStorageKey(entry) || entry.id) === savedKey);
    setSelectedSkillKey(`library:${savedKey}`);
    setSkillEditor({
      ...documentEditorDraft(savedSkill),
      document_key: savedKey,
    });
    const ok = await savePromise;
    if (ok) {
      const cleanedSkill = clearDraftFileSkill({
        ...(savedSkill || activeEditor),
        content: editorContent,
      });
      setSkillEditor({
        ...documentEditorDraft(cleanedSkill),
        baseContent: editorContent,
        content: editorContent,
        document_key: savedKey,
	      });
	      invalidateDocumentDraftPersist();
	      clearWorkspaceToolsDocumentDraft(documentDraftClearKey(activeEditor, savedKey));
	      setDocumentDraft(getWorkspaceToolsDocumentDraft());
	      setDocumentDrafts(getWorkspaceToolsDocumentDrafts());
	    }
    return ok;
  }, [invalidateDocumentDraftPersist, persistSkillsLibrary, saveSkillsLibraryLocal, selectedSkill, skillEditor, skillsLibrary.skills]);

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
      const progress = agentUpdateProgressFields(status);
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
        update_available: Boolean(status?.npm_update_available),
        updateErrorReason: progress.update_error_reason,
        updateFailedStage: progress.update_failed_stage,
        updateStage: progress.update_stage,
        updateStageSeq: progress.update_stage_seq,
        updateToVersion: progress.update_to_version,
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
      update_available: false,
      updateErrorReason: "",
      updateFailedStage: "",
      updateStage: "",
      updateStageSeq: 0,
      updateToVersion: "",
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
    () => skillsLibrary.skills.filter((skill) => !documentIsFolderRow(skill) && skill?.pending_push === true).length,
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
    if (skillsMeta.updated_at) parts.push(`updated ${timeAgo(skillsMeta.updated_at)}`);
    if (skillsMeta.updated_by) parts.push(`by ${skillsMeta.updated_by}`);
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
          child_count: 0,
          depth: index + 1,
          display_name: part,
          file_name: part,
          folder_path: current,
          key: `folder:${current}`,
          parent_path_key: parentPathKey,
          path_key: current,
          row_type: "folder",
          searchText: `${part} ${current}`.toLowerCase(),
          storage_key: `folder:${current}`,
          title: part,
        };
        folders.set(current, node);
      });
      if (node && source) {
        node.display_name = text(source.title || source.file_name, node.display_name);
        node.file_name = text(source.file_name, node.file_name);
        node.local_path = text(source.local_path, node.local_path);
        node.searchText = `${node.display_name} ${node.file_name} ${node.path_key} ${text(node.local_path)}`.toLowerCase();
      }
      return node;
	    };
	    const docs = [];
	    const allDocumentDrafts = Array.isArray(documentDrafts) ? documentDrafts : [];
	    const mergedDraftKeys = new Set();
	    (skillsLibrary.skills || []).forEach((skill) => {
      if (documentIsFolderRow(skill)) {
        const pathKey = normalizedDocumentPath(skill.path_key || skill.folder_path || skill.id);
        const folder = ensureFolder(pathKey, skill);
        if (folder) {
          folder.explicit = true;
          folder.local_path = text(skill.local_path, folder.local_path);
          folder.searchText = `${folder.display_name} ${folder.file_name} ${folder.path_key} ${folder.local_path}`.toLowerCase();
        }
        return;
      }
	      const key = accountDocumentStorageKey(skill) || skill.id;
	      if (!key) return;
	      const draftForSavedRow = allDocumentDrafts.find((draft) => (
	        documentDraftMatchesEditor(draft, skill, `library:${key}`)
	      )) || null;
	      const draftKey = draftForSavedRow
	        ? text(draftForSavedRow.document_key || documentDraftKey(draftForSavedRow))
	        : "";
	      if (draftForSavedRow) {
	        mergedDraftKeys.add(draftKey || accountDocumentStorageKey(draftForSavedRow) || text(draftForSavedRow.id));
	      }
	      const fileName = documentFileName(skill);
      const displayName = documentDisplayTitle(skill, fileName.replace(/\.(?:md|markdown|arch)$/iu, ""));
      const pathKey = normalizedDocumentPath(skill.path_key || skill.file_path || key);
      const parentPathKey = normalizedDocumentPath(skill.parent_path_key || skill.folder_path || pathKey.split("/").slice(0, -1).join("/"));
      ensureFolder(parentPathKey);
      const row = {
        ...skill,
        depth: parentPathKey ? parentPathKey.split("/").filter(Boolean).length + 1 : 1,
        display_name: displayName,
        file_name: fileName,
        file_path: normalizedDocumentPath(skill.file_path || pathKey),
        folder_path: parentPathKey,
	        draft: Boolean(draftForSavedRow),
	        draft_document: draftForSavedRow || null,
	        draftKey: draftForSavedRow ? draftKey : "",
        draftSelectedKey: draftForSavedRow ? `library:${key}` : "",
        hydrating: documentNeedsHydration(skill)
          && (hydratingDocKeys.has(key) || hydrationPassActive),
        isDraft: Boolean(draftForSavedRow),
        key: `library:${key}`,
        parent_path_key: parentPathKey,
        path_key: pathKey,
        preview: documentPreviewLine(draftForSavedRow || skill),
        row_type: "document",
        saved_storage_key: key,
        storage_key: draftForSavedRow ? draftKey : key,
        sync_status: draftForSavedRow ? "draft" : text(skill.sync_status),
        typeLabel: draftForSavedRow
          ? `${documentTypeLabel(skill.document_kind, skill.collection)} draft`
          : documentTypeLabel(skill.document_kind, skill.collection),
      };
      const matches = (
        !query
        || row.display_name.toLowerCase().includes(query)
        || row.file_name.toLowerCase().includes(query)
        || row.title.toLowerCase().includes(query)
        || row.path_key.toLowerCase().includes(query)
        || row.preview.toLowerCase().includes(query)
        || row.typeLabel.toLowerCase().includes(query)
        || text(draftForSavedRow?.title).toLowerCase().includes(query)
        || documentFileName(draftForSavedRow || {}).toLowerCase().includes(query)
        || normalizedDocumentPath(draftForSavedRow?.path_key || draftForSavedRow?.file_path).toLowerCase().includes(query)
        || text(row.local_path).toLowerCase().includes(query)
      );
	      if (matches) docs.push(row);
	    });
	    allDocumentDrafts.forEach((draft) => {
	      const draftKey = text(draft.document_key || documentDraftKey(draft));
	      const storageKey = accountDocumentStorageKey(draft) || text(draft.id);
	      if (mergedDraftKeys.has(draftKey) || mergedDraftKeys.has(storageKey)) return;
	      const fileName = documentFileName(draft);
	      const displayName = documentDisplayTitle(draft, fileName.replace(/\.(?:md|markdown|arch)$/iu, ""));
	      const pathKey = normalizedDocumentPath(draft.path_key || draft.file_path || fileName);
	      const parentPathKey = normalizedDocumentPath(draft.parent_path_key || draft.folder_path || pathKey.split("/").slice(0, -1).join("/"));
	      ensureFolder(parentPathKey);
	      const row = {
	        ...draft,
	        depth: parentPathKey ? parentPathKey.split("/").filter(Boolean).length + 1 : 1,
	        display_name: displayName,
	        draft: true,
	        file_name: fileName,
	        file_path: normalizedDocumentPath(draft.file_path || pathKey),
	        folder_path: parentPathKey,
	        hydrating: false,
	        isDraft: true,
	        key: `draft:${draftKey}`,
	        parent_path_key: parentPathKey,
	        path_key: pathKey,
	        preview: documentPreviewLine(draft),
	        row_type: "document",
	        selected_key: text(draft.selected_key),
	        storage_key: draftKey,
	        sync_status: "draft",
	        typeLabel: `${documentTypeLabel(draft.document_kind, draft.collection)} draft`,
	      };
	      const matches = (
	        !query
        || row.display_name.toLowerCase().includes(query)
        || row.file_name.toLowerCase().includes(query)
        || row.title.toLowerCase().includes(query)
        || row.path_key.toLowerCase().includes(query)
        || row.preview.toLowerCase().includes(query)
        || row.typeLabel.toLowerCase().includes(query)
	      );
	      if (matches) docs.push(row);
	    });
    docs.forEach((row) => {
      let current = row.parent_path_key;
      while (current) {
        const folder = folders.get(current);
        if (folder) folder.child_count += 1;
        current = current.split("/").slice(0, -1).join("/");
      }
    });
    const rows = [];
    const pushFolder = (folderPath) => {
      Array.from(folders.values())
        .filter((folder) => folder.parent_path_key === folderPath)
        .filter((folder) => (
          !query
          || folder.child_count > 0
          || folder.searchText.includes(query)
        ))
        .sort((left, right) => left.display_name.localeCompare(right.display_name))
        .forEach((folder) => {
          rows.push(folder);
          pushFolder(folder.path_key);
        });
      docs
        .filter((row) => row.parent_path_key === folderPath)
        .sort((left, right) => left.display_name.localeCompare(right.display_name))
        .forEach((row) => rows.push(row));
    };
    pushFolder("");
    return { files: docs, rows };
  }, [documentDrafts, hydratingDocKeys, skillsHydration.state, skillsHydration.visible, skillsLibrary.skills, skillsQuery]);
  const docFileRows = docsExplorerModel.files;
  const docsExplorerRows = docsExplorerModel.rows;

  useEffect(() => {
    if (!embeddedDocsPanel || !embeddedDocsOpenRequest) {
      return;
    }

    const requestKey = text(
      embeddedDocsOpenRequest.key || embeddedDocsOpenRequest.id || embeddedDocsOpenRequest.document_key || embeddedDocsOpenRequest.path_key,
    );
    if (!requestKey) {
      return;
    }

    const matchedRow = docFileRows.find((row) => (
      row.key === requestKey
        || row.key === `library:${requestKey}`
        || row.saved_storage_key === requestKey
        || row.storage_key === requestKey
        || accountDocumentStorageKey(row) === requestKey
        || row.id === requestKey
        || row.path_key === requestKey
        || row.file_path === requestKey
    ));
    if (!matchedRow) {
      return;
    }

    setSelectedSkillKey(matchedRow.key);
    setSkillEditor(documentEditorDraft(matchedRow));
    onEmbeddedDocsSelectionChange?.(matchedRow);
  }, [docFileRows, embeddedDocsOpenRequest, embeddedDocsPanel, onEmbeddedDocsSelectionChange]);

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
    const folderPath = normalizedDocumentPath(newDocDraft.folder_path);
    if (text(newDocDraft.createKind, "document") === "folder") {
      createDocumentFolder(folderPath, requestedName);
      return;
    }
    const option = documentTypeOption(newDocDraft.type);
    const existingIds = new Set(skillsLibrary.skills
      .filter((entry) => !documentIsFolderRow(entry))
      .flatMap((entry) => [
	        normalizedDocumentPath(entry.id),
	        normalizedDocumentPath(entry.path_key || entry.file_path).replace(/\.(?:md|markdown|arch|html|htm)$/iu, ""),
      ])
      .filter(Boolean));
    const docId = skillSlug(folderPath ? `${folderPath}/${requestedName}` : requestedName, existingIds);
    const title = docId.split("/").filter(Boolean).pop() || docId;
    const pathMeta = documentPathMetadata({
      document_kind: option.id,
      extension: option.extension,
      folder_path: folderPath,
      id: docId,
      title,
    });
    setSelectedSkillKey("");
    const draftEditor = {
	      baseContent: "",
	      collection: option.collection,
	      content: "",
	      content_hash: "",
	      document_key: documentDraftKey({ id: docId, ...pathMeta }),
	      document_kind: option.id,
	      draft: true,
	      extension: option.extension,
      mime_type: documentMimeTypeForKind(option.id, option.collection),
      ...pathMeta,
      id: docId,
      isDraft: true,
      local_path: "",
      row_type: "document",
      source: option.id,
      sync_status: "draft",
      title,
    };
    setSkillEditor(draftEditor);
    setWorkspaceToolsDocumentDraft(editorDraftSnapshot(draftEditor, "", null));
    setNewDocDraft((current) => ({ ...current, createKind: "document", name: "" }));
    setDocsCreateActive(false);
  }, [createDocumentFolder, newDocDraft, skillsLibrary.skills]);

	  useEffect(() => {
	    if (!skillEditor) return undefined;
	    if (!editorHasUnsavedDraft(skillEditor, selectedSkill)) return undefined;
	    if (skillEditor.draftContentGuarded === true) return undefined;
	    const snapshot = editorDraftSnapshot(skillEditor, selectedSkillKey, selectedSkill);
	    const content = String(snapshot?.content || "");
	    const persistKey = [
	      snapshot?.document_key,
	      snapshot?.path_key,
	      snapshot?.title,
	      documentDraftFingerprint(content),
	    ].map(text).join("|");
	    setWorkspaceToolsDocumentDraft(snapshot);
	    if (!persistKey || documentDraftPersistRef.current.key === persistKey) {
	      return undefined;
	    }
	    const run = documentDraftPersistRef.current.run + 1;
	    documentDraftPersistRef.current = { key: persistKey, run };
	    const timer = window.setTimeout(async () => {
	      try {
	        const request = accountDocumentRequestFromSkill({
	          ...snapshot,
	          base_content_hash: snapshot.base_content_hash || "",
	          content,
	        }, { local_only: true });
	        request.reuse_existing = false;
	        const result = await invoke("cloud_mcp_prepare_account_document_draft", { request });
	        if (documentDraftPersistRef.current.run !== run) return;
	        const preparedDocument = result?.document || {};
	        const nextDraft = {
	          ...snapshot,
	          base_content_hash: text(result?.base_content_hash || preparedDocument.base_content_hash || snapshot.base_content_hash),
	          canonical_local_path: text(result?.canonical_local_path || preparedDocument.canonical_local_path || snapshot.canonical_local_path),
	          content,
	          draft_id: text(result?.draft_id || preparedDocument.draft_id || snapshot.draft_id),
	          draft_path: text(result?.draft_path || preparedDocument.draft_path || snapshot.draft_path),
	          local_path: text(preparedDocument.local_path || snapshot.local_path),
	        };
	        setWorkspaceToolsDocumentDraft(nextDraft);
	        setSkillEditor((current) => {
	          if (!current) return current;
	          const currentKey = current.document_key || accountDocumentStorageKey(current) || current.id || "";
	          const snapshotKey = snapshot.document_key || accountDocumentStorageKey(snapshot) || snapshot.id || "";
	          if (currentKey !== snapshotKey) return current;
	          if (String(current.content || "") !== content) return current;
	          return {
	            ...current,
	            base_content_hash: nextDraft.base_content_hash,
	            canonical_local_path: nextDraft.canonical_local_path,
	            draft_id: nextDraft.draft_id,
	            draft_path: nextDraft.draft_path,
	            local_path: nextDraft.local_path,
	          };
	        });
	      } catch (error) {
	        if (documentDraftPersistRef.current.run === run) {
	          documentDraftPersistRef.current = { key: "", run };
	          setSkillsError(getErrorMessage(error, "Unable to prepare document draft file."));
	        }
	      }
	    }, 350);
	    return () => {
	      window.clearTimeout(timer);
	    };
	  }, [selectedSkill, selectedSkillKey, skillEditor]);

  useEffect(() => {
    if (!selectedSkill?.owned || !documentHasMaterializedContent(selectedSkill)) return;
    setSkillEditor((current) => editorWithRemoteDocumentContent(current, selectedSkill));
  }, [selectedSkill]);

  useEffect(() => {
    const selectedKey = selectedSkill?.owned ? accountDocumentStorageKey(selectedSkill) : "";
    if (!selectedKey) return;
    const editorKey = skillEditor?.document_key || accountDocumentStorageKey(skillEditor) || skillEditor?.id || "";
    const editorMatchesSelected = editorKey === selectedKey;
    const editorContent = String(skillEditor?.content || "");
    const editorBaseContent = String(skillEditor?.baseContent ?? skillEditor?.content ?? "");
    if (editorMatchesSelected && editorContent !== editorBaseContent) return;
    if (!documentNeedsHydration(selectedSkill)) return;
    if (
      (String(selectedSkill?.content || "").length > 0 || (editorMatchesSelected && editorContent.length > 0))
      && selectedSkill?.content_stale !== true
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
    ? skillEditor.document_key || accountDocumentStorageKey(skillEditor) || skillEditor.id
    : "";
  useEffect(() => {
    setSkillEditorSelection({
      direction: "",
      end: 0,
      start: 0,
      updated_at_ms: Date.now(),
    });
    setLastDocumentSelection(null);
  }, [skillEditorDocumentKey]);

  const selectedDocumentRefreshing = Boolean(
    skillEditor
    && skillEditorDocumentKey
    && (
      (hydratingDocKeys.has(skillEditorDocumentKey) && documentNeedsHydration(selectedSkill))
      || (
        selectedSkill?.owned
        && (accountDocumentStorageKey(selectedSkill) || selectedSkill.id) === skillEditorDocumentKey
        && String(skillEditor.content || "").length === 0
        && String(skillEditor.content || "") === String(skillEditor.baseContent ?? skillEditor.content ?? "")
        && documentNeedsHydration(selectedSkill)
      )
    ),
  );
  const savedDocumentForEditor = useMemo(() => {
    const selectedLibraryKey = selectedSkillKey.startsWith("library:")
      ? selectedSkillKey.slice("library:".length)
      : "";
    const candidateKeys = new Set([
      skillEditorDocumentKey,
      selectedLibraryKey,
	      text(skillEditor?.selected_key).startsWith("library:")
	        ? text(skillEditor?.selected_key).slice("library:".length)
	        : "",
	      text(selectedDocumentDraft?.selected_key).startsWith("library:")
	        ? text(selectedDocumentDraft?.selected_key).slice("library:".length)
	        : "",
	    ].filter(Boolean));
    if (!candidateKeys.size) return null;
    return skillsLibrary.skills.find((entry) => (
      !documentIsFolderRow(entry)
      && candidateKeys.has(accountDocumentStorageKey(entry) || entry.id)
    )) || null;
	  }, [selectedDocumentDraft, selectedSkillKey, skillEditor, skillEditorDocumentKey, skillsLibrary.skills]);
  const skillEditorHasDraftChanges = Boolean(
    skillEditor
    && (
      editorHasUnsavedDraft(skillEditor, selectedSkill || savedDocumentForEditor)
      || (
	        selectedDocumentDraft
	        && (
	          text(selectedDocumentDraft.document_key) === skillEditorDocumentKey
	          || text(selectedDocumentDraft.selected_key) === selectedSkillKey
	        )
	      )
	    ),
  );
		  const discardSkillEditorDraft = useCallback(() => {
			    if (!skillEditor) return;
			    invalidateDocumentDraftPersist();
			    void discardSkillDraftFile(skillEditor);
			    clearWorkspaceToolsDocumentDraft(documentDraftClearKey(skillEditor));
		    setDocumentDraft(getWorkspaceToolsDocumentDraft());
		    setDocumentDrafts(getWorkspaceToolsDocumentDrafts());
		    setSkillsError("");

    if (savedDocumentForEditor) {
      const savedKey = accountDocumentStorageKey(savedDocumentForEditor) || savedDocumentForEditor.id;
      setSelectedSkillKey(`library:${savedKey}`);
      setSkillEditor({
        ...documentEditorDraft(savedDocumentForEditor),
        document_key: savedKey,
      });
      return;
    }

	    setSelectedSkillKey("");
	    setSkillEditor(null);
		  }, [invalidateDocumentDraftPersist, savedDocumentForEditor, skillEditor]);
  const skillEditorBusy = skillsState === "saving" || skillsState === "savingLocal";
  const skillEditorReadOnly = selectedDocumentRefreshing || skillEditorBusy;
  const skillEditorOpen = Boolean(skillEditor);
  const skillDocumentScale = useMemo(
    () => clampSkillDocumentScale(skillDocumentFitScale * skillDocumentZoomFactor),
    [skillDocumentFitScale, skillDocumentZoomFactor],
  );
  const skillDocumentZoomLabel = `${Math.round(skillDocumentScale * 100)}%`;
  const skillDocumentMetricsStyle = useMemo(
    () => skillDocumentPageStyle(skillDocumentScale),
    [skillDocumentScale],
  );
  const skillEditorPages = useMemo(
    () => paginateEditorText(skillEditor?.content || "", { scale: skillDocumentScale }),
    [skillDocumentScale, skillEditor?.content],
  );
  const appControlDocumentContext = useMemo(() => {
    const content = String(skillEditor?.content || "");
    const preview = compactDocumentText(content, 1400);
    const draftFingerprint = documentDraftFingerprint(content);
    const editorDraft = editorHasUnsavedDraft(skillEditor, selectedSkill);
    const localPath = editorDraft ? "" : text(skillEditor?.local_path || selectedSkill?.local_path);
    const documentKind = normalizedDocumentKind(
      skillEditor?.document_kind || skillEditor?.source || selectedSkill?.document_kind || selectedSkill?.source,
      skillEditor?.collection || selectedSkill?.collection,
    );
    const pathMeta = skillEditor ? documentPathMetadata({
      ...selectedSkill,
      ...skillEditor,
      document_kind: documentKind,
      extension: text(skillEditor.extension || selectedSkill?.extension, documentExtensionForKind(documentKind)),
    }) : {};
    const liveSelectionContext = skillEditor ? documentSelectionContext(content, skillEditorSelection) : null;
    const preservedSelectionContext = skillEditor
      && lastDocumentSelection
      && lastDocumentSelection.document_key === skillEditorDocumentKey
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
      content_length: content.length,
      contentPreview: preview.text,
      contentPreviewTruncated: preview.truncated,
      draft_content: content,
      dirty: Boolean(skillEditor && editorDraft),
      document: skillEditor ? {
        collection: normalizedDocumentCollection(),
	        content_hash: text(skillEditor.content_hash || selectedSkill?.content_hash || selectedSkill?.sha256),
	        document_key: skillEditorDocumentKey,
	        draftFingerprint,
	        extension: text(skillEditor.extension || selectedSkill?.extension, documentExtensionForKind(documentKind)),
	        file_name: pathMeta.file_name,
	        file_path: pathMeta.file_path,
	        folder_id: pathMeta.folder_id,
	        folder_path: pathMeta.folder_path,
	        id: text(skillEditor.id || selectedSkill?.id || selectedSkill?.document_id),
	        isDraft: editorDraft,
	        kind: documentKind,
	        local_path: localPath,
	        parent_path_key: pathMeta.parent_path_key,
	        path_key: pathMeta.path_key,
	        pending_push: editorDraft ? false : Boolean(selectedSkill?.pending_push),
        source: documentKind,
        sync_status: editorDraft ? "draft" : text(selectedSkill?.sync_status),
        title: text(skillEditor.title || selectedSkill?.title),
      } : null,
      editorReadOnly: Boolean(skillEditorReadOnly),
      editorState: skillsState,
      full_content: content,
      highlighted_range: highlightedRange,
      saveModes: ["draft", "local", "publish"],
      section,
      selected_key: selectedSkillKey,
      surface: "tools",
      type: "tools_document_context",
      updated_at_ms: Date.now(),
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

  const scriptEditorKey = scriptEditor ? scriptPathKey(scriptEditor) || scriptEditor.id : "";
  const scriptsEditorOpen = Boolean(scriptEditor);
  useEffect(() => {
    const updatedAtMs = Date.now();
    scriptSelectionClearAtRef.current = updatedAtMs;
    setScriptEditorSelection({
      direction: "",
      end: 0,
      start: 0,
      updated_at_ms: updatedAtMs,
    });
    setLastScriptSelection(null);
  }, [scriptEditorKey]);
  const scriptRows = useMemo(() => {
    const query = text(scriptsQuery).toLowerCase();
    return (scriptsLibrary.scripts || [])
      .filter((script) => {
        if (!query) return true;
        return [
          scriptRunLabel(script),
          scriptPathKey(script),
          script.shell,
          script.local_path,
        ].join(" ").toLowerCase().includes(query);
      })
      .sort((a, b) => scriptPathKey(a).localeCompare(scriptPathKey(b)));
  }, [scriptsLibrary.scripts, scriptsQuery]);
  const mergedScriptRunResults = useMemo(() => ({
    ...(scriptRunResults && typeof scriptRunResults === "object" ? scriptRunResults : {}),
    ...(sharedScriptRunResults && typeof sharedScriptRunResults === "object" ? sharedScriptRunResults : {}),
  }), [scriptRunResults, sharedScriptRunResults]);
  useEffect(() => {
    const previous = scriptRunStateRef.current || {};
    const next = {};
    Object.entries(mergedScriptRunResults).forEach(([key, result]) => {
      const pathKey = normalizedDocumentPath(result?.path_key || key);
      if (!pathKey) return;
      const state = text(result?.state);
      const runId = text(result?.run_id);
      const ok = result?.ok !== false && state !== "error";
      next[pathKey] = { ok, run_id: runId, state };
      const prior = previous[pathKey];
      if (prior?.state === "running" && state && !["queued", "running"].includes(state)) {
        markScriptCompletion(pathKey, ok);
      }
    });
    scriptRunStateRef.current = next;
  }, [markScriptCompletion, mergedScriptRunResults]);
  const scriptEditorRunning = Boolean(scriptEditorKey && ["queued", "running"].includes(mergedScriptRunResults[scriptEditorKey]?.state));
  const scriptEditorBusy = ["saving", "deleting"].includes(scriptsState);
  const scriptEditorReadOnly = scriptEditorBusy;
  useEffect(() => {
    const pathKey = normalizedDocumentPath(scriptLogFocusRequest?.path_key);
    if (!pathKey) return;
    setSection("scripts");
    setSelectedScriptKey(pathKey);
    setSelectedScriptLogKey(pathKey);
    setScriptPaneTab("logs");
  }, [scriptLogFocusRequest?.path_key, scriptLogFocusRequest?.requested_at]);
  const activeScriptLogKey = selectedScriptLogKey || scriptEditorKey || selectedScriptKey;
  const activeScriptLog = useMemo(() => (
    scriptRunDisplayLog(mergedScriptRunResults[activeScriptLogKey])
  ), [activeScriptLogKey, mergedScriptRunResults]);
  const activeScriptHistory = useMemo(() => {
    const activePathKey = normalizedDocumentPath(activeScriptLogKey);
    const rowsByRun = new Map();
    [
      ...scriptRunHistory,
      ...Object.values(mergedScriptRunResults || {}),
    ]
      .map(scriptRunDisplayLog)
      .filter(Boolean)
      .filter((run) => scriptRunMatchesPath(run, activePathKey))
      .forEach((run) => {
        const key = scriptRunHistoryKey(run);
        const existing = rowsByRun.get(key);
        if (!existing || scriptRunHistorySortValue(run) >= scriptRunHistorySortValue(existing)) {
          rowsByRun.set(key, run);
        }
      });
    return Array.from(rowsByRun.values())
      .sort((a, b) => scriptRunHistorySortValue(b) - scriptRunHistorySortValue(a));
  }, [activeScriptLogKey, mergedScriptRunResults, scriptRunHistory]);
  const scriptHistoryWindow = useMemo(() => (
    buildScriptHistoryVirtualWindow(
      activeScriptHistory,
      scriptHistoryViewport,
      scriptHistoryRowHeightsRef.current,
    )
  ), [activeScriptHistory, scriptHistoryMeasureVersion, scriptHistoryViewport]);
  const syncScriptHistoryViewport = useCallback((node) => {
    if (!node) return;
    const nextViewport = {
      height: node.clientHeight || SCRIPT_HISTORY_VIEWPORT_FALLBACK_HEIGHT,
      scrollTop: node.scrollTop || 0,
    };
    setScriptHistoryViewport((current) => (
      current.height === nextViewport.height && current.scrollTop === nextViewport.scrollTop
        ? current
        : nextViewport
    ));
  }, []);
  const handleScriptHistoryScroll = useCallback((event) => {
    const node = event.currentTarget;
    if (!node) return;
    if (
      scriptHistoryScrollFrameRef.current
      && typeof window !== "undefined"
      && typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(scriptHistoryScrollFrameRef.current);
    }
    const update = () => {
      scriptHistoryScrollFrameRef.current = 0;
      syncScriptHistoryViewport(node);
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      scriptHistoryScrollFrameRef.current = window.requestAnimationFrame(update);
    } else {
      update();
    }
  }, [syncScriptHistoryViewport]);
  const measureScriptHistoryRow = useCallback((rowKey, height) => {
    const roundedHeight = Math.ceil(Number(height || 0));
    if (!rowKey || roundedHeight <= 0) return;
    const currentHeight = scriptHistoryRowHeightsRef.current.get(rowKey) || 0;
    if (Math.abs(currentHeight - roundedHeight) <= 1) return;
    scriptHistoryRowHeightsRef.current.set(rowKey, roundedHeight);
    setScriptHistoryMeasureVersion((version) => version + 1);
  }, []);
  useEffect(() => {
    if (section !== "scripts" || scriptPaneTab !== "history") return undefined;
    setScriptHistoryNowMs(Date.now());
    const timer = window.setInterval(() => {
      setScriptHistoryNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [scriptPaneTab, section]);
  useEffect(() => {
    const node = scriptHistoryViewportRef.current;
    if (node) {
      node.scrollTop = 0;
      syncScriptHistoryViewport(node);
    } else {
      setScriptHistoryViewport({
        height: SCRIPT_HISTORY_VIEWPORT_FALLBACK_HEIGHT,
        scrollTop: 0,
      });
    }
  }, [activeScriptLogKey, syncScriptHistoryViewport]);
  useEffect(() => {
    if (section !== "scripts" || scriptPaneTab !== "history") return;
    void loadScriptRunHistory(activeScriptLogKey);
  }, [activeScriptLogKey, loadScriptRunHistory, scriptPaneTab, section]);
  const scrollActiveScriptLogToBottom = useCallback(() => {
    const terminal = scriptLogsTerminalRef.current;
    if (!terminal) return;
    terminal.scrollTo({
      behavior: "smooth",
      top: terminal.scrollHeight,
    });
  }, []);
  const scriptEditorPages = useMemo(
    () => paginateEditorText(scriptEditor?.content || "", { scale: skillDocumentScale, script: true }),
    [scriptEditor?.content, skillDocumentScale],
  );
  const preservedScriptEditorSelection = useMemo(() => {
    if (!scriptEditor || !lastScriptSelection) return null;
    const content = String(scriptEditor.content || "");
    const key = scriptPathKey(scriptEditor) || scriptEditor.id || "";
    if (
      !key
      || lastScriptSelection.scriptKey !== key
      || lastScriptSelection.draftFingerprint !== documentDraftFingerprint(content)
    ) {
      return null;
    }
    return documentSelectionSegments(content, lastScriptSelection);
  }, [scriptEditor, lastScriptSelection]);
  const appControlScriptContext = useMemo(() => {
    const content = String(scriptEditor?.content || "");
    const preview = compactDocumentText(content, 1400);
    const draftFingerprint = documentDraftFingerprint(content);
    const editorDirty = scriptHasUnsavedChanges(scriptEditor);
    const liveSelectionContext = scriptEditor ? documentSelectionContext(content, scriptEditorSelection) : null;
    const preservedSelectionContext = scriptEditor
      && lastScriptSelection
      && lastScriptSelection.scriptKey === scriptEditorKey
      && lastScriptSelection.draftFingerprint === draftFingerprint
        ? documentSelectionContext(content, lastScriptSelection)
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
      active: section === "scripts",
      canDirectEditFile: Boolean(scriptEditor?.local_path),
      content,
      content_length: content.length,
      contentPreview: preview.text,
      contentPreviewTruncated: preview.truncated,
      dirty: Boolean(scriptEditor && editorDirty),
      editorReadOnly: Boolean(scriptEditorReadOnly),
      editorState: scriptsState,
      full_content: content,
      highlighted_range: highlightedRange,
      saveModes: ["draft", "local"],
      script: scriptEditor ? {
        draftFingerprint,
        extension: text(scriptEditor.extension, scriptExtensionForShell(scriptEditor.shell)),
        id: text(scriptEditor.id || scriptEditorKey),
        isDraft: editorDirty || !scriptEditor.local_path,
        local_path: text(scriptEditor.local_path),
        loopspace_button_color: text(scriptEditor.loopspace_button_color, SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR),
        loopspace_text_color: text(scriptEditor.loopspace_text_color, SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR),
        path_key: scriptEditorKey,
        shell: scriptShellOption(scriptEditor.shell).id,
        title: text(scriptEditor.title || scriptEditorKey),
        workspace_button_color: text(scriptEditor.workspace_button_color, SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR),
        workspace_text_color: text(scriptEditor.workspace_text_color, SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR),
        working_directory: text(scriptEditor.working_directory),
      } : null,
      section,
      selected_key: selectedScriptKey,
      surface: "tools",
      type: "tools_script_context",
      updated_at_ms: Date.now(),
    };
  }, [
    lastScriptSelection,
    scriptEditor,
    scriptEditorKey,
    scriptEditorReadOnly,
    scriptEditorSelection,
    scriptsState,
    section,
    selectedScriptKey,
  ]);

  const activeAppControlContext = useMemo(() => {
    if (!surfaceIsActive) {
      return {
        active: false,
        section: "",
        surface: "tools",
        type: "tools_context",
        updated_at_ms: Date.now(),
      };
    }

    return section === "scripts" ? appControlScriptContext : appControlDocumentContext;
  }, [appControlDocumentContext, appControlScriptContext, section, surfaceIsActive]);

  useEffect(() => {
    if (typeof onAppControlContextChange !== "function") return;
    onAppControlContextChange(activeAppControlContext);
  }, [activeAppControlContext, onAppControlContextChange]);

  useEffect(() => {
    if (typeof onAppControlContextChange !== "function") return undefined;
    return () => {
      onAppControlContextChange({
        active: false,
        section: "",
        surface: "tools",
        type: "tools_context",
        updated_at_ms: Date.now(),
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
      updated_at_ms: updatedAtMs,
    });
    setLastDocumentSelection(null);
  }, []);

  const clearScriptSelection = useCallback(() => {
    const updatedAtMs = Date.now();
    scriptSelectionClearAtRef.current = updatedAtMs;
    setScriptEditorSelection({
      direction: "",
      end: 0,
      start: 0,
      updated_at_ms: updatedAtMs,
    });
    setLastScriptSelection(null);
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
    const hasContentPatch = hasOwn("content_md") || hasOwn("contentMd") || hasOwn("content") || hasOwn("body");
    const requestedContent = hasOwn("content_md")
      ? String(input.content_md ?? "")
      : hasOwn("contentMd")
        ? String(input.contentMd ?? "")
      : hasOwn("content")
        ? String(input.content ?? "")
        : hasOwn("body")
          ? String(input.body ?? "")
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
    const option = documentTypeOption(requestedKind || skillEditor?.document_kind || skillEditor?.source || newDocDraft.type);
    const draftId = isExistingDocument
      ? text(skillEditor?.id || selectedSkill?.id || selectedSkill?.document_id)
      : skillSlug(baseTitle, existingIds);
    const nextEditor = {
      ...(skillEditor || {
        asset_id: "",
        baseContent: "",
	        collection: option.collection,
	        content: "",
	        content_hash: "",
	        document_key: draftId,
	        document_kind: option.id,
	        extension: option.extension,
	        id: draftId,
	        local_path: "",
        mime_type: documentMimeTypeForKind(option.id, option.collection),
	        source: option.id,
        title: draftId,
      }),
    };
    if (requestedTitle) {
      nextEditor.title = requestedTitle;
      if (!isExistingDocument) {
        nextEditor.id = skillSlug(requestedTitle, existingIds);
        nextEditor.document_key = nextEditor.id;
      }
    }
    if (requestedKind) {
      const nextOption = documentTypeOption(requestedKind);
	      nextEditor.collection = nextOption.collection;
	      nextEditor.document_kind = nextOption.id;
	      nextEditor.source = nextOption.id;
	      nextEditor.extension = requestedExtension || nextOption.extension;
      nextEditor.mime_type = documentMimeTypeForKind(nextOption.id, nextOption.collection);
    } else if (requestedExtension) {
      nextEditor.extension = requestedExtension.replace(/^\./u, "").toLowerCase() || nextEditor.extension;
    }
    if (requestedFolderPath) {
      nextEditor.folder_path = requestedFolderPath;
      nextEditor.folder_id = requestedFolderPath;
      nextEditor.parent_path_key = requestedFolderPath;
    }
    if (requestedFileName) {
      nextEditor.file_name = requestedFileName;
    }
    if (requestedFilePath || requestedPathKey) {
      const nextPath = requestedPathKey || requestedFilePath;
      nextEditor.file_path = nextPath;
      nextEditor.path_key = nextPath;
      nextEditor.parent_path_key = normalizedDocumentPath(nextPath.split("/").slice(0, -1).join("/"));
      nextEditor.folder_path = nextEditor.parent_path_key;
      nextEditor.folder_id = nextEditor.parent_path_key;
    }
    if (hasContentPatch) {
      nextEditor.content = requestedContent;
    }
    let nextDocumentKind = normalizedDocumentKind(nextEditor.document_kind || nextEditor.source, nextEditor.collection);
    if (nextDocumentKind === "document" && documentIsHtml(nextEditor)) {
      nextDocumentKind = "html";
    }
    if (nextDocumentKind === "html") {
      nextEditor.extension = "html";
      nextEditor.mime_type = documentMimeTypeForKind("html");
    }
    const nextPathMeta = documentPathMetadata({
      ...nextEditor,
      document_kind: nextDocumentKind,
      extension: text(nextEditor.extension, documentExtensionForKind(nextDocumentKind)),
    });
    Object.assign(nextEditor, {
      ...nextPathMeta,
      collection: normalizedDocumentCollection(),
      document_key: documentDraftKey({ ...nextEditor, ...nextPathMeta }),
      document_kind: nextDocumentKind,
      draft: true,
      isDraft: true,
      row_type: "document",
      selected_key: isExistingDocument ? selectedSkillKey : "",
      source: nextDocumentKind,
      sync_status: "draft",
    });
    const contextForNextEditor = () => {
      const content = String(nextEditor.content || "");
      const preview = compactDocumentText(content, 1400);
      const documentKind = normalizedDocumentKind(nextEditor.document_kind || nextEditor.source, nextEditor.collection);
      const documentKey = nextEditor.document_key || accountDocumentStorageKey(nextEditor) || nextEditor.id;
      const pathMeta = documentPathMetadata({
        ...nextEditor,
        document_kind: documentKind,
        extension: text(nextEditor.extension, documentExtensionForKind(documentKind)),
      });
      return {
        ...appControlDocumentContext,
        active: section === "docs",
        canDirectEditFile: Boolean(nextEditor.local_path),
        content,
        content_length: content.length,
        contentPreview: preview.text,
        contentPreviewTruncated: preview.truncated,
        dirty: true,
        document: {
          ...(appControlDocumentContext.document || {}),
	          collection: normalizedDocumentCollection(),
	          content_hash: text(nextEditor.content_hash),
	          document_key: documentKey,
	          draftFingerprint: documentDraftFingerprint(content),
	          extension: text(nextEditor.extension, documentExtensionForKind(documentKind)),
	          file_name: pathMeta.file_name,
	          file_path: pathMeta.file_path,
	          folder_id: pathMeta.folder_id,
	          folder_path: pathMeta.folder_path,
	          id: text(nextEditor.id || documentKey),
	          kind: documentKind,
	          local_path: text(nextEditor.local_path),
	          parent_path_key: pathMeta.parent_path_key,
	          path_key: pathMeta.path_key,
	          pending_push: Boolean(nextEditor.pending_push),
          source: documentKind,
          sync_status: text(nextEditor.sync_status),
          title: text(nextEditor.title || nextEditor.id || documentKey),
        },
        draft_content: content,
        full_content: content,
        highlighted_range: documentSelectionContext(content, skillEditorSelection),
        section,
        selected_key: isExistingDocument ? selectedSkillKey : "",
        updated_at_ms: Date.now(),
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

    const requestedMode = text(input.mode || input.save_mode, input.save === true ? "publish" : "draft").toLowerCase();
    const draftRequested = requestedMode === "draft";
    const shouldSave = input.save === true || draftRequested || !["", "edit", "update", "none"].includes(requestedMode);
    if (!shouldSave) {
      return {
        ok: true,
        mode: "draft",
        source: "editor_state",
        context: nextContext,
      };
    }
    const localOnly = ["local", "local_only", "local-only"].includes(requestedMode);
    const ok = await saveSkillEditor(draftRequested ? "draft" : localOnly ? "local" : "push", nextEditor);
    return {
      ok: Boolean(ok),
      mode: draftRequested ? "draft" : localOnly ? "local" : "publish",
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
      const requestedMode = text(input.mode || input.save_mode || input.action, "publish")
        .toLowerCase();
      const draftRequested = requestedMode === "draft";
      const localOnly = ["local", "local_only", "local-only"].includes(requestedMode);
      const document = appControlDocumentContext.document || {};
      const editorDirty = String(skillEditor.content || "") !== String(skillEditor.baseContent ?? skillEditor.content ?? "");
      const editorDraft = Boolean(skillEditor.isDraft || skillEditor.draft || text(skillEditor.sync_status) === "draft");
      if (!draftRequested && !editorDraft && document.local_path && document.id && !editorDirty) {
        const result = await invoke("cloud_mcp_save_account_document", {
          request: {
            document: {
              collection: normalizedDocumentCollection(),
              doc_id: document.id,
              document_id: document.id,
              document_kind: document.kind,
              extension: document.extension,
              id: document.id,
              local_path: document.local_path,
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
            (accountDocumentStorageKey(entry) || entry.id) === (skillEditor.document_key || accountDocumentStorageKey(skillEditor) || skillEditor.id)
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
      const ok = await saveSkillEditor(draftRequested ? "draft" : localOnly ? "local" : "push");
      return {
        ok: Boolean(ok),
        mode: draftRequested ? "draft" : localOnly ? "local" : "publish",
        source: "editor_state",
        context: appControlDocumentContext,
      };
    },
    updateSelectedDocument: updateSelectedDocumentFromAppControl,
  }), [appControlDocumentContext, saveSkillEditor, skillEditor, updateSelectedDocumentFromAppControl]);

  useEffect(() => {
    if (!surfaceIsActive) return undefined;
    if (typeof onAppControlDocumentActions !== "function") return undefined;
    return onAppControlDocumentActions(appControlDocumentActions);
  }, [appControlDocumentActions, onAppControlDocumentActions, surfaceIsActive]);

  const updateSelectedScriptFromAppControl = useCallback(async (input = {}) => {
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(input, key);
    const requestedTitle = hasOwn("title")
      ? text(input.title)
      : hasOwn("name")
        ? text(input.name)
        : "";
    const requestedShell = hasOwn("shell") ? text(input.shell) : "";
    const hasContentPatch = hasOwn("content") || hasOwn("content_md");
    const requestedContent = hasOwn("content")
      ? String(input.content ?? "")
      : hasOwn("content_md")
        ? String(input.content_md ?? "")
        : "";
    const current = scriptEditor || scriptEditorDraft({
      content: "",
      loopspace_button_color: SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR,
      loopspace_text_color: SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR,
      shell: requestedShell || newScriptDraft.shell,
      title: requestedTitle || newScriptDraft.name || "New Script",
      workspace_button_color: SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR,
      workspace_text_color: SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR,
    });
    const nextShell = requestedShell ? scriptShellOption(requestedShell).id : current.shell;
    const nextExtension = text(
      input.extension || input.ext || current.extension,
      scriptExtensionForShell(nextShell),
    ).replace(/^\./u, "").toLowerCase();
    const nextEditor = {
      ...current,
      content: hasContentPatch ? requestedContent : String(current.content || ""),
      extension: nextExtension,
      loopspace_button_color: text(
        input.loopspace_button_color,
        current.loopspace_button_color || SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR,
      ),
      loopspace_text_color: text(
        input.loopspace_text_color,
        current.loopspace_text_color || SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR,
      ),
      shell: nextShell,
      title: requestedTitle || current.title || "New Script",
      workspace_button_color: text(
        input.workspace_button_color,
        current.workspace_button_color || SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR,
      ),
      workspace_text_color: text(
        input.workspace_text_color,
        current.workspace_text_color || SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR,
      ),
      working_directory: text(input.working_directory, current.working_directory),
    };
    const requestedPath = normalizedDocumentPath(input.path_key || input.path || input.file_path);
    if (requestedPath) {
      nextEditor.path_key = requestedPath;
      nextEditor.file_name = requestedPath.split("/").filter(Boolean).pop() || nextEditor.file_name;
    } else if (!scriptPathKey(nextEditor)) {
      nextEditor.path_key = `${skillSlug(nextEditor.title)}.${nextExtension}`;
      nextEditor.file_name = nextEditor.path_key;
    }
    setScriptEditor(nextEditor);
    setSelectedScriptKey(scriptPathKey(nextEditor) || nextEditor.id || "");
    if (hasContentPatch) {
      clearScriptSelection();
    }
    const requestedMode = text(input.mode || input.save_mode, input.save === true ? "local" : "draft").toLowerCase();
    const shouldRun = ["run", "execute"].includes(requestedMode) || input.run === true;
    const shouldSave = input.save === true
      || shouldRun
      || !["", "draft", "edit", "update", "none"].includes(requestedMode);
    if (shouldSave) {
      const ok = await saveLocalScript(nextEditor);
      if (shouldRun && ok) {
        void runLocalScript(nextEditor);
        return {
          accepted: true,
          ok: true,
          context: appControlScriptContext,
          mode: "run",
          result: {
            accepted: true,
            path_key: scriptPathKey(nextEditor) || nextEditor.id || "",
            state: "running",
          },
          source: "script_editor",
        };
      }
      return {
        ok: Boolean(ok),
        context: appControlScriptContext,
        mode: "local",
        source: "script_editor",
      };
    }
    return {
      ok: true,
      context: appControlScriptContext,
      mode: "draft",
      source: "script_editor",
    };
  }, [
    appControlScriptContext,
    clearScriptSelection,
    newScriptDraft.name,
    newScriptDraft.shell,
    runLocalScript,
    saveLocalScript,
    scriptEditor,
  ]);

  const appControlScriptActions = useMemo(() => ({
    getSelectedScriptContext: async () => appControlScriptContext,
    runSelectedScript: async () => {
      if (!scriptEditor) {
        return {
          ok: false,
          error: {
            code: "no_selected_script",
            message: "No local script is selected.",
          },
          context: appControlScriptContext,
        };
      }
      if (scriptHasUnsavedChanges(scriptEditor) || !scriptEditor.local_path) {
        const saved = await saveLocalScript(scriptEditor);
        if (!saved) {
          return {
            ok: false,
            error: {
              code: "script_save_failed",
              message: "The local script could not be saved before running.",
            },
            context: appControlScriptContext,
          };
        }
      }
      void runLocalScript(scriptEditor);
      return {
        accepted: true,
        context: appControlScriptContext,
        ok: true,
        result: {
          accepted: true,
          path_key: scriptPathKey(scriptEditor) || scriptEditor.id || "",
          state: "running",
        },
      };
    },
    saveSelectedScript: async () => {
      if (!scriptEditor) {
        return {
          ok: false,
          error: {
            code: "no_selected_script",
            message: "No local script is selected.",
          },
          context: appControlScriptContext,
        };
      }
      const ok = await saveLocalScript(scriptEditor);
      return {
        ok: Boolean(ok),
        context: appControlScriptContext,
        mode: "local",
      };
    },
    updateSelectedScript: updateSelectedScriptFromAppControl,
  }), [appControlScriptContext, runLocalScript, saveLocalScript, scriptEditor, updateSelectedScriptFromAppControl]);

  useEffect(() => {
    if (!surfaceIsActive) return undefined;
    if (typeof onAppControlScriptActions !== "function") return undefined;
    return onAppControlScriptActions(appControlScriptActions);
  }, [appControlScriptActions, onAppControlScriptActions, surfaceIsActive]);

  const activeDocsBreakout = useMemo(() => (
    Object.values(toolsWindowBreakouts).find((breakout) => breakout?.mode === "docs") || null
  ), [toolsWindowBreakouts]);
  const activeScriptsBreakout = useMemo(() => (
    Object.values(toolsWindowBreakouts).find((breakout) => breakout?.mode === "scripts") || null
  ), [toolsWindowBreakouts]);

  const buildToolsWindowMeta = useCallback((breakout) => {
    if (!breakout?.label) return null;
    if (breakout.mode === "scripts") {
      return {
        busy: scriptEditorBusy,
        canDelete: Boolean(scriptEditor?.local_path || scriptEditorKey),
        content: String(scriptEditor?.content || ""),
        dirty: Boolean(scriptEditor && (scriptHasUnsavedChanges(scriptEditor) || !scriptEditor.local_path)),
        error: scriptsError,
        key: breakout.key,
        mode: "scripts",
        path_key: scriptEditorKey,
        readOnly: scriptEditorReadOnly,
        running: scriptEditorRunning,
        scriptKey: scriptEditorKey,
        shell: text(scriptEditor?.shell),
        state: scriptsState,
        subtitle: scriptEditorKey || text(scriptEditor?.local_path),
        title: text(scriptEditor?.title, "Script"),
        updated_at_ms: Date.now(),
        window_id: breakout.label,
        workspace_id: text(agentPromptWorkspaceId),
      };
    }
    return {
      busy: skillEditorBusy || selectedDocumentRefreshing,
      canDelete: Boolean(skillEditor?.id || skillEditorDocumentKey),
      content: String(skillEditor?.content || ""),
	      dirty: skillEditorHasDraftChanges,
      document_kind: normalizedDocumentKind(skillEditor?.document_kind || skillEditor?.source, skillEditor?.collection),
	      document_key: skillEditorDocumentKey,
	      error: skillsError,
	      extension: text(skillEditor?.extension),
	      key: breakout.key,
      mime_type: text(skillEditor?.mime_type),
      mode: "docs",
      path_key: normalizedDocumentPath(skillEditor?.path_key || skillEditor?.file_path),
      readOnly: skillEditorReadOnly,
      state: skillsState,
      subtitle: normalizedDocumentPath(skillEditor?.path_key || skillEditor?.file_path)
        || skillEditorDocumentKey,
      title: text(skillEditor?.title, "Document"),
      updated_at_ms: Date.now(),
      window_id: breakout.label,
      workspace_id: text(agentPromptWorkspaceId),
    };
  }, [
    agentPromptWorkspaceId,
    scriptEditor,
    scriptEditorBusy,
    scriptEditorKey,
    scriptEditorReadOnly,
    scriptEditorRunning,
    scriptsError,
    scriptsState,
    selectedDocumentRefreshing,
    skillEditor,
    skillEditorBusy,
    skillEditorDocumentKey,
    skillEditorHasDraftChanges,
    skillEditorReadOnly,
    skillsError,
    skillsState,
  ]);

  const emitToolsWindowMeta = useCallback((breakout) => {
    const meta = buildToolsWindowMeta(breakout);
    if (!meta) return;
    emit(TOOLS_WINDOW_META_EVENT, meta).catch(() => {});
  }, [buildToolsWindowMeta]);

  useEffect(() => {
    if (activeDocsBreakout) emitToolsWindowMeta(activeDocsBreakout);
    if (activeScriptsBreakout) emitToolsWindowMeta(activeScriptsBreakout);
  }, [activeDocsBreakout, activeScriptsBreakout, emitToolsWindowMeta]);

  const openDocumentBreakout = useCallback(async () => {
    if (!skillEditor) return;
    const key = skillEditorDocumentKey || selectedSkillKey || accountDocumentStorageKey(skillEditor) || skillEditor.id;
    if (!key) return;
    setSection("docs");
    const existing = Object.values(toolsWindowBreakoutsRef.current).filter((breakout) => breakout?.mode === "docs");
    for (const breakout of existing) {
      if (breakout?.label && breakout.key !== key) {
        // eslint-disable-next-line no-await-in-loop
        await closeToolsWindow(breakout.label);
      }
    }
    try {
      const label = await openToolsWindow({
        key,
        mode: "docs",
        theme: skillEditorTheme,
        title: text(skillEditor.title, "Document"),
      });
      if (label) {
        emitToolsWindowMeta({
          key,
          label,
          mode: "docs",
          title: text(skillEditor.title, "Document"),
        });
      }
    } catch (error) {
      setSkillsError(getErrorMessage(error, "Unable to open document window."));
    }
  }, [
    closeToolsWindow,
    emitToolsWindowMeta,
    openToolsWindow,
    selectedSkillKey,
    skillEditor,
    skillEditorDocumentKey,
    skillEditorTheme,
  ]);

  useEffect(() => {
    if (!embeddedDocsPanel || !embeddedDocsWindowOpenRequest) {
      return;
    }

    const requestId = text(
      embeddedDocsWindowOpenRequest.request_id
        || embeddedDocsWindowOpenRequest.key
        || embeddedDocsWindowOpenRequest.id,
    );
    if (!requestId || embeddedDocsWindowOpenHandledRef.current === requestId) {
      return;
    }
    if (!skillEditor) {
      return;
    }

    const requestKey = text(
      embeddedDocsWindowOpenRequest.key || embeddedDocsWindowOpenRequest.document_key || embeddedDocsWindowOpenRequest.id || embeddedDocsWindowOpenRequest.path_key,
    );
    const editorKeys = [
      skillEditorDocumentKey,
      selectedSkillKey,
      accountDocumentStorageKey(skillEditor),
      skillEditor.id,
      skillEditor.path_key,
      skillEditor.file_path,
    ].map(text).filter(Boolean);
    const matchesSelectedDocument = !requestKey || editorKeys.some((key) => (
      key === requestKey
        || key === `library:${requestKey}`
        || requestKey === `library:${key}`
    ));
    if (!matchesSelectedDocument) {
      return;
    }

    embeddedDocsWindowOpenHandledRef.current = requestId;
    void openDocumentBreakout();
  }, [
    embeddedDocsPanel,
    embeddedDocsWindowOpenRequest,
    openDocumentBreakout,
    selectedSkillKey,
    skillEditor,
    skillEditorDocumentKey,
  ]);

  const openSkillEditorHtmlInBrowser = useCallback(async () => {
    if (!skillEditor || !documentIsHtml(skillEditor)) return;
    try {
      setSkillsError("");
      await invoke("open_html_document_in_browser", {
        content: String(skillEditor.content || ""),
        title: text(skillEditor.title || skillEditor.file_name, "document"),
      });
    } catch (error) {
      setSkillsError(getErrorMessage(error, "Unable to open HTML document in the browser."));
    }
  }, [skillEditor]);

  const openScriptBreakout = useCallback(async () => {
    if (!scriptEditor) return;
    const key = scriptEditorKey || scriptPathKey(scriptEditor) || scriptEditor.id;
    if (!key) return;
    setSection("scripts");
    setScriptPaneTab("editor");
    const existing = Object.values(toolsWindowBreakoutsRef.current).filter((breakout) => breakout?.mode === "scripts");
    for (const breakout of existing) {
      if (breakout?.label && breakout.key !== key) {
        // eslint-disable-next-line no-await-in-loop
        await closeToolsWindow(breakout.label);
      }
    }
    try {
      const label = await openToolsWindow({
        key,
        mode: "scripts",
        theme: skillEditorTheme,
        title: text(scriptEditor.title, "Script"),
      });
      if (label) {
        emitToolsWindowMeta({
          key,
          label,
          mode: "scripts",
          title: text(scriptEditor.title, "Script"),
        });
      }
    } catch (error) {
      setScriptsError(getErrorMessage(error, "Unable to open script window."));
    }
  }, [
    closeToolsWindow,
    emitToolsWindowMeta,
    openToolsWindow,
    scriptEditor,
    scriptEditorKey,
    skillEditorTheme,
  ]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(TOOLS_WINDOW_CLOSED_EVENT, (event) => {
      if (disposed) return;
      const windowId = text(event.payload?.window_id);
      const mode = normalizedSectionId(event.payload?.mode, "");
      const key = text(event.payload?.key);
      setToolsWindowBreakouts((current) => {
        const next = { ...current };
        Object.entries(next).forEach(([id, breakout]) => {
          if (
            (windowId && breakout?.label === windowId)
            || (mode && breakout?.mode === mode && (!key || breakout?.key === key))
          ) {
            delete next[id];
          }
        });
        return next;
      });
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(TOOLS_WINDOW_META_REQUEST_EVENT, (event) => {
      if (disposed) return;
      const windowId = text(event.payload?.window_id);
      const mode = normalizedSectionId(event.payload?.mode, "");
      const key = text(event.payload?.key);
      const breakout = toolsWindowBreakoutsRef.current[windowId]
        || Object.values(toolsWindowBreakoutsRef.current).find((candidate) => (
          candidate?.mode === mode && (!key || candidate?.key === key)
        ));
      if (breakout) {
        emitToolsWindowMeta(windowId ? { ...breakout, label: windowId } : breakout);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [emitToolsWindowMeta]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(TOOLS_WINDOW_CONTROL_EVENT, (event) => {
      if (disposed) return;
      const payload = event.payload || {};
      const windowId = text(payload.window_id);
      const mode = normalizedSectionId(payload.mode, "");
      const key = text(payload.key);
      const breakout = toolsWindowBreakoutsRef.current[windowId]
        || Object.values(toolsWindowBreakoutsRef.current).find((candidate) => (
          candidate?.mode === mode && (!key || candidate?.key === key)
        ));
      if (!breakout) return;
      const control = text(payload.control);
      const focusMainWindow = () => {
        getCurrentWindow().setFocus().catch(() => {});
      };

      if (control === TOOLS_WINDOW_CONTROL_FOCUS_MAIN) {
        setSection(breakout.mode);
        focusMainWindow();
        return;
      }
      if (control === TOOLS_WINDOW_CONTROL_RETURN) {
        setSection(breakout.mode);
        focusMainWindow();
        setToolsWindowBreakouts((current) => {
          const next = { ...current };
          delete next[breakout.label];
          return next;
        });
        return;
      }

      if (breakout.mode === "docs") {
        if (control === TOOLS_WINDOW_CONTROL_UPDATE) {
          const hasTitle = Object.prototype.hasOwnProperty.call(payload, "title");
          const hasContent = Object.prototype.hasOwnProperty.call(payload, "content");
          if (hasTitle || hasContent) {
            lastHumanDocumentEditAtRef.current = Date.now();
            setSkillEditor((current) => {
              if (!current) return current;
              return {
                ...current,
                ...(hasTitle ? { title: String(payload.title ?? "") } : {}),
                ...(hasContent ? { content: String(payload.content ?? "") } : {}),
              };
            });
          }
          return;
        }
        if (control === TOOLS_WINDOW_CONTROL_SAVE_LOCAL) {
          void saveSkillEditor("local");
          return;
        }
        if (control === TOOLS_WINDOW_CONTROL_SAVE_PUSH) {
          void saveSkillEditor("push");
          return;
        }
        if (control === TOOLS_WINDOW_CONTROL_DISCARD) {
          discardSkillEditorDraft();
          return;
        }
        if (control === TOOLS_WINDOW_CONTROL_DELETE) {
          removeDocument(skillEditor?.document_key || accountDocumentStorageKey(skillEditor) || skillEditor?.id);
          void closeToolsWindow(breakout.label);
          return;
        }
        if (control === TOOLS_WINDOW_CONTROL_CLOSE) {
          setSkillEditor(null);
          setSelectedSkillKey("");
          void closeToolsWindow(breakout.label);
        }
        return;
      }

      if (control === TOOLS_WINDOW_CONTROL_UPDATE) {
        const hasTitle = Object.prototype.hasOwnProperty.call(payload, "title");
        const hasContent = Object.prototype.hasOwnProperty.call(payload, "content");
        if (hasTitle || hasContent) {
          setScriptEditor((current) => {
            if (!current) return current;
            return {
              ...current,
              ...(hasTitle ? { title: String(payload.title ?? "") } : {}),
              ...(hasContent ? { content: String(payload.content ?? "") } : {}),
            };
          });
        }
        return;
      }
      if (control === TOOLS_WINDOW_CONTROL_SAVE_LOCAL) {
        void saveLocalScript(scriptEditor);
        return;
      }
      if (control === TOOLS_WINDOW_CONTROL_RUN) {
        void (async () => {
          const saved = scriptHasUnsavedChanges(scriptEditor) || !scriptEditor?.local_path
            ? await saveLocalScript(scriptEditor)
            : true;
          if (saved) await runLocalScript(scriptEditor);
        })();
        return;
      }
      if (control === TOOLS_WINDOW_CONTROL_DELETE) {
        void deleteLocalScript(scriptEditor);
        void closeToolsWindow(breakout.label);
        return;
      }
      if (control === TOOLS_WINDOW_CONTROL_CLOSE) {
        setScriptEditor(null);
        setSelectedScriptKey("");
        void closeToolsWindow(breakout.label);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [
    closeToolsWindow,
    deleteLocalScript,
    discardSkillEditorDraft,
    emitToolsWindowMeta,
    removeDocument,
    runLocalScript,
    saveLocalScript,
    saveSkillEditor,
    scriptEditor,
    skillEditor,
  ]);

  const docsCreateMode = !skillEditor;
  const showDocsTemplatesPane = docsCreateMode && !rightToolsOrchestratorOpen;
  const embeddedDocsShowExplorer = embeddedDocsPanel ? !skillEditor && !docsCreateActive : !docsExplorerCollapsed;
  const embeddedDocsShowEditor = !embeddedDocsPanel || Boolean(skillEditor) || docsCreateActive;
  const embeddedDocsShowTemplates = !embeddedDocsPanel && showDocsTemplatesPane;
  const preservedSkillEditorSelection = useMemo(() => {
    if (!skillEditor || !lastDocumentSelection) return null;
    const content = String(skillEditor.content || "");
    const documentKey = skillEditor.document_key || accountDocumentStorageKey(skillEditor) || skillEditor.id || "";
    if (
      !documentKey
      || lastDocumentSelection.document_key !== documentKey
      || lastDocumentSelection.draftFingerprint !== documentDraftFingerprint(content)
    ) {
      return null;
    }
    return documentSelectionSegments(content, lastDocumentSelection);
  }, [skillEditor, lastDocumentSelection]);
  const updateSkillEditorSelection = useCallback((event, pageOffset = 0) => {
    const target = event?.target;
    const start = Number(target?.selectionStart);
    const end = Number(target?.selectionEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }
    const offset = Math.max(0, Number(pageOffset) || 0);
    const updatedAtMs = Date.now();
    const eventType = text(event?.type);
    const suppressPreserve = eventType === "blur"
      && updatedAtMs - documentSelectionClearAtRef.current < 400;
    const nextSelection = {
      direction: text(target?.selectionDirection),
      end: offset + end,
      start: offset + start,
      updated_at_ms: updatedAtMs,
    };
    setSkillEditorSelection({
      ...nextSelection,
    });
    if (!skillEditor) {
      return;
    }
    const documentKey = skillEditor.document_key || accountDocumentStorageKey(skillEditor) || skillEditor.id || "";
    const content = String(skillEditor.content || "");
    if (documentKey && end > start) {
      if (suppressPreserve) {
        setLastDocumentSelection(null);
        return;
      }
      setLastDocumentSelection({
        ...nextSelection,
        content_length: content.length,
        document_key: documentKey,
        draftFingerprint: documentDraftFingerprint(content),
      });
      return;
    }
    if (suppressPreserve || (target && typeof document !== "undefined" && document.activeElement === target)) {
      setLastDocumentSelection(null);
    }
  }, [skillEditor]);
  const updateScriptEditorSelection = useCallback((event, pageOffset = 0) => {
    const target = event?.target;
    const start = Number(target?.selectionStart);
    const end = Number(target?.selectionEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }
    const offset = Math.max(0, Number(pageOffset) || 0);
    const updatedAtMs = Date.now();
    const eventType = text(event?.type);
    const suppressPreserve = eventType === "blur"
      && updatedAtMs - scriptSelectionClearAtRef.current < 400;
    const nextSelection = {
      direction: text(target?.selectionDirection),
      end: offset + end,
      start: offset + start,
      updated_at_ms: updatedAtMs,
    };
    setScriptEditorSelection({ ...nextSelection });
    if (!scriptEditor) {
      return;
    }
    const scriptKey = scriptPathKey(scriptEditor) || scriptEditor.id || "";
    const content = String(scriptEditor.content || "");
    if (scriptKey && end > start) {
      if (suppressPreserve) {
        setLastScriptSelection(null);
        return;
      }
      setLastScriptSelection({
        ...nextSelection,
        content_length: content.length,
        draftFingerprint: documentDraftFingerprint(content),
        scriptKey,
      });
      return;
    }
    if (suppressPreserve || (target && typeof document !== "undefined" && document.activeElement === target)) {
      setLastScriptSelection(null);
    }
  }, [scriptEditor]);
  const updateSkillEditorPageContent = useCallback((page, pageContent, event) => {
    lastHumanDocumentEditAtRef.current = Date.now();
    updateSkillEditorSelection(event, page.start);
    setSkillEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        content: replaceEditorPageContent(current.content, page, pageContent),
      };
    });
  }, [updateSkillEditorSelection]);
  const updateScriptEditorPageContent = useCallback((page, pageContent, event) => {
    updateScriptEditorSelection(event, page.start);
    setScriptEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        content: replaceEditorPageContent(current.content, page, pageContent),
      };
    });
  }, [updateScriptEditorSelection]);

  useEffect(() => {
    skillDocumentFitScaleRef.current = skillDocumentFitScale;
    skillDocumentScaleRef.current = skillDocumentScale;
    skillDocumentZoomFactorRef.current = skillDocumentZoomFactor;
  }, [skillDocumentFitScale, skillDocumentScale, skillDocumentZoomFactor]);

  const adjustSkillDocumentZoom = useCallback((nextZoomValue, anchor = null) => {
    const previousZoom = skillDocumentZoomFactorRef.current;
    const nextZoom = clampSkillDocumentZoomFactor(
      typeof nextZoomValue === "function" ? nextZoomValue(previousZoom) : nextZoomValue,
    );
    if (Math.abs(nextZoom - previousZoom) < 0.001) return;

    const canvas = section === "scripts"
      ? scriptDocumentCanvasRef.current
      : skillDocumentCanvasRef.current;
    const previousScale = skillDocumentScaleRef.current;
    const nextScale = clampSkillDocumentScale(skillDocumentFitScaleRef.current * nextZoom);
    const bounds = canvas?.getBoundingClientRect?.();
    const anchorX = bounds && Number.isFinite(anchor?.clientX)
      ? anchor.clientX - bounds.left
      : bounds
        ? bounds.width / 2
        : 0;
    const anchorY = bounds && Number.isFinite(anchor?.clientY)
      ? anchor.clientY - bounds.top
      : bounds
        ? bounds.height / 2
        : 0;
    const previousScrollLeft = canvas?.scrollLeft || 0;
    const previousScrollTop = canvas?.scrollTop || 0;

    setSkillDocumentZoomFactor(nextZoom);

    if (!canvas || !Number.isFinite(previousScale) || previousScale <= 0 || !Number.isFinite(nextScale)) {
      return;
    }
    window.requestAnimationFrame(() => {
      const ratio = nextScale / previousScale;
      canvas.scrollLeft = ((previousScrollLeft + anchorX) * ratio) - anchorX;
      canvas.scrollTop = ((previousScrollTop + anchorY) * ratio) - anchorY;
    });
  }, [section]);

  const zoomOutSkillDocument = useCallback(() => {
    adjustSkillDocumentZoom((current) => current / SKILL_DOCUMENT_ZOOM_STEP);
  }, [adjustSkillDocumentZoom]);

  const zoomInSkillDocument = useCallback(() => {
    adjustSkillDocumentZoom((current) => current * SKILL_DOCUMENT_ZOOM_STEP);
  }, [adjustSkillDocumentZoom]);

  const resetSkillDocumentZoom = useCallback(() => {
    adjustSkillDocumentZoom(1);
  }, [adjustSkillDocumentZoom]);

  const handleSkillDocumentCanvasWheel = useCallback((event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = Number(event.deltaY || 0);
    adjustSkillDocumentZoom(
      (current) => current * Math.exp(-delta * SKILL_DOCUMENT_ZOOM_WHEEL_INTENSITY),
      event,
    );
  }, [adjustSkillDocumentZoom]);

  useEffect(() => {
    if ((!skillEditorOpen && !scriptsEditorOpen) || typeof window === "undefined") return undefined;
    const canvas = section === "scripts"
      ? scriptDocumentCanvasRef.current
      : skillDocumentCanvasRef.current;
    if (!canvas) return undefined;

    let animationFrame = 0;
    const updateScale = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const availableWidth = Math.max(1, bounds.width - SKILL_DOCUMENT_CANVAS_INLINE_GUTTER_PX);
      const availableHeight = Math.max(1, bounds.height - SKILL_DOCUMENT_CANVAS_VERTICAL_GUTTER_PX);
      const widthScale = availableWidth / SKILL_DOCUMENT_A4_WIDTH_PX;
      const heightScale = availableHeight / SKILL_DOCUMENT_A4_HEIGHT_PX;
      const nextScale = clampSkillDocumentScale(Math.min(widthScale, heightScale));
      setSkillDocumentFitScale((current) => (
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
  }, [scriptDocumentCanvasRef, scriptsEditorOpen, section, skillEditorOpen]);

  return (
    <ToolsHubShell
      aria-label={embeddedDocsPanel ? "Workspace document panel" : "Global toolkit"}
      data-embedded-docs-panel={embeddedDocsPanel ? "true" : undefined}
      data-section={section}
    >
      {!embeddedDocsPanel && (
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
      )}

      {section === "mcps" && (
        <ToolsMcpPane aria-label="MCP settings">
          {globalMcpDefaults.error && activeMcpScope === GLOBAL_MCP_DEFAULTS_SCOPE && (
            <ToolsError role="alert">{globalMcpDefaults.error}</ToolsError>
          )}
          <ToolsHubFill>
            {mcpScopeReady && activeMcpWorkspace ? (
              <McpsWorkspaceView
                default_working_directory={activeMcpRootDirectory || defaultWorkingDirectory}
                key={activeMcpScope}
                onScopeChange={setMcpScope}
                root_directory={activeMcpRootDirectory}
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

      {(section === "docs" || section === "clis" || section === "scripts") && (
        <ToolsScroll data-section={section}>
          <ToolsLayout data-section={section}>
            {section === "docs" && (
              <DocsWorkspaceSurface
                aria-label="Docs workspace"
                data-docs-embedded-panel={embeddedDocsPanel ? "true" : undefined}
                data-docs-explorer-collapsed={!embeddedDocsShowExplorer ? "true" : "false"}
                ref={docsWorkspaceSurfaceRef}
                style={{ "--docs-explorer-offset": !embeddedDocsShowExplorer ? "0px" : docsExplorerSize }}
              >
                {!embeddedDocsPanel && docsExplorerCollapsed && (
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
                  data-show-explorer={embeddedDocsShowExplorer ? "true" : "false"}
                  data-show-templates={embeddedDocsShowTemplates ? "true" : "false"}
                  key={`${embeddedDocsPanel ? "embedded" : "full"}-${docsCreateMode ? "docs-create" : "docs-edit"}-${embeddedDocsShowExplorer ? "explorer-visible" : "explorer-hidden"}-${embeddedDocsShowTemplates ? "templates-visible" : "templates-hidden"}`}
                  orientation="horizontal"
                >
                  {embeddedDocsShowExplorer && (
                    <>
                      <ResizePanel
                        data-surface="files"
                        defaultSize={embeddedDocsPanel ? "100%" : docsExplorerSize}
                        groupResizeBehavior={embeddedDocsPanel ? undefined : "preserve-pixel-size"}
                        id="docs-explorer"
                        maxSize={embeddedDocsPanel ? undefined : "360px"}
                        minSize={embeddedDocsPanel ? "100%" : "184px"}
                        onResize={embeddedDocsPanel ? undefined : syncDocsExplorerCollapsedState}
                        panelRef={embeddedDocsPanel ? undefined : docsExplorerPanelRef}
                      >
                        <DocsFilesPane
                          aria-label="Document files"
                          data-collapsed="false"
                          data-embedded-docs-panel={embeddedDocsPanel ? "true" : undefined}
                          onContextMenu={(event) => {
                            if (event.defaultPrevented) return;
                            openDocsContextMenu(event, {
                              display_name: "documents",
                              kind: "root",
                              path_key: "",
                            });
                          }}
                    >
                      {!embeddedDocsPanel && (
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
                      )}
                      <>
                          <DocsRootPath title="Account documents">account-documents / personal</DocsRootPath>
                          <DocsExplorerSearchInput
                            aria-label="Search document files"
                            onChange={(event) => setSkillsQuery(event.target.value)}
                            placeholder="Search .md, .arch…"
                            type="search"
                            value={skillsQuery}
                          />
                          <FileTree
                            aria-label="Account document explorer"
                            onContextMenu={(event) => openDocsContextMenu(event, {
                              display_name: "documents",
                              kind: "root",
                              path_key: "",
                            })}
                          >
                            <FileTreeItem>
                              <DocsExplorerFolderButton
                                $depth={0}
                                as="div"
                                data-selected="false"
                                onContextMenu={(event) => openDocsContextMenu(event, {
                                  display_name: "documents",
                                  kind: "root",
                                  path_key: "",
                                })}
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
                                  if (row.row_type === "folder") {
                                    return (
                                      <DocsExplorerFolderButton
                                        $depth={row.depth}
                                        as="div"
                                        data-selected="false"
                                        key={row.key}
                                        onContextMenu={(event) => openDocsContextMenu(event, {
                                          ...row,
                                          kind: "folder",
                                        })}
                                        title={[row.path_key, text(row.local_path)].filter(Boolean).join(" · ")}
                                      >
                                        <FileDisclosure>
                                          <span className="codicon codicon-chevron-down" aria-hidden="true" />
                                        </FileDisclosure>
                                        <FileKindIcon data-file-tone="folder">
                                          <span className="codicon codicon-folder-opened" aria-hidden="true" />
                                        </FileKindIcon>
                                        <FileTreeName title={row.path_key}>{row.display_name}</FileTreeName>
                                        <DocsExplorerCount>{row.child_count || ""}</DocsExplorerCount>
                                      </DocsExplorerFolderButton>
                                    );
                                  }
                                  const active = selectedSkillKey === row.key
                                    || (row.isDraft && skillEditor?.document_key && skillEditor.document_key === row.storage_key)
                                    || (row.draftKey && skillEditor?.document_key === row.draftKey);
                                  const iconClass = row.extension === "arch" ? "codicon-file-code" : "codicon-markdown";
                                  const fileTone = row.extension === "arch" ? "data" : "markdown";
                                  return (
                                    <DocsExplorerFileButton
                                      $depth={row.depth}
                                      data-selected={active ? "true" : "false"}
                                      key={row.key}
                                      onContextMenu={(event) => openDocsContextMenu(event, {
                                        ...row,
                                        kind: "document",
                                      })}
                                      onClick={() => {
                                        setDocsCreateActive(false);
                                        if (row.isDraft) {
                                            const draftDocument = row.draft_document
                                              ? { ...row.draft_document, selected_key: row.draftSelectedKey || row.key }
                                              : row;
                                          setSelectedSkillKey(text(row.draftSelectedKey || row.selected_key));
                                          setSkillEditor(documentEditorDraft(draftDocument));
                                          onEmbeddedDocsSelectionChange?.(draftDocument);
                                        } else {
                                          setSelectedSkillKey(row.key);
                                          setSkillEditor(documentEditorDraft(row));
                                          onEmbeddedDocsSelectionChange?.(row);
                                        }
                                      }}
                                      title={[row.display_name, row.path_key, text(row.local_path)].filter(Boolean).join(" · ")}
                                      type="button"
                                    >
                                      <FileDisclosure />
                                      <FileKindIcon data-file-tone={fileTone}>
                                        <span className={`codicon ${iconClass}`} aria-hidden="true" />
                                      </FileKindIcon>
                                      <FileTreeName title={row.path_key}>{row.display_name}</FileTreeName>
                                      <DocsExplorerStatus title={row.isDraft ? (row.saved_storage_key ? "Saved document with draft changes" : "Draft") : row.hydrating ? "Hydrating document" : row.pending_push ? "Pending push" : row.typeLabel}>
                                        {row.hydrating ? (
                                          <DocsExplorerSpinner aria-label="Hydrating document" role="status" />
                                        ) : row.isDraft ? "DRAFT" : row.pending_push ? "●" : ""}
                                      </DocsExplorerStatus>
                                    </DocsExplorerFileButton>
                                  );
                                })
                              ) : (
                                <FileTreeEmpty>{text(skillsQuery) ? "No matching docs." : "No docs saved yet."}</FileTreeEmpty>
                              )}
                            </FileTreeItem>
                          </FileTree>
                          <DocsExplorerFooter>
                            <DocsExplorerFooterButton
                              onClick={() => beginContextCreateDocument({
                                display_name: "documents",
                                kind: "root",
                                path_key: "",
                              })}
                              type="button"
                            >
                              <span className="codicon codicon-new-file" aria-hidden="true" />
                              <span>New doc</span>
                            </DocsExplorerFooterButton>
                            <DocsExplorerFooterButton
                              onClick={() => beginContextCreateFolder({
                                display_name: "documents",
                                kind: "root",
                                path_key: "",
                              })}
                              type="button"
                            >
                              <span className="codicon codicon-new-folder" aria-hidden="true" />
                              <span>New folder</span>
                            </DocsExplorerFooterButton>
                          </DocsExplorerFooter>
                      </>
                        </DocsFilesPane>
                      </ResizePanel>

                      {!embeddedDocsPanel && (
                        <ResizeHandle data-direction="horizontal" data-surface="files" />
                      )}
                    </>
                  )}

                  {embeddedDocsShowEditor && (
                  <ResizePanel
                    data-surface="files"
                    defaultSize={embeddedDocsPanel ? "100%" : undefined}
                    id="docs-editor"
                    minSize={embeddedDocsPanel ? "100%" : "360px"}
                  >
                    <DocsCenterPane aria-label="Document editor">
                  {skillsError && <ToolsError role="alert">{skillsError}</ToolsError>}
                  {skillEditor ? (
                    activeDocsBreakout ? (
                      <ToolsWindowBreakoutPlaceholder>
                        <span className="codicon codicon-multiple-windows" aria-hidden="true" />
                        <strong>{text(skillEditor.title, "Document")} is open in its own window</strong>
                        <p>The document editor is still live. Use the window or return it here.</p>
                        <ToolsWindowBreakoutActions>
                          <ToolsGhostButton
                            onClick={() => void focusToolsWindow(activeDocsBreakout.label)}
                            type="button"
                          >
                            Focus window
                          </ToolsGhostButton>
                          <ToolsPrimaryButton
                            onClick={() => void closeToolsWindow(activeDocsBreakout.label)}
                            type="button"
                          >
                            Return here
                          </ToolsPrimaryButton>
                        </ToolsWindowBreakoutActions>
                      </ToolsWindowBreakoutPlaceholder>
                    ) : (
                      <SkillDocumentEditor
                        aria-busy={selectedDocumentRefreshing ? "true" : "false"}
                        data-embedded-docs-panel={embeddedDocsPanel ? "true" : undefined}
                        data-page-theme={skillEditorTheme}
                        data-refreshing={selectedDocumentRefreshing ? "true" : "false"}
                      >
                        <SkillDocumentToolbar data-embedded-docs-panel={embeddedDocsPanel ? "true" : undefined}>
                          {!embeddedDocsPanel && (
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
                              <SkillDocumentZoomControls aria-label="Document zoom">
                                <SkillDocumentZoomButton
                                  aria-label="Zoom document out"
                                  disabled={skillDocumentScale <= SKILL_DOCUMENT_MIN_SCALE + 0.001}
                                  onClick={zoomOutSkillDocument}
                                  title="Zoom out"
                                  type="button"
                                >
                                  <span className="codicon codicon-zoom-out" aria-hidden="true" />
                                </SkillDocumentZoomButton>
                                <SkillDocumentZoomValue
                                  onClick={resetSkillDocumentZoom}
                                  title="Reset zoom"
                                  type="button"
                                >
                                  {skillDocumentZoomLabel}
                                </SkillDocumentZoomValue>
                                <SkillDocumentZoomButton
                                  aria-label="Zoom document in"
                                  disabled={skillDocumentScale >= SKILL_DOCUMENT_MAX_SCALE - 0.001}
                                  onClick={zoomInSkillDocument}
                                  title="Zoom in"
                                  type="button"
                                >
                                  <span className="codicon codicon-zoom-in" aria-hidden="true" />
                                </SkillDocumentZoomButton>
                              </SkillDocumentZoomControls>
                            </SkillDocumentToolbarControls>
                          )}
                          <SkillDocumentToolbarControls
                            data-embedded-actions={embeddedDocsPanel ? "true" : undefined}
                            data-side="right"
                          >
                            <SkillDocumentActions
                              data-embedded-docs-panel={embeddedDocsPanel ? "true" : undefined}
                              data-placement="toolbar"
                            >
                              {!embeddedDocsPanel && (
                                <>
                                  <ToolsGhostButton
                                    onClick={() => {
                                      if (activeDocsBreakout?.label) {
                                        void focusToolsWindow(activeDocsBreakout.label);
                                      } else {
                                        void openDocumentBreakout();
                                      }
                                    }}
                                    title={activeDocsBreakout ? "Focus the document window" : "Open this document in its own window"}
                                    type="button"
                                  >
	                                  <span className="codicon codicon-multiple-windows" aria-hidden="true" />
	                                  <span>{activeDocsBreakout ? "Focus window" : "Window"}</span>
	                                </ToolsGhostButton>
                                  {documentIsHtml(skillEditor) && (
                                    <ToolsGhostButton
                                      onClick={() => void openSkillEditorHtmlInBrowser()}
                                      title="Open HTML in the default browser"
                                      type="button"
                                    >
                                      <ButtonBrowserIcon aria-hidden="true" />
                                      <span>Browser</span>
                                    </ToolsGhostButton>
                                  )}
	                                <ToolsGhostButton
	                                  onClick={() => {
	                                    setSkillEditor(null);
                                      setSelectedSkillKey("");
                                    }}
                                    type="button"
                                  >
                                    Close
                                  </ToolsGhostButton>
                                  {skillEditorHasDraftChanges && (
                                    <ToolsGhostButton
                                      disabled={skillEditorBusy}
                                      onClick={discardSkillEditorDraft}
                                      title={savedDocumentForEditor ? "Discard draft changes and return to the saved document" : "Clear this unsaved draft"}
                                      type="button"
                                    >
                                      {savedDocumentForEditor ? "Discard changes" : "Clear draft"}
                                    </ToolsGhostButton>
                                  )}
                                </>
                              )}
                              {(embeddedDocsPanel || skillEditor.id) && (
                              <ToolsGhostButton
                                data-danger="true"
                                disabled={skillEditorReadOnly || !skillEditor.id}
                                onClick={() => removeDocument(skillEditor.document_key || accountDocumentStorageKey(skillEditor) || skillEditor.id)}
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
                        <SkillDocumentCanvas
                          onWheel={handleSkillDocumentCanvasWheel}
                          ref={skillDocumentCanvasRef}
                          style={skillDocumentMetricsStyle}
                        >
                          {selectedDocumentRefreshing && (
                            <SkillDocumentRefreshOverlay role="status">
                              <DocsExplorerSpinner aria-hidden="true" />
                              <span>Refreshing document</span>
                            </SkillDocumentRefreshOverlay>
                          )}
                          <SkillDocumentPageStack>
                            {skillEditorPages.map((page) => {
                              const pageSelection = editorPageSelectionSegments(
                                skillEditor.content,
                                preservedSkillEditorSelection,
                                page,
                              );
                              return (
                                <SkillDocumentPage
                                  data-first-page={page.firstPage ? "true" : "false"}
                                  key={`document-page-${page.index}`}
                                  onPointerDownCapture={clearDocumentSelection}
                                >
                                  {page.firstPage && (
                                    <SkillDocumentTitleInput
                                      aria-label="Document name"
                                      readOnly={skillEditorReadOnly}
                                      onChange={(event) => {
                                        lastHumanDocumentEditAtRef.current = Date.now();
                                        setSkillEditor((current) => ({ ...current, title: event.target.value }));
                                      }}
                                      placeholder="doc_name"
                                      value={skillEditor.title}
                                    />
                                  )}
                                  <SkillDocumentBodyStack data-first-page={page.firstPage ? "true" : "false"}>
                                    {pageSelection?.active && (
                                      <SkillDocumentSelectionOverlay aria-hidden="true">
                                        <span>{pageSelection.before}</span>
                                        <SkillDocumentSelectionMark>{pageSelection.selected}</SkillDocumentSelectionMark>
                                        <span>{pageSelection.after}</span>
                                      </SkillDocumentSelectionOverlay>
                                    )}
                                    <ToolsSkillsEditor
                                      aria-label={`Document content page ${page.index + 1}`}
                                      onBlur={(event) => updateSkillEditorSelection(event, page.start)}
                                      onChange={(event) => updateSkillEditorPageContent(page, event.target.value, event)}
                                      onKeyUp={(event) => updateSkillEditorSelection(event, page.start)}
                                      onMouseUp={(event) => updateSkillEditorSelection(event, page.start)}
                                      onSelect={(event) => updateSkillEditorSelection(event, page.start)}
                                      placeholder={page.firstPage ? (skillEditor.extension === "arch" ? "title System_Map" : "# Notes") : ""}
                                      readOnly={skillEditorReadOnly}
                                      rows={page.capacityRows}
                                      spellCheck={false}
                                      value={page.text}
                                    />
                                  </SkillDocumentBodyStack>
                                </SkillDocumentPage>
                              );
                            })}
                          </SkillDocumentPageStack>
                        </SkillDocumentCanvas>
                      </SkillDocumentEditor>
                    )
                  ) : (
                    <DocsCreateModal>
                      <DocsCreateHeader>
                        <div>
                          <ToolsPanelTitle>
                            {text(newDocDraft.createKind, "document") === "folder" ? "New folder" : "New doc"}
                          </ToolsPanelTitle>
                          <DocsCreateFileName>
                            {text(newDocDraft.createKind, "document") === "folder"
                              ? `${normalizedDocumentPath(newDocDraft.folder_path) ? `${normalizedDocumentPath(newDocDraft.folder_path)}/` : ""}${text(newDocDraft.name) ? skillSlug(newDocDraft.name) : "untitled_folder"}`
                              : text(newDocDraft.name)
                                ? `${normalizedDocumentPath(newDocDraft.folder_path) ? `${normalizedDocumentPath(newDocDraft.folder_path)}/` : ""}${skillSlug(newDocDraft.name)}.${documentTypeOption(newDocDraft.type).extension}`
                                : `${normalizedDocumentPath(newDocDraft.folder_path) ? `${normalizedDocumentPath(newDocDraft.folder_path)}/` : ""}untitled.${documentTypeOption(newDocDraft.type).extension}`}
                          </DocsCreateFileName>
                          <DocsCreateLocation>
                            <span className="codicon codicon-folder" aria-hidden="true" />
                            <span>{normalizedDocumentPath(newDocDraft.folder_path) || "documents"}</span>
                            {normalizedDocumentPath(newDocDraft.folder_path) && (
                              <button
                                aria-label="Create in root documents folder"
                                onClick={() => setNewDocDraft((current) => ({ ...current, folder_path: "" }))}
                                type="button"
                              >
                                Root
                              </button>
                            )}
                          </DocsCreateLocation>
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
                        {text(newDocDraft.createKind, "document") === "folder" ? (
                          <DocsField>
                            <label htmlFor="tools-doc-create-kind">Create</label>
                            <AppSelect
                              id="tools-doc-create-kind"
                              onChange={(value) => setNewDocDraft((current) => ({ ...current, createKind: value }))}
                              options={[
                                { value: "folder", label: "Folder" },
                                { value: "document", label: "Document" },
                              ]}
                              value={text(newDocDraft.createKind, "document")}
                            />
                          </DocsField>
                        ) : (
                          <DocsField>
                            <label htmlFor="tools-doc-type">Type</label>
                            <AppSelect
                              id="tools-doc-type"
                              onChange={(value) => setNewDocDraft((current) => ({ ...current, type: value }))}
                              options={DOCUMENT_TYPE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                              value={newDocDraft.type}
                            />
                          </DocsField>
                        )}
                      </DocsCreateFields>
                      <ToolsPrimaryButton
                        disabled={!text(newDocDraft.name)}
                        onClick={startNewDocument}
                        type="button"
                      >
                        {text(newDocDraft.createKind, "document") === "folder" ? "Create folder" : "Create doc"}
                      </ToolsPrimaryButton>
                      {embeddedDocsPanel ? (
                        <ToolsGhostButton
                          onClick={() => setDocsCreateActive(false)}
                          type="button"
                        >
                          <span className="codicon codicon-arrow-left" aria-hidden="true" />
                          Back to docs
                        </ToolsGhostButton>
                      ) : null}
                    </DocsCreateModal>
                  )}
                    </DocsCenterPane>
                  </ResizePanel>
                  )}

                  {embeddedDocsShowTemplates && (
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
                {docsContextMenu && (
                  <FileContextMenu
                    data-docs-context-menu="true"
                    role="menu"
                    style={{
                      left: docsContextMenu.x,
                      top: docsContextMenu.y,
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <FileContextMenuItem
                      onClick={() => beginContextCreateDocument(docsContextMenu.target)}
                      role="menuitem"
                      type="button"
                    >
                      New document here
                    </FileContextMenuItem>
                    <FileContextMenuItem
                      onClick={() => beginContextCreateFolder(docsContextMenu.target)}
                      role="menuitem"
                      type="button"
                    >
                      New folder here
                    </FileContextMenuItem>
                    {docsContextMenu.target?.kind !== "root" && (
                      <FileContextMenuItem
                        data-danger="true"
                        onClick={() => deleteContextTarget(docsContextMenu.target)}
                        role="menuitem"
                        type="button"
                      >
	                        {docsContextMenu.target?.kind === "folder"
                            ? "Delete folder"
                            : docsContextMenu.target?.isDraft
                              ? "Clear draft"
                              : "Delete document"}
                      </FileContextMenuItem>
                    )}
                  </FileContextMenu>
                )}
                <ToolsHydrationProgress placement="docs-floating" progress={skillsHydration} />
              </DocsWorkspaceSurface>
            )}

            {section === "scripts" && (
              <DocsWorkspaceSurface
                aria-label="Scripts workspace"
                data-docs-explorer-collapsed={scriptsExplorerCollapsed ? "true" : "false"}
                data-scripts-surface="true"
                ref={scriptsWorkspaceSurfaceRef}
                style={{ "--docs-explorer-offset": scriptsExplorerCollapsed ? "0px" : scriptsExplorerSize }}
              >
                {scriptsExplorerCollapsed && (
                  <DocsExplorerRestoreButton
                    aria-label="Show script explorer"
                    onClick={expandScriptsExplorer}
                    title="Show script explorer"
                    type="button"
                  >
                    <span className="codicon codicon-layout-sidebar-left" aria-hidden="true" />
                    <span>Explorer</span>
                  </DocsExplorerRestoreButton>
                )}
                <DocsWorkspaceGrid
                  data-surface="files"
                  data-show-explorer={scriptsExplorerCollapsed ? "false" : "true"}
                  data-show-templates="false"
                  key={`scripts-${scriptsExplorerCollapsed ? "explorer-hidden" : "explorer-visible"}`}
                  orientation="horizontal"
                >
                  {!scriptsExplorerCollapsed && (
                    <>
                      <ResizePanel
                        data-surface="files"
                        defaultSize={scriptsExplorerSize}
                        groupResizeBehavior="preserve-pixel-size"
                        id="scripts-explorer"
                        maxSize="360px"
                        minSize="184px"
                        onResize={syncScriptsExplorerCollapsedState}
                        panelRef={scriptsExplorerPanelRef}
                      >
                        <DocsFilesPane
                          aria-label="Local scripts"
                          data-collapsed="false"
                          onContextMenu={(event) => {
                            if (event.defaultPrevented) return;
                            openScriptsContextMenu(event, {
                              display_name: "scripts",
                              kind: "root",
                              path_key: "",
                            });
                          }}
                        >
                          <FileExplorerHeader>
                            <div>
                              <PanelKicker>Explorer</PanelKicker>
                            </div>
                            <FileExplorerActions>
                              <FileIconButton
                                aria-label="Refresh scripts"
                                disabled={scriptsState === "loading" || scriptsState === "refreshing"}
                                onClick={() => void loadLocalScripts()}
                                title="Refresh scripts"
                                type="button"
                              >
                                <ButtonRefreshIcon aria-hidden="true" />
                              </FileIconButton>
                              <FileIconButton
                                aria-label="Collapse scripts explorer"
                                onClick={collapseScriptsExplorer}
                                title="Collapse scripts explorer"
                                type="button"
                              >
                                <span className="codicon codicon-chevron-left" aria-hidden="true" />
                              </FileIconButton>
                            </FileExplorerActions>
                          </FileExplorerHeader>
                          <DocsRootPath title={scriptsLibrary.root || "Local scripts"}>local-scripts / scripts</DocsRootPath>
                          <DocsExplorerSearchInput
                            aria-label="Search local scripts"
                            onChange={(event) => setScriptsQuery(event.target.value)}
                            placeholder="Search .sh, .py, .js…"
                            type="search"
                            value={scriptsQuery}
                          />
                          <FileTree
                            aria-label="Local script explorer"
                            onContextMenu={(event) => openScriptsContextMenu(event, {
                              display_name: "scripts",
                              kind: "root",
                              path_key: "",
                            })}
                          >
                            <FileTreeItem>
                              <DocsExplorerFolderButton
                                $depth={0}
                                as="div"
                                data-selected="false"
                                onContextMenu={(event) => openScriptsContextMenu(event, {
                                  display_name: "scripts",
                                  kind: "root",
                                  path_key: "",
                                })}
                              >
                                <FileDisclosure>
                                  <span className="codicon codicon-chevron-down" aria-hidden="true" />
                                </FileDisclosure>
                                <FileKindIcon data-file-tone="folder">
                                  <span className="codicon codicon-folder-opened" aria-hidden="true" />
                                </FileKindIcon>
                                <FileTreeName title="scripts">scripts</FileTreeName>
                                <DocsExplorerCount>{scriptRows.length || ""}</DocsExplorerCount>
                              </DocsExplorerFolderButton>
                              {scriptRows.length ? (
                                scriptRows.map((row) => {
                                  const pathKey = scriptPathKey(row) || row.id;
                                  const active = selectedScriptKey === pathKey || scriptEditorKey === pathKey;
                                  const runState = text(mergedScriptRunResults[pathKey]?.state);
                                  const completionMarker = scriptCompletionMarkers[pathKey];
                                  const extension = text(row.extension, "sh");
                                  const fileTone = extension === "py"
                                    ? "python"
                                    : ["js", "mjs", "cjs"].includes(extension)
                                      ? "javascript"
                                      : "terminal";
                                  return (
                                    <DocsExplorerFileButton
                                      $depth={1}
                                      data-selected={active ? "true" : "false"}
                                      key={pathKey}
                                      onContextMenu={(event) => openScriptsContextMenu(event, {
                                        display_name: scriptFileName(row),
                                        kind: "script",
                                        path_key: pathKey,
                                        script: row,
                                      })}
                                      onClick={() => {
                                        setScriptPaneTab("editor");
                                        setSelectedScriptLogKey(pathKey);
                                        void readLocalScript(row);
                                      }}
                                      title={[scriptRunLabel(row), pathKey, row.local_path].filter(Boolean).join(" · ")}
                                      type="button"
                                    >
                                      <FileDisclosure />
                                      <FileKindIcon data-file-tone={fileTone}>
                                        <span className="codicon codicon-file-code" aria-hidden="true" />
                                      </FileKindIcon>
                                      <FileTreeName title={pathKey}>{scriptFileName(row)}</FileTreeName>
                                      <DocsExplorerStatus title={["queued", "running"].includes(runState) ? (runState === "queued" ? "Queued" : "Running") : completionMarker ? (completionMarker.ok ? "Finished" : "Finished with errors") : row.shell}>
                                        {["queued", "running"].includes(runState) ? (
                                          <DocsExplorerSpinner aria-label={runState === "queued" ? "Queued script" : "Running script"} role="status" />
                                        ) : completionMarker ? (
                                          <ScriptExplorerFinishIcon
                                            aria-label={completionMarker.ok ? "Script finished" : "Script finished with errors"}
                                            data-state={completionMarker.ok ? "ok" : "error"}
                                            role="status"
                                          >
                                            <span className={`codicon codicon-${completionMarker.ok ? "check" : "error"}`} aria-hidden="true" />
                                          </ScriptExplorerFinishIcon>
                                        ) : ""}
                                      </DocsExplorerStatus>
                                    </DocsExplorerFileButton>
                                  );
                                })
                              ) : (
                                <FileTreeEmpty>{text(scriptsQuery) ? "No matching scripts." : "No scripts saved yet."}</FileTreeEmpty>
                              )}
                            </FileTreeItem>
                          </FileTree>
                          <DocsExplorerFooter>
                            <DocsExplorerFooterButton onClick={beginCreateLocalScript} type="button">
                              <span className="codicon codicon-new-file" aria-hidden="true" />
                              <span>New script</span>
                            </DocsExplorerFooterButton>
                          </DocsExplorerFooter>
                        </DocsFilesPane>
                      </ResizePanel>
                      <ResizeHandle data-direction="horizontal" data-surface="files" />
                    </>
                  )}

                  <ResizePanel data-surface="files" id="scripts-editor" minSize="360px">
                    <DocsCenterPane aria-label="Local script editor" data-pane-kind="scripts">
                      {scriptsError && <ToolsError role="alert">{scriptsError}</ToolsError>}
                      {scriptsMessage && <ToolsNotice>{scriptsMessage}</ToolsNotice>}
                      <ScriptPaneTabs aria-label="Script view" role="tablist">
                        {["editor", "logs", "history"].map((tab) => (
                          <ScriptPaneTabButton
                            aria-selected={scriptPaneTab === tab}
                            data-active={scriptPaneTab === tab ? "true" : "false"}
                            key={tab}
                            onClick={() => setScriptPaneTab(tab)}
                            role="tab"
                            type="button"
                          >
                            {tab === "editor" ? "Editor" : tab === "logs" ? "Logs" : "History"}
                          </ScriptPaneTabButton>
                        ))}
                      </ScriptPaneTabs>
                      {scriptPaneTab === "history" ? (
                        <ScriptLogsPanel data-history="true">
                          {activeScriptHistory.length ? (
                            <ScriptHistoryVirtualList
                              aria-label="Script run history"
                              onScroll={handleScriptHistoryScroll}
                              ref={scriptHistoryViewportRef}
                              role="list"
                            >
                              <ScriptHistoryList
                                style={{
                                  height: `${Math.max(scriptHistoryWindow.totalHeight, 1)}px`,
                                }}
                              >
                                {scriptHistoryWindow.items.map(({ key, row: run, top }) => {
                                  const isActive = ["queued", "running"].includes(run.state);
                                  const ranAgo = formatScriptRunAgo(run, scriptHistoryNowMs);
                                  const runtime = formatScriptRunRuntime(run, scriptHistoryNowMs);
                                  const cause = text(run.cause, "manual");
                                  const runtimeCopy = run.state === "queued"
                                    ? "Queued"
                                    : run.state === "running"
                                      ? `Running ${runtime}`
                                      : `Runtime ${runtime}`;
                                  const startedTitle = run.startedAtLabel === "pending" ? "" : `Started ${run.startedAtLabel}`;
                                  const endedTitle = isActive || run.endedAtLabel === "pending" ? "" : `Ended ${run.endedAtLabel}`;
                                  const rowTitle = [run.title, startedTitle, endedTitle, runtimeCopy].filter(Boolean).join(" · ");
                                  return (
                                    <ScriptHistoryRow
                                      data-active={isActive ? "true" : "false"}
                                      key={key}
                                      ref={(node) => measureScriptHistoryRow(key, node?.offsetHeight)}
                                      role="listitem"
                                      style={{
                                        left: 0,
                                        position: "absolute",
                                        right: 0,
                                        top: 0,
                                        transform: `translateY(${top}px)`,
                                      }}
                                      title={rowTitle}
                                    >
                                      <ScriptHistoryRowMain>
                                        <strong>{run.title}</strong>
                                        <ScriptHistoryRowMeta>
                                          <span title={startedTitle || undefined}>Ran {ranAgo}</span>
                                          <span title={endedTitle || undefined}>{runtimeCopy}</span>
                                          <span title={`Cause ${cause}`}>{cause}</span>
                                          {run.exit_code !== null && run.exit_code !== undefined && (
                                            <span title={`Exit ${String(run.exit_code)}`}>Exit {String(run.exit_code)}</span>
                                          )}
                                        </ScriptHistoryRowMeta>
                                      </ScriptHistoryRowMain>
                                      <ScriptLogsStatus data-state={scriptRunStatusTone(run)}>
                                        {isActive && <DocsExplorerSpinner aria-hidden="true" />}
                                        <span>{scriptRunStatusLabel(run)}</span>
                                      </ScriptLogsStatus>
                                    </ScriptHistoryRow>
                                  );
                                })}
                              </ScriptHistoryList>
                            </ScriptHistoryVirtualList>
                          ) : (
                            <ScriptLogsEmpty>
                              <strong>No run history</strong>
                              <span>Queued, completed, and failed runs will appear here.</span>
                            </ScriptLogsEmpty>
                          )}
                        </ScriptLogsPanel>
                      ) : scriptPaneTab === "logs" ? (
                        <ScriptLogsPanel aria-live={["queued", "running"].includes(activeScriptLog?.state) ? "polite" : "off"}>
                          {activeScriptLog ? (
                            <>
                              <ScriptLogsHeader>
                                <div>
                                  <strong>{activeScriptLog.title}</strong>
                                  <span>{activeScriptLog.path_key || activeScriptLog.script?.path_key || "local script"}</span>
                                </div>
                                <ScriptLogsStatus data-state={activeScriptLog.state}>
                                  {["queued", "running"].includes(activeScriptLog.state) && <DocsExplorerSpinner aria-hidden="true" />}
                                  <span>
                                    {activeScriptLog.state === "queued"
                                      ? "Queued"
                                      : activeScriptLog.state === "running"
                                        ? "Running"
                                      : activeScriptLog.ok === false || activeScriptLog.state === "error"
                                        ? "Finished with errors"
                                        : "Finished"}
                                  </span>
                                </ScriptLogsStatus>
                              </ScriptLogsHeader>
                              <ScriptLogsMeta>
                                <ScriptLogsMetaButton onClick={scrollActiveScriptLogToBottom} type="button">
                                  Scroll to bottom
                                </ScriptLogsMetaButton>
                                <span>Start {activeScriptLog.startedAtLabel}</span>
                                <span>End {["queued", "running"].includes(activeScriptLog.state) ? "pending" : activeScriptLog.endedAtLabel}</span>
                                <span>Duration {activeScriptLog.state === "queued" ? "queued" : activeScriptLog.state === "running" ? "running" : activeScriptLog.durationLabel}</span>
                                {activeScriptLog.exit_code !== null && activeScriptLog.exit_code !== undefined && (
                                  <span>Exit {String(activeScriptLog.exit_code)}</span>
                                )}
                              </ScriptLogsMeta>
                              <ScriptLogsTerminal ref={scriptLogsTerminalRef} role="log">
                                {activeScriptLog.chunks.length ? (
                                  activeScriptLog.chunks.map((chunk, index) => (
                                    <ScriptLogChunk data-stream={chunk.stream === "stderr" ? "stderr" : "stdout"} key={`${index}-${chunk.stream}`}>
                                      {String(chunk.text || "")}
                                    </ScriptLogChunk>
                                  ))
                                ) : (
                                  <ScriptLogsPlaceholder>
                                    {activeScriptLog.state === "queued" ? "Waiting in queue…" : activeScriptLog.state === "running" ? "Waiting for output…" : "No output."}
                                  </ScriptLogsPlaceholder>
                                )}
                                {activeScriptLog.error && (
                                  <ScriptLogChunk data-stream="stderr">{`${activeScriptLog.error}\n`}</ScriptLogChunk>
                                )}
                                {(activeScriptLog.stdout_truncated || activeScriptLog.stderr_truncated) && (
                                  <ScriptLogsPlaceholder>Output was truncated by Diff Forge.</ScriptLogsPlaceholder>
                                )}
                              </ScriptLogsTerminal>
                            </>
                          ) : (
                            <ScriptLogsEmpty>
                              <strong>No script run selected</strong>
                              <span>Run a script from the bottom bar or the editor to see ephemeral logs here.</span>
                            </ScriptLogsEmpty>
                          )}
                        </ScriptLogsPanel>
                      ) : scriptEditor ? (
                        activeScriptsBreakout ? (
                          <ToolsWindowBreakoutPlaceholder>
                            <span className="codicon codicon-multiple-windows" aria-hidden="true" />
                            <strong>{text(scriptEditor.title, "Script")} is open in its own window</strong>
                            <p>The script editor is still live. Use the window or return it here.</p>
                            <ToolsWindowBreakoutActions>
                              <ToolsGhostButton
                                onClick={() => void focusToolsWindow(activeScriptsBreakout.label)}
                                type="button"
                              >
                                Focus window
                              </ToolsGhostButton>
                              <ToolsPrimaryButton
                                onClick={() => void closeToolsWindow(activeScriptsBreakout.label)}
                                type="button"
                              >
                                Return here
                              </ToolsPrimaryButton>
                            </ToolsWindowBreakoutActions>
                          </ToolsWindowBreakoutPlaceholder>
                        ) : (
                        <SkillDocumentEditor data-page-theme={skillEditorTheme} data-script-editor="true">
                          <SkillDocumentToolbar>
                            <SkillDocumentToolbarControls data-side="left">
                              <SkillDocumentThemeSwitch aria-label="Script editor page theme">
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
                              <SkillDocumentZoomControls aria-label="Script zoom">
                                <SkillDocumentZoomButton
                                  aria-label="Zoom script out"
                                  disabled={skillDocumentScale <= SKILL_DOCUMENT_MIN_SCALE + 0.001}
                                  onClick={zoomOutSkillDocument}
                                  title="Zoom out"
                                  type="button"
                                >
                                  <span className="codicon codicon-zoom-out" aria-hidden="true" />
                                </SkillDocumentZoomButton>
                                <SkillDocumentZoomValue
                                  onClick={resetSkillDocumentZoom}
                                  title="Reset zoom"
                                  type="button"
                                >
                                  {skillDocumentZoomLabel}
                                </SkillDocumentZoomValue>
                                <SkillDocumentZoomButton
                                  aria-label="Zoom script in"
                                  disabled={skillDocumentScale >= SKILL_DOCUMENT_MAX_SCALE - 0.001}
                                  onClick={zoomInSkillDocument}
                                  title="Zoom in"
                                  type="button"
                                >
                                  <span className="codicon codicon-zoom-in" aria-hidden="true" />
                                </SkillDocumentZoomButton>
                              </SkillDocumentZoomControls>
                              <ScriptColorField title="Workspace button background">
                                <span>Work BG</span>
                                <input
                                  aria-label="Workspace script button background color"
                                  onChange={(event) => setScriptEditor((current) => ({ ...current, workspace_button_color: event.target.value }))}
                                  type="color"
                                  value={text(scriptEditor.workspace_button_color, SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR)}
                                />
                              </ScriptColorField>
                              <ScriptColorField title="Workspace button text">
                                <span>Work Text</span>
                                <input
                                  aria-label="Workspace script button text color"
                                  onChange={(event) => setScriptEditor((current) => ({ ...current, workspace_text_color: event.target.value }))}
                                  type="color"
                                  value={text(scriptEditor.workspace_text_color, SCRIPT_DEFAULT_WORKSPACE_TEXT_COLOR)}
                                />
                              </ScriptColorField>
                              <ScriptColorField title="Loopspace button background">
                                <span>Loop BG</span>
                                <input
                                  aria-label="Loopspace script button background color"
                                  onChange={(event) => setScriptEditor((current) => ({ ...current, loopspace_button_color: event.target.value }))}
                                  type="color"
                                  value={text(scriptEditor.loopspace_button_color, SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR)}
                                />
                              </ScriptColorField>
                              <ScriptColorField title="Loopspace button text">
                                <span>Loop Text</span>
                                <input
                                  aria-label="Loopspace script button text color"
                                  onChange={(event) => setScriptEditor((current) => ({ ...current, loopspace_text_color: event.target.value }))}
                                  type="color"
                                  value={text(scriptEditor.loopspace_text_color, SCRIPT_DEFAULT_LOOPSPACE_TEXT_COLOR)}
                                />
                              </ScriptColorField>
                            </SkillDocumentToolbarControls>
                            <SkillDocumentToolbarControls data-side="right">
                              <SkillDocumentActions data-placement="toolbar">
                                <ToolsGhostButton
                                  onClick={() => {
                                    if (activeScriptsBreakout?.label) {
                                      void focusToolsWindow(activeScriptsBreakout.label);
                                    } else {
                                      void openScriptBreakout();
                                    }
                                  }}
                                  title={activeScriptsBreakout ? "Focus the script window" : "Open this script in its own window"}
                                  type="button"
                                >
                                  <span className="codicon codicon-multiple-windows" aria-hidden="true" />
                                  <span>{activeScriptsBreakout ? "Focus window" : "Window"}</span>
                                </ToolsGhostButton>
                                <ToolsGhostButton
                                  onClick={() => {
                                    setScriptEditor(null);
                                    setSelectedScriptKey("");
                                  }}
                                  type="button"
                                >
                                  Close
                                </ToolsGhostButton>
                                {scriptEditor.local_path && (
                                  <ToolsGhostButton
                                    data-danger="true"
                                    disabled={scriptEditorReadOnly}
                                    onClick={() => void deleteLocalScript(scriptEditor)}
                                    type="button"
                                  >
                                    Delete
                                  </ToolsGhostButton>
                                )}
                                <ToolsGhostButton
                                  disabled={!text(scriptEditor.title) || scriptEditorReadOnly}
                                  onClick={() => void saveLocalScript(scriptEditor)}
                                  type="button"
                                >
                                  {scriptsState === "saving" ? "Saving…" : "Save Local"}
                                </ToolsGhostButton>
                                <ToolsPrimaryButton
                                  disabled={!text(scriptEditor.title) || scriptEditorBusy}
                                  onClick={async () => {
                                    const saved = scriptHasUnsavedChanges(scriptEditor) || !scriptEditor.local_path
                                      ? await saveLocalScript(scriptEditor)
                                      : true;
                                    if (saved) {
                                      await runLocalScript(scriptEditor);
                                    }
                                  }}
                                  type="button"
                                >
                                  {scriptEditorRunning ? "Queue run" : "Run"}
                                </ToolsPrimaryButton>
                              </SkillDocumentActions>
                            </SkillDocumentToolbarControls>
                          </SkillDocumentToolbar>
                          <SkillDocumentCanvas
                            onWheel={handleSkillDocumentCanvasWheel}
                            ref={scriptDocumentCanvasRef}
                            style={skillDocumentMetricsStyle}
                          >
                            <SkillDocumentPageStack>
                              {scriptEditorPages.map((page) => {
                                const pageSelection = editorPageSelectionSegments(
                                  scriptEditor.content,
                                  preservedScriptEditorSelection,
                                  page,
                                );
                                return (
                                  <SkillDocumentPage
                                    data-first-page={page.firstPage ? "true" : "false"}
                                    key={`script-page-${page.index}`}
                                    onPointerDownCapture={clearScriptSelection}
                                  >
                                    {page.firstPage && (
                                      <SkillDocumentTitleInput
                                        aria-label="Script name"
                                        onChange={(event) => setScriptEditor((current) => ({ ...current, title: event.target.value }))}
                                        placeholder="script_name"
                                        readOnly={scriptEditorReadOnly}
                                        value={scriptEditor.title}
                                      />
                                    )}
                                    <SkillDocumentBodyStack data-first-page={page.firstPage ? "true" : "false"}>
                                      {pageSelection?.active && (
                                        <ScriptSelectionOverlay aria-hidden="true">
                                          <span>{pageSelection.before}</span>
                                          <SkillDocumentSelectionMark>{pageSelection.selected}</SkillDocumentSelectionMark>
                                          <span>{pageSelection.after}</span>
                                        </ScriptSelectionOverlay>
                                      )}
                                      <ToolsScriptEditor
                                        aria-label={`Script content page ${page.index + 1}`}
                                        onBlur={(event) => updateScriptEditorSelection(event, page.start)}
                                        onChange={(event) => updateScriptEditorPageContent(page, event.target.value, event)}
                                        onKeyUp={(event) => updateScriptEditorSelection(event, page.start)}
                                        onMouseUp={(event) => updateScriptEditorSelection(event, page.start)}
                                        onSelect={(event) => updateScriptEditorSelection(event, page.start)}
                                        placeholder={page.firstPage ? "#!/usr/bin/env zsh" : ""}
                                        readOnly={scriptEditorReadOnly}
                                        rows={page.capacityRows}
                                        spellCheck={false}
                                        value={page.text}
                                      />
                                    </SkillDocumentBodyStack>
                                  </SkillDocumentPage>
                                );
                              })}
                            </SkillDocumentPageStack>
                          </SkillDocumentCanvas>
                        </SkillDocumentEditor>
                        )
                      ) : (
                        <DocsCreateModal>
                          <DocsCreateHeader>
                            <div>
                              <ToolsPanelTitle>New script</ToolsPanelTitle>
                              <DocsCreateFileName>
                                {text(newScriptDraft.name)
                                  ? `${skillSlug(newScriptDraft.name)}.${scriptExtensionForShell(newScriptDraft.shell)}`
                                  : `untitled.${scriptExtensionForShell(newScriptDraft.shell)}`}
                              </DocsCreateFileName>
                            </div>
                            <ToolsStatusPill data-tone={scriptsState === "ready" ? "good" : "muted"}>
                              Local only
                            </ToolsStatusPill>
                          </DocsCreateHeader>
                          <ScriptCreateFields>
                            <DocsField>
                              <label htmlFor="tools-script-name">Name</label>
                              <input
                                autoComplete="off"
                                id="tools-script-name"
                                onChange={(event) => setNewScriptDraft((current) => ({ ...current, name: event.target.value }))}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    createLocalScriptDraft();
                                  }
                                }}
                                placeholder="Run_Tests"
                                value={newScriptDraft.name}
                              />
                            </DocsField>
                            <DocsField>
                              <label htmlFor="tools-script-shell">Shell</label>
                              <AppSelect
                                id="tools-script-shell"
                                onChange={(value) => setNewScriptDraft((current) => ({ ...current, shell: value }))}
                                options={SCRIPT_SHELL_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                                value={newScriptDraft.shell}
                              />
                            </DocsField>
                            <ScriptColorCreateField>
                              <label htmlFor="tools-script-workspace-button-color">Work BG</label>
                              <input
                                id="tools-script-workspace-button-color"
                                onChange={(event) => setNewScriptDraft((current) => ({ ...current, workspace_button_color: event.target.value }))}
                                type="color"
                                value={newScriptDraft.workspace_button_color}
                              />
                            </ScriptColorCreateField>
                            <ScriptColorCreateField>
                              <label htmlFor="tools-script-workspace-text-color">Work Text</label>
                              <input
                                id="tools-script-workspace-text-color"
                                onChange={(event) => setNewScriptDraft((current) => ({ ...current, workspace_text_color: event.target.value }))}
                                type="color"
                                value={newScriptDraft.workspace_text_color}
                              />
                            </ScriptColorCreateField>
                            <ScriptColorCreateField>
                              <label htmlFor="tools-script-loopspace-button-color">Loop BG</label>
                              <input
                                id="tools-script-loopspace-button-color"
                                onChange={(event) => setNewScriptDraft((current) => ({ ...current, loopspace_button_color: event.target.value }))}
                                type="color"
                                value={newScriptDraft.loopspace_button_color}
                              />
                            </ScriptColorCreateField>
                            <ScriptColorCreateField>
                              <label htmlFor="tools-script-loopspace-text-color">Loop Text</label>
                              <input
                                id="tools-script-loopspace-text-color"
                                onChange={(event) => setNewScriptDraft((current) => ({ ...current, loopspace_text_color: event.target.value }))}
                                type="color"
                                value={newScriptDraft.loopspace_text_color}
                              />
                            </ScriptColorCreateField>
                          </ScriptCreateFields>
                          <ToolsPrimaryButton
                            disabled={!text(newScriptDraft.name)}
                            onClick={createLocalScriptDraft}
                            type="button"
                          >
                            Create script
                          </ToolsPrimaryButton>
                        </DocsCreateModal>
                      )}
                    </DocsCenterPane>
                  </ResizePanel>
                </DocsWorkspaceGrid>
                {scriptsContextMenu && (
                  <FileContextMenu
                    data-scripts-context-menu="true"
                    role="menu"
                    style={{
                      left: scriptsContextMenu.x,
                      top: scriptsContextMenu.y,
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <FileContextMenuItem
                      onClick={beginCreateLocalScript}
                      role="menuitem"
                      type="button"
                    >
                      New script
                    </FileContextMenuItem>
                    {scriptsContextMenu.target?.kind === "script" && (
                      <FileContextMenuItem
                        data-danger="true"
                        onClick={() => deleteContextScript(scriptsContextMenu.target)}
                        role="menuitem"
                        type="button"
                      >
                        Delete script
                      </FileContextMenuItem>
                    )}
                  </FileContextMenu>
                )}
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
                      const updateStageLabel = AGENT_UPDATE_STAGE_LABELS[row.updateStage] || "";
                      const updateFailed = row.updateStage === "failed";
                      const updateFailedDetail = updateFailed
                        ? text(
                          row.updateErrorReason,
                          row.updateFailedStage
                            ? `Update failed during ${row.updateFailedStage}.`
                            : "Agent update failed.",
                        )
                        : "";
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
                            {updateStageLabel ? (
                              <>
                                <DocsExplorerSpinner aria-hidden="true" />
                                <CliStateText
                                  data-tone="busy"
                                  title={row.updateToVersion ? `Updating to ${row.updateToVersion}` : undefined}
                                >
                                  {updateStageLabel}
                                </CliStateText>
                              </>
                            ) : row.busyAction ? (
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
                                {(row.update_available || updateFailed) && (
                                  <CliRowButton
                                    onClick={() => handleCliRowAction(row, "update")}
                                    type="button"
                                  >
                                    Update
                                  </CliRowButton>
                                )}
                                {updateFailed ? (
                                  <CliStateText data-tone="danger" title={updateFailedDetail}>
                                    Update failed
                                  </CliStateText>
                                ) : (
                                  <CliStateText data-tone="good">
                                    {row.version ? `Installed · ${row.version}` : "Installed"}
                                  </CliStateText>
                                )}
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

export default memo(ToolsWorkspaceView);

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

  &[data-embedded-docs-panel="true"] {
    grid-template-rows: minmax(0, 1fr);
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

  &[data-section="docs"],
  &[data-section="scripts"] {
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

  &[data-section="docs"],
  &[data-section="scripts"] {
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
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  border-right: 0;
  contain: layout paint;

  &[data-embedded-docs-panel="true"] {
    grid-template-rows: auto auto minmax(0, 1fr) auto;
  }

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
  width: 18px;
  min-width: 18px;
  color: #e2c08d;
  font-size: 10px;
  line-height: 22px;
  text-align: center;
`;

const DocsExplorerFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  padding: 7px 8px 8px;
  border-top: 1px solid var(--files-vscode-border-subtle);
  background: var(--files-vscode-sidebar);
`;

const DocsExplorerFooterButton = styled.button`
  display: inline-flex;
  flex: 1 1 96px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--files-vscode-border);
  border-radius: 6px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-editor);
  font: inherit;
  font-size: 11px;
  font-weight: 760;
  cursor: pointer;

  span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover,
  &:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.38);
    color: var(--forge-accent-soft, #7db0ff);
    background: var(--files-vscode-hover);
    outline: none;
  }

  ${DocsFilesPane}[data-embedded-docs-panel="true"] & {
    flex-basis: 104px;
    height: 28px;
    max-height: 28px;
  }
`;

const DocsExplorerSpinner = styled.span`
  flex: 0 0 auto;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(var(--forge-accent-soft-rgb), 0.18);
  border-top-color: var(--forge-accent-soft, #7db0ff);
  border-radius: 999px;
  animation: ${docsExplorerSpin} 740ms linear infinite;
`;

const ScriptExplorerFinishIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1px solid rgba(134, 239, 172, 0.3);
  border-radius: 999px;
  color: #86efac;
  background: rgba(34, 197, 94, 0.14);
  font-size: 10px;
  line-height: 1;

  &[data-state="error"] {
    border-color: rgba(248, 113, 113, 0.3);
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.14);
  }
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

  &[data-pane-kind="scripts"] {
    display: flex;
    flex-direction: column;
    align-content: stretch;
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
  width: min(620px, calc(100% - 28px));
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

const DocsCreateLocation = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 8px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 11px;
  font-weight: 720;
  line-height: 1.2;

  > span:nth-child(2) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    flex: 0 0 auto;
    min-height: 20px;
    padding: 0 7px;
    border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.22);
    border-radius: 6px;
    color: var(--forge-accent-soft, #7db0ff);
    background: rgba(var(--forge-accent-rgb), 0.08);
    font: inherit;
    font-size: 10px;
    font-weight: 800;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.42);
    background: rgba(var(--forge-accent-rgb), 0.15);
    outline: none;
  }
`;

const DocsCreateFields = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr));
  gap: 10px;
  min-width: 0;
`;

const DocsField = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
  overflow: hidden;

  label {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1.15;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
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

  select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 30px;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23b6c0cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 9px center;
    background-size: 15px 15px;
  }

  select::-ms-expand {
    display: none;
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
  grid-template-rows: max-content minmax(0, 1fr);
  align-items: stretch;
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

  &[data-script-editor="true"] {
    flex: 1 1 0;
    min-height: 0;
    height: auto;
    max-height: none;
  }
`;

const ToolsWindowBreakoutPlaceholder = styled.div`
  display: grid;
  grid-row: 2;
  place-content: center;
  justify-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 34px;
  overflow: hidden;
  color: var(--forge-text-muted, #7a8493);
  text-align: center;
  background:
    radial-gradient(circle at 50% 22%, rgba(var(--forge-tint-rgb), 0.12), transparent 44%),
    var(--tools-editor-bg, rgba(5, 7, 10, 0.88));

  > .codicon {
    display: inline-grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.28);
    border-radius: 12px;
    color: var(--forge-tint-soft, #7db0ff);
    background: rgba(var(--forge-tint-rgb), 0.14);
    font-size: 22px;
  }

  strong {
    max-width: min(460px, 100%);
    overflow: hidden;
    color: var(--forge-text-strong, #f6f8fb);
    font-size: 15px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    max-width: min(420px, 100%);
    margin: 0;
    color: var(--forge-text-muted, #8d96a6);
    font-size: 12px;
    font-weight: 650;
    line-height: 1.45;
  }
`;

const ToolsWindowBreakoutActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
`;

const SkillDocumentToolbar = styled.div`
  position: relative;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  align-items: start;
  box-sizing: border-box;
  flex: 0 0 auto;
  min-width: 0;
  min-height: 44px;
  gap: 8px;
  overflow: hidden;
  padding: 7px 10px;
  border-bottom: 1px solid var(--tools-border, rgba(230, 236, 245, 0.08));
  background: var(--tools-control-bg);

  [data-docs-explorer-collapsed="true"] & {
    padding-left: 132px;
  }

  &[data-embedded-docs-panel="true"] {
    grid-template-columns: minmax(0, 1fr);
    min-height: 48px;
    padding: 8px 10px;
  }

  [data-docs-embedded-panel="true"] & {
    padding-left: 10px;
  }

  @media (max-width: 760px) {
    [data-docs-explorer-collapsed="true"] & {
      padding-left: 10px;
      padding-top: 48px;
    }
  }
`;

const SkillDocumentToolbarCopy = styled.div`
  display: grid;
  flex: 1 1 320px;
  min-width: 0;
  gap: 2px;
`;

const SkillDocumentToolbarControls = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
  justify-content: flex-start;
  gap: 8px;
  justify-self: stretch;
  min-width: 0;
  width: 100%;
  max-width: 100%;

  &[data-side="right"] {
    flex: 0 1 auto;
    justify-content: flex-end;
    justify-self: stretch;
    width: 100%;
    overflow: hidden;
  }

  &[data-embedded-actions="true"] {
    flex: 1 1 100%;
    justify-content: stretch;
  }
`;

const SkillDocumentThemeSwitch = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  background: var(--tools-control-bg);
`;

const SkillDocumentThemeButton = styled.button`
  flex: 0 0 auto;
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

const SkillDocumentZoomControls = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  background: var(--tools-control-bg);
`;

const SkillDocumentZoomButton = styled.button`
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible:not(:disabled) {
    color: var(--forge-text, #f4f7fa);
    background: rgba(var(--forge-accent-soft-rgb), 0.12);
    outline: none;
  }

  &:disabled {
    cursor: default;
    opacity: 0.38;
  }

  .codicon {
    font-size: 14px;
  }
`;

const SkillDocumentZoomValue = styled.button`
  min-width: 48px;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 10px;
  font-weight: 820;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--forge-text, #f4f7fa);
    background: rgba(var(--forge-accent-soft-rgb), 0.12);
    outline: none;
  }
`;

const SkillDocumentCanvas = styled.div`
  display: grid;
  position: relative;
  align-self: stretch;
  align-content: start;
  justify-items: center;
  box-sizing: border-box;
  height: auto;
  max-height: none;
  min-width: 0;
  min-height: 0;
  contain: layout paint;
  overflow-x: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px 24px max(72px, var(--skill-document-page-padding-bottom, 76px));
  scroll-padding-bottom: 112px;
  scrollbar-gutter: stable;
  background: var(--skill-editor-desk);
`;

const SkillDocumentPageStack = styled.div`
  display: grid;
  justify-items: center;
  gap: var(--skill-document-page-gap, 34px);
  width: min-content;
  max-width: none;
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
  grid-template-rows: minmax(0, 1fr);
  align-content: start;
  box-sizing: border-box;
  width: var(--skill-document-page-width, 794px);
  height: var(--skill-document-page-height, 1123px);
  min-height: var(--skill-document-page-height, 1123px);
  max-height: var(--skill-document-page-height, 1123px);
  padding:
    var(--skill-document-page-padding-top, 52px)
    var(--skill-document-page-padding-inline, 58px)
    var(--skill-document-page-padding-bottom, 76px);
  border: 1px solid var(--skill-editor-page-border);
  border-radius: 4px;
  overflow: hidden;
  color: var(--skill-editor-page-text);
  background: var(--skill-editor-page);
  box-shadow: var(--skill-editor-page-shadow);
  transition:
    filter 140ms ease,
    opacity 140ms ease;

  &[data-first-page="true"] {
    grid-template-rows: max-content minmax(0, 1fr);
  }

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
  grid-template-rows: minmax(0, 1fr);
  align-self: stretch;
  width: calc(100% + var(--skill-document-body-bleed, 20px));
  min-width: 0;
  min-height: 0;
  margin-top: 0;
  margin-left: var(--skill-document-body-margin-left, -10px);

  &[data-first-page="true"] {
    margin-top: var(--skill-document-body-margin-top, 24px);
  }

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
  min-height: 0;
  height: 100%;
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
  min-height: 0;
  height: 100%;
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

const ToolsScriptEditor = styled(ToolsSkillsEditor)`
  font-family: "SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: calc(var(--skill-document-body-font-size, 15px) * 0.9);
  font-weight: 560;
  line-height: 1.62;
  tab-size: 2;
`;

const ScriptPaneTabs = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  width: fit-content;
  max-width: 100%;
  margin: 8px 10px;
  padding: 3px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  background: var(--tools-control-bg, rgba(7, 10, 15, 0.58));
`;

const ScriptPaneTabButton = styled.button`
  min-width: 62px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #8d96a6);
  background: transparent;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text-strong, #f6f8fb);
    background: rgba(var(--forge-tint-rgb), 0.2);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--forge-tint-rgb), 0.5);
    outline-offset: 2px;
  }
`;

const ScriptLogsPanel = styled.section`
  flex: 1 1 auto;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  height: auto;
  overflow: hidden;
  padding: 0 10px 10px;

  &[data-history="true"] {
    grid-template-rows: minmax(0, 1fr);
  }
`;

const ScriptLogsHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 10px;
  background:
    linear-gradient(135deg, rgba(var(--forge-tint-rgb), 0.12), rgba(214, 164, 70, 0.08)),
    rgba(12, 16, 23, 0.72);

  > div:first-child {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  > div:first-child strong,
  > div:first-child span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > div:first-child strong {
    color: var(--forge-text-strong, #f6f8fb);
    font-size: 13px;
    font-weight: 900;
  }

  > div:first-child span {
    color: var(--forge-text-muted, #8d96a6);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 10px;
    font-weight: 760;
  }
`;

const ScriptLogsStatus = styled.div`
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: max-content;
  min-width: max-content;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(125, 211, 252, 0.24);
  border-radius: 999px;
  color: #93c5fd;
  background: rgba(37, 99, 235, 0.16);
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;

  ${DocsExplorerSpinner} {
    flex: 0 0 auto;
    width: 11px;
    height: 11px;
  }

  span {
    display: inline-block;
    flex: 0 0 auto;
    min-width: max-content;
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }

  &[data-state="error"] {
    border-color: rgba(248, 113, 113, 0.28);
    color: #fca5a5;
    background: rgba(127, 29, 29, 0.18);
  }
`;

const ScriptLogsMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;

  span {
    min-height: 21px;
    padding: 4px 8px;
    border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
    border-radius: 999px;
    color: var(--forge-text-muted, #8d96a6);
    background: rgba(8, 11, 16, 0.58);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 9px;
    font-weight: 760;
  }
`;

const ScriptLogsMetaButton = styled.button`
  min-height: 21px;
  padding: 4px 9px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.28);
  border-radius: 999px;
  color: var(--forge-tint-soft, #7db0ff);
  background: rgba(var(--forge-tint-rgb), 0.12);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 9px;
  font-weight: 820;
  cursor: pointer;
  white-space: nowrap;

  &:hover,
  &:focus-visible {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.48);
    background: rgba(var(--forge-tint-rgb), 0.2);
    outline: none;
  }
`;

const ScriptLogsTerminal = styled.pre`
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 11px 12px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  overflow: auto;
  max-height: 100%;
  background: #05070a;
  color: #d8dee9;
  font-family: "SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  font-weight: 560;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const ScriptHistoryVirtualList = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 2px 3px 4px 0;
  border-radius: 10px;
  contain: layout paint style;
`;

const ScriptHistoryList = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  width: 100%;
`;

const ScriptHistoryRow = styled.article`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(72px, auto);
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  min-height: ${SCRIPT_HISTORY_ESTIMATED_ROW_HEIGHT - 8}px;
  overflow: hidden;
  padding: 8px 10px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 10px;
  background: rgba(8, 11, 16, 0.46);
  will-change: transform;

  &[data-active="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.28);
    background:
      linear-gradient(135deg, rgba(var(--forge-tint-rgb), 0.12), rgba(214, 164, 70, 0.06)),
      rgba(8, 11, 16, 0.56);
  }

  ${ScriptLogsStatus} {
    max-width: 100%;
    overflow: hidden;
  }

  ${ScriptLogsStatus} span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const ScriptHistoryRowMain = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
  overflow: hidden;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-strong, #f6f8fb);
    font-size: 12px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ScriptHistoryRowMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;

  span {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    min-height: 20px;
    align-items: center;
    padding: 2px 7px;
    border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
    border-radius: 999px;
    overflow: hidden;
    color: var(--forge-text-muted, #8d96a6);
    background: rgba(8, 11, 16, 0.42);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 9px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ScriptLogChunk = styled.span`
  display: inline;
  color: inherit;

  &[data-stream="stderr"] {
    color: #fca5a5;
  }
`;

const ScriptLogsPlaceholder = styled.span`
  display: block;
  color: var(--forge-text-muted, #8d96a6);
`;

const ScriptLogsEmpty = styled.div`
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  min-height: 220px;
  color: var(--forge-text-muted, #8d96a6);
  text-align: center;

  strong {
    color: var(--forge-text-strong, #f6f8fb);
    font-size: 15px;
    font-weight: 900;
  }

  span {
    max-width: 34rem;
    font-size: 12px;
    font-weight: 680;
  }
`;

const ScriptSelectionOverlay = styled(SkillDocumentSelectionOverlay)`
  font-family: "SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: calc(var(--skill-document-body-font-size, 15px) * 0.9);
  font-weight: 560;
  line-height: 1.62;
  tab-size: 2;
`;

const ScriptColorField = styled.label`
  display: inline-flex;
  flex: 1 1 98px;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 31px;
  min-width: 82px;
  max-width: 138px;
  padding: 0 8px;
  border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.12));
  border-radius: 8px;
  color: var(--forge-text-muted, #7a8493);
  background: var(--tools-control-bg);
  font-size: 10px;
  font-weight: 780;
  line-height: 1.05;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  input {
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--tools-border, rgba(230, 236, 245, 0.16));
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  input::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  input::-webkit-color-swatch {
    border: 0;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(4, 7, 12, 0.35);
  }
`;

const ScriptCreateFields = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  gap: 10px;
  min-width: 0;
`;

const ScriptColorCreateField = styled(DocsField)`
  input[type="color"] {
    width: 100%;
    padding: 4px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  input[type="color"]::-webkit-color-swatch {
    border: 0;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(4, 7, 12, 0.3);
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
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    overflow: visible;
    padding: 0;
    border-top: 0;
    background: transparent;
    min-width: 0;
    max-width: 100%;
  }

  &[data-placement="toolbar"] button {
    flex: 0 1 auto;
    height: 31px;
    min-width: max-content;
    padding: 0 12px;
    white-space: nowrap;
  }

  &[data-embedded-docs-panel="true"] {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    gap: 8px;
  }

  &[data-embedded-docs-panel="true"] button {
    width: 100%;
    min-width: 0;
    justify-content: center;
    padding: 0 8px;
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

  &[data-tone="danger"] {
    color: rgba(250, 180, 180, 0.92);
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
