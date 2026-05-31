"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Play, AlertTriangle } from "lucide-react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function ActiveBuilders() {
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Initial fetch + realtime subscription
  useEffect(() => {
    const fetchActiveBuilders = async () => {
      try {
        const res = await fetch("/api/forge/active-builders");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setActiveCount(data.count ?? 0);
      } catch (error) {
        console.error("Failed to fetch active builders:", error);
        setActiveCount(0);
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchActiveBuilders();

    // Set up realtime subscription
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fetchActiveBuilders();
      }, 500);
    };

    const channel = client
      .channel("active-builders")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ForgeJob",
        },
        debouncedReload,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Play className="size-4 animate-pulse" />
        <span>Verificando builders...</span>
      </div>
    );
  }

  const count = activeCount ?? 0;

  if (count === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Nenhum builder ativo
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
            Abra <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/50">forge daemon</code> em algum PC para executar jobs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Play className="size-4 text-green-600 dark:text-green-400" />
      <span className="font-medium">
        Builders ativos: <span className="text-green-600 dark:text-green-400">{count}</span>
      </span>
    </div>
  );
}
