/**
 * Skill towers + subskills used in the Member self-assessment.
 *
 * A Member fills a level 0-5 per tower and marks subskills inside
 * each tower with one of three states: "none" (default), "knows",
 * or "ref" (reference). Persisted as one MemberSkill row per
 * (memberId, towerKey), with subskills stored as a JSONB map
 * { "<subskillKey>": "knows" | "ref" }.
 */

// ─── Score (0-100) ───────────────────────────────────────

/**
 * Score is computed deterministically from subskill marks:
 *   knows_pts = knows_count × 1
 *   ref_pts   = ref_count   × REF_WEIGHT
 *   score     = round((knows_pts + ref_pts) / (REF_WEIGHT × total_subs) × 100)
 *
 * REF_WEIGHT = 1.5 — "ref" is the peak (you mentor others) but
 * "knows" already implies real usage, not half of ref.
 */
export const REF_WEIGHT = 1.5;

/**
 * Bands used to label a numeric score. Inclusive bounds.
 * Order matters: scan from highest to lowest.
 */
export const SCORE_BANDS = [
  { min: 95, label: "Elite", tone: "elite" },
  { min: 85, label: "Referência", tone: "high" },
  { min: 70, label: "Avançado", tone: "high" },
  { min: 50, label: "Autônomo", tone: "mid" },
  { min: 30, label: "Em desenvolvimento", tone: "low" },
  { min: 10, label: "Aprendiz", tone: "low" },
  { min: 0, label: "Não atua", tone: "none" },
] as const;

export type ScoreBandTone = (typeof SCORE_BANDS)[number]["tone"];

export function scoreLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return "—";
  for (const band of SCORE_BANDS) {
    if (score >= band.min) return band.label;
  }
  return "—";
}

export function scoreBandTone(score: number | null | undefined): ScoreBandTone {
  if (score === null || score === undefined) return "none";
  for (const band of SCORE_BANDS) {
    if (score >= band.min) return band.tone;
  }
  return "none";
}

/**
 * Deterministic score from subskill marks for a single tower.
 * Pure function — same input, same output. Always.
 */
export function computeScore(
  subskills: SubskillMap,
  totalSubskills: number,
): number {
  if (totalSubskills <= 0) return 0;
  let knows = 0;
  let ref = 0;
  for (const v of Object.values(subskills ?? {})) {
    if (v === "knows") knows++;
    else if (v === "ref") ref++;
  }
  const earned = knows + ref * REF_WEIGHT;
  const max = totalSubskills * REF_WEIGHT;
  return Math.round((earned / max) * 100);
}

// ─── Subskill states ─────────────────────────────────────

export const SUBSKILL_STATES = ["none", "knows", "ref"] as const;
export type SubskillState = (typeof SUBSKILL_STATES)[number];

export const SUBSKILL_STATE_LABELS: Record<SubskillState, string> = {
  none: "Não conheço",
  knows: "Sei usar",
  ref: "Sou referência",
};

/** Subskills map stored in MemberSkill.subskills (JSONB). */
export type SubskillMap = Record<string, Exclude<SubskillState, "none">>;

// ─── Towers ──────────────────────────────────────────────

export type Subskill = {
  key: string;
  label: string;
};

export type Tower = {
  key: string;
  label: string;
  summary: string;
  /** Lucide icon name — resolved at render time. */
  icon: string;
  subskills: Subskill[];
};

export const TOWERS = [
  {
    key: "frontend",
    label: "Frontend",
    summary: "Implementa as telas: React, estado, performance, acessibilidade.",
    icon: "Layout",
    subskills: [
      { key: "react-next", label: "React / Next.js (RSC, hooks, layouts)" },
      { key: "tailwind-ds", label: "Tailwind + sistema de design" },
      { key: "state-data", label: "Estado e dados (TanStack Query, Zustand)" },
      { key: "forms", label: "Forms e validação (zod, react-hook-form)" },
      { key: "perf", label: "Performance (Suspense, streaming, lazy, bundle)" },
      { key: "a11y", label: "Acessibilidade (semântica, ARIA, foco, contraste)" },
      { key: "motion", label: "Animações e microinterações" },
      { key: "ts-advanced", label: "TypeScript avançado (genéricos, narrowing)" },
      { key: "component-tests", label: "Testes de componente (Vitest, RTL)" },
      { key: "routing", label: "Roteamento e navegação (App Router, middleware)" },
      { key: "i18n", label: "Internacionalização (i18n, locales)" },
      { key: "seo", label: "SEO técnico (metadata, OG, sitemap)" },
    ],
  },
  {
    key: "ux-ui",
    label: "UX / UI",
    summary: "Pesquisa, fluxos, prototipagem e design system.",
    icon: "Palette",
    subskills: [
      { key: "research", label: "Pesquisa com usuário (entrevistas, JTBD)" },
      { key: "flows", label: "Fluxos e jornadas" },
      { key: "figma", label: "Prototipagem em Figma" },
      { key: "design-system", label: "Design system (tokens, componentes, hierarquia)" },
      { key: "heuristics", label: "Heurísticas (Nielsen, leis de UX)" },
      { key: "microcopy", label: "Microcopy e tom de voz" },
      { key: "usability", label: "Testes de usabilidade" },
      { key: "wireframing", label: "Wireframing rápido (lo-fi, sketch)" },
      { key: "handoff", label: "Hand-off com dev (specs, anotações)" },
      { key: "benchmark", label: "Análise de concorrentes / benchmark" },
      { key: "design-a11y", label: "Acessibilidade no design (contraste, alvo, ordem)" },
    ],
  },
  {
    key: "backend",
    label: "Backend",
    summary: "APIs, servidor, auth e edge functions.",
    icon: "Server",
    subskills: [
      { key: "supabase", label: "Supabase (Auth, Storage, Realtime)" },
      { key: "rls", label: "RLS e policies" },
      { key: "edge-functions", label: "Edge Functions" },
      { key: "postgres", label: "Postgres (joins, índices, plano de execução)" },
      { key: "jobs", label: "Triggers, cron, jobs" },
      { key: "api-design", label: "API design (REST, contratos, versionamento)" },
      { key: "secrets", label: "Gestão de secrets e ambientes" },
      { key: "caching", label: "Caching (Redis, query cache, edge cache)" },
      { key: "outgoing-webhooks", label: "Webhooks emitidos (assinatura, retry)" },
      { key: "queues", label: "Background jobs (queues, workers)" },
      { key: "logging", label: "Logging server-side estruturado" },
    ],
  },
  {
    key: "data-architecture",
    label: "Arquitetura de dados",
    summary: "Modelagem, schemas, migrations, eventos.",
    icon: "Database",
    subskills: [
      { key: "relational", label: "Modelagem relacional (chaves, normalização)" },
      { key: "schema", label: "Desenho de schema (entidades, relações, constraints)" },
      { key: "migrations", label: "Migrations e versionamento de schema" },
      { key: "indexing", label: "Indexação estratégica e plano de execução" },
      { key: "etl", label: "Pipelines de ETL / sincronização entre sistemas" },
      { key: "events", label: "Modelagem de eventos (CDC, event sourcing)" },
      { key: "analytical", label: "Modelagem analítica (fato/dimensão)" },
      { key: "partitioning", label: "Particionamento e sharding" },
      { key: "audit", label: "Soft delete, auditoria e histórico" },
      { key: "multi-tenant", label: "Multi-tenancy (RLS por tenant, schema per tenant)" },
      { key: "retention", label: "Data retention e LGPD/GDPR" },
    ],
  },
  {
    key: "infra",
    label: "Infra & DevOps",
    summary: "Deploy, CI/CD, observabilidade, IaC.",
    icon: "Cloud",
    subskills: [
      { key: "deploy", label: "Deploy e CI/CD (Cloud Build, Vercel)" },
      { key: "containers", label: "Containers / Docker" },
      { key: "observability", label: "Observabilidade (logs, traces, alertas)" },
      { key: "iac", label: "IaC (Terraform, Pulumi)" },
      { key: "cost", label: "Custos e sizing em cloud" },
      { key: "dr", label: "Backup, rollback, DR" },
      { key: "dns-cdn", label: "DNS, CDN e edge networking" },
      { key: "tls", label: "TLS, certificados e mTLS" },
      { key: "vault", label: "Secrets manager (rotação, vault)" },
      { key: "perf-budget", label: "Performance budget (TTFB, p95)" },
    ],
  },
  {
    key: "qa",
    label: "QA",
    summary: "Estratégia e execução de testes.",
    icon: "ShieldCheck",
    subskills: [
      { key: "unit", label: "Testes unitários" },
      { key: "e2e", label: "Integração e E2E (Playwright/Cypress)" },
      { key: "strategy", label: "Estratégia de teste / pirâmide" },
      { key: "triage", label: "Bug triage e repro mínimo" },
      { key: "acceptance", label: "Validação contra critérios de aceite" },
      { key: "perf", label: "Performance / load testing" },
      { key: "a11y-auto", label: "A11y automatizado" },
      { key: "contract", label: "Testes de contrato (API, schema)" },
      { key: "snapshot", label: "Snapshot / visual regression" },
      { key: "fixtures", label: "Test data management (fixtures, seeds)" },
      { key: "shift-left", label: "Pair-test com dev (shift-left)" },
    ],
  },
  {
    key: "security",
    label: "Security",
    summary: "Mapa de ataque, pentest, hardening.",
    icon: "Lock",
    subskills: [
      { key: "owasp", label: "OWASP Top 10" },
      { key: "auth-audit", label: "Auditoria de auth/authz e RLS" },
      { key: "pentest", label: "Pentest manual + automatizado" },
      { key: "secrets-mgmt", label: "Gestão e rotação de secrets" },
      { key: "threat-model", label: "Threat modeling" },
      { key: "deps", label: "Análise de dependências (CVEs)" },
      { key: "privacy", label: "LGPD/GDPR e privacidade" },
      { key: "headers", label: "Hardening de headers (CSP, HSTS)" },
      { key: "anomaly", label: "Logging e detecção de anomalia" },
      { key: "incident", label: "Resposta a incidente" },
    ],
  },
  {
    key: "agents",
    label: "Criação de agentes",
    summary: "LLMs, prompt engineering, tools, RAG, eval.",
    icon: "Bot",
    subskills: [
      { key: "prompt-eng", label: "Prompt engineering (estrutura, few-shot, role)" },
      { key: "tool-calling", label: "Tool calling / function calling" },
      { key: "sdks", label: "AI SDK + SDKs Anthropic/OpenAI" },
      { key: "rag", label: "RAG (embeddings, retrieval, reranking)" },
      { key: "memory", label: "Memória de agente (curto e longo prazo)" },
      { key: "eval", label: "Eval (golden sets, regressão de prompt)" },
      { key: "multi-agent", label: "Orquestração multi-agente" },
      { key: "guardrails", label: "Guardrails (validação de input/output)" },
      { key: "cost-model", label: "Custo e seleção de modelo" },
      { key: "agent-docs", label: "Documentação técnica de agentes" },
      { key: "streaming", label: "Streaming de respostas (UI realtime)" },
      { key: "agent-obs", label: "Observabilidade de agente (traces, custo, latência)" },
      { key: "fine-tune", label: "Fine-tuning / DPO / customização" },
      { key: "vector-db", label: "Vector DBs (Pinecone, pgvector, Qdrant)" },
    ],
  },
  {
    key: "automations",
    label: "Automações & Integrações",
    summary: "Workflows, webhooks, APIs externas, scripts de cola.",
    icon: "Workflow",
    subskills: [
      { key: "n8n", label: "n8n / Make / Zapier" },
      { key: "glue-scripts", label: "Scripts de cola (Node, Python)" },
      { key: "webhooks", label: "Webhooks (assinar, validar, retry)" },
      { key: "schedulers", label: "Schedulers (cron, queues)" },
      { key: "rest", label: "REST APIs (verbos, status, payloads)" },
      { key: "external-auth", label: "Auth externo (OAuth, API key, Bearer)" },
      { key: "idempotency", label: "Idempotência, retry, backoff" },
      { key: "rate-limit", label: "Rate limit e paginação" },
      { key: "graphql", label: "GraphQL (queries, mutations, subscriptions)" },
      { key: "composio-mcp", label: "Composio / MCP / function bridges" },
      { key: "email", label: "Email (transactional, parsing, IMAP)" },
      { key: "ipaas", label: "iPaaS / event bus (Kafka, EventBridge)" },
    ],
  },
  {
    key: "project-mgmt",
    label: "Gestão de projetos",
    summary: "Planejamento, comunicação, risco, delivery.",
    icon: "ClipboardList",
    subskills: [
      { key: "planning", label: "Planejamento de sprint e roadmap" },
      { key: "stakeholder", label: "Comunicação com cliente / stakeholder" },
      { key: "risk", label: "Gestão de risco e bloqueios" },
      { key: "estimation", label: "Estimativa (FP, story points, t-shirt)" },
      { key: "facilitation", label: "Facilitação (planning, daily, retro)" },
      { key: "decisions", label: "Documentação de decisão (ADR, RFC)" },
      { key: "scope", label: "Gestão de escopo e prazo" },
      { key: "metrics", label: "Métricas de delivery (velocity, throughput, lead time)" },
      { key: "onboarding", label: "Onboarding e capacitação de pessoas" },
      { key: "negotiation", label: "Negociação e contratos" },
      { key: "conflict", label: "Gestão de conflito no time" },
      { key: "discovery", label: "Discovery / definição de requisitos" },
      { key: "status-report", label: "Status report e visibilidade pra liderança" },
    ],
  },
] as const satisfies readonly Tower[];

export type TowerKey = (typeof TOWERS)[number]["key"];

export const TOWER_KEYS: TowerKey[] = TOWERS.map((t) => t.key);

// ─── Helpers ─────────────────────────────────────────────

export function getTower(key: string): Tower | undefined {
  return TOWERS.find((t) => t.key === key);
}

export function towerLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return getTower(key)?.label ?? key;
}

export function subskillLabel(towerKey: string, subskillKey: string): string {
  const tower = getTower(towerKey);
  return tower?.subskills.find((s) => s.key === subskillKey)?.label ?? subskillKey;
}

/** Cycle a subskill state on click: none → knows → ref → none. */
export function cycleSubskillState(state: SubskillState | undefined): SubskillState {
  switch (state) {
    case "knows":
      return "ref";
    case "ref":
      return "none";
    default:
      return "knows";
  }
}

// ─── Derived signals for the member card ─────────────────

export type MemberSkillRow = {
  towerKey: string;
  /** Score 0-100, computed deterministically. Null only for empty rows. */
  score: number | null;
  subskills: SubskillMap;
  /** Free-text practical cases (kept for future PDI agent context). */
  cases?: string | null;
};

/** Fullstack badge: Frontend ≥ 70 AND Backend ≥ 70. */
export function isFullstack(skills: MemberSkillRow[]): boolean {
  const frontend = skills.find((s) => s.towerKey === "frontend")?.score ?? 0;
  const backend = skills.find((s) => s.towerKey === "backend")?.score ?? 0;
  return frontend >= 70 && backend >= 70;
}

/**
 * Primary tower = highest score.
 * Secondary tower = next highest with score ≥ 50, distinct from primary.
 */
export function derivePrimaryTowers(
  skills: MemberSkillRow[],
): { primary: TowerKey | null; secondary: TowerKey | null } {
  const ordered = TOWER_KEYS.map((key) => {
    const row = skills.find((s) => s.towerKey === key);
    return { key, score: row?.score ?? 0 };
  }).sort((a, b) => b.score - a.score);

  const primary = (ordered[0]?.score ?? 0) >= 10 ? ordered[0].key : null;
  const secondary =
    ordered[1] && ordered[1].score >= 50 && ordered[1].key !== primary
      ? ordered[1].key
      : null;

  return { primary, secondary };
}

/** Number of towers the member has answered (subskill marked or cases written). */
export function assessmentProgress(skills: MemberSkillRow[]): {
  answered: number;
  total: number;
} {
  const answered = skills.filter(
    (s) => Object.keys(s.subskills ?? {}).length > 0 || (s.cases && s.cases.trim().length > 0),
  ).length;
  return { answered, total: TOWERS.length };
}

/** Subskills the member marked as "ref" across all towers (for the card chips). */
export function referenceSubskills(
  skills: MemberSkillRow[],
): { towerKey: string; subskillKey: string }[] {
  const out: { towerKey: string; subskillKey: string }[] = [];
  for (const s of skills) {
    for (const [subKey, state] of Object.entries(s.subskills ?? {})) {
      if (state === "ref") out.push({ towerKey: s.towerKey, subskillKey: subKey });
    }
  }
  return out;
}

/** Has the member earned a non-zero score in at least one tower? */
export function hasEvaluation(skills: MemberSkillRow[]): boolean {
  return skills.some((s) => (s.score ?? 0) > 0);
}
