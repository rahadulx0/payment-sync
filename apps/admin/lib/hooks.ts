'use client';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest, type RequestOptions } from './api-client';

/** Typed GET hook keyed by path + query. */
export function useApiQuery<T>(
  path: string,
  query?: RequestOptions['query'],
  enabled = true,
): UseQueryResult<T> {
  return useQuery<T>({
    queryKey: [path, query ?? {}],
    queryFn: () => apiRequest<T>(path, query !== undefined ? { query } : {}),
    enabled,
  });
}

/** Typed mutation hook; invalidates the given key prefixes on success. */
export function useApiMutation<TResult, TVars>(
  make: (vars: TVars) => { path: string; options?: RequestOptions },
  invalidate: string[] = [],
) {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TVars>({
    mutationFn: (vars) => {
      const { path, options } = make(vars);
      return apiRequest<TResult>(path, options ?? {});
    },
    onSuccess: () => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}
