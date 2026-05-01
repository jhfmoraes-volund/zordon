"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  Check,
  Target,
  CircleDashed,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PixelBar, PixelHud } from "@/components/ui/pixel-bar";
import { TOWERS, towerLabel } from "@/lib/memberSkills";
import {
  ACTION_STATUS_LABELS,
  ACTION_STATUSES,
  type ActionStatus,
} from "@/lib/pdiCycles";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";

type PdiAction = {
  id: string;
  pdiId: string;
  towerKey: string | null;
  title: string;
  why: string | null;
  how: string | null;
  criterion: string;
  dueAt: string | null;
  status: ActionStatus;
  completedAt: string | null;
  orderIdx: number;
  createdAt: string;
  updatedAt: string;
};

type Payload = {
  cycle: { label: string; startDate: string; endDate: string };
  pdi: { id: string; status: string };
  actions: PdiAction[];
};

const fmtShort = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const fmtFull = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export default function PdiPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PdiAction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/pdi");
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(d.error || "Falha ao carregar PDI");
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (a: PdiAction) => { setEditing(a); setDialogOpen(true); };

  const toggleStatus = async (action: PdiAction) => {
    const next: ActionStatus =
      action.status === "done" ? "in_progress" :
      action.status === "pending" ? "in_progress" :
      action.status === "in_progress" ? "done" : "pending";
    setData((cur) =>
      cur
        ? {
            ...cur,
            actions: cur.actions.map((a) =>
              a.id === action.id ? { ...a, status: next } : a,
            ),
          }
        : cur,
    );
    try {
      await fetchOrThrow(`/api/profile/pdi/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch (e) {
      setData((cur) =>
        cur
          ? {
              ...cur,
              actions: cur.actions.map((a) =>
                a.id === action.id ? { ...a, status: action.status } : a,
              ),
            }
          : cur,
      );
      showErrorToast(e, { label: "Falha ao atualizar status" });
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover essa ação do PDI?")) return;
    const snapshot = data?.actions ?? [];
    setData((cur) =>
      cur ? { ...cur, actions: cur.actions.filter((a) => a.id !== id) } : cur,
    );
    try {
      await fetchOrThrow(`/api/profile/pdi/actions/${id}`, { method: "DELETE" });
    } catch (e) {
      setData((cur) => (cur ? { ...cur, actions: snapshot } : cur));
      showErrorToast(e, { label: "Falha ao remover ação" });
    }
  };

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Meu perfil
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Meu PDI
          </h1>
          <p className="text-sm text-muted-foreground">
            Plano de desenvolvimento individual — privado, só você vê.
          </p>
        </div>
      </div>

      <CycleHeader cycle={data.cycle} actions={data.actions} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              Ações
              <PixelHud size="xs" tone="muted">
                {data.actions.length} no ciclo
              </PixelHud>
            </CardTitle>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova ação
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.actions.length === 0 ? (
            <EmptyState onCreate={openNew} />
          ) : (
            data.actions.map((a, i) => (
              <ActionCard
                key={a.id}
                action={a}
                index={i + 1}
                onToggle={() => toggleStatus(a)}
                onEdit={() => openEdit(a)}
                onDelete={() => remove(a.id)}
              />
            ))
          )}
        </CardContent>
      </Card>

      <ActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={editing}
        onSaved={load}
      />
    </div>
  );
}

// ─── Cycle header ────────────────────────────────────────

function CycleHeader({
  cycle,
  actions,
}: {
  cycle: { label: string; startDate: string; endDate: string };
  actions: PdiAction[];
}) {
  const total = actions.length;
  const done = actions.filter((a) => a.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const today = new Date();
  const end = new Date(cycle.endDate);
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PixelHud size="xs" tone="muted">ciclo</PixelHud>
              <Badge>{cycle.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              {fmtFull(cycle.startDate)} — {fmtFull(cycle.endDate)}
            </p>
          </div>
          <div className="text-right">
            <PixelHud size="xs" tone="muted">restante</PixelHud>
            <p className="text-lg font-mono tabular-nums font-semibold">
              {daysLeft}
              <span className="text-xs text-muted-foreground ml-1">dias</span>
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <PixelBar score={pct} cells={24} height={12} variant="skill" />
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono tabular-nums">
              <span className="font-semibold">{done}</span>
              <span className="text-muted-foreground"> / {total} ações concluídas</span>
            </span>
            <span className="font-mono tabular-nums font-semibold">{pct}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Action card ─────────────────────────────────────────

function ActionCard({
  action,
  index,
  onToggle,
  onEdit,
  onDelete,
}: {
  action: PdiAction;
  index: number;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isDone = action.status === "done";
  const isCancelled = action.status === "cancelled";
  const overdue = action.dueAt && new Date(action.dueAt) < new Date() && !isDone && !isCancelled;

  return (
    <div
      className={`surface-inset px-4 py-3 ${isCancelled ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 mt-0.5"
          title="Alternar status"
        >
          <ActionStatusIcon status={action.status} />
        </button>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono tabular-nums text-[10px] text-muted-foreground">
              {String(index).padStart(2, "0")}
            </span>
            {action.towerKey && (
              <Badge variant="outline" className="text-[10px]">
                {towerLabel(action.towerKey)}
              </Badge>
            )}
            <ActionStatusBadge status={action.status} />
            {action.dueAt && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-mono tabular-nums ${
                  overdue ? "text-red-500" : "text-muted-foreground"
                }`}
              >
                <Calendar className="h-3 w-3" />
                {fmtShort(action.dueAt)}
              </span>
            )}
          </div>

          <p
            className={`text-sm font-medium leading-snug ${
              isDone ? "line-through text-muted-foreground" : ""
            }`}
          >
            {action.title}
          </p>

          <p className="text-xs text-muted-foreground leading-snug">
            <span className="text-foreground/60">Critério:</span> {action.criterion}
          </p>

          {(action.why || action.how) && (
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 pt-1">
              {action.why && (
                <p className="text-xs text-muted-foreground leading-snug">
                  <span className="text-foreground/60">Por quê:</span> {action.why}
                </p>
              )}
              {action.how && (
                <p className="text-xs text-muted-foreground leading-snug">
                  <span className="text-foreground/60">Como:</span> {action.how}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Editar">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title="Remover">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ActionStatusIcon({ status }: { status: ActionStatus }) {
  if (status === "done") {
    return (
      <div className="h-5 w-5 rounded-full bg-green-500/20 grid place-items-center text-green-500">
        <Check className="h-3 w-3" strokeWidth={3} />
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="h-5 w-5 rounded-full bg-primary/20 grid place-items-center text-primary">
        <Loader2 className="h-3 w-3" />
      </div>
    );
  }
  if (status === "cancelled") {
    return <CircleDashed className="h-5 w-5 text-muted-foreground/50" />;
  }
  return <CircleDashed className="h-5 w-5 text-muted-foreground" />;
}

function ActionStatusBadge({ status }: { status: ActionStatus }) {
  const cls =
    status === "done"
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : status === "in_progress"
      ? "bg-primary/20 text-primary border-primary/30"
      : status === "cancelled"
      ? "bg-muted text-muted-foreground"
      : "bg-muted text-muted-foreground";
  return (
    <Badge className={`text-[10px] hover:bg-current ${cls}`} variant="outline">
      {ACTION_STATUS_LABELS[status]}
    </Badge>
  );
}

// ─── Empty state ─────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-foreground/10 p-8 text-center space-y-3">
      <Target className="h-8 w-8 text-muted-foreground mx-auto" />
      <div>
        <p className="text-sm font-semibold">Nenhuma ação ainda nesse ciclo</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          Crie 3 a 5 ações concretas com critério mensurável de conclusão. O PDI ideal foca poucas
          coisas e mede progresso real.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Adicionar primeira ação
      </Button>
    </div>
  );
}

// ─── Action dialog (create / edit) ───────────────────────

function ActionDialog({
  open,
  onOpenChange,
  action,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  action: PdiAction | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: "",
    criterion: "",
    dueAt: "",
    towerKey: "",
    why: "",
    how: "",
    status: "pending" as ActionStatus,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when opening
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (action) {
      setForm({
        title: action.title,
        criterion: action.criterion,
        dueAt: action.dueAt ?? "",
        towerKey: action.towerKey ?? "",
        why: action.why ?? "",
        how: action.how ?? "",
        status: action.status,
      });
    } else {
      setForm({
        title: "",
        criterion: "",
        dueAt: "",
        towerKey: "",
        why: "",
        how: "",
        status: "pending",
      });
    }
  }, [open, action]);

  const valid = useMemo(() => form.title.trim() && form.criterion.trim(), [form]);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: form.title.trim(),
        criterion: form.criterion.trim(),
        dueAt: form.dueAt || null,
        towerKey: form.towerKey || null,
        why: form.why.trim() || null,
        how: form.how.trim() || null,
        status: form.status,
      };
      const res = action
        ? await fetch(`/api/profile/pdi/actions/${action.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/profile/pdi/actions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Erro ${res.status}`);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{action ? "Editar ação" : "Nova ação"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Título <span className="text-red-500">*</span></Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Implementar RAG end-to-end"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Critério de conclusão <span className="text-red-500">*</span></Label>
            <Textarea
              value={form.criterion}
              onChange={(e) => setForm({ ...form, criterion: e.target.value })}
              rows={2}
              placeholder="Ex.: PR aprovado com eval automatizado e custo medido"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Torre (opcional)</Label>
              <Select
                value={form.towerKey || "none"}
                onValueChange={(v) => {
                  if (v === null) return;
                  setForm({ ...form, towerKey: v === "none" ? "" : v });
                }}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v: string | null) =>
                      v === "none" || !v ? "Nenhuma" : towerLabel(v)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {TOWERS.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Prazo</Label>
              <Input
                type="date"
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Por quê (opcional)</Label>
            <Textarea
              value={form.why}
              onChange={(e) => setForm({ ...form, why: e.target.value })}
              rows={2}
              placeholder="Por que essa ação importa pro seu desenvolvimento"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Como (opcional)</Label>
            <Textarea
              value={form.how}
              onChange={(e) => setForm({ ...form, how: e.target.value })}
              rows={2}
              placeholder="Como você vai executar (passos, projetos, recursos)"
            />
          </div>

          {action && (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => v && setForm({ ...form, status: v as ActionStatus })}>
                <SelectTrigger>
                  <SelectValue>
                    {(v: string | null) =>
                      v ? ACTION_STATUS_LABELS[v as ActionStatus] : "—"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACTION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{ACTION_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!valid || saving}>
            {saving ? "Salvando…" : action ? "Salvar" : "Criar ação"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
