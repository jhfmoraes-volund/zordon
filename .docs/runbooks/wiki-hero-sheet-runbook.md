# Runbook — Wiki vira botão no hero (side sheet read-first)

> **Executor:** agente Claude Code, fresh context. Leia este runbook inteiro antes de tocar em código.
> **Sequência:** rodar ANTES de `project-drive-runbook.md` (este remove a aba Wiki; aquele cria a aba Drive no lugar).
> **Commit:** ao final de cada story que passa os checks, `bash scripts/sync-main.sh -m "ZRD-JM-NN: wiki — <resumo>"`.

## 1. Problema

- A Wiki ocupa uma aba inteira do projeto, mas é conteúdo de **consulta** (descrição, links, sponsors, KPIs, objetivos, ambientes, acessos) — não um workspace de trabalho diário como Stories/Sprints.
- A aba vai ser substituída pela integração Google Drive (runbook irmão).
- O componente atual ([src/components/project-wiki.tsx](../../src/components/project-wiki.tsx), ~1353 linhas) mistura leitura e CRUD inline em 7 seções — pesado demais pra portar como está pra um sheet de 760px.

## 2. Solução em uma frase

Wiki vira um botão no hero do projeto que abre um `ResponsiveSheet` read-first (seções em accordion, edição pontual por seção), e a aba `wiki` sai do TABS.

## 3. Não-objetivos

- NÃO mudar a API `/api/projects/[id]/wiki` nem o schema (ProjectWikiSection etc. ficam intactos).
- NÃO implementar a aba Drive (runbook irmão).
- NÃO reescrever a lógica de geração/compose da Wiki v2.
- NÃO adicionar seções novas.

## 4. Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | `ResponsiveSheet size="lg"` (760px desktop, bottom-sheet 90dvh mobile) | Padrão canônico do repo; hero já abre 2 sheets (Edit, Access) |
| D2 | Read-first: seções renderizam em **accordion colapsável**, todas fechadas exceto Descrição | 7 seções de CRUD inline não cabem em 760px; consulta é o caso de uso dominante |
| D3 | Edição pontual: botão de lápis por seção abre o form **daquela seção** dentro do próprio accordion (reusar os forms existentes do project-wiki.tsx) | Não perder capacidade de edição; não redesenhar forms |
| D4 | Fetch lazy: dados só carregam quando o sheet abre (mesmo endpoint atual) | Hero não pode pagar custo da Wiki em todo load de projeto |
| D5 | Botão no hero: ícone `FileText`, label "Wiki", ao lado de "Editar projeto" | Consistência com botões existentes |
| D6 | Aba `wiki` removida do array TABS no mesmo PR | Evitar duas portas de entrada divergentes |
| D7 | `project-wiki.tsx` é **refatorado em pasta** `src/components/project-wiki/` (sheet + seções), não duplicado | 1353 linhas num arquivo já era backlog do sage; proibido copiar/colar pra dentro do sheet |
| D8 | Permissões inalteradas: mesmas regras de edição que a aba tinha (guest read-only etc.) | Sem mudança de modelo de acesso |

## 5. Mapa do código (estado atual)

| O quê | Onde |
|-------|------|
| Hero do projeto (inline, com botões Editar/Access) | `src/app/(dashboard)/projects/[id]/page.tsx` ~linhas 430-476 |
| Array TABS (7 abas, wiki incluída) | mesmo arquivo, declaração TABS + render ~531-562 |
| Wiki atual (7 seções + CRUD) | `src/components/project-wiki.tsx` (1353 linhas) |
| Padrão de sheet aberto pelo hero | `src/components/projects/project-edit-sheet.tsx` (ResponsiveSheet suite completa, `size="md"`) |
| Primitivo sheet | `src/components/ui/responsive-sheet.tsx` |

As 7 seções: Description (Tiptap), Links, Sponsors, Indicators, Objectives, Environments, Access.

## 6. Stories

```yaml
- id: WHS-001
  title: Quebrar project-wiki.tsx em pasta de seções
  description: >
    Mover src/components/project-wiki.tsx para src/components/project-wiki/
    (index.tsx + um arquivo por seção: description.tsx, links.tsx, sponsors.tsx,
    indicators.tsx, objectives.tsx, environments.tsx, access.tsx + types.ts).
    Zero mudança de comportamento — só extração. Imports externos atualizados.
  acceptanceCriteria:
    - "src/components/project-wiki.tsx não existe mais"
    - "src/components/project-wiki/ tem index.tsx + 7 arquivos de seção"
    - "Aba Wiki continua funcionando igual (ainda não foi removida)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "test ! -f src/components/project-wiki.tsx && ls src/components/project-wiki/ | wc -l"
      expected: ">= 8 arquivos"
  dependsOn: []
  estimateMinutes: 25
  touches: [src/components/project-wiki/, src/app/(dashboard)/projects/[id]/page.tsx]

- id: WHS-002
  title: Modo read-only por seção
  description: >
    Cada seção ganha um modo de render compacto read-only (sem botões de add/delete
    inline visíveis por padrão). Accordion próprio (pode usar details/summary estilizado
    ou padrão existente no repo — verificar src/components/ui/ antes de criar).
  acceptanceCriteria:
    - "Cada seção exporta componente com prop mode: 'read' | 'edit'"
    - "Em mode='read', nenhum form é renderizado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [WHS-001]
  estimateMinutes: 30
  touches: [src/components/project-wiki/]

- id: WHS-003
  title: ProjectWikiSheet
  description: >
    Criar src/components/project-wiki/wiki-sheet.tsx — ResponsiveSheet size="lg",
    header "Wiki — <nome do projeto>", body com as 7 seções em accordion (Descrição
    aberta, resto fechado). Fetch lazy no onOpen (mesmo endpoint da aba). Lápis por
    seção alterna mode read↔edit. Estado de loading com Skeleton.
  acceptanceCriteria:
    - "Sheet abre, busca dados e renderiza as 7 seções"
    - "Edição por seção persiste igual à aba antiga"
    - "Fechar e reabrir o sheet refaz fetch (sem cache stale)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "abrir /projects/<id>, clicar botão Wiki, editar um link, salvar, reabrir"
      expected: "edição persistida; layout ok em mobile (bottom-sheet)"
  dependsOn: [WHS-002]
  estimateMinutes: 30
  touches: [src/components/project-wiki/wiki-sheet.tsx]

- id: WHS-004
  title: Botão Wiki no hero + remover aba
  description: >
    Adicionar botão "Wiki" (FileText) no hero ao lado de "Editar projeto", abrindo o
    ProjectWikiSheet. Remover entry wiki do array TABS e o render do conteúdo da aba.
    Tratar deep-link: ?tab=wiki redireciona pra tab default com o sheet aberto.
  acceptanceCriteria:
    - "Botão Wiki visível no hero pra todos que viam a aba"
    - "Aba wiki não existe mais no TABS"
    - "URL antiga ?tab=wiki não quebra (fallback gracioso)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "grep -c '\"wiki\"' 'src/app/(dashboard)/projects/[id]/page.tsx'"
      expected: "0 ocorrências no array TABS (pode sobrar no handler de fallback)"
    - kind: manual_browser
      command_or_query: "abrir /projects/<id>?tab=wiki"
      expected: "não quebra; sheet Wiki abre ou cai na tab default"
  dependsOn: [WHS-003]
  estimateMinutes: 20
  touches: [src/app/(dashboard)/projects/[id]/page.tsx]
```

## 7. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Refactor de 1353 linhas introduz regressão silenciosa em seção pouco usada | média | médio | WHS-001 é extração pura (sem mudança de lógica); diff revisável seção a seção |
| Tiptap (Descrição) dentro de sheet com scroll aninhado | média | baixo | Testar no manual_browser de WHS-003; se conflitar, Descrição abre edição em tela cheia do accordion |
| Outra sessão/branch tocando page.tsx em paralelo | baixa | médio | Stories WHS-001..003 não tocam page.tsx além de import; WHS-004 é a única mudança real lá — fazer por último e re-verificar tsc |
