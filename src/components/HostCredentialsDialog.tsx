"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
import { buildAgentRunCommand, copyToClipboard } from "@/lib/host";
import type { RegisterHostResponse } from "@/lib/wisper/types";

interface HostCredentialsDialogProps {
  /** The registration response, or null when the dialog is closed. */
  result: RegisterHostResponse | null;
  onClose: () => void;
}

/** A labelled, monospaced value with a copy-to-clipboard button. */
function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
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
          alignItems: multiline ? "flex-start" : "center",
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
            whiteSpace: multiline ? "pre-wrap" : "nowrap",
            overflowX: "auto",
            wordBreak: multiline ? "break-all" : "normal",
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
 * Post-registration dialog that surfaces the host's one-time `agent_token`, the
 * `manager_ws` its agent connects to, and a ready-to-run bootstrap command. The
 * token cannot be retrieved again, so the dialog warns the operator to copy it
 * before dismissing.
 */
export default function HostCredentialsDialog({ result, onClose }: HostCredentialsDialogProps) {
  const open = result != null;
  const managerWs = result?.manager_ws ?? "";
  const runCommand = result ? buildAgentRunCommand(result.agent_token, managerWs) : "";

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Host registered — save your agent token</DialogTitle>
      <DialogContent dividers>
        {result && (
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              <strong>{result.name ?? "Host"}</strong> is registered. Install the agent below to bring it
              online.
            </Typography>

            <Alert severity="warning">
              The agent token is shown <strong>once</strong> and cannot be retrieved again. Copy it
              now and store it somewhere safe.
            </Alert>

            <CopyField label="Agent token" value={result.agent_token} />
            {managerWs && <CopyField label="Manager WebSocket" value={managerWs} />}
            <CopyField label="Run command" value={runCommand} multiline />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          I&apos;ve saved the token
        </Button>
      </DialogActions>
    </Dialog>
  );
}
