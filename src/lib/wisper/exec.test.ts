import { afterEach, describe, expect, it, vi } from "vitest";
import { setAuthToken } from "./client";
import {
  execStream,
  interpretExecMessage,
  tokenizeCommand,
  type ExecStreamEvent,
} from "./exec";

describe("tokenizeCommand", () => {
  it("splits on whitespace", () => {
    expect(tokenizeCommand("ls -la /tmp")).toEqual(["ls", "-la", "/tmp"]);
  });

  it("keeps double-quoted segments intact", () => {
    expect(tokenizeCommand('sh -c "echo hello world"')).toEqual(["sh", "-c", "echo hello world"]);
  });

  it("keeps single-quoted segments intact", () => {
    expect(tokenizeCommand("sh -c 'a b'")).toEqual(["sh", "-c", "a b"]);
  });

  it("returns an empty array for blank input", () => {
    expect(tokenizeCommand("   ")).toEqual([]);
  });
});

describe("interpretExecMessage", () => {
  it("maps a named stdout event with raw text", () => {
    expect(interpretExecMessage({ event: "stdout", data: "hi" })).toEqual({
      kind: "stdout",
      text: "hi",
    });
  });

  it("maps a named stderr event", () => {
    expect(interpretExecMessage({ event: "stderr", data: "boom" })).toEqual({
      kind: "stderr",
      text: "boom",
    });
  });

  it("unwraps a JSON-string data payload", () => {
    expect(interpretExecMessage({ event: "stdout", data: '"quoted\\n"' })).toEqual({
      kind: "stdout",
      text: "quoted\n",
    });
  });

  it("unwraps a { data } object payload", () => {
    expect(interpretExecMessage({ event: "stdout", data: '{"data":"chunk"}' })).toEqual({
      kind: "stdout",
      text: "chunk",
    });
  });

  it("maps an exit event to a numeric code", () => {
    expect(interpretExecMessage({ event: "exit", data: '{"exit_code":3}' })).toEqual({
      kind: "exit",
      code: 3,
    });
  });

  it("accepts a bare number for exit", () => {
    expect(interpretExecMessage({ event: "exit", data: "0" })).toEqual({ kind: "exit", code: 0 });
  });

  it("maps an error event", () => {
    expect(interpretExecMessage({ event: "error", data: '{"message":"nope"}' })).toEqual({
      kind: "error",
      message: "nope",
    });
  });

  it("infers exit from an unnamed JSON payload", () => {
    expect(interpretExecMessage({ event: "message", data: '{"exit_code":7}' })).toEqual({
      kind: "exit",
      code: 7,
    });
  });

  it("infers stream from a { stream, data } payload", () => {
    expect(interpretExecMessage({ event: "message", data: '{"stream":"stderr","data":"e"}' })).toEqual(
      { kind: "stderr", text: "e" },
    );
  });

  it("treats a bare text frame as stdout", () => {
    expect(interpretExecMessage({ event: "message", data: "plain" })).toEqual({
      kind: "stdout",
      text: "plain",
    });
  });
});

/** Build a streaming `Response` from SSE text, chunked at the given boundaries. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

describe("execStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
  });

  it("posts to the stream=1 endpoint with the bearer token and body", async () => {
    const spy = vi.fn(() => sseResponse(["data: {\"exit_code\":0}\n\n"]));
    vi.stubGlobal("fetch", spy);
    setAuthToken("jwt-abc");

    await execStream("lease-1", { command: ["ls"] }, { onEvent: () => {} });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/wisper/v1/leases/lease-1/exec?stream=1");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-abc");
    expect(JSON.parse(init.body as string)).toEqual({ command: ["ls"] });
  });

  it("emits ordered stdout/stderr/exit events across chunk splits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        sseResponse([
          "event: stdout\ndata: hel",
          "lo\n\nevent: stderr\ndata: warn\n\n",
          "event: exit\ndata: {\"exit_code\":2}\n\n",
        ]),
      ),
    );

    const events: ExecStreamEvent[] = [];
    await execStream("l1", { command: ["x"] }, { onEvent: (e) => events.push(e) });

    expect(events).toEqual([
      { kind: "stdout", text: "hello" },
      { kind: "stderr", text: "warn" },
      { kind: "exit", code: 2 },
    ]);
  });

  it("flushes a trailing frame without a blank-line terminator", async () => {
    vi.stubGlobal("fetch", vi.fn(() => sseResponse(["data: tail-line"])));

    const events: ExecStreamEvent[] = [];
    await execStream("l1", { command: ["x"] }, { onEvent: (e) => events.push(e) });

    expect(events).toEqual([{ kind: "stdout", text: "tail-line" }]);
  });

  it("throws a WisperError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Response(JSON.stringify({ error: { code: "not_found", message: "no lease" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      execStream("l1", { command: ["x"] }, { onEvent: () => {} }),
    ).rejects.toMatchObject({ name: "WisperError", status: 404, code: "not_found" });
  });
});
