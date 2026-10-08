import { useQuery } from '@tanstack/react-query';
import { api } from '../lib';
import type { Bootstrap, TaskHistoryResponse } from '../types';

export function useBootstrapQuery(fromDate: string, toDate: string, enabled = true) {
  return useQuery({
    queryKey: ['bootstrap', fromDate, toDate],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ fromDate, toDate });
      return api<Bootstrap>(`/bootstrap?${params}`, 'GET', undefined, signal);
    },
    enabled,
  });
}

export function useTaskHistoryQuery(cursor: string | null, enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'history', cursor],
    queryFn: ({ signal }) => {
      const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      return api<TaskHistoryResponse>(`/tasks/history${params}`, 'GET', undefined, signal);
    },
    enabled,
  });
}
