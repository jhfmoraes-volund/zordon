"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { TaskSheet } from "@/components/task-sheet";
import { TaskList, type TaskListItem } from "@/components/task-list";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Member = { id: string; name: string; role: string };

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<string>("__all__");

  const load = async () => {
    const supabase = createClient();

    const [tasksRes, membersRes] = await Promise.all([
      supabase
        .from("Task")
        .select("*, project:Project(name), sprint:Sprint(name), designSession:DesignSession(id, title), assignments:TaskAssignment(*, member:Member(id, name))")
        .neq("status", "draft")
        .order("priority", { ascending: false })
        .order("createdAt", { ascending: false }),
      supabase.from("Member").select("id, name, role").order("name"),
    ]);

    if (tasksRes.data) setTasks(tasksRes.data as unknown as TaskListItem[]);
    if (membersRes.data) setMembers(membersRes.data);
  };

  useEffect(() => { load(); }, []);

  const sessionOptions = useMemo(() => {
    const map = new Map<string, string>();
    let hasNone = false;
    for (const t of tasks) {
      if (t.designSession) {
        map.set(t.designSession.id, t.designSession.title);
      } else {
        hasNone = true;
      }
    }
    return {
      sessions: Array.from(map.entries()).map(([id, title]) => ({ id, title })),
      hasNone,
    };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (sessionFilter === "__all__") return tasks;
    if (sessionFilter === "__none__") return tasks.filter((t) => !t.designSession);
    return tasks.filter((t) => t.designSession?.id === sessionFilter);
  }, [tasks, sessionFilter]);

  const openDetail = (id: string) => {
    setSheetTaskId(id);
    setSheetOpen(true);
  };

  const openNew = () => {
    setSheetTaskId(null);
    setSheetOpen(true);
  };

  const handleStatusChange = async (taskId: string, status: string) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    const supabase = createClient();
    const { error } = await supabase.from("Task").update({ status }).eq("id", taskId);
    if (error) load();
  };

  const handleAssigneeChange = async (taskId: string, memberId: string | null) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const member = memberId ? members.find((m) => m.id === memberId) : null;
        return {
          ...t,
          assignments: member
            ? [{ member: { id: member.id, name: member.name } }]
            : [],
        };
      })
    );
    const supabase = createClient();
    await supabase.from("TaskAssignment").delete().eq("taskId", taskId);
    if (memberId) {
      const { error } = await supabase.from("TaskAssignment").insert([{ id: crypto.randomUUID(), taskId, memberId }]);
      if (error) load();
    }
  };

  const handleDelete = async (taskId: string) => {
    const supabase = createClient();
    await supabase.from("Task").delete().eq("id", taskId);
    load();
  };

  const handleBulkDelete = async (taskIds: string[]) => {
    const supabase = createClient();
    await supabase.from("Task").delete().in("id", taskIds);
    load();
  };

  const showSessionUI =
    sessionOptions.sessions.length > 0 || sessionOptions.hasNone;

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" onAdd={openNew} addLabel="Nova Task" />

      {showSessionUI && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Session:</span>
          <Select value={sessionFilter} onValueChange={(v) => v && setSessionFilter(v)}>
            <SelectTrigger className="h-8 text-xs w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              {sessionOptions.hasNone && (
                <SelectItem value="__none__">Sem session (manual)</SelectItem>
              )}
              {sessionOptions.sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sessionFilter !== "__all__" && (
            <span className="text-xs text-muted-foreground">
              {filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      <TaskList
        tasks={filteredTasks}
        members={members}
        onOpenDetail={openDetail}
        onStatusChange={handleStatusChange}
        onAssigneeChange={handleAssigneeChange}
        onDelete={handleDelete}
        onBulkDelete={handleBulkDelete}
        showProject
        showSprint
        showSession
        emptyMessage="Nenhuma task cadastrada."
      />

      <TaskSheet
        taskId={sheetTaskId}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) load();
        }}
        onChange={load}
      />
    </div>
  );
}
