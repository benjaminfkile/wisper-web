// Streamed exec over `POST /v1/leases/:id/exec?stream=1`. The response is an SSE
// stream read with `fetch` + a `ReadableStream` reader (NOT the browser
// `EventSource`, which cannot attach the bearer token or send the command body).
// Raw SSE frames are decoded by `SseParser`, then interpreted here into a small,
// UI-friendly event union that distinguishes stdout / stderr and carries the
// final exit code.

import { apiUrl, authHeaders, WisperError } from "./client";
import { SseParser, type SseMessage } from "./sse";
import type { ErrorEnvelope, ExecRequest } from "./types";

/**
 * Split a command line into an argv array for {@link ExecRequest.command},
 * honoring single/double quotes so `sh -c "echo hi"` yields three tokens. This is
 * a light shell-like tokenizer, not a full parser (no escapes or variable
 * expansion) — enough for the console's ad-hoc command entry.
 */
export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

/** A decoded event from a streamed exec. */
export type ExecStreamEvent =
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "exit"; code: number }
  | { kind: "error"; message: string };

/** Attempt to JSON-parse a `data:` payload; returns `undefined` if it isn't JSON. */
function tryParseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/** Coerce a payload to output text: a JSON string, a `{data|text}` field, or raw. */
function asText(json: unknown, raw: string): string {
  if (typeof json === "string") return json;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.data === "string") return obj.data;
    if (typeof obj.text === "string") return obj.text;
  }
  return raw;
}

/** Coerce a payload to an exit code, tolerating `{exit_code|code}` or a bare number. */
function asExitCode(json: unknown, raw: string): number {
  if (typeof json === "number") return json;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.exit_code === "number") return obj.exit_code;
    if (typeof obj.code === "number") return obj.code;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Coerce a payload to an error message. */
function asMessage(json: unknown, raw: string): string {
  if (typeof json === "string") return json;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
  }
  return raw || "exec failed";
}

/**
 * Map one SSE frame to an exec event. The wire uses named events
 * (`stdout` / `stderr` / `exit` / `error`), but we also infer from the JSON shape
 * when the event name is absent, so the parser is resilient to the exact framing
 * the API chooses.
 */
export function interpretExecMessage(msg: SseMessage): ExecStreamEvent | null {
  const { event, data } = msg;
  const json = tryParseJson(data);

  switch (event) {
    case "stdout":
      return { kind: "stdout", text: asText(json, data) };
    case "stderr":
      return { kind: "stderr", text: asText(json, data) };
    case "exit":
    case "done":
    case "end":
      return { kind: "exit", code: asExitCode(json, data) };
    case "error":
      return { kind: "error", message: asMessage(json, data) };
    default:
      break;
  }

  // No (or unknown) event name — infer from the JSON payload's shape.
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.exit_code === "number") return { kind: "exit", code: obj.exit_code };
    if (typeof obj.stderr === "string") return { kind: "stderr", text: obj.stderr };
    if (typeof obj.stdout === "string") return { kind: "stdout", text: obj.stdout };
    if (typeof obj.error === "string") return { kind: "error", message: obj.error };
    if (typeof obj.stream === "string" && typeof obj.data === "string") {
      return obj.stream === "stderr"
        ? { kind: "stderr", text: obj.data }
        : { kind: "stdout", text: obj.data };
    }
  }

  // Bare text frame — treat as stdout.
  if (data) return { kind: "stdout", text: typeof json === "string" ? json : data };
  return null;
}

/** Options for {@link execStream}. */
export interface ExecStreamOptions {
  /** Called for each decoded event as it arrives. */
  onEvent: (event: ExecStreamEvent) => void;
  /** Abort signal to cancel the in-flight stream (e.g. component unmount). */
  signal?: AbortSignal;
}

/**
 * Run a streamed exec against a lease, invoking `onEvent` for each stdout/stderr
 * chunk and the final exit code. Throws `WisperError` on a non-2xx response so
 * callers surface it like any other API failure. Resolves when the stream ends.
 */
export async function execStream(
  leaseId: string,
  input: ExecRequest,
  { onEvent, signal }: ExecStreamOptions,
): Promise<void> {
  const res = await fetch(apiUrl(`/v1/leases/${encodeURIComponent(leaseId)}/exec?stream=1`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "text/event-stream" }),
    body: JSON.stringify(input),
    signal,
  });

  if (!res.ok) {
    let code = "internal";
    let message = res.statusText || "exec failed";
    let requestId: string | undefined;
    let details: unknown;
    try {
      const parsed = (await res.json()) as Partial<ErrorEnvelope>;
      if (parsed.error) {
        code = parsed.error.code ?? code;
        message = parsed.error.message ?? message;
        requestId = parsed.error.request_id;
        details = parsed.error.details;
      }
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new WisperError(res.status, code, message, requestId, details);
  }

  if (!res.body) {
    throw new WisperError(res.status, "internal", "exec stream had no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  const emit = (msg: SseMessage) => {
    const decoded = interpretExecMessage(msg);
    if (decoded) onEvent(decoded);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const msg of parser.push(text)) emit(msg);
    }
    // Flush a trailing frame that wasn't blank-line terminated.
    for (const msg of parser.flush()) emit(msg);
  } finally {
    reader.releaseLock();
  }
}
