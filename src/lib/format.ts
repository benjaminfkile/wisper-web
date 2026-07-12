// Formatting helpers for the contract's micro-USD money unit and lease timing.
// Prices come from the API as `price_micro_usd_per_second`; balances and accrued
// costs come as micro-USD. Keeping the conversions here means the UI never does
// ad-hoc `/ 1_000_000` math inline.

const MICRO_PER_USD = 1_000_000;
const SECONDS_PER_HOUR = 3600;

/** Format a micro-USD amount as a dollar string, e.g. `1_500_000` -> `$1.50`. */
export function formatUsd(microUsd: number, fractionDigits = 2): string {
  return `$${(microUsd / MICRO_PER_USD).toFixed(fractionDigits)}`;
}

/**
 * Format a signed micro-USD amount with an explicit `+`/`−` sign, e.g. a credit
 * `2_000_000` -> `+$2.00` and a debit `-1_500_000` -> `−$1.50`. Used by the ledger
 * where the direction of each entry matters at a glance.
 */
export function formatSignedUsd(microUsd: number, fractionDigits = 2): string {
  const sign = microUsd < 0 ? "−" : "+";
  return `${sign}${formatUsd(Math.abs(microUsd), fractionDigits)}`;
}

/**
 * Format a per-second price (micro-USD/second, the catalog's price unit) as an
 * hourly rate, e.g. `278` -> `$1.00/hr`. Hourly reads more naturally than the
 * raw per-second micro-price for a by-the-minute product.
 */
export function formatPricePerHour(microUsdPerSecond: number): string {
  return `${formatUsd(microUsdPerSecond * SECONDS_PER_HOUR)}/hr`;
}

/** Format a TTL / duration in seconds as a compact `1h 30m` style string. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / 60);
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

/**
 * Format a duration in seconds as a live clock string, e.g. `3723` -> `1:02:03`
 * and `63` -> `0:01:03`. Used for the per-second uptime and TTL countdown, where
 * `formatDuration`'s minute granularity would hide the ticking.
 */
export function formatHms(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(s / SECONDS_PER_HOUR);
  const minutes = Math.floor((s % SECONDS_PER_HOUR) / 60);
  const seconds = s % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Format an ISO timestamp as a locale date-time, tolerating missing/invalid input. */
export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}
