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
import type {
  CatalogHost,
  CreateLeaseRequest,
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
  const [network, setNetwork] = useState<WispNetwork>("egress");
  const [cpu, setCpu] = useState("");
  const [memoryMb, setMemoryMb] = useState("");
  const [diskMb, setDiskMb] = useState("");
  const [ttlValue, setTtlValue] = useState("1");
  const [ttlUnit, setTtlUnit] = useState(3600);
  const [userdata, setUserdata] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WisperError | null>(null);

  // Reset transient state each time the dialog is (re)opened for a selection.
  useEffect(() => {
    if (open) {
      setError(null);
      setSubmitting(false);
    }
  }, [open, host, image]);

  const ttlSeconds = useMemo(() => {
    const n = Number(ttlValue);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) * ttlUnit : 0;
  }, [ttlValue, ttlUnit]);

  const price = image?.price_micro_usd_per_second;

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

    const body: CreateLeaseRequest = {
      host_id: host.id,
      host_image_id: image.id,
      network,
      ttl_seconds: ttlSeconds,
    };
    if (Object.keys(resources).length > 0) body.resources = resources;
    if (userdata.trim()) body.userdata = userdata;

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
              <Typography variant="subtitle1">{image.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                on {host.name}
                {host.region ? ` · ${host.region}` : ""}
                {price != null ? ` · ${formatPricePerHour(price)}` : ""}
              </Typography>
            </Box>

            <TextField
              select
              label="Network"
              value={network}
              onChange={(e) => setNetwork(e.target.value as WispNetwork)}
              helperText={NETWORKS.find((n) => n.value === network)?.help}
              fullWidth
            >
              {NETWORKS.map((n) => (
                <MenuItem key={n.value} value={n.value}>
                  {n.label}
                </MenuItem>
              ))}
            </TextField>

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
              placeholder="#!/bin/sh — cloud-init / startup script"
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
