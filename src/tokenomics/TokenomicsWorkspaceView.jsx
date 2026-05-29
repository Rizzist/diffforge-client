import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

const PROVIDER_LABELS = {
  anthropic: "Claude Code",
  claude: "Claude Code",
  openai: "Codex",
  codex: "Codex",
  opencode: "OpenCode",
};

function formatTokens(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(Math.round(number));
}

function formatCost(microusd) {
  const value = Number(microusd || 0) / 1_000_000;
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

function formatCredits(value) {
  return formatTokens(value);
}

function providerLabel(row) {
  const key = String(row?.agent_kind || row?.agentKind || row?.provider || "").toLowerCase();
  return PROVIDER_LABELS[key] || PROVIDER_LABELS[String(row?.provider || "").toLowerCase()] || row?.provider || "Agent";
}

export default function TokenomicsWorkspaceView({ billingStatus = null } = {}) {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const refresh = useCallback(async ({ scan = false } = {}) => {
    setStatus(scan ? "scanning" : "loading");
    setError("");
    try {
      const next = scan
        ? await invoke("tokenomics_scan_usage")
        : await invoke("tokenomics_get_summary");
      setSummary(next || {});
      setStatus("ready");
    } catch (caught) {
      setError(caught?.message || String(caught || "Unable to load Tokenomics."));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const next = await invoke("tokenomics_get_summary");
        if (!disposed) {
          setSummary(next || {});
          setStatus("ready");
        }
      } catch (caught) {
        if (!disposed) {
          setError(caught?.message || String(caught || "Unable to load Tokenomics."));
          setStatus("error");
        }
      }
    };
    load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  const total = summary?.total || {};
  const providers = Array.isArray(summary?.by_provider) ? summary.by_provider : [];
  const daily = Array.isArray(summary?.daily) ? [...summary.daily].reverse() : [];
  const maxDaily = Math.max(1, ...daily.map((row) => Number(row.total_tokens || row.totalTokens || 0)));
  const sources = Array.isArray(summary?.scan?.sources) ? summary.scan.sources : summary?.sources || [];
  const credits = billingStatus?.credits || summary?.credits || {};

  const providerTotal = useMemo(() => (
    providers.reduce((sum, row) => sum + Number(row.total_tokens || row.totalTokens || 0), 0)
  ), [providers]);

  return (
    <TokenomicsSurface>
      <TokenomicsHeader>
        <div>
          <TokenomicsKicker>Tokenomics</TokenomicsKicker>
          <TokenomicsTitle>Usage Across Agents</TokenomicsTitle>
        </div>
        <TokenomicsActionRow>
          <TokenomicsButton disabled={status === "scanning"} onClick={() => refresh({ scan: true })} type="button">
            {status === "scanning" ? "Scanning" : "Rescan"}
          </TokenomicsButton>
        </TokenomicsActionRow>
      </TokenomicsHeader>

      {error ? <TokenomicsError>{error}</TokenomicsError> : null}

      <TokenomicsStats>
        <TokenomicsStat>
          <span>Total Tokens</span>
          <strong>{formatTokens(total.total_tokens || total.totalTokens)}</strong>
        </TokenomicsStat>
        <TokenomicsStat>
          <span>Input</span>
          <strong>{formatTokens(total.input_tokens || total.inputTokens)}</strong>
        </TokenomicsStat>
        <TokenomicsStat>
          <span>Output</span>
          <strong>{formatTokens(total.output_tokens || total.outputTokens)}</strong>
        </TokenomicsStat>
        <TokenomicsStat>
          <span>Cost</span>
          <strong>{formatCost(total.estimated_cost_microusd || total.estimatedCostMicrousd)}</strong>
        </TokenomicsStat>
      </TokenomicsStats>

      <TokenomicsPanel>
        <PanelHeader>
          <h3>Providers</h3>
          <span>{providers.length || 0} tracked</span>
        </PanelHeader>
        <ProviderList>
          {providers.length ? providers.map((row) => {
            const tokens = Number(row.total_tokens || row.totalTokens || 0);
            const pct = providerTotal > 0 ? Math.max(4, Math.round((tokens / providerTotal) * 100)) : 0;
            return (
              <ProviderRow key={`${row.provider}-${row.agent_kind}`}>
                <ProviderMeta>
                  <strong>{providerLabel(row)}</strong>
                  <span>{row.provider || "provider"} · {row.agent_kind || row.agentKind || "agent"}</span>
                </ProviderMeta>
                <ProviderBar aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </ProviderBar>
                <ProviderTokens>{formatTokens(tokens)}</ProviderTokens>
              </ProviderRow>
            );
          }) : (
            <TokenomicsEmpty>
              Tokenomics is ready. Rescan after using Claude Code, Codex, or OpenCode to populate local usage.
            </TokenomicsEmpty>
          )}
        </ProviderList>
      </TokenomicsPanel>

      <TokenomicsPanel>
        <PanelHeader>
          <h3>Daily Usage</h3>
          <span>{daily.length ? "recent buckets" : "waiting"}</span>
        </PanelHeader>
        <DailyBars>
          {daily.length ? daily.map((row) => {
            const tokens = Number(row.total_tokens || row.totalTokens || 0);
            return (
              <DailyBar key={row.bucket_start || row.bucketStart}>
                <span style={{ height: `${Math.max(8, Math.round((tokens / maxDaily) * 100))}%` }} />
                <small>{String(row.bucket_start || row.bucketStart || "").slice(5) || "-"}</small>
              </DailyBar>
            );
          }) : (
            <TokenomicsEmpty>Daily graph appears as usage rolls in.</TokenomicsEmpty>
          )}
        </DailyBars>
      </TokenomicsPanel>

      <TokenomicsPanel>
        <PanelHeader>
          <h3>Diff Forge Credits</h3>
          <span>{credits?.planName || credits?.term?.plan_name || "account"}</span>
        </PanelHeader>
        <TokenomicsStats>
          <TokenomicsStat>
            <span>Used</span>
            <strong>{formatCredits(credits.termUsedCredits ?? credits.used_credits ?? credits.total?.used_credits)}</strong>
          </TokenomicsStat>
          <TokenomicsStat>
            <span>Remaining</span>
            <strong>{formatCredits(credits.termRemainingCredits ?? credits.remaining_credits ?? credits.total?.remaining_credits)}</strong>
          </TokenomicsStat>
          <TokenomicsStat>
            <span>Total</span>
            <strong>{formatCredits(credits.termTotalCredits ?? credits.total_credits ?? credits.total?.total_credits)}</strong>
          </TokenomicsStat>
          <TokenomicsStat>
            <span>Reserved</span>
            <strong>{formatCredits(credits.termReservedCredits ?? credits.reserved_credits ?? credits.total?.reserved_credits)}</strong>
          </TokenomicsStat>
        </TokenomicsStats>
      </TokenomicsPanel>

      <SourceGrid>
        {sources.map((source) => (
          <SourceCard key={`${source.provider}-${source.agent_kind}`}>
            <strong>{providerLabel(source)}</strong>
            <span>{source.status || "watching"}</span>
          </SourceCard>
        ))}
      </SourceGrid>
    </TokenomicsSurface>
  );
}

const TokenomicsSurface = styled.section`
  display: grid;
  height: 100%;
  min-height: 0;
  gap: 14px;
  padding: 18px;
  color: #e8eef8;
  overflow: auto;
`;

const TokenomicsHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const TokenomicsKicker = styled.div`
  color: #7f8ba1;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
`;

const TokenomicsTitle = styled.h2`
  margin: 4px 0 0;
  color: #f6f8fc;
  font-size: 22px;
  line-height: 1.1;
`;

const TokenomicsActionRow = styled.div`
  display: flex;
  gap: 8px;
`;

const TokenomicsButton = styled.button`
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(98, 160, 255, 0.42);
  border-radius: 8px;
  color: #7db1ff;
  background: rgba(98, 160, 255, 0.12);
  font: inherit;
  font-size: 12px;
  font-weight: 900;
`;

const TokenomicsError = styled.div`
  padding: 10px 12px;
  border: 1px solid rgba(255, 97, 107, 0.34);
  border-radius: 8px;
  color: #ff858d;
  background: rgba(255, 97, 107, 0.09);
`;

const TokenomicsStats = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 780px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const TokenomicsStat = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);

  span {
    color: #909bad;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  strong {
    color: #62a0ff;
    font-size: 24px;
    line-height: 1;
  }
`;

const TokenomicsPanel = styled.div`
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.026);
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  h3 {
    margin: 0;
    color: #f6f8fc;
    font-size: 15px;
  }

  span {
    color: #7f8ba1;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
`;

const ProviderList = styled.div`
  display: grid;
  gap: 9px;
`;

const ProviderRow = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(90px, 1.5fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

const ProviderMeta = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  strong {
    overflow: hidden;
    color: #f6f8fc;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: #8c97aa;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ProviderBar = styled.div`
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(230, 236, 245, 0.1);

  span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #36d675, #62a0ff);
  }
`;

const ProviderTokens = styled.div`
  color: #dfe7f5;
  font-size: 13px;
  font-weight: 900;
  text-align: right;
`;

const DailyBars = styled.div`
  display: grid;
  grid-template-columns: repeat(14, minmax(18px, 1fr));
  align-items: end;
  gap: 7px;
  min-height: 140px;
`;

const DailyBar = styled.div`
  display: grid;
  align-items: end;
  gap: 6px;
  height: 140px;

  span {
    display: block;
    min-height: 8px;
    border-radius: 6px 6px 3px 3px;
    background: linear-gradient(180deg, #62a0ff, #36d675);
  }

  small {
    overflow: hidden;
    color: #8794a8;
    font-size: 10px;
    font-weight: 800;
    text-align: center;
    white-space: nowrap;
  }
`;

const SourceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
`;

const SourceCard = styled.div`
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(98, 160, 255, 0.26);
  border-radius: 8px;
  background: rgba(98, 160, 255, 0.08);

  strong {
    color: #f6f8fc;
    font-size: 13px;
  }

  span {
    color: #94a1b7;
    font-size: 12px;
  }
`;

const TokenomicsEmpty = styled.div`
  padding: 14px;
  border: 1px dashed rgba(230, 236, 245, 0.16);
  border-radius: 8px;
  color: #9ba7ba;
  font-size: 13px;
  line-height: 1.5;
`;
