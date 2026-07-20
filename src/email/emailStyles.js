import styled from "styled-components";

// Email Delivery settings styling. Mirrors the SSH suite: shared --forge-*
// design tokens so light/dark theming is inherited everywhere.

export const EmailFieldGrid = styled.div`
  display: grid;
  gap: 12px;
`;

export const EmailFieldRow = styled.div`
  display: grid;
  grid-template-columns: ${(props) => props.$columns || "1fr"};
  gap: 12px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

export const EmailField = styled.label`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

export const EmailFieldLabel = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--forge-text-soft);
  font-size: 11.5px;
  font-weight: 720;
  letter-spacing: 0.01em;
`;

export const EmailFieldHint = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
`;

export const EmailInput = styled.input`
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

export const EmailModeSegment = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

export const EmailModeOption = styled.button`
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

export const EmailFormActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`;

export const EmailInlineButton = styled.button`
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

export const EmailMessage = styled.p`
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

// ---- Profile list ----

export const EmailProfileList = styled.div`
  display: grid;
  gap: 8px;
`;

export const EmailProfileRow = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: rgba(21, 27, 35, 0.55);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;

export const EmailProfileIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: rgba(13, 17, 23, 0.6);

  svg {
    width: 15px;
    height: 15px;
  }

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.04);
  }
`;

export const EmailProfileMain = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`;

export const EmailProfileName = styled.p`
  margin: 0;
  color: var(--forge-text);
  font-size: 12.5px;
  font-weight: 720;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const EmailProfileMeta = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const EmailProfileTag = styled.span`
  padding: 3px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  font-size: 10.5px;
  font-weight: 700;
  white-space: nowrap;

  &[data-tone="warn"] {
    border-color: rgba(255, 190, 110, 0.4);
    color: #ffc98a;
  }
`;

export const EmailProfileRowActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

export const EmailEmptyState = styled.div`
  display: grid;
  gap: 4px;
  padding: 18px 16px;
  border: 1px dashed var(--forge-border);
  border-radius: 10px;
  text-align: center;

  strong {
    color: var(--forge-text-soft);
    font-size: 12.5px;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 11.5px;
  }
`;

export const EmailFormCard = styled.div`
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--forge-border);
  border-radius: 12px;
  background: rgba(13, 17, 23, 0.5);

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.025);
  }
`;

export const EmailFormHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  strong {
    color: var(--forge-text);
    font-size: 12.5px;
    font-weight: 740;
  }
`;

// ---- Native delivery / preflight checklist ----

export const EmailPreflightList = styled.ul`
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

export const EmailPreflightItem = styled.li`
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(21, 27, 35, 0.45);

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;

export const EmailPreflightStatusDot = styled.span`
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border-radius: 999px;
  background: var(--forge-text-muted);

  &[data-status="pass"] {
    background: #4fce8d;
  }
  &[data-status="fail"] {
    background: #ff7a7a;
  }
  &[data-status="warn"] {
    background: #ffbe6e;
  }
  &[data-status="pending"] {
    background: #7da0cd;
  }
  &[data-status="unavailable"] {
    background: var(--forge-text-muted);
    opacity: 0.6;
  }
`;

export const EmailPreflightMain = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    color: var(--forge-text);
    font-size: 11.5px;
    font-weight: 700;
  }

  span {
    color: var(--forge-text-muted);
    font-size: 10.5px;
    line-height: 1.35;
  }

  em {
    color: #ffc98a;
    font-size: 10.5px;
    font-style: normal;
    line-height: 1.35;
  }
`;

export const EmailPreflightBadge = styled.span`
  padding: 2px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  font-size: 10px;
  font-weight: 740;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;

  &[data-status="pass"] {
    border-color: rgba(88, 214, 158, 0.4);
    color: #6fe0ad;
  }
  &[data-status="fail"] {
    border-color: rgba(255, 122, 122, 0.4);
    color: #ff9c9c;
  }
  &[data-status="warn"] {
    border-color: rgba(255, 190, 110, 0.4);
    color: #ffc98a;
  }
`;

export const EmailCapabilityStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(21, 27, 35, 0.45);
  color: var(--forge-text-muted);
  font-size: 11px;

  strong {
    color: var(--forge-text-soft);
    font-weight: 720;
  }

  html[data-forge-theme="light"] & {
    background: var(--forge-surface-control);
  }
`;
