# APF Estimator V3 — Pipeline em duas fases (catálogo + tabela)

> Versão derivada do [V2](../../archive/apf-estimator-plan-v2.md). **V2 não está descontinuado** — V3 adiciona uma fase humana-legível antes da estimativa em PF, em vez de ir direto código → PF.
>
> Status: **proposto, ainda não executado.** Decidido em 2026-05-04.

---

## Por que V3 existe

V2 vai direto de **código** → **inventário AST** → **classificação IFPUG** → **PF total**. Funciona, mas tem dois problemas pra um piloto sem ground-truth:

1. O usuário (não-engenheiro) não consegue revisar o resultado — só vê números no relatório final.
2. Erros do estimador (falsos positivos, dedupe excessivo) só aparecem no agregado, sem âncora pra discussão.

V3 quebra em duas fases auditáveis:

```
┌─────────────────────────┐    ┌─────────────────────────┐
│ FASE A — CATÁLOGO       │ ►  │ FASE B — TABELA PF      │
│ Funcionalidades em      │    │ Lookup determinístico   │
│ linguagem de produto    │    │ + LLM tie-breaker       │
│ (~30-60 ações)          │    │ pra ambíguos            │
└─────────────────────────┘    └─────────────────────────┘
   revisão humana fácil          baseado na base referencial
```

**Diferença essencial vs V2:** V2 produz funções IFPUG diretamente do código. V3 produz primeiro uma lista de **ações do usuário** legível, e só depois mapeia cada ação pra PF.

---

## Decisões fundadoras (2026-05-04)

| # | Pergunta | Decisão |
|---|---|---|
| D1 | Granularidade do catálogo | **Por ação do usuário** (ex.: "listar OSs migráveis", "exportar calendário em XLSX"). ~30-60 itens. Bate quase 1:1 com função IFPUG. |
| D2 | Determinismo da Fase B | **Tabela + LLM tie-breaker**: lookup acerta ~80%, LLM resolve os ~20% ambíguos. Mesma postura do V2 (não é "puro determinismo", é "auditável e reprodutível com cache"). |
| D3 | Quem escreve o catálogo | **Claude lê o repo e escreve, João revisa.** Não é redação humana from-scratch nem pipeline 100% automatizado. |
| D4 | Repo-alvo do piloto V3 | **SEPLAG-CE** (`github.com/volund-ia/SEPLAG-CE`). Acesso confirmado. 41 migrations, 3 edge functions, ~96 .tsx, file-system routing em `src/pages/`. |

---

## Fase A — Catálogo de Funcionalidades

### Entrada
- Repo Vite+React+TS+Supabase clonado (ex.: `/tmp/seplag-ce`).

### Saída
- `docs/apf-estimator/catalogo-funcionalidades/<projeto>.md` — markdown legível, uma seção por área funcional (ex.: "Ordens de Serviço", "Apontamentos", "Migração HH→PF", "Dashboards"), com lista de ações dentro de cada.

### Formato de cada item

```markdown
### A12. Listar OSs migráveis (HH→PF)

**Tipo provável:** CE
**Rotas:** `src/pages/migracao/index.tsx`
**Tabelas envolvidas:** `os`, `os_item` (leitura)
**Disparo do usuário:** entra na tela "Migração HH→PF"
**O que mostra/faz:** lista paginada de OSs em status `aberta` que têm itens convertíveis de HH pra PF. Filtros por gerência e período.
**Sinais técnicos:**
- Query: `supabase.from('os').select('...').eq('status', 'aberta').filter(...)`
- Componente: `<MigracaoListPage>`
**Análogo na base referencial:** `Listar_OSs_Migraveis_HHPF` (Riple M6) → CE Alta 6 PF
**Observações:** —
**needs_review:** false
```

### Como Claude monta (protocolo)

1. **Mapeia rotas.** Lê `src/pages/**` (file-system) ou `createBrowserRouter`. Cada rota = candidato a 1+ ações.
2. **Pra cada rota, lista interações.**
   - Queries de leitura sem agregação → 1 ação CE ("listar/detalhar X").
   - Queries com agregação ou dashboards → 1 ação SE.
   - Botões/forms que disparam mutation → 1 ação EE por verbo único.
   - Ações de exportação (XLSX/PDF/CSV) → 1 ação SE separada.
3. **Cruza com `supabase/migrations/`** pra descobrir tabelas (ALI candidatas) e funções SQL (RPCs).
4. **Cruza com `supabase/functions/`** pra edge functions (EE/SE candidatas).
5. **Identifica fontes externas** (`fetch` não-Supabase) → AIE candidatas.
6. **Aplica regra anti-double-count do V2 §2.3:** quando o mesmo write tem RPC + edge + cliente direto, conta na camada mais próxima do banco.

### Critério de qualidade da Fase A

- **Cobertura:** todas rotas de `src/pages/**` aparecem ou em pelo menos 1 ação ou explicitamente como "página estática (PAG)".
- **Granularidade:** uma ação não pode misturar verbos (criar+listar = 2 ações; filtrar lista = ainda é 1 ação).
- **Ancoragem:** todo item tem `Rotas:` ou `Tabelas envolvidas:` ou `Sinais técnicos:` preenchido.
- **Análogo apontado:** se há análogo claro na base referencial, citar; se não há, marcar `needs_review: true` com justificativa.

### O que João revisa

- Ação faz sentido como "coisa que o usuário faz" ou é artefato técnico que não devia contar?
- Tipo provável (CE/SE/EE/AIE/ALI) parece certo?
- Análogo apontado na biblioteca é razoável?
- Faltou alguma ação óbvia?

A revisão é em markdown direto — comentários inline (`<!-- João: isso é PAG, não CE -->`) ou edição direta. Sem ferramenta especial.

---

## Fase B — Tabela de PF

> **Importante:** V3 v0 é 100% manual/conversacional + markdown. **Não há código.** Claude faz lookup mental na base referencial (que está como .md/.json simples na pasta `referencial/`), aplica matriz IFPUG, e produz a tabela. Se em algum piloto futuro fizer sentido automatizar, vira V4.

### Entrada
- `catalogo-funcionalidades/<projeto>.md` revisado por João.
- `referencial/base-referencial.md` (medições oficiais históricas viradas markdown legível — uma linha por função-âncora).
- [function-points-reference.md](./function-points-reference.md) (matriz IFPUG de complexidade).

### Saídas

1. `tabela-pf/<projeto>.md` — tabela markdown com totais e justificativas.
2. `tabela-pf/<projeto>.xlsx` — planilha gerada pontualmente quando a tabela .md está fechada. Colunas reduzidas pra entrega: **#**, **Funcionalidade**, **Descrição**, **Tipo IFPUG**, **PF**, **Análogo**, **Observação**, com soma no rodapé.

### Formato da tabela markdown (interna, com mais colunas pra auditoria)

```markdown
| # | Funcionalidade | Descrição (1 linha) | Tipo | DET | AR/TR | Complexidade | PF | Análogo | PF Análogo | Δ | Observação |
|---|---------------|---------------------|------|-----|-------|--------------|----|--------------|-----------|---|------------|
| A12 | Listar OSs migráveis | Lista OSs em status aberta com itens HH→PF, filtros por gerência | CE | 12 | 5 | Alta | 6 | Listar_OSs_Migraveis_HHPF (Riple M6) | 6 | 0 | match direto |
| A13 | Exportar calendário XLSX | Gera planilha de apontamentos por fornecedor | SE | 12 | 5 | Alta | 7 | Exportar_Calendario_Excel_Forn (Riple M6) | 7 | 0 | match direto |
| A27 | Bulk-importar contratos | Upload de planilha + parse + insert em lote | EE | 18 | 4 | Alta | 6 | (sem análogo direto) | — | — | tie-breaker: matriz IFPUG → EE Alta |
...

**Totais**
- PF IFPUG: ___
- Faixa esperada do plano V2 §8.1 (SEPLAG-CE): 150-300 PF
- Caímos dentro? sim/não
```

### Formato da planilha .xlsx (entrega final, simplificada)

| # | Funcionalidade | Descrição | Tipo IFPUG | PF | Análogo | Observação |
|---|----------------|-----------|------------|-----|---------------|------------|
| A12 | Listar OSs migráveis | Lista OSs em status aberta com itens HH→PF | CE | 6 | Listar_OSs_Migraveis_HHPF (Riple M6) | match direto |
| ... | | | | | | |
| | **TOTAL** | | | **=SUM(E2:En)** | | |

A planilha é gerada **ad-hoc** com `python -c openpyxl` numa única chamada de Bash quando a tabela .md está fechada — não é pipeline.

### Como Claude atribui PF na Fase B (protocolo)

Pra cada funcionalidade do catálogo:

1. **Lê `referencial/base-referencial.md`** procurando análogos por verbo + tipo + entidade. Top-3 candidatos.
2. **Se há análogo direto** (mesmo verbo, mesmo tipo, complexidade comparável) → copia PF do análogo. Coluna "Análogo" preenchida, "Observação" = "match direto".
3. **Se não há análogo claro** → estima DET (campos do payload/resposta) e AR/TR (tabelas/arquivos referenciados) a partir do catálogo e dos sinais técnicos, aplica [matriz IFPUG](./function-points-reference.md). Coluna "Observação" = "tie-breaker: matriz IFPUG → tipo complexidade".
4. **Se ambíguo entre 2 tipos** (ex.: SE vs CE) → registra a hipótese mais conservadora e marca `needs_review`.

Não é "determinístico no sentido programático". É **auditável**: cada PF na tabela tem coluna que diz de onde veio (análogo X ou matriz IFPUG).

---

## Critério de sucesso do piloto V3

### S1 — Catálogo (revisão humana, qualitativo)
- João lê catálogo do SEPLAG-CE e diz "isso é o que o sistema faz".
- ≤10% das ações marcadas como "deveria ser dividida/agrupada" na revisão.
- Cobertura de rotas: 100%.

### S2 — Tabela PF (semi-objetivo)
- ≥80% das ações têm análogo direto na biblioteca (lookup puro, sem LLM).
- Total PF cai na faixa **150-300 PF** prevista pelo plano V2 §8.1.
- Funções `needs_review` ≤15% do total.

### S3 — Auditabilidade
- Toda linha da tabela PF cita: análogo da base referencial OU regra da matriz IFPUG aplicada.
- João consegue contestar qualquer PF lendo só a linha (sem precisar abrir código).
- Planilha .xlsx gerada bate exatamente com a tabela .md (mesma soma).

---

## Roadmap V3 (zero código)

### Marco 0 — preparo (1 sessão)
- [ ] Clonar SEPLAG-CE em `/tmp/seplag-ce`.
- [ ] Extrair medições oficiais históricas pra `referencial/base-referencial.md` (markdown legível, uma linha por função-âncora).
- [x] Confirmar D1-D4 (este documento).

### Marco 1 — Fase A: catálogo (Claude, 1 sessão)
- [ ] Claude varre repo SEPLAG-CE (`src/pages/`, `supabase/migrations/`, `supabase/functions/`).
- [ ] Produz `catalogo-funcionalidades/seplag-ce.md` v0.
- [ ] João revisa (comentários inline ou edição direta).

### Marco 2 — Fase B: tabela PF (Claude, 1 sessão)
- [ ] Claude lê catálogo revisado + `base-referencial.md` + matriz IFPUG.
- [ ] Produz `tabela-pf/seplag-ce.md` (tabela com justificativas).
- [ ] Gera `tabela-pf/seplag-ce.xlsx` ad-hoc via openpyxl (Bash one-shot).

### Marco 3 — Revisão final
- [ ] Verifica total na faixa 150-300 PF do plano V2 §8.1.
- [ ] João revisa tabela e contesta PFs duvidosos.
- [ ] Itera ajustando linhas específicas até fechar.

### O que NÃO faz parte do V3 v0
- **Qualquer código** (`scripts/apf/`, TypeScript, Python além do one-shot da planilha).
- Cache programático, versionamento de prompt, infra de re-execução.
- Manutenção SISP via diff (V2 §3.6) — V3 estima `HEAD` inteiro como `I`.
- Integração com `/admin/apf` no Volund.
- Geração XLSX no formato Prodesp oficial (formato simplificado é suficiente).
- Calibração contra medição oficial (não há).

Se o piloto V3 v0 funcionar e o processo precisar repetir em N projetos, aí sim faz sentido automatizar — vira V4.

### Provider LLM (quando virar V4)

Volund já usa **OpenRouter + AI SDK** ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts)), modelo default `anthropic/claude-sonnet-4.6` com `usage: { include: true }` pra tracking de custo. V4 deve herdar esse padrão — mesma `OPENROUTER_API_KEY`, mesma observabilidade, mesmo `getModel()`. Não introduzir Anthropic SDK direto.

---

## Diferenças V2 → V3

| Tópico | V2 | V3 v0 |
|---|---|---|
| Fluxo | Código → AST → classify → PF | Código → **catálogo legível** → tabela → PF |
| Saída intermediária | JSON de inventário/classificação | **Markdown de funcionalidades** revisável por humano |
| Granularidade base | Função IFPUG direto do código | **Ação do usuário** explícita |
| Base referencial | Few-shot rotulado fixo | Resumo .md consultado por Claude Code |
| Determinismo | LLM em identity + classify | **Lookup mental** + matriz IFPUG, ambos auditáveis na tabela |
| Revisão humana | No total final | **No catálogo** (cedo, antes do PF) |
| Esforço de código | ~2 semanas (Fase 1 V2) | **0 — só markdown + xlsx one-shot** |
| Saída final | Relatório markdown | Tabela .md + planilha .xlsx (Funcionalidade, Descrição, PF, Análogo) |

V3 não joga fora V2 — usa as regras de inventário/anti-double-count do V2, só inverte a ordem de revisão humana e adiciona o catálogo como artefato auditável.

---

## Riscos específicos do V3

| Risco | Mitigação |
|---|---|
| Catálogo de Claude omite ações implícitas (ex.: validações, permissões) | João revisa marcando faltas; segunda passada de Claude com gaps apontados |
| Análogos da base referencial são todos do mesmo nicho (gestão/administrativo Prodesp) — pode não ter análogo pra função técnica diferente | LLM tie-breaker com matriz IFPUG cobre o gap; `needs_review` flag |
| João revisa rápido demais e aprova catálogo errado | Critério S1 explícito: cobertura 100%, ≤10% reagrupamento |
| Total fora da faixa 150-300 PF | Investigar antes de aceitar — bug de catálogo (faltou área) ou bug de lookup (tipo errado) |
