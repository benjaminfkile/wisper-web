// A minimal, incremental Server-Sent Events parser. The streamed exec endpoint
// (`POST /v1/leases/:id/exec?stream=1`) is consumed with `fetch` + a
// `ReadableStream` reader rather than the browser `EventSource` (which can't
// send an `Authorization` header or a POST body), so we parse the SSE wire
// format ourselves. Keeping the parser pure and byte-boundary tolerant lets it
// be unit-tested by feeding arbitrary chunk splits.

/** A single decoded SSE message: its `event:` name and joined `data:` payload. */
export interface SseMessage {
  /** The `event:` field, defaulting to `"message"` per the SSE spec. */
  event: string;
  /** The `data:` field(s), joined with newlines. */
  data: string;
}

/** Parse one complete SSE block (the text between blank-line boundaries). */
function parseBlock(block: string): SseMessage | null {
  let event = "message";
  const data: string[] = [];
  let sawData = false;

  for (const line of block.split("\n")) {
    // Blank lines and comments (`:` prefix) carry no fields.
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    // A single leading space after the colon is stripped per the spec.
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
      sawData = true;
    }
  }

  if (!sawData && event === "message") return null;
  return { event, data: data.join("\n") };
}

/**
 * Incremental SSE frame decoder. Feed raw text chunks (already decoded from
 * bytes) via `push`; it returns any messages completed by that chunk and buffers
 * the trailing partial frame until the next call. Call `flush` once the stream
 * ends to emit a final frame that wasn't blank-line terminated.
 */
export class SseParser {
  private buffer = "";

  /** Feed a text chunk; returns the messages it completed (possibly none). */
  push(chunk: string): SseMessage[] {
    // Normalize CRLF / lone CR so boundary detection only deals with "\n".
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const messages: SseMessage[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const msg = parseBlock(block);
      if (msg) messages.push(msg);
      boundary = this.buffer.indexOf("\n\n");
    }
    return messages;
  }

  /** Emit any buffered final frame that lacked a trailing blank line. */
  flush(): SseMessage[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const msg = parseBlock(rest);
    return msg ? [msg] : [];
  }
}
