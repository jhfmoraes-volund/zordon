"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DependencyKind = "blocks" | "relates_to";

type LinkedTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  kind: DependencyKind;
};

type FetchResponse = {
  dependsOn: LinkedTask[];
  dependents: LinkedTask[];
  error?: string;
};

const STATUS_TONE: Record<string, string> = {
  done: "text-emerald-700 dark:text-emerald-400",
  in_progress: "text-blue-700 dark:text-blue-400",
  review: "text-amber-700 dark:text-amber-400",
  todo: "text-zinc-700 dark:text-zinc-300",
  backlog: "text-zinc-500 dark:text-zinc-400",
  draft: "text-zinc-400 dark:text-zinc-500",
};

function statusBadge(status: string) {
  const tone = STATUS_TONE[status] ?? "text-zinc-500";
  return (
    <span className={`text-[10px] font-mono uppercase ${tone}`}>{status}</span>
  );
}

function TaskChip({
  task,
  onRemove,
  onOpen,
}: {
  task: LinkedTask;
  onRemove?: () => void;
  onOpen?: (ref: string) => void;
}) {
  const ref = task.reference ?? task.id.slice(0, 8);
  return (
    <div className="inline-flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs">
      <button
        type="button"
        onClick={() => onOpen?.(ref)}
        className="font-mono font-semibold text-primary hover:underline"
        title={task.title}
      >
        {ref}
      </button>
      <span className="max-w-[280px] truncate text-muted-foreground">
        {task.title}
      </span>
      {statusBadge(task.status)}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Remove dependency"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function Section({
  label,
  hint,
  items,
  emptyHint,
  onRemove,
  onOpen,
  showKindBadge,
}: {
  label: string;
  hint?: string;
  items: LinkedTask[];
  emptyHint: string;
  onRemove?: (item: LinkedTask) => void;
  onOpen?: (ref: string) => void;
  showKindBadge?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        {hint ? (
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t) => (
            <div key={`${t.id}:${t.kind}`} className="flex items-center gap-1">
              <TaskChip
                task={t}
                onRemove={onRemove ? () => onRemove(t) : undefined}
                onOpen={onOpen}
              />
              {showKindBadge ? (
                <Badge variant="outline" className="text-[9px] uppercase">
                  {t.kind === "relates_to" ? "rel" : t.kind}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DependenciesBlock({
  taskId,
  onOpenTaskByRef,
}: {
  taskId: string;
  onOpenTaskByRef?: (ref: string) => void;
}) {
  const [outgoing, setOutgoing] = useState<LinkedTask[]>([]);
  const [incoming, setIncoming] = useState<LinkedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addRef, setAddRef] = useState("");
  const [addKind, setAddKind] = useState<DependencyKind>("blocks");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
        cache: "no-store",
      });
      const json = (await res.json()) as FetchResponse;
      if (!res.ok) {
        setError(json.error ?? "Erro ao carregar dependencias");
        return;
      }
      setOutgoing(json.dependsOn);
      setIncoming(json.dependents);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const persist = useCallback(
    async (nextOutgoing: LinkedTask[]) => {
      setBusy(true);
      setError(null);
      try {
        const body = {
          dependsOn: nextOutgoing.map((d) => ({
            ref: d.reference ?? d.id,
            kind: d.kind,
          })),
        };
        const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as FetchResponse;
        if (!res.ok) {
          setError(
            typeof json.error === "string"
              ? json.error
              : "Falha ao atualizar dependencias",
          );
          await refresh();
          return false;
        }
        setOutgoing(json.dependsOn);
        setIncoming(json.dependents);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, taskId],
  );

  const handleAdd = async () => {
    const ref = addRef.trim();
    if (!ref) return;
    if (outgoing.some((d) => (d.reference ?? d.id) === ref && d.kind === addKind)) {
      setError(`${ref} ja esta na lista como ${addKind}`);
      return;
    }
    const optimistic: LinkedTask = {
      id: ref,
      reference: ref,
      title: "(carregando...)",
      status: "backlog",
      kind: addKind,
    };
    const next = [...outgoing, optimistic];
    const ok = await persist(next);
    if (ok) {
      setAddRef("");
    }
  };

  const handleRemove = async (target: LinkedTask) => {
    const next = outgoing.filter(
      (d) => !(d.id === target.id && d.kind === target.kind),
    );
    await persist(next);
  };

  // Particiona pra render por bloco
  const blockingOut = outgoing.filter((d) => d.kind === "blocks");
  const relatingOut = outgoing.filter((d) => d.kind === "relates_to");
  const blockingIn = incoming.filter((d) => d.kind === "blocks");
  const relatingIn = incoming.filter((d) => d.kind === "relates_to");
  const relating = [...relatingOut, ...relatingIn];

  return (
    <div className="space-y-3">
      <Section
        label="Bloqueada por"
        hint="precisa estar pronto antes"
        items={blockingOut}
        emptyHint="Nenhuma dependencia bloqueante"
        onRemove={busy ? undefined : handleRemove}
        onOpen={onOpenTaskByRef}
      />

      <Section
        label="Bloqueia"
        hint="tasks que dependem desta"
        items={blockingIn}
        emptyHint="Nenhuma task depende desta"
        onOpen={onOpenTaskByRef}
      />

      <Section
        label="Relacionada"
        items={relating}
        emptyHint="Sem relacionamentos informativos"
        onRemove={
          busy
            ? undefined
            : (t) => {
                if (relatingOut.some((d) => d.id === t.id && d.kind === t.kind)) {
                  handleRemove(t);
                }
              }
        }
        onOpen={onOpenTaskByRef}
      />

      <div className="flex items-center gap-1.5 pt-1">
        <Input
          value={addRef}
          onChange={(e) => setAddRef(e.target.value)}
          placeholder="Ref (ex: ZRDN-T-042)"
          className="h-8 flex-1 font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          disabled={busy}
        />
        <Select
          value={addKind}
          onValueChange={(v) => setAddKind(v as DependencyKind)}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="blocks">Bloqueia</SelectItem>
            <SelectItem value="relates_to">Relacionada</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleAdd}
          disabled={busy || addRef.trim() === ""}
          className="h-8"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : null}
    </div>
  );
}
