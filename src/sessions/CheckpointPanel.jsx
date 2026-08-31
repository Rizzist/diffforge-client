import styled from "styled-components";

/* Presentational checkpoint timeline. Every read/mutation callback is owned
   by useCheckpoints; this component renders only daemon-derived model views
   and never predicts the result of undo, redo, or rollback. */

function turnGroups(checkpoints) {
  const groups = [];
  for (const checkpoint of checkpoints || []) {
    const previous = groups.at(-1);
    if (previous && previous.runId === checkpoint.runId) {
      previous.checkpoints.push(checkpoint);
    } else {
      groups.push({ runId: checkpoint.runId, checkpoints: [checkpoint] });
    }
  }
  return groups;
}

function CategoryValue({ label, value }) {
  if (value?.recognized) return <span>{value.raw}</span>;
  return (
    <UnrecognizedValue title={`This client does not recognize the published checkpoint ${label}.`}>
      {value?.raw ?? "not published"} (unrecognized {label})
    </UnrecognizedValue>
  );
}

function CheckpointRow({ checkpoint, busy, onRedo, onUndo }) {
  const actionable = checkpoint.checkpointId != null && !busy;
  return (
    <CheckpointCard data-seq={checkpoint.seq ?? undefined}>
      <CheckpointCardHeader>
        <CheckpointSeq>seq {checkpoint.seq ?? "not published"}</CheckpointSeq>
        {checkpoint.workspaceRevision != null && (
          <WorkspaceRevision>
            workspace revision {checkpoint.workspaceRevision}
          </WorkspaceRevision>
        )}
      </CheckpointCardHeader>
      <CheckpointFacts>
        <dt>kind</dt>
        <dd><CategoryValue label="kind" value={checkpoint.kind} /></dd>
        <dt>origin</dt>
        <dd><CategoryValue label="origin" value={checkpoint.origin} /></dd>
        <dt>effect</dt>
        <dd>{checkpoint.effectId ?? "not published"}</dd>
        <dt>call</dt>
        <dd>{checkpoint.callId ?? "not published"}</dd>
      </CheckpointFacts>
      <PathGroup>
        <PathLabel>Touched paths</PathLabel>
        {checkpoint.touchedPaths.length === 0 ? (
          <PathMissing>Touched paths not published.</PathMissing>
        ) : (
          checkpoint.touchedPaths.map((path) => (
            <TouchedPath key={path} title={path}>{path}</TouchedPath>
          ))
        )}
      </PathGroup>
      <CheckpointActions>
        <ActionButton
          disabled={!actionable}
          onClick={() => onUndo?.(checkpoint.checkpointId)}
          title={checkpoint.checkpointId == null
            ? "Undo unavailable: checkpoint_id was not published."
            : "Undo through daemon checkpoint authority"}
          type="button"
        >
          Undo
        </ActionButton>
        <ActionButton
          disabled={!actionable}
          onClick={() => onRedo?.(checkpoint.checkpointId)}
          title={checkpoint.checkpointId == null
            ? "Redo unavailable: checkpoint_id was not published."
            : "Redo through daemon checkpoint authority"}
          type="button"
        >
          Redo
        </ActionButton>
      </CheckpointActions>
    </CheckpointCard>
  );
}

export default function CheckpointPanel({
  branchId = null,
  conflict = null,
  entry = undefined,
  error = "",
  loading = false,
  onLoadMore = null,
  onRedo = null,
  onRefresh = null,
  onRollbackTurn = null,
  onUndo = null,
  pending = null,
  receipt = null,
  unavailable = false,
}) {
  if (unavailable) {
    return (
      <CheckpointSection aria-label="Checkpoint timeline">
        <PanelHeader>
          <PanelTitle>Checkpoint timeline</PanelTitle>
        </PanelHeader>
        <MutedState>
          The checkpoint timeline is unavailable on this daemon.
        </MutedState>
      </CheckpointSection>
    );
  }

  const groups = turnGroups(entry?.checkpoints || []);
  const busy = pending != null;

  return (
    <CheckpointSection aria-label="Checkpoint timeline">
      <PanelHeader>
        <div>
          <PanelTitle>Checkpoint timeline</PanelTitle>
          <PanelSubtitle>
            Durable workspace edits, newest first
            {branchId == null ? " · branch not published" : ` · branch ${branchId}`}
          </PanelSubtitle>
        </div>
        <HeaderButton
          disabled={loading || busy}
          onClick={() => onRefresh?.()}
          type="button"
        >
          {loading ? "Reading…" : "Refresh"}
        </HeaderButton>
      </PanelHeader>

      {conflict && (
        <ConflictNotice role="alert">
          <strong>Checkpoint conflict — the workspace moved underneath this checkpoint.</strong>
          <ConflictFacts>
            <span>Path</span><code>{conflict.path ?? "not published"}</code>
            <span>Expected digest</span><code>{conflict.expectedDigest ?? "not published"}</code>
            <span>Current digest</span><code>{conflict.currentDigest ?? "not published"}</code>
          </ConflictFacts>
          <HeaderButton onClick={() => onRefresh?.()} type="button">
            Re-read / refresh
          </HeaderButton>
        </ConflictNotice>
      )}

      {error && <ErrorNotice role="alert">Checkpoint action failed: {error}</ErrorNotice>}

      {receipt && (
        <ReceiptNotice role="status">
          Daemon receipt confirmed checkpoint {receipt.checkpoint?.checkpointId ?? "not published"}.
          {receipt.restoredCheckpointIds == null
            ? " Restored checkpoint IDs not published."
            : receipt.restoredCheckpointIds.length === 0
              ? " Restored checkpoint IDs: none."
              : ` Restored checkpoint IDs: ${receipt.restoredCheckpointIds.join(", ")}.`}
          {receipt.workerGeneration != null
            ? ` Worker generation: ${receipt.workerGeneration}.`
            : " Worker generation not published."}
        </ReceiptNotice>
      )}

      {entry == null && !error && (
        <MutedState>
          {loading ? "Reading the checkpoint timeline…" : "Checkpoint timeline not read yet."}
        </MutedState>
      )}

      {entry?.empty && (
        <MutedState>No checkpoints yet.</MutedState>
      )}

      {groups.map((group, groupIndex) => (
        <TurnGroup key={`${group.runId ?? "unpublished"}:${groupIndex}`}>
          <TurnHeader>
            <div>
              <TurnLabel>Run / turn</TurnLabel>
              <TurnId>{group.runId ?? "not published"}</TurnId>
            </div>
            <RollbackButton
              disabled={busy || group.runId == null}
              onClick={() => onRollbackTurn?.(group.runId)}
              title={group.runId == null
                ? "Rollback unavailable: run_id was not published."
                : "Roll back every durable edit published for this run"}
              type="button"
            >
              {pending?.action === "rollback this turn"
                && pending.coordinate === group.runId
                ? "Rolling back…"
                : "Roll back this turn"}
            </RollbackButton>
          </TurnHeader>
          <TimelineList>
            {group.checkpoints.map((checkpoint, index) => (
              <CheckpointRow
                busy={busy}
                checkpoint={checkpoint}
                key={checkpoint.checkpointId || `${checkpoint.seq ?? "unpublished"}:${index}`}
                onRedo={onRedo}
                onUndo={onUndo}
              />
            ))}
          </TimelineList>
        </TurnGroup>
      ))}

      {entry && !entry.empty && entry.endOfList && (
        <EndOfList>No more checkpoints.</EndOfList>
      )}
      {entry?.cursorState === "invalid" && (
        <ErrorNotice role="alert">
          The next checkpoint cursor was not published as a decimal string; pagination stopped.
        </ErrorNotice>
      )}
      {entry?.cursorState === "more" && (
        <LoadMoreButton
          disabled={loading || busy}
          onClick={() => onLoadMore?.()}
          type="button"
        >
          {loading ? "Loading…" : "Load more"}
        </LoadMoreButton>
      )}
    </CheckpointSection>
  );
}

const CheckpointSection = styled.section`
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 10px;
  padding: 12px 14px 18px;
  overflow-y: auto;
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

const PanelTitle = styled.div`
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 700;
`;

const PanelSubtitle = styled.div`
  margin-top: 2px;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const HeaderButton = styled.button`
  padding: 4px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 7px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10px;
  cursor: pointer;

  &:disabled { opacity: 0.55; cursor: default; }
`;

const MutedState = styled.div`
  padding: 16px 10px;
  color: var(--forge-text-muted);
  font-size: 11px;
  text-align: center;
`;

const ErrorNotice = styled.div`
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 46%, transparent);
  border-radius: 7px;
  color: var(--forge-red);
  font-size: 10px;
  line-height: 1.4;
`;

const ConflictNotice = styled(ErrorNotice)`
  display: grid;
  justify-items: start;
  gap: 7px;
`;

const ConflictFacts = styled.div`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 3px 8px;
  width: 100%;
  color: var(--forge-text-muted);

  code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--forge-text-soft);
    font-family: var(--forge-mono, monospace);
  }
`;

const ReceiptNotice = styled.div`
  padding: 7px 9px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.45);
  border-radius: 7px;
  color: var(--forge-text-soft);
  background: rgba(var(--forge-tint-rgb), 0.08);
  font-size: 10px;
  line-height: 1.4;
`;

const TurnGroup = styled.section`
  display: grid;
  gap: 6px;
`;

const TurnHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--forge-border);
`;

const TurnLabel = styled.div`
  color: var(--forge-text-muted);
  font-size: 8.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const TurnId = styled.code`
  color: var(--forge-text-soft);
  font-size: 10px;
  font-family: var(--forge-mono, monospace);
`;

const RollbackButton = styled(HeaderButton)`
  color: var(--forge-amber);
`;

const TimelineList = styled.div`
  display: grid;
  gap: 6px;
  padding-left: 9px;
  border-left: 1px solid var(--forge-border-strong);
`;

const CheckpointCard = styled.article`
  display: grid;
  gap: 6px;
  padding: 8px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: var(--forge-surface-control);
`;

const CheckpointCardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const CheckpointSeq = styled.code`
  color: var(--forge-text);
  font-size: 10px;
  font-weight: 700;
  font-family: var(--forge-mono, monospace);
`;

const WorkspaceRevision = styled.code`
  color: var(--forge-text-muted);
  font-size: 8.5px;
  font-family: var(--forge-mono, monospace);
`;

const CheckpointFacts = styled.dl`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 7px;
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 9.5px;

  dt { font-weight: 650; }
  dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--forge-text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--forge-mono, monospace);
  }
`;

const UnrecognizedValue = styled.span`
  color: var(--forge-amber);
`;

const PathGroup = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
`;

const PathLabel = styled.span`
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 650;
`;

const TouchedPath = styled.code`
  max-width: 100%;
  padding: 1px 5px;
  overflow: hidden;
  border: 1px solid var(--forge-border);
  border-radius: 5px;
  color: var(--forge-text-soft);
  font-size: 9px;
  font-family: var(--forge-mono, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PathMissing = styled.span`
  color: var(--forge-text-muted);
  font-size: 9px;
`;

const CheckpointActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 5px;
`;

const ActionButton = styled(HeaderButton)`
  min-width: 52px;
`;

const EndOfList = styled.div`
  color: var(--forge-text-muted);
  font-size: 9.5px;
  text-align: center;
`;

const LoadMoreButton = styled(HeaderButton)`
  justify-self: center;
  min-width: 100px;
`;
