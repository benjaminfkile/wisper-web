import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CatalogBrowser from "./CatalogBrowser";
import type { Catalog } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: { ...actual.wisper, getCatalog: vi.fn(), createLease: vi.fn() },
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { wisper } from "@/lib/wisper/client";

const getCatalog = wisper.getCatalog as Mock;

const CATALOG: Catalog = {
  hosts: [
    {
      id: "h1",
      name: "Falcon",
      region: "us-east",
      status: "online",
      os: "linux",
      images: [
        { id: "img1", name: "ubuntu-22.04", price_micro_usd_per_second: 1_000_000 / 3600 },
        { id: "img2", name: "gpu-cuda", price_micro_usd_per_second: 2_000_000 / 3600 },
      ],
    },
    {
      id: "h2",
      name: "Condor",
      region: "eu-west",
      status: "online",
      images: [{ id: "img3", name: "debian-12", price_micro_usd_per_second: 500_000 / 3600 }],
    },
  ],
};

describe("CatalogBrowser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders host cards with priced images", async () => {
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);

    expect(await screen.findByText("Falcon")).toBeInTheDocument();
    expect(screen.getByText("Condor")).toBeInTheDocument();
    expect(screen.getByText("ubuntu-22.04")).toBeInTheDocument();
    expect(screen.getByText("gpu-cuda")).toBeInTheDocument();
    // Hourly price rendering from the per-second unit.
    expect(screen.getByText("$1.00/hr")).toBeInTheDocument();
    expect(screen.getByText("$2.00/hr")).toBeInTheDocument();
  });

  it("filters by image name via the search box", async () => {
    const user = userEvent.setup();
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);
    await screen.findByText("Falcon");

    await user.type(screen.getByLabelText(/Search/i), "debian");

    await waitFor(() => expect(screen.queryByText("ubuntu-22.04")).not.toBeInTheDocument());
    expect(screen.getByText("debian-12")).toBeInTheDocument();
    expect(screen.getByText("Condor")).toBeInTheDocument();
    expect(screen.queryByText("Falcon")).not.toBeInTheDocument();
  });

  it("opens the Create Lease dialog for the chosen image", async () => {
    const user = userEvent.setup();
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);
    await screen.findByText("Falcon");

    // The first Lease button belongs to Falcon / ubuntu-22.04.
    const leaseButtons = screen.getAllByRole("button", { name: /^lease$/i });
    await user.click(leaseButtons[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /create lease/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/on Falcon/i)).toBeInTheDocument();
  });

  it("shows an OS chip only for hosts that advertise one", async () => {
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);

    // Falcon advertises linux; its card carries a "Linux" chip.
    const falconCard = (await screen.findByText("Falcon")).closest(".MuiCard-root");
    expect(falconCard).not.toBeNull();
    expect(within(falconCard as HTMLElement).getByText("Linux")).toBeInTheDocument();

    // Condor has no os; nothing is rendered for it.
    const condorCard = screen.getByText("Condor").closest(".MuiCard-root");
    expect(within(condorCard as HTMLElement).queryByText(/linux|windows/i)).toBeNull();
  });

  it("labels a Windows host with a Windows chip", async () => {
    getCatalog.mockResolvedValue({
      hosts: [
        {
          id: "hw",
          name: "Kestrel",
          region: "us-west",
          status: "online",
          os: "windows",
          images: [{ id: "w1", name: "windows-2022", price_micro_usd_per_second: 300 }],
        },
      ],
    });
    render(<CatalogBrowser />);

    expect(await screen.findByText("Windows")).toBeInTheDocument();
  });

  it("shows an error alert when the catalog fails to load", async () => {
    getCatalog.mockRejectedValue(new Error("boom"));
    render(<CatalogBrowser />);
    expect(await screen.findByText(/Failed to load the catalog/i)).toBeInTheDocument();
  });
});
