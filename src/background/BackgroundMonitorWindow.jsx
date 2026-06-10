import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle } from "styled-components";

const LAST_TAB_STORAGE_KEY = "diffforge.backgroundMonitor.lastTab.v1";
const ASSETS_UPDATED_EVENT = "cloud-mcp-workspace-assets-updated";
const RECEIPTS_UPDATED_EVENT = "todo-dispatch-receipts-updated";
const TODO_BUCKETS = [
  { id: "running", label: "Running" },
  { id: "queued", label: "Queued" },
  { id: "listed", label: "Listed" },
];

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function readLastTab() {
  try {
    const stored = text(window.localStorage.getItem(LAST_TAB_STORAGE_KEY));
    return stored === "activity" ? "activity" : "tokenomics";
  } catch {
    return "tokenomics";
  }
}

function formatTokens(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatClock(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function assetEventLabel(payload = {}) {
  const kind = text(payload.event_kind || payload.eventKind || payload.kind, "asset update")
    .replace(/^workspace_asset_/, "")
    .replace(/_/g, " ");
  const name = text(
    payload.asset_name
      || payload.assetName
      || payload.file_name
      || payload.fileName
      || payload.name
      || payload.asset_id
      || payload.assetId,
  );
  const transferred = Number(payload.transferred_bytes || payload.transferredBytes || 0);
  const total = Number(payload.total_bytes || payload.totalBytes || 0);
  const percent = Number(payload.percent || payload.progress || 0);
  const progress = total > 0
    ? `${Math.min(100, Math.round((transferred / total) * 100))}%`
    : percent > 0
      ? `${Math.min(100, Math.round(percent <= 1 ? percent * 100 : percent))}%`
      : "";
  return [name, kind, progress].filter(Boolean).join(" · ") || kind;
}

export default function BackgroundMonitorWindow() {
  const [tab, setTabState] = useState(readLastTab);
  const [overview, setOverview] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [assetFeed, setAssetFeed] = useState([]);
  const assetFeedSeqRef = useRef(0);

  const setTab = useCallback((nextTab) => {
    setTabState(nextTab);
    try {
      window.localStorage.setItem(LAST_TAB_STORAGE_KEY, nextTab);
    } catch {
      // Tab memory is convenience state only.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshOverview = () => {
      invoke("todo_dispatch_overview")
        .then((result) => {
          if (!cancelled) setOverview(result || null);
        })
        .catch(() => {});
    };
    refreshOverview();
    const intervalId = window.setInterval(refreshOverview, 3000);
    let unlistenReceipts = null;
    listen(RECEIPTS_UPDATED_EVENT, refreshOverview)
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenReceipts = unlisten;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (unlistenReceipts) unlistenReceipts();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshSummary = () => {
      invoke("tokenomics_get_summary")
        .then((result) => {
          if (cancelled) return;
          setSummary(result || null);
          setSummaryError("");
        })
        .catch((error) => {
          if (cancelled) return;
          setSummaryError(error?.message || String(error || "Unable to load Tokenomics."));
        });
    };
    refreshSummary();
    const intervalId = window.setInterval(refreshSummary, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenAssets = null;
    listen(ASSETS_UPDATED_EVENT, (event) => {
      if (cancelled) return;
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      assetFeedSeqRef.current += 1;
      const entry = {
        atMs: Date.now(),
        id: `asset-${assetFeedSeqRef.current}`,
        label: assetEventLabel(payload),
      };
      setAssetFeed((current) => [entry, ...current].slice(0, 12));
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenAssets = unlisten;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlistenAssets) unlistenAssets();
    };
  }, []);

  const returnToApp = useCallback(() => {
    void invoke("app_exit_background").catch(() => {});
  }, []);

  const todoGroups = useMemo(() => {
    const groups = new Map(TODO_BUCKETS.map((bucket) => [bucket.id, []]));
    const workspaces = Array.isArray(overview?.workspaces) ? overview.workspaces : [];
    workspaces.forEach((workspace) => {
      const workspaceLabel = text(workspace?.workspaceName)
        || text(workspace?.workspaceId).slice(0, 18);
      (Array.isArray(workspace?.items) ? workspace.items : []).forEach((item) => {
        const bucket = text(item?.bucket);
        if (!groups.has(bucket)) return;
        groups.get(bucket).push({
          id: text(item?.id, `${workspaceLabel}-${groups.get(bucket).length}`),
          status: text(item?.status),
          text: text(item?.text, "Untitled todo"),
          workspaceLabel,
        });
      });
    });
    return groups;
  }, [overview]);

  const dailyRows = useMemo(() => {
    const rows = Array.isArray(summary?.daily) ? summary.daily : [];
    return rows
      .map((row) => ({
        bucket: text(row?.bucket_start || row?.bucketStart),
        tokens: Number(row?.total_tokens || row?.totalTokens || 0),
      }))
      .filter((row) => row.bucket)
      .slice(-7)
      .reverse();
  }, [summary]);
  const todayTokens = dailyRows.length ? dailyRows[0].tokens : 0;
  const weekTokens = dailyRows.reduce((sum, row) => sum + row.tokens, 0);
  const maxDailyTokens = Math.max(1, ...dailyRows.map((row) => row.tokens));

  return (
    <MonitorShell>
      <MonitorGlobalStyle />
      <MonitorHeader data-tauri-drag-region="true">
        <div>
          <strong>Diff Forge</strong>
          <span>Running in background</span>
        </div>
        <ReturnButton onClick={returnToApp} title="Show the main Diff Forge window" type="button">
          Return to app
        </ReturnButton>
      </MonitorHeader>
      <MonitorTabs role="tablist">
        <MonitorTabButton
          data-active={tab === "tokenomics" ? "true" : "false"}
          onClick={() => setTab("tokenomics")}
          role="tab"
          type="button"
        >
          Tokenomics
        </MonitorTabButton>
        <MonitorTabButton
          data-active={tab === "activity" ? "true" : "false"}
          onClick={() => setTab("activity")}
          role="tab"
          type="button"
        >
          Activity
        </MonitorTabButton>
      </MonitorTabs>

      {tab === "tokenomics" ? (
        <MonitorBody>
          <MonitorStatRow>
            <MonitorStat>
              <span>Today</span>
              <strong>{formatTokens(todayTokens)}</strong>
              <em>tokens</em>
            </MonitorStat>
            <MonitorStat>
              <span>Last 7 days</span>
              <strong>{formatTokens(weekTokens)}</strong>
              <em>tokens</em>
            </MonitorStat>
          </MonitorStatRow>
          {summaryError && <MonitorNotice>{summaryError}</MonitorNotice>}
          <MonitorSectionLabel>Daily usage</MonitorSectionLabel>
          {dailyRows.length ? (
            <MonitorBars>
              {dailyRows.map((row) => (
                <MonitorBarRow key={row.bucket}>
                  <span>{row.bucket.slice(5)}</span>
                  <MonitorBarTrack>
                    <MonitorBarFill style={{ width: `${Math.max(2, Math.round((row.tokens / maxDailyTokens) * 100))}%` }} />
                  </MonitorBarTrack>
                  <em>{formatTokens(row.tokens)}</em>
                </MonitorBarRow>
              ))}
            </MonitorBars>
          ) : (
            <MonitorEmpty>No usage recorded yet.</MonitorEmpty>
          )}
        </MonitorBody>
      ) : (
        <MonitorBody>
          {TODO_BUCKETS.map((bucket) => {
            const items = todoGroups.get(bucket.id) || [];
            return (
              <section key={bucket.id}>
                <MonitorSectionLabel data-bucket={bucket.id}>
                  {bucket.label}
                  <em>{items.length}</em>
                </MonitorSectionLabel>
                {items.length ? (
                  items.slice(0, 12).map((item) => (
                    <MonitorTodoRow data-bucket={bucket.id} key={item.id}>
                      <p title={item.text}>{item.text}</p>
                      <span>{item.workspaceLabel}</span>
                    </MonitorTodoRow>
                  ))
                ) : (
                  <MonitorEmpty>None</MonitorEmpty>
                )}
              </section>
            );
          })}
          <MonitorSectionLabel>Asset transfers</MonitorSectionLabel>
          {assetFeed.length ? (
            assetFeed.map((entry) => (
              <MonitorAssetRow key={entry.id}>
                <p>{entry.label}</p>
                <time>{formatClock(entry.atMs)}</time>
              </MonitorAssetRow>
            ))
          ) : (
            <MonitorEmpty>No recent uploads or downloads.</MonitorEmpty>
          )}
        </MonitorBody>
      )}
    </MonitorShell>
  );
}

const MonitorGlobalStyle = createGlobalStyle`
  html,
  body,
  #app {
    height: 100%;
    margin: 0;
    background: #07090d;
  }
`;

const MonitorShell = styled.div`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  color: #f4f7fa;
  background: #07090d;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
`;

const MonitorHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);

  div {
    display: grid;
    gap: 1px;
  }

  strong {
    font-size: 14px;
    font-weight: 800;
  }

  span {
    color: #7a8493;
    font-size: 11px;
  }
`;

const ReturnButton = styled.button`
  padding: 7px 13px;
  border: 1px solid rgba(125, 176, 255, 0.36);
  border-radius: 8px;
  color: rgba(200, 222, 255, 0.98);
  background: rgba(59, 130, 246, 0.18);
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;

  &:hover {
    background: rgba(59, 130, 246, 0.3);
  }
`;

const MonitorTabs = styled.nav`
  display: flex;
  gap: 2px;
  padding: 8px 14px 0;
`;

const MonitorTabButton = styled.button`
  padding: 7px 14px;
  border: 1px solid transparent;
  border-radius: 8px 8px 0 0;
  color: #7a8493;
  background: transparent;
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;

  &[data-active="true"] {
    color: #f4f7fa;
    border-color: rgba(230, 236, 245, 0.1);
    border-bottom-color: transparent;
    background: rgba(13, 17, 23, 0.7);
  }
`;

const MonitorBody = styled.main`
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 18px;
  border-top: 1px solid rgba(230, 236, 245, 0.08);
  margin-top: -1px;
`;

const MonitorSectionLabel = styled.h3`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 2px;
  color: rgba(148, 163, 184, 0.85);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  em {
    color: rgba(148, 163, 184, 0.6);
    font-style: normal;
  }

  &[data-bucket="running"] {
    color: rgba(94, 234, 212, 0.9);
  }

  &[data-bucket="queued"] {
    color: rgba(125, 176, 255, 0.9);
  }
`;

const MonitorTodoRow = styled.div`
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-left: 3px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.55);

  &[data-bucket="running"] {
    border-left-color: rgba(94, 234, 212, 0.7);
  }

  &[data-bucket="queued"] {
    border-left-color: rgba(125, 176, 255, 0.7);
  }

  p {
    margin: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: 12px;
    line-height: 1.35;
  }

  span {
    color: #7a8493;
    font-size: 10px;
    font-weight: 650;
  }
`;

const MonitorAssetRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.45);

  p {
    margin: 0;
    overflow: hidden;
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  time {
    color: #7a8493;
    flex: 0 0 auto;
    font-size: 10px;
  }
`;

const MonitorStatRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`;

const MonitorStat = styled.div`
  display: grid;
  gap: 2px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.6);

  span {
    color: #7a8493;
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  strong {
    font-size: 22px;
    font-weight: 800;
  }

  em {
    color: #7a8493;
    font-size: 10px;
    font-style: normal;
  }
`;

const MonitorBars = styled.div`
  display: grid;
  gap: 6px;
`;

const MonitorBarRow = styled.div`
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 52px;
  align-items: center;
  gap: 8px;

  span {
    color: #7a8493;
    font-size: 10px;
    font-weight: 700;
  }

  em {
    color: rgba(226, 232, 240, 0.9);
    font-size: 10.5px;
    font-style: normal;
    font-weight: 750;
    text-align: right;
  }
`;

const MonitorBarTrack = styled.div`
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  overflow: hidden;
`;

const MonitorBarFill = styled.div`
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(94, 234, 212, 0.8), rgba(59, 130, 246, 0.8));
`;

const MonitorNotice = styled.p`
  margin: 0;
  padding: 7px 10px;
  border: 1px solid rgba(223, 165, 90, 0.3);
  border-radius: 8px;
  color: rgba(240, 200, 140, 0.95);
  background: rgba(63, 38, 10, 0.3);
  font-size: 11px;
`;

const MonitorEmpty = styled.p`
  margin: 0;
  color: #5b6472;
  font-size: 11.5px;
`;
