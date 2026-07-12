"use client";

import NextLink from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import ProtectedShell from "@/components/ProtectedShell";
import { useAuth } from "@/lib/auth/AuthContext";

function Dashboard() {
  const { user, hasRole } = useAuth();
  const isHost = hasRole("host");

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" gutterBottom>
          Welcome{user?.email ? `, ${user.email}` : ""}
        </Typography>
        <Typography color="text.secondary">
          Rent and run ephemeral, root-access containers by the minute — or host your own and earn.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }}>
          {(user?.roles ?? []).map((role) => (
            <Chip key={role} label={role} color="primary" variant="outlined" />
          ))}
        </Stack>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Getting started
          </Typography>
          <Typography color="text.secondary">
            Browse the catalog to launch a lease, manage running leases, or top up your wallet.
            Host tools appear here once your account holds the host role.
          </Typography>
        </CardContent>
      </Card>

      {isHost ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Host tools
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Manage your hosts and image pricing, track earnings, and set up Stripe payouts.
            </Typography>
            <Button component={NextLink} href="/host" variant="outlined" startIcon={<RocketLaunchIcon />}>
              Open host tools
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Become a host
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Rent out a machine to run leases and earn. Your consumer access stays — the host role is
              added on top.
            </Typography>
            <Button component={NextLink} href="/host" variant="contained" startIcon={<RocketLaunchIcon />}>
              Become a host
            </Button>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

export default function Home() {
  return (
    <ProtectedShell>
      <Dashboard />
    </ProtectedShell>
  );
}
