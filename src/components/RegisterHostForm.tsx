"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { wisper, WisperError } from "@/lib/wisper/client";
import type { RegisterHostResponse } from "@/lib/wisper/types";

interface RegisterHostFormProps {
  /**
   * Called with the registration response after a successful POST /v1/hosts. The
   * parent surfaces the one-time credentials and refreshes the host role/list.
   */
  onRegistered: (result: RegisterHostResponse) => void;
  /** Label for the submit button (e.g. "Become a host" vs "Register host"). */
  submitLabel?: string;
}

/**
 * A small form to register a host (POST /v1/hosts) with a name and optional
 * region. On success it hands the response — including the one-time agent token —
 * back to the parent via `onRegistered`.
 */
export default function RegisterHostForm({
  onRegistered,
  submitLabel = "Register host",
}: RegisterHostFormProps) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await wisper.registerHost({
        name: trimmedName,
        ...(region.trim() ? { region: region.trim() } : {}),
      });
      setName("");
      setRegion("");
      onRegistered(result);
    } catch (err) {
      setError(err instanceof WisperError ? err.message : "Failed to register host.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack component="form" spacing={2} onSubmit={handleSubmit}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="Host name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-workstation"
          required
          fullWidth
        />
        <TextField
          label="Region (optional)"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="us-east"
          fullWidth
        />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
        <Button
          type="submit"
          variant="contained"
          startIcon={<RocketLaunchIcon />}
          disabled={submitting || !trimmedName}
        >
          {submitting ? "Registering…" : submitLabel}
        </Button>
      </Stack>
    </Stack>
  );
}
