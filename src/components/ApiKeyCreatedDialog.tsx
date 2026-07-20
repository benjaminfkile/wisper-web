"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import { copyToClipboard } from "@/lib/host";
import type { CreateApiKeyResponse } from "@/lib/wisper/types";

interface ApiKeyCreatedDialogProps {
  /** The create response (full token + metadata), or null when the dialog is closed. */
  result: CreateApiKeyResponse | null;
  onClose: () => void;
}

/** A labelled, monospaced value with a copy-to-clipboard button (mirrors the agent-token dialog). */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          p: 1,
          bgcolor: "action.hover",
        }}
      >
        <Box
          component="pre"
          sx={{
            m: 0,
            flexGrow: 1,
            fontFamily: "monospace",
            fontSize: 13,
            whiteSpace: "nowrap",
            overflowX: "auto",
          }}
        >
          {value}
        </Box>
        <Tooltip title={copied ? "Copied" : "Copy"}>
          <IconButton size="small" onClick={handleCopy} aria-label={`copy ${label}`}>
            {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

/**
 * Post-creation dialog that reveals a freshly-minted API key's full secret
 * (`wck_live_<64-hex>`) exactly once. The backend never returns the secret again,
 * so the dialog warns the user to copy it now — mirroring the host agent-token
 * reveal (see {@link HostCredentialsDialog}). Once dismissed the secret is gone
 * from memory and only the key's metadata remains in the list.
 */
export default function ApiKeyCreatedDialog({ result, onClose }: ApiKeyCreatedDialogProps) {
  const open = result != null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>API key created — save your secret</DialogTitle>
      <DialogContent dividers>
        {result && (
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              <strong>{result.key.name}</strong> is ready. Send it as{" "}
              <code>Authorization: Bearer &lt;key&gt;</code> from your orchestrator or automation.
            </Typography>

            <Alert severity="warning">
              This key is shown <strong>once</strong> and cannot be retrieved again. Copy it now and
              store it somewhere safe — you will not see this again.
            </Alert>

            <CopyField label="API key" value={result.token} />

            {result.key.scopes.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                  Scopes
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                  {result.key.scopes.map((scope) => (
                    <Chip key={scope} size="small" label={scope} variant="outlined" />
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          I&apos;ve saved the key
        </Button>
      </DialogActions>
    </Dialog>
  );
}
