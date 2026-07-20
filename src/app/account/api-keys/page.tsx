"use client";

import ProtectedShell from "@/components/ProtectedShell";
import ApiKeys from "@/components/ApiKeys";

export default function ApiKeysPage() {
  return (
    <ProtectedShell>
      <ApiKeys />
    </ProtectedShell>
  );
}
