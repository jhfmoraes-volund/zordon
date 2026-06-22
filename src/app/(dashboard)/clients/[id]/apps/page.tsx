"use client";

import { ClientAppsDesktop } from "@/components/clients/client-apps-desktop";
import { useClientContext } from "../_context/client-context";

export default function ClientAppsPage() {
  const { clientId } = useClientContext();
  return <ClientAppsDesktop clientId={clientId} />;
}
