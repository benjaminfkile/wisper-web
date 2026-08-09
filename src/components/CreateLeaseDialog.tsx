"use client";

import { useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { wisper, WisperError } from "@/lib/wisper/client";
import { formatPricePerHour } from "@/lib/format";
import { userdataHint } from "@/lib/os";
import { isolationLabel } from "@/lib/isolation";
import { offerHasGpu } from "@/lib/gpu";
import type {
  CatalogHost,
  CreateLeaseRequest,
  IsolationLevel,
  Lease,
  LeaseResources,
  PricedImage,
  WispNetwork,
} from "@/lib/wisper/types";

interface CreateLeaseDialogProps {
  open: boolean;
  /** The host chosen from the catalog. */
  host: CatalogHost | null;
  /** The priced image chosen from that host. */
  image: PricedImage | null;
  onClose: () => void;
  /** Called with the created lease on a successful POST /v1/leases. */
  onCreated: (lease: Lease) => void;
}

const NETWORKS: { value: WispNetwork; label: string; help: string }[] = [
  { value: "none", label: "None", help: "No network access" },
  { value: "egress", label: "Egress", help: "Outbound internet only" },
  { value: "open", label: "Open", help: "Full inbound + outbound" },
];

/**
 * The networks this offer actually advertises (its priced image's `networks`),
 * in the offer's own order and filtered to modes this UI knows how to label.
 * When an offer advertises none (older API omits the list, or it comes back
 * empty), fall back to the full valid set so the picker is never empty.
 */
function offerNetworks(image: PricedImage | null): WispNetwork[] {
  const advertised = (image?.networks ?? []).filter((n) =>
    NETWORKS.some((opt) => opt.value === n),
  );
  return advertised.length > 0 ? advertised : NETWORKS.map((opt) => opt.value);
}

const TTL_UNITS: { value: number; label: string }[] = [
  { value: 60, label: "minutes" },
  { value: 3600, label: "hours" },
];

/** Parse a string field to a positive integer, or `undefined` when blank/invalid. */
function optionalPositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Dialog to launch a lease against a host+image picked from the catalog. Collects
 * network, optional resources, a TTL, and userdata, then POSTs /v1/leases. The
 * 402 `insufficient_funds` and `host_offline` failures are surfaced inline with a
 * top-up link so the user can act without losing their form.
 */
export default function CreateLeaseDialog({
  open,
  host,
  image,
  onClose,
  onCreated,
}: CreateLeaseDialogProps) {
  const [network, setNetwork] = useState<WispNetwork>("none");
  const [isolation, setIsolation] = useState<IsolationLevel | "">("");
  const [cpu, setCpu] = useState("");
  const [memoryMb, setMemoryMb] = useState("");
  const [diskMb, setDiskMb] = useState("");
  const [gpus, setGpus] = useState("0");
  const [ttlValue, setTtlValue] = useState("1");
  const [ttlUnit, setTtlUnit] = useState(3600);
  const [userdata, setUserdata] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WisperError | null>(null);

  // Whether this offer leases GPUs (older API / a CPU-only offer omits max_gpus).
  const hasGpu = offerHasGpu(image);
  // The offer's GPU ceiling — the input's max; the API is authoritative on over-ask.
  const maxGpus = image?.max_gpus ?? 0;

  // Isolation levels the selected image can be leased under (older API omits them).
  const isolationLevels = useMemo(() => image?.isolation_levels ?? [], [image]);
  // A single advertised level (e.g. shared-only) is shown read-only — nothing to pick.
  const isolationReadOnly = isolationLevels.length === 1;

  // The network modes THIS offer advertises — the only ones the picker may show.
  const networks = useMemo(() => offerNetworks(image), [image]);
  // The friendly {value,label,help} entries for the advertised modes, in offer order.
  const networkOptions = useMemo(
    () => networks.map((v) => NETWORKS.find((opt) => opt.value === v)!),
    [networks],
  );
  // Clamp the selection to an advertised mode so the value is always a rendered
  // option (guards the first render before the reset effect, and any drift).
  const selectedNetwork = networks.includes(network) ? network : networks[0];

  // Reset transient state each time the dialog is (re)opened for a selection.
  useEffect(() => {
    if (open) {
      setError(null);
      setSubmitting(false);
      setGpus("0");
      const levels = image?.isolation_levels ?? [];
      const preferred = image?.default_isolation;
      setIsolation(preferred && levels.includes(preferred) ? preferred : levels[0] ?? "");
      // Default the network to one the offer actually advertises (its first),
      // never to a mode it lacks — an over-ask is rejected by the API.
      setNetwork(offerNetworks(image)[0]);
    }
  }, [open, host, image]);

  const ttlSeconds = useMemo(() => {
    const n = Number(ttlValue);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) * ttlUnit : 0;
  }, [ttlValue, ttlUnit]);

  const price = image?.price_cents_per_min;
  const osHint = userdataHint(host?.os);

  async function handleSubmit() {
    if (!host || !image || ttlSeconds <= 0) return;
    setSubmitting(true);
    setError(null);

    const resources: LeaseResources = {};
    const cpuVal = optionalPositiveInt(cpu);
    const memVal = optionalPositiveInt(memoryMb);
    const diskVal = optionalPositiveInt(diskMb);
    if (cpuVal !== undefined) resources.cpu = cpuVal;
    if (memVal !== undefined) resources.memory_mb = memVal;
    if (diskVal !== undefined) resources.disk_mb = diskVal;
    // GPUs only when this offer bears them and a positive count is asked. The
    // ask is sent as typed — an over-ask is NOT pre-clamped; the API rejects it.
    if (hasGpu) {
      const gpuVal = optionalPositiveInt(gpus);
      if (gpuVal !== undefined) resources.gpus = gpuVal;
    }

    const body: CreateLeaseRequest = {
      host_id: host.host_id,
      host_image_id: image.host_image_id,
      network: selectedNetwork,
      ttl_seconds: ttlSeconds,
    };
    if (Object.keys(resources).length > 0) body.resources = resources;
    if (userdata.trim()) body.userdata = userdata;
    if (isolation) body.isolation = isolation;

    try {
      const lease = await wisper.createLease(body);
      onCreated(lease);
    } catch (err) {
      if (err instanceof WisperError) {
        setError(err);
      } else {
        setError(new WisperError(0, "internal", "Failed to create lease."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const insufficientFunds =
    error != null && (error.status === 402 || error.code === "insufficient_funds");
  const hostOffline = error != null && error.code === "host_offline";

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create lease</DialogTitle>
      <DialogContent dividers>
        {host && image ? (
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            <Box>
              <Typography variant="subtitle1">{image.image_ref}</Typography>
              <Typography variant="body2" color="text.secondary">
                on {host.label}
                {host.region ? ` · ${host.region}` : ""}
                {price != null ? ` · ${formatPricePerHour(price)}` : ""}
              </Typography>
            </Box>

            <TextField
              select
              label="Network"
              value={selectedNetwork}
              onChange={(e) => setNetwork(e.target.value as WispNetwork)}
              helperText={NETWORKS.find((n) => n.value === selectedNetwork)?.help}
              fullWidth
            >
              {networkOptions.map((n) => (
                <MenuItem key={n.value} value={n.value}>
                  {n.label}
                </MenuItem>
              ))}
            </TextField>

            {isolationLevels.length > 0 &&
              (isolationReadOnly ? (
                <TextField
                  label="Isolation"
                  value={isolationLabel(isolationLevels[0])}
                  slotProps={{ input: { readOnly: true } }}
                  helperText="This host offers a single isolation level."
                  fullWidth
                />
              ) : (
                <TextField
                  select
                  label="Isolation"
                  value={isolation}
                  onChange={(e) => setIsolation(e.target.value as IsolationLevel)}
                  helperText="How strongly this lease is isolated from the host."
                  fullWidth
                >
                  {isolationLevels.map((lvl) => (
                    <MenuItem key={lvl} value={lvl}>
                      {isolationLabel(lvl)}
                    </MenuItem>
                  ))}
                </TextField>
              ))}

            <Box>
              <Typography variant="overline" color="text.secondary">
                Resources (optional)
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 0.5 }}>
                <TextField
                  label="vCPUs"
                  type="number"
                  value={cpu}
                  onChange={(e) => setCpu(e.target.value)}
                  slotProps={{ htmlInput: { min: 1 } }}
                  fullWidth
                />
                <TextField
                  label="Memory (MB)"
                  type="number"
                  value={memoryMb}
                  onChange={(e) => setMemoryMb(e.target.value)}
                  slotProps={{ htmlInput: { min: 1 } }}
                  fullWidth
                />
                <TextField
                  label="Disk (MB)"
                  type="number"
                  value={diskMb}
                  onChange={(e) => setDiskMb(e.target.value)}
                  slotProps={{ htmlInput: { min: 1 } }}
                  fullWidth
                />
              </Stack>
            </Box>

            {hasGpu && (
              <TextField
                label="GPUs"
                type="number"
                value={gpus}
                onChange={(e) => setGpus(e.target.value)}
                slotProps={{ htmlInput: { min: 0, max: maxGpus, step: 1 } }}
                helperText={`Up to ${maxGpus} GPU${maxGpus === 1 ? "" : "s"} on this offer (0 = none).`}
                fullWidth
              />
            )}

            <Stack direction="row" spacing={2}>
              <TextField
                label="TTL"
                type="number"
                value={ttlValue}
                onChange={(e) => setTtlValue(e.target.value)}
                slotProps={{ htmlInput: { min: 1 } }}
                error={ttlSeconds <= 0}
                helperText={ttlSeconds <= 0 ? "Enter a positive duration" : "Auto-release after"}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                label="Unit"
                value={ttlUnit}
                onChange={(e) => setTtlUnit(Number(e.target.value))}
                sx={{ width: 140 }}
              >
                {TTL_UNITS.map((u) => (
                  <MenuItem key={u.value} value={u.value}>
                    {u.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <TextField
              label="Userdata (optional)"
              value={userdata}
              onChange={(e) => setUserdata(e.target.value)}
              placeholder={osHint.placeholder}
              helperText={osHint.helper}
              multiline
              minRows={2}
              fullWidth
            />

            {error && (
              <Alert severity={insufficientFunds ? "warning" : "error"}>
                {insufficientFunds ? (
                  <>
                    Insufficient funds to start this lease.{" "}
                    <Link component={NextLink} href="/billing">
                      Top up your wallet
                    </Link>{" "}
                    and try again.
                  </>
                ) : hostOffline ? (
                  "This host is currently offline. Try another host, or try again later."
                ) : (
                  error.message
                )}
              </Alert>
            )}
          </Stack>
        ) : (
          <Typography color="text.secondary">Select a host image from the catalog.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting || !host || !image || ttlSeconds <= 0}
        >
          {submitting ? "Creating…" : "Create lease"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
