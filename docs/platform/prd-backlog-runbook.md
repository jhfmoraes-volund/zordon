# Runbook — Backlog de PRDs (estado via subdiretório, execução via 1 comando)

**Status:** Proposta · **Owner:** João · **Data:** 2026-05-29 · **Estado atual:** plano, não executado

Resolve o gap entre "PRD existe" e "Ralph executa": estado explícito por PRD, fila ordenada via filesystem, 1 comando dispara o próximo.

## Princípio

**Filesystem é estado.** O subdir onde o PRD vive **é** o status — não tem frontmatter, não tem índice paralelo, não tem banco. `ls docs/prd/ready/` é a fila. Mover o `.md` muda o status. Igual ao pattern já estabelecido pro próprio Ralph (`prd.json` com `passes: bool` é o estado da story).

## Estrutura proposta

```
docs/prd/
├── backlog/           # ideação — PRD existe mas Rito 1 (intake) não rodou
│   └── prd-foo.md
├── ready/             # Rito 1 done. prd.json existe. Pronto pra Ralph.
│   └── prd-opportunities.md
├── in-progress/       # Rito 2 rodando ou pausado entre loops
│   └── prd-project-wiki.md
├── blocked/           # Rito 3 (checkpoint humano) pendente. Ralph parou.
│   └── prd-bar.md
├── done/              # Rito 4 closeout feito, aguardando arquivamento
│   └── prd-baz.md
└── archive/           # histórico (já está em docs/archive/, mas centralizar aqui)
    └── prd-baz-20260601.md
```

**Regras:**
- Filename **não muda** entre estados (só o caminho). Links Markdown cross-doc seguem padrão `docs/prd/<estado>/prd-<feature>.md` — quando mover, atualizar refs (script `prd-rename-refs.sh` se virar pain).
- 1 PRD por subdir é override do default (mover manualmente). Default = Ralph automatiza.
- `archive/` recebe filename com sufixo de data: `prd-<feature>-YYYYMMDD.md`. Só `archive/` tem esse rename.

## Fluxo end-to-end (o que você vê)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Você cria PRD em docs/prd/backlog/prd-<feature>.md          │
│    (formato §1-§16 do AGENTS.md, mesmo que hoje)                │
│                                                                  │
│ 2. Você roda Rito 1 (intake) — pode ser manual ou via skill:    │
│    - hardening do PRD                                            │
│    - cria scripts/ralph/features/<feature>/prd.json             │
│    - mv docs/prd/backlog/prd-<feature>.md docs/prd/ready/       │
│                                                                  │
│ 3. Você roda: bash scripts/ralph/next.sh                        │
│    - pega 1º de docs/prd/ready/ (ordem: lexicográfica ou        │
│      via docs/prd/ready/.order opcional)                         │
│    - mv pra in-progress/                                         │
│    - dispara ralph.sh <feature> internamente                     │
│    - quando loop termina (sucesso ou abort):                     │
│        * 100% passes: mv pra blocked/ (espera checkpoint humano) │
│        * abort/3 falhas: mv pra blocked/ + abre prompt review    │
│                                                                  │
│ 4. Você revisa em blocked/:                                      │
│    - bash scripts/ralph/checkpoint.sh <feature>                  │
│    - decide: continue (mv → in-progress + ralph.sh) /            │
│              abort (mv → archive/ com data) /                    │
│              done (mv → done/ + closeout.sh)                     │
│                                                                  │
│ 5. closeout.sh roda audit + mv done/ → archive/ datada           │
└─────────────────────────────────────────────────────────────────┘
```

**Operação mínima sua:** passos 1, 3, 4. Tudo o resto = scripts.

## Script novo: `scripts/ralph/next.sh`

Pseudo-código (não criar ainda):

```bash
#!/usr/bin/env bash
set -euo pipefail

READY_DIR="docs/prd/ready"
IN_PROGRESS_DIR="docs/prd/in-progress"
BLOCKED_DIR="docs/prd/blocked"

# 1. Pick next PRD
next=$(ls "$READY_DIR" 2>/dev/null | grep '^prd-.*\.md$' | sort | head -1)
if [[ -z "$next" ]]; then
  echo "Backlog vazio em $READY_DIR. Mova um PRD pra cá ou rode Rito 1."
  exit 0
fi

feature="${next#prd-}"; feature="${feature%.md}"

# 2. Validar que prd.json existe
prdjson="scripts/ralph/features/${feature}/prd.json"
if [[ ! -f "$prdjson" ]]; then
  echo "ERRO: $prdjson não existe. Rito 1 incompleto pra $feature."
  exit 1
fi

# 3. Move ready/ → in-progress/
mkdir -p "$IN_PROGRESS_DIR"
mv "$READY_DIR/$next" "$IN_PROGRESS_DIR/$next"
echo "▶ Iniciando $feature (movido pra in-progress/)"

# 4. Dispara Ralph
bash scripts/ralph/ralph.sh "$feature" "${1:-10}"
ralph_exit=$?

# 5. Closeout policy: SEMPRE move pra blocked/ (humano decide)
mkdir -p "$BLOCKED_DIR"
mv "$IN_PROGRESS_DIR/$next" "$BLOCKED_DIR/$next"

if [[ $ralph_exit -eq 0 ]]; then
  passes=$(jq '[.userStories[] | select(.passes==true)] | length' "$prdjson")
  total=$(jq '.userStories | length' "$prdjson")
  echo "✓ Ralph terminou: $passes/$total stories. Movido pra blocked/ (review humano)."
  echo "  Próximo: bash scripts/ralph/checkpoint.sh $feature"
else
  echo "⚠ Ralph abortou (exit $ralph_exit). Movido pra blocked/."
  echo "  Próximo: bash scripts/ralph/checkpoint.sh $feature  # avaliar falha"
fi
```

**Decisões do script:**
- **Ordenação:** lexicográfica padrão. Se precisar priorizar, prefixar filename: `01-prd-urgent.md`, `02-prd-normal.md` (filename muda, mas é override consciente). Alternativa: `docs/prd/ready/.order` (lista de filenames), mas adiciona complexidade — fica fase 2 se ordem virar problema.
- **Nunca arquiva sozinho:** mesmo 100% passes vai pra `blocked/`. Humano sempre revisa antes de done.
- **Idempotente:** rodar 2x seguidas com mesmo PRD em `in-progress/` é detectado (validação opcional adicionar: `if ls in-progress/ tem coisa, alertar`).

## Updates necessários

| Arquivo | Mudança |
|---------|---------|
| `scripts/ralph/next.sh` | **novo** — código acima |
| `scripts/ralph/ralph.sh` | aceitar PRD que mora em `docs/prd/in-progress/` (hoje provavelmente assume `docs/prd/`). Ajuste no path resolver. |
| `scripts/ralph/checkpoint.sh` | aceitar PRD em `blocked/`. Adicionar opções `--done` / `--abort` que movem pra `done/` ou `archive/`. |
| `scripts/ralph/closeout.sh` | move `done/<file>.md` → `archive/<file>-YYYYMMDD.md`, atualiza memory. |
| `docs/runbooks/ralph-process.md` | adicionar §0 com a nova estrutura de subdirs antes do "Os 4 ritos". Atualizar Rito 1 (output muda: PRD vai pra `ready/`, não `docs/prd/`). |
| `AGENTS.md` (bloco "Onde mora cada coisa") | atualizar linha de `docs/` apontando pra subdirs de `docs/prd/`. |
| `AGENTS.md` (bloco "PRDs — escrever pra Ralph") | adicionar que PRD novo nasce em `backlog/`, vai pra `ready/` após auto-checklist. |
| memory `project_ralph_process.md` | adicionar paths de subdir + comando `next.sh`. |

## Migração dos 5 PRDs existentes

PRDs hoje em [docs/prd/](docs/prd/):

| Arquivo | Estado real | Destino proposto | Confirma? |
|---------|------------|------------------|-----------|
| `prd-alpha-project-insights.md` | feature existe e roda (ver memory `project_alpha_agent`) | `archive/prd-alpha-project-insights-20260529.md` | ? |
| `prd-design-session.md` | feature existe e roda há semanas | `archive/prd-design-session-20260529.md` | ? |
| `prd-opportunities.md` | acabei de criar com prd.json | `ready/prd-opportunities.md` | sim |
| `prd-project-wiki.md` | Ralph piloto ativo (memory `project_wiki_v2`) | `in-progress/prd-project-wiki.md` | sim |
| `prd-vitor-output-as-prd.md` | draft 2026-05-29 (memory `project_vitor_as_pm`) | `backlog/prd-vitor-output-as-prd.md` | sim |
| `vitoria-prd.md` | estado desconhecido (filename fora do padrão) | rename → `backlog/prd-vitoria.md` ou archive | ? |

> Os 3 ambíguos (?) precisam de você confirmar antes de mover.

## Auto-checklist antes de executar

- [ ] Decidir destino dos 3 PRDs ambíguos (`alpha-project-insights`, `design-session`, `vitoria-prd`)
- [ ] Aprovar nome do script (`next.sh` vs `ralph-next.sh` — sugestão: `next.sh` curto)
- [ ] Aprovar política de ordenação (lexicográfica default vs prefixo numérico opcional)
- [ ] Aprovar template de filename do archive (`prd-X-YYYYMMDD.md`)
- [ ] Ajustar `ralph.sh`/`checkpoint.sh`/`closeout.sh` pra novos paths antes de mover PRDs (senão quebra Ralph que tá rodando wiki)

## Sequência de execução (quando for fazer)

1. **Branch + commit prep:** garantir clean tree (Ralph do wiki pode estar com mudanças)
2. **Criar subdirs vazios** (`mkdir -p docs/prd/{backlog,ready,in-progress,blocked,done,archive}`)
3. **Atualizar scripts** primeiro (`ralph.sh`, `checkpoint.sh`, `closeout.sh`, criar `next.sh`) — não move nada ainda
4. **Testar em dry-run** com 1 PRD novo
5. **Mover PRDs existentes** conforme tabela acima
6. **Atualizar AGENTS.md** e runbook
7. **Commit:** `ZRD-JM-NN: docs/scripts — backlog de PRDs via subdir + next.sh`

## Fora de escopo (fase 2+)

- **Priorização explícita** via `.order` ou prefixo numérico — só se precisar. Default lexicográfico funciona pra 90% dos casos.
- **Cron diário** rodando `next.sh` — você descartou, ok. Pode virar opção futura via skill `/schedule`.
- **GitHub PR automático** no closeout — você descartou, ok.
- **Multi-PRD paralelo** (`in-progress/` com 2+ ao mesmo tempo) — não bloqueado pelo design, mas requer Ralph adaptado pra não comitar em main simultâneo. Adicionar quando precisar.

## Por que não outras opções (rápido)

- **Frontmatter YAML status:** requer parser, filename estável mas status invisível no `ls`. Mais código, mesma função.
- **BACKLOG.md índice:** SSOT duplicado (markdown + arquivo). Se um divergir, qual ganha? Filesystem como SSOT evita o problema.

---

**Próxima ação sua:** confirmar destinos dos 3 PRDs ambíguos + decidir se executa agora ou parqueia.
