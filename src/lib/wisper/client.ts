import type {
  Billing,
  Catalog,
  ConnectResponse,
  CreateLeaseRequest,
  Earnings,
  ErrorEnvelope,
  ExecRequest,
  ExecResult,
  HealthResponse,
  Host,
  Lease,
  Me,
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
 * Normalize a transactions response into a {@link TransactionPage}. The endpoint
 * may return a bare array (unpaginated) or a `{ transactions, next_cursor }`
 * envelope; callers get the same shape either way.
 */
export function normalizeTransactionPage(
  body: TransactionPage | Transaction[] | null | undefined,
): TransactionPage {
  if (Array.isArray(body)) return { transactions: body };
  return {
    transactions: body?.transactions ?? [],
    next_cursor: body?.next_cursor,
  };
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

  /** GET /v1/catalog — hosts and their priced images. */
  getCatalog: () => request<Catalog>("/v1/catalog"),

  /** POST /v1/leases — create a lease. */
  createLease: (input: CreateLeaseRequest) =>
    request<Lease>("/v1/leases", { method: "POST", json: input }),

  /** GET /v1/leases — the caller's leases. */
  listLeases: () => request<Lease[]>("/v1/leases"),

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
    return request<TransactionPage | Transaction[]>(
      `/v1/billing/transactions${qs ? `?${qs}` : ""}`,
    ).then(normalizeTransactionPage);
  },

  /** POST /v1/billing/topup — start a Stripe top-up, returns a client secret. */
  topup: (input: TopupRequest) =>
    request<TopupResponse>("/v1/billing/topup", { method: "POST", json: input }),

  /** POST /v1/hosts — register a host; `agent_token` is returned once. */
  registerHost: (input: RegisterHostRequest) =>
    request<RegisterHostResponse>("/v1/hosts", { method: "POST", json: input }),

  /** GET /v1/hosts/mine — hosts owned by the account. */
  myHosts: () => request<Host[]>("/v1/hosts/mine"),

  /** PUT /v1/hosts/:id/images — replace a host's image pricing. */
  updateHostImages: (id: string, input: UpdateHostImagesRequest) =>
    request<Host>(`/v1/hosts/${encodeURIComponent(id)}/images`, {
      method: "PUT",
      json: input,
    }),

  /** POST /v1/hosts/connect — Stripe Connect onboarding link. */
  hostConnect: () => request<ConnectResponse>("/v1/hosts/connect", { method: "POST" }),

  /** GET /v1/earnings — host earnings summary. */
  getEarnings: () => request<Earnings>("/v1/earnings"),
};

/**
 * Build the same-origin WebSocket URL for a lease shell, carrying a one-time
 * ticket minted by `shellTicket`. Used by the console (xterm) milestone.
 */
export function shellSocketUrl(leaseId: string, ticket: string): string {
  const proto =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host = typeof window !== "undefined" ? window.location.host : "";
  return `${proto}://${host}${BASE}/v1/leases/${encodeURIComponent(
    leaseId,
  )}/shell?ticket=${encodeURIComponent(ticket)}`;
}
