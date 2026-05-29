"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/status-chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormBody } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { ProductRequirementRow } from "@/lib/dal/product-requirements";
import type { ChipTone } from "@/lib/status-chips";

type PrdStatus = "draft" | "review" | "approved" | "superseded";

type JourneyStep = { actor: string; action: string; expectation: string };
type AcceptanceCriterion = { given: string; when: string; then: string };
type Metric = { metric: string; baseline?: string; target: string };
type Dependency = { prdId: string; kind: "blocks" | "enables" | "shares-data" };
type RiskOrAssumption = {
  kind: "risk" | "assumption";
  text: string;
  mitigation?: string;
};

type ActivityEntry = {
  id: string;
  kind: string;
  actorAgent: string | null;
  actorName: string | null;
  createdAt: string;
};

type Props = {
  prd: ProductRequirementRow;
  project: { id: string; name: string };
  modules: { id: string; name: string }[];
  personas: { id: string; name: string }[];
  activity: ActivityEntry[];
  canEdit: boolean;
};

const STATUS_TONE: Record<PrdStatus, ChipTone> = {
  draft: "slate",
  review: "amber",
  approved: "green",
  superseded: "muted",
};

const STATUS_LABEL: Record<PrdStatus, string> = {
  draft: "Draft",
  review: "Em revisão",
  approved: "Aprovado",
  superseded: "Substituído",
};

function isPrdStatus(value: string): value is PrdStatus {
  return ["draft", "review", "approved", "superseded"].includes(value);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

type SectionId =
  | "briefing"
  | "problem-goal"
  | "journey"
  | "ac"
  | "metrics"
  | "outOfScope"
  | "dependencies"
  | "technicalNotes"
  | "risks"
  | null;

export function PrdDetail(props: Props) {
  const router = useRouter();
  const { project, modules, personas } = props;
  const [prd, setPrd] = useState<ProductRequirementRow>(props.prd);
  const [activeSection, setActiveSection] = useState<SectionId>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [approving, startApprove] = useTransition();

  const status: PrdStatus = isPrdStatus(prd.status) ? prd.status : "draft";
  const editable = props.canEdit && (status === "draft" || status === "review");

  const personaNameById = useMemo(
    () => new Map(personas.map((p) => [p.id, p.name])),
    [personas],
  );
  const moduleNameById = useMemo(
    () => new Map(modules.map((m) => [m.id, m.name])),
    [modules],
  );

  async function patch(body: Partial<ProductRequirementRow>): Promise<void> {
    const res = await fetchOrThrow(`/api/prds/${prd.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data: ProductRequirementRow };
    setPrd(json.data);
    router.refresh();
  }

  function openApprove() {
    if (!props.canEdit) return;
    setConfirmState({
      title: "Aprovar PRD?",
      description:
        "PRD aprovado vai pra Vitoria materializar em Tasks. Após aprovação, este PRD vira imutável.",
      confirmLabel: "Aprovar",
      cancelLabel: "Cancelar",
      destructive: false,
      onConfirm: async () => {
        startApprove(async () => {
          try {
            const res = await fetch(`/api/prds/${prd.id}/approve`, {
              method: "POST",
            });
            if (!res.ok) {
              const body = await res.json().catch(() => null);
              const msg = body?.error ?? `${res.status} ${res.statusText}`;
              toast.error(`Não foi possível aprovar: ${msg}`);
              return;
            }
            const json = (await res.json()) as { data: ProductRequirementRow };
            setPrd(json.data);
            toast.success("PRD aprovado.");
            router.refresh();
          } catch (error) {
            showErrorToast(error, { label: "Aprovar PRD" });
          }
        });
      },
    });
  }

  const journey = asArray<JourneyStep>(prd.userJourney);
  const ac = asArray<AcceptanceCriterion>(prd.acceptanceCriteria);
  const metrics = asArray<Metric>(prd.successMetrics);
  const dependencies = asArray<Dependency>(prd.dependencies);
  const risks = asArray<RiskOrAssumption>(prd.risksAndAssumptions);

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={`/projects/${project.id}/prds`}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          PRDs · {project.name}
        </Link>
      </div>

      {/* 1. Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <FileText className="size-4" />
                {prd.reference}
              </div>
              <CardTitle className="text-xl">{prd.title}</CardTitle>
              {prd.oneLiner ? (
                <CardDescription>{prd.oneLiner}</CardDescription>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusChip tone={STATUS_TONE[status]} dot>
                {STATUS_LABEL[status]}
              </StatusChip>
              {editable && (status === "draft" || status === "review") ? (
                <Button
                  size="sm"
                  onClick={openApprove}
                  disabled={approving}
                >
                  {approving ? "Aprovando…" : "Aprovar"}
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        {prd.approvedAt ? (
          <CardContent className="text-xs text-muted-foreground">
            Aprovado em {formatDate(prd.approvedAt)}
          </CardContent>
        ) : null}
      </Card>

      {/* 2. Briefing */}
      <SectionCard
        title="Briefing"
        editable={editable}
        onEdit={() => setActiveSection("briefing")}
      >
        <Row label="One-liner">
          <p className="text-sm">{prd.oneLiner || "—"}</p>
        </Row>
        <Row label="Módulo">
          <p className="text-sm text-muted-foreground">
            {prd.moduleId
              ? moduleNameById.get(prd.moduleId) ?? prd.moduleId
              : "—"}
          </p>
        </Row>
        <Row label="Personas">
          {prd.personaIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {prd.personaIds.map((id) => (
                <Badge key={id} variant="secondary">
                  {personaNameById.get(id) ?? id.slice(0, 8)}
                </Badge>
              ))}
            </div>
          )}
        </Row>
      </SectionCard>

      {/* 3. Problema & Goal */}
      <SectionCard
        title="Problema & Goal"
        editable={editable}
        onEdit={() => setActiveSection("problem-goal")}
      >
        <Row label="Problema">
          <p className="whitespace-pre-wrap text-sm">{prd.problem || "—"}</p>
        </Row>
        <Row label="Goal">
          <p className="whitespace-pre-wrap text-sm">{prd.goal || "—"}</p>
        </Row>
      </SectionCard>

      {/* 4. Jornada do usuário */}
      <SectionCard
        title="Jornada do usuário"
        editable={editable}
        onEdit={() => setActiveSection("journey")}
      >
        {journey.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum passo.</p>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {journey.map((step, i) => (
              <li key={i}>
                <span className="font-semibold">{step.actor}</span> {step.action}
                <span className="text-muted-foreground"> → {step.expectation}</span>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      {/* 5. Acceptance Criteria */}
      <SectionCard
        title="Acceptance Criteria"
        editable={editable}
        onEdit={() => setActiveSection("ac")}
      >
        {ac.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum critério.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ac.map((c, i) => (
              <li key={i} className="rounded-md border bg-muted/40 p-2">
                <span className="font-mono text-xs text-muted-foreground">
                  AC-{i + 1}
                </span>{" "}
                <strong>Given</strong> {c.given} <strong>When</strong> {c.when}{" "}
                <strong>Then</strong> {c.then}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 6. Métricas */}
      <SectionCard
        title="Métricas de sucesso"
        editable={editable}
        onEdit={() => setActiveSection("metrics")}
      >
        {metrics.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma métrica.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {metrics.map((m, i) => (
              <li key={i}>
                <span className="font-medium">{m.metric}</span>
                <span className="text-muted-foreground">
                  : baseline {m.baseline ?? "n/a"} → target {m.target}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 7. Out of scope */}
      <SectionCard
        title="Out of scope"
        editable={editable}
        onEdit={() => setActiveSection("outOfScope")}
      >
        {prd.outOfScope.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {prd.outOfScope.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 8. Dependências */}
      <SectionCard
        title="Dependências"
        editable={editable}
        onEdit={() => setActiveSection("dependencies")}
      >
        {dependencies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {dependencies.map((d, i) => (
              <li key={i}>
                <Badge variant="outline" className="mr-2">
                  {d.kind}
                </Badge>
                <Link
                  href={`/projects/${project.id}/prds/${d.prdId}`}
                  className="font-mono text-xs hover:underline"
                >
                  {d.prdId.slice(0, 8)}…
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 9. Notas técnicas */}
      <SectionCard
        title="Notas técnicas"
        editable={editable}
        onEdit={() => setActiveSection("technicalNotes")}
      >
        <p className="whitespace-pre-wrap text-sm">
          {prd.technicalNotes || "—"}
        </p>
      </SectionCard>

      {/* 10. Riscos & Assumptions */}
      <SectionCard
        title="Riscos & Assumptions"
        editable={editable}
        onEdit={() => setActiveSection("risks")}
      >
        {risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {risks.map((r, i) => (
              <li key={i}>
                <Badge variant={r.kind === "risk" ? "destructive" : "secondary"} className="mr-2">
                  {r.kind}
                </Badge>
                {r.text}
                {r.mitigation ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — mitigação: {r.mitigation}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 11. Source cards (read-only) */}
      <SectionCard title="Source cards" editable={false}>
        {prd.sourceCardIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {prd.sourceCardIds.map((id) => (
              <Badge key={id} variant="outline" className="font-mono text-xs">
                {id}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 12. Markdown export */}
      <Card>
        <CardHeader>
          <CardTitle>Markdown export</CardTitle>
          <CardDescription>
            Gerado automaticamente pelo trigger SQL. Read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              Ver markdown ({prd.markdown.length} chars)
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {prd.markdown}
            </pre>
          </details>
        </CardContent>
      </Card>

      {/* 13. Activity log */}
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Últimas 10 entradas.</CardDescription>
        </CardHeader>
        <CardContent>
          {props.activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem atividade.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {props.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5">
                    {a.kind}
                  </Badge>
                  <div className="flex-1 text-xs text-muted-foreground">
                    {a.actorName ?? a.actorAgent ?? "system"} ·{" "}
                    {formatDate(a.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Edit sheets */}
      <BriefingSheet
        open={activeSection === "briefing"}
        onClose={() => setActiveSection(null)}
        prd={prd}
        modules={modules}
        onSave={patch}
      />
      <ProblemGoalSheet
        open={activeSection === "problem-goal"}
        onClose={() => setActiveSection(null)}
        prd={prd}
        onSave={patch}
      />
      <JourneySheet
        open={activeSection === "journey"}
        onClose={() => setActiveSection(null)}
        initial={journey}
        onSave={(items) => patch({ userJourney: items as never })}
      />
      <AcceptanceCriteriaSheet
        open={activeSection === "ac"}
        onClose={() => setActiveSection(null)}
        initial={ac}
        onSave={(items) => patch({ acceptanceCriteria: items as never })}
      />
      <MetricsSheet
        open={activeSection === "metrics"}
        onClose={() => setActiveSection(null)}
        initial={metrics}
        onSave={(items) => patch({ successMetrics: items as never })}
      />
      <StringListSheet
        open={activeSection === "outOfScope"}
        onClose={() => setActiveSection(null)}
        title="Out of scope"
        initial={prd.outOfScope}
        onSave={(items) => patch({ outOfScope: items })}
      />
      <DependenciesSheet
        open={activeSection === "dependencies"}
        onClose={() => setActiveSection(null)}
        initial={dependencies}
        onSave={(items) => patch({ dependencies: items as never })}
      />
      <TechnicalNotesSheet
        open={activeSection === "technicalNotes"}
        onClose={() => setActiveSection(null)}
        initial={prd.technicalNotes}
        onSave={(value) => patch({ technicalNotes: value })}
      />
      <RisksSheet
        open={activeSection === "risks"}
        onClose={() => setActiveSection(null)}
        initial={risks}
        onSave={(items) => patch({ risksAndAssumptions: items as never })}
      />

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}

// ─── Reusable building blocks ────────────────────────────────────────────────

function SectionCard({
  title,
  editable,
  onEdit,
  children,
}: {
  title: string;
  editable: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {editable && onEdit ? (
          <CardAction>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil className="size-3.5" />
              Editar
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

// ─── Edit sheets ─────────────────────────────────────────────────────────────

type SheetBaseProps = {
  open: boolean;
  onClose: () => void;
};

function useSubmitHandler<T>(
  fn: (value: T) => Promise<void>,
  onDone: () => void,
  label: string,
) {
  const [saving, setSaving] = useState(false);
  return {
    saving,
    submit: async (value: T) => {
      setSaving(true);
      try {
        await fn(value);
        onDone();
      } catch (error) {
        showErrorToast(error, { label });
      } finally {
        setSaving(false);
      }
    },
  };
}

function BriefingSheet({
  open,
  onClose,
  prd,
  modules,
  onSave,
}: SheetBaseProps & {
  prd: ProductRequirementRow;
  modules: { id: string; name: string }[];
  onSave: (patch: Partial<ProductRequirementRow>) => Promise<void>;
}) {
  const [title, setTitle] = useState(prd.title);
  const [oneLiner, setOneLiner] = useState(prd.oneLiner);
  const [moduleId, setModuleId] = useState<string | null>(prd.moduleId);
  const { saving, submit } = useSubmitHandler(onSave, onClose, "Salvar briefing");

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Editar briefing</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Title, one-liner e módulo do PRD.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <FormBody>
            <Field name="title" required>
              <Field.Label>Title</Field.Label>
              <Field.Control>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={140}
                />
              </Field.Control>
            </Field>
            <Field name="oneLiner">
              <Field.Label>One-liner</Field.Label>
              <Field.Control>
                <Input
                  value={oneLiner}
                  onChange={(e) => setOneLiner(e.target.value)}
                  maxLength={200}
                />
              </Field.Control>
              <Field.Hint>Resumo em até 200 chars.</Field.Hint>
            </Field>
            <Field name="moduleId">
              <Field.Label>Módulo</Field.Label>
              <Field.Control>
                <Select
                  value={moduleId ?? "__none__"}
                  onValueChange={(v) => setModuleId(v === "__none__" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem módulo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Sem módulo —</SelectItem>
                    {modules.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={saving}
            onClick={() => submit({ title, oneLiner, moduleId })}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function ProblemGoalSheet({
  open,
  onClose,
  prd,
  onSave,
}: SheetBaseProps & {
  prd: ProductRequirementRow;
  onSave: (patch: Partial<ProductRequirementRow>) => Promise<void>;
}) {
  const [problem, setProblem] = useState(prd.problem);
  const [goal, setGoal] = useState(prd.goal);
  const { saving, submit } = useSubmitHandler(
    onSave,
    onClose,
    "Salvar problema/goal",
  );

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Problema & Goal</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Problema ≥ 50 chars · Goal ≥ 20 chars (validação ao aprovar).
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <FormBody>
            <Field name="problem" required>
              <Field.Label>Problema</Field.Label>
              <Field.Control>
                <Textarea
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  rows={6}
                />
              </Field.Control>
              <Field.Hint>
                {problem.length} chars{problem.length < 50 ? " (mín 50)" : ""}
              </Field.Hint>
            </Field>
            <Field name="goal" required>
              <Field.Label>Goal</Field.Label>
              <Field.Control>
                <Textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={4}
                />
              </Field.Control>
              <Field.Hint>
                {goal.length} chars{goal.length < 20 ? " (mín 20)" : ""}
              </Field.Hint>
            </Field>
          </FormBody>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => submit({ problem, goal })}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function JourneySheet({
  open,
  onClose,
  initial,
  onSave,
}: SheetBaseProps & {
  initial: JourneyStep[];
  onSave: (items: JourneyStep[]) => Promise<void>;
}) {
  const [items, setItems] = useState<JourneyStep[]>(initial);
  const { saving, submit } = useSubmitHandler(onSave, onClose, "Salvar jornada");

  function update(i: number, patch: Partial<JourneyStep>) {
    setItems((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems((prev) => [...prev, { actor: "", action: "", expectation: "" }]);
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Jornada do usuário</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <div className="flex flex-col gap-3">
            {items.map((step, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">
                    #{i + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Input
                  placeholder="Actor"
                  value={step.actor}
                  onChange={(e) => update(i, { actor: e.target.value })}
                />
                <Input
                  placeholder="Action"
                  value={step.action}
                  onChange={(e) => update(i, { action: e.target.value })}
                />
                <Input
                  placeholder="Expectation"
                  value={step.expectation}
                  onChange={(e) => update(i, { expectation: e.target.value })}
                />
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={add}>
              <Plus className="size-3.5" />
              Adicionar passo
            </Button>
          </div>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => submit(items)}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function AcceptanceCriteriaSheet({
  open,
  onClose,
  initial,
  onSave,
}: SheetBaseProps & {
  initial: AcceptanceCriterion[];
  onSave: (items: AcceptanceCriterion[]) => Promise<void>;
}) {
  const [items, setItems] = useState<AcceptanceCriterion[]>(initial);
  const { saving, submit } = useSubmitHandler(onSave, onClose, "Salvar AC");

  function update(i: number, patch: Partial<AcceptanceCriterion>) {
    setItems((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems((prev) => [...prev, { given: "", when: "", then: "" }]);
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Acceptance Criteria</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Mínimo 3 critérios pra aprovar.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <div className="flex flex-col gap-3">
            {items.map((c, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">
                    AC-{i + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  placeholder="Given …"
                  value={c.given}
                  onChange={(e) => update(i, { given: e.target.value })}
                  rows={2}
                />
                <Textarea
                  placeholder="When …"
                  value={c.when}
                  onChange={(e) => update(i, { when: e.target.value })}
                  rows={2}
                />
                <Textarea
                  placeholder="Then …"
                  value={c.then}
                  onChange={(e) => update(i, { then: e.target.value })}
                  rows={2}
                />
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={add}>
              <Plus className="size-3.5" />
              Adicionar critério
            </Button>
          </div>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => submit(items)}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function MetricsSheet({
  open,
  onClose,
  initial,
  onSave,
}: SheetBaseProps & {
  initial: Metric[];
  onSave: (items: Metric[]) => Promise<void>;
}) {
  const [items, setItems] = useState<Metric[]>(initial);
  const { saving, submit } = useSubmitHandler(onSave, onClose, "Salvar métricas");

  function update(i: number, patch: Partial<Metric>) {
    setItems((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems((prev) => [...prev, { metric: "", baseline: "", target: "" }]);
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Métricas de sucesso</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <div className="flex flex-col gap-3">
            {items.map((m, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">
                    #{i + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Input
                  placeholder="Métrica"
                  value={m.metric}
                  onChange={(e) => update(i, { metric: e.target.value })}
                />
                <Input
                  placeholder="Baseline (opcional)"
                  value={m.baseline ?? ""}
                  onChange={(e) => update(i, { baseline: e.target.value })}
                />
                <Input
                  placeholder="Target"
                  value={m.target}
                  onChange={(e) => update(i, { target: e.target.value })}
                />
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={add}>
              <Plus className="size-3.5" />
              Adicionar métrica
            </Button>
          </div>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => submit(items)}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function StringListSheet({
  open,
  onClose,
  title,
  initial,
  onSave,
}: SheetBaseProps & {
  title: string;
  initial: string[];
  onSave: (items: string[]) => Promise<void>;
}) {
  const [items, setItems] = useState<string[]>(initial);
  const { saving, submit } = useSubmitHandler(onSave, onClose, `Salvar ${title}`);

  function update(i: number, value: string) {
    setItems((prev) => prev.map((p, idx) => (idx === i ? value : p)));
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems((prev) => [...prev, ""]);
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{title}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <div className="flex flex-col gap-2">
            {items.map((value, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={value}
                  onChange={(e) => update(i, e.target.value)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(i)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={add}>
              <Plus className="size-3.5" />
              Adicionar
            </Button>
          </div>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={saving}
            onClick={() => submit(items.map((s) => s.trim()).filter(Boolean))}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function DependenciesSheet({
  open,
  onClose,
  initial,
  onSave,
}: SheetBaseProps & {
  initial: Dependency[];
  onSave: (items: Dependency[]) => Promise<void>;
}) {
  const [items, setItems] = useState<Dependency[]>(initial);
  const { saving, submit } = useSubmitHandler(
    onSave,
    onClose,
    "Salvar dependências",
  );

  function update(i: number, patch: Partial<Dependency>) {
    setItems((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems((prev) => [...prev, { prdId: "", kind: "blocks" }]);
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Dependências</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Referência por PRD id (UUID) e tipo.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <div className="flex flex-col gap-3">
            {items.map((d, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">
                    #{i + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Input
                  placeholder="PRD id (uuid)"
                  value={d.prdId}
                  onChange={(e) => update(i, { prdId: e.target.value })}
                />
                <Select
                  value={d.kind}
                  onValueChange={(v) =>
                    update(i, { kind: v as Dependency["kind"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blocks">blocks</SelectItem>
                    <SelectItem value="enables">enables</SelectItem>
                    <SelectItem value="shares-data">shares-data</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={add}>
              <Plus className="size-3.5" />
              Adicionar dependência
            </Button>
          </div>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => submit(items)}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function TechnicalNotesSheet({
  open,
  onClose,
  initial,
  onSave,
}: SheetBaseProps & {
  initial: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const { saving, submit } = useSubmitHandler(onSave, onClose, "Salvar notas");

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Notas técnicas</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <FormBody>
            <Field name="technicalNotes">
              <Field.Label>Notas</Field.Label>
              <Field.Control>
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={12}
                />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => submit(value)}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function RisksSheet({
  open,
  onClose,
  initial,
  onSave,
}: SheetBaseProps & {
  initial: RiskOrAssumption[];
  onSave: (items: RiskOrAssumption[]) => Promise<void>;
}) {
  const [items, setItems] = useState<RiskOrAssumption[]>(initial);
  const { saving, submit } = useSubmitHandler(onSave, onClose, "Salvar riscos");

  function update(i: number, patch: Partial<RiskOrAssumption>) {
    setItems((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems((prev) => [...prev, { kind: "risk", text: "", mitigation: "" }]);
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Riscos & Assumptions</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <div className="flex flex-col gap-3">
            {items.map((r, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <Select
                    value={r.kind}
                    onValueChange={(v) =>
                      update(i, { kind: v as RiskOrAssumption["kind"] })
                    }
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="risk">risk</SelectItem>
                      <SelectItem value="assumption">assumption</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  placeholder="Descrição"
                  value={r.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  rows={2}
                />
                <Textarea
                  placeholder="Mitigação (opcional)"
                  value={r.mitigation ?? ""}
                  onChange={(e) => update(i, { mitigation: e.target.value })}
                  rows={2}
                />
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={add}>
              <Plus className="size-3.5" />
              Adicionar
            </Button>
          </div>
        </ResponsiveSheetBody>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => submit(items)}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
