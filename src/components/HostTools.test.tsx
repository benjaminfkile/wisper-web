import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostTools from "./HostTools";
import type { Earnings, Host, RegisterHostResponse, Role } from "@/lib/wisper/types";

// Controllable auth: tests flip the role set and observe refresh() calls.
const authState: { roles: Role[]; refresh: Mock } = { roles: ["consumer"], refresh: vi.fn() };
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({
    hasRole: (role: Role) => authState.roles.includes(role),
    refresh: authState.refresh,
  }),
}));

// Stub the redirect helper so onboarding navigation is observable (jsdom can't
// spy on window.location.assign directly).
const redirectTo = vi.fn();
vi.mock("@/lib/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host")>();
  return { ...actual, redirectTo: (url: string) => redirectTo(url) };
});

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: {
      ...actual.wisper,
      myHosts: vi.fn(),
      getEarnings: vi.fn(),
      registerHost: vi.fn(),
      hostConnect: vi.fn(),
      updateHostImages: vi.fn(),
    },
  };
});

import { wisper } from "@/lib/wisper/client";

const myHosts = wisper.myHosts as Mock;
const getEarnings = wisper.getEarnings as Mock;
const registerHost = wisper.registerHost as Mock;
const hostConnect = wisper.hostConnect as Mock;

const HOSTS: Host[] = [
  {
    id: "host-1",
    name: "workstation",
    region: "us-east",
    status: "online",
    images: [{ id: "img-1", name: "ubuntu-22.04", price_micro_usd_per_second: 278, enabled: true }],
  },
];

const EARNINGS: Earnings = {
  total_micro_usd: 42_000_000,
  available_micro_usd: 10_000_000,
  currency: "USD",
  payouts_enabled: false,
};

const REGISTERED: RegisterHostResponse = {
  host: { id: "host-2", name: "new-host" },
  agent_token: "secret-token-xyz",
  manager_ws: "wss://mgr.example/agent",
};

beforeEach(() => {
  authState.roles = ["consumer"];
  authState.refresh = vi.fn().mockResolvedValue(undefined);
  myHosts.mockResolvedValue(HOSTS);
  getEarnings.mockResolvedValue(EARNINGS);
});

afterEach(() => vi.clearAllMocks());

describe("HostTools — role gating (additive)", () => {
  it("shows the become-a-host panel to consumers and does not load host data", async () => {
    render(<HostTools />);
    expect(await screen.findByRole("heading", { name: /become a host/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /become a host/i })).toBeInTheDocument();
    expect(myHosts).not.toHaveBeenCalled();
    expect(getEarnings).not.toHaveBeenCalled();
  });

  it("shows full host tools when the account holds the host role", async () => {
    authState.roles = ["consumer", "host"];
    render(<HostTools />);
    expect(await screen.findByRole("heading", { name: /host tools/i })).toBeInTheDocument();
    expect(await screen.findByText("workstation")).toBeInTheDocument();
    await waitFor(() => expect(getEarnings).toHaveBeenCalled());
    // Earnings total ($42.00) and its Connect CTA.
    expect(screen.getByText("$42.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up payouts/i })).toBeInTheDocument();
  });
});

describe("HostTools — registration", () => {
  it("registers a host, reveals the one-time token, and refreshes roles", async () => {
    const user = userEvent.setup();
    registerHost.mockResolvedValue(REGISTERED);
    render(<HostTools />);

    await screen.findByRole("heading", { name: /become a host/i });
    await user.type(screen.getByLabelText(/host name/i), "new-host");
    await user.click(screen.getByRole("button", { name: /become a host/i }));

    await waitFor(() => expect(registerHost).toHaveBeenCalledWith({ name: "new-host" }));

    // The one-time credentials dialog surfaces the token, manager ws, and run cmd.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("secret-token-xyz")).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be retrieved again/i)).toBeInTheDocument();
    // Manager WS shows both as its own field and inside the run command.
    expect(within(dialog).getAllByText(/wss:\/\/mgr.example\/agent/).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText(/copy run command/i)).toBeInTheDocument();
    // Roles refreshed so the host role is picked up in place.
    expect(authState.refresh).toHaveBeenCalled();
  });
});

describe("HostTools — Stripe Connect onboarding", () => {
  it("redirects to the onboarding URL when setting up payouts", async () => {
    authState.roles = ["consumer", "host"];
    hostConnect.mockResolvedValue({ onboarding_url: "https://connect.stripe.example/onboard" });
    const user = userEvent.setup();
    render(<HostTools />);

    const btn = await screen.findByRole("button", { name: /set up payouts/i });
    await user.click(btn);

    await waitFor(() => expect(hostConnect).toHaveBeenCalled());
    expect(redirectTo).toHaveBeenCalledWith("https://connect.stripe.example/onboard");
  });

  it("shows payouts-enabled status without an onboarding prompt", async () => {
    authState.roles = ["consumer", "host"];
    getEarnings.mockResolvedValue({ ...EARNINGS, payouts_enabled: true });
    render(<HostTools />);
    expect(await screen.findByText(/payouts enabled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage payouts/i })).toBeInTheDocument();
  });
});
