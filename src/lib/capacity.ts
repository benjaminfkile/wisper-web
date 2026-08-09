import type { CatalogHost } from "./wisper/types";

// Presentation-only helpers for a host's lease capacity (mirroring `gpu.ts` and
// `offer.ts`). A host is FULL when the API sets `at_capacity` — lease creation on
// it would fast-fail with the `at_capacity` (409) error — and it may report how
// many leases it runs (`active_leases`) against its ceiling (`max_leases`). Every
// entry tolerates absent fields (older API) so components stay declarative and
// the strings can be asserted directly in tests; nothing shows when a field is
// absent, preserving pre-capacity behavior.

/** Whether a host is full (no free lease slot), i.e. `at_capacity === true`. */
export function hostAtCapacity(
  host: Pick<CatalogHost, "at_capacity"> | null | undefined,
): boolean {
  return host?.at_capacity === true;
}

/**
 * Compact lease-usage label from a host's `active_leases`/`max_leases` — e.g.
 * `"3 / 5 leases"` when both are known, `"4 active leases"` when only the running
 * count is, or `null` when neither is present (older API), so the card shows
 * nothing rather than a misleading `0`.
 */
export function hostLeaseUsageLabel(
  activeLeases: number | undefined,
  maxLeases: number | undefined,
): string | null {
  const hasMax = maxLeases != null;
  const hasActive = activeLeases != null;
  if (hasMax) return `${activeLeases ?? 0} / ${maxLeases} leases`;
  if (hasActive) return `${activeLeases} active lease${activeLeases === 1 ? "" : "s"}`;
  return null;
}
