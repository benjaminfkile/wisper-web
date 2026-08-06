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
  data: [
    {
      host_id: "h1",
      label: "Falcon",
      region: "us-east",
      online: true,
      os: "linux",
      images: [
        {
          host_image_id: "img1",
          image_ref: "ubuntu-22.04",
          price_cents_per_min: 5,
          isolation_levels: ["shared", "sandboxed"],
        },
        {
          host_image_id: "img2",
          image_ref: "gpu-cuda",
          price_cents_per_min: 10,
          isolation_levels: ["vm"],
        },
      ],
    },
    {
      host_id: "h2",
      label: "Condor",
      region: "eu-west",
      online: true,
      images: [{ host_image_id: "img3", image_ref: "debian-12", price_cents_per_min: 2 }],
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
    // Hourly price rendering from the cents-per-minute unit (5c/min -> $3.00/hr).
    expect(screen.getByText("$3.00/hr")).toBeInTheDocument();
    expect(screen.getByText("$6.00/hr")).toBeInTheDocument();
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
      data: [
        {
          host_id: "hw",
          label: "Kestrel",
          region: "us-west",
          online: true,
          os: "windows",
          images: [{ host_image_id: "w1", image_ref: "windows-2022", price_cents_per_min: 5 }],
        },
      ],
    });
    render(<CatalogBrowser />);

    expect(await screen.findByText("Windows")).toBeInTheDocument();
  });

  it("shows each image's isolation levels as human-labeled chips", async () => {
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);

    // ubuntu-22.04 offers shared + sandboxed; both surface with their short labels.
    const ubuntuRow = (await screen.findByText("ubuntu-22.04")).closest(
      ".MuiCardContent-root",
    ) as HTMLElement;
    expect(within(ubuntuRow).getByText("Shared kernel")).toBeInTheDocument();
    expect(within(ubuntuRow).getByText("gVisor sandbox")).toBeInTheDocument();
    // gpu-cuda offers VM isolation.
    expect(screen.getByText("VM isolation")).toBeInTheDocument();
    // Condor's image advertises none, so no isolation chip appears on its card.
    const condorCard = screen.getByText("Condor").closest(".MuiCard-root") as HTMLElement;
    expect(within(condorCard).queryByText(/kernel|sandbox|VM isolation/i)).toBeNull();
  });

  it("filters images by a minimum isolation level", async () => {
    const user = userEvent.setup();
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);
    await screen.findByText("Falcon");

    await user.click(screen.getByLabelText(/Min isolation/i));
    await user.click(await screen.findByRole("option", { name: "VM isolation" }));

    // Only gpu-cuda (vm) survives; shared/sandboxed-only images drop out.
    await waitFor(() => expect(screen.queryByText("ubuntu-22.04")).not.toBeInTheDocument());
    expect(screen.getByText("gpu-cuda")).toBeInTheDocument();
    expect(screen.queryByText("debian-12")).not.toBeInTheDocument();
  });

  it("shows an error alert when the catalog fails to load", async () => {
    getCatalog.mockRejectedValue(new Error("boom"));
    render(<CatalogBrowser />);
    expect(await screen.findByText(/Failed to load the catalog/i)).toBeInTheDocument();
  });

  // ---- GPU support ----------------------------------------------------------

  const GPU_CATALOG: Catalog = {
    data: [
      {
        host_id: "g1",
        label: "Nova",
        region: "us-east",
        online: true,
        gpu_classes: ["A100"],
        gpu_count: 4,
        images: [
          { host_image_id: "gi1", image_ref: "cuda-12", price_cents_per_min: 20, max_gpus: 2 },
          { host_image_id: "gi2", image_ref: "cpu-only", price_cents_per_min: 5 },
        ],
      },
    ],
  };

  it("renders a GPU badge only on offers with max_gpus > 0", async () => {
    getCatalog.mockResolvedValue(GPU_CATALOG);
    render(<CatalogBrowser />);

    // The GPU-bearing offer carries a "A100 × 2" badge (class × offer count).
    expect(await screen.findByLabelText("gpu A100 × 2")).toBeInTheDocument();

    // Only that offer gets one — the CPU-only offer on the same host does not.
    // (Match the badge's `class × count` label, not the "GPU class" filter.)
    expect(screen.getByText("cpu-only")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^gpu .*×/i)).toHaveLength(1);
  });

  it("shows the host's GPU classes and count when present", async () => {
    getCatalog.mockResolvedValue(GPU_CATALOG);
    render(<CatalogBrowser />);

    expect(await screen.findByLabelText(/host gpus A100 · 4 GPUs/i)).toBeInTheDocument();
  });

  it("sends min_gpus and gpu_class to the API when the GPU filters change", async () => {
    const user = userEvent.setup();
    getCatalog.mockResolvedValue(GPU_CATALOG);
    render(<CatalogBrowser />);
    await screen.findByText("Nova");

    // Initial load hits the bare catalog (no GPU filters).
    expect(getCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ min_gpus: undefined, gpu_class: undefined }),
    );

    await user.type(screen.getByLabelText(/Min GPUs/i), "2");
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ min_gpus: 2 })),
    );

    await user.click(screen.getByLabelText(/GPU class/i));
    await user.click(await screen.findByRole("option", { name: "A100" }));
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ gpu_class: "A100" })),
    );
  });

  it("hides the GPU filter controls and badges in a zero-GPU catalog", async () => {
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);
    await screen.findByText("Falcon");

    // No GPU filter noise when nothing in the catalog advertises a GPU.
    expect(screen.queryByLabelText(/Min GPUs/i)).toBeNull();
    expect(screen.queryByLabelText(/GPU class/i)).toBeNull();
    // No GPU badges either.
    expect(screen.queryByLabelText(/^gpu /i)).toBeNull();
    expect(screen.queryByLabelText(/host gpus/i)).toBeNull();
  });
});
