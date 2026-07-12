"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { wisper, WisperError } from "@/lib/wisper/client";
import { microPerSecondToPerHour, perHourToMicroPerSecond } from "@/lib/format";
import type { Host, HostImage } from "@/lib/wisper/types";

interface HostImagesEditorProps {
  host: Host;
  /** Called with the updated host after a successful PUT /v1/hosts/:id/images. */
  onSaved: (host: Host) => void;
}

/** An editor row: the image plus its price kept as an editable `$ /hr` string. */
interface Row {
  /** Stable key for React; new rows get a synthetic id. */
  key: string;
  id: string;
  name: string;
  /** Price entered by the host in dollars-per-hour (blank = unpriced). */
  pricePerHour: string;
  enabled: boolean;
}

let syntheticId = 0;

function toRow(image: HostImage): Row {
  return {
    key: image.id,
    id: image.id,
    name: image.name,
    pricePerHour:
      image.price_micro_usd_per_second != null
        ? String(Number(microPerSecondToPerHour(image.price_micro_usd_per_second).toFixed(4)))
        : "",
    enabled: image.enabled ?? true,
  };
}

/**
 * Editable table of a host's priced images. Hosts set a per-hour price and an
 * enabled flag per image, add or remove images, then save — which replaces the
 * host's image list via PUT /v1/hosts/:id/images. Prices are shown/edited in
 * `$ /hr` and converted to the contract's per-second micro-USD unit on save.
 */
export default function HostImagesEditor({ host, onSaved }: HostImagesEditorProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reset = useCallback(() => {
    setRows((host.images ?? []).map(toRow));
    setError(null);
    setSaved(false);
  }, [host]);

  useEffect(() => {
    reset();
  }, [reset]);

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setSaved(false);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setSaved(false);
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: `new-${syntheticId++}`, id: "", name: "", pricePerHour: "", enabled: true },
    ]);
    setSaved(false);
  }

  const invalid = rows.some((r) => {
    if (!r.name.trim()) return true;
    if (r.pricePerHour.trim()) {
      const n = Number(r.pricePerHour);
      if (!Number.isFinite(n) || n < 0) return true;
    }
    return false;
  });

  async function handleSave() {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    const images: HostImage[] = rows.map((r) => {
      const image: HostImage = { id: r.id, name: r.name.trim(), enabled: r.enabled };
      const priceStr = r.pricePerHour.trim();
      if (priceStr) image.price_micro_usd_per_second = perHourToMicroPerSecond(Number(priceStr));
      return image;
    });
    try {
      const updated = await wisper.updateHostImages(host.id, { images });
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof WisperError ? err.message : "Failed to save images.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack spacing={2}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Image</TableCell>
              <TableCell sx={{ width: 180 }}>Price</TableCell>
              <TableCell align="center" sx={{ width: 100 }}>
                Enabled
              </TableCell>
              <TableCell align="right" sx={{ width: 56 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
                    No images yet. Add one to start offering it.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <TextField
                      value={row.name}
                      onChange={(e) => updateRow(row.key, { name: e.target.value })}
                      placeholder="ubuntu-22.04"
                      size="small"
                      variant="standard"
                      fullWidth
                      error={!row.name.trim()}
                      slotProps={{ htmlInput: { "aria-label": "image name" } }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={row.pricePerHour}
                      onChange={(e) => updateRow(row.key, { pricePerHour: e.target.value })}
                      type="number"
                      size="small"
                      variant="standard"
                      placeholder="0.00"
                      slotProps={{
                        htmlInput: { min: 0, step: 0.01, "aria-label": `price for ${row.name || "image"}` },
                        input: {
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                          endAdornment: <InputAdornment position="end">/hr</InputAdornment>,
                        },
                      }}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      checked={row.enabled}
                      onChange={(e) => updateRow(row.key, { enabled: e.target.checked })}
                      size="small"
                      slotProps={{ input: { "aria-label": `enable ${row.name || "image"}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Remove image">
                      <IconButton
                        size="small"
                        onClick={() => removeRow(row.key)}
                        aria-label={`remove ${row.name || "image"}`}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button startIcon={<AddIcon />} onClick={addRow} size="small">
          Add image
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {saved && (
          <Typography variant="body2" color="success.main">
            Saved
          </Typography>
        )}
        <Button onClick={reset} color="inherit" disabled={saving}>
          Reset
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || invalid}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </Stack>
    </Stack>
  );
}
