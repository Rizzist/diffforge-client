import { useCallback, useEffect, useState } from "react";

function readWindowFullscreen(windowHandle, onValue) {
  try {
    Promise.resolve(windowHandle?.isFullscreen?.())
      .then((value) => onValue(Boolean(value)))
      .catch(() => {});
  } catch {
    // Native window handles can disappear during close/return races.
  }
}

export function usePopoutWindowFullscreen(windowHandle) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const refreshFullscreen = useCallback(() => {
    readWindowFullscreen(windowHandle, setIsFullscreen);
  }, [windowHandle]);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    const syncFullscreen = () => {
      readWindowFullscreen(windowHandle, (value) => {
        if (!disposed) {
          setIsFullscreen(value);
        }
      });
    };

    syncFullscreen();
    try {
      Promise.resolve(windowHandle?.onResized?.(syncFullscreen))
        .then((dispose) => {
          if (disposed) {
            dispose?.();
            return;
          }
          unlisten = dispose;
        })
        .catch(() => {});
    } catch {
      // Missing permissions/runtime should leave the button inert, not fatal.
    }

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [windowHandle]);

  const toggleFullscreen = useCallback(() => {
    try {
      Promise.resolve(windowHandle?.isFullscreen?.())
        .then((currentValue) => windowHandle?.setFullscreen?.(!currentValue))
        .then(refreshFullscreen)
        .catch(refreshFullscreen);
    } catch {
      refreshFullscreen();
    }
  }, [refreshFullscreen, windowHandle]);

  return { isFullscreen, refreshFullscreen, toggleFullscreen };
}
