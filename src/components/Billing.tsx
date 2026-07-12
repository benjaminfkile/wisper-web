"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
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
import RefreshIcon from "@mui/icons-material/Refresh";
import { wisper, WisperError } from "@/lib/wisper/client";
import { formatDateTime, formatSignedUsd, formatUsd } from "@/lib/format";
import TopUpDialog from "./TopUpDialog";
import type { Billing as BillingSummary, Transaction } from "@/lib/wisper/types";

interface BillingProps {
  /** Page size for the transactions ledger. */
  pageSize?: number;
}

/** A large labelled money metric (balance, usage totals). */
function Metric({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 160, flex: "1 1 160px" }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography
        variant="h5"
        component="div"
        color={emphasize ? "primary.main" : "text.primary"}
        sx={{ fontVariantNumeric: "tabular-nums", mt: 0.5 }}
      >
        {value}
      </Typography>
    </Paper>
  );
}

/**
 * The billing page: wallet balance and usage summary (GET /v1/billing), a Stripe
 * top-up flow (`TopUpDialog`), and a paginated ledger (GET /v1/billing/transactions
 * with a `limit`/`cursor`, loaded incrementally via "Load more").
 */
export default function Billing({ pageSize = 20 }: BillingProps) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [txns, setTxns] = useState<Transaction[] | null>(null);
  const [txnError, setTxnError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      setSummary(await wisper.getBilling());
      setSummaryError(null);
    } catch (err) {
      setSummaryError(err instanceof WisperError ? err.message : "Failed to load wallet.");
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  // Load (or reload from the start) the transactions ledger.
  const loadFirstPage = useCallback(async () => {
    setTxns(null);
    setCursor(undefined);
    try {
      const page = await wisper.getTransactions({ limit: pageSize });
      setTxns(page.transactions);
      setCursor(page.next_cursor);
      setTxnError(null);
    } catch (err) {
      setTxns([]);
      setTxnError(err instanceof WisperError ? err.message : "Failed to load transactions.");
    }
  }, [pageSize]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await wisper.getTransactions({ limit: pageSize, cursor });
      setTxns((prev) => [...(prev ?? []), ...page.transactions]);
      setCursor(page.next_cursor);
      setTxnError(null);
    } catch (err) {
      setTxnError(err instanceof WisperError ? err.message : "Failed to load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, pageSize]);

  const refresh = useCallback(() => {
    void loadSummary();
    void loadFirstPage();
  }, [loadSummary, loadFirstPage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleTopUpSuccess() {
    setTopUpOpen(false);
    setToast("Payment received — updating your wallet…");
    refresh();
  }

  const usageMetrics: { label: string; value: string }[] = [];
  if (summary?.spent_micro_usd != null) {
    usageMetrics.push({ label: "Spent", value: formatUsd(summary.spent_micro_usd) });
  }
  if (summary?.topped_up_micro_usd != null) {
    usageMetrics.push({ label: "Topped up", value: formatUsd(summary.topped_up_micro_usd) });
  }
  if (summary?.pending_micro_usd != null) {
    usageMetrics.push({ label: "Pending", value: formatUsd(summary.pending_micro_usd) });
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4" component="h1">
            Billing
          </Typography>
          <Typography color="text.secondary">Your wallet, top-ups, and transactions.</Typography>
        </Box>
        <Tooltip title="Refresh">
          <span>
            <IconButton
              onClick={refresh}
              disabled={loadingSummary}
              aria-label="refresh billing"
            >
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTopUpOpen(true)}>
          Add funds
        </Button>
      </Stack>

      {summaryError && <Alert severity="error">{summaryError}</Alert>}

      {summary == null && loadingSummary ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : summary != null ? (
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          <Metric
            label={`Wallet balance (${summary.currency})`}
            value={formatUsd(summary.balance_micro_usd)}
            emphasize
          />
          {usageMetrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} />
          ))}
        </Stack>
      ) : null}

      <Box>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Transactions
        </Typography>

        {txnError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {txnError}
          </Alert>
        )}

        {txns == null ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : txns.length === 0 && !txnError ? (
          <Alert severity="info">No transactions yet.</Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {txns.map((t) => {
                  const credit = t.amount_micro_usd >= 0;
                  return (
                    <TableRow key={t.id} hover>
                      <TableCell>{formatDateTime(t.created_at)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={t.type} variant="outlined" />
                      </TableCell>
                      <TableCell sx={{ wordBreak: "break-word" }}>{t.description ?? "—"}</TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontVariantNumeric: "tabular-nums",
                          color: credit ? "success.main" : "error.main",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatSignedUsd(t.amount_micro_usd)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {cursor && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            <Button onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </Box>
        )}
      </Box>

      <TopUpDialog
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onSuccess={handleTopUpSuccess}
      />

      <Snackbar
        open={toast != null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
