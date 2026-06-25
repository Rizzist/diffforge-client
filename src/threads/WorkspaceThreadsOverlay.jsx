import { ChevronLeft } from "@styled-icons/material-rounded/ChevronLeft";
import { ChevronRight } from "@styled-icons/material-rounded/ChevronRight";
import { Close } from "@styled-icons/material-rounded/Close";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Edit } from "@styled-icons/fa-regular/Edit";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { Search } from "@styled-icons/material-rounded/Search";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import { logBigViewSyncDiagnosticEvent } from "./bigViewSyncDiagnostics";
import { getThreadTerminalGroundTruth } from "./threadTerminalGroundTruth.js";
import WorkspaceThreadDetail from "./WorkspaceThreadDetail.jsx";
import {
  getWorkspaceThreadAgentLabel,
  getWorkspaceThreadCanArchive,
  getWorkspaceThreadCanPin,
  getWorkspaceThreadIsPinned,
  getWorkspaceThreadLabel,
  getWorkspaceThreadProviderBinding,
  getWorkspaceThreadTurnState,
} from "./workspaceThreads";

const THREAD_VIEW_STATE = {
  LIVE_SESSION: "live-session",
  LIVE_NO_SESSION: "live-no-session",
  DETACHED_SESSION: "detached-session",
  INACTIVE_NO_SESSION: "inactive-no-session",
};
const overlayFadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

const overlayPanelIn = keyframes`
  from {
    opacity: 0;
    transform: scale(0.985);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
`;

const threadActivitySweep = keyframes`
  from {
    transform: translateX(220%);
  }

  to {
    transform: translateX(-120%);
  }
`;

const OverlayRoot = styled.div`
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  min-width: 0;
  min-height: 0;
  --thread-bg: #050505;
  --thread-bg-soft: #080808;
  --thread-card: rgba(32, 32, 32, 0.92);
  --thread-fg: #f4f7fa;
  --thread-muted: #a5a7ad;
  --thread-muted-soft: rgba(165, 167, 173, 0.58);
  --thread-border: rgba(255, 255, 255, 0.08);
  --thread-accent: rgba(255, 255, 255, 0.07);
  --thread-accent-strong: rgba(255, 255, 255, 0.1);
  --thread-primary: rgba(255, 255, 255, 0.1);
  --thread-primary-hover: rgba(255, 255, 255, 0.13);
  --thread-blue: #a8a8a8;
  --thread-ember: #dfa55a;
  --thread-green: #3ccb7f;
  --thread-red: #ef6b6b;
  --thread-rail-bg: #101820;
  --thread-rail-image: url("/textures/thread-rail-carbon-fiber.png");
  --thread-rail-image-size: 64px 64px;
  --thread-rail-sheen: rgba(255, 255, 255, 0.045);
  --thread-rail-tint: rgba(6, 10, 16, 0.28);
  --thread-rail-edge: rgba(0, 0, 0, 0.5);
  --thread-rail-fg: #e9e9e9;
  --thread-rail-fg-soft: rgba(233, 233, 233, 0.72);
  --thread-rail-icon: rgba(233, 233, 233, 0.78);
  --thread-rail-icon-soft: rgba(233, 233, 233, 0.68);
  --thread-rail-muted: rgba(225, 225, 225, 0.52);
  --thread-rail-muted-soft: rgba(225, 225, 225, 0.48);
  --thread-rail-placeholder: rgba(233, 233, 233, 0.42);
  --thread-rail-search-border: rgba(255, 255, 255, 0.1);
  --thread-rail-search-bg: rgba(0, 0, 0, 0.18);
  --thread-rail-search-focus-border: rgba(255, 255, 255, 0.2);
  --thread-rail-search-focus-bg: rgba(0, 0, 0, 0.24);
  --thread-rail-row-fg: rgba(236, 236, 236, 0.86);
  --thread-rail-row-hover: rgba(255, 255, 255, 0.075);
  --thread-rail-row-selected: rgba(255, 255, 255, 0.105);
  --thread-rail-row-selected-hover: rgba(255, 255, 255, 0.13);
  --thread-rail-action-hover: rgba(255, 255, 255, 0.095);
  color: var(--thread-fg);
  background:
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.014) 1px, transparent 1px),
    #050505;
  background-size: 86px 86px, 86px 86px, auto;
  animation: ${overlayFadeIn} 140ms ease both;
  backdrop-filter: blur(10px);
  pointer-events: auto;
  user-select: text;

  html[data-forge-theme="light"] & {
    --thread-bg: #f5f5f7;
    --thread-bg-soft: #ffffff;
    --thread-card: #ffffff;
    --thread-fg: #1d1d1f;
    --thread-muted: #7a7a7a;
    --thread-muted-soft: rgba(122, 122, 122, 0.64);
    --thread-border: rgba(0, 0, 0, 0.08);
    --thread-accent: rgba(0, 0, 0, 0.045);
    --thread-accent-strong: rgba(0, 0, 0, 0.08);
    --thread-primary: rgba(0, 102, 204, 0.09);
    --thread-primary-hover: rgba(0, 102, 204, 0.13);
    --thread-blue: #0066cc;
    --thread-ember: #0066cc;
    --thread-green: #0a7f45;
    --thread-red: #b42318;
    --thread-rail-bg: #f1ead2;
    --thread-rail-image: url("/textures/thread-rail-carbon-fiber-light.png");
    --thread-rail-sheen: rgba(255, 255, 255, 0.55);
    --thread-rail-tint: rgba(255, 251, 240, 0.4);
    --thread-rail-edge: rgba(88, 66, 22, 0.16);
    --thread-rail-fg: rgba(45, 38, 24, 0.9);
    --thread-rail-fg-soft: rgba(68, 55, 28, 0.66);
    --thread-rail-icon: rgba(62, 52, 35, 0.68);
    --thread-rail-icon-soft: rgba(62, 52, 35, 0.56);
    --thread-rail-muted: rgba(92, 75, 41, 0.62);
    --thread-rail-muted-soft: rgba(92, 75, 41, 0.54);
    --thread-rail-placeholder: rgba(72, 60, 42, 0.44);
    --thread-rail-search-border: rgba(128, 95, 24, 0.16);
    --thread-rail-search-bg: rgba(255, 255, 255, 0.34);
    --thread-rail-search-focus-border: rgba(150, 112, 28, 0.3);
    --thread-rail-search-focus-bg: rgba(255, 255, 255, 0.5);
    --thread-rail-row-fg: rgba(47, 40, 28, 0.82);
    --thread-rail-row-hover: rgba(132, 100, 31, 0.1);
    --thread-rail-row-selected: rgba(132, 100, 31, 0.17);
    --thread-rail-row-selected-hover: rgba(132, 100, 31, 0.22);
    --thread-rail-action-hover: rgba(132, 100, 31, 0.12);
    background: rgba(245, 245, 247, 0.88);
    backdrop-filter: saturate(180%) blur(20px);
  }
`;

const OverlayPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  --thread-rail-expanded-width: clamp(172px, calc(11vw + 40px), 256px);
  grid-template-columns: var(--thread-rail-expanded-width) minmax(0, 1fr);
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.018), transparent 28%),
    var(--thread-bg);
  box-shadow: none;
  animation: ${overlayPanelIn} 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: grid-template-columns 180ms cubic-bezier(0.16, 1, 0.3, 1);

  &[data-rail-collapsed="true"] {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    --thread-rail-expanded-width: clamp(124px, 38vw, 168px);

    &[data-rail-collapsed="true"] {
      grid-template-columns: 48px minmax(0, 1fr);
    }
  }
`;

const ThreadRail = styled.aside`
  position: relative;
  z-index: 2;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  border-right: 1px solid var(--thread-border);
  background-color: var(--thread-rail-bg);
  background-image:
    linear-gradient(180deg, var(--thread-rail-sheen), transparent 150px),
    linear-gradient(var(--thread-rail-tint), var(--thread-rail-tint)),
    var(--thread-rail-image);
  background-repeat: no-repeat, no-repeat, repeat;
  background-size: 100% 100%, 100% 100%, var(--thread-rail-image-size);
  box-shadow: inset -16px 0 26px -20px var(--thread-rail-edge);
`;

const DrawerToggle = styled.button`
  position: absolute;
  top: 12px;
  right: -13px;
  z-index: 4;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  color: #d6d6d6;
  background: rgba(45, 45, 45, 0.96);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
  transition:
    border-color 130ms ease,
    color 130ms ease,
    background 130ms ease,
    transform 130ms ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.16);
    color: var(--thread-fg);
    background: rgba(58, 58, 58, 0.98);
    transform: translateX(1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.22);
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(128, 95, 24, 0.16);
    color: var(--thread-rail-fg);
    background: rgba(255, 255, 255, 0.72);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      0 10px 22px rgba(88, 66, 22, 0.16);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(128, 95, 24, 0.24);
    color: var(--thread-fg);
    background: rgba(255, 255, 255, 0.88);
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const WorkspaceList = styled.div`
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 12px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 26px 12px 16px;
  background: transparent;

  @media (max-width: 1180px) {
    gap: 10px;
    padding-inline: 8px;
  }

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

const RailHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px 2px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--thread-rail-fg);
    font-size: 12px;
    font-weight: 660;
    letter-spacing: 0.02em;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const RailHeaderCount = styled.span`
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--thread-rail-muted);
  background: var(--thread-rail-search-bg);
  font-size: 10px;
  font-weight: 620;
  line-height: 1.6;
`;

const RailActionStack = styled.div`
  display: grid;
  min-width: 0;
  padding-bottom: 10px;
  align-content: start;
  gap: 2px;
`;

const RailActionButton = styled.button`
  display: flex;
  min-width: 0;
  height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--thread-rail-fg);
  background: transparent;
  text-align: left;
  font: inherit;
  opacity: 1;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled),
  &[data-active="true"] {
    color: var(--thread-fg);
    border-color: transparent;
    background: var(--thread-rail-action-hover);
    opacity: 1;
  }

  &:disabled {
    color: var(--thread-rail-fg-soft);
    opacity: 1;
    cursor: not-allowed;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
  }

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 480;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ThreadSearchPanel = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
  padding: 0 0 10px;
`;

const ThreadSearchField = styled.div`
  display: grid;
  min-width: 0;
  height: 31px;
  grid-template-columns: 18px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 5px;
  padding: 0 5px 0 8px;
  border: 1px solid var(--thread-rail-search-border);
  border-radius: 9px;
  color: var(--thread-rail-icon);
  background: var(--thread-rail-search-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);

  &:focus-within {
    border-color: var(--thread-rail-search-focus-border);
    color: var(--thread-fg);
    background: var(--thread-rail-search-focus-bg);
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const ThreadSearchInput = styled.input`
  min-width: 0;
  border: 0;
  color: var(--thread-fg);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 480;
  line-height: 1.2;
  outline: 0;

  &::placeholder {
    color: var(--thread-rail-placeholder);
  }
`;

const ThreadSearchClearButton = styled.button`
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--thread-rail-icon-soft);
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &[data-visible="true"] {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover {
    color: var(--thread-fg);
    background: var(--thread-rail-action-hover);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(255, 255, 255, 0.22);
    outline-offset: 1px;
  }

  svg {
    width: 13px;
    height: 13px;
  }
`;

const ThreadSearchSummary = styled.div`
  min-width: 0;
  padding: 0 6px;
  color: var(--thread-rail-muted-soft);
  font-size: 11px;
  font-weight: 460;
  line-height: 1.2;
`;

const WorkspaceGroup = styled.section`
  display: grid;
  min-width: 0;
  gap: 5px;
`;

const WorkspaceTopline = styled.div`
  min-width: 0;
  padding: 0 5px;
  color: var(--thread-rail-muted);
  font-size: 10px;
  font-weight: 620;
  letter-spacing: 0.07em;
  line-height: 1.2;
  text-transform: uppercase;

  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ThreadList = styled.div`
  display: grid;
  min-width: 0;
  gap: 1px;
  margin: 0;
  padding: 0;
  border-left: 0;
`;

const CollapsedThreadList = styled(ThreadList)`
  place-items: center;
  margin: 0;
  padding: 0;
  border-left: 0;
`;

const CollapsedRail = styled.div`
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 28px 8px 10px;
  background: transparent;
`;

const CollapsedRailActionStack = styled.div`
  display: grid;
  min-width: 0;
  padding-bottom: 2px;
  align-content: start;
  gap: 4px;
`;

const CollapsedRailActionButton = styled.button`
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--thread-rail-fg);
  background: transparent;
  opacity: 1;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled),
  &[data-active="true"] {
    color: var(--thread-fg);
    background: var(--thread-rail-action-hover);
    opacity: 1;
  }

  &:disabled {
    color: var(--thread-rail-fg-soft);
    opacity: 1;
    cursor: not-allowed;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const CollapsedThreadsRegion = styled.div`
  display: grid;
  min-width: 0;
  max-height: 0;
  gap: 8px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition:
    max-height 160ms ease,
    opacity 140ms ease,
    visibility 0s linear 140ms;
  visibility: hidden;
`;

const CollapsedWorkspaceGroup = styled.section`
  display: grid;
  min-width: 0;
  gap: 4px;
`;

const CollapsedWorkspaceMarker = styled.div`
  display: grid;
  width: 100%;
  height: 15px;
  place-items: end center;
  padding-bottom: 3px;

  span {
    width: 18px;
    height: 1px;
    background: var(--thread-border);
    opacity: 0;
  }

  &[data-visible="true"] span {
    opacity: 1;
  }
`;

const CollapsedThreadButton = styled.button`
  position: relative;
  display: grid;
  width: 32px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--thread-rail-muted);
  background: transparent;
  transition:
    background 130ms ease,
    border-color 130ms ease;

  &[data-selected="true"] {
    border-color: transparent;
    background: var(--thread-rail-row-selected);
  }

  &:hover {
    background: var(--thread-rail-row-hover);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.22);
    outline-offset: 2px;
  }
`;

const ThreadRow = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 40px;
  grid-template-columns: minmax(0, 1fr) 15px;
  align-items: center;
  gap: 3px;
  padding: 4px 4px 4px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--thread-rail-row-fg);
  background: transparent;
  font: inherit;
  text-align: left;
  transition:
    background 130ms ease,
    border-color 130ms ease,
    color 130ms ease;

  &::before {
    content: "";
    position: absolute;
    top: 9px;
    bottom: 9px;
    left: 0;
    width: 2px;
    border-radius: 999px;
    background: var(--thread-rail-fg);
    opacity: 0;
    pointer-events: none;
    transition: opacity 130ms ease;
  }

  &[data-selected="true"] {
    border-color: transparent;
    color: var(--thread-fg);
    background: var(--thread-rail-row-selected);
  }

  &[data-selected="true"]::before {
    opacity: 0.75;
  }

  &:hover {
    color: var(--thread-fg);
    border-color: transparent;
    background: var(--thread-rail-row-hover);
  }

  &[data-selected="true"]:hover {
    background: var(--thread-rail-row-selected-hover);
  }
`;

const ThreadSelectButton = styled.button`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-start;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.22);
    outline-offset: 2px;
  }
`;

const ThreadRowText = styled.span`
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  gap: 2px;
  transition: padding-left 130ms ease;

  ${ThreadRow}[data-can-pin="true"]:hover &,
  ${ThreadRow}[data-pinned="true"] & {
    padding-left: 17px;
  }
`;

const ThreadRowMeta = styled.span`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: var(--thread-rail-muted-soft);
  font-size: 9.5px;
  font-weight: 520;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  i {
    flex: 0 0 auto;
    font-style: normal;
    opacity: 0.7;
  }
`;

const ThreadRowTitle = styled.strong`
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  overflow: visible;
  padding-bottom: 2px;
  font-size: 11px;
  font-weight: 540;
  line-height: 1.25;
  text-overflow: clip;
  white-space: normal;

  &::before,
  &::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: 0;
    height: 1px;
    border-radius: 999px;
    opacity: 0;
    pointer-events: none;
  }

  &::before {
    right: 0;
    background: rgba(255, 255, 255, 0.16);
  }

  &::after {
    width: 50%;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0),
      rgba(255, 255, 255, 0.94) 42%,
      rgba(255, 255, 255, 0.94) 62%,
      rgba(255, 255, 255, 0)
    );
    animation: ${threadActivitySweep} 1180ms linear infinite;
  }

  &[data-working="true"]::before {
    opacity: 0.78;
  }

  &[data-working="true"]::after {
    opacity: 1;
  }

  html[data-forge-theme="light"] &::before {
    background: rgba(45, 38, 24, 0.2);
  }

  html[data-forge-theme="light"] &::after {
    background: linear-gradient(
      90deg,
      rgba(45, 38, 24, 0),
      rgba(45, 38, 24, 0.72) 42%,
      rgba(45, 38, 24, 0.72) 62%,
      rgba(45, 38, 24, 0)
    );
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      right: 0;
      left: auto;
      width: 42%;
      animation: none;
      transform: none;
    }
  }
`;

const ThreadRowTitleText = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ThreadPinButton = styled.button`
  position: absolute;
  left: 3px;
  top: 50%;
  z-index: 2;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: rgba(244, 244, 244, 0.74);
  background: rgba(58, 58, 58, 0.98);
  opacity: 0;
  transform: translateY(-50%);
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  ${ThreadRow}:hover &,
  ${ThreadRow}:focus-within &,
  ${ThreadRow}[data-pinned="true"] & {
    opacity: 1;
  }

  ${ThreadRow}[data-pinned="true"] & {
    color: #f2c24e;
    background: rgba(62, 52, 30, 0.9);
  }

  &:hover {
    color: #ffe39a;
    background: rgba(84, 68, 34, 0.98);
  }

  html[data-forge-theme="light"] & {
    color: var(--thread-rail-muted);
    background: rgba(255, 255, 255, 0.88);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.96);
  }

  html[data-forge-theme="light"] ${ThreadRow}[data-pinned="true"] & {
    color: var(--thread-blue);
    background: rgba(0, 102, 204, 0.08);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--thread-blue);
    background: rgba(0, 102, 204, 0.1);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(242, 194, 78, 0.48);
    outline-offset: 1px;
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

const ThreadStatusSlot = styled.span`
  position: relative;
  display: grid;
  width: 15px;
  height: 18px;
  place-items: center;
  justify-self: end;
`;

const ThreadArchiveButton = styled.button`
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: rgba(244, 244, 244, 0.72);
  background: rgba(58, 58, 58, 0.98);
  opacity: 0;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  ${ThreadRow}:hover &,
  ${ThreadRow}:focus-within & {
    opacity: 1;
  }

  &:hover {
    color: #ffd6d6;
    background: rgba(239, 107, 107, 0.14);
  }

  html[data-forge-theme="light"] & {
    color: var(--thread-rail-muted);
    background: rgba(255, 255, 255, 0.88);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.96);
  }

  html[data-forge-theme="light"] &:hover {
    color: var(--thread-red);
    background: rgba(180, 35, 24, 0.08);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(248, 113, 113, 0.48);
    outline-offset: 1px;
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

const TerminalStateDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 99px;
  background: #7a8493;

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"] {
    background: var(--thread-green);
    box-shadow: 0 0 11px rgba(60, 203, 127, 0.32);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_NO_SESSION}"] {
    background: #f2c24e;
    box-shadow: 0 0 11px rgba(242, 194, 78, 0.3);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="starting"] {
    background: #dfa55a;
    box-shadow: 0 0 11px rgba(223, 165, 90, 0.28);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="error"] {
    background: var(--thread-red);
    box-shadow: 0 0 11px rgba(239, 107, 107, 0.28);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="running"] {
    background: #f2c24e;
    box-shadow: 0 0 11px rgba(242, 194, 78, 0.3);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="completed"] {
    background: var(--thread-green);
    box-shadow: 0 0 11px rgba(60, 203, 127, 0.32);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="interrupted"] {
    background: #dfa55a;
    box-shadow: 0 0 11px rgba(223, 165, 90, 0.28);
  }
`;

const EmptyThreads = styled.div`
  padding: 4px 10px;
  color: var(--thread-muted-soft);
  font-size: 12px;
  font-weight: 460;
`;

function threadTimestampMs(value) {
  if (value == null || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.abs(value) > 0 && Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
  }
  const text = String(value || "").trim();
  if (!text) {
    return 0;
  }
  const numeric = Number.parseFloat(text);
  if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(text)) {
    return Math.abs(numeric) > 0 && Math.abs(numeric) < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxThreadTimestampMs(values) {
  return values.reduce((latest, value) => Math.max(latest, threadTimestampMs(value)), 0);
}

function formatThreadRelativeTime(timestampMs) {
  if (!timestampMs) {
    return "";
  }
  const deltaMs = Date.now() - timestampMs;
  if (deltaMs < 60_000) {
    return "now";
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return new Date(timestampMs).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function latestCollectionTimestampMs(values, keys) {
  if (!Array.isArray(values)) {
    return 0;
  }
  return values.reduce((latest, item) => (
    Math.max(latest, maxThreadTimestampMs(keys.map((key) => item?.[key])))
  ), 0);
}

function getThreadSortFreshnessMs(thread, threadState, entry) {
  const providerBinding = getWorkspaceThreadProviderBinding(thread, thread?.currentAgent);
  const terminalBinding = providerBinding?.terminalBinding || thread?.terminalBinding;
  const terminalIndex = terminalBinding?.terminalIndex ?? thread?.terminalIndex;
  const terminalKey = terminalIndex == null ? "" : String(terminalIndex);
  const mappedTerminal = terminalKey ? entry?.terminals?.[terminalKey] : null;
  return maxThreadTimestampMs([
    thread?.lastMessageAt,
    thread?.lastActiveAt,
    thread?.updatedAt,
    thread?.createdAt,
    thread?.pendingPrompt?.updatedAt,
    thread?.pendingPrompt?.submittedAt,
    thread?.pendingPrompt?.createdAt,
    thread?.latestTurn?.updatedAt,
    thread?.latestTurn?.completedAt,
    thread?.latestTurn?.startedAt,
    thread?.latestTurn?.requestedAt,
    thread?.latestTurn?.createdAt,
    providerBinding?.lastMessageAt,
    providerBinding?.lastActiveAt,
    providerBinding?.nativeSessionUpdatedAt,
    providerBinding?.updatedAt,
    mappedTerminal?.lastMessageAt,
    mappedTerminal?.lastActiveAt,
    mappedTerminal?.updatedAt,
    mappedTerminal?.createdAt,
    mappedTerminal?.terminalLaunchEpoch,
    latestCollectionTimestampMs(thread?.messages, ["createdAt", "created_at"]),
    latestCollectionTimestampMs(thread?.projectionEvents, ["createdAt", "created_at"]),
  ]);
}

function getThreadSortBucket(thread, threadState) {
  if (getWorkspaceThreadIsPinned(thread)) {
    return 0;
  }
  if (threadState?.threadViewState === THREAD_VIEW_STATE.LIVE_NO_SESSION) {
    return 1;
  }
  if (threadState?.threadViewState === THREAD_VIEW_STATE.LIVE_SESSION) {
    return 2;
  }
  if (threadState?.threadViewState === THREAD_VIEW_STATE.DETACHED_SESSION) {
    return 3;
  }
  return 4;
}

function getThreadRows(workspaceThreads, workspaceId) {
  const entry = workspaceThreads?.[workspaceId];
  if (!entry) {
    return [];
  }

  return (entry.threadOrder || [])
    .map((threadId) => entry.threads?.[threadId])
    .filter((thread) => thread?.materialized)
    .map((thread, index) => ({
      thread,
      threadState: getThreadState(thread, entry),
      index,
    }))
    .filter(({ threadState }) => (
      threadState.threadViewState !== THREAD_VIEW_STATE.INACTIVE_NO_SESSION
    ))
    .map(({ thread, threadState, index }) => ({
      bucket: getThreadSortBucket(thread, threadState),
      freshness: getThreadSortFreshnessMs(thread, threadState, entry),
      index,
      thread,
    }))
    .sort((left, right) => {
      if (left.bucket !== right.bucket) {
        return left.bucket - right.bucket;
      }
      if (left.freshness !== right.freshness) {
        return right.freshness - left.freshness;
      }
      return right.index - left.index;
    })
    .map(({ thread }) => thread);
}

function terminalMatchesThreadBinding(terminal, terminalBinding) {
  if (!terminal) {
    return false;
  }

  if (!terminalBinding) {
    return true;
  }

  const terminalIndexMatches = Number(terminal.terminalIndex) === Number(terminalBinding.terminalIndex);
  const instanceMatches = !terminalBinding.instanceId
    || Number(terminal.instanceId) === Number(terminalBinding.instanceId);
  const paneMatches = !terminalBinding.paneId || terminal.paneId === terminalBinding.paneId;
  return terminalIndexMatches && instanceMatches && paneMatches;
}

function getThreadState(thread, entry) {
  const providerBinding = getWorkspaceThreadProviderBinding(thread, thread?.currentAgent);
  const terminalBinding = providerBinding?.terminalBinding || thread?.terminalBinding;
  const turnState = getWorkspaceThreadTurnState(thread);
  const hasProviderSession = Boolean(thread?.transcriptSessionId || providerBinding?.nativeSessionId);
  const terminalIndex = terminalBinding?.terminalIndex ?? thread?.terminalIndex;
  const terminalKey = terminalIndex == null ? "" : String(terminalIndex);
  const mappedTerminal = terminalKey ? entry?.terminals?.[terminalKey] : null;
  const isTerminalMappedToThread = Boolean(
    mappedTerminal?.threadId === thread?.id
      && terminalMatchesThreadBinding(mappedTerminal, terminalBinding),
  );
  const isActiveTerminal = Boolean(
    isTerminalMappedToThread
      && ["active", "starting"].includes(String(mappedTerminal?.status || "").toLowerCase())
      && ["active", "starting"].includes(String(thread?.status || "").toLowerCase()),
  );
  const terminalGroundTruth = getThreadTerminalGroundTruth({
    liveTerminal: isTerminalMappedToThread ? mappedTerminal : null,
    providerBinding,
    targetRole: thread?.currentAgent || "",
    thread,
  });
  let threadViewState = THREAD_VIEW_STATE.INACTIVE_NO_SESSION;
  if (isActiveTerminal) {
    threadViewState = hasProviderSession
      ? THREAD_VIEW_STATE.LIVE_SESSION
      : THREAD_VIEW_STATE.LIVE_NO_SESSION;
  } else if (hasProviderSession) {
    threadViewState = THREAD_VIEW_STATE.DETACHED_SESSION;
  }

  const inactiveNoSession = threadViewState === THREAD_VIEW_STATE.INACTIVE_NO_SESSION;
  const groundTruthWorkState = String(terminalGroundTruth?.terminalWorkState || "").toLowerCase();
  const liveGroundTruthWorkState = isActiveTerminal ? groundTruthWorkState : "";
  const isWorking = inactiveNoSession || !isActiveTerminal
    ? false
    : liveGroundTruthWorkState === "complete"
      ? false
      : liveGroundTruthWorkState === "running" || liveGroundTruthWorkState === "prompting_user"
        ? true
        : false;
  const effectiveTurnState = terminalGroundTruth?.effectiveLatestTurnState || turnState;
  const dotState = isActiveTerminal
    ? String(thread?.status || mappedTerminal?.status || "active").toLowerCase()
    : inactiveNoSession
      ? "idle"
      : effectiveTurnState === "error"
      ? "error"
      : isWorking && effectiveTurnState === "running"
        ? "running"
        : effectiveTurnState === "interrupted"
          ? "interrupted"
          : "idle";

  return {
    canArchive: getWorkspaceThreadCanArchive(thread),
    canPin: getWorkspaceThreadCanPin(thread),
    isLive: Boolean(isActiveTerminal),
    isNonSessionActive: threadViewState === THREAD_VIEW_STATE.LIVE_NO_SESSION,
    isWorking,
    label: getWorkspaceThreadLabel(thread),
    pinned: getWorkspaceThreadIsPinned(thread),
    state: dotState,
    threadViewState,
  };
}

function isThreadVisibleInOverlay(thread, entry) {
  return Boolean(
    thread?.materialized
      && getThreadState(thread, entry).threadViewState !== THREAD_VIEW_STATE.INACTIVE_NO_SESSION,
  );
}

function normalizeThreadSearchText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function addThreadSearchPart(parts, value) {
  const text = normalizeThreadSearchText(value);
  if (text) {
    parts.push(text);
  }
}

function getThreadSearchText(thread, workspace) {
  const metadataParts = [];
  const messageParts = [];
  const providerBindings = thread?.providerBindings && typeof thread.providerBindings === "object"
    ? Object.values(thread.providerBindings)
    : [];

  addThreadSearchPart(metadataParts, workspace?.name);
  addThreadSearchPart(metadataParts, thread?.id);
  addThreadSearchPart(metadataParts, thread?.title);
  addThreadSearchPart(metadataParts, thread?.sessionName);
  addThreadSearchPart(metadataParts, thread?.currentAgent);
  addThreadSearchPart(metadataParts, thread?.preferredAgent);
  addThreadSearchPart(metadataParts, thread?.slotKey);
  addThreadSearchPart(metadataParts, thread?.status);
  addThreadSearchPart(metadataParts, thread?.transcriptSessionId);
  addThreadSearchPart(metadataParts, thread?.pendingPrompt?.text);
  addThreadSearchPart(metadataParts, thread?.pendingPrompt?.message);
  addThreadSearchPart(metadataParts, thread?.latestTurn?.state);
  addThreadSearchPart(metadataParts, thread?.latestTurn?.error);
  addThreadSearchPart(metadataParts, getWorkspaceThreadLabel(thread));

  providerBindings.forEach((binding) => {
    addThreadSearchPart(metadataParts, binding?.agentId);
    addThreadSearchPart(metadataParts, binding?.modelId);
    addThreadSearchPart(metadataParts, binding?.nativeSessionId);
    addThreadSearchPart(metadataParts, binding?.nativeSessionTitle);
    addThreadSearchPart(metadataParts, binding?.status);
  });

  (Array.isArray(thread?.messages) ? thread.messages : []).forEach((message) => {
    addThreadSearchPart(messageParts, message?.role);
    addThreadSearchPart(messageParts, message?.title);
    addThreadSearchPart(messageParts, message?.text);
  });

  return {
    label: normalizeThreadSearchText(getWorkspaceThreadLabel(thread)),
    message: messageParts.join(" "),
    metadata: metadataParts.join(" "),
  };
}

function getThreadSearchScore(thread, workspace, query) {
  const normalizedQuery = normalizeThreadSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const searchText = getThreadSearchText(thread, workspace);
  const haystack = `${searchText.metadata} ${searchText.message}`;
  if (!haystack) {
    return 0;
  }

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (!tokens.every((token) => haystack.includes(token))) {
    return 0;
  }

  let score = 100;
  if (searchText.label === normalizedQuery) {
    score += 900;
  } else if (searchText.label.startsWith(normalizedQuery)) {
    score += 760;
  } else if (searchText.label.includes(normalizedQuery)) {
    score += 620;
  }

  if (searchText.metadata.includes(normalizedQuery)) {
    score += 360;
  }
  if (searchText.message.includes(normalizedQuery)) {
    score += 180;
  }
  if (getWorkspaceThreadIsPinned(thread)) {
    score += 20;
  }

  return score;
}

function countThreadRows(threadGroups) {
  return (Array.isArray(threadGroups) ? threadGroups : [])
    .reduce((total, group) => total + (Array.isArray(group?.threads) ? group.threads.length : 0), 0);
}

function WorkspaceThreadsOverlay({
  agentStatuses,
  composerAttachments,
  composerDrafts,
  onArchiveThread,
  onClose,
  onActiveThreadChange,
  onCreateChat,
  onDraftInput,
  onSelectModel,
  onSelectThread,
  onSubmitMessage,
  onTogglePinnedThread,
  onViewStateChange,
  open,
  preferSelectedThreadId = false,
  selectedThreadId,
  selectedWorkspaceId,
  todoDropActive = false,
  todoDropTarget = false,
  todoDropUnsupportedMessage = "",
  viewState,
  workspaceRoot = "",
  workspaceThreads,
  workspaces,
}) {
  const safeViewState = viewState && typeof viewState === "object" && !Array.isArray(viewState)
    ? viewState
    : {};
  const railCollapsed = safeViewState.railCollapsed === true;
  const newChatActive = preferSelectedThreadId ? false : safeViewState.newChatActive === true;
  const searchInputRef = useRef(null);
  const selectionDiagnosticRef = useRef("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = normalizeThreadSearchText(deferredSearchQuery);
  const searchVisible = searchActive || normalizeThreadSearchText(searchQuery).length > 0;
  const localSelection = {
    threadId: preferSelectedThreadId
      ? selectedThreadId || ""
      : safeViewState.selectedThreadId || selectedThreadId || "",
    workspaceId: preferSelectedThreadId
      ? selectedWorkspaceId || safeViewState.selectedWorkspaceId || ""
      : safeViewState.selectedWorkspaceId || selectedWorkspaceId || "",
  };
  const commitViewState = (workspaceId, patch = {}) => {
    const safeWorkspaceId = workspaceId
      || patch.workspaceId
      || patch.selectedWorkspaceId
      || localSelection.workspaceId
      || selectedWorkspaceId
      || "";
    if (!safeWorkspaceId) {
      return;
    }
    onViewStateChange?.(safeWorkspaceId, {
      ...patch,
      workspaceId: safeWorkspaceId,
    });
  };
  const closeSearch = () => {
    setSearchActive(false);
    setSearchQuery("");
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (searchVisible) {
          closeSearch();
          return;
        }
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, searchVisible]);

  useEffect(() => {
    if (open) {
      return;
    }

    closeSearch();
  }, [open]);

  useEffect(() => {
    if (!open || !searchActive || railCollapsed) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [open, railCollapsed, searchActive]);

  const collapsedThreadGroups = useMemo(() => (workspaces || [])
    .map((workspace) => ({
      threads: getThreadRows(workspaceThreads, workspace.id),
      workspace,
    }))
    .filter((group) => group.threads.length > 0), [workspaceThreads, workspaces]);
  const threadGroups = useMemo(() => (workspaces || []).map((workspace) => ({
    threads: getThreadRows(workspaceThreads, workspace.id),
    workspace,
  })), [workspaceThreads, workspaces]);
  const searchedThreadGroups = useMemo(() => {
    if (!normalizedSearchQuery) {
      return threadGroups;
    }

    return threadGroups
      .map(({ threads, workspace }) => ({
        threads: threads
          .map((thread, index) => ({
            index,
            score: getThreadSearchScore(thread, workspace, normalizedSearchQuery),
            thread,
          }))
          .filter((result) => result.score > 0)
          .sort((left, right) => right.score - left.score || left.index - right.index)
          .map((result) => result.thread),
        workspace,
      }))
      .filter((group) => group.threads.length > 0);
  }, [normalizedSearchQuery, threadGroups]);
  const visibleThreadGroups = searchVisible ? searchedThreadGroups : threadGroups;
  const totalThreadCount = useMemo(() => countThreadRows(threadGroups), [threadGroups]);
  const visibleThreadCount = useMemo(() => countThreadRows(visibleThreadGroups), [visibleThreadGroups]);
  const hasVisibleThreads = collapsedThreadGroups.length > 0;
  const selectedThreadFromLocal = workspaceThreads?.[localSelection.workspaceId]
    ?.threads?.[localSelection.threadId];
  const selectedThreadEntry = workspaceThreads?.[localSelection.workspaceId];
  const fallbackSelection = collapsedThreadGroups[0]?.threads?.[0]
    ? {
      thread: collapsedThreadGroups[0].threads[0],
      workspace: collapsedThreadGroups[0].workspace,
    }
    : { thread: null, workspace: null };
  const activeThread = isThreadVisibleInOverlay(selectedThreadFromLocal, selectedThreadEntry)
    ? selectedThreadFromLocal
    : fallbackSelection.thread;
  const activeWorkspace = activeThread
    ? (workspaces || []).find((workspace) => workspace.id === activeThread.workspaceId)
      || fallbackSelection.workspace
    : null;
  const activeWorkspaceId = activeWorkspace?.id || activeThread?.workspaceId || "";
  const activeThreadId = activeThread?.id || "";
  const newChatWorkspace = (workspaces || []).find((workspace) => workspace.id === selectedWorkspaceId)
    || activeWorkspace
    || fallbackSelection.workspace
    || (workspaces || [])[0]
    || null;
  const visibleActiveWorkspaceId = newChatActive ? "" : activeWorkspaceId;
  const visibleActiveThreadId = newChatActive ? "" : activeThreadId;
  useEffect(() => {
    const selectedThreadVisible = isThreadVisibleInOverlay(selectedThreadFromLocal, selectedThreadEntry);
    const activeThreadState = activeThread && activeWorkspaceId
      ? getThreadState(activeThread, workspaceThreads?.[activeWorkspaceId])
      : null;
    const selectedThreadState = selectedThreadFromLocal && localSelection.workspaceId
      ? getThreadState(selectedThreadFromLocal, selectedThreadEntry)
      : null;
    const fallbackThread = fallbackSelection.thread || null;
    const snapshot = {
      activeThreadId,
      activeThreadLatestTurnState: String(activeThread?.latestTurn?.state || ""),
      activeThreadMessageCount: Array.isArray(activeThread?.messages) ? activeThread.messages.length : 0,
      activeThreadRawActivityStatus: String(activeThread?.activityStatus || ""),
      activeThreadRawStatus: String(activeThread?.status || ""),
      activeThreadState,
      activeWorkspaceId,
      fallbackThreadId: String(fallbackThread?.id || ""),
      localSelectionThreadId: localSelection.threadId,
      localSelectionWorkspaceId: localSelection.workspaceId,
      newChatActive,
      open,
      selectedThreadId: selectedThreadId || "",
      selectedThreadLatestTurnState: String(selectedThreadFromLocal?.latestTurn?.state || ""),
      selectedThreadRawActivityStatus: String(selectedThreadFromLocal?.activityStatus || ""),
      selectedThreadRawStatus: String(selectedThreadFromLocal?.status || ""),
      selectedThreadState,
      selectedThreadVisible,
      selectedWorkspaceId: selectedWorkspaceId || "",
      visibleActiveThreadId,
      visibleActiveWorkspaceId,
    };
    const signature = JSON.stringify(snapshot);
    if (selectionDiagnosticRef.current === signature) {
      return;
    }

    selectionDiagnosticRef.current = signature;
    logBigViewSyncDiagnosticEvent("bigview.overlay.selection_state", snapshot);
  }, [
    activeThread,
    activeThreadId,
    activeWorkspaceId,
    fallbackSelection.thread,
    localSelection.threadId,
    localSelection.workspaceId,
    newChatActive,
    open,
    selectedThreadEntry,
    selectedThreadFromLocal,
    selectedThreadId,
    selectedWorkspaceId,
    visibleActiveThreadId,
    visibleActiveWorkspaceId,
    workspaceThreads,
  ]);
  const selectThread = (workspaceId, threadId) => {
    commitViewState(workspaceId, {
      newChatActive: false,
      selectedThreadId: threadId,
      selectedWorkspaceId: workspaceId,
    });
    onSelectThread?.(workspaceId, threadId);
  };
  const archiveThread = (event, workspaceId, threadId) => {
    event.preventDefault();
    event.stopPropagation();
    onArchiveThread?.(workspaceId, threadId);
  };
  const togglePinnedThread = (event, workspaceId, threadId) => {
    event.preventDefault();
    event.stopPropagation();
    onTogglePinnedThread?.(workspaceId, threadId);
  };
  const openNewChat = () => {
    closeSearch();
    const workspaceId = newChatWorkspace?.id || selectedWorkspaceId || activeWorkspaceId || "";
    commitViewState(workspaceId, {
      newChatActive: true,
      railCollapsed: false,
      selectedWorkspaceId: workspaceId,
    });
  };
  const openSearch = () => {
    setSearchActive(true);
    const workspaceId = activeWorkspaceId || selectedWorkspaceId || localSelection.workspaceId || "";
    if (railCollapsed) {
      commitViewState(workspaceId, {
        railCollapsed: false,
      });
    }
    window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  };
  const createChat = async (request) => {
    const result = await onCreateChat?.({
      ...request,
      workspace: request?.workspace || newChatWorkspace,
    });
    const nextWorkspaceId = result?.workspaceId || result?.workspace?.id || newChatWorkspace?.id || "";
    const nextThreadId = result?.threadId || result?.thread?.id || "";
    if (nextWorkspaceId && nextThreadId) {
      commitViewState(nextWorkspaceId, {
        newChatActive: false,
        selectedThreadId: nextThreadId,
        selectedWorkspaceId: nextWorkspaceId,
      });
      onSelectThread?.(nextWorkspaceId, nextThreadId);
    }

    return result;
  };

  useEffect(() => {
    if (open && !hasVisibleThreads) {
      const workspaceId = newChatWorkspace?.id || selectedWorkspaceId || activeWorkspaceId || "";
      commitViewState(workspaceId, {
        newChatActive: true,
        selectedWorkspaceId: workspaceId,
      });
    }
  }, [hasVisibleThreads, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    onActiveThreadChange?.({
      thread: newChatActive ? null : activeThread || null,
      threadId: newChatActive ? "" : activeThreadId,
      workspace: newChatActive ? newChatWorkspace : activeWorkspace || null,
      workspaceId: newChatActive ? newChatWorkspace?.id || "" : activeWorkspaceId,
    });
  }, [
    activeThread,
    activeThreadId,
    activeWorkspace,
    activeWorkspaceId,
    newChatActive,
    newChatWorkspace,
    onActiveThreadChange,
    open,
  ]);

  const searchSummary = normalizedSearchQuery
    ? `${visibleThreadCount} ${visibleThreadCount === 1 ? "result" : "results"}`
    : `${totalThreadCount} ${totalThreadCount === 1 ? "thread" : "threads"}`;

  if (!open) {
    return null;
  }

  return (
    <OverlayRoot aria-label="Workspace threads" data-terminal-control="true" role="dialog">
      <OverlayPanel data-rail-collapsed={railCollapsed ? "true" : "false"}>
        <ThreadRail>
          <DrawerToggle
            aria-label={railCollapsed ? "Expand threads sidebar" : "Collapse threads sidebar"}
            onClick={() => commitViewState(activeWorkspaceId || selectedWorkspaceId, {
              railCollapsed: !railCollapsed,
            })}
            title={railCollapsed ? "Expand threads" : "Collapse threads"}
            type="button"
          >
            {railCollapsed ? (
              <ChevronRight aria-hidden="true" />
            ) : (
              <ChevronLeft aria-hidden="true" />
            )}
          </DrawerToggle>

          {railCollapsed ? (
            <CollapsedRail aria-label="Collapsed workspace threads">
              <CollapsedRailActionStack aria-label="Thread actions">
                <CollapsedRailActionButton
                  aria-label="New Chat"
                  data-active={newChatActive ? "true" : "false"}
                  onClick={openNewChat}
                  title="New Chat"
                  type="button"
                >
                  <Edit aria-hidden="true" />
                </CollapsedRailActionButton>
                <CollapsedRailActionButton
                  aria-label="Search"
                  data-active={searchVisible ? "true" : "false"}
                  onClick={openSearch}
                  title="Search"
                  type="button"
                >
                  <Search aria-hidden="true" />
                </CollapsedRailActionButton>
              </CollapsedRailActionStack>
              <CollapsedThreadsRegion aria-hidden="true">
                {collapsedThreadGroups.map(({ threads, workspace }, workspaceIndex) => (
                  <CollapsedWorkspaceGroup key={workspace.id}>
                    <CollapsedWorkspaceMarker
                      aria-hidden="true"
                      data-visible={workspaceIndex > 0 ? "true" : "false"}
                    >
                      <span />
                    </CollapsedWorkspaceMarker>
                    <CollapsedThreadList>
                      {threads.map((thread) => {
                        const isSelected = visibleActiveWorkspaceId === workspace.id
                          && visibleActiveThreadId === thread.id;
                        const {
                          isLive,
                          isNonSessionActive,
                          label,
                          state,
                          threadViewState,
                        } = getThreadState(
                          thread,
                          workspaceThreads?.[workspace.id],
                        );
                        const title = `${workspace.name}: ${label}`;

                        return (
                          <CollapsedThreadButton
                            aria-label={title}
                            data-selected={isSelected ? "true" : "false"}
                            key={thread.id}
                            onClick={() => selectThread(workspace.id, thread.id)}
                            title={title}
                            type="button"
                          >
                            <TerminalStateDot
                              aria-hidden="true"
                              data-live={isLive ? "true" : "false"}
                              data-nosession={isNonSessionActive ? "true" : "false"}
                              data-state={state}
                              data-view-state={threadViewState}
                            />
                          </CollapsedThreadButton>
                        );
                      })}
                    </CollapsedThreadList>
                  </CollapsedWorkspaceGroup>
                ))}
              </CollapsedThreadsRegion>
            </CollapsedRail>
          ) : (
            <WorkspaceList>
              <RailHeader>
                <strong>Threads</strong>
                <RailHeaderCount title={`${totalThreadCount} active threads`}>
                  {totalThreadCount}
                </RailHeaderCount>
              </RailHeader>
              <RailActionStack aria-label="Thread actions">
                <RailActionButton
                  data-active={newChatActive ? "true" : "false"}
                  onClick={openNewChat}
                  title="New Chat"
                  type="button"
                >
                  <Edit aria-hidden="true" />
                  <span>New Chat</span>
                </RailActionButton>
                <RailActionButton
                  data-active={searchVisible ? "true" : "false"}
                  onClick={openSearch}
                  title="Search"
                  type="button"
                >
                  <Search aria-hidden="true" />
                  <span>Search</span>
                </RailActionButton>
              </RailActionStack>
              {searchVisible ? (
                <ThreadSearchPanel>
                  <ThreadSearchField>
                    <Search aria-hidden="true" />
                    <ThreadSearchInput
                      aria-label="Search threads"
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search threads"
                      ref={searchInputRef}
                      spellCheck={false}
                      type="search"
                      value={searchQuery}
                    />
                    <ThreadSearchClearButton
                      aria-label="Clear search"
                      data-visible={searchVisible ? "true" : "false"}
                      onClick={closeSearch}
                      title="Clear search"
                      type="button"
                    >
                      <Close aria-hidden="true" />
                    </ThreadSearchClearButton>
                  </ThreadSearchField>
                  <ThreadSearchSummary>{searchSummary}</ThreadSearchSummary>
                </ThreadSearchPanel>
              ) : null}
              {searchVisible && normalizedSearchQuery && visibleThreadCount === 0 ? (
                <EmptyThreads>No matching threads</EmptyThreads>
              ) : visibleThreadGroups.map(({ threads, workspace }) => {
                return (
                  <WorkspaceGroup key={workspace.id}>
                    <WorkspaceTopline>
                      <span title={workspace.name}>{workspace.name}</span>
                    </WorkspaceTopline>
                    <ThreadList>
                      {threads.length ? threads.map((thread) => {
                        const isSelected = visibleActiveWorkspaceId === workspace.id
                          && visibleActiveThreadId === thread.id;
                        const {
                          canArchive,
                          canPin,
                          isLive,
                          isNonSessionActive,
                          isWorking,
                          label,
                          pinned,
                          state,
                          threadViewState,
                        } = getThreadState(thread, workspaceThreads?.[workspace.id]);

                        return (
                          <ThreadRow
                            data-can-pin={canPin ? "true" : "false"}
                            data-can-archive={canArchive ? "true" : "false"}
                            data-pinned={pinned ? "true" : "false"}
                            data-selected={isSelected ? "true" : "false"}
                            key={thread.id}
                            title={label}
                          >
                            {canPin ? (
                              <ThreadPinButton
                                aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
                                onClick={(event) => togglePinnedThread(event, workspace.id, thread.id)}
                                title={pinned ? "Unpin thread" : "Pin thread"}
                                type="button"
                              >
                                <PushPin aria-hidden="true" />
                              </ThreadPinButton>
                            ) : null}
                            <ThreadSelectButton
                              onClick={() => selectThread(workspace.id, thread.id)}
                              type="button"
                            >
                              <ThreadRowText>
                                <ThreadRowTitle data-working={isWorking ? "true" : "false"}>
                                  <ThreadRowTitleText>{label}</ThreadRowTitleText>
                                </ThreadRowTitle>
                                <ThreadRowMeta>
                                  <span>{getWorkspaceThreadAgentLabel(thread)}</span>
                                  {(() => {
                                    const timeLabel = formatThreadRelativeTime(
                                      getThreadSortFreshnessMs(thread, null, workspaceThreads?.[workspace.id]),
                                    );
                                    return timeLabel ? (
                                      <>
                                        <i aria-hidden="true">·</i>
                                        <span>{timeLabel}</span>
                                      </>
                                    ) : null;
                                  })()}
                                  {isWorking ? (
                                    <>
                                      <i aria-hidden="true">·</i>
                                      <span>working</span>
                                    </>
                                  ) : null}
                                </ThreadRowMeta>
                              </ThreadRowText>
                            </ThreadSelectButton>
                            <ThreadStatusSlot>
                          <TerminalStateDot
                            aria-hidden="true"
                            data-live={isLive ? "true" : "false"}
                            data-nosession={isNonSessionActive ? "true" : "false"}
                            data-state={state}
                            data-view-state={threadViewState}
                          />
                              {canArchive ? (
                                <ThreadArchiveButton
                                  aria-label={`Archive ${label}`}
                                  onClick={(event) => archiveThread(event, workspace.id, thread.id)}
                                  title="Archive thread"
                                  type="button"
                                >
                                  <DeleteOutline aria-hidden="true" />
                                </ThreadArchiveButton>
                              ) : null}
                            </ThreadStatusSlot>
                          </ThreadRow>
                        );
                      }) : (
                        <EmptyThreads>No threads</EmptyThreads>
                      )}
                    </ThreadList>
                  </WorkspaceGroup>
                );
              })}
            </WorkspaceList>
          )}
        </ThreadRail>

        <WorkspaceThreadDetail
          agentStatuses={agentStatuses}
          composerAttachments={composerAttachments}
          composerDrafts={composerDrafts}
          newChatActive={newChatActive}
          onCreateChat={createChat}
          onDraftInput={onDraftInput}
          onSelectModel={onSelectModel}
          onSubmitMessage={onSubmitMessage}
          thread={newChatActive ? null : activeThread}
          todoDropActive={todoDropActive}
          todoDropTarget={todoDropTarget}
          todoDropUnsupportedMessage={todoDropUnsupportedMessage}
          workspace={newChatActive ? newChatWorkspace : activeWorkspace}
          workspaceRoot={(newChatActive ? newChatWorkspace?.rootDirectory : activeWorkspace?.rootDirectory) || workspaceRoot || ""}
          workspaceThreadEntry={workspaceThreads?.[newChatActive ? newChatWorkspace?.id || "" : activeWorkspaceId]}
          visible={open}
        />
      </OverlayPanel>
    </OverlayRoot>
  );
}

export default memo(WorkspaceThreadsOverlay);
