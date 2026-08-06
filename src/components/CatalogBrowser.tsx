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
import {
  catalogAdvertisesGpu,
  gpuBadgeLabel,
  gpuClassOptions,
  gpuHostSummary,
  offerHasGpu,
} from "@/lib/gpu";
import type { CatalogHost, Lease, PricedImage } from "@/lib/wisper/types";

const ALL_REGIONS = "__all__";
const ANY_ISOLATION = "__any__";
const ANY_GPU_CLASS = "__any__";

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
  // GPU filters — server-side (forwarded to GET /v1/catalog as query params).
  const [minGpus, setMinGpus] = useState("");
  const [gpuClass, setGpuClass] = useState(ANY_GPU_CLASS);
  // Latches true once any load surfaces GPU capability, so the GPU controls
  // appear only when the catalog actually has GPUs (a zero-GPU catalog looks
  // exactly like it did before GPUs) and never vanish once a filter narrows.
  const [gpuAvailable, setGpuAvailable] = useState(false);

  const [dialogHost, setDialogHost] = useState<CatalogHost | null>(null);
  const [dialogImage, setDialogImage] = useState<PricedImage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<Lease | null>(null);

  // The min-GPUs field parsed to a positive integer, or undefined when off.
  const minGpusValue = useMemo(() => {
    const n = Number(minGpus.trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  }, [minGpus]);

  // Re-fetch whenever a GPU filter changes; the filters ride along as query
  // params. Region/search/isolation stay client-side (below). Results already
  // shown stay put during a refetch, so the field keeps focus and doesn't jump.
  useEffect(() => {
    let active = true;
    setError(null);
    wisper
      .getCatalog({
        min_gpus: minGpusValue,
        gpu_class: gpuClass !== ANY_GPU_CLASS ? gpuClass : undefined,
      })
      .then((catalog) => {
        if (!active) return;
        const data = catalog.data ?? [];
        setHosts(data);
        if (catalogAdvertisesGpu(data)) setGpuAvailable(true);
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
  }, [minGpusValue, gpuClass]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts ?? []) if (h.region) set.add(h.region);
    return Array.from(set).sort();
  }, [hosts]);

  // GPU class options from the loaded hosts, always keeping the current pick
  // selectable even if a narrowing filter would otherwise drop it.
  const gpuClasses = useMemo(() => {
    const opts = gpuClassOptions(hosts);
    if (gpuClass !== ANY_GPU_CLASS && !opts.includes(gpuClass)) opts.push(gpuClass);
    return opts.sort();
  }, [hosts, gpuClass]);

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
        {gpuAvailable && (
          <>
            <TextField
              label="Min GPUs"
              type="number"
              value={minGpus}
              onChange={(e) => setMinGpus(e.target.value)}
              size="small"
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
              helperText="0 = any"
              sx={{ width: 120 }}
            />
            <TextField
              select
              label="GPU class"
              value={gpuClass}
              onChange={(e) => setGpuClass(e.target.value)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value={ANY_GPU_CLASS}>Any GPU class</MenuItem>
              {gpuClasses.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
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
          {filtered.map(({ host, images }) => {
            const gpuSummary = gpuHostSummary(host.gpu_classes, host.gpu_count);
            return (
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
                {gpuSummary && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    gutterBottom
                    aria-label={`host gpus ${gpuSummary}`}
                  >
                    {gpuSummary}
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
                          {(offerHasGpu(image) ||
                            (image.isolation_levels && image.isolation_levels.length > 0)) ? (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ mt: 0.75, flexWrap: "wrap" }}
                            >
                              {offerHasGpu(image) ? (
                                <Chip
                                  size="small"
                                  color="secondary"
                                  variant="outlined"
                                  label={gpuBadgeLabel(host.gpu_classes, image.max_gpus)}
                                  aria-label={`gpu ${gpuBadgeLabel(host.gpu_classes, image.max_gpus)}`}
                                />
                              ) : null}
                              {(image.isolation_levels ?? []).length > 0
                                ? sortIsolationLevels(image.isolation_levels ?? []).map((lvl) => (
                                    <Chip
                                      key={lvl}
                                      size="small"
                                      variant="outlined"
                                      label={isolationLabel(lvl)}
                                      aria-label={`isolation ${isolationLabel(lvl)}`}
                                    />
                                  ))
                                : null}
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
            );
          })}
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
