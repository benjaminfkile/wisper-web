import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostImagesEditor from "./HostImagesEditor";
import type { Host, HostImage } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: { ...actual.wisper, getHostImages: vi.fn(), updateHostImages: vi.fn() },
  };
});

import { wisper } from "@/lib/wisper/client";

const getHostImages = wisper.getHostImages as Mock;
const updateHostImages = wisper.updateHostImages as Mock;

const HOST: Host = { id: "host-1", name: "workstation" };

const IMAGES: HostImage[] = [
  {
    host_image_id: "img-1",
    image_ref: "ubuntu-22.04",
    price_cents_per_min: 5,
    max_ttl_seconds: 3600,
    networks: ["none", "open"],
    enabled: true,
  },
];

describe("HostImagesEditor", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads rows from GET /hosts/:id/images with a $/hr price", async () => {
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    // Loaded asynchronously (avoids a blank PUT wiping the list).
    expect(await screen.findByDisplayValue("ubuntu-22.04")).toBeInTheDocument();
    expect(getHostImages).toHaveBeenCalledWith("host-1");
    // 5 cents/min -> $3.00/hr.
    expect(screen.getByLabelText("price for ubuntu-22.04")).toHaveValue(3);
    // 3600s -> 60 min.
    expect(screen.getByLabelText("max ttl minutes for ubuntu-22.04")).toHaveValue(60);
  });

  it("saves the full image list with price, ttl, and networks", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockResolvedValue({ ...HOST });
    const onSaved = vi.fn();
    render(<HostImagesEditor host={HOST} onSaved={onSaved} />);

    const price = await screen.findByLabelText("price for ubuntu-22.04");
    await user.clear(price);
    await user.type(price, "6");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateHostImages).toHaveBeenCalledTimes(1));
    const [id, body] = updateHostImages.mock.calls[0];
    expect(id).toBe("host-1");
    expect(body.images[0]).toMatchObject({
      host_image_id: "img-1",
      image_ref: "ubuntu-22.04",
      enabled: true,
      price_cents_per_min: 10, // $6.00/hr
      max_ttl_seconds: 3600,
      networks: ["none", "open"],
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("adds and removes image rows", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockResolvedValue({ ...HOST });
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    await screen.findByDisplayValue("ubuntu-22.04");

    await user.click(screen.getByRole("button", { name: /add image/i }));
    const names = screen.getAllByLabelText("image name");
    expect(names).toHaveLength(2);

    // New empty row (blank name) makes the form invalid -> save disabled.
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /remove ubuntu-22.04/i }));
    expect(screen.getAllByLabelText("image name")).toHaveLength(1);
  });

  it("disables the Max GPUs field with a hint when the host has no GPU", async () => {
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    const field = await screen.findByLabelText("max gpus for ubuntu-22.04");
    expect(field).toBeDisabled();
    expect(screen.getByText("no GPU detected on this host")).toBeInTheDocument();
  });

  it("enables Max GPUs and shows the detected class when gpu_count > 0", async () => {
    getHostImages.mockResolvedValue(IMAGES);
    const gpuHost: Host = {
      ...HOST,
      gpu_count: 1,
      gpu_classes: ["nvidia-geforce-rtx-3050"],
    };
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);
    const field = await screen.findByLabelText("max gpus for ubuntu-22.04");
    expect(field).not.toBeDisabled();
    expect(screen.getByText("nvidia-geforce-rtx-3050")).toBeInTheDocument();
  });

  it("includes max_gpus in the save payload", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockResolvedValue({ ...HOST });
    const gpuHost: Host = { ...HOST, gpu_count: 2, gpu_classes: ["A100"] };
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);

    const field = await screen.findByLabelText("max gpus for ubuntu-22.04");
    await user.clear(field);
    await user.type(field, "1");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateHostImages).toHaveBeenCalledTimes(1));
    const [, body] = updateHostImages.mock.calls[0];
    expect(body.images[0]).toMatchObject({ image_ref: "ubuntu-22.04", max_gpus: 1 });
  });

  it("blocks saving a max_gpus above the host's capacity", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    const gpuHost: Host = { ...HOST, gpu_count: 1, gpu_classes: ["A100"] };
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);

    const field = await screen.findByLabelText("max gpus for ubuntu-22.04");
    await user.clear(field);
    await user.type(field, "2");

    expect(screen.getByText("Max 1 on this host")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("shows the 'GPU: up to N' indicator only when max_gpus > 0", async () => {
    const gpuHost: Host = { ...HOST, gpu_count: 2, gpu_classes: ["A100"] };
    getHostImages.mockResolvedValue([{ ...IMAGES[0], max_gpus: 2 }]);
    const { unmount } = render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);
    expect(await screen.findByText("GPU: up to 2")).toBeInTheDocument();
    unmount();

    getHostImages.mockResolvedValue([{ ...IMAGES[0], max_gpus: 0 }]);
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);
    await screen.findByDisplayValue("ubuntu-22.04");
    expect(screen.queryByText(/GPU: up to/)).not.toBeInTheDocument();
  });

  it("offers all three networks when the host advertises no capability", async () => {
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    const group = await screen.findByRole("group", { name: /networks for ubuntu-22.04/i });
    const toggles = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(toggles).toEqual(["none", "open", "egress"]);
  });

  it("offers only the host's supported networks as toggles", async () => {
    getHostImages.mockResolvedValue([{ ...IMAGES[0], networks: ["none"] }]);
    const restrictedHost: Host = { ...HOST, supported_networks: ["none", "open"] };
    render(<HostImagesEditor host={restrictedHost} onSaved={() => {}} />);
    const group = await screen.findByRole("group", { name: /networks for ubuntu-22.04/i });
    const toggles = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    // egress is not a host capability here, so it must not be offerable.
    expect(toggles).toEqual(["none", "open"]);
  });

  it("starts a new row with host-supported default networks only", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockResolvedValue({ ...HOST });
    // Host supports only egress -> a new row defaults to [egress], not none/open.
    const egressHost: Host = { ...HOST, supported_networks: ["egress"] };
    render(<HostImagesEditor host={egressHost} onSaved={() => {}} />);
    await screen.findByDisplayValue("ubuntu-22.04");

    await user.click(screen.getByRole("button", { name: /add image/i }));
    const groups = screen.getAllByRole("group", { name: /networks for/i });
    // The new (blank-name) row is the last group; its only toggle is egress, pressed.
    const newGroup = groups[groups.length - 1];
    const pressed = Array.from(newGroup.querySelectorAll("button"))
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
    expect(pressed).toEqual(["egress"]);
  });

  it("surfaces a save error", async () => {
    const user = userEvent.setup();
    const { WisperError } = await import("@/lib/wisper/client");
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockRejectedValue(new WisperError(400, "invalid", "bad pricing"));
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    await screen.findByDisplayValue("ubuntu-22.04");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("bad pricing")).toBeInTheDocument();
  });
});
