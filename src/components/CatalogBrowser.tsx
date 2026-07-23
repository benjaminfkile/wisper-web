"use client";

import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import BoltIcon from "@mui/icons-material/Bolt";
import SearchIcon from "@mui/icons-material/Search";
import CreateLeaseDialog from "@/components/CreateLeaseDialog";
import { wisper, WisperError } from "@/lib/wisper/client";
import { formatPricePerHour } from "@/lib/format";
import { osLabel } from "@/lib/os";
import {
  ISOLATION_ORDER,
  isolationLabel,
  offersAtLeast,
  sortIsolationLevels,
} from "@/lib/isolation";
import type { CatalogHost, Lease, PricedImage } from "@/lib/wisper/types";

const ALL_REGIONS = "__all__";
const ANY_ISOLATION = "__any__";

/**
 * Browse GET /v1/catalog: one card per host, each listing its priced images with
 * an hourly rate and a Lease button. A search box (host or image name) and a
 * region filter narrow the list. Launching an image opens the Create Lease dialog.
 */
export default function CatalogBrowser() {
  const [hosts, setHosts] = useState<CatalogHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState(ALL_REGIONS);
  const [minIsolation, setMinIsolation] = useState(ANY_ISOLATION);

  const [dialogHost, setDialogHost] = useState<CatalogHost | null>(null);
  const [dialogImage, setDialogImage] = useState<PricedImage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<Lease | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    wisper
      .getCatalog()
      .then((catalog) => {
        if (!active) return;
        setHosts(catalog.data ?? []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof WisperError ? err.message : "Failed to load the catalog.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts ?? []) if (h.region) set.add(h.region);
    return Array.from(set).sort();
  }, [hosts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (hosts ?? [])
      .filter((h) => region === ALL_REGIONS || h.region === region)
      .map((h) => {
        let images = h.images ?? [];
        if (minIsolation !== ANY_ISOLATION) {
          images = images.filter((img) =>
            offersAtLeast(img.isolation_levels, minIsolation),
          );
        }
        if (!q) return { host: h, images };
        const hostMatch = h.label.toLowerCase().includes(q);
        const matchedImages = hostMatch
          ? images
          : images.filter((img) => img.image_ref.toLowerCase().includes(q));
        return { host: h, images: matchedImages };
      })
      .filter((entry) => entry.images.length > 0);
  }, [hosts, search, region, minIsolation]);

  function openLease(host: CatalogHost, image: PricedImage) {
    setDialogHost(host);
    setDialogImage(image);
    setDialogOpen(true);
  }

  if (loading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" gutterBottom>
          Catalog
        </Typography>
        <Typography color="text.secondary">
          Browse available hosts and their priced images, then launch a lease.
        </Typography>
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="Search"
          placeholder="Host or image name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          label="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          size="small"
          sx={{ minWidth: 180 }}
        >
          <MenuItem value={ALL_REGIONS}>All regions</MenuItem>
          {regions.map((r) => (
            <MenuItem key={r} value={r}>
              {r}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Min isolation"
          value={minIsolation}
          onChange={(e) => setMinIsolation(e.target.value)}
          size="small"
          sx={{ minWidth: 180 }}
        >
          <MenuItem value={ANY_ISOLATION}>Any isolation</MenuItem>
          {ISOLATION_ORDER.map((lvl) => (
            <MenuItem key={lvl} value={lvl}>
              {isolationLabel(lvl)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {filtered.length === 0 ? (
        <Alert severity="info">No hosts or images match your filters.</Alert>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" },
          }}
        >
          {filtered.map(({ host, images }) => (
            <Card key={host.host_id} variant="outlined">
              <CardContent>
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
                >
                  <Typography variant="h6" sx={{ flexGrow: 1 }} noWrap>
                    {host.label}
                  </Typography>
                  {host.os ? (
                    <Chip
                      size="small"
                      label={osLabel(host.os)}
                      variant="outlined"
                      aria-label={`operating system ${osLabel(host.os)}`}
                    />
                  ) : null}
                  {host.online != null ? (
                    <Chip
                      size="small"
                      label={host.online ? "online" : "offline"}
                      color={host.online ? "success" : "default"}
                      variant="outlined"
                    />
                  ) : null}
                </Box>
                {host.region && (
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {host.region}
                  </Typography>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Stack spacing={1.5}>
                  {images.map((image) => (
                    <Box key={image.host_image_id}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap>
                            {image.image_ref}
                          </Typography>
                          <Typography variant="body2" color="primary.main">
                            {image.price_cents_per_min != null
                              ? formatPricePerHour(image.price_cents_per_min)
                              : "Price on request"}
                          </Typography>
                          {image.isolation_levels && image.isolation_levels.length > 0 ? (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ mt: 0.75, flexWrap: "wrap" }}
                            >
                              {sortIsolationLevels(image.isolation_levels).map((lvl) => (
                                <Chip
                                  key={lvl}
                                  size="small"
                                  variant="outlined"
                                  label={isolationLabel(lvl)}
                                  aria-label={`isolation ${isolationLabel(lvl)}`}
                                />
                              ))}
                            </Stack>
                          ) : null}
                        </Box>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<BoltIcon />}
                          onClick={() => openLease(host, image)}
                        >
                          Lease
                        </Button>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <CreateLeaseDialog
        open={dialogOpen}
        host={dialogHost}
        image={dialogImage}
        onClose={() => setDialogOpen(false)}
        onCreated={(lease) => {
          setDialogOpen(false);
          setCreated(lease);
        }}
      />

      <Snackbar
        open={created != null}
        autoHideDuration={6000}
        onClose={() => setCreated(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          onClose={() => setCreated(null)}
          action={
            <Button color="inherit" size="small" href="/leases">
              View leases
            </Button>
          }
        >
          Lease created.
        </Alert>
      </Snackbar>
    </Stack>
  );
}
