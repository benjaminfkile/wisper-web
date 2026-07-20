"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { wisper, WisperError } from "@/lib/wisper/client";
import type { ApiKeyScope, CreateApiKeyResponse } from "@/lib/wisper/types";

interface CreateApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the create response (full token + metadata) on success. */
  onCreated: (result: CreateApiKeyResponse) => void;
}

/** Scopes the dialog offers. The backend caps the request to the minter's roles. */
const OFFERED_SCOPES: { scope: ApiKeyScope; description: string }[] = [
  { scope: "consumer", description: "Launch and manage leases, run exec/shell." },
  { scope: "host", description: "Manage owned hosts, pricing, and earnings." },
];

/**
 * "Create key" dialog: a name plus consumer/host scope checkboxes. The backend
 * is authoritative and caps requested scopes to the minter's roles, so this form
 * sends what the user asks for and surfaces any validation error verbatim rather
 * than second-guessing it locally.
 */
export default function CreateApiKeyDialog({ open, onClose, onCreated }: CreateApiKeyDialogProps) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["consumer"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setScopes(["consumer"]);
    setError(null);
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  function toggleScope(scope: ApiKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the key a name so you can recognise it later.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await wisper.createApiKey({ name: trimmed, scopes });
      reset();
      onCreated(result);
    } catch (err) {
      // Surface the backend's validation/capping error (and its 403 for
      // key-session minting) verbatim.
      setError(err instanceof WisperError ? err.message : "Failed to create the key.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Create API key</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ci-runner"
            fullWidth
            autoFocus
            disabled={submitting}
            helperText="A label to recognise this key — e.g. the machine or automation that uses it."
          />

          <FormControl component="fieldset" disabled={submitting}>
            <FormLabel component="legend">Scopes</FormLabel>
            <FormGroup>
              {OFFERED_SCOPES.map(({ scope, description }) => (
                <FormControlLabel
                  key={scope}
                  control={
                    <Checkbox
                      checked={scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      slotProps={{ input: { "aria-label": `scope ${scope}` } }}
                    />
                  }
                  label={
                    <span>
                      <strong>{scope}</strong> — {description}
                    </span>
                  }
                />
              ))}
            </FormGroup>
            <FormHelperText>
              Scopes are capped to the roles your account holds; the server rejects any it can&apos;t
              grant.
            </FormHelperText>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} variant="contained" disabled={submitting}>
          {submitting ? "Creating…" : "Create key"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
