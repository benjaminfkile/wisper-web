import { describe, expect, it } from "vitest";
import {
  catalogAdvertisesGpu,
  gpuBadgeLabel,
  gpuClassOptions,
  gpuHostSummary,
  offerHasGpu,
} from "./gpu";
import type { CatalogHost } from "./wisper/types";

describe("gpu helpers", () => {
  it("offerHasGpu is true only for a positive max_gpus", () => {
    expect(offerHasGpu({ max_gpus: 2 })).toBe(true);
    expect(offerHasGpu({ max_gpus: 0 })).toBe(false);
    expect(offerHasGpu({})).toBe(false);
    expect(offerHasGpu(undefined)).toBe(false);
    expect(offerHasGpu(null)).toBe(false);
  });

  it("gpuBadgeLabel combines class(es) with the offer count, or null when zero", () => {
    expect(gpuBadgeLabel(["A100"], 2)).toBe("A100 × 2");
    expect(gpuBadgeLabel(["A100", "H100"], 2)).toBe("A100, H100 × 2");
    expect(gpuBadgeLabel(undefined, 1)).toBe("GPU × 1");
    expect(gpuBadgeLabel([], 4)).toBe("GPU × 4");
    expect(gpuBadgeLabel(["A100"], 0)).toBeNull();
    expect(gpuBadgeLabel(["A100"], undefined)).toBeNull();
  });

  it("gpuHostSummary renders class list and/or count, or null when neither", () => {
    expect(gpuHostSummary(["A100", "H100"], 4)).toBe("A100, H100 · 4 GPUs");
    expect(gpuHostSummary(["A100"], 1)).toBe("A100 · 1 GPU");
    expect(gpuHostSummary(["A100"], undefined)).toBe("A100");
    expect(gpuHostSummary(undefined, 3)).toBe("3 GPUs");
    expect(gpuHostSummary(undefined, undefined)).toBeNull();
    expect(gpuHostSummary([], 0)).toBeNull();
  });

  it("gpuClassOptions returns sorted, de-duplicated classes across hosts", () => {
    const hosts: CatalogHost[] = [
      { host_id: "h1", label: "A", gpu_classes: ["H100", "A100"], images: [] },
      { host_id: "h2", label: "B", gpu_classes: ["A100"], images: [] },
      { host_id: "h3", label: "C", images: [] },
    ];
    expect(gpuClassOptions(hosts)).toEqual(["A100", "H100"]);
    expect(gpuClassOptions([])).toEqual([]);
    expect(gpuClassOptions(null)).toEqual([]);
  });

  it("catalogAdvertisesGpu detects host- or offer-level GPU capability", () => {
    const cpuOnly: CatalogHost[] = [
      { host_id: "h1", label: "A", images: [{ host_image_id: "i1", image_ref: "x", price_cents_per_min: 1 }] },
    ];
    expect(catalogAdvertisesGpu(cpuOnly)).toBe(false);
    expect(
      catalogAdvertisesGpu([{ host_id: "h", label: "A", gpu_count: 2, images: [] }]),
    ).toBe(true);
    expect(
      catalogAdvertisesGpu([{ host_id: "h", label: "A", gpu_classes: ["A100"], images: [] }]),
    ).toBe(true);
    expect(
      catalogAdvertisesGpu([
        {
          host_id: "h",
          label: "A",
          images: [{ host_image_id: "i", image_ref: "x", price_cents_per_min: 1, max_gpus: 4 }],
        },
      ]),
    ).toBe(true);
    expect(catalogAdvertisesGpu(null)).toBe(false);
  });
});
