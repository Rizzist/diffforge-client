import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import styled, { createGlobalStyle } from "styled-components";

import { ActivityOverlayPanel } from "../activity/ActivityOverlay.jsx";
import { useAuthSnapshot } from "../authStore";
import AccountTokenomicsView from "../tokenomics/AccountTokenomicsView.jsx";

const LAST_TAB_STORAGE_KEY = "diffforge.backgroundMonitor.lastTab.v1";
const MONITOR_ANIM_EVENT = "forge-background-monitor-anim";
const MONITOR_OPEN_TAB_EVENT = "forge-background-monitor-open-tab";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function readLastTab() {
  try {
    const stored = text(window.localStorage.getItem(LAST_TAB_STORAGE_KEY));
    return stored === "tokenomics" ? stored : "activity";
  } catch {
    return "activity";
  }
}

export default function BackgroundMonitorWindow() {
  const { accountKey, user } = useAuthSnapshot();
  const [tab, setTabState] = useState(readLastTab);
  const [animPhase, setAnimPhase] = useState("closed");
  const [animOrigin, setAnimOrigin] = useState("top");

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
    let unlistenAnim = null;
    listen(MONITOR_ANIM_EVENT, (event) => {
      if (cancelled) return;
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      const phase = text(payload.phase) === "open" ? "open" : "closed";
      const origin = text(payload.origin) === "bottom" ? "bottom" : "top";
      setAnimOrigin(origin);
      if (phase === "open") {
        // Two-frame open so the closed state paints first and the
        // transition actually animates.
        setAnimPhase("closed");
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setAnimPhase("open"));
        });
      } else {
        setAnimPhase("closed");
      }
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenAnim = unlisten;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlistenAnim) unlistenAnim();
    };
  }, []);

  // Entry points like the dictation bar's History button land the popover on
  // a specific tab (a fresh mount reads the same choice from storage).
  useEffect(() => {
    let cancelled = false;
    let unlistenTab = null;
    listen(MONITOR_OPEN_TAB_EVENT, (event) => {
      if (cancelled) return;
      const nextTab = text(event?.payload?.tab);
      if (nextTab === "activity" || nextTab === "tokenomics") {
        setTab(nextTab);
      }
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenTab = unlisten;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlistenTab) unlistenTab();
    };
  }, [setTab]);

  const returnToApp = useCallback(() => {
    void invoke("app_exit_background").catch(() => {});
  }, []);

  // Snippets is a launcher, not a tab: the strip is its own full-width bar,
  // so the popover dismisses itself and Rust surfaces the strip instead.
  const openSnipStrip = useCallback(() => {
    void invoke("background_monitor_open_snip_strip").catch(() => {});
  }, []);

  return (
    <MonitorViewport>
      <MonitorGlobalStyle />
      <MonitorShell data-anim={animPhase} data-origin={animOrigin}>
        <MonitorHeader>
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
          <MonitorTabButton
            data-active="false"
            onClick={openSnipStrip}
            title="Close this popover and show the recent-snips bar"
            type="button"
          >
            Snippets
          </MonitorTabButton>
        </MonitorTabs>

        <MonitorFill>
          {tab === "tokenomics" ? (
            <AccountTokenomicsView accountKey={accountKey || user?.id || user?.email || ""} />
          ) : (
            <MonitorActivityHost>
              <ActivityOverlayPanel embedded />
            </MonitorActivityHost>
          )}
        </MonitorFill>
      </MonitorShell>
    </MonitorViewport>
  );
}

const MonitorGlobalStyle = createGlobalStyle`
  html,
  body,
  #app {
    height: 100%;
    margin: 0;
    background: transparent !important;
  }

  /* The embedded panels (Activity, Tokenomics) are written for the main
     app's border-box world; without this their "width: 100% + padding"
     surfaces overflow the popover and clip on the right. */
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

const MonitorViewport = styled.div`
  box-sizing: border-box;
  height: 100vh;
  padding: 8px;
  overflow: hidden;
  background: transparent;
`;

const MonitorShell = styled.div`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  box-sizing: border-box;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 14px;
  color: #f4f7fa;
  background: rgba(7, 10, 15, 0.98);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
  transform-origin: top center;
  transition:
    opacity 160ms ease,
    transform 190ms cubic-bezier(0.2, 0.9, 0.3, 1.15);
  will-change: opacity, transform;

  &[data-origin="bottom"] {
    transform: translateY(8px) scale(0.97);
    transform-origin: bottom center;
  }

  &[data-anim="open"],
  &[data-anim="open"][data-origin="bottom"] {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const MonitorFill = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid rgba(230, 236, 245, 0.08);
  margin-top: -1px;
`;

const MonitorActivityHost = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(13, 16, 22, 0.65), rgba(7, 10, 15, 0.2));
`;

const MonitorHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);

  div {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  strong {
    overflow: hidden;
    font-size: 14px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: #7a8493;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 280px) {
    gap: 8px;
    padding: 10px 10px;

    span {
      display: none;
    }
  }
`;

const ReturnButton = styled.button`
  flex: 0 0 auto;
  padding: 7px 13px;
  border: 1px solid rgba(125, 176, 255, 0.36);
  border-radius: 8px;
  color: rgba(200, 222, 255, 0.98);
  background: rgba(59, 130, 246, 0.18);
  font-size: 12px;
  font-weight: 750;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: rgba(59, 130, 246, 0.3);
  }

  @media (max-width: 280px) {
    padding: 6px 9px;
    font-size: 11px;
  }
`;

const MonitorTabs = styled.nav`
  display: flex;
  gap: 2px;
  min-width: 0;
  padding: 8px 14px 0;

  @media (max-width: 280px) {
    padding: 8px 10px 0;
  }
`;

const MonitorTabButton = styled.button`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 7px 14px;
  border: 1px solid transparent;
  border-radius: 8px 8px 0 0;
  color: #7a8493;
  background: transparent;
  font-size: 12px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &[data-active="true"] {
    color: #f4f7fa;
    border-color: rgba(230, 236, 245, 0.1);
    border-bottom-color: transparent;
    background: rgba(13, 17, 23, 0.7);
  }

  @media (max-width: 280px) {
    padding: 7px 8px;
    font-size: 11px;
  }
`;
