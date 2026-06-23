# HANDOFF — Finance: Contrato como SSOT (período · termos · receita)

> Você assume uma feature **em andamento** no app **Finanças** (admin-only, schema `finance`).
> Objetivo desta nota: contextualizar o estado, fixar um **Definition of Done verificável**,
> e listar com sinceridade as **dúvidas + opções** que precisam de decisão pra destravar.
> Leia inteiro antes de tocar código. Confie nos fatos abaixo, mas **confirme no DB/código** antes de editar.
> Última atualização: 2026-06-22.
> **▸ A camada billing(NF) + hub no canvas + agent-fill saiu pra [contract-billing-and-agent-fill-plan.md](contract-billing-and-agent-fill-plan.md)** (fonte VIVA dessa camada; re-sequenciada por valor pós-audit + 3 runbooks). Este doc = SSOT do épico período/termos/receita.

---

## 1. Objetivo final

Tornar o **contrato do projeto** (`finance.contract`) a **fonte única da verdade (SSOT)** de três coisas que hoje vivem duplicadas ou soltas:

1. **Período** — o "prazo do projeto" (`Project.startDate/endDate`) passa a ser **derivado** dos contratos (sync por trigger), não digitado em paralelo.
2. **Termos comerciais** — preço, mensalidade, condições especiais e **override por mês** moram no contrato (e **geram a receita**, não só documentam).
3. **Equipe e receita por período** — equipe alocada e reconhecimento de receita atribuem **por data**, dentro da vigência de cada contrato.

Tudo isso atendendo os **3 requisitos do dono** (ver §7) e **sem duplicação de dado** (princípio que o dono cravou: "evitar redundância e duplicadas").

---

## 2. Onde estamos (verificado em 2026-06-22)

| Item | Estado |
|---|---|
| Contrato **temporal** (N por projeto, vigência) | ✅ commitado (ZRD-JM-209) · migration `20260623d` aplicada |
| Contrato **gera receita squad** (mensalidade + override/mês) na DRE | ✅ commitado · `20260623e` aplicada |
| **Guard anti-overlap** no DB (btree_gist EXCLUDE) | ✅ commitado · `20260623g` aplicada |
| Contrato = **SSOT do período** (trigger sync `Project.dates` + backfill 9 sementes) | ✅ commitado (ZRD-JM-210) · `20260623h` aplicada · **0 deslocamento de prazo verificado** |
| Cronograma de blocos | 🔵 **unificado por outra sessão** num componente único `src/components/timeline/cronograma.tsx` — `finance-contracts.tsx` já renderiza `<Cronograma>` por contrato; `finance-sprint-timeline.tsx` **deletado de propósito**. **Fora desta lane.** |
| Requisito #1 (cronograma empilhado/dedicado) | ✅ entregue (e agora absorvido pela unificação) |
| Requisito #2 (valores/condições no contrato) | ✅ schema+UI; falta só o **backfill HITz** (na fila) |
| Requisito #3 (preço/FP inferido do valor global) | ✅ **Batch C completo** — dados (`20260623i`: `total_value_cents` + `price_per_fp_cents` GENERATED + 3 views) **+ UI** (`finance-contracts.tsx`: input "Valor global do contrato" + preço/FP derivado ao vivo; `tsc`/`eslint` limpos). **Falta só smoke em browser.** |
| HITz — montar contratos com dados reais das propostas | 🔵 **na fila** do dono ("tem outras coisas") |
| **Batches C → B → D** | ⬜ prontos, decididos, na ordem |

**Estado de dados (DB live):** 11 contratos (1 squad = HITz Contrato 2; 10 fixed_scope = HITz Contrato 1 + 9 sementes), **0 com valores** → o risco de double-count está **dormente** (nenhuma mensalidade/preço setado ainda).

---

## 3. Decisões fixadas

| # | Decisão | Por quê |
|---|---|---|
| **D1** | Contrato é **SSOT do período**; `Project.startDate/endDate` = projeção sincronizada (min start / max end; NULL end se há contrato aberto) | O prazo já era semanticamente "o contrato" (`isContract` em project-overview.ts:370 gera sprints daí). ~66 dependentes seguem lendo `Project.*` → zero quebra. |
| **D2** | Fronteira de contrato **autorada por sprint, guardada por data** | Mental model do dono é sprint; mas data unifica entries (date-stamped) + fp_delivery (month) sem FK cruzada Sprint→finance. |
| **D3** | Contrato **gera** a receita squad (mensalidade + override/mês), entries de Faturamento viram **one-off** | SSOT da receita recorrente; "lá falamos sobre os valores". |
| **D4** | **Sem vigências sobrepostas** por projeto (EXCLUDE no DB + validação app-level) | 1 contrato governa um período → `contractForDate`/receita não ambíguos. |
| **D5** | **Projeto sem contrato é estado válido** | 6 projetos hoje sem contrato (leads/explorando). Trigger só rege contratados. No Batch B o input de data some/trava **só quando há contrato**. |
| **D6** | **fixed_scope = receita delivery-based** (`fp_delivery × preço/FP`) | Modelo PF auditável da Volund ("receita por PF entregue"). Sem rateio linear. |
| **D7** | **Preço/FP DERIVADO** de `valor_global ÷ FP_contratado`; o campo aberto é o **valor global** | Requisito #3 do dono. Single source → coluna GENERATED, sem drift. |
| **D8** | Período do contrato **legível por quem vê o projeto**; **valores** (mensalidade/preço/total) **só admin** | Requisito do dono (contratos no tab do projeto) + finance é dado sensível. |

---

## 4. Modelo de dados & SSOT

```
              finance.contract  ──►  SSOT: período + termos comerciais
              (effective_from/to · billing_type · monthly_fee_cents/override
               · [Batch C] total_value_cents → price_per_fp_cents GENERATED)
                     │
   trigger sync ┌────┴─────┐  (todo o resto atribui POR DATA — não re-armazena período)
                ▼          ▼              ▼                    ▼
   Project.startDate/   Sprint        labor_allocation     fp_delivery
   endDate              (blocos        (equipe; [Batch D]   (encomenda;
   (projeção;            por data)     escopada ao período  receita por
    66 deps leem)                       do contrato)         entrega × preço)
```

**Componentes reais:**
- **Trigger** `finance.sync_project_dates_from_contracts()` (SECURITY DEFINER — `Project` tem RLS): on insert/update/delete de `finance.contract`, recomputa `Project.startDate/endDate`. **Semântica: delete do último contrato PRESERVA as datas** (guard `exists(...)`).
- **Views** (security_invoker): `v_contract_revenue_month` (squad: override do mês senão mensalidade × meses); `v_fp_delivery_month` (encomenda: lateral pega preço/FP do contrato cuja vigência contém o mês); `v_project_month`/`v_org_month` (receita = entries + fp + contrato, via spine UNION).
- **Override por mês**: `finance.contract_month_override` (contract_id, month, amount_cents; UNIQUE(contract,month)).
- **Helpers**: `contract-bands.ts#contractForDate/paletteFor`; `can_view_project`/`can_edit_project` (Postgres) — úteis pro Batch B.

**Migrations aplicadas (todas via psql):** `20260622a-e` (schema/category/entry/labor/views), `20260623a` (views v2), `20260623b` (assumptions), `20260623c` (fp billing), `20260623d` (contrato temporal), `20260623e` (contrato gera receita + override), `20260623g` (anti-overlap), `20260623h` (período SSOT + backfill). **Não existe `20260623f`** (era a conversão HITz que colidiu — revertida e deletada).

---

## 5. Riscos & gotchas (auditoria multi-agente, 32/33 confirmados)

1. **Double-count de receita (estrutural):** `v_project_month` soma `entries + fp + contrato` sem dedup. Vira real no instante em que se setar `monthly_fee` num contrato squad de um projeto que ainda tem entry recorrente (caso HITz). Hoje **dormente** (0 contratos com valor). **Mitigação prevista:** view de auditoria multi-fonte + o backfill HITz feito como **transação atômica única** (delete entry → set fee → COMMIT), nunca 3 chamadas de DAL.
2. **DAL commita sozinho:** cada `create/update/deleteContract` é uma transação isolada — 3 chamadas de UI abrem janela de inconsistência. Operações que precisam ser atômicas (ex.: HITz) vão como **um script SQL**, não via DAL.
3. **`finance-contracts.tsx` é arquivo disputado:** a sessão de cronograma o reescreveu (usa `<Cronograma>`). Qualquer edição de UI do Batch C aqui precisa **confirmar que a sessão de cronograma terminou** (já levamos uma colisão real com os contratos do HITz).
4. **`SECURITY DEFINER` ignora RLS por design:** o trigger e (no Batch B) a view de período precisam de gate explícito testado — senão vaza dado.
5. **Erro cru da EXCLUDE constraint** vaza em inglês no toast (TOCTOU entre `validateContract` e o INSERT). Traduzir no catch.
6. **`createFpDelivery` insere `month` cru** → estoura o CHECK `first_day` se o dia ≠ 1. Normalizar (`slice(0,7)-01`), padrão do `upsertContractOverride`.
7. **Finance ausente de `database.types.ts`** — por design (gerador só cobre `public`; finance é hand-authored em `src/lib/finance/types.ts`). Manter os dois em sync manual é a convenção; **não** é drift, mas é frágil.

---

## 6. Trabalho restante — Batches

### Batch C — Preço/FP invertido (requisito #3) · ✅ **COMPLETO** (dados + UI)
- **Dados:** `20260623i` — `total_value_cents` (campo aberto) + `price_per_fp_cents` GENERATED (valor÷FP) + 3 views recriadas (receita inalterada, derivação provada). DAL (`toContractRow` sem price, +total_value) + `types.ts` ajustados.
- **UI:** `finance-contracts.tsx` — form encomenda com **"Valor global do contrato"** + preço/FP derivado ao vivo (`tsc`/`eslint` limpos). **Falta só smoke em browser.**

### Batch B — RLS-split + contratos no tab do projeto · **decidido (D5/D8), mas tem dúvida aberta (ver §8)**
- **Migration:** `finance.v_contract_period` expondo só `project_id/label/seq/effective_from/effective_to/billing_type` com gate `can_view_project(project_id) OR is_admin()`; valores ficam na tabela admin-only.
- **UI:** seção de contratos no **tab do projeto** (período pra quem vê; valores gated a admin). No `project-edit-sheet`, **esconder/travar o input de data SÓ quando há contrato** (D5) — no create e no edit.
- **Risco:** alto (segurança). Testar guest/sem-acesso explicitamente.

### Batch D — Equipe por contrato · **decidido (reuso), com 1 sub-decisão**
- Reusar `finance.labor_allocation` escopada ao período do contrato; componente pré-preenche vigência = datas do contrato.
- **Sub-decisão RESOLVIDA (2026-06-22) → SIM:** FK `contract_id` nullable em `labor_allocation` (a alocação pertence ao contrato; editável no sheet do contrato). Owner: **RB1 Fase 1.3** do [billing plan](contract-billing-and-agent-fill-plan.md).
- Enforcement `Σ% ≤ 100` por (membro, período) no DAL (espelha `validateContract`).

### Fila — HITz (backfill exato, **só HITz**)
- **Proposta 1** (Squad as a Service = Contrato B): mensalidade **R$ 86.366,41** + cláusula 3º mês **R$ 72.640,92** (= override) + builder adicional +R$ 24.632,87.
- **Proposta 2** (Operação Especial/Gulf = Contrato A, encomenda): **NÃO LIDA** — ler ao retomar.
- **Execução:** UM script SQL transacional (delete entry recorrente `6b8cac38` → set valores nos 2 contratos existentes → COMMIT). O trigger ressincroniza o prazo (move início ~4 dias — **confirmar com o dono**, é mudança observável).

### Hardening (após o crítico)
- correctness: `createFpDelivery` month-normalize · traduzir erro 23P01 · `<Input type=month>`.
- UX: estado `refetching` (loading no re-fetch de escopo da DRE) · erro de fetch visível (toast) nos 3 GETs · fix double-fetch no delete do contrato selecionado.
- view de auditoria de receita multi-fonte (gate estrutural anti-double-count).

---

## 7. Definition of Done

### DoD do épico (o "disso aqui")
O épico **"Contrato como SSOT"** está **done** quando:

- [ ] **Os 3 requisitos do dono** entregues **e verificados em browser** (não só tsc):
  - [ ] #1 cronograma (✅ — absorvido pela unificação; validar que segue funcionando pós-merge).
  - [ ] #2 contrato carrega valores/condições + override por mês, e **gera a receita** na DRE.
  - [ ] #3 campo aberto = valor global; preço/FP derivado; encomenda reconhece receita por entrega.
- [ ] **Sem duplicação:** período só no contrato (Project.dates derivado); equipe reusa `labor_allocation`; nenhuma data/valor digitado em dois lugares.
- [ ] **Double-count impossível na prática:** view de auditoria existe + (HITz) entry recorrente removido quando o contrato assume a receita.
- [ ] **RLS correta:** período legível por quem vê o projeto; valores só admin; **guest testado e barrado**.
- [ ] **repo ↔ DB ↔ types em sync:** toda migration aplicada está commitada; `src/lib/finance/types.ts` reflete o schema; `tsc`/`eslint` limpos nos 2.
- [ ] **Sem regressão de prazo:** mudanças no contrato refletem em `Project.dates` via trigger; os ~66 dependentes seguem corretos.
- [ ] **HITz** montado com dados reais das 2 propostas **OU** explicitamente declarado fora do escopo do épico.

### DoD por batch (critérios verificáveis)
- **Batch C done:** `total_value_cents` editável; `price_per_fp_cents` gerada e correta (`SELECT` prova `valor/FP`); 3 views recriadas e receita do HITz idêntica ao baseline (dry-run); form encomenda usa valor global; `tsc`/`eslint` limpos; smoke em browser.
- **Batch B done:** view de período retorna linhas pra um usuário não-admin com acesso ao projeto **e zero pra guest** (provado via psql com `set role`/JWT); valores nunca retornam fora de admin; input de data do projeto some só com contrato; seção de contratos visível no tab.
- **Batch D done:** equipe escopa ao contrato selecionado; `Σ% ≤ 100` validado; (se houver FK) migration aplicada+commitada.
- **HITz done:** `v_project_month` do HITz bate centavo-a-centavo com as propostas; só 1 fonte de receita por mês (view de auditoria vazia pro HITz); prazo ressincronizado e confirmado.

---

## 8. Dúvidas honestas & opções pra destravar

> Aqui é onde preciso de você. Sou sincero: tem pontos que **não devo decidir sozinho**.

**✅ Respondido pelo dono (2026-06-22):** **Q1 = (a)** escopo do DoD é o épico contrato-SSOT (C/B/D + HITz). **Q2 = (a)** próximo passo = Batch C **camada de dados** agora (sem tocar `finance-contracts.tsx`); UI do form depois que a sessão de cronograma fechar. **Q5 = (a)** nível de teste = smoke manual em browser por batch + tsc/eslint + provas SQL. **Q3 (Batch B edição de período)** e **Q4 (HITz/Proposta 2)** ficam pra decidir quando chegar a vez.

**Q1 — Qual o ESCOPO do DoD ("disso aqui")?**
Minha leitura: o épico **Contrato-como-SSOT + os 3 requisitos** (C/B/D + HITz). Mas pode ser maior.
- **(a)** Épico contrato-SSOT (C/B/D + HITz) — *minha hipótese*.
- **(b)** Finance app inteiro "production-ready" (inclui calculadora de preço, DRE org-level, CRUD de categoria, testes) — escopo bem maior.
- **(c)** Só fechar o que está em voo + estabilizar (sem C/B/D agora).

**Q2 — Coordenação do `finance-contracts.tsx` (arquivo disputado).**
A sessão de cronograma já o reescreveu (usa `<Cronograma>`). O Batch C precisa editar o form de encomenda aí.
- **(a)** Eu faço **só a camada de dados do C** agora (migration + dal + types — não toca o arquivo) e a **UI depois** que você confirmar que a sessão de cronograma fechou. *(recomendo — destrava sem colidir)*
- **(b)** Eu assumo o arquivo agora e coordeno na unha (risco de colisão).
- **(c)** Espero a sessão de cronograma 100% e faço o C inteiro depois.

**Q3 — Batch B é o ponto tecnicamente mais incerto. Onde se EDITA o período?**
Postgres não tem RLS por coluna; a view resolve a LEITURA. Mas a **escrita** do período (= editar o contrato) é admin-only hoje. Quem ajusta prazo?
- **(a)** Período editável só por **admin** via app Finanças; PM/manager só leem no tab do projeto. *(mais simples; muda quem hoje edita prazo)*
- **(b)** Liberar **edição de período** (não os valores) pra **manager** — exige split de escrita por coluna/policy (mais trabalho).
- **(c)** Decidir isso só quando chegar no Batch B (não bloqueia C/D).

**Q4 — HITz: a Proposta 2 (Contrato A/encomenda) não foi lida.**
- **(a)** Leio a Proposta 2 agora e deixo o script HITz 100% pronto na fila.
- **(b)** Você me passa os valores do Contrato A quando quiser montar.
- **(c)** HITz fica **fora do DoD do épico** (vira tarefa separada).

**Q5 — Nível de "testado" pro DoD.**
Nada foi verificado em browser ainda.
- **(a)** Smoke manual em browser por batch (eu rodo o app e valido). *(recomendo)*
- **(b)** + script de verificação reproduzível (ex.: `scripts/` que valida as views/DRE).
- **(c)** Só `tsc`/`eslint` + provas SQL (como temos feito) — sem browser.

---

## 9. Referências
- **Plano original:** [finance-app-plan.md](finance-app-plan.md) · [pricing-pnl-model.md](pricing-pnl-model.md)
- **Cronograma (lane vizinha):** [docs/platform/cronograma-unification-plan.md](../../platform/cronograma-unification-plan.md)
- **Propostas HITz:** `.assets/Proposta Hitz. final.pdf` (lida) · `.assets/Proposta_Volund_OperacaoEspecial_Hitz_Gulf 2 (1).pdf` (NÃO lida)
- **Código:** `src/lib/finance/{types,dal}.ts` · `src/components/apps/finance/*` · `src/app/api/finance/*`
- **Migrations:** `supabase/migrations/20260623{d,e,g,h,i,j,k}_*.sql` (i=preço/FP GENERATED · j/k=backfill HITz + fix FP fixed_scope)
- **Memória:** `project_finance_app` (estado vivo + fila HITz + decisões)
