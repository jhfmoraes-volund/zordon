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
import { Markdown } from "@/components/ui/markdown";
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
type StoryLite = {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  verifiable?: { kind: string; command_or_query: string; expected: string }[];
  dependsOn?: string[];
  agentProfile?: string;
  estimateMinutes?: number;
};
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
  /**
   * When rendered inside a sheet (in-session), provide a back/close handler.
   * Replaces the breadcrumb link to the (removed) standalone PRD list.
   */
  onBack?: () => void;
  /** Notify parent (e.g. in-session PRD list) after the PRD changes. */
  onChanged?: (prd: ProductRequirementRow) => void;
  /** Notify parent after the PRD is hard-deleted, so the list can drop it. */
  onDeleted?: (prdId: string) => void;
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
  const [demoting, startDemote] = useTransition();
  const [deleting, startDelete] = useTransition();

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
    props.onChanged?.(json.data);
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
            props.onChanged?.(json.data);
            toast.success("PRD aprovado.");
            router.refresh();
          } catch (error) {
            showErrorToast(error, { label: "Aprovar PRD" });
          }
        });
      },
    });
  }

  function openDemote() {
    if (!props.canEdit) return;
    setConfirmState({
      title: "Despromover PRD pra draft?",
      description:
        "O PRD volta pra draft e fica editável de novo. A aprovação (data/autor) é limpa.",
      confirmLabel: "Despromover",
      cancelLabel: "Cancelar",
      destructive: false,
      onConfirm: async () => {
        startDemote(async () => {
          try {
            const res = await fetch(`/api/prds/${prd.id}/demote`, {
              method: "POST",
            });
            if (!res.ok) {
              const body = await res.json().catch(() => null);
              const msg = body?.error ?? `${res.status} ${res.statusText}`;
              toast.error(`Não foi possível despromover: ${msg}`);
              return;
            }
            const json = (await res.json()) as { data: ProductRequirementRow };
            setPrd(json.data);
            props.onChanged?.(json.data);
            toast.success("PRD despromovido pra draft.");
            router.refresh();
          } catch (error) {
            showErrorToast(error, { label: "Despromover PRD" });
          }
        });
      },
    });
  }

  function openDelete() {
    if (!props.canEdit) return;
    setConfirmState({
      title: "Deletar PRD?",
      description: `${prd.reference} — ${prd.title} será apagado de vez (e seu histórico). Esta ação é irreversível.`,
      confirmLabel: "Deletar",
      cancelLabel: "Cancelar",
      destructive: true,
      onConfirm: async () => {
        startDelete(async () => {
          try {
            const res = await fetch(`/api/prds/${prd.id}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const body = await res.json().catch(() => null);
              const msg = body?.error ?? `${res.status} ${res.statusText}`;
              toast.error(`Não foi possível deletar: ${msg}`);
              return;
            }
            toast.success("PRD deletado.");
            props.onDeleted?.(prd.id);
            props.onBack?.();
            router.refresh();
          } catch (error) {
            showErrorToast(error, { label: "Deletar PRD" });
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
  const stories = asArray<StoryLite>(prd.stories);
  const specMarkdown = (prd.specMarkdown ?? "").trim();

  return (
    <div className="flex flex-col gap-6 py-6">
      {props.onBack ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            type="button"
            onClick={props.onBack}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Voltar · {project.name}
          </button>
        </div>
      ) : null}

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
              {props.canEdit && status === "approved" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openDemote}
                  disabled={demoting}
                >
                  {demoting ? "Despromovendo…" : "Despromover"}
                </Button>
              ) : null}
              {props.canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={openDelete}
                  disabled={deleting}
                  className="text-destructive hover:text-destructive"
                  aria-label="Deletar PRD"
                >
                  <Trash2 className="size-3.5" />
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

      {/* 1.5 Stories de execução (o que o Forge roda; read-only) */}
      <SectionCard title={`Stories de execução (${stories.length})`} editable={false}>
        {stories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma story — rode o importer (scripts/forge/import-prd-stories.ts).
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {stories.map((s) => (
              <li key={s.id} className="rounded-md border bg-muted/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                  <div className="flex items-center gap-1.5">
                    {s.agentProfile ? (
                      <Badge variant="secondary">{s.agentProfile}</Badge>
                    ) : null}
                    {typeof s.estimateMinutes === "number" ? (
                      <span className="text-xs text-muted-foreground">
                        {s.estimateMinutes}min
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="font-medium">{s.title}</p>
                <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{s.acceptanceCriteria?.length ?? 0} AC</span>
                  <span>· {s.verifiable?.length ?? 0} verifiable</span>
                  {s.dependsOn && s.dependsOn.length > 0 ? (
                    <span>· deps: {s.dependsOn.join(", ")}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 12. Especificação completa (§1–§16) + markdown gerado */}
      <Card>
        <CardHeader>
          <CardTitle>Especificação completa</CardTitle>
          <CardDescription>
            §1–§16 da fonte (specMarkdown). Read-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {specMarkdown ? (
            <Markdown maxChars={1500}>{specMarkdown}</Markdown>
          ) : prd.markdown ? (
            <Markdown maxChars={1500}>{prd.markdown}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Markdown gerado pelo trigger ({prd.markdown.length} chars)
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
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
