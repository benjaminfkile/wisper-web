"use client";

import ProtectedShell from "@/components/ProtectedShell";
import HostTools from "@/components/HostTools";

export default function HostPage() {
  return (
    <ProtectedShell>
      <HostTools />
    </ProtectedShell>
  );
}
