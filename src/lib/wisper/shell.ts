// Browser shell transport for a lease. Auth is a one-time ticket: POST
// `/v1/leases/:id/shell-ticket` to mint a ticket, then open the WebSocket at
// `/v1/leases/:id/shell?ticket=` (a browser WS can't send an `Authorization`
// header, hence the ticket). Terminal bytes flow as binary frames in both
// directions; a JSON `{t:"resize",cols,rows}` control frame is sent on fit /
// resize. The transport is dependency-injected (ticket minting, URL building,
// socket construction) so the WS bridge can be unit-tested with a fake socket.

import { shellSocketUrl, wisper } from "./client";

/** Connection lifecycle surfaced to the console UI. */
export type ShellStatus = "idle" | "connecting" | "open" | "closed" | "error";

/** Options for {@link ShellSocket}, with test-friendly injection seams. */
export interface ShellSocketOptions {
  leaseId: string;
  /** Terminal output bytes received from the server. */
  onData: (bytes: Uint8Array) => void;
  /** Status transitions, with an optional human-readable detail. */
  onStatus: (status: ShellStatus, detail?: string) => void;
  /** Mint a shell ticket (defaults to the real API call). */
  mintTicket?: (leaseId: string) => Promise<string>;
  /** Build the WS URL from a lease id + ticket (defaults to `shellSocketUrl`). */
  makeUrl?: (leaseId: string, ticket: string) => string;
  /** Construct the socket (defaults to `new WebSocket`); overridable in tests. */
  createSocket?: (url: string) => WebSocket;
}

/** Normalize a WS message payload to bytes for the terminal. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array();
}

/**
 * A single shell WebSocket session over the ticket handshake. Create one,
 * `connect()`, feed keystrokes with `send`, report terminal size with `resize`,
 * and `close()` when done. Reconnecting is a fresh `connect()` (a new ticket) on
 * the same instance.
 */
export class ShellSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private everOpened = false;

  private readonly leaseId: string;
  private readonly onData: (bytes: Uint8Array) => void;
  private readonly onStatus: (status: ShellStatus, detail?: string) => void;
  private readonly mintTicket: (leaseId: string) => Promise<string>;
  private readonly makeUrl: (leaseId: string, ticket: string) => string;
  private readonly createSocket: (url: string) => WebSocket;

  constructor(opts: ShellSocketOptions) {
    this.leaseId = opts.leaseId;
    this.onData = opts.onData;
    this.onStatus = opts.onStatus;
    this.mintTicket = opts.mintTicket ?? ((id) => wisper.shellTicket(id).then((t) => t.ticket));
    this.makeUrl = opts.makeUrl ?? shellSocketUrl;
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url));
  }

  /** Whether the socket is currently open. */
  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Mint a ticket and open the WebSocket. Any prior socket is torn down first.
   * Rejects (and reports `error`) if ticket minting or the handshake fails.
   */
  async connect(): Promise<void> {
    this.teardown();
    this.closedByUser = false;
    this.onStatus("connecting");

    let ticket: string;
    try {
      ticket = await this.mintTicket(this.leaseId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to mint shell ticket";
      this.onStatus("error", message);
      throw err;
    }

    // A `close()` that landed while the ticket was in flight wins.
    if (this.closedByUser) return;

    this.everOpened = false;
    const url = this.makeUrl(this.leaseId, ticket);
    const ws = this.createSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.everOpened = true;
      this.onStatus("open");
    };
    ws.onmessage = (ev: MessageEvent) => this.onData(toBytes(ev.data));
    ws.onerror = () => {
      if (this.closedByUser) return;
      // A WS `error` before ever opening means the UPGRADE HANDSHAKE failed
      // (wrong URL, 400/401/403, DNS, TLS) — vs a mid-session drop after open.
      // The browser hides the HTTP status, so log the URL to make a misconfig
      // (e.g. NEXT_PUBLIC_WISPER_API_ORIGIN unset on Vercel, so the WS hit the
      // same-origin rewrite that can't proxy upgrades) diagnosable.
      const detail = this.everOpened ? "connection error" : "handshake failed";
      console.error(
        `[wisper] lease shell WebSocket ${detail} (url=${url}). ` +
          "If this is a Vercel deploy, set NEXT_PUBLIC_WISPER_API_ORIGIN to the " +
          "Wisper API origin — Vercel cannot proxy WebSocket upgrades through Next rewrites.",
      );
      this.onStatus("error", detail);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws === ws) this.ws = null;
      if (this.closedByUser) return;
      // A close without ever opening is also a failed handshake; annotate it so
      // the UI/console distinguishes it from a normal server-initiated close.
      if (!this.everOpened) {
        console.error(
          `[wisper] lease shell WebSocket closed before opening (url=${url}, code=${ev.code}` +
            `${ev.reason ? `, reason=${ev.reason}` : ""}). The upgrade handshake did not complete.`,
        );
      }
      this.onStatus("closed", ev.reason || undefined);
    };
  }

  /** Send terminal input bytes to the server (no-op if not open). */
  send(bytes: Uint8Array | string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
  }

  /** Report a new terminal size via the JSON control frame (no-op if not open). */
  resize(cols: number, rows: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: "resize", cols, rows }));
  }

  /** Close the session; suppresses the `closed`/`error` status callbacks. */
  close(): void {
    this.closedByUser = true;
    this.teardown();
    this.onStatus("closed");
  }

  private teardown(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      // Already closing/closed.
    }
  }
}
