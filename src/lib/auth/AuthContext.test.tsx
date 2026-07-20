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

const API_KEY_STORAGE = "wisper.web.apiKey";

function Consumer() {
  const {
    status,
    user,
    hasRole,
    signIn: doSignIn,
    signInWithApiKey: doSignInWithApiKey,
    signOut: doSignOut,
  } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="email">{user?.email ?? ""}</div>
      <div data-testid="roles">{(user?.roles ?? []).join(",")}</div>
      <div data-testid="isHost">{String(hasRole("host"))}</div>
      <button onClick={() => void doSignIn("a@b.c", "pw")}>signin</button>
      <button onClick={() => void doSignInWithApiKey("wck_live_key").catch(() => {})}>
        signin-apikey
      </button>
      <button onClick={() => doSignOut()}>signout</button>
    </div>
  );
}

/** Bearer token seen on the most recent fetch to /v1/me, if any. */
function lastBearer(fetchMock: Mock): string | undefined {
  for (let i = fetchMock.mock.calls.length - 1; i >= 0; i--) {
    const init = fetchMock.mock.calls[i][1] as RequestInit | undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth) return auth;
  }
  return undefined;
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
    localStorage.clear();
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

  it("restores a stored API key on mount and hydrates via /v1/me", async () => {
    currentSession.mockResolvedValue(null);
    localStorage.setItem(API_KEY_STORAGE, "wck_live_stored");
    const fetchMock = vi.fn(async () => meResponse(["consumer", "host"]));
    vi.stubGlobal("fetch", fetchMock);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("isHost").textContent).toBe("true");
    // The stored key is sent as the bearer token, exactly like a Cognito JWT.
    expect(lastBearer(fetchMock)).toBe("Bearer wck_live_stored");
    expect(localStorage.getItem(API_KEY_STORAGE)).toBe("wck_live_stored");
  });

  it("drops an invalid stored API key on mount", async () => {
    currentSession.mockResolvedValue(null);
    localStorage.setItem(API_KEY_STORAGE, "wck_live_revoked");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 })),
    );
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull();
  });

  it("lets Cognito win when both a session and a stored key exist", async () => {
    currentSession.mockResolvedValue("jwt-existing");
    localStorage.setItem(API_KEY_STORAGE, "wck_live_stored");
    const fetchMock = vi.fn(async () => meResponse(["consumer"]));
    vi.stubGlobal("fetch", fetchMock);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(lastBearer(fetchMock)).toBe("Bearer jwt-existing");
  });

  it("signs in with an API key, storing and validating it", async () => {
    const user = userEvent.setup();
    currentSession.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => meResponse(["consumer", "host"]));
    vi.stubGlobal("fetch", fetchMock);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    await user.click(screen.getByText("signin-apikey"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(localStorage.getItem(API_KEY_STORAGE)).toBe("wck_live_key");
    expect(lastBearer(fetchMock)).toBe("Bearer wck_live_key");
    expect(screen.getByTestId("isHost").textContent).toBe("true");
  });

  it("clears the key and stays unauthenticated when the API key is rejected", async () => {
    const user = userEvent.setup();
    currentSession.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 })),
    );
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    await user.click(screen.getByText("signin-apikey"));
    await waitFor(() => expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull());
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
  });

  it("clears a stored API key on sign-out", async () => {
    const user = userEvent.setup();
    currentSession.mockResolvedValue(null);
    localStorage.setItem(API_KEY_STORAGE, "wck_live_stored");
    vi.stubGlobal("fetch", vi.fn(async () => meResponse(["consumer"])));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

    await user.click(screen.getByText("signout"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull();
  });
});
