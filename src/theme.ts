"use client";

import { createTheme } from "@mui/material/styles";

// Shared dark theme for the Wisper consumer/host app.
export const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0b0f14", paper: "#121821" },
    primary: { main: "#5ed1b4" },
    success: { main: "#43d17a" },
    error: { main: "#e5556e" },
    warning: { main: "#e0b341" },
  },
});
