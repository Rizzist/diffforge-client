import { useCallback, useState } from "react";
import styled from "styled-components";

import { SettingsNavGroupLabel, ButtonAddIcon } from "../app/appStyles.js";
import { isMainSessionEligible } from "./workflowModel.js";

/* Rail Workflows section (P1′ convergence graphs). Everything is inline —
   the register editor expands in place (no modals). Honesty rules render
   here:
   - a catalog whose field the daemon did not publish is "unavailable" —
     NEVER rendered as an empty list of zero workflows;
   - the main-session filter keys ONLY off the published
     main_session_eligible boolean (isMainSessionEligible) — never off id
     prefix, origin, or template shape;
   - the instance panel keeps the two digests distinct: the user-source
     digest and the template digest (the fence) are separate labeled facts;
   - instance "missing" renders "does not exist" — no substituted row;
   - a failed Register surfaces the daemon's compile error list VERBATIM;
   - a revision conflict shows expected vs current and asks the user to
     RE-READ the instance — there is no auto-retry button and no path that
     resubmits with the current digest. */

export default function WorkflowRailSection({
  catalog = { kind: "unread", entries: [] },
  workflows = [],
  instanceById = {},
  statusBySession = {},
  activeSessionId = "",
  listError = "",
  unavailable = false,
  onReadInstance = null,
  onRegisterWorkflow = null,
  onPin = null,
  onSwitch = null,
  onAbandon = null,
}) {
  const [registering, setRegistering] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [registerErrors, setRegisterErrors] = useState([]);
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [abandonWhy, setAbandonWhy] = useState("");
  /* Last pin/switch revision conflict, held for display until re-read. */
  const [conflict, setConflict] = useState(null);

  const commitRegister = useCallback(async () => {
    const source = sourceDraft.trim();
    if (!source) return;
    const result = await onRegisterWorkflow?.(source);
    if (result?.ok) {
      setRegistering(false);
      setSourceDraft("");
      setRegisterErrors([]);
      return;
    }
    /* The daemon's compile error list, verbatim — never swallowed. */
    setRegisterErrors(result?.errors ?? []);
  }, [onRegisterWorkflow, sourceDraft]);

  const commitPin = useCallback(async (templateId) => {
    if (!activeSessionId) return;
    setConflict(null);
    const result = await onPin?.(activeSessionId, templateId);
    if (result?.conflict) setConflict(result.conflict);
  }, [activeSessionId, onPin]);

  const commitSwitch = useCallback(async (oldGraphId, templateId) => {
    if (!activeSessionId || !oldGraphId) return;
    setConflict(null);
    const result = await onSwitch?.(activeSessionId, oldGraphId, templateId);
    if (result?.conflict) setConflict(result.conflict);
  }, [activeSessionId, onSwitch]);

  const commitAbandon = useCallback(() => {
    if (!activeSessionId) return;
    setConflict(null);
    onAbandon?.(activeSessionId, abandonWhy.trim());
    setAbandonWhy("");
  }, [abandonWhy, activeSessionId, onAbandon]);

  if (unavailable) {
    return (
      <WorkflowSection aria-label="Workflows">
        <WorkflowHeader>
          <SettingsNavGroupLabel>Workflows</SettingsNavGroupLabel>
        </WorkflowHeader>
        <WorkflowMutedHint>Workflows are unavailable on this daemon.</WorkflowMutedHint>
      </WorkflowSection>
    );
  }

  const entries = catalog.kind === "available" ? catalog.entries : [];
  const visibleEntries = eligibleOnly
    ? entries.filter((entry) => isMainSessionEligible(entry))
    : entries;
  const sessionStatus = activeSessionId ? statusBySession[activeSessionId] : undefined;
  const activeGraphId = sessionStatus?.kind === "active" ? sessionStatus.graphId : "";

  return (
    <WorkflowSection aria-label="Workflows">
      <WorkflowHeader>
        <SettingsNavGroupLabel>Workflows</SettingsNavGroupLabel>
        <WorkflowHeaderAction
          aria-label="Register workflow"
          onClick={() => setRegistering((current) => !current)}
          title="Register a workflow from pipe source"
          type="button"
        >
          <ButtonAddIcon aria-hidden="true" />
        </WorkflowHeaderAction>
      </WorkflowHeader>

      {registering && (
        <WorkflowRegisterEditor>
          <WorkflowSourceInput
            aria-label="Workflow pipe source"
            onChange={(event) => setSourceDraft(event.target.value)}
            placeholder="pipe source"
            rows={4}
            value={sourceDraft}
          />
          <WorkflowRegisterDisclosure>
            Registering sends this pipe source to the daemon to compile.
          </WorkflowRegisterDisclosure>
          {/* Compile failure: the daemon's error list, VERBATIM, one line
              per error — never swallowed, never a pretended success. */}
          {registerErrors.length > 0 && (
            <WorkflowCompileErrors role="alert">
              {registerErrors.map((line, index) => (
                <li key={`${index}:${line}`}>{line}</li>
              ))}
            </WorkflowCompileErrors>
          )}
          <WorkflowRegisterActions>
            <WorkflowPrimaryButton onClick={() => void commitRegister()} type="button">
              Register
            </WorkflowPrimaryButton>
            <WorkflowCancelButton
              onClick={() => {
                setRegistering(false);
                setSourceDraft("");
                setRegisterErrors([]);
              }}
              type="button"
            >
              Cancel
            </WorkflowCancelButton>
          </WorkflowRegisterActions>
        </WorkflowRegisterEditor>
      )}

      {catalog.kind === "available" && entries.length > 0 && (
        <WorkflowFilterRow>
          <label>
            <input
              checked={eligibleOnly}
              onChange={(event) => setEligibleOnly(event.target.checked)}
              type="checkbox"
            />
            {/* The filter keys ONLY off the published boolean. */}
            <span>Main-session eligible only</span>
          </label>
        </WorkflowFilterRow>
      )}

      {/* Catalog tri-state. A missing workflow_catalog field is the catalog
          FEATURE being unavailable — never rendered as "0 workflows". */}
      {catalog.kind === "unread" && (
        <WorkflowMutedHint>Workflow catalog not read yet.</WorkflowMutedHint>
      )}
      {catalog.kind === "unavailable" && (
        <WorkflowMutedHint>
          Workflow catalog unavailable on this daemon.
        </WorkflowMutedHint>
      )}
      {catalog.kind === "available" && entries.length === 0 && (
        <WorkflowMutedHint>No workflows in the catalog.</WorkflowMutedHint>
      )}
      {catalog.kind === "available" && entries.length > 0 && visibleEntries.length === 0 && (
        <WorkflowMutedHint>No main-session-eligible workflows.</WorkflowMutedHint>
      )}

      {visibleEntries.map((entry, index) => {
        if (entry.kind === "unknown") {
          /* Unknown origin: preserved raw, but NOTHING of the v1 shape is
             claimed — no id, no eligibility, no template. */
          return (
            <WorkflowUnknownRow key={`unknown:${index}`}>
              unrecognized catalog entry
              {entry.originRaw ? ` (origin: ${entry.originRaw})` : " (no origin)"}
            </WorkflowUnknownRow>
          );
        }
        const expanded = selectedId === entry.id;
        const instanceView = instanceById[entry.id];
        return (
          <WorkflowEntryBlock key={`${entry.kind}:${entry.id}`}>
            <WorkflowEntryRow
              aria-expanded={expanded}
              onClick={() => {
                setConflict(null);
                setSelectedId((current) => (current === entry.id ? "" : entry.id));
              }}
              title={`${entry.id} (${entry.kind === "built_in" ? "built-in" : "user"})`}
              type="button"
            >
              <WorkflowOriginBadge data-origin={entry.kind}>
                {entry.kind === "built_in" ? "built-in" : "user"}
              </WorkflowOriginBadge>
              <WorkflowEntryId>{entry.id}</WorkflowEntryId>
              {/* Eligibility marker: the published boolean, nothing else. */}
              {isMainSessionEligible(entry) && (
                <WorkflowEligibleBadge title="Published as main_session_eligible">
                  main
                </WorkflowEligibleBadge>
              )}
            </WorkflowEntryRow>

            {expanded && (
              <WorkflowEntryDisclosure>
                <WorkflowDetailActions>
                  <WorkflowSecondaryButton
                    onClick={() => onReadInstance?.(entry.id)}
                    title="Read the workflow instance from the daemon"
                    type="button"
                  >
                    Read instance
                  </WorkflowSecondaryButton>
                </WorkflowDetailActions>

                {instanceView == null && (
                  <WorkflowMutedHint>Instance not read yet.</WorkflowMutedHint>
                )}
                {instanceView?.kind === "missing" && (
                  /* instance: null preserved — "does not exist", never a
                     fabricated current/built-in row. */
                  <WorkflowMutedHint>
                    This workflow instance does not exist.
                  </WorkflowMutedHint>
                )}
                {instanceView?.kind === "instance" && (
                  <WorkflowInstancePanel>
                    {instanceView.revision != null && (
                      <WorkflowFactRow>
                        <b>revision</b>
                        <span>{instanceView.revision}</span>
                      </WorkflowFactRow>
                    )}
                    {/* TWO digests, two labeled facts — never one. */}
                    <WorkflowFactRow>
                      <b>source digest</b>
                      <span>{instanceView.digest ?? "(none — built-in)"}</span>
                    </WorkflowFactRow>
                    <WorkflowFactRow>
                      <b>template digest (fence)</b>
                      <span>{instanceView.templateDigest ?? "(none)"}</span>
                    </WorkflowFactRow>
                    {instanceView.pipeVersion != null && (
                      <WorkflowFactRow>
                        <b>pipe version</b>
                        <span>{String(instanceView.pipeVersion)}</span>
                      </WorkflowFactRow>
                    )}
                  </WorkflowInstancePanel>
                )}

                {!activeSessionId && (
                  <WorkflowMutedHint>
                    Select a session to pin this workflow.
                  </WorkflowMutedHint>
                )}
                {activeSessionId && (
                  <WorkflowSessionControls>
                    <WorkflowPrimaryButton
                      onClick={() => void commitPin(entry.id)}
                      title={instanceView?.kind === "instance"
                        ? "Pin with the read instance's template digest as fence"
                        : "Pin without a fence (no instance read)"}
                      type="button"
                    >
                      Pin
                    </WorkflowPrimaryButton>
                    {/* Switch needs the ACTIVE graph id from graph_status —
                        never offered without one. */}
                    {activeGraphId && (
                      <WorkflowSecondaryButton
                        onClick={() => void commitSwitch(activeGraphId, entry.id)}
                        title={`Switch graph ${activeGraphId} to ${entry.id}`}
                        type="button"
                      >
                        Switch
                      </WorkflowSecondaryButton>
                    )}
                    {activeGraphId && (
                      <>
                        <WorkflowWhyInput
                          aria-label="Abandon reason"
                          onChange={(event) => setAbandonWhy(event.target.value)}
                          placeholder="why abandon?"
                          value={abandonWhy}
                        />
                        <WorkflowCancelButton
                          onClick={commitAbandon}
                          type="button"
                        >
                          Abandon
                        </WorkflowCancelButton>
                      </>
                    )}
                  </WorkflowSessionControls>
                )}

                {conflict && (
                  /* Revision conflict: surfaced, NOT retried. The only way
                     forward is a re-read — no button here resubmits with
                     the current digest behind the user's selection. */
                  <WorkflowConflictPanel role="alert">
                    <b>Revision conflict</b>
                    <span>expected: {conflict.expectedDigest ?? "(not reported)"}</span>
                    <span>current: {conflict.currentDigest ?? "(not reported)"}</span>
                    {conflict.currentRevision != null && (
                      <span>current revision: {conflict.currentRevision}</span>
                    )}
                    <em>
                      The template changed since your read — re-read the
                      instance, review it, then pin again.
                    </em>
                    <WorkflowSecondaryButton
                      onClick={() => {
                        setConflict(null);
                        onReadInstance?.(entry.id);
                      }}
                      type="button"
                    >
                      Re-read instance
                    </WorkflowSecondaryButton>
                  </WorkflowConflictPanel>
                )}
              </WorkflowEntryDisclosure>
            )}
          </WorkflowEntryBlock>
        );
      })}

      {workflows.length > 0 && (
        <WorkflowRecordsGroup>
          <WorkflowRecordsLabel>Compiled user workflows</WorkflowRecordsLabel>
          {workflows.map((record, index) => (
            <WorkflowRecordRow key={record.id ?? `opaque:${index}`}>
              {/* Opaque record: id/name when present, otherwise admit the
                  record is opaque — no invented summary fields. */}
              {record.id != null || record.name != null
                ? [record.name, record.id].filter((part) => part != null).join(" · ")
                : "(opaque workflow record)"}
            </WorkflowRecordRow>
          ))}
        </WorkflowRecordsGroup>
      )}

      {/* An unreadable list is an error line, never an empty catalog. */}
      {listError && <WorkflowErrorHint role="alert">{listError}</WorkflowErrorHint>}
    </WorkflowSection>
  );
}

const WorkflowSection = styled.div`
  display: grid;
  gap: 2px;
`;

const WorkflowHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;

  ${SettingsNavGroupLabel} {
    margin: 0;
  }
`;

const WorkflowHeaderAction = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border: 0;
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const WorkflowFilterRow = styled.div`
  padding: 0 8px;
  color: var(--forge-text-muted);
  font-size: 10px;

  label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }

  input {
    margin: 0;
  }
`;

const WorkflowEntryBlock = styled.div`
  display: grid;
  gap: 2px;
`;

const WorkflowEntryRow = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 9px 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const WorkflowOriginBadge = styled.span`
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--forge-border-strong);
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 600;

  &[data-origin="built_in"] {
    color: var(--forge-tint-soft, var(--forge-blue, #62a0ff));
  }
`;

const WorkflowEntryId = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--forge-mono, monospace);
  font-size: 11px;
`;

const WorkflowEligibleBadge = styled.span`
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--forge-border-strong);
  color: var(--forge-green, #4fbf6f);
  font-size: 9px;
  font-weight: 600;
`;

const WorkflowUnknownRow = styled.div`
  padding: 2px 8px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-style: italic;
`;

const WorkflowEntryDisclosure = styled.div`
  display: grid;
  gap: 4px;
  margin: 0 4px 4px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--forge-surface-hover);
`;

const WorkflowDetailActions = styled.div`
  display: flex;
  gap: 6px;
`;

const WorkflowInstancePanel = styled.div`
  display: grid;
  gap: 2px;
`;

const WorkflowFactRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10px;
  color: var(--forge-text-soft);

  b {
    flex: 0 0 auto;
    color: var(--forge-text-muted);
    font-weight: 650;
  }

  span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--forge-mono, monospace);
  }
`;

const WorkflowSessionControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`;

const WorkflowConflictPanel = styled.div`
  display: grid;
  gap: 2px;
  padding: 4px 6px;
  border: 1px solid var(--forge-red);
  border-radius: 6px;
  font-size: 10px;
  color: var(--forge-text-soft);

  b {
    color: var(--forge-red);
    font-weight: 650;
  }

  span {
    font-family: var(--forge-mono, monospace);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  em {
    font-style: normal;
    color: var(--forge-text-muted);
  }
`;

const WorkflowRecordsGroup = styled.div`
  display: grid;
  gap: 2px;
  padding: 2px 0 0;
`;

const WorkflowRecordsLabel = styled.div`
  padding: 0 8px;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const WorkflowRecordRow = styled.div`
  padding: 1px 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--forge-text-soft);
  font-size: 10px;
  font-family: var(--forge-mono, monospace);
`;

const WorkflowRegisterEditor = styled.div`
  display: grid;
  gap: 4px;
  margin: 0 4px 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--forge-surface-hover);
`;

const WorkflowSourceInput = styled.textarea`
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-family: var(--forge-mono, monospace);
  font-size: 11px;
  outline: none;
  resize: vertical;
`;

const WorkflowRegisterDisclosure = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
`;

const WorkflowCompileErrors = styled.ul`
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0 0 0 14px;
  color: var(--forge-red);
  font-size: 10px;
  font-family: var(--forge-mono, monospace);
`;

const WorkflowRegisterActions = styled.div`
  display: flex;
  gap: 6px;
`;

const WorkflowPrimaryButton = styled.button`
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 5px;
  color: var(--forge-text);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    background: var(--forge-surface-hover);
  }
`;

const WorkflowSecondaryButton = styled.button`
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const WorkflowCancelButton = styled.button`
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const WorkflowWhyInput = styled.input`
  flex: 1;
  min-width: 60px;
  padding: 2px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 10px;
  outline: none;
`;

const WorkflowMutedHint = styled.div`
  padding: 2px 8px;
  color: var(--forge-text-muted);
  font-size: 10px;
`;

const WorkflowErrorHint = styled.div`
  padding: 2px 8px;
  color: var(--forge-red);
  font-size: 10px;
`;
