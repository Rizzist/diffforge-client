import { invoke } from "@tauri-apps/api/core";
import { AddPhotoAlternate } from "@styled-icons/material-rounded/AddPhotoAlternate";
import { ArrowUpward } from "@styled-icons/material-rounded/ArrowUpward";
import { Close } from "@styled-icons/material-rounded/Close";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

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
  --thread-bg: #09090b;
  --thread-card: #0d0d10;
  --thread-fg: #f4f4f5;
  --thread-muted: #a1a1aa;
  --thread-muted-soft: rgba(161, 161, 170, 0.48);
  --thread-border: rgba(255, 255, 255, 0.065);
  --thread-accent: rgba(255, 255, 255, 0.055);
  --thread-secondary: rgba(255, 255, 255, 0.045);
  --thread-ring: rgba(98, 132, 255, 0.46);
  color: var(--thread-fg);
  background: var(--thread-bg);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  user-select: text;
  -webkit-user-select: text;

  *::selection {
    color: #ffffff;
    background: rgba(85, 132, 199, 0.42);
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
    background: rgba(255, 255, 255, 0.1);
  }
`;

const TranscriptInner = styled.div`
  display: grid;
  width: min(100%, 768px);
  min-height: 100%;
  align-content: end;
  gap: 0;
  margin: 0 auto;
  padding: 28px 24px 20px;
  user-select: text;
  -webkit-user-select: text;
`;

const EmptyThread = styled.div`
  align-self: center;
  justify-self: center;
  max-width: 360px;
  color: var(--thread-muted-soft);
  font-size: 13px;
  line-height: 1.45;
  text-align: center;
`;

const UserCell = styled.article`
  display: flex;
  min-width: 0;
  justify-content: flex-end;
  padding: 0 0 16px;
  color: var(--thread-fg);
  font-size: 14px;
  line-height: 1.58;
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
  font-size: 14px;
  font-weight: 430;
  letter-spacing: 0;
  line-height: 1.65;
  user-select: text;
  -webkit-user-select: text;
`;

const MessageBody = styled.div`
  display: grid;
  min-width: 0;
  gap: 7px;

  article[data-message-role="user"] & {
    max-width: min(80%, 620px);
    border: 1px solid var(--thread-border);
    border-radius: 18px 18px 4px;
    padding: 12px 15px;
    background: var(--thread-secondary);
  }

  article[data-message-role="assistant"] & {
    width: 100%;
    padding: 1px 4px;
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
  background: rgba(255, 255, 255, 0.08);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
  font-weight: 560;
`;

const MessageFileLink = styled.button`
  display: inline;
  min-width: 0;
  padding: 0;
  border: 0;
  color: #93c5fd;
  background: transparent;
  font: inherit;
  font-weight: 560;
  text-align: left;
  text-decoration: none;
  user-select: text;
  -webkit-user-select: text;

  &:hover {
    color: #bfdbfe;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
`;

const AssistantCell = styled.article`
  display: block;
  min-width: 0;
  padding: 0 0 16px;
  color: var(--thread-fg);
  font-size: 14px;
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
  padding: 2px 4px 12px;
  color: var(--thread-muted);
  font-size: 12px;
  line-height: 1.5;
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
  color: var(--thread-muted-soft);
  font-size: 10px;
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
  border-left: 1px solid var(--thread-border);
  padding: 2px 0 2px 11px;
  color: var(--thread-muted);
  background: transparent;
  font: inherit;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
`;

const ActivityCell = styled.article`
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 8px;
  padding: 0 4px 12px;
  color: var(--thread-muted);
  font-size: 12px;
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;
`;

const ActivityBullet = styled.span`
  color: var(--thread-muted-soft);
  user-select: none;
`;

const ActivityText = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
  width: min(100%, 832px);
  gap: 8px;
  margin: 0 auto;
  padding: 0 24px 18px;
  background: var(--thread-bg);
  user-select: none;
`;

const ComposerBox = styled.div`
  display: grid;
  min-height: 118px;
  grid-template-rows: auto minmax(70px, auto) auto;
  overflow: hidden;
  border: 1px solid var(--thread-border);
  border-radius: 20px;
  background: var(--thread-card);
  box-shadow: none;
  transition:
    border-color 160ms ease,
    background 160ms ease;

  &:focus-within {
    border-color: var(--thread-ring);
  }
`;

const ComposerInput = styled.textarea`
  width: 100%;
  min-height: 70px;
  max-height: 200px;
  resize: none;
  padding: 15px 16px 8px;
  border: 0;
  outline: none;
  color: var(--thread-fg);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 1.65;
  user-select: text;
  -webkit-user-select: text;

  &::placeholder {
    color: var(--thread-muted-soft);
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
  gap: 8px;
  padding: 0 12px 12px;
  user-select: none;
`;

const ComposerHint = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--thread-muted-soft);
  font-size: 11px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ComposerControls = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
`;

const ComposerToolButton = styled.button`
  display: inline-flex;
  min-width: 0;
  height: 24px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 7px;
  border: 0;
  border-radius: 8px;
  color: var(--thread-muted);
  background: transparent;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  user-select: none;
  transition:
    background 120ms ease,
    color 120ms ease,
    opacity 120ms ease;

  &:hover:not(:disabled) {
    color: var(--thread-fg);
    background: var(--thread-accent);
  }

  &:disabled {
    opacity: 0.44;
    cursor: not-allowed;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const ModelMenuWrap = styled.div`
  position: relative;
  min-width: 0;
`;

const ModelButton = styled(ComposerToolButton)`
  max-width: min(260px, 38vw);
  color: var(--thread-fg);

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
  bottom: calc(100% + 6px);
  z-index: 4;
  display: none;
  width: min(280px, 70vw);
  overflow: hidden;
  border: 1px solid var(--thread-border);
  border-radius: 12px;
  background: var(--thread-card);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);

  &[data-open="true"] {
    display: grid;
  }
`;

const ModelOption = styled.button`
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 9px 10px;
  border: 0;
  color: var(--thread-fg);
  background: transparent;
  text-align: left;
  font: inherit;
  user-select: none;

  &:hover,
  &[data-selected="true"] {
    background: var(--thread-accent);
  }

  strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--thread-muted);
    font-size: 11px;
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
  padding: 8px 9px 0;

  &:empty {
    display: none;
  }
`;

const AttachmentChip = styled.span`
  display: inline-flex;
  max-width: 220px;
  height: 24px;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--thread-border);
  border-radius: 8px;
  padding: 0 6px 0 8px;
  color: var(--thread-fg);
  background: rgba(255, 255, 255, 0.035);
  font-size: 11px;
  line-height: 1;
  user-select: none;

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

const HiddenFileInput = styled.input`
  display: none;
`;

const SendButton = styled.button`
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: #09090b;
  background: #f4f4f5;
  user-select: none;
  transition:
    background 130ms ease,
    border-color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled) {
    background: #ffffff;
  }

  &:disabled {
    opacity: 0.46;
    cursor: not-allowed;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const ComposerError = styled.div`
  color: #fca5a5;
  font-size: 11px;
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
  --thread-bg: #09090b;
  --thread-card: #0d0d10;
  --thread-fg: #f4f4f5;
  --thread-muted: #a1a1aa;
  --thread-muted-soft: rgba(161, 161, 170, 0.48);
  --thread-border: rgba(255, 255, 255, 0.065);
  --thread-accent: rgba(255, 255, 255, 0.055);
  --thread-ring: rgba(98, 132, 255, 0.46);
  color: var(--thread-fg);
  background: var(--thread-bg);
`;

const NewChatCenter = styled.form`
  display: grid;
  width: min(100%, 832px);
  gap: 28px;
`;

const NewChatTitle = styled.h1`
  margin: 0;
  color: var(--thread-fg);
  font-size: clamp(25px, 4vw, 40px);
  font-weight: 430;
  letter-spacing: 0;
  line-height: 1.12;
  text-align: center;
`;

const NewChatBox = styled.div`
  display: grid;
  min-height: 132px;
  grid-template-rows: minmax(76px, auto) auto;
  overflow: hidden;
  border: 1px solid var(--thread-border);
  border-radius: 20px;
  background: var(--thread-card);
  box-shadow: none;

  &:focus-within {
    border-color: var(--thread-ring);
  }
`;

const NewChatInput = styled.textarea`
  width: 100%;
  min-height: 76px;
  max-height: 220px;
  resize: none;
  padding: 15px 16px 8px;
  border: 0;
  outline: 0;
  color: var(--thread-fg);
  background: transparent;
  font: inherit;
  font-size: 16px;
  line-height: 1.6;
  user-select: text;
  -webkit-user-select: text;

  &::placeholder {
    color: var(--thread-muted-soft);
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

const NewChatSelect = styled.select`
  max-width: 190px;
  height: 32px;
  min-width: 112px;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0 28px 0 12px;
  color: var(--thread-fg);
  background: rgba(255, 255, 255, 0.045);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  outline: none;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

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
  border-radius: 999px;
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
  background: #f4f4f5;

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
    { detail: "Codex default", label: "5.5 Extra High", value: "gpt-5.5" },
    { detail: "Balanced coding model", label: "5.4", value: "gpt-5.4" },
    { detail: "Fast coding model", label: "5.3 Codex Spark", value: "gpt-5.3-codex-spark" },
    { detail: "Reasoning model", label: "o3", value: "o3" },
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
  const storedBinding = providerBinding?.terminalBinding || thread?.terminalBinding;
  const terminalIndex = storedBinding?.terminalIndex ?? thread?.terminalIndex;
  const terminalKey = terminalIndex == null ? "" : String(terminalIndex);
  const terminal = terminalKey ? workspaceThreadEntry?.terminals?.[terminalKey] : null;
  if (
    terminal?.threadId !== thread?.id
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

function modelLooksImageCapable(model) {
  const normalized = String(model || "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if ([
    "gpt-3.5",
    "o1-mini",
    "o3-mini",
    "deepseek",
    "codestral",
    "devstral",
    "llama",
    "qwen-coder",
    "kimi",
  ].some((marker) => normalized.includes(marker))) {
    return false;
  }

  if ([
    "gpt-4o",
    "gpt-4.1",
    "gpt-5",
    "claude-3",
    "claude-opus-4",
    "claude-sonnet-4",
    "claude-haiku-4",
    "sonnet-4",
    "opus-4",
    "gemini",
    "pixtral",
    "llava",
    "minicpm-v",
    "vision",
    "multimodal",
    "omni",
    "qwen-vl",
    "qwen2-vl",
    "qwen2.5-vl",
  ].some((marker) => normalized.includes(marker))
    || normalized.includes("-vl")
    || normalized.includes("/vl")
    || normalized.endsWith(":vl")) {
    return true;
  }

  return null;
}

function getModelOptions(agentId, status, binding = null) {
  const normalizedAgentId = normalizeAgentId(agentId);
  const sessionModel = String(binding?.modelId || binding?.model || "").trim();
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
      label: "Default",
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
  const statusSupport = String(status?.imageInputSupport || "").trim().toLowerCase();
  const activeModel = String(selectedModel || getStatusModel(status)).trim();

  if (normalizedAgentId === "codex" || normalizedAgentId === "claude") {
    return {
      activeModel,
      reason: status?.imageInputReason || `${AGENT_LABELS[normalizedAgentId]} supports image input.`,
      supported: true,
    };
  }

  if (normalizedAgentId === "opencode") {
    if (status?.imageInputSupported === true || statusSupport === "supported") {
      return {
        activeModel,
        reason: status?.imageInputReason || "OpenCode is using an image-capable model.",
        supported: true,
      };
    }

    const modelSupport = modelLooksImageCapable(activeModel);
    if (modelSupport === true) {
      return {
        activeModel,
        reason: `OpenCode is using an image-capable model (${activeModel}).`,
        supported: true,
      };
    }

    return {
      activeModel,
      reason: activeModel
        ? `OpenCode image support is not available for ${activeModel}.`
        : "OpenCode image input depends on the selected model.",
      supported: false,
    };
  }

  return {
    activeModel,
    reason: "This terminal does not accept image input.",
    supported: false,
  };
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("Choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.onload = () => resolve({
      dataUrl: String(reader.result || ""),
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mimeType: file.type,
      name: file.name || "image",
      size: file.size || 0,
    });
    reader.readAsDataURL(file);
  });
}

function formatSavedImageAttachments(images) {
  return (Array.isArray(images) ? images : [])
    .map((image, index) => {
      const name = String(image?.name || `image-${index + 1}`).trim();
      const path = String(image?.path || "").trim();
      return path ? `[image-attached ${index + 1}] ${name} -> ${path}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function saveImageAttachments(attachments) {
  const images = (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      name: attachment.name,
    }))
    .filter((attachment) => attachment.dataUrl && attachment.mimeType);

  if (!images.length) {
    return "";
  }

  const savedImages = await invoke("save_todo_image_attachments", { images });
  const imageBlock = formatSavedImageAttachments(savedImages);

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
  const selectedModelOption = modelOptions.find((option) => option.value === selectedModel) || modelOptions[0];
  const imageInputSupport = getImageInputSupport(activeAgentId, activeAgentStatus, selectedModel);
  const workspaceName = workspace?.name || "Current workspace";
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
  }, [agentStatuses]);

  useEffect(() => {
    setSelectedModel(modelOptions[0]?.value || "");
    setModelMenuOpen(false);
  }, [activeAgentId, modelOptions]);

  const addImageFiles = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, IMAGE_ATTACHMENT_LIMIT - attachments.length);
    if (!files.length) {
      return;
    }

    setError("");
    try {
      const nextAttachments = await Promise.all(files.map(readImageFile));
      setAttachments((currentAttachments) => (
        currentAttachments.concat(nextAttachments).slice(0, IMAGE_ATTACHMENT_LIMIT)
      ));
    } catch (readError) {
      setError(readError?.message || "Unable to attach image.");
    }
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((currentAttachments) => (
      currentAttachments.filter((attachment) => attachment.id !== attachmentId)
    ));
  };

  const submitNewChat = async () => {
    const text = draft.trim();
    if (submitDisabled) {
      return;
    }

    const previousDraft = draft;
    const previousAttachments = attachments;
    setSending(true);
    setError("");
    setDraft("");
    setAttachments([]);
    try {
      const imageBlock = await saveImageAttachments(previousAttachments);
      const message = [text, imageBlock].filter(Boolean).join("\n\n");

      await onCreateChat?.({
        agentId: activeAgentId,
        message,
        model: selectedModel,
        workspace,
      });
    } catch (submitError) {
      setDraft(previousDraft);
      setAttachments(previousAttachments);
      setError(submitError?.message || "Unable to start chat.");
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
        <NewChatBox>
          <NewChatInput
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitNewChat();
              }
            }}
            placeholder={`Ask ${AGENT_LABELS[activeAgentId] || "an agent"} anything`}
            rows={3}
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
              <NewChatSelect
                aria-label="Coding agent"
                disabled={sending}
                onChange={(event) => setAgentId(event.target.value)}
                value={activeAgentId}
              >
                {agentOptions.map((option) => (
                  <option disabled={option.disabled} key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NewChatSelect>
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
                  <span>{selectedModelOption?.label || "Default"}</span>
                  <ExpandMore aria-hidden="true" />
                </ModelButton>
                <ModelDropdown data-open={modelMenuOpen ? "true" : "false"} role="menu">
                  {modelOptions.map((option) => (
                    <ModelOption
                      data-selected={option.value === selectedModel ? "true" : "false"}
                      key={option.value || option.label}
                      onClick={() => {
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
              <NewChatProject title={workspaceName}>{workspaceName}</NewChatProject>
            </NewChatControls>
            <NewChatSendButton
              aria-label="Start chat"
              disabled={submitDisabled}
              title="Start chat"
              type="submit"
            >
              <ArrowUpward aria-hidden="true" />
            </NewChatSendButton>
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

function buildActivityItems(thread, messages = []) {
  if (!thread) {
    return [];
  }

  const items = [];
  const latestTurn = thread.latestTurn || null;
  const turnState = threadLatestTurnState(thread);
  const isThinking = turnState === "running" || thread.activityStatus === "thinking";

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
  const [attachments, setAttachments] = useState([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
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
  const activeProviderModelId = activeProviderBinding?.modelId || "";
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
    activeTerminalBinding?.instanceId || "",
  ].join(":");
  const syncedComposerDraft = String(composerDrafts?.[composerSyncKey] || "");
  const canSubmit = Boolean(thread && (hasActiveTerminalBinding || hasProviderSession));
  const agentLabel = AGENT_LABELS[activeAgentId] || "agent";
  const selectedModelOption = modelOptions.find((option) => option.value === selectedModel) || modelOptions[0];
  const imageInputSupport = getImageInputSupport(activeAgentId, activeAgentStatus, selectedModel);
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
    setDraft(syncedComposerDraft);
  }, [composerSyncKey, syncedComposerDraft]);

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

    setError("");
    try {
      const nextAttachments = await Promise.all(files.map(readImageFile));
      setAttachments((currentAttachments) => (
        currentAttachments.concat(nextAttachments).slice(0, IMAGE_ATTACHMENT_LIMIT)
      ));
    } catch (readError) {
      setError(readError?.message || "Unable to attach image.");
    }
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((currentAttachments) => (
      currentAttachments.filter((attachment) => attachment.id !== attachmentId)
    ));
  };

  const selectModel = async (option) => {
    const nextModel = String(option?.value || "").trim();
    setSelectedModel(nextModel);
    setModelMenuOpen(false);
    setError("");

    if (!nextModel || !thread || !hasActiveTerminalBinding) {
      return;
    }

    try {
      await onSelectModel?.({
        agentId: activeAgentId,
        model: nextModel,
        thread,
        workspace,
      });
    } catch (modelError) {
      setError(modelError?.message || "Unable to change model.");
    }
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
    setDraft("");
    setAttachments([]);
    try {
      const imageBlock = await saveImageAttachments(previousAttachments);
      const message = [text, imageBlock].filter(Boolean).join("\n\n");

      await onSubmitMessage?.({
        message,
        model: selectedModel,
        thread,
        workspace,
      });
    } catch (submitError) {
      setDraft(previousDraft);
      setAttachments(previousAttachments);
      setError(submitError?.message || "Unable to send message.");
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
          {messages.length === 0 && activityItems.length === 0 ? (
            <EmptyThread>{getWorkspaceThreadLabel(thread)}</EmptyThread>
          ) : null}

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
        <ComposerBox>
          <AttachmentStrip>
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
          </AttachmentStrip>
          <ComposerInput
            disabled={!canSubmit || sending}
            onChange={(event) => {
              const previousDraft = draft;
              const nextDraft = event.target.value;
              setDraft(nextDraft);
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
            placeholder={placeholder}
            rows={2}
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
                  <span>{selectedModelOption?.label || "Default"}</span>
                  <ExpandMore aria-hidden="true" />
                </ModelButton>
                <ModelDropdown data-open={modelMenuOpen ? "true" : "false"} role="menu">
                  {modelOptions.map((option) => (
                    <ModelOption
                      data-selected={option.value === selectedModel ? "true" : "false"}
                      key={option.value || option.label}
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
            </ComposerControls>
            <ComposerHint>{workspace?.name || thread.workspaceId || "Workspace"}</ComposerHint>
            <SendButton
              aria-label="Send message"
              disabled={submitDisabled}
              title="Send message"
              type="submit"
            >
              <ArrowUpward aria-hidden="true" />
            </SendButton>
          </ComposerFooter>
        </ComposerBox>
        {error ? <ComposerError>{error}</ComposerError> : null}
      </ComposerShell>
    </DetailRoot>
  );
}

export default memo(WorkspaceThreadDetail);
