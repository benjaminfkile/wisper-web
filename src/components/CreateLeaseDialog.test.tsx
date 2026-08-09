import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateLeaseDialog from "./CreateLeaseDialog";
import type { CatalogHost, PricedImage } from "@/lib/wisper/types";

// Mock only the `wisper` calls; keep the real WisperError so `instanceof` works.
vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return { ...actual, wisper: { ...actual.wisper, createLease: vi.fn() } };
});

// next/link needs no router in unit tests when reduced to a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { wisper, WisperError } from "@/lib/wisper/client";

const createLease = wisper.createLease as Mock;

const host: CatalogHost = { host_id: "h1", label: "Falcon", region: "us-east", images: [] };
const image: PricedImage = {
  host_image_id: "img1",
  image_ref: "ubuntu-22.04",
  price_cents_per_min: 5,
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof CreateLeaseDialog>> = {}) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <CreateLeaseDialog
      open
      host={host}
      image={image}
      onClose={onClose}
      onCreated={onCreated}
      {...overrides}
    />,
  );
  return { onCreated, onClose };
}

describe("CreateLeaseDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("posts a lease with the selected host/image and default TTL", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "l1", status: "pending" });
    const { onCreated } = renderDialog();

    await user.click(screen.getByRole("button", { name: /create lease/i }));

    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        host_id: "h1",
        host_image_id: "img1",
        // The base offer advertises no networks, so the picker falls back to the
        // full valid set and defaults to its first mode ("none"), never "egress".
        network: "none",
        ttl_seconds: 3600,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith({ id: "l1", status: "pending" });
  });

  it("shows only the offer's advertised networks and defaults to its first", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "ln", status: "pending" });
    // Offer advertises none/open only — egress must not appear, and the default
    // must not be egress (the live bug this fixes).
    renderDialog({ image: { ...image, networks: ["none", "open"] } });

    await user.click(screen.getByLabelText(/Network/i));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["None", "Open"]);
    expect(screen.queryByRole("option", { name: "Egress" })).not.toBeInTheDocument();

    // Close the menu (pick the offer default) and submit — a supported mode is sent.
    await user.click(screen.getByRole("option", { name: "None" }));
    await user.click(screen.getByRole("button", { name: /create lease/i }));
    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease).toHaveBeenCalledWith(expect.objectContaining({ network: "none" }));
  });

  it("defaults to the offer's first advertised network, not egress, when egress is unsupported", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "lo", status: "pending" });
    // 'open' is first here; egress is not offered at all.
    renderDialog({ image: { ...image, networks: ["open", "none"] } });

    await user.click(screen.getByRole("button", { name: /create lease/i }));
    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease).toHaveBeenCalledWith(expect.objectContaining({ network: "open" }));
  });

  it("preselects and submits the sole network when an offer advertises only one", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "l1n", status: "pending" });
    renderDialog({ image: { ...image, networks: ["egress"] } });

    // The only advertised mode is preselected without any interaction.
    expect(screen.getByLabelText(/Network/i)).toHaveTextContent("Egress");

    await user.click(screen.getByRole("button", { name: /create lease/i }));
    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease).toHaveBeenCalledWith(expect.objectContaining({ network: "egress" }));
  });

  it("renders no compute inputs — a lease sells the offer's fixed size", () => {
    renderDialog({ image: { ...image, cpus: 8, memory_mb: 16384, gpus: 2 } });
    // The old free-form resource/GPU number inputs are gone; the API rejects
    // them. Scoped to spinbutton role so the read-only size chips don't match.
    expect(screen.queryByRole("spinbutton", { name: /vCPUs/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /Memory/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /Disk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /GPUs/i })).not.toBeInTheDocument();
  });

  it("sends no resources/gpus in the body, only userdata alongside the base fields", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "l2", status: "pending" });
    renderDialog();

    await user.type(screen.getByLabelText(/Userdata/i), "echo hi");
    await user.click(screen.getByRole("button", { name: /create lease/i }));

    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    const body = createLease.mock.calls[0][0];
    expect(body).toMatchObject({ host_id: "h1", host_image_id: "img1", userdata: "echo hi" });
    // A lease provisions the offer profile — never free-form resources/gpus.
    expect(body).not.toHaveProperty("resources");
    expect(body).not.toHaveProperty("gpus");
  });

  it("shows the offer's size profile read-only (vCPU / RAM / GPU chips)", () => {
    renderDialog({
      image: { ...image, cpus: 8, memory_mb: 16384, gpus: 2 },
      host: { ...host, gpu_classes: ["A100"] },
    });
    expect(screen.getByLabelText("vcpus 8 vCPU")).toBeInTheDocument();
    expect(screen.getByLabelText("ram 16 GB")).toBeInTheDocument();
    expect(screen.getByLabelText("gpus A100 × 2")).toBeInTheDocument();
  });

  it("shows 'host default' size chips and no GPU chip for a bare offer", () => {
    renderDialog();
    expect(screen.getByLabelText("vcpus vCPU: host default")).toBeInTheDocument();
    expect(screen.getByLabelText("ram RAM: host default")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^gpus /i)).not.toBeInTheDocument();
  });

  it("keeps the POSIX userdata hint for a linux host", () => {
    renderDialog({ host: { ...host, os: "linux" } });
    expect(screen.getByPlaceholderText(/#!\/bin\/sh/i)).toBeInTheDocument();
  });

  it("switches the userdata hint to cmd/PowerShell for a windows host", () => {
    renderDialog({ host: { ...host, os: "windows" } });
    const field = screen.getByLabelText(/Userdata/i);
    expect(field).toHaveAttribute("placeholder", expect.stringMatching(/powershell|cmd/i));
    expect(screen.getByText(/cmd or PowerShell/i)).toBeInTheDocument();
  });

  it("uses an OS-neutral userdata hint when the host os is unknown", () => {
    renderDialog({ host: { ...host, os: undefined } });
    const field = screen.getByLabelText(/Userdata/i);
    const placeholder = field.getAttribute("placeholder") ?? "";
    expect(placeholder).toMatch(/linux/i);
    expect(placeholder).toMatch(/windows/i);
  });

  it("omits the isolation control and field when the image advertises none", () => {
    renderDialog();
    expect(screen.queryByLabelText(/Isolation/i)).not.toBeInTheDocument();
  });

  it("defaults isolation to default_isolation and posts the chosen level", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "l3", status: "pending" });
    renderDialog({
      image: {
        ...image,
        isolation_levels: ["shared", "sandboxed", "vm"],
        default_isolation: "sandboxed",
      },
    });

    // Defaults to the host's default_isolation.
    expect(screen.getByLabelText(/Isolation/i)).toHaveTextContent("gVisor sandbox");

    // Pick a stronger level and submit.
    await user.click(screen.getByLabelText(/Isolation/i));
    await user.click(await screen.findByRole("option", { name: "VM isolation" }));
    await user.click(screen.getByRole("button", { name: /create lease/i }));

    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease).toHaveBeenCalledWith(expect.objectContaining({ isolation: "vm" }));
  });

  it("renders a read-only Shared indicator for a shared-only host", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "l4", status: "pending" });
    renderDialog({ image: { ...image, isolation_levels: ["shared"] } });

    // Read-only text field, not an interactive picker.
    const field = screen.getByLabelText(/Isolation/i);
    expect(field).toHaveValue("Shared kernel");
    expect(field).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button", { name: /create lease/i }));
    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease).toHaveBeenCalledWith(expect.objectContaining({ isolation: "shared" }));
  });

  it("surfaces a 402 insufficient_funds with a top-up link", async () => {
    const user = userEvent.setup();
    createLease.mockRejectedValue(new WisperError(402, "insufficient_funds", "wallet too low"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: /create lease/i }));

    const link = await screen.findByRole("link", { name: /top up your wallet/i });
    expect(link).toHaveAttribute("href", "/billing");
  });

  it("surfaces an at_capacity failure with a distinct, non-billing message", async () => {
    const user = userEvent.setup();
    createLease.mockRejectedValue(new WisperError(409, "at_capacity", "host is full"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: /create lease/i }));

    // Its own clear message — never the generic error text or the billing path.
    expect(await screen.findByText(/at capacity/i)).toBeInTheDocument();
    expect(screen.queryByText("host is full")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /top up your wallet/i })).not.toBeInTheDocument();
  });

  it("surfaces a host_offline failure with a helpful message", async () => {
    const user = userEvent.setup();
    createLease.mockRejectedValue(new WisperError(409, "host_offline", "host is offline"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: /create lease/i }));

    expect(await screen.findByText(/currently offline/i)).toBeInTheDocument();
  });
});
