import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostImagesEditor, { readHostCaps } from "./HostImagesEditor";
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
      gpus: 0,
    });
    // Blank vCPU/RAM = omit (host default) — NOT a 0 on the wire.
    expect(body.images[0].cpus).toBeUndefined();
    expect(body.images[0].memory_mb).toBeUndefined();
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

  it("disables the GPUs field with a hint when the host has no GPU", async () => {
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    const field = await screen.findByLabelText("gpus for ubuntu-22.04");
    expect(field).toBeDisabled();
    expect(screen.getByText("no GPU detected on this host")).toBeInTheDocument();
  });

  it("enables GPUs and shows the detected class when gpu_count > 0", async () => {
    getHostImages.mockResolvedValue(IMAGES);
    const gpuHost: Host = {
      ...HOST,
      gpu_count: 1,
      gpu_classes: ["nvidia-geforce-rtx-3050"],
    };
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);
    const field = await screen.findByLabelText("gpus for ubuntu-22.04");
    expect(field).not.toBeDisabled();
    expect(screen.getByText("nvidia-geforce-rtx-3050")).toBeInTheDocument();
  });

  it("includes the exact gpus in the save payload", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockResolvedValue({ ...HOST });
    const gpuHost: Host = { ...HOST, gpu_count: 2, gpu_classes: ["A100"] };
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);

    const field = await screen.findByLabelText("gpus for ubuntu-22.04");
    await user.clear(field);
    await user.type(field, "1");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateHostImages).toHaveBeenCalledTimes(1));
    const [, body] = updateHostImages.mock.calls[0];
    expect(body.images[0]).toMatchObject({ image_ref: "ubuntu-22.04", gpus: 1 });
  });

  it("blocks saving gpus above the host's capacity (gpu_count)", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    const gpuHost: Host = { ...HOST, gpu_count: 1, gpu_classes: ["A100"] };
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);

    const field = await screen.findByLabelText("gpus for ubuntu-22.04");
    await user.clear(field);
    await user.type(field, "2");

    expect(screen.getByText("Max 1 on this host")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("shows the exact 'N GPUs' indicator only when gpus > 0", async () => {
    const gpuHost: Host = { ...HOST, gpu_count: 2, gpu_classes: ["A100"] };
    getHostImages.mockResolvedValue([{ ...IMAGES[0], gpus: 2 }]);
    const { unmount } = render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);
    expect(await screen.findByText("2 GPUs")).toBeInTheDocument();
    unmount();

    getHostImages.mockResolvedValue([{ ...IMAGES[0], gpus: 0 }]);
    render(<HostImagesEditor host={gpuHost} onSaved={() => {}} />);
    await screen.findByDisplayValue("ubuntu-22.04");
    // The caption reads "<n> GPU(s)"; the "GPUs" column header must not match.
    expect(screen.queryByText(/\d+ GPUs?/)).not.toBeInTheDocument();
  });

  it("seeds vCPUs and RAM (GB) from the offer's size profile", async () => {
    getHostImages.mockResolvedValue([
      { ...IMAGES[0], cpus: 4, memory_mb: 8192 },
    ]);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    // vCPUs seed directly; memory_mb (8192 MB) shows as 8 GB.
    expect(await screen.findByLabelText("vcpus for ubuntu-22.04")).toHaveValue(4);
    expect(screen.getByLabelText("ram gb for ubuntu-22.04")).toHaveValue(8);
  });

  it("shows 'host default' when the offer omits vCPUs/RAM", async () => {
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    await screen.findByLabelText("vcpus for ubuntu-22.04");
    // Both blank fields hint the host-side default rather than a bare 0.
    expect(screen.getAllByText("host default")).toHaveLength(2);
  });

  it("sends vCPUs and RAM converted to memory_mb, and omits blanks (no 0)", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockResolvedValue({ ...HOST });
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);

    const cpus = await screen.findByLabelText("vcpus for ubuntu-22.04");
    await user.clear(cpus);
    await user.type(cpus, "2");
    const ram = screen.getByLabelText("ram gb for ubuntu-22.04");
    await user.clear(ram);
    await user.type(ram, "4");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateHostImages).toHaveBeenCalledTimes(1));
    const [, body] = updateHostImages.mock.calls[0];
    // 4 GB -> 4096 MB on the wire.
    expect(body.images[0]).toMatchObject({ cpus: 2, memory_mb: 4096 });

    // Now clear both again and re-save: blanks must NOT send a 0.
    await user.clear(screen.getByLabelText("vcpus for ubuntu-22.04"));
    await user.clear(screen.getByLabelText("ram gb for ubuntu-22.04"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateHostImages).toHaveBeenCalledTimes(2));
    const [, body2] = updateHostImages.mock.calls[1];
    expect(body2.images[0].cpus).toBeUndefined();
    expect(body2.images[0].memory_mb).toBeUndefined();
  });

  it("blocks saving a non-positive vCPU count", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);

    const cpus = await screen.findByLabelText("vcpus for ubuntu-22.04");
    await user.clear(cpus);
    await user.type(cpus, "0");
    expect(screen.getByText("Whole number ≥ 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
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

  // --- host per-lease caps: prefill, bounds, conversion, offline, layout ---

  const CAP_HOST: Host = { ...HOST, host_max_cpus: 8, host_max_memory_mb: 16384 };

  it("readHostCaps reads caps and tolerates absent/null/zero (old API)", () => {
    expect(readHostCaps(CAP_HOST)).toEqual({
      maxCpus: 8,
      maxMemoryMb: 16384,
      maxRamGb: 16,
    });
    // Old API omits the fields entirely -> everything unknown.
    expect(readHostCaps(HOST)).toEqual({ maxCpus: null, maxMemoryMb: null, maxRamGb: null });
    // Explicit null / non-positive (offline / not advertised) also -> unknown.
    expect(
      readHostCaps({ ...HOST, host_max_cpus: null, host_max_memory_mb: 0 }),
    ).toEqual({ maxCpus: null, maxMemoryMb: null, maxRamGb: null });
  });

  it("prefills a new offer's vCPU/RAM with the host's real caps", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue([]); // start empty so only the new row exists
    render(<HostImagesEditor host={CAP_HOST} onSaved={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /add image/i }));
    // Concrete numbers seeded from the caps — never a blank "host default".
    expect(screen.getByLabelText("vcpus for image")).toHaveValue(8);
    expect(screen.getByLabelText("ram gb for image")).toHaveValue(16); // 16384 MB
  });

  it("blocks an over-cap vCPU value with the cap in the message", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={CAP_HOST} onSaved={() => {}} />);

    const cpus = await screen.findByLabelText("vcpus for ubuntu-22.04");
    await user.clear(cpus);
    await user.type(cpus, "16"); // above the host cap of 8

    expect(screen.getByText("Max 8 (host cap)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("blocks an over-cap RAM value with the cap in the message", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={CAP_HOST} onSaved={() => {}} />);

    const ram = await screen.findByLabelText("ram gb for ubuntu-22.04");
    await user.clear(ram);
    await user.type(ram, "64"); // 64 GB > 16 GB host cap

    expect(screen.getByText("Max 16 GB (host cap)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("shows the GB→MB conversion inline for a RAM value", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);

    const ram = await screen.findByLabelText("ram gb for ubuntu-22.04");
    await user.clear(ram);
    await user.type(ram, "2");
    // GB stays the input unit, but the exact MB is spelled out so it can't drift.
    expect(screen.getByText(/2 GB = 2048 MB/)).toBeInTheDocument();
  });

  it("degrades to unbounded inputs with a warning when caps are unknown (offline)", async () => {
    const user = userEvent.setup();
    getHostImages.mockResolvedValue(IMAGES);
    const offlineHost: Host = { ...HOST, online: false }; // no caps reported
    render(<HostImagesEditor host={offlineHost} onSaved={() => {}} />);
    await screen.findByDisplayValue("ubuntu-22.04");

    expect(screen.getByText(/per-lease capacity/i)).toBeInTheDocument();

    // Unbounded: a large value is accepted (no cap error), so the save isn't
    // blocked by a bound the offline host can't report.
    const cpus = screen.getByLabelText("vcpus for ubuntu-22.04");
    await user.clear(cpus);
    await user.type(cpus, "4096");
    expect(screen.queryByText(/host cap/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled();
  });

  it("maps a validation_error's field + max to the offending row on save", async () => {
    const user = userEvent.setup();
    const { WisperError } = await import("@/lib/wisper/client");
    getHostImages.mockResolvedValue(IMAGES);
    updateHostImages.mockRejectedValue(
      new WisperError(400, "validation_error", "invalid images", "req-1", [
        { index: 0, field: "memory_mb", max: 16384 },
      ]),
    );
    render(<HostImagesEditor host={CAP_HOST} onSaved={() => {}} />);
    await screen.findByDisplayValue("ubuntu-22.04");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    // The rejection detail is surfaced verbatim (field + max), on the row itself.
    expect(await screen.findByText(/memory_mb: max 16384/)).toBeInTheDocument();
  });

  it("keeps every field visible on a narrow row (fields wrap, not compress)", async () => {
    getHostImages.mockResolvedValue([{ ...IMAGES[0], cpus: 4, memory_mb: 8192 }]);
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);

    const rowEl = await screen.findByTestId("offer-row");
    // Each field is its own wrapper so the row wraps to new lines at narrow widths
    // instead of squeezing values out of view.
    const fields = within(rowEl).getAllByTestId("offer-field");
    expect(fields.length).toBeGreaterThanOrEqual(7);

    // The values themselves remain rendered (visible), not clipped away.
    expect(screen.getByLabelText("image name")).toHaveValue("ubuntu-22.04");
    expect(screen.getByLabelText("price for ubuntu-22.04")).toHaveValue(3);
    expect(screen.getByLabelText("vcpus for ubuntu-22.04")).toHaveValue(4);
    expect(screen.getByLabelText("ram gb for ubuntu-22.04")).toHaveValue(8);
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
