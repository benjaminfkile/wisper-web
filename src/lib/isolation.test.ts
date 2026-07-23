import { describe, expect, it } from "vitest";
import {
  ISOLATION_ORDER,
  isolationLabel,
  isolationRank,
  offersAtLeast,
  sortIsolationLevels,
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
