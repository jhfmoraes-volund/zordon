"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListChecks, Plus, ChevronDown, ChevronUp, CalendarDays } from "lucide-react";
import { TodoSheet, TODO_STATUS_LABELS, type Todo } from "@/components/todo-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { ACTION_ITEM_STATUS, lookupChip } from "@/lib/status-chips";

const STATUS_ORDER = { todo: 0, doing: 1, done: 2 } as const;

function fmtDue(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function isOverdue(date: string | null, status: string): boolean {
  if (!date || status === "done") return false;
  return new Date(date) < new Date();
}

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

        <CardContent className="space-y-2">
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
            <ul className="divide-y">
              {visible.map((t) => {
                const overdue = isOverdue(t.dueDate, t.status);
                const isDone = t.status === "done";
                return (
                  <li
                    key={t.id}
                    className="py-2.5 px-2 -mx-2 cursor-pointer rounded-md hover:bg-muted/50 transition-colors flex items-start gap-3"
                    onClick={() => {
                      setEditing(t);
                      setSheetOpen(true);
                    }}
                  >
                    <StatusChip
                      tone={lookupChip(ACTION_ITEM_STATUS, t.status).tone}
                      label={TODO_STATUS_LABELS[t.status as keyof typeof TODO_STATUS_LABELS]}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm leading-snug ${isDone ? "line-through text-muted-foreground" : ""}`}
                      >
                        {t.description}
                      </p>
                      <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                        {t.meeting && (
                          <span className="truncate">
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
                  </li>
                );
              })}
            </ul>
          )}

          {done.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
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
