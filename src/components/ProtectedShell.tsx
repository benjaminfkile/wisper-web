"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useAuth } from "@/lib/auth/AuthContext";
import AppShell from "@/components/AppShell";

/** Full-viewport centered spinner shown while the session is being resolved. */
function FullScreenLoader() {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

/**
 * Gate for authenticated pages. Shows a loader while the session resolves,
 * redirects to `/login` when unauthenticated, and otherwise renders the app
 * shell around `children`.
 */
export default function ProtectedShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") return <FullScreenLoader />;

  return <AppShell>{children}</AppShell>;
}
