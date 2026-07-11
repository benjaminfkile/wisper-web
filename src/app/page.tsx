import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import HealthBadge from "@/components/HealthBadge";

export default function Home() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h3" component="h1">
          Wisper
        </Typography>
        <HealthBadge />
      </Box>
      <Typography color="text.secondary">
        Rent and run ephemeral, root-access containers by the minute — or host your own and
        earn. This is the consumer &amp; host app shell; lease, console, and billing features
        are added next.
      </Typography>
    </Container>
  );
}
