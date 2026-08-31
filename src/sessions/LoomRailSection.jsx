import { useCallback, useState } from "react";
import styled from "styled-components";
import { ExpandLess } from "@styled-icons/material-rounded/ExpandLess";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";

import { SettingsNavGroupLabel, ButtonAddIcon } from "../app/appStyles.js";
import {
  cliPresence,
  cliPresenceLabel,
  draftFenceFor,
  registryFenceFor,
  splitCommaList,
} from "./loomModel.js";

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

function factText(value) {
  return value == null ? "(not published)" : String(value);
}

function rawText(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function LoomRailSection({
  activeSessionId = "",
  agentTypes = [],
  workflowEntries = [],
  archivedEntries = null,
  cliPresent = {},
  installByType = {},
  cancelByJob = {},
  registryCursor = null,
  listError = "",
  unavailable = false,
  featureUnavailable = {},
  featureErrors = {},
  authoringConflict = null,
  onRegister = null,
  onRefreshRegistry = null,
  onListArchived = null,
  onValidate = null,
  onAuthorDraft = null,
  onAuthorRevise = null,
  onAuthorConfirm = null,
  onSetArchived = null,
  onRefreshInstall = null,
  onRetryInstall = null,
  onCancelInstall = null,
}) {
  const [registering, setRegistering] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [expandedId, setExpandedId] = useState("");
  const [authoring, setAuthoring] = useState(false);
  const [authorKind, setAuthorKind] = useState("agent_type");
  const [prose, setProse] = useState("");
  const [authoredDraft, setAuthoredDraft] = useState(null);
  const [authoredText, setAuthoredText] = useState("");
  const [validation, setValidation] = useState(null);
  const [confirmOutcome, setConfirmOutcome] = useState(null);
  const [authoringBusy, setAuthoringBusy] = useState("");
  const [authoringNotice, setAuthoringNotice] = useState("");
  const [selectedFenceKey, setSelectedFenceKey] = useState("");
  const [archiveOutcome, setArchiveOutcome] = useState(null);

  const setDraftField = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const activeEntries = [...agentTypes, ...workflowEntries];
  const selectedFenceEntry = activeEntries.find((entry) => (
    `${entry.registryKind}:${entry.id}` === selectedFenceKey
  )) ?? null;
  const draftRegistryFence = registryFenceFor(authoredDraft);
  const selectedRegistryFence = registryFenceFor(selectedFenceEntry);
  const submittedRegistryFence = selectedRegistryFence ?? draftRegistryFence;
  const authoringFence = draftFenceFor(authoredDraft);

  const adoptAuthoringDraft = useCallback((next) => {
    if (!next) return;
    setAuthoredDraft(next);
    setAuthoredText(typeof next.text === "string" ? next.text : "");
    setValidation(null);
    setConfirmOutcome(null);
    setAuthoringNotice("");
    const matching = [...agentTypes, ...workflowEntries].find((entry) => (
      entry.registryKind === (next.registryKind ?? authorKind)
        && entry.id === next.registryId
    ));
    setSelectedFenceKey(matching ? `${matching.registryKind}:${matching.id}` : "");
  }, [agentTypes, authorKind, workflowEntries]);

  const requestAuthorDraft = useCallback(async () => {
    if (!activeSessionId) {
      setAuthoringNotice("Open an active session before asking Loom to draft.");
      return;
    }
    if (!prose.trim()) return;
    setAuthoringBusy("draft");
    setAuthoringNotice("");
    try {
      const next = await onAuthorDraft?.(activeSessionId, authorKind, prose);
      if (next) adoptAuthoringDraft(next);
    } finally {
      setAuthoringBusy("");
    }
  }, [activeSessionId, adoptAuthoringDraft, authorKind, onAuthorDraft, prose]);

  const requestRevise = useCallback(async () => {
    if (!authoredDraft || !authoredText) return;
    setAuthoringBusy("revise");
    setAuthoringNotice("");
    try {
      const next = await onAuthorRevise?.(authoredDraft, authorKind, authoredText);
      if (next) adoptAuthoringDraft(next);
    } finally {
      setAuthoringBusy("");
    }
  }, [adoptAuthoringDraft, authorKind, authoredDraft, authoredText, onAuthorRevise]);

  const requestValidation = useCallback(async () => {
    if (!authoredText) return;
    setAuthoringBusy("validate");
    setAuthoringNotice("");
    try {
      const view = await onValidate?.(authorKind, authoredText);
      if (view) setValidation(view);
    } finally {
      setAuthoringBusy("");
    }
  }, [authorKind, authoredText, onValidate]);

  const requestConfirm = useCallback(async () => {
    if (!authoredDraft || !authoredText) return;
    setAuthoringBusy("confirm");
    setAuthoringNotice("");
    try {
      const outcome = await onAuthorConfirm?.(
        authoredDraft,
        authorKind,
        authoredText,
        selectedFenceEntry,
      );
      if (outcome) setConfirmOutcome(outcome);
    } finally {
      setAuthoringBusy("");
    }
  }, [authorKind, authoredDraft, authoredText, onAuthorConfirm, selectedFenceEntry]);

  const changeArchiveState = useCallback(async (entry, shouldArchive) => {
    const outcome = await onSetArchived?.(entry, shouldArchive);
    if (outcome) setArchiveOutcome({ entry, shouldArchive, outcome });
  }, [onSetArchived]);

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

  return (
    <LoomSection aria-label="Agent types">
      <LoomHeader>
        <SettingsNavGroupLabel>Agent Types</SettingsNavGroupLabel>
        <LoomHeaderActions>
          <LoomTextAction
            disabled={unavailable}
            onClick={() => onRefreshRegistry?.()}
            title="Explicitly re-read the active registry"
            type="button"
          >
            Re-read
          </LoomTextAction>
          <LoomTextAction
            aria-expanded={authoring}
            disabled={featureUnavailable.authoring === true}
            onClick={() => setAuthoring((current) => !current)}
            title="Guided Loom authoring"
            type="button"
          >
            Guide
          </LoomTextAction>
          <LoomHeaderAction
            aria-label="Register agent type"
            disabled={unavailable}
            onClick={() => setRegistering((current) => !current)}
            title="Register a new agent type"
            type="button"
          >
            <ButtonAddIcon aria-hidden="true" />
          </LoomHeaderAction>
        </LoomHeaderActions>
      </LoomHeader>

      {unavailable && (
        <LoomMutedHint>Loom is unavailable on this daemon.</LoomMutedHint>
      )}

      <LoomRegistryTruth>
        <span>
          Active registry only. Archived entries are excluded by default;
          an empty active list means none active, not none exist.
        </span>
        {registryCursor != null && (
          <i title="Live registry cursor (decimal string, advanced verbatim)">
            live cursor {registryCursor}
          </i>
        )}
        {featureUnavailable.watch === true && <i>Live registry watch unavailable.</i>}
      </LoomRegistryTruth>

      {authoring && (
        <LoomAuthoringEditor aria-label="Guided Loom authoring">
          <LoomSubheading>Describe → draft → revise → confirm</LoomSubheading>
          <LoomAuthoringRow>
            <LoomEditSelect
              aria-label="Authoring registry kind"
              onChange={(event) => {
                setAuthorKind(event.target.value);
                setAuthoredDraft(null);
                setAuthoredText("");
                setValidation(null);
                setConfirmOutcome(null);
                setSelectedFenceKey("");
              }}
              value={authorKind}
            >
              <option value="agent_type">agent type</option>
              <option value="workflow">workflow</option>
            </LoomEditSelect>
            <LoomFenceFact>session {activeSessionId || "(none active)"}</LoomFenceFact>
          </LoomAuthoringRow>
          <LoomEditTextarea
            aria-label="Describe an agent type or workflow"
            onChange={(event) => setProse(event.target.value)}
            placeholder="Describe the agent type or workflow in prose…"
            rows={3}
            value={prose}
          />
          <LoomRegisterActions>
            <LoomRegisterButton
              disabled={!activeSessionId || !prose.trim() || authoringBusy !== ""}
              onClick={requestAuthorDraft}
              type="button"
            >
              {authoringBusy === "draft" ? "Drafting…" : "Create draft"}
            </LoomRegisterButton>
          </LoomRegisterActions>

          {authoredDraft && (
            <>
              <LoomFenceBox>
                <b>Authoring fence (submitted exactly as read)</b>
                <span>authoring_id: {factText(authoringFence?.authoring_id)}</span>
                <span>expected_revision: {factText(authoringFence?.expected_revision)}</span>
              </LoomFenceBox>
              <LoomEditTextarea
                aria-label="Loom draft text"
                onChange={(event) => {
                  setAuthoredText(event.target.value);
                  setValidation(null);
                  setConfirmOutcome(null);
                }}
                rows={8}
                value={authoredText}
              />
              <LoomRegisterActions>
                <LoomRegisterButton
                  disabled={!authoredText || authoringBusy !== ""}
                  onClick={requestRevise}
                  type="button"
                >
                  {authoringBusy === "revise" ? "Revising…" : "Revise"}
                </LoomRegisterButton>
                <LoomRegisterButton
                  disabled={featureUnavailable.validate === true
                    || !authoredText
                    || authoringBusy !== ""}
                  onClick={requestValidation}
                  type="button"
                >
                  {authoringBusy === "validate" ? "Validating…" : "Validate"}
                </LoomRegisterButton>
              </LoomRegisterActions>

              {featureUnavailable.validate === true && (
                <LoomMutedHint>
                  Validation is unavailable; authoring remains separately available.
                </LoomMutedHint>
              )}
              {validation && validation.errors.length === 0 && (
                <LoomSuccessHint>No validation errors published.</LoomSuccessHint>
              )}
              {validation?.errors.length > 0 && (
                <LoomValidationList aria-label="Validation errors">
                  {validation.errors.map((validationError, index) => (
                    <li key={`${factText(validationError.line)}:${factText(validationError.column)}:${index}`}>
                      line {factText(validationError.line)}, column {factText(validationError.column)}
                      {validationError.field != null
                        ? ` · ${factText(validationError.field)}`
                        : ""}
                      {` — ${factText(validationError.message)}`}
                    </li>
                  ))}
                </LoomValidationList>
              )}
              {validation?.canonicalDigestPreview != null && (
                <LoomDigestPreview>
                  Canonical digest preview (not saved): {validation.canonicalDigestPreview}
                </LoomDigestPreview>
              )}

              <LoomSubheading>Confirm into the registry</LoomSubheading>
              <LoomEditSelect
                aria-label="Listed registry fence"
                onChange={(event) => setSelectedFenceKey(event.target.value)}
                value={selectedFenceKey}
              >
                <option value="">
                  {draftRegistryFence == null
                    ? "No listed-entry fence selected"
                    : "Use registry fence returned with draft"}
                </option>
                {activeEntries
                  .filter((entry) => entry.registryKind === authorKind
                    && (authoredDraft.registryId == null
                      || entry.id === authoredDraft.registryId))
                  .map((entry) => (
                    <option
                      key={`${entry.registryKind}:${entry.id}`}
                      value={`${entry.registryKind}:${entry.id}`}
                    >
                      {entry.id} (listed r{factText(entry.rev)})
                    </option>
                  ))}
              </LoomEditSelect>
              <LoomFenceBox>
                <b>Registry fence (submitted exactly as read)</b>
                <span>expected_rev: {factText(submittedRegistryFence?.expected_rev)}</span>
                <span>expected_digest: {factText(submittedRegistryFence?.expected_digest)}</span>
                {submittedRegistryFence == null && (
                  <i>No registry fence was published or selected; none will be invented.</i>
                )}
              </LoomFenceBox>
              <LoomRegisterButton
                disabled={!authoredText
                  || authoringBusy !== ""
                  || (validation != null && validation.errors.length > 0)}
                onClick={requestConfirm}
                type="button"
              >
                {authoringBusy === "confirm" ? "Confirming…" : "Confirm"}
              </LoomRegisterButton>
              {confirmOutcome?.kind === "confirmed" && (
                <LoomSuccessHint>Confirmed into the registry.</LoomSuccessHint>
              )}
              {confirmOutcome?.kind === "not_confirmed" && (
                <>
                  <LoomErrorHint role="status">
                    Not confirmed{confirmOutcome.reason ? ` — ${confirmOutcome.reason}` : ""}.
                  </LoomErrorHint>
                  {confirmOutcome.errors?.length > 0 && (
                    <LoomValidationList aria-label="Confirmation errors">
                      {confirmOutcome.errors.map((confirmError, index) => (
                        <li key={`confirm:${index}`}>
                          line {factText(confirmError.line)}, column {factText(confirmError.column)}
                          {confirmError.field != null ? ` · ${factText(confirmError.field)}` : ""}
                          {` — ${factText(confirmError.message)}`}
                        </li>
                      ))}
                    </LoomValidationList>
                  )}
                </>
              )}
              {confirmOutcome?.kind === "unknown" && (
                <LoomMutedHint>
                  Unrecognized confirm outcome: {rawText(confirmOutcome.raw)}
                </LoomMutedHint>
              )}
            </>
          )}

          {authoringConflict && (
            <LoomConflict role="alert">
              <b>Revision conflict — explicit re-read required.</b>
              <span>
                authoring expected {factText(authoringConflict.expectedRevision)};
                current {factText(authoringConflict.currentRevision)}
              </span>
              <span>
                registry expected rev {factText(authoringConflict.expectedRev)};
                current rev {factText(authoringConflict.currentRev)}
              </span>
              <span>
                expected digest {factText(authoringConflict.expectedDigest)};
                current digest {factText(authoringConflict.currentDigest)}
              </span>
              <i>The current fence is never auto-retried.</i>
            </LoomConflict>
          )}
          {authoringNotice && <LoomErrorHint role="alert">{authoringNotice}</LoomErrorHint>}
          {featureErrors.authoring && (
            <LoomErrorHint role="alert">{featureErrors.authoring}</LoomErrorHint>
          )}
          {featureErrors.validate && (
            <LoomErrorHint role="alert">{featureErrors.validate}</LoomErrorHint>
          )}
        </LoomAuthoringEditor>
      )}

      {!authoring && authoringConflict && (
        <LoomConflict role="alert">
          <b>Revision conflict — explicit re-read required.</b>
          <span>
            authoring expected {factText(authoringConflict.expectedRevision)};
            current {factText(authoringConflict.currentRevision)}
          </span>
          <span>
            registry expected rev {factText(authoringConflict.expectedRev)};
            current rev {factText(authoringConflict.currentRev)}
          </span>
          <span>
            expected digest {factText(authoringConflict.expectedDigest)};
            current digest {factText(authoringConflict.currentDigest)}
          </span>
          <i>Use Re-read above; the current fence is never auto-retried.</i>
        </LoomConflict>
      )}

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
                    {["queued", "installing", "verifying"].includes(installJob.state.kind)
                      && featureUnavailable.cancel !== true && (
                        <LoomCancelInstallButton
                          onClick={() => onCancelInstall?.(installJob.jobId)}
                          type="button"
                        >
                          Cancel
                        </LoomCancelInstallButton>
                      )}
                    {cancelByJob[installJob.jobId]?.kind === "cancelled" && (
                      <LoomSuccessHint>Cancel accepted.</LoomSuccessHint>
                    )}
                    {cancelByJob[installJob.jobId]?.kind === "already_terminal" && (
                      <LoomMutedHint>
                        Already terminal: {factText(cancelByJob[installJob.jobId].state)}
                      </LoomMutedHint>
                    )}
                    {cancelByJob[installJob.jobId]?.kind === "unknown" && (
                      <LoomMutedHint>
                        Unrecognized cancel outcome: {rawText(cancelByJob[installJob.jobId].raw)}
                      </LoomMutedHint>
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
                <LoomRegistryActions>
                  <LoomArchiveButton
                    disabled={featureUnavailable.archive === true
                      || registryFenceFor(type) == null}
                    onClick={() => changeArchiveState(type, true)}
                    title={registryFenceFor(type) == null
                      ? "Re-read required: this entry has no published CAS fence"
                      : "Archive with the listed rev/digest fence"}
                    type="button"
                  >
                    Archive
                  </LoomArchiveButton>
                </LoomRegistryActions>
              </LoomInstallDisclosure>
            )}
          </LoomTypeBlock>
        );
      })}

      {workflowEntries.length > 0 && (
        <LoomRegistryGroup>
          <LoomSubheading>Active workflows</LoomSubheading>
          {workflowEntries.map((entry) => (
            <LoomRegistryRow key={`workflow:${entry.id}`}>
              <span>
                <b>{entry.name || entry.id || "(unnamed workflow)"}</b>
                <i>workflow · r{factText(entry.rev)}</i>
              </span>
              <LoomArchiveButton
                disabled={featureUnavailable.archive === true
                  || registryFenceFor(entry) == null}
                onClick={() => changeArchiveState(entry, true)}
                title={registryFenceFor(entry) == null
                  ? "Re-read required: this entry has no published CAS fence"
                  : "Archive with the listed rev/digest fence"}
                type="button"
              >
                Archive
              </LoomArchiveButton>
            </LoomRegistryRow>
          ))}
        </LoomRegistryGroup>
      )}

      <LoomRegistryGroup>
        <LoomRegistryGroupHeader>
          <LoomSubheading>Archived</LoomSubheading>
          {archivedEntries == null && (
            <LoomTextAction
              disabled={featureUnavailable.archive === true}
              onClick={() => onListArchived?.()}
              type="button"
            >
              Read archived
            </LoomTextAction>
          )}
        </LoomRegistryGroupHeader>
        {archivedEntries == null && (
          <LoomMutedHint>
            Archived entries excluded by default; their existence has not been read.
          </LoomMutedHint>
        )}
        {Array.isArray(archivedEntries) && archivedEntries.length === 0 && (
          <LoomMutedHint>No archived entries in the explicit include-archived read.</LoomMutedHint>
        )}
        {archivedEntries?.map((entry) => (
          <LoomRegistryRow key={`archived:${entry.registryKind}:${entry.id}`}>
            <span>
              <b>{entry.name || entry.id || "(unnamed entry)"}</b>
              <i>{entry.registryKind} · archived · r{factText(entry.rev)}</i>
            </span>
            <LoomArchiveButton
              disabled={featureUnavailable.archive === true
                || registryFenceFor(entry) == null}
              onClick={() => changeArchiveState(entry, false)}
              title={registryFenceFor(entry) == null
                ? "Re-read required: this archived entry has no published CAS fence"
                : "Unarchive with the explicitly listed rev/digest fence"}
              type="button"
            >
              Unarchive
            </LoomArchiveButton>
          </LoomRegistryRow>
        ))}
      </LoomRegistryGroup>

      {archiveOutcome?.outcome.kind === "already" && (
        <LoomMutedHint>
          Archive state already applied: {archiveOutcome.outcome.state}
        </LoomMutedHint>
      )}
      {archiveOutcome?.outcome.kind === "not_found" && (
        <LoomErrorHint role="status">Registry entry not found; the registry was re-read.</LoomErrorHint>
      )}
      {archiveOutcome?.outcome.kind === "unknown" && (
        <LoomMutedHint>
          Unrecognized archive outcome: {rawText(archiveOutcome.outcome.raw)}
        </LoomMutedHint>
      )}
      {featureErrors.archive && <LoomErrorHint role="alert">{featureErrors.archive}</LoomErrorHint>}
      {featureErrors.cancel && <LoomErrorHint role="alert">{featureErrors.cancel}</LoomErrorHint>}
      {featureErrors.watch && <LoomErrorHint role="alert">{featureErrors.watch}</LoomErrorHint>}

      {!agentTypes.length && !workflowEntries.length && !listError && (
        <LoomMutedHint>
          No active registry entries. Archived entries are excluded by default.
        </LoomMutedHint>
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

const LoomHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
`;

const LoomTextAction = styled.button`
  padding: 1px 5px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &:disabled {
    opacity: 0.48;
    cursor: default;
  }
`;

const LoomRegistryTruth = styled.div`
  display: grid;
  gap: 1px;
  margin: 0 8px 4px;
  color: var(--forge-text-muted);
  font-size: 9px;
  line-height: 1.35;

  i {
    font-style: normal;
  }
`;

const LoomAuthoringEditor = styled.div`
  display: grid;
  gap: 5px;
  margin: 0 4px 6px;
  padding: 7px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
  background: var(--forge-surface-hover);
`;

const LoomSubheading = styled.div`
  color: var(--forge-text-soft);
  font-size: 10px;
  font-weight: 750;
`;

const LoomAuthoringRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`;

const LoomEditSelect = styled.select`
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 10px;
  outline: none;
`;

const LoomEditTextarea = styled.textarea`
  width: 100%;
  min-width: 0;
  resize: vertical;
  box-sizing: border-box;
  padding: 5px 6px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-family: var(--forge-mono, monospace);
  font-size: 10px;
  line-height: 1.35;
  outline: none;
`;

const LoomFenceFact = styled.span`
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--forge-text-muted);
  font-size: 9px;
`;

const LoomFenceBox = styled.div`
  display: grid;
  gap: 1px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--forge-surface);
  color: var(--forge-text-muted);
  font-family: var(--forge-mono, monospace);
  font-size: 9px;
  overflow-wrap: anywhere;

  b {
    color: var(--forge-text-soft);
  }

  i {
    font-family: inherit;
    font-style: normal;
  }
`;

const LoomValidationList = styled.ul`
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: 16px;
  color: var(--forge-red);
  font-size: 9px;
`;

const LoomDigestPreview = styled.div`
  padding: 3px 5px;
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: var(--forge-surface);
  font-family: var(--forge-mono, monospace);
  font-size: 9px;
  overflow-wrap: anywhere;
`;

const LoomSuccessHint = styled.span`
  color: var(--forge-green, #4fbf6f);
  font-size: 9px;
`;

const LoomConflict = styled.div`
  display: grid;
  gap: 2px;
  padding: 4px 6px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 45%, transparent);
  border-radius: 6px;
  color: var(--forge-text-muted);
  font-size: 9px;
  overflow-wrap: anywhere;

  b {
    color: var(--forge-red);
  }

  i {
    font-style: normal;
  }
`;

const LoomCancelInstallButton = styled(LoomRetryButton)`
  color: var(--forge-red);
`;

const LoomRegistryActions = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const LoomArchiveButton = styled(LoomRetryButton)`
  &:disabled {
    opacity: 0.48;
    cursor: default;
  }
`;

const LoomRegistryGroup = styled.div`
  display: grid;
  gap: 3px;
  margin: 3px 4px;
  padding: 5px 7px;
  border-radius: 8px;
  background: var(--forge-surface-hover);
`;

const LoomRegistryGroupHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`;

const LoomRegistryRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  color: var(--forge-text-soft);
  font-size: 10px;

  > span {
    display: grid;
    min-width: 0;
  }

  b,
  i {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  i {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-style: normal;
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
