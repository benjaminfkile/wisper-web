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

/** Format an ISO timestamp as a locale date-time, tolerating missing/invalid input. */
export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}
