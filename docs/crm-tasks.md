# CRM de Marketing — Task Breakdown

> Projeto: CRM de Marketing para MarketPro Solutions
> Cliente: MarketPro Solutions (PME, 30 funcionarios, marketing digital)
> Stack: Next.js 16 + Tailwind CSS + shadcn/ui + Prisma + SQLite
> Auth: Integrada pelo cliente (recebemos token/session externamente)
> Modelo: 2 releases de ~7 dias (sprint de 15 dias)
> Dados: Mock/seed para prototipo

---

## Release 0 — Fundacao

### TASK-001: Setup do projeto Next.js + Prisma + Tailwind

**Tipo:** setup
**Scope:** medium | **Complexity:** medium | **SP:** 8
**Dependencias:** nenhuma

**Objetivo:**
Criar o projeto Next.js do zero com toda a infraestrutura base configurada e funcionando.

**Acceptance Criteria:**
- [ ] Projeto Next.js 16 criado com TypeScript
- [ ] Tailwind CSS 4 configurado com tema dark/light
- [ ] shadcn/ui inicializado (Button, Input, Label, Card, Badge, Dialog, Select, Separator, Tooltip, Skeleton)
- [ ] Prisma configurado com SQLite (`prisma/dev.db`)
- [ ] Path alias `@/` apontando para `src/`
- [ ] Layout raiz com font Inter/Geist, metadata pt-BR
- [ ] `start.sh` que roda prisma generate + db push + next dev --port 3000
- [ ] `.env` com `DATABASE_URL="file:./dev.db"`
- [ ] ESLint + TypeScript strict configurados
- [ ] `.gitignore` incluindo `dev.db`, `.next`, `node_modules`

**Technical Notes:**
```
npx create-next-app@latest crm-marketing --typescript --tailwind --eslint --app --src-dir
npx shadcn@latest init
npx prisma init --datasource-provider sqlite
```

Estrutura de pastas:
```
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
  hooks/
```

---

### TASK-002: Schema Prisma — modelo de dados completo

**Tipo:** data-model
**Scope:** large | **Complexity:** high | **SP:** 21
**Dependencias:** TASK-001

**Objetivo:**
Criar o schema Prisma com todos os models necessarios para o CRM, cobrindo contatos, empresas, deals, atividades, pipeline, tags, follow-ups e configuracao de usuario.

**Acceptance Criteria:**
- [ ] Model `User` (id, name, email, avatarUrl, role: admin|manager|sdr, createdAt, updatedAt)
- [ ] Model `Company` (id, name, website, industry, size, notes, createdAt, updatedAt)
- [ ] Model `Contact` (id, firstName, lastName, email, phone, companyId?, source, sourceDetail, score:Int default 0, tags → ContactTag[], ownerId → User, createdAt, updatedAt)
- [ ] Model `Deal` (id, title, value:Float?, contactId, companyId?, stageId, ownerId → User, closedAt?, lostReason?, createdAt, updatedAt)
- [ ] Model `PipelineStage` (id, name, position:Int, color, isDefault:Boolean, isClosedWon:Boolean, isClosedLost:Boolean)
- [ ] Model `Activity` (id, type: call|email|whatsapp|note|meeting|task, subject, description?, contactId, dealId?, userId, dueAt?, completedAt?, createdAt)
- [ ] Model `Tag` (id, name, color, createdAt) + `ContactTag` (contactId, tagId, junction)
- [ ] Model `Campaign` (id, name, source: google_ads|meta_ads|email|organic|referral|other, totalSpent:Float default 0, startDate?, endDate?, createdAt)
- [ ] Model `LeadCapture` (id, contactId, campaignId?, channel, rawPayload:String?, capturedAt)
- [ ] Model `FollowUp` (id, contactId, dealId?, userId, dueDate, note?, status: pending|done|skipped, completedAt?, createdAt)
- [ ] Todas as relacoes com onDelete appropriate (Cascade para junction, SetNull para optional)
- [ ] Indices em: Contact.email, Contact.score, Deal.stageId, Activity.contactId+createdAt, FollowUp.userId+status+dueDate
- [ ] Migration rodando sem erros

**Technical Notes:**
O campo `Contact.source` deve ser enum-like string: `google_ads`, `meta_ads`, `webhook`, `csv_import`, `manual`, `referral`.

`PipelineStage` vem pre-populado pelo seed com: Novo (position 0), Contatado (1), Qualificado (2), Proposta (3), Negociacao (4), Fechado Ganho (5, isClosedWon), Fechado Perdido (6, isClosedLost).

`Activity.type` e string, nao enum, para extensibilidade.

`LeadCapture` armazena o payload bruto do webhook/API para debug e re-processamento.

---

### TASK-003: Auth wrapper — integracao com auth do cliente

**Tipo:** feature
**Scope:** small | **Complexity:** medium | **SP:** 5
**Dependencias:** TASK-001, TASK-002

**Objetivo:**
Criar camada de autenticacao que recebe o token/session do sistema de auth do cliente, valida e disponibiliza o usuario logado em toda a aplicacao. Para o prototipo, usar mock com usuario fixo.

**Acceptance Criteria:**
- [ ] `src/lib/auth.ts` exporta `getCurrentUser()` que retorna `{ id, name, email, role }` ou null
- [ ] Implementacao mock: retorna usuario fixo (seeded) — facil de trocar por auth real depois
- [ ] `src/lib/auth-context.tsx` — React Context com `useCurrentUser()` hook
- [ ] `src/app/(app)/layout.tsx` wrapa children com AuthProvider
- [ ] Middleware (`middleware.ts`) que redireciona para `/login` se nao autenticado
- [ ] Pagina `/login` mock com botao "Entrar como Carolina" / "Entrar como Rafael" / "Entrar como Marcos"
- [ ] Cookie `crm_user_id` setado no login mock, lido pelo `getCurrentUser()`
- [ ] `getCurrentUser()` funciona tanto em Server Components (via cookies) quanto Client Components (via context)

**Technical Notes:**
O contrato da funcao deve ser:
```ts
// lib/auth.ts
export async function getCurrentUser(): Promise<User | null> {
  // Em producao: decodifica token do cliente
  // Em mock: le cookie crm_user_id e busca no banco
  const userId = cookies().get("crm_user_id")?.value;
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}
```

A interface de auth do cliente sera: header `Authorization: Bearer <token>` que decodifica em `{ sub, email, name }`. Mas no prototipo usamos cookie mock.

---

### TASK-004: Seed de dados mock

**Tipo:** seed
**Scope:** medium | **Complexity:** medium | **SP:** 8
**Dependencias:** TASK-002

**Objetivo:**
Criar script de seed que popula o banco com dados realistas para testar todas as features do CRM.

**Acceptance Criteria:**
- [ ] 3 usuarios: Carolina (manager), Rafael (sdr), Marcos (admin)
- [ ] 6 pipeline stages pre-configurados (Novo → Fechado Ganho/Perdido)
- [ ] 5 empresas com dados realistas (PMEs brasileiras)
- [ ] 30 contatos distribuidos entre as empresas, com scores variados (0-100)
- [ ] 15 deals em stages variados (3 por stage + 3 fechados)
- [ ] 8 tags: "Google Ads", "Meta Ads", "Indicacao", "Quente", "Frio", "B2B", "E-commerce", "SaaS"
- [ ] Tags atribuidas a contatos (ContactTag)
- [ ] 50 atividades (mix de call, email, whatsapp, note) distribuidas nos ultimos 30 dias
- [ ] 3 campanhas: "Google Ads - Abril", "Instagram - Awareness", "Email - Nutrição"
- [ ] 10 follow-ups: 5 pending (proximos 7 dias), 3 done, 2 overdue (dueDate no passado, status pending)
- [ ] Script em `prisma/seed.ts`, rodavel com `npx tsx prisma/seed.ts`
- [ ] `package.json` com script `"db:seed": "npx tsx prisma/seed.ts"`
- [ ] Seed e idempotente (usa upsert ou deleta antes de inserir)

**Technical Notes:**
Nomes de contatos e empresas brasileiros realistas. Telefones no formato (11) 99999-XXXX. Emails coerentes com nomes. Datas distribuidas nos ultimos 30 dias com `new Date(Date.now() - Math.random() * 30 * 86400000)`.

Scores dos contatos devem fazer sentido: leads com mais atividades recentes = score mais alto. Deals com valor entre R$5.000 e R$150.000.

---

### TASK-005: Componente reutilizavel — DataTable

**Tipo:** component
**Scope:** medium | **Complexity:** high | **SP:** 13
**Dependencias:** TASK-001

**Objetivo:**
Criar componente DataTable generico e reutilizavel que sera usado em todas as listagens do CRM (contatos, empresas, deals, atividades).

**Acceptance Criteria:**
- [ ] `src/components/shared/data-table.tsx`
- [ ] Props tipadas com generics: `DataTable<T>` onde T e o tipo da row
- [ ] Definicao de colunas via array: `{ key, header, render?, sortable?, width? }`
- [ ] Busca/filtro por texto (filtra client-side no array)
- [ ] Ordenacao clicando no header (asc/desc toggle)
- [ ] Selecao de rows com checkbox (opcional via prop `selectable`)
- [ ] Acoes em bulk quando rows selecionadas (prop `bulkActions`)
- [ ] Empty state customizavel (prop `emptyMessage` e `emptyIcon`)
- [ ] Loading state com Skeleton rows
- [ ] Paginacao client-side (10/25/50 por pagina)
- [ ] Row click handler (prop `onRowClick`)
- [ ] Responsivo: em mobile, colunas com `hideOnMobile` ficam ocultas

**Technical Notes:**
```tsx
// Uso esperado:
<DataTable
  data={contacts}
  columns={[
    { key: "name", header: "Nome", sortable: true, render: (row) => <span>{row.firstName} {row.lastName}</span> },
    { key: "email", header: "Email", sortable: true },
    { key: "score", header: "Score", sortable: true, render: (row) => <ScoreBadge score={row.score} /> },
    { key: "tags", header: "Tags", render: (row) => row.tags.map(t => <Badge key={t.id}>{t.name}</Badge>) },
  ]}
  searchKeys={["firstName", "lastName", "email"]}
  onRowClick={(row) => router.push(`/contacts/${row.id}`)}
  selectable
  bulkActions={[{ label: "Adicionar tag", onClick: (rows) => ... }]}
/>
```

Usar `useState` para sort, page, search. Nao usar libs externas (nao usar tanstack-table). Manter simples.

---

### TASK-006: Componente reutilizavel — KanbanBoard

**Tipo:** component
**Scope:** medium | **Complexity:** high | **SP:** 13
**Dependencias:** TASK-001

**Objetivo:**
Criar componente KanbanBoard generico com drag-and-drop que sera usado para o pipeline de deals e potencialmente para outros contextos.

**Acceptance Criteria:**
- [ ] `src/components/shared/kanban-board.tsx`
- [ ] Props tipadas com generics: `KanbanBoard<T>`
- [ ] Colunas definidas via prop `columns: { id, title, color?, count? }[]`
- [ ] Cards definidos via prop `items: T[]` + `getColumnId: (item: T) => string`
- [ ] Drag-and-drop entre colunas usando `@dnd-kit/core` + `@dnd-kit/sortable`
- [ ] Callback `onMove(itemId, fromColumnId, toColumnId)` disparado ao dropar
- [ ] Card renderizado via prop `renderCard: (item: T) => ReactNode`
- [ ] Header de coluna mostra titulo + contagem de items
- [ ] Scroll horizontal quando colunas excedem a tela
- [ ] Scroll vertical dentro de cada coluna quando cards excedem altura
- [ ] Placeholder visual ao arrastar ("drop here")
- [ ] Loading state por coluna (Skeleton cards)
- [ ] Responsivo: em mobile, colunas empilham verticalmente com collapse

**Technical Notes:**
```tsx
// Uso esperado:
<KanbanBoard
  columns={stages.map(s => ({ id: s.id, title: s.name, color: s.color }))}
  items={deals}
  getColumnId={(deal) => deal.stageId}
  onMove={async (dealId, _, toStageId) => {
    await fetch(`/api/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ stageId: toStageId }) });
    reload();
  }}
  renderCard={(deal) => <DealCard deal={deal} />}
/>
```

Usar `@dnd-kit/core` para DnD (ja esta no package.json do Volund como referencia). Sensores: pointer + keyboard. Collision detection: `closestCorners`.

---

### TASK-007: Componente reutilizavel — StatsCard + MiniChart

**Tipo:** component
**Scope:** small | **Complexity:** medium | **SP:** 5
**Dependencias:** TASK-001

**Objetivo:**
Criar componentes de metricas reutilizaveis para dashboards: card com numero grande + label + variacao, e mini grafico sparkline em SVG puro.

**Acceptance Criteria:**
- [ ] `src/components/shared/stats-card.tsx`
  - Props: `title, value, subtitle?, icon?, trend?: { value: number, direction: "up"|"down" }`, `onClick?`
  - Trend mostra seta verde (up) ou vermelha (down) com percentual
  - Hover state se onClick definido
- [ ] `src/components/shared/mini-chart.tsx`
  - Props: `data: number[], color?, height?: number, width?: number`
  - Renderiza sparkline em SVG puro (polyline), sem libs externas
  - Preenche area abaixo da linha com gradiente sutil
  - Tooltip no hover mostrando valor do ponto
- [ ] Ambos responsivos e com loading state (Skeleton)

**Technical Notes:**
```tsx
// Uso esperado:
<StatsCard
  title="Leads este mes"
  value={142}
  trend={{ value: 12, direction: "up" }}
  icon={<Users className="h-4 w-4" />}
/>

<MiniChart data={[10, 25, 18, 30, 42, 38, 55]} color="var(--primary)" />
```

SVG sparkline formula:
```ts
const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`).join(" ");
```

---

### TASK-008: Componente reutilizavel — ActivityTimeline

**Tipo:** component
**Scope:** small | **Complexity:** medium | **SP:** 5
**Dependencias:** TASK-001

**Objetivo:**
Componente de timeline vertical para exibir historico de atividades de um contato ou deal.

**Acceptance Criteria:**
- [ ] `src/components/shared/activity-timeline.tsx`
- [ ] Props: `activities: Activity[]` onde Activity tem `{ id, type, subject, description?, user, createdAt, completedAt? }`
- [ ] Icone por tipo: call (Phone), email (Mail), whatsapp (MessageCircle), note (StickyNote), meeting (Calendar), task (CheckSquare)
- [ ] Cor por tipo: call=blue, email=purple, whatsapp=green, note=gray, meeting=orange, task=yellow
- [ ] Linha vertical conectando os items (timeline visual)
- [ ] Cada item mostra: icone, subject, user name, tempo relativo ("ha 2h", "ontem", "15 mar")
- [ ] Expandir/colapsar description se existir
- [ ] Botao "Carregar mais" se lista > 20 items
- [ ] Empty state: "Nenhuma atividade registrada"

**Technical Notes:**
```tsx
<ActivityTimeline
  activities={activities}
  onLoadMore={() => setPage(p => p + 1)}
  hasMore={hasMore}
/>
```

Usar `Intl.RelativeTimeFormat("pt-BR")` para tempos relativos. Fallback para data absoluta se > 7 dias.

---

### TASK-009: Layout da aplicacao — Sidebar + Topbar

**Tipo:** feature
**Scope:** small | **Complexity:** low | **SP:** 3
**Dependencias:** TASK-001, TASK-003

**Objetivo:**
Criar o layout autenticado do CRM com sidebar de navegacao e topbar com info do usuario.

**Acceptance Criteria:**
- [ ] `src/app/(app)/layout.tsx` com sidebar + area de conteudo
- [ ] Sidebar com navegacao:
  - Dashboard (home)
  - Contatos
  - Empresas
  - Pipeline (deals kanban)
  - Atividades
  - Follow-ups
  - Campanhas
  - Configuracoes
- [ ] Cada item com icone Lucide correspondente
- [ ] Indicador de item ativo baseado na rota
- [ ] Topbar com: nome do usuario logado, avatar placeholder, botao de logout
- [ ] Sidebar colapsavel (icone only) em desktop
- [ ] Em mobile: sidebar como sheet (slide-over)
- [ ] Branding: "CRM Marketing" + logo placeholder no topo da sidebar

**Technical Notes:**
Reusar padrao do Volund com SidebarProvider. Rotas:
```
/(app)/                  → dashboard
/(app)/contacts          → listagem contatos
/(app)/contacts/[id]     → detalhe contato
/(app)/companies         → listagem empresas
/(app)/pipeline          → kanban deals
/(app)/activities        → listagem atividades
/(app)/follow-ups        → listagem follow-ups
/(app)/campaigns         → listagem campanhas
/(app)/settings          → configuracoes (pipeline stages, tags)
```

---

## Release 1 — Base + Pipeline

### TASK-010: CRUD de Contatos — listagem e criacao

**Tipo:** feature
**Scope:** medium | **Complexity:** medium | **SP:** 8
**Dependencias:** TASK-002, TASK-005, TASK-009

**Objetivo:**
Pagina de listagem de contatos usando DataTable com busca, filtro por tag e ordenacao. Dialog de criacao de novo contato.

**Acceptance Criteria:**
- [ ] Rota `/(app)/contacts/page.tsx`
- [ ] Usa componente `DataTable` (TASK-005)
- [ ] Colunas: Nome (firstName + lastName), Email, Telefone, Empresa, Score (badge colorido), Tags (badges), Owner, Criado em
- [ ] Busca por nome, email, telefone
- [ ] Filtro por tag (multi-select dropdown)
- [ ] Filtro por source (select)
- [ ] Filtro por score range (slider ou select: Frio 0-30, Morno 31-70, Quente 71-100)
- [ ] Ordenacao por nome, score, criado em
- [ ] Selecao bulk com acoes: "Adicionar tag", "Remover tag", "Atribuir owner"
- [ ] Botao "Novo Contato" abre dialog
- [ ] Dialog de criacao: firstName, lastName, email, phone, companyId (select), source (select), tags (multi-select), owner (select, default usuario logado)
- [ ] Validacao: firstName obrigatorio, email unico se preenchido
- [ ] Apos criar, recarrega lista e mostra toast
- [ ] API: `GET /api/contacts` (com query params) + `POST /api/contacts`

**Technical Notes:**
API GET deve suportar:
```
GET /api/contacts?search=joao&tag=quente&source=google_ads&scoreMin=50&scoreMax=100&sort=score&order=desc&page=1&limit=25
```

Score badge cores: 0-30 gray, 31-70 yellow, 71-100 green.

---

### TASK-011: Detalhe do Contato — perfil + timeline

**Tipo:** feature
**Scope:** medium | **Complexity:** medium | **SP:** 8
**Dependencias:** TASK-008, TASK-010

**Objetivo:**
Pagina de detalhe do contato com informacoes completas, timeline de atividades, deals vinculados e acoes rapidas.

**Acceptance Criteria:**
- [ ] Rota `/(app)/contacts/[id]/page.tsx`
- [ ] Header: nome completo, empresa, score badge, tags, botao editar, botao deletar
- [ ] Secao de informacoes: email (clicavel mailto), phone (clicavel tel), source, owner, criado em, atualizado em
- [ ] Tabs: Timeline | Deals | Detalhes
- [ ] Tab Timeline: usa `ActivityTimeline` (TASK-008), mostra atividades do contato
- [ ] Tab Timeline: formulario inline para adicionar atividade (type select + subject input + description textarea + botao salvar)
- [ ] Tab Deals: lista de deals vinculados ao contato com stage, valor, owner
- [ ] Tab Detalhes: campos editaveis inline (click-to-edit) para todos os campos do contato
- [ ] Tags editaveis: click no tag area abre multi-select para add/remove tags
- [ ] API: `GET /api/contacts/[id]` (com include activities, deals, tags) + `PUT /api/contacts/[id]` + `DELETE /api/contacts/[id]`
- [ ] API: `POST /api/contacts/[id]/activities` para adicionar atividade

**Technical Notes:**
A query do GET deve incluir:
```ts
prisma.contact.findUnique({
  where: { id },
  include: {
    company: true,
    owner: true,
    tags: { include: { tag: true } },
    deals: { include: { stage: true } },
    activities: { orderBy: { createdAt: "desc" }, take: 20, include: { user: true } },
    followUps: { where: { status: "pending" }, orderBy: { dueDate: "asc" } },
  }
});
```

---

### TASK-012: CRUD de Empresas

**Tipo:** feature
**Scope:** small | **Complexity:** low | **SP:** 3
**Dependencias:** TASK-005, TASK-009

**Objetivo:**
Pagina simples de listagem e CRUD de empresas. Empresas sao entidades de suporte para vincular contatos.

**Acceptance Criteria:**
- [ ] Rota `/(app)/companies/page.tsx`
- [ ] Usa DataTable com colunas: Nome, Website, Setor, Tamanho, N contatos, Criado em
- [ ] Busca por nome
- [ ] Dialog de criacao/edicao: name, website, industry (input livre), size (select: 1-10, 11-50, 51-200, 200+), notes (textarea)
- [ ] Botao deletar com confirmacao
- [ ] Click na row abre dialog de edicao (nao precisa pagina de detalhe)
- [ ] API: `GET /api/companies` + `POST /api/companies` + `PUT /api/companies/[id]` + `DELETE /api/companies/[id]`

**Technical Notes:**
Contagem de contatos via `_count: { select: { contacts: true } }` no Prisma include.

---

### TASK-013: Pipeline visual — Kanban de Deals

**Tipo:** feature
**Scope:** medium | **Complexity:** high | **SP:** 13
**Dependencias:** TASK-002, TASK-006, TASK-009

**Objetivo:**
Pagina de pipeline com Kanban onde cada coluna e um stage e cada card e um deal. Drag-and-drop move o deal entre stages.

**Acceptance Criteria:**
- [ ] Rota `/(app)/pipeline/page.tsx`
- [ ] Usa componente `KanbanBoard` (TASK-006)
- [ ] Colunas: pipeline stages ordenados por position, excluindo stages "closed" da view principal
- [ ] Cada card mostra: titulo do deal, nome do contato, valor (R$ formatado), owner avatar/initial, tempo no stage atual
- [ ] Cores dos stages exibidas no header da coluna
- [ ] Drag-and-drop atualiza `deal.stageId` via `PATCH /api/deals/[id]`
- [ ] Header da coluna mostra: nome do stage + count + soma de valores dos deals
- [ ] Filtros no topo: owner (select), valor minimo/maximo, busca por titulo/contato
- [ ] Botao "Novo Deal" abre dialog: title, contactId (search select), companyId (auto-preenche da company do contato), value, stageId (default primeiro stage), ownerId (default usuario logado)
- [ ] Secao colapsavel "Fechados" no bottom: cards de deals won/lost com badge verde/vermelho
- [ ] Click no card abre slide-over (Sheet) com detalhes do deal
- [ ] Slide-over: info do deal + timeline de atividades + botao "Registrar Atividade"
- [ ] API: `GET /api/deals` + `POST /api/deals` + `PATCH /api/deals/[id]` + `GET /api/deals/[id]`

**Technical Notes:**
```ts
// GET /api/deals retorna deals agrupados por stage
const stages = await prisma.pipelineStage.findMany({ orderBy: { position: "asc" } });
const deals = await prisma.deal.findMany({
  include: { contact: true, company: true, owner: true, stage: true },
  orderBy: { updatedAt: "desc" },
});
```

Valor total no header: `deals.filter(d => d.stageId === stage.id).reduce((s, d) => s + (d.value ?? 0), 0)`.

O `PATCH` de deal deve registrar uma Activity automatica: `"Deal movido de {fromStage} para {toStage}"`.

---

### TASK-014: Importacao de contatos via CSV

**Tipo:** feature
**Scope:** medium | **Complexity:** high | **SP:** 13
**Dependencias:** TASK-002, TASK-010

**Objetivo:**
Permitir importar contatos a partir de arquivo CSV com mapeamento de colunas, preview, deteccao de duplicatas e feedback de resultado.

**Acceptance Criteria:**
- [ ] Botao "Importar CSV" na pagina de contatos abre dialog multi-step
- [ ] Step 1 — Upload: area de drag-and-drop + input file. Aceita .csv e .txt. Max 5MB. Exibe nome do arquivo e contagem de linhas.
- [ ] Step 2 — Mapeamento: tabela com preview das 5 primeiras linhas. Cada coluna do CSV tem um select para mapear para campo do Contact (firstName, lastName, email, phone, companyName, source, tags). Auto-detect por header name (case-insensitive match).
- [ ] Step 3 — Preview: mostra quantos registros serao importados, quantos duplicados detectados (por email), quantos com erros (email invalido, nome vazio). Checkbox "Atualizar duplicados" (merge) vs "Pular duplicados".
- [ ] Step 4 — Resultado: X importados, Y atualizados, Z pulados. Botao para baixar CSV de erros.
- [ ] Parser CSV client-side (sem lib, split por virgula/ponto-e-virgula com tratamento de aspas)
- [ ] API: `POST /api/contacts/import` recebe array de contatos mapeados + opcao merge
- [ ] API faz upsert por email quando merge=true, create quando merge=false (skip duplicatas)
- [ ] Se `companyName` preenchido e nao existe → cria Company automaticamente
- [ ] Tags por string: "Quente, B2B" → busca/cria tags e vincula

**Technical Notes:**
Parser CSV simples:
```ts
function parseCSV(text: string): string[][] {
  // Detectar delimitador: virgula ou ponto-e-virgula
  const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";
  return text.trim().split("\n").map(line =>
    line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, ""))
  );
}
```

Import no backend deve ser transacional: `prisma.$transaction()`. Limite de 1000 registros por importacao.

---

### TASK-015: Exportacao de contatos para CSV

**Tipo:** feature
**Scope:** small | **Complexity:** low | **SP:** 3
**Dependencias:** TASK-010

**Objetivo:**
Exportar a lista de contatos (com filtros aplicados) como arquivo CSV.

**Acceptance Criteria:**
- [ ] Botao "Exportar CSV" na pagina de contatos
- [ ] Exporta com os mesmos filtros ativos (tag, source, score, search)
- [ ] Colunas: Nome, Sobrenome, Email, Telefone, Empresa, Score, Source, Tags (separadas por ;), Owner, Criado em
- [ ] Download direto no browser (Blob + URL.createObjectURL)
- [ ] Nome do arquivo: `contatos_YYYY-MM-DD.csv`
- [ ] Encoding UTF-8 com BOM (para Excel reconhecer acentos)

**Technical Notes:**
```ts
function generateCSV(contacts: Contact[]): string {
  const BOM = "\ufeff";
  const header = "Nome,Sobrenome,Email,Telefone,Empresa,Score,Origem,Tags,Responsavel,Criado em\n";
  const rows = contacts.map(c =>
    [c.firstName, c.lastName, c.email, c.phone, c.company?.name, c.score, c.source,
     c.tags.map(t => t.tag.name).join(";"), c.owner.name,
     new Date(c.createdAt).toLocaleDateString("pt-BR")
    ].map(v => `"${v ?? ""}"`).join(",")
  ).join("\n");
  return BOM + header + rows;
}
```

---

### TASK-016: Sistema de Tags — CRUD e atribuicao

**Tipo:** feature
**Scope:** small | **Complexity:** medium | **SP:** 5
**Dependencias:** TASK-002, TASK-009

**Objetivo:**
Gerenciamento de tags e atribuicao a contatos. Tags sao coloridas e reutilizaveis.

**Acceptance Criteria:**
- [ ] Pagina `/(app)/settings/page.tsx` com secao "Tags"
- [ ] Lista de tags existentes com nome, cor (bolinha colorida), contagem de contatos
- [ ] Criar tag: input name + color picker (preset de 8 cores)
- [ ] Editar tag: click no nome torna editavel inline
- [ ] Deletar tag: confirmacao + remove todas as ContactTag associadas
- [ ] Componente `TagPicker` reutilizavel em `src/components/shared/tag-picker.tsx`
  - Multi-select dropdown com busca
  - Mostra tags selecionadas como badges removiveis
  - Opcao "Criar nova tag" inline se digitou algo que nao existe
  - Props: `selectedIds, onChange(ids), allowCreate?`
- [ ] API: `GET /api/tags` + `POST /api/tags` + `PUT /api/tags/[id]` + `DELETE /api/tags/[id]`
- [ ] API: `POST /api/contacts/[id]/tags` (body: `{ tagIds: string[] }`) — substitui todas as tags do contato

**Technical Notes:**
Cores preset: `["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"]`.

O TagPicker sera usado em: criacao de contato (TASK-010), detalhe de contato (TASK-011), importacao CSV (TASK-014), bulk actions (TASK-010).

---

### TASK-017: Follow-ups — listagem e gestao

**Tipo:** feature
**Scope:** medium | **Complexity:** medium | **SP:** 8
**Dependencias:** TASK-002, TASK-005, TASK-009

**Objetivo:**
Pagina dedicada de follow-ups onde o usuario ve seus pendentes organizados por urgencia, e pode marcar como feito, pular ou reagendar.

**Acceptance Criteria:**
- [ ] Rota `/(app)/follow-ups/page.tsx`
- [ ] Tres secoes visuais (nao tabs, todas visiveis):
  - **Atrasados** (dueDate < hoje, status pending) — fundo vermelho claro, ordered by dueDate asc
  - **Hoje** (dueDate = hoje, status pending) — fundo amarelo claro
  - **Proximos 7 dias** (dueDate entre amanha e +7d, status pending) — fundo neutro
- [ ] Cada follow-up card mostra: nome do contato (link), deal title se existir, nota, dueDate formatada, botoes de acao
- [ ] Acoes por follow-up:
  - "Feito" → status=done, completedAt=now + abre dialog para registrar atividade
  - "Pular" → status=skipped
  - "Reagendar" → abre date picker, atualiza dueDate
- [ ] Botao "Novo Follow-up" abre dialog: contactId (search select), dealId (optional select filtrado pelo contato), dueDate (date picker), note (textarea)
- [ ] Filtro por owner (admin ve todos, SDR ve so os seus — default filtro pelo usuario logado)
- [ ] Contador no sidebar: badge com numero de follow-ups pendentes (atrasados + hoje)
- [ ] API: `GET /api/follow-ups?userId=X&status=pending` + `POST /api/follow-ups` + `PATCH /api/follow-ups/[id]`

**Technical Notes:**
Query para contagem no sidebar (usado no layout):
```ts
const overdueCount = await prisma.followUp.count({
  where: { userId, status: "pending", dueDate: { lt: startOfToday() } }
});
const todayCount = await prisma.followUp.count({
  where: { userId, status: "pending", dueDate: { gte: startOfToday(), lt: startOfTomorrow() } }
});
```

Ao marcar follow-up como "Feito", sugerir criar proximo follow-up (dialog com checkbox "Agendar proximo em X dias").

---

### TASK-018: Configuracao de Pipeline Stages

**Tipo:** feature
**Scope:** small | **Complexity:** medium | **SP:** 5
**Dependencias:** TASK-002, TASK-009

**Objetivo:**
Permitir customizar os stages do pipeline na pagina de configuracoes.

**Acceptance Criteria:**
- [ ] Secao "Pipeline" em `/(app)/settings/page.tsx`
- [ ] Lista sortavel (drag-and-drop) dos stages
- [ ] Cada stage mostra: cor (bolinha), nome (editavel inline), flags (isClosedWon, isClosedLost)
- [ ] Adicionar novo stage: input name + color picker + position auto (ultimo antes dos "closed")
- [ ] Remover stage: so permite se nao tem deals vinculados (mostra count se > 0)
- [ ] Reordenar stages via drag-and-drop (atualiza position de todos)
- [ ] Protecao: nao permite remover stage com isClosedWon ou isClosedLost
- [ ] API: `GET /api/pipeline-stages` + `POST /api/pipeline-stages` + `PUT /api/pipeline-stages/[id]` + `DELETE /api/pipeline-stages/[id]` + `PUT /api/pipeline-stages/reorder` (body: `{ ids: string[] }`)

**Technical Notes:**
Reorder endpoint:
```ts
// PUT /api/pipeline-stages/reorder
const { ids } = await req.json();
await prisma.$transaction(
  ids.map((id, index) => prisma.pipelineStage.update({ where: { id }, data: { position: index } }))
);
```

---

## Release 2 — Captura + Visibilidade

### TASK-019: Captura de leads via webhook generico

**Tipo:** feature
**Scope:** medium | **Complexity:** medium | **SP:** 8
**Dependencias:** TASK-002, TASK-010

**Objetivo:**
Endpoint de webhook que recebe leads de fontes externas (formularios, landing pages, Typeform, Google Forms) e cria contato automaticamente no CRM.

**Acceptance Criteria:**
- [ ] `POST /api/webhooks/lead-capture` — endpoint publico (sem auth)
- [ ] Aceita JSON com schema flexivel. Campos reconhecidos: `name`/`firstName`+`lastName`, `email`, `phone`, `company`, `source`, `tags`, `campaign`
- [ ] Validacao: email obrigatorio, formato valido
- [ ] Se contato com mesmo email ja existe → atualiza (merge), nao duplica
- [ ] Cria registro `LeadCapture` com rawPayload completo para auditoria
- [ ] Se `campaign` informado → vincula ao Campaign por nome (busca ou ignora se nao existe)
- [ ] Se `tags` informado (string separada por virgula) → busca/cria tags e vincula
- [ ] Source default: "webhook" se nao informado
- [ ] Score inicial: 10 (lead novo via webhook tem engagement minimo)
- [ ] Retorna `201` com `{ contactId, created: true/false }` ou `400` com erro
- [ ] Pagina em Settings: secao "Webhooks" mostrando URL do endpoint + exemplos de payload + ultimas 10 capturas (LeadCapture log)

**Technical Notes:**
Payload esperado (todos opcionais exceto email):
```json
{
  "email": "lead@example.com",
  "firstName": "Joao",
  "lastName": "Silva",
  "phone": "(11) 99999-1234",
  "company": "Acme Corp",
  "source": "typeform",
  "campaign": "Google Ads - Abril",
  "tags": "Quente, B2B",
  "custom": { "utm_source": "google", "utm_campaign": "spring2026" }
}
```

O campo `custom` e salvo no `rawPayload` mas nao processado. Serve para analise futura.

---

### TASK-020: Captura mock — Google Ads e Meta Ads

**Tipo:** feature
**Scope:** small | **Complexity:** low | **SP:** 3
**Dependencias:** TASK-019

**Objetivo:**
Criar endpoints mock que simulam a captura de leads do Google Ads e Meta Ads, gerando dados aleatorios para testar o fluxo completo.

**Acceptance Criteria:**
- [ ] `POST /api/mock/google-ads-capture` — gera 5 leads aleatorios com source="google_ads" e chama o webhook interno
- [ ] `POST /api/mock/meta-ads-capture` — gera 5 leads aleatorios com source="meta_ads" e chama o webhook interno
- [ ] Leads gerados com: nomes brasileiros aleatorios, emails coerentes, telefones, tags "Google Ads" ou "Meta Ads"
- [ ] Vincula a campanha correspondente (pelo nome)
- [ ] Pagina em Settings: secao "Simulacoes" com botoes "Simular Google Ads" e "Simular Meta Ads" + resultado da ultima execucao
- [ ] Retorna lista de contatos criados/atualizados

**Technical Notes:**
Pool de nomes brasileiros para gerar dados:
```ts
const firstNames = ["Ana", "Pedro", "Maria", "Carlos", "Julia", "Rafael", "Camila", "Lucas", "Fernanda", "Bruno"];
const lastNames = ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira", "Almeida", "Ribeiro"];
```

---

### TASK-021: Lead Scoring automatico

**Tipo:** feature
**Scope:** medium | **Complexity:** high | **SP:** 13
**Dependencias:** TASK-002, TASK-011

**Objetivo:**
Sistema de scoring automatico que calcula o score de cada lead baseado em engajamento (atividades) e recencia, atualizando periodicamente.

**Acceptance Criteria:**
- [ ] `src/lib/lead-scoring.ts` com funcao `calculateScore(contactId): number`
- [ ] Regras de scoring (pesos):
  - +10 por atividade tipo `call` nos ultimos 7 dias
  - +5 por atividade tipo `email` nos ultimos 7 dias
  - +8 por atividade tipo `whatsapp` nos ultimos 7 dias
  - +3 por atividade tipo `meeting` nos ultimos 30 dias
  - +2 por cada tag "positiva" (Quente, B2B)
  - -5 se nenhuma atividade nos ultimos 14 dias (lead esfriando)
  - -10 se nenhuma atividade nos ultimos 30 dias (lead frio)
  - +15 se tem deal em stage >= Qualificado
  - Cap: min 0, max 100
- [ ] `POST /api/contacts/recalculate-scores` — recalcula score de todos os contatos (batch)
- [ ] Score recalculado automaticamente quando:
  - Nova atividade adicionada (TASK-011)
  - Deal muda de stage (TASK-013)
- [ ] Badge de score na listagem com gradiente: 0-30 cinza "Frio", 31-70 amarelo "Morno", 71-100 verde "Quente"
- [ ] Tooltip no badge mostrando breakdown do score

**Technical Notes:**
```ts
export async function calculateScore(contactId: string): Promise<number> {
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86400000);
  const d14 = new Date(now.getTime() - 14 * 86400000);
  const d30 = new Date(now.getTime() - 30 * 86400000);

  const activities = await prisma.activity.findMany({
    where: { contactId, createdAt: { gte: d30 } },
    select: { type: true, createdAt: true },
  });

  let score = 0;
  const recent7 = activities.filter(a => a.createdAt >= d7);
  score += recent7.filter(a => a.type === "call").length * 10;
  score += recent7.filter(a => a.type === "email").length * 5;
  score += recent7.filter(a => a.type === "whatsapp").length * 8;
  // ... etc

  return Math.max(0, Math.min(100, score));
}
```

---

### TASK-022: Dashboard de ROI por campanha/canal

**Tipo:** feature
**Scope:** large | **Complexity:** high | **SP:** 21
**Dependencias:** TASK-002, TASK-007, TASK-009

**Objetivo:**
Dashboard principal do CRM mostrando metricas de marketing: funil de conversao, ROI por campanha, leads por canal, e evolucao temporal. Visao da Carolina (gestora) e do Marcos (CEO).

**Acceptance Criteria:**
- [ ] Rota `/(app)/page.tsx` (homepage = dashboard)
- [ ] **Linha 1 — Stats Cards** (usa TASK-007):
  - Total de leads (com trend vs mes anterior)
  - Leads quentes (score >= 70)
  - Deals em aberto (soma dos valores)
  - Taxa de conversao (deals won / total deals %)
  - CAC medio (totalSpent de campanhas / deals won count)
- [ ] **Linha 2 — Funil de conversao**:
  - Barras horizontais mostrando contagem por stage do pipeline
  - Percentual de conversao entre stages (ex: 60% dos Contatados viram Qualificados)
  - Clicavel: click no stage filtra a listagem de deals
- [ ] **Linha 3 — ROI por Campanha**:
  - Tabela com: Campanha, Canal (source), Investimento, Leads gerados, Deals won, Receita, ROI (receita/investimento)
  - Ordenavel por ROI
  - Badge de ROI: positivo (verde), negativo (vermelho)
- [ ] **Linha 4 — Evolucao temporal**:
  - MiniChart (TASK-007) mostrando leads por semana nos ultimos 3 meses
  - MiniChart mostrando deals won por semana
- [ ] **Linha 5 — Top leads quentes**:
  - Top 10 contatos por score, com link para detalhe
- [ ] Filtro de periodo no topo: Ultimo mes, Ultimos 3 meses, Este ano, Custom (date range)
- [ ] API: `GET /api/dashboard?period=30d` retorna todos os dados agregados

**Technical Notes:**
A query de ROI por campanha:
```ts
const campaigns = await prisma.campaign.findMany({
  include: {
    _count: { select: { leadCaptures: true } },
    leadCaptures: {
      include: {
        contact: {
          include: {
            deals: { where: { stage: { isClosedWon: true } }, select: { value: true } }
          }
        }
      }
    }
  }
});

// Para cada campanha:
// leads = _count.leadCaptures
// revenue = sum of deals.value dos contatos capturados por essa campanha
// roi = revenue / totalSpent
```

Funil de conversao:
```ts
const funnel = await prisma.pipelineStage.findMany({
  orderBy: { position: "asc" },
  include: { _count: { select: { deals: true } } },
});
```

Trend vs mes anterior: comparar count dos ultimos 30d vs 30-60d atras.

---

### TASK-023: Listagem de Atividades

**Tipo:** feature
**Scope:** small | **Complexity:** low | **SP:** 3
**Dependencias:** TASK-005, TASK-009

**Objetivo:**
Pagina de listagem global de atividades com filtros por tipo, usuario e periodo.

**Acceptance Criteria:**
- [ ] Rota `/(app)/activities/page.tsx`
- [ ] Usa DataTable com colunas: Tipo (icone + label), Assunto, Contato (link), Deal (link se existir), Responsavel, Data
- [ ] Filtros: tipo (multi-select), usuario (select), periodo (date range)
- [ ] Ordenacao por data (desc default)
- [ ] Click na row nao abre nada (atividade nao tem pagina de detalhe)
- [ ] Botao "Nova Atividade" abre dialog: type (select), subject (input), description (textarea), contactId (search select), dealId (optional), dueAt (optional date)
- [ ] API: `GET /api/activities?type=call&userId=X&from=2026-01-01&to=2026-04-01` + `POST /api/activities`

**Technical Notes:**
Labels de tipo: `{ call: "Ligacao", email: "E-mail", whatsapp: "WhatsApp", note: "Nota", meeting: "Reuniao", task: "Tarefa" }`.

---

### TASK-024: Listagem de Campanhas

**Tipo:** feature
**Scope:** small | **Complexity:** low | **SP:** 3
**Dependencias:** TASK-005, TASK-009

**Objetivo:**
Pagina de listagem e CRUD de campanhas de marketing.

**Acceptance Criteria:**
- [ ] Rota `/(app)/campaigns/page.tsx`
- [ ] DataTable com colunas: Nome, Canal (source badge), Investimento (R$), Leads capturados, Periodo, ROI
- [ ] Leads capturados = count de LeadCapture vinculadas
- [ ] ROI calculado = (receita dos deals won de contatos dessa campanha - investimento) / investimento
- [ ] Dialog de criacao/edicao: name, source (select), totalSpent (number), startDate (date), endDate (date)
- [ ] Deletar campanha com confirmacao (nao deleta leads vinculados, so remove vinculo)
- [ ] API: `GET /api/campaigns` + `POST /api/campaigns` + `PUT /api/campaigns/[id]` + `DELETE /api/campaigns/[id]`

**Technical Notes:**
Sources possiveis: `google_ads`, `meta_ads`, `email`, `organic`, `referral`, `other`.

---

## Resumo de SP

| Release | Tasks | SP Total |
|---------|-------|----------|
| Release 0 — Fundacao | TASK-001 a TASK-009 | 81 SP |
| Release 1 — Base + Pipeline | TASK-010 a TASK-018 | 66 SP |
| Release 2 — Captura + Visibilidade | TASK-019 a TASK-024 | 51 SP |
| **Total** | **24 tasks** | **198 SP** |

## Grafo de Dependencias

```
TASK-001 (setup)
├── TASK-002 (schema) ──┬── TASK-004 (seed)
│                       ├── TASK-010 (contatos) ──── TASK-011 (detalhe contato)
│                       │                      ├── TASK-014 (import CSV)
│                       │                      └── TASK-015 (export CSV)
│                       ├── TASK-012 (empresas)
│                       ├── TASK-013 (pipeline kanban)
│                       ├── TASK-016 (tags)
│                       ├── TASK-017 (follow-ups)
│                       ├── TASK-018 (pipeline stages config)
│                       ├── TASK-019 (webhook capture) ── TASK-020 (mock ads)
│                       ├── TASK-021 (lead scoring)
│                       └── TASK-022 (dashboard ROI)
├── TASK-003 (auth) ──── TASK-009 (layout)
├── TASK-005 (DataTable) ← usado por: 010, 012, 017, 023, 024
├── TASK-006 (KanbanBoard) ← usado por: 013
├── TASK-007 (StatsCard + MiniChart) ← usado por: 022
└── TASK-008 (ActivityTimeline) ← usado por: 011, 013
```

## Sprints sugeridos

**Sprint 1 (dias 1-15):**
- Release 0 inteiro (81 SP) — precisa de 2 devs com 50 SP/sprint cada
- Comeca Release 1: TASK-010, TASK-012 (19 SP)

**Sprint 2 (dias 16-30):**
- Resto de Release 1: TASK-011, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018 (47 SP)

**Sprint 3 (dias 31-45):**
- Release 2 inteiro (51 SP)
