# Reorganização de Reuniões — Plano

> Decidido com João em 2026-05-27. Substitui o modelo de 5 tipos num único tab global.
> Memory: `project_meetings_reorg`.

## Princípio

Eixo novo: **"a reunião é sobre um projeto?"**

- **Sim** → vira **Cerimônia**, dentro do tab do projeto (`projects/[id]`), irmão de Stories/Sprints/Sessions/Wiki. Análogo direto ao tab **Sessions** (Design Sessions).
- **Não** → fica na **aba global `/meetings`**, agora só com 2 visibilidades: **privada** e **pública**.

Mapeamento dos 5 tipos atuais:

| Tipo atual | Destino | Dados em prod |
|------------|---------|---------------|
| `daily` | Cerimônia | 0 (greenfield) |
| `super_planning` | Cerimônia | 2 (+ SuperPlanningSession + sprintId) |
| `pm_review` | Cerimônia | 6 (+ 23 MeetingProjectReview) |
| `private` | Global, privada (dono só, sem admin bypass) | 7 |
| `general` | Global, pública (quem participou vê) | — |

A infra de dados (tabela `Meeting`, `MeetingSheet`, `POST /api/meetings`, RLS) **já suporta os 3 tipos**. O trabalho é de superfície + escopo, não de schema novo.

---

## Fase 1 — Cerimônias no projeto (começa aqui)

**Risco:** baixo. `daily=0`, `super_planning=2`, `pm_review=6` — pouco dado, e nada se apaga nesta fase (a aba global continua funcionando em paralelo até a Fase 2).

### 1.1 Novo tab no projeto

- `src/app/(dashboard)/projects/[id]/_types.ts` — adicionar `"ceremonies"` ao union `TabKey`.
- `src/app/(dashboard)/projects/[id]/page.tsx`:
  - **TABS array** (linhas ~86-92): inserir `{ key: "ceremonies", label: "Cerimônias", icon: CalendarClock }` antes de `wiki`.
  - **Render switch** (linhas ~1638-1712): inserir branch antes de `wiki`:
    ```tsx
    ) : activeTab === "ceremonies" ? (
      <ProjectCeremoniesTab
        projectId={id}
        projectName={project.name}
        canManage={canManageSprint}
      />
    ```

### 1.2 Componente `ProjectCeremoniesTab`

- Novo: `src/components/project-ceremonies-tab.tsx`. **Copiar o esqueleto de `project-sessions-tab.tsx`**, trocando DesignSession por Meeting (filtrado por projeto + tipos de cerimônia).
- Props: `{ projectId, projectName, canManage? }` (mesmo shape do SessionsTab).
- Estado: `useOptimisticCollection<MeetingSummary>([])` (regra do CLAUDE.md — nunca setState direto após fetch em lista).
- Filtros (tabs com contagem): `Todas | Daily | Planning | Review` por tipo. Espelha o padrão de filtros do SessionsTab (all/active/completed).
- Botão de criar abre `MeetingSheet` com `defaultType` pré-setado conforme o filtro/contexto. **Reusa o MeetingSheet existente** — ele já tem os blocos de campo de daily/super_planning/pm_review.
- Item da lista abre o sheet de detalhe (reusar o fluxo de detalhe atual de `/meetings/[id]`, ou abrir MeetingSheet em mode edit — decidir na implementação; SessionsTab abre detail sheet inline).

### 1.3 Fetch project-scoped

Opção escolhida: **nova rota** `GET /api/projects/[id]/ceremonies` (segue o padrão de `/members`, `/stories`, `/modules` — mais explícito que query Supabase direta, e centraliza o `canViewMeeting`).

- Handler filtra `Meeting` por `projectId` (via `MeetingProjectLink`) + `type IN ('daily','super_planning','pm_review')` + roda `canViewMeeting()` por linha.
- Retorna o shape de summary que a lista precisa (id, type, date, title, sprint, contagens).

### 1.4 MeetingSheet — ajuste de contexto

- Quando aberto a partir do tab de Cerimônias, o `projectId` já vem fixado (não mostra o ProjectPicker, ou mostra travado no projeto atual). Hoje o picker é genérico; aqui o projeto é o contexto.
- `super_planning` continua exigindo sprint ativa (validação atual em `route.ts:145-165` permanece).
- `pm_review` no contexto de projeto: revisa **aquele** projeto (não a lista de PMs transversal). Esse é o ajuste mais delicado — hoje pm_review parte de uma seleção de PMs e deriva os projetos. No tab do projeto, é o inverso: o projeto é dado, o PM é o revisor. **Precisa de decisão de UX na hora de implementar** (provavelmente: pré-seleciona o PM do projeto via `Project.pmId`).

### 1.5 O que NÃO muda na Fase 1

- A aba global `/meetings` continua existindo e funcionando (com todos os 5 tipos) até a Fase 2.
- Nenhuma migração de dados destrutiva. Os 8 meetings de projeto (2 planning + 6 review) passam a **também** aparecer no tab do projeto via filtro — sem mover linha nenhuma.
- RLS / `canViewMeeting` inalterado (visibilidade por attendee/PM já é project-aware).

---

## Fase 2 — Aba global vira privada/pública

> Depende da Fase 1 estar de pé (cerimônias já têm casa no projeto).

- `/meetings` passa a listar/criar **só** `private` e `general`.
- `MeetingSheet` (no contexto global) some os tipos daily/super_planning/pm_review do seletor.
- `general` é apresentado como "pública": quem participou vê (regra de attendee já existe em `canViewMeeting`).
- `private` permanece dono-só, sem admin bypass.
- Decisão a tomar: os meetings de cerimônia ainda aparecem em `/meetings` ou somem de lá de vez (só no projeto)? Provavelmente somem — senão a simplificação não acontece de verdade.
- Coupling a tratar: 83 decision points mapeados (maior em `meeting-sheet.tsx` ~35 e `meetings/[id]/page.tsx` ~17), RPC de visibilidade em `20260428_meeting_visibility.sql` com type checks hardcoded.

---

## Fase 3 — Alpha escreve status semanal no Wiki

> A parte mais interessante. Vem por último: o Alpha precisa que as cerimônias/reuniões já estejam organizadas pra ter o que ler.

- **Modelo já aceita:** `ProjectWikiSection` é JSON polimórfico (`data: Json` por `sectionKey`). Adicionar section `weekly_status` com shape tipo `{ week, summary, highlights[], risks[], generatedAt, sourceMeetingIds[] }`.
- **Endpoint já existe:** `PUT /api/projects/[id]/wiki/[sectionKey]` aceita `{ data, title? }`.
- **Falta no Alpha:** tool `update_wiki_section` em `src/lib/agent/agents/alpha/tools.ts` (write tool, gated por `capabilities.writeTools`). Alpha já tem `get_recent_meetings` / `getMeetingDetail` pra leitura.
- **Gatilho:** rodar no fluxo de insights (`/api/cron/run-alpha-insights`, pg_cron) ou sob demanda. Alpha lê as reuniões públicas + cerimônias da semana → escreve o pulso do projeto na section.
- Comportamento desejado (palavras do João): "o Alpha pudesse ler as reuniões e colocar um status de como está o projeto naquela semana".

---

## Ordem de execução

1. **Fase 1** ← agora.
2. Fase 2 (simplifica o global).
3. Fase 3 (Alpha → Wiki).

Cada fase é entregável e reversível de forma independente.
