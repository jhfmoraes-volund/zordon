"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Trash2, Calendar, Zap, Link2, CheckSquare, Code,
  FileText, FolderKanban, Users,
} from "lucide-react";
import { suggestFunctionPoints } from "@/lib/function-points";
import {
  TASK_STATUSES, STATUS_LABELS, STATUS_COLORS,
  TASK_TYPES, TYPE_LABELS, TYPE_COLORS,
  SCOPES, COMPLEXITIES, fmtDate, isOverdue,
} from "@/lib/task-constants";

// ─── Types ────────────────────────────────────────────────

type Member = { id: string; name: string; role?: string };
type Project = { id: string; name: string };
type Sprint = { id: string; name: string; projectId: string };

type Iteration = {
  id: string; number: number; type: string; trigger: string;
  resultSummary: string | null; success: boolean;
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  reference: string;
  status: string;
  complexity: string;
  scope: string;
  type: string;
  billable: boolean;
  functionPoints: number | null;
  dependencies: string[] | null;
  dueDate: string | null;
  acceptanceCriteria: string | null;
  notes: string | null;
  projectId: string;
  sprintId: string | null;
  project?: { name: string };
  sprint?: { name: string } | null;
  assignments: { member: { id: string; name: string } | null }[];
  iterations?: Iteration[];
};

type CreateDefaults = {
  projectId?: string;
  sprintId?: string;
};

type TaskSheetProps = {
  /** Task ID to edit. Pass null to open in create mode (a draft is created on open). */
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Defaults for create mode */
  createDefaults?: CreateDefaults;
  /** Called after create OR delete (parent refreshes its list). */
  onChange?: () => void;
};

// ─── Wrapper ──────────────────────────────────────────────

export function TaskSheet({
  taskId, open, onOpenChange, createDefaults, onChange,
}: TaskSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full !sm:max-w-[720px] overflow-y-auto p-0">
        {open && (
          <TaskSheetBody
            // Remount on each open cycle so internal state always starts fresh
            key={`${taskId ?? "new"}-${open}`}
            taskId={taskId}
            createDefaults={createDefaults}
            onChange={onChange}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Body (loads task or creates draft, then renders editor) ──

function TaskSheetBody({
  taskId, createDefaults, onChange, onClose,
}: {
  taskId: string | null;
  createDefaults?: CreateDefaults;
  onChange?: () => void;
  onClose: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  // Track whether this is a new task that hasn't been persisted yet
  const [isLocalDraft, setIsLocalDraft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function init() {
      // Fetch supporting data via supabase-js (~50ms total, parallel)
      const [projectsRes, sprintsRes, membersRes] = await Promise.all([
        supabase.from("Project").select("id, name").order("name"),
        supabase.from("Sprint").select("id, name, projectId").order("name"),
        supabase.from("Member").select("id, name, role").order("name"),
      ]);
      if (cancelled) return;
      setProjects(projectsRes.data ?? []);
      setSprints(sprintsRes.data ?? []);
      setMembers(membersRes.data ?? []);

      if (taskId) {
        // Edit mode: load existing task
        const { data } = await supabase
          .from("Task")
          .select("*, project:Project(name), sprint:Sprint(name), assignments:TaskAssignment(*, member:Member(id, name)), iterations:TaskIteration(id, number, type, trigger, resultSummary, success)")
          .eq("id", taskId)
          .single();
        if (cancelled) return;
        if (data) {
          setTask(data as unknown as Task);
        }
        setPhase("ready");
        return;
      }

      // Create mode: build local draft (NO database insert yet)
      const projectId = createDefaults?.projectId ?? projectsRes.data?.[0]?.id;
      const fp = suggestFunctionPoints("small", "medium");

      // Pre-fetch next reference so the badge shows immediately
      const { data: nextRef } = await supabase.rpc("next_task_reference");
      if (cancelled) return;

      setTask({
        id: "",
        title: "",
        description: null,
        reference: nextRef || "TASK-???",
        status: "backlog",
        complexity: "medium",
        scope: "small",
        type: "feature",
        billable: true,
        functionPoints: fp,
        dependencies: null,
        dueDate: null,
        acceptanceCriteria: null,
        notes: null,
        projectId: projectId ?? "",
        sprintId: createDefaults?.sprintId ?? null,
        assignments: [],
      });
      setIsLocalDraft(true);
      setPhase("ready");
    }

    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persist the local draft to the database. Called on first meaningful save. */
  const persistDraft = useCallback(
    async (patch: Record<string, unknown>): Promise<Task | null> => {
      const supabase = createClient();
      const merged = { ...task, ...patch };

      // Get next reference via RPC
      const { data: reference, error: rpcError } = await supabase.rpc("next_task_reference");
      if (rpcError) console.error("RPC next_task_reference failed:", rpcError);
      if (!reference) return null;

      const { assigneeIds, ...insertPatch } = patch as Record<string, unknown> & { assigneeIds?: { memberId: string }[] };

      const { data: created, error } = await supabase
        .from("Task")
        .insert({
          id: crypto.randomUUID(),
          updatedAt: new Date().toISOString(),
          title: (merged.title as string) || "Nova task",
          reference,
          projectId: merged.projectId as string,
          sprintId: (merged.sprintId as string) || null,
          status: merged.status as string,
          type: merged.type as string,
          scope: merged.scope as string,
          complexity: merged.complexity as string,
          billable: merged.billable as boolean,
          functionPoints: merged.functionPoints as number | null,
          description: (merged.description as string) || null,
          dueDate: (merged.dueDate as string) || null,
          dependencies: merged.dependencies as string[] | null,
          acceptanceCriteria: (merged.acceptanceCriteria as string) || null,
          notes: (merged.notes as string) || null,
        })
        .select("*, project:Project(name), sprint:Sprint(name), assignments:TaskAssignment(*, member:Member(id, name))")
        .single();

      if (error || !created) {
        console.error("Failed to persist draft", error);
        return null;
      }

      // Handle assignees if provided
      if (assigneeIds && assigneeIds.length > 0) {
        await supabase.from("TaskAssignment").insert(
          assigneeIds.map((a) => ({ id: crypto.randomUUID(), taskId: created.id, memberId: a.memberId }))
        );
      }

      setIsLocalDraft(false);
      onChange?.();
      return created as unknown as Task;
    },
    [task, onChange]
  );

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!task) return;

      // Optimistic update
      setTask((prev) => (prev ? { ...prev, ...patch } : prev));

      if (isLocalDraft) {
        // First save — persist to database
        const persisted = await persistDraft(patch);
        if (persisted) setTask(persisted);
        return;
      }

      // Existing task — update via supabase
      const supabase = createClient();
      const { assigneeIds, ...dbPatch } = patch as Record<string, unknown> & { assigneeIds?: { memberId: string }[] };

      if (Object.keys(dbPatch).length > 0) {
        await supabase.from("Task").update(dbPatch as Database["public"]["Tables"]["Task"]["Update"]).eq("id", task.id);
      }

      // Handle assignee changes
      if (assigneeIds !== undefined) {
        await supabase.from("TaskAssignment").delete().eq("taskId", task.id);
        if (assigneeIds.length > 0) {
          await supabase.from("TaskAssignment").insert(
            assigneeIds.map((a) => ({ id: crypto.randomUUID(), taskId: task.id, memberId: a.memberId }))
          );
        }
        // Refresh assignments
        const { data: freshAssignments } = await supabase
          .from("TaskAssignment")
          .select("*, member:Member(id, name)")
          .eq("taskId", task.id);
        setTask((prev) => prev ? { ...prev, assignments: freshAssignments ?? [] } : prev);
      }
    },
    [task, isLocalDraft, persistDraft]
  );

  const handleDelete = async () => {
    if (!task) return;
    if (!confirm("Remover esta task?")) return;

    if (isLocalDraft) {
      // Never persisted — just close
      onClose();
      return;
    }

    const supabase = createClient();
    await supabase.from("Task").delete().eq("id", task.id);
    onChange?.();
    onClose();
  };

  if (phase !== "ready" || !task) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  return (
    <TaskSheetEditor
      task={task}
      projects={projects}
      sprints={sprints}
      members={members}
      onSave={save}
      onDelete={handleDelete}
    />
  );
}

// ─── Editor (controlled inputs, save on blur) ─────────────

type EditorProps = {
  task: Task;
  projects: Project[];
  sprints: Sprint[];
  members: Member[];
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
};

function TaskSheetEditor({
  task, projects, sprints, members, onSave, onDelete,
}: EditorProps) {
  // Local draft for text fields (controlled, save on blur)
  // Initialized from task; subsequent task updates from save() naturally update
  // controlled inputs via key prop on the parent on remount.
  const [draft, setDraft] = useState(() => toDraft(task));

  // Helper: save text field if changed
  const saveTextField = (field: keyof typeof draft, apiField?: string) => () => {
    const key = apiField ?? (field as string);
    const value = (draft[field] as string).trim();
    const apiValue = value === "" ? null : value;
    if ((task[key as keyof Task] ?? null) === apiValue) return;
    onSave({ [key]: apiValue });
  };

  const overdue = isOverdue(task.dueDate, task.status);

  const filteredSprints = sprints.filter((s) => s.projectId === task.projectId);

  const currentAssigneeId = task.assignments[0]?.member?.id ?? "__none__";

  // Handle scope/complexity change → auto-suggest FP
  const updateScope = (scope: string) => {
    const fp = suggestFunctionPoints(scope, task.complexity);
    onSave({ scope, functionPoints: fp });
    setDraft((d) => ({ ...d, functionPoints: String(fp) }));
  };
  const updateComplexity = (complexity: string) => {
    const fp = suggestFunctionPoints(task.scope, complexity);
    onSave({ complexity, functionPoints: fp });
    setDraft((d) => ({ ...d, functionPoints: String(fp) }));
  };

  // Dependencies are stored as string[] but edited as comma-separated
  const saveDependencies = () => {
    const arr = draft.dependencies
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const current = task.dependencies ?? [];
    if (arr.length === current.length && arr.every((v, i) => v === current[i])) return;
    onSave({ dependencies: arr.length > 0 ? arr : null });
  };

  const saveDueDate = (value: string) => {
    setDraft((d) => ({ ...d, dueDate: value }));
    const iso = value ? new Date(value).toISOString() : null;
    onSave({ dueDate: iso });
  };

  const saveFunctionPoints = () => {
    const value = draft.functionPoints.trim();
    const num = value === "" ? null : parseInt(value);
    if ((task.functionPoints ?? null) === num) return;
    onSave({ functionPoints: num });
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="border-b px-6 pt-6 pb-4 space-y-4">
        {/* Ref */}
        <div>
          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {task.reference}
          </span>
        </div>

        {/* Title */}
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          onBlur={saveTextField("title")}
          placeholder="Titulo da task"
          className="w-full text-xl font-bold leading-tight bg-transparent outline-none placeholder:text-muted-foreground/40"
        />

        {/* Status + Type */}
        <div className="flex items-center gap-1.5">
          <BadgeSelect
            value={task.status}
            options={[...TASK_STATUSES]}
            labels={STATUS_LABELS}
            colors={STATUS_COLORS}
            onChange={(v) => onSave({ status: v })}
          />
          <BadgeSelect
            value={task.type}
            options={[...TASK_TYPES]}
            labels={TYPE_LABELS}
            colors={TYPE_COLORS}
            onChange={(v) => onSave({ type: v })}
          />
        </div>
      </div>

      {/* ── Body (scrollable) ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Project / sprint / assignee */}
        <div className="grid grid-cols-3 gap-3">
          <FieldBlock label="Projeto" icon={<FolderKanban className="h-3.5 w-3.5" />}>
            <Select
              value={task.projectId}
              onValueChange={(v) => v && onSave({ projectId: v, sprintId: null })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue>
                  {(value: string | null) =>
                    projects.find((p) => p.id === value)?.name ?? task.project?.name ?? "—"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Sprint" icon={<Zap className="h-3.5 w-3.5" />}>
            <Select
              value={task.sprintId ?? "__none__"}
              onValueChange={(v) =>
                onSave({ sprintId: v === "__none__" ? null : v })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "__none__") return "Nenhum";
                    return filteredSprints.find((s) => s.id === value)?.name
                      ?? task.sprint?.name ?? "—";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nenhum</SelectItem>
                {filteredSprints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Atribuido a" icon={<Users className="h-3.5 w-3.5" />}>
            <Select
              value={currentAssigneeId}
              onValueChange={(v) => {
                const assigneeIds = v === "__none__" ? [] : [{ memberId: v }];
                onSave({ assigneeIds });
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "__none__") return "Ninguem";
                    return members.find((m) => m.id === value)?.name ?? "Ninguem";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Ninguem</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>

        {/* FP / due date / billable */}
        <div className="grid grid-cols-3 gap-3">
          <FieldBlock label="Function Points" icon={<Zap className="h-3.5 w-3.5" />}>
            <Input
              type="number"
              value={draft.functionPoints}
              onChange={(e) => setDraft((d) => ({ ...d, functionPoints: e.target.value }))}
              onBlur={saveFunctionPoints}
              className="h-8 text-sm"
            />
          </FieldBlock>

          <FieldBlock label="Prazo" icon={<Calendar className="h-3.5 w-3.5" />}>
            <Input
              type="date"
              value={draft.dueDate}
              onChange={(e) => saveDueDate(e.target.value)}
              className={`h-8 text-sm ${overdue ? "text-red-600 font-medium" : ""}`}
            />
          </FieldBlock>

          <FieldBlock label="Billable">
            <button
              type="button"
              onClick={() => onSave({ billable: !task.billable })}
              className={`h-8 rounded-md border px-3 text-sm text-left transition-colors ${
                task.billable
                  ? "bg-green-500/10 border-green-500/30 text-green-600"
                  : "bg-muted border-border text-muted-foreground"
              }`}
            >
              {task.billable ? "Sim" : "Nao"}
            </button>
          </FieldBlock>
        </div>

        {/* Scope / complexity */}
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Scope">
            <Select value={task.scope} onValueChange={(v) => v && updateScope(v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Complexity">
            <Select value={task.complexity} onValueChange={(v) => v && updateComplexity(v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMPLEXITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>

        {/* Dependencies */}
        <FieldBlock label="Dependencias" icon={<Link2 className="h-3.5 w-3.5" />}>
          <Input
            value={draft.dependencies}
            onChange={(e) => setDraft((d) => ({ ...d, dependencies: e.target.value }))}
            onBlur={saveDependencies}
            placeholder="TASK-001, TASK-003"
            className="h-8 text-sm"
          />
        </FieldBlock>

        {/* Spec */}
        <SpecSection icon={<FileText className="h-4 w-4" />} title="Descricao">
          <Textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            onBlur={saveTextField("description")}
            placeholder="O que entregar e por que"
            rows={3}
            className="text-sm"
          />
        </SpecSection>

        <SpecSection icon={<CheckSquare className="h-4 w-4" />} title="Acceptance Criteria">
          <Textarea
            value={draft.acceptanceCriteria}
            onChange={(e) => setDraft((d) => ({ ...d, acceptanceCriteria: e.target.value }))}
            onBlur={saveTextField("acceptanceCriteria")}
            placeholder="- [ ] Criterio 1&#10;- [ ] Criterio 2"
            rows={5}
            className="font-mono text-sm"
          />
        </SpecSection>

        <SpecSection icon={<Code className="h-4 w-4" />} title="Notas">
          <Textarea
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            onBlur={saveTextField("notes")}
            placeholder="Snippets, queries, referencias visuais, observacoes tecnicas..."
            rows={4}
            className="font-mono text-sm"
          />
        </SpecSection>

        {task.iterations && task.iterations.length > 0 && (
          <SpecSection icon={<FileText className="h-4 w-4" />} title={`Historico (${task.iterations.length})`}>
            <div className="space-y-2">
              {task.iterations.map((it) => (
                <div key={it.id} className="flex items-start gap-3 text-sm border rounded-lg p-3">
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
        )}
      </div>

      {/* ── Footer ── */}
      <div className="border-t px-6 py-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{fmtDate(task.dueDate)}</span>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remover
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────

function toDraft(t: Task) {
  return {
    title: t.title ?? "",
    description: t.description ?? "",
    functionPoints: t.functionPoints != null ? String(t.functionPoints) : "",
    dueDate: t.dueDate ? t.dueDate.slice(0, 10) : "",
    dependencies: t.dependencies ? (Array.isArray(t.dependencies) ? t.dependencies.join(", ") : String(t.dependencies)) : "",
    acceptanceCriteria: t.acceptanceCriteria ?? "",
    notes: t.notes ?? "",
  };
}

function FieldBlock({
  label, icon, children,
}: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function SpecSection({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="surface-inset p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function BadgeSelect({
  value, options, labels, colors, onChange,
}: {
  value: string;
  options: string[];
  labels: Record<string, string>;
  colors: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="h-7 w-auto border-none bg-transparent shadow-none p-0 hover:opacity-80">
        <SelectValue>
          {(v: string | null) => (
            <Badge className={`text-xs ${colors[v ?? value] || ""}`}>
              {labels[v ?? value] || v || value}
            </Badge>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            <Badge className={`text-xs ${colors[o]}`}>{labels[o] || o}</Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
