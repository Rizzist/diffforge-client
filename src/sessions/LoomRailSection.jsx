import { useCallback, useState } from "react";
import styled from "styled-components";
import { ExpandLess } from "@styled-icons/material-rounded/ExpandLess";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";

import { SettingsNavGroupLabel, ButtonAddIcon } from "../app/appStyles.js";
import { cliPresence, cliPresenceLabel, splitCommaList } from "./loomModel.js";

/* Rail Agent Types section (Loom registry). Everything is inline — the
   register editor expands in place (no modals). Honesty rules render here:
   each CLI chip shows the daemon's TRI-state probe result (present / missing
   / not probed — a program the daemon never probed is NEVER shown as
   missing), install jobs show the daemon's state string verbatim (unknown
   futures included), Retry appears ONLY on a job the daemon reported failed,
   and an agent type without install jobs says so instead of inventing one. */

const EMPTY_DRAFT = {
  id: "",
  name: "",
  job: "",
  inType: "",
  outType: "",
  clis: "",
  apis: "",
  skills: "",
  scripts: "",
  color: "",
  glyph: "",
};

const DRAFT_FIELDS = [
  ["id", "id"],
  ["name", "name"],
  ["job", "job"],
  ["inType", "in type"],
  ["outType", "out type"],
  ["clis", "clis (comma-separated)"],
  ["apis", "apis (comma-separated)"],
  ["skills", "skills (comma-separated)"],
  ["scripts", "scripts (comma-separated)"],
  ["color", "color"],
  ["glyph", "glyph"],
];

export default function LoomRailSection({
  agentTypes = [],
  cliPresent = {},
  installByType = {},
  listError = "",
  unavailable = false,
  onRegister = null,
  onRefreshInstall = null,
  onRetryInstall = null,
}) {
  const [registering, setRegistering] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [expandedId, setExpandedId] = useState("");

  const setDraftField = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const commitRegister = useCallback(() => {
    const fields = {
      id: draft.id.trim(),
      name: draft.name.trim(),
      job: draft.job.trim(),
      inType: draft.inType.trim(),
      outType: draft.outType.trim(),
      clis: splitCommaList(draft.clis),
      apis: splitCommaList(draft.apis),
      skills: splitCommaList(draft.skills),
      scripts: splitCommaList(draft.scripts),
      color: draft.color.trim(),
      glyph: draft.glyph.trim(),
    };
    if (!fields.id || !fields.name) return;
    setRegistering(false);
    setDraft(EMPTY_DRAFT);
    onRegister?.(fields);
  }, [draft, onRegister]);

  const toggleExpanded = useCallback((agentTypeId) => {
    setExpandedId((current) => {
      const next = current === agentTypeId ? "" : agentTypeId;
      if (next) onRefreshInstall?.(agentTypeId);
      return next;
    });
  }, [onRefreshInstall]);

  const draftClis = splitCommaList(draft.clis);

  if (unavailable) {
    return (
      <LoomSection aria-label="Agent types">
        <LoomHeader>
          <SettingsNavGroupLabel>Agent Types</SettingsNavGroupLabel>
        </LoomHeader>
        <LoomMutedHint>Loom is unavailable on this daemon.</LoomMutedHint>
      </LoomSection>
    );
  }

  return (
    <LoomSection aria-label="Agent types">
      <LoomHeader>
        <SettingsNavGroupLabel>Agent Types</SettingsNavGroupLabel>
        <LoomHeaderAction
          aria-label="Register agent type"
          onClick={() => setRegistering((current) => !current)}
          title="Register a new agent type"
          type="button"
        >
          <ButtonAddIcon aria-hidden="true" />
        </LoomHeaderAction>
      </LoomHeader>

      {registering && (
        <LoomRegisterEditor>
          {DRAFT_FIELDS.map(([key, label]) => (
            <LoomEditInput
              aria-label={`Agent type ${label}`}
              key={key}
              onChange={(event) => setDraftField(key, event.target.value)}
              placeholder={label}
              value={draft[key]}
            />
          ))}
          {/* Consent disclosure: registering an agent type QUEUES CLI
              installs on the daemon — say exactly what will be queued. */}
          <LoomRegisterDisclosure>
            {draftClis.length > 0
              ? `Registering queues installs for: ${draftClis.join(", ")}`
              : "Registering queues no CLI installs (no CLIs listed)."}
          </LoomRegisterDisclosure>
          <LoomRegisterActions>
            <LoomRegisterButton onClick={commitRegister} type="button">
              Register
            </LoomRegisterButton>
            <LoomCancelButton
              onClick={() => {
                setRegistering(false);
                setDraft(EMPTY_DRAFT);
              }}
              type="button"
            >
              Cancel
            </LoomCancelButton>
          </LoomRegisterActions>
        </LoomRegisterEditor>
      )}

      {agentTypes.map((type) => {
        const expanded = expandedId === type.id;
        const bucket = installByType[type.id] || null;
        return (
          <LoomTypeBlock key={type.id}>
            <LoomTypeRow
              aria-expanded={expanded}
              onClick={() => toggleExpanded(type.id)}
              title={`${type.name} — ${type.job}`}
              type="button"
            >
              <LoomGlyph aria-hidden="true">
                {type.glyph ? <span>{type.glyph}</span> : <SmartToy size={12} />}
              </LoomGlyph>
              {/* A color swatch only when the registry actually carries a
                  color — never an invented one. */}
              {type.color && (
                <LoomColorSwatch
                  aria-hidden="true"
                  style={{ background: type.color }}
                  title={type.color}
                />
              )}
              <LoomTypeText>
                <LoomTypeName>{type.name}</LoomTypeName>
                <LoomTypeJob>{type.job}</LoomTypeJob>
              </LoomTypeText>
              <LoomIoChip title="Input type → output type">
                {type.inType} → {type.outType}
              </LoomIoChip>
              {type.rev != null && (
                <LoomRev title="Registry revision">r{type.rev}</LoomRev>
              )}
              <LoomExpandIcon aria-hidden="true">
                {expanded ? <ExpandLess size={12} /> : <ExpandMore size={12} />}
              </LoomExpandIcon>
            </LoomTypeRow>

            {type.clis.length > 0 && (
              <LoomCliChips>
                {type.clis.map((program) => {
                  /* TRI-state badge: present / missing / not probed. A key
                     absent from cli_present means the daemon never probed —
                     rendered as "not probed", NEVER as missing. */
                  const presence = cliPresence(cliPresent, program);
                  return (
                    <LoomCliChip
                      data-presence={presence}
                      key={program}
                      title={`CLI ${program}: ${cliPresenceLabel(presence)}`}
                    >
                      <span>{program}</span>
                      <i>{cliPresenceLabel(presence)}</i>
                    </LoomCliChip>
                  );
                })}
              </LoomCliChips>
            )}

            {expanded && (
              <LoomInstallDisclosure>
                <LoomInstallHeader>
                  <span>Installs</span>
                  <LoomHeaderAction
                    aria-label="Refresh install status"
                    onClick={() => onRefreshInstall?.(type.id)}
                    title="Re-read install status from the daemon"
                    type="button"
                  >
                    <Refresh size={12} />
                  </LoomHeaderAction>
                </LoomInstallHeader>
                {bucket == null && (
                  <LoomMutedHint>Install status not read yet.</LoomMutedHint>
                )}
                {bucket?.error && (
                  <LoomErrorHint role="alert">{bucket.error}</LoomErrorHint>
                )}
                {bucket != null && !bucket.error && bucket.jobs.length === 0 && (
                  /* Honest absence: the daemon reports no install job for
                     this agent type — none is fabricated. */
                  <LoomMutedHint>No install job for this agent type.</LoomMutedHint>
                )}
                {bucket?.jobs.map((installJob) => (
                  <LoomJobRow data-state={installJob.state.kind} key={installJob.jobId}>
                    <LoomJobState title={`Daemon-reported state: ${installJob.state.raw}`}>
                      {installJob.state.kind === "unknown"
                        ? (installJob.state.raw
                          ? `${installJob.state.raw} (unrecognized)`
                          : "(no state reported)")
                        : installJob.state.label}
                    </LoomJobState>
                    {installJob.completed != null && installJob.total != null && (
                      <LoomJobProgress>
                        {installJob.completed}/{installJob.total}
                      </LoomJobProgress>
                    )}
                    {installJob.currentCli && (
                      <LoomJobCli>{installJob.currentCli}</LoomJobCli>
                    )}
                    {installJob.error && (
                      <LoomErrorHint role="alert">{installJob.error}</LoomErrorHint>
                    )}
                    {/* Retry ONLY for a daemon-reported failed job — never
                        for unknown or in-flight states. */}
                    {installJob.retryable && (
                      <LoomRetryButton
                        onClick={() => onRetryInstall?.(installJob.jobId)}
                        type="button"
                      >
                        Retry
                      </LoomRetryButton>
                    )}
                  </LoomJobRow>
                ))}
                {bucket != null && bucket.items.length > 0 && (
                  <LoomItemList>
                    {bucket.items.map((item) => (
                      <LoomItemRow key={`${item.jobId}:${item.ordinal}`}>
                        <span>{item.program}</span>
                        <i title={`Daemon-reported state: ${item.state.raw}`}>
                          {item.state.kind === "unknown"
                            ? `${item.state.raw} (unrecognized)`
                            : item.state.label}
                        </i>
                        {item.error && <em>{item.error}</em>}
                      </LoomItemRow>
                    ))}
                  </LoomItemList>
                )}
              </LoomInstallDisclosure>
            )}
          </LoomTypeBlock>
        );
      })}

      {!agentTypes.length && !listError && (
        <LoomMutedHint>No agent types registered.</LoomMutedHint>
      )}
      {/* An unreadable registry is an error line, never an empty list. */}
      {listError && <LoomErrorHint role="alert">{listError}</LoomErrorHint>}
    </LoomSection>
  );
}

const LoomSection = styled.div`
  display: grid;
  gap: 2px;
`;

const LoomHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;

  ${SettingsNavGroupLabel} {
    margin: 0;
  }
`;

const LoomHeaderAction = styled.button`
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

const LoomTypeBlock = styled.div`
  display: grid;
  gap: 2px;
`;

const LoomTypeRow = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 28px;
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

const LoomGlyph = styled.span`
  display: grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 5px;
  color: var(--forge-tint-soft, var(--forge-blue, #62a0ff));
  background: rgba(var(--forge-tint-rgb), 0.14);
  font-size: 11px;
`;

const LoomColorSwatch = styled.span`
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 3px;
  border: 1px solid var(--forge-border-strong);
`;

const LoomTypeText = styled.span`
  display: grid;
  flex: 1;
  min-width: 0;
`;

const LoomTypeName = styled.span`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const LoomTypeJob = styled.span`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 500;
`;

const LoomIoChip = styled.span`
  flex: 0 0 auto;
  max-width: 96px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--forge-border-strong);
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 600;
`;

const LoomRev = styled.span`
  flex: 0 0 auto;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 600;
`;

const LoomExpandIcon = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--forge-text-muted);
`;

const LoomCliChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 0 9px 2px 32px;
`;

const LoomCliChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--forge-border-strong);
  color: var(--forge-text-soft);
  font-size: 9px;
  font-weight: 600;

  i {
    font-style: normal;
    color: var(--forge-text-muted);
  }

  &[data-presence="present"] i {
    color: var(--forge-green, #4fbf6f);
  }

  &[data-presence="missing"] i {
    color: var(--forge-red);
  }
`;

const LoomInstallDisclosure = styled.div`
  display: grid;
  gap: 3px;
  margin: 0 4px 4px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--forge-surface-hover);
`;

const LoomInstallHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 650;
`;

const LoomJobRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--forge-text-soft);
`;

const LoomJobState = styled.span`
  font-weight: 650;

  ${LoomJobRow}[data-state="failed"] & {
    color: var(--forge-red);
  }

  ${LoomJobRow}[data-state="succeeded"] & {
    color: var(--forge-green, #4fbf6f);
  }
`;

const LoomJobProgress = styled.span`
  color: var(--forge-text-muted);
`;

const LoomJobCli = styled.span`
  color: var(--forge-text-muted);
  font-family: var(--forge-mono, monospace);
`;

const LoomRetryButton = styled.button`
  flex: 0 0 auto;
  padding: 1px 7px;
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

const LoomItemList = styled.div`
  display: grid;
  gap: 2px;
`;

const LoomItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  color: var(--forge-text-muted);

  span {
    font-family: var(--forge-mono, monospace);
  }

  i {
    font-style: normal;
  }

  em {
    font-style: normal;
    color: var(--forge-red);
  }
`;

const LoomRegisterEditor = styled.div`
  display: grid;
  gap: 4px;
  margin: 0 4px 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--forge-surface-hover);
`;

const LoomEditInput = styled.input`
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 11px;
  font-weight: 550;
  outline: none;
`;

const LoomRegisterDisclosure = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
`;

const LoomRegisterActions = styled.div`
  display: flex;
  gap: 6px;
`;

const LoomRegisterButton = styled.button`
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

const LoomCancelButton = styled.button`
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

const LoomMutedHint = styled.div`
  padding: 2px 8px;
  color: var(--forge-text-muted);
  font-size: 10px;
`;

const LoomErrorHint = styled.div`
  padding: 2px 8px;
  color: var(--forge-red);
  font-size: 10px;
`;
