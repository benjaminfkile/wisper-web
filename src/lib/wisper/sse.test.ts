import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";

describe("SseParser", () => {
  it("parses a single event/data frame", () => {
    const p = new SseParser();
    expect(p.push("event: stdout\ndata: hello\n\n")).toEqual([{ event: "stdout", data: "hello" }]);
  });

  it("defaults the event name to 'message'", () => {
    const p = new SseParser();
    expect(p.push("data: hi\n\n")).toEqual([{ event: "message", data: "hi" }]);
  });

  it("joins multiple data lines with newlines", () => {
    const p = new SseParser();
    expect(p.push("data: a\ndata: b\n\n")).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("buffers a partial frame across chunk boundaries", () => {
    const p = new SseParser();
    expect(p.push("event: stdo")).toEqual([]);
    expect(p.push("ut\ndata: hel")).toEqual([]);
    expect(p.push("lo\n\n")).toEqual([{ event: "stdout", data: "hello" }]);
  });

  it("emits several frames from one chunk", () => {
    const p = new SseParser();
    expect(p.push("data: one\n\ndata: two\n\n")).toEqual([
      { event: "message", data: "one" },
      { event: "message", data: "two" },
    ]);
  });

  it("normalizes CRLF line endings", () => {
    const p = new SseParser();
    expect(p.push("event: stderr\r\ndata: oops\r\n\r\n")).toEqual([
      { event: "stderr", data: "oops" },
    ]);
  });

  it("ignores comment lines", () => {
    const p = new SseParser();
    expect(p.push(": keep-alive\ndata: x\n\n")).toEqual([{ event: "message", data: "x" }]);
  });

  it("strips only one leading space after the colon", () => {
    const p = new SseParser();
    expect(p.push("data:  two-spaces\n\n")).toEqual([{ event: "message", data: " two-spaces" }]);
  });

  it("flush emits a trailing frame with no blank-line terminator", () => {
    const p = new SseParser();
    expect(p.push("data: tail")).toEqual([]);
    expect(p.flush()).toEqual([{ event: "message", data: "tail" }]);
  });

  it("flush returns nothing when the buffer is empty", () => {
    const p = new SseParser();
    p.push("data: done\n\n");
    expect(p.flush()).toEqual([]);
  });
});
