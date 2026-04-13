import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type GeneratedTask = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  businessContext: string;
  technicalNotes: string;
  outOfScope: string[];
  uiGuidance: string;
  complexity: "trivial" | "low" | "medium" | "high";
  scope: "micro" | "small" | "medium" | "large";
  dependsOn: string[]; // titles of tasks this depends on
};

/**
 * Loads all step data from a Design Session and formats it for the prompt.
 */
async function buildSessionContext(sessionId: string): Promise<string> {
  const session = await prisma.designSession.findUnique({
    where: { id: sessionId },
    include: {
      project: { select: { name: true, id: true } },
      stepData: true,
    },
  });

  if (!session) throw new Error("Session not found");

  const stepMap: Record<string, unknown> = {};
  for (const step of session.stepData) {
    try {
      stepMap[step.stepKey] = JSON.parse(step.data);
    } catch {
      stepMap[step.stepKey] = step.data;
    }
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
  const brainstorm = stepMap["brainstorm"] as { solutions?: Array<{ title: string; howItSolves: string }> } | undefined;
  if (brainstorm?.solutions?.length) {
    const solTexts = brainstorm.solutions.map((s) => `- **${s.title}:** ${s.howItSolves}`).join("\n");
    sections.push(`## Soluções Levantadas\n${solTexts}`);
  }

  // Prioritization
  const prioritization = stepMap["prioritization"] as { items?: Array<{ title: string; bucket: string }> } | undefined;
  if (prioritization?.items?.length) {
    const buckets: Record<string, string[]> = { mvp: [], next: [], out: [] };
    for (const item of prioritization.items) {
      (buckets[item.bucket] || []).push(item.title);
    }
    sections.push(`## Priorização
**MVP (fazer agora):** ${buckets.mvp.join(", ") || "Nenhum"}
**Próximo (depois do MVP):** ${buckets.next.join(", ") || "Nenhum"}
**Fora do escopo:** ${buckets.out.join(", ") || "Nenhum"}`);
  }

  // Sequencing
  const sequencing = stepMap["sequencing"] as { phases?: Array<{ name: string; items: Array<{ title: string }> }> } | undefined;
  if (sequencing?.phases?.length) {
    const phaseTexts = sequencing.phases.map((p) =>
      `### ${p.name}\n${p.items.map((i) => `- ${i.title}`).join("\n")}`
    ).join("\n\n");
    sections.push(`## Sequenciamento de Entregas\n${phaseTexts}`);
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

  return sections.join("\n\n---\n\n");
}

/**
 * Loads project guidelines and formats them for the prompt.
 */
async function buildGuidelinesContext(projectId: string): Promise<string> {
  const guidelines = await prisma.projectGuideline.findMany({
    where: { projectId },
  });

  if (guidelines.length === 0) return "";

  const sections = guidelines.map(
    (g) => `### ${g.title}\n${g.content}`
  );

  return `## Guidelines do Projeto\n\n${sections.join("\n\n---\n\n")}`;
}

/**
 * Generates tasks from a Design Session using OpenAI.
 */
export async function generateTasksFromSession(
  sessionId: string
): Promise<GeneratedTask[]> {
  const session = await prisma.designSession.findUnique({
    where: { id: sessionId },
    include: { project: { select: { id: true, name: true } } },
  });

  if (!session) throw new Error("Session not found");

  const sessionContext = await buildSessionContext(sessionId);
  const guidelinesContext = await buildGuidelinesContext(session.project.id);

  const systemPrompt = `Você é um gerente de projetos técnico de uma software house especializada em desenvolvimento agêntico (IA + humanos).

Sua tarefa é gerar tasks técnicas detalhadas a partir de uma Design Session. Cada task deve ser específica o suficiente para que um agente de IA consiga implementar sem ambiguidade.

## Regras de Geração

### Acceptance Criteria
- Cada critério deve ser verificável e específico
- Não use palavras vagas como "bom", "adequado", "bonito", "adequadamente"
- Para tasks de UI: especifique componentes, colunas/campos, estados visuais
- Para tasks de API: especifique endpoint, método, payload esperado, resposta
- Para tasks de lógica: especifique inputs, outputs, edge cases

### Complexidade e Escopo
- complexity: esforço de DIREÇÃO (trivial=óbvio, low=simples, medium=requer pensamento, high=complexo)
- scope: tamanho da entrega (micro=<1h, small=1-4h, medium=4-8h, large=1-2 dias)
- Tasks "large" devem ser quebradas em menores quando possível

### Out of Scope
- Liste explicitamente o que NÃO está incluído na task
- Isso previne o agente de adicionar features extras

### Dependências
- Se uma task precisa de outra pronta antes, liste em dependsOn pelo título exato

### UI Guidance
- Quando aplicável, referencie padrões visuais existentes
- Especifique componentes da biblioteca (shadcn, lucide-react, etc.)

### Priorização
- Items marcados como "MVP" geram tasks granulares (max 1 dia cada)
- Items "Próximo" podem agrupar quando relacionados
- Items "Fora do escopo" NÃO geram tasks

Responda EXCLUSIVAMENTE em JSON válido com o formato:
{
  "tasks": [
    {
      "title": "string - título curto e acionável",
      "description": "string - o que implementar e por quê",
      "acceptanceCriteria": ["string - critério verificável 1", "string - critério 2"],
      "businessContext": "string - por que essa task existe do ponto de vista de negócio",
      "technicalNotes": "string - stack, APIs, padrões técnicos a seguir",
      "outOfScope": ["string - o que NÃO fazer 1"],
      "uiGuidance": "string - referências visuais e componentes (vazio se não for UI)",
      "complexity": "trivial|low|medium|high",
      "scope": "micro|small|medium|large",
      "dependsOn": ["título exato de outra task"]
    }
  ]
}`;

  const userPrompt = `# Projeto: ${session.project.name}
# Tipo de Session: ${session.type}

${sessionContext}

${guidelinesContext ? `\n---\n\n${guidelinesContext}` : ""}

---

Gere as tasks técnicas para este projeto. Inclua tasks de setup/infra se os requisitos técnicos exigirem. Foque nos items priorizados como MVP.`;

  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.3,
    response_format: { type: "json_object" },
    max_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  const parsed = JSON.parse(content);
  return parsed.tasks as GeneratedTask[];
}
