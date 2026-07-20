"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useAuth } from "@/lib/auth/AuthContext";
import { isAuthConfigured } from "@/lib/auth/cognito";
import { WisperError } from "@/lib/wisper/client";

type Mode = "signin" | "signup";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

/** Message for a failed API-key sign-in — a 401 means the key is bad/revoked. */
function apiKeyErrorMessage(err: unknown): string {
  if (err instanceof WisperError && err.status === 401) {
    return "Invalid or revoked API key.";
  }
  return errorMessage(err);
}

export default function LoginPage() {
  const { status, signIn, signInWithApiKey, signUp, confirmSignUp, resendConfirmationCode } =
    useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Local-dev fallback: a pasted wisper-api API key when Cognito is unconfigured.
  const [apiKey, setApiKey] = useState("");
  // Present once a sign-up needs email confirmation.
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const configured = isAuthConfigured();

  // Already signed in (e.g. restored session): bounce to the app.
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setNeedsConfirm(false);
    setCode("");
  };

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onApiKeySignIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithApiKey(apiKey);
      router.replace("/");
    } catch (err) {
      // signInWithApiKey already cleared the held key on failure.
      setError(apiKeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onSignUp = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { userConfirmed } = await signUp(email, password);
      if (userConfirmed) {
        // Auto-confirmed pools: sign straight in.
        await signIn(email, password);
        router.replace("/");
      } else {
        setNeedsConfirm(true);
        setInfo("We emailed you a confirmation code. Enter it below to finish signing up.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await confirmSignUp(email, code);
      await signIn(email, password);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setError(null);
    try {
      await resendConfirmationCode(email);
      setInfo("A new confirmation code is on its way.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (status === "loading" || status === "authenticated") {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xs" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", py: 6 }}>
      <Paper sx={{ p: 4, width: "100%" }} elevation={0} variant="outlined">
        <Typography variant="h4" sx={{ color: "primary.main", fontWeight: 700, mb: 0.5 }}>
          Wisper
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Rent ephemeral, root-access containers by the minute — or host your own.
        </Typography>

        {!configured ? (
          <Box component="form" onSubmit={onApiKeySignIn}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Cognito isn&apos;t configured, so sign in with a wisper-api API key. Paste a key defined
              in the operator&apos;s <code>Auth:ApiKeys</code> configuration — see the wisper-api
              README, &ldquo;Local development against wisper-api&rdquo;.
            </Alert>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <Stack spacing={2}>
              <TextField
                label="API key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                autoFocus
                fullWidth
                placeholder="wck_live_…"
                autoComplete="off"
              />
              <Button type="submit" variant="contained" disabled={busy} fullWidth>
                {busy ? "Signing in…" : "Sign in with API key"}
              </Button>
            </Stack>
          </Box>
        ) : (
          <>
            <Tabs
              value={mode}
              onChange={(_, v: Mode) => switchMode(v)}
              variant="fullWidth"
              sx={{ mb: 3 }}
            >
              <Tab value="signin" label="Sign in" />
              <Tab value="signup" label="Sign up" />
            </Tabs>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            {info && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {info}
              </Alert>
            )}

            {needsConfirm ? (
          <Box component="form" onSubmit={onConfirm}>
            <Stack spacing={2}>
              <TextField
                label="Confirmation code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                fullWidth
              />
              <Button type="submit" variant="contained" disabled={busy} fullWidth>
                {busy ? "Confirming…" : "Confirm and continue"}
              </Button>
              <Link component="button" type="button" onClick={onResend} underline="hover">
                Resend code
              </Link>
            </Stack>
          </Box>
        ) : (
          <Box component="form" onSubmit={mode === "signin" ? onSignIn : onSignUp}>
            <Stack spacing={2}>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                fullWidth
              />
              <Button type="submit" variant="contained" disabled={busy || !configured} fullWidth>
                {busy
                  ? mode === "signin"
                    ? "Signing in…"
                    : "Creating account…"
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </Stack>
          </Box>
            )}
          </>
        )}
      </Paper>
    </Container>
  );
}
