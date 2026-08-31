import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { outputBufferView } from "./shellModel.js";

/* Presentational unified shell-registry surface. All reads, mutations, and
   pushed subscriptions live in useShells.js. Output is rendered only as
   plain React text from the bounded connection-transient buffer. */

function categoryLabel(category) {
  if (category?.recognized) return category.raw;
  if (category?.raw != null) return `${category.raw} (unrecognized)`;
  return "not published";
}

function publishedText(value) {
  return value == null ? "not published" : String(value);
}

function CloseReceipt({ outcome }) {
  if (!outcome) return null;
  const shellId = outcome.shell?.id ?? "shell id not published";
  if (outcome.alreadyClosed) {
    return (
      <OutcomeNotice data-kind="normal">
        Close receipt: {shellId} was already closed (normal outcome).
      </OutcomeNotice>
    );
  }
  if (outcome.shell?.state.raw === "closed") {
    return (
      <OutcomeNotice data-kind="normal">
        Close receipt: {shellId} is closed.
      </OutcomeNotice>
    );
  }
  return (
    <OutcomeNotice data-kind="published">
      Close receipt: daemon published state {categoryLabel(outcome.shell?.state)}.
    </OutcomeNotice>
  );
}

export default function ShellsPanel({
  shells = null,
  outputByShell = {},
  closeOutcomeByShell = {},
  execReceipt = null,
  closingByShell = {},
  error = "",
  loading = false,
  executing = false,
  unavailable = false,
  onRefresh = null,
  onClose = null,
  onExec = null,
}) {
  const [selectedShellId, setSelectedShellId] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [localError, setLocalError] = useState("");

  const identifiedShells = useMemo(() => (
    Array.isArray(shells) ? shells.filter((row) => row.id != null) : []
  ), [shells]);

  useEffect(() => {
    if (selectedShellId
      && identifiedShells.some((row) => row.id === selectedShellId)) return;
    setSelectedShellId(identifiedShells[0]?.id ?? "");
  }, [identifiedShells, selectedShellId]);

  const commitExec = useCallback(async () => {
    if (executing) return;
    if (!command.trim()) {
      setLocalError("Enter a command to run.");
      return;
    }
    setLocalError("");
    const receipt = cwd.trim() === ""
      ? await onExec?.(command)
      : await onExec?.(command, cwd.trim());
    if (receipt) setCommand("");
  }, [command, cwd, executing, onExec]);

  if (unavailable) {
    return (
      <ShellsSection aria-label="Shells">
        <PanelTitle>Shells</PanelTitle>
        <MutedState>
          Shell registry and direct command execution are unavailable on this daemon.
        </MutedState>
      </ShellsSection>
    );
  }

  const output = selectedShellId
    ? (outputByShell[selectedShellId] ?? outputBufferView([]))
    : outputBufferView([]);

  return (
    <ShellsSection aria-label="Shells">
      <PanelHeader>
        <div>
          <PanelTitle>Shells</PanelTitle>
          <PanelSubtitle>
            Live local and SSH shells published for this session.
          </PanelSubtitle>
        </div>
        <HeaderButton disabled={loading} onClick={() => onRefresh?.()} type="button">
          {loading ? "Reading…" : "Refresh"}
        </HeaderButton>
      </PanelHeader>

      {error && <ErrorNotice role="alert">{error}</ErrorNotice>}

      <PanelGrid>
        <PanelCard>
          <GroupTitle>Shell registry</GroupTitle>
          {shells == null && (
            <MutedState>Shell registry not read yet.</MutedState>
          )}
          {Array.isArray(shells) && shells.length === 0 && (
            <MutedState>No shells are currently published for this session.</MutedState>
          )}
          {Array.isArray(shells) && shells.length > 0 && (
            <ShellList>
              {shells.map((row, index) => (
                <ShellRow key={row.id ?? `unidentified-shell:${index}`}>
                  <ShellRowHeader>
                    <ShellIdentity>
                      <strong>{row.id ?? "shell id not published"}</strong>
                      {row.title != null && <span>title: {row.title}</span>}
                      {row.profile != null && <span>profile: {row.profile}</span>}
                    </ShellIdentity>
                    <CloseButton
                      disabled={row.id == null || closingByShell[row.id] === true}
                      onClick={() => onClose?.(row.id)}
                      type="button"
                    >
                      {closingByShell[row.id] === true ? "Closing…" : "Close"}
                    </CloseButton>
                  </ShellRowHeader>
                  <BadgeRow>
                    <ValueBadge data-recognized={row.kind.recognized ? "true" : "false"}>
                      kind: {categoryLabel(row.kind)}
                    </ValueBadge>
                    <ValueBadge data-recognized={row.scope.recognized ? "true" : "false"}>
                      scope: {categoryLabel(row.scope)}
                    </ValueBadge>
                    <ValueBadge
                      data-recognized={row.state.recognized ? "true" : "false"}
                      data-state={row.state.raw ?? "absent"}
                    >
                      state: {categoryLabel(row.state)}
                    </ValueBadge>
                  </BadgeRow>
                  <ShellFacts>
                    <span>cwd: {publishedText(row.cwd)}</span>
                    {row.cwdOrHost != null && <span>cwd / host: {row.cwdOrHost}</span>}
                    {row.sessionId != null && <span>session: {row.sessionId}</span>}
                    {row.branchId != null && <span>branch: {row.branchId}</span>}
                    {row.exitCode != null && <span>exit code: {row.exitCode}</span>}
                    {row.createdAtMs != null && <span>created_at_ms: {row.createdAtMs}</span>}
                    {row.lastActivityMs != null && (
                      <span>last_activity_ms: {row.lastActivityMs}</span>
                    )}
                    {row.bytesOut != null && <span>bytes_out: {row.bytesOut}</span>}
                  </ShellFacts>
                  <CloseReceipt outcome={row.id == null ? null : closeOutcomeByShell[row.id]} />
                </ShellRow>
              ))}
            </ShellList>
          )}
        </PanelCard>

        <PanelCard>
          <GroupTitle>Run a command</GroupTitle>
          <Field>
            <label htmlFor="shell-command">Command</label>
            <CommandInput
              id="shell-command"
              onChange={(event) => setCommand(event.target.value)}
              placeholder="Enter a direct user command"
              value={command}
            />
          </Field>
          <Field>
            <label htmlFor="shell-cwd">Working directory (optional)</label>
            <TextInput
              id="shell-cwd"
              onChange={(event) => setCwd(event.target.value)}
              placeholder="Omitted when blank"
              value={cwd}
            />
          </Field>
          {localError && <LocalNotice>{localError}</LocalNotice>}
          <ActionRow>
            <RunButton disabled={executing} onClick={commitExec} type="button">
              {executing ? "Running…" : "Run command"}
            </RunButton>
          </ActionRow>
          {execReceipt != null && (
            <ExecReceipt>
              <strong>Daemon receipt</strong>
              <span>session: {publishedText(execReceipt.sessionId)}</span>
              <span>item: {publishedText(execReceipt.itemId)}</span>
              <span>accepted seq: {publishedText(execReceipt.acceptedSeq)}</span>
              {execReceipt.workerGeneration != null && (
                <span>worker generation: {execReceipt.workerGeneration}</span>
              )}
              <span>run id: {execReceipt.runIdLabel}</span>
            </ExecReceipt>
          )}
        </PanelCard>
      </PanelGrid>

      <OutputCard>
        <OutputHeader>
          <div>
            <GroupTitle>Live output</GroupTitle>
            <TransientNotice>
              Live output is connection-transient. Buffered output starts when this subscription began; output before this point was not captured.
            </TransientNotice>
          </div>
          <OutputSelect
            aria-label="Shell output source"
            disabled={identifiedShells.length === 0}
            onChange={(event) => setSelectedShellId(event.target.value)}
            value={selectedShellId}
          >
            {identifiedShells.length === 0 && <option value="">No shell selected</option>}
            {identifiedShells.map((row) => (
              <option key={row.id} value={row.id}>{row.id}</option>
            ))}
          </OutputSelect>
        </OutputHeader>
        {output.bufferDiscarded && (
          <BufferNotice>
            Earlier output captured by this subscription was discarded to keep the live buffer bounded.
          </BufferNotice>
        )}
        {!selectedShellId && <MutedState>No shell is available to select.</MutedState>}
        {selectedShellId && output.entries.length === 0 && (
          <MutedState>No output has been captured for this shell since the subscription began.</MutedState>
        )}
        {selectedShellId && output.entries.length > 0 && (
          <OutputLog aria-live="polite">
            {output.entries.map((entry, index) => (
              <OutputLine key={`${selectedShellId}:output:${index}`}>
                <StreamBadge data-recognized={entry.stream.recognized ? "true" : "false"}>
                  {categoryLabel(entry.stream)}
                </StreamBadge>
                <OutputText>
                  {entry.text == null
                    ? "(published output chunk could not be decoded)"
                    : entry.text}
                </OutputText>
              </OutputLine>
            ))}
          </OutputLog>
        )}
      </OutputCard>
    </ShellsSection>
  );
}

const ShellsSection = styled.section`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: auto;
  color: var(--forge-text);
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const PanelTitle = styled.h2`
  margin: 0;
  color: var(--forge-text);
  font-size: 15px;
  font-weight: 760;
`;

const PanelSubtitle = styled.div`
  margin-top: 2px;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const HeaderButton = styled.button`
  padding: 5px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 9.5px;
  cursor: pointer;

  &:disabled { cursor: default; opacity: 0.55; }
`;

const PanelGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(260px, 1.1fr) minmax(250px, 0.9fr);
  gap: 10px;

  @media (max-width: 820px) { grid-template-columns: 1fr; }
`;

const PanelCard = styled.section`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-surface-raised);
`;

const OutputCard = styled(PanelCard)`
  flex: none;
`;

const GroupTitle = styled.h3`
  margin: 0;
  color: var(--forge-text);
  font-size: 10.5px;
  font-weight: 730;
  letter-spacing: 0.02em;
`;

const MutedState = styled.div`
  padding: 8px 0;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const ErrorNotice = styled.div`
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 42%, transparent);
  border-radius: 7px;
  color: var(--forge-red);
  background: color-mix(in srgb, var(--forge-red) 8%, transparent);
  font-size: 9.5px;
`;

const ShellList = styled.div`
  display: grid;
  gap: 6px;
`;

const ShellRow = styled.article`
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  background: var(--forge-surface-control);
`;

const ShellRowHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

const ShellIdentity = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong {
    overflow: hidden;
    color: var(--forge-text);
    font: 600 10px var(--forge-mono, monospace);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span { color: var(--forge-text-muted); font-size: 8.5px; }
`;

const CloseButton = styled(HeaderButton)`
  flex: none;
  color: var(--forge-red);
`;

const BadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const ValueBadge = styled.span`
  padding: 2px 5px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  font-size: 8.5px;

  &[data-recognized="false"] { color: var(--forge-amber); }
  &[data-state="closed"], &[data-state="exited"] { color: var(--forge-text-muted); }
`;

const ShellFacts = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 8px;
  color: var(--forge-text-muted);
  font-size: 8.5px;

  span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const OutcomeNotice = styled.div`
  color: var(--forge-text-muted);
  font-size: 8.5px;

  &[data-kind="normal"] { color: var(--forge-green); }
`;

const Field = styled.div`
  display: grid;
  gap: 3px;

  label {
    color: var(--forge-text-muted);
    font-size: 8.5px;
    font-weight: 650;
    text-transform: uppercase;
  }
`;

const fieldControl = `
  width: 100%;
  box-sizing: border-box;
  padding: 6px 7px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  outline: none;
  color: var(--forge-text);
  background: var(--forge-surface-control);
  font: inherit;
  font-size: 10px;
`;

const TextInput = styled.input`${fieldControl}`;
const CommandInput = styled.textarea`
  ${fieldControl}
  min-height: 68px;
  resize: vertical;
  font-family: var(--forge-mono, monospace);
`;

const LocalNotice = styled.div`
  color: var(--forge-amber);
  font-size: 9px;
`;

const ActionRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const RunButton = styled(HeaderButton)`
  color: var(--forge-text);
  font-weight: 680;
`;

const ExecReceipt = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 9px;
  padding: 7px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  color: var(--forge-text-muted);
  background: var(--forge-surface-control);
  font-size: 9px;

  strong { color: var(--forge-text-soft); }
`;

const OutputHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const TransientNotice = styled.div`
  max-width: 680px;
  margin-top: 3px;
  color: var(--forge-amber);
  font-size: 8.5px;
  line-height: 1.4;
`;

const BufferNotice = styled.div`
  color: var(--forge-text-muted);
  font-size: 8.5px;
`;

const OutputSelect = styled.select`
  ${fieldControl}
  width: auto;
  min-width: 180px;
`;

const OutputLog = styled.div`
  display: grid;
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  background: var(--forge-surface-control);
`;

const OutputLine = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  padding: 5px 7px;
  border-bottom: 1px solid var(--forge-border);

  &:last-child { border-bottom: 0; }
`;

const StreamBadge = styled.span`
  color: var(--forge-text-muted);
  font: 650 8px var(--forge-mono, monospace);

  &[data-recognized="false"] { color: var(--forge-amber); }
`;

const OutputText = styled.pre`
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--forge-text);
  font: 9.5px/1.45 var(--forge-mono, monospace);
  white-space: pre-wrap;
`;
