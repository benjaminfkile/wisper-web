import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeaseDetail from "./LeaseDetail";
import type { Lease } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: { ...actual.wisper, getLease: vi.fn(), deleteLease: vi.fn() },
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { wisper } from "@/lib/wisper/client";

const getLease = wisper.getLease as Mock;
const deleteLease = wisper.deleteLease as Mock;

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: "l1",
    status: "active",
    host_id: "falcon-1",
    host_image_id: "ubuntu-22.04",
    network: "egress",
    ttl_seconds: 3600,
    ttl_seconds_remaining: 3540,
    created_at: "2026-07-12T00:00:00.000Z",
    started_at: "2026-07-12T00:00:00.000Z",
    cost_cents: 100,
    price_cents_per_min: 6,
    ...overrides,
  };
}

describe("LeaseDetail", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the status chip, facts, and live metrics", async () => {
    getLease.mockResolvedValue(lease());
    render(<LeaseDetail leaseId="l1" pollMs={0} />);

    // Status chip.
    expect(await screen.findByText("active")).toBeInTheDocument();
    // Facts.
    expect(screen.getByText("ubuntu-22.04")).toBeInTheDocument();
    expect(screen.getByText("falcon-1")).toBeInTheDocument();
    expect(screen.getByText("egress")).toBeInTheDocument();
    // Live metric labels.
    expect(screen.getByText("Uptime")).toBeInTheDocument();
    expect(screen.getByText("TTL remaining")).toBeInTheDocument();
    expect(screen.getByText("Running cost")).toBeInTheDocument();
    // Running cost renders as a 4-decimal dollar value that started from the base.
    expect(screen.getByText(/^\$1\.\d{4}$/)).toBeInTheDocument();
  });

  it("shows the OS field when the lease advertises one", async () => {
    getLease.mockResolvedValue(lease({ os: "windows" }));
    render(<LeaseDetail leaseId="l1" pollMs={0} />);

    expect(await screen.findByText("OS")).toBeInTheDocument();
    expect(screen.getByText("Windows")).toBeInTheDocument();
  });

  it("omits the OS field when the lease os is unknown", async () => {
    getLease.mockResolvedValue(lease({ os: undefined }));
    render(<LeaseDetail leaseId="l1" pollMs={0} />);

    await screen.findByText("active");
    expect(screen.queryByText("OS")).not.toBeInTheDocument();
  });

  it("switches the Exec command placeholder for a windows lease", async () => {
    const user = userEvent.setup();
    getLease.mockResolvedValue(lease({ os: "windows" }));
    render(<LeaseDetail leaseId="l1" pollMs={0} />);
    await screen.findByText("active");

    await user.click(screen.getByRole("tab", { name: "Exec" }));
    expect(await screen.findByPlaceholderText(/cmd \/c ver/i)).toBeInTheDocument();
  });

  it("exposes Overview, Console, and Exec tabs; gates them off until the lease is running", async () => {
    const user = userEvent.setup();
    // A non-active lease keeps the console/exec gated (info state), so this test
    // never mounts the real xterm terminal (unsupported in jsdom).
    getLease.mockResolvedValue(lease({ status: "provisioning" }));
    render(<LeaseDetail leaseId="l1" pollMs={0} />);
    await screen.findByText("provisioning");

    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Console" }));
    expect(await screen.findByText(/console is available while the lease is running/i)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Exec" }));
    expect(await screen.findByText(/exec is available while the lease is running/i)).toBeInTheDocument();
  });

  it("re-syncs the lease by polling", async () => {
    getLease
      .mockResolvedValueOnce(lease({ status: "provisioning" }))
      .mockResolvedValue(lease({ status: "active" }));
    render(<LeaseDetail leaseId="l1" pollMs={20} />);

    expect(await screen.findByText("provisioning")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("active")).toBeInTheDocument());
    expect(getLease.mock.calls.length).toBeGreaterThan(1);
  });

  it("releases the lease via DELETE and reloads", async () => {
    const user = userEvent.setup();
    getLease.mockResolvedValue(lease());
    deleteLease.mockResolvedValue(undefined);
    render(<LeaseDetail leaseId="l1" pollMs={0} />);
    await screen.findByText("active");

    await user.click(screen.getByRole("button", { name: /release/i }));
    await waitFor(() => expect(deleteLease).toHaveBeenCalledWith("l1"));
  });

  it("disables Release for a terminal lease", async () => {
    getLease.mockResolvedValue(lease({ status: "ended", ended_at: "2026-07-12T00:10:00.000Z" }));
    render(<LeaseDetail leaseId="l1" pollMs={0} />);
    await screen.findByText("ended");
    expect(screen.getByRole("button", { name: /release/i })).toBeDisabled();
  });
});
