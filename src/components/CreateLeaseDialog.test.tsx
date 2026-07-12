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

const host: CatalogHost = { id: "h1", name: "Falcon", region: "us-east", images: [] };
const image: PricedImage = { id: "img1", name: "ubuntu-22.04", price_micro_usd_per_second: 278 };

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

  it("surfaces a 402 insufficient_funds with a top-up link", async () => {
    const user = userEvent.setup();
    createLease.mockRejectedValue(new WisperError(402, "insufficient_funds", "wallet too low"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: /create lease/i }));

    const link = await screen.findByRole("link", { name: /top up your wallet/i });
    expect(link).toHaveAttribute("href", "/billing");
  });

  it("surfaces a host_offline failure with a helpful message", async () => {
    const user = userEvent.setup();
    createLease.mockRejectedValue(new WisperError(409, "host_offline", "host is offline"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: /create lease/i }));

    expect(await screen.findByText(/currently offline/i)).toBeInTheDocument();
  });
});
