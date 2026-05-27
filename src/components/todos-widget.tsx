"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListChecks, Plus, ChevronDown, ChevronUp, CalendarDays } from "lucide-react";
import { TodoSheet, type Todo } from "@/components/todo-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import {
  StatusCycleIcon,
  StatusCycleChip,
  nextCycleStatus,
} from "@/components/ui/status-cycle-control";
import { showErrorToast, fetchOrThrow } from "@/lib/optimistic/toast";
import { fmtDateNumeric as fmtDue, isOverdue } from "@/lib/date-utils";

const STATUS_ORDER = { todo: 0, doing: 1, done: 2 } as const;

export function TodosWidget() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/profile/todos");
    if (!res.ok) return;
    const data = (await res.json()) as Todo[];
    setTodos(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Cicla o status (todo → doing → done) direto na lista, igual à reunião.
  // Otimista: aplica o próximo status na hora e reverte se o PATCH falhar.
  const cycleStatus = useCallback(async (todo: Todo) => {
    const next = nextCycleStatus(todo.status);
    setTodos((cur) =>
      cur.map((t) => (t.id === todo.id ? { ...t, status: next } : t)),
    );
    try {
      await fetchOrThrow(`/api/profile/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch (e) {
      setTodos((cur) =>
        cur.map((t) => (t.id === todo.id ? { ...t, status: todo.status } : t)),
      );
      showErrorToast(e, { label: "Falha ao atualizar status" });
    }
  }, []);

  const sorted = [...todos].sort((a, b) => {
    const sd = (STATUS_ORDER[a.status as keyof typeof STATUS_ORDER] ?? 9)
      - (STATUS_ORDER[b.status as keyof typeof STATUS_ORDER] ?? 9);
    if (sd !== 0) return sd;
    // due date: nulls last; earliest first
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  const open = sorted.filter((t) => t.status !== "done");
  const done = sorted.filter((t) => t.status === "done");
  const visible = showDone ? sorted : open;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              Minhas To-dos
              {open.length > 0 && (
                <StatusChip tone="amber">
                  {open.length} pendente{open.length === 1 ? "" : "s"}
                </StatusChip>
              )}
            </CardTitle>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setEditing(null);
                setSheetOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova To-do
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-3 pb-3 pt-0">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : visible.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {open.length === 0 && done.length === 0
                  ? "Nenhuma To-do por enquanto."
                  : "Nenhuma To-do pendente."}
              </p>
              {open.length === 0 && done.length === 0 && (
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Clique em &quot;Nova To-do&quot; pra registrar uma.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {visible.map((t, i) => {
                const overdue = isOverdue(t.dueDate, t.status);
                const isDone = t.status === "done";
                const isLast = i === visible.length - 1;
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setEditing(t);
                      setSheetOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditing(t);
                        setSheetOpen(true);
                      }
                    }}
                    className={`flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 ${
                      !isLast ? "border-b" : ""
                    }`}
                  >
                    <StatusCycleIcon
                      status={t.status}
                      onCycle={() => cycleStatus(t)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm leading-snug break-words [overflow-wrap:anywhere] ${isDone ? "line-through text-muted-foreground" : ""}`}
                      >
                        {t.description}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        {t.meeting && (
                          <span className="break-words [overflow-wrap:anywhere]">
                            de reunião{t.meeting.title ? ` · ${t.meeting.title}` : ""}
                          </span>
                        )}
                        {t.source === "manual" && <span>manual</span>}
                        {t.source === "agent" && <span>via Alpha</span>}
                        {t.dueDate && (
                          <span
                            className={`flex items-center gap-0.5 ${overdue ? "text-red-600 font-medium" : ""}`}
                          >
                            <CalendarDays className="h-3 w-3" />
                            {fmtDue(t.dueDate)}
                            {overdue && " ⚠"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      className="shrink-0 self-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <StatusCycleChip
                        status={t.status}
                        onCycle={() => cycleStatus(t)}
                      />
                    </div>
                  </div>
                );
              })}

              {done.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDone((v) => !v)}
                  className="flex w-full items-center justify-center gap-1.5 border-t bg-muted/20 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  {showDone ? (
                    <>
                      <ChevronUp className="h-3 w-3" /> Ocultar concluídas
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" /> Ver concluídas ({done.length})
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TodoSheet
        todo={editing}
        open={sheetOpen}
        onOpenChange={(v) => {
          setSheetOpen(v);
          if (!v) load();
        }}
        onChange={load}
      />
    </>
  );
}
