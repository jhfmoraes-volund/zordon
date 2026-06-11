import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { db } from "@/lib/db";
import { resolveWorkspacePath } from "@/lib/forge/paths";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[slug]/prepare-context
 *
 * Endpoint LEVE pro daemon mode — devolve FATOS vivos da sessão como JSON
 * estruturado (~1-2KB), não prompt prosa. Daemon usa pra montar um prompt
 * curto e identitário (~600 tokens) via chat-prompts.ts (repo zordon-daemon).
 *
 * Contraste com /prepare-turn (~20KB de prompt) que ainda serve o path
 * OpenRouter — single source of truth pra dados, mas estratégias diferentes
 * de injeção.
 *
 * Body:    { chatTurnId }
 * Returns: { agent, project, session?, pmReview?, decisions, openQuestions, prds, personas }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const body = (await req.json().catch(() => ({}))) as { chatTurnId?: string };
  if (!body.chatTurnId) {
    return NextResponse.json({ error: "chatTurnId required" }, { status: 400 });
  }

  const supabase = db();

  const { data: turn } = await supabase
    .from("ChatTurn")
    .select("threadId")
    .eq("id", body.chatTurnId)
    .maybeSingle();
  if (!turn) {
    return NextResponse.json({ error: "chat_turn_not_found" }, { status: 404 });
  }

  const { data: thread } = await supabase
    .from("ChatThread")
    .select("id, sessionId, channel, agentName")
    .eq("id", turn.threadId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  // Dispatch por slug — cada agente puxa contexto que importa pra ele.
  if (slug === "vitor") {
    return NextResponse.json(await buildVitorContext(thread));
  }
  if (slug === "vitoria") {
    return NextResponse.json(await buildVitoriaContext(thread));
  }
  if (slug === "alpha") {
    // Alpha (ops) roda global no daemon — contexto leve; o estado vivo
    // (sprint, tasks, alertas) o agente puxa via tools em runtime.
    return NextResponse.json({ agent: { slug: "alpha", name: "Alpha" } });
  }

  return NextResponse.json({ agent: { slug } });
}

// ─── Vitor: DS discovery ────────────────────────────────────────────────────

type ThreadRow = {
  id: string;
  sessionId: string | null;
  channel: string;
  agentName: string | null;
};

async function buildVitorContext(thread: ThreadRow) {
  const supabase = db();

  if (!thread.sessionId) {
    return {
      agent: { slug: "vitor", name: "Vitor" },
      session: null,
      project: null,
      decisions: [],
      openQuestions: [],
      prds: [],
      personas: [],
    };
  }

  const { data: session } = await supabase
    .from("DesignSession")
    .select(
      "id, title, type, currentStep, briefingSubPhase, projectId, selectedSteps",
    )
    .eq("id", thread.sessionId)
    .maybeSingle();

  if (!session) {
    return { agent: { slug: "vitor", name: "Vitor" } };
  }

  const projectPromise = session.projectId
    ? supabase
        .from("Project")
        .select("id, name, referenceKey, repoUrl")
        .eq("id", session.projectId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  // ContextSources anexados à DS (docs, transcripts, etc) via EntityLink
  const contextSourcesPromise = supabase
    .from("EntityLink")
    .select(
      `id, linkedAt, ContextSource:ContextSource!EntityLink_contextSourceId_fkey(id, kind, title, summary, externalUrl, capturedAt)`,
    )
    .eq("designSessionId", session.id)
    .not("contextSourceId", "is", null)
    .order("linkedAt", { ascending: false })
    .limit(20);

  // Decisões fixadas ativas — top 10, mais recentes primeiro
  const decisionsPromise = supabase
    .from("DesignDecision")
    .select("id, statement, rationale, createdAt")
    .eq("projectId", session.projectId)
    .eq("status", "active")
    .order("createdAt", { ascending: false })
    .limit(10);

  // Open questions pendentes — top 5
  const questionsPromise = supabase
    .from("DesignOpenQuestion")
    .select("id, question, blocksWhat")
    .eq("projectId", session.projectId)
    .neq("status", "resolved")
    .order("createdAt", { ascending: false })
    .limit(5);

  // PRDs do projeto — todos (geralmente <20). Pra modo informacional.
  const prdsPromise = supabase
    .from("ProductRequirement")
    .select("id, reference, title, status, oneLiner, designSessionId")
    .eq("projectId", session.projectId)
    .order("reference", { ascending: true });

  // Personas do projeto
  const personasPromise = supabase
    .from("ProjectPersona")
    .select("id, name, description")
    .eq("projectId", session.projectId)
    .order("createdAt", { ascending: true });

  const [
    { data: project },
    { data: decisions },
    { data: questions },
    { data: prds },
    { data: personas },
    { data: contextLinks },
  ] = await Promise.all([
    projectPromise,
    decisionsPromise,
    questionsPromise,
    prdsPromise,
    personasPromise,
    contextSourcesPromise,
  ]);

  // Workspace na Forja (se existe on disk). Resolve path determinístico via
  // referenceKey — só retorna se a pasta foi terraformada (1º run rodou).
  let workspacePath: string | null = null;
  if (project) {
    const candidate = resolveWorkspacePath({
      id: project.id,
      name: project.name,
      referenceKey: project.referenceKey,
    });
    if (existsSync(candidate)) workspacePath = candidate;
  }

  // Normaliza ContextSources (algumas vêm sem o objeto se RLS bater)
  const attachments = (contextLinks ?? [])
    .map((link) => {
      const cs = link.ContextSource as {
        id: string;
        kind: string;
        title: string;
        summary: string | null;
        externalUrl: string | null;
        capturedAt: string | null;
      } | null;
      if (!cs) return null;
      return {
        id: cs.id,
        kind: cs.kind,
        title: cs.title,
        summary: cs.summary,
        externalUrl: cs.externalUrl,
        capturedAt: cs.capturedAt,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    agent: { slug: "vitor", name: "Vitor" },
    project: project
      ? {
          id: project.id,
          name: project.name,
          referenceKey: project.referenceKey,
          repoUrl: project.repoUrl,
          workspacePath,
        }
      : null,
    session: {
      id: session.id,
      title: session.title,
      type: session.type,
      currentStep: session.currentStep,
      subPhase: session.briefingSubPhase,
    },
    decisions: (decisions ?? []).map((d) => ({
      id: d.id.slice(0, 8),
      statement: d.statement,
      rationale: d.rationale,
    })),
    openQuestions: (questions ?? []).map((q) => ({
      id: q.id.slice(0, 8),
      question: q.question,
      blocksWhat: q.blocksWhat,
    })),
    prds: (prds ?? []).map((p) => ({
      id: p.id,
      reference: p.reference,
      title: p.title,
      status: p.status,
      oneLiner: p.oneLiner,
    })),
    // Conta PRDs criados NESTA DS específica. Foundation mode dispara
    // quando session_prds === 0 (independente de quantos o projeto tem em
    // outras DS). Permite "Quick-Ask" virgem disparar foundation mesmo
    // se o projeto já tem outros PRDs de outras DSs.
    sessionPrdsCount: (prds ?? []).filter(
      (p) => p.designSessionId === session.id,
    ).length,
    personas: (personas ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
    attachments,
  };
}

// ─── Vitoria: PM Review / Planning ──────────────────────────────────────────

async function buildVitoriaContext(thread: ThreadRow) {
  const supabase = db();

  if (thread.channel === "pm_review" && thread.agentName) {
    const pmReviewId = thread.agentName;
    const { data: pm } = await supabase
      .from("PMReview")
      .select("id, referenceWeek, status, projectId, createdAt")
      .eq("id", pmReviewId)
      .maybeSingle();

    if (!pm) {
      return { agent: { slug: "vitoria", name: "Vitoria" } };
    }

    const [
      { data: project },
      { data: notes },
      { data: contextLinks },
    ] = await Promise.all([
      pm.projectId
        ? supabase
            .from("Project")
            .select("id, name, referenceKey")
            .eq("id", pm.projectId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("PMReviewNote")
        .select("id, content, kind, priority, stance, generatedAt")
        .eq("pmReviewId", pmReviewId)
        .eq("audience", "detail")
        .is("dismissedAt", null)
        .order("generatedAt", { ascending: false })
        .limit(10),
      supabase
        .from("EntityLink")
        .select(
          `id, linkedAt, ContextSource:ContextSource!EntityLink_contextSourceId_fkey(id, kind, title, summary, externalUrl, capturedAt)`,
        )
        .eq("pmReviewId", pmReviewId)
        .not("contextSourceId", "is", null)
        .order("linkedAt", { ascending: false })
        .limit(20),
    ]);

    const attachments = (contextLinks ?? [])
      .map((link) => {
        const cs = link.ContextSource as {
          id: string;
          kind: string;
          title: string;
          summary: string | null;
          externalUrl: string | null;
          capturedAt: string | null;
        } | null;
        if (!cs) return null;
        return {
          id: cs.id,
          kind: cs.kind,
          title: cs.title,
          summary: cs.summary,
          externalUrl: cs.externalUrl,
          capturedAt: cs.capturedAt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      agent: { slug: "vitoria", name: "Vitoria" },
      surface: "pm_review",
      pmReview: {
        id: pm.id,
        referenceWeek: pm.referenceWeek,
        status: pm.status,
      },
      project: project
        ? {
            id: project.id,
            name: project.name,
            referenceKey: project.referenceKey,
          }
        : null,
      notes: (notes ?? []).map((n) => ({
        id: n.id.slice(0, 8),
        kind: n.kind,
        stance: n.stance,
        content: n.content,
      })),
      attachments,
    };
  }

  return {
    agent: { slug: "vitoria", name: "Vitoria" },
    surface: thread.channel,
  };
}
