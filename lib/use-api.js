'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client-api.js';

/**
 * Data fetching for client screens.
 *
 * Deliberately small: a loading flag, an error, a refresh, and cancellation on
 * unmount so a resolved request cannot set state on a page the merchant has
 * already navigated away from.
 */
export function useApi(path, { enabled = true, pollMs = 0 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!path || !enabled) return null;
      if (!quiet) setLoading(true);
      try {
        const result = await api.get(path);
        if (mounted.current) {
          setData(result);
          setError(null);
        }
        return result;
      } catch (caught) {
        if (mounted.current) setError(caught);
        return null;
      } finally {
        if (mounted.current && !quiet) setLoading(false);
      }
    },
    [path, enabled]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Polling refreshes quietly so a running sync does not make the whole screen
  // flash back to its skeleton every few seconds.
  useEffect(() => {
    if (!pollMs || !enabled) return undefined;
    const timer = setInterval(() => load({ quiet: true }), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, enabled, load]);

  return { data, error, loading, refresh: load, setData };
}

/** Wraps a mutating call with pending state and error capture. */
export function useMutation(handler) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(
    async (...args) => {
      setPending(true);
      setError(null);
      try {
        return await handler(...args);
      } catch (caught) {
        setError(caught);
        throw caught;
      } finally {
        setPending(false);
      }
    },
    [handler]
  );

  return { run, pending, error };
}
