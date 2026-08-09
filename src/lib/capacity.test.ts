import { describe, expect, it } from "vitest";
import { hostAtCapacity, hostLeaseUsageLabel } from "./capacity";

describe("host capacity helpers", () => {
  it("hostAtCapacity is true only when the API flags the host full", () => {
    expect(hostAtCapacity({ at_capacity: true })).toBe(true);
    expect(hostAtCapacity({ at_capacity: false })).toBe(false);
    // Absent (older API) or nullish input reads as not-full — no badge, no gating.
    expect(hostAtCapacity({})).toBe(false);
    expect(hostAtCapacity(null)).toBe(false);
    expect(hostAtCapacity(undefined)).toBe(false);
  });

  it("hostLeaseUsageLabel shows active/max, active-only, or nothing", () => {
    expect(hostLeaseUsageLabel(3, 5)).toBe("3 / 5 leases");
    // Max known but active absent → treat the running count as 0.
    expect(hostLeaseUsageLabel(undefined, 5)).toBe("0 / 5 leases");
    // Only the running count is reported.
    expect(hostLeaseUsageLabel(4, undefined)).toBe("4 active leases");
    expect(hostLeaseUsageLabel(1, undefined)).toBe("1 active lease");
    // Neither present (older API) → nothing to render.
    expect(hostLeaseUsageLabel(undefined, undefined)).toBeNull();
  });
});
