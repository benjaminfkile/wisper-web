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
        network: "egress",
        ttl_seconds: 3600,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith({ id: "l1", status: "pending" });
  });

  it("includes optional resources and userdata when provided", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "l2", status: "pending" });
    renderDialog();

    await user.type(screen.getByLabelText(/vCPUs/i), "2");
    await user.type(screen.getByLabelText(/Memory/i), "1024");
    await user.type(screen.getByLabelText(/Userdata/i), "echo hi");
    await user.click(screen.getByRole("button", { name: /create lease/i }));

    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: { cpu: 2, memory_mb: 1024 },
        userdata: "echo hi",
      }),
    );
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

  it("omits the GPU input for an offer with no GPUs", () => {
    renderDialog();
    expect(screen.queryByLabelText(/GPUs/i)).not.toBeInTheDocument();
  });

  it("shows a GPU input bounded by the offer's max_gpus", () => {
    renderDialog({ image: { ...image, max_gpus: 4 } });
    const field = screen.getByLabelText(/GPUs/i);
    expect(field).toHaveAttribute("max", "4");
    expect(field).toHaveAttribute("min", "0");
  });

  it("sends the requested gpus in resources, and omits them when left at 0", async () => {
    const user = userEvent.setup();
    createLease.mockResolvedValue({ id: "lg", status: "pending" });
    renderDialog({ image: { ...image, max_gpus: 4 } });

    // Left at the default 0 → no gpus in the payload.
    await user.click(screen.getByRole("button", { name: /create lease/i }));
    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease.mock.calls[0][0].resources?.gpus).toBeUndefined();

    // Ask for 2 → sent through resources.
    const field = screen.getByLabelText(/GPUs/i);
    await user.clear(field);
    await user.type(field, "2");
    await user.click(screen.getByRole("button", { name: /create lease/i }));
    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(2));
    expect(createLease.mock.calls[1][0].resources).toMatchObject({ gpus: 2 });
  });

  it("surfaces the API validation error on an over-ask without pre-clamping", async () => {
    const user = userEvent.setup();
    createLease.mockRejectedValue(
      new WisperError(400, "invalid_request", "gpus exceeds the offer maximum"),
    );
    renderDialog({ image: { ...image, max_gpus: 2 } });

    const field = screen.getByLabelText(/GPUs/i);
    await user.clear(field);
    await user.type(field, "5");
    await user.click(screen.getByRole("button", { name: /create lease/i }));

    // The over-ask is sent as typed (not clamped to 2) and the API's error shows.
    await waitFor(() => expect(createLease).toHaveBeenCalledTimes(1));
    expect(createLease.mock.calls[0][0].resources).toMatchObject({ gpus: 5 });
    expect(await screen.findByText(/gpus exceeds the offer maximum/i)).toBeInTheDocument();
  });

  it("surfaces a host_offline failure with a helpful message", async () => {
    const user = userEvent.setup();
    createLease.mockRejectedValue(new WisperError(409, "host_offline", "host is offline"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: /create lease/i }));

    expect(await screen.findByText(/currently offline/i)).toBeInTheDocument();
  });
});
