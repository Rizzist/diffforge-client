import styled from "styled-components";

// Shared chrome for the Video Editor pane family. Palette mirrors the PCB
// pane (dark surface #020304, cards #07101d, emerald accent), sized for a
// dense editing surface: thin rails, small quiet buttons, no chunky chrome.

export const VideoPaneButton = styled.button`
  appearance: none;
  border: 1px solid rgba(16, 185, 129, 0.32);
  background: rgba(16, 185, 129, 0.1);
  color: #a7f3d0;
  font-size: 11px;
  font-weight: 700;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.18);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

export const VideoSecondaryButton = styled(VideoPaneButton)`
  border-color: rgba(148, 163, 184, 0.22);
  background: transparent;
  color: rgba(203, 213, 225, 0.85);

  &:hover:not(:disabled) {
    background: rgba(30, 41, 59, 0.55);
    border-color: rgba(148, 163, 184, 0.34);
    color: rgba(241, 245, 249, 0.94);
  }
`;

export const VideoDangerButton = styled(VideoPaneButton)`
  border-color: rgba(248, 113, 113, 0.38);
  background: transparent;
  color: #fca5a5;

  &:hover:not(:disabled) {
    background: rgba(127, 29, 29, 0.3);
  }
`;

export const VideoIconButton = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: rgba(148, 163, 184, 0.85);
  cursor: pointer;
  flex: none;
  padding: 0;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover:not(:disabled) {
    background: rgba(148, 163, 184, 0.14);
    color: #f1f5f9;
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }

  &[data-active="true"] {
    background: rgba(16, 185, 129, 0.16);
    color: #a7f3d0;
  }
`;

export const VideoInput = styled.input`
  min-width: 0;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  outline: 0;
  color: rgba(241, 245, 249, 0.94);
  background: rgba(2, 6, 12, 0.82);
  font-size: 11px;
  font-weight: 650;

  &:focus {
    border-color: rgba(16, 185, 129, 0.55);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
  }

  &::placeholder {
    color: rgba(148, 163, 184, 0.55);
  }

  &[type="color"] {
    padding: 2px;
    min-width: 32px;
  }
`;

export const VideoTextArea = styled.textarea`
  min-width: 0;
  min-height: 56px;
  padding: 7px 9px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  outline: 0;
  resize: vertical;
  color: rgba(241, 245, 249, 0.94);
  background: rgba(2, 6, 12, 0.82);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1.45;

  &:focus {
    border-color: rgba(16, 185, 129, 0.55);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
  }
`;

export const VideoLabel = styled.label`
  display: grid;
  gap: 3px;
  min-width: 0;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.85);
`;

export const VideoHint = styled.div`
  font-size: 10.5px;
  font-weight: 550;
  color: #8fa0b8;
  line-height: 1.45;
`;

export const VideoErrorText = styled.div`
  font-size: 10.5px;
  font-weight: 650;
  color: #fca5a5;
  line-height: 1.4;
  overflow-wrap: anywhere;
`;

export const VideoCard = styled.div`
  display: grid;
  gap: 9px;
  padding: 11px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 9px;
  background: rgba(9, 13, 20, 0.72);
  min-width: 0;
`;

// The pane's single thin nav rail — PCB ViewTabRail sibling: horizontal,
// trackpad-scrollable, hidden scrollbar.
export const VideoRail = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  overflow-x: auto;
  flex: 0 0 auto;
  min-height: 28px;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

export const VideoRailButton = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(148, 163, 184, 0.88);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  flex: none;

  svg {
    width: 11px;
    height: 11px;
  }

  &:hover {
    color: #e2e8f0;
  }

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.55);
    background: rgba(37, 99, 235, 0.2);
    color: #dbeafe;
  }
`;

export const VideoRailDivider = styled.span`
  width: 1px;
  height: 14px;
  background: rgba(148, 163, 184, 0.18);
  flex: none;
  margin: 0 3px;
`;

export const VideoRailTitle = styled.span`
  font-size: 11px;
  font-weight: 800;
  color: rgba(226, 232, 240, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 32cqw;
  flex: 0 1 auto;
`;

export const VideoRailSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 6px;
`;

export const VideoProgressTrack = styled.div`
  position: relative;
  height: 5px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.15);
  overflow: hidden;
`;

export const VideoProgressFill = styled.div`
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.75), rgba(52, 211, 153, 0.9));
  transition: width 0.25s ease;
`;

// Resizable split separators (react-resizable-panels).
export const VideoSplitSeparatorH = styled.div`
  width: 5px;
  flex: none;
  cursor: col-resize;
  background: transparent;
  position: relative;

  &::after {
    content: "";
    position: absolute;
    inset: 0 2px;
    border-radius: 2px;
  }

  &:hover::after,
  &[data-resize-handle-active]::after {
    background: rgba(16, 185, 129, 0.35);
  }
`;

export const VideoSplitSeparatorV = styled.div`
  height: 5px;
  flex: none;
  cursor: row-resize;
  background: transparent;
  position: relative;

  &::after {
    content: "";
    position: absolute;
    inset: 2px 0;
    border-radius: 2px;
  }

  &:hover::after,
  &[data-resize-handle-active]::after {
    background: rgba(16, 185, 129, 0.35);
  }
`;

// Narrow-pane overlay sheet (library/generate/export when there's no room
// for a split).
export const VideoSheet = styled.div`
  position: absolute;
  inset: 28px 0 0 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: rgba(3, 5, 8, 0.97);
  backdrop-filter: blur(6px);
`;

export const VideoSheetHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(167, 243, 208, 0.9);
`;

export const VideoSheetBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;

  & > * {
    flex: 1 1 auto;
    min-height: 0;
  }
`;
