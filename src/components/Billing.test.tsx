import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Billing from "./Billing";
import type { Billing as BillingSummary, TransactionPage } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: { ...actual.wisper, getBilling: vi.fn(), getTransactions: vi.fn() },
  };
});

// The top-up dialog pulls in Stripe.js; stub it so these tests cover only the
// non-Stripe surface (wallet + ledger) while still exercising the open action.
vi.mock("./TopUpDialog", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>topup-dialog-open</div> : null),
}));

import { wisper } from "@/lib/wisper/client";

const getBilling = wisper.getBilling as Mock;
const getTransactions = wisper.getTransactions as Mock;

const SUMMARY: BillingSummary = {
  balance_cents: 1250,
  currency: "USD",
  usage: { spent_cents: 300, topped_up_cents: 1550 },
};

const PAGE1: TransactionPage = {
  transactions: [
    {
      id: "t1",
      amount_cents: 1000,
      type: "topup",
      description: "Card top-up",
      created_at: "2026-07-12T00:00:00.000Z",
    },
    {
      id: "t2",
      amount_cents: -150,
      type: "lease",
      description: "ubuntu-22.04 lease",
      created_at: "2026-07-11T00:00:00.000Z",
    },
  ],
  next_cursor: "cursor-2",
};

const PAGE2: TransactionPage = {
  transactions: [
    {
      id: "t3",
      amount_cents: -50,
      type: "lease",
      created_at: "2026-07-10T00:00:00.000Z",
    },
  ],
};

describe("Billing", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the wallet balance and usage summary", async () => {
    getBilling.mockResolvedValue(SUMMARY);
    getTransactions.mockResolvedValue({ transactions: [] });
    render(<Billing />);

    expect(await screen.findByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText(/Wallet balance \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText("$3.00")).toBeInTheDocument(); // spent
    expect(screen.getByText("$15.50")).toBeInTheDocument(); // topped up
  });

  it("renders the ledger with signed, colored amounts", async () => {
    getBilling.mockResolvedValue(SUMMARY);
    getTransactions.mockResolvedValue(PAGE1);
    render(<Billing />);

    expect(await screen.findByText("Card top-up")).toBeInTheDocument();
    expect(screen.getByText("+$10.00")).toBeInTheDocument();
    expect(screen.getByText("−$1.50")).toBeInTheDocument();
    expect(screen.getByText("ubuntu-22.04 lease")).toBeInTheDocument();
  });

  it("requests the first page with the configured page size", async () => {
    getBilling.mockResolvedValue(SUMMARY);
    getTransactions.mockResolvedValue({ transactions: [] });
    render(<Billing pageSize={5} />);

    await waitFor(() => expect(getTransactions).toHaveBeenCalledWith({ limit: 5 }));
  });

  it("shows an empty state when there are no transactions", async () => {
    getBilling.mockResolvedValue(SUMMARY);
    getTransactions.mockResolvedValue({ transactions: [] });
    render(<Billing />);
    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
  });

  it("paginates with the next cursor on Load more", async () => {
    const user = userEvent.setup();
    getBilling.mockResolvedValue(SUMMARY);
    getTransactions.mockResolvedValueOnce(PAGE1).mockResolvedValueOnce(PAGE2);
    render(<Billing pageSize={2} />);

    await screen.findByText("Card top-up");
    await user.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(getTransactions).toHaveBeenLastCalledWith({ limit: 2, cursor: "cursor-2" }),
    );
    // Appended, not replaced.
    expect(screen.getByText("Card top-up")).toBeInTheDocument();
    expect(screen.getByText("−$0.50")).toBeInTheDocument();
    // No further cursor -> button gone.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("surfaces a wallet load error", async () => {
    const { WisperError } = await import("@/lib/wisper/client");
    getBilling.mockRejectedValue(new WisperError(402, "insufficient_funds", "wallet unavailable"));
    getTransactions.mockResolvedValue({ transactions: [] });
    render(<Billing />);
    expect(await screen.findByText("wallet unavailable")).toBeInTheDocument();
  });

  it("opens the top-up dialog from Add funds", async () => {
    const user = userEvent.setup();
    getBilling.mockResolvedValue(SUMMARY);
    getTransactions.mockResolvedValue({ transactions: [] });
    render(<Billing />);

    await screen.findByText("$12.50");
    expect(screen.queryByText("topup-dialog-open")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add funds/i }));
    expect(screen.getByText("topup-dialog-open")).toBeInTheDocument();
  });

  it("hides Load more when there is no next cursor", async () => {
    getBilling.mockResolvedValue(SUMMARY);
    getTransactions.mockResolvedValue(PAGE2);
    render(<Billing />);
    await screen.findByText("−$0.50");
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});
