import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KeyboardArrowLeft } from "@styled-icons/material-rounded/KeyboardArrowLeft";
import styled from "styled-components";
import { createWorkspaceDisplayIdentity } from "../workspace/workspaceDisplayIdentity.js";
import GraphRendererHost from "./renderers/GraphRendererHost.jsx";
import {
  field,
  freshnessLabel,
  graphRootNode,
  isLeasedFileNode,
  isLocalOnlyNode,
  isUnspecifiedStructuralNode,
  isWorktreeFileNode,
  mergeLocalIgnoredOverlay,
  normalizeSnapshot,
  selectedFallback,
  splitSpecHistory,
  text,
} from "./specGraphCore.js";

const SPEC_GRAPH_CACHE_EVENT = "cloud-mcp-spec-graph-cache";

export default function SpecGraphWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "";
  const repoPath = workspaceId ? rootDirectory || defaultWorkingDirectory || "" : "";
  const workspaceDisplayIdentity = useMemo(
    () => createWorkspaceDisplayIdentity(repoPath, workspaceName || "Workspace"),
    [repoPath, workspaceName],
  );
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [state, setState] = useState("idle");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [showLocalIgnored, setShowLocalIgnored] = useState(false);
  const [localIgnoredOverlay, setLocalIgnoredOverlay] = useState(null);
  const [localIgnoredState, setLocalIgnoredState] = useState("idle");
  const [localIgnoredError, setLocalIgnoredError] = useState("");

  const applySnapshot = useCallback((next) => {
    if (!next || typeof next !== "object") return;
    setSnapshot(next);
    setError(text(next.syncError || next.sync_error));
    setState(text(next.syncState || next.sync_state, "ready"));
  }, []);

  const loadLocalIgnoredOverlay = useCallback(() => {
    if (!repoPath || !workspaceId) return;
    setLocalIgnoredState("loading");
    setLocalIgnoredError("");
    invoke("cloud_mcp_get_local_ignored_spec_graph_overlay", { repoPath })
      .then((overlay) => {
        setLocalIgnoredOverlay(overlay);
        setLocalIgnoredState("ready");
      })
      .catch((nextError) => {
        setLocalIgnoredError(nextError?.message || String(nextError));
        setLocalIgnoredState("error");
      });
  }, [repoPath, workspaceId]);

  useEffect(() => {
    if (!repoPath || !workspaceId) return undefined;
    let cancelled = false;
    let unlistenCache = null;

    setState((current) => (current === "idle" ? "loading" : current));

    invoke("cloud_mcp_get_cached_spec_graph", {
      repoPath,
      workspaceId,
      workspaceName: workspaceName || null,
    })
      .then((next) => {
        if (!cancelled) applySnapshot(next);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError?.message || String(nextError));
          setState("error");
        }
      });

    listen(SPEC_GRAPH_CACHE_EVENT, (event) => {
      const next = event?.payload;
      if (!next || next.repoPath !== repoPath) return;
      applySnapshot(next);
    }).then((nextUnlisten) => {
      if (cancelled) {
        nextUnlisten();
        return;
      }
      unlistenCache = nextUnlisten;
    });

    invoke("cloud_mcp_start_spec_graph_sync", {
      repoPath,
      workspaceId,
      workspaceName: workspaceName || null,
    })
      .then((next) => {
        if (!cancelled) applySnapshot(next);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError?.message || String(nextError));
          setState("error");
        }
      });

    return () => {
      cancelled = true;
      if (typeof unlistenCache === "function") unlistenCache();
    };
  }, [applySnapshot, repoPath, workspaceId, workspaceName]);

  useEffect(() => {
    if (showLocalIgnored) loadLocalIgnoredOverlay();
  }, [loadLocalIgnoredOverlay, showLocalIgnored]);

  const baseSpecGraph = useMemo(
    () => normalizeSnapshot(snapshot, { workspaceDisplayIdentity }),
    [snapshot, workspaceDisplayIdentity],
  );
  const specGraph = useMemo(
    () => mergeLocalIgnoredOverlay(baseSpecGraph, localIgnoredOverlay, showLocalIgnored, {
      workspaceDisplayIdentity,
    }),
    [baseSpecGraph, localIgnoredOverlay, showLocalIgnored, workspaceDisplayIdentity],
  );
  const selectedNode = selectedFallback(specGraph.nodes, selectedNodeId);
  const localIgnoredCount = Array.isArray(localIgnoredOverlay?.nodes)
    ? localIgnoredOverlay.nodes.length
    : 0;

  useEffect(() => {
    if (specGraph.nodes.length && !specGraph.nodes.some((node) => node.id === selectedNodeId)) {
      const root = graphRootNode(specGraph.nodes, specGraph.edges);
      setSelectedNodeId(root?.id || specGraph.nodes[0].id);
    }
  }, [specGraph.edges, specGraph.nodes, selectedNodeId]);

  return (
    <SpecGraphSurface aria-label={`${workspace?.name || "Workspace"} Spec Graph`} data-state={state}>
      {error && <SpecGraphError>{error}</SpecGraphError>}
      {localIgnoredError && <SpecGraphError>{localIgnoredError}</SpecGraphError>}

      <SpecGraphToolbar>
        <LocalIgnoredToggle
          type="button"
          data-active={showLocalIgnored ? "true" : "false"}
          onClick={() => {
            setShowLocalIgnored((current) => !current);
          }}
        >
          {showLocalIgnored ? "Hide local ignored" : "Show local ignored"}
        </LocalIgnoredToggle>
        <LocalIgnoredHint>
          {localIgnoredState === "loading"
            ? "checking local cache"
            : showLocalIgnored
              ? `${localIgnoredCount} local-only whitelisted path${localIgnoredCount === 1 ? "" : "s"}`
              : "local only, not synced"}
        </LocalIgnoredHint>
      </SpecGraphToolbar>

      <SpecGraphShell>
        <SpecGraphMain>
          <GraphRendererHost
            nodes={specGraph.nodes}
            edges={specGraph.edges}
            selectedNodeId={selectedNode?.id}
            onSelect={setSelectedNodeId}
            state={state}
          />
        </SpecGraphMain>

        <SpecInspector node={selectedNode} />
      </SpecGraphShell>
    </SpecGraphSurface>
  );
}

function SpecInspector({ node }) {
  if (!node) {
    return (
      <Inspector>
        <InspectorEmpty>Select a spec node.</InspectorEmpty>
      </Inspector>
    );
  }

  const specHistory = splitSpecHistory(node.active_specs, node.superseded_specs);

  return (
    <Inspector>
      <InspectorHeader>
        <h2>{node.display_title || node.displayTitle || node.title}</h2>
        <InspectorFacts>
          <span data-state={node.freshness_state}>{freshnessLabel(node.freshness_state)}</span>
          {isUnspecifiedStructuralNode(node) && <span data-state="no_spec">structural</span>}
          {isLocalOnlyNode(node) && <span data-state="local_only">local only</span>}
          {isLeasedFileNode(node) && <span data-state="leased">leased</span>}
          {isWorktreeFileNode(node) && <span data-state="worktree">isolated</span>}
          <span>{node.active_agent_count} {node.active_agent_count === 1 ? "agent" : "agents"}</span>
          {(Number(node.out_of_spec_count || node.notification_count) || 0) > 0 && (
            <span data-state="out_of_spec">out of spec: {Number(node.out_of_spec_count || node.notification_count) || 0}</span>
          )}
        </InspectorFacts>
      </InspectorHeader>
      <MarkdownPane>
        <SpecObjectList title="Active Specs" specs={specHistory.active} empty="No active specs recorded yet." />
        <SpecObjectList
          title="Superseded History"
          specs={specHistory.historical}
          empty="No superseded specs yet."
          historical
        />
      </MarkdownPane>
    </Inspector>
  );
}

function SpecObjectList({ title, specs, empty, historical = false }) {
  const visibleSpecs = Array.isArray(specs) ? specs : [];
  const [expandedPriorSpecs, setExpandedPriorSpecs] = useState({});
  const togglePriorSpecs = useCallback((specKey) => {
    setExpandedPriorSpecs((current) => ({
      ...current,
      [specKey]: !current[specKey],
    }));
  }, []);

  return (
    <SpecObjectsSection>
      <h3>{title}</h3>
      {visibleSpecs.length ? (
        visibleSpecs.map((spec, index) => {
          const specKey = field(spec, "id") || `${title}-${index}`;
          const priorSpecs = Array.isArray(spec.consolidated_specs) ? spec.consolidated_specs : [];
          const priorSpecsExpanded = Boolean(expandedPriorSpecs[specKey]);
          return (
            <SpecObjectCard key={specKey} $historical={historical}>
              <p>{text(field(spec, "statement"), "Unnamed spec")}</p>
              {priorSpecs.length > 0 && (
                <>
                  <PriorSpecsButton
                    type="button"
                    aria-expanded={priorSpecsExpanded ? "true" : "false"}
                    $expanded={priorSpecsExpanded}
                    onClick={() => togglePriorSpecs(specKey)}
                  >
                    <PriorSpecsIcon aria-hidden="true" />
                    {priorSpecs.length} prior {priorSpecs.length === 1 ? "version" : "versions"}
                  </PriorSpecsButton>
                  {priorSpecsExpanded && (
                    <PriorSpecsList>
                      {priorSpecs.map((priorSpec, priorIndex) => (
                        <PriorSpecItem key={field(priorSpec, "id") || `${specKey}-prior-${priorIndex}`}>
                          <span>Previously</span>
                          <p>{text(field(priorSpec, "statement"), "Unnamed spec")}</p>
                          {text(field(priorSpec, "supersession_reason")) && (
                            <small>{text(field(priorSpec, "supersession_reason"))}</small>
                          )}
                        </PriorSpecItem>
                      ))}
                    </PriorSpecsList>
                  )}
                </>
              )}
              {historical && text(field(spec, "supersession_reason")) && (
                <small>Reason: {text(field(spec, "supersession_reason"))}</small>
              )}
            </SpecObjectCard>
          );
        })
      ) : (
        <SpecObjectsEmpty>{empty}</SpecObjectsEmpty>
      )}
    </SpecObjectsSection>
  );
}

const SpecGraphSurface = styled.section`
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 10px;
  background:
    linear-gradient(180deg, rgba(17, 24, 39, 0.95), rgba(10, 11, 14, 0.96)),
    #0a0b0e;
  color: var(--forge-text, #dbe7f7);
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SpecGraphError = styled.div`
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 8px;
  background: rgba(127, 29, 29, 0.22);
  color: #fecaca;
  padding: 10px;
`;

const SpecGraphToolbar = styled.div`
  align-items: center;
  display: flex;
  gap: 10px;
  justify-content: flex-start;
  min-height: 34px;
`;

const LocalIgnoredToggle = styled.button`
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.84);
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  padding: 8px 12px;
  text-transform: uppercase;
  transition: border-color 160ms ease, color 160ms ease, transform 160ms ease;

  &[data-active="true"] {
    border-color: rgba(251, 191, 36, 0.68);
    color: #fde68a;
  }

  &:hover {
    border-color: rgba(251, 191, 36, 0.72);
    color: #fef3c7;
    transform: translateY(-1px);
  }
`;

const LocalIgnoredHint = styled.span`
  color: rgba(148, 163, 184, 0.78);
  font-size: 11px;
  font-weight: 760;
`;

const SpecGraphShell = styled.div`
  align-items: stretch;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 34%);
  gap: 10px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) minmax(260px, 40%);
  }
`;

const SpecGraphMain = styled.main`
  border: 1px solid rgba(230, 236, 245, 0.07);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.58);
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const Inspector = styled.aside`
  border: 1px solid rgba(230, 236, 245, 0.07);
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.72);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const InspectorHeader = styled.header`
  align-items: flex-start;
  border-bottom: 1px solid rgba(230, 236, 245, 0.07);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;

  h2 {
    color: var(--forge-text-soft, #eef5ff);
    font-size: 14px;
    font-weight: 820;
    line-height: 1.24;
    margin: 0;
    min-width: 0;
  }
`;

const InspectorFacts = styled.div`
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 5px;

  span {
    border: 1px solid rgba(230, 236, 245, 0.12);
    border-radius: 999px;
    color: rgba(238, 245, 255, 0.82);
    font-size: 10px;
    font-weight: 820;
    line-height: 1;
    padding: 5px 8px;
    text-transform: lowercase;
  }

  span[data-state="updated"] {
    border-color: rgba(52, 211, 153, 0.3);
    color: #86efac;
  }

  span[data-state="behind_code"] {
    border-color: rgba(251, 113, 133, 0.3);
    color: #fda4af;
  }

  span[data-state="ahead_of_code"] {
    border-color: rgba(251, 191, 36, 0.3);
    color: #fde68a;
  }

  span[data-state="no_spec"] {
    border-color: rgba(100, 116, 139, 0.38);
    color: #cbd5e1;
  }

  span[data-state="out_of_spec"] {
    border-color: rgba(251, 146, 60, 0.38);
    color: #fed7aa;
  }

  span[data-state="worktree"] {
    border-color: rgba(56, 189, 248, 0.42);
    color: #bae6fd;
  }
`;

const MarkdownPane = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const SpecObjectsSection = styled.section`
  border-top: 1px solid rgba(230, 236, 245, 0.07);
  padding: 12px;

  h3 {
    color: rgba(238, 245, 255, 0.72);
    font-size: 10px;
    font-weight: 860;
    letter-spacing: 0.08em;
    margin: 0 0 8px;
    text-transform: uppercase;
  }
`;

const SpecObjectCard = styled.article`
  border: 1px solid ${({ $historical }) => ($historical ? "rgba(148, 163, 184, 0.16)" : "rgba(52, 211, 153, 0.18)")};
  border-radius: 8px;
  background: ${({ $historical }) => ($historical ? "rgba(15, 23, 42, 0.38)" : "rgba(6, 78, 59, 0.14)")};
  padding: 9px 10px;

  & + & {
    margin-top: 7px;
  }

  p {
    color: rgba(229, 236, 246, ${({ $historical }) => ($historical ? 0.58 : 0.86)});
    font-size: 11px;
    font-weight: 650;
    line-height: 1.45;
    margin: 0;
  }

  small {
    color: rgba(251, 191, 36, 0.82);
    display: block;
    font-size: 10px;
    font-weight: 650;
    line-height: 1.4;
    margin-top: 7px;
  }
`;

const PriorSpecsButton = styled.button`
  align-items: center;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background: rgba(7, 12, 19, 0.38);
  color: rgba(219, 231, 247, 0.66);
  cursor: pointer;
  display: inline-flex;
  font-size: 10px;
  font-weight: 780;
  gap: 3px;
  line-height: 1;
  margin-top: 8px;
  padding: 5px 8px 5px 6px;

  &:hover {
    border-color: rgba(52, 211, 153, 0.24);
    color: rgba(238, 245, 255, 0.9);
  }

  svg {
    transform: ${({ $expanded }) => ($expanded ? "rotate(-90deg)" : "rotate(0deg)")};
  }
`;

const PriorSpecsIcon = styled(KeyboardArrowLeft)`
  height: 14px;
  transition: transform 140ms ease;
  width: 14px;
`;

const PriorSpecsList = styled.div`
  border-left: 1px solid rgba(52, 211, 153, 0.18);
  display: grid;
  gap: 7px;
  margin-top: 8px;
  padding-left: 9px;
`;

const PriorSpecItem = styled.div`
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.36);
  padding: 8px 9px;

  span {
    color: rgba(219, 231, 247, 0.42);
    display: block;
    font-size: 9px;
    font-weight: 850;
    letter-spacing: 0.06em;
    line-height: 1;
    margin-bottom: 5px;
    text-transform: uppercase;
  }

  p {
    color: rgba(229, 236, 246, 0.68);
    font-size: 10.5px;
    font-weight: 640;
    line-height: 1.42;
    margin: 0;
  }

  small {
    color: rgba(251, 191, 36, 0.74);
  }
`;

const SpecObjectsEmpty = styled.div`
  color: rgba(219, 231, 247, 0.38);
  font-size: 11px;
  font-weight: 650;
`;

const InspectorEmpty = styled.div`
  color: rgba(219, 231, 247, 0.48);
  font-size: 12px;
  font-weight: 680;
  padding: 14px;
`;
