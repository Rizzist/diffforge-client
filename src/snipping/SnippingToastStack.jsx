import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Close } from "@styled-icons/material-rounded/Close";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { ModeEdit } from "@styled-icons/material-rounded/ModeEdit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle } from "styled-components";

const SNIPPING_CAPTURE_SAVED_EVENT = "forge-snipping-capture-saved";
const SNIP_TOAST_LIMIT = 6;

export const SNIPPING_TOAST_HASH = "#/snipping-toasts";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function assetLocalPath(asset) {
  return text(asset?.localPath || asset?.local_path || asset?.path);
}

function assetName(asset) {
  const localPath = assetLocalPath(asset);
  return text(asset?.name || asset?.filename || localPath.split(/[\\/]/u).pop(), "snip.png");
}

function assetPreviewUrl(asset) {
  const localPath = assetLocalPath(asset);
  if (!localPath) return "";
  try {
    return convertFileSrc(localPath);
  } catch {
    return "";
  }
}

function snipToastFromPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const item = source.item && typeof source.item === "object" ? source.item : source;
  const localPath = assetLocalPath(item) || assetLocalPath(source);
  if (!localPath) return null;

  const name = assetName(item);
  const savedAtMs = Number(source.savedAtMs || source.saved_at_ms || Date.now());
  const id = text(item.id || item.untrackedId || item.untracked_id, `snip-${savedAtMs}-${localPath}`);
  return {
    id,
    localPath,
    name,
    previewUrl: assetPreviewUrl({ ...item, localPath }),
    savedAtMs,
    status: "",
    width: Number(source.width || item.width || 0),
    height: Number(source.height || item.height || 0),
  };
}

async function copySnipToClipboard(toast) {
  try {
    await invoke("snipping_copy_untracked_asset_to_clipboard", {
      path: toast.localPath,
    });
    return "Copied image";
  } catch {
    // Fall through to the Web Clipboard API for webviews/platforms where
    // native image clipboard access is unavailable.
  }

  const previewUrl = toast.previewUrl || assetPreviewUrl(toast);
  if (previewUrl && navigator?.clipboard?.write && window.ClipboardItem) {
    const response = await fetch(previewUrl);
    if (!response.ok) {
      throw new Error(`Unable to read snip image: ${response.status}`);
    }
    const sourceBlob = await response.blob();
    const mimeType = sourceBlob.type || "image/png";
    const blob = sourceBlob.type ? sourceBlob : new Blob([sourceBlob], { type: mimeType });
    await navigator.clipboard.write([
      new window.ClipboardItem({
        [mimeType]: blob,
      }),
    ]);
    return "Copied image";
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(toast.localPath);
    return "Copied path";
  }

  throw new Error("Clipboard is not available in this webview.");
}

export default function SnippingToastStack() {
  const [toasts, setToasts] = useState([]);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const hadToastsRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.snippingToasts = "true";
    document.body.dataset.snippingToasts = "true";
    return () => {
      delete document.documentElement.dataset.snippingToasts;
      delete document.body.dataset.snippingToasts;
    };
  }, []);

  useEffect(() => {
    invoke("snipping_recent_capture_toasts")
      .then((result) => {
        const items = Array.isArray(result?.items) ? result.items : [];
        const nextToasts = items
          .map(snipToastFromPayload)
          .filter(Boolean)
          .slice(0, SNIP_TOAST_LIMIT);
        if (nextToasts.length) {
          setToasts(nextToasts);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    listen(SNIPPING_CAPTURE_SAVED_EVENT, (event) => {
      if (disposed) return;
      const toast = snipToastFromPayload(event?.payload);
      if (!toast) return;
      setToasts((current) => [
        toast,
        ...current.filter((item) => item.localPath !== toast.localPath),
      ].slice(0, SNIP_TOAST_LIMIT));
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
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (toasts.length) {
      hadToastsRef.current = true;
      return;
    }
    if (hadToastsRef.current) {
      getCurrentWindow().close().catch(() => {});
    }
  }, [toasts.length]);

  const busyToastIds = useMemo(() => busyIds, [busyIds]);

  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const setToastStatus = useCallback((toastId, status) => {
    setToasts((current) => current.map((toast) => (
      toast.id === toastId ? { ...toast, status } : toast
    )));
  }, []);

  const runToastAction = useCallback(async (toast, action) => {
    if (!toast?.id) return;
    setBusyIds((current) => {
      const next = new Set(current);
      next.add(toast.id);
      return next;
    });
    setToastStatus(toast.id, "");
    try {
      if (action === "delete") {
        await invoke("diffforge_delete_untracked_asset", { path: toast.localPath });
        dismissToast(toast.id);
      } else if (action === "copy") {
        const status = await copySnipToClipboard(toast);
        setToastStatus(toast.id, status);
        window.setTimeout(() => {
          setToastStatus(toast.id, "");
        }, 1600);
      }
    } catch (error) {
      setToastStatus(toast.id, error?.message || String(error || "Action failed"));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(toast.id);
        return next;
      });
    }
  }, [dismissToast, setToastStatus]);

  if (!toasts.length) {
    return <SnipToastGlobalStyle />;
  }

  return (
    <>
      <SnipToastGlobalStyle />
      <SnipToastStackRoot aria-label="Recent snips" aria-live="polite">
        {toasts.map((toast, index) => {
          const busy = busyToastIds.has(toast.id);
          const dimensions = toast.width > 0 && toast.height > 0
            ? `${Math.round(toast.width)} x ${Math.round(toast.height)}`
            : "";

          return (
            <SnipToastCard
              data-busy={busy ? "true" : "false"}
              key={toast.id}
              style={{
                "--snip-toast-index": index,
                zIndex: toasts.length - index,
              }}
            >
              <SnipToastImageWrap>
                {toast.previewUrl ? (
                  <img alt={toast.name} draggable={false} src={toast.previewUrl} />
                ) : (
                  <span>{toast.name}</span>
                )}
              </SnipToastImageWrap>

              <SnipToastTopActions>
                <SnipToastButton
                  aria-label={`Edit ${toast.name}`}
                  disabled
                  title="Edit coming soon"
                  type="button"
                >
                  <ModeEdit aria-hidden="true" />
                </SnipToastButton>
                <SnipToastButton
                  aria-label={`Copy ${toast.name} to clipboard`}
                  disabled={busy}
                  onClick={() => runToastAction(toast, "copy")}
                  title="Copy image"
                  type="button"
                >
                  <ContentCopy aria-hidden="true" />
                </SnipToastButton>
              </SnipToastTopActions>

              <SnipToastDismissButton
                aria-label={`Dismiss ${toast.name}`}
                disabled={busy}
                onClick={() => dismissToast(toast.id)}
                title="Dismiss"
                type="button"
              >
                <Close aria-hidden="true" />
              </SnipToastDismissButton>

              <SnipToastDeleteButton
                aria-label={`Delete ${toast.name}`}
                disabled={busy}
                onClick={() => runToastAction(toast, "delete")}
                title="Delete snip"
                type="button"
              >
                <Delete aria-hidden="true" />
              </SnipToastDeleteButton>

              <SnipToastMeta>
                <strong>{toast.name}</strong>
                {(toast.status || dimensions) && <span>{toast.status || dimensions}</span>}
              </SnipToastMeta>
            </SnipToastCard>
          );
        })}
      </SnipToastStackRoot>
    </>
  );
}

const SnipToastGlobalStyle = createGlobalStyle`
  html,
  body,
  #app {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: transparent !important;
    user-select: none;
  }
`;

const SnipToastStackRoot = styled.aside`
  position: fixed;
  inset: 0;
  z-index: 12000;
  width: 100vw;
  height: 100vh;
  overflow: visible;
  pointer-events: none;
`;

const SnipToastCard = styled.article`
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 236px;
  height: 148px;
  overflow: visible;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 14px;
  background: rgba(9, 12, 18, 0.76);
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.32),
    0 0 0 1px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  transform:
    translate(
      calc(var(--snip-toast-index, 0) * -8px),
      calc(var(--snip-toast-index, 0) * -6px)
    )
    scale(calc(1 - min(var(--snip-toast-index, 0), 4) * 0.026));
  transform-origin: right bottom;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    opacity 160ms ease,
    transform 160ms ease;

  &:not(:hover) {
    opacity: calc(0.94 - min(var(--snip-toast-index, 0), 4) * 0.08);
  }

  &:hover,
  &:focus-within {
    z-index: 1000 !important;
    border-color: rgba(255, 255, 255, 0.32);
    box-shadow:
      0 22px 52px rgba(0, 0, 0, 0.42),
      0 0 0 1px rgba(255, 255, 255, 0.08);
    opacity: 1;
    transform: translate(0, -2px) scale(1);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(17, 24, 39, 0.12);
    background: rgba(255, 255, 255, 0.88);
    box-shadow:
      0 18px 42px rgba(17, 24, 39, 0.18),
      0 0 0 1px rgba(255, 255, 255, 0.8);
  }
`;

const SnipToastImageWrap = styled.div`
  position: absolute;
  inset: 7px;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
  }

  > span {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    padding: 12px;
    color: var(--forge-text-muted);
    font-size: 12px;
    font-weight: 750;
    text-align: center;
  }
`;

const SnipToastButton = styled.button`
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  color: #f8fafc;
  background: rgba(7, 10, 16, 0.68);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
  cursor: pointer;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    background 150ms ease,
    border-color 150ms ease,
    opacity 150ms ease,
    transform 150ms ease;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.34);
    background: rgba(15, 23, 36, 0.9);
  }

  &:disabled {
    cursor: default;
    opacity: 0;
  }

  ${SnipToastCard}:hover &,
  ${SnipToastCard}:focus-within & {
    opacity: 1;
    transform: translateY(0);
  }

  ${SnipToastCard}:hover &:disabled,
  ${SnipToastCard}:focus-within &:disabled {
    opacity: 0.52;
  }
`;

const SnipToastTopActions = styled.div`
  position: absolute;
  top: 13px;
  right: 13px;
  z-index: 2;
  display: inline-flex;
  gap: 6px;
`;

const SnipToastDismissButton = styled(SnipToastButton)`
  position: absolute;
  top: 50%;
  left: -12px;
  z-index: 2;
  transform: translate(-4px, -50%);

  ${SnipToastCard}:hover &,
  ${SnipToastCard}:focus-within & {
    transform: translate(0, -50%);
  }
`;

const SnipToastDeleteButton = styled(SnipToastButton)`
  position: absolute;
  left: 50%;
  bottom: -12px;
  z-index: 2;
  color: #ffd4d4;
  transform: translate(-50%, 4px);

  &:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.46);
    background: rgba(76, 22, 26, 0.92);
  }

  ${SnipToastCard}:hover &,
  ${SnipToastCard}:focus-within & {
    transform: translate(-50%, 0);
  }
`;

const SnipToastMeta = styled.div`
  position: absolute;
  left: 13px;
  right: 13px;
  bottom: 13px;
  z-index: 1;
  display: grid;
  gap: 2px;
  padding: 7px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(7, 10, 16, 0.1), rgba(7, 10, 16, 0.76));
  color: #f8fafc;
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 150ms ease,
    transform 150ms ease;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 11px;
    font-weight: 800;
  }

  span {
    color: rgba(248, 250, 252, 0.7);
    font-size: 10px;
    font-weight: 700;
  }

  ${SnipToastCard}:hover &,
  ${SnipToastCard}:focus-within & {
    opacity: 1;
    transform: translateY(0);
  }
`;
