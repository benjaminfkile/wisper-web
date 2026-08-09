import { describe, expect, it } from "vitest";
import {
  centsPerMinToPerHour,
  formatDateTime,
  formatDuration,
  formatHms,
  formatPricePerHour,
  formatSignedUsd,
  formatUsd,
  gbToMemoryMb,
  memoryMbToGb,
  perHourToCentsPerMin,
} from "./format";

describe("format helpers", () => {
  it("formatUsd converts cents to a dollar string", () => {
    expect(formatUsd(150)).toBe("$1.50");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(25)).toBe("$0.25");
  });

  it("formatSignedUsd prefixes an explicit credit/debit sign", () => {
    expect(formatSignedUsd(200)).toBe("+$2.00");
    expect(formatSignedUsd(-150)).toBe("−$1.50");
    expect(formatSignedUsd(0)).toBe("+$0.00");
  });

  it("formatPricePerHour renders a cents-per-minute price as an hourly rate", () => {
    // 5 cents/minute -> $3.00/hr
    expect(formatPricePerHour(5)).toBe("$3.00/hr");
    expect(formatPricePerHour(0)).toBe("$0.00/hr");
  });

  it("converts between cents-per-minute and dollars-per-hour", () => {
    // $3.00/hr <-> 5 cents/minute (rounded to whole cents).
    expect(perHourToCentsPerMin(3)).toBe(5);
    expect(perHourToCentsPerMin(0)).toBe(0);
    expect(centsPerMinToPerHour(5)).toBe(3);
    // Round-trips a clean hourly price exactly.
    expect(centsPerMinToPerHour(perHourToCentsPerMin(3))).toBeCloseTo(3, 2);
  });

  it("converts between memory_mb (MB) and GB, round-tripping cleanly", () => {
    // 1 GB == 1024 MB on the wire; the UI enters/shows GB.
    expect(gbToMemoryMb(1)).toBe(1024);
    expect(gbToMemoryMb(8)).toBe(8192);
    expect(memoryMbToGb(2048)).toBe(2);
    // Fractional GB rounds to a whole MB.
    expect(gbToMemoryMb(1.5)).toBe(1536);
    expect(memoryMbToGb(1536)).toBe(1.5);
    // Round-trips a whole-GB size exactly.
    expect(memoryMbToGb(gbToMemoryMb(4))).toBe(4);
  });

  it("formatDuration renders hours and minutes compactly", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(1800)).toBe("30m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
  });

  it("formatHms renders a zero-padded H:MM:SS clock", () => {
    expect(formatHms(3723)).toBe("1:02:03");
    expect(formatHms(63)).toBe("0:01:03");
    expect(formatHms(0)).toBe("0:00:00");
    expect(formatHms(-5)).toBe("0:00:00");
    expect(formatHms(NaN)).toBe("0:00:00");
  });

  it("formatDateTime tolerates missing and invalid input", () => {
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDateTime("2026-07-12T00:00:00.000Z")).not.toBe("—");
  });
});
