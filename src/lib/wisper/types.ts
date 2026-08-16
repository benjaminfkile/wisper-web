// ============================================================================
// CONTRACT
// These types mirror the wisper-api /v1 contract as documented in wisper-api's
// `docs/API.md`, and were LIVE-VERIFIED against a running wisper-api on
// 2026-07-20 (the first time this app ran against the real API, via API-key
// sign-in). Money is denominated in whole CENTS everywhere the API uses it
// (`*_cents`, `price_cents_per_min`), matching the real contract — NOT the
// micro-USD unit the app originally guessed.
//
// List endpoints return a `{ data, next_cursor }` (or `{ data, next_offset }`)
// envelope, never a bare array; `GET /v1/hosts/mine` additionally carries an
// `earnings` block alongside `data`. The client (client.ts) parses these
// TOLERANTLY — it accepts the documented envelope, legacy field names, and a
// bare array — so components receive clean typed arrays/objects and never crash
// on shape drift again. If you change a shape here, update client.ts's
// normalizers and the tests that pin them, and keep this paper trail current.
//
// 2026-08-09: offers now carry a FIXED per-offer size profile — `cpus`
// (int|null), `memory_mb` (int|null), `gpus` (int, EXACT). An offer is a size at
// a price, like an instance type. `null` cpus/memory means the host-side
// default. `gpus` REPLACES the old `max_gpus` ceiling everywhere in payloads
// (offer + host-image shapes). All three are optional so an older API that omits
// them degrades gracefully (absent = host default / CPU-only), preserving the
// tolerant-normalizer discipline.
//
// 2026-08-09 (create-lease sells sizes): POST /v1/leases now REJECTS free-form
// resources — a lease provisions EXACTLY the selected offer's profile, so the
// request body no longer carries `resources`/`gpus`, and a lease RESPONSE echoes
// the provisioned profile as flat `cpus`/`memory_mb`/`gpus` (mirroring the offer
// shape) rather than a nested `resources` blob. Lease creation fast-fails with
// the existing `at_capacity` (409) code when a host is full, and the
// catalog/host payloads gain a per-host `at_capacity` (bool) plus optional
// `active_leases`/`max_leases` ints. All new fields are optional — an older API
// that omits them degrades to the prior behavior (no capacity badge, no profile).
//
// 2026-08-09 (resolved effective sizes): the API now RESOLVES an offer's/lease's
// effective compute so a consumer never sees a bare "host default" with no
// number. Catalog offers and lease responses gain `effective_cpus` (int|null),
// `effective_memory_mb` (int|null), and `resources_source` — a ResourcesSource
// marker (`"offer"` = from the offer's own profile, `"host_cap"` = the offer
// defaulted and this is the host's cap, `"unknown"` = unresolvable). The UI
// renders the effective numbers, subtly flags a `"host_cap"` value, and only
// falls back to "unspecified" for a genuine `"unknown"`. All three are optional:
// an older API that omits them degrades to the raw `cpus`/`memory_mb` (numbered
// when present, "unspecified" when it carried no size), preserving the tolerant-
// normalizer discipline.
//
// 2026-08-10 (host per-lease caps): the host now advertises its REAL per-lease
// compute cap as `host_max_cpus` (int|null) and `host_max_memory_mb` (int|null,
// whole MB) on `GET /v1/hosts/mine` and `GET /v1/hosts/:id/images`; both are
// `null` when the host is offline / not advertising. A PUT /v1/hosts/:id/images
// that exceeds a cap is REJECTED with `validation_error` carrying `{field, max}`
// details. The image editor prefills new offers with these numbers, bounds the
// inputs to them, and surfaces the rejection details verbatim. Both fields are
// optional so an older API that omits them degrades to unbounded inputs.
// ============================================================================

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
 * Ordered isolation level a lease's container runs under, weakest to strongest:
 * `shared` (shared host kernel), `sandboxed` (gVisor user-space kernel), `vm`
 * (hardware-virtualized). The API is authoritative about which levels a host
 * offers; the type stays a plain string-union so an unknown future level from a
 * newer API is still carried and displayed rather than dropped.
 */
export type IsolationLevel = "shared" | "sandboxed" | "vm";

/**
 * Operating system a host/lease container serves. Optional on every shape: older
 * API builds omit it, so consumers must tolerate `undefined` and fall back to an
 * OS-neutral presentation.
 */
export type HostOs = "linux" | "windows";

/**
 * Where an offer's/lease's EFFECTIVE size came from, resolved server-side:
 * `"offer"` — the offer's own `cpus`/`memory_mb` profile; `"host_cap"` — the
 * offer left a dimension to the host and the effective number is the host's cap
 * (annotate, don't hide the number); `"unknown"` — unresolvable, the only case
 * that falls back to an "unspecified" label. Absent on an older API that hasn't
 * resolved effective values, so consumers must tolerate `undefined`.
 */
export type ResourcesSource = "offer" | "host_cap" | "unknown";

/**
 * A priced image offered by a catalog host (item of `GET /v1/catalog`'s `data`).
 * Prices are in CENTS PER MINUTE. `image_ref` is the pullable image reference
 * (also the display name), `host_image_id` the id a lease is created against.
 */
export interface PricedImage {
  host_image_id: string;
  image_ref: string;
  /** Price in whole cents per minute of runtime. */
  price_cents_per_min: number;
  currency?: string;
  /** Network modes this image supports. */
  networks?: WispNetwork[];
  max_ttl_seconds?: number;
  max_cpus?: number;
  max_memory_mb?: number;
  max_pids?: number;
  /**
   * Fixed size profile of this offer — it is a SIZE at a price, like an instance
   * type. `cpus`/`memory_mb` are `null` (or absent) when the offer takes the
   * host-side default and are shown as "host default". `memory_mb` is whole
   * megabytes (the UI shows/enters it in GB). Absent on an older API, in which
   * case the size chips fall back to "host default".
   */
  cpus?: number | null;
  memory_mb?: number | null;
  /**
   * EXACT number of GPUs this offer provides (not a ceiling). Absent or `0`
   * (older API / a CPU-only offer) means no GPU: the badge and the create-flow
   * GPU input are hidden. REPLACES the old `max_gpus` field everywhere.
   */
  gpus?: number;
  /**
   * Server-resolved EFFECTIVE size of this offer — the compute a lease actually
   * gets. When `cpus`/`memory_mb` are `null` (host-defaulted), these carry the
   * resolved host-cap numbers so the chip shows a real value, not a bare label.
   * Read WITH `resources_source`: `"host_cap"` means annotate the number. Absent
   * on an older API, in which case the raw `cpus`/`memory_mb` are used as-is.
   */
  effective_cpus?: number | null;
  effective_memory_mb?: number | null;
  /** Where {@link PricedImage.effective_cpus}/`effective_memory_mb` came from. */
  resources_source?: ResourcesSource;
}

/**
 * A catalog host advertising priced images (item of `GET /v1/catalog`'s `data`).
 * Identified by `host_id`; `label` is the human name; `online` is its liveness.
 */
export interface CatalogHost {
  host_id: string;
  label: string;
  region?: string;
  /** Whether the host is currently connected/available for new leases. */
  online?: boolean;
  /** OS the host's containers run, when advertised (older API omits it). */
  os?: HostOs;
  /**
   * Isolation levels this HOST can provide, weakest-to-strongest set (every image
   * on the host can be leased under any of them). Returned per-host by the catalog
   * — NOT per-image. When absent (older API) the UI shows no isolation control and
   * the create flow sends none.
   */
  isolation_levels?: IsolationLevel[];
  /** The level pre-selected in the create flow; one of `isolation_levels`. */
  default_isolation?: IsolationLevel;
  /**
   * GPU classes this host advertises (e.g. `["A100", "H100"]`), when present.
   * Older API builds omit it, so consumers must tolerate `undefined` and show no
   * GPU presentation. Paired with `gpu_count` for the host's total GPU inventory.
   */
  gpu_classes?: string[];
  /** Total GPUs the host advertises, when present (older API omits it). */
  gpu_count?: number;
  /**
   * Whether the host is FULL — it has no free lease slot right now, so lease
   * creation would fast-fail with `at_capacity` (409). Absent on an older API,
   * in which case no capacity badge shows and creation is not pre-disabled.
   */
  at_capacity?: boolean;
  /** Leases currently running on the host, when reported (older API omits it). */
  active_leases?: number;
  /** The host's concurrent-lease ceiling, when reported (older API omits it). */
  max_leases?: number;
  images: PricedImage[];
}

/**
 * The catalog page (`GET /v1/catalog`): `{ data, next_cursor }`. The cursor is
 * threaded through the type so pagination can be added later without changing
 * the shape; the current UI renders the whole first page.
 */
export interface Catalog {
  data: CatalogHost[];
  /** Opaque cursor for the next page, absent on the last page. */
  next_cursor?: string;
}

/**
 * Query params for `GET /v1/catalog`. Both filters are optional; when absent (or
 * `min_gpus` ≤ 0 / `gpu_class` blank) the client omits them and the browse hits
 * the plain endpoint, so a zero-GPU catalog is byte-for-byte the old request.
 */
export interface CatalogQuery {
  /** Only hosts/offers with at least this many GPUs (integer, > 0 to apply). */
  min_gpus?: number;
  /** Only hosts advertising this GPU class (e.g. `"A100"`). */
  gpu_class?: string;
}

/**
 * Body for POST /v1/leases. A lease provisions EXACTLY the selected offer's size
 * profile, so this body carries NO `resources`/`gpus` — the API rejects free-form
 * compute (`validation_error`). The size comes from `host_image_id` alone.
 */
export interface CreateLeaseRequest {
  host_id: string;
  host_image_id: string;
  network: WispNetwork;
  ttl_seconds: number;
  userdata?: string;
  /** Chosen isolation level; omitted when the host advertises none to choose. */
  isolation?: IsolationLevel;
}

/** A lease (GET /v1/leases[/:id], POST /v1/leases). */
export interface Lease {
  id: string;
  status: LeaseStatus;
  host_id: string;
  host_image_id: string;
  network: WispNetwork;
  ttl_seconds: number;
  /**
   * Provisioned size profile of the lease — the selected offer's fixed profile,
   * echoed back on the lease. `cpus`/`memory_mb` are `null` (or absent) when the
   * offer took the host-side default; `memory_mb` is whole megabytes. `gpus` is
   * the EXACT provisioned GPU count (absent or `0` = CPU-only). All optional so
   * an older API that omits them degrades to no profile display.
   */
  cpus?: number | null;
  memory_mb?: number | null;
  gpus?: number;
  /**
   * Server-resolved EFFECTIVE size of this lease — the compute it actually runs.
   * When `cpus`/`memory_mb` were host-defaulted, these carry the resolved
   * host-cap numbers, read together with `resources_source` (`"host_cap"` =
   * annotate the number). Absent on a lease created before this change, which
   * degrades to the raw `cpus`/`memory_mb` (or "unspecified" when it had none).
   */
  effective_cpus?: number | null;
  effective_memory_mb?: number | null;
  /** Where {@link Lease.effective_cpus}/`effective_memory_mb` came from. */
  resources_source?: ResourcesSource;
  /** OS of the leased container, when known (older API omits it). */
  os?: HostOs;
  /** Isolation level this lease runs under, when reported (older API omits it). */
  isolation?: IsolationLevel;
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
  /** Billed seconds so far, excluding suspended gaps (frozen once terminal). */
  billable_seconds?: number;
  /**
   * Accrued cost so far, in cents — the API field is `cost_cents_so_far`. The
   * legacy `cost_cents` is kept as a tolerated alias for older responses; read
   * `cost_cents_so_far ?? cost_cents`.
   */
  cost_cents_so_far?: number;
  cost_cents?: number;
  /**
   * Effective price for this lease, in cents per minute. When present the detail
   * view uses it to tick running cost forward between polls.
   */
  price_cents_per_min?: number;
}

/**
 * The leases page (`GET /v1/leases`): `{ data, next_cursor }`. Cursor threaded
 * through the type for future pagination; the client normalizes to a `Lease[]`.
 */
export interface LeasePage {
  data: Lease[];
  next_cursor?: string;
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
  /** Current balance in cents. */
  balance_cents: number;
  currency: string;
  /**
   * Usage/rollup breakdown. The API returns a nested object here whose exact
   * fields vary by build; tolerated as an opaque map so the wallet still renders.
   */
  usage?: Record<string, unknown>;
}

/** A billing ledger entry (item of `GET /v1/billing/transactions`'s `data`). */
export interface Transaction {
  id: string;
  /** Signed amount in cents (credit positive, debit negative). */
  amount_cents: number;
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
 * A page of ledger entries. The raw endpoint returns a `{ data, next_cursor }`
 * envelope (or, tolerantly, a bare array / legacy `{ transactions }`); the
 * client normalizes all of them to this component-facing shape (see
 * `getTransactions`).
 */
export interface TransactionPage {
  transactions: Transaction[];
  /** Cursor for the next page, absent when this is the last page. */
  next_cursor?: string;
}

/** Body for POST /v1/billing/topup. */
export interface TopupRequest {
  /** Amount to add in cents. */
  amount_cents: number;
}

/** Stripe PaymentIntent client secret for a top-up (POST /v1/billing/topup). */
export interface TopupResponse {
  client_secret: string;
}

/**
 * A host image with pricing (host-side view, PUT /v1/hosts/:id/images). Prices
 * are in CENTS PER MINUTE, matching the catalog's `price_cents_per_min`.
 */
export interface HostImage {
  host_image_id?: string;
  image_ref: string;
  price_cents_per_min?: number;
  enabled?: boolean;
  /** Networks offered for this image; a subset of the host's advertised set. */
  networks?: WispNetwork[];
  /** Max lease TTL in seconds. Required by the API on save (positive integer). */
  max_ttl_seconds?: number;
  /**
   * Fixed size profile for this offer. `cpus`/`memory_mb` are `null` (or omitted)
   * to take the host-side default; `memory_mb` is whole megabytes (the editor
   * enters it in GB). `gpus` is the EXACT GPU count (0 = CPU-only, the default),
   * which the API validates against the host's advertised `gpu_count` and rejects
   * an over-ask — so the editor caps it client-side at the host's capability.
   * `gpus` REPLACES the old `max_gpus` field.
   */
  cpus?: number | null;
  memory_mb?: number | null;
  gpus?: number;
}

/**
 * A host owned by the signed-in account (item of `GET /v1/hosts/mine`'s `data`).
 * Note the real shape carries no `images`; the priced-image editor keeps it
 * optional and tolerates its absence.
 */
export interface Host {
  id: string;
  name: string;
  /** Human label, when distinct from `name`. */
  label?: string;
  status?: string;
  /** Whether the host agent is currently connected. */
  online?: boolean;
  wisp_version?: string;
  agent_version?: string;
  max_leases?: number;
  max_streams?: number;
  /** Non-secret leading portion of the host's agent token. */
  agent_token_prefix?: string;
  last_seen_at?: string;
  created_at?: string;
  /** OS the host's containers run, when advertised. */
  os?: HostOs;
  /** GPU classes this host advertises (e.g. `["A100"]`), when present. */
  gpu_classes?: string[];
  /** Total GPUs the host advertises, when present (older API omits it). */
  gpu_count?: number;
  /**
   * The host's REAL per-lease compute cap (its advertised capability), surfaced by
   * `GET /v1/hosts/mine` and `GET /v1/hosts/:id/images`. The image editor prefills
   * new offers with these concrete numbers and bounds the vCPU/RAM inputs to them
   * (the API rejects a save that exceeds them). `null` — the host is offline or
   * hasn't advertised a cap — so the editor falls back to unbounded inputs with a
   * warning. Absent on an older API, which the editor tolerates as `null`.
   * `host_max_memory_mb` is whole megabytes (the editor shows/enters it in GB).
   */
  host_max_cpus?: number | null;
  host_max_memory_mb?: number | null;
  /**
   * Network modes the host's machine actually supports (its capability). A host
   * operator can only offer a subset of these per image. Absent on older API
   * builds that don't surface the capability, in which case the editor falls
   * back to the full valid set (none/open/egress).
   */
  supported_networks?: WispNetwork[];
  /** Host-side priced images, when the build exposes them (optional). */
  images?: HostImage[];
  region?: string;
  /** The manager WebSocket the host agent connects back to. */
  manager_ws?: string;
}

/**
 * `GET /v1/hosts/mine`: `{ data, earnings }`. The account's hosts plus the
 * earnings/payout summary the endpoint returns for free (no separate call).
 */
export interface MyHosts {
  data: Host[];
  earnings?: Earnings;
  /** Present if the endpoint ever paginates; unused by the current UI. */
  next_cursor?: string;
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
  /** The new host's id. */
  id: string;
  /** The host's display name (echoed from the request). */
  name?: string;
  agent_token: string;
  agent_token_prefix?: string;
  /** The manager WebSocket URL the freshly-installed agent connects to. */
  manager_ws?: string;
  status?: string;
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
 * A machine API key (item of `GET /v1/me/api-keys`'s `data`). The full secret
 * (`wck_live_<64-hex>`) is only ever returned once at creation; the list carries
 * just the non-secret `token_prefix` and metadata. Revoked keys stay listed with
 * `revoked_at` set.
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
 * Response for POST /v1/me/api-keys (flat, mirroring the API's
 * ApiKeyMintedResponse — docs/API.md §5). `key` is the full `wck_live_<64-hex>`
 * secret, returned EXACTLY once at creation and never retrievable again, so
 * callers must surface it now; the remaining fields are the stored metadata.
 */
export interface CreateApiKeyResponse {
  id: string;
  name: string;
  /** The full bearer secret — shown once at mint, never persisted client-side. */
  key: string;
  token_prefix: string;
  scopes: ApiKeyScope[];
  created_at: string;
}

/** Stripe Connect account state for the host, surfaced with earnings. */
export type ConnectStatus = "not_started" | "pending" | "active" | "restricted";

/**
 * Host earnings + payout summary. Returned as the `earnings` block of
 * `GET /v1/hosts/mine`. All money is in cents. `accrued_cents` is lifetime
 * earned, `paid_cents` is lifetime paid out, `payout_min_cents` is the minimum
 * balance before a payout runs, and `can_receive_payouts` reflects whether
 * Stripe Connect is set up enough to pay out.
 */
export interface Earnings {
  currency: string;
  /** Lifetime earned, in cents. */
  accrued_cents: number;
  /** Lifetime paid out, in cents. */
  paid_cents: number;
  /** Minimum balance (cents) before a payout is issued. */
  payout_min_cents?: number;
  /** Coarse Stripe Connect onboarding state, when reported. */
  connect_status?: ConnectStatus;
  /** Whether payouts can currently be received (Connect onboarded). */
  can_receive_payouts?: boolean;
}
