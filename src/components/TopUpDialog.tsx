"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { wisper, WisperError } from "@/lib/wisper/client";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { formatUsd } from "@/lib/format";

const CENTS_PER_USD = 100;
/** Preset top-up amounts (USD) offered as quick-select chips-styled buttons. */
const PRESETS_USD = [10, 25, 50, 100];

interface TopUpDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after Stripe confirms the payment, so the parent can refresh. */
  onSuccess: () => void;
}

/**
 * The card-entry step, rendered inside `<Elements>` so it can use Stripe hooks.
 * Confirms the PaymentIntent client-side with `redirect: "if_required"`, keeping
 * the flow in-page for card payments while still supporting redirect methods.
 */
function PaymentForm({
  amountCents,
  onSuccess,
  onBack,
}: {
  amountCents: number;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message ?? "Payment could not be completed.");
        return;
      }
      const status = result.paymentIntent?.status;
      if (status === "succeeded" || status === "processing" || status === "requires_capture") {
        onSuccess();
        return;
      }
      setError(`Payment ${status ?? "was not completed"}.`);
    } catch {
      setError("Payment could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit} id="topup-payment-form">
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Adding {formatUsd(amountCents)} to your wallet.
        </Typography>
        <PaymentElement />
        {error && <Alert severity="error">{error}</Alert>}
        <DialogActions sx={{ px: 0 }}>
          <Button onClick={onBack} disabled={submitting}>
            Back
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!stripe || !elements || submitting}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {submitting ? "Processing…" : `Pay ${formatUsd(amountCents)}`}
          </Button>
        </DialogActions>
      </Stack>
    </Box>
  );
}

/**
 * Two-step wallet top-up: pick an amount, then pay with Stripe's Payment Element.
 * Step one POSTs /v1/billing/topup to mint a PaymentIntent client secret; step two
 * mounts `<Elements>` with that secret and confirms it in the browser.
 */
export default function TopUpDialog({ open, onClose, onSuccess }: TopUpDialogProps) {
  const [amount, setAmount] = useState("25");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = isStripeConfigured();
  const stripePromise = useMemo(() => getStripe(), []);

  const dollars = Number(amount);
  const amountValid = Number.isFinite(dollars) && dollars > 0;
  const amountCents = Math.round(dollars * CENTS_PER_USD);

  function reset() {
    setClientSecret(null);
    setCreating(false);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function startPayment() {
    if (!amountValid) return;
    setCreating(true);
    setError(null);
    try {
      const { client_secret } = await wisper.topup({ amount_cents: amountCents });
      setClientSecret(client_secret);
    } catch (err) {
      setError(err instanceof WisperError ? err.message : "Could not start the top-up.");
    } finally {
      setCreating(false);
    }
  }

  function handleSuccess() {
    reset();
    onSuccess();
  }

  const elementsOptions: StripeElementsOptions | null = clientSecret
    ? { clientSecret, appearance: { theme: "night" } }
    : null;

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Add funds</DialogTitle>
      <DialogContent dividers>
        {!configured ? (
          <Alert severity="warning">
            Payments are not configured. Set <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to
            enable top-ups.
          </Alert>
        ) : clientSecret && elementsOptions ? (
          <Elements stripe={stripePromise} options={elementsOptions}>
            <PaymentForm
              amountCents={amountCents}
              onSuccess={handleSuccess}
              onBack={reset}
            />
          </Elements>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Choose how much to add to your wallet.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              {PRESETS_USD.map((preset) => (
                <Button
                  key={preset}
                  size="small"
                  variant={dollars === preset ? "contained" : "outlined"}
                  onClick={() => setAmount(String(preset))}
                >
                  {formatUsd(preset * CENTS_PER_USD, 0)}
                </Button>
              ))}
            </Stack>
            <TextField
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              slotProps={{
                htmlInput: { min: 1, step: 1, "aria-label": "top-up amount in dollars" },
                input: {
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                },
              }}
              error={amount !== "" && !amountValid}
              helperText={amount !== "" && !amountValid ? "Enter an amount greater than $0." : " "}
              fullWidth
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      {!clientSecret && (
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void startPayment()}
            disabled={!configured || !amountValid || creating}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {creating ? "Starting…" : "Continue"}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
