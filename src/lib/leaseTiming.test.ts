import { describe, expect, it } from "vitest";
import {
  baseTtlRemainingSeconds,
  costRateCentsPerSecond,
  leaseUptimeSeconds,
  liveCostCents,
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

  it("freezes a terminal lease at billed seconds when ended_at is missing (never ticks)", () => {
    // Defense in depth: even if the API omits ended_at, a terminal lease must not
    // count up with the wall clock — it freezes at billable_seconds.
    const ended = lease({ status: "ended", ended_at: undefined, billable_seconds: 159 });
    expect(leaseUptimeSeconds(ended, START_MS + 10 * 60_000)).toBe(159);
    // Two different "now"s produce the SAME value — proof it is not ticking.
    expect(leaseUptimeSeconds(ended, START_MS + 99 * 60_000)).toBe(159);
  });

  it("freezes a terminal lease at 0 when it has neither ended_at nor billable_seconds", () => {
    const ended = lease({ status: "ended", ended_at: undefined });
    expect(leaseUptimeSeconds(ended, START_MS + 10 * 60_000)).toBe(0);
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

describe("costRateCentsPerSecond", () => {
  it("uses the lease's cents-per-minute price (÷60) when present", () => {
    // 60 cents/min -> 1 cent/second.
    expect(costRateCentsPerSecond(lease({ price_cents_per_min: 60 }), START_MS)).toBe(1);
  });

  it("derives the rate from accrued cost over uptime otherwise", () => {
    // 60s of uptime, 600 cents accrued -> 10 cents/second.
    const l = lease({ cost_cents: 600 });
    expect(costRateCentsPerSecond(l, START_MS + 60_000)).toBe(10);
  });

  it("is 0 when no price and no uptime are known", () => {
    expect(costRateCentsPerSecond(lease({ started_at: undefined }), START_MS)).toBe(0);
  });
});

describe("liveCostCents", () => {
  it("adds rate over elapsed seconds to the base cost", () => {
    expect(liveCostCents(100, 1, 60)).toBe(100 + 1 * 60);
  });

  it("clamps negative rate and elapsed to 0", () => {
    expect(liveCostCents(50, -5, -10)).toBe(50);
  });
});
