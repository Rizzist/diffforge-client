import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PANEL_AGENT_PROMPT_ACTIVITY_EVENT,
  PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT,
  PANEL_AGENT_PROMPT_RESULT_EVENT,
  PANEL_AGENT_PROMPT_SUBMIT_EVENT,
  PANEL_AGENT_PROMPT_TARGETS_EVENT,
  PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT,
  createPanelAgentPromptRequestId,
  normalizePanelAgentPromptActivityItems,
  normalizePanelAgentPromptTargets,
} from "../terminals/panelAgentPromptBridge.js";
import WebPane from "./WebPane.jsx";
import { DEFAULT_WEB_URL, normalizeWebInput } from "./webNative.js";

export function workspaceWebTabPaneId(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  return `workspace-web-tab-${safeWorkspaceId || "workspace"}`;
}

export default function WebWorkspaceView({
  is_active: isActive = true,
  onFocusWebTabPopout = null,
  onPopOutWebTab = null,
  onReturnWebTabPopout = null,
  onWebTabNativeLabel = null,
  onWebTabNavigate = null,
  webTabSession = null,
  webviewObscured = false,
  workspace,
}) {
  const workspaceId = String(workspace?.id || "").trim();
  const paneId = useMemo(() => workspaceWebTabPaneId(workspaceId), [workspaceId]);
  const scopeParts = useMemo(
    () => [workspaceId || "workspace-tab", "workspace-web-tab"],
    [workspaceId],
  );

  const sessionUrl = useMemo(
    () => normalizeWebInput(webTabSession?.currentUrl || webTabSession?.url)
      || String(webTabSession?.currentUrl || webTabSession?.url || "").trim()
      || DEFAULT_WEB_URL,
    [webTabSession?.currentUrl, webTabSession?.url],
  );
  const popoutLabel = String(webTabSession?.popoutLabel || webTabSession?.label || "").trim();
  const poppedOut = Boolean(webTabSession?.poppedOut || popoutLabel);
  const resumeNonce = Number(webTabSession?.resumeNonce || 0);
  const adoptWebviewLabel = String(webTabSession?.webview_label || "").trim();
  const adoptNonce = Number(webTabSession?.adoptNonce || 0);

  const handleNativeLabelChange = useCallback((_paneId, label) => {
    onWebTabNativeLabel?.(paneId, label);
  }, [onWebTabNativeLabel, paneId]);

  const [currentUrl, setCurrentUrl] = useState(sessionUrl);
  const [agentPromptActivityItems, setAgentPromptActivityItems] = useState([]);
  const [agentPromptTargets, setAgentPromptTargets] = useState([]);
  const [defaultAgentPromptTargetIds, setDefaultAgentPromptTargetIds] = useState([]);

  const agentPromptTargetsRequestIdRef = useRef("");
  const lastUrlRef = useRef(sessionUrl);
  const previousPaneIdRef = useRef(paneId);

  const rememberUrl = useCallback((url) => {
    const safeUrl = normalizeWebInput(url) || String(url || "").trim();
    if (!safeUrl) {
      return;
    }
    lastUrlRef.current = safeUrl;
    setCurrentUrl(safeUrl);
    onWebTabNavigate?.({ pane_id: paneId, url: safeUrl, workspace_id: workspaceId });
  }, [onWebTabNavigate, paneId, workspaceId]);

  useEffect(() => {
    lastUrlRef.current = sessionUrl;
    setCurrentUrl(sessionUrl);
  }, [sessionUrl]);

  useEffect(() => {
    if (previousPaneIdRef.current === paneId) {
      return;
    }
    previousPaneIdRef.current = paneId;
    lastUrlRef.current = sessionUrl;
    agentPromptTargetsRequestIdRef.current = "";
    setCurrentUrl(sessionUrl);
    setAgentPromptActivityItems([]);
    setAgentPromptTargets([]);
    setDefaultAgentPromptTargetIds([]);
  }, [paneId, sessionUrl]);

  const popOutWebTab = useCallback(async (_terminalIndex, _paneId, url) => {
    const targetUrl = normalizeWebInput(url || lastUrlRef.current) || DEFAULT_WEB_URL;
    rememberUrl(targetUrl);
    if (poppedOut) {
      onFocusWebTabPopout?.({ label: popoutLabel, pane_id: paneId, url: targetUrl, workspace_id: workspaceId });
      return;
    }
    onPopOutWebTab?.({ pane_id: paneId, url: targetUrl, workspace_id: workspaceId });
  }, [onFocusWebTabPopout, onPopOutWebTab, paneId, popoutLabel, poppedOut, rememberUrl, workspaceId]);

  const focusWebTabPopout = useCallback(() => {
    onFocusWebTabPopout?.({ label: popoutLabel, pane_id: paneId, url: currentUrl, workspace_id: workspaceId });
  }, [currentUrl, onFocusWebTabPopout, paneId, popoutLabel, workspaceId]);

  const returnWebTabPopout = useCallback((_terminalIndex, _paneId, url) => {
    const returnUrl = normalizeWebInput(url)
      || String(url || "").trim()
      || lastUrlRef.current
      || DEFAULT_WEB_URL;
    rememberUrl(returnUrl);
    onReturnWebTabPopout?.({ label: popoutLabel, pane_id: paneId, url: returnUrl, workspace_id: workspaceId });
  }, [onReturnWebTabPopout, paneId, popoutLabel, rememberUrl, workspaceId]);

  const requestAgentPromptTargets = useCallback(() => {
    const requestId = createPanelAgentPromptRequestId("web-tab-targets");
    agentPromptTargetsRequestIdRef.current = requestId;
    emit(PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT, {
      panel_kind: "web",
      pane_id: paneId,
      request_id: requestId,
      workspace_id: workspaceId,
    }).catch(() => {});
  }, [paneId, workspaceId]);

  const requestAgentPromptActivity = useCallback(() => {
    emit(PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT, {
      panel_kind: "web",
      pane_id: paneId,
      workspace_id: workspaceId,
    }).catch(() => {});
  }, [paneId, workspaceId]);

  useEffect(() => {
    requestAgentPromptActivity();
  }, [requestAgentPromptActivity]);

  const handleAgentPromptOpenChange = useCallback((open) => {
    if (!open) {
      return;
    }
    requestAgentPromptTargets();
    requestAgentPromptActivity();
  }, [requestAgentPromptActivity, requestAgentPromptTargets]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(PANEL_AGENT_PROMPT_ACTIVITY_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const payloadPaneId = String(payload.pane_id || payload.panel_pane_id || "").trim();
      if (!payloadPaneId || payloadPaneId !== paneId) {
        return;
      }
      const payloadWorkspaceId = String(payload.workspace_id || "").trim();
      if (payloadWorkspaceId && workspaceId && payloadWorkspaceId !== workspaceId) {
        return;
      }
      setAgentPromptActivityItems(normalizePanelAgentPromptActivityItems(payload.items));
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [paneId, workspaceId]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(PANEL_AGENT_PROMPT_TARGETS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const requestId = String(payload.request_id || "").trim();
      if (requestId && requestId !== agentPromptTargetsRequestIdRef.current) {
        return;
      }
      const payloadWorkspaceId = String(payload.workspace_id || "").trim();
      if (payloadWorkspaceId && workspaceId && payloadWorkspaceId !== workspaceId) {
        return;
      }
      setAgentPromptTargets(normalizePanelAgentPromptTargets(payload.targets));
      setDefaultAgentPromptTargetIds(
        (Array.isArray(payload.defaultSelectedTargetIds)
          ? payload.defaultSelectedTargetIds
          : Array.isArray(payload.default_selected_target_ids)
            ? payload.default_selected_target_ids
            : []
        ).map((id) => String(id || "").trim()).filter(Boolean),
      );
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [workspaceId]);

  const submitAgentPrompt = useCallback(async ({ context_refs: contextRefs, target_ids: targetIds, target_terminal_indexes: targetTerminalIndexes, text }) => {
    const requestId = createPanelAgentPromptRequestId("web-tab-submit");
    let unlisten = () => {};
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        unlisten();
      };
      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        cleanup();
        reject(new Error("Timed out sending prompt."));
      }, 15000);
      listen(PANEL_AGENT_PROMPT_RESULT_EVENT, (event) => {
        const payload = event?.payload || {};
        if (String(payload.request_id || "").trim() !== requestId) {
          return;
        }
        window.clearTimeout(timeoutId);
        cleanup();
        if (payload.ok === true) {
          resolve(payload);
        } else {
          reject(new Error(String(payload.error || "Unable to send prompt.")));
        }
      })
        .then((nextUnlisten) => {
          if (settled) {
            nextUnlisten();
            return;
          }
          unlisten = nextUnlisten;
          emit(PANEL_AGENT_PROMPT_SUBMIT_EVENT, {
            context_refs: contextRefs,
            panel_kind: "web",
            pane_id: paneId,
            request_id: requestId,
            target_ids: targetIds,
            target_terminal_indexes: targetTerminalIndexes,
            text,
            workspace_id: workspaceId,
          }).catch((error) => {
            window.clearTimeout(timeoutId);
            cleanup();
            reject(error);
          });
        })
        .catch((error) => {
          window.clearTimeout(timeoutId);
          cleanup();
          reject(error);
        });
    });
  }, [paneId, workspaceId]);

  const layoutKey = [
    paneId,
    isActive ? "active" : "inactive",
    webviewObscured ? "obscured" : "clear",
    poppedOut ? "popped-out" : "in-tab",
    resumeNonce,
  ].join("|");

  return (
    <WebPane
      key={`web-tab-${paneId}-${resumeNonce}`}
      adopt_label={adoptWebviewLabel}
      adoptNonce={adoptNonce}
      breakoutReturnUrl={currentUrl}
      defaultPanelAgentPromptTargetIds={defaultAgentPromptTargetIds}
      initialUrl={currentUrl}
      inlineToolbarInNav
      is_active={isActive}
      layoutKey={layoutKey}
      onNativeLabelChange={handleNativeLabelChange}
      onAgentPromptOpenChange={handleAgentPromptOpenChange}
      onFocusBreakout={focusWebTabPopout}
      onNavigate={rememberUrl}
      onPopOut={popOutWebTab}
      onReturnFromBreakout={returnWebTabPopout}
      onSubmitPanelAgentPrompt={submitAgentPrompt}
      pane_id={paneId}
      panelAgentPromptActivityItems={agentPromptActivityItems}
      panelAgentPromptTargets={agentPromptTargets}
      poppedOut={poppedOut}
      scopeParts={scopeParts}
      showCloseButton={false}
      showDragHandle={false}
      showFullscreenControl={false}
      showSplitControls={false}
      webviewObscured={webviewObscured}
      workspace_id={workspaceId}
    />
  );
}
