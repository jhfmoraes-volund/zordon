import "server-only";
import { db } from "@/lib/db";
import { createPrd } from "@/lib/dal/product-requirements";
import { parsePrdMarkdown, type ParsedPrd } from "./parser";
import type { Database } from "@/lib/supabase/database.types";
import crypto from "crypto";

type Tables = Database["public"]["Tables"];
type DesignSessionInsert = Tables["DesignSession"]["Insert"];
type DesignSessionRow = Tables["DesignSession"]["Row"];

export type PrdSessionFile = {
  filename: string;
  content: string;
};

export type CreatePrdSessionResult = {
  sessionId: string;
  prds: Array<{
    id: string;
    reference: string;
    title: string;
    warnings: string[];
  }>;
};

/**
 * Cria uma PRD Session do tipo 'upload', parseia os markdowns, e cria
 * ProductRequirement rows (status=draft). Idempotente via description hash.
 */
export async function createPrdSessionUpload(args: {
  projectId: string;
  files: PrdSessionFile[];
  actorMemberId: string;
}): Promise<CreatePrdSessionResult> {
  const { projectId, files, actorMemberId } = args;
  const supabase = db();

  // Calcula hash SHA256 do payload pra idempotência
  const payload = JSON.stringify({ projectId, files });
  const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");

  // Verifica se já existe session com esse hash (stored in description)
  const { data: existing } = await supabase
    .from("DesignSession")
    .select("id")
    .eq("projectId", projectId)
    .eq("type", "prd_session")
    .eq("subKind", "upload")
    .eq("description", payloadHash)
    .maybeSingle();

  if (existing) {
    // Retorna session existente (idempotente)
    const { data: prds } = await supabase
      .from("ProductRequirement")
      .select("id, reference, title, technicalNotes")
      .eq("projectId", projectId)
      .eq("designSessionId", existing.id)
      .order("createdAt", { ascending: true });

    return {
      sessionId: existing.id,
      prds:
        prds?.map((p) => {
          // Parse warnings from technicalNotes if present
          let warnings: string[] = [];
          try {
            const notes = p.technicalNotes;
            if (notes && notes.startsWith("WARNINGS:")) {
              warnings = JSON.parse(notes.slice(9));
            }
          } catch {
            // Ignore parse errors
          }
          return {
            id: p.id,
            reference: p.reference,
            title: p.title,
            warnings,
          };
        }) ?? [],
    };
  }

  // Cria nova session
  const sessionId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const sessionInsert: DesignSessionInsert = {
    id: sessionId,
    projectId,
    type: "prd_session",
    subKind: "upload",
    title: `PRD Upload — ${files.length} arquivo${files.length > 1 ? "s" : ""}`,
    status: "completed",
    currentStep: 0,
    totalSteps: 0,
    createdBy: actorMemberId,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: nowIso,
    description: payloadHash, // Store hash for idempotency
  };

  const { error: sessionErr } = await supabase
    .from("DesignSession")
    .insert(sessionInsert);
  if (sessionErr) throw sessionErr;

  // Parseia e cria PRDs
  const createdPrds: Array<{
    id: string;
    reference: string;
    title: string;
    warnings: string[];
  }> = [];

  for (const file of files) {
    const parsed = parsePrdMarkdown(file.content);

    const prd = await createPrd({
      projectId,
      designSessionId: sessionId,
      title: parsed.title,
      problem: parsed.problem ?? "",
      goal: parsed.oneLiner ?? "",
      acceptanceCriteria: parsed.acceptanceCriteria as unknown as Database["public"]["Tables"]["ProductRequirement"]["Insert"]["acceptanceCriteria"],
      status: "draft",
      technicalNotes:
        parsed.warnings.length > 0
          ? `WARNINGS:${JSON.stringify(parsed.warnings)}`
          : "",
      actorAgent: "system",
      actorMemberId,
    });

    createdPrds.push({
      id: prd.id,
      reference: prd.reference,
      title: prd.title,
      warnings: parsed.warnings,
    });
  }

  return {
    sessionId,
    prds: createdPrds,
  };
}
