"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { wisper, WisperError } from "@/lib/wisper/client";
import { execStream, tokenizeCommand, type ExecStreamEvent } from "@/lib/wisper/exec";
import { execCommandPlaceholder } from "@/lib/os";
import type { HostOs } from "@/lib/wisper/types";

interface LeaseExecProps {
  leaseId: string;
  /** OS of the lease, when known — tunes the command placeholder. */
  os?: HostOs;
  /** Whether exec is available (only for a running lease). */
  disabled?: boolean;
}

/** One line/segment of captured output, tagged by stream for styling. */
interface OutputSegment {
  stream: "stdout" | "stderr";
  text: string;
}

/**
 * Run a command inside a lease. Supports a synchronous run (`POST /exec`, one
 * request/response) and a streamed run (`POST /exec?stream=1`, consumed via
 * `fetch` + a `ReadableStream` reader — NOT `EventSource`). Output is rendered
 * monospace with stdout/stderr distinguished by color and auto-scrolled, and the
 * exit code is shown in a chip once the command finishes.
 */
export default function LeaseExec({ leaseId, os, disabled = false }: LeaseExecProps) {
  const [command, setCommand] = useState("");
  const [stdin, setStdin] = useState("");
  const [streaming, setStreaming] = useState(true);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<OutputSegment[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const outputRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to the newest output.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  // Cancel any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const append = (segment: OutputSegment) =>
    setOutput((prev) => [...prev, segment]);

  async function run() {
    const argv = tokenizeCommand(command);
    if (argv.length === 0) {
      setError("Enter a command to run.");
      return;
    }

    setRunning(true);
    setError(null);
    setExitCode(null);
    setOutput([]);
    const body = { command: argv, ...(stdin ? { stdin } : {}) };

    try {
      if (streaming) {
        const controller = new AbortController();
        abortRef.current = controller;
        await execStream(leaseId, body, {
          signal: controller.signal,
          onEvent: (event: ExecStreamEvent) => {
            switch (event.kind) {
              case "stdout":
                append({ stream: "stdout", text: event.text });
                break;
              case "stderr":
                append({ stream: "stderr", text: event.text });
                break;
              case "exit":
                setExitCode(event.code);
                break;
              case "error":
                setError(event.message);
                break;
            }
          },
        });
      } else {
        const result = await wisper.exec(leaseId, body);
        if (result.stdout) append({ stream: "stdout", text: result.stdout });
        if (result.stderr) append({ stream: "stderr", text: result.stderr });
        setExitCode(result.exit_code);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof WisperError ? err.message : "Failed to run command.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }

  if (disabled) {
    return (
      <Alert severity="info">
        Exec is available while the lease is running. Start or wait for the lease to become active.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <TextField
        label="Command"
        placeholder={execCommandPlaceholder(os)}
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !running) {
            e.preventDefault();
            void run();
          }
        }}
        fullWidth
        slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
      />
      <TextField
        label="Standard input (optional)"
        value={stdin}
        onChange={(e) => setStdin(e.target.value)}
        fullWidth
        multiline
        minRows={2}
        slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
      />

      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="contained" onClick={() => void run()} disabled={running}>
          {running ? "Running…" : "Run"}
        </Button>
        {running && streaming && (
          <Button color="inherit" onClick={cancel}>
            Cancel
          </Button>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)}
              disabled={running}
            />
          }
          label="Stream output"
        />
        <Box sx={{ flexGrow: 1 }} />
        {exitCode != null && (
          <Chip
            label={`exit ${exitCode}`}
            color={exitCode === 0 ? "success" : "error"}
            variant="outlined"
            aria-label={`exit code ${exitCode}`}
          />
        )}
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box
        ref={outputRef}
        aria-label="command output"
        sx={{
          height: 320,
          overflow: "auto",
          p: 1.5,
          borderRadius: 1,
          bgcolor: "#0b0e14",
          color: "grey.100",
          fontFamily: "monospace",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {output.length === 0 ? (
          <Typography
            variant="body2"
            sx={{ color: "grey.500", fontFamily: "monospace" }}
            component="span"
          >
            No output yet.
          </Typography>
        ) : (
          output.map((seg, i) => (
            <Box
              key={i}
              component="span"
              sx={{ color: seg.stream === "stderr" ? "error.light" : "grey.100" }}
            >
              {seg.text}
            </Box>
          ))
        )}
      </Box>
    </Stack>
  );
}
