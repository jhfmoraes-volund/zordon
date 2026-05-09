# Decisões cumulativas — DS Inception Zelar

> Append-only. Toda decisão de calibração, padrão consciente ou aprendizado que **deve sobreviver entre sessões** vai aqui. Lido em todo `/zelar*` antes de processar.
>
> NÃO duplicar info que já está no runbook ou no banco. Aqui é só **decisão / contexto / lição**.

---

## 2026-05-09 — Setup inicial do método 2.0

**Contexto:** após gerar 47 tasks (T-001..T-047) de forma menos estruturada, identificamos invenções (tasks sem fonte clara no brainstorm) e features órfãs (cards sem task). Implementamos:

- Tabela `public."DesignSessionBrainstormFeature"` (espelho relacional do `data.solutions[]` via trigger).
- Schema `runbook.*` (anchor task→brainstorm, story coverage, funções de auditoria).
- Anchor retroativo das 47 tasks (33 `from_brainstorm`, 9 `infra_setup`, 5 `gap_fill`).
- 4 stories marcadas cobertas: US-007 (≡US-081), US-057, US-058, US-071.

**Regra dura:** toda task nova exige `runbook.attach_task_anchor` no mesmo bloco SQL. Sem anchor = invenção.

---

## 2026-05-09 — Calibração de granularidade

**Contexto:** T-036 (perfil + endereço Google Places + LGPD) ficou `large/high` = 21 FP em 1 task. Pelo prompt do Vitor "scope=large = 1-2 dias" — esse tamanho é o **teto absoluto**, não regra.

**Regra:** stories com 6+ AC envolvendo 2+ integrações externas (ex: Places + ViaCEP, Stripe + webhook, Unico + Realtime) **devem ser subdivididas em 3+ tasks**:

- 1 task por integração (`<AddressInput>` com Places, `<CEPFallback>` com ViaCEP).
- 1 task de form/UI puro (schema zod + render).
- 1 task de submit/persistência.

**Aplicação:** revisitar T-036 quando o time encostar; ou deixar como está e o dev quebra em PR.

---

## 2026-05-09 — Sobreposição cliente vs prestador (login)

**Contexto:** US-006 (login cliente, T-039) e US-081 (login prestador, T-042) compartilham só `T-032` (config providers Supabase Auth). UI separada porque:

- Branding diverge ("Zelar" vs "Zelar Prestador").
- Pós-login do prestador chama `getProviderRedirect()` que lê `provider_profiles.status`.
- Cliente vai pra `/home`; prestador vai pra 4 destinos diferentes.

**Lição:** quando cliente/prestador têm fluxos divergentes pós-auth, **não tente compartilhar UI**. Compartilhe apenas: providers config, helper `safeNext`, schemas zod de validação base (email/password).

---

## 2026-05-09 — Stories duplicadas no banco

**Contexto:** detectamos que **US-007 ≡ US-081** (mesmo título, mesma persona Carlos, AC quase idêntico — US-081 só tem 1 AC extra de credencial inválida).

**Hipótese:** PM criou stories iguais em momentos diferentes da DS. Vitor real (que não foi quem rodou aqui) provavelmente teria detectado e mergeado.

**Ação tomada:** US-007 marcada `runbook.story_coverage` apontando pras tasks de US-081.

**Lição:** ao auditar módulo, sempre rodar query 2.6 do runbook **comparando títulos por similaridade** — duplicatas no banco aparecem como stories irmãs com títulos quase idênticos.

---

## 2026-05-09 — Lacuna estrutural: middleware /provider/**

**Contexto:** middleware Next.js que protege rotas `/provider/**` não está em nenhum AC produto da US-081. Aparece **apenas no edge case do brainstorm card** (`Carlos tenta acessar rota com KYC não aprovado`).

**Ação:** T-047 criada com `source='gap_fill'`, `gapReason="middleware /provider/** mencionado no edge case do brainstorm, não em AC"`.

**Lição:** prompt do Vitor lembra de detectar "lacunas estruturais" (logout, refresh sessão, middleware de proteção). Sempre marcar como `gap_fill` com razão concreta — diferente de invenção.

---

## 2026-05-09 — Stack confirmado (não revisitar)

Reconfirmando o que está no `technical_specs` step:

- **Front:** Next.js 15 App Router + RSC + TS strict + Tailwind + shadcn/ui + Zustand + TanStack Query + next-pwa.
- **Back:** Supabase monolito (Postgres + Auth + Realtime + Storage + Edge Functions Deno + pg_cron + pg_trgm).
- **Pagamentos:** Mercado Pago marketplace split (homologação 7-15d).
- **KYC:** Unico (Web JS SDK + webhook).
- **E-mail:** Resend (templates Zelar + recibo via @react-pdf/renderer).
- **Address:** Google Places (preferência) + ViaCEP fallback. Debounce 300ms.

**Não criar tasks que assumam outra stack** sem evidência nova.

---

## 2026-05-09 — Padrão de slicing

Funcionou bem nos módulos AUTENTICACAO_ONBOARDING e LOGIN:

```
DB schema/RLS  →  Helper server-side  →  Front (UI)  →  Realtime/Edge (se aplicável)
```

Cada camada vira 1 task. `dependsOn = blocks` ligando topologicamente.

**Excepção:** se schema é trivial (alter add column), pode virar `micro/trivial`. Não fazer schema de cada coluna em task separada.

---

## 2026-05-09 — Hints do brainstorm vs Module.name

`DesignSessionBrainstormFeature.moduleHint` vem do **prefixo `[X]` do título do card**, não do `Module.name` canônico. Mapeamento aproximado para Zelar:

| Hint(s) brainstorm | Module.name |
|---|---|
| `LOGIN` | `LOGIN` |
| `CADASTRO`, `ONBOARDING` | `AUTENTICACAO_ONBOARDING` ou `ONBOARDING_DO_PRESTADOR` (depende do `[CLIENTE/PRESTADOR]`) |
| `ADMIN`, `BACKOFFICE`, `OPERAÇÃO`, `SUPORTE` (parte) | `ADMIN_OPERACAO` |
| `SERVIÇO` (maioria) | `EXECUCAO_DO_SERVICO` ou `CONCLUSAO_FINANCEIRO` (depende do contexto) |
| `NOTIFICAÇÃO` | `COMUNICACAO_NOTIFICACOES` |
| `PERFIL` | `PERFIL_CONFIGURACOES` |
| `FINANCEIRO` | `CONCLUSAO_FINANCEIRO` |
| `LGPD` | `SUPORTE_CONFIANCA` |
| `SUPORTE` | `SUPORTE_CONFIANCA` |
| `SISTEMA`, `OPERAÇÃO` | `MATCHING_ALOCACAO` (motores) ou `ANTI_BYPASS_ENGINE` |
| `HOME`, `SOLICITAÇÃO` | `CATALOGO_SOLICITACAO` |
| `AVALIAÇÃO` | `CONCLUSAO_FINANCEIRO` (avaliação pós-serviço) |
| `CONTA` | `ONBOARDING_DO_PRESTADOR` (reativação de conta suspensa) |
| `GROWTH`, `PRODUTO` | dispersos — analisar caso a caso |

**Regra:** ao auditar módulo, listar features de **TODOS os hints relacionados**, não apenas o nome direto.

---

## 2026-05-08 — Calibração: detectar sobreposição entre módulos antes de planejar

**Contexto:** US-010 (módulo ONBOARDING_DO_PRESTADOR) ficou ~80% coberta por T-044/T-045/T-046 (já criadas em US-081 do módulo LOGIN). Auditoria inicial do módulo não detectou — só percebi quando processei a story uma a uma e cruzei com tasks existentes.

**Regra:** ao iniciar processamento de qualquer story, antes de mapear AC → tasks, rodar query 2.4 (`runbook.story_coverage_report`) **+** query D (busca por keyword da story em ALL tasks da DS, não só do módulo). Sobreposição entre módulos AUTH↔LOGIN↔ONBOARDING é alta porque Carlos é a mesma persona em todas — task de "tela waiting" naturalmente vive em uma só, mesmo se múltiplas stories falam dela.

**Aplicação:** sinais de duplicata candidata para `runbook.story_coverage`:
- AC que descreve tela já criada em outra story (ex: "tela aguardando KYC" — T-044 existe).
- AC mecânico (Realtime, redirect, middleware) já implementado em outra story.
- Story tem 1-2 AC delta reais que se encaixam naturalmente em task de outra story do mesmo arco.

Quando detectar: marcar story como coberta + absorver AC delta na task vizinha (ex: AC-3 da US-010 entrou na task welcome+checklist da US-011, source = `from_brainstorm` no card original `4pnydyy`).

---

## 2026-05-08 — Padrão: helper compartilhado em gap_fill task isolada

**Contexto:** T-043 (`getProviderRedirect`) virou single source of truth de routing prestador, usado por 4+ rotas. US-011 precisou estender o helper com branch `/provider/welcome` — fiz como task isolada (T-061) com source=`gap_fill`.

**Regra:** quando task envolve mudança em helper compartilhado (criado em story anterior), criar task standalone com:
- source=`gap_fill` + gapReason explicando "X não tinha conceito Y, brainstorm Z explicita".
- DependsOn da task original do helper.
- Description detalhando QUAIS callers herdam a mudança automaticamente (não precisam de mudança).

Razão: facilita code review (1 patch isolado em 1 arquivo) e regression test (cobertura existente do helper estende, não regride).

<!-- Próximas decisões: append abaixo desta linha -->
