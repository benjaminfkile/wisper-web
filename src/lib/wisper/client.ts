import type {
  ApiKey,
  Billing,
  Catalog,
  CatalogHost,
  CatalogQuery,
  ConnectResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateLeaseRequest,
  ErrorEnvelope,
  ExecRequest,
  ExecResult,
  HealthResponse,
  Host,
  HostImage,
  Lease,
  Me,
  MyHosts,
  RegisterHostRequest,
  RegisterHostResponse,
  ShellTicket,
  TopupRequest,
  TopupResponse,
  Transaction,
  TransactionPage,
  TransactionsQuery,
  UpdateHostImagesRequest,
} from "./types";

// The app always calls same-origin `/wisper/*`; Next rewrites it to the Wisper API
// (see next.config.mjs), so there is no CORS in the browser.
const BASE = "/wisper";

/**
 * A fresh UUID v4 for Idempotency-Key headers. `crypto.randomUUID()` only exists
 * in secure contexts (HTTPS or localhost), so it is absent when the app is served
 * over plain HTTP to a LAN IP — falling back to `crypto.getRandomValues`, which is
 * available in insecure contexts too, keeps lease/top-up creation working there.
 */
function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

/**
 * The Cognito JWT attached as `Authorization: Bearer` on every request. The auth
 * provider owns this value and calls `setAuthToken` on sign-in / sign-out /
 * session restore, keeping the client decoupled from React state.
 */
let authToken: string | null = null;

/** Set (or clear, with `null`) the bearer token used for authenticated calls. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** The currently attached bearer token, if any. */
export function getAuthToken(): string | null {
  return authToken;
}

/** Absolute same-origin path for an API route (e.g. `/wisper/v1/...`). */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

/**
 * Headers for a hand-rolled `fetch` (streaming exec, etc.) that needs the same
 * bearer auth as `request` but can't go through it — merges the current token
 * with any caller-supplied headers.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

/** A typed Wisper API error, parsed from the uniform error envelope. */
export class WisperError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "WisperError";
  }
}

/** Request options: standard `fetch` init plus a `json` body convenience. */
export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  /** Serialized as a JSON body with the appropriate content-type. */
  json?: unknown;
}

/** Perform a JSON request against the Wisper API, throwing WisperError on non-2xx. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, headers, ...init } = options;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string> | undefined),
  };
  if (authToken) finalHeaders.Authorization = `Bearer ${authToken}`;

  let body = init.body ?? undefined;
  if (json !== undefined) {
    body = JSON.stringify(json);
    finalHeaders["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers: finalHeaders, body });

  if (!res.ok) {
    let code = "internal";
    let message = res.statusText || "request failed";
    let requestId: string | undefined;
    let details: unknown;
    try {
      const parsed = (await res.json()) as Partial<ErrorEnvelope>;
      if (parsed.error) {
        code = parsed.error.code ?? code;
        message = parsed.error.message ?? message;
        requestId = parsed.error.request_id;
        details = parsed.error.details;
      }
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new WisperError(res.status, code, message, requestId, details);
  }

  // 204 (and other empty) responses have no JSON body — e.g. DELETE leases.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Normalize a transactions response into a {@link TransactionPage}. The real
 * endpoint returns a `{ data, next_cursor }` envelope; this also tolerates a bare
 * array (unpaginated) and the legacy `{ transactions, next_cursor }` shape, so
 * callers get the same clean shape regardless of drift.
 */
export function normalizeTransactionPage(
  body:
    | TransactionPage
    | { data?: Transaction[]; next_cursor?: string }
    | Transaction[]
    | null
    | undefined,
): TransactionPage {
  if (Array.isArray(body)) return { transactions: body };
  const envelope = body as
    | { data?: Transaction[]; transactions?: Transaction[]; next_cursor?: string }
    | null
    | undefined;
  return {
    transactions: envelope?.data ?? envelope?.transactions ?? [],
    next_cursor: envelope?.next_cursor,
  };
}

/**
 * Normalize a GET /v1/me/api-keys response into a plain `ApiKey[]`. The real
 * endpoint returns a `{ data }` envelope; this also tolerates a bare array and
 * the legacy `{ api_keys }` / `{ keys }` envelopes (mirrors
 * {@link normalizeTransactionPage}).
 */
export function normalizeApiKeyList(
  body:
    | ApiKey[]
    | { data?: ApiKey[]; api_keys?: ApiKey[]; keys?: ApiKey[] }
    | null
    | undefined,
): ApiKey[] {
  if (Array.isArray(body)) return body;
  return body?.data ?? body?.api_keys ?? body?.keys ?? [];
}

/**
 * Normalize a GET /v1/catalog response into a {@link Catalog}. The real endpoint
 * returns `{ data, next_cursor }`; this also tolerates a bare array and the
 * legacy `{ hosts }` envelope so the browser always receives a clean host list.
 */
export function normalizeCatalog(
  body:
    | Catalog
    | { data?: CatalogHost[]; hosts?: CatalogHost[]; next_cursor?: string }
    | CatalogHost[]
    | null
    | undefined,
): Catalog {
  if (Array.isArray(body)) return { data: body };
  const envelope = body as
    | { data?: CatalogHost[]; hosts?: CatalogHost[]; next_cursor?: string }
    | null
    | undefined;
  return {
    data: envelope?.data ?? envelope?.hosts ?? [],
    next_cursor: envelope?.next_cursor,
  };
}

/**
 * Normalize a GET /v1/hosts/mine response into a {@link MyHosts}. The real
 * endpoint returns `{ data, earnings }`; this also tolerates a bare array and the
 * legacy `{ hosts }` envelope so the host tools page always gets a host list plus
 * (when present) the earnings block it renders for free.
 */
export function normalizeMyHosts(
  body:
    | MyHosts
    | { data?: Host[]; hosts?: Host[]; earnings?: MyHosts["earnings"]; next_cursor?: string }
    | Host[]
    | null
    | undefined,
): MyHosts {
  if (Array.isArray(body)) return { data: body };
  const envelope = body as
    | { data?: Host[]; hosts?: Host[]; earnings?: MyHosts["earnings"]; next_cursor?: string }
    | null
    | undefined;
  return {
    data: envelope?.data ?? envelope?.hosts ?? [],
    earnings: envelope?.earnings,
    next_cursor: envelope?.next_cursor,
  };
}

/**
 * Normalize a GET /v1/leases response into a plain `Lease[]`. The real endpoint
 * returns `{ data, next_cursor }`; this also tolerates a bare array (legacy)
 * so the lease list never crashes on `.map` of a non-array.
 */
export function normalizeLeaseList(
  body: Lease[] | { data?: Lease[]; next_cursor?: string } | null | undefined,
): Lease[] {
  if (Array.isArray(body)) return body;
  return body?.data ?? [];
}

/** Liveness check against the Wisper API. Never throws. */
export async function getHealth(): Promise<boolean> {
  try {
    const body = await request<HealthResponse>("/healthz");
    return body.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Typed wrappers for the Wisper /v1 API. Every call attaches the bearer token
 * (when set) and surfaces failures as `WisperError`.
 */
export const wisper = {
  /** GET /v1/me — the signed-in account with its additive roles. */
  me: () => request<Me>("/v1/me"),

  /**
   * GET /v1/catalog — hosts and their priced images. Accepts the optional
   * `min_gpus`/`gpu_class` filters (forwarded as query params; omitted when off
   * so a zero-GPU browse hits the same bare `/v1/catalog` as before). Resolves to
   * a normalized {@link Catalog} (`{ data, next_cursor }`), tolerating a bare
   * array or a legacy `{ hosts }` envelope.
   */
  getCatalog: (query: CatalogQuery = {}): Promise<Catalog> => {
    const params = new URLSearchParams();
    if (query.min_gpus != null && query.min_gpus > 0) {
      params.set("min_gpus", String(Math.floor(query.min_gpus)));
    }
    if (query.gpu_class) params.set("gpu_class", query.gpu_class);
    const qs = params.toString();
    return request<Catalog | CatalogHost[]>(`/v1/catalog${qs ? `?${qs}` : ""}`).then(
      normalizeCatalog,
    );
  },

  /** POST /v1/leases — create a lease. The API REQUIRES an Idempotency-Key on
   * this call; a fresh key per invocation is correct (each click is a distinct
   * provision — a browser retry of the same response is what the key guards). */
  createLease: (input: CreateLeaseRequest) =>
    request<Lease>("/v1/leases", {
      method: "POST",
      json: input,
      headers: { "Idempotency-Key": newIdempotencyKey() },
    }),

  /**
   * GET /v1/leases — the caller's leases. The real endpoint returns
   * `{ data, next_cursor }`; this normalizes to a `Lease[]` (tolerating a bare
   * array) so the list renders without crashing on the envelope.
   */
  listLeases: (): Promise<Lease[]> =>
    request<Lease[] | { data?: Lease[]; next_cursor?: string }>("/v1/leases").then(
      normalizeLeaseList,
    ),

  /** GET /v1/leases/:id — a single lease. */
  getLease: (id: string) => request<Lease>(`/v1/leases/${encodeURIComponent(id)}`),

  /** DELETE /v1/leases/:id — end a lease. */
  deleteLease: (id: string) =>
    request<void>(`/v1/leases/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** POST /v1/leases/:id/exec — run a command (non-streaming). */
  exec: (id: string, input: ExecRequest) =>
    request<ExecResult>(`/v1/leases/${encodeURIComponent(id)}/exec`, {
      method: "POST",
      json: input,
    }),

  /** POST /v1/leases/:id/shell-ticket — mint a one-time WS shell ticket. */
  shellTicket: (id: string) =>
    request<ShellTicket>(`/v1/leases/${encodeURIComponent(id)}/shell-ticket`, {
      method: "POST",
    }),

  /** GET /v1/billing — wallet balance. */
  getBilling: () => request<Billing>("/v1/billing"),

  /**
   * GET /v1/billing/transactions — a page of ledger entries. Accepts an optional
   * `limit`/`cursor` and always resolves to a normalized {@link TransactionPage}.
   */
  getTransactions: (query: TransactionsQuery = {}): Promise<TransactionPage> => {
    const params = new URLSearchParams();
    if (query.limit != null) params.set("limit", String(query.limit));
    if (query.cursor) params.set("cursor", query.cursor);
    const qs = params.toString();
    return request<
      TransactionPage | { data?: Transaction[]; next_cursor?: string } | Transaction[]
    >(`/v1/billing/transactions${qs ? `?${qs}` : ""}`).then(normalizeTransactionPage);
  },

  /** POST /v1/billing/topup — start a Stripe top-up, returns a client secret.
   * The API REQUIRES an Idempotency-Key here (docs/API.md §5). */
  topup: (input: TopupRequest) =>
    request<TopupResponse>("/v1/billing/topup", {
      method: "POST",
      json: input,
      headers: { "Idempotency-Key": newIdempotencyKey() },
    }),

  /** POST /v1/hosts — register a host; `agent_token` is returned once. */
  registerHost: (input: RegisterHostRequest) =>
    request<RegisterHostResponse>("/v1/hosts", { method: "POST", json: input }),

  /**
   * GET /v1/hosts/mine — hosts owned by the account. Resolves to a normalized
   * {@link MyHosts} (`{ data, earnings }`), tolerating a bare array or a legacy
   * `{ hosts }` envelope. The earnings block comes back on the same call.
   */
  myHosts: (): Promise<MyHosts> =>
    request<MyHosts | Host[]>("/v1/hosts/mine").then(normalizeMyHosts),

  /** GET /v1/hosts/:id/images — the host's current priced image list, with
   * price, networks, and max_ttl_seconds. `GET /v1/hosts/mine` omits images, so
   * this is the source the editor loads to avoid a blank PUT wiping the list. */
  getHostImages: (id: string): Promise<HostImage[]> =>
    request<{ data?: HostImage[] } | HostImage[]>(
      `/v1/hosts/${encodeURIComponent(id)}/images`,
    ).then((r) => (Array.isArray(r) ? r : r.data ?? [])),

  /** PUT /v1/hosts/:id/images — replace a host's image pricing. */
  updateHostImages: (id: string, input: UpdateHostImagesRequest) =>
    request<Host>(`/v1/hosts/${encodeURIComponent(id)}/images`, {
      method: "PUT",
      json: input,
    }),

  /** POST /v1/hosts/connect — Stripe Connect onboarding link. */
  hostConnect: () => request<ConnectResponse>("/v1/hosts/connect", { method: "POST" }),

  /** GET /v1/me/api-keys — the account's machine API keys (no secrets). */
  listApiKeys: (): Promise<ApiKey[]> =>
    request<ApiKey[] | { api_keys?: ApiKey[]; keys?: ApiKey[] }>("/v1/me/api-keys").then(
      normalizeApiKeyList,
    ),

  /**
   * POST /v1/me/api-keys — mint a key; the full secret is returned exactly once.
   * JWT-only by design: minting from an API-key session 403s (a key can't mint
   * keys), which surfaces as a {@link WisperError} the caller renders verbatim.
   */
  createApiKey: (input: CreateApiKeyRequest) =>
    request<CreateApiKeyResponse>("/v1/me/api-keys", { method: "POST", json: input }),

  /** DELETE /v1/me/api-keys/:id — revoke a key (it stays listed, revoked). */
  revokeApiKey: (id: string) =>
    request<void>(`/v1/me/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/**
 * Build the WebSocket URL for a lease shell, carrying a one-time ticket minted
 * by `shellTicket` (the ticket in the query string is the auth, so a cross-origin
 * WS needs no cookie/CORS).
 *
 * When `NEXT_PUBLIC_WISPER_API_ORIGIN` is set, connect DIRECTLY to the Wisper API
 * origin (`https://…` → `wss://…`, `http://…` → `ws://…`, preserving its path
 * prefix). This is required on Vercel, which serves the app but CANNOT proxy a
 * WebSocket upgrade through Next `rewrites()` — a same-origin `/wisper/*` WS
 * handshake there returns 400. Regular HTTP still uses the same-origin `/wisper`
 * rewrite (no CORS); only this WS path takes the direct origin.
 *
 * When the env is UNSET, fall back to the same-origin `/wisper` URL so local
 * `next dev`/`next start` (a real Node server that proxies WS fine) is unchanged.
 */
export function shellSocketUrl(leaseId: string, ticket: string): string {
  const suffix = `/v1/leases/${encodeURIComponent(leaseId)}/shell?ticket=${encodeURIComponent(
    ticket,
  )}`;

  const origin = process.env.NEXT_PUBLIC_WISPER_API_ORIGIN;
  if (origin) {
    // Direct cross-origin WS to the API: swap the http(s) scheme for ws(s) and
    // keep the origin's path prefix (e.g. `/wisper-api-dev`), trimming any
    // trailing slash so we don't produce a `//v1` path.
    const base = origin.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`).replace(/\/+$/, "");
    return `${base}${suffix}`;
  }

  // Same-origin fallback: Next rewrites `/wisper/*` to the API (HTTP + WS locally).
  const proto =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host = typeof window !== "undefined" ? window.location.host : "";
  return `${proto}://${host}${BASE}${suffix}`;
}
