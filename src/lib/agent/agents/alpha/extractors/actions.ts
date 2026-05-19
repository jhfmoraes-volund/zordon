// Sub-agent ActionExtractor — recebe transcrição + contexto do projeto e
// devolve {tasks, todos, skipped} estruturados. Single-shot, Haiku, JSON via
// generateObject. Chamado pela tool `extract_meeting_actions` no Alpha.

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";

const HAIKU_MODEL = "anthropic/claude-haiku-4.5";
const MAX_TASKS_IN_CONTEXT = 500;

// ─── Tipos de input ──────────────────────────────────────────────────────────

export type ExtractorMember = { id: string; name: string; role: string };
export type ExtractorProject = { id: string; name: string };
export type ExtractorUserStory = {
  id: string;
  reference: string;
  title: string;
};
export type ExtractorTask = {
  reference: string;
  title: string;
  status: string;
};

export type ExtractActionsInput = {
  transcript: string;
  meetingType: "pm_review" | "general" | "daily" | "super_planning" | "private";
  projects: ExtractorProject[];
  members: ExtractorMember[];
  userStories: ExtractorUserStory[];
  tasks: ExtractorTask[]; // já vem cortado em até MAX_TASKS_IN_CONTEXT
};

// ─── Schema do output ────────────────────────────────────────────────────────

const taskItemSchema = z.object({
  type: z.enum(["create", "update", "review"]).describe(
    "create=task nova; update=mudança em task existente (matched por REF ou título); review=item ambíguo (confidence<0.5), PM decide",
  ),
  taskReference: z.string().nullable().describe(
    "Preencha quando type=update ou review e a ação claramente refere uma task existente (ex: TASK-281). null pra create.",
  ),
  title: z.string().describe(
    "Título curto e imperativo da task (ex: 'Adicionar campos de layout no PRD do Zordon'). Pra type=update pode replicar o título da task existente se a mudança não é de título.",
  ),
  description: z.string().nullable().describe(
    "Detalhe técnico/escopo extraído da transcrição. null se vago.",
  ),
  projectName: z.string().describe(
    "Nome do projeto (use os fornecidos no input). Obrigatório pra resolver ambiguidade quando há múltiplos.",
  ),
  assigneeName: z.string().nullable().describe(
    "Nome do responsável citado na transcrição. null se ambíguo. NÃO invente.",
  ),
  userStoryReference: z.string().nullable().describe(
    "Reference da US existente que cobre essa task (ex: ZRDN-US-014), só se claramente relacionada. null se nenhuma bate.",
  ),
  matchedExistingTask: z
    .object({
      reference: z.string(),
      similarity: z.enum(["exact", "related"]).describe(
        "exact: mesma intenção/escopo (use type=update); related: assunto próximo mas é trabalho novo (use type=create e mencione no reasoning).",
      ),
    })
    .nullable()
    .describe(
      "Quando você encontra task existente parecida na lista de Tasks. Pode ser por REF citada na transcrição OU por similaridade de título.",
    ),
  reasoning: z.string().describe(
    "1-2 frases em pt-BR: por que isso é Task de sistema (não Todo) e por que escolheu esse type.",
  ),
  sourceQuote: z.string().describe(
    "Citação literal curta da transcrição (1-2 frases) que motivou a proposta. Use pra grounding — se você não consegue citar, não proponha.",
  ),
  confidence: z.number().min(0).max(1).describe(
    "0..1, sua confiança. <0.5 use type=review.",
  ),
});

const todoItemSchema = z.object({
  description: z.string().describe(
    "Descrição curta e imperativa do follow-up (ex: 'Agendar reunião com Davi sobre Cloud Code').",
  ),
  assigneeName: z.string().describe(
    "Nome do responsável citado na transcrição. Obrigatório (Todo precisa de assignee).",
  ),
  dueDate: z.string().nullable().describe(
    "Data citada na transcrição em formato YYYY-MM-DD. null se não citada.",
  ),
  projectName: z.string().nullable().describe(
    "Nome do projeto se a ação está claramente vinculada a um. null pra ações operacionais gerais (PDI, playbook, etc).",
  ),
  reasoning: z.string().describe(
    "1 frase em pt-BR: por que isso é Todo (pessoas/processo), não Task.",
  ),
  sourceQuote: z.string().describe(
    "Citação literal curta da transcrição que motivou a Todo.",
  ),
});

const skippedItemSchema = z.object({
  description: z.string().describe("O que você considerou mas descartou."),
  reason: z.string().describe(
    "Por que descartou (ex: 'já feito na reunião', 'fora do escopo', 'ambíguo demais sem grounding na transcrição').",
  ),
});

export const extractionResultSchema = z.object({
  tasks: z.array(taskItemSchema),
  todos: z.array(todoItemSchema),
  skipped: z.array(skippedItemSchema),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type ExtractedTask = z.infer<typeof taskItemSchema>;
export type ExtractedTodo = z.infer<typeof todoItemSchema>;

// ─── Prompt do sub-agent ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é o ActionExtractor — sub-agente especializado em ler transcrições de reuniões e extrair ações estruturadas como Task (sistema/software) ou Todo (pessoas/processo).

## Regra única de classificação — DOMÍNIO

**"Esta ação modifica o software/sistema ou mexe em pessoas/processo?"**

- **Sistema/software** (código, schema, banco, UI/tela, API, integração técnica, regra de negócio, fluxo do produto) → **Task**.
- **Pessoas/processo** (reunião, conversa, alinhamento, onboarding, PDI, feedback, comunicação interna, agenda, doc de gestão, cobrança, contratação) → **Todo**.

Não importa o verbo. Não importa quem fala. Só importa: depois que estiver pronto, o que vai estar diferente — o software ou a relação entre pessoas?

### Exemplos Task (sistema)
- "Brenda inclui 2 campos no PRD (layout, refs visuais)" → Task. PRD é artefato do produto.
- "Migrar geração de tasks pro Cloud Code" → Task. Muda o sistema de geração.
- "Refatorar JSON pra tabelas relacionais" → Task. Mudança de schema.
- "Resolver gargalo de geração" → Task. Mesmo vago, mexe em sistema.
- "Melhorar UX da tela de membros" → Task.

### Exemplos Todo (pessoas/processo)
- "Agendar reunião com Davi sobre Cloud Code" → Todo. Agendar é ação sobre pessoa, mesmo que o assunto seja técnico.
- "Conversar com cliente sobre prazo" → Todo.
- "Compartilhar playbooks de liderança" → Todo. Playbook de gestão, não produto.
- "Definir PDI da Paloma" → Todo. PDI é processo de pessoas.
- "Onboarding de estagiário" → Todo.
- "Dar feedback nine-box" → Todo.

## Processo obrigatório

1. **Leia a transcrição inteira primeiro.** Não pule pra extração antes de entender o contexto. Identifique cada tópico discutido.

2. **Varra por tópico, não só por "próximos passos".** A seção "Próximos Passos" de um resumo tende a ser viesada a operacional (Todo). Trabalho de produto aparece DENTRO dos tópicos ("Brenda criou script que reescreveu tasks em PRD" → Task de produto, mesmo não estando em "Próximos Passos").

3. **Pra cada ação candidata:**
   a. Classifique por DOMÍNIO (sistema vs pessoas).
   b. Se Task: escaneie a lista \`Tasks ativas do projeto\` (fornecida no input). Procure REF citada (regex TASK-\\d+) ou título parecido.
      - Match por REF explícita → \`type: "update"\`, preencha \`taskReference\` e \`matchedExistingTask\` (similarity="exact").
      - Match por título muito próximo (mesma intenção/escopo) → \`type: "update"\`, \`matchedExistingTask.similarity="exact"\`.
      - Match parcial (assunto relacionado mas trabalho diferente) → \`type: "create"\` + mencione no \`reasoning\` que existe similar, preencha \`matchedExistingTask.similarity="related"\`.
      - Sem match → \`type: "create"\`, \`matchedExistingTask: null\`.
   c. Se confidence < 0.5 → \`type: "review"\` em vez de "create".

4. **Vincular User Story (quando aplicável):** se a Task bate com uma US listada em \`User Stories ativas\`, preencha \`userStoryReference\`. Use APENAS REFs da lista — NUNCA invente.

5. **Vincular projeto:** sempre use \`projectName\` da lista \`Projetos da reunião\`. Se a ação não cita projeto claro mas só há 1 projeto na reunião, use ele.

6. **Vincular assignee:** use APENAS nomes da lista \`Members do squad\`. Se ambíguo, deixe null (pra Task) ou pule pra skipped (pra Todo — Todo precisa de assignee).

7. **Grounding obrigatório:** \`sourceQuote\` deve ser citação literal da transcrição. Se você não consegue citar, é alucinação — vá pra \`skipped\` com reason="sem grounding".

8. **Skipped:** liste ações que considerou mas descartou (ambiguidade extrema, já feito durante a reunião, fora de escopo, sem grounding). Ajuda na auditoria.

## Anti-padrões (NÃO faça)

- **Não invente assignee** se a transcrição não nomeia.
- **Não invente REF de task** (TASK-NNN) — use só REFs da lista \`Tasks ativas\` ou citadas EXPLICITAMENTE na transcrição.
- **Não invente REF de US** — só use da lista \`User Stories ativas\`.
- **Não duplique** — se já listou uma ação como Task, não liste a mesma como Todo (e vice-versa).
- **Não pegue ações já COMPLETAS na reunião** (ex: "Brenda já rodou o script — custou 3 dólares" não vira ação; é histórico). Vai pra skipped com reason="já feito".
- **Não vaze o resumo** — você responde APENAS o JSON estruturado.

## Saída

Devolva JSON conforme o schema fornecido. Campos null quando aplicável (não omita). Arrays vazios são OK.`;

// ─── Função principal ────────────────────────────────────────────────────────

function formatUserPrompt(input: ExtractActionsInput): string {
  const parts: string[] = [];

  parts.push(`## Reunião — tipo ${input.meetingType}\n`);

  parts.push(`## Projetos da reunião`);
  for (const p of input.projects) {
    parts.push(`- ${p.name}`);
  }
  parts.push("");

  parts.push(`## Members do squad (use APENAS estes nomes)`);
  for (const m of input.members) {
    parts.push(`- ${m.name} (${m.role})`);
  }
  parts.push("");

  if (input.userStories.length > 0) {
    parts.push(`## User Stories ativas (refined/committed)`);
    parts.push(`(use APENAS estas refs em userStoryReference)`);
    for (const us of input.userStories) {
      parts.push(`- ${us.reference}: ${us.title}`);
    }
    parts.push("");
  }

  if (input.tasks.length > 0) {
    parts.push(`## Tasks ativas do projeto (top ${input.tasks.length} por updatedAt)`);
    parts.push(`(use APENAS estas refs em taskReference / matchedExistingTask.reference)`);
    for (const t of input.tasks) {
      parts.push(`- ${t.reference} [${t.status}]: ${t.title}`);
    }
    parts.push("");
  } else {
    parts.push(`## Tasks ativas do projeto`);
    parts.push(`(nenhuma — qualquer ação Task será create)`);
    parts.push("");
  }

  parts.push(`## Transcrição\n`);
  parts.push(input.transcript);

  return parts.join("\n");
}

export async function extractActions(
  input: ExtractActionsInput,
): Promise<ExtractionResult> {
  // Cortar lista de tasks pra não estourar contexto (limite definido na arch).
  const trimmedInput: ExtractActionsInput = {
    ...input,
    tasks: input.tasks.slice(0, MAX_TASKS_IN_CONTEXT),
  };

  const userPrompt = formatUserPrompt(trimmedInput);

  const { object } = await generateObject({
    model: getModel(HAIKU_MODEL),
    schema: extractionResultSchema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  return object;
}
