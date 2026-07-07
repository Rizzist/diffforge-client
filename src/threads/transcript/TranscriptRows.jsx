// Row components for the rebuilt transcript: user message, assistant
// markdown, reasoning disclosure, tool card, file-change card, subagent
// group, error card, turn fold header, dividers, command rows, and the
// active "working" row.

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Edit as EditIcon } from "@styled-icons/material-rounded/Edit";
import { KeyboardArrowDown as ChevronIcon } from "@styled-icons/material-rounded/KeyboardArrowDown";
import { PlayArrow as ContinueIcon } from "@styled-icons/material-rounded/PlayArrow";
import { SmartToy as SubagentIcon } from "@styled-icons/material-rounded/SmartToy";
import { Send as RetryIcon } from "@styled-icons/material-rounded/Send";

import { AnsiText, CommandItemRow } from "./TerminalChatKit";
import {
  artifactImageUrl,
  foldHeaderLabel,
  formatDurationMs,
  messageContentText,
  messageFileChange,
  messageTool,
  messageTruncated,
  middleEllipsis,
  normalizeFileChangeFile,
  prettyPrintValue,
  reasoningDurationMs,
  toolDurationMs,
  toolExitCode,
  toolInputSummary,
  toolName,
  toolStatusToken,
  transcriptArray,
  transcriptText,
  transcriptTimestampMs,
  transcriptToken,
  usageTooltip,
} from "./builders.mjs";
import { BottomSheet, useIsMobileViewport } from "./BottomSheet";
import { CopyButton, TranscriptMarkdown } from "./MarkdownContent";
import {
  ArtifactChip,
  ArtifactImageLink,
  ArtifactList,
  AssistantRow,
  CollapseOuter,
  DividerRow,
  ErrorCardFrame,
  FileChangeFrame,
  FileChangeHeader,
  FileChangeList,
  FileChangeRowLine,
  FoldChevron,
  FoldErrorDot,
  FoldHeaderRow,
  FoldSummaryText,
  GhostActionButton,
  ReasoningBody,
  ReasoningRowFrame,
  ReasoningToggle,
  RowMetaLine,
  StatusPill,
  SubagentChildren,
  SubagentFrame,
  SubagentHeader,
  ToolCardBody,
  ToolCardChip,
  ToolCardFrame,
  ToolCardHeader,
  ToolCardName,
  ToolCardSummary,
  ToolPane,
  ToolPaneHeader,
  ToolPaneScroll,
  ToolStatusDot,
  UserBubble,
  UserRow,
  WorkingDots,
  WorkingRowFrame,
} from "./styles";

/* ------------------------------------------------------------------ */
/* Local formatting                                                    */
/* ------------------------------------------------------------------ */

function formatAbsolute(value) {
  const timestamp = transcriptTimestampMs(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatRelative(value, nowMs = Date.now()) {
  const timestamp = transcriptTimestampMs(value);
  if (!Number.isFinite(timestamp)) return "";
  const deltaMs = Math.max(0, nowMs - timestamp);
  if (deltaMs < 45_000) return "now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(deltaMs / 86_400_000);
  if (days < 14) return `${days}d ago`;
  return formatAbsolute(timestamp);
}

function formatElapsedClock(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Disclosure state is hoisted into the transcript view (keyed by row key) so
// virtualization unmounts never lose it; standalone usage falls back to local
// state.
function useRowDisclosure(open = false, onToggleOpen = null) {
  const [localOpen, setLocalOpen] = useState(false);
  if (typeof onToggleOpen === "function") {
    return [Boolean(open), onToggleOpen];
  }
  return [localOpen, () => setLocalOpen((value) => !value)];
}

/* ------------------------------------------------------------------ */
/* Collapse: animated height via ResizeObserver, reduced-motion aware  */
/* ------------------------------------------------------------------ */

function collapseDurationMs(node) {
  try {
    const raw = window.getComputedStyle(node).transitionDuration || "";
    return raw.split(",").reduce((longest, part) => {
      const text = part.trim();
      const value = Number.parseFloat(text);
      if (!Number.isFinite(value)) return longest;
      return Math.max(longest, text.endsWith("ms") ? value : value * 1000);
    }, 0);
  } catch {
    return 0;
  }
}

export function Collapse({ open, children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [rendered, setRendered] = useState(Boolean(open));
  if (open && !rendered) {
    // Render-time state adjustment: mount the content in the same pass the
    // disclosure opens so the height transition has something to measure.
    setRendered(true);
  }
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer) return undefined;
    if (!rendered) {
      outer.style.height = "0px";
      return undefined;
    }
    outer.style.height = `${open && inner ? inner.offsetHeight : 0}px`;
    if (!open && collapseDurationMs(outer) === 0) {
      // Reduced motion (or any zero-duration transition): transitionend never
      // fires, so unmount the closed content immediately.
      setRendered(false);
      return undefined;
    }
    let observer = null;
    if (open && inner && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        outer.style.height = `${inner.offsetHeight}px`;
      });
      observer.observe(inner);
    }
    const handleEnd = (event) => {
      if (event.target === outer && !open) {
        setRendered(false);
      }
    };
    outer.addEventListener("transitionend", handleEnd);
    outer.addEventListener("transitioncancel", handleEnd);
    return () => {
      observer?.disconnect();
      outer.removeEventListener("transitionend", handleEnd);
      outer.removeEventListener("transitioncancel", handleEnd);
    };
  }, [open, rendered]);
  return (
    <CollapseOuter aria-hidden={!open || undefined} ref={outerRef} style={{ height: 0 }}>
      {rendered ? <div ref={innerRef}>{children}</div> : null}
    </CollapseOuter>
  );
}

/* ------------------------------------------------------------------ */
/* Truncated chip: fetches the full durable record on demand           */
/* ------------------------------------------------------------------ */

function messageRecordRef(message = {}) {
  const recordId = transcriptText(message.recordId || message.record_id);
  const seqSource = message.recordSeq ?? message.record_seq;
  const recordSeq = seqSource == null ? null : Number(seqSource);
  return {
    recordId,
    recordSeq: Number.isFinite(recordSeq) && recordSeq > 0 ? recordSeq : null,
  };
}

export function TruncatedChip({ message = {}, onFetchTruncated }) {
  const [fetching, setFetching] = useState(false);
  const { recordId, recordSeq } = messageRecordRef(message);
  const interactive = typeof onFetchTruncated === "function" && Boolean(recordId || recordSeq);
  if (!interactive) {
    return <StatusPill data-status="truncated">truncated</StatusPill>;
  }
  const fetchFullRecord = (event) => {
    event.stopPropagation();
    if (fetching) return;
    setFetching(true);
    Promise.resolve(onFetchTruncated(message))
      .catch(() => false)
      .then(() => setFetching(false));
  };
  return (
    <StatusPill
      data-status="truncated"
      onClick={fetchFullRecord}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          fetchFullRecord(event);
        }
      }}
      role="button"
      tabIndex={0}
      title="Fetch the full record"
    >
      {fetching ? "fetching…" : "truncated"}
    </StatusPill>
  );
}

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

export function ArtifactListView({ artifacts = [] }) {
  const safeArtifacts = transcriptArray(artifacts);
  if (!safeArtifacts.length) return null;
  return (
    <ArtifactList>
      {safeArtifacts.map((artifact, index) => {
        const key = artifact.assetId || artifact.asset_id || artifact.url || artifact.path || index;
        const imageUrl = artifactImageUrl(artifact);
        if (imageUrl) {
          return (
            <ArtifactImageLink
              href={imageUrl}
              key={key}
              rel="noreferrer noopener"
              target="_blank"
              title={artifact.title || imageUrl}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={artifact.title || "Artifact image"} loading="lazy" src={imageUrl} />
            </ArtifactImageLink>
          );
        }
        return (
          <ArtifactChip key={key}>
            <strong>{artifact.title || artifact.kind || "Artifact"}</strong>
            <span>{artifact.path || artifact.assetPath || artifact.asset_path || artifact.url || ""}</span>
          </ArtifactChip>
        );
      })}
    </ArtifactList>
  );
}

/* ------------------------------------------------------------------ */
/* User + assistant rows                                               */
/* ------------------------------------------------------------------ */

// User-bubble statuses that surface recovery affordances (Edit / Resend, and
// Continue for interrupted turns) when the host wires onUserMessageAction.
const USER_MESSAGE_ACTIONABLE_STATUSES = new Set(["interrupted", "queued", "failed", "error"]);

export function UserMessageRow({ message = {}, onFetchTruncated, onUserMessageAction = null }) {
  const content = messageContentText(message);
  const truncated = messageTruncated(message);
  const status = transcriptToken(message.status);
  const timestamp = message.timestamp || message.created_at || message.createdAt;
  const relative = formatRelative(timestamp);
  const actionable = typeof onUserMessageAction === "function"
    && USER_MESSAGE_ACTIONABLE_STATUSES.has(status)
    && Boolean(content);
  const showRetry = typeof message.onRetry === "function" && !actionable;
  const showStatus = status && !["complete", "completed", "synced"].includes(status);
  return (
    <UserRow data-message-role="user">
      <UserBubble>
        {content || "(empty message)"}
        <ArtifactListView artifacts={message.artifacts} />
      </UserBubble>
      <RowMetaLine $user>
        {relative ? <span title={formatAbsolute(timestamp)}>{relative}</span> : null}
        {showStatus ? <StatusPill data-status={status}>{status}</StatusPill> : null}
        {truncated ? <TruncatedChip message={message} onFetchTruncated={onFetchTruncated} /> : null}
        {actionable ? (
          <span data-transcript-actions style={{ display: "inline-flex", gap: 3 }}>
            <GhostActionButton
              aria-label="Edit message in the composer"
              onClick={() => onUserMessageAction("edit", message, content)}
              title="Prefill the composer with this message"
              type="button"
            >
              <EditIcon aria-hidden="true" />
              Edit
            </GhostActionButton>
            <GhostActionButton
              aria-label="Resend message"
              onClick={() => onUserMessageAction("resend", message, content)}
              title="Send this message again"
              type="button"
            >
              <RetryIcon aria-hidden="true" />
              Resend
            </GhostActionButton>
            {status === "interrupted" ? (
              <GhostActionButton
                aria-label="Continue interrupted message"
                onClick={() => onUserMessageAction("continue", message, content)}
                title="Re-submit this interrupted message"
                type="button"
              >
                <ContinueIcon aria-hidden="true" />
                Continue
              </GhostActionButton>
            ) : null}
          </span>
        ) : null}
        {showRetry ? (
          <GhostActionButton aria-label="Retry message" onClick={message.onRetry} type="button">
            <RetryIcon aria-hidden="true" />
            Retry
          </GhostActionButton>
        ) : null}
        {content ? (
          <span data-transcript-actions style={{ display: "inline-flex" }}>
            <CopyButton text={content} />
          </span>
        ) : null}
      </RowMetaLine>
    </UserRow>
  );
}

export function AssistantMessageRow({ message = {}, live = false, onFetchTruncated }) {
  const content = messageContentText(message);
  const truncated = messageTruncated(message);
  if (!content && !transcriptArray(message.artifacts).length) return null;
  return (
    <AssistantRow data-message-role="assistant">
      <TranscriptMarkdown content={content} live={live} />
      <ArtifactListView artifacts={message.artifacts} />
      {content || truncated ? (
        <RowMetaLine>
          {truncated ? <TruncatedChip message={message} onFetchTruncated={onFetchTruncated} /> : null}
          {content ? (
            <span data-transcript-actions style={{ display: "inline-flex" }}>
              <CopyButton text={content} />
            </span>
          ) : null}
        </RowMetaLine>
      ) : null}
    </AssistantRow>
  );
}

export function TerminalOutputRow({ message = {} }) {
  const content = messageContentText(message, 60000);
  if (!content) return null;
  return (
    <AssistantRow data-message-role="assistant">
      <ToolPane>
        <ToolPaneHeader>
          <span>Terminal</span>
          <CopyButton text={content} />
        </ToolPaneHeader>
        <ToolPaneScroll>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            <AnsiText maxChars={60000} text={content} />
          </pre>
        </ToolPaneScroll>
      </ToolPane>
    </AssistantRow>
  );
}

/* ------------------------------------------------------------------ */
/* Reasoning                                                           */
/* ------------------------------------------------------------------ */

export function ReasoningDisclosureRow({ message = {}, open: openProp = false, onToggleOpen = null, onFetchTruncated }) {
  const [open, toggleOpen] = useRowDisclosure(openProp, onToggleOpen);
  const content = messageContentText(message);
  const truncated = messageTruncated(message);
  const duration = formatDurationMs(reasoningDurationMs(message));
  const label = duration ? `Thought for ${duration}` : (message.title || "Reasoning");
  if (!content) return null;
  return (
    <ReasoningRowFrame data-message-role="reasoning">
      <ReasoningToggle
        aria-expanded={open}
        onClick={toggleOpen}
        type="button"
      >
        <FoldChevron $open={open} aria-hidden="true">
          <ChevronIcon />
        </FoldChevron>
        {label}
        {truncated ? <TruncatedChip message={message} onFetchTruncated={onFetchTruncated} /> : null}
      </ReasoningToggle>
      <Collapse open={open}>
        <ReasoningBody>{content}</ReasoningBody>
      </Collapse>
    </ReasoningRowFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Tool card                                                           */
/* ------------------------------------------------------------------ */

function ToolPaneSection({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  const text = prettyPrintValue(value);
  if (!text) return null;
  const isPlainText = typeof value === "string";
  return (
    <ToolPane>
      <ToolPaneHeader>
        <span>{label}</span>
        <CopyButton text={text} />
      </ToolPaneHeader>
      <ToolPaneScroll>
        {isPlainText ? (
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            <AnsiText maxChars={60000} text={text} />
          </pre>
        ) : (
          <pre>{text}</pre>
        )}
      </ToolPaneScroll>
    </ToolPane>
  );
}

export function ToolCardPanes({ message = {} }) {
  const tool = messageTool(message) || {};
  const input = tool.input ?? tool.arguments ?? tool.args ?? tool.parameters ?? tool.params;
  const output = tool.output ?? tool.result ?? tool.response;
  const fallbackContent = input === undefined && output === undefined
    ? messageContentText(message, 60000)
    : "";
  return (
    <>
      <ToolPaneSection label="Input" value={input} />
      <ToolPaneSection label="Output" value={output} />
      {fallbackContent ? <ToolPaneSection label="Details" value={fallbackContent} /> : null}
      <ArtifactListView artifacts={message.artifacts} />
    </>
  );
}

export function ToolCardRow({ message = {}, open: openProp = false, onToggleOpen = null, onFetchTruncated }) {
  const [open, toggleOpen] = useRowDisclosure(openProp, onToggleOpen);
  const isMobile = useIsMobileViewport();
  const tool = messageTool(message) || {};
  const name = toolName(message);
  const status = toolStatusToken(message.status || tool.status);
  const summary = toolInputSummary(message);
  const durationLabel = formatDurationMs(toolDurationMs(message));
  const exitCode = toolExitCode(message);
  const truncated = messageTruncated(message);
  const hasBody = tool.input !== undefined
    || tool.output !== undefined
    || tool.arguments !== undefined
    || tool.result !== undefined
    || Boolean(messageContentText(message, 200))
    || transcriptArray(message.artifacts).length > 0;
  const expandedInline = open && hasBody && !isMobile;
  return (
    <ToolCardFrame
      data-message-role="tool"
      data-open={expandedInline ? "true" : undefined}
      data-status={status === "running" ? "running" : undefined}
    >
      <ToolCardHeader
        $interactive={hasBody}
        aria-expanded={hasBody ? open : undefined}
        as={hasBody ? "button" : "div"}
        onClick={hasBody ? toggleOpen : undefined}
        type={hasBody ? "button" : undefined}
      >
        <ToolStatusDot aria-hidden="true" data-status={status} />
        <ToolCardName>{name}</ToolCardName>
        {summary ? <ToolCardSummary>{summary}</ToolCardSummary> : null}
        {durationLabel ? <ToolCardChip>{durationLabel}</ToolCardChip> : null}
        {Number.isFinite(exitCode) ? (
          <ToolCardChip data-tone={exitCode === 0 ? undefined : "bad"}>
            exit {exitCode}
          </ToolCardChip>
        ) : null}
        {truncated ? <TruncatedChip message={message} onFetchTruncated={onFetchTruncated} /> : null}
        {hasBody ? (
          <FoldChevron $open={open} aria-hidden="true">
            <ChevronIcon />
          </FoldChevron>
        ) : null}
      </ToolCardHeader>
      {hasBody && !isMobile ? (
        <Collapse open={open}>
          <ToolCardBody>
            <ToolCardPanes message={message} />
          </ToolCardBody>
        </Collapse>
      ) : null}
      {hasBody && isMobile && open ? (
        <BottomSheet
          onClose={toggleOpen}
          title={(
            <>
              <ToolStatusDot aria-hidden="true" data-status={status} />
              <strong>{name}</strong>
              {durationLabel ? <ToolCardChip>{durationLabel}</ToolCardChip> : null}
            </>
          )}
        >
          <ToolCardPanes message={message} />
        </BottomSheet>
      ) : null}
    </ToolCardFrame>
  );
}

/* ------------------------------------------------------------------ */
/* File-change card                                                    */
/* ------------------------------------------------------------------ */

const FILE_CHANGE_PREVIEW_COUNT = 8;

function fileChangeRowFiles(row = {}) {
  if (row.synthetic) {
    return {
      files: transcriptArray(row.files),
      additions: row.additions || 0,
      deletions: row.deletions || 0,
      summary: row.summary || "",
    };
  }
  const fileChange = row.message ? messageFileChange(row.message) : null;
  const files = transcriptArray(fileChange?.files).map(normalizeFileChangeFile).filter(Boolean);
  let additions = 0;
  let deletions = 0;
  files.forEach((file) => {
    additions += Math.max(0, Number(file.additions) || 0);
    deletions += Math.max(0, Number(file.deletions) || 0);
  });
  return {
    files,
    additions,
    deletions,
    summary: transcriptText(fileChange?.summary || row.message?.title),
  };
}

function FileChangeLine({ file = {} }) {
  const additions = Number.isFinite(file.additions) ? file.additions : null;
  const deletions = Number.isFinite(file.deletions) ? file.deletions : null;
  return (
    <FileChangeRowLine>
      <span title={file.path}>{middleEllipsis(file.path, 64)}</span>
      {file.kind && file.kind !== "edit" ? <i>{file.kind}</i> : null}
      <em>
        {additions !== null ? <b data-tone="add">+{additions}</b> : null}
        {additions !== null && deletions !== null ? " " : null}
        {deletions !== null ? <b data-tone="delete">−{deletions}</b> : null}
      </em>
    </FileChangeRowLine>
  );
}

export function FileChangeCardRow({ row = {}, open: openProp = false, onToggleOpen = null }) {
  const [showAll, toggleShowAll] = useRowDisclosure(openProp, onToggleOpen);
  const isMobile = useIsMobileViewport();
  const { files, additions, deletions, summary } = fileChangeRowFiles(row);
  if (!files.length) return null;
  const preview = files.slice(0, FILE_CHANGE_PREVIEW_COUNT);
  const hidden = files.length - preview.length;
  const header = (
    <FileChangeHeader>
      <strong>{files.length} file{files.length === 1 ? "" : "s"} changed</strong>
      <b data-tone="add">+{additions}</b>
      <b data-tone="delete">−{deletions}</b>
      {summary ? <i title={summary}>{summary}</i> : null}
    </FileChangeHeader>
  );
  return (
    <FileChangeFrame data-message-role="file-change">
      {header}
      <FileChangeList>
        {preview.map((file, index) => (
          <FileChangeLine file={file} key={file.path || index} />
        ))}
        {hidden > 0 && !isMobile ? (
          <Collapse open={showAll}>
            {files.slice(FILE_CHANGE_PREVIEW_COUNT).map((file, index) => (
              <FileChangeLine file={file} key={file.path || `rest-${index}`} />
            ))}
          </Collapse>
        ) : null}
        {hidden > 0 ? (
          <FileChangeRowLine as="div" style={{ paddingTop: 2 }}>
            <GhostActionButton
              onClick={toggleShowAll}
              type="button"
            >
              {showAll && !isMobile ? "Show fewer files" : `Show all ${files.length} files`}
            </GhostActionButton>
          </FileChangeRowLine>
        ) : null}
      </FileChangeList>
      {hidden > 0 && isMobile && showAll ? (
        <BottomSheet
          onClose={toggleShowAll}
          title={<strong>{files.length} files changed · +{additions} −{deletions}</strong>}
        >
          {files.map((file, index) => (
            <FileChangeLine file={file} key={file.path || `sheet-${index}`} />
          ))}
        </BottomSheet>
      ) : null}
    </FileChangeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Subagent group                                                      */
/* ------------------------------------------------------------------ */

export function SubagentGroupRow({ row = {}, live = false, openRowKeys = null, onToggleRowOpen = null, onFetchTruncated }) {
  const status = toolStatusToken(row.status);
  return (
    <SubagentFrame data-message-role="subagent">
      <SubagentHeader>
        <SubagentIcon aria-hidden="true" />
        <span>Subagent · {row.title || "Task"}</span>
        {row.status ? <StatusPill data-status={status}>{row.status}</StatusPill> : null}
      </SubagentHeader>
      <SubagentChildren>
        {transcriptArray(row.childRows).map((child) => (
          <TranscriptRowBody
            key={child.key}
            live={live}
            onFetchTruncated={onFetchTruncated}
            onToggleRowOpen={onToggleRowOpen}
            openRowKeys={openRowKeys}
            row={child}
          />
        ))}
      </SubagentChildren>
    </SubagentFrame>
  );
}

function SubagentNoteRow({ message = {} }) {
  const content = messageContentText(message, 4000);
  if (!content) return null;
  return (
    <RowMetaLine as="div">
      <span>{content}</span>
    </RowMetaLine>
  );
}

/* ------------------------------------------------------------------ */
/* Error card                                                          */
/* ------------------------------------------------------------------ */

export function ErrorCardRow({ message = {} }) {
  const content = messageContentText(message, 20000);
  const title = transcriptText(message.title, "Error");
  return (
    <ErrorCardFrame data-message-role="error">
      <header>{title}</header>
      {content ? <pre>{content}</pre> : null}
    </ErrorCardFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Fold header                                                         */
/* ------------------------------------------------------------------ */

export function FoldHeaderRowView({ row = {}, onToggle }) {
  const summary = row.summary || null;
  const label = foldHeaderLabel(summary);
  const tooltip = summary?.usage ? usageTooltip(summary.usage) : "";
  const interactive = Boolean(row.foldable && onToggle);
  return (
    <FoldHeaderRow
      $interactive={interactive}
      aria-expanded={row.foldable ? !row.folded : undefined}
      as={interactive ? "button" : "div"}
      data-message-role="fold"
      onClick={interactive ? () => onToggle(row.groupKey) : undefined}
      title={tooltip || undefined}
      type={interactive ? "button" : undefined}
    >
      {interactive ? (
        <FoldChevron $open={!row.folded} aria-hidden="true">
          <ChevronIcon />
        </FoldChevron>
      ) : null}
      {summary?.hasError ? <FoldErrorDot aria-hidden="true" /> : null}
      <FoldSummaryText>{label}</FoldSummaryText>
      {Number.isFinite(summary?.usage?.costUsd) ? (
        <em>${summary.usage.costUsd.toFixed(2)}</em>
      ) : null}
    </FoldHeaderRow>
  );
}

/* ------------------------------------------------------------------ */
/* Working row                                                         */
/* ------------------------------------------------------------------ */

export function WorkingRow({ label = "Working", startedAtMs = 0 }) {
  const timerRef = useRef(null);
  useEffect(() => {
    if (!startedAtMs) return undefined;
    const tick = () => {
      const node = timerRef.current;
      if (node) {
        // Direct textContent writes: the elapsed timer never re-renders React.
        node.textContent = formatElapsedClock(Date.now() - startedAtMs);
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [startedAtMs]);
  return (
    <WorkingRowFrame data-message-role="working" role="status">
      <WorkingDots aria-hidden="true">
        <i />
        <i />
        <i />
      </WorkingDots>
      <span>{label}</span>
      {startedAtMs ? <em ref={timerRef} /> : null}
    </WorkingRowFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export const TranscriptRowBody = memo(function TranscriptRowBody({ row = {}, live = false, onToggleTurn, openRowKeys = null, onToggleRowOpen = null, onFetchTruncated, onUserMessageAction = null }) {
  const rowOpen = Boolean(openRowKeys?.has?.(row.key));
  const toggleRowOpen = typeof onToggleRowOpen === "function"
    ? () => onToggleRowOpen(row.key)
    : null;
  switch (row.kind) {
    case "fold":
      return <FoldHeaderRowView onToggle={onToggleTurn} row={row} />;
    case "user":
      return <UserMessageRow message={row.message || {}} onFetchTruncated={onFetchTruncated} onUserMessageAction={onUserMessageAction} />;
    case "assistant":
      return <AssistantMessageRow live={live} message={row.message || {}} onFetchTruncated={onFetchTruncated} />;
    case "terminal-output":
      return <TerminalOutputRow message={row.message || {}} />;
    case "reasoning":
      return <ReasoningDisclosureRow message={row.message || {}} onFetchTruncated={onFetchTruncated} onToggleOpen={toggleRowOpen} open={rowOpen} />;
    case "tool":
      return <ToolCardRow message={row.message || {}} onFetchTruncated={onFetchTruncated} onToggleOpen={toggleRowOpen} open={rowOpen} />;
    case "file-change":
      return <FileChangeCardRow onToggleOpen={toggleRowOpen} open={rowOpen} row={row} />;
    case "subagent-group":
      return <SubagentGroupRow live={live} onFetchTruncated={onFetchTruncated} onToggleRowOpen={onToggleRowOpen} openRowKeys={openRowKeys} row={row} />;
    case "subagent-note":
      return <SubagentNoteRow message={row.message || {}} />;
    case "error":
      return <ErrorCardRow message={row.message || {}} />;
    case "divider": {
      const item = row.item || {};
      return (
        <DividerRow data-divider={transcriptToken(item.dividerKind || item.divider_kind) || "divider"}>
          <span title={item.timestamp ? formatAbsolute(item.timestamp) : undefined}>
            {item.label || "Timeline"}
          </span>
        </DividerRow>
      );
    }
    case "command": {
      const item = row.item || {};
      return <CommandItemRow command={item.command} note={item.note} source={item.source} />;
    }
    default:
      return null;
  }
});
