-- ZLAR-V2-US-010 — Conhecer e navegar o catálogo de serviços (CLIENTE / SOLICITACAO)
-- Backlog cards (planning metadata only — INSERTs em tabelas internas do Zordon).
-- Os snippets DDL/TS dentro de Task.description são SPEC pra implementador, NÃO rodam aqui.

BEGIN;

-- =============================================================================
-- 1. Tasks
-- =============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ───────── DATA ─────────

(
  '8554293b-392d-4b05-a672-c4ee7f984c40',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-059',
  'Estender service_subcategories com preço indicativo + flag visita técnica e reseedar 7 categorias do MVP',
  $desc$## Objetivo
Adicionar à `service_subcategories` colunas de preço indicativo (`price_min_cents`, `price_max_cents`, `pricing_basis`) e flag `is_virtual_consultation` para "Não sei especificar — visita técnica". Reseedar `service_categories` com a lista oficial do MVP (eletrica, encanamento, limpeza, montagem, pintura, climatizacao, pequenos_reparos) e popular subcategorias. Cobre AC #1, #2, #3, #4 da US-010.

## Contexto
Módulo SOLICITACAO. Catálogo já criado em T-001 (US-001) com leitura pública via RLS (`anon_read_categories`/`anon_read_subcategories`). T-001 trouxe 7 categorias provisórias diferentes da lista final do produto — esta task reconcilia. Estrutura é lida pela home pública (T-065), tela de categoria (T-066), busca (T-062) e pelo prestador no wizard (T-007 já lê via FK em `provider_categories`). Engine de matching (US-020) também consome.

## Estado atual / O que substitui
- Tabelas `service_categories` e `service_subcategories` existem (T-001).
- Categorias seedadas em T-001 NÃO batem com a definição da US-010 (T-001 trouxe `limpeza/reformas/eletrica/hidraulica/jardinagem/mudancas/beleza`; US-010 manda `eletrica/encanamento/limpeza/montagem/pintura/climatizacao/pequenos_reparos`).
- Subcategorias ainda não foram populadas em T-001 (comentário "lista final em produto").
- Sem coluna de preço, sem flag de visita técnica.

Esta task **reconcilia** mantendo as 2 tabelas: ALTER + UPDATE seed em vez de DROP/recreate (preserva FKs já criadas pelo `provider_categories` em T-003).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_catalog_pricing.sql`
```sql
BEGIN;

-- 1. Reconciliação das 7 categorias do MVP
--    Estratégia: UPDATE quando slug existe, INSERT quando não, marcar active=false
--    nas categorias antigas que saíram da lista oficial.

-- Marca como inativas as categorias antigas que saíram do MVP
UPDATE service_categories SET active = false, "updatedAt" = NOW()
WHERE slug IN ('reformas', 'hidraulica', 'jardinagem', 'mudancas', 'beleza');

-- Mantém limpeza e eletrica (já existem)
UPDATE service_categories SET name = 'Elétrica',  "order" = 1, active = true WHERE slug = 'eletrica';
UPDATE service_categories SET name = 'Limpeza',   "order" = 3, active = true WHERE slug = 'limpeza';

-- Insere as 5 novas
INSERT INTO service_categories (slug, name, "order", active) VALUES
  ('encanamento',     'Encanamento',     2, true),
  ('montagem',        'Montagem',        4, true),
  ('pintura',         'Pintura',         5, true),
  ('climatizacao',    'Climatização',    6, true),
  ('pequenos_reparos','Pequenos reparos',7, true)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, "order" = EXCLUDED."order", active = true, "updatedAt" = NOW();

-- 2. Estender service_subcategories
ALTER TABLE service_subcategories
  ADD COLUMN IF NOT EXISTS price_min_cents int CHECK (price_min_cents IS NULL OR price_min_cents >= 0),
  ADD COLUMN IF NOT EXISTS price_max_cents int CHECK (price_max_cents IS NULL OR price_max_cents >= 0),
  ADD COLUMN IF NOT EXISTS pricing_basis   text CHECK (pricing_basis IN ('per_visit','per_hour','per_unit','from')),
  ADD COLUMN IF NOT EXISTS is_virtual_consultation boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT subcat_price_range CHECK (
    price_min_cents IS NULL OR price_max_cents IS NULL OR price_min_cents <= price_max_cents
  );

CREATE INDEX IF NOT EXISTS idx_subcat_virtual ON service_subcategories(is_virtual_consultation) WHERE is_virtual_consultation;
CREATE INDEX IF NOT EXISTS idx_subcat_active_order ON service_subcategories(category_id, active, "order");

-- 3. Seed subcategorias do MVP (exemplo — lista final no card)
WITH cats AS (
  SELECT id, slug FROM service_categories WHERE active
)
INSERT INTO service_subcategories (category_id, slug, name, "order", price_min_cents, price_max_cents, pricing_basis, is_virtual_consultation, active)
SELECT c.id, v.slug, v.name, v."order", v.pmin, v.pmax, v.basis, v.virt, true
FROM cats c JOIN (VALUES
  -- ELETRICA
  ('eletrica', 'tomada_padrao',       'Instalação de tomada padrão',           1, 12000,  20000, 'per_unit', false),
  ('eletrica', 'chuveiro',            'Troca de chuveiro elétrico',            2, 15000,  28000, 'per_visit',false),
  ('eletrica', 'disjuntor',           'Substituição de disjuntor',             3, 18000,  35000, 'per_unit', false),
  ('eletrica', 'luminaria',           'Instalação de luminária',               4,  8000,  18000, 'per_unit', false),
  ('eletrica', 'visita_tecnica',      'Não sei especificar — visita técnica',  99,12000,  12000, 'per_visit',true),

  -- ENCANAMENTO
  ('encanamento','vazamento',         'Reparo de vazamento',                   1, 18000,  40000, 'per_visit',false),
  ('encanamento','torneira',          'Troca de torneira',                     2, 12000,  22000, 'per_unit', false),
  ('encanamento','desentupimento',    'Desentupimento simples',                3, 20000,  45000, 'per_visit',false),
  ('encanamento','visita_tecnica',    'Não sei especificar — visita técnica',  99,12000,  12000, 'per_visit',true),

  -- LIMPEZA
  ('limpeza',  'pos_obra',            'Limpeza pós-obra',                      1, 25000,  60000, 'per_visit',false),
  ('limpeza',  'apartamento',         'Limpeza de apartamento',                2, 15000,  30000, 'per_visit',false),
  ('limpeza',  'visita_tecnica',      'Não sei especificar — visita técnica',  99,12000,  12000, 'per_visit',true),

  -- MONTAGEM
  ('montagem', 'movel_simples',       'Montagem de móvel simples',             1, 10000,  18000, 'per_unit', false),
  ('montagem', 'guarda_roupa',        'Montagem de guarda-roupa',              2, 18000,  35000, 'per_unit', false),
  ('montagem', 'visita_tecnica',      'Não sei especificar — visita técnica',  99,12000,  12000, 'per_visit',true),

  -- PINTURA
  ('pintura',  'parede_interna',      'Pintura de parede interna (m²)',        1,    2500,  4500, 'per_unit', false),
  ('pintura',  'fachada',             'Pintura de fachada (m²)',               2,    3500,  6500, 'per_unit', false),
  ('pintura',  'visita_tecnica',      'Não sei especificar — visita técnica',  99,12000,  12000, 'per_visit',true),

  -- CLIMATIZACAO
  ('climatizacao','limpeza_split',    'Limpeza de ar-condicionado split',      1, 15000,  28000, 'per_unit', false),
  ('climatizacao','instalacao',       'Instalação de ar-condicionado',         2, 35000,  80000, 'per_unit', false),
  ('climatizacao','visita_tecnica',   'Não sei especificar — visita técnica',  99,12000,  12000, 'per_visit',true),

  -- PEQUENOS_REPAROS
  ('pequenos_reparos','fechadura',    'Troca de fechadura',                    1, 12000,  25000, 'per_unit', false),
  ('pequenos_reparos','prateleira',   'Instalação de prateleira',              2,  8000,  15000, 'per_unit', false),
  ('pequenos_reparos','visita_tecnica','Não sei especificar — visita técnica', 99,12000,  12000, 'per_visit',true)
) v(cat_slug, slug, name, "order", pmin, pmax, basis, virt) ON c.slug = v.cat_slug
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  "order" = EXCLUDED."order",
  price_min_cents = EXCLUDED.price_min_cents,
  price_max_cents = EXCLUDED.price_max_cents,
  pricing_basis = EXCLUDED.pricing_basis,
  is_virtual_consultation = EXCLUDED.is_virtual_consultation,
  active = true;

COMMIT;
```

### Constraint adicional
- Garantir 1 visita técnica ativa por categoria via índice único parcial:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcat_one_virtual_per_category
  ON service_subcategories(category_id) WHERE is_virtual_consultation AND active;
```

## Constraints / NÃO fazer
- ❌ DROP/recreate das tabelas — `provider_categories` (T-003) já tem FK em `service_subcategories.id`
- ❌ DELETE de categorias antigas — usar `active=false` (preserva integridade de dados de prestadores que já se vincularam)
- ❌ Adicionar coluna `description` em subcategoria nesta task — fica fora do MVP de listagem
- ❌ Mudar a estratégia de RLS pública (T-001 já garante anon read)
- ❌ Atrelar prestadores a subcategorias aqui (vive em T-003)

## Convenções
- Migration aplicada via `psql "$DIRECT_URL" -f <file>`; `database.types.ts` regenerado
- Preços em centavos (int) — sem decimais; conversão em UI
- `pricing_basis` é dica de unidade (per_visit/per_hour/per_unit/from) — UI renderiza como "a partir de R$ X" ou "R$ X-Y por visita"
- `is_virtual_consultation` flag binária; índice único parcial garante 1 por categoria
- Lista exata de subcategorias é especificação MVP — produto pode evoluir via UI admin (US-019)$desc$,
  'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '40b3d372-395c-4959-acc0-17f3ef0ae72c',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-060',
  'Criar tabela client_tour_state com flag de tour visto + reset por persona',
  $desc$## Objetivo
Persistir o estado do tour guiado de primeira visita do CLIENTE: se viu, quando viu, quando dispensou. Permite ocultar tour em sessões futuras e oferecer "retomar tour" via perfil. Cobre AC #7 da US-010.

## Contexto
Módulo SOLICITACAO. UI do tour (T-068) lê esta tabela ao montar a home; perfil do cliente (US-014) expõe ação "Ver tour novamente" que deleta a linha (efetivamente reset). Não é onboarding obrigatório — usuário pode dispensar e ainda assim usar o app.

## Estado atual / O que substitui
Não existe — primeira tabela de telemetria de UX do CLIENTE.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_tour_state.sql`
```sql
BEGIN;

CREATE TABLE client_tour_state (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_key     text NOT NULL DEFAULT 'home_catalog_v1',
  viewed_at    timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  "createdAt"  timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"  timestamptz NOT NULL DEFAULT NOW(),
  CHECK (
    -- pelo menos um desses tem que estar setado para a linha existir
    viewed_at IS NOT NULL OR completed_at IS NOT NULL OR dismissed_at IS NOT NULL
  )
);

ALTER TABLE client_tour_state ENABLE ROW LEVEL SECURITY;

-- CLIENTE lê/grava o próprio
CREATE POLICY "client_tour_own_select" ON client_tour_state
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "client_tour_own_upsert" ON client_tour_state
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "client_tour_own_update" ON client_tour_state
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "client_tour_own_delete" ON client_tour_state
  FOR DELETE USING (auth.uid() = user_id);

-- ADMIN lê tudo
CREATE POLICY "admin_tour_all" ON client_tour_state FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER client_tour_state_updated
  BEFORE UPDATE ON client_tour_state
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir leitura cross-user via RLS (deve falhar smoke se outro user lê)
- ❌ Persistir estado de tour no localStorage (perdido entre devices; precisa server-side)
- ❌ Acoplar a tour específico — usar `tour_key` para suportar tours futuros
- ❌ Auditar mudança via tabela à parte — não é dado crítico

## Convenções
- Linha por usuário (PK = user_id, não composta com tour_key — tour novo = mesma linha sobrescrita ou tour_key novo numa segunda tabela quando precisar)
- `viewed_at` marca primeira aparição; `completed_at` marca última etapa concluída; `dismissed_at` marca dispense explícito
- Reset = DELETE da linha (perfil em US-014 oferece via API)
- Trigger `moddatetime` reaproveita helper já existente (mesmo de `app_config`)$desc$,
  'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

-- ───────── API ─────────

(
  '004c03c3-b36d-4425-a2c7-68ec738993b0',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-061',
  'Implementar GET /api/catalog (categorias + subcategorias + preços) público',
  $desc$## Objetivo
Expor o catálogo completo (categorias ativas + subcategorias com preço e flag de visita técnica) num único endpoint cacheável, lido por qualquer visitante (autenticado ou não). Cobre AC #1, #2, #3, #4 da US-010.

## Contexto
Módulo SOLICITACAO. Consumido por: home pública (T-065 — Server Component faz fetch direto no servidor), página de categoria (T-066), busca (T-062 reusa o resultado em memória ou faz fetch separado). Lê via `createClient()` server-side; RLS pública já permite anon read. Resposta é JSON estável durante uma janela de 5 min (revalidate via tag), porque catálogo muda com baixa frequência (admin via US-019).

## Estado atual / O que substitui
Não existe — primeiro endpoint público do produto.

## O que criar

### `src/app/api/catalog/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 300; // 5 min

export async function GET() {
  const supabase = await createClient();

  const { data: categories, error } = await supabase
    .from('service_categories')
    .select(`
      id, slug, name, icon, "order",
      subcategories:service_subcategories (
        id, slug, name, "order",
        price_min_cents, price_max_cents, pricing_basis,
        is_virtual_consultation
      )
    `)
    .eq('active', true)
    .eq('subcategories.active', true)
    .order('order', { ascending: true })
    .order('order', { foreignTable: 'service_subcategories', ascending: true });

  if (error) {
    return NextResponse.json({ error: 'catalog_unavailable' }, { status: 502 });
  }

  // Move "visita_tecnica" para o final dentro de cada categoria
  const sorted = categories?.map(c => ({
    ...c,
    subcategories: [
      ...c.subcategories.filter(s => !s.is_virtual_consultation),
      ...c.subcategories.filter(s => s.is_virtual_consultation),
    ],
  })) ?? [];

  return NextResponse.json(
    { categories: sorted },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } }
  );
}
```

### `src/lib/dal/catalog.ts` (helper server-only para reuso direto via Server Component)
```typescript
import { createClient } from '@/lib/supabase/server';

export async function getCatalog() {
  const supabase = await createClient();
  // ...mesma query do route handler, retorna { categories: [...] }
}
```

## Constraints / NÃO fazer
- ❌ Buscar via `createBrowserClient` (catálogo é server-fetch — UI usa Server Component)
- ❌ Filtrar por busca aqui (busca é endpoint separado: T-062)
- ❌ Fazer JOIN com prestadores (irrelevante para a tela de catálogo)
- ❌ Retornar campos auditáveis (createdAt/updatedAt) — não usados na UI
- ❌ Aplicar Zod no body (GET sem body)

## Convenções
- `revalidate = 300` (Next 16 ISR) — invalidado por admin em US-019 via `revalidatePath`/`revalidateTag`
- Endpoint público — RLS já permite (não há auth necessário)
- Resposta padronizada `{ categories: [...] }` para evolução futura (`{ categories, version }`)
- Erros de DB viram 502 (gateway upstream) — não 500$desc$,
  'API', 'ANY', ARRAY['NO_RLS_NEEDED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  'b8d75a54-f43c-4c87-9abb-d2446f465e87',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-062',
  'Implementar GET /api/catalog/search?q= com busca cross-categoria por palavra-chave',
  $desc$## Objetivo
Permitir que o cliente busque uma palavra-chave (ex: "torneira", "fechadura") e receba subcategorias matching independente da categoria pai, com referência à categoria para navegação. Cobre AC #8 da US-010.

## Contexto
Módulo SOLICITACAO. Consumido pela busca em UI (T-069 — input no header da home/tela de categoria com debounce). Match é unaccent + ilike no `name` da subcategoria + `name` da categoria pai (assim "eletrica" também encontra subcats da categoria Elétrica). Resposta limitada a 20 itens, ordenada por relevância (match em `name` > match em pai).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_catalog_search.sql`
```sql
BEGIN;
-- Habilitar unaccent (idempotente)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Índice GIN para ILIKE com unaccent
CREATE INDEX IF NOT EXISTS idx_subcat_name_unaccent
  ON service_subcategories USING gin (unaccent(name) gin_trgm_ops);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION search_catalog(p_query text)
RETURNS TABLE (
  subcategory_id uuid,
  subcategory_slug text,
  subcategory_name text,
  category_id uuid,
  category_slug text,
  category_name text,
  is_virtual_consultation boolean,
  price_min_cents int,
  price_max_cents int,
  rank float
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT s.id, s.slug, s.name,
         c.id, c.slug, c.name,
         s.is_virtual_consultation,
         s.price_min_cents, s.price_max_cents,
         GREATEST(
           similarity(unaccent(s.name), unaccent(p_query)),
           similarity(unaccent(c.name), unaccent(p_query)) * 0.5
         ) AS rank
  FROM service_subcategories s
  JOIN service_categories c ON c.id = s.category_id
  WHERE s.active AND c.active
    AND (
      unaccent(s.name) ILIKE '%' || unaccent(p_query) || '%'
      OR unaccent(c.name) ILIKE '%' || unaccent(p_query) || '%'
    )
  ORDER BY rank DESC
  LIMIT 20;
$$;
COMMIT;
```

### `src/app/api/catalog/search/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Q = z.object({ q: z.string().min(2).max(50) });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse({ q: url.searchParams.get('q') });
  if (!parsed.success) {
    return NextResponse.json({ results: [] }); // input curto → resposta vazia silenciosa
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_catalog', { p_query: parsed.data.q });
  if (error) return NextResponse.json({ error: 'search_failed' }, { status: 502 });
  return NextResponse.json({ results: data });
}
```

## Constraints / NÃO fazer
- ❌ Usar `text @@ plainto_tsquery` aqui — overkill para 50 subcats; ILIKE+trigram cobre
- ❌ Filtrar por preço/local — busca é só por palavra-chave neste card
- ❌ Cachear via `revalidate` (consulta dinâmica) — `Cache-Control: no-store`
- ❌ Expor `rank` para a UI — só ordena
- ❌ Aceitar query < 2 chars (ruído)

## Convenções
- RPC `search_catalog` SECURITY INVOKER — RLS pública garante leitura sem auth
- Resposta padrão `{ results: [...] }`
- 20 resultados max — UI mostra todos sem paginação
- Sem rate limit explícito (RLS pública lida; abuso vira monitoring downstream)$desc$,
  'API', 'ANY', ARRAY['NO_RLS_NEEDED','INPUT_VALIDATION','INDEX_REQUIRED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  'cef3e9a3-7124-4a6a-a05a-5d97d3726ec3',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-063',
  'Liberar /(public)/* no proxy.ts para navegação anônima do catálogo',
  $desc$## Objetivo
Ajustar o middleware/proxy do Next 16 para permitir que rotas `/(public)/home`, `/(public)/catalog/*` e `/api/catalog*` sejam servidas sem sessão autenticada, redirecionando para login somente quando o cliente clica em "iniciar solicitação" (que vai para `/(client)/services/new`). Cobre AC #6 da US-010.

## Contexto
Módulo SOLICITACAO. O proxy atual (de US-002 T-019 e US-008 T-041) tem guards que protegem rotas operacionais por estado da conta (KYC, suspensão). Esta task **expande** a allowlist do proxy para incluir o segmento `(public)` — não substitui guards existentes. Splash em `(public)/splash` (T-055) já existe sem auth; agora `(public)/home` e `(public)/catalog/[slug]` se juntam.

## Estado atual / O que substitui
- `proxy.ts` (Next 16, raiz do app) hoje força auth em todas rotas exceto `(public)/splash`, `/login`, `/signup`, `/api/auth/*`.
- Rotas `(public)/home` e `(public)/catalog/*` ainda não existem (criadas em T-065/T-066).
- Não há tratamento de "anônimo seleciona subcategoria → login antes de form" (AC #6 + AC #9).

## O que criar / alterar

### `proxy.ts` (raiz do app, Next 16)
```typescript
const PUBLIC_PREFIXES = [
  '/(public)/splash',
  '/(public)/home',
  '/(public)/catalog',
  '/api/catalog',           // GET /api/catalog e /api/catalog/search
  '/api/auth',
  '/login',
  '/signup',
  '/_next',
  '/favicon',
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export async function proxy(req: Request) {
  const url = new URL(req.url);
  if (isPublic(url.pathname)) {
    return; // sem guard
  }
  // ...guards existentes (sessão, KYC, suspensão)
}
```

### Redirect "intent → login"
Quando cliente anônimo entra em `/(public)/catalog/[slug]/[subcatSlug]` e clica "Continuar", a UI (T-066) seta query string `?next=/services/new?subcat=<id>` e redireciona para `/login`. Após login, hook `route-state` (já existe em T-054) consulta `next` e empurra pra rota destino.

## Constraints / NÃO fazer
- ❌ Liberar `/(client)/*` ou `/(provider)/*` (são rotas operacionais — protegidas)
- ❌ Liberar `/api/services/*` (mutação requer auth)
- ❌ Mover código de proxy para um Edge Middleware separado (mantém arquitetura atual do projeto)
- ❌ Persistir intent em cookie sem hash (`next` em query string já basta — UX claro)

## Convenções
- Lista única de prefixos públicos (`PUBLIC_PREFIXES`) para auditabilidade
- Sem cookie/session na rota pública — Server Components rodam com `createClient()` que já lida com anônimo
- Redirect de "iniciar solicitação" preserva o subcat selecionado via query (`?next=...&subcat=...`)
- Reaproveitar guard de roteamento pós-login já implementado em T-018 (provider) / T-054 (client)$desc$,
  'API', 'ANY', ARRAY['NO_RLS_NEEDED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

-- ───────── OPS ─────────

(
  '70c81687-43c2-4d0f-acd7-d66c67dbd5a4',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-064',
  'Seedar app_config com regras de visita técnica (taxa, abatimento, retenção)',
  $desc$## Objetivo
Adicionar parâmetros operacionais de visita técnica em `app_config` para que a UI (T-067) renderize a regra antes da seleção: taxa fixa de deslocamento, abatimento integral se contratar, retenção se recusar. Cobre AC #5 da US-010.

## Contexto
Módulo SOLICITACAO. `app_config` será criada em US-019 (admin parametrização) — esta task **assume** que a tabela existe ou inclui criação mínima caso US-019 ainda não tenha rodado. Se conflito de ordem, esta task vai num arquivo separado e idempotente. Valores iniciais vêm da DS Inception (alinhamento de produto).

## Estado atual / O que substitui
- Tabela `app_config` planejada para US-019 (T-NNN); ainda não criada no momento desta US.
- Sem parâmetros de visita técnica configuráveis — tudo seria hardcoded em código.
- A skill registra esta task como **OPS** porque é seed de configuração; a tabela é parte do escopo de US-019, mas o seed específico de visita técnica é de US-010.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_visita_tecnica_config.sql`
```sql
BEGIN;

-- Garante app_config existir (ainda que US-019 venha depois nesta ordem)
CREATE TABLE IF NOT EXISTS app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES auth.users(id),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON app_config;
CREATE POLICY "auth_select" ON app_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_select_public_keys" ON app_config;
-- Apenas chaves marcadas com prefixo "public:" são lidas por anon (catálogo, regras visíveis pré-login)
CREATE POLICY "anon_select_public_keys" ON app_config FOR SELECT
  USING (key LIKE 'public:%');
DROP POLICY IF EXISTS "admin_write" ON app_config;
CREATE POLICY "admin_write" ON app_config FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Seed visita técnica (chave pública)
INSERT INTO app_config (key, value, description) VALUES
  ('public:visita_tecnica',
   $j${
     "fixed_fee_cents": 12000,
     "discount_if_hired": "100%",
     "retention_if_declined": "100%",
     "policy_text": "Taxa fixa de deslocamento de R$ 120,00. Se você contratar a execução com o prestador na própria visita, o valor é abatido integralmente. Se recusar a contratação, a taxa é retida.",
     "version": "v1"
   }$j$::jsonb,
   'Regra de visita técnica exibida antes da seleção. Lida por anon (chave public:*).'
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, description = EXCLUDED.description, "updatedAt" = NOW();

COMMIT;
```

### `src/lib/dal/app-config.ts` (helper server-only)
```typescript
export async function getPublicConfig(key: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('app_config')
    .select('value').eq('key', `public:${key}`).single();
  return data?.value;
}
```

## Constraints / NÃO fazer
- ❌ Hardcodar a regra em UI — tem que ser configurável
- ❌ Permitir UPDATE sem auditoria — `app_config_history` (US-019) ainda não existe; esta task NÃO cria trigger de history (vive em US-019)
- ❌ Misturar chaves públicas com privadas no mesmo padrão — usar prefixo `public:`
- ❌ Estender o schema da tabela aqui — só seed e a policy mínima

## Convenções
- Chave `public:visita_tecnica` (prefixo `public:`) para indicar leitura por anon
- `value` em jsonb mesmo escalar (consistência)
- `policy_text` em pt-BR; `version` permite invalidar cache em mudança
- US-019 estende esta tabela com trigger de auditoria sem quebrar o seed daqui$desc$,
  'OPS', 'ANY', ARRAY['RLS_REQUIRED'],
  'draft', 'chore',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

-- ───────── UI ─────────

(
  'b3075839-5381-4e33-82c9-4dc2b08da97a',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-065',
  'Renderizar home pública /(public)/home com grade visual das 7 categorias',
  $desc$## Objetivo
Tela inicial pública (sem auth necessária) com grade visual das 7 categorias do MVP, identidade visual clara por categoria (ícone + cor de acento), responsiva (mobile-first), CTA "iniciar solicitação" que leva ao login se anônimo. Cobre AC #1 e AC #6 da US-010.

## Contexto
Módulo SOLICITACAO. Substitui a `home placeholder do cliente` criada em T-058 (US-009) — mover lá pra `/(client)/dashboard` e usar `/(public)/home` como entrypoint padrão. Server Component faz fetch de `getCatalog()` (T-061 helper) e renderiza grid. Inclui header com `Buscar` (T-069) e ponto de entrada do tour (T-068).

## Estado atual / O que substitui
- `(client)/page.tsx` (T-058) hoje renderiza placeholder pós-signup. **Esta task** move o placeholder pra `/(client)/dashboard/page.tsx` (rota autenticada) e cria `/(public)/home/page.tsx` como nova entrada padrão.
- Splash de seleção CLIENTE/PRESTADOR já existe em `/(public)/splash` (T-055) — fica como rota separada (alguém clicando "Sou prestador" cai lá; "Sou cliente" pode cair em `/(public)/home` direto).
- Sem ícones por categoria definidos — usar ícones do `lucide-react` (já instalado): `Zap` (Elétrica), `Wrench` (Encanamento), `Sparkles` (Limpeza), `Hammer` (Montagem), `Brush` (Pintura), `Snowflake` (Climatização), `Drill` (Pequenos reparos).

## O que criar

### `src/app/(public)/home/page.tsx`
```tsx
import { getCatalog } from '@/lib/dal/catalog';
import { CategoryGrid } from '@/components/catalog/CategoryGrid';
import { CatalogSearch } from '@/components/catalog/CatalogSearch';
import { TourLauncher } from '@/components/catalog/TourLauncher';

export const revalidate = 300;

export default async function PublicHomePage() {
  const { categories } = await getCatalog();
  return (
    <main className="mx-auto max-w-3xl px-4 pb-12 pt-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">O que você precisa hoje?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Encontre um profissional verificado para o seu serviço.
        </p>
      </header>
      <CatalogSearch />
      <CategoryGrid categories={categories} className="mt-6" />
      <TourLauncher />
    </main>
  );
}
```

### `src/components/catalog/CategoryGrid.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { CategoryIcon } from './CategoryIcon';

export function CategoryGrid({ categories, className }: { categories: Category[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4', className)}>
      {categories.map(c => (
        <Link key={c.id} href={`/(public)/catalog/${c.slug}`} prefetch>
          <Card className="flex h-32 flex-col items-center justify-center gap-2 p-4 transition hover:border-primary">
            <CategoryIcon slug={c.slug} className="size-8" />
            <span className="text-sm font-medium">{c.name}</span>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

### `src/components/catalog/CategoryIcon.tsx`
- Mapeia slug → ícone do `lucide-react`. Cor de acento via `data-category` para CSS targeting.

## Constraints / NÃO fazer
- ❌ `'use client'` na page — Server Component (fetch direto, melhor SSR)
- ❌ Buscar via `createBrowserClient` — usar `getCatalog()` server helper
- ❌ Renderizar lista vertical em mobile — grade 2 colunas é melhor para 7 itens
- ❌ Login forçado aqui (rota é pública)
- ❌ Animações pesadas — manter LCP rápido

## Convenções
- Reuso: `Card` (`src/components/ui/card.tsx`), `lucide-react` icons (já dep)
- Mobile-first: 2 cols < 640px, 3 cols 640-768px, 4 cols ≥ 768px
- ISR `revalidate = 300` (catálogo muda raramente)
- Prefetch em `<Link>` para responsividade tátil$desc$,
  'UI', 'ANY', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST','A11Y_REVIEW'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  'b0133286-95f8-4c4d-af3f-841ba70bb95c',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-066',
  'Renderizar /(public)/catalog/[categorySlug] com lista de subcategorias + preço + visita técnica',
  $desc$## Objetivo
Tela de uma categoria específica mostrando todas as subcategorias ativas (incluindo "Não sei especificar — visita técnica" sempre no final) com preço indicativo (faixa min-max ou "a partir de") e CTA "Selecionar" que leva à tela de solicitação (`/(client)/services/new?subcat=<id>`) — se anônimo, cai em `/login?next=/services/new?subcat=<id>`. Cobre AC #2, #3, #4, #9 da US-010.

## Contexto
Módulo SOLICITACAO. Lê dados via `getCatalog()` (T-061 helper) filtrando por slug. Subcategoria "visita técnica" abre o `VisitaTecnicaSheet` (T-067) ao tocar em "Como funciona?" inline; clicar "Selecionar" leva direto à confirmação no fluxo (US-011 cuida do form completo).

## Estado atual / O que substitui
Não existe — primeira tela de catálogo aprofundado.

## O que criar

### `src/app/(public)/catalog/[categorySlug]/page.tsx`
```tsx
import { notFound } from 'next/navigation';
import { getCatalog } from '@/lib/dal/catalog';
import { SubcategoryList } from '@/components/catalog/SubcategoryList';

export const revalidate = 300;

export default async function CategoryPage({ params }: { params: Promise<{ categorySlug: string }> }) {
  const { categorySlug } = await params;
  const { categories } = await getCatalog();
  const category = categories.find(c => c.slug === categorySlug);
  if (!category) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 pb-12 pt-6">
      <h1 className="text-2xl font-semibold">{category.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Escolha o serviço mais próximo do que você precisa.
      </p>
      <SubcategoryList subcategories={category.subcategories} categorySlug={category.slug} className="mt-6" />
    </main>
  );
}
```

### `src/components/catalog/SubcategoryList.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { VisitaTecnicaSheet } from './VisitaTecnicaSheet';
import { formatPriceRange } from '@/lib/format';

export function SubcategoryList({ subcategories, categorySlug, className }: Props) {
  const router = useRouter();
  const [vtOpen, setVtOpen] = useState(false);

  const handleSelect = (subcatId: string, isVT: boolean) => {
    if (isVT) {
      // Pode abrir VT sheet primeiro com CTA de continuar; AC #5 manda mostrar regra
      setVtOpen(true);
      return;
    }
    router.push(`/(client)/services/new?subcat=${subcatId}`);
  };

  return (
    <>
      <ul className={cn('flex flex-col gap-3', className)}>
        {subcategories.map(s => (
          <Card key={s.id} className="flex items-center justify-between p-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {s.is_virtual_consultation && <Badge variant="secondary">Visita técnica</Badge>}
              </div>
              <span className="text-sm text-muted-foreground">
                {formatPriceRange(s.price_min_cents, s.price_max_cents, s.pricing_basis)}
              </span>
            </div>
            <Button size="sm" onClick={() => handleSelect(s.id, s.is_virtual_consultation)}>
              Selecionar
            </Button>
          </Card>
        ))}
      </ul>
      <VisitaTecnicaSheet open={vtOpen} onOpenChange={setVtOpen} />
    </>
  );
}
```

### `src/lib/format.ts` (extensão — adicionar `formatPriceRange`)
- "R$ 120-200 por visita" / "a partir de R$ 80" / "R$ 25 por m²"

## Constraints / NÃO fazer
- ❌ Form/Field aqui — apenas lista + CTA
- ❌ Buscar prestador disponível nesta tela (vive em US-020)
- ❌ Mostrar dados de profissional aqui
- ❌ `<Sheet>` cru — usar `ResponsiveSheet` via `VisitaTecnicaSheet`
- ❌ `window.confirm` para "tem certeza?" — não há ação destrutiva

## Convenções
- Reuso: `Card`, `Button`, `Badge`, `useRouter` (Next), `ResponsiveSheet` indireto via `VisitaTecnicaSheet`
- Visita técnica fica no fim da lista (T-061 já garante ordenação)
- Redirect de subcategoria para form: querystring `?subcat=<id>`; proxy converte em `/login?next=...` se anônimo
- Mobile-first: lista vertical empilhada$desc$,
  'UI', 'ANY', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '0b292f9a-dcda-4b65-892d-9c48720e7d60',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-067',
  'Renderizar VisitaTecnicaSheet com regra (taxa, abatimento, retenção) lida de app_config',
  $desc$## Objetivo
Bottom-sheet/modal explicando a regra da visita técnica antes do cliente selecioná-la: taxa fixa de deslocamento, abatimento integral se contratar a execução, retenção se recusar. CTA "Continuar" leva à seleção (criação da solicitação com flag virtual_consultation). Cobre AC #5 da US-010.

## Contexto
Módulo SOLICITACAO. Aberto a partir do `SubcategoryList` (T-066) quando cliente toca numa subcat com `is_virtual_consultation = true`. Texto vem de `app_config.public:visita_tecnica` (T-064) — server-fetch via Server Component pai ou client-fetch via SWR no mount. Versão da regra (`version: "v1"`) registrada para futuras invalidações.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/catalog/VisitaTecnicaSheet.tsx`
```tsx
'use client';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { useRouter } from 'next/navigation';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subcategoryId?: string;
  policy: { fixed_fee_cents: number; discount_if_hired: string; retention_if_declined: string; policy_text: string; version: string };
}

export function VisitaTecnicaSheet({ open, onOpenChange, subcategoryId, policy }: Props) {
  const router = useRouter();
  const handleContinue = () => {
    if (!subcategoryId) return;
    router.push(`/(client)/services/new?subcat=${subcategoryId}&vt_policy=${policy.version}`);
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="md">
      <ResponsiveSheet.Header>Como funciona a visita técnica</ResponsiveSheet.Header>
      <ResponsiveSheet.Body>
        <Markdown>{policy.policy_text}</Markdown>
        <ul className="mt-4 space-y-2 text-sm">
          <li>• Taxa fixa: R$ {(policy.fixed_fee_cents / 100).toFixed(2)}</li>
          <li>• Se contratar: {policy.discount_if_hired} de abatimento</li>
          <li>• Se recusar: {policy.retention_if_declined} de retenção</li>
        </ul>
      </ResponsiveSheet.Body>
      <ResponsiveSheet.Footer>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Voltar</Button>
        <Button onClick={handleContinue}>Continuar com visita técnica</Button>
      </ResponsiveSheet.Footer>
    </ResponsiveSheet>
  );
}
```

### Server-side preload (page-level, não na sheet)
- Pai `/(public)/catalog/[categorySlug]/page.tsx` (T-066) faz `getPublicConfig('visita_tecnica')` no servidor e passa via prop para `SubcategoryList`. Sheet recebe `policy` pronto — sem fetch no client.

## Constraints / NÃO fazer
- ❌ `<Dialog>` cru — usar `ResponsiveSheet`
- ❌ Hardcodar texto de regra — vem de `app_config`
- ❌ `dangerouslySetInnerHTML` — usar `<Markdown>` (component existente)
- ❌ Continuar sem `subcategoryId` (vazio quebra UX)

## Convenções
- Reuso: `ResponsiveSheet`, `Button`, `Markdown`
- Versão da policy passa para a tela de solicitação como `vt_policy` query param (audit downstream)
- Mobile: bottom-sheet 90dvh; Desktop: side-sheet 480px ou modal centrado$desc$,
  'UI', 'ANY', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '7ed5beed-d2a9-4ae9-8efa-9457eb7141b0',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-068',
  'Renderizar tour guiado não-bloqueante na home com dismiss e retomar pelo perfil',
  $desc$## Objetivo
Em primeira visita do CLIENTE autenticado, exibir tour guiado não-bloqueante (3-4 passos) sobre a home/catálogo e o fluxo básico de pedido. Cliente pode pular ("Agora não") ou dismissar permanentemente. Estado persistido em `client_tour_state` (T-060). Perfil expõe ação "Ver tour novamente" (US-014). Cobre AC #7 da US-010.

## Contexto
Módulo SOLICITACAO. Tour aparece **só** para CLIENTE autenticado em primeira aparição na home (`/(public)/home` ou `/(client)/home` quando logado). Anônimo não vê tour (sem persistência). Componente `TourLauncher` (montado no `/(public)/home` em T-065) verifica auth via `createBrowserClient` + RPC ou via API helper, depois consulta `client_tour_state` e abre se nunca viu.

## Estado atual / O que substitui
Não existe — primeiro componente de onboarding-UX no produto.

## O que criar

### `src/components/catalog/TourLauncher.tsx`
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTourState } from '@/hooks/use-tour-state';
import { CatalogTour } from './CatalogTour';

export function TourLauncher() {
  const { isAuthenticated, hasSeen, markViewed, markDismissed, markCompleted } = useTourState('home_catalog_v1');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isAuthenticated && hasSeen === false) setOpen(true);
  }, [isAuthenticated, hasSeen]);

  if (!isAuthenticated || hasSeen !== false) return null;
  return (
    <CatalogTour
      open={open}
      onOpenChange={setOpen}
      onView={markViewed}
      onDismiss={markDismissed}
      onComplete={markCompleted}
    />
  );
}
```

### `src/components/catalog/CatalogTour.tsx`
```tsx
'use client';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

const STEPS = [
  { title: 'Bem-vindo!', body: 'Explore as 7 categorias para encontrar o serviço que precisa.' },
  { title: 'Subcategorias e preços', body: 'Cada categoria tem subcategorias com preço indicativo.' },
  { title: 'Visita técnica', body: 'Não sabe o que precisa? Use a opção "Visita técnica" — taxa fixa, abatimento se contratar.' },
  { title: 'Iniciar solicitação', body: 'Selecione a subcategoria, faça login e descreva o serviço.' },
];

export function CatalogTour({ open, onOpenChange, onView, onDismiss, onComplete }: Props) {
  const [step, setStep] = useState(0);
  useEffect(() => { if (open) onView(); }, [open]);

  const last = step === STEPS.length - 1;
  const handleNext = () => last ? (onComplete(), onOpenChange(false)) : setStep(step + 1);
  const handleSkip = () => { onDismiss(); onOpenChange(false); };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialog.Header>{STEPS[step].title}</ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        <p>{STEPS[step].body}</p>
        <div className="mt-4 flex items-center justify-center gap-1">
          {STEPS.map((_, i) => (
            <span key={i} className={cn('size-1.5 rounded-full', i === step ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button variant="ghost" onClick={handleSkip}>Agora não</Button>
        <Button onClick={handleNext}>{last ? 'Começar' : 'Próximo'}</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
```

### `src/hooks/use-tour-state.ts`
```typescript
'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

export function useTourState(tourKey: string) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [hasSeen, setHasSeen] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAuthenticated(false); return; }
      setIsAuthenticated(true);
      const { data } = await supabase.from('client_tour_state').select('viewed_at,completed_at,dismissed_at').eq('user_id', user.id).maybeSingle();
      setHasSeen(!!data);
    })();
  }, []);

  const upsert = async (patch: Record<string, string>) => {
    const supabase = createBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('client_tour_state').upsert({ user_id: user.id, tour_key: tourKey, ...patch });
    setHasSeen(true);
  };

  return {
    isAuthenticated,
    hasSeen,
    markViewed: () => upsert({ viewed_at: new Date().toISOString() }),
    markCompleted: () => upsert({ completed_at: new Date().toISOString() }),
    markDismissed: () => upsert({ dismissed_at: new Date().toISOString() }),
  };
}
```

## Constraints / NÃO fazer
- ❌ Bloquear UI durante tour (banner não-modal sobre conteúdo, não over-overlay)
- ❌ Mostrar tour pra anônimo (sem persistência → infinitos popups)
- ❌ Lib pesada de tour (driver.js, intro.js, shepherd) — implementar inline com `ResponsiveDialog`
- ❌ Persistir em localStorage (perde cross-device)
- ❌ Forçar completar — dismiss é suficiente

## Convenções
- Reuso: `ResponsiveDialog`, `Button`, `createBrowserClient`
- Tour key versionada: `home_catalog_v1` (mudança de copy → bump versão para reaparecer)
- Hook `useTourState` reutilizável para outros tours futuros (perfil, agenda, etc.)$desc$,
  'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '18883143-2ef9-4a40-bf16-6f2893e3a1b9',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  'd2e3ac86-6207-45cc-9390-993abb73fb31',
  'ZLAR-V2-T-069',
  'Renderizar busca de palavra-chave com debounce e dropdown de resultados',
  $desc$## Objetivo
Componente de busca no header da home/categorias: cliente digita palavra-chave, vê dropdown com até 20 subcategorias matching (independente da categoria pai), tap leva direto à subcategoria selecionada (preserva fluxo "selecionou subcat → /services/new"). Cobre AC #8 e AC #9 da US-010.

## Contexto
Módulo SOLICITACAO. Consome `GET /api/catalog/search?q=` (T-062) com debounce de 250ms (`useFieldDebounce`). Renderiza estado vazio (sem resultado), loading (skeleton), erro (toast). Resultado mostra "X em Y" (subcategoria em categoria) para contexto.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/catalog/CatalogSearch.tsx`
```tsx
'use client';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useFieldDebounce } from '@/hooks/use-field-debounce';
import { useRouter } from 'next/navigation';
import { fetchOrThrow } from '@/lib/utils/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';

interface Result {
  subcategory_id: string;
  subcategory_slug: string;
  subcategory_name: string;
  category_slug: string;
  category_name: string;
  is_virtual_consultation: boolean;
}

export function CatalogSearch() {
  const [q, setQ] = useState('');
  const debounced = useFieldDebounce(q, 250);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (debounced.length < 2) { setResults([]); return; }
    setLoading(true);
    fetchOrThrow(`/api/catalog/search?q=${encodeURIComponent(debounced)}`)
      .then(r => r.json())
      .then(d => setResults(d.results ?? []))
      .catch(e => showErrorToast({ type: 'search' }, e))
      .finally(() => setLoading(false));
  }, [debounced]);

  const handleSelect = (r: Result) => {
    router.push(`/(client)/services/new?subcat=${r.subcategory_id}`);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Busque por: torneira, fechadura, montagem..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      {q.length >= 2 && (
        <Card className="absolute z-10 mt-1 w-full max-h-80 overflow-auto p-2">
          {loading && <Skeleton className="h-12 w-full" />}
          {!loading && results.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">Nenhum serviço encontrado para "{debounced}"</p>
          )}
          {results.map(r => (
            <button key={r.subcategory_id} className="flex w-full items-center justify-between rounded p-2 text-left hover:bg-muted" onClick={() => handleSelect(r)}>
              <span>
                <strong>{r.subcategory_name}</strong>
                <span className="ml-2 text-xs text-muted-foreground">em {r.category_name}</span>
              </span>
              {r.is_virtual_consultation && <Badge variant="secondary" className="ml-2">Visita</Badge>}
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}
```

## Constraints / NÃO fazer
- ❌ Form/Field — input livre, sem validação client (Zod só no server, T-062)
- ❌ `setState` direto após fetch sem cancelamento (race em digitação rápida — usar AbortController via `fetchOrThrow`)
- ❌ Lib de combobox externa (downshift, cmdk) para algo simples
- ❌ Mostrar resultados se `q.length < 2` (ruído)
- ❌ Persistir buscas recentes nesta task (vive em iteração futura)

## Convenções
- Reuso: `Input`, `Card`, `Skeleton`, `Badge`, `useFieldDebounce`, `fetchOrThrow`, `showErrorToast`
- Debounce 250ms (memory `project_ui_patterns`)
- Resultado leva direto à `/(client)/services/new?subcat=<id>` — proxy redireciona para login se anônimo
- Mobile: ocupar largura cheia; dropdown abaixo$desc$,
  'UI', 'ANY', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
);

-- =============================================================================
-- 2. Vínculos task → AC-da-Story (TaskAcceptanceCriterion)
-- =============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-059 cobre AC 1, 2, 3, 4
  ('8554293b-392d-4b05-a672-c4ee7f984c40'::uuid, 1),
  ('8554293b-392d-4b05-a672-c4ee7f984c40'::uuid, 2),
  ('8554293b-392d-4b05-a672-c4ee7f984c40'::uuid, 3),
  ('8554293b-392d-4b05-a672-c4ee7f984c40'::uuid, 4),

  -- T-060 cobre AC 7
  ('40b3d372-395c-4959-acc0-17f3ef0ae72c'::uuid, 7),

  -- T-061 cobre AC 1, 2, 3, 4
  ('004c03c3-b36d-4425-a2c7-68ec738993b0'::uuid, 1),
  ('004c03c3-b36d-4425-a2c7-68ec738993b0'::uuid, 2),
  ('004c03c3-b36d-4425-a2c7-68ec738993b0'::uuid, 3),
  ('004c03c3-b36d-4425-a2c7-68ec738993b0'::uuid, 4),

  -- T-062 cobre AC 8
  ('b8d75a54-f43c-4c87-9abb-d2446f465e87'::uuid, 8),

  -- T-063 cobre AC 6
  ('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3'::uuid, 6),

  -- T-064 cobre AC 5
  ('70c81687-43c2-4d0f-acd7-d66c67dbd5a4'::uuid, 5),

  -- T-065 cobre AC 1, 6
  ('b3075839-5381-4e33-82c9-4dc2b08da97a'::uuid, 1),
  ('b3075839-5381-4e33-82c9-4dc2b08da97a'::uuid, 6),

  -- T-066 cobre AC 2, 3, 4, 9
  ('b0133286-95f8-4c4d-af3f-841ba70bb95c'::uuid, 2),
  ('b0133286-95f8-4c4d-af3f-841ba70bb95c'::uuid, 3),
  ('b0133286-95f8-4c4d-af3f-841ba70bb95c'::uuid, 4),
  ('b0133286-95f8-4c4d-af3f-841ba70bb95c'::uuid, 9),

  -- T-067 cobre AC 5
  ('0b292f9a-dcda-4b65-892d-9c48720e7d60'::uuid, 5),

  -- T-068 cobre AC 7
  ('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0'::uuid, 7),

  -- T-069 cobre AC 8, 9
  ('18883143-2ef9-4a40-bf16-6f2893e3a1b9'::uuid, 8),
  ('18883143-2ef9-4a40-bf16-6f2893e3a1b9'::uuid, 9)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- =============================================================================
-- 3. AC-da-Task (checklist técnico → checkbox no TaskSheet)
-- =============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
-- T-059
('8554293b-392d-4b05-a672-c4ee7f984c40', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('8554293b-392d-4b05-a672-c4ee7f984c40', 'service_categories reconciliada: 7 slugs ativos batem com US-010 (eletrica, encanamento, limpeza, montagem, pintura, climatizacao, pequenos_reparos)', 1),
('8554293b-392d-4b05-a672-c4ee7f984c40', 'service_subcategories estendida com price_min_cents, price_max_cents, pricing_basis, is_virtual_consultation (CHECK constraints ativas)', 2),
('8554293b-392d-4b05-a672-c4ee7f984c40', 'CHECK subcat_price_range impede price_min > price_max (smoke: violation retorna erro)', 3),
('8554293b-392d-4b05-a672-c4ee7f984c40', 'Cada categoria ativa tem 1 subcategoria com is_virtual_consultation=true (índice único parcial)', 4),
('8554293b-392d-4b05-a672-c4ee7f984c40', 'Categorias antigas (reformas, hidraulica, jardinagem, mudancas, beleza) marcadas active=false sem DELETE', 5),
('8554293b-392d-4b05-a672-c4ee7f984c40', 'Anon SELECT em service_categories e service_subcategories continua retornando linhas active=true (RLS preservada)', 6),
('8554293b-392d-4b05-a672-c4ee7f984c40', 'Subcategorias seedadas com pricing_basis válido (per_visit/per_hour/per_unit/from)', 7),

-- T-060
('40b3d372-395c-4959-acc0-17f3ef0ae72c', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('40b3d372-395c-4959-acc0-17f3ef0ae72c', 'Tabela client_tour_state criada com PK = user_id e CHECK exigindo pelo menos 1 timestamp', 1),
('40b3d372-395c-4959-acc0-17f3ef0ae72c', 'RLS: cliente A não lê linha do cliente B (smoke via dois JWTs distintos)', 2),
('40b3d372-395c-4959-acc0-17f3ef0ae72c', 'CLIENTE consegue INSERT/UPDATE/DELETE na própria linha (smoke)', 3),
('40b3d372-395c-4959-acc0-17f3ef0ae72c', 'Admin via claim app_metadata.role=admin lê todas as linhas', 4),
('40b3d372-395c-4959-acc0-17f3ef0ae72c', 'Trigger moddatetime atualiza updatedAt em UPDATE', 5),

-- T-061
('004c03c3-b36d-4425-a2c7-68ec738993b0', 'GET /api/catalog retorna 200 sem auth (anon)', 0),
('004c03c3-b36d-4425-a2c7-68ec738993b0', 'Resposta inclui 7 categorias ativas com subcategorias aninhadas (price_min_cents, price_max_cents, pricing_basis, is_virtual_consultation)', 1),
('004c03c3-b36d-4425-a2c7-68ec738993b0', 'Subcategoria visita técnica sempre aparece no fim de cada categoria', 2),
('004c03c3-b36d-4425-a2c7-68ec738993b0', 'Cache-Control com s-maxage=300 e stale-while-revalidate=60 presente no header', 3),
('004c03c3-b36d-4425-a2c7-68ec738993b0', 'Helper getCatalog() exportado de src/lib/dal/catalog.ts e reusado por Server Components', 4),
('004c03c3-b36d-4425-a2c7-68ec738993b0', 'Falha de DB retorna 502 com payload { error: "catalog_unavailable" }', 5),

-- T-062
('b8d75a54-f43c-4c87-9abb-d2446f465e87', 'Migration aplicada (extensions unaccent + pg_trgm + RPC search_catalog)', 0),
('b8d75a54-f43c-4c87-9abb-d2446f465e87', 'GET /api/catalog/search?q=tor retorna subcats com "torneira" mesmo sem acento', 1),
('b8d75a54-f43c-4c87-9abb-d2446f465e87', 'Busca por nome de categoria pai (ex: q=eletric) retorna subcats da Elétrica', 2),
('b8d75a54-f43c-4c87-9abb-d2446f465e87', 'Resposta limitada a 20 itens, ordenada por similarity desc', 3),
('b8d75a54-f43c-4c87-9abb-d2446f465e87', 'q.length < 2 retorna { results: [] } sem 400', 4),
('b8d75a54-f43c-4c87-9abb-d2446f465e87', 'q.length > 50 retorna { results: [] } (Zod safeParse bloqueia)', 5),
('b8d75a54-f43c-4c87-9abb-d2446f465e87', 'Endpoint funciona sem auth (RLS pública via SECURITY INVOKER)', 6),

-- T-063
('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'PUBLIC_PREFIXES inclui /(public)/home, /(public)/catalog, /api/catalog', 0),
('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'Anônimo acessa /(public)/home sem redirect (smoke via curl sem cookie)', 1),
('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'Anônimo tentando /(client)/services/new é redirecionado para /login?next=...', 2),
('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'Após login, route-state lê query next e empurra cliente para destino', 3),
('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'Guards de KYC/suspensão (T-019, T-041) continuam ativos para rotas operacionais (regressão zero)', 4),

-- T-064
('70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'Linha public:visita_tecnica em app_config com fixed_fee_cents, discount_if_hired, retention_if_declined, policy_text, version', 1),
('70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'Anon consegue SELECT de chaves prefixadas com public:* (RLS anon_select_public_keys)', 2),
('70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'Anon NÃO lê chaves sem prefixo public: (smoke retorna 0 linhas)', 3),
('70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'Helper getPublicConfig() em src/lib/dal/app-config.ts retorna value parseado', 4),
('70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'Apenas admin consegue UPDATE (smoke com claim role=admin vs role=user)', 5),

-- T-065
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'Página /(public)/home renderiza grade com 7 categorias ativas (sem auth)', 0),
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'Cada card mostra nome + ícone do lucide-react mapeado por slug', 1),
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'Tap em categoria navega para /(public)/catalog/[categorySlug] (Link prefetch)', 2),
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'Layout responsivo: 2 cols < 640px, 3 cols 640-768px, 4 cols >= 768px', 3),
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'Reusa Card do design system (sem componente novo)', 4),
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'Server Component (sem use client na page) — fetch via getCatalog() server helper', 5),
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'Header inclui CatalogSearch e TourLauncher montados', 6),
('b3075839-5381-4e33-82c9-4dc2b08da97a', '(client)/page.tsx (T-058) movida para (client)/dashboard como rota autenticada', 7),

-- T-066
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Página /(public)/catalog/[categorySlug] renderiza nome da categoria + lista vertical de subcategorias', 0),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Cada subcategoria mostra nome, faixa de preço (formatPriceRange) e badge "Visita técnica" quando aplicável', 1),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Subcategoria visita técnica sempre aparece no fim da lista', 2),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Tap em "Selecionar" subcategoria normal redireciona para /(client)/services/new?subcat=<id>', 3),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Tap em "Selecionar" subcategoria visita técnica abre VisitaTecnicaSheet (T-067) primeiro', 4),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Slug inválido cai em notFound() (404)', 5),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Helper formatPriceRange adicionado em src/lib/format.ts (R$ X-Y por basis | a partir de R$ X)', 6),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'Reusa Card, Button, Badge, ResponsiveSheet (via VisitaTecnicaSheet)', 7),

-- T-067
('0b292f9a-dcda-4b65-892d-9c48720e7d60', 'Sheet abre com texto da regra vindo de app_config.public:visita_tecnica (não hardcoded)', 0),
('0b292f9a-dcda-4b65-892d-9c48720e7d60', 'Mostra fixed_fee formatado (R$ X,XX), discount_if_hired e retention_if_declined', 1),
('0b292f9a-dcda-4b65-892d-9c48720e7d60', 'CTA "Continuar" leva a /(client)/services/new?subcat=<id>&vt_policy=<version>', 2),
('0b292f9a-dcda-4b65-892d-9c48720e7d60', 'CTA "Voltar" fecha sheet sem efeito colateral', 3),
('0b292f9a-dcda-4b65-892d-9c48720e7d60', 'Mobile: bottom-sheet 90dvh; Desktop: side-sheet/modal centrado (via ResponsiveSheet)', 4),
('0b292f9a-dcda-4b65-892d-9c48720e7d60', 'Texto markdown renderizado via componente Markdown (sem dangerouslySetInnerHTML)', 5),

-- T-068
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', 'Tour aparece em primeira visita autenticada (CLIENTE) na home', 0),
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', 'Anônimo NÃO vê tour (sem persistência)', 1),
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', '"Agora não" persiste dismissed_at e não reaparece em sessões futuras', 2),
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', '"Começar" no último passo persiste completed_at', 3),
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', 'Tour é não-bloqueante (fecha com X / fora) e não trava interação na home', 4),
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', 'Indicador de progresso (dots) reflete passo atual de 4', 5),
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', 'Hook useTourState reusável para tours futuros (parametrizado por tour_key)', 6),
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', 'Reset via DELETE em client_tour_state (a ser exposto no perfil em US-014) reabre tour', 7),

-- T-069
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'Input com debounce 250ms via useFieldDebounce (sem fetch a cada keystroke)', 0),
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'q.length >= 2 dispara fetch para /api/catalog/search', 1),
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'Skeleton durante fetch; estado vazio com mensagem clara quando 0 resultados', 2),
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'Cada resultado mostra "subcat_name em category_name" e badge Visita quando aplicável', 3),
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'Tap em resultado leva a /(client)/services/new?subcat=<id> (proxy redireciona se anônimo)', 4),
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'Erro de rede vira showErrorToast (sem alert nativo)', 5),
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'AbortController cancela request anterior em digitação rápida (sem race)', 6),
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'Reusa Input, Card, Skeleton, Badge, useFieldDebounce, fetchOrThrow, showErrorToast', 7);

-- =============================================================================
-- 4. Dependências (TaskDependency, kind lowercase)
-- =============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- T-061 (GET /api/catalog) precisa do schema reseedado
('004c03c3-b36d-4425-a2c7-68ec738993b0', '8554293b-392d-4b05-a672-c4ee7f984c40', 'blocks'),
-- T-062 (search) idem
('b8d75a54-f43c-4c87-9abb-d2446f465e87', '8554293b-392d-4b05-a672-c4ee7f984c40', 'blocks'),
-- T-064 (config visita técnica) é alvo de leitura
-- T-065 (home) consome T-061 + tour T-068 + busca T-069
('b3075839-5381-4e33-82c9-4dc2b08da97a', '004c03c3-b36d-4425-a2c7-68ec738993b0', 'blocks'),
('b3075839-5381-4e33-82c9-4dc2b08da97a', '7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', 'relates_to'),
('b3075839-5381-4e33-82c9-4dc2b08da97a', '18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'relates_to'),
-- T-066 (categoria) consome T-061 + T-067 (visita técnica sheet)
('b0133286-95f8-4c4d-af3f-841ba70bb95c', '004c03c3-b36d-4425-a2c7-68ec738993b0', 'blocks'),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', '0b292f9a-dcda-4b65-892d-9c48720e7d60', 'blocks'),
('b0133286-95f8-4c4d-af3f-841ba70bb95c', 'cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'blocks'),
-- T-067 (sheet visita técnica) precisa do config seedado
('0b292f9a-dcda-4b65-892d-9c48720e7d60', '70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'blocks'),
-- T-068 (tour) precisa da tabela tour_state
('7ed5beed-d2a9-4ae9-8efa-9457eb7141b0', '40b3d372-395c-4959-acc0-17f3ef0ae72c', 'blocks'),
-- T-069 (busca) precisa do endpoint de search
('18883143-2ef9-4a40-bf16-6f2893e3a1b9', 'b8d75a54-f43c-4c87-9abb-d2446f465e87', 'blocks'),
-- Cross-US: T-063 (proxy) referencia T-019/T-041 (proxy guards já existentes em ONBOARDING)
('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', '058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'relates_to'),  -- T-019 proxy guard
('cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'c48bf57a-d271-4bc1-b3ea-09f2473ebc72', 'relates_to'),  -- T-041 proxy guard
-- T-065 substitui T-058 (home placeholder) → relates_to
('b3075839-5381-4e33-82c9-4dc2b08da97a', 'a3d9b48c-bc44-4df7-9018-0ed01e863c0f', 'relates_to'),  -- T-058
-- T-059 expande T-001 (catálogo seedado) → relates_to
('8554293b-392d-4b05-a672-c4ee7f984c40', '78ced729-7fd7-4c24-a1f5-9445533b8244', 'relates_to');  -- T-001

COMMIT;
