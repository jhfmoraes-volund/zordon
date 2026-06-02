# PRD — SIAL Identidade e Acesso (IAM)

**Reference**: SIAL-IAM
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP) — repo do cliente, não Volund
**Depende de**: `prd-sial-core-process` (Processo/Evento existem; FKs serão adicionadas aqui)

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: login externo só via gov.br + assinatura gratuita (doc §5), SSO interno separado (doc §9), perfis resolvedor/administrador e setores/PRORESP (doc §3.3), visualizações por perfil (RF09), `usuario`/`perfil`/`usuario_perfil` (modelagem §3), nível de conta gov.br condiciona assinatura (doc §5).
- **[decisão-sessão]**: Supabase Auth como broker, RLS por perfil, backoffice app único (resolve gap G1).
- **[inferência]**: helper functions `sial_*`, policies específicas, wizard de onboarding de 2 passos, multi-CNPJ N:N, paths de API. Schema concreto = proposta a validar.

## Demo/Mock (one-shot)

> Na demo, o **dev-auth** do `prd-sial-app-shell` (troca de persona) **substitui gov.br/SSO** — o login real vira Track B atrás do mesmo `getSession()`. As tabelas `Usuario`/`Perfil`/`UsuarioPerfil`, FKs e RLS são reais e rodam em Supabase; o que é mock é só o provedor de identidade. Smoke por `scripts/smoke/identity-access.ts` (isolamento RLS entre 2 personas via SQL, sem browser).

## §1 Problema

1. O acesso externo hoje exige **presença física** na Junta; não há identidade digital unificada para o cidadão e a empresa (doc §5).
2. Os usuários **internos** (resolvedores, administradores, setores) precisam de autenticação **separada do gov.br**, com perfis e visualizações por função (RF09, doc §3.3, §4).
3. Sem RBAC/RLS, **todo servidor enxergaria tudo** — viola RF09 e a LGPD num sistema com CPF/CNPJ (doc §8).
4. O gov.br entrega **identidade mínima** (CPF, nome); falta o vínculo com a pessoa jurídica e o papel (empresa/leiloeiro/tradutor) para mostrar o fluxo certo.

## §2 Solução em uma frase

Implementa identidade e acesso do SIAL — login **gov.br** (externo), **SSO interno** JUCESP, **onboarding** do usuário externo e **RBAC** (Usuario/Perfil) com **RLS por perfil**, completando as FKs do núcleo de Processo.

## §3 Não-objetivos

- **Assinatura digital** (gov.br como assinatura, certificado A1/A3) — fica em `prd-sial-assinatura`, embora compartilhe o token de identidade.
- **Métodos/parametrização** — `prd-sial-parametrizacao`.
- **Áreas/setores** (tabela `Area`) — criada em `prd-sial-tramitacao` (a tramitação é quem precisa).
- Telas de negócio (requerimento, análise) — PRDs de superfície.
- Cadastro **alternativo sem gov.br** — Fase 2 (ver §14).

## §4 Personas e jornada

- **Requerente (empresa/leiloeiro/tradutor)**: "Quero entrar com a minha conta gov.br e cair no portal já reconhecido, sem criar mais uma senha."
- **Resolvedor**: "Quero entrar com a credencial da Junta e ver só a minha fila e o meu método."
- **Administrador**: "Quero conceder e revogar perfis e garantir que ninguém veja o que não deve."
- **Encarregado LGPD**: "Quero que o isolamento de dados por perfil seja imposto pelo banco, não só pela aplicação."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | **Supabase Auth como broker**; gov.br via provider **OIDC**; SSO interno via **SAML/OIDC corporativo** | Reusa sessão/JWT do Supabase; os dois provedores externos entram como identidade federada. |
| D2 | **Dois domínios de identidade separados** (`Usuario.tipo` ∈ `externo`/`interno`); guards distintos | Cidadão (gov.br) e servidor (SSO interno) nunca se misturam (doc §5, §9). |
| D3 | `Usuario`, `Perfil`, `UsuarioPerfil` (N-N) — perfis `resolvedor`/`administrador`/`setor` | Modelagem §3 (pessoas e acesso). RF09 exige perfis. |
| D4 | **RLS por perfil via helper functions** Postgres (`sial_is_servidor()`, `sial_has_perfil()`, `sial_can_access_processo()`) | Espelha o padrão do Volund (helpers SQL + checagem na app). Defesa em profundidade. |
| D5 | **Backoffice = app único com motor de perfis/métodos** (resolve gap G1) | RF09 aponta forte para app único; mais barato e coerente com o conceito de Método (doc §4). |
| D6 | Onboarding **server-driven** (wizard); vínculo de CNPJ valida na Receita (integração stub aqui, real em `prd-sial-integracao-receita`) | gov.br não dá o vínculo PJ; precisa coletar e validar. |
| D7 | Guarda o **nível da conta gov.br** (`Usuario.nivelGovbr` ∈ bronze/prata/ouro) | Condiciona quem pode assinar (usado por `prd-sial-assinatura`). |
| D8 | **Completa as FKs do núcleo**: `Processo.requerenteId → Usuario`, `Evento.usuarioId → Usuario` via ALTER | Fecha o que `prd-sial-core-process` deixou como uuid solto (D7 de lá). |
| D9 | RLS policies finas em `Processo`/`Evento`/`Metodo` entram **aqui** | Core habilitou RLS sem policy; agora as regras por perfil ganham forma. |
| D10 | MVP **exige gov.br** para externo; cadastro alternativo é Fase 2 | Reduz escopo; cobre a maioria. Marcado em §14 (gap G3). |

## §6 Arquitetura

```
 EXTERNO                                INTERNO
 ┌──────────────┐                       ┌──────────────────┐
 │ Cidadão/Empresa│                     │ Servidor JUCESP   │
 └──────┬───────┘                       └────────┬─────────┘
        │ Entrar com gov.br                       │ SSO interno (SAML/OIDC)
        ▼                                         ▼
 ┌───────────────────────────── Supabase Auth (broker) ─────────────────────────┐
 │  callback → upsert Usuario(tipo=externo|interno, govBrId/ssoId, nivelGovbr)   │
 └───────────────┬──────────────────────────────────────────┬───────────────────┘
                 │ externo: cadastro novo?                    │ interno
                 ▼ sim → wizard onboarding                    ▼
        ┌────────────────────┐                     resolve UsuarioPerfil
        │ coleta CNPJ, papel │                     → entrega backoffice
        │ valida na Receita  │                       (app único, RF09)
        └─────────┬──────────┘
                  ▼
        Usuario ──N:N── Perfil   (UsuarioPerfil)
                  │
                  ▼  RLS helpers
   sial_is_servidor() · sial_has_perfil(p) · sial_can_access_processo(proc)
                  │
                  ▼  policies
   Processo/Evento: requerente vê o próprio; servidor vê por perfil/método
```

## §7 Schema

```sql
-- 1) <data>_sial_usuario.sql
CREATE TABLE "Usuario" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('externo','interno')),
  "authUserId" uuid UNIQUE,                 -- referência ao auth.users do Supabase
  "govBrId" text UNIQUE,                     -- sub do gov.br (externo)
  "ssoId" text UNIQUE,                       -- id no diretório interno
  "nivelGovbr" text CHECK ("nivelGovbr" IN ('bronze','prata','ouro')),
  nome text NOT NULL,
  documento text,                            -- CPF/CNPJ
  ativo boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Usuario_tipo_idx" ON "Usuario" (tipo);
ALTER TABLE "Usuario" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 2) <data>_sial_perfil.sql
CREATE TABLE "Perfil" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,                 -- 'resolvedor','administrador','setor'
  descricao text
);
ALTER TABLE "Perfil" ENABLE ROW LEVEL SECURITY;

INSERT INTO "Perfil" (nome, descricao) VALUES
  ('administrador','Gestão da plataforma, usuários e parametrização'),
  ('resolvedor','Analisa protocolos, defere, exige, tramita'),
  ('setor','Recebe trâmites de outras áreas');
```

```sql
-- 3) <data>_sial_usuario_perfil.sql
CREATE TABLE "UsuarioPerfil" (
  "usuarioId" uuid NOT NULL REFERENCES "Usuario"(id) ON DELETE CASCADE,
  "perfilId"  uuid NOT NULL REFERENCES "Perfil"(id) ON DELETE CASCADE,
  PRIMARY KEY ("usuarioId","perfilId")
);
ALTER TABLE "UsuarioPerfil" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 4) <data>_sial_processo_fks.sql  (fecha o que o core deixou solto)
ALTER TABLE "Processo"
  ADD CONSTRAINT "Processo_requerente_fk"
  FOREIGN KEY ("requerenteId") REFERENCES "Usuario"(id);
ALTER TABLE "Evento"
  ADD CONSTRAINT "Evento_usuario_fk"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"(id);
```

```sql
-- 5) <data>_sial_rls_helpers.sql
CREATE OR REPLACE FUNCTION sial_current_usuario() RETURNS uuid AS $$
  SELECT id FROM "Usuario" WHERE "authUserId" = auth.uid()
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION sial_is_servidor() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM "Usuario" WHERE "authUserId"=auth.uid() AND tipo='interno' AND ativo)
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION sial_has_perfil(p text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "UsuarioPerfil" up
    JOIN "Usuario" u ON u.id=up."usuarioId"
    JOIN "Perfil" pf ON pf.id=up."perfilId"
    WHERE u."authUserId"=auth.uid() AND pf.nome=p
  )
$$ LANGUAGE sql STABLE;
```

```sql
-- 6) <data>_sial_rls_policies.sql
-- Processo: requerente vê o próprio; servidor (resolvedor/admin) vê todos
CREATE POLICY "processo_requerente_select" ON "Processo"
  FOR SELECT USING ("requerenteId" = sial_current_usuario());
CREATE POLICY "processo_servidor_select" ON "Processo"
  FOR SELECT USING (sial_has_perfil('resolvedor') OR sial_has_perfil('administrador'));
CREATE POLICY "processo_requerente_write" ON "Processo"
  FOR UPDATE USING ("requerenteId" = sial_current_usuario());

-- Evento: visível a quem vê o processo
CREATE POLICY "evento_select" ON "Evento"
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM "Processo" p WHERE p.id="processoId"
      AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())
  ));

-- Metodo: leitura para autenticados; escrita só administrador
CREATE POLICY "metodo_read" ON "Metodo" FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "metodo_admin_write" ON "Metodo"
  FOR ALL USING (sial_has_perfil('administrador')) WITH CHECK (sial_has_perfil('administrador'));

-- Usuario: cada um vê a si; administrador vê todos
CREATE POLICY "usuario_self" ON "Usuario"
  FOR SELECT USING ("authUserId"=auth.uid() OR sial_has_perfil('administrador'));
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/auth/govbr/callback` | OIDC callback gov.br → upsert `Usuario(tipo=externo)` → sessão Supabase → redirect Portal (ou onboarding se cadastro novo) |
| GET | `/api/auth/interno/callback` | SAML/OIDC callback interno → upsert `Usuario(tipo=interno)` → resolve perfis → redirect Backoffice |
| GET | `/api/me` | → `{usuario, perfis[], tipo, nivelGovbr}` (sessão atual) |
| POST | `/api/onboarding` | Body `{cnpj?, papel, contato}` → valida (Receita stub) → completa `Usuario` → 200 |
| GET | `/api/admin/usuarios` | (admin) lista usuários internos com perfis |
| POST | `/api/admin/usuarios/:id/perfis` | (admin) Body `{perfilId, acao:'add'|'remove'}` → 204 |
| GET | `/api/admin/perfis` | (admin) lista perfis |

## §9 UX

### Login (duas portas)
```
┌──────── Portal SIAL ────────┐     ┌──────── Backoffice JUCESP ────────┐
│                             │     │                                   │
│   [ Entrar com gov.br ]     │     │   [ Entrar (credencial JUCESP) ]  │
│                             │     │                                   │
│  Cidadão · Empresa ·        │     │  Servidor interno                 │
│  Leiloeiro · Tradutor       │     │                                   │
└─────────────────────────────┘     └───────────────────────────────────┘
```

### Onboarding (primeiro acesso externo) — wizard
```
┌──────────── Bem-vindo, MARIA SILVA ────────────┐
│ Passo 1 de 2 — Quem é você?                     │
│ ( ) Empresa   ( ) Leiloeiro   ( ) Tradutor      │
│                                                 │
│ CNPJ (se empresa): [__________]  [Validar]      │
│ Contato: e-mail [______]  tel [______]          │
│                              [ Continuar → ]    │
└─────────────────────────────────────────────────┘
```

### Gestão de usuários (admin) — ResponsiveSheet
```
┌── Usuários internos ──────────────────────────┐
│ Nome           Perfis            Situação      │
│ Maria Silva    resolvedor        ● ativo  [⋮]  │
│ João Souza     administrador     ● ativo  [⋮]  │
│ ──────────────────────────────────────────────│
│ [⋮] → Editar perfis (add/remove) · Desativar   │
└────────────────────────────────────────────────┘
```

## §10 Integrações

- **`prd-sial-core-process`**: adiciona FKs em `Processo`/`Evento`; ativa as policies que o core deixou pendentes.
- **`prd-sial-assinatura`**: consome `Usuario.nivelGovbr` para decidir caminho de assinatura.
- **`prd-sial-integracao-receita`**: substitui o stub de validação de CNPJ no onboarding.
- **`prd-sial-tramitacao`**: cria `Area` e relaciona com `Usuario` (perfil `setor`).
- Todos os PRDs de superfície dependem dos helpers RLS (`sial_has_perfil`, etc.).

## §11 Faseamento

Fase 1 (esta PRD): schema (Usuario/Perfil/UsuarioPerfil) → ALTER FKs no core → helpers RLS → policies → callback gov.br → callback interno → /api/me → onboarding (CNPJ stub) → gestão de usuários/perfis (admin) → smoke. Entrega login funcional dos dois domínios + RBAC — base de tudo que vem depois.

Fase 2: cadastro alternativo sem gov.br (gap G3); validação real de CNPJ migra para o PRD de integração Receita.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Integração gov.br OIDC instável trava o login externo | M | A | Mensagem clara de indisponibilidade + retry; cair em "tente novamente" sem perder contexto (alinha com PRD resiliência). |
| RLS mal configurado vaza dados entre requerentes (LGPD) | M | A | Helpers testados; smoke com 2 usuários distintos garantindo isolamento; default deny herdado do core. |
| SSO interno corporativo (SAML) demora a ser liberado pela JUCESP | A | M | Onboarding interno por seed/admin como fallback temporário; SSO atrás de feature flag. |
| Usuário externo representa várias empresas (multi-CNPJ) | M | M | Modelar vínculo Usuario↔cadastro como N:N desde já (não 1:1). |
| Nível gov.br insuficiente para assinar só descoberto na hora de assinar | M | B | Guardar nivelGovbr no login e avisar cedo no fluxo (consumido pelo PRD assinatura). |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Isolamento RLS efetivo (requerente não vê processo de outro) | smoke SQL: consulta como user A não retorna processo de user B |
| Logins por domínio | `SELECT tipo, count(*) FROM "Usuario" GROUP BY tipo` |
| Taxa de conclusão do onboarding | `SELECT count(*) FILTER (WHERE documento IS NOT NULL)::float / count(*) FROM "Usuario" WHERE tipo='externo'` |
| Distribuição de perfis internos | `SELECT pf.nome, count(*) FROM "UsuarioPerfil" up JOIN "Perfil" pf ON pf.id=up."perfilId" GROUP BY pf.nome` |

## §14 Open questions

- ❓ (gap G3) Existe cadastro alternativo para quem não tem conta gov.br? **MVP exige gov.br (D10); alternativa é Fase 2.**
- ❓ (gap G1) App único vs apps separados no backoffice. **Resolvido: app único com motor de perfis (D5).**
- ❓ Multi-CNPJ por usuário externo confirma N:N? **Modelado como N:N por precaução; validar com a JUCESP.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §3.3, §4, §5, §9; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession `b0a0f115-0ba3-48e6-92c2-244fe115855b` — cards "Login GOV.BR", "Onboarding", "SSO interno", "Gestão de usuários e perfis"; gap G1/G3.
- Memory: `feedback_role_helpers_postgres` (helpers RLS em TS + Postgres), `project_member_roles_access` (padrão de access model).
- `prd-sial-core-process` (D7/D8 — FKs pendentes).

## §16 Stories implementáveis

```yaml
- id: SIAL-IAM-001
  title: Migration — tabela Usuario (externo/interno + nivelGovbr)
  description: Cria Usuario conforme §7 (1) com CHECK de tipo e nivelGovbr, índice por tipo, RLS on.
  acceptanceCriteria:
    - "Usuario existe com tipo CHECK ('externo','interno')"
    - "Colunas govBrId, ssoId, nivelGovbr presentes"
    - "RLS habilitado"
  verifiable:
    - kind: sql
      command_or_query: "SELECT relrowsecurity FROM pg_class WHERE relname='Usuario'"
      expected: "t"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-IAM-002
  title: Migration — Perfil (+ seed dos 3 perfis)
  description: Cria Perfil e insere administrador/resolvedor/setor conforme §7 (2).
  acceptanceCriteria:
    - "Perfil existe com nome UNIQUE"
    - "3 perfis seedados"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Perfil\""
      expected: "3"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-IAM-003
  title: Migration — UsuarioPerfil (N:N)
  description: Cria tabela de junção conforme §7 (3) com PK composta e RLS on.
  acceptanceCriteria:
    - "UsuarioPerfil tem PK (usuarioId, perfilId)"
    - "FKs ON DELETE CASCADE para Usuario e Perfil"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.table_constraints WHERE table_name='UsuarioPerfil' AND constraint_type='FOREIGN KEY'"
      expected: "2"
  dependsOn: [SIAL-IAM-001, SIAL-IAM-002]
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-IAM-004
  title: Migration — FKs no núcleo (Processo.requerenteId, Evento.usuarioId)
  description: ALTER adicionando as FKs que o core deixou como uuid solto (§7 (4)).
  acceptanceCriteria:
    - "Processo_requerente_fk existe"
    - "Evento_usuario_fk existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name IN ('Processo_requerente_fk','Evento_usuario_fk')"
      expected: "2"
  dependsOn: [SIAL-IAM-001]
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-IAM-005
  title: Migration — RLS helpers (is_servidor, has_perfil, current_usuario)
  description: Cria as funções SQL de §7 (5).
  acceptanceCriteria:
    - "sial_current_usuario(), sial_is_servidor(), sial_has_perfil(text) existem"
    - "sial_has_perfil retorna boolean"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_proc WHERE proname IN ('sial_current_usuario','sial_is_servidor','sial_has_perfil')"
      expected: "3"
  dependsOn: [SIAL-IAM-003]
  estimateMinutes: 25
  touches: ["supabase/migrations/"]

- id: SIAL-IAM-006
  title: Migration — RLS policies (Processo, Evento, Metodo, Usuario)
  description: Cria as policies de §7 (6) usando os helpers.
  acceptanceCriteria:
    - "Policies de SELECT em Processo para requerente e servidor existem"
    - "Metodo tem policy de escrita só para administrador"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename IN ('Processo','Evento','Metodo','Usuario')"
      expected: "7"
  dependsOn: [SIAL-IAM-005, SIAL-IAM-004]
  estimateMinutes: 30
  touches: ["supabase/migrations/"]

- id: SIAL-IAM-007
  title: Auth gov.br — provider OIDC + callback (Usuario externo)
  description: Configura provider OIDC gov.br no Supabase Auth e o callback que faz upsert de Usuario(tipo=externo, govBrId, nivelGovbr) e cria sessão.
  acceptanceCriteria:
    - "GET /api/auth/govbr/callback troca code por token e upserta Usuario"
    - "nivelGovbr é persistido a partir do claim do gov.br"
    - "Cadastro novo redireciona para onboarding; existente para o Portal"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-IAM-001]
  estimateMinutes: 30
  touches: ["src/app/api/auth/govbr/callback/route.ts", "src/lib/sial/auth/govbr.ts"]

- id: SIAL-IAM-008
  title: Auth interno — callback SSO (Usuario interno + perfis)
  description: Callback SAML/OIDC corporativo que upserta Usuario(tipo=interno, ssoId), resolve UsuarioPerfil e entrega o backoffice. Atrás de feature flag.
  acceptanceCriteria:
    - "GET /api/auth/interno/callback upserta Usuario interno"
    - "Perfis resolvidos a partir do diretório (ou seed admin de fallback)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-IAM-003]
  estimateMinutes: 30
  touches: ["src/app/api/auth/interno/callback/route.ts", "src/lib/sial/auth/interno.ts"]

- id: SIAL-IAM-009
  title: GET /api/me — sessão atual + perfis
  description: Endpoint que retorna o Usuario logado, tipo, perfis e nivelGovbr. Base dos guards da app.
  acceptanceCriteria:
    - "GET /api/me retorna {usuario, perfis[], tipo, nivelGovbr}"
    - "Sem sessão retorna 401"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-IAM-007]
  estimateMinutes: 20
  touches: ["src/app/api/me/route.ts", "src/lib/sial/auth/session.ts"]

- id: SIAL-IAM-010
  title: Onboarding externo — API + wizard (CNPJ stub)
  description: POST /api/onboarding coleta papel/CNPJ/contato, valida CNPJ via stub (real em PRD Receita) e completa Usuario. Wizard React de 2 passos.
  acceptanceCriteria:
    - "POST /api/onboarding completa documento/papel do Usuario"
    - "Wizard renderiza 2 passos e bloqueia avanço sem papel"
    - "Validação de CNPJ é um stub isolado (interface trocável)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-IAM-009]
  estimateMinutes: 30
  touches: ["src/app/api/onboarding/route.ts", "src/components/sial/onboarding-wizard.tsx"]

- id: SIAL-IAM-011
  title: Gestão de usuários e perfis (admin) — API + UI
  description: GET /api/admin/usuarios, POST /api/admin/usuarios/:id/perfis (add/remove), GET /api/admin/perfis. UI em ResponsiveSheet para editar perfis. Tudo restrito a administrador (RLS + guard).
  acceptanceCriteria:
    - "Lista de usuários internos com perfis"
    - "Add/remove de perfil persiste e reflete no RLS"
    - "Não-admin recebe 403"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-IAM-006, SIAL-IAM-009]
  estimateMinutes: 30
  touches: ["src/app/api/admin/usuarios/route.ts", "src/components/sial/admin/usuarios-sheet.tsx"]

- id: SIAL-IAM-012
  title: Regenerar database.types.ts (Usuario/Perfil/UsuarioPerfil + FKs)
  description: Atualiza os types do Supabase.
  acceptanceCriteria:
    - "Types incluem Usuario, Perfil, UsuarioPerfil"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-IAM-004]
  estimateMinutes: 15
  touches: ["src/lib/supabase/database.types.ts"]

- id: SIAL-IAM-013
  title: Smoke — isolamento RLS entre dois requerentes
  description: Cria usuário A e B (externos), cada um com um Processo. Confirma que A não enxerga o Processo de B, e que um resolvedor enxerga ambos.
  acceptanceCriteria:
    - "Como A: GET processos retorna só o de A"
    - "Como B: não retorna o de A"
    - "Como resolvedor: retorna A e B"
  verifiable:
    - kind: manual_browser
      command_or_query: "Logar como A, B e resolvedor; comparar listas de processos"
      expected: "isolamento correto entre requerentes; servidor vê todos"
  dependsOn: [SIAL-IAM-011, SIAL-IAM-010]
  estimateMinutes: 25
  touches: ["(end-to-end)"]
```

**Total: 13 stories, ~325min (~5h25).**
