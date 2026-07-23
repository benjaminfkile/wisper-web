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

/** Short human label for an isolation level (e.g. "gVisor sandbox"). */
export function isolationLabel(level: string): string {
  return ISOLATION_LABELS[level as IsolationLevel] ?? level;
}
