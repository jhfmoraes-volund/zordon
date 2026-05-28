import { createClient } from "@/lib/supabase/server";
import { ClientsTable, type Client } from "@/components/clients/clients-table";

// Auth resolvida no proxy.ts; busca inicial no servidor → zero render em cascata.
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("Client")
    .select("*, Project(count)")
    .order("createdAt", { ascending: false });

  return <ClientsTable initial={(data ?? []) as Client[]} />;
}
