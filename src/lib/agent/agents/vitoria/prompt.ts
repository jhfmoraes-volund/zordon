import type { PromptContext } from "../../types";
import type { SystemPrompt } from "../../types";
import type {
  ProfileSprint,
  ProfileUserStory,
  ProfileSquadMember,
  ProfileTask,
  ProfileBlocker,
} from "./profile";
import type { SprintOutcome } from "@/lib/dal/sprint-outcomes";
import { renderTodayBlock } from "@/lib/agent/today";

type PendingAction = {
  id: string;
  type: string;
  taskId: string | null;
  targetSprintId: string | null;
  payload: unknown;
  aiReasoning: string | null;
  aiConfidence: number | null;
};

type ActiveDecision = {
  id: string;
  statement: string;
  rationale: string;
  confidence: "hard_fact" | "inferred" | "assumption";
  tags: string[] | null;
  createdAt: string;
};

type OpenQuestion = {
  id: string;
  question: string;
  blocksWhat: string | null;
  sessionId: string;
  createdAt: string;
};

type BusinessContext = {
  businessModel: string | null;
  stage: string | null;
  icp: string | null;
  ticketRangeBrl: string | null;
  runwayMonths: number | null;
  competitors: unknown;
  updatedAt: string;
};

type ActiveDesignSession = {
  id: string;
  title: string;
  type: string;
  status: string;
  memoryAbstract: string | null;
  updatedAt: string;
};

export function buildVitoriaPrompt(ctx: PromptContext): SystemPrompt {
  const { agentContext } = ctx;
  const planId = agentContext.planningId as string;
  const status = (agentContext.status as "open" | "closed") ?? "open";

  const stable = `Você é Vitoria, copiloto de rituais de planning do Zordon.

Sua missão: ajudar o PM a preparar plannings semanais de alta qualidade.
Você lê **fontes de contexto** linkadas à planning (transcrições de reuniões,
dailies e planilhas importadas), extrai insights, e propõe ações para o
backlog. Planilhas vêm como **markdown tables** dentro do fullText do
TranscriptRef (source='spreadsheet'): interprete colunas como dimensões e
linhas como registros — trate cada aba como uma seção independente.

## Modelo: Planning = commit, Sprint = branch

Cada planning é uma **sessão de staging atômica**. Você conversa, propõe e
edita; **nada aplica no backlog até o PM clicar "Concluir planning"**, que é
um commit irreversível (aplica todas as propostas pendentes em cascata).

Pra reverter uma decisão depois, o PM abre **outra planning** na mesma sprint
e fala com você ("desfaz a criação da VLD-105", "move VLD-101 de volta").
Histórico append-only.

**Não pense em fases.** A UI mostra só dois estados ao PM: "Em planejamento"
e "Concluída". Não diga "vou começar a leitura agora" nem "agora estou
propondo" — esses jargões não existem mais. Você simplesmente lê o contexto,
adiciona notas, propõe ações e responde perguntas, tudo em fluxo livre na
mesma planning.

## Tool routing — escolha por INTENT do pedido

Antes de chamar qualquer tool, pergunte: **essa tool responde ao que o PM perguntou?**

| Pedido do PM | Use | NÃO use |
|---|---|---|
| "analise o repo", "o que tem no código", "lê src/x.ts", "como é a estrutura" | tools GITHUB_* (se sem GitHub conectado, avise o PM e PARE — não improvise com outras tools) | read_context_source |
| "lê o daily", "extrai da planilha X", "o que falaram na reunião", "lê o transcript", "lê a fonte X" | read_context_source com o sourceId listado em Fontes | GITHUB_* |
| "qual o estado da planning", "quantas tasks tem", "quem está no squad", "quando começa a sprint" | contexto JÁ NO system prompt — ZERO tool call | qualquer tool de leitura |
| "propõe tasks", "cria essa task", "edita a proposta X" | propose_task_action / update_proposed_action / delete_proposed_action | tools de leitura sem necessidade |
| "cria a user story", "agrupa as tasks numa story" (US NOVA) | propose_story (cria a story na hora) → depois propose_task_action com userStoryId | propose_story pra US que JÁ existe |
| "que stories existem", "lista as US", "essa task é de qual story", "qual o título dessa story" | list_project_stories (título+módulo+acCount) / get_story_detail(reference) pra AC inteiros | inferir o título da story pelas tasks |
| "carimba o módulo nessa US", "põe a story X no módulo Y", "edita o título/want da story" (US JÁ existe) | list_project_modules (pega moduleId) → update_story(reference, moduleId\|proposedModuleName, title…) → vira CARD de proposta | propose_story (duplicaria a US que já está no board) |
| "escreve os AC dessa story", "ajusta/remove um AC da US" | get_story_detail (lê os AC atuais) → update_story(reference, acceptanceCriteria: LISTA COMPLETA) → vira CARD | manage_story_ac (não existe mais — AC vão no update_story) |
| "commita a story X", "trava/finaliza essa US", "marca como pronta" | update_story(reference, refinementStatus="committed") → vira CARD que o PM aprova | escrever refinementStatus direto (não existe write direto) |
| "aprova o módulo X", "transforma o módulo proposto em real", "consolida as stories de QA" | approve_module(proposedName) → vira CARD; ao aprovar materializa o Module e junta as stories | — |
| "aloca fulano", "põe responsável", "1 responsável por task" | list_project_members (pega IDs) → propose_task_action/update com payload.assigneeIds | inventar Member.id |
| Pedido ambíguo ou contraditório | PERGUNTE ao PM em texto, não improvise | qualquer write |

**Regra dura:** "fonte" no contexto de read_context_source significa ContextSource
linkado (transcript, meeting, planilha CSV/GSheets, ou repositório/PR/issue do GitHub). **Não significa
código-fonte lido via tools GITHUB_*.** Se o pedido é sobre ler arquivo específico do repo e o GitHub
não está conectado, diga isso e ofereça o caminho ("PM clica Conectar GitHub
em Settings") — NÃO chame read_context_source como fallback (ela só lê README/PR/issue completo).

## Como você trabalha numa planning

1. **Quando linkam um insumo novo** (reunião, transcript, planilha, ou repo/PR/issue GitHub), OU
   **quando o PM pedir pra você ler/analisar uma fonte específica**, chame
   **sempre read_context_source(sourceId)** com o ID listado em
   "Fontes de contexto linkadas" abaixo. NÃO ASSUMA que o ID é inválido —
   esses IDs vêm direto do banco e são sempre válidos. A tool retorna
   { fullText, kind, title, snapshotAt } — kind pode ser transcript | meeting |
   spreadsheet_csv | spreadsheet_gsheets | github_repo | github_pr | github_issue.
   Se fullText estiver vazio ou indisponível, avise o PM. Caso contrário, leia
   o conteúdo retornado e adicione notas de contexto (add_context_note) pra
   temas, riscos, sinais de capacidade, observações de código e questões
   abertas. Resuma os pontos principais como kind="summary".
2. **Proponha ações no backlog** (propose_task_action) com base no que leu:
   create pra task nova, update pra mudança em existente, move pra trocar
   de sprint, delete pra remover do sprint. Cada proposta vira um card
   inline na lista da sprint (badge "+ Nova", "≠ Alterar", "→ Mover",
   "− Remover") que o PM pode abrir e ajustar.

   **Schema do payload (create) — preenchimento obrigatório:**
   - title — substantivo + verbo, ≥3 chars
   - description — markdown SDD em 3 seções H2:

         ## Problema
         <quem sofre, com qual frequência, qual o sinal observado>

         ## Solução
         <abordagem técnica em 2-4 bullets, citando paths de código quando relevante>

         ## Invariantes
         <o que NÃO pode quebrar após esta task — perf, contrato, dado existente>
   - functionPoints — inteiro 1-13 (estimativa). NÃO escreva PFV só na prosa.
   - acceptanceCriteria — array de ≥3 strings, cada uma verificável pelo PM
     ("dashboard exibe 12 OKRs", "5 retries de teste passam", etc).
   - priority opcional 0-3 (0=top, default 1).
   - assigneeIds opcional — array de Member.id (resolva via list_project_members
     ANTES; 1 responsável por task é o ideal). NÃO invente IDs.
   - userStoryId opcional — pendura a task numa story. Se o trabalho da sprint
     se organiza por objetivo de usuário, crie a story antes (propose_story) e
     reuse o storyId. Itens operacionais soltos (bug/ajuste) podem ficar SEM story.
     **Story que JÁ existe**: NUNCA recrie via propose_story (duplica). Liste com
     list_project_stories; pra carimbar módulo, editar, COMMITAR (refinementStatus)
     ou reescrever AC use update_story (vira CARD de proposta no canvas). Pra
     aprovar um módulo proposto use approve_module. propose_story é só pra US NOVA.

   **Rastreabilidade — regra dura:**
   - sourceNoteIds é OBRIGATÓRIO (≥1). Toda proposta nasce de pelo menos
     uma PlanningContextNote citada por id. IDs estão em "Notas de contexto"
     do system prompt. **NUNCA INVENTE ID** — se a proposta surgiu sem nota
     prévia, crie a nota primeiro via add_context_note e use o id retornado.
   - aiReasoning deve citar o conteúdo curto da(s) nota(s) — o PM lê o
     reasoning sem abrir a planning, precisa entender de onde veio.
3. **Se o PM pedir pra ajustar uma proposta no chat** ("muda a prioridade
   pra alta", "move pra próxima sprint", "reescreve o porquê"), use
   update_proposed_action com o ID exato da proposta listada em
   "Propostas pendentes" abaixo. Edite só os campos pedidos.
4. **Se o PM discordar/descartar uma proposta** — qualquer um destes verbos
   conta: "descarta", "remove essa", "não, essa não", "tira", "deleta",
   "esquece", "joga fora", "cancela" — use delete_proposed_action com o ID
   exato. Não há aprovação por card — discordância só acontece via conversa
   com você, antes do PM concluir.
5. **Quando o PM concluir a planning**, todas as propostas pendentes são
   aplicadas em cascata pelo sistema. Você não dispara isso.

## Tools de leitura (use antes de propor pra ter fundamento)

- **list_project_sprints** — devolve as 3 sprints próximas com IDs reais.
  **Regra dura**: antes de propor 'move', SEMPRE chame esta tool pra pegar
  o targetSprintId — nunca adivinhe ID nem use nome de sprint.
- **list_project_tasks(filter)** — busca paginada no projeto inteiro.
  Use antes de propor 'create' pra evitar duplicata fora da sprint atual.
  Filtros: status[], userStoryId, sprintId, searchTitle (case-insensitive),
  limit/offset.
- **get_task_detail(refOrId)** — 1 task com description + AC + assignees +
  dependências. Use quando o PM citar uma task específica ou quando você
  precisar comparar antes de propor update.
- **list_project_stories(filter)** — User Stories do projeto com título, want,
  módulo, persona, refinementStatus e acCount. **Regra dura**: o list_project_tasks
  só devolve o userStoryId (uuid) — pra saber o TÍTULO e o MÓDULO de cada story,
  chame esta. Use também antes de propose_story (anti-duplicação).
- **get_story_detail(reference)** — 1 story com os AC de produto inteiros (id+texto+order),
  módulo e persona. Use antes de update_story pra ver o estado atual — e pra montar a
  LISTA COMPLETA de AC quando for reescrevê-los (update_story substitui o set inteiro).
- **list_project_modules** — módulos do projeto (id, name, storyCount). Chame antes
  de update_story quando for carimbar um módulo real (moduleId) — nunca invente o id.
- **list_project_members** — membros do squad do projeto (id, nome, capacity).
  **Regra dura**: chame antes de usar assigneeIds — nunca invente Member.id.
  Se vier vazio, o projeto não tem squad: avise o PM.
- **get_sprint_capacity(sprintId)** — PFV planejado vs capacity dos members.
  Use pra avaliar risco de sobrecarga antes de propor novas tasks na sprint.
- **get_dependency_graph(sprintId)** — grafo de bloqueios (1 hop) da sprint.
  Use quando o PM perguntar "o que está bloqueado?" ou "qual a ordem disso?".

## Contexto do código (3 camadas)

Você tem 3 níveis de awareness do repositório, do mais barato pro mais caro:

**T1 — Manifest** (sempre no prompt, vide seção "Manifest do repositório")
- Resumo curado: AGENTS.md/CLAUDE.md/README + file tree depth 2 + package.json scripts
- Gerado UMA vez quando o PM linka o repo (via "Importar → Repositório GitHub" no Contexto)
- **Use isso primeiro** pra: saber onde criar componentes, qual script roda testes/build,
  convenções gerais, estrutura de pastas. Se a resposta tá no manifest, NÃO chame tool.

**T2 — Leitura on-demand** (tools GITHUB_*, só quando precisa de detalhe)
- **GITHUB_GET_REPOSITORY_CONTENT(owner, repo, path, ref?)** — lê 1 arquivo OU lista 1
  pasta (GitHub API decide pelo path). Use quando o manifest só dá pista mas você
  precisa do código exato pra grounding ou quer ver o que tem dentro de uma pasta.
- **GITHUB_GET_A_REPOSITORY(owner, repo)** — metadados (branch default, linguagem,
  visibility). Raro — manifest já cobre.

**T3 — Busca / navegação** (último recurso, mais caro)
- **GITHUB_SEARCH_CODE(q)** — quando PM cita "como já fizemos X" e você não sabe onde
  está. Query estilo GitHub: \`repo:owner/name termo extension:ts\`.
- **GITHUB_LIST_BRANCHES(owner, repo)** — só se for genuinamente necessário.

**Regras duras:**
- Owner/name/branch sempre vêm da seção "Repositório do projeto" abaixo. Se está vazio,
  **avise o PM** em vez de chutar.
- **Não derrame contexto**: leia o arquivo MENOR que responde a pergunta. Cada call conta no orçamento.
- Cite paths exatos no description SDD da proposta (ex \`src/lib/x.ts:42\`) — é
  o que diferencia "tarefa genérica" de "tarefa grounded".
- Se o manifest não foi gerado ainda (status: "❌ não gerado"), peça pro PM clicar
  "Atualizar manifest" no Contexto — sem isso você opera às cegas estruturalmente.

## Memória cross-agent (Vitor ↔ Vitoria)

Você compartilha memória de projeto com o **Vitor** (agente de Design Session).
Ele cura o que ficou decidido, perguntas em aberto e contexto de negócio do
projeto — você lê tudo isso aqui no prompt (seção "Memória do projeto"). Se
precisar de detalhe que NÃO ESTÁ no prompt, puxe via tool:

- **list_active_design_sessions** — DS do projeto que ainda estão rolando.
  Use quando o PM citar uma session específica ou você quiser saber o que está
  sendo discutido em paralelo na planning.
- **read_design_session_memory(sessionId)** — markdown narrativo curado pelo
  Vitor (personas, hipóteses, descartado-e-por-quê). Use quando precisar do
  "porquê" detalhado de uma decisão ativa.
- **read_design_session_step(sessionId, stepKey)** — payload bruto de um step
  do wizard (personas_journeys, brainstorm, prioritization, briefing, etc).
  **Use só quando o resumo cross-agent não basta** — tem token cost alto.

E pra **gravar** o que você aprende na planning como memória durável do projeto:

- **append_project_memory(section, content, expectedVersion)** — anexa em uma
  seção do Project.memoryMd. Use quando o PM revelar info que vale lembrar
  cross-session: "esse cliente paga por integração", "runway encurtou pra 4
  meses", "stack confirmada Postgres". Passe \`expectedVersion\` lido da seção
  "Memória do projeto" abaixo. Vitor lê o mesmo markdown na próxima session.

**Quando escrever em project memory** (regra):
- Fato cross-session que afeta priorização futura → grava.
- Decisão que muda escopo do projeto (não só da sprint) → grava.
- Mudança de business context (runway, stage, ICP) → grava.
- Ruído de conversa, detalhe de uma única task, status report → NÃO grava.

## Regras importantes

- Sempre referencie o contexto real: nome de sprint, projeto, tasks existentes.
- Propostas devem ter aiReasoning claro — o PM precisa entender POR QUÊ você sugere cada ação.
- Ao editar/remover proposta, **use sempre o ID exato listado em "Propostas pendentes"**. Nunca invente ID nem tente adivinhar pelo título.
- Antes de propor 'create', verifique duplicatas com list_project_tasks.
- Antes de propor 'move', resolva o targetSprintId via list_project_sprints.
- Prefira propor ações "create" para tarefas novas identificadas nas transcrições.
- Para tarefas existentes com bloqueios, prefira "update" com as informações novas.
- Quando as transcrições indicam capacidade reduzida de um membro, adicione uma nota kind="capacity_signal".
- **Use a "Memória de sprints"** (seção do contexto): compare o total de PFV que você propõe pra esta sprint com a velocity média histórica — se ficar muito acima, sinalize risco de sobrecarga em vez de só propor. Continuidade é o ponto: você lembra do que aconteceu.
- **Carryover e temas de retro são sinal, não ruído.** Se uma sprint fechou com carryover alto ou um tema de retro recorrente (bloqueio repetido, escopo estourando), levante isso na planning e proponha ação concreta — não repita o mesmo erro silenciosamente.
- Nunca invente dados. Se não encontrou informação, diga explicitamente.
- **Nunca infira intent que o PM não expressou.** Se ele perguntou "X?",
  NÃO responda com "entendi, você quer que eu tente Y mesmo assim" —
  responda a pergunta literal. Se a pergunta dele é ambígua, pergunte
  explicitamente o que ele quer antes de chamar tool ou propor ação.
- **Toda ação que você afirma ter executado DEVE ter sido feita via tool
  NESTE TURNO.** Se você não chamou propose_task_action, NÃO diga "task
  criada". Se você não chamou update_proposed_action, NÃO diga "atualizada".
  Se você não chamou delete_proposed_action, NÃO diga "descartada/removida".
  Afirmar resultado sem executar a tool quebra a confiança do PM — ele
  segue acreditando que algo aconteceu e o backlog fica inconsistente.
  Se a tool falhou, diga que falhou. Se você decidiu não executar, diga
  POR QUÊ não executou. Nunca finja.

## Formato de resposta

Responda em português. Seja conciso, direto, orientado a ação.
Ao adicionar notas ou propostas, confirme brevemente o que foi feito.
Quando pedir mais contexto ao PM, limite a 1-2 perguntas por vez.`;

  // === Volatile: estado da planning + project profile ===
  const linkedMeetings = (agentContext.linkedMeetings as Array<{ meeting: { title: string | null; date: string } | null }> ?? [])
    .map((l) => l.meeting?.title ?? `reunião em ${l.meeting?.date ?? "?"}`)
    .join(", ") || "nenhuma";

  const linkedTranscriptsArr = (agentContext.linkedTranscripts as Array<{
    transcript: { id: string; title: string | null; source: string } | null;
  }> ?? []).filter((l) => l.transcript !== null);
  const linkedTranscripts = linkedTranscriptsArr.length > 0
    ? linkedTranscriptsArr
        .map((l) => {
          const t = l.transcript!;
          const label = t.title ?? `${t.source} sem título`;
          return `- id=${t.id} [${t.source}] ${label}`;
        })
        .join("\n")
    : "nenhum";

  const activeNotes = (agentContext.activeNotes as Array<{ kind: string; content: string }> ?? []);
  const notesBlock = activeNotes.length > 0
    ? activeNotes.map((n) => `[${n.kind}] ${n.content}`).join("\n")
    : "nenhuma nota de contexto ainda";

  const upcomingSprints = (agentContext.upcomingSprints as ProfileSprint[] | undefined) ?? [];
  const upcomingBlock = upcomingSprints.length > 0
    ? upcomingSprints.map((s) => `- id=${s.id} ${s.name} (${s.startDate} → ${s.endDate}, status=${s.status})`).join("\n")
    : "nenhuma sprint futura cadastrada";

  const squadMembers = (agentContext.squadMembers as ProfileSquadMember[] | undefined) ?? [];
  const squadBlock = squadMembers.length > 0
    ? squadMembers.map((m) => {
        const effective = Math.round(m.fpCapacity * (m.dedicationPercent / 100) * 10) / 10;
        return `- ${m.name} (${m.position ?? m.role}${m.seniority ? `, ${m.seniority}` : ""}) — capacity ${effective} PFV/semana`;
      }).join("\n")
    : "nenhum member no squad";

  const activeStories = (agentContext.activeStories as ProfileUserStory[] | undefined) ?? [];
  const storiesBlock = activeStories.length > 0
    ? activeStories.slice(0, 30).map((s) => `- ${s.reference ?? "(sem-ref)"} ${s.title} [${s.refinementStatus}]`).join("\n") +
      (activeStories.length > 30 ? `\n… +${activeStories.length - 30} stories (use list_project_tasks pra navegar)` : "")
    : "nenhuma user story ativa";

  const sprintScopeTasks = (agentContext.sprintScopeTasks as ProfileTask[] | undefined) ?? [];
  const tasksBlock = sprintScopeTasks.length > 0
    ? sprintScopeTasks.map((t) => `- ${t.reference ?? "(sem-ref)"} [${t.status}] ${t.title} (scope=${t.scope}, complex=${t.complexity}, fp=${t.functionPoints ?? "?"}, prio=${t.priority})`).join("\n")
    : "nenhuma task na sprint atual + próxima";

  const sprintBlockers = (agentContext.sprintBlockers as ProfileBlocker[] | undefined) ?? [];
  const blockersBlock = sprintBlockers.length > 0
    ? sprintBlockers.map((b) => `- task ${b.taskId} ${b.kind} task ${b.dependsOn}`).join("\n")
    : "nenhum bloqueio detectado";

  const repoOwner = agentContext.projectRepoOwner as string | null | undefined;
  const repoName = agentContext.projectRepoName as string | null | undefined;
  const repoUrl = agentContext.projectRepoUrl as string | null | undefined;
  const repoBranch = agentContext.projectRepoBranch as string | null | undefined;
  const repoManifest = agentContext.projectRepoManifest as string | null | undefined;
  const repoManifestUpdatedAt =
    agentContext.projectRepoManifestUpdatedAt as string | null | undefined;
  const githubConnected = Boolean(agentContext.githubConnected);
  const repoBlock = (() => {
    const lines: string[] = [];
    if (repoOwner && repoName) {
      lines.push(`- Owner: ${repoOwner}`);
      lines.push(`- Name: ${repoName}`);
      if (repoBranch) lines.push(`- Default branch: ${repoBranch}`);
      if (repoManifestUpdatedAt) {
        lines.push(`- Manifest gerado em: ${repoManifestUpdatedAt}`);
      } else {
        lines.push(`- Manifest: ❌ não gerado ainda (PM clica "Atualizar manifest" no Contexto)`);
      }
    } else if (repoUrl) {
      lines.push(`- URL: ${repoUrl} (sem owner/name parseados — extraia da URL)`);
    } else {
      lines.push("- (projeto não tem repo configurado — avise o PM)");
    }
    lines.push(
      `- GitHub conectado pelo facilitador: ${githubConnected ? "SIM (tools GITHUB_* disponíveis)" : "NÃO (sem tools — peça pro PM conectar em /settings)"}`,
    );
    return lines.join("\n");
  })();

  // Manifest: bloco grande (~5-8k tokens). Vai numa seção própria do volátil
  // pra Vitória ter awareness estrutural permanente do repo. Anthropic prompt
  // cache no engine pega isso → tokens são contados só na 1ª chamada da sessão.
  const repoManifestBlock = repoManifest
    ? `\n\n## Manifest do repositório (T1 — sempre disponível)\n\n${repoManifest}\n`
    : "";

  const pendingActions = (agentContext.pendingActions as PendingAction[] | undefined) ?? [];
  const pendingBlock = pendingActions.length > 0
    ? pendingActions.map((a) => `- id=${a.id} type=${a.type}${a.taskId ? ` taskId=${a.taskId}` : ""}${a.targetSprintId ? ` targetSprintId=${a.targetSprintId}` : ""}\n  payload: ${truncate(JSON.stringify(a.payload), 240)}\n  reasoning: ${truncate(a.aiReasoning ?? "(vazio)", 200)}`).join("\n")
    : "nenhuma proposta pendente";

  // === Memória cross-agent (curada pelo Vitor) ===
  const projectMemoryMd = (agentContext.projectMemoryMd as string | null) ?? null;
  const projectMemoryVersion = (agentContext.projectMemoryVersion as number | undefined) ?? 0;
  const projectMemoryBlock = projectMemoryMd && projectMemoryMd.trim().length > 0
    ? `${projectMemoryMd}\n\n_(version=${projectMemoryVersion} — use esse número em append_project_memory)_`
    : `_(sem memória de projeto ainda — version=${projectMemoryVersion})_`;

  const businessContext = (agentContext.businessContext as BusinessContext | null) ?? null;
  const businessBlock = businessContext
    ? [
        `- businessModel: ${businessContext.businessModel ?? "—"}`,
        `- stage: ${businessContext.stage ?? "—"}`,
        `- ICP: ${businessContext.icp ?? "—"}`,
        `- ticketRangeBrl: ${businessContext.ticketRangeBrl ?? "—"}`,
        `- runwayMonths: ${businessContext.runwayMonths ?? "—"}`,
      ].join("\n")
    : "_(business context não preenchido)_";

  const activeDecisions = (agentContext.activeDecisions as ActiveDecision[] | undefined) ?? [];
  const decisionsBlock = activeDecisions.length > 0
    ? activeDecisions.slice(0, 20).map((d) =>
        `- [${d.confidence}] ${d.statement} — ${truncate(d.rationale, 140)}${d.tags?.length ? ` (tags: ${d.tags.join(", ")})` : ""}`,
      ).join("\n") +
      (activeDecisions.length > 20 ? `\n… +${activeDecisions.length - 20} decisões` : "")
    : "nenhuma decisão ativa";

  const openQuestions = (agentContext.openQuestions as OpenQuestion[] | undefined) ?? [];
  const openQuestionsBlock = openQuestions.length > 0
    ? openQuestions.slice(0, 15).map((q) =>
        `- ${q.question}${q.blocksWhat ? ` (bloqueia: ${q.blocksWhat})` : ""}`,
      ).join("\n") +
      (openQuestions.length > 15 ? `\n… +${openQuestions.length - 15} perguntas` : "")
    : "nenhuma pergunta em aberto";

  const activeDesignSessions = (agentContext.activeDesignSessions as ActiveDesignSession[] | undefined) ?? [];
  const activeSessionsBlock = activeDesignSessions.length > 0
    ? activeDesignSessions.map((s) =>
        `- id=${s.id} [${s.type}/${s.status}] ${s.title}${s.memoryAbstract ? ` — ${truncate(s.memoryAbstract, 120)}` : ""}`,
      ).join("\n")
    : "nenhuma design session ativa";

  // Memória de sprints (D11) — digest determinístico das últimas concluídas.
  const sprintOutcomes = (agentContext.sprintOutcomes as SprintOutcome[] | undefined) ?? [];
  const outcomesBlock = sprintOutcomes.length > 0
    ? sprintOutcomes
        .map((o) => {
          const pct = o.totalCount > 0 ? Math.round((o.doneCount / o.totalCount) * 100) : 0;
          const head = `- **${o.name ?? "(sprint)"}** (até ${o.endDate ?? "?"}) — ${o.doneCount}/${o.totalCount} tasks (${pct}%), velocity ${o.velocityFp}/${o.plannedFp} PFV, carryover ${o.carryoverCount}${o.goal ? ` · objetivo: ${truncate(o.goal, 80)}` : ""}`;
          const retro: string[] = [];
          if (o.retro?.good) retro.push(`    ✓ ${truncate(o.retro.good, 160)}`);
          if (o.retro?.bad) retro.push(`    ✗ ${truncate(o.retro.bad, 160)}`);
          if (o.retro?.ideas) retro.push(`    💡 ${truncate(o.retro.ideas, 160)}`);
          return [head, ...retro].join("\n");
        })
        .join("\n")
    : "nenhuma sprint concluída ainda (primeira planning do projeto)";
  const avgVelocity = sprintOutcomes.length > 0
    ? Math.round((sprintOutcomes.reduce((s, o) => s + o.velocityFp, 0) / sprintOutcomes.length) * 10) / 10
    : null;
  const outcomesSection = `## Memória de sprints (últimas concluídas — continuidade)

${avgVelocity != null ? `**Velocity média**: ~${avgVelocity} PFV/sprint — calibre a capacidade desta planning contra esse número.\n\n` : ""}${outcomesBlock}`;

  const statusLabel = status === "closed" ? "Concluída" : "Em planejamento";

  const projectName = (agentContext.projectName as string | null) ?? null;
  const projectRefKey = (agentContext.projectReferenceKey as string | null) ?? null;
  const projectStatus = (agentContext.projectStatus as string | null) ?? null;
  const clientName = (agentContext.clientName as string | null) ?? null;
  const projectId = agentContext.projectId as string;

  const projectIdentityBlock = projectName
    ? `**Projeto**: ${projectName}${projectRefKey ? ` (${projectRefKey})` : ""}${projectStatus ? ` — status ${projectStatus}` : ""}
**Cliente**: ${clientName ?? "—"}
**projectId**: ${projectId}`
    : `**projectId**: ${projectId} _(nome não carregado — projeto pode ter sido removido)_`;

  const volatile = `${renderTodayBlock()}

## Projeto em que você está trabalhando

${projectIdentityBlock}

Tudo nesta sessão (sprints, stories, tasks, memória, decisões) é deste projeto.
Quando o PM perguntar "em qual projeto estamos?" responda com o nome acima.
Nunca peça projectId ao PM — você já tem.

## Estado atual da planning (ID: ${planId})

**Status**: ${statusLabel}
**Sprint**: ${agentContext.sprintName ?? "não definida"}
**Reuniões linkadas**: ${linkedMeetings}
**Fontes de contexto linkadas** (use esses IDs em read_context_source):
${linkedTranscripts}

## Project profile

### Sprints próximas (use estes IDs em move/list_project_sprints)
${upcomingBlock}

### Squad
${squadBlock}

### User stories ativas (draft/committed)
${storiesBlock}

### Tasks da sprint atual + próxima
${tasksBlock}

### Bloqueios detectados na sprint
${blockersBlock}

### Repositório do projeto
${repoBlock}${repoManifestBlock}

${outcomesSection}

## Sessão

### Notas de contexto ativas
${notesBlock}

### Propostas pendentes (use estes IDs em update_proposed_action / delete_proposed_action)
${pendingBlock}

## Memória do projeto (curada pelo Vitor — cross-agent)

### Business context
${businessBlock}

### Decisões ativas (DesignDecision)
${decisionsBlock}

### Perguntas em aberto (DesignOpenQuestion)
${openQuestionsBlock}

### Design sessions ativas (use estes IDs em read_design_session_memory / read_design_session_step)
${activeSessionsBlock}

### Project memory (markdown — Vitor escreve, você lê e pode anexar)
${projectMemoryBlock}`;

  return { stable, volatile };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
