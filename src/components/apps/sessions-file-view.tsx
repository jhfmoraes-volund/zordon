"use client";

/**
 * Design Sessions como file system (superfície desktop do app no tab Apps).
 *
 * Cada arquivo = uma session (output do app). "Nova session" = novo arquivo,
 * via fluxos existentes (SessionPickerModal → SuperSessionModal /
 * PrdQuickAskSheet). Clicar num arquivo abre o SessionDetailSheet existente.
 * A view mobile continua sendo a ProjectSessionsTab dentro do sheet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Pencil, Plus, RefreshCw, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { SessionPickerModal } from "@/components/sessions/session-picker-modal";
import { SuperSessionModal } from "@/components/design-session/super-session-modal";
import { PrdQuickAskSheet } from "@/components/sessions/prd-session/quick-ask-sheet";
import {
  SessionDetailSheet,
  type SessionDetailSummary,
} from "@/components/design-session/session-detail-sheet";
import { createClient } from "@/lib/supabase/client";
import { fetchOrThrow, showErrorToast, HttpError } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

import { AppFileBadge, AppFileList, AppFileRow } from "./app-file-list";

type SessionRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  completedAt: string | null;
  scheduledAt: string | null;
  actualDurationMin: number | null;
  item_count: number;
  visibility: "public" | "internal";
  isMain: boolean;
};

const COMPLETED_STATUSES = new Set(["completed", "done"]);

const TYPE_LABELS: Record<string, string> = {
  inception: "Inception",
  continuous_improvement: "Melhoria Contínua",
  super: "Inception",
};

type FilterKey = "all" | "inception" | "continuous_improvement";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "inception", label: "Inception" },
  { key: "continuous_improvement", label: "Melhoria Contínua" },
];

function matchesType(s: SessionRow, type: FilterKey): boolean {
  if (type === "all") return true;
  if (type === "inception") return s.type === "inception" || s.type === "super";
  return s.type === type;
}

export function SessionsFileView({
  projectId,
  projectName,
  canManage,
}: {
  projectId: string;
  projectName: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [superOpen, setSuperOpen] = useState(false);
  const [quickAskOpen, setQuickAskOpen] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_session_summary")
        .select("*")
        .eq("projectId", projectId)
        .order("createdAt", { ascending: false });
      if (error) {
        console.error("[SessionsFileView.load]", error);
        setSessions([]);
        return;
      }
      setSessions((data ?? []) as unknown as SessionRow[]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => sessions.filter((s) => matchesType(s, filter)),
    [sessions, filter],
  );

  // Lista única, como arquivos num file system — main no topo, resto por data.
  const files = useMemo(
    () =>
      [...visible].sort((a, b) =>
        a.isMain === b.isMain ? 0 : a.isMain ? -1 : 1,
      ),
    [visible],
  );

  // ─── Ações do detail sheet (mesmo wiring da ProjectSessionsTab) ──────────

  function remove(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    setConfirmState({
      title: `Excluir "${session.title}"?`,
      description:
        "A session, items e participantes serão removidos permanentemente.",
      confirmLabel: "Excluir",
      destructive: true,
      // Fetch direto (não optimistic) pra ramificar no 409: sessão com PRDs
      // vinculados não pode ser deletada — o backend recusa e orienta a arquivar.
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/design-sessions/${id}`, { method: "DELETE" });
        } catch (err) {
          if (err instanceof HttpError && err.status === 409) {
            toast.error(
              'Esta sessão tem PRDs vinculados e não pode ser excluída. Use "Arquivar".',
            );
            return;
          }
          showErrorToast(err, { label: "Excluir session" });
          return;
        }
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setOpenSessionId((current) => (current === id ? null : current));
        toast.success("Session excluída.");
      },
    });
  }

  function archive(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    setConfirmState({
      title: `Arquivar "${session.title}"?`,
      description:
        "A sessão sai das listas ativas mas continua acessível. PRDs vinculados são preservados.",
      confirmLabel: "Arquivar",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/design-sessions/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archivedAt: new Date().toISOString() }),
          });
        } catch (err) {
          showErrorToast(err, { label: "Arquivar session" });
          return;
        }
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setOpenSessionId((current) => (current === id ? null : current));
        toast.success("Session arquivada.");
      },
    });
  }

  async function exportJson(id: string) {
    setExportingId(id);
    try {
      const supabase = createClient();
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      if (!authSession) {
        showErrorToast(new Error("Sessão expirada. Faça login novamente."), {
          label: "Auth",
        });
        return;
      }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/export-design-session`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: id }),
      });
      if (!res.ok) {
        showErrorToast(new Error(await res.text()), {
          label: "Erro ao exportar",
        });
        return;
      }
      const cd = res.headers.get("Content-Disposition") ?? "";
      const filename =
        cd.match(/filename="([^"]+)"/)?.[1] ?? `session-${id}.json`;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } finally {
      setExportingId(null);
    }
  }

  const openSession = openSessionId
    ? sessions.find((s) => s.id === openSessionId) ?? null
    : null;
  const openSummary: SessionDetailSummary | null = openSession
    ? {
        id: openSession.id,
        title: openSession.title,
        type: openSession.type,
        status: openSession.status,
        currentStep: openSession.currentStep,
        totalSteps: openSession.totalSteps,
        createdAt: openSession.createdAt,
        completedAt: openSession.completedAt,
        scheduledAt: openSession.scheduledAt,
        actualDurationMin: openSession.actualDurationMin,
        itemCount: openSession.item_count ?? 0,
        visibility: openSession.visibility,
        isMain: openSession.isMain,
        projectId,
      }
    : null;

  // Navegação: clique na row ENTRA na session — steps são a ação primária.
  // A sheet de detalhe abre só pelo ícone de editar. Cálculo do step igual
  // ao da ProjectSessionsTab: concluída abre o último (leitura), ativa
  // continua do corrente.
  function renderRow(s: SessionRow) {
    const isInception = s.type === "inception" || s.type === "super";
    const completed = COMPLETED_STATUSES.has(s.status);
    const playStepIdx = completed
      ? Math.max(0, s.totalSteps - 1)
      : Math.min(s.currentStep, Math.max(0, s.totalSteps - 1));
    const href = `/design-sessions/${s.id}/steps/${playStepIdx}`;
    return (
      <AppFileRow
        key={s.id}
        icon={isInception ? Lightbulb : RefreshCw}
        tileClassName={
          isInception
            ? "bg-amber-500/15 text-amber-500"
            : "bg-sky-500/15 text-sky-500"
        }
        title={s.title}
        subtitle={`${TYPE_LABELS[s.type] ?? s.type} · ${s.item_count ?? 0} ${
          (s.item_count ?? 0) === 1 ? "item" : "itens"
        }`}
        badge={
          <span className="flex shrink-0 items-center gap-1">
            {s.isMain && (
              <AppFileBadge tone="amber">
                <Star className="h-2.5 w-2.5" /> principal
              </AppFileBadge>
            )}
            <AppFileBadge tone={s.visibility === "public" ? "green" : "muted"}>
              {s.visibility === "public" ? "publicado" : "interno"}
            </AppFileBadge>
            {completed ? (
              <AppFileBadge tone="green">concluída</AppFileBadge>
            ) : s.status === "in_progress" ? (
              <AppFileBadge tone="amber">em andamento</AppFileBadge>
            ) : null}
          </span>
        }
        meta={fmtDate(s.createdAt)}
        onOpen={() => router.push(href)}
        actions={
          <button
            type="button"
            aria-label={`Editar session: ${s.title}`}
            title="Editar"
            onClick={(e) => {
              e.stopPropagation();
              setOpenSessionId(s.id);
            }}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Pencil className="size-3.5" />
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === f.key
                  ? "border-foreground/20 bg-foreground/10 font-medium"
                  : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Sem gate de canManage — paridade com a ProjectSessionsTab (builder
            também cria session; o backend valida permissão). */}
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          <Plus className="size-3.5" /> Nova session
        </Button>
      </div>

      {loading ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          Nenhuma session ainda — crie o primeiro arquivo deste app.
        </p>
      ) : (
        <AppFileList>{files.map(renderRow)}</AppFileList>
      )}

      {/* Fluxos existentes de criação/detalhe — reuso integral */}
      <SessionPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(kind) => {
          setPickerOpen(false);
          if (kind === "inception") setSuperOpen(true);
          else setQuickAskOpen(true);
        }}
      />
      <SuperSessionModal
        projectId={projectId}
        projectName={projectName}
        open={superOpen}
        onOpenChange={setSuperOpen}
        onCreated={() => void load()}
      />
      <PrdQuickAskSheet
        projectId={projectId}
        open={quickAskOpen}
        onOpenChange={setQuickAskOpen}
      />
      <SessionDetailSheet
        session={openSummary}
        canManage={canManage}
        exporting={openSessionId !== null && exportingId === openSessionId}
        onClose={() => setOpenSessionId(null)}
        onExport={canManage ? exportJson : undefined}
        onDelete={remove}
        onArchive={canManage ? archive : undefined}
        onVisibilityChanged={(id, visibility) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === id
                ? {
                    ...s,
                    visibility,
                    // Trigger no DB demote automático; espelhar no client.
                    isMain: visibility === "public" ? s.isMain : false,
                  }
                : s,
            ),
          );
        }}
        onMainChanged={(id, isMain) => {
          // Toggle exclusivo: ao marcar uma, a anterior do mesmo (project, type)
          // perde o flag no server. Espelhar no client.
          const target = sessions.find((s) => s.id === id);
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id === id) return { ...s, isMain };
              if (isMain && target && s.type === target.type && s.isMain) {
                return { ...s, isMain: false };
              }
              return s;
            }),
          );
        }}
      />

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}
