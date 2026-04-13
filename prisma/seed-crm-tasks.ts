import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROJECT_ID = "cmngge4e00002p3j0ab9khnn9"; // CRM de Marketing

const tasks = [
  // ═══ Release 0 — Fundacao ═══
  {
    reference: "TASK-001",
    title: "Setup do projeto Next.js + Prisma + Tailwind",
    description: "Criar o projeto Next.js do zero com toda a infraestrutura base configurada e funcionando.",
    type: "setup",
    scope: "medium",
    complexity: "medium",
    functionPoints: 8,
    dependencies: null,
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Projeto Next.js 16 criado com TypeScript
- [ ] Tailwind CSS 4 configurado com tema dark/light
- [ ] shadcn/ui inicializado (Button, Input, Label, Card, Badge, Dialog, Select, Separator, Tooltip, Skeleton)
- [ ] Prisma configurado com SQLite (prisma/dev.db)
- [ ] Path alias @/ apontando para src/
- [ ] Layout raiz com font Inter/Geist, metadata pt-BR
- [ ] start.sh que roda prisma generate + db push + next dev --port 3000
- [ ] .env com DATABASE_URL="file:./dev.db"
- [ ] ESLint + TypeScript strict configurados
- [ ] .gitignore incluindo dev.db, .next, node_modules`,
    technicalNotes: `npx create-next-app@latest crm-marketing --typescript --tailwind --eslint --app --src-dir
npx shadcn@latest init
npx prisma init --datasource-provider sqlite

Estrutura de pastas:
src/
  app/
    layout.tsx
    (auth)/          → paginas publicas (login callback)
    (app)/           → paginas autenticadas com sidebar
      layout.tsx     → sidebar + topbar
      page.tsx       → dashboard
  components/
    ui/              → shadcn components
    shared/          → componentes reutilizaveis do CRM
  lib/
    prisma.ts        → singleton PrismaClient
    utils.ts         → cn() helper
  hooks/`,
    businessContext: "Fundacao do projeto CRM para MarketPro Solutions. Sem essa base, nenhuma outra task pode ser iniciada.",
  },
  {
    reference: "TASK-002",
    title: "Schema Prisma — modelo de dados completo",
    description: "Criar o schema Prisma com todos os models necessarios para o CRM, cobrindo contatos, empresas, deals, atividades, pipeline, tags, follow-ups e configuracao de usuario.",
    type: "feature",
    scope: "large",
    complexity: "high",
    functionPoints: 21,
    dependencies: JSON.stringify(["TASK-001"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Model User (id, name, email, avatarUrl, role: admin|manager|sdr, createdAt, updatedAt)
- [ ] Model Company (id, name, website, industry, size, notes, createdAt, updatedAt)
- [ ] Model Contact (id, firstName, lastName, email, phone, companyId?, source, sourceDetail, score:Int default 0, tags → ContactTag[], ownerId → User, createdAt, updatedAt)
- [ ] Model Deal (id, title, value:Float?, contactId, companyId?, stageId, ownerId → User, closedAt?, lostReason?, createdAt, updatedAt)
- [ ] Model PipelineStage (id, name, position:Int, color, isDefault:Boolean, isClosedWon:Boolean, isClosedLost:Boolean)
- [ ] Model Activity (id, type: call|email|whatsapp|note|meeting|task, subject, description?, contactId, dealId?, userId, dueAt?, completedAt?, createdAt)
- [ ] Model Tag (id, name, color, createdAt) + ContactTag (contactId, tagId, junction)
- [ ] Model Campaign (id, name, source, totalSpent:Float default 0, startDate?, endDate?, createdAt)
- [ ] Model LeadCapture (id, contactId, campaignId?, channel, rawPayload:String?, capturedAt)
- [ ] Model FollowUp (id, contactId, dealId?, userId, dueDate, note?, status: pending|done|skipped, completedAt?, createdAt)
- [ ] Todas as relacoes com onDelete appropriate (Cascade para junction, SetNull para optional)
- [ ] Indices em: Contact.email, Contact.score, Deal.stageId, Activity.contactId+createdAt, FollowUp.userId+status+dueDate
- [ ] Migration rodando sem erros`,
    technicalNotes: `Contact.source deve ser enum-like string: google_ads, meta_ads, webhook, csv_import, manual, referral.

PipelineStage vem pre-populado pelo seed com: Novo (position 0), Contatado (1), Qualificado (2), Proposta (3), Negociacao (4), Fechado Ganho (5, isClosedWon), Fechado Perdido (6, isClosedLost).

Activity.type e string, nao enum, para extensibilidade.

LeadCapture armazena o payload bruto do webhook/API para debug e re-processamento.`,
    businessContext: "Modelo de dados e a fundacao de todo o CRM. Define como contatos, empresas, deals, atividades e campanhas se relacionam.",
  },
  {
    reference: "TASK-003",
    title: "Auth wrapper — integracao com auth do cliente",
    description: "Criar camada de autenticacao que recebe o token/session do sistema de auth do cliente, valida e disponibiliza o usuario logado em toda a aplicacao. Para o prototipo, usar mock com usuario fixo.",
    type: "feature",
    scope: "small",
    complexity: "medium",
    functionPoints: 5,
    dependencies: JSON.stringify(["TASK-001", "TASK-002"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] src/lib/auth.ts exporta getCurrentUser() que retorna { id, name, email, role } ou null
- [ ] Implementacao mock: retorna usuario fixo (seeded) — facil de trocar por auth real depois
- [ ] src/lib/auth-context.tsx — React Context com useCurrentUser() hook
- [ ] src/app/(app)/layout.tsx wrapa children com AuthProvider
- [ ] Middleware (middleware.ts) que redireciona para /login se nao autenticado
- [ ] Pagina /login mock com botao "Entrar como Carolina" / "Entrar como Rafael" / "Entrar como Marcos"
- [ ] Cookie crm_user_id setado no login mock, lido pelo getCurrentUser()
- [ ] getCurrentUser() funciona tanto em Server Components (via cookies) quanto Client Components (via context)`,
    technicalNotes: `Contrato da funcao:
// lib/auth.ts
export async function getCurrentUser(): Promise<User | null> {
  const userId = cookies().get("crm_user_id")?.value;
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

Auth do cliente sera: header Authorization: Bearer <token>. No prototipo usamos cookie mock.`,
    businessContext: "Auth integrada pelo cliente. Prototipo usa mock para agilizar desenvolvimento. 3 personas: Carolina (manager), Rafael (sdr), Marcos (admin/CEO).",
  },
  {
    reference: "TASK-004",
    title: "Seed de dados mock",
    description: "Criar script de seed que popula o banco com dados realistas para testar todas as features do CRM.",
    type: "seed",
    scope: "medium",
    complexity: "medium",
    functionPoints: 8,
    dependencies: JSON.stringify(["TASK-002"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] 3 usuarios: Carolina (manager), Rafael (sdr), Marcos (admin)
- [ ] 6 pipeline stages pre-configurados (Novo → Fechado Ganho/Perdido)
- [ ] 5 empresas com dados realistas (PMEs brasileiras)
- [ ] 30 contatos distribuidos entre as empresas, com scores variados (0-100)
- [ ] 15 deals em stages variados (3 por stage + 3 fechados)
- [ ] 8 tags: "Google Ads", "Meta Ads", "Indicacao", "Quente", "Frio", "B2B", "E-commerce", "SaaS"
- [ ] Tags atribuidas a contatos (ContactTag)
- [ ] 50 atividades (mix de call, email, whatsapp, note) distribuidas nos ultimos 30 dias
- [ ] 3 campanhas: "Google Ads - Abril", "Instagram - Awareness", "Email - Nutricao"
- [ ] 10 follow-ups: 5 pending (proximos 7 dias), 3 done, 2 overdue
- [ ] Script em prisma/seed.ts, rodavel com npx tsx prisma/seed.ts
- [ ] Seed e idempotente (usa upsert ou deleta antes de inserir)`,
    technicalNotes: `Nomes brasileiros realistas. Telefones (11) 99999-XXXX. Emails coerentes com nomes. Datas nos ultimos 30 dias.
Scores coerentes: leads com mais atividades recentes = score mais alto. Deals entre R$5.000 e R$150.000.`,
    businessContext: "Dados mock permitem testar todas as features sem depender de integracao real. Essencial para demos e validacao com o cliente.",
  },
  {
    reference: "TASK-005",
    title: "Componente reutilizavel — DataTable",
    description: "Criar componente DataTable generico e reutilizavel que sera usado em todas as listagens do CRM (contatos, empresas, deals, atividades).",
    type: "component",
    scope: "medium",
    complexity: "high",
    functionPoints: 13,
    dependencies: JSON.stringify(["TASK-001"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] src/components/shared/data-table.tsx
- [ ] Props tipadas com generics: DataTable<T> onde T e o tipo da row
- [ ] Definicao de colunas via array: { key, header, render?, sortable?, width? }
- [ ] Busca/filtro por texto (filtra client-side no array)
- [ ] Ordenacao clicando no header (asc/desc toggle)
- [ ] Selecao de rows com checkbox (opcional via prop selectable)
- [ ] Acoes em bulk quando rows selecionadas (prop bulkActions)
- [ ] Empty state customizavel (prop emptyMessage e emptyIcon)
- [ ] Loading state com Skeleton rows
- [ ] Paginacao client-side (10/25/50 por pagina)
- [ ] Row click handler (prop onRowClick)
- [ ] Responsivo: em mobile, colunas com hideOnMobile ficam ocultas`,
    technicalNotes: `Uso esperado:
<DataTable
  data={contacts}
  columns={[
    { key: "name", header: "Nome", sortable: true, render: (row) => <span>{row.firstName} {row.lastName}</span> },
    { key: "email", header: "Email", sortable: true },
    { key: "score", header: "Score", sortable: true, render: (row) => <ScoreBadge score={row.score} /> },
  ]}
  searchKeys={["firstName", "lastName", "email"]}
  onRowClick={(row) => router.push(\`/contacts/\${row.id}\`)}
  selectable
/>

Usar useState para sort, page, search. Nao usar libs externas. Manter simples.`,
    businessContext: "Componente base para todas as listagens do CRM. Usado por TASK-010 (contatos), TASK-012 (empresas), TASK-017 (follow-ups), TASK-023 (atividades), TASK-024 (campanhas).",
  },
  {
    reference: "TASK-006",
    title: "Componente reutilizavel — KanbanBoard",
    description: "Criar componente KanbanBoard generico com drag-and-drop que sera usado para o pipeline de deals e potencialmente para outros contextos.",
    type: "component",
    scope: "medium",
    complexity: "high",
    functionPoints: 13,
    dependencies: JSON.stringify(["TASK-001"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] src/components/shared/kanban-board.tsx
- [ ] Props tipadas com generics: KanbanBoard<T>
- [ ] Colunas definidas via prop columns: { id, title, color?, count? }[]
- [ ] Cards definidos via prop items: T[] + getColumnId: (item: T) => string
- [ ] Drag-and-drop entre colunas usando @dnd-kit/core + @dnd-kit/sortable
- [ ] Callback onMove(itemId, fromColumnId, toColumnId) disparado ao dropar
- [ ] Card renderizado via prop renderCard: (item: T) => ReactNode
- [ ] Header de coluna mostra titulo + contagem de items
- [ ] Scroll horizontal quando colunas excedem a tela
- [ ] Scroll vertical dentro de cada coluna quando cards excedem altura
- [ ] Placeholder visual ao arrastar ("drop here")
- [ ] Loading state por coluna (Skeleton cards)
- [ ] Responsivo: em mobile, colunas empilham verticalmente com collapse`,
    technicalNotes: `Usar @dnd-kit/core para DnD. Sensores: pointer + keyboard. Collision detection: closestCorners.

Uso esperado:
<KanbanBoard
  columns={stages.map(s => ({ id: s.id, title: s.name, color: s.color }))}
  items={deals}
  getColumnId={(deal) => deal.stageId}
  onMove={async (dealId, _, toStageId) => {
    await fetch(\`/api/deals/\${dealId}\`, { method: "PATCH", body: JSON.stringify({ stageId: toStageId }) });
  }}
  renderCard={(deal) => <DealCard deal={deal} />}
/>`,
    businessContext: "Componente de kanban usado pelo pipeline de deals (TASK-013). Generico para potencial reuso em outros contextos.",
  },
  {
    reference: "TASK-007",
    title: "Componente reutilizavel — StatsCard + MiniChart",
    description: "Criar componentes de metricas reutilizaveis para dashboards: card com numero grande + label + variacao, e mini grafico sparkline em SVG puro.",
    type: "component",
    scope: "small",
    complexity: "medium",
    functionPoints: 5,
    dependencies: JSON.stringify(["TASK-001"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] src/components/shared/stats-card.tsx
  - Props: title, value, subtitle?, icon?, trend?: { value: number, direction: "up"|"down" }, onClick?
  - Trend mostra seta verde (up) ou vermelha (down) com percentual
  - Hover state se onClick definido
- [ ] src/components/shared/mini-chart.tsx
  - Props: data: number[], color?, height?: number, width?: number
  - Renderiza sparkline em SVG puro (polyline), sem libs externas
  - Preenche area abaixo da linha com gradiente sutil
  - Tooltip no hover mostrando valor do ponto
- [ ] Ambos responsivos e com loading state (Skeleton)`,
    technicalNotes: `SVG sparkline formula:
const points = data.map((v, i) => \`\${(i / (data.length - 1)) * width},\${height - (v / max) * height}\`).join(" ");

Usado pelo dashboard ROI (TASK-022).`,
    businessContext: "Componentes visuais para o dashboard principal. Persona Carolina e Marcos precisam ver metricas rapidamente.",
  },
  {
    reference: "TASK-008",
    title: "Componente reutilizavel — ActivityTimeline",
    description: "Componente de timeline vertical para exibir historico de atividades de um contato ou deal.",
    type: "component",
    scope: "small",
    complexity: "medium",
    functionPoints: 5,
    dependencies: JSON.stringify(["TASK-001"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] src/components/shared/activity-timeline.tsx
- [ ] Props: activities: Activity[] com { id, type, subject, description?, user, createdAt, completedAt? }
- [ ] Icone por tipo: call (Phone), email (Mail), whatsapp (MessageCircle), note (StickyNote), meeting (Calendar), task (CheckSquare)
- [ ] Cor por tipo: call=blue, email=purple, whatsapp=green, note=gray, meeting=orange, task=yellow
- [ ] Linha vertical conectando os items (timeline visual)
- [ ] Cada item mostra: icone, subject, user name, tempo relativo ("ha 2h", "ontem", "15 mar")
- [ ] Expandir/colapsar description se existir
- [ ] Botao "Carregar mais" se lista > 20 items
- [ ] Empty state: "Nenhuma atividade registrada"`,
    technicalNotes: `Usar Intl.RelativeTimeFormat("pt-BR") para tempos relativos. Fallback para data absoluta se > 7 dias.

Usado por TASK-011 (detalhe contato) e TASK-013 (slide-over do deal).`,
    businessContext: "Timeline de atividades e essencial para o SDR (Rafael) ver historico do lead antes de ligar. Contexto = conversa melhor.",
  },
  {
    reference: "TASK-009",
    title: "Layout da aplicacao — Sidebar + Topbar",
    description: "Criar o layout autenticado do CRM com sidebar de navegacao e topbar com info do usuario.",
    type: "feature",
    scope: "small",
    complexity: "low",
    functionPoints: 3,
    dependencies: JSON.stringify(["TASK-001", "TASK-003"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] src/app/(app)/layout.tsx com sidebar + area de conteudo
- [ ] Sidebar com navegacao: Dashboard, Contatos, Empresas, Pipeline, Atividades, Follow-ups, Campanhas, Configuracoes
- [ ] Cada item com icone Lucide correspondente
- [ ] Indicador de item ativo baseado na rota
- [ ] Topbar com: nome do usuario logado, avatar placeholder, botao de logout
- [ ] Sidebar colapsavel (icone only) em desktop
- [ ] Em mobile: sidebar como sheet (slide-over)
- [ ] Branding: "CRM Marketing" + logo placeholder no topo da sidebar`,
    technicalNotes: `Reusar padrao do Volund com SidebarProvider. Rotas:
/(app)/                  → dashboard
/(app)/contacts          → listagem contatos
/(app)/contacts/[id]     → detalhe contato
/(app)/companies         → listagem empresas
/(app)/pipeline          → kanban deals
/(app)/activities        → listagem atividades
/(app)/follow-ups        → listagem follow-ups
/(app)/campaigns         → listagem campanhas
/(app)/settings          → configuracoes (pipeline stages, tags)`,
    businessContext: "Layout compartilhado por todas as paginas autenticadas. Navegacao principal do CRM.",
  },

  // ═══ Release 1 — Base + Pipeline ═══
  {
    reference: "TASK-010",
    title: "CRUD de Contatos — listagem e criacao",
    description: "Pagina de listagem de contatos usando DataTable com busca, filtro por tag e ordenacao. Dialog de criacao de novo contato.",
    type: "feature",
    scope: "medium",
    complexity: "medium",
    functionPoints: 8,
    dependencies: JSON.stringify(["TASK-002", "TASK-005", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/contacts/page.tsx
- [ ] Usa componente DataTable (TASK-005)
- [ ] Colunas: Nome, Email, Telefone, Empresa, Score (badge colorido), Tags (badges), Owner, Criado em
- [ ] Busca por nome, email, telefone
- [ ] Filtro por tag (multi-select dropdown)
- [ ] Filtro por source (select)
- [ ] Filtro por score range (Frio 0-30, Morno 31-70, Quente 71-100)
- [ ] Ordenacao por nome, score, criado em
- [ ] Selecao bulk com acoes: "Adicionar tag", "Remover tag", "Atribuir owner"
- [ ] Botao "Novo Contato" abre dialog
- [ ] Dialog de criacao: firstName, lastName, email, phone, companyId, source, tags, owner
- [ ] Validacao: firstName obrigatorio, email unico se preenchido
- [ ] API: GET /api/contacts (com query params) + POST /api/contacts`,
    technicalNotes: `API GET deve suportar:
GET /api/contacts?search=joao&tag=quente&source=google_ads&scoreMin=50&scoreMax=100&sort=score&order=desc&page=1&limit=25

Score badge cores: 0-30 gray, 31-70 yellow, 71-100 green.`,
    businessContext: "Listagem de contatos e a pagina mais acessada do CRM. Carolina e Rafael usam diariamente.",
  },
  {
    reference: "TASK-011",
    title: "Detalhe do Contato — perfil + timeline",
    description: "Pagina de detalhe do contato com informacoes completas, timeline de atividades, deals vinculados e acoes rapidas.",
    type: "feature",
    scope: "medium",
    complexity: "medium",
    functionPoints: 8,
    dependencies: JSON.stringify(["TASK-008", "TASK-010"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/contacts/[id]/page.tsx
- [ ] Header: nome completo, empresa, score badge, tags, botao editar, botao deletar
- [ ] Secao de informacoes: email (mailto), phone (tel), source, owner, criado em, atualizado em
- [ ] Tabs: Timeline | Deals | Detalhes
- [ ] Tab Timeline: usa ActivityTimeline (TASK-008), mostra atividades do contato
- [ ] Tab Timeline: formulario inline para adicionar atividade
- [ ] Tab Deals: lista de deals vinculados com stage, valor, owner
- [ ] Tab Detalhes: campos editaveis inline (click-to-edit)
- [ ] Tags editaveis: click abre multi-select para add/remove
- [ ] API: GET/PUT/DELETE /api/contacts/[id] + POST /api/contacts/[id]/activities`,
    technicalNotes: `Query GET com include: company, owner, tags.tag, deals.stage, activities (take 20, desc), followUps (pending).`,
    businessContext: "Rafael precisa ver timeline completa do lead antes de ligar. Conversa contextualizada = lead se sente atendido.",
  },
  {
    reference: "TASK-012",
    title: "CRUD de Empresas",
    description: "Pagina simples de listagem e CRUD de empresas. Empresas sao entidades de suporte para vincular contatos.",
    type: "feature",
    scope: "small",
    complexity: "low",
    functionPoints: 3,
    dependencies: JSON.stringify(["TASK-005", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/companies/page.tsx
- [ ] Usa DataTable com colunas: Nome, Website, Setor, Tamanho, N contatos, Criado em
- [ ] Busca por nome
- [ ] Dialog de criacao/edicao: name, website, industry, size (1-10, 11-50, 51-200, 200+), notes
- [ ] Botao deletar com confirmacao
- [ ] Click na row abre dialog de edicao
- [ ] API: GET/POST /api/companies + PUT/DELETE /api/companies/[id]`,
    technicalNotes: `Contagem de contatos via _count: { select: { contacts: true } } no Prisma include.`,
    businessContext: "Empresas sao entidades de suporte. Contatos sao vinculados a empresas para contexto B2B.",
  },
  {
    reference: "TASK-013",
    title: "Pipeline visual — Kanban de Deals",
    description: "Pagina de pipeline com Kanban onde cada coluna e um stage e cada card e um deal. Drag-and-drop move o deal entre stages.",
    type: "feature",
    scope: "medium",
    complexity: "high",
    functionPoints: 13,
    dependencies: JSON.stringify(["TASK-002", "TASK-006", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/pipeline/page.tsx
- [ ] Usa componente KanbanBoard (TASK-006)
- [ ] Colunas: pipeline stages ordenados por position
- [ ] Cada card mostra: titulo do deal, nome do contato, valor (R$), owner, tempo no stage
- [ ] Drag-and-drop atualiza deal.stageId via PATCH /api/deals/[id]
- [ ] Header da coluna: nome + count + soma de valores
- [ ] Filtros: owner, valor min/max, busca
- [ ] Botao "Novo Deal" abre dialog
- [ ] Secao colapsavel "Fechados" no bottom
- [ ] Click no card abre slide-over (Sheet) com detalhes + timeline
- [ ] API: GET/POST /api/deals + PATCH/GET /api/deals/[id]`,
    technicalNotes: `PATCH de deal deve registrar Activity automatica: "Deal movido de {fromStage} para {toStage}".
Valor total no header: deals.filter(d => d.stageId === stage.id).reduce((s, d) => s + (d.value ?? 0), 0).`,
    businessContext: "Pipeline visual e o core do CRM para o time de vendas. Rafael move deals entre stages conforme avanca negociacao.",
  },
  {
    reference: "TASK-014",
    title: "Importacao de contatos via CSV",
    description: "Permitir importar contatos a partir de arquivo CSV com mapeamento de colunas, preview, deteccao de duplicatas e feedback de resultado.",
    type: "feature",
    scope: "medium",
    complexity: "high",
    functionPoints: 13,
    dependencies: JSON.stringify(["TASK-002", "TASK-010"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Botao "Importar CSV" na pagina de contatos abre dialog multi-step
- [ ] Step 1 — Upload: drag-and-drop + input file. Aceita .csv/.txt. Max 5MB
- [ ] Step 2 — Mapeamento: preview 5 primeiras linhas + selects para mapear colunas
- [ ] Step 3 — Preview: contagem de importar/duplicados/erros. Checkbox merge
- [ ] Step 4 — Resultado: X importados, Y atualizados, Z pulados
- [ ] Parser CSV client-side (sem lib)
- [ ] API: POST /api/contacts/import com upsert por email
- [ ] Se companyName nao existe → cria Company
- [ ] Tags por string separada por virgula`,
    technicalNotes: `Parser CSV: detectar delimitador (virgula ou ponto-e-virgula). Tratamento de aspas.
Import transacional: prisma.$transaction(). Limite 1000 registros.`,
    businessContext: "Carolina precisa migrar leads de planilhas existentes. Eliminacao de entrada manual e duplicatas.",
  },
  {
    reference: "TASK-015",
    title: "Exportacao de contatos para CSV",
    description: "Exportar a lista de contatos (com filtros aplicados) como arquivo CSV.",
    type: "feature",
    scope: "small",
    complexity: "low",
    functionPoints: 3,
    dependencies: JSON.stringify(["TASK-010"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Botao "Exportar CSV" na pagina de contatos
- [ ] Exporta com os mesmos filtros ativos
- [ ] Colunas: Nome, Sobrenome, Email, Telefone, Empresa, Score, Source, Tags, Owner, Criado em
- [ ] Download direto no browser (Blob + URL.createObjectURL)
- [ ] Nome do arquivo: contatos_YYYY-MM-DD.csv
- [ ] Encoding UTF-8 com BOM (para Excel reconhecer acentos)`,
    technicalNotes: `const BOM = "\\ufeff";
Gerar CSV client-side a partir dos dados ja carregados (com filtros aplicados).`,
    businessContext: "Carolina precisa compartilhar listas filtradas com equipe e parceiros.",
  },
  {
    reference: "TASK-016",
    title: "Sistema de Tags — CRUD e atribuicao",
    description: "Gerenciamento de tags e atribuicao a contatos. Tags sao coloridas e reutilizaveis.",
    type: "feature",
    scope: "small",
    complexity: "medium",
    functionPoints: 5,
    dependencies: JSON.stringify(["TASK-002", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Pagina /(app)/settings/page.tsx com secao "Tags"
- [ ] Lista de tags com nome, cor (bolinha), contagem de contatos
- [ ] Criar tag: input name + color picker (8 cores preset)
- [ ] Editar tag: click no nome torna editavel inline
- [ ] Deletar tag: confirmacao + remove ContactTags
- [ ] Componente TagPicker reutilizavel em src/components/shared/tag-picker.tsx
  - Multi-select dropdown com busca
  - Tags selecionadas como badges removiveis
  - Opcao "Criar nova tag" inline
  - Props: selectedIds, onChange(ids), allowCreate?
- [ ] API: GET/POST/PUT/DELETE /api/tags + POST /api/contacts/[id]/tags`,
    technicalNotes: `Cores preset: ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"].
TagPicker usado em: criacao contato, detalhe contato, import CSV, bulk actions.`,
    businessContext: "Tags permitem segmentacao de contatos para campanhas direcionadas. Essencial para Carolina.",
  },
  {
    reference: "TASK-017",
    title: "Follow-ups — listagem e gestao",
    description: "Pagina dedicada de follow-ups onde o usuario ve seus pendentes organizados por urgencia, e pode marcar como feito, pular ou reagendar.",
    type: "feature",
    scope: "medium",
    complexity: "medium",
    functionPoints: 8,
    dependencies: JSON.stringify(["TASK-002", "TASK-005", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/follow-ups/page.tsx
- [ ] Tres secoes visuais: Atrasados (vermelho), Hoje (amarelo), Proximos 7 dias (neutro)
- [ ] Cada card: nome do contato (link), deal, nota, dueDate, botoes de acao
- [ ] Acoes: "Feito" (status=done + dialog atividade), "Pular" (status=skipped), "Reagendar" (date picker)
- [ ] Botao "Novo Follow-up" com dialog
- [ ] Filtro por owner (admin ve todos, SDR ve so os seus)
- [ ] Contador no sidebar: badge com pendentes (atrasados + hoje)
- [ ] API: GET/POST /api/follow-ups + PATCH /api/follow-ups/[id]`,
    technicalNotes: `Query para contagem no sidebar:
prisma.followUp.count({ where: { userId, status: "pending", dueDate: { lt: startOfToday() } } })

Ao marcar "Feito", sugerir criar proximo follow-up.`,
    businessContext: "Rafael esquece 30% dos follow-ups hoje. Sistema de lembretes automaticos elimina esse problema.",
  },
  {
    reference: "TASK-018",
    title: "Configuracao de Pipeline Stages",
    description: "Permitir customizar os stages do pipeline na pagina de configuracoes.",
    type: "feature",
    scope: "small",
    complexity: "medium",
    functionPoints: 5,
    dependencies: JSON.stringify(["TASK-002", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Secao "Pipeline" em /(app)/settings/page.tsx
- [ ] Lista sortavel (drag-and-drop) dos stages
- [ ] Cada stage: cor (bolinha), nome (editavel inline), flags (isClosedWon, isClosedLost)
- [ ] Adicionar novo stage: input + color picker + position auto
- [ ] Remover stage: so permite se nao tem deals vinculados
- [ ] Reordenar via drag-and-drop (atualiza position)
- [ ] Protecao: nao permite remover stages closed
- [ ] API: GET/POST/PUT/DELETE /api/pipeline-stages + PUT /api/pipeline-stages/reorder`,
    technicalNotes: `Reorder endpoint:
PUT /api/pipeline-stages/reorder
Body: { ids: string[] }
prisma.$transaction(ids.map((id, i) => prisma.pipelineStage.update({ where: { id }, data: { position: i } })))`,
    businessContext: "Diferentes clientes podem ter pipelines diferentes. Customizacao e essencial.",
  },

  // ═══ Release 2 — Captura + Visibilidade ═══
  {
    reference: "TASK-019",
    title: "Captura de leads via webhook generico",
    description: "Endpoint de webhook que recebe leads de fontes externas (formularios, landing pages, Typeform, Google Forms) e cria contato automaticamente no CRM.",
    type: "feature",
    scope: "medium",
    complexity: "medium",
    functionPoints: 8,
    dependencies: JSON.stringify(["TASK-002", "TASK-010"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] POST /api/webhooks/lead-capture — endpoint publico (sem auth)
- [ ] Aceita JSON flexivel: name/firstName+lastName, email, phone, company, source, tags, campaign
- [ ] Validacao: email obrigatorio, formato valido
- [ ] Se contato existe (por email) → atualiza (merge)
- [ ] Cria registro LeadCapture com rawPayload
- [ ] Se campaign informado → vincula por nome
- [ ] Se tags informado → busca/cria e vincula
- [ ] Source default: "webhook"
- [ ] Score inicial: 10
- [ ] Retorna 201 com { contactId, created: true/false }
- [ ] Settings: secao "Webhooks" com URL + exemplos + log das ultimas 10 capturas`,
    technicalNotes: `Payload esperado (todos opcionais exceto email):
{ email, firstName, lastName, phone, company, source, campaign, tags, custom: { utm_source, utm_campaign } }
Campo custom salvo no rawPayload mas nao processado.`,
    businessContext: "Eliminacao de entrada manual. Leads de formularios entram automaticamente no CRM.",
  },
  {
    reference: "TASK-020",
    title: "Captura mock — Google Ads e Meta Ads",
    description: "Criar endpoints mock que simulam a captura de leads do Google Ads e Meta Ads, gerando dados aleatorios para testar o fluxo completo.",
    type: "seed",
    scope: "small",
    complexity: "low",
    functionPoints: 3,
    dependencies: JSON.stringify(["TASK-019"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] POST /api/mock/google-ads-capture — gera 5 leads com source="google_ads"
- [ ] POST /api/mock/meta-ads-capture — gera 5 leads com source="meta_ads"
- [ ] Leads com nomes brasileiros aleatorios, emails, telefones
- [ ] Vincula a campanha correspondente
- [ ] Settings: secao "Simulacoes" com botoes + resultado`,
    technicalNotes: `Pool de nomes:
const firstNames = ["Ana", "Pedro", "Maria", "Carlos", "Julia", "Rafael", "Camila", "Lucas", "Fernanda", "Bruno"];
const lastNames = ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira", "Almeida", "Ribeiro"];`,
    businessContext: "Mocks permitem testar fluxo de captura sem credenciais reais de Google/Meta Ads.",
  },
  {
    reference: "TASK-021",
    title: "Lead Scoring automatico",
    description: "Sistema de scoring automatico que calcula o score de cada lead baseado em engajamento (atividades) e recencia, atualizando periodicamente.",
    type: "feature",
    scope: "medium",
    complexity: "high",
    functionPoints: 13,
    dependencies: JSON.stringify(["TASK-002", "TASK-011"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] src/lib/lead-scoring.ts com funcao calculateScore(contactId): number
- [ ] Regras de scoring (pesos):
  +10 por call nos ultimos 7 dias
  +5 por email nos ultimos 7 dias
  +8 por whatsapp nos ultimos 7 dias
  +3 por meeting nos ultimos 30 dias
  +2 por tag positiva (Quente, B2B)
  -5 se nenhuma atividade em 14 dias
  -10 se nenhuma atividade em 30 dias
  +15 se tem deal em stage >= Qualificado
  Cap: 0-100
- [ ] POST /api/contacts/recalculate-scores — batch recalcula todos
- [ ] Score recalculado ao adicionar atividade ou mover deal
- [ ] Badge de score com gradiente: 0-30 Frio, 31-70 Morno, 71-100 Quente
- [ ] Tooltip com breakdown do score`,
    technicalNotes: `export async function calculateScore(contactId: string): Promise<number> {
  // Query atividades dos ultimos 30 dias
  // Aplicar pesos por tipo e recencia
  // Verificar deals vinculados
  // Clamp 0-100
}`,
    businessContext: "SDR prioriza quem tem score mais alto. Automatiza a qualificacao que hoje e feita no feeling.",
  },
  {
    reference: "TASK-022",
    title: "Dashboard de ROI por campanha/canal",
    description: "Dashboard principal do CRM mostrando metricas de marketing: funil de conversao, ROI por campanha, leads por canal, e evolucao temporal.",
    type: "feature",
    scope: "large",
    complexity: "high",
    functionPoints: 21,
    dependencies: JSON.stringify(["TASK-002", "TASK-007", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/page.tsx (homepage = dashboard)
- [ ] Linha 1 — Stats Cards (TASK-007): Total leads, Leads quentes, Deals abertos, Taxa conversao, CAC medio
- [ ] Linha 2 — Funil de conversao: barras horizontais por stage + % conversao entre stages
- [ ] Linha 3 — ROI por Campanha: tabela com investimento, leads, deals won, receita, ROI
- [ ] Linha 4 — Evolucao temporal: MiniChart leads/semana + deals won/semana (3 meses)
- [ ] Linha 5 — Top 10 leads quentes por score
- [ ] Filtro de periodo: Ultimo mes, 3 meses, Este ano, Custom
- [ ] API: GET /api/dashboard?period=30d`,
    technicalNotes: `ROI por campanha: para cada campanha, contar leadCaptures, depois verificar deals won dos contatos capturados. ROI = (receita - investimento) / investimento.

Funil: prisma.pipelineStage.findMany({ orderBy: { position: "asc" }, include: { _count: { select: { deals: true } } } })

Trend: comparar count ultimos 30d vs 30-60d.`,
    businessContext: "Dashboard principal para Carolina (investimento vs retorno) e Marcos (visao executiva). Decisao de onde investir verba baseada em dados reais.",
  },
  {
    reference: "TASK-023",
    title: "Listagem de Atividades",
    description: "Pagina de listagem global de atividades com filtros por tipo, usuario e periodo.",
    type: "feature",
    scope: "small",
    complexity: "low",
    functionPoints: 3,
    dependencies: JSON.stringify(["TASK-005", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/activities/page.tsx
- [ ] Usa DataTable: Tipo (icone+label), Assunto, Contato (link), Deal, Responsavel, Data
- [ ] Filtros: tipo (multi-select), usuario (select), periodo (date range)
- [ ] Ordenacao por data (desc default)
- [ ] Botao "Nova Atividade" abre dialog
- [ ] API: GET /api/activities + POST /api/activities`,
    technicalNotes: `Labels: { call: "Ligacao", email: "E-mail", whatsapp: "WhatsApp", note: "Nota", meeting: "Reuniao", task: "Tarefa" }`,
    businessContext: "Visao global de todas as interacoes do time com leads. Gestora Carolina monitora volume de atividades.",
  },
  {
    reference: "TASK-024",
    title: "Listagem de Campanhas",
    description: "Pagina de listagem e CRUD de campanhas de marketing.",
    type: "feature",
    scope: "small",
    complexity: "low",
    functionPoints: 3,
    dependencies: JSON.stringify(["TASK-005", "TASK-009"]),
    executionMode: "agent",
    acceptanceCriteria: `- [ ] Rota /(app)/campaigns/page.tsx
- [ ] DataTable: Nome, Canal (badge), Investimento, Leads capturados, Periodo, ROI
- [ ] ROI calculado = (receita deals won - investimento) / investimento
- [ ] Dialog de criacao/edicao: name, source, totalSpent, startDate, endDate
- [ ] Deletar com confirmacao (nao deleta leads)
- [ ] API: GET/POST /api/campaigns + PUT/DELETE /api/campaigns/[id]`,
    technicalNotes: `Sources: google_ads, meta_ads, email, organic, referral, other.`,
    businessContext: "Carolina gerencia campanhas multicanal. Precisa ver investimento vs resultado por campanha.",
  },
];

async function main() {
  console.log(`Inserindo ${tasks.length} tasks no projeto CRM de Marketing...`);

  for (const t of tasks) {
    const existing = await prisma.task.findUnique({
      where: { reference: t.reference },
    });

    if (existing) {
      await prisma.task.update({
        where: { reference: t.reference },
        data: { ...t, projectId: PROJECT_ID },
      });
      console.log(`  ✓ ${t.reference} atualizada: ${t.title}`);
    } else {
      await prisma.task.create({
        data: { ...t, projectId: PROJECT_ID },
      });
      console.log(`  + ${t.reference} criada: ${t.title}`);
    }
  }

  console.log(`\nDone! ${tasks.length} tasks inseridas.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
