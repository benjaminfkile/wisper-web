import { describe, expect, it } from "vitest";
import { offerCpusLabel, offerMemoryLabel } from "./offer";

describe("offer size-profile helpers", () => {
  it("offerCpusLabel reads the exact vCPUs, or 'host default' when null/absent", () => {
    expect(offerCpusLabel(2)).toBe("2 vCPU");
    expect(offerCpusLabel(16)).toBe("16 vCPU");
    // null / undefined / 0 all mean the host-side default — never a bare 0.
    expect(offerCpusLabel(null)).toBe("vCPU: host default");
    expect(offerCpusLabel(undefined)).toBe("vCPU: host default");
    expect(offerCpusLabel(0)).toBe("vCPU: host default");
  });

  it("offerMemoryLabel shows memory_mb in GB, or 'host default' when null/absent", () => {
    expect(offerMemoryLabel(2048)).toBe("2 GB");
    expect(offerMemoryLabel(8192)).toBe("8 GB");
    // Fractional GB trims trailing zeros.
    expect(offerMemoryLabel(1536)).toBe("1.5 GB");
    expect(offerMemoryLabel(null)).toBe("RAM: host default");
    expect(offerMemoryLabel(undefined)).toBe("RAM: host default");
    expect(offerMemoryLabel(0)).toBe("RAM: host default");
  });
});
