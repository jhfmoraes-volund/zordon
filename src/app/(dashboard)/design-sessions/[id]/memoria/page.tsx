"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, AlertCircle, HelpCircle, Search, Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/ui/markdown";

interface Decision {
  id: string;
  statement: string;
  rationale: string;
  confidence: "hard_fact" | "inferred" | "assumption";
  status: "active" | "under_review" | "reverted";
  tags: string[] | null;
  createdAt: string;
  sessionId: string;
}

interface OpenQuestion {
  id: string;
  question: string;
  blocksWhat: string | null;
  status: "open" | "answered" | "obsolete";
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}

interface ResearchEntry {
  id: string;
  query: string;
  summary: string;
  sources: { title: string; url: string; snippet?: string }[];
  createdAt: string;
}

interface BusinessContext {
  businessModel: string | null;
  stage: string | null;
  icp: string | null;
  ticketRangeBrl: string | null;
  runwayMonths: number | null;
  competitors: { name: string; role: "reference" | "antiPattern" }[] | null;
  updatedAt: string;
}

interface MemoryPayload {
  session: {
    id: string;
    title: string;
    type: string;
    status: string;
    memoryMd: string | null;
    memoryAbstract: string | null;
    memoryVersion: number;
    memoryUpdatedAt: string | null;
    projectId: string;
  };
  project: {
    id: string;
    name: string;
    memoryMd: string | null;
    memoryVersion: number;
    memoryUpdatedAt: string | null;
  } | null;
  businessContext: BusinessContext | null;
  activeDecisions: Decision[];
  openQuestions: OpenQuestion[];
  research: ResearchEntry[];
}

const CONFIDENCE_TONE: Record<Decision["confidence"], string> = {
  hard_fact: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  inferred: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  assumption: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

const CONFIDENCE_LABEL: Record<Decision["confidence"], string> = {
  hard_fact: "fato",
  inferred: "inferido",
  assumption: "suposição",
};

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export default function MemoriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<MemoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/design-sessions/${id}/memory`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error ?? "falha ao carregar");
        setData(d);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const { session, project, businessContext, activeDecisions, openQuestions, research } = data;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/design-sessions/${id}/steps/0`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para a session
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            Memória — {session.title}
          </h1>
          <p className="text-xs text-muted-foreground">
            Tudo que o Vitor lembra desta session e do projeto. Mantido pelo agente —
            se algo estiver errado, peça ajuste no chat.
          </p>
        </div>
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          <strong className="text-amber-600 dark:text-amber-400">Read-only.</strong>{" "}
          A memória estruturada é mantida pelo Vitor durante as conversas. Decisões podem ser revisadas via chat (&quot;contradição com X&quot; → Vitor marca under_review).
        </div>
      </div>

      {businessContext && <BusinessContextCard ctx={businessContext} />}

      <DecisionsSection decisions={activeDecisions} sessionId={id} />

      <OpenQuestionsSection questions={openQuestions} />

      <ResearchSection research={research} />

      <SessionMemoryCard md={session.memoryMd} updatedAt={session.memoryUpdatedAt} version={session.memoryVersion} />

      {project?.memoryMd && (
        <ProjectMemoryCard md={project.memoryMd} name={project.name ?? ""} updatedAt={project.memoryUpdatedAt} />
      )}
    </div>
  );
}

function BusinessContextCard({ ctx }: { ctx: BusinessContext }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          Contexto de Negócio (projeto)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {ctx.businessModel && (
            <div>
              <dt className="text-xs text-muted-foreground">Modelo</dt>
              <dd>{ctx.businessModel}</dd>
            </div>
          )}
          {ctx.stage && (
            <div>
              <dt className="text-xs text-muted-foreground">Estágio</dt>
              <dd>{ctx.stage}</dd>
            </div>
          )}
          {ctx.icp && (
            <div className="md:col-span-2">
              <dt className="text-xs text-muted-foreground">ICP</dt>
              <dd>{ctx.icp}</dd>
            </div>
          )}
          {ctx.ticketRangeBrl && (
            <div>
              <dt className="text-xs text-muted-foreground">Ticket (R$)</dt>
              <dd>{ctx.ticketRangeBrl}</dd>
            </div>
          )}
          {ctx.runwayMonths != null && (
            <div>
              <dt className="text-xs text-muted-foreground">Runway</dt>
              <dd>{ctx.runwayMonths} meses</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

function DecisionsSection({ decisions, sessionId }: { decisions: Decision[]; sessionId: string }) {
  if (decisions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            Decisões Ativas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">
            Nenhuma decisão registrada. Quando você disser &quot;vamos focar em X&quot; ou &quot;X fora&quot;,
            o Vitor registra aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          Decisões Ativas <span className="text-muted-foreground font-normal">({decisions.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {decisions.map((d) => (
          <div key={d.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-sm leading-snug">{d.statement}</div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase tracking-wide ${CONFIDENCE_TONE[d.confidence]}`}
                >
                  {CONFIDENCE_LABEL[d.confidence]}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{d.rationale}</p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
              <span className="font-mono">{shortId(d.id)}</span>
              <span>·</span>
              <span>{fmtDate(d.createdAt)}</span>
              {d.sessionId !== sessionId && (
                <>
                  <span>·</span>
                  <span className="italic">de outra session</span>
                </>
              )}
              {d.tags?.length && (
                <>
                  <span>·</span>
                  <span>{d.tags.map((t) => `#${t}`).join(" ")}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function OpenQuestionsSection({ questions }: { questions: OpenQuestion[] }) {
  const open = questions.filter((q) => q.status === "open");
  const answered = questions.filter((q) => q.status === "answered");

  if (questions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            Perguntas Abertas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">
            Nada em aberto. Quando o Vitor estiver chutando algo, ele registra aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          Perguntas Abertas{" "}
          <span className="text-muted-foreground font-normal">
            ({open.length} aberta{open.length !== 1 ? "s" : ""}, {answered.length} respondida{answered.length !== 1 ? "s" : ""})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.map((q) => {
          const age = ageDays(q.createdAt);
          const stale = age >= 7;
          return (
            <div
              key={q.id}
              className={`rounded-md border p-3 space-y-1 ${stale ? "border-rose-500/30 bg-rose-500/5" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm leading-snug">{q.question}</p>
                {stale && (
                  <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 shrink-0">
                    aberta há {age}d
                  </Badge>
                )}
              </div>
              {q.blocksWhat && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Bloqueia:</span> {q.blocksWhat}
                </p>
              )}
              <div className="text-[10px] text-muted-foreground/70 font-mono">{shortId(q.id)} · {fmtDate(q.createdAt)}</div>
            </div>
          );
        })}
        {answered.length > 0 && open.length > 0 && (
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60 pt-2">Respondidas</div>
        )}
        {answered.map((q) => (
          <div key={q.id} className="rounded-md border border-border bg-muted/30 p-3 space-y-1 opacity-75">
            <p className="text-sm leading-snug">{q.question}</p>
            {q.answer && <p className="text-xs italic">→ {q.answer}</p>}
            <div className="text-[10px] text-muted-foreground/70">
              respondida em {q.answeredAt ? fmtDate(q.answeredAt) : "—"}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ResearchSection({ research }: { research: ResearchEntry[] }) {
  if (research.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            Pesquisas (Research Log)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">
            Nenhuma pesquisa nesta session ainda. Toda chamada de web_search do Vitor é capturada aqui automaticamente.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          Pesquisas (Research Log){" "}
          <span className="text-muted-foreground font-normal">({research.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {research.map((r) => (
          <div key={r.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-sm leading-snug">{r.query}</div>
              <code className="text-[10px] font-mono text-muted-foreground shrink-0">research#{shortId(r.id)}</code>
            </div>
            <p className="text-xs text-muted-foreground">{r.summary}</p>
            {r.sources.length > 0 && (
              <ul className="space-y-1">
                {r.sources.slice(0, 5).map((s, i) => (
                  <li key={i} className="text-xs">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline break-all"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[10px] text-muted-foreground/70">{fmtDate(r.createdAt)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SessionMemoryCard({
  md,
  updatedAt,
  version,
}: {
  md: string | null;
  updatedAt: string | null;
  version: number;
}) {
  if (!md) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          Narrativa desta Session
          <span className="text-[10px] text-muted-foreground font-normal font-mono">v{version}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <Markdown>{md}</Markdown>
        </div>
        {updatedAt && (
          <p className="text-[10px] text-muted-foreground/70 mt-3">
            atualizada {fmtDate(updatedAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectMemoryCard({
  md,
  name,
  updatedAt,
}: {
  md: string;
  name: string;
  updatedAt: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          Memória do Projeto — {name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <Markdown>{md}</Markdown>
        </div>
        {updatedAt && (
          <p className="text-[10px] text-muted-foreground/70 mt-3">
            atualizada {fmtDate(updatedAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
