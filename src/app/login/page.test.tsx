import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setAuthToken } from "@/lib/wisper/client";
import { AuthProvider } from "@/lib/auth/AuthContext";
import LoginPage from "./page";

// Cognito is mocked as UNCONFIGURED so the login page offers the API-key form.
vi.mock("@/lib/auth/cognito", () => ({
  isAuthConfigured: () => false,
  currentSession: vi.fn(async () => null),
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendConfirmationCode: vi.fn(),
  signOut: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const API_KEY_STORAGE = "wisper.web.apiKey";

function meResponse(roles: string[]) {
  return new Response(JSON.stringify({ id: "u1", email: "a@b.c", roles }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: { code: "unauthorized", message: "nope" } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

describe("LoginPage (Cognito unconfigured)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => meResponse(["consumer"])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setAuthToken(null);
    localStorage.clear();
  });

  it("renders the API-key sign-in form instead of email/password", async () => {
    renderLogin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in with api key/i })).toBeInTheDocument(),
    );
    const input = screen.getByLabelText(/api key/i);
    expect(input).toHaveAttribute("type", "password");
    // No Cognito email/password tabs when unconfigured.
    expect(screen.queryByRole("tab", { name: /sign up/i })).not.toBeInTheDocument();
  });

  it("stores, validates, and authenticates on a good key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => meResponse(["consumer", "host"]));
    vi.stubGlobal("fetch", fetchMock);
    renderLogin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in with api key/i })).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText(/api key/i), "wck_live_good");
    await user.click(screen.getByRole("button", { name: /sign in with api key/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem(API_KEY_STORAGE)).toBe("wck_live_good");
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer wck_live_good");
  });

  it("clears the key and shows an error on a 401", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => unauthorizedResponse()));
    renderLogin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in with api key/i })).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText(/api key/i), "wck_live_bad");
    await user.click(screen.getByRole("button", { name: /sign in with api key/i }));

    await waitFor(() =>
      expect(screen.getByText(/invalid or revoked api key/i)).toBeInTheDocument(),
    );
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
