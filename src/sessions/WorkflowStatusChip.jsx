import styled from "styled-components";

/* Session header workflow indicator. DISPLAY-ONLY: it renders what the
   graph_status projection said and dispatches nothing. The shown state has
   FOUR distinct honest values — house law: workflow state comes only from
   graph_status, never derived from the workflows list, a selected
   agent_type, or session lineage:
   - unavailable: the daemon lacks the workflow feature;
   - no statusView seen (no graph_status read for this session) = status
     UNREAD ("Workflow not read" — never claimed to be "No workflow");
   - a read that said none = honestly "No workflow";
   - a read that named a graph = template · phase · current node, with an
     absent current_node simply omitted, never fabricated. */

const WORKFLOW_TITLE = "Workflow state as graph_status reported it — "
  + "display only; nothing here pins, switches, or abandons.";

export default function WorkflowStatusChip({
  statusView = undefined,
  unavailable = false,
}) {
  let kind = "unread";
  let text = "Workflow not read";
  if (unavailable) {
    kind = "unavailable";
    text = "Workflows unavailable";
  } else if (statusView?.kind === "none") {
    /* Only an actual graph_status read may claim "No workflow". */
    kind = "none";
    text = "No workflow";
  } else if (statusView?.kind === "active") {
    kind = "active";
    text = [statusView.template, statusView.phase, statusView.currentNode]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" · ");
    if (!text) text = "(unnamed workflow)";
  }
  return (
    <ChipWrap title={WORKFLOW_TITLE}>
      <ChipLabel>Workflow</ChipLabel>
      <ChipValue aria-label="Session workflow status" data-workflow={kind}>
        {text}
      </ChipValue>
    </ChipWrap>
  );
}

const ChipWrap = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
`;

const ChipLabel = styled.span`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const ChipValue = styled.span`
  max-width: 180px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 2px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 11px;
  font-weight: 550;

  &[data-workflow="unread"],
  &[data-workflow="unavailable"],
  &[data-workflow="none"] {
    color: var(--forge-text-muted);
  }
`;
