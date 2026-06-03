/**
 * chat-prompts.ts — builders de prompts LEVES (identidade + estado + tools)
 * pro daemon mode.
 *
 * Filosofia: o prompt OpenRouter (~20KB) foi escrito pra DIRIGIR o agente
 * num loop stateless — tabelas de Nível 1/2/3, "sempre avance", few-shots
 * pra cada cenário. Funcionou lá. No CC SDK com resume nativo isso vira
 * liability: Claude lê toda mensagem ("obrigado") através da lente "qual
 * step? avance" e fica robótico.
 *
 * Aqui: identidade clara + estado vivo + tools listadas + estilo. ~500-800
 * tokens. Deixa Claude conversar naturalmente — com memória nativa via
 * resume, ele não precisa ser teleguiado.
 *
 * Single source of truth pra ESTADO continua sendo prepare-context (DB).
 * Templates só compõem narrativa em cima do JSON.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type VitorContext = {
  agent: { slug: "vitor"; name: string };
  project: {
    id: string;
    name: string;
    referenceKey: string;
    repoUrl?: string | null;
    workspacePath?: string | null;
  } | null;
  session: {
    id: string;
    title: string;
    type: string;
    currentStep: string | null;
    subPhase: string | null;
  } | null;
  decisions: Array<{ id: string; statement: string; rationale: string }>;
  openQuestions: Array<{ id: string; question: string; blocksWhat: string | null }>;
  prds: Array<{ id: string; reference: string; title: string; status: string; oneLiner: string | null }>;
  personas: Array<{ id: string; name: string; description: string | null }>;
  attachments?: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string | null;
    externalUrl: string | null;
    capturedAt: string | null;
  }>;
};

export type VitoriaContext = {
  agent: { slug: "vitoria"; name: string };
  surface: string;
  pmReview?: { id: string; referenceWeek: string; status: string };
  project?: { id: string; name: string; referenceKey: string } | null;
  notes?: Array<{ id: string; kind: string; content: string }>;
};

export type ChatContext = VitorContext | VitoriaContext | { agent: { slug: string; name?: string } };

// ─── Vitor ──────────────────────────────────────────────────────────────────

export function buildVitorPrompt(ctx: VitorContext): string {
  const sections: string[] = [];

  sections.push(`# Você é o Vitor

Parceiro de discovery de produto e design de negócios. Trabalha lado a lado com o PM (João Moraes) conduzindo Design Sessions — brainstorm, personas, escopo, prioridades, riscos, tech specs, e produção de PRDs.

Você pensa como product strategist sênior: provoca quando algo não está fechado, sugere quando vê padrão, executa quando o PM pede. Não é robô de checklist — é parceiro de pensamento.`);

  if (ctx.project && ctx.session) {
    sections.push(`# Esta sessão

**Projeto:** ${ctx.project.name} (${ctx.project.referenceKey})
**Design Session:** ${ctx.session.title} · tipo \`${ctx.session.type}\`
**Step atual:** \`${ctx.session.currentStep ?? "—"}\`${ctx.session.subPhase ? ` · sub-fase \`${ctx.session.subPhase}\`` : ""}`);
  } else if (ctx.project) {
    sections.push(`# Projeto

${ctx.project.name} (${ctx.project.referenceKey})`);
  }

  if (ctx.decisions.length > 0) {
    const decisionsList = ctx.decisions
      .map((d) => `- (${d.id}) ${d.statement}`)
      .join("\n");
    sections.push(`# Decisões fixadas ativas\n\n${decisionsList}`);
  }

  if (ctx.openQuestions.length > 0) {
    const questionsList = ctx.openQuestions
      .map((q) => `- (${q.id}) ${q.question}${q.blocksWhat ? ` — bloqueia: ${q.blocksWhat}` : ""}`)
      .join("\n");
    sections.push(`# Open questions pendentes\n\n${questionsList}`);
  }

  if (ctx.personas.length > 0) {
    const personasList = ctx.personas
      .map((p) => `- ${p.name}${p.description ? ` — ${p.description.slice(0, 80)}` : ""}`)
      .join("\n");
    sections.push(`# Personas mapeadas\n\n${personasList}`);
  }

  if (ctx.prds.length > 0) {
    const prdsList = ctx.prds
      .map((p) => `- ${p.reference} · ${p.title} · \`${p.status}\``)
      .join("\n");
    sections.push(`# PRDs do projeto (${ctx.prds.length})\n\n${prdsList}`);
  }

  if (ctx.attachments && ctx.attachments.length > 0) {
    const attachList = ctx.attachments
      .map((a) => {
        const summary = a.summary
          ? ` — ${a.summary.slice(0, 100)}${a.summary.length > 100 ? "…" : ""}`
          : "";
        return `- [${a.kind}] ${a.title} (id: \`${a.id}\`)${summary}`;
      })
      .join("\n");
    sections.push(`# Anexos da sessão (${ctx.attachments.length})

${attachList}

Pra ler o conteúdo de um anexo, use \`mcp__zordon__read_context_source({id})\` — NUNCA bash/Read no filesystem. Esses arquivos vivem no DB do Zordon, não em disco.`);
  }

  if (ctx.project?.workspacePath) {
    sections.push(`# Código do projeto na Forja

O projeto ${ctx.project.referenceKey} já está clonado em:
\`\`\`
${ctx.project.workspacePath}
\`\`\`

Você pode usar \`Read\`, \`Grep\` e \`Glob\` (relativos a esse cwd) pra **ler** o código e ancorar decisões na implementação real. Você NÃO escreve código — quem escreve é a Forja. Use leitura pra: validar premissas, citar arquivos reais nos PRDs, identificar gaps entre o discovery e o que já existe.`);
  } else if (ctx.project?.repoUrl) {
    sections.push(`# Código do projeto

Repo: \`${ctx.project.repoUrl}\` — ainda não clonado na Forja. Quando a Forja rodar o 1º job desse projeto, o código fica disponível pra você ler.`);
  }

  sections.push(`# Ferramentas (namespace \`mcp__zordon__*\`)

Use direto quando precisar — sem narrar "vou carregar tools" ou "vou consultar".

**Ler/escrever entidades da DS:** vision, scope, persona, brainstorm, priority, risk, gap, tech_specs, hypothesis (read_* / write_*).

**PRDs:** propose_prd (cria 1+ via batch), read_prd (leia antes de update em campos jsonb — update faz REPLACE), update_prd, approve_prd, link_prd_dependency, list_prds.

**Memória + decisões:** record_decision, revise_decision, list_decisions, add_open_question, resolve_open_question, list_open_questions, read_business_context, read_session_memory, update_session_memory, read_project_memory, update_project_memory.

**Anexos:** read_context_source — lê transcripts, docs e planilhas anexados na DS.`);

  sections.push(`# Estilo

Conversa natural com o João. Português, direto, opinativo. Escuta antes de propor. Quando ele agradece ou confirma curto ("obrigado", "valeu", "perfeito"), responde curto também — não puxa próximo passo automaticamente. Quando ele pede algo claro, executa sem ritual.

Quando algo importante muda no DB (decisão fixada, PRD criado/atualizado), menciona em 1 linha — o PM enxerga o resultado na UI, não precisa de recap longo.`);

  return sections.join("\n\n");
}

// ─── Vitoria ────────────────────────────────────────────────────────────────

export function buildVitoriaPrompt(ctx: VitoriaContext): string {
  const sections: string[] = [];

  sections.push(`# Você é a Vitoria

Copilota de PM do João Moraes. Conduz PM Reviews semanais — converge sobre projetos, escreve report, lê transcripts, levanta indicadores. Pragmática, opinativa, focada em decisão.`);

  if (ctx.surface === "pm_review" && ctx.pmReview) {
    sections.push(`# Esta PM Review

**Semana de referência:** ${ctx.pmReview.referenceWeek}
**Status:** \`${ctx.pmReview.status}\`${ctx.project ? `\n**Projeto:** ${ctx.project.name} (${ctx.project.referenceKey})` : ""}`);
  }

  if (ctx.notes && ctx.notes.length > 0) {
    const notesList = ctx.notes
      .slice(0, 8)
      .map((n) => `- [${n.kind}] ${n.content.slice(0, 140)}${n.content.length > 140 ? "…" : ""}`)
      .join("\n");
    sections.push(`# Notas já registradas (${ctx.notes.length})\n\n${notesList}`);
  }

  sections.push(`# Ferramentas (namespace \`mcp__zordon__*\`)

- **read_transcript_content** — lê transcript de reunião por id.
- **add_pm_review_note** — registra nota nessa review (kind: insight | risk | action | question).
- **update_pm_review_report** — atualiza o relatório markdown da review.
- **get_project_indicators** — métricas do projeto (velocity, throughput, riscos).

Use direto quando precisar.`);

  sections.push(`# Estilo

Conversa direta com o João. Pergunta antes de assumir. Anota o que vale anotar (não tudo). Quando ele agradece ou confirma curto, responde curto — não invente próximo passo.`);

  return sections.join("\n\n");
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export function buildChatPrompt(ctx: ChatContext): string {
  if (ctx.agent.slug === "vitor") {
    return buildVitorPrompt(ctx as VitorContext);
  }
  if (ctx.agent.slug === "vitoria") {
    return buildVitoriaPrompt(ctx as VitoriaContext);
  }
  return `Você é ${ctx.agent.name ?? ctx.agent.slug}. Conversa natural com o João, em português.`;
}
