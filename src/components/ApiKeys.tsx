"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import { useAuth } from "@/lib/auth/AuthContext";
import { wisper, WisperError } from "@/lib/wisper/client";
import { formatDateTime } from "@/lib/format";
import ApiKeyCreatedDialog from "./ApiKeyCreatedDialog";
import CreateApiKeyDialog from "./CreateApiKeyDialog";
import type { ApiKey, CreateApiKeyResponse } from "@/lib/wisper/types";

/** Chips for a key's scopes, in a stable order. */
function ScopeChips({ scopes }: { scopes: ApiKey["scopes"] }) {
  if (!scopes.length) return <Typography variant="body2" color="text.secondary">—</Typography>;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
      {scopes.map((scope) => (
        <Chip key={scope} size="small" label={scope} variant="outlined" />
      ))}
    </Stack>
  );
}

/** One key row. Revoked keys stay listed but read struck-through and dimmed. */
function KeyRow({ apiKey, onRevoke }: { apiKey: ApiKey; onRevoke: (key: ApiKey) => void }) {
  const revoked = Boolean(apiKey.revoked_at);
  return (
    <TableRow
      sx={{
        opacity: revoked ? 0.55 : 1,
        "& td": revoked ? { textDecoration: "line-through" } : undefined,
      }}
    >
      <TableCell>{apiKey.name}</TableCell>
      <TableCell>
        <Box component="code" sx={{ fontFamily: "monospace", fontSize: 13 }}>
          {apiKey.token_prefix}
        </Box>
      </TableCell>
      <TableCell sx={{ textDecoration: "none !important" }}>
        <ScopeChips scopes={apiKey.scopes} />
      </TableCell>
      <TableCell>{formatDateTime(apiKey.created_at)}</TableCell>
      <TableCell>{apiKey.last_used_at ? formatDateTime(apiKey.last_used_at) : "Never"}</TableCell>
      <TableCell>
        {revoked ? (
          <Chip size="small" color="default" variant="outlined" label="Revoked" />
        ) : (
          <Chip size="small" color="success" variant="outlined" label="Active" />
        )}
      </TableCell>
      <TableCell align="right" sx={{ textDecoration: "none !important" }}>
        {!revoked && (
          <Tooltip title="Revoke key">
            <IconButton
              size="small"
              onClick={() => onRevoke(apiKey)}
              aria-label={`revoke ${apiKey.name}`}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * The API-keys management page. Lists the account's machine keys, mints new ones
 * (revealing the full secret exactly once), and revokes them.
 *
 * Minting is JWT-only by design — a key cannot mint keys — so when the current
 * session is itself backed by an API key the Create action is disabled and an
 * info banner explains why. If a 403 slips through anyway, the create dialog
 * surfaces the backend's message verbatim.
 */
export default function ApiKeys() {
  const { isApiKeySession } = useAuth();

  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKeys(await wisper.listApiKeys());
      setError(null);
    } catch (err) {
      setKeys([]);
      setError(err instanceof WisperError ? err.message : "Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreated = useCallback((result: CreateApiKeyResponse) => {
    setCreateOpen(false);
    setCreated(result);
    // Optimistically show the new key's metadata at the top of the list.
    setKeys((prev) => (prev ? [result.key, ...prev] : [result.key]));
  }, []);

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await wisper.revokeApiKey(revokeTarget.id);
      // Reflect the revocation in place; the row stays listed, struck/dimmed.
      setKeys((prev) =>
        prev
          ? prev.map((k) =>
              k.id === revokeTarget.id ? { ...k, revoked_at: k.revoked_at ?? "revoked" } : k,
            )
          : prev,
      );
      setRevokeTarget(null);
      setToast("Key revoked.");
    } catch (err) {
      setRevokeError(err instanceof WisperError ? err.message : "Failed to revoke the key.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4" component="h1">
            API keys
          </Typography>
          <Typography color="text.secondary">
            Machine keys for your orchestrator or automation. Each is sent as{" "}
            <code>Authorization: Bearer &lt;key&gt;</code> and carries a subset of your roles.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={() => void load()} disabled={loading} aria-label="refresh api keys">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={isApiKeySession ? "Minting is disabled for API-key sessions" : ""}>
          <span>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disabled={isApiKeySession}
              onClick={() => setCreateOpen(true)}
            >
              Create key
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {isApiKeySession && (
        <Alert severity="info">
          You&apos;re signed in with an API key, so new keys can&apos;t be minted here — a key cannot
          mint keys. Sign in with an interactive (Cognito) session to create keys, or have the
          operator define one in wisper-api&apos;s <code>Auth:ApiKeys</code> config map.
        </Alert>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {keys == null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : keys.length === 0 && !error ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <VpnKeyIcon color="disabled" sx={{ fontSize: 40, mb: 1 }} />
          <Typography variant="h6" gutterBottom>
            No API keys yet
          </Typography>
          <Typography color="text.secondary">
            {isApiKeySession
              ? "Sign in interactively to mint a key for your automation."
              : "Create a key to authenticate an orchestrator or automation as your account."}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label="api keys">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Prefix</TableCell>
                <TableCell>Scopes</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Last used</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {keys.map((apiKey) => (
                <KeyRow key={apiKey.id} apiKey={apiKey} onRevoke={setRevokeTarget} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <CreateApiKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      <ApiKeyCreatedDialog result={created} onClose={() => setCreated(null)} />

      <Dialog open={revokeTarget != null} onClose={() => (revoking ? undefined : setRevokeTarget(null))}>
        <DialogTitle>Revoke API key?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Revoking <strong>{revokeTarget?.name}</strong> immediately stops it authenticating any
            request. Anything using it will start getting 401s. This can&apos;t be undone.
          </DialogContentText>
          {revokeError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {revokeError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={revoking}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleConfirmRevoke()}
            disabled={revoking}
          >
            {revoking ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast != null}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
