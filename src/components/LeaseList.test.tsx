import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeaseList from "./LeaseList";
import type { Lease } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: { ...actual.wisper, listLeases: vi.fn(), deleteLease: vi.fn() },
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { wisper } from "@/lib/wisper/client";

const listLeases = wisper.listLeases as Mock;
const deleteLease = wisper.deleteLease as Mock;

const LEASES: Lease[] = [
  {
    id: "l1",
    status: "active",
    host_id: "h1",
    host_image_id: "ubuntu-22.04",
    network: "egress",
    ttl_seconds: 3600,
    created_at: "2026-07-12T00:00:00.000Z",
    cost_cents: 150,
  },
  {
    id: "l2",
    status: "ended",
    host_id: "h2",
    host_image_id: "debian-12",
    network: "none",
    ttl_seconds: 1800,
    created_at: "2026-07-11T00:00:00.000Z",
  },
];

describe("LeaseList", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders leases with status, cost, and TTL", async () => {
    listLeases.mockResolvedValue(LEASES);
    render(<LeaseList pollMs={0} />);

    expect(await screen.findByText("active")).toBeInTheDocument();
    expect(screen.getByText("ended")).toBeInTheDocument();
    expect(screen.getByText("ubuntu-22.04")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByText("1h 0m")).toBeInTheDocument();
  });

  it("shows a GPU chip only on leases that leased GPUs", async () => {
    listLeases.mockResolvedValue([{ ...LEASES[0], gpus: 2 }, LEASES[1]]);
    render(<LeaseList pollMs={0} />);

    // The GPU lease carries a "2 GPU" chip; the other lease carries none.
    expect(await screen.findByLabelText("gpus 2")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^gpus /i)).toHaveLength(1);
  });

  it("shows the provisioned vCPU/RAM profile chips when the lease sizes them", async () => {
    listLeases.mockResolvedValue([{ ...LEASES[0], cpus: 4, memory_mb: 8192 }, LEASES[1]]);
    render(<LeaseList pollMs={0} />);

    expect(await screen.findByLabelText("vcpus 4")).toBeInTheDocument();
    expect(screen.getByLabelText("ram 8 GB")).toBeInTheDocument();
    // Only the sized lease gets them.
    expect(screen.getAllByLabelText(/^vcpus /i)).toHaveLength(1);
  });

  it("shows no GPU chip when no leases have GPUs", async () => {
    listLeases.mockResolvedValue(LEASES);
    render(<LeaseList pollMs={0} />);
    await screen.findByText("active");
    expect(screen.queryByLabelText(/^gpus /i)).toBeNull();
  });

  it("shows an empty state with a catalog link when there are no leases", async () => {
    listLeases.mockResolvedValue([]);
    render(<LeaseList pollMs={0} />);
    expect(await screen.findByText(/no leases yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse catalog/i })).toHaveAttribute("href", "/catalog");
  });

  it("releases a lease via DELETE and reloads", async () => {
    const user = userEvent.setup();
    listLeases.mockResolvedValueOnce(LEASES).mockResolvedValueOnce([LEASES[1]]);
    deleteLease.mockResolvedValue(undefined);
    render(<LeaseList pollMs={0} />);

    await screen.findByText("active");
    const activeRow = screen.getByText("ubuntu-22.04").closest("tr") as HTMLElement;
    await user.click(within(activeRow).getByRole("button", { name: /release/i }));

    await waitFor(() => expect(deleteLease).toHaveBeenCalledWith("l1"));
    await waitFor(() => expect(screen.queryByText("active")).not.toBeInTheDocument());
  });

  it("disables Release for terminal leases", async () => {
    listLeases.mockResolvedValue([LEASES[1]]);
    render(<LeaseList pollMs={0} />);
    await screen.findByText("ended");
    const endedRow = screen.getByText("debian-12").closest("tr") as HTMLElement;
    expect(within(endedRow).getByRole("button", { name: /release/i })).toBeDisabled();
  });
});
