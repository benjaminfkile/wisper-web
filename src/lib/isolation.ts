import type { IsolationLevel } from "./wisper/types";

// Presentation-only helpers for surfacing a lease's isolation level. Kept as a
// small pure function (mirroring `os.ts`) so components stay declarative and the
// per-level strings can be asserted directly in tests. An unknown level from a
// newer API falls back to its raw value rather than being hidden.

const ISOLATION_LABELS: Record<IsolationLevel, string> = {
  shared: "Shared kernel",
  sandboxed: "gVisor sandbox",
  vm: "VM isolation",
};

/**
 * Known levels weakest-to-strongest. The index doubles as each level's rank so
 * "at least this strong" comparisons stay a single source of truth.
 */
export const ISOLATION_ORDER: IsolationLevel[] = ["shared", "sandboxed", "vm"];

/** Short human label for an isolation level (e.g. "gVisor sandbox"). */
export function isolationLabel(level: string): string {
  return ISOLATION_LABELS[level as IsolationLevel] ?? level;
}

/**
 * Numeric strength of a level for ordering/comparison; unknown levels sort last
 * (above every known level) so a newer, presumably-stronger API level is never
 * silently treated as the weakest.
 */
export function isolationRank(level: string): number {
  const i = ISOLATION_ORDER.indexOf(level as IsolationLevel);
  return i === -1 ? ISOLATION_ORDER.length : i;
}

/**
 * Order a set of levels weakest-to-strongest for display, de-duplicated. Keeps
 * chip rendering deterministic regardless of the order the API returned them.
 */
export function sortIsolationLevels(levels: readonly string[]): string[] {
  return Array.from(new Set(levels)).sort((a, b) => isolationRank(a) - isolationRank(b));
}

/** Whether `levels` includes any level at least as strong as `min`. */
export function offersAtLeast(levels: readonly string[] | undefined, min: string): boolean {
  const floor = isolationRank(min);
  return (levels ?? []).some((l) => isolationRank(l) >= floor);
}
