"use client";

import ProtectedShell from "@/components/ProtectedShell";
import LeaseList from "@/components/LeaseList";

export default function LeasesPage() {
  return (
    <ProtectedShell>
      <LeaseList />
    </ProtectedShell>
  );
}
