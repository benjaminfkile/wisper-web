import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration, formatPricePerHour, formatUsd } from "./format";

describe("format helpers", () => {
  it("formatUsd converts micro-USD to a dollar string", () => {
    expect(formatUsd(1_500_000)).toBe("$1.50");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(250_000)).toBe("$0.25");
  });

  it("formatPricePerHour renders a per-second price as an hourly rate", () => {
    // 277.77.. micro-USD/second ≈ $1.00/hr
    expect(formatPricePerHour(1_000_000 / 3600)).toBe("$1.00/hr");
    expect(formatPricePerHour(0)).toBe("$0.00/hr");
  });

  it("formatDuration renders hours and minutes compactly", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(1800)).toBe("30m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
  });

  it("formatDateTime tolerates missing and invalid input", () => {
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDateTime("2026-07-12T00:00:00.000Z")).not.toBe("—");
  });
});
