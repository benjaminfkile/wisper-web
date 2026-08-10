"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormLabel from "@mui/material/FormLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { wisper, WisperError } from "@/lib/wisper/client";
import {
  centsPerMinToPerHour,
  gbToMemoryMb,
  memoryMbToGb,
  perHourToCentsPerMin,
} from "@/lib/format";
import { gpuOfferLabel } from "@/lib/gpu";
import type { Host, HostImage, WispNetwork } from "@/lib/wisper/types";

interface HostImagesEditorProps {
  host: Host;
  /** Called with the updated host after a successful PUT /v1/hosts/:id/images. */
  onSaved: (host: Host) => void;
}

/** The full set of valid network modes — the fallback when a host doesn't yet
 *  surface its own supported-networks capability. */
const ALL_NETWORKS: WispNetwork[] = ["none", "open", "egress"];
const DEFAULT_TTL_MINUTES = "60";
const PREFERRED_DEFAULT_NETWORKS: WispNetwork[] = ["none", "open"];

/** The networks a host operator may offer: the host's advertised capability, or
 *  the full valid set when the host record doesn't surface one. */
function hostNetworkOptions(host: Host): WispNetwork[] {
  const supported = (host.supported_networks ?? []).filter((n) => ALL_NETWORKS.includes(n));
  return supported.length > 0 ? supported : ALL_NETWORKS;
}

/** The networks a fresh/blank row offers: the preferred defaults intersected with
 *  what the host supports, falling back to everything the host supports. */
function defaultRowNetworks(hostNetworks: WispNetwork[]): WispNetwork[] {
  const preferred = hostNetworks.filter((n) => PREFERRED_DEFAULT_NETWORKS.includes(n));
  return preferred.length > 0 ? preferred : hostNetworks;
}

/** An editor row: the image plus its per-hour price, TTL, and networks as edits. */
interface Row {
  /** Stable key for React; new rows get a synthetic id. */
  key: string;
  id: string;
  name: string;
  /** Price entered by the host in dollars-per-hour (blank = free / $0). */
  pricePerHour: string;
  /** Max lease TTL, entered in minutes (converted to seconds on save). */
  ttlMinutes: string;
  /** Networks offered for this image; must be a subset the host advertises. */
  networks: WispNetwork[];
  /** vCPUs in this offer's size profile ("" = omit = host default). */
  cpus: string;
  /** RAM in this offer's size profile, entered in GB ("" = omit = host default). */
  ramGb: string;
  /** Exact GPUs in this offer's size profile, entered as text ("" / "0" = none). */
  gpus: string;
  enabled: boolean;
}

let syntheticId = 0;

/**
 * The host's REAL per-lease compute cap, read tolerantly from the host record.
 * A cap counts as "known" only when the API surfaces a concrete positive number;
 * `null`/`undefined`/`0`/non-finite (host offline, older API, or not advertised)
 * all collapse to `null`, which the editor treats as "unknown" — unbounded inputs
 * plus a warning. `maxRamGb` is `maxMemoryMb` expressed in the GB unit the editor
 * uses; keep it a rounded, human figure so the cap label reads cleanly.
 */
export interface HostCaps {
  maxCpus: number | null;
  maxMemoryMb: number | null;
  maxRamGb: number | null;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function readHostCaps(host: Host): HostCaps {
  const maxCpus = positiveOrNull(host.host_max_cpus);
  const maxMemoryMb = positiveOrNull(host.host_max_memory_mb);
  return {
    maxCpus,
    maxMemoryMb,
    maxRamGb: maxMemoryMb != null ? Number(memoryMbToGb(maxMemoryMb).toFixed(3)) : null,
  };
}

function toRow(image: HostImage, defaultNetworks: WispNetwork[]): Row {
  return {
    key: image.host_image_id ?? image.image_ref,
    id: image.host_image_id ?? "",
    name: image.image_ref,
    pricePerHour:
      image.price_cents_per_min != null
        ? String(Number(centsPerMinToPerHour(image.price_cents_per_min).toFixed(4)))
        : "",
    ttlMinutes: image.max_ttl_seconds
      ? String(Math.max(1, Math.round(image.max_ttl_seconds / 60)))
      : DEFAULT_TTL_MINUTES,
    networks: image.networks?.length ? image.networks : defaultNetworks,
    cpus: image.cpus != null ? String(image.cpus) : "",
    ramGb:
      image.memory_mb != null
        ? String(Number(memoryMbToGb(image.memory_mb).toFixed(3)))
        : "",
    gpus: String(image.gpus ?? 0),
    enabled: image.enabled ?? true,
  };
}

function positiveInt(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse a GPU count field: blank counts as 0; otherwise a non-negative int. */
function nonNegativeInt(value: string): number | null {
  if (!value.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The parse of an optional size field: `empty` (blank = omit = host default),
 * a concrete positive value, or `invalid`. Empty is a valid, distinct state —
 * it must NOT collapse to `0` on the wire (an omitted field is the host default).
 */
type OptionalSize = "empty" | "invalid" | { value: number };

/** Parse an optional whole-vCPU field: blank = host default; else a positive int. */
function parseOptionalCpus(value: string): OptionalSize {
  if (!value.trim()) return "empty";
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? { value: n } : "invalid";
}

/**
 * Parse an optional RAM field entered in GB into `memory_mb`: blank = host
 * default; else a positive GB figure converted to a whole MB (must land on a
 * positive integer MB — a sub-MB entry is rejected).
 */
function parseOptionalRamMb(value: string): OptionalSize {
  if (!value.trim()) return "empty";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "invalid";
  const mb = gbToMemoryMb(n);
  return mb >= 1 ? { value: mb } : "invalid";
}

/**
 * Render an entered RAM (GB) value with its exact MB conversion inline, e.g.
 * `"2"` -> `"2 GB = 2048 MB"`, so the GB/MB unit can't be confused silently.
 * Returns `null` for a blank/invalid value (nothing meaningful to convert).
 */
function ramConversion(value: string): string | null {
  const parsed = parseOptionalRamMb(value);
  if (parsed === "empty" || parsed === "invalid") return null;
  return `${Number(Number(value).toFixed(3))} GB = ${parsed.value} MB`;
}

/** One field's server-side validation failure (`validation_error` details entry). */
interface ApiFieldError {
  field?: string;
  max?: number;
  image_ref?: string;
  index?: number;
  message?: string;
}

/**
 * Coerce a `validation_error`'s `details` into a flat list of field errors,
 * tolerating either a single object or an array of them and ignoring anything
 * that isn't a plain object. Only the keys we surface (`field`, `max`,
 * `image_ref`, `index`, `message`) are read; unknown shapes yield an empty list.
 */
function coerceFieldErrors(details: unknown): ApiFieldError[] {
  const entries = Array.isArray(details) ? details : details != null ? [details] : [];
  const out: ApiFieldError[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    out.push({
      field: typeof o.field === "string" ? o.field : undefined,
      max: typeof o.max === "number" ? o.max : undefined,
      image_ref: typeof o.image_ref === "string" ? o.image_ref : undefined,
      index: typeof o.index === "number" ? o.index : undefined,
      message: typeof o.message === "string" ? o.message : undefined,
    });
  }
  return out;
}

/** Render one field error verbatim: its message, or `field` + `max` if given. */
function fieldErrorText(e: ApiFieldError): string {
  if (e.message) return e.message;
  const field = e.field ?? "value";
  return e.max != null ? `${field}: max ${e.max}` : field;
}

/**
 * Editable table of a host's priced images. Hosts set a per-hour price, a max
 * TTL, the offered networks, and an enabled flag per image, then save — which
 * replaces the host's image list via PUT /v1/hosts/:id/images. Because that PUT
 * replaces the whole list (and GET /v1/hosts/mine omits images), the current
 * list is loaded up front via GET /v1/hosts/:id/images so a save never wipes it.
 * Prices are shown/edited in `$ /hr` and stored as cents-per-minute.
 */
export default function HostImagesEditor({ host, onSaved }: HostImagesEditorProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Per-row messages parsed from a save's `validation_error` details, keyed by
  // Row.key so the offending row shows the rejection inline (not just a banner).
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  // The host's REAL per-lease compute cap. `null` = unknown (host offline / older
  // API / not advertised): the editor drops the bounds and warns instead.
  const caps = useMemo(() => readHostCaps(host), [host]);
  const capsUnknown = caps.maxCpus == null || caps.maxMemoryMb == null;

  // Networks this host operator may offer per image (host capability), and the
  // subset a fresh row starts with. Derived from the host record; falls back to
  // the full valid set when the host doesn't surface its capability yet. Keyed on
  // the primitive capability list so the memo stays stable across parent renders
  // (an unstable array would re-fire `load` and spin the fetch).
  const networksKey = (host.supported_networks ?? []).join("|");
  const networkOptions = useMemo(
    () => hostNetworkOptions(host),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [networksKey],
  );
  const rowDefaultNetworks = useMemo(
    () => defaultRowNetworks(networkOptions),
    [networkOptions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    setSaveErrors({});
    try {
      const images = await wisper.getHostImages(host.id);
      setRows(images.map((img) => toRow(img, rowDefaultNetworks)));
    } catch (err) {
      setError(err instanceof WisperError ? err.message : "Failed to load images.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [host.id, rowDefaultNetworks]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearSaveError(key: string) {
    setSaveErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setSaved(false);
    clearSaveError(key);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setSaved(false);
    clearSaveError(key);
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${syntheticId++}`,
        id: "",
        name: "",
        pricePerHour: "",
        ttlMinutes: DEFAULT_TTL_MINUTES,
        networks: rowDefaultNetworks,
        // Prefill a new offer with the host's REAL caps — concrete numbers a host
        // can only turn DOWN, never a blank that silently means "host default".
        // When caps are unknown, stay blank (the field is unbounded + warned).
        cpus: caps.maxCpus != null ? String(caps.maxCpus) : "",
        ramGb: caps.maxRamGb != null ? String(caps.maxRamGb) : "",
        gpus: "0",
        enabled: true,
      },
    ]);
    setSaved(false);
  }

  // GPUs the host advertises; 0 (or absent) means the field is disabled entirely.
  const gpuCapacity = host.gpu_count ?? 0;
  const gpuClasses = (host.gpu_classes ?? []).filter(Boolean);

  /** Per-row GPU error message, or null when the value is acceptable. */
  function gpuError(row: Row): string | null {
    const n = nonNegativeInt(row.gpus);
    if (n == null) return "Whole number ≥ 0";
    // The API rejects (not clamps) an over-ask, so block it before the PUT.
    if (n > gpuCapacity) return `Max ${gpuCapacity} on this host`;
    return null;
  }

  /**
   * Per-row vCPU error, or null when acceptable. Blank = host default (ok); a
   * non-positive/fractional entry is invalid; a value above the host's cap is
   * blocked with the cap in the message (the same rejection the API would give),
   * so the whole-list PUT never fails as a surprise.
   */
  function cpuError(row: Row): string | null {
    const parsed = parseOptionalCpus(row.cpus);
    if (parsed === "invalid") return "Whole number ≥ 1";
    if (parsed !== "empty" && caps.maxCpus != null && parsed.value > caps.maxCpus) {
      return `Max ${caps.maxCpus} (host cap)`;
    }
    return null;
  }

  /** Per-row RAM (GB) error, or null when blank/valid; over-cap is blocked with the cap. */
  function ramError(row: Row): string | null {
    const parsed = parseOptionalRamMb(row.ramGb);
    if (parsed === "invalid") return "Positive number";
    if (parsed !== "empty" && caps.maxMemoryMb != null && parsed.value > caps.maxMemoryMb) {
      return `Max ${caps.maxRamGb} GB (host cap)`;
    }
    return null;
  }

  const invalid = rows.some((r) => {
    if (!r.name.trim()) return true;
    if (positiveInt(r.ttlMinutes) == null) return true;
    if (r.networks.length === 0) return true;
    if (gpuError(r) != null) return true;
    if (cpuError(r) != null) return true;
    if (ramError(r) != null) return true;
    if (r.pricePerHour.trim()) {
      const n = Number(r.pricePerHour);
      if (!Number.isFinite(n) || n < 0) return true;
    }
    return false;
  });

  async function handleSave() {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    setSaveErrors({});
    // Snapshot the row order the payload is built from so a `validation_error`
    // whose details carry a positional `index` can be mapped back to a Row.key.
    const orderedRows = rows;
    const images: HostImage[] = orderedRows.map((r) => {
      const priceStr = r.pricePerHour.trim();
      const image: HostImage = {
        image_ref: r.name.trim(),
        // The API requires a price; a blank field means free ($0).
        price_cents_per_min: priceStr ? perHourToCentsPerMin(Number(priceStr)) : 0,
        // positiveInt() is guaranteed non-null here (guarded by `invalid`).
        max_ttl_seconds: (positiveInt(r.ttlMinutes) as number) * 60,
        networks: r.networks,
        // nonNegativeInt() is guaranteed non-null here (guarded by `invalid`).
        gpus: nonNegativeInt(r.gpus) as number,
        enabled: r.enabled,
      };
      if (r.id) image.host_image_id = r.id;
      // Blank vCPU/RAM = omit (host default): an empty field must not send `0`.
      // parse*() is guaranteed non-"invalid" here (guarded by `invalid`).
      const cpu = parseOptionalCpus(r.cpus);
      if (cpu !== "empty" && cpu !== "invalid") image.cpus = cpu.value;
      const ram = parseOptionalRamMb(r.ramGb);
      if (ram !== "empty" && ram !== "invalid") image.memory_mb = ram.value;
      return image;
    });
    try {
      const updated = await wisper.updateHostImages(host.id, { images });
      setSaved(true);
      onSaved(updated);
      // Reload so newly-created rows pick up their server-assigned ids/values.
      await load();
      setSaved(true);
    } catch (err) {
      if (err instanceof WisperError) {
        setError(err.message);
        // Surface `validation_error` details verbatim (field + max), mapping each
        // to the offending row by positional index or matching image_ref so the
        // rejection lands where the host can act on it.
        const fieldErrors = coerceFieldErrors(err.details);
        if (fieldErrors.length > 0) {
          const next: Record<string, string> = {};
          for (const fe of fieldErrors) {
            const row =
              (fe.index != null ? orderedRows[fe.index] : undefined) ??
              (fe.image_ref != null
                ? orderedRows.find((r) => r.name.trim() === fe.image_ref)
                : undefined);
            if (!row) continue;
            const text = fieldErrorText(fe);
            next[row.key] = next[row.key] ? `${next[row.key]}; ${text}` : text;
          }
          setSaveErrors(next);
        }
      } else {
        setError("Failed to save images.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", py: 2 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Loading images…
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {capsUnknown && (
        <Alert severity="warning">
          This host isn&rsquo;t reporting its per-lease capacity right now
          {host.online === false ? " (it looks offline)" : ""}, so vCPU and RAM
          aren&rsquo;t bounded here. Saving image changes still requires the host to
          be online.
        </Alert>
      )}

      {rows.length === 0 ? (
        <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
          No images yet. Add one to start offering it.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {rows.map((row) => {
            const cErr = cpuError(row);
            const cpuHelp =
              cErr ??
              (caps.maxCpus != null
                ? `max ${caps.maxCpus} (host cap)`
                : row.cpus.trim()
                  ? undefined
                  : "host default");

            const rErr = ramError(row);
            const ramConv = ramConversion(row.ramGb);
            const ramCap =
              caps.maxRamGb != null
                ? `max ${caps.maxRamGb} GB (host cap)`
                : row.ramGb.trim()
                  ? undefined
                  : "host default";
            const ramHelpParts = [ramConv, ramCap].filter(Boolean);
            const ramHelp = rErr ?? (ramHelpParts.length ? ramHelpParts.join(" · ") : undefined);

            const rowError = saveErrors[row.key];

            return (
              <Paper
                key={row.key}
                variant="outlined"
                data-testid="offer-row"
                sx={{ p: 1.5 }}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 2,
                    alignItems: "flex-start",
                  }}
                >
                  <Box data-testid="offer-field" sx={{ flex: "2 1 220px", minWidth: 200 }}>
                    <TextField
                      label="Image"
                      value={row.name}
                      onChange={(e) => updateRow(row.key, { name: e.target.value })}
                      placeholder="ubuntu-22.04"
                      size="small"
                      variant="standard"
                      fullWidth
                      error={!row.name.trim()}
                      slotProps={{ inputLabel: { shrink: true }, htmlInput: { "aria-label": "image name" } }}
                    />
                  </Box>
                  <Box data-testid="offer-field" sx={{ flex: "1 1 150px", minWidth: 140 }}>
                    <TextField
                      label="Price"
                      value={row.pricePerHour}
                      onChange={(e) => updateRow(row.key, { pricePerHour: e.target.value })}
                      type="number"
                      size="small"
                      variant="standard"
                      fullWidth
                      placeholder="0.00"
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { min: 0, step: 0.01, "aria-label": `price for ${row.name || "image"}` },
                        input: {
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                          endAdornment: <InputAdornment position="end">/hr</InputAdornment>,
                        },
                      }}
                    />
                  </Box>
                  <Box data-testid="offer-field" sx={{ flex: "1 1 140px", minWidth: 130 }}>
                    <TextField
                      label="Max TTL (min)"
                      value={row.ttlMinutes}
                      onChange={(e) => updateRow(row.key, { ttlMinutes: e.target.value })}
                      type="number"
                      size="small"
                      variant="standard"
                      fullWidth
                      placeholder="60"
                      error={positiveInt(row.ttlMinutes) == null}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { min: 1, step: 1, "aria-label": `max ttl minutes for ${row.name || "image"}` },
                      }}
                    />
                  </Box>
                  <Box data-testid="offer-field" sx={{ flex: "1 1 200px", minWidth: 180 }}>
                    <FormLabel sx={{ display: "block", fontSize: "0.75rem", mb: 0.5 }}>
                      Networks
                    </FormLabel>
                    <ToggleButtonGroup
                      value={row.networks}
                      onChange={(_e, next: WispNetwork[]) =>
                        updateRow(row.key, { networks: next })
                      }
                      size="small"
                      aria-label={`networks for ${row.name || "image"}`}
                    >
                      {networkOptions.map((n) => (
                        <ToggleButton key={n} value={n} sx={{ px: 1, py: 0.25, textTransform: "none" }}>
                          {n}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  </Box>
                  <Box data-testid="offer-field" sx={{ flex: "1 1 140px", minWidth: 130 }}>
                    <TextField
                      label="vCPUs"
                      value={row.cpus}
                      onChange={(e) => updateRow(row.key, { cpus: e.target.value })}
                      type="number"
                      size="small"
                      variant="standard"
                      fullWidth
                      placeholder="default"
                      error={cErr != null}
                      helperText={cpuHelp}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: {
                          min: 1,
                          step: 1,
                          ...(caps.maxCpus != null ? { max: caps.maxCpus } : {}),
                          "aria-label": `vcpus for ${row.name || "image"}`,
                        },
                      }}
                    />
                  </Box>
                  <Box data-testid="offer-field" sx={{ flex: "1 1 200px", minWidth: 190 }}>
                    <TextField
                      label="RAM (GB)"
                      value={row.ramGb}
                      onChange={(e) => updateRow(row.key, { ramGb: e.target.value })}
                      type="number"
                      size="small"
                      variant="standard"
                      fullWidth
                      placeholder="default"
                      error={rErr != null}
                      helperText={ramHelp}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: {
                          min: 0,
                          step: 0.5,
                          ...(caps.maxRamGb != null ? { max: caps.maxRamGb } : {}),
                          "aria-label": `ram gb for ${row.name || "image"}`,
                        },
                        input: {
                          endAdornment: <InputAdornment position="end">GB</InputAdornment>,
                        },
                      }}
                    />
                  </Box>
                  <Box data-testid="offer-field" sx={{ flex: "1 1 150px", minWidth: 140 }}>
                    {gpuCapacity > 0 ? (
                      <TextField
                        label="GPUs"
                        value={row.gpus}
                        onChange={(e) => updateRow(row.key, { gpus: e.target.value })}
                        type="number"
                        size="small"
                        variant="standard"
                        fullWidth
                        placeholder="0"
                        error={gpuError(row) != null}
                        helperText={
                          gpuError(row) ??
                          gpuOfferLabel(nonNegativeInt(row.gpus) ?? 0) ??
                          (gpuClasses.length ? gpuClasses.join(", ") : undefined)
                        }
                        slotProps={{
                          inputLabel: { shrink: true },
                          htmlInput: {
                            min: 0,
                            max: gpuCapacity,
                            step: 1,
                            "aria-label": `gpus for ${row.name || "image"}`,
                          },
                        }}
                      />
                    ) : (
                      <TextField
                        label="GPUs"
                        value="0"
                        disabled
                        size="small"
                        variant="standard"
                        fullWidth
                        helperText="no GPU detected on this host"
                        slotProps={{
                          inputLabel: { shrink: true },
                          htmlInput: { "aria-label": `gpus for ${row.name || "image"}` },
                        }}
                      />
                    )}
                  </Box>
                  <Box
                    data-testid="offer-field"
                    sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: "auto" }}
                  >
                    <Tooltip title={row.enabled ? "Offer enabled" : "Offer disabled"}>
                      <Switch
                        checked={row.enabled}
                        onChange={(e) => updateRow(row.key, { enabled: e.target.checked })}
                        size="small"
                        slotProps={{ input: { "aria-label": `enable ${row.name || "image"}` } }}
                      />
                    </Tooltip>
                    <Tooltip title="Remove image">
                      <IconButton
                        size="small"
                        onClick={() => removeRow(row.key)}
                        aria-label={`remove ${row.name || "image"}`}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                {rowError && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {rowError}
                  </Alert>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button startIcon={<AddIcon />} onClick={addRow} size="small">
          Add image
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {saved && (
          <Typography variant="body2" color="success.main">
            Saved
          </Typography>
        )}
        <Button onClick={() => void load()} color="inherit" disabled={saving}>
          Reset
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || invalid}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </Stack>
    </Stack>
  );
}
