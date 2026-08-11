import { describe, expect, it } from "vitest";
import {
  ISOLATION_ORDER,
  isolationBlurb,
  isolationLabel,
  isolationRank,
  isolationStrength,
  isolationStrengthLabel,
  offersAtLeast,
  sortIsolationLevels,
  strongestIsolation,
} from "./isolation";

describe("isolationLabel", () => {
  it("maps known levels to their short human labels", () => {
    expect(isolationLabel("shared")).toBe("Shared kernel");
    expect(isolationLabel("sandboxed")).toBe("gVisor sandbox");
    expect(isolationLabel("vm")).toBe("VM isolation");
  });

  it("falls back to the raw value for an unknown level", () => {
    expect(isolationLabel("enclave")).toBe("enclave");
  });
});

describe("isolationRank", () => {
  it("orders known levels shared < sandboxed < vm", () => {
    expect(isolationRank("shared")).toBeLessThan(isolationRank("sandboxed"));
    expect(isolationRank("sandboxed")).toBeLessThan(isolationRank("vm"));
  });

  it("ranks an unknown level above every known one", () => {
    expect(isolationRank("enclave")).toBeGreaterThanOrEqual(ISOLATION_ORDER.length);
    expect(isolationRank("enclave")).toBeGreaterThan(isolationRank("vm"));
  });
});

describe("sortIsolationLevels", () => {
  it("sorts weakest-to-strongest and de-duplicates", () => {
    expect(sortIsolationLevels(["vm", "shared", "sandboxed", "shared"])).toEqual([
      "shared",
      "sandboxed",
      "vm",
    ]);
  });
});

describe("isolationStrength / isolationStrengthLabel", () => {
  it("maps levels to plain strength words", () => {
    expect(isolationStrength("shared")).toBe("Basic");
    expect(isolationStrength("sandboxed")).toBe("Hardened");
    expect(isolationStrength("vm")).toBe("Strongest");
    expect(isolationStrength("enclave")).toBe("Other");
  });

  it("combines strength and mechanism", () => {
    expect(isolationStrengthLabel("vm")).toBe("Strongest · VM isolation");
    expect(isolationStrengthLabel("shared")).toBe("Basic · Shared kernel");
  });
});

describe("isolationBlurb", () => {
  it("gives a non-empty explanation for known levels and empty for unknown", () => {
    expect(isolationBlurb("vm")).toMatch(/microVM|guest kernel/i);
    expect(isolationBlurb("shared")).toMatch(/host's own kernel/i);
    expect(isolationBlurb("enclave")).toBe("");
  });
});

describe("strongestIsolation", () => {
  it("returns the strongest advertised level", () => {
    expect(strongestIsolation(["shared", "vm", "sandboxed"])).toBe("vm");
    expect(strongestIsolation(["shared"])).toBe("shared");
  });

  it("returns undefined for an empty or absent set", () => {
    expect(strongestIsolation([])).toBeUndefined();
    expect(strongestIsolation(undefined)).toBeUndefined();
  });
});

describe("offersAtLeast", () => {
  it("is true when any level meets or exceeds the floor", () => {
    expect(offersAtLeast(["shared", "vm"], "sandboxed")).toBe(true);
    expect(offersAtLeast(["vm"], "vm")).toBe(true);
  });

  it("is false when every level is weaker than the floor", () => {
    expect(offersAtLeast(["shared", "sandboxed"], "vm")).toBe(false);
  });

  it("is false for an absent/empty level set", () => {
    expect(offersAtLeast(undefined, "shared")).toBe(false);
    expect(offersAtLeast([], "shared")).toBe(false);
  });
});
