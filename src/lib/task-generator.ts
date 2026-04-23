import { db } from "@/lib/db";

/**
 * Loads all step data from a Design Session and formats it for the prompt.
 */
export async function buildSessionContext(sessionId: string): Promise<string> {
  const { data: session } = await db()
    .from("DesignSession")
    .select("*, project:Project(name, id), stepData:DesignSessionStepData(*)")
    .eq("id", sessionId)
    .single();

  if (!session) throw new Error("Session not found");

  const stepMap: Record<string, unknown> = {};
  for (const step of session.stepData) {
    stepMap[step.stepKey] = step.data;
  }

  const sections: string[] = [];

  // Product Vision
  const vision = stepMap["product_vision"] as Record<string, string> | undefined;
  if (vision) {
    sections.push(`## Visão do Produto
- **Problema:** ${vision.problem || "N/A"}
- **Quem sofre:** ${vision.whoSuffers || "N/A"}
- **Consequências:** ${vision.consequences || "N/A"}
- **Visão de sucesso:** ${vision.successVision || "N/A"}
- **Métricas de impacto:** ${vision.impactMetrics || "N/A"}`);
  }

  // Personas & Journeys
  const personas = stepMap["personas_journeys"] as { personas?: Array<{ name: string; role: string; context: string; asIsSteps?: Array<{ description: string; painOrGain: string }>; toBeSteps?: Array<{ description: string; painOrGain: string }> }> } | undefined;
  if (personas?.personas?.length) {
    const personaTexts = personas.personas.map((p) => {
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

  // Brainstorm Solutions
  const brainstorm = stepMap["brainstorm"] as { solutions?: Array<{ title: string; howItSolves: string; targetPersona?: string; keyScreens?: string; userFlows?: string; painPointRef?: string; technicalNotes?: string }> } | undefined;
  if (brainstorm?.solutions?.length) {
    const solTexts = brainstorm.solutions.map((s) => {
      const parts = [`- **${s.title}**`];
      if (s.targetPersona) parts.push(`  - Persona: ${s.targetPersona}`);
      if (s.howItSolves) parts.push(`  - Como resolve: ${s.howItSolves}`);
      if (s.keyScreens) parts.push(`  - Telas: ${s.keyScreens}`);
      if (s.userFlows) parts.push(`  - Fluxos: ${s.userFlows}`);
      if (s.painPointRef) parts.push(`  - Dor que resolve: ${s.painPointRef}`);
      if (s.technicalNotes) parts.push(`  - Técnico: ${s.technicalNotes}`);
      return parts.join("\n");
    }).join("\n\n");
    sections.push(`## Soluções Levantadas\n${solTexts}`);
  }

  // Prioritization
  const prioritization = stepMap["prioritization"] as { items?: Array<{ title: string; bucket: string; targetPersona?: string; howItSolves?: string; keyScreens?: string; userFlows?: string; painPointRef?: string; technicalNotes?: string }> } | undefined;
  if (prioritization?.items?.length) {
    const buckets: Record<string, string[]> = { mvp: [], next: [], out: [] };
    for (const item of prioritization.items) {
      const parts = [`- **${item.title}**`];
      if (item.targetPersona) parts.push(`  - Persona: ${item.targetPersona}`);
      if (item.howItSolves) parts.push(`  - Como resolve: ${item.howItSolves}`);
      if (item.keyScreens) parts.push(`  - Telas: ${item.keyScreens}`);
      if (item.userFlows) parts.push(`  - Fluxos: ${item.userFlows}`);
      if (item.painPointRef) parts.push(`  - Dor que resolve: ${item.painPointRef}`);
      if (item.technicalNotes) parts.push(`  - Técnico: ${item.technicalNotes}`);
      (buckets[item.bucket] || []).push(parts.join("\n"));
    }
    sections.push(`## Priorização
### MVP (fazer agora)
${buckets.mvp.join("\n\n") || "Nenhum"}

### Próximo (depois do MVP)
${buckets.next.join("\n\n") || "Nenhum"}

### Fora do escopo
${buckets.out.join("\n\n") || "Nenhum"}`);
  }

  // Technical Specs
  const techSpecs = stepMap["technical_specs"] as {
    stack?: string;
    integrations?: Array<{ text: string }>;
    rules?: Array<{ text: string }>;
    performance?: string;
    notes?: string;
  } | undefined;
  if (techSpecs) {
    const parts = [];
    if (techSpecs.stack) parts.push(`**Stack:** ${techSpecs.stack}`);
    if (techSpecs.integrations?.length) {
      parts.push(`**Integrações:** ${techSpecs.integrations.map((i) => i.text).join(", ")}`);
    }
    if (techSpecs.rules?.length) {
      parts.push(`**Regras técnicas:** ${techSpecs.rules.map((r) => r.text).join(", ")}`);
    }
    if (techSpecs.performance) parts.push(`**Performance:** ${techSpecs.performance}`);
    if (techSpecs.notes) parts.push(`**Notas:** ${techSpecs.notes}`);
    sections.push(`## Especificações Técnicas\n${parts.join("\n")}`);
  }

  // Hypotheses & Metrics
  const hypotheses = stepMap["hypotheses"] as { hypotheses?: Array<{ hypothesis: string; indicator: string; target: string; expectedResult: string; evidence: string }> } | undefined;
  if (hypotheses?.hypotheses?.length) {
    const hTexts = hypotheses.hypotheses.map((h, i) => {
      const parts = [`### Hipótese ${i + 1}: ${h.hypothesis}`];
      if (h.indicator) parts.push(`- **Indicador:** ${h.indicator}`);
      if (h.target) parts.push(`- **Meta:** ${h.target}`);
      if (h.expectedResult) parts.push(`- **Resultado esperado:** ${h.expectedResult}`);
      if (h.evidence) parts.push(`- **Evidência:** ${h.evidence}`);
      return parts.join("\n");
    }).join("\n\n");
    sections.push(`## Hipóteses & Métricas de Validação\n${hTexts}`);
  }

  return sections.join("\n\n---\n\n");
}

