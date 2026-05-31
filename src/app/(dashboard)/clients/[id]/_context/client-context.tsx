"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { showErrorToast } from "@/lib/optimistic/toast";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";
import type { Client } from "@/lib/supabase/types";

export type ClientMember = { id: string; name: string };

type ClientContextValue = {
  clientId: string;
  client: Client | null;
  members: ClientMember[];
  loading: boolean;
  notFound: boolean;
  canSeeInsights: boolean;
  refresh: () => Promise<void>;
  updateClient: (patch: Partial<Client>) => Promise<Client | null>;
  deleteClient: () => Promise<boolean>;
};

const ClientCtx = createContext<ClientContextValue | null>(null);

export function useClientContext(): ClientContextValue {
  const ctx = useContext(ClientCtx);
  if (!ctx) {
    throw new Error("useClientContext must be used inside <ClientProvider>");
  }
  return ctx;
}

type ProviderProps = {
  clientId: string;
  children: ReactNode;
};

export function ClientProvider({ clientId, children }: ProviderProps) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const { effectiveAccessLevel } = useAuth();
  const canSeeInsights = hasMinAccessLevel(effectiveAccessLevel, "manager");

  const [client, setClient] = useState<Client | null>(null);
  const [members, setMembers] = useState<ClientMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [clientRes, membersRes] = await Promise.all([
      supabase.from("Client").select("*").eq("id", clientId).maybeSingle(),
      supabase.from("Member").select("id, name").order("name"),
    ]);
    if (!clientRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setClient(clientRes.data as Client);
    setMembers((membersRes.data ?? []) as ClientMember[]);
    setLoading(false);
  }, [clientId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data loading pattern (mesmo do page.tsx original).
    void load();
  }, [load]);

  const updateClient = useCallback(
    async (patch: Partial<Client>): Promise<Client | null> => {
      if (!client) return null;
      try {
        const { data, error } = await supabase
          .from("Client")
          .update(patch)
          .eq("id", client.id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        const next = data as Client;
        setClient(next);
        return next;
      } catch (e) {
        showErrorToast(e, { label: "Falha ao salvar cliente" });
        return null;
      }
    },
    [client, supabase],
  );

  const deleteClient = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    const { error } = await supabase
      .from("Client")
      .delete()
      .eq("id", client.id);
    if (error) {
      showErrorToast(error, { label: "Falha ao remover cliente" });
      return false;
    }
    router.push("/clients");
    return true;
  }, [client, router, supabase]);

  const value = useMemo<ClientContextValue>(
    () => ({
      clientId,
      client,
      members,
      loading,
      notFound,
      canSeeInsights,
      refresh: load,
      updateClient,
      deleteClient,
    }),
    [
      clientId,
      client,
      members,
      loading,
      notFound,
      canSeeInsights,
      load,
      updateClient,
      deleteClient,
    ],
  );

  return <ClientCtx.Provider value={value}>{children}</ClientCtx.Provider>;
}
