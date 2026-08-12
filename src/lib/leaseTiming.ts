// Pure timing math for the lease detail view. The detail view shows uptime and a
// TTL countdown that tick every second in the browser and re-sync to the server's
// snapshot on each poll (GET /v1/leases/:id). Keeping the math here — free of React
// and of the real clock — makes the countdown/cost logic straightforward to unit
// test with an explicit `nowMs`.

import type { Lease } from "./wisper/types";
import { isTerminalLease } from "./leaseStatus";

/**
 * Whole seconds a lease has been running as of `nowMs` (epoch ms). Counts from
 * `started_at`; a lease that has not started yet (no `started_at`) reads 0, and a
 * terminal lease freezes at its `ended_at`.
 */
export function leaseUptimeSeconds(lease: Lease, nowMs: number): number {
  if (!lease.started_at) return 0;
  const startMs = Date.parse(lease.started_at);
  if (Number.isNaN(startMs)) return 0;

  // A terminal lease's runtime is FIXED — it must never advance with the wall
  // clock (a ticking counter on an ended lease reads as overbilling even when the
  // server froze billing long ago). Prefer ended_at; if the API ever omits it,
  // freeze at the billed seconds (bounded, non-ticking) rather than counting up
  // from started_at to now. Never fall through to the live wall-clock branch.
  if (isTerminalLease(lease.status)) {
    if (lease.ended_at) {
      const endMs = Date.parse(lease.ended_at);
      if (!Number.isNaN(endMs)) return Math.max(0, Math.floor((endMs - startMs) / 1000));
    }
    if (typeof lease.billable_seconds === "number") {
      return Math.max(0, Math.floor(lease.billable_seconds));
    }
    return 0;
  }

  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

/**
 * The lease's remaining TTL in seconds at the moment it was fetched (`nowMs` being
 * that fetch time). Prefers the server's `ttl_seconds_remaining` snapshot, then
 * `expires_at`, and finally falls back to `ttl_seconds` minus uptime. Terminal
 * leases have no time left.
 */
export function baseTtlRemainingSeconds(lease: Lease, nowMs: number): number {
  if (isTerminalLease(lease.status)) return 0;
  if (typeof lease.ttl_seconds_remaining === "number") {
    return Math.max(0, Math.floor(lease.ttl_seconds_remaining));
  }
  if (lease.expires_at) {
    const exp = Date.parse(lease.expires_at);
    if (!Number.isNaN(exp)) return Math.max(0, Math.floor((exp - nowMs) / 1000));
  }
  return Math.max(0, lease.ttl_seconds - leaseUptimeSeconds(lease, nowMs));
}

/**
 * Live TTL countdown: the `baseRemaining` captured at `syncedAtMs` minus the
 * seconds elapsed since, floored at 0. Re-supplying a fresh `baseRemaining` from a
 * poll snaps the countdown back to the server's truth.
 */
export function liveTtlRemainingSeconds(
  baseRemaining: number,
  syncedAtMs: number,
  nowMs: number,
): number {
  const elapsed = Math.floor((nowMs - syncedAtMs) / 1000);
  return Math.max(0, baseRemaining - elapsed);
}

/**
 * The per-second cost rate for a lease, in cents/second. Uses the lease's
 * `price_cents_per_min` (÷60) when the API provides it; otherwise derives the
 * rate from accrued cost over uptime so the running total can still tick between
 * polls.
 */
export function costRateCentsPerSecond(lease: Lease, nowMs: number): number {
  if (typeof lease.price_cents_per_min === "number") {
    return Math.max(0, lease.price_cents_per_min / 60);
  }
  const uptime = leaseUptimeSeconds(lease, nowMs);
  const accrued = lease.cost_cents_so_far ?? lease.cost_cents;
  if (uptime > 0 && typeof accrued === "number") {
    return Math.max(0, accrued / uptime);
  }
  return 0;
}

/**
 * Live running cost in cents: the `baseCost` accrued as of the last poll plus
 * `rate` applied to the seconds elapsed since. Elapsed and rate are clamped
 * non-negative so the total only moves forward.
 */
export function liveCostCents(
  baseCostCents: number,
  rateCentsPerSecond: number,
  elapsedSeconds: number,
): number {
  return baseCostCents + Math.max(0, rateCentsPerSecond) * Math.max(0, elapsedSeconds);
}
