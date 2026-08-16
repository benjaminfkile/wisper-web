import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApiKeys from "./ApiKeys";
import type { ApiKey, CreateApiKeyResponse } from "@/lib/wisper/types";

// Controllable auth: tests flip whether the session is API-key-based.
const authState: { isApiKeySession: boolean } = { isApiKeySession: false };
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ isApiKeySession: authState.isApiKeySession }),
}));

vi.mock("@/lib/wisper/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wisper/client")>();
  return {
    ...actual,
    wisper: {
      ...actual.wisper,
      listApiKeys: vi.fn(),
      createApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
    },
  };
});

import { wisper } from "@/lib/wisper/client";

const listApiKeys = wisper.listApiKeys as Mock;
const createApiKey = wisper.createApiKey as Mock;
const revokeApiKey = wisper.revokeApiKey as Mock;

const ACTIVE_KEY: ApiKey = {
  id: "key-1",
  name: "ci-runner",
  token_prefix: "wck_live_abcd",
  scopes: ["consumer", "host"],
  created_at: "2026-07-01T00:00:00Z",
  last_used_at: "2026-07-10T00:00:00Z",
};

const REVOKED_KEY: ApiKey = {
  id: "key-2",
  name: "old-bot",
  token_prefix: "wck_live_ef01",
  scopes: ["consumer"],
  created_at: "2026-06-01T00:00:00Z",
  revoked_at: "2026-06-20T00:00:00Z",
};

const FULL_TOKEN = "wck_live_" + "a".repeat(64);
const CREATED: CreateApiKeyResponse = {
  id: "key-3",
  name: "new-key",
  key: FULL_TOKEN,
  token_prefix: "wck_live_aaaa",
  scopes: ["consumer"],
  created_at: "2026-07-20T00:00:00Z",
};

beforeEach(() => {
  authState.isApiKeySession = false;
  listApiKeys.mockResolvedValue([ACTIVE_KEY, REVOKED_KEY]);
});

afterEach(() => vi.clearAllMocks());

describe("ApiKeys — listing", () => {
  it("renders keys with prefix, scope chips, last-used, and revoked state", async () => {
    render(<ApiKeys />);

    expect(await screen.findByText("ci-runner")).toBeInTheDocument();
    expect(screen.getByText("wck_live_abcd")).toBeInTheDocument();
    // Scope chips for the active key.
    const activeRow = screen.getByText("ci-runner").closest("tr")!;
    expect(within(activeRow).getByText("consumer")).toBeInTheDocument();
    expect(within(activeRow).getByText("host")).toBeInTheDocument();
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();

    // Revoked key stays listed with a Revoked status and no revoke action.
    const revokedRow = screen.getByText("old-bot").closest("tr")!;
    expect(within(revokedRow).getByText("Revoked")).toBeInTheDocument();
    expect(within(revokedRow).queryByLabelText(/revoke old-bot/i)).not.toBeInTheDocument();
  });

  it("shows an empty state when the account has no keys", async () => {
    listApiKeys.mockResolvedValue([]);
    render(<ApiKeys />);
    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    listApiKeys.mockRejectedValue(new Error("boom"));
    render(<ApiKeys />);
    expect(await screen.findByText(/failed to load api keys/i)).toBeInTheDocument();
  });
});

describe("ApiKeys — minting (one-time reveal)", () => {
  it("mints a key, reveals the full secret once, and hides it after the dialog closes", async () => {
    const user = userEvent.setup();
    createApiKey.mockResolvedValue(CREATED);
    render(<ApiKeys />);
    await screen.findByText("ci-runner");

    await user.click(screen.getByRole("button", { name: /create key/i }));

    // Fill the create dialog and submit.
    const createDialog = await screen.findByRole("dialog");
    await user.type(within(createDialog).getByLabelText(/name/i), "new-key");
    await user.click(within(createDialog).getByRole("button", { name: /create key/i }));

    await waitFor(() =>
      expect(createApiKey).toHaveBeenCalledWith({ name: "new-key", scopes: ["consumer"] }),
    );

    // The one-time reveal dialog shows the full secret and the warning.
    const revealDialog = await screen.findByRole("dialog");
    expect(within(revealDialog).getByText(FULL_TOKEN)).toBeInTheDocument();
    expect(within(revealDialog).getByText(/you will not see this again/i)).toBeInTheDocument();

    // Dismiss it: the full secret must never appear again (only the prefix remains).
    await user.click(within(revealDialog).getByRole("button", { name: /saved the key/i }));
    await waitFor(() => expect(screen.queryByText(FULL_TOKEN)).not.toBeInTheDocument());
    expect(screen.getByText("wck_live_aaaa")).toBeInTheDocument();
  });

  it("surfaces the backend's validation/capping error verbatim", async () => {
    const user = userEvent.setup();
    const { WisperError } = await import("@/lib/wisper/client");
    createApiKey.mockRejectedValue(new WisperError(422, "invalid_scope", "scope host not permitted"));
    render(<ApiKeys />);
    await screen.findByText("ci-runner");

    await user.click(screen.getByRole("button", { name: /create key/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/name/i), "bot");
    await user.click(within(dialog).getByRole("button", { name: /create key/i }));

    expect(await within(dialog).findByText("scope host not permitted")).toBeInTheDocument();
  });
});

describe("ApiKeys — revoke", () => {
  it("revokes a key after confirmation and leaves it listed as revoked", async () => {
    const user = userEvent.setup();
    revokeApiKey.mockResolvedValue(undefined);
    render(<ApiKeys />);
    await screen.findByText("ci-runner");

    await user.click(screen.getByLabelText(/revoke ci-runner/i));
    const confirm = await screen.findByRole("dialog");
    await user.click(within(confirm).getByRole("button", { name: /revoke key/i }));

    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledWith("key-1"));

    // The row stays listed but now reads as revoked.
    await waitFor(() => {
      const row = screen.getByText("ci-runner").closest("tr")!;
      expect(within(row).getByText("Revoked")).toBeInTheDocument();
    });
  });
});

describe("ApiKeys — JWT-only minting", () => {
  it("disables Create and explains why for an API-key session", async () => {
    authState.isApiKeySession = true;
    render(<ApiKeys />);
    await screen.findByText("ci-runner");

    expect(screen.getByRole("button", { name: /create key/i })).toBeDisabled();
    expect(screen.getByText(/a key cannot mint keys/i)).toBeInTheDocument();
  });
});
