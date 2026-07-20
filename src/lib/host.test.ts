import { describe, expect, it } from "vitest";
import { buildAgentRunCommand, connectStatusView } from "./host";
import type { Earnings } from "@/lib/wisper/types";

const base: Earnings = { currency: "USD", accrued_cents: 0, paid_cents: 0 };

describe("buildAgentRunCommand", () => {
  it("embeds the agent token and manager WebSocket", () => {
    const cmd = buildAgentRunCommand("tok-abc", "wss://mgr.example/agent");
    expect(cmd).toContain("WISPER_AGENT_TOKEN=tok-abc");
    expect(cmd).toContain("WISPER_MANAGER_WS=wss://mgr.example/agent");
    expect(cmd).toContain("docker run");
  });

  it("falls back to a placeholder when the manager WS is missing", () => {
    const cmd = buildAgentRunCommand("tok-abc");
    expect(cmd).toContain("WISPER_MANAGER_WS=<manager_ws>");
  });
});

describe("connectStatusView", () => {
  it("defaults to not-set-up when nothing is reported", () => {
    expect(connectStatusView(null).active).toBe(false);
    expect(connectStatusView(base).label).toBe("Not set up");
  });

  it("reads can_receive_payouts as active/not-started", () => {
    expect(connectStatusView({ ...base, can_receive_payouts: true })).toMatchObject({
      active: true,
      color: "success",
    });
    expect(connectStatusView({ ...base, can_receive_payouts: false }).active).toBe(false);
  });

  it("prefers an explicit connect_status", () => {
    expect(connectStatusView({ ...base, connect_status: "pending" }).color).toBe("warning");
    expect(connectStatusView({ ...base, connect_status: "restricted" }).color).toBe("error");
    expect(connectStatusView({ ...base, connect_status: "active" }).active).toBe(true);
  });
});
