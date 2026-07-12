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

type Mode = "signin" | "signup";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const { status, signIn, signUp, confirmSignUp, resendConfirmationCode } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

        {!configured && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Authentication is not configured. Set the <code>NEXT_PUBLIC_COGNITO_*</code> environment
            variables to enable sign-in.
          </Alert>
        )}

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
      </Paper>
    </Container>
  );
}
