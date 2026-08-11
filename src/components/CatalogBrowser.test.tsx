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
      // Isolation is a HOST capability: every image here can use any of these.
      isolation_levels: ["shared", "sandboxed", "vm"],
      default_isolation: "vm",
      images: [
        {
          host_image_id: "img1",
          image_ref: "ubuntu-22.04",
          price_cents_per_min: 5,
        },
        {
          host_image_id: "img2",
          image_ref: "gpu-cuda",
          price_cents_per_min: 10,
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

  it("shows the host's isolation tiers with strength labels", async () => {
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);

    // Falcon advertises all three tiers at the HOST level; each surfaces once with
    // its strength-prefixed label (strongest first).
    const falconCard = (await screen.findByText("Falcon")).closest(
      ".MuiCard-root",
    ) as HTMLElement;
    expect(within(falconCard).getByText("Strongest · VM isolation")).toBeInTheDocument();
    expect(within(falconCard).getByText("Hardened · gVisor sandbox")).toBeInTheDocument();
    expect(within(falconCard).getByText("Basic · Shared kernel")).toBeInTheDocument();
    // Condor advertises none, so no isolation section appears on its card.
    const condorCard = screen.getByText("Condor").closest(".MuiCard-root") as HTMLElement;
    expect(within(condorCard).queryByText(/kernel|sandbox|VM isolation/i)).toBeNull();
  });

  it("filters whole hosts by a minimum isolation level", async () => {
    const user = userEvent.setup();
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);
    await screen.findByText("Falcon");

    await user.click(screen.getByLabelText(/Min isolation/i));
    await user.click(await screen.findByRole("option", { name: "Strongest · VM isolation" }));

    // Falcon offers vm so both its images stay; Condor offers no tiers and drops out.
    await waitFor(() => expect(screen.queryByText("debian-12")).not.toBeInTheDocument());
    expect(screen.getByText("ubuntu-22.04")).toBeInTheDocument();
    expect(screen.getByText("gpu-cuda")).toBeInTheDocument();
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
          {
            host_image_id: "gi1",
            image_ref: "cuda-12",
            price_cents_per_min: 20,
            cpus: 8,
            memory_mb: 16384,
            gpus: 2,
          },
          { host_image_id: "gi2", image_ref: "cpu-only", price_cents_per_min: 5 },
        ],
      },
    ],
  };

  it("renders a GPU badge only on offers with gpus > 0", async () => {
    getCatalog.mockResolvedValue(GPU_CATALOG);
    render(<CatalogBrowser />);

    // The GPU-bearing offer carries a "A100 × 2" badge (class × offer count).
    expect(await screen.findByLabelText("gpu A100 × 2")).toBeInTheDocument();

    // Only that offer gets one — the CPU-only offer on the same host does not.
    // (Match the badge's `class × count` label, not the "GPU class" filter.)
    expect(screen.getByText("cpu-only")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^gpu .*×/i)).toHaveLength(1);
  });

  it("renders each offer's size profile next to its price", async () => {
    getCatalog.mockResolvedValue(GPU_CATALOG);
    render(<CatalogBrowser />);

    // The sized offer shows its vCPUs and RAM (16384 MB -> 16 GB) as chips. With
    // no effective/source fields (older payload) the raw size is shown as-is.
    expect(await screen.findByLabelText("offer vcpus 8 vCPU")).toBeInTheDocument();
    expect(screen.getByLabelText("offer ram 16 GB")).toBeInTheDocument();

    // The CPU-only offer carries no resolvable size, so both dimensions read
    // "unspecified" — never a bare "host default" with no number.
    expect(screen.getByLabelText("offer vcpus vCPU: unspecified")).toBeInTheDocument();
    expect(screen.getByLabelText("offer ram RAM: unspecified")).toBeInTheDocument();
  });

  // ---- Resolved effective sizes --------------------------------------------

  const RESOLVED_CATALOG: Catalog = {
    data: [
      {
        host_id: "r1",
        label: "Resolver",
        region: "us-east",
        online: true,
        images: [
          // Effective values come straight from the offer's own profile.
          {
            host_image_id: "ro",
            image_ref: "sized-offer",
            price_cents_per_min: 5,
            cpus: 2,
            memory_mb: 2048,
            effective_cpus: 2,
            effective_memory_mb: 2048,
            resources_source: "offer",
          },
          // Host-defaulted: the resolved numbers are the host's cap, annotated.
          {
            host_image_id: "rc",
            image_ref: "capped-offer",
            price_cents_per_min: 5,
            cpus: null,
            memory_mb: null,
            effective_cpus: 4,
            effective_memory_mb: 4096,
            resources_source: "host_cap",
          },
          // Genuinely unresolvable — falls back to "unspecified".
          {
            host_image_id: "ru",
            image_ref: "unknown-offer",
            price_cents_per_min: 5,
            effective_cpus: null,
            effective_memory_mb: null,
            resources_source: "unknown",
          },
        ],
      },
    ],
  };

  it("renders resolved effective sizes: plain, host-cap-annotated, and unspecified", async () => {
    getCatalog.mockResolvedValue(RESOLVED_CATALOG);
    render(<CatalogBrowser />);

    // "offer" source → the number, no annotation.
    expect(await screen.findByLabelText("offer vcpus 2 vCPU")).toBeInTheDocument();
    expect(screen.getByLabelText("offer ram 2 GB")).toBeInTheDocument();

    // "host_cap" source → the resolved number kept, annotated "(host cap)".
    expect(screen.getByLabelText("offer vcpus 4 vCPU (host cap)")).toBeInTheDocument();
    expect(screen.getByLabelText("offer ram 4 GB (host cap)")).toBeInTheDocument();

    // "unknown" source → the only fallback to "unspecified".
    expect(screen.getByLabelText("offer vcpus vCPU: unspecified")).toBeInTheDocument();
    expect(screen.getByLabelText("offer ram RAM: unspecified")).toBeInTheDocument();
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

  // ---- Capacity ------------------------------------------------------------

  const CAPACITY_CATALOG: Catalog = {
    data: [
      {
        host_id: "full1",
        label: "Fullhouse",
        region: "us-east",
        online: true,
        at_capacity: true,
        active_leases: 5,
        max_leases: 5,
        images: [{ host_image_id: "fi1", image_ref: "ubuntu-22.04", price_cents_per_min: 5 }],
      },
      {
        host_id: "free1",
        label: "Roomy",
        region: "us-east",
        online: true,
        at_capacity: false,
        active_leases: 1,
        max_leases: 8,
        images: [{ host_image_id: "ri1", image_ref: "debian-12", price_cents_per_min: 3 }],
      },
    ],
  };

  it("badges a full host and gates its Lease button; leaves a roomy host free", async () => {
    getCatalog.mockResolvedValue(CAPACITY_CATALOG);
    render(<CatalogBrowser />);

    const fullCard = (await screen.findByText("Fullhouse")).closest(".MuiCard-root") as HTMLElement;
    // The full host is badged and shows its usage; its Lease button is disabled.
    expect(within(fullCard).getByLabelText("at capacity")).toBeInTheDocument();
    expect(within(fullCard).getByLabelText("host leases 5 / 5 leases")).toBeInTheDocument();
    expect(within(fullCard).getByRole("button", { name: /^lease$/i })).toBeDisabled();

    // The roomy host carries no capacity badge and stays leasable.
    const roomyCard = screen.getByText("Roomy").closest(".MuiCard-root") as HTMLElement;
    expect(within(roomyCard).queryByLabelText("at capacity")).toBeNull();
    expect(within(roomyCard).getByLabelText("host leases 1 / 8 leases")).toBeInTheDocument();
    expect(within(roomyCard).getByRole("button", { name: /^lease$/i })).toBeEnabled();
  });

  it("tolerates absent capacity fields — no badge, no usage line, Lease enabled", async () => {
    getCatalog.mockResolvedValue(CATALOG);
    render(<CatalogBrowser />);

    const falconCard = (await screen.findByText("Falcon")).closest(".MuiCard-root") as HTMLElement;
    expect(within(falconCard).queryByLabelText("at capacity")).toBeNull();
    expect(within(falconCard).queryByLabelText(/host leases/i)).toBeNull();
    expect(within(falconCard).getAllByRole("button", { name: /^lease$/i })[0]).toBeEnabled();
  });
});
