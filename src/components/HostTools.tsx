"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import DnsIcon from "@mui/icons-material/Dns";
import RefreshIcon from "@mui/icons-material/Refresh";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { useAuth } from "@/lib/auth/AuthContext";
import { wisper, WisperError } from "@/lib/wisper/client";
import { formatUsd } from "@/lib/format";
import { connectStatusView, redirectTo } from "@/lib/host";
import HostCredentialsDialog from "./HostCredentialsDialog";
import HostImagesEditor from "./HostImagesEditor";
import RegisterHostForm from "./RegisterHostForm";
import type { Earnings, Host, RegisterHostResponse } from "@/lib/wisper/types";

/** A large labelled money metric, matching the billing page's tiles. */
function Metric({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 160, flex: "1 1 160px" }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography
        variant="h5"
        component="div"
        color={emphasize ? "primary.main" : "text.primary"}
        sx={{ fontVariantNumeric: "tabular-nums", mt: 0.5 }}
      >
        {value}
      </Typography>
    </Paper>
  );
}

/** Earnings summary + Stripe Connect onboarding/status (GET /v1/earnings, POST /v1/hosts/connect). */
function EarningsPanel({
  earnings,
  loading,
  error,
}: {
  earnings: Earnings | null;
  loading: boolean;
  error: string | null;
}) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const status = connectStatusView(earnings);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { onboarding_url } = await wisper.hostConnect();
      // Hand off to Stripe's hosted onboarding.
      redirectTo(onboarding_url);
    } catch (err) {
      setConnectError(err instanceof WisperError ? err.message : "Failed to start onboarding.");
      setConnecting(false);
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
          <AccountBalanceIcon color="action" />
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            Earnings & payouts
          </Typography>
          <Chip
            size="small"
            color={status.color === "default" ? undefined : status.color}
            variant={status.color === "default" ? "outlined" : "filled"}
            label={status.label}
          />
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {connectError && <Alert severity="error" sx={{ mb: 2 }}>{connectError}</Alert>}

        {loading && earnings == null ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : earnings != null ? (
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
            <Metric
              label={`Total earned (${earnings.currency})`}
              value={formatUsd(earnings.accrued_cents)}
              emphasize
            />
            <Metric
              label="Available"
              value={formatUsd(Math.max(0, earnings.accrued_cents - earnings.paid_cents))}
            />
            <Metric label="Paid out" value={formatUsd(earnings.paid_cents)} />
            {earnings.payout_min_cents != null && (
              <Metric label="Payout minimum" value={formatUsd(earnings.payout_min_cents)} />
            )}
          </Stack>
        ) : null}

        <Divider sx={{ my: 2 }} />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {status.active
                ? "Stripe Connect is set up — earnings pay out to your bank."
                : "Connect a Stripe account to receive payouts for your hosted leases."}
            </Typography>
          </Box>
          <Button
            variant={status.active ? "outlined" : "contained"}
            onClick={handleConnect}
            disabled={connecting}
            startIcon={<AccountBalanceIcon />}
          >
            {connecting
              ? "Redirecting…"
              : status.active
                ? "Manage payouts"
                : "Set up payouts"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** One owned host: metadata plus its priced-images editor. */
function HostCard({ host, onSaved }: { host: Host; onSaved: (h: Host) => void }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <DnsIcon color="action" />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" component="h3">
              {host.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {[host.region, host.id].filter(Boolean).join(" · ")}
            </Typography>
          </Box>
          {host.status && <Chip size="small" label={host.status} variant="outlined" />}
        </Stack>
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="subtitle2" gutterBottom>
          Priced images
        </Typography>
        <HostImagesEditor host={host} onSaved={onSaved} />
      </CardContent>
    </Card>
  );
}

/**
 * The host tools page. Gated by the additive `host` role: consumers see a
 * "become a host" registration panel (registering flips the role in place), while
 * hosts get earnings + Stripe Connect, per-host priced-image management, and the
 * ability to register additional hosts. The one-time agent token surfaces in a
 * dialog after each registration.
 */
export default function HostTools() {
  const { hasRole, refresh } = useAuth();
  const isHost = hasRole("host");

  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [credentials, setCredentials] = useState<RegisterHostResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const load = useCallback(async () => {
    if (!isHost) return;
    setLoading(true);
    try {
      // GET /v1/hosts/mine returns { data, earnings } — one call yields both the
      // owned hosts and the earnings/payout summary the panel renders for free.
      const { data, earnings: earned } = await wisper.myHosts();
      setHosts(data);
      setEarnings(earned ?? null);
      setHostsError(null);
      setEarningsError(null);
    } catch (err) {
      setHosts([]);
      setHostsError(err instanceof WisperError ? err.message : "Failed to load hosts.");
    } finally {
      setLoading(false);
    }
  }, [isHost]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRegistered = useCallback(
    async (result: RegisterHostResponse) => {
      setCredentials(result);
      setShowRegister(false);
      // Registration may have granted the host role; pull fresh roles + hosts.
      try {
        await refresh();
      } catch {
        // Non-fatal: the credentials dialog still shows; a reload picks up roles.
      }
      void load();
    },
    [refresh, load],
  );

  function handleHostSaved(updated: Host) {
    setHosts((prev) => (prev ? prev.map((h) => (h.id === updated.id ? updated : h)) : prev));
    setToast("Images saved.");
  }

  // Consumers who haven't opted in yet: the become-a-host path.
  if (!isHost) {
    return (
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" component="h1">
            Become a host
          </Typography>
          <Typography color="text.secondary">
            Register a machine to run leases and earn. Your account keeps its consumer access — the
            host role is added on top.
          </Typography>
        </Box>

        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
              <RocketLaunchIcon color="action" />
              <Typography variant="h6" component="h2">
                Register your first host
              </Typography>
            </Stack>
            <RegisterHostForm onRegistered={handleRegistered} submitLabel="Become a host" />
          </CardContent>
        </Card>

        <HostCredentialsDialog result={credentials} onClose={() => setCredentials(null)} />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4" component="h1">
            Host tools
          </Typography>
          <Typography color="text.secondary">
            Manage your hosts, image pricing, earnings, and payouts.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={() => void load()} disabled={loading} aria-label="refresh host tools">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Button
          variant="contained"
          startIcon={<RocketLaunchIcon />}
          onClick={() => setShowRegister((v) => !v)}
        >
          Register host
        </Button>
      </Stack>

      {showRegister && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              Register another host
            </Typography>
            <RegisterHostForm onRegistered={handleRegistered} />
          </CardContent>
        </Card>
      )}

      <EarningsPanel earnings={earnings} loading={loading} error={earningsError} />

      <Box>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Your hosts
        </Typography>

        {hostsError && <Alert severity="error" sx={{ mb: 2 }}>{hostsError}</Alert>}

        {hosts == null ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : hosts.length === 0 && !hostsError ? (
          <Alert severity="info">No hosts yet. Register one to start offering images.</Alert>
        ) : (
          <Stack spacing={2}>
            {hosts.map((host) => (
              <HostCard key={host.id} host={host} onSaved={handleHostSaved} />
            ))}
          </Stack>
        )}
      </Box>

      <HostCredentialsDialog result={credentials} onClose={() => setCredentials(null)} />

      <Snackbar
        open={toast != null}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
