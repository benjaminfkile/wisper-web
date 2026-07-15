import { describe, expect, it } from "vitest";
import { execCommandPlaceholder, osLabel, userdataHint } from "./os";

describe("osLabel", () => {
  it("maps the known OS values to human labels", () => {
    expect(osLabel("linux")).toBe("Linux");
    expect(osLabel("windows")).toBe("Windows");
  });
});

describe("userdataHint", () => {
  it("keeps the POSIX shell hint for linux", () => {
    const hint = userdataHint("linux");
    expect(hint.placeholder).toMatch(/#!\/bin\/sh/);
    expect(hint.helper).toMatch(/Linux/i);
  });

  it("suggests cmd/PowerShell for windows", () => {
    const hint = userdataHint("windows");
    expect(hint.placeholder).toMatch(/powershell|cmd/i);
    expect(hint.helper).toMatch(/cmd or PowerShell/i);
  });

  it("falls back to an OS-neutral hint mentioning both when unknown", () => {
    const hint = userdataHint(undefined);
    expect(hint.placeholder).toMatch(/Linux/i);
    expect(hint.placeholder).toMatch(/Windows/i);
    expect(hint.helper).toMatch(/Linux/i);
    expect(hint.helper).toMatch(/Windows/i);
  });
});

describe("execCommandPlaceholder", () => {
  it("uses a Windows-flavored example for windows", () => {
    expect(execCommandPlaceholder("windows")).toBe("e.g. cmd /c ver");
  });

  it("keeps the POSIX example for linux and unknown", () => {
    expect(execCommandPlaceholder("linux")).toBe('e.g. sh -c "echo hello"');
    expect(execCommandPlaceholder(undefined)).toBe('e.g. sh -c "echo hello"');
  });
});
