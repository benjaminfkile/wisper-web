import { memoryMbToGb } from "./format";

// Presentation-only helpers for an offer's fixed size profile (vCPUs / RAM),
// mirroring `gpu.ts`. An offer is a SIZE at a price: `cpus`/`memory_mb` are the
// exact profile, or `null`/absent when the offer takes the host-side default —
// shown as "host default" rather than a misleading `0`. Every entry tolerates
// absent fields (older API) so the strings can be asserted directly in tests.

/** Sentinel shown when a size dimension is host-defaulted (null/absent). */
const HOST_DEFAULT = "host default";

/**
 * Compact vCPU chip label — e.g. `"2 vCPU"`, or `"vCPU: host default"` when the
 * offer leaves CPUs to the host (`null`/absent). Never renders a bare `0`.
 */
export function offerCpusLabel(cpus: number | null | undefined): string {
  return cpus != null && cpus > 0 ? `${cpus} vCPU` : `vCPU: ${HOST_DEFAULT}`;
}

/**
 * Compact RAM chip label — the `memory_mb` profile shown in GB, e.g. `"8 GB"`,
 * or `"RAM: host default"` when the offer leaves memory to the host
 * (`null`/absent). Trims trailing zeros (e.g. `1536` MB -> `"1.5 GB"`).
 */
export function offerMemoryLabel(memoryMb: number | null | undefined): string {
  if (memoryMb == null || memoryMb <= 0) return `RAM: ${HOST_DEFAULT}`;
  const gb = Number(memoryMbToGb(memoryMb).toFixed(2));
  return `${gb} GB`;
}
