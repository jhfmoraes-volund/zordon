import { db } from "@/lib/db";

/**
 * Verbosity level controls how much of each step is rendered into the system
 * prompt. Tuned per sub-phase to keep the prompt cacheable and compact:
 *
 *   - "full"           — everything. Used in pre_work, debugging.
 *   - "discovery"      — brainstorm full + prioritization full + hypotheses (trim)
 *                        + tech specs. Used in module_discovery.
 *   - "refinement"     — MVP cards compact (title+howItSolves+targetPersona+
 *                        painPointRef), no `next`/`out`, no hypotheses, no
 *                        tech specs. Used in story_tree.
 *   - "execution"      — zero brainstorm / prioritization / hypotheses. Only
 *                        vision + scope + personas + tech specs. Used in
 *                        story_detail, task_breakdown.
 *   - "compact-vision" — Used em steps pos-brainstorm (hypotheses, technical_specs,
 *                        risks_gaps) quando o brainstorm/priorizacao ja foram
 *                        feitos. Renderiza brainstorm/priorizacao compact (sem
 *                        keyScreens/userFlows/technicalNotes) — agente puxa o
 *                        detalhe via read_brainstorm({ ids, fields }) sob demanda.
 */
export type SessionContextVerbosity =
  | "full"
  | "discovery"
  | "refinement"
  | "execution"
  | "compact-vision";

interface BrainstormCard {
  id?: string;
  title: string;
  howItSolves: string;
  targetPersona?: string;
  keyScreens?: string;
  userFlows?: string;
  painPointRef?: string;
  technicalNotes?: string;
}

interface PrioritizationItem {
  id?: string;
  title: string;
  bucket: string;
  targetPersona?: string;
  howItSolves?: string;
  keyScreens?: string;
  userFlows?: string;
  painPointRef?: string;
  technicalNotes?: string;
}

function renderCardFull(c: BrainstormCard | PrioritizationItem): string {
  const idSuffix = c.id ? ` <!-- bs#${c.id} -->` : "";
  const parts = [`- **${c.title}**${idSuffix}`];
  if (c.targetPersona) parts.push(`  - Persona: ${c.targetPersona}`);
  if (c.howItSolves) parts.push(`  - Como resolve: ${c.howItSolves}`);
  if (c.keyScreens) parts.push(`  - Telas: ${c.keyScreens}`);
  if (c.userFlows) parts.push(`  - Fluxos: ${c.userFlows}`);
  if (c.painPointRef) parts.push(`  - Dor que resolve: ${c.painPointRef}`);
  if (c.technicalNotes) parts.push(`  - Técnico: ${c.technicalNotes}`);
  return parts.join("\n");
}

function renderCardCompact(c: BrainstormCard | PrioritizationItem): string {
  const idSuffix = c.id ? ` <!-- bs#${c.id} -->` : "";
  const parts = [`- **${c.title}**${idSuffix}`];
  if (c.targetPersona) parts.push(`  - Persona: ${c.targetPersona}`);
  if (c.howItSolves) parts.push(`  - Como resolve: ${c.howItSolves}`);
  if (c.painPointRef) parts.push(`  - Dor: ${c.painPointRef}`);
  return parts.join("\n");
}

export async function buildSessionContext(
  sessionId: string,
  verbosity: SessionContextVerbosity = "full",
): Promise<string> {
  const { data: session } = await db()
    .from("DesignSession")
    .select("*, project:Project(name, id)")
    .eq("id", sessionId)
    .single();

  if (!session) throw new Error("Session not found");

  // Pull every normalized table in parallel. Older sessions that haven't been
  // touched since the normalization migration will still have rows here — the
  // backfill in 20260513_design_session_normalization.sql moved everything.
  const [
    productVisionResp,
    scopeResp,
    personasResp,
    brainstormResp,
    priorityResp,
    techSpecsResp,
    hypothesesResp,
  ] = await Promise.all([
    db().from("DesignSessionProductVision").select("*").eq("sessionId", sessionId).maybeSingle(),
    db().from("DesignSessionScope").select("*").eq("sessionId", sessionId).maybeSingle(),
    db()
      .from("DesignSessionPersona")
      .select("*")
      .eq("sessionId", sessionId)
      .order("orderIndex", { ascending: true }),
    db()
      .from("DesignSessionBrainstormFeature")
      .select("*")
      .eq("sessionId", sessionId)
      .order("orderIndex", { ascending: true }),
    db()
      .from("DesignSessionPriorityItem")
      .select("*")
      .eq("sessionId", sessionId)
      .order("orderIndex", { ascending: true }),
    db().from("DesignSessionTechnicalSpecs").select("*").eq("sessionId", sessionId).maybeSingle(),
    db()
      .from("DesignSessionHypothesis")
      .select("*")
      .eq("sessionId", sessionId)
      .order("orderIndex", { ascending: true }),
  ]);

  const sections: string[] = [];

  // Product Vision — always included (cheap, anchors everything else)
  const vision = productVisionResp.data;
  if (vision) {
    sections.push(`## Visão do Produto
- **Problema:** ${vision.problem || "N/A"}
- **Quem sofre:** ${vision.whoSuffers || "N/A"}
- **Consequências:** ${vision.consequences || "N/A"}
- **Visão de sucesso:** ${vision.successVision || "N/A"}
- **Métricas de impacto:** ${vision.impactMetrics || "N/A"}`);
  }

  // Scope Definition — always included (small, defines fronteira)
  const scope = scopeResp.data as
    | {
        inScope?: Array<{ text: string }>;
        outOfScope?: Array<{ text: string }>;
        does?: Array<{ text: string }>;
        doesNot?: Array<{ text: string }>;
      }
    | null;
  if (
    scope &&
    (scope.inScope?.length || scope.outOfScope?.length || scope.does?.length || scope.doesNot?.length)
  ) {
    const fmt = (items?: Array<{ text: string }>) =>
      items?.length ? items.map((i) => `  - ${i.text}`).join("\n") : "  Nenhum";
    sections.push(`## Escopo & Fronteiras (E / NAO E / FAZ / NAO FAZ)
**E (identidade):**
${fmt(scope.inScope)}
**NAO E (mal-entendidos a evitar):**
${fmt(scope.outOfScope)}
**FAZ (capacidades):**
${fmt(scope.does)}
**NAO FAZ (fora do escopo, evitar gerar tasks pra isso):**
${fmt(scope.doesNot)}`);
  }

  // Personas & Journeys — always included (anchors stories regardless of phase)
  const personas = (personasResp.data ?? []) as unknown as Array<{
    name: string;
    role: string;
    context: string;
    asIsSteps?: Array<{ description: string; painOrGain: string }>;
    toBeSteps?: Array<{ description: string; painOrGain: string }>;
  }>;
  if (personas.length) {
    const wantsJourneys = verbosity === "full" || verbosity === "discovery";
    const personaTexts = personas.map((p) => {
      if (!wantsJourneys) {
        return `### ${p.name} (${p.role})\n${p.context}`;
      }
      const pains = p.asIsSteps?.map((s) => `  - ${s.description} (dor: ${s.painOrGain})`).join("\n") || "  Nenhum";
      const gains = p.toBeSteps?.map((s) => `  - ${s.description} (ganho: ${s.painOrGain})`).join("\n") || "  Nenhum";
      return `### ${p.name} (${p.role})
${p.context}
**Jornada atual (dores):**
${pains}
**Jornada desejada (ganhos):**
${gains}`;
    });
    sections.push(`## Personas & Jornadas\n${personaTexts.join("\n\n")}`);
  }

  // Brainstorm — heaviest section. Drop entirely in execution; compact in
  // refinement (MVP-bound cards already live in prioritization); compact em
  // compact-vision (steps pos-brainstorm); full elsewhere.
  const brainstormFeatures = (brainstormResp.data ?? []).filter(
    (f) => !f.archived,
  ) as BrainstormCard[];
  if (brainstormFeatures.length) {
    if (verbosity === "full" || verbosity === "discovery") {
      const text = brainstormFeatures.map(renderCardFull).join("\n\n");
      sections.push(`## Soluções Levantadas\n${text}`);
    } else if (verbosity === "compact-vision") {
      const text = brainstormFeatures.map(renderCardCompact).join("\n\n");
      sections.push(`## Soluções Levantadas (compact — use read_brainstorm({ ids, fields }) pra detalhes)\n${text}`);
    }
    // refinement & execution: skip raw brainstorm — refinement reads via
    // prioritization (MVP-only), execution doesn't need brainstorm at all.
  }

  // Prioritization — drives story_tree filtering. In refinement we keep ONLY
  // MVP and render compact. Execution skips entirely. compact-vision: full
  // 3 buckets em compact.
  const priorityItems = (priorityResp.data ?? []) as PrioritizationItem[];
  if (priorityItems.length && verbosity !== "execution") {
    const buckets: Record<string, string[]> = { mvp: [], next: [], out: [] };
    const useCompact = verbosity === "refinement" || verbosity === "compact-vision";
    for (const item of priorityItems) {
      const renderer = useCompact ? renderCardCompact : renderCardFull;
      (buckets[item.bucket] || []).push(renderer(item));
    }
    if (verbosity === "refinement") {
      sections.push(`## Priorização — MVP (única lista relevante para esta fase)
${buckets.mvp.join("\n\n") || "Nenhum"}`);
    } else {
      sections.push(`## Priorização
### MVP (fazer agora)
${buckets.mvp.join("\n\n") || "Nenhum"}

### Próximo (depois do MVP)
${buckets.next.join("\n\n") || "Nenhum"}

### Fora do escopo
${buckets.out.join("\n\n") || "Nenhum"}`);
    }
  }

  // Technical Specs — needed in execution (task_breakdown reads stack/rules)
  // and discovery; skip in refinement (story_tree foca em produto, não técnico).
  const techSpecs = techSpecsResp.data as
    | {
        stack?: string;
        integrations?: Array<{ text: string }>;
        rules?: Array<{ text: string }>;
        performance?: string;
      }
    | null;
  if (techSpecs && verbosity !== "refinement") {
    const parts = [];
    if (techSpecs.stack) parts.push(`**Stack:** ${techSpecs.stack}`);
    if (techSpecs.integrations?.length) {
      parts.push(`**Integrações:** ${techSpecs.integrations.map((i) => i.text).join(", ")}`);
    }
    if (techSpecs.rules?.length) {
      parts.push(`**Regras técnicas:** ${techSpecs.rules.map((r) => r.text).join(", ")}`);
    }
    if (techSpecs.performance) parts.push(`**Performance:** ${techSpecs.performance}`);
    if (parts.length) sections.push(`## Especificações Técnicas\n${parts.join("\n")}`);
  }

  // Hypotheses — only in full/discovery. Refinement & execution descartam.
  const hypotheses = (hypothesesResp.data ?? []) as Array<{
    hypothesis: string;
    indicator: string;
    target: string;
    expectedResult: string;
    evidence: string | null;
  }>;
  if (hypotheses.length && (verbosity === "full" || verbosity === "discovery")) {
    const hTexts = hypotheses
      .map((h, i) => {
        const parts = [`### Hipótese ${i + 1}: ${h.hypothesis}`];
        if (h.indicator) parts.push(`- **Indicador:** ${h.indicator}`);
        if (h.target) parts.push(`- **Meta:** ${h.target}`);
        if (h.expectedResult) parts.push(`- **Resultado esperado:** ${h.expectedResult}`);
        if (h.evidence) parts.push(`- **Evidência:** ${h.evidence}`);
        return parts.join("\n");
      })
      .join("\n\n");
    sections.push(`## Hipóteses & Métricas de Validação\n${hTexts}`);
  }

  return sections.join("\n\n---\n\n");
}
