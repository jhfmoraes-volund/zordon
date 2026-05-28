# Reorganização de Reuniões — Plano

> Decidido com João em 2026-05-27. Substitui o modelo de 5 tipos num único tab global.
> Memory: `project_meetings_reorg`.

## Princípio: separar EVENTO de ARTEFATO

A decisão central não é só mover abas — é **desfundir dois conceitos** que hoje são a mesma linha na tabela `Meeting`:

```
EVENTO (Meeting)                    ARTEFATO (Cerimônia / DS)
"o que aconteceu"                   "o trabalho do projeto"
─────────────────                   ─────────────────────────
transcript, participantes,          daily / planning / pm_review / DS
data, fonte (Granola/Roam)          status, decisões, plano de tasks
vive na aba global /meetings        vive no tab Cerimônias do projeto
        │                                      │
        └──────── link N:N (opcional) ─────────┘
              "essa call alimentou essa planning"
```

Eixo de navegação: **"a reunião é sobre um projeto?"**
- **Sim** → o trabalho vira **Cerimônia** (artefato), dentro do tab do projeto, irmão de Stories/Sprints/Sessions/Wiki. Análogo direto ao tab **Sessions** (DS).
- **Não** → fica na **aba global `/meetings`**, só com 2 visibilidades: **privada** e **pública**.

Mapeamento dos 5 tipos atuais:

| Tipo atual | Destino | Dados em prod |
|------------|---------|---------------|
| `daily` | Cerimônia (artefato) | 0 (greenfield) |
| `super_planning` | Cerimônia (artefato) | 2 (+ SuperPlanningSession + sprintId) |
| `pm_review` | Cerimônia (artefato, **por projeto**) | 6 (+ 23 MeetingProjectReview) |
| `private` | Global, privada (dono só, sem admin bypass) | 7 |
| `general` | Global, pública (quem participou vê) | — |

### Decisões de modelagem (confirmadas com João)

1. **Link reunião ↔ artefato é N:N** — uma call pode alimentar uma planning E uma DS. Tabela de junção, não FK obrigatório.
2. **Cerimônia pode existir sem reunião** — cria-se a planning/daily direto no projeto (artefato puro); a reunião-evento é evidência **opcional**. Idêntico a como DS funciona hoje.
3. **Overview de gestão = agregado na home do dashboard** (`(dashboard)/page.tsx`) — concatena as cerimônias de todos os projetos do gestor. Lê **artefatos**, não transcripts. É onde o status semanal do Alpha (Fase 3) aparece em nível de portfólio.
4. **pm_review continua por projeto** — o projeto é dado, o PM é o revisor (pré-selecionar via `Project.pmId`).
5. **Link bidirecional** — (a) de dentro da cerimônia/DS, anexar reunião; (b) de dentro da reunião, promover/linkar a cerimônia ou DS.

A infra de dados (`Meeting`, `MeetingSheet`, `POST /api/meetings`, RLS) **já suporta os 3 tipos**. O novo schema é só a **tabela de link** N:N.

---

## Fase 1 — Cerimônias no projeto (começa aqui)

**Risco:** baixo. `daily=0`, `super_planning=2`, `pm_review=6` — pouco dado, nada se apaga (a aba global segue em paralelo até a Fase 2).

### 1.1 Schema — tabela de link N:N

Nova migration `supabase/migrations/<data>_meeting_artifact_link.sql`:
- Tabela `MeetingArtifactLink`: `{ id, meetingId FK→Meeting, artifactType ('ceremony'|'design_session'), artifactId, projectId, createdById, createdAt }`.
  - Nota: "ceremony" não é tabela nova — é um `Meeting` de tipo daily/super_planning/pm_review. O link pode apontar Meeting↔Meeting (evento ↔ cerimônia) e Meeting↔DesignSession.
  - Index por `meetingId` e por `(artifactType, artifactId)`.
- RLS: visível a quem vê **ambos** os lados do link (reusa `canViewMeeting` + visibilidade de DS).
- Rodar via psql (`source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f ...`) e atualizar `database.types.ts`.

> Decisão aberta p/ implementação: "Cerimônia" reusa a tabela `Meeting` (tipo) ou ganha tabela própria `ProjectCeremony`? Reusar `Meeting` é menos schema e preserva os 8 registros sem migração; tabela própria é mais limpa conceitualmente mas exige migrar SuperPlanningSession + MeetingProjectReview. **Recomendação: reusar `Meeting`** na Fase 1 (escopo via tipo + link), reavaliar na Fase 2.

### 1.2 Novo tab no projeto

- `src/app/(dashboard)/projects/[id]/_types.ts` — adicionar `"ceremonies"` ao union `TabKey`.
- `src/app/(dashboard)/projects/[id]/page.tsx`:
  - **TABS array** (~86-92): inserir `{ key: "ceremonies", label: "Cerimônias", icon: CalendarClock }` antes de `wiki`.
  - **Render switch** (~1638-1712): inserir branch antes de `wiki`:
    ```tsx
    ) : activeTab === "ceremonies" ? (
      <ProjectCeremoniesTab projectId={id} projectName={project.name} canManage={canManageSprint} />
    ```

### 1.3 Componente `ProjectCeremoniesTab`

- Novo: `src/components/project-ceremonies-tab.tsx`. **Copiar o esqueleto de `project-sessions-tab.tsx`**.
- Props: `{ projectId, projectName, canManage? }`.
- Estado: `useOptimisticCollection<CeremonySummary>([])` (regra CLAUDE.md — nunca setState direto após fetch em lista).
- Filtros (tabs com contagem): `Todas | Daily | Planning | Review`.
- Criar: abre `MeetingSheet` com `defaultType` + `projectId` fixado.
- Item da lista: abre detalhe; no detalhe, **seção de reuniões linkadas** (anexar/desanexar) — direção (a) do link bidirecional.

### 1.4 Fetch project-scoped

Nova rota `GET /api/projects/[id]/ceremonies` (padrão `/members`, `/stories`):
- Filtra `Meeting` por projeto (via `MeetingProjectLink`) + `type IN ('daily','super_planning','pm_review')` + `canViewMeeting()` por linha.
- Inclui contagem de reuniões-evento linkadas (via `MeetingArtifactLink`).

### 1.5 MeetingSheet — ajuste de contexto

- Aberto do tab Cerimônias: `projectId` fixado (sem ProjectPicker genérico).
- `super_planning`: mantém exigência de sprint ativa (`route.ts:145-165`).
- `pm_review` no projeto: pré-seleciona o PM via `Project.pmId` (projeto dado, PM revisor).

### 1.6 Link bidirecional (direção b)

- Na reunião-evento (global), ação "Linkar a uma cerimônia/DS" → escreve `MeetingArtifactLink`.
- Reusa o padrão de picker existente; não precisa de tela nova pesada.

### 1.7 O que NÃO muda na Fase 1

- Aba global `/meetings` segue com os 5 tipos até a Fase 2.
- Zero migração destrutiva. Os 8 meetings de projeto passam a **também** aparecer no tab via filtro.
- RLS / `canViewMeeting` inalterado.

---

## Fase 2 — Aba global vira privada/pública

> Depende da Fase 1 de pé.

- `/meetings` lista/cria **só** `private` e `general`.
- `MeetingSheet` global: some daily/super_planning/pm_review do seletor.
- `general` = "pública" (quem participou vê); `private` = dono-só.
- Cerimônias somem de `/meetings` (só no projeto) — senão a simplificação não acontece.
- Coupling: 83 decision points (maior em `meeting-sheet.tsx` ~35, `meetings/[id]/page.tsx` ~17); RPC de visibilidade em `20260428_meeting_visibility.sql` com type checks hardcoded.

---

## Fase 3 — Alpha → status semanal (Wiki por projeto + Overview agregado)

> A feature de produto de verdade. Vem por último: precisa dos artefatos organizados pra ter o que ler.

- **Nível projeto:** section `weekly_status` em `ProjectWikiSection` (JSON polimórfico já aceita). Shape `{ week, summary, highlights[], risks[], generatedAt, sourceArtifactIds[] }`. Endpoint `PUT /api/projects/[id]/wiki/[sectionKey]` já existe.
- **Nível portfólio:** seção na **home do dashboard** (`(dashboard)/page.tsx`) concatena os `weekly_status` de todos os projetos do gestor. Resolve a visão transversal.
- **Falta no Alpha:** tool `update_wiki_section` em `src/lib/agent/agents/alpha/tools.ts` (write tool, gated por `capabilities.writeTools`). Alpha já lê via `get_recent_meetings` / `getMeetingDetail`.
- **Insumo:** Alpha lê os **artefatos** (cerimônias) + reuniões linkadas da semana → sintetiza o pulso. Como lê artefato estruturado (não transcript cru), a síntese é mais confiável.
- **Gatilho:** fluxo de insights (`/api/cron/run-alpha-insights`, pg_cron) ou sob demanda.
- **Risco de produto:** status auto-gerado só vale se um humano lê e concorda. O valor está na qualidade da síntese, não no plumbing. Tratar a Fase 3 como o *porquê* do projeto; Fases 1-2 são a fundação que a habilita.

---

## Ordem de execução

1. **Fase 1** ← agora (schema de link + tab + componente).
2. Fase 2 (simplifica o global).
3. Fase 3 (Alpha → status, projeto + portfólio).

Cada fase é entregável e reversível de forma independente.
