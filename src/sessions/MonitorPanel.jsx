import { useCallback, useState } from "react";
import styled from "styled-components";

import {
  buildRegisterSpec,
  filterSummary,
  MONITOR_FILTER_FIELDS,
  MONITOR_FILTER_OPERATORS,
  MONITOR_SOURCE_KINDS,
  sourceSummary,
} from "./monitorModel.js";

/* Monitor manager (P4): monitor_control_v1 + monitor_delivery_v1 — the
   per-session registry (rows + per-source availability + policy), a
   register form over the documented source vocabulary, per-row removal,
   and the delivery watch stream. PRESENTATIONAL ONLY — every daemon
   read/write lives in useMonitor.js; this component renders monitorModel
   views and dispatches through callbacks. The honesty rules render here:
   - per-source availability is the model's TRI-state verbatim: only an
     explicit "available" renders available; "unavailable" shows its typed
     reason; everything else renders "availability unknown" — an absent
     state is NEVER dressed up as available;
   - monitor rows render ONLY under the `listed` outcome ("No monitors
     registered." is claimed only for a listed-and-empty registry); a
     rejected list outcome renders the STRUCTURED rejection — never
     "0 monitors" for a list the daemon refused to produce;
   - a register rejection renders its structured typed reason (reason
     discriminant + fields) — never a fabricated success, never a bare
     string; client-side form validation only refuses to dispatch
     malformed requests and is visibly local;
   - the watch cursor renders VERBATIM as its decimal string (null is
     honestly "not watching"); an UNREAD registry ("Monitors not read
     yet.") and a listed-but-empty registry stay DISTINCT surfaces. */

const INITIAL_FORM = Object.freeze({
  sourceKind: "timer",
  command: "",
  path: "",
  intervalMs: "",
  advancedSource: "",
  filterEnabled: false,
  filterField: "body",
  filterOperator: "contains",
  filterValue: "",
  filterCaseSensitive: false,
  report: true,
  followUp: "",
  occurrence: "every",
  lifetimeKind: "session",
  timeoutMs: "",
});

/* A structured rejection, rendered as data: the reason discriminant
   verbatim, then its typed sibling fields. */
function RejectionText({ rejection }) {
  return (
    <>
      <b>{rejection?.reason ?? "(no reason published)"}</b>
      {rejection?.detail ? ` — ${rejection.detail}` : null}
    </>
  );
}

function availabilityLabel(row) {
  if (row.state === "available") return "available";
  if (row.state === "unavailable") {
    return row.reason ? `unavailable (${row.reason})` : "unavailable";
  }
  /* TRI-state: an absent/unrecognized state is admitted, never promoted. */
  return row.stateRaw != null && row.stateRaw !== "unknown"
    ? `availability unknown (${row.stateRaw})`
    : "availability unknown";
}

function policyLine(policy) {
  if (policy == null) return null;
  const cap = (value) => value ?? "(not published)";
  const parts = [
    `list ${cap(policy.list)}`,
    `register ${cap(policy.register)}${policy.registerRequiresControlAttachment ? " (control attachment required)" : ""}`,
    `remove ${cap(policy.remove)}${policy.removeRequiresControlAttachment ? " (control attachment required)" : ""}`,
    `watch ${cap(policy.watch)}`,
  ];
  return parts.join(" · ");
}

export default function MonitorPanel({
  entry = undefined,
  deliveries = [],
  cursor = null,
  watchOutcome = null,
  error = "",
  loading = false,
  unavailable = false,
  onRefresh = null,
  onRegister = null,
  onRemove = null,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [formErrors, setFormErrors] = useState([]);
  const [registering, setRegistering] = useState(false);
  const [lastRegister, setLastRegister] = useState(null);
  const [removingId, setRemovingId] = useState("");
  const [lastRemove, setLastRemove] = useState(null);

  const setField = useCallback((key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const commitRegister = useCallback(async () => {
    if (registering) return;
    /* Local validation refuses to DISPATCH a malformed request — a
       distinct, visibly client-side surface, never presented as a daemon
       rejection. */
    const built = buildRegisterSpec(form);
    if (!built.ok) {
      setFormErrors(built.errors);
      return;
    }
    setFormErrors([]);
    setRegistering(true);
    try {
      const outcome = await onRegister?.(built.spec);
      if (outcome) {
        setLastRegister(outcome);
        if (outcome.status === "registered") {
          setForm(INITIAL_FORM);
        }
      }
    } finally {
      setRegistering(false);
    }
  }, [form, onRegister, registering]);

  const commitRemove = useCallback(async (monitorId) => {
    if (removingId) return;
    setRemovingId(monitorId);
    try {
      const outcome = await onRemove?.(monitorId);
      if (outcome) setLastRemove({ monitorId, outcome });
    } finally {
      setRemovingId("");
    }
  }, [onRemove, removingId]);

  if (unavailable) {
    return (
      <MonitorSection aria-label="Monitors">
        <MonitorTitle>Monitors</MonitorTitle>
        <MonitorMutedHint>
          Monitor control is unavailable on this daemon.
        </MonitorMutedHint>
      </MonitorSection>
    );
  }

  const outcome = entry?.outcome;

  return (
    <MonitorSection aria-label="Monitors">
      <MonitorHeader>
        <MonitorTitle>Monitors</MonitorTitle>
        <MonitorHeaderTools>
          {/* The live watch position: the decimal STRING as-is — null is
              honestly "not watching", never a fabricated "0" and never a
              numeric round-trip. */}
          <MonitorCursorChip title="The delivery-watch cursor (decimal string, advanced verbatim under BigInt comparison).">
            watch cursor: {cursor == null ? "(not watching)" : cursor}
          </MonitorCursorChip>
          <MonitorHeaderButton
            disabled={loading}
            onClick={() => onRefresh?.()}
            type="button"
          >
            {loading ? "Reading…" : "Refresh"}
          </MonitorHeaderButton>
        </MonitorHeaderTools>
      </MonitorHeader>

      {/* An UNREAD registry stays "not read yet" — claiming "no monitors"
          here would fabricate a daemon statement we never received. */}
      {entry == null && (
        <MonitorMutedHint>Monitors not read yet.</MonitorMutedHint>
      )}

      {entry != null && (
        <>
          <MonitorGroupLabel>Sources</MonitorGroupLabel>
          {entry.sources.length === 0 && (
            <MonitorMutedHint>
              The daemon published no source-availability table.
            </MonitorMutedHint>
          )}
          {entry.sources.length > 0 && (
            <MonitorChipRow>
              {entry.sources.map((row, index) => (
                <MonitorSourceChip
                  data-state={row.state}
                  key={row.source || `source:${index}`}
                  title="Per-source adapter availability, verbatim from the daemon (tri-state: available / unavailable with its reason / unknown)."
                >
                  {row.source || "(unnamed source)"}: {availabilityLabel(row)}
                </MonitorSourceChip>
              ))}
            </MonitorChipRow>
          )}

          {entry.policy != null && (
            <MonitorPolicyRow title="Capability policy from the monitor receipt, verbatim.">
              {policyLine(entry.policy)}
            </MonitorPolicyRow>
          )}

          <MonitorGroupLabel>Registered monitors</MonitorGroupLabel>
          {/* HOUSE LAW: monitor rows render ONLY under the `listed`
              outcome. A listed-and-empty registry is genuine emptiness; a
              rejected outcome renders the structured rejection — never
              "0 monitors". */}
          {outcome?.status === "listed" && outcome.monitors.length === 0 && (
            <MonitorMutedHint>No monitors registered.</MonitorMutedHint>
          )}
          {outcome?.status === "listed" && outcome.monitors.length > 0 && (
            <MonitorList>
              {outcome.monitors.map((monitor) => (
                <MonitorRow key={monitor.monitorId}>
                  <MonitorRowId title={monitor.monitorId}>
                    {monitor.monitorId || "(no id)"}
                  </MonitorRowId>
                  <MonitorRowFacts>
                    <span>{sourceSummary(monitor.source)}</span>
                    {monitor.filter != null && (
                      <span>filter: {filterSummary(monitor.filter)}</span>
                    )}
                    <span>occurrence: {monitor.occurrence ?? "(not published)"}</span>
                    <span>
                      {monitor.expiresAtMs != null
                        ? `expires at ${new Date(monitor.expiresAtMs).toLocaleString()}`
                        : "session lifetime"}
                    </span>
                    {monitor.report === false && <span>report: off</span>}
                    {monitor.followUp != null && (
                      <span>follow-up: {monitor.followUp}</span>
                    )}
                  </MonitorRowFacts>
                  <MonitorRemoveButton
                    disabled={removingId === monitor.monitorId}
                    onClick={() => commitRemove(monitor.monitorId)}
                    title="Remove this monitor (monitor.remove)"
                    type="button"
                  >
                    {removingId === monitor.monitorId ? "Removing…" : "Remove"}
                  </MonitorRemoveButton>
                </MonitorRow>
              ))}
            </MonitorList>
          )}
          {outcome?.status === "rejected" && (
            <MonitorRejectedHint role="alert">
              Monitor list rejected — <RejectionText rejection={outcome.rejection} />
            </MonitorRejectedHint>
          )}
          {outcome?.status === "unknown" && (
            <MonitorMutedHint>
              The daemon returned a monitor-list outcome this client does not
              recognize.
            </MonitorMutedHint>
          )}

          {lastRemove?.outcome?.status === "rejected" && (
            <MonitorRejectedHint role="alert">
              Remove rejected — <RejectionText rejection={lastRemove.outcome.rejection} />
            </MonitorRejectedHint>
          )}
          {lastRemove?.outcome?.status === "unknown" && (
            <MonitorMutedHint>
              The daemon returned a remove outcome this client does not
              recognize.
            </MonitorMutedHint>
          )}

          <MonitorGroupLabel>Register a monitor</MonitorGroupLabel>
          <MonitorForm>
            <MonitorFieldRow>
              <label htmlFor="monitor-source-kind">source</label>
              <MonitorSelect
                id="monitor-source-kind"
                onChange={(event) => setField("sourceKind", event.target.value)}
                value={form.sourceKind}
              >
                {MONITOR_SOURCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
                <option value="advanced">advanced (structured JSON)</option>
              </MonitorSelect>
            </MonitorFieldRow>

            {(form.sourceKind === "process" || form.sourceKind === "poll") && (
              <MonitorFieldRow>
                <label htmlFor="monitor-source-command">command</label>
                <MonitorInput
                  id="monitor-source-command"
                  onChange={(event) => setField("command", event.target.value)}
                  placeholder="command to run"
                  value={form.command}
                />
              </MonitorFieldRow>
            )}
            {form.sourceKind === "file" && (
              <MonitorFieldRow>
                <label htmlFor="monitor-source-path">path</label>
                <MonitorInput
                  id="monitor-source-path"
                  onChange={(event) => setField("path", event.target.value)}
                  placeholder="/path/to/watch"
                  value={form.path}
                />
              </MonitorFieldRow>
            )}
            {(form.sourceKind === "poll" || form.sourceKind === "timer") && (
              <MonitorFieldRow>
                <label htmlFor="monitor-source-interval">interval_ms</label>
                <MonitorInput
                  id="monitor-source-interval"
                  inputMode="numeric"
                  onChange={(event) => setField("intervalMs", event.target.value)}
                  placeholder="e.g. 60000"
                  value={form.intervalMs}
                />
              </MonitorFieldRow>
            )}
            {form.sourceKind === "advanced" && (
              <MonitorFieldRow data-wide="true">
                <label htmlFor="monitor-source-advanced">
                  source JSON (validated: an object with a string &quot;kind&quot;)
                </label>
                <MonitorTextarea
                  id="monitor-source-advanced"
                  onChange={(event) => setField("advancedSource", event.target.value)}
                  placeholder='{"kind": "poll", "command": "…", "interval_ms": 60000}'
                  rows={3}
                  value={form.advancedSource}
                />
              </MonitorFieldRow>
            )}

            <MonitorFieldRow>
              <label htmlFor="monitor-filter-enabled">
                <input
                  checked={form.filterEnabled}
                  id="monitor-filter-enabled"
                  onChange={(event) => setField("filterEnabled", event.target.checked)}
                  type="checkbox"
                />
                {" "}filter
              </label>
            </MonitorFieldRow>
            {form.filterEnabled && (
              <>
                <MonitorFieldRow>
                  <label htmlFor="monitor-filter-field">field</label>
                  <MonitorSelect
                    id="monitor-filter-field"
                    onChange={(event) => setField("filterField", event.target.value)}
                    value={form.filterField}
                  >
                    {MONITOR_FILTER_FIELDS.map((field) => (
                      <option key={field} value={field}>{field}</option>
                    ))}
                  </MonitorSelect>
                  <MonitorSelect
                    aria-label="filter operator"
                    onChange={(event) => setField("filterOperator", event.target.value)}
                    value={form.filterOperator}
                  >
                    {MONITOR_FILTER_OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>{operator}</option>
                    ))}
                  </MonitorSelect>
                </MonitorFieldRow>
                <MonitorFieldRow>
                  <label htmlFor="monitor-filter-value">value</label>
                  <MonitorInput
                    id="monitor-filter-value"
                    onChange={(event) => setField("filterValue", event.target.value)}
                    placeholder="match value"
                    value={form.filterValue}
                  />
                  <label htmlFor="monitor-filter-case">
                    <input
                      checked={form.filterCaseSensitive}
                      id="monitor-filter-case"
                      onChange={(event) => setField("filterCaseSensitive", event.target.checked)}
                      type="checkbox"
                    />
                    {" "}case-sensitive
                  </label>
                </MonitorFieldRow>
              </>
            )}

            <MonitorFieldRow>
              <label htmlFor="monitor-action-report">
                <input
                  checked={form.report}
                  id="monitor-action-report"
                  onChange={(event) => setField("report", event.target.checked)}
                  type="checkbox"
                />
                {" "}report
              </label>
              <MonitorInput
                aria-label="follow-up"
                onChange={(event) => setField("followUp", event.target.value)}
                placeholder="follow-up (optional)"
                value={form.followUp}
              />
            </MonitorFieldRow>

            <MonitorFieldRow>
              <label htmlFor="monitor-occurrence">occurrence</label>
              <MonitorSelect
                id="monitor-occurrence"
                onChange={(event) => setField("occurrence", event.target.value)}
                value={form.occurrence}
              >
                <option value="every">every</option>
                <option value="once">once</option>
              </MonitorSelect>
              <label htmlFor="monitor-lifetime">lifetime</label>
              <MonitorSelect
                id="monitor-lifetime"
                onChange={(event) => setField("lifetimeKind", event.target.value)}
                value={form.lifetimeKind}
              >
                <option value="session">session</option>
                <option value="timeout">timeout</option>
              </MonitorSelect>
              {form.lifetimeKind === "timeout" && (
                <MonitorInput
                  aria-label="timeout_ms"
                  inputMode="numeric"
                  onChange={(event) => setField("timeoutMs", event.target.value)}
                  placeholder="timeout_ms"
                  value={form.timeoutMs}
                />
              )}
            </MonitorFieldRow>

            {formErrors.length > 0 && (
              <MonitorFormErrors role="alert">
                {formErrors.map((message) => (
                  /* Visibly LOCAL validation — the request was not
                     dispatched; this is never a daemon rejection. */
                  <div key={message}>not dispatched: {message}</div>
                ))}
              </MonitorFormErrors>
            )}

            <MonitorFormActions>
              <MonitorRegisterButton
                disabled={registering}
                onClick={commitRegister}
                type="button"
              >
                {registering ? "Registering…" : "Register"}
              </MonitorRegisterButton>
            </MonitorFormActions>

            {/* HOUSE LAW: a success is claimed ONLY for the daemon's
                `registered` outcome; a rejection renders its STRUCTURED
                typed reason; an unknown future status is admitted. */}
            {lastRegister?.status === "registered" && (
              <MonitorOkHint>
                Registered {lastRegister.monitorId || "(id not published)"}.
              </MonitorOkHint>
            )}
            {lastRegister?.status === "rejected" && (
              <MonitorRejectedHint role="alert">
                Registration rejected — <RejectionText rejection={lastRegister.rejection} />
              </MonitorRejectedHint>
            )}
            {lastRegister?.status === "unknown" && (
              <MonitorMutedHint>
                The daemon returned a register outcome this client does not
                recognize.
              </MonitorMutedHint>
            )}
          </MonitorForm>
        </>
      )}

      <MonitorGroupLabel>Deliveries</MonitorGroupLabel>
      {watchOutcome?.status === "rejected" && (
        <MonitorRejectedHint role="alert">
          Watch rejected — <RejectionText rejection={watchOutcome.rejection} />
        </MonitorRejectedHint>
      )}
      {/* Not-watching and watching-but-quiet are DISTINCT claims. */}
      {cursor == null && (
        <MonitorMutedHint>Delivery watch not running.</MonitorMutedHint>
      )}
      {cursor != null && deliveries.length === 0 && (
        <MonitorMutedHint>No deliveries observed yet.</MonitorMutedHint>
      )}
      {deliveries.length > 0 && (
        <MonitorDeliveryList>
          {deliveries.map((report, index) => (
            <MonitorDeliveryRow key={report.deliveryKey || `delivery:${index}`}>
              {/* The delivery's journal cursor, verbatim decimal string. */}
              <span>{report.cursor ?? "·"}</span>
              <MonitorDeliveryFacts>
                <b>{report.monitorId || "(no monitor id)"}</b>
                <span>{report.source ?? "(source not published)"}</span>
                <span>{report.status ?? "(status not published)"}</span>
                <span>
                  {report.events.length} event{report.events.length === 1 ? "" : "s"}
                </span>
                {report.coalescedCount != null && report.coalescedCount > 0 && (
                  <span>{report.coalescedCount} coalesced</span>
                )}
                {report.omittedCount != null && report.omittedCount > 0 && (
                  <span>{report.omittedCount} omitted</span>
                )}
              </MonitorDeliveryFacts>
            </MonitorDeliveryRow>
          ))}
        </MonitorDeliveryList>
      )}

      {error && <MonitorErrorHint role="alert">{error}</MonitorErrorHint>}
    </MonitorSection>
  );
}

const MonitorSection = styled.section`
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 10px 14px;
  min-height: 0;
  overflow-y: auto;
`;

const MonitorHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const MonitorHeaderTools = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const MonitorTitle = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const MonitorCursorChip = styled.span`
  padding: 1px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-family: var(--forge-mono, monospace);
`;

const MonitorHeaderButton = styled.button`
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

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const MonitorGroupLabel = styled.div`
  padding-top: 4px;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const MonitorChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const MonitorSourceChip = styled.span`
  padding: 1px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-family: var(--forge-mono, monospace);

  &[data-state="available"] {
    color: var(--forge-green, #4fbf6f);
  }

  &[data-state="unavailable"] {
    color: var(--forge-red);
  }

  &[data-state="unknown"] {
    font-style: italic;
  }
`;

const MonitorPolicyRow = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-family: var(--forge-mono, monospace);
`;

const MonitorList = styled.div`
  display: grid;
  gap: 2px;
`;

const MonitorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 7px;
`;

const MonitorRowId = styled.span`
  flex: 0 0 auto;
  max-width: 30%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--forge-text-soft);
  font-family: var(--forge-mono, monospace);
  font-size: 11px;
`;

const MonitorRowFacts = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  color: var(--forge-text-muted);
  font-size: 10px;

  > span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const MonitorRemoveButton = styled.button`
  flex: 0 0 auto;
  padding: 1px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    color: var(--forge-red);
    background: var(--forge-surface-hover);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const MonitorForm = styled.div`
  display: grid;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 8px;
`;

const MonitorFieldRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 10px;
  color: var(--forge-text-muted);

  &[data-wide="true"] {
    align-items: stretch;
    flex-direction: column;
  }

  label {
    flex: 0 0 auto;
  }
`;

const MonitorInput = styled.input`
  flex: 1;
  min-width: 80px;
  padding: 3px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 11px;
  outline: none;

  &:focus {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
  }
`;

const MonitorSelect = styled.select`
  flex: 0 0 auto;
  padding: 2px 4px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 11px;
  outline: none;
`;

const MonitorTextarea = styled.textarea`
  width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 11px;
  font-family: var(--forge-mono, monospace);
  resize: vertical;
  outline: none;

  &:focus {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
  }
`;

const MonitorFormErrors = styled.div`
  display: grid;
  gap: 1px;
  color: var(--forge-red);
  font-size: 10px;
`;

const MonitorFormActions = styled.div`
  display: flex;
  gap: 6px;
`;

const MonitorRegisterButton = styled.button`
  flex: 0 0 auto;
  padding: 2px 10px;
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

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const MonitorDeliveryList = styled.div`
  display: grid;
  gap: 1px;
`;

const MonitorDeliveryRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 8px;
  font-size: 10px;
  color: var(--forge-text-soft);

  > span:first-child {
    flex: 0 0 auto;
    min-width: 28px;
    color: var(--forge-text-muted);
    font-family: var(--forge-mono, monospace);
    text-align: right;
  }
`;

const MonitorDeliveryFacts = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;

  b {
    font-family: var(--forge-mono, monospace);
    font-weight: 600;
  }

  > span {
    color: var(--forge-text-muted);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const MonitorOkHint = styled.div`
  padding: 2px 0;
  color: var(--forge-green, #4fbf6f);
  font-size: 10px;
`;

const MonitorRejectedHint = styled.div`
  padding: 2px 0;
  color: var(--forge-red);
  font-size: 10px;

  b {
    font-family: var(--forge-mono, monospace);
    font-weight: 650;
  }
`;

const MonitorMutedHint = styled.div`
  padding: 2px 0;
  color: var(--forge-text-muted);
  font-size: 10px;
`;

const MonitorErrorHint = styled.div`
  padding: 2px 0;
  color: var(--forge-red);
  font-size: 10px;
`;
