"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import LogoutIcon from "@mui/icons-material/Logout";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import HealthBadge from "@/components/HealthBadge";
import { useAuth } from "@/lib/auth/AuthContext";
import type { Role } from "@/lib/wisper/types";

interface NavItem {
  label: string;
  href: string;
  /** When set, the item only shows for accounts holding this role. */
  role?: Role;
}

// Nav targets across the milestones. Routes are added as each feature lands; the
// shell renders them now so navigation is stable.
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Catalog", href: "/catalog" },
  { label: "Leases", href: "/leases" },
  { label: "Billing", href: "/billing" },
  { label: "Host", href: "/host", role: "host" },
];

function initialsOf(email?: string): string {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

/**
 * The authenticated app shell: an AppBar with brand, role-aware nav, the API
 * health chip, and an account menu (email, roles, sign out). Renders `children`
 * as the page body.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, hasRole, signOut } = useAuth();
  const pathname = usePathname();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const openMenu = (e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const closeMenu = () => setAnchorEl(null);

  const visibleNav = NAV_ITEMS.filter((item) => !item.role || hasRole(item.role));

  return (
    <Box sx={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography
            variant="h6"
            component={NextLink}
            href="/"
            sx={{ color: "primary.main", textDecoration: "none", fontWeight: 700, mr: 1 }}
          >
            Wisper
          </Typography>

          <Stack direction="row" spacing={0.5} sx={{ flexGrow: 1 }}>
            {visibleNav.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Button
                  key={item.href}
                  component={NextLink}
                  href={item.href}
                  size="small"
                  color={active ? "primary" : "inherit"}
                  sx={{ fontWeight: active ? 700 : 500 }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Stack>

          <HealthBadge />

          <IconButton onClick={openMenu} size="small" aria-label="account menu" sx={{ ml: 1 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main", color: "background.default", fontSize: 14 }}>
              {initialsOf(user?.email)}
            </Avatar>
          </IconButton>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={closeMenu}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <Box sx={{ px: 2, py: 1, maxWidth: 260 }}>
              <Typography variant="body2" noWrap>
                {user?.email ?? "Signed in"}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                {(user?.roles ?? []).map((role) => (
                  <Chip key={role} size="small" label={role} variant="outlined" />
                ))}
              </Stack>
            </Box>
            <Divider />
            <MenuItem
              component={NextLink}
              href="/account/api-keys"
              onClick={closeMenu}
              selected={pathname.startsWith("/account/api-keys")}
            >
              <ListItemIcon>
                <VpnKeyIcon fontSize="small" />
              </ListItemIcon>
              API keys
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                closeMenu();
                signOut();
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" component="main" sx={{ py: 4, flexGrow: 1 }}>
        {children}
      </Container>
    </Box>
  );
}
