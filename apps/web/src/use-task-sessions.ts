import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './lib';
import type { Locale, Task, TaskBlocksResponse } from './types';

/** Load sessions on demand; bootstrap and task history never embed unbounded blocks. */
export function useTaskSessions(task: Task, locale: Locale) {
  const [result, setResult] = useState<TaskBlocksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const inFlight = useRef(false);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const abortControllerRef = useRef<AbortController | null>(null);
  const load = useCallback(async (cursor?: string) => {
    if (inFlight.current) return;
    const request = ++generation.current;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    inFlight.current = true; setLoading(true); setError('');
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await api<TaskBlocksResponse>(`/tasks/${encodeURIComponent(task.id)}/schedule-blocks${query}`, 'GET', undefined, controller.signal);
      if (request !== generation.current) return;
      setResult(previous => cursor && previous ? {
        ...response,
        blocks: [...new Map([...previous.blocks, ...response.blocks].map(block => [block.id, block])).values()],
      } : response);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (request === generation.current) setError(errorMessage(err, localeRef.current));
    } finally {
      if (request === generation.current) { inFlight.current = false; setLoading(false); }
    }
  }, [task.id]);
  useEffect(() => {
    setResult(null); void load();
    return () => {
      abortControllerRef.current?.abort();
      generation.current++;
      inFlight.current = false;
    };
  }, [load, task.status, task.isScheduled]);
  return { result, loading, error, retry: () => load(result?.page.nextCursor || undefined),
    loadMore: () => result?.page.nextCursor && load(result.page.nextCursor) };
}
