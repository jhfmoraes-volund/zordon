"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  ListChecks,
  RotateCcw,
  Layers,
  FileText,
  Wrench,
} from "lucide-react";

// ─── Types (mirror /api/design-sessions/[id]/tree response) ─────────────────

export interface TreeTask {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  functionPoints: number | null;
  complexity: string;
  scope: string;
  acTechnicalCount: number;
}

export interface TreeStory {
  id: string;
  reference: string;
  title: string;
  want: string;
  soThat: string | null;
  refinementStatus: string;
  persona: { id: string; name: string } | null;
  acProductCount: number;
  tasks: TreeTask[];
}

export interface TreeModule {
  key: string;
  moduleId: string | null;
  name: string;
  approved: boolean;
  approvedAt: string | null;
  stories: TreeStory[];
}

export interface TreeStats {
  totalStories: number;
  totalTasks: number;
  draftTasks: number;
  totalFp: number;
  proposedModulesCount: number;
  approvedModulesCount: number;
}

interface TreeResponse {
  sessionId: string;
  projectId: string;
  tree: TreeModule[];
  stats: TreeStats;
}

// ─── Action contract ────────────────────────────────────────────────────────

export type TreeAction =
  | { type: "detail-story"; storyId: string; storyRef: string; title: string }
  | { type: "breakdown-story"; storyId: string; storyRef: string; title: string };

interface DesignSessionTreeProps {
  sessionId: string;
  /** When provided, action buttons appear and call this callback with the
   *  intended action. Parent is responsible for setting subPhase + sending
   *  a chat message. When omitted, the tree is read-only (used in /review). */
  onAction?: (action: TreeAction) => Promise<void> | void;
  /** Open the StorySheet for read/edit. Decoupled from `onAction` (which
   *  drives Vitor) so clicking the title never sends a chat message. */
  onOpenStory?: (storyRef: string) => void;
  /** External refresh trigger — bump to force a re-fetch (e.g. after the
   *  parent sees Vitor finish streaming). */
  refreshKey?: number;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function DesignSessionTree({
  sessionId,
  onAction,
  onOpenStory,
  refreshKey = 0,
}: DesignSessionTreeProps) {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/design-sessions/${sessionId}/tree`);
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setData(j);
      // Auto-expand modules that have stories — first load only.
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        for (const m of j.tree as TreeModule[]) {
          if (m.stories.length > 0) next.add(m.key);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // ── Realtime subscription on UserStory + Task changes for this project ───
  // We don't have projectId until the first fetch lands, so subscribe lazily.
  useEffect(() => {
    if (!data?.projectId) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), 500);
    };

    const channel = client
      .channel(`tree:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "UserStory", filter: `designSessionId=eq.${sessionId}` },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Task", filter: `designSessionId=eq.${sessionId}` },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Module", filter: `projectId=eq.${data.projectId}` },
        debouncedReload,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [data?.projectId, sessionId, load]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const approveModule = async (moduleId: string, name: string) => {
    setBusyId(moduleId);
    try {
      const r = await fetch(`/api/modules/${moduleId}/approve`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(`Falha ao aprovar: ${j.error ?? r.status}`);
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { promoted?: number; totalFp?: number };
      const promoted = j.promoted ?? 0;
      const totalFp = j.totalFp ?? 0;
      toast.success(
        promoted > 0
          ? `Módulo "${name}" aprovado · ${promoted} task(s) no backlog (${totalFp} FP)`
          : `Módulo "${name}" aprovado`,
      );
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const unapproveModule = async (moduleId: string, name: string) => {
    if (
      !window.confirm(
        `Reabrir "${name}" para edição?\n\nTasks no backlog deste módulo voltam para rascunho. ` +
          `Se alguma task já estiver em sprint (todo/in_progress/review/done), a operação é bloqueada — ` +
          `resolva essas tasks antes.`,
      )
    ) {
      return;
    }
    setBusyId(moduleId);
    try {
      const r = await fetch(`/api/modules/${moduleId}/approve`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (r.status === 409 && j.blocking) {
          const refs = (j.blocking as Array<{ reference: string | null; status: string }>)
            .map((b) => `${b.reference ?? "?"} (${b.status})`)
            .join(", ");
          toast.error(`Bloqueado: ${j.message}. Tasks ativas: ${refs}`);
        } else {
          toast.error(`Falha ao reabrir: ${j.error ?? r.status}`);
        }
        return;
      }
      const j = await r.json().catch(() => ({}));
      const reverted = (j as { reverted?: number }).reverted ?? 0;
      toast.success(
        reverted > 0
          ? `Módulo "${name}" reaberto · ${reverted} task(s) voltaram para rascunho`
          : `Módulo "${name}" reaberto`,
      );
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const promoteProposed = async (proposedName: string) => {
    setBusyId(`proposed:${proposedName}`);
    try {
      // Find one story with this proposedModuleName via the tree state, then
      // hit the existing batch endpoint via story-hierarchy DAL pattern. Here
      // we use a per-story approve call repeated — small N (stories per group).
      const group = data?.tree.find((g) => g.key === `proposed:${proposedName}`);
      if (!group) return;
      // Use the story batch endpoint we already have: POST approve-module per
      // story. The first call creates/reuses Module + sets approvedAt; subsequent
      // calls find the now-existing module and re-link.
      let storiesPromoted = 0;
      let tasksPromoted = 0;
      let tasksFp = 0;
      for (const s of group.stories) {
        const r = await fetch(`/api/stories/${s.reference}/approve-module`, { method: "POST" });
        if (r.ok) {
          storiesPromoted++;
          const j = (await r.json().catch(() => ({}))) as { promoted?: number; totalFp?: number };
          tasksPromoted += j.promoted ?? 0;
          tasksFp += j.totalFp ?? 0;
        }
      }
      toast.success(
        tasksPromoted > 0
          ? `Módulo "${proposedName}" aprovado · ${storiesPromoted} story(s), ${tasksPromoted} task(s) no backlog (${tasksFp} FP)`
          : `Módulo "${proposedName}" aprovado · ${storiesPromoted} story(s) promovida(s)`,
      );
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const setRefinement = async (storyRef: string, status: "draft" | "refined" | "committed") => {
    setBusyId(`story:${storyRef}`);
    try {
      const r = await fetch(`/api/stories/${storyRef}/refinement-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(`Falha: ${j.error ?? r.status}`);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const fireAction = async (action: TreeAction) => {
    if (!onAction) return;
    setBusyId(
      action.type === "detail-story"
        ? `detail:${action.storyId}`
        : `breakdown:${action.storyId}`,
    );
    try {
      await onAction(action);
    } finally {
      setBusyId(null);
    }
  };

  const stats = data?.stats;

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-sm">
        Erro ao carregar árvore: {error}
      </div>
    );
  }

  if (!data || data.tree.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
        Nenhuma user story criada ainda. Peça ao Vitor para gerar o esqueleto da
        árvore (modo Tree).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stats bar ─────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <StatPill label="Stories" value={stats.totalStories} icon={<FileText className="h-3 w-3" />} />
          <StatPill label="Tasks" value={stats.totalTasks} icon={<Wrench className="h-3 w-3" />} />
          <StatPill label="FP draft" value={stats.totalFp} />
          <StatPill
            label="Aprovados"
            value={stats.approvedModulesCount}
            tone="green"
            icon={<CheckCircle2 className="h-3 w-3" />}
          />
        </div>
      )}

      {/* ── Modules ───────────────────────────────────────────────── */}
      <ul className="space-y-2">
        {data.tree.map((mod) => (
          <li key={mod.key}>
            <ModuleNode
              mod={mod}
              expanded={expanded.has(mod.key)}
              onToggle={() => toggle(mod.key)}
              busy={busyId}
              onApprove={() => mod.moduleId && approveModule(mod.moduleId, mod.name)}
              onUnapprove={() =>
                mod.moduleId && unapproveModule(mod.moduleId, mod.name)
              }
              onPromoteProposed={() => promoteProposed(mod.name)}
              onAction={onAction ? fireAction : undefined}
              onOpenStory={onOpenStory}
              onSetRefinement={setRefinement}
              onOpenTask={(taskId) => setOpenTaskId(taskId)}
            />
          </li>
        ))}
      </ul>

      <TaskSheetByRef
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onAfterChange={load}
      />
    </div>
  );
}

// ─── Module node ────────────────────────────────────────────────────────────

function ModuleNode({
  mod,
  expanded,
  onToggle,
  busy,
  onApprove,
  onUnapprove,
  onPromoteProposed,
  onAction,
  onOpenStory,
  onSetRefinement,
  onOpenTask,
}: {
  mod: TreeModule;
  expanded: boolean;
  onToggle: () => void;
  busy: string | null;
  onApprove: () => void;
  onUnapprove: () => void;
  onPromoteProposed: () => void;
  onAction?: (a: TreeAction) => Promise<void>;
  onOpenStory?: (storyRef: string) => void;
  onSetRefinement: (ref: string, status: "draft" | "refined" | "committed") => Promise<void>;
  onOpenTask: (id: string) => void;
}) {
  const isProposed = mod.key.startsWith("proposed:");
  const isOrphan = mod.key === "_orphan_";
  const isReal = !isProposed && !isOrphan;

  const moduleBusy =
    (mod.moduleId && busy === mod.moduleId) ||
    (isProposed && busy === `proposed:${mod.name}`);

  // "proposto" (Module ainda virtual via proposedModuleName) e Module DB em draft
  // colapsam no mesmo estado visual — ambos significam "não aprovado". A
  // diferenca tecnica permanece no backend (botão "Aprovar módulo" sabe qual
  // caminho seguir), só o display unifica em "draft" cinza.
  return (
    <div
      className={`rounded-lg border ${
        mod.approved
          ? "border-green-500/30 bg-green-500/[3%]"
          : "border-border bg-card"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">{mod.name}</span>
          {mod.approved ? (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-0 gap-1 text-[10px] py-0 h-5">
              <CheckCircle2 className="h-3 w-3" />
              aprovado
            </Badge>
          ) : isOrphan ? (
            <Badge variant="outline" className="text-[10px] py-0 h-5">
              sem módulo
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] py-0 h-5">
              draft
            </Badge>
          )}
          <span className="text-xs text-muted-foreground shrink-0 ml-auto">
            {mod.stories.length} {mod.stories.length === 1 ? "story" : "stories"}
          </span>
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isProposed && (
            <Button
              size="sm"
              variant="default"
              disabled={!!moduleBusy}
              onClick={onPromoteProposed}
              className="h-7 text-xs gap-1"
            >
              <CheckCircle2 className="h-3 w-3" />
              Aprovar módulo
            </Button>
          )}
          {isReal && !mod.approved && (
            <Button
              size="sm"
              variant="default"
              disabled={!!moduleBusy}
              onClick={onApprove}
              className="h-7 text-xs gap-1"
            >
              <CheckCircle2 className="h-3 w-3" />
              Aprovar
            </Button>
          )}
          {isReal && mod.approved && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!moduleBusy}
              onClick={onUnapprove}
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              title="Reabrir módulo para edição (tasks no backlog voltam para rascunho)"
            >
              <RotateCcw className="h-3 w-3" />
              Reabrir
            </Button>
          )}
        </div>
      </div>

      {/* Stories */}
      {expanded && (
        <ul className="border-t divide-y">
          {mod.stories.map((s) => (
            <StoryNode
              key={s.id}
              story={s}
              busy={busy}
              onAction={onAction}
              onOpenStory={onOpenStory}
              onSetRefinement={onSetRefinement}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Story node ─────────────────────────────────────────────────────────────

function StoryNode({
  story,
  busy,
  onAction,
  onOpenStory,
  onSetRefinement,
  onOpenTask,
}: {
  story: TreeStory;
  busy: string | null;
  onAction?: (a: TreeAction) => Promise<void>;
  onOpenStory?: (storyRef: string) => void;
  onSetRefinement: (ref: string, status: "draft" | "refined" | "committed") => Promise<void>;
  onOpenTask: (id: string) => void;
}) {
  const [taskOpen, setTaskOpen] = useState(false);
  const detailBusy = busy === `detail:${story.id}`;
  const breakdownBusy = busy === `breakdown:${story.id}`;
  const refinementBusy = busy === `story:${story.reference}`;

  const refinementBadge = (() => {
    if (story.refinementStatus === "committed") {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px] py-0 h-5">
          committed
        </Badge>
      );
    }
    if (story.refinementStatus === "refined") {
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-0 text-[10px] py-0 h-5">
          refined
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[10px] py-0 h-5 text-muted-foreground">
        draft
      </Badge>
    );
  })();

  const showTasks = story.tasks.length > 0 && taskOpen;

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setTaskOpen(!taskOpen)}
          className="mt-0.5 text-muted-foreground hover:text-foreground"
          title={story.tasks.length > 0 ? "Expandir tasks" : ""}
          disabled={story.tasks.length === 0}
        >
          {story.tasks.length > 0 ? (
            taskOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="block w-3.5 h-3.5" />
          )}
        </button>

        <FileText className="h-3.5 w-3.5 mt-1 shrink-0 text-muted-foreground" />

        {onOpenStory ? (
          <button
            type="button"
            onClick={() => onOpenStory(story.reference)}
            className="flex-1 min-w-0 text-left rounded -mx-1 px-1 py-0.5 hover:bg-accent/40 transition-colors"
            title="Abrir detalhes da story"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-[10px] font-mono text-muted-foreground">
                {story.reference}
              </code>
              <span className="text-sm font-medium truncate group-hover:underline">
                {story.title}
              </span>
              {refinementBadge}
              {story.persona && (
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  👤 {story.persona.name}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                {story.acProductCount} AC · {story.tasks.length} tasks
              </span>
            </div>
            {story.want && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {story.want}
              </p>
            )}
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-[10px] font-mono text-muted-foreground">
                {story.reference}
              </code>
              <span className="text-sm font-medium truncate">{story.title}</span>
              {refinementBadge}
              {story.persona && (
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  👤 {story.persona.name}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                {story.acProductCount} AC · {story.tasks.length} tasks
              </span>
            </div>
            {story.want && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {story.want}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        {onAction && (
          <div className="flex items-center gap-1 shrink-0">
            {story.refinementStatus === "draft" && (
              <Button
                size="sm"
                variant="outline"
                disabled={detailBusy}
                onClick={() =>
                  onAction({
                    type: "detail-story",
                    storyId: story.id,
                    storyRef: story.reference,
                    title: story.title,
                  })
                }
                className="h-7 text-xs gap-1"
              >
                <Sparkles className="h-3 w-3" />
                Detalhar
              </Button>
            )}
            {story.refinementStatus === "refined" && (
              <Button
                size="sm"
                variant="outline"
                disabled={breakdownBusy}
                onClick={() =>
                  onAction({
                    type: "breakdown-story",
                    storyId: story.id,
                    storyRef: story.reference,
                    title: story.title,
                  })
                }
                className="h-7 text-xs gap-1"
              >
                <ListChecks className="h-3 w-3" />
                Gerar tasks
              </Button>
            )}
            {story.refinementStatus === "committed" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={refinementBusy}
                onClick={() => onSetRefinement(story.reference, "refined")}
                className="h-7 text-xs gap-1 text-muted-foreground"
                title="Reabrir para edição"
              >
                <RotateCcw className="h-3 w-3" />
                Reabrir
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Tasks */}
      {showTasks && (
        <ul className="mt-2 ml-7 space-y-1">
          {story.tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpenTask(t.id)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/40 text-left"
              >
                <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                <code className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {t.reference ?? "—"}
                </code>
                <span className="text-xs truncate flex-1">{t.title}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] py-0 h-5 ${
                    t.status === "draft"
                      ? "text-muted-foreground"
                      : "text-blue-700 dark:text-blue-400 border-blue-500/30"
                  }`}
                >
                  {t.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {t.functionPoints ?? 0} FP · {t.scope}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── Tiny stat pill ─────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: "green" | "amber";
  icon?: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "border-green-500/30 bg-green-500/[5%] text-green-700 dark:text-green-400"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/[5%] text-amber-700 dark:text-amber-400"
        : "border-border bg-card text-foreground";
  return (
    <div className={`rounded-md border px-2.5 py-1.5 flex items-center gap-1.5 ${cls}`}>
      {icon}
      <span className="text-[10px] uppercase tracking-wide opacity-70">{label}</span>
      <span className="font-semibold tabular-nums ml-auto">{value}</span>
    </div>
  );
}
