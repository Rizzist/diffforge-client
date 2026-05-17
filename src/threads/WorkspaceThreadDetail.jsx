import { invoke } from "@tauri-apps/api/core";
import { AddPhotoAlternate } from "@styled-icons/material-rounded/AddPhotoAlternate";
import { ArrowUpward } from "@styled-icons/material-rounded/ArrowUpward";
import { Close } from "@styled-icons/material-rounded/Close";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import { getAgentModelImageInputCapability } from "../agents/imageInputCapabilities";
import {
  appendWorkspaceThreadComposerAttachments,
  clearActiveWorkspaceFileDrag,
  getActiveWorkspaceFileDrag,
  getDraggedWorkspaceFile,
  isWorkspaceFileDragTransfer,
  removeWorkspaceThreadComposerAttachment,
  setWorkspaceThreadComposerAttachments,
  WORKSPACE_FILE_POINTER_DROP_EVENT,
  workspaceFileToComposerAttachment,
} from "../terminals/WorkspaceTerminal/threadRuntime.js";
import { logBigViewSyncDiagnosticEvent, logFileDragDiagnosticEvent } from "./bigViewSyncDiagnostics";
import {
  getWorkspaceThreadHasSession,
  getWorkspaceThreadLabel,
  getWorkspaceThreadProviderBinding,
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
  color: var(--thread-fg);
  background: var(--thread-bg);
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
  display: flex;
  min-width: 0;
  justify-content: flex-end;
  padding: 2px 0 18px;
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
    max-width: min(78%, 520px);
    border: 0;
    border-radius: 18px;
    padding: 11px 14px 12px;
    color: #dedede;
    background: #202020;
    box-shadow: none;
  }

  article[data-message-role="assistant"] & {
    width: 100%;
    padding: 2px 3px;
  }

  article[data-message-role="activity"] & {
    width: 100%;
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
`;

const AssistantCell = styled.article`
  display: block;
  min-width: 0;
  padding: 2px 0 20px;
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
  gap: 10px;
  margin: 0 0 18px;
  border: 1px solid var(--thread-border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--thread-muted);
  font-size: var(--thread-detail-font-size);
  line-height: 1.5;
  background: #1b1b1b;
  user-select: text;
  -webkit-user-select: text;
`;

const TranscriptActivityHeader = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
`;

const TranscriptActivityTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--thread-muted);
  font-weight: 520;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  -webkit-user-select: text;
`;

const TranscriptActivityStatus = styled.span`
  min-width: 0;
  color: rgba(223, 165, 90, 0.82);
  font-size: var(--thread-detail-mini-font-size);
  font-weight: 520;
  line-height: 1;
  text-transform: uppercase;
  user-select: text;
  -webkit-user-select: text;
`;

const TranscriptActivityBody = styled.pre`
  max-height: 290px;
  min-width: 0;
  margin: 6px 0 0;
  overflow-x: hidden;
  overflow-y: auto;
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  padding: 2px 0 2px 12px;
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
  color: var(--thread-blue);
  user-select: none;
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

const ComposerShell = styled.form`
  display: grid;
  width: min(100%, 640px);
  gap: 8px;
  margin: 0 auto;
  padding: 0 22px 24px;
  background: var(--thread-bg);
  user-select: none;
`;

const ComposerBox = styled.div`
  display: grid;
  min-height: 88px;
  grid-template-rows: auto minmax(42px, auto) auto;
  position: relative;
  overflow: visible;
  border: 1px solid transparent;
  border-radius: 22px;
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
  min-height: 42px;
  max-height: 126px;
  resize: none;
  padding: 13px 16px 5px;
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
  gap: 10px;
  padding: 0 12px 12px;
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
  gap: 7px;
`;

const ComposerToolButton = styled.button`
  display: inline-flex;
  min-width: 0;
  height: 29px;
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

const AgentButton = styled(ComposerToolButton)`
  max-width: min(150px, 28vw);
  color: #e6e6e6;
  cursor: default;
  pointer-events: none;

  &:hover {
    border-color: transparent;
    background: rgba(255, 255, 255, 0.045);
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
  width: 34px;
  height: 34px;
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
    width: 19px;
    height: 19px;
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

const NewChatAttachButton = styled(ComposerToolButton)`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--thread-muted);
  background: transparent;

  &:hover:not(:disabled) {
    background: var(--thread-accent);
  }
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
const MODEL_OPTIONS = {
  claude: [
    { detail: "Balanced Claude Code default", label: "Sonnet", value: "sonnet" },
    { detail: "Higher capability", label: "Opus", value: "opus" },
    { detail: "Fastest Claude option", label: "Haiku", value: "haiku" },
  ],
  codex: [
    { detail: "Latest Codex model", label: "5.5", value: "gpt-5.5" },
    { detail: "Balanced coding model", label: "5.4", value: "gpt-5.4" },
    { detail: "Fast coding model", label: "5.3 Codex Spark", value: "gpt-5.3-codex-spark" },
    { detail: "Long-running work model", label: "5.2", value: "gpt-5.2" },
    { detail: "Older Codex model", label: "5.1", value: "gpt-5.1" },
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

function getLiveTerminalBindingForThread(thread, providerBinding, workspaceThreadEntry) {
  if (!thread) {
    return null;
  }

  const storedBinding = providerBinding?.terminalBinding || thread?.terminalBinding;
  const terminalIndex = storedBinding?.terminalIndex ?? thread?.terminalIndex;
  const terminalKey = terminalIndex == null ? "" : String(terminalIndex);
  const terminal = terminalKey ? workspaceThreadEntry?.terminals?.[terminalKey] : null;
  if (!terminal) {
    return null;
  }

  if (
    terminal.threadId !== thread?.id
    || !["active", "starting"].includes(String(terminal.status || "").toLowerCase())
  ) {
    return null;
  }

  if (storedBinding?.paneId && terminal.paneId && storedBinding.paneId !== terminal.paneId) {
    return null;
  }

  if (
    storedBinding?.instanceId
    && terminal.instanceId
    && Number(storedBinding.instanceId) !== Number(terminal.instanceId)
  ) {
    return null;
  }

  return {
    instanceId: terminal.instanceId,
    paneId: terminal.paneId,
    terminalIndex: terminal.terminalIndex,
  };
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
  const explicitValue = String(
    option?.thinkingPower
      || option?.reasoningEffort
      || option?.reasoning_effort
      || option?.thinkingBudget
      || option?.thinking_budget
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
    <NewChatRoot aria-label="New chat">
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
                <AddPhotoAlternate aria-hidden="true" />
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
    .replace(/^["'`(]+|["'`).,;:]+$/g, "")
    .replace(/\\/g, "/")
    .replace(/:\d+$/, "");
}

function openWorkspaceFile(workspace, filePath) {
  const relativePath = cleanFileReference(filePath);
  if (!relativePath || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(WORKSPACE_FILE_OPEN_EVENT, {
    detail: {
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

function buildActivityItems(thread, messages = []) {
  if (!thread) {
    return [];
  }

  const items = [];
  const latestTurn = thread.latestTurn || null;
  const turnState = threadLatestTurnState(thread);
  const isThinking = turnState === "running" || thread.activityStatus === "thinking";
  const latestTurnUserMessage = getLatestTurnUserMessage(messages, latestTurn?.turnId);
  const latestTurnIsSlashCommand = isSlashCommandPrompt(latestTurnUserMessage?.text);

  if (latestTurnIsSlashCommand) {
    return items;
  }

  if (turnState === "running") {
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

function getToolCallLabel(message) {
  const title = String(message?.title || "").trim();
  const genericTitles = new Set(["activity", "tool call", "tool output"]);
  if (title && !genericTitles.has(title.toLowerCase())) {
    return title;
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

function buildTranscriptItems(messages) {
  return (Array.isArray(messages) ? messages : []).map((message, index) => ({
    id: message?.id || `message-${index}`,
    message,
    type: "message",
  }));
}

function isChatProjectionMessage(message) {
  const kind = String(message?.kind || "").trim().toLowerCase();
  const source = String(message?.source || "").trim().toLowerCase();
  if (message?.role === "user" && isSlashCommandPrompt(message?.text)) {
    return false;
  }
  return kind !== "live_output" && source !== "terminal-live";
}

function ActivityMessage({ message }) {
  if (!message) {
    return null;
  }

  const label = getToolCallLabel(message);
  const status = String(message.status || "").trim();
  const body = String(message.text || "").trim();
  const kind = String(message.kind || "activity").trim().toLowerCase();

  return (
    <TranscriptActivityCell data-kind={kind} data-message-role="activity" data-status={status || "complete"}>
      <ActivityBullet aria-hidden="true">{"\u2022"}</ActivityBullet>
      <div>
        <TranscriptActivityHeader>
          <TranscriptActivityTitle title={label}>{label}</TranscriptActivityTitle>
          {status ? <TranscriptActivityStatus>{status}</TranscriptActivityStatus> : null}
        </TranscriptActivityHeader>
        {body ? <TranscriptActivityBody>{body}</TranscriptActivityBody> : null}
      </div>
    </TranscriptActivityCell>
  );
}

function ThreadMessage({ message, workspace }) {
  if (!message) {
    return null;
  }

  if (message.role === "assistant") {
    return (
      <AssistantCell data-message-role="assistant">
        <AssistantPrefix aria-hidden="true">{"."}</AssistantPrefix>
        <MessageBody>
          <MessageText>
            <MessageTextContent message={message} workspace={workspace} />
          </MessageText>
        </MessageBody>
      </AssistantCell>
    );
  }

  if (message.role === "activity") {
    return <ActivityMessage message={message} />;
  }

  return (
    <UserCell data-message-role="user">
      <UserPrefix aria-hidden="true">{"\u203a"}</UserPrefix>
      <MessageBody>
        <MessageText>
          <MessageTextContent message={message} workspace={workspace} />
        </MessageText>
      </MessageBody>
    </UserCell>
  );
}

function WorkspaceThreadDetail({
  agentStatuses,
  composerAttachments,
  composerDrafts,
  newChatActive = false,
  onCreateChat,
  onDraftInput,
  onSelectModel,
  onSubmitMessage,
  thread,
  workspace,
  workspaceThreadEntry,
}) {
  const [draft, setDraft] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const composerBoxRef = useRef(null);
  const fileInputRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const messages = Array.isArray(thread?.messages)
    ? thread.messages.filter(isChatProjectionMessage)
    : [];
  const transcriptItems = useMemo(() => buildTranscriptItems(messages), [messages]);
  const activityItems = useMemo(() => buildActivityItems(thread, messages), [messages, thread]);
  const latestMessage = messages[messages.length - 1] || null;
  const latestActivity = activityItems[activityItems.length - 1] || null;
  const activeAgentId = normalizeAgentId(thread?.currentAgent || "codex");
  const activeAgentStatus = useMemo(
    () => findAgentStatus(agentStatuses, activeAgentId),
    [activeAgentId, agentStatuses],
  );
  const activeProviderBinding = getWorkspaceThreadProviderBinding(thread, activeAgentId);
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
  const activeTerminalBinding = getLiveTerminalBindingForThread(
    thread,
    activeProviderBinding,
    workspaceThreadEntry,
  );
  const hasActiveTerminalBinding = Boolean(activeTerminalBinding?.paneId && activeTerminalBinding?.instanceId);
  const hasProviderSession = getWorkspaceThreadHasSession(thread);
  const composerSyncKey = [
    thread?.workspaceId || workspace?.id || "",
    thread?.id || "",
    activeTerminalBinding?.paneId || "",
  ].join(":");
  const syncedComposerDraft = String(composerDrafts?.[composerSyncKey] || "");
  const attachments = Array.isArray(composerAttachments?.[composerSyncKey])
    ? composerAttachments[composerSyncKey]
    : [];
  const canSubmit = Boolean(thread && (hasActiveTerminalBinding || hasProviderSession));
  const agentLabel = AGENT_LABELS[activeAgentId] || "agent";
  const selectedModelOption = modelOptions.find((option) => option.value === currentTuiModel) || modelOptions[0];
  const modelButtonLabel = getModelButtonLabel(selectedModelOption);
  const imageInputSupport = getImageInputSupport(activeAgentId, activeAgentStatus, currentTuiModel);
  const placeholder = hasActiveTerminalBinding
    ? `Ask ${agentLabel} to work in this thread`
    : hasProviderSession
      ? `Ask ${agentLabel} to resume this thread`
      : `No ${agentLabel} session is available for this thread`;
  const submitDisabled = sending || !canSubmit || (!draft.trim() && attachments.length === 0);

  useEffect(() => {
    setSelectedModel(modelOptions[0]?.value || "");
    setModelMenuOpen(false);
  }, [activeAgentId, modelOptions, thread?.id]);

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
      requestIncludesThinkingPower: false,
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
      <DetailRoot>
        <TranscriptScroll>
          <TranscriptInner>
            <EmptyThread>Select a thread</EmptyThread>
          </TranscriptInner>
        </TranscriptScroll>
      </DetailRoot>
    );
  }

  return (
    <DetailRoot aria-label={getWorkspaceThreadLabel(thread)}>
      <TranscriptScroll ref={transcriptScrollRef}>
        <TranscriptInner>
          {transcriptItems.map((item) => (
            <ThreadMessage key={item.id} message={item.message} workspace={workspace} />
          ))}

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
            rows={1}
            spellCheck="true"
            value={draft}
          />
          <ComposerFooter>
            <ComposerControls>
              <ComposerToolButton
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
                <AddPhotoAlternate aria-hidden="true" />
              </ComposerToolButton>
              <AgentButton
                aria-disabled="true"
                tabIndex={-1}
                title={AGENT_LABELS[activeAgentId] || "Agent"}
                type="button"
              >
                <span>{AGENT_LABELS[activeAgentId] || "Agent"}</span>
                <ExpandMore aria-hidden="true" />
              </AgentButton>
            </ComposerControls>
            <ComposerActions>
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
                      data-selected={option.value === selectedModel ? "true" : "false"}
                      key={option.value || option.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectModel(option)}
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
    </DetailRoot>
  );
}

export default memo(WorkspaceThreadDetail);
