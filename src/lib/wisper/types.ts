// TypeScript types mirroring the Wisper /v1 API contract. The wisper-api docs
// live in a separate repo, so the shapes here are the contract this app builds
// against; they are expanded as endpoints are wired up in later milestones.

/** Liveness (GET /healthz). */
export interface HealthResponse {
  status: string;
}

/** Uniform error envelope: `{ "error": { code, message, request_id, details } }`. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: unknown;
  };
}

/**
 * Account roles. Roles are additive: one account can be a consumer, a host, or
 * both at once. GET /v1/me returns the roles the signed-in account holds.
 */
export type Role = "consumer" | "host";

/** The signed-in account (GET /v1/me). */
export interface Me {
  id: string;
  email: string;
  /** Additive roles held by this account (consumer + optional host). */
  roles: Role[];
  name?: string;
  created_at?: string;
}

/** Contract/lease lifecycle states. */
export type LeaseStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "suspended"
  | "ended"
  | "failed";

/** Container network mode. */
export type WispNetwork = "none" | "open" | "egress";

/**
 * Operating system a host/lease container serves. Optional on every shape: older
 * API builds omit it, so consumers must tolerate `undefined` and fall back to an
 * OS-neutral presentation.
 */
export type HostOs = "linux" | "windows";

/** A host image offered in the catalog, with its price. */
export interface PricedImage {
  id: string;
  name: string;
  description?: string;
  /** Price in micro-USD per second (contract unit); rendered by billing UI. */
  price_micro_usd_per_second?: number;
  enabled?: boolean;
}

/** A host advertising capacity + priced images (GET /v1/catalog). */
export interface CatalogHost {
  id: string;
  name: string;
  region?: string;
  status?: string;
  /** OS the host's containers run, when advertised (older API omits it). */
  os?: HostOs;
  images: PricedImage[];
}

/** Catalog of hosts and their priced images (GET /v1/catalog). */
export interface Catalog {
  hosts: CatalogHost[];
}

/** Requested compute for a lease. */
export interface LeaseResources {
  cpu?: number;
  memory_mb?: number;
  disk_mb?: number;
}

/** Body for POST /v1/leases. */
export interface CreateLeaseRequest {
  host_id: string;
  host_image_id: string;
  network: WispNetwork;
  resources?: LeaseResources;
  ttl_seconds: number;
  userdata?: string;
}

/** A lease (GET /v1/leases[/:id], POST /v1/leases). */
export interface Lease {
  id: string;
  status: LeaseStatus;
  host_id: string;
  host_image_id: string;
  network: WispNetwork;
  resources?: LeaseResources;
  ttl_seconds: number;
  /** OS of the leased container, when known (older API omits it). */
  os?: HostOs;
  /**
   * Server's snapshot of the lease's remaining time-to-live, in seconds. The
   * detail view counts this down live between polls and re-syncs to the value
   * from each GET /v1/leases/:id.
   */
  ttl_seconds_remaining?: number;
  created_at: string;
  started_at?: string;
  expires_at?: string;
  ended_at?: string;
  /** Accrued cost so far, in micro-USD. */
  cost_micro_usd?: number;
  /**
   * Effective per-second price for this lease, in micro-USD/second. When present
   * the detail view uses it to tick running cost forward between polls.
   */
  price_micro_usd_per_second?: number;
}

/** Body for POST /v1/leases/:id/exec. */
export interface ExecRequest {
  command: string[];
  /** Optional stdin to pipe to the command. */
  stdin?: string;
}

/** Result of a non-streaming exec (POST /v1/leases/:id/exec). */
export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/** One-time ticket for the browser shell/WS handshake. */
export interface ShellTicket {
  ticket: string;
}

/** Wallet balance + usage summary (GET /v1/billing). */
export interface Billing {
  /** Current balance in micro-USD. */
  balance_micro_usd: number;
  currency: string;
  /** Optional lifetime spend on leases, in micro-USD. */
  spent_micro_usd?: number;
  /** Optional lifetime top-ups, in micro-USD. */
  topped_up_micro_usd?: number;
  /** Optional funds held for in-flight leases, in micro-USD. */
  pending_micro_usd?: number;
}

/** A billing ledger entry (GET /v1/billing/transactions). */
export interface Transaction {
  id: string;
  /** Signed amount in micro-USD (credit positive, debit negative). */
  amount_micro_usd: number;
  type: string;
  description?: string;
  created_at: string;
}

/** Query params for the paginated transactions ledger. */
export interface TransactionsQuery {
  /** Page size to request. */
  limit?: number;
  /** Opaque cursor returned as `next_cursor` by the previous page. */
  cursor?: string;
}

/**
 * A page of ledger entries. The API may return either a bare array or this
 * envelope; the client normalizes both to this shape (see `getTransactions`).
 */
export interface TransactionPage {
  transactions: Transaction[];
  /** Cursor for the next page, absent when this is the last page. */
  next_cursor?: string;
}

/** Body for POST /v1/billing/topup. */
export interface TopupRequest {
  /** Amount to add in micro-USD. */
  amount_micro_usd: number;
}

/** Stripe PaymentIntent client secret for a top-up (POST /v1/billing/topup). */
export interface TopupResponse {
  client_secret: string;
}

/** A host image with pricing (host-side view). */
export interface HostImage {
  id: string;
  name: string;
  price_micro_usd_per_second?: number;
  enabled?: boolean;
}

/** A host owned by the signed-in account (GET /v1/hosts/mine). */
export interface Host {
  id: string;
  name: string;
  region?: string;
  status?: string;
  /** OS the host's containers run, when advertised (GET /v1/hosts/:id). */
  os?: HostOs;
  images?: HostImage[];
  created_at?: string;
  /** The manager WebSocket the host agent connects back to. */
  manager_ws?: string;
}

/** Body for POST /v1/hosts (register a host). */
export interface RegisterHostRequest {
  name: string;
  region?: string;
}

/**
 * Response for POST /v1/hosts. The `agent_token` is returned exactly once at
 * registration and cannot be retrieved again, so callers must surface it now.
 * `manager_ws` is the WebSocket the freshly-installed agent dials back to.
 */
export interface RegisterHostResponse {
  host: Host;
  agent_token: string;
  /** The manager WebSocket URL the agent connects to (falls back to `host.manager_ws`). */
  manager_ws?: string;
}

/** Body for PUT/PATCH /v1/hosts/:id/images. */
export interface UpdateHostImagesRequest {
  images: HostImage[];
}

/** Stripe Connect onboarding link (POST /v1/hosts/connect). */
export interface ConnectResponse {
  onboarding_url: string;
}

/**
 * A scope a consumer API key can carry. Scopes are a subset of the minting
 * account's roles (`consumer`/`host`); `admin` exists in the contract but the UI
 * never offers it. The backend is authoritative and caps requested scopes to the
 * minter's roles, so the UI only surfaces its validation errors verbatim.
 */
export type ApiKeyScope = "consumer" | "host" | "admin";

/**
 * A machine API key (GET /v1/me/api-keys). The full secret (`wck_live_<64-hex>`)
 * is only ever returned once at creation; the list carries just the non-secret
 * `token_prefix` and metadata. Revoked keys stay listed with `revoked_at` set.
 */
export interface ApiKey {
  id: string;
  name: string;
  /** Non-secret leading portion of the key, e.g. `wck_live_abcd…`. */
  token_prefix: string;
  scopes: ApiKeyScope[];
  created_at: string;
  /** When the key last authenticated a request, if ever. */
  last_used_at?: string;
  /** Set once the key is revoked; a revoked key 401s but stays in the list. */
  revoked_at?: string;
}

/** Body for POST /v1/me/api-keys (mint a key). */
export interface CreateApiKeyRequest {
  name: string;
  /** Requested scopes; the backend caps them to the minter's roles. */
  scopes?: ApiKeyScope[];
}

/**
 * Response for POST /v1/me/api-keys. The `token` is the full `wck_live_<64-hex>`
 * secret, returned EXACTLY once at creation and never retrievable again, so
 * callers must surface it now. `key` is the stored metadata for the list.
 */
export interface CreateApiKeyResponse {
  key: ApiKey;
  token: string;
}

/** Stripe Connect account state for the host, surfaced with earnings. */
export type ConnectStatus = "not_started" | "pending" | "active" | "restricted";

/** Host earnings summary (GET /v1/earnings). */
export interface Earnings {
  /** Total earned, in micro-USD. */
  total_micro_usd: number;
  /** Amount available for payout, in micro-USD. */
  available_micro_usd?: number;
  /** Earned but not yet available for payout, in micro-USD. */
  pending_micro_usd?: number;
  /** Lifetime amount already paid out, in micro-USD. */
  paid_out_micro_usd?: number;
  currency: string;
  /** Whether Stripe Connect payouts are enabled for this account. */
  payouts_enabled?: boolean;
  /** Coarse Stripe Connect onboarding state, when reported. */
  connect_status?: ConnectStatus;
}
