import styled, { createGlobalStyle, keyframes } from "styled-components";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Add } from "@styled-icons/material-rounded/Add";
import { Bolt } from "@styled-icons/material-rounded/Bolt";
import { ChevronRight } from "@styled-icons/material-rounded/ChevronRight";
import { CheckCircle } from "@styled-icons/material-rounded/CheckCircle";
import { Close } from "@styled-icons/material-rounded/Close";
import { CloudDone } from "@styled-icons/material-rounded/CloudDone";
import { Code } from "@styled-icons/material-rounded/Code";
import { CropSquare } from "@styled-icons/material-rounded/CropSquare";
import { Description } from "@styled-icons/material-rounded/Description";
import { ErrorOutline } from "@styled-icons/material-rounded/ErrorOutline";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { FolderOpen } from "@styled-icons/material-rounded/FolderOpen";
import { FullscreenExit } from "@styled-icons/material-rounded/FullscreenExit";
import { Hub } from "@styled-icons/material-rounded/Hub";
import { Key } from "@styled-icons/material-rounded/Key";
import { Login } from "@styled-icons/material-rounded/Login";
import { Logout } from "@styled-icons/material-rounded/Logout";
import { Mic } from "@styled-icons/material-rounded/Mic";
import { Remove } from "@styled-icons/material-rounded/Remove";
import { OpenInBrowser } from "@styled-icons/material-rounded/OpenInBrowser";
import { Pending } from "@styled-icons/material-rounded/Pending";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";
import { Terminal as TerminalIcon } from "@styled-icons/material-rounded/Terminal";

export const TITLE_BAR_HEIGHT = "34px";
export const VIEW_TRANSITION_MS = 170;
export const AUTH_TILE_SIZE = 40;

const TERMINAL_THEME_BACKGROUND = "#020304";
const TERMINAL_PANE_MIN_WIDTH_PX = 180;
const TERMINAL_PANE_MIN_HEIGHT_PX = 96;

export const GlobalStyle = createGlobalStyle`
  :root {
    color: #f7f9ff;
    background: #030508;
    color-scheme: dark;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }

  * {
    box-sizing: border-box;
    scrollbar-color: rgba(98, 160, 255, 0.72) rgba(6, 9, 16, 0.72);
    scrollbar-width: thin;
  }

  *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  *::-webkit-scrollbar-track {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
      rgba(6, 9, 16, 0.76);
  }

  *::-webkit-scrollbar-thumb {
    min-height: 42px;
    border: 2px solid rgba(6, 9, 16, 0.88);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(98, 160, 255, 0.9), rgba(47, 128, 255, 0.56) 48%, rgba(255, 122, 24, 0.72)),
      #2f80ff;
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-thumb:hover {
    background:
      linear-gradient(180deg, #8bb9ff, rgba(98, 160, 255, 0.72) 46%, #ff9a3d),
      #62a0ff;
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-corner {
    background: rgba(6, 9, 16, 0.76);
  }

  html,
  body,
  #app {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
    background: #030508;
  }

  body {
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(47, 128, 255, 0.1), rgba(3, 5, 8, 0) 34rem),
      linear-gradient(135deg, rgba(255, 122, 24, 0.08), rgba(3, 5, 8, 0) 28rem),
      #030508;
  }

  button {
    cursor: pointer;
    font: inherit;
  }

  button:disabled {
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.001ms !important;
    }
  }
`;

export const AppFrame = styled.div`
  display: grid;
  position: relative;
  min-width: 320px;
  min-height: 100vh;
  grid-template-rows: ${TITLE_BAR_HEIGHT} minmax(0, 1fr);
  background: #030508;
`;

export const WindowResizeEdges = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
`;

export const WindowResizeHandle = styled.div`
  position: fixed;
  z-index: 1;
  background: transparent;
  pointer-events: auto;
  user-select: none;
  touch-action: none;
  -webkit-app-region: no-drag;

  &[data-placement="top"] {
    top: 0;
    right: 148px;
    left: 10px;
    height: 6px;
    cursor: ns-resize;
  }

  &[data-placement="bottom"] {
    right: 10px;
    bottom: 0;
    left: 10px;
    height: 6px;
    cursor: ns-resize;
  }

  &[data-placement="right"],
  &[data-placement="left"] {
    top: ${TITLE_BAR_HEIGHT};
    bottom: 10px;
    width: 6px;
    cursor: ew-resize;
  }

  &[data-placement="right"] {
    right: 0;
  }

  &[data-placement="left"] {
    left: 0;
  }

  &[data-placement^="top-"],
  &[data-placement^="bottom-"] {
    width: 8px;
    height: 8px;
  }

  &[data-placement="top-left"],
  &[data-placement="bottom-right"] {
    cursor: nwse-resize;
  }

  &[data-placement="top-right"],
  &[data-placement="bottom-left"] {
    cursor: nesw-resize;
  }

  &[data-placement="top-left"] {
    top: 0;
    left: 0;
  }

  &[data-placement="top-right"] {
    top: 0;
    right: 0;
  }

  &[data-placement="bottom-right"] {
    right: 0;
    bottom: 0;
  }

  &[data-placement="bottom-left"] {
    bottom: 0;
    left: 0;
  }
`;

export const WindowTitleBar = styled.header`
  display: grid;
  height: ${TITLE_BAR_HEIGHT};
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #e8eef8;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    #060910;
  user-select: none;
`;

export const WindowTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  color: #eaf0f5;
  font-size: 12px;
  font-weight: 820;

  img {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const WindowControls = styled.div`
  display: inline-flex;
  height: 100%;
  align-items: stretch;
`;

export const WindowControlButton = styled.button`
  display: grid;
  width: 46px;
  height: 100%;
  place-items: center;
  border: 0;
  border-radius: 0;
  color: #c9d2dc;
  background: transparent;

  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.09);
  }

  &[data-variant="close"]:hover {
    color: #ffffff;
    background: #d83b32;
  }
`;

export const AppContent = styled.div`
  min-height: 0;
  overflow: auto;
  background:
    linear-gradient(180deg, rgba(47, 128, 255, 0.1) 0%, rgba(3, 5, 8, 0) 34rem),
    linear-gradient(135deg, rgba(255, 122, 24, 0.08) 0%, rgba(3, 5, 8, 0) 28rem),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    #030508;
  background-size: auto, auto, 96px 96px, 96px 96px, auto;
`;

export const workspaceCloseSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

export const WorkspaceCloseOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  min-width: 320px;
  place-items: center;
  padding: 22px;
  color: #f7f9ff;
  background:
    linear-gradient(180deg, rgba(47, 128, 255, 0.14), rgba(3, 5, 8, 0) 46%),
    linear-gradient(135deg, rgba(255, 122, 24, 0.12), rgba(3, 5, 8, 0) 42%),
    rgba(3, 5, 8, 0.9);
  backdrop-filter: blur(18px);
`;

export const WorkspaceClosePanel = styled.section`
  display: grid;
  width: min(440px, 100%);
  min-width: 0;
  justify-items: center;
  gap: 12px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02)),
    rgba(8, 13, 20, 0.96);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.56);
`;

export const WorkspaceCloseSpinner = styled.div`
  width: 42px;
  height: 42px;
  border: 3px solid rgba(98, 160, 255, 0.2);
  border-top-color: #62a0ff;
  border-right-color: #ff9a3d;
  border-radius: 50%;
  animation: ${workspaceCloseSpin} 760ms linear infinite;
`;

export const WorkspaceCloseTitle = styled.h2`
  margin: 3px 0 0;
  color: #ffffff;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
`;

export const WorkspaceCloseDetail = styled.p`
  max-width: 34ch;
  margin: 0;
  color: #aeb8c7;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.48;
  text-align: center;
`;

export const WorkspaceCloseCounter = styled.p`
  margin: 4px 0 0;
  padding: 6px 9px;
  border: 1px solid rgba(98, 160, 255, 0.24);
  border-radius: 8px;
  color: #eaf2ff;
  background: rgba(47, 128, 255, 0.12);
  font-size: 12px;
  font-weight: 900;
  line-height: 1.25;
  text-align: center;
`;

export const WorkspaceCloseProgressTrack = styled.div`
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
`;

export const WorkspaceCloseProgressBar = styled.div`
  width: ${({ $progress }) => Math.max(0, Math.min(100, $progress || 0))}%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #62a0ff, #ff9a3d);
  transition: width 180ms ease;
`;

export const splashPulse = keyframes`
  0%,
  100% {
    opacity: 0.72;
    transform: translate3d(0, 0, 0);
  }

  50% {
    opacity: 1;
    transform: translate3d(0, -4px, 0);
  }
`;

export const loadingOrangeSweep = keyframes`
  0% {
    opacity: 0;
    transform: translateX(-145%);
  }

  14% {
    opacity: 1;
  }

  82% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translateX(330%);
  }
`;

export const shellReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.992);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

export const railReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(-10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const sideReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const panelEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const panelExit = keyframes`
  from {
    opacity: 1;
    transform: translateY(0);
  }

  to {
    opacity: 0;
    transform: translateY(5px);
  }
`;

export const quietSweep = keyframes`
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
`;

export const squareFade = keyframes`
  0%,
  72%,
  100% {
    opacity: 0;
  }

  10%,
  32% {
    opacity: var(--peak);
  }

  48% {
    opacity: 0;
  }
`;

export const SplashScreen = styled.main`
  position: relative;
  display: grid;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  overflow: hidden;
  place-items: center;
  padding: clamp(20px, 6vh, 48px);
  color: #f7f9ff;
  background:
    linear-gradient(145deg, rgba(47, 128, 255, 0.13), rgba(3, 5, 8, 0) 42%),
    linear-gradient(315deg, rgba(255, 122, 24, 0.15), rgba(3, 5, 8, 0) 40%),
    linear-gradient(90deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    #030508;
  background-size: auto, auto, 92px 92px, 92px 92px, auto;

  &::before {
    position: absolute;
    inset: 26px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
      rgba(3, 5, 8, 0.46);
    content: "";
  }

  @media (max-width: 760px) {
    padding: 28px;

    &::before {
      inset: 14px;
    }
  }

  @media (max-height: 660px) {
    padding: 18px;

    &::before {
      inset: 12px;
    }
  }
`;

export const AmbientPanel = styled.div`
  position: absolute;
  z-index: 1;
  display: grid;
  gap: 10px;
  width: min(320px, 28vw);
  min-height: 126px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(232, 238, 248, 0.38);
  background: rgba(10, 15, 23, 0.38);
  box-shadow: inset 0 0 40px rgba(255, 255, 255, 0.02);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
  line-height: 1.35;
  animation: ${splashPulse} 3s ease-in-out infinite;

  &[data-position="left"] {
    top: 12%;
    left: 6%;
  }

  &[data-position="right"] {
    right: 6%;
    bottom: 24%;
    animation-delay: 0.9s;
  }

  span {
    color: #62a0ff;
    font-weight: 800;
  }

  p {
    margin: 0;
  }

  p:last-child {
    color: rgba(255, 154, 61, 0.56);
  }

  @media (max-width: 980px) {
    display: none;
  }
`;

export const SplashCenter = styled.section`
  position: relative;
  z-index: 2;
  display: grid;
  width: min(680px, 100%);
  justify-items: center;
  gap: clamp(10px, 2.5vh, 18px);
  text-align: center;
`;

export const SplashLogo = styled.img`
  display: block;
  width: clamp(132px, 28vh, 258px);
  height: clamp(132px, 28vh, 258px);
  border-radius: 8px;
  object-fit: cover;
  filter:
    drop-shadow(0 0 24px rgba(47, 128, 255, 0.36))
    drop-shadow(0 0 28px rgba(255, 122, 24, 0.28));
  animation: ${splashPulse} 2.8s ease-in-out infinite;

  @media (max-width: 760px) {
    width: clamp(112px, 24vh, 184px);
    height: clamp(112px, 24vh, 184px);
  }
`;

export const SplashTitle = styled.h1`
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 7vw, 64px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  text-shadow: 0 0 24px rgba(47, 128, 255, 0.22);

  @media (max-width: 760px) {
    font-size: 42px;
  }
`;

export const SplashTagline = styled.p`
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2.2vw, 19px);
  font-weight: 650;
  line-height: 1.5;

  @media (max-width: 760px) {
    font-size: 16px;
  }
`;

export const LoadingTrack = styled.div`
  position: relative;
  width: min(520px, 88%);
  height: 7px;
  overflow: hidden;
  border: 1px solid rgba(98, 160, 255, 0.44);
  border-radius: 8px;
  background: linear-gradient(90deg, #0e4fd3, #2f80ff 42%, #62a0ff);
  box-shadow:
    inset 0 0 12px rgba(255, 255, 255, 0.12),
    0 0 18px rgba(47, 128, 255, 0.28);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.42);
    background:
      linear-gradient(90deg, rgba(255, 107, 107, 0.16), rgba(255, 122, 24, 0.2)),
      #10151f;
    box-shadow:
      inset 0 0 12px rgba(255, 255, 255, 0.07),
      0 0 18px rgba(255, 107, 107, 0.14);
  }
`;

export const LoadingFill = styled.div`
  width: 34%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(255, 122, 24, 0),
    #ff7a18 28%,
    #ff9a3d 56%,
    rgba(255, 186, 96, 0)
  );
  box-shadow:
    0 0 14px rgba(255, 122, 24, 0.62),
    0 0 18px rgba(255, 154, 61, 0.4);
  animation: ${loadingOrangeSweep} 1.55s cubic-bezier(0.45, 0, 0.25, 1) infinite;
`;

export const LoadingText = styled.p`
  margin: 0;
  color: #d1d8e2;
  font-size: 16px;
  font-weight: 720;
`;

export const LoadingDetail = styled.p`
  margin: 3px 0 0;
  color: #8f9bad;
  font-size: 13px;
  font-weight: 620;
  line-height: 1.45;
`;

export const LaunchStatusPanel = styled.div`
  display: grid;
  width: min(520px, 92%);
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(47, 128, 255, 0.24);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
    rgba(6, 9, 16, 0.74);
  text-align: left;
  box-shadow: 0 20px 54px rgba(0, 0, 0, 0.22);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.32);
    background:
      linear-gradient(145deg, rgba(255, 107, 107, 0.12), rgba(255, 122, 24, 0.08)),
      rgba(6, 9, 16, 0.78);
  }

  &[data-state="update"],
  &[data-state="warning"] {
    border-color: rgba(255, 122, 24, 0.34);
    background:
      linear-gradient(145deg, rgba(255, 122, 24, 0.12), rgba(47, 128, 255, 0.07)),
      rgba(6, 9, 16, 0.78);
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
`;

export const LaunchStatusIcon = styled.span`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(47, 128, 255, 0.38);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.4);
    color: #ffb1b1;
    background: rgba(255, 107, 107, 0.14);
  }

  &[data-state="update"],
  &[data-state="warning"] {
    border-color: rgba(255, 122, 24, 0.42);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.14);
  }
`;

export const LaunchStatusCopy = styled.div`
  min-width: 0;
`;

export const LaunchActions = styled.div`
  display: flex;
  justify-content: center;
  width: min(260px, 92%);
  gap: 10px;

  > button {
    width: 100%;
    min-height: 44px;
  }

  &[data-layout="split"] {
    width: min(520px, 92%);

    > button {
      flex: 1 1 0;
    }
  }

  @media (max-width: 560px) {
    flex-direction: column;
  }
`;

export const LoginScreen = styled.main`
  position: relative;
  display: grid;
  width: 100%;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  isolation: isolate;
  overflow: hidden;
  background: #030508;
`;

export const LoginLayout = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  width: min(1080px, calc(100% - clamp(28px, 6vw, 48px)));
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  grid-template-columns: minmax(0, 1fr) minmax(320px, 430px);
  align-items: center;
  align-content: center;
  gap: clamp(28px, 5vw, 56px);
  margin: 0 auto;
  padding: clamp(18px, 6vh, 48px) 0;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 860px) {
    width: min(100% - 28px, 620px);
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 28px 0;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    grid-template-columns: minmax(0, 0.9fr) minmax(320px, 400px);
    align-items: start;
    gap: 26px;
    padding: 18px 0;
  }
`;

export const SquareField = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(185, 191, 203, 0.24) 1px, transparent 1px),
    linear-gradient(180deg, rgba(185, 191, 203, 0.22) 1px, transparent 1px),
    #030508;
  background-size: ${AUTH_TILE_SIZE}px ${AUTH_TILE_SIZE}px;

  &::after {
    position: absolute;
    inset: 0;
    z-index: 2;
    background:
      linear-gradient(90deg, rgba(3, 5, 8, 0.72), rgba(3, 5, 8, 0.12) 46%, rgba(3, 5, 8, 0.6)),
      linear-gradient(180deg, rgba(3, 5, 8, 0.06), rgba(3, 5, 8, 0.48));
    content: "";
  }
`;

export const SquarePulse = styled.span`
  position: absolute;
  top: var(--top);
  left: var(--left);
  z-index: 1;
  width: ${AUTH_TILE_SIZE}px;
  height: ${AUTH_TILE_SIZE}px;
  background: rgba(188, 194, 205, 0.96);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  opacity: 0;
  animation: ${squareFade} var(--duration) ease-in-out var(--delay) infinite;
`;

export const BrandPanel = styled.section`
  position: relative;
  z-index: 1;
  display: grid;
  min-height: min(520px, calc(100vh - ${TITLE_BAR_HEIGHT} - 96px));
  align-content: center;
  gap: clamp(24px, 5vh, 48px);
  padding: clamp(8px, 2vh, 20px) 0;
  animation: ${railReveal} 320ms cubic-bezier(0.2, 0.8, 0.2, 1) 60ms both;

  @media (max-width: 860px) {
    min-height: auto;
    gap: 34px;
    padding: 0;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    min-height: auto;
    gap: 18px;
    padding: 0;
  }
`;

export const BrandMark = styled.a`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 12px;
  color: #ffffff;
  font-size: 17px;
  text-decoration: none;

  img {
    display: block;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: #050607;
    object-fit: cover;
    filter:
      drop-shadow(0 0 10px rgba(47, 128, 255, 0.28))
      drop-shadow(0 0 12px rgba(255, 122, 24, 0.18));
  }
`;

export const IntroCopy = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

export const Kicker = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

export const Headline = styled.h1`
  max-width: 620px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 5.6vw, 68px);
  font-weight: 820;
  letter-spacing: 0;
  line-height: 0.98;

  @media (max-width: 860px) {
    font-size: clamp(40px, 13vw, 58px);
  }

  @media (max-height: 720px) and (min-width: 861px) {
    font-size: clamp(34px, 8vh, 48px);
    line-height: 1.03;
  }
`;

export const Lede = styled.p`
  max-width: 560px;
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2vw, 18px);
  line-height: 1.62;

  @media (max-height: 720px) and (min-width: 861px) {
    line-height: 1.45;
  }
`;

export const IntroFeatureList = styled.ul`
  display: grid;
  max-width: 540px;
  gap: 10px;
  margin: 4px 0 0;
  padding: 20px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  list-style: none;

  @media (max-height: 720px) and (min-width: 861px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding-top: 12px;
  }
`;

export const IntroFeature = styled.li`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #a7b2c2;
  font-size: 14px;
  font-weight: 720;
  line-height: 1.5;

  span {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: #f7f9ff;
  }

  &[data-tone="blue"] span {
    background: #2f80ff;
  }

  &[data-tone="orange"] span {
    background: #ff7a18;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    gap: 7px;
    font-size: 12px;
    line-height: 1.35;
  }
`;

export const ApiStatus = styled.div`
  display: grid;
  width: min(100%, 560px);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 18px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    rgba(10, 15, 23, 0.74);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.24);
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 180ms both;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

export const StatusSummary = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #eef4f8;
  font-size: 14px;
  font-weight: 760;
`;

export const StatusBadge = styled.span`
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: #ffffff;
  background: rgba(255, 122, 24, 0.22);
  border: 1px solid rgba(255, 122, 24, 0.4);

  ${ApiStatus}[data-state="online"] & {
    background: rgba(47, 128, 255, 0.18);
    border-color: rgba(47, 128, 255, 0.48);
  }

  ${ApiStatus}[data-state="offline"] & {
    background: rgba(255, 107, 107, 0.16);
    border-color: rgba(255, 107, 107, 0.42);
  }
`;

export const iconPulse = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

export const statusIconSize = `
  width: 18px;
  height: 18px;
`;

export const ConnectedIcon = styled(CloudDone)`
  ${statusIconSize}
`;

export const ErrorIcon = styled(ErrorOutline)`
  ${statusIconSize}
`;

export const PendingIcon = styled(Pending)`
  ${statusIconSize}
  animation: ${iconPulse} 1.2s linear infinite;
`;

export const StatusButton = styled.button`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid rgba(47, 128, 255, 0.36);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(47, 128, 255, 0.14);
  font-size: 13px;
  font-weight: 800;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    border-color: rgba(98, 160, 255, 0.64);
    background: rgba(47, 128, 255, 0.22);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.68;
  }

  @media (max-width: 860px) {
    width: 100%;
  }
`;

export const ApiBase = styled.p`
  grid-column: 1 / -1;
  margin: 0;
  overflow-wrap: anywhere;
  color: #8f9aa5;
  font-size: 12px;
  font-weight: 700;
`;

export const PricingScreen = styled.main`
  display: grid;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  grid-template-columns: minmax(0, 0.86fr) minmax(360px, 1fr);
  align-items: center;
  gap: 36px;
  padding: 48px;
  color: #f7fafc;
  background:
    linear-gradient(145deg, rgba(47, 128, 255, 0.14), rgba(3, 5, 8, 0) 40%),
    linear-gradient(315deg, rgba(255, 122, 24, 0.13), rgba(3, 5, 8, 0) 36%),
    #030508;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    align-items: start;
    padding: 28px;
  }
`;

export const PricingHero = styled.section`
  display: grid;
  align-content: center;
  gap: 24px;
`;

export const PricingCopy = styled.div`
  display: grid;
  gap: 16px;
`;

export const PricingTitle = styled.h1`
  max-width: 640px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(40px, 6vw, 68px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.98;
`;

export const PricingText = styled.p`
  max-width: 580px;
  margin: 0;
  color: #a7b2c2;
  font-size: 17px;
  line-height: 1.72;
`;

export const PricingActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;

  button {
    min-width: 150px;
    padding: 0 16px;
  }
`;

export const PricingPlans = styled.section`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const PricingPlanCard = styled.article`
  position: relative;
  display: grid;
  min-height: 430px;
  align-content: start;
  gap: 18px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(17, 22, 27, 0.9);

  &[data-featured="true"] {
    border-color: rgba(47, 128, 255, 0.42);
    background:
      linear-gradient(145deg, rgba(47, 128, 255, 0.16), rgba(255, 122, 24, 0.09)),
      rgba(17, 22, 27, 0.92);
    box-shadow: 0 28px 80px rgba(47, 128, 255, 0.12);
  }
`;

export const PlanEyebrow = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

export const PlanPrice = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: 56px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.95;

  span {
    color: #8f9aa5;
    font-size: 18px;
    font-weight: 760;
  }
`;

export const PlanDescription = styled.p`
  margin: 0;
  color: #bdc6ce;
  font-size: 14px;
  line-height: 1.62;
`;

export const PlanFeatureList = styled.ul`
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    position: relative;
    padding-left: 20px;
    color: #e8eef3;
    font-size: 13px;
    line-height: 1.5;
  }

  li::before {
    position: absolute;
    top: 0.55em;
    left: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #62a0ff;
    content: "";
  }
`;

export const AuthenticatedWorkspaceFrame = styled.div`
  position: relative;
  width: 100%;
  min-width: 320px;
  height: calc(100vh - ${TITLE_BAR_HEIGHT});
  min-height: 0;
  overflow: hidden;
  background: #030508;

  @media (max-width: 760px) {
    height: auto;
    min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  }
`;

export const WorkspaceStartupOverlay = styled(SplashScreen).attrs({ as: "section" })`
  position: absolute;
  inset: 0;
  z-index: 50;
  width: 100%;
  height: 100%;
  min-height: 0;
`;

export const DashboardShell = styled.main`
  position: relative;
  display: grid;
  min-width: 320px;
  height: calc(100vh - ${TITLE_BAR_HEIGHT});
  min-height: 0;
  grid-template-columns: 192px minmax(280px, 1fr);
  color: #f7fafc;
  overflow: hidden;
  background:
    radial-gradient(circle at 82% 10%, rgba(47, 128, 255, 0.11), transparent 18rem),
    radial-gradient(circle at 18% 88%, rgba(255, 122, 24, 0.09), transparent 16rem),
    #030508;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-startup="true"] {
    pointer-events: none;
  }

  @media (max-width: 980px) {
    grid-template-columns: 184px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    height: auto;
    min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

export const WorkspaceRail = styled.aside`
  display: grid;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 5, 8, 0.78);
  backdrop-filter: blur(18px);
  animation: ${railReveal} 300ms cubic-bezier(0.2, 0.8, 0.2, 1) 40ms both;

  @media (max-width: 760px) {
    min-height: auto;
    grid-template-rows: auto auto;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  }
`;

export const RailTop = styled.div`
  display: grid;
  align-content: start;
  gap: 9px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 4px;
`;

export const RailSectionTitle = styled.p`
  margin: 0;
  color: #687386;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  animation: ${panelEnter} 220ms cubic-bezier(0.2, 0.8, 0.2, 1) 80ms both;
`;

export const WorkspaceList = styled.div`
  display: grid;
  min-width: 0;
  max-width: 100%;
  gap: 5px;
  overflow: hidden;
`;

export const WorkspaceRow = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  opacity: 0;
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &:nth-child(1) {
    animation-delay: 110ms;
  }

  &:nth-child(2) {
    animation-delay: 145ms;
  }

  &:nth-child(3) {
    animation-delay: 180ms;
  }
`;

export const WorkspaceButton = styled.button`
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 32px;
  grid-template-columns: 4px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 38px 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  box-sizing: border-box;
  color: #e8eef8;
  background: transparent;
  overflow: hidden;
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;

  strong {
    display: block;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-selected="true"],
  &:hover,
  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}:focus-within & {
    border-color: rgba(47, 128, 255, 0.36);
    background: rgba(47, 128, 255, 0.14);
  }

  &[data-runtime="activated"] {
    color: #ffffff;
  }
`;

export const WorkspaceLabel = styled.span`
  display: grid;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  gap: 2px;

  > span {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #687386;
    font-size: 10px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const WorkspaceSettingsButton = styled.button`
  position: absolute;
  top: 50%;
  right: 4px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%) translateX(3px);
  transition:
    opacity 160ms ease,
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover {
    border-color: rgba(255, 122, 24, 0.42);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.12);
  }

  ${WorkspaceRow}:hover &,
  ${WorkspaceRow}:focus-within & {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
  }
`;

export const WorkspaceAccent = styled.span`
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  transition:
    background 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;

  ${WorkspaceButton}[data-runtime="activating"] & {
    background: linear-gradient(180deg, #ffcf6a, #ff7a18);
    box-shadow:
      0 0 10px rgba(255, 179, 71, 0.36),
      0 0 10px rgba(255, 122, 24, 0.2);
    transform: scaleY(1.12);
  }

  ${WorkspaceButton}[data-runtime="activated"] & {
    background: linear-gradient(180deg, #66f0aa, #1fbf75);
    box-shadow:
      0 0 12px rgba(57, 217, 138, 0.42),
      0 0 14px rgba(31, 191, 117, 0.22);
    transform: scaleY(1.18);
  }
`;

export const WorkspaceMuted = styled.p`
  margin: 0;
  padding: 8px 9px;
  color: #687386;
  font-size: 12px;
  font-weight: 760;
`;

export const RailFooter = styled.div`
  display: grid;
  gap: 6px;
  min-height: 0;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 5, 8, 0.88);
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 220ms both;
`;

export const RailActionButton = styled.button`
  display: inline-flex;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 34px;
  align-items: center;
  gap: 9px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  box-sizing: border-box;
  color: #c5cdd6;
  background: transparent;
  overflow: hidden;
  font-size: 12px;
  font-weight: 800;
  transition:
    background 160ms ease,
    color 160ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &[data-active="true"],
  &:hover {
    color: #ffffff;
    background: rgba(47, 128, 255, 0.12);
  }
`;

export const BlankWorkspace = styled.section`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.18);
  background-size: 76px 76px, 76px 76px, auto;
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &::after {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, transparent, rgba(98, 160, 255, 0.035), transparent),
      radial-gradient(circle at 50% 50%, rgba(47, 128, 255, 0.05), transparent 34rem);
    content: "";
    opacity: 0.72;
    animation: ${quietSweep} 7s ease-in-out infinite;
  }

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 980px) {
    min-height: 360px;
  }
`;

export const WorkspaceViewStack = styled.div`
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #030508;
`;

export const WorkspaceViewPane = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity ${VIEW_TRANSITION_MS}ms ease,
    visibility ${VIEW_TRANSITION_MS}ms step-end;

  &[data-visible="true"] {
    z-index: 2;
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity ${VIEW_TRANSITION_MS}ms ease,
      visibility 0ms step-start;
  }
`;

export const WorkspaceIdleSurface = styled(BlankWorkspace)`
  display: grid;
  place-items: center;
  padding: 24px;
`;

export const WorkspaceIdlePanel = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 10px;
  color: #e8eef8;
  text-align: center;
`;

export const WorkspaceIdleLogo = styled.img`
  width: clamp(74px, 10vw, 118px);
  height: clamp(74px, 10vw, 118px);
  border: 1px solid rgba(98, 160, 255, 0.24);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.72);
  box-shadow:
    0 18px 70px rgba(47, 128, 255, 0.16),
    0 0 32px rgba(255, 122, 24, 0.08);
`;

export const WorkspaceIdleTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: clamp(20px, 3vw, 34px);
  font-weight: 900;
  letter-spacing: 0;
`;

export const WorkspaceIdleDetail = styled.p`
  max-width: 360px;
  margin: 0;
  color: #8d99aa;
  font-size: 13px;
  font-weight: 760;
  line-height: 1.55;
`;

export const ForgeWorkspace = styled.section`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  padding: 0;
  background:
    radial-gradient(circle at 84% 10%, rgba(47, 128, 255, 0.12), transparent 16rem),
    rgba(3, 5, 8, 0.18);
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }
`;

export const TerminalWorkspaceSurface = styled.section`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.14);
  background-size: 68px 68px, 68px 68px, auto;
`;

export const WorkspaceTerminalPanels = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);

  ${TerminalWorkspaceSurface} {
    min-height: 0;
  }
`;

export const ResizePanelGroup = styled(Group)`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
`;

export const ResizePanel = styled(Panel)`
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  &[data-terminal-row="true"],
  &[data-terminal-leaf="true"] {
    min-height: ${TERMINAL_PANE_MIN_HEIGHT_PX}px;
  }

  &[data-terminal-column="true"],
  &[data-terminal-leaf="true"] {
    min-width: ${TERMINAL_PANE_MIN_WIDTH_PX}px;
  }
`;

export const ResizeHandle = styled(Separator)`
  position: relative;
  z-index: 5;
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.08);
  transition:
    background 140ms ease,
    box-shadow 140ms ease;

  &[data-direction="horizontal"] {
    width: 5px;
    margin: 0 -2px;
    cursor: col-resize;
  }

  &[data-direction="vertical"] {
    height: 5px;
    margin: -2px 0;
    cursor: row-resize;
  }

  &::after {
    position: absolute;
    inset: 0;
    background: transparent;
    content: "";
  }

  &[data-direction="horizontal"]::after {
    left: 2px;
    right: 2px;
    background: rgba(255, 255, 255, 0.1);
  }

  &[data-direction="vertical"]::after {
    top: 2px;
    bottom: 2px;
    background: rgba(255, 255, 255, 0.1);
  }

  &:hover,
  &[data-resize-handle-state="drag"] {
    background: rgba(47, 128, 255, 0.28);
    box-shadow: 0 0 16px rgba(47, 128, 255, 0.18);
  }

  &[data-surface="files"] {
    background: #3c3c3c;
    box-shadow: none;
  }

  &[data-surface="files"][data-direction="horizontal"] {
    width: 6px;
    margin: 0 -3px;
  }

  &[data-surface="files"]::after {
    background: transparent;
  }

  &[data-surface="files"][data-direction="horizontal"]::after {
    left: 2px;
    right: 2px;
    background: #3c3c3c;
  }

  &[data-surface="files"]:hover,
  &[data-surface="files"][data-resize-handle-state="drag"] {
    background: #007fd4;
    box-shadow: none;
  }

  &[data-surface="files"]:hover::after,
  &[data-surface="files"][data-resize-handle-state="drag"]::after {
    background: #007fd4;
  }
`;

export const TerminalDevMetricsBar = styled.div`
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 30;
  display: flex;
  max-width: calc(100% - 20px);
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  pointer-events: none;
`;

export const TerminalDevMetric = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  border: 1px solid rgba(143, 157, 183, 0.22);
  border-radius: 6px;
  padding: 3px 6px;
  background: rgba(2, 4, 8, 0.82);
  color: rgba(229, 236, 248, 0.84);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
`;

export const TerminalFrame = styled.section`
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: ${TERMINAL_THEME_BACKGROUND};
  box-shadow: none;

  &[data-state="error"] {
    border-color: rgba(255, 107, 107, 0.36);
  }
`;

export const XtermSurface = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 0;
  background: ${TERMINAL_THEME_BACKGROUND};

  .xterm {
    width: 100%;
    height: 100%;
    background: ${TERMINAL_THEME_BACKGROUND} !important;
  }

  .xterm-viewport,
  .xterm-screen {
    background: ${TERMINAL_THEME_BACKGROUND} !important;
  }
`;

export const TerminalClosedSurface = styled.div`
  display: grid;
  place-items: center;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    #020304;
  background-size: 68px 68px, 68px 68px, auto;
`;

export const TerminalClosedLabel = styled.span`
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: center;
  overflow-wrap: anywhere;
  border: 1px solid rgba(143, 157, 183, 0.24);
  border-radius: 8px;
  padding: 10px 14px;
  background: rgba(8, 12, 20, 0.74);
  color: rgba(232, 238, 248, 0.92);
  font-size: 13px;
  font-weight: 900;
  line-height: 1.1;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
`;

export const TerminalRestartPill = styled.div`
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 4;
  display: inline-flex;
  max-width: calc(100% - 24px);
  min-height: 38px;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
    rgba(6, 9, 16, 0.88);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.34);
  transform: translateX(-50%);
  backdrop-filter: blur(16px);
`;

export const TerminalRestartButton = styled.button`
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0;
  border: 1px solid rgba(47, 128, 255, 0.34);
  border-radius: 999px;
  color: #d9e7ff;
  background: rgba(47, 128, 255, 0.16);
  font-size: 11px;
  font-weight: 900;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    border-color: rgba(98, 160, 255, 0.58);
    background: rgba(47, 128, 255, 0.26);
    transform: translateY(-1px);
  }
`;

export const TerminalCloseButton = styled(TerminalRestartButton)`
  border-color: rgba(255, 255, 255, 0.12);
  color: #9aa5b5;
  background: rgba(255, 255, 255, 0.045);

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.07);
  }

  &:disabled {
    opacity: 0.48;
  }
`;

export const TerminalEmptyPanel = styled.section`
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 8px;
  background:
    radial-gradient(circle at 85% 12%, rgba(255, 122, 24, 0.12), transparent 16rem),
    rgba(13, 20, 31, 0.86);
`;

export const TerminalEmptyActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const TerminalEmptyCopy = styled.div`
  display: grid;
  gap: 6px;
  max-width: 620px;
`;

export const TerminalAgentList = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

export const TerminalAgentRow = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.72);

  strong {
    display: block;
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 900;
  }

  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #8fa1bd;
    font-size: 12px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.3);
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.3);
  }
`;

export const FilesWorkspaceSurface = styled.section`
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #1e1e1e;

  > [data-panel-group] {
    width: 100%;
    height: 100%;
  }
`;

export const FileExplorerPane = styled.aside`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 0;
  border-right: 1px solid #3c3c3c;
  background: #252526;

  @media (max-width: 860px) {
    border-right: 0;
    border-bottom: 1px solid #3c3c3c;
  }
`;

export const FileExplorerHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 35px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 20px;
  color: #bbbbbb;
  background: #252526;

  p {
    color: #bbbbbb;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
  }
`;

export const FileExplorerActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
`;

export const FileIconButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: #cccccc;
  background: transparent;
  transition:
    color 160ms ease,
    background 160ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    color: #ffffff;
    background: #2a2d2e;
  }

  &:focus-visible {
    outline: 1px solid #007fd4;
    outline-offset: -1px;
  }

  &:disabled {
    opacity: 0.54;
  }
`;

export const FileRootPath = styled.p`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0 12px 6px 20px;
  border-bottom: 1px solid #303031;
  color: #858585;
  background: #252526;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 10.5px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const FileTree = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 10px;
  background: #252526;

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(121, 121, 121, 0.38);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

export const FileTreeItem = styled.div`
  min-width: 0;
`;

export const FileTreeButton = styled.button`
  display: grid;
  width: 100%;
  min-width: 0;
  height: 22px;
  min-height: 22px;
  grid-template-columns: 16px 16px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 3px;
  padding: 0 8px 0 ${({ $depth }) => 4 + ($depth || 0) * 12}px;
  border: 0;
  border-radius: 0;
  color: #cccccc;
  background: transparent;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;

  &:hover {
    color: #ffffff;
    background: #2a2d2e;
  }

  &[data-selected="true"] {
    color: #ffffff;
    background: #37373d;
  }

  &:focus-visible {
    outline: 1px solid #007fd4;
    outline-offset: -1px;
  }
`;

export const FileDisclosure = styled.span`
  display: grid;
  width: 16px;
  height: 22px;
  place-items: center;
  color: #858585;

  .codicon {
    font-size: 16px;
  }
`;

export const FileKindIcon = styled.span`
  display: grid;
  width: 16px;
  height: 22px;
  place-items: center;
  color: #cccccc;

  .codicon {
    font-size: 16px;
  }

  &[data-file-tone="folder"] {
    color: #dcb67a;
  }

  &[data-file-tone="javascript"],
  &[data-file-tone="npm"] {
    color: #cbcb41;
  }

  &[data-file-tone="typescript"] {
    color: #519aba;
  }

  &[data-file-tone="react"] {
    color: #4ec9b0;
  }

  &[data-file-tone="rust"] {
    color: #dea584;
  }

  &[data-file-tone="style"],
  &[data-file-tone="media"] {
    color: #c586c0;
  }

  &[data-file-tone="markup"],
  &[data-file-tone="markdown"] {
    color: #569cd6;
  }

  &[data-file-tone="data"],
  &[data-file-tone="database"] {
    color: #4fc1ff;
  }

  &[data-file-tone="config"],
  &[data-file-tone="lock"],
  &[data-file-tone="terminal"] {
    color: #c5c5c5;
  }

  &[data-file-tone="archive"],
  &[data-file-tone="binary"],
  &[data-file-tone="font"],
  &[data-file-tone="pdf"] {
    color: #d7ba7d;
  }

  &[data-file-tone="docker"],
  &[data-file-tone="python"],
  &[data-file-tone="git"] {
    color: #75beff;
  }

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ff7b72;
  }
`;

export const FileTreeName = styled.span`
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ff7b72;
  }
`;

export const FileGitStatusMark = styled.span`
  display: grid;
  width: 18px;
  height: 22px;
  place-items: center;
  justify-self: end;
  color: transparent;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ff7b72;
  }
`;

export const FileTreeChildren = styled.div`
  min-width: 0;
`;

export const FileTreeMessage = styled.p`
  margin: 0;
  overflow: hidden;
  height: 22px;
  padding: 0 8px 0 ${({ $depth }) => 36 + ($depth || 0) * 12}px;
  color: #858585;
  font-size: 12px;
  font-weight: 400;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-tone="error"] {
    color: #ffb0b0;
  }
`;

export const FileTreeEmpty = styled.p`
  margin: 0;
  padding: 8px 20px;
  color: #858585;
  font-size: 12px;
  font-weight: 400;
`;

export const FilePreviewPane = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  background: #1e1e1e;
`;

export const FilePreviewHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 35px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px 0 0;
  border-bottom: 1px solid #3c3c3c;
  background: #252526;
`;

export const FilePreviewTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  max-width: min(520px, 62%);
  min-height: 35px;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  border-right: 1px solid #3c3c3c;
  color: #cccccc;
  background: #1e1e1e;
  font-size: 13px;
  font-weight: 400;

  .codicon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: #cccccc;
    font-size: 16px;
  }

  &[data-file-tone="javascript"] .codicon,
  &[data-file-tone="npm"] .codicon {
    color: #cbcb41;
  }

  &[data-file-tone="typescript"] .codicon {
    color: #519aba;
  }

  &[data-file-tone="react"] .codicon {
    color: #4ec9b0;
  }

  &[data-file-tone="rust"] .codicon {
    color: #dea584;
  }

  &[data-file-tone="style"] .codicon,
  &[data-file-tone="media"] .codicon {
    color: #c586c0;
  }

  &[data-file-tone="markup"] .codicon,
  &[data-file-tone="markdown"] .codicon {
    color: #569cd6;
  }

  &[data-file-tone="data"] .codicon,
  &[data-file-tone="database"] .codicon {
    color: #4fc1ff;
  }

  &[data-file-tone="config"] .codicon,
  &[data-file-tone="lock"] .codicon,
  &[data-file-tone="terminal"] .codicon {
    color: #c5c5c5;
  }

  &[data-file-tone="archive"] .codicon,
  &[data-file-tone="binary"] .codicon,
  &[data-file-tone="font"] .codicon,
  &[data-file-tone="pdf"] .codicon {
    color: #d7ba7d;
  }

  &[data-file-tone="docker"] .codicon,
  &[data-file-tone="python"] .codicon,
  &[data-file-tone="git"] .codicon {
    color: #75beff;
  }

  &[data-git-status="added"] .codicon,
  &[data-git-status="copied"] .codicon,
  &[data-git-status="untracked"] .codicon {
    color: #73c991;
  }

  &[data-git-status="modified"] .codicon,
  &[data-git-status="renamed"] .codicon {
    color: #e2c08d;
  }

  &[data-git-status="deleted"] .codicon,
  &[data-git-status="conflicted"] .codicon {
    color: #ff7b72;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-git-status="added"] span,
  &[data-git-status="copied"] span,
  &[data-git-status="untracked"] span {
    color: #73c991;
  }

  &[data-git-status="modified"] span,
  &[data-git-status="renamed"] span {
    color: #e2c08d;
  }

  &[data-git-status="deleted"] span,
  &[data-git-status="conflicted"] span {
    color: #ff7b72;
  }
`;

export const FilePreviewMeta = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  min-width: 0;
  align-items: center;
  gap: 6px;
`;

export const FileGitStatusPill = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 2px 6px;
  border: 1px solid #3c3c3c;
  border-radius: 3px;
  background: #2d2d2d;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    border-color: rgba(115, 201, 145, 0.34);
    color: #73c991;
    background: rgba(115, 201, 145, 0.1);
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    border-color: rgba(226, 192, 141, 0.34);
    color: #e2c08d;
    background: rgba(226, 192, 141, 0.1);
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    border-color: rgba(255, 123, 114, 0.38);
    color: #ffb0aa;
    background: rgba(255, 123, 114, 0.12);
  }
`;

export const FileMetaPill = styled.span`
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 1px solid #3c3c3c;
  border-radius: 3px;
  color: #cccccc;
  background: #2d2d2d;
  font-size: 10px;
  font-weight: 500;
  line-height: 14px;
`;

export const FilePreviewPath = styled.p`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  padding: 4px 14px;
  border-bottom: 1px solid #2d2d2d;
  color: #858585;
  background: #1e1e1e;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 11px;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ffb0aa;
  }
`;

export const FileContentFrame = styled.section`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #1e1e1e;
`;

export const FilePreviewScroll = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: auto;
  background: #1e1e1e;

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(121, 121, 121, 0.38);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

export const HighlightedCodeBlock = styled.pre`
  min-width: max-content;
  min-height: 100%;
  margin: 0;
  padding: 14px 16px 28px;
  color: #d4d4d4;
  background: #1e1e1e;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
  line-height: 1.5;
  tab-size: 2;
  white-space: pre;

  .token.comment,
  .token.prolog,
  .token.doctype,
  .token.cdata {
    color: #6a9955;
    font-style: italic;
  }

  .token.punctuation {
    color: #d4d4d4;
  }

  .token.property,
  .token.tag,
  .token.boolean,
  .token.number,
  .token.constant,
  .token.symbol,
  .token.deleted {
    color: #b5cea8;
  }

  .token.selector,
  .token.attr-name,
  .token.string,
  .token.char,
  .token.builtin,
  .token.inserted {
    color: #ce9178;
  }

  .token.operator,
  .token.entity,
  .token.url,
  .language-css .token.string,
  .style .token.string {
    color: #d4d4d4;
  }

  .token.atrule,
  .token.attr-value,
  .token.keyword {
    color: #569cd6;
  }

  .token.function,
  .token.class-name {
    color: #dcdcaa;
  }

  .token.regex,
  .token.important,
  .token.variable {
    color: #d16969;
  }

  .token.namespace {
    opacity: 0.78;
  }
`;

export const FileDiffPanel = styled.section`
  display: grid;
  min-width: 0;
  margin: 0;
  border-bottom: 1px solid #2d2d2d;
  background: #181818;
`;

export const FileDiffHeader = styled.header`
  display: flex;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid #2d2d2d;
  color: #cccccc;
  background: #252526;
  font-size: 12px;

  .codicon {
    color: #e2c08d;
    font-size: 15px;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const FileDiffBadge = styled.span`
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid rgba(226, 192, 141, 0.34);
  border-radius: 3px;
  color: #e2c08d;
  background: rgba(226, 192, 141, 0.1);
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
`;

export const FileDiffMessage = styled.p`
  margin: 0;
  padding: 10px 14px;
  color: #858585;
  font-size: 12px;
  line-height: 18px;

  &[data-tone="error"] {
    color: #ffb0b0;
  }
`;

export const DiffCodeBlock = styled.pre`
  min-width: max-content;
  max-height: 42vh;
  margin: 0;
  overflow: auto;
  padding: 6px 0 8px;
  color: #d4d4d4;
  background: #1e1e1e;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.45;
  tab-size: 2;
  white-space: pre;

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(121, 121, 121, 0.38);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

export const DiffLine = styled.div`
  min-height: 18px;
  padding: 0 14px;

  &[data-tone="added"] {
    color: #b5f1c0;
    background: rgba(46, 160, 67, 0.18);
  }

  &[data-tone="removed"] {
    color: #ffd0d0;
    background: rgba(248, 81, 73, 0.16);
  }

  &[data-tone="hunk"] {
    color: #9cdcfe;
    background: rgba(47, 128, 255, 0.12);
  }

  &[data-tone="header"],
  &[data-tone="meta"] {
    color: #858585;
  }
`;

export const FileEmptyState = styled.div`
  display: grid;
  width: min(420px, 100%);
  min-height: 100%;
  align-content: center;
  justify-items: center;
  gap: 10px;
  margin: 0 auto;
  padding: 22px;
  color: #858585;
  text-align: center;

  h2 {
    color: #cccccc;
    font-size: 15px;
    font-weight: 500;
  }
`;

export const FileEmptyIcon = styled.span`
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  color: #cccccc;
  background: #252526;

  svg,
  .codicon {
    width: 20px;
    height: 20px;
    font-size: 20px;
  }

  &[data-tone="error"] {
    border-color: rgba(255, 107, 107, 0.34);
    color: #ffd0d0;
    background: rgba(255, 107, 107, 0.12);
  }
`;

export const VaultWorkspaceSurface = styled.section`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: auto;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.14);
  background-size: 68px 68px, 68px 68px, auto;
`;

export const VaultPlaceholderPanel = styled.section`
  display: grid;
  width: min(640px, 100%);
  min-width: 0;
  gap: 16px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 86% 12%, rgba(255, 122, 24, 0.12), transparent 16rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.015)),
    rgba(13, 20, 31, 0.9);
`;

export const VaultPlaceholderIcon = styled.span`
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.12);

  svg {
    width: 22px;
    height: 22px;
  }
`;

export const VaultStatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioWorkspaceSurface = styled(VaultWorkspaceSurface)`
  place-items: stretch;
  align-content: center;
  justify-items: center;
`;

export const AudioSetupPanel = styled.section`
  display: grid;
  width: min(760px, 100%);
  align-self: center;
  gap: 16px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 8px;
  background:
    radial-gradient(circle at 88% 12%, rgba(47, 128, 255, 0.16), transparent 17rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.016)),
    rgba(13, 20, 31, 0.92);

  &[data-installed="true"] {
    border-color: rgba(47, 128, 255, 0.3);
  }
`;

export const AudioHeroRow = styled.div`
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-width: 0;

  @media (max-width: 680px) {
    grid-template-columns: 48px minmax(0, 1fr);

    > span:last-child {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
`;

export const AudioStatePill = styled.span`
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(255, 122, 24, 0.36);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.12);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;

  &[data-installed="true"] {
    border-color: rgba(47, 128, 255, 0.38);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.13);
  }
`;

export const AudioStatusGrid = styled(VaultStatusGrid)`
  grid-template-columns: repeat(3, minmax(0, 1fr));
`;

export const AudioPathBlock = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(3, 5, 8, 0.52);

  span {
    color: #687386;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;

export const AudioCodePath = styled.code`
  min-width: 0;
  overflow: hidden;
  color: #d7e5ff;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AudioRuntimeHint = styled.p`
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.1);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
  overflow-wrap: anywhere;
`;

export const AudioProgressPanel = styled.div`
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(47, 128, 255, 0.24);
  border-radius: 8px;
  background: rgba(47, 128, 255, 0.08);
`;

export const AudioProgressTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #e8eef8;
  font-size: 12px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioProgressTrack = styled.div`
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
`;

export const AudioProgressBar = styled.div`
  width: ${({ $progress }) => `${Math.max(0, Math.min(100, $progress || 0))}%`};
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f80ff, #ff7a18);
  transition: width 180ms ease;
`;

export const AudioProgressMeta = styled.p`
  margin: 0;
  color: #8793a5;
  font-size: 11px;
  font-weight: 760;
`;

export const AudioActionRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(132px, auto);
  gap: 10px;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const AudioWidgetShell = styled.main`
  display: grid;
  min-width: 320px;
  min-height: 100vh;
  align-content: start;
  gap: 14px;
  padding: 14px;
  color: #f7f9ff;
  background:
    radial-gradient(circle at 84% 8%, rgba(47, 128, 255, 0.18), transparent 12rem),
    radial-gradient(circle at 12% 92%, rgba(255, 122, 24, 0.12), transparent 10rem),
    #030508;
`;

export const AudioWidgetHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  -webkit-app-region: drag;

  button {
    -webkit-app-region: no-drag;
  }
`;

export const AudioWidgetTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  color: #ffffff;

  > span {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 1px solid rgba(47, 128, 255, 0.38);
    border-radius: 8px;
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.13);
  }

  svg {
    width: 17px;
    height: 17px;
  }

  strong {
    overflow: hidden;
    font-size: 14px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioWidgetMeter = styled.div`
  display: grid;
  height: 104px;
  grid-template-columns: repeat(18, minmax(4px, 1fr));
  align-items: center;
  gap: 5px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.014)),
    rgba(8, 13, 20, 0.9);

  span {
    display: block;
    height: var(--height);
    min-height: 10px;
    border-radius: 999px;
    background: rgba(104, 115, 134, 0.48);
    transform-origin: center;
    transition:
      background 160ms ease,
      transform 160ms ease;
  }

  &[data-active="true"] span {
    background: linear-gradient(180deg, #62a0ff, #ff9a3d);
    animation: ${quietSweep} 900ms ease-in-out infinite alternate;
  }
`;

export const AudioWidgetStatus = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(3, 5, 8, 0.52);

  strong {
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 900;
  }

  span {
    overflow: hidden;
    color: #8793a5;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AudioRecordingTimer = styled.p`
  margin: 0;
  color: #ffb269;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 28px;
  font-weight: 900;
  text-align: center;
`;

export const AudioWidgetTranscript = styled.p`
  max-height: 88px;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid rgba(47, 128, 255, 0.22);
  border-radius: 8px;
  color: #d7e5ff;
  background: rgba(47, 128, 255, 0.08);
  font-size: 12px;
  line-height: 1.5;
`;

export const AudioWidgetActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(96px, auto);
  gap: 8px;

  button {
    min-height: 42px;
  }
`;

export const McpWorkspaceSurface = styled.section`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 14px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.14);
  background-size: 68px 68px, 68px 68px, auto;
`;

export const McpHeaderPanel = styled.section`
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.12), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
    rgba(13, 20, 31, 0.9);
`;

export const McpTitleRow = styled.div`
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-width: 0;

  button {
    min-height: 40px;
  }

  @media (max-width: 760px) {
    grid-template-columns: 48px minmax(0, 1fr);

    > button {
      grid-column: 1 / -1;
      width: 100%;
    }
  }
`;

export const McpStatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const McpLayout = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

export const McpRegistryPanel = styled.aside`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 10px;
  overflow: hidden;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.74);
`;

export const McpPanelTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #687386;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  strong {
    color: #8bb9ff;
  }
`;

export const McpServerList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  overflow: auto;
`;

export const McpServerButton = styled.button`
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e8eef8;
  background: rgba(255, 255, 255, 0.035);
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease;

  &[data-active="true"],
  &:hover {
    border-color: rgba(47, 128, 255, 0.4);
    background: rgba(47, 128, 255, 0.13);
  }
`;

export const McpServerIcon = styled.span`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-state="enabled"] {
    border-color: rgba(47, 128, 255, 0.36);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }

  &[data-state="planned"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.12);
  }
`;

export const McpServerCopy = styled.span`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 900;
  }

  span {
    color: #8793a5;
    font-size: 11px;
    font-weight: 760;
  }
`;

export const McpStatusBadge = styled.span`
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;

  &[data-state="enabled"] {
    border-color: rgba(47, 128, 255, 0.34);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.12);
  }

  &[data-state="planned"] {
    border-color: rgba(255, 122, 24, 0.34);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.1);
  }
`;

export const McpEditorPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 14px;
  overflow: auto;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.016)),
    rgba(8, 13, 20, 0.9);
`;

export const McpEditorHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  @media (max-width: 680px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

export const McpSwitchButton = styled.button`
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.1);
  font-size: 12px;
  font-weight: 900;

  > span {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
  }

  > span::after {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ffb269;
    content: "";
    transition: transform 160ms ease;
  }

  &[aria-pressed="true"] {
    border-color: rgba(47, 128, 255, 0.38);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.13);
  }

  &[aria-pressed="true"] > span::after {
    background: #62a0ff;
    transform: translateX(12px);
  }

  &:disabled {
    opacity: 0.76;
  }
`;

export const McpFieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const McpWideField = styled.label`
  display: grid;
  gap: 8px;
  grid-column: 1 / -1;
`;

export const McpInput = styled.input`
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.92);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;

  &:focus {
    border-color: rgba(47, 128, 255, 0.5);
    outline: none;
    box-shadow: 0 0 0 3px rgba(47, 128, 255, 0.12);
  }
`;

export const McpTextarea = styled.textarea`
  width: 100%;
  min-height: 86px;
  resize: vertical;
  padding: 11px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.76);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.5;
  outline: none;

  &:focus {
    border-color: rgba(47, 128, 255, 0.52);
    box-shadow: 0 0 0 3px rgba(47, 128, 255, 0.12);
  }
`;

export const McpJsonTextarea = styled(McpTextarea)`
  min-height: 164px;
`;

export const McpTransportTabs = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(3, 5, 8, 0.46);

  @media (max-width: 620px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

export const McpTransportButton = styled.button`
  min-width: 0;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #a7b2c2;
  background: transparent;
  font-size: 12px;
  font-weight: 900;

  &[data-active="true"],
  &:hover {
    border-color: rgba(47, 128, 255, 0.38);
    color: #ffffff;
    background: rgba(47, 128, 255, 0.14);
  }
`;

export const McpAccessGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
  }
`;

export const McpAccessPanel = styled.section`
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
`;

export const McpAccessTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #f7f9ff;
  font-size: 12px;
  font-weight: 900;

  > span {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  svg {
    width: 16px;
    height: 16px;
    color: #8bb9ff;
  }
`;

export const McpInlineActions = styled.span`
  display: inline-flex;
  gap: 5px;

  button {
    min-height: 26px;
    padding: 0 7px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: #a7b2c2;
    background: rgba(6, 9, 16, 0.72);
    font-size: 10px;
    font-weight: 900;
  }

  button:hover {
    border-color: rgba(47, 128, 255, 0.4);
    color: #ffffff;
  }
`;

export const McpCheckList = styled.div`
  display: grid;
  gap: 7px;
  min-width: 0;
`;

export const McpCheckRow = styled.label`
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.52);

  input {
    width: 16px;
    height: 16px;
    accent-color: #2f80ff;
  }

  > span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong,
  small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f7f9ff;
    font-size: 12px;
    font-weight: 900;
  }

  small {
    color: #8793a5;
    font-size: 11px;
    font-weight: 760;
  }
`;

export const McpEmptyAccess = styled.p`
  margin: 0;
  padding: 10px;
  border: 1px solid rgba(255, 122, 24, 0.24);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.08);
  font-size: 12px;
  font-weight: 760;
`;

export const McpScopePreview = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const McpEditorActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-height: 40px;
    min-width: 112px;
  }

  @media (max-width: 680px) {
    align-items: stretch;
    flex-direction: column;

    button {
      width: 100%;
    }
  }
`;

export const WorkspaceSetupPanel = styled.form`
  display: grid;
  width: min(520px, 100%);
  align-self: center;
  justify-self: center;
  gap: 16px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 85% 10%, rgba(47, 128, 255, 0.14), transparent 14rem),
    rgba(13, 20, 31, 0.9);
`;

export const SetupHeader = styled.div`
  display: grid;
  gap: 6px;
`;

export const SetupField = styled.label`
  display: grid;
  gap: 8px;
`;

export const SetupInput = styled.input`
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.92);
  font: inherit;

  &:focus {
    border-color: rgba(47, 128, 255, 0.5);
    outline: none;
    box-shadow: 0 0 0 3px rgba(47, 128, 255, 0.12);
  }
`;

export const BlankStatusStack = styled.div`
  display: grid;
  justify-self: end;
  width: min(520px, 100%);
  gap: 8px;
`;

export const WorkspaceSettingsOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  background: rgba(3, 5, 8, 0.64);
  animation: ${panelEnter} 160ms ease both;
`;

export const WorkspaceSettingsDialog = styled.aside`
  display: grid;
  align-content: start;
  gap: 16px;
  width: min(560px, 100%);
  max-height: min(620px, 100%);
  min-width: 0;
  overflow: auto;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018)),
    rgba(8, 13, 20, 0.98);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
  animation: ${panelEnter} 190ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 620px) {
    width: 100%;
    max-height: 100%;
  }
`;

export const WorkspaceSettingsDialogHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

export const WorkspaceModalCloseButton = styled.button`
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.72);
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;

  &:hover {
    border-color: rgba(255, 140, 140, 0.38);
    color: #ffd2d2;
    background: rgba(255, 140, 140, 0.1);
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

export const WorkspaceSettingsForm = styled.form`
  display: grid;
  gap: 14px;
  min-width: 0;
`;

export const WorkspaceSettingsInput = styled(SetupInput)`
  min-height: 42px;
`;

export const WorkspaceNumberInput = styled(WorkspaceSettingsInput)`
  width: 100%;
`;

export const RootDirectoryInput = styled(WorkspaceSettingsInput)`
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 12px;
`;

export const WorkspaceSettingsFieldGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
  gap: 12px;
  min-width: 0;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

export const WorkspaceRuntimePanel = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);

  &[data-state="activated"] {
    border-color: rgba(57, 217, 138, 0.28);
    background:
      linear-gradient(90deg, rgba(57, 217, 138, 0.12), rgba(47, 128, 255, 0.045)),
      rgba(255, 255, 255, 0.035);
  }

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

export const WorkspaceRuntimeActions = styled.div`
  display: flex;
  min-width: 0;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-width: 116px;
  }

  @media (max-width: 640px) {
    justify-content: stretch;

    button {
      flex: 1 1 140px;
    }
  }
`;

export const WorkspaceSettingsActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;

  button {
    min-width: 132px;
  }

  @media (max-width: 640px) {
    align-items: stretch;
    flex-direction: column;

    button {
      width: 100%;
    }
  }
`;

export const AgentSettingsPanel = styled.section`
  position: relative;
  display: grid;
  gap: 16px;
  align-self: start;
  min-width: 0;
  min-height: 340px;
  overflow: hidden;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.14), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
    rgba(13, 20, 31, 0.86);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);

  &::before {
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(90deg, #2f80ff, rgba(255, 122, 24, 0.72), transparent);
    content: "";
  }
`;

export const AgentPanelActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;

  button {
    min-height: 40px;
  }
`;

export const AgentReadyPill = styled.div`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #e8eef8;
  background: rgba(6, 9, 16, 0.74);
  font-size: 12px;
  font-weight: 900;

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-tone="blue"] {
    border-color: rgba(47, 128, 255, 0.38);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.13);
  }

  &[data-tone="orange"] {
    border-color: rgba(255, 122, 24, 0.38);
    color: #ffb16a;
    background: rgba(255, 122, 24, 0.12);
  }
`;

export const AgentCardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 12px;
  min-height: 0;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

export const AgentCard = styled.section`
  position: relative;
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.012)),
    rgba(6, 9, 16, 0.78);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  &::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: rgba(255, 255, 255, 0.12);
    content: "";
  }

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018)),
      rgba(8, 13, 20, 0.88);
    transform: translateY(-1px);
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.32);
  }

  &[data-tone="ready"]::before {
    background: #2f80ff;
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.32);
  }

  &[data-tone="needsAuth"]::before {
    background: #ff7a18;
  }
`;

export const AgentCardHeader = styled.div`
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
`;

export const AgentIcon = styled.span`
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(255, 255, 255, 0.04);

  svg {
    width: 19px;
    height: 19px;
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.36);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.14);
  }
`;

export const AgentName = styled.h3`
  margin: 0;
  overflow: hidden;
  color: #f7f9ff;
  font-size: 15px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AgentMeta = styled.p`
  margin: 3px 0 0;
  overflow: hidden;
  color: #687386;
  font-size: 12px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AgentStatusText = styled.p`
  margin: 0;
  min-height: 38px;
  color: #a7b2c2;
  font-size: 13px;
  line-height: 1.45;
`;

export const AgentInstallPanel = styled.div`
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
`;

export const AgentInstallTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #f7f9ff;
  font-size: 12px;
  font-weight: 860;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const AgentInstallBadge = styled.span`
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid rgba(47, 128, 255, 0.34);
  border-radius: 999px;
  color: #8bb9ff;
  background: rgba(47, 128, 255, 0.12);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
`;

export const AgentInstallHint = styled.p`
  margin: 0;
  color: #8793a5;
  font-size: 12px;
  font-weight: 720;
  line-height: 1.45;
`;

export const AgentInstallActions = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
`;

export const AgentInstallCommand = styled.code`
  display: block;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(3, 5, 8, 0.54);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AgentPermissionHint = styled.p`
  margin: 0;
  padding: 8px 9px;
  border: 1px solid rgba(255, 122, 24, 0.34);
  border-radius: 8px;
  color: #ffb269;
  background: rgba(255, 122, 24, 0.1);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
`;

export const AgentInstallMessage = styled.p`
  margin: 0;
  padding: 8px 9px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.58);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
  overflow-wrap: anywhere;

  &[data-tone="success"] {
    border-color: rgba(47, 128, 255, 0.32);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.1);
  }

  &[data-tone="warning"] {
    border-color: rgba(255, 122, 24, 0.34);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.1);
  }
`;

export const AgentActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

export const AgentActionTooltip = styled.span`
  display: block;
  min-width: 0;

  button {
    width: 100%;
  }
`;

export const PageHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  @media (max-width: 760px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

export const PageSubline = styled.p`
  margin: 7px 0 0;
  color: #a7b2c2;
  font-size: 14px;
  line-height: 1.5;
`;

export const DashboardTitle = styled.h1`
  margin: 6px 0 0;
  color: #ffffff;
  font-size: 28px;
  font-weight: 850;
  letter-spacing: 0;
`;

export const PanelHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;

  > div:first-child {
    min-width: 0;
  }
`;

export const PanelKicker = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.11em;
  text-transform: uppercase;
`;

export const PanelHeading = styled.h2`
  margin: 4px 0 0;
  color: #f7f9ff;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0;
`;

export const SettingsPage = styled.section`
  display: grid;
  grid-column: 1 / -1;
  width: 100%;
  height: 100%;
  min-width: 0;
  align-content: start;
  grid-auto-rows: max-content;
  gap: 18px;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.1);
  background-size: 72px 72px, 72px 72px, auto;
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 760px) {
    grid-column: 1;
    padding: 18px;
  }
`;

export const AccountSettingsPanel = styled.section`
  display: grid;
  gap: 14px;
  padding-top: 8px;
`;

export const AccountCard = styled.section`
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(47, 128, 255, 0.32);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.13), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.016)),
    rgba(13, 20, 31, 0.86);
`;

export const AccountCardHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;

  > div:first-child {
    display: grid;
    min-width: min(100%, 280px);
    gap: 10px;
  }
`;

export const AccountCardFooter = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 2px;

  button {
    min-height: 42px;
    min-width: 132px;
  }

  @media (max-width: 760px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

export const SettingsLabel = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

export const SettingsValue = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #ffffff;
  font-size: 19px;
  font-weight: 820;
  line-height: 1.25;
`;

export const SettingsHint = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #a7b2c2;
  font-size: 13px;
  line-height: 1.55;
`;

export const SettingsIdentityGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const SettingsIdentityItem = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.58);

  span {
    color: #687386;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 860;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const LoginCard = styled.section`
  position: relative;
  z-index: 1;
  width: 100%;
  padding: clamp(20px, 4vh, 30px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background:
    radial-gradient(circle at 86% 10%, rgba(47, 128, 255, 0.16), transparent 14rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    rgba(10, 15, 23, 0.88);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.46);
  animation: ${sideReveal} 320ms cubic-bezier(0.2, 0.8, 0.2, 1) 110ms both;

  @media (max-width: 860px) {
    padding: 24px;
  }
`;

export const LoginPanel = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

export const SessionPanel = styled.div`
  display: grid;
  gap: 16px;
`;

export const LoginCardTop = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
`;

export const LoginCardBadge = styled.span`
  padding: 5px 9px;
  border: 1px solid rgba(47, 128, 255, 0.36);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &[data-state="waiting"],
  &[data-state="exchanging"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.14);
  }
`;

export const LoginIconWrap = styled.span`
  display: grid;
  width: clamp(38px, 6vh, 44px);
  height: clamp(38px, 6vh, 44px);
  place-items: center;
  border: 1px solid rgba(47, 128, 255, 0.42);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);
  box-shadow: 0 0 18px rgba(47, 128, 255, 0.14);
  transition:
    background 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease;

  ${LoginPanel}:hover & {
    transform: translateY(-1px) scale(1.02);
  }
`;

export const SuccessBadge = styled(LoginIconWrap)`
  border-color: rgba(255, 122, 24, 0.42);
  color: #ff9a3d;
  background: rgba(255, 122, 24, 0.14);
`;

export const SessionTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: clamp(21px, 3.5vh, 24px);
  font-weight: 820;
  letter-spacing: 0;
`;

export const SessionText = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #a7b2c2;
  font-size: 15px;
  line-height: 1.55;
`;

export const AuthStepRail = styled.div`
  display: grid;
  gap: 9px;
  padding: clamp(10px, 2vh, 14px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
`;

export const AuthStep = styled.div`
  display: grid;
  min-height: clamp(30px, 5vh, 38px);
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  color: #a7b2c2;
  font-size: 12px;
  font-weight: 800;
  opacity: 0;
  animation: ${panelEnter} 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &:nth-child(1) {
    animation-delay: 170ms;
  }

  &:nth-child(2) {
    animation-delay: 205ms;
  }

  &:nth-child(3) {
    animation-delay: 240ms;
  }

  span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #687386;
    background: rgba(255, 255, 255, 0.04);
    font-size: 11px;
  }

  &[data-active="true"] {
    color: #f7f9ff;
  }

  &[data-active="true"] span {
    border-color: rgba(47, 128, 255, 0.42);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }
`;

export const PrimaryButton = styled.button`
  display: inline-flex;
  min-width: 0;
  min-height: clamp(44px, 6.5vh, 50px);
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  color: #ffffff;
  background: #2f80ff;
  font-weight: 880;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    background: #62a0ff;
    box-shadow: 0 0 18px rgba(47, 128, 255, 0.24);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.7;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const SecondaryButton = styled(PrimaryButton)`
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.76);

  &:hover:not(:disabled) {
    border-color: rgba(47, 128, 255, 0.5);
    background: rgba(255, 255, 255, 0.08);
  }
`;

export const PrimaryDangerButton = styled(SecondaryButton)`
  border-color: rgba(255, 140, 140, 0.28);
  color: #ffd2d2;

  &:hover:not(:disabled) {
    border-color: rgba(255, 140, 140, 0.5);
    background: rgba(255, 140, 140, 0.1);
  }
`;

export const FormMessage = styled.p`
  margin: 0;
  padding: ${({ $state }) => ($state === "error" ? "11px 13px" : 0)};
  border: ${({ $state }) => ($state === "error" ? "1px solid rgba(255, 107, 107, 0.34)" : 0)};
  border-radius: ${({ $state }) => ($state === "error" ? "8px" : 0)};
  color: ${({ $state }) => ($state === "error" ? "#ffd0d0" : "#a7b2c2")};
  background: ${({ $state }) => ($state === "error" ? "rgba(255, 107, 107, 0.12)" : "transparent")};
  font-size: 14px;
  line-height: 1.55;
`;

export const buttonIconSize = `
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
`;

export const titleIconSize = `
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
`;

export const TitleMinimizeIcon = styled(Remove)`
  ${titleIconSize}
`;

export const TitleMaximizeIcon = styled(CropSquare)`
  ${titleIconSize}
`;

export const TitleRestoreIcon = styled(FullscreenExit)`
  ${titleIconSize}
`;

export const TitleCloseIcon = styled(Close)`
  ${titleIconSize}
`;

export const ButtonRefreshIcon = styled(Refresh)`
  ${buttonIconSize}
`;

export const ButtonAddIcon = styled(Add)`
  ${buttonIconSize}
`;

export const ButtonLoginIcon = styled(Login)`
  ${buttonIconSize}
`;

export const ButtonBrowserIcon = styled(OpenInBrowser)`
  ${buttonIconSize}
`;

export const ButtonCloseIcon = styled(Close)`
  ${buttonIconSize}
`;

export const ButtonFolderIcon = styled(FolderOpen)`
  ${buttonIconSize}
`;

export const ButtonLogoutIcon = styled(Logout)`
  ${buttonIconSize}
`;

export const ButtonSettingsIcon = styled(Settings)`
  ${buttonIconSize}
`;

export const ButtonForgeIcon = styled(Bolt)`
  ${buttonIconSize}
`;

export const ButtonCodeIcon = styled(Code)`
  ${buttonIconSize}
`;

export const ButtonBotIcon = styled(SmartToy)`
  ${buttonIconSize}
`;

export const ButtonTerminalIcon = styled(TerminalIcon)`
  ${buttonIconSize}
`;

export const ButtonKeyIcon = styled(Key)`
  ${buttonIconSize}
`;

export const ButtonMicIcon = styled(Mic)`
  ${buttonIconSize}
`;

export const ButtonHubIcon = styled(Hub)`
  ${buttonIconSize}
`;

export const ButtonCheckIcon = styled(CheckCircle)`
  ${buttonIconSize}
`;

export const FileChevronIcon = styled(ChevronRight)`
  width: 16px;
  height: 16px;
`;

export const FileExpandIcon = styled(ExpandMore)`
  width: 16px;
  height: 16px;
`;

export const FileFolderTreeIcon = styled(FolderOpen)`
  width: 16px;
  height: 16px;
`;

export const FileDocumentIcon = styled(Description)`
  width: 16px;
  height: 16px;
`;
