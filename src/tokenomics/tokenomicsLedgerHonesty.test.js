import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tokenomicsDailyBucketPresentation,
  tokenomicsDailyBucketRowsAreArchive,
  tokenomicsDailyBucketTitle,
  tokenomicsLedgerAuthority,
  tokenomicsPeriodCellValue,
} from "./tokenomicsLedgerHonesty.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");

test("an empty period is 0 only under an available ledger authority — otherwise unknown", () => {
  const available = { state: "available", reason: "" };
  assert.deepEqual(tokenomicsPeriodCellValue(0, 0, available), { known: true, value: 0 });
  assert.deepEqual(tokenomicsPeriodCellValue(1234, 3, { state: "unknown" }), { known: true, value: 1234 });

  for (const authority of [
    { state: "unknown", reason: "history_not_requested" },
    { state: "unavailable", reason: "daemon offline" },
    { state: "unsupported", reason: "" },
  ]) {
    const cell = tokenomicsPeriodCellValue(0, 0, authority);
    assert.equal(cell.known, false, `${authority.state} with no rows must be unknown`);
    assert.equal(cell.value, null, "an unknown cell carries no number");
  }
  assert.equal(
    tokenomicsPeriodCellValue(0, 0, { state: "unavailable", reason: "daemon offline" }).reason,
    "daemon offline",
  );
});

test("ledger authority reads verbatim and defaults to unknown, never to available", () => {
  assert.deepEqual(
    tokenomicsLedgerAuthority({ ledger_authority: { state: "available" } }),
    { state: "available", reason: "" },
  );
  assert.deepEqual(tokenomicsLedgerAuthority({}), { state: "unknown", reason: "" });
  assert.deepEqual(tokenomicsLedgerAuthority(null), { state: "unknown", reason: "" });
});

test("a day without rows is no_data; a recorded zero stays a measured reading", () => {
  assert.deepEqual(
    tokenomicsDailyBucketPresentation({ rows: [] }),
    { kind: "no_data", archive: false },
  );
  assert.deepEqual(
    tokenomicsDailyBucketPresentation({ rows: [{ history_source: "usage_history_v1", total_tokens: 0 }] }),
    { kind: "usage", archive: false },
  );
});

test("archive labelling: only a bucket whose rows are all pre-ledger archive is archive", () => {
  const archiveRow = { history_source: "pre_ledger_archive" };
  const ledgerRow = { history_source: "usage_history_v1" };
  assert.equal(tokenomicsDailyBucketRowsAreArchive([archiveRow, archiveRow]), true);
  assert.equal(tokenomicsDailyBucketRowsAreArchive([archiveRow, ledgerRow]), false);
  assert.equal(tokenomicsDailyBucketRowsAreArchive([]), false, "no rows is absence, not archive");
  assert.deepEqual(
    tokenomicsDailyBucketPresentation({ rows: [archiveRow] }),
    { kind: "usage", archive: true },
  );
});

test("daily titles: no_data says no usage recorded, archive appends its label", () => {
  const bucket = { key: "2026-08-20", label: "W", titleLabel: "Wednesday, Aug 20" };
  assert.equal(
    tokenomicsDailyBucketTitle(bucket, { kind: "no_data", archive: false }, "unused"),
    "Wednesday, Aug 20: no usage recorded",
  );
  assert.equal(
    tokenomicsDailyBucketTitle(bucket, { kind: "usage", archive: true }, "Wednesday: total 5K"),
    "Wednesday: total 5K · pre-ledger archive",
  );
  assert.equal(
    tokenomicsDailyBucketTitle(bucket, { kind: "usage", archive: false }, "Wednesday: total 5K"),
    "Wednesday: total 5K",
  );
});

/* ---- source pins: the view actually routes pixels through these decisions
   (JSX wiring in the repo's established source-regex style) ---- */

test("the usage table renders through the pinned period tri-state, not raw sums", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /periodRowCells\(today, ledgerAuthority\)/);
  assert.match(view, /periodRowCells\(last30Days, ledgerAuthority\)/);
  assert.match(view, /tokenomicsPeriodCellValue\(/);
  /* Anchored per cell: TokenCell and CostCell are near-identical, so a
     shared regex would let one keep the pin green while the other regresses
     into formatting null as 0. */
  assert.match(
    view,
    /function TokenCell\(\{ value, unknown_reason: unknownReason = "" \}\) \{\s*\n\s*if \(value == null\) \{\s*\n\s*return <td title=\{unknownReason/,
    "TokenCell must render unknown as an em dash cell, never format null into 0",
  );
  assert.match(
    view,
    /function CostCell\(\{ value, unknown_reason: unknownReason = "" \}\) \{\s*\n\s*if \(value == null\) \{\s*\n\s*return <td title=\{unknownReason/,
    "CostCell must render unknown as an em dash cell, never format null into $0.00",
  );
  assert.doesNotMatch(
    view,
    /<TokenCell value=\{today\.input\} \/>/,
    "the Today row must not bypass the tri-state seam",
  );
});

test("daily columns render through the pinned bucket tri-state with the archive label", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /tokenomicsDailyBucketPresentation\(row\)/);
  assert.match(view, /tokenomicsDailyBucketTitle\(/);
  assert.match(view, /\$noData=\{noData \? true : undefined\}/);
  assert.match(
    view,
    /rows: match\?\.rows \|\| \[\]/,
    "daily buckets must retain their source rows for the tri-state decision",
  );
});
