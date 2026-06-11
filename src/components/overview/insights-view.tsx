import { Users, Smile, Building2, AlertTriangle, FolderKanban } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { PROJECT_PHASE, type ChipTone } from "@/lib/status-chips";
import {
  getInsightsOverview,
  type ScoreStat,
  type ClientHealthRow,
  type PmDistributionRow,
} from "@/lib/dal/insights-overview";

/** Health do ClientInsight → chip (label pt-BR + tom). */
const HEALTH_CHIP: Record<string, { label: string; tone: ChipTone }> = {
  healthy: { label: "Saudável", tone: "green" },
  watch: { label: "Atenção", tone: "amber" },
  at_risk: { label: "Em risco", tone: "red" },
  critical: { label: "Crítico", tone: "red" },
};

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("pt-BR");
}

/** Seta + cor do delta (sobe=verde, desce=vermelho, estável/null=neutro). */
function DeltaArrow({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0)
    return <span className="text-muted-foreground/60">→</span>;
  const up = delta > 0;
  return (
    <span className={up ? "text-emerald-500" : "text-red-400"} title={`${up ? "+" : ""}${delta} vs. janela anterior`}>
      {up ? "↑" : "↓"} {Math.abs(delta).toLocaleString("pt-BR")}
    </span>
  );
}

/** Big number com label apagado, valor herói e delta opcional. */
function BigNumber({
  value,
  label,
  score,
  tone,
}: {
  value: string;
  label: string;
  score?: ScoreStat;
  tone?: "amber" | "red";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 pr-5 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border [&:not(:first-child)]:pl-5">
      <span
        className={[
          "text-2xl font-semibold leading-none tabular-nums",
          tone === "amber" ? "text-yellow-500" : "",
          tone === "red" ? "text-red-400" : "",
        ].join(" ")}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {score && (
        <span className="mt-0.5 text-[11px] tabular-nums">
          <DeltaArrow delta={score.delta} />
        </span>
      )}
    </div>
  );
}

/** Cabeçalho de bloco — ícone + título + subtítulo apagado. */
function BlockHeader({
  icon: Icon,
  title,
  sub,
}: {
  icon: typeof Users;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold">{title}</h2>
      {sub && <span className="text-xs text-muted-foreground">· {sub}</span>}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Cor da fase (Project.phase) nos segmentos da barra e nos dots da legenda. */
const PHASE_COLOR: Record<string, string> = {
  commercial: "bg-purple-400",
  immersion: "bg-cyan-400",
  ops: "bg-blue-400",
  post_ops: "bg-teal-400",
};
const phaseColor = (phase: string) => PHASE_COLOR[phase] ?? "bg-muted-foreground/50";
const phaseLabel = (phase: string) =>
  (PROJECT_PHASE as Record<string, { label: string }>)[phase]?.label ?? phase;

/** Linha do bloco PMs — avatar + nome + barra empilhada por fase + split + total. */
function PmLine({ p, max }: { p: PmDistributionRow; max: number }) {
  const pct = max > 0 ? (p.activeProjects / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
        {p.id ? initials(p.name) : "?"}
      </span>
      <span
        className={[
          "w-44 shrink-0 truncate text-sm",
          p.id ? "font-medium" : "text-muted-foreground",
        ].join(" ")}
      >
        {p.name}
      </span>
      <span className="min-w-0 flex-1">
        {p.activeProjects > 0 && (
          <span className="flex h-1.5 overflow-hidden rounded-full" style={{ width: `${pct}%` }}>
            {p.byPhase.map((s) => (
              <span
                key={s.phase}
                className={phaseColor(s.phase)}
                style={{ width: `${(s.count / p.activeProjects) * 100}%` }}
                title={`${s.count} ${phaseLabel(s.phase)}`}
              />
            ))}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2.5 text-[11px] tabular-nums text-muted-foreground">
        {p.byPhase.map((s) => (
          <span key={s.phase} className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${phaseColor(s.phase)}`} />
            {s.count} {phaseLabel(s.phase)}
          </span>
        ))}
      </span>
      <span className="w-10 shrink-0 text-right text-sm tabular-nums">{p.activeProjects}</span>
    </div>
  );
}

function ClientLine({ c }: { c: ClientHealthRow }) {
  const chip = c.health ? HEALTH_CHIP[c.health] : null;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
        {initials(c.name)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {c.activeProjects} ativo{c.activeProjects === 1 ? "" : "s"}
      </span>
      <span className="w-24 shrink-0 text-right">
        {chip ? (
          <StatusChip label={chip.label} tone={chip.tone} variant="subtle" size="sm" />
        ) : (
          <span className="text-[11px] text-muted-foreground/60">sem leitura</span>
        )}
      </span>
      <span className="w-12 shrink-0 text-right text-sm tabular-nums">
        {c.csat === null ? <span className="text-muted-foreground/60">—</span> : c.csat.toLocaleString("pt-BR")}
      </span>
    </div>
  );
}

/** Aba Insights — quatro blocos de peso igual (time / PMs / satisfação / clientes). */
export async function InsightsView() {
  const { team, pms, satisfaction, clients } = await getInsightsOverview();
  const pmActiveTotal = pms.reduce((s, p) => s + p.activeProjects, 0);
  const pmMax = Math.max(0, ...pms.map((p) => p.activeProjects));
  const phaseTotals = new Map<string, number>();
  for (const p of pms)
    for (const s of p.byPhase) phaseTotals.set(s.phase, (phaseTotals.get(s.phase) ?? 0) + s.count);
  const phaseSub = Object.keys(PROJECT_PHASE)
    .filter((k) => (phaseTotals.get(k) ?? 0) > 0)
    .map((k) => `${phaseTotals.get(k)} ${phaseLabel(k)}`)
    .join(" · ");

  return (
    <div className="space-y-5">
      {/* ── Bloco 1: Time ── */}
      <section className="surface p-4">
        <BlockHeader icon={Users} title="Time" />
        <div className="flex flex-wrap items-stretch gap-y-3">
          <BigNumber value={String(team.builders)} label="Builders" />
          <BigNumber value={String(team.pms)} label="PMs" />
          <BigNumber value={String(team.internalTotal)} label="Internos" />
          <BigNumber value={String(team.externals)} label="Externos" />
        </div>
        {team.bySpecialty.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {team.bySpecialty.map((s) => (
              <span key={s.specialty} className="tabular-nums">
                <span className="font-medium text-foreground">{s.count}</span> {s.specialty}
              </span>
            ))}
          </p>
        )}
      </section>

      {/* ── Bloco 2: Projetos por PM ── */}
      <section className="surface p-4">
        <BlockHeader
          icon={FolderKanban}
          title="Projetos por PM"
          sub={`${pmActiveTotal} ativo${pmActiveTotal === 1 ? "" : "s"}${phaseSub ? ` · ${phaseSub}` : ""}`}
        />
        {pms.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum PM ou projeto ativo.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {pms.map((p) => (
              <PmLine key={p.id ?? "unassigned"} p={p} max={pmMax} />
            ))}
          </div>
        )}
      </section>

      {/* ── Bloco 3: Satisfação ── */}
      <section className="surface p-4">
        <BlockHeader
          icon={Smile}
          title="Satisfação"
          sub={
            satisfaction.sampleCount > 0
              ? `${satisfaction.sampleCount} entrevista${satisfaction.sampleCount === 1 ? "" : "s"} · últimos 90d`
              : "sem entrevistas nos últimos 90d"
          }
        />
        <div className="flex flex-wrap items-stretch gap-y-3">
          <BigNumber value={fmtNum(satisfaction.csat.avg)} label="CSAT" score={satisfaction.csat} />
          <BigNumber value={fmtNum(satisfaction.nps.avg)} label="NPS" score={satisfaction.nps} />
          <BigNumber value={fmtNum(satisfaction.team.avg)} label="Time" score={satisfaction.team} />
          <BigNumber
            value={fmtNum(satisfaction.methodology.avg)}
            label="Metodologia"
            score={satisfaction.methodology}
          />
        </div>
        {satisfaction.toImprove.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-500">
              <AlertTriangle className="h-3 w-3" /> A melhorar
            </p>
            <ul className="space-y-1.5">
              {satisfaction.toImprove.map((it, i) => (
                <li key={i} className="text-xs leading-relaxed">
                  <span className="text-muted-foreground">{it.clientName}:</span> {it.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Bloco 4: Clientes × projetos ── */}
      <section className="surface p-4">
        <BlockHeader icon={Building2} title="Clientes" sub={`${clients.length} no total`} />
        {clients.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum cliente cadastrado.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="w-7 shrink-0" />
              <span className="min-w-0 flex-1">Cliente</span>
              <span className="shrink-0">Projetos</span>
              <span className="w-24 shrink-0 text-right">Health</span>
              <span className="w-12 shrink-0 text-right">CSAT</span>
            </div>
            <div className="divide-y divide-border/60">
              {clients.map((c) => (
                <ClientLine key={c.id} c={c} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
