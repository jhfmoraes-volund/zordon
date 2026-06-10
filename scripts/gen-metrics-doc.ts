/**
 * gen-metrics-doc.ts — regenera docs/features/overview/stats-dictionary.md a
 * partir do METRIC_REGISTRY (src/lib/metrics/registry.ts).
 *
 * D1: o registry TS é o SSOT; o markdown é artefato gerado — NUNCA editar à
 * mão. Rodar após qualquer mudança no registry e commitar o doc junto:
 *
 *   npx tsx scripts/gen-metrics-doc.ts
 *
 * O script é determinístico (idempotente): mesma entrada → mesmo arquivo.
 * Valida que toda métrica do registry aparece em exatamente uma seção.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { METRIC_REGISTRY, getMetricDef } from "../src/lib/metrics/registry";
import type { MetricDef } from "../src/lib/metrics/types";

const OUT_PATH = resolve(__dirname, "../docs/features/overview/stats-dictionary.md");

type Section = { title: string; intro?: string; ids: string[]; outro?: string };

const SECTIONS: Section[] = [
  {
    title: "PRAZO (calendário — independe de alguém criar sprint)",
    ids: ["project.sprints_total", "project.sprints_elapsed", "project.time_pct"],
    outro:
      'Só existe em `fixed_scope` com datas (`mode: "contract"`). Contínuos não têm\n' +
      'prazo — fingir que há seria indefensável; viram `mode: "rolling"` (janela das\n' +
      "últimas 8 sprints).",
  },
  {
    title: "ENTREGA (produção — o que de fato saiu)",
    ids: ["project.sprints_closed", "project.done_pct", "project.holes", "project.scope_pct"],
  },
  {
    title: "RITMO (o motor — e pra onde a trajetória aponta)",
    ids: [
      "project.avg_fp_per_sprint",
      "project.utilization",
      "project.pace_gap",
      "project.projected_end_sprint",
    ],
  },
  {
    title: "CAPACIDADE & ALOCAÇÃO (builder e squad)",
    intro:
      "Quanto da capacidade alocada vira entrega — por builder, por squad. Fonte:\n" +
      "views `sprint_member_capacity` e `member_commitment_overview` via\n" +
      "`src/lib/dal/capacity.ts`.",
    ids: ["member.utilization", "member.committed_vs_capacity", "squad.utilization"],
  },
  {
    title: "FÁBRICA (o agregado — ribbon do topo)",
    ids: [
      "factory.utilization",
      "factory.builders_allocated",
      "factory.lines_active",
      "factory.clients_active",
    ],
  },
];

function thresholdLine(def: MetricDef): string {
  if (!def.thresholds?.length) return "";
  const bands = def.thresholds
    .map((t) => (t.gte === null ? `abaixo: ${t.label}` : `≥ ${t.gte}: ${t.label}`))
    .join(" · ");
  return ` · Faixas: ${bands}.`;
}

function row(def: MetricDef): string {
  const snapshot = def.snapshot ? " 📸" : "";
  return `| **${def.name}** (\`${def.id}\`)${snapshot} | ${def.unit} | ${def.formulaText}${thresholdLine(def)} | ${def.lineage.map((l) => `\`${l}\``).join(", ")} | *${def.question}* — ${def.defense} |`;
}

function section(s: Section): string {
  const defs = s.ids.map((id) => {
    const def = getMetricDef(id);
    if (!def) throw new Error(`Seção "${s.title}" referencia métrica inexistente: ${id}`);
    return def;
  });
  return [
    `## ${s.title}`,
    "",
    ...(s.intro ? [s.intro, ""] : []),
    "| Métrica | Unidade | Fórmula | Fonte | Defesa |",
    "|---|---|---|---|---|",
    ...defs.map(row),
    ...(s.outro ? ["", s.outro] : []),
    "",
  ].join("\n");
}

// Cobertura total: registry e seções têm exatamente o mesmo conjunto de ids.
const sectionIds = new Set(SECTIONS.flatMap((s) => s.ids));
const registryIds = new Set(METRIC_REGISTRY.map((d) => d.id));
for (const id of registryIds) {
  if (!sectionIds.has(id)) throw new Error(`Métrica fora do doc: ${id} — adicione a uma seção.`);
}
if (sectionIds.size !== registryIds.size) {
  throw new Error("Seções referenciam ids duplicados ou fora do registry.");
}

const doc = `<!-- GERADO por scripts/gen-metrics-doc.ts — NÃO EDITE.
     SSOT: src/lib/metrics/registry.ts. Pra mudar fórmula/defesa, mude o
     registry (e o DAL, se for o caso) e rode: npx tsx scripts/gen-metrics-doc.ts -->

# STATS — dicionário de métricas do Overview de Projetos

Toda métrica exibida na aba Projetos do Overview (\`/\`) é **derivada** — nada é
coluna editável. Este dicionário é a defesa de cada número: fórmula exata,
fonte e a frase que explica pro CEO (a \`defense\` é o tooltip da UI **e** a
resposta do Alpha — D6). SSOT: \`METRIC_REGISTRY\` em
[\`src/lib/metrics/registry.ts\`](../../../src/lib/metrics/registry.ts); motor de
projeto: \`computeStats()\` em
[\`src/lib/dal/project-overview.ts\`](../../../src/lib/dal/project-overview.ts).

Organização: todo stat responde a uma pergunta — *quanto tempo queimou? quanto
saiu? em que ritmo? quanto da capacidade vira entrega?*

📸 = entra no snapshot semanal (\`MetricSnapshot\`, segundas 06:00 BRT — D3).

${SECTIONS.map(section).join("\n")}
## Régua (a visualização)

Um segmento por sprint do contrato (\`contract\`) ou por sprint (\`rolling\`):

- **Fechada** — cor pela entrega real (\`done/planned\`): verde ≥85%, âmbar 50–85%,
  vermelho <50%, cinza = sem FP.
- **Buraco** — tracejado âmbar: sprint do contrato queimada sem produção.
- **Corrente** — ring primário (ou âmbar, se não há sprint ativa).
- **Futura** — apagada.
- Pista não-cromática (WCAG 1.4.1): texto \`5/12\` sempre ao lado + tooltip por
  segmento.

## Regras transversais

- **Fase manda**: Comercial não exibe STATS de produção (sprints nascem na
  Imersão — mostra "em comercial há Xd" via \`Project.phaseChangedAt\`).
  Imersão/Ops sem sprint = ⚠ aviso legítimo. \`phaseChangedAt\` é estampado no
  \`PUT /api/projects/[id]\` quando a phase muda (backfill: \`createdAt\`).
- **Escadinha de degradação**: contrato completo (régua+pace+projeção) → só
  sprint (régua+done%) → contínuo (rolling+média) → nada (aviso por fase).
- **Métrica só existe se está no registry** — UI não renderiza stat fora dele;
  toda resposta numérica do Alpha sobre operação passa por \`compute_metric\`
  (D9). Nenhuma mudança de fórmula sem atualizar \`defense\` junto.
`;

writeFileSync(OUT_PATH, doc, "utf8");
console.log(`✓ ${OUT_PATH} regenerado — ${METRIC_REGISTRY.length} métricas.`);
