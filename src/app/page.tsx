"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ProtectedShell from "@/components/ProtectedShell";
import { useAuth } from "@/lib/auth/AuthContext";

function Dashboard() {
  const { user } = useAuth();

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
            Host tools appear here once your account holds the host role. Catalog, console, and
            billing features are wired up in the following milestones.
          </Typography>
        </CardContent>
      </Card>
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
