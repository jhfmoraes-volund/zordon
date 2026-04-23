"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2, CheckSquare, Square, ChevronDown, ChevronRight,
  Bot, Pencil, Check, X,
} from "lucide-react";

export type PreviewTask = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  notes: string;
  complexity: string;
  scope: string;
  dependsOn: string[];
  included: boolean;
};

const complexityColors: Record<string, string> = {
  trivial: "bg-muted text-muted-foreground",
  low: "bg-blue-500/20 text-blue-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  high: "bg-red-500/20 text-red-400",
};

const scopeColors: Record<string, string> = {
  micro: "bg-muted text-muted-foreground",
  small: "bg-blue-500/20 text-blue-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  large: "bg-red-500/20 text-red-400",
};

export function TaskPreview({
  tasks,
  onChange,
  onConfirm,
  confirming,
}: {
  tasks: PreviewTask[];
  onChange: (tasks: PreviewTask[]) => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ taskId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const toggle = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  const toggleInclude = (id: string) => {
    onChange(tasks.map((t) => (t.id === id ? { ...t, included: !t.included } : t)));
  };

  const removeTask = (id: string) => {
    onChange(tasks.filter((t) => t.id !== id));
  };

  const startEdit = (taskId: string, field: string, value: string) => {
    setEditingField({ taskId, field });
    setEditValue(value);
  };

  const saveEdit = () => {
    if (!editingField) return;
    onChange(
      tasks.map((t) =>
        t.id === editingField.taskId
          ? { ...t, [editingField.field]: editValue }
          : t
      )
    );
    setEditingField(null);
  };

  const includedCount = tasks.filter((t) => t.included).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {tasks.length} tasks geradas • {includedCount} selecionadas
        </p>
        <Button
          onClick={onConfirm}
          disabled={confirming || includedCount === 0}
          className="gap-2"
        >
          {confirming ? "Criando..." : `Confirmar e Criar ${includedCount} Tasks`}
        </Button>
      </div>

      <div className="space-y-2">
        {tasks.map((task, index) => (
          <Card
            key={task.id}
            className={task.included ? "" : "opacity-50"}
          >
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleInclude(task.id)}
                  className="shrink-0"
                >
                  {task.included ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                <button onClick={() => toggle(task.id)} className="shrink-0">
                  {expanded === task.id ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                <span className="text-xs text-muted-foreground font-mono">
                  #{index + 1}
                </span>

                {editingField?.taskId === task.id && editingField.field === "title" ? (
                  <div className="flex items-center gap-1 flex-1">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEdit}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingField(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <span
                    className="text-sm font-medium flex-1 cursor-pointer hover:text-primary"
                    onClick={() => startEdit(task.id, "title", task.title)}
                  >
                    {task.title}
                  </span>
                )}

                <div className="flex items-center gap-1 shrink-0">
                  <Badge className={complexityColors[task.complexity]} variant="secondary">
                    {task.complexity}
                  </Badge>
                  <Badge className={scopeColors[task.scope]} variant="secondary">
                    {task.scope}
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Bot className="h-3 w-3" /> IA
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeTask(task.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            {expanded === task.id && (
              <CardContent className="pt-0 px-4 pb-4 space-y-3">
                {/* Description */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Descrição</p>
                  {editingField?.taskId === task.id && editingField.field === "description" ? (
                    <div className="space-y-1">
                      <Textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={saveEdit}>Salvar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingField(null)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <p
                      className="text-sm cursor-pointer hover:bg-muted/50 rounded p-1 -m-1"
                      onClick={() => startEdit(task.id, "description", task.description)}
                    >
                      {task.description}
                    </p>
                  )}
                </div>

                {/* Acceptance Criteria */}
                {task.acceptanceCriteria.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Acceptance Criteria ({task.acceptanceCriteria.length})
                    </p>
                    <ul className="space-y-1">
                      {task.acceptanceCriteria.map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckSquare className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Notes */}
                {task.notes && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Notas</p>
                    <p className="text-sm font-mono bg-muted/50 p-2 rounded">{task.notes}</p>
                  </div>
                )}

                {/* Dependencies */}
                {task.dependsOn.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Depende de</p>
                    <div className="flex flex-wrap gap-1">
                      {task.dependsOn.map((d, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{d}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
