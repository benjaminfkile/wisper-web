"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";
import { wisper, WisperError } from "@/lib/wisper/client";
import { formatDateTime, formatDuration, formatUsd } from "@/lib/format";
import { isTerminalLease, leaseStatusColor } from "@/lib/leaseStatus";
import type { Lease } from "@/lib/wisper/types";

interface LeaseListProps {
  /** Poll interval (ms) for refreshing lease status. Set to 0 to disable. */
  pollMs?: number;
}

/**
 * The caller's leases (GET /v1/leases) in a table, with status chips that refresh
 * on a poll while any lease is still non-terminal, and a Release action that
 * DELETEs the lease. A manual refresh button is always available.
 */
export default function LeaseList({ pollMs = 5000 }: LeaseListProps) {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Latest leases in a ref so the poll effect can decide to keep polling without
  // re-subscribing every render.
  const leasesRef = useRef<Lease[] | null>(null);
  leasesRef.current = leases;

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const next = await wisper.listLeases();
      setLeases(next);
      setError(null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof WisperError ? err.message : "Failed to load leases.");
      }
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while at least one lease is still changing; stop once all are terminal.
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => {
      const current = leasesRef.current;
      if (current && current.length > 0 && current.every((l) => isTerminalLease(l.status))) {
        return; // nothing left to watch
      }
      void load(true);
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, load]);

  async function handleRelease(id: string) {
    setReleasingId(id);
    try {
      await wisper.deleteLease(id);
      setToast("Lease released.");
      await load(true);
    } catch (err) {
      setToast(err instanceof WisperError ? err.message : "Failed to release lease.");
    } finally {
      setReleasingId(null);
    }
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4" component="h1">
            Leases
          </Typography>
          <Typography color="text.secondary">Your running and past leases.</Typography>
        </Box>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={() => void load()} disabled={refreshing} aria-label="refresh leases">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {leases == null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : leases.length === 0 ? (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" component={NextLink} href="/catalog">
              Browse catalog
            </Button>
          }
        >
          You have no leases yet.
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Image</TableCell>
                <TableCell>Host</TableCell>
                <TableCell>Network</TableCell>
                <TableCell>TTL</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {leases.map((lease) => {
                const terminal = isTerminalLease(lease.status);
                return (
                  <TableRow key={lease.id} hover>
                    <TableCell>
                      <Chip
                        size="small"
                        label={lease.status}
                        color={leaseStatusColor(lease.status)}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <span>{lease.host_image_id}</span>
                        {(lease.resources?.gpus ?? 0) > 0 && (
                          <Chip
                            size="small"
                            variant="outlined"
                            color="secondary"
                            label={`${lease.resources?.gpus} GPU`}
                            aria-label={`gpus ${lease.resources?.gpus}`}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{lease.host_id}</TableCell>
                    <TableCell>{lease.network}</TableCell>
                    <TableCell>{formatDuration(lease.ttl_seconds)}</TableCell>
                    <TableCell>{formatDateTime(lease.created_at)}</TableCell>
                    <TableCell align="right">
                      {lease.cost_cents != null ? formatUsd(lease.cost_cents) : "—"}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                        <Button
                          size="small"
                          component={NextLink}
                          href={`/leases/${lease.id}`}
                        >
                          View
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={terminal || releasingId === lease.id}
                          onClick={() => void handleRelease(lease.id)}
                        >
                          {releasingId === lease.id ? "Releasing…" : "Release"}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
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
