"use client";

import { useCallback, useSyncExternalStore } from "react";

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  const subscribe = useCallback(
    (callback: () => void) => {
      const handler = (event: StorageEvent) => {
        if (event.key === key || event.key === null) callback();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    [key]
  );

  const getSnapshot = useCallback(() => safeRead(key), [key]);
  const getServerSnapshot = () => null;

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const storedValue = parse(raw, initialValue);
  const isLoaded = raw !== null || (typeof window !== "undefined" && raw === null);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      const prev = parse(safeRead(key), initialValue);
      const newValue = value instanceof Function ? value(prev) : value;
      try {
        window.localStorage.setItem(key, JSON.stringify(newValue));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      } catch {
        // localStorage not available
      }
    },
    [key, initialValue]
  );

  return [storedValue, setValue, isLoaded] as const;
}
