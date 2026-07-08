// Styled components for the rebuilt transcript. The visual language follows
// the dashboard's dark shell: C tokens, hairline borders, muted card fills,
// SF Mono details, 15.5px reading text. The transcript column never scrolls
// horizontally — wide content scrolls inside its own container.

import styled, { css, keyframes } from "styled-components";

export const C = {
  black: "#030508",
  ink: "#060910",
  inkRaised: "#0a0f17",
  panel: "#0d141f",
  panelRaised: "#111a26",
  panelBright: "#172232",
  line: "rgba(255,255,255,0.10)",
  lineStrong: "rgba(255,255,255,0.18)",
  lineBlue: "rgba(47,128,255,0.36)",
  lineOrange: "rgba(255,122,24,0.36)",
  white: "#f7f9ff",
  text: "#e8eef8",
  textDim: "#a7b2c2",
  textMuted: "#687386",
  blue: "#2f80ff",
  blueBright: "#62a0ff",
  blueSoft: "rgba(47,128,255,0.14)",
  orange: "#ff7a18",
  orangeBright: "#ff9a3d",
  orangeSoft: "rgba(255,122,24,0.14)",
  danger: "#ff6b6b",
  dangerSoft: "rgba(255,107,107,0.12)",
  warning: "#ffb347",
};

export const MONO = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';

/* ------------------------------------------------------------------ */
/* Column + virtualization scaffolding                                 */
/* ------------------------------------------------------------------ */

export const TranscriptColumn = styled.div`
  width: min(100%, var(--terminal-chat-column, 48rem));
  min-width: 0;
  flex: 0 0 auto;
  margin: 0 auto;
  padding: clamp(54px, 8vh, 88px) 0 34px;

  @media (max-width: 720px) {
    width: 100%;
    padding: 58px 0 26px;
  }
`;

export const TranscriptCanvas = styled.div`
  position: relative;
  width: 100%;
  min-width: 0;
`;

export const TranscriptRowShell = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  width: 100%;
  min-width: 0;
  padding-bottom: ${({ $spacing }) => ($spacing === "tight" ? "8px" : $spacing === "none" ? "0" : "18px")};
`;

export const TranscriptStaticList = styled.div`
  display: grid;
  min-width: 0;
  align-content: start;
`;

export const TranscriptEmpty = styled.div`
  display: grid;
  min-height: 260px;
  place-items: center;
  color: ${C.textMuted};
  font-size: 13px;
  font-weight: 760;
  text-align: center;
`;

const rowEnter = keyframes`
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
`;

export const RowEnter = styled.div`
  display: grid;
  min-width: 0;

  ${({ $animate }) => ($animate ? css`animation: ${rowEnter} 240ms cubic-bezier(0.2, 0, 0.2, 1) both;` : "")}

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

/* ------------------------------------------------------------------ */
/* Collapse (animated height for in-card expansion)                    */
/* ------------------------------------------------------------------ */

export const CollapseOuter = styled.div`
  min-width: 0;
  overflow: hidden;
  transition: height 200ms cubic-bezier(0.2, 0, 0.2, 1);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

/* ------------------------------------------------------------------ */
/* User + assistant rows                                               */
/* ------------------------------------------------------------------ */

// Hover-revealed row actions (copy buttons) sit inside a
// [data-transcript-actions] wrapper span; touch/narrow viewports keep them
// always visible.
const revealRowActions = css`
  [data-transcript-actions] {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-1px);
    transition:
      opacity 120ms ease,
      transform 120ms ease;
  }

  &:hover [data-transcript-actions],
  &:focus-within [data-transcript-actions] {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  @media (max-width: 860px), (hover: none) {
    [data-transcript-actions] {
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }
  }
`;

export const UserRow = styled.article`
  display: grid;
  min-width: 0;
  gap: 5px;
  justify-items: end;

  ${revealRowActions}
`;

export const UserBubble = styled.div`
  display: grid;
  width: fit-content;
  max-width: min(78%, 42rem);
  min-width: 0;
  gap: 7px;
  border-radius: 22px;
  padding: 11px 16px;
  color: ${C.text};
  background: rgba(255, 255, 255, 0.115);
  font-size: 15.5px;
  font-weight: 460;
  line-height: 1.66;
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  @media (max-width: 720px) {
    max-width: min(88%, 34rem);
  }
`;

export const AssistantRow = styled.article`
  display: grid;
  min-width: 0;
  gap: 6px;

  ${revealRowActions}
`;

export const RowMetaLine = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: ${({ $user }) => ($user ? "flex-end" : "flex-start")};
  gap: 7px;
  min-height: 20px;
  color: ${C.textDim};
  font-size: 11px;
  font-weight: 650;
`;

export const GhostActionButton = styled.button`
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: ${C.textMuted};
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  font-weight: 650;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    border-color: rgba(226, 232, 240, 0.16);
    color: ${C.white};
    background: rgba(255, 255, 255, 0.055);
  }

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.58);
    outline-offset: 2px;
  }
`;

export const StatusPill = styled.span`
  display: inline-flex;
  min-height: 18px;
  align-items: center;
  padding: 0 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: ${C.textMuted};
  background: rgba(255, 255, 255, 0.035);
  font-size: 9px;
  font-style: normal;
  line-height: 1;

  &[role="button"] {
    cursor: pointer;

    &:hover {
      border-color: rgba(226, 232, 240, 0.3);
      color: ${C.text};
    }

    &:focus-visible {
      outline: 2px solid rgba(125, 176, 255, 0.58);
      outline-offset: 2px;
    }
  }

  &[data-status="failed"],
  &[data-status="error"] {
    color: #fca5a5;
    border-color: rgba(248, 113, 113, 0.28);
    background: rgba(127, 29, 29, 0.16);
  }

  &[data-status="running"],
  &[data-status="pending"],
  &[data-status="sending"],
  &[data-status="submitted"],
  &[data-status="queued"] {
    color: #fde68a;
    border-color: rgba(251, 191, 36, 0.26);
    background: rgba(146, 64, 14, 0.16);
  }

  &[data-status="completed"],
  &[data-status="complete"],
  &[data-status="synced"] {
    color: #86efac;
    border-color: rgba(74, 222, 128, 0.24);
    background: rgba(22, 101, 52, 0.16);
  }
`;

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

export const MarkdownBody = styled.div`
  display: grid;
  min-width: 0;
  gap: 9px;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: ${C.text};
  font-size: 15.5px;
  font-weight: 430;
  line-height: 1.66;

  > :first-child {
    margin-top: 0;
  }

  p,
  ul,
  ol,
  pre,
  blockquote {
    min-width: 0;
    margin: 0;
  }

  strong {
    color: #f8fafc;
    font-weight: 620;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 4px 0 0;
    color: #f8fafc;
    font-size: 16px;
    font-weight: 650;
    line-height: 1.32;
  }

  h1 {
    font-size: 18px;
  }

  h2 {
    font-size: 17px;
  }

  ul,
  ol {
    display: grid;
    gap: 5px;
    padding-left: 20px;
  }

  li {
    padding-left: 2px;
  }

  li > p {
    margin: 0;
  }

  blockquote {
    border-left: 2px solid ${C.lineStrong};
    padding: 2px 0 2px 12px;
    color: ${C.textDim};
  }

  hr {
    height: 1px;
    margin: 6px 0;
    border: 0;
    background: ${C.line};
  }

  img {
    max-width: 100%;
    max-height: 320px;
    border-radius: 8px;
  }

  input[type="checkbox"] {
    margin-right: 6px;
  }
`;

export const InlineCode = styled.code`
  display: inline;
  padding: 1px 4px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 5px;
  color: #bfdbfe;
  background: rgba(15, 23, 42, 0.72);
  font-family: ${MONO};
  font-size: 0.92em;
  overflow-wrap: anywhere;
`;

export const PathChip = styled.span`
  display: inline;
  padding: 1px 4px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 5px;
  color: #bfdbfe;
  background: rgba(15, 23, 42, 0.72);
  font-family: ${MONO};
  font-size: 0.92em;
  overflow-wrap: anywhere;
`;

export const SafeLink = styled.a`
  color: #93c5fd;
  font-weight: 620;
  text-decoration: underline;
  text-decoration-color: rgba(147, 197, 253, 0.48);
  text-underline-offset: 2px;

  svg {
    width: 11px;
    height: 11px;
    margin-left: 2px;
    vertical-align: baseline;
    opacity: 0.7;
  }

  &:hover {
    color: #bfdbfe;
    text-decoration-color: rgba(191, 219, 254, 0.82);
  }

  &:focus-visible {
    border-radius: 4px;
    outline: 2px solid rgba(125, 176, 255, 0.58);
    outline-offset: 2px;
  }
`;

export const TableScroll = styled.div`
  max-width: 100%;
  min-width: 0;
  margin: 2px 0;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid ${C.line};
  border-radius: 8px;

  table {
    width: max-content;
    min-width: min(100%, 560px);
    border-collapse: collapse;
    color: #e5e7eb;
    background: rgba(2, 6, 12, 0.3);
    font-size: 12.5px;
    line-height: 1.4;
  }

  th,
  td {
    max-width: 22rem;
    padding: 7px 10px;
    border-bottom: 1px solid ${C.line};
    border-right: 1px solid ${C.line};
    vertical-align: top;
    text-align: left;
    overflow-wrap: break-word;
  }

  th:last-child,
  td:last-child {
    border-right: 0;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  th {
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.035);
    font-weight: 760;
    white-space: nowrap;
  }
`;

/* ------------------------------------------------------------------ */
/* Code blocks                                                         */
/* ------------------------------------------------------------------ */

export const CodeBlockFrame = styled.div`
  position: relative;
  display: grid;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  background: rgba(5, 9, 15, 0.78);
`;

export const CodeBlockHeader = styled.div`
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);

  > span {
    color: ${C.textDim};
    font-family: ${MONO};
    font-size: 10px;
    font-weight: 760;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
`;

export const CodeBlockScroll = styled.div`
  min-width: 0;
  max-height: 420px;
  overflow: auto;

  pre {
    margin: 0;
    padding: 10px 12px;
    background: transparent !important;
    font-family: ${MONO};
    font-size: 12px;
    line-height: 1.55;
    white-space: pre;
  }

  code {
    display: block;
    min-width: 0;
    background: transparent;
    font-family: ${MONO};
    font-size: 12px;
    line-height: 1.55;
    white-space: pre;
  }

  .shiki {
    background: transparent !important;
  }
`;

/* ------------------------------------------------------------------ */
/* Fold header                                                         */
/* ------------------------------------------------------------------ */

export const FoldHeaderRow = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  gap: 8px;
  -webkit-appearance: none;
  border: 0;
  border-radius: 8px;
  padding: 5px 8px 5px 6px;
  margin-left: -6px;
  appearance: none;
  background: transparent;
  color: ${C.textMuted};
  cursor: ${({ $interactive }) => ($interactive ? "pointer" : "default")};
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  text-align: left;

  em {
    flex: 0 0 auto;
    color: ${C.textMuted};
    font-size: 11px;
    font-style: normal;
    font-weight: 650;
  }

  ${({ $interactive }) => ($interactive ? css`
    &:hover {
      color: ${C.textDim};
      background: rgba(255, 255, 255, 0.03);
    }
  ` : "")}

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.45);
    outline-offset: 2px;
  }

  @media (max-width: 860px) {
    min-height: 30px;
    font-size: 11px;
  }
`;

export const FoldChevron = styled.span`
  display: grid;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  place-items: center;
  color: ${C.textMuted};

  svg {
    width: 15px;
    height: 15px;
    transform: rotate(${({ $open }) => ($open ? "0deg" : "-90deg")});
    transition: transform 140ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    svg {
      transition: none;
    }
  }
`;

export const FoldSummaryText = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const FoldErrorDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: ${C.danger};
`;

/* ------------------------------------------------------------------ */
/* Tool cards                                                          */
/* ------------------------------------------------------------------ */

const shimmer = keyframes`
  0% { background-position: -260px 0; }
  100% { background-position: 260px 0; }
`;

export const ToolCardFrame = styled.div`
  min-width: 0;
  border: 1px solid ${C.line};
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.018);

  &[data-open="true"] {
    background: rgba(255, 255, 255, 0.026);
  }

  &[data-status="running"] {
    background-image: linear-gradient(
      100deg,
      rgba(125, 176, 255, 0) 30%,
      rgba(125, 176, 255, 0.05) 50%,
      rgba(125, 176, 255, 0) 70%
    );
    background-size: 260px 100%;
    background-repeat: no-repeat;
    animation: ${shimmer} 1.9s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    &[data-status="running"] {
      animation: none;
    }
  }
`;

export const ToolCardHeader = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  -webkit-appearance: none;
  border: 0;
  border-radius: 10px;
  padding: 6px 10px;
  appearance: none;
  background: transparent;
  color: ${C.textMuted};
  cursor: ${({ $interactive }) => ($interactive ? "pointer" : "default")};
  font: inherit;
  text-align: left;

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.45);
    outline-offset: 2px;
  }

  ${({ $interactive }) => ($interactive ? css`
    &:hover strong {
      color: ${C.text};
    }
  ` : "")}
`;

export const ToolStatusDot = styled.span`
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: ${C.textMuted};

  &[data-status="running"] {
    background: ${C.warning};
    box-shadow: 0 0 0 3px rgba(255, 179, 71, 0.14);
  }

  &[data-status="completed"] {
    background: #4ade80;
  }

  &[data-status="failed"] {
    background: ${C.danger};
    box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.12);
  }
`;

export const ToolCardName = styled.strong`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: ${C.textDim};
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ToolCardSummary = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: ${C.textMuted};
  font-family: ${MONO};
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ToolCardChip = styled.em`
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid ${C.line};
  border-radius: 999px;
  color: ${C.textMuted};
  font-size: 9.5px;
  font-style: normal;
  font-weight: 700;

  &[data-tone="bad"] {
    color: #fca5a5;
    border-color: rgba(248, 113, 113, 0.28);
  }
`;

export const ToolCardBody = styled.div`
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 2px 10px 10px;
`;

export const ToolPane = styled.section`
  position: relative;
  display: grid;
  min-width: 0;
  gap: 0;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(5, 9, 15, 0.55);
`;

export const ToolPaneHeader = styled.header`
  display: flex;
  min-height: 26px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 0 10px;

  > span {
    color: ${C.textMuted};
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;

export const ToolPaneScroll = styled.div`
  min-width: 0;
  max-height: 300px;
  overflow: auto;

  pre {
    margin: 0;
    padding: 4px 10px 10px;
    color: #cbd5e1;
    font-family: ${MONO};
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre;
  }
`;

/* ------------------------------------------------------------------ */
/* Reasoning                                                           */
/* ------------------------------------------------------------------ */

export const ReasoningRowFrame = styled.div`
  min-width: 0;
`;

export const ReasoningToggle = styled.button`
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 7px;
  -webkit-appearance: none;
  border: 0;
  border-radius: 8px;
  padding: 3px 8px 3px 6px;
  margin-left: -6px;
  appearance: none;
  background: transparent;
  color: ${C.textMuted};
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  font-style: italic;

  &:hover {
    color: ${C.textDim};
    background: rgba(255, 255, 255, 0.03);
  }

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.45);
    outline-offset: 2px;
  }
`;

export const ReasoningBody = styled.pre`
  margin: 4px 0 0;
  max-height: 340px;
  min-width: 0;
  overflow: auto;
  border-left: 2px solid ${C.line};
  padding: 2px 0 2px 14px;
  color: ${C.textMuted};
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.58;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

/* ------------------------------------------------------------------ */
/* File-change card                                                    */
/* ------------------------------------------------------------------ */

export const FileChangeFrame = styled.section`
  display: grid;
  min-width: 0;
  gap: 0;
  border: 1px solid rgba(60, 203, 127, 0.18);
  border-radius: 10px;
  background: rgba(60, 203, 127, 0.045);
`;

export const FileChangeHeader = styled.div`
  display: flex;
  min-width: 0;
  min-height: 36px;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;

  strong {
    color: ${C.text};
    font-size: 12px;
    font-weight: 760;
  }

  b[data-tone="add"] {
    color: #7ee2a8;
    font-size: 11px;
    font-weight: 800;
  }

  b[data-tone="delete"] {
    color: #fca5a5;
    font-size: 11px;
    font-weight: 800;
  }

  i {
    min-width: 0;
    overflow: hidden;
    color: ${C.textMuted};
    font-size: 11px;
    font-style: normal;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

// Right-aligned action cluster in the file-change header (expand all /
// collapse all).
export const FileChangeHeaderActions = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  margin-left: auto;
`;

export const FileChangeList = styled.div`
  display: grid;
  min-width: 0;
  gap: 0;
  border-top: 1px solid rgba(60, 203, 127, 0.12);
  padding: 4px 0;
`;

export const FileChangeRowLine = styled.div`
  display: flex;
  min-width: 0;
  min-height: 26px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  color: ${C.textDim};
  font-family: ${MONO};
  font-size: 11px;

  > span {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: ltr;
  }

  > i {
    flex: 0 0 auto;
    color: ${C.textMuted};
    font-size: 9.5px;
    font-style: normal;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  > em {
    flex: 0 0 auto;
    font-style: normal;
    font-weight: 760;

    b[data-tone="add"] {
      color: #7ee2a8;
      font-weight: 760;
    }

    b[data-tone="delete"] {
      color: #fca5a5;
      font-weight: 760;
    }
  }
`;

// Expandable per-file row: the same layout as FileChangeRowLine, rendered
// as a full-width button when the file carries a reviewable patch.
export const FileDiffRowButton = styled(FileChangeRowLine).attrs({ as: "button" })`
  width: 100%;
  -webkit-appearance: none;
  border: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-family: ${MONO};
  font-size: 11px;
  text-align: left;

  ${FoldChevron} {
    flex: 0 0 auto;
    overflow: visible;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.03);
    color: ${C.text};
  }

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.45);
    outline-offset: -2px;
  }
`;

/* ------------------------------------------------------------------ */
/* Diff hunks (reviewable per-file patches)                            */
/* ------------------------------------------------------------------ */

export const DiffHunksWrap = styled.div`
  display: grid;
  min-width: 0;
  gap: 8px;
  margin: 2px 10px 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  padding: 8px;
  background: rgba(5, 9, 15, 0.78);
`;

export const DiffHunkBlock = styled.div`
  display: grid;
  min-width: 0;
  gap: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 6px;
`;

export const DiffHunkHeader = styled.div`
  display: flex;
  min-height: 24px;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  color: ${C.textMuted};
  background: rgba(255, 255, 255, 0.035);
  font-family: ${MONO};
  font-size: 10px;
  font-weight: 700;

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const DiffHunkScroll = styled.div`
  min-width: 0;
  max-height: 420px;
  overflow: auto;
`;

export const DiffLineList = styled.div`
  display: grid;
  width: max-content;
  min-width: 100%;
  font-family: ${MONO};
  font-size: 11.5px;
  line-height: 1.55;
`;

export const DiffLineRow = styled.div`
  display: flex;
  min-width: 0;
  align-items: stretch;

  &[data-type="add"] {
    background: rgba(46, 160, 67, 0.16);
  }

  &[data-type="del"] {
    background: rgba(248, 81, 73, 0.14);
  }

  > i {
    display: inline-block;
    flex: 0 0 auto;
    width: 4ch;
    padding: 0 6px 0 4px;
    color: ${C.textMuted};
    font-style: normal;
    font-variant-numeric: tabular-nums;
    text-align: right;
    user-select: none;
  }

  &[data-type="add"] > i {
    background: rgba(46, 160, 67, 0.28);
  }

  &[data-type="del"] > i {
    background: rgba(248, 81, 73, 0.26);
  }

  > b {
    flex: 0 0 auto;
    width: 1.4ch;
    padding-left: 4px;
    font-weight: 760;
    user-select: none;
  }

  &[data-type="add"] > b {
    color: #7ee2a8;
  }

  &[data-type="del"] > b {
    color: #fca5a5;
  }

  > code {
    flex: 1 0 auto;
    padding-right: 12px;
    color: #cbd5e1;
    background: transparent;
    font-family: ${MONO};
    white-space: pre;
  }

  > em[data-no-newline] {
    flex: 0 0 auto;
    align-self: center;
    padding: 0 6px;
    color: ${C.textMuted};
    font-size: 9.5px;
    font-style: normal;
    user-select: none;
  }
`;

// Honest truncation notes ("patch truncated at source — counts preserved")
// and binary labels inside the file card.
export const DiffNote = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 6px;
  color: ${C.textMuted};
  font-size: 10.5px;
  font-style: italic;
  font-weight: 550;
`;

/* ------------------------------------------------------------------ */
/* Subagent group                                                      */
/* ------------------------------------------------------------------ */

export const SubagentFrame = styled.section`
  display: grid;
  min-width: 0;
  gap: 0;
  border: 1px solid ${C.lineBlue};
  border-radius: 10px;
  padding: 4px 6px;
  background: rgba(47, 128, 255, 0.045);
`;

export const SubagentHeaderButton = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  -webkit-appearance: none;
  border: 0;
  border-radius: 7px;
  padding: 3px 6px;
  appearance: none;
  background: transparent;
  color: ${C.blueBright};
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;

  svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    flex: 0 0 auto;
    color: ${C.textMuted};
    font-size: 10px;
    font-style: normal;
    font-weight: 650;
    letter-spacing: 0.02em;
    text-transform: none;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.45);
    outline-offset: 2px;
  }
`;

export const SubagentStatusDot = styled.span`
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: ${C.textMuted};

  &[data-status="running"] {
    background: ${C.warning};
    box-shadow: 0 0 0 3px rgba(255, 179, 71, 0.14);
  }

  &[data-status="completed"] {
    background: #4ade80;
  }

  &[data-status="failed"] {
    background: ${C.danger};
    box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.12);
  }
`;

export const SubagentOpenSessionChip = styled.button`
  display: inline-flex;
  flex: 0 0 auto;
  min-height: 20px;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid ${C.lineBlue};
  border-radius: 999px;
  color: #93c5fd;
  background: ${C.blueSoft};
  cursor: pointer;
  font: inherit;
  font-size: 9.5px;
  font-weight: 750;
  letter-spacing: 0.02em;
  text-transform: none;
  white-space: nowrap;

  svg {
    width: 11px;
    height: 11px;
  }

  &:hover {
    color: #bfdbfe;
    border-color: #93c5fd;
  }

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.58);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;

    &:hover {
      color: #93c5fd;
      border-color: ${C.lineBlue};
    }
  }
`;

export const SubagentChildren = styled.div`
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 4px 4px 6px;
`;

/* ------------------------------------------------------------------ */
/* Error card                                                          */
/* ------------------------------------------------------------------ */

export const ErrorCardFrame = styled.section`
  display: grid;
  min-width: 0;
  gap: 6px;
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: 10px;
  padding: 10px 12px;
  background: ${C.dangerSoft};

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #fca5a5;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  pre {
    margin: 0;
    max-height: 260px;
    overflow: auto;
    color: ${C.text};
    font-family: ${MONO};
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
`;

/* ------------------------------------------------------------------ */
/* Divider + working rows                                              */
/* ------------------------------------------------------------------ */

export const DividerRow = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  color: ${C.textMuted};
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.1em;
  text-transform: uppercase;

  &::before,
  &::after {
    content: "";
    flex: 1;
    height: 1px;
    background: ${C.line};
  }

  span {
    max-width: 72%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-divider="model"] {
    color: ${C.blueBright};

    &::before,
    &::after {
      background: ${C.lineBlue};
    }
  }

  &[data-divider="effort"] {
    color: #68d391;

    &::before,
    &::after {
      background: rgba(104, 211, 145, 0.34);
    }
  }
`;

const workingPulse = keyframes`
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
`;

export const WorkingRowFrame = styled.div`
  display: flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  gap: 10px;
  color: ${C.textDim};
  font-size: 12.5px;
  font-weight: 650;

  em {
    color: ${C.textMuted};
    font-family: ${MONO};
    font-size: 11px;
    font-style: normal;
    font-variant-numeric: tabular-nums;
  }
`;

export const WorkingDots = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;

  i {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: ${C.blueBright};
    animation: ${workingPulse} 1.2s ease-in-out infinite;
  }

  i:nth-child(2) {
    animation-delay: 0.15s;
  }

  i:nth-child(3) {
    animation-delay: 0.3s;
  }

  @media (prefers-reduced-motion: reduce) {
    i {
      animation: none;
      opacity: 0.8;
    }
  }
`;

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

export const ArtifactList = styled.div`
  display: grid;
  min-width: 0;
  gap: 8px;
`;

export const ArtifactChip = styled.div`
  display: grid;
  min-width: 0;
  gap: 4px;
  border: 1px solid ${C.line};
  border-radius: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.035);

  strong {
    color: ${C.text};
    font-size: 12px;
    font-weight: 760;
  }

  span {
    overflow: hidden;
    color: ${C.textMuted};
    font-family: ${MONO};
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const ArtifactImageLink = styled.a`
  display: block;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid ${C.line};
  border-radius: 10px;
  background: rgba(5, 9, 15, 0.55);

  img {
    display: block;
    max-width: 100%;
    max-height: 240px;
  }

  &:focus-visible {
    outline: 2px solid rgba(125, 176, 255, 0.58);
    outline-offset: 2px;
  }
`;

/* ------------------------------------------------------------------ */
/* Bottom sheet (mobile card expansion)                                */
/* ------------------------------------------------------------------ */

const sheetIn = keyframes`
  from { transform: translateY(24px); opacity: 0.4; }
  to { transform: translateY(0); opacity: 1; }
`;

export const SheetScrim = styled.div`
  position: fixed;
  z-index: 90;
  inset: 0;
  background: rgba(3, 5, 8, 0.62);
  backdrop-filter: blur(2px);
`;

export const SheetPanel = styled.div`
  position: fixed;
  z-index: 91;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  max-height: min(78vh, 640px);
  grid-template-rows: auto auto 1fr;
  border: 1px solid ${C.lineStrong};
  border-bottom: 0;
  border-radius: 16px 16px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: ${C.panel};
  box-shadow: 0 -18px 48px rgba(0, 0, 0, 0.5);
  animation: ${sheetIn} 200ms cubic-bezier(0.2, 0, 0.2, 1);
  touch-action: none;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const SheetHandle = styled.div`
  display: grid;
  min-height: 22px;
  place-items: center;
  cursor: grab;

  &::before {
    content: "";
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: ${C.lineStrong};
  }
`;

export const SheetTitle = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  padding: 2px 16px 10px;
  border-bottom: 1px solid ${C.line};

  strong {
    min-width: 0;
    overflow: hidden;
    color: ${C.text};
    font-size: 13px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const SheetBody = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 10px;
  padding: 12px 16px 18px;
  overflow-y: auto;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
`;

/* ------------------------------------------------------------------ */
/* Command + misc rows                                                 */
/* ------------------------------------------------------------------ */

export const UsageChip = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid ${C.line};
  border-radius: 999px;
  color: ${C.textDim};
  background: rgba(8, 12, 19, 0.78);
  backdrop-filter: blur(12px);
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.02em;
  white-space: nowrap;

  b {
    color: ${C.text};
    font-variant-numeric: tabular-nums;
    font-weight: 800;
  }
`;
