import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import {
  WEB_PANEL_CLOSED_EVENT,
  WEB_PANEL_CONTROL_EVENT,
  WEB_PANEL_CONTROL_NAVIGATE,
  WEB_PANEL_CONTROL_RETURN,
} from "./webPanelBridge.js";

function workspaceWebTabPaneId(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  return `workspace-web-tab-${safeWorkspaceId || "workspace"}`;
}

function fallbackOpenExternal(url) {
  const targetUrl = normalizeWebInput(url) || DEFAULT_WEB_URL;
  openUrl(targetUrl).catch(() => {
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  });
}

export default function WebWorkspaceView({
  isActive = true,
  webviewObscured = false,
  workspace,
}) {
  const workspaceId = String(workspace?.id || "").trim();
  const paneId = useMemo(() => workspaceWebTabPaneId(workspaceId), [workspaceId]);
  const scopeParts = useMemo(
    () => [workspaceId || "workspace-tab", "workspace-web-tab"],
    [workspaceId],
  );

  const [currentUrl, setCurrentUrl] = useState(DEFAULT_WEB_URL);
  const [poppedOut, setPoppedOut] = useState(false);
  const [popoutLabel, setPopoutLabel] = useState("");
  const [resumeNonce, setResumeNonce] = useState(0);
  const [agentPromptActivityItems, setAgentPromptActivityItems] = useState([]);
  const [agentPromptTargets, setAgentPromptTargets] = useState([]);
  const [defaultAgentPromptTargetIds, setDefaultAgentPromptTargetIds] = useState([]);

  const agentPromptTargetsRequestIdRef = useRef("");
  const lastUrlRef = useRef(DEFAULT_WEB_URL);
  const poppedOutRef = useRef(false);
  const popoutLabelRef = useRef("");
  const previousPaneIdRef = useRef(paneId);

  const rememberUrl = useCallback((url) => {
    const safeUrl = normalizeWebInput(url) || String(url || "").trim();
    if (!safeUrl) {
      return;
    }
    lastUrlRef.current = safeUrl;
    setCurrentUrl(safeUrl);
  }, []);

  const clearBreakout = useCallback((url) => {
    if (url) {
      rememberUrl(url);
    }
    const wasPoppedOut = poppedOutRef.current || Boolean(popoutLabelRef.current);
    poppedOutRef.current = false;
    popoutLabelRef.current = "";
    setPoppedOut(false);
    setPopoutLabel("");
    if (wasPoppedOut) {
      setResumeNonce((nonce) => nonce + 1);
    }
  }, [rememberUrl]);

  useEffect(() => {
    if (previousPaneIdRef.current === paneId) {
      return;
    }
    const previousLabel = popoutLabelRef.current;
    if (previousLabel) {
      invoke("web_panel_close", { label: previousLabel }).catch(() => {});
    }
    previousPaneIdRef.current = paneId;
    lastUrlRef.current = DEFAULT_WEB_URL;
    poppedOutRef.current = false;
    popoutLabelRef.current = "";
    agentPromptTargetsRequestIdRef.current = "";
    setCurrentUrl(DEFAULT_WEB_URL);
    setPoppedOut(false);
    setPopoutLabel("");
    setAgentPromptActivityItems([]);
    setAgentPromptTargets([]);
    setDefaultAgentPromptTargetIds([]);
    setResumeNonce((nonce) => nonce + 1);
  }, [paneId]);

  useEffect(() => () => {
    const label = popoutLabelRef.current;
    if (label) {
      invoke("web_panel_close", { label }).catch(() => {});
    }
  }, []);

  const popOutWebTab = useCallback(async (_terminalIndex, _paneId, url) => {
    const targetUrl = normalizeWebInput(url || lastUrlRef.current) || DEFAULT_WEB_URL;
    rememberUrl(targetUrl);
    if (popoutLabelRef.current) {
      invoke("web_panel_focus", { label: popoutLabelRef.current }).catch(() => {});
      return;
    }
    try {
      const result = await invoke("web_panel_open", {
        height: null,
        paneId,
        theme: document.documentElement?.dataset?.forgeTheme || "",
        title: "Web",
        url: targetUrl,
        width: null,
        workspaceId,
      });
      const label = String(result?.label || "").trim();
      if (label) {
        popoutLabelRef.current = label;
        setPopoutLabel(label);
      }
      poppedOutRef.current = true;
      setPoppedOut(true);
    } catch {
      fallbackOpenExternal(targetUrl);
    }
  }, [paneId, rememberUrl, workspaceId]);

  const focusWebTabPopout = useCallback(() => {
    const label = popoutLabelRef.current || popoutLabel;
    if (label) {
      invoke("web_panel_focus", { label }).catch(() => {});
    }
  }, [popoutLabel]);

  const returnWebTabPopout = useCallback((_terminalIndex, _paneId, url) => {
    const label = popoutLabelRef.current || popoutLabel;
    const returnUrl = normalizeWebInput(url)
      || String(url || "").trim()
      || lastUrlRef.current
      || DEFAULT_WEB_URL;
    clearBreakout(returnUrl);
    if (label) {
      invoke("web_panel_close", { label }).catch(() => {});
    }
  }, [clearBreakout, popoutLabel]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(WEB_PANEL_CLOSED_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const eventPaneId = String(payload.paneId || payload.pane_id || "").trim();
      const eventWindowId = String(payload.windowId || payload.window_id || "").trim();
      if (eventPaneId && eventPaneId !== paneId) {
        return;
      }
      if (!eventPaneId && eventWindowId && eventWindowId !== popoutLabelRef.current) {
        return;
      }
      if (!eventPaneId && !eventWindowId) {
        return;
      }
      clearBreakout(payload.url);
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
  }, [clearBreakout, paneId]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(WEB_PANEL_CONTROL_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const eventPaneId = String(payload.paneId || payload.pane_id || "").trim();
      if (eventPaneId !== paneId) {
        return;
      }
      const control = String(payload.control || "").trim();
      if (control === WEB_PANEL_CONTROL_NAVIGATE) {
        rememberUrl(payload.url);
        return;
      }
      if (control === WEB_PANEL_CONTROL_RETURN) {
        returnWebTabPopout(null, paneId, payload.url);
      }
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
  }, [paneId, rememberUrl, returnWebTabPopout]);

  const requestAgentPromptTargets = useCallback(() => {
    const requestId = createPanelAgentPromptRequestId("web-tab-targets");
    agentPromptTargetsRequestIdRef.current = requestId;
    emit(PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT, {
      panelKind: "web",
      paneId,
      requestId,
      workspaceId,
    }).catch(() => {});
  }, [paneId, workspaceId]);

  const requestAgentPromptActivity = useCallback(() => {
    emit(PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT, {
      panelKind: "web",
      paneId,
      workspaceId,
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
      const payloadPaneId = String(payload.paneId || payload.pane_id || payload.panelPaneId || payload.panel_pane_id || "").trim();
      if (!payloadPaneId || payloadPaneId !== paneId) {
        return;
      }
      const payloadWorkspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
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
      const requestId = String(payload.requestId || payload.request_id || "").trim();
      if (requestId && requestId !== agentPromptTargetsRequestIdRef.current) {
        return;
      }
      const payloadWorkspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
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

  const submitAgentPrompt = useCallback(async ({ contextRefs, targetIds, targetTerminalIndexes, text }) => {
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
        if (String(payload.requestId || payload.request_id || "").trim() !== requestId) {
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
            contextRefs,
            panelKind: "web",
            paneId,
            requestId,
            targetIds,
            targetTerminalIndexes,
            text,
            workspaceId,
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
      breakoutReturnUrl={currentUrl}
      defaultPanelAgentPromptTargetIds={defaultAgentPromptTargetIds}
      initialUrl={currentUrl}
      isActive={isActive}
      layoutKey={layoutKey}
      onAgentPromptOpenChange={handleAgentPromptOpenChange}
      onFocusBreakout={focusWebTabPopout}
      onNavigate={rememberUrl}
      onPopOut={popOutWebTab}
      onReturnFromBreakout={returnWebTabPopout}
      onSubmitPanelAgentPrompt={submitAgentPrompt}
      paneId={paneId}
      panelAgentPromptActivityItems={agentPromptActivityItems}
      panelAgentPromptTargets={agentPromptTargets}
      poppedOut={poppedOut}
      scopeParts={scopeParts}
      showCloseButton={false}
      showDragHandle={false}
      showFullscreenControl={false}
      showSplitControls={false}
      webviewObscured={webviewObscured}
      workspaceId={workspaceId}
    />
  );
}
