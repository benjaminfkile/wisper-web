import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAuthToken,
  getHealth,
  normalizeApiKeyList,
  normalizeCatalog,
  normalizeLeaseList,
  normalizeMyHosts,
  normalizeTransactionPage,
  request,
  setAuthToken,
  shellSocketUrl,
  wisper,
  WisperError,
} from "./client";

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
    vi.unstubAllEnvs();
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

  it("normalizeTransactionPage accepts the real { data } envelope, a bare array, or legacy", () => {
    const txn = { id: "t1", amount_cents: 1, type: "topup", created_at: "" };
    // Real contract: { data, next_cursor }.
    expect(normalizeTransactionPage({ data: [txn], next_cursor: "c2" })).toEqual({
      transactions: [txn],
      next_cursor: "c2",
    });
    // Bare array (tolerated).
    expect(normalizeTransactionPage([txn])).toEqual({ transactions: [txn] });
    // Legacy { transactions } (tolerated).
    expect(normalizeTransactionPage({ transactions: [], next_cursor: "c2" })).toEqual({
      transactions: [],
      next_cursor: "c2",
    });
    expect(normalizeTransactionPage(null)).toEqual({ transactions: [] });
  });

  it("getTransactions passes limit/cursor and normalizes the real { data } envelope", async () => {
    const txn = { id: "t1", amount_cents: 5, type: "topup", created_at: "" };
    const spy = stubFetch(() => jsonResponse({ data: [txn], next_cursor: "c2" }));
    const page = await wisper.getTransactions({ limit: 20, cursor: "c1" });
    expect(spy.mock.calls[0][0]).toBe("/wisper/v1/billing/transactions?limit=20&cursor=c1");
    expect(page).toEqual({ transactions: [txn], next_cursor: "c2" });
  });

  it("getTransactions omits the query string when no params are given", async () => {
    const spy = stubFetch(() => jsonResponse({ data: [], next_cursor: "c9" }));
    const page = await wisper.getTransactions();
    expect(spy.mock.calls[0][0]).toBe("/wisper/v1/billing/transactions");
    expect(page.next_cursor).toBe("c9");
  });

  it("normalizeCatalog accepts the real { data } envelope, a bare array, or legacy { hosts }", () => {
    const host = { host_id: "h1", label: "Falcon", images: [] };
    expect(normalizeCatalog({ data: [host], next_cursor: "c1" })).toEqual({
      data: [host],
      next_cursor: "c1",
    });
    expect(normalizeCatalog([host])).toEqual({ data: [host] });
    expect(normalizeCatalog({ hosts: [host] })).toEqual({ data: [host], next_cursor: undefined });
    expect(normalizeCatalog(null)).toEqual({ data: [], next_cursor: undefined });
  });

  it("normalizeCatalog carries offers through with OR without a size profile", () => {
    // A sized offer (cpus/memory_mb/gpus) and a bare offer (older API omits them)
    // both survive normalization untouched — absent profile fields degrade
    // gracefully rather than being dropped or defaulted.
    const sized = {
      host_image_id: "i1",
      image_ref: "cuda",
      price_cents_per_min: 20,
      cpus: 8,
      memory_mb: 16384,
      gpus: 2,
    };
    const bare = { host_image_id: "i2", image_ref: "cpu", price_cents_per_min: 5 };
    const nulled = {
      host_image_id: "i3",
      image_ref: "def",
      price_cents_per_min: 5,
      cpus: null,
      memory_mb: null,
    };
    const host = { host_id: "h1", label: "Falcon", images: [sized, bare, nulled] };
    expect(normalizeCatalog({ data: [host] })).toEqual({
      data: [host],
      next_cursor: undefined,
    });
  });

  it("normalizeMyHosts unwraps { data, earnings }, a bare array, or legacy { hosts }", () => {
    const host = { id: "h1", name: "workstation" };
    const earnings = { currency: "USD", accrued_cents: 10, paid_cents: 0 };
    expect(normalizeMyHosts({ data: [host], earnings })).toEqual({
      data: [host],
      earnings,
      next_cursor: undefined,
    });
    expect(normalizeMyHosts([host])).toEqual({ data: [host] });
    expect(normalizeMyHosts({ hosts: [host] })).toEqual({
      data: [host],
      earnings: undefined,
      next_cursor: undefined,
    });
    expect(normalizeMyHosts(null)).toEqual({ data: [], earnings: undefined, next_cursor: undefined });
  });

  it("normalizeLeaseList unwraps { data } or tolerates a bare array", () => {
    const lease = { id: "l1", status: "active" } as never;
    expect(normalizeLeaseList({ data: [lease], next_cursor: "c1" })).toEqual([lease]);
    expect(normalizeLeaseList([lease])).toEqual([lease]);
    expect(normalizeLeaseList(null)).toEqual([]);
  });

  it("getCatalog / myHosts / listLeases unwrap their real envelopes", async () => {
    stubFetch((url) => {
      if (url.endsWith("/v1/catalog")) {
        return jsonResponse({ data: [{ host_id: "h1", label: "Falcon", images: [] }], next_cursor: "c1" });
      }
      if (url.endsWith("/v1/hosts/mine")) {
        return jsonResponse({
          data: [{ id: "h1", name: "ws" }],
          earnings: { currency: "USD", accrued_cents: 42, paid_cents: 0 },
        });
      }
      return jsonResponse({ data: [{ id: "l1", status: "active" }], next_cursor: "c2" });
    });

    const catalog = await wisper.getCatalog();
    expect(catalog.data[0].host_id).toBe("h1");
    expect(catalog.next_cursor).toBe("c1");

    const mine = await wisper.myHosts();
    expect(mine.data[0].id).toBe("h1");
    expect(mine.earnings?.accrued_cents).toBe(42);

    const leases = await wisper.listLeases();
    expect(leases).toHaveLength(1);
    expect(leases[0].id).toBe("l1");
  });

  it("getCatalog forwards min_gpus/gpu_class as query params, omitting them when off", async () => {
    const spy = stubFetch(() => jsonResponse({ data: [] }));

    await wisper.getCatalog();
    expect(spy.mock.calls[0][0]).toBe("/wisper/v1/catalog");

    await wisper.getCatalog({ min_gpus: 2, gpu_class: "A100" });
    const url = new URL(spy.mock.calls[1][0] as string, "http://x");
    expect(url.pathname).toBe("/wisper/v1/catalog");
    expect(url.searchParams.get("min_gpus")).toBe("2");
    expect(url.searchParams.get("gpu_class")).toBe("A100");

    // Zero/blank filters are omitted so a zero-GPU browse hits the bare endpoint.
    await wisper.getCatalog({ min_gpus: 0, gpu_class: "" });
    expect(spy.mock.calls[2][0]).toBe("/wisper/v1/catalog");
  });

  it("normalizeApiKeyList accepts a bare array or an envelope", () => {
    const key = {
      id: "k1",
      name: "ci",
      token_prefix: "wck_live_abcd",
      scopes: ["consumer" as const],
      created_at: "",
    };
    expect(normalizeApiKeyList([key])).toEqual([key]);
    expect(normalizeApiKeyList({ data: [key] })).toEqual([key]);
    expect(normalizeApiKeyList({ api_keys: [key] })).toEqual([key]);
    expect(normalizeApiKeyList({ keys: [key] })).toEqual([key]);
    expect(normalizeApiKeyList(null)).toEqual([]);
  });

  it("listApiKeys GETs /v1/me/api-keys and normalizes the real { data } envelope", async () => {
    const key = {
      id: "k1",
      name: "ci",
      token_prefix: "wck_live_abcd",
      scopes: ["consumer"],
      created_at: "2026-07-01T00:00:00Z",
    };
    const spy = stubFetch(() => jsonResponse({ data: [key] }));
    const keys = await wisper.listApiKeys();
    expect(spy.mock.calls[0][0]).toBe("/wisper/v1/me/api-keys");
    expect(keys).toEqual([key]);
  });

  it("createApiKey POSTs name + scopes and returns the full token once", async () => {
    const body = {
      key: { id: "k2", name: "bot", token_prefix: "wck_live_ef01", scopes: ["consumer"], created_at: "" },
      token: "wck_live_" + "a".repeat(64),
    };
    const spy = stubFetch(() => jsonResponse(body));
    const result = await wisper.createApiKey({ name: "bot", scopes: ["consumer"] });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(spy.mock.calls[0][0]).toBe("/wisper/v1/me/api-keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "bot", scopes: ["consumer"] });
    expect(result.token).toBe(body.token);
  });

  it("revokeApiKey DELETEs /v1/me/api-keys/:id (encoded)", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await expect(wisper.revokeApiKey("k/2")).resolves.toBeUndefined();
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(spy.mock.calls[0][0]).toBe("/wisper/v1/me/api-keys/k%2F2");
    expect(init.method).toBe("DELETE");
  });

  it("surfaces the backend 403 when a key session tries to mint (JWT-only)", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: "forbidden", message: "API keys cannot mint API keys", request_id: "r1" } },
        403,
      ),
    );
    await expect(wisper.createApiKey({ name: "x" })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "API keys cannot mint API keys",
    });
  });

  it("WisperError carries status, code, and message", () => {
    const err = new WisperError(402, "insufficient_funds", "wallet too low");
    expect(err.status).toBe(402);
    expect(err.code).toBe("insufficient_funds");
    expect(err.message).toBe("wallet too low");
  });

  describe("shellSocketUrl", () => {
    it("uses the API origin (wss, path prefix, ticket) when NEXT_PUBLIC_WISPER_API_ORIGIN is set", () => {
      vi.stubEnv("NEXT_PUBLIC_WISPER_API_ORIGIN", "https://api.example.com/wisper");
      expect(shellSocketUrl("lease 1", "tk/t?a")).toBe(
        "wss://api.example.com/wisper/v1/leases/lease%201/shell?ticket=tk%2Ft%3Fa",
      );
    });

    it("maps an http origin to a ws:// URL and trims a trailing slash", () => {
      vi.stubEnv("NEXT_PUBLIC_WISPER_API_ORIGIN", "http://127.0.0.1:8090/wisper/");
      expect(shellSocketUrl("l1", "t1")).toBe(
        "ws://127.0.0.1:8090/wisper/v1/leases/l1/shell?ticket=t1",
      );
    });

    it("falls back to the same-origin /wisper URL when the env is unset", () => {
      vi.stubEnv("NEXT_PUBLIC_WISPER_API_ORIGIN", "");
      // jsdom serves the tests over http://localhost:3000 -> ws.
      expect(shellSocketUrl("l1", "t1")).toBe(
        `ws://${window.location.host}/wisper/v1/leases/l1/shell?ticket=t1`,
      );
    });
  });
});
