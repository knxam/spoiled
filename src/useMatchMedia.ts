import { useCallback, useMemo, useSyncExternalStore } from "react";

const supportsMatchMedia = "matchMedia" in window;

/**
 * This hook calls `matchMedia` and updates when its value changes
 */
export function useMatchMedia(query: string, ssrValue: boolean = false): boolean {
  const mediaQueryList = useMemo(
    () => (supportsMatchMedia ? window.matchMedia(query) : undefined),
    [query]
  );

  const subscribe = useCallback(
    (callback: () => void) => {
      if (!mediaQueryList)
        return () => {
          /* noop */
        };

      mediaQueryList.addEventListener("change", callback);
      return () => mediaQueryList.removeEventListener("change", callback);
    },
    [mediaQueryList]
  );

  return useSyncExternalStore(
    subscribe,
    () => mediaQueryList?.matches ?? false,
    () => ssrValue // value on the server
  );
}
