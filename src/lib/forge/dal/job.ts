import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type ForgeJobStatus = "queued" | "claimed" | "running" | "done" | "failed" | "cancelled";

export type ForgeJobRow = Tables["ForgeJob"]["Row"] & { status: ForgeJobStatus };
export type ForgeJobInsert = Tables["ForgeJob"]["Insert"];
export type ForgeJobUpdate = Tables["ForgeJob"]["Update"];

// ─── CRUD: ForgeJob ───────────────────────────────────────────────────────────

export async function createJob(
  input: Omit<ForgeJobInsert, "id" | "createdAt" | "updatedAt">,
): Promise<ForgeJobRow> {
  const { data, error } = await db()
    .from("ForgeJob")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as ForgeJobRow;
}

export async function getJob(jobId: string): Promise<ForgeJobRow | null> {
  const { data, error } = await db()
    .from("ForgeJob")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as ForgeJobRow | null) ?? null;
}

export async function listJobsForOwner(ownerId: string): Promise<ForgeJobRow[]> {
  const { data, error } = await db()
    .from("ForgeJob")
    .select("*")
    .eq("ownerId", ownerId)
    .order("createdAt", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ForgeJobRow[];
}

/**
 * Atomic claim: picks the oldest queued job that the daemon can access.
 *
 * NOTE: Two-step (SELECT + UPDATE) — not fully atomic. For multi-daemon prod,
 * move to a Postgres function with FOR UPDATE SKIP LOCKED. See FDM-003.
 */
export async function claimNextJob(
  daemonId: string,
  daemonMemberId: string,
): Promise<ForgeJobRow | null> {
  const { data: candidates, error: selectError } = await db()
    .from("ForgeJob")
    .select("id")
    .eq("status", "queued")
    .or(`ownerId.eq.${daemonMemberId},assignToAnyone.eq.true`)
    .order("createdAt", { ascending: true })
    .limit(1);

  if (selectError) throw selectError;
  if (!candidates || candidates.length === 0) return null;

  const jobId = candidates[0].id;

  const { data, error: updateError } = await db()
    .from("ForgeJob")
    .update({
      status: "claimed",
      claimedBy: daemonId,
      claimedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (updateError) throw updateError;
  return (data as ForgeJobRow | null) ?? null;
}

export async function updateJobStatus(
  jobId: string,
  status: ForgeJobStatus,
  opts?: {
    runId?: string | null;
  },
): Promise<ForgeJobRow> {
  const patch: ForgeJobUpdate = { status };
  if (opts?.runId !== undefined) {
    patch.runId = opts.runId;
  }

  const { data, error } = await db()
    .from("ForgeJob")
    .update(patch)
    .eq("id", jobId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ForgeJobRow;
}

/**
 * Heartbeat: update heartbeatAt timestamp for a running job.
 * Only succeeds if status='running' AND claimedBy=daemonId (per AC4).
 */
export async function heartbeat(
  jobId: string,
  daemonId: string,
): Promise<ForgeJobRow | null> {
  const { data, error } = await db()
    .from("ForgeJob")
    .update({
      heartbeatAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "running")
    .eq("claimedBy", daemonId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as ForgeJobRow | null) ?? null;
}

/**
 * Cancel a job (only if status='queued').
 */
export async function cancelJob(jobId: string): Promise<ForgeJobRow> {
  const { data, error } = await db()
    .from("ForgeJob")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .single();
  if (error) throw error;
  return data as ForgeJobRow;
}
