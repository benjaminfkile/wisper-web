// Local-dev fallback auth: when Cognito is not configured, the operator defines
// a consumer API key in wisper-api's `Auth:ApiKeys` config map and the user
// pastes it here. The key (`wck_live_<64-hex>`) is sent EXACTLY like the Cognito
// JWT — `Authorization: Bearer <key>` — and the backend resolves it to the
// owning principal with the key's stored scopes. This module only HOLDS a pasted
// key in localStorage so it survives reloads; validation is the backend's job
// (GET /v1/me), and a Cognito session always takes precedence over a stored key.

/** localStorage key under which a pasted wisper-api API key is held. */
const STORAGE_KEY = "wisper.web.apiKey";

/** localStorage access that never throws (private mode, SSR, disabled storage). */
function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The API key held for this browser, or null when none is stored. */
export function getStoredApiKey(): string | null {
  return storage()?.getItem(STORAGE_KEY) ?? null;
}

/** Persist an API key so it survives reloads. */
export function storeApiKey(key: string): void {
  storage()?.setItem(STORAGE_KEY, key);
}

/** Remove any held API key (sign-out, or after the backend rejects it). */
export function clearStoredApiKey(): void {
  storage()?.removeItem(STORAGE_KEY);
}
