import type { CatalogHost, PricedImage } from "./wisper/types";

// Presentation-only helpers for surfacing GPU offers/inventory (mirroring `os.ts`
// and `isolation.ts`). Every entry tolerates absent fields (older API / a
// CPU-only offer) so components stay declarative and the strings can be asserted
// directly in tests. Nothing here is shown in a zero-GPU world.

/** Whether an offer leases any GPUs (`max_gpus` present and positive). */
export function offerHasGpu(image: Pick<PricedImage, "max_gpus"> | null | undefined): boolean {
  return (image?.max_gpus ?? 0) > 0;
}

/**
 * Badge label for a GPU-bearing offer, combining the host's GPU class(es) with
 * the offer's `max_gpus` — e.g. `"A100 × 2"`, or `"A100, H100 × 2"` for a
 * multi-class host, falling back to `"GPU × 2"` when the host advertises no
 * class. Returns `null` when the offer leases no GPU, so callers render nothing.
 */
export function gpuBadgeLabel(
  gpuClasses: readonly string[] | undefined,
  maxGpus: number | undefined,
): string | null {
  const count = maxGpus ?? 0;
  if (count <= 0) return null;
  const classes = (gpuClasses ?? []).filter(Boolean);
  const name = classes.length > 0 ? classes.join(", ") : "GPU";
  return `${name} × ${count}`;
}

/**
 * Host-level GPU inventory summary from `gpu_classes`/`gpu_count` — e.g.
 * `"A100, H100 · 4 GPUs"`, or just the class list / just the count when only one
 * is present. Returns `null` when the host advertises neither, so the host card
 * stays exactly as it is today in a zero-GPU world.
 */
export function gpuHostSummary(
  gpuClasses: readonly string[] | undefined,
  gpuCount: number | undefined,
): string | null {
  const classes = (gpuClasses ?? []).filter(Boolean);
  const count = gpuCount ?? 0;
  if (classes.length === 0 && count <= 0) return null;
  const parts: string[] = [];
  if (classes.length > 0) parts.push(classes.join(", "));
  if (count > 0) parts.push(`${count} ${count === 1 ? "GPU" : "GPUs"}`);
  return parts.join(" · ");
}

/**
 * The sorted, de-duplicated set of GPU classes present across the given catalog
 * hosts — the option list for the catalog's "GPU class" filter. Empty when no
 * loaded host advertises a class (so the control shows only its "Any" default).
 */
export function gpuClassOptions(hosts: readonly CatalogHost[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const h of hosts ?? []) {
    for (const c of h.gpu_classes ?? []) if (c) set.add(c);
  }
  return Array.from(set).sort();
}

/**
 * Whether any loaded host advertises GPU capability — a host-level class/count or
 * a GPU-bearing offer. The catalog uses this to keep its GPU filter controls out
 * of a zero-GPU world entirely (so it looks exactly like it did before GPUs).
 */
export function catalogAdvertisesGpu(
  hosts: readonly CatalogHost[] | null | undefined,
): boolean {
  return (hosts ?? []).some(
    (h) =>
      (h.gpu_count ?? 0) > 0 ||
      (h.gpu_classes ?? []).some(Boolean) ||
      (h.images ?? []).some((img) => (img.max_gpus ?? 0) > 0),
  );
}
