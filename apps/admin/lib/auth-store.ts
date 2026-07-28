import { create } from 'zustand';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The access token lives in memory ONLY — never localStorage/sessionStorage,
 * which an XSS could exfiltrate (Task 11 §4.2). The refresh token stays in the
 * httpOnly cookie set by the API. On idle beyond 30 minutes the token is dropped
 * and the user must re-authenticate.
 */
interface AuthState {
  accessToken: string | null;
  /** Short-lived MFA challenge token, in memory between login and TOTP steps. */
  mfaToken: string | null;
  lastActivity: number;
  setToken: (token: string | null) => void;
  setMfaToken: (token: string | null) => void;
  clear: () => void;
  touch: () => void;
  isIdle: (now?: number) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  mfaToken: null,
  lastActivity: Date.now(),
  setToken: (token) => {
    set({ accessToken: token, lastActivity: Date.now() });
  },
  setMfaToken: (token) => {
    set({ mfaToken: token });
  },
  clear: () => {
    set({ accessToken: null });
  },
  touch: () => {
    set({ lastActivity: Date.now() });
  },
  isIdle: (now = Date.now()) => now - get().lastActivity > IDLE_TIMEOUT_MS,
}));

/** Non-hook accessors so the fetch layer can read/write without a React context. */
export const authToken = {
  get: (): string | null => useAuthStore.getState().accessToken,
  set: (t: string | null): void => {
    useAuthStore.getState().setToken(t);
  },
};
