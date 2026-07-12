"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ShellSocket, type ShellStatus } from "@/lib/wisper/shell";

interface LeaseConsoleProps {
  leaseId: string;
  /** Whether an interactive shell is available (only for a running lease). */
  disabled?: boolean;
}

type ChipColor = "default" | "success" | "warning" | "error" | "info";

const STATUS_META: Record<ShellStatus, { label: string; color: ChipColor }> = {
  idle: { label: "Idle", color: "default" },
  connecting: { label: "Connecting…", color: "info" },
  open: { label: "Connected", color: "success" },
  closed: { label: "Disconnected", color: "warning" },
  error: { label: "Error", color: "error" },
};

/**
 * Interactive console for a lease: a real xterm.js terminal bridged to the shell
 * WebSocket. On mount it mints a one-time ticket, opens the WS, and pipes binary
 * frames both ways; the terminal is fitted to its container and a
 * `{t:"resize",cols,rows}` control frame is sent on every fit/resize. A status
 * chip reflects the connection and a Reconnect button re-runs the handshake with
 * a fresh ticket.
 */
export default function LeaseConsole({ leaseId, disabled = false }: LeaseConsoleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ShellSocket | null>(null);

  const [status, setStatus] = useState<ShellStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Fit the terminal to its container, then report the new size to the server.
  const fitAndResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      // Container not laid out yet; ignore until the next observer tick.
    }
    socketRef.current?.resize(term.cols, term.rows);
  }, []);

  const connect = useCallback(() => {
    void socketRef.current?.connect().then(fitAndResize).catch(() => {
      // Status is reported via onStatus; nothing else to do here.
    });
  }, [fitAndResize]);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;

      const term = new XTerm({
        convertEol: true,
        cursorBlink: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        theme: { background: "#0b0e14" },
      });
      const fit = new Fit();
      term.loadAddon(fit);
      term.open(containerRef.current);

      const socket = new ShellSocket({
        leaseId,
        onData: (bytes) => term.write(bytes),
        onStatus: (next, msg) => {
          if (cancelled) return;
          setStatus(next);
          setDetail(msg ?? null);
        },
      });

      // Keystrokes -> server.
      term.onData((data) => socket.send(data));

      termRef.current = term;
      fitRef.current = fit;
      socketRef.current = socket;
      setReady(true);

      fitAndResize();
      observer = new ResizeObserver(() => fitAndResize());
      observer.observe(containerRef.current);

      void socket.connect().then(fitAndResize).catch(() => {
        // Reported via onStatus.
      });
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      socketRef.current?.close();
      socketRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [leaseId, disabled, fitAndResize]);

  if (disabled) {
    return (
      <Alert severity="info">
        The console is available while the lease is running. Start or wait for the lease to become
        active.
      </Alert>
    );
  }

  const meta = STATUS_META[status];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Chip
          size="small"
          label={meta.label}
          color={meta.color}
          variant={status === "open" ? "filled" : "outlined"}
          aria-label={`console ${meta.label}`}
        />
        {detail && (
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          onClick={connect}
          disabled={!ready || status === "connecting"}
        >
          {status === "open" ? "Reconnect" : "Connect"}
        </Button>
      </Stack>

      <Box
        ref={containerRef}
        aria-label="terminal"
        sx={{
          height: 420,
          p: 1,
          borderRadius: 1,
          bgcolor: "#0b0e14",
          overflow: "hidden",
          "& .xterm": { height: "100%" },
        }}
      />
    </Stack>
  );
}
