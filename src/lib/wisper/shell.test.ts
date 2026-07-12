import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellSocket, type ShellStatus } from "./shell";

/** A minimal fake WebSocket that records sends and lets tests drive events. */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sent: Array<Uint8Array | string> = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  constructor(public url: string) {}

  send(data: Uint8Array | string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ reason: "" } as CloseEvent);
  }

  // Test helpers.
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  fireMessage(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  fireClose(reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ reason } as CloseEvent);
  }
}

// `ShellSocket` reads `WebSocket.OPEN`; jsdom has no WebSocket, so provide one.
vi.stubGlobal("WebSocket", FakeWebSocket);

interface Harness {
  socket: ShellSocket;
  ws: FakeWebSocket;
  data: Uint8Array[];
  statuses: Array<[ShellStatus, string | undefined]>;
}

async function makeConnected(overrides: { mintTicket?: () => Promise<string> } = {}): Promise<Harness> {
  let ws!: FakeWebSocket;
  const data: Uint8Array[] = [];
  const statuses: Array<[ShellStatus, string | undefined]> = [];

  const socket = new ShellSocket({
    leaseId: "lease-1",
    onData: (bytes) => data.push(bytes),
    onStatus: (s, detail) => statuses.push([s, detail]),
    mintTicket: overrides.mintTicket ?? (() => Promise.resolve("tkt-123")),
    makeUrl: (id, ticket) => `ws://test/${id}?ticket=${ticket}`,
    createSocket: (url) => {
      ws = new FakeWebSocket(url);
      return ws as unknown as WebSocket;
    },
  });

  await socket.connect();
  return { socket, ws, data, statuses };
}

describe("ShellSocket", () => {
  afterEach(() => vi.restoreAllMocks());

  it("mints a ticket, builds the URL, and sets arraybuffer binary type", async () => {
    const { ws } = await makeConnected();
    expect(ws.url).toBe("ws://test/lease-1?ticket=tkt-123");
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("reports connecting then open", async () => {
    const { ws, statuses } = await makeConnected();
    expect(statuses[0][0]).toBe("connecting");
    ws.fireOpen();
    expect(statuses.at(-1)?.[0]).toBe("open");
  });

  it("forwards binary frames to onData", async () => {
    const { ws, data } = await makeConnected();
    ws.fireOpen();
    const payload = new Uint8Array([104, 105]);
    ws.fireMessage(payload.buffer);
    expect(data).toHaveLength(1);
    expect(Array.from(data[0])).toEqual([104, 105]);
  });

  it("sends keystrokes as bytes only when open", async () => {
    const { socket, ws } = await makeConnected();
    socket.send("x"); // not open yet -> dropped
    expect(ws.sent).toHaveLength(0);
    ws.fireOpen();
    socket.send("hi");
    expect(ws.sent).toHaveLength(1);
    expect(Array.from(ws.sent[0] as Uint8Array)).toEqual([104, 105]);
  });

  it("sends a resize control frame when open", async () => {
    const { socket, ws } = await makeConnected();
    ws.fireOpen();
    socket.resize(80, 24);
    expect(ws.sent[0]).toBe(JSON.stringify({ t: "resize", cols: 80, rows: 24 }));
  });

  it("reports an error status when the ticket mint fails", async () => {
    const statuses: Array<[ShellStatus, string | undefined]> = [];
    const socket = new ShellSocket({
      leaseId: "l1",
      onData: () => {},
      onStatus: (s, d) => statuses.push([s, d]),
      mintTicket: () => Promise.reject(new Error("no ticket")),
      makeUrl: () => "ws://x",
      createSocket: () => new FakeWebSocket("ws://x") as unknown as WebSocket,
    });

    await expect(socket.connect()).rejects.toThrow("no ticket");
    expect(statuses.at(-1)).toEqual(["error", "no ticket"]);
  });

  it("reports closed on an unexpected server close", async () => {
    const { ws, statuses } = await makeConnected();
    ws.fireOpen();
    ws.fireClose("bye");
    expect(statuses.at(-1)).toEqual(["closed", "bye"]);
  });

  it("suppresses status callbacks for a user-initiated close", async () => {
    const { socket, ws, statuses } = await makeConnected();
    ws.fireOpen();
    const before = statuses.length;
    socket.close();
    // Only the explicit "closed" from close() is appended, not an error/closed from teardown.
    expect(statuses.slice(before)).toEqual([["closed", undefined]]);
  });
});
