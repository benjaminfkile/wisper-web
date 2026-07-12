import { describe, expect, it } from "vitest";
import {
  baseTtlRemainingSeconds,
  costRateMicroUsdPerSecond,
  leaseUptimeSeconds,
  liveCostMicroUsd,
  liveTtlRemainingSeconds,
} from "./leaseTiming";
import type { Lease } from "./wisper/types";

const START = "2026-07-12T00:00:00.000Z";
const START_MS = Date.parse(START);

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: "l1",
    status: "active",
    host_id: "h1",
    host_image_id: "ubuntu-22.04",
    network: "egress",
    ttl_seconds: 3600,
    created_at: START,
    started_at: START,
    ...overrides,
  };
}

describe("leaseUptimeSeconds", () => {
  it("counts whole seconds since started_at", () => {
    expect(leaseUptimeSeconds(lease(), START_MS + 90_500)).toBe(90);
  });

  it("is 0 before a lease has started", () => {
    expect(leaseUptimeSeconds(lease({ started_at: undefined }), START_MS + 90_000)).toBe(0);
  });

  it("freezes at ended_at for terminal leases", () => {
    const ended = lease({
      status: "ended",
      ended_at: "2026-07-12T00:01:00.000Z",
    });
    // now is far past the end, but uptime stops at ended_at (60s).
    expect(leaseUptimeSeconds(ended, START_MS + 10 * 60_000)).toBe(60);
  });

  it("never goes negative", () => {
    expect(leaseUptimeSeconds(lease(), START_MS - 5000)).toBe(0);
  });
});

describe("baseTtlRemainingSeconds", () => {
  it("prefers the server ttl_seconds_remaining snapshot", () => {
    expect(baseTtlRemainingSeconds(lease({ ttl_seconds_remaining: 1234 }), START_MS)).toBe(1234);
  });

  it("falls back to expires_at when no snapshot is given", () => {
    const l = lease({ expires_at: "2026-07-12T00:30:00.000Z" });
    expect(baseTtlRemainingSeconds(l, START_MS)).toBe(1800);
  });

  it("falls back to ttl_seconds minus uptime", () => {
    // 3600s TTL, 600s of uptime -> 3000 remaining.
    expect(baseTtlRemainingSeconds(lease(), START_MS + 600_000)).toBe(3000);
  });

  it("is 0 for terminal leases", () => {
    expect(baseTtlRemainingSeconds(lease({ status: "ended", ttl_seconds_remaining: 500 }), START_MS)).toBe(0);
  });
});

describe("liveTtlRemainingSeconds", () => {
  it("counts down from the synced base", () => {
    expect(liveTtlRemainingSeconds(100, START_MS, START_MS + 30_000)).toBe(70);
  });

  it("floors at 0", () => {
    expect(liveTtlRemainingSeconds(10, START_MS, START_MS + 30_000)).toBe(0);
  });
});

describe("costRateMicroUsdPerSecond", () => {
  it("uses the lease's per-second price when present", () => {
    expect(costRateMicroUsdPerSecond(lease({ price_micro_usd_per_second: 278 }), START_MS)).toBe(278);
  });

  it("derives the rate from accrued cost over uptime otherwise", () => {
    // 60s of uptime, $0.60 accrued -> 10_000 micro-USD/second.
    const l = lease({ cost_micro_usd: 600_000 });
    expect(costRateMicroUsdPerSecond(l, START_MS + 60_000)).toBe(10_000);
  });

  it("is 0 when no price and no uptime are known", () => {
    expect(costRateMicroUsdPerSecond(lease({ started_at: undefined }), START_MS)).toBe(0);
  });
});

describe("liveCostMicroUsd", () => {
  it("adds rate over elapsed seconds to the base cost", () => {
    expect(liveCostMicroUsd(1_000_000, 278, 60)).toBe(1_000_000 + 278 * 60);
  });

  it("clamps negative rate and elapsed to 0", () => {
    expect(liveCostMicroUsd(500_000, -5, -10)).toBe(500_000);
  });
});
