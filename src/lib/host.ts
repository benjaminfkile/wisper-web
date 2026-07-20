// Host-side helpers: the one-time agent bootstrap command shown at registration
// and the coarse Stripe Connect status the earnings view renders. Kept out of the
// components so they can be unit-tested without React.

import type { ConnectStatus, Earnings } from "@/lib/wisper/types";

/**
 * Build the copy-paste command an operator runs on their machine to bring the
 * newly-registered host online. It carries the one-time `agent_token` and the
 * `manager_ws` the agent dials back to, so the credentials dialog can offer a
 * single runnable line instead of asking the user to assemble one.
 */
export function buildAgentRunCommand(agentToken: string, managerWs?: string): string {
  const manager = managerWs && managerWs.trim() ? managerWs.trim() : "<manager_ws>";
  return [
    "docker run -d --name wisper-agent \\",
    "  --restart unless-stopped \\",
    "  -v /var/run/docker.sock:/var/run/docker.sock \\",
    `  -e WISPER_MANAGER_WS=${manager} \\`,
    `  -e WISPER_AGENT_TOKEN=${agentToken} \\`,
    "  ghcr.io/wisper/agent:latest",
  ].join("\n");
}

/** How each Connect status reads in the UI: label + MUI color/severity intent. */
export interface ConnectStatusView {
  label: string;
  /** MUI palette intent for the status chip. */
  color: "default" | "success" | "warning" | "error" | "info";
  /** True once payouts are enabled and no further onboarding is required. */
  active: boolean;
}

/**
 * Resolve the account's Connect state from an {@link Earnings} summary into a
 * view model. Prefers the explicit `connect_status`, falling back to the
 * `can_receive_payouts` boolean, and defaults to "not started" when neither is
 * set.
 */
export function connectStatusView(earnings: Earnings | null): ConnectStatusView {
  const status: ConnectStatus | undefined =
    earnings?.connect_status ??
    (earnings?.can_receive_payouts === true
      ? "active"
      : earnings?.can_receive_payouts === false
        ? "not_started"
        : undefined);

  switch (status) {
    case "active":
      return { label: "Payouts enabled", color: "success", active: true };
    case "pending":
      return { label: "Onboarding pending", color: "warning", active: false };
    case "restricted":
      return { label: "Action required", color: "error", active: false };
    case "not_started":
    default:
      return { label: "Not set up", color: "default", active: false };
  }
}

/** Navigate the current window to `url` (e.g. Stripe's hosted onboarding). */
export function redirectTo(url: string): void {
  if (typeof window !== "undefined") window.location.assign(url);
}

/** Best-effort copy to the clipboard; resolves to whether the write succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to failure
  }
  return false;
}
