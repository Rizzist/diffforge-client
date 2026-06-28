import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Architecture } from "@styled-icons/material-rounded/Architecture";
import { Article } from "@styled-icons/material-rounded/Article";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Psychology } from "@styled-icons/material-rounded/Psychology";
import styled from "styled-components";
import {
  accountDocumentStorageKey,
  normalizedDocumentKind,
} from "./skillsLibrary.js";
import {
  ensureWorkspaceToolsFresh,
  getWorkspaceToolsAccountSkills,
  getWorkspaceToolsVersion,
  hasWorkspaceToolsLoaded,
  subscribeWorkspaceTools,
  workspaceToolsRepoDescriptors,
} from "./workspaceToolsStore.js";
import {
  WORKSPACE_TOOL_DOC_DRAG_KIND,
  WORKSPACE_TOOL_DOC_DRAG_MIME,
  WORKSPACE_TOOL_TODO_DRAG_MIME,
  clearActiveWorkspaceToolDrag,
  setActiveWorkspaceToolDrag,
} from "./workspaceToolDragTypes.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skills" },
  { id: "architecture", label: "Architectures" },
  { id: "document", label: "Documents" },
];

const FILTER_STORAGE_PREFIX = "diffforge.workspaceTools.filter";
const SEND_STORAGE_PREFIX = "diffforge.workspaceTools.sendOnDrop";

const DOC_KIND_LABELS = {
  architecture: "Architecture",
  document: "Document",
  html: "HTML",
  skill: "Skill",
};

const DOC_KIND_ICONS = {
  architecture: Architecture,
  document: Article,
  html: Article,
  skill: Psychology,
};

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function storageKey(prefix, workspaceId) {
  return `${prefix}.${text(workspaceId, "default")}`;
}

function readStorage(prefix, workspaceId, fallback) {
  try {
    const value = window.localStorage.getItem(storageKey(prefix, workspaceId));
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(prefix, workspaceId, value) {
  try {
    window.localStorage.setItem(storageKey(prefix, workspaceId), String(value));
  } catch {
    // Persistence is best-effort.
  }
}

function normalizedFilterId(value) {
  const normalized = text(value, "all").toLowerCase();
  if (normalized === "arch" || normalized === "architectures") return "architecture";
  if (normalized === "skills") return "skill";
  if (normalized === "instruction" || normalized === "instructions") return "document";
  if (normalized === "docs" || normalized === "documents") return "document";
  if (normalized === "generic" || normalized === "doc" || normalized === "document") return "document";
  return FILTERS.some((entry) => entry.id === normalized) ? normalized : "all";
}

function documentTitle(entry) {
  return text(entry?.title || entry?.name || entry?.id || entry?.documentId || entry?.document_id, "Untitled doc");
}

function documentBody(entry) {
  return String(entry?.content ?? entry?.contentMd ?? entry?.content_md ?? entry?.body ?? "");
}

function documentKind(entry) {
  return normalizedDocumentKind(
    entry?.documentKind || entry?.document_kind || entry?.source || entry?.kind,
    entry?.collection,
  );
}

function documentIsFolder(entry) {
  const rowType = text(entry?.rowType || entry?.row_type || entry?.type).toLowerCase();
  const entryKind = text(entry?.entryKind || entry?.entry_kind).toLowerCase();
  return rowType === "folder" || entryKind === "folder";
}

function docCardEntry(entry) {
  const kind = documentKind(entry);
  const title = documentTitle(entry);
  return {
    body: documentBody(entry),
    contentHash: text(entry?.contentHash || entry?.content_hash || entry?.sha256),
    id: text(entry?.id || entry?.documentId || entry?.document_id || accountDocumentStorageKey(entry)),
    kind,
    key: accountDocumentStorageKey(entry) || text(entry?.id || title),
    localPath: text(entry?.localPath || entry?.local_path),
    pathKey: text(entry?.pathKey || entry?.path_key),
    title,
    typeLabel: DOC_KIND_LABELS[kind] || "Document",
  };
}

function docTodoText(entry) {
  const body = text(entry.body).slice(0, 4000);
  return body
    ? `Apply the "${entry.title}" account doc:\n\n${body}`
    : `Apply the "${entry.title}" account doc.`;
}

function docDragPayload(entry, sendOnDrop) {
  return {
    document: {
      content_hash: entry.contentHash,
      doc_id: entry.id,
      document_kind: entry.kind,
      local_path: entry.localPath,
      path_key: entry.pathKey || entry.key,
      title: entry.title,
    },
    send_on_drop: Boolean(sendOnDrop),
    text: docTodoText(entry),
    type: "account_document",
  };
}

/**
 * Drag-and-drop sources for account docs. Cards can be dragged into terminals
 * or other tool-aware drop zones; send-on-drop controls terminal dispatch.
 */
export default function WorkspaceToolsDragPanel({
  coordinationTargets = [],
  documentPanelEnabled = false,
  onOpenDocumentPanel = null,
  rootDirectory = "",
  workspaceId = "",
}) {
  const [filter, setFilter] = useState(() => {
    return normalizedFilterId(readStorage(FILTER_STORAGE_PREFIX, workspaceId, "all"));
  });
  const [sendOnDrop, setSendOnDrop] = useState(
    () => readStorage(SEND_STORAGE_PREFIX, workspaceId, "false") === "true",
  );
  const repoDescriptors = useMemo(
    () => workspaceToolsRepoDescriptors(coordinationTargets, rootDirectory),
    [coordinationTargets, rootDirectory],
  );
  const storeVersion = useSyncExternalStore(subscribeWorkspaceTools, getWorkspaceToolsVersion);

  useEffect(() => {
    ensureWorkspaceToolsFresh(repoDescriptors);
  }, [repoDescriptors]);

  const docs = useMemo(
    () => getWorkspaceToolsAccountSkills()
      .filter((entry) => !documentIsFolder(entry))
      .map(docCardEntry)
      .filter((entry) => entry.key || entry.title || text(entry.body))
      .sort((left, right) => left.title.localeCompare(right.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeVersion],
  );
  const toolsLoaded = hasWorkspaceToolsLoaded(repoDescriptors);

  useEffect(() => {
    setFilter(normalizedFilterId(readStorage(FILTER_STORAGE_PREFIX, workspaceId, "all")));
    setSendOnDrop(readStorage(SEND_STORAGE_PREFIX, workspaceId, "false") === "true");
  }, [workspaceId]);

  const selectFilter = useCallback((next) => {
    setFilter(next);
    writeStorage(FILTER_STORAGE_PREFIX, workspaceId, next);
  }, [workspaceId]);

  const toggleSendOnDrop = useCallback(() => {
    setSendOnDrop((current) => {
      writeStorage(SEND_STORAGE_PREFIX, workspaceId, String(!current));
      return !current;
    });
  }, [workspaceId]);

  const handleDragStart = useCallback((event, entry) => {
    const payload = docDragPayload(entry, sendOnDrop);
    event.dataTransfer.setData(WORKSPACE_TOOL_TODO_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData(WORKSPACE_TOOL_DOC_DRAG_MIME, JSON.stringify({
      ...payload.document,
      document: payload.document,
      kind: WORKSPACE_TOOL_DOC_DRAG_KIND,
      type: payload.type,
    }));
    event.dataTransfer.setData("text/plain", payload.text);
    event.dataTransfer.effectAllowed = "copy";
    // Stash the payload so a drop onto a separate breakout terminal window can
    // be committed by the main window without re-reading dataTransfer.
    setActiveWorkspaceToolDrag({ text: payload.text, send: payload.send_on_drop });
  }, [sendOnDrop]);

  const handleDragEnd = useCallback(() => {
    clearActiveWorkspaceToolDrag();
  }, []);

  const handleOpenDocument = useCallback((event, entry) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof onOpenDocumentPanel === "function") {
      onOpenDocumentPanel(entry);
    }
  }, [onOpenDocumentPanel]);

  const visibleDocs = filter === "all"
    ? docs
    : docs.filter((entry) => entry.kind === filter || (filter === "document" && entry.kind === "html"));

  return (
    <Panel aria-label="Draggable workspace docs">
      <Toolbar>
        <FilterNav role="tablist" aria-label="Doc filter">
          {FILTERS.map((entry) => (
            <FilterButton
              aria-selected={filter === entry.id}
              data-active={filter === entry.id ? "true" : "false"}
              key={entry.id}
              onClick={() => selectFilter(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </FilterButton>
          ))}
        </FilterNav>
        <ToolbarActions>
          <SendToggle
            aria-pressed={sendOnDrop}
            data-active={sendOnDrop ? "true" : "false"}
            onClick={toggleSendOnDrop}
            title={sendOnDrop
              ? "Dropping a doc onto a terminal sends immediately"
              : "Dropping a doc onto a terminal adds it without sending"}
            type="button"
          >
            <SendToggleKnob aria-hidden="true" data-active={sendOnDrop ? "true" : "false"} />
            Send on drop
          </SendToggle>
        </ToolbarActions>
      </Toolbar>

      <ItemsScroll>
        {visibleDocs.length > 0 && (
          <DocCardGrid aria-label="Account docs" role="list">
            {visibleDocs.map((entry) => {
              const KindIcon = DOC_KIND_ICONS[entry.kind] || Article;
              return (
                <DocCard
                  aria-label={`${entry.typeLabel} document ${entry.title}`}
                  draggable
                  key={`doc:${entry.key || entry.title}`}
                  onDragStart={(event) => handleDragStart(event, entry)}
                  onDragEnd={handleDragEnd}
                  role="listitem"
                >
                  {documentPanelEnabled && (
                    <DocCardOpenButton
                      aria-label={`Open ${entry.title}`}
                      onClick={(event) => handleOpenDocument(event, entry)}
                      onPointerDown={(event) => event.stopPropagation()}
                      title="Open beside terminals"
                      type="button"
                    >
                      <OpenInNew aria-hidden="true" />
                      Open
                    </DocCardOpenButton>
                  )}
                  <DocCardContent>
                    <DocCardIcon aria-hidden="true" data-kind={entry.kind}>
                      <KindIcon />
                    </DocCardIcon>
                    <DocCardCopy>
                      <DocCardTitle>{entry.title}</DocCardTitle>
                      <DocCardType>{entry.typeLabel}</DocCardType>
                    </DocCardCopy>
                  </DocCardContent>
                </DocCard>
              );
            })}
          </DocCardGrid>
        )}
        {toolsLoaded && !visibleDocs.length && (
          <Empty>
            {filter === "all"
              ? "No docs yet."
              : `No ${FILTERS.find((entry) => entry.id === filter)?.label.toLowerCase() || "docs"} yet.`}
          </Empty>
        )}
        {!toolsLoaded && !visibleDocs.length && (
          <Empty>Loading docs…</Empty>
        )}
      </ItemsScroll>
    </Panel>
  );
}

const Panel = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 10px;
`;

const Toolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 6px;
`;

const FilterNav = styled.nav`
  display: flex;
  min-width: 0;
  width: 100%;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.5);

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.045);
  }
`;

const FilterButton = styled.button`
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text, #f4f7fa);
    background: rgba(var(--forge-tint-rgb), 0.14);
  }
`;

const ToolbarActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-self: start;
  min-width: 0;
`;

const SendToggle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 999px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;

  &[data-active="true"] {
    border-color: rgba(60, 203, 127, 0.35);
    color: rgba(150, 230, 185, 0.95);
  }
`;

const SendToggleKnob = styled.span`
  width: 22px;
  height: 12px;
  border-radius: 999px;
  background: rgba(122, 132, 147, 0.4);
  position: relative;

  &::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(244, 247, 250, 0.85);
    transition: transform 130ms ease;
  }

  &[data-active="true"] {
    background: rgba(60, 203, 127, 0.5);
  }

  &[data-active="true"]::after {
    transform: translateX(10px);
  }
`;

const ItemsScroll = styled.div`
  display: grid;
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  padding-top: 3px;
  scroll-padding-top: 3px;
  scrollbar-width: thin;
`;

const DocCardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  align-content: start;
  gap: 10px;
  min-width: 0;
`;

const DocCard = styled.div`
  position: relative;
  display: grid;
  place-items: center;
  min-width: 0;
  aspect-ratio: 1.618 / 1;
  padding: 11px 10px 9px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(var(--forge-tint-rgb), 0.08), transparent 46%),
    rgba(13, 17, 23, 0.58);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
  cursor: grab;
  user-select: none;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;

  &:hover {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.25);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 10px 24px rgba(0, 0, 0, 0.16);
    transform: translateY(-1px);
  }

  &:active {
    cursor: grabbing;
    transform: translateY(0);
  }

  html[data-forge-theme="light"] & {
    background:
      linear-gradient(135deg, rgba(var(--forge-tint-rgb), 0.08), transparent 46%),
      #ffffff;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
  }
`;

const DocCardOpenButton = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.28);
  border-radius: 999px;
  color: #ffffff;
  background: rgba(8, 12, 18, 0.82);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
  cursor: pointer;
  font-size: 10px;
  font-weight: 850;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    opacity 120ms ease,
    transform 120ms ease,
    border-color 120ms ease,
    background 120ms ease;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover,
  &:focus-visible {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.46);
    background: rgba(var(--forge-tint-rgb), 0.28);
  }

  ${DocCard}:hover &,
  ${DocCard}:focus-within & {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  html[data-forge-theme="light"] & {
    color: #0f172a;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
  }
`;

const DocCardContent = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
`;

const DocCardIcon = styled.span`
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border: 1px solid rgba(230, 236, 245, 0.08);
  border-radius: 8px;
  color: rgba(125, 176, 255, 0.95);
  background: rgba(125, 176, 255, 0.12);

  svg {
    width: 18px;
    height: 18px;
  }

  &[data-kind="skill"] {
    color: rgba(150, 230, 185, 0.95);
    background: rgba(60, 203, 127, 0.13);
  }

  &[data-kind="architecture"] {
    color: rgba(150, 190, 255, 0.96);
    background: rgba(80, 135, 245, 0.14);
  }

  &[data-kind="document"] {
    color: rgba(188, 158, 235, 0.96);
    background: rgba(188, 158, 235, 0.13);
  }
`;

const DocCardCopy = styled.div`
  display: grid;
  align-content: center;
  justify-items: start;
  min-width: 0;
  gap: 7px;
`;

const DocCardTitle = styled.strong`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text, #f4f7fa);
  font-size: 12.5px;
  font-weight: 750;
  line-height: 1.22;
  text-align: left;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;

  html[data-forge-theme="light"] & {
    color: #171b22;
  }
`;

const DocCardType = styled.span`
  justify-self: start;
  max-width: 100%;
  overflow: hidden;
  color: var(--forge-text-muted, #7a8493);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const Empty = styled.p`
  margin: 8px 0 0;
  color: var(--forge-text-muted, #7a8493);
  font-size: 11.5px;
`;
