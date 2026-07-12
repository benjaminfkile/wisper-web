import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setAuthToken } from "@/lib/wisper/client";
import { AuthProvider, useAuth } from "./AuthContext";

// The Cognito wrapper is mocked so tests drive session/sign-in outcomes directly.
vi.mock("./cognito", () => ({
  isAuthConfigured: () => true,
  currentSession: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendConfirmationCode: vi.fn(),
  signOut: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

import * as cognito from "./cognito";

const currentSession = cognito.currentSession as Mock;
const signIn = cognito.signIn as Mock;
const signOut = cognito.signOut as Mock;

function meResponse(roles: string[]) {
  return new Response(JSON.stringify({ id: "u1", email: "a@b.c", roles }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function Consumer() {
  const { status, user, hasRole, signIn: doSignIn, signOut: doSignOut } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="email">{user?.email ?? ""}</div>
      <div data-testid="roles">{(user?.roles ?? []).join(",")}</div>
      <div data-testid="isHost">{String(hasRole("host"))}</div>
      <button onClick={() => void doSignIn("a@b.c", "pw")}>signin</button>
      <button onClick={() => doSignOut()}>signout</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => meResponse(["consumer"])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setAuthToken(null);
  });

  it("resolves to unauthenticated when there is no session", async () => {
    currentSession.mockResolvedValue(null);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("email").textContent).toBe("");
  });

  it("restores an existing session and hydrates the user + roles from /v1/me", async () => {
    currentSession.mockResolvedValue("jwt-existing");
    vi.stubGlobal("fetch", vi.fn(async () => meResponse(["consumer", "host"])));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("email").textContent).toBe("a@b.c");
    expect(screen.getByTestId("roles").textContent).toBe("consumer,host");
    expect(screen.getByTestId("isHost").textContent).toBe("true");
  });

  it("signs in, then signs out clearing the user", async () => {
    const user = userEvent.setup();
    currentSession.mockResolvedValue(null);
    signIn.mockResolvedValue("jwt-fresh");
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    await user.click(screen.getByText("signin"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(signIn).toHaveBeenCalledWith("a@b.c", "pw");
    expect(screen.getByTestId("email").textContent).toBe("a@b.c");

    await user.click(screen.getByText("signout"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(signOut).toHaveBeenCalled();
    expect(screen.getByTestId("email").textContent).toBe("");
  });

  it("falls back to unauthenticated when /v1/me fails after a valid token", async () => {
    currentSession.mockResolvedValue("jwt-existing");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("email").textContent).toBe("");
  });
});
