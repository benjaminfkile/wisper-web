"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import NextLink from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import { wisper, WisperError } from "@/lib/wisper/client";
import LeaseConsole from "./LeaseConsole";
import LeaseExec from "./LeaseExec";
import { formatDateTime, formatHms, formatUsd } from "@/lib/format";
import { isTerminalLease, leaseStatusColor } from "@/lib/leaseStatus";
import {
  baseTtlRemainingSeconds,
  costRateMicroUsdPerSecond,
  leaseUptimeSeconds,
  liveCostMicroUsd,
  liveTtlRemainingSeconds,
} from "@/lib/leaseTiming";
import type { Lease } from "@/lib/wisper/types";

interface LeaseDetailProps {
  leaseId: string;
  /** Poll interval (ms) for re-syncing the lease. Set to 0 to disable. */
  pollMs?: number;
}

/** A snapshot captured at the moment a lease was last fetched. */
interface Sync {
  lease: Lease;
  /** Client clock (ms) when this snapshot arrived — anchors the live extrapolation. */
  syncedAtMs: number;
  /** Server TTL remaining at sync time, counted down live from here. */
  baseRemaining: number;
  /** Accrued cost at sync time, in micro-USD. */
  baseCost: number;
  /** Per-second cost rate used to tick the running total between polls. */
  rate: number;
}

function toSync(lease: Lease, nowMs: number): Sync {
  return {
    lease,
    syncedAtMs: nowMs,
    baseRemaining: baseTtlRemainingSeconds(lease, nowMs),
    baseCost: lease.cost_micro_usd ?? 0,
    rate: costRateMicroUsdPerSecond(lease, nowMs),
  };
}

/** A labelled read-only field in the overview grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body1" component="div" sx={{ wordBreak: "break-word" }}>
        {children}
      </Typography>
    </Box>
  );
}

/** A large ticking metric (uptime, TTL, cost). */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 160, flex: "1 1 160px" }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="h5" component="div" sx={{ fontVariantNumeric: "tabular-nums", mt: 0.5 }}>
        {value}
      </Typography>
    </Paper>
  );
}

/**
 * Per-lease detail (GET /v1/leases/:id): a status chip, live per-second uptime and
 * TTL countdown re-synced by polling, the running cost so far, and the
 * image/network/host facts — under a tabbed surface (Overview now, Console/Exec to
 * follow). The uptime and countdown tick every second in the browser and snap back
 * to the server's numbers on each poll; polling stops once the lease is terminal.
 */
export default function LeaseDetail({ leaseId, pollMs = 5000 }: LeaseDetailProps) {
  const [sync, setSync] = useState<Sync | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  // A once-per-second clock driving the live uptime/TTL/cost display.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Latest sync in a ref so the poll effect can decide to keep polling without
  // re-subscribing every render.
  const syncRef = useRef<Sync | null>(null);
  syncRef.current = sync;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const lease = await wisper.getLease(leaseId);
        setSync(toSync(lease, Date.now()));
        setError(null);
      } catch (err) {
        if (!silent) {
          setError(err instanceof WisperError ? err.message : "Failed to load lease.");
        }
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [leaseId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Tick the clock every second for the live metrics.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Re-sync from the server while the lease is still changing; stop once terminal.
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => {
      const current = syncRef.current;
      if (current && isTerminalLease(current.lease.status)) return;
      void load(true);
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, load]);

  async function handleRelease() {
    setReleasing(true);
    try {
      await wisper.deleteLease(leaseId);
      setToast("Lease released.");
      await load(true);
    } catch (err) {
      setToast(err instanceof WisperError ? err.message : "Failed to release lease.");
    } finally {
      setReleasing(false);
    }
  }

  const lease = sync?.lease ?? null;
  const terminal = lease ? isTerminalLease(lease.status) : false;
  const uptime = lease ? leaseUptimeSeconds(lease, nowMs) : 0;
  const ttlRemaining = sync
    ? terminal
      ? 0
      : liveTtlRemainingSeconds(sync.baseRemaining, sync.syncedAtMs, nowMs)
    : 0;
  const elapsedSinceSync = sync ? Math.floor((nowMs - sync.syncedAtMs) / 1000) : 0;
  const cost = sync ? liveCostMicroUsd(sync.baseCost, terminal ? 0 : sync.rate, elapsedSinceSync) : 0;

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Tooltip title="Back to leases">
          <IconButton component={NextLink} href="/leases" aria-label="back to leases" size="small">
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4" component="h1">
            Lease
          </Typography>
          <Typography color="text.secondary" sx={{ fontFamily: "monospace" }}>
            {leaseId}
          </Typography>
        </Box>
        {lease && (
          <Chip
            label={lease.status}
            color={leaseStatusColor(lease.status)}
            variant="outlined"
            aria-label={`status ${lease.status}`}
          />
        )}
        <Tooltip title="Refresh">
          <span>
            <IconButton
              onClick={() => void load()}
              disabled={refreshing}
              aria-label="refresh lease"
            >
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Button
          color="error"
          disabled={!lease || terminal || releasing}
          onClick={() => void handleRelease()}
        >
          {releasing ? "Releasing…" : "Release"}
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {lease == null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          {error ? null : <CircularProgress />}
        </Box>
      ) : (
        <>
          <Tabs value={tab} onChange={(_, v: number) => setTab(v)} aria-label="lease tabs">
            <Tab label="Overview" id="lease-tab-0" aria-controls="lease-tabpanel-0" />
            <Tab label="Console" id="lease-tab-1" aria-controls="lease-tabpanel-1" />
            <Tab label="Exec" id="lease-tab-2" aria-controls="lease-tabpanel-2" />
          </Tabs>

          <Box role="tabpanel" hidden={tab !== 0} id="lease-tabpanel-0" aria-labelledby="lease-tab-0">
            {tab === 0 && (
              <Stack spacing={3}>
                <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
                  <Metric label="Uptime" value={formatHms(uptime)} />
                  <Metric label="TTL remaining" value={formatHms(ttlRemaining)} />
                  <Metric label="Running cost" value={formatUsd(cost, 4)} />
                </Stack>

                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)" },
                      gap: 3,
                    }}
                  >
                    <Field label="Image">{lease.host_image_id}</Field>
                    <Field label="Host">{lease.host_id}</Field>
                    <Field label="Network">{lease.network}</Field>
                    <Field label="TTL">{formatHms(lease.ttl_seconds)}</Field>
                    <Field label="Created">{formatDateTime(lease.created_at)}</Field>
                    <Field label="Started">{formatDateTime(lease.started_at)}</Field>
                    <Field label="Expires">{formatDateTime(lease.expires_at)}</Field>
                    {terminal && <Field label="Ended">{formatDateTime(lease.ended_at)}</Field>}
                    {lease.resources && (
                      <Field label="Resources">
                        {[
                          lease.resources.cpu != null ? `${lease.resources.cpu} vCPU` : null,
                          lease.resources.memory_mb != null
                            ? `${lease.resources.memory_mb} MB RAM`
                            : null,
                          lease.resources.disk_mb != null
                            ? `${lease.resources.disk_mb} MB disk`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </Field>
                    )}
                  </Box>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="caption" color="text.secondary">
                    Uptime and TTL update live and re-sync from the server on each refresh.
                  </Typography>
                </Paper>
              </Stack>
            )}
          </Box>

          <Box role="tabpanel" hidden={tab !== 1} id="lease-tabpanel-1" aria-labelledby="lease-tab-1">
            {tab === 1 && <LeaseConsole leaseId={leaseId} disabled={lease.status !== "active"} />}
          </Box>

          <Box role="tabpanel" hidden={tab !== 2} id="lease-tabpanel-2" aria-labelledby="lease-tab-2">
            {tab === 2 && <LeaseExec leaseId={leaseId} disabled={lease.status !== "active"} />}
          </Box>
        </>
      )}

      <Snackbar
        open={toast != null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
