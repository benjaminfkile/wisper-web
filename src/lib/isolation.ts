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
 * Plain-language strength word per level, so a renter who doesn't know what
 * "gVisor" is can still rank what they're buying. Unknown (newer) levels are
 * presumed strongest — mirrors {@link isolationRank}.
 */
const ISOLATION_STRENGTH: Record<IsolationLevel, string> = {
  shared: "Basic",
  sandboxed: "Hardened",
  vm: "Strongest",
};

/**
 * One-line "what am I actually getting" description per level, for tooltips and
 * the create-lease helper text.
 */
const ISOLATION_BLURB: Record<IsolationLevel, string> = {
  shared:
    "Runs on the host's own kernel with container isolation only — the weakest boundary. Fine for trusted workloads.",
  sandboxed:
    "Runs on gVisor's user-space kernel, so a guest kernel exploit can't reach the host kernel directly.",
  vm: "Runs in a hardware-virtualized microVM with its own guest kernel — the strongest boundary, like separate cloud tenants.",
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

/** Plain strength word (e.g. "Strongest") — falls back to "Other" for unknowns. */
export function isolationStrength(level: string): string {
  return ISOLATION_STRENGTH[level as IsolationLevel] ?? "Other";
}

/** Strength word + mechanism, e.g. "Strongest · VM isolation". */
export function isolationStrengthLabel(level: string): string {
  return `${isolationStrength(level)} · ${isolationLabel(level)}`;
}

/** One-sentence explanation of what a level protects against, for tooltips. */
export function isolationBlurb(level: string): string {
  return ISOLATION_BLURB[level as IsolationLevel] ?? "";
}

/** The strongest level a host offers (for the headline host badge). */
export function strongestIsolation(levels: readonly string[] | undefined): string | undefined {
  const sorted = sortIsolationLevels(levels ?? []);
  return sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
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
