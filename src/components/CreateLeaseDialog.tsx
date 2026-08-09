"use client";

import { useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
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
import { gpuBadgeLabel, offerHasGpu } from "@/lib/gpu";
import { offerCpusLabel, offerMemoryLabel } from "@/lib/offer";
import type {
  CatalogHost,
  CreateLeaseRequest,
  IsolationLevel,
  Lease,
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

/**
 * Dialog to launch a lease against a host+image picked from the catalog. A lease
 * provisions EXACTLY the offer's size profile (shown read-only), so the form no
 * longer collects compute — it collects network, isolation, a TTL, and userdata,
 * then POSTs /v1/leases. The `insufficient_funds` (402), `at_capacity` (409, host
 * full), and `host_offline` failures each get a distinct inline message; the
 * billing one carries a top-up link so the user can act without losing their form.
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
  const [ttlValue, setTtlValue] = useState("1");
  const [ttlUnit, setTtlUnit] = useState(3600);
  const [userdata, setUserdata] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WisperError | null>(null);

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

    // A lease provisions EXACTLY the offer's fixed profile — the body carries no
    // resources/gpus (the API rejects free-form compute); the size rides on
    // `host_image_id` alone.
    const body: CreateLeaseRequest = {
      host_id: host.host_id,
      host_image_id: image.host_image_id,
      network: selectedNetwork,
      ttl_seconds: ttlSeconds,
    };
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
  // Host full — a distinct, non-billing failure kept out of the generic path so
  // it never reads as an error the user can fix by topping up.
  const atCapacity = error != null && error.code === "at_capacity";
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
                Size
              </Typography>
              <Stack
                direction="row"
                spacing={0.5}
                useFlexGap
                sx={{ mt: 0.5, flexWrap: "wrap" }}
              >
                {/* The offer's FIXED profile, read-only — a lease provisions exactly
                    this. "host default" when a dimension is left to the host. */}
                <Chip
                  size="small"
                  variant="outlined"
                  label={offerCpusLabel(image.cpus)}
                  aria-label={`vcpus ${offerCpusLabel(image.cpus)}`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={offerMemoryLabel(image.memory_mb)}
                  aria-label={`ram ${offerMemoryLabel(image.memory_mb)}`}
                />
                {offerHasGpu(image) ? (
                  <Chip
                    size="small"
                    color="secondary"
                    variant="outlined"
                    label={gpuBadgeLabel(host.gpu_classes, image.gpus)}
                    aria-label={`gpus ${gpuBadgeLabel(host.gpu_classes, image.gpus)}`}
                  />
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                This lease provisions the offer&apos;s size.
              </Typography>
            </Box>

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
              <Alert severity={insufficientFunds || atCapacity ? "warning" : "error"}>
                {insufficientFunds ? (
                  <>
                    Insufficient funds to start this lease.{" "}
                    <Link component={NextLink} href="/billing">
                      Top up your wallet
                    </Link>{" "}
                    and try again.
                  </>
                ) : atCapacity ? (
                  "This host is at capacity — try again when a lease frees up, or pick another host."
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
