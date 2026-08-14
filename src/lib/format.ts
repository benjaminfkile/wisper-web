// Formatting helpers for the contract's CENTS money unit and lease timing.
// The real wisper-api denominates money in whole cents: catalog prices come as
// `price_cents_per_min`, balances/accrued costs come as `*_cents`. Keeping the
// conversions here means the UI never does ad-hoc `/ 100` math inline.

const CENTS_PER_USD = 100;
const SECONDS_PER_HOUR = 3600;
const MINUTES_PER_HOUR = 60;
const MB_PER_GB = 1024;

/**
 * Format a cents amount as a dollar string, e.g. `150` -> `$1.50` and
 * `123456` -> `$1,234.56`. Uses `en-US` locale grouping so amounts of $1,000
 * or more render with comma thousands separators; smaller values are
 * unaffected.
 */
export function formatUsd(cents: number, fractionDigits = 2): string {
  const dollars = cents / CENTS_PER_USD;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/**
 * Format a signed cents amount with an explicit `+`/`−` sign, e.g. a credit
 * `200` -> `+$2.00` and a debit `-150` -> `−$1.50`. Used by the ledger where the
 * direction of each entry matters at a glance.
 */
export function formatSignedUsd(cents: number, fractionDigits = 2): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${formatUsd(Math.abs(cents), fractionDigits)}`;
}

/**
 * Format a catalog price (cents-per-minute, the contract's price unit) as an
 * hourly rate, e.g. `100` -> `$1.00/hr`. Hourly reads more naturally than the
 * raw per-minute cents for a by-the-minute product.
 */
export function formatPricePerHour(centsPerMinute: number): string {
  return `${formatUsd(centsPerMinute * MINUTES_PER_HOUR)}/hr`;
}

/**
 * Convert a cents-per-minute price to a plain dollars-per-hour number, e.g.
 * `100` -> `60`. Used to seed the host image price editor, which lets hosts
 * think in `$ /hr` rather than the contract's per-minute cents price.
 */
export function centsPerMinToPerHour(centsPerMinute: number): number {
  return (centsPerMinute * MINUTES_PER_HOUR) / CENTS_PER_USD;
}

/**
 * Convert a dollars-per-hour rate back to the contract's cents-per-minute price
 * (rounded to a whole cent), e.g. `60` -> `100`. Inverse of
 * {@link centsPerMinToPerHour}; used when saving edited host image prices.
 */
export function perHourToCentsPerMin(dollarsPerHour: number): number {
  return Math.round((dollarsPerHour * CENTS_PER_USD) / MINUTES_PER_HOUR);
}

/**
 * Convert the contract's whole-megabyte `memory_mb` unit to a plain gigabytes
 * number for display, e.g. `2048` -> `2`. Mirrors {@link centsPerMinToPerHour}:
 * the wire keeps the small integer unit while the UI lets hosts think in GB.
 */
export function memoryMbToGb(memoryMb: number): number {
  return memoryMb / MB_PER_GB;
}

/**
 * Convert a gigabytes RAM figure back to the contract's whole-megabyte
 * `memory_mb` (rounded to a whole MB), e.g. `2` -> `2048`. Inverse of
 * {@link memoryMbToGb}; used when saving an offer's fixed size profile.
 */
export function gbToMemoryMb(gb: number): number {
  return Math.round(gb * MB_PER_GB);
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
