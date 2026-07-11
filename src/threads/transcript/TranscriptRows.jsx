// Row components for the rebuilt transcript: user message, assistant
// markdown, reasoning disclosure, tool card, file-change card, subagent
// group, error card, turn fold header, dividers, command rows, and the
// active "working" row.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CallMade as OpenSessionIcon } from "@styled-icons/material-rounded/CallMade";
import { Edit as EditIcon } from "@styled-icons/material-rounded/Edit";
import { KeyboardArrowDown as ChevronIcon } from "@styled-icons/material-rounded/KeyboardArrowDown";
import { PlayArrow as ContinueIcon } from "@styled-icons/material-rounded/PlayArrow";
import { SmartToy as SubagentIcon } from "@styled-icons/material-rounded/SmartToy";
import { Send as RetryIcon } from "@styled-icons/material-rounded/Send";
import { UnfoldLess as CollapseAllIcon } from "@styled-icons/material-rounded/UnfoldLess";
import { UnfoldMore as ExpandAllIcon } from "@styled-icons/material-rounded/UnfoldMore";

import { AnsiText, CommandItemRow } from "./TerminalChatKit";
import {
  artifactImageUrl,
  codeLanguageToken,
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
  subagentGroupStats,
  toolDurationMs,
  toolExitCode,
  toolInputSummary,
  toolName,
  toolStatusToken,
  transcriptArray,
  transcriptText,
  transcriptTimestampMs,
  transcriptToken,
  turnDiffSyntheticMessage,
  usageTooltip,
} from "./builders.mjs";
import {
  hunkHeaderLabel,
  hunkLinesText,
  languageFromPath,
  parseUnifiedPatch,
} from "./diffHunks.mjs";
import { cachedHighlightLines, highlightCodeLines } from "./shikiHighlight";
import { BottomSheet, useIsMobileViewport } from "./BottomSheet";
import { CopyButton, ShikiLineCode, TranscriptMarkdown } from "./MarkdownContent";
import {
  ArtifactChip,
  ArtifactImageLink,
  ArtifactList,
  AssistantRow,
  CollapseOuter,
  DiffHunkBlock,
  DiffHunkHeader,
  DiffHunkScroll,
  DiffHunksWrap,
  DiffLineList,
  DiffLineRow,
  DiffNote,
  DividerRow,
  ErrorCardFrame,
  FileChangeFrame,
  FileChangeHeader,
  FileChangeHeaderActions,
  FileChangeList,
  FileChangeRowLine,
  FileDiffRowButton,
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
  SubagentHeaderButton,
  SubagentOpenSessionChip,
  SubagentStatusDot,
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

// Matches the header elapsed formatter (dashboard formatTerminalChatElapsedMs):
// m:ss below an hour, h:mm:ss from 60 minutes on.
function formatElapsedClock(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
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
  const recordId = transcriptText(message.record_id);
  const seqSource = message.record_seq;
  const recordSeq = seqSource == null ? null : Number(seqSource);
  return {
    record_id: recordId,
    record_seq: Number.isFinite(recordSeq) && recordSeq > 0 ? recordSeq : null,
  };
}

export function TruncatedChip({ message = {}, onFetchTruncated }) {
  const [fetching, setFetching] = useState(false);
  const { record_id: recordId, record_seq: recordSeq } = messageRecordRef(message);
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
        const key = artifact.asset_id || artifact.url || artifact.path || index;
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
            <span>{artifact.path || artifact.asset_path || artifact.url || ""}</span>
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
  const timestamp = message.timestamp || message.created_at;
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
            <AnsiText max_chars={60000} text={content} />
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
            <AnsiText max_chars={60000} text={text} />
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
/* File-change card + reviewable diff hunks (turn_diff)                */
/* ------------------------------------------------------------------ */

const FILE_CHANGE_PREVIEW_COUNT = 8;
const PATCH_TRUNCATED_NOTE = "patch truncated at source — counts preserved";
const RECORD_TRUNCATED_NOTE = "diff truncated at source — largest patches omitted, counts preserved";

function fileChangeRowFiles(row = {}) {
  if (row.turnDiff?.files?.length) {
    return {
      files: transcriptArray(row.turnDiff.files),
      additions: Math.max(0, Number(row.turnDiff.total_additions) || 0),
      deletions: Math.max(0, Number(row.turnDiff.total_deletions) || 0),
      summary: transcriptText(row.summary || row.message?.title),
      recordTruncated: Boolean(row.turnDiff.truncated),
      files_omitted: Math.max(0, Number(row.turnDiff.files_omitted) || 0),
    };
  }
  if (row.synthetic) {
    return {
      files: transcriptArray(row.files),
      additions: row.additions || 0,
      deletions: row.deletions || 0,
      summary: row.summary || "",
      recordTruncated: false,
      files_omitted: 0,
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
    recordTruncated: false,
    files_omitted: 0,
  };
}

// One hunk: per-line syntax highlighting via the shared shiki pipeline
// (language from the file extension), with +/− row tints and line numbers
// from the @@ headers.
function DiffHunkView({ hunk, language = "" }) {
  const text = useMemo(() => hunkLinesText(hunk), [hunk]);
  // htmlLines: string[] = highlighted, null = not attempted, false = plain.
  const [state, setState] = useState(() => ({
    text,
    language,
    htmlLines: language ? cachedHighlightLines(text, language) : false,
  }));
  if (state.text !== text || state.language !== language) {
    setState({
      text,
      language,
      htmlLines: language ? cachedHighlightLines(text, language) : false,
    });
  }
  const pending = state.htmlLines === null;
  useEffect(() => {
    if (!pending) return undefined;
    let cancelled = false;
    void highlightCodeLines(text, language).then((result) => {
      if (cancelled) return;
      setState((current) => (
        current.text === text && current.language === language
          ? { ...current, htmlLines: result ?? false }
          : current
      ));
    });
    return () => {
      cancelled = true;
    };
  }, [language, pending, text]);
  const htmlLines = Array.isArray(state.htmlLines) ? state.htmlLines : null;
  const lines = transcriptArray(hunk.lines);
  return (
    <DiffHunkBlock>
      <DiffHunkHeader>
        <span>{hunkHeaderLabel(hunk)}</span>
      </DiffHunkHeader>
      <DiffHunkScroll>
        <DiffLineList>
          {lines.map((line, index) => (
            <DiffLineRow data-type={line.type} key={index}>
              <i>{line.oldLine ?? ""}</i>
              <i>{line.newLine ?? ""}</i>
              <b>{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</b>
              {htmlLines?.[index] ? (
                <ShikiLineCode html={htmlLines[index]} />
              ) : (
                <code>{line.text || " "}</code>
              )}
              {line.noNewline ? (
                <em data-no-newline title="No newline at end of file">no ⏎</em>
              ) : null}
            </DiffLineRow>
          ))}
        </DiffLineList>
      </DiffHunkScroll>
    </DiffHunkBlock>
  );
}

export function DiffFileHunks({ file = {} }) {
  const parsed = useMemo(() => parseUnifiedPatch(file.patch || ""), [file.patch]);
  const language = useMemo(
    () => codeLanguageToken(languageFromPath(file.path || file.old_path || "")),
    [file.old_path, file.path],
  );
  return (
    <>
      {file.patch_truncated ? <DiffNote>{PATCH_TRUNCATED_NOTE}</DiffNote> : null}
      <DiffHunksWrap>
        <ToolPaneHeader as="div">
          <span>{language || "patch"}</span>
          <CopyButton label="Copy patch" text={file.patch || ""} />
        </ToolPaneHeader>
        {parsed.hunks.map((hunk, index) => (
          <DiffHunkView hunk={hunk} key={`${hunk.oldStart}:${hunk.newStart}:${index}`} language={language} />
        ))}
        {!parsed.hunks.length ? (
          <DiffNote style={{ padding: "0 2px 2px" }}>
            {parsed.binary ? "binary file — no textual diff" : "no textual hunks in this patch"}
          </DiffNote>
        ) : null}
      </DiffHunksWrap>
    </>
  );
}

function fileDisplayPath(file = {}) {
  if (file.kind === "rename" && file.old_path && file.old_path !== file.path) {
    return `${file.old_path} → ${file.path}`;
  }
  return file.path || "";
}

function FileChangeLine({ file = {}, expandable = false, expanded = false, onToggle = null }) {
  const additions = Number.isFinite(file.additions) ? file.additions : null;
  const deletions = Number.isFinite(file.deletions) ? file.deletions : null;
  const displayPath = fileDisplayPath(file);
  const Frame = expandable ? FileDiffRowButton : FileChangeRowLine;
  return (
    <Frame
      aria-expanded={expandable ? expanded : undefined}
      onClick={expandable ? onToggle : undefined}
      type={expandable ? "button" : undefined}
    >
      {expandable ? (
        <FoldChevron $open={expanded} aria-hidden="true">
          <ChevronIcon />
        </FoldChevron>
      ) : null}
      <span title={displayPath}>{middleEllipsis(displayPath, 64)}</span>
      {file.kind && file.kind !== "edit" ? <i>{file.kind}</i> : null}
      {file.binary ? <i>binary</i> : null}
      <em>
        {additions !== null ? <b data-tone="add">+{additions}</b> : null}
        {additions !== null && deletions !== null ? " " : null}
        {deletions !== null ? <b data-tone="delete">−{deletions}</b> : null}
      </em>
    </Frame>
  );
}

export function FileChangeCardRow({
  row = {},
  open: openProp = false,
  onToggleOpen = null,
  openRowKeys = null,
  onToggleRowOpen = null,
  onSetRowsOpen = null,
  onFetchTruncated = null,
}) {
  const [showAll, toggleShowAll] = useRowDisclosure(openProp, onToggleOpen);
  // Per-file hunk expansion is hoisted (openRowKeys) when the host wires it;
  // standalone usage falls back to a local set.
  const [localOpenKeys, setLocalOpenKeys] = useState(() => new Set());
  const isMobile = useIsMobileViewport();
  const {
    files, additions, deletions, summary, recordTruncated, files_omitted: filesOmitted,
  } = fileChangeRowFiles(row);
  // A truncated turn_diff card whose message carries the durable record refs
  // gets the standard fetchable TruncatedChip. When the diff rides an
  // existing file-change row, the turn_diff's own record identity wins over
  // the unrelated file-change message.
  const cardMessage = (row.turnDiff ? turnDiffSyntheticMessage(row.turnDiff) : null)
    || row.message
    || null;
  const cardRecordRef = messageRecordRef(cardMessage || {});
  const truncatedFetchable = Boolean(
    cardMessage
      && messageTruncated(cardMessage)
      && (cardRecordRef.record_id || cardRecordRef.record_seq),
  );
  if (!files.length) return null;

  const hoisted = typeof onToggleRowOpen === "function" && openRowKeys instanceof Set;
  const fileKey = (index) => `${row.key}:file:${index}`;
  const isFileOpen = (index) => (hoisted ? openRowKeys.has(fileKey(index)) : localOpenKeys.has(fileKey(index)));
  const toggleFile = (index) => {
    if (hoisted) {
      onToggleRowOpen(fileKey(index));
      return;
    }
    setLocalOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(fileKey(index))) {
        next.delete(fileKey(index));
      } else {
        next.add(fileKey(index));
      }
      return next;
    });
  };
  const reviewableIndexes = files
    .map((file, index) => (file.patch && !file.binary ? index : -1))
    .filter((index) => index >= 0);
  const anyReviewable = reviewableIndexes.length > 0;
  const anyOpen = reviewableIndexes.some((index) => isFileOpen(index));
  const setAllFiles = (openValue) => {
    const keys = reviewableIndexes.map(fileKey);
    if (hoisted && typeof onSetRowsOpen === "function") {
      onSetRowsOpen(keys, openValue);
      return;
    }
    if (hoisted) {
      // Toggle-only host: flip just the keys that differ.
      reviewableIndexes.forEach((index) => {
        if (isFileOpen(index) !== openValue) onToggleRowOpen(fileKey(index));
      });
      return;
    }
    setLocalOpenKeys(openValue ? new Set(keys) : new Set());
  };

  const preview = files.slice(0, FILE_CHANGE_PREVIEW_COUNT);
  const hidden = files.length - preview.length;
  const renderFile = (file, index, { sheetMode = false } = {}) => {
    const expandable = Boolean(file.patch && !file.binary);
    const expanded = expandable && isFileOpen(index);
    return (
      <div key={`${file.path || "file"}-${index}`} style={{ display: "grid", minWidth: 0 }}>
        <FileChangeLine
          expandable={expandable}
          expanded={expanded && (!isMobile || sheetMode)}
          file={file}
          onToggle={expandable ? () => toggleFile(index) : null}
        />
        {expandable && !isMobile ? (
          <Collapse open={expanded}>
            <DiffFileHunks file={file} />
          </Collapse>
        ) : null}
        {expandable && sheetMode && expanded ? <DiffFileHunks file={file} /> : null}
        {expandable && isMobile && !sheetMode && expanded ? (
          <BottomSheet
            onClose={() => toggleFile(index)}
            title={(
              <strong title={fileDisplayPath(file)}>
                {middleEllipsis(fileDisplayPath(file), 44)}
              </strong>
            )}
          >
            <DiffFileHunks file={file} />
          </BottomSheet>
        ) : null}
        {file.patch_truncated && !expandable ? <DiffNote>{PATCH_TRUNCATED_NOTE}</DiffNote> : null}
      </div>
    );
  };

  const header = (
    <FileChangeHeader>
      <strong>{files.length} file{files.length === 1 ? "" : "s"} changed</strong>
      <b data-tone="add">+{additions}</b>
      <b data-tone="delete">−{deletions}</b>
      {summary ? <i title={summary}>{summary}</i> : null}
      {anyReviewable && !isMobile ? (
        <FileChangeHeaderActions data-transcript-diff-actions>
          {anyOpen ? (
            <GhostActionButton
              aria-label="Collapse all diffs"
              onClick={() => setAllFiles(false)}
              title="Collapse all diffs"
              type="button"
            >
              <CollapseAllIcon aria-hidden="true" />
              Collapse all
            </GhostActionButton>
          ) : (
            <GhostActionButton
              aria-label="Expand all diffs"
              onClick={() => setAllFiles(true)}
              title="Expand all diffs"
              type="button"
            >
              <ExpandAllIcon aria-hidden="true" />
              Expand all
            </GhostActionButton>
          )}
        </FileChangeHeaderActions>
      ) : null}
    </FileChangeHeader>
  );

  return (
    <FileChangeFrame data-message-role="file-change">
      {header}
      {recordTruncated ? (
        <DiffNote>
          {RECORD_TRUNCATED_NOTE}
          {truncatedFetchable ? (
            <TruncatedChip message={cardMessage} onFetchTruncated={onFetchTruncated} />
          ) : null}
        </DiffNote>
      ) : null}
      {filesOmitted > 0 ? (
        <DiffNote>{filesOmitted} more file{filesOmitted === 1 ? "" : "s"} not shown</DiffNote>
      ) : null}
      <FileChangeList>
        {preview.map((file, index) => renderFile(file, index))}
        {hidden > 0 && !isMobile ? (
          <Collapse open={showAll}>
            {files.slice(FILE_CHANGE_PREVIEW_COUNT).map((file, index) => (
              renderFile(file, FILE_CHANGE_PREVIEW_COUNT + index)
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
          {files.map((file, index) => renderFile(file, index, { sheetMode: true }))}
        </BottomSheet>
      ) : null}
    </FileChangeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Subagent group                                                      */
/* ------------------------------------------------------------------ */

function subagentCountsLabel(stats = {}) {
  const parts = [];
  parts.push(`${stats.messages || 0} message${stats.messages === 1 ? "" : "s"}`);
  if (stats.toolCalls > 0) {
    parts.push(`${stats.toolCalls} tool call${stats.toolCalls === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

// Collapsible subagent group (same interaction pattern as turn folds):
// expanded while the turn is active, collapsed by default once settled.
// A hoisted openRowKeys entry flips the state relative to that default so
// virtualization unmounts never lose it; the toggle clears whenever the
// default transitions (live → settled) so a collapse made during streaming
// stays collapsed after settle. Nested groups (parent_id chains) render
// recursively through TranscriptRowBody.
export function SubagentGroupRow({
  row = {},
  live = false,
  openRowKeys = null,
  onToggleRowOpen = null,
  onFetchTruncated,
  onOpenSession = null,
  onUserMessageAction = null,
}) {
  const status = toolStatusToken(row.status);
  const stats = useMemo(() => subagentGroupStats(row), [row]);
  const defaultOpen = Boolean(live);
  const toggled = Boolean(openRowKeys?.has?.(row.key));
  const [localToggled, setLocalToggled] = useState(false);
  const hoisted = typeof onToggleRowOpen === "function";
  // The stored toggle is relative to defaultOpen, so the live→settled
  // default flip would invert a collapse made during streaming into a
  // spurious re-open. Clear the toggle when the default transitions (and
  // ignore it for the in-between renders) so the group lands on the new
  // default in its last visible state.
  const prevDefaultOpenRef = useRef(defaultOpen);
  const defaultTransitioned = prevDefaultOpenRef.current !== defaultOpen;
  useEffect(() => {
    if (!defaultTransitioned) return;
    prevDefaultOpenRef.current = defaultOpen;
    if (hoisted) {
      if (toggled) onToggleRowOpen(row.key);
    } else if (localToggled) {
      setLocalToggled(false);
    }
  }, [defaultOpen, defaultTransitioned, hoisted, localToggled, onToggleRowOpen, row.key, toggled]);
  const open = ((hoisted ? toggled : localToggled) && !defaultTransitioned)
    ? !defaultOpen
    : defaultOpen;
  const toggleOpen = () => {
    if (hoisted) {
      onToggleRowOpen(row.key);
    } else {
      setLocalToggled((value) => !value);
    }
  };
  const durationLabel = formatDurationMs(stats.duration_ms);
  const sessionRef = row.session_ref || null;
  const openSession = sessionRef && typeof onOpenSession === "function"
    ? (event) => {
      event.stopPropagation();
      onOpenSession(sessionRef);
    }
    : null;
  return (
    <SubagentFrame data-message-role="subagent">
      <div style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 6 }}>
        <SubagentHeaderButton
          aria-expanded={open}
          onClick={toggleOpen}
          type="button"
        >
          <FoldChevron $open={open} aria-hidden="true">
            <ChevronIcon />
          </FoldChevron>
          <SubagentIcon aria-hidden="true" />
          <SubagentStatusDot aria-hidden="true" data-status={status} />
          <span>Subagent · {row.title || "Task"}</span>
          <em>{subagentCountsLabel(stats)}</em>
          {durationLabel ? <em>{durationLabel}</em> : null}
          {row.status ? <StatusPill data-status={status}>{row.status}</StatusPill> : null}
        </SubagentHeaderButton>
        {sessionRef ? (
          <SubagentOpenSessionChip
            aria-label={openSession ? "Open the subagent's session" : "Session outside this view"}
            disabled={!openSession}
            onClick={openSession || undefined}
            title={openSession
              ? (sessionRef.agent_chat_session_id || sessionRef.provider_session_id)
              : "session outside this view"}
            type="button"
          >
            Open session
            <OpenSessionIcon aria-hidden="true" />
          </SubagentOpenSessionChip>
        ) : null}
      </div>
      <Collapse open={open}>
        <SubagentChildren>
          {transcriptArray(row.childRows).map((child) => (
            <TranscriptRowBody
              key={child.key}
              live={live}
              onFetchTruncated={onFetchTruncated}
              onOpenSession={onOpenSession}
              onToggleRowOpen={onToggleRowOpen}
              onUserMessageAction={onUserMessageAction}
              openRowKeys={openRowKeys}
              row={child}
            />
          ))}
        </SubagentChildren>
      </Collapse>
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
      {Number.isFinite(summary?.usage?.cost_usd) ? (
        <em>${summary.usage.cost_usd.toFixed(2)}</em>
      ) : null}
    </FoldHeaderRow>
  );
}

/* ------------------------------------------------------------------ */
/* Working row                                                         */
/* ------------------------------------------------------------------ */

export function WorkingRow({ label = "Working", started_at_ms: startedAtMs = 0 }) {
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

export const TranscriptRowBody = memo(function TranscriptRowBody({ row = {}, live = false, onToggleTurn, openRowKeys = null, onToggleRowOpen = null, onSetRowsOpen = null, onFetchTruncated, onUserMessageAction = null, onOpenSession = null }) {
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
      return (
        <FileChangeCardRow
          onFetchTruncated={onFetchTruncated}
          onSetRowsOpen={onSetRowsOpen}
          onToggleOpen={toggleRowOpen}
          onToggleRowOpen={onToggleRowOpen}
          open={rowOpen}
          openRowKeys={openRowKeys}
          row={row}
        />
      );
    case "subagent-group":
      return <SubagentGroupRow live={live} onFetchTruncated={onFetchTruncated} onOpenSession={onOpenSession} onToggleRowOpen={onToggleRowOpen} onUserMessageAction={onUserMessageAction} openRowKeys={openRowKeys} row={row} />;
    case "subagent-note":
      return <SubagentNoteRow message={row.message || {}} />;
    case "error":
      return <ErrorCardRow message={row.message || {}} />;
    case "divider": {
      const item = row.item || {};
      return (
        <DividerRow data-divider={transcriptToken(item.divider_kind) || "divider"}>
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
