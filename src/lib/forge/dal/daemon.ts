import { db } from "@/lib/db";

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

export async function registerDaemon(input: {
  daemonId: string;
  memberId: string | null;
  hostname: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db()
    .from("ForgeDaemon")
    .upsert(
      {
        daemonId: input.daemonId,
        memberId: input.memberId,
        hostname: input.hostname,
        startedAt: now,
        lastHeartbeatAt: now,
      },
      { onConflict: "daemonId" },
    );
  if (error) throw error;
}

export async function heartbeatDaemon(daemonId: string): Promise<void> {
  const { error } = await db()
    .from("ForgeDaemon")
    .update({ lastHeartbeatAt: new Date().toISOString() })
    .eq("daemonId", daemonId);
  if (error) throw error;
}

export async function countActiveDaemons(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const { count, error } = await db()
    .from("ForgeDaemon")
    .select("daemonId", { count: "exact", head: true })
    .gte("lastHeartbeatAt", cutoff);
  if (error) throw error;
  return count ?? 0;
}

export type ActiveDaemonRow = {
  daemonId: string;
  hostname: string | null;
  startedAt: string;
  lastHeartbeatAt: string;
};

export async function listActiveDaemons(): Promise<ActiveDaemonRow[]> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const { data, error } = await db()
    .from("ForgeDaemon")
    .select("daemonId, hostname, startedAt, lastHeartbeatAt")
    .gte("lastHeartbeatAt", cutoff)
    .order("startedAt", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ActiveDaemonRow[];
}

export async function unregisterDaemon(daemonId: string): Promise<void> {
  const { error } = await db()
    .from("ForgeDaemon")
    .delete()
    .eq("daemonId", daemonId);
  if (error) throw error;
}
