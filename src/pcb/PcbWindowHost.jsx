import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import PcbPanel from "./PcbPanel.jsx";

// Routing gate: AppShell renders <PcbWindowHost /> (instead of the full shell)
// when the window's hash starts with this prefix.
export const PCB_WINDOW_HASH = "#/pcb-window";

function parsePcbWindowParams() {
  const hash = typeof window !== "undefined" ? window.location.hash || "" : "";
  const queryIndex = hash.indexOf("?");
  const search = queryIndex >= 0 ? hash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);
  return {
    boardPath: params.get("boardPath") || "",
    repoPath: params.get("repoPath") || "",
    boardName: params.get("boardName") || "",
    tab: params.get("tab") || "pcb",
  };
}

const WindowRoot = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  background: #050b14;
  padding: 8px;
`;

// Standalone host for the popped-out board. The OS window provides the title
// bar + close control; this just mounts a single full-window PcbPanel and keeps
// the workspace watcher running so edits live-reload here too.
export default function PcbWindowHost() {
  const [params] = useState(parsePcbWindowParams);
  const board = useMemo(
    () => ({ path: params.boardPath, name: params.boardName || params.boardPath }),
    [params],
  );

  useEffect(() => {
    if (params.repoPath) {
      invoke("pcb_watch_start", { repoPath: params.repoPath }).catch(() => {});
    }
  }, [params.repoPath]);

  return (
    <WindowRoot>
      <PcbPanel board={board} defaultTab={params.tab} isActive repoPath={params.repoPath} />
    </WindowRoot>
  );
}
