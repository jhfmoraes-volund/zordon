"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Pencil, Trash2, Bot, User, Zap, Link2, Calendar,
  FileText, CheckSquare, Code, Briefcase, Ban, Layout,
} from "lucide-react";
import { suggestFunctionPoints } from "@/lib/function-points";

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
  dueDate: string | null;
  executionMode: string;
  acceptanceCriteria: string | null;
  technicalNotes: string | null;
  businessContext: string | null;
  outOfScope: string | null;
  uiGuidance: string | null;
  projectId: string;
  sprintId: string | null;
  project: { name: string };
  sprint: { name: string } | null;
  assignments: { member: { name: string } | null; agent: { name: string } | null }[];
  _count?: { iterations: number };
};

type FullTask = Task & {
  iterations: {
    id: string; number: number; type: string; trigger: string;
    resultSummary: string | null; success: boolean;
    startedAt: string; completedAt: string | null;
  }[];
};

type Project = { id: string; name: string };
type Sprint = { id: string; name: string; projectId: string };

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

const complexities = ["trivial", "low", "medium", "high"];
const scopes = ["micro", "small", "medium", "large"];
const taskTypes = ["setup", "feature", "component", "seed", "bugfix", "refactor", "management"];
const statuses = [
  "backlog", "todo", "in_progress", "review", "changes_requested",
  "approved", "staging", "done",
];

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function isOverdue(d: string | null, status: string) {
  if (!d || status === "done") return false;
  return new Date(d) < new Date();
}

// ─── Page ──────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  // Sheet (detail modal)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FullTask | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [form, setForm] = useState({
    title: "", description: "", reference: "", status: "backlog",
    complexity: "medium", scope: "small", projectId: "", sprintId: "",
    executionMode: "manual", type: "feature", functionPoints: "",
    dependencies: "", dueDate: "",
    acceptanceCriteria: "", technicalNotes: "", businessContext: "",
  });

  const load = () => {
    fetch("/api/tasks").then((r) => r.json()).then(setTasks);
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
    fetch("/api/sprints").then((r) => r.json()).then(setSprints);
  };

  useEffect(() => { load(); }, []);

  // ─── Sheet (click to open detail) ──────────────────────

  const openDetail = async (t: Task) => {
    setSheetOpen(true);
    setLoadingDetail(true);
    setSelectedTask(null);
    const res = await fetch(`/api/tasks/${t.id}`);
    const full = await res.json();
    setSelectedTask(full);
    setLoadingDetail(false);
  };

  // ─── Dialog (create/edit) ──────────────────────────────

  const openNew = () => {
    const nextRef = `TASK-${String(tasks.length + 1).padStart(3, "0")}`;
    const suggestedSp = suggestFunctionPoints("small", "medium");
    setEditing(null);
    setForm({
      title: "", description: "", reference: nextRef, status: "backlog",
      complexity: "medium", scope: "small", projectId: "", sprintId: "",
      executionMode: "manual", type: "feature", functionPoints: String(suggestedSp),
      dependencies: "", dueDate: "",
      acceptanceCriteria: "", technicalNotes: "", businessContext: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (t: Task) => {
    setEditing(t);
    const deps = t.dependencies ? JSON.parse(t.dependencies).join(", ") : "";
    setForm({
      title: t.title,
      description: t.description || "",
      reference: t.reference,
      status: t.status,
      complexity: t.complexity,
      scope: t.scope,
      projectId: t.projectId,
      sprintId: t.sprintId || "",
      executionMode: t.executionMode,
      type: t.type,
      functionPoints: String(t.functionPoints ?? ""),
      dependencies: deps,
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : "",
      acceptanceCriteria: t.acceptanceCriteria || "",
      technicalNotes: t.technicalNotes || "",
      businessContext: t.businessContext || "",
    });
    setDialogOpen(true);
  };

  const updateScopeComplexity = (field: "scope" | "complexity", value: string) => {
    const newScope = field === "scope" ? value : form.scope;
    const newComplexity = field === "complexity" ? value : form.complexity;
    const sp = suggestFunctionPoints(newScope, newComplexity);
    setForm({ ...form, [field]: value, functionPoints: String(sp) });
  };

  const save = async () => {
    const depsArray = form.dependencies.split(",").map(d => d.trim()).filter(Boolean);
    const body = {
      title: form.title,
      description: form.description || null,
      reference: form.reference,
      status: form.status,
      complexity: form.complexity,
      scope: form.scope,
      projectId: form.projectId,
      sprintId: form.sprintId || null,
      executionMode: form.executionMode,
      type: form.type,
      functionPoints: form.functionPoints ? parseInt(form.functionPoints) : null,
      dependencies: depsArray.length > 0 ? JSON.stringify(depsArray) : null,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      acceptanceCriteria: form.acceptanceCriteria || null,
      technicalNotes: form.technicalNotes || null,
      businessContext: form.businessContext || null,
    };
    if (editing) {
      await fetch(`/api/tasks/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setDialogOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover esta task?")) return;
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    load();
  };

  const filteredSprints = sprints.filter((s) => s.projectId === form.projectId);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" onAdd={openNew} addLabel="Nova Task" />

      <div className="surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Titulo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>FP</TableHead>
              <TableHead>Sprint</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Atribuido a</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => (
              <TableRow
                key={t.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => openDetail(t)}
              >
                <TableCell className="font-mono text-sm text-primary">{t.reference}</TableCell>
                <TableCell className="font-medium max-w-[250px] truncate">{t.title}</TableCell>
                <TableCell>
                  <Badge className={typeColors[t.type] || "bg-gray-100 text-gray-700"}>
                    {typeLabels[t.type] || t.type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="font-medium tabular-nums">{t.functionPoints ?? "—"}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{t.sprint?.name || "—"}</span>
                </TableCell>
                <TableCell>
                  <span className={`text-xs tabular-nums ${isOverdue(t.dueDate, t.status) ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                    {fmtDate(t.dueDate)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge className={statusColors[t.status]}>
                    {statusLabels[t.status] || t.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {t.assignments.map((a, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {a.member?.name || a.agent?.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhuma task cadastrada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Detail Sheet (click on row) ──────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {loadingDetail || !selectedTask ? (
            <div className="py-12 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <TaskDetailSheet task={selectedTask} onEdit={() => { setSheetOpen(false); openEdit(selectedTask); }} />
          )}
        </SheetContent>
      </Sheet>

      {/* ─── Create/Edit Dialog ───────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Task" : "Nova Task"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Referencia</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Projeto</Label>
                <Select value={form.projectId} onValueChange={(v) => v && setForm({ ...form, projectId: v, sprintId: "" })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione">
                      {(value: string | null) => projects.find((p) => p.id === value)?.name ?? "Selecione"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Titulo</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Descricao / Objetivo</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {taskTypes.map((t) => <SelectItem key={t} value={t}>{typeLabels[t] || t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => v && setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => <SelectItem key={s} value={s}>{statusLabels[s] || s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Mode</Label>
                <Select value={form.executionMode} onValueChange={(v) => v && setForm({ ...form, executionMode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Scope</Label>
                <Select value={form.scope} onValueChange={(v) => v && updateScopeComplexity("scope", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{scopes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Complexity</Label>
                <Select value={form.complexity} onValueChange={(v) => v && updateScopeComplexity("complexity", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{complexities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Function Points</Label>
                <Input type="number" value={form.functionPoints} onChange={(e) => setForm({ ...form, functionPoints: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {filteredSprints.length > 0 && (
                <div className="grid gap-2">
                  <Label>Sprint</Label>
                  <Select value={form.sprintId} onValueChange={(v) => v && setForm({ ...form, sprintId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Nenhum">
                        {(value: string | null) => filteredSprints.find((s) => s.id === value)?.name ?? "Nenhum"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {filteredSprints.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-2">
                <Label>Prazo de Entrega</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Dependencias</Label>
              <Input placeholder="TASK-001, TASK-003" value={form.dependencies} onChange={(e) => setForm({ ...form, dependencies: e.target.value })} />
              <p className="text-xs text-muted-foreground">Referencias separadas por virgula</p>
            </div>
            <div className="border-t pt-4 mt-2">
              <p className="text-sm font-medium mb-3">Spec</p>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Acceptance Criteria</Label>
                  <Textarea placeholder="- [ ] Criterio 1" value={form.acceptanceCriteria} onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })} rows={4} />
                </div>
                <div className="grid gap-2">
                  <Label>Technical Notes</Label>
                  <Textarea placeholder="Detalhes tecnicos..." value={form.technicalNotes} onChange={(e) => setForm({ ...form, technicalNotes: e.target.value })} rows={3} />
                </div>
                <div className="grid gap-2">
                  <Label>Business Context</Label>
                  <Textarea placeholder="Contexto de negocio..." value={form.businessContext} onChange={(e) => setForm({ ...form, businessContext: e.target.value })} rows={2} />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.title || !form.projectId || !form.reference}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Task Detail Sheet ─────────────────────────────────────

function TaskDetailSheet({ task, onEdit }: { task: FullTask; onEdit: () => void }) {
  const deps: string[] = task.dependencies ? JSON.parse(task.dependencies) : [];
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{task.reference}</span>
          <Badge className={typeColors[task.type] || "bg-gray-100 text-gray-700"}>
            {typeLabels[task.type] || task.type}
          </Badge>
          <Badge className={statusColors[task.status]}>
            {statusLabels[task.status] || task.status}
          </Badge>
        </div>
        <SheetTitle className="text-left text-lg">{task.title}</SheetTitle>
        <SheetDescription className="text-left">{task.description}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">FP:</span>
            <span className="font-medium">{task.functionPoints ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className={`h-3.5 w-3.5 ${overdue ? "text-red-500" : "text-muted-foreground"}`} />
            <span className="text-muted-foreground">Prazo:</span>
            <span className={`font-medium ${overdue ? "text-red-600" : ""}`}>
              {fmtDate(task.dueDate)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Scope:</span>{" "}
            <Badge variant="outline" className="text-xs">{task.scope}</Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Complexity:</span>{" "}
            <Badge variant="outline" className="text-xs">{task.complexity}</Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Sprint:</span>{" "}
            <span className="font-medium text-xs">{task.sprint?.name || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Mode:</span>{" "}
            <Badge variant="outline" className="text-xs">
              {task.executionMode === "agent" ? "Agent" : "Manual"}
            </Badge>
          </div>
        </div>

        {/* Dependencies */}
        {deps.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Depende de:</span>
            {deps.map((ref) => (
              <Badge key={ref} variant="outline" className="font-mono text-xs">{ref}</Badge>
            ))}
          </div>
        )}

        <Separator />

        {/* Acceptance Criteria */}
        {task.acceptanceCriteria && (
          <SpecSection icon={<CheckSquare className="h-4 w-4" />} title="Acceptance Criteria">
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{task.acceptanceCriteria}</pre>
          </SpecSection>
        )}

        {/* Technical Notes */}
        {task.technicalNotes && (
          <SpecSection icon={<Code className="h-4 w-4" />} title="Technical Notes">
            <pre className="text-sm whitespace-pre-wrap font-mono text-xs leading-relaxed bg-muted p-3 rounded-md overflow-x-auto">{task.technicalNotes}</pre>
          </SpecSection>
        )}

        {/* Business Context */}
        {task.businessContext && (
          <SpecSection icon={<Briefcase className="h-4 w-4" />} title="Business Context">
            <p className="text-sm">{task.businessContext}</p>
          </SpecSection>
        )}

        {/* Out of Scope */}
        {task.outOfScope && (
          <SpecSection icon={<Ban className="h-4 w-4" />} title="Out of Scope">
            <pre className="text-sm whitespace-pre-wrap font-sans">{task.outOfScope}</pre>
          </SpecSection>
        )}

        {/* UI Guidance */}
        {task.uiGuidance && (
          <SpecSection icon={<Layout className="h-4 w-4" />} title="UI Guidance">
            <p className="text-sm">{task.uiGuidance}</p>
          </SpecSection>
        )}

        {/* Iterations */}
        {task.iterations && task.iterations.length > 0 && (
          <>
            <Separator />
            <SpecSection icon={<FileText className="h-4 w-4" />} title={`Historico (${task.iterations.length} iteracoes)`}>
              <div className="space-y-2">
                {task.iterations.map((it) => (
                  <div key={it.id} className="flex items-start gap-2 text-sm border rounded-md p-2">
                    <Badge variant={it.success ? "secondary" : "destructive"} className="text-xs mt-0.5">
                      #{it.number}
                    </Badge>
                    <div>
                      <p className="text-xs text-muted-foreground">{it.type} — {it.trigger}</p>
                      {it.resultSummary && <p className="text-xs mt-1">{it.resultSummary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </SpecSection>
          </>
        )}

        <Separator />

        <div className="flex gap-2">
          <Button size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
          </Button>
          <Link href={`/tasks/${task.id}`}>
            <Button variant="outline" size="sm">
              Abrir pagina completa
            </Button>
          </Link>
        </div>
      </div>
    </>
  );
}

function SpecSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}
