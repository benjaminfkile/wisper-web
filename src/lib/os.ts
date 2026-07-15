import type { HostOs } from "./wisper/types";

// Presentation-only helpers for surfacing a host/lease container's OS. Every entry
// tolerates an unknown OS (`undefined`, from an older API) with an OS-neutral
// fallback. Kept as small pure functions so components stay declarative and the
// per-OS strings can be asserted directly in tests.

/** Human-facing label for an OS chip/badge (e.g. "Windows"). */
export function osLabel(os: HostOs): string {
  return os === "windows" ? "Windows" : "Linux";
}

/** Userdata placeholder + helper text for the create-lease dialog, by host OS. */
export function userdataHint(os: HostOs | undefined): { placeholder: string; helper: string } {
  switch (os) {
    case "linux":
      return {
        placeholder: "#!/bin/sh — cloud-init / startup script",
        helper: "Runs at startup on this Linux host (e.g. a shell / cloud-init script).",
      };
    case "windows":
      return {
        placeholder: "e.g. powershell -Command \"Write-Host hello\" — cmd / PowerShell startup",
        helper: "Runs at startup on this Windows host (cmd or PowerShell commands).",
      };
    default:
      return {
        placeholder: "Startup script — #!/bin/sh (Linux) or cmd / PowerShell (Windows)",
        helper: "Runs at startup; use a shell script on Linux or cmd / PowerShell on Windows.",
      };
  }
}

/** Command-field placeholder for lease exec, by lease OS. */
export function execCommandPlaceholder(os: HostOs | undefined): string {
  return os === "windows" ? "e.g. cmd /c ver" : 'e.g. sh -c "echo hello"';
}
