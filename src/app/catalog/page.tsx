"use client";

import ProtectedShell from "@/components/ProtectedShell";
import CatalogBrowser from "@/components/CatalogBrowser";

export default function CatalogPage() {
  return (
    <ProtectedShell>
      <CatalogBrowser />
    </ProtectedShell>
  );
}
