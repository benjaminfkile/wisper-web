import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostImagesEditor from "./HostImagesEditor";
import type { Host } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: { ...actual.wisper, updateHostImages: vi.fn() },
  };
});

import { wisper } from "@/lib/wisper/client";

const updateHostImages = wisper.updateHostImages as Mock;

const HOST: Host = {
  id: "host-1",
  name: "workstation",
  images: [
    { id: "img-1", name: "ubuntu-22.04", price_micro_usd_per_second: 278, enabled: true },
  ],
};

describe("HostImagesEditor", () => {
  afterEach(() => vi.clearAllMocks());

  it("seeds rows from the host's images with a $/hr price", () => {
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);
    expect(screen.getByDisplayValue("ubuntu-22.04")).toBeInTheDocument();
    // 278 micro-USD/sec ≈ $1.0008/hr, rounded to 4 places by the editor.
    expect(screen.getByLabelText("price for ubuntu-22.04")).toHaveValue(1.0008);
  });

  it("saves the full image list converted back to per-second micro-USD", async () => {
    const user = userEvent.setup();
    updateHostImages.mockResolvedValue({ ...HOST });
    const onSaved = vi.fn();
    render(<HostImagesEditor host={HOST} onSaved={onSaved} />);

    const price = screen.getByLabelText("price for ubuntu-22.04");
    await user.clear(price);
    await user.type(price, "2");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateHostImages).toHaveBeenCalledTimes(1));
    const [id, body] = updateHostImages.mock.calls[0];
    expect(id).toBe("host-1");
    expect(body.images[0]).toMatchObject({
      id: "img-1",
      name: "ubuntu-22.04",
      enabled: true,
      price_micro_usd_per_second: 556, // $2.00/hr
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("adds and removes image rows", async () => {
    const user = userEvent.setup();
    updateHostImages.mockResolvedValue({ ...HOST });
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);

    await user.click(screen.getByRole("button", { name: /add image/i }));
    const names = screen.getAllByLabelText("image name");
    expect(names).toHaveLength(2);

    // New empty row makes the form invalid -> save disabled.
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /remove ubuntu-22.04/i }));
    expect(screen.getAllByLabelText("image name")).toHaveLength(1);
  });

  it("surfaces a save error", async () => {
    const user = userEvent.setup();
    const { WisperError } = await import("@/lib/wisper/client");
    updateHostImages.mockRejectedValue(new WisperError(400, "invalid", "bad pricing"));
    render(<HostImagesEditor host={HOST} onSaved={() => {}} />);

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("bad pricing")).toBeInTheDocument();
  });
});
