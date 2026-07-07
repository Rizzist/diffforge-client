import styled from "styled-components";

// SSH client UI styling. Built on the shared --forge-* design tokens so both
// the Settings panel and the terminal picker inherit light/dark theming.

export const SshFieldGrid = styled.div`
  display: grid;
  gap: 12px;
`;

export const SshFieldRow = styled.div`
  display: grid;
  grid-template-columns: ${(props) => props.$columns || "1fr"};
  gap: 12px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

export const SshField = styled.label`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

export const SshFieldLabel = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--forge-text-soft);
  font-size: 11.5px;
  font-weight: 720;
  letter-spacing: 0.01em;
`;

export const SshFieldHint = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
`;

export const SshInput = styled.input`
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(13, 17, 23, 0.92);
  font: inherit;
  font-size: 13px;

  &:focus {
    border-color: rgba(125, 160, 205, 0.44);
    outline: none;
    box-shadow: 0 0 0 3px rgba(125, 160, 205, 0.12);
  }

  &::placeholder {
    color: var(--forge-text-muted);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.72;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.13);
    color: #1d1d1f;
    background: #ffffff;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.045),
      inset 0 1px 0 rgba(255, 255, 255, 0.98);
    color-scheme: light;
  }
`;

export const SshInputWithButton = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
`;

export const SshAuthSegment = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

export const SshAuthOption = styled.button`
  display: grid;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: rgba(21, 27, 35, 0.55);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease;

  strong {
    font-size: 12px;
    font-weight: 760;
  }

  small {
    color: var(--forge-text-muted);
    font-size: 10.5px;
    line-height: 1.35;
  }

  &:hover:not(:disabled) {
    border-color: rgba(125, 160, 205, 0.34);
    background: var(--forge-surface-hover);
  }

  &[data-selected="true"] {
    border-color: rgba(98, 160, 255, 0.5);
    background: rgba(98, 160, 255, 0.12);
    color: var(--forge-text);
  }

  &[data-selected="true"] small {
    color: var(--forge-text-soft);
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    border-color: rgba(0, 102, 204, 0.4);
    background: rgba(0, 102, 204, 0.08);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

export const SshFormActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`;

export const SshInlineButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: rgba(21, 27, 35, 0.72);
  font-size: 12px;
  font-weight: 680;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease;

  &:hover:not(:disabled) {
    border-color: rgba(125, 160, 205, 0.34);
    background: var(--forge-surface-hover);
    color: var(--forge-text);
  }

  &[data-variant="primary"] {
    border-color: rgba(98, 160, 255, 0.4);
    color: #fff;
    background: var(--forge-blue);
  }

  &[data-variant="primary"]:hover:not(:disabled) {
    background: var(--forge-blue-soft);
  }

  &[data-variant="danger"]:hover:not(:disabled) {
    border-color: rgba(255, 122, 122, 0.4);
    color: #ff8f8f;
    background: rgba(255, 90, 90, 0.1);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
    color: var(--forge-text-soft);
  }

  html[data-forge-theme="light"] &[data-variant="primary"] {
    color: #fff;
    background: var(--forge-blue);
  }
`;

export const SshMessage = styled.p`
  margin: 0;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.4;

  &[data-tone="error"] {
    border-color: rgba(255, 122, 122, 0.32);
    color: #ff9c9c;
    background: rgba(255, 90, 90, 0.08);
  }

  &[data-tone="success"] {
    border-color: rgba(88, 214, 158, 0.32);
    color: #6fe0ad;
    background: rgba(56, 200, 140, 0.08);
  }

  &[data-tone="info"] {
    border-color: var(--forge-border);
    color: var(--forge-text-soft);
    background: rgba(125, 160, 205, 0.08);
  }
`;

// ---- Settings panel list ----

export const SshClientList = styled.div`
  display: grid;
  gap: 10px;
`;

export const SshClientRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: rgba(17, 22, 30, 0.6);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const SshClientIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  color: var(--forge-text-soft);
  background: rgba(98, 160, 255, 0.08);

  svg {
    width: 18px;
    height: 18px;
  }
`;

export const SshClientMain = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
`;

export const SshClientName = styled.p`
  margin: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const SshClientMeta = styled.p`
  margin: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;

export const SshClientTag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  font-size: 10px;
  font-weight: 680;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
`;

export const SshClientRowActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
`;

export const SshEmptyState = styled.div`
  display: grid;
  gap: 6px;
  padding: 22px 16px;
  border: 1px dashed var(--forge-border);
  border-radius: 10px;
  text-align: center;
  color: var(--forge-text-muted);

  strong {
    color: var(--forge-text-soft);
    font-size: 13px;
    font-weight: 720;
  }

  span {
    font-size: 11.5px;
    line-height: 1.4;
  }
`;

export const SshFormCard = styled.div`
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--forge-border);
  border-radius: 12px;
  background: rgba(13, 17, 23, 0.5);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface);
  }
`;

export const SshFormHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  strong {
    color: var(--forge-text);
    font-size: 13px;
    font-weight: 760;
  }
`;

// ---- Terminal picker dropdown ----

export const SshPickerMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 70;
  display: grid;
  gap: 8px;
  width: min(320px, calc(100vw - 24px));
  max-height: min(70vh, 520px);
  overflow-y: auto;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.012)),
    rgb(7, 9, 13);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.46);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: var(--forge-surface);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.14);
  }

  &[data-align="left"] {
    right: auto;
    left: 0;
  }
`;

export const SshPickerHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  color: var(--forge-text-soft);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.02em;
  text-transform: uppercase;
`;

export const SshPickerOption = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  color: var(--forge-text-soft);
  background: rgba(21, 27, 35, 0.5);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(98, 160, 255, 0.34);
    background: rgba(98, 160, 255, 0.1);
    color: var(--forge-text);
    outline: none;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;

export const SshPickerOptionIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: rgba(98, 160, 255, 0.1);

  svg {
    width: 16px;
    height: 16px;
  }
`;

export const SshPickerOptionMain = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;

  strong {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    overflow: hidden;
    color: var(--forge-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
`;

export const SshPickerDivider = styled.div`
  height: 1px;
  margin: 2px 0;
  background: var(--forge-border);
`;

export const SshPickerAddButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: 1px dashed var(--forge-border);
  border-radius: 9px;
  color: var(--forge-text-soft);
  background: transparent;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(98, 160, 255, 0.4);
    background: rgba(98, 160, 255, 0.08);
    color: var(--forge-text);
  }

  strong {
    font-size: 12.5px;
    font-weight: 720;
  }
`;

export const SshPickerFloating = styled.div`
  position: relative;
  display: inline-flex;
`;
