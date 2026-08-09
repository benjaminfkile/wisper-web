import { describe, expect, it } from "vitest";
import { offerCpusLabel, offerMemoryLabel, resolveSize } from "./offer";

describe("offer size-profile helpers", () => {
  it("offerCpusLabel reads the exact vCPUs, or 'unspecified' when null/absent", () => {
    expect(offerCpusLabel(2)).toBe("2 vCPU");
    expect(offerCpusLabel(16)).toBe("16 vCPU");
    // null / undefined / 0 are the only cases that fall back to "unspecified".
    expect(offerCpusLabel(null)).toBe("vCPU: unspecified");
    expect(offerCpusLabel(undefined)).toBe("vCPU: unspecified");
    expect(offerCpusLabel(0)).toBe("vCPU: unspecified");
  });

  it("offerMemoryLabel shows memory_mb in GB, or 'unspecified' when null/absent", () => {
    expect(offerMemoryLabel(2048)).toBe("2 GB");
    expect(offerMemoryLabel(8192)).toBe("8 GB");
    // Fractional GB trims trailing zeros.
    expect(offerMemoryLabel(1536)).toBe("1.5 GB");
    expect(offerMemoryLabel(null)).toBe("RAM: unspecified");
    expect(offerMemoryLabel(undefined)).toBe("RAM: unspecified");
    expect(offerMemoryLabel(0)).toBe("RAM: unspecified");
  });

  it("annotates a host-cap value with a '(host cap)' suffix, keeping the number", () => {
    // The number is never hidden behind the label — it's suffixed.
    expect(offerCpusLabel(4, "host_cap")).toBe("4 vCPU (host cap)");
    expect(offerMemoryLabel(2048, "host_cap")).toBe("2 GB (host cap)");
    // An "offer" (or absent) source carries no suffix.
    expect(offerCpusLabel(4, "offer")).toBe("4 vCPU");
    expect(offerMemoryLabel(2048, "offer")).toBe("2 GB");
    expect(offerCpusLabel(4)).toBe("4 vCPU");
  });
});

describe("resolveSize", () => {
  it("prefers the resolved effective values and carries the source ('offer')", () => {
    expect(
      resolveSize({ cpus: 8, memory_mb: 16384, effective_cpus: 8, effective_memory_mb: 16384, resources_source: "offer" }),
    ).toEqual({ cpus: 8, memoryMb: 16384, source: "offer" });
  });

  it("surfaces a host-cap resolution when the offer defaulted a dimension", () => {
    // Raw cpus/memory are null (host-defaulted); the API resolved the host's cap.
    expect(
      resolveSize({ cpus: null, memory_mb: null, effective_cpus: 4, effective_memory_mb: 2048, resources_source: "host_cap" }),
    ).toEqual({ cpus: 4, memoryMb: 2048, source: "host_cap" });
  });

  it("passes an unresolvable size through as 'unknown'", () => {
    expect(
      resolveSize({ cpus: null, memory_mb: null, effective_cpus: null, effective_memory_mb: null, resources_source: "unknown" }),
    ).toEqual({ cpus: null, memoryMb: null, source: "unknown" });
  });

  it("degrades an older payload (no effective/source) to its raw size as 'offer'", () => {
    // Numbered size but no resolution fields — treated as coming from the offer.
    expect(resolveSize({ cpus: 8, memory_mb: 16384 })).toEqual({
      cpus: 8,
      memoryMb: 16384,
      source: "offer",
    });
  });

  it("degrades an older payload with no size at all to 'unknown'", () => {
    expect(resolveSize({})).toEqual({ cpus: null, memoryMb: null, source: "unknown" });
  });
});
