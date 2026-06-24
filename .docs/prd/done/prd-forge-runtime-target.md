# PRD — Forge Runtime Target (worker no repo-alvo)

> **Contexto:** Forge hoje executa worker com `cwd = process.cwd() = Zordon`. Pra entregar código de cliente, worker precisa rodar no **repo do cliente**, não no Zordon. Este PRD muda o runtime sem alterar a UI nem a infra de PRDs.

## 1 · Problema

1. **Worker fixado em Zordon.** [exec-story.ts:217-220](scripts/forge/exec-story.ts#L217-L220) spawna `claude -p` com `cwd: repoRoot` onde `repoRoot = process.cwd() = Zordon`. Claude vê só arquivos do Zordon — incapaz de mexer no repo do cliente.
2. **Closeout cria PR no Zordon.** Mesmo se worker escrevesse no lugar certo, [closeout.ts](src/lib/forge/closeout.ts) faria `gh pr create` no repo atual (Zordon) — não no repo do cliente.
3. **ForgeRun.projectId é stub.** [cli.ts:165](scripts/forge/cli.ts#L165) hardcoda `00000000-...` — nunca associa run ao Project real.

Sem isso, a Forge é dogfood-only (só melhora Zordon, não entrega cliente).

## 2 · Solução em uma frase

Worker da Forge faz `git clone` do `Project.repoUrl` em `.forge/<runId>/workspace/`, spawna `claude -p` com `cwd=workspace`, e `closeout` faz `gh pr create` no repo-alvo via PAT vinculado ao Project.

## 3 · Não-objetivos

- Não muda UI nem PRD storage.
- Não implementa o daemon mode (PRD `prd-forge-daemon` separado).
- Não suporta repos privados sem PAT pré-configurado (V2).
- Não isola worker em container (V2; por ora `os.tmpdir()` basta).
- Não roteia múltiplos workers paralelos pro mesmo repo-alvo (V2 com lock).

## 4 · Personas e jornada

- **PM**: dispara autorun pra Project "Acme Bank"; espera ver PR aberto em `acme/api`, não em `volund-ia/zordon`.
- **Builder**: clona o PR no repo do cliente normalmente; nenhum link cruzado com Zordon.
- **CEO/auditor**: vê ForgeRun.projectId = real Project ID; consegue agregar custo por cliente.

## 5 · Decisões fixadas

| ID | Decisão | Por quê |
|---|---|---|
| D1 | Workspace path: `.forge/<runId>/workspace/` (não `/tmp`) | Mantém artefatos perto dos events.jsonl, debug local fácil, sobrevive reboot. |
| D2 | Clone via `git clone --depth 1 <repoUrl>` | Shallow clone é faster; full history não é necessário pra Forge. |
| D3 | Branch criada localmente: `forge/<prdSlug>-<runId-short>` | Convenção legível; runId-short = 8 chars do uuid. |
| D4 | PAT por Project armazenado em coluna nova `Project.githubPat` (encrypted) | RLS protege; valor expand-pasted no `.env` do daemon como `FORGE_PAT_${projectId}`. |
| D5 | Closeout faz `gh pr create --repo <owner>/<repo> --base <defaultBranch>` | gh CLI já instalado; usa `GH_TOKEN=<pat>` env override. |
| D6 | `Project.repoUrl` vazio → erro early no `forge init` ("project sem repo configurado") | Falha rápida, mensagem clara. |
| D7 | Worker NÃO tem acesso ao filesystem do Zordon (cwd jaulado em workspace) | Isolamento básico; previne worker corromper repo da plataforma. |
| D8 | Após PR aberto, workspace fica preservado por 24h depois é gc | Permite re-investigar; cron diário limpa. |

## 6 · Arquitetura

```
Antes:
  PM dispara → exec-prd.ts → exec-story.ts → spawn claude -p (cwd=Zordon)
                                                      │
                                                      └─ escreve em src/, docs/ do Zordon

Depois:
  PM dispara → exec-prd.ts (com projectId) → fetchProject(id) → repoUrl + PAT
                            │
                            └─ ensureWorkspace(runId, repoUrl)
                                 ├─ mkdir .forge/<runId>/workspace
                                 ├─ git clone --depth 1 <repoUrl> workspace
                                 ├─ git checkout -b forge/<prdSlug>-<runId-short>
                                 └─ retorna workspacePath
                            │
                            └─ exec-story.ts → spawn claude -p (cwd=workspacePath)
                                                      │
                                                      └─ Claude opera no repo do cliente
                            │
                            └─ closeout.ts → cd workspacePath
                                              git push origin <branch>
                                              gh pr create --repo <owner>/<repo>
                                                          --base <defaultBranch>
                                                          --title "forge: <prdSlug>"
```

## 7 · Schema

Migration única:

```sql
-- supabase/migrations/20260601a_project_forge_pat.sql
ALTER TABLE "Project"
  ADD COLUMN "githubPat" text;  -- nullable; null = repo público OU sem Forge

COMMENT ON COLUMN "Project"."githubPat" IS
  'GitHub Personal Access Token usado pelo Forge worker pra clonar e abrir PR.
   Armazenado em texto cleartext nesta fase; rotação manual.
   V2: criptografar via pgsodium.';

-- RLS: só admin/manager do projeto lê
CREATE POLICY "project_github_pat_select" ON "Project"
  FOR SELECT USING (
    is_admin() OR pmId = (SELECT id FROM "Member" WHERE userId = auth.uid())
  );
```

## 8 · APIs

Funções internas (não-HTTP):

```ts
// src/lib/forge/workspace.ts (NEW)
export async function ensureWorkspace(
  runId: string,
  project: ProjectRow
): Promise<{ workspacePath: string; branch: string }>;

export async function teardownWorkspace(runId: string): Promise<void>;
export async function gcStaleWorkspaces(maxAgeHours = 24): Promise<number>;

// src/lib/forge/closeout.ts (extend existing)
export async function closeout(opts: {
  runId: string;
  workspacePath: string;
  project: ProjectRow;
  prdSlug: string;
}): Promise<{ prUrl: string }>;
```

Endpoint POST `/api/forge/autoruns` ganha `projectId` obrigatório:

```ts
// src/app/api/forge/autoruns/route.ts
POST { prdSlug, projectId, maxStories? }  →  202 + { autorunId }
```

Quando `projectId` ausente, fallback: roda contra Zordon (compat com dogfood atual).

## 9 · UX

Sem mudança UI nesta fase. Visível em:
- Banner do spike "Run sendo executada em `acme/api`" (texto curto)
- Logs de event.jsonl: novo evento `workspace_ready` com `{ path, branch, repoUrl }`
- `forge ps` mostra coluna nova `Target` (= `owner/repo` ou `(zordon)` se fallback)

## 10 · Integrações

- **Project entity**: agora tem `githubPat` opcional + já tinha `repoUrl/githubRepoOwner/githubRepoName/githubDefaultBranch`.
- **gh CLI**: invocado com `GH_TOKEN=<pat>` env override pra usar o token do projeto, não do PM.
- **`.gitignore`**: `.forge/*/workspace/` já é coberto por `/.forge/` (já gitignored).
- **`prd-forge-project-tab` (paralelo)**: a UI vai mostrar runs por projectId; runtime-target preenche esse campo de verdade.

## 11 · Faseamento

| Fase | Entrega |
|---|---|
| 1 | Migration `githubPat` + DAL Project ganha `githubPat` no Update type |
| 2 | `workspace.ts` (ensureWorkspace + teardown) + exec-story usa workspacePath |
| 3 | Closeout adaptado pra `gh pr create --repo` |
| 4 | autoruns route aceita `projectId` + cli `forge run <prd> --project <id>` |
| 5 | gc cron + `forge ps --target` |

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| PAT expira / é revogado | M | A | Detecta 401 do gh, marca Project com warning, notifica PM |
| Clone falha (repo privado sem PAT) | A | A | D6: early error com mensagem clara |
| Workspace ocupa disco demais | M | M | D8: gc cron + max 50 workspaces ativos |
| Worker comita acidentalmente no Zordon (cwd errada) | L | A | D7: cwd jaulado; assert no worker.ts antes de spawn |
| Conflito de branch (forge/<slug> já existe) | M | M | Append runId-short no nome (D3) — torna único |
| PR direto na main do cliente sem review | A | A | Closeout abre PR sempre como draft (default); PM ou Vitoria revisa |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| % runs com `projectId != stub` | `SELECT count(*) FILTER (WHERE projectId != '00000000...') / count(*) FROM ForgeRun` | ≥ 95% em 2 semanas |
| Tempo médio de ensureWorkspace | event `workspace_ready` ts − `run_started` ts | ≤ 30s p95 |
| PRs abertos com sucesso vs falha | events `pr_created` vs `pr_failed` | ≥ 90% sucesso |
| Disco ocupado por `.forge/*/workspace/` | `du -sh .forge/*/workspace/` em cron | ≤ 5GB total |

## 14 · Open questions

Nenhuma. Tudo decidido em §5.

## 15 · Referências

- Memory `project_forge_vs_zordon_workflow.md` — Workflow A vs B (Zordon vs cliente)
- Memory `project_zordon_ops_pipeline.md` — pipeline ops canônico
- `src/lib/supabase/database.types.ts` — Project já tem repoUrl/githubRepo*
- `scripts/forge/exec-story.ts` — spawn claude com cwd
- `src/lib/forge/closeout.ts` — closeout atual (Zordon-centric)

## 16 · Stories implementáveis

```yaml
- id: FRT-001
  title: Migration Project.githubPat + RLS
  description: |
    ALTER TABLE Project ADD COLUMN githubPat text. Política SELECT
    restritiva (só admin OU pmId do projeto). Atualiza database.types.ts.
  acceptanceCriteria:
    - "supabase/migrations/20260601a_project_forge_pat.sql criado"
    - "Migration aplicada via psql DIRECT_URL"
    - "Coluna githubPat existe em information_schema"
    - "Policy project_github_pat_select existe em pg_policies"
    - "database.types.ts atualizado com githubPat?: string | null"
  verifiable:
    - kind: sql
      command_or_query: "SELECT column_name FROM information_schema.columns WHERE table_name='Project' AND column_name='githubPat'"
      expected: "githubPat"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - supabase/migrations/20260601a_project_forge_pat.sql
    - src/lib/supabase/database.types.ts
  agentProfile: db

- id: FRT-002
  title: src/lib/forge/workspace.ts (ensureWorkspace + teardown)
  description: |
    Cria pasta .forge/<runId>/workspace, git clone --depth 1 do repoUrl,
    cria branch forge/<prdSlug>-<runId-short>. teardownWorkspace remove.
    gcStaleWorkspaces remove workspaces > maxAgeHours.
  acceptanceCriteria:
    - "src/lib/forge/workspace.ts exporta ensureWorkspace, teardownWorkspace, gcStaleWorkspaces"
    - "ensureWorkspace falha early se project.repoUrl null/empty (D6)"
    - "Branch name segue padrão forge/<prdSlug>-<runId-short>"
    - "Clone usa --depth 1 (shallow)"
    - "Se PAT presente, injeta como Bearer no clone URL (https://x-access-token:<pat>@github.com/...)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx -e 'import(\"./src/lib/forge/workspace.ts\").then(m => console.log(typeof m.ensureWorkspace))'"
      expected: "function"
  dependsOn: [FRT-001]
  estimateMinutes: 30
  touches:
    - src/lib/forge/workspace.ts
  agentProfile: wiring

- id: FRT-003
  title: exec-story.ts spawna claude com cwd=workspacePath
  description: |
    Antes de spawn, chama ensureWorkspace(runId, project). Passa workspacePath
    pro spawn como cwd. Emite event workspace_ready { path, branch, repoUrl }.
    Fallback: se projectId ausente OU is stub (00000...), mantém cwd=Zordon
    (dogfood mode).
  acceptanceCriteria:
    - "scripts/forge/exec-story.ts importa ensureWorkspace"
    - "Se projectId real, chama ensureWorkspace antes do spawn claude"
    - "spawn passa cwd: workspacePath"
    - "Emit event workspace_ready com path, branch, repoUrl"
    - "Fallback cwd=Zordon quando projectId stub (compat dogfood)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FRT-002]
  estimateMinutes: 25
  touches:
    - scripts/forge/exec-story.ts
  agentProfile: wiring

- id: FRT-004
  title: closeout faz gh pr create no repo-alvo
  description: |
    closeout.ts: cd workspacePath, git push origin <branch>, gh pr create
    --repo <owner>/<repo> --base <defaultBranch> --draft --title "forge: <prdSlug>"
    --body "<body from prd.json>". Usa GH_TOKEN=<pat> override.
  acceptanceCriteria:
    - "src/lib/forge/closeout.ts aceita { runId, workspacePath, project, prdSlug }"
    - "Faz git push origin <branch> dentro do workspacePath"
    - "gh pr create usa --repo <owner>/<repo> e --base <defaultBranch>"
    - "PR aberto sempre como --draft (D12)"
    - "Se project.githubPat presente, exporta GH_TOKEN antes do gh"
    - "Retorna { prUrl } extraído do stdout"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FRT-002]
  estimateMinutes: 25
  touches:
    - src/lib/forge/closeout.ts
  agentProfile: wiring

- id: FRT-005
  title: API + CLI aceitam projectId
  description: |
    POST /api/forge/autoruns aceita { prdSlug, projectId, maxStories? }.
    forge init/run no CLI aceita --project <id>. Quando projectId presente,
    ForgeRun row é criada com projectId real (não stub).
  acceptanceCriteria:
    - "src/app/api/forge/autoruns/route.ts valida projectId opcional; quando presente, persiste"
    - "scripts/forge/cli.ts subcomandos init/run aceitam --project flag"
    - "ForgeRun.projectId reflete valor real OU stub conforme fallback"
    - "Help text do CLI documenta --project"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -X POST http://localhost:3333/api/forge/autoruns -H 'Content-Type: application/json' -d '{\"prdSlug\":\"x\",\"projectId\":\"abc\"}' | head -c 100"
      expected: "contains autorunId or error"
  dependsOn: [FRT-003, FRT-004]
  estimateMinutes: 20
  touches:
    - src/app/api/forge/autoruns/route.ts
    - scripts/forge/cli.ts
  agentProfile: api

- id: FRT-006
  title: gcStaleWorkspaces cron + forge ps --target
  description: |
    Adiciona script scripts/forge/gc-workspaces.ts que chama gcStaleWorkspaces
    (default 24h). pg_cron schedule diária 03:00 UTC chama via http endpoint
    interno. forge ps mostra nova coluna Target (= owner/repo ou (zordon)).
  acceptanceCriteria:
    - "scripts/forge/gc-workspaces.ts existe e funciona standalone"
    - "supabase/migrations/20260601b_forge_workspace_gc_cron.sql agenda job"
    - "forge ps mostra coluna 'Target' (último ProjectRun.projectId resolvido)"
    - "Coluna Target = '(zordon)' quando projectId = stub"
  verifiable:
    - kind: sql
      command_or_query: "SELECT jobname FROM cron.job WHERE jobname='forge_workspace_gc'"
      expected: "forge_workspace_gc"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FRT-002]
  estimateMinutes: 25
  touches:
    - scripts/forge/gc-workspaces.ts
    - scripts/forge/cli.ts
    - supabase/migrations/20260601b_forge_workspace_gc_cron.sql
  agentProfile: db
```

Total: 6 stories, ~140min estimados.
