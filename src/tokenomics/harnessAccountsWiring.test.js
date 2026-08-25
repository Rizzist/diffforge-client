import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");

/* Source pins in the repo's established style (see sessionQueueUi.test.js):
   the JSX wiring must route every account decision through the pinned pure
   seams in harnessAccountRoster.js / harnessAccountUsage.js. */

test("the accounts row lists from account_list and re-lists on the pinned roster signal", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /invoke\("account_list", \{ provider: null \}\)/);
  assert.match(view, /invoke\("account_list_watch"\)/);
  assert.match(view, /listen\(HARNESS_ROSTER_CHANGED_EVENT/);
  assert.match(
    view,
    /driveHarnessRosterStartup\(\{[\s\S]{0,500}?registerListener: \(\) => listen\(HARNESS_ROSTER_CHANGED_EVENT[\s\S]{0,900}?attachWatch: \(\) => invoke\("account_list_watch"\),\s*\n\s*takeBaseline: relist,/,
    "production must delegate listener -> watch -> baseline ordering to the pinned startup machine",
  );
  assert.match(
    view,
    /const \{ relist: relistNow \} = harnessRosterApplySignal\(/,
    "the relist decision must come from the pinned signal seam",
  );
  assert.match(
    view,
    /\n\s*if \(relistNow\) relist\(\);/,
    "a roster-changed signal must trigger a re-list — the payload has no roster data (and the statement must be live code, not a comment)",
  );
});

test("account_list responses commit monotonically and never write after deactivation", () => {
  const view = read("AccountTokenomicsView.jsx");
  const hook = view.slice(
    view.indexOf("function useHarnessAccountRoster"),
    view.indexOf("harness account management wiring"),
  );
  assert.match(hook, /const sequence = \+\+listRequestSequenceRef\.current;/);
  assert.match(
    hook,
    /if \(!rosterWritableRef\.current\) return "inactive";\s*\n\s*if \(sequence !== listRequestSequenceRef\.current\) return "superseded";[\s\S]{0,120}?harnessRosterOnListResult/,
    "an older successful response must be dropped before it can overwrite a newer roster",
  );
  assert.match(
    hook,
    /catch \(error\) \{\s*\n\s*if \(!rosterWritableRef\.current\) return "inactive";\s*\n\s*if \(sequence !== listRequestSequenceRef\.current\) return "superseded";/,
    "an older failure must not replace a newer authoritative snapshot",
  );
  assert.match(
    hook,
    /return \(\) => \{\s*\/\*[\s\S]{0,240}?\*\/\s*listRequestSequenceRef\.current \+= 1;\s*\n\s*cancelled = true;/,
    "deactivation/unmount must supersede the prior lifetime's success or error even when listener restart rejects before taking a baseline",
  );
  assert.match(hook, /rosterWritableRef\.current = false;/);
});

test("the excised credential registry is split: historical overlay deleted, usage refresh rewired to roster", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.doesNotMatch(view, /agent_accounts_state/);
  assert.doesNotMatch(view, /agent-accounts-changed/);
  assert.doesNotMatch(view, /useAgentAccountsState/);
  assert.match(view, /\(\) => \(summary \? summaryForMappedNativeDevices\(summary\) : null\)/);
  assert.doesNotMatch(view, /canonicalizeTokenomicsAccountSummary\(summaryForMappedNativeDevices/);
  assert.match(
    view,
    /const revision = rosterState\.revision;[\s\S]{0,350}?previousRevision === revision[\s\S]{0,300}?refreshTokenomicsLiveLimits\(\{\s*\n\s*force: true,\s*\n\s*syncLimitChanges: true,[\s\S]{0,250}?refreshTokenomicsSummaryIfStale\(\{ force: true \}\)/,
    "account_list revision changes replace the removed credential-signature refresh trigger",
  );
});

test("swap wiring is optimistic-NEVER and inactive settlement always clears its local marker", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /setRosterState\(\(prev\) => harnessSwapBegin\(prev, alias\)\);/);
  assert.match(
    view,
    /const result = await invoke\("account_set_active", \{\s*\n\s*alias,\s*\n\s*confirm_new_epoch: Boolean\(confirmNewEpoch\),\s*\n\s*\}\);[\s\S]{0,450}?harnessSwapConfirm\(prev, alias, result\)[\s\S]{0,120}?if \(rosterWritableRef\.current\) void relist\(\);/,
    "success must clear the swap marker and immediately request the authoritative roster",
  );
  assert.match(view, /setRosterState\(\(prev\) => harnessSwapFail\(prev, alias, error\)\);/);
  assert.match(
    view,
    /await invoke\("account_set_active",[\s\S]{0,400}?if \(!rosterMountedRef\.current\) return;[\s\S]{0,400}?harnessSwapConfirm/,
    "unmount drops settlement, while a still-mounted inactive hook clears the local marker",
  );
  assert.match(
    view,
    /catch \(error\) \{\s*\n\s*if \(!rosterMountedRef\.current\) return;\s*\n\s*if \(!rosterWritableRef\.current\) \{\s*\n\s*setRosterState\(\(prev\) => harnessSwapConfirm\(prev\)\);\s*\n\s*return;/,
    "an inactive failed settlement must clear in_flight instead of preserving a permanent block",
  );
  /* No direct descriptor mutation anywhere in the view: active flags come
     exclusively from account_list publications. */
  assert.doesNotMatch(view, /descriptor\.active\s*=/);
  assert.doesNotMatch(view, /\.active = true/);

  const chip = view.slice(
    view.indexOf("function HarnessAccountChipView"),
    view.indexOf("const HarnessAccountChipRow"),
  );
  assert.match(chip, /\$active=\{isActive\}/, "active styling must consume only the daemon-backed isActive projection");
  assert.match(chip, /aria-pressed=\{isActive\}/, "aria-pressed must consume the same old-account projection");
  assert.match(chip, /\{isActive \? <HarnessChipBadge \$accent=\{accent\}>Active<\/HarnessChipBadge> : null\}/);
  assert.doesNotMatch(chip, /\$active=\{isActive\s*\|\|\s*inFlight\}/);
});

test("live-chip accent is the exact provider projection, never source/label/model sniffing", () => {
  const view = read("AccountTokenomicsView.jsx");
  const chip = view.slice(
    view.indexOf("function HarnessAccountChipView"),
    view.indexOf("const HarnessAccountChipRow"),
  );
  assert.match(chip, /const accent = harnessProviderAccent\(provider\);/);
  assert.match(chip, /<HarnessAccountChip\s*\n\s*\$accent=\{accent\}/);
  assert.doesNotMatch(
    chip,
    /\.includes\s*\(/,
    "the live chip boundary must not infer provider identity from source, label, model, or any substring",
  );
});

test("each chip renders the pinned per-account usage and meter tri-states", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /usage=\{harnessAccountUsagePresentation\(harnessHourlyRows, descriptor\?\.alias\)\}/);
  assert.match(view, /meter=\{harnessAccountMeterPresentation\(summary, descriptor\)\}/);
  assert.match(
    view,
    /harnessHourlyRows = useMemo\(\(\) => hourlyRowsForDisplay\(summary\)/,
    "lane matching must read raw summary rows — canonicalization rewrites keys",
  );
  assert.match(
    view,
    /\{usageKnown \? formatTokens\(usage\.totalTokens\) : "—"\}/,
    "an unknown usage figure renders as an em dash, never as 0",
  );
});

test("the roster watch state reaches pixels: live vs possibly-stale snapshot with the reason", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /\{harnessRoster\.watchLive \? "Live" : "Snapshot"\}/);
  assert.match(
    view,
    /Snapshot only — \$\{harnessRoster\.staleReason/,
    "the possibly-stale marker must carry the daemon's reason",
  );
});

test("unsupported, unavailable, empty and unverified render as four distinct facts", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /harnessRoster\.phase === "unsupported"/);
  assert.match(view, /does not support account management \(account_management_v1 is not advertised\)/);
  assert.match(view, /harnessRoster\.phase === "unavailable"/);
  assert.match(view, /harnessRoster\.phase === "empty"/);
  assert.match(view, /No harness accounts yet/);
  assert.match(view, /harnessRoster\.phase === "unverified"/);
});

test("the live roster never derives from the historical sniffed lanes, and vice versa", () => {
  const live = read("harnessAccountRoster.js");
  assert.doesNotMatch(
    live,
    /"codex"|"opencode"|HISTORICAL_ACCOUNT_FILTER_PROVIDERS/,
    "the live roster module must not sniff the excised harness lanes",
  );
  const historical = read("tokenomicsAccountRoster.js");
  assert.doesNotMatch(
    historical,
    /invoke\(|listen\(|account_list\(|"account-roster-changed"/,
    "the historical filter module must never reach for the live roster",
  );
  assert.match(historical, /HISTORICAL account filtering ONLY/);
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /aria-label="Usage history account filters"/);
});
