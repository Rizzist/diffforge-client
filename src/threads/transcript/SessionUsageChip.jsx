// Compact session-level usage total for the panel header. Renders nothing
// unless session-level stats (or turn_summary usage records) exist in state.

import { memo, useMemo } from "react";

import {
  formatTokensCompact,
  sessionUsageTotals,
  usageTooltip,
  usageTotalTokens,
} from "./builders.mjs";
import { UsageChip } from "./styles";

export const SessionUsageChip = memo(function SessionUsageChip({ stats = null, messages = [] }) {
  const totals = useMemo(() => sessionUsageTotals({ stats, messages }), [messages, stats]);
  const totalTokens = usageTotalTokens(totals);
  if (!totalTokens) return null;
  const tooltip = usageTooltip(totals);
  return (
    <UsageChip title={tooltip || undefined}>
      <b>{formatTokensCompact(totalTokens)}</b>
      tokens
      {Number.isFinite(totals?.costUsd) ? <b>${totals.costUsd.toFixed(2)}</b> : null}
    </UsageChip>
  );
});
