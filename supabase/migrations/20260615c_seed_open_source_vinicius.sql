-- ═══════════════════════════════════════════════════════════
-- Seed: ARQUIVO #001 — Vinícius Aguilar
--
-- Card inicial de Open Source (conteúdo do design original).
-- A foto é enviada depois por um admin via o uploader do form
-- (bucket open-source-photos), por isso photoStoragePath fica NULL.
-- Idempotente via ON CONFLICT no archiveNumber.
-- ═══════════════════════════════════════════════════════════

INSERT INTO "OpenSourceCard" (
  "archiveNumber",
  category,
  name,
  title,
  tags,
  quote,
  "quoteAttribution",
  "humanFacts",
  "builderFacts",
  "callMeFor",
  chat,
  "truthsAndLie",
  soundtrack,
  "displayOrder"
) VALUES (
  1,
  'ENDOMARKETING',
  'Vinícius Aguilar',
  'Product Builder',
  ARRAY['Claude Code','Codex','Cursor','Full-stack','GCP','Campinas-SP']::text[],
  'Acredito que impactos são gerados por meio de ousadia e criatividade, e sinto que a programação e a tecnologia me empoderam a fazer isso de uma forma que nenhuma outra coisa faz.',
  'VINÍCIUS AGUILAR',
  '[
    {"label":"hobby","value":"Futevôlei"},
    {"label":"comida que não dispensa","value":"Carbonara"},
    {"label":"série no momento","value":"Neymar: O Caos Perfeito"}
  ]'::jsonb,
  '[
    {"label":"último agente construído","value":"Sincronizador de atividades do Linear"},
    {"label":"o que jamais delegaria","value":"Honestamente? Eu delegaria tudo pra IA."}
  ]'::jsonb,
  ARRAY['jogar conversa fora','criação de agentes','automação de tasks','esteira agêntica']::text[],
  '[
    {"question":"Por que você escolheu essa profissão?","answer":"Não foi planejado — foi surgindo enquanto eu resolvia problemas com automação. Comecei como dev, mas percebi que a maior oportunidade estava na interseção entre produto e IA: construir soluções que mudam a forma como as pessoas trabalham. É isso que me move."},
    {"question":"Viagem dos sonhos?","answer":"Paraguai com os amigos."},
    {"question":"Um ídolo?","answer":"Neymar e Vinícius Guedes."}
  ]'::jsonb,
  ARRAY[
    'Já quase morri afogado — e quem me salvou foi o meu chefe.',
    'Já fui campeão da olimpíada de matemática regional.',
    'Joguei CounterStrike 2 profissionalmente, mas tive que parar pra focar no trabalho.'
  ]::text[],
  '[
    {"title":"We Are One (Ole Ola)","artist":"Pitbull, J.Lo & Claudia Leitte"},
    {"title":"Só Falta Você","artist":"Jorge & Mateus"},
    {"title":"Avisa Aí","artist":"Henrique & Juliano"}
  ]'::jsonb,
  1
)
ON CONFLICT ("archiveNumber") DO NOTHING;
