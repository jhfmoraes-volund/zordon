"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Bot, User, CheckCircle2, Circle, Loader2,
  Eye, AlertCircle, Save, Zap, Link2, FileText,
  Clock, History,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────

type Task = {
  id: string;
  title: string;
  description: string | null;
  reference: string;
  status: string;
  complexity: string;
  scope: string;
  type: string;
  functionPoints: number | null;
  dependencies: string | null;
  executionMode: string;
  acceptanceCriteria: string | null;
  technicalNotes: string | null;
  businessContext: string | null;
  outOfScope: string | null;
  uiGuidance: string | null;
  projectId: string;
  sprintId: string | null;
  createdAt: string;
  updatedAt: string;
  project: { name: string };
  sprint: { name: string } | null;
  assignments: { member: { id: string; name: string } | null; agent: { id: string; name: string } | null }[];
  iterations: Iteration[];
};

type Iteration = {
  id: string;
  number: number;
  type: string;
  trigger: string;
  resultSummary: string | null;
  success: boolean;
  startedAt: string;
  completedAt: string | null;
};

// ─── Constants ─────────────────────────────────────────────

const statusColors: Record<string, string> = {
  backlog: "bg-gray-100 text-gray-700",
  todo: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  review: "bg-purple-100 text-purple-700",
  changes_requested: "bg-orange-100 text-orange-700",
  approved: "bg-emerald-100 text-emerald-700",
  staging: "bg-cyan-100 text-cyan-700",
  done: "bg-green-100 text-green-700",
};

const statusLabels: Record<string, string> = {
  backlog: "Backlog", todo: "To Do", in_progress: "In Progress",
  review: "Review", changes_requested: "Changes Req.", approved: "Approved",
  staging: "Staging", done: "Done",
};

const typeLabels: Record<string, string> = {
  setup: "Setup", feature: "Feature", component: "Componente",
  seed: "Seed", bugfix: "Bugfix", refactor: "Refactor",
  management: "Gestao",
};

const typeColors: Record<string, string> = {
  setup: "bg-purple-100 text-purple-700",
  feature: "bg-blue-100 text-blue-700",
  component: "bg-teal-100 text-teal-700",
  seed: "bg-amber-100 text-amber-700",
  bugfix: "bg-red-100 text-red-700",
  refactor: "bg-gray-100 text-gray-700",
  management: "bg-pink-100 text-pink-700",
};

const tabs = [
  { key: "spec", label: "Spec", icon: FileText },
  { key: "history", label: "Historico", icon: History },
] as const;

type TabKey = (typeof tabs)[number]["key"];

// ─── Page ──────────────────────────────────────────────────

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [task, setTask] = useState<Task | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("spec");
  const [saving, setSaving] = useState(false);

  // Editable spec fields
  const [specForm, setSpecForm] = useState({
    acceptanceCriteria: "",
    technicalNotes: "",
    businessContext: "",
    outOfScope: "",
    uiGuidance: "",
  });
  const [dirty, setDirty] = useState(false);

  const load = () =>
    fetch(`/api/tasks/${id}`).then((r) => r.json()).then((t: Task) => {
      setTask(t);
      setSpecForm({
        acceptanceCriteria: t.acceptanceCriteria || "",
        technicalNotes: t.technicalNotes || "",
        businessContext: t.businessContext || "",
        outOfScope: t.outOfScope || "",
        uiGuidance: t.uiGuidance || "",
      });
      setDirty(false);
    });

  useEffect(() => { load(); }, [id]);

  const updateSpec = (field: string, value: string) => {
    setSpecForm((f) => ({ ...f, [field]: value }));
    setDirty(true);
  };

  const saveSpec = async () => {
    setSaving(true);
    await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acceptanceCriteria: specForm.acceptanceCriteria || null,
        technicalNotes: specForm.technicalNotes || null,
        businessContext: specForm.businessContext || null,
        outOfScope: specForm.outOfScope || null,
        uiGuidance: specForm.uiGuidance || null,
      }),
    });
    setSaving(false);
    setDirty(false);
  };

  if (!task) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  const deps: string[] = task.dependencies ? JSON.parse(task.dependencies) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/tasks">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{task.reference}</span>
              <h1 className="text-2xl font-bold">{task.title}</h1>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={statusColors[task.status]}>
                {statusLabels[task.status] || task.status}
              </Badge>
              <Badge className={typeColors[task.type] || "bg-gray-100 text-gray-700"}>
                {typeLabels[task.type] || task.type}
              </Badge>
              <Badge variant="outline">
                {task.executionMode === "agent" ? (
                  <span className="flex items-center gap-1"><Bot className="h-3 w-3" /> Agent</span>
                ) : (
                  <span className="flex items-center gap-1"><User className="h-3 w-3" /> Manual</span>
                )}
              </Badge>
              {task.functionPoints !== null && (
                <Badge variant="secondary">
                  <Zap className="h-3 w-3 mr-1" /> {task.functionPoints} FP
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Meta cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Projeto</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{task.project.name}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Sprint</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{task.sprint?.name || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Scope / Complexity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-1.5">
              <Badge variant="outline">{task.scope}</Badge>
              <Badge variant="outline">{task.complexity}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Atribuido a</CardTitle>
          </CardHeader>
          <CardContent>
            {task.assignments.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {task.assignments.map((a, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {a.member?.name || a.agent?.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ninguem</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dependencies */}
      {deps.length > 0 && (
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Depende de:</span>
          {deps.map((ref) => (
            <Badge key={ref} variant="outline" className="font-mono text-xs">
              {ref}
            </Badge>
          ))}
        </div>
      )}

      {/* Description */}
      {task.description && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Objetivo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{task.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            {tab.key === "history" && task.iterations.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 text-xs">{task.iterations.length}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "spec" && (
        <SpecTab
          form={specForm}
          onChange={updateSpec}
          onSave={saveSpec}
          saving={saving}
          dirty={dirty}
        />
      )}
      {activeTab === "history" && (
        <HistoryTab iterations={task.iterations} />
      )}
    </div>
  );
}

// ─── Spec Tab ──────────────────────────────────────────────

function SpecTab({
  form,
  onChange,
  onSave,
  saving,
  dirty,
}: {
  form: { acceptanceCriteria: string; technicalNotes: string; businessContext: string; outOfScope: string; uiGuidance: string };
  onChange: (field: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  return (
    <div className="space-y-6">
      {dirty && (
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving} size="sm">
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Salvando..." : "Salvar Spec"}
          </Button>
        </div>
      )}

      <div className="grid gap-6">
        <div className="grid gap-2">
          <Label className="text-sm font-semibold">Acceptance Criteria</Label>
          <p className="text-xs text-muted-foreground">Checklist de criterios de aceite. Cada linha com "- [ ]" vira um item verificavel.</p>
          <Textarea
            placeholder="- [ ] Criterio 1&#10;- [ ] Criterio 2&#10;- [ ] Criterio 3"
            value={form.acceptanceCriteria}
            onChange={(e) => onChange("acceptanceCriteria", e.target.value)}
            rows={8}
            className="font-mono text-sm"
          />
        </div>

        <div className="grid gap-2">
          <Label className="text-sm font-semibold">Technical Notes</Label>
          <p className="text-xs text-muted-foreground">Detalhes tecnicos, snippets de codigo, queries Prisma, payloads, estrutura de dados.</p>
          <Textarea
            placeholder="Snippets, queries, payloads, estrutura de dados..."
            value={form.technicalNotes}
            onChange={(e) => onChange("technicalNotes", e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Business Context</Label>
            <p className="text-xs text-muted-foreground">Motivacao de negocio, persona, problema que resolve.</p>
            <Textarea
              placeholder="Por que essa task existe? Qual persona se beneficia?"
              value={form.businessContext}
              onChange={(e) => onChange("businessContext", e.target.value)}
              rows={4}
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Out of Scope</Label>
            <p className="text-xs text-muted-foreground">O que NAO deve ser feito nessa task.</p>
            <Textarea
              placeholder="- Nao implementar X&#10;- Nao modificar Y"
              value={form.outOfScope}
              onChange={(e) => onChange("outOfScope", e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label className="text-sm font-semibold">UI Guidance</Label>
          <p className="text-xs text-muted-foreground">Orientacoes visuais, referencia a componentes, layout esperado.</p>
          <Textarea
            placeholder="Layout, componentes a usar, referencias visuais..."
            value={form.uiGuidance}
            onChange={(e) => onChange("uiGuidance", e.target.value)}
            rows={4}
          />
        </div>
      </div>
    </div>
  );
}

// ─── History Tab ───────────────────────────────────────────

function HistoryTab({ iterations }: { iterations: Iteration[] }) {
  if (iterations.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <History className="mx-auto h-8 w-8 mb-2 opacity-50" />
        <p>Nenhuma iteracao registrada.</p>
      </div>
    );
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });

  const triggerLabels: Record<string, string> = {
    system: "Sistema", review_feedback: "Feedback de review", merge_conflict: "Conflito de merge",
  };

  return (
    <div className="space-y-3">
      {iterations.map((it) => (
        <Card key={it.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {it.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : it.completedAt ? (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />
                )}
                <span className="text-sm font-medium">Iteracao #{it.number}</span>
                <Badge variant="outline" className="text-xs">{it.type}</Badge>
                <Badge variant="secondary" className="text-xs">
                  {triggerLabels[it.trigger] || it.trigger}
                </Badge>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {fmt(it.startedAt)}
              </div>
            </div>
            {it.resultSummary && (
              <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                {it.resultSummary}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
