import styled from "styled-components";

import { personaSelectionView } from "./loomModel.js";

/* Session header persona control. Selecting an agent type here is a PERSONA
   BINDING for the session and nothing more: it does not install anything,
   does not prove any CLI is on PATH, does not grant execution, and does not
   scope CLIs — so this control never implies "ready" or "installed". The
   shown value is the daemon's own binding receipt, in THREE distinct states:
   receipt not yet seen = binding UNKNOWN ("Persona unknown" — never claimed
   to be "No persona"); receipt seen with agent_type absent = "No persona";
   receipt seen with an id = that persona. The two placeholders are display
   only — the wire command requires a real agent-type id (there is no
   unbind), so only actual agent types are selectable actions and no null or
   empty id is ever dispatched. */

const PERSONA_TITLE = "Persona binding only — selecting does not install anything, "
  + "does not verify CLI presence, and does not make the agent ready.";

export default function SessionPersonaSelect({
  agentTypes = [],
  binding = undefined,
  onSelect = null,
  sessionId = "",
}) {
  const selection = personaSelectionView(binding);
  const boundId = selection.kind === "bound" ? selection.agentTypeId : null;
  return (
    <PersonaWrap title={PERSONA_TITLE}>
      <PersonaLabel>Persona</PersonaLabel>
      <PersonaSelect
        aria-label="Session persona binding"
        data-binding={selection.kind}
        onChange={(event) => {
          /* Placeholders are not actions: dispatch only a real id. */
          if (!event.target.value) return;
          onSelect?.(sessionId, event.target.value);
        }}
        value={boundId ?? ""}
      >
        {selection.kind !== "bound" && (
          /* Display-only state word, never selectable, never an invoke. */
          <option disabled value="">
            {selection.kind === "unknown" ? "Persona unknown" : "No persona"}
          </option>
        )}
        {agentTypes.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name} ({type.id})
          </option>
        ))}
        {/* The receipt is the authority: a bound id missing from the current
            registry list still renders as itself, never silently dropped. */}
        {boundId != null && !agentTypes.some((type) => type.id === boundId) && (
          <option value={boundId}>{boundId}</option>
        )}
      </PersonaSelect>
    </PersonaWrap>
  );
}

const PersonaWrap = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
`;

const PersonaLabel = styled.span`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const PersonaSelect = styled.select`
  max-width: 140px;
  padding: 2px 4px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 11px;
  font-weight: 550;
  outline: none;
  cursor: pointer;

  &:hover {
    color: var(--forge-text);
  }

  &[data-binding="unknown"] {
    color: var(--forge-text-muted);
  }
`;
