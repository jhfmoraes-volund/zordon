// Edge Function: export-design-session
//
// POST { sessionId: string } → returns the design session as a JSON file
// (Content-Disposition: attachment). Manager+ only (pm/head-ops/ceo/cro).
// Logs every export to public."DesignSessionExportLog".

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MANAGER_ROLES = new Set(["pm", "head-ops", "ceo", "cro"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "export";
}

// Drop intermediate `_drafts` keys recursively. They're agent state, not
// content — leaving them in poisons the receiving LLM's context.
function stripDrafts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDrafts);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "_drafts") continue;
      out[k] = stripDrafts(v);
    }
    return out;
  }
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  const auth = req.headers.get("Authorization");
  if (!auth) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }

  // User-scoped client: RLS applies on every read.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }
  const user = userData.user;

  const role = (user.app_metadata as { role?: string } | null)?.role;
  if (!role || !MANAGER_ROLES.has(role)) {
    return new Response("Forbidden — manager role required", {
      status: 403,
      headers: cors,
    });
  }

  const body = await req.json().catch(() => ({}));
  const sessionId: unknown = body?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return new Response("Missing sessionId", { status: 400, headers: cors });
  }

  const { data: session, error: sessErr } = await userClient
    .from("DesignSession")
    .select(
      `id, title, type, status, currentStep, totalSteps, selectedSteps,
       createdBy, projectId, createdAt, updatedAt, scheduledAt,
       completedAt, actualDurationMin,
       project:Project(id, name)`,
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (sessErr) {
    return new Response(sessErr.message, { status: 500, headers: cors });
  }
  if (!session) {
    return new Response("Session not found", { status: 404, headers: cors });
  }

  const { data: rawSteps, error: stepsErr } = await userClient
    .from("DesignSessionStepData")
    .select("stepIndex, stepKey, data, updatedAt")
    .eq("sessionId", sessionId)
    .order("stepIndex", { ascending: true });

  if (stepsErr) {
    return new Response(stepsErr.message, { status: 500, headers: cors });
  }

  const steps = (rawSteps ?? []).map((s) => ({
    stepIndex: s.stepIndex,
    stepKey: s.stepKey,
    data: stripDrafts(s.data),
    updatedAt: s.updatedAt,
  }));

  const payload = {
    _meta: {
      format: "Perke design session export v1",
      exportedAt: new Date().toISOString(),
      instructions:
        "Each entry in 'steps' is one phase of the design session. The 'data' shape varies by 'stepKey'. Internal '_drafts' fields are stripped.",
    },
    project: session.project,
    session: {
      id: session.id,
      title: session.title,
      type: session.type,
      status: session.status,
      currentStep: session.currentStep,
      totalSteps: session.totalSteps,
      selectedSteps: session.selectedSteps,
      createdBy: session.createdBy,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      scheduledAt: session.scheduledAt,
      completedAt: session.completedAt,
      actualDurationMin: session.actualDurationMin,
    },
    steps,
  };

  const json = JSON.stringify(payload, null, 2);
  const byteSize = new TextEncoder().encode(json).length;

  // Resolve the Member id for the audit log (best-effort; userId is the
  // primary identity preserved even if Member is later deleted).
  const { data: member } = await userClient
    .from("Member")
    .select("id")
    .eq("userId", user.id)
    .maybeSingle();

  // Service-role client writes the audit row (no INSERT policy for users).
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error: logErr } = await adminClient
    .from("DesignSessionExportLog")
    .insert({
      sessionId: session.id,
      memberId: member?.id ?? null,
      userId: user.id,
      format: "json",
      stepCount: steps.length,
      byteSize,
    });
  if (logErr) {
    // Audit failure is fatal — we don't return data we couldn't log.
    return new Response(`Failed to record export: ${logErr.message}`, {
      status: 500,
      headers: cors,
    });
  }

  const projectName = (session.project as { name?: string } | null)?.name ?? "project";
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(projectName)}-${slugify(session.title)}-${date}.json`;

  return new Response(json, {
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
