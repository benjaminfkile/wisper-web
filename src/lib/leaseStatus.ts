import type { LeaseStatus } from "./wisper/types";

/** MUI Chip color palette keys used for lease-status badges. */
type ChipColor = "default" | "primary" | "success" | "warning" | "error" | "info";

// Lifecycle: pending -> provisioning -> active -> (suspended) -> ended, or failed.
const STATUS_COLORS: Record<LeaseStatus, ChipColor> = {
  pending: "default",
  provisioning: "info",
  active: "success",
  suspended: "warning",
  ended: "default",
  failed: "error",
};

/** Chip color for a lease status (falls back to neutral for unknown values). */
export function leaseStatusColor(status: LeaseStatus): ChipColor {
  return STATUS_COLORS[status] ?? "default";
}

/** Terminal states no longer change, so polling and Release can stop for them. */
const TERMINAL: ReadonlySet<LeaseStatus> = new Set<LeaseStatus>(["ended", "failed"]);

/** Whether a lease has reached a terminal (non-changing) state. */
export function isTerminalLease(status: LeaseStatus): boolean {
  return TERMINAL.has(status);
}
