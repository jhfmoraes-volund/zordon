"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusChip } from "@/components/ui/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { DESIGN_SESSION_STATUS, lookupChip } from "@/lib/status-chips";
import { getStepsForSession, type StepDef } from "@/lib/design-session-steps";
import { fmtDateLong as fmtDate } from "@/lib/date-utils";
import { toast } from "sonner";

const TYPE_LABELS: Record<string, string> = {
  inception: "Inception",
  continuous_improvement: "Melhoria contínua",
  super: "Inception",
};

export type SessionDetailSummary = {
  id: string;
  title: string;
  type: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  completedAt?: string | null;
  scheduledAt?: string | null;
  actualDurationMin?: number | null;
  itemCount: number;
  visibility: "public" | "internal";
  isMain: boolean;
  projectId: string;
};

type Participant = {
  id: string;
  role: string;
  memberId: string | null;
  externalName: string | null;
  externalRole: string | null;
  member: { id: string; name: string; role: string | null } | null;
};

type Props = {
  session: SessionDetailSummary | null;
  canManage?: boolean;
  exporting?: boolean;
  onClose: () => void;
  onExport?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Called after a successful visibility change so the parent list can re-fetch. */
  onVisibilityChanged?: (id: string, visibility: "public" | "internal") => void;
};

export function SessionDetailSheet({
  session,
  canManage = false,
  exporting = false,
  onClose,
  onExport,
  onDelete,
  onVisibilityChanged,
}: Props) {
  return (
    <ResponsiveSheet
      open={session !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <ResponsiveSheetContent size="md" showCloseButton={false}>
        {session ? (
          <Inner
            key={session.id}
            session={session}
            canManage={canManage}
            exporting={exporting}
            onClose={onClose}
            onExport={onExport}
            onDelete={onDelete}
            onVisibilityChanged={onVisibilityChanged}
          />
        ) : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function Inner({
  session,
  canManage,
  exporting,
  onClose,
  onExport,
  onDelete,
  onVisibilityChanged,
}: Props & { session: SessionDetailSummary }) {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [steps, setSteps] = useState<StepDef[] | null>(null);
  const [visibility, setVisibility] = useState(session.visibility);
  const [savingVisibility, setSavingVisibility] = useState(false);

  useEffect(() => {
    setVisibility(session.visibility);
  }, [session.id, session.visibility]);

  async function toggleVisibility() {
    const next = visibility === "public" ? "internal" : "public";
    setSavingVisibility(true);
    const prev = visibility;
    setVisibility(next);
    try {
      const res = await fetch(`/api/design-sessions/${session.id}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        setVisibility(prev);
        const msg =
          res.status === 403
            ? "Você não tem permissão pra mudar a visibilidade."
            : "Não foi possível mudar a visibilidade.";
        toast.error(msg);
        return;
      }
      onVisibilityChanged?.(session.id, next);
      toast.success(
        next === "public"
          ? "Session marcada como pública — guests passam a ver."
          : "Session marcada como interna — oculta do cliente.",
      );
    } catch {
      setVisibility(prev);
      toast.error("Sem conexão. Tente novamente.");
    } finally {
      setSavingVisibility(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const [partsRes, sessRes] = await Promise.all([
        supabase
          .from("DesignSessionParticipant")
          .select(
            "id, role, memberId, externalName, externalRole, member:Member(id, name, role)",
          )
          .eq("sessionId", session.id),
        supabase
          .from("DesignSession")
          .select("type, selectedSteps")
          .eq("id", session.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const rawParts = (partsRes.data ?? []) as unknown as Array<{
        id: string;
        role: string;
        memberId: string | null;
        externalName: string | null;
        externalRole: string | null;
        member:
          | { id: string; name: string; role: string | null }
          | { id: string; name: string; role: string | null }[]
          | null;
      }>;
      setParticipants(
        rawParts.map((p) => ({
          ...p,
          member: Array.isArray(p.member) ? (p.member[0] ?? null) : p.member,
        })),
      );
      if (sessRes.data) {
        setSteps(
          getStepsForSession({
            type: sessRes.data.type,
            selectedSteps: sessRes.data.selectedSteps,
          }),
        );
      } else {
        setSteps(getStepsForSession({ type: session.type }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.id, session.type]);

  const isCompleted = session.status === "completed";
  // Cap visual: quando completed, `currentStep` pode passar do total. Pra UI,
  // 1-indexed step visível nunca passa de totalSteps.
  const visibleStep = Math.min(session.currentStep + 1, session.totalSteps);
  const progressPct = Math.min(
    100,
    Math.round((visibleStep / Math.max(session.totalSteps, 1)) * 100),
  );
  // Link da session — quando completed, abre o último step real (totalSteps-1).
  const openStepIdx = isCompleted
    ? Math.max(0, session.totalSteps - 1)
    : Math.min(session.currentStep, Math.max(0, session.totalSteps - 1));

  const currentStepDef =
    steps && steps[Math.min(session.currentStep, steps.length - 1)];

  return (
    <>
      <ResponsiveSheetHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {TYPE_LABELS[session.type] ?? session.type}
              </Badge>
              <StatusChip
                {...lookupChip(DESIGN_SESSION_STATUS, session.status)}
                dot
              />
              {visibility === "public" ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <Eye className="size-3" /> Pública
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <EyeOff className="size-3" /> Interna
                </Badge>
              )}
            </div>
            <ResponsiveSheetTitle className="font-heading text-xl font-semibold leading-snug">
              {session.title}
            </ResponsiveSheetTitle>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                onClick={toggleVisibility}
                disabled={savingVisibility}
                className="h-7 text-xs"
              >
                {visibility === "public"
                  ? "Tornar interna"
                  : "Tornar pública (visível pra guests)"}
              </Button>
            )}
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X />
          </Button>
        </div>
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-5">
        {/* Progresso */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium uppercase tracking-wider">
              Progresso
            </span>
            <span className="tabular-nums">
              {visibleStep}/{session.totalSteps} · {progressPct}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {currentStepDef && (
            <div className="text-sm">
              <p className="font-medium">{currentStepDef.title}</p>
              {currentStepDef.description && (
                <p className="text-xs text-muted-foreground">
                  {currentStepDef.description}
                </p>
              )}
            </div>
          )}
        </section>

        <Separator />

        {/* Participantes */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium uppercase tracking-wider">
              Participantes
            </span>
            {participants && (
              <span className="tabular-nums">{participants.length}</span>
            )}
          </div>
          {participants === null ? (
            <div className="space-y-1.5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : participants.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum participante registrado.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {participants.map((p) => {
                const name = p.member?.name ?? p.externalName ?? "(sem nome)";
                const role =
                  p.member?.role ?? p.externalRole ?? p.role ?? null;
                const initials = name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                      {initials}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {role && (
                      <span className="text-xs text-muted-foreground">
                        {role}
                      </span>
                    )}
                    {!p.member && (
                      <Badge variant="outline" className="text-[10px]">
                        externo
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Separator />

        {/* Conteúdo */}
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Conteúdo
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Stat label="Items" value={session.itemCount} />
          </div>
        </section>

        <Separator />

        {/* Linha do tempo */}
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Linha do tempo
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <Row label="Criada" value={fmtDate(session.createdAt)} />
            {session.scheduledAt && (
              <Row label="Agendada" value={fmtDate(session.scheduledAt)} />
            )}
            {session.completedAt && (
              <Row label="Concluída" value={fmtDate(session.completedAt)} />
            )}
            {session.actualDurationMin != null && (
              <Row
                label="Duração"
                value={`${session.actualDurationMin} min`}
              />
            )}
          </dl>
        </section>
      </ResponsiveSheetBody>

      <ResponsiveSheetFooter className="flex-wrap gap-2">
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(session.id)}
          >
            <Trash2 className="size-4" />
            Excluir
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canManage && onExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport(session.id)}
              disabled={exporting}
            >
              <Download className="size-4" />
              {exporting ? "Exportando…" : "Exportar JSON"}
            </Button>
          )}
          <Link
            href={`/design-sessions/${session.id}/steps/${openStepIdx}`}
            onClick={onClose}
          >
            <Button size="sm">
              {isCompleted ? "Ver session" : "Abrir session"}
              <ExternalLink className="size-4" />
            </Button>
          </Link>
        </div>
      </ResponsiveSheetFooter>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-base font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
}

