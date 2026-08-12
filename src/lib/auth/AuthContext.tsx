"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { setAuthToken, wisper } from "@/lib/wisper/client";
import type { Me, Role } from "@/lib/wisper/types";
import * as cognito from "./cognito";
import { type SignUpResult } from "./cognito";
import * as apiKey from "./apiKey";

/** Where the provider is in restoring / establishing a session. */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * How the current session was established: an interactive Cognito sign-in, or a
 * pasted wisper-api API key (the local-dev fallback). Some actions are gated on
 * this — notably minting API keys, which is JWT-only (a key cannot mint keys).
 */
export type AuthMethod = "cognito" | "apiKey";

export interface AuthContextValue {
  status: AuthStatus;
  /** The signed-in account (with additive roles), or null. */
  user: Me | null;
  /** The Cognito ID-token JWT sent as the API bearer token, or null. */
  token: string | null;
  /** How the active session was established, or null when signed out. */
  authMethod: AuthMethod | null;
  /** Convenience: is the active session backed by a pasted API key (not a JWT)? */
  isApiKeySession: boolean;
  /** Convenience: does the account hold the given role? */
  hasRole: (role: Role) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Finish an admin-invited sign-in by setting a permanent password (answers the
   * NEW_PASSWORD_REQUIRED challenge raised by {@link signIn}). Establishes the
   * session on success, exactly like a normal sign-in.
   */
  completeNewPassword: (email: string, newPassword: string) => Promise<void>;
  /**
   * Sign in with a wisper-api API key (local-dev fallback when Cognito is not
   * configured). Holds the key, attaches it as the bearer token, and validates
   * it via GET /v1/me — clearing the held key if the backend rejects it.
   */
  signInWithApiKey: (key: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  signOut: () => void;
  /** Re-fetch GET /v1/me to refresh the account + roles. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the bearer token (Cognito JWT or, for local dev, a pasted wisper-api API
 * key) + hydrated account. On mount it restores an existing Cognito session, or
 * falls back to a stored API key when Cognito is not configured, sets the API
 * bearer token, and calls GET /v1/me to hydrate the user and their roles.
 * Sign-in/out keep the token and `/v1/me` in sync.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<Me | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
  // Guards against a late session-restore overwriting a fresh sign-out.
  const generation = useRef(0);

  // Establish a session from a bearer credential (a Cognito JWT or an API key):
  // attach the token and hydrate /v1/me, recording which method was used.
  const establish = useCallback(async (credential: string, method: AuthMethod) => {
    const gen = ++generation.current;
    setAuthToken(credential);
    setTokenState(credential);
    setAuthMethod(method);
    try {
      const me = await wisper.me();
      if (generation.current !== gen) return; // superseded by a newer auth action
      setUser(me);
      setStatus("authenticated");
    } catch (err) {
      if (generation.current !== gen) return;
      // The credential was accepted upstream but /v1/me failed; treat as signed
      // out so the UI doesn't present a half-authenticated shell.
      setAuthToken(null);
      setTokenState(null);
      setAuthMethod(null);
      setUser(null);
      setStatus("unauthenticated");
      throw err;
    }
  }, []);

  const clear = useCallback(() => {
    generation.current++;
    setAuthToken(null);
    setTokenState(null);
    setAuthMethod(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  // Restore a session on first load: a Cognito session wins; otherwise fall back
  // to a stored API key (the local-dev path for Cognito-less environments).
  useEffect(() => {
    let active = true;
    void (async () => {
      const jwt = await cognito.currentSession();
      if (!active) return;
      if (jwt) {
        try {
          await establish(jwt, "cognito");
        } catch {
          // establish() already reset to unauthenticated.
        }
        return;
      }
      const key = apiKey.getStoredApiKey();
      if (key) {
        try {
          await establish(key, "apiKey");
        } catch {
          // Stored key is invalid/revoked: drop it so we don't retry it forever.
          apiKey.clearStoredApiKey();
        }
      } else {
        setStatus("unauthenticated");
      }
    })();
    return () => {
      active = false;
    };
  }, [establish]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const jwt = await cognito.signIn(email, password);
      await establish(jwt, "cognito");
    },
    [establish],
  );

  const completeNewPassword = useCallback(
    async (email: string, newPassword: string) => {
      const jwt = await cognito.completeNewPassword(email, newPassword);
      await establish(jwt, "cognito");
    },
    [establish],
  );

  const signInWithApiKey = useCallback(
    async (key: string) => {
      apiKey.storeApiKey(key);
      try {
        await establish(key, "apiKey");
      } catch (err) {
        // Backend rejected the key (e.g. 401 bad/revoked): don't keep it around.
        apiKey.clearStoredApiKey();
        throw err;
      }
    },
    [establish],
  );

  const signOut = useCallback(() => {
    cognito.signOut();
    apiKey.clearStoredApiKey();
    clear();
  }, [clear]);

  const refresh = useCallback(async () => {
    const me = await wisper.me();
    setUser(me);
  }, []);

  const hasRole = useCallback(
    (role: Role) => Boolean(user?.roles?.includes(role)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      token,
      authMethod,
      isApiKeySession: authMethod === "apiKey",
      hasRole,
      signIn,
      completeNewPassword,
      signInWithApiKey,
      signUp: cognito.signUp,
      confirmSignUp: cognito.confirmSignUp,
      resendConfirmationCode: cognito.resendConfirmationCode,
      signOut,
      refresh,
    }),
    [
      status,
      user,
      token,
      authMethod,
      hasRole,
      signIn,
      completeNewPassword,
      signInWithApiKey,
      signOut,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the auth context. Throws if used outside an `AuthProvider`. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
