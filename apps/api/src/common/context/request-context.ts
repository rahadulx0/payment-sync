import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  requestId: string;
  companyId?: string;
  deviceId?: string;
  adminId?: string;
  route?: string;
}

const als = new AsyncLocalStorage<RequestContextData>();

/** AsyncLocalStorage-backed per-request context carrying the request id and resolved caller identity. */
export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return als.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return als.getStore();
  },
  set(patch: Partial<RequestContextData>): void {
    const store = als.getStore();
    if (store) Object.assign(store, patch);
  },
  requestId(): string {
    return als.getStore()?.requestId ?? 'no-request-id';
  },
};
