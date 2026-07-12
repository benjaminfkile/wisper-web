"use client";

import ProtectedShell from "@/components/ProtectedShell";
import LeaseDetail from "@/components/LeaseDetail";

export default function LeaseDetailPage({ params }: { params: { id: string } }) {
  return (
    <ProtectedShell>
      <LeaseDetail leaseId={params.id} />
    </ProtectedShell>
  );
}
