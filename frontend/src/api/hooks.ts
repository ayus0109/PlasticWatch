/**
 * Minimal data hooks (no extra dependency). useApi keeps the previous data while a
 * refetch is in flight, so a dragged time slider updates in place instead of
 * flashing to a skeleton on every step.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  refetch: () => void;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function useApi<T>(path: string | null, query?: Query): ApiState<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    api
      .get<T>(path, queryRef.current, ctrl.signal)
      .then((d) => {
        setDataState(d);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [key, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback(
    (updater: (prev: T | undefined) => T | undefined) => setDataState(updater),
    [],
  );
  return { data, error, loading, refetch, setData };
}

/** Debounce a fast-changing value (e.g. the time slider). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}
