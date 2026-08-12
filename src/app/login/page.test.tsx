import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setAuthToken } from "@/lib/wisper/client";
import { AuthProvider } from "@/lib/auth/AuthContext";
import LoginPage from "./page";

// Cognito module is mocked; isAuthConfigured is togglable per-describe so we can
// exercise both the API-key fallback (unconfigured) and the email/password flow.
// The AuthError class is declared INSIDE the factory — vi.mock is hoisted, so it
// cannot close over a top-level binding.
vi.mock("@/lib/auth/cognito", () => ({
  isAuthConfigured: vi.fn(() => false),
  currentSession: vi.fn(async () => null),
  signIn: vi.fn(),
  completeNewPassword: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendConfirmationCode: vi.fn(),
  signOut: vi.fn(),
  AuthError: class AuthError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
}));

import {
  isAuthConfigured,
  signIn as mockSignIn,
  completeNewPassword as mockCompleteNewPassword,
  signUp as mockSignUp,
  AuthError,
} from "@/lib/auth/cognito";

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
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => meResponse(["consumer", "host"]),
    );
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

describe("LoginPage (Cognito configured)", () => {
  beforeEach(() => {
    vi.mocked(isAuthConfigured).mockReturnValue(true);
    // /v1/me hydration after a successful sign-in.
    vi.stubGlobal("fetch", vi.fn(async () => meResponse(["consumer"])));
  });

  afterEach(() => {
    vi.mocked(isAuthConfigured).mockReturnValue(false);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setAuthToken(null);
    localStorage.clear();
  });

  it("walks an admin-invited account through the new-password challenge", async () => {
    const user = userEvent.setup();
    // First sign-in raises the NEW_PASSWORD_REQUIRED challenge…
    vi.mocked(mockSignIn).mockRejectedValueOnce(
      new AuthError("Set a new password to finish signing in.", "new_password_required"),
    );
    // …and setting the permanent password resolves the session JWT.
    vi.mocked(mockCompleteNewPassword).mockResolvedValueOnce("jwt-token");

    renderLogin();
    await screen.findByRole("tab", { name: /sign in/i });

    await user.type(screen.getByLabelText(/email/i), "dev1@benkile.com");
    await user.type(screen.getByLabelText(/^password/i), "TempPass1");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // The new-password step appears instead of a dead-end error.
    const newPass = await screen.findByLabelText(/new password/i);
    expect(screen.getByText(/choose a permanent password/i)).toBeInTheDocument();

    await user.type(newPass, "PermPass123");
    await user.click(screen.getByRole("button", { name: /set password and continue/i }));

    await waitFor(() =>
      expect(mockCompleteNewPassword).toHaveBeenCalledWith("dev1@benkile.com", "PermPass123"),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows an invite-only message when self sign-up is not permitted", async () => {
    const user = userEvent.setup();
    vi.mocked(mockSignUp).mockRejectedValueOnce(
      new AuthError("SignUp is not permitted for this user pool.", "NotAuthorizedException"),
    );

    renderLogin();
    await user.click(await screen.findByRole("tab", { name: /sign up/i }));

    await user.type(screen.getByLabelText(/email/i), "dev1@benkile.com");
    await user.type(screen.getByLabelText(/^password/i), "Whatever123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(screen.getByText(/invite-only/i)).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });
});
