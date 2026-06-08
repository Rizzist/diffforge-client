import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Add } from "@styled-icons/material-rounded/Add";
import { ArrowUpward } from "@styled-icons/material-rounded/ArrowUpward";
import { Check } from "@styled-icons/material-rounded/Check";
import { Close } from "@styled-icons/material-rounded/Close";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { Edit } from "@styled-icons/material-rounded/Edit";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Terminal } from "@styled-icons/material-rounded/Terminal";
import { Undo } from "@styled-icons/material-rounded/Undo";
import { Children, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled, { keyframes } from "styled-components";

import { getAgentModelImageInputCapability } from "../agents/imageInputCapabilities";
import {
  appendWorkspaceThreadComposerAttachments,
  clearActiveWorkspaceFileDrag,
  getActiveWorkspaceFileDrag,
  getDraggedWorkspaceFile,
  getThreadComposerSyncKey,
  isWorkspaceFileDragTransfer,
  removeWorkspaceThreadComposerAttachment,
  setWorkspaceThreadComposerAttachments,
  WORKSPACE_FILE_POINTER_DROP_EVENT,
  workspaceFileToComposerAttachment,
} from "../terminals/WorkspaceTerminal/threadRuntime.js";
import {
  getBigViewTextDiagnosticFields,
  logBigViewSyncDiagnosticEvent,
  logFileDragDiagnosticEvent,
} from "./bigViewSyncDiagnostics";
import {
  getLiveTerminalForThread,
  getThreadTerminalGroundTruth,
  threadLooksEffectivelyThinking,
} from "./threadTerminalGroundTruth.js";
import {
  getWorkspaceThreadHasSession,
  getWorkspaceThreadLabel,
  getWorkspaceThreadProviderBinding,
  setWorkspaceThreadDetailVisibility,
} from "./workspaceThreads";

const thinkingPulse = keyframes`
  0%, 100% {
    opacity: 0.42;
  }

  50% {
    opacity: 1;
  }
`;

const DetailRoot = styled.main`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  --thread-bg: #141414;
  --thread-composer-bg: #2d2d2d;
  --thread-bg-soft: #1b1b1b;
  --thread-card: rgba(28, 28, 28, 0.92);
  --thread-card-raised: rgba(34, 34, 34, 0.94);
  --thread-fg: #f4f7fa;
  --thread-muted: #a5a7ad;
  --thread-muted-soft: rgba(165, 167, 173, 0.58);
  --thread-border: rgba(255, 255, 255, 0.08);
  --thread-border-strong: rgba(255, 255, 255, 0.16);
  --thread-accent: rgba(255, 255, 255, 0.07);
  --thread-secondary: #222222;
  --thread-ring: rgba(255, 255, 255, 0.22);
  --thread-ember: #dfa55a;
  --thread-blue: #c6c6c6;
  --thread-green: #3ccb7f;
  --thread-detail-font-size: 12px;
  --thread-detail-small-font-size: 11px;
  --thread-detail-mini-font-size: 10px;
  --thread-composer-font-size: 12px;
  --thread-composer-width: 620px;
  --thread-composer-shell-gap: 6px;
  --thread-composer-shell-padding: 0 22px 18px;
  --thread-composer-box-min-height: 70px;
  --thread-composer-box-radius: 20px;
  --thread-composer-input-min-height: 36px;
  --thread-composer-input-max-height: 96px;
  --thread-composer-input-padding: 9px 15px 0;
  --thread-composer-footer-gap: 7px;
  --thread-composer-footer-padding: 0 11px 5px;
  --thread-composer-actions-gap: 7px;
  --thread-composer-status-gap: 7px;
  --thread-composer-status-min-height: 17px;
  --thread-composer-status-padding: 0;
  --thread-composer-tool-size: 28px;
  --thread-composer-attach-size: 28px;
  --thread-composer-attach-icon-size: 18px;
  --thread-send-button-size: 28px;
  --thread-send-icon-size: 16px;
  color: var(--thread-fg);
  background: var(--thread-bg);
  outline: none;

  &[data-density="compact"] {
    --thread-detail-font-size: 11px;
    --thread-detail-small-font-size: 10px;
    --thread-detail-mini-font-size: 9px;
    --thread-composer-font-size: 11px;
    --thread-composer-width: min(70%, 580px);
    --thread-composer-shell-gap: 5px;
    --thread-composer-shell-padding: 0 20px 10px;
    --thread-composer-box-min-height: 58px;
    --thread-composer-box-radius: 18px;
    --thread-composer-input-min-height: 28px;
    --thread-composer-input-max-height: 84px;
    --thread-composer-input-padding: 8px 14px 0;
    --thread-composer-footer-gap: 6px;
    --thread-composer-footer-padding: 0 10px 1px;
    --thread-composer-actions-gap: 6px;
    --thread-composer-status-gap: 6px;
    --thread-composer-status-min-height: 16px;
    --thread-composer-status-padding: 0;
    --thread-composer-tool-size: 26px;
    --thread-composer-attach-size: 26px;
    --thread-composer-attach-icon-size: 17px;
    --thread-send-button-size: 24px;
    --thread-send-icon-size: 15px;
  }

  html[data-forge-theme="light"] & {
    --thread-bg: #f5f5f7;
    --thread-composer-bg: #ffffff;
    --thread-bg-soft: #ffffff;
    --thread-card: #ffffff;
    --thread-card-raised: #fafafc;
    --thread-fg: #1d1d1f;
    --thread-muted: #7a7a7a;
    --thread-muted-soft: rgba(122, 122, 122, 0.64);
    --thread-border: rgba(0, 0, 0, 0.08);
    --thread-border-strong: rgba(0, 0, 0, 0.14);
    --thread-accent: rgba(0, 0, 0, 0.045);
    --thread-secondary: #fafafc;
    --thread-ring: rgba(0, 113, 227, 0.28);
    --thread-ember: #0066cc;
    --thread-blue: #0066cc;
    --thread-green: #0a7f45;
  }
  font-family:
    Inter,
    "Segoe UI Variable",
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  user-select: text;
  -webkit-user-select: text;
  isolation: isolate;

  *::selection {
    color: #ffffff;
    background: rgba(120, 120, 120, 0.46);
  }

  @media (min-width: 1920px) and (min-height: 980px) {
    --thread-detail-font-size: 13px;
    --thread-detail-small-font-size: 12px;
    --thread-detail-mini-font-size: 11px;
    --thread-composer-font-size: 13px;
  }
`;

const TranscriptScroll = styled.div`
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--thread-bg);
  user-select: text;
  -webkit-user-select: text;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(170, 170, 170, 0.16);
  }
`;

const TranscriptInner = styled.div`
  display: grid;
  width: min(100%, 880px);
  min-height: 100%;
  align-content: end;
  gap: 0;
  margin: 0 auto;
  padding: 42px 28px 26px;
  user-select: text;
  -webkit-user-select: text;
`;

const EmptyThread = styled.div`
  align-self: center;
  justify-self: center;
  max-width: 380px;
  color: var(--thread-muted-soft);
  font-size: var(--thread-detail-font-size);
  font-weight: 520;
  line-height: 1.5;
  text-align: center;
`;

const UserCell = styled.article`
  display: grid;
  width: 100%;
  min-width: 0;
  justify-items: end;
  padding: 2px 0 26px;
  color: var(--thread-fg);
  font-size: var(--thread-detail-font-size);
  line-height: 1.6;
  user-select: text;
  -webkit-user-select: text;
`;

const UserPrefix = styled.span`
  display: none;
  user-select: none;
`;

const MessageText = styled.div`
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--thread-fg);
  font-size: var(--thread-detail-font-size);
  font-weight: 470;
  letter-spacing: 0;
  line-height: 1.58;
  user-select: text;
  -webkit-user-select: text;
`;

const MessageBody = styled.div`
  display: grid;
  min-width: 0;
  gap: 7px;

  article[data-message-role="user"] & {
    box-sizing: border-box;
    width: 100%;
    max-width: none;
    border: 0;
    border-radius: 18px;
    padding: 11px 14px 12px;
    color: #dedede;
    background: #202020;
    box-shadow: none;
  }

  article[data-message-role="user"] & ${MessageText} {
    color: inherit;
  }

  html[data-forge-theme="light"] article[data-message-role="user"] & {
    border: 1px solid rgba(0, 0, 0, 0.08);
    color: #1d1d1f;
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.045),
      inset 0 1px 0 rgba(255, 255, 255, 0.96);
  }

  article[data-message-role="assistant"] & {
    width: 100%;
    padding: 2px 3px;
  }

  article[data-message-role="activity"] & {
    width: 100%;
  }
`;

const AssistantBlock = styled.article`
  position: relative;
  display: grid;
  min-width: 0;
  gap: 0;
  padding: 2px 0 24px;
  color: var(--thread-fg);
  font-size: var(--thread-detail-font-size);
  line-height: 1.6;
  user-select: text;
  -webkit-user-select: text;
`;

const ChatMessageFrame = styled.div`
  position: relative;
  display: grid;
  min-width: 0;

  article[data-message-role="assistant"] & {
    width: 100%;
  }

  article[data-message-role="user"] & {
    width: fit-content;
    max-width: min(78%, 520px);
    justify-self: end;
  }
`;

const MessageCopyButton = styled.button`
  position: absolute;
  bottom: -24px;
  left: 3px;
  z-index: 3;
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--thread-muted);
  background: transparent;
  box-shadow: none;
  opacity: 0;
  pointer-events: none;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  ${ChatMessageFrame}:hover &,
  ${ChatMessageFrame}:focus-within &,
  ${AssistantBlock}:hover &,
  ${AssistantBlock}:focus-within &,
  &[data-visible="true"] {
    opacity: 1;
    pointer-events: auto;
  }

  ${AssistantBlock} > & {
    bottom: 0;
    left: 3px;
  }

  article[data-message-role="user"] & {
    right: 10px;
    left: auto;
  }

  &[data-copied="true"] {
    color: var(--thread-green);
  }

  &:hover {
    color: var(--thread-fg);
    background: var(--thread-accent);
  }

  &:focus-visible {
    opacity: 1;
    pointer-events: auto;
    outline: 2px solid var(--thread-ring);
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] & {
    color: #626268;
    background: transparent;
    box-shadow: none;
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--thread-blue);
    background: var(--thread-accent);
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const MessageInlineCode = styled.code`
  display: inline;
  border-radius: 6px;
  padding: 1px 5px 2px;
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.11);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
  font-weight: 620;

  html[data-forge-theme="light"] & {
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }
`;

const MessageFileLink = styled.button`
  display: inline;
  min-width: 0;
  padding: 0;
  border: 0;
  color: var(--thread-blue);
  background: transparent;
  font: inherit;
  font-weight: 560;
  text-align: left;
  text-decoration: none;
  user-select: text;
  -webkit-user-select: text;

  &:hover {
    color: #f2f2f2;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--forge-blue-soft);
  }
`;

const ThreadDetailTodoDropOverlay = styled.div`
  position: absolute;
  inset: 10px;
  z-index: 80;
  display: grid;
  place-items: center;
  border: 1px dotted rgba(138, 216, 255, 0.46);
  border-radius: 14px;
  background: rgba(2, 8, 14, 0.18);
  box-shadow: inset 0 0 0 1px rgba(138, 216, 255, 0.08);
  pointer-events: none;

  &[data-target="true"] {
    border: 2px dotted rgba(138, 216, 255, 0.94);
    background: rgba(2, 8, 14, 0.54);
    box-shadow:
      inset 0 0 0 1px rgba(255, 173, 124, 0.24),
      0 0 32px rgba(138, 216, 255, 0.12);
  }

  &[data-unsupported="true"] {
    border-color: rgba(255, 112, 112, 0.82);
    background: rgba(32, 4, 8, 0.58);
    box-shadow:
      inset 0 0 0 1px rgba(255, 112, 112, 0.2),
      0 0 32px rgba(255, 112, 112, 0.1);
  }
`;

const ThreadDetailTodoDropLabel = styled.div`
  border: 1px solid rgba(138, 216, 255, 0.3);
  border-radius: 999px;
  padding: 8px 12px;
  color: #e9f8ff;
  background: linear-gradient(135deg, rgba(6, 16, 26, 0.96), rgba(28, 16, 10, 0.92));
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;

  &[data-unsupported="true"] {
    border-color: rgba(255, 112, 112, 0.34);
    color: #ffe5e5;
    background: linear-gradient(135deg, rgba(46, 8, 12, 0.96), rgba(28, 10, 10, 0.92));
  }
`;

const AssistantMarkdownBody = styled.div`
  min-width: 0;
  color: var(--thread-fg);
  font-size: var(--thread-detail-font-size);
  font-weight: 470;
  letter-spacing: 0;
  line-height: 1.62;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0 0 10px;
  }

  h1,
  h2,
  h3,
  h4 {
    margin: 16px 0 8px;
    color: var(--thread-fg);
    font-weight: 680;
    letter-spacing: 0;
    line-height: 1.25;
  }

  h1 {
    font-size: 1.22em;
  }

  h2 {
    font-size: 1.13em;
  }

  h3,
  h4 {
    font-size: 1.04em;
  }

  ul,
  ol {
    margin: 6px 0 12px;
    padding-left: 21px;
  }

  li {
    margin: 3px 0;
    padding-left: 2px;
  }

  li > p {
    margin: 0;
  }

  li > p + p {
    margin-top: 7px;
  }

  blockquote {
    margin: 12px 0;
    border-left: 2px solid var(--thread-border-strong);
    padding: 1px 0 1px 12px;
    color: var(--thread-muted);
  }

  a {
    color: var(--thread-blue);
    font-weight: 560;
    text-decoration: none;
  }

  a:hover {
    color: #f2f2f2;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  html[data-forge-theme="light"] & a:hover {
    color: var(--forge-blue-soft);
  }

  code {
    border-radius: 6px;
    padding: 1px 5px 2px;
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.11);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.92em;
    font-weight: 620;
  }

  html[data-forge-theme="light"] & code {
    color: var(--forge-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  pre {
    max-width: 100%;
    margin: 12px 0;
    overflow-x: auto;
    overflow-y: hidden;
    border: 1px solid var(--thread-border);
    border-radius: 8px;
    padding: 11px 12px;
    background: rgba(255, 255, 255, 0.045);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: var(--thread-detail-small-font-size);
    line-height: 1.55;
    white-space: pre;
  }

  html[data-forge-theme="light"] & pre {
    background: rgba(0, 0, 0, 0.035);
  }

  pre code {
    display: block;
    min-width: max-content;
    padding: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    font-weight: 500;
    white-space: pre;
    overflow-wrap: normal;
  }

  .thread-markdown-table-wrap {
    max-width: 100%;
    margin: 12px 0;
    overflow-x: auto;
    border: 1px solid var(--thread-border);
    border-radius: 8px;
  }

  table {
    width: 100%;
    min-width: 420px;
    border-collapse: collapse;
    font-size: var(--thread-detail-small-font-size);
    line-height: 1.45;
  }

  th,
  td {
    border-bottom: 1px solid var(--thread-border);
    padding: 7px 9px;
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--thread-fg);
    background: rgba(255, 255, 255, 0.055);
    font-weight: 680;
  }

  html[data-forge-theme="light"] & th {
    background: rgba(0, 0, 0, 0.035);
  }

  tr:last-child td {
    border-bottom: 0;
  }

  hr {
    height: 1px;
    margin: 16px 0;
    border: 0;
    background: var(--thread-border);
  }

  input[type="checkbox"] {
    width: 13px;
    height: 13px;
    margin: 0 6px 0 -18px;
    vertical-align: -2px;
  }
`;

const AssistantCell = styled.article`
  display: block;
  min-width: 0;
  padding: 2px 0 7px;
  color: var(--thread-fg);
  font-size: var(--thread-detail-font-size);
  line-height: 1.6;
  user-select: text;
  -webkit-user-select: text;
`;

const AssistantPrefix = styled.span`
  display: none;
  user-select: none;
`;

const TranscriptActivityCell = styled.article`
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 8px;
  margin: 3px 0 9px;
  border: 1px solid var(--thread-border);
  border-radius: 8px;
  padding: 8px 11px;
  color: var(--thread-muted);
  font-size: var(--thread-detail-font-size);
  line-height: 1.5;
  background: rgba(255, 255, 255, 0.018);
  user-select: text;
  -webkit-user-select: text;

  html[data-forge-theme="light"] & {
    border-color: var(--thread-border);
    color: #3a3a3c;
    background: rgba(255, 255, 255, 0.64);
  }
`;

const TranscriptActivityContent = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;
`;

const TranscriptActivityIcon = styled.span`
  display: grid;
  width: 16px;
  height: 22px;
  place-items: center;
  color: var(--thread-muted-soft);
  user-select: none;

  svg {
    width: 13px;
    height: 13px;
  }

  html[data-forge-theme="light"] & {
    color: var(--thread-muted);
  }
`;

const TranscriptActivityHeader = styled.button`
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 22px;
  grid-template-columns: minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--thread-muted);
  background: transparent;
  font: inherit;
  line-height: 1.4;
  text-align: left;
  transition: color 130ms ease;

  &:not(:disabled) {
    cursor: pointer;
  }

  &[data-nested="true"] {
    grid-template-columns: minmax(0, 1fr) 18px;
    min-height: 21px;
    color: var(--thread-muted-soft);
    font-size: var(--thread-detail-small-font-size);
  }

  &:hover {
    color: var(--thread-fg);
  }

  &:disabled {
    color: var(--thread-muted-soft);
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--thread-ring);
    outline-offset: 2px;
  }
`;

const TranscriptActivityTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: currentColor;
  font-weight: 520;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  -webkit-user-select: text;

  html[data-forge-theme="light"] & {
    font-weight: 620;
  }
`;

const TranscriptActivityStatus = styled.span`
  min-width: 0;
  color: var(--thread-muted-soft);
  font-size: var(--thread-detail-mini-font-size);
  font-weight: 480;
  line-height: 1;
  text-transform: none;
  user-select: text;
  -webkit-user-select: text;

  html[data-forge-theme="light"] & {
    color: var(--thread-muted);
    font-weight: 560;
  }
`;

const TranscriptActivityToggle = styled.span`
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  padding: 0;
  border: 0;
  color: currentColor;
  background: transparent;
  pointer-events: none;

  svg {
    width: 15px;
    height: 15px;
    transform: rotate(0deg);
    transition: transform 130ms ease;
  }

  &[data-expanded="true"] svg {
    transform: rotate(180deg);
  }
`;

const TranscriptActivityList = styled.div`
  display: grid;
  min-width: 0;
  gap: 1px;
  padding: 1px 0 0;
`;

const TranscriptActivityTool = styled.div`
  display: grid;
  min-width: 0;
  gap: 1px;
`;

const TranscriptActivityDisclosure = styled.div`
  display: grid;
  min-width: 0;
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  visibility: hidden;
  transition:
    grid-template-rows 180ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
    visibility 0s linear 180ms;

  &[data-expanded="true"] {
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
    visibility: visible;
    transition:
      grid-template-rows 190ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity 150ms ease,
      transform 190ms cubic-bezier(0.16, 1, 0.3, 1),
      visibility 0s linear 0s;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    transform: none;
  }
`;

const TranscriptActivityDisclosureInner = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const TranscriptActivityBody = styled.pre`
  max-height: 260px;
  min-width: 0;
  margin: 2px 0 6px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  padding: 2px 0 2px 18px;
  color: var(--thread-muted);
  background: transparent;
  font: inherit;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: var(--thread-detail-small-font-size);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;

  html[data-forge-theme="light"] & {
    color: #515154;
  }

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(170, 170, 170, 0.18);
  }

  html[data-forge-theme="light"] &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.18);
  }
`;

const TranscriptActivityMetaBody = styled(TranscriptActivityBody)`
  max-height: 120px;
  margin-bottom: 4px;
  color: var(--thread-muted-soft);
`;

const TranscriptActivityJsonBody = styled.pre`
  max-height: 360px;
  min-width: 0;
  margin: 3px 0 7px;
  overflow-x: auto;
  overflow-y: auto;
  border: 1px solid rgba(114, 161, 255, 0.16);
  border-radius: 8px;
  padding: 10px 12px;
  color: #d9e7ff;
  background: linear-gradient(135deg, rgba(40, 57, 88, 0.24), rgba(12, 15, 22, 0.36));
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: var(--thread-detail-small-font-size);
  font-weight: 520;
  line-height: 1.55;
  white-space: pre;
  user-select: text;
  -webkit-user-select: text;

  .token.property {
    color: #91c5ff;
  }

  .token.string {
    color: #8ee6b1;
  }

  .token.number {
    color: #ffd37a;
  }

  .token.boolean,
  .token.null {
    color: #ff9fba;
  }

  .token.punctuation,
  .token.operator {
    color: rgba(224, 236, 255, 0.56);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.16);
    color: #12314f;
    background: linear-gradient(135deg, rgba(0, 102, 204, 0.055), rgba(255, 255, 255, 0.82));
  }

  html[data-forge-theme="light"] & .token.property {
    color: #005cb8;
  }

  html[data-forge-theme="light"] & .token.string {
    color: #107d45;
  }

  html[data-forge-theme="light"] & .token.number {
    color: #935f00;
  }

  html[data-forge-theme="light"] & .token.boolean,
  html[data-forge-theme="light"] & .token.null {
    color: #b0184d;
  }

  html[data-forge-theme="light"] & .token.punctuation,
  html[data-forge-theme="light"] & .token.operator {
    color: rgba(18, 49, 79, 0.54);
  }

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(170, 196, 255, 0.2);
  }

  html[data-forge-theme="light"] &::-webkit-scrollbar-thumb {
    background: rgba(0, 102, 204, 0.2);
  }
`;

const TranscriptArtifactList = styled.div`
  display: grid;
  min-width: 0;
  gap: 8px;
  margin: 7px 0 8px;
`;

const TranscriptArtifactCard = styled.div`
  display: grid;
  min-width: 0;
  gap: 7px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.035);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.09);
    background: rgba(255, 255, 255, 0.72);
  }
`;

const TranscriptArtifactPreviewButton = styled.button`
  display: grid;
  min-width: 0;
  width: 100%;
  max-width: min(100%, 560px);
  place-items: center;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: rgba(0, 0, 0, 0.22);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--thread-ring);
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.045);
  }
`;

const TranscriptArtifactImage = styled.img`
  display: block;
  width: 100%;
  max-width: 560px;
  max-height: 340px;
  object-fit: contain;
`;

const TranscriptArtifactFallback = styled.div`
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--thread-muted);
  font-size: var(--thread-detail-small-font-size);
  line-height: 1.45;
`;

const TranscriptArtifactMeta = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
`;

const TranscriptArtifactText = styled.div`
  min-width: 0;
  overflow: hidden;
`;

const TranscriptArtifactTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--thread-fg);
  font-size: var(--thread-detail-small-font-size);
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TranscriptArtifactSubtitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--thread-muted-soft);
  font-size: var(--thread-detail-mini-font-size);
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TranscriptArtifactActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const TranscriptArtifactActionButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  padding: 0;
  color: var(--thread-muted);
  background: transparent;
  cursor: pointer;
  transition:
    background 130ms ease,
    color 130ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    color: var(--thread-fg);
    background: rgba(255, 255, 255, 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--thread-ring);
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] &:hover {
    background: rgba(0, 0, 0, 0.06);
  }
`;

const ActivityCell = styled.article`
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 10px;
  padding: 0 3px 18px;
  color: var(--thread-muted);
  font-size: var(--thread-detail-font-size);
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;
`;

const ActivityBullet = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--thread-blue);
  user-select: none;

  svg {
    width: 14px;
    height: 14px;
  }
`;

const ActivityText = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 560;
  white-space: nowrap;
  user-select: text;
  -webkit-user-select: text;

  &[data-live="true"]::after {
    display: inline-block;
    width: 18px;
    margin-left: 2px;
    animation: ${thinkingPulse} 1.1s ease-in-out infinite;
    content: "...";
  }
`;

const DiffInline = styled.span`
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
`;

const DiffFileName = styled.span`
  min-width: 0;
  overflow: hidden;
  color: #4eb4ff;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DiffCount = styled.span`
  color: var(--thread-muted);
  font-variant-numeric: tabular-nums;
  font-weight: 720;

  &[data-tone="add"] {
    color: #74d28a;
  }

  &[data-tone="delete"] {
    color: #ff6d61;
  }
`;

const ThreadDiffLiveBanner = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--thread-border-strong);
  border-radius: 8px;
  color: var(--thread-fg);
  background: var(--thread-card-raised);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  animation: ${thinkingPulse} 1.5s ease-in-out;
`;

const ThreadDiffBannerTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
  overflow: hidden;
  font-size: var(--thread-detail-font-size);
  font-weight: 760;
  white-space: nowrap;

  span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const ThreadDiffCard = styled.section`
  display: grid;
  width: min(100%, 690px);
  min-width: 0;
  justify-self: stretch;
  overflow: hidden;
  margin: 12px 0 4px 3px;
  border: 1px solid var(--thread-border-strong);
  border-radius: 8px;
  color: var(--thread-fg);
  background: var(--thread-card-raised);
`;

const ThreadDiffCardHeader = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--thread-border);
`;

const ThreadDiffCardTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
  font-size: var(--thread-detail-font-size);
  font-weight: 760;
  white-space: nowrap;

  > span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const ThreadDiffActionButton = styled.button`
  display: inline-flex;
  min-width: 0;
  height: 28px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  color: var(--thread-muted);
  background: transparent;
  font: inherit;
  font-size: var(--thread-detail-small-font-size);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  transition:
    background 120ms ease,
    color 120ms ease,
    opacity 120ms ease;

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }

  &:hover:not(:disabled) {
    color: var(--thread-fg);
    background: var(--thread-accent);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 520px) {
    width: 28px;
    padding: 0;

    span {
      display: none;
    }
  }
`;

const ThreadDiffExpandButton = styled(ThreadDiffActionButton)`
  width: 28px;
  padding: 0;

  svg {
    transition: transform 130ms ease;
  }

  &[data-expanded="true"] svg {
    transform: rotate(180deg);
  }
`;

const ThreadDiffFileList = styled.div`
  display: grid;
  max-height: 220px;
  overflow-y: auto;
`;

const ThreadDiffFileRow = styled.button`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.035);
  color: var(--thread-fg);
  background: transparent;
  font: inherit;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--thread-accent);
  }
`;

const ThreadDiffFilePath = styled.span`
  min-width: 0;
  overflow: hidden;
  color: #d4d4d4;
  font-size: var(--thread-detail-font-size);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ThreadDiffFileCounts = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 6px;
  font-size: var(--thread-detail-font-size);
`;

const ComposerShell = styled.form`
  display: grid;
  width: min(100%, var(--thread-composer-width, 640px));
  gap: var(--thread-composer-shell-gap, 8px);
  margin: 0 auto;
  padding: var(--thread-composer-shell-padding, 0 22px 24px);
  background: var(--thread-bg);
  user-select: none;
`;

const ComposerBox = styled.div`
  display: grid;
  min-height: var(--thread-composer-box-min-height, 88px);
  grid-template-rows: auto minmax(var(--thread-composer-input-min-height, 42px), auto) auto;
  position: relative;
  overflow: visible;
  border: 1px solid transparent;
  border-radius: var(--thread-composer-box-radius, 22px);
  background: var(--thread-composer-bg);
  box-shadow: none;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;

  &:focus-within {
    border-color: transparent;
    box-shadow: none;
  }
`;

const ComposerInput = styled.textarea`
  width: 100%;
  min-height: var(--thread-composer-input-min-height, 42px);
  max-height: var(--thread-composer-input-max-height, 126px);
  resize: none;
  padding: var(--thread-composer-input-padding, 13px 16px 5px);
  border: 0;
  outline: none;
  color: #d6d6d6;
  background: transparent;
  font: inherit;
  font-size: var(--thread-composer-font-size);
  font-weight: 470;
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;

  &::placeholder {
    color: #808080;
  }

  &:disabled {
    color: var(--thread-muted-soft);
    cursor: not-allowed;
  }
`;

const ComposerFooter = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--thread-composer-footer-gap, 10px);
  padding: var(--thread-composer-footer-padding, 0 12px 12px);
  user-select: none;
`;

const ComposerHint = styled.span`
  min-width: 0;
  overflow: hidden;
  color: rgba(170, 170, 170, 0.5);
  font-size: var(--thread-composer-font-size);
  font-weight: 640;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ComposerControls = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
`;

const ComposerActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--thread-composer-actions-gap, 7px);
`;

const ComposerToolButton = styled.button`
  display: inline-flex;
  min-width: 0;
  height: var(--thread-composer-tool-size, 29px);
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #a8a8a8;
  background: rgba(255, 255, 255, 0.04);
  font: inherit;
  font-size: var(--thread-detail-small-font-size, 11px);
  font-weight: 620;
  line-height: 1;
  user-select: none;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    opacity 120ms ease;

  &:hover:not(:disabled) {
    color: #f2f2f2;
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.075);
  }

  &:disabled {
    opacity: 0.44;
    cursor: not-allowed;
  }

  svg {
    width: 17px;
    height: 17px;
  }
`;

const ComposerAttachButton = styled(ComposerToolButton)`
  width: var(--thread-composer-attach-size, 30px);
  height: var(--thread-composer-attach-size, 30px);
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--thread-muted);
  background: transparent;

  &:hover:not(:disabled) {
    border-color: transparent;
    color: #f2f2f2;
    background: rgba(255, 255, 255, 0.07);
  }

  svg {
    width: var(--thread-composer-attach-icon-size, 20px);
    height: var(--thread-composer-attach-icon-size, 20px);
  }
`;

const ComposerStatusLine = styled.div`
  display: flex;
  min-width: 0;
  min-height: var(--thread-composer-status-min-height, 18px);
  align-items: center;
  gap: var(--thread-composer-status-gap, 8px);
  overflow: hidden;
  padding: var(--thread-composer-status-padding, 2px 0);
  color: rgba(232, 232, 232, 0.82);
  font-size: var(--thread-detail-small-font-size, 11px);
  font-weight: 620;
  line-height: 1.35;
  white-space: nowrap;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span:first-child {
    color: #f0f0f0;
  }
`;

const ModelMenuWrap = styled.div`
  display: none;
  position: relative;
  min-width: 0;
`;

const ModelButton = styled(ComposerToolButton)`
  max-width: min(260px, 38vw);
  color: #e6e6e6;
  background: rgba(255, 255, 255, 0.045);

  &[data-empty="true"] {
    width: 30px;
    padding: 0;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    color: var(--thread-muted-soft);
  }
`;

const ModelDropdown = styled.div`
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  display: none;
  width: min(280px, 70vw);
  max-height: min(320px, 48vh);
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(32, 32, 32, 0.98);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 18px 48px rgba(0, 0, 0, 0.48);

  &[data-open="true"] {
    display: grid;
  }
`;

const ModelOption = styled.button`
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 10px 11px;
  border: 0;
  color: var(--thread-fg);
  background: transparent;
  text-align: left;
  font: inherit;
  user-select: none;

  &:hover,
  &[data-selected="true"] {
    background: rgba(255, 255, 255, 0.08);
  }

  strong {
    overflow: hidden;
    font-size: var(--thread-detail-font-size, 12px);
    font-weight: 650;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--thread-muted);
    font-size: var(--thread-detail-small-font-size, 11px);
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AttachmentStrip = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
  padding: 9px 10px 0;

  &:empty {
    display: none;
  }
`;

const AttachmentChip = styled.span`
  display: inline-flex;
  max-width: 260px;
  min-height: 44px;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 5px 6px;
  color: var(--thread-fg);
  background: rgba(255, 255, 255, 0.045);
  font-size: var(--thread-detail-small-font-size, 11px);
  line-height: 1;
  user-select: none;

  img {
    width: 42px;
    height: 34px;
    flex: 0 0 auto;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.08);
    object-fit: cover;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    padding: 0;
    border: 0;
    color: var(--thread-muted);
    background: transparent;

    &:hover {
      color: var(--thread-fg);
    }
  }

  svg {
    width: 13px;
    height: 13px;
  }
`;

const AttachmentQueueHint = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  color: rgba(253, 230, 138, 0.78);
  font-size: var(--thread-detail-mini-font-size, 10px);
  font-weight: 720;
  line-height: 1;
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const SendButton = styled.button`
  display: grid;
  width: var(--thread-send-button-size, 34px);
  height: var(--thread-send-button-size, 34px);
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: #1a1a1a;
  background: #d8d8d8;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.32);
  user-select: none;
  transition:
    background 130ms ease,
    border-color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled) {
    background: #eeeeee;
  }

  &:disabled {
    background: #8c8c8c;
    opacity: 0.46;
    cursor: not-allowed;
  }

  svg {
    display: block;
    width: var(--thread-send-icon-size, 19px);
    height: var(--thread-send-icon-size, 19px);
  }
`;

const ComposerError = styled.div`
  color: #ef6b6b;
  font-size: var(--thread-detail-small-font-size, 11px);
  line-height: 1.35;
`;

const NewChatRoot = styled.main`
  display: grid;
  min-width: 0;
  min-height: 0;
  place-items: center;
  padding: 36px 24px;
  overflow-x: hidden;
  overflow-y: auto;
  --thread-bg: #1b1b1b;
  --thread-composer-bg: #2d2d2d;
  --thread-card: rgba(32, 32, 32, 0.92);
  --thread-fg: #f4f7fa;
  --thread-muted: #a5a7ad;
  --thread-muted-soft: rgba(165, 167, 173, 0.58);
  --thread-border: rgba(255, 255, 255, 0.08);
  --thread-accent: rgba(255, 255, 255, 0.07);
  --thread-ring: rgba(255, 255, 255, 0.22);
  color: var(--thread-fg);
  background: var(--thread-bg);
  outline: none;

  html[data-forge-theme="light"] & {
    --thread-bg: #f5f5f7;
    --thread-composer-bg: #ffffff;
    --thread-card: #ffffff;
    --thread-fg: #1d1d1f;
    --thread-muted: #7a7a7a;
    --thread-muted-soft: rgba(122, 122, 122, 0.64);
    --thread-border: rgba(0, 0, 0, 0.08);
    --thread-accent: rgba(0, 0, 0, 0.045);
    --thread-ring: rgba(0, 113, 227, 0.28);
  }
`;

const NewChatCenter = styled.form`
  display: grid;
  width: min(100%, 640px);
  gap: 26px;
`;

const NewChatTitle = styled.h1`
  margin: 0;
  color: var(--thread-fg);
  font-size: clamp(25px, 4vw, 38px);
  font-weight: 560;
  letter-spacing: 0;
  line-height: 1.12;
  text-align: center;
`;

const NewChatBox = styled.div`
  display: grid;
  min-height: 94px;
  grid-template-rows: minmax(46px, auto) auto;
  position: relative;
  overflow: visible;
  border: 1px solid transparent;
  border-radius: 22px;
  background: var(--thread-composer-bg);
  box-shadow: none;

  &:focus-within {
    border-color: transparent;
    box-shadow: none;
  }
`;

const NewChatInput = styled.textarea`
  width: 100%;
  min-height: 46px;
  max-height: 126px;
  resize: none;
  padding: 13px 16px 5px;
  border: 0;
  outline: 0;
  color: #d6d6d6;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 470;
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;

  &::placeholder {
    color: #808080;
  }

  &:disabled {
    color: var(--thread-muted-soft);
    cursor: not-allowed;
  }
`;

const NewChatToolbar = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px 12px;
`;

const NewChatControls = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const NewChatAgentMenuWrap = styled.div`
  position: relative;
  min-width: 0;
`;

const NewChatAgentButton = styled(ComposerToolButton)`
  max-width: min(172px, 42vw);
  height: 32px;
  min-width: 116px;
  justify-content: flex-start;
  border-color: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 0 8px 0 10px;
  color: #e6e6e6;
  background: rgba(255, 255, 255, 0.045);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);

  &[aria-expanded="true"] {
    border-color: rgba(255, 255, 255, 0.16);
    color: #ffffff;
    background: rgba(255, 255, 255, 0.075);
  }

  span[data-agent-label="true"] {
    min-width: 0;
    overflow: hidden;
    flex: 1 1 auto;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    color: var(--thread-muted-soft);
  }
`;

const NewChatAgentStatusDot = styled.span`
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(165, 167, 173, 0.62);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.025);

  &[data-ready="true"] {
    background: var(--thread-green);
    box-shadow:
      0 0 0 3px rgba(60, 203, 127, 0.1),
      0 0 12px rgba(60, 203, 127, 0.22);
  }
`;

const NewChatAgentDropdown = styled(ModelDropdown)`
  right: auto;
  left: 0;
  width: min(238px, calc(100vw - 48px));
`;

const NewChatAgentOption = styled.button`
  display: grid;
  min-width: 0;
  grid-template-columns: 10px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border: 0;
  color: var(--thread-fg);
  background: transparent;
  text-align: left;
  font: inherit;
  user-select: none;

  &:hover:not(:disabled),
  &[data-selected="true"] {
    background: rgba(255, 255, 255, 0.08);
  }

  &:disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }

  strong,
  span[data-agent-state="true"] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f2f2f2;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.2;
  }

  span[data-agent-state="true"] {
    color: var(--thread-muted);
    font-size: 11px;
    line-height: 1.25;
  }
`;

const NewChatAgentOptionText = styled.span`
  display: grid;
  min-width: 0;
  gap: 3px;
`;

const NewChatActions = styled(ComposerActions)``;

const NewChatProject = styled.div`
  min-width: 0;
  max-width: 260px;
  overflow: hidden;
  color: var(--thread-muted);
  font-size: 12px;
  font-weight: 640;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NewChatAttachButton = styled(ComposerAttachButton)`
  width: 32px;
  height: 32px;
`;

const NewChatSendButton = styled(SendButton)`
  width: 40px;
  height: 40px;
  border-radius: 999px;

  svg {
    width: 22px;
    height: 22px;
  }
`;

const NewChatAttachmentStrip = styled(AttachmentStrip)`
  padding: 0;
`;

const NewChatFooter = styled.div`
  display: grid;
  gap: 8px;
`;

const NewChatError = styled(ComposerError)`
  text-align: center;
`;

const AGENT_LABELS = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};
const IMAGE_ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const IMAGE_ATTACHMENT_LIMIT = 4;
const IMAGE_DROP_DIAGNOSTIC_LIMIT = 8;
const IMAGE_EXTENSION_MIME_TYPES = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
const WORKSPACE_FILE_OPEN_EVENT = "diffforge:workspace-file-open";
const THREAD_AGENT_IDS = new Set(["codex", "claude", "opencode"]);
const FILE_TOKEN_PATTERN = /((?:[A-Za-z]:[\\/])?(?:[A-Za-z0-9_.@ -]+[\\/])+[A-Za-z0-9_.@ -]+\.[A-Za-z0-9]+(?::\d+)?|[A-Za-z0-9_.@-]+\.(?:cjs|css|html|js|jsx|json|lock|md|mdx|mjs|ps1|py|rs|scss|sh|toml|ts|tsx|txt|yaml|yml)(?::\d+)?)/g;
const THREAD_DIFF_SUMMARY_STORAGE_PREFIX = "diffforge.threadDiffSummary.v1";
const THREAD_DIFF_POLL_INTERVAL_MS = 3500;
const THREAD_DIFF_TERMINAL_STATES = new Set(["completed", "error", "interrupted", "cancelled", "canceled"]);
const THREAD_DIFF_LIVE_STATES = new Set(["running", "thinking", "starting", "queued"]);
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const PRISM_LANGUAGE_ALIASES = new Map([
  ["cjs", "javascript"],
  ["html", "markup"],
  ["js", "javascript"],
  ["jsx", "jsx"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["mjs", "javascript"],
  ["ps", "powershell"],
  ["ps1", "powershell"],
  ["py", "python"],
  ["rs", "rust"],
  ["shell", "bash"],
  ["sh", "bash"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["yml", "yaml"],
]);
const MODEL_OPTIONS = {
  claude: [
    { detail: "Balanced Claude Code default", label: "Sonnet", value: "sonnet" },
    { detail: "Higher capability", label: "Opus", value: "opus" },
    { detail: "Fastest Claude option", label: "Haiku", speed: "fast", value: "haiku" },
  ],
  codex: [
    { detail: "Latest Codex model", label: "5.5", thinkingPower: "xhigh", value: "gpt-5.5" },
    { detail: "Balanced coding model", label: "5.4", thinkingPower: "high", value: "gpt-5.4" },
    { detail: "Fast coding model", label: "5.3 Codex Spark", speed: "fast", thinkingPower: "high", value: "gpt-5.3-codex-spark" },
    { detail: "Long-running work model", label: "5.2", thinkingPower: "high", value: "gpt-5.2" },
    { detail: "Older Codex model", label: "5.1", thinkingPower: "medium", value: "gpt-5.1" },
  ],
  opencode: [
    { detail: "Vision capable when configured in OpenCode", label: "GPT-5.5", value: "openai/gpt-5.5" },
    { detail: "Vision capable when configured in OpenCode", label: "Claude Sonnet", value: "anthropic/claude-sonnet-4-5" },
    { detail: "Vision capable when configured in OpenCode", label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
  ],
};

function normalizeAgentId(value) {
  const agentId = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");

  if (agentId.includes("claude")) {
    return "claude";
  }

  if (agentId.includes("opencode") || agentId.includes("open-code")) {
    return "opencode";
  }

  if (agentId.includes("codex")) {
    return "codex";
  }

  return THREAD_AGENT_IDS.has(agentId) ? agentId : "codex";
}

function getConfiguredModelOption(agentId, model) {
  const normalizedAgentId = normalizeAgentId(agentId);
  const normalizedModel = String(model || "").trim();

  if (!normalizedModel) {
    return null;
  }

  return (MODEL_OPTIONS[normalizedAgentId] || []).find((option) => (
    String(option?.value || "").trim() === normalizedModel
  )) || null;
}

function findAgentStatus(agentStatuses, agentId) {
  const normalizedAgentId = normalizeAgentId(agentId);
  return (Array.isArray(agentStatuses) ? agentStatuses : []).find((status) => (
    normalizeAgentId(status?.id) === normalizedAgentId
  )) || null;
}

function getStatusModel(status) {
  return String(
    status?.activeModel
      || status?.model
      || status?.selectedModel
      || status?.configuredModel
      || "",
  ).trim();
}

function getAttachmentLogSummary(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      id: String(attachment?.id || ""),
      mimeType: String(attachment?.mimeType || ""),
      name: String(attachment?.name || ""),
      size: Number(attachment?.size || 0),
    }))
    .slice(0, 8);
}

function getModelThinkingPowerMetadata(agentId, option, model) {
  const normalizedAgentId = normalizeAgentId(agentId);
  const normalizedModel = String(model || option?.value || "").trim().toLowerCase();
  const configuredOption = getConfiguredModelOption(normalizedAgentId, normalizedModel);
  const explicitValue = String(
    option?.thinkingPower
      || option?.reasoningEffort
      || option?.reasoning_effort
      || option?.thinkingBudget
      || option?.thinking_budget
      || configuredOption?.thinkingPower
      || configuredOption?.reasoningEffort
      || configuredOption?.reasoning_effort
      || configuredOption?.thinkingBudget
      || configuredOption?.thinking_budget
      || "",
  ).trim();

  if (explicitValue) {
    return {
      source: "model_option",
      thinkingPower: explicitValue,
    };
  }

  if (normalizedAgentId === "codex") {
    return {
      source: normalizedModel.includes("spark") ? "codex_spark_default" : "codex_default",
      thinkingPower: normalizedModel.includes("spark") ? "high" : "medium",
    };
  }

  if (normalizedAgentId === "claude") {
    return {
      source: "not_configured",
      thinkingPower: "",
    };
  }

  return {
    source: "unsupported_agent",
    thinkingPower: "",
  };
}

function getModelOptions(agentId, status, binding = null) {
  const normalizedAgentId = normalizeAgentId(agentId);
  const sessionModel = String(
    binding?.modelId
      || binding?.model
      || binding?.activeModel
      || binding?.nativeModel
      || binding?.selectedModel
      || binding?.configuredModel
      || "",
  ).trim();
  const activeModel = sessionModel || getStatusModel(status);
  const options = [];

  if (activeModel) {
    options.push({
      detail: sessionModel ? "Session model" : "Active terminal model",
      label: activeModel,
      value: activeModel,
    });
  } else {
    options.push({
      detail: "Use the agent default",
      label: "Agent default",
      value: "",
    });
  }

  (MODEL_OPTIONS[normalizedAgentId] || []).forEach((option) => {
    if (!options.some((existing) => existing.value === option.value)) {
      options.push(option);
    }
  });

  return options;
}

function getImageInputSupport(agentId, status, selectedModel) {
  const normalizedAgentId = normalizeAgentId(agentId);
  const activeModel = String(selectedModel || getStatusModel(status)).trim();

  return getAgentModelImageInputCapability(normalizedAgentId, activeModel, {
    agentLabel: AGENT_LABELS[normalizedAgentId] || normalizedAgentId,
  });
}

function getVisibleModelLabel(option) {
  const label = String(option?.label || "").trim();
  const value = String(option?.value || "").trim();
  return value ? label : "";
}

function getModelButtonLabel(option) {
  return getVisibleModelLabel(option) || "Model";
}

function getCompactModelLabel(agentId, option, model) {
  return String(model || option?.value || "").trim();
}

function formatComposerMetaLabel(value) {
  return String(value || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getThinkingPowerLabel(agentId, option, model) {
  const metadata = getModelThinkingPowerMetadata(agentId, option, model);
  return String(metadata.thinkingPower || "").trim();
}

function getModelSpeedLabel(agentId, option, model) {
  const modelValue = String(model || option?.value || "").trim();
  const configuredOption = getConfiguredModelOption(agentId, modelValue);
  const value = String(option?.speed || configuredOption?.speed || "").trim();

  return formatComposerMetaLabel(value);
}

function getComposerStatusItems(agentId, option, model) {
  return [
    AGENT_LABELS[normalizeAgentId(agentId)] || "Agent",
    getCompactModelLabel(agentId, option, model),
    getThinkingPowerLabel(agentId, option, model),
    getModelSpeedLabel(agentId, option, model),
  ].filter(Boolean);
}

function getConcreteModelValue(modelOptions) {
  return String(
    (Array.isArray(modelOptions) ? modelOptions : [])
      .find((option) => String(option?.value || "").trim())?.value
      || "",
  ).trim();
}

function inferImageMimeType(file) {
  const explicitType = String(file?.type || "").trim();
  if (explicitType.startsWith("image/")) {
    return explicitType;
  }

  const extension = String(file?.name || "")
    .trim()
    .toLowerCase()
    .split(".")
    .pop();
  return IMAGE_EXTENSION_MIME_TYPES.get(extension) || "";
}

function isImageFile(file) {
  return Boolean(file) && Boolean(inferImageMimeType(file));
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const mimeType = inferImageMimeType(file);
    if (!file || !mimeType) {
      reject(new Error("Choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.onload = () => resolve({
      dataUrl: String(reader.result || ""),
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mimeType,
      name: file.name || "image",
      size: file.size || 0,
    });
    reader.readAsDataURL(file);
  });
}

function dedupeImageFiles(files) {
  const seen = new Set();

  return Array.from(files || [])
    .filter(isImageFile)
    .filter((file) => {
      const signature = [
        String(file?.name || "image"),
        inferImageMimeType(file),
        String(file?.size || 0),
        String(file?.lastModified || 0),
      ].join("|");
      if (!signature || seen.has(signature)) {
        return false;
      }
      seen.add(signature);
      return true;
    });
}

function getClipboardImageFiles(clipboardData) {
  const itemFiles = Array.from(clipboardData?.items || [])
    .filter((item) => item?.kind === "file" && (
      String(item.type || "").startsWith("image/")
      || isImageFile(item.getAsFile?.())
    ))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const clipboardFiles = Array.from(clipboardData?.files || [])
    .filter(isImageFile);

  return dedupeImageFiles(itemFiles.concat(clipboardFiles));
}

function getPasteTargetElement(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  if (typeof target.closest === "function") {
    return target;
  }

  return target.parentElement || null;
}

function isEditablePasteTarget(target) {
  const element = getPasteTargetElement(target);
  return Boolean(element?.closest?.("textarea,input,[contenteditable='true'],[contenteditable='plaintext-only']"));
}

function isInteractivePasteTarget(target) {
  const element = getPasteTargetElement(target);
  return Boolean(element?.closest?.(
    "textarea,input,select,button,a,[role='button'],[role='menuitem'],[contenteditable='true'],[contenteditable='plaintext-only']",
  ));
}

function hasImageFileTransfer(dataTransfer) {
  return Array.from(dataTransfer?.types || []).some((type) => String(type || "").toLowerCase() === "files")
    || Array.from(dataTransfer?.items || []).some((item) => (
      item?.kind === "file"
      && (
        String(item.type || "").startsWith("image/")
        || isImageFile(item.getAsFile?.())
      )
    ));
}

function getDroppedImageFiles(dataTransfer) {
  const itemFiles = Array.from(dataTransfer?.items || [])
    .filter((item) => item?.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const transferFiles = Array.from(dataTransfer?.files || []);

  return dedupeImageFiles(itemFiles.concat(transferFiles));
}

function describeImageDropFile(file) {
  if (!file) {
    return null;
  }

  return {
    inferredMimeType: inferImageMimeType(file),
    isImage: isImageFile(file),
    lastModified: Number(file?.lastModified || 0),
    mimeType: String(file?.type || ""),
    name: String(file?.name || ""),
    size: Number(file?.size || 0),
  };
}

function describeImageDropItem(item, index) {
  let file = null;
  let fileError = "";

  if (item?.kind === "file") {
    try {
      file = item.getAsFile?.() || null;
    } catch (error) {
      fileError = error?.message || String(error || "");
    }
  }

  return {
    file: describeImageDropFile(file),
    fileError,
    index,
    kind: String(item?.kind || ""),
    type: String(item?.type || ""),
  };
}

function describeImageDropTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const files = Array.from(dataTransfer?.files || []);

  return {
    dropEffect: String(dataTransfer?.dropEffect || ""),
    effectAllowed: String(dataTransfer?.effectAllowed || ""),
    fileCount: files.length,
    files: files.slice(0, IMAGE_DROP_DIAGNOSTIC_LIMIT).map(describeImageDropFile),
    itemCount: items.length,
    items: items.slice(0, IMAGE_DROP_DIAGNOSTIC_LIMIT).map(describeImageDropItem),
    typeCount: Array.from(dataTransfer?.types || []).length,
    types: Array.from(dataTransfer?.types || []),
  };
}

function describeImageDropEnvironment() {
  return {
    language: typeof navigator === "undefined" ? "" : String(navigator.language || ""),
    platform: typeof navigator === "undefined" ? "" : String(navigator.platform || ""),
    userAgent: typeof navigator === "undefined" ? "" : String(navigator.userAgent || "").slice(0, 220),
  };
}

function describeImageSupportDiagnostics({
  activeAgentId,
  activeAgentStatus,
  imageInputSupport,
  modelOptions,
  selectedModel,
  selectedModelOption,
}) {
  return {
    activeAgentId,
    agentId: activeAgentId,
    imageSupportActiveModel: imageInputSupport?.activeModel || "",
    imageSupportReason: imageInputSupport?.reason || "",
    imageSupportState: imageInputSupport?.state || "",
    imageSupported: Boolean(imageInputSupport?.supported),
    modelOptions: (Array.isArray(modelOptions) ? modelOptions : [])
      .slice(0, IMAGE_DROP_DIAGNOSTIC_LIMIT)
      .map((option) => ({
        detail: String(option?.detail || ""),
        label: String(option?.label || ""),
        value: String(option?.value || ""),
      })),
    selectedModel: selectedModel || "",
    selectedModelOption: {
      detail: String(selectedModelOption?.detail || ""),
      label: String(selectedModelOption?.label || ""),
      value: String(selectedModelOption?.value || ""),
    },
    statusModel: getStatusModel(activeAgentStatus),
  };
}

function formatSavedImageAttachments(images, startIndex = 0) {
  return (Array.isArray(images) ? images : [])
    .map((image, index) => {
      const name = String(image?.name || `image-${startIndex + index + 1}`).trim();
      const path = String(image?.path || "").trim();
      return path ? `[image-attached ${startIndex + index + 1}] ${name} -> ${path}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatSavedFileAttachments(attachments, startIndex = 0) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment, index) => {
      const path = String(attachment?.savedPath || attachment?.path || "").trim();
      if (!path) {
        return "";
      }

      const name = String(attachment?.name || `file-${startIndex + index + 1}`).trim();
      const mimeType = String(attachment?.mimeType || "").trim();
      const label = mimeType.startsWith("image/") || String(attachment?.kind || "") === "image"
        ? "image-attached"
        : "file-attached";
      return `[${label} ${startIndex + index + 1}] ${name} -> ${path}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function saveImageAttachments(attachments) {
  const savedPathAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => String(attachment?.savedPath || attachment?.path || "").trim());
  const images = (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      name: attachment.name,
    }))
    .filter((attachment) => attachment.dataUrl && attachment.mimeType);

  if (!images.length && !savedPathAttachments.length) {
    return "";
  }

  const blocks = [];
  if (savedPathAttachments.length) {
    blocks.push(formatSavedFileAttachments(savedPathAttachments, 0));
  }
  if (images.length) {
    const savedImages = await invoke("save_todo_image_attachments", { images });
    blocks.push(formatSavedImageAttachments(savedImages, savedPathAttachments.length));
  }

  const imageBlock = blocks.filter(Boolean).join("\n");
  if (!imageBlock) {
    throw new Error("Unable to prepare image attachment.");
  }

  return imageBlock;
}

function isAgentStatusReady(status) {
  if (!status) {
    return true;
  }

  return status.installed === true && status.authenticated === true;
}

function getNewChatAgentOptions(agentStatuses) {
  return ["codex", "claude", "opencode"].map((agentId) => {
    const status = findAgentStatus(agentStatuses, agentId);
    const ready = isAgentStatusReady(status);

    return {
      disabled: !ready,
      id: agentId,
      label: AGENT_LABELS[agentId] || agentId,
      status,
    };
  });
}

function getDefaultNewChatAgentId(agentStatuses) {
  return getNewChatAgentOptions(agentStatuses).find((option) => !option.disabled)?.id || "codex";
}

function NewChatView({
  agentStatuses,
  onCreateChat,
  workspace,
}) {
  const [draft, setDraft] = useState("");
  const [agentId, setAgentId] = useState(() => getDefaultNewChatAgentId(agentStatuses));
  const [attachments, setAttachments] = useState([]);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const newChatRootRef = useRef(null);
  const newChatInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const agentOptions = useMemo(() => getNewChatAgentOptions(agentStatuses), [agentStatuses]);
  const selectedAgentOption = agentOptions.find((option) => option.id === agentId) || agentOptions[0];
  const activeAgentId = normalizeAgentId(selectedAgentOption?.id || agentId);
  const activeAgentStatus = useMemo(
    () => findAgentStatus(agentStatuses, activeAgentId),
    [activeAgentId, agentStatuses],
  );
  const modelOptions = useMemo(
    () => getModelOptions(activeAgentId, activeAgentStatus),
    [activeAgentId, activeAgentStatus],
  );
  const effectiveSelectedModel = selectedModel || getConcreteModelValue(modelOptions);
  const selectedModelOption = modelOptions.find((option) => option.value === effectiveSelectedModel) || modelOptions[0];
  const modelButtonLabel = getModelButtonLabel(selectedModelOption);
  const imageInputSupport = getImageInputSupport(activeAgentId, activeAgentStatus, effectiveSelectedModel);
  const submitDisabled = sending
    || selectedAgentOption?.disabled
    || !workspace?.id
    || (!draft.trim() && attachments.length === 0);

  useEffect(() => {
    const defaultAgentId = getDefaultNewChatAgentId(agentStatuses);
    setAgentId((currentAgentId) => {
      const currentOption = getNewChatAgentOptions(agentStatuses).find((option) => option.id === currentAgentId);
      return currentOption && !currentOption.disabled ? currentAgentId : defaultAgentId;
    });
    setAgentMenuOpen(false);
  }, [agentStatuses]);

  useEffect(() => {
    setSelectedModel(getConcreteModelValue(modelOptions) || modelOptions[0]?.value || "");
    setAgentMenuOpen(false);
    setModelMenuOpen(false);
  }, [activeAgentId, modelOptions]);

  useEffect(() => {
    logBigViewSyncDiagnosticEvent("bigview.image.capability_state", {
      ...describeImageSupportDiagnostics({
        activeAgentId,
        activeAgentStatus,
        imageInputSupport,
        modelOptions,
        selectedModel: effectiveSelectedModel,
        selectedModelOption,
      }),
      environment: describeImageDropEnvironment(),
      surface: "new_chat",
      workspaceId: workspace?.id || "",
    });
  }, [
    activeAgentId,
    activeAgentStatus,
    imageInputSupport.activeModel,
    imageInputSupport.reason,
    imageInputSupport.state,
    imageInputSupport.supported,
    modelOptions,
    effectiveSelectedModel,
    selectedModelOption,
    workspace?.id,
  ]);

  useEffect(() => {
    logBigViewSyncDiagnosticEvent("bigview.image.attachment_state", {
      agentId: activeAgentId,
      attachmentCount: attachments.length,
      attachments: getAttachmentLogSummary(attachments),
      imageSupportReason: imageInputSupport.reason || "",
      imageSupportState: imageInputSupport.state || "",
      imageSupported: Boolean(imageInputSupport.supported),
      selectedModel: effectiveSelectedModel || "",
      surface: "new_chat",
      workspaceId: workspace?.id || "",
    });
  }, [
    activeAgentId,
    attachments,
    imageInputSupport.reason,
    imageInputSupport.state,
    imageInputSupport.supported,
    effectiveSelectedModel,
    workspace?.id,
  ]);

  const addImageFiles = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, IMAGE_ATTACHMENT_LIMIT - attachments.length);
    if (!files.length) {
      return;
    }

    logBigViewSyncDiagnosticEvent("bigview.image.add_start", {
      agentId: activeAgentId,
      attachmentCountBefore: attachments.length,
      fileCount: files.length,
      files: files.map(describeImageDropFile),
      imageSupportReason: imageInputSupport.reason || "",
      imageSupportState: imageInputSupport.state || "",
      imageSupported: Boolean(imageInputSupport.supported),
      model: effectiveSelectedModel || "",
      surface: "new_chat",
      workspaceId: workspace?.id || "",
    });
    setError("");
    try {
      const nextAttachments = await Promise.all(files.map(readImageFile));
      setAttachments((currentAttachments) => (
        currentAttachments.concat(nextAttachments).slice(0, IMAGE_ATTACHMENT_LIMIT)
      ));
      logBigViewSyncDiagnosticEvent("bigview.image.add_done", {
        agentId: activeAgentId,
        attachmentCountAfter: Math.min(IMAGE_ATTACHMENT_LIMIT, attachments.length + nextAttachments.length),
        attachments: getAttachmentLogSummary(nextAttachments),
        model: effectiveSelectedModel || "",
        surface: "new_chat",
        workspaceId: workspace?.id || "",
      });
    } catch (readError) {
      setError(readError?.message || "Unable to attach image.");
      logBigViewSyncDiagnosticEvent("bigview.image.add_error", {
        agentId: activeAgentId,
        fileCount: files.length,
        message: readError?.message || String(readError || ""),
        model: effectiveSelectedModel || "",
        surface: "new_chat",
        workspaceId: workspace?.id || "",
      });
    }
  };

  const handleComposerPaste = (event) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    const clipboardText = String(event.clipboardData?.getData?.("text/plain") || "");
    logBigViewSyncDiagnosticEvent("bigview.text.paste_observed", {
      agentId: activeAgentId,
      clipboardTypes: Array.from(event.clipboardData?.types || []),
      hasImageFiles: imageFiles.length > 0,
      model: effectiveSelectedModel || "",
      surface: "new_chat",
      text: getBigViewTextDiagnosticFields(clipboardText),
      workspaceId: workspace?.id || "",
    });
    if (!imageFiles.length) {
      return;
    }

    event.preventDefault();
    logBigViewSyncDiagnosticEvent("bigview.image.paste_start", {
      agentId: activeAgentId,
      attachmentCountBefore: attachments.length,
      fileCount: imageFiles.length,
      files: imageFiles.map(describeImageDropFile),
      model: effectiveSelectedModel || "",
      surface: "new_chat",
      workspaceId: workspace?.id || "",
    });
    addImageFiles(imageFiles);
  };

  const appendPlainTextPasteToNewChat = (clipboardText, source = "bigview_new_chat_window_paste") => {
    const pastedText = String(clipboardText || "");
    if (!pastedText || sending) {
      logBigViewSyncDiagnosticEvent("bigview.text.paste_fallback_skip", {
        agentId: activeAgentId,
        disabled: Boolean(sending),
        model: effectiveSelectedModel || "",
        reason: !pastedText ? "empty_text" : "composer_unavailable",
        source,
        surface: "new_chat",
        text: getBigViewTextDiagnosticFields(pastedText),
        workspaceId: workspace?.id || "",
      });
      return false;
    }

    const previousDraft = draft;
    const nextDraft = `${previousDraft}${pastedText}`;
    setError("");
    setDraft(nextDraft);
    window.setTimeout(() => {
      newChatInputRef.current?.focus?.();
    }, 0);
    logBigViewSyncDiagnosticEvent("bigview.text.paste_fallback_insert", {
      agentId: activeAgentId,
      model: effectiveSelectedModel || "",
      nextValueLength: nextDraft.length,
      previousValueLength: previousDraft.length,
      source,
      surface: "new_chat",
      text: getBigViewTextDiagnosticFields(pastedText),
      workspaceId: workspace?.id || "",
    });
    return true;
  };

  useEffect(() => {
    const handleWindowPasteCapture = (event) => {
      if (event.defaultPrevented) {
        return;
      }

      const root = newChatRootRef.current;
      if (!root) {
        return;
      }

      const targetElement = getPasteTargetElement(event.target);
      const activeElement = getPasteTargetElement(document.activeElement);
      const targetInsideNewChat = Boolean(targetElement && root.contains(targetElement));
      const activeInsideNewChat = Boolean(activeElement && root.contains(activeElement));
      const targetIsNewChatInput = targetElement === newChatInputRef.current;
      const targetIsEditable = isEditablePasteTarget(targetElement);
      const targetIsInteractive = isInteractivePasteTarget(targetElement);
      const clipboardText = String(event.clipboardData?.getData?.("text/plain") || "");
      const imageFiles = getClipboardImageFiles(event.clipboardData);

      if (!clipboardText && !imageFiles.length) {
        return;
      }

      logBigViewSyncDiagnosticEvent("bigview.text.window_paste_observed", {
        agentId: activeAgentId,
        activeInsideNewChat,
        clipboardTypes: Array.from(event.clipboardData?.types || []),
        hasImageFiles: imageFiles.length > 0,
        model: effectiveSelectedModel || "",
        surface: "new_chat",
        targetInsideNewChat,
        targetIsEditable,
        targetIsInteractive,
        targetIsNewChatInput,
        text: getBigViewTextDiagnosticFields(clipboardText),
        workspaceId: workspace?.id || "",
      });

      if (
        imageFiles.length
        || targetIsNewChatInput
        || targetIsEditable
        || targetIsInteractive
        || (!targetInsideNewChat && !activeInsideNewChat)
      ) {
        return;
      }

      if (appendPlainTextPasteToNewChat(clipboardText)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("paste", handleWindowPasteCapture, true);
    return () => {
      window.removeEventListener("paste", handleWindowPasteCapture, true);
    };
  }, [
    activeAgentId,
    draft,
    effectiveSelectedModel,
    sending,
    workspace?.id,
  ]);

  const handleNewChatRootClick = (event) => {
    if (isInteractivePasteTarget(event.target)) {
      return;
    }

    newChatRootRef.current?.focus?.({ preventScroll: true });
  };

  const handleComposerDragEnter = (event) => {
    logBigViewSyncDiagnosticEvent("bigview.image.drag_enter", {
      ...describeImageSupportDiagnostics({
        activeAgentId,
        activeAgentStatus,
        imageInputSupport,
        modelOptions,
        selectedModel: effectiveSelectedModel,
        selectedModelOption,
      }),
      environment: describeImageDropEnvironment(),
      hasImageTransfer: hasImageFileTransfer(event.dataTransfer),
      hasWorkspaceFileTransfer: isWorkspaceFileDragTransfer(event.dataTransfer),
      surface: "new_chat",
      transfer: describeImageDropTransfer(event.dataTransfer),
      workspaceId: workspace?.id || "",
    });
  };

  const handleComposerDragOver = (event) => {
    const activeWorkspaceFile = getActiveWorkspaceFileDrag();
    const hasImageTransfer = hasImageFileTransfer(event.dataTransfer);
    const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
    if (!hasImageTransfer && !hasWorkspaceFileTransfer && !activeWorkspaceFile) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    logBigViewSyncDiagnosticEvent("bigview.image.drag_over", {
      ...describeImageSupportDiagnostics({
        activeAgentId,
        activeAgentStatus,
        imageInputSupport,
        modelOptions,
        selectedModel: effectiveSelectedModel,
        selectedModelOption,
      }),
      environment: describeImageDropEnvironment(),
      hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
      hasImageTransfer,
      hasWorkspaceFileTransfer,
      surface: "new_chat",
      transfer: describeImageDropTransfer(event.dataTransfer),
      workspaceId: workspace?.id || "",
    });
  };

  const handleComposerDrop = (event) => {
    const hasFileTransfer = hasImageFileTransfer(event.dataTransfer);
    const imageFiles = getDroppedImageFiles(event.dataTransfer);
    logBigViewSyncDiagnosticEvent("bigview.image.drop_received", {
      ...describeImageSupportDiagnostics({
        activeAgentId,
        activeAgentStatus,
        imageInputSupport,
        modelOptions,
        selectedModel: effectiveSelectedModel,
        selectedModelOption,
      }),
      droppedImageCount: imageFiles.length,
      environment: describeImageDropEnvironment(),
      hasFileTransfer,
      hasImageTransfer: imageFiles.length > 0,
      hasWorkspaceFileTransfer: isWorkspaceFileDragTransfer(event.dataTransfer),
      surface: "new_chat",
      transfer: describeImageDropTransfer(event.dataTransfer),
      workspaceId: workspace?.id || "",
    });
    logBigViewSyncDiagnosticEvent("bigview.text.drop_observed", {
      agentId: activeAgentId,
      dataTransferTypes: Array.from(event.dataTransfer?.types || []),
      hasImageTransfer: imageFiles.length > 0,
      hasWorkspaceFileTransfer: isWorkspaceFileDragTransfer(event.dataTransfer),
      model: effectiveSelectedModel || "",
      surface: "new_chat",
      text: getBigViewTextDiagnosticFields(event.dataTransfer?.getData?.("text/plain") || ""),
      workspaceId: workspace?.id || "",
    });
    if (imageFiles.length) {
      event.preventDefault();
      event.stopPropagation();
      logBigViewSyncDiagnosticEvent("bigview.image.drop", {
        ...describeImageSupportDiagnostics({
          activeAgentId,
          activeAgentStatus,
          imageInputSupport,
          modelOptions,
          selectedModel: effectiveSelectedModel,
          selectedModelOption,
        }),
        fileCount: imageFiles.length,
        files: imageFiles.map(describeImageDropFile),
        surface: "new_chat",
        transfer: describeImageDropTransfer(event.dataTransfer),
        workspaceId: workspace?.id || "",
      });
      addImageFiles(imageFiles);
      return;
    }

    const activeWorkspaceFile = getActiveWorkspaceFileDrag();
    const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
    if (hasWorkspaceFileTransfer || activeWorkspaceFile) {
      event.preventDefault();
      event.stopPropagation();
      const workspaceFile = getDraggedWorkspaceFile(event.dataTransfer) || activeWorkspaceFile;
      const attachment = workspaceFileToComposerAttachment(workspaceFile, "bigview_new_chat_fileviewer_drop");
      logFileDragDiagnosticEvent("bigview.new_chat.drop_received", {
        attachmentCreated: Boolean(attachment),
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        relativePath: workspaceFile?.relativePath || attachment?.relativePath || "",
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: workspace?.id || "",
      });
      if (!attachment) {
        setError("Drop an image file.");
        return;
      }

      setError("");
      setAttachments((currentAttachments) => (
        currentAttachments.concat({
          ...attachment,
          source: "bigview_new_chat_fileviewer_drop",
          status: "queued",
        }).slice(0, IMAGE_ATTACHMENT_LIMIT)
      ));
      clearActiveWorkspaceFileDrag();
      return;
    }

    if (hasFileTransfer) {
      event.preventDefault();
      event.stopPropagation();
      setError("Drop an image file.");
      logBigViewSyncDiagnosticEvent("bigview.image.drop_skip", {
        ...describeImageSupportDiagnostics({
          activeAgentId,
          activeAgentStatus,
          imageInputSupport,
          modelOptions,
          selectedModel: effectiveSelectedModel,
          selectedModelOption,
        }),
        reason: "missing_image_file",
        surface: "new_chat",
        transfer: describeImageDropTransfer(event.dataTransfer),
        workspaceId: workspace?.id || "",
      });
    }
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((currentAttachments) => {
      const removedAttachment = currentAttachments.find((attachment) => attachment.id === attachmentId);
      const nextAttachments = currentAttachments.filter((attachment) => attachment.id !== attachmentId);
      logBigViewSyncDiagnosticEvent("bigview.image.remove", {
        agentId: activeAgentId,
        attachmentCountAfter: nextAttachments.length,
        attachmentCountBefore: currentAttachments.length,
        removedAttachment: getAttachmentLogSummary([removedAttachment])[0] || null,
        selectedModel: effectiveSelectedModel || "",
        surface: "new_chat",
        workspaceId: workspace?.id || "",
      });
      return nextAttachments;
    });
  };

  const submitNewChat = async () => {
    const text = draft.trim();
    if (submitDisabled) {
      return;
    }

    const previousDraft = draft;
    const previousAttachments = attachments;
    const selectedModelPayload = String(effectiveSelectedModel || getConcreteModelValue(modelOptions) || "").trim();
    const selectedModelPayloadOption = modelOptions.find((option) => option.value === selectedModelPayload)
      || selectedModelOption;
    setSending(true);
    setError("");
    try {
      const thinkingPower = getModelThinkingPowerMetadata(
        activeAgentId,
        selectedModelPayloadOption,
        selectedModelPayload,
      );
      logBigViewSyncDiagnosticEvent("bigview.submit.start", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        attachments: getAttachmentLogSummary(previousAttachments),
        draftLength: text.length,
        imageSupportReason: imageInputSupport.reason || "",
        imageSupportState: imageInputSupport.state || "",
        imageSupported: Boolean(imageInputSupport.supported),
        modelPayload: selectedModelPayload,
        selectedModel: selectedModelPayload || effectiveSelectedModel || "",
        surface: "new_chat",
        thinkingPower: thinkingPower.thinkingPower,
        thinkingPowerSource: thinkingPower.source,
        workspaceId: workspace?.id || "",
      });
      if (previousAttachments.length) {
        logBigViewSyncDiagnosticEvent("bigview.image.save_start", {
          agentId: activeAgentId,
          attachmentCount: previousAttachments.length,
          attachments: getAttachmentLogSummary(previousAttachments),
          selectedModel: selectedModelPayload || effectiveSelectedModel || "",
          surface: "new_chat",
          workspaceId: workspace?.id || "",
        });
      }
      let imageBlock = "";
      try {
        imageBlock = await saveImageAttachments(previousAttachments);
      } catch (saveError) {
        if (previousAttachments.length) {
          logBigViewSyncDiagnosticEvent("bigview.image.save_error", {
            agentId: activeAgentId,
            attachmentCount: previousAttachments.length,
            attachments: getAttachmentLogSummary(previousAttachments),
            message: saveError?.message || String(saveError || ""),
            selectedModel: selectedModelPayload || effectiveSelectedModel || "",
            surface: "new_chat",
            workspaceId: workspace?.id || "",
          });
        }
        throw saveError;
      }
      if (previousAttachments.length) {
        logBigViewSyncDiagnosticEvent("bigview.image.save_done", {
          agentId: activeAgentId,
          attachmentCount: previousAttachments.length,
          imageBlockLength: imageBlock.length,
          imageBlockPreview: imageBlock.slice(0, 240),
          selectedModel: selectedModelPayload || effectiveSelectedModel || "",
          surface: "new_chat",
          workspaceId: workspace?.id || "",
        });
      }
      const message = [text, imageBlock].filter(Boolean).join("\n\n");
      logBigViewSyncDiagnosticEvent("bigview.submit.message_prepared", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        imageBlockPresent: Boolean(imageBlock),
        messageLength: message.length,
        messageText: getBigViewTextDiagnosticFields(message),
        selectedModel: selectedModelPayload || effectiveSelectedModel || "",
        surface: "new_chat",
        workspaceId: workspace?.id || "",
      });

      await onCreateChat?.({
        agentId: activeAgentId,
        message,
        model: selectedModelPayload,
        workspace,
      });
      logBigViewSyncDiagnosticEvent("bigview.submit.done", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        selectedModel: selectedModelPayload || effectiveSelectedModel || "",
        surface: "new_chat",
        workspaceId: workspace?.id || "",
      });
      setDraft("");
      setAttachments([]);
    } catch (submitError) {
      setDraft(previousDraft);
      setAttachments(previousAttachments);
      setError(submitError?.message || "Unable to start chat.");
      logBigViewSyncDiagnosticEvent("bigview.submit.error", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        message: submitError?.message || String(submitError || ""),
        selectedModel: selectedModelPayload || effectiveSelectedModel || "",
        surface: "new_chat",
        workspaceId: workspace?.id || "",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <NewChatRoot
      aria-label="New chat"
      onClick={handleNewChatRootClick}
      ref={newChatRootRef}
      tabIndex={-1}
    >
      <NewChatCenter
        onSubmit={(event) => {
          event.preventDefault();
          submitNewChat();
        }}
      >
        <NewChatTitle>What should we work on?</NewChatTitle>
        <HiddenFileInput
          accept={IMAGE_ATTACHMENT_ACCEPT}
          multiple
          onChange={(event) => {
            addImageFiles(event.target.files);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
        <NewChatBox
          onDragEnter={handleComposerDragEnter}
          onDragOver={handleComposerDragOver}
          onDrop={handleComposerDrop}
        >
          <NewChatInput
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitNewChat();
              }
            }}
            onPaste={handleComposerPaste}
            placeholder={`Ask ${AGENT_LABELS[activeAgentId] || "an agent"} anything`}
            ref={newChatInputRef}
            rows={1}
            spellCheck="true"
            value={draft}
          />
          <NewChatToolbar>
            <NewChatControls>
              <NewChatAttachButton
                aria-label="Upload image"
                disabled={
                  sending
                    || !imageInputSupport.supported
                    || attachments.length >= IMAGE_ATTACHMENT_LIMIT
                }
                onClick={() => fileInputRef.current?.click()}
                title={
                  imageInputSupport.supported
                    ? "Upload image"
                    : imageInputSupport.reason
                }
                type="button"
              >
                <Add aria-hidden="true" />
              </NewChatAttachButton>
              <NewChatAgentMenuWrap
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setAgentMenuOpen(false);
                  }
                }}
              >
                <NewChatAgentButton
                  aria-expanded={agentMenuOpen ? "true" : "false"}
                  aria-haspopup="menu"
                  aria-label="Coding agent"
                  disabled={sending}
                  onClick={() => {
                    setModelMenuOpen(false);
                    setAgentMenuOpen((isOpen) => !isOpen);
                  }}
                  title={selectedAgentOption?.label || "Agent"}
                  type="button"
                >
                  <NewChatAgentStatusDot
                    aria-hidden="true"
                    data-ready={selectedAgentOption?.disabled ? "false" : "true"}
                  />
                  <span data-agent-label="true">{selectedAgentOption?.label || "Agent"}</span>
                  <ExpandMore aria-hidden="true" />
                </NewChatAgentButton>
                <NewChatAgentDropdown
                  aria-label="Coding agent options"
                  data-open={agentMenuOpen ? "true" : "false"}
                  role="menu"
                >
                  {agentOptions.map((option) => (
                    <NewChatAgentOption
                      data-selected={option.id === activeAgentId ? "true" : "false"}
                      disabled={option.disabled || sending}
                      key={option.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        logBigViewSyncDiagnosticEvent("bigview.agent_change.selected", {
                          agentId: option.id,
                          previousAgentId: activeAgentId,
                          surface: "new_chat",
                          workspaceId: workspace?.id || "",
                        });
                        setAgentId(option.id);
                        setAgentMenuOpen(false);
                        setModelMenuOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <NewChatAgentStatusDot
                        aria-hidden="true"
                        data-ready={option.disabled ? "false" : "true"}
                      />
                      <NewChatAgentOptionText>
                        <strong>{option.label}</strong>
                        <span data-agent-state="true">{option.disabled ? "Unavailable" : "Ready"}</span>
                      </NewChatAgentOptionText>
                    </NewChatAgentOption>
                  ))}
                </NewChatAgentDropdown>
              </NewChatAgentMenuWrap>
            </NewChatControls>
            <NewChatActions>
              <ModelMenuWrap
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setModelMenuOpen(false);
                  }
                }}
              >
                <ModelButton
                  aria-expanded={modelMenuOpen ? "true" : "false"}
                  aria-haspopup="menu"
                  disabled={sending}
                  onClick={() => setModelMenuOpen((isOpen) => !isOpen)}
                  title={selectedModelOption?.detail || "Model"}
                  type="button"
                >
                  <span>{modelButtonLabel}</span>
                  <ExpandMore aria-hidden="true" />
                </ModelButton>
                <ModelDropdown data-open={modelMenuOpen ? "true" : "false"} role="menu">
                  {modelOptions.map((option) => (
                    <ModelOption
                      data-selected={option.value === effectiveSelectedModel ? "true" : "false"}
                      key={option.value || option.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        const thinkingPower = getModelThinkingPowerMetadata(activeAgentId, option, option.value);
                        logBigViewSyncDiagnosticEvent("bigview.model_change.selected", {
                          agentId: activeAgentId,
                          model: option.value || "",
                          modelLabel: option.label || "",
                          requestSent: false,
                          reason: "new_chat_model_selection_only",
                          surface: "new_chat",
                          thinkingPower: thinkingPower.thinkingPower,
                          thinkingPowerSource: thinkingPower.source,
                          workspaceId: workspace?.id || "",
                        });
                        setSelectedModel(option.value);
                        setModelMenuOpen(false);
                      }}
                      role="menuitem"
                      title={option.detail}
                      type="button"
                    >
                      <strong>{option.label}</strong>
                      <span>{option.detail}</span>
                    </ModelOption>
                  ))}
                </ModelDropdown>
              </ModelMenuWrap>
              <NewChatSendButton
                aria-label="Start chat"
                disabled={submitDisabled}
                title="Start chat"
                type="submit"
              >
                <ArrowUpward aria-hidden="true" />
              </NewChatSendButton>
            </NewChatActions>
          </NewChatToolbar>
        </NewChatBox>
        <NewChatFooter>
          <NewChatAttachmentStrip>
            {attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} title={attachment.name}>
                <span>{attachment.name}</span>
                <button
                  aria-label={`Remove ${attachment.name}`}
                  disabled={sending}
                  onClick={() => removeAttachment(attachment.id)}
                  title="Remove image"
                  type="button"
                >
                  <Close aria-hidden="true" />
                </button>
              </AttachmentChip>
            ))}
          </NewChatAttachmentStrip>
          {error ? <NewChatError>{error}</NewChatError> : null}
        </NewChatFooter>
      </NewChatCenter>
    </NewChatRoot>
  );
}

function cleanFileReference(value) {
  return String(value || "")
    .trim()
    .replace(/^\.\//, "")
    .replace(/^["'`(]+|["'`).,;:]+$/g, "")
    .replace(/\\/g, "/")
    .replace(/:\d+$/, "");
}

function openWorkspaceFile(workspace, filePath, options = {}) {
  const relativePath = cleanFileReference(filePath);
  if (!relativePath || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(WORKSPACE_FILE_OPEN_EVENT, {
    detail: {
      ...options,
      relativePath,
      workspaceId: workspace?.id || "",
    },
  }));
}

function renderPlainMessageSegment(segment, keyPrefix, workspace) {
  const parts = [];
  let lastIndex = 0;

  segment.replace(FILE_TOKEN_PATTERN, (match, _token, offset) => {
    if (offset > lastIndex) {
      parts.push(segment.slice(lastIndex, offset));
    }

    const filePath = cleanFileReference(match);
    parts.push(
      <MessageFileLink
        key={`${keyPrefix}-file-${offset}`}
        onClick={() => openWorkspaceFile(workspace, filePath)}
        title={filePath}
        type="button"
      >
        {match}
      </MessageFileLink>,
    );
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < segment.length) {
    parts.push(segment.slice(lastIndex));
  }

  return parts.map((part, index) => (
    typeof part === "string" ? <span key={`${keyPrefix}-text-${index}`}>{part}</span> : part
  ));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getMarkdownCodeLanguage(className) {
  const match = String(className || "").match(/(?:^|\s)language-([A-Za-z0-9_-]+)/);
  const language = String(match?.[1] || "").trim().toLowerCase();
  return PRISM_LANGUAGE_ALIASES.get(language) || language;
}

function getHighlightedMarkdownCode(content, language) {
  const grammar = Prism.languages[language];
  if (!grammar) {
    return escapeHtml(content);
  }

  try {
    return Prism.highlight(content || " ", grammar, language);
  } catch {
    return escapeHtml(content);
  }
}

function decodeMarkdownHref(value) {
  const href = String(value || "").trim();
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function hasMarkdownLinkProtocol(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || "").trim());
}

function isExternalMarkdownLink(value) {
  return /^(?:https?:|mailto:|tel:)/i.test(String(value || "").trim());
}

function getSafeMarkdownHref(value) {
  const target = String(value || "").trim();
  if (!target) {
    return undefined;
  }

  if (target.startsWith("#") || isExternalMarkdownLink(target) || !hasMarkdownLinkProtocol(target)) {
    return target;
  }

  return undefined;
}

function openMarkdownLink(event, href, workspace) {
  const target = String(href || "").trim();
  if (!target || target.startsWith("#")) {
    return;
  }

  event.preventDefault();
  if (isExternalMarkdownLink(target)) {
    openUrl(target).catch(() => {
      if (typeof window !== "undefined") {
        window.open(target, "_blank", "noopener,noreferrer");
      }
    });
    return;
  }

  if (hasMarkdownLinkProtocol(target)) {
    return;
  }

  openWorkspaceFile(workspace, decodeMarkdownHref(target));
}

function renderMarkdownChildrenWithFileLinks(children, workspace, keyPrefix) {
  return Children.toArray(children).flatMap((child, index) => {
    if (typeof child === "string") {
      return renderPlainMessageSegment(child, `${keyPrefix}-${index}`, workspace);
    }

    return child;
  });
}

function createAssistantMarkdownComponents(workspace) {
  const renderTextChildren = (children, keyPrefix) => (
    renderMarkdownChildrenWithFileLinks(children, workspace, keyPrefix)
  );

  return {
    a({ node: _node, children, href, ...props }) {
      const safeHref = getSafeMarkdownHref(href);
      return (
        <a
          {...props}
          href={safeHref}
          onClick={(event) => openMarkdownLink(event, safeHref, workspace)}
          rel={isExternalMarkdownLink(safeHref) ? "noreferrer" : undefined}
          target={isExternalMarkdownLink(safeHref) ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    code({ node: _node, children, className, ...props }) {
      const code = String(children || "").replace(/\n$/, "");
      const language = getMarkdownCodeLanguage(className);
      if (!language) {
        return (
          <code {...props} className={className}>
            {children}
          </code>
        );
      }

      return (
        <code
          {...props}
          className={className}
          data-language={language}
          dangerouslySetInnerHTML={{
            __html: getHighlightedMarkdownCode(code, language),
          }}
        />
      );
    },
    del({ node: _node, children, ...props }) {
      return <del {...props}>{renderTextChildren(children, "del")}</del>;
    },
    em({ node: _node, children, ...props }) {
      return <em {...props}>{renderTextChildren(children, "em")}</em>;
    },
    h1({ node: _node, children, ...props }) {
      return <h1 {...props}>{renderTextChildren(children, "h1")}</h1>;
    },
    h2({ node: _node, children, ...props }) {
      return <h2 {...props}>{renderTextChildren(children, "h2")}</h2>;
    },
    h3({ node: _node, children, ...props }) {
      return <h3 {...props}>{renderTextChildren(children, "h3")}</h3>;
    },
    h4({ node: _node, children, ...props }) {
      return <h4 {...props}>{renderTextChildren(children, "h4")}</h4>;
    },
    li({ node: _node, children, ...props }) {
      return <li {...props}>{renderTextChildren(children, "li")}</li>;
    },
    p({ node: _node, children, ...props }) {
      return <p {...props}>{renderTextChildren(children, "p")}</p>;
    },
    strong({ node: _node, children, ...props }) {
      return <strong {...props}>{renderTextChildren(children, "strong")}</strong>;
    },
    table({ node: _node, children, ...props }) {
      return (
        <div className="thread-markdown-table-wrap">
          <table {...props}>{children}</table>
        </div>
      );
    },
    td({ node: _node, children, ...props }) {
      return <td {...props}>{renderTextChildren(children, "td")}</td>;
    },
    th({ node: _node, children, ...props }) {
      return <th {...props}>{renderTextChildren(children, "th")}</th>;
    },
  };
}

function AssistantMarkdownContent({ message, workspace }) {
  const text = String(message?.text || "");
  const components = useMemo(() => createAssistantMarkdownComponents(workspace), [workspace]);

  return (
    <AssistantMarkdownBody>
      <ReactMarkdown components={components} remarkPlugins={MARKDOWN_REMARK_PLUGINS}>
        {text}
      </ReactMarkdown>
    </AssistantMarkdownBody>
  );
}

function MessageTextContent({ message, workspace }) {
  const text = String(message?.text || "");
  const segments = text.split(/(`[^`]+`)/g);

  return (
    <>
      {segments.map((segment, index) => {
        if (!segment) {
          return null;
        }

        if (segment.startsWith("`") && segment.endsWith("`") && segment.length > 1) {
          return (
            <MessageInlineCode key={`code-${index}`}>
              {segment.slice(1, -1)}
            </MessageInlineCode>
          );
        }

        return renderPlainMessageSegment(segment, `segment-${index}`, workspace);
      })}
    </>
  );
}

function threadLatestTurnState(thread) {
  return String(thread?.latestTurn?.state || "").trim().toLowerCase();
}

function getThreadDiffTurnState(thread, groundTruth) {
  return String(
    groundTruth?.effectiveLatestTurnState
      || groundTruth?.latestTurnState
      || thread?.latestTurn?.state
      || "",
  ).trim().toLowerCase();
}

function threadDiffTurnIsLive(thread, groundTruth) {
  const state = getThreadDiffTurnState(thread, groundTruth);
  return THREAD_DIFF_LIVE_STATES.has(state)
    || thread?.activityStatus === "thinking"
    || thread?.activityStatus === "working";
}

function threadDiffTurnIsTerminal(thread, groundTruth, hasAssistantBlock) {
  const state = getThreadDiffTurnState(thread, groundTruth);
  return THREAD_DIFF_TERMINAL_STATES.has(state)
    || (Boolean(hasAssistantBlock) && !threadDiffTurnIsLive(thread, groundTruth));
}

function safeThreadDiffStoragePart(value) {
  return encodeURIComponent(String(value || "").trim() || "unknown");
}

function getThreadDiffStorageKey(workspaceId, threadId, turnId) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  const safeTurnId = String(turnId || "").trim();
  if (!safeWorkspaceId || !safeThreadId || !safeTurnId) {
    return "";
  }
  return [
    THREAD_DIFF_SUMMARY_STORAGE_PREFIX,
    safeThreadDiffStoragePart(safeWorkspaceId),
    safeThreadDiffStoragePart(safeThreadId),
    safeThreadDiffStoragePart(safeTurnId),
  ].join(":");
}

function readStoredThreadDiffSummary(key) {
  if (!key || typeof window === "undefined") {
    return null;
  }
  try {
    return normalizeThreadDiffSummary(JSON.parse(window.localStorage.getItem(key) || "null"));
  } catch {
    return null;
  }
}

function writeStoredThreadDiffSummary(key, summary) {
  if (!key || typeof window === "undefined") {
    return;
  }
  try {
    if (summary) {
      window.localStorage.setItem(key, JSON.stringify(summary));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage is best-effort; the live thread state remains authoritative.
  }
}

function getThreadDiffWorktreePath(thread, providerBinding, liveTerminal) {
  return String(
    thread?.coordination?.worktreePath
      || providerBinding?.coordination?.worktreePath
      || liveTerminal?.worktreePath
      || "",
  ).trim();
}

function isThreadDiffWorktreePath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  return normalized.includes("/.agents/worktrees/");
}

function getThreadDiffTurnId(thread, latestMessage, latestAssistantBlockId) {
  return String(
    thread?.latestTurn?.turnId
      || latestMessage?.turnId
      || latestAssistantBlockId
      || "",
  ).trim();
}

function unwrapThreadDiffApiResult(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value.ok === false) {
    const error = value.error || {};
    throw new Error(error.message || error.code || "Diff summary request failed.");
  }
  return value.data || value;
}

function getNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeThreadDiffFile(file) {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return null;
  }
  const path = String(file.path || "").replace(/\\/g, "/").trim();
  if (!path) {
    return null;
  }
  return {
    additions: getNumberOrNull(file.additions ?? file.linesAdded ?? file.lines_added),
    binary: file.binary === true,
    changeKind: String(file.changeKind || file.change_kind || "modified").trim() || "modified",
    countStatus: String(file.countStatus || file.count_status || "").trim(),
    deletions: getNumberOrNull(file.deletions ?? file.linesRemoved ?? file.lines_removed),
    modifiedMs: Number(file.modifiedMs || file.modified_ms || 0) || 0,
    name: String(file.name || path.split("/").filter(Boolean).pop() || path).trim(),
    path,
    untracked: file.untracked === true,
  };
}

function normalizeThreadDiffSummary(value) {
  const data = unwrapThreadDiffApiResult(value);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const files = (Array.isArray(data.files) ? data.files : [])
    .map(normalizeThreadDiffFile)
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));
  const latestFile = normalizeThreadDiffFile(data.latestFile || data.latest_file)
    || [...files].sort((left, right) => (
      (right.modifiedMs || 0) - (left.modifiedMs || 0)
      || left.path.localeCompare(right.path)
    ))[0]
    || null;
  const fileCount = Number(data.fileCount ?? data.file_count ?? files.length) || files.length;

  return {
    additions: Number(data.additions || 0) || 0,
    baseSha: String(data.baseSha || data.base_sha || "").trim(),
    capturedAt: String(data.capturedAt || data.captured_at || "").trim(),
    deletions: Number(data.deletions || 0) || 0,
    fileCount,
    files,
    latestFile,
    partial: data.partial === true,
    summaryKey: String(data.summaryKey || data.summary_key || "").trim(),
    turnId: String(data.turnId || data.turn_id || "").trim(),
    undoStatus: String(data.undoStatus || data.undo_status || "").trim(),
    undoneAt: String(data.undoneAt || data.undone_at || "").trim(),
    worktreeId: String(data.worktreeId || data.worktree_id || "").trim(),
    worktreePath: String(data.worktreePath || data.worktree_path || "").trim(),
  };
}

function getAssistantBlockDiffTurnId(item) {
  return String(item?.turnId || item?.id || "").trim();
}

function threadDiffSummaryEntriesEqual(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return left.summaryKey === right.summaryKey
    && left.undoStatus === right.undoStatus
    && left.fileCount === right.fileCount
    && left.turnId === right.turnId;
}

function threadDiffSummaryMapEqual(left, right) {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => threadDiffSummaryEntriesEqual(left?.[key], right?.[key]));
}

function setThreadDiffSummaryInMap(current, turnId, summary) {
  const safeTurnId = String(turnId || "").trim();
  if (!safeTurnId) {
    return current;
  }

  const nextSummary = summary?.fileCount ? {
    ...summary,
    turnId: summary.turnId || safeTurnId,
  } : null;

  if (threadDiffSummaryEntriesEqual(current?.[safeTurnId], nextSummary)) {
    return current;
  }

  const next = { ...(current || {}) };
  if (nextSummary) {
    next[safeTurnId] = nextSummary;
  } else {
    delete next[safeTurnId];
  }
  return next;
}

function formatThreadDiffFileCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  return `${safeCount} ${safeCount === 1 ? "file" : "files"} changed`;
}

function formatThreadDiffCount(value, prefix) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${prefix}?`;
  }
  return `${prefix}${number}`;
}

function getThreadDiffReviewPath(summary, file) {
  return file?.path || summary?.latestFile?.path || summary?.files?.[0]?.path || "";
}

function messagesContainTurnWork(messages, turnId) {
  const safeTurnId = String(turnId || "").trim();
  return (Array.isArray(messages) ? messages : []).some((message) => (
    (!safeTurnId || message?.turnId === safeTurnId)
    && ["assistant", "activity"].includes(message?.role)
    && String(message?.text || "").trim()
  ));
}

function isSlashCommandPrompt(value) {
  return String(value || "").trimStart().startsWith("/");
}

function getLatestTurnUserMessage(messages, turnId) {
  const safeTurnId = String(turnId || "").trim();
  return [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => (
    message?.role === "user"
    && (!safeTurnId || message?.turnId === safeTurnId)
  )) || null;
}

function buildActivityItems(thread, messages = [], groundTruth = null) {
  if (!thread) {
    return [];
  }

  const items = [];
  const latestTurn = thread.latestTurn || null;
  const rawTurnState = groundTruth?.effectiveLatestTurnState
    || groundTruth?.latestTurnState
    || threadLatestTurnState(thread);
  const isThinking = groundTruth
    ? threadLooksEffectivelyThinking(groundTruth)
    : rawTurnState === "running" || thread.activityStatus === "thinking";
  const latestTurnUserMessage = getLatestTurnUserMessage(messages, latestTurn?.turnId);
  const latestTurnIsSlashCommand = isSlashCommandPrompt(latestTurnUserMessage?.text);

  if (latestTurnIsSlashCommand) {
    return items;
  }

  if (isThinking && rawTurnState === "running") {
    items.push({
      id: `turn-${latestTurn?.turnId || "latest"}-running`,
      live: true,
      text: messagesContainTurnWork(messages, latestTurn?.turnId) ? "Working" : "Thinking",
    });
  } else if (isThinking) {
    items.push({ id: "thinking", live: true, text: "Thinking" });
  } else if (thread.status === "starting") {
    items.push({ id: "starting", live: true, text: "Starting agent" });
  } else if (thread.status === "closed" || thread.status === "exited") {
    items.push({ id: "closed", live: false, text: "Terminal exited" });
  } else if (thread.status === "error") {
    items.push({ id: "error", live: false, text: "Terminal error" });
  }

  return items;
}

function getMessageDiagnosticSummary(message) {
  if (!message) {
    return null;
  }

  return {
    id: String(message.id || ""),
    kind: String(message.kind || ""),
    role: String(message.role || ""),
    status: String(message.status || ""),
    text: getBigViewTextDiagnosticFields(message.text || "", { previewLength: 96 }),
    timestamp: String(message.timestamp || message.createdAt || message.updatedAt || ""),
    title: String(message.title || ""),
    turnId: String(message.turnId || ""),
  };
}

function getTerminalDiagnosticSummary(terminal) {
  if (!terminal) {
    return null;
  }

  return {
    inputReady: terminal.inputReady === true,
    inputReadyAt: String(terminal.inputReadyAt || ""),
    inputReadyConfidence: String(terminal.inputReadyConfidence || ""),
    instanceId: terminal.instanceId ?? "",
    paneId: String(terminal.paneId || ""),
    status: String(terminal.status || ""),
    terminalIndex: terminal.terminalIndex ?? "",
    threadId: String(terminal.threadId || ""),
    workspaceId: String(terminal.workspaceId || ""),
  };
}

function getProviderBindingDiagnosticSummary(binding) {
  if (!binding) {
    return null;
  }

  return {
    activityStatus: String(binding.activityStatus || ""),
    inputReady: binding.inputReady === true,
    inputReadyAt: String(binding.inputReadyAt || ""),
    modelId: String(
      binding.modelId
        || binding.model
        || binding.activeModel
        || binding.nativeModel
        || binding.selectedModel
        || binding.configuredModel
        || "",
    ),
    nativeSessionIdPresent: Boolean(binding.nativeSessionId),
    terminalBinding: getTerminalDiagnosticSummary(binding.terminalBinding),
  };
}

function getActivityDiagnosticSummary(item) {
  if (!item) {
    return null;
  }

  return {
    id: String(item.id || ""),
    live: item.live === true,
    text: String(item.text || ""),
  };
}

function getThreadDetailRenderDiagnosticSnapshot({
  activeAgentId,
  activeLiveTerminal,
  activeProviderBinding,
  activityItems,
  effectiveLiveTerminal,
  latestActivity,
  messages,
  thread,
  threadGroundTruth,
  transcriptItems,
  workspace,
  workspaceThreadEntry,
}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeActivityItems = Array.isArray(activityItems) ? activityItems : [];
  const latestTurn = thread?.latestTurn || null;
  const providerBindings = thread?.providerBindings
    && typeof thread.providerBindings === "object"
    && !Array.isArray(thread.providerBindings)
    ? thread.providerBindings
    : {};
  const terminalCount = workspaceThreadEntry?.terminals
    && typeof workspaceThreadEntry.terminals === "object"
    ? Object.keys(workspaceThreadEntry.terminals).length
    : 0;
  const latestMessage = safeMessages[safeMessages.length - 1] || null;
  const liveActivityVisible = safeActivityItems.some((item) => (
    item?.live === true
      && /thinking|working|starting/i.test(String(item?.text || ""))
  ));

  return {
    activeAgentId: String(activeAgentId || ""),
    activeLiveTerminal: getTerminalDiagnosticSummary(activeLiveTerminal),
    activeProviderBinding: getProviderBindingDiagnosticSummary(activeProviderBinding),
    activityItemCount: safeActivityItems.length,
    activityItems: safeActivityItems.map(getActivityDiagnosticSummary),
    effectiveLiveTerminal: getTerminalDiagnosticSummary(effectiveLiveTerminal),
    filteredMessageCount: safeMessages.length,
    groundTruth: threadGroundTruth ? {
      activityStatus: String(threadGroundTruth.activityStatus || ""),
      agentInputReady: threadGroundTruth.agentInputReady === true,
      completedTurnLooksSendable: threadGroundTruth.completedTurnLooksSendable === true,
      effectiveActivityStatus: String(threadGroundTruth.effectiveActivityStatus || ""),
      effectiveLatestTurnState: String(threadGroundTruth.effectiveLatestTurnState || ""),
      hasPendingPrompt: threadGroundTruth.hasPendingPrompt === true,
      inputReadyAt: String(threadGroundTruth.inputReadyAt || ""),
      inputReadyIsFreshForTurn: threadGroundTruth.inputReadyIsFreshForTurn === true,
      latestTurnState: String(threadGroundTruth.latestTurnState || ""),
      recordedAgentInputReady: threadGroundTruth.recordedAgentInputReady === true,
      runningTurnLooksIdle: threadGroundTruth.runningTurnLooksIdle === true,
      terminalGroundTruthStatus: String(threadGroundTruth.terminalGroundTruthStatus || ""),
      terminalLooksActive: threadGroundTruth.terminalLooksActive === true,
      terminalStatus: String(threadGroundTruth.terminalStatus || ""),
      turnStartedAt: String(threadGroundTruth.turnStartedAt || ""),
    } : null,
    latestActivity: getActivityDiagnosticSummary(latestActivity),
    latestMessage: getMessageDiagnosticSummary(latestMessage),
    latestTurn: latestTurn ? {
      completedAt: String(latestTurn.completedAt || ""),
      error: String(latestTurn.error || ""),
      messageId: String(latestTurn.messageId || ""),
      requestedAt: String(latestTurn.requestedAt || ""),
      startedAt: String(latestTurn.startedAt || ""),
      state: String(latestTurn.state || ""),
      turnId: String(latestTurn.turnId || ""),
      updatedAt: String(latestTurn.updatedAt || ""),
    } : null,
    liveActivityVisible,
    materialized: thread?.materialized === true,
    messageCount: Number(thread?.messageCount || 0),
    pendingPromptPresent: Boolean(thread?.pendingPrompt),
    projectionEventCount: Array.isArray(thread?.projectionEvents) ? thread.projectionEvents.length : 0,
    providerBindingKeys: Object.keys(providerBindings),
    rawActivityStatus: String(thread?.activityStatus || ""),
    rawStatus: String(thread?.status || ""),
    rawTurnState: threadLatestTurnState(thread),
    terminalCount,
    threadId: String(thread?.id || ""),
    transcriptItemCount: Array.isArray(transcriptItems) ? transcriptItems.length : 0,
    workspaceId: String(workspace?.id || thread?.workspaceId || ""),
  };
}

function getThreadDetailRenderDiagnosticSignature(snapshot) {
  return JSON.stringify({
    activityItems: snapshot?.activityItems || [],
    activeTerminal: snapshot?.activeLiveTerminal,
    effectiveActivityStatus: snapshot?.groundTruth?.effectiveActivityStatus || "",
    effectiveTerminal: snapshot?.effectiveLiveTerminal,
    groundTruthStatus: snapshot?.groundTruth?.terminalGroundTruthStatus || "",
    latestActivity: snapshot?.latestActivity,
    latestMessageHash: snapshot?.latestMessage?.text?.textHash || "",
    latestMessageId: snapshot?.latestMessage?.id || "",
    latestTurnState: snapshot?.latestTurn?.state || "",
    liveActivityVisible: snapshot?.liveActivityVisible === true,
    rawActivityStatus: snapshot?.rawActivityStatus || "",
    rawStatus: snapshot?.rawStatus || "",
    threadId: snapshot?.threadId || "",
    workspaceId: snapshot?.workspaceId || "",
  });
}

function getToolCallLabel(message) {
  const title = String(message?.title || "").trim();
  const genericTitles = new Set(["activity", "tool call", "tool output"]);
  if (title && !genericTitles.has(title.toLowerCase())) {
    return title;
  }

  if (String(message?.kind || "").toLowerCase() === "image_generation") {
    return "Generated image";
  }

  if (String(message?.kind || "").toLowerCase() === "tool_output") {
    return "Command run complete";
  }

  if (String(message?.kind || "").toLowerCase() === "tool_call") {
    return "Command run started";
  }

  const firstLine = String(message?.text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || title || "Tool call";
}

function isActivityMessage(message) {
  return message?.role === "activity";
}

function getMessageTurnId(message) {
  return String(message?.turnId || message?.turn_id || "").trim();
}

function buildTranscriptItems(messages) {
  const items = [];
  let assistantBlock = null;
  let activityGroup = [];

  const flushActivityGroup = () => {
    if (!activityGroup.length) {
      return;
    }

    const firstMessage = activityGroup[0];
    const lastMessage = activityGroup[activityGroup.length - 1];
    assistantBlock?.items.push({
      id: `activity-group-${firstMessage?.id || items.length}-${lastMessage?.id || activityGroup.length}`,
      messages: activityGroup,
      turnId: getMessageTurnId(firstMessage) || getMessageTurnId(lastMessage),
      type: "activity-group",
    });
    activityGroup = [];
  };

  const ensureAssistantBlock = (message, fallbackIndex) => {
    const turnId = getMessageTurnId(message);
    if (assistantBlock?.turnId && turnId && assistantBlock.turnId !== turnId) {
      flushAssistantBlock();
    }

    if (!assistantBlock) {
      assistantBlock = {
        id: `assistant-block-${message?.id || fallbackIndex || items.length}`,
        items: [],
        turnId,
        type: "assistant-block",
      };
    } else if (!assistantBlock.turnId && turnId) {
      assistantBlock.turnId = turnId;
    }

    return assistantBlock;
  };

  const flushAssistantBlock = () => {
    if (!assistantBlock) {
      return;
    }

    flushActivityGroup();
    if (assistantBlock.items.length) {
      items.push(assistantBlock);
    }
    assistantBlock = null;
  };

  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    if (isActivityMessage(message)) {
      ensureAssistantBlock(message, index);
      activityGroup.push(message);
      return;
    }

    if (message?.role === "assistant") {
      const block = ensureAssistantBlock(message, index);
      flushActivityGroup();
      block.items.push({
        id: message?.id || `message-${index}`,
        message,
        turnId: getMessageTurnId(message),
        type: "message",
      });
      return;
    }

    flushAssistantBlock();
    items.push({
      id: message?.id || `message-${index}`,
      message,
      type: "message",
    });
  });

  flushAssistantBlock();
  return items;
}

function getMessageCopyText(message) {
  const text = String(message?.text || "");
  const artifactLines = getArtifactCopyLines(message);
  return [
    text || String(message?.title || "").trim(),
    artifactLines.length ? artifactLines.join("\n") : "",
  ].filter(Boolean).join("\n");
}

function getActivityCopyText(message) {
  const label = getToolCallLabel(message);
  const status = getActivityStatusLabel(message);
  const body = String(message?.text || "").trim();
  const artifactLines = getArtifactCopyLines(message);
  return [
    [label, status ? `(${status})` : ""].filter(Boolean).join(" "),
    body,
    artifactLines.length ? artifactLines.join("\n") : "",
  ].filter(Boolean).join("\n");
}

function getAssistantBlockCopyText(items) {
  const copyParts = [];

  (Array.isArray(items) ? items : []).forEach((item) => {
    if (item?.type === "message" && item?.message?.role === "assistant") {
      const text = getMessageCopyText(item.message);
      if (text) {
        copyParts.push(text);
      }
      return;
    }

    if (item?.type === "activity-group") {
      const activityParts = (Array.isArray(item.messages) ? item.messages : []).map((message) => {
        const text = getActivityCopyText(message);
        const label = String(message?.kind || "").toLowerCase() === "image_generation"
          ? "Image generation"
          : "Tool call";
        return text ? `${label}:\n${text}` : "";
      }).filter(Boolean);

      if (activityParts.length) {
        copyParts.push(activityParts.join("\n\n"));
      }
    }
  });

  return copyParts.join("\n\n").trim();
}

async function copyTextToClipboard(text) {
  const safeText = String(text || "");
  if (!safeText || typeof window === "undefined") {
    return false;
  }

  if (window.navigator?.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(safeText);
    return true;
  }

  const textarea = window.document.createElement("textarea");
  textarea.value = safeText;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  window.document.body.appendChild(textarea);
  textarea.select();

  try {
    return window.document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function cleanArtifactText(value) {
  return String(value || "").trim();
}

function getArtifactReference(artifact) {
  return cleanArtifactText(
    artifact?.url
      || artifact?.uri
      || artifact?.fileUrl
      || artifact?.file_url
      || artifact?.imageUrl
      || artifact?.image_url
      || artifact?.path
      || artifact?.filePath
      || artifact?.file_path
      || artifact?.localPath
      || artifact?.local_path,
  );
}

function normalizeRenderableArtifacts(artifacts) {
  const seen = new Set();
  return (Array.isArray(artifacts) ? artifacts : [])
    .map((artifact) => {
      if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
        return null;
      }
      const reference = getArtifactReference(artifact);
      if (!reference) {
        return null;
      }
      const normalized = {
        kind: cleanArtifactText(artifact.kind || artifact.type).toLowerCase(),
        mimeType: cleanArtifactText(artifact.mimeType || artifact.mime_type || artifact.contentType || artifact.content_type),
        name: cleanArtifactText(artifact.name || artifact.filename || artifact.fileName || artifact.file_name),
        path: cleanArtifactText(artifact.path || artifact.filePath || artifact.file_path || artifact.localPath || artifact.local_path),
        prompt: cleanArtifactText(artifact.prompt),
        reference,
        title: cleanArtifactText(artifact.title || artifact.label),
        url: cleanArtifactText(artifact.url || artifact.uri || artifact.fileUrl || artifact.file_url || artifact.imageUrl || artifact.image_url),
      };
      const key = normalized.url || normalized.path || normalized.reference;
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      return normalized;
    })
    .filter(Boolean);
}

function artifactExtension(reference) {
  const cleanReference = cleanArtifactText(reference).split(/[?#]/)[0].toLowerCase();
  const match = cleanReference.match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function isRenderableImageArtifact(artifact) {
  const mimeType = cleanArtifactText(artifact?.mimeType || artifact?.mime_type).toLowerCase();
  if (mimeType.startsWith("image/")) {
    return true;
  }
  if (cleanArtifactText(artifact?.kind || artifact?.type).toLowerCase() === "image") {
    return true;
  }
  return ["svg", "png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(
    artifactExtension(getArtifactReference(artifact)),
  );
}

function fileUrlToPath(reference) {
  const value = cleanArtifactText(reference);
  if (!value.startsWith("file://")) {
    return "";
  }
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return decodeURIComponent(value.replace(/^file:\/\//i, ""));
  }
}

function artifactDisplaySrc(artifact) {
  const reference = getArtifactReference(artifact);
  if (!reference) {
    return "";
  }
  if (/^(https?:|data:|blob:)/i.test(reference)) {
    return reference;
  }
  if (/^file:\/\//i.test(reference)) {
    const path = fileUrlToPath(reference);
    return path ? convertFileSrc(path) : reference;
  }
  const path = cleanArtifactText(artifact?.path || artifact?.filePath || artifact?.file_path || reference);
  if (path.startsWith("/") || path.startsWith("~/")) {
    return convertFileSrc(path);
  }
  return reference;
}

function artifactOpenTarget(artifact) {
  const reference = getArtifactReference(artifact);
  if (!reference) {
    return "";
  }
  if (/^(https?:|file:|data:|blob:)/i.test(reference)) {
    return reference;
  }
  const path = cleanArtifactText(artifact?.path || artifact?.filePath || artifact?.file_path || reference);
  if (path.startsWith("/") || path.startsWith("~/")) {
    return `file://${path}`;
  }
  return reference;
}

function artifactCopyText(artifact) {
  return [
    cleanArtifactText(artifact?.title || artifact?.name),
    cleanArtifactText(artifact?.prompt),
    getArtifactReference(artifact),
  ].filter(Boolean).join("\n");
}

function artifactDisplayTitle(artifact, index) {
  return cleanArtifactText(artifact?.title || artifact?.name)
    || (isRenderableImageArtifact(artifact) ? `Image ${index + 1}` : `Artifact ${index + 1}`);
}

function artifactDisplaySubtitle(artifact) {
  return cleanArtifactText(artifact?.prompt || artifact?.mimeType || artifact?.mime_type)
    || getArtifactReference(artifact);
}

function getMessageArtifacts(message) {
  return normalizeRenderableArtifacts(message?.artifacts || message?.attachments);
}

function getArtifactCopyLines(message) {
  return getMessageArtifacts(message)
    .map((artifact, index) => {
      const title = artifactDisplayTitle(artifact, index);
      const reference = getArtifactReference(artifact);
      return [title, reference].filter(Boolean).join(": ");
    })
    .filter(Boolean);
}

function MessageArtifactList({ artifacts }) {
  const items = normalizeRenderableArtifacts(artifacts);
  const [copiedKey, setCopiedKey] = useState("");

  if (!items.length) {
    return null;
  }

  return (
    <TranscriptArtifactList>
      {items.map((artifact, index) => {
        const key = getArtifactReference(artifact) || `artifact-${index}`;
        const title = artifactDisplayTitle(artifact, index);
        const subtitle = artifactDisplaySubtitle(artifact);
        const openTarget = artifactOpenTarget(artifact);
        const imageSrc = isRenderableImageArtifact(artifact) ? artifactDisplaySrc(artifact) : "";
        return (
          <TranscriptArtifactCard key={key}>
            {imageSrc ? (
              <TranscriptArtifactPreviewButton
                aria-label={`Open ${title}`}
                onClick={() => {
                  if (openTarget) {
                    openUrl(openTarget);
                  }
                }}
                title={openTarget || title}
                type="button"
              >
                <TranscriptArtifactImage alt={title} src={imageSrc} />
              </TranscriptArtifactPreviewButton>
            ) : (
              <TranscriptArtifactFallback title={openTarget || title}>
                {openTarget || title}
              </TranscriptArtifactFallback>
            )}
            <TranscriptArtifactMeta>
              <TranscriptArtifactText>
                <TranscriptArtifactTitle title={title}>{title}</TranscriptArtifactTitle>
                {subtitle ? (
                  <TranscriptArtifactSubtitle title={subtitle}>{subtitle}</TranscriptArtifactSubtitle>
                ) : null}
              </TranscriptArtifactText>
              <TranscriptArtifactActions>
                {openTarget ? (
                  <TranscriptArtifactActionButton
                    aria-label={`Open ${title}`}
                    onClick={() => openUrl(openTarget)}
                    title="Open"
                    type="button"
                  >
                    <OpenInNew aria-hidden="true" />
                  </TranscriptArtifactActionButton>
                ) : null}
                <TranscriptArtifactActionButton
                  aria-label={copiedKey === key ? "Copied" : `Copy ${title}`}
                  data-copied={copiedKey === key ? "true" : "false"}
                  onClick={async () => {
                    const copied = await copyTextToClipboard(artifactCopyText(artifact));
                    if (copied) {
                      setCopiedKey(key);
                      window.setTimeout(() => setCopiedKey(""), 1400);
                    }
                  }}
                  title={copiedKey === key ? "Copied" : "Copy"}
                  type="button"
                >
                  {copiedKey === key ? <Check aria-hidden="true" /> : <ContentCopy aria-hidden="true" />}
                </TranscriptArtifactActionButton>
              </TranscriptArtifactActions>
            </TranscriptArtifactMeta>
          </TranscriptArtifactCard>
        );
      })}
    </TranscriptArtifactList>
  );
}

function isChatProjectionMessage(message) {
  const kind = String(message?.kind || "").trim().toLowerCase();
  const source = String(message?.source || "").trim().toLowerCase();
  if (message?.role === "user" && isSlashCommandPrompt(message?.text)) {
    return false;
  }
  return kind !== "live_output" && source !== "terminal-live";
}

function getActivityStatusLabel(message) {
  return String(message?.status || "").trim();
}

function getActivityGroupStatus(messages) {
  const statuses = (Array.isArray(messages) ? messages : [])
    .map(getActivityStatusLabel)
    .filter(Boolean);
  const normalizedStatuses = new Set(statuses.map((status) => status.toLowerCase()));

  return normalizedStatuses.size === 1 ? statuses[0] : "";
}

const ACTIVITY_JSON_PARSE_MAX_CHARS = 180_000;
const ACTIVITY_JSON_EXPAND_MAX_DEPTH = 6;

function stripJsonCodeFence(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function looksLikeJsonContainer(text) {
  const trimmed = stripJsonCodeFence(text);
  if (!trimmed || trimmed.length > ACTIVITY_JSON_PARSE_MAX_CHARS) {
    return false;
  }

  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
    || (trimmed.startsWith("\"{") && trimmed.endsWith("}\""))
    || (trimmed.startsWith("\"[") && trimmed.endsWith("]\""))
  );
}

function tryParseJsonText(text) {
  const trimmed = stripJsonCodeFence(text);
  if (!looksLikeJsonContainer(trimmed)) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function expandNestedJsonStrings(value, depth = 0) {
  if (depth >= ACTIVITY_JSON_EXPAND_MAX_DEPTH) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = tryParseJsonText(value);
    return parsed == null ? value : expandNestedJsonStrings(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandNestedJsonStrings(item, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        expandNestedJsonStrings(entryValue, depth + 1),
      ]),
    );
  }

  return value;
}

function parseActivityJsonCandidate(text, prefix = "") {
  const parsed = tryParseJsonText(text);
  if (parsed == null) {
    return null;
  }

  const expanded = expandNestedJsonStrings(parsed);
  return {
    jsonText: JSON.stringify(expanded, null, 2),
    prefix: String(prefix || "").trim(),
  };
}

function parseActivityJsonBody(body) {
  const text = String(body || "").trim();
  if (!text) {
    return null;
  }

  const direct = parseActivityJsonCandidate(text);
  if (direct) {
    return direct;
  }

  const outputMatch = text.match(/\bOutput:\s*\n/i);
  if (outputMatch) {
    const candidate = text.slice(outputMatch.index + outputMatch[0].length).trim();
    const parsed = parseActivityJsonCandidate(candidate, text.slice(0, outputMatch.index + outputMatch[0].length));
    if (parsed) {
      return parsed;
    }
  }

  const jsonLineMatch = text.match(/(?:^|\n)\s*([{[])/);
  if (!jsonLineMatch || jsonLineMatch.index == null) {
    return null;
  }

  const startIndex = jsonLineMatch.index + jsonLineMatch[0].lastIndexOf(jsonLineMatch[1]);
  return parseActivityJsonCandidate(text.slice(startIndex), text.slice(0, startIndex));
}

function ActivityToolBody({ body, expanded }) {
  const parsedJson = useMemo(
    () => (expanded ? parseActivityJsonBody(body) : null),
    [body, expanded],
  );

  if (!parsedJson) {
    return <TranscriptActivityBody>{body}</TranscriptActivityBody>;
  }

  return (
    <>
      {parsedJson.prefix ? (
        <TranscriptActivityMetaBody>{parsedJson.prefix}</TranscriptActivityMetaBody>
      ) : null}
      <TranscriptActivityJsonBody
        className="language-json"
        dangerouslySetInnerHTML={{
          __html: getHighlightedMarkdownCode(parsedJson.jsonText, "json"),
        }}
      />
    </>
  );
}

function ActivityToolRow({ message }) {
  const artifacts = getMessageArtifacts(message);
  const artifactKey = artifacts.map(getArtifactReference).join("|");
  const [expanded, setExpanded] = useState(() => artifacts.length > 0);

  useEffect(() => {
    if (artifacts.length) {
      setExpanded(true);
    }
  }, [artifacts.length, artifactKey]);

  if (!message) {
    return null;
  }

  const label = getToolCallLabel(message);
  const status = String(message.status || "").trim();
  const body = String(message.text || "").trim();
  const kind = String(message.kind || "activity").trim().toLowerCase();
  const hasBody = Boolean(body);
  const hasArtifacts = artifacts.length > 0;
  const expandable = hasBody || hasArtifacts;

  return (
    <TranscriptActivityTool data-kind={kind} data-status={status || "complete"}>
      <TranscriptActivityHeader
        aria-expanded={expandable ? expanded : undefined}
        aria-label={expandable ? `${expanded ? "Collapse" : "Expand"} ${label}` : label}
        data-expanded={expanded ? "true" : "false"}
        data-nested="true"
        disabled={!expandable}
        onClick={() => {
          if (expandable) {
            setExpanded((value) => !value);
          }
        }}
        title={label}
        type="button"
      >
        <TranscriptActivityTitle title={label}>{label}</TranscriptActivityTitle>
        <TranscriptActivityToggle data-expanded={expanded ? "true" : "false"}>
          {expandable ? <ExpandMore aria-hidden="true" /> : null}
        </TranscriptActivityToggle>
      </TranscriptActivityHeader>
      {expandable ? (
        <TranscriptActivityDisclosure
          aria-hidden={expanded ? "false" : "true"}
          data-expanded={expanded ? "true" : "false"}
        >
          <TranscriptActivityDisclosureInner>
            {hasArtifacts ? <MessageArtifactList artifacts={artifacts} /> : null}
            {hasBody ? <ActivityToolBody body={body} expanded={expanded} /> : null}
          </TranscriptActivityDisclosureInner>
        </TranscriptActivityDisclosure>
      ) : null}
    </TranscriptActivityTool>
  );
}

function ActivityMessage({ message, messages }) {
  const groupMessages = Array.isArray(messages) && messages.length
    ? messages
    : message
      ? [message]
      : [];
  const groupArtifactKey = groupMessages
    .flatMap((groupMessage) => getMessageArtifacts(groupMessage).map(getArtifactReference))
    .join("|");
  const hasArtifacts = Boolean(groupArtifactKey);
  const [expanded, setExpanded] = useState(() => hasArtifacts);

  useEffect(() => {
    if (hasArtifacts) {
      setExpanded(true);
    }
  }, [hasArtifacts, groupArtifactKey]);

  if (!groupMessages.length) {
    return null;
  }

  const activityCount = groupMessages.length;
  const label = activityCount === 1
    ? getToolCallLabel(groupMessages[0])
    : `${activityCount} activities`;
  const status = getActivityGroupStatus(groupMessages);

  return (
    <TranscriptActivityCell data-message-role="activity" data-status={status || "complete"}>
      <TranscriptActivityIcon aria-hidden="true">
        <Terminal />
      </TranscriptActivityIcon>
      <TranscriptActivityContent>
        <TranscriptActivityHeader
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse tool calls" : "Expand tool calls"}
          data-expanded={expanded ? "true" : "false"}
          onClick={() => setExpanded((value) => !value)}
          title={label}
          type="button"
        >
          <TranscriptActivityTitle title={label}>{label}</TranscriptActivityTitle>
          {status ? <TranscriptActivityStatus>{status}</TranscriptActivityStatus> : null}
          <TranscriptActivityToggle data-expanded={expanded ? "true" : "false"}>
            <ExpandMore aria-hidden="true" />
          </TranscriptActivityToggle>
        </TranscriptActivityHeader>
        <TranscriptActivityDisclosure
          aria-hidden={expanded ? "false" : "true"}
          data-expanded={expanded ? "true" : "false"}
        >
          <TranscriptActivityDisclosureInner>
            <TranscriptActivityList>
              {groupMessages.map((activityMessage, index) => (
                <ActivityToolRow
                  key={activityMessage?.id || `activity-${index}`}
                  message={activityMessage}
                />
              ))}
            </TranscriptActivityList>
          </TranscriptActivityDisclosureInner>
        </TranscriptActivityDisclosure>
      </TranscriptActivityContent>
    </TranscriptActivityCell>
  );
}

function ThreadMessage({
  copyAlwaysVisible = false,
  isCopied = false,
  message,
  messageId,
  onCopyMessage,
  showCopy = true,
  workspace,
}) {
  if (!message) {
    return null;
  }

  const copyText = getMessageCopyText(message);
  const canCopy = showCopy && Boolean(copyText);
  const copyTitle = isCopied ? "Copied" : "Copy";
  const messageArtifacts = getMessageArtifacts(message);
  const copyButton = canCopy ? (
    <MessageCopyButton
      aria-label={copyTitle}
      data-copied={isCopied ? "true" : "false"}
      data-visible={copyAlwaysVisible ? "true" : "false"}
      onClick={(event) => {
        event.stopPropagation();
        onCopyMessage?.(messageId, copyText);
      }}
      title={copyTitle}
      type="button"
    >
      {isCopied ? <Check aria-hidden="true" /> : <ContentCopy aria-hidden="true" />}
    </MessageCopyButton>
  ) : null;

  if (message.role === "assistant") {
    return (
      <AssistantCell data-message-role="assistant">
        <AssistantPrefix aria-hidden="true">{"."}</AssistantPrefix>
        <ChatMessageFrame>
          {copyButton}
          <MessageBody>
            <AssistantMarkdownContent message={message} workspace={workspace} />
            {messageArtifacts.length ? <MessageArtifactList artifacts={messageArtifacts} /> : null}
          </MessageBody>
        </ChatMessageFrame>
      </AssistantCell>
    );
  }

  if (message.role === "activity") {
    return <ActivityMessage messages={[message]} />;
  }

  return (
    <UserCell data-message-role="user">
      <UserPrefix aria-hidden="true">{"\u203a"}</UserPrefix>
      <ChatMessageFrame>
        {copyButton}
        <MessageBody>
          <MessageText>
            <MessageTextContent message={message} workspace={workspace} />
          </MessageText>
          {messageArtifacts.length ? <MessageArtifactList artifacts={messageArtifacts} /> : null}
        </MessageBody>
      </ChatMessageFrame>
    </UserCell>
  );
}

function ThreadDiffCounts({ additions, deletions }) {
  return (
    <ThreadDiffFileCounts>
      <DiffCount data-tone="add">{formatThreadDiffCount(additions, "+")}</DiffCount>
      <DiffCount data-tone="delete">{formatThreadDiffCount(deletions, "-")}</DiffCount>
    </ThreadDiffFileCounts>
  );
}

function LiveDiffActivity({ summary }) {
  const latestFile = summary?.latestFile || summary?.files?.[0] || null;
  if (!summary?.fileCount || !latestFile) {
    return null;
  }

  return (
    <ActivityCell>
      <ActivityBullet aria-hidden="true">
        <Edit aria-hidden="true" />
      </ActivityBullet>
      <ActivityText data-live="true" title={latestFile.path}>
        <DiffInline>
          <span>Editing</span>
          <DiffFileName>{latestFile.name || latestFile.path}</DiffFileName>
          <DiffCount data-tone="add">{formatThreadDiffCount(latestFile.additions, "+")}</DiffCount>
          <DiffCount data-tone="delete">{formatThreadDiffCount(latestFile.deletions, "-")}</DiffCount>
        </DiffInline>
      </ActivityText>
    </ActivityCell>
  );
}

function ThreadDiffBanner({ onReview, summary }) {
  if (!summary?.fileCount) {
    return null;
  }

  return (
    <ThreadDiffLiveBanner aria-label="Current file changes">
      <ThreadDiffBannerTitle title={summary.partial ? "Some binary or large files could not be line-counted." : undefined}>
        <span>{formatThreadDiffFileCount(summary.fileCount)}</span>
        <DiffCount data-tone="add">{formatThreadDiffCount(summary.additions, "+")}</DiffCount>
        <DiffCount data-tone="delete">{formatThreadDiffCount(summary.deletions, "-")}</DiffCount>
      </ThreadDiffBannerTitle>
      <ThreadDiffActionButton
        onClick={() => onReview?.(summary)}
        title="Review changed files"
        type="button"
      >
        <span>Review</span>
        <OpenInNew aria-hidden="true" />
      </ThreadDiffActionButton>
    </ThreadDiffLiveBanner>
  );
}

function ThreadDiffSummaryCard({
  expanded,
  onReview,
  onToggleExpanded,
  onUndo,
  summary,
  undoing = false,
}) {
  if (!summary?.fileCount) {
    return null;
  }
  const undone = summary.undoStatus === "undone";

  return (
    <ThreadDiffCard aria-label="Changed files summary">
      <ThreadDiffCardHeader>
        <ThreadDiffCardTitle title={summary.partial ? "Some binary or large files could not be line-counted." : undefined}>
          <span>{formatThreadDiffFileCount(summary.fileCount)}</span>
          <DiffCount data-tone="add">{formatThreadDiffCount(summary.additions, "+")}</DiffCount>
          <DiffCount data-tone="delete">{formatThreadDiffCount(summary.deletions, "-")}</DiffCount>
        </ThreadDiffCardTitle>
        <ThreadDiffActionButton
          disabled={undoing || undone}
          onClick={() => onUndo?.(summary)}
          title={undone ? "Changes undone" : "Undo these changes"}
          type="button"
        >
          <span>{undone ? "Undone" : undoing ? "Undoing" : "Undo"}</span>
          <Undo aria-hidden="true" />
        </ThreadDiffActionButton>
        <ThreadDiffActionButton
          onClick={() => onReview?.(summary)}
          title="Review changed files"
          type="button"
        >
          <span>Review</span>
          <OpenInNew aria-hidden="true" />
        </ThreadDiffActionButton>
        <ThreadDiffExpandButton
          aria-label={expanded ? "Collapse changed files" : "Expand changed files"}
          data-expanded={expanded ? "true" : "false"}
          onClick={() => onToggleExpanded?.()}
          title={expanded ? "Collapse changed files" : "Expand changed files"}
          type="button"
        >
          <ExpandMore aria-hidden="true" />
        </ThreadDiffExpandButton>
      </ThreadDiffCardHeader>
      {expanded ? (
        <ThreadDiffFileList>
          {summary.files.map((file) => (
            <ThreadDiffFileRow
              key={file.path}
              onClick={() => onReview?.(summary, file)}
              title={file.path}
              type="button"
            >
              <ThreadDiffFilePath>{file.path}</ThreadDiffFilePath>
              <ThreadDiffCounts additions={file.additions} deletions={file.deletions} />
            </ThreadDiffFileRow>
          ))}
        </ThreadDiffFileList>
      ) : null}
    </ThreadDiffCard>
  );
}

function AssistantResponseBlock({
  copyAlwaysVisible = false,
  diffSummary = null,
  diffSummaryExpanded = true,
  isCopied = false,
  item,
  onCopyMessage,
  onReviewDiffSummary,
  onToggleDiffSummary,
  onUndoDiffSummary,
  undoingDiff = false,
  workspace,
}) {
  const copyText = getAssistantBlockCopyText(item?.items);
  const canCopy = Boolean(copyText);
  const copyTitle = isCopied ? "Copied" : "Copy";

  return (
    <AssistantBlock
      data-has-diff-summary={diffSummary?.fileCount ? "true" : "false"}
      data-message-role="assistant"
    >
      {item?.items?.map((blockItem) => (
        blockItem.type === "activity-group" ? (
          <ActivityMessage
            key={blockItem.id}
            messages={blockItem.messages}
          />
        ) : (
          <ThreadMessage
            key={blockItem.id}
            message={blockItem.message}
            messageId={blockItem.id}
            showCopy={false}
            workspace={workspace}
          />
        )
      ))}
      <ThreadDiffSummaryCard
        expanded={diffSummaryExpanded}
        onReview={onReviewDiffSummary}
        onToggleExpanded={onToggleDiffSummary}
        onUndo={onUndoDiffSummary}
        summary={diffSummary}
        undoing={undoingDiff}
      />
      {canCopy ? (
        <MessageCopyButton
          aria-label={copyTitle}
          data-copied={isCopied ? "true" : "false"}
          data-visible={copyAlwaysVisible ? "true" : "false"}
          onClick={(event) => {
            event.stopPropagation();
            onCopyMessage?.(item.id, copyText);
          }}
          title={copyTitle}
          type="button"
        >
          {isCopied ? <Check aria-hidden="true" /> : <ContentCopy aria-hidden="true" />}
        </MessageCopyButton>
      ) : null}
    </AssistantBlock>
  );
}

function WorkspaceThreadDetail({
  agentStatuses,
  composerAttachments,
  composerDrafts,
  composerFocusToken = 0,
  density = "default",
  newChatActive = false,
  onCreateChat,
  onDraftInput,
  onSelectModel,
  onSubmitMessage,
  thread,
  todoDropActive = false,
  todoDropTarget = false,
  todoDropUnsupportedMessage = "",
  visible = true,
  workspace,
  workspaceRoot = "",
  workspaceThreadEntry,
}) {
  const [draft, setDraft] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [liveDiffSummary, setLiveDiffSummary] = useState(null);
  const [diffSummariesByTurnId, setDiffSummariesByTurnId] = useState({});
  const [diffSummaryExpandedByTurnId, setDiffSummaryExpandedByTurnId] = useState({});
  const [diffRefreshToken, setDiffRefreshToken] = useState(0);
  const [undoingDiffKey, setUndoingDiffKey] = useState("");
  const detailRootRef = useRef(null);
  const composerBoxRef = useRef(null);
  const composerInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const copyResetTimeoutRef = useRef(null);
  const detailRenderDiagnosticRef = useRef("");
  const lastComposerFocusTokenRef = useRef(0);
  const visibilityTokenRef = useRef("");
  if (!visibilityTokenRef.current) {
    visibilityTokenRef.current = `thread-detail-${Math.random().toString(36).slice(2)}`;
  }
  const detailVisible = visible !== false;
  const messages = detailVisible && Array.isArray(thread?.messages)
    ? thread.messages.filter(isChatProjectionMessage)
    : [];
  const transcriptItems = useMemo(() => buildTranscriptItems(messages), [messages]);
  const latestAssistantBlock = useMemo(() => {
    for (let index = transcriptItems.length - 1; index >= 0; index -= 1) {
      const item = transcriptItems[index];
      if (item?.type === "assistant-block") {
        return item;
      }
    }

    return null;
  }, [transcriptItems]);
  const latestAssistantBlockId = latestAssistantBlock?.id || "";
  const latestAssistantBlockTurnId = getAssistantBlockDiffTurnId(latestAssistantBlock);
  const latestMessage = messages[messages.length - 1] || null;
  const activeAgentId = normalizeAgentId(thread?.currentAgent || "codex");
  const activeAgentStatus = useMemo(
    () => findAgentStatus(agentStatuses, activeAgentId),
    [activeAgentId, agentStatuses],
  );
  const activeProviderBinding = getWorkspaceThreadProviderBinding(thread, activeAgentId);
  const activeLiveTerminal = getLiveTerminalForThread(
    thread,
    activeProviderBinding,
    workspaceThreadEntry,
  );
  const effectiveLiveTerminal = activeLiveTerminal;
  const threadGroundTruth = useMemo(() => getThreadTerminalGroundTruth({
    liveTerminal: effectiveLiveTerminal,
    providerBinding: activeProviderBinding,
    targetRole: activeAgentId,
    thread,
  }), [activeAgentId, effectiveLiveTerminal, activeProviderBinding, thread]);
  const activityItems = useMemo(
    () => buildActivityItems(thread, messages, threadGroundTruth),
    [messages, thread, threadGroundTruth],
  );
  const latestActivity = activityItems[activityItems.length - 1] || null;
  const diffWorktreePath = getThreadDiffWorktreePath(thread, activeProviderBinding, effectiveLiveTerminal);
  const diffRepoPath = String(
    workspaceRoot
      || workspace?.rootDirectory
      || workspace?.workingDirectory
      || "",
  ).trim();
  const diffTurnId = getThreadDiffTurnId(
    thread,
    latestMessage,
    latestAssistantBlockTurnId || latestAssistantBlockId,
  );
  const diffStorageKey = getThreadDiffStorageKey(
    workspace?.id || thread?.workspaceId || "",
    thread?.id || "",
    diffTurnId,
  );
  const diffTurnLive = threadDiffTurnIsLive(thread, threadGroundTruth);
  const diffTurnTerminal = threadDiffTurnIsTerminal(thread, threadGroundTruth, Boolean(latestAssistantBlockId));
  const currentTurnFinalDiffSummary = diffTurnId ? diffSummariesByTurnId[diffTurnId] || null : null;
  const visibleFinalDiffSummary = diffTurnTerminal ? currentTurnFinalDiffSummary : null;
  const visibleLiveDiffSummary = liveDiffSummary?.fileCount && !visibleFinalDiffSummary?.fileCount
    ? liveDiffSummary
    : null;
  const assistantBlockDiffTurnIds = useMemo(() => {
    const seen = new Set();
    const turnIds = [];
    transcriptItems.forEach((item) => {
      if (item?.type !== "assistant-block") {
        return;
      }

      const turnId = getAssistantBlockDiffTurnId(item);
      if (!turnId || seen.has(turnId)) {
        return;
      }

      seen.add(turnId);
      turnIds.push(turnId);
    });

    if (diffTurnId && !seen.has(diffTurnId)) {
      turnIds.push(diffTurnId);
    }

    return turnIds;
  }, [diffTurnId, transcriptItems]);
  const assistantBlockDiffTurnKey = assistantBlockDiffTurnIds.join("\n");
  const diffSummarySurfaceVisible = useMemo(() => {
    if (!visible) {
      return false;
    }
    if (visibleLiveDiffSummary?.fileCount || visibleFinalDiffSummary?.fileCount) {
      return true;
    }
    return assistantBlockDiffTurnIds.some((turnId) => (
      diffSummariesByTurnId[turnId]?.fileCount
      && diffSummaryExpandedByTurnId[turnId] !== false
    ));
  }, [
    assistantBlockDiffTurnIds,
    diffSummariesByTurnId,
    diffSummaryExpandedByTurnId,
    visible,
    visibleFinalDiffSummary,
    visibleLiveDiffSummary,
  ]);
  useEffect(() => {
    const snapshot = getThreadDetailRenderDiagnosticSnapshot({
      activeAgentId,
      activeLiveTerminal,
      activeProviderBinding,
      activityItems,
      effectiveLiveTerminal,
      latestActivity,
      messages,
      thread,
      threadGroundTruth,
      transcriptItems,
      workspace,
      workspaceThreadEntry,
    });
    const signature = getThreadDetailRenderDiagnosticSignature(snapshot);
    if (detailRenderDiagnosticRef.current === signature) {
      return;
    }

    detailRenderDiagnosticRef.current = signature;
    logBigViewSyncDiagnosticEvent("bigview.thread_detail.render_state", snapshot);
    if (snapshot.liveActivityVisible) {
      logBigViewSyncDiagnosticEvent("bigview.thread_detail.live_activity_visible", snapshot);
    }
  }, [
    activeAgentId,
    activeLiveTerminal,
    activeProviderBinding,
    activityItems,
    effectiveLiveTerminal,
    latestActivity,
    messages,
    thread,
    threadGroundTruth,
    transcriptItems,
    workspace,
    workspaceThreadEntry,
  ]);

  useEffect(() => {
    const workspaceId = workspace?.id || thread?.workspaceId || "";
    const threadId = thread?.id || "";
    if (!workspaceId || !threadId) {
      setDiffSummariesByTurnId((current) => (
        Object.keys(current || {}).length ? {} : current
      ));
      return;
    }

    const nextSummaries = {};
    assistantBlockDiffTurnIds.forEach((turnId) => {
      const storageKey = getThreadDiffStorageKey(workspaceId, threadId, turnId);
      const storedSummary = readStoredThreadDiffSummary(storageKey);
      if (storedSummary?.fileCount) {
        nextSummaries[turnId] = {
          ...storedSummary,
          turnId: storedSummary.turnId || turnId,
        };
      }
    });

    setDiffSummariesByTurnId((current) => (
      threadDiffSummaryMapEqual(current, nextSummaries) ? current : nextSummaries
    ));
  }, [
    assistantBlockDiffTurnKey,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  useEffect(() => {
    if (!thread?.id || !diffWorktreePath || !isThreadDiffWorktreePath(diffWorktreePath)) {
      setLiveDiffSummary(null);
      return undefined;
    }

    if (!diffSummarySurfaceVisible) {
      setLiveDiffSummary((currentSummary) => (currentSummary ? null : currentSummary));
      return undefined;
    }

    let cancelled = false;
    let timeoutId = 0;
    let firstFrameId = 0;
    let secondFrameId = 0;

    const getTerminalInputHotDelayMs = (extraMs = 1200) => {
      const hotUntil = typeof window === "undefined"
        ? 0
        : Number(window.__diffforgeTerminalInputHotUntil || 0);
      return Math.max(0, hotUntil + Math.max(0, Number(extraMs) || 0) - Date.now());
    };

    const fetchSummary = async () => {
      try {
        const result = await invoke("coordination_worktree_diff_summary", {
          dbPath: null,
          input: {
            threadId: thread?.id || "",
            turnId: diffTurnId,
            worktreePath: diffWorktreePath,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          },
          repoPath: diffRepoPath || null,
        });
        const summary = normalizeThreadDiffSummary(result);
        if (!cancelled) {
          setLiveDiffSummary(summary?.fileCount ? summary : null);
        }
      } catch (summaryError) {
        if (!cancelled) {
          setLiveDiffSummary(null);
        }
        console.warn("Unable to read thread diff summary", summaryError);
      }
    };

    const schedulePoll = (delayMs) => {
      if (cancelled) {
        return;
      }
      timeoutId = window.setTimeout(poll, Math.max(0, Number(delayMs) || 0));
    };

    const poll = async () => {
      timeoutId = 0;
      const hotDelayMs = getTerminalInputHotDelayMs(1400);
      if (hotDelayMs > 0) {
        schedulePoll(hotDelayMs);
        return;
      }
      await fetchSummary();
      if (!cancelled && diffTurnLive) {
        schedulePoll(THREAD_DIFF_POLL_INTERVAL_MS);
      }
    };

    const startFetchAndPolling = () => {
      if (cancelled) {
        return;
      }

      schedulePoll(Math.max(diffTurnLive ? 1800 : 250, getTerminalInputHotDelayMs(1400)));
    };

    if (typeof window.requestAnimationFrame === "function") {
      firstFrameId = window.requestAnimationFrame(() => {
        firstFrameId = 0;
        secondFrameId = window.requestAnimationFrame(() => {
          secondFrameId = 0;
          startFetchAndPolling();
        });
      });
    } else {
      startFetchAndPolling();
    }

    return () => {
      cancelled = true;
      if (firstFrameId) {
        window.cancelAnimationFrame(firstFrameId);
      }
      if (secondFrameId) {
        window.cancelAnimationFrame(secondFrameId);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    diffRefreshToken,
    diffRepoPath,
    diffSummarySurfaceVisible,
    diffTurnId,
    diffTurnLive,
    diffWorktreePath,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  useEffect(() => {
    if (!diffStorageKey || !diffTurnTerminal || !liveDiffSummary?.fileCount) {
      return;
    }
    const nextSummary = {
      ...liveDiffSummary,
      capturedAt: liveDiffSummary.capturedAt || new Date().toISOString(),
      turnId: diffTurnId,
    };
    setDiffSummariesByTurnId((currentSummaries) => {
      writeStoredThreadDiffSummary(diffStorageKey, nextSummary);
      return setThreadDiffSummaryInMap(currentSummaries, diffTurnId, nextSummary);
    });
  }, [
    diffStorageKey,
    diffTurnId,
    diffTurnTerminal,
    liveDiffSummary,
  ]);

  const activeProviderModelId = String(
    activeProviderBinding?.modelId
      || activeProviderBinding?.model
      || activeProviderBinding?.activeModel
      || activeProviderBinding?.nativeModel
      || activeProviderBinding?.selectedModel
      || activeProviderBinding?.configuredModel
      || "",
  ).trim();
  const currentTuiModel = activeProviderModelId || getStatusModel(activeAgentStatus);
  const modelOptions = useMemo(
    () => getModelOptions(activeAgentId, activeAgentStatus, { modelId: activeProviderModelId }),
    [activeAgentId, activeAgentStatus, activeProviderModelId],
  );
  const activeTerminalBinding = effectiveLiveTerminal
    ? {
      instanceId: effectiveLiveTerminal.instanceId,
      paneId: effectiveLiveTerminal.paneId,
      terminalIndex: effectiveLiveTerminal.terminalIndex,
    }
    : null;
  const hasActiveTerminalBinding = Boolean(activeTerminalBinding?.paneId && activeTerminalBinding?.instanceId);
  const hasProviderSession = getWorkspaceThreadHasSession(thread);
  const composerSyncKey = getThreadComposerSyncKey(
    {
      id: thread?.id || "",
      workspaceId: thread?.workspaceId || workspace?.id || "",
    },
    activeTerminalBinding,
  );
  const syncedComposerDraft = String(composerDrafts?.[composerSyncKey] || "");
  const attachments = Array.isArray(composerAttachments?.[composerSyncKey])
    ? composerAttachments[composerSyncKey]
    : [];
  const canSubmit = Boolean(thread && (hasActiveTerminalBinding || hasProviderSession));
  const agentLabel = AGENT_LABELS[activeAgentId] || "agent";
  const selectedModelOption = modelOptions.find((option) => option.value === currentTuiModel) || modelOptions[0];
  const composerStatusItems = getComposerStatusItems(activeAgentId, selectedModelOption, currentTuiModel);
  const composerStatusTitle = composerStatusItems.join(" ");
  const imageInputSupport = getImageInputSupport(activeAgentId, activeAgentStatus, currentTuiModel);
  const placeholder = hasActiveTerminalBinding
    ? `Ask ${agentLabel} to work in this thread`
    : hasProviderSession
      ? `Ask ${agentLabel} to resume this thread`
      : `No ${agentLabel} session is available for this thread`;
  const submitDisabled = sending || !canSubmit || (!draft.trim() && attachments.length === 0);
  const todoDropOverlayVisible = Boolean(todoDropActive && todoDropTarget);
  const todoDropOverlayTarget = todoDropOverlayVisible;
  const todoDropOverlayMessage = todoDropOverlayTarget
    ? String(todoDropUnsupportedMessage || "").trim()
    : "";
  const todoDropOverlayUnsupported = Boolean(todoDropOverlayMessage);
  const detailDensity = density === "compact" ? "compact" : undefined;

  useEffect(() => {
    const workspaceId = workspace?.id || thread?.workspaceId || "";
    const threadId = thread?.id || "";
    if (!detailVisible || newChatActive || !workspaceId || !threadId) {
      return undefined;
    }

    const visibilityDetail = {
      agentId: activeAgentId,
      density,
      instanceId: activeTerminalBinding?.instanceId || "",
      paneId: activeTerminalBinding?.paneId || "",
      surface: density === "compact" ? "terminal-inline-ui" : "threads-overlay",
      terminalIndex: activeTerminalBinding?.terminalIndex ?? null,
      threadId,
      token: visibilityTokenRef.current,
      visible: true,
      workspaceId,
    };
    setWorkspaceThreadDetailVisibility(visibilityDetail);
    return () => {
      setWorkspaceThreadDetailVisibility({
        ...visibilityDetail,
        visible: false,
      });
    };
  }, [
    activeAgentId,
    activeTerminalBinding?.instanceId,
    activeTerminalBinding?.paneId,
    activeTerminalBinding?.terminalIndex,
    density,
    detailVisible,
    newChatActive,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  useEffect(() => {
    setSelectedModel(modelOptions[0]?.value || "");
    setModelMenuOpen(false);
  }, [activeAgentId, modelOptions, thread?.id]);

  useEffect(() => () => {
    if (copyResetTimeoutRef.current) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

  const handleCopyMessage = async (messageId, text) => {
    const safeMessageId = String(messageId || "");
    if (!safeMessageId || !String(text || "")) {
      return;
    }

    try {
      const copied = await copyTextToClipboard(text);
      if (!copied) {
        return;
      }

      setCopiedMessageId(safeMessageId);
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId((currentMessageId) => (
          currentMessageId === safeMessageId ? "" : currentMessageId
        ));
      }, 1400);
    } catch (copyError) {
      console.warn("Unable to copy thread message", copyError);
    }
  };

  const reviewDiffSummary = (summary, file = null) => {
    const targetPath = getThreadDiffReviewPath(summary, file);
    if (!targetPath) {
      return;
    }
    openWorkspaceFile(workspace, targetPath, {
      reviewMode: "worktree_diff",
      worktreePath: summary?.worktreePath || diffWorktreePath || "",
    });
  };

  const undoDiffSummary = async (summary) => {
    if (!summary?.summaryKey || !summary?.worktreePath) {
      return;
    }
    const summaryTurnId = String(summary.turnId || diffTurnId || "").trim();
    const summaryStorageKey = getThreadDiffStorageKey(
      workspace?.id || thread?.workspaceId || "",
      thread?.id || "",
      summaryTurnId,
    );
    if (
      typeof window !== "undefined"
      && !window.confirm(`Undo ${formatThreadDiffFileCount(summary.fileCount)} from this thread?`)
    ) {
      return;
    }

    setUndoingDiffKey(summary.summaryKey);
    setError("");
    try {
      const result = await invoke("coordination_undo_worktree_diff_summary", {
        dbPath: null,
        input: {
          baseSha: summary.baseSha,
          expectedSummaryKey: summary.summaryKey,
          threadId: thread?.id || "",
          turnId: summaryTurnId,
          worktreePath: summary.worktreePath,
          workspaceId: workspace?.id || thread?.workspaceId || "",
        },
        repoPath: diffRepoPath || null,
      });
      unwrapThreadDiffApiResult(result);
      const undoneSummary = {
        ...summary,
        turnId: summaryTurnId || summary.turnId || "",
        undoStatus: "undone",
        undoneAt: new Date().toISOString(),
      };
      setDiffSummariesByTurnId((currentSummaries) => (
        setThreadDiffSummaryInMap(currentSummaries, summaryTurnId, undoneSummary)
      ));
      writeStoredThreadDiffSummary(summaryStorageKey, undoneSummary);
      setDiffRefreshToken((token) => token + 1);
    } catch (undoError) {
      const message = undoError?.message || "Unable to undo these changes.";
      setError(message);
      console.warn("Unable to undo thread diff summary", undoError);
    } finally {
      setUndoingDiffKey("");
    }
  };

  useEffect(() => {
    logBigViewSyncDiagnosticEvent("bigview.draft.local_sync_effect", {
      agentId: activeAgentId,
      composerSyncKey,
      currentDraftLength: draft.length,
      hasActiveTerminalBinding,
      hasProviderSession,
      selectedModel: currentTuiModel || "",
      syncedComposerDraftLength: syncedComposerDraft.length,
      threadId: thread?.id || "",
      willChangeDraft: draft !== syncedComposerDraft,
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    setDraft(syncedComposerDraft);
  }, [composerSyncKey, syncedComposerDraft]);

  useEffect(() => {
    const safeFocusToken = Number(composerFocusToken || 0);
    if (
      !visible
      || !thread
      || !safeFocusToken
      || safeFocusToken === lastComposerFocusTokenRef.current
    ) {
      return undefined;
    }

    lastComposerFocusTokenRef.current = safeFocusToken;
    let secondFrame = 0;
    const focusInput = () => {
      const input = composerInputRef.current;
      if (!input || input.disabled) {
        return;
      }

      input.focus({ preventScroll: true });
      const cursor = String(input.value || "").length;
      try {
        input.setSelectionRange(cursor, cursor);
      } catch (_) {
        // Some textarea implementations can reject selection during teardown.
      }
    };
    const firstFrame = window.requestAnimationFrame(() => {
      focusInput();
      secondFrame = window.requestAnimationFrame(focusInput);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [composerFocusToken, thread, visible]);

  useEffect(() => {
    logBigViewSyncDiagnosticEvent("bigview.model_state.thread_detail", {
      activeProviderModelId,
      agentId: activeAgentId,
      bindingInstanceId: activeTerminalBinding?.instanceId || "",
      bindingPaneId: activeTerminalBinding?.paneId || "",
      currentTuiModel: currentTuiModel || "",
      hasActiveTerminalBinding,
      hasProviderSession,
      providerSessionPresent: Boolean(activeProviderBinding?.nativeSessionId),
      selectedModelState: selectedModel || "",
      surface: "thread_detail",
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
  }, [
    activeAgentId,
    activeProviderBinding?.nativeSessionId,
    activeProviderModelId,
    activeTerminalBinding?.instanceId,
    activeTerminalBinding?.paneId,
    currentTuiModel,
    hasActiveTerminalBinding,
    hasProviderSession,
    selectedModel,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  useEffect(() => {
    logBigViewSyncDiagnosticEvent("bigview.image.capability_state", {
      ...describeImageSupportDiagnostics({
        activeAgentId,
        activeAgentStatus,
        imageInputSupport,
        modelOptions,
        selectedModel: currentTuiModel || "",
        selectedModelOption,
      }),
      bindingInstanceId: activeTerminalBinding?.instanceId || "",
      bindingPaneId: activeTerminalBinding?.paneId || "",
      composerSyncKey,
      environment: describeImageDropEnvironment(),
      hasActiveTerminalBinding,
      hasProviderSession,
      surface: "thread_detail",
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
  }, [
    activeAgentId,
    activeAgentStatus,
    activeTerminalBinding?.instanceId,
    activeTerminalBinding?.paneId,
    composerSyncKey,
    currentTuiModel,
    hasActiveTerminalBinding,
    hasProviderSession,
    imageInputSupport.activeModel,
    imageInputSupport.reason,
    imageInputSupport.state,
    imageInputSupport.supported,
    modelOptions,
    selectedModelOption,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  useEffect(() => {
    logBigViewSyncDiagnosticEvent("bigview.image.attachment_state", {
      agentId: activeAgentId,
      attachmentCount: attachments.length,
      attachments: getAttachmentLogSummary(attachments),
      bindingInstanceId: activeTerminalBinding?.instanceId || "",
      bindingPaneId: activeTerminalBinding?.paneId || "",
      composerSyncKey,
      hasActiveTerminalBinding,
      hasProviderSession,
      imageSupportReason: imageInputSupport.reason || "",
      imageSupportState: imageInputSupport.state || "",
      imageSupported: Boolean(imageInputSupport.supported),
      selectedModel: currentTuiModel || "",
      surface: "thread_detail",
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
  }, [
    activeAgentId,
    activeTerminalBinding?.instanceId,
    activeTerminalBinding?.paneId,
    attachments,
    composerSyncKey,
    currentTuiModel,
    hasActiveTerminalBinding,
    hasProviderSession,
    imageInputSupport.reason,
    imageInputSupport.state,
    imageInputSupport.supported,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }

    const node = transcriptScrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [
    latestActivity?.id,
    latestActivity?.live,
    latestActivity?.text,
    latestMessage?.id,
    latestMessage?.status,
    latestMessage?.text,
    messages.length,
    thread?.activityStatus,
    thread?.id,
    thread?.latestTurn?.state,
    thread?.latestTurn?.turnId,
    thread?.status,
    visible,
  ]);

  const addImageFiles = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, IMAGE_ATTACHMENT_LIMIT - attachments.length);
    if (!files.length) {
      return;
    }

    logBigViewSyncDiagnosticEvent("bigview.image.add_start", {
      agentId: activeAgentId,
      attachmentCountBefore: attachments.length,
      canSubmit,
      fileCount: files.length,
      files: files.map(describeImageDropFile),
      hasActiveTerminalBinding,
      hasProviderSession,
      imageSupportReason: imageInputSupport.reason || "",
      imageSupportState: imageInputSupport.state || "",
      imageSupported: Boolean(imageInputSupport.supported),
      model: currentTuiModel || "",
      surface: "thread_detail",
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    setError("");
    try {
      const nextAttachments = await Promise.all(files.map(readImageFile));
      appendWorkspaceThreadComposerAttachments(composerSyncKey, nextAttachments.map((attachment) => ({
        ...attachment,
        source: "bigview_thread_detail",
        status: "queued",
      })), {
        fields: {
          agentId: activeAgentId,
          bindingInstanceId: activeTerminalBinding?.instanceId || "",
          bindingPaneId: activeTerminalBinding?.paneId || "",
          model: currentTuiModel || "",
          surface: "thread_detail",
          threadId: thread?.id || "",
          workspaceId: workspace?.id || thread?.workspaceId || "",
        },
        maxCount: IMAGE_ATTACHMENT_LIMIT,
        source: "bigview_thread_detail",
      });
      logBigViewSyncDiagnosticEvent("bigview.image.add_done", {
        agentId: activeAgentId,
        attachmentCountAfter: Math.min(IMAGE_ATTACHMENT_LIMIT, attachments.length + nextAttachments.length),
        attachments: getAttachmentLogSummary(nextAttachments),
        hasActiveTerminalBinding,
        model: currentTuiModel || "",
        queuedOnly: true,
        sharedDraftLength: draft.length,
        syncedToSharedAttachments: true,
        syncKey: composerSyncKey,
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
    } catch (readError) {
      setError(readError?.message || "Unable to attach image.");
      logBigViewSyncDiagnosticEvent("bigview.image.add_error", {
        agentId: activeAgentId,
        fileCount: files.length,
        message: readError?.message || String(readError || ""),
        model: currentTuiModel || "",
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
    }
  };

  const handleComposerPaste = (event) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    const clipboardText = String(event.clipboardData?.getData?.("text/plain") || "");
    logBigViewSyncDiagnosticEvent("bigview.text.paste_observed", {
      agentId: activeAgentId,
      clipboardTypes: Array.from(event.clipboardData?.types || []),
      composerSyncKey,
      hasImageFiles: imageFiles.length > 0,
      model: currentTuiModel || "",
      surface: "thread_detail",
      text: getBigViewTextDiagnosticFields(clipboardText),
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    if (!imageFiles.length) {
      return;
    }

    event.preventDefault();
    logBigViewSyncDiagnosticEvent("bigview.image.paste_start", {
      agentId: activeAgentId,
      attachmentCountBefore: attachments.length,
      fileCount: imageFiles.length,
      files: imageFiles.map(describeImageDropFile),
      model: currentTuiModel || "",
      surface: "thread_detail",
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    addImageFiles(imageFiles);
  };

  const appendPlainTextPasteToComposer = (clipboardText, source = "bigview_thread_detail_window_paste") => {
    const pastedText = String(clipboardText || "");
    if (!pastedText || sending || !canSubmit) {
      logBigViewSyncDiagnosticEvent("bigview.text.paste_fallback_skip", {
        agentId: activeAgentId,
        canSubmit,
        composerSyncKey,
        disabled: Boolean(sending || !canSubmit),
        model: currentTuiModel || "",
        reason: !pastedText ? "empty_text" : "composer_unavailable",
        source,
        surface: "thread_detail",
        text: getBigViewTextDiagnosticFields(pastedText),
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      return false;
    }

    const previousDraft = draft;
    const nextDraft = `${previousDraft}${pastedText}`;
    setError("");
    setDraft(nextDraft);
    onDraftInput?.({
      nextValue: nextDraft,
      previousValue: previousDraft,
      thread,
      workspace,
    });
    window.setTimeout(() => {
      composerInputRef.current?.focus?.();
    }, 0);
    logBigViewSyncDiagnosticEvent("bigview.text.paste_fallback_insert", {
      agentId: activeAgentId,
      composerSyncKey,
      model: currentTuiModel || "",
      nextValueLength: nextDraft.length,
      previousValueLength: previousDraft.length,
      source,
      surface: "thread_detail",
      text: getBigViewTextDiagnosticFields(pastedText),
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    return true;
  };

  useEffect(() => {
    const handleWindowPasteCapture = (event) => {
      if (event.defaultPrevented) {
        return;
      }

      const root = detailRootRef.current;
      if (!root) {
        return;
      }

      const targetElement = getPasteTargetElement(event.target);
      const activeElement = getPasteTargetElement(document.activeElement);
      const targetInsideDetail = Boolean(targetElement && root.contains(targetElement));
      const activeInsideDetail = Boolean(activeElement && root.contains(activeElement));
      const targetInsideComposer = Boolean(
        targetElement && composerBoxRef.current?.contains?.(targetElement),
      );
      const targetIsComposerInput = targetElement === composerInputRef.current;
      const targetIsEditable = isEditablePasteTarget(targetElement);
      const targetIsInteractive = isInteractivePasteTarget(targetElement);
      const clipboardText = String(event.clipboardData?.getData?.("text/plain") || "");
      const imageFiles = getClipboardImageFiles(event.clipboardData);

      if (!clipboardText && !imageFiles.length) {
        return;
      }

      logBigViewSyncDiagnosticEvent("bigview.text.window_paste_observed", {
        agentId: activeAgentId,
        activeInsideDetail,
        clipboardTypes: Array.from(event.clipboardData?.types || []),
        composerSyncKey,
        hasImageFiles: imageFiles.length > 0,
        model: currentTuiModel || "",
        surface: "thread_detail",
        targetInsideComposer,
        targetInsideDetail,
        targetIsComposerInput,
        targetIsEditable,
        targetIsInteractive,
        text: getBigViewTextDiagnosticFields(clipboardText),
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });

      if (
        imageFiles.length
        || targetIsComposerInput
        || targetIsEditable
        || targetIsInteractive
        || (!targetInsideComposer && !targetInsideDetail && !activeInsideDetail)
      ) {
        return;
      }

      if (appendPlainTextPasteToComposer(clipboardText)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("paste", handleWindowPasteCapture, true);
    return () => {
      window.removeEventListener("paste", handleWindowPasteCapture, true);
    };
  }, [
    activeAgentId,
    canSubmit,
    composerSyncKey,
    currentTuiModel,
    draft,
    onDraftInput,
    sending,
    thread,
    workspace,
  ]);

  const handleDetailRootClick = (event) => {
    if (isInteractivePasteTarget(event.target)) {
      return;
    }

    detailRootRef.current?.focus?.({ preventScroll: true });
  };

  const handleComposerDragOver = (event) => {
    const activeWorkspaceFile = getActiveWorkspaceFileDrag();
    const hasImageTransfer = hasImageFileTransfer(event.dataTransfer);
    const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
    if (!hasImageTransfer && !hasWorkspaceFileTransfer && !activeWorkspaceFile) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    logFileDragDiagnosticEvent("bigview.drag_over", {
      ...describeImageSupportDiagnostics({
        activeAgentId,
        activeAgentStatus,
        imageInputSupport,
        modelOptions,
        selectedModel: currentTuiModel || "",
        selectedModelOption,
      }),
      composerSyncKey,
      environment: describeImageDropEnvironment(),
      hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
      hasImageTransfer,
      hasWorkspaceFileTransfer,
      threadId: thread?.id || "",
      transfer: describeImageDropTransfer(event.dataTransfer),
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
  };

  const handleComposerDrop = (event) => {
    const hasFileTransfer = hasImageFileTransfer(event.dataTransfer);
    const imageFiles = getDroppedImageFiles(event.dataTransfer);
    logBigViewSyncDiagnosticEvent("bigview.image.drop_received", {
      ...describeImageSupportDiagnostics({
        activeAgentId,
        activeAgentStatus,
        imageInputSupport,
        modelOptions,
        selectedModel: currentTuiModel || "",
        selectedModelOption,
      }),
      composerSyncKey,
      droppedImageCount: imageFiles.length,
      environment: describeImageDropEnvironment(),
      hasFileTransfer,
      hasImageTransfer: imageFiles.length > 0,
      hasWorkspaceFileTransfer: isWorkspaceFileDragTransfer(event.dataTransfer),
      surface: "thread_detail",
      threadId: thread?.id || "",
      transfer: describeImageDropTransfer(event.dataTransfer),
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    logBigViewSyncDiagnosticEvent("bigview.text.drop_observed", {
      agentId: activeAgentId,
      composerSyncKey,
      dataTransferTypes: Array.from(event.dataTransfer?.types || []),
      hasImageTransfer: imageFiles.length > 0,
      hasWorkspaceFileTransfer: isWorkspaceFileDragTransfer(event.dataTransfer),
      model: currentTuiModel || "",
      surface: "thread_detail",
      text: getBigViewTextDiagnosticFields(event.dataTransfer?.getData?.("text/plain") || ""),
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    if (imageFiles.length) {
      event.preventDefault();
      event.stopPropagation();
      logBigViewSyncDiagnosticEvent("bigview.image.drop", {
        ...describeImageSupportDiagnostics({
          activeAgentId,
          activeAgentStatus,
          imageInputSupport,
          modelOptions,
          selectedModel: currentTuiModel || "",
          selectedModelOption,
        }),
        fileCount: imageFiles.length,
        files: imageFiles.map(describeImageDropFile),
        surface: "thread_detail",
        threadId: thread?.id || "",
        transfer: describeImageDropTransfer(event.dataTransfer),
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      addImageFiles(imageFiles);
      return;
    }
    if (hasFileTransfer) {
      event.preventDefault();
      event.stopPropagation();
      setError("Drop an image file.");
      logBigViewSyncDiagnosticEvent("bigview.image.drop_skip", {
        ...describeImageSupportDiagnostics({
          activeAgentId,
          activeAgentStatus,
          imageInputSupport,
          modelOptions,
          selectedModel: currentTuiModel || "",
          selectedModelOption,
        }),
        reason: "missing_image_file",
        surface: "thread_detail",
        threadId: thread?.id || "",
        transfer: describeImageDropTransfer(event.dataTransfer),
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      return;
    }

    const activeWorkspaceFile = getActiveWorkspaceFileDrag();
    const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
    if (!hasWorkspaceFileTransfer && !activeWorkspaceFile) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const workspaceFile = getDraggedWorkspaceFile(event.dataTransfer) || activeWorkspaceFile;
    const attachment = workspaceFileToComposerAttachment(workspaceFile, "bigview_fileviewer_drop");
    logFileDragDiagnosticEvent("bigview.drop_received", {
      attachmentCreated: Boolean(attachment),
      composerSyncKey,
      hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
      hasSyncKey: Boolean(composerSyncKey),
      hasWorkspaceFileTransfer,
      relativePath: workspaceFile?.relativePath || attachment?.relativePath || "",
      threadId: thread?.id || "",
      types: Array.from(event.dataTransfer?.types || []),
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    if (!attachment || !composerSyncKey) {
      logFileDragDiagnosticEvent("bigview.drop_skip", {
        attachmentCreated: Boolean(attachment),
        hasSyncKey: Boolean(composerSyncKey),
        reason: !attachment ? "missing_attachment" : "missing_sync_key",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      return;
    }

    appendWorkspaceThreadComposerAttachments(composerSyncKey, [attachment], {
      fields: {
        agentId: activeAgentId,
        bindingInstanceId: activeTerminalBinding?.instanceId || "",
        bindingPaneId: activeTerminalBinding?.paneId || "",
        relativePath: attachment.relativePath || "",
        selectedModel: currentTuiModel || "",
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      },
      source: "bigview_fileviewer_drop",
    });
    logFileDragDiagnosticEvent("bigview.attachment_appended", {
      attachmentName: attachment.name,
      attachmentPath: attachment.savedPath,
      composerSyncKey,
      kind: attachment.kind,
      relativePath: attachment.relativePath || "",
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
  };

  const queueWorkspaceFileForBigView = (workspaceFile, source = "bigview_fileviewer_global_drop") => {
    const attachment = workspaceFileToComposerAttachment(workspaceFile, source);
    logFileDragDiagnosticEvent("bigview.global_drop_resolved", {
      attachmentCreated: Boolean(attachment),
      composerSyncKey,
      hasSyncKey: Boolean(composerSyncKey),
      relativePath: workspaceFile?.relativePath || attachment?.relativePath || "",
      source,
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    if (!attachment || !composerSyncKey) {
      logFileDragDiagnosticEvent("bigview.global_drop_skip", {
        attachmentCreated: Boolean(attachment),
        hasSyncKey: Boolean(composerSyncKey),
        reason: !attachment ? "missing_attachment" : "missing_sync_key",
        source,
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      return false;
    }

    appendWorkspaceThreadComposerAttachments(composerSyncKey, [attachment], {
      fields: {
        agentId: activeAgentId,
        bindingInstanceId: activeTerminalBinding?.instanceId || "",
        bindingPaneId: activeTerminalBinding?.paneId || "",
        relativePath: attachment.relativePath || "",
        selectedModel: currentTuiModel || "",
        source,
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      },
      source,
    });
    logFileDragDiagnosticEvent("bigview.global_attachment_appended", {
      attachmentName: attachment.name,
      attachmentPath: attachment.savedPath,
      composerSyncKey,
      kind: attachment.kind,
      relativePath: attachment.relativePath || "",
      source,
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    return true;
  };

  useEffect(() => {
    const handleWorkspaceFileDragOver = (event) => {
      const activeWorkspaceFile = getActiveWorkspaceFileDrag();
      const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
      if (!hasWorkspaceFileTransfer && !activeWorkspaceFile) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const rect = composerBoxRef.current?.getBoundingClientRect?.();
      const insideComposer = Boolean(rect)
        && event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
      logFileDragDiagnosticEvent("bigview.global_drag_over_raw", {
        composerSyncKey,
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        insideComposer,
        threadId: thread?.id || "",
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      if (!insideComposer) {
        return;
      }

      logFileDragDiagnosticEvent("bigview.global_drag_over", {
        composerSyncKey,
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        threadId: thread?.id || "",
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
    };

    const handleWorkspaceFileDrop = (event) => {
      const activeWorkspaceFile = getActiveWorkspaceFileDrag();
      const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
      if (!hasWorkspaceFileTransfer && !activeWorkspaceFile) {
        return;
      }

      event.preventDefault();
      const rect = composerBoxRef.current?.getBoundingClientRect?.();
      const insideComposer = Boolean(rect)
        && event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
      logFileDragDiagnosticEvent("bigview.global_drop_raw", {
        composerSyncKey,
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        insideComposer,
        threadId: thread?.id || "",
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      if (!insideComposer) {
        return;
      }

      event.stopPropagation();
      const workspaceFile = getDraggedWorkspaceFile(event.dataTransfer) || activeWorkspaceFile;
      logFileDragDiagnosticEvent("bigview.global_drop", {
        filePresent: Boolean(workspaceFile),
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        relativePath: workspaceFile?.relativePath || "",
        threadId: thread?.id || "",
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      if (queueWorkspaceFileForBigView(workspaceFile, "bigview_fileviewer_global_drop")) {
        clearActiveWorkspaceFileDrag();
      }
    };

    window.addEventListener("dragover", handleWorkspaceFileDragOver, true);
    window.addEventListener("drop", handleWorkspaceFileDrop, true);
    return () => {
      window.removeEventListener("dragover", handleWorkspaceFileDragOver, true);
      window.removeEventListener("drop", handleWorkspaceFileDrop, true);
    };
  }, [
    activeAgentId,
    activeTerminalBinding?.instanceId,
    activeTerminalBinding?.paneId,
    composerSyncKey,
    currentTuiModel,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  useEffect(() => {
    const handleWorkspaceFilePointerDrop = (event) => {
      const detail = event?.detail || {};
      const workspaceFile = detail.file && typeof detail.file === "object" ? detail.file : null;
      if (!workspaceFile) {
        return;
      }

      const rect = composerBoxRef.current?.getBoundingClientRect?.();
      const clientX = Number(detail.clientX || 0);
      const clientY = Number(detail.clientY || 0);
      const insideComposer = Boolean(rect)
        && clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;
      logFileDragDiagnosticEvent("bigview.pointer_drop_received", {
        composerSyncKey,
        insideComposer,
        relativePath: workspaceFile.relativePath || "",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      if (!insideComposer) {
        return;
      }

      if (queueWorkspaceFileForBigView(workspaceFile, "bigview_fileviewer_pointer_drop")) {
        detail.handled = true;
        clearActiveWorkspaceFileDrag();
      }
    };

    window.addEventListener(WORKSPACE_FILE_POINTER_DROP_EVENT, handleWorkspaceFilePointerDrop);
    return () => {
      window.removeEventListener(WORKSPACE_FILE_POINTER_DROP_EVENT, handleWorkspaceFilePointerDrop);
    };
  }, [
    activeAgentId,
    activeTerminalBinding?.instanceId,
    activeTerminalBinding?.paneId,
    composerSyncKey,
    currentTuiModel,
    thread?.id,
    thread?.workspaceId,
    workspace?.id,
  ]);

  const getComposerDragDiagnosticFields = (event) => ({
    ...describeImageSupportDiagnostics({
      activeAgentId,
      activeAgentStatus,
      imageInputSupport,
      modelOptions,
      selectedModel: currentTuiModel || "",
      selectedModelOption,
    }),
    composerSyncKey,
    environment: describeImageDropEnvironment(),
    hasActiveWorkspaceFile: Boolean(getActiveWorkspaceFileDrag()),
    hasImageTransfer: hasImageFileTransfer(event.dataTransfer),
    hasWorkspaceFileType: isWorkspaceFileDragTransfer(event.dataTransfer),
    threadId: thread?.id || "",
    transfer: describeImageDropTransfer(event.dataTransfer),
    workspaceId: workspace?.id || thread?.workspaceId || "",
  });

  const handleComposerRawDragEnterCapture = (event) => {
    logFileDragDiagnosticEvent("bigview.raw_drag_enter_capture", getComposerDragDiagnosticFields(event));
  };

  const handleComposerRawDragOverCapture = (event) => {
    logFileDragDiagnosticEvent("bigview.raw_drag_over_capture", getComposerDragDiagnosticFields(event));
  };

  const handleComposerRawDropCapture = (event) => {
    logFileDragDiagnosticEvent("bigview.raw_drop_capture", getComposerDragDiagnosticFields(event));
  };

  const removeAttachment = (attachmentId) => {
    const removedAttachment = attachments.find((attachment) => attachment.id === attachmentId);
    removeWorkspaceThreadComposerAttachment(composerSyncKey, attachmentId, {
      fields: {
        agentId: activeAgentId,
        bindingInstanceId: activeTerminalBinding?.instanceId || "",
        bindingPaneId: activeTerminalBinding?.paneId || "",
        removedAttachment: getAttachmentLogSummary([removedAttachment])[0] || null,
        selectedModel: currentTuiModel || "",
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      },
      source: "bigview_thread_detail",
    });
  };

  const selectModel = (option) => {
    const nextModel = String(option?.value || "").trim();
    const thinkingPower = getModelThinkingPowerMetadata(activeAgentId, option, nextModel);
    logBigViewSyncDiagnosticEvent("bigview.model_change.selected", {
      agentId: activeAgentId,
      canSubmit,
      hasActiveTerminalBinding,
      hasProviderSession,
      model: nextModel,
      modelLabel: option?.label || "",
      surface: "thread_detail",
      thinkingPower: thinkingPower.thinkingPower,
      thinkingPowerSource: thinkingPower.source,
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    setSelectedModel(nextModel);
    setModelMenuOpen(false);
    setError("");

    if (!nextModel || !thread || !hasActiveTerminalBinding) {
      logBigViewSyncDiagnosticEvent("bigview.model_change.skip", {
        agentId: activeAgentId,
        hasActiveTerminalBinding,
        hasModel: Boolean(nextModel),
        hasThread: Boolean(thread),
        model: nextModel,
        reason: !nextModel ? "missing_model" : !thread ? "missing_thread" : "missing_live_terminal_binding",
        surface: "thread_detail",
        thinkingPower: thinkingPower.thinkingPower,
        thinkingPowerSource: thinkingPower.source,
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      return;
    }

    logBigViewSyncDiagnosticEvent("bigview.model_change.request", {
      agentId: activeAgentId,
      bindingInstanceId: activeTerminalBinding?.instanceId || "",
      bindingPaneId: activeTerminalBinding?.paneId || "",
      model: nextModel,
      modelLabel: option?.label || "",
      requestIncludesThinkingPower: Boolean(activeAgentId === "codex" && thinkingPower.thinkingPower),
      surface: "thread_detail",
      thinkingPower: thinkingPower.thinkingPower,
      thinkingPowerSource: thinkingPower.source,
      threadId: thread?.id || "",
      workspaceId: workspace?.id || thread?.workspaceId || "",
    });
    Promise.resolve(onSelectModel?.({
      agentId: activeAgentId,
      model: nextModel,
      thread,
      thinkingPower: thinkingPower.thinkingPower,
      thinkingPowerSource: thinkingPower.source,
      workspace,
    })).then(() => {
      logBigViewSyncDiagnosticEvent("bigview.model_change.done", {
        agentId: activeAgentId,
        model: nextModel,
        surface: "thread_detail",
        thinkingPower: thinkingPower.thinkingPower,
        thinkingPowerSource: thinkingPower.source,
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
    }).catch((modelError) => {
      setError(modelError?.message || "Unable to change model.");
      logBigViewSyncDiagnosticEvent("bigview.model_change.error", {
        agentId: activeAgentId,
        message: modelError?.message || String(modelError || ""),
        model: nextModel,
        surface: "thread_detail",
        thinkingPower: thinkingPower.thinkingPower,
        thinkingPowerSource: thinkingPower.source,
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
    });
  };

  const submitDraft = async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || !thread || !canSubmit) {
      return;
    }

    const previousDraft = draft;
    const previousAttachments = attachments;
    setSending(true);
    setError("");
    try {
      const thinkingPower = getModelThinkingPowerMetadata(activeAgentId, selectedModelOption, currentTuiModel);
      logBigViewSyncDiagnosticEvent("bigview.submit.start", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        attachments: getAttachmentLogSummary(previousAttachments),
        canSubmit,
        composerSyncKey,
        draftLength: text.length,
        hasActiveTerminalBinding,
        hasProviderSession,
        imageSupportReason: imageInputSupport.reason || "",
        imageSupportState: imageInputSupport.state || "",
        imageSupported: Boolean(imageInputSupport.supported),
        modelPayload: "",
        selectedModel: currentTuiModel || "",
        surface: "thread_detail",
        thinkingPower: thinkingPower.thinkingPower,
        thinkingPowerSource: thinkingPower.source,
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      if (previousAttachments.length) {
        logBigViewSyncDiagnosticEvent("bigview.image.save_start", {
          agentId: activeAgentId,
          attachmentCount: previousAttachments.length,
          attachments: getAttachmentLogSummary(previousAttachments),
          selectedModel: currentTuiModel || "",
          surface: "thread_detail",
          threadId: thread?.id || "",
          workspaceId: workspace?.id || thread?.workspaceId || "",
        });
      }
      let imageBlock = "";
      try {
        imageBlock = await saveImageAttachments(previousAttachments);
      } catch (saveError) {
        if (previousAttachments.length) {
          logBigViewSyncDiagnosticEvent("bigview.image.save_error", {
            agentId: activeAgentId,
            attachmentCount: previousAttachments.length,
            attachments: getAttachmentLogSummary(previousAttachments),
            message: saveError?.message || String(saveError || ""),
            selectedModel: currentTuiModel || "",
            surface: "thread_detail",
            threadId: thread?.id || "",
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
        }
        throw saveError;
      }
      if (previousAttachments.length) {
        logBigViewSyncDiagnosticEvent("bigview.image.save_done", {
          agentId: activeAgentId,
          attachmentCount: previousAttachments.length,
          imageBlockLength: imageBlock.length,
          imageBlockPreview: imageBlock.slice(0, 240),
          selectedModel: currentTuiModel || "",
          surface: "thread_detail",
          threadId: thread?.id || "",
          workspaceId: workspace?.id || thread?.workspaceId || "",
        });
      }
      const message = [text, imageBlock].filter(Boolean).join("\n\n");
      logBigViewSyncDiagnosticEvent("bigview.submit.message_prepared", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        hasActiveTerminalBinding,
        imageBlockPresent: Boolean(imageBlock),
        messageLength: message.length,
        messageText: getBigViewTextDiagnosticFields(message),
        selectedModel: currentTuiModel || "",
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });

      await onSubmitMessage?.({
        message,
        model: "",
        thread,
        workspace,
      });
      logBigViewSyncDiagnosticEvent("bigview.submit.done", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        selectedModel: currentTuiModel || "",
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      setDraft("");
      setWorkspaceThreadComposerAttachments(composerSyncKey, [], {
        fields: {
          agentId: activeAgentId,
          surface: "thread_detail",
          threadId: thread?.id || "",
          workspaceId: workspace?.id || thread?.workspaceId || "",
        },
        reason: "submit_done_clear",
        source: "bigview_thread_detail",
      });
    } catch (submitError) {
      setDraft(previousDraft);
      setError(submitError?.message || "Unable to send message.");
      logBigViewSyncDiagnosticEvent("bigview.submit.error", {
        agentId: activeAgentId,
        attachmentCount: previousAttachments.length,
        message: submitError?.message || String(submitError || ""),
        selectedModel: currentTuiModel || "",
        surface: "thread_detail",
        threadId: thread?.id || "",
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
    } finally {
      setSending(false);
    }
  };

  if (!detailVisible) {
    return null;
  }

  if (newChatActive) {
    return (
      <NewChatView
        agentStatuses={agentStatuses}
        onCreateChat={onCreateChat}
        workspace={workspace}
      />
    );
  }

  if (!thread) {
    return (
      <DetailRoot
        data-density={detailDensity}
        ref={detailRootRef}
        onClick={handleDetailRootClick}
        tabIndex={-1}
      >
        <TranscriptScroll>
          <TranscriptInner>
            <EmptyThread>Select a thread</EmptyThread>
          </TranscriptInner>
        </TranscriptScroll>
        {todoDropOverlayVisible && (
          <ThreadDetailTodoDropOverlay
            data-target={todoDropOverlayTarget ? "true" : "false"}
            data-unsupported={todoDropOverlayUnsupported ? "true" : "false"}
          >
            {todoDropOverlayTarget && (
              <ThreadDetailTodoDropLabel data-unsupported={todoDropOverlayUnsupported ? "true" : "false"}>
                {todoDropOverlayMessage || "Drop here"}
              </ThreadDetailTodoDropLabel>
            )}
          </ThreadDetailTodoDropOverlay>
        )}
      </DetailRoot>
    );
  }

  return (
    <DetailRoot
      aria-label={getWorkspaceThreadLabel(thread)}
      data-density={detailDensity}
      onClick={handleDetailRootClick}
      ref={detailRootRef}
      tabIndex={-1}
    >
      <TranscriptScroll ref={transcriptScrollRef}>
        <TranscriptInner>
          {transcriptItems.map((item) => (
            item.type === "assistant-block" ? (() => {
              const blockTurnId = getAssistantBlockDiffTurnId(item);
              const blockDiffSummary = blockTurnId
                ? diffSummariesByTurnId[blockTurnId] || null
                : null;
              const diffSummaryExpanded = blockTurnId
                ? diffSummaryExpandedByTurnId[blockTurnId] !== false
                : true;

              return (
                <AssistantResponseBlock
                  copyAlwaysVisible={item.id === latestAssistantBlockId}
                  diffSummary={blockDiffSummary}
                  diffSummaryExpanded={diffSummaryExpanded}
                  isCopied={copiedMessageId === item.id}
                  item={item}
                  key={item.id}
                  onCopyMessage={handleCopyMessage}
                  onReviewDiffSummary={reviewDiffSummary}
                  onToggleDiffSummary={() => {
                    if (!blockTurnId) {
                      return;
                    }
                    setDiffSummaryExpandedByTurnId((current) => ({
                      ...current,
                      [blockTurnId]: !(current[blockTurnId] !== false),
                    }));
                  }}
                  onUndoDiffSummary={undoDiffSummary}
                  undoingDiff={Boolean(undoingDiffKey && undoingDiffKey === blockDiffSummary?.summaryKey)}
                  workspace={workspace}
                />
              );
            })() : item.type === "activity-group" ? (
              <ActivityMessage
                key={item.id}
                messages={item.messages}
              />
            ) : (
              <ThreadMessage
                isCopied={copiedMessageId === item.id}
                key={item.id}
                message={item.message}
                messageId={item.id}
                onCopyMessage={handleCopyMessage}
                workspace={workspace}
              />
            )
          ))}

          <LiveDiffActivity summary={visibleLiveDiffSummary} />
          {activityItems.map((item) => (
            <ActivityCell key={item.id}>
              <ActivityBullet aria-hidden="true">{"\u2022"}</ActivityBullet>
              <ActivityText data-live={item.live ? "true" : "false"}>{item.text}</ActivityText>
            </ActivityCell>
          ))}
        </TranscriptInner>
      </TranscriptScroll>

      <ComposerShell
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
      >
        <ThreadDiffBanner
          onReview={reviewDiffSummary}
          summary={visibleLiveDiffSummary}
        />
        <HiddenFileInput
          accept={IMAGE_ATTACHMENT_ACCEPT}
          multiple
          onChange={(event) => {
            addImageFiles(event.target.files);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
        <ComposerBox
          ref={composerBoxRef}
          onDragEnterCapture={handleComposerRawDragEnterCapture}
          onDragOverCapture={handleComposerRawDragOverCapture}
          onDragOver={handleComposerDragOver}
          onDropCapture={handleComposerRawDropCapture}
          onDrop={handleComposerDrop}
        >
          <AttachmentStrip>
            {attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} title={attachment.name}>
                {attachment.dataUrl && <img alt="" draggable={false} src={attachment.dataUrl} />}
                <span>{attachment.name}</span>
                <AttachmentQueueHint>queued</AttachmentQueueHint>
                <button
                  aria-label={`Remove ${attachment.name}`}
                  disabled={sending}
                  onClick={() => removeAttachment(attachment.id)}
                  title="Remove image"
                  type="button"
                >
                  <Close aria-hidden="true" />
                </button>
              </AttachmentChip>
            ))}
          </AttachmentStrip>
          <ComposerInput
            disabled={!canSubmit || sending}
            onChange={(event) => {
              const previousDraft = draft;
              const nextDraft = event.target.value;
              setDraft(nextDraft);
              logBigViewSyncDiagnosticEvent("bigview.draft.input", {
                agentId: activeAgentId,
                composerSyncKey,
                hasActiveTerminalBinding,
                hasDraftInputHandler: Boolean(onDraftInput),
                hasProviderSession,
                nextValueLength: nextDraft.length,
                previousValueLength: previousDraft.length,
                selectedModel: currentTuiModel || "",
                surface: "thread_detail",
                threadId: thread?.id || "",
                workspaceId: workspace?.id || thread?.workspaceId || "",
              });
              onDraftInput?.({
                nextValue: nextDraft,
                previousValue: previousDraft,
                thread,
                workspace,
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitDraft();
              }
            }}
            onPaste={handleComposerPaste}
            placeholder={placeholder}
            ref={composerInputRef}
            rows={1}
            spellCheck="true"
            value={draft}
          />
          <ComposerFooter>
            <ComposerControls>
              <ComposerAttachButton
                aria-label="Upload image"
                disabled={
                  !canSubmit
                    || sending
                    || !imageInputSupport.supported
                    || attachments.length >= IMAGE_ATTACHMENT_LIMIT
                }
                onClick={() => fileInputRef.current?.click()}
                title={
                  imageInputSupport.supported
                    ? "Upload image"
                    : imageInputSupport.reason
                }
                type="button"
              >
                <Add aria-hidden="true" />
              </ComposerAttachButton>
            </ComposerControls>
            <ComposerActions>
              <ComposerStatusLine title={composerStatusTitle}>
                {composerStatusItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </ComposerStatusLine>
              <SendButton
                aria-label="Send message"
                disabled={submitDisabled}
                title="Send message"
                type="submit"
              >
                <ArrowUpward aria-hidden="true" />
              </SendButton>
            </ComposerActions>
          </ComposerFooter>
        </ComposerBox>
        {error ? <ComposerError>{error}</ComposerError> : null}
      </ComposerShell>
      {todoDropOverlayVisible && (
        <ThreadDetailTodoDropOverlay
          data-target={todoDropOverlayTarget ? "true" : "false"}
          data-unsupported={todoDropOverlayUnsupported ? "true" : "false"}
        >
          {todoDropOverlayTarget && (
            <ThreadDetailTodoDropLabel data-unsupported={todoDropOverlayUnsupported ? "true" : "false"}>
              {todoDropOverlayMessage || "Drop here"}
            </ThreadDetailTodoDropLabel>
          )}
        </ThreadDetailTodoDropOverlay>
      )}
    </DetailRoot>
  );
}

export default memo(WorkspaceThreadDetail);
