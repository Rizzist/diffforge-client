// Tri-state honesty for ledger-derived pixels in the tokenomics views.
//
// The rollup views only publish rows where usage was recorded, so "no rows"
// reaches the UI for both an uncovered day and a covered day with nothing
// recorded. What the UI must never do is dress that absence up as an
// authoritative measured zero, or dress a pre-ledger archive row up as
// harness ledger truth. These helpers make each decision pure and pinnable.

export const TOKENOMICS_ARCHIVE_HISTORY_SOURCE = "pre_ledger_archive";

export function tokenomicsLedgerAuthority(summary) {
  const authority = summary?.ledger_authority;
  const state = String(authority?.state || "unknown").trim().toLowerCase();
  return {
    state,
    reason: String(authority?.reason || "").trim(),
  };
}

/* One period cell (Today / Last 30 Days). A summed value over recorded rows
   is a fact. Zero rows is a fact ("nothing recorded") ONLY while the ledger
   authority is available; with the authority unavailable/unknown, rendering
   0 would fabricate absence into a measured value — the cell is unknown. */
export function tokenomicsPeriodCellValue(value, rowCount, ledgerAuthority) {
  if (rowCount > 0) return { known: true, value };
  if (String(ledgerAuthority?.state || "") === "available") {
    return { known: true, value };
  }
  return {
    known: false,
    value: null,
    reason: ledgerAuthority?.reason || "usage history authority is not available",
  };
}

export function tokenomicsDailyBucketRowsAreArchive(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.length > 0 && list.every(
    (row) => String(row?.history_source || "") === TOKENOMICS_ARCHIVE_HISTORY_SOURCE,
  );
}

/* One daily chart column.
   - kind "no_data": the window generated this calendar day but no rows exist
     for it — there is NO recorded reading, and the column must not present a
     measured "0 tokens" total.
   - kind "usage": recorded rows exist (a genuine zero total stays "usage" —
     sampled zero is a reading).
   archive marks a day whose rows all come from the pre-ledger archive. */
export function tokenomicsDailyBucketPresentation(bucket) {
  const rows = Array.isArray(bucket?.rows) ? bucket.rows : [];
  if (!rows.length) return { kind: "no_data", archive: false };
  return { kind: "usage", archive: tokenomicsDailyBucketRowsAreArchive(rows) };
}

export function tokenomicsDailyBucketTitle(bucket, presentation, usageTitle) {
  if (presentation.kind === "no_data") {
    return `${bucket?.titleLabel || bucket?.label || bucket?.key || "Day"}: no usage recorded`;
  }
  return presentation.archive ? `${usageTitle} · pre-ledger archive` : usageTitle;
}
