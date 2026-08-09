import { memoryMbToGb } from "./format";
import type { ResourcesSource } from "./wisper/types";

// Presentation-only helpers for an offer's/lease's EFFECTIVE size profile
// (vCPUs / RAM), mirroring `gpu.ts`. The API resolves what a lease actually gets
// and marks where it came from (`resources_source`); these helpers surface the
// resolved NUMBER — never a bare "host default" with no value — and subtly flag a
// host-cap value. Only a genuine "unknown" degrades to "unspecified". Every entry
// tolerates absent fields (older API) so the strings can be asserted in tests.

/** Sentinel shown only when a size dimension is genuinely unresolvable. */
const UNSPECIFIED = "unspecified";

/** Suffix flagging a number that came from the host's cap, not the offer. */
const HOST_CAP_SUFFIX = " (host cap)";

/**
 * The subset of an offer/lease this module reads: the offer's own profile
 * (`cpus`/`memory_mb`), the server-resolved `effective_*` values, and the source
 * marker. Both {@link PricedImage} and {@link Lease} satisfy it, so one resolver
 * serves the catalog, the create dialog, and the lease views alike.
 */
interface SizedResource {
  cpus?: number | null;
  memory_mb?: number | null;
  effective_cpus?: number | null;
  effective_memory_mb?: number | null;
  resources_source?: ResourcesSource;
}

/** The resolved effective size + where the numbers came from. */
export interface ResolvedSize {
  /** Effective vCPUs the lease gets, or `null` when unresolvable. */
  cpus: number | null;
  /** Effective RAM in whole MB, or `null` when unresolvable. */
  memoryMb: number | null;
  /** Provenance of the numbers (drives the "(host cap)"/"unspecified" rendering). */
  source: ResourcesSource;
}

/**
 * Resolve an offer/lease to the EFFECTIVE size the consumer actually gets, plus
 * where those numbers came from. Prefers the API's resolved `effective_*` fields;
 * when they're absent (older API) it falls back to the offer's own
 * `cpus`/`memory_mb` and infers the source — `"offer"` when either dimension is
 * set, `"unknown"` when neither is. So a pre-resolution payload still shows
 * today's numbered chips when it carried a size, and degrades to "unspecified"
 * (never a bare "host default") when it didn't.
 */
export function resolveSize(x: SizedResource): ResolvedSize {
  const cpus = x.effective_cpus ?? x.cpus ?? null;
  const memoryMb = x.effective_memory_mb ?? x.memory_mb ?? null;
  const source: ResourcesSource =
    x.resources_source ?? (cpus != null || memoryMb != null ? "offer" : "unknown");
  return { cpus, memoryMb, source };
}

/**
 * Compact vCPU chip label from a resolved size — e.g. `"2 vCPU"`, `"2 vCPU (host
 * cap)"` when the number is the host's cap, or `"vCPU: unspecified"` when it
 * couldn't be resolved. Never renders a bare `0`.
 */
export function offerCpusLabel(cpus: number | null | undefined, source?: ResourcesSource): string {
  if (cpus == null || cpus <= 0) return `vCPU: ${UNSPECIFIED}`;
  return `${cpus} vCPU${source === "host_cap" ? HOST_CAP_SUFFIX : ""}`;
}

/**
 * Compact RAM chip label from a resolved size — the `memory_mb` shown in GB, e.g.
 * `"8 GB"`, `"8 GB (host cap)"` when the number is the host's cap, or
 * `"RAM: unspecified"` when it couldn't be resolved. Trims trailing zeros (e.g.
 * `1536` MB -> `"1.5 GB"`).
 */
export function offerMemoryLabel(
  memoryMb: number | null | undefined,
  source?: ResourcesSource,
): string {
  if (memoryMb == null || memoryMb <= 0) return `RAM: ${UNSPECIFIED}`;
  const gb = Number(memoryMbToGb(memoryMb).toFixed(2));
  return `${gb} GB${source === "host_cap" ? HOST_CAP_SUFFIX : ""}`;
}
