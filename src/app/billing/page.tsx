"use client";

import ProtectedShell from "@/components/ProtectedShell";
import Billing from "@/components/Billing";

export default function BillingPage() {
  return (
    <ProtectedShell>
      <Billing />
    </ProtectedShell>
  );
}
