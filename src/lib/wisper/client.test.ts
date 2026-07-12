import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthToken, getHealth, request, setAuthToken, wisper, WisperError } from "./client";

/** Build a JSON `Response` for a stubbed fetch. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub global fetch with a spy and return it for assertions. */
function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("wisper client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
  });

  it("getHealth returns true when the API reports ok", async () => {
    stubFetch(() => jsonResponse({ status: "ok" }));
    expect(await getHealth()).toBe(true);
  });

  it("getHealth returns false on a network error", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    expect(await getHealth()).toBe(false);
  });

  it("calls same-origin /wisper/* paths", async () => {
    const spy = stubFetch(() => jsonResponse({ status: "ok" }));
    await request("/healthz");
    expect(spy.mock.calls[0][0]).toBe("/wisper/healthz");
  });

  it("attaches the bearer token when set, and omits it when cleared", async () => {
    const spy = stubFetch(() => jsonResponse({ id: "u1", email: "a@b.c", roles: [] }));

    setAuthToken("jwt-123");
    expect(getAuthToken()).toBe("jwt-123");
    await wisper.me();
    const authed = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(authed.Authorization).toBe("Bearer jwt-123");

    setAuthToken(null);
    await wisper.me();
    const anon = (spy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(anon.Authorization).toBeUndefined();
  });

  it("serializes a json body with the right content-type and method", async () => {
    const spy = stubFetch(() => jsonResponse({ id: "l1", status: "pending" }));
    await wisper.createLease({
      host_id: "h1",
      host_image_id: "img1",
      network: "egress",
      ttl_seconds: 3600,
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toMatchObject({ host_id: "h1", host_image_id: "img1" });
  });

  it("parses the error envelope into a typed WisperError", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: "insufficient_funds",
            message: "wallet too low",
            request_id: "req-42",
            details: { needed: 500 },
          },
        },
        402,
      ),
    );
    await expect(wisper.getBilling()).rejects.toMatchObject({
      name: "WisperError",
      status: 402,
      code: "insufficient_funds",
      message: "wallet too low",
      requestId: "req-42",
      details: { needed: 500 },
    });
  });

  it("falls back to status text when the error body is not an envelope", async () => {
    stubFetch(() => new Response("nope", { status: 500, statusText: "Internal Server Error" }));
    await expect(wisper.me()).rejects.toMatchObject({
      status: 500,
      code: "internal",
    });
  });

  it("treats a 204 as an empty body (DELETE lease)", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(wisper.deleteLease("l1")).resolves.toBeUndefined();
  });

  it("encodes lease ids into the path", async () => {
    const spy = stubFetch(() => jsonResponse({ id: "a/b", status: "active" }));
    await wisper.getLease("a/b");
    expect(spy.mock.calls[0][0]).toBe("/wisper/v1/leases/a%2Fb");
  });

  it("WisperError carries status, code, and message", () => {
    const err = new WisperError(402, "insufficient_funds", "wallet too low");
    expect(err.status).toBe(402);
    expect(err.code).toBe("insufficient_funds");
    expect(err.message).toBe("wallet too low");
  });
});
